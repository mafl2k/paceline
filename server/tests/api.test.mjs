// Run with: node --test server/tests/api.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {setRiderCode, clearRiderCode, uploadSheet, removeRider, backTo} from '../club.mjs';
import {riderCodeHash} from '../ids.mjs';
import {CODE_HEADER, MAX_CODES, CODE_FAILS_MAX, readCodes, sheetEtag} from '../api.mjs';
import fs from 'node:fs';
import {importFiles, findMe, normalizePlan, parseTextExport} from '../../pages/src/engine/plan.mjs';
import {club, sheet, planJson, startServer, T, CODE_SECRET, changes} from './helpers.mjs';
import {makeClub, serve, intake, storeOk, storedClub, DATE as M_DATE} from './manage-helpers.mjs';

const KF = 'k7f3q9x2m4';
const SP = 'p2m8c4t1v9';
const DATE = '2026-11-19';
const S1930 = T('2026-11-19T18:30:00Z');
const MOD = '0.3.0-beta.1';
const CODE = '7Q4MZ2KX9B';
const BEN = ['1001', '1002', '1003'];
const GATE_KEYS = ['body', 'circle', 'date', 'label', 'opensAt', 'role', 'sheet', 'sig', 'slug', 'startAt', 'team', 'uploadedAt'];
const BODY_KEYS = ['body', 'circle', 'date', 'etag', 'eventId', 'json', 'label', 'opensAt', 'role', 'sheet', 'sig', 'slug',
    'startAt', 'team', 'text', 'uploadedAt'];

const team = (name, start, live = null) => ({name, start, live, version: 1, undo: null, changedAt: null});


// Kettenfett RC: Rollers 19:30 Berlin (S 18:30Z), its live sheet lists Ben, Cleo and Dan.
function kettenfett({start = '19:30', pinnedEventId = null, riders = BEN} = {}) {
    return club({
        teams: {rollers: team('Rollers', start, 'ra0001')},
        sheets: {ra0001: sheet({team: 'rollers', label: 'Rollers fast', date: DATE, riders, uploadedAt: '2026-11-19T16:00:00.000Z', pinnedEventId})},
    });
}


// Spokesmen CC (older than Kettenfett RC): Spokes 19:30, its live sheet lists Ben, Eva and Finn.
function spokesmen() {
    return club({
        id: SP, name: 'Spokesmen CC', createdAt: '2026-10-01T10:00:00.000Z',
        teams: {spokes: team('Spokes', '19:30', 'pa0001')},
        sheets: {pa0001: sheet({team: 'spokes', label: 'Spokes', date: DATE, riders: ['1001', '1004', '1005'], uploadedAt: '2026-11-19T15:00:00.000Z'})},
    });
}


// A server on a mutable clock (default 18:15Z, inside the gate of every 19:30 and 19:40 sheet).
async function setup(t, {env = {}, now = '2026-11-19T18:15Z', clubs = []} = {}) {
    const clock = {now: T(now)};
    const s = await startServer({env: {CODE_SECRET, ...env}, clock});
    t.after(() => s.stop());
    for (const c of clubs) {
        s.store.create(c);
    }
    const q = (id, params, headers = {}) =>
        fetch(s.base + '/api/v3/rider/' + id + '?' + new URLSearchParams(params), {headers});
    const get = async (id, params, headers) => {
        const r = await q(id, params, headers);
        assert.equal(r.status, 200, await r.clone().text());
        return r.json();
    };
    return {...s, clock, q, get};
}

const inEvent = (extra = {}) => ({mod: MOD, start: String(S1930), event: '4567890', ...extra});


test('readCodes: at most 10, malformed and duplicates dropped, lenient on separators', () => {
    assert.equal(CODE_HEADER, 'x-paceline-codes');
    assert.equal(MAX_CODES, 10);
    assert.equal(CODE_FAILS_MAX, 20);
    assert.deepEqual(readCodes(undefined), []);
    assert.deepEqual(readCodes(''), []);
    assert.deepEqual(readCodes('7q4mz-2kx9b'), [CODE]);
    assert.deepEqual(readCodes('7q4mz-2kx9b, 7Q4MZ2KX9B,bad, ,7q4mz 2kx9c'), [CODE, '7Q4MZ2KX9C']);
    // NBSP, tab, en and em dash count as nothing, like spaces and hyphens
    assert.deepEqual(readCodes('7Q4MZ 2KX9B,\t7Q4MZ–2KX9C ,7Q4MZ—2KX9D'), [CODE, '7Q4MZ2KX9C', '7Q4MZ2KX9D']);
    // only the first 10 entries are read, malformed ones included
    const eleven = [...Array(10).fill('nope'), CODE].join(',');
    assert.deepEqual(readCodes(eleven), []);
    assert.deepEqual(readCodes(['7q4mz-2kx9b']), []);
});


test('v3: parameters', async t => {
    const s = await setup(t, {clubs: [kettenfett()]});
    const bad = [
        ['abc', {mod: MOD}],
        ['1234567890123', {mod: MOD}],
        ['1001', {}],
        ['1001', {mod: '0.3'}],
        ['1001', {mod: MOD, start: String(S1930)}],
        ['1001', {mod: MOD, event: '4567890'}],
        ['1001', {mod: MOD, start: 'x', event: '4567890'}],
        ['1001', {mod: MOD, start: String(s.clock.now + 25 * 3600000), event: '4567890'}],
        ['1001', {mod: MOD, start: String(S1930), event: '2147483648'}],
    ];
    for (const [id, params] of bad) {
        const r = await s.q(id, params);
        const what = `${id} ${JSON.stringify(params)}`;
        assert.equal(r.status, 400, what);
        assert.equal(await r.text(), '{"error":"bad request"}', what);
        assert.equal(r.headers.get('access-control-allow-origin'), '*', what);
    }

    // 12 joined ids, 2 malformed: the 10 valid ones count, Kettenfett RC is the 10th
    const unknown = Array.from({length: 9}, (_, i) => 'a00000000' + i);
    const joined = ['bad!', ...unknown, '__proto__', KF];
    assert.equal(joined.length, 12);
    let out = await s.get('1009', {mod: MOD, joined: joined.join(',')});
    assert.deepEqual(out.circles, [{id: KF, name: 'Kettenfett RC', lists: false}]);
    // an 11th valid id is not read
    out = await s.get('1009', {mod: MOD, joined: [...unknown, 'a000000009', KF].join(',')});
    assert.deepEqual(out.circles, []);

    out = await s.get('1001', {mod: MOD, joined: KF, sig: 'bad!'});
    assert.equal(out.plans.length, 1);
    assert.equal(s.store.seenOf(KF)['1001'].sig, null);
});


test('v3: headers and shape', async t => {
    const s = await setup(t, {clubs: [kettenfett()]});
    const r = await s.q('1001', {mod: MOD, joined: KF});
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(await r.json()), ['circles', 'plans', 'hint', 'notice']);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.equal(r.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(r.headers.get('etag'), null);

    const pre = await fetch(s.base + '/api/v3/rider/1001', {method: 'OPTIONS'});
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-headers').toLowerCase(), 'x-paceline-codes');
    assert.equal(pre.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
    assert.equal(pre.headers.get('access-control-allow-origin'), '*');

    for (const p of ['/api/v3/nope', '/api/v3/rider/1001/x', '/api/v3/rider/']) {
        const nope = await fetch(s.base + p);
        assert.equal(nope.status, 404, p);
        assert.equal(await nope.text(), '{"error":"not found"}', p);
        assert.equal(nope.headers.get('access-control-allow-origin'), '*', p);
    }
    const post = await fetch(s.base + '/api/v3/rider/1001?mod=' + MOD, {method: 'POST'});
    assert.equal(post.status, 404);
});


test('v3: circles', async t => {
    const masters = club({
        id: 'h6r3w8n5d2', name: 'Kettenfett Masters', createdAt: '2026-11-10T10:00:00.000Z',
        teams: {masters: team('Masters', '19:30', 'ma0001')},
        sheets: {ma0001: sheet({team: 'masters', label: 'Masters', date: DATE, riders: ['1001'], uploadedAt: '2026-11-19T15:00:00.000Z'})},
    });
    // its live sheet is used up (yesterday's race)
    const veterans = club({
        id: 'v3t8r4n6s1', name: 'Kettenfett Veterans', createdAt: '2026-09-01T10:00:00.000Z',
        teams: {veterans: team('Veterans', '19:30', 'va0001')},
        sheets: {va0001: sheet({team: 'veterans', label: 'Veterans', date: '2026-11-18', riders: ['1001'], uploadedAt: '2026-11-18T15:00:00.000Z'})},
    });
    const juniors = club({id: 'j5n7r2t8w3', name: 'Kettenfett Juniors', createdAt: '2026-11-05T10:00:00.000Z'});
    const dropped = club({id: 'x9v2c7m4q1', name: 'Kettenfett Dropouts', createdAt: '2026-11-02T10:00:00.000Z'});
    const pending = {
        ...club({id: 'n4p6q8r2s5', name: 'Kettenfett Hopefuls', createdAt: '2026-08-01T10:00:00.000Z'}),
        status: 'pending', confirmedAt: null,
        teams: {hopefuls: team('Hopefuls', '19:30', 'ha0001')},
        sheets: {ha0001: sheet({team: 'hopefuls', label: 'Hopefuls', date: DATE, riders: ['1001'], uploadedAt: '2026-11-19T15:00:00.000Z', plan: 'ha0001'})},
    };
    const s = await setup(t, {clubs: [kettenfett(), spokesmen(), masters, veterans, juniors, dropped, pending]});
    s.store.trash('x9v2c7m4q1');

    const out = await s.get('1001', {mod: MOD, joined: [KF, 'j5n7r2t8w3', 'x9v2c7m4q1', 'z0000000z0', 'n4p6q8r2s5'].join(',')});
    assert.deepEqual(out.circles, [
        {id: SP, name: 'Spokesmen CC', lists: true},
        {id: KF, name: 'Kettenfett RC', lists: true},
        {id: 'j5n7r2t8w3', name: 'Kettenfett Juniors', lists: false},
        {id: 'h6r3w8n5d2', name: 'Kettenfett Masters', lists: true},
        {id: 'x9v2c7m4q1', gone: true},
    ]);
    // nothing joined: only the listing clubs
    const none = await s.get('1001', {mod: MOD});
    assert.deepEqual(none.circles.map(c => c.id), [SP, KF, 'h6r3w8n5d2']);
    assert.ok(none.circles.every(c => c.lists === true));
});


test('v3: circles lists at most 10 unjoined clubs, the oldest', async t => {
    const clubs = [];
    for (let n = 10; n >= 0; n--) {
        const id = 'c00000000' + 'abcdefghjkm'[n];
        clubs.push(club({
            id, name: `Kettenfett ${n + 1}`, createdAt: new Date(T('2026-10-01T10:00:00Z') + n * 86400000).toISOString(),
            teams: {['t' + n]: team(`T${n}`, '19:30', 'ta0001')},
            sheets: {ta0001: sheet({team: 't' + n, label: `T${n}`, date: DATE, riders: ['1001'], uploadedAt: '2026-11-19T15:00:00.000Z'})},
        }));
    }
    const s = await setup(t, {clubs});
    const out = await s.get('1001', {mod: MOD});
    assert.deepEqual(out.circles.map(c => c.id), [...'abcdefghjk'].map(ch => 'c00000000' + ch));
});


// Ben (1001) rides in Rollers 19:30 and in Sprockets 19:40 (the newer upload): Task 3's scenario.
function staggered() {
    return club({
        teams: {rollers: team('Rollers', '19:30', 'ra0001'), sprockets: team('Sprockets', '19:40', 'sa0001')},
        sheets: {
            ra0001: sheet({team: 'rollers', label: 'Rollers fast', date: DATE, riders: ['1001', '1002', '1003'], uploadedAt: '2026-11-19T16:00:00.000Z'}),
            sa0001: sheet({team: 'sprockets', label: 'Sprockets fast', date: DATE, riders: ['1001', '1004', '1005'], uploadedAt: '2026-11-19T16:30:00.000Z'}),
        },
    });
}


test('v3: one plan per joined club, in and outside an event', async t => {
    const s = await setup(t, {clubs: [staggered()]});
    const stored = s.store.get(KF).sheets.sa0001;
    const common = {
        circle: {id: KF, name: 'Kettenfett RC'}, team: 'Sprockets', slug: 'sprockets', sheet: 'sa0001',
        label: 'Sprockets fast', role: 'rider', date: '2026-11-19',
        startAt: '2026-11-19T18:40:00.000Z', opensAt: '2026-11-19T18:10:00.000Z',
        uploadedAt: stored.uploadedAt, sig: stored.sig,
    };

    const outside = await s.get('1001', {mod: MOD, joined: KF});
    assert.equal(outside.plans.length, 1);
    assert.deepEqual(Object.keys(outside.plans[0]).sort(), GATE_KEYS);
    assert.deepEqual(outside.plans[0], {...common, body: false});

    const ev = await s.get('1001', {mod: MOD, joined: KF, start: String(T('2026-11-19T18:31Z')), event: '4567890'});
    assert.equal(ev.plans.length, 1);
    const p = ev.plans[0];
    assert.deepEqual(Object.keys(p).sort(), BODY_KEYS);
    for (const [k, v] of Object.entries(common)) {
        assert.deepEqual(p[k], v, k);
    }
    assert.equal(p.body, true);
    assert.equal(p.eventId, 4567890);
    assert.match(p.etag, /^"[0-9A-HJKMNP-TV-Z]{6}-[0-9a-f]{8}"$/);
    assert.equal(p.etag, sheetEtag(KF, 'sprockets', 'sa0001', stored));
    assert.equal(p.json.riders['1001'].weight, 70);
    assert.doesNotMatch(JSON.stringify(p.json), /"(ftp|height)"/);
    assert.deepEqual(p.text, stored.text);
});


test('v3: the 06:00 case serves and hints nothing', async t => {
    const s = await setup(t, {now: '2026-11-19T05:00Z', clubs: [kettenfett({start: '19:00'})]});
    const params = {mod: MOD, start: String(T('2026-11-19T05:00Z')), event: '7777777'};
    const joined = await s.get('1001', {...params, joined: KF});
    assert.deepEqual(joined.plans, []);
    assert.deepEqual(joined.hint, []);
    const unjoined = await s.get('1001', params);
    assert.deepEqual(unjoined.hint, []);
    assert.equal(s.store.seenOf(KF)['1001'].inEvent, false);
    assert.equal(s.store.get(KF).sheets.ra0001.eventId, null);
});


test('v3: hint only with start', async t => {
    const s = await setup(t, {clubs: [kettenfett(), spokesmen()]});
    const out = await s.get('1001', inEvent({joined: KF}));
    assert.deepEqual(out.hint, [{
        id: SP, name: 'Spokesmen CC', riders: ['1001', '1004', '1005'], uploadedAt: '2026-11-19T15:00:00.000Z', body: true,
    }]);
    assert.equal(out.plans.length, 1);
    assert.equal(out.plans[0].circle.id, KF);
    const outside = await s.get('1001', {mod: MOD, joined: KF});
    assert.deepEqual(outside.hint, []);
    // a joined club is no hint, and nothing was learned for an unjoined club
    const both = await s.get('1001', inEvent({joined: [KF, SP].join(',')}));
    assert.deepEqual(both.hint, []);
    assert.equal(both.plans.length, 2);
});


test('v3: notice', async t => {
    const s = await setup(t, {env: {MOD_MIN_VERSION: '0.3.0'}});
    assert.equal((await s.get('1001', {mod: '0.3.0-beta.2'})).notice, 'Please update Paceline to 0.3.0 or newer.');
    assert.equal((await s.get('1001', {mod: '0.3.0'})).notice, null);
    const plain = await setup(t);
    assert.equal((await plain.get('1001', {mod: '0.2.9'})).notice, null);
});


test('v3: seen and the learned event id', async t => {
    const s = await setup(t, {clubs: [kettenfett()]});
    const out = await s.get('1001', inEvent({joined: KF, sig: 'RE5CFQ'}));
    assert.equal(out.plans[0].body, true);
    assert.equal(out.plans[0].eventId, 4567890);
    const {at, ...entry} = s.store.seenOf(KF)['1001'];
    assert.deepEqual(entry, {sig: 'RE5CFQ', mod: MOD, sheet: 'ra0001', inEvent: true, event: 4567890});
    assert.equal(at, new Date(s.clock.now).toISOString());
    let stored = s.store.get(KF).sheets.ra0001;
    assert.equal(stored.eventId, 4567890);
    assert.equal(stored.boundAt, new Date(s.clock.now).toISOString());

    // another id inside the window still gets the plan, and the learned id stays
    const other = await s.get('1002', inEvent({joined: KF, event: '4567891'}));
    assert.equal(other.plans[0].body, true);
    assert.equal(other.plans[0].eventId, 4567890);
    stored = s.store.get(KF).sheets.ra0001;
    assert.equal(stored.eventId, 4567890);
    assert.equal(s.store.seenOf(KF)['1002'].event, 4567891);

    // outside events
    await s.get('1003', {mod: MOD, joined: KF});
    const plain = s.store.seenOf(KF)['1003'];
    assert.equal(plain.inEvent, false);
    assert.equal(plain.event, null);
    assert.equal(plain.sheet, 'ra0001');
    assert.equal(plain.sig, null);
});


test('v3: a pinned sheet learns nothing', async t => {
    const s = await setup(t, {clubs: [kettenfett({pinnedEventId: 4567890})]});
    const out = await s.get('1001', inEvent({joined: KF}));
    assert.equal(out.plans[0].body, true);
    assert.equal(out.plans[0].eventId, 4567890);
    assert.equal(s.store.get(KF).sheets.ra0001.eventId, null);
    assert.equal(s.store.get(KF).sheets.ra0001.boundAt, null);
    // a version stored without a link carries the plan's; a typeless plan of team Rollers reads
    // 'Rollers'
    s.store.change(KF, c => uploadSheet(c, {
        slug: 'rollers', json: planJson('Rollers fast', [...BEN, '1004']), text: null, as: 'ra0001', live: true,
        base: c.teams.rollers.version, pinnedEventId: null, via: 'file',
    }, {now: s.clock.now, newId: () => 'rb0002'}));
    assert.equal(s.store.get(KF).sheets.rb0002.pinnedEventId, 4567890);
    const after = await s.get('1001', inEvent({joined: KF}));
    assert.equal(after.plans[0].sheet, 'rb0002');
    assert.equal(after.plans[0].label, 'Rollers');
    assert.equal(after.plans[0].eventId, 4567890);
    assert.equal(after.plans[0].body, true);
});


test('v3: a new version changes sheet and etag, and the record keeps exactly its fields', async t => {
    const s = await setup(t, {clubs: [kettenfett()]});
    const read = async () => ({inside: (await s.get('1001', inEvent({joined: KF}))).plans[0], outside: (await s.get('1001', {mod: MOD, joined: KF})).plans[0]});
    const before = await read();
    assert.deepEqual(Object.keys(before.inside).sort(), BODY_KEYS);
    assert.deepEqual(Object.keys(before.outside).sort(), GATE_KEYS);
    assert.equal(before.inside.sheet, 'ra0001');
    s.store.change(KF, c => uploadSheet(c, {
        slug: 'rollers', json: planJson('Rollers fast', [...BEN, '1004']), text: null, as: 'ra0001', type: 'fast', live: true,
        base: c.teams.rollers.version, pinnedEventId: null, via: 'file',
    }, {now: s.clock.now, newId: () => 'rb0002'}));
    const after = await read();
    assert.deepEqual(Object.keys(after.inside).sort(), BODY_KEYS);
    assert.deepEqual(Object.keys(after.outside).sort(), GATE_KEYS);
    assert.equal(after.inside.sheet, 'rb0002');
    assert.equal(after.outside.sheet, 'rb0002');
    assert.notEqual(after.inside.etag, before.inside.etag);
    const stored = s.store.get(KF).sheets.rb0002;
    assert.equal(after.inside.etag, sheetEtag(KF, 'rollers', 'rb0002', stored));
    assert.equal(after.inside.label, 'Rollers · fast');
    assert.equal(after.outside.label, 'Rollers · fast');
    assert.equal(after.inside.sig, stored.sig);
    assert.deepEqual(Object.keys(after.inside.json.riders), [...BEN, '1004']);
});


test('v3: Back to vN serves vN\'s sig and upload time', async t => {
    const s = await setup(t, {clubs: [kettenfett()]});
    const v1 = structuredClone(s.store.get(KF).sheets.ra0001);
    s.store.change(KF, c => uploadSheet(c, {
        slug: 'rollers', json: planJson('Rollers fast', [...BEN, '1004']), text: null, as: 'ra0001', live: true,
        base: c.teams.rollers.version, pinnedEventId: null, via: 'file',
    }, {now: s.clock.now, newId: () => 'rb0002'}));
    const mid = (await s.get('1001', inEvent({joined: KF}))).plans[0];
    assert.equal(mid.sheet, 'rb0002');
    assert.notEqual(mid.sig, v1.sig);
    s.store.change(KF, c => backTo(c, 'rollers', {plan: 'ra0001', n: 1, version: c.teams.rollers.version}, {now: s.clock.now, newId: () => 'rc0003'}));
    const after = (await s.get('1001', inEvent({joined: KF}))).plans[0];
    assert.deepEqual(Object.keys(after).sort(), BODY_KEYS);
    assert.equal(after.sheet, 'rc0003');
    assert.equal(after.sig, v1.sig);
    assert.equal(after.uploadedAt, v1.uploadedAt, 'O4: the upload time of v1');
    assert.equal(after.uploadedAt, '2026-11-19T16:00:00.000Z');
    assert.deepEqual(Object.keys(after.json.riders), BEN);
    assert.notEqual(after.etag, mid.etag);
    const outside = (await s.get('1001', {mod: MOD, joined: KF})).plans[0];
    assert.deepEqual(Object.keys(outside).sort(), GATE_KEYS);
    assert.equal(outside.sheet, 'rc0003');
    assert.equal(outside.sig, v1.sig);
});


test('v3: after a rider removal the served sig and etag follow the content', async t => {
    const s = await setup(t, {clubs: [kettenfett()]});
    const before = (await s.get('1001', inEvent({joined: KF}))).plans[0];
    assert.ok(Object.hasOwn(before.json.riders, '1002'));
    s.store.change(KF, c => removeRider(c, '1002', s.clock.now));
    const after = (await s.get('1001', inEvent({joined: KF}))).plans[0];
    assert.equal(after.sheet, 'ra0001');
    assert.notEqual(after.sig, before.sig);
    assert.notEqual(after.etag, before.etag);
    assert.equal(Object.hasOwn(after.json.riders, '1002'), false);
    assert.equal(s.store.get(KF).sheets.ra0001.recSig, before.sig);
});


test('v3: etag ignores uploadedAt', () => {
    const c = kettenfett();
    const s = c.sheets.ra0001;
    const etag = sheetEtag(KF, 'rollers', 'ra0001', s);
    assert.match(etag, /^"[0-9A-HJKMNP-TV-Z]{6}-[0-9a-f]{8}"$/);
    assert.ok(etag.startsWith(`"${s.sig}-`));
    assert.equal(sheetEtag(KF, 'rollers', 'ra0001', {...s, uploadedAt: '2026-11-19T17:00:00.000Z'}), etag);
    assert.notEqual(sheetEtag(KF, 'rollers', 'ra0001', {...s, label: 'Rollers slow'}), etag);
    assert.notEqual(sheetEtag(SP, 'rollers', 'ra0001', s), etag);
    assert.notEqual(sheetEtag(KF, 'rollers-2', 'ra0001', s), etag);
    assert.notEqual(sheetEtag(KF, 'rollers', 'ra0002', s), etag);
});


test('v3: hostile ids', async t => {
    const s = await setup(t, {clubs: [kettenfett()]});
    for (const id of ['__proto__', 'constructor', '%5F%5Fproto%5F%5F']) {
        const r = await s.q(id, {mod: '0.3.0'});
        assert.equal(r.status, 400, id);
    }
    const out = await s.get('1009', {mod: '0.3.0', joined: '__proto__,constructor,K7F3Q9X2M4'});
    assert.deepEqual(out.circles, []);
    assert.deepEqual(out.plans, []);
});


test('v3: the gate opens 30 min before S on the server\'s clock', async t => {
    const s = await setup(t, {now: '2026-11-19T17:59Z', clubs: [kettenfett(), spokesmen()]});
    const stored = s.store.get(KF).sheets.ra0001;

    let out = await s.get('1001', inEvent({joined: KF}));
    assert.equal(out.plans.length, 1);
    let p = out.plans[0];
    assert.deepEqual(Object.keys(p).sort(), GATE_KEYS);
    assert.equal(p.body, false);
    assert.equal(p.opensAt, '2026-11-19T18:00:00.000Z');
    assert.equal(p.startAt, '2026-11-19T18:30:00.000Z');
    assert.equal(p.sig, stored.sig);
    assert.deepEqual(out.hint, [{id: SP, name: 'Spokesmen CC', riders: [], uploadedAt: '2026-11-19T15:00:00.000Z', body: false}]);
    assert.equal(s.store.get(KF).sheets.ra0001.eventId, null);
    assert.equal(s.store.seenOf(KF)['1001'].inEvent, false);
    assert.equal(s.store.seenOf(KF)['1001'].event, null);
    assert.equal(s.store.seenOf(KF)['1001'].sheet, 'ra0001');

    s.clock.now = T('2026-11-19T18:00Z');
    out = await s.get('1001', inEvent({joined: KF}));
    p = out.plans[0];
    assert.equal(p.body, true);
    assert.deepEqual(Object.keys(p).sort(), BODY_KEYS);
    assert.deepEqual(p.json, stored.json);
    assert.deepEqual(p.text, stored.text);
    assert.equal(p.etag, sheetEtag(KF, 'rollers', 'ra0001', stored));
    assert.equal(p.eventId, 4567890);
    assert.deepEqual(out.hint, [{id: SP, name: 'Spokesmen CC', riders: ['1001', '1004', '1005'], uploadedAt: '2026-11-19T15:00:00.000Z', body: true}]);
    assert.equal(s.store.get(KF).sheets.ra0001.eventId, 4567890);
    assert.equal(s.store.get(SP).sheets.pa0001.eventId, null, 'an unjoined club learns nothing');
    assert.equal(s.store.seenOf(KF)['1001'].inEvent, true);
    assert.equal(s.store.seenOf(KF)['1001'].event, 4567890);
    assert.deepEqual(s.store.seenOf(SP), {}, 'an unjoined club gets no seen entry');

    s.clock.now = T('2026-11-19T18:25Z');
    out = await s.get('1001', {mod: MOD, joined: KF});
    assert.deepEqual(Object.keys(out.plans[0]).sort(), GATE_KEYS);
    assert.equal(out.plans[0].body, false);
});


test('v3: a spoofed early start moves nothing', async t => {
    const s = await setup(t, {now: '2026-11-18T22:30Z', clubs: [kettenfett(), spokesmen()]});
    const out = await s.get('1001', inEvent({joined: KF}));
    assert.equal(out.plans.length, 1);
    assert.deepEqual(Object.keys(out.plans[0]).sort(), GATE_KEYS);
    assert.equal(out.plans[0].body, false);
    assert.deepEqual(out.hint.map(h => [h.id, h.riders, h.body]), [[SP, [], false]]);
    assert.equal(s.store.get(KF).sheets.ra0001.eventId, null);
    assert.equal(s.store.seenOf(KF)['1001'].inEvent, false);
    assert.equal(s.store.seenOf(KF)['1001'].event, null);
});


test('v3: the pin mismatch is still recorded', async t => {
    const s = await setup(t, {now: '2026-11-19T18:20Z', clubs: [kettenfett({pinnedEventId: 4567890})]});
    const out = await s.get('1001', inEvent({joined: KF, event: '4567891'}));
    assert.deepEqual(out.plans, []);
    const seen = s.store.seenOf(KF)['1001'];
    assert.equal(seen.inEvent, true);
    assert.equal(seen.event, 4567891);
    assert.equal(seen.sheet, 'ra0001');
    // before its gate the mismatch is an ordinary check
    s.clock.now = T('2026-11-19T17:59Z');
    await s.get('1001', inEvent({joined: KF, event: '4567891'}));
    assert.equal(s.store.seenOf(KF)['1001'].inEvent, false);
    assert.equal(s.store.seenOf(KF)['1001'].event, null);
});


test('v3: seen only for listed riders', async t => {
    const s = await setup(t, {clubs: [kettenfett()]});
    const out = await s.get('1009', inEvent({joined: KF}));
    assert.deepEqual(out.plans, []);
    assert.equal(s.store.seenOf(KF)['1009'], undefined);
});


test('the rider check writes nothing to paceline.db', async t => {
    const s = await setup(t, {clubs: [kettenfett()]});
    const n = changes(s.server.db);
    const r = await fetch(`${s.base}/api/v3/rider/1001?mod=0.3.0&joined=${KF}`);
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal((await r.json()).plans[0].sheet, 'ra0001');
    assert.ok(Object.hasOwn(s.store.seenOf(KF), '1001'));
    assert.equal(changes(s.server.db), n);
    // only learning an event writes: one club row, once per sheet and event
    await s.get('1002', inEvent({joined: KF}));
    assert.equal(changes(s.server.db) - n, 1);
    await s.get('1003', inEvent({joined: KF}));
    assert.equal(changes(s.server.db) - n, 1);
});


// Captures console output for the rest of the test.
function captureConsole(t) {
    const lines = [];
    const saved = {};
    for (const k of ['log', 'info', 'warn', 'error', 'debug']) {
        saved[k] = console[k];
        console[k] = (...args) => lines.push(args.map(String).join(' '));
    }
    t.after(() => Object.assign(console, saved));
    return lines;
}


test('v3: a private club needs its code', async t => {
    const lines = captureConsole(t);
    const s = await setup(t, {clubs: [kettenfett(), spokesmen()]});
    s.store.change(SP, c => setRiderCode(c, riderCodeHash(CODE, CODE_SECRET), s.clock.now));
    const codes = v => ({[CODE_HEADER]: v});

    // no header: nothing of it
    let r = await s.q('1001', inEvent({joined: KF}));
    let text = await r.text();
    assert.equal(r.status, 200);
    assert.doesNotMatch(text, /p2m8c4t1v9|Spokesmen/);
    assert.equal(JSON.parse(text).plans.length, 1);

    // no header, joined: only that a code is needed
    let out = await s.get('1001', inEvent({joined: [KF, SP].join(',')}));
    assert.deepEqual(out.circles.filter(c => c.id === SP), [{id: SP, code: 'needed'}]);
    assert.doesNotMatch(JSON.stringify(out.plans) + JSON.stringify(out.hint), /p2m8c4t1v9|Spokesmen/);
    assert.deepEqual(s.store.seenOf(SP), {});
    assert.equal(s.store.get(SP).sheets.pa0001.eventId, null);

    // the code, not joined: listed with the code as read, and hinted
    out = await s.get('1001', inEvent({joined: KF}), codes('7q4mz-2kx9b'));
    assert.deepEqual(out.circles.filter(c => c.id === SP), [{id: SP, name: 'Spokesmen CC', lists: true, private: true, code: CODE}]);
    assert.deepEqual(out.hint, [{id: SP, name: 'Spokesmen CC', riders: ['1001', '1004', '1005'], uploadedAt: '2026-11-19T15:00:00.000Z', body: true}]);
    assert.deepEqual(s.store.seenOf(SP), {});

    // the code and joined: its plan, and seen
    out = await s.get('1001', inEvent({joined: [KF, SP].join(',')}), codes('7q4mz-2kx9b'));
    const rec = out.plans.find(p => p.circle.id === SP);
    assert.equal(rec.body, true);
    assert.equal(rec.circle.name, 'Spokesmen CC');
    assert.deepEqual(out.hint, []);
    assert.equal(s.store.seenOf(SP)['1001'].inEvent, true);
    assert.equal(s.store.get(SP).sheets.pa0001.eventId, 4567890);

    // a new code ends the old one at once
    s.store.change(SP, c => setRiderCode(c, riderCodeHash('9V6PW3TQ2H', CODE_SECRET), s.clock.now));
    r = await s.q('1001', inEvent({joined: [KF, SP].join(',')}), codes('7q4mz-2kx9b'));
    text = await r.text();
    assert.doesNotMatch(text, new RegExp(CODE));
    out = JSON.parse(text);
    assert.deepEqual(out.circles.filter(c => c.id === SP), [{id: SP, code: 'needed'}]);
    assert.equal(out.plans.filter(p => p.circle.id === SP).length, 0);
    out = await s.get('1001', inEvent({joined: KF}), codes('9v6pw-3tq2h'));
    assert.deepEqual(out.circles.filter(c => c.id === SP), [{id: SP, name: 'Spokesmen CC', lists: true, private: true, code: '9V6PW3TQ2H'}]);

    // only the first 10 codes are read
    const wrong = Array.from({length: 10}, (_, i) => '7Q4MZ2KX' + 'ABCDEFGHJK'[i] + 'A');
    r = await s.q('1001', {mod: MOD}, codes([...wrong, '9V6PW3TQ2H'].join(',')));
    text = await r.text();
    assert.equal(r.status, 200);
    assert.doesNotMatch(text, /9V6PW3TQ2H|p2m8c4t1v9/);

    // made open again: listed by Zwift ID alone
    s.store.change(SP, c => clearRiderCode(c, s.clock.now));
    out = await s.get('1001', {mod: MOD});
    assert.deepEqual(out.circles.filter(c => c.id === SP), [{id: SP, name: 'Spokesmen CC', lists: true}]);

    assert.ok(!lines.some(l => /7Q4MZ2KX9B|9V6PW3TQ2H/i.test(l)), lines.join('\n'));
});


test('v3: without CODE_SECRET private clubs are off', async t => {
    const s = await setup(t, {env: {CODE_SECRET: ''}, clubs: [kettenfett(), spokesmen()]});
    // the club carries a code that was hashed under some secret; this server has none
    s.store.change(SP, c => setRiderCode(c, riderCodeHash(CODE, CODE_SECRET), s.clock.now));
    const codes = v => ({[CODE_HEADER]: v, 'x-forwarded-for': '203.0.113.9'});

    // the right code reveals nothing: hidden as without a code
    let r = await s.q('1001', inEvent({joined: KF}), codes(CODE));
    let text = await r.text();
    assert.equal(r.status, 200);
    assert.doesNotMatch(text, /p2m8c4t1v9|Spokesmen/);
    assert.deepEqual(s.store.seenOf(SP), {});
    // joined: only that a code is needed, as before
    let out = await s.get('1001', inEvent({joined: [KF, SP].join(',')}), codes(CODE));
    assert.deepEqual(out.circles.filter(c => c.id === SP), [{id: SP, code: 'needed'}]);
    assert.equal(out.plans.filter(p => p.circle.id === SP).length, 0);
    assert.deepEqual(s.store.seenOf(SP), {});

    // wrong codes do not count: far beyond the limit of 20, still no 429
    for (let i = 0; i < 25; i++) {
        r = await s.q('1001', {mod: MOD}, codes('8' + String(i).padStart(9, '0')));
        assert.equal(r.status, 200, `check ${i + 1}`);
    }
    r = await s.q('1001', {mod: MOD}, codes(CODE));
    assert.equal(r.status, 200);
});


test('v3: wrong codes are throttled per public address', async t => {
    const s = await setup(t, {clubs: [kettenfett(), spokesmen()]});
    s.store.change(SP, c => setRiderCode(c, riderCodeHash(CODE, CODE_SECRET), s.clock.now));
    const from = (ip, code) => ({'x-forwarded-for': ip, ...(code ? {[CODE_HEADER]: code} : {})});
    const wrong = i => '8' + String(i).padStart(9, '0');

    for (let i = 0; i < 20; i++) {
        const r = await s.q('1001', {mod: MOD}, from('203.0.113.7', wrong(i)));
        assert.equal(r.status, 200, `check ${i + 1}`);
    }
    let r = await s.q('1001', {mod: MOD}, from('203.0.113.7', wrong(20)));
    assert.equal(r.status, 429);
    assert.equal(await r.text(), '{"error":"busy"}');
    assert.equal(r.headers.get('retry-after'), '3600');
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    r = await s.q('1001', {mod: MOD}, from('203.0.113.7', CODE));
    assert.equal(r.status, 429, 'the right code too');
    r = await s.q('1001', {mod: MOD}, from('203.0.113.7'));
    assert.equal(r.status, 200, 'no codes, no throttle');
    // malformed codes are no codes
    r = await s.q('1001', {mod: MOD}, from('203.0.113.7', 'nope'));
    assert.equal(r.status, 200);

    let out = await s.get('1001', {mod: MOD}, from('198.51.100.4', CODE));
    assert.deepEqual(out.circles.filter(c => c.id === SP), [{id: SP, name: 'Spokesmen CC', lists: true, private: true, code: CODE}]);

    for (let i = 0; i < 25; i++) {
        r = await s.q('1001', {mod: MOD}, from('10.0.0.7', wrong(i)));
        assert.equal(r.status, 200, `private address, check ${i + 1}`);
    }
    // loopback (no header at all: the socket address)
    for (let i = 0; i < 25; i++) {
        r = await s.q('1001', {mod: MOD}, {[CODE_HEADER]: wrong(i)});
        assert.equal(r.status, 200, `loopback, check ${i + 1}`);
    }

    s.clock.now += 3600000;
    out = await s.get('1001', {mod: MOD}, from('203.0.113.7', CODE));
    assert.equal(out.circles.filter(c => c.id === SP).length, 1);
});


test('v3: only a rider listing binds the event id, a bench listing does not', async t => {
    const bench = club({
        teams: {rollers: team('Rollers', '19:30', 'ra0001')},
        sheets: {ra0001: sheet({team: 'rollers', label: 'Rollers fast', date: DATE, riders: BEN, bench: ['1009'], uploadedAt: '2026-11-19T16:00:00.000Z'})},
    });
    const s = await setup(t, {clubs: [bench]});
    const out = await s.get('1009', inEvent({joined: KF}));
    assert.equal(out.plans[0].role, 'bench');
    assert.equal(out.plans[0].body, true);
    assert.equal(out.plans[0].eventId, null);
    assert.equal(s.store.get(KF).sheets.ra0001.eventId, null);
    assert.equal(s.store.get(KF).sheets.ra0001.boundAt, null);
    // a rider on the same sheet still binds it
    const rider = await s.get('1001', inEvent({joined: KF}));
    assert.equal(rider.plans[0].eventId, 4567890);
    assert.equal(s.store.get(KF).sheets.ra0001.eventId, 4567890);
});


// ---- old endpoints (0.2.x), spec §6.3: hard cut, the notice only ----

const plan = (s, p, headers) => fetch(s.base + '/api/plan/' + p, {headers});


test('notice: every /api/plan/ path gets the fixed record, a live team and a listed rider too', async t => {
    const s = await setup(t, {env: {PUBLIC_URL: 'https://ttt-beta.example.org'}, clubs: [kettenfett(), spokesmen()]});
    const a = await plan(s, 'anything');
    const b = await plan(s, 'by-athlete/1001');
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const rec = await a.json();
    assert.deepEqual(await b.json(), rec);
    assert.equal(a.headers.get('etag'), b.headers.get('etag'));
    assert.equal(rec.etag, a.headers.get('etag'));
    assert.equal(rec.notice, true);
    assert.equal(rec.team, 'Update Paceline');
    assert.equal(rec.slug, 'update-paceline');
    assert.equal(rec.text, null);
    assert.equal(rec.uploadedAt, '2026-11-15T00:00:00.000Z');
    assert.deepEqual(rec.json, {
        team: {name: 'Update Paceline'},
        riders: {0: {name: 'Update Paceline from ttt-beta.example.org', order: 1, pull_duration: 60, color: '#ffffff'}},
    });
    assert.equal(a.headers.get('cache-control'), 'no-cache');
    assert.equal(a.headers.get('access-control-allow-origin'), '*');
    assert.equal(a.headers.get('access-control-expose-headers'), 'ETag');
    assert.equal(a.headers.get('content-type'), 'application/json; charset=utf-8');

    const {plan: imported} = importFiles([JSON.stringify(rec.json)]);
    assert.equal(imported.team, 'Update Paceline');
    assert.equal(imported.sig, rec.sig);
    assert.equal(findMe(imported, '1001').role, 'none');

    // Rollers has a live plan in its gate and Ben (1001) is on it: still the notice, never the sheet
    for (const p of ['rollers', 'Rollers', 'spokes', 'by-athlete/1002', 'by-athlete/1004', 'by-athlete/abc', 'x/y/z']) {
        const r = await plan(s, p);
        assert.equal(r.status, 200, p);
        assert.deepEqual(await r.json(), rec, p);
    }
    const same = await plan(s, 'anything', {'If-None-Match': rec.etag});
    assert.equal(same.status, 304);
    assert.equal(same.headers.get('etag'), rec.etag);
    assert.equal(same.headers.get('access-control-expose-headers'), 'ETag');
    assert.equal(await same.text(), '');
    const weak = await plan(s, 'rollers', {'If-None-Match': `"zzz", W/${rec.etag}`});
    assert.equal(weak.status, 304);
    assert.equal(weak.headers.get('etag'), rec.etag);
    assert.equal(weak.headers.get('access-control-expose-headers'), 'ETag');
    assert.equal((await plan(s, 'rollers', {'If-None-Match': '"zzz"'})).status, 200);
    // no hit is recorded: seen never gets mod 0.2
    assert.deepEqual(s.store.seenOf(KF), {});
    assert.deepEqual(s.store.seenOf(SP), {});
    // other methods as before
    const post = await fetch(s.base + '/api/plan/anything', {method: 'POST'});
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET, OPTIONS');
    assert.equal((await fetch(s.base + '/api/plan/anything', {method: 'OPTIONS'})).status, 204);
});


test('notice: a leftover OLD_API or OLD_API_CIRCLE is ignored, and nothing is logged about it', async t => {
    // startServer mutes console.log (the start line, checked in http.test.mjs); a warning or error
    // about the variable would show here (compat warned about an OLD_API_CIRCLE that was no club)
    const lines = [];
    const {warn, error} = console;
    console.warn = (...a) => lines.push(a.join(' '));
    console.error = (...a) => lines.push(a.join(' '));
    let servers;
    try {
        servers = [];
        for (const env of [{OLD_API: 'compat', OLD_API_CIRCLE: KF}, {OLD_API: 'off', OLD_API_CIRCLE: 'not-a-club'},
            {OLD_API_CIRCLE: SP}]) {
            servers.push(await setup(t, {env, clubs: [kettenfett()]}));
        }
    } finally {
        console.warn = warn;
        console.error = error;
    }
    const want = await (await plan(servers[0], 'anything')).json();
    assert.equal(want.notice, true);
    for (const s of servers) {
        for (const p of ['rollers', 'by-athlete/1001']) {
            const r = await plan(s, p);
            assert.equal(r.status, 200, p);
            assert.deepEqual(await r.json(), want, p);
        }
        assert.deepEqual(s.store.seenOf(KF), {});
    }
    assert.deepEqual(lines, []);
});


test('notice without PUBLIC_URL names the plan server', async t => {
    const s = await setup(t);
    const rec = await (await plan(s, 'anything')).json();
    assert.equal(rec.json.riders['0'].name, 'Update Paceline from the plan server');
});


// Ported from main's server.test.mjs (0f88f49, the old server's stripPlanJson): a real planner
// export carries every rider's height, FTP and power profile; none of it is ever stored (sheet or
// inbox entry, on disk) or served, weight stays (the mod shows other riders' targets in W/kg), and
// the mod shows the same riders as from the original files.
const PRIVATE_KEYS = ['height', 'ftp', 'wkg300', 'power_profile', 'alt_name', 'adjustment'];

function keysDeep(v, out = new Set()) {
    if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
            out.add(k);
            keysDeep(x, out);
        }
    }
    return out;
}

// What the mod shows of each rider, and the bench.
function shownRiders(json, text) {
    const {plan} = normalizePlan(json, text);
    return {
        riders: plan.riders.map(r => ({id: r.id, name: r.name, order: r.order, pullS: r.pullS, watts: r.watts,
            color: r.color, colorName: r.colorName})),
        bench: plan.bench,
    };
}

test('a planner export: height, FTP and power profile are neither stored nor served, weight stays', async t => {
    const fixture = name => fs.readFileSync(new URL(`../../tests/fixtures/${name}`, import.meta.url), 'utf8');
    const json = fixture('rollers.json');
    const txt = fixture('rollers.txt');
    const orig = JSON.parse(json);
    for (const k of [...PRIVATE_KEYS, 'weight']) {
        assert.ok(keysDeep(orig).has(k), `the fixture carries ${k}`);
    }
    const {club: c, cookie} = makeClub();
    const srv = await serve(t, {club: c, cookie});
    // Rollers: stored and live; Sprockets: left in the inbox
    await storeOk(srv, cookie, {team: 'rollers', json, text: txt}, {date: M_DATE});
    await intake(srv, cookie, {team: 'sprockets', json, text: txt});
    const onDisk = storedClub(srv);
    const club = JSON.parse(onDisk);
    assert.equal(Object.keys(club.sheets).length, 1);
    assert.equal(club.inbox.length, 1);
    for (const k of PRIVATE_KEYS) {
        assert.ok(!keysDeep(club).has(k), `the stored club has ${k}`);
        assert.ok(!onDisk.includes(`"${k}"`), k);
    }

    const expected = shownRiders(orig, parseTextExport(txt));
    assert.equal(expected.riders.length, 6);
    // a listed rider, and a rider in the roster (the bench), checking in their race (S 18:30Z)
    for (const id of ['5100002', '510007']) {
        const r = await fetch(srv.base + '/api/v3/rider/' + id + '?' + new URLSearchParams({
            mod: MOD, joined: KF, start: String(S1930), event: '4567890'}));
        assert.equal(r.status, 200, id);
        const raw = await r.text();
        const p = JSON.parse(raw).plans[0];
        assert.equal(p.body, true, id);
        for (const k of PRIVATE_KEYS) {
            assert.ok(!raw.includes(`"${k}"`), `${id} is served ${k}`);
        }
        assert.deepEqual(Object.fromEntries(Object.entries(p.json.riders).map(([rid, x]) => [rid, x.weight])),
            Object.fromEntries(Object.entries(orig.riders).map(([rid, x]) => [rid, x.weight])), id);
        assert.deepEqual(shownRiders(p.json, p.text), expected, id);
        // the mod's own import path (strings in, as the library stores them) gives the served code
        assert.equal(importFiles([JSON.stringify(p.json)]).plan.sig, normalizePlan(p.json, null).plan.sig, id);
    }
});
