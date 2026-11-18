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
        id: '1', self: false, watching: false, age: 500, gap: 3.5, gapDistance: 40, isGapEst: true, eventSubgroupId: 77,
        sgRaw: 0, time: 0, eventPosition: undefined, eventParticipants: undefined,
        power: 250, draft: 50, speed: 43, distance: 1000, eventDistance: 900, worldTime: 1e9, heartrate: 150, cadence: 90,
        grade: 0.02, altitude: 35.5, x: 100, y: 200, roadId: 12, reverse: true, courseId: 6,
    });
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
