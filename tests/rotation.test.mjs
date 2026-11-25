// Run with: node --test tests/rotation.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as P from '../pages/src/engine/plan.mjs';
import * as R from '../pages/src/engine/rotation.mjs';
import * as O from '../pages/src/engine/order.mjs';

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

test('trackFront: under a long hold a candidate back within CAND_GAP_N samples keeps his candSince', () => {
    // Audit fixes, 20 Nov 2026 (I5), narrowed 21 Nov 2026 (review): only under the back or chaos
    // hold; under the plain HOLD_MS (the test above) and the skip hold he starts over.
    assert.equal(R.CAND_GAP_N, 2);
    const A0 = {...R.initialFront(), puller: 'A', since: 0, changedAt: 0};
    const run = (s, steps, opts) => steps.reduce((x, [now, frontId]) => R.trackFront(x, {now, frontId, ...opts}), s);
    const secs = (from, to, id) => Array.from({length: to - from}, (_, k) => [(from + k) * 1000, id]);
    // Back hold: B (the rider before A) in front from 100 s, A for 2 samples at 110 and 111.
    let s = run(A0, [...secs(100, 110, 'B'), [110000, 'A'], [111000, 'A'], ...secs(112, 130, 'B')], {backId: 'B'});
    assert.equal(s.candSince, 100000);
    assert.equal(s.puller, 'A');                          // 29 s
    s = R.trackFront(s, {now: 130000, frontId: 'B', backId: 'B'});
    assert.equal(s.puller, 'B'); assert.equal(s.since, 100000);
    // Gone for 3 samples: he starts over.
    s = run(A0, [...secs(100, 110, 'B'), [110000, 'A'], [111000, 'A'], [112000, 'A'], [113000, 'B']], {backId: 'B'});
    assert.equal(s.candSince, 113000);
    // Gone for 2 samples, but back HOLD_MS after the first of them: he starts over.
    s = run(A0, [[100000, 'B'], [110000, 'A'], [112500, 'A'], [113000, 'B']], {backId: 'B'});
    assert.equal(s.candSince, 113000);
    // Skip hold: not kept. rotationStep passes slowId only for this step's front rider (skipsAhead),
    // so in the step D is in front C has no skip hold and drops out (final review, 21 Nov 2026, M-1,
    // probe c1: through rotationStep #3 under the skip hold restarted his hold as before I5).
    const skip = (x, [now, frontId]) => R.trackFront(x, {now, frontId, slowId: frontId === 'C' ? 'C' : null});
    s = [[100000, 'C'], [101000, 'D'], [102000, 'C']].reduce(skip, A0);
    assert.equal(s.candSince, 102000);
    // Chaos hold (a change 10 s ago): kept; another rider in between counts.
    s = run({...A0, changedAt: 90000}, [[100000, 'C'], [101000, 'A'], [102000, 'C']], {});
    assert.equal(s.candSince, 100000);
    // Plain hold: no.
    s = run(A0, [[100000, 'C'], [101000, 'A'], [102000, 'C']], {backId: 'B'});
    assert.equal(s.candSince, 102000);
    assert.equal(s.lost, null);
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

test('trackFront: the rider who pulled before the puller takes the front back only after BACK_HOLD_MS', () => {
    assert.equal(R.BACK_HOLD_MS, 30000);
    // B pulls since 0 (the last change long ago); A, who pulled before him, is in front from 100 s.
    let s = {...R.initialFront(), puller: 'B', since: 0, changedAt: 0};
    for (let t = 100; t < 130; t++) {
        s = R.trackFront(s, {now: t * 1000, frontId: 'A', backId: 'A'});
    }
    assert.equal(s.puller, 'B');                          // 29 s: still B (12 Nov race: 15 s, then B again)
    s = R.trackFront(s, {now: 130000, frontId: 'A', backId: 'A'});
    assert.equal(s.puller, 'A'); assert.equal(s.since, 100000);    // he really pulls on: backdated
    // Back to B within the hold: B keeps his since, the clock never moved.
    let f = {...R.initialFront(), puller: 'B', since: 0, changedAt: 0};
    for (let t = 100; t < 115; t++) {
        f = R.trackFront(f, {now: t * 1000, frontId: 'A', backId: 'A'});
    }
    f = R.trackFront(f, {now: 115000, frontId: 'B', backId: 'A'});
    assert.deepEqual([f.puller, f.since, f.cand], ['B', 0, null]);
    // Anyone else keeps the normal hold.
    let g = {...R.initialFront(), puller: 'B', since: 0, changedAt: 0};
    for (const t of [100, 101, 102, 103]) {
        g = R.trackFront(g, {now: t * 1000, frontId: 'C', backId: 'A'});
    }
    assert.equal(g.puller, 'C');
    // After a pause adopted B from a scrambled order, A is not held back longer than the chaos hold.
    let h = R.resumeFront({...R.initialFront(), puller: 'A', since: 0, changedAt: 0}, {now: 50000, frontId: 'B'});
    assert.equal(h.puller, 'B');
    for (let t = 60; t <= 75; t++) {
        h = R.trackFront(h, {now: t * 1000, frontId: 'A', backId: 'A'});
    }
    assert.equal(h.puller, 'A');                          // 15 s (chaos window after the pause)
});


test('riderBefore: the present rider directly before the puller in plan order', () => {
    const plan = {riders: ['a', 'b', 'c', 'd'].map(id => ({id}))};
    assert.equal(R.riderBefore(plan, {pullerId: 'c', presentIds: ['a', 'b', 'c', 'd']}), 'b');
    assert.equal(R.riderBefore(plan, {pullerId: 'c', presentIds: ['a', 'c', 'd']}), 'a');      // b gone
    assert.equal(R.riderBefore(plan, {pullerId: 'a', presentIds: ['a', 'b', 'c', 'd']}), 'd');  // wraps
    assert.equal(R.riderBefore(plan, {pullerId: 'a', presentIds: ['a']}), null);
    assert.equal(R.riderBefore(plan, {pullerId: 'x', presentIds: ['a']}), null);
    // A line of two has no rider before the puller (audit fixes, 20 Nov 2026, I3).
    assert.equal(R.riderBefore(plan, {pullerId: 'a', presentIds: ['a', 'b']}), null);
    assert.equal(R.riderBefore(plan, {pullerId: 'c', presentIds: ['a', 'c']}), null);
    assert.equal(R.riderBefore(plan, {pullerId: 'a', presentIds: ['b']}), null);
});


test('rotationView: time to my pull skips absent riders', () => {
    const {plan} = P.importFiles([json, txt]);
    const front = {puller: '5100004', since: 0};           // Bodo pulling 60 s
    const all = plan.riders.map(r => r.id);
    let v = R.rotationView(plan, {selfId: '5100002', chainIds: all, wheelId: '5100003', front, now: 20000});
    assert.equal(v.toMyPullS, 40 + R.CHANGE_ALLOWANCE_LONG_S + 60);   // rest of Bodo (and the overhead of a 60 s pull) + Kim (before me)
    assert.equal(v.place, 3);                             // Bodo 1, Kim 2, me 3
    assert.equal(v.next.id, '5100003'); assert.equal(v.wheel.colorName, 'Yellow'); assert.equal(v.mine, false);
    v = R.rotationView(plan, {selfId: '5100002', chainIds: all.filter(id => id !== '5100003'), wheelId: null, front, now: 20000});
    assert.equal(v.toMyPullS, 40);                        // Kim absent: Bodo is before me, his plan alone
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
    const red = (15 - 10) / 30, f = Math.log(1 + 2.5 / 5) / Math.log(1 + 20 / 5);
    assert.equal(b.zone, 'red'); assert.ok(Math.abs(b.pos - (0.5 + 10 / 30 + red * f)) < 1e-9);
    assert.equal(R.powerBar(400, 280).pos, 1);
    assert.equal(R.powerBar(100, 280).pos, 0);
    assert.equal(R.powerBar(280, 280).pos, 0.5);
    assert.equal(R.powerBar(280, 0), null);                   // no usable target
});

test('powerBar: green and amber linear, the red ends logarithmic out to RED_MAX_PCT', () => {
    assert.deepEqual([R.RED_MAX_PCT, R.RED_LOG_K], [30, 5]);
    const pos = w => R.powerBar(w, 300).pos;
    const near = (got, want) => assert.ok(Math.abs(got - want) < 0.0005, `${got} vs ${want}`);
    assert.equal(pos(300), 0.5);
    near(pos(315), 0.6667);                                   // +5 %
    near(pos(330), 0.8333);                                   // +10 %: where the red end starts
    near(pos(345), 0.9051);                                   // +15 %
    near(pos(360), 0.9471);                                   // +20 %
    assert.equal(pos(390), 1);                                // +30 %: the end
    assert.equal(pos(450), 1);
    near(pos(255), 0.0949);                                   // -15 %
    assert.equal(pos(210), 0);                                // -30 %
    assert.equal(R.powerBar(345, 300).zone, 'red');
    assert.equal(R.powerBar(325, 300).zone, 'amber');
    assert.ok(pos(345) > pos(330) && pos(360) > pos(345) && pos(380) > pos(360));   // still rising
});


// Fix round 1: pin behaviour that mutations survived.

function planAll() {
    const {plan} = P.importFiles([json, txt]);
    return {plan, all: plan.riders.map(r => r.id)};
}

test('rotationView: past his expected end the countdown runs on RUN_ON_S, then waits for the change', () => {
    const {plan, all} = planAll();
    assert.equal(R.RUN_ON_S, 3);
    // Bodo (60 s) pulling, expected to end at 60 + K; me Dario, Kim (60 s, directly before me) between.
    const at = s => R.rotationView(plan, {selfId: '5100002', chainIds: all, wheelId: null,
                                          front: {puller: '5100004', since: 0}, now: s * 1000});
    const K = R.CHANGE_ALLOWANCE_LONG_S;    // Bodo (60 s) and Arvid (120 s) are long pulls
    assert.equal(at(59).toMyPullS, 60 + K + 1);
    assert.equal(at(60).toMyPullS, 60 + K);                  // his plan is over: the clock runs on
    assert.equal(at(60 + K).toMyPullS, 60);
    assert.equal(at(60 + K + 3).toMyPullS, 57);              // runs on through the hold of a change
    assert.equal(at(60 + K + 4).toMyPullS, 57);              // then waits for the change
    const v = at(90);
    assert.equal(v.remainingS, -30);                         // his own clock still counts his plan
    assert.equal(v.toMyPullS, 57);
});


test('rotationView: no jump at a change, the rider before me at plan, the puller expected at plan + overhead', () => {
    const {plan, all} = planAll();
    const K = R.CHANGE_ALLOWANCE_LONG_S;    // Bodo (60 s) and Arvid (120 s) are long pulls
    assert.equal(K, 5);
    assert.equal(R.expectedPullS(60, false), 65); assert.equal(R.expectedPullS(60, true), 60);
    const view = (puller, since, s) => R.rotationView(plan, {selfId: '5100002', chainIds: all, wheelId: null,
                                                             front: {puller, since: since * 1000}, now: s * 1000});
    // Arvid (120 s) pulls from 0: his expected end is 120 + K, then Bodo 60 + K (both long pulls), then Kim (before
    // me) 60.
    assert.equal(view('5100005', 0, 0).toMyPullS, 120 + K + 60 + K + 60);
    assert.equal(view('5100005', 0, 120 + K).toMyPullS, 60 + K + 60);
    assert.equal(view('5100005', 0, 120 + K).standing, false);
    // He changes at his expected end, Bodo takes over: the clock goes on 1 s a second, no jump.
    const before = view('5100005', 0, 120 + K - 1).toMyPullS;
    const after = view('5100004', 120 + K, 120 + K).toMyPullS;
    assert.equal(before - after, 1);
    // Bodo's change to Kim at Bodo's expected end: no jump either.
    assert.equal(view('5100004', 0, 60 + K - 1).toMyPullS - view('5100003', 60 + K, 60 + K).toMyPullS, 1);
    // Kim, directly before me, counts only his plan: between and while he pulls.
    assert.equal(view('5100004', 0, 0).toMyPullS, 60 + K + 60);
    assert.equal(view('5100003', 0, 20).toMyPullS, 40);
    assert.equal(view('5100003', 0, 60).toMyPullS, 0);       // 0 at his plan end: READY until he swings off
    // Kim absent: Bodo is before me now and counts only his plan.
    assert.equal(R.rotationView(plan, {selfId: '5100002', chainIds: all.filter(id => id !== '5100003'), wheelId: null,
                                       front: {puller: '5100004', since: 0}, now: 0}).toMyPullS, 60);
    // The start bonus stays part of the start puller's plan: expected at plan + bonus + K.
    const b = R.rotationView(plan, {selfId: '5100002', chainIds: all, wheelId: null, now: 0,
                                    front: {puller: '5100004', since: 0, bonus: {id: '5100004', since: 0, s: 20}}});
    assert.equal(b.toMyPullS, 60 + 20 + K + 60);
});


test('expectedPullS: the change overhead is 10 s up to LONG_PULL_S of plan, 5 s above', () => {
    assert.equal(R.CHANGE_ALLOWANCE_S, 10);
    assert.equal(R.CHANGE_ALLOWANCE_LONG_S, 5);
    assert.equal(R.LONG_PULL_S, 40);
    assert.equal(R.expectedPullS(30, false), 40);
    assert.equal(R.expectedPullS(40, false), 50);            // 40 s is still a short pull
    assert.equal(R.expectedPullS(41, false), 46);
    assert.equal(R.expectedPullS(120, false), 125);
    assert.equal(R.expectedPullS(120, true), 120);           // the rider before me: plan only
    // The start bonus (pullS 30 + 20) does not change the overhead: chosen by the 30 s plan.
    assert.equal(R.expectedPullS(30 + 20, false, 30), 60);
});

// 21 Nov 2026 (design 2026-11-21-paceline-beta5 §2): the learned E (median 2 s with the prior at
// weight 2: 6 s for short pulls, 3.5 s for long ones) and H (median 1 s: 3 s).
const EFF22 = {seg: null, last: null, e: [2, 2], h: [1, 1]};

test('expectedPullS: plan + E, the rider before me plan + E - H', () => {
    // EFF22 has only 2 E values: E is still the prior (10 s / 5 s); H 1, 1 is mixed (3).
    assert.equal(R.expectedPullS(30, false, 30, EFF22), 40);
    assert.equal(R.expectedPullS(30, true, 30, EFF22), 37);
    assert.equal(R.expectedPullS(60, false, 60, EFF22), 65);
    assert.equal(R.expectedPullS(60, true, 60, EFF22), 62);
    // The start bonus (pullS 30 + 20): E chosen by the 30 s plan.
    assert.equal(R.expectedPullS(50, false, 30, EFF22), 60);
    // Nothing learned yet: the priors, 10 s and 5 s.
    assert.equal(R.expectedPullS(30, true, 30, R.initialRotation().eff), 35);
});

test('rotationView: the learned countdown', () => {
    const plan = plan5();
    const all = plan.riders.map(r => r.id);
    const view = (eff, puller = ID5.Ann, now = 10000) => R.rotationView(plan,
        {selfId: ID5.Eve, chainIds: all, wheelId: null, front: {puller, since: 0}, now, eff});
    // E is the prior until 3 values: Ann 40 - 10 elapsed, Ben 40, Cleo 40, Dan (before me) 37.
    assert.equal(view(EFF22).toMyPullS, 147);
    // 3 E values: E (3 * 3 + 20) / 5 = 5.8, H 3.5: not rounded. Ann 35.8 - 10, Ben, Cleo 35.8, Dan 32.3.
    assert.equal(view({seg: null, last: null, e: [3, 3, 3], h: [2, 2]}).toMyPullS, 129.7);
    assert.equal(view(null).toMyPullS, 140);                        // the fixed rule
    assert.equal(view(R.initialRotation().eff).toMyPullS, 145);     // the priors
    // Dan (before me) pulling: 37 - 10; past 37 + RUN_ON_S the clock stands at 0.
    assert.equal(view(EFF22, ID5.Dan).toMyPullS, 27);
    const late = view(EFF22, ID5.Dan, 45000);   // 45 s elapsed, past 37 + RUN_ON_S
    assert.equal(late.toMyPullS, 0);
    assert.equal(late.standing, true);
});

test('rotationStatus counts the state\'s learned values; a state without eff, the fixed rule', () => {
    const plan = plan5();
    const all = plan.riders.map(r => r.id);
    const chain = all.map((id, i) => ({id, x: 8 - 2 * i, ...(id === ID5.Eve ? {self: true} : {})}));
    const st = {...R.initialRotation(), chain, frontId: ID5.Ann, present: all,
                front: {...R.initialFront(), puller: ID5.Ann, since: 0}, eff: EFF22};
    const status = s => R.rotationStatus(s, {now: 10000, plan, selfId: ID5.Eve, live: true}).view.toMyPullS;
    assert.equal(status(st), 147);       // 2 E values: the prior
    assert.equal(status({...st, eff: undefined}), 140);
});

// 21 Nov 2026 (design 2026-11-21-paceline-beta5 §3): the recorder keeps the learned values and the
// old fixed-rule countdown as a shadow, to compare both in a ride report after the next TTT.
test('teamDet: the learned values and the fixed countdown', () => {
    const plan = plan5();
    const all = plan.riders.map(r => r.id);
    const chain = all.map((id, i) => ({id, x: 8 - 2 * i, ...(id === ID5.Eve ? {self: true} : {})}));
    const base = {...R.initialRotation(), chain, frontId: ID5.Ann, present: all,
                  front: {...R.initialFront(), puller: ID5.Ann, since: 0}};
    const args = (st, view) => ({now: 10000, plan, selfId: ID5.Eve, view});     // st kept for symmetry
    const viewOf = st => R.rotationStatus(st, {now: 10000, plan, selfId: ID5.Eve, live: true}).view;
    // Nothing learned yet: the priors.
    assert.deepEqual(R.teamDet(base, args(base, viewOf(base))).te, {eS: 10, eL: 5, h: 5, n: 0, hn: 0});
    // E 2, 2: only 2 values, so E is the prior; H 1 (median) with the prior at weight 2.
    const learned = {...base, eff: {seg: null, last: null, e: [2, 2], h: [1, 1]}};
    const det = R.teamDet(learned, args(learned, viewOf(learned)));
    assert.deepEqual(det.te, {eS: 10, eL: 5, h: 3, n: 2, hn: 2});
    // The shadow is the fixed rule whatever was learned (the same 140 as with eff null).
    assert.deepEqual(det.cdOld, {t: 140, standing: false});
    assert.equal(viewOf(learned).toMyPullS, 147);            // the shown countdown is the learned one
    // No view, or my own pull: no shadow.
    assert.equal(R.teamDet(learned, args(learned, null)).cdOld, null);
    assert.equal(R.teamDet(learned, args(learned, {...viewOf(learned), mine: true})).cdOld, null);
    assert.equal(R.teamDet(learned, args(learned, {...viewOf(learned), toMyPullS: null})).cdOld, null);
    // A state without eff: the priors again.
    const old = {...base, eff: undefined};
    assert.deepEqual(R.teamDet(old, args(old, viewOf(old))).te, {eS: 10, eL: 5, h: 5, n: 0, hn: 0});
    // Rounded to 0.1 s: e [1, 1, 2] (lower median 1) gives (3 * 1 + 2 * 10) / 5 = 4.6 and for the 5 s prior
    // (3 + 10) / 5 = 2.6; h [4, 4, 4]: (12 + 10) / 5 = 4.4. Below 3 values E is the prior (n 1 shows it).
    const odd = {...base, eff: {seg: null, last: null, e: [1, 1, 2], h: [4, 4, 4]}};
    assert.deepEqual(R.teamDet(odd, args(odd, viewOf(odd))).te, {eS: 4.6, eL: 2.6, h: 4.4, n: 3, hn: 3});
    const one = {...base, eff: {seg: null, last: null, e: [1], h: [4, 4, 4]}};
    assert.deepEqual(R.teamDet(one, args(one, viewOf(one))).te, {eS: 10, eL: 5, h: 4.4, n: 1, hn: 3});
});

test('rotationView: the overhead of each rider follows his own plan length', () => {
    const riders = [['p', 60], ['x', 30], ['y', 90], ['me', 60]]
        .map(([id, pullS]) => ({id, name: id.toUpperCase(), pullS, watts: 250}));
    const plan = {riders, bench: []};
    const all = riders.map(r => r.id);
    const v = R.rotationView(plan, {selfId: 'me', chainIds: all, wheelId: null,
                                    front: {puller: 'p', since: 0}, now: 12000});
    // Puller 60 + 5 s minus 12 s elapsed, X 30 + 10 s, Y (directly before me) 90 s plan only.
    assert.equal(v.toMyPullS, (60 + 5 - 12) + (30 + 10) + 90);
    // The start bonus on the puller keeps his 60 s plan's 5 s overhead.
    const b = R.rotationView(plan, {selfId: 'me', chainIds: all, wheelId: null, now: 0,
                                    front: {puller: 'p', since: 0, bonus: {id: 'p', since: 0, s: 20}}});
    assert.equal(b.toMyPullS, (60 + 20 + 5) + (30 + 10) + 90);
});


test('rotationView: the start bonus does not change the overhead chosen by the puller\'s plan', () => {
    const riders = [['p', 30], ['x', 30], ['me', 60]]
        .map(([id, pullS]) => ({id, name: id.toUpperCase(), pullS, watts: 250}));
    const plan = {riders, bench: []};
    const all = riders.map(r => r.id);
    // p pulls 30 s plan + 20 s bonus: expected end 50 + 10 (a 30 s plan is short, not 50 + 5), then
    // x directly before me at plan, 30 s.
    const v = R.rotationView(plan, {selfId: 'me', chainIds: all, wheelId: null, now: 0,
                                    front: {puller: 'p', since: 0, bonus: {id: 'p', since: 0, s: 20}}});
    assert.equal(v.toMyPullS, (30 + 20 + 10) + 30);
});

test('rotationView: every pull counts its overhead more than planned but the one before mine', () => {
    const {plan, all} = planAll();
    assert.equal(R.CHANGE_ALLOWANCE_LONG_S, 5);
    // Bodo (60 s) pulling from 0; me Dario, Kim (60 s, before me) between: Bodo's 60 + 5 s + Kim's 60.
    const v = R.rotationView(plan, {selfId: '5100002', chainIds: all, wheelId: null,
                                    front: {puller: '5100004', since: 0}, now: 0});
    assert.equal(v.toMyPullS, 60 + R.CHANGE_ALLOWANCE_LONG_S + 60);
    // Next in line: only the puller's own time (he is before me), no allowance.
    const n = R.rotationView(plan, {selfId: '5100003', chainIds: all, wheelId: null,
                                    front: {puller: '5100004', since: 0}, now: 0});
    assert.equal(n.toMyPullS, 60);
});


test('rotationView: the standing clock (standing, overS) once the run-on is used up', () => {
    const {plan, all} = planAll();
    const K = R.CHANGE_ALLOWANCE_LONG_S;    // Bodo (60 s) and Arvid (120 s) are long pulls
    const at = (s, selfId = '5100002', puller = '5100004') => R.rotationView(plan,
        {selfId, chainIds: all, wheelId: null, front: {puller, since: 0}, now: s * 1000});
    assert.equal(at(59).standing, false); assert.equal(at(59).overS, 0);
    assert.equal(at(64).standing, false); assert.equal(at(64).overS, 4);    // over his plan, still expected
    assert.equal(at(60 + K + 3).standing, false);             // still running on
    assert.equal(at(60 + K + 4).standing, true); assert.equal(at(60 + K + 4).overS, K + 4);
    assert.equal(at(90).overS, 30);
    // Next in line (Bodo is before Kim): his plan end plus the run-on.
    assert.equal(at(63, '5100003').standing, false); assert.equal(at(64, '5100003').standing, true);
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
    assert.equal(v.toMyPullS, 120 + 5);                      // Fritz 15 + 10 s, 20 s in; Arvid 120 s (before me)
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
    // C1 (audit fixes, 20 Nov 2026): the median of the last 3, so one dropped sample ends nothing;
    // the end is the first of those 3 below the threshold.
    assert.equal(R.powerDrop(hist([300, 0, 300])), null);
    assert.equal(R.powerDrop(hist([300, 0, 0])), 1000);
    assert.equal(R.powerDrop(hist([0, 300, 0])), 0);
    assert.equal(R.powerDrop(hist([300, 150, 150])), null);
    assert.equal(R.powerDrop(hist([300, 150, 150]), 180), 1000);
});

test('powerBack: the median of my last 3 samples back at JUMP_TARGET_FRAC of my target', () => {
    assert.equal(R.powerBack(hist([300, 300, 300]), 300), true);
    assert.equal(R.powerBack(hist([0, 300, 300]), 300), true);
    assert.equal(R.powerBack(hist([200, 200, 200]), 286), false);
    assert.equal(R.powerBack(hist([300, 300]), 300), false);
    // No target, no undo of my end (controller ruling P2, 20 Nov 2026; the brief had END_W here).
    assert.equal(R.powerBack(hist([150, 150, 150]), null), false);
    assert.equal(R.powerBack(hist([100, 100, 100]), null), false);
    assert.equal(R.powerBack(hist([300, 300, 300]), null), false);
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

test('resumeFront: the puller from before the pause keeps the pull while less than RESUME_NEAR_M behind the front rider', () => {
    // 17 Nov 2026 (ZRL): at the end of a descent the front rider was 0.2 m ahead of the puller, side
    // by side at 67 km/h, and was adopted in one tick. On his wheel (2–5 m) the front really changed.
    assert.equal(R.RESUME_NEAR_M, 2);
    const front = {...R.initialFront(), puller: 'A', since: 1000};
    const near = [{id: 'B', x: 10}, {id: 'A', x: 9}, {id: 'me', x: 6, self: true}];
    assert.deepEqual(R.resumeFront(front, {now: 90000, frontId: 'B', chain: near}), {...front, changedAt: 90000});
    for (const x of [7, 2]) {      // 3 m (on his wheel) and 8 m behind
        const far = [{id: 'B', x: 10}, {id: 'A', x}, {id: 'me', x: 0, self: true}];
        const s = R.resumeFront(front, {now: 90000, frontId: 'B', chain: far});
        assert.equal(s.puller, 'B', `adopted from ${10 - x} m`); assert.equal(s.since, 90000); assert.equal(s.prev, null);
    }
    // The puller is not in my chain (or no chain is given): the front rider is adopted as before.
    assert.equal(R.resumeFront(front, {now: 90000, frontId: 'B', chain: [{id: 'B', x: 10}, {id: 'me', x: 8}]}).puller, 'B');
    assert.equal(R.resumeFront(front, {now: 90000, frontId: 'B'}).puller, 'B');
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
    assert.equal(v.toMyPullS, 40 + 60 + R.CHANGE_ALLOWANCE_LONG_S); assert.equal(v.next.id, kim);
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

test('finishStep: once on, finish mode stays on past the line until I stand still or another event shows', () => {
    const ev = (remaining, remainingMetric = 'distance', remainingType = 'event') =>
        ({remaining, remainingMetric, remainingType});
    const step = (prev, entry, {live = true, still = false} = {}) => R.finishStep(prev, {live, entry, still});
    assert.equal(step(false, ev(800)), false);
    assert.equal(step(false, ev(500)), true);
    assert.equal(step(false, {}), false);
    // Past the line Sauce drops the event's `remaining` or shows the route's: still on.
    assert.equal(step(true, {}), true);
    assert.equal(step(true, null), true);
    assert.equal(step(true, ev(3000, 'distance', 'route')), true);
    assert.equal(step(true, ev(0)), true);
    // Standing still ends it, also with the last metres still shown.
    assert.equal(step(true, {}, {still: true}), false);
    // Another event clearly before its finish ends it at once; only a distance counts.
    assert.equal(step(true, ev(20000)), false);
    assert.equal(step(true, ev(501)), false);
    assert.equal(step(true, ev(1200, 'time')), true);
    // A step without live data keeps the previous value, either way.
    assert.equal(step(true, null, {live: false}), true);
    assert.equal(step(false, ev(300), {live: false}), false);
    assert.equal(step(undefined, {}), false);
});


// ---------- rotationStep: scenarios through the whole pure step ----------

// Synthetic 1 Hz rides with the rollers plan. scenario(s) -> {me: {power, draft, grade, speed, age,
// top}, others: [{idx, dx}]} with dx = metres ahead of me; `top` adds fields at the top level of my
// entry (e.g. `remaining`). Returns per second {s, self, puller, since (s), view, finish}.
// Options added 20 Nov 2026: `plan` (default the rollers plan), `init` (T0 => the state to start from);
// rows also carry `now`, `reason`, the view `v` and the state `st`.
// The others' `power` (default 250 W) and `draft` (default 50 W; 21 Nov 2026, for the hand-over
// detector) are optional.
function ride(scenario, {selfIdx = 0, from = 0, dur = 60, quietStart = false, terrain = () => undefined,
                         plan = P.importFiles([json, txt]).plan, init = () => R.initialRotation()} = {}) {
    const riderIds = new Set(plan.riders.map(r => r.id));
    const selfId = plan.riders[selfIdx].id;
    const name = id => plan.riders.find(r => r.id === id)?.name.split(' ')[0] ?? null;
    const T0 = 1.7e12;
    let rot = init(T0), hist = [], drafts = [];
    const out = [];
    for (let s = from; s < from + dur; s++) {
        const now = T0 + s * 1000;
        const sc = scenario(s);
        const wt = 1e12 + s * 1000;
        const nearby = [
            {athleteId: Number(selfId), self: true, age: sc.me.age ?? 300, gapDistance: 0, ...sc.me.top,
             state: {power: sc.me.power, draft: sc.me.draft, speed: sc.me.speed ?? 45, worldTime: wt, grade: (sc.me.grade ?? 0) / 100}},
            ...sc.others.map(o => ({athleteId: Number(plan.riders[o.idx].id), age: o.age ?? 800, gapDistance: -o.dx,
                                    state: {power: o.power ?? 250, draft: o.draft ?? 50, speed: sc.me.speed ?? 45, worldTime: wt}})),
        ];
        hist = R.pushPower(hist, {t: now, w: sc.me.power});
        drafts = [...drafts, sc.me.draft].slice(-R.DRAFT_N);
        const r = R.rotationStep(rot, {now, plan, riderIds, selfId, nearby, hist, drafts,
                                       grade: sc.me.grade ?? 0, sampleT: now, terrain: terrain(s)});
        rot = r.state;
        const {view, reason} = R.rotationStatus(rot, {now, plan, selfId, live: true, quietStart});
        const kind = view ? (view.mine ? 'pull' : 'rest') : reason;
        out.push({s, self: r.self, puller: name(rot.front.puller),
                  since: rot.front.since === null ? null : (rot.front.since - T0) / 1000, view: kind,
                  finish: rot.finish, now, reason, v: view, st: rot});
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
    const noKai = {...plan, riders: plan.riders.filter(r => r.id !== '5100003')};
    const next = R.carryRotation(midRace(), noKai);
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
    assert.equal(v.toMyPullS, 180 + 2 * R.CHANGE_ALLOWANCE_LONG_S - (60000 + R.HOLD_MS - f.since) / 1000);    // a full cycle: D, A, B
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


test('rotationStep: after a descent the puller from before it keeps the pull while 1 m behind the front rider', () => {
    // I am Kim (#3). Arvid pulls from 0; a descent (route profile) from 40 to 60. From 48 Bodo is in
    // front with Arvid beside him, 1 m back (17 Nov 2026: 0.2 m at 67 km/h); in the other rides
    // Arvid is on his wheel, 3 m back, or 8 m back.
    const descent = {hill: {kind: 'descent', roller: false}}, flat = {hill: null};
    const run = behindM => ride(t => {
        const grade = t >= 40 && t < 60 ? -5 : 0;
        const bentFront = t >= 48;
        return {me: {power: 150, draft: 80, grade},
                others: [{idx: 0, dx: bentFront ? 5 - behindM : 6}, {idx: 1, dx: bentFront ? 5 : 3}]};
    }, {selfIdx: 2, dur: 100, terrain: t => t >= 40 && t < 60 ? descent : flat});
    const near = run(1);
    for (let s = 60; s < 75; s++) {
        assert.equal(at(near, s).puller, 'Arvid', `Arvid keeps the pull at ${s}`);
    }
    assert.ok(at(near, 70).since < 40, 'with his clock from before the descent');
    // Bodo stays in front: he takes over after the chaos hold (the end of the descent was a change).
    assert.equal(at(near, 90).puller, 'Bodo');
    for (const m of [3, 8]) {
        const far = run(m);
        assert.equal(at(far, 61).puller, 'Bodo', `adopted at once from ${m} m`);
        assert.equal(at(far, 61).since, 60);
    }
});


test('rotationStep: finish mode stays on past the line, through a data gap, until I stand still', () => {
    // I am Kim (#3) behind Arvid and Bodo. 800 m to go at 0 (20 m a second), the line at 40. Past
    // it Sauce drops the event's remaining (41-49), then shows the route's (50-59); no data of mine
    // 60-64; I stop from 70 and ride on from 85 (12 Nov and 17 Nov 2026: finish mode went off just
    // past the line and the rotation ran on for 28 s).
    const rows = ride(t => {
        let top = {};
        if (t <= 40) {
            top = {remaining: 800 - 20 * t, remainingMetric: 'distance', remainingType: 'event'};
        } else if (t >= 50 && t < 60) {
            top = {remaining: 3000, remainingMetric: 'distance', remainingType: 'route'};
        }
        return {me: {power: 200, draft: 80, top, age: t >= 60 && t < 65 ? 20000 : 300,
                     speed: t >= 70 && t < 85 ? 0 : 45},
                others: [{idx: 0, dx: 6}, {idx: 1, dx: 3}]};
    }, {selfIdx: 2, dur: 100});
    assert.equal(at(rows, 14).finish, false);
    for (let s = 15; s < 75; s++) {
        assert.equal(at(rows, s).finish, true, `finish mode at ${s}`);
    }
    assert.equal(at(rows, 45).view, 'finish');
    assert.equal(at(rows, 55).view, 'finish');
    // Standing still for STOP_MS (a rotation was running) ends it; riding on does not bring it back.
    assert.equal(at(rows, 75).finish, false);
    assert.equal(at(rows, 95).finish, false);
});


test('rotationStep: finish mode ends when a new event shows 20 km to go', () => {
    const rows = ride(t => {
        let top = {};
        if (t <= 40) {
            top = {remaining: 800 - 20 * t, remainingMetric: 'distance', remainingType: 'event'};
        } else if (t >= 50) {
            top = {remaining: 20000, remainingMetric: 'distance', remainingType: 'event'};
        }
        return {me: {power: 200, draft: 80, top}, others: [{idx: 0, dx: 6}, {idx: 1, dx: 3}]};
    }, {selfIdx: 2, dur: 60});
    assert.equal(at(rows, 49).finish, true);
    assert.equal(at(rows, 50).finish, false);
    assert.equal(at(rows, 50).view, 'rest');
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


// ---------- 20 Nov 2026: chaos counter, riders sitting out (order.mjs in the step) ----------

// Five made-up riders with 30 s pulls; I am Eve (#5) unless a test says otherwise.
function plan5() {
    const names = ['Ann', 'Ben', 'Cleo', 'Dan', 'Eve'];
    return {riders: names.map((name, i) => ({id: String(7100001 + i), name, pullS: 30, watts: 300})), bench: []};
}
const ID5 = Object.fromEntries(plan5().riders.map(r => [r.name, r.id]));

// fronts: [[idx, from s], ...] who leads from when (at 10 m ahead of me); the other riders keep
// their places 6, 4, 2 m ahead of me, in plan order. I ride at the back with my draft, steady power.
// The rider fronts[0][0] pulls from 0 (no recent change). me(t, f): extra fields for my entry (f: the
// front rider's index).
// When I lead (f is me; audit fixes, 20 Nov 2026, the line ride of the engine audit's probes) the
// others are 2, 4, 6 m behind me in plan order and my draft is 0. other(t, idx): extra fields for a
// teammate's entry (e.g. its age).
function frontRide(fronts, {selfIdx = 4, dur, terrain, init, me = () => ({}), other = () => ({})} = {}) {
    const p = plan5();
    const frontAt = t => fronts.filter(([, from]) => from <= t).at(-1)[0];
    return ride(t => {
        const f = frontAt(t);
        const rest = p.riders.map((_, i) => i).filter(i => i !== f && i !== selfIdx);
        const lead = f === selfIdx;
        return {me: {power: 200, draft: lead ? 0 : 80, ...me(t, f)},
                others: (lead ? rest.map((idx, k) => ({idx, dx: -2 - 2 * k})) :
                    [{idx: f, dx: 10}, ...rest.map((idx, k) => ({idx, dx: 6 - 2 * k}))])
                    .map(o => ({...o, ...other(t, o.idx)}))};
    }, {plan: p, selfIdx, dur, terrain,
        init: init || (T0 => ({...R.initialRotation(),
                               front: {...R.initialFront(), puller: p.riders[fronts[0][0]].id, since: T0}}))});
}

// Back-and-forth: Ben takes over at 40, Ann is back in front at 80, Ben at 130, Ann at 170 (outside
// chaos Ann's returns wait BACK_HOLD_MS: adopted at 110 and 200), then Ben at 230 and Ann at 280.
const BACK_FORTH = [[0, 0], [1, 40], [0, 80], [1, 130], [0, 170], [1, 230], [0, 280]];

test('chaos: back-and-forth at the front gives reason chaos with a view of the real puller', () => {
    const rows = frontRide(BACK_FORTH, {dur: 300});
    assert.equal(at(rows, 109).puller, 'Ben');
    assert.equal(at(rows, 110).puller, 'Ann');
    assert.equal(at(rows, 110).reason, null, 'one bad change is no chaos');
    assert.equal(at(rows, 199).puller, 'Ben');
    assert.equal(at(rows, 199).reason, null);
    const r = at(rows, 200);
    assert.equal(r.puller, 'Ann');
    assert.equal(r.reason, 'chaos');
    assert.equal(r.v.puller.id, ID5.Ann, 'the view shows the real puller');
    assert.equal(r.v.elapsedS, 30);
    assert.deepEqual(r.st.order.hist, [false, true, false, true]);
    assert.equal(r.st.order.n, 4);
    assert.equal(r.st.front.adopt, 'front');
    assert.equal(at(rows, 201).st.front.adopt, null, 'adopt is only set in the step of a change');
});

test('chaos: the back hold is off, the rider before the puller takes over after HOLD_MS', () => {
    const rows = frontRide(BACK_FORTH, {dur: 300});
    assert.equal(at(rows, 233).puller, 'Ben');
    // Ann (the rider before Ben) in front from 280, 47 s after the last change: HOLD_MS, not BACK_HOLD_MS.
    assert.equal(at(rows, 282).puller, 'Ben');
    assert.equal(at(rows, 283).puller, 'Ann');
    assert.equal(at(rows, 283).since, 280);
    assert.equal(at(rows, 283).reason, 'chaos');
});

test('chaos: no skip hold either', () => {
    // After the back-and-forth Ann pulls (chaos); Cleo, who would skip the plan's next (Ben), in
    // front from 240, 40 s after the last change: HOLD_MS, not CHAOS_HOLD_MS.
    const rows = frontRide([...BACK_FORTH.slice(0, 5), [2, 240]], {dur: 260});
    assert.equal(at(rows, 242).puller, 'Ann');
    assert.equal(at(rows, 243).puller, 'Cleo');
});

test('chaos: my pull end hands the pull to nobody; the next front rider is adopted by tracking', () => {
    // I (Eve) pull from 0 in front of the others; my power drops at 40 and stays low until 46. Cleo
    // comes past at 44.
    const scenario = t => {
        const power = t < 40 ? 280 : t < 47 ? 80 : 180;
        const cleo = t >= 44;
        return {me: {power, draft: cleo ? 80 : 0},
                others: [{idx: 0, dx: -2}, {idx: 1, dx: -4}, {idx: 2, dx: cleo ? 4 : -6}, {idx: 3, dx: -8}]};
    };
    const start = order => T0 => ({...R.initialRotation(), order,
                                   front: {...R.initialFront(), puller: ID5.Eve, since: T0, changedAt: T0}});
    const chaos = {...O.initialOrder(), hist: [true, true], chaos: true, n: 2};
    const rows = ride(scenario, {plan: plan5(), selfIdx: 4, dur: 52, init: start(chaos)});
    assert.deepEqual(events(rows), ['41:end'], 'one end, not one per second while my power stays low');
    for (let s = 41; s < 47; s++) {
        assert.equal(at(rows, s).puller, 'Eve', `nobody takes my pull at ${s}`);
        assert.equal(at(rows, s).st.order.n, 2, `nothing classified at ${s}`);
    }
    assert.equal(at(rows, 47).puller, 'Cleo');
    assert.equal(at(rows, 47).since, 44);
    assert.equal(at(rows, 47).st.front.adopt, 'front');
    assert.equal(at(rows, 47).st.order.n, 3, 'the change seen at the front is classified');
    // Outside chaos my end hands the pull to the plan's next (Ann) at once, unclassified.
    const calm = ride(scenario, {plan: plan5(), selfIdx: 4, dur: 52, init: start(O.initialOrder())});
    assert.deepEqual(events(calm), ['41:end']);
    assert.equal(at(calm, 41).puller, 'Ann');
    assert.equal(at(calm, 41).st.front.adopt, 'end');
    for (let s = 41; s < 52; s++) {
        assert.equal(at(calm, s).st.order.n, 0, `the hand-off is not classified (${s})`);
    }
});

test('order: the undo of my false start is not classified, my start is', () => {
    // Kim pulls, a gap in his last 10 s starts my pull (Arvid), he is back in front after it.
    const rows = gapRide(52, 8);
    const self = rows.find(r => r.st.front.adopt === 'self');
    const back = rows.find(r => r.st.front.adopt === 'back');
    assert.ok(self && back, 'my start and its undo');
    assert.equal(self.st.order.n, at(rows, self.s - 1).st.order.n + 1, 'my start is a change at the front');
    assert.equal(back.st.order.n, at(rows, back.s - 1).st.order.n, 'the undo is not');
    assert.equal(back.puller, 'Kim');
    // The very first puller (no one before him) is no change either.
    assert.equal(at(rows, 0).st.order.n, 0);
});

// Ann skips Ben at 40 (Cleo leads), then Cleo, Dan; Dan → Ann skips me (Eve); a second round without
// Ben; Ben pulls again at 280, and a third round with him.
const SIT_OUT = [[0, 0], [2, 40], [3, 80], [0, 120], [2, 160], [3, 200], [0, 240], [1, 280], [2, 320], [3, 360],
                 [0, 400]];

test('order: a rider sitting out leaves the countdown until he pulls again', () => {
    // Everyone rides 250 W throughout: a turn's T0 is the next since + 1 s, so every fed turn has
    // E 10 s and H -1 s (21 Nov 2026, design 2026-11-21-paceline-beta5 §2).
    const rows = frontRide(SIT_OUT, {dur: 440});
    assert.deepEqual(O.orderOutIds(at(rows, 60).st.order), [ID5.Ben]);
    // Ann pulls since 120 (30 s), nothing learned yet (the skips feed no turn): her end 30 + 10,
    // Cleo 30 + 10, Dan (before me) 30 + 10 - 5; Ben not counted.
    let r = at(rows, 150);
    assert.equal(r.puller, 'Ann'); assert.equal(r.since, 120);
    assert.deepEqual(r.st.eff.e, []);
    assert.equal(r.v.toMyPullS, (40 - 30) + 40 + 35);
    assert.equal(r.v.place, 4);
    // He pulls again: back in the line, no chaos (more than a round after the skip).
    assert.equal(at(rows, 295).puller, 'Ben');
    assert.deepEqual(O.orderOutIds(at(rows, 295).st.order), []);
    // Cleo's turns from 160 and 320 fed: E (2 x 10 + 2 x 10) / 4 = 10, H (2 x -1 + 2 x 5) / 4 = 2.
    r = at(rows, 430);
    assert.equal(r.puller, 'Ann'); assert.equal(r.since, 400);
    assert.deepEqual(r.st.eff.e, [10, 10]);
    assert.deepEqual(r.st.eff.h, [-1, -1]);
    assert.equal(r.v.toMyPullS, (40 - 30) + 2 * 40 + 38);
    assert.equal(r.v.place, 5);
    assert.ok(rows.every(x => x.reason === null), 'no chaos, no dash');
});

test('order: the team skips me; I stay in the line, my countdown and READY keep working', () => {
    const rows = frontRide(SIT_OUT, {dur: 440});
    // Dan → Ann skips me at 135 and 255; I am never taken out.
    for (const s of [135, 136, 255, 256, 430]) {
        assert.ok(!O.orderOutIds(at(rows, s).st.order).includes(ID5.Eve), `me never out (${s})`);
    }
    // Dan pulls since 200 (adopted at 215), I am next: before me, 30 s plan + E - H. Cleo's turn
    // from 160 fed (E 10 s, H -1 s; everyone at 250 W): E (10 + 2 x 10) / 3 = 10, H (-1 + 2 x 5) / 3
    // = 3 (21 Nov 2026, design 2026-11-21-paceline-beta5 §2).
    const r = at(rows, 225);
    assert.equal(r.puller, 'Dan');
    assert.equal(r.v.next.id, ID5.Eve);
    assert.deepEqual(r.st.eff.e, [10]);
    assert.deepEqual(r.st.eff.h, [-1]);
    assert.equal(r.v.toMyPullS, 30 + 10 - 3 - 25);
    const ready = at(rows, 227);
    assert.equal(ready.v.toMyPullS, 10);
    assert.ok(ready.v.toMyPullS <= R.WARN_S, 'READY');
});

test('carryRotation and standing still keep E and H, drop the open turn', () => {
    const {plan} = P.importFiles([json, txt]);
    const eff = {seg: {id: '5100004', since: 40000, planS: 60, bonus: false, bad: false, next: '5100003', pw: []},
                 last: {id: '5100005', since: 0, T0: 41000, bad: false, next: '5100004', nextSince: 40000},
                 e: [1], h: [2]};
    const kept = {seg: null, last: null, e: [1], h: [2]};
    assert.deepEqual(R.carryRotation({...midRace(), eff}, plan).eff, kept);     // the puller stays
    assert.deepEqual(R.carryRotation({...midRace(), eff}, null).eff, kept);     // a reset
    // Standing still: from 5 s at speed 0 (STOP_MS) the rotation pauses; before that the turn runs on.
    const rows = frontRide([[0, 0]], {dur: 6, me: () => ({speed: 0}),
        init: T0 => ({...R.initialRotation(), front: {...R.initialFront(), puller: ID5.Ann, since: T0},
                      eff: {seg: {id: ID5.Ann, since: T0, planS: 30, bonus: false, bad: false, next: ID5.Ben, pw: []},
                            last: {id: ID5.Dan, since: T0 - 40000, T0: T0 - 39000, bad: false, next: ID5.Ann,
                                   nextSince: T0},
                            e: [1], h: [2]}})});
    assert.equal(at(rows, 4).st.still.still, false);
    assert.equal(at(rows, 4).st.eff.seg.id, ID5.Ann);
    assert.equal(at(rows, 4).st.eff.seg.pw.length, 5);
    assert.equal(at(rows, 5).st.still.still, true);
    assert.deepEqual(at(rows, 5).st.eff, kept);
});

test('rotationStep: a puller whose row is stale for his whole turn: T0 is the next since, no H', () => {
    // Ann, Ben, Cleo, Dan in turn, 40 s each, everyone at 250 W; Ben's row is 3 s old throughout
    // (tracked, ROT_MAX_AGE_MS, but no fresh power: freshState). Ann's turn feeds nothing (no turn
    // before it); Ben's turn E = 80 - 41 - 30 = 9 with T0 = Cleo's since (no power) and no H;
    // Cleo's turn E = 121 - 80 - 30 = 11 (stored clipped to 10), H = 120 - 121 = -1.
    const rows = frontRide([[0, 0], [1, 40], [2, 80], [3, 120]], {dur: 125,
        other: (t, idx) => (idx === 1 ? {age: 3000} : {})});
    const rel = r => ms => (ms - (r.now - r.s * 1000)) / 1000;
    let r = at(rows, 83);
    assert.equal(r.puller, 'Cleo'); assert.equal(r.since, 80);
    assert.equal(r.st.eff.last.id, ID5.Ben);
    assert.equal(rel(r)(r.st.eff.last.T0), 80);
    assert.deepEqual(r.st.eff.e, [9]);
    assert.deepEqual(r.st.eff.h, []);
    r = at(rows, 124);
    assert.equal(r.puller, 'Dan'); assert.equal(r.since, 120);
    assert.deepEqual(r.st.eff.e, [9, 10]);
    assert.deepEqual(r.st.eff.h, [-1]);
});

test('order: chaos survives a climb pause; the adoption after it is not classified', () => {
    // After the back-and-forth (chaos at 200) a real climb 205-230; Cleo leads from 215.
    const climb = {hill: {kind: 'climb', roller: false}}, flat = {hill: null};
    const rows = frontRide([...BACK_FORTH.slice(0, 5), [2, 215]], {dur: 240,
        terrain: t => t >= 205 && t < 230 ? climb : flat});
    assert.equal(at(rows, 204).reason, 'chaos');
    assert.equal(at(rows, 229).reason, 'climb');
    const r = at(rows, 230);
    assert.equal(r.puller, 'Cleo');
    assert.equal(r.st.front.adopt, 'resume');
    assert.equal(r.st.order.n, 4, 'the resume adoption is not classified');
    assert.equal(r.st.order.chaos, true);
    assert.equal(r.reason, 'chaos');
});

test('order: a resume adoption brings a rider sitting out back in, without classifying', () => {
    // Ann pulls; Cleo sits out (taken out earlier); a climb 10-30, Cleo leads from 20.
    const climb = {hill: {kind: 'climb', roller: false}}, flat = {hill: null};
    const order = {...O.initialOrder(), hist: [false], out: {[ID5.Cleo]: 0}, n: 1};
    const rows = frontRide([[0, 0], [2, 20]], {dur: 40, terrain: t => t >= 10 && t < 30 ? climb : flat,
        init: T0 => ({...R.initialRotation(), order, front: {...R.initialFront(), puller: ID5.Ann, since: T0}})});
    assert.deepEqual(O.orderOutIds(at(rows, 29).st.order), [ID5.Cleo]);
    assert.equal(at(rows, 30).puller, 'Cleo');
    assert.deepEqual(O.orderOutIds(at(rows, 30).st.order), []);
    assert.equal(at(rows, 30).st.order.n, 1);
});

test('order: a plan change in chaos resets the order state, the countdown is back at once', () => {
    const rows = frontRide(BACK_FORTH, {dur: 205});
    const r = at(rows, 204);
    assert.equal(r.reason, 'chaos');
    const plan2 = {...plan5(), sig: 'another'};
    const st = R.carryRotation(r.st, plan2);
    assert.deepEqual(st.order, O.initialOrder());
    assert.equal(st.front.puller, ID5.Ann, 'the puller carries on');
    const {view, reason} = R.rotationStatus(st, {now: r.now, plan: plan2, selfId: ID5.Eve, live: true});
    assert.equal(reason, null);
    assert.ok(Number.isFinite(view.toMyPullS));
    // No plan, or the puller left it: a fresh order too.
    assert.deepEqual(R.carryRotation(r.st, null).order, O.initialOrder());
});

test('order: standing still resets the order state', () => {
    const rows = frontRide(BACK_FORTH, {dur: 215, me: t => (t >= 205 ? {speed: 0} : {})});
    assert.equal(at(rows, 204).st.order.chaos, true);
    assert.deepEqual(at(rows, 214).st.order, O.initialOrder());
    assert.equal(at(rows, 214).reason, 'still');
});

test('order: a missing order (older state) counts as a fresh one', () => {
    const rows = frontRide([[0, 0], [1, 40]], {dur: 50,
        init: T0 => {
            const st = {...R.initialRotation(), front: {...R.initialFront(), puller: ID5.Ann, since: T0}};
            delete st.order;
            return st;
        }});
    assert.equal(at(rows, 43).puller, 'Ben');
    assert.equal(at(rows, 43).st.order.n, 1);
    assert.equal(at(rows, 43).reason, null);
});

test('roller in chaos: the real front rider is followed', () => {
    // A roller (route profile) 210-250; Dan, neither the puller (Ann) nor the plan's next (Ben),
    // leads from 215.
    const roller = {hill: {kind: 'climb', roller: true}}, flat = {hill: null};
    const terrain = t => t >= 210 && t < 250 ? roller : flat;
    const rows = frontRide([...BACK_FORTH.slice(0, 5), [3, 215]], {dur: 245, terrain});
    assert.equal(at(rows, 229).puller, 'Ann');
    assert.equal(at(rows, 230).puller, 'Dan', 'adopted after CHAOS_HOLD_MS (15 s after a change)');
    assert.equal(at(rows, 230).st.order.n, 5, 'classified like any other change');
    // Outside chaos the roller rule stays: Dan is ignored.
    const calm = frontRide([[0, 0], [3, 215]], {dur: 245, terrain});
    for (let s = 215; s < 245; s++) {
        assert.equal(at(calm, s).puller, 'Ann', `s ${s}`);
    }
});

test('trackFront: adopt says how the puller changed', () => {
    let s = R.trackFront(R.initialFront(), {now: 0, frontId: 'A'});
    assert.equal(s.adopt, 'front');
    s = R.trackFront(s, {now: 1000, frontId: 'A'});
    assert.equal(s.adopt, null);
    s = R.trackFront(s, {now: 40000, frontId: 'A', draftStart: {id: 'me', at: 39000}});
    assert.equal(s.adopt, 'self');
    // A back in front right after my start: my start was wrong, he gets his since back.
    for (let t = 51; t <= 54; t++) {
        s = R.trackFront(s, {now: t * 1000, frontId: 'A'});
    }
    assert.equal(s.puller, 'A'); assert.equal(s.since, 0); assert.equal(s.adopt, 'back');
    s = R.trackFront({...s, puller: 'me', since: 60000}, {now: 100000, frontId: 'me',
                                                          selfEnd: {id: 'me', at: 99000, nextId: 'B'}});
    assert.equal(s.puller, 'B'); assert.equal(s.adopt, 'end');
    assert.equal(R.resumeFront({...R.initialFront(), puller: 'A', since: 0, adopt: 'front'}, {now: 5000, frontId: 'C'}).adopt,
                 'resume');
    assert.equal(R.resumeFront({...R.initialFront(), puller: 'A', since: 0, adopt: 'front'}, {now: 5000, frontId: 'A'}).adopt,
                 null);
});

test('trackFront in chaos: no back or skip hold, my end hands to nobody', () => {
    const calm = {...R.initialFront(), puller: 'B', since: 0, changedAt: 0};
    let s = calm;
    for (let t = 100; t <= 103; t++) {
        s = R.trackFront(s, {now: t * 1000, frontId: 'A', backId: 'A', chaos: true});
    }
    assert.equal(s.puller, 'A'); assert.equal(s.since, 100000);
    s = calm;
    for (let t = 100; t <= 103; t++) {
        s = R.trackFront(s, {now: t * 1000, frontId: 'C', slowId: 'C', chaos: true});
    }
    assert.equal(s.puller, 'C');
    // The window after a change still holds CHAOS_HOLD_MS.
    s = {...calm, changedAt: 95000};
    for (let t = 100; t <= 114; t++) {
        s = R.trackFront(s, {now: t * 1000, frontId: 'A', chaos: true});
    }
    assert.equal(s.puller, 'B');
    s = R.trackFront(s, {now: 115000, frontId: 'A', chaos: true});
    assert.equal(s.puller, 'A');
    // My end: I stay the puller, ignored as front rider; a second end of the same pull is not taken.
    let m = {...R.initialFront(), puller: 'me', since: 0, changedAt: 0};
    m = R.trackFront(m, {now: 41000, frontId: 'me', selfEnd: {id: 'me', at: 40000, nextId: 'B'}, chaos: true});
    assert.equal(m.puller, 'me'); assert.equal(m.adopt, null);
    assert.deepEqual(m.last, {kind: 'end', at: 40000}); assert.deepEqual(m.ignore, {id: 'me', at: 40000});
    const again = R.trackFront(m, {now: 42000, frontId: 'me', selfEnd: {id: 'me', at: 41000, nextId: 'B'}, chaos: true});
    assert.equal(again.last, m.last);
    m = R.trackFront(m, {now: 43000, frontId: 'C', chaos: true});
    m = R.trackFront(m, {now: 46000, frontId: 'C', chaos: true});
    assert.equal(m.puller, 'C'); assert.equal(m.adopt, 'front');
});

test('dashReason and dashKind: chaos comes after every other reason', () => {
    const plan = {riders: [{id: 'me'}, {id: 'b'}]};
    const ok = {plan, selfId: 'me', live: true, finish: false, climbing: false,
                chain: [{id: 'me', self: true}, {id: 'b'}]};
    assert.equal(R.dashReason(ok), null);
    assert.equal(R.dashReason({...ok, chaos: true}), 'chaos');
    assert.equal(R.dashReason({...ok, chaos: true, climbing: true}), 'climb');
    assert.equal(R.dashReason({...ok, chaos: true, climbing: true, descent: true}), 'descent');
    assert.equal(R.dashReason({...ok, chaos: true, finish: true}), 'finish');
    assert.equal(R.dashReason({...ok, chaos: true, chain: [{id: 'me', self: true}]}), 'alone');
    assert.equal(R.dashReason({...ok, chaos: true, starting: true}), 'start');
    assert.equal(R.dashReason({...ok, chaos: true, still: true}), 'still');
    assert.equal(R.dashReason({...ok, chaos: true, live: false}), 'nolive');
    assert.equal(R.dashKind('chaos'), 'chaos');
    assert.equal(R.dashKind('chaos', {started: false}), 'chaos');
});

test('captainNext in chaos: a marker, not the plan\'s guess', () => {
    const a = {id: 'a'}, b = {id: 'b'}, c = {id: 'c'};
    const plan = {riders: [a, b, c], bench: []};
    assert.deepEqual(R.captainNext({plan, view: {next: c}, reason: 'chaos', pullerId: 'b'}), {chaos: true});
    assert.equal(R.captainNext({plan, view: null, reason: 'finish', pullerId: 'b'}), null);
});

test('rotationTable: a rider sitting out is shown like a dropped one, last and not present', () => {
    const plan = {riders: ['S', 'A', 'M', 'R', 'C'].map(id => ({id}))};
    const ids = rows => rows.map(r => r.rider.id).join('');
    let t = R.rotationTable(plan, {pullerId: 'C', presentIds: ['S', 'A', 'M', 'R', 'C'], outIds: ['A']});
    assert.equal(ids(t), 'CSMRA');
    assert.deepEqual(t.map(r => r.present), [true, true, true, true, false]);
    // With a dropped rider: both last, in plan order.
    t = R.rotationTable(plan, {pullerId: 'M', presentIds: ['S', 'A', 'M', 'C'], outIds: ['S']});
    assert.equal(ids(t), 'MCASR');
    assert.deepEqual(t.map(r => r.present), [true, true, true, false, false]);
    // The puller always counts, and without outIds nothing changes.
    t = R.rotationTable(plan, {pullerId: 'A', presentIds: ['S', 'A', 'M', 'R', 'C'], outIds: ['A']});
    assert.equal(t[0].rider.id, 'A'); assert.equal(t[0].present, true);
    assert.equal(ids(R.rotationTable(plan, {pullerId: 'C', presentIds: ['S', 'A', 'M', 'R', 'C']})), 'CSAMR');
});

test('order: the skip hold, the back hold, the wheel and my end\'s next rider leave out riders sitting out', () => {
    const start = (out, puller = 'Ann') => T0 => ({...R.initialRotation(),
        order: {...O.initialOrder(), out, n: 1}, front: {...R.initialFront(), puller: ID5[puller], since: T0}});
    // Ben sits out: Cleo after Ann is the line's next, no skip, the normal hold.
    let rows = frontRide([[0, 0], [2, 40]], {dur: 50, init: start({[ID5.Ben]: 0})});
    assert.equal(at(rows, 43).puller, 'Cleo');
    // Ben sits out, Cleo pulls: Ann pulled before him, so her return in front waits BACK_HOLD_MS.
    rows = frontRide([[2, 0], [0, 40]], {dur: 75, init: start({[ID5.Ben]: 0}, 'Cleo')});
    assert.equal(at(rows, 69).puller, 'Cleo');
    assert.equal(at(rows, 70).puller, 'Ann');
    // Dan sits out: my wheel by the plan is Cleo.
    rows = frontRide([[0, 0]], {dur: 6, init: start({[ID5.Dan]: 0})});
    assert.equal(at(rows, 5).v.wheel.id, ID5.Cleo);
    // Ann sits out: my end hands the pull to Ben.
    const scenario = t => ({me: {power: t < 40 ? 280 : 80, draft: 0},
                            others: [{idx: 0, dx: -2}, {idx: 1, dx: -4}, {idx: 2, dx: -6}, {idx: 3, dx: -8}]});
    rows = ride(scenario, {plan: plan5(), selfIdx: 4, dur: 45, init: T0 => ({...start({[ID5.Ann]: 0}, 'Eve')(T0),
        front: {...R.initialFront(), puller: ID5.Eve, since: T0, changedAt: T0}})});
    assert.deepEqual(events(rows), ['41:end']);
    assert.equal(at(rows, 41).puller, 'Ben');
});


// ---------- 20 Nov 2026: the five rules after the replay (spec section 8) ----------

test('rule 1: a quick return to the rider just skipped undoes the skip, one bad flag', () => {
    // Cleo (skipping Ben) adopted at 55 after the skip hold; Ben in front from 69 is adopted at 84,
    // 29 s after that change: a short wrong front rider, not a sit-out.
    const quick = frontRide([[0, 0], [2, 40], [1, 69]], {dur: 90});
    assert.equal(at(quick, 55).puller, 'Cleo');
    assert.deepEqual(O.orderOutIds(at(quick, 55).st.order), [ID5.Ben]);
    const q = at(quick, 84);
    assert.equal(q.puller, 'Ben');
    assert.equal(at(quick, 83).puller, 'Cleo');
    assert.deepEqual(q.st.order.hist, [false, true]);
    assert.deepEqual(q.st.order.out, {});
    assert.equal(q.st.order.n, 2);
    assert.equal(q.reason, null);
    // From 75 he is adopted at 85, 30 s after it: the return rule as before (two bad, chaos).
    const slow = frontRide([[0, 0], [2, 40], [1, 75]], {dur: 90});
    const r = at(slow, 85);
    assert.equal(r.puller, 'Ben');
    assert.equal(at(slow, 84).puller, 'Cleo');
    assert.deepEqual(r.st.order.hist, [false, true, true]);
    assert.equal(r.reason, 'chaos');
});

test('rule 2: a back candidate held HOLD_MS or more and gone unadopted is one bad flag', () => {
    // Ben takes over at 43; Ann (the rider before him) is in front from 80 under the back hold.
    const held = frontRide([[0, 0], [1, 40], [0, 80], [1, 90]], {dur: 95});
    assert.equal(at(held, 85).st.front.held, 'back');
    // She is gone at 90; the flag comes after CAND_GAP_N samples without her (audit fixes, 20 Nov
    // 2026, I5: back within them, she would still be the same held candidate).
    assert.deepEqual(at(held, 91).st.order.hist, [false]);
    const r = at(held, 92);
    assert.equal(r.puller, 'Ben');
    assert.deepEqual(r.st.order.hist, [false, true]);
    assert.equal(r.st.order.n, 1, 'no change: the change count stays');
    assert.deepEqual(r.st.order.out, {});
    assert.deepEqual(at(held, 94).st.order.hist, [false, true], 'counted once');
    // Exactly HOLD_MS (80-83, gone at 84) counts; 2 s (80-82, gone at 83) does not.
    assert.deepEqual(at(frontRide([[0, 0], [1, 40], [0, 80], [1, 84]], {dur: 90}), 89).st.order.hist, [false, true]);
    assert.deepEqual(at(frontRide([[0, 0], [1, 40], [0, 80], [1, 83]], {dur: 90}), 89).st.order.hist, [false]);
});

test('I5: rule 2 counts one flag per rider per BACK_HOLD_MS', () => {
    // Ann (the rider before Ben) in front 80-85 and 90-95 under the back hold: one episode, one flag.
    const twice = frontRide([[0, 0], [1, 40], [0, 80], [1, 86], [0, 90], [1, 96]], {dur: 170});
    assert.deepEqual(twice.at(-1).st.order.hist, [false, true]);
    assert.equal(twice.filter(r => r.reason === 'chaos').length, 0);
    // Two episodes 40 s apart count twice.
    const apart = frontRide([[0, 0], [1, 40], [0, 80], [1, 86], [0, 120], [1, 126]], {dur: 170});
    assert.deepEqual(apart.at(-1).st.order.hist, [false, true, true]);
});

test('I5: one stray sample does not split a back-hold episode', () => {
    // Ben pulls; Ann (the rider before him) is frontmost 60-71 but Ben for one sample at 66, then the
    // team rides the plan (probe p06 B: two flags and 91 s of chaos).
    const rows = frontRide([[1, 0], [0, 60], [1, 66], [0, 67], [1, 72], [2, 80], [3, 120], [4, 160], [0, 200], [1, 240]],
                           {selfIdx: 4, dur: 260});
    assert.equal(rows.filter(r => r.reason === 'chaos').length, 0);
    for (const r of rows) {
        assert.ok(r.st.order.hist.filter(Boolean).length <= 1, `at most one flag at ${r.s}`);
    }
});

test('I5: a nose in front for one sample every 10 s does not reset the back hold', () => {
    // Ben pulls; from 60 Ann (the rider before him) leads, but Ben is in front for one sample every
    // 10 s (probe p51: Ann named at 83 after two flags, 161 s of chaos). Leader 10 m ahead of me,
    // the others 9, 6, 3 m.
    const p = plan5();
    const rows = ride(t => {
        const lead = t < 60 || (t - 60) % 10 === 9 ? 1 : 0;
        const rest = [0, 1, 2, 3].filter(i => i !== lead);
        return {me: {power: 200, draft: 80},
                others: [{idx: lead, dx: 10}, ...rest.map((idx, k) => ({idx, dx: 9 - 3 * k}))]};
    }, {plan: p, selfIdx: 4, dur: 240,
        init: T0 => ({...R.initialRotation(), front: {...R.initialFront(), puller: ID5.Ben, since: T0}})});
    assert.equal(rows.find(r => r.puller === 'Ann').s, 90);
    assert.equal(rows.filter(r => r.reason === 'chaos').length, 0);
});

test('I5 review: under the plain hold single samples ahead do not add up to a change', () => {
    // Ann pulls; Ben (the plan's next) is ahead of her only in the listed seconds, else on her wheel
    // (review probe blips.mjs: with the restore for every candidate, 30 s and 33 s made Ben the
    // puller 33-63 s and Ann's clock restarted, one bad flag).
    const p = plan5();
    for (const blips of [[30, 33], [30, 32, 34], [30, 33, 36]]) {
        const rows = ride(t => {
            const lead = blips.includes(t) ? 1 : 0;
            const rest = [0, 1, 2, 3].filter(i => i !== lead);
            return {me: {power: 200, draft: 80},
                    others: [{idx: lead, dx: 10}, ...rest.map((idx, k) => ({idx, dx: 9.5 - 3 * k}))]};
        }, {plan: p, selfIdx: 4, dur: 110,
            init: T0 => ({...R.initialRotation(), front: {...R.initialFront(), puller: ID5.Ann, since: T0}})});
        for (const r of rows) {
            assert.deepEqual([r.puller, r.since], ['Ann', 0], `blips ${blips} at ${r.s}`);
        }
        assert.deepEqual(rows.at(-1).st.order.hist, [], `blips ${blips}`);
    }
});

test('I5 review: the next rider on the puller\'s wheel, ahead in 2 of 3 samples, is no early change', () => {
    // A deterministic form of review probe jitter.mjs (position noise: 1 m gap, 0.8 m noise gave an
    // early change in 51 of 100 runs with the restore for every candidate, 3 before): Ben 1 m behind
    // Ann, but 0.5 m ahead in two of every three samples from 20 s; he really passes at 60 s.
    const p = plan5();
    const rows = ride(t => {
        const d = t >= 60 ? 2 : t >= 20 && (t - 20) % 3 !== 2 ? 0.5 : -1;
        return {me: {power: 200, draft: 80},
                others: [{idx: 0, dx: 10}, {idx: 1, dx: 10 + d}, {idx: 2, dx: 5}, {idx: 3, dx: 3}]};
    }, {plan: p, selfIdx: 4, dur: 70,
        init: T0 => ({...R.initialRotation(), front: {...R.initialFront(), puller: ID5.Ann, since: T0}})});
    for (const r of rows.filter(r => r.s < 60)) {
        assert.equal(r.puller, 'Ann', `at ${r.s}`);
    }
    assert.equal(at(rows, 65).puller, 'Ben');
});

test('I5: standing still and a plan change reset the rule-2 flags; a lost rider who left the plan is dropped', () => {
    // Ann's flag at 92 (see rule 2 above), then I stop from 95 (still from 100).
    const rows = frontRide([[0, 0], [1, 40], [0, 80], [1, 90]], {dur: 105, me: t => (t >= 95 ? {speed: 0} : {})});
    assert.deepEqual(Object.keys(at(rows, 94).st.backFlags), [ID5.Ann]);
    assert.equal(at(rows, 102).reason, 'still');
    assert.deepEqual(at(rows, 102).st.backFlags, {});
    const plan2 = {...plan5(), sig: 'another'};
    assert.deepEqual(R.carryRotation(at(rows, 94).st, plan2).backFlags, {});
    // The lost candidate (followCand) goes with a rider who left the plan, and stays otherwise.
    const lost = {id: ID5.Cleo, since: 1000, at: 2000, n: 1};
    const st = {...at(rows, 94).st, front: {...at(rows, 94).st.front, lost}};
    assert.deepEqual(R.carryRotation(st, plan2).front.lost, lost);
    const noCleo = {...plan2, riders: plan2.riders.filter(r => r.id !== ID5.Cleo)};
    assert.equal(R.carryRotation(st, noCleo).front.lost, null);
});

test('I3: in a line of two the other rider takes over after HOLD_MS', () => {
    // I am Ann, pulling since T0 at 250 W; at 40 Ben comes past and I ease to 200 W (no end of my
    // pull). Probe p01 A and C: the back hold held Ben until 70.
    const watts = r => ({...r, watts: 250});
    const two = {riders: plan5().riders.slice(0, 2).map(watts), bench: []};
    const five = {riders: plan5().riders.map(watts), bench: []};    // only Ben present
    for (const plan of [two, five]) {
        const rows = ride(t => ({me: {power: t < 40 ? 250 : 200, draft: t < 40 ? 0 : 80},
                                 others: [{idx: 1, dx: t < 40 ? -2 : 3}]}),
                          {plan, selfIdx: 0, dur: 60,
                           init: T0 => ({...R.initialRotation(),
                                         front: {...R.initialFront(), puller: plan.riders[0].id, since: T0}})});
        const n = plan.riders.length;
        assert.equal(at(rows, 42).puller, 'Ann', `plan of ${n}`);
        assert.equal(at(rows, 43).puller, 'Ben', `plan of ${n}`);
        assert.equal(at(rows, 43).since, 40, `plan of ${n}`);
        for (const r of rows) {
            assert.equal(r.st.front.held, null, `plan of ${n}: held at ${r.s}`);
        }
    }
});

test('rule 2: an adopted back candidate is only the change; other holds are no bad flag', () => {
    // Ann stays in front: adopted after BACK_HOLD_MS, classified as back, nothing more.
    const rows = frontRide([[0, 0], [1, 40], [0, 80]], {dur: 115});
    assert.equal(at(rows, 110).puller, 'Ann');
    assert.deepEqual(at(rows, 114).st.order.hist, [false, true]);
    assert.equal(at(rows, 114).st.order.n, 2);
    // Dan (he would skip Cleo) under the skip hold for 10 s, then Ben again: no flag.
    const skip = frontRide([[0, 0], [1, 40], [3, 80], [1, 90]], {dur: 95});
    assert.equal(at(skip, 85).st.front.held, null);
    assert.deepEqual(at(skip, 94).st.order.hist, [false]);
});

test('rule 2: not in the start lock', () => {
    // Fritz (the rider before Arvid, #1) leads the first 30 s after the start, then Arvid.
    const rows = ride(t => {
        const go = t >= 120;
        const fritzFront = go && t < 150;
        return {me: {power: go ? 180 : 0, draft: go ? 60 : 0, speed: go ? 40 : 0},
                others: [{idx: 0, dx: fritzFront ? 2 : 6, power: go ? 300 : 0}, {idx: 1, dx: 4},
                         {idx: 5, dx: fritzFront ? 8 : -4}]};
    }, {selfIdx: 2, dur: 200});
    for (let s = 120; s < 180; s++) {
        assert.equal(at(rows, s).st.backHeld ?? null, null, `no held candidate at ${s}`);
    }
    assert.deepEqual(at(rows, 199).st.order.hist, []);
});

test('rule 3: a resume that is not the line\'s next is one bad flag, no sit-outs', () => {
    // Ann pulls; a climb 10-30.
    const climb = {hill: {kind: 'climb', roller: false}}, flat = {hill: null};
    const terrain = t => t >= 10 && t < 30 ? climb : flat;
    // Cleo leads after it: Ann → Cleo is no next.
    let rows = frontRide([[0, 0], [2, 20]], {dur: 35, terrain});
    let r = at(rows, 30);
    assert.equal(r.puller, 'Cleo'); assert.equal(r.st.front.adopt, 'resume');
    assert.deepEqual(r.st.order.hist, [true]);
    assert.equal(r.st.order.n, 0, 'not classified');
    assert.deepEqual(r.st.order.out, {}, 'Ben is not taken out');
    assert.deepEqual(at(rows, 34).st.order.hist, [true], 'counted once');
    // Ben (the line's next) leads after it: nothing.
    rows = frontRide([[0, 0], [1, 20]], {dur: 35, terrain});
    r = at(rows, 30);
    assert.equal(r.puller, 'Ben'); assert.equal(r.st.front.adopt, 'resume');
    assert.deepEqual(r.st.order.hist, []);
    assert.equal(r.st.order.n, 0);
});

// Rule 5: Ann pulls (10 m ahead of me), Ben and Cleo behind her; dan(t): Dan's dx or null (not in
// the list).
function joinRide(dan, {dur, me = () => ({}), init} = {}) {
    return ride(t => {
        const dx = dan(t);
        return {me: {power: 200, draft: 80, ...me(t)},
                others: [{idx: 0, dx: 10}, {idx: 1, dx: 6}, {idx: 2, dx: 4}, ...(dx == null ? [] : [{idx: 3, dx}])]};
    }, {plan: plan5(), selfIdx: 4, dur,
        init: init || (T0 => ({...R.initialRotation(), front: {...R.initialFront(), puller: ID5.Ann, since: T0}}))});
}

test('rule 5: a rider caught from ahead is ignored while frontmost, at most BACK_HOLD_MS', () => {
    // Dan not in my chain until 60, then 14 m ahead of me (in front of Ann) to the end.
    const rows = joinRide(t => (t >= 60 ? 14 : null), {dur: 95});
    for (let s = 60; s < 90; s++) {
        const r = at(rows, s);
        assert.equal(r.st.joiner?.id, ID5.Dan, `joiner at ${s}`);
        assert.equal(r.puller, 'Ann', `not adopted at ${s}`);
        assert.equal(r.st.front.cand, null, `no candidate at ${s}`);
        assert.equal(r.st.backHeld ?? null, null, `not held at ${s}`);
        assert.equal(r.st.order.n, 0, `not classified at ${s}`);
    }
    // After BACK_HOLD_MS he is tracked like anyone else.
    assert.equal(at(rows, 90).st.joiner, null);
    assert.equal(at(rows, 90).st.front.cand, ID5.Dan);
    // He drops behind Ann at 70: no longer the joiner; in front again at 80: tracked (present now).
    const back = joinRide(t => (t < 60 ? null : t < 70 || t >= 80 ? 14 : 2), {dur: 85});
    assert.equal(at(back, 69).st.joiner?.id, ID5.Dan);
    assert.equal(at(back, 70).st.joiner, null);
    assert.equal(at(back, 80).st.joiner, null);
    assert.equal(at(back, 80).st.front.cand, ID5.Dan);
});

test('rule 5: a rider present before is tracked as today (presence grace)', () => {
    // In my chain from 0, frontmost from 60.
    let rows = joinRide(t => (t >= 60 ? 14 : 2), {dur: 65});
    assert.equal(at(rows, 60).st.joiner, null);
    assert.equal(at(rows, 60).st.front.cand, ID5.Dan);
    // Gone after 40, back in front at 60 (still present: PRESENT_GRACE_MS) and at 61 (absent too long).
    rows = joinRide(t => (t <= 40 ? 2 : t >= 60 ? 14 : null), {dur: 65});
    assert.equal(at(rows, 60).st.joiner, null);
    assert.equal(at(rows, 60).st.front.cand, ID5.Dan);
    rows = joinRide(t => (t <= 40 ? 2 : t >= 61 ? 14 : null), {dur: 65});
    assert.equal(at(rows, 61).st.joiner?.id, ID5.Dan);
    assert.equal(at(rows, 61).st.front.cand, null);
});

test('rule 5: no joiner while standing still', () => {
    // Start pen: Dan rolls in at 40, frontmost.
    const rows = joinRide(t => (t >= 40 ? 14 : null), {dur: 45, me: () => ({power: 0, speed: 0}),
                                                          init: () => R.initialRotation()});
    assert.equal(at(rows, 41).reason, 'still');
    assert.equal(at(rows, 41).st.joiner, null);
});

test('rules 2 and 5: standing still and a plan change reset the joiner and the held candidate', () => {
    const held = frontRide([[0, 0], [1, 40], [0, 80]], {dur: 86});
    assert.equal(at(held, 85).st.backHeld.id, ID5.Ann);
    const join = joinRide(t => (t >= 60 ? 14 : null), {dur: 70});
    assert.equal(at(join, 65).st.joiner.id, ID5.Dan);
    const plan2 = {...plan5(), sig: 'another'};
    for (const st of [at(held, 85).st, at(join, 65).st]) {
        for (const p of [plan2, null]) {
            const c = R.carryRotation(st, p);
            assert.equal(c.backHeld, null);
            assert.equal(c.joiner, null);
        }
    }
    const still = frontRide([[0, 0], [1, 40], [0, 80]], {dur: 95, me: t => (t >= 86 ? {speed: 0} : {})});
    const r = at(still, 94);
    assert.equal(r.reason, 'still');
    assert.equal(r.st.backHeld, null);
    assert.equal(r.st.joiner, null);
});


// ---------- 20 Nov 2026: fixes after the final review of the chaos counter ----------

// Dropped: as frontRide, but while `away` [from, to) every teammate is 60 m ahead of me (my chain is
// just me: alone). The team rides the plan and skips me meanwhile.
function droppedRide(fronts, away, {dur}) {
    const p = plan5();
    const frontAt = t => fronts.filter(([, from]) => from <= t).at(-1)[0];
    return ride(t => {
        const off = t >= away[0] && t < away[1] ? 60 : 0;
        const f = frontAt(t);
        const rest = [0, 1, 2, 3].filter(i => i !== f);
        return {me: {power: 200, draft: off ? 0 : 80},
                others: [{idx: f, dx: 10 + off}, ...rest.map((idx, k) => ({idx, dx: 6 - 2 * k + off}))]};
    }, {plan: p, selfIdx: 4, dur,
        init: T0 => ({...R.initialRotation(), front: {...R.initialFront(), puller: ID5.Ann, since: T0}})});
}

test('alone: the front rider of the group I rejoin is no joiner; the adoption is not classified', () => {
    // Ann 0, Ben 40, Cleo 80, Dan 120; I am dropped 100-125 (longer than PRESENT_GRACE_MS) and back
    // while Dan, the planned next, pulls.
    const rows = droppedRide([[0, 0], [1, 40], [2, 80], [3, 120]], [100, 125], {dur: 140});
    assert.equal(at(rows, 99).puller, 'Cleo');
    assert.deepEqual(at(rows, 99).st.order.hist, [false, false]);
    assert.equal(at(rows, 124).reason, 'alone');
    assert.equal(at(rows, 125).st.joiner, null, 'only I was present before: no group, no joiner');
    const r = rows.find(x => x.s >= 125 && x.st.front.adopt);
    assert.equal(r.s, 129, 'adopted after HOLD_MS, not after BACK_HOLD_MS');
    assert.equal(r.puller, 'Dan');
    assert.equal(r.st.order.n, 2, 'the adoption after riding alone is not classified');
    assert.deepEqual(r.st.order.hist, [false, false], 'the line\'s next: no flag');
    assert.deepEqual(r.st.order.out, {});
});

test('alone: back while the team is further on, one bad flag and nobody out', () => {
    // Dropped 100-170: meanwhile the team went Cleo, Dan, Ann (skipping me). Back while Ann pulls.
    const rows = droppedRide([[0, 0], [1, 40], [2, 80], [3, 120], [0, 160]], [100, 170], {dur: 200});
    assert.equal(at(rows, 170).st.joiner, null);
    const r = rows.find(x => x.s >= 170 && x.st.front.adopt);
    assert.equal(r.s, 186, 'Ann would skip Dan: the skip hold (CHAOS_HOLD_MS), not the joiner\'s 30 s');
    assert.equal(r.puller, 'Ann');
    assert.equal(r.st.front.adopt, 'front');
    assert.equal(r.st.order.n, 2, 'not classified: Dan is not taken out');
    assert.deepEqual(r.st.order.out, {});
    assert.deepEqual(r.st.order.hist, [false, false, true], 'Cleo → Ann is not the line\'s next: one flag');
    assert.deepEqual(at(rows, 199).st.order.hist, [false, false, true], 'counted once');
    assert.equal(at(rows, 199).reason, null);
});

test('alone: the puller still in front when I am back, the next change is classified as before', () => {
    // Dropped 95-105 while Cleo pulls; she is in front when I am back, Dan takes over at 120.
    const rows = droppedRide([[0, 0], [1, 40], [2, 80], [3, 120]], [95, 105], {dur: 130});
    assert.equal(at(rows, 104).reason, 'alone');
    assert.equal(at(rows, 107).st.unseen, 'alone');
    assert.equal(at(rows, 108).st.unseen, null, 'Cleo seen at the front again (HOLD_MS)');
    const r = rows.find(x => x.s >= 105 && x.st.front.adopt);
    assert.equal(r.puller, 'Dan');
    assert.equal(r.st.order.n, 3, 'classified');
});

// A start: the pen until 120; I am Cleo (#3), fronts [[idx, from s], ...] lead (Cleo never).
function startRun(fronts, dur = 340) {
    const frontAt = t => fronts.filter(([, from]) => from <= t).at(-1)[0];
    return ride(t => {
        const go = t >= 120;
        const f = frontAt(t);
        const rest = [0, 1, 3, 4].filter(i => i !== f);
        return {me: {power: go ? 200 : 0, draft: go ? 80 : 0, speed: go ? 42 : 0},
                others: [{idx: f, dx: go ? 10 : 3}, ...rest.map((idx, k) => ({idx, dx: go ? 6 - 1.5 * k : 2 - k}))]};
    }, {plan: plan5(), selfIdx: 2, dur});
}

test('start: the start puller never seen, the first adoption after the lock is not classified', () => {
    // Pen until 120; I am Cleo (#3). Dan (#4) leads from the roll-off; then Eve, Ann, Ben, Dan (the
    // team skips me), Ann never in front in the lock.
    const rows = startRun([[3, 0], [4, 200], [0, 240], [1, 280], [3, 320]]);
    assert.equal(at(rows, 120).puller, 'Ann');
    assert.equal(at(rows, 120).st.front.adopt, 'start');
    const r = rows.find(x => x.s > 120 && x.st.front.adopt);
    assert.equal(r.puller, 'Dan');
    assert.equal(r.st.order.n, 0, 'Ann → Dan was never seen: not classified');
    assert.deepEqual(r.st.order.out, {}, 'Ben is not taken out');
    assert.deepEqual(r.st.order.hist, [], 'no flag');
    assert.equal(at(rows, 339).puller, 'Dan');
    assert.ok(rows.every(x => x.reason !== 'chaos'), 'the team rides the plan from Dan on: no chaos');
    // Ann in front for 20 s after the roll-off: she was seen, Ann → Dan is classified (a skip).
    const seen = startRun([[0, 0], [3, 140], [4, 200]]);
    const s = seen.find(x => x.s > 120 && x.st.front.adopt);
    assert.equal(s.puller, 'Dan');
    assert.equal(s.st.order.n, 1);
    assert.deepEqual(O.orderOutIds(s.st.order), [ID5.Ben]);
});

test('rule 1: quick counts from the last puller change, not from the end of a climb', () => {
    // Cleo (skipping Ben) adopted at 55; a climb 60-100; Ben in front from 105, adopted at 120:
    // 65 s after the skip, within the round. The climb's end is no change: two bad, chaos.
    const climb = {hill: {kind: 'climb', roller: false}}, flat = {hill: null};
    const rows = frontRide([[0, 0], [2, 40], [1, 105]], {dur: 125, terrain: t => t >= 60 && t < 100 ? climb : flat});
    assert.equal(at(rows, 55).puller, 'Cleo');
    assert.deepEqual(O.orderOutIds(at(rows, 55).st.order), [ID5.Ben]);
    const r = at(rows, 120);
    assert.equal(r.puller, 'Ben');
    assert.equal(at(rows, 119).puller, 'Cleo');
    assert.deepEqual(r.st.order.hist, [false, true, true]);
    assert.equal(r.reason, 'chaos');
});

test('rule 2: no flag for me held as the back candidate during the hand-off of my own pull', () => {
    // I am Ben (#2) and pull from 0; my power drops at 41 (my end at 42 hands the pull to Cleo), but I
    // stay frontmost until Cleo comes past at `pass`.
    const p = plan5();
    const handOff = pass => ride(t => ({
        me: {power: t < 41 ? 320 : t < 44 ? 90 : 200, draft: t < pass ? 0 : 80},
        others: t < pass ? [2, 3, 4, 0].map((idx, k) => ({idx, dx: -2 - 2 * k})) :
            [{idx: 2, dx: 6}, {idx: 3, dx: -2}, {idx: 4, dx: -4}, {idx: 0, dx: -6}],
    }), {plan: p, selfIdx: 1, dur: 70,
         init: T0 => ({...R.initialRotation(), front: {...R.initialFront(), puller: ID5.Ben, since: T0}})});
    const rows = handOff(60);
    assert.deepEqual(events(rows), ['42:end']);
    assert.equal(at(rows, 42).puller, 'Cleo');
    assert.equal(at(rows, 42).st.front.adopt, 'end');
    assert.equal(at(rows, 55).st.front.held, null, 'no back hold against me after my own end (C1)');
    for (let s = 42; s < 70; s++) {
        assert.equal(at(rows, s).st.backHeld ?? null, null, `not counted at ${s}`);
        assert.deepEqual(at(rows, s).st.order.hist, [], `no flag at ${s}`);
    }
    // Another puller's pull (not handed over by my end; my last end was a minute before it): me held
    // there still counts.
    const other = ride(t => ({
        me: {power: 200, draft: t >= 40 && t < 50 ? 0 : 80},
        others: t >= 40 && t < 50 ? [2, 3, 4, 0].map((idx, k) => ({idx, dx: -2 - 2 * k})) :
            [{idx: 2, dx: 6}, {idx: 3, dx: 4}, {idx: 4, dx: 2}, {idx: 0, dx: -2}],
    }), {plan: p, selfIdx: 1, dur: 60,
         init: T0 => ({...R.initialRotation(),
                       front: {...R.initialFront(), puller: ID5.Cleo, since: T0, last: {kind: 'end', at: T0 - 60000}}})});
    assert.equal(at(other, 45).st.front.held, 'back');
    assert.deepEqual(at(other, 59).st.order.hist, [true]);
});


// ---------- 20 Nov 2026 (audit fixes): C1, the end of my own pull ----------

// I am Ann (#1) and pull from 0, frontmost with my draft 0; the others behind me at -2/-4/-6/-8 m.
// power(t) my power, `watts` and `pullS` every rider's plan; draft(t) and others(t) override.
function myPull(power, {watts = 300, pullS = 30, dur = 60, draft = () => 0, others = null} = {}) {
    const p = plan5();
    p.riders.forEach(r => { r.watts = watts; r.pullS = pullS; });
    return ride(t => ({me: {power: power(t), draft: draft(t)},
                       others: others?.(t) ?? [1, 2, 3, 4].map((idx, k) => ({idx, dx: -2 - 2 * k}))}),
                {plan: p, selfIdx: 0, dur,
                 init: T0 => ({...R.initialRotation(), front: {...R.initialFront(), puller: ID5.Ann, since: T0}})});
}

test('C1: one 0 W sample does not end my pull; two do, and with my power back in front it comes back', () => {
    // At 250 W one zero ended the pull before (mean of 2: 125 W < 130 W, every target up to 259 W).
    const one = myPull(t => t === 25 ? 0 : 250, {watts: 250});
    assert.deepEqual(events(one), []);
    for (const r of one) assert.equal(r.puller, 'Ann', `s ${r.s}`);
    const two = myPull(t => t === 25 || t === 26 ? 0 : 250, {watts: 250});
    assert.deepEqual(events(two), ['26:end']);
    for (let s = 26; s <= 37; s++) {
        assert.equal(at(two, s).puller, 'Ben', `s ${s}`);
        assert.equal(at(two, s).since, 25, `s ${s}`);
    }
    // My ignore window ends at 35, HOLD_MS later my pull is back with its old since (not the 30 s
    // back hold), and neither change is classified.
    assert.equal(at(two, 38).puller, 'Ann');
    assert.equal(at(two, 38).since, 0);
    assert.equal(at(two, 38).st.front.adopt, 'back');
    assert.deepEqual(at(two, 59).st.order.hist, []);
});

test('C1: my end is judged against my own target', () => {
    // A 120 W target: 120 W ended every pull at END_MIN_S before. Now the threshold is
    // min(END_W, END_FRAC x target) = 72 W.
    assert.deepEqual(events(myPull(() => 120, {watts: 120})), []);
    assert.deepEqual(events(myPull(t => t === 25 || t === 26 ? 80 : 120, {watts: 120})), []);
    assert.deepEqual(events(myPull(t => t === 25 || t === 26 ? 70 : 120, {watts: 120})), ['26:end']);
    // A 300 W target still uses END_W (130 W), not 0.6 x 300 = 180 W (controller ruling P1).
    assert.deepEqual(events(myPull(t => t === 25 || t === 26 ? 150 : 300)), []);
    assert.deepEqual(events(myPull(t => t === 25 || t === 26 ? 120 : 300)), ['26:end']);
});

test('C1: a real end and a slow pass: no undo at rest power, no back hold against me', () => {
    // My power drops at 25 (end at 26), I fade at 200 W in front; Ben comes past only at 45.
    const rows = myPull(t => t < 25 ? 300 : t < 27 ? 80 : 200, {
        dur: 70,
        draft: t => t < 45 ? 0 : 80,
        others: t => t < 45 ? null : [{idx: 1, dx: 3}, {idx: 2, dx: -2}, {idx: 3, dx: -4}, {idx: 4, dx: -6}],
    });
    assert.deepEqual(events(rows), ['26:end']);
    for (let s = 26; s < 70; s++) assert.equal(at(rows, s).puller, 'Ben', `s ${s}`);
    for (const r of rows) assert.equal(r.st.front.held, null, `s ${r.s}`);
});

test('trackFront: the undo of my end needs selfOn, and the rider my end named in front ends it', () => {
    const endThen = (steps, selfOn) => {
        let s = R.trackFront({...R.initialFront(), puller: 'me', since: 0}, {now: 1000, frontId: 'me'});
        s = R.trackFront(s, {now: 26000, frontId: 'me', selfEnd: {id: 'me', at: 25000, nextId: 'B'}});
        for (const [now, frontId] of steps) s = R.trackFront(s, {now, frontId, selfOn});
        return s;
    };
    const meFrom35 = [35000, 36000, 37000, 38000].map(now => [now, 'me']);
    let s = endThen(meFrom35, true);
    assert.deepEqual([s.puller, s.since, s.adopt], ['me', 0, 'back']);
    s = endThen(meFrom35, false);
    assert.deepEqual([s.puller, s.since], ['B', 25000]);
    // B in front for a moment (inside my ignore window): the hand-off happened, no undo after it.
    s = endThen([[30000, 'B'], ...meFrom35, [39000, 'me'], [40000, 'me']], true);
    assert.deepEqual([s.puller, s.since], ['B', 25000]);
});

test('C1: after the rider my end named has been in front, the back hold holds me again', () => {
    // Review probe q1 (21 Nov 2026): 60 s pulls, my end at 41 hands to Ben, he passes at 46 and
    // pulls; I show in front again 85-92 (44 s after my end). With the exception for the whole of
    // his pull I was the puller 88-107, Ben then got a fresh clock and one bad flag.
    const rows = myPull(t => t < 40 ? 300 : t < 42 ? 80 : 200, {
        pullS: 60, dur: 110,
        draft: t => t < 46 ? 0 : 80,
        others: t => t < 46 || (t >= 85 && t < 93) ? null :
            [{idx: 1, dx: 10}, {idx: 2, dx: 6}, {idx: 3, dx: 4}, {idx: 4, dx: 2}],
    });
    assert.deepEqual(events(rows), ['41:end']);
    for (let s = 41; s < 110; s++) {
        assert.equal(at(rows, s).puller, 'Ben', `s ${s}`);
        assert.equal(at(rows, s).since, 40, `s ${s}`);
    }
    assert.equal(at(rows, 90).st.front.held, 'back');
    // Held and gone unadopted, but my own hand-off is not counted (backHeldStep).
    for (const r of rows) assert.equal(r.st.backHeld ?? null, null, `s ${r.s}`);
    assert.deepEqual(at(rows, 109).st.order.hist, []);
});

test('C1: a plan target of 0 W or less counts as no target (end at END_W, no undo)', () => {
    // 0 W target: my end at END_W (130 W), not at 0 W.
    assert.deepEqual(events(myPull(t => t === 25 || t === 26 ? 120 : 300, {watts: 0})), ['26:end']);
    assert.deepEqual(events(myPull(t => t === 25 || t === 26 ? 120 : 300, {watts: -50})), ['26:end']);
    assert.equal(R.powerBack(hist([300, 300, 300]), 0), false);
    assert.equal(R.powerBack(hist([300, 300, 300]), -50), false);
    // No undo of my end with a 0 W target (with 300 W it comes back at 38 with since 0, as at 250 W
    // above): Ben keeps the pull past 38, and my pull never comes back with its old since.
    const rows = myPull(t => t === 25 || t === 26 ? 0 : 300, {watts: 0});
    assert.deepEqual(events(rows), ['26:end']);
    for (let s = 26; s <= 40; s++) assert.equal(at(rows, s).puller, 'Ben', `s ${s}`);
    for (const r of rows) assert.notEqual(r.st.front.adopt, 'back', `s ${r.s}`);
    const real = myPull(t => t === 25 || t === 26 ? 0 : 300);
    assert.deepEqual([at(real, 38).puller, at(real, 38).st.front.adopt], ['Ann', 'back']);
});


// ---------- 20 Nov 2026 (audit fixes): I1, I8, I6, the round count and the unseen puller ----------

test('I1: my hand-off counts for the round', () => {
    // Probe p16: everyone present, the team rides the plan, 40 s pulls; Cleo misses one turn (the
    // round from 200 s) and is back in her slot the round after. My rest power is 100 W, so my end
    // is found by my power drop ('end', not classified). Before: that turn did not count, Cleo's
    // return was "within the round" (twice bad), 443-562 s of false chaos.
    const turn = [0, 1, 2, 3, 4, 0, 1, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4];
    for (const selfIdx of [4, 0, 3]) {
        const rows = frontRide(turn.map((idx, k) => [idx, k * 40]),
                               {selfIdx, dur: 960, me: (t, f) => ({power: f === selfIdx ? 300 : 100})});
        assert.deepEqual(rows.filter(r => r.st.order.chaos).map(r => r.s), [], `no chaos (I am #${selfIdx + 1})`);
        const i = rows.findIndex(r => r.st.front.adopt === 'end');
        assert.ok(i > 0, `my end is a hand-off (I am #${selfIdx + 1})`);
        assert.equal(rows[i].st.order.turns, rows[i - 1].st.order.turns + 1, 'my hand-off is a turn');
        assert.equal(rows[i].st.order.n, rows[i - 1].st.order.n, 'but not classified');
    }
});

test('I8: the rider my hand-off names is unseen until he is in front', () => {
    // Probe p09 P11: Ann sits out; Ben, Cleo, Dan and I (Eve) pull in turn, 40 s each. Before: my end
    // named Ann every round, nobody learned she sits out, and she was the puller 16 s each round (my
    // countdown snapped 134 → 92).
    const me = (t, f) => ({power: f === 4 ? 300 : 100});
    const rows = frontRide(Array.from({length: 16}, (_, k) => [[1, 2, 3, 4][k % 4], k * 40]),
                           {selfIdx: 4, dur: 640, me});
    const end = rows.find(r => r.st.front.adopt === 'end');
    assert.equal(end.s, 161);
    assert.equal(end.puller, 'Ann');
    assert.equal(end.st.unseen, 'end');
    const next = rows.find(r => r.s > end.s && r.st.front.adopt === 'front');
    assert.equal(next.puller, 'Ben');
    assert.equal(next.st.order.n, at(rows, next.s - 1).st.order.n + 1, 'classified');
    assert.equal(end.st.order.turns, at(rows, end.s - 1).st.order.turns + 1, 'my hand-off counts a turn');
    assert.equal(next.st.order.turns, end.st.order.turns, 'Ann never pulled: Ben takes her turn, one new puller');
    assert.deepEqual(O.orderOutIds(next.st.order), [ID5.Ann], 'classified from me: Ann sits out');
    const end2 = rows.find(r => r.s > next.s && r.st.front.adopt === 'end');
    assert.equal(end2.puller, 'Ben');
    assert.deepEqual(rows.filter(r => r.puller === 'Ann' && r.s >= next.s).map(r => r.s), [],
                     'Ann is no puller after that');
    assert.deepEqual(rows.filter(r => r.st.order.chaos).map(r => r.s), []);
    // All five in plan order: the rider my end named is in front; unseen clears after HOLD_MS.
    const all = frontRide(Array.from({length: 10}, (_, k) => [k % 5, k * 40]), {selfIdx: 4, dur: 400, me});
    const e = all.find(r => r.st.front.adopt === 'end');
    assert.equal(e.puller, 'Ann');
    assert.equal(at(all, e.s + 2).st.unseen, 'end');
    assert.equal(at(all, e.s + 3).st.unseen, null);
});

test('I6: one sample of the start puller in front does not clear unseen \'start\'', () => {
    // Probe p05 B: as the start test above, but Ann is the frontmost plan rider for one sample at 130.
    // Before: that sample cleared unseen, Ann → Dan was classified (a skip, Ben out) and gave 160 s of
    // false chaos.
    const rows = startRun([[3, 0], [0, 130], [3, 131], [4, 200], [0, 240], [1, 280], [3, 320]]);
    assert.equal(at(rows, 131).st.unseen, 'start');
    const r = rows.find(x => x.s > 120 && x.st.front.adopt);
    assert.equal(r.puller, 'Dan');
    assert.equal(r.st.order.n, 0, 'Ann → Dan was not seen: not classified');
    assert.deepEqual(r.st.order.out, {});
    assert.deepEqual(rows.filter(x => x.st.order.chaos).map(x => x.s), []);
});

test('I8: an adoption of me while the rider my end named is unseen is not classified', () => {
    // As the slow pass in C1 above, but Ben comes past only at 60: from 36 (after SELF_IGNORE_MS) I am
    // the frontmost rider at rest power, adopted after CHAOS_HOLD_MS while Ben was never in front.
    const rows = myPull(t => t < 25 ? 300 : t < 27 ? 80 : 200, {
        dur: 60,
        draft: t => t < 60 ? 0 : 80,
        others: t => t < 60 ? null : [{idx: 1, dx: 3}, {idx: 2, dx: -2}, {idx: 3, dx: -4}, {idx: 4, dx: -6}],
    });
    assert.deepEqual(events(rows), ['26:end']);
    assert.equal(at(rows, 26).st.unseen, 'end');
    const r = rows.find(x => x.s > 26 && x.st.front.adopt === 'front');
    assert.equal(r.puller, 'Ann');
    assert.equal(at(rows, r.s - 1).st.unseen, 'end');
    assert.equal(r.st.order.n, 0, 'not classified (from me to me is no change seen at the front)');
    assert.equal(at(rows, 26).st.order.turns, at(rows, 25).st.order.turns + 1, 'my hand-off counts a turn');
    assert.equal(r.st.order.turns, at(rows, 25).st.order.turns, 'Ben never pulled and I pulled on: no new turn');
    assert.deepEqual(r.st.order.hist, []);
});

test('I-3: I stay in front at rest power and nobody passes: one end, then I stay the puller', () => {
    // Final review, 21 Nov 2026 (I-3, probe a1): 5 riders, 300 W target, I pull 30 s and then ride
    // in front at 100 W with my draft 0. My pull ended at 31, 60, 88, 116, 144, 172 s (24 s rest
    // countdown, 5 s my pull, without end): each re-adoption of me (after CHAOS_HOLD_MS) was past
    // END_MIN_S at once and my rest power ended it again. Now my end needs a pull at power since I
    // became the puller (JUMP_TARGET_FRAC x target, END_W without a target).
    const rows = myPull(t => t < 30 ? 300 : 100, {dur: 200});
    assert.deepEqual(events(rows), ['31:end']);
    const back = rows.find(r => r.s > 31 && r.puller === 'Ann');
    assert.ok(back, 'I am adopted again');
    for (const r of rows.filter(x => x.s >= back.s)) {
        assert.equal(r.puller, 'Ann', `s ${r.s}`);
        assert.equal(r.view, 'pull', `s ${r.s}`);
    }
    assert.deepEqual(rows.filter(r => r.st.order.chaos).map(r => r.s), []);
    assert.deepEqual(at(rows, 199).st.order.hist, []);
    // Without a target the same with END_W.
    assert.deepEqual(events(myPull(t => t < 30 ? 300 : 100, {dur: 200, watts: 0})), ['31:end']);
    // Power back at pull power after the re-adoption: my next end is found again.
    const again = myPull(t => t < 30 ? 300 : t >= 80 && t < 110 ? 300 : 100, {dur: 200});
    const ends = events(again);
    assert.equal(ends.length, 2, ends.join(' '));
    assert.ok(Number(ends[1].split(':')[0]) >= 110, ends.join(' '));
});

test('I-3: my re-adoption before the named rider passed is no change at the front', () => {
    // Fix wave ruling, 21 Nov 2026: my end at 31, I ride on in front at 100 W, re-adopted at 55 (the
    // chaos hold after my end); Ben comes past only at 61 (30 s after my end) and pulls in full. With
    // my re-adoption counted as a change he waited CHAOS_HOLD_MS (adopted at 76, 15 s of "my pull"
    // while I rested); now the plain HOLD_MS from 61.
    const rows = myPull(t => t < 30 ? 300 : 100, {
        dur: 120,
        draft: t => t < 61 ? 0 : 80,
        others: t => t < 61 ? null : [{idx: 1, dx: 10}, {idx: 2, dx: -2}, {idx: 3, dx: -4}, {idx: 4, dx: -6}],
    });
    assert.deepEqual(events(rows), ['31:end']);
    const me = rows.find(r => r.s > 31 && r.puller === 'Ann');
    assert.equal(me.s, 55);
    assert.equal(me.st.front.changedAt, at(rows, 31).st.front.changedAt, 'no change at the front');
    const ben = rows.find(r => r.s > me.s && r.puller === 'Ben');
    assert.equal(ben.s, 64);
    assert.equal(ben.since, 61);
    for (let s = 64; s < 120; s++) assert.equal(at(rows, s).puller, 'Ben', `s ${s}`);
    assert.deepEqual(rows.filter(r => r.st.order.chaos).map(r => r.s), []);
    assert.deepEqual(O.orderOutIds(at(rows, 119).st.order), []);
    assert.deepEqual(at(rows, 119).st.order.hist, [false], 'me -> Ben: the next, one change, not bad');
});

test('I1/I8: the hand-off\'s turn goes back when the named rider never pulls', () => {
    // Review of I1/I8 (21 Nov 2026): Ann → Cleo skips Ben, then Cleo, Dan and I (Eve) pull; my end
    // names Ann, but Ben comes through instead. He is back after three others of five: within the
    // round, two flags. With my end's turn kept he counted a full round later (no flag, no chaos).
    const me = (t, f) => ({power: f === 4 ? 300 : 100});
    const rows = frontRide([[0, 0], [2, 40], [3, 80], [4, 120], [1, 160], [2, 200], [3, 240], [4, 280]],
                           {selfIdx: 4, dur: 320, me});
    const end = rows.find(r => r.st.front.adopt === 'end');
    assert.deepEqual([end.s, end.puller, end.st.order.turns], [161, 'Ann', 4]);
    const ben = rows.find(r => r.s > end.s && r.st.front.adopt === 'front');
    assert.deepEqual([ben.s, ben.puller], [177, 'Ben']);
    assert.equal(ben.st.order.turns, end.st.order.turns, 'Ben takes the turn my end gave Ann');
    assert.deepEqual(ben.st.order.hist, [false, false, true, true]);
    assert.deepEqual(O.orderOutIds(ben.st.order), [ID5.Ann]);
    const chaos = rows.filter(r => r.st.order.chaos).map(r => r.s);
    assert.deepEqual([chaos[0], chaos.at(-1), chaos.length], [177, 281, 105]);
    // The undo of my end: the turn goes back, nobody new pulled.
    const undo = myPull(t => t === 25 || t === 26 ? 0 : 300);
    assert.deepEqual([at(undo, 26).st.front.adopt, at(undo, 26).st.order.turns], ['end', 1]);
    assert.deepEqual([at(undo, 38).st.front.adopt, at(undo, 38).puller, at(undo, 38).st.order.turns], ['back', 'Ann', 0]);
});

test('I1/I8: my start skips Dan, my pull, Dan adopted 16 s after my end: two flags, not a quick return', () => {
    // Rule 1 counts from the last turn that happened: my start (the hand-off's turn is taken back),
    // 42 s before Dan's adoption, not my end. A whole pull of mine lies between the skip and the
    // return: within the round, two flags (Eve → Dan is a back and the return), no undo of the skip.
    const rows = frontRide([[0, 0], [1, 40], [2, 80], [4, 120], [3, 160], [0, 200]],
                           {selfIdx: 4, dur: 240, me: (t, f) => ({power: f === 4 ? 300 : 100})});
    const mine = rows.find(r => r.st.front.adopt && r.puller === 'Eve');
    assert.equal(mine.s, 135);
    assert.deepEqual(O.orderOutIds(mine.st.order), [ID5.Dan], 'Cleo → Eve skips Dan');
    const end = rows.find(r => r.st.front.adopt === 'end');
    assert.deepEqual([end.s, end.puller], [161, 'Ann']);
    const dan = rows.find(r => r.s > end.s && r.st.front.adopt === 'front');
    assert.deepEqual([dan.s, dan.puller], [177, 'Dan']);
    assert.deepEqual(dan.st.order.hist, [false, false, true, true]);
    assert.deepEqual(dan.st.order.out, {});
    assert.equal(dan.reason, 'chaos');
    assert.equal(end.st.pullerAt, mine.st.pullerAt, 'my hand-off moves no pullerAt');
});


// ---------- 20 Nov 2026 (audit fixes): I9, M1, M8, the start puller, the skip hold on the line ----------

test('startPuller: the first plan rider present in the pen, null when nobody but me is known', () => {
    const plan = plan5();
    assert.equal(R.startPuller(plan, {presentIds: Object.values(ID5), selfId: ID5.Eve}), ID5.Ann);
    assert.equal(R.startPuller(plan, {presentIds: [ID5.Ben, ID5.Cleo, ID5.Dan, ID5.Eve], selfId: ID5.Eve}), ID5.Ben);
    assert.equal(R.startPuller(plan, {presentIds: [ID5.Cleo], selfId: ID5.Cleo}), null);
    assert.equal(R.startPuller(plan, {presentIds: [], selfId: ID5.Cleo}), null);
    assert.equal(R.startPuller(plan, {presentIds: [ID5.Dan, ID5.Cleo], selfId: ID5.Cleo}), ID5.Cleo);
});

// The start pen until 60 (everyone at 0 km/h), then the roll-off at 42 km/h. I am Cleo (#3), Ann
// (#1) is not in the race. others(go, t): the others' places.
function penRun(others, {dur = 100} = {}) {
    return ride(t => {
        const go = t >= 60;
        return {me: {power: go ? 160 : 0, draft: go ? 80 : 0, speed: go ? 42 : 0}, others: others(go, t)};
    }, {plan: plan5(), selfIdx: 2, dur});
}

test('I9: plan #1 not in the pen, the first present plan rider has the start', () => {
    // Probe p08: Ben leads from the roll-off. Before: the start lock named Ann, who never came,
    // the puller for the first 75 s.
    const rows = penRun(go => [{idx: 1, dx: go ? 10 : 3}, {idx: 3, dx: go ? 6 : 2}, {idx: 4, dx: go ? 4 : 1}]);
    const r = at(rows, 60);
    assert.equal(r.puller, 'Ben');
    assert.equal(r.st.front.adopt, 'start');
    assert.equal(r.st.front.bonus.id, ID5.Ben);
    assert.equal(r.since, 60);
    assert.equal(r.st.startAt, r.now);
});

test('I9: only me in my chain in the pen: no start lock', () => {
    // Review focus 5: Ben and Dan 40/42 m ahead (not in my chain) until 69, then 2/4 m behind me.
    // Before: Ann (absent) was locked as the puller for 60 s.
    const rows = penRun((go, t) => [{idx: 1, dx: t < 70 ? 40 : -2}, {idx: 3, dx: t < 70 ? 42 : -4}]);
    const r = at(rows, 60);
    assert.equal(r.st.locked, false);
    assert.equal(r.st.startAt, null);
    assert.notEqual(r.st.front.adopt, 'start');
    for (const x of rows) assert.notEqual(x.puller, 'Ann', `s ${x.s}`);
});

test('skipsAhead: places are counted on the line when lineIds is given', () => {
    const plan = {riders: ['a', 'b', 'c', 'd', 'e', 'f'].map(id => ({id}))};
    assert.equal(R.skipsAhead(plan, {pullerId: 'a', nextId: 'b', frontId: 'e'}), false);
    assert.equal(R.skipsAhead(plan, {pullerId: 'a', nextId: 'b', frontId: 'e', lineIds: ['a', 'b', 'e', 'f']}), true);
});

test('M1: the skip hold counts places on the line', () => {
    // Probe p22 P23: a plan of six (Finn added); I am Finn at the back; Ann pulls since T0, Cleo
    // and Dan are not in the race. Eve (one past the next on the line) is in front 100-105, then
    // Ben. Before: Eve counted four places on from Ann in the raw plan, no skip hold, and was the
    // puller 103-120.
    const p = plan5();
    const plan = {...p, riders: [...p.riders, {id: '7100006', name: 'Finn', pullS: 30, watts: 300}]};
    const rows = ride(t => {
        const f = t < 100 ? 0 : t < 106 ? 4 : 1;
        const rest = [0, 1, 4].filter(i => i !== f);
        return {me: {power: 200, draft: 80}, others: [{idx: f, dx: 10}, ...rest.map((idx, k) => ({idx, dx: 6 - 1.5 * k}))]};
    }, {plan, selfIdx: 5, dur: 140,
        init: T0 => ({...R.initialRotation(), front: {...R.initialFront(), puller: ID5.Ann, since: T0}})});
    for (const r of rows) assert.notEqual(r.puller, 'Eve', `s ${r.s}`);
    for (let s = 0; s <= 108; s++) assert.equal(at(rows, s).puller, 'Ann', `s ${s}`);
    for (let s = 109; s < 140; s++) assert.equal(at(rows, s).puller, 'Ben', `s ${s}`);
    assert.deepEqual(at(rows, 139).st.order.hist, [false]);
});

test('M8: a second race in one session gets a fresh start', () => {
    // Probe p41 (last line): I am Ann, the team behind me. Pen 0-59, ride 60-199, stand 200-259,
    // ride from 260. Before: startAt stayed set from the first race, so the pen of the second did
    // not arm plan #1 (penModel).
    const rows = ride(t => {
        const go = (t >= 60 && t < 200) || t >= 260;
        return {me: {power: go ? 300 : 0, draft: 0, speed: go ? 42 : 0},
                others: [{idx: 1, dx: -2}, {idx: 2, dx: -4}, {idx: 3, dx: -6}, {idx: 4, dx: -8}]};
    }, {plan: plan5(), selfIdx: 0, dur: 300});
    assert.equal(at(rows, 229).st.startAt, at(rows, 60).now);
    assert.equal(at(rows, 230).st.startAt, null);
    assert.equal(at(rows, 240).reason, 'still');
    assert.equal(at(rows, 240).st.startAt, null);
    assert.equal(at(rows, 260).st.startAt, at(rows, 260).now);
});

test('M-4: standing after the finish line keeps the start, until I ride on or another event shows', () => {
    // Final review, 21 Nov 2026 (M-4, probe m8): I am Ann (#1). Pen 0-39, ride 40-139 with the finish
    // line at 120 (finish mode from 79), standing from 140. M8 cleared startAt after 30 s of
    // standing, so plan #1's windows got READY (penModel) from 170 s on while the gate was open.
    const others = [{idx: 1, dx: -2}, {idx: 2, dx: -4}, {idx: 3, dx: -6}, {idx: 4, dx: -8}];
    const race = (t, after) => {
        const go = t >= 40 && t < 140;
        return {me: {power: go ? 300 : 0, draft: 0, speed: go ? 45 : 0,
                     top: t < 140 ? {remainingType: 'event', remainingMetric: 'distance', remaining: Math.max(0, (120 - t) * 12)} :
                         after(t)}, others};
    };
    // Sauce keeps showing 0 m to go, or stops showing the event: either way no fresh start.
    for (const after of [() => ({remainingType: 'event', remainingMetric: 'distance', remaining: 0}), () => ({})]) {
        const rows = ride(t => race(t, after), {plan: plan5(), selfIdx: 0, dur: 230});
        assert.equal(at(rows, 100).st.finish, true);
        assert.equal(at(rows, 150).reason, 'still');
        for (let s = 40; s < 230; s++) assert.equal(at(rows, s).st.startAt, at(rows, 40).now, `s ${s}`);
    }
    // Another event shows (the pen of the next race) after 40 s of standing: a fresh start at once.
    const next = ride(t => race(t, t => t < 180 ? {} : {remainingType: 'event', remainingMetric: 'distance', remaining: 40000}),
                      {plan: plan5(), selfIdx: 0, dur: 230});
    assert.equal(at(next, 179).st.startAt, at(next, 40).now);
    assert.equal(at(next, 180).st.startAt, null);
    // Riding on after the finish (a cool-down) and a stop of 30 s: a fresh start, as M8 had it.
    const on = ride(t => {
        const go = (t >= 40 && t < 140) || (t >= 150 && t < 170);
        return {me: {power: go ? 300 : 0, draft: 0, speed: go ? 45 : 0,
                     top: t < 140 ? {remainingType: 'event', remainingMetric: 'distance', remaining: Math.max(0, (120 - t) * 12)} : {}},
                others};
    }, {plan: plan5(), selfIdx: 0, dur: 230});
    assert.equal(at(on, 199).st.startAt, at(on, 40).now);
    assert.equal(at(on, 200).st.startAt, null);
});


// ---------- 21 Nov 2026: the hand-over detector in the front tracking (design 2026-11-21-paceline-beta5 §1) ----------

const FIRE = (id, since, slow = false) => ({id, since, kind: 'arm', slow});

test('trackFront: a fire adopts at once from the arm moment', () => {
    const a = {...R.initialFront(), puller: 'A', since: 0, changedAt: 0};
    let s = R.trackFront(a, {now: 40000, frontId: 'A', fired: FIRE('B', 36000)});
    assert.equal(s.puller, 'B'); assert.equal(s.since, 36000);
    assert.equal(s.adopt, 'front'); assert.equal(s.fired, 'arm');
    assert.equal(s.cand, null); assert.equal(s.candSince, null);
    assert.equal('firedCand' in s, false);
    // No earlier than the puller's since + HOLD_MS.
    s = R.trackFront(a, {now: 40000, frontId: 'A', fired: FIRE('B', 1000)});
    assert.equal(s.puller, 'B'); assert.equal(s.since, 3000);
    // The chaos hold is satisfied too: a change 10 s ago does not hold him.
    s = R.trackFront({...a, changedAt: 30000}, {now: 40000, frontId: 'A', fired: FIRE('B', 36000)});
    assert.equal(s.puller, 'B'); assert.equal(s.since, 36000); assert.equal(s.fired, 'arm');
    // The next step without a fire: fired is null again.
    s = R.trackFront(s, {now: 41000, frontId: 'B'});
    assert.equal(s.puller, 'B'); assert.equal(s.fired, null);
});

test('trackFront: the back hold and the skip hold still apply', () => {
    const a = {...R.initialFront(), puller: 'A', since: 0, changedAt: 0};
    // Runs the fire every second from 40 s; returns when B is adopted (ms) and the last state.
    const run = opts => {
        let s = a;
        for (let now = 40000; now <= 80000; now += 1000) {
            s = R.trackFront(s, {now, frontId: 'B', fired: FIRE('B', 36000, !!opts.slow), ...opts.args});
            if (s.puller === 'B') {
                return {at: now, s};
            }
            if (opts.held !== undefined) {
                assert.equal(s.held, opts.held, `held at ${now}`);
                assert.equal(s.candSince, 36000, `candSince at ${now}`);
            }
        }
        return {at: null, s};
    };
    let r = run({args: {backId: 'B'}, held: 'back'});
    assert.equal(r.at, 36000 + R.BACK_HOLD_MS); assert.equal(r.s.since, 36000); assert.equal(r.s.fired, 'arm');
    r = run({slow: true, args: {slowId: 'B'}, held: null});
    assert.equal(r.at, 36000 + R.CHAOS_HOLD_MS); assert.equal(r.s.since, 36000);
    // In chaos both holds are off.
    r = run({slow: true, args: {slowId: 'B', backId: 'B', chaos: true}});
    assert.equal(r.at, 40000); assert.equal(r.s.since, 36000);
});

test('trackFront: a later fire never moves candSince later', () => {
    const a = {...R.initialFront(), puller: 'A', since: 0, changedAt: 0};
    // B in front under the back hold, refired with a later arm.
    let s = R.trackFront(a, {now: 40000, frontId: 'B', backId: 'B', fired: FIRE('B', 36000)});
    assert.equal(s.held, 'back'); assert.equal(s.candSince, 36000);
    s = R.trackFront(s, {now: 46000, frontId: 'B', backId: 'B', fired: FIRE('B', 45000)});
    assert.equal(s.puller, 'A'); assert.equal(s.cand, 'B'); assert.equal(s.candSince, 36000);
    // A frontmost: B is only the candidate just lost (front.lost), refired later.
    s = R.trackFront(a, {now: 40000, frontId: 'A', backId: 'B', fired: FIRE('B', 36000)});
    assert.equal(s.cand, 'B'); assert.equal(s.candSince, 36000);
    s = R.trackFront(s, {now: 46000, frontId: 'A', backId: 'B', fired: FIRE('B', 45000)});
    assert.equal(s.puller, 'A'); assert.equal(s.cand, 'B'); assert.equal(s.candSince, 36000);
    // A position candidate since 38 s, fired with the arm at 36 s: the earlier time wins.
    s = R.trackFront(a, {now: 38000, frontId: 'B', backId: 'B'});
    assert.equal(s.candSince, 38000);
    s = R.trackFront(s, {now: 39000, frontId: 'B', backId: 'B', fired: FIRE('B', 36000)});
    assert.equal(s.cand, 'B'); assert.equal(s.candSince, 36000);
});

test('trackFront: no effect for the puller, the ignored rider, or during my pending start', () => {
    const a = {...R.initialFront(), puller: 'A', since: 0, changedAt: 0};
    let s = R.trackFront(a, {now: 40000, frontId: 'A', fired: FIRE('A', 36000)});
    assert.equal(s.puller, 'A'); assert.equal(s.since, 0); assert.equal(s.cand, null); assert.equal(s.fired, null);
    // After my start the old puller is ignored for SELF_IGNORE_MS.
    const mine = {...R.initialFront(), puller: 'me', since: 30000, changedAt: 0, ignore: {id: 'A', at: 30000}};
    s = R.trackFront(mine, {now: 35000, frontId: 'me', fired: FIRE('A', 33000)});
    assert.equal(s.puller, 'me'); assert.equal(s.cand, null); assert.equal(s.fired, null);
    // My pending start: nobody is adopted, nor a fired rider.
    s = R.trackFront({...a, pending: {id: 'me', at: 39000}}, {now: 40000, frontId: 'A', fired: FIRE('B', 36000)});
    assert.equal(s.puller, 'A'); assert.equal(s.cand, null); assert.equal(s.fired, null);
    assert.deepEqual(s.pending, {id: 'me', at: 39000});
});

// Five riders of plan5(), I am Eve (#5) at the back with 200 W and draft 80. `lead` pulls from 0 at
// 300 W, 10 m ahead of me (9 m from 36 s), and eases off at 30 s (150 W); his draft is 0. `up` comes
// out of the draft (draft 50, then `upDraft` from 33 s) and up beside him: 8 m, 9.8 m at 32, level
// (10 m) at 33, 10.6 m from 34; 300 W. `level`: `lead` stays at 10 m and `up` is level with him (10 m)
// from 33 s, never in front. The other two of #1-#4 sit at 6 and 4 m.
function handRide({lead = 0, up = 1, upDraft = 0, level = false, dur = 80, init, terrain, me = () => ({})} = {}) {
    const p = plan5();
    const rest = [0, 1, 2, 3].filter(i => i !== lead && i !== up);
    return ride(t => {
        const upX = level ? (t < 33 ? 8 : 10) : t < 32 ? 8 : t === 32 ? 9.8 : t === 33 ? 10 : 10.6;
        return {me: {power: 200, draft: 80, ...me(t)},
                others: [{idx: lead, dx: level || t < 36 ? 10 : 9, power: t < 30 ? 300 : 150, draft: 0},
                         {idx: up, dx: upX, power: 300, draft: t < 33 ? 50 : upDraft},
                         {idx: rest[0], dx: 6}, {idx: rest[1], dx: 4}]};
    }, {plan: p, selfIdx: 4, dur, terrain, init: init || (T0 => ({...R.initialRotation(),
        front: {...R.initialFront(), puller: p.riders[lead].id, since: T0}}))});
}

test('rotationStep: the detector takes Ben 3 s sooner, from Ann\'s ease-off', () => {
    // Ann's median of 5 falls below 80 % of her average at 32 (the arm); Ben is out of the draft and
    // level from 33, the second sample at 34 fires.
    const rows = handRide();
    assert.equal(at(rows, 33).puller, 'Ann');
    const r = at(rows, 34);
    assert.equal(r.puller, 'Ben'); assert.equal(r.since, 32);
    assert.equal(r.st.front.fired, 'arm'); assert.equal(r.st.front.adopt, 'front');
    assert.equal(r.st.order.n, 1);
    assert.equal(r.st.hand.lastFire.id, ID5.Ben);
    // Ben still in the draft: the position rule, HOLD_MS from his first step in front (34).
    const ctrl = handRide({upDraft: 50});
    assert.equal(at(ctrl, 36).puller, 'Ann');
    assert.equal(at(ctrl, 37).puller, 'Ben'); assert.equal(at(ctrl, 37).since, 34);
    assert.equal(at(ctrl, 37).st.front.fired, null);
});

test('rotationStep: re-arms do not restart a held back candidate', () => {
    // Ben pulls, Ann (the rider before him) comes past: the back hold runs from the arm (32) and is
    // not moved by the later re-arms.
    const rows = handRide({lead: 1, up: 0});
    for (const s of [34, 61]) {
        assert.equal(at(rows, s).st.front.held, 'back', `held at ${s}`);
        assert.equal(at(rows, s).puller, 'Ben', `puller at ${s}`);
    }
    const r = at(rows, 62);
    assert.equal(r.puller, 'Ann'); assert.equal(r.since, 32);
    assert.deepEqual(r.st.order.hist, [true]);
    assert.equal(r.reason, null);
});

test('rotationStep: a skipping rider waits the skip hold from the arm', () => {
    // Ann pulls, Cleo comes past (skipping Ben): the skip hold runs from the arm (32).
    const rows = handRide({lead: 0, up: 2});
    assert.equal(at(rows, 46).puller, 'Ann');
    const r = at(rows, 47);
    assert.equal(r.puller, 'Cleo'); assert.equal(r.since, 32); assert.equal(r.st.front.fired, 'arm');
});

test('rotationStep: a back rider level with the puller, never frontmost, gives no false flag', () => {
    // Ann is level with Ben from 33 but never in front: only the fires make her the candidate, and
    // between them she is the candidate just lost (front.lost), whose since the next fire keeps.
    const rows = handRide({lead: 1, up: 0, level: true, dur: 120});
    assert.equal(at(rows, 61).puller, 'Ben');
    assert.equal(at(rows, 62).puller, 'Ann'); assert.equal(at(rows, 62).since, 32);
    assert.ok(rows.every(r => !r.st.order.chaos));
    assert.ok(rows.filter(r => r.s >= 33).every(r => r.st.frontId === ID5.Ben));
});

test('rotationStep: the detector is off in chaos, on a roller, while I pull, standing still, after a plan change', () => {
    const p = plan5();
    // In chaos and on a roller: the position rule only (Ben in front from 34, HOLD_MS).
    const chaos = handRide({init: T0 => ({...R.initialRotation(),
        order: {...O.initialOrder(), hist: [true, true], chaos: true, n: 2},
        front: {...R.initialFront(), puller: p.riders[0].id, since: T0}})});
    const roller = handRide({terrain: () => ({hill: {kind: 'climb', roller: true}})});
    for (const rows of [chaos, roller]) {
        assert.equal(at(rows, 36).puller, 'Ann');
        assert.equal(at(rows, 37).puller, 'Ben'); assert.equal(at(rows, 37).since, 34);
        assert.ok(!rows.some(r => r.st.front.fired === 'arm'));
    }
    assert.equal(at(roller, 34).st.hill.mode, 'flag');
    // I pull from 0 and ease off at 30; Ann comes level with draft 0 from 32: no arm while I pull.
    const mine = ride(t => ({me: {power: t < 30 ? 300 : 150, draft: 0},
                             others: [{idx: 0, dx: t < 32 ? -2 : 0.5, draft: t < 32 ? 50 : 0},
                                      {idx: 1, dx: -4}, {idx: 2, dx: -6}, {idx: 3, dx: -8}]}),
                      {plan: p, selfIdx: 4, dur: 60, init: T0 => ({...R.initialRotation(),
                          front: {...R.initialFront(), puller: p.riders[4].id, since: T0}})});
    const pulling = mine.filter((r, i) => i > 0 && mine[i - 1].st.front.puller === ID5.Eve);
    assert.ok(pulling.length >= 30);
    for (const r of pulling) {
        assert.ok(r.st.hand?.arm == null, `arm at ${r.s}`);
        assert.notEqual(r.st.front.fired, 'arm', `fired at ${r.s}`);
    }
    // Standing still (speed 0 from 40 s, still after STOP_MS) drops it.
    const stop = handRide({me: t => (t >= 40 && t < 46 ? {speed: 0} : {})});
    assert.notEqual(at(stop, 39).st.hand, null);
    assert.equal(at(stop, 45).st.still.still, true);
    assert.equal(at(stop, 45).st.hand, null);
    // A plan change drops it.
    const st = at(handRide(), 40).st;
    assert.notEqual(st.hand, null);
    assert.equal(R.carryRotation(st, p).hand, null);
    assert.equal(R.carryRotation(st, null).hand, null);
    assert.equal(R.initialRotation().hand, null);
    assert.equal(R.initialFront().fired, null);
});


// ---------- 21 Nov 2026: a fire counts only for the front rider (final review of beta.5, I-1) ----------

// riders(t) -> five entries {idx, x, power, draft, age?}: positions in metres along the road, all of
// plan5(); mine gives my power and draft. Ann (#1) pulls from 0, `changedAgo` s before 30 s was the
// last change (null: none).
function blockRide(riders, {selfIdx = 4, changedAgo = null, dur = 130} = {}) {
    const p = plan5();
    return ride(t => {
        const all = riders(t);
        const me = all.find(r => r.idx === selfIdx);
        return {me: {power: me.power, draft: me.draft},
                others: all.filter(r => r.idx !== selfIdx).map(r => ({...r, dx: r.x - me.x}))};
    }, {plan: p, selfIdx, dur, init: T0 => ({...R.initialRotation(),
        front: {...R.initialFront(), puller: p.riders[0].id, since: T0,
                changedAt: changedAgo === null ? null : T0 + (30 - changedAgo) * 1000}})});
}
// Ann eases off at 30 s (300 -> 150 W) and drifts back 1 m/s from 33 s. Ben, the plan's next, is in
// front from `benAt` (10.6 m) but never fires: a draft of 20 W (the team sits behind another team),
// or with `benStale` a row 3 s old. `gap` (a rider index) has no draft (a gap to the wheel ahead) and
// is ahead of Ann once she has drifted past him. I am Eve at 0 m, or `selfIdx`.
const annBack = t => (t < 33 ? 10 : Math.max(0.5, 10 - (t - 33)));
function blocked({benAt, gap, benStale = false, selfIdx = 4, changedAgo = null}) {
    const rest = [2, 3, 4].filter(i => i !== selfIdx);
    return blockRide(t => [
        {idx: 0, x: annBack(t), power: t < 30 ? 300 : 150, draft: 0},
        {idx: 1, x: t < benAt ? 8 : 10.6, power: 300, draft: t < benAt ? 50 : benStale ? 0 : 20,
         ...(benStale && t >= benAt ? {age: 3000} : {})},
        ...rest.map((idx, k) => ({idx, x: 6 - 2 * k, power: 250, draft: idx === gap ? 0 : 50})),
        {idx: selfIdx, x: 0, power: 200, draft: 80},
    ], {selfIdx, changedAgo});
}
const outEver = rows => [...new Set(rows.flatMap(r => O.orderOutIds(r.st.order)))];

test('I-1: the next rider in front is not delayed by a fire of a rider behind him', () => {
    // Ben is in front from 36 s (Ann has drifted behind his 8 m), out at 10.6 m from 40 s with 20 W of
    // draft. Cleo (no draft) is ahead of Ann from 37 s and fires; she is never in front. Ben is adopted
    // after HOLD_MS as without the detector (before the guard: Ann until 106 s).
    const rows = blocked({benAt: 40, gap: 2});
    assert.equal(at(rows, 38).puller, 'Ann');
    assert.equal(at(rows, 39).puller, 'Ben'); assert.equal(at(rows, 39).since, 36);
    assert.ok(rows.filter(r => r.s >= 39).every(r => r.puller === 'Ben'));
    assert.ok(rows.every(r => !r.st.order.chaos));
    assert.deepEqual(outEver(rows), []);
});

test('I-1: within CHAOS_WINDOW_MS of a change no rider who is not in front becomes the puller', () => {
    // Ben in front from 33 s, 10 s after the last change: the chaos hold, Ben from 48 s with since 33.
    // A rider behind him without draft fires meanwhile: Cleo or Dan (a skip), or Eve, the rider before
    // Ann (a back case; I am Dan there). Before the guard each of them was the puller for 15 s or more
    // without ever being in front, and Ben or Ann sat out.
    for (const v of [{gap: 2}, {gap: 2, benStale: true}, {gap: 3}, {gap: 4, selfIdx: 3}]) {
        const rows = blocked({benAt: 33, changedAgo: 10, ...v});
        const label = JSON.stringify(v);
        assert.ok(rows.filter(r => r.s <= 47).every(r => r.puller === 'Ann'), `Ann until 47 s ${label}`);
        assert.ok(rows.filter(r => r.s >= 48).every(r => r.puller === 'Ben' && r.since === 33), `Ben from 48 s ${label}`);
        assert.deepEqual(rows.at(-1).st.order.hist, [false], label);
        assert.deepEqual(outEver(rows), [], label);
    }
});

test('I-1: no rest countdown while I pull as the plan\'s next', () => {
    // I am Ben (#2) at 8 m. Ann eases off at 30 s and drifts back 1.2 m/s from 33 s; I am in front from
    // 35 s, with 20 W of draft and no power jump (only the position rule takes me). Cleo behind me has
    // no draft from 36 s and is ahead of Ann from 38 s. Without a recent change I pull from 38 s; within
    // CHAOS_WINDOW_MS of one from 50 s (before the guard: Ann until 106 s; Cleo 47-77 s).
    const annX = t => (t < 33 ? 10 : Math.max(-9, 10 - 1.2 * (t - 33)));
    for (const [changedAgo, from] of [[null, 38], [10, 50]]) {
        const rows = blockRide(t => [
            {idx: 0, x: annX(t), power: t < 30 ? 300 : 150, draft: annX(t) > 8 ? 0 : 40},
            {idx: 1, x: 8, power: 250, draft: annX(t) > 8 ? 60 : 20},
            {idx: 2, x: 6, power: 250, draft: t >= 36 ? 0 : 50},
            {idx: 3, x: 4, power: 250, draft: 50},
            {idx: 4, x: 2, power: 250, draft: 50},
        ], {selfIdx: 1, changedAgo, dur: 120});
        assert.equal(at(rows, from - 1).puller, 'Ann', `Ann until ${from - 1} s`);
        for (const r of rows.filter(x => x.s >= from)) {
            assert.equal(r.puller, 'Ben', `I pull at ${r.s} (change ${changedAgo})`);
            assert.equal(r.since, 35);
            assert.equal(r.view, 'pull', `my pull view at ${r.s}`);
        }
        assert.ok(rows.every(r => r.puller !== 'Cleo'));
    }
});


// ---------- 21 Nov 2026: the detector's off-switches in rotationStep (final review of beta.5, M-5) ----------

test('rotationStep: no fire in finish mode', () => {
    // The last 400 m of an event: the position rule only (Ben in front from 34, HOLD_MS).
    const rows = handRide({me: () => ({top: {remainingType: 'event', remainingMetric: 'distance', remaining: 400}})});
    assert.equal(at(rows, 34).st.finish, true);
    assert.equal(at(rows, 36).puller, 'Ann');
    assert.equal(at(rows, 37).puller, 'Ben'); assert.equal(at(rows, 37).since, 34);
    assert.ok(rows.every(r => r.st.front.fired !== 'arm' && r.st.hand?.arm == null));
});

test('rotationStep: no fire while my row is not live', () => {
    // My row is 16 s old from 31 to 34 s (no live data of mine: the chain is empty, no tracking).
    // Ann's arm is not set meanwhile, so the arm that fires for Ben is the one after (36 s), and
    // Ben keeps the since of his first step in front (35 s), not Ann's ease-off (32 s).
    const rows = handRide({me: t => (t >= 31 && t <= 34 ? {age: 16000} : {})});
    assert.ok(rows.filter(r => r.s >= 31 && r.s <= 34).every(r => r.st.hand?.arm == null), 'no arm while not live');
    assert.equal(at(rows, 35).puller, 'Ann');
    const r = at(rows, 36);
    assert.equal(r.puller, 'Ben'); assert.equal(r.since, 35); assert.equal(r.st.front.fired, 'arm');
});

test('rotationStep: no fire while the puller is unseen after riding alone', () => {
    // Ann pulls from 0 (last change at 20 s); I ride alone from 20 to 29 s. From 30 s Ben is in front
    // of Ann (0.6 m, draft 0), who has eased off; Ann is never in front again, so she stays unseen
    // and the detector stays off. Ben is adopted after the chaos hold from his first step in front.
    const p = plan5();
    const rows = ride(t => (t >= 20 && t < 30 ? {me: {power: 200, draft: 0}, others: []} :
        {me: {power: 200, draft: 80},
         others: [{idx: 0, dx: 10, power: t < 30 ? 300 : 150, draft: 0},
                  {idx: 1, dx: t < 30 ? 8 : 10.6, power: 300, draft: t < 30 ? 50 : 0},
                  {idx: 2, dx: 6}, {idx: 3, dx: 4}]}),
    {plan: p, selfIdx: 4, dur: 60, init: T0 => ({...R.initialRotation(),
        front: {...R.initialFront(), puller: p.riders[0].id, since: T0, changedAt: T0 + 20000}})});
    assert.equal(at(rows, 25).st.alone, true);
    assert.equal(at(rows, 33).st.unseen, 'alone');
    assert.ok(rows.every(r => r.st.front.fired !== 'arm'));
    assert.equal(at(rows, 45).puller, 'Ann');
    assert.equal(at(rows, 46).puller, 'Ben'); assert.equal(at(rows, 46).since, 31);
});

test('rotationStep: no fire for a joiner', () => {
    // Ann eases off at 30 s (the arm at 32). Ben, the plan's next, not seen before, joins at 33 s
    // 12 m ahead of me, frontmost and out of the draft: he is being caught (joinerStep) and is
    // neither adopted nor fired, nor a candidate, while he is the joiner.
    const p = plan5();
    const rows = ride(t => ({me: {power: 200, draft: 80},
        others: [{idx: 0, dx: 10, power: t < 30 ? 300 : 150, draft: 0}, {idx: 2, dx: 8}, {idx: 3, dx: 6},
                 ...(t >= 33 ? [{idx: 1, dx: 12, power: 300, draft: 0}] : [])]}),
    {plan: p, selfIdx: 4, dur: 50, init: T0 => ({...R.initialRotation(),
        front: {...R.initialFront(), puller: p.riders[0].id, since: T0}})});
    assert.equal(at(rows, 33).st.joiner?.id, ID5.Ben);
    assert.notEqual(at(rows, 34).st.hand?.arm ?? null, null, 'Ann is armed');
    const joined = rows.filter(x => x.st.joiner);
    assert.ok(joined.length >= 15);
    for (const r of joined) {
        assert.equal(r.puller, 'Ann', `Ann at ${r.s}`);
        assert.equal(r.st.front.cand, null, `no candidate at ${r.s}`);
        assert.notEqual(r.st.front.fired, 'arm', `no fire at ${r.s}`);
    }
});

test('rotationStep: a roller drops the arm and the runs, the puller\'s history stays', () => {
    // A roller at 34 s only: Ann armed at 32 s and Ben has been out of the draft and level since
    // 33 s. The roller drops both, so the arm (35 s) and Ben's run start again: the fire comes at
    // 36 s and dates Ben from his first step in front (34 s), not from the dropped arm (32 s).
    const rows = handRide({terrain: t => (t === 34 ? {hill: {kind: 'climb', roller: true}} : {hill: null})});
    assert.notEqual(at(rows, 33).st.hand.arm, null);
    assert.equal(at(rows, 33).st.hand.out[ID5.Ben].n, 1);
    const roller = at(rows, 34).st.hand;
    assert.equal(roller.arm, null); assert.deepEqual(roller.out, {});
    assert.equal(roller.puller, ID5.Ann); assert.equal(roller.w.length, 5);
    assert.ok(roller.n > 0);
    assert.equal(at(rows, 35).puller, 'Ann');
    const r = at(rows, 36);
    assert.equal(r.puller, 'Ben'); assert.equal(r.since, 34); assert.equal(r.st.front.fired, 'arm');
});


// ---------- 21 Nov 2026: what rotationStep feeds the learner (final review of beta.5, M-5) ----------

// A clean rotating line of plan5() (30 s plans), real turns `turnS` long (default 36 s): the head
// pulls at 300 W, 2 m apart, the others at 200 W with a draft of 50 W. 1 s before each change the
// head eases off to 150 W; after it he drifts back 1.2 m/s to the tail (150 W, draft 20 W until he
// is there), and the new head is frontmost (300 W, draft 0) once the old one is behind him. I am Eve
// (#5). `me(t)` adds fields to my entry; with `alone(t)` nobody else is in my list.
function turnRide({turnS = 36, dur = 600, init, terrain, me = () => ({}), alone = () => false} = {}) {
    const p = plan5();
    const n = 5, selfIdx = 4;
    const changes = Array.from({length: Math.ceil((dur + 100) / turnS)}, (_, k) => turnS * (k + 1));
    const pos = t => {
        const j = changes.filter(c => c <= t).length;
        const q = Array.from({length: n}, (_, k) => (j + k) % n);
        const head = -2 * j;
        const x = {}, draft = {}, power = {};
        q.forEach((r, k) => {
            x[r] = head - 2 * k; draft[r] = k === 0 ? 0 : 50; power[r] = k === 0 ? 300 : 200;
        });
        if (changes[j] - t <= 1) {
            power[q[0]] = 150;
        }
        if (j > 0) {
            const old = q[n - 1];
            const end = head - 2 * (n - 1);
            x[old] = Math.max(end, head + 2 - 1.2 * (t - changes[j - 1]));
            power[old] = 150;
            draft[old] = x[old] > end ? 20 : 50;
            if (x[old] >= head) {
                draft[q[0]] = 50; power[q[0]] = 300;
            }
        }
        return {x, draft, power};
    };
    return ride(t => {
        const s = pos(t);
        return {me: {power: s.power[selfIdx], draft: s.draft[selfIdx], ...me(t)},
                others: alone(t) ? [] :
                    [0, 1, 2, 3].map(idx => ({idx, dx: s.x[idx] - s.x[selfIdx], power: s.power[idx], draft: s.draft[idx]}))};
    }, {plan: p, selfIdx, dur, terrain, init: init || (T0 => ({...R.initialRotation(),
        front: {...R.initialFront(), puller: p.riders[0].id, since: T0}}))});
}
// The steps at which E was fed: [s, E, H or null].
const fedAt = rows => rows.slice(1).flatMap((r, i) => r.st.eff.e !== rows[i].st.eff.e ?
    [[r.s, r.st.eff.e.at(-1), r.st.eff.h !== rows[i].st.eff.h ? r.st.eff.h.at(-1) : null]] : []);

const CHAOS0 = T0 => ({...R.initialRotation(), order: {...O.initialOrder(), hist: [true, true], chaos: true, n: 2},
                       front: {...R.initialFront(), puller: plan5().riders[0].id, since: T0}});

test('rotationStep: the learner learns 6 s per turn on a clean line, H only from the others', () => {
    // The reference for the tests below: every turn is fed (E = 36 - 30 s) from the third change
    // (the first two have no predecessor in the line); H (the engine's lateness, 1-2 s) except at
    // my own adoption (146, 326 and 506 s: my start is power-dated too; decision 2).
    const fed = fedAt(turnRide());
    assert.deepEqual(fed.map(f => f[0]), [75, 111, 146, 185, 219, 255, 291, 326, 365, 399, 435, 471, 506, 545, 579]);
    assert.ok(fed.every(([, e]) => Math.abs(e - 6) < 0.01));
    assert.deepEqual(fed.filter(([, , h]) => h === null).map(f => f[0]), [146, 326, 506]);
    assert.ok(fed.filter(([, , h]) => h !== null).every(([, , h]) => h >= 1 && h <= 2));
});

test('rotationStep: the learner is not fed in chaos', () => {
    // Chaos from the start until the good change at 113 s: every turn open meanwhile is bad, nothing
    // is fed; the first turn after chaos (since 110 s) closes at 146 s against a bad one and is not
    // fed either. From 185 s as in the reference.
    const rows = turnRide({init: CHAOS0});
    const inChaos = rows.filter(r => r.st.order.chaos);
    assert.equal(inChaos.at(-1).s, 112);
    assert.ok(inChaos.every(r => r.st.eff.seg?.bad === true), 'the open turn is bad');
    assert.deepEqual(at(rows, 184).st.eff.e, []);
    assert.deepEqual(at(rows, 184).st.eff.h, []);
    assert.equal(fedAt(rows)[0][0], 185);
});

test('rotationStep: the learner is not fed from a turn that touches a climb', () => {
    // A climb (pause) from 200 to 214 s: the turns open then and the one after them are not fed
    // (reference: fed at 219 and 255 s).
    const rows = turnRide({terrain: t => (t >= 200 && t < 215 ? {hill: {kind: 'climb', roller: false}} : {hill: null})});
    assert.ok(rows.filter(r => r.s >= 200 && r.s < 215).every(r => r.st.eff.seg?.bad === true));
    const fed = fedAt(rows).map(f => f[0]);
    assert.deepEqual(fed.filter(s => s >= 190 && s < 300), [291]);
    assert.equal(at(rows, 290).st.eff.e.length, at(rows, 199).st.eff.e.length);
});

test('rotationStep: the learner is not fed in finish mode', () => {
    const rows = turnRide({me: t => (t >= 300 ? {top: {remainingType: 'event', remainingMetric: 'distance', remaining: 400}} : {})});
    assert.equal(at(rows, 300).st.finish, true);
    assert.ok(rows.filter(r => r.s >= 300).every(r => r.st.eff.seg?.bad === true));
    assert.deepEqual(fedAt(rows).map(f => f[0]), [75, 111, 146, 185, 219, 255, 291]);
});

test('rotationStep: the learner is not fed from a turn with steps alone or without live data', () => {
    // From 200 to 209 s I ride alone (nobody in my list), or my row is 16 s old: the turn open then
    // is bad, and it and the one after it are not fed (reference: fed at 219 and 255 s).
    const alone = t => t >= 200 && t < 210;
    const rideAlone = turnRide({dur: 400, alone});
    const stale = turnRide({dur: 400, me: t => (alone(t) ? {age: 16000} : {})});
    for (const [label, rows] of [['alone', rideAlone], ['not live', stale]]) {
        assert.ok(rows.filter(r => alone(r.s)).every(r => r.st.eff.seg?.bad === true), label);
        assert.deepEqual(fedAt(rows).map(f => f[0]).filter(s => s >= 190 && s < 300), [291], label);
    }
    assert.equal(at(rideAlone, 205).st.alone, true);
});

test('rotationStep: the start puller\'s bonus pull and the first 120 s after the roll-off are not fed', () => {
    // 40 s in the pen (speed 0), the roll-off at 40 s: Ann pulls with the start bonus, and no turn
    // that began before 160 s is fed (the first fed turn began at about 182 s and closes at 219 s).
    const rows = turnRide({init: () => R.initialRotation(), me: t => (t < 40 ? {speed: 0} : {})});
    assert.equal(at(rows, 40).st.rolledAt, at(rows, 40).now);
    const seg = at(rows, 45).st.eff.seg;
    assert.equal(at(rows, 45).puller, 'Ann');
    assert.equal(seg.bonus, true); assert.equal(seg.since, at(rows, 40).now);
    const after = rows.find(r => r.s > 45 && r.puller !== 'Ann');
    assert.ok(after && after.s < 160);
    assert.equal(after.st.eff.seg.bonus, false, 'only the start puller\'s first pull');
    // The start lock is bad too (it ends long before 160 s, so only the open turn shows it).
    const lock = rows.filter(r => r.st.locked);
    assert.ok(lock.length >= 10);
    assert.ok(lock.every(r => r.st.eff.seg?.bad === true), 'the open turn is bad in the lock');
    assert.deepEqual(at(rows, 218).st.eff.e, []);
    assert.equal(fedAt(rows)[0][0], 219);
});


// ---------- 23 Nov 2026: sensor helpers exported for the turn clocks (plan C, task 2) ----------

test('teamChain: gapM sets the link', () => {
    // Riders 25 m apart: one chain with a 30 m link, two with the default 20 m.
    const pos = [{id: 'a', x: 25}, {id: 'me', x: 0, self: true}];
    assert.deepEqual(R.teamChain(pos, 'me', 30).map(x => x.id), ['a', 'me']);
    assert.deepEqual(R.teamChain(pos, 'me').map(x => x.id), ['me']);
    assert.deepEqual(R.teamChain(pos, 'me', R.CHAIN_GAP_M).map(x => x.id), ['me']);
    const back = [{id: 'me', x: 0, self: true}, {id: 'b', x: -25}];
    assert.deepEqual(R.teamChain(back, 'me', 30).map(x => x.id), ['me', 'b']);
    assert.deepEqual(R.teamChain(back, 'me').map(x => x.id), ['me']);
});

test('presence: graceMs', () => {
    // B was last seen 25 s ago: present with a 30 s grace, gone with the default 20 s.
    const seen = {B: 0};
    assert.deepEqual(R.presence(seen, {now: 25000, chainIds: ['A'], graceMs: 30000}).ids.sort(), ['A', 'B']);
    assert.deepEqual(R.presence(seen, {now: 25000, chainIds: ['A']}).ids, ['A']);
    // The edge of the explicit grace: strictly less than graceMs counts.
    assert.deepEqual(R.presence(seen, {now: 29999, chainIds: [], graceMs: 30000}).ids, ['B']);
    assert.deepEqual(R.presence(seen, {now: 30000, chainIds: [], graceMs: 30000}).ids, []);
});

test('startStep: a roll-off after 30 s in the pen sets plan #1 and the lock; a 30 s stand ends the start, not after the finish line', () => {
    const plan = plan5();
    const T = 1.7e12;
    const everyone = Object.values(ID5);
    const base = {live: true, plan, selfId: ID5.Cleo, present: everyone, entry: null};
    const calm = {rolledAt: null, startAt: null, locked: false, finish: false, over: false};
    // Roll-off: standing since T - 30 s (START_PEN_MS), moving again at T. Ann (#1) has the start.
    const pen = {...calm, still: {still: true, since: T - R.START_PEN_MS}};
    const go = R.startStep(pen, {...base, now: T, still: {still: false, since: null}});
    assert.deepEqual(go, {rolledAt: T, over: false, startAt: T, locked: true, unlocked: false, starting: true, p1: ID5.Ann});
    // One second short of the pen time: a plain roll-off, no start.
    const shortPen = R.startStep({...calm, still: {still: true, since: T - R.START_PEN_MS + 1000}},
                                 {...base, now: T, still: {still: false, since: null}});
    assert.deepEqual(shortPen, {rolledAt: T, over: false, startAt: null, locked: false, unlocked: false, starting: false, p1: null});
    // No plan rider known but me: a roll-off without a start.
    const alone = R.startStep(pen, {...base, now: T, still: {still: false, since: null}, present: [ID5.Cleo]});
    assert.equal(alone.starting, false); assert.equal(alone.p1, null); assert.equal(alone.startAt, null);
    // The lock ends START_LOCK_MS after the start: `unlocked` once, and prev.startAt is kept.
    const riding = {...calm, still: {still: false, since: null}, startAt: T - R.START_LOCK_MS + 1000, locked: true, rolledAt: T - 59000};
    const stillLocked = R.startStep(riding, {...base, now: T, still: {still: false, since: null}});
    assert.equal(stillLocked.locked, true); assert.equal(stillLocked.unlocked, false);
    assert.equal(stillLocked.startAt, riding.startAt); assert.equal(stillLocked.rolledAt, riding.rolledAt);
    const ended = R.startStep(riding, {...base, now: T + 1000, still: {still: false, since: null}});
    assert.equal(ended.locked, false); assert.equal(ended.unlocked, true);
    assert.equal(ended.startAt, riding.startAt);
    // M8: standing 30 s ends the last start.
    const stand = {...calm, startAt: T - 100000, still: {still: true, since: T - R.START_PEN_MS}};
    const stood = {still: true, since: T - R.START_PEN_MS};
    assert.equal(R.startStep(stand, {...base, now: T, still: stood}).startAt, null);
    assert.equal(R.startStep(stand, {...base, now: T - 1000, still: {still: true, since: T - R.START_PEN_MS}}).startAt, stand.startAt,
                 'before the 30 s are over the start is kept');
    // M-4: not after the finish line. prev.finish (finish mode) keeps the start while I stand ...
    const afterLine = {...stand, finish: true};
    const kept = R.startStep(afterLine, {...base, now: T, still: stood});
    assert.equal(kept.over, true); assert.equal(kept.startAt, stand.startAt);
    // ... also in later steps, when finish is off but `over` carries it on.
    const later = R.startStep({...stand, finish: false, over: true}, {...base, now: T + 5000, still: stood});
    assert.equal(later.over, true); assert.equal(later.startAt, stand.startAt);
    // ... until Sauce shows another event (the next race's pen): a fresh start at once.
    const next = {remainingType: 'event', remainingMetric: 'distance', remaining: 40000};
    const fresh = R.startStep(afterLine, {...base, now: T, still: stood, entry: next});
    assert.equal(fresh.over, false); assert.equal(fresh.startAt, null);
    // Riding on (not standing) clears `over`.
    const rode = R.startStep({...stand, over: true}, {...base, now: T, still: {still: false, since: null}});
    assert.equal(rode.over, false);
    // Without live data nothing rolls off and no event counts as another.
    const dark = R.startStep(pen, {...base, live: false, now: T, still: {still: false, since: null}});
    assert.equal(dark.rolledAt, null); assert.equal(dark.starting, false);
});

test('startStep: rotationStep takes rolledAt, over, startAt and locked from it', () => {
    // The pen of the M8 ride and its roll-off at 60: the state carries what startStep returns.
    const rows = penRun(go => [{idx: 1, dx: go ? 10 : 3}, {idx: 3, dx: go ? 6 : 2}, {idx: 4, dx: go ? 4 : 1}]);
    const r = at(rows, 60), before = at(rows, 59);
    assert.equal(r.st.rolledAt, r.now); assert.equal(r.st.startAt, r.now);
    assert.equal(r.st.locked, true); assert.equal(r.st.over, false);
    const s = R.startStep(before.st, {now: r.now, live: true, still: {still: false, since: null}, present: r.st.present,
                                      plan: plan5(), selfId: ID5.Cleo, entry: null});
    assert.deepEqual([s.rolledAt, s.over, s.startAt, s.locked], [r.st.rolledAt, r.st.over, r.st.startAt, r.st.locked]);
    assert.equal(s.p1, ID5.Ben);
});

test('startGate: due when the puller has 10 s left, gone when I am first in my chain, else null', () => {
    const view = {mine: false, next: {id: 'me'}, remainingS: 8, puller: {id: 'p'}};
    assert.equal(R.startGate(view, {chainIds: ['p', 'me'], selfId: 'me'}), 'due');
    assert.equal(R.startGate({...view, remainingS: 30}, {chainIds: ['p', 'me'], selfId: 'me'}), null);
    assert.equal(R.startGate({...view, remainingS: 30}, {chainIds: ['me', 'x'], selfId: 'me'}), 'gone');
    assert.equal(R.startGate({...view, next: {id: 'x'}}, {chainIds: ['p', 'me'], selfId: 'me'}), null);
    assert.equal(R.startGate({...view, mine: true}, {chainIds: ['p', 'me'], selfId: 'me'}), null);
    assert.equal(R.startGate(null, {chainIds: [], selfId: 'me'}), null);
});

test('shadowDet: the old core\'s puller, chaos, riders out and countdown', () => {
    // I am Cleo (#3); Ann (#1) has pulled since T0 with Ben, Dan and Eve ahead of me in plan order.
    const plan = plan5();
    const rows = ride(() => ({me: {power: 200, draft: 80}, others: [{idx: 0, dx: 10}, {idx: 1, dx: 6}, {idx: 3, dx: -2}, {idx: 4, dx: -4}]}),
                      {plan, selfIdx: 2, dur: 20,
                       init: T0 => ({...R.initialRotation(), front: {...R.initialFront(), puller: ID5.Ann, since: T0}})});
    const r = at(rows, 10);
    const d = R.shadowDet(r.st, {now: r.now, plan, selfId: ID5.Cleo, live: true});
    assert.deepEqual(Object.keys(d).sort(), ['cd', 'chaos', 'frontId', 'out', 'puller', 'reason', 'since']);
    assert.equal(d.puller, ID5.Ann);
    assert.equal(d.since, r.st.front.since);
    assert.equal(d.frontId, ID5.Ann);
    assert.equal(d.reason, null);
    assert.equal(d.chaos, false);
    assert.deepEqual(d.out, []);
    // The countdown: one decimal of the view's toMyPullS, and whether it stands.
    const view = R.rotationStatus(r.st, {now: r.now, plan, selfId: ID5.Cleo, live: true}).view;
    assert.ok(Number.isFinite(view.toMyPullS) && !view.mine);
    assert.deepEqual(d.cd, {t: Math.round(view.toMyPullS * 10) / 10, standing: !!view.standing});
    assert.ok(Math.abs(d.cd.t * 10 - Math.round(d.cd.t * 10)) < 1e-9);
    // Chaos and riders sitting out are read from the order; the reason becomes 'chaos' (the view stays).
    const messy = {...r.st, order: {...r.st.order, chaos: true, out: {[ID5.Ben]: r.now}}};
    const m = R.shadowDet(messy, {now: r.now, plan, selfId: ID5.Cleo, live: true});
    assert.equal(m.chaos, true); assert.deepEqual(m.out, [ID5.Ben]); assert.equal(m.reason, 'chaos');
    assert.equal(m.puller, ID5.Ann);
    // The quiet start is not part of it: right after a roll-off the reason is still not 'start'.
    const rolled = {...r.st, rolledAt: r.now - 1000};
    assert.notEqual(R.shadowDet(rolled, {now: r.now, plan, selfId: ID5.Cleo, live: true}).reason, 'start');
    // No live sample of mine: the reason says so and there is no countdown.
    const dark = R.shadowDet(r.st, {now: r.now, plan, selfId: ID5.Cleo, live: false});
    assert.notEqual(dark.reason, null); assert.equal(dark.cd, null);
    // My own pull (a view that is mine) has no countdown either.
    const mine = {...r.st, front: {...r.st.front, puller: ID5.Cleo}};
    const my = R.shadowDet(mine, {now: r.now, plan, selfId: ID5.Cleo, live: true});
    assert.equal(my.puller, ID5.Cleo); assert.equal(my.cd, null);
});
