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

test('planUrl: by team name first, by athlete id without one, null otherwise', () => {
    assert.equal(V.planUrl({url: 'https://ttt.mafl.net', team: 'TTT Rollers', selfId: '5100002'}),
                 'https://ttt.mafl.net/api/plan/ttt-rollers');
    assert.equal(V.planUrl({url: 'https://ttt.mafl.net/', team: '', selfId: '5100002'}),
                 'https://ttt.mafl.net/api/plan/by-athlete/5100002');
    assert.equal(V.planUrl({url: 'http://localhost:8790//', team: '  ', selfId: 5100002}),
                 'http://localhost:8790/api/plan/by-athlete/5100002');
    assert.equal(V.planUrl({url: 'https://ttt.mafl.net', team: '', selfId: null}), null);
    assert.equal(V.planUrl({url: 'https://ttt.mafl.net', team: '!!!', selfId: null}), null);
    assert.equal(V.planUrl({url: 'ttt.mafl.net', team: 'Rollers', selfId: null}), null);
    assert.equal(V.planUrl({url: 'javascript:alert(1)', team: 'Rollers', selfId: null}), null);
    assert.equal(V.DEFAULT_SERVER_URL, 'https://ttt.mafl.net');
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

test('serverPlanUpdate: adds and activates, null when unchanged or invalid', () => {
    const empty = L.normalizeLibrary(null);
    const lib = V.serverPlanUpdate(empty, record(), 1000);
    assert.equal(lib.active, '5FWHC3');
    assert.equal(L.activeEntry(lib).team, 'Rollers');
    assert.equal(L.activeEntry(lib).loadedAt, 1000);
    // Survives the storage round trip.
    assert.equal(L.activeEntry(L.normalizeLibrary(JSON.parse(JSON.stringify(lib)))).team, 'Rollers');
    // Same plan again: nothing to do.
    assert.equal(V.serverPlanUpdate(lib, record(), 2000), null);
    // Invalid records.
    assert.equal(V.serverPlanUpdate(lib, {team: 'X', json: {riders: {}}}, 2000), null);
    assert.equal(V.serverPlanUpdate(lib, {team: 'X', json: null}, 2000), null);
    assert.equal(V.serverPlanUpdate(lib, null, 2000), null);
});

test('serverPlanUpdate: a renamed rider keeps the sig but replaces the entry', () => {
    const lib = V.serverPlanUpdate(L.normalizeLibrary(null), record(), 1000);
    const j = JSON.parse(json);
    j.riders['5100003'].name = 'Kim Renamed';    // in both files, as the planner exports it
    const renamed = record('Rollers', JSON.stringify(j), txt.replace('Kim S &#9733; [KFR]', 'Kim Renamed'));
    assert.equal(renamed.sig, '5FWHC3');
    const next = V.serverPlanUpdate(lib, renamed, 2000);
    assert.notEqual(next, null);
    assert.deepEqual(Object.keys(next.plans), ['5FWHC3']);
    const plan = P.importFiles([next.plans['5FWHC3'].json, next.plans['5FWHC3'].text]).plan;
    assert.equal(plan.riders.find(r => r.id === '5100003').name, 'Kim Renamed');
    // A team rename alone also counts.
    assert.equal(L.activeEntry(V.serverPlanUpdate(lib, record('Rollers B'), 2000)).team, 'Rollers B');
});

test('serverPlanUpdate: a server plan replaces a hand-loaded one as active', () => {
    const other = JSON.parse(json);
    other.riders['5100005'].pull_duration = 90;    // a different plan (other sig)
    const handJson = JSON.stringify(other);
    const handSig = P.importFiles([handJson, txt]).plan.sig;
    assert.notEqual(handSig, '5FWHC3');
    const hand = L.addPlan(L.normalizeLibrary(null), {sig: handSig, json: handJson, text: txt, loadedAt: 5});
    const lib = V.serverPlanUpdate(hand, record(), 1000);
    assert.equal(lib.active, '5FWHC3');
    assert.ok(lib.plans[handSig]);    // the hand-loaded plan stays in the library
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
