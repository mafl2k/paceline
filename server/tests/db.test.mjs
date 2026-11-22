// Run with: node --test server/tests/db.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {execFileSync, spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {openDb, waitForDb, migrate, DbLocked, TxAborted, MIGRATIONS, SCHEMA_VERSION} from '../db.mjs';
import {writeBackup} from '../dump.mjs';
import {createServer} from '../server.mjs';
import {openStore} from '../store.mjs';
import {T, club, sheet} from './helpers.mjs';
import {PRE_RACES} from './pre-races.mjs';
import {mixedTypes, typesOf, ONE_TYPE} from './cockpit-fixture.mjs';
import {planTypesStep} from '../migrate-plan-types.mjs';

const DB_URL = pathToFileURL(path.join(import.meta.dirname, '..', 'db.mjs'));
const SERVER = path.join(import.meta.dirname, '..', 'server.mjs');


// A fresh data dir, removed after the test.
function tmpDir(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paceline-db-'));
    t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
    return dir;
}


// Another process: openDb on DB_DIR, then a plain connection that tries to write.
const CHILD = `
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openDb, DbLocked} from ${JSON.stringify(DB_URL.href)};
try {
    openDb(process.env.DB_DIR).close();
    console.log('opened');
} catch (e) {
    console.log(e instanceof DbLocked ? 'locked' : 'other: ' + e.message);
}
const sql = new DatabaseSync(path.join(process.env.DB_DIR, 'paceline.db'));
try {
    sql.exec("INSERT INTO meta VALUES ('child', 'x')");
    console.log('written');
} catch (e) {
    console.log(\`write refused \${e.errcode}\`);
}
`;


test('openDb: the pragmas, schema 4, a write before it returns, no -shm', t => {
    const dir = tmpDir(t);
    const db = openDb(dir, {now: () => T('2026-11-19T12:00Z')});
    const one = sql => ({...db.sql.prepare(sql).get()});
    assert.deepEqual(one('PRAGMA locking_mode'), {locking_mode: 'exclusive'});
    assert.deepEqual(one('PRAGMA journal_mode'), {journal_mode: 'wal'});
    assert.deepEqual(one('PRAGMA synchronous'), {synchronous: 2});
    assert.deepEqual(one('PRAGMA foreign_keys'), {foreign_keys: 1});
    assert.deepEqual(one('PRAGMA secure_delete'), {secure_delete: 1});
    // schema 2 (19 Nov 2026): recordings.mtime, for the erasure list's reconcile check; schema 3
    // (20 Nov 2026): races; schema 4 (21 Nov 2026): one type per plan
    assert.deepEqual(one('PRAGMA user_version'), {user_version: 4});
    assert.deepEqual(db.sql.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(r => r.name),
        ['archive', 'clubs', 'meta', 'recording_sigs', 'recordings', 'retired_slugs', 'seen', 'settings', 'tombstone_clubs', 'trash']);
    // the indexes the queries use (the primary keys aside)
    assert.deepEqual(db.sql.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name").all().map(r => r.name),
        ['recording_sigs_team', 'recordings_session']);
    assert.equal(db.meta('opened_at'), '2026-11-19T12:00:00.000Z');
    assert.equal(fs.existsSync(path.join(dir, 'paceline.db-shm')), false);
    assert.equal(fs.statSync(db.file).mode & 0o777, 0o640);
    assert.equal(fs.statSync(db.file + '-wal').mode & 0o777, 0o640);
    db.close();
    const again = openDb(dir, {now: () => T('2026-11-20T12:00Z')});   // no second migration
    assert.equal(again.meta('opened_at'), '2026-11-20T12:00:00.000Z');
    // a clean close removed the -wal: the new one is 0640 as well
    assert.equal(fs.statSync(again.file + '-wal').mode & 0o777, 0o640);
    again.close();
});


// How often `marker` occurs in the bytes of `file` (read only after paceline.db is closed).
function occurrences(file, marker) {
    const bytes = fs.readFileSync(file);
    let n = 0;
    for (let i = bytes.indexOf(marker); i >= 0; i = bytes.indexOf(marker, i + 1)) {
        n++;
    }
    return n;
}


test('secure_delete: a purged club and data erased from a club leave no bytes behind in paceline.db', t => {
    const dir = tmpDir(t);
    const now = () => T('2026-11-19T12:00Z');
    const db = openDb(dir, {now});
    t.after(() => db.sql.isOpen && db.close());
    const store = openStore({db, now});
    const withMarker = (id, name, marker) => {
        const c = club({id, name});
        c.email = `${marker}@example.org`;
        c.log = Array.from({length: 150}, (_, i) => ({at: '2026-11-19T12:00:00.000Z', what: `${marker}-${i}`}));
        return c;
    };
    store.create(withMarker('k7f3q9x2m4', 'Kettenfett RC', 'MARKERPURGED'));
    store.create(withMarker('p2m8c4t1v9', 'Spokesmen CC', 'MARKERERASED'));
    // an erasure: the marker leaves the club
    store.change('p2m8c4t1v9', c => {
        c.email = 'captain@example.org';
        c.log = [];
    });
    // a deletion: the trash, then the purge
    store.trash('k7f3q9x2m4');
    store.purge('k7f3q9x2m4');
    for (let i = 0; i < 20; i++) {
        store.change('p2m8c4t1v9', c => {
            c.log.push({at: '2026-11-19T12:00:00.000Z', what: `x${i}`});
        });
    }
    db.close();   // checkpoints the -wal into paceline.db and removes it
    assert.equal(fs.existsSync(path.join(dir, 'paceline.db-wal')), false);
    assert.equal(occurrences(path.join(dir, 'paceline.db'), 'MARKERPURGED'), 0);
    assert.equal(occurrences(path.join(dir, 'paceline.db'), 'MARKERERASED'), 0);
});


test('a second connection can neither open nor write while paceline.db is held, in this process or another', t => {
    const dir = tmpDir(t);
    const db = openDb(dir);
    assert.throws(() => openDb(dir), DbLocked);
    const out = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', CHILD],
        {encoding: 'utf8', env: {...process.env, DB_DIR: dir}});
    assert.deepEqual(out.trim().split('\n'), ['locked', 'write refused 5']);
    db.close();
    const after = openDb(dir);
    assert.equal(after.meta('child'), null);
    after.close();
});


// A db with table x (v TEXT); insert(v) adds a row, values() lists them in order.
function xTable(t) {
    const db = openDb(tmpDir(t));
    t.after(() => db.sql.isOpen && db.close());
    db.sql.exec('CREATE TABLE x (v TEXT) STRICT');
    const insert = v => db.sql.prepare('INSERT INTO x VALUES (?)').run(v);
    const values = () => db.sql.prepare('SELECT v FROM x ORDER BY rowid').all().map(r => r.v);
    return {db, insert, values};
}


test('tx: commit, rollback on a throw, savepoints when nested; afterCommit after the outermost commit only', t => {
    const {db, insert, values} = xTable(t);
    const log = [];
    db.tx(() => {
        insert('a');
        db.afterCommit(() => log.push('a'));
    });
    assert.deepEqual(values(), ['a']);
    assert.deepEqual(log, ['a']);

    assert.throws(() => db.tx(() => {
        insert('b');
        db.afterCommit(() => log.push('b'));
        throw new Error('boom');
    }), /boom/);
    assert.deepEqual(values(), ['a']);
    assert.deepEqual(log, ['a']);

    db.tx(() => {
        insert('c');
        try {
            db.tx(() => {
                insert('d');
                db.afterCommit(() => log.push('d'));
                throw new Error('inner');
            });
        } catch {
            // an ordinary error of a nested tx: its savepoint is rolled back, the outer one goes on
            // (a TxAborted must never be caught like this, see the next tests)
        }
        db.afterCommit(() => log.push('c'));
        assert.deepEqual(log, ['a']);
    });
    assert.deepEqual(values(), ['a', 'c']);
    assert.deepEqual(log, ['a', 'c']);

    // outside a transaction afterCommit runs at once
    db.afterCommit(() => log.push('now'));
    assert.deepEqual(log, ['a', 'c', 'now']);

    assert.throws(() => db.tx(async () => {}), TypeError);
    assert.equal(db.sql.isTransaction, false);
    db.tx(() => insert('e'));
    assert.deepEqual(values(), ['a', 'c', 'e']);
    assert.equal(db.sql.isTransaction, false);
});


test('tx: every afterCommit callback runs; the first error is rethrown and the commit stands', t => {
    const {db, insert, values} = xTable(t);
    const log = [];
    assert.throws(() => db.tx(() => {
        insert('a');
        db.afterCommit(() => {
            log.push(1);
            throw new Error('first');
        });
        db.afterCommit(() => {
            log.push(2);
            throw new Error('second');
        });
        db.afterCommit(() => log.push(3));
    }), /first/);
    assert.deepEqual(log, [1, 2, 3]);
    assert.deepEqual(values(), ['a']);
    db.tx(() => insert('b'));
    assert.deepEqual(log, [1, 2, 3]);
});


test('tx: a transaction SQLite ended on its own is TxAborted, nothing of it stays, the handle works on', t => {
    const {db, insert, values} = xTable(t);
    let caught;
    assert.throws(() => db.tx(() => {
        insert('e');
        db.tx(() => {
            db.sql.exec('ROLLBACK');          // what SQLITE_FULL / SQLITE_IOERR do to the transaction
            throw new Error('disk full');
        });
        insert('f');
    }), e => {
        caught = e;
        return e instanceof TxAborted;
    });
    assert.match(caught.cause.message, /disk full/);
    assert.deepEqual(values(), []);
    db.tx(() => insert('g'));
    assert.deepEqual(values(), ['g']);

    // ended at the outermost level: fn returns normally, but nothing is left to commit
    assert.throws(() => db.tx(() => {
        insert('h');
        db.sql.exec('ROLLBACK');
    }), TxAborted);
    assert.deepEqual(values(), ['g']);
    assert.equal(db.sql.isTransaction, false);
});


test('tx: after a swallowed TxAborted, a nested tx neither starts nor commits a transaction of its own', t => {
    const {db, insert, values} = xTable(t);
    const log = [];
    assert.throws(() => db.tx(() => {
        insert('a');
        try {
            db.tx(() => {
                db.sql.exec('ROLLBACK');
                throw new Error('disk full');
            });
        } catch (e) {
            assert.ok(e instanceof TxAborted);
        }
        db.tx(() => {
            insert('after-abort-nested');
            db.afterCommit(() => log.push('nested'));
        });
    }), TxAborted);
    assert.deepEqual(values(), []);
    assert.deepEqual(log, []);
    assert.equal(db.sql.isTransaction, false);
    db.tx(() => insert('b'));
    assert.deepEqual(values(), ['b']);
});


test('migrate: the missing steps in one transaction; a failing step changes nothing; a newer database stops the start', () => {
    const version = sql => sql.prepare('PRAGMA user_version').get().user_version;
    const tables = sql => sql.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(r => r.name);

    const ok = new DatabaseSync(':memory:');
    assert.equal(migrate(ok, ['CREATE TABLE a (x TEXT) STRICT', 'CREATE TABLE b (x TEXT) STRICT']), 2);
    assert.equal(version(ok), 2);
    assert.deepEqual(tables(ok), ['a', 'b']);
    // nothing missing: nothing runs
    assert.equal(migrate(ok, ['CREATE TABLE a (x TEXT) STRICT', 'CREATE TABLE b (x TEXT) STRICT']), 2);
    // one step missing: only that one runs
    assert.equal(migrate(ok, ['CREATE TABLE a (x TEXT) STRICT', 'CREATE TABLE b (x TEXT) STRICT', 'CREATE TABLE c (x TEXT) STRICT']), 3);
    assert.deepEqual(tables(ok), ['a', 'b', 'c']);
    ok.close();

    const fresh = new DatabaseSync(':memory:');
    assert.throws(() => migrate(fresh, ['CREATE TABLE a (x TEXT) STRICT', 'CREATE TABLE b (']));
    assert.equal(version(fresh), 0);
    assert.deepEqual(tables(fresh), []);
    assert.equal(fresh.isTransaction, false);
    fresh.close();

    const newer = new DatabaseSync(':memory:');
    newer.exec('PRAGMA user_version = 3');
    assert.throws(() => migrate(newer, ['CREATE TABLE a (x TEXT) STRICT']),
        /paceline\.db has schema 3; this server knows up to 1/);
    assert.deepEqual(tables(newer), []);
    newer.close();
});


test('migrate: a step that changes data runs in the transaction, after its backup; a failing backup starts nothing; a new database needs none', () => {
    const version = sql => sql.prepare('PRAGMA user_version').get().user_version;
    const rowsOf = sql => sql.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'a'").get()
        ? sql.prepare('SELECT x FROM a').all().map(r => r.x) : [];
    let ran = [];
    const step = {
        backup: 'pre-x',
        run: (sql, ctx) => {
            ran.push({inTx: sql.isTransaction, ...ctx, log: typeof ctx.log});
            sql.exec('INSERT INTO a VALUES (\'1\')');
        },
    };
    const steps = ['CREATE TABLE a (x TEXT) STRICT', step];
    const at1 = () => {
        const sql = new DatabaseSync(':memory:');
        assert.equal(migrate(sql, steps.slice(0, 1)), 1);
        return sql;
    };
    const now = () => T('2026-11-21T08:00:00Z');

    // a new database: no backup, the step runs on the empty tables
    const fresh = new DatabaseSync(':memory:');
    const calls = [];
    assert.equal(migrate(fresh, steps, {backup: name => { calls.push(name); return {file: '/x', bytes: 1}; }, now, log: () => {}}), 2);
    assert.deepEqual(calls, []);
    assert.equal(version(fresh), 2);
    assert.deepEqual(rowsOf(fresh), ['1']);
    assert.deepEqual(ran, [{inTx: true, now: T('2026-11-21T08:00:00Z'), log: 'function'}]);
    fresh.close();

    // at version 1: the backup first, outside a transaction and before the row; then the step
    ran = [];
    const one = at1();
    const seen = [];
    const lines = [];
    assert.equal(migrate(one, steps, {
        backup: name => {
            seen.push({name, inTx: one.isTransaction, rows: rowsOf(one), version: version(one)});
            return {file: '/data/dumps/paceline-pre-x-2026-11-21.db', bytes: 12288};
        },
        now, log: l => lines.push(l),
    }), 2);
    assert.deepEqual(seen, [{name: 'pre-x', inTx: false, rows: [], version: 1}]);
    assert.deepEqual(lines, ['paceline-server: paceline.db: backup before schema 2: dumps/paceline-pre-x-2026-11-21.db (12288 bytes)']);
    assert.deepEqual(rowsOf(one), ['1']);
    assert.equal(version(one), 2);
    assert.equal(ran.length, 1);
    assert.equal(ran[0].inTx, true);
    // nothing missing: no backup again
    assert.equal(migrate(one, steps, {backup: () => assert.fail('no backup'), now, log: () => {}}), 2);
    one.close();

    // a backup that throws: nothing starts
    ran = [];
    const failing = at1();
    assert.throws(() => migrate(failing, steps, {backup: () => { throw new Error('disk full'); }, now, log: () => {}}), /disk full/);
    assert.equal(version(failing), 1);
    assert.deepEqual(rowsOf(failing), []);
    assert.equal(failing.isTransaction, false);
    assert.deepEqual(ran, []);
    failing.close();

    // no backup function: a pending step that changes data on a database with data stops the start
    const without = at1();
    assert.throws(() => migrate(without, steps), /paceline\.db: schema 2 needs a backup before it changes data/);
    assert.throws(() => migrate(without, steps, {log: () => {}}), /needs a backup/);
    assert.equal(version(without), 1);
    assert.deepEqual(rowsOf(without), []);
    without.close();

    // a run that throws: rolled back, still version 1
    const bad = at1();
    const badSteps = ['CREATE TABLE a (x TEXT) STRICT', {backup: 'pre-x', run: sql => {
        sql.exec('INSERT INTO a VALUES (\'1\')');
        throw new Error('bad club');
    }}];
    assert.throws(() => migrate(bad, badSteps, {backup: () => ({file: 'f', bytes: 0}), now, log: () => {}}), /bad club/);
    assert.equal(version(bad), 1);
    assert.deepEqual(rowsOf(bad), []);
    assert.equal(bad.isTransaction, false);
    bad.close();
});


test('migrate: a step whose run returns a promise is refused and rolled back', () => {
    const version = sql => sql.prepare('PRAGMA user_version').get().user_version;
    const sql = new DatabaseSync(':memory:');
    assert.equal(migrate(sql, ['CREATE TABLE a (x TEXT) STRICT']), 1);
    const steps = ['CREATE TABLE a (x TEXT) STRICT', {backup: 'pre-x', run: async s => {
        s.exec('INSERT INTO a VALUES (\'1\')');
    }}];
    assert.throws(() => migrate(sql, steps, {backup: () => ({file: 'f', bytes: 0}), now: () => 0, log: () => {}}),
        e => e instanceof TypeError && /schema 2: run must be synchronous/.test(e.message));
    assert.equal(version(sql), 1);
    assert.deepEqual(sql.prepare('SELECT x FROM a').all(), []);
    assert.equal(sql.isTransaction, false);
    sql.close();
});


// ---- schema 3: races (races spec §5) ----

const TRASHED = 'm4x2k7f3q9';
const MIGRATE_AT = T('2026-11-21T08:00:00Z');
const BACKUP = 'paceline-pre-races-2026-11-21.db';
const dumpClub = () => PRE_RACES.find(([n]) => n === 'dump')[1]();

// A paceline.db at schema 2 in a fresh data dir, holding the dump club (0.3 shape) as a clubs row
// and, under another id, as a trash row (both after `edit`); closed. {dir, file, json, trashJson}.
function schema2(t, edit = c => c) {
    const dir = tmpDir(t);
    const file = path.join(dir, 'paceline.db');
    const sql = new DatabaseSync(file);
    migrate(sql, MIGRATIONS.slice(0, 2));
    const json = JSON.stringify(edit(dumpClub()));
    const trashJson = JSON.stringify({...edit(dumpClub()), id: TRASHED});
    sql.prepare('INSERT INTO clubs (cid, json) VALUES (?, ?)').run('k7f3q9x2m4', json);
    sql.prepare(`INSERT INTO trash (cid, json, name, name_key, slugs, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(TRASHED, trashJson, 'Kettenfett RC', 'kettenfett rc', '["rollers"]', null, '2026-11-20T10:00:00.000Z');
    sql.close();
    return {dir, file, json, trashJson};
}

// user_version and the clubs and trash rows of a closed paceline.db (or a backup), read only.
function readRaw(file) {
    const sql = new DatabaseSync(file, {readOnly: true});
    try {
        return {
            version: sql.prepare('PRAGMA user_version').get().user_version,
            clubs: sql.prepare('SELECT cid, json FROM clubs ORDER BY cid').all().map(r => [r.cid, r.json]),
            trash: sql.prepare('SELECT cid, json FROM trash ORDER BY cid').all().map(r => [r.cid, r.json]),
        };
    } finally {
        sql.close();
    }
}

const rowsOf = db => ({
    clubs: db.sql.prepare('SELECT cid, json FROM clubs ORDER BY cid').all().map(r => [r.cid, r.json]),
    trash: db.sql.prepare('SELECT cid, json FROM trash ORDER BY cid').all().map(r => [r.cid, r.json]),
});


test('openDb: from schema 2 the backup comes first, then every club is converted', t => {
    const {dir, json, trashJson} = schema2(t);
    assert.equal(SCHEMA_VERSION, 4);
    assert.equal(MIGRATIONS[2].backup, 'pre-races');
    const lines = [];
    const db = openDb(dir, {now: () => MIGRATE_AT, log: l => lines.push(l)});
    const backup = path.join(dir, 'dumps', BACKUP);
    try {
        assert.equal(db.sql.prepare('PRAGMA user_version').get().user_version, 4);
        const {clubs, trash} = rowsOf(db);
        for (const [, text] of [...clubs, ...trash]) {
            const c = JSON.parse(text);
            assert.equal(typeof c.teams.rollers.races, 'object');
            assert.equal(Object.hasOwn(c.teams.rollers, 'live'), false);
        }
        assert.deepEqual(clubs.map(([cid]) => cid), ['k7f3q9x2m4']);
        assert.deepEqual(trash.map(([cid]) => cid), [TRASHED]);
        assert.equal(lines.length, 2, lines.join('\n'));
        assert.match(lines[0], new RegExp(`^paceline-server: paceline\\.db: backup before schema 3: dumps/${BACKUP.replaceAll('.', '\\.')} \\(\\d+ bytes\\)$`));
        assert.equal(lines[1], 'paceline-server: paceline.db: schema 3 (races): 1 clubs and 1 trashed clubs converted');
    } finally {
        db.close();
    }
    // the backup is the database before the step, byte for byte
    assert.deepEqual(readRaw(backup), {version: 2, clubs: [['k7f3q9x2m4', json]], trash: [[TRASHED, trashJson]]});
    // opened again: no second backup, nothing converted again
    const mtime = fs.statSync(backup).mtimeMs;
    const converted = readRaw(path.join(dir, 'paceline.db'));
    const again = [];
    openDb(dir, {now: () => MIGRATE_AT + 3600000, log: l => again.push(l)}).close();
    assert.deepEqual(again, []);
    assert.equal(fs.statSync(backup).mtimeMs, mtime);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'dumps')), [BACKUP]);
    assert.deepEqual(readRaw(path.join(dir, 'paceline.db')), converted);
});


test('openDb: when the backup cannot be written the database stays at schema 2 and the start fails', t => {
    const {dir, file, json, trashJson} = schema2(t);
    fs.writeFileSync(path.join(dir, 'dumps'), 'a file where the folder belongs');
    const lines = [];
    assert.throws(() => openDb(dir, {now: () => MIGRATE_AT, log: l => lines.push(l)}));
    assert.deepEqual(lines, []);
    assert.deepEqual(readRaw(file), {version: 2, clubs: [['k7f3q9x2m4', json]], trash: [[TRASHED, trashJson]]});
});


test('migrate: a failed step leaves schema 2 and the next start converts', t => {
    const {dir, file, json, trashJson} = schema2(t);
    const sql = new DatabaseSync(file);
    const steps = [...MIGRATIONS.slice(0, 2), {backup: 'pre-races', run() {
        throw new Error('killed');
    }}];
    assert.throws(() => migrate(sql, steps, {backup: name => writeBackup(sql, dir, name, MIGRATE_AT), now: () => MIGRATE_AT, log: () => {}}), /killed/);
    assert.equal(sql.prepare('PRAGMA user_version').get().user_version, 2);
    sql.close();
    assert.deepEqual(readRaw(file), {version: 2, clubs: [['k7f3q9x2m4', json]], trash: [[TRASHED, trashJson]]});
    const backup = path.join(dir, 'dumps', BACKUP);
    assert.ok(fs.existsSync(backup));
    // the next start writes the backup again (the same name: replaced) and converts
    const lines = [];
    const db = openDb(dir, {now: () => MIGRATE_AT, log: l => lines.push(l)});
    try {
        assert.equal(db.sql.prepare('PRAGMA user_version').get().user_version, 4);
        assert.equal(Object.hasOwn(JSON.parse(rowsOf(db).clubs[0][1]).teams.rollers, 'races'), true);
    } finally {
        db.close();
    }
    assert.match(lines[0], /backup before schema 3: dumps\/paceline-pre-races-2026-11-21\.db/);
    assert.equal(lines[1], 'paceline-server: paceline.db: schema 3 (races): 1 clubs and 1 trashed clubs converted');
    assert.deepEqual(fs.readdirSync(path.join(dir, 'dumps')), [BACKUP]);
    assert.deepEqual(readRaw(backup), {version: 2, clubs: [['k7f3q9x2m4', json]], trash: [[TRASHED, trashJson]]});
});


test('openDb: a new database is schema 4 without a backup', t => {
    const dir = tmpDir(t);
    const lines = [];
    const db = openDb(dir, {now: () => MIGRATE_AT, log: l => lines.push(l)});
    try {
        assert.equal(db.sql.prepare('PRAGMA user_version').get().user_version, 4);
    } finally {
        db.close();
    }
    assert.deepEqual(lines, []);
    assert.equal(fs.existsSync(path.join(dir, 'dumps')), false);
});


// ---- schema 4: one type per plan (team cockpit spec §4.2) ----

const PLAN_TYPES_BACKUP = 'paceline-pre-plan-types-2026-11-21.db';
const STEP4_LINE = 'paceline-server: paceline.db: schema 4 (plan types): 1 clubs and 1 trashed clubs changed';

const insertTrash = (sql, cid, json) => sql.prepare(
    'INSERT INTO trash (cid, json, name, name_key, slugs, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(cid, json, 'Kettenfett RC', 'kettenfett rc', '["rollers"]', null, '2026-11-20T10:00:00.000Z');

// A paceline.db at schema 3 in a fresh data dir, holding mixedTypes() as a clubs row and, under
// another id, as a trash row; closed. {dir, file, json, trashJson}.
function schema3(t) {
    const dir = tmpDir(t);
    const file = path.join(dir, 'paceline.db');
    const sql = new DatabaseSync(file);
    migrate(sql, MIGRATIONS.slice(0, 3));
    const json = JSON.stringify(mixedTypes());
    const trashJson = JSON.stringify({...mixedTypes(), id: TRASHED});
    sql.prepare('INSERT INTO clubs (cid, json) VALUES (?, ?)').run('k7f3q9x2m4', json);
    insertTrash(sql, TRASHED, trashJson);
    sql.close();
    return {dir, file, json, trashJson};
}


test('openDb: from schema 3 the pre-plan-types backup comes first, then every plan has one type', t => {
    const {dir, file, json, trashJson} = schema3(t);
    assert.equal(MIGRATIONS[3].backup, 'pre-plan-types');
    assert.equal(MIGRATIONS[3].run, planTypesStep);
    const lines = [];
    const db = openDb(dir, {now: () => MIGRATE_AT, log: l => lines.push(l)});
    const backup = path.join(dir, 'dumps', PLAN_TYPES_BACKUP);
    try {
        assert.equal(db.sql.prepare('PRAGMA user_version').get().user_version, 4);
        const {clubs, trash} = rowsOf(db);
        assert.deepEqual([clubs.map(([cid]) => cid), trash.map(([cid]) => cid)], [['k7f3q9x2m4'], [TRASHED]]);
        for (const [, text] of [...clubs, ...trash]) {
            assert.deepEqual(typesOf(JSON.parse(text)), ONE_TYPE);
        }
        assert.equal(lines.length, 2, lines.join('\n'));
        const bytes = fs.statSync(backup).size;
        assert.equal(lines[0], `paceline-server: paceline.db: backup before schema 4: dumps/${PLAN_TYPES_BACKUP} (${bytes} bytes)`);
        assert.equal(lines[1], STEP4_LINE);
    } finally {
        db.close();
    }
    // the backup is the database before the step, byte for byte
    assert.deepEqual(readRaw(backup), {version: 3, clubs: [['k7f3q9x2m4', json]], trash: [[TRASHED, trashJson]]});
    // opened again: no second backup, nothing changed again
    const mtime = fs.statSync(backup).mtimeMs;
    const changed = readRaw(file);
    const again = [];
    openDb(dir, {now: () => MIGRATE_AT + 3600000, log: l => again.push(l)}).close();
    assert.deepEqual(again, []);
    assert.equal(fs.statSync(backup).mtimeMs, mtime);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'dumps')), [PLAN_TYPES_BACKUP]);
    assert.deepEqual(readRaw(file), changed);
});


test('openDb: from schema 2 one start runs steps 3 and 4 behind the pre-races backup alone', t => {
    const {dir} = schema2(t, c => {
        c.sheets.a00002.type = 'fast';      // v1 of a plan whose v2 and v3 have none
        c.sheets.a00002.label = 'Rollers · fast';
        return c;
    });
    const lines = [];
    const db = openDb(dir, {now: () => MIGRATE_AT, log: l => lines.push(l)});
    try {
        assert.equal(db.sql.prepare('PRAGMA user_version').get().user_version, 4);
        const {clubs, trash} = rowsOf(db);
        for (const [, text] of [...clubs, ...trash]) {
            const {a00002, a00005} = JSON.parse(text).sheets;
            assert.deepEqual([a00002.type, a00002.label], [null, 'Rollers']);
            assert.deepEqual([a00005.type, a00005.label], ['slow', 'Rollers · slow']);
        }
    } finally {
        db.close();
    }
    assert.deepEqual(fs.readdirSync(path.join(dir, 'dumps')), [BACKUP]);
    assert.equal(lines.length, 3, lines.join('\n'));
    assert.match(lines[0], /^paceline-server: paceline\.db: backup before schema 3: dumps\/paceline-pre-races-2026-11-21\.db \(\d+ bytes\)$/);
    assert.equal(lines[1], 'paceline-server: paceline.db: schema 3 (races): 1 clubs and 1 trashed clubs converted');
    assert.equal(lines[2], STEP4_LINE);
});


test('openDb: when the pre-plan-types backup cannot be written the database stays at schema 3 and the start fails', t => {
    const {dir, file, json, trashJson} = schema3(t);
    fs.writeFileSync(path.join(dir, 'dumps'), 'a file where the folder belongs');
    const lines = [];
    assert.throws(() => openDb(dir, {now: () => MIGRATE_AT, log: l => lines.push(l)}));
    assert.deepEqual(lines, []);
    assert.deepEqual(readRaw(file), {version: 3, clubs: [['k7f3q9x2m4', json]], trash: [[TRASHED, trashJson]]});
});


test('planTypesStep: rewrites only the rows that change, in the caller\'s transaction, and skips what it cannot read', () => {
    const sql = new DatabaseSync(':memory:');
    migrate(sql, MIGRATIONS.slice(0, 3));
    // Cogs: one plan of two versions, both 'fast'
    const cogs = {name: 'Cogs', start: '19:30', live: null, version: 1, changedAt: '2026-11-10T10:00:00.000Z'};
    const ver = (n, at) => sheet({team: 'cogs', label: 'Cogs · fast', type: 'fast', date: '2026-11-19', riders: ['1007'],
        uploadedAt: at, plan: 'ca0001', n});
    const plain = JSON.stringify(club({id: 's9pk2m4q7d', teams: {cogs},
        sheets: {ca0001: ver(1, '2026-11-18T20:00:00.000Z'), ca0002: ver(2, '2026-11-19T10:00:00.000Z')}}));
    const mixed = JSON.stringify(mixedTypes());
    const trashed = JSON.stringify({...mixedTypes(), id: TRASHED});
    const put = sql.prepare('INSERT INTO clubs (cid, json) VALUES (?, ?)');
    put.run('k7f3q9x2m4', mixed);
    put.run('s9pk2m4q7d', plain);
    put.run('p2m8c4t1v9', 'not json');
    insertTrash(sql, TRASHED, trashed);
    insertTrash(sql, 'q7d2s9pk2m', '{');
    const read = () => ({
        clubs: Object.fromEntries(sql.prepare('SELECT cid, json FROM clubs').all().map(r => [r.cid, r.json])),
        trash: Object.fromEntries(sql.prepare('SELECT cid, json FROM trash').all().map(r => [r.cid, r.json])),
    });
    const before = read();
    const run = () => {
        const log = [], warn = [];
        const counts = planTypesStep(sql, {now: MIGRATE_AT, log: l => log.push(l), warn: w => warn.push(w)});
        return {counts, log, warn};
    };
    const WARN = [
        'paceline-server: paceline.db: schema 4 (plan types): clubs row p2m8c4t1v9 is not JSON; left as it is',
        'paceline-server: paceline.db: schema 4 (plan types): trash row q7d2s9pk2m is not JSON; left as it is',
    ];

    // in the caller's transaction: its rollback leaves every row as it was
    sql.exec('BEGIN');
    assert.deepEqual(run().counts, {clubs: 1, trashed: 1});
    sql.exec('ROLLBACK');
    assert.deepEqual(read(), before);

    sql.exec('BEGIN');
    const first = run();
    sql.exec('COMMIT');
    assert.deepEqual(first, {counts: {clubs: 1, trashed: 1}, log: [STEP4_LINE], warn: WARN});
    const after = read();
    assert.deepEqual(typesOf(JSON.parse(after.clubs.k7f3q9x2m4)), ONE_TYPE);
    assert.deepEqual(typesOf(JSON.parse(after.trash[TRASHED])), ONE_TYPE);
    assert.deepEqual([after.clubs.s9pk2m4q7d, after.clubs.p2m8c4t1v9, after.trash.q7d2s9pk2m], [plain, 'not json', '{']);
    // nothing but the plans' types and labels changed
    const strip = text => {
        const c = JSON.parse(text);
        for (const s of Object.values(c.sheets)) {
            delete s.type;
            delete s.label;
        }
        return c;
    };
    assert.deepEqual(strip(after.clubs.k7f3q9x2m4), strip(mixed));

    // a second call: nothing to change, no count line
    sql.exec('BEGIN');
    const second = run();
    sql.exec('COMMIT');
    assert.deepEqual(second, {counts: {clubs: 0, trashed: 0}, log: [], warn: WARN});
    assert.deepEqual(read(), after);
    sql.close();
});


test('waitForDb: tries every 5 s, logs every 30 s, gives up after 10 minutes', async () => {
    let t = 0, attempts = 0;
    const lines = [];
    const opts = {now: () => t, sleep: async ms => { t += ms; }, log: l => lines.push(l)};
    await assert.rejects(waitForDb('x', {...opts, open: () => { attempts++; throw new DbLocked('locked'); }}),
        /paceline\.db is still locked after 600 s; giving up/);
    assert.equal(attempts, 121);
    assert.equal(lines.length, 20);
    assert.equal(lines[0], 'paceline-server: paceline.db is locked by another process; waiting (0 s so far, giving up after 600 s)');
    assert.equal(lines[1], 'paceline-server: paceline.db is locked by another process; waiting (30 s so far, giving up after 600 s)');
    assert.equal(lines[19], 'paceline-server: paceline.db is locked by another process; waiting (570 s so far, giving up after 600 s)');

    // locked twice, then free: resolves to what open returned, one line
    t = 0;
    attempts = 0;
    lines.length = 0;
    const handle = {};
    const dirs = [];
    const got = await waitForDb('y', {...opts, open: dir => {
        dirs.push(dir);
        if (++attempts <= 2) {
            throw new DbLocked('locked');
        }
        return handle;
    }});
    assert.equal(got, handle);
    assert.equal(attempts, 3);
    assert.deepEqual(dirs, ['y', 'y', 'y']);
    assert.equal(t, 10000);
    assert.equal(lines.length, 1);

    // any other error rejects at once after 1 attempt
    t = 0;
    attempts = 0;
    lines.length = 0;
    await assert.rejects(waitForDb('z', {...opts, open: () => {
        attempts++;
        throw new Error('disk image is malformed');
    }}), /disk image is malformed/);
    assert.equal(attempts, 1);
    assert.equal(t, 0);
    assert.deepEqual(lines, []);
});


test('the server holds paceline.db from createServer until it closes', async t => {
    const dir = tmpDir(t);
    const log = console.log;
    console.log = () => {};
    let server;
    try {
        server = createServer({env: {DATA_DIR: dir}});
    } finally {
        console.log = log;
    }
    assert.equal(server.db.file, path.join(dir, 'paceline.db'));
    assert.throws(() => openDb(dir), DbLocked);
    await new Promise(r => server.close(() => r()));
    assert.equal(server.db.sql.isOpen, false);
    const after = openDb(dir);
    after.close();
});


test('createServer: a given db is used, and closed with the server', async t => {
    const dir = tmpDir(t);
    const db = openDb(dir);
    const log = console.log;
    console.log = () => {};
    let server;
    try {
        server = createServer({env: {DATA_DIR: dir}, db});
    } finally {
        console.log = log;
    }
    assert.equal(server.db, db);
    await new Promise(r => server.close(() => r()));
    assert.equal(db.sql.isOpen, false);
});


async function freePort() {
    const s = net.createServer();
    await new Promise(r => s.listen(0, '127.0.0.1', r));
    const {port} = s.address();
    await new Promise(r => s.close(r));
    return port;
}


test('a second server process on a held data dir waits on the lock and does not listen', async t => {
    const dir = tmpDir(t);
    const hold = openDb(dir);
    const port = await freePort();
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER],
        {env: {...process.env, DATA_DIR: dir, PORT: String(port)}});
    t.after(() => {
        child.kill();
        if (hold.sql.isOpen) {
            hold.close();
        }
    });
    let out = '';
    const waiting = /paceline\.db is locked by another process; waiting/;
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no lock line within 10 s:\n${out}`)), 10000);
        const onData = d => {
            out += d;
            if (waiting.test(out)) {
                clearTimeout(timer);
                resolve();
            }
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        child.on('exit', code => {
            clearTimeout(timer);
            reject(new Error(`the server exited (${code}):\n${out}`));
        });
    });
    assert.match(out, waiting);
    assert.doesNotMatch(out, /listening/);
    await assert.rejects(fetch(`http://127.0.0.1:${port}/healthz`));
});
