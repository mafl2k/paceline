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
import {openDb, waitForDb, migrate, DbLocked, TxAborted} from '../db.mjs';
import {createServer} from '../server.mjs';
import {openStore} from '../store.mjs';
import {T, club} from './helpers.mjs';

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


test('openDb: the pragmas, schema 1, a write before it returns, no -shm', t => {
    const dir = tmpDir(t);
    const db = openDb(dir, {now: () => T('2026-11-19T12:00Z')});
    const one = sql => ({...db.sql.prepare(sql).get()});
    assert.deepEqual(one('PRAGMA locking_mode'), {locking_mode: 'exclusive'});
    assert.deepEqual(one('PRAGMA journal_mode'), {journal_mode: 'wal'});
    assert.deepEqual(one('PRAGMA synchronous'), {synchronous: 2});
    assert.deepEqual(one('PRAGMA foreign_keys'), {foreign_keys: 1});
    assert.deepEqual(one('PRAGMA secure_delete'), {secure_delete: 1});
    assert.deepEqual(one('PRAGMA user_version'), {user_version: 1});
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
