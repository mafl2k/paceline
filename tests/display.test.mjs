// Run with: node --test tests/display.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as P from '../pages/src/engine/plan.mjs';
import * as R from '../pages/src/engine/rotation.mjs';
import * as D from '../pages/src/engine/display.mjs';
import * as C from '../pages/src/engine/clock.mjs';

const json = readFileSync(new URL('./fixtures/rollers.json', import.meta.url), 'utf8');
const txt = readFileSync(new URL('./fixtures/rollers.txt', import.meta.url), 'utf8');


test('clock formats m:ss', () => {
    assert.equal(D.clock(0), '0:00');
    assert.equal(D.clock(9), '0:09');
    assert.equal(D.clock(75), '1:15');
    assert.equal(D.clock(59.9), '0:59');
    assert.equal(D.clock(600), '10:00');
    assert.equal(D.clock(-3), '0:00');
    assert.equal(D.clock(null), '0:00');
});

function view(now, front, selfId = '5100002') {
    const {plan} = P.importFiles([json, txt]);
    const all = plan.riders.map(r => r.id);
    return R.rotationView(plan, {selfId, chainIds: all, wheelId: null, front, now});
}

test('markerStep: median, smoothing, restart after a gap and at a pull start', () => {
    assert.deepEqual([D.MEDIAN_N, D.POWER_TAU_S, D.DEADBAND_PCT], [5, 4, 2]);
    let m = D.markerStep(D.initialMarker(), {at: 0, w: 200, pull: null});
    assert.equal(m.w, 200); assert.equal(m.zone, null);
    m = D.markerStep(m, {at: 1000, w: 300, pull: null});
    assert.equal(m.w, 212.5);                                 // median 250, 200 + (250 - 200) / 4
    assert.equal(D.markerStep(m, {at: 2000, w: NaN, pull: null}), m);
    assert.equal(D.markerPower(m, 1000 + D.POWER_KEEP_MS), 212.5);
    assert.equal(D.markerPower(m, 1001 + D.POWER_KEEP_MS), null);
    // After a gap it starts over.
    assert.equal(D.markerStep(m, {at: 7000, w: 250, pull: null}).w, 250);
    // My pull starts: it starts over with the pull's first sample.
    m = D.markerStep(m, {at: 2000, w: 280, pull: {since: 1500, target: 280}});
    assert.equal(m.w, 280); assert.equal(m.pullSince, 1500);
});


test('markerStep: a single spike does not move the marker, a few watts either way neither', () => {
    const pull = {since: 0, target: 280};
    let m = D.initialMarker();
    for (let t = 0; t < 20; t++) {
        m = D.markerStep(m, {at: t * 1000, w: 280, pull});
    }
    assert.equal(m.w, 280); assert.equal(m.zone, 'green');
    m = D.markerStep(m, {at: 20000, w: 520, pull});              // one Zwift spike
    assert.equal(m.w, 280);
    for (let t = 21; t < 60; t++) {                               // +-5 W: inside the 2 % deadband
        m = D.markerStep(m, {at: t * 1000, w: t % 2 ? 285 : 275, pull});
        assert.equal(m.w, 280, `still at ${t}`);
    }
});


test('markerStep: neutral at the start of a pull; a 10 % drop is coloured within a few seconds', () => {
    assert.equal(D.PULL_SETTLE_S, 5);
    const pull = {since: 0, target: 280};
    let m = D.initialMarker();
    for (let t = 0; t < 5; t++) {
        m = D.markerStep(m, {at: t * 1000, w: 350, pull});
        assert.equal(m.zone, null, `settling at ${t}`);          // the ramp-up shows no colour
    }
    for (let t = 5; t < 40; t++) {
        m = D.markerStep(m, {at: t * 1000, w: 280, pull});
    }
    assert.equal(m.zone, 'green');
    // 12 % short from 40 on: amber after a few seconds, then red.
    const zones = [];
    for (let t = 40; t < 60; t++) {
        m = D.markerStep(m, {at: t * 1000, w: 246, pull});
        zones.push(m.zone[0]);
    }
    assert.match(zones.join(''), /^g{2,4}a+r+$/);
    assert.ok(zones.indexOf('a') <= 5, zones.join(''));
    // Without a target or outside a pull: neutral, and no deadband.
    assert.equal(D.markerStep(m, {at: 61000, w: 280, pull: {since: 0, target: null}}).zone, null);
    const off = D.markerStep(m, {at: 61000, w: 250, pull: null});
    assert.equal(off.zone, null); assert.notEqual(off.w, m.w);
});


test('actionModel: the marker takes the filtered zone (null: neutral)', () => {
    const front = {puller: '5100002', since: 0};            // Dario, 60 s at 266 W
    assert.equal(D.actionModel(view(20000, front), 314, 'amber').marker.zone, 'amber');
    assert.equal(D.actionModel(view(20000, front), 314, null).marker.zone, null);
    assert.equal(D.actionModel(view(20000, front), 314).marker.zone, 'red');    // +18 %, unfiltered
});


test('actionModel: none without a view', () => {
    assert.deepEqual(D.actionModel(null, 250), {kind: 'none'});
    assert.deepEqual(D.actionModel({mine: false, toMyPullS: null}, 250), {kind: 'none'});
});

test('actionModel: resting counts down to my pull, READY (amber) from WARN_S with my target and a neutral marker', () => {
    // Kim (60 s) pulling, me Dario (266 W) next.
    const front = {puller: '5100003', since: 0};
    let m = D.actionModel(view(49000, front), null);
    assert.deepEqual(m, {kind: 'rest', timeS: 11, warn: false, next: false, place: 2});    // next in line
    m = D.actionModel(view(50000, front), null);
    assert.deepEqual(m, {kind: 'rest', timeS: 10, warn: true, next: true, place: 2, watts: 266, marker: null});
    // With my power: the marker shows where I am, without a zone (neutral: below target is right here).
    m = D.actionModel(view(50000, front), 200, 'red');
    assert.equal(m.marker.zone, null);
    assert.ok(m.marker.pos < 0.5);
});

test('actionModel: my pull with target, time, warning and overdue', () => {
    const front = {puller: '5100002', since: 0};            // Dario, 60 s at 266 W
    let m = D.actionModel(view(20000, front), 272);
    assert.equal(m.kind, 'pull'); assert.equal(m.watts, 266);
    assert.equal(m.timeS, 40); assert.equal(m.over, false); assert.equal(m.warn, false);
    assert.equal(m.marker.zone, 'green');
    m = D.actionModel(view(50000, front), 314);
    assert.equal(m.timeS, 10); assert.equal(m.warn, true); assert.equal(m.over, false);
    assert.equal(m.marker.zone, 'red'); assert.equal(m.marker.pos, 1);    // +18 %: beyond the bar's 15 %
    m = D.actionModel(view(65000, front), null);
    assert.equal(m.timeS, 5); assert.equal(m.over, true); assert.equal(m.warn, true);
    assert.equal(m.watts, 266); assert.equal(m.marker, null);   // target known, no power yet
});

test('actionModel: no target watts means no bar', () => {
    const {plan} = P.importFiles([json]);                    // JSON only: no watts
    const v = R.rotationView(plan, {selfId: '5100002', chainIds: [], wheelId: null,
                                    front: {puller: '5100002', since: 0}, now: 1000});
    const m = D.actionModel(v, 260);
    assert.equal(m.kind, 'pull'); assert.equal(m.watts, null); assert.equal(m.marker, null);
    assert.equal(m.timeS, 59);
});

test('formatTarget: watts, W/kg with one decimal, W fallback without a weight', () => {
    assert.deepEqual(D.formatTarget(266, 64.2, 'W'), {value: '266', unit: 'W'});
    assert.deepEqual(D.formatTarget(266, 64.2, 'Wkg'), {value: '4.1', unit: 'W/kg'});
    assert.deepEqual(D.formatTarget(338, 71, 'Wkg'), {value: '4.8', unit: 'W/kg'});    // 4.761
    assert.deepEqual(D.formatTarget(266, null, 'Wkg'), {value: '266', unit: 'W'});
    assert.deepEqual(D.formatTarget(266, undefined, 'Wkg'), {value: '266', unit: 'W'});
    assert.deepEqual(D.formatTarget(266, 0, 'Wkg'), {value: '266', unit: 'W'});
    assert.deepEqual(D.formatTarget(266, -60, 'Wkg'), {value: '266', unit: 'W'});
    assert.deepEqual(D.formatTarget(266, NaN, 'Wkg'), {value: '266', unit: 'W'});
});

test('pickWeight: the first usable weight in order', () => {
    assert.equal(D.pickWeight(64.2, 80, 72), 64.2);
    assert.equal(D.pickWeight(undefined, 80, 72), 80);
    assert.equal(D.pickWeight(null, 0, 72), 72);
    assert.equal(D.pickWeight(null, -1, NaN), null);
    assert.equal(D.pickWeight(), null);
});

test('youText: pull time, watts and W/kg (live weight, plan weight as the fallback)', async () => {
    const {youText} = await import('../pages/src/youline.mjs');
    const {plan} = P.importFiles([json, txt]);
    const me = '5100002';    // Dario, #4, 60 s at 266 W, plan weight from the JSON
    const planKg = plan.riders.find(r => r.id === me).weight;
    assert.equal(youText(plan, me, {weight: 64.2}), 'You are Dario Brandl [KFR] · #4 · 60s@4.1W/kg');
    assert.equal(youText(plan, me, {weight: 64.2, unit: 'W'}), 'You are Dario Brandl [KFR] · #4 · 60s@266W');
    assert.equal(youText(plan, me),
                 `You are Dario Brandl [KFR] · #4 · 60s@${(266 / planKg).toFixed(1)}W/kg`);
    const noWeight = {...plan, riders: plan.riders.map(r => ({...r, weight: 0}))};
    assert.equal(youText(noWeight, me), 'You are Dario Brandl [KFR] · #4 · 60s@266W');
    const noWatts = {...plan, riders: plan.riders.map(r => ({...r, watts: null}))};
    assert.equal(youText(noWatts, me, {weight: 64.2}), 'You are Dario Brandl [KFR] · #4 · 60s');
});


test('youParts: name part and pull part, pull empty when not riding', async () => {
    const {youParts} = await import('../pages/src/youline.mjs');
    const {plan} = P.importFiles([json, txt]);
    assert.deepEqual(youParts(plan, '5100002', {weight: 64.2}),
                     {head: 'You are Dario Brandl [KFR] · #4', pull: '60s@4.1W/kg', position: 4});
    assert.equal(youParts(plan, '1').pull, '');
    // a rider only in the planner's roster (role 'bench') reads as one not in the plan
    const pool = plan.bench[0].id;
    assert.equal(P.findMe(plan, pool).role, 'bench');
    assert.deepEqual(youParts(plan, pool), youParts(plan, '1'));
    assert.deepEqual(youParts(plan, pool), {head: 'You are not in this plan.', pull: '', position: null});
    assert.ok(!youParts(plan, '5100002', {weight: 64.2, bare: true}).pull.includes('W'));
});


test('shownModel: what the windows showed, compact, for the recorder', () => {
    const a = {id: 'a'}, b = {id: 'b'};
    const wheel = {planned: a, live: null};
    // Resting, 42 s to my pull, third in the line; captain line live.
    assert.deepEqual(D.shownModel({m: {kind: 'rest', timeS: 42, place: 3, warn: false}, dash: 'none', meanW: 201.6,
                                   wheel, next: {rider: b, planned: false}}),
                     {act: {k: 'rest', t: 42, place: 3}, meanW: 202, wheel: {planned: 'a', live: null},
                      next: {id: 'b', planned: false}});
    // Next and due: the window shows NEXT, also in the last WARN_S before my pull.
    assert.equal(D.shownModel({m: {kind: 'rest', timeS: 0, place: 2}, dash: 'none'}).act.k, 'next');
    assert.deepEqual(D.shownModel({m: {kind: 'rest', timeS: 7, next: true, place: 2}, dash: 'none'}).act,
                     {k: 'next', t: 7, place: 2});
    // Pulling 5 s over, with target watts and the bar marker; planned wheel replaced live.
    assert.deepEqual(D.shownModel({m: {kind: 'pull', timeS: 5, over: true, watts: 273, marker: {pos: 0.6123, zone: 'green'}},
                                   dash: 'none', meanW: null, wheel: {planned: a, live: b}, next: null}),
                     {act: {k: 'pull', t: 5, over: true, w: 273, pos: 0.61}, meanW: null,
                      wheel: {planned: 'a', live: 'b'}, next: null});
    // No rotation: the dash the action window showed ('none' = dim dash, 'unknown' = amber ?, 'climb').
    assert.deepEqual(D.shownModel({m: {kind: 'none'}, dash: 'unknown'}).act, {k: 'unknown'});
    assert.deepEqual(D.shownModel({m: {kind: 'none'}, dash: 'climb'}).act, {k: 'climb'});
});


test('pullOnlyModel: blank while resting, armed with NEXT in the last WARN_S, the pull unchanged', () => {
    const pull = {kind: 'pull', watts: 273, timeS: 40, over: false, warn: false, marker: null};
    assert.equal(D.pullOnlyModel(pull, {watts: 273}), pull);
    assert.deepEqual(D.pullOnlyModel({kind: 'rest', timeS: 42, warn: false, next: false, place: 3}, {watts: 273}),
                     {kind: 'blank'});
    assert.deepEqual(D.pullOnlyModel({kind: 'rest', timeS: 9, warn: true, next: true, place: 2}, {watts: 273}),
                     {kind: 'armed', watts: 273, marker: null});
    const mk = {pos: 0.4, zone: null};
    assert.deepEqual(D.pullOnlyModel({kind: 'rest', timeS: 9, next: true, place: 2, watts: 273, marker: mk}, {watts: 273}),
                     {kind: 'armed', watts: 273, marker: mk});    // the live marker goes along
    assert.deepEqual(D.pullOnlyModel({kind: 'rest', timeS: 0, place: 2}, {watts: undefined}),
                     {kind: 'armed', watts: null, marker: null});    // no target watts: a big READY
    assert.deepEqual(D.pullOnlyModel({kind: 'none'}), {kind: 'blank'});    // no dash either
});


test('riderPull: one number in the unit set; watts without a weight', async () => {
    const {riderPull} = await import('../pages/src/youline.mjs');
    const r = {pullS: 30, watts: 355, weight: 80};
    assert.equal(riderPull(r), '30s@4.4W/kg');
    assert.equal(riderPull(r, null, 'W'), '30s@355W');
    assert.equal(riderPull(r, 71, 'Wkg'), '30s@5.0W/kg');                // the weight given wins
    assert.equal(riderPull({...r, weight: null}), '30s@355W');          // no weight: watts only
    assert.equal(riderPull({...r, watts: null}), '30s');
    // bare (the Info window): the number without its unit.
    assert.equal(riderPull(r, null, 'Wkg', {bare: true}), '30s@4.4');
    assert.equal(riderPull(r, null, 'W', {bare: true}), '30s@355');
    assert.equal(riderPull({...r, watts: null}, null, 'Wkg', {bare: true}), '30s');
    const {riderPullParts} = await import('../pages/src/youline.mjs');
    assert.deepEqual(riderPullParts(r), {secs: '30s', target: '4.4'});
    assert.deepEqual(riderPullParts(r, null, 'W'), {secs: '30s', target: '355'});
    assert.deepEqual(riderPullParts({...r, watts: null}), {secs: '30s', target: null});
});


test('penModel: plan #1 is armed in the start pen while no start runs (startAt null)', () => {
    const plan = {riders: [{id: 'a'}, {id: 'b'}]};
    const armed = {kind: 'rest', timeS: 0, warn: true, next: true, place: 1};
    assert.deepEqual(D.penModel({plan, selfId: 'a', reason: 'still', started: false}), armed);
    assert.equal(D.penModel({plan, selfId: 'b', reason: 'still', started: false}), null);
    assert.equal(D.penModel({plan, selfId: 'a', reason: 'still', started: true}), null, 'a stop later on');
    assert.equal(D.penModel({plan, selfId: 'a', reason: 'start', started: false}), null);
    assert.equal(D.penModel({plan: null, selfId: 'a', reason: 'still', started: false}), null);
    // The pull-only Action window shows him armed with his target.
    assert.deepEqual(D.pullOnlyModel(armed, {watts: 300}), {kind: 'armed', watts: 300, marker: null});
});


test('restClock: seconds below REST_SECS_MAX, m:ss from there; pullSecs: whole seconds', () => {
    assert.equal(D.restClock(26.7), '26s');
    assert.equal(D.restClock(99), '99s');
    assert.equal(D.restClock(100), '1:40');
    assert.equal(D.restClock(347), '5:47');
    assert.equal(D.pullSecs(102.9), '102');
    assert.equal(D.pullSecs(-1), '0');
});


test('nowValue: my smoothed power in the target\'s unit and weight, null without power', () => {
    assert.equal(D.nowValue(287.4, 72, 'Wkg'), '4.0');
    assert.equal(D.nowValue(287.4, 72, 'W'), '287');
    assert.equal(D.nowValue(287.4, null, 'Wkg'), '287');       // no weight: watts, like the target
    assert.equal(D.nowValue(null, 72, 'Wkg'), null);
});


test('actionModel and shownModel: the standing clock, not in READY', () => {
    const base = {mine: false, toMyPullS: 57, place: 3, standing: true, overS: 12, me: {watts: 254}};
    const m = D.actionModel(base, null);
    assert.equal(m.kind, 'rest'); assert.equal(m.standing, true); assert.equal(m.overS, 12);
    assert.deepEqual(D.shownModel({m, dash: 'none'}).act, {k: 'rest', t: 57, place: 3, s: 1, o: 12});
    // In READY (10 s or less) it is READY, not a standing clock.
    const r = D.actionModel({...base, toMyPullS: 0, place: 2}, null);
    assert.equal(r.next, true); assert.equal(r.standing, undefined);
    // Running: no extra keys (the recording keeps its shape).
    const run = D.actionModel({...base, standing: false, overS: 0}, null);
    assert.deepEqual(run, {kind: 'rest', timeS: 57, warn: false, next: false, place: 3});
});


test('shownModel: a correction under the clock is recorded as c: {k, d}', () => {
    const m = {kind: 'rest', timeS: 120, warn: false, next: false, place: 3,
               correction: {kind: 'out', deltaS: -70, ids: ['5100004'], until: 5000}};
    assert.deepEqual(D.shownModel({m, dash: 'none'}).act, {k: 'rest', t: 120, place: 3, c: {k: 'out', d: -70}});
    assert.deepEqual(D.shownModel({m: {...m, correction: null}, dash: 'none'}).act, {k: 'rest', t: 120, place: 3});
});


// ---------- pull_wkg (spec §7.8) ----------

test('riderTarget: pull_wkg wins in W/kg, watts / weight without it', () => {
    const r = {pullS: 60, watts: 325, weight: 80, wkg: 4.2};
    assert.deepEqual(D.riderTarget(r, null, 'Wkg'), {value: '4.2', unit: 'W/kg'});
    assert.deepEqual(D.riderTarget(r, 71, 'Wkg'), {value: '4.2', unit: 'W/kg'});    // my Zwift weight changes nothing
    assert.deepEqual(D.riderTarget({...r, wkg: null}, null, 'Wkg'), {value: '4.1', unit: 'W/kg'});   // 4.0625
    assert.deepEqual(D.riderTarget({...r, wkg: null}, 71, 'Wkg'), {value: '4.6', unit: 'W/kg'});     // 4.577
    assert.deepEqual(D.riderTarget(r, null, 'W'), {value: '325', unit: 'W'});
    assert.deepEqual(D.riderTarget({...r, weight: null}, null, 'Wkg'), {value: '4.2', unit: 'W/kg'});  // needs no weight
    assert.deepEqual(D.riderTarget({...r, wkg: null, weight: null}, null, 'Wkg'), {value: '325', unit: 'W'});
    assert.deepEqual(D.riderTarget({...r, wkg: 4.25}, null, 'Wkg'), {value: '4.3', unit: 'W/kg'});
    assert.deepEqual(D.riderTarget({...r, wkg: 4.04}, null, 'Wkg'), {value: '4.0', unit: 'W/kg'});
    assert.deepEqual(D.riderTarget({...r, wkg: 0}, null, 'Wkg'), {value: '4.1', unit: 'W/kg'});
    assert.equal(D.riderTarget({...r, watts: null}, null, 'Wkg'), null);
    assert.equal(D.riderTarget(null, null, 'Wkg'), null);
});

test('barTarget: pull_wkg × weight in W/kg mode', () => {
    const r = {pullS: 60, watts: 325, weight: 80, wkg: 4.2};
    assert.equal(D.barTarget(r, 80, 'Wkg'), 336);
    assert.equal(D.barTarget(r, null, 'Wkg'), 336);                        // the plan's weight is the fallback
    assert.ok(Math.abs(D.barTarget(r, 71, 'Wkg') - 298.2) < 1e-9);
    assert.equal(D.barTarget({...r, weight: null}, null, 'Wkg'), 325);     // no weight at all
    assert.equal(D.barTarget(r, 71, 'W'), 325);
    assert.equal(D.barTarget({...r, wkg: null}, 71, 'Wkg'), 325);
    assert.equal(D.barTarget({...r, watts: null}, 80, 'Wkg'), null);
    assert.equal(D.barTarget(null, 80, 'Wkg'), null);
});

test('the bar follows live W/kg', () => {
    const r = {pullS: 60, watts: 325, weight: 80, wkg: 4.2};
    const t = D.barTarget(r, 71, 'Wkg');
    const on = R.powerBar(298.2, t);                     // live 4.2 W/kg: on target
    assert.equal(on.zone, 'green');
    assert.ok(Math.abs(on.pos - 0.5) < 1e-9);
    // +9.0 %: 325 W is the plan's watts, but my Zwift weight (71 kg) is below the plan's 80 kg
    assert.equal(R.powerBar(325, t).zone, 'amber');
    assert.deepEqual(R.powerBar(325, D.barTarget(r, 71, 'W')), {pos: 0.5, zone: 'green'});
});

test('actionModel: barW moves the bar, not the target', () => {
    const front = {puller: '5100002', since: 0};    // Dario, 266 W
    const m = D.actionModel(view(20000, front), 272, undefined, {barW: 314});
    assert.equal(m.kind, 'pull');
    assert.equal(m.watts, 266);
    assert.equal(m.marker.zone, 'red');             // −13.4 %
    assert.equal(D.actionModel(view(20000, front), 272, undefined).marker.zone, 'green');
    assert.equal(D.actionModel(view(20000, front), 272, undefined, {barW: null}).marker.zone, 'green');
    // READY: the same bar target
    const ready = D.actionModel(view(55000, {puller: '5100003', since: 0}), 272, undefined, {barW: 314});   // 5 s to my pull
    assert.equal(ready.kind, 'rest');
    assert.equal(ready.next, true);
    assert.equal(ready.watts, 266);
    assert.ok(Math.abs(ready.marker.pos - R.powerBar(272, 314).pos) < 1e-9);
    assert.equal(ready.marker.zone, null);          // READY stays neutral
});

test('riderPull and riderPullParts with pull_wkg', async () => {
    const {riderPull, riderPullParts} = await import('../pages/src/youline.mjs');
    const r = {pullS: 60, watts: 325, weight: 80, wkg: 4.2};
    assert.equal(riderPull(r), '60s@4.2W/kg');
    assert.equal(riderPull(r, 71), '60s@4.2W/kg');
    assert.equal(riderPull({...r, wkg: null}), '60s@4.1W/kg');
    assert.equal(riderPull({...r, wkg: null}, 71), '60s@4.6W/kg');
    assert.equal(riderPull(r, null, 'W'), '60s@325W');
    assert.equal(riderPull(r, null, 'Wkg', {bare: true}), '60s@4.2');
    assert.equal(riderPull({...r, watts: null}), '60s');
    assert.deepEqual(riderPullParts(r), {secs: '60s', target: '4.2'});
    assert.deepEqual(riderPullParts(r, null, 'W'), {secs: '60s', target: '325'});
});

test('youParts with pull_wkg from an import', async () => {
    const {youParts} = await import('../pages/src/youline.mjs');
    const copy = JSON.parse(json);
    copy.riders['5100002'].pull_wkg = 4.5;           // 266 W, 64.2 kg: 4.1 without it
    const {plan} = P.importFiles([JSON.stringify(copy), txt]);
    assert.equal(youParts(plan, '5100002', {weight: 64.2}).pull, '60s@4.5W/kg');
    assert.equal(youParts(plan, '5100002', {weight: 70}).pull, '60s@4.5W/kg');
    assert.equal(youParts(plan, '5100002', {weight: 64.2, unit: 'W'}).pull, '60s@266W');
    const plain = P.importFiles([json, txt]).plan;
    assert.equal(youParts(plain, '5100002', {weight: 70}).pull, '60s@3.8W/kg');    // 266 / 70
});


// ---------- the shown rest clock (clock.mjs) ----------

// Steps the clock once a second over truth(t) (seconds since 0), from `from` to `to` inclusive;
// returns {t: state}.
function runClock(truth, {from = 0, to, present = () => null, standing = () => false} = {}) {
    let s = C.initialClock();
    const out = {};
    for (let t = from; t <= to; t++) {
        s = C.clockStep(s, {now: t * 1000, trueS: truth(t), present: present(t), standing: standing(t)});
        out[t] = s;
    }
    return out;
}
const shownAt = (run, t) => Math.floor(run[t].shownS);


test('clockStep: in step with the rotation it shows the rotation clock, second by second', () => {
    const r = runClock(t => 200 - t, {to: 50});
    for (let t = 0; t <= 50; t++) {
        assert.equal(shownAt(r, t), 200 - t);
        assert.equal(r[t].label, null);
    }
    assert.deepEqual([C.SMALL_S, C.SNAP_BELOW_S, C.CATCH_DOWN, C.CATCH_UP, C.UP_HOLD_MS, C.LABEL_MS], [10, 15, 2, 0.5, 3000, 5000]);
});


test('clockStep: a small correction is absorbed, no jump and no label', () => {
    // At 20 s the pull comes 6 s sooner: the clock runs twice as fast until it is there.
    const down = runClock(t => (t < 20 ? 200 - t : 194 - t), {to: 40});
    assert.equal(shownAt(down, 19), 181);
    assert.deepEqual([20, 21, 22, 23, 24, 25, 26].map(t => shownAt(down, t)), [179, 177, 175, 173, 171, 169, 168]);
    assert.equal(shownAt(down, 26), 194 - 26);              // caught up after 6 s
    for (let t = 1; t <= 40; t++) {
        const step = down[t - 1].shownS - down[t].shownS;
        assert.ok(step >= 0.99 && step <= 2.01, `at ${t}: ${step}`);
        assert.equal(down[t].label, null);
    }
    // At 20 s it comes 4 s later: the clock runs at half speed until the rotation's clock is there.
    const up = runClock(t => (t < 20 ? 200 - t : 204 - t), {to: 40});
    assert.deepEqual([20, 22, 24, 26, 28].map(t => shownAt(up, t)), [180, 179, 178, 178, 176]);    // in step at 26 s
    assert.equal(shownAt(up, 30), 174);                      // 204 - 30: in step again
    assert.equal(up[25].label, null);
});


test('clockStep: a big correction sooner snaps at once and says so; later only once it holds 3 s', () => {
    const present = t => (t < 30 ? ['a', 'b', 'c'] : ['a', 'c']);
    // b drops out at 30 s: my pull comes 70 s sooner.
    const r = runClock(t => (t < 30 ? 300 - t : 230 - t), {to: 40, present});
    assert.equal(shownAt(r, 29), 271);
    assert.equal(shownAt(r, 30), 200);
    assert.equal(r[30].fadeAt, 30000);
    assert.deepEqual(r[30].label, {kind: 'out', deltaS: -70, ids: ['b'], until: 35000});
    assert.equal(C.deltaText(-70), '\u221270s');                // seconds below 100, as the clock
    assert.equal(C.deltaText(-130), '\u22122:10');
    assert.equal(r[34].label.kind, 'out');
    assert.equal(r[35].label, null);                         // 5 s
    // He comes back at 30 s (+70): the clock goes on as before for 3 s, then takes it.
    const back = runClock(t => (t < 30 ? 300 - t : 370 - t), {to: 40, present: t => (t < 30 ? ['a', 'c'] : ['a', 'b', 'c'])});
    assert.deepEqual([30, 31, 32].map(t => shownAt(back, t)), [270, 269, 268]);
    assert.equal(shownAt(back, 33), 337);
    assert.deepEqual(back[33].label, {kind: 'back', deltaS: 70, ids: ['b'], until: 38000});
    assert.equal(C.deltaText(70), '+70s');
    // No rider to blame: just the amount.
    const plain = runClock(t => (t < 30 ? 300 - t : 250 - t), {to: 31});
    assert.deepEqual([plain[30].label.kind, plain[30].label.ids, C.deltaText(plain[30].label.deltaS)], ['sooner', [], '\u221250s']);
});


test('clockStep: a flip at the front that is undone within 3 s never shows', () => {
    // 40 → 146 → 57 (a 12 Nov race): up by a round for 2 s, then down again.
    const truth = t => (t < 10 ? 50 - t : t < 12 ? 156 - t : 50 - t);
    const r = runClock(truth, {to: 20});
    for (let t = 0; t <= 20; t++) {
        assert.equal(shownAt(r, t), 50 - t, `at ${t}`);
        assert.equal(r[t].label, null);
    }
});


test('clockStep: corrections in a row add up, a net under 10 s clears the label', () => {
    const r = runClock(t => (t < 10 ? 300 - t : t < 11 ? 260 - t : 280 - t), {to: 20});
    assert.equal(r[10].label.deltaS, -40);
    assert.equal(r[14].label.deltaS, -40 + 20);              // up 20 at 11 s, taken after 3 s
    assert.equal(r[14].label.until, 19000);                  // the sum shows its 5 s
    const n = runClock(t => (t < 10 ? 300 - t : t < 11 ? 280 - t : 300 - t), {to: 20});
    assert.equal(n[10].label.deltaS, -20);
    assert.equal(n[14].label, null);                         // -20 + 20
    assert.equal(shownAt(n, 14), 286);
});


test('clockStep: near the pull it follows exactly, no label in READY, READY taken back says so', () => {
    // 40 s sooner into the last 15 s: exact, and no label in READY.
    const r = runClock(t => (t < 10 ? 60 - t : 20 - t), {to: 14});
    assert.equal(shownAt(r, 10), 10);
    assert.equal(r[10].label, null);
    // A small correction near the pull is not absorbed either.
    const s = runClock(t => (t < 5 ? 20 - t : 14 - t), {to: 8});
    assert.equal(shownAt(s, 5), 9);
    // READY (8 s) taken back: +36 at once, amber "READY off".
    const off = runClock(t => (t < 12 ? 20 - t : 56 - t), {to: 14});
    assert.equal(shownAt(off, 11), 9);
    assert.equal(shownAt(off, 12), 44);
    assert.deepEqual([off[12].label.kind, off[12].label.deltaS], ['readyOff', 36]);
});


test('clockStep: the standing clock is followed exactly; no countdown resets', () => {
    // The rotation's clock stands at 57 from 10 s to 30 s (puller over his time), then runs on.
    const truth = t => (t < 10 ? 67 - t : t < 30 ? 57 : 57 - (t - 30));
    const r = runClock(truth, {to: 40, standing: t => t >= 13 && t < 30});
    assert.deepEqual([12, 13, 20, 29, 30, 31].map(t => shownAt(r, t)), [57, 57, 57, 57, 57, 56]);
    // My pull, a pause: null resets, the next value is taken as it is.
    let s = C.clockStep(C.initialClock(), {now: 0, trueS: 100});
    s = C.clockStep(s, {now: 1000, trueS: null});
    assert.equal(s.shownS, null);
    s = C.clockStep(s, {now: 2000, trueS: 300});
    assert.deepEqual([s.shownS, s.label], [300, null]);
});


// ---------- chaos: the order does not hold (spec 2026-11-20-paceline-chaos-counter, section 4) ----------

test('shownModel: the chaos dash is recorded', () => {
    assert.equal(D.shownModel({m: {kind: 'none'}, dash: 'chaos'}).act.k, 'chaos');
    assert.deepEqual(D.shownModel({m: {kind: 'none'}, dash: 'chaos'}).act, {k: 'chaos'});
    // The captain's Next line in chaos ("Order ≠ plan", captainNext {chaos: true}), no rider id.
    assert.deepEqual(D.shownModel({m: {kind: 'none'}, dash: 'chaos', next: {chaos: true}}).next, {chaos: true});
});


test('actionModel in chaos: no countdown and no READY while resting, my pull as always', () => {
    const rest = {mine: false, toMyPullS: 42, place: 3, me: {watts: 254}};
    assert.deepEqual(D.actionModel(rest, 250, null, {chaos: true}), {kind: 'none'});
    assert.deepEqual(D.actionModel({...rest, toMyPullS: 5, place: 2}, 250, null, {chaos: true}), {kind: 'none'});
    assert.deepEqual(D.actionModel({...rest, toMyPullS: 0, place: 2, standing: true, overS: 4}, 250, null, {chaos: true}),
                     {kind: 'none'});
    const mine = {mine: true, remainingS: 30, me: {watts: 254}};
    assert.deepEqual(D.actionModel(mine, 250, 'green', {chaos: true}), D.actionModel(mine, 250, 'green'));
    assert.equal(D.actionModel(mine, 250, 'green', {chaos: true}).kind, 'pull');
    // Outside chaos READY still shows.
    assert.equal(D.actionModel({...rest, toMyPullS: 5}, 250, null).next, true);
});


test('restGapBand: in chaos the gap the rest line calls out goes into the band, with the pull\'s colours', () => {
    const gap = (o) => ({kind: 'one', id: 'b', m: 16, s: 1.3, n: 1, mine: false, behind: false, level: 'full',
                         critical: false, closing: false, ...o});
    assert.equal(D.restGapBand(null), null);
    // Someone else's early stage: not shown (the rest line shows no one else's early stage).
    assert.equal(D.restGapBand(gap({level: 'early', critical: true})), null);
    // The rest line's urgency rule (review ruling, 20 Nov 2026): a spare, non-critical gap of someone
    // else stays dim there, so no band; closing or not.
    assert.equal(D.restGapBand(gap({})), null);
    assert.equal(D.restGapBand(gap({kind: 'split', n: 2, closing: true})), null);
    // A critical gap of someone else: the pull's band texts by kind, its colours.
    assert.deepEqual(D.restGapBand(gap({critical: true})), {text: 'gapOne', critical: true, closing: false});
    assert.deepEqual(D.restGapBand(gap({kind: 'group', id: 'c', m: 30, s: 2, n: 3, critical: true, closing: true})),
                     {text: 'gapGroup', critical: true, closing: true});
    assert.equal(D.restGapBand(gap({kind: 'split', n: 2, critical: true})).text, 'gapSplit');
    // I am behind someone else's gap (cut off by it): "Gap ahead", as on the rest line, not "▼ GROUP".
    assert.deepEqual(D.restGapBand(gap({kind: 'group', id: 'c', m: 20, s: 1.6, n: 3, behind: true, critical: true})),
                     {text: 'gapInfoAhead', critical: true, closing: false});
    // My own gap (I lost the wheel), early stage and closing too: "▲ GAP", as on the rest line.
    assert.deepEqual(D.restGapBand(gap({id: 'me', m: 9, s: 1, mine: true, behind: true, level: 'early'})),
                     {text: 'gapMe', critical: false, closing: false});
    assert.deepEqual(D.restGapBand(gap({id: 'me', mine: true, behind: true, closing: true})),
                     {text: 'gapMe', critical: false, closing: true});
});


// ---------- recovery fields in the Action window (spec 2026-11-20-paceline-big-numbers, section 3) ----------

test('fieldValue: formats as in the spec table, units from strings.mjs', async () => {
    const {S} = await import('../pages/src/strings.mjs');
    assert.deepEqual(D.fieldValue('powerWkg', {power: 361}, {weight: 78.5}), {num: '4.6', unit: S.wkgUnit});
    assert.deepEqual(D.fieldValue('speed', {speed: 43.4}), {num: '43', unit: 'km/h'});
    assert.deepEqual(D.fieldValue('draft', {draft: 107.4}), {num: '107', unit: 'draft'});
    assert.deepEqual(D.fieldValue('cadence', {cadence: 91.6, power: 180}), {num: '92', unit: 'rpm'});
    assert.deepEqual(D.fieldValue('heartrate', {heartrate: 151.2}), {num: '151', unit: 'bpm'});
    assert.deepEqual(D.fieldValue('powerW', {power: 247.6}), {num: '248', unit: S.wattUnit});
    assert.equal(D.fieldValue('grade', {grade: 0.0312}).unit, '%');
    // the recovery field says what it is; the pull's middle field keeps its "now" (user, 22 Nov 2026)
    assert.equal(D.fieldValue('now', {}, {unit: 'W', nowW: 300}).unit, 'power');
    assert.equal(S.nowLabel, 'now');
});


test('fieldValue: grade one decimal from Sauce\'s fraction, "-0.0" shown as "0.0" (Review Focus 4)', () => {
    assert.equal(D.fieldValue('grade', {grade: -0.0004}).num, '0.0');
    assert.equal(D.fieldValue('grade', {grade: -0.031}).num, '-3.1');
    assert.equal(D.fieldValue('grade', {grade: 0}).num, '0.0');
    assert.equal(D.fieldValue('grade', {grade: 0.0449}).num, '4.5');
});


test('fieldValue: power now as the pull\'s now, in Paceline\'s unit (Review Focus 1)', () => {
    assert.equal(D.fieldValue('now', {}, {unit: 'Wkg', weight: 80, nowW: 320}).num, '4.0');
    assert.equal(D.fieldValue('now', {}, {unit: 'W', weight: 80, nowW: 320}).num, '320');
    // The same number the pull shows (nowValue of the marker's power), whatever state.power says.
    assert.equal(D.fieldValue('now', {power: 999}, {unit: 'Wkg', weight: 80, nowW: 320}).num, D.nowValue(320, 80, 'Wkg'));
    // No weight: watts, as the pull does then.
    assert.equal(D.fieldValue('now', {}, {unit: 'Wkg', weight: null, nowW: 320}).num, '320');
    assert.equal(D.fieldValue('now', {power: 300}, {unit: 'W', nowW: null}).num, null);
});


test('fieldValue: the 5 s smoothed power for W and W/kg when given', () => {
    assert.equal(D.fieldValue('powerW', {power: 400}, {smooth5W: 251.4}).num, '251');
    assert.equal(D.fieldValue('powerWkg', {power: 400}, {weight: 80, smooth5W: 256}).num, '3.2');
    assert.equal(D.fieldValue('powerW', {power: 400}, {smooth5W: null}).num, '400');
    assert.equal(D.fieldValue('powerW', {power: 0}).num, '0');    // coasting is a real 0
});


test('fieldValue: a missing value is null, never NaN or a made-up 0 (Review Focus 2)', () => {
    assert.equal(D.fieldValue('powerWkg', {power: 361}, {weight: null}).num, null);
    assert.equal(D.fieldValue('powerWkg', {power: 361}, {weight: 0}).num, null);
    assert.equal(D.fieldValue('heartrate', {}, {}).num, null);
    // Zwift sends 0 without a heart rate strap: no real heart rate.
    assert.equal(D.fieldValue('heartrate', {heartrate: 0}).num, null);
    // A cadence of 0 while pedalling (power) is a trainer without cadence; with no power I coast.
    assert.equal(D.fieldValue('cadence', {cadence: 0, power: 210}).num, null);
    assert.equal(D.fieldValue('cadence', {cadence: 0, power: 0}).num, '0');
    for (const k of ['powerW', 'powerWkg', 'draft', 'speed', 'cadence', 'heartrate', 'grade']) {
        assert.equal(D.fieldValue(k, {}, {weight: 80}).num, null, k);
        assert.equal(D.fieldValue(k, null, {weight: 80}).num, null, k);
        assert.equal(D.fieldValue(k, {power: NaN, draft: NaN, speed: NaN, cadence: NaN, heartrate: NaN, grade: NaN},
                                  {weight: 80}).num, null, k);
    }
    assert.equal(D.fieldValue('now', {}, {unit: 'W', nowW: NaN}).num, null);
});


test('recoveryFields: three slots, Off keeps its place as null', () => {
    const data = {power: 250, draft: 96, speed: 42.6, cadence: 88, heartrate: 142, grade: 0.012};
    const opts = {unit: 'Wkg', weight: 80, nowW: 248, smooth5W: null};
    const f = D.recoveryFields({left: 'off', mid: 'now', right: 'off'}, data, opts);
    assert.equal(f.length, 3);
    assert.equal(f[0], null);
    assert.deepEqual(f[1], D.fieldValue('now', data, opts));
    assert.equal(f[1].num, '3.1');
    assert.equal(f[2], null);
    assert.deepEqual(D.recoveryFields({left: 'powerWkg', mid: 'now', right: 'draft'}, data, opts).map(x => x && x.num),
                     ['3.1', '3.1', '96']);
    // An unknown choice (an older or broken setting) is an empty slot, not an error.
    assert.deepEqual(D.recoveryFields({left: 'gear', mid: undefined, right: 'heartrate'}, data, opts).map(x => x && x.num),
                     [null, null, '142']);
});


test('clockInFields: the countdown is a field only with the option on, no Rest window that has it, and not in chaos (user, 23 Nov 2026)', () => {
    const rest = {kind: 'rest', timeS: 42, warn: false, next: false, place: 3};
    const alone = {recFields: true, restOpen: false, reason: 'ok', model: rest};
    assert.equal(D.clockInFields(alone), true);
    assert.equal(D.clockInFields({...alone, restOpen: true}), false);    // the Rest window has it
    assert.equal(D.clockInFields({...alone, recFields: false}), false);    // the big countdown as before
    assert.equal(D.clockInFields({...alone, model: {kind: 'none'}, reason: 'chaos'}), false);    // no countdown in chaos
    assert.equal(D.clockInFields({...alone, model: {kind: 'none'}, reason: 'climb'}), true);    // the dash in its place
    assert.equal(D.clockInFields({...alone, model: {...rest, timeS: 8, warn: true, next: true}}), false);    // READY: the pull layout
    assert.equal(D.clockInFields({...alone, model: {kind: 'pull', watts: 273, timeS: 40}}), false);
    assert.equal(D.clockInFields({...alone, model: {kind: 'none'}, reason: 'noevent'}), false);
});


test('clockField: the number on top, my place under it, no "s" (user, 23 Nov 2026)', () => {
    assert.deepEqual(D.clockField({kind: 'rest', timeS: 13.4, place: 2}), {num: '13', unit: '', place: '#2'});
    assert.deepEqual(D.clockField({kind: 'rest', timeS: 239, place: 6}), {num: '3:59', unit: '', place: '#6'});
    assert.deepEqual(D.clockField({kind: 'rest', timeS: 44, place: 4, standing: true, overS: 50}), {num: '\u226544', unit: '', place: '#4'});
    assert.deepEqual(D.clockField({kind: 'rest', timeS: 30, place: null}), {num: '30', unit: '', place: ''});
    // From 10:00 a standing clock goes without "≥" (too wide for the field); it is still dimmed.
    assert.deepEqual(D.clockField({kind: 'rest', timeS: 599, place: 5, standing: true}), {num: '\u22659:59', unit: '', place: '#5'});
    assert.deepEqual(D.clockField({kind: 'rest', timeS: 647, place: 5, standing: true}), {num: '10:47', unit: '', place: '#5'});
    assert.equal(D.clockField({kind: 'none'}), null);
    assert.equal(D.clockField({kind: 'pull', timeS: 40}), null);
    assert.equal(D.clockField(null), null);
});


test('fieldSlots: the slots set while the option is on, the defaults (off, now, off) otherwise', () => {
    assert.deepEqual(D.fieldSlots({}), {left: 'off', mid: 'now', right: 'off'});
    assert.deepEqual(D.fieldSlots({recFields: false, recLeft: 'powerWkg', recMid: 'speed', recRight: 'draft'}),
                     {left: 'off', mid: 'now', right: 'off'});
    assert.deepEqual(D.fieldSlots({recFields: true, recLeft: 'powerWkg', recMid: 'speed', recRight: 'draft'}),
                     {left: 'powerWkg', mid: 'speed', right: 'draft'});
    // Unset or unknown values fall back to each slot's default.
    assert.deepEqual(D.fieldSlots({recFields: true, recLeft: 'draft'}), {left: 'draft', mid: 'now', right: 'off'});
    assert.deepEqual(D.fieldSlots({recFields: true, recLeft: 'gear', recMid: '', recRight: null}),
                     {left: 'off', mid: 'now', right: 'off'});
});


test('fieldsShown: only while I rest with the option on; in chaos always (Review Focus 3)', () => {
    const rest = {kind: 'rest', timeS: 42, warn: false, next: false, place: 3};
    const on = {recFields: true, restOpen: true, reason: 'ok'};
    assert.equal(D.fieldsShown({...on, model: rest}), true);
    // Without a Rest window too (user, 23 Nov 2026): the countdown is then one of them (clockInFields).
    assert.equal(D.fieldsShown({...on, restOpen: false, model: rest}), true);
    assert.equal(D.fieldsShown({...on, recFields: false, model: rest}), false);
    assert.equal(D.fieldsShown({...on, recFields: false, restOpen: false, model: rest}), false);
    // The standing clock is resting too.
    assert.equal(D.fieldsShown({...on, model: {...rest, timeS: 30, standing: true, overS: 4}}), true);
    // READY (also the start rider in the pen) and my pull: the pull layout, whatever is set.
    assert.equal(D.fieldsShown({...on, model: {...rest, timeS: 8, warn: true, next: true}}), false);
    assert.equal(D.fieldsShown({...on, model: {kind: 'rest', timeS: 0, warn: true, next: true, place: 1}, reason: 'still'}), false);
    assert.equal(D.fieldsShown({...on, model: {kind: 'pull', watts: 273, timeS: 40}}), false);
    // A dash (climb, descent, …): the fields keep showing live values.
    assert.equal(D.fieldsShown({...on, model: {kind: 'none'}, reason: 'climb'}), true);
    assert.equal(D.fieldsShown({...on, model: {kind: 'none'}, reason: 'descent'}), true);
    assert.equal(D.fieldsShown({...on, restOpen: false, model: {kind: 'none'}, reason: 'climb'}), true);
    // Outside a TTT event (the windows are quiet): nothing.
    assert.equal(D.fieldsShown({...on, model: {kind: 'none'}, reason: 'noevent'}), false);
});


test('W2: a Rest window takes the countdown only while it shows one', () => {
    // Probe s9-restopen: opened mid-rest, the Rest window was blank 1.5 s (then late) while the
    // Action window had already handed it the countdown because it was open.
    const rest = {kind: 'rest', timeS: 42};
    assert.equal(D.restTakes({restOpen: true, restShown: false, model: rest}), false);
    assert.equal(D.restTakes({restOpen: true, restShown: true, model: rest}), true);
    assert.equal(D.restTakes({restOpen: false, restShown: true, model: rest}), false);
    // READY (next: the last seconds before my pull) is a countdown too: the same rule.
    const ready = {kind: 'rest', next: true, timeS: 5};
    assert.equal(D.restTakes({restOpen: true, restShown: false, model: ready}), false);
    assert.equal(D.restTakes({restOpen: true, restShown: true, model: ready}), true);
    // A dash (Review Focus 3: climb, descent, chaos): an open Rest window is enough, as before.
    assert.equal(D.restTakes({restOpen: true, restShown: false, model: {kind: 'none'}}), true);
    // What the Rest window says about itself: its countdown or READY, never while it vanishes.
    assert.equal(D.restClockOf({vanish: false, model: {kind: 'rest', timeS: 9}}), true);
    assert.equal(D.restClockOf({vanish: true, model: {kind: 'rest', timeS: 9}}), false);
    assert.equal(D.restClockOf({vanish: false, model: {kind: 'none'}}), false);
});


test('I-1: the countdown goes back to a Rest window that showed what the Action window showed', () => {
    // Final review, 21 Nov 2026 (I-1, probe t1/t2): at every end of my pull, and at the first
    // countdown, the Action window showed the countdown for 129-181 ms (with "Fields while resting"
    // on: countdown, then the fields), because the Rest window's sign of life still said "no clock"
    // (vanished for my pull, or the dash) when the Action window rendered first.
    // What the Rest window shows, for its sign of life:
    assert.equal(D.restShowsOf({vanish: true, model: {kind: 'pull', timeS: 30}}), 'pull');
    assert.equal(D.restShowsOf({vanish: true, model: {kind: 'rest', next: true, timeS: 5}}), 'ready');
    assert.equal(D.restShowsOf({vanish: false, model: {kind: 'rest', timeS: 42}}), 'clock');
    assert.equal(D.restShowsOf({vanish: false, model: {kind: 'rest', next: true, timeS: 5}}), 'clock');
    assert.equal(D.restShowsOf({vanish: false, model: {kind: 'none'}}), 'dash');
    assert.equal(D.restShowsOf({vanish: false, model: {kind: 'blank'}}), null);
    assert.equal(D.restShowsOf({vanish: false, model: null}), null);
    // What the Action window shows (its own model):
    assert.equal(D.actionPhase({kind: 'pull', timeS: 30}), 'pull');
    assert.equal(D.actionPhase({kind: 'rest', timeS: 42}), 'clock');
    assert.equal(D.actionPhase({kind: 'rest', next: true, timeS: 5}), 'ready');
    assert.equal(D.actionPhase({kind: 'rest', timeS: 0}), 'ready');
    assert.equal(D.actionPhase({kind: 'none'}), 'dash');
    assert.equal(D.actionPhase({kind: 'armed'}), null);
    // The phase and when it changed (prev: the one before).
    let ph = D.phaseStep(null, {phase: 'pull', now: 1000});
    assert.deepEqual(ph, {phase: 'pull', prev: null, at: 1000});
    assert.equal(D.phaseStep(ph, {phase: 'pull', now: 2000}), ph);
    ph = D.phaseStep(ph, {phase: 'clock', now: 30000});
    assert.deepEqual(ph, {phase: 'clock', prev: 'pull', at: 30000});
    // The hand-back: a Rest window that shows what I showed until just now takes the countdown, for
    // REST_HANDBACK_MS after my change; after that only one that shows the countdown.
    assert.equal(D.REST_HANDBACK_MS, 1000);
    const back = (shows, now) => D.restHandBack({shows: new Set(shows), phase: ph, now});
    assert.equal(back(['pull'], 30000), true, 'pull end');
    assert.equal(back(['pull'], 30000 + D.REST_HANDBACK_MS - 1), true);
    assert.equal(back(['pull'], 30000 + D.REST_HANDBACK_MS), false, 'it never showed the countdown');
    assert.equal(back(['dash'], 30000), false, 'it showed a dash during my pull: not in step');
    assert.equal(back([], 30000), false);
    const dashEnd = {phase: 'clock', prev: 'dash', at: 30000};
    assert.equal(D.restHandBack({shows: new Set(['dash']), phase: dashEnd, now: 30100}), true, 'dash end, first countdown');
    assert.equal(D.restHandBack({shows: new Set(['pull']), phase: dashEnd, now: 30100}), false);
    const readyOff = {phase: 'clock', prev: 'ready', at: 30000};
    assert.equal(D.restHandBack({shows: new Set(['ready']), phase: readyOff, now: 30100}), true, 'READY off');
    assert.equal(D.restHandBack({shows: new Set(['pull']), phase: null, now: 30100}), false);
    // restTakes with it.
    const rest = {kind: 'rest', timeS: 42};
    assert.equal(D.restTakes({restOpen: true, restShown: false, handBack: true, model: rest}), true);
    assert.equal(D.restTakes({restOpen: true, restShown: false, handBack: false, model: rest}), false);
    assert.equal(D.restTakes({restOpen: false, restShown: false, handBack: true, model: rest}), false);
    // s9-restopen stays fixed: a Rest window opened mid-rest (nothing shown yet, or a dash of its own
    // while I show the countdown for long) does not take it.
    const steady = {phase: 'clock', prev: 'dash', at: 1000};
    assert.equal(D.restHandBack({shows: new Set(['dash']), phase: steady, now: 60000}), false);
    assert.equal(D.restHandBack({shows: new Set([null]), phase: steady, now: 1100}), false);
});


test('fieldsShown in chaos: resting shows the fields with or without a Rest window, my pull as always', () => {
    // Replaces the chaos counter's power-only model (chaosModel): actionModel gives 'none' while I
    // rest in chaos; the Action window then shows the fields, the defaults when the option is off.
    const view = {mine: false, toMyPullS: 42, place: 3, me: {watts: 254}};
    const m = D.actionModel(view, 250, null, {chaos: true});
    for (const restOpen of [false, true]) {
        for (const recFields of [false, true]) {
            assert.equal(D.fieldsShown({recFields, restOpen, model: m, reason: 'chaos'}), true, `${restOpen} ${recFields}`);
        }
    }
    // Near my pull in chaos there is no READY either: still the fields.
    assert.equal(D.fieldsShown({recFields: false, restOpen: false, reason: 'chaos',
                                model: D.actionModel({...view, toMyPullS: 5}, 250, null, {chaos: true})}), true);
    // My pull in chaos: the pull.
    const pull = D.actionModel({mine: true, remainingS: 30, me: {watts: 254}}, 250, 'green', {chaos: true});
    assert.equal(D.fieldsShown({recFields: true, restOpen: true, model: pull, reason: 'chaos'}), false);
    // recFields off in chaos: the default slots, my power now in the middle in Paceline's unit.
    const f = D.recoveryFields(D.fieldSlots({recFields: false, recLeft: 'draft'}), {power: 400},
                               {unit: 'W', weight: 80, nowW: 300});
    assert.deepEqual(f.map(x => x && x.num), [null, '300', null]);
    assert.equal('chaosModel' in D, false);
});


test('smooth5: Sauce\'s 5 s power when it has one, else the 5 s mean of my own samples; null when off', () => {
    const now = 100000;
    const hist = [90, 95, 96, 97, 98, 99, 100].map((s, i) => ({t: s * 1000, w: [500, 500, 200, 210, 220, 230, 240][i]}));
    assert.equal(D.smooth5({on: false, sauce: 260, hist, now}), null);
    assert.equal(D.smooth5({on: true, sauce: 260, hist, now}), 260);
    // The samples of the last 5 s (96 to 100 s): 200..240, mean 220; the 500s are older.
    assert.equal(D.smooth5({on: true, sauce: undefined, hist, now}), 220);
    assert.equal(D.smooth5({on: true, sauce: NaN, hist, now}), 220);
    // No sample in the last 5 s: nothing.
    assert.equal(D.smooth5({on: true, sauce: null, hist, now: 120000}), null);
    assert.equal(D.smooth5({on: true, sauce: null, hist: [], now}), null);
});


test('labelParts: the label may be cut, the minus before the gap stays with it (real strings)', async () => {
    const {S, fmt} = await import('../pages/src/strings.mjs');
    // A split behind someone else: "12 riders −14 m"; the minus is the strings' own.
    assert.deepEqual(D.labelParts('gapInfoSplit', {n: 12, gap: '14 m'}), {pre: '', cut: '12 riders ', post: '−14 m'});
    const p = D.labelParts('gapInfoSplit', {n: 12, gap: '14 m'});
    assert.equal(p.pre + p.cut + p.post, fmt('gapInfoSplit', {n: 12, gap: '14 m'}));
    // If strings.mjs changes the sign before {gap}, this must fail (the sign has to stay with the gap).
    assert.ok(S.gapInfoSplit.includes('−{gap}'), 'gapInfoSplit: the minus before {gap} changed; adapt labelParts');
    // No sign: all of the label may be cut.
    assert.deepEqual(D.labelParts('gapInfoAhead', {gap: '16 m'}), {pre: '', cut: 'Gap ahead ', post: '16 m'});
    assert.deepEqual(D.labelParts('gapMe', {gap: '9 m'}), {pre: '', cut: '▲ GAP ', post: '9 m'});
});


test('planParts: the label may be cut, " · plan CODE" never; the club after it may be cut (real strings)', async () => {
    const {fmt} = await import('../pages/src/strings.mjs');
    const one = {label: 'Thursday Night Roadtrains B · 7abcd', sig: 'HM4ZNJ'};
    assert.deepEqual(D.planParts('planLine', one), {cut: 'Thursday Night Roadtrains B · 7abcd', keep: ' · plan HM4ZNJ', tail: ''});
    const p = D.planParts('planLine', one);
    assert.equal(p.cut + p.keep + p.tail, fmt('planLine', one));
    // Two or more clubs ticked: the club follows the code, its separator goes with it.
    const two = {...one, club: 'Rollers fast'};
    assert.deepEqual(D.planParts('planLineClub', two), {cut: 'Thursday Night Roadtrains B · 7abcd', keep: ' · plan HM4ZNJ', tail: ' · Rollers fast'});
    const q = D.planParts('planLineClub', two);
    assert.equal(q.cut + q.keep + q.tail, fmt('planLineClub', two));
});


test('fieldsGapBand: the gap band under the recovery fields only in chaos (the Rest window shows it otherwise)', () => {
    const g = {kind: 'one', id: 'b', m: 16, s: 1.3, n: 1, mine: false, behind: false, level: 'full', critical: true, closing: false};
    assert.deepEqual(D.fieldsGapBand(g, 'chaos'), D.restGapBand(g));
    assert.deepEqual(D.fieldsGapBand(g, 'chaos'), {text: 'gapOne', critical: true, closing: false});
    // Outside chaos the fields only show with a Rest window open, whose status line has the gap.
    for (const reason of ['ok', 'climb', 'descent', 'still', 'alone']) {
        assert.equal(D.fieldsGapBand(g, reason), null, reason);
    }
    assert.equal(D.fieldsGapBand({...g, mine: true, behind: true}, 'ok'), null);
    assert.equal(D.fieldsGapBand(null, 'chaos'), null);
});


test('W12: the DEMO badge hides while the Rest window has vanished', () => {
    // 20 Nov 2026 audit (W12, s7-demo): the badge stayed on over the empty Action window.
    assert.equal(D.demoBadge({demo: true, vanish: true}), false);
    assert.equal(D.demoBadge({demo: true, vanish: false}), true);
    assert.equal(D.demoBadge({demo: false, vanish: false}), false);
    assert.equal(D.demoBadge({demo: false, vanish: true}), false);
});


test('vanishes: quiet outside a TTT hides every window; otherwise only the Rest window\'s pull/READY rule', () => {
    for (const mode of ['info', 'action', 'rest']) {
        assert.equal(D.vanishes({mode, quiet: true}), true, mode);
        assert.equal(D.vanishes({mode, quiet: true, model: {kind: 'rest', timeS: 40}}), true, mode);
        assert.equal(D.vanishes({mode, quiet: false}), false, mode);
    }
    // the Rest window's own rule, unchanged (user, 13 Nov 2026)
    assert.equal(D.vanishes({mode: 'rest', quiet: false, model: {kind: 'pull'}}), true);
    assert.equal(D.vanishes({mode: 'rest', quiet: false, model: {kind: 'rest', next: true}, actionOpen: true}), true);
    assert.equal(D.vanishes({mode: 'rest', quiet: false, model: {kind: 'rest', timeS: 0}, actionOpen: true}), true);
    assert.equal(D.vanishes({mode: 'rest', quiet: false, model: {kind: 'rest', next: true}, actionOpen: false}), false);
    assert.equal(D.vanishes({mode: 'rest', quiet: false, model: {kind: 'rest', timeS: 40}, actionOpen: true}), false);
    // the Action and Info windows never vanish outside the quiet state
    assert.equal(D.vanishes({mode: 'action', quiet: false, model: {kind: 'pull'}}), false);
    assert.equal(D.vanishes({mode: 'info', quiet: false, model: {kind: 'pull'}}), false);
});
