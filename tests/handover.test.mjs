// Run with: node --test tests/handover.test.mjs
// The hand-over detector (design 2026-11-21-paceline-beta5 §1): the puller's power drop arms it,
// the next rider out of the draft and level fires it. All rows here are 1 Hz steps (now = t * 1000).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from '../pages/src/engine/handover.mjs';

// A is the puller (x 10), B, C and 'me' (x 0) follow. Per step the options give a function of t.
// since is in ms like now.
// b / c return {x, draft, age} (or null for no row); power gives A's watts; age gives A's row age.
function sim({
    from = 0, to, puller = 'A', since = 0, front = () => 'A', power = () => 300, ageA = () => 500,
    b = () => ({x: 5, draft: 40}), c = () => ({x: 3, draft: 40}), me = () => ({x: 0, draft: 40}),
    off = () => false, lineIds = ['A', 'B', 'C'], hand = null, pullerAt = () => puller, sinceAt = () => since,
}) {
    const out = [];
    let h = hand;
    for (let t = from; t <= to; t++) {
        const byId = new Map();
        const chain = [{id: 'A', x: 10}];
        byId.set('A', {athleteId: 'A', age: ageA(t), state: {power: power(t), draft: 0}});
        for (const [id, f] of [['B', b], ['C', c], ['me', me]]) {
            const r = f(t);
            if (!r) {
                continue;
            }
            chain.push({id, x: r.x});
            byId.set(id, {athleteId: id, age: r.age ?? 500, state: {draft: r.draft, power: 250}});
        }
        chain.sort((p, q) => q.x - p.x);
        const r = H.handoverStep(h, {
            now: t * 1000, puller: pullerAt(t), since: sinceAt(t), frontId: front(t), chain, byId,
            lineIds, selfId: 'me', off: off(t),
        });
        h = r.hand;
        out[t] = {hand: r.hand, fired: r.fired};
    }
    return out;
}

const drop = (t0, lo, hi = 300) => t => t < t0 ? hi : lo;

test('constants are the design values', () => {
    assert.equal(H.HANDOVER_DROP_FRAC, 0.8);
    assert.equal(H.HANDOVER_MIN_S, 15);
    assert.equal(H.HANDOVER_AVG_FROM_S, 5);
    assert.equal(H.HANDOVER_DRAFT_W, 5);
    assert.equal(H.HANDOVER_LEVEL_M, 0);
    assert.equal(H.HANDOVER_WINDOW_MS, 8000);
    assert.equal(H.HANDOVER_OUT_N, 2);
    assert.equal(H.HANDOVER_MED_N, 5);
    assert.equal(H.HANDOVER_FRESH_MS, 2000);
});

test('freshState: the value of a fresh, finite row, else null', () => {
    assert.equal(H.freshState({age: 500, state: {power: 250}}, 'power'), 250);
    assert.equal(H.freshState({state: {power: 250}}, 'power'), 250);
    assert.equal(H.freshState({age: 2000, state: {power: 250}}, 'power'), 250);
    assert.equal(H.freshState({age: 2001, state: {power: 250}}, 'power'), null);
    assert.equal(H.freshState({age: 0, state: {power: NaN}}, 'power'), null);
    assert.equal(H.freshState({age: 0, state: {}}, 'power'), null);
    assert.equal(H.freshState(undefined, 'power'), null);
    assert.equal(H.freshState({age: 0}, 'power'), null);
});

test('initialHand', () => {
    assert.deepEqual(H.initialHand(), {puller: null, frontAt: null, sum: 0, n: 0, w: [], arm: null, out: {}});
    assert.equal(H.initialHand('A').puller, 'A');
});

test('arms when the median of 5 falls below 80 % of his average', () => {
    const r = sim({to: 22, power: drop(20, 200)});
    assert.equal(r[21].hand.arm, null);
    assert.equal(r[22].hand.arm.at, 22000);
});

test('no arm before 15 s into the pull', () => {
    const r = sim({to: 15, power: drop(12, 100)});
    assert.equal(r[14].hand.arm, null);
    assert.equal(r[15].hand.arm.at, 15000);
});

test('the pull counts from the later of since and the first step in front', () => {
    const r = sim({to: 25, power: drop(20, 150), front: t => t < 10 ? 'C' : 'A'});
    assert.equal(r[24].hand.arm, null);
    assert.equal(r[25].hand.arm.at, 25000);
});

test('the average starts 5 s into the pull', () => {
    const r = sim({to: 40, power: t => t < 5 ? 1000 : t < 20 ? 300 : 250});
    for (let t = 0; t <= 40; t++) {
        assert.equal(r[t].hand.arm, null, `t=${t}`);
    }
    assert.equal(r[40].hand.sum, 300 * 15 + 250 * 21);
    assert.equal(r[40].hand.n, 36);
});

test('fires on a line rider out of the draft and level for 2 samples', () => {
    const r = sim({to: 24, power: drop(20, 200), b: t => t >= 23 ? {x: 10, draft: 0} : {x: 5, draft: 40}});
    assert.equal(r[23].fired, null);
    assert.deepEqual(r[24].fired, {id: 'B', since: 22000, kind: 'arm'});
});

test('no fire 0.1 m behind or at 6 W', () => {
    const behind = sim({to: 30, power: drop(20, 200), b: t => t >= 23 ? {x: 9.9, draft: 0} : {x: 5, draft: 40}});
    const weak = sim({to: 30, power: drop(20, 200), b: t => t >= 23 ? {x: 10, draft: 6} : {x: 5, draft: 40}});
    for (let t = 0; t <= 30; t++) {
        assert.equal(behind[t].fired, null, `behind t=${t}`);
        assert.equal(weak[t].fired, null, `weak t=${t}`);
    }
    // The edge itself fires: 5 W and exactly level.
    const edge = sim({to: 24, power: drop(20, 200), b: t => t >= 23 ? {x: 10, draft: 5} : {x: 5, draft: 40}});
    assert.equal(edge[24].fired.id, 'B');
});

test('the fire window is 8 s', () => {
    const power = t => t >= 20 && t <= 22 ? 200 : 300;
    const late = (t0, t1) => t => t >= t0 && t <= t1 ? {x: 10, draft: 0} : {x: 5, draft: 40};
    const inside = sim({to: 30, power, b: late(29, 30)});
    assert.equal(inside[29].fired, null);
    assert.deepEqual(inside[30].fired, {id: 'B', since: 22000, kind: 'arm'});
    const outside = sim({to: 32, power, b: late(31, 32)});
    for (let t = 0; t <= 32; t++) {
        assert.equal(outside[t].fired, null, `t=${t}`);
    }
    assert.equal(outside[31].hand.arm, null);
});

test('an arm older than 8 s is dropped before a re-arm is tried', () => {
    const power = t => t >= 20 && t <= 22 ? 200 : t >= 29 ? 100 : 300;
    const r = sim({to: 31, power});
    assert.equal(r[30].hand.arm.at, 22000);
    assert.equal(r[31].hand.arm.at, 31000);
});

test('the frontmost ready rider wins', () => {
    const r = sim({
        to: 24, power: drop(20, 200),
        b: t => t >= 23 ? {x: 10.5, draft: 0} : {x: 5, draft: 40},
        c: t => t >= 23 ? {x: 11, draft: 0} : {x: 3, draft: 40},
    });
    assert.equal(r[24].fired.id, 'C');
});

test('never me, though I am in the line', () => {
    // Final review of beta.5, M-6 (21 Nov 2026): in rotationStep I am in the line, so the line check
    // alone does not keep me out. I come out of the draft and past A; B coming the same way fires.
    const lineIds = ['A', 'B', 'C', 'me'];
    const past = t => t >= 23 ? {x: 11, draft: 0} : {x: 0, draft: 40};
    const r = sim({to: 30, power: drop(20, 200), me: past, lineIds});
    for (let t = 0; t <= 30; t++) {
        assert.equal(r[t].fired, null, `t=${t}`);
    }
    const ctrl = sim({to: 30, power: drop(20, 200), b: past, lineIds});
    assert.equal(ctrl[24].fired.id, 'B');
});

test('never a rider off the line', () => {
    const r = sim({
        to: 30, power: drop(20, 200),
        c: t => t >= 23 ? {x: 10.5, draft: 0} : {x: 3, draft: 40},
        lineIds: ['A', 'B'],
    });
    for (let t = 0; t <= 30; t++) {
        assert.equal(r[t].fired, null, `t=${t}`);
    }
    assert.equal(sim({to: 30, power: drop(20, 200), c: t => t >= 23 ? {x: 10.5, draft: 0} : {x: 3, draft: 40}})[24].fired.id, 'C');
});

test('stale rows give no sample', () => {
    // A's row is older than 2 s from 20: no power sample, so the drop is never seen.
    const stale = sim({to: 40, power: drop(20, 200), ageA: t => t >= 20 ? 2500 : 500});
    for (let t = 0; t <= 40; t++) {
        assert.equal(stale[t].hand.arm, null, `t=${t}`);
    }
    // B's draft 2 and 2 (repeated samples) fires at 24.
    const twice = sim({to: 24, power: drop(20, 200), b: t => t >= 23 ? {x: 10, draft: 2} : {x: 5, draft: 40}});
    assert.deepEqual(twice[24].fired, {id: 'B', since: 22000, kind: 'arm'});
    // B's row stale at 24 breaks the run: the second sample comes at 26.
    const gap = sim({
        to: 26, power: drop(20, 200),
        b: t => t === 24 ? {x: 10, draft: 2, age: 2500} : t >= 23 ? {x: 10, draft: 2} : {x: 5, draft: 40},
    });
    assert.equal(gap[24].fired, null);
    assert.equal(gap[25].fired, null);
    assert.deepEqual(gap[26].fired, {id: 'B', since: 22000, kind: 'arm'});
});

test('the median needs 5 entries and at least 3 power samples', () => {
    // Missing power pushes null into w.
    const gone = sim({to: 22, power: drop(20, 200), ageA: t => t >= 20 ? 2500 : 500});
    assert.deepEqual(gone[22].hand.w, [300, 300, null, null, null]);
    // 100 W at 18 and 22 to 24 with stale rows between: 2 samples of 5 give no median, 3 do.
    const power = t => t === 18 || t >= 22 ? 100 : 300;
    const ageA = t => t >= 19 && t <= 21 ? 2500 : 500;
    const few = sim({to: 24, power, ageA});
    assert.equal(few[22].hand.arm, null);
    assert.equal(few[23].hand.arm, null);
    assert.equal(few[24].hand.arm.at, 24000);
    // The lower median of 4 samples: [100, 100, 300, 300] gives 100 and arms.
    const low = sim({to: 20, power: t => t === 18 || t === 19 ? 100 : 300, ageA: t => t === 20 ? 2500 : 500});
    assert.deepEqual(low[20].hand.w, [300, 300, 100, 100, null]);
    assert.equal(low[19].hand.arm, null);
    assert.equal(low[20].hand.arm.at, 20000);
});

test('off: no arm, no fire, history kept', () => {
    const r = sim({
        to: 30, power: drop(20, 200), off: t => t >= 20,
        b: t => t >= 20 ? {x: 10, draft: 0} : {x: 5, draft: 40},
    });
    assert.equal(r[19].hand.sum, 4500);
    assert.equal(r[19].hand.n, 15);
    for (let t = 20; t <= 30; t++) {
        assert.equal(r[t].hand.arm, null, `arm t=${t}`);
        assert.equal(r[t].fired, null, `fired t=${t}`);
        assert.equal(r[t].hand.sum, 4500, `sum t=${t}`);
        assert.equal(r[t].hand.n, 15, `n t=${t}`);
    }
});

test('a new puller starts a new history', () => {
    const r = sim({
        to: 10, front: t => t < 10 ? 'A' : 'B', pullerAt: t => t < 10 ? 'A' : 'B', sinceAt: t => t < 10 ? 0 : 10000,
    });
    assert.equal(r[9].hand.puller, 'A');
    assert.ok(r[9].hand.n > 0);
    assert.equal(r[10].hand.puller, 'B');
    assert.equal(r[10].hand.sum, 0);
    assert.equal(r[10].hand.n, 0);
    assert.equal(r[10].hand.arm, null);
    const none = sim({to: 30, puller: null, power: drop(20, 200)});
    for (let t = 0; t <= 30; t++) {
        assert.equal(none[t].fired, null);
    }
});

test('run follows the front rider: a new puller who was in front starts his pull then', () => {
    // B is the front rider from 0 while A is still the puller; B becomes the puller at 5.
    const r = sim({
        to: 6, front: () => 'B', pullerAt: t => t < 5 ? 'A' : 'B', sinceAt: t => t < 5 ? 0 : 5000,
    });
    assert.equal(r[4].hand.run.id, 'B');
    assert.equal(r[5].hand.puller, 'B');
    assert.equal(r[5].hand.frontAt, 0);
    assert.equal(r[6].hand.frontAt, 0);
});

test('the median needs 5 entries also for a puller adopted from the front', () => {
    // A has been front rider since 0 while C was the puller; A becomes the puller at 20 with his
    // frontAt taken from the run (0), so 15 s into the pull are over at his first step. His history
    // is new: 3 or 4 samples (all real) must not make a median, the 5th does.
    const r = sim({
        to: 24, front: () => 'A', pullerAt: t => t < 20 ? 'C' : 'A', since: 0,
        power: t => t === 20 ? 300 : t > 20 ? 100 : 250,
    });
    assert.equal(r[20].hand.frontAt, 0);
    assert.deepEqual(r[22].hand.w, [300, 100, 100]);
    assert.equal(r[22].hand.arm, null);
    assert.deepEqual(r[23].hand.w, [300, 100, 100, 100]);
    assert.equal(r[23].hand.arm, null);
    assert.equal(r[24].hand.arm.at, 24000);
});

test('the pull counts from his since when that is later than his first step in front', () => {
    // A is in front from 0 (frontAt 0), but his since is 10: 15 s into the pull are 25, not 15,
    // and his average starts at 15.
    const r = sim({to: 25, since: 10000, power: drop(20, 150)});
    assert.equal(r[0].hand.frontAt, 0);
    assert.equal(r[14].hand.n, 0);
    assert.equal(r[24].hand.arm, null);
    assert.equal(r[25].hand.arm.at, 25000);
});
