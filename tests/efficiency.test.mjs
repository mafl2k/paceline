// Run with: node --test tests/efficiency.test.mjs
// The team-efficiency learner (design 2026-11-21-paceline-beta5 §2): E (turn time T0 to T0 minus the
// plan) and H (ease-off to the next puller's adopted since). All rows are 1 Hz steps (now = t * 1000).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../pages/src/engine/efficiency.mjs';

const NEXT = {a: 'b', b: 'c', c: 'a'};

// Steps 1 Hz through turns [{id, since}] (since in s; the last turn's since is the last step unless
// `upto` ends it earlier). Plan 30 s, the expected next puller is cyclic a > b > c > a. Each puller
// rides 300 W until 4 s before the next since and 100 W from then on (so T0 is next since - 3 s).
// Default turns a 200, b 240, c 280, a 320 give T0s 237, 277, 317.
// Options: bad(t, k), bonus(k), noPower(k), planS (all turns), rolledAt, selfId, upto (s).
function drive(turns = [{id: 'a', since: 200}, {id: 'b', since: 240}, {id: 'c', since: 280}, {id: 'a', since: 320}], {
    rolledAt = 0, selfId = 'z', planS = 30, bad = () => false, bonus = () => false, noPower = () => false,
    upto = null,
} = {}) {
    let eff = E.initialEff();
    const end = upto ?? turns[turns.length - 1].since;
    for (let t = turns[0].since; t <= end; t++) {
        let k = 0;
        while (k + 1 < turns.length && turns[k + 1].since <= t) k++;
        const nextSince = k + 1 < turns.length ? turns[k + 1].since : Infinity;
        const power = noPower(k) ? null : (t < nextSince - 4 ? 300 : 100);
        eff = E.effStep(eff, {
            now: t * 1000, puller: turns[k].id, since: turns[k].since * 1000, planS, bonus: bonus(k),
            power, bad: bad(t, k), nextId: NEXT[turns[k].id], rolledAt, selfId,
        });
    }
    return eff;
}

// 1 Hz samples from 0 to 40 s: w(t).
const samples = w => Array.from({length: 41}, (_, t) => [t * 1000, w(t)]);

test('constants: the design values', () => {
    assert.equal(E.EFF_N, 12);
    assert.equal(E.EFF_PRIOR_K, 2);
    assert.equal(E.EFF_MIN_S, -5);
    assert.equal(E.EFF_MAX_S, 25);
    assert.equal(E.EFF_H_PRIOR_S, 5);
    assert.equal(E.EFF_H_MIN_S, 0);
    assert.equal(E.EFF_H_MAX_S, 10);
    assert.equal(E.EFF_LEARN_AFTER_MS, 120000);
    assert.equal(E.EASE_FRAC, 0.85);
    assert.equal(E.EASE_AVG_FROM_MS, 5000);
    assert.equal(E.EASE_MIN_N, 5);
    assert.equal(E.EFF_PW_MAX, 900);
    assert.equal(E.EFF_CLIP_S, 10);
    assert.equal(E.EFF_MIN_N, 3);
    assert.equal(E.EFF_PRIOR_BAND_S, 10);
});

test('easeOffAt: the last step at 85 % plus 1 s', () => {
    const w = t => t < 30 ? 300 : 100;
    assert.equal(E.easeOffAt(samples(w), {from: 0, to: 40000}), 31000);
    // The first 5 s (the swap's effort) do not count towards the average.
    assert.equal(E.easeOffAt(samples(t => t < 5 ? 1000 : w(t)), {from: 0, to: 40000}), 31000);
    // Even 3000 W in the first 5 s must not lift the average past what 300 W clears (the mutant that
    // counts them gives 6000 here).
    assert.equal(E.easeOffAt(samples(t => t < 5 ? 3000 : w(t)), {from: 0, to: 40000}), 31000);
    // Never eases off: the end of the window plus 1 s, capped by `cap`.
    assert.equal(E.easeOffAt(samples(() => 300), {from: 0, to: 40000}), 41000);
    assert.equal(E.easeOffAt(samples(() => 300), {from: 0, to: 40000, cap: 40500}), 40500);
    // Samples after `to` count neither towards the average nor as a step.
    assert.equal(E.easeOffAt(samples(t => t < 30 ? 300 : t <= 35 ? 100 : 9000), {from: 0, to: 35000}), 31000);
    // Fewer than 5 samples in the average: no answer.
    const few = [5, 6, 7, 8].map(t => [t * 1000, 300]);
    assert.equal(E.easeOffAt(few, {from: 0, to: 40000}), null);
    // Missing power rows (null) are skipped, and a median needs at least 2 values.
    assert.equal(E.easeOffAt(samples(() => null), {from: 0, to: 40000}), null);
});

test('easeOffAt: a step needs the median of 3, not one spike', () => {
    // One 300 W spike inside the drop is a median of 100: not a step at 85 %.
    const w = t => t < 30 ? 300 : t === 34 ? 300 : 100;
    assert.equal(E.easeOffAt(samples(w), {from: 0, to: 40000}), 31000);
});

test('turnFits: 0.5 x plan below to plan + 30 s above', () => {
    assert.equal(E.turnFits(-15, 30), true);
    assert.equal(E.turnFits(-15.1, 30), false);
    assert.equal(E.turnFits(60, 30), true);
    assert.equal(E.turnFits(60.1, 30), false);
});

test('teamE / teamH: prior, mix, clamp', () => {
    assert.equal(E.teamE(E.initialEff(), 10), 10);
    assert.equal(E.teamE(E.initialEff(), 5), 5);
    assert.equal(E.teamH(E.initialEff()), 5);
    // Fewer than 3 values: the prior (beta.5 addendum: robust start).
    assert.equal(E.teamE({e: [2, 2]}, 10), 10);
    assert.equal(E.teamE({e: [2, 2]}, 5), 5);
    assert.equal(E.teamH({h: [1, 1]}), 3);
    // The lower of the two middle values (0), mixed with the prior at weight 2: 20 / 14.
    const v = E.teamE({e: [0, 0, 0, 0, 0, 0, 10, 10, 10, 10, 10, 10]}, 10);
    assert.ok(Math.abs(v - 20 / 14) < 1e-9, String(v));
    // Twelve values at the ends: the prior band (prior 10: 0...20, prior 5: -5...15) clamps the mix.
    assert.equal(E.teamE({e: Array(12).fill(25)}, 10), 20);
    assert.equal(E.teamE({e: Array(12).fill(-50)}, 10), 0);
    assert.equal(E.teamE({e: Array(12).fill(-50)}, 5), -5);
    assert.equal(E.teamH({h: [30, 30]}), 10);
    assert.equal(E.teamH({h: [-20, -20]}), 0);
});

test('teamE: the prior until 3 values', () => {
    assert.equal(E.teamE({e: [2]}, 10), 10);
    assert.equal(E.teamE({e: [2, 2]}, 10), 10);
    assert.equal(E.teamE({e: [2, 2]}, 5), 5);
    // 3 values: (3 * 2 + 2 * 10) / 5.
    assert.ok(Math.abs(E.teamE({e: [2, 2, 2]}, 10) - 5.2) < 1e-9);
});

test('teamE: within the prior +- 10 s', () => {
    // Twelve -10, prior 10: mix (-120 + 20) / 14 = -7.14, clamped up to 0.
    assert.equal(E.teamE({e: Array(12).fill(-10)}, 10), 0);
    // Prior 5: mix (-120 + 10) / 14 = -7.86, clamped to -5 (= prior - 10 = EFF_MIN_S).
    assert.equal(E.teamE({e: Array(12).fill(-10)}, 5), -5);
    // Twelve +10, prior 5: mix 130 / 14 = 9.2857, inside -5...15, unchanged.
    assert.ok(Math.abs(E.teamE({e: Array(12).fill(10)}, 5) - 130 / 14) < 1e-9);
    // Twelve +10, prior 10: mix 140 / 14 = 10, inside 0...20.
    assert.equal(E.teamE({e: Array(12).fill(10)}, 10), 10);
});

test('effStep: a turn\'s value is clipped to +-10 s', () => {
    // Turn b (since 240) is the first fed one: a 200, b 240, c 280. Plan 30; a turn 25 s over plan
    // (T0 to T0 55 s, length 55 s, both inside turnFits) is stored as 10; 12 s under plan as -10.
    const over = drive([{id: 'a', since: 200}, {id: 'b', since: 240}, {id: 'c', since: 295}, {id: 'a', since: 335}]);
    assert.ok(over.e.length >= 1 && over.e.some(x => x === 10), JSON.stringify(over.e));
    assert.ok(over.e.every(x => Math.abs(x) <= 10), JSON.stringify(over.e));
    assert.deepEqual(over.e.slice(0, 1), [10]);
    const under = drive([{id: 'a', since: 200}, {id: 'b', since: 240}, {id: 'c', since: 258}, {id: 'a', since: 298}]);
    assert.deepEqual(under.e.slice(0, 1), [-10]);
});

test('initialEff / effCut', () => {
    assert.deepEqual(E.initialEff(), {seg: null, last: null, e: [], h: []});
    assert.deepEqual(E.effCut(null), {seg: null, last: null, e: [], h: []});
});

test('effStep: a normal turn feeds E (T0 to T0 minus plan) and H (ease-off to the next since)', () => {
    const eff = drive();
    assert.deepEqual(eff.e, [10, 10]);
    assert.deepEqual(eff.h, [3, 3]);
    assert.equal(E.teamH(eff), 4);
    assert.equal(E.teamE(eff, 10), 10);
});

test('effStep: never mutates the previous state', () => {
    const a = drive(undefined, {upto: 281});
    const frozen = JSON.stringify(a);
    E.effStep(a, {
        now: 282000, puller: 'c', since: 280000, planS: 30, bonus: false, power: 300, bad: false,
        nextId: 'a', rolledAt: 0, selfId: 'z',
    });
    E.effStep(a, {
        now: 282000, puller: 'a', since: 282000, planS: 30, bonus: false, power: 300, bad: false,
        nextId: 'b', rolledAt: 0, selfId: 'z',
    });
    assert.equal(JSON.stringify(a), frozen);
});

test('effStep: no puller closes the open turn without a trace', () => {
    const eff = drive(undefined, {upto: 250});
    const out = E.effStep(eff, {now: 251000, puller: null});
    assert.equal(out.seg, null);
    assert.deepEqual(out.e, eff.e);
    assert.deepEqual(out.last, eff.last);
});

test('effStep: learning starts at roll-off + 120 s', () => {
    // b's turn starts at 240 s < 270 s: not fed; c's turn at 280 s is.
    assert.deepEqual(drive(undefined, {rolledAt: 150000}).e, [10]);
    // The boundary itself counts: roll-off 160 s + 120 s = c's since at 280 s.
    assert.deepEqual(drive(undefined, {rolledAt: 160000}).e, [10]);
    assert.deepEqual(drive(undefined, {rolledAt: 160001}).e, []);
});

test('effStep: what is not fed', () => {
    // A bad step in b's turn: b not fed, and c's turn follows a bad one (last.bad).
    assert.deepEqual(drive(undefined, {bad: (t, k) => k === 1 && t === 250}).e, []);
    // b followed by a: b's successor is not the expected one, and a follows a turn whose next was c.
    const swapped = [{id: 'a', since: 200}, {id: 'b', since: 240}, {id: 'a', since: 280}, {id: 'b', since: 320}];
    assert.deepEqual(drive(swapped).e, []);
    // b's turn is the bonus pull: only c is fed.
    assert.deepEqual(drive(undefined, {bonus: k => k === 1}).e, [10]);
    // A 100 s turn on a 30 s plan does not fit; the turn after it does.
    const slow = [{id: 'a', since: 200}, {id: 'b', since: 240}, {id: 'c', since: 340}, {id: 'a', since: 380}];
    assert.deepEqual(drive(slow).e, [10]);
});

test('effStep: no ease-off: T0 is the next since, no H', () => {
    const eff = drive(undefined, {noPower: k => k === 1});
    assert.deepEqual(eff.e, [10, 7]);       // 13 s over plan, stored clipped to 10
    assert.deepEqual(eff.h, [3]);
});

test('effStep: never H from my own adoption', () => {
    const eff = drive(undefined, {selfId: 'c'});
    assert.deepEqual(eff.e, [10, 10]);
    assert.deepEqual(eff.h, [3]);
});

test('effStep: the last 12 only', () => {
    const ids = ['a', 'b', 'c'];
    const turns = Array.from({length: 16}, (_, k) => ({id: ids[k % 3], since: 200 + 40 * k}));
    const eff = drive(turns);
    assert.equal(eff.e.length, 12);
    assert.equal(eff.h.length, 12);
});

test('effCut drops the open turn and keeps E and H', () => {
    const eff = drive();
    assert.notEqual(eff.seg, null);
    const cut = E.effCut(eff);
    assert.equal(cut.seg, null);
    assert.equal(cut.last, null);
    assert.deepEqual(cut.e, eff.e);
    assert.deepEqual(cut.h, eff.h);
    assert.notEqual(eff.seg, null, 'the input is untouched');
});

test('effStep: the power log is capped, that turn is not fed', () => {
    // A 905 s turn on a 900 s plan would fit (x = 4 s); only the cap keeps it out.
    const turns = [{id: 'a', since: 200}, {id: 'b', since: 240}, {id: 'c', since: 1145}, {id: 'a', since: 1185}];
    const mid = drive(turns, {planS: 900, upto: 1144});
    assert.equal(mid.seg.id, 'b');
    assert.equal(mid.seg.pw.length, 900);
    assert.equal(mid.seg.bad, true);
    assert.deepEqual(drive(turns, {planS: 900}).e, []);
});

test('effStep: a lagged adoption ends the window at the next since + 1 s', () => {
    // c is adopted at 283 s but dated 280 s; b keeps riding 300 W past 280 s, so the last step above
    // 85 % is in the window's extra second. T0 is then since + 1 s (281 s), never later (the cap) and
    // never earlier (the window end). a: 300 W until 236 s, T0 237 s.
    let eff = E.initialEff();
    const turn = (t) => t < 240 ? ['a', 200] : t < 283 ? ['b', 240] : ['c', 280];
    for (let t = 200; t <= 283; t++) {
        const [puller, since] = turn(t);
        const power = puller === 'a' ? (t < 236 ? 300 : 100) : 300;
        eff = E.effStep(eff, {
            now: t * 1000, puller, since: since * 1000, planS: 30, bonus: false, power, bad: false,
            nextId: NEXT[puller], rolledAt: 0, selfId: 'z',
        });
    }
    assert.equal(eff.last.id, 'b');
    assert.equal(eff.last.T0, 281000);
    assert.deepEqual(eff.e, [10]);           // 14 s over plan, stored clipped to 10
});
