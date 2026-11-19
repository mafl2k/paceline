// The club store (spec §4). Its state lives in paceline.db (db.mjs): the clubs, the trash, the
// tombstones and retired slugs, seen and the server's own settings; at start every row is read
// into memory, and every lookup reads memory only. Every change is one synchronous step: clone,
// change, check, then one transaction, with no await in between; memory is swapped and re-indexed
// only after that transaction commits (db.afterCommit). A failed, refused or oversized write keeps
// the old state in memory and in the database. Seen is kept in memory and flushed, so a rider check
// writes nothing for it (only an event id it learns is a club change). Every lookup keyed by request
// data goes through a Map, a Set or Object.hasOwn.
import {CID_RE, ZWIFT_RE, SIG_RE, MOD_RE, SHEET_RE, nameKey, isSlug, isEventId} from './ids.mjs';
import {TxAborted} from './db.mjs';
import {isZone} from './time.mjs';
import {roleIn} from './select.mjs';
import {ClubError, MAX_CLUB_BYTES, sweepClub, sweptSheets, staleEntries, sweepInbox, clubLists} from './club.mjs';
import {hasExpired, dropExpired} from './tokens.mjs';

const HOUR = 3600000;
const DAY = 24 * HOUR;
export const PENDING_MS = 24 * HOUR;      // an unconfirmed club goes after this
export const TRASH_MS = 7 * DAY;          // a deleted club stays restorable this long
export const TOMBSTONE_MS = 30 * DAY;     // and its id answers "gone" this long
export const SEEN_MS = 14 * DAY;          // seen entries older than this are dropped
export const SEEN_MAX = 300;              // seen entries per club, the oldest `at` goes first

const HASH_RE = /^[0-9a-f]{64}$/;


const iso = ms => new Date(ms).toISOString();
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const age = (at, now) => now - (Date.parse(at) || 0);


// The five fields of a seen entry, each checked on its own (spec §4); anything else is dropped.
// `at` is the store's, added by the caller.
export function cleanSeen(entry) {
    const e = isObject(entry) ? entry : {};
    return {
        sig: typeof e.sig === 'string' && SIG_RE.test(e.sig) ? e.sig : null,
        mod: typeof e.mod === 'string' && MOD_RE.test(e.mod) ? e.mod : null,
        sheet: typeof e.sheet === 'string' && SHEET_RE.test(e.sheet) ? e.sheet : null,
        inEvent: e.inEvent === true,
        event: isEventId(e.event) ? Number(e.event) : null,
    };
}


// Why a club object cannot be loaded or stored under `cid`, or null when it can.
export function damage(c, cid) {
    if (!isObject(c)) {
        return 'not an object';
    }
    if (c.id !== cid) {
        return `id ${JSON.stringify(c.id)} is not the id it is stored under`;
    }
    if (typeof cid !== 'string' || !CID_RE.test(cid)) {
        return 'the id it is stored under is not a club id';
    }
    if (c.status !== 'pending' && c.status !== 'active') {
        return `bad status ${JSON.stringify(c.status)}`;
    }
    if (!isObject(c.teams)) {
        return 'missing teams';
    }
    if (!isObject(c.sheets)) {
        return 'missing sheets';
    }
    if (!Array.isArray(c.tokens)) {
        return 'missing tokens';
    }
    // the entries too: the index and every club operation read them as objects
    for (const [slug, team] of Object.entries(c.teams)) {
        if (!isObject(team)) {
            return `team ${JSON.stringify(slug)} is not an object`;
        }
    }
    for (const [id, sheet] of Object.entries(c.sheets)) {
        if (!isObject(sheet)) {
            return `sheet ${JSON.stringify(id)} is not an object`;
        }
        if (typeof sheet.plan !== 'string' || !SHEET_RE.test(sheet.plan) || !Number.isInteger(sheet.n) || sheet.n < 1) {
            return `sheet ${JSON.stringify(id)} has no plan version`;
        }
    }
    if (!Array.isArray(c.inbox)) {
        return 'missing inbox';
    }
    for (const [i, entry] of c.inbox.entries()) {
        if (!isObject(entry)) {
            return `inbox entry ${i} is not an object`;
        }
    }
    if (!isZone(c.tz)) {
        return `bad tz ${JSON.stringify(c.tz)}`;
    }
    // Absent (an older club) or null is an open club. The message never shows the value: it may
    // hold a hash, and a plain code must not reach the log either.
    const code = c.riderCode;
    if (code != null && !(isObject(code) && typeof code.hash === 'string' && HASH_RE.test(code.hash) &&
        typeof code.setAt === 'string')) {
        return 'bad riderCode';
    }
    return null;
}


// The load rule for clubs stored before plan versions (plan versions spec §12, no migration):
// drops every sheet without a `plan` (the old format, or written by a rolled-back image), clears a
// live pointer to one, drops every team's Undo snapshot (there is no Undo any more, plan versions
// §8) and gives a club without an inbox an empty one. Leaves alone a value that is not club-shaped
// (damage reports it). Changes only the object; the next change writes the new shape. Returns how
// many sheets went.
export function normalizeLoaded(c) {
    if (!isObject(c) || !isObject(c.teams) || !isObject(c.sheets)) {
        return 0;
    }
    const gone = new Set();
    for (const [id, sheet] of Object.entries(c.sheets)) {
        if (!isObject(sheet) || typeof sheet.plan !== 'string') {
            if (isObject(sheet)) {
                gone.add(id);
                delete c.sheets[id];
            }
        }
    }
    for (const team of Object.values(c.teams)) {
        if (!isObject(team)) {
            continue;
        }
        if (typeof team.live === 'string' && gone.has(team.live)) {
            team.live = null;
        }
        delete team.undo;
    }
    if (c.inbox === undefined) {
        c.inbox = [];
    }
    return gone.size;
}


// The registration setting's values: open, closed, or null (the REGISTRATION variable decides).
export const REGISTRATION = new Set(['open', 'closed', null]);


// The error change() throws when the archive of the versions it drops cannot be written and the
// caller asked to keep them ('retry', the sweep). The store has logged it already.
export class ArchiveHeld extends Error {}


// `db` is paceline.db (db.mjs openDb). `archive` is the log store (logs.mjs) that keeps the versions
// a recording used and the recordings themselves, a test double, or null (then nothing is archived
// and no recording folder is removed). Every method that writes runs its SQL in one db.tx (a
// savepoint inside a caller's transaction) and changes memory only once that commits.
export function openStore({db, now, archive = null}) {
    const sql = db.sql;
    const q = {
        insClub: sql.prepare('INSERT INTO clubs (cid, json) VALUES (?, ?)'),
        updClub: sql.prepare('UPDATE clubs SET json = ? WHERE cid = ?'),
        delClub: sql.prepare('DELETE FROM clubs WHERE cid = ?'),
        getTrash: sql.prepare('SELECT json FROM trash WHERE cid = ?'),
        insTrash: sql.prepare('INSERT INTO trash (cid, json, name, name_key, slugs, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
        delTrash: sql.prepare('DELETE FROM trash WHERE cid = ?'),
        tomb: sql.prepare('INSERT INTO tombstone_clubs (cid, deleted_at) VALUES (?, ?) ON CONFLICT (cid) DO UPDATE SET deleted_at = excluded.deleted_at'),
        delTomb: sql.prepare('DELETE FROM tombstone_clubs WHERE cid = ?'),
        retire: sql.prepare('INSERT OR IGNORE INTO retired_slugs (slug) VALUES (?)'),
        putSeen: sql.prepare(`INSERT INTO seen (cid, athlete, sig, mod, sheet, in_event, event, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (cid, athlete) DO UPDATE SET sig = excluded.sig, mod = excluded.mod, sheet = excluded.sheet,
            in_event = excluded.in_event, event = excluded.event, at = excluded.at`),
        delSeen: sql.prepare('DELETE FROM seen WHERE cid = ? AND athlete = ?'),
        delSeenClub: sql.prepare('DELETE FROM seen WHERE cid = ?'),
        setSetting: sql.prepare('INSERT INTO settings (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value'),
    };

    const clubs = new Map();          // cid -> club, pending and active
    const byAthlete = new Map();      // athlete id -> Map(cid -> [{slug, id}]), live sheets of active clubs
    const slugIndex = new Map();      // slug -> cid, the teams of pending and active clubs
    const tokenIndex = new Map();     // token hash -> {cid, token}, pending and active clubs
    const codeIndex = new Map();      // rider code hash -> cid, active clubs
    const indexed = new Map();        // cid -> {aids, slugs, hashes, code, key}: what to take out on re-index
    const trashed = new Map();        // cid -> {id, name, key, slugs, createdAt, deletedAt, bytes}
    const tombstones = {circles: new Map(), slugs: new Set()};   // cid -> deletedAt; retired slugs
    const seen = new Map();           // cid -> Map(athlete id -> entry)
    let dirty = new Map();            // cid -> Set(athlete id): seen entries the next flush writes or deletes
    let settings = {registration: null};
    const archiveHeld = new Set();    // cids whose 'retry' archive failed and was logged, until it works

    const archiveBytes = cid => archive?.circleBytes?.(cid) ?? 0;

    function unindex(cid) {
        const entry = indexed.get(cid);
        if (!entry) {
            return;
        }
        for (const aid of entry.aids) {
            const m = byAthlete.get(aid);
            m.delete(cid);
            if (!m.size) {
                byAthlete.delete(aid);
            }
        }
        for (const slug of entry.slugs) {
            if (slugIndex.get(slug) === cid) {
                slugIndex.delete(slug);
            }
        }
        for (const hash of entry.hashes) {
            if (tokenIndex.get(hash)?.cid === cid) {
                tokenIndex.delete(hash);
            }
        }
        if (entry.code !== null && codeIndex.get(entry.code) === cid) {
            codeIndex.delete(entry.code);
        }
        indexed.delete(cid);
    }

    function reindex(cid) {
        unindex(cid);
        const c = clubs.get(cid);
        if (!c) {
            return;
        }
        const entry = {aids: new Set(), slugs: Object.keys(c.teams), hashes: [], code: null, key: nameKey(c.name)};
        for (const slug of entry.slugs) {
            slugIndex.set(slug, cid);
        }
        for (const token of c.tokens) {
            if (isObject(token) && typeof token.hash === 'string') {
                tokenIndex.set(token.hash, {cid, token});
                entry.hashes.push(token.hash);
            }
        }
        if (c.status === 'active') {
            if (c.riderCode != null) {
                codeIndex.set(c.riderCode.hash, cid);
                entry.code = c.riderCode.hash;
            }
            for (const [slug, team] of Object.entries(c.teams)) {
                const id = team?.live;
                if (typeof id !== 'string' || !Object.hasOwn(c.sheets, id)) {
                    continue;
                }
                const sheet = c.sheets[id];
                const candidates = [...Object.keys(sheet.json?.riders || {}), ...Object.keys(sheet.json?.roster || {})];
                for (const aid of new Set(candidates)) {
                    if (roleIn(sheet, aid) === null) {
                        continue;
                    }
                    if (!byAthlete.has(aid)) {
                        byAthlete.set(aid, new Map());
                    }
                    const m = byAthlete.get(aid);
                    if (!m.has(cid)) {
                        m.set(cid, []);
                    }
                    m.get(cid).push({slug, id});
                    entry.aids.add(aid);
                }
            }
        }
        indexed.set(cid, entry);
    }

    function markSeen(cid, aid) {
        if (!dirty.has(cid)) {
            dirty.set(cid, new Set());
        }
        dirty.get(cid).add(aid);
    }

    // The club's seen rows go in the caller's transaction; memory once it commits.
    function dropSeen(cid) {
        q.delSeenClub.run(cid);
        db.afterCommit(() => {
            seen.delete(cid);
            dirty.delete(cid);
        });
    }

    // The tombstone and the retired slugs of a club that goes, in the caller's transaction; memory
    // once it commits.
    function tombstone(cid, c, at) {
        const slugs = Object.keys(c.teams).filter(isSlug);
        q.tomb.run(cid, at);
        for (const slug of slugs) {
            q.retire.run(slug);
        }
        db.afterCommit(() => {
            tombstones.circles.set(cid, at);
            for (const slug of slugs) {
                tombstones.slugs.add(slug);
            }
        });
    }

    // JSON text, the load rule, the checks. Throws Error(`<prefix>: <reason>`). With `warn`, logs
    // the sheets the load rule dropped.
    function parseClub(json, cid, prefix, {warn = false} = {}) {
        let c;
        try {
            c = JSON.parse(json);
        } catch (e) {
            throw new Error(`${prefix}: ${e.message}`);
        }
        const dropped = normalizeLoaded(c);
        const why = damage(c, cid);
        if (why) {
            throw new Error(`${prefix}: ${why}`);
        }
        if (warn && dropped > 0) {
            console.warn(`paceline-server: club ${cid}: ${dropped} plans in the old format dropped (no plan versions); its teams stay`);
        }
        return c;
    }

    // ---- load ----

    for (const {cid, json} of sql.prepare('SELECT cid, json FROM clubs ORDER BY cid').iterate()) {
        const prefix = `damaged club ${cid} in paceline.db`;
        const c = parseClub(json, cid, prefix, {warn: true});
        clubs.set(cid, c);
        try {
            reindex(cid);
        } catch (e) {
            throw new Error(`${prefix}: ${e.message}`);
        }
    }

    // The trash keeps the club's JSON unparsed until a restore.
    for (const row of sql.prepare(`SELECT cid, name, name_key, slugs, created_at, deleted_at,
        length(CAST(json AS BLOB)) AS json_bytes FROM trash ORDER BY cid`).iterate()) {
        const cid = row.cid;
        if (!CID_RE.test(cid)) {
            console.warn(`paceline-server: skipping trashed club ${JSON.stringify(cid)}: not a club id`);
            continue;
        }
        if (clubs.has(cid)) {
            console.warn(`paceline-server: skipping trashed club ${cid}: it is also active, the active one is kept`);
            continue;
        }
        let slugs;
        try {
            slugs = JSON.parse(row.slugs);
        } catch {
            slugs = null;
        }
        if (!Array.isArray(slugs) || !slugs.every(s => typeof s === 'string')) {
            console.warn(`paceline-server: skipping trashed club ${cid}: its slugs are not a list`);
            continue;
        }
        trashed.set(cid, {
            id: cid, name: row.name, key: row.name_key, slugs: new Set(slugs), createdAt: row.created_at, deletedAt: row.deleted_at,
            bytes: row.json_bytes + archiveBytes(cid),
        });
    }

    for (const {cid, deleted_at: at} of sql.prepare('SELECT cid, deleted_at FROM tombstone_clubs').iterate()) {
        tombstones.circles.set(cid, at);
    }
    for (const {slug} of sql.prepare('SELECT slug FROM retired_slugs ORDER BY slug').iterate()) {
        tombstones.slugs.add(slug);
    }

    // checked as a check is: the five fields on their own, a valid time
    for (const r of sql.prepare('SELECT * FROM seen ORDER BY cid, at').iterate()) {
        if (!CID_RE.test(r.cid) || !ZWIFT_RE.test(r.athlete) || Number.isNaN(Date.parse(r.at))) {
            continue;
        }
        if (!seen.has(r.cid)) {
            seen.set(r.cid, new Map());
        }
        seen.get(r.cid).set(r.athlete, {
            ...cleanSeen({sig: r.sig, mod: r.mod, sheet: r.sheet, inEvent: r.in_event === 1, event: r.event}),
            at: iso(Date.parse(r.at)),
        });
    }

    const reg = sql.prepare("SELECT value FROM settings WHERE name = 'registration'").get();
    if (reg) {
        let v;
        try {
            v = JSON.parse(reg.value);
        } catch {
            v = undefined;
        }
        if (REGISTRATION.has(v)) {
            settings = {registration: v};
        } else {
            console.warn('paceline-server: the registration setting in paceline.db is not "open", "closed" or null; counted as unset');
        }
    }

    // ---- clubs ----

    function get(cid) {
        const c = clubs.get(cid);
        return c && c.status === 'active' ? c : null;
    }

    function getAny(cid) {
        return clubs.get(cid) ?? null;
    }

    // Clubs of one status, oldest first.
    function listOf(status) {
        return [...clubs.values()].filter(c => c.status === status)
            .sort((a, b) => ((Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0)) || (a.id < b.id ? -1 : 1));
    }

    const active = () => listOf('active');
    const pending = () => listOf('pending');

    function count(status) {
        let n = 0;
        for (const c of clubs.values()) {
            n += c.status === status ? 1 : 0;
        }
        return n;
    }

    // Stores a new club (pending from newClub, or active). Its id must be unused everywhere.
    function create(club) {
        const cid = club?.id;
        const why = damage(club, cid);
        if (why) {
            throw new TypeError(`bad club: ${why}`);
        }
        if (clubs.has(cid) || trashed.has(cid) || tombstones.circles.has(cid)) {
            throw new Error(`club id ${cid} is in use`);
        }
        const c = structuredClone(club);
        const json = JSON.stringify(c);
        if (Buffer.byteLength(json) > MAX_CLUB_BYTES) {
            throw new ClubError('too-big');
        }
        db.tx(() => {
            q.insClub.run(cid, json);
            db.afterCommit(() => {
                clubs.set(cid, c);
                reindex(cid);
            });
        });
        return c;
    }

    // Runs fn on a clone of the club (pending or active) and checks the clone as a stored club:
    // {result, c, json}. `what` names the caller in the errors.
    function onClone(cid, fn, what) {
        const old = clubs.get(cid);
        if (!old) {
            throw new ClubError('not-found');
        }
        const c = structuredClone(old);
        const result = fn(c);
        if (result && typeof result.then === 'function') {
            throw new TypeError(`store.${what}: fn must be synchronous`);
        }
        const why = damage(c, cid);
        if (why) {
            throw new Error(`store.${what} broke club ${cid}: ${why}`);
        }
        // clubBytes(c), stringified once for both the check and the write.
        const json = JSON.stringify(c);
        if (Buffer.byteLength(json) > MAX_CLUB_BYTES) {
            throw new ClubError('too-big');
        }
        return {result, c, json};
    }

    // The versions the old club has and the changed one lacks go to the archive, per old team
    // (plan versions spec §4.3, §11, Ruling 14), in change's transaction. When the archive fails:
    // with 'retry' nothing is written (ArchiveHeld; one line per club until it works), with 'force'
    // the change goes on and, once it commits, one line names the club and the count of versions
    // deleted without archive. An archive whose transaction SQLite ended (TxAborted, or no
    // transaction open any more) fails the change in either mode: a statement after it would
    // autocommit. A write SQLite refused in the archive's own savepoint fails a forced change too:
    // never go on writing after a SQLite error.
    function archiveDropped(cid, old, c, mode) {
        const byTeam = new Map();
        for (const [id, v] of Object.entries(old.sheets)) {
            if (!Object.hasOwn(c.sheets, id)) {
                if (!byTeam.has(v.team)) {
                    byTeam.set(v.team, []);
                }
                byTeam.get(v.team).push([id, v]);
            }
        }
        if (!byTeam.size) {
            return;
        }
        let lost = 0;
        let why = null;
        for (const [slug, list] of byTeam) {
            try {
                archive.archiveVersions(cid, slug, list);
            } catch (e) {
                if (e instanceof TxAborted || !sql.isTransaction) {
                    throw e;
                }
                if (mode === 'retry') {
                    if (!archiveHeld.has(cid)) {
                        archiveHeld.add(cid);
                        console.warn(`paceline-server: club ${cid}: plan versions not archived, kept in the club for the next sweep: ${e.message}`);
                    }
                    throw new ArchiveHeld(`club ${cid}: the archive failed, nothing changed`);
                }
                if (e?.code === 'ERR_SQLITE_ERROR') {
                    throw e;
                }
                lost += list.length;
                why = e;
            }
        }
        db.afterCommit(() => {
            if (why) {
                console.warn(`paceline-server: club ${cid}: ${lost} plan versions deleted without archive: ${why.message}`);
            } else {
                archiveHeld.delete(cid);
            }
        });
    }

    // Runs fn on a clone of the club (pending or active) and stores the clone. fn must be
    // synchronous. Returns fn's result. `archive`: 'force' (the default), 'retry' (the sweep) or
    // false (Remove a rider rewrites the archive in `also`), as archiveDropped says. `also`, if
    // given, is synchronous and runs in the change's transaction once the clone passed its checks,
    // before the archive and the club row are written: its store and log store writes commit or
    // roll back with the club (memory only after the commit), and a throw in it fails the change.
    function change(cid, fn, {archive: mode = 'force', also = null} = {}) {
        const old = clubs.get(cid);
        const {result, c, json} = onClone(cid, fn, 'change');
        db.tx(() => {
            if (also) {
                const r = also();
                if (r && typeof r.then === 'function') {
                    throw new TypeError('store.change: also must be synchronous');
                }
            }
            if (archive && mode !== false) {
                archiveDropped(cid, old, c, mode);
            }
            q.updClub.run(json, cid);
            db.afterCommit(() => {
                clubs.set(cid, c);
                reindex(cid);
            });
        });
        return result;
    }

    // What change would do, with the same checks, and nothing written or swapped (the upload
    // preview): {result, club}, `club` the changed clone.
    function dryRun(cid, fn) {
        const {result, c} = onClone(cid, fn, 'dryRun');
        return {result, club: c};
    }

    function removePending(cid) {
        const c = clubs.get(cid);
        if (!c || c.status !== 'pending') {
            return false;
        }
        db.tx(() => {
            q.delClub.run(cid);
            dropSeen(cid);
            db.afterCommit(() => {
                clubs.delete(cid);
                unindex(cid);
            });
        });
        return true;
    }

    // ---- lookups ----

    function listedIn(athleteId) {
        const aid = String(athleteId);
        const m = ZWIFT_RE.test(aid) ? byAthlete.get(aid) : undefined;
        if (!m) {
            return [];
        }
        const out = [];
        for (const [cid, list] of m) {
            for (const {slug, id} of list) {
                out.push({cid, slug, id});
            }
        }
        return out;
    }

    function slugTaken(slug) {
        if (typeof slug !== 'string') {
            return false;
        }
        if (slugIndex.has(slug) || tombstones.slugs.has(slug)) {
            return true;
        }
        for (const t of trashed.values()) {
            if (t.slugs.has(slug)) {
                return true;
            }
        }
        return false;
    }

    function slugOwner(slug) {
        const cid = slugIndex.get(slug);
        return cid !== undefined && clubs.get(cid).status === 'active' ? cid : null;
    }

    function nameTaken(key, exceptCid = null) {
        if (typeof key !== 'string' || !key) {
            return false;
        }
        for (const [cid, entry] of indexed) {
            if (cid !== exceptCid && entry.key === key && clubs.get(cid).status === 'active') {
                return true;
            }
        }
        for (const [cid, t] of trashed) {
            if (cid !== exceptCid && t.key === key) {
                return true;
            }
        }
        return false;
    }

    function tokenOwner(hash) {
        return typeof hash === 'string' && HASH_RE.test(hash) ? (tokenIndex.get(hash) ?? null) : null;
    }

    // The active club whose rider code has this hash, else null.
    function codeOwner(hash) {
        return typeof hash === 'string' && HASH_RE.test(hash) ? (codeIndex.get(hash) ?? null) : null;
    }

    // ---- tombstones and trash ----

    function retireSlugs(slugs) {
        const add = [...new Set(slugs)].filter(s => isSlug(s) && !tombstones.slugs.has(s));
        if (add.length) {
            db.tx(() => {
                for (const slug of add) {
                    q.retire.run(slug);
                }
                db.afterCommit(() => {
                    for (const slug of add) {
                        tombstones.slugs.add(slug);
                    }
                });
            });
        }
        return add.length;
    }

    // One transaction: the tombstone, the retired slugs, the club row into the trash, its seen rows
    // out. Its recordings stay in logs/<cid>/ (the log store leaves a trashed club's out of the
    // quota and of retention).
    function trash(cid) {
        const c = get(cid);
        if (!c) {
            throw new ClubError('not-found');
        }
        const at = iso(now());
        const json = JSON.stringify(c);
        const name = String(c.name ?? '');
        const key = nameKey(name) ?? '';
        const slugs = Object.keys(c.teams);
        // before the transaction: a failing lookup must not leave memory half-changed after a commit
        const bytes = Buffer.byteLength(json) + archiveBytes(cid);
        db.tx(() => {
            tombstone(cid, c, at);
            q.delClub.run(cid);
            q.insTrash.run(cid, json, name, key, JSON.stringify(slugs), c.createdAt ?? null, at);
            dropSeen(cid);
            db.afterCommit(() => {
                clubs.delete(cid);
                unindex(cid);
                trashed.set(cid, {id: cid, name, key, slugs: new Set(slugs), createdAt: c.createdAt ?? null, deletedAt: at, bytes});
            });
        });
    }

    function trashedList() {
        return [...trashed.values()].sort((a, b) => (a.deletedAt < b.deletedAt ? -1 : a.deletedAt > b.deletedAt ? 1 : 0))
            .map(({id, name, createdAt, deletedAt, bytes}) => ({id, name, createdAt, deletedAt, bytes}));
    }

    // Brings a trashed club back. `fn(club)`, synchronous, changes it before it is written (admin.mjs
    // ends its links there), so the club never comes back unchanged: when `fn` throws or the result
    // breaks a cap, nothing is restored. Without `fn` the club comes back as it was. Its slugs stay
    // retired, which only keeps them from other clubs. One transaction: the trash row back into
    // clubs, the tombstone out.
    function restore(cid, fn = null) {
        if (!trashed.has(cid)) {
            throw new ClubError('not-found');
        }
        if (clubs.has(cid)) {
            throw new Error(`club ${cid} is active already`);
        }
        const prefix = `damaged trashed club ${cid} in paceline.db`;
        const row = q.getTrash.get(cid);
        if (!row) {
            throw new Error(`${prefix}: no row`);
        }
        const c = parseClub(row.json, cid, prefix);
        if (fn) {
            const result = fn(c);
            if (result && typeof result.then === 'function') {
                throw new TypeError('store.restore: fn must be synchronous');
            }
            const why = damage(c, cid);
            if (why) {
                throw new Error(`store.restore broke club ${cid}: ${why}`);
            }
        }
        const json = JSON.stringify(c);
        if (Buffer.byteLength(json) > MAX_CLUB_BYTES) {
            throw new ClubError('too-big');
        }
        db.tx(() => {
            q.delTrash.run(cid);
            q.insClub.run(cid, json);
            q.delTomb.run(cid);
            db.afterCommit(() => {
                trashed.delete(cid);
                tombstones.circles.delete(cid);
                clubs.set(cid, c);
                reindex(cid);
            });
        });
        return c;
    }

    function purgeTrash(cid) {
        db.tx(() => {
            archive?.dropClub?.(cid);
            q.delTrash.run(cid);
            db.afterCommit(() => trashed.delete(cid));
        });
    }

    // Deletes a trashed or active club for good, with its recordings (removed once the transaction
    // commits).
    function purge(cid) {
        if (trashed.has(cid)) {
            purgeTrash(cid);
            return;
        }
        const c = get(cid);
        if (!c) {
            throw new ClubError('not-found');
        }
        db.tx(() => {
            archive?.dropClub?.(cid);
            tombstone(cid, c, iso(now()));
            q.delClub.run(cid);
            dropSeen(cid);
            db.afterCommit(() => {
                clubs.delete(cid);
                unindex(cid);
            });
        });
    }

    function gone(cid) {
        const at = tombstones.circles.get(cid);
        return at !== undefined && age(at, now()) < TOMBSTONE_MS;
    }

    // ---- seen ----
    // In memory; see() and the pruning on read write nothing and mark what changed, flushSeen()
    // writes that (every 60 s and on close) in one transaction.

    // Records a check for an active club, only for a Zwift ID one of its sheets lists. The entry is
    // cleaned field by field; `at` is the store's now.
    function see(cid, athleteId, entry) {
        const aid = String(athleteId);
        const club = ZWIFT_RE.test(aid) ? get(cid) : null;
        if (!club || !clubLists(club, aid)) {
            return false;
        }
        if (!seen.has(cid)) {
            seen.set(cid, new Map());
        }
        const m = seen.get(cid);
        m.delete(aid);
        m.set(aid, {...cleanSeen(entry), at: iso(now())});
        markSeen(cid, aid);
        if (m.size > SEEN_MAX) {
            let oldest = null;
            for (const [k, e] of m) {
                if (oldest === null || (Date.parse(e.at) || 0) < (Date.parse(m.get(oldest).at) || 0)) {
                    oldest = k;
                }
            }
            m.delete(oldest);
            markSeen(cid, oldest);
        }
        return true;
    }

    function pruneSeen(cid, t) {
        const m = seen.get(cid);
        if (!m) {
            return;
        }
        for (const [aid, e] of m) {
            if (age(e.at, t) > SEEN_MS) {
                m.delete(aid);
                markSeen(cid, aid);
            }
        }
        if (!m.size) {
            seen.delete(cid);
        }
    }

    function seenOf(cid) {
        pruneSeen(cid, now());
        const m = seen.get(cid);
        return m ? Object.fromEntries([...m].map(([aid, e]) => [aid, {...e}])) : {};
    }

    // Takes the rider's entry out now, row included (Remove a rider).
    function forget(cid, athleteId) {
        const aid = String(athleteId);
        if (!CID_RE.test(cid) || !ZWIFT_RE.test(aid)) {
            return;
        }
        db.tx(() => {
            q.delSeen.run(cid, aid);
            db.afterCommit(() => {
                const m = seen.get(cid);
                if (m?.delete(aid) && !m.size) {
                    seen.delete(cid);
                }
                const d = dirty.get(cid);
                if (d?.delete(aid) && !d.size) {
                    dirty.delete(cid);
                }
            });
        });
    }

    // Writes what changed since the last flush in one transaction: each changed entry still in
    // memory, and deletes the rows of those that went. False when nothing changed. A failed flush
    // keeps everything for the next one.
    function flushSeen() {
        if (!dirty.size) {
            return false;
        }
        db.tx(() => {
            for (const [cid, aids] of dirty) {
                const m = seen.get(cid);
                for (const aid of aids) {
                    const e = m?.get(aid);
                    if (e) {
                        q.putSeen.run(cid, aid, e.sig, e.mod, e.sheet, e.inEvent ? 1 : 0, e.event, e.at);
                    } else {
                        q.delSeen.run(cid, aid);
                    }
                }
            }
            db.afterCommit(() => {
                dirty = new Map();
            });
        });
        return true;
    }

    // ---- settings ----

    function serverSettings() {
        return {...settings};
    }

    function setRegistration(v) {
        if (!REGISTRATION.has(v)) {
            throw new TypeError(`bad registration ${v}`);
        }
        db.tx(() => {
            q.setSetting.run('registration', JSON.stringify(v));
            db.afterCommit(() => {
                settings = {...settings, registration: v};
            });
        });
    }

    // ---- sweep ----

    // Old sheets and expired tokens of active clubs (only clubs where a dry run
    // deletes something are written; an expired email token still holds an unconfirmed new
    // address), pending clubs after 24 h, trash after 7 days, tombstoned ids after 30 days, and
    // seen. One club's failure does not stop the rest.
    function sweep() {
        const t = now();
        const out = {sheets: 0, inbox: 0, pending: 0, trash: 0, tombstones: 0};
        const attempt = (what, fn) => {
            try {
                fn();
            } catch (e) {
                if (!(e instanceof ArchiveHeld)) {
                    console.error(`paceline-server: sweep ${what}: ${e.message}`);
                }
            }
        };
        for (const [cid, c] of [...clubs]) {
            if (c.status === 'pending') {
                if (age(c.createdAt, t) > PENDING_MS) {
                    attempt(`pending ${cid}`, () => {
                        out.pending += removePending(cid) ? 1 : 0;
                    });
                }
            } else {
                // A dry run that only reads (no clone of every club every 10 minutes): only a club
                // that loses inbox entries, tokens or sheets is cloned and written. The inbox and the
                // tokens go in a change of their own, so an archive that holds the sheets ('retry')
                // never keeps personal data past its time.
                attempt(`inbox and tokens ${cid}`, () => {
                    if (staleEntries(c, t) > 0 || hasExpired(c, t)) {
                        out.inbox += change(cid, x => {
                            dropExpired(x, t);
                            return sweepInbox(x, t);
                        });
                    }
                });
                attempt(`sheets ${cid}`, () => {
                    const cur = clubs.get(cid);
                    if (cur && sweptSheets(cur, t).length > 0) {
                        out.sheets += change(cid, x => sweepClub(x, t), {archive: 'retry'});
                    }
                });
            }
        }
        for (const [cid, meta] of [...trashed]) {
            if (age(meta.deletedAt, t) > TRASH_MS) {
                attempt(`trash ${cid}`, () => {
                    purgeTrash(cid);
                    out.trash++;
                });
            }
        }
        const expired = [...tombstones.circles].filter(([cid, at]) => age(at, t) > TOMBSTONE_MS && !trashed.has(cid)).map(([cid]) => cid);
        if (expired.length) {
            attempt('tombstones', () => {
                db.tx(() => {
                    for (const cid of expired) {
                        q.delTomb.run(cid);
                    }
                    db.afterCommit(() => {
                        for (const cid of expired) {
                            tombstones.circles.delete(cid);
                        }
                    });
                });
                out.tombstones += expired.length;
            });
        }
        for (const cid of [...seen.keys()]) {
            if (get(cid)) {
                pruneSeen(cid, t);
            } else {
                attempt(`seen ${cid}`, () => db.tx(() => dropSeen(cid)));
            }
        }
        return out;
    }

    return {
        get, getAny, active, pending, pendingCount: () => count('pending'), activeCount: () => count('active'),
        create, change, dryRun, removePending,
        listedIn, slugTaken, slugOwner, nameTaken, tokenOwner, codeOwner,
        retireSlugs, trash, trashed: trashedList, restore, purge, gone,
        see, seenOf, forget, flushSeen,
        serverSettings, setRegistration,
        sweep,
    };
}
