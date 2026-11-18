// Run with: node --test tests/rotation.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as P from '../pages/src/engine/plan.mjs';
import * as R from '../pages/src/engine/rotation.mjs';

const json = readFileSync(new URL('./fixtures/rollers.json', import.meta.url), 'utf8');
const txt = readFileSync(new URL('./fixtures/rollers.txt', import.meta.url), 'utf8');


function n(id, gapDistance, extra = {}) {
    return {athleteId: id, age: 500, gapDistance, state: {speed: 45, worldTime: 1e9}, ...extra};
}


test('alignedPositions corrects stale samples', () => {
    // B is 2 m ahead of A but its sample is 1 s older: at 45 km/h it has moved 12.5 m since.
    const p = R.alignedPositions([n(1, 0, {self: true}), n(2, -2, {state: {speed: 45, worldTime: 1e9 - 1000}})], new Set(['2']));
    assert.deepEqual(p.map(x => x.id), ['2', '1']);
    assert.ok(Math.abs(p[0].x - 14.5) < 0.01);
});

test('alignedPositions drops old and foreign entries', () => {
    const p = R.alignedPositions([n(1, 0, {self: true}), n(2, -3, {age: 16000}), n(9, -5)], new Set(['2']));
    assert.deepEqual(p.map(x => x.id), ['1']);
});

test('teamChain ignores a rider far ahead and a dropped one', () => {
    const pos = [{id: 'a', x: 200}, {id: 'b', x: 4}, {id: 'me', x: 2, self: true}, {id: 'c', x: 0}, {id: 'd', x: -60}];
    assert.deepEqual(R.teamChain(pos, 'me').map(x => x.id), ['b', 'me', 'c']);
    assert.deepEqual(R.teamChain(pos, 'zz'), []);
});

test('trackFront adopts the first, holds 3 s, backdates', () => {
    let s = R.trackFront(R.initialFront(), {now: 0, frontId: 'A'});
    assert.equal(s.puller, 'A');
    // After the chaos window of that first change (see the chaos test below).
    s = R.trackFront(s, {now: 31000, frontId: 'B'});
    s = R.trackFront(s, {now: 32000, frontId: 'A'});      // B flipped back after 1 s
    s = R.trackFront(s, {now: 32500, frontId: 'B'});
    s = R.trackFront(s, {now: 35000, frontId: 'B'});
    assert.equal(s.puller, 'A');                          // only 2.5 s
    s = R.trackFront(s, {now: 35500, frontId: 'B'});
    assert.equal(s.puller, 'B'); assert.equal(s.since, 32500);
});


test('trackFront chaos rule: within CHAOS_WINDOW_MS of a change a new front rider needs CHAOS_HOLD_MS', () => {
    assert.equal(R.CHAOS_WINDOW_MS, 30000); assert.equal(R.CHAOS_HOLD_MS, 15000);
    let s = R.trackFront(R.initialFront(), {now: 0, frontId: 'A'});
    s = R.trackFront(s, {now: 40000, frontId: 'B'});
    s = R.trackFront(s, {now: 43000, frontId: 'B'});
    assert.equal(s.puller, 'B'); assert.equal(s.changedAt, 43000);
    // C in front 5 s after that change: 3 s are not enough now, nor 14.9 s.
    s = R.trackFront(s, {now: 48000, frontId: 'C'});
    s = R.trackFront(s, {now: 51000, frontId: 'C'});
    s = R.trackFront(s, {now: 62999, frontId: 'C'});
    assert.equal(s.puller, 'B');
    s = R.trackFront(s, {now: 63000, frontId: 'C'});
    assert.equal(s.puller, 'C'); assert.equal(s.since, 48000);    // backdated as always
    // A short flicker in the window is no puller at all.
    s = R.trackFront(s, {now: 70000, frontId: 'D'});
    s = R.trackFront(s, {now: 76000, frontId: 'D'});
    s = R.trackFront(s, {now: 77000, frontId: 'C'});
    assert.equal(s.puller, 'C'); assert.equal(s.since, 48000);
    // My own start or end is no position guess: it takes effect at once (and opens a window).
    s = R.trackFront(s, {now: 80000, frontId: 'C', draftStart: {id: 'me', at: 79000}});
    assert.equal(s.puller, 'me'); assert.equal(s.changedAt, 80000);
    // The end of a climb or descent counts as a change too.
    assert.equal(R.resumeFront({...R.initialFront(), puller: 'A', since: 0}, {now: 5000, frontId: 'A'}).changedAt, 5000);
});

test('rotationView: time to my pull skips absent riders', () => {
    const {plan} = P.importFiles([json, txt]);
    const front = {puller: '5100004', since: 0};           // Bodo pulling 60 s
    const all = plan.riders.map(r => r.id);
    let v = R.rotationView(plan, {selfId: '5100002', chainIds: all, wheelId: '5100003', front, now: 20000});
    assert.equal(v.toMyPullS, 40 + 60 + R.CHANGE_ALLOWANCE_S);        // rest of Bodo + Kim (and the allowance)
    assert.equal(v.place, 3);                             // Bodo 1, Kim 2, me 3
    assert.equal(v.next.id, '5100003'); assert.equal(v.wheel.colorName, 'Yellow'); assert.equal(v.mine, false);
    v = R.rotationView(plan, {selfId: '5100002', chainIds: all.filter(id => id !== '5100003'), wheelId: null, front, now: 20000});
    assert.equal(v.toMyPullS, 40);                        // Kim absent
    assert.equal(v.place, 2);
    assert.equal(v.next.id, '5100002');
});

test('rotationView: my own pull and overdue', () => {
    const {plan} = P.importFiles([json, txt]);
    const all = plan.riders.map(r => r.id);
    const v = R.rotationView(plan, {selfId: '5100002', chainIds: all, wheelId: null, front: {puller: '5100002', since: 0}, now: 65000});
    assert.equal(v.mine, true); assert.equal(v.remainingS, -5); assert.equal(v.toMyPullS, null);
    assert.equal(v.place, 1);
    assert.equal(v.me.watts, 266);
});

test('rotationView is null off-plan', () => {
    const {plan} = P.importFiles([json, txt]);
    assert.equal(R.rotationView(plan, {selfId: '510007', chainIds: [], wheelId: null, front: {puller: '5100004', since: 0}, now: 0}), null);
    assert.equal(R.rotationView(plan, {selfId: '5100002', chainIds: [], wheelId: null, front: R.initialFront(), now: 0}), null);
    assert.equal(R.rotationView(null, {selfId: '5100002', chainIds: [], wheelId: null, front: R.initialFront(), now: 0}), null);
});

test('wheelOf', () => {
    const chain = [{id: 'b', x: 4}, {id: 'me', x: 2, self: true}];
    assert.equal(R.wheelOf(chain, 'me'), 'b');
    assert.equal(R.wheelOf(chain, 'b'), null);
});

test('powerBar: zones and position in percent of the target', () => {
    assert.deepEqual([R.BAR_RANGE_PCT, R.GREEN_PCT, R.AMBER_PCT], [15, 5, 10]);
    assert.equal(R.powerBar(294, 280).zone, 'green');        // +5 %
    assert.equal(R.powerBar(266, 280).zone, 'green');        // -5 %
    assert.equal(R.powerBar(295, 280).zone, 'amber');
    assert.equal(R.powerBar(252, 280).zone, 'amber');        // -10 %
    assert.equal(R.powerBar(251, 280).zone, 'red');
    const b = R.powerBar(315, 280);                           // +12.5 %
    assert.equal(b.zone, 'red'); assert.ok(Math.abs(b.pos - (0.5 + 12.5 / 30)) < 1e-9);
    assert.equal(R.powerBar(400, 280).pos, 1);
    assert.equal(R.powerBar(100, 280).pos, 0);
    assert.equal(R.powerBar(280, 280).pos, 0.5);
    assert.equal(R.powerBar(280, 0), null);                   // no usable target
});


// Fix round 1: pin behaviour that mutations survived.

function planAll() {
    const {plan} = P.importFiles([json, txt]);
    return {plan, all: plan.riders.map(r => r.id)};
}

test('rotationView: past his end the countdown runs on RUN_ON_S, then only riders in between', () => {
    const {plan, all} = planAll();
    assert.equal(R.RUN_ON_S, 3);
    // Bodo (60 s) pulling; me Dario, Kim (60 s) between.
    const at = s => R.rotationView(plan, {selfId: '5100002', chainIds: all, wheelId: null,
                                          front: {puller: '5100004', since: 0}, now: s * 1000});
    const K = R.CHANGE_ALLOWANCE_S;                          // Kim's pull counts K longer
    assert.equal(at(59).toMyPullS, 61 + K);
    assert.equal(at(60).toMyPullS, 60 + K);
    assert.equal(at(62).toMyPullS, 58 + K);                  // runs on through the hold of a change
    assert.equal(at(63).toMyPullS, 57 + K);
    assert.equal(at(64).toMyPullS, 57 + K);                  // then waits for the change
    const v = at(90);
    assert.equal(v.remainingS, -30);
    assert.equal(v.toMyPullS, 57 + K);
});


test('rotationView: every pull between the puller and me counts CHANGE_ALLOWANCE_S more than planned', () => {
    const {plan, all} = planAll();
    assert.equal(R.CHANGE_ALLOWANCE_S, 10);
    // Bodo (60 s) pulling from 0; me Dario, Kim (60 s) between: Bodo's 60 s + Kim's 60 + 10.
    const v = R.rotationView(plan, {selfId: '5100002', chainIds: all, wheelId: null,
                                    front: {puller: '5100004', since: 0}, now: 0});
    assert.equal(v.toMyPullS, 60 + 60 + R.CHANGE_ALLOWANCE_S);
    // Next in line: only the puller's own time, no allowance.
    const n = R.rotationView(plan, {selfId: '5100003', chainIds: all, wheelId: null,
                                    front: {puller: '5100004', since: 0}, now: 0});
    assert.equal(n.toMyPullS, 60);
});


test('rotationView: the standing clock (standing, overS) once the run-on is used up', () => {
    const {plan, all} = planAll();
    const at = (s, selfId = '5100002', puller = '5100004') => R.rotationView(plan,
        {selfId, chainIds: all, wheelId: null, front: {puller, since: 0}, now: s * 1000});
    assert.equal(at(59).standing, false); assert.equal(at(59).overS, 0);
    assert.equal(at(63).standing, false);                     // still running on
    assert.equal(at(64).standing, true); assert.equal(at(64).overS, 4);
    assert.equal(at(90).overS, 30);
    // Not while I pull myself, nor when I am off the rotation view's path.
    assert.equal(at(90, '5100004').standing, false);
});

test('rotationView: cyclic wrap from the last rider', () => {
    const {plan, all} = planAll();
    const front = {puller: '51006', since: 0};              // Fritz, 15 s
    let v = R.rotationView(plan, {selfId: '5100005', chainIds: all, wheelId: null, front, now: 20000});
    assert.equal(v.toMyPullS, 0);                           // Arvid is next and Fritz is overdue
    assert.equal(v.next.id, '5100005');
    v = R.rotationView(plan, {selfId: '5100005', chainIds: all, wheelId: null, front, now: 5000});
    assert.equal(v.toMyPullS, 10);
    v = R.rotationView(plan, {selfId: '5100004', chainIds: all, wheelId: null, front, now: 20000});
    assert.equal(v.toMyPullS, 117 + R.CHANGE_ALLOWANCE_S);   // Arvid 120 s (+ allowance) in between, Fritz 5 s over (3 s run on)
    assert.equal(v.next.id, '5100005');
});

test('rotationView: a puller missing from chainIds still counts', () => {
    const {plan} = planAll();
    const v = R.rotationView(plan, {selfId: '5100002', chainIds: ['5100002'], wheelId: null, front: {puller: '5100004', since: 0}, now: 20000});
    assert.equal(v.toMyPullS, 40);                          // Bodo's remaining 40 s, Kim absent
    assert.equal(v.puller.id, '5100004');
});

test('rotationView: next is null when I am the puller and alone', () => {
    const {plan} = planAll();
    const v = R.rotationView(plan, {selfId: '5100002', chainIds: [], wheelId: null, front: {puller: '5100002', since: 0}, now: 1000});
    assert.equal(v.mine, true); assert.equal(v.next, null); assert.equal(v.toMyPullS, null);
});

test('teamChain: a gap of exactly 20 m is included, 20.01 m splits', () => {
    const inc = [{id: 'a', x: 40}, {id: 'me', x: 20, self: true}];
    assert.deepEqual(R.teamChain(inc, 'me').map(x => x.id), ['a', 'me']);
    const exc = [{id: 'a', x: 40}, {id: 'me', x: 19.99, self: true}];
    assert.deepEqual(R.teamChain(exc, 'me').map(x => x.id), ['me']);
    const back = [{id: 'me', x: 0, self: true}, {id: 'b', x: -20}, {id: 'c', x: -40.01}];
    assert.deepEqual(R.teamChain(back, 'me').map(x => x.id), ['me', 'b']);
});

test('trackFront: a puller who leaves the chain is replaced after the hold', () => {
    let s = R.trackFront(R.initialFront(), {now: 0, frontId: 'A'});
    s = R.trackFront(s, {now: 40000, frontId: 'B'});        // A dropped, B is now in front
    assert.equal(s.puller, 'A');
    s = R.trackFront(s, {now: 42999, frontId: 'B'});
    assert.equal(s.puller, 'A');
    s = R.trackFront(s, {now: 43000, frontId: 'B'});
    assert.equal(s.puller, 'B'); assert.equal(s.since, 40000);
    assert.equal(s.cand, null); assert.equal(s.candSince, null);
});

test('trackFront: no data keeps the puller and drops a pending candidate', () => {
    let s = R.trackFront(R.initialFront(), {now: 0, frontId: 'A'});
    s = R.trackFront(s, {now: 1000, frontId: 'B'});
    s = R.trackFront(s, {now: 2000, frontId: null});
    assert.equal(s.puller, 'A'); assert.equal(s.since, 0);
    assert.equal(s.cand, null); assert.equal(s.candSince, null);
    s = R.trackFront(s, {now: 61000, frontId: 'B'});
    assert.equal(s.puller, 'A');                            // not backdated across the gap
    s = R.trackFront(s, {now: 64000, frontId: 'B'});
    assert.equal(s.puller, 'B'); assert.equal(s.since, 61000);
    const before = R.initialFront();
    const after = R.trackFront(before, {now: 5, frontId: null});
    assert.deepEqual(after, before); assert.notEqual(after, before);
});

test('powerBar is null without finite numbers', () => {
    assert.equal(R.powerBar(null, 254), null);
    assert.equal(R.powerBar(undefined, 254), null);
    assert.equal(R.powerBar(260, undefined), null);
    assert.equal(R.powerBar(260, null), null);
    assert.equal(R.powerBar(NaN, 254), null);
    assert.equal(R.powerBar(0, 254).zone, 'red');           // zero watts is a number
});

test('alignedPositions: teammates older than ROT_MAX_AGE_MS are ignored, self is not', () => {
    assert.equal(R.ROT_MAX_AGE_MS, 5000);
    const ids = new Set(['2']);
    let p = R.alignedPositions([n(1, 0, {self: true}), n(2, -3, {age: 4999})], ids);
    assert.deepEqual(p.map(x => x.id), ['2', '1']);
    p = R.alignedPositions([n(1, 0, {self: true}), n(2, -3, {age: 5000})], ids);
    assert.deepEqual(p.map(x => x.id), ['1']);
    p = R.alignedPositions([n(1, 0, {self: true, age: 6000})], ids);
    assert.deepEqual(p.map(x => x.id), ['1']);
    p = R.alignedPositions([n(1, 0, {self: true, age: 15000})], ids);
    assert.deepEqual(p, []);
});


// Task 2 fix round 1: self off the plan never pulls; no view input without live self data.

test('frontOf skips me when I am not a plan rider', () => {
    const ids = new Set(['a', 'b']);
    const chain = [{id: 'me', x: 4, self: true}, {id: 'a', x: 2}, {id: 'b', x: 0}];
    assert.equal(R.frontOf(chain, ids), 'a');
    assert.equal(R.frontOf([{id: 'me', x: 0, self: true}], ids), null);
    assert.equal(R.frontOf([], ids), null);
    assert.equal(R.frontOf([{id: 'a', x: 2}, {id: 'me', x: 0, self: true}], new Set(['a', 'me'])), 'a');
    assert.equal(R.frontOf([{id: 'me', x: 2, self: true}, {id: 'a', x: 0}], new Set(['a', 'me'])), 'me');
});

test('selfLive needs a current self sample for my id', () => {
    assert.equal(R.selfLive([n(1, 0, {self: true})], '1'), true);
    assert.equal(R.selfLive([n(1, 0, {self: true, age: 14999})], '1'), true);
    assert.equal(R.selfLive([n(1, 0, {self: true, age: 15000})], '1'), false);
    assert.equal(R.selfLive([n(2, -3)], '1'), false);                // self missing
    assert.equal(R.selfLive([n(1, 0, {self: true})], '9'), false);   // a different self
    assert.equal(R.selfLive([], '1'), false);
    assert.equal(R.selfLive([n(1, 0, {self: true})], null), false);
});


// ---------- own pull start and end from power ----------

function hist(ws, t0 = 0) {
    let h = [];
    ws.forEach((w, i) => { h = R.pushPower(h, {t: t0 + i * 1000, w}); });
    return h;
}
const rep = (w, k) => Array(k).fill(w);

test('own pull constants', () => {
    assert.deepEqual([R.JUMP_W, R.JUMP_TARGET_FRAC, R.REST_WINDOW_S, R.JUMP_GATE_S, R.CLIMB_GRADE,
                      R.CLIMB_EXIT_GRADE, R.CLIMB_EXIT_MS, R.CONFIRM_MS, R.SUSTAIN_S,
                      R.SUSTAIN_TARGET_FRAC, R.END_W, R.END_MIN_S],
                     [40, 0.8, 10, 10, 4, 2, 5000, 12000, 8, 0.85, 130, 20]);
    assert.deepEqual([R.CLIMB_ENTER_MS, R.DESCENT_GRADE, R.SELF_IGNORE_MS, R.DRAFT_FRONT_W, R.DRAFT_N,
                      R.DRAFT_RUN_N, R.BEHIND_MAX_AGE_MS, R.PRESENT_GRACE_MS, R.END_FRAC],
                     [5000, -3, 10000, 5, 3, 2, 2000, 20000, 0.6]);
});

test('pushPower keeps a full rest window before the longer jump rule, skips non-numbers', () => {
    const h = hist(rep(100, 30));
    assert.equal(h.length, R.REST_WINDOW_S + R.SUSTAIN_S);
    assert.equal(h[0].t, 12000);
    const before = hist([100, 200]);
    const after = R.pushPower(before, {t: 5000, w: 300});
    assert.notEqual(after, before); assert.equal(before.length, 2);
    assert.equal(R.pushPower(before, {t: 5000, w: undefined}), before);
    assert.equal(R.pushPower(before, {t: 5000, w: NaN}), before);
    assert.equal(R.pushPower(before, null), before);
    assert.deepEqual(R.pushPower([], {t: 1, w: 2, x: 3}), [{t: 1, w: 2}]);
});

test('powerJump', () => {
    assert.equal(R.powerJump(hist([...rep(200, 10), ...rep(270, 3)]), 254), 10000);
    assert.equal(R.powerJump(hist([...rep(200, 10), ...rep(230, 3)]), 254), null);     // +30 W
    assert.equal(R.powerJump(hist([...rep(180, 10), ...rep(230, 3)]), 300), null);     // < 0.8 x 300
    assert.equal(R.powerJump(hist([...rep(180, 10), ...rep(230, 3)]), null), 10000);   // no target
    assert.equal(R.powerJump(hist([...rep(200, 4), ...rep(270, 3)]), 254), null);      // 4 rest samples
    assert.equal(R.powerJump(hist([...rep(200, 5), ...rep(270, 3)]), 254), 5000);
    // Only the 10 samples right before the last 3 are the rest: older high power does not count.
    assert.equal(R.powerJump(hist([...rep(400, 5), ...rep(200, 10), ...rep(270, 3)]), 254), 15000);
    // Still rising: the last 3 must be the jump, so one sample later it is the newer t.
    assert.equal(R.powerJump(hist([...rep(200, 10), ...rep(270, 4)]), 254), 11000);
});

test('sustainedJump', () => {
    assert.equal(R.sustainedJump(hist([...rep(200, 10), ...rep(260, 8)]), 275), 10000);
    assert.equal(R.sustainedJump(hist([...rep(200, 10), ...rep(260, 5)]), 275), null);  // only 5 s
    assert.equal(R.sustainedJump(hist([...rep(200, 10), ...rep(225, 8)]), 275), null);  // < 233.75
    // The target rule on its own: +45 W over the rest, but below 0.85 x 275.
    assert.equal(R.sustainedJump(hist([...rep(180, 10), ...rep(225, 8)]), 275), null);
    assert.equal(R.sustainedJump(hist([...rep(180, 10), ...rep(225, 8)]), null), 10000);
    // The rest is the full 10 s before the 8 (not just the 5 that a 13-sample history would keep)...
    assert.equal(R.sustainedJump(hist([...rep(300, 5), ...rep(200, 5), ...rep(260, 8)]), 275), null);
    // ...and nothing older: a sample 11 s before them does not count.
    assert.equal(R.sustainedJump(hist([400, ...rep(200, 10), ...rep(260, 8)]), 275), 11000);
});

test('powerDrop', () => {
    assert.equal(R.powerDrop(hist([280, 280, 90, 60])), 2000);
    assert.equal(R.powerDrop(hist([280, 280, 90])), null);
    assert.equal(R.powerDrop(hist([280, 150])), null);
    assert.equal(R.powerDrop(hist([90])), null);
});

// A pending start is invisible: the old puller stays until my draft or position confirms it.
test('trackFront selfStart: pending and invisible, confirmed with since = the jump', () => {
    let s = R.trackFront(R.initialFront(), {now: 0, frontId: 'A'});
    const b = s;
    s = R.trackFront(s, {now: 50000, frontId: 'A', selfStart: {id: 'me', at: 48000}});
    assert.equal(s.puller, 'A'); assert.equal(s.since, 0); assert.deepEqual(s.pending, {id: 'me', at: 48000});
    assert.equal(R.selfEvent(b, s), null);
    const p = s;
    s = R.trackFront(s, {now: 53000, frontId: 'A', confirm: true});     // my draft says I lead
    assert.equal(s.puller, 'me'); assert.equal(s.since, 48000); assert.equal(s.pending, null);
    assert.equal(R.selfEvent(p, s), 'start');
    s = R.trackFront(s, {now: 54000, frontId: 'B'});
    s = R.trackFront(s, {now: 68999, frontId: 'B'});
    assert.equal(s.puller, 'me');                     // the hold applies again (chaos: right after my start)
    s = R.trackFront(s, {now: 69000, frontId: 'B'});
    assert.equal(s.puller, 'B'); assert.equal(s.since, 54000);
});

test('trackFront selfStart: while pending, the candidate is followed but nobody is adopted', () => {
    let s = R.trackFront(R.initialFront(), {now: 0, frontId: 'A'});
    s = R.trackFront(s, {now: 50000, frontId: 'A', selfStart: {id: 'me', at: 50000}});
    for (const now of [51000, 53000, 55000, 57000, 59000, 61000]) {
        s = R.trackFront(s, {now, frontId: 'C'});
    }
    assert.equal(s.puller, 'A'); assert.equal(s.since, 0);
    assert.equal(s.cand, 'C'); assert.equal(s.candSince, 51000);
    const c = s;
    s = R.trackFront(s, {now: 61500, frontId: 'A', confirm: true});
    assert.equal(s.puller, 'me'); assert.equal(s.since, 50000);
    // Not confirmed: when the pending start is dropped, C (in front since 51 s) is adopted at once.
    const d = R.trackFront(c, {now: 62000, frontId: 'C'});
    assert.equal(d.puller, 'C'); assert.equal(d.since, 51000); assert.equal(d.pending, null);
});

test('trackFront selfStart: dropped silently after CONFIRM_MS without confirmation', () => {
    let s = R.trackFront(R.initialFront(), {now: 1000, frontId: 'A'});
    s = R.trackFront(s, {now: 50000, frontId: 'A', selfStart: {id: 'me', at: 49000}});
    s = R.trackFront(s, {now: 60999, frontId: 'A'});
    assert.ok(s.pending);
    const b = s;
    s = R.trackFront(s, {now: 61000, frontId: 'A'});
    assert.equal(s.puller, 'A'); assert.equal(s.since, 1000); assert.equal(s.pending, null);
    assert.equal(R.selfEvent(b, s), 'revert');
    // A jump from before the drop, still in the power history, is not taken again; a newer one is.
    s = R.trackFront(s, {now: 62000, frontId: 'A', selfStart: {id: 'me', at: 55000}});
    assert.equal(s.pending, null);
    s = R.trackFront(s, {now: 62000, frontId: 'A', selfStart: {id: 'me', at: 61000}});   // = drop time
    assert.equal(s.pending, null);
    s = R.trackFront(s, {now: 70000, frontId: 'A', selfStart: {id: 'me', at: 69000}});
    assert.equal(s.pending.at, 69000);
    // A pending start also expires without any position data.
    s = R.trackFront(s, {now: 81000, frontId: null});
    assert.equal(s.pending, null); assert.equal(s.puller, 'A');
});

test('trackFront selfStart: confirmed in the step it is made (early start, already in front)', () => {
    let s = R.trackFront(R.initialFront(), {now: 0, frontId: 'A'});
    const b = s;
    s = R.trackFront(s, {now: 30000, frontId: 'me', selfStart: {id: 'me', at: 23000}, confirm: true});
    assert.equal(s.puller, 'me'); assert.equal(s.since, 23000); assert.equal(s.pending, null);
    assert.equal(R.selfEvent(b, s), 'start');
    assert.equal(R.selfEvent(s, R.trackFront(s, {now: 31000, frontId: 'me'})), null);
});

test('trackFront: after my start the previous puller does not count as front for SELF_IGNORE_MS', () => {
    let s = R.trackFront(R.initialFront(), {now: 0, frontId: 'A'});
    s = R.trackFront(s, {now: 40000, frontId: 'A', draftStart: {id: 'me', at: 39000}});
    for (const now of [41000, 44000, 47000, 49999]) {
        s = R.trackFront(s, {now, frontId: 'A'});               // positions still show A ahead
    }
    assert.equal(s.puller, 'me'); assert.equal(s.cand, null);
    s = R.trackFront(s, {now: 50000, frontId: 'A'});
    s = R.trackFront(s, {now: 53000, frontId: 'A'});
    // A is back right after the ignore window: my start was wrong, he keeps his own since.
    assert.equal(s.puller, 'A'); assert.equal(s.since, 0);
    // Back much later (I really pulled and swung off softly): a fresh since.
    let u = R.trackFront(R.initialFront(), {now: 0, frontId: 'A'});
    u = R.trackFront(u, {now: 40000, frontId: 'A', draftStart: {id: 'me', at: 39000}});
    u = R.trackFront(u, {now: 41000, frontId: 'me'});
    u = R.trackFront(u, {now: 90000, frontId: 'A'});
    u = R.trackFront(u, {now: 93000, frontId: 'A'});
    assert.equal(u.puller, 'A'); assert.equal(u.since, 90000);
    // The same after a confirmed jump.
    let t = R.trackFront(R.initialFront(), {now: 0, frontId: 'A'});
    t = R.trackFront(t, {now: 40000, frontId: 'A', selfStart: {id: 'me', at: 39000}, confirm: true});
    t = R.trackFront(t, {now: 49999, frontId: 'A'});
    assert.equal(t.puller, 'me');
});

test('trackFront draftStart: my draft alone starts my pull; not while a jump is pending', () => {
    let s = R.trackFront(R.initialFront(), {now: 0, frontId: 'A'});
    const b = s;
    s = R.trackFront(s, {now: 40000, frontId: 'A', draftStart: {id: 'me', at: 38000}});
    assert.equal(s.puller, 'me'); assert.equal(s.since, 38000);
    assert.equal(R.selfEvent(b, s), 'draftStart');
    let t = R.trackFront(R.initialFront(), {now: 0, frontId: 'A'});
    t = R.trackFront(t, {now: 40000, frontId: 'A', selfStart: {id: 'me', at: 37000}});
    t = R.trackFront(t, {now: 41000, frontId: 'A', draftStart: {id: 'me', at: 39000}});
    assert.equal(t.puller, 'A'); assert.ok(t.pending);                   // the jump waits for confirm
    t = R.trackFront(t, {now: 41000, frontId: 'A', confirm: true});
    assert.equal(t.puller, 'me'); assert.equal(t.since, 37000);
});

test('trackFront selfEnd: the next rider pulls from the drop', () => {
    let s = R.trackFront(R.initialFront(), {now: 0, frontId: 'me'});
    const b = s;
    s = R.trackFront(s, {now: 61000, frontId: 'me', selfEnd: {id: 'me', at: 60000, nextId: 'B'}});
    assert.equal(s.puller, 'B'); assert.equal(s.since, 60000);
    assert.equal(R.selfEvent(b, s), 'end');
    // Not the puller, or no next rider: nothing happens.
    const t = R.trackFront(R.initialFront(), {now: 0, frontId: 'A'});
    assert.equal(R.trackFront(t, {now: 1000, frontId: 'A', selfEnd: {id: 'me', at: 900, nextId: 'B'}}).puller, 'A');
    const u = R.trackFront(R.initialFront(), {now: 0, frontId: 'me'});
    assert.equal(R.trackFront(u, {now: 1000, frontId: 'me', selfEnd: {id: 'me', at: 900, nextId: null}}).puller, 'me');
});

test('trackFront selfEnd: I am ignored as front rider for SELF_IGNORE_MS while I fade', () => {
    assert.equal(R.SELF_IGNORE_MS, 10000);
    let s = R.trackFront(R.initialFront(), {now: 0, frontId: 'me'});
    s = R.trackFront(s, {now: 61000, frontId: 'me', selfEnd: {id: 'me', at: 60000, nextId: 'B'}});
    for (const now of [62000, 64000, 66000, 68000]) {
        s = R.trackFront(s, {now, frontId: 'me'});
    }
    s = R.trackFront(s, {now: 68500, frontId: 'B'});            // B comes past
    s = R.trackFront(s, {now: 69000, frontId: 'me'});           // flicker: still ignored
    s = R.trackFront(s, {now: 69999, frontId: 'me'});
    assert.equal(s.puller, 'B'); assert.equal(s.since, 60000); assert.equal(s.cand, null);
    s = R.trackFront(s, {now: 70000, frontId: 'me'});           // 10 s after the drop: the hold applies
    s = R.trackFront(s, {now: 84999, frontId: 'me'});           // (chaos: 15 s, my end was at 61)
    assert.equal(s.puller, 'B');
    s = R.trackFront(s, {now: 85000, frontId: 'me'});
    assert.equal(s.puller, 'me'); assert.equal(s.since, 70000);
});

test('startConfirmed: my draft ~0 with a fresh teammate behind me, or position', () => {
    const chain = (...xs) => xs.map(([id, age]) => ({id, age, self: id === 'me'}));
    const behind = chain(['A', 1500], ['me', 100], ['B', 1500]);
    assert.equal(R.draftMean([30, 0, 0]), 10); assert.equal(R.draftMean([0, 0]), null);
    assert.equal(R.draftFront({drafts: [10, 2, 3], chain: behind, selfId: 'me'}), true);    // mean 5
    assert.equal(R.draftFront({drafts: [10, 3, 3], chain: behind, selfId: 'me'}), false);   // mean 5.33
    assert.equal(R.draftFront({drafts: [0, 0], chain: behind, selfId: 'me'}), false);       // 2 samples
    // Nobody behind me (dropped), or only a stale sample behind me: no.
    assert.equal(R.draftFront({drafts: [0, 0, 0], chain: chain(['A', 100], ['me', 100]), selfId: 'me'}), false);
    assert.equal(R.draftFront({drafts: [0, 0, 0], chain: chain(['me', 100], ['B', 2000]), selfId: 'me'}), false);
    assert.equal(R.startConfirmed({drafts: [0, 0, 0], chain: behind, selfId: 'me', frontId: 'A'}), true);
    // Position: frontmost with a teammate behind (draft unknown or blocked by another team's rider).
    const first = chain(['me', 100], ['B', 4000]);
    assert.equal(R.startConfirmed({drafts: [], chain: first, selfId: 'me', frontId: 'me'}), true);
    assert.equal(R.startConfirmed({drafts: [80, 80, 80], chain: first, selfId: 'me', frontId: 'me'}), true);
    assert.equal(R.startConfirmed({drafts: [], chain: chain(['me', 100]), selfId: 'me', frontId: 'me'}), false);
    assert.equal(R.startConfirmed({drafts: [80, 80, 80], chain: behind, selfId: 'me', frontId: 'A'}), false);
});

test('draftRun counts consecutive samples and keeps the first t', () => {
    let r = R.draftRun(null, {t: 1000, ok: true});
    assert.deepEqual(r, {n: 1, at: 1000});
    r = R.draftRun(r, {t: 2000, ok: true});
    assert.deepEqual(r, {n: 2, at: 1000});
    assert.equal(r.n >= R.DRAFT_RUN_N, true);
    assert.deepEqual(R.draftRun(r, {t: 3000, ok: false}), {n: 0, at: null});
});

test('earlyStartAllowed: only as the first rider of my chain', () => {
    // First, the puller behind me.
    assert.equal(R.earlyStartAllowed({chainIds: ['me', 'A', 'B'], selfId: 'me', pullerId: 'A'}), true);
    // Second, behind the puller.
    assert.equal(R.earlyStartAllowed({chainIds: ['A', 'me', 'B'], selfId: 'me', pullerId: 'A'}), false);
    // The puller dropped out of the chain, I am first.
    assert.equal(R.earlyStartAllowed({chainIds: ['me', 'B'], selfId: 'me', pullerId: 'A'}), true);
    // The puller dropped out, but another rider is ahead of me.
    assert.equal(R.earlyStartAllowed({chainIds: ['C', 'me', 'B'], selfId: 'me', pullerId: 'A'}), false);
    assert.equal(R.earlyStartAllowed({chainIds: [], selfId: 'me', pullerId: 'A'}), false);
});

test('climbState: enters after 5 s at 4 %, stays through a short dip, exits after 5 s below 2 %', () => {
    let s = R.initialClimb();
    s = R.climbState(s, {now: 0, grade: 3.9});
    s = R.climbState(s, {now: 1000, grade: 4});
    s = R.climbState(s, {now: 3000, grade: 6});
    s = R.climbState(s, {now: 4000, grade: 3});              // the entry timer starts again
    s = R.climbState(s, {now: 5000, grade: 4});
    s = R.climbState(s, {now: 9999, grade: 5});
    assert.equal(s.climbing, false);
    s = R.climbState(s, {now: 10000, grade: 5});
    assert.equal(s.climbing, true); assert.equal(s.since, 10000);
    s = R.climbState(s, {now: 11000, grade: 1});             // 1 s dip
    s = R.climbState(s, {now: 12000, grade: 4});
    s = R.climbState(s, {now: 16000, grade: 2});             // 2 % is not below 2 %
    assert.equal(s.climbing, true);
    s = R.climbState(s, {now: 17000, grade: 1.9});
    s = R.climbState(s, {now: 18000, grade: undefined});     // missing: no change
    s = R.climbState(s, {now: 21999, grade: 0});
    assert.equal(s.climbing, true);
    s = R.climbState(s, {now: 22000, grade: 0});
    assert.equal(s.climbing, false); assert.equal(s.since, 22000);
    assert.equal(R.climbState(R.initialClimb(), {now: 0, grade: null}).climbing, false);
    // Zone 23 style: 3 % ramps never enter.
    let z = R.initialClimb();
    for (let t = 0; t < 60000; t += 1000) {
        z = R.climbState(z, {now: t, grade: 3.5});
    }
    assert.equal(z.climbing, false);
});

test('resumeFront: the same front rider keeps his clock, another one is adopted at once', () => {
    const front = {...R.initialFront(), puller: 'A', since: 1000};
    assert.deepEqual(R.resumeFront(front, {now: 90000, frontId: 'A'}), {...front, changedAt: 90000});
    const s = R.resumeFront(front, {now: 90000, frontId: 'B'});
    assert.equal(s.puller, 'B'); assert.equal(s.since, 90000);
    assert.equal(R.resumeFront(front, {now: 90000, frontId: null}).puller, 'A');
});

test('presence: a rider seen in my chain counts as present for PRESENT_GRACE_MS', () => {
    assert.equal(R.PRESENT_GRACE_MS, 20000);
    let p = R.presence({}, {now: 0, chainIds: ['A', 'me', 'B']});
    assert.deepEqual(p.ids.sort(), ['A', 'B', 'me']);
    p = R.presence(p.seen, {now: 19999, chainIds: ['A', 'me']});    // B flickered out
    assert.deepEqual(p.ids.sort(), ['A', 'B', 'me']);
    p = R.presence(p.seen, {now: 20000, chainIds: ['A', 'me']});
    assert.deepEqual(p.ids.sort(), ['A', 'me']);
});

test('presence keeps countdowns steady when a rider flickers out', () => {
    const {plan} = P.importFiles([json, txt]);
    const front = {puller: '5100004', since: 0};           // Bodo pulling 60 s, Kim then me (Dario)
    const kim = '5100003', me = '5100002';
    let p = R.presence({}, {now: 10000, chainIds: ['5100004', kim, me]});
    p = R.presence(p.seen, {now: 20000, chainIds: ['5100004', me]});
    const v = R.rotationView(plan, {selfId: me, chainIds: p.ids, wheelId: null, front, now: 20000});
    assert.equal(v.toMyPullS, 40 + 60 + R.CHANGE_ALLOWANCE_S); assert.equal(v.next.id, kim);
});

test('dashReason and dashKind', () => {
    const {plan} = P.importFiles([json, txt]);
    const me = '5100002';
    const ok = {plan, selfId: me, live: true, finish: false, climbing: false,
                chain: [{id: '5100004'}, {id: me, self: true}]};
    assert.equal(R.dashReason(ok), null);
    assert.equal(R.dashReason({...ok, plan: null}), 'noplan');
    assert.equal(R.dashReason({...ok, selfId: '42'}), 'notin');
    assert.equal(R.dashReason({...ok, live: false}), 'nolive');
    assert.equal(R.dashReason({...ok, finish: true, climbing: true}), 'finish');
    assert.equal(R.dashReason({...ok, climbing: true}), 'climb');
    // Alone: no other plan rider in my chain (a dropped rider never sees PULL).
    assert.equal(R.dashReason({...ok, chain: [{id: me, self: true}]}), 'alone');
    assert.equal(R.dashReason({...ok, chain: []}), 'alone');
    assert.deepEqual(['climb', 'alone', 'nolive', 'nofront', 'noplan', 'notin', 'finish', null].map(R.dashKind),
                     ['climb', 'unknown', 'unknown', 'unknown', 'none', 'none', 'none', 'none']);
});

test('alignedPositions carries the sample age (for a fresh teammate behind me)', () => {
    const p = R.alignedPositions([n(1, 0, {self: true, age: 100}), n(2, 3, {age: 1800})], new Set(['2']));
    assert.deepEqual(p.map(x => [x.id, x.age]), [['1', 100], ['2', 1800]]);
});


// Real data: the user's own 1 Hz power from a WTRL TTT (Zone 23), t = index in seconds.
// Pull starts and ends from the analysis of that file (starts are approximate plateau starts).
test('replay: my real TTT power finds all six pull starts and ends', () => {
    const {w} = JSON.parse(readFileSync(new URL('./fixtures/zone23-power.json', import.meta.url), 'utf8'));
    const starts = [240, 617, 1022, 1346, 1666, 2000];
    const ends = [301, 677, 1082, 1411, 1741, 2077];
    const target = 254;                                     // my plan watts in that race
    let h = [];
    const fast = [], sus = [], drop = [], drop06 = [];
    for (let i = 0; i < w.length; i++) {
        h = R.pushPower(h, {t: i, w: w[i]});
        const j = R.powerJump(h, target), s = R.sustainedJump(h, target), d = R.powerDrop(h);
        if (j !== null) fast.push({i, t: j});
        if (s !== null) sus.push({i, t: s});
        if (d !== null) drop.push({i, t: d});
        const d6 = R.powerDrop(h, R.END_FRAC * target);       // shadow end rule (recorded only)
        if (d6 !== null) drop06.push({i, t: d6});
    }
    starts.forEach((st, k) => {
        // Each rule is evaluated from shortly before the start until its own lag after it (it
        // backdates t to the first sample of its window): then some fire puts t within 8 s.
        const near = x => Math.abs(x.t - st) <= 8;
        const f = fast.filter(x => x.i >= st - 10 && x.i <= st + 8 + R.SMOOTH_S).find(near);
        const g = sus.filter(x => x.i >= st - 40 && x.i <= st + 8 + R.SUSTAIN_S).find(near);
        assert.ok(f || g, `start ${st}`);
        assert.ok(f, `fast rule at start ${st}`);             // the fast rule alone finds all six
        assert.ok(g, `8 s rule at start ${st}`);              // and so does the 8 s rule
        // End: the first drop from END_MIN_S after the detected start.
        const from = f.t + R.END_MIN_S;
        const e = drop.find(x => x.i >= from);
        assert.ok(e && Math.abs(e.t - ends[k]) <= 2, `end ${ends[k]}: ${e && e.t}`);
        const e6 = drop06.find(x => x.i >= from);
        assert.ok(e6 && Math.abs(e6.t - ends[k]) <= 2, `shadow end ${ends[k]}: ${e6 && e6.t}`);
    });
});

test('finishMode: the last 500 m of a distance event', () => {
    assert.equal(R.FINISH_M, 500);
    const ev = (remaining, remainingMetric = 'distance', remainingType = 'event') =>
        ({remaining, remainingMetric, remainingType});
    assert.equal(R.finishMode(ev(500)), true);
    assert.equal(R.finishMode(ev(12)), true);
    assert.equal(R.finishMode(ev(501)), false);
    assert.equal(R.finishMode(ev(300, 'time')), false);
    assert.equal(R.finishMode(ev(300, 'distance', 'route')), false);   // a route lap, no event
    assert.equal(R.finishMode({remaining: 300, remainingMetric: 'distance'}), false);
    assert.equal(R.finishMode({remainingMetric: 'distance', remainingType: 'event'}), false);
    assert.equal(R.finishMode(ev(null)), false);
    assert.equal(R.finishMode({}), false);
    assert.equal(R.finishMode(null), false);
});


// ---------- rotationStep: scenarios through the whole pure step ----------

// Synthetic 1 Hz rides with the rollers plan. scenario(s) -> {me: {power, draft, grade}, others:
// [{idx, dx}]} with dx = metres ahead of me. Returns per second {s, self, puller, since (s), view}.
function ride(scenario, {selfIdx = 0, from = 0, dur = 60, quietStart = false, terrain = () => undefined} = {}) {
    const {plan} = P.importFiles([json, txt]);
    const riderIds = new Set(plan.riders.map(r => r.id));
    const selfId = plan.riders[selfIdx].id;
    const name = id => plan.riders.find(r => r.id === id)?.name.split(' ')[0] ?? null;
    const T0 = 1.7e12;
    let rot = R.initialRotation(), hist = [], drafts = [];
    const out = [];
    for (let s = from; s < from + dur; s++) {
        const now = T0 + s * 1000;
        const sc = scenario(s);
        const wt = 1e12 + s * 1000;
        const nearby = [
            {athleteId: Number(selfId), self: true, age: 300, gapDistance: 0,
             state: {power: sc.me.power, draft: sc.me.draft, speed: sc.me.speed ?? 45, worldTime: wt, grade: (sc.me.grade ?? 0) / 100}},
            ...sc.others.map(o => ({athleteId: Number(plan.riders[o.idx].id), age: 800, gapDistance: -o.dx,
                                    state: {power: o.power ?? 250, draft: 50, speed: sc.me.speed ?? 45, worldTime: wt}})),
        ];
        hist = R.pushPower(hist, {t: now, w: sc.me.power});
        drafts = [...drafts, sc.me.draft].slice(-R.DRAFT_N);
        const r = R.rotationStep(rot, {now, plan, riderIds, selfId, nearby, hist, drafts,
                                       grade: sc.me.grade ?? 0, sampleT: now, terrain: terrain(s)});
        rot = r.state;
        const {view, reason} = R.rotationStatus(rot, {now, plan, selfId, live: true, quietStart});
        const kind = view ? (view.mine ? 'pull' : 'rest') : reason;
        out.push({s, self: r.self, puller: name(rot.front.puller),
                  since: rot.front.since === null ? null : (rot.front.since - T0) / 1000, view: kind});
    }
    return out;
}
const at = (rows, s) => rows.find(r => r.s === s);
const events = rows => rows.filter(r => r.self).map(r => `${r.s}:${r.self}`);

test('rotationStep: with 2 riders my pull end sticks (no draft start while I fade in front)', () => {
    // I (Arvid) pull from 0, swing off at 40 (2 s at 80 W, then 180 W); Bodo closes from 2 m
    // behind from 43 and is 2 m ahead from 47; my draft returns at 47.
    const rows = ride(t => {
        let power = 280, draft = 0, dx = -2;
        if (t >= 40 && t < 42) power = 80;
        else if (t >= 42) power = 180;
        if (t >= 43) dx = Math.min(2, -2 + (t - 43));
        if (t >= 47) draft = 100;
        return {me: {power, draft}, others: [{idx: 1, dx}]};
    }, {dur: 70});
    assert.deepEqual(events(rows), ['41:end']);
    for (let s = 41; s < 70; s++) {
        assert.equal(at(rows, s).puller, 'Bodo', `s ${s}`);
        assert.equal(at(rows, s).view, 'rest', `s ${s}`);
    }
    assert.equal(at(rows, 69).since, 40);
});

test('trackFront: after my end, a draft run that began before it does not restart my pull', () => {
    let s = R.trackFront(R.initialFront(), {now: 0, frontId: 'me'});
    s = R.trackFront(s, {now: 41000, frontId: 'me', selfEnd: {id: 'me', at: 40000, nextId: 'B'}});
    s = R.trackFront(s, {now: 42000, frontId: 'me', draftStart: {id: 'me', at: 30000}});
    assert.equal(s.puller, 'B');
    s = R.trackFront(s, {now: 43000, frontId: 'me', draftStart: {id: 'me', at: 42000}});   // during the fade
    assert.equal(s.puller, 'B'); assert.equal(s.since, 40000);
    s = R.trackFront(s, {now: 43000, frontId: 'me', selfStart: {id: 'me', at: 42000}});
    assert.equal(s.pending ?? null, null);
});

// Kim (idx 2) pulls, I am next on his wheel, Bodo behind me. Kim gaps me by up to 12 m (inside
// the 20 m chain) for gapS s; my draft is 0 while the gap is over 5 m.
function gapRide(gapFrom, gapS) {
    return ride(t => {
        let dx = 2;
        if (t >= gapFrom && t < gapFrom + gapS) dx = Math.min(12, 2 + (t - gapFrom) * 4);
        else if (t >= gapFrom + gapS && t < gapFrom + gapS + 3) dx = Math.max(2, 12 - (t - gapFrom - gapS) * 4);
        return {me: {power: 230, draft: dx > 5 ? 0 : 100}, others: [{idx: 2, dx}, {idx: 1, dx: -2}]};
    }, {dur: 90});
}

test('rotationStep: a gap behind the puller mid-pull does not start my pull', () => {
    const rows = gapRide(20, 8);
    assert.deepEqual(events(rows), []);
    for (const r of rows) {
        assert.equal(r.puller, 'Kim', `s ${r.s}`); assert.equal(r.since, 0, `s ${r.s}`);
    }
});

test('rotationStep: a gap in his last 10 s starts my pull; when he is back in front he keeps his since', () => {
    // Kim's 60 s pull from 0: the gap opens at 52 (8 s left) and closes at 60-63.
    const rows = gapRide(52, 8);
    const ev = events(rows);
    assert.equal(ev.length, 1); assert.match(ev[0], /:draftStart$/);
    const s0 = Number(ev[0].split(':')[0]);
    assert.ok(s0 >= 53 && s0 <= 56, ev[0]);
    assert.equal(at(rows, s0).puller, 'Arvid');
    // Kim is in front again after the ignore window: back as puller with since 0, not a fresh one.
    const back = rows.find(r => r.s > s0 && r.puller === 'Kim');
    assert.ok(back && back.s <= s0 + R.SELF_IGNORE_MS / 1000 + R.HOLD_MS / 1000 + 1, JSON.stringify(back));
    assert.equal(back.since, 0);
});

test('resumeFront keeps the pending start, the ignore and the last event', () => {
    const front = {...R.initialFront(), puller: 'A', since: 1000, pending: {id: 'me', at: 5000},
                   ignore: {id: 'X', at: 4000}, last: {kind: 'end', at: 3000}};
    const s = R.resumeFront(front, {now: 90000, frontId: 'B'});
    assert.equal(s.puller, 'B'); assert.equal(s.since, 90000);
    assert.deepEqual([s.pending, s.ignore, s.last], [front.pending, front.ignore, front.last]);
});

test('rotationStep: the next rider for my end comes from my fresh chain, not the grace set', () => {
    // I pull; Bodo (next in plan) was in my chain until 25 and is gone; Kim stays behind me.
    const rows = ride(t => {
        const others = [{idx: 2, dx: -4}];
        if (t < 25) others.push({idx: 1, dx: -2});
        return {me: {power: t >= 40 && t < 42 ? 80 : 280, draft: 0}, others};
    }, {dur: 46});
    assert.deepEqual(events(rows), ['41:end']);
    assert.equal(at(rows, 41).puller, 'Kim');
});

test('rotationStep: with 2 riders a late pass (up to 10 s after my drop) does not restart my pull', () => {
    // As above, but Bodo closes from closeAt and is 2 m ahead 4 s later, when my draft returns.
    const late = closeAt => ride(t => {
        let power = 280, draft = 0, dx = -2;
        if (t >= 40 && t < 42) power = 80;
        else if (t >= 42) power = 180;
        if (t >= closeAt) dx = Math.min(2, -2 + (t - closeAt));
        if (t >= closeAt + 4) draft = 100;
        return {me: {power, draft}, others: [{idx: 1, dx}]};
    }, {dur: 80});
    for (const closeAt of [43, 45, 47, 49, 50]) {
        const rows = late(closeAt);
        assert.deepEqual(events(rows), ['41:end'], `closeAt ${closeAt}`);
        for (let s = 41; s < 80; s++) {
            assert.equal(at(rows, s).puller, 'Bodo', `closeAt ${closeAt}, s ${s}`);
        }
    }
    // Still in front 13 s after the drop: no draft start either, and no position change: right after
    // my end the chaos hold (15 s) applies, and Bodo is past before that.
    const rows = late(52);
    assert.deepEqual(events(rows), ['41:end']);
    for (let s = 41; s < 80; s++) {
        assert.equal(at(rows, s).puller, 'Bodo', `late 52, s ${s}`);
    }
});

test('trackFront: a start of mine from my ignore window is not taken, also after the window', () => {
    let s = R.trackFront(R.initialFront(), {now: 0, frontId: 'me'});
    s = R.trackFront(s, {now: 41000, frontId: 'me', selfEnd: {id: 'me', at: 40000, nextId: 'B'}});
    // now is past the window (only the `at` rule can reject these).
    s = R.trackFront(s, {now: 52000, frontId: 'B', draftStart: {id: 'me', at: 42000}});
    assert.equal(s.puller, 'B');
    s = R.trackFront(s, {now: 52000, frontId: 'B', draftStart: {id: 'me', at: 49999}});
    assert.equal(s.puller, 'B');
    s = R.trackFront(s, {now: 52000, frontId: 'B', draftStart: {id: 'me', at: 50000}});
    assert.equal(s.puller, 'me'); assert.equal(s.since, 50000);
});

test('trackFront: a start not newer than my last own event is not taken (dedupe alone)', () => {
    // After an end, past the window, with `at` before the end: neither ignore rule applies.
    let s = R.trackFront(R.initialFront(), {now: 0, frontId: 'me'});
    s = R.trackFront(s, {now: 41000, frontId: 'me', selfEnd: {id: 'me', at: 40000, nextId: 'B'}});
    s = R.trackFront(s, {now: 60000, frontId: 'B', draftStart: {id: 'me', at: 39000}});
    assert.equal(s.puller, 'B');
    s = R.trackFront(s, {now: 60000, frontId: 'B', draftStart: {id: 'me', at: 40000}});
    assert.equal(s.puller, 'B');
    // After a dropped pending start (no ignore at all): a draft run from before the drop.
    let t = R.trackFront(R.initialFront(), {now: 0, frontId: 'A'});
    t = R.trackFront(t, {now: 50000, frontId: 'A', selfStart: {id: 'me', at: 49000}});
    t = R.trackFront(t, {now: 61000, frontId: 'A'});
    assert.equal(t.last.kind, 'revert'); assert.equal(t.ignore ?? null, null);
    t = R.trackFront(t, {now: 62000, frontId: 'A', draftStart: {id: 'me', at: 61000}});
    assert.equal(t.puller, 'A');
    t = R.trackFront(t, {now: 62000, frontId: 'A', draftStart: {id: 'me', at: 61001}});
    assert.equal(t.puller, 'me');
});

test('rotationStep: a draft start counts from when the gate opened, not from when I lost the wheel', () => {
    // Kim pulls from 0 (60 s). I lose his wheel at 30 (12 m, inside the chain, draft 0) and stay
    // gapped; at 60 he swings off and drops behind me by 64. Bodo is behind me throughout.
    const rows = ride(t => {
        let dx = 2;
        if (t >= 30 && t < 60) dx = Math.min(12, 2 + (t - 30) * 4);
        else if (t >= 60) dx = Math.max(-4, 12 - (t - 60) * 4);
        const draft = dx > 5 ? 0 : (dx < 0 ? 0 : 100);
        return {me: {power: 260, draft}, others: [{idx: 2, dx}, {idx: 1, dx: -2}]};
    }, {dur: 90});
    const ev = events(rows);
    assert.equal(ev.length, 1); assert.match(ev[0], /:draftStart$/);
    const s0 = Number(ev[0].split(':')[0]);
    assert.equal(at(rows, s0).puller, 'Arvid');
    // Kim's 60 s pull has 10 s left at 50: that is when the gate opened.
    assert.ok(at(rows, s0).since >= 50 && at(rows, s0).since <= 51, JSON.stringify(at(rows, s0)));
    assert.equal(at(rows, 89).puller, 'Arvid');
});


// Task 5: the wheel behind the front comes from the plan, not from the observed order.
test('planWheel: the present rider before me in plan order, counted from the puller', () => {
    const {plan} = P.importFiles([json, txt]);
    const all = plan.riders.map(r => r.id);
    const bodo = '5100004', kim = '5100003', dario = '5100002';
    // Order: Arvid, Bodo, Kim, Dario, Edda, Fritz. Bodo pulls, me Dario.
    assert.equal(R.planWheel(plan, {selfId: dario, pullerId: bodo, presentIds: all}), kim);
    assert.equal(R.planWheel(plan, {selfId: dario, pullerId: bodo,
                                    presentIds: all.filter(id => id !== kim)}), bodo);
    // The puller counts even when the presence list misses him.
    assert.equal(R.planWheel(plan, {selfId: dario, pullerId: bodo, presentIds: [dario]}), bodo);
    // Me = puller: nobody in front of me.
    assert.equal(R.planWheel(plan, {selfId: dario, pullerId: dario, presentIds: all}), null);
    // Wraps around: Fritz pulls, me Bodo -> Arvid (between Fritz and me), else Fritz.
    assert.equal(R.planWheel(plan, {selfId: bodo, pullerId: '51006', presentIds: all}), '5100005');
    assert.equal(R.planWheel(plan, {selfId: bodo, pullerId: '51006',
                                    presentIds: all.filter(id => id !== '5100005')}), '51006');
    // Unknown puller, not a plan rider, no plan.
    assert.equal(R.planWheel(plan, {selfId: dario, pullerId: null, presentIds: all}), null);
    assert.equal(R.planWheel(plan, {selfId: '510007', pullerId: bodo, presentIds: all}), null);
    assert.equal(R.planWheel(null, {selfId: dario, pullerId: bodo, presentIds: all}), null);
});

test('rotationStatus: the wheel follows the plan even when the observed order is scrambled', () => {
    const {plan} = P.importFiles([json, txt]);
    const bodo = '5100004', kim = '5100003', dario = '5100002', edda = '5100001';
    // Observed chain: Bodo at the front, then Edda (out of plan order) right in front of me, Kim last.
    const chain = [{id: bodo, x: 6}, {id: edda, x: 4}, {id: dario, x: 2, self: true}, {id: kim, x: 0}];
    const st = {...R.initialRotation(), chain, frontId: bodo, present: chain.map(c => c.id),
                front: {...R.initialFront(), puller: bodo, since: 0}};
    assert.equal(R.wheelOf(chain, dario), edda);
    const {view} = R.rotationStatus(st, {now: 10000, plan, selfId: dario, live: true});
    assert.equal(view.wheel.id, kim);
});


// Fix round 1: a plan swap mid-race keeps the rotation when the puller is still a rider.
function midRace() {
    const bodo = '5100004', kim = '5100003', dario = '5100002';
    return {
        ...R.initialRotation(),
        front: {...R.initialFront(), puller: bodo, since: 40000, cand: kim, candSince: 99000,
                prev: {puller: kim, since: 1000, at: 30000}, pending: {id: dario, at: 98000}},
        climb: {climbing: true, since: 90000, above: null, below: null},
        seen: {[bodo]: 99000, [kim]: 99000, [dario]: 99000},
        present: [bodo, kim, dario],
        run: {n: 1, at: 99000},
    };
}

test('carryRotation: puller still in the new plan -> front, climb and presence kept', () => {
    const {plan} = P.importFiles([json, txt]);
    const st = midRace();
    const next = R.carryRotation(st, plan);
    assert.equal(next.front.puller, '5100004');
    assert.equal(next.front.since, 40000);
    assert.deepEqual(next.front.pending, {id: '5100002', at: 98000});
    assert.equal(next.front.cand, '5100003');
    assert.deepEqual(next.front.prev, st.front.prev);
    assert.deepEqual(next.climb, st.climb);
    assert.deepEqual(next.seen, st.seen);
    assert.deepEqual(next.present, st.present);
    assert.deepEqual(next.run, st.run);
});

test('carryRotation: riders who left the plan are dropped from the kept state', () => {
    const {plan} = P.importFiles([json, txt]);
    const noKim = {...plan, riders: plan.riders.filter(r => r.id !== '5100003')};
    const next = R.carryRotation(midRace(), noKim);
    assert.equal(next.front.puller, '5100004');
    assert.equal(next.front.since, 40000);
    assert.equal(next.front.cand, null);
    assert.equal(next.front.candSince, null);
    assert.equal(next.front.prev, null);
    assert.deepEqual(Object.keys(next.seen).sort(), ['5100002', '5100004']);
    assert.deepEqual(next.present, ['5100004', '5100002']);
});

test('carryRotation: puller removed or no plan -> reset, climb kept', () => {
    const {plan} = P.importFiles([json, txt]);
    const noArno = {...plan, riders: plan.riders.filter(r => r.id !== '5100004')};
    const st = midRace();
    for (const p of [noArno, null]) {
        const next = R.carryRotation(st, p);
        assert.deepEqual(next.front, R.initialFront());
        assert.deepEqual(next.seen, {});
        assert.deepEqual(next.present, []);
        assert.deepEqual(next.run, R.initialRotation().run);
        assert.deepEqual(next.climb, st.climb);
    }
    // No puller yet: nothing to lose, the state carries on.
    const fresh = {...R.initialRotation(), seen: {'5100004': 5}, present: ['5100004']};
    assert.deepEqual(R.carryRotation(fresh, plan), fresh);
});


test('placeOf: my observed place in the chain, 1 = front', () => {
    const chain = [{id: 'A'}, {id: 'B'}, {id: 'C'}];
    assert.equal(R.placeOf(chain, 'A'), 1);
    assert.equal(R.placeOf(chain, 'C'), 3);
    assert.equal(R.placeOf(chain, 'X'), null);
    assert.equal(R.placeOf(null, 'A'), null);
});


test('plannedWheel: the rider before me in plan order, the last rider for #1, null off the plan', () => {
    const plan = {riders: [{id: 'a', name: 'A'}, {id: 'b', name: 'B'}, {id: 'c', name: 'C'}], bench: [{id: 'z'}]};
    assert.equal(R.plannedWheel(plan, 'b').id, 'a');
    assert.equal(R.plannedWheel(plan, 'c').id, 'b');
    assert.equal(R.plannedWheel(plan, 'a').id, 'c');
    assert.equal(R.plannedWheel(plan, 'z'), null);
    assert.equal(R.plannedWheel(plan, 'x'), null);
    assert.equal(R.plannedWheel(plan, null), null);
    assert.equal(R.plannedWheel(null, 'a'), null);
    assert.equal(R.plannedWheel({riders: [{id: 'a'}], bench: []}, 'a'), null);
});


test('wheelToFollow: the planned wheel, with the live one only when the planned rider is missing', () => {
    const a = {id: 'a'}, b = {id: 'b'}, c = {id: 'c'};
    const plan = {riders: [a, b, c], bench: []};
    // No rotation (before the start): the plan alone.
    assert.deepEqual(R.wheelToFollow(plan, 'c', null), {planned: b, live: null});
    // Rotation, live wheel is the planned one, or I pull (no live wheel): no change.
    assert.deepEqual(R.wheelToFollow(plan, 'c', {wheel: b}), {planned: b, live: null});
    assert.deepEqual(R.wheelToFollow(plan, 'c', {wheel: null}), {planned: b, live: null});
    // b is not with the group: follow a for now.
    assert.deepEqual(R.wheelToFollow(plan, 'c', {wheel: a}), {planned: b, live: a});
    // Not a plan rider: nothing.
    assert.equal(R.wheelToFollow(plan, 'x', {wheel: a}), null);
});


test('captainNext: live next, planned next after the last puller, plan #1 before the start, none in the sprint', () => {
    const a = {id: 'a'}, b = {id: 'b'}, c = {id: 'c'};
    const plan = {riders: [a, b, c], bench: []};
    // Rotation running: the live next rider.
    assert.deepEqual(R.captainNext({plan, view: {next: c}, reason: null, pullerId: 'a'}), {rider: c, planned: false});
    // Climb, alone, no data: the plan's next after the last puller (wrapping), marked as planned.
    assert.deepEqual(R.captainNext({plan, view: null, reason: 'climb', pullerId: 'b'}), {rider: c, planned: true});
    assert.deepEqual(R.captainNext({plan, view: null, reason: 'alone', pullerId: 'c'}), {rider: a, planned: true});
    assert.deepEqual(R.captainNext({plan, view: null, reason: 'nolive', pullerId: 'a'}), {rider: b, planned: true});
    // Rotation view without a next rider (nobody else present): planned as well.
    assert.deepEqual(R.captainNext({plan, view: {next: null}, reason: null, pullerId: 'a'}), {rider: b, planned: true});
    // Before the start (no puller yet, or one not in the plan): plan #1.
    assert.deepEqual(R.captainNext({plan, view: null, reason: 'nofront', pullerId: null}), {rider: a, planned: true});
    assert.deepEqual(R.captainNext({plan, view: null, reason: 'nolive', pullerId: 'zz'}), {rider: a, planned: true});
    // Final sprint (rotation off) and no plan: nothing.
    assert.equal(R.captainNext({plan, view: null, reason: 'finish', pullerId: 'a'}), null);
    assert.equal(R.captainNext({plan: null, view: null, reason: 'noplan', pullerId: null}), null);
});


test('dashKind before the start: no amber "?" until a puller has been seen', () => {
    for (const reason of ['alone', 'nolive', 'nofront']) {
        assert.equal(R.dashKind(reason, {started: false}), 'none');
        assert.equal(R.dashKind(reason, {started: true}), 'unknown');
        assert.equal(R.dashKind(reason), 'unknown');
    }
    assert.equal(R.dashKind('climb', {started: false}), 'climb');
    assert.equal(R.dashKind('noplan', {started: false}), 'none');
});


test('skipped pulls: whoever holds the front takes over; countdown, place and Next follow', () => {
    const riders = ['a', 'b', 'c', 'd'].map(id => ({id, name: id.toUpperCase(), pullS: 60, watts: 250}));
    const plan = {riders, bench: []};
    const all = ['a', 'b', 'c', 'd'];
    const viewFor = (pullerId, chainIds, now = 0, since = 0) => R.rotationView(plan, {
        selfId: 'c', chainIds, front: {puller: pullerId, since}, now,
        wheelId: R.planWheel(plan, {selfId: 'c', pullerId, presentIds: chainIds}),
    });
    // B pulls and is due; I (C) am next.
    let v = viewFor('b', all, 55000, 0);
    assert.equal(v.place, 2);
    assert.equal(v.toMyPullS, 5);
    // I do not come through; D is at the front for HOLD_MS and becomes the puller.
    let f = {puller: 'b', since: 0, cand: null, candSince: null};
    for (const t of [60000, 61000, 62000, 60000 + R.HOLD_MS]) {
        f = R.trackFront(f, {now: t, frontId: 'd'});
    }
    assert.equal(f.puller, 'd');
    v = viewFor('d', all, 60000 + R.HOLD_MS, f.since);
    assert.equal(v.place, 4);                       // last in the line now
    assert.equal(v.toMyPullS, 180 + 2 * R.CHANGE_ALLOWANCE_S - (60000 + R.HOLD_MS - f.since) / 1000);    // a full cycle: D, A, B
    assert.equal(R.captainNext({plan, view: v, reason: null, pullerId: 'd'}).rider.id, 'a');
    assert.equal(R.wheelToFollow(plan, 'c', v).planned.id, 'b');    // the wheel stays the plan's
    // A skips: B takes over straight from D; A's pull is no longer counted before mine.
    v = viewFor('b', all);
    assert.equal(v.place, 2);
    assert.equal(v.toMyPullS, 60);
});


test('stillStep: standing still pauses the rotation; at once before any puller, after STOP_MS once one runs', () => {
    const s0 = {still: false, since: null};
    // Never tracked (start pen): still at the first slow sample.
    assert.deepEqual(R.stillStep(s0, {now: 1000, speed: 0, tracking: false}), {still: true, since: 1000});
    // A rotation runs: a short stop does not count, a held one does.
    let s = R.stillStep(s0, {now: 1000, speed: 1, tracking: true});
    assert.equal(s.still, false);
    s = R.stillStep(s, {now: 1000 + R.STOP_MS, speed: 0, tracking: true});
    assert.equal(s.still, true);
    // Moving again ends it at once; no speed in the data keeps the last state.
    assert.deepEqual(R.stillStep(s, {now: 9000, speed: R.STOP_KMH + 1, tracking: false}), {still: false, since: null});
    assert.deepEqual(R.stillStep(s, {now: 9000, speed: undefined, tracking: true}), s);
});


test('rotationStep: no rotation in the start pen; plan #1 pulls from the roll-off with the start bonus', () => {
    // I am #2. In the pen #1 stands 2 m ahead of me and #3 2 m behind, everyone at 0 km/h, 0 W,
    // draft 0, for 2 minutes. At 120 the group rolls off at 40 km/h with #1 in front.
    const rows = ride(t => {
        const go = t >= 120;
        return {me: {power: go ? 180 : 0, draft: go ? 60 : 0, speed: go ? 40 : 0},
                others: [{idx: 0, dx: 2, power: go ? 300 : 0}, {idx: 2, dx: -2, power: go ? 180 : 0}]};
    }, {selfIdx: 1, dur: 140});
    for (const r of rows.filter(r => r.s < 120)) {
        assert.equal(r.puller, null, `no puller in the pen at ${r.s}`);
        assert.equal(r.view, 'still', `pen view at ${r.s}`);
    }
    assert.deepEqual(events(rows), []);    // no own pull start or end in the pen
    const first = at(rows, 120);
    assert.equal(first.puller, 'Arvid');
    assert.equal(first.since, 120, 'his clock runs from the roll-off');
    assert.equal(at(rows, 139).view, 'rest');
});


// ---------- 0.2.14: quiet start, the puller's clock after a pause (ride of 12 Nov 2026) ----------

test('rotationStep: after the start the windows stay quiet until plan #1 is in front; he sees his pull at once', () => {
    // As the pen test: the group rolls off at 120 with #1 in front.
    const pen = t => {
        const go = t >= 120;
        return {me: {power: go ? 180 : 0, draft: go ? 60 : 0, speed: go ? 40 : 0},
                others: [{idx: 0, dx: 2, power: go ? 300 : 0}, {idx: 2, dx: -2, power: go ? 180 : 0}]};
    };
    const rows = ride(pen, {selfIdx: 1, dur: 170, quietStart: true});
    assert.equal(at(rows, 119).view, 'still');
    const found = 120 + R.HOLD_MS / 1000;
    for (let s = 120; s < found; s++) {
        assert.equal(at(rows, s).view, 'start', `quiet at ${s}`);
    }
    assert.equal(at(rows, found).view, 'rest', 'Arvid is in front: the start chaos is over');
    // The engine's own view is not quiet.
    assert.equal(at(ride(pen, {selfIdx: 1, dur: 140}), 121).view, 'rest');
    // I am Arvid (#1): my pull shows from the roll-off.
    const mine = ride(t => {
        const go = t >= 120;
        return {me: {power: go ? 300 : 0, draft: go ? 0 : 0, speed: go ? 40 : 0},
                others: [{idx: 1, dx: -2, power: go ? 180 : 0}, {idx: 2, dx: -4, power: go ? 180 : 0}]};
    }, {selfIdx: 0, dur: 130, quietStart: true});
    assert.equal(at(mine, 120).view, 'pull');
});


// ---------- 0.2.21: the start is set, not detected (four recordings of 12 Nov 2026) ----------

// Start pen until 120, then the group rolls off. I am Kim (#3); front(t) says who leads after it.
function start(front, {dur = 320, grade = () => 0, quietStart = false} = {}) {
    return ride(t => {
        const go = t >= 120;
        const lead = go ? front(t) : null;
        const dx = idx => lead === idx ? 6 : idx === 0 ? 2 : 4 - idx;
        return {me: {power: go ? 180 : 0, draft: go ? 60 : 0, speed: go ? 40 : 0, grade: go ? grade(t) : 0},
                others: [{idx: 0, dx: dx(0), power: go ? 300 : 0}, {idx: 1, dx: dx(1), power: go ? 250 : 0},
                         {idx: 4, dx: -4, power: go ? 180 : 0}]};
    }, {selfIdx: 2, dur, quietStart});
}


test('rotationStep: at the start plan #1 pulls, nothing is detected for START_LOCK_MS', () => {
    // Bodo (#2) leads the first 50 s (as in two of the recordings), then Arvid (#1).
    const rows = start(t => t < 170 ? 1 : 0);
    for (let s = 120; s < 120 + R.START_LOCK_MS / 1000; s++) {
        assert.equal(at(rows, s).puller, 'Arvid', `start puller at ${s}`);
        assert.equal(at(rows, s).since, 120);
    }
    assert.equal(at(rows, 230).puller, 'Arvid', 'he goes on after the lock');
    assert.equal(at(rows, 230).since, 120);
});


test('rotationView: the start puller\'s first pull is his plan time plus START_BONUS_S', () => {
    const {plan} = P.importFiles([json, txt]);
    const [arvid, , kim] = plan.riders;
    const front = {...R.initialFront(), puller: arvid.id, since: 0, bonus: {id: arvid.id, since: 0, s: R.START_BONUS_S}};
    const v = R.rotationView(plan, {selfId: kim.id, chainIds: null, wheelId: null, front, now: 10000});
    assert.equal(v.pullS, arvid.pullS + R.START_BONUS_S);
    assert.equal(v.remainingS, arvid.pullS + R.START_BONUS_S - 10);
    // A later pull of his (another since) has no bonus.
    const later = R.rotationView(plan, {selfId: kim.id, chainIds: null, wheelId: null, front: {...front, since: 500000}, now: 510000});
    assert.equal(later.pullS, arvid.pullS);
});


test('rotationStep: if plan #1 never leads, the windows stay quiet for the whole lock', () => {
    const rows = start(() => 1, {quietStart: true});
    for (let s = 120; s < 120 + R.START_LOCK_MS / 1000; s++) {
        assert.equal(at(rows, s).view, 'start', `quiet at ${s}`);
    }
    assert.equal(at(rows, 120 + R.START_LOCK_MS / 1000).view, 'rest');
});


test('rotationStep: after START_LOCK_MS the front rider is detected again (chaos hold)', () => {
    // Arvid never comes to the front: Bodo leads throughout.
    const rows = start(() => 1);
    const end = 120 + R.START_LOCK_MS / 1000;
    assert.equal(at(rows, end - 1).puller, 'Arvid');
    assert.equal(at(rows, end + R.CHAOS_HOLD_MS / 1000 - 2).puller, 'Arvid', 'the chaos hold applies');
    assert.equal(at(rows, end + R.CHAOS_HOLD_MS / 1000 + 2).puller, 'Bodo');
});


test('rotationStep: no climb pause in the start lock, and a nonsense grade is ignored', () => {
    // A 6 % start ramp for 90 s: not paused within the lock, a real climb after it.
    const rows = start(() => 0, {grade: t => t < 210 ? 6 : 0});
    for (let s = 120; s < 120 + R.START_LOCK_MS / 1000; s++) {
        assert.notEqual(at(rows, s).view, 'climb', `no climb in the lock at ${s}`);
    }
    // The first rider's pen and launch: 131 % for 30 s.
    let c = R.initialClimb();
    for (let t = 0; t <= 30000; t += 1000) {
        c = R.climbState(c, {now: t, grade: 131});
    }
    assert.equal(c.climbing, false);
});


test('rotationStep: a stop during the ride is no start (no lock, no start puller)', () => {
    // Moving from 0 with Arvid in front; standing 60..70; from 70 Bodo leads.
    const rows = ride(t => {
        const stop = t >= 60 && t < 70, bodo = t >= 70;
        return {me: {power: stop ? 0 : 180, draft: 60, speed: stop ? 0 : 40},
                others: [{idx: 0, dx: bodo ? 4 : 6}, {idx: 1, dx: bodo ? 6 : 3}]};
    }, {selfIdx: 2, dur: 120});
    assert.equal(at(rows, 100).puller, 'Bodo');
});


test('startQuiet: only within START_QUIET_MS of the roll-off', () => {
    assert.equal(R.startQuiet(R.initialRotation(), 5000), false);
    const st = {...R.initialRotation(), rolledAt: 1000};
    assert.equal(R.startQuiet(st, 1000 + R.START_QUIET_MS - 1), true);
    assert.equal(R.startQuiet(st, 1000 + R.START_QUIET_MS), false);
});


test('pauseClock: the puller from before a climb gets his clock back within RESUME_MS', () => {
    const S = {puller: 'S', since: 0}, A = {puller: 'A', since: 90000};
    // The climb begins while S pulls (since 0, 70 s pulled), and ends at 90 with A adopted at once.
    let r = R.pauseClock(null, {now: 70000, pausedBefore: false, pausedNow: true, before: S, front: S});
    assert.deepEqual(r.pause, {puller: 'S', held: 70000, end: null});
    r = R.pauseClock(r.pause, {now: 90000, pausedBefore: true, pausedNow: false, before: S, front: A});
    assert.deepEqual(r, {pause: {puller: 'S', held: 70000, end: 90000}, front: A});
    // Back in front from 107: his 70 s from before the climb, plus the time since 107. Neither the
    // climb nor A's pull counts (13 Nov 2026, one rider's recording: his clock read 78 s instead of 10).
    const back = R.pauseClock(r.pause, {now: 110000, pausedBefore: false, pausedNow: false, before: A,
                                        front: {puller: 'S', since: 107000}});
    assert.deepEqual(back, {pause: null, front: {puller: 'S', since: 37000}});
    // Too late, or someone else: a fresh clock as before.
    const late = R.pauseClock(r.pause, {now: 90000 + R.RESUME_MS, pausedBefore: false, pausedNow: false,
                                        before: A, front: {puller: 'S', since: 147000}});
    assert.deepEqual(late, {pause: null, front: {puller: 'S', since: 147000}});
    const other = R.pauseClock(r.pause, {now: 110000, pausedBefore: false, pausedNow: false, before: A,
                                         front: {puller: 'C', since: 107000}});
    assert.deepEqual(other, {pause: r.pause, front: {puller: 'C', since: 107000}});
    // He simply carried on after the climb: his clock is untouched and the memory is gone.
    const same = R.pauseClock({puller: 'S', held: 70000, end: null},
                              {now: 90000, pausedBefore: true, pausedNow: false, before: S, front: S});
    assert.deepEqual(same, {pause: null, front: S});
});


test('rotationStep: after a climb, the puller from before it gets his clock back when he returns', () => {
    // I am Kim (#3). Arvid pulls from 0; a real climb (route profile) from 40 to 55; after it Bodo
    // is in front until 80, then Arvid again.
    const climb = {hill: {kind: 'climb', roller: false}}, flat = {hill: null};
    const rows = ride(t => {
        const grade = t >= 40 && t < 55 ? 6 : 0;
        const bentFront = t >= 55 && t < 80;
        return {me: {power: 220, draft: 80, grade},
                others: [{idx: 0, dx: bentFront ? 2 : 6}, {idx: 1, dx: bentFront ? 6 : 2}]};
    }, {selfIdx: 2, dur: 100, terrain: t => t >= 40 && t < 55 ? climb : flat});
    assert.equal(at(rows, 39).view, 'rest');
    assert.equal(at(rows, 40).view, 'climb', 'the profile pauses from the first metre');
    assert.equal(at(rows, 70).puller, 'Bodo');
    assert.equal(at(rows, 95).puller, 'Arvid');
    // He pulled 0..40 before the climb and is back from 80: 40 s + 15 s, not the 95 s since 0.
    const elapsed = 95 - at(rows, 95).since;
    assert.ok(Math.abs(elapsed - 55) <= 2, `Arvid keeps his 40 s from before the climb (${elapsed} s)`);
});


test('climbState: a descent pauses after 5 s at -3 % or steeper, until 5 s above -2 %', () => {
    let s = R.initialClimb();
    s = R.climbState(s, {now: 0, grade: -3});
    s = R.climbState(s, {now: 3000, grade: -2.5});             // the entry timer starts again
    assert.equal(s.climbing, false);
    s = R.climbState(s, {now: 4000, grade: -4});
    s = R.climbState(s, {now: 8999, grade: -5});
    assert.equal(s.climbing, false);
    s = R.climbState(s, {now: 9000, grade: -5});
    assert.equal(s.climbing, true); assert.equal(s.descent, true);
    s = R.climbState(s, {now: 10000, grade: -1});              // 1 s flat
    s = R.climbState(s, {now: 11000, grade: -3});
    s = R.climbState(s, {now: 16000, grade: -2});              // -2 % is not above -2 %
    assert.equal(s.climbing, true);
    s = R.climbState(s, {now: 17000, grade: -1.9});
    s = R.climbState(s, {now: 21999, grade: 0});
    assert.equal(s.climbing, true);
    s = R.climbState(s, {now: 22000, grade: 0});
    assert.equal(s.climbing, false); assert.equal(s.descent, false);
    // A climb is still a climb, not a descent.
    let c = R.initialClimb();
    for (let t = 0; t <= 5000; t += 1000) c = R.climbState(c, {now: t, grade: 5});
    assert.equal(c.climbing, true); assert.equal(c.descent, false);
});


test('dashReason and dashKind: a descent', () => {
    const plan = {riders: [{id: 'me'}, {id: 'b'}]};
    const ok = {plan, selfId: 'me', live: true, finish: false, climbing: true, descent: true,
                chain: [{id: 'me', self: true}, {id: 'b'}]};
    assert.equal(R.dashReason(ok), 'descent');
    assert.equal(R.dashReason({...ok, descent: false}), 'climb');
    assert.equal(R.dashKind('descent'), 'descent');
});


test('rotationStep: a real descent pauses the rotation; a rider sprinting up meanwhile is no puller until it ends', () => {
    // I am Kim (#3). Arvid pulls from 0; a long descent (route profile) from 40 to 60. From 48
    // Bodo sprints up from behind and stays in front, Arvid drops back.
    const descent = {hill: {kind: 'descent', roller: false}}, flat = {hill: null};
    const rows = ride(t => {
        const grade = t >= 40 && t < 60 ? -5 : 0;
        const bentFront = t >= 48;
        return {me: {power: 150, draft: 80, grade},
                others: [{idx: 0, dx: bentFront ? 2 : 6}, {idx: 1, dx: bentFront ? 6 : -3}]};
    }, {selfIdx: 2, dur: 90, terrain: t => t >= 40 && t < 60 ? descent : flat});
    assert.equal(at(rows, 39).view, 'rest');
    for (let s = 40; s < 60; s++) {
        assert.equal(at(rows, s).view, 'descent', `paused at ${s}`);
        assert.equal(at(rows, s).puller, 'Arvid', `no change during the descent at ${s}`);
    }
    assert.equal(at(rows, 70).puller, 'Bodo');
    assert.ok(at(rows, 70).since >= 60, 'Bodo starts a fresh clock after the descent');
});


test('rotationStep: on a roller the rotation goes on; only the puller or the plan\'s next may take the front', () => {
    // I am Kim (#3), no route profile. Arvid pulls from 0; a descent from 40 to 60 (a roller by the
    // live grade: shorter than ROLLER_LIVE_MS). From 46 Edda (#5) sprints up from behind and leads
    // until 60; from 52 Bodo (#2, the plan's next) is right behind him, then in front.
    const rows = ride(t => {
        const grade = t >= 40 && t < 60 ? -5 : 0;
        const edda = t >= 46 && t < 60, bodo = t >= 52;
        return {me: {power: 150, draft: 80, grade},
                others: [{idx: 0, dx: edda || bodo ? 4 : 6}, {idx: 1, dx: bodo ? 5 : -3},
                         {idx: 4, dx: edda ? 7 : -6}]};
    }, {selfIdx: 2, dur: 90});
    for (let s = 40; s < 66; s++) {
        assert.equal(at(rows, s).view, 'rest', `the countdown stays at ${s}`);
    }
    for (let s = 46; s < 60; s++) {
        assert.notEqual(at(rows, s).puller, 'Edda', `Edda is ignored at ${s}`);
    }
    assert.equal(at(rows, 51).puller, 'Arvid');
    assert.equal(at(rows, 75).puller, 'Bodo', 'the plan\'s next took over');
});


test('rotationStep: by the live grade a climb is a real one after ROLLER_LIVE_MS', () => {
    const rows = ride(t => ({me: {power: 220, draft: 80, grade: t >= 10 ? 6 : 0},
                             others: [{idx: 0, dx: 6}, {idx: 1, dx: 2}]}), {selfIdx: 2, dur: 80});
    const enter = 10 + R.CLIMB_ENTER_MS / 1000;
    assert.equal(at(rows, enter + R.ROLLER_LIVE_MS / 1000 - 1).view, 'rest');
    assert.equal(at(rows, enter + R.ROLLER_LIVE_MS / 1000).view, 'climb');
});


test('hillMode: the route profile wins; without it the live climb, a roller at first', () => {
    const live = {climbing: true, descent: true, since: 1000};
    assert.deepEqual(R.hillMode(live, {now: 2000, terrain: {hill: null}}), {mode: null, descent: false});
    assert.deepEqual(R.hillMode(R.initialClimb(), {now: 2000, terrain: {hill: {kind: 'climb', roller: true}}}),
                     {mode: 'flag', descent: false});
    assert.deepEqual(R.hillMode(R.initialClimb(), {now: 2000, terrain: {hill: {kind: 'descent', roller: false}}}),
                     {mode: 'pause', descent: true});
    assert.deepEqual(R.hillMode(live, {now: 1000 + R.ROLLER_LIVE_MS - 1}), {mode: 'flag', descent: true});
    assert.deepEqual(R.hillMode(live, {now: 1000 + R.ROLLER_LIVE_MS}), {mode: 'pause', descent: true});
    assert.deepEqual(R.hillMode(R.initialClimb(), {now: 2000}), {mode: null, descent: false});
});


test('skipsAhead: a front rider one or two places past the planned next rider', () => {
    const plan = {riders: ['S', 'A', 'M', 'R', 'C'].map(id => ({id}))};
    // Cora pulls, Selma is next (wrap): Aldo would skip Selma, Milo skip two.
    assert.equal(R.skipsAhead(plan, {pullerId: 'C', nextId: 'S', frontId: 'A'}), true);
    assert.equal(R.skipsAhead(plan, {pullerId: 'C', nextId: 'S', frontId: 'M'}), true);
    assert.equal(R.skipsAhead(plan, {pullerId: 'C', nextId: 'S', frontId: 'R'}), false);
    assert.equal(R.skipsAhead(plan, {pullerId: 'C', nextId: 'S', frontId: 'S'}), false);    // the planned one
    // Aldo pulls, Milo next: Selma (who pulled before Aldo) coming back is no skip.
    assert.equal(R.skipsAhead(plan, {pullerId: 'A', nextId: 'M', frontId: 'S'}), false);
    assert.equal(R.skipsAhead(plan, {pullerId: null, nextId: 'M', frontId: 'S'}), false);
    assert.equal(R.skipsAhead(plan, {pullerId: 'A', nextId: undefined, frontId: 'R'}), false);
});


test('trackFront: a front rider who skips the planned next one needs CHAOS_HOLD_MS', () => {
    let s = R.trackFront(R.initialFront(), {now: 0, frontId: 'C'});
    for (const now of [40000, 43000, 54999]) {
        s = R.trackFront(s, {now, frontId: 'A', slowId: 'A'});
    }
    assert.equal(s.puller, 'C');
    s = R.trackFront(s, {now: 55000, frontId: 'A', slowId: 'A'});
    assert.equal(s.puller, 'A'); assert.equal(s.since, 40000);
    // The planned one (not slow) after the usual 3 s.
    let u = R.trackFront(R.initialFront(), {now: 0, frontId: 'C'});
    u = R.trackFront(u, {now: 40000, frontId: 'S', slowId: null});
    u = R.trackFront(u, {now: 43000, frontId: 'S', slowId: null});
    assert.equal(u.puller, 'S');
});


test('rotationStep: Aldo in front for a moment during the change from Cora to Selma is no puller', () => {
    // Rollers fixture order: Arvid, Bodo, Kim, Dario, Edda, Fritz. I am Dario (#4). Edda pulls
    // from 0, well past the chaos window; Fritz is next. From 60 to 70 Arvid (who would skip
    // Fritz) is in front, then Fritz.
    const rows = ride(t => {
        let edda = 6, fritz = 2, arvid = -6;
        if (t >= 60 && t < 70) { arvid = 8; fritz = 4; edda = 2; }
        else if (t >= 70) { fritz = 8; arvid = 4; edda = -8; }
        return {me: {power: 200, draft: 90}, others: [{idx: 4, dx: edda}, {idx: 5, dx: fritz}, {idx: 0, dx: arvid}]};
    }, {selfIdx: 3, dur: 100});
    assert.equal(at(rows, 59).puller, 'Edda');
    for (let s = 60; s < 74; s++) {
        assert.notEqual(at(rows, s).puller, 'Arvid', `s ${s}`);
    }
    assert.equal(at(rows, 80).puller, 'Fritz');
});


test('rotationTable: rotation order from the puller, plan numbers, presence', () => {
    const plan = {riders: ['S', 'A', 'M', 'R', 'C'].map(id => ({id}))};
    const ids = rows => rows.map(r => r.rider.id).join('');
    // Before any puller: from plan #1, everyone present.
    let t = R.rotationTable(plan);
    assert.equal(ids(t), 'SAMRC');
    assert.deepEqual(t.map(r => r.number), [1, 2, 3, 4, 5]);
    assert.ok(t.every(r => r.present && !r.pulling));
    // Cora pulls; Rolf dropped.
    t = R.rotationTable(plan, {pullerId: 'C', presentIds: ['S', 'A', 'M']});
    assert.equal(ids(t), 'CSAMR');
    assert.deepEqual(t.map(r => r.number), [5, 1, 2, 3, 4]);
    assert.equal(t[0].pulling, true); assert.equal(t[0].present, true);    // the puller always counts
    assert.equal(t[4].present, false);
    // Dropped riders come last, in plan order, whoever pulls (user, 14 Nov 2026).
    t = R.rotationTable(plan, {pullerId: 'M', presentIds: ['S', 'R']});
    assert.equal(ids(t), 'MRSAC');
    assert.deepEqual(t.map(r => r.present), [true, true, true, false, false]);
    t = R.rotationTable(plan, {pullerId: 'S', presentIds: ['M', 'C']});
    assert.equal(ids(t), 'SMCAR');
    assert.deepEqual(R.rotationTable(null), []);
});


test('tableShown: before the start always, during the ride with the option', () => {
    const plan = {riders: [{id: 'a'}]};
    assert.equal(R.tableShown({plan, always: false, pullerId: null, reason: null}), true);
    assert.equal(R.tableShown({plan, always: false, pullerId: 'a', reason: 'still'}), true);
    assert.equal(R.tableShown({plan, always: false, pullerId: 'a', reason: 'start'}), true);
    assert.equal(R.tableShown({plan, always: false, pullerId: 'a', reason: null}), false);
    assert.equal(R.tableShown({plan, always: true, pullerId: 'a', reason: null}), true);
    assert.equal(R.tableShown({plan: null, always: true, pullerId: null, reason: null}), false);
});
