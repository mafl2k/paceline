// paceline.db: the server's one SQLite file in DATA_DIR (node:sqlite, synchronous).
//
// Opened with an exclusive lock before the port opens: locking_mode EXCLUSIVE, then WAL (the WAL
// index stays in heap memory, no -shm on CephFS), synchronous FULL, foreign keys on, secure_delete
// on (deleted rows are overwritten with zeros, so erased data does not stay readable in free pages);
// then the migrations and a write (meta opened_at), which takes the lock for the life of the
// connection. paceline.db and its -wal are chmod'ed 0640 by path after that write.
// Any second connection, in this process or another, gets SQLITE_BUSY at once: openDb turns that
// into DbLocked, and waitForDb retries at start until the other holder is gone.
//
// Nothing in this process may open paceline.db or its -wal/-shm/-journal through fs (a backup, a
// copy, a hash): closing any descriptor on the file drops all of the process's POSIX locks on it,
// and another process could then open and write it. Only stat it, or go through SQL.
//
// Schema version in PRAGMA user_version; MIGRATIONS[i] takes version i to i + 1, all missing steps
// in one transaction at start (a step that changes data after a backup of the database: migrate).
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {writeBackup} from './dump.mjs';
import {racesStep} from './migrate-races.mjs';
import {planTypesStep} from './migrate-plan-types.mjs';

export const DB_FILE = 'paceline.db';

// Times in *_at TEXT columns are ISO strings, in INTEGER columns epoch ms. trash.slugs and
// archive.past_sigs are JSON arrays, settings.value is JSON, archive.version is the archived
// version's JSON and archive.bytes its UTF-8 length.
export const MIGRATIONS = [
    `CREATE TABLE meta (name TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE settings (name TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE clubs (cid TEXT PRIMARY KEY, json TEXT NOT NULL) STRICT;
CREATE TABLE trash (cid TEXT PRIMARY KEY, json TEXT NOT NULL, name TEXT NOT NULL, name_key TEXT NOT NULL,
  slugs TEXT NOT NULL, created_at TEXT, deleted_at TEXT NOT NULL) STRICT;
CREATE TABLE tombstone_clubs (cid TEXT PRIMARY KEY, deleted_at TEXT NOT NULL) STRICT;
CREATE TABLE retired_slugs (slug TEXT PRIMARY KEY) STRICT;
CREATE TABLE seen (cid TEXT NOT NULL, athlete TEXT NOT NULL, sig TEXT, mod TEXT, sheet TEXT,
  in_event INTEGER NOT NULL, event INTEGER, at TEXT NOT NULL, PRIMARY KEY (cid, athlete)) STRICT;
CREATE TABLE recordings (cid TEXT NOT NULL, slug TEXT NOT NULL, name TEXT NOT NULL, session INTEGER NOT NULL,
  athlete TEXT NOT NULL, bytes INTEGER NOT NULL, stored_at INTEGER NOT NULL, PRIMARY KEY (cid, slug, name)) STRICT;
CREATE INDEX recordings_session ON recordings (session);
CREATE TABLE recording_sigs (cid TEXT NOT NULL, slug TEXT NOT NULL, name TEXT NOT NULL, sig TEXT NOT NULL,
  PRIMARY KEY (cid, slug, name, sig),
  FOREIGN KEY (cid, slug, name) REFERENCES recordings (cid, slug, name) ON DELETE CASCADE) STRICT;
CREATE INDEX recording_sigs_team ON recording_sigs (cid, slug, sig);
CREATE TABLE archive (cid TEXT NOT NULL, slug TEXT NOT NULL, id TEXT NOT NULL, plan TEXT, n INTEGER, sig TEXT,
  rec_sig TEXT, past_sigs TEXT NOT NULL, label TEXT, type TEXT, date TEXT, version TEXT NOT NULL,
  bytes INTEGER NOT NULL, archived_at INTEGER NOT NULL, PRIMARY KEY (cid, slug, id)) STRICT;`,
    // 2 (Remove a rider, 19 Nov 2026): the file's mtime (epoch ms) when its row was last written, so
    // the reconcile knows a restored older copy by its time as well as by its size. Rows from
    // before are filled in by the next reconcile.
    `ALTER TABLE recordings ADD COLUMN mtime INTEGER;`,
    // 3 (races, 20 Nov 2026): every club in clubs and trash converted from the 0.3 shape (the team's
    // live pointer and race starts, the event fields on the versions) to races (migrate-races.mjs),
    // after a backup of the database (dumps/paceline-pre-races-<date>.db).
    {backup: 'pre-races', run: racesStep},
    // 4 (plan types, 21 Nov 2026): in every club in clubs and trash every version of a plan takes the
    // type of the plan's highest version, and its label (migrate-plan-types.mjs), after a backup of
    // the database (dumps/paceline-pre-plan-types-<date>.db; from schema 2, the pre-races backup
    // covers both steps).
    {backup: 'pre-plan-types', run: planTypesStep},
];

export const SCHEMA_VERSION = MIGRATIONS.length;


// Another connection holds paceline.db.
export class DbLocked extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = 'DbLocked';
    }
}


// SQLite ended the transaction itself (SQLITE_FULL, SQLITE_IOERR …): nothing of it is committed.
export class TxAborted extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = 'TxAborted';
    }
}


const isLocked = e => [5, 6].includes(e?.errcode & 0xff);   // SQLITE_BUSY, SQLITE_LOCKED

const isThenable = v => v !== null && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function';


// Runs the missing steps in one transaction; returns the new user_version. A database newer
// than the steps stops the start. A step is an SQL string, or {backup, run(sql, {now, log})} for a
// step that changes data: on a database that has data (version >= 1), `backup(step.backup)` (dump.mjs
// writeBackup, {file, bytes}) runs first, before the transaction and only for the first such step;
// a backup that throws, or none given, starts nothing. `run` goes in the transaction, after the
// steps before it; a `run` that returns a promise is refused (rolled back). A new database needs no
// backup.
export function migrate(sql, steps = MIGRATIONS, {backup = null, now = Date.now, log = console.log} = {}) {
    const v = sql.prepare('PRAGMA user_version').get().user_version;
    if (v > steps.length) {
        throw new Error(`paceline.db has schema ${v}; this server knows up to ${steps.length}`);
    }
    if (v === steps.length) {
        return v;
    }
    const first = v >= 1 ? steps.findIndex((step, i) => i >= v && typeof step === 'object' && step !== null && step.backup) : -1;
    if (first !== -1) {
        if (typeof backup !== 'function') {
            throw new Error(`paceline.db: schema ${first + 1} needs a backup before it changes data`);
        }
        const {file, bytes} = backup(steps[first].backup);
        log(`paceline-server: paceline.db: backup before schema ${first + 1}: dumps/${path.basename(file)} (${bytes} bytes)`);
    }
    sql.exec('BEGIN IMMEDIATE');
    try {
        for (let i = v; i < steps.length; i++) {
            if (typeof steps[i] === 'string') {
                sql.exec(steps[i]);
            } else if (isThenable(steps[i].run(sql, {now: now(), log}))) {
                // its writes would land after the COMMIT, outside the transaction
                throw new TypeError(`paceline.db: schema ${i + 1}: run must be synchronous`);
            }
            sql.exec(`PRAGMA user_version = ${i + 1}`);
        }
        sql.exec('COMMIT');
    } catch (e) {
        if (sql.isTransaction) {
            sql.exec('ROLLBACK');
        }
        throw e;
    }
    return steps.length;
}


// The handle around an open connection: tx, afterCommit, meta, bytes, close.
function makeDb(file, sql) {
    let depth = 0;
    let queue = [];   // afterCommit callbacks of the open transaction

    // Runs fn in a transaction (a savepoint when nested) and returns its result. A throw rolls
    // back what fn did and drops the afterCommit callbacks queued since. When SQLite ended the
    // transaction on its own, the throw is TxAborted. Callbacks run after the outermost COMMIT.
    // Never catch a TxAborted or a SQLite error inside db.tx and keep writing: once SQLite has
    // ended the transaction, a plain statement autocommits. (Catching an ordinary error of a nested
    // db.tx is fine: its savepoint is rolled back and the outer transaction goes on.)
    function tx(fn) {
        if (depth > 0) {
            return nested(fn);
        }
        sql.exec('BEGIN IMMEDIATE');
        depth = 1;
        let result;
        try {
            result = fn();
            if (isThenable(result)) {
                throw new TypeError('db.tx: fn must be synchronous');
            }
            if (!sql.isTransaction) {
                throw new TxAborted('paceline.db: the transaction was ended by SQLite');
            }
            sql.exec('COMMIT');
        } catch (e) {
            queue = [];
            try {
                sql.exec('ROLLBACK');
            } catch (r) {
                if (sql.isTransaction) {
                    throw r;
                }
            }
            throw e;
        } finally {
            depth = 0;
        }
        const callbacks = queue;
        queue = [];
        let failed = null;
        for (const cb of callbacks) {
            try {
                cb();
            } catch (e) {
                failed ??= {e};
            }
        }
        if (failed) {
            throw failed.e;
        }
        return result;
    }

    function nested(fn) {
        if (!sql.isTransaction) {
            // SAVEPOINT would start a new transaction of its own and RELEASE commit it
            throw new TxAborted('paceline.db: the transaction was ended by SQLite');
        }
        const n = depth;
        const mark = queue.length;
        sql.exec(`SAVEPOINT sp${n}`);
        depth = n + 1;
        try {
            const result = fn();
            if (isThenable(result)) {
                throw new TypeError('db.tx: fn must be synchronous');
            }
            sql.exec(`RELEASE sp${n}`);
            return result;
        } catch (e) {
            queue.length = mark;
            let aborted = !sql.isTransaction;
            if (!aborted) {
                try {
                    sql.exec(`ROLLBACK TO sp${n}`);
                    sql.exec(`RELEASE sp${n}`);
                } catch {
                    aborted = true;
                }
            }
            if (aborted && !(e instanceof TxAborted)) {
                throw new TxAborted('paceline.db: the transaction was ended by SQLite', {cause: e});
            }
            throw e;
        } finally {
            depth = n;
        }
    }

    return {
        file,
        sql,
        tx,
        // cb runs after the outermost transaction commits, or at once outside a transaction
        afterCommit(cb) {
            if (depth === 0) {
                cb();
            } else {
                queue.push(cb);
            }
        },
        meta(name) {
            return sql.prepare('SELECT value FROM meta WHERE name = ?').get(name)?.value ?? null;
        },
        setMeta(name, value) {
            tx(() => sql.prepare('INSERT INTO meta (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value')
                .run(name, value));
        },
        bytes() {
            return sql.prepare('SELECT page_count * page_size AS n FROM pragma_page_count(), pragma_page_size()').get().n;
        },
        close() {
            sql.close();
        },
    };
}


// Opens DATA_DIR/paceline.db, migrated and locked. DbLocked when another connection holds it. A
// step that changes data writes its backup first (dump.mjs writeBackup, dated by `now`); `log` gets
// the migration's lines.
export function openDb(dataDir, {now = Date.now, log = console.log} = {}) {
    fs.mkdirSync(dataDir, {recursive: true});
    const file = path.join(dataDir, DB_FILE);
    const sql = new DatabaseSync(file);
    try {
        const locking = sql.prepare('PRAGMA locking_mode = EXCLUSIVE').get().locking_mode;
        if (locking !== 'exclusive') {
            throw new Error(`paceline.db: locking_mode is ${locking}, not exclusive`);
        }
        const journal = sql.prepare('PRAGMA journal_mode = WAL').get().journal_mode;
        if (journal !== 'wal') {
            throw new Error(`paceline.db: journal_mode is ${journal}, not wal`);
        }
        sql.exec('PRAGMA synchronous = FULL');
        sql.exec('PRAGMA foreign_keys = ON');
        sql.exec('PRAGMA secure_delete = ON');
        migrate(sql, MIGRATIONS, {backup: name => writeBackup(sql, dataDir, name, now()), now, log});
        const db = makeDb(file, sql);
        db.setMeta('opened_at', new Date(now()).toISOString());
        // by path: chmod opens no descriptor on the files (see above)
        for (const f of [file, file + '-wal']) {
            try {
                fs.chmodSync(f, 0o640);
            } catch {
                // best effort: the file is ours, but a mount may not allow it
            }
        }
        return db;
    } catch (e) {
        sql.close();
        if (isLocked(e)) {
            throw new DbLocked('paceline.db is locked by another process', {cause: e});
        }
        throw e;
    }
}


// openDb at start, retried while another process holds the lock (a stale task on another host
// keeps its CephFS lock until it is evicted): every retryMs, a log line every logMs, giving up
// after limitMs. Any other error rejects at once.
export async function waitForDb(dataDir, {
    now = Date.now, open = openDb, sleep = ms => new Promise(r => setTimeout(r, ms)), log = console.warn,
    retryMs = 5000, logMs = 30000, limitMs = 600000,
} = {}) {
    const start = now();
    let logged = null;
    for (;;) {
        try {
            return open(dataDir);
        } catch (e) {
            if (!(e instanceof DbLocked)) {
                throw e;
            }
        }
        const waited = now() - start;
        if (waited >= limitMs) {
            throw new Error(`paceline.db is still locked after ${limitMs / 1000} s; giving up`);
        }
        if (logged === null || now() - logged >= logMs) {
            logged = now();
            log(`paceline-server: paceline.db is locked by another process; waiting (${Math.floor(waited / 1000)} s so far, giving up after ${limitMs / 1000} s)`);
        }
        await sleep(retryMs);
    }
}
