// Run with: node --test tests/planserver.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as P from '../pages/src/engine/plan.mjs';
import * as L from '../pages/src/engine/library.mjs';
import * as V from '../pages/src/engine/planserver.mjs';
import {slugify} from '../server/server.mjs';

const json = readFileSync(new URL('./fixtures/rollers.json', import.meta.url), 'utf8');
const txt = readFileSync(new URL('./fixtures/rollers.txt', import.meta.url), 'utf8');


// A record as the server stores and serves it: importFiles' parsed json and text rows.
function record(team = 'Rollers', jsonText = json, textText = txt) {
    const r = P.importFiles([jsonText, textText].filter(Boolean));
    return {team, slug: slugify(team), sig: r.plan.sig, etag: `"${r.plan.sig}-x"`, json: r.json, text: r.text,
            uploadedAt: '2026-11-11T10:00:00.000Z'};
}


test('teamSlug is the server\'s slugify', () => {
    for (const name of ['Rollers', 'TTT Rollers', '  Trück & Co. 2 ', 'A--B__c', '---', '', null, undefined,
                        'Kim S ★ [KFR]', 'ÄÖÜ team', '123']) {
        assert.equal(V.teamSlug(name), slugify(name), String(name));
    }
    assert.equal(V.teamSlug('TTT Rollers!'), 'ttt-rollers');
});

test('recordFiles: the server record re-imports to the same plan', () => {
    const files = V.recordFiles(record());
    assert.equal(typeof files.json, 'string');
    assert.match(files.text, /^RiderName\tPullWatts\tPullDurationSeconds\tKitColorName\tKitColorHex\n/);
    const a = P.importFiles([json, txt]).plan;
    const b = P.importFiles([files.json, files.text]).plan;
    assert.equal(b.sig, '5FWHC3');
    assert.deepEqual(b, a);
    // JSON only: no text file.
    const noText = V.recordFiles(record('Rollers', json, null));
    assert.equal(noText.text, null);
    assert.equal(P.importFiles([noText.json]).plan.riders[0].watts, null);
    // Raw strings pass through; no JSON is no record.
    assert.deepEqual(V.recordFiles({json, text: txt}), {json, text: txt});
    assert.equal(V.recordFiles({text: txt}), null);
    assert.equal(V.recordFiles(null), null);
});

test('pollDue: every POLL_MS, right away without a check, after a clock step back', () => {
    assert.equal(V.POLL_MS, 60000);
    assert.equal(V.pollDue(null, 1000), true);
    assert.equal(V.pollDue(1000, 60999), false);
    assert.equal(V.pollDue(1000, 61000), true);
    assert.equal(V.pollDue(5000, 1000), true);
});

// Fix round 1: the lease-thrash pattern (windows stepping about once a minute when hidden).
function simLease(stepFn, events) {
    let lease = null;
    const acts = {};
    for (const {id, t} of events.sort((a, b) => a.t - b.t)) {
        const {act, write} = stepFn(lease, id, t);
        if (write) {
            lease = write;
        }
        acts[id] = (acts[id] || 0) + (act ? 1 : 0);
    }
    return acts;
}

function every(id, off, period, n) {
    return Array.from({length: n}, (_, k) => ({id, t: off + k * period}));
}

test('pollLeaseStep: two hidden windows still poll (the recorder lease rule would not)', async () => {
    const {leaseStep} = await import('../pages/src/engine/recording.mjs');
    const hidden = () => [...every('A', 0, 60000, 10), ...every('B', 30000, 60000, 10)];
    assert.deepEqual(simLease(leaseStep, hidden()), {A: 0, B: 0});    // the thrash
    const acts = simLease(V.pollLeaseStep, hidden());
    assert.ok(acts.A + acts.B >= 10, JSON.stringify(acts));
    // One window alone acts on every step.
    assert.deepEqual(simLease(V.pollLeaseStep, every('A', 0, 60000, 10)), {A: 10});
    // A visible window (1.25 s steps) beside a hidden one: the visible one holds the lease; the
    // hidden one only acts when it finds the lease stale, which a 1.25 s refresh never leaves.
    const mixed = simLease(V.pollLeaseStep, [...every('A', 0, 60000, 10), ...every('B', 500, 1250, 479)]);
    assert.equal(mixed.A, 1);    // its very first step, before B ever wrote
    assert.ok(mixed.B > 400);
});


test('pollEvery: every 10 s in the event without a plan or after a failed check, else every minute', () => {
    assert.equal(V.POLL_FAST_MS, 10000);
    assert.equal(V.pollEvery({inEvent: true, hasPlan: false, error: null}), V.POLL_FAST_MS);
    assert.equal(V.pollEvery({inEvent: true, hasPlan: true, error: 'offline'}), V.POLL_FAST_MS);
    assert.equal(V.pollEvery({inEvent: true, hasPlan: true, error: 'notfound'}), V.POLL_FAST_MS);
    assert.equal(V.pollEvery({inEvent: true, hasPlan: true, error: null}), V.POLL_MS);
    assert.equal(V.pollEvery({inEvent: false, hasPlan: false, error: 'offline'}), V.POLL_MS);
    assert.equal(V.pollDue(1000, 10999, V.POLL_FAST_MS), false);
    assert.equal(V.pollDue(1000, 11000, V.POLL_FAST_MS), true);
});


test('checkUrl: the v3 rider URL with joined clubs, event and sig', () => {
    const base = {url: 'https://ttt-beta.example.org/', selfId: '1001', mod: '0.3.0-beta.2'};
    assert.equal(V.checkUrl({...base, joined: ['k7f3q9x2m4', 'p2m8c4t1v9'], start: 1763577060000, eventId: 4567890, sig: 'S91T6D'}),
                 'https://ttt-beta.example.org/api/v3/rider/1001?mod=0.3.0-beta.2&joined=k7f3q9x2m4,p2m8c4t1v9&start=1763577060000&event=4567890&sig=S91T6D');
    assert.equal(V.checkUrl({...base, joined: [], sig: 'bad'}), 'https://ttt-beta.example.org/api/v3/rider/1001?mod=0.3.0-beta.2');
    // start and event only together.
    assert.equal(V.checkUrl({...base, joined: [], start: 1763577060000}), 'https://ttt-beta.example.org/api/v3/rider/1001?mod=0.3.0-beta.2');
    assert.equal(V.checkUrl({...base, joined: [], eventId: 4567890}), 'https://ttt-beta.example.org/api/v3/rider/1001?mod=0.3.0-beta.2');
    assert.equal(V.checkUrl({...base, selfId: 'x', joined: []}), null);
    assert.equal(V.checkUrl({...base, selfId: '1234567890123', joined: []}), null);
    assert.equal(V.checkUrl({...base, url: 'ttt.example.org', joined: []}), null);
});

test('checkUrl: start and event only as safe non-negative integers', () => {
    const base = {url: 'https://ttt-beta.example.org', selfId: '1001', mod: '0.3.0-beta.2', joined: []};
    const plain = 'https://ttt-beta.example.org/api/v3/rider/1001?mod=0.3.0-beta.2';
    assert.equal(V.checkUrl({...base, start: 0, eventId: 0}), `${plain}&start=0&event=0`);
    for (const [start, eventId] of [[1763577060000.5, 4567890], [1763577060000, 4567890.5], [-1, 4567890],
                                    [1763577060000, -4], [1e21, 4567890], [1763577060000, 2 ** 53],
                                    ['1763577060000', 4567890], [1763577060000, '4567890']]) {
        assert.equal(V.checkUrl({...base, start, eventId}), plain, `${start} ${eventId}`);
    }
});

test('normalizeLock: null, empty or bound; anything else is null', () => {
    assert.equal(V.normalizeLock(null), null);
    assert.deepEqual(V.normalizeLock({state: 'empty'}), {state: 'empty', eventKey: null});
    assert.deepEqual(V.normalizeLock({state: 'empty', eventKey: '4567890:1000'}), {state: 'empty', eventKey: '4567890:1000'});
    assert.deepEqual(V.normalizeLock({state: 'bound', circle: 'k7f3q9x2m4', slug: 'kettenfett-rollers', eventKey: '7:1'}),
                     {state: 'bound', circle: 'k7f3q9x2m4', slug: 'kettenfett-rollers', eventKey: '7:1'});
    for (const bad of [undefined, 'empty', 3, [], {}, {state: 'open'}, {state: 'bound', circle: 'k7f3q9x2m4'},
                       {state: 'bound', slug: 'x'}, {state: 'bound', circle: 3, slug: 'x'}]) {
        assert.equal(V.normalizeLock(bad), null, JSON.stringify(bad));
    }
    assert.equal(V.normalizeLock({state: 'empty', eventKey: 5}).eventKey, null);
    // lockAccepts reads the stored shape as the engine's.
    const bound = V.normalizeLock({state: 'bound', circle: 'k7f3q9x2m4', slug: 'kettenfett-rollers', eventKey: '7:1'});
    assert.equal(V.lockAccepts(bound, {circle: {id: 'k7f3q9x2m4'}, slug: 'kettenfett-rollers'}), true);
    assert.equal(V.lockAccepts(bound, {circle: {id: 'p2m8c4t1v9'}, slug: 'kettenfett-rollers'}), false);
});

test('lockFor: a stored lock counts only in its own event', () => {
    const lock = {state: 'bound', circle: 'k7f3q9x2m4', slug: 'kettenfett-rollers', eventKey: '7:1'};
    assert.equal(V.lockFor(lock, '7:1'), lock);
    assert.equal(V.lockFor(lock, '8:1'), null);
    assert.equal(V.lockFor({state: 'empty', eventKey: null}, '7:1'), null);
    assert.equal(V.lockFor(null, '7:1'), null);
    assert.equal(V.lockFor(lock, null), null);
});

test('normalizePending: {eventKey, at, plans, hint} or null', () => {
    const plans = [{label: 'Rollers fast', body: false}];
    assert.deepEqual(V.normalizePending({eventKey: '7:1', at: 5, plans, hint: null}),
                     {eventKey: '7:1', at: 5, plans, hint: null});
    assert.deepEqual(V.normalizePending({eventKey: '7:1', at: 5, plans: [], hint: {id: 'p2m8c4t1v9', name: 'Spokesmen CC', riders: []}}),
                     {eventKey: '7:1', at: 5, plans: [], hint: {id: 'p2m8c4t1v9', name: 'Spokesmen CC'}});
    // A hint without an id and a name is none.
    assert.equal(V.normalizePending({eventKey: '7:1', at: 5, plans: [], hint: {id: 'p2m8c4t1v9'}}).hint, null);
    assert.equal(V.normalizePending({eventKey: '7:1', at: 5, plans: [], hint: 'x'}).hint, null);
    for (const bad of [null, undefined, 3, 'x', [], {}, {eventKey: 7, at: 5, plans: []}, {eventKey: '7:1', at: 'x', plans: []},
                       {eventKey: '7:1', at: 5, plans: {}}, {eventKey: '7:1', at: 5}]) {
        assert.equal(V.normalizePending(bad), null, JSON.stringify(bad));
    }
});

test('checkHeaders: the codes go in X-Paceline-Codes, at most 10, never in the URL', () => {
    assert.equal(V.CODE_HEADER, 'X-Paceline-Codes');
    assert.deepEqual(V.checkHeaders([]), {});
    assert.deepEqual(V.checkHeaders(['7Q4MZ2KX9B', 'R1D3R0NE5X']), {'X-Paceline-Codes': '7Q4MZ2KX9B,R1D3R0NE5X'});
    const eleven = Array.from({length: 11}, (_, i) => `CODE${String(i).padStart(6, '0')}`);
    assert.equal(V.checkHeaders(eleven)['X-Paceline-Codes'].split(',').length, 10);
    assert.equal(V.checkHeaders(eleven)['X-Paceline-Codes'].split(',')[9], eleven[9]);
});

test('inEventOf: a summary with start and event id, TTT only when asked', () => {
    const ttt = {eventId: 4567890, start: 1000, eventType: 'TEAM_TIME_TRIAL'};
    assert.deepEqual(V.inEventOf(ttt, {tttOnly: true}), {start: 1000, eventId: 4567890, key: '4567890:1000'});
    const ride = {eventId: 4567890, start: 1000, eventType: 'GROUP_RIDE', name: 'Coffee ride'};
    assert.equal(V.inEventOf(ride, {tttOnly: true}), null);
    assert.deepEqual(V.inEventOf(ride, {tttOnly: false}), {start: 1000, eventId: 4567890, key: '4567890:1000'});
    // eventStart stands in for a missing subgroup start; start wins when both are there.
    assert.deepEqual(V.inEventOf({eventId: 7, start: null, eventStart: 2000, eventType: 'TEAM_TIME_TRIAL'}, {tttOnly: true}),
                     {start: 2000, eventId: 7, key: '7:2000'});
    assert.equal(V.inEventOf({eventId: 7, start: 1000, eventStart: 2000}, {tttOnly: false}).start, 1000);
    // Not known yet, or no event.
    assert.equal(V.inEventOf({eventId: null, start: 1000, eventType: 'TEAM_TIME_TRIAL'}, {tttOnly: false}), null);
    assert.equal(V.inEventOf({start: 1000, eventType: 'TEAM_TIME_TRIAL'}, {tttOnly: false}), null);
    assert.equal(V.inEventOf({eventId: 7, start: null, eventStart: null}, {tttOnly: false}), null);
    assert.equal(V.inEventOf(null, {tttOnly: false}), null);
    assert.equal(V.inEventOf(undefined, {tttOnly: true}), null);
});

test('rollStep: roll-off after 0, mid-ride gets midRide', () => {
    let st = null;
    const rolled = [];
    for (const time of [0, 0, 3, 4]) {
        const r = V.rollStep(st, {key: 'a', time});
        st = r.state;
        rolled.push(r.rolledOff);
        assert.equal(r.midRide, false);
    }
    assert.deepEqual(rolled, [false, false, true, false]);
    assert.deepEqual(st, {key: 'a', sawZero: true, rolled: true});
    // A window opened mid-ride: already past roll-off, so no roll-off event, but midRide.
    const m = V.rollStep(null, {key: 'b', time: 120});
    assert.equal(m.midRide, true);
    assert.equal(m.rolledOff, false);
    assert.equal(m.state.rolled, true);
    assert.equal(V.rollStep(m.state, {key: 'b', time: 121}).midRide, false);
    // A new event key starts over.
    const n = V.rollStep(m.state, {key: 'c', time: 0});
    assert.deepEqual(n.state, {key: 'c', sawZero: true, rolled: false});
    assert.equal(n.midRide, false);
    // key null resets; a time that is no number changes nothing.
    assert.equal(V.rollStep(m.state, {key: null, time: 5}).state, null);
    const pen = V.rollStep(null, {key: 'd', time: 0}).state;
    const same = V.rollStep(pen, {key: 'd', time: undefined});
    assert.deepEqual(same, {state: pen, rolledOff: false, midRide: false});
    assert.deepEqual(V.rollStep(pen, {key: 'd', time: null}).state, pen);
});


// ---- Task 2: pen rule, ride lock, take-or-wait ----

const CLUBS = {k7f3q9x2m4: 'Kettenfett RC', p2m8c4t1v9: 'Spokesmen CC'};
const TEAMS = {rollers: 'Rollers', sprockets: 'Sprockets'};

// A v3 record as server/api.mjs planRecord sends it with a body. riderIds null: the Rollers
// fixture as it is (a real plan, so it imports); else a copy whose riders are exactly these ids.
function rec(circle, slug, riderIds, uploadedAt, role = 'rider') {
    const r = record(TEAMS[slug] ?? slug, json, txt);
    let j = r.json;
    if (riderIds) {
        j = structuredClone(r.json);
        const proto = Object.values(r.json.riders)[0];
        j.riders = Object.fromEntries(riderIds.map(id => [id, {...proto, name: `Rider ${id}`}]));
    }
    return {
        circle: {id: circle, name: CLUBS[circle]}, team: TEAMS[slug] ?? slug, slug, sheet: `sh-${slug}-${uploadedAt}`,
        label: `${TEAMS[slug] ?? slug} fast`, role, date: '2026-11-19', startAt: '2026-11-19T19:30:00.000Z',
        opensAt: '2026-11-19T19:00:00.000Z', eventId: 4567890, uploadedAt, sig: r.sig,
        etag: `"${r.sig}-${slug}${uploadedAt}"`, body: true, json: j, text: r.text,
    };
}

// The same record without its body, as the server sends it before the plan opens.
function closed(r) {
    const {etag, eventId, json: _j, text: _t, ...head} = r;
    return {...head, body: false};
}

const T1 = '2026-11-18T10:00:00.000Z';
const T2 = '2026-11-18T11:00:00.000Z';
const T3 = '2026-11-18T12:00:00.000Z';
const ids = (prefix, n) => Array.from({length: n}, (_, i) => `${prefix}${i}`);

test('penPick: a lead of 2 before roll-off, ties at roll-off, no nearby data', () => {
    const A = {name: 'A', riderIds: ['1', '2', '3', '9'], uploadedAt: T1};    // 3 near, older
    const B = {name: 'B', riderIds: ['4', '8'], uploadedAt: T2};              // 1 near, newer
    const near3 = ['1', '2', '3', '4'];
    assert.equal(V.penPick([A, B], {nearbyIds: near3, rolledOff: false}), A);    // lead of 2
    assert.equal(V.penPick([B, A], {nearbyIds: near3, rolledOff: false}), A);    // order does not matter
    const near2 = ['1', '2', '4'];                                               // 2 vs 1
    assert.equal(V.penPick([A, B], {nearbyIds: near2, rolledOff: false}), B);    // lead of 1: the newest
    assert.equal(V.penPick([A, B], {nearbyIds: near2, rolledOff: true}), A);     // at roll-off: highest
    const tie = ['1', '2', '4', '8'];                                            // 2 vs 2
    assert.equal(V.penPick([A, B], {nearbyIds: tie, rolledOff: true}), B);       // tie: the newer
    assert.equal(V.penPick([B, A], {nearbyIds: tie, rolledOff: true}), B);
    assert.equal(V.penPick([A, B], {nearbyIds: [], rolledOff: false}), B);       // no nearby data
    assert.equal(V.penPick([A, B], {nearbyIds: [], rolledOff: true}), B);
    assert.equal(V.penPick([A], {nearbyIds: ['1'], rolledOff: false}), A);
    // Three candidates: the lead is over the second best, not over the last.
    const C = {name: 'C', riderIds: ['5', '6'], uploadedAt: T3};
    assert.equal(V.penPick([A, B, C], {nearbyIds: ['1', '2', '3', '5', '6'], rolledOff: false}), C);    // A 3, C 2: lead of 1, the newest
    assert.equal(V.penPick([A, B, C], {nearbyIds: ['1', '2', '3', '4'], rolledOff: false}), A);          // 3 vs 1 vs 0
});

test('choosePlan: rider beats bench, notice records ignored', () => {
    const rider = rec('k7f3q9x2m4', 'rollers', ['1001', '1002'], T1);
    const bench = rec('k7f3q9x2m4', 'sprockets', ['2001'], T2, 'bench');
    const bench2 = rec('p2m8c4t1v9', 'sprockets', ['2002'], T3, 'bench');
    const opts = {nearbyIds: [], rolledOff: false};
    let r = V.choosePlan([bench, rider], opts);
    assert.equal(r.record, rider);
    assert.equal(r.fits, 1);
    r = V.choosePlan([bench, bench2], opts);
    assert.equal(r.record, bench2);
    assert.equal(r.fits, 0);
    r = V.choosePlan([{notice: true, uploadedAt: T3, circle: {id: 'k7f3q9x2m4'}}], opts);
    assert.equal(r.record, null);
    assert.equal(r.fits, 0);
    // A notice never beats a real plan, even a newer one.
    r = V.choosePlan([bench, {notice: true, role: 'rider', uploadedAt: T3, body: true, json: {riders: {x: {}}}}], opts);
    assert.equal(r.record, bench);
    r = V.choosePlan([rider, rec('p2m8c4t1v9', 'sprockets', ['1003'], T2)], opts);
    assert.equal(r.fits, 2);
    assert.equal(r.record.slug, 'sprockets');    // no nearby data: the newest
    assert.deepEqual(V.choosePlan([], opts), {record: null, fits: 0, waiting: null});
    assert.deepEqual(V.choosePlan(undefined, opts), {record: null, fits: 0, waiting: null});
    // Two rider plans go through the pen rule with the plan's riders.
    const a = rec('k7f3q9x2m4', 'rollers', ['1001', '1002', '1003'], T1);
    const b = rec('k7f3q9x2m4', 'sprockets', ['1004', '1005'], T2);
    assert.equal(V.choosePlan([a, b], {nearbyIds: ['1001', '1002', '1003'], rolledOff: false}).record, a);
    assert.equal(V.choosePlan([a, b], {nearbyIds: ['1001', '1002', '1004'], rolledOff: false}).record, b);
});

test('choosePlan: body-less records are not plans', () => {
    const opts = {nearbyIds: [], rolledOff: false};
    const a = rec('k7f3q9x2m4', 'rollers', ['1001'], T1);
    const b = rec('k7f3q9x2m4', 'sprockets', ['1002'], T2);
    assert.deepEqual(V.choosePlan([closed(a)], opts), {record: null, fits: 0, waiting: closed(a)});
    let r = V.choosePlan([closed(a), b], opts);
    assert.equal(r.record, b);
    assert.deepEqual(r.waiting, closed(a));
    assert.equal(r.fits, 1);
    const a2 = {...closed(a), opensAt: '2026-11-19T18:10:00.000Z'};
    const b2 = {...closed(b), opensAt: '2026-11-19T18:00:00.000Z'};
    assert.deepEqual(V.choosePlan([a2, b2], opts).waiting, b2);
    assert.deepEqual(V.choosePlan([b2, a2], opts).waiting, b2);
    // A closed rider record does not count for fits.
    assert.equal(V.choosePlan([a2, b2], opts).fits, 0);
    // A notice is dropped before the body check: it is never "waiting".
    assert.equal(V.choosePlan([{notice: true, body: false, opensAt: '2026-11-19T17:00:00.000Z'}], opts).waiting, null);
});

test('lockAccepts: null and empty take anything, bound only its own circle and team', () => {
    const rollers = rec('k7f3q9x2m4', 'rollers', ['1001'], T1);
    const newSheet = {...rollers, sheet: 'other-sheet', label: 'Rollers slow', etag: '"X-1"'};
    assert.equal(V.lockAccepts(null, rollers), true);
    assert.equal(V.lockAccepts({state: 'empty'}, rollers), true);
    const lock = {state: 'bound', circle: 'k7f3q9x2m4', slug: 'rollers'};
    assert.equal(V.lockAccepts(lock, newSheet), true);
    assert.equal(V.lockAccepts(lock, rec('k7f3q9x2m4', 'sprockets', ['1001'], T1)), false);
    assert.equal(V.lockAccepts(lock, rec('p2m8c4t1v9', 'rollers', ['1001'], T1)), false);
});

test('lockAtRollOff: a server plan binds, a file plan or none leaves it empty', () => {
    const server = {sig: 'S91T6D', source: 'server', circleId: 'k7f3q9x2m4', slug: 'rollers'};
    const bound = {state: 'bound', circle: 'k7f3q9x2m4', slug: 'rollers'};
    assert.deepEqual(V.lockAtRollOff(server, {fileActive: false}), bound);
    assert.deepEqual(V.lockAtRollOff(server, {fileActive: true}), {state: 'empty'});
    assert.deepEqual(V.lockAtRollOff({sig: 'S91T6D', source: 'file'}, {fileActive: false}), {state: 'empty'});
    assert.deepEqual(V.lockAtRollOff(null, {fileActive: false}), {state: 'empty'});
    // A server entry without a club or slug has nothing to bind.
    assert.deepEqual(V.lockAtRollOff({source: 'server', team: 'Rollers'}, {fileActive: false}), {state: 'empty'});
    assert.deepEqual(V.lockAtRollOff(undefined, {fileActive: false}), {state: 'empty'});
});

test('serverDecision: the lock', () => {
    const rollers = rec('k7f3q9x2m4', 'rollers', ['1001'], T1);
    const sprockets = rec('k7f3q9x2m4', 'sprockets', ['1001'], T2);
    const bound = {state: 'bound', circle: 'k7f3q9x2m4', slug: 'rollers'};
    const base = {waiting: null, fileActive: false, activeEtag: rollers.etag};
    // Bound to Rollers.
    assert.deepEqual(V.serverDecision({...base, record: sprockets, lock: bound}), {action: 'pend', bind: false});
    assert.deepEqual(V.serverDecision({...base, record: null, lock: bound}), {action: 'keep', bind: false});
    const newer = {...rollers, etag: '"S91T6D-new"'};
    assert.deepEqual(V.serverDecision({...base, record: newer, lock: bound}), {action: 'take', bind: false});
    assert.deepEqual(V.serverDecision({...base, record: rollers, lock: bound}), {action: 'same', bind: false});
    // Empty lock: it binds to what becomes active.
    const empty = {state: 'empty'};
    assert.deepEqual(V.serverDecision({...base, record: rollers, lock: empty, activeEtag: null}),
                     {action: 'take', bind: true});
    assert.deepEqual(V.serverDecision({...base, record: rollers, lock: empty}), {action: 'same', bind: true});
    assert.deepEqual(V.serverDecision({...base, record: null, lock: empty}), {action: 'drop', bind: false});
    // No lock.
    assert.deepEqual(V.serverDecision({...base, record: null, lock: null}), {action: 'drop', bind: false});
    assert.deepEqual(V.serverDecision({...base, record: sprockets, lock: null}), {action: 'take', bind: false});
    assert.deepEqual(V.serverDecision({...base, record: rollers, lock: null}), {action: 'same', bind: false});
});

test('serverDecision: a file plan overrides', () => {
    const rollers = rec('k7f3q9x2m4', 'rollers', ['1001'], T1);
    for (const lock of [null, {state: 'empty'}, {state: 'bound', circle: 'k7f3q9x2m4', slug: 'rollers'}]) {
        assert.deepEqual(V.serverDecision({record: rollers, lock, fileActive: true, activeEtag: rollers.etag}),
                         {action: 'pend', bind: false});
        assert.deepEqual(V.serverDecision({record: rollers, lock, fileActive: true, activeEtag: null}),
                         {action: 'pend', bind: false});
        assert.deepEqual(V.serverDecision({record: null, lock, fileActive: true, activeEtag: null}),
                         {action: 'keep', bind: false});
    }
});

test('serverDecision: a body-less record changes nothing', () => {
    const a = closed(rec('k7f3q9x2m4', 'rollers', ['1001'], T1));
    for (const lock of [null, {state: 'empty'}, {state: 'bound', circle: 'k7f3q9x2m4', slug: 'rollers'}]) {
        for (const fileActive of [false, true]) {
            assert.deepEqual(V.serverDecision({record: null, waiting: a, lock, fileActive, activeEtag: 'x'}),
                             {action: 'keep', bind: false});
        }
    }
});

test('pendingFor: Remove only takes the pending plan of this event', () => {
    const r = rec('k7f3q9x2m4', 'rollers', ['1001'], T1);
    assert.deepEqual(V.pendingFor({eventKey: '4567890:1000', plans: [r]}, '4567890:1000'), [r]);
    assert.deepEqual(V.pendingFor({eventKey: '4567890:1000', plans: [r]}, '4567890:2000'), []);
    assert.deepEqual(V.pendingFor(null, '4567890:1000'), []);
    assert.deepEqual(V.pendingFor(undefined, undefined), []);
});

test('lockAfterClubs: unticking the locked club clears the lock', () => {
    const bound = {state: 'bound', circle: 'k7f3q9x2m4', slug: 'rollers'};
    assert.equal(V.lockAfterClubs(bound, ['p2m8c4t1v9']), null);
    assert.equal(V.lockAfterClubs(bound, []), null);
    assert.equal(V.lockAfterClubs(bound, ['p2m8c4t1v9', 'k7f3q9x2m4']), bound);
    const empty = {state: 'empty'};
    assert.equal(V.lockAfterClubs(empty, []), empty);
    assert.equal(V.lockAfterClubs(null, ['k7f3q9x2m4']), null);
});

test('staleForEvent: a server plan of an earlier event, never a file plan', () => {
    assert.equal(V.staleForEvent({source: 'server', eventKey: 'a'}, 'b'), true);
    assert.equal(V.staleForEvent({source: 'server', eventKey: 'a'}, 'a'), false);
    assert.equal(V.staleForEvent({source: 'file'}, 'b'), false);
    assert.equal(V.staleForEvent({source: 'file', eventKey: 'a'}, 'b'), false);
    assert.equal(V.staleForEvent(null, 'b'), false);
});

test('recordEntry survives the library round trip', () => {
    const entry = V.recordEntry(rec('k7f3q9x2m4', 'rollers', null, T1), {now: 1000, eventKey: '4567890:1000'});
    const lib = L.normalizeLibrary(L.addPlan(L.normalizeLibrary(null), entry));
    for (const k of ['source', 'team', 'label', 'circleId', 'circleName', 'slug', 'eventKey', 'etag', 'startAt', 'role']) {
        assert.equal(typeof entry[k], 'string', k);
        assert.equal(lib.plans[entry.sig][k], entry[k], k);
    }
    assert.deepEqual(lib.plans[entry.sig], entry);
});

test('recordEntry and entryUpdate', () => {
    const r = rec('k7f3q9x2m4', 'rollers', null, T1);
    const entry = V.recordEntry(r, {now: 1000, eventKey: '4567890:1000'});
    assert.equal(entry.source, 'server');
    assert.equal(entry.team, r.label);
    assert.equal(entry.label, r.label);
    assert.equal(entry.circleId, 'k7f3q9x2m4');
    assert.equal(entry.circleName, 'Kettenfett RC');
    assert.equal(entry.slug, 'rollers');
    assert.equal(entry.eventKey, '4567890:1000');
    assert.equal(entry.etag, r.etag);
    assert.equal(entry.startAt, r.startAt);
    assert.equal(entry.role, 'rider');
    assert.equal(entry.loadedAt, 1000);
    assert.equal(entry.sig, r.sig);
    assert.equal(P.importFiles([entry.json, entry.text].filter(Boolean)).plan.sig, r.sig);
    // No usable plan: null.
    assert.equal(V.recordEntry({...r, json: null}, {now: 1, eventKey: 'k'}), null);
    assert.equal(V.recordEntry(closed(r), {now: 1, eventKey: 'k'}), null);
    assert.equal(V.recordEntry(null, {now: 1, eventKey: 'k'}), null);
    // entryUpdate: added and active; the same record again changes nothing.
    const lib = V.entryUpdate(L.normalizeLibrary(null), entry);
    assert.equal(lib.active, r.sig);
    assert.equal(L.activeEntry(lib).source, 'server');
    assert.equal(V.entryUpdate(lib, V.recordEntry(r, {now: 2000, eventKey: '4567890:1000'})), null);
    // A changed etag with the same files is a new library.
    const next = V.entryUpdate(lib, V.recordEntry({...r, etag: '"S91T6D-changed"'}, {now: 3000, eventKey: '4567890:1000'}));
    assert.notEqual(next, null);
    assert.equal(L.activeEntry(next).etag, '"S91T6D-changed"');
    assert.equal(L.activeEntry(next).loadedAt, 3000);
});

test('answerHint: the first hint for a club not yet hinted, only when the answer has no plans', () => {
    const clubs = {server: 's', clubs: [{id: 'p2m8c4t1v9', name: 'Spokesmen CC', hinted: true},
                                        {id: 'k7f3q9x2m4', name: 'Kettenfett RC', hinted: false}]};
    const spokes = {id: 'p2m8c4t1v9', name: 'Spokesmen CC', riders: [], uploadedAt: 'x', body: false};
    const kett = {id: 'k7f3q9x2m4', name: 'Kettenfett RC', riders: ['1001'], uploadedAt: 'x', body: true};
    const other = {id: 'h6r3w8n5d2', name: 'Other RC', riders: [], uploadedAt: 'x', body: false};
    assert.deepEqual(V.answerHint({plans: [], hint: [spokes, kett]}, clubs), {id: 'k7f3q9x2m4', name: 'Kettenfett RC'});
    // A club not in the table was never hinted.
    assert.deepEqual(V.answerHint({plans: [], hint: [spokes, other]}, clubs), {id: 'h6r3w8n5d2', name: 'Other RC'});
    assert.equal(V.answerHint({plans: [], hint: [spokes]}, clubs), null);
    assert.equal(V.answerHint({plans: [{label: 'x'}], hint: [kett]}, clubs), null);
    assert.equal(V.answerHint({plans: []}, clubs), null);
    assert.equal(V.answerHint({plans: [], hint: [{id: 'k7f3q9x2m4'}, 3, null]}, clubs), null);
    assert.equal(V.answerHint(null, clubs), null);
});

test('choiceStatus: fits from 2 on, "plan opens" only while no plan with a body is chosen', () => {
    const waiting = {label: 'Rollers fast', opensAt: '2026-11-19T18:00:00.000Z', body: false};
    assert.deepEqual(V.choiceStatus({record: null, fits: 0, waiting}),
                     {serverFits: null, serverOpensAt: Date.parse('2026-11-19T18:00:00.000Z'), serverOpensLabel: 'Rollers fast'});
    assert.deepEqual(V.choiceStatus({record: {label: 'x'}, fits: 2, waiting}),
                     {serverFits: 2, serverOpensAt: null, serverOpensLabel: null});
    assert.deepEqual(V.choiceStatus({record: {label: 'x'}, fits: 1, waiting: null}),
                     {serverFits: null, serverOpensAt: null, serverOpensLabel: null});
    assert.deepEqual(V.choiceStatus({record: null, fits: 0, waiting: {label: 'Rollers fast', opensAt: 'soon'}}),
                     {serverFits: null, serverOpensAt: null, serverOpensLabel: 'Rollers fast'});
    assert.equal(V.choiceStatus({record: null, fits: 0, waiting: {label: 3, opensAt: null}}).serverOpensLabel, null);
});

// Fix round 1 (I-1): a bound lock takes its own team's new final even when the pen rule over all
// plans would pick another club's.
test('chooseForLock: the locked team\'s new final wins over the pen rule', () => {
    const lock = {state: 'bound', circle: 'k7f3q9x2m4', slug: 'rollers', eventKey: '7:1'};
    const rollersNew = {...rec('k7f3q9x2m4', 'rollers', ['1001', '1002', '1003', '1004'], '2026-11-19T18:00:00.000Z'),
                        etag: '"R-B"'};
    const sprockets = {...rec('p2m8c4t1v9', 'sprockets', ['1001', '1005', '1006', '1007'], '2026-11-19T17:00:00.000Z'),
                       etag: '"S-A"'};
    const opts = {nearbyIds: ['1001', '1005', '1006', '1007'], rolledOff: true};
    // The bug: the pen rule over all plans picks Sprockets, and the lock makes that wait.
    assert.equal(V.choosePlan([rollersNew, sprockets], opts).record, sprockets);
    const c = V.chooseForLock([rollersNew, sprockets], lock, opts);
    assert.equal(c.record, rollersNew);
    assert.equal(c.fits, 2);    // the status still counts every fitting plan
    assert.equal(V.serverDecision({record: c.record, waiting: c.waiting, lock, fileActive: false, activeEtag: '"R-A"'}).action,
                 'take');
    // Order of the answer doesn't matter.
    assert.equal(V.chooseForLock([sprockets, rollersNew], lock, opts).record, rollersNew);
});

test('chooseForLock: no record the lock accepts gives the all-plans pick, which then waits', () => {
    const lock = {state: 'bound', circle: 'k7f3q9x2m4', slug: 'rollers', eventKey: '7:1'};
    const sprockets = {...rec('p2m8c4t1v9', 'sprockets', ['1001', '1005'], '2026-11-19T17:00:00.000Z'), etag: '"S-A"'};
    const opts = {nearbyIds: ['1001', '1005'], rolledOff: true};
    const c = V.chooseForLock([sprockets], lock, opts);
    assert.deepEqual(c, V.choosePlan([sprockets], opts));
    assert.equal(V.serverDecision({record: c.record, waiting: c.waiting, lock, fileActive: false, activeEtag: '"R-A"'}).action,
                 'pend');
    // A body-less record of the locked team is no plan: the all-plans pick too.
    const closed = {...rec('k7f3q9x2m4', 'rollers', ['1001'], '2026-11-19T18:00:00.000Z'), body: false,
                    opensAt: '2026-11-19T18:00:00.000Z'};
    assert.deepEqual(V.chooseForLock([closed, sprockets], lock, opts), V.choosePlan([closed, sprockets], opts));
    // No plans at all.
    assert.deepEqual(V.chooseForLock([], lock, opts), {record: null, fits: 0, waiting: null});
});

test('chooseForLock: an empty or no lock is choosePlan', () => {
    const a = {...rec('k7f3q9x2m4', 'rollers', ['1001', '1002', '1003', '1004'], '2026-11-19T18:00:00.000Z'), etag: '"R-B"'};
    const b = {...rec('p2m8c4t1v9', 'sprockets', ['1001', '1005', '1006', '1007'], '2026-11-19T17:00:00.000Z'), etag: '"S-A"'};
    const opts = {nearbyIds: ['1001', '1005', '1006', '1007'], rolledOff: true};
    for (const lock of [null, undefined, {state: 'empty', eventKey: '7:1'}]) {
        assert.deepEqual(V.chooseForLock([a, b], lock, opts), V.choosePlan([a, b], opts), JSON.stringify(lock));
    }
});


test('dropsAtEventBegin: a server plan of another event, and a file plan that has ended', () => {
    const H = 3600000;
    const at = {key: 'b', now: 100 * H};
    assert.equal(V.dropsAtEventBegin({source: 'server', eventKey: 'a'}, at), true);
    assert.equal(V.dropsAtEventBegin({source: 'server', eventKey: 'b'}, at), false);
    const file = L.fileEntry({sig: 'F', json: '{}', text: null, now: 99 * H});
    assert.equal(V.dropsAtEventBegin(file, at), false);                          // a running file plan stays
    assert.equal(V.dropsAtEventBegin({...file, endedAt: 99.5 * H}, at), true);   // ended at the last gate close
    assert.equal(V.dropsAtEventBegin({...file, loadedAt: 100 * H - L.FILE_MAX_MS}, at), true);    // 18 h old
    const old = L.normalizeLibrary({plans: {O: {json: '{}', text: null, loadedAt: 99 * H}}, active: 'O'});
    assert.equal(V.dropsAtEventBegin(L.activeEntry(old), at), true);            // a 0.2 entry
    assert.equal(V.dropsAtEventBegin(null, at), false);
});


test('eventOverStatus: what only meant "in this race" goes, other errors stay', () => {
    const p = {serverOpensAt: 5, serverOpensLabel: 'Rollers', serverFits: 2, serverError: 'notfound',
               serverSig: 'RE5CFQ', serverNotice: 'hi'};
    assert.deepEqual(V.eventOverStatus(p),
                     {serverOpensAt: null, serverOpensLabel: null, serverFits: null, serverError: null});
    for (const kind of ['offline', 'http', 'invalid', 'badurl', null]) {
        assert.deepEqual(V.eventOverStatus({...p, serverError: kind}),
                         {serverOpensAt: null, serverOpensLabel: null, serverFits: null}, String(kind));
    }
});


test('serverRuns: only the poll lease owner, never in the demo, never with the server off', () => {
    assert.equal(V.serverRuns({act: true, demo: null, serverOn: true}), true);
    assert.equal(V.serverRuns({act: false, demo: null, serverOn: true}), false);
    assert.equal(V.serverRuns({act: true, demo: 'pref', serverOn: true}), false);
    assert.equal(V.serverRuns({act: true, demo: 'url', serverOn: true}), false);
    assert.equal(V.serverRuns({act: true, demo: null, serverOn: false}), false);
});


test('eventChange: another event while one is still set ends the old one first', () => {
    const ev = key => ({key, start: 1, eventId: 2});
    assert.deepEqual(V.eventChange(null, ev('a')), {over: false, begin: true});
    assert.deepEqual(V.eventChange('a', ev('a')), {over: false, begin: false});
    assert.deepEqual(V.eventChange('a', ev('b')), {over: true, begin: true});    // quit mid-race, next pen
    assert.deepEqual(V.eventChange('a', null), {over: false, begin: false});      // the gate decides that
    assert.deepEqual(V.eventChange(null, null), {over: false, begin: false});
});
