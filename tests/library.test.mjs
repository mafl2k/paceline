// Run with: node --test tests/library.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../pages/src/engine/library.mjs';


test('normalizeLibrary tolerates junk', () => {
    assert.deepEqual(L.normalizeLibrary(null), {plans: {}, active: null});
    assert.deepEqual(L.normalizeLibrary({plans: 3, active: 'X'}), {plans: {}, active: null});
});


test('addPlan activates and caps at 10, never dropping the active one', () => {
    let lib = L.normalizeLibrary(null);
    for (let i = 0; i < 12; i++) {
        lib = L.addPlan(lib, {sig: 'S' + i, json: '{}', text: null, loadedAt: i});
    }
    assert.equal(Object.keys(lib.plans).length, 10);
    assert.equal(lib.active, 'S11');
    assert.ok(!lib.plans.S0 && !lib.plans.S1);
    assert.equal(L.activeEntry(lib).sig, 'S11');
});


test('re-adding the same sig replaces it', () => {
    let lib = L.addPlan(L.normalizeLibrary(null), {sig: 'A', json: '1', text: null, loadedAt: 1});
    lib = L.addPlan(lib, {sig: 'A', json: '2', text: 't', loadedAt: 2});
    assert.equal(Object.keys(lib.plans).length, 1);
    assert.equal(lib.plans.A.text, 't');
});


const H = 3600000;
const T0 = Date.parse('2026-11-17T19:00:00Z');


test('entries get a source: one without (0.2) is an ended file entry, with or without team', () => {
    const lib = L.normalizeLibrary({plans: {
        A: {json: '{}', text: null, loadedAt: 1, team: 'Rollers'},
        B: {json: '{}', text: null, loadedAt: 2},
        S: {json: '{}', text: null, loadedAt: 3, team: 'Rollers', source: 'server'},
    }, active: 'A'});
    assert.equal(lib.plans.A.source, 'file');
    assert.equal(lib.plans.A.endedAt, 0);
    assert.equal(lib.plans.A.team, 'Rollers');
    assert.equal(lib.plans.B.source, 'file');
    assert.equal(lib.plans.B.endedAt, 0);
    assert.equal(lib.plans.S.source, 'server');
    assert.ok(!('endedAt' in lib.plans.S));
    // the 0.2 server plan: never active with the plan server on, still usable with it off
    assert.equal(L.fileEnded(lib.plans.A, {now: T0, serverOn: true}), true);
    assert.equal(L.fileActive(lib, {now: T0, serverOn: true}), false);
    assert.equal(L.fileActive(lib, {now: T0, serverOn: false}), true);
    const f = L.fileEntry({sig: 'C', json: '{}', text: 't', now: T0});
    assert.deepEqual(f, {sig: 'C', json: '{}', text: 't', loadedAt: T0, source: 'file'});
    assert.ok(!('endedAt' in f));
    const kept = L.normalizeLibrary({plans: {C: f}, active: 'C'});
    assert.equal(kept.plans.C.source, 'file');
    assert.ok(!('endedAt' in kept.plans.C));
    const ended = L.normalizeLibrary({plans: {C: {...f, endedAt: T0 + H}}, active: 'C'});
    assert.equal(ended.plans.C.endedAt, T0 + H);
});


test('server fields survive a round trip through normalizeLibrary', () => {
    const entry = {
        sig: 'S91T6D', json: '{}', text: null, loadedAt: T0, source: 'server', team: 'Rollers fast',
        label: 'Rollers fast', circleId: 'k7f3q9x2m4', circleName: 'Kettenfett RC', slug: 'rollers',
        eventKey: '5501:2026-11-19T19:30:00.000Z', etag: '"S91T6D-x"', startAt: '2026-11-19T19:30:00.000Z',
        role: 'rider',
    };
    const lib = L.normalizeLibrary(L.addPlan(L.normalizeLibrary(null), entry));
    assert.deepEqual(lib.plans.S91T6D, entry);
    const junk = L.normalizeLibrary({plans: {S: {json: '{}', team: 'R', label: 3, circleId: null, slug: {}}}});
    for (const k of ['label', 'circleId', 'slug', 'etag', 'role']) {
        assert.ok(!(k in junk.plans.S), k);
    }
});


test('fileEnded: gate close, 18 h, server off', () => {
    const on = {serverOn: true};
    const lib = L.addPlan(L.normalizeLibrary(null), L.fileEntry({sig: 'F', json: '{}', text: null, now: T0}));
    const e = L.activeEntry(lib);
    assert.equal(L.fileEnded(e, {now: T0 + 18 * H - 1, ...on}), false);
    assert.equal(L.fileEnded(e, {now: T0 + 18 * H, ...on}), true);
    assert.equal(L.FILE_MAX_MS, 18 * H);
    assert.equal(L.fileActive(lib, {now: T0 + H, ...on}), true);
    assert.equal(L.fileActive(lib, {now: T0 + 18 * H, ...on}), false);

    const ended = L.endFilePlan(lib, T0 + 2 * H);
    assert.equal(ended.active, null);
    assert.equal(ended.plans.F.endedAt, T0 + 2 * H);
    assert.equal(L.fileEnded(ended.plans.F, {now: T0 + 3 * H, ...on}), true);
    assert.equal(L.fileEnded(ended.plans.F, {now: T0 + 3 * H, serverOn: false}), false);
    assert.equal(L.fileEnded(e, {now: T0 + 40 * H, serverOn: false}), false);

    const old = L.normalizeLibrary({plans: {O: {json: '{}', text: null, loadedAt: T0}}, active: 'O'});
    assert.equal(L.fileEnded(old.plans.O, {now: T0 + H, serverOn: true}), true);
    assert.equal(L.fileEnded(old.plans.O, {now: T0 + H, serverOn: false}), false);
    assert.equal(L.fileActive(old, {now: T0 + H, serverOn: true}), false);
    assert.equal(L.fileActive(old, {now: T0 + H, serverOn: false}), true);
    assert.equal(L.fileActive(L.normalizeLibrary(null), {now: T0, serverOn: true}), false);

    const server = {sig: 'V', json: '{}', text: null, loadedAt: T0, source: 'server', team: 'Rollers'};
    assert.equal(L.fileEnded(server, {now: T0 + 40 * H, serverOn: true}), false);
    assert.equal(L.fileEnded(null, {now: T0, serverOn: true}), false);
});


test('load Tue, race Thu', () => {
    const loaded = Date.parse('2026-11-17T19:00:00Z');
    const e = L.fileEntry({sig: 'F', json: '{}', text: null, now: loaded});
    assert.equal(L.fileEnded(e, {now: Date.parse('2026-11-19T18:00:00Z'), serverOn: true}), true);
});


test('endFilePlan ends only a file plan', () => {
    const server = {sig: 'V', json: '{}', text: null, loadedAt: T0, source: 'server', team: 'Rollers'};
    const lib = L.addPlan(L.normalizeLibrary(null), server);
    assert.equal(L.endFilePlan(lib, T0 + H), lib);
    const empty = L.normalizeLibrary(null);
    assert.equal(L.endFilePlan(empty, T0), empty);
});


test('endsAtGateClose: only a file plan loaded by the time the event was last seen', () => {
    const file = L.fileEntry({sig: 'F', json: '{}', text: null, now: T0});
    assert.equal(L.endsAtGateClose(file, T0 + H), true);       // loaded before the race: ends
    assert.equal(L.endsAtGateClose(file, T0), true);           // loaded in the step the event was seen
    assert.equal(L.endsAtGateClose(file, T0 - 1), false);      // loaded after: a late gate close keeps it
    assert.equal(L.endsAtGateClose(file, null), false);        // the event never seen
    const server = {sig: 'V', json: '{}', text: null, loadedAt: T0, source: 'server'};
    assert.equal(L.endsAtGateClose(server, T0 + H), false);
    assert.equal(L.endsAtGateClose(null, T0 + H), false);
});


test('planEntry: the entry the windows ride, never an ended file plan with the server on', () => {
    const on = {serverOn: true};
    const old = L.normalizeLibrary({plans: {O: {json: '{}', text: null, loadedAt: T0, team: 'Update Paceline'}}, active: 'O'});
    assert.equal(L.planEntry(old, {now: T0 + H, ...on}), null);
    assert.equal(L.planEntry(old, {now: T0 + H, serverOn: false}).sig, 'O');

    const lib = L.addPlan(L.normalizeLibrary(null), L.fileEntry({sig: 'F', json: '{}', text: null, now: T0}));
    assert.equal(L.planEntry(lib, {now: T0 + H, ...on}).sig, 'F');
    assert.equal(L.planEntry(lib, {now: T0 + 18 * H, ...on}), null);
    assert.equal(L.planEntry(lib, {now: T0 + 18 * H, serverOn: false}).sig, 'F');

    const server = L.addPlan(lib, {sig: 'V', json: '{}', text: null, loadedAt: T0, source: 'server'});
    assert.equal(L.planEntry(server, {now: T0 + 40 * H, ...on}).sig, 'V');
    assert.equal(L.planEntry(L.normalizeLibrary(null), {now: T0, ...on}), null);
});
