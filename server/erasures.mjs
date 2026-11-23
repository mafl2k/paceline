// The erasure list (user, 19 Nov 2026): every Remove a rider, kept so it can be applied again after a
// restore. Backups are encrypted and cannot be changed: what was removed stays in them until they
// expire, is never used, and comes back only with a restore, which this list then takes out again.
//
// DATA_DIR/erasures.jsonl, beside paceline.db and NOT in it (restoring an older paceline.db must not
// roll the list back): one line per removal, {"cid":…,"aid":…,"at":…} with the club id, the rider's
// Zwift ID (needed to find him again) and the removal's time (ISO). Appended and fsynced before the
// removal writes anything, so a crash cannot lose it. Entries older than BACKUP_RETENTION_MONTHS + 1
// month go at the log sweep (the file rewritten atomically): by then no backup holds his data. A
// line that cannot be read is logged by its number and skipped, never fatal.
//
// paceline.db keeps which entries it has applied (meta `erasures_applied`: a hash of each entry's
// line, never the Zwift ID). At start every entry this database has not applied is applied again
// (after a restore of an older paceline.db or older recordings), and only to data stored before the
// entry's `at`: plan versions, inbox entries, rider status and archived versions with an older `at`,
// recordings of rides that began before it. What was stored later (he rode again and is in new
// plans or recordings) stays. An entry is marked applied once nothing of it failed.
//
// A full restore of the data folder rolls this file back too: the operator mail of every removal
// (mail-content.mjs 'rider-removed') carries the entry's line, which /admin "Removals to re-apply"
// takes back (admin.mjs).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {CID_RE, ZWIFT_RE} from './ids.mjs';
import {writeAtomic, syncDir} from './logs.mjs';
import {removeRider, clubListsBefore, ClubError} from './club.mjs';

export const ERASURES_FILE = 'erasures.jsonl';
const META = 'erasures_applied';
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const errCode = e => e?.code ?? e?.name ?? 'error';


// The entry of one line (or a parsed value), or null when it is none: exactly a club id, a Zwift ID
// and an ISO time as toISOString writes it.
// `notAfter` (epoch ms): a later `at` is none either (/admin: a time to come would erase him from
// everything stored until then).
export function parseEntry(v, {notAfter = Infinity} = {}) {
    let x = v;
    if (typeof v === 'string') {
        try {
            x = JSON.parse(v);
        } catch {
            return null;
        }
    }
    if (x === null || typeof x !== 'object' || Array.isArray(x) || Object.keys(x).length !== 3) {
        return null;
    }
    const {cid, aid, at} = x;
    if (typeof cid !== 'string' || !CID_RE.test(cid) || typeof aid !== 'string' || !ZWIFT_RE.test(aid) ||
        typeof at !== 'string' || !ISO_RE.test(at) || new Date(Date.parse(at)).toISOString() !== at || Date.parse(at) > notAfter) {
        return null;
    }
    return {cid, aid, at};
}

// The line of an entry, always in this key order: the operator mail carries it as it is in the file.
export const entryLine = e => JSON.stringify({cid: e.cid, aid: e.aid, at: e.at});
const hashOf = e => crypto.createHash('sha256').update(entryLine(e)).digest('hex').slice(0, 32);
const keyOf = e => `${e.cid} ${e.aid} ${e.at}`;


// The list in DATA_DIR (`dataDir` null: in memory only, for tests of other parts), read here. A
// file that cannot be read (its owner or mode) does not stop the start, but everything that relies on
// the list fails closed until it is read (reload, at every log sweep): nothing is applied again,
// Remove a rider and /admin pastes are refused (append throws), uploads answer 503 and the reconcile
// holds the files it finds (logs.mjs). One line says so at start and at every sweep while it lasts.
// A temp file a crash left in expire goes (the list itself is whole).
export function openErasures(dataDir) {
    const file = dataDir === null ? null : path.join(dataDir, ERASURES_FILE);
    let entries = [];
    let glued = false;    // the file does not end with a newline (a crash mid-append)
    let broken = null;    // the error code when the file cannot be read

    const sayBroken = () => console.error(`paceline-server: ${file} cannot be read (${broken}): removals are not applied again, Remove a rider `
        + 'is refused, recording uploads wait (503) and new recording files are held, until the file is readable and writable by the '
        + 'server (uid 1000); fix its owner or mode and never delete it: the next log sweep (or a restart) reads it again');

    // Reads the file; true when it could be read (or is not there).
    function read() {
        let text = '';
        try {
            text = fs.readFileSync(file, 'utf8');
        } catch (e) {
            if (e.code !== 'ENOENT') {
                broken = errCode(e);
                sayBroken();
                return false;
            }
        }
        broken = null;
        entries = [];
        glued = text !== '' && !text.endsWith('\n');
        const seen = new Set();
        text.split('\n').forEach((line, i) => {
            if (line.trim() === '') {
                return;
            }
            const e = parseEntry(line);
            if (e === null) {
                // the number only: the line may hold a Zwift ID
                console.warn(`paceline-server: ${ERASURES_FILE}: line ${i + 1} is no removal entry, skipped`);
                return;
            }
            if (!seen.has(keyOf(e))) {
                seen.add(keyOf(e));
                entries.push(e);
            }
        });
        return true;
    }

    if (file !== null) {
        for (const name of fs.readdirSync(dataDir)) {
            if (/^\.erasures\.jsonl\.[0-9a-f]{12}\.tmp$/.test(name)) {
                fs.rmSync(path.join(dataDir, name), {force: true});
            }
        }
        read();
    }

    // While the file could not be read: reads it again (one line when it still cannot be). True
    // when it is readable now (it was not before).
    const reload = () => broken !== null && read();

    const has = e => entries.some(x => keyOf(x) === keyOf(e));

    // Appends the entry (synced; the folder too when the file is new). False when it is there already.
    function append(entry) {
        const e = parseEntry(entry);
        if (e === null) {
            throw new TypeError('bad erasure entry');
        }
        if (broken !== null) {
            throw Object.assign(new Error(`${ERASURES_FILE} cannot be read`), {code: broken});
        }
        if (has(e)) {
            return false;
        }
        if (file !== null) {
            const fresh = !fs.existsSync(file);
            const fd = fs.openSync(file, 'a', 0o640);
            try {
                fs.writeSync(fd, (glued ? '\n' : '') + entryLine(e) + '\n');
                fs.fsyncSync(fd);
            } finally {
                fs.closeSync(fd);
            }
            glued = false;
            if (fresh) {
                syncDir(path.dirname(file));
            }
        }
        entries.push(e);
        return true;
    }

    // Drops the entries older than `cutoff` (epoch ms), the file rewritten whole. Returns how many.
    function expire(cutoff) {
        if (broken !== null) {
            return 0;
        }
        const keep = entries.filter(e => Date.parse(e.at) >= cutoff);
        const n = entries.length - keep.length;
        if (n > 0 || glued) {
            if (file !== null) {
                writeAtomic(file, keep.map(e => entryLine(e) + '\n').join(''));
            }
            entries = keep;
            glued = false;
        }
        return n;
    }

    // The riders a recording of club `cid` from session `session` (epoch ms) must not hold: those
    // removed from the club after the ride began. A rider listed again later rides on in later
    // recordings.
    const erasedFor = (cid, session) => new Set(entries.filter(e => e.cid === cid && Date.parse(e.at) > session).map(e => e.aid));

    return {append, expire, erasedFor, has, reload, broken: () => broken, entries: () => entries.map(e => ({...e}))};
}


// The cutoff of expire: `months` + 1 calendar months before `now` (UTC).
export function expiryCutoff(now, months) {
    const d = new Date(now);
    d.setUTCMonth(d.getUTCMonth() - (months + 1));
    return d.getTime();
}


// Applying the list: `list` (openErasures), paceline.db (`db`, its meta row), the club store and the
// log store. Entries are applied one at a time (the log store runs one recordings pass at a time).
export function makeEraser({list, db, store, logs, now}) {
    const getMeta = db.sql.prepare('SELECT value FROM meta WHERE name = ?');
    const putMeta = db.sql.prepare('INSERT INTO meta (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value');

    function applied() {
        const row = getMeta.get(META);
        try {
            const v = row ? JSON.parse(row.value) : [];
            return new Set(Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);
        } catch {
            return new Set();
        }
    }

    // Writes the applied set, kept to the hashes of entries still in the list.
    function saveApplied(set) {
        if (list.broken?.() != null) {
            throw Object.assign(new Error(`${ERASURES_FILE} cannot be read`), {code: list.broken()});
        }
        const live = new Set(list.entries().map(hashOf));
        db.tx(() => putMeta.run(META, JSON.stringify([...set].filter(h => live.has(h)).sort())));
    }

    function markApplied(entry) {
        const set = applied();
        set.add(hashOf(entry));
        saveApplied(set);
    }

    const pending = () => {
        const set = applied();
        return list.entries().filter(e => !set.has(hashOf(e)));
    };

    // The database part of an entry, only what was stored before its `at`: the club's versions and
    // inbox (when any lists him), the archive and the rider status in the club change's transaction,
    // or the archive alone for a club that is not active or pending here (trashed, purged, unknown).
    // {plans, archived, waiting}; waiting: the club is in the trash (its stored copy cannot be
    // changed), so the entry stays pending until it is restored or purged.
    function applyDb(e) {
        const before = Date.parse(e.at);
        const club = store.getAny(e.cid);
        let archived = 0;
        if (club && clubListsBefore(club, e.aid, before)) {
            const plans = store.change(e.cid, c => removeRider(c, e.aid, now(), {before}), {
                archive: false,
                also: () => {
                    archived = logs.removeRider(e.cid, e.aid, {before});
                    store.forget(e.cid, e.aid, {before});
                },
            });
            return {plans, archived, waiting: false};
        }
        db.tx(() => {
            archived = logs.removeRider(e.cid, e.aid, {before});
            store.forget(e.cid, e.aid, {before});
        });
        return {plans: 0, archived, waiting: !club && store.trashed().some(x => x.id === e.cid)};
    }

    // The database part of `e`, never throwing: a failure is logged (the club, never the Zwift ID).
    function dbPart(e) {
        try {
            return {plans: 0, archived: 0, failed: 0, ...applyDb(e)};
        } catch (err) {
            console.error(`paceline-server: club ${e.cid}: a removal not applied to the club data: ${err instanceof ClubError ? err.code : errCode(err)}`);
            return {plans: 0, archived: 0, failed: 1, waiting: false};
        }
    }

    const sumOf = () => ({entries: 0, plans: 0, archived: 0, changed: 0, deleted: 0, failed: 0, unreadable: 0, waiting: 0});

    // Applies the entries `todo`, each only to data stored before its `at`: the database parts of all
    // of them at once, before this returns (the server start runs it before it listens, so no page or
    // plan check sees him), then the recordings in one pass per club with all of its riders
    // (logs.eraseRiders). An entry is marked applied once nothing of its own database part and of its
    // club's pass failed or could not be read. Never throws; failures are logged (the club, never the
    // Zwift ID). Resolves to the sum {entries, plans, archived, changed, deleted, failed, unreadable,
    // waiting}.
    function applyAll(todo) {
        const firsts = todo.map(e => [e, dbPart(e)]);
        return (async () => {
            const sum = sumOf();
            const byClub = new Map();
            for (const item of firsts) {
                byClub.set(item[0].cid, [...(byClub.get(item[0].cid) ?? []), item]);
            }
            for (const [cid, items] of byClub) {
                let recs = {deleted: 0, changed: 0, failed: 0, unreadable: 0};
                try {
                    recs = await logs.eraseRiders(cid, items.map(([e]) => ({aid: e.aid, before: Date.parse(e.at)})));
                } catch (err) {
                    recs.failed++;
                    console.error(`paceline-server: club ${cid}: a removal not applied to the recordings: ${errCode(err)}`);
                }
                for (const k of ['changed', 'deleted', 'failed', 'unreadable']) {
                    sum[k] += recs[k];
                }
                for (const [e, first] of items) {
                    sum.entries++;
                    sum.plans += first.plans;
                    sum.archived += first.archived;
                    sum.failed += first.failed;
                    sum.waiting += first.waiting ? 1 : 0;
                    if (!first.failed && !first.waiting && !recs.failed && !recs.unreadable) {
                        try {
                            markApplied(e);
                        } catch (err) {
                            console.error(`paceline-server: club ${cid}: a removal applied but not marked: ${errCode(err)}`);
                        }
                    }
                }
            }
            return sum;
        })();
    }

    // Every entry this database has not applied (of club `cid` only, when given: a club the operator
    // takes back from the trash), as applyAll does; one log line when there were any.
    function applyPending({cid = null} = {}) {
        const todo = pending().filter(e => cid === null || e.cid === cid);
        const done = applyAll(todo);
        return done.then(sum => {
            if (todo.length) {
                console.log(`paceline-server: ${ERASURES_FILE}: ${sum.entries} removals applied again: ${sum.plans} plans, ${sum.archived} archived versions, `
                    + `${sum.changed} recordings changed, ${sum.deleted} deleted, ${sum.failed} parts failed and ${sum.unreadable} recordings `
                    + `not readable (tried again at the next start), ${sum.waiting} wait for a club in the trash`);
            }
            return sum;
        });
    }

    // The newest entry of rider `aid` in club `cid` on the list, or null; whether one is applied.
    const latestEntry = (cid, aid) => list.entries().filter(e => e.cid === cid && e.aid === String(aid)).sort((x, y) => (x.at < y.at ? 1 : -1))[0] ?? null;
    const isApplied = e => applied().has(hashOf(e));

    // The sweep: entries past the backups go, and the applied set keeps only the entries left.
    function expire(cutoff) {
        const n = list.expire(cutoff);
        if (n > 0) {
            saveApplied(applied());
        }
        return n;
    }

    return {applyAll, applyPending, latestEntry, isApplied, pending, markApplied, expire, list};
}
