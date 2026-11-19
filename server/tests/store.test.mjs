import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openStore, cleanSeen} from '../store.mjs';
import {openDb, TxAborted} from '../db.mjs';
import {ClubError, MAX_CLUB_BYTES, newClub, addTeam, uploadSheet, makeLive, setRiderCode, clearRiderCode, addEntry, entryOf, deleteSheet, deleteTeam} from '../club.mjs';
import {makeLogStore} from '../logs.mjs';
import {riderCodeHash} from '../ids.mjs';
import {club, sheet, planJson, T, CODE_SECRET, rows, clubJson, changes, refuseWrites} from './helpers.mjs';


const DAY = 86400000;
const CID = 'k7f3q9x2m4';
const CID2 = 's9pk2m4q7d';
const iso = ms => new Date(ms).toISOString();

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'paceline-store-'));
}

// A store on paceline.db in a temp dir, with the log store as its archive and a clock the test
// moves. t.open() is a restart.
function setup() {
    const dataDir = tempDir();
    const clock = {now: T('2026-11-19T12:00Z')};
    const now = () => clock.now;
    const t = {dataDir, clock, now, db: null, logs: null, store: null};
    t.open = () => {                    // a restart: the old handle closes first (exclusive lock)
        t.db?.close();
        t.db = openDb(dataDir);
        t.logs = makeLogStore(dataDir, {db: t.db, now});
        t.store = openStore({db: t.db, now, archive: t.logs});
        return t.store;
    };
    t.open();
    return t;
}

function cleanup(t) {
    if (t.db?.sql.isOpen) {
        t.db.close();
    }
    fs.rmSync(t.dataDir, {recursive: true, force: true});
}

// A clubs row written by hand: `data` as JSON, or a string as it is.
function plant(t, cid, data) {
    t.db.sql.prepare('INSERT INTO clubs (cid, json) VALUES (?, ?)').run(cid, typeof data === 'string' ? data : JSON.stringify(data));
}

// A recording of the team, through the log store (so Task 3's index sees it too); its path.
function blob(t, cid, slug, session = t.now() - 2 * DAY) {
    const name = `${session}-1001.jsonl.gz`;
    t.logs.put(cid, slug, name, Buffer.from('x'));
    return path.join(t.dataDir, 'logs', cid, slug, name);
}

function counter() {
    let n = 0;
    return () => `h${String(++n).padStart(5, '0')}`;
}

// A new plan, live, unless `extra` says otherwise.
function upload(t, cid, slug, json, extra = {}, newId) {
    return t.store.change(cid, c => uploadSheet(c, {
        slug, json, text: null, date: '2026-11-19', as: 'new', live: true,
        base: c.teams[slug].version, pinnedEventId: null, via: 'file', ...extra,
    }, {now: t.now(), newId}));
}

// An active club with team Rollers (19:30) and a live sheet for Ben and Cleo (Dan on the bench).
function withTeam(t, cid = CID, name = 'Kettenfett RC') {
    t.store.create(club({id: cid, name}));
    const slug = t.store.change(cid, c => addTeam(c, {name: 'Rollers', start: '19:30'},
        {slugTaken: t.store.slugTaken, now: t.now()}));
    const newId = counter();
    const {id} = upload(t, cid, slug, planJson('Rollers', ['1001', '1002'], ['1003']), {}, newId);
    return {slug, id, newId};
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


test('loads clubs from paceline.db, oldest first; a row that does not parse stops the start', () => {
    const t = setup();
    try {
        // ids in the opposite order of createdAt
        plant(t, CID, club({id: CID, createdAt: '2026-11-03T10:00:00.000Z'}));
        plant(t, CID2, club({id: CID2, name: 'Spokesmen CC', createdAt: '2026-11-02T10:00:00.000Z'}));
        const store = t.open();
        assert.deepEqual(store.active().map(c => c.id), [CID2, CID]);
        assert.equal(store.activeCount(), 2);
        assert.equal(store.pendingCount(), 0);
        // the store makes no folder of its own (an import would find circles/ beside the database)
        assert.deepEqual(fs.readdirSync(t.dataDir).filter(n => !n.startsWith('paceline.db')), []);

        plant(t, 'm4q7d2s9pk', '{');
        assert.throws(() => t.open(), /^Error: damaged club m4q7d2s9pk in paceline\.db: /);
    } finally {
        cleanup(t);
    }
});


test('load: a wrong id, missing teams or sheets, a bad zone or status is damage', () => {
    const cases = [
        [club({id: CID2}), 'id'],
        [{...club(), teams: undefined}, 'teams'],
        [{...club(), sheets: null}, 'sheets'],
        [club({tz: 'Europe/Nowhere'}), 'tz'],
        [{...club(), status: 'gone'}, 'status'],
        [{...club(), riderCode: 'x'}, 'riderCode'],
        [{...club(), riderCode: {hash: 'nothex', setAt: '2026-11-16T10:00:00.000Z'}}, 'riderCode'],
        [{...club(), riderCode: {hash: 'a'.repeat(64)}}, 'riderCode'],
        // the entries, not only the top level (a manual edit or a partial restore)
        [{...club(), sheets: {h3k9q2: null}}, 'sheet "h3k9q2" is not an object'],
        [{...club(), sheets: {h3k9q2: [1]}}, 'sheet "h3k9q2"'],
        [{...club(), teams: {rollers: null}}, 'team "rollers" is not an object'],
        [{...club(), teams: {rollers: 'Rollers'}}, 'team "rollers"'],
    ];
    for (const [data, what] of cases) {
        const t = setup();
        try {
            plant(t, CID, data);
            assert.throws(() => t.open(), new RegExp(`^Error: damaged club ${CID} in paceline\\.db: .*${what}`), what);
        } finally {
            cleanup(t);
        }
    }
    // A club from before rider codes (no riderCode field) loads; so do null and a good code.
    const good = [
        club(),
        {...club(), riderCode: null},
        {...club(), riderCode: {hash: 'a'.repeat(64), setAt: '2026-11-16T10:00:00.000Z'}},
    ];
    assert.equal(Object.hasOwn(good[0], 'riderCode'), false);
    for (const data of good) {
        const t = setup();
        try {
            plant(t, CID, data);
            assert.equal(t.open().get(CID).id, CID);
        } finally {
            cleanup(t);
        }
    }
});


test('load: an undo snapshot is dropped', () => {
    const t = setup();
    try {
        const kept = sheet({team: 'rollers', label: 'Rollers', date: '2026-11-19', riders: ['1002'], uploadedAt: '2026-11-19T11:00:00.000Z', plan: 'nw0001'});
        const data = club({
            teams: {
                rollers: {
                    name: 'Rollers', start: '19:30', live: 'nw0001', version: 2, changedAt: '2026-11-19T11:00:00.000Z',
                    undo: {what: 'live', label: 'Rollers', at: '2026-11-19T11:00:00.000Z', live: null, sheets: {}},
                },
            },
            sheets: {nw0001: kept},
        });
        plant(t, CID, data);
        const json = clubJson(t.db, CID);
        const {result: store, warned} = captureWarn(() => t.open());
        const c = store.get(CID);
        assert.equal(c.teams.rollers.undo, undefined);
        assert.equal(c.teams.rollers.live, 'nw0001');
        assert.deepEqual(c.sheets, {nw0001: kept});
        assert.deepEqual(warned, [], 'no sheet dropped, nothing logged');
        assert.equal(clubJson(t.db, CID), json, 'nothing written at load');
        store.change(CID, () => {});
        assert.equal(Object.hasOwn(JSON.parse(clubJson(t.db, CID)).teams.rollers, 'undo'), false);
    } finally {
        cleanup(t);
    }
});


test('load: sheets in the old format are dropped, the club stays', () => {
    const t = setup();
    try {
        const old = sheet({team: 'rollers', label: 'Rollers fast', date: '2026-11-19', riders: ['1001'], uploadedAt: '2026-11-19T10:00:00.000Z'});
        const kept = sheet({team: 'rollers', label: 'Rollers', date: '2026-11-19', riders: ['1002'], uploadedAt: '2026-11-19T11:00:00.000Z', plan: 'nw0001'});
        assert.equal(Object.hasOwn(old, 'plan'), false);
        const teams = {
            rollers: {
                name: 'Rollers', start: '19:30', live: 'ol0001', version: 4, changedAt: '2026-11-19T10:00:00.000Z',
                undo: {what: 'upload', label: 'Rollers fast', at: '2026-11-19T10:00:00.000Z', live: null, sheets: {ol0002: {...old}, ol0001: null}},
            },
            // an Undo snapshot goes even when it holds only new versions (Task 4: no Undo any more)
            sprockets: {
                name: 'Sprockets', start: '19:40', live: null, version: 2, changedAt: '2026-11-19T11:00:00.000Z',
                undo: {what: 'upload', label: 'Sprockets v1', at: '2026-11-19T11:00:00.000Z', live: null, sheets: {nw0001: null}},
            },
        };
        const data = club({teams: structuredClone(teams)});
        data.sheets = {ol0001: old, nw0001: kept};
        plant(t, CID, data);
        const json = clubJson(t.db, CID);
        const {result: store, warned} = captureWarn(() => t.open());
        const c = store.get(CID);
        assert.deepEqual(Object.keys(c.sheets), ['nw0001']);
        assert.deepEqual(c.sheets.nw0001, kept);
        assert.equal(c.teams.rollers.live, null);
        assert.equal(c.teams.rollers.undo, undefined);
        const {live, undo, ...rest} = teams.rollers;
        assert.deepEqual(c.teams.rollers, {...rest, live: null});
        const {undo: dropped, ...sprockets} = teams.sprockets;
        assert.deepEqual(c.teams.sprockets, sprockets);
        assert.equal(Object.hasOwn(c.teams.sprockets, 'undo'), false);
        assert.equal(warned.length, 1);
        assert.match(warned[0], /club k7f3q9x2m4: 1 plans in the old format dropped/);
        assert.equal(clubJson(t.db, CID), json, 'nothing written at load');
        // the next change writes the new shape
        store.change(CID, () => {});
        assert.deepEqual(Object.keys(JSON.parse(clubJson(t.db, CID)).sheets), ['nw0001']);
        // a club in the new format logs nothing
        assert.deepEqual(captureWarn(() => t.open()).warned, []);
    } finally {
        cleanup(t);
    }
});


test('load: a missing inbox becomes []; a damaged inbox stops the start', () => {
    // a row without `inbox` (before this build) loads with []; nothing is written at load
    const t0 = setup();
    try {
        const data = club();
        delete data.inbox;
        plant(t0, CID, data);
        const json = clubJson(t0.db, CID);
        const store = t0.open();
        assert.deepEqual(store.get(CID).inbox, []);
        assert.equal(clubJson(t0.db, CID), json);
        store.change(CID, () => {});
        assert.deepEqual(JSON.parse(clubJson(t0.db, CID)).inbox, []);
    } finally {
        cleanup(t0);
    }
    for (const bad of [{}, [1], [null], ['x'], 'x', [[]]]) {
        const t1 = setup();
        try {
            plant(t1, CID, {...club(), inbox: bad});
            assert.throws(() => t1.open(),
                new RegExp(`damaged club ${CID} in paceline\\.db: (missing inbox|inbox entry 0 is not an object)`), JSON.stringify(bad));
        } finally {
            cleanup(t1);
        }
    }
    const t2 = setup();
    try {
        plant(t2, CID, {...club(), inbox: {}});
        assert.throws(() => t2.open(), /damaged club k7f3q9x2m4 in paceline\.db: missing inbox/);
    } finally {
        cleanup(t2);
    }
    const t3 = setup();
    try {
        plant(t3, CID, {...club(), inbox: [1]});
        assert.throws(() => t3.open(), /inbox entry 0 is not an object/);
    } finally {
        cleanup(t3);
    }
    // a change that leaves a damaged inbox is refused too
    const t = setup();
    try {
        t.store.create(club());
        assert.throws(() => t.store.change(CID, c => {
            c.inbox = {};
        }), /missing inbox/);
        assert.deepEqual(t.store.get(CID).inbox, []);
    } finally {
        cleanup(t);
    }
});


test('sweep: old inbox entries go', () => {
    const t = setup();
    try {
        const {slug} = withTeam(t);
        const newId = counter();
        const old = t.store.change(CID, c => addEntry(c, {source: 'upload', team: slug, json: planJson('Rollers', ['1001']), text: null},
            {now: t.now() - 25 * 3600000, newId}));
        const fresh = t.store.change(CID, c => addEntry(c, {source: 'upload', team: slug, json: planJson('Rollers', ['1002']), text: null},
            {now: t.now(), newId}));
        const version = t.store.get(CID).teams[slug].version;
        const log = t.store.get(CID).log.length;
        const before = clubJson(t.db, CID);
        const out = t.store.sweep();
        assert.equal(out.inbox, 1);
        assert.equal(out.sheets, 0);
        assert.equal(entryOf(t.store.get(CID), old), null);
        assert.ok(entryOf(t.store.get(CID), fresh));
        assert.notEqual(clubJson(t.db, CID), before, 'the club was written');
        assert.equal(t.store.get(CID).teams[slug].version, version);
        assert.equal(t.store.get(CID).log.length, log);
        assert.deepEqual(JSON.parse(clubJson(t.db, CID)).inbox.map(e => e.id), [fresh]);
        // nothing stale: not written again
        const n = changes(t.db);
        assert.equal(t.store.sweep().inbox, 0);
        assert.equal(changes(t.db), n);
        // a day later the fresh one is stale too
        t.clock.now += 2 * 86400000;
        assert.equal(t.store.sweep().inbox, 1);
        assert.deepEqual(t.store.get(CID).inbox, []);
    } finally {
        cleanup(t);
    }
});


test('damage: a version without a plan id or n stops a change', () => {
    const t = setup();
    try {
        withTeam(t);
        const v = Object.values(t.store.get(CID).sheets)[0];
        const before = structuredClone(t.store.get(CID));
        for (const bad of [{plan: 'BAD'}, {plan: undefined}, {n: 0}, {n: 1.5}, {n: '1'}]) {
            assert.throws(() => t.store.change(CID, c => {
                c.sheets.x1x1x1 = {...v, ...bad};
            }), /sheet "x1x1x1" has no plan version/, JSON.stringify(bad));
        }
        assert.deepEqual(t.store.get(CID), before);
    } finally {
        cleanup(t);
    }
});


test('change: a failure keeps the old state', () => {
    const t = setup();
    try {
        withTeam(t);
        const before = structuredClone(t.store.get(CID));
        const json = clubJson(t.db, CID);

        assert.throws(() => t.store.change(CID, c => {
            c.name = 'Spokesmen CC';
            throw new Error('boom');
        }), /boom/);
        assert.deepEqual(t.store.get(CID), before);
        assert.equal(clubJson(t.db, CID), json);

        assert.throws(() => t.store.change(CID, c => {
            c.name = 'x'.repeat(2200000);
        }), e => e instanceof ClubError && e.code === 'too-big');
        assert.deepEqual(t.store.get(CID), before);
        assert.equal(clubJson(t.db, CID), json);
        assert.ok(2200000 > MAX_CLUB_BYTES);

        // A write SQLite refuses keeps memory and the row as they were.
        const undo = refuseWrites(t.db, 'clubs');
        try {
            assert.throws(() => t.store.change(CID, c => {
                c.name = 'Spokesmen CC';
            }), /test: write refused/);
        } finally {
            undo();
        }
        assert.deepEqual(t.store.get(CID), before);
        assert.equal(clubJson(t.db, CID), json);

        // Success: fn's result comes back, memory and the row hold the new state.
        assert.equal(t.store.change(CID, c => {
            c.name = 'Kettenfett Racing';
            return 42;
        }), 42);
        assert.equal(t.store.get(CID).name, 'Kettenfett Racing');
        assert.equal(JSON.parse(clubJson(t.db, CID)).name, 'Kettenfett Racing');
        assert.throws(() => t.store.change('zzzzzzzzzz', () => {}), e => e instanceof ClubError && e.code === 'not-found');
    } finally {
        cleanup(t);
    }
});


test('change: an archive whose transaction SQLite ended fails the change', () => {
    // the archive's own SQL hit a full disk: SQLite ended the transaction, so the change must not
    // go on as if only the archive had failed (its UPDATE would autocommit)
    let how = 'aborted';
    const t = setupWith({
        archiveVersions() {
            if (how === 'aborted') {
                throw new TxAborted('paceline.db: the transaction was ended by SQLite');
            }
            t.db.sql.exec('ROLLBACK');   // what SQLITE_FULL does to the open transaction
            throw new Error('database or disk is full');
        },
    });
    try {
        const {slug, id} = withTeam(t);
        const before = structuredClone(t.store.get(CID));
        const json = clubJson(t.db, CID);
        for (const mode of ['aborted', 'ended']) {
            how = mode;
            const n = changes(t.db);
            const {warned} = captureWarn(() => {
                assert.throws(() => t.store.change(CID, c => deleteSheet(c, slug, id, t.now())),
                    mode === 'aborted' ? TxAborted : /database or disk is full/, mode);
            });
            assert.deepEqual(t.store.get(CID), before, mode);
            assert.equal(clubJson(t.db, CID), json, mode);
            assert.equal(changes(t.db), n, `${mode}: nothing autocommitted`);
            assert.ok(!warned.some(w => w.includes('deleted without archive')), warned.join('\n'));
            assert.equal(t.db.sql.isTransaction, false);
        }
    } finally {
        cleanup(t);
    }
});


test('change: an archive write SQLite refuses fails a forced change too, nothing is deleted unarchived', () => {
    // the archive's SQL runs in a savepoint of the change; a refused INSERT must not let the change
    // go on as "deleted without archive" (a plain SQLite error inside db.tx is rethrown)
    const t = setup();
    try {
        const {slug, id} = withTeam(t);
        const name = `${t.now() - 2 * DAY}-1001.jsonl.gz`;
        t.logs.put(CID, slug, name, Buffer.from('x'));
        t.logs.addSigs(CID, slug, name, [t.store.get(CID).sheets[id].recSig]);
        const before = structuredClone(t.store.get(CID));
        const json = clubJson(t.db, CID);
        const undo = refuseWrites(t.db, 'archive', ['INSERT']);
        let warned;
        try {
            warned = captureWarn(() => assert.throws(() => t.store.change(CID, c => deleteSheet(c, slug, id, t.now())), /test: write refused/)).warned;
        } finally {
            undo();
        }
        assert.deepEqual(warned, []);
        assert.deepEqual(t.store.get(CID), before);
        assert.equal(clubJson(t.db, CID), json);
        assert.equal(t.db.sql.isTransaction, false);
        // once SQLite takes it, the version is archived with the change
        t.store.change(CID, c => deleteSheet(c, slug, id, t.now()));
        assert.deepEqual(rows(t.db, 'SELECT id FROM archive'), [{id}]);
        assert.deepEqual(Object.keys(t.store.get(CID).sheets), []);
    } finally {
        cleanup(t);
    }
});


test('change with also: its writes commit with the club; a throw in it or a refused club write rolls both back', () => {
    const t = setup();
    try {
        withTeam(t);
        const json = clubJson(t.db, CID);
        const unchanged = what => {
            assert.equal(t.store.slugTaken('old-team'), false, what);
            assert.deepEqual(rows(t.db, "SELECT slug FROM retired_slugs WHERE slug = 'old-team'"), [], what);
            assert.equal(t.store.get(CID).name, 'Kettenfett RC', what);
            assert.equal(clubJson(t.db, CID), json, what);
        };
        const rename = c => {
            c.name = 'Kettenfett Racing';
        };

        // a throw in also, after its own write
        assert.throws(() => t.store.change(CID, rename, {also: () => {
            t.store.retireSlugs(['old-team']);
            throw new Error('boom');
        }}), /boom/);
        unchanged('a throw in also');
        assert.equal(t.db.sql.isTransaction, false);

        // the club's row refuses the change: also's write goes too
        const undo = refuseWrites(t.db, 'clubs', ['UPDATE']);
        try {
            assert.throws(() => t.store.change(CID, rename, {also: () => t.store.retireSlugs(['old-team'])}), /test: write refused/);
        } finally {
            undo();
        }
        unchanged('a refused club write');
        assert.equal(t.db.sql.isTransaction, false);

        // both commit
        t.store.change(CID, rename, {also: () => t.store.retireSlugs(['old-team'])});
        assert.equal(t.store.get(CID).name, 'Kettenfett Racing');
        assert.equal(JSON.parse(clubJson(t.db, CID)).name, 'Kettenfett Racing');
        assert.equal(t.store.slugTaken('old-team'), true);
        assert.deepEqual(rows(t.db, "SELECT slug FROM retired_slugs WHERE slug = 'old-team'"), [{slug: 'old-team'}]);
    } finally {
        cleanup(t);
    }
});


test('trash: the club\'s bytes are looked up before the transaction; a failing lookup changes nothing', () => {
    const t = setupWith({
        circleBytes() {
            throw new Error('EIO: i/o error');
        },
    });
    try {
        withTeam(t);
        const before = structuredClone(t.store.get(CID));
        const json = clubJson(t.db, CID);
        const n = changes(t.db);
        assert.throws(() => t.store.trash(CID), /EIO/);
        assert.deepEqual(t.store.get(CID), before);
        assert.equal(clubJson(t.db, CID), json);
        assert.equal(changes(t.db), n);
        assert.deepEqual(t.store.trashed(), []);
        assert.equal(t.store.gone(CID), false);
    } finally {
        cleanup(t);
    }
});


test('dryRun: a clone changed, the size cap checked, nothing written', () => {
    const t = setup();
    try {
        const {slug, newId} = withTeam(t);
        const before = structuredClone(t.store.get(CID));
        const json = clubJson(t.db, CID);
        const n = changes(t.db);
        const {result, club: after} = t.store.dryRun(CID, c => uploadSheet(c, {
            slug, json: planJson('Rollers B', ['1004']), text: null, type: 'B', date: '2026-11-19', as: 'new', live: false,
            base: c.teams[slug].version, pinnedEventId: null, via: 'file',
        }, {now: t.now(), newId}));
        // the returned club has the sheet; the store and the row do not
        assert.equal(after.sheets[result.id].label, 'Rollers · B');
        assert.equal(after.teams[slug].version, before.teams[slug].version + 1);
        assert.ok(!Object.hasOwn(t.store.get(CID).sheets, result.id));
        assert.deepEqual(t.store.get(CID), before);
        assert.equal(clubJson(t.db, CID), json);
        // the returned club is a copy: changing it changes nothing stored
        after.name = 'Spokesmen CC';
        assert.equal(t.store.get(CID).name, before.name);
        // over the size cap: refused as change would be
        assert.throws(() => t.store.dryRun(CID, c => {
            c.name = 'x'.repeat(MAX_CLUB_BYTES);
        }), e => e instanceof ClubError && e.code === 'too-big');
        assert.throws(() => t.store.dryRun(CID, c => {
            c.teams = null;
        }), /store\.dryRun broke club/);
        assert.throws(() => t.store.dryRun('zzzzzzzzzz', () => {}), e => e instanceof ClubError && e.code === 'not-found');
        assert.deepEqual(t.store.get(CID), before);
        assert.equal(clubJson(t.db, CID), json);
        assert.equal(changes(t.db), n, 'nothing written');
    } finally {
        cleanup(t);
    }
});


test('index: listedIn follows the live pointer', () => {
    const t = setup();
    try {
        const {slug, id, newId} = withTeam(t);
        assert.equal(slug, 'rollers');
        assert.deepEqual(t.store.listedIn('1001'), [{cid: CID, slug: 'rollers', id}]);
        // The bench counts too; Zwift IDs as numbers are keys as strings.
        assert.deepEqual(t.store.listedIn(1003), [{cid: CID, slug: 'rollers', id}]);
        assert.deepEqual(t.store.listedIn('1009'), []);
        assert.deepEqual(t.store.listedIn('__proto__'), []);

        const variant = upload(t, CID, slug, planJson('Rollers', ['1002', '1004']),
            {type: 'B', as: 'new', live: false}, newId);
        assert.equal(variant.live, false);
        assert.deepEqual(t.store.listedIn('1004'), []);
        t.store.change(CID, c => makeLive(c, slug, variant.id, t.now()));
        assert.deepEqual(t.store.listedIn('1001'), []);
        assert.deepEqual(t.store.listedIn('1004'), [{cid: CID, slug: 'rollers', id: variant.id}]);

        // A reopened store builds the same index from the files.
        assert.deepEqual(t.open().listedIn('1004'), [{cid: CID, slug: 'rollers', id: variant.id}]);

        // Pending clubs never show up.
        const pending = newClub({id: CID2, name: 'Spokesmen CC', email: 'captain@example.org', tz: 'Europe/Berlin', now: t.now()});
        pending.teams.spokes = {name: 'Spokes', start: '19:30', live: 'h99999', version: 1, undo: null, changedAt: null};
        pending.sheets.h99999 = sheet({team: 'spokes', label: 'Spokes', date: '2026-11-19', riders: ['1005'], uploadedAt: '2026-11-19T11:00:00.000Z', plan: 'h99999'});
        t.store.create(pending);
        assert.deepEqual(t.store.listedIn('1005'), []);
        assert.equal(t.store.get(CID2), null);
        assert.equal(t.store.getAny(CID2).status, 'pending');
        assert.equal(t.store.pendingCount(), 1);
        assert.equal(t.store.activeCount(), 1);
        // Activating it puts its live sheet into the index.
        t.store.change(CID2, c => {
            c.status = 'active';
        });
        assert.deepEqual(t.store.listedIn('1005'), [{cid: CID2, slug: 'spokes', id: 'h99999'}]);
    } finally {
        cleanup(t);
    }
});


test('slugs, names and tokens', () => {
    const t = setup();
    try {
        withTeam(t);
        assert.equal(t.store.slugTaken('rollers'), true);
        assert.equal(t.store.slugTaken('sprockets'), false);
        assert.equal(t.store.slugTaken('__proto__'), false);
        assert.equal(t.store.slugOwner('rollers'), CID);
        assert.equal(t.store.slugOwner('sprockets'), null);
        assert.equal(t.store.slugOwner('constructor'), null);

        assert.equal(t.store.nameTaken('kettenfettrc'), true);
        assert.equal(t.store.nameTaken('kettenfettrc', CID), false);
        assert.equal(t.store.nameTaken('spokesmencc'), false);

        // A pending club's slugs are taken, but it owns no slug and its name is free.
        const pending = newClub({id: CID2, name: 'Spokesmen CC', email: 'captain@example.org', tz: 'Europe/Berlin', now: t.now()});
        pending.teams.spokes = {name: 'Spokes', start: null, live: null, version: 1, undo: null, changedAt: null};
        pending.tokens.push({hash: 'b'.repeat(64), kind: 'link', state: 'pending', expiresAt: null});
        t.store.create(pending);
        assert.equal(t.store.slugTaken('spokes'), true);
        assert.equal(t.store.slugOwner('spokes'), null);
        assert.equal(t.store.nameTaken('spokesmencc'), false);

        const token = {hash: 'a'.repeat(64), kind: 'link', state: 'active', expiresAt: null};
        t.store.change(CID, c => {
            c.tokens.push(token);
        });
        assert.deepEqual(t.store.tokenOwner('a'.repeat(64)), {cid: CID, token});
        assert.deepEqual(t.store.tokenOwner('b'.repeat(64)).cid, CID2);
        assert.equal(t.store.tokenOwner('c'.repeat(64)), null);
        assert.equal(t.store.tokenOwner('__proto__'), null);
        t.store.change(CID, c => {
            c.tokens = [];
        });
        assert.equal(t.store.tokenOwner('a'.repeat(64)), null);

        // Retired slugs stay taken, also after a restart.
        t.store.retireSlugs(['sprockets', 'Not A Slug']);
        assert.equal(t.store.slugTaken('sprockets'), true);
        assert.equal(t.open().slugTaken('sprockets'), true);
        assert.deepEqual(rows(t.db, 'SELECT slug FROM retired_slugs'), [{slug: 'sprockets'}]);

        // An id already in use is refused.
        assert.throws(() => t.store.create(club({id: CID})));
    } finally {
        cleanup(t);
    }
});


test('codeOwner follows the club', () => {
    const t = setup();
    try {
        withTeam(t);
        const first = riderCodeHash('7Q4MZ2KX9B', CODE_SECRET);
        const second = riderCodeHash('R1D3R0NE5X', CODE_SECRET);
        assert.equal(t.store.codeOwner(first), null);

        t.store.change(CID, c => setRiderCode(c, first, t.now()));
        assert.equal(t.store.codeOwner(first), CID);
        assert.equal(t.open().codeOwner(first), CID);
        const text = clubJson(t.db, CID);
        assert.ok(text.includes(first));
        assert.ok(!text.includes('7Q4MZ2KX9B'));
        assert.ok(!text.includes('7Q4MZ-2KX9B'));

        // A new code ends the old one at once.
        t.store.change(CID, c => setRiderCode(c, second, t.now()));
        assert.equal(t.store.codeOwner(first), null);
        assert.equal(t.store.codeOwner(second), CID);

        t.store.change(CID, c => clearRiderCode(c, t.now()));
        assert.equal(t.store.codeOwner(second), null);
        assert.equal(t.open().codeOwner(second), null);

        t.store.change(CID, c => setRiderCode(c, first, t.now()));
        t.store.trash(CID);
        assert.equal(t.store.codeOwner(first), null);
        assert.equal(t.open().codeOwner(first), null);
        t.store.restore(CID);
        assert.equal(t.store.codeOwner(first), CID);

        assert.equal(t.store.codeOwner('__proto__'), null);
        assert.equal(t.store.codeOwner('constructor'), null);
        assert.equal(t.store.codeOwner(first.toUpperCase()), null);
        assert.equal(t.store.codeOwner(undefined), null);
        assert.equal(t.store.codeOwner('7Q4MZ2KX9B'), null);

        // A pending club never owns a code; once active it does.
        const pending = newClub({id: CID2, name: 'Spokesmen CC', email: 'captain@example.org', tz: 'Europe/Berlin', now: t.now()});
        setRiderCode(pending, second, t.now());
        t.store.create(pending);
        assert.equal(t.store.codeOwner(second), null);
        assert.equal(t.open().codeOwner(second), null);
        t.store.change(CID2, c => {
            c.status = 'active';
        });
        assert.equal(t.store.codeOwner(second), CID2);

        // A malformed code is refused by change and keeps the old state.
        assert.throws(() => t.store.change(CID, c => {
            c.riderCode = {hash: 'nothex', setAt: c.riderCode.setAt};
        }), /riderCode/);
        assert.equal(t.store.codeOwner(first), CID);
    } finally {
        cleanup(t);
    }
});


test('tombstones and trash', () => {
    const t = setup();
    try {
        withTeam(t);
        const file = blob(t, CID, 'rollers');
        assert.ok(t.logs.totalBytes() > 0);
        t.store.see(CID, '1001', {sig: 'RE5CFQ', mod: '0.3.0', sheet: null, inEvent: false, event: null});
        t.store.flushSeen();
        assert.equal(rows(t.db, 'SELECT athlete FROM seen').length, 1);
        const before = structuredClone(t.store.get(CID));
        const json = clubJson(t.db, CID);
        const at = iso(t.now());

        t.store.trash(CID);
        assert.equal(t.store.gone(CID), true);
        assert.equal(t.store.get(CID), null);
        assert.equal(t.store.getAny(CID), null);
        assert.equal(t.store.nameTaken('kettenfettrc'), true);
        assert.equal(t.store.slugTaken('rollers'), true);
        assert.equal(t.store.slugOwner('rollers'), null);
        assert.deepEqual(t.store.listedIn('1001'), []);
        assert.deepEqual(t.store.seenOf(CID), {});
        // one transaction: the club row became the trash row, with the tombstone and the retired slug
        assert.deepEqual(rows(t.db, 'SELECT cid FROM clubs'), []);
        const trashRows = rows(t.db, 'SELECT * FROM trash');
        assert.deepEqual(trashRows.map(({json: j, ...r}) => r), [{
            cid: CID, name: 'Kettenfett RC', name_key: 'kettenfettrc', slugs: '["rollers"]', created_at: '2026-11-01T10:00:00.000Z', deleted_at: at,
        }]);
        assert.deepEqual(JSON.parse(trashRows[0].json), before);
        assert.deepEqual(rows(t.db, 'SELECT * FROM tombstone_clubs'), [{cid: CID, deleted_at: at}]);
        assert.deepEqual(rows(t.db, 'SELECT slug FROM retired_slugs'), [{slug: 'rollers'}]);
        assert.deepEqual(rows(t.db, 'SELECT athlete FROM seen'), []);
        // the recordings stay where they are, out of the quota and of retention while trashed
        assert.ok(fs.existsSync(file));
        assert.equal(t.logs.totalBytes(), 0);
        assert.equal(t.logs.sweep(t.now() + 100 * DAY, 90), 0);
        assert.ok(fs.existsSync(file));
        const [entry] = t.store.trashed();
        assert.deepEqual(entry, {
            id: CID, name: 'Kettenfett RC', createdAt: '2026-11-01T10:00:00.000Z', deletedAt: at,
            bytes: Buffer.byteLength(json) + t.logs.circleBytes(CID),
        });
        // The same after a restart.
        assert.deepEqual(t.open().trashed(), [entry]);
        assert.equal(t.open().gone(CID), true);

        t.clock.now += 8 * DAY;
        assert.deepEqual(t.store.sweep(), {sheets: 0, inbox: 0, pending: 0, trash: 1, tombstones: 0});
        assert.deepEqual(rows(t.db, 'SELECT cid FROM trash'), []);
        assert.equal(fs.existsSync(path.join(t.dataDir, 'logs', CID)), false);
        assert.deepEqual(t.store.trashed(), []);
        assert.equal(t.store.nameTaken('kettenfettrc'), false);
        assert.equal(t.store.slugTaken('rollers'), true);
        assert.equal(t.store.gone(CID), true);

        t.clock.now += 23 * DAY;
        assert.equal(t.store.gone(CID), false);
        assert.deepEqual(t.store.sweep(), {sheets: 0, inbox: 0, pending: 0, trash: 0, tombstones: 1});
        assert.deepEqual(rows(t.db, 'SELECT cid FROM tombstone_clubs'), []);
        assert.deepEqual(rows(t.db, 'SELECT slug FROM retired_slugs'), [{slug: 'rollers'}]);
        assert.equal(t.open().slugTaken('rollers'), true);
    } finally {
        cleanup(t);
    }
});


test('a club both active and in the trash (rows planted by hand) stays active, its trash entry is skipped', () => {
    const t = setup();
    try {
        withTeam(t);
        const file = blob(t, CID, 'rollers');
        t.db.sql.prepare('INSERT INTO trash (cid, json, name, name_key, slugs, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(CID, clubJson(t.db, CID), 'Kettenfett RC', 'kettenfettrc', '["rollers"]', '2026-11-01T10:00:00.000Z', iso(t.now()));
        const {result: store, warned} = captureWarn(() => t.open());
        assert.deepEqual(warned, ['paceline-server: skipping trashed club k7f3q9x2m4: it is also active, the active one is kept']);
        assert.deepEqual(store.trashed(), []);
        assert.equal(store.get(CID).id, CID);
        assert.throws(() => store.restore(CID), e => e instanceof ClubError && e.code === 'not-found');
        // its recordings are the active club's: they count
        assert.equal(t.logs.totalBytes(), t.logs.circleBytes(CID));
        // 7 days later the sweep purges no trash, so the active club keeps its recordings
        t.clock.now += 8 * DAY;
        assert.equal(store.sweep().trash, 0);
        assert.ok(fs.existsSync(file));
        assert.ok(clubJson(t.db, CID));
        assert.deepEqual(rows(t.db, 'SELECT cid FROM trash'), [{cid: CID}]);
    } finally {
        cleanup(t);
    }
});


test('restore within 7 days', () => {
    const t = setup();
    try {
        const {id} = withTeam(t);
        const before = structuredClone(t.store.get(CID));
        const file = blob(t, CID, 'rollers');

        t.store.trash(CID);
        t.clock.now += 6 * DAY;
        assert.deepEqual(t.store.restore(CID), before);
        assert.deepEqual(t.store.get(CID), before);
        assert.deepEqual(JSON.parse(clubJson(t.db, CID)), before);
        assert.deepEqual(rows(t.db, 'SELECT cid FROM trash'), []);
        assert.deepEqual(rows(t.db, 'SELECT cid FROM tombstone_clubs'), []);
        assert.ok(fs.existsSync(file));
        assert.equal(t.logs.totalBytes(), t.logs.circleBytes(CID));
        assert.equal(t.store.gone(CID), false);
        assert.deepEqual(t.store.trashed(), []);
        assert.equal(t.store.slugOwner('rollers'), CID);
        assert.deepEqual(t.store.listedIn('1001'), [{cid: CID, slug: 'rollers', id}]);
        assert.equal(t.open().gone(CID), false);
        assert.throws(() => t.store.restore(CID), e => e instanceof ClubError && e.code === 'not-found');
    } finally {
        cleanup(t);
    }
});


test('restore with a change: one write, and nothing restored when the change fails', () => {
    const t = setup();
    try {
        withTeam(t);
        const file = blob(t, CID, 'rollers');
        t.store.trash(CID);
        const trashRows = rows(t.db, 'SELECT * FROM trash');
        const tombstones = rows(t.db, 'SELECT * FROM tombstone_clubs');
        const unchanged = () => {
            assert.equal(t.store.get(CID), null);
            assert.deepEqual(t.store.trashed().map(x => x.id), [CID]);
            assert.equal(t.store.gone(CID), true);
            assert.equal(clubJson(t.db, CID), null);
            assert.deepEqual(rows(t.db, 'SELECT * FROM trash'), trashRows);
            assert.deepEqual(rows(t.db, 'SELECT * FROM tombstone_clubs'), tombstones);
            assert.ok(fs.existsSync(file));
        };
        // the change throws, or breaks the size cap: nothing restored
        assert.throws(() => t.store.restore(CID, c => {
            c.name = 'Spokesmen CC';
            throw new Error('boom');
        }), /boom/);
        unchanged();
        assert.throws(() => t.store.restore(CID, c => {
            c.name = 'x'.repeat(MAX_CLUB_BYTES);
        }), e => e instanceof ClubError && e.code === 'too-big');
        unchanged();
        assert.throws(() => t.store.restore(CID, c => {
            c.tokens = null;
        }), /store\.restore broke club/);
        unchanged();
        // the change lands in the same write as the restore
        const back = t.store.restore(CID, c => {
            c.name = 'Kettenfett RC restored';
        });
        assert.equal(back.name, 'Kettenfett RC restored');
        assert.equal(t.store.get(CID).name, 'Kettenfett RC restored');
        assert.equal(JSON.parse(clubJson(t.db, CID)).name, 'Kettenfett RC restored');
        assert.equal(t.open().get(CID).name, 'Kettenfett RC restored');
        assert.ok(fs.existsSync(file));
        assert.deepEqual(rows(t.db, 'SELECT cid FROM trash'), []);
    } finally {
        cleanup(t);
    }
});


test('restore: a damaged trash row is refused and stays in the trash', () => {
    const t = setup();
    try {
        withTeam(t);
        t.store.trash(CID);
        t.db.sql.prepare('UPDATE trash SET json = ? WHERE cid = ?').run('{', CID);
        assert.throws(() => t.store.restore(CID), /^Error: damaged trashed club k7f3q9x2m4 in paceline\.db: /);
        assert.deepEqual(t.store.trashed().map(x => x.id), [CID]);
        assert.equal(clubJson(t.db, CID), null);
    } finally {
        cleanup(t);
    }
});


test('purge: trashed or active, the slugs stay retired', () => {
    const t = setup();
    try {
        withTeam(t);
        withTeam(t, CID2, 'Spokesmen CC');  // slug rollers-2
        blob(t, CID, 'rollers');
        blob(t, CID2, 'rollers-2');
        t.store.trash(CID);
        t.store.purge(CID);
        assert.deepEqual(rows(t.db, 'SELECT cid FROM trash'), []);
        assert.equal(fs.existsSync(path.join(t.dataDir, 'logs', CID)), false);
        assert.deepEqual(t.store.trashed(), []);
        assert.equal(t.store.gone(CID), true);

        t.store.purge(CID2);
        assert.equal(t.store.get(CID2), null);
        assert.equal(clubJson(t.db, CID2), null);
        assert.equal(fs.existsSync(path.join(t.dataDir, 'logs', CID2)), false);
        assert.equal(t.store.gone(CID2), true);
        assert.deepEqual(rows(t.db, 'SELECT cid FROM tombstone_clubs ORDER BY cid').map(r => r.cid), [CID, CID2]);
        assert.equal(t.store.slugTaken('rollers-2'), true);
        assert.equal(t.open().slugTaken('rollers-2'), true);
        assert.throws(() => t.store.purge(CID2), e => e instanceof ClubError && e.code === 'not-found');
    } finally {
        cleanup(t);
    }
});


test('trash, restore and purge: a refused write changes nothing', () => {
    const t = setup();
    try {
        withTeam(t);
        const file = blob(t, CID, 'rollers');
        const before = structuredClone(t.store.get(CID));
        const json = clubJson(t.db, CID);
        const refused = (table, ops, fn) => {
            const undo = refuseWrites(t.db, table, ops);
            try {
                assert.throws(fn, /test: write refused/);
            } finally {
                undo();
            }
        };

        // trash: the club stays active, with no tombstone and no retired slug
        refused('trash', ['INSERT'], () => t.store.trash(CID));
        assert.deepEqual(t.store.get(CID), before);
        assert.equal(clubJson(t.db, CID), json);
        assert.equal(t.store.gone(CID), false);
        assert.deepEqual(t.store.trashed(), []);
        assert.equal(t.store.slugOwner('rollers'), CID);
        assert.deepEqual(rows(t.db, 'SELECT cid FROM trash'), []);
        assert.deepEqual(rows(t.db, 'SELECT cid FROM tombstone_clubs'), []);
        assert.deepEqual(rows(t.db, 'SELECT slug FROM retired_slugs'), []);

        // restore: still trashed, the tombstone kept
        t.store.trash(CID);
        const trashRows = rows(t.db, 'SELECT * FROM trash');
        const tombstones = rows(t.db, 'SELECT * FROM tombstone_clubs');
        const trashed = t.store.trashed();
        refused('clubs', ['INSERT'], () => t.store.restore(CID));
        assert.equal(t.store.get(CID), null);
        assert.deepEqual(t.store.trashed(), trashed);
        assert.equal(t.store.gone(CID), true);
        assert.equal(clubJson(t.db, CID), null);
        assert.deepEqual(rows(t.db, 'SELECT * FROM trash'), trashRows);
        assert.deepEqual(rows(t.db, 'SELECT * FROM tombstone_clubs'), tombstones);

        // purge of a trashed club: still trashed, its recordings still there
        refused('trash', ['DELETE'], () => t.store.purge(CID));
        assert.deepEqual(t.store.trashed(), trashed);
        assert.deepEqual(rows(t.db, 'SELECT * FROM trash'), trashRows);
        assert.ok(fs.existsSync(file));

        // purge of an active club: still active, its recordings still there
        t.store.restore(CID);
        refused('tombstone_clubs', ['INSERT'], () => t.store.purge(CID));
        assert.deepEqual(t.store.get(CID), before);
        assert.equal(clubJson(t.db, CID), json);
        assert.equal(t.store.gone(CID), false);
        assert.deepEqual(rows(t.db, 'SELECT cid FROM tombstone_clubs'), []);
        assert.ok(fs.existsSync(file));

        // inside a caller's transaction that fails afterwards: taken back, memory included
        for (const fn of [() => t.store.change(CID, c => {
            c.name = 'Spokesmen CC';
        }), () => t.store.trash(CID), () => t.store.purge(CID)]) {
            assert.throws(() => t.db.tx(() => {
                fn();
                throw new Error('a later step failed');
            }), /a later step failed/);
            assert.deepEqual(t.store.get(CID), before);
            assert.equal(clubJson(t.db, CID), json);
            assert.equal(t.store.gone(CID), false);
            assert.deepEqual(t.store.trashed(), []);
            assert.ok(fs.existsSync(file));
        }
    } finally {
        cleanup(t);
    }
});


test('seen: 300 per club, 14 days, flushed', () => {
    const t = setup();
    try {
        // One stored sheet lists 1001-1003 and 2000-2300 as riders (create applies no 40-rider cap).
        const ids = ['1001', '1002', '1003'];
        for (let i = 0; i <= 300; i++) {
            ids.push(String(2000 + i));
        }
        t.store.create(club({
            id: CID,
            teams: {rollers: {name: 'Rollers', start: '19:30', live: null, version: 1, undo: null, changedAt: null}},
            sheets: {h00001: sheet({team: 'rollers', label: 'Rollers', date: '2026-11-19', riders: ids, uploadedAt: '2026-11-19T10:00:00.000Z'})},
        }));
        const start = t.clock.now;
        for (let i = 0; i < 301; i++) {
            t.clock.now = start + i * 1000;
            t.store.see(CID, String(2000 + i), {sig: 'RE5CFQ', mod: '0.3.0', sheet: null, inEvent: false, event: null});
        }
        const seen = t.store.seenOf(CID);
        assert.equal(Object.keys(seen).length, 300);
        assert.equal(Object.hasOwn(seen, '2000'), false);
        assert.deepEqual(seen['2300'], {at: new Date(t.clock.now).toISOString(), sig: 'RE5CFQ', mod: '0.3.0', sheet: null, inEvent: false, event: null});

        // Seeing a rider again replaces his entry; the oldest other one stays.
        t.store.see(CID, '2001', {sig: 'ABCDEF', mod: '0.3.0', sheet: null, inEvent: false, event: null});
        assert.equal(Object.keys(t.store.seenOf(CID)).length, 300);
        assert.equal(t.store.seenOf(CID)['2001'].sig, 'ABCDEF');

        // Unknown clubs and bad ids are not recorded.
        t.store.see(CID2, '2000', {sig: 'RE5CFQ'});
        t.store.see(CID, '__proto__', {sig: 'RE5CFQ'});
        assert.deepEqual(t.store.seenOf(CID2), {});
        assert.equal(Object.keys(t.store.seenOf(CID)).length, 300);

        assert.equal(t.store.flushSeen(), true);
        assert.equal(rows(t.db, 'SELECT athlete FROM seen WHERE cid = ?', CID).length, 300);
        // Nothing changed: no write.
        const n = changes(t.db);
        assert.equal(t.store.flushSeen(), false);
        assert.equal(changes(t.db), n);
        // one more rider pushes the oldest out, its row too
        t.store.see(CID, '1001', {sig: 'RE5CFQ', mod: '0.3.0', sheet: null, inEvent: false, event: null});
        assert.equal(t.store.flushSeen(), true);
        assert.equal(rows(t.db, 'SELECT athlete FROM seen WHERE cid = ?', CID).length, 300);
        assert.deepEqual(rows(t.db, "SELECT athlete FROM seen WHERE athlete IN ('1001', '2002')"), [{athlete: '1001'}]);

        // An entry 15 days old is gone on read.
        t.clock.now = start + 20 * DAY;
        t.store.see(CID, '1001', {sig: 'RE5CFQ', mod: '0.3.0', sheet: null, inEvent: false, event: null});
        t.clock.now += 15 * DAY;
        t.store.see(CID, '1002', {sig: 'RE5CFQ', mod: '0.3.0', sheet: null, inEvent: false, event: null});
        assert.deepEqual(Object.keys(t.store.seenOf(CID)), ['1002']);

        t.store.forget(CID, '1002');
        assert.deepEqual(t.store.seenOf(CID), {});

        t.store.see(CID, '1003', {sig: 'RE5CFQ', mod: '0.3.0', sheet: null, inEvent: false, event: null});
        t.store.flushSeen();
        // the pruned entries went from the table too
        assert.deepEqual(rows(t.db, 'SELECT athlete FROM seen'), [{athlete: '1003'}]);
        assert.deepEqual(Object.keys(t.open().seenOf(CID)), ['1003']);
    } finally {
        cleanup(t);
    }
});


test('seen: see() writes nothing; the flush writes only what changed, in one transaction; a refused flush keeps it dirty', () => {
    const t = setup();
    try {
        const {id} = withTeam(t);   // Ben and Cleo ride, Dan is on the bench
        const fine = {sig: 'RE5CFQ', mod: '0.3.0', sheet: null, inEvent: false, event: null};
        let n = changes(t.db);
        assert.equal(t.store.see(CID, '1001', fine), true);
        assert.equal(t.store.see(CID, '1002', fine), true);
        assert.equal(t.store.see(CID, '1003', {sig: 'RE5CFQ', mod: '0.3.0', sheet: id, inEvent: true, event: '4567890'}), true);
        assert.equal(changes(t.db), n, 'see() writes nothing');
        assert.equal(t.store.flushSeen(), true);
        assert.equal(changes(t.db) - n, 3);
        assert.deepEqual(rows(t.db, 'SELECT * FROM seen ORDER BY athlete'), [
            {cid: CID, athlete: '1001', sig: 'RE5CFQ', mod: '0.3.0', sheet: null, in_event: 0, event: null, at: iso(t.now())},
            {cid: CID, athlete: '1002', sig: 'RE5CFQ', mod: '0.3.0', sheet: null, in_event: 0, event: null, at: iso(t.now())},
            {cid: CID, athlete: '1003', sig: 'RE5CFQ', mod: '0.3.0', sheet: id, in_event: 1, event: 4567890, at: iso(t.now())},
        ]);

        // one more check: the next flush writes that one row
        t.clock.now += 60000;
        t.store.see(CID, '1002', {...fine, sig: 'ABCDEF'});
        n = changes(t.db);
        assert.equal(t.store.flushSeen(), true);
        assert.equal(changes(t.db) - n, 1);
        assert.deepEqual(rows(t.db, "SELECT sig, at FROM seen WHERE athlete = '1002'"), [{sig: 'ABCDEF', at: iso(t.now())}]);

        // a refused flush writes nothing and keeps the entry for the next one
        t.store.see(CID, '1001', {...fine, mod: '0.3.1'});
        const undo = refuseWrites(t.db, 'seen');
        try {
            assert.throws(() => t.store.flushSeen(), /test: write refused/);
        } finally {
            undo();
        }
        assert.deepEqual(rows(t.db, "SELECT mod FROM seen WHERE athlete = '1001'"), [{mod: '0.3.0'}]);
        assert.equal(t.store.flushSeen(), true);
        assert.deepEqual(rows(t.db, "SELECT mod FROM seen WHERE athlete = '1001'"), [{mod: '0.3.1'}]);
        assert.equal(t.store.flushSeen(), false);

        // forget takes the row out at once (Remove a rider), not at the next flush
        t.store.forget(CID, '1002');
        assert.deepEqual(rows(t.db, 'SELECT athlete FROM seen ORDER BY athlete').map(r => r.athlete), ['1001', '1003']);
        assert.equal(Object.hasOwn(t.store.seenOf(CID), '1002'), false);
        assert.equal(t.store.flushSeen(), false);
        // a dirty entry forgotten leaves nothing to flush
        assert.equal(t.store.see(CID, '1002', fine), true);
        t.store.forget(CID, '1002');
        const n2 = changes(t.db);
        assert.equal(t.store.flushSeen(), false);
        assert.equal(changes(t.db), n2);

        // a restart reads the entries back as they were
        const seen = t.store.seenOf(CID);
        assert.deepEqual(t.open().seenOf(CID), seen);
        assert.deepEqual(seen['1003'], {at: iso(t.now() - 60000), sig: 'RE5CFQ', mod: '0.3.0', sheet: id, inEvent: true, event: 4567890});
    } finally {
        cleanup(t);
    }
});


test('seen: only riders the club lists, every field checked', () => {
    const t = setup();
    try {
        const {slug, id} = withTeam(t);
        const at = new Date(t.clock.now).toISOString();
        const fine = {sig: 'RE5CFQ', mod: '0.3.0', sheet: null, inEvent: false, event: null};

        // Not listed: refused, nothing stored. A bench rider counts.
        assert.equal(t.store.see(CID, '1009', fine), false);
        assert.equal(Object.hasOwn(t.store.seenOf(CID), '1009'), false);
        assert.equal(t.store.see(CID, '1003', fine), true);
        assert.deepEqual(t.store.seenOf(CID)['1003'], {at, ...fine});
        assert.equal(t.store.see(CID, '__proto__', fine), false);
        assert.equal(t.store.see(CID2, '1001', fine), false);

        // A rider only on a stored sheet that is not live counts.
        upload(t, CID, slug, planJson('Rollers fast', ['1005']), {as: 'new', type: 'fast', live: false}, counter());
        assert.equal(t.store.get(CID).teams[slug].live, id);
        assert.equal(t.store.see(CID, '1005', fine), true);

        // Bad fields become null/false; nothing else is kept.
        assert.equal(t.store.see(CID, '1001', {
            sig: 'bad', mod: '9.9', sheet: '../x', inEvent: 'yes', event: 2147483648, name: 'x'.repeat(100000),
        }), true);
        assert.deepEqual(t.store.seenOf(CID)['1001'], {at, sig: null, mod: null, sheet: null, inEvent: false, event: null});

        assert.equal(t.store.see(CID, '1001', {sig: 'RE5CFQ', mod: '0.3.0', sheet: id, inEvent: true, event: '4567890'}), true);
        assert.deepEqual(t.store.seenOf(CID)['1001'], {at, sig: 'RE5CFQ', mod: '0.3.0', sheet: id, inEvent: true, event: 4567890});
        // 0.2 is no mod version any more (hard cut, 17 Nov 2026)
        assert.equal(t.store.see(CID, '1001', {sig: 'RE5CFQ', mod: '0.2', sheet: id, inEvent: true, event: '4567890'}), true);
        assert.deepEqual(t.store.seenOf(CID)['1001'], {at, sig: 'RE5CFQ', mod: null, sheet: id, inEvent: true, event: 4567890});

        // A missing or non-object entry is stored as all-null.
        assert.equal(t.store.see(CID, '1002', undefined), true);
        assert.deepEqual(t.store.seenOf(CID)['1002'], {at, sig: null, mod: null, sheet: null, inEvent: false, event: null});

        // the rows are checked on load the same way
        t.store.flushSeen();
        t.db.sql.prepare("UPDATE seen SET sig = 'bad' WHERE athlete = '1001'").run();
        t.db.sql.prepare("UPDATE seen SET at = 'not a time' WHERE athlete = '1002'").run();
        t.db.sql.prepare("UPDATE seen SET athlete = 'x1003' WHERE athlete = '1003'").run();
        const loaded = t.open().seenOf(CID);
        assert.deepEqual(Object.keys(loaded).sort(), ['1001', '1005']);
        assert.deepEqual(Object.keys(loaded['1001']).sort(), ['at', 'event', 'inEvent', 'mod', 'sheet', 'sig']);
        assert.equal(loaded['1001'].sig, null);
    } finally {
        cleanup(t);
    }
});


test('cleanSeen: exactly the five checked fields', () => {
    assert.deepEqual(cleanSeen({sig: 'RE5CFQ', mod: '0.3.0-beta.2', sheet: 'h00001', inEvent: true, event: 7}),
        {sig: 'RE5CFQ', mod: '0.3.0-beta.2', sheet: 'h00001', inEvent: true, event: 7});
    for (const bad of [null, undefined, 'x', 5, []]) {
        assert.deepEqual(cleanSeen(bad), {sig: null, mod: null, sheet: null, inEvent: false, event: null});
    }
    assert.equal(cleanSeen({sig: 'RE5CFQ '}).sig, null);
    assert.equal(cleanSeen({sig: 'abcdef'}).sig, null);
    assert.equal(cleanSeen({mod: '0.2.'}).mod, null);
    assert.equal(cleanSeen({event: 0}).event, null);
    assert.equal(cleanSeen({event: {}}).event, null);
    assert.equal(cleanSeen({sheet: 5}).sheet, null);
    assert.equal(cleanSeen({inEvent: 1}).inEvent, false);
});


test('pending clubs go after 24 hours', () => {
    const t = setup();
    try {
        t.store.create(newClub({id: CID, name: 'Kettenfett RC', email: 'captain@example.org', tz: 'Europe/Berlin', now: t.now()}));
        t.clock.now += 23 * 3600000;
        t.store.create(newClub({id: CID2, name: 'Spokesmen CC', email: 'captain@example.org', tz: 'Europe/Berlin', now: t.now()}));
        assert.deepEqual(t.store.sweep(), {sheets: 0, inbox: 0, pending: 0, trash: 0, tombstones: 0});
        t.clock.now += 2 * 3600000;
        assert.deepEqual(t.store.sweep(), {sheets: 0, inbox: 0, pending: 1, trash: 0, tombstones: 0});
        assert.equal(t.store.getAny(CID), null);
        assert.equal(clubJson(t.db, CID), null);
        assert.equal(t.store.getAny(CID2).status, 'pending');
        assert.equal(t.store.pendingCount(), 1);

        assert.equal(t.store.removePending(CID2), true);
        assert.equal(t.store.getAny(CID2), null);
        // removePending leaves active clubs alone.
        t.store.create(club({id: CID}));
        assert.equal(t.store.removePending(CID), false);
        assert.ok(t.store.get(CID));
    } finally {
        cleanup(t);
    }
});


test('pending(): pending clubs only, oldest first', () => {
    const t = setup();
    try {
        const CID3 = 'm4q7d2s9pk';
        t.store.create(club({id: CID}));
        t.store.create(newClub({id: CID2, name: 'Spokesmen CC', email: 'captain@example.org', tz: 'Europe/Berlin', now: t.now()}));
        t.store.create(newClub({id: CID3, name: 'Rollers CC', email: 'second@example.org', tz: 'Europe/Berlin', now: t.now() - 60000}));
        assert.deepEqual(t.store.pending().map(c => c.id), [CID3, CID2]);
        assert.deepEqual(t.store.active().map(c => c.id), [CID]);
        assert.equal(t.store.pendingCount(), 2);
        t.store.removePending(CID3);
        assert.deepEqual(t.store.pending().map(c => c.id), [CID2]);
    } finally {
        cleanup(t);
    }
});


test('sweep: only clubs with something to delete are written', () => {
    const t = setup();
    try {
        t.store.create(club({id: CID, teams: {rollers: {name: 'Rollers', start: '19:30', live: null, version: 1, undo: null, changedAt: null}}}));
        t.store.create(club({id: CID2, name: 'Spokesmen CC'}));
        t.store.change(CID, c => {
            for (const [i, date] of ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'].entries()) {
                c.sheets[`h0000${i}`] = sheet({team: 'rollers', label: 'Rollers', date, riders: ['1001'], uploadedAt: `${date}T10:00:00.000Z`, plan: `h0000${i}`});
            }
        });
        const json2 = clubJson(t.db, CID2);
        let n = changes(t.db);
        // every used-up plan 7 days after its date, no "last two" any more (plan versions spec §11)
        assert.deepEqual(t.store.sweep(), {sheets: 4, inbox: 0, pending: 0, trash: 0, tombstones: 0});
        assert.deepEqual(Object.keys(t.store.get(CID).sheets), []);
        assert.equal(changes(t.db) - n, 1, 'one row written: the club that lost its plans');
        assert.deepEqual(Object.keys(JSON.parse(clubJson(t.db, CID)).sheets), []);
        assert.equal(clubJson(t.db, CID2), json2);
        n = changes(t.db);
        assert.deepEqual(t.store.sweep(), {sheets: 0, inbox: 0, pending: 0, trash: 0, tombstones: 0});
        assert.equal(changes(t.db), n);
        // the dry run only reads: a sweep with nothing to delete clones no club
        const clone = globalThis.structuredClone;
        let clones = 0;
        globalThis.structuredClone = v => {
            clones++;
            return clone(v);
        };
        try {
            assert.deepEqual(t.store.sweep(), {sheets: 0, inbox: 0, pending: 0, trash: 0, tombstones: 0});
        } finally {
            globalThis.structuredClone = clone;
        }
        assert.equal(clones, 0);
    } finally {
        cleanup(t);
    }
});


test('sweep drops expired tokens: confirmations, unconfirmed new addresses, pending links', () => {
    const t = setup();
    try {
        const at = new Date(t.now()).toISOString();
        const later = new Date(t.now() + DAY).toISOString();
        const tokens = [
            {hash: 'a'.repeat(64), kind: 'link', state: 'active', createdAt: at, expiresAt: null},
            {hash: 'b'.repeat(64), kind: 'link', state: 'pending', createdAt: at, expiresAt: later},
            {hash: 'c'.repeat(64), kind: 'confirm', action: 'email', email: 'new@example.org', createdAt: at, expiresAt: later},
        ];
        t.store.create({...club({id: CID}), tokens});
        t.store.create(club({id: CID2, name: 'Spokesmen CC'}));
        t.clock.now += 3600000;
        const n = changes(t.db);
        t.store.sweep();
        assert.equal(changes(t.db), n, 'nothing expired: not written');
        t.store.change(CID, c => {
            c.tokens.push({hash: 'd'.repeat(64), kind: 'email', email: 'typo@example.org', createdAt: at, expiresAt: new Date(t.now() + DAY).toISOString()});
        });
        t.clock.now += DAY;
        t.store.sweep();
        const kept = t.store.get(CID).tokens.map(x => x.hash[0]);
        assert.deepEqual(kept, ['a', 'd'], 'the expired pending link and confirmation go, the active link and a live email token stay');
        assert.ok(!clubJson(t.db, CID).includes('new@example.org'), 'the unconfirmed new address is gone from the row');
        t.clock.now += DAY;
        t.store.sweep();
        assert.deepEqual(t.store.get(CID).tokens.map(x => x.hash[0]), ['a']);
        assert.ok(!clubJson(t.db, CID).includes('typo@example.org'));
    } finally {
        cleanup(t);
    }
});


test('server settings are a row', () => {
    const t = setup();
    try {
        const setting = () => rows(t.db, "SELECT value FROM settings WHERE name = 'registration'");
        assert.deepEqual(t.store.serverSettings(), {registration: null});
        assert.deepEqual(setting(), []);
        t.store.setRegistration('closed');
        assert.deepEqual(t.store.serverSettings(), {registration: 'closed'});
        assert.deepEqual(setting(), [{value: '"closed"'}]);
        assert.deepEqual(t.open().serverSettings(), {registration: 'closed'});
        assert.deepEqual(setting(), [{value: '"closed"'}]);
        t.store.setRegistration(null);
        assert.deepEqual(setting(), [{value: 'null'}]);
        assert.deepEqual(t.open().serverSettings(), {registration: null});
        assert.throws(() => t.store.setRegistration('maybe'), TypeError);
        // a refused write keeps the setting
        const undo = refuseWrites(t.db, 'settings');
        try {
            assert.throws(() => t.store.setRegistration('open'), /test: write refused/);
        } finally {
            undo();
        }
        assert.deepEqual(t.store.serverSettings(), {registration: null});
        // a value that is not one of the three warns and counts as unset
        for (const value of ['"maybe"', 'nope']) {
            t.db.sql.prepare("UPDATE settings SET value = ? WHERE name = 'registration'").run(value);
            const {result, warned} = captureWarn(() => t.open());
            assert.deepEqual(result.serverSettings(), {registration: null}, value);
            assert.equal(warned.length, 1, value);
            assert.match(warned[0], /registration/, value);
        }
    } finally {
        cleanup(t);
    }
});


// ---- the archive (plan versions spec §11, Ruling 14) ----

// A store on paceline.db in a temp dir with `archive` as its archive.
function setupWith(archive) {
    const t = setup();
    t.store = openStore({db: t.db, now: t.now, archive});
    return t;
}

// A recording of the team with these plan codes, through the log store.
function recording(t, logs, slug, codes, session = t.now() - 2 * DAY) {
    const name = `${session}-1001.jsonl.gz`;
    logs.put(CID, slug, name, Buffer.from('x'));
    logs.addSigs(CID, slug, name, codes);
    return name;
}

// The team's archive rows as {id: version}.
const archiveOf = (t, slug) => Object.fromEntries(rows(t.db, 'SELECT id, version FROM archive WHERE cid = ? AND slug = ? ORDER BY rowid', CID, slug)
    .map(r => [r.id, JSON.parse(r.version)]));


test('change: dropped versions go to the archive first; a failing archive keeps the club', () => {
    let fail = false;
    const archive = {
        calls: [],
        archiveVersions(cid, slug, list) {
            if (fail) {
                throw new Error('ENOSPC: no space left on device');
            }
            archive.calls.push([cid, slug, list.map(([id]) => id)]);
            return list.length;
        },
    };
    const t = setupWith(archive);
    try {
        const {slug, id, newId} = withTeam(t);
        const v2 = upload(t, CID, slug, planJson('Rollers', ['1001', '1002', '1004'], ['1003']), {as: id}, newId).id;
        assert.equal(t.store.get(CID).sheets[v2].plan, t.store.get(CID).sheets[id].plan);
        archive.calls.length = 0;
        // a change that drops nothing, a dry run, archive: false: no call
        t.store.change(CID, c => {
            c.name = 'Kettenfett Racing';
        });
        t.store.dryRun(CID, c => deleteSheet(c, slug, id, t.now()));
        assert.deepEqual(archive.calls, []);

        // the archive fails: 'retry' keeps the club in memory and in its row, one line per club
        const before = structuredClone(t.store.get(CID));
        const json = clubJson(t.db, CID);
        fail = true;
        const {warned} = captureWarn(() => {
            for (let i = 0; i < 2; i++) {
                assert.throws(() => t.store.change(CID, c => deleteSheet(c, slug, id, t.now()), {archive: 'retry'}), /archive/);
            }
        });
        assert.deepEqual(t.store.get(CID), before);
        assert.equal(clubJson(t.db, CID), json);
        assert.equal(warned.length, 1, warned.join('\n'));
        assert.ok(warned[0].includes(CID), warned[0]);

        // the default ('force') deletes all the same, and says so once, naming the club and the count
        const forced = captureWarn(() => t.store.change(CID, c => deleteSheet(c, slug, id, t.now())));
        assert.deepEqual(Object.keys(t.store.get(CID).sheets), []);
        assert.equal(forced.warned.length, 1, forced.warned.join('\n'));
        assert.ok(forced.warned[0].includes(CID) && forced.warned[0].includes(' 2 '), forced.warned[0]);
        fail = false;

        // a plan with two versions deleted: one call with both ids, under the old team
        const {id: a} = upload(t, CID, slug, planJson('Rollers', ['1001']), {}, newId);
        const {id: b} = upload(t, CID, slug, planJson('Rollers', ['1001', '1002']), {as: a}, newId);
        archive.calls.length = 0;
        t.store.change(CID, c => deleteSheet(c, slug, b, t.now()));
        assert.deepEqual(archive.calls, [[CID, slug, [a, b]]]);
        // archive: false (Remove a rider) never calls it
        const {id: c1} = upload(t, CID, slug, planJson('Rollers', ['1001']), {}, newId);
        archive.calls.length = 0;
        t.store.change(CID, c => deleteSheet(c, slug, c1, t.now()), {archive: false});
        assert.deepEqual(archive.calls, []);
        assert.deepEqual(Object.keys(t.store.get(CID).sheets), []);
    } finally {
        cleanup(t);
    }
});


test('sweep: whole plans; the used versions are archived, the rest not', () => {
    const s = setup();
    const {dataDir, logs, clock} = s;
    let fail = false;
    const archive = {
        archiveVersions(...a) {
            if (fail) {
                throw new Error('ENOSPC: no space left on device');
            }
            return logs.archiveVersions(...a);
        },
    };
    const store = openStore({db: s.db, now: s.now, archive});
    const t = {dataDir, now: s.now};
    try {
        store.create(club({id: CID, teams: {rollers: {name: 'Rollers', start: '19:30', live: null, version: 1, undo: null, changedAt: null}}}));
        const v = (n, recSig) => sheet({team: 'rollers', label: 'Rollers', date: '2026-11-04', riders: ['1001', '1002'],
            uploadedAt: `2026-11-04T1${n}:00:00.000Z`, plan: 'h00001', n, recSig});
        const v1 = v(1, 'AAAAAA');
        const v2 = v(2, 'BBBBBB');
        store.change(CID, c => {
            c.sheets.h00001 = v1;
            c.sheets.h00002 = v2;
        });
        recording(t, logs, 'rollers', ['AAAAAA'], T('2026-11-04T18:00Z'));
        // an inbox entry over 24 h and an expired confirmation: they go even while the archive fails
        const old = store.change(CID, c => addEntry(c, {source: 'upload', team: 'rollers', json: planJson('Rollers', ['1003']), text: null},
            {now: clock.now - 25 * 3600000, newId: counter()}));
        store.change(CID, c => {
            c.tokens.push({hash: 'c'.repeat(64), kind: 'confirm', action: 'email', email: 'new@example.org',
                createdAt: new Date(clock.now - 2 * DAY).toISOString(), expiresAt: new Date(clock.now - DAY).toISOString()});
        });
        // the archive fails: the sweep keeps the plan, logs once, and tries again next run
        fail = true;
        const errors = [];
        const error = console.error;
        console.error = (...x) => errors.push(x.join(' '));
        let warned;
        try {
            warned = captureWarn(() => {
                assert.deepEqual(store.sweep(), {sheets: 0, inbox: 1, pending: 0, trash: 0, tombstones: 0});
                assert.deepEqual(store.sweep(), {sheets: 0, inbox: 0, pending: 0, trash: 0, tombstones: 0});
            }).warned;
        } finally {
            console.error = error;
        }
        assert.deepEqual(errors, []);
        assert.equal(entryOf(store.get(CID), old), null);
        assert.deepEqual(store.get(CID).tokens, []);
        const stored = clubJson(s.db, CID);
        assert.ok(!stored.includes('new@example.org') && !stored.includes('"1003"'), 'gone from the row too');
        assert.equal(warned.length, 1, warned.join('\n'));
        assert.deepEqual(Object.keys(store.get(CID).sheets).sort(), ['h00001', 'h00002']);
        fail = false;
        assert.deepEqual(store.sweep(), {sheets: 2, inbox: 0, pending: 0, trash: 0, tombstones: 0});
        assert.deepEqual(Object.keys(store.get(CID).sheets), []);
        const kept = archiveOf(s, 'rollers');
        assert.deepEqual(Object.keys(kept), ['h00001']);
        assert.equal(kept.h00001.recSig, 'AAAAAA');
        assert.deepEqual(kept.h00001.json, v1.json);
    } finally {
        cleanup(s);
    }
});


test('delete team archives its used versions; trash, restore and purge carry the archive', () => {
    const t = setup();
    const {dataDir, logs} = t;
    try {
        const {slug, id} = withTeam(t);
        const name = recording(t, logs, slug, [t.store.get(CID).sheets[id].recSig]);
        t.store.change(CID, c => deleteTeam(c, slug, t.now()));
        assert.deepEqual(Object.keys(t.store.get(CID).sheets), []);
        assert.deepEqual(Object.keys(archiveOf(t, slug)), [id]);
        // the archive rows and the recording stay while the club is in the trash
        const kept = () => [JSON.stringify(archiveOf(t, slug)), logs.list(CID).map(r => r.file), [...logs.codes(CID, slug)],
            fs.existsSync(path.join(dataDir, 'logs', CID, slug, name))];
        const before = kept();
        assert.equal(before[0].includes(`"${id}"`), true);
        t.store.trash(CID);
        assert.deepEqual(kept(), before);
        t.store.restore(CID);
        assert.deepEqual(kept(), before);
        t.store.purge(CID);
        assert.deepEqual(rows(t.db, 'SELECT * FROM archive'), []);
        assert.deepEqual(rows(t.db, 'SELECT * FROM recordings'), []);
        assert.deepEqual(rows(t.db, 'SELECT * FROM recording_sigs'), []);
        assert.ok(!fs.existsSync(path.join(dataDir, 'logs', CID)));
    } finally {
        cleanup(t);
    }
});
