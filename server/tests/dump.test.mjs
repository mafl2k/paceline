// The nightly dump of paceline.db (dump.mjs): VACUUM INTO dumps/.paceline-<date>.db.tmp, renamed to
// paceline-<date>.db, the newest 7 kept; the job that writes one a night; a dump restored by hand.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {writeDump, pruneDumps, dumpDue, makeDumpJob, leftoverFolders, DUMP_KEEP, LEFTOVER_DAYS} from '../dump.mjs';
import {openDb, SCHEMA_VERSION} from '../db.mjs';
import {openStore} from '../store.mjs';
import {zonedToUtc} from '../time.mjs';
import {club} from './helpers.mjs';

const TZ = 'Europe/Berlin';
const CID = 'k7f3q9x2m4';
const berlin = (date, hhmm) => zonedToUtc(date, hhmm, TZ);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'paceline-dump-'));
const DB_URL = pathToFileURL(path.join(import.meta.dirname, '..', 'db.mjs'));


// Another process tries openDb on `dir` (an in-process second connection is refused by SQLite
// whatever the OS lock says; only another process sees whether the lock is still held).
function probeFromChild(dir) {
    const child = `
import {openDb, DbLocked} from ${JSON.stringify(DB_URL.href)};
try {
    openDb(process.env.DB_DIR).close();
    console.log('opened');
} catch (e) {
    console.log(e instanceof DbLocked ? 'locked' : 'other: ' + e.message);
}
`;
    return execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', child],
        {encoding: 'utf8', env: {...process.env, DB_DIR: dir}}).trim();
}


// paceline.db in a temp dir holding one club; closed and removed after the test.
function setup(t) {
    const dir = tmp();
    const db = openDb(dir);
    t.after(() => {
        if (db.sql.isOpen) {
            db.close();
        }
        fs.rmSync(dir, {recursive: true, force: true});
    });
    const store = openStore({db, now: () => berlin('2026-11-16', '03:10')});
    store.create(club({id: CID, name: 'Kettenfett RC'}));
    return {dir, db, store};
}


test('writeDump: dumps/paceline-<local date>.db through a dot temp file; a copy that opens with the data', t => {
    const {dir, db} = setup(t);
    const {file, bytes} = writeDump(db, dir, {now: berlin('2026-11-16', '03:10'), tz: TZ});
    assert.equal(file, path.join(dir, 'dumps', 'paceline-2026-11-16.db'));
    assert.deepEqual(fs.readdirSync(path.join(dir, 'dumps')), ['paceline-2026-11-16.db']);
    assert.equal(fs.statSync(file).mode & 0o777, 0o640);
    assert.equal(fs.statSync(path.join(dir, 'dumps')).mode & 0o777, 0o750);
    assert.equal(bytes, fs.statSync(file).size);
    const copy = new DatabaseSync(file, {readOnly: true});
    try {
        assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM clubs').get().n, 1);
        assert.equal(copy.prepare('SELECT cid FROM clubs').get().cid, CID);
        assert.equal(copy.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
        assert.equal(SCHEMA_VERSION, 2);
        assert.equal(copy.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
    } finally {
        copy.close();
    }
    // the server's connection still holds the lock on paceline.db: another process is refused
    assert.equal(probeFromChild(dir), 'locked');
});


test('writeDump replaces a leftover temp file (and its journal) of the same day', t => {
    const {dir, db} = setup(t);
    fs.mkdirSync(path.join(dir, 'dumps'));
    const left = path.join(dir, 'dumps', '.paceline-2026-11-16.db.tmp');
    fs.writeFileSync(left, 'half a dump from a crash');
    fs.writeFileSync(left + '-journal', 'its journal');
    const {file} = writeDump(db, dir, {now: berlin('2026-11-16', '03:10'), tz: TZ});
    assert.deepEqual(fs.readdirSync(path.join(dir, 'dumps')), ['paceline-2026-11-16.db']);
    const copy = new DatabaseSync(file, {readOnly: true});
    try {
        assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM clubs').get().n, 1);
    } finally {
        copy.close();
    }
    // a dump of the same day is replaced too
    writeDump(db, dir, {now: berlin('2026-11-16', '23:50'), tz: TZ});
    assert.deepEqual(fs.readdirSync(path.join(dir, 'dumps')), ['paceline-2026-11-16.db']);
});


test('pruneDumps keeps the newest 7 and removes temp files and their journals older than a day', () => {
    const dir = tmp();
    try {
        assert.equal(DUMP_KEEP, 7);
        const now = berlin('2026-11-16', '03:10');
        assert.equal(pruneDumps(dir, now), 0, 'no dumps/ yet');
        const dumps = path.join(dir, 'dumps');
        fs.mkdirSync(dumps);
        const dates = ['2026-11-08', '2026-11-07', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-16'];
        for (const d of dates) {
            fs.writeFileSync(path.join(dumps, `paceline-${d}.db`), d);
        }
        fs.writeFileSync(path.join(dumps, 'notes.txt'), 'not a dump: left alone');
        const stale = path.join(dumps, '.paceline-2026-11-14.db.tmp');
        const fresh = path.join(dumps, '.paceline-2026-11-16.db.tmp');
        for (const f of [stale, fresh, stale + '-journal', fresh + '-journal']) {
            fs.writeFileSync(f, 'x');
            const at = f.startsWith(stale) ? now - 2 * 864e5 : now - 3600e3;
            fs.utimesSync(f, new Date(at), new Date(at));
        }
        assert.equal(pruneDumps(dir, now), 2);
        assert.deepEqual(fs.readdirSync(dumps).sort(), [
            '.paceline-2026-11-16.db.tmp', '.paceline-2026-11-16.db.tmp-journal', 'notes.txt',
            'paceline-2026-11-09.db', 'paceline-2026-11-10.db', 'paceline-2026-11-11.db', 'paceline-2026-11-12.db',
            'paceline-2026-11-13.db', 'paceline-2026-11-14.db', 'paceline-2026-11-16.db',
        ]);
        assert.equal(pruneDumps(dir, now), 0);
        // a file named dumps: nothing to prune
        const other = tmp();
        fs.writeFileSync(path.join(other, 'dumps'), 'in the way');
        assert.equal(pruneDumps(other, now), 0);
        fs.rmSync(other, {recursive: true, force: true});
    } finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
});


test('dumpDue: from 03:00 local, once a day', t => {
    const {dir, db} = setup(t);
    assert.equal(dumpDue(dir, berlin('2026-11-16', '02:59'), TZ), false);
    assert.equal(dumpDue(dir, berlin('2026-11-16', '03:00'), TZ), true);
    assert.equal(dumpDue(dir, berlin('2026-11-16', '23:59'), TZ), true);
    writeDump(db, dir, {now: berlin('2026-11-16', '03:00'), tz: TZ});
    assert.equal(dumpDue(dir, berlin('2026-11-16', '03:10'), TZ), false);
    assert.equal(dumpDue(dir, berlin('2026-11-16', '23:59'), TZ), false);
    assert.equal(dumpDue(dir, berlin('2026-11-17', '02:59'), TZ), false);
    assert.equal(dumpDue(dir, berlin('2026-11-17', '03:00'), TZ), true);
});


test('the dump job: one a night; a failure is logged, kept for the admin page and retried after an hour; overdue once a day from 06:00', t => {
    const {dir, db} = setup(t);
    const clock = {now: berlin('2026-11-16', '02:50')};
    const lines = [];
    const job = makeDumpJob(db, dir, {now: () => clock.now, tz: TZ, log: m => lines.push(['log', m]), error: m => lines.push(['error', m])});
    const take = () => lines.splice(0);
    const blocker = path.join(dir, 'dumps');

    assert.equal(job.tick(), false, 'not due before 03:00');
    assert.deepEqual(job.status().last, null);
    assert.equal(job.status().error, null);
    assert.equal(job.status().dbBytes, db.bytes());
    assert.ok(job.status().dbBytes > 0);
    assert.deepEqual(take(), []);

    // a plain file named dumps: the folder cannot be made
    fs.writeFileSync(blocker, 'in the way');
    clock.now = berlin('2026-11-16', '03:10');
    assert.equal(job.tick(), false);
    const failed = take();
    assert.equal(failed.length, 1);
    assert.equal(failed[0][0], 'error');
    assert.match(failed[0][1], /^paceline-server: dump: EEXIST/);
    const error = job.status().error;
    assert.equal(error.at, new Date(berlin('2026-11-16', '03:10')).toISOString());
    assert.match(error.message, /EEXIST/);
    assert.deepEqual(JSON.parse(db.meta('dump_error')), error);
    assert.equal(job.status().last, null);

    // within the hour: no new try, nothing logged
    clock.now = berlin('2026-11-16', '04:09');
    fs.rmSync(blocker);
    assert.equal(job.tick(), false);
    assert.deepEqual(take(), []);
    assert.equal(fs.existsSync(blocker), false);

    // an hour after the failure: it works, the error goes
    clock.now = berlin('2026-11-16', '04:10');
    assert.equal(job.tick(), true);
    const file = path.join(dir, 'dumps', 'paceline-2026-11-16.db');
    const size = fs.statSync(file).size;
    assert.deepEqual(take(), [['log', `paceline-server: dump written: dumps/paceline-2026-11-16.db (${size} bytes)`]]);
    assert.deepEqual(job.status().last, {date: '2026-11-16', file: 'dumps/paceline-2026-11-16.db', bytes: size,
        at: new Date(berlin('2026-11-16', '04:10')).toISOString()});
    assert.equal(job.status().error, null);
    assert.equal(db.meta('dump_error'), null);
    assert.deepEqual(JSON.parse(db.meta('dump_last')), job.status().last);

    // one a night
    clock.now = berlin('2026-11-16', '23:50');
    assert.equal(job.tick(), false);
    assert.deepEqual(take(), []);

    // the next day: a failure before 06:00 is not overdue yet; from 06:00 it is, once a day
    fs.rmSync(blocker, {recursive: true});
    fs.writeFileSync(blocker, 'in the way');
    clock.now = berlin('2026-11-17', '05:30');
    assert.equal(job.tick(), false);
    assert.deepEqual(take().map(([k]) => k), ['error']);
    clock.now = berlin('2026-11-17', '06:00');
    assert.equal(job.tick(), false);
    assert.deepEqual(take(), [['error', 'paceline-server: dump overdue: no dumps/paceline-2026-11-17.db yet (due from 03:00)']]);
    clock.now = berlin('2026-11-17', '06:30');
    assert.equal(job.tick(), false);
    assert.deepEqual(take(), [['error', `paceline-server: dump: ${job.status().error.message}`]], 'retried, overdue not again');
    assert.equal(job.status().error.at, new Date(berlin('2026-11-17', '06:30')).toISOString());
    // the last good dump stays on record next to the failure
    assert.equal(job.status().last.date, '2026-11-16');
    clock.now = berlin('2026-11-18', '06:00');
    assert.equal(job.tick(), false);
    const both = take();
    assert.deepEqual(both.map(([k]) => k), ['error', 'error']);
    assert.match(both[0][1], /^paceline-server: dump: EEXIST/);
    assert.equal(both[1][1], 'paceline-server: dump overdue: no dumps/paceline-2026-11-18.db yet (due from 03:00)');
});


test('the dump job deletes dumps beyond the newest 7 after a dump and never throws', t => {
    const {dir, db} = setup(t);
    const dumps = path.join(dir, 'dumps');
    fs.mkdirSync(dumps);
    for (let d = 7; d <= 15; d++) {
        fs.writeFileSync(path.join(dumps, `paceline-2026-11-${String(d).padStart(2, '0')}.db`), 'old');
    }
    const lines = [];
    const job = makeDumpJob(db, dir, {now: () => berlin('2026-11-16', '03:10'), tz: TZ, log: m => lines.push(m), error: m => lines.push(m)});
    assert.equal(job.tick(), true);
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^paceline-server: dump written: dumps\/paceline-2026-11-16\.db \(\d+ bytes\)$/);
    assert.equal(lines[1], 'paceline-server: 3 dumps beyond the newest 7 deleted');
    assert.equal(fs.readdirSync(dumps).length, 7);
    // a closed database: the tick logs and answers false
    db.close();
    const late = makeDumpJob(db, dir, {now: () => berlin('2026-11-17', '06:10'), tz: TZ, log: m => lines.push(m), error: m => lines.push(m)});
    lines.length = 0;
    assert.equal(late.tick(), false);
    assert.ok(lines.length >= 1);
    assert.ok(lines.every(m => m.startsWith('paceline-server: dump')), lines.join('\n'));
});


test('the dump job: a prune failure after a good dump is logged on its own and does not mark the dump failed', t => {
    const {dir, db} = setup(t);
    const dumps = path.join(dir, 'dumps');
    fs.mkdirSync(dumps);
    for (let d = 7; d <= 13; d++) {
        fs.writeFileSync(path.join(dumps, `paceline-2026-11-${String(d).padStart(2, '0')}.db`), 'old');
    }
    // the oldest "dump" is a folder: rmSync without recursive refuses it
    fs.mkdirSync(path.join(dumps, 'paceline-2026-11-06.db'));
    const lines = [];
    const job = makeDumpJob(db, dir, {now: () => berlin('2026-11-16', '03:10'), tz: TZ, log: m => lines.push(['log', m]), error: m => lines.push(['error', m])});
    assert.equal(job.tick(), true);
    assert.equal(lines.length, 2, JSON.stringify(lines));
    assert.equal(lines[0][0], 'log');
    assert.match(lines[0][1], /^paceline-server: dump written: dumps\/paceline-2026-11-16\.db \(\d+ bytes\)$/);
    assert.equal(lines[1][0], 'error');
    assert.match(lines[1][1], /^paceline-server: dump written, but old dumps not pruned: /);
    assert.equal(job.status().last.date, '2026-11-16');
    assert.equal(job.status().error, null);
    assert.equal(db.meta('dump_error'), null);
    assert.ok(fs.existsSync(path.join(dumps, 'paceline-2026-11-16.db')));
    // not due again that night: no retry, nothing logged
    lines.length = 0;
    assert.equal(job.tick(), false);
    assert.deepEqual(lines, []);
});


test('the dump job truncates paceline.db-wal to 0 bytes after a good dump; a checkpoint failure is logged only', t => {
    const {dir, db, store} = setup(t);
    const wal = path.join(dir, 'paceline.db-wal');
    store.change(CID, c => {
        c.name = 'Kettenfett RC 2';
    });
    assert.ok(fs.statSync(wal).size > 0, 'the writes sit in the -wal');
    const lines = [];
    const job = makeDumpJob(db, dir, {now: () => berlin('2026-11-16', '03:10'), tz: TZ, log: m => lines.push(['log', m]), error: m => lines.push(['error', m])});
    assert.equal(job.tick(), true);
    assert.equal(fs.statSync(wal).size, 0);
    assert.deepEqual(lines.map(([k]) => k), ['log']);
    // the data is all in paceline.db and still read through the connection
    assert.equal(store.get(CID).name, 'Kettenfett RC 2');
    assert.equal(job.status().last.date, '2026-11-16');

    // the next night the checkpoint is refused: logged, the dump stands
    store.change(CID, c => {
        c.name = 'Kettenfett RC 3';
    });
    const sql = db.sql;
    const refusing = {...db, sql: new Proxy(sql, {
        get(target, key) {
            if (key === 'prepare') {
                return q => {
                    if (/wal_checkpoint/.test(q)) {
                        throw new Error('checkpoint refused');
                    }
                    return target.prepare(q);
                };
            }
            const v = target[key];
            return typeof v === 'function' ? v.bind(target) : v;
        },
    })};
    lines.length = 0;
    const next = makeDumpJob(refusing, dir, {now: () => berlin('2026-11-17', '03:10'), tz: TZ, log: m => lines.push(['log', m]), error: m => lines.push(['error', m])});
    assert.equal(next.tick(), true);
    assert.equal(lines.length, 2, JSON.stringify(lines));
    assert.equal(lines[0][0], 'log');
    assert.match(lines[0][1], /^paceline-server: dump written: dumps\/paceline-2026-11-17\.db /);
    assert.deepEqual(lines[1], ['error', 'paceline-server: dump written, but paceline.db-wal not truncated: checkpoint refused']);
    assert.equal(next.status().last.date, '2026-11-17');
    assert.equal(next.status().error, null);
    assert.ok(fs.statSync(wal).size > 0);
});


test('a dump restored over paceline.db: the server starts on it; reconcile drops rows of missing files and indexes files the dump does not know', async () => {
    const {createServer} = await import('../server.mjs');
    const dir = tmp();
    const now = () => berlin('2026-11-16', '03:10');
    const log = console.log;
    console.log = () => {};
    try {
        const first = createServer({env: {DATA_DIR: dir}, now});
        first.store.create(club({id: CID, name: 'Kettenfett RC'}));
        const A = `${now() - 3600e3}-1001.jsonl.gz`;
        const B = `${now() - 1800e3}-1002.jsonl.gz`;
        first.logs.put(CID, 'rollers', A, Buffer.from('recording A'));
        const {file} = writeDump(first.db, dir, {now: now(), tz: TZ});
        first.logs.put(CID, 'rollers', B, Buffer.from('recording B'));
        assert.deepEqual(first.logs.list(CID).map(r => r.file).sort(), [A, B].sort());
        await new Promise(r => {
            first.once('close', r);
            first.close();
        });
        assert.equal(first.db.sql.isOpen, false);

        // by hand: the dump over paceline.db, the old -wal gone, blob A lost
        fs.copyFileSync(file, path.join(dir, 'paceline.db'));
        fs.rmSync(path.join(dir, 'paceline.db-wal'), {force: true});
        fs.rmSync(path.join(dir, 'logs', CID, 'rollers', A));

        const second = createServer({env: {DATA_DIR: dir}, now});
        try {
            assert.equal(second.store.get(CID)?.name, 'Kettenfett RC');
            assert.deepEqual(second.logs.list(CID).map(r => r.file), [B]);
            assert.equal(second.db.meta('imported_at'), null);
            assert.equal(second.db.sql.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
        } finally {
            await new Promise(r => {
                second.once('close', r);
                second.close();
            });
        }
    } finally {
        console.log = log;
        fs.rmSync(dir, {recursive: true, force: true});
    }
});


test('folders an import or a restore left at the top of DATA_DIR are named at every start until deleted', async () => {
    const {createServer} = await import('../server.mjs');
    const dir = tmp();
    const now = () => berlin('2026-11-18', '12:00');
    try {
        assert.equal(LEFTOVER_DAYS, 7);
        assert.deepEqual(leftoverFolders(path.join(dir, 'nothing-here')), []);
        for (const d of ['imported-2026-11-16', 'imported-2026-11-16-2', 'before-restore-2026-11-17-0930',
            'imported-notes', 'logs/imported-2026-11-14', 'dumps']) {
            fs.mkdirSync(path.join(dir, d), {recursive: true});
        }
        fs.writeFileSync(path.join(dir, 'imported-2026-11-15'), 'a file, not a folder');
        assert.deepEqual(leftoverFolders(dir), [
            {name: 'before-restore-2026-11-17-0930', date: '2026-11-17'},
            {name: 'imported-2026-11-16', date: '2026-11-16'},
            {name: 'imported-2026-11-16-2', date: '2026-11-16'},
        ]);

        const start = () => {
            const warned = [];
            const {log, warn} = console;
            console.log = () => {};
            console.warn = (...a) => warned.push(a.join(' '));
            try {
                return {server: createServer({env: {DATA_DIR: dir}, now}), warned};
            } finally {
                console.log = log;
                console.warn = warn;
            }
        };
        const stop = server => new Promise(r => {
            server.once('close', r);
            server.close();
        });
        const first = start();
        await stop(first.server);
        assert.deepEqual(first.warned, [
            'paceline-server: before-restore-2026-11-17-0930/ is still in the data dir; delete it by hand within 7 days of 2026-11-17 (see server/README.md)',
            'paceline-server: imported-2026-11-16/ is still in the data dir; delete it by hand within 7 days of 2026-11-16 (see server/README.md)',
            'paceline-server: imported-2026-11-16-2/ is still in the data dir; delete it by hand within 7 days of 2026-11-16 (see server/README.md)',
        ]);
        // deleted by hand: the next start is quiet
        for (const d of ['imported-2026-11-16', 'imported-2026-11-16-2', 'before-restore-2026-11-17-0930']) {
            fs.rmSync(path.join(dir, d), {recursive: true});
        }
        const second = start();
        await stop(second.server);
        assert.deepEqual(second.warned, []);
    } finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
});
