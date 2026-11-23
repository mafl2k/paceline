// Recordings per club (spec §6.2): POST /api/log/<slug>, the content check, the quotas and the
// retention sweep. The blobs stay files at DATA_DIR/logs/<cid>/<slug>/<session>-<athlete>.jsonl.gz;
// paceline.db holds their index (recordings), the plan codes found in each (recording_sigs) and the
// archive of the versions a recording used, kept from the club when they left it (archive; plan
// versions spec §11). Quotas come from the index; reconcile (at start and in the log sweep) is the
// only directory walk. Paths are built only from CID_RE-checked circle ids, isSlug slugs and
// LOG_NAME_RE names; the v1 folders logs/<slug>/ are the operator's and never read, counted or swept
// here.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {StringDecoder} from 'node:string_decoder';
import {CID_RE, MOD_RE, SIG_RE, ZWIFT_RE, isSlug} from './ids.mjs';
import {HttpError, json, readBody} from './http.mjs';
import {roleIn} from './select.mjs';
import {normalizePlan, stripSheet} from '../pages/src/engine/plan.mjs';

const DAY = 86400000;
export const LOG_NAME_RE = /^(\d{1,16})-(\d{1,12})\.jsonl\.gz$/;
export const LOG_SESSION_MAX_AGE = 8 * DAY;    // the mod uploads for 7 days (spec §6.2)
export const LOG_PER_DAY = 4;                  // new files per athlete and team and UTC day
// Recording bodies read at the same time (controller ruling, 16 Nov 2026; spec §6.2 said 2). Measured
// with 50 full clubs loaded: one 20 MB upload grows RSS by ~53 MB, two by 70-92 MB; chosen when the
// stack still had a memory limit (gone since paceline.db), kept to bound memory per upload. The next
// concurrent upload gets 503 with Retry-After: 60.
// Since 18 Nov 2026 each line is written out again as it was checked (checkRecording with `file`):
// streamed to disk, never held, but the extra JSON.stringify adds garbage. Measured on a Mac without
// clubs loaded, a 19.6 MB body (195 MB unpacked) grew RSS by ~60 MB (was ~50 MB; ~100 MB when one row
// was dropped and the cleaned file was built in memory), whether or not rows are dropped.
export const LOG_MAX_IN_FLIGHT = 1;
export const LOG_UNPACK_FACTOR = 10;           // unpacked at most 10 × LOG_MAX_FILE_MB
export const LOG_MAX_LINE = 256 * 1024;        // characters; a head line with 40 riders is ~10 KB, a tick 10-25 KB
export const LOG_MAX_DEPTH = 16;               // nesting levels of a line; the mod's head line has 4, a tick 3
export const LOG_MAX_SIGS = 10;                // plan codes kept per recording (plan versions spec §13)
export const LOG_MAX_FILES = 5000;             // recordings per club
export const ARCHIVE_MAX = 1000;               // archived versions per team
// Each recording counts toward the quotas rounded up to a block; an archived version by its bytes.
export const QUOTA_BLOCK = 4096;
export const quotaBytes = n => Math.ceil(n / QUOTA_BLOCK) * QUOTA_BLOCK;
const QUOTA_SQL = `((bytes + ${QUOTA_BLOCK - 1}) / ${QUOTA_BLOCK}) * ${QUOTA_BLOCK}`;   // quotaBytes(bytes), integer division
const COMPARE_CHUNK = 64 * 1024;
// the fields of a version kept in the archive
const ARCHIVED = ['plan', 'n', 'label', 'type', 'date', 'sig', 'recSig', 'uploadedAt', 'at', 'via', 'copyOf', 'json', 'text'];
export const LOG_TMP_KEEP_MS = DAY;
// Uploads are written to logs/.incoming/<random>.tmp while they are checked, then renamed into
// place (same file system). Not in the team folder: a club purged meanwhile (its logs/<cid> is
// removed) must not get it back. Not a circle id, so nothing else here reads or counts it; the
// sweep deletes what a crash left there after LOG_TMP_KEEP_MS.
const INCOMING = '.incoming';
const INCOMING_RE = /^[0-9a-f]{16}\.tmp$/;

const CORS = {'Access-Control-Allow-Origin': '*'};
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);


// Writes `file` through a dot temp file: written, fsynced, renamed, then the directory fsynced. A
// power loss leaves either the old or the new file, never an empty or half one. The tests plant
// their recordings with it (put).
export function writeAtomic(file, data) {
    const dir = path.dirname(file);
    const tmp = path.join(dir, `.${path.basename(file)}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    try {
        const fd = fs.openSync(tmp, 'w', 0o640);
        try {
            fs.writeFileSync(fd, data);
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
}


// The rename is durable once the directory is; some file systems can't fsync a directory.
export function syncDir(dir) {
    let dfd = null;
    try {
        dfd = fs.openSync(dir, 'r');
        fs.fsyncSync(dfd);
    } catch {
        // the file itself is complete either way
    } finally {
        if (dfd !== null) {
            fs.closeSync(dfd);
        }
    }
}


// ---- the rows (the one-time importer of the old files builds its rows with these too) ----

const checkPath = (cid, slug, name) => {
    if (!CID_RE.test(cid) || !isSlug(slug) || !LOG_NAME_RE.test(name)) {
        throw new TypeError(`bad recording path: ${cid}/${slug}/${name}`);
    }
};

const checkTeam = (cid, slug) => {
    if (!CID_RE.test(cid) || !isSlug(slug)) {
        throw new TypeError(`bad recording team: ${cid}/${slug}`);
    }
};

// A session past Number.MAX_SAFE_INTEGER (16 digits fit the name) is never indexed: node:sqlite
// throws on reading such an integer.
const safeSession = name => Number.isSafeInteger(Number(LOG_NAME_RE.exec(name)[1]));

// The recordings row of blob `name` of team `slug` from its fs.Stats: bytes its size, mtime its mtime,
// stored_at `at` (epoch ms; the file's mtime unless given). null for a session past 2^53.
export function recordingRow(cid, slug, name, stat, at = Math.floor(stat.mtimeMs)) {
    checkPath(cid, slug, name);
    if (!safeSession(name)) {
        return null;
    }
    const m = LOG_NAME_RE.exec(name);
    return {cid, slug, name, session: Number(m[1]), athlete: m[2], bytes: stat.size, stored_at: at, mtime: Math.floor(stat.mtimeMs)};
}

const str = v => typeof v === 'string' ? v : null;
const pastSigsOf = v => Array.isArray(v.pastSigs) ? v.pastSigs.filter(x => typeof x === 'string') : [];

// The archive row of version `v` (a club's version, or one archived already) kept as `id` of team
// `slug`, archived at `at` (epoch ms). `version` is the archived object: the ARCHIVED fields (null
// when missing) and pastSigs; the other columns are taken from it, `bytes` is its UTF-8 length.
export function archiveRow(cid, slug, id, v, at) {
    checkTeam(cid, slug);
    const version = {...Object.fromEntries(ARCHIVED.map(k => [k, v[k] ?? null])), pastSigs: pastSigsOf(v)};
    const text = JSON.stringify(version);
    return {
        cid, slug, id, plan: str(version.plan), n: Number.isSafeInteger(version.n) ? version.n : null,
        sig: str(version.sig), rec_sig: str(version.recSig), past_sigs: JSON.stringify(version.pastSigs),
        label: str(version.label), type: str(version.type), date: str(version.date),
        version: text, bytes: Buffer.byteLength(text), archived_at: at,
    };
}

// A version is used while a listed code is its recSig, its current sig or any sig it had before
// (pastSigs: each rider removal recomputes the sig, and a recording made in between lists that).
const usedBy = (v, set) => isObject(v) && (set.has(v.recSig) || set.has(v.sig) || pastSigsOf(v).some(x => set.has(x)));
// the same, from an archive row's columns
const rowUsed = (r, set) => usedBy({sig: r.sig, recSig: r.rec_sig, pastSigs: JSON.parse(r.past_sigs)}, set);

const codeList = v => Array.isArray(v) ? v.filter(x => typeof x === 'string' && SIG_RE.test(x)) : [];
const errCode = e => e?.code ?? e?.name ?? 'error';


// ---- the log store ----

// `db` is paceline.db; `now` the clock of stored_at and archived_at. A club with a trash row (and
// none in clubs) keeps its recordings in logs/<cid>/ and its recording and archive rows, out of the
// total and of the sweep while it is in the trash. Every write is one db.tx (a savepoint inside a caller's
// transaction); a blob is renamed into place before its row is written and unlinked after its row
// is deleted, and reconcile heals what a failure in between leaves.
// `erasures` is the erasure list (erasures.mjs openErasures) the uploads consult; null: none.
export function makeLogStore(dataDir, {db, now = Date.now, erasures = null}) {
    const logsDir = path.join(dataDir, 'logs');
    const sql = db.sql;
    const TRASHED = 'SELECT cid FROM trash WHERE cid NOT IN (SELECT cid FROM clubs)';
    const ARCHIVE_COLS = 'cid, slug, id, plan, n, sig, rec_sig, past_sigs, label, type, date, version, bytes, archived_at';
    const q = {
        putRec: sql.prepare(`INSERT INTO recordings (cid, slug, name, session, athlete, bytes, stored_at, mtime)
            VALUES (:cid, :slug, :name, :session, :athlete, :bytes, :stored_at, :mtime)
            ON CONFLICT (cid, slug, name) DO UPDATE SET session = excluded.session, athlete = excluded.athlete,
            bytes = excluded.bytes, stored_at = excluded.stored_at, mtime = excluded.mtime`),
        hasRec: sql.prepare('SELECT 1 AS x FROM recordings WHERE cid = ? AND slug = ? AND name = ?'),
        delRec: sql.prepare('DELETE FROM recordings WHERE cid = ? AND slug = ? AND name = ?'),
        sigsOf: sql.prepare('SELECT sig FROM recording_sigs WHERE cid = ? AND slug = ? AND name = ? ORDER BY sig'),
        delSigs: sql.prepare('DELETE FROM recording_sigs WHERE cid = ? AND slug = ? AND name = ?'),
        addSig: sql.prepare('INSERT OR IGNORE INTO recording_sigs (cid, slug, name, sig) VALUES (?, ?, ?, ?)'),
        teamCodes: sql.prepare('SELECT DISTINCT sig FROM recording_sigs WHERE cid = ? AND slug = ?'),
        list: sql.prepare('SELECT slug, name, session, athlete, bytes FROM recordings WHERE cid = ? ORDER BY session DESC, slug, name'),
        count: sql.prepare('SELECT COUNT(*) AS n FROM recordings WHERE cid = ?'),
        recBytes: sql.prepare(`SELECT COALESCE(SUM(${QUOTA_SQL}), 0) AS n FROM recordings WHERE cid = ?`),
        arcBytes: sql.prepare('SELECT COALESCE(SUM(bytes), 0) AS n FROM archive WHERE cid = ?'),
        totalRec: sql.prepare(`SELECT COALESCE(SUM(${QUOTA_SQL}), 0) AS n FROM recordings WHERE cid NOT IN (${TRASHED})`),
        totalArc: sql.prepare(`SELECT COALESCE(SUM(bytes), 0) AS n FROM archive WHERE cid NOT IN (${TRASHED})`),
        archived: sql.prepare('SELECT version FROM archive WHERE cid = ? AND slug = ? ORDER BY archived_at, rowid'),
        insArc: sql.prepare(`INSERT INTO archive (${ARCHIVE_COLS}) VALUES (${ARCHIVE_COLS.split(', ').map(c => ':' + c).join(', ')})
            ON CONFLICT (cid, slug, id) DO NOTHING`),
        updArc: sql.prepare(`UPDATE archive SET ${ARCHIVE_COLS.split(', ').slice(3).map(c => `${c} = :${c}`).join(', ')}
            WHERE cid = :cid AND slug = :slug AND id = :id`),
        arcCount: sql.prepare('SELECT COUNT(*) AS n FROM archive WHERE cid = ? AND slug = ?'),
        arcUse: sql.prepare('SELECT rowid AS r, sig, rec_sig, past_sigs FROM archive WHERE cid = ? AND slug = ? ORDER BY archived_at, rowid'),
        delArc: sql.prepare('DELETE FROM archive WHERE rowid = ?'),
        clubArc: sql.prepare('SELECT rowid AS r, slug, id, version, archived_at FROM archive WHERE cid = ? ORDER BY slug, archived_at, rowid'),
        delClubRecs: sql.prepare('DELETE FROM recordings WHERE cid = ?'),
        delClubArc: sql.prepare('DELETE FROM archive WHERE cid = ?'),
        allRecs: sql.prepare('SELECT cid, slug, name, bytes, mtime FROM recordings'),
        clubRecs: sql.prepare('SELECT slug, name, session, athlete FROM recordings WHERE cid = ? ORDER BY slug, name'),
        setBytes: sql.prepare('UPDATE recordings SET bytes = ?, mtime = ? WHERE cid = ? AND slug = ? AND name = ?'),
        rowOf: sql.prepare('SELECT bytes, mtime FROM recordings WHERE cid = ? AND slug = ? AND name = ?'),
        trashedClub: sql.prepare(`SELECT 1 AS x FROM (${TRASHED}) WHERE cid = ?`),
        old: sql.prepare(`SELECT cid, slug, name FROM recordings WHERE session < ? AND cid NOT IN (${TRASHED}) ORDER BY cid, slug, name`),
        arcTeams: sql.prepare(`SELECT DISTINCT cid, slug FROM archive WHERE cid NOT IN (${TRASHED}) ORDER BY cid, slug`),
        // a purged club: in neither clubs nor trash, with a tombstone
        purged: sql.prepare(`SELECT NOT EXISTS (SELECT 1 FROM clubs WHERE cid = :cid) AND NOT EXISTS (SELECT 1 FROM trash WHERE cid = :cid)
            AND EXISTS (SELECT 1 FROM tombstone_clubs WHERE cid = :cid) AS purged`),
    };

    function fileOf(cid, slug, name) {
        checkPath(cid, slug, name);
        return path.join(logsDir, cid, slug, name);
    }

    // A row for a recording the server writes: its session must be indexable.
    function storedRow(cid, slug, name, file) {
        const row = recordingRow(cid, slug, name, fs.statSync(file), now());
        if (row === null) {
            throw new TypeError(`bad recording session: ${name}`);
        }
        return row;
    }

    // Directory entries of one kind, [] when the directory is missing.
    function entries(dir, keep) {
        try {
            return fs.readdirSync(dir, {withFileTypes: true}).filter(keep).map(d => d.name);
        } catch (e) {
            if (e.code === 'ENOENT' || e.code === 'ENOTDIR') {
                return [];
            }
            throw e;
        }
    }


    function size(file) {
        try {
            return fs.statSync(file).size;
        } catch (e) {
            if (e.code === 'ENOENT') {
                return null;
            }
            throw e;
        }
    }

    // Removes the team folder once it is empty.
    function removeIfEmpty(cid, slug) {
        try {
            fs.rmdirSync(path.join(logsDir, cid, slug));
        } catch (e) {
            if (!['ENOENT', 'ENOTEMPTY', 'EEXIST', 'ENOTDIR'].includes(e.code)) {
                throw e;
            }
        }
    }

    // A purged club's folder; a removal that fails is logged, never thrown (the club is gone already).
    function removeClubDir(cid) {
        try {
            fs.rmSync(path.join(logsDir, cid), {recursive: true, force: true});
        } catch (e) {
            console.warn(`paceline-server: logs/${cid} of a purged club not removed: ${errCode(e)}`);
        }
    }

    function get(cid, slug, name) {
        try {
            return fs.readFileSync(fileOf(cid, slug, name));
        } catch (e) {
            if (e.code === 'ENOENT') {
                return null;
            }
            throw e;
        }
    }

    const has = (cid, slug, name) => {
        checkPath(cid, slug, name);
        return q.hasRec.get(cid, slug, name) !== undefined;
    };

    // A new path in logs/.incoming for an upload being checked (the folder is made).
    function incoming() {
        const dir = path.join(logsDir, INCOMING);
        fs.mkdirSync(dir, {recursive: true});
        return path.join(dir, `${crypto.randomBytes(8).toString('hex')}.tmp`);
    }

    // null when there is no such recording file, else whether it holds exactly the bytes of file
    // `src`. Reads both in chunks, so a retry never holds a copy of either in memory.
    function matches(cid, slug, name, src) {
        const file = fileOf(cid, slug, name);
        const n = size(file);
        if (n === null) {
            return null;
        }
        if (n !== size(src)) {
            return false;
        }
        const fd = fs.openSync(file, 'r');
        const fd2 = fs.openSync(src, 'r');
        try {
            const len = Math.min(COMPARE_CHUNK, Math.max(n, 1));
            const a = Buffer.alloc(len), b = Buffer.alloc(len);
            for (let pos = 0; pos < n;) {
                const want = Math.min(len, n - pos);
                const got = fs.readSync(fd, a, 0, want, pos);
                const got2 = fs.readSync(fd2, b, 0, want, pos);
                if (got === 0 || got !== got2 || !a.subarray(0, got).equals(b.subarray(0, got))) {
                    return false;
                }
                pos += got;
            }
            return true;
        } finally {
            fs.closeSync(fd);
            fs.closeSync(fd2);
        }
    }

    // Replaces the recording's codes (in the caller's transaction).
    function setSigs(cid, slug, name, list) {
        q.delSigs.run(cid, slug, name);
        for (const code of list) {
            q.addSig.run(cid, slug, name, code);
        }
    }

    // Not used by the upload (it streams, see adopt); the tests plant recordings with it.
    function put(cid, slug, name, buf) {
        const file = fileOf(cid, slug, name);
        if (!safeSession(name)) {
            throw new TypeError(`bad recording session: ${name}`);
        }
        fs.mkdirSync(path.dirname(file), {recursive: true});
        writeAtomic(file, buf);
        const row = storedRow(cid, slug, name, file);
        db.tx(() => q.putRec.run(row));
    }

    // Removes `src` (from incoming()) if it is still there, then logs/.incoming once it is empty.
    // Called while the upload slot is held, so no other upload is writing there; while a rewrite
    // (Remove a rider) writes there the folder stays.
    function discard(src) {
        if (src !== null) {
            fs.rmSync(src, {force: true});
        }
        if (writing > 0) {
            return;
        }
        try {
            fs.rmdirSync(path.join(logsDir, INCOMING));
        } catch (e) {
            if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(e.code)) {
                throw e;
            }
        }
    }

    // Moves the checked upload `src` (synced already, from incoming()) into place, durably, then
    // writes its row and its codes in one transaction. When that is refused the file stays in place
    // without a row: a retry (addSigs) or the next reconcile indexes it.
    function adopt(cid, slug, name, src, codes = []) {
        const file = fileOf(cid, slug, name);
        if (!safeSession(name)) {
            throw new TypeError(`bad recording session: ${name}`);
        }
        const dir = path.dirname(file);
        fs.mkdirSync(dir, {recursive: true});
        fs.renameSync(src, file);
        syncDir(dir);
        const row = storedRow(cid, slug, name, file);
        const list = [...new Set(codeList(codes))];
        db.tx(() => {
            q.putRec.run(row);
            setSigs(cid, slug, name, list);
        });
    }

    // Deletes uploads left in logs/.incoming by a crash, older than LOG_TMP_KEEP_MS.
    function dropIncoming(at) {
        const dir = path.join(logsDir, INCOMING);
        for (const name of entries(dir, d => d.isFile() && INCOMING_RE.test(d.name))) {
            const st = fs.statSync(path.join(dir, name), {throwIfNoEntry: false});
            if (st && at - st.mtimeMs > LOG_TMP_KEEP_MS) {
                fs.rmSync(path.join(dir, name), {force: true});
            }
        }
    }

    // The recording's codes become `codes`; a recording without a row gets one from its file
    // (nothing when the file is missing). True when anything was written.
    function addSigs(cid, slug, name, codes) {
        const file = fileOf(cid, slug, name);
        const list = [...new Set(codeList(codes))].sort();
        return db.tx(() => {
            let wrote = false;
            if (q.hasRec.get(cid, slug, name) === undefined) {
                const st = fs.statSync(file, {throwIfNoEntry: false});
                const row = st ? recordingRow(cid, slug, name, st) : null;
                if (row === null) {
                    return false;
                }
                q.putRec.run(row);
                wrote = true;
            }
            const had = q.sigsOf.all(cid, slug, name).map(r => r.sig);
            if (had.length === list.length && had.every((x, i) => x === list[i])) {
                return wrote;
            }
            setSigs(cid, slug, name, list);
            return true;
        });
    }

    // Deletes the row (its codes by cascade) and prunes the team's archive, then unlinks the file,
    // then removes the team folder once it is empty. True when the row or the file existed. An
    // unlink that fails throws with the row gone: the next reconcile indexes the file again.
    function remove(cid, slug, name) {
        const file = fileOf(cid, slug, name);
        const existed = size(file) !== null;
        const had = db.tx(() => {
            const n = q.delRec.run(cid, slug, name).changes;
            prune(cid, slug);
            return n > 0;
        });
        fs.rmSync(file, {force: true});
        removeIfEmpty(cid, slug);
        return had || existed;
    }

    function codes(cid, slug) {
        checkTeam(cid, slug);
        return new Set(q.teamCodes.all(cid, slug).map(r => r.sig));
    }

    // The team's archived versions, oldest first.
    function archived(cid, slug) {
        checkTeam(cid, slug);
        return q.archived.all(cid, slug).map(r => JSON.parse(r.version));
    }

    // Keeps the versions ([id, version]) a recording of the team used (usedBy) in the archive; an id
    // already there stays as it is. Then the cap: while the team has more than ARCHIVE_MAX rows, the
    // oldest no recording uses goes, then the oldest of all, with one warning. Returns how many were
    // added.
    function archiveVersions(cid, slug, versions) {
        checkTeam(cid, slug);
        return db.tx(() => {
            const set = codes(cid, slug);
            const at = now();
            let added = 0;
            for (const [id, v] of versions) {
                if (usedBy(v, set)) {
                    added += q.insArc.run(archiveRow(cid, slug, id, v, at)).changes;
                }
            }
            const over = q.arcCount.get(cid, slug).n - ARCHIVE_MAX;
            if (over > 0) {
                const all = q.arcUse.all(cid, slug);
                const drop = all.filter(r => !rowUsed(r, set)).slice(0, over);
                if (drop.length < over) {
                    const chosen = new Set(drop.map(r => r.r));
                    drop.push(...all.filter(r => !chosen.has(r.r)).slice(0, over - drop.length));
                }
                for (const r of drop) {
                    q.delArc.run(r.r);
                }
                db.afterCommit(() => console.warn(`paceline-server: club ${cid}: team ${slug}: ${drop.length} archived plan versions over the cap of ${ARCHIVE_MAX} dropped, oldest first`));
            }
            return added;
        });
    }

    // Deletes the team's archived versions no recording uses. Returns how many.
    function prune(cid, slug) {
        checkTeam(cid, slug);
        return db.tx(() => {
            const set = codes(cid, slug);
            let deleted = 0;
            for (const r of q.arcUse.all(cid, slug)) {
                if (!rowUsed(r, set)) {
                    deleted += q.delArc.run(r.r).changes;
                }
            }
            return deleted;
        });
    }

    // Takes the rider out of every archived version of the club, deleted teams' too: riders, bench
    // and his text row. The sig follows the content, the recSig and the archive time stay; a version
    // left without riders is deleted. One transaction. Returns the number of versions changed.
    // `before` (epoch ms): only versions made before it (the version's `at`; applied again after a
    // restore, erasures.mjs).
    function removeRider(cid, athleteId, {before = Infinity} = {}) {
        const aid = String(athleteId);
        if (!CID_RE.test(cid) || !ZWIFT_RE.test(aid)) {
            return 0;
        }
        return db.tx(() => {
            let changed = 0;
            for (const row of q.clubArc.all(cid)) {
                const v = JSON.parse(row.version);
                const json = isObject(v) && isObject(v.json) ? v.json : null;
                if (!json || !['riders', 'roster'].some(k => isObject(json[k]) && Object.hasOwn(json[k], aid)) || Date.parse(v.at) >= before) {
                    continue;
                }
                changed++;
                const next = {...json};
                for (const k of ['riders', 'roster']) {
                    if (isObject(next[k])) {
                        next[k] = Object.fromEntries(Object.entries(next[k]).filter(([k2]) => k2 !== aid));
                    }
                }
                if (!isObject(next.riders) || !Object.keys(next.riders).length) {
                    q.delArc.run(row.r);
                    continue;
                }
                // stripSheet keeps only the text rows still matched to a rider
                const stripped = stripSheet(next, v.text ?? null);
                const {plan} = normalizePlan(stripped.json, stripped.text);
                const rewritten = {...v, json: stripped.json, text: stripped.text, sig: plan.sig, pastSigs: [...pastSigsOf(v), v.sig]};
                q.updArc.run(archiveRow(cid, row.slug, row.id, rewritten, row.archived_at));
            }
            return changed;
        });
    }

    // ---- Remove a rider: the recordings ----

    // The riders a recording of club `cid` from session `session` (epoch ms) must not hold: those
    // removed from the club after the ride began (the erasure list, erasures.mjs; none without one).
    const erasedFor = (cid, session) => erasures ? erasures.erasedFor(cid, session) : new Set();

    // Rewrites being written: logs/.incoming holds their temp files, so discard leaves it meanwhile.
    let writing = 0;
    // the recordings that could not be read, logged already (key cid/slug/name)
    const unreadableSaid = new Set();
    // While the erasure list cannot be read the store fails closed: uploads wait (503), and the
    // reconcile holds every file it would index or correct, checked once the list is read again.
    const listBroken = () => (erasures?.broken?.() ?? null) !== null;
    const sessionOf = name => Number(LOG_NAME_RE.exec(name)[1]);
    const athleteOf = name => LOG_NAME_RE.exec(name)[2];
    const unreadable = verdict => Object.assign(new Error(`recording not read: ${verdict}`), {code: 'unreadable'});

    // Rewrites recording `name` without the riders in `gone` (withoutRiders, no row dropped for its
    // plan): streamed through checkRecording to a new file in logs/.incoming (same file system; the
    // log sweep deletes what a crash leaves there), synced, renamed over the old one, the folder
    // synced; then its index row's size and mtime follow (its stored time and plan codes stay).
    // `indexed` false: a file reconcile found without an index row, held back until this check; it
    // gets its row here (as reconcile gives one) once it is checked. 'same' when no line changed (the
    // file is not touched), 'gone' when the recording went meanwhile (its row went: a Delete, the
    // retention sweep, a purge; for a file without a row, the file went), else 'changed'. Throws
    // when the file cannot be read or written, also when its row is there but its file is not (a
    // team folder whose mount is gone: the removal is not done until it is back), code 'unreadable'
    // when it is no recording (bad gzip, a line no check passes); the old file then stays as it was.
    async function rewrite(cid, slug, name, gone, {indexed = true} = {}) {
        const file = fileOf(cid, slug, name);
        // false when the recording went; throws when its row is there without its file
        const there = () => {
            if (indexed && !has(cid, slug, name)) {
                return false;
            }
            if (size(file) === null) {
                if (indexed) {
                    throw Object.assign(new Error('recording file missing'), {code: 'ENOENT'});
                }
                return false;
            }
            return true;
        };
        if (!there()) {
            return 'gone';
        }
        writing++;
        try {
            const tmp = incoming();
            const stats = {changed: 0, dropped: 0};
            let verdict;
            try {
                verdict = await checkRecording(fs.createReadStream(file), {athleteId: athleteOf(name), maxBytes: Infinity,
                                                                           stats, file: tmp, erase: gone, vouch: false});
            } catch (e) {
                fs.rmSync(tmp, {force: true});
                throw e;
            }
            // from here on no await: the recording must still be there when the new file replaces it
            if (verdict !== 'ok') {
                if (!there()) {
                    return 'gone';
                }
                throw verdict === 'error' ? Object.assign(new Error('recording not read'), {code: 'EIO'}) : unreadable(verdict);
            }
            if (stats.changed === 0 || !there()) {
                fs.rmSync(tmp, {force: true});
                if (!there()) {
                    return 'gone';
                }
                if (indexed) {
                    refresh(cid, slug, name);
                } else {
                    addSigs(cid, slug, name, []);
                }
                return 'same';
            }
            try {
                fs.renameSync(tmp, file);
            } catch (e) {
                fs.rmSync(tmp, {force: true});
                throw e;
            }
            syncDir(path.dirname(file));
            if (indexed) {
                refresh(cid, slug, name);
            } else {
                addSigs(cid, slug, name, []);
            }
            return 'changed';
        } finally {
            writing--;
        }
    }

    // The index row's size and mtime from the file, when they differ (a rewrite, a held file checked).
    function refresh(cid, slug, name) {
        const st = fs.statSync(fileOf(cid, slug, name), {throwIfNoEntry: false});
        const row = st ? q.rowOf.get(cid, slug, name) : undefined;
        if (row && (row.bytes !== st.size || row.mtime !== Math.floor(st.mtimeMs))) {
            db.tx(() => q.setBytes.run(st.size, Math.floor(st.mtimeMs), cid, slug, name));
        }
    }

    // One file against the erasure list: the riders removed from the club after its ride began
    // (erasedFor), and the extra ones of `extra` (Map Zwift ID -> epoch ms: removed then). His own
    // upload is deleted as a captain's Delete does (remove); any other is rewritten without them.
    // 'deleted', 'changed', 'same' or 'gone'; throws as rewrite does (a failed delete with `what`).
    async function checkFile(cid, slug, name, extra, {indexed}) {
        const session = sessionOf(name);
        const gone = erasedFor(cid, session);
        for (const [aid, before] of extra) {
            if (session < before) {
                gone.add(aid);
            }
        }
        if (gone.has(athleteOf(name))) {
            try {
                return remove(cid, slug, name) ? 'deleted' : 'gone';
            } catch (e) {
                e.what = 'delete';
                throw e;
            }
        }
        if (!gone.size) {
            if (size(fileOf(cid, slug, name)) !== null) {
                if (indexed) {
                    refresh(cid, slug, name);
                } else {
                    addSigs(cid, slug, name, []);
                }
            }
            return 'same';
        }
        return rewrite(cid, slug, name, gone, {indexed});
    }

    // Runs checkFile on each of `files` ({cid, slug, name, indexed}) in order, counting into
    // {deleted, changed, failed, unreadable}. A file that fails stays as it was and is logged (the
    // club and the team, no Zwift ID): a recording no check reads counts as unreadable (another run
    // cannot fix it: a captain deletes it), any other failure as failed (a run again finishes it).
    // Each file that failed either way is pushed to `failedOut` when given.
    async function checkFiles(files, extra = new Map(), failedOut = null) {
        const out = {deleted: 0, changed: 0, failed: 0, unreadable: 0};
        for (const f of files) {
            try {
                const r = await checkFile(f.cid, f.slug, f.name, extra, {indexed: f.indexed});
                if (r === 'deleted' || r === 'changed') {
                    out[r]++;
                }
            } catch (e) {
                failedOut?.push(f);
                if (e.code === 'unreadable') {
                    out.unreadable++;
                    // once per file while the server runs: the reconcile finds it again every sweep
                    const key = `${f.cid}/${f.slug}/${f.name}`;
                    if (!unreadableSaid.has(key)) {
                        unreadableSaid.add(key);
                        console.error(`paceline-server: club ${f.cid}: team ${f.slug}: a recording that cannot be read was not checked for removed riders`
                            + (f.indexed ? '' : '; it has no index row, so captains cannot delete it: the retention sweep does, or delete it by hand'));
                    }
                } else {
                    out.failed++;
                    console.error(`paceline-server: club ${f.cid}: team ${f.slug}: ${e.what === 'delete'
                        ? 'a removed rider\'s recording not deleted' : 'a recording not rewritten without a removed rider'}: ${errCode(e)}`);
                }
            }
        }
        return out;
    }

    // One pass at a time: two passes over one file would each write it without only their rider.
    let passes = Promise.resolve();
    const queued = fn => {
        const pass = passes.then(fn);
        passes = pass.catch(() => {});
        return pass;
    };

    // Takes the riders of `extra` ([{aid, before}]: removed at `before`, epoch ms; Infinity: now) and
    // everyone on the erasure list out of the club's recordings, deleted teams' folders too: one pass
    // over the indexed files, one file at a time (checkFile). Returns {deleted, changed, failed,
    // unreadable}.
    function eraseRiders(cid, extra = []) {
        return queued(() => {
            if (!CID_RE.test(cid)) {
                return {deleted: 0, changed: 0, failed: 0, unreadable: 0};
            }
            const more = new Map();
            for (const {aid, before = Infinity} of extra) {
                const id = String(aid);
                if (ZWIFT_RE.test(id)) {
                    more.set(id, Math.max(more.get(id) ?? -Infinity, before));
                }
            }
            return checkFiles(q.clubRecs.all(cid).map(r => ({cid, slug: r.slug, name: r.name, indexed: true})), more);
        });
    }

    const eraseRider = (cid, aid, {before = Infinity} = {}) => eraseRiders(cid, [{aid, before}]);

    // Files reconcile held back or found changed (a restore of logs/ brings back what the list took
    // out): key -> {cid, slug, name, indexed}. checkHeld checks them in one pass.
    const held = new Map();
    // the keys of the held files checkHeld is checking now (out of `held` already)
    const checking = new Set();

    function checkHeld() {
        return queued(async () => {
            if (listBroken()) {
                return {deleted: 0, changed: 0, failed: 0, unreadable: 0};
            }
            const files = [...held.values()];
            held.clear();
            const keys = files.map(f => `${f.cid}/${f.slug}/${f.name}`);
            keys.forEach(k => checking.add(k));
            // a file whose check failed or that could not be read stays held until a check of it
            // succeeds (the next sweep's reconcile would hold it again anyway; until then it is not
            // served on /admin either)
            const failed = [];
            try {
                return await checkFiles(files, new Map(), failed);
            } finally {
                for (const f of failed) {
                    const key = `${f.cid}/${f.slug}/${f.name}`;
                    if (!held.has(key)) {
                        held.set(key, f);
                    }
                }
                keys.forEach(k => checking.delete(k));
            }
        });
    }

    // Whether the reconcile holds the recording back until it is checked against the erasure list
    // (held, or being checked now). The operator's download (admin-recordings.mjs) serves none such.
    const isHeld = (cid, slug, name) => held.has(`${cid}/${slug}/${name}`) || checking.has(`${cid}/${slug}/${name}`);

    // The plan codes stored with the recording (recording_sigs), sorted.
    function sigsOf(cid, slug, name) {
        checkPath(cid, slug, name);
        return q.sigsOf.all(cid, slug, name).map(r => r.sig);
    }

    // The recording's file opened for reading (a FileHandle the caller closes), null when it is gone.
    async function openFile(cid, slug, name) {
        try {
            return await fs.promises.open(fileOf(cid, slug, name), 'r');
        } catch (e) {
            if (e.code === 'ENOENT') {
                return null;
            }
            throw e;
        }
    }

    // True when an archived version of the club (deleted teams' too) lists the Zwift ID.
    function archiveLists(cid, athleteId) {
        const aid = String(athleteId);
        return CID_RE.test(cid) && q.clubArc.all(cid).some(row => {
            const v = JSON.parse(row.version);
            return isObject(v) && isObject(v.json) && ['riders', 'roster'].some(k => isObject(v.json[k]) && Object.hasOwn(v.json[k], aid));
        });
    }

    // The club's recordings, newest session first.
    function list(cid) {
        if (!CID_RE.test(cid)) {
            return [];
        }
        return q.list.all(cid).map(r => ({slug: r.slug, file: r.name, session: r.session, athlete: r.athlete, size: r.bytes}));
    }

    const recordingCount = cid => q.count.get(cid).n;

    function circleBytes(cid) {
        if (!CID_RE.test(cid)) {
            return 0;
        }
        return q.recBytes.get(cid).n + q.arcBytes.get(cid).n;
    }

    // Every club's but a trashed one's.
    const totalBytes = () => q.totalRec.get().n + q.totalArc.get().n;

    // A purged club's recordings go: its rows in the caller's transaction, logs/<cid>/ once it
    // commits.
    function dropClub(cid) {
        if (!CID_RE.test(cid)) {
            throw new TypeError(`bad club id: ${cid}`);
        }
        db.tx(() => {
            q.delClubRecs.run(cid);
            q.delClubArc.run(cid);
            db.afterCommit(() => removeClubDir(cid));
        });
    }

    // A directory's entries, or the error code when it can't be listed (missing or unreadable).
    function listing(dir) {
        try {
            return {ents: fs.readdirSync(dir, {withFileTypes: true})};
        } catch (e) {
            return {code: errCode(e)};
        }
    }

    // One walk of logs/<cid>/<slug>/<name>, then one transaction: a blob without a row gets one (no
    // codes; its size, its mtime as stored_at), a row without a blob goes, and a purged club's rows
    // go with its folder (removed after the commit). A row goes only when its team folder was
    // listed: while logs/, logs/<cid>/ or the team folder is missing or unreadable (a mount gone, a
    // permission), its rows stay, and with them their codes and the archived versions they keep;
    // one line names those folders. Any other folder stays as it is: an unknown club without a
    // tombstone (its blobs are indexed), the v1 logs/<slug>/ and logs/.incoming (not walked).
    // Remove a rider: a row whose file has another size gets the file's size, and a blob the erasure
    // list concerns (a rider removed from the club after its ride began) is held for checkHeld when
    // it has no row (it gets one once checked) or another size (a restore of logs/ brought it back).
    function reconcile() {
        const rowKeys = new Map(q.allRecs.all().map(r => [`${r.cid}/${r.slug}/${r.name}`, [r.cid, r.slug, r.name, r.bytes, r.mtime]]));
        const resized = [];
        const found = new Set();
        const fresh = [];
        const purged = [];
        const unlisted = new Map();          // folder, relative to the data dir -> error code
        const listedCids = new Set();
        const listedTeams = new Set();
        const top = listing(logsDir);
        if (top.code) {
            unlisted.set('logs/', top.code);
        }
        for (const cid of (top.ents ?? []).filter(d => d.isDirectory() && CID_RE.test(d.name)).map(d => d.name)) {
            if (q.purged.get({cid}).purged) {
                purged.push(cid);
                continue;
            }
            const club = listing(path.join(logsDir, cid));
            if (club.code) {
                unlisted.set(`logs/${cid}/`, club.code);
                continue;
            }
            listedCids.add(cid);
            for (const slug of club.ents.filter(d => d.isDirectory() && isSlug(d.name)).map(d => d.name)) {
                const team = listing(path.join(logsDir, cid, slug));
                if (team.code) {
                    unlisted.set(`logs/${cid}/${slug}/`, team.code);
                    continue;
                }
                listedTeams.add(`${cid}/${slug}`);
                for (const name of team.ents.filter(d => d.isFile() && LOG_NAME_RE.test(d.name)).map(d => d.name)) {
                    const key = `${cid}/${slug}/${name}`;
                    found.add(key);
                    if (!safeSession(name)) {
                        continue;
                    }
                    const st = fs.statSync(path.join(logsDir, cid, slug, name), {throwIfNoEntry: false});
                    const concerned = () => listBroken() || erasedFor(cid, sessionOf(name)).size > 0;
                    if (!st) {
                        continue;
                    }
                    const mtime = Math.floor(st.mtimeMs);
                    const row = rowKeys.get(key);
                    if (!row) {
                        if (concerned()) {
                            held.set(key, {cid, slug, name, indexed: false});
                        } else {
                            fresh.push(recordingRow(cid, slug, name, st));
                        }
                    } else if (row[3] !== st.size || (row[4] !== null && row[4] !== mtime)) {
                        // another copy than the row describes (a restore of logs/): checked first,
                        // its row follows once it is
                        if (concerned()) {
                            held.set(key, {cid, slug, name, indexed: true});
                        } else {
                            resized.push([st.size, mtime, cid, slug, name]);
                        }
                    } else if (row[4] === null) {
                        // a row from before schema 2: its mtime, nothing else
                        resized.push([st.size, mtime, cid, slug, name]);
                    }
                }
            }
        }
        const gone = new Set(purged);
        const missing = [];
        const kept = new Map();              // the folder named in the log line -> its error code, or null when missing
        let keptRows = 0;
        for (const [key, [cid, slug, name]] of rowKeys) {
            if (found.has(key) || gone.has(cid)) {
                continue;
            }
            if (listedTeams.has(`${cid}/${slug}`)) {
                missing.push([cid, slug, name]);
                continue;
            }
            const folder = top.code ? 'logs/' : !listedCids.has(cid) ? `logs/${cid}/` : `logs/${cid}/${slug}/`;
            const code = unlisted.get(folder) ?? null;
            kept.set(folder, code === 'ENOENT' ? null : code);
            keptRows++;
        }
        let dropped = 0;
        if (fresh.length || missing.length || purged.length || resized.length) {
            db.tx(() => {
                for (const row of fresh) {
                    q.putRec.run(row);
                }
                for (const r of resized) {
                    q.setBytes.run(...r);
                }
                for (const [cid, slug, name] of missing) {
                    dropped += q.delRec.run(cid, slug, name).changes;
                }
                for (const cid of purged) {
                    dropClub(cid);
                }
            });
        }
        const result = {indexed: fresh.length, dropped, removed: purged.length};
        if (result.indexed || result.dropped || result.removed) {
            console.log(`paceline-server: reconcile: ${result.indexed} recordings indexed, ${result.dropped} index rows of missing files dropped, ${result.removed} folders of purged clubs removed`);
        }
        if (resized.length || held.size) {
            console.log(`paceline-server: reconcile: ${resized.length} index rows corrected from their files (size or time), ${held.size} recordings to check against the erasure list first`);
        }
        if (keptRows) {
            const folders = [...kept].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([f, code]) => code ? `${f} (${code})` : f);
            console.log(`paceline-server: reconcile: ${keptRows} index rows kept, their folders are missing or unreadable: ${folders.join(', ')}`);
        }
        return result;
    }

    // reconcile(), then the uploads a crash left in logs/.incoming (after LOG_TMP_KEEP_MS), then the
    // recordings whose session (from the name, not mtime) is more than `days` old (days 0 keeps all):
    // their rows in one transaction, then the files; then the archived versions no one uses any
    // more, in every team (deleted teams' too), and the team folders left empty. A trashed club is
    // left as it is. One part's failure is logged and does not stop the rest. Returns the number of
    // recordings deleted.
    function sweep(at, days) {
        try {
            reconcile();
        } catch (e) {
            console.error(`paceline-server: log sweep: reconcile failed: ${errCode(e)}`);
        }
        try {
            dropIncoming(at);
        } catch (e) {
            console.error(`paceline-server: log sweep: an unfinished upload not deleted: ${errCode(e)}`);
        }
        let deleted = 0;
        const emptied = new Map();
        if (days > 0) {
            let old = [];
            try {
                old = db.tx(() => {
                    const list = q.old.all(at - days * DAY).map(r => [r.cid, r.slug, r.name]);
                    for (const [cid, slug, name] of list) {
                        q.delRec.run(cid, slug, name);
                    }
                    return list;
                });
            } catch (e) {
                console.error(`paceline-server: log sweep: recordings older than ${days} days not deleted: ${errCode(e)}`);
            }
            // and the files the reconcile holds without a row (not checked yet, or not readable): by
            // their session too, a trashed club's left as they are
            for (const [key, f] of held) {
                if (!f.indexed && sessionOf(f.name) < at - days * DAY && !q.trashedClub.get(f.cid)) {
                    held.delete(key);
                    old.push([f.cid, f.slug, f.name]);
                }
            }
            for (const [cid, slug, name] of old) {
                emptied.set(`${cid}/${slug}`, [cid, slug]);
                try {
                    fs.rmSync(path.join(logsDir, cid, slug, name), {force: true});
                    deleted++;
                } catch (e) {
                    // the club and the error's kind: the file name holds a Zwift ID
                    console.error(`paceline-server: log sweep of club ${cid}: a recording not deleted: ${errCode(e)}`);
                }
            }
        }
        let archivedTeams = [];
        try {
            archivedTeams = q.arcTeams.all().map(r => [r.cid, r.slug]);
        } catch (e) {
            console.error(`paceline-server: log sweep: archive not pruned: ${errCode(e)}`);
        }
        for (const [cid, slug] of archivedTeams) {
            try {
                prune(cid, slug);
            } catch (e) {
                console.error(`paceline-server: log sweep of club ${cid}: team ${slug} not pruned: ${errCode(e)}`);
            }
        }
        for (const [cid, slug] of emptied.values()) {
            try {
                removeIfEmpty(cid, slug);
            } catch (e) {
                console.error(`paceline-server: log sweep of club ${cid}: team ${slug}: its folder not removed: ${errCode(e)}`);
            }
        }
        return deleted;
    }

    return {
        get, has, incoming, discard, matches, put, adopt, remove, list, recordingCount, circleBytes, totalBytes, reconcile, sweep,
        addSigs, codes, archived, archiveVersions, prune, removeRider, dropClub,
        erasedFor, rewrite, eraseRider, eraseRiders, checkHeld, archiveLists, erasuresBroken: listBroken,
        isHeld, sigsOf, openFile,
    };
}


// ---- the content check ----

// The plan ids of a head line: its plan's riders and bench (the rule of the mod's stripForUpload).
function planIds(head) {
    const plan = isObject(head.plan) ? head.plan : null;
    const list = plan ? [...(Array.isArray(plan.riders) ? plan.riders : []), ...(Array.isArray(plan.bench) ? plan.bench : [])] : [];
    return new Set(list.filter(r => isObject(r) && r.id != null).map(r => String(r.id)));
}


// The riders (and bench) of each plan code the given stored versions had: a version's current sig,
// the one it was stored with (recSig) and the ones before a rider was removed (pastSigs), each to the
// ids its json holds now (riders and roster). A rider only ever leaves a version's json, so an
// earlier code never gains a rider here. Versions of several plans with one code pool their ids.
// Map code -> Set of ids; values that are no version are skipped.
export function knownPlans(versions) {
    const known = new Map();
    for (const v of versions) {
        if (!isObject(v) || !isObject(v.json)) {
            continue;
        }
        const ids = ['riders', 'roster'].flatMap(k => isObject(v.json[k]) ? Object.keys(v.json[k]) : []);
        const codes = [v.sig, v.recSig, ...(Array.isArray(v.pastSigs) ? v.pastSigs : [])]
            .filter(c => typeof c === 'string' && SIG_RE.test(c));
        for (const code of codes) {
            if (!known.has(code)) {
                known.set(code, new Set());
            }
            for (const id of ids) {
                known.get(code).add(id);
            }
        }
    }
    return known;
}


// True when a value parsed from a line has an own `heartrate` or `cadence` key at any depth, or
// nests deeper than LOG_MAX_DEPTH (not a recording line, and the walk stays bounded).
function forbidden(v, depth = 0) {
    if (v === null || typeof v !== 'object') {
        return false;
    }
    if (depth >= LOG_MAX_DEPTH) {
        return true;
    }
    if (Array.isArray(v)) {
        return v.some(x => forbidden(x, depth + 1));
    }
    if (Object.hasOwn(v, 'heartrate') || Object.hasOwn(v, 'cadence')) {
        return true;
    }
    return Object.values(v).some(x => forbidden(x, depth + 1));
}


const parse = line => {
    try {
        return JSON.parse(line);
    } catch (e) {
        return undefined;
    }
};


// ---- taking riders out of a recording (Remove a rider) ----

// The fields of a recording line that hold a Zwift ID as a number or a string: a row's and a plan
// entry's id, the tick's selfId and watchingId, the det fields (recording.mjs DET_ID_FIELDS, gap.id,
// the old core's det.old.puller and .frontId) and what the windows showed (shown.wheel.planned and
// .live, shown.next.id). The turn clocks' change (det.turn.change, 23 Nov 2026) names its riders in
// `from` and `to`: ID fields there only (TURN_ID_KEYS), since `from`/`to` elsewhere need not be IDs.
// Their lists (det.turn.hanging and .out, det.old.out) are lists of IDs.
const ID_KEYS = new Set(['id', 'athleteId', 'selfId', 'watchingId', 'puller', 'frontId', 'wheel', 'wheelObs', 'wheelCue', 'planned', 'live']);
const TURN_ID_KEYS = new Set([...ID_KEYS, 'from', 'to']);
// Where the walk is: 'det' (a line's det), 'det.turn', 'det.turn.change'; null elsewhere.
const scopeOf = (at, k) => at === null ? (k === 'det' ? 'det' : null) :
    at === 'det' ? (k === 'turn' ? 'det.turn' : null) : at === 'det.turn' && k === 'change' ? 'det.turn.change' : null;
// plan codes: six characters that could be all digits, never a rider
const CODE_KEYS = new Set(['planSig', 'sig', 'recSig']);
const DROP = Symbol('drop');
const idIn = (v, gone) => (typeof v === 'string' || typeof v === 'number') && gone.has(String(v));

// Value `v` (parsed from a line, nesting bounded by `forbidden`) without the riders in `gone` (a Set
// of Zwift IDs), matched only as exact values: an array loses every object whose `id` is one of them
// (a tick's rider rows, the head plan's riders and bench) and every element that is one (a list of
// IDs); an object loses every key that is one (a map by Zwift ID); an ID field (ID_KEYS) whose
// whole value is one, as a number or a string, becomes null, and so does `selfName` next to a
// `selfId` of theirs. Nothing else: no text is searched for an ID inside it (a team called
// "Rollers 2" stays when rider 2 goes), plan codes stay, and so does a number under any other key.
// The same value when nothing changed. `at`: where the walk is (scopeOf), for det.turn.change.
export function withoutRiders(v, gone, at = null) {
    if (Array.isArray(v)) {
        let changed = false;
        const out = [];
        for (const x of v) {
            if ((isObject(x) && Object.hasOwn(x, 'id') && idIn(x.id, gone)) || idIn(x, gone)) {
                changed = true;
                continue;
            }
            const y = withoutRiders(x, gone);
            changed ||= y !== x;
            out.push(y);
        }
        return changed ? out : v;
    }
    if (!isObject(v)) {
        return v;
    }
    let out = null;
    const theirs = Object.hasOwn(v, 'selfId') && idIn(v.selfId, gone);
    const keys = at === 'det.turn.change' ? TURN_ID_KEYS : ID_KEYS;
    for (const [k, x] of Object.entries(v)) {
        let y;
        if (gone.has(k)) {
            y = DROP;
        } else if (CODE_KEYS.has(k)) {
            y = x;
        } else if ((keys.has(k) && idIn(x, gone)) || (theirs && k === 'selfName' && x !== null)) {
            y = null;
        } else {
            y = withoutRiders(x, gone, scopeOf(at, k));
        }
        if (y !== x) {
            out ??= {...v};
            if (y === DROP) {
                delete out[k];
            } else {
                out[k] = y;
            }
        }
    }
    return out ?? v;
}


// Unpacks the gzip as a stream and reads it line by line: 'ok', 'refused' (not a recording as the
// mod uploads it: a head line that is no object, a later line that is no object, a `heartrate` or
// `cadence` key anywhere in any line, nesting deeper than LOG_MAX_DEPTH, or a rider row that is no
// object), 'toolarge' (more than maxBytes unpacked, a line over LOG_MAX_LINE characters, or, with
// `file`, a written line over LOG_MAX_LINE, the written lines over maxBytes in all, or the written
// file over maxOut bytes) or 'bad' (no valid gzip). When `sigs` is an array, the distinct
// plan codes (SIG_RE) of the head's `planSig` and of each later line's `det.planSig` are pushed onto
// it, at most LOG_MAX_SIGS; other values are ignored.
// A rider row is verified when it is my own (self and the uploader's id), its id is in the head's
// plan, or in the plan whose code the tick names (`det.planSig`, looked up in `known`: knownPlans of
// the team's stored versions). A row that is not verified does not refuse the recording (user, 18 Nov
// 2026: 17 Nov ZRL, the plan changed mid-race and the mod keeps the new plan's riders now); it is
// counted in `stats.dropped` when `stats` is an object, and left out of the written file.
// With `file`, the recording as it is to be stored is written there (a new file), gzip'd: each line
// that is not empty as JSON.stringify of what was parsed and checked (so a line with a key twice
// keeps only what the check saw), without the dropped rows, with `watchingId` null where its row
// went (as the mod's stripForUpload does), one line each with a newline. Streamed: neither the
// unpacked nor the written recording is held in memory, the unpacking waits while the file is
// behind. One body and `known` give the same bytes (gzip writes no time). The file is synced to disk
// on 'ok' and removed on any other verdict or an error (the promise rejects on a write error).
// Remove a rider: with `erase` (a Set of Zwift IDs) every line is also written withoutRiders them,
// and `stats.changed` counts the lines that changed; with `vouch` false no row is dropped for its
// plan (a stored recording was checked already: only the erased riders go). `gz` is the gzip as a
// Buffer, or a readable stream of it (a stored file): a stream that fails gives 'error'.
export async function checkRecording(gz, {athleteId, maxBytes, sigs = null, known = null, stats = null, file = null, maxOut = Infinity,
                                          erase = null, vouch = true}) {
    const opts = {athleteId, maxBytes, sigs, known, stats, erase: erase?.size ? erase : null, vouch};
    if (file === null) {
        return scan(gz, {...opts, sink: null});
    }
    const sink = zlib.createGzip();
    const out = fs.createWriteStream(file, {flags: 'wx', mode: 0o640});
    let written = 0, failed = null;
    const closed = new Promise(resolve => out.on('close', resolve));
    // once the file is given up (a verdict other than 'ok'), a write still on its way to the destroyed
    // stream fails with ERR_STREAM_DESTROYED: that is no write error of the upload
    let abandoned = false;
    const fail = e => {
        if (!abandoned) {
            failed ??= e;
        }
        sink.destroy();
        out.destroy();
    };
    sink.on('error', fail);
    out.on('error', fail);
    sink.on('data', c => {
        written += c.length;
        if (written > maxOut) {
            sink.emit('stop', 'toolarge');
        }
    });
    sink.pipe(out);
    let verdict = await scan(gz, {...opts, sink});
    if (verdict === 'ok' && failed === null) {
        sink.end();
    } else {
        abandoned = true;
        sink.unpipe(out);
        sink.destroy();
        out.destroy();
    }
    await closed;
    if (verdict === 'ok' && failed === null && written > maxOut) {
        verdict = 'toolarge';
    }
    if (verdict === 'ok' && failed === null) {
        try {
            const fd = fs.openSync(file, 'r');
            try {
                fs.fsyncSync(fd);
            } finally {
                fs.closeSync(fd);
            }
            return 'ok';
        } catch (e) {
            failed = e;
        }
    }
    // not a file that was there before ('wx')
    if (failed?.code !== 'EEXIST') {
        fs.rmSync(file, {force: true});
    }
    if (failed !== null) {
        throw failed;
    }
    return verdict;
}


// checkRecording's reader. With a `sink` (a writable stream) each line goes there as checkRecording
// describes; the unpacking waits while the sink is full. It stops with the verdict the sink emits
// as 'stop', or with 'error' when the sink closes (destroyed on a write error) before the end.
function scan(gz, {athleteId, maxBytes, sigs, known, stats, sink, erase = null, vouch = true}) {
    return new Promise(resolve => {
        const gunzip = zlib.createGunzip();
        const source = Buffer.isBuffer(gz) || gz instanceof Uint8Array ? null : gz;
        const decoder = new StringDecoder('utf8');
        let bytes = 0, head = null, ids = null, done = false;
        // The unfinished line as pieces with their total length, joined once when its newline
        // comes: re-joining it on every chunk would copy a long line over and over.
        let pieces = [], piecesLength = 0;

        const finish = result => {
            if (!done) {
                done = true;
                gunzip.destroy();
                source?.destroy();
                resolve(result);
            }
        };
        if (sink) {
            sink.on('stop', finish);
            sink.once('close', () => finish('error'));
        }
        const mine = row => row.self === true && String(row.id) === athleteId;
        const collect = code => {
            if (Array.isArray(sigs) && sigs.length < LOG_MAX_SIGS && typeof code === 'string' && SIG_RE.test(code) && !sigs.includes(code)) {
                sigs.push(code);
            }
        };
        let waiting = false, outBytes = 0;
        // The written lines are held to the input's caps: JSON.stringify can make a line far longer
        // than it came (9e20 is written out as 900000000000000000000), so a small body could
        // otherwise be stored as a file the check itself would refuse, at a memory cost far over
        // the budget (re-review 18 Nov 2026: 0.6 MB in, 858 MB unpacked out). A line the mod wrote is
        // JSON.stringify output already, so it comes out as long as it went in.
        const emit = obj => {
            if (!sink || done) {
                return;
            }
            const text = JSON.stringify(obj) + '\n';
            outBytes += Buffer.byteLength(text);
            if (text.length - 1 > LOG_MAX_LINE || outBytes > maxBytes) {
                finish('toolarge');
                return;
            }
            if (!sink.write(text) && !waiting) {
                waiting = true;
                gunzip.pause();
                sink.once('drain', () => {
                    waiting = false;
                    gunzip.resume();
                });
            }
        };
        // the line as written: without the erased riders (Remove a rider), counted when it changed
        const erased = obj => {
            const out = erase === null ? obj : withoutRiders(obj, erase);
            if (out !== obj && isObject(stats)) {
                stats.changed = (stats.changed ?? 0) + 1;
            }
            return out;
        };
        // false when the line is refused
        const line = text => {
            if (head === null) {
                head = parse(text);
                if (!isObject(head) || forbidden(head)) {
                    return false;
                }
                collect(head.planSig);
                head = erased(head);
                ids = planIds(head);
                emit(head);
                return true;
            }
            if (text === '') {
                return true;
            }
            const obj = parse(text);
            if (!isObject(obj) || forbidden(obj)) {
                return false;
            }
            const code = isObject(obj.det) ? obj.det.planSig : undefined;
            collect(code);
            if (!Array.isArray(obj.riders)) {
                emit(erased(obj));
                return true;
            }
            if (!obj.riders.every(isObject)) {
                return false;
            }
            const tickPlan = known instanceof Map && typeof code === 'string' ? known.get(code) ?? null : null;
            const kept = vouch ? obj.riders.filter(row => mine(row) || ids.has(String(row.id)) || (tickPlan !== null && tickPlan.has(String(row.id)))) : obj.riders;
            const dropped = obj.riders.length - kept.length;
            if (dropped === 0) {
                emit(erased(obj));
                return true;
            }
            if (isObject(stats)) {
                stats.dropped = (stats.dropped ?? 0) + dropped;
            }
            const out = {...obj, riders: kept};
            if (out.watchingId != null && !kept.some(row => String(row.id) === String(out.watchingId))) {
                out.watchingId = null;
            }
            emit(erased(out));
            return true;
        };
        const feed = text => {
            let start = 0;
            for (let nl = text.indexOf('\n'); nl >= 0 && !done; nl = text.indexOf('\n', start)) {
                const tail = text.slice(start, nl);
                if (piecesLength + tail.length > LOG_MAX_LINE) {
                    finish('toolarge');
                    return;
                }
                const whole = pieces.length ? pieces.join('') + tail : tail;
                pieces = [];
                piecesLength = 0;
                if (!line(whole)) {
                    finish('refused');
                    return;
                }
                start = nl + 1;
            }
            if (!done && start < text.length) {
                pieces.push(text.slice(start));
                piecesLength += text.length - start;
                if (piecesLength > LOG_MAX_LINE) {
                    finish('toolarge');
                }
            }
        };

        gunzip.on('data', chunk => {
            if (done) {
                return;
            }
            bytes += chunk.length;
            if (bytes > maxBytes) {
                finish('toolarge');
                return;
            }
            feed(decoder.write(chunk));
        });
        gunzip.on('end', () => {
            if (done) {
                return;
            }
            feed(decoder.end());
            if (done) {
                return;
            }
            // the last line without a newline, or the head of an empty recording
            const last = pieces.join('');
            pieces = [];
            if ((last !== '' || head === null) && !line(last)) {
                finish('refused');
                return;
            }
            finish('ok');
        });
        gunzip.on('error', () => finish('bad'));
        if (source === null) {
            gunzip.end(gz);
        } else {
            source.on('error', () => finish('error'));
            source.pipe(gunzip);
        }
    });
}


// ---- the upload ----

// Time a recording body may take from the moment it holds the upload slot (about when the headers
// came) to its last byte (controller ruling, 16 Nov 2026). Without it a trickled body holds the one
// slot until node's requestTimeout, which node checks only every 30 s. Any deadline can be
// re-triggered by an attacker who opens a new connection; it only bounds each one. The real guard
// is per-IP limits after check C5.
// 120 s lets a 20 MB file through at about 1.4 Mbit/s.
export const LOG_BODY_MS = 120 * 1000;


// The in-memory state of one server: new files per athlete, team and UTC day, and the upload slot
// (LOG_MAX_IN_FLIGHT bodies at a time).
//   tryAcquire()  takes a place for a body; false when all are taken
//   release()     gives that place back
// `bodyMs` is the body deadline (tests shorten it).
export function makeUploadState({max = LOG_MAX_IN_FLIGHT, bodyMs = LOG_BODY_MS} = {}) {
    const state = {
        inFlight: 0, day: null, perDay: new Map(), bodyMs,
        tryAcquire() {
            if (state.inFlight >= max) {
                return false;
            }
            state.inFlight++;
            return true;
        },
        release() {
            state.inFlight--;
        },
    };
    return state;
}


// Today's counts (key -> new files); a new UTC day starts empty.
function today(state, now) {
    const day = new Date(now).toISOString().slice(0, 10);
    if (state.day !== day) {
        state.day = day;
        state.perDay = new Map();
    }
    return state.perDay;
}


const answer = (res, status, obj, extra) => json(res, status, obj, {...CORS, ...extra});


// POST /api/log/<slug>?circle=<cid>&session=<ms>&athlete=<id>&mod=<x.y.z> with the gzip body.
// The checks run in the order of the plan (task 9); `slug` is the decoded path segment.
export async function handleLogUpload(req, res, {store, cfg, now, logs, state}, slug, query) {
    const session = query.get('session') ?? '';
    const athlete = query.get('athlete') ?? '';
    const mod = query.get('mod');
    const circle = query.get('circle');
    const name = `${session}-${athlete}.jsonl.gz`;
    const m = LOG_NAME_RE.exec(name);
    if (!isSlug(slug) || !m || m[1] !== session || m[2] !== athlete ||
        (mod !== null && (!MOD_RE.test(mod) || circle === null || !CID_RE.test(circle)))) {
        answer(res, 400, {error: 'bad request'});
        return;
    }
    const age = now - Number(session);
    if (age < 0 || age > LOG_SESSION_MAX_AGE) {
        answer(res, 400, {error: 'session out of range'});
        return;
    }
    if (mod === null) {
        // a 0.2.x mod (spec §6.2, §6.3: hard cut)
        answer(res, 404, {error: 'update Paceline'});
        return;
    }
    const cid = circle;
    const owner = store.slugOwner(slug);
    if (owner === null) {
        answer(res, 404, {error: 'no such team'});
        return;
    }
    const club = owner === cid ? store.get(cid) : null;
    if (!club || !Object.values(club.sheets).some(s => s.team === slug && roleIn(s, athlete) !== null)) {
        answer(res, 403, {error: 'not in this team'});
        return;
    }
    // The erasure list cannot be read (erasures.mjs): nothing is stored that it might concern; the
    // mod tries again later.
    if (logs.erasuresBroken()) {
        answer(res, 503, {error: 'busy'}, {'Retry-After': '300'});
        return;
    }
    // Removed from the club after this ride began (Remove a rider): his own recording is never
    // stored. 403 as for a rider in no plan: the mod does not send it again on its own.
    if (logs.erasedFor(cid, Number(session)).has(athlete)) {
        answer(res, 403, {error: 'not in this team'});
        return;
    }
    const key = `${slug}/${athlete}`;
    // this request's day: an upload that ends after midnight must not reset the next day's counts
    const counts = today(state, now);
    if ((counts.get(key) ?? 0) >= LOG_PER_DAY && !logs.has(cid, slug, name)) {
        answer(res, 429, {error: 'too many'});
        return;
    }
    if (!state.tryAcquire()) {
        answer(res, 503, {error: 'busy'}, {'Retry-After': '60'});
        return;
    }
    let tmp;    // the upload's file in logs/.incoming, null once it is in place
    try {
        let body;
        try {
            body = await readBody(req, cfg.logMaxFile, state.bodyMs);
        } catch (e) {
            if (e instanceof HttpError && e.status === 413) {
                answer(res, 413, {error: 'too large'}, {Connection: 'close'});
                return;
            }
            if (e instanceof HttpError && e.status === 408) {
                console.warn(`paceline-server: recording upload cut off, the body took over ${state.bodyMs / 1000} s: POST /api/log/${slug}`);
                answer(res, 408, {error: 'too slow'}, {Connection: 'close'});
                return;
            }
            throw e;
        }
        if (body.length < 2 || body[0] !== 0x1f || body[1] !== 0x8b) {
            answer(res, 400, {error: 'bad request'});
            return;
        }
        // the plans a tick may name: the team's versions in the club and in its archive
        const known = knownPlans([
            ...Object.values(store.get(cid)?.sheets ?? {}).filter(s => s.team === slug),
            ...logs.archived(cid, slug),
        ]);
        const sigs = [];
        const stats = {dropped: 0};
        // riders removed from the club since this ride began (Remove a rider): never stored
        let gone = logs.erasedFor(cid, Number(session));
        // Stored is what was checked: each line as parsed, without the rows no plan of the team
        // vouches for and without the removed riders, gzip'd again on the way to a temp file
        // (checkRecording). The body goes once it is read through.
        tmp = logs.incoming();
        const verdict = await checkRecording(body, {athleteId: athlete, maxBytes: LOG_UNPACK_FACTOR * cfg.logMaxFile, sigs, known, stats,
                                                    file: tmp, maxOut: cfg.logMaxFile, erase: gone});
        body = null;
        if (verdict !== 'ok') {
            const [status, error] = {bad: [400, 'bad request'], toolarge: [413, 'too large'], refused: [422, 'refused']}[verdict];
            answer(res, status, {error});
            return;
        }
        // A rider removed while the body was checked: the checked file again, without him too. A
        // removal lists the recordings to rewrite after it noted the rider, so this file, stored
        // after the loop with no await in between, is either rewritten here or listed there.
        for (let now2 = logs.erasedFor(cid, Number(session)); [...now2].some(x => !gone.has(x)); now2 = logs.erasedFor(cid, Number(session))) {
            gone = now2;
            const next = logs.incoming();
            const again = await checkRecording(fs.createReadStream(tmp), {athleteId: athlete, maxBytes: Infinity, file: next, erase: gone, vouch: false});
            fs.rmSync(tmp, {force: true});
            tmp = next;
            if (again !== 'ok') {
                throw new Error(`a checked recording could not be checked again: ${again}`);
            }
        }
        // removed while the body came in: his own recording goes (the removal's pass may have run)
        if (gone.has(athlete)) {
            answer(res, 403, {error: 'not in this team'});
            return;
        }
        // From here on no await: the club may have gone while the body came in, and a deleted
        // club must not get its logs/<cid> back.
        if (store.slugOwner(slug) !== cid) {
            answer(res, 404, {error: 'no such team'});
            return;
        }
        // a retry gives the same file, byte for byte
        const same = logs.matches(cid, slug, name, tmp);
        if (same === true) {
            // a retry after an index transaction that failed past the rename indexes it now; idempotent
            logs.addSigs(cid, slug, name, sigs);
            answer(res, 201, {ok: true, file: name});
            return;
        }
        if (same === false) {
            answer(res, 409, {error: 'exists'});
            return;
        }
        const size = quotaBytes(fs.statSync(tmp).size);
        if (logs.recordingCount(cid) >= LOG_MAX_FILES || logs.circleBytes(cid) + size > cfg.logMaxCircle ||
            logs.totalBytes() + size > cfg.logMaxTotal) {
            answer(res, 507, {error: 'log storage full'});
            return;
        }
        // the file goes into place, then its row and codes in one transaction
        logs.adopt(cid, slug, name, tmp, sigs);
        tmp = null;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        if (stats.dropped > 0) {
            // the club and the team only: the file name holds a Zwift ID
            console.log(`paceline-server: club ${cid}: recording for team ${slug} stored without ${stats.dropped} rider rows in no known plan of the team`);
        }
        answer(res, 201, {ok: true, file: name});
    } finally {
        try {
            if (tmp !== undefined) {
                logs.discard(tmp);
            }
        } catch (e) {
            // the answer is sent; a temp file left behind goes with the sweep after a day
            console.warn(`paceline-server: recording upload: logs/.incoming not cleaned up: ${e?.code ?? e?.name ?? 'error'}`);
        } finally {
            state.release();
        }
    }
}
