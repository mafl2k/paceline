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


// Steps once a second from t = 0 with the positions fn(t) gives (and the riders' data rows(t), if
// given); returns the last state.
function run(fn, {from = 0, to, selfId = 'me', hill = false, needed = G.GAP_FINISHERS, st = G.initialGaps(), rows}) {
    for (let t = from; t <= to; t++) {
        st = G.gapStep(st, {now: t * 1000, positions: fn(t), selfId, active: true, hill, needed,
                            riders: rows ? rows(t) : undefined});
    }
    return st;
}


test('gapStep: a gap opens after GAP_HOLD_MS at GAP_ON_M and closes after GAP_CLEAR_MS below GAP_OFF_M', () => {
    const ids = ['me', 'b', 'c', 'cora'];
    const gapAt = t => (t >= 10 && t < 30 ? G.GAP_ON_M : 2);
    const fn = t => line(ids, [2, 2, gapAt(t)]);
    // The median of 3 reaches 10 m at t = 11; open GAP_HOLD_MS later (only the early stage before:
    // the area rule).
    assert.equal(G.gapView(run(fn, {to: 11 + G.GAP_HOLD_MS / 1000 - 1}), 'me').level, 'early');
    const v = G.gapView(run(fn, {to: 11 + G.GAP_HOLD_MS / 1000}), 'me');
    assert.deepEqual(v, {kind: 'one', id: 'cora', m: 10, s: null, n: 1, critical: true, mine: false, behind: false,
                         level: 'full', closing: false});
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


test('gapView: riders far behind a later gap are counted with the gap ahead of them', () => {
    // Four together, #4 12 m back, two more 80 m behind him that showed up only now (never let go).
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    let st = run(t => line(ids.slice(0, 4), [2, 2, 12]), {to: 20, selfId: 'a'});
    st = run(() => line(ids, [2, 2, 12, 80, 2]), {from: 21, to: 40, selfId: 'a', st});
    const v = G.gapView(st, 'a');
    assert.deepEqual([v.id, v.n, v.critical], ['d', 3, true]);
});


test('early stage: from GAP_EARLY_M after GAP_HOLD_MS, then the warning at GAP_ON_M; a warning wins', () => {
    const ids = ['me', 'b', 'cora'];
    // GAP_EARLY_M from t = 0 (exactly: the area rule adds nothing there), 11 m from t = 20.
    const fn = t => line(ids, [2, t < 20 ? G.GAP_EARLY_M : G.GAP_ON_M + 1]);
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



// ---------- the earlier early stage: area and watch (17 Nov 2026) ----------

test('area: a gap well past GAP_EARLY_M warns before GAP_HOLD_MS, without any riders data', () => {
    const ids = ['me', 'cora'];
    // 10 m from t = 10: the median reaches it at t = 11, (10 − 8) m · 2 s = 4 m·s at t = 12.
    const fn = t => line(ids, [t < 10 ? 2 : 10]);
    assert.equal(run(fn, {to: 11}).riders.cora.early, false);
    assert.equal(G.gapView(run(fn, {to: 12}), 'me').level, 'early', '2 s at 10 m, not 5 s');
    // 9 m: 1 m·s a second, 4 s.
    const nine = t => line(ids, [t < 10 ? 2 : 9]);
    assert.equal(run(nine, {to: 13}).riders.cora.early, false);
    assert.equal(run(nine, {to: 14}).riders.cora.early, true);
    // At the early threshold itself nothing adds up: only the 5 s hold.
    const eight = t => line(ids, [t < 10 ? 2 : G.GAP_EARLY_M]);
    assert.equal(run(eight, {to: 15}).riders.cora.early, false);
    assert.equal(run(eight, {to: 16}).riders.cora.early, true);
    // A step counts for at most GAP_AREA_DT_S: 10 m, one step after a 10 s pause, is 4 m·s.
    let st = run(fn, {to: 10});
    st = G.gapStep(st, {now: 11000, positions: fn(11), selfId: 'me', active: true});
    assert.equal(st.riders.cora.area, 2);
    st = G.gapStep(st, {now: 21000, positions: fn(21), selfId: 'me', active: true});
    assert.equal(st.riders.cora.area, 2 + 2 * G.GAP_AREA_DT_S);
});


test('area: starts over below the threshold and when the rider ahead changes', () => {
    // a and b swap places every second, cora 10 m behind the rear one: always another pair.
    const swap = t => line(t % 2 ? ['me', 'a', 'b', 'cora'] : ['me', 'b', 'a', 'cora'], [2, 0.5, t < 10 ? 2 : 10]);
    const keep = t => line(['me', 'a', 'b', 'cora'], [2, 0.5, t < 10 ? 2 : 10]);
    assert.equal(run(keep, {to: 12}).riders.cora.early, true);
    assert.equal(run(swap, {to: 14}).riders.cora.area, 2, 'one step each');
    assert.equal(run(swap, {to: 14}).riders.cora.early, false);
    assert.equal(run(swap, {to: 15}).riders.cora.early, true, 'the 5 s hold still holds');
    // 9 m, 7 m, 9 m: the dip below 8 m (median of 3 from t = 11: 9, 9, 7, 7, 9, 9, ...) starts it
    // over: early 4 s after the median is back at 9 m, not at t = 14.
    const dip = t => line(['me', 'cora'], [t < 10 ? 2 : t === 12 || t === 13 ? 7 : 9]);
    assert.equal(run(dip, {to: 12}).riders.cora.area, 2);
    assert.equal(run(dip, {to: 13}).riders.cora.area, 0);
    assert.equal(run(dip, {to: 17}).riders.cora.early, false);
    assert.equal(run(dip, {to: 18}).riders.cora.early, true);
});


// The watch: me ahead at 40 km/h and 300 W, cora behind at 40 km/h and 250 W until t = 20, then
// at the given gap, speed and power. Steps from t = 0.
function watch({gap = 7, speed = 38, power = 200, age = 0, aheadAge = 0, from = 0, hill = false,
                gapAt = null, speedAt = null, powerAt = null}) {
    const fn = t => line(['me', 'cora'], [t < 20 ? 2 : gapAt ? gapAt(t) : gap]);
    const rows = t => (t < from ? {} : {
        me: {speed: 40, power: 300, age: aheadAge},
        cora: t < 20 ? {speed: 40, power: 250, age: 0} :
            {speed: speedAt ? speedAt(t) : speed, power: powerAt ? powerAt(t) : power, age},
    });
    return to => run(fn, {to, rows, hill});
}


test('watch: at 7 m, 2 km/h slower and 0.8 of his mean power for 2 steps: early', () => {
    const w = watch({});
    assert.equal(w(20).riders.cora.early, false);
    assert.equal(w(20).riders.cora.watch, 1);
    const st = w(21);
    assert.equal(st.riders.cora.m, 7, 'below GAP_EARLY_M: neither the hold nor the area');
    assert.equal(st.riders.cora.early, true);
    assert.equal(G.gapView(st, 'me').level, 'early');
    // The same gap without riders data: nothing (today's rules and the area only).
    const fn = t => line(['me', 'cora'], [t < 20 ? 2 : 7]);
    assert.equal(run(fn, {to: 60}).riders.cora.early, false);
});


test('watch: not with stale data, few power samples, under 7 m, 1 km/h slower, or 1 step', () => {
    assert.equal(watch({age: 2500})(30).riders.cora.early, false, 'his data 2.5 s old');
    assert.equal(watch({aheadAge: 2500})(30).riders.cora.early, false, 'the data of the rider ahead');
    assert.equal(watch({age: G.GAP_WATCH_AGE_MS})(21).riders.cora.early, true, '2 s is fresh');
    // Data from t = 13: 8 and 9 samples at t = 20 and 21 (the current one included).
    assert.equal(watch({from: 13})(21).riders.cora.early, false, 'fewer than 10 samples');
    assert.equal(watch({from: 13})(22).riders.cora.watch, 1, 'the 10th sample counts');
    assert.equal(watch({from: 13})(23).riders.cora.early, true);
    assert.equal(watch({gap: 6.5})(30).riders.cora.early, false, '6.5 m');
    assert.equal(watch({gap: 6.5})(30).riders.cora.watch, 11, 'counting, but under GAP_WATCH_M');
    assert.equal(watch({speed: 39})(30).riders.cora.early, false, '1 km/h slower');
    assert.equal(watch({speed: 38.5})(21).riders.cora.early, true, '1.5 km/h slower');
    assert.equal(watch({power: 230})(30).riders.cora.early, false, '0.92 of his mean');
    // His mean is over the samples before this one: 225 W is 0.9 of 250 (with the 225 in it, more).
    assert.equal(watch({powerAt: t => (t === 20 ? 225 : 200)})(21).riders.cora.early, true);
    // The raw gap, not the median: 5 m, then 7 m (median 5 m) fires.
    const raw = watch({gapAt: t => (t === 20 ? 5 : 7)})(21);
    assert.deepEqual([raw.riders.cora.m, raw.riders.cora.early], [5, true]);
    // Slower for one step only.
    const once = watch({speedAt: t => (t === 20 ? 38 : 40)});
    assert.equal(once(21).riders.cora.watch, 0);
    assert.equal(once(30).riders.cora.early, false);
});


test('watch: armed from GAP_ARM_M, disarmed only below GAP_DISARM_M; a new pair starts over', () => {
    // 7, 4.5, 7 m: still armed at 4.5 m, the third step fires.
    const keep = watch({gapAt: t => (t === 21 ? 4.5 : 7)});
    assert.equal(keep(21).riders.cora.armed, true);
    assert.equal(keep(22).riders.cora.early, true);
    // 7, 3.5, 7 m: disarmed, the third step is the first again.
    const lose = watch({gapAt: t => (t === 21 ? 3.5 : 7)});
    assert.equal(lose(21).riders.cora.armed, false);
    assert.equal(lose(22).riders.cora.watch, 1);
    assert.equal(lose(22).riders.cora.early, false);
    assert.equal(lose(23).riders.cora.early, true);
    // Only armed from 5 m: 4.5 m from the start never counts.
    assert.equal(watch({gapAt: t => (t < 22 ? 4.5 : 7)})(22).riders.cora.watch, 1);
    // The rider ahead changes between the two steps: the count starts over.
    const ids = t => (t === 21 ? ['b', 'me', 'cora'] : ['me', 'b', 'cora']);
    const fn = t => line(ids(t), [0.5, t < 20 ? 2 : 7]);
    const rows = t => ({me: {speed: 40, power: 300, age: 0}, b: {speed: 40, power: 300, age: 0},
                        cora: t < 20 ? {speed: 40, power: 250, age: 0} : {speed: 38, power: 200, age: 0}});
    assert.equal(run(fn, {to: 21, rows}).riders.cora.watch, 1);
    assert.equal(run(fn, {to: 21, rows}).riders.cora.early, false);
    assert.equal(run(fn, {to: 22, rows}).riders.cora.early, false, 'b ahead again: another new pair');
    assert.equal(run(fn, {to: 23, rows}).riders.cora.early, true);
});


test('area and watch on a hill: every threshold GAP_HILL_EARLY_M − GAP_EARLY_M (4 m) higher', () => {
    assert.equal(G.GAP_HILL_EARLY_M - G.GAP_EARLY_M, 4);
    assert.equal(watch({hill: true})(30).riders.cora.early, false, '7 m on a hill: not armed');
    assert.equal(watch({hill: true, gap: 10.5})(30).riders.cora.early, false, 'armed, under 11 m');
    const st = watch({hill: true, gap: 11})(21);
    assert.equal(st.riders.cora.m, 11);
    assert.equal(st.riders.cora.early, true);
    // Armed from 9 m, disarmed below 8 m: 7 m then 11 m is a first step, 11, 7.5, 11 m too.
    assert.equal(watch({hill: true, gapAt: t => (t === 20 ? 7 : 11)})(21).riders.cora.watch, 1);
    const hl = watch({hill: true, gapAt: t => (t === 21 ? 7.5 : 11)});
    assert.equal(hl(22).riders.cora.watch, 1);
    assert.equal(hl(22).riders.cora.early, false);
    assert.equal(watch({hill: true, gapAt: t => (t === 21 ? 8.5 : 11)})(22).riders.cora.early, true, '8.5 m: still armed');
    // Area: 10 m is nothing on a hill, 14 m warns after 2 s.
    const area = g => t => line(['me', 'cora'], [t < 10 ? 2 : g]);
    assert.equal(run(area(10), {to: 30, hill: true}).riders.cora.area, 0);
    assert.equal(run(area(14), {to: 11, hill: true}).riders.cora.early, false);
    assert.equal(run(area(14), {to: 12, hill: true}).riders.cora.early, true);
});


test('power history: one sample per rider and step, the last GAP_POWER_N, kept while inactive', () => {
    let st = G.initialGaps();
    const fn = () => line(['me', 'cora'], [2]);
    for (let t = 0; t < 20; t++) {
        st = G.gapStep(st, {now: t * 1000, positions: fn(), selfId: 'me', active: false,
                            riders: {me: {speed: 40, power: 300, age: 0}, cora: {speed: 40, power: 250, age: 0}}});
    }
    assert.deepEqual(st.riders, {});
    assert.equal(st.pw.cora.length, 20);
    // Active from t = 20 with the watch situation: fires at the second active step.
    const rows = t => ({me: {speed: 40, power: 300, age: 0}, cora: {speed: 38, power: 200, age: 0}});
    st = run(() => line(['me', 'cora'], [7]), {from: 20, to: 21, rows, st});
    assert.equal(st.riders.cora.early, true);
    st = run(() => line(['me', 'cora'], [7]), {from: 22, to: 60, rows, st});
    assert.equal(st.pw.cora.length, G.GAP_POWER_N);
    assert.deepEqual(st.pw.cora, Array(G.GAP_POWER_N).fill(200));
    // No power: no sample.
    st = G.gapStep(st, {now: 61000, positions: fn(), selfId: 'me', active: true,
                        riders: {cora: {speed: 38, power: null, age: 0}}});
    assert.equal(st.pw.cora.length, G.GAP_POWER_N);
    assert.equal(st.pw.me.length, G.GAP_POWER_N);
});


// Closing (user, 17 Nov 2026): cora 12 m behind me from t = 10, then the raw gap gapAt(t); his speed
// speedAt(t) against my 40 km/h (data `age` old).
function closing({gapAt, speedAt = () => 40.8, age = 0, aheadAge = 0}) {
    const fn = t => line(['me', 'cora'], [t < 10 ? 2 : t < 20 ? 12 : gapAt(t)]);
    const rows = t => ({me: {speed: 40, power: 300, age: aheadAge},
                        cora: {speed: t < 20 ? 40 : speedAt(t), power: 250, age}});
    return to => run(fn, {to, rows});
}


test('closing: on after a 1.2 m fall over 2 steps with the rider behind 0.8 km/h faster', () => {
    // 12, 11.4, 10.8 m: 1.2 m smaller over the 2 steps up to t = 21.
    const c = closing({gapAt: t => 12 - 0.6 * (t - 19)});
    assert.equal(c(20).riders.cora.closing, false, '0.6 m over one step');
    assert.equal(c(21).riders.cora.closing, true);
    assert.equal(c(21).riders.cora.early, true, 'the warning itself is not touched');
    assert.equal(G.gapView(c(21), 'me').closing, true);
    assert.equal(G.gapView(c(21), 'me').level, 'full', '12 m for 10 s: full, closing or not');
    // 0.8 m over 2 steps: not yet.
    assert.equal(closing({gapAt: t => 12 - 0.4 * (t - 19)})(21).riders.cora.closing, false);
});


test('closing: not with the rider behind only 0.3 km/h faster, not with stale data, not without data', () => {
    const fall = t => 12 - 0.6 * (t - 19);
    assert.equal(closing({gapAt: fall, speedAt: () => 40.3})(21).riders.cora.closing, false, '+0.3 km/h');
    assert.equal(closing({gapAt: fall, speedAt: () => 40.5})(21).riders.cora.closing, true, '+0.5 km/h');
    assert.equal(closing({gapAt: fall, age: 2500})(21).riders.cora.closing, false, 'his data 2.5 s old');
    assert.equal(closing({gapAt: fall, aheadAge: 2500})(21).riders.cora.closing, false, 'the data ahead');
    assert.equal(closing({gapAt: fall, age: G.GAP_CLOSE_AGE_MS})(21).riders.cora.closing, true, '2 s is fresh');
    const noRows = run(t => line(['me', 'cora'], [t < 10 ? 2 : t < 20 ? 12 : fall(t)]), {to: 21});
    assert.equal(noRows.riders.cora.closing, false);
    // The 2 steps further apart than GAP_CLOSE_SPAN_MS (3.2 s): no comparison.
    let st = G.initialGaps();
    const rows = {me: {speed: 40, power: 300, age: 0}, cora: {speed: 41, power: 250, age: 0}};
    for (const [t, g] of [[0, 12], [1, 12], [2, 12], [4, 11.4], [5.5, 10.8]]) {
        st = G.gapStep(st, {now: t * 1000, positions: line(['me', 'cora'], [g]), selfId: 'me', active: true, riders: rows});
    }
    assert.equal(st.riders.cora.closing, false, '3.5 s for the 2 steps');
});


test('closing: stays on through a flat step and a small rise, off once the smoothed gap is 1 m over its low', () => {
    // 12, 11.4, 10.8 (on; low 10.8), 10.8 (flat), 11.3, 11.9, 11.9: the median 10.8, 10.8, 11.3 (+0.5),
    // then 11.9 (+1.1 over the low: off).
    const gs = {20: 11.4, 21: 10.8, 22: 10.8, 23: 11.3, 24: 11.9};
    // His speed back to mine after t = 21: on stays on without the speed.
    const c = closing({gapAt: t => gs[t] ?? 11.9, speedAt: t => (t <= 21 ? 40.8 : 40)});
    assert.equal(c(21).riders.cora.closing, true);
    assert.ok(Math.abs(c(21).riders.cora.lo - 10.8) < 1e-9, 'the low: the raw gap that turned it on (the median lags)');
    assert.equal(c(22).riders.cora.closing, true, 'flat');
    assert.equal(c(23).riders.cora.closing, true, '+0.5 m');
    assert.equal(c(24).riders.cora.closing, true, 'raw +1.1 m over 2 steps, the median +0.5 m');
    assert.equal(c(25).riders.cora.closing, false, 'the median 1.1 m over the low');
    assert.equal(G.gapView(c(25), 'me').closing, false);
    assert.equal(c(30).riders.cora.closing, false, 'off stays off');
});


test('closing: off when the gap grows again slowly (0.3 m a step), not on one wild raw sample', () => {
    // Down 0.6 m a step from 12 m to 9 m (t = 24), then up 0.3 m a step: +0.6 m over 2 steps, never
    // enough for a 2-step rule. The median's low is 9.3 m (t = 25); it is 1 m above that at t = 30.
    const slow = closing({gapAt: t => (t <= 24 ? 12 - 0.6 * (t - 19) : 9 + 0.3 * (t - 24)), speedAt: () => 40.8});
    assert.equal(slow(24).riders.cora.closing, true);
    assert.equal(slow(29).riders.cora.closing, true, 'the median 10.2 m, 0.9 m over its low');
    assert.equal(slow(30).riders.cora.closing, false, 'the median 10.5 m');
    // One raw sample 4 m high inside a closing gap: the median does not move, it stays green.
    const blip = closing({gapAt: t => (t === 23 ? 14 : 12 - 0.6 * (t - 19))});
    for (const t of [21, 22, 23, 24, 25]) {
        assert.equal(blip(t).riders.cora.closing, true, `t = ${t}`);
    }
});


test('closing: carried over a new pair unless the gap jumps up by GAP_CLOSE_M; an inactive step starts over', () => {
    const rows = {me: {speed: 40, power: 300, age: 0}, b: {speed: 40, power: 300, age: 0},
                  cora: {speed: 40.8, power: 250, age: 0}};
    const fall = t => 12 - 0.6 * (t - 19);
    // b gets between me and cora at t = 22 (closing was on at t = 21, raw gap 10.8 m), the gap to b
    // fall(22) + up: the same gap still shrinking, 0.9 m larger, or 1.6 m larger.
    const fn = up => t => (t < 22 ? line(['me', 'cora'], [t < 20 ? 12 : fall(t)]) :
        line(['me', 'b', 'cora'], [0.5, fall(t) + up]));
    const at = (up, to) => run(fn(up), {to, rows: () => rows}).riders.cora;
    assert.equal(at(0, 21).closing, true);
    assert.deepEqual([at(0, 22).ahead, at(0, 22).closing], ['b', true], 'b ahead now, still shrinking: carried');
    assert.equal(at(0, 23).closing, true);
    assert.equal(at(0, 24).closing, true);
    assert.equal(at(1.5, 22).closing, true, '0.9 m larger than the old pair\'s last gap: carried');
    assert.equal(at(2.2, 22).closing, false, '1.6 m larger: starts over');
    assert.equal(at(2.2, 23).closing, false, 'one step of the new pair');
    assert.equal(at(2.2, 24).closing, true, 'two steps of the new pair, shrinking');
    // active: false forgets it.
    let st = run(t => line(['me', 'cora'], [t < 20 ? 12 : fall(t)]), {to: 21, rows: () => rows});
    assert.equal(st.riders.cora.closing, true);
    st = G.gapStep(st, {now: 22000, positions: line(['me', 'cora'], [fall(22)]), selfId: 'me', active: false, riders: rows});
    assert.equal(st.riders.cora, undefined);
    st = G.gapStep(st, {now: 23000, positions: line(['me', 'cora'], [fall(23)]), selfId: 'me', active: true, riders: rows});
    assert.equal(st.riders.cora.closing, false);
});


test('gapView: a growing gap goes before a closing one of the same rank; mine first stays first', () => {
    // b 12 m behind me and closing, cora 12 m behind b and steady: cora is shown, though b is nearer.
    const rows = t => ({me: {speed: 40, power: 300, age: 0}, b: {speed: t < 20 ? 40 : 40.8, power: 250, age: 0},
                        cora: {speed: 40, power: 250, age: 0}});
    const fn = t => line(['me', 'b', 'cora'], t < 10 ? [2, 2] : [t < 20 ? 12 : 12 - 0.6 * (t - 19), 12]);
    const st = run(fn, {to: 21, rows, needed: 1});
    assert.deepEqual([st.riders.b.early, st.riders.b.closing, st.riders.cora.early, st.riders.cora.closing],
                     [true, true, true, false]);
    assert.equal(st.riders.b.critical, st.riders.cora.critical, 'the same rank');
    assert.equal(G.gapView(st, 'me').id, 'cora');
    assert.equal(G.gapView(st, 'me').closing, false);
    // Without the closing, b nearer the front goes first (as before).
    assert.equal(G.gapView(run(fn, {to: 20, rows, needed: 1}), 'me').id, 'b');
    // b is me: mine first while it is not closing; closing, cora's full gap growing behind it goes
    // first when the team needs him (4 to finish), not when it can spare him (1 to finish).
    assert.equal(G.gapView(run(fn, {to: 20, rows, selfId: 'b', needed: 1}), 'b').id, 'b');
    const mine = run(fn, {to: 21, rows, selfId: 'b'});
    assert.deepEqual([mine.riders.b.closing, mine.riders.cora.critical], [true, true]);
    assert.equal(G.gapView(mine, 'b').id, 'cora');
    const spare = run(fn, {to: 21, rows, selfId: 'b', needed: 1});
    assert.deepEqual([spare.riders.b.closing, spare.riders.cora.critical], [true, false]);
    assert.deepEqual([G.gapView(spare, 'b').id, G.gapView(spare, 'b').closing], ['b', true]);
});


test('closing: clears once the smoothed gap is under GAP_OFF_M, so a gap opening again slowly is not green', () => {
    // 12 m, shrinking 0.6 m a step from t = 20 down to 4 m, flat, then growing 0.4 m a step from t = 40
    // (0.8 m over 2 steps: never enough to turn it off by growing). Cora faster throughout.
    const gapAt = t => (t < 40 ? Math.max(4, 12 - 0.6 * (t - 19)) : 4 + 0.4 * (t - 40));
    const c = closing({gapAt});
    assert.equal(c(28).riders.cora.closing, true);
    assert.ok(c(31).riders.cora.m < G.GAP_OFF_M);
    assert.equal(c(31).riders.cora.closing, false, 'the gap is gone');
    assert.equal(c(50).riders.cora.closing, false, '8 m again, growing slowly');
    assert.equal(c(55).riders.cora.closing, false);
});


test('gapView: my closing gap comes after a growing full gap of anyone, critical first, not after an early one', () => {
    // a ahead of me, my gap 12 m from t = 10 and closing from t = 21 (me faster than a); behind me
    // cora, 12 m (full from t = 16) or 9 m (only the early stage), and dana 2 m behind cora.
    const rows = t => ({a: {speed: 40, power: 300, age: 0}, me: {speed: t < 20 ? 40 : 40.8, power: 250, age: 0},
                        cora: {speed: 40.8, power: 250, age: 0}, dana: {speed: 40.8, power: 250, age: 0}});
    const fn = behind => t => line(['a', 'me', 'cora', 'dana'],
        t < 10 ? [2, 2, 2] : [t < 20 ? 12 : 12 - 0.6 * (t - 19), behind, 2]);
    const full = run(fn(12), {to: 21, rows});
    assert.deepEqual([full.riders.me.closing, full.riders.cora.open, full.riders.cora.closing], [true, true, false]);
    assert.equal(full.riders.cora.critical, true);
    const v = G.gapView(full, 'me');
    assert.deepEqual([v.id, v.mine, v.critical, v.level], ['cora', false, true, 'full']);
    // Not closing yet (t = 20): mine first.
    assert.equal(G.gapView(run(fn(12), {to: 20, rows}), 'me').id, 'me');
    // cora only in the early stage: my closing gap stays (green) rather than an early gap the rest
    // line would not show.
    const early = run(fn(9), {to: 21, rows});
    assert.deepEqual([early.riders.cora.early, early.riders.cora.open], [true, false]);
    assert.deepEqual([G.gapView(early, 'me').id, G.gapView(early, 'me').closing], ['me', true]);
});


test('gapView: my closing gap gives way only to a critical growing gap, not to one the team can spare', () => {
    // Stepped: a ahead of me, my gap 9 m from t = 10 (the early stage only, before the first break:
    // critical by my own place, needed 2) and closing from t = 21; dana 12 m behind cora from t = 10
    // (full from t = 16, the first break at place 3: the team can spare her) and growing.
    const rows = t => ({a: {speed: 40, power: 300, age: 0}, me: {speed: t < 20 ? 40 : 40.8, power: 250, age: 0},
                        cora: {speed: 40.8, power: 250, age: 0}, dana: {speed: 40, power: 250, age: 0}});
    const fn = t => line(['a', 'me', 'cora', 'dana'], t < 10 ? [2, 2, 2] : [t < 20 ? 9 : 9 - 0.6 * (t - 19), 2, 12]);
    const st = run(fn, {to: 21, rows, needed: 2});
    assert.deepEqual([st.riders.me.early, st.riders.me.open, st.riders.me.closing, st.riders.me.critical],
                     [true, false, true, true]);
    assert.deepEqual([st.riders.dana.open, st.riders.dana.closing, st.riders.dana.critical], [true, false, false]);
    assert.deepEqual([G.gapView(st, 'me').id, G.gapView(st, 'me').closing], ['me', true], 'a spare gap: mine stays green');
    // In one step every full gap has the critical flag of the first break, so a critical and a spare
    // growing gap side by side are built by hand: the critical one goes first though it is further
    // back, and without it my green gap stays.
    const gap = (at, critical, closing = false) => ({early: true, open: true, m: 12, closing, critical, at, behind: []});
    const both = {frontId: 'a', riders: {me: gap(1, true, true), spare: gap(2, false), needed: gap(3, true)}};
    assert.equal(G.gapView(both, 'me').id, 'needed');
    const spareOnly = {frontId: 'a', riders: {me: gap(1, true, true), spare: gap(2, false)}};
    assert.deepEqual([G.gapView(spareOnly, 'me').id, G.gapView(spareOnly, 'me').closing], ['me', true]);
});


// ---------- who a gap cuts off: everyone behind it (user, 23 Nov 2026) ----------

// Me at the front, ann 2 m back, ben 12 m behind her, cleo 2 m behind ben, dan 12 m behind cleo, eve 2 m
// behind dan: two full gaps, the first one before ben.
const ROW = ['me', 'ann', 'ben', 'cleo', 'dan', 'eve'];

test('gapView: a full gap counts everyone behind it, also behind a second gap', () => {
    const st = run(() => line(ROW, [2, 12, 2, 12, 2]), {to: 8});
    assert.equal(st.riders.dan.open, true, 'both gaps are full');
    const v = G.gapView(st, 'me');
    assert.deepEqual([v.id, v.n, v.m], ['ben', 4, 12]);
});


test('gapView: a gap that just closed no longer ends the list', () => {
    // dan's gap goes from 12 m to 4 m for 2 steps: the median is under GAP_OFF_M, but the gap is open
    // until it has been below for GAP_CLEAR_MS.
    const st = run(t => line(ROW, [2, 12, 2, t <= 8 ? 12 : 4, 2]), {to: 10});
    assert.equal(st.riders.dan.open, true);
    assert.ok(st.riders.dan.m < G.GAP_ON_M);
    assert.equal(G.gapView(st, 'me').n, 4);
});


test('gapView: riders let go are not counted', () => {
    // eve is 60 m behind dan; needed 2 makes no gap critical, so she is let go.
    const st = run(() => line(ROW, [2, 12, 2, 12, 60]), {to: 8, needed: 2});
    assert.equal(st.riders.eve.lost, true);
    const v = G.gapView(st, 'me');
    assert.deepEqual([v.id, v.n, v.critical], ['ben', 3, false]);
});


test('cutOff: everyone at or behind the frontmost full or let-go gap', () => {
    const st = run(() => line(ROW, [2, 12, 2, 12, 2]), {to: 8});
    assert.deepEqual(G.cutOff(st, 'me'), {ids: ['ben', 'cleo', 'dan', 'eve'], id: 'ben', m: 12});
    // A rider let go counts as a cut, and so do those behind him.
    const lost = run(() => line(ROW, [2, 2, 2, 2, 60]), {to: 8, needed: 2});
    assert.deepEqual(G.cutOff(lost, 'me'), {ids: ['eve'], id: 'eve', m: 60});
    // From a rider in the middle of the group ahead of the gap: the same list.
    assert.deepEqual(G.cutOff(st, 'ann').ids, ['ben', 'cleo', 'dan', 'eve']);
});


test('cutOff: a full gap under 10 m cuts nobody; null when I am behind the gap or not in the group', () => {
    // ben's gap shrinks to 8 m (smoothed), still open: under GAP_ON_M it cuts nobody.
    const st = run(t => line(ROW, [2, t <= 8 ? 12 : 8, 2, 2, 2]), {to: 12});
    assert.equal(st.riders.ben.open, true);
    assert.equal(st.riders.ben.m, 8);
    assert.equal(G.cutOff(st, 'me'), null);
    // Me as eve: the gaps are ahead of me, nobody is hanging behind me.
    const full = run(() => line(ROW, [2, 12, 2, 12, 2]), {to: 8, selfId: 'eve'});
    assert.equal(G.cutOff(full, 'eve'), null);
    assert.equal(G.cutOff(full, 'ben'), null, 'at the gap myself');
    assert.equal(G.cutOff(full, 'x'), null, 'not in the group');
    assert.equal(G.cutOff(null, 'me'), null);
    assert.equal(G.cutOff(run(() => line(ROW, [2, 2, 2, 2, 2]), {to: 8}), 'me'), null, 'a tight line');
});
