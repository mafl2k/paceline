// Run with: node --test tests/recording.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../pages/src/engine/recording.mjs';


function e(id, extra) {
    return {
        athleteId: id, age: 500, gap: 0, gapDistance: 0,
        state: {power: 250, draft: 50, speed: 43, distance: 1000, eventDistance: 900, worldTime: 1e9, heartrate: 150, cadence: 90,
                grade: 0.02, altitude: 35.5, x: 100, y: 200, roadId: 12, reverse: true, courseId: 6,
                eventSubgroupId: 0, time: 0},
        ...extra,
    };
}


test('planRidersPresent counts fresh plan riders only', () => {
    const ids = new Set(['1', '2', '3']);
    assert.equal(R.planRidersPresent([], ids), 0);
    assert.equal(R.planRidersPresent([e(1), e(2, {age: 16000}), e(9)], ids), 1);
    assert.equal(R.planRidersPresent([e(1), e(3)], ids), 2);
});

test('recStep starts at 2 riders and stops after 120 s below', () => {
    let s = R.initialRecState(), r;
    r = R.recStep(s, {now: 1000, present: 1}); assert.equal(r.action, null);
    r = R.recStep(r.state, {now: 2000, present: 2}); assert.equal(r.action, 'start'); assert.equal(r.state.sessionId, '2000');
    r = R.recStep(r.state, {now: 3000, present: 0}); assert.equal(r.action, null); assert.ok(r.state.recording);
    r = R.recStep(r.state, {now: 121999, present: 0}); assert.equal(r.action, null);   // last seen at 2000
    r = R.recStep(r.state, {now: 122000, present: 1}); assert.equal(r.action, 'stop'); assert.equal(r.state.recording, false);
});

test('recStep does not mutate its input and keeps lastSeenAt fresh while riding', () => {
    const s0 = R.initialRecState();
    const frozen = Object.freeze({...s0});
    const r1 = R.recStep(frozen, {now: 2000, present: 3});
    assert.deepEqual(s0, {recording: false, sessionId: null, lastSeenAt: null});
    assert.deepEqual(r1.state, {recording: true, sessionId: '2000', lastSeenAt: 2000});
    const r2 = R.recStep(Object.freeze({...r1.state}), {now: 9000, present: 2});
    assert.equal(r2.action, null);
    assert.deepEqual(r2.state, {recording: true, sessionId: '2000', lastSeenAt: 9000});
});

test('planIds covers riders and bench as strings', () => {
    const ids = R.planIds({riders: [{id: '1'}, {id: '2'}], bench: [{id: '3'}]});
    assert.deepEqual([...ids].sort(), ['1', '2', '3']);
});

test('selfEntry finds the self entry', () => {
    assert.equal(R.selfEntry([e(1), e(2, {self: true})]).athleteId, 2);
    assert.equal(R.selfEntry([e(1)]), null);
});

test('makeTick keeps plan riders, self and watching, flattened', () => {
    const t = R.makeTick([e(1), e(7, {self: true}), e(8), e(9, {watching: true})], new Set(['1']), 5);
    assert.deepEqual(t.riders.map(x => x.id), ['1', '7', '9']);
    assert.equal(t.selfId, '7'); assert.equal(t.watchingId, '9'); assert.equal(t.wt, 1e9);
    assert.equal(t.riders[0].power, 250); assert.equal(t.riders[0].draft, 50);
});

test('makeTick row shape and missing self', () => {
    const t = R.makeTick([e(1, {gap: 3.5, gapDistance: 40, isGapEst: true, eventSubgroupId: 77})], new Set(['1']), 5);
    assert.equal(t.ts, 5); assert.equal(t.wt, null); assert.equal(t.selfId, null); assert.equal(t.watchingId, null);
    assert.deepEqual(t.riders[0], {
        id: '1', self: false, watching: false, inPlan: true, age: 500, gap: 3.5, gapDistance: 40, isGapEst: true, eventSubgroupId: 77,
        sgRaw: 0, time: 0, eventPosition: undefined, eventParticipants: undefined,
        power: 250, draft: 50, speed: 43, distance: 1000, eventDistance: 900, worldTime: 1e9, heartrate: 150, cadence: 90,
        grade: 0.02, altitude: 35.5, x: 100, y: 200, roadId: 12, reverse: true, courseId: 6,
    });
});

// 17 Nov 2026 (ZRL): the plan changed mid-race; the upload kept only the head plan's riders. A row
// of a rider in the current plan carries inPlan, so the upload keeps it whatever the head plan says.
test('makeTick marks riders of the current plan (starters and bench) with inPlan, not watched or fallback riders', () => {
    const me = e(7, {self: true, eventSubgroupId: 55});
    // 1 starts, 3 is on the bench, 7 (me) starts too; 9 is watched
    const ids = R.planIds({riders: [{id: '1'}, {id: '7'}], bench: [{id: '3'}]});
    const t = R.makeTick([me, e(1), e(3), e(8), e(9, {watching: true})], ids, 5);
    const flags = t => Object.fromEntries(t.riders.map(r => [r.id, Object.hasOwn(r, 'inPlan') ? r.inPlan : 'none']));
    assert.deepEqual(flags(t), {1: true, 3: true, 7: true, 9: 'none'});
    // with one plan rider near, the fallback brings in 4 of my subgroup: no flag; me outside the plan: no flag
    const few = R.makeTick([me, e(1), e(4, {gapDistance: 20, eventSubgroupId: 55}), e(9, {watching: true})],
        new Set(['1']), 5, {fallback: true});
    assert.deepEqual(flags(few), {1: true, 4: 'none', 7: 'none', 9: 'none'});
});

test('detPlanOnly: the det ids name only riders of the current plan (starters and bench) or me', () => {
    const ids = R.planIds({riders: [{id: '1'}, {id: '7'}], bench: [{id: '3'}]});
    const det = {planSig: 'ABC', puller: '1', since: 5, frontId: '3', self: 'start', view: 'rest', wheel: '9',
                 wheelObs: '8', wheelCue: '9', place: 2, chainSize: 4,
                 gap: {kind: 'one', id: '8', m: 12, s: 1.1, n: 1, mine: false, behind: false, level: 'full', closing: false}};
    const out = R.detPlanOnly(det, ids, '5');
    assert.deepEqual(R.DET_ID_FIELDS.map(k => out[k]), ['1', '3', null, null, null], 'puller, frontId, wheel, wheelObs, wheelCue');
    assert.deepEqual(out.gap, {...det.gap, id: null}, 'the gap keeps its numbers');
    // everything else as it was, the input untouched
    assert.deepEqual({...out, puller: 0, frontId: 0, wheel: 0, wheelObs: 0, wheelCue: 0, gap: 0},
                     {...det, puller: 0, frontId: 0, wheel: 0, wheelObs: 0, wheelCue: 0, gap: 0});
    assert.equal(det.wheel, '9');
    assert.equal(det.gap.id, '8');
    // me (not in the plan) stays; a plan rider's gap stays; numbers compare as strings
    const mine = R.detPlanOnly({...det, puller: '5', wheelObs: 7, gap: {...det.gap, id: '3'}}, ids, '5');
    assert.deepEqual([mine.puller, mine.wheelObs, mine.gap.id], ['5', 7, '3']);
    // nulls and a missing gap stay; no plan: only me
    assert.deepEqual(R.detPlanOnly({puller: null, frontId: undefined, gap: null}, ids, '5'),
                     {puller: null, frontId: null, gap: null});
    assert.deepEqual(R.detPlanOnly({puller: '1', frontId: '5'}, new Set(), '5'), {puller: null, frontId: '5'});
    assert.deepEqual(R.detPlanOnly({puller: '5'}, new Set(), null), {puller: null});
    assert.equal(R.detPlanOnly(null, ids, '5'), null);
});


test('detPlanOnly: det.order.out keeps only riders of the current plan or me', () => {
    const ids = new Set(['1', '2', '3']);
    const det = {puller: '1', order: {chaos: true, out: ['2', '99', '5', 7]}};
    assert.deepEqual(R.detPlanOnly(det, ids, '5').order, {chaos: true, out: ['2', '5']});
    assert.deepEqual(R.detPlanOnly({order: {chaos: false, out: []}}, ids, '5').order, {chaos: false, out: []});
    assert.deepEqual(R.detPlanOnly({order: {chaos: false, out: ['1']}}, new Set(), null).order, {chaos: false, out: []});
    assert.deepEqual(det.order.out, ['2', '99', '5', 7], 'the input is not changed');
});


test('selfSubgroupId: top-level id first, else the raw one, null outside events', () => {
    assert.equal(R.selfSubgroupId([e(1)]), null);
    assert.equal(R.selfSubgroupId([e(1, {self: true})]), null);    // raw 0, no top level
    assert.equal(R.selfSubgroupId([e(1, {self: true, state: {eventSubgroupId: 55}})]), 55);
    assert.equal(R.selfSubgroupId([e(1, {self: true, eventSubgroupId: 77, state: {eventSubgroupId: 55}})]), 77);
    assert.equal(R.selfSubgroupId(null), null);
});

test('eventSummary keeps what the event gating needs', () => {
    const sg = {eventId: 4567890, name: 'TTT: WTRL Team Time Trial - Zone 21 (MOCHA)', subgroupLabel: 'E',
                ts: 1763060400000, durationInSeconds: 0, endDistance: 41000, laps: 2, routeId: 9, courseId: 6,
                signedUp: true, allTags: ['ttt'], extra: 'dropped'};
    const ev = {id: 4567890, name: 'TTT: WTRL Team Time Trial - Zone 21', eventType: 'TEAM_TIME_TRIAL', ts: 1763060400000};
    assert.deepEqual(R.eventSummary(111, sg, ev), {
        sgId: 111, found: true, eventId: 4567890, name: 'TTT: WTRL Team Time Trial - Zone 21',
        sgName: 'TTT: WTRL Team Time Trial - Zone 21 (MOCHA)', label: 'E', eventType: 'TEAM_TIME_TRIAL',
        start: 1763060400000, eventStart: 1763060400000, durationInSeconds: 0, endDistance: 41000, laps: 2,
        routeId: 9, courseId: 6, signedUp: true, tags: ['ttt'],
    });
    const none = R.eventSummary(111, null, null);
    assert.equal(none.found, false); assert.equal(none.sgId, 111); assert.equal(none.name, null); assert.equal(none.start, null);
});

test('eventLogStep logs on the first tick of a session and on every change', () => {
    const a = {sgId: 1}, b = {sgId: 2};
    let r = R.eventLogStep(null, {sessionId: 's1', summary: a});
    assert.equal(r.log, true);
    r = R.eventLogStep(r.next, {sessionId: 's1', summary: {sgId: 1}});
    assert.equal(r.log, false);
    r = R.eventLogStep(r.next, {sessionId: 's1', summary: b});
    assert.equal(r.log, true);
    r = R.eventLogStep(r.next, {sessionId: 's1', summary: null});
    assert.equal(r.log, true);    // left the event
    r = R.eventLogStep(r.next, {sessionId: 's2', summary: null});
    assert.equal(r.log, true);    // new session: logged again
});

test('takeLease: one owner, takeover when stale', () => {
    assert.deepEqual(R.takeLease(null, 'a', 0), {own: true, write: {id: 'a', at: 0}});
    assert.equal(R.takeLease({id: 'a', at: 0}, 'b', 5999).own, false);
    assert.equal(R.takeLease({id: 'a', at: 0}, 'b', 5999).write, null);
    assert.equal(R.takeLease({id: 'a', at: 0}, 'b', 6000).own, true);
    assert.deepEqual(R.takeLease({id: 'a', at: 0}, 'b', 6000).write, {id: 'b', at: 6000});
    assert.deepEqual(R.takeLease({id: 'a', at: 0}, 'a', 1000), {own: true, write: null});
    assert.deepEqual(R.takeLease({id: 'a', at: 0}, 'a', 2000), {own: true, write: {id: 'a', at: 2000}});
});

test('leaseStep: two windows taking the same stale lease, only the stored one acts next step', () => {
    const stale = {id: 'old', at: 0};
    let stored = stale;
    // Both windows read the stale lease before either writes.
    const a1 = R.leaseStep(stale, 'a', 10000);
    const b1 = R.leaseStep(stale, 'b', 10010);
    assert.deepEqual(a1, {act: false, write: {id: 'a', at: 10000}});
    assert.deepEqual(b1, {act: false, write: {id: 'b', at: 10010}});
    stored = a1.write;
    stored = b1.write;    // b wrote last
    const a2 = R.leaseStep(stored, 'a', 11000);
    const b2 = R.leaseStep(stored, 'b', 11010);
    assert.equal(a2.act, false);
    assert.equal(a2.write, null);
    assert.equal(b2.act, true);
    // Exactly one window acts on the step after the race.
    assert.equal([a2.act, b2.act].filter(Boolean).length, 1);
});

test('leaseStep: a fresh lease of my own acts, a foreign or missing one does not', () => {
    assert.deepEqual(R.leaseStep(null, 'a', 0), {act: false, write: {id: 'a', at: 0}});
    assert.deepEqual(R.leaseStep({id: 'a', at: 0}, 'a', 1000), {act: true, write: null});
    assert.deepEqual(R.leaseStep({id: 'a', at: 0}, 'a', 2000), {act: true, write: {id: 'a', at: 2000}});
    assert.deepEqual(R.leaseStep({id: 'b', at: 0}, 'a', 1000), {act: false, write: null});
    assert.deepEqual(R.leaseStep({id: 'b', at: 0}, 'a', 6000), {act: false, write: {id: 'a', at: 6000}});
});

test('toJsonl and file name', () => {
    const s = R.toJsonl({planSig: 'K7Q2XM'}, [{ts: 1}, {ts: 2}]);
    const lines = s.trimEnd().split('\n').map(l => JSON.parse(l));
    assert.equal(lines[0].kind, 'paceline-recording'); assert.equal(lines.length, 3); assert.ok(s.endsWith('\n'));
    assert.equal(lines[0].v, 1); assert.equal(lines[0].planSig, 'K7Q2XM'); assert.deepEqual(lines.slice(1), [{ts: 1}, {ts: 2}]);
    assert.match(R.recordingFileName({team: 'Rollers', selfName: 'Dario Brandl [KFR]', startedAt: new Date(2026, 10, 12, 18, 0).getTime()}),
                 /^paceline-Rollers-20261112-\d{4}-Dario_Brandl__KFR_\.jsonl$/);
});

test('recordingFileName uses local time', () => {
    const d = new Date(2026, 0, 5, 7, 9);
    assert.equal(R.recordingFileName({team: 'A b', selfName: 'X', startedAt: d.getTime()}), 'paceline-A_b-20260105-0709-X.jsonl');
});

test('takeLease treats malformed or future leases as stale', () => {
    for (const bad of ['garbage', {id: 'a'}, {id: 'a', at: '5'}, {id: 'a', at: NaN}, {id: 'a', at: null}, 42]) {
        assert.deepEqual(R.takeLease(bad, 'b', 1000), {own: true, write: {id: 'b', at: 1000}}, JSON.stringify(bad));
    }
    assert.deepEqual(R.takeLease({id: 'a', at: 1000 + 60000}, 'b', 1000), {own: true, write: {id: 'b', at: 1000}});
    assert.deepEqual(R.takeLease({id: 'b', at: 1000 + 60000}, 'b', 1000), {own: true, write: {id: 'b', at: 1000}});
});

test('recStep stops on a long gap even when riders are present, then starts a new session', () => {
    let r = R.recStep({recording: true, sessionId: 'old', lastSeenAt: 1000}, {now: 1e7, present: 2});
    assert.equal(r.action, 'stop'); assert.equal(r.state.recording, false);
    r = R.recStep(r.state, {now: 1e7 + 1000, present: 2});
    assert.equal(r.action, 'start'); assert.equal(r.state.sessionId, String(1e7 + 1000)); assert.notEqual(r.state.sessionId, 'old');
});


test('recStep with the event gate: no start outside, start in the pen without teammates, stop when it shuts', () => {
    let r = R.recStep(R.initialRecState(), {now: 1000, present: 5, gate: {open: false}});
    assert.equal(r.action, null); assert.equal(r.state.recording, false);
    // The pen, no plan rider found (a plan of another team that has me in it): it records anyway.
    r = R.recStep(r.state, {now: 2000, present: 0, gate: {open: true}});
    assert.equal(r.action, 'start');
    r = R.recStep(r.state, {now: 3000, present: 2, gate: {open: true}});
    assert.equal(r.action, null);
    // Dropped, alone for 5 minutes, still in the event: keeps recording.
    for (let t = 4000; t <= 304000; t += 1000) {
        r = R.recStep(r.state, {now: t, present: 1, gate: {open: true}});
        assert.equal(r.action, null);
    }
    assert.equal(r.state.recording, true);
    r = R.recStep(r.state, {now: 305000, present: 4, gate: {open: false}});
    assert.equal(r.action, 'stop'); assert.equal(r.state.recording, false);
    // Without a gate (option off): as before.
    assert.equal(R.recStep(R.initialRecState(), {now: 1, present: 2}).action, 'start');
});


test('recStep with the event gate: no start without a plan that has me, but no stop when it goes', () => {
    let r = R.recStep(R.initialRecState(), {now: 1000, present: 0, gate: {open: true}, planned: false});
    assert.equal(r.action, null); assert.equal(r.state.recording, false);
    // The plan arrives a few seconds into the pen.
    r = R.recStep(r.state, {now: 5000, present: 3, gate: {open: true}, planned: true});
    assert.equal(r.action, 'start');
    // It goes again (taken off the server): the event is still recorded to the end.
    r = R.recStep(r.state, {now: 6000, present: 0, gate: {open: true}, planned: false});
    assert.equal(r.action, null); assert.equal(r.state.recording, true);
    r = R.recStep(r.state, {now: 7000, present: 0, gate: {open: false}, planned: false});
    assert.equal(r.action, 'stop');
    // Without a gate the plan riders decide, as before.
    assert.equal(R.recStep(R.initialRecState(), {now: 1, present: 2, planned: false}).action, 'start');
});


test('gateStep: open from my TTT subgroup until EVENT_GRACE_MS after it is gone', () => {
    const ttt = {eventType: 'TEAM_TIME_TRIAL', tags: []};
    const tagged = {eventType: 'RACE', tags: ['wtrl', 'wtrlttt']};
    assert.equal(R.isTtt(ttt), true);
    assert.equal(R.isTtt(tagged), true);
    assert.equal(R.isTtt({eventType: 'GROUP_RIDE', tags: ['zwift']}), false);
    assert.equal(R.isTtt(null), false);
    // Private TTTs: no TTT type, only the name says so.
    const named = name => ({eventType: 'GROUP_RIDE', tags: [], name});
    assert.equal(R.isTtt(named("TTT to end all TTT's - 100kms, 100% effort on Knights of the Roundabout in France")), true);
    assert.equal(R.isTtt(named('Sunday Team Time Trial')), true);
    assert.equal(R.isTtt({eventType: 'GROUP_RIDE', tags: [], name: 'Club ride', sgName: 'Club ride (ttt prep)'}), true);
    assert.equal(R.isTtt(named('Buttte Hill Climb')), false);
    assert.equal(R.isTtt(named('Sunday Social')), false);
    assert.equal(R.isTtt({eventType: 'GROUP_RIDE', tags: [], name: null}), false);
    let g = R.initialGate();
    g = R.gateStep(g, {now: 0, ev: null});
    assert.equal(g.open, false);
    g = R.gateStep(g, {now: 1000, ev: undefined});            // still asking Sauce: no change
    assert.equal(g.open, false);
    g = R.gateStep(g, {now: 2000, ev: ttt});
    assert.equal(g.open, true);
    g = R.gateStep(g, {now: 3000, ev: null});                 // a data gap
    g = R.gateStep(g, {now: 2000 + R.EVENT_GRACE_MS - 1, ev: null});
    assert.equal(g.open, true);
    g = R.gateStep(g, {now: 2000 + R.EVENT_GRACE_MS, ev: null});
    assert.equal(g.open, false);
    // Another kind of event does not open it.
    assert.equal(R.gateStep(R.initialGate(), {now: 0, ev: {eventType: 'GROUP_RIDE', tags: []}}).open, false);
});


test('gateStep: any event opens it when asked', () => {
    const ride = {eventType: 'GROUP_RIDE', tags: [], name: 'Coffee ride', eventId: 7};
    assert.equal(R.gateStep(R.initialGate(), {now: 0, ev: ride}).open, false);
    let g = R.gateStep(R.initialGate(), {now: 1000, ev: ride, any: true});
    assert.deepEqual(g, {open: true, seenAt: 1000});
    g = R.gateStep(g, {now: 2000, ev: undefined, any: true});            // still asking Sauce
    assert.equal(g.open, true);
    g = R.gateStep(g, {now: 1000 + R.EVENT_GRACE_MS - 1, ev: null, any: true});
    assert.equal(g.open, true);
    g = R.gateStep(g, {now: 1000 + R.EVENT_GRACE_MS, ev: null, any: true});
    assert.equal(g.open, false);
    assert.equal(R.gateStep(R.initialGate(), {now: 0, ev: null, any: true}).open, false);
});


test('makeTick with fallback: riders of my event subgroup within FALLBACK_RANGE_M when the plan riders are missing', () => {
    const me = e(7, {self: true, eventSubgroupId: 55});
    const near = (id, gapDistance, sg = 55) => e(id, {gapDistance, eventSubgroupId: sg});
    const list = [me, near(1, 40), near(2, -250), near(3, R.FALLBACK_RANGE_M + 1), near(4, 10, 66), near(5, 0, null)];
    // No plan rider here: the subgroup's riders near me come in (not the far one, not another subgroup).
    const t = R.makeTick(list, new Set(['99']), 5, {fallback: true});
    assert.deepEqual(t.riders.map(r => r.id).sort(), ['1', '2', '7']);
    // Without the option, or with two plan riders present: only self and the plan riders, as before.
    assert.deepEqual(R.makeTick(list, new Set(['99']), 5).riders.map(r => r.id), ['7']);
    assert.deepEqual(R.makeTick(list, new Set(['1', '2']), 5, {fallback: true}).riders.map(r => r.id).sort(), ['1', '2', '7']);
    // At most FALLBACK_MAX, the nearest.
    const many = [me, ...Array.from({length: 30}, (_, i) => near(100 + i, i * 5))];
    const m = R.makeTick(many, new Set(), 5, {fallback: true});
    assert.equal(m.riders.length, R.FALLBACK_MAX + 1);
    assert.ok(m.riders.some(r => r.id === '100') && !m.riders.some(r => r.id === '129'));
});


test('gateEv: no fresh self entry means "still asking Sauce", so a data gap never closes the gate', () => {
    const ttt = {eventType: 'TEAM_TIME_TRIAL', tags: [], eventId: 7, start: 1000};
    const me = {self: true, athleteId: 1001, state: {eventSubgroupId: 55}};
    assert.equal(R.gateEv([], null), undefined);              // stale nearby: currentNearby gives []
    assert.equal(R.gateEv(null, null), undefined);
    assert.equal(R.gateEv([{athleteId: 2002}], null), undefined);    // others, but not me
    assert.equal(R.gateEv([me], null), null);                 // me, outside events: null
    assert.equal(R.gateEv([me], ttt), ttt);
    assert.equal(R.gateEv([me], undefined), undefined);       // me, Sauce still being asked
    // Mid-race Zwift reconnects for a minute: the gate stays open and the race goes on.
    let g = R.gateStep(R.initialGate(), {now: 0, ev: R.gateEv([me], ttt)});
    for (let t = 1000; t <= 60000; t += 1000) {
        g = R.gateStep(g, {now: t, ev: R.gateEv([], null)});
    }
    assert.deepEqual(g, {open: true, seenAt: 0, heldTo: 60000, shift: 59000});
    g = R.gateStep(g, {now: 61000, ev: R.gateEv([me], ttt)});
    assert.deepEqual(g, {open: true, seenAt: 61000});
    // Back outside events with fresh data: the gate closes after the grace.
    g = R.gateStep(g, {now: 61000 + R.EVENT_GRACE_MS, ev: R.gateEv([me], null)});
    assert.equal(g.open, false);
});


test('EVENT_LOST_MS: longer than a dropout, longer than the gate grace', () => {
    assert.equal(R.EVENT_LOST_MS, 30 * 60000);
    assert.ok(R.EVENT_LOST_MS > R.EVENT_GRACE_MS && R.EVENT_LOST_MS > R.STOP_AFTER_MS);
});


test('gateEv: the hold ends after EVENT_LOST_MS without data of mine (the rider is gone)', () => {
    const open = {open: true, seenAt: 1000};
    assert.equal(R.gateEv([], null, {gate: open, now: 1000 + R.EVENT_LOST_MS - 1}), undefined);
    assert.equal(R.gateEv([], null, {gate: open, now: 1000 + R.EVENT_LOST_MS}), null);
    assert.equal(R.gateEv([], undefined, {gate: open, now: 1000 + R.EVENT_LOST_MS}), null);
    assert.equal(R.gateEv([], null, {gate: {open: false, seenAt: 1000}, now: 1e9}), undefined);
    const me = {self: true, athleteId: 1001};
    const ttt = {eventType: 'TEAM_TIME_TRIAL', sgId: 55};
    assert.equal(R.gateEv([me], ttt, {gate: open, now: 1e9}), ttt);    // fresh data decides
    // Zwift quit mid-race, Sauce stays up: the gate closes once the rider is gone.
    let g = R.gateStep(R.initialGate(), {now: 0, ev: ttt});
    for (let t = 10000; t < R.EVENT_LOST_MS; t += 10000) {
        g = R.gateStep(g, {now: t, ev: R.gateEv([], null, {gate: g, now: t})});
        assert.equal(g.open, true, String(t));
    }
    g = R.gateStep(g, {now: R.EVENT_LOST_MS, ev: R.gateEv([], null, {gate: g, now: R.EVENT_LOST_MS})});
    assert.deepEqual(g, {open: false, seenAt: 0});
});


// A race: the gate as tick() steps it (gateEv), the recorder as step() steps it (sg: the TTT
// subgroup seen). Each step 1 s; `fresh(t)` says whether Sauce has data of mine at t.
function race({until, fresh, sgAt = () => 55, steps = t => true}) {
    const ttt = sg => ({eventType: 'TEAM_TIME_TRIAL', sgId: sg});
    const me = {self: true, athleteId: 1001};
    let g = R.initialGate(), s = R.initialRecState();
    const sessions = [];
    let closedAt = null, stoppedAt = null;
    for (let t = 0; t <= until; t += 1000) {
        if (!steps(t)) {
            continue;    // no tick at all (window throttled, Sauce stalled)
        }
        const list = fresh(t) ? [me] : [];
        const summary = list.length ? (sgAt(t) === null ? null : ttt(sgAt(t))) : null;
        const ev = R.gateEv(list, summary, {gate: g, now: t});
        const was = g.open;
        g = R.gateStep(g, {now: t, ev});
        if (was && !g.open && closedAt === null) {
            closedAt = t;
        }
        const r = R.recStep(s, {now: t, present: 0, gate: g, planned: true, sg: R.isTtt(ev) ? ev.sgId : undefined});
        s = r.state;
        if (r.action === 'start') {
            sessions.push(s.sessionId);
        }
        if (r.action === 'stop' && stoppedAt === null) {
            stoppedAt = t;
        }
    }
    return {sessions, s, g, closedAt, stoppedAt};
}

test('recStep + gate: a 60 s and a 3 min Sauce gap mid-race keep one session', () => {
    for (const len of [60000, 180000]) {
        const r = race({until: 600000, fresh: t => t < 20000 || t >= 20000 + len});
        assert.equal(r.sessions.length, 1, String(len));
        assert.equal(r.s.recording, true);
        assert.equal(r.s.sg, 55);
    }
});

test('recStep + gate: 3 min without any tick in the same event keep one session', () => {
    const r = race({until: 600000, fresh: () => true, steps: t => t < 20000 || t >= 200000});
    assert.deepEqual(r.sessions, ['0']);
    assert.equal(r.s.recording, true);
});

test('recStep + gate: a gap followed by another event starts a new session', () => {
    const r = race({until: 400000, fresh: t => t < 20000 || t >= 80000, sgAt: t => (t < 80000 ? 55 : 77)});
    assert.equal(r.sessions.length, 2);
    assert.equal(r.s.sg, 77);
    // Back to back without a gap too.
    const b = race({until: 400000, fresh: () => true, sgAt: t => (t < 80000 ? 55 : 77)});
    assert.equal(b.sessions.length, 2);
});

test('recStep + gate: a gap followed by fresh data outside events ends it', () => {
    const r = race({until: 400000, fresh: t => t < 20000 || t >= 200000, sgAt: t => (t < 200000 ? 55 : null)});
    assert.equal(r.sessions.length, 1);
    assert.equal(r.s.recording, false);
});

test('recStep + gate: the long-gap bound ends it (no data, or no tick, for EVENT_LOST_MS)', () => {
    const quit = race({until: R.EVENT_LOST_MS + 60000, fresh: t => t < 20000});
    assert.equal(quit.sessions.length, 1);
    assert.equal(quit.s.recording, false);
    assert.equal(quit.g.open, false);
    // No tick for EVENT_LOST_MS (a sleeping laptop): the first step after ends it, even in the same
    // event, and the next one starts a fresh session.
    let r = R.recStep({recording: true, sessionId: 'old', lastSeenAt: 1000, sg: 55},
                      {now: 1000 + R.EVENT_LOST_MS, present: 0, gate: {open: true}, sg: 55});
    assert.equal(r.action, 'stop');
    r = R.recStep(r.state, {now: 2000 + R.EVENT_LOST_MS, present: 0, gate: {open: true}, sg: 55});
    assert.equal(r.action, 'start');
    // Just under it: same session.
    r = R.recStep({recording: true, sessionId: 'old', lastSeenAt: 1000, sg: 55},
                  {now: R.EVENT_LOST_MS, present: 0, gate: {open: true}, sg: 55});
    assert.equal(r.action, null);
    assert.equal(r.state.sessionId, 'old');
});


test('gate + recStep: finish, then Zwift quit within the grace: it closes EVENT_GRACE_MS after the finish', () => {
    // The last fresh data already showed my subgroup gone: no hold, the grace runs on.
    for (const quit of [1000, 10000, 29000]) {
        const r = race({until: 2400000, fresh: t => t < 1000000 + quit, sgAt: t => (t < 1000000 ? 55 : null)});
        assert.equal(r.closedAt, 999000 + R.EVENT_GRACE_MS, String(quit));    // last seen at 999 s
        assert.equal(r.stoppedAt, 999000 + R.EVENT_GRACE_MS);
        assert.equal(r.sessions.length, 1);
    }
});

test('gate + recStep: after a gap a short blip without my subgroup gets the whole grace', () => {
    // 60 s Sauce gap, then 3 s of fresh data without the subgroup (Zwift's few-second dropout).
    const blip = race({until: 1200000, fresh: t => t < 100000 || t >= 160000,
                       sgAt: t => (t >= 160000 && t < 163000 ? null : 55)});
    assert.equal(blip.closedAt, null);
    assert.equal(blip.sessions.length, 1);
    assert.equal(blip.s.recording, true);
    // The time without data does not count: back at 160 s without the subgroup, the gate stays
    // open while the grace (1 s before the gap, 1 s after it, counted) has not run out.
    const gone = race({until: 400000, fresh: t => t < 100000 || t >= 160000,
                       sgAt: t => (t < 100000 ? 55 : null)});
    assert.equal(gone.closedAt, 99000 + 59000 + R.EVENT_GRACE_MS);
    assert.equal(gone.sessions.length, 1);
    assert.equal(gone.s.recording, false);
});

test('gateStep: a hold does not eat the grace; once gone the grace runs on through a hold', () => {
    const ttt = {eventType: 'TEAM_TIME_TRIAL', tags: []};
    let g = R.gateStep(R.initialGate(), {now: 0, ev: ttt});
    for (let t = 1000; t <= 60000; t += 1000) {
        g = R.gateStep(g, {now: t, ev: undefined});
    }
    assert.deepEqual(g, {open: true, seenAt: 0, heldTo: 60000, shift: 59000});
    g = R.gateStep(g, {now: 61000, ev: null});
    assert.deepEqual(g, {open: true, seenAt: 0, goneAt: 59000});
    g = R.gateStep(g, {now: 59000 + R.EVENT_GRACE_MS - 1, ev: undefined});    // no data again: runs on
    assert.equal(g.open, true);
    g = R.gateStep(g, {now: 59000 + R.EVENT_GRACE_MS, ev: undefined});
    assert.deepEqual(g, {open: false, seenAt: 0});
    // The event again: clean.
    g = R.gateStep(g, {now: 100000, ev: ttt});
    assert.deepEqual(g, {open: true, seenAt: 100000});
    // A hold reaching EVENT_LOST_MS closes it in gateStep too (without gateEv's null).
    g = R.gateStep(g, {now: 100000 + R.EVENT_LOST_MS, ev: undefined});
    assert.deepEqual(g, {open: false, seenAt: 100000});
});


test('W4: leaseHeld, and a released lease is taken by the next step', () => {
    // Probe s6-close: a closed recorder left its lease, a 7 s hole until LEASE_STALE_MS ran out.
    assert.equal(R.leaseHeld({id: 'A', at: 5}, 'A'), true);
    assert.equal(R.leaseHeld({id: 'A', at: 5}, 'B'), false);
    assert.equal(R.leaseHeld(null, 'A'), false);
    assert.equal(R.leaseHeld({at: 5}, 'A'), false);
    // Released on pagehide: the next window takes it at once and records from its next step.
    assert.deepEqual(R.leaseStep(null, 'B', 10000), {act: false, write: {id: 'B', at: 10000}});
    assert.equal(R.leaseStep({id: 'B', at: 10000}, 'B', 11000).act, true);
    // Left in place: nobody else may take it until it is stale.
    assert.equal(R.takeLease({id: 'A', at: 10000}, 'B', 10000 + R.LEASE_STALE_MS - 1).own, false);
});


test('W7: recListKey changes only with recording, session or live session', () => {
    // 20 Nov 2026 audit (W7, s4-settings): every heartbeat (lastSeenAt) re-read the recordings in an open settings window.
    const k = R.recListKey({recording: true, sessionId: '5', lastSeenAt: 1}, '5');
    assert.equal(typeof k, 'string');
    assert.equal(R.recListKey({recording: true, sessionId: '5', lastSeenAt: 2}, '5'), k);
    assert.notEqual(R.recListKey({recording: false, sessionId: '5', lastSeenAt: 1}, '5'), k);
    assert.notEqual(R.recListKey({recording: true, sessionId: '6', lastSeenAt: 1}, '5'), k);
    assert.notEqual(R.recListKey({recording: true, sessionId: '5', lastSeenAt: 1}, null), k);
    assert.equal(typeof R.recListKey(null, null), 'string');
});

test('trafficStep: riders near me outside the tick, numbered, no id', () => {
    const me = e(7, {self: true, eventSubgroupId: 55});
    const list = [me, e(1, {gapDistance: -20}), e(201, {gapDistance: -40, eventSubgroupId: 55}),
                  e(202, {gapDistance: 30, eventSubgroupId: 66, state: {speed: 43.27, power: 210.6, draft: 80.4}}), e(203, {gapDistance: -101}), e(204, {gapDistance: 51})];
    const {pseudo, traffic} = R.trafficStep(null, list, new Set(['7', '1']), 1000);
    assert.equal(pseudo.epoch, 1000);
    assert.deepEqual(traffic.map(t => t.gap), [30, -40]);           // nearest first, 203/204 out of range
    assert.deepEqual(traffic.map(t => t.sg), [false, true]);
    assert.deepEqual(Object.keys(traffic[0]).sort(), ['draft', 'gap', 'n', 'power', 'sg', 'speed']);
    assert.ok(!JSON.stringify(traffic).includes('202') && !JSON.stringify(traffic).includes('201'));
    assert.deepEqual(traffic.map(t => t.n).sort(), [1, 2]);
    assert.deepEqual([traffic[0].speed, traffic[0].power, traffic[0].draft], [43.3, 211, 80]);   // 0.1 km/h, whole watts
});

test('trafficStep: the same rider keeps his number', () => {
    const me = e(7, {self: true});
    let s = R.trafficStep(null, [me, e(301, {gapDistance: -10})], new Set(['7']), 1).pseudo;
    s = R.trafficStep(s, [me, e(302, {gapDistance: -5})], new Set(['7']), 2).pseudo;      // 301 out of sight
    const {traffic} = R.trafficStep(s, [me, e(302, {gapDistance: -5}), e(301, {gapDistance: 20})], new Set(['7']), 3);
    assert.deepEqual(traffic.map(t => [t.gap, t.n]), [[-5, 2], [20, 1]]);
});

test('trafficStep: riders already in the tick are not traffic', () => {
    const me = e(7, {self: true});
    const {traffic} = R.trafficStep(null, [me, e(8, {gapDistance: -3, watching: true}), e(9, {gapDistance: 4})], new Set(['7', '8', '9']), 1);
    assert.deepEqual(traffic, []);
});

test('trafficStep: a watched or fallback rider not in keptIds is traffic (the upload strips his row)', () => {
    const me = e(7, {self: true});
    const {traffic} = R.trafficStep(null, [me, e(8, {gapDistance: -3, watching: true}), e(9, {gapDistance: 4})], new Set(['7']), 1);
    assert.deepEqual(traffic.map(t => t.gap), [-3, 4]);
    assert.ok(!JSON.stringify(traffic).includes('"8"') && !JSON.stringify(traffic).includes('"9"'));
});

test('trafficStep: stale or gapless riders left out, at most TRAFFIC_MAX, input not mutated', () => {
    const me = e(7, {self: true});
    const many = Array.from({length: 30}, (_, i) => e(400 + i, {gapDistance: -i}));
    const list = [me, e(500, {gapDistance: -1, age: R.MAX_AGE_MS + 1}), e(501, {gapDistance: NaN}), ...many];
    const p0 = {epoch: 5, next: 1, ids: new Map()};
    const {traffic, pseudo} = R.trafficStep(p0, list, new Set(['7']), 9);
    assert.equal(traffic.length, R.TRAFFIC_MAX);
    assert.equal(Math.max(...traffic.map(t => -t.gap)), R.TRAFFIC_MAX - 1);
    assert.ok(Object.is(traffic[0].gap, 0));                          // -0 is normalised
    assert.equal(p0.next, 1); assert.equal(p0.ids.size, 0);
    assert.equal(pseudo.next, R.TRAFFIC_MAX + 1);
});

test('trafficStep: a new epoch starts its own numbering', () => {
    const me = e(7, {self: true});
    const a = R.trafficStep(null, [me, e(600, {gapDistance: -2})], new Set(['7']), 100);
    const b = R.trafficStep(null, [me, e(601, {gapDistance: -2})], new Set(['7']), 200);
    assert.deepEqual([a.pseudo.epoch, a.traffic[0].n, b.pseudo.epoch, b.traffic[0].n], [100, 1, 200, 1]);
});
