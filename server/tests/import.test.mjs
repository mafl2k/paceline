// The one-time import of the 0.3 file layout (import-files.mjs: importFiles) and its readers of
// circle files, tombstones.json, seen.json and server.json. The store reads paceline.db only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readJson, readClub, loadTombstones, loadSeen, loadSettings, importFiles} from '../import-files.mjs';
import {openDb} from '../db.mjs';
import {ARCHIVE_MAX} from '../logs.mjs';
import {club, sheet, T, rows, changes, refuseWrites, assertRaceShape} from './helpers.mjs';
import {PRE_RACES, rawClub} from './pre-races.mjs';
import {mixedTypes, typesOf, ONE_TYPE} from './cockpit-fixture.mjs';

const CID = 'k7f3q9x2m4';
const CID2 = 's9pk2m4q7d';

function tempDir(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paceline-import-'));
    t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
    return dir;
}

function captureWarn(fn) {
    const warned = [];
    const orig = console.warn;
    console.warn = (...a) => warned.push(a.join(' '));
    try {
        return {result: fn(), warned};
    } finally {
        console.warn = orig;
    }
}


test('readJson: undefined for a missing file; bad JSON throws', t => {
    const dir = tempDir(t);
    const file = path.join(dir, 'x.json');
    assert.equal(readJson(file), undefined);
    fs.writeFileSync(file, '{"a": 1}');
    assert.deepEqual(readJson(file), {a: 1});
    fs.writeFileSync(file, '{');
    assert.throws(() => readJson(file), SyntaxError);
});


test('loadTombstones: a missing file is empty; a damaged one throws "damaged tombstones.json"', t => {
    const dir = tempDir(t);
    const file = path.join(dir, 'tombstones.json');
    assert.deepEqual(loadTombstones(file), {circles: new Map(), slugs: new Set()});
    fs.writeFileSync(file, JSON.stringify({circles: {[CID]: '2026-11-19T12:00:00.000Z'}, slugs: ['rollers']}));
    assert.deepEqual(loadTombstones(file), {circles: new Map([[CID, '2026-11-19T12:00:00.000Z']]), slugs: new Set(['rollers'])});
    for (const text of ['{"circles": {}', '{"circles": {}, "slugs": {}}', '{"circles": {}, "slugs": ["Not A Slug"]}']) {
        fs.writeFileSync(file, text);
        assert.throws(() => loadTombstones(file), /^Error: damaged tombstones\.json/, text);
    }
});


test('loadSeen and loadSettings: a damaged file warns and gives empty', t => {
    const dir = tempDir(t);
    const seenFile = path.join(dir, 'seen.json');
    const settingsFile = path.join(dir, 'server.json');
    // missing: empty, no warning
    assert.deepEqual(captureWarn(() => [loadSeen(seenFile), loadSettings(settingsFile)]),
        {result: [new Map(), {registration: null}], warned: []});

    fs.writeFileSync(seenFile, '{"k7f3q9x2m4": ');
    const seen = captureWarn(() => loadSeen(seenFile));
    assert.deepEqual(seen.result, new Map());
    assert.match(seen.warned.join('\n'), /seen\.json/);

    fs.writeFileSync(settingsFile, 'nope');
    const settings = captureWarn(() => loadSettings(settingsFile));
    assert.deepEqual(settings.result, {registration: null});
    assert.match(settings.warned.join('\n'), /server\.json/);
    fs.writeFileSync(settingsFile, '{"registration": "closed"}');
    assert.deepEqual(loadSettings(settingsFile), {registration: 'closed'});

    // the entries are checked field by field; one without a time is dropped
    const at = '2026-11-19T12:00:00.000Z';
    fs.writeFileSync(seenFile, JSON.stringify({[CID]: {
        '1001': {at, sig: 'bad', mod: '0.3.0', sheet: null, inEvent: false, event: null, extra: 'x'},
        '1002': {sig: 'RE5CFQ'},
    }}));
    const loaded = loadSeen(seenFile).get(CID);
    assert.deepEqual([...loaded.keys()], ['1001']);
    assert.deepEqual(loaded.get('1001'), {at, sig: null, mod: '0.3.0', sheet: null, inEvent: false, event: null});
});


test('readClub: the load rule, then the checks; the error carries the prefix', t => {
    const dir = tempDir(t);
    const file = path.join(dir, `${CID}.json`);
    const old = sheet({team: 'rollers', label: 'Rollers fast', date: '2026-11-19', riders: ['1001'], uploadedAt: '2026-11-19T10:00:00.000Z'});
    // a file as 0.3 wrote it
    const data = rawClub({teams: {rollers: {name: 'Rollers', start: '19:30', live: 'ol0001', version: 2, changedAt: null, undo: {what: 'x'}}}});
    data.sheets = {ol0001: old};
    delete data.inbox;
    fs.writeFileSync(file, JSON.stringify(data));
    const {result: c, warned} = captureWarn(() => readClub(file, CID, 'damaged circle file circles/x.json', {warn: true}));
    assert.deepEqual(c.sheets, {});
    assert.equal(Object.hasOwn(c.teams.rollers, 'live'), false);
    assert.deepEqual(c.teams.rollers.races, {});
    assert.equal(Object.hasOwn(c.teams.rollers, 'undo'), false);
    assert.deepEqual(c.inbox, []);
    assert.deepEqual(warned, [`paceline-server: club ${CID}: 1 plans in the old format dropped (no plan versions); its teams stay`]);
    // without warn, nothing is logged
    assert.deepEqual(captureWarn(() => readClub(file, CID, 'p')).warned, []);

    fs.writeFileSync(file, '{');
    assert.throws(() => readClub(file, CID, 'damaged circle file circles/x.json'), /^Error: damaged circle file circles\/x\.json: /);
    fs.writeFileSync(file, JSON.stringify(club({id: CID2})));
    assert.throws(() => readClub(file, CID, 'damaged trash/x/circle.json'),
        /^Error: damaged trash\/x\/circle\.json: id "s9pk2m4q7d" is not the id it is stored under$/);
});


// ---- the one-time import (importFiles) ----

const PENDING = 'p2m8c4t1v9';
const TRASHED = 'm4x2k7f3q9';
const NOW = T('2026-11-19T12:00:00.000Z');
const TZ = 'Europe/Berlin';
const FOLDER = 'imported-2026-11-19';
const SESSION = T('2026-11-12T18:00:00.000Z');
const BLOB = `${SESSION}-1001.jsonl.gz`;          // rollers
const BLOB_OLD = `${SESSION}-1002.jsonl.gz`;      // old-team, a deleted team
const BLOB_TRASH = `${SESSION}-1003.jsonl.gz`;    // the trashed club's cogs
const BAD_TEXT = '{"va0000": {"plan": ';
// the fields a 0.3 versions.json kept of a version
const ARCHIVED_KEYS = ['plan', 'n', 'label', 'type', 'date', 'sig', 'recSig', 'uploadedAt', 'at', 'via', 'copyOf', 'json', 'text'];
const archivedForm = v => ({...Object.fromEntries(ARCHIVED_KEYS.map(k => [k, v[k] ?? null])), pastSigs: []});
const TABLES = ['clubs', 'trash', 'tombstone_clubs', 'retired_slugs', 'seen', 'settings', 'recordings', 'recording_sigs', 'archive'];

const put = (dir, rel, data) => {
    const file = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, data);
    return file;
};
const putJson = (dir, rel, v) => put(dir, rel, JSON.stringify(v));

const versionRollers = archivedForm(sheet({team: 'rollers', label: 'Rollers old', date: '2026-11-12', riders: ['1001', '1002'],
    uploadedAt: '2026-11-10T10:00:00.000Z', plan: 'sa0001', n: 1, recSig: 'AAAAAA'}));
const versionOld = archivedForm(sheet({team: 'old-team', label: 'Old team', date: '2026-11-11', riders: ['1003', '1004'],
    uploadedAt: '2026-11-09T10:00:00.000Z', plan: 'sb0001', n: 1, recSig: 'BBBBBB'}));
const versionCogs = archivedForm(sheet({team: 'cogs', label: 'Cogs', date: '2026-11-12', riders: ['1005', '1006'],
    uploadedAt: '2026-11-10T10:00:00.000Z', plan: 'sc0001', n: 1, recSig: 'CCCCCC'}));

const activeClub = () => club({
    teams: {rollers: {name: 'Rollers', start: '19:30', live: 'sa0002', version: 1, changedAt: null}},
    sheets: {sa0002: sheet({team: 'rollers', label: 'Rollers fast', date: '2026-11-20', riders: ['1001', '1002'],
        uploadedAt: '2026-11-18T10:00:00.000Z'})},
});
const trashedClub = () => club({id: TRASHED, name: 'Cogs United', teams: {cogs: {name: 'Cogs', start: '19:00', live: null, version: 1, changedAt: null}}});

// A data dir of 0.3 (file layout), dates inside the windows the start sweeps keep (clock 2026-11-19).
function plant03(dir) {
    putJson(dir, `circles/${CID}.json`, activeClub());
    putJson(dir, `circles/${PENDING}.json`, {...club({id: PENDING, name: 'Spokesmen CC', createdAt: '2026-11-19T08:00:00.000Z'}),
        status: 'pending', confirmedAt: null});
    put(dir, `circles/.${CID}.json.0a1b2c3d4e5f.tmp`, 'half written');
    putJson(dir, `trash/${TRASHED}/circle.json`, trashedClub());
    put(dir, `trash/${TRASHED}/logs/cogs/${BLOB_TRASH}`, Buffer.alloc(3000, 3));
    putJson(dir, `trash/${TRASHED}/logs/cogs/sigs.json`, {[BLOB_TRASH]: ['CCCCCC']});
    putJson(dir, `trash/${TRASHED}/logs/cogs/versions.json`, {vc0001: versionCogs});
    putJson(dir, 'tombstones.json', {circles: {[TRASHED]: '2026-11-17T09:00:00.000Z', [CID2]: '2026-11-17T10:00:00.000Z'},
        slugs: ['cogs', 'old-team']});
    put(dir, '.seen.json.0a1b2c3d4e5f.tmp', 'half written');
    putJson(dir, 'seen.json', {[CID]: {'1001': {at: '2026-11-18T19:00:00.000Z', sig: 'AAAAAA', mod: '0.3.0', sheet: 'sa0002', inEvent: false, event: null}}});
    putJson(dir, 'server.json', {registration: 'closed'});
    put(dir, `logs/${CID}/rollers/${BLOB}`, Buffer.alloc(5000, 1));
    putJson(dir, `logs/${CID}/rollers/sigs.json`, {[BLOB]: ['AAAAAA'], [`${SESSION}-1009.jsonl.gz`]: ['DDDDDD']});
    putJson(dir, `logs/${CID}/rollers/versions.json`, {va0001: versionRollers});
    put(dir, `logs/${CID}/rollers/versions.json.bad`, BAD_TEXT);
    put(dir, `logs/${CID}/rollers/.sigs.json.0a1b2c3d4e5f.tmp`, 'half written');
    // a team deleted in 0.3: its folder still holds a recording, its codes and an archived version
    put(dir, `logs/${CID}/old-team/${BLOB_OLD}`, Buffer.alloc(100, 2));
    putJson(dir, `logs/${CID}/old-team/sigs.json`, {[BLOB_OLD]: ['BBBBBB']});
    putJson(dir, `logs/${CID}/old-team/versions.json`, {vb0001: versionOld});
    put(dir, 'backups/paceline-2026-11-17.tar.gz', 'an old backup');
    // v1, the operator's
    put(dir, 'logs/tractors/1700000000000-1004.jsonl.gz', 'v1');
    putJson(dir, 'plans/x.json', {});
}

// Every file under dir (paceline.db and its side files left out), relative, sorted.
function tree(dir) {
    return fs.readdirSync(dir, {recursive: true, withFileTypes: true})
        .filter(d => d.isFile())
        .map(d => path.relative(dir, path.join(d.parentPath, d.name)).split(path.sep).join('/'))
        .filter(rel => !rel.startsWith('paceline.db'))
        .sort();
}

const tableCounts = db => Object.fromEntries(TABLES.map(t => [t, db.sql.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));
const NO_ROWS = Object.fromEntries(TABLES.map(t => [t, 0]));

function captured() {
    const lines = {log: [], warn: []};
    return {lines, log: (...a) => lines.log.push(a.join(' ')), warn: (...a) => lines.warn.push(a.join(' '))};
}

// createServer on dir, its start lines collected.
async function serverOn(dir, clock) {
    const {createServer} = await import('../server.mjs');
    const lines = [];
    const warned = [];
    const {log, warn} = console;
    console.log = (...a) => lines.push(a.join(' '));
    console.warn = (...a) => warned.push(a.join(' '));
    try {
        return {server: createServer({env: {DATA_DIR: dir}, now: () => clock.now}), lines, warned};
    } finally {
        console.log = log;
        console.warn = warn;
    }
}
const closed = server => new Promise(r => server.close(() => r()));


test('import: everything in one transaction, then the files move to imported-<date>/', async t => {
    const dir = tempDir(t);
    plant03(dir);
    const clock = {now: NOW};
    const {server, lines, warned} = await serverOn(dir, clock);
    const check = srv => {
        const {store, logs, db} = srv;
        assert.equal(store.get(CID).name, 'Kettenfett RC');
        assert.deepEqual(store.get(CID), activeClub());
        assert.equal(store.getAny(PENDING).status, 'pending');
        assert.deepEqual(store.trashed().map(x => x.id), [TRASHED]);
        assert.equal(store.trashed()[0].deletedAt, '2026-11-17T09:00:00.000Z');
        assert.equal(store.gone(CID2), true);
        assert.equal(store.gone(TRASHED), true);
        assert.equal(store.slugTaken('old-team'), true);
        assert.deepEqual(Object.keys(store.seenOf(CID)), ['1001']);
        assert.equal(store.seenOf(CID)['1001'].sheet, 'sa0002');
        assert.deepEqual(store.serverSettings(), {registration: 'closed'});
        assert.deepEqual(logs.archived(CID, 'rollers'), [versionRollers]);
        assert.deepEqual(logs.codes(CID, 'rollers'), new Set(['AAAAAA']));
        // the deleted team's folder: its archived version and its codes
        assert.deepEqual(logs.archived(CID, 'old-team'), [versionOld]);
        assert.deepEqual(logs.codes(CID, 'old-team'), new Set(['BBBBBB']));
        assert.deepEqual(logs.list(CID).map(r => [r.slug, r.file, r.size]), [['old-team', BLOB_OLD, 100], ['rollers', BLOB, 5000]]);
        // the trashed club's recordings are back at logs/<cid>/
        assert.deepEqual(logs.list(TRASHED).map(r => [r.slug, r.file, r.size]), [['cogs', BLOB_TRASH, 3000]]);
        assert.deepEqual(logs.archived(TRASHED, 'cogs'), [versionCogs]);
        assert.deepEqual(logs.codes(TRASHED, 'cogs'), new Set(['CCCCCC']));
        assert.ok(logs.circleBytes(TRASHED) > 0);
        assert.equal(logs.totalBytes(), logs.circleBytes(CID));
        assert.equal(logs.circleBytes(CID), 8192 + 4096 + Buffer.byteLength(JSON.stringify(versionRollers)) + Buffer.byteLength(JSON.stringify(versionOld)));
        assert.equal(db.meta('imported_to'), FOLDER);
        assert.equal(db.meta('imported_at'), '2026-11-19T12:00:00.000Z');
        assert.deepEqual(tree(dir), [
            `${FOLDER}/.seen.json.0a1b2c3d4e5f.tmp`,
            `${FOLDER}/backups/paceline-2026-11-17.tar.gz`,
            `${FOLDER}/circles/.${CID}.json.0a1b2c3d4e5f.tmp`,
            `${FOLDER}/circles/${CID}.json`,
            `${FOLDER}/circles/${PENDING}.json`,
            `${FOLDER}/logs/${CID}/old-team/sigs.json`,
            `${FOLDER}/logs/${CID}/old-team/versions.json`,
            `${FOLDER}/logs/${CID}/rollers/.sigs.json.0a1b2c3d4e5f.tmp`,
            `${FOLDER}/logs/${CID}/rollers/sigs.json`,
            `${FOLDER}/logs/${CID}/rollers/versions.json`,
            `${FOLDER}/logs/${CID}/rollers/versions.json.bad`,
            `${FOLDER}/logs/${TRASHED}/cogs/sigs.json`,
            `${FOLDER}/logs/${TRASHED}/cogs/versions.json`,
            `${FOLDER}/seen.json`,
            `${FOLDER}/server.json`,
            `${FOLDER}/tombstones.json`,
            `${FOLDER}/trash/${TRASHED}/circle.json`,
            `logs/${CID}/old-team/${BLOB_OLD}`,
            `logs/${CID}/rollers/${BLOB}`,
            `logs/${TRASHED}/cogs/${BLOB_TRASH}`,
            'logs/tractors/1700000000000-1004.jsonl.gz',
            'plans/x.json',
        ]);
        assert.equal(fs.readFileSync(path.join(dir, FOLDER, 'logs', CID, 'rollers', 'versions.json.bad'), 'utf8'), BAD_TEXT);
        assert.equal(fs.readFileSync(path.join(dir, 'logs', 'tractors', '1700000000000-1004.jsonl.gz'), 'utf8'), 'v1');
        for (const gone of ['circles', 'trash', 'backups', 'tombstones.json', 'seen.json', 'server.json']) {
            assert.equal(fs.existsSync(path.join(dir, gone)), false, gone);
        }
    };
    check(server);
    assert.deepEqual(lines.filter(l => /import/.test(l)), [
        `paceline-server: imported the file layout: 2 clubs, 1 trashed clubs, 3 archived versions, 3 recordings; the old files are in ${FOLDER}/ and can be deleted by hand`,
    ]);
    // the folder is old club data: every start says to delete it, with the deadline
    const leftover = `paceline-server: ${FOLDER}/ is still in the data dir; delete it by hand within 7 days of 2026-11-19 (see server/README.md)`;
    assert.deepEqual(warned, [
        `paceline-server: import: logs/${CID}/rollers/versions.json.bad carried over unchanged into ${FOLDER}/logs/${CID}/rollers/`,
        leftover,
    ]);
    await closed(server);

    // a restart imports nothing and keeps all of it
    clock.now = NOW + 3600000;
    const again = await serverOn(dir, clock);
    t.after(() => closed(again.server));
    check(again.server);
    assert.deepEqual(again.lines.filter(l => /import/.test(l)), []);
    assert.deepEqual(again.warned, [leftover]);
    assert.equal(again.server.db.meta('imported_at'), '2026-11-19T12:00:00.000Z');
});


test('import: a club file in the 0.3 shape is stored with races', async t => {
    const dir = tempDir(t);
    plant03(dir);
    // the active club as 0.3 wrote it: team.live, the event fields on its versions
    const raw = PRE_RACES.find(([n]) => n === 'pinned')[1]();
    putJson(dir, `circles/${CID}.json`, raw);
    const {server} = await serverOn(dir, {now: NOW});
    t.after(() => closed(server));
    const row = JSON.parse(server.db.sql.prepare('SELECT json FROM clubs WHERE cid = ?').get(CID).json);
    assertRaceShape(row);
    assert.deepEqual(row.teams.rollers.races, {
        '2026-11-19': {start: null, pinnedEventId: 4567890, eventId: 4567891, boundAt: null, live: 'ra0001'},
    });
    assert.deepEqual(server.store.get(CID).teams.rollers.races, row.teams.rollers.races);
    // the trashed club's row too
    assertRaceShape(JSON.parse(server.db.sql.prepare('SELECT json FROM trash WHERE cid = ?').get(TRASHED).json));
});


test('import: a club file whose versions carry different types is stored with one type per plan', async t => {
    const dir = tempDir(t);
    plant03(dir);
    putJson(dir, `circles/${CID}.json`, mixedTypes());
    const {server} = await serverOn(dir, {now: NOW});
    t.after(() => closed(server));
    const row = JSON.parse(server.db.sql.prepare('SELECT json FROM clubs WHERE cid = ?').get(CID).json);
    assert.deepEqual(typesOf(row), ONE_TYPE);
    assert.deepEqual(typesOf(server.store.get(CID)), ONE_TYPE);
});


test('import stops on a file that holds data it cannot read: nothing written, nothing moved, the file named', t => {
    const restore = (rel, v) => dir => putJson(dir, rel, v);
    for (const [plant, re, fix] of [
        [dir => put(dir, 'circles/m4q7d2s9pk.json', '{'), /circles\/m4q7d2s9pk\.json/, dir => fs.rmSync(path.join(dir, 'circles', 'm4q7d2s9pk.json'))],
        [dir => put(dir, `trash/${TRASHED}/circle.json`, '{'), /trash\/m4x2k7f3q9\/circle\.json/, restore(`trash/${TRASHED}/circle.json`, trashedClub())],
        [dir => fs.rmSync(path.join(dir, 'trash', TRASHED, 'circle.json')), /trash\/m4x2k7f3q9\/circle\.json/, restore(`trash/${TRASHED}/circle.json`, trashedClub())],
        [dir => put(dir, 'trash/not-a-cid/circle.json', '{}'), /trash\/not-a-cid/, dir => fs.rmSync(path.join(dir, 'trash', 'not-a-cid'), {recursive: true})],
        [dir => put(dir, 'tombstones.json', '{"circles": {}'), /damaged tombstones\.json/, restore('tombstones.json', {circles: {}, slugs: []})],
        [dir => put(dir, `logs/${CID}/rollers/sigs.json`, '{"x": '), /logs\/k7f3q9x2m4\/rollers\/sigs\.json/, restore(`logs/${CID}/rollers/sigs.json`, {[BLOB]: ['AAAAAA']})],
        [dir => put(dir, `logs/${CID}/rollers/sigs.json`, '["AAAAAA"]'), /logs\/k7f3q9x2m4\/rollers\/sigs\.json/, restore(`logs/${CID}/rollers/sigs.json`, {[BLOB]: ['AAAAAA']})],
        [dir => put(dir, `logs/${CID}/rollers/sigs.json.bad`, '{"x": '),
            /logs\/k7f3q9x2m4\/rollers\/sigs\.json\.bad: .*merge it into sigs\.json or delete it$/,
            dir => fs.rmSync(path.join(dir, 'logs', CID, 'rollers', 'sigs.json.bad'))],
        [dir => put(dir, `trash/${TRASHED}/logs/cogs/sigs.json.bad`, '{"x": '), /trash\/m4x2k7f3q9\/logs\/cogs\/sigs\.json\.bad: /,
            dir => fs.rmSync(path.join(dir, 'trash', TRASHED, 'logs', 'cogs', 'sigs.json.bad'))],
        [dir => {
            fs.rmSync(path.join(dir, 'logs', CID, 'rollers', 'versions.json'));
            fs.mkdirSync(path.join(dir, 'logs', CID, 'rollers', 'versions.json'));
        }, /^import stopped, nothing imported: logs\/k7f3q9x2m4\/rollers\/versions\.json: EISDIR/,
        dir => {
            fs.rmdirSync(path.join(dir, 'logs', CID, 'rollers', 'versions.json'));
            putJson(dir, `logs/${CID}/rollers/versions.json`, {va0001: versionRollers});
        }],
        [dir => put(dir, `logs/${CID}/rollers/versions.json`, '[]'), /logs\/k7f3q9x2m4\/rollers\/versions\.json/, restore(`logs/${CID}/rollers/versions.json`, {va0001: versionRollers})],
        [dir => putJson(dir, `logs/${CID}/old-team/versions.json`, {vb0001: 'x'}), /logs\/k7f3q9x2m4\/old-team\/versions\.json/, restore(`logs/${CID}/old-team/versions.json`, {vb0001: versionOld})],
        [dir => put(dir, `trash/${TRASHED}/logs/cogs/versions.json`, '{'), /trash\/m4x2k7f3q9\/logs\/cogs\/versions\.json/, restore(`trash/${TRASHED}/logs/cogs/versions.json`, {vc0001: versionCogs})],
        [dir => fs.mkdirSync(path.join(dir, 'logs', TRASHED, 'cogs'), {recursive: true}), /logs\/m4x2k7f3q9 and trash\/m4x2k7f3q9\/logs/,
            dir => fs.rmSync(path.join(dir, 'logs', TRASHED), {recursive: true})],
    ]) {
        const dir = tempDir(t);
        plant03(dir);
        plant(dir);
        const before = tree(dir);
        let db = openDb(dir);
        const out = captured();
        let err = null;
        try {
            importFiles(db, dir, {now: NOW, tz: TZ, log: out.log, warn: out.warn});
        } catch (e) {
            err = e;
        }
        assert.match(String(err), /^Error: import stopped, nothing imported: /, String(re));
        assert.match(err.message, re);
        assert.deepEqual(tableCounts(db), NO_ROWS, String(re));
        assert.equal(db.meta('imported_at'), null);
        assert.deepEqual(tree(dir), before, String(re));
        assert.equal(fs.readdirSync(dir).some(n => n.startsWith('imported-')), false);
        assert.deepEqual(out.lines.log, []);

        // fixed by hand: the next start imports (the empty database of the stopped attempt does not count)
        fix(dir);
        db.close();
        db = openDb(dir);
        try {
            const result = importFiles(db, dir, {now: NOW, tz: TZ, log: () => {}, warn: () => {}});
            assert.equal(result.folder, FOLDER, String(re));
            assert.equal(result.clubs, 2);
            assert.equal(fs.existsSync(path.join(dir, 'circles')), false);
            assert.equal(db.meta('imported_to'), FOLDER);
        } finally {
            db.close();
        }
    }
});


test('import warns and goes on: a damaged seen.json or server.json starts empty; a club also in the trash keeps its active copy', t => {
    const dir = tempDir(t);
    plant03(dir);
    put(dir, 'seen.json', '{"k7f3q9x2m4": ');
    put(dir, 'server.json', 'nope');
    putJson(dir, `trash/${CID}/circle.json`, {...activeClub(), name: 'Kettenfett RC (old)'});
    // a team over the archive cap: all of its versions come along
    const many = {};
    for (let i = 0; i <= ARCHIVE_MAX; i++) {
        many[`va${String(i).padStart(4, '0')}`] = {...versionRollers, label: `Rollers ${i}`};
    }
    putJson(dir, `logs/${CID}/rollers/versions.json`, many);
    const db = openDb(dir);
    t.after(() => db.close());
    const out = captured();
    const result = importFiles(db, dir, {now: NOW, tz: TZ, log: out.log, warn: out.warn});
    assert.deepEqual(result, {clubs: 2, trashed: 1, versions: ARCHIVE_MAX + 1 + 2, recordings: 3, folder: FOLDER});
    const counts = tableCounts(db);
    assert.equal(counts.seen, 0);
    assert.equal(counts.settings, 0);
    assert.equal(JSON.parse(rows(db, 'SELECT json FROM clubs WHERE cid = ?', CID)[0].json).name, 'Kettenfett RC');
    assert.deepEqual(rows(db, 'SELECT cid FROM trash'), [{cid: TRASHED}]);
    // in file order
    assert.deepEqual(rows(db, "SELECT id FROM archive WHERE cid = ? AND slug = 'rollers' ORDER BY archived_at, rowid", CID).map(r => r.id),
        Object.keys(many));
    const warned = out.lines.warn.join('\n');
    assert.match(warned, /seen\.json/);
    assert.match(warned, /server\.json/);
    assert.match(warned, /trash\/k7f3q9x2m4\/circle\.json skipped: the club is also in circles\/, the active one is kept/);
    assert.match(warned, /logs\/k7f3q9x2m4\/rollers\/versions\.json\.bad carried over unchanged/);
    assert.match(warned, /club k7f3q9x2m4: team rollers: 1001 archived versions, over the cap of 1000; the oldest go at its next archive/);
    assert.equal(out.lines.warn.length, 5);
    assert.ok(fs.existsSync(path.join(dir, FOLDER, 'trash', CID, 'circle.json')));
    assert.deepEqual(out.lines.log, [
        `paceline-server: imported the file layout: 2 clubs, 1 trashed clubs, ${ARCHIVE_MAX + 3} archived versions, 3 recordings; the old files are in ${FOLDER}/ and can be deleted by hand`,
    ]);
});


test('import: a skipped trash copy\'s recordings are the active club\'s when logs/<cid> is missing', t => {
    const dir = tempDir(t);
    plant03(dir);
    putJson(dir, `trash/${CID}/circle.json`, activeClub());
    fs.renameSync(path.join(dir, 'logs', CID), path.join(dir, 'trash', CID, 'logs'));
    const db = openDb(dir);
    t.after(() => db.close());
    importFiles(db, dir, {now: NOW, tz: TZ, log: () => {}, warn: () => {}});
    assert.deepEqual(rows(db, 'SELECT slug, name FROM recordings WHERE cid = ? ORDER BY slug', CID),
        [{slug: 'old-team', name: BLOB_OLD}, {slug: 'rollers', name: BLOB}]);
    assert.ok(fs.existsSync(path.join(dir, 'logs', CID, 'rollers', BLOB)));
    assert.ok(fs.existsSync(path.join(dir, FOLDER, 'logs', CID, 'rollers', 'sigs.json')));
    assert.ok(fs.existsSync(path.join(dir, FOLDER, 'trash', CID, 'circle.json')));
    assert.equal(fs.existsSync(path.join(dir, FOLDER, 'trash', CID, 'logs')), false);
});


test('import: circles/ beside a database that holds data stops the start; no circles/ imports nothing', t => {
    for (const seed of [
        db => db.sql.prepare('INSERT INTO clubs (cid, json) VALUES (?, ?)').run(CID, JSON.stringify(club())),
        db => db.sql.prepare("INSERT INTO trash (cid, json, name, name_key, slugs, created_at, deleted_at) VALUES (?, ?, 'x', 'x', '[]', NULL, ?)")
            .run(TRASHED, JSON.stringify(club({id: TRASHED})), '2026-11-17T09:00:00.000Z'),
        db => db.setMeta('imported_at', '2026-11-18T12:00:00.000Z'),
        db => db.sql.prepare('INSERT INTO tombstone_clubs (cid, deleted_at) VALUES (?, ?)').run(CID2, '2026-11-17T10:00:00.000Z'),
        db => db.sql.prepare("INSERT INTO retired_slugs (slug) VALUES ('old-team')").run(),
        db => db.sql.prepare("INSERT INTO settings (name, value) VALUES ('registration', '\"closed\"')").run(),
        db => db.sql.prepare("INSERT INTO seen (cid, athlete, in_event, at) VALUES (?, '1001', 0, '2026-11-18T19:00:00.000Z')").run(CID),
        db => db.sql.prepare('INSERT INTO recordings (cid, slug, name, session, athlete, bytes, stored_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(CID, 'rollers', BLOB, SESSION, '1001', 5000, SESSION),
        db => db.sql.prepare(`INSERT INTO archive (cid, slug, id, past_sigs, version, bytes, archived_at)
            VALUES (?, 'rollers', 'va0001', '[]', '{}', 2, ?)`).run(CID, NOW),
    ]) {
        const dir = tempDir(t);
        const db = openDb(dir);
        try {
            seed(db);
            const before = tableCounts(db);
            // without circles/: nothing to import, nothing written
            const n = changes(db);
            assert.equal(importFiles(db, dir, {now: NOW, tz: TZ}), null);
            assert.equal(changes(db), n);
            plant03(dir);
            const files = tree(dir);
            assert.throws(() => importFiles(db, dir, {now: NOW, tz: TZ, log: () => {}, warn: () => {}}),
                /^Error: circles\/ is there beside a paceline\.db that already holds data: see "Imported, but not finished" in server\/README\.md \("Upgrading from 0\.3"\)\. Usually the file moves were cut off: finish them by hand and keep paceline\.db\. Not when an old image ran on a finished import \(imported-<date>\/ has its own circles\/\) or this data dir was taken back by hand with "Going back": the README has those cases$/);
            assert.deepEqual(tableCounts(db), before);
            assert.deepEqual(tree(dir), files);
        } finally {
            db.close();
        }
    }
    // an empty data dir: null
    const dir = tempDir(t);
    const db = openDb(dir);
    t.after(() => db.close());
    const n = changes(db);
    assert.equal(importFiles(db, dir, {now: NOW, tz: TZ}), null);
    assert.equal(changes(db), n);
    assert.deepEqual(tableCounts(db), NO_ROWS);
});


test('import: imported-<date> taken: imported-<date>-2', t => {
    const dir = tempDir(t);
    plant03(dir);
    put(dir, `${FOLDER}/x`, 'mine');
    put(dir, `${FOLDER}-3/y`, 'mine too');
    const db = openDb(dir);
    t.after(() => db.close());
    const result = importFiles(db, dir, {now: NOW, tz: TZ, log: () => {}, warn: () => {}});
    assert.equal(result.folder, `${FOLDER}-2`);
    assert.deepEqual(tree(path.join(dir, FOLDER)), ['x']);
    assert.deepEqual(tree(path.join(dir, `${FOLDER}-3`)), ['y']);
    assert.equal(db.meta('imported_to'), `${FOLDER}-2`);
    assert.ok(fs.existsSync(path.join(dir, `${FOLDER}-2`, 'circles', `${CID}.json`)));
});


test('import: a failed move stops the start after the commit; the next start then stops with instructions', t => {
    const dir = tempDir(t);
    plant03(dir);
    const db = openDb(dir);
    t.after(() => db.close());
    // imported-<date>/ can't be made (the move of the trash's recordings to logs/ still works); a
    // patched mkdirSync, since root ignores a read-only data dir
    const mkdirSync = fs.mkdirSync;
    fs.mkdirSync = (p, o) => {
        if (String(p).startsWith(path.join(dir, FOLDER))) {
            throw Object.assign(new Error('EACCES: permission denied'), {code: 'EACCES'});
        }
        return mkdirSync(p, o);
    };
    try {
        assert.throws(() => importFiles(db, dir, {now: NOW, tz: TZ, log: () => {}, warn: () => {}}),
            /^Error: import: paceline\.db holds the import, but moving the old files into imported-2026-11-19\/ failed: EACCES: permission denied; finish the move by hand as server\/README\.md \("Upgrading from 0\.3"\) says, then start again$/);
    } finally {
        fs.mkdirSync = mkdirSync;
    }
    assert.ok(fs.existsSync(path.join(dir, 'logs', TRASHED, 'cogs', BLOB_TRASH)));
    assert.equal(db.meta('imported_to'), FOLDER);
    assert.equal(tableCounts(db).clubs, 2);
    assert.ok(fs.existsSync(path.join(dir, 'circles')));
    assert.throws(() => importFiles(db, dir, {now: NOW, tz: TZ}), /^Error: circles\/ is there beside a paceline\.db that already holds data/);
});


test('import: a write SQLite refuses rolls all of it back and moves nothing; the next start imports', t => {
    const dir = tempDir(t);
    plant03(dir);
    const before = tree(dir);
    let db = openDb(dir);
    const undo = refuseWrites(db, 'archive', ['INSERT']);
    assert.throws(() => importFiles(db, dir, {now: NOW, tz: TZ, log: () => {}, warn: () => {}}), /test: write refused/);
    undo();
    assert.deepEqual(tableCounts(db), NO_ROWS);
    assert.equal(db.meta('imported_at'), null);
    assert.deepEqual(tree(dir), before);
    db.close();
    db = openDb(dir);
    t.after(() => db.close());
    assert.equal(importFiles(db, dir, {now: NOW, tz: TZ, log: () => {}, warn: () => {}}).clubs, 2);
});
