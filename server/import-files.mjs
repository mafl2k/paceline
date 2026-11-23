// The one-time import of the 0.3 file layout of DATA_DIR into paceline.db (importFiles), and the
// readers of that layout (circles/<cid>.json, trash/<cid>/circle.json, tombstones.json, seen.json,
// server.json), moved out of store.mjs. Since paceline.db the store reads none of these files.
// Delete this module in the first release after 0.3 is in production.
import fs from 'node:fs';
import path from 'node:path';
import {CID_RE, SIG_RE, ZWIFT_RE, isSlug, nameKey} from './ids.mjs';
import {localDate} from './time.mjs';
import {normalizeLoaded, damage, cleanSeen, REGISTRATION} from './store.mjs';
import {LOG_NAME_RE, ARCHIVE_MAX, archiveRow, recordingRow} from './logs.mjs';

const iso = ms => new Date(ms).toISOString();
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);


// Reads and checks one club file, after the load rule (store.mjs normalizeLoaded, which converts a
// club in the 0.3 shape to races at `now`). Throws Error(`<prefix>: <reason>`). With `warn` (true for
// console.warn, or a function), logs the sheets the load rule dropped.
export function readClub(file, cid, prefix, {warn = false, now = Date.now()} = {}) {
    let c;
    try {
        c = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        throw new Error(`${prefix}: ${e.message}`);
    }
    const dropped = normalizeLoaded(c, now);
    const why = damage(c, cid);
    if (why) {
        throw new Error(`${prefix}: ${why}`);
    }
    if (warn && dropped > 0) {
        (typeof warn === 'function' ? warn : console.warn)(`paceline-server: club ${cid}: ${dropped} plans in the old format dropped (no plan versions); its teams stay`);
    }
    return c;
}


// The JSON in `file`, or undefined when the file does not exist. Other read errors and bad JSON
// throw.
export function readJson(file) {
    let text;
    try {
        text = fs.readFileSync(file, 'utf8');
    } catch (e) {
        if (e.code === 'ENOENT') {
            return undefined;
        }
        throw e;
    }
    return JSON.parse(text);
}


export function loadTombstones(file) {
    let t;
    try {
        t = readJson(file);
    } catch (e) {
        throw new Error(`damaged tombstones.json: ${e.message}`);
    }
    if (t === undefined) {
        return {circles: new Map(), slugs: new Set()};
    }
    if (!isObject(t) || !isObject(t.circles) || !Array.isArray(t.slugs)) {
        throw new Error('damaged tombstones.json: expected {circles: {}, slugs: []}');
    }
    const circles = new Map();
    for (const [cid, at] of Object.entries(t.circles)) {
        if (!CID_RE.test(cid) || typeof at !== 'string' || Number.isNaN(Date.parse(at))) {
            throw new Error(`damaged tombstones.json: circles entry ${JSON.stringify(cid)}`);
        }
        circles.set(cid, at);
    }
    for (const s of t.slugs) {
        if (!isSlug(s)) {
            throw new Error(`damaged tombstones.json: slug ${JSON.stringify(s)}`);
        }
    }
    return {circles, slugs: new Set(t.slugs)};
}


export function loadSeen(file, {warn = console.warn} = {}) {
    const seen = new Map();
    let raw;
    try {
        raw = readJson(file);
    } catch (e) {
        warn(`paceline-server: damaged seen.json, starting empty: ${e.message}`);
        return seen;
    }
    if (raw === undefined) {
        return seen;
    }
    if (!isObject(raw)) {
        warn('paceline-server: damaged seen.json, starting empty: not an object');
        return seen;
    }
    for (const [cid, riders] of Object.entries(raw)) {
        if (!CID_RE.test(cid) || !isObject(riders)) {
            continue;
        }
        const m = new Map();
        for (const [aid, e] of Object.entries(riders)) {
            if (ZWIFT_RE.test(aid) && isObject(e) && typeof e.at === 'string' && !Number.isNaN(Date.parse(e.at))) {
                m.set(aid, {...cleanSeen(e), at: iso(Date.parse(e.at))});
            }
        }
        if (m.size) {
            seen.set(cid, m);
        }
    }
    return seen;
}


export function loadSettings(file, {warn = console.warn} = {}) {
    let raw;
    try {
        raw = readJson(file);
    } catch (e) {
        warn(`paceline-server: damaged server.json, starting empty: ${e.message}`);
        return {registration: null};
    }
    if (raw === undefined) {
        return {registration: null};
    }
    const registration = isObject(raw) ? (raw.registration ?? null) : undefined;
    if (!REGISTRATION.has(registration)) {
        warn('paceline-server: damaged server.json, starting empty: expected {registration: "open" | "closed" | null}');
        return {registration: null};
    }
    return {registration};
}


// ---- the one-time import ----

const ROOT_FILES = ['tombstones.json', 'seen.json', 'server.json'];
const ROOT_TMP_RE = /^\.(tombstones|seen|server)\.json\.[0-9a-f]{12}\.tmp$/;
// what 0.3 kept beside a team's recordings: the codes, the archive, what did not parse, temp files
const isSideFile = name => name === 'sigs.json' || name === 'versions.json' || name.endsWith('.json.bad')
    || /^\.(sigs|versions)\.json\.[0-9a-f]{12}\.tmp$/.test(name);

// Any row in one of these (or meta imported_at) is data an import would clash with. A stopped
// import leaves none.
const DATA_TABLES = ['clubs', 'trash', 'tombstone_clubs', 'retired_slugs', 'settings', 'seen', 'recordings', 'recording_sigs', 'archive'];
const HOLDS_DATA = 'circles/ is there beside a paceline.db that already holds data: see "Imported, but not finished" in '
    + 'server/README.md ("Upgrading from 0.3"). Usually the file moves were cut off: finish them by hand and keep '
    + 'paceline.db. Not when an old image ran on a finished import (imported-<date>/ has its own circles/) or this data '
    + 'dir was taken back by hand with "Going back": the README has those cases';

// Whether anything has this name (a dangling link too).
function taken(p) {
    try {
        fs.lstatSync(p);
        return true;
    } catch (e) {
        if (e.code === 'ENOENT') {
            return false;
        }
        throw e;
    }
}

// A directory's entries sorted by name, [] when it is missing.
function dirents(dir) {
    try {
        return fs.readdirSync(dir, {withFileTypes: true}).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    } catch (e) {
        if (e.code === 'ENOENT') {
            return [];
        }
        throw e;
    }
}

// A team's sigs.json or versions.json: {} when missing; one that does not parse as an object throws,
// naming it by `rel`.
function readSide(file, rel) {
    let text;
    try {
        text = fs.readFileSync(file, 'utf8');
    } catch (e) {
        if (e.code === 'ENOENT') {
            return {};
        }
        throw new Error(`${rel}: ${e.message}`, {cause: e});
    }
    let v;
    try {
        v = JSON.parse(text);
    } catch (e) {
        throw new Error(`${rel} does not parse: ${e.message}`);
    }
    if (!isObject(v)) {
        throw new Error(`${rel} is not an object`);
    }
    return v;
}


// Reads the whole 0.3 layout and checks it, writing and moving nothing. Throws on anything that
// holds data it cannot read; warns (and goes on) where nothing lasting is lost.
function readLayout(dataDir, {now, tz, warn}) {
    const circlesDir = path.join(dataDir, 'circles');
    const trashDir = path.join(dataDir, 'trash');
    const logsDir = path.join(dataDir, 'logs');

    const tombstones = loadTombstones(path.join(dataDir, 'tombstones.json'));

    const clubs = new Map();
    for (const name of fs.readdirSync(circlesDir).sort()) {
        if (name.startsWith('.') || !name.endsWith('.json')) {
            continue;
        }
        const cid = name.slice(0, -5);
        clubs.set(cid, readClub(path.join(circlesDir, name), cid, `damaged circle file circles/${name}`, {warn, now}));
    }

    const trashed = new Map();        // cid -> trash row
    const skipped = [];               // cids in both circles/ and trash/
    for (const d of dirents(trashDir)) {
        const name = d.name;
        if (name.startsWith('.')) {
            continue;
        }
        if (!CID_RE.test(name)) {
            throw new Error(`trash/${name}: the folder name is not a club id`);
        }
        if (clubs.has(name)) {
            warn(`paceline-server: import: trash/${name}/circle.json skipped: the club is also in circles/, the active one is kept`);
            skipped.push(name);
            continue;
        }
        const file = path.join(trashDir, name, 'circle.json');
        const c = readClub(file, name, `damaged trash/${name}/circle.json`, {now});
        const clubName = String(c.name ?? '');
        trashed.set(name, {
            cid: name, json: JSON.stringify(c), name: clubName, name_key: nameKey(clubName) ?? '',
            slugs: JSON.stringify(Object.keys(c.teams)), created_at: c.createdAt ?? null,
            deleted_at: tombstones.circles.get(name) ?? fs.statSync(file).mtime.toISOString(),
        });
    }

    const seen = loadSeen(path.join(dataDir, 'seen.json'), {warn});
    const {registration} = loadSettings(path.join(dataDir, 'server.json'), {warn});

    const base = `imported-${localDate(now, tz)}`;
    let folder = base;
    for (let i = 2; taken(path.join(dataDir, folder)); i++) {
        folder = `${base}-${i}`;
    }

    // The recordings folder of each imported club: logs/<cid>/, else trash/<cid>/logs/ (moved to
    // logs/<cid>/ after the commit). Every team folder in it counts, deleted teams' too.
    const recordings = [];
    const sigs = [];                  // [cid, slug, name, code]
    const archive = [];
    const fromTrash = [];             // cids whose trash/<cid>/logs moves to logs/<cid>
    const bases = new Map();          // cid -> its recordings folder now, relative to the data dir
    for (const cid of [...clubs.keys(), ...trashed.keys()].sort()) {
        const inLogs = taken(path.join(logsDir, cid));
        const inTrash = taken(path.join(trashDir, cid, 'logs'));
        if (inLogs && inTrash) {
            throw new Error(`logs/${cid} and trash/${cid}/logs both exist: move what one of them holds into the other by hand, then remove the empty one`);
        }
        if (inTrash) {
            fromTrash.push(cid);
            bases.set(cid, `trash/${cid}/logs`);
        } else if (inLogs) {
            bases.set(cid, `logs/${cid}`);
        }
    }
    for (const [cid, rel] of bases) {
        const dir = path.join(dataDir, ...rel.split('/'));
        for (const team of dirents(dir).filter(d => d.isDirectory() && isSlug(d.name))) {
            const slug = team.name;
            const teamDir = path.join(dir, slug);
            // 0.3 held the team's archive while its codes sat aside unparsed; here they would be lost
            if (taken(path.join(teamDir, 'sigs.json.bad'))) {
                throw new Error(`${rel}/${slug}/sigs.json.bad: the team's plan codes that did not parse in 0.3; `
                    + 'merge it into sigs.json or delete it');
            }
            const blobs = new Set();
            for (const d of dirents(teamDir).filter(x => x.isFile() && LOG_NAME_RE.test(x.name))) {
                const row = recordingRow(cid, slug, d.name, fs.statSync(path.join(teamDir, d.name)));
                if (row !== null) {
                    recordings.push(row);
                    blobs.add(d.name);
                }
            }
            for (const [name, list] of Object.entries(readSide(path.join(teamDir, 'sigs.json'), `${rel}/${slug}/sigs.json`))) {
                if (blobs.has(name) && Array.isArray(list)) {
                    for (const code of new Set(list.filter(x => typeof x === 'string' && SIG_RE.test(x)))) {
                        sigs.push([cid, slug, name, code]);
                    }
                }
            }
            const versions = Object.entries(readSide(path.join(teamDir, 'versions.json'), `${rel}/${slug}/versions.json`));
            for (const [id, v] of versions) {
                if (!isObject(v)) {
                    throw new Error(`${rel}/${slug}/versions.json: entry ${JSON.stringify(id)} is not an object`);
                }
                archive.push(archiveRow(cid, slug, id, v, now));
            }
            if (versions.length > ARCHIVE_MAX) {
                warn(`paceline-server: import: club ${cid}: team ${slug}: ${versions.length} archived versions, over the cap of ${ARCHIVE_MAX}; the oldest go at its next archive`);
            }
        }
    }

    // The side files to move: in every logs/<CID>/<slug>/ (imported or not) and in the trash
    // folders that move to logs/<cid>/, by where they are after that move.
    const sideFiles = [];             // [cid, slug, name]
    const sideBases = new Map(dirents(logsDir).filter(d => d.isDirectory() && CID_RE.test(d.name)).map(d => [d.name, `logs/${d.name}`]));
    for (const cid of fromTrash) {
        sideBases.set(cid, `trash/${cid}/logs`);
    }
    for (const [cid, rel] of [...sideBases].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        const dir = path.join(dataDir, ...rel.split('/'));
        for (const team of dirents(dir).filter(d => d.isDirectory() && isSlug(d.name))) {
            for (const d of dirents(path.join(dir, team.name)).filter(x => x.isFile() && isSideFile(x.name))) {
                sideFiles.push([cid, team.name, d.name]);
                if (d.name.endsWith('.json.bad')) {
                    warn(`paceline-server: import: ${rel}/${team.name}/${d.name} carried over unchanged into ${folder}/logs/${cid}/${team.name}/`);
                }
            }
        }
    }

    const rootMoves = [
        ...ROOT_FILES.filter(n => taken(path.join(dataDir, n))),
        ...dirents(dataDir).filter(d => d.isFile() && ROOT_TMP_RE.test(d.name)).map(d => d.name),
        ...['backups', 'trash'].filter(n => taken(path.join(dataDir, n))),
        'circles',
    ];

    return {clubs, trashed, tombstones, seen, registration, recordings, sigs, archive, fromTrash, sideFiles, rootMoves, folder};
}


// The one-time import of the 0.3 file layout (spec "Import of the 0.3 file layout"), right after
// openDb at start. null when there is no circles/. Otherwise everything is read and checked first
// (a file that holds data it cannot read stops the start, naming it, with nothing written or
// moved), then written in one transaction, then the old files move to imported-<date>/ (circles/
// last). A failed move stops the start too; with circles/ still there, every later start then stops
// until the move is finished by hand. `now` is epoch ms, `tz` the zone of the folder's date.
export function importFiles(db, dataDir, {now, tz, log = console.log, warn = console.warn}) {
    if (!taken(path.join(dataDir, 'circles'))) {
        return null;
    }
    const sql = db.sql;
    const holds = db.meta('imported_at') !== null
        || sql.prepare(`SELECT ${DATA_TABLES.map(t => `EXISTS (SELECT 1 FROM ${t})`).join(' OR ')} AS x`).get().x === 1;
    if (holds) {
        throw new Error(HOLDS_DATA);
    }
    let found;
    try {
        found = readLayout(dataDir, {now, tz, warn});
    } catch (e) {
        throw new Error(`import stopped, nothing imported: ${e.message}`, {cause: e});
    }
    const {clubs, trashed, tombstones, seen, registration, recordings, sigs, archive, fromTrash, sideFiles, rootMoves, folder} = found;

    const ARCHIVE_COLS = ['cid', 'slug', 'id', 'plan', 'n', 'sig', 'rec_sig', 'past_sigs', 'label', 'type', 'date', 'version', 'bytes', 'archived_at'];
    const q = {
        club: sql.prepare('INSERT INTO clubs (cid, json) VALUES (?, ?)'),
        trash: sql.prepare(`INSERT INTO trash (cid, json, name, name_key, slugs, created_at, deleted_at)
            VALUES (:cid, :json, :name, :name_key, :slugs, :created_at, :deleted_at)`),
        tomb: sql.prepare('INSERT INTO tombstone_clubs (cid, deleted_at) VALUES (?, ?)'),
        slug: sql.prepare('INSERT INTO retired_slugs (slug) VALUES (?)'),
        seen: sql.prepare('INSERT INTO seen (cid, athlete, sig, mod, sheet, in_event, event, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
        setting: sql.prepare('INSERT INTO settings (name, value) VALUES (?, ?)'),
        rec: sql.prepare(`INSERT INTO recordings (cid, slug, name, session, athlete, bytes, stored_at, mtime)
            VALUES (:cid, :slug, :name, :session, :athlete, :bytes, :stored_at, :mtime)`),
        sig: sql.prepare('INSERT INTO recording_sigs (cid, slug, name, sig) VALUES (?, ?, ?, ?)'),
        arc: sql.prepare(`INSERT INTO archive (${ARCHIVE_COLS.join(', ')}) VALUES (${ARCHIVE_COLS.map(c => ':' + c).join(', ')})`),
        meta: sql.prepare('INSERT INTO meta (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value'),
    };
    db.tx(() => {
        for (const [cid, c] of clubs) {
            q.club.run(cid, JSON.stringify(c));
        }
        for (const row of trashed.values()) {
            q.trash.run(row);
        }
        for (const [cid, at] of tombstones.circles) {
            q.tomb.run(cid, at);
        }
        for (const slug of tombstones.slugs) {
            q.slug.run(slug);
        }
        for (const [cid, m] of seen) {
            for (const [aid, e] of m) {
                q.seen.run(cid, aid, e.sig, e.mod, e.sheet, e.inEvent ? 1 : 0, e.event, e.at);
            }
        }
        if (registration !== null) {
            q.setting.run('registration', JSON.stringify(registration));
        }
        for (const row of recordings) {
            q.rec.run(row);
        }
        for (const s of sigs) {
            q.sig.run(...s);
        }
        for (const row of archive) {
            q.arc.run(row);
        }
        q.meta.run('imported_at', new Date(now).toISOString());
        q.meta.run('imported_to', folder);
    });

    const logsDir = path.join(dataDir, 'logs');
    const target = path.join(dataDir, folder);
    try {
        for (const cid of fromTrash) {
            fs.mkdirSync(logsDir, {recursive: true});
            fs.renameSync(path.join(dataDir, 'trash', cid, 'logs'), path.join(logsDir, cid));
        }
        const teams = new Map();
        for (const [cid, slug, name] of sideFiles) {
            const to = path.join(target, 'logs', cid, slug);
            fs.mkdirSync(to, {recursive: true});
            fs.renameSync(path.join(logsDir, cid, slug, name), path.join(to, name));
            teams.set(`${cid}/${slug}`, path.join(logsDir, cid, slug));
        }
        for (const dir of teams.values()) {
            try {
                fs.rmdirSync(dir);
            } catch (e) {
                if (!['ENOTEMPTY', 'EEXIST'].includes(e.code)) {
                    throw e;
                }
            }
        }
        fs.mkdirSync(target, {recursive: true});
        for (const name of rootMoves) {
            fs.renameSync(path.join(dataDir, name), path.join(target, name));
        }
    } catch (e) {
        throw new Error(`import: paceline.db holds the import, but moving the old files into ${folder}/ failed: ${e.message}; `
            + 'finish the move by hand as server/README.md ("Upgrading from 0.3") says, then start again', {cause: e});
    }
    log(`paceline-server: imported the file layout: ${clubs.size} clubs, ${trashed.size} trashed clubs, ${archive.length} archived versions, `
        + `${recordings.length} recordings; the old files are in ${folder}/ and can be deleted by hand`);
    return {clubs: clubs.size, trashed: trashed.size, versions: archive.length, recordings: recordings.length, folder};
}
