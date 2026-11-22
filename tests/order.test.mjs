// Run with: node --test tests/order.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as O from '../pages/src/engine/order.mjs';


// Made-up riders a, b, c, … in plan order.
function plan(n) {
    return {riders: 'abcdefgh'.slice(0, n).split('').map((id, i) => ({id, name: 'Rider ' + id.toUpperCase(), pullS: 30, watts: 300 + i}))};
}

// Feeds the changes between consecutive pullers through orderStep; returns every state after a change.
function ride(p, pullers, {order = O.initialOrder(), presentIds = p.riders.map(r => r.id), selfId = null} = {}) {
    const states = [];
    for (let i = 1; i < pullers.length; i++) {
        const present = typeof presentIds === 'function' ? presentIds(i) : presentIds;
        order = O.orderStep(order, p, {fromId: pullers[i - 1], toId: pullers[i], presentIds: present, selfId});
        states.push(order);
    }
    return states;
}

const repeat = (seq, times) => Array.from({length: times}, () => seq).flat();


test('constants', () => {
    assert.equal(O.CHAOS_HISTORY_N, 4);
    assert.equal(O.CHAOS_BAD_N, 2);
    assert.equal(O.CHAOS_RETURN_N, 3);
});

test('initialOrder is calm and empty', () => {
    assert.deepEqual(O.initialOrder(), {hist: [], chaos: false, okRun: 0, out: {}, n: 0, turns: 0});
    assert.deepEqual(O.orderOutIds(O.initialOrder()), []);
});

test('plan order keeps it calm', () => {
    const p = plan(4);
    const states = ride(p, repeat(['a', 'b', 'c', 'd'], 4).slice(0, 13));
    assert.equal(states.length, 12);
    for (const s of states) {
        assert.equal(s.chaos, false);
        assert.deepEqual(s.out, {});
        assert.ok(s.hist.length <= O.CHAOS_HISTORY_N);
        assert.ok(s.hist.every(b => b === false));
    }
    assert.equal(states.at(-1).n, 12);
});

test('a rider sitting out is no chaos', () => {
    // A team on 12 Nov: 5 riders, d never pulls.
    const p = plan(5);
    const states = ride(p, repeat(['a', 'b', 'c', 'e'], 4));
    for (const s of states) {
        assert.equal(s.chaos, false);
    }
    // The third change (c → e) skips d.
    assert.deepEqual(O.orderOutIds(states[1]), []);
    assert.deepEqual(O.orderOutIds(states[2]), ['d']);
    assert.deepEqual(states[2].out, {d: 2});
    assert.deepEqual(states[2].hist, [false, false, false]);
    for (const s of states.slice(2)) {
        assert.deepEqual(O.orderOutIds(s), ['d']);
        assert.ok(s.hist.every(b => b === false));
    }
    // e → a is the next of the line once d sits out.
    assert.equal(O.classifyChange(p, {fromId: 'e', toId: 'a', presentIds: ['a', 'b', 'c', 'd', 'e'], out: {d: 2}}).kind, 'next');
});

test('stable other order (mock plan) is chaos', () => {
    // 4 riders, ridden c → d → b → a over and over.
    const p = plan(4);
    const states = ride(p, repeat(['c', 'd', 'b', 'a'], 6).slice(0, 21));
    assert.equal(states.length, 20);
    assert.equal(states[3].chaos, true);
    for (const s of states.slice(3)) {
        assert.equal(s.chaos, true);
    }
});

test('back-and-forth is chaos and returns after 3 in order', () => {
    const p = plan(6);
    const normal = ['a', 'b', 'c', 'd', 'e', 'f', 'a'];
    let states = ride(p, normal);
    assert.equal(states.at(-1).chaos, false);
    let order = states.at(-1);
    states = ride(p, ['a', 'b', 'a', 'b', 'a'], {order});
    assert.deepEqual(states.map(s => s.chaos), [false, false, false, true]);
    assert.deepEqual(states.at(-1).hist, [false, true, false, true]);
    assert.equal(states.at(-1).okRun, 0);
    order = states.at(-1);
    states = ride(p, ['a', 'b', 'c', 'd'], {order});
    assert.deepEqual(states.map(s => s.chaos), [true, true, false]);
    assert.deepEqual(states.map(s => s.okRun), [1, 2, 0]);
    assert.deepEqual(states.at(-1).hist, []);
    // Calm again: one back alone does not bring the chaos back.
    states = ride(p, ['d', 'c'], {order: states.at(-1)});
    assert.equal(states.at(-1).chaos, false);
    assert.deepEqual(states.at(-1).hist, [true]);
});

test('two in order are not enough', () => {
    const p = plan(6);
    let states = ride(p, ['a', 'b', 'a', 'b', 'a']);
    assert.equal(states.at(-1).chaos, true);
    states = ride(p, ['a', 'b', 'c', 'b'], {order: states.at(-1)});
    assert.deepEqual(states.map(s => s.chaos), [true, true, true]);
    assert.deepEqual(states.map(s => s.okRun), [1, 2, 0]);
    // Bad changes still go into the history while in chaos (capped, newest last).
    assert.deepEqual(states.at(-1).hist, [true, false, false, true]);
});

test('a rider out of the group while sitting out is no return when he is back', () => {
    // Review focus 1: d is skipped, leaves the group, comes back without pulling.
    const p = plan(5);
    const all = ['a', 'b', 'c', 'd', 'e'];
    const noD = ['a', 'b', 'c', 'e'];
    const pullers = ['a', 'b', 'c', 'e', 'a', 'b', 'c', 'e', 'a', 'b', 'c', 'e', 'a'];
    // Changes 0–3 with d in the group, 4–7 without him, then with him again.
    const states = ride(p, pullers, {presentIds: i => (i >= 5 && i <= 8 ? noD : all)});
    for (const s of states) {
        assert.equal(s.chaos, false);
        assert.ok(s.hist.every(b => b === false));
    }
    assert.deepEqual(states.at(-1).out, {d: 2});
    assert.deepEqual(O.lineOf(p, {presentIds: all, out: states.at(-1).out}), ['a', 'b', 'c', 'e']);
    assert.deepEqual(O.lineOf(p, {presentIds: noD, out: states.at(-1).out}), ['a', 'b', 'c', 'e']);
    // When he pulls again rounds later he is simply back in: no bad entry.
    const back = O.orderStep(states.at(-1), p, {fromId: 'c', toId: 'd', presentIds: all});
    assert.deepEqual(back.out, {});
    assert.deepEqual(back.hist.slice(-1), [false]);
    assert.equal(back.chaos, false);
});

test('I am never taken out when the team skips me', () => {
    // Review focus 2.
    const p = plan(5);
    const states = ride(p, ['a', 'b', 'd', 'e', 'a', 'b', 'd'], {selfId: 'c'});
    for (const s of states) {
        assert.deepEqual(s.out, {});
        assert.equal(s.chaos, false);
    }
    assert.deepEqual(O.lineOf(p, {presentIds: ['a', 'b', 'c', 'd', 'e'], out: states.at(-1).out}), ['a', 'b', 'c', 'd', 'e']);
    // The same skip takes another rider out.
    const other = ride(p, ['a', 'b', 'd'], {selfId: 'e'});
    assert.deepEqual(other.at(-1).out, {c: 1});
});

test('one of two skipped riders pulls within the round: only he is back, the change counts twice', () => {
    // Review focus 3: b → e skips c and d; c pulls one change later.
    const p = plan(6);
    let states = ride(p, ['a', 'b', 'e']);
    assert.deepEqual(states.at(-1).out, {c: 1, d: 1});
    assert.deepEqual(states.at(-1).hist, [false, false]);
    const s = O.orderStep(states.at(-1), p, {fromId: 'e', toId: 'c', presentIds: ['a', 'b', 'c', 'd', 'e', 'f']});
    assert.deepEqual(s.hist, [false, false, true, true]);
    assert.deepEqual(s.out, {d: 1});
    assert.deepEqual(O.lineOf(p, {presentIds: ['a', 'b', 'c', 'd', 'e', 'f'], out: s.out}), ['a', 'b', 'c', 'e', 'f']);
    assert.equal(s.chaos, true);
    assert.equal(s.n, 3);
});

test('a skipped rider pulling after a full round is a plain return', () => {
    // 4 riders present: within the round = fewer than 3 changes after the skip.
    const p = plan(4);
    const all = ['a', 'b', 'c', 'd'];
    let s = ride(p, ['a', 'c'])[0];                     // n 0: b out
    assert.deepEqual(s.out, {b: 0});
    s = O.orderStep(s, p, {fromId: 'c', toId: 'd', presentIds: all});   // n 1
    s = O.orderStep(s, p, {fromId: 'd', toId: 'a', presentIds: all});   // n 2
    const late = O.orderStep(s, p, {fromId: 'a', toId: 'b', presentIds: all});  // n 3: 3 changes ago
    assert.deepEqual(late.hist, [false, false, false, false]);
    assert.deepEqual(late.out, {});
    // Two changes after the skip it is a return within the round (d → b also skips a: a is out).
    const t = O.orderStep(ride(p, ['a', 'c', 'd'])[1], p, {fromId: 'd', toId: 'b', presentIds: all});
    assert.deepEqual(t.hist, [false, false, true, true]);
    assert.deepEqual(t.out, {a: 2});
});

test('the round counts the present plan riders, riders sitting out included', () => {
    const p = plan(5);
    const all = ['a', 'b', 'c', 'd', 'e'];
    // b out at change 0; e → b is change 3.
    const s = ride(p, ['a', 'c', 'd', 'e']).at(-1);
    assert.deepEqual(s.out, {b: 0});
    // 5 present: 3 < 4, a return within the round.
    assert.deepEqual(O.orderStep(s, p, {fromId: 'e', toId: 'b', presentIds: all}).hist.slice(-2), [true, true]);
    // a out of the group: 4 present (b, the one coming back, counts), 3 < 3 fails: plain return.
    const absent = O.orderStep(s, p, {fromId: 'e', toId: 'b', presentIds: ['c', 'd', 'e']});
    assert.deepEqual(absent.hist.slice(-1), [false]);
    assert.deepEqual(absent.out, {});
    // Riders sitting out are not taken off the count: b and c out at change 0, b back at change 3.
    const two = ride(p, ['a', 'd', 'e', 'a']).at(-1);
    assert.deepEqual(two.out, {b: 0, c: 0});
    const ret = O.orderStep(two, p, {fromId: 'a', toId: 'b', presentIds: all});
    assert.deepEqual(ret.hist.slice(-2), [true, true]);
    assert.deepEqual(ret.out, {c: 0});
});

test('orderStep never changes the state it gets', () => {
    const p = plan(5);
    const s0 = ride(p, ['a', 'b', 'd'])[1];
    const copy = structuredClone(s0);
    O.orderStep(s0, p, {fromId: 'd', toId: 'c', presentIds: ['a', 'b', 'c', 'd', 'e']});
    O.orderStep(s0, p, {fromId: 'd', toId: 'b', presentIds: ['a', 'b', 'c', 'd', 'e']});
    assert.deepEqual(s0, copy);
});

test('lineOf: present plan riders in plan order, not out, keepIds always in', () => {
    const p = plan(5);
    assert.deepEqual(O.lineOf(p, {presentIds: ['e', 'a', 'c'], out: {}}), ['a', 'c', 'e']);
    assert.deepEqual(O.lineOf(p, {presentIds: ['a', 'b', 'c', 'd', 'e'], out: {b: 0, d: 3}}), ['a', 'c', 'e']);
    assert.deepEqual(O.lineOf(p, {presentIds: ['a', 'c'], out: {b: 0}, keepIds: ['b', 'd']}), ['a', 'b', 'c', 'd']);
    assert.deepEqual(O.lineOf(p, {presentIds: null, out: {}}), []);
    assert.deepEqual(O.lineOf(null, {presentIds: ['a'], out: {}}), []);
});

test('classifyChange: next, skip, back, line of 2, other', () => {
    const p = plan(5);
    const all = ['a', 'b', 'c', 'd', 'e'];
    assert.deepEqual(O.classifyChange(p, {fromId: 'b', toId: 'c', presentIds: all, out: {}}), {kind: 'next', skipped: []});
    assert.deepEqual(O.classifyChange(p, {fromId: 'e', toId: 'a', presentIds: all, out: {}}), {kind: 'next', skipped: []});
    assert.deepEqual(O.classifyChange(p, {fromId: 'b', toId: 'e', presentIds: all, out: {}}), {kind: 'skip', skipped: ['c', 'd']});
    assert.deepEqual(O.classifyChange(p, {fromId: 'd', toId: 'b', presentIds: all, out: {}}), {kind: 'skip', skipped: ['e', 'a']});
    assert.deepEqual(O.classifyChange(p, {fromId: 'c', toId: 'b', presentIds: all, out: {}}), {kind: 'back', skipped: []});
    assert.deepEqual(O.classifyChange(p, {fromId: 'a', toId: 'e', presentIds: all, out: {}}), {kind: 'back', skipped: []});
    // Absent and sitting-out riders are not in the line: c → e is next without d.
    assert.deepEqual(O.classifyChange(p, {fromId: 'c', toId: 'e', presentIds: ['a', 'b', 'c', 'e'], out: {}}), {kind: 'next', skipped: []});
    assert.deepEqual(O.classifyChange(p, {fromId: 'c', toId: 'e', presentIds: all, out: {d: 0}}), {kind: 'next', skipped: []});
    // From and to count even when not present or out.
    assert.deepEqual(O.classifyChange(p, {fromId: 'c', toId: 'd', presentIds: ['a', 'b'], out: {c: 0, d: 0}}), {kind: 'next', skipped: []});
    // A line of 2 is never back.
    assert.deepEqual(O.classifyChange(p, {fromId: 'b', toId: 'a', presentIds: ['a', 'b'], out: {}}), {kind: 'next', skipped: []});
    assert.deepEqual(O.classifyChange(p, {fromId: 'c', toId: 'a', presentIds: all, out: {b: 0, d: 0, e: 0}}), {kind: 'next', skipped: []});
    // Unknown ids, the same rider, no plan: other.
    assert.deepEqual(O.classifyChange(p, {fromId: 'x', toId: 'a', presentIds: all, out: {}}), {kind: 'other', skipped: []});
    assert.deepEqual(O.classifyChange(p, {fromId: 'a', toId: 'x', presentIds: all, out: {}}), {kind: 'other', skipped: []});
    assert.deepEqual(O.classifyChange(p, {fromId: null, toId: 'a', presentIds: all, out: {}}), {kind: 'other', skipped: []});
    assert.deepEqual(O.classifyChange(p, {fromId: 'a', toId: 'a', presentIds: all, out: {}}), {kind: 'other', skipped: []});
    assert.deepEqual(O.classifyChange(null, {fromId: 'a', toId: 'b', presentIds: all, out: {}}), {kind: 'other', skipped: []});
});

test('an unknown rider at the front is bad', () => {
    const p = plan(4);
    let states = ride(p, ['a', 'b', 'x', 'c']);
    assert.deepEqual(states.map(s => s.hist.at(-1)), [false, true, true]);
    assert.equal(states.at(-1).chaos, true);
});

test('riders sitting out stay out when chaos ends', () => {
    const p = plan(5);
    // c → e takes d out, then back-and-forth starts chaos, three changes in order end it.
    const states = ride(p, ['a', 'b', 'c', 'e', 'a', 'e', 'a', 'e', 'a', 'b', 'c']);
    assert.deepEqual(states[2].out, {d: 2});
    assert.equal(states[6].chaos, true);
    assert.equal(states.at(-1).chaos, false);
    assert.deepEqual(states.at(-1).hist, []);
    assert.deepEqual(states.at(-1).out, {d: 2});
});

test('orderStep starts from scratch on a missing or older state', () => {
    const p = plan(4);
    const fresh = O.orderStep(O.initialOrder(), p, {fromId: 'a', toId: 'c', presentIds: ['a', 'b', 'c', 'd']});
    for (const old of [undefined, null, {}, {chaos: true}]) {
        assert.deepEqual(O.orderStep(old, p, {fromId: 'a', toId: 'c', presentIds: ['a', 'b', 'c', 'd']}), fresh);
    }
    assert.deepEqual(fresh, {hist: [false], chaos: false, okRun: 0, out: {b: 0}, n: 1, turns: 1});
});


// ---------- 20 Nov 2026: the five rules after the replay (spec section 8) ----------

test('rule 1: a quick return undoes the skip and counts once', () => {
    // b → e skips c and d; c is in front within CHAOS_WINDOW_MS of that change.
    const p = plan(6);
    const all = ['a', 'b', 'c', 'd', 'e', 'f'];
    const s = ride(p, ['a', 'b', 'e']).at(-1);
    assert.deepEqual(s.out, {c: 1, d: 1});
    const quick = O.orderStep(s, p, {fromId: 'e', toId: 'c', presentIds: all, quick: true});
    assert.deepEqual(quick.hist, [false, false, true]);
    assert.deepEqual(quick.out, {}, 'both riders taken out by the skip are back in the line');
    assert.equal(quick.n, 3);
    assert.equal(quick.chaos, false);
    // Slow (quick false, the default): the return rule as before, two bad, only c back.
    for (const slow of [O.orderStep(s, p, {fromId: 'e', toId: 'c', presentIds: all, quick: false}),
                        O.orderStep(s, p, {fromId: 'e', toId: 'c', presentIds: all})]) {
        assert.deepEqual(slow.hist, [false, false, true, true]);
        assert.deepEqual(slow.out, {d: 1});
        assert.equal(slow.chaos, true);
    }
});

test('rule 1: a quick return after another change is the return rule as before', () => {
    // b → e takes c and d out (change 1), e → f (change 2), then c: out at n − 2, not n − 1.
    const p = plan(6);
    const all = ['a', 'b', 'c', 'd', 'e', 'f'];
    const s = ride(p, ['a', 'b', 'e', 'f']).at(-1);
    const r = O.orderStep(s, p, {fromId: 'f', toId: 'c', presentIds: all, quick: true});
    assert.deepEqual(r.hist.slice(-2), [true, true]);
    assert.equal(r.out.d, 1, 'd stays out');
    assert.ok(!Object.hasOwn(r.out, 'c'));
    assert.equal(r.n, 4);
});

test('rule 1: quick alone changes nothing for a rider who is not out', () => {
    const p = plan(5);
    const all = ['a', 'b', 'c', 'd', 'e'];
    const s = ride(p, ['a', 'b']).at(-1);
    assert.deepEqual(O.orderStep(s, p, {fromId: 'b', toId: 'c', presentIds: all, quick: true}),
                     O.orderStep(s, p, {fromId: 'b', toId: 'c', presentIds: all}));
    assert.deepEqual(O.orderStep(s, p, {fromId: 'b', toId: 'a', presentIds: all, quick: true}),
                     O.orderStep(s, p, {fromId: 'b', toId: 'a', presentIds: all}));
});

test('orderBad: one bad flag without a change', () => {
    const o1 = O.orderBad({...O.initialOrder(), out: {c: 0}, n: 1});
    assert.deepEqual(o1, {hist: [true], chaos: false, okRun: 0, out: {c: 0}, n: 1, turns: 0});
    const o2 = O.orderBad(o1);
    assert.deepEqual(o2, {hist: [true, true], chaos: true, okRun: 0, out: {c: 0}, n: 1, turns: 0}, 'CHAOS_BAD_N enters chaos');
    // In chaos it sets okRun to 0; capped at CHAOS_HISTORY_N, newest last.
    const inChaos = {hist: [true, false, false, false], chaos: true, okRun: 2, out: {}, n: 9};
    assert.deepEqual(O.orderBad(inChaos), {hist: [false, false, false, true], chaos: true, okRun: 0, out: {}, n: 9, turns: 9});
    // A missing or older state starts from scratch; the state it gets is not changed.
    for (const old of [undefined, null, {}, {chaos: true}]) {
        assert.deepEqual(O.orderBad(old), {hist: [true], chaos: false, okRun: 0, out: {}, n: 0, turns: 0});
    }
    const copy = structuredClone(inChaos);
    O.orderBad(inChaos);
    assert.deepEqual(inChaos, copy);
});

test('rule 4: in chaos only next counts toward the return, a skip leaves the count', () => {
    const p = plan(6);
    const chaos = {hist: [true, true], chaos: true, okRun: 0, out: {}, n: 2};
    // next, skip (b → d, c out), next, next: ends at the third next.
    let states = ride(p, ['a', 'b', 'd', 'e', 'f'], {order: chaos});
    assert.deepEqual(states.map(s => s.okRun), [1, 1, 2, 0]);
    assert.deepEqual(states.map(s => s.chaos), [true, true, true, false]);
    assert.deepEqual(states.at(-1).hist, []);
    // next, next, next ends it.
    states = ride(p, ['a', 'b', 'c', 'd'], {order: chaos});
    assert.deepEqual(states.map(s => s.chaos), [true, true, false]);
    // next, bad resets the count.
    states = ride(p, ['a', 'b', 'a'], {order: chaos});
    assert.deepEqual(states.map(s => s.okRun), [1, 0]);
    // A bad flag without a change (orderBad) resets it too.
    assert.equal(O.orderBad(states[0]).okRun, 0);
    // A quick return (rule 1) is bad: it resets the count as well.
    const skip = O.orderStep(states[0], p, {fromId: 'b', toId: 'd', presentIds: ['a', 'b', 'c', 'd', 'e', 'f']});
    assert.equal(skip.okRun, 1);
    const ret = O.orderStep(skip, p, {fromId: 'd', toId: 'c', presentIds: ['a', 'b', 'c', 'd', 'e', 'f'], quick: true});
    assert.equal(ret.okRun, 0);
    assert.equal(ret.chaos, true);
});


// ---------- audit fixes, 20 Nov 2026 ----------

test('orderCount: a turn not classified still counts for the round', () => {
    // I1: a → c skips b (b out at turn 0), then c → d, d → e: three turns.
    const p = plan(5);
    const all = ['a', 'b', 'c', 'd', 'e'];
    const s = ride(p, ['a', 'c', 'd', 'e']).at(-1);
    assert.equal(s.turns, 3);
    assert.deepEqual(s.out, {b: 0});
    // A new puller not classified (my hand-off, a resume): one more turn, nothing else.
    const c = O.orderCount(s);
    assert.equal(c.turns, 4);
    assert.equal(c.n, 3);
    assert.deepEqual(c.hist, s.hist);
    assert.deepEqual(c.out, s.out);
    assert.equal(c.chaos, s.chaos);
    assert.equal(c.okRun, s.okRun);
    // b back after a full round of the four others: a plain return (e → b skips a).
    const back = O.orderStep(c, p, {fromId: 'e', toId: 'b', presentIds: all});
    assert.deepEqual(back.hist, [false, false, false, false]);
    assert.deepEqual(back.out, {a: 4});
    assert.equal(back.n, 4);
    assert.equal(back.turns, 5);
    // Without that turn the same change is within the round: twice bad.
    assert.deepEqual(O.orderStep(s, p, {fromId: 'e', toId: 'b', presentIds: all}).hist, [false, false, true, true]);
    // A state without `turns` (older) reads turns = n; the state it gets is not changed.
    const old = {hist: [], chaos: false, okRun: 0, out: {}, n: 7};
    assert.equal(O.orderCount(old).turns, 8);
    assert.equal(O.orderCount(old).n, 7);
    assert.deepEqual(old, {hist: [], chaos: false, okRun: 0, out: {}, n: 7});
    assert.deepEqual(O.orderCount(undefined), {...O.initialOrder(), turns: 1});
});
