import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../pages/src/engine/gaps.mjs';

// Positions front first from the gaps between neighbours: line(['a', 'b', 'c'], [2, 12]) puts b
// 2 m behind a and c 12 m behind b.
function line(ids, gaps) {
    let x = 1000;
    return ids.map((id, i) => {
        x -= i ? gaps[i - 1] : 0;
        return {id, x};
    });
}


// Steps once a second from t = 0 with the positions fn(t) gives; returns the last state.
function run(fn, {from = 0, to, selfId = 'me', hill = false, needed = G.GAP_FINISHERS, st = G.initialGaps()}) {
    for (let t = from; t <= to; t++) {
        st = G.gapStep(st, {now: t * 1000, positions: fn(t), selfId, active: true, hill, needed});
    }
    return st;
}


test('gapStep: a gap opens after GAP_HOLD_MS at GAP_ON_M and closes after GAP_CLEAR_MS below GAP_OFF_M', () => {
    const ids = ['me', 'b', 'c', 'cora'];
    const gapAt = t => (t >= 10 && t < 30 ? G.GAP_ON_M : 2);
    const fn = t => line(ids, [2, 2, gapAt(t)]);
    // The median of 3 reaches 10 m at t = 11; open GAP_HOLD_MS later.
    assert.equal(G.gapView(run(fn, {to: 11 + G.GAP_HOLD_MS / 1000 - 1}), 'me'), null);
    const v = G.gapView(run(fn, {to: 11 + G.GAP_HOLD_MS / 1000}), 'me');
    assert.deepEqual(v, {kind: 'one', id: 'cora', m: 10, s: null, n: 1, critical: true, mine: false, behind: false,
                         level: 'full'});
    // Back to 2 m at t = 30, the median at t = 31; closed GAP_CLEAR_MS later, still open before
    // (but no longer shown).
    assert.equal(run(fn, {to: 31 + G.GAP_CLEAR_MS / 1000 - 1}).riders.cora.open, true);
    assert.equal(run(fn, {to: 31 + G.GAP_CLEAR_MS / 1000}).riders.cora.open, false);
    assert.equal(G.gapView(run(fn, {to: 31}), 'me'), null);
});


test('gapStep: between GAP_OFF_M and GAP_ON_M an open gap stays open, a closed one stays closed', () => {
    const ids = ['me', 'cora'];
    const fn = t => line(ids, [t < 20 ? 12 : 8]);
    assert.equal(G.gapView(run(fn, {to: 60}), 'me').level, 'full', 'opened at 12 m, kept at 8 m');
    assert.equal(G.gapView(run(t => line(ids, [9]), {to: 60}), 'me').level, 'early', '9 m: only early');
    assert.equal(G.gapView(run(t => line(ids, [7]), {to: 60}), 'me'), null);
});


test('gapStep: one noisy sample is no gap (median), a short gap is none either', () => {
    const ids = ['me', 'b', 'cora'];
    const spike = run(t => line(ids, [2, t % 3 === 0 ? 30 : 3]), {to: 60});
    assert.equal(G.gapView(spike, 'me'), null);
    const short = run(t => line(ids, [2, t >= 10 && t < 14 ? 15 : 3]), {to: 30});
    assert.equal(G.gapView(short, 'me'), null);
});


test('gapView: the group behind the puller, one rider, a split, and my own gap', () => {
    const ids = ['p', 'b', 'me', 'd'];
    const group = G.gapView(run(() => line(ids, [12, 2, 2]), {to: 10}), 'me');
    assert.equal(group.kind, 'group');
    assert.equal(group.id, 'b');
    assert.equal(group.n, 3);
    assert.equal(group.behind, true);
    assert.equal(group.mine, false);
    // The puller's view of the same gap: not cut off.
    const asPuller = G.gapView(run(() => line(ids, [12, 2, 2]), {to: 10, selfId: 'p'}), 'p');
    assert.equal(asPuller.kind, 'group');
    assert.equal(asPuller.behind, false);
    const split = G.gapView(run(() => line(ids, [2, 12, 2]), {to: 10, selfId: 'p'}), 'p');
    assert.deepEqual([split.kind, split.id, split.n], ['split', 'me', 2]);
    const mine = G.gapView(run(() => line(ids, [2, 12, 2]), {to: 10}), 'me');
    assert.equal(mine.mine, true);
    const two = G.gapView(run(() => line(['p', 'me'], [12]), {to: 10, selfId: 'p'}), 'p');
    assert.equal(two.kind, 'one', 'two riders: the one behind');
});


test('gapView: with two gaps the one right before me wins, else the one nearest the front', () => {
    const ids = ['p', 'b', 'me', 'd'];
    const st = run(() => line(ids, [12, 2, 15]), {to: 10});
    assert.equal(G.gapView(st, 'me').id, 'b');
    const st2 = run(() => line(ids, [12, 15, 2]), {to: 10});
    assert.equal(G.gapView(st2, 'me').id, 'me');
});


test('gapStep: on a hill it takes GAP_HILL_ON_M; inactive forgets everything', () => {
    const ids = ['me', 'cora'];
    const fn = () => line(ids, [12]);
    assert.equal(G.gapView(run(fn, {to: 20, hill: true}), 'me').level, 'early', '12 m on a hill: early');
    assert.equal(G.gapView(run(() => line(ids, [11]), {to: 20, hill: true}), 'me'), null);
    assert.ok(G.gapView(run(() => line(ids, [G.GAP_HILL_ON_M]), {to: 20, hill: true}), 'me'));
    const st = run(fn, {to: 20});
    assert.ok(G.gapView(st, 'me'));
    assert.deepEqual(G.gapStep(st, {now: 21000, positions: fn(), selfId: 'me', active: false}), G.initialGaps());
});


test('gapGroup: a rider more than GAP_GONE_M away is gone, not a gap', () => {
    const ids = ['p', 'me', 'gone'];
    const pos = line(ids, [2, G.GAP_GONE_M + 1]);
    assert.deepEqual(G.gapGroup(pos, 'me').map(p => p.id), ['p', 'me']);
    assert.equal(G.gapView(run(() => pos, {to: 20}), 'me'), null);
    // Not in the line myself (bench): the front rider's group.
    assert.deepEqual(G.gapGroup(line(['a', 'b'], [3]), 'x').map(p => p.id), ['a', 'b']);
    assert.deepEqual(G.gapGroup([], 'x'), []);
});


test('gapStep: a gap that reaches GAP_LOST_M ends the warning until it has closed', () => {
    const ids = ['me', 'b', 'rolf'];
    const gapAt = t => (t < 10 ? 2 : t < 60 ? Math.min(12 + (t - 10) * 2, 200) : t < 80 ? 20 : 2);
    const fn = t => line(ids, [2, gapAt(t)]);
    const spare = {needed: 2};
    assert.equal(G.gapView(run(fn, {to: 16, ...spare}), 'me').id, 'rolf', 'warned while it grows');
    assert.equal(G.gapView(run(fn, {to: 40, ...spare}), 'me'), null, 'let go beyond GAP_LOST_M');
    assert.equal(G.gapView(run(fn, {to: 75, ...spare}), 'me'), null, 'still 20 m: no new warning');
    assert.equal(G.gapView(run(fn, {to: 90, ...spare}), 'me'), null);
    // After closing, a new gap warns again.
    const again = t => line(ids, [2, t < 10 ? 2 : t < 40 ? 80 : t < 50 ? 2 : 12]);
    assert.ok(G.gapView(run(again, {to: 60, ...spare}), 'me'));
});


test('gapView: riders let go further back are not counted; a closing gap is not shown', () => {
    // b is 12 m back, c right behind him, d dropped 80 m behind c: the gap before b cuts off b and c.
    const st = run(() => line(['me', 'b', 'c', 'd'], [12, 2, 80]), {to: 10, needed: 1});
    const v = G.gapView(st, 'me');
    assert.deepEqual([v.kind, v.id, v.n], ['group', 'b', 2]);
    const one = G.gapView(run(() => line(['me', 'b', 'c', 'd'], [2, 12, 80]), {to: 10, needed: 2}), 'me');
    assert.deepEqual([one.kind, one.id, one.n], ['one', 'c', 1]);
    // Closing: 4 m, still open for GAP_CLEAR_MS, but not shown.
    const closing = run(t => line(['me', 'b'], [t < 15 ? 12 : 4]), {to: 17});
    assert.equal(closing.riders.b.open, true);
    assert.equal(G.gapView(closing, 'me'), null);
});


test('gapView: the gap in seconds at my speed, none when slower than GAP_MIN_KMH', () => {
    const st = run(() => line(['me', 'cora'], [12]), {to: 10});
    assert.equal(G.gapView(st, 'me', {speedKmh: 43.2}).s, 1);    // 12 m at 12 m/s
    assert.equal(G.gapView(st, 'me', {speedKmh: 36}).s, 1.2);
    assert.equal(G.gapView(st, 'me', {speedKmh: G.GAP_MIN_KMH - 1}).s, null);
    assert.equal(G.gapView(st, 'me').s, null);
});


test('critical: fewer than `needed` riders ahead of the gap; such a gap is never let go', () => {
    // Five riders, the last one 15 m back: four still together, so he may drop.
    const five = ['a', 'b', 'c', 'd', 'e'];
    const spare = G.gapView(run(() => line(five, [2, 2, 2, 15]), {to: 10, selfId: 'a'}), 'a');
    assert.deepEqual([spare.kind, spare.critical], ['one', false]);
    // Four riders: nobody may be lost.
    const four = G.gapView(run(() => line(['a', 'b', 'c', 'd'], [2, 2, 15]), {to: 10, selfId: 'a'}), 'a');
    assert.equal(four.critical, true);
    // Critical and 120 m back: still warned (the team must wait); with a spare rider let go.
    const far = t => line(['a', 'b', 'c', 'd'], [2, 2, t < 5 ? 15 : 120]);
    assert.equal(G.gapView(run(far, {to: 30, selfId: 'a'}), 'a').m, 120);
    assert.equal(G.gapView(run(t => line(five, [2, 2, 2, t < 5 ? 15 : 120]), {to: 30, selfId: 'a'}), 'a'), null);
    // An earlier gap ends the front group: 5 riders, gap after #2 and before #5.
    const two = run(() => line(five, [2, 12, 2, 12]), {to: 10, selfId: 'a'});
    assert.equal(two.riders.c.critical, true);
    assert.equal(two.riders.e.critical, true, 'only two with the front ahead of it');
    // The group behind the puller is critical; a critical gap wins over a spare one in front.
    const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const st = run(() => line(seven, [2, 2, 2, 2, 12, 2]), {to: 10, selfId: 'a'});
    assert.deepEqual([G.gapView(st, 'a').id, G.gapView(st, 'a').critical], ['f', false]);
    const st2 = run(() => line(seven, [2, 12, 2, 2, 2, 12]), {to: 10, selfId: 'a'});
    assert.equal(G.gapView(st2, 'a').id, 'c');
});


test('critical: riders let go earlier stay let go when a gap opens further ahead later', () => {
    // Six riders, the last two 100 m back (let go: four still together). Then #4 drops 12 m: that
    // gap is critical and cuts off only #4, not the two let go before.
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const fn = t => line(ids, [2, 2, t < 20 ? 2 : 12, 100, 2]);
    const v = G.gapView(run(fn, {to: 40, selfId: 'a'}), 'a');
    assert.deepEqual([v.kind, v.id, v.n, v.critical], ['one', 'd', 1, true]);
});


test('gapView: riders far behind a later gap are not counted with the gap ahead of them', () => {
    // Four together, #4 12 m back, two more 80 m behind him that showed up only now (never let go).
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    let st = run(t => line(ids.slice(0, 4), [2, 2, 12]), {to: 20, selfId: 'a'});
    st = run(() => line(ids, [2, 2, 12, 80, 2]), {from: 21, to: 40, selfId: 'a', st});
    const v = G.gapView(st, 'a');
    assert.deepEqual([v.id, v.n, v.critical], ['d', 1, true]);
});


test('early stage: from GAP_EARLY_M after GAP_HOLD_MS, then the warning at GAP_ON_M; a warning wins', () => {
    const ids = ['me', 'b', 'cora'];
    // 9 m from t = 0, 11 m from t = 20.
    const fn = t => line(ids, [2, t < 20 ? G.GAP_EARLY_M + 1 : G.GAP_ON_M + 1]);
    assert.equal(G.gapView(run(fn, {to: G.GAP_HOLD_MS / 1000 - 1}), 'me'), null);
    assert.equal(G.gapView(run(fn, {to: G.GAP_HOLD_MS / 1000}), 'me').level, 'early');
    assert.equal(G.gapView(run(fn, {to: 30}), 'me').level, 'full');
    // An early gap further ahead does not hide a warning behind it.
    const st = run(() => line(ids, [9, 12]), {to: 20});
    assert.deepEqual([G.gapView(st, 'me').id, G.gapView(st, 'me').level], ['cora', 'full']);
});


test('riders far back who swap places are not mixed into the gap ahead of them', () => {
    // Four together (Dana last, 12 m back), Eli and Finn 80 m behind her, swapping every 2 s:
    // a history kept per rider would mix 80 m and 0 m (the demo showed "2 RIDERS" every other second).
    const fn = t => line(['a', 'b', 'c', 'dana', ...(Math.floor(t / 2) % 2 ? ['eli', 'finn'] : ['finn', 'eli'])],
                         [2, 2, t < 10 ? 2 : 12, 80, 0]);
    let st = G.initialGaps();
    for (let t = 0; t <= 40; t++) {
        st = G.gapStep(st, {now: t * 1000, positions: fn(t), selfId: 'a', active: true});
        const v = G.gapView(st, 'a');
        if (t >= 20) {
            assert.deepEqual([v.id, v.kind, v.n], ['dana', 'one', 1], `t = ${t}`);
        }
    }
});


test('cutBehind: the riders behind the first open gap behind me (user, 14 Nov 2026)', () => {
    const ids = ['me', 'b', 'c', 'd', 'e'];
    // I pull; d loses c's wheel (12 m), e stays on d's.
    let st = run(() => line(ids, [2, 2, 12, 2]), {to: 10});
    assert.deepEqual([...G.cutBehind(st, 'me')].sort(), ['d', 'e']);
    // From c's place the same; from e's (behind the gap) nobody further back is cut off.
    assert.deepEqual([...G.cutBehind(st, 'c')].sort(), ['d', 'e']);
    assert.deepEqual([...G.cutBehind(st, 'e')], []);
    // Only a gap that is open counts (5 s), and none in a tight line.
    assert.deepEqual([...G.cutBehind(run(() => line(ids, [2, 2, 12, 2]), {to: 3}), 'me')], []);
    assert.deepEqual([...G.cutBehind(run(() => line(ids, [2, 2, 2, 2]), {to: 10}), 'me')], []);
    // The whole group behind me: all of them; a rider let go (and his group) too.
    st = run(() => line(ids, [12, 2, 2, 2]), {to: 10});
    assert.deepEqual([...G.cutBehind(st, 'me')].sort(), ['b', 'c', 'd', 'e']);
    st = run(() => line(ids, [2, 2, 2, 60]), {to: 10, needed: 2});
    assert.deepEqual([...G.cutBehind(st, 'me')], ['e']);
    // Not in the line: nothing.
    assert.deepEqual([...G.cutBehind(st, 'x')], []);
    assert.deepEqual([...G.cutBehind(null, 'me')], []);
});
