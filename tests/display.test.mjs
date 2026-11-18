// Run with: node --test tests/display.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as P from '../pages/src/engine/plan.mjs';
import * as R from '../pages/src/engine/rotation.mjs';
import * as D from '../pages/src/engine/display.mjs';

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


test('penModel: plan #1 is armed in the start pen, before the first start only', () => {
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
