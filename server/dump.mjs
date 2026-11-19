// Nightly dumps of paceline.db: from 03:00 local (PACELINE_TZ) on, once a night,
// `VACUUM INTO 'DATA_DIR/dumps/.paceline-<date>.db.tmp'`, renamed to paceline-<date>.db when it is
// complete; the newest DUMP_KEEP stay. A dump is a plain SQLite file (journal_mode delete, the same
// user_version): copied over paceline.db with the server stopped (and paceline.db-wal deleted), the
// server starts on it, and the log store's reconcile matches its recording rows to the blobs.
// Recording blobs are not in the dump; the operator's backups of the whole server hold them.
//
// The dump goes through SQL on the server's own connection: nothing here opens paceline.db or its
// side files through fs (db.mjs: closing any descriptor on the file drops the exclusive lock). The
// dump file itself is another file and is fsync'ed and renamed through fs.
//
// VACUUM INTO is synchronous and runs between requests, never inside a transaction; it holds no
// upload slot (an upload streams to its own file and touches paceline.db only in short
// transactions).
import fs from 'node:fs';
import path from 'node:path';
import {localDate, localHHMM} from './time.mjs';
import {syncDir} from './logs.mjs';

export const DUMP_KEEP = 7;
const DUE_FROM = '03:00';
const OVERDUE_FROM = '06:00';          // no dump yet by then: say so once that day
const DUMP_RE = /^paceline-(\d{4}-\d{2}-\d{2})\.db$/;
const TMP_RE = /^\.paceline-\d{4}-\d{2}-\d{2}\.db\.tmp(-journal)?$/;   // VACUUM INTO writes <tmp>-journal beside it
const STALE_TMP_MS = 864e5;
const RETRY_AFTER_FAILURE_MS = 3600 * 1000;

const dumpName = (now, tz) => `paceline-${localDate(now, tz)}.db`;


// Writes dumps/paceline-<local date>.db through a dot temp file of the same day (a leftover one is
// removed first; a dump of the same day is replaced). Returns {file (absolute), bytes}. Throws on
// failure, with the temp file removed.
export function writeDump(db, dataDir, {now, tz}) {
    const dir = path.join(dataDir, 'dumps');
    fs.mkdirSync(dir, {recursive: true, mode: 0o750});
    const name = dumpName(now, tz);
    const file = path.join(dir, name);
    const tmp = path.join(dir, `.${name}.tmp`);
    fs.rmSync(tmp, {force: true});       // VACUUM INTO refuses a file that exists
    fs.rmSync(tmp + '-journal', {force: true});   // and the journal VACUUM INTO writes beside it, if a crash left one
    try {
        db.sql.prepare('VACUUM INTO ?').run(tmp);
        fs.chmodSync(tmp, 0o640);
        const fd = fs.openSync(tmp, 'r');
        try {
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        fs.renameSync(tmp, file);
    } catch (e) {
        fs.rmSync(tmp, {force: true});
        throw e;
    }
    syncDir(dir);
    return {file, bytes: fs.statSync(file).size};
}


// Deletes the dumps beyond the newest `keep` (by the date in the name) and temp files (and their
// -journal) a day after their last write. Returns how many dumps it deleted; 0 without a dumps folder.
export function pruneDumps(dataDir, now, keep = DUMP_KEEP) {
    const dir = path.join(dataDir, 'dumps');
    let names;
    try {
        names = fs.readdirSync(dir);
    } catch (e) {
        if (e.code === 'ENOENT' || e.code === 'ENOTDIR') {
            return 0;
        }
        throw e;
    }
    const dated = names.filter(n => DUMP_RE.test(n)).sort().reverse();
    let deleted = 0;
    for (const name of dated.slice(keep)) {
        fs.rmSync(path.join(dir, name), {force: true});
        deleted++;
    }
    for (const name of names.filter(n => TMP_RE.test(n))) {
        const file = path.join(dir, name);
        const st = fs.statSync(file, {throwIfNoEntry: false});
        if (st && now - st.mtimeMs > STALE_TMP_MS) {
            fs.rmSync(file, {force: true});
        }
    }
    return deleted;
}


// Folders an import (imported-<date>/, with -2 … when taken) or a restore by hand
// (before-restore-<date>-<HHMM>/) left at the top of DATA_DIR: they hold old club data beyond every
// period /privacy names and are to be deleted by hand within LEFTOVER_DAYS of their date. Returns
// [{name, date}] by name; [] when DATA_DIR cannot be read. Only the folder names are read (readdir
// and stat at the top level), never paceline.db or its side files.
export const LEFTOVER_DAYS = 7;
const LEFTOVER_RE = /^(?:imported|before-restore)-(\d{4}-\d{2}-\d{2})(?:-\d+)?$/;

export function leftoverFolders(dataDir) {
    let names;
    try {
        names = fs.readdirSync(dataDir);
    } catch {
        return [];
    }
    const found = [];
    for (const name of names.sort()) {
        const m = LEFTOVER_RE.exec(name);
        if (!m) {
            continue;
        }
        try {
            if (fs.statSync(path.join(dataDir, name)).isDirectory()) {
                found.push({name, date: m[1]});
            }
        } catch {
            // gone meanwhile
        }
    }
    return found;
}


// From 03:00 local on, once a night: today's dump is not there yet.
export function dumpDue(dataDir, now, tz) {
    return localHHMM(now, tz) >= DUE_FROM && !fs.existsSync(path.join(dataDir, 'dumps', dumpName(now, tz)));
}


const parsed = text => {
    try {
        return text === null ? null : JSON.parse(text);
    } catch {
        return null;
    }
};


// The timer's job. tick() returns true when it wrote a dump; false when none was due, the last
// attempt failed less than an hour ago, or it failed now. It never throws: a failure is logged and
// kept in meta dump_error ({at, message}) for the admin page; a dump is kept in meta dump_last
// ({date, file relative to DATA_DIR, bytes, at}) and clears the error; then paceline.db-wal is
// checkpointed and truncated to 0 bytes (a failure there is logged only). From 06:00 local on, a
// missing dump of today is logged once a day as overdue.
// status(): {dbBytes, last, error} for the admin page.
export function makeDumpJob(db, dataDir, {now, tz, log = console.log, error = console.error}) {
    let failedAt = null;
    let overdueDay = null;

    function attempt(t) {
        if (failedAt !== null && t - failedAt < RETRY_AFTER_FAILURE_MS) {
            return false;
        }
        if (!dumpDue(dataDir, t, tz)) {
            return false;
        }
        try {
            const {file, bytes} = writeDump(db, dataDir, {now: t, tz});
            const name = path.basename(file);
            failedAt = null;
            log(`paceline-server: dump written: dumps/${name} (${bytes} bytes)`);
            const last = {date: localDate(t, tz), file: `dumps/${name}`, bytes, at: new Date(t).toISOString()};
            db.tx(() => {
                db.setMeta('dump_last', JSON.stringify(last));
                db.sql.prepare('DELETE FROM meta WHERE name = ?').run('dump_error');
            });
        } catch (e) {
            failedAt = t;
            error(`paceline-server: dump: ${e.message}`);
            try {
                db.setMeta('dump_error', JSON.stringify({at: new Date(t).toISOString(), message: String(e.message)}));
            } catch (e2) {
                error(`paceline-server: dump: the failure not recorded: ${e2.message}`);
            }
            return false;
        }
        // the dump is good: paceline.db-wal goes back to 0 bytes, so the frames of rows deleted
        // since the last checkpoint do not stay readable in it (and in the operator's backups of
        // it); a failure is only logged (the next close or night checkpoints again)
        try {
            const {busy} = db.sql.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
            if (busy !== 0) {
                error('paceline-server: dump written, but paceline.db-wal not truncated: the checkpoint was busy');
            }
        } catch (e) {
            error(`paceline-server: dump written, but paceline.db-wal not truncated: ${e.message}`);
        }
        // a prune failure is only logged as well (the next night prunes again)
        try {
            const n = pruneDumps(dataDir, t);
            if (n > 0) {
                log(`paceline-server: ${n} dumps beyond the newest ${DUMP_KEEP} deleted`);
            }
        } catch (e) {
            error(`paceline-server: dump written, but old dumps not pruned: ${e.message}`);
        }
        return true;
    }

    function checkOverdue(t) {
        const day = localDate(t, tz);
        if (overdueDay !== day && localHHMM(t, tz) >= OVERDUE_FROM && !fs.existsSync(path.join(dataDir, 'dumps', dumpName(t, tz)))) {
            overdueDay = day;
            error(`paceline-server: dump overdue: no dumps/${dumpName(t, tz)} yet (due from ${DUE_FROM})`);
        }
    }

    return {
        tick() {
            let wrote = false;
            try {
                wrote = attempt(now());
            } catch (e) {
                error(`paceline-server: dump: ${e.message}`);
            }
            try {
                checkOverdue(now());
            } catch (e) {
                error(`paceline-server: dump: ${e.message}`);
            }
            return wrote;
        },
        status() {
            return {dbBytes: db.bytes(), last: parsed(db.meta('dump_last')), error: parsed(db.meta('dump_error'))};
        },
    };
}
