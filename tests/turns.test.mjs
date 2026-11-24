// Run with: node --test tests/turns.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from '../pages/src/engine/turns.mjs';
import {alignedPositions, pushPower, initialClimb, DRAFT_N} from '../pages/src/engine/rotation.mjs';
import {gapStep, initialGaps} from '../pages/src/engine/gaps.mjs';


// ---------- harness ----------

const NAMES = ['Ann', 'Ben', 'Cleo', 'Dan', 'Eve', 'Finn'];
const T0 = 1.7e12;

function mkPlan(n = 6, {pullS = 30, watts = 300} = {}) {
    return {sig: 'TURNS1', bench: [],
            riders: NAMES.slice(0, n).map((name, k) => ({id: String(101 + k), name, pullS, watts, weight: 70}))};
}
const ID = Object.fromEntries(NAMES.map((name, k) => [name, String(101 + k)]));
const NAME = Object.fromEntries(NAMES.map((name, k) => [String(101 + k), name]));
const names = ids => (ids || []).map(id => NAME[id]);

// Synthetic 1 Hz rides. script(s) -> {order: idx[] front first, 2 m apart; extra: [{idx, dx}] (metres
// from me, negative = behind); me: {power, draft, grade, speed, top, state}; power: {idx: W}}. After each
// turnsStep the real gapStep runs and its state goes into the next step, as paceline.mjs will do.
// Rows: {s, owner (name), since (s), change (kind), reason, v (view), st, self, gaps}.
function ride(script, {plan = mkPlan(), selfIdx = 5, dur = 60, from = 0, terrain = () => undefined, filter = false,
                       init = T.initialTurns} = {}) {
    const riderIds = new Set(plan.riders.map(r => r.id));
    const selfId = plan.riders[selfIdx].id;
    let st = init(T0), gaps = null, hist = [], drafts = [];
    const rows = [];
    for (let s = from; s < from + dur; s++) {
        const now = T0 + s * 1000;
        const wt = 1e12 + s * 1000;
        const sc = script(s);
        const me = sc.me || {};
        const order = sc.order || [];
        const k = order.indexOf(selfIdx);
        const myX = k >= 0 ? -2 * k : 0;
        const pos = [...order.map((idx, j) => ({idx, x: -2 * j})),
                     ...(sc.extra || []).map(e => ({idx: e.idx, x: myX + e.dx}))].filter(p => p.idx !== selfIdx);
        const speed = me.speed ?? 45;
        const nearby = [
            {athleteId: Number(selfId), self: true, age: 300, gapDistance: 0, ...me.top,
             state: {power: me.power ?? 200, draft: me.draft ?? 80, speed, worldTime: wt, grade: (me.grade ?? 0) / 100,
                    ...me.state}},
            ...pos.map(p => ({athleteId: Number(plan.riders[p.idx].id), age: 800, gapDistance: myX - p.x,
                              state: {power: sc.power?.[p.idx] ?? 250, draft: 50, speed, worldTime: wt}})),
        ];
        hist = pushPower(hist, {t: now, w: me.power ?? 200});
        drafts = [...drafts, me.draft ?? 80].slice(-DRAFT_N);
        const r = T.turnsStep(st, {now, plan, riderIds, selfId, nearby, hist, drafts, grade: me.grade ?? 0,
                                   sampleT: now, terrain: terrain(s), gaps, filter});
        st = r.state;
        const riders = Object.fromEntries(nearby.map(e => [String(e.athleteId),
            {speed: e.state.speed, power: e.state.power, age: e.age}]));
        gaps = gapStep(gaps ?? initialGaps(), {now, selfId, active: true, hill: st.hill.mode === 'pause', riders,
                                               positions: alignedPositions(nearby, riderIds).filter(p => riderIds.has(p.id))});
        const {view, reason} = T.turnsStatus(st, {now, plan, selfId, live: true});
        rows.push({s, owner: NAME[st.front.puller] ?? null,
                   since: st.front.since === null ? null : (st.front.since - T0) / 1000,
                   change: st.change?.kind ?? null, reason, v: view, st, self: r.self, gaps});
    }
    return rows;
}
const at = (rows, s) => rows.find(r => r.s === s);
const range = n => [...Array(n).keys()];
// fronts: [[idx, from s], ...]: who leads from when; everyone else behind him in plan order, 2 m apart.
const frontAt = (fronts, s) => fronts.filter(([, from]) => from <= s).at(-1)[0];
const line = (fronts, n = 6) => s => {
    const f = frontAt(fronts, s);
    return {order: [f, ...range(n).filter(i => i !== f)]};
};


// ---------- owner ----------

test('first owner: the front rider after 3 s, his clock from when he came to the front', () => {
    const rows = ride(line([[0, 0], [1, 2]]), {dur: 10});
    assert.equal(at(rows, 4).owner, null);
    assert.equal(at(rows, 4).reason, 'nofront');
    const r = at(rows, 5);
    assert.equal(r.owner, 'Ben');
    assert.equal(r.since, 2);
    assert.equal(r.change, 'first');
    assert.deepEqual(r.st.change, {kind: 'first', from: null, to: ID.Ben});
    assert.equal(at(rows, 6).change, null);
});

test('owner change: the plan\'s next holds 3 s and owns from when he came to the front', () => {
    const rows = ride(line([[0, 0], [1, 40]]), {dur: 50});
    assert.equal(at(rows, 3).owner, 'Ann');
    assert.equal(at(rows, 3).since, 0);
    assert.equal(at(rows, 42).owner, 'Ann');
    const r = at(rows, 43);
    assert.equal(r.owner, 'Ben');
    assert.equal(r.since, 40);
    assert.deepEqual(r.st.change, {kind: 'next', from: ID.Ann, to: ID.Ben});
    assert.deepEqual(r.st.prev, {id: ID.Ann, since: T0, skipped: []});
    assert.equal(r.v.elapsedS, 3);
});

test('owner change: anyone but the plan\'s next needs 20 s; a skip sets the passed riders out, and they keep their slots', () => {
    // Me = Finn. Dan beside the puller for 15 s (40-54): never the owner, nobody sits out.
    const rows = ride(line([[0, 0], [3, 40], [0, 55], [3, 80]]), {dur: 110});
    for (const r of rows.filter(r => r.s >= 40 && r.s < 100)) {
        assert.equal(r.owner, 'Ann', `s ${r.s}`);
        assert.deepEqual(r.st.out, {}, `s ${r.s}`);
        assert.equal(r.st.line.length, 6, `s ${r.s}`);
    }
    assert.equal(at(rows, 99).owner, 'Ann');
    const r = at(rows, 100);
    assert.equal(r.owner, 'Dan');
    assert.equal(r.since, 80);
    assert.equal(r.change, 'skip');
    assert.deepEqual(r.st.out, {[ID.Ben]: true, [ID.Cleo]: true});
    assert.deepEqual(names(r.st.line), ['Ann', 'Dan', 'Eve', 'Finn']);
    assert.deepEqual(names(r.st.present).sort(), [...NAMES].sort());
    // They stay out (and present) while Dan pulls.
    assert.deepEqual(at(rows, 109).st.out, {[ID.Ben]: true, [ID.Cleo]: true});
});


// ---------- the return rule ----------

test('return: the last owner back in front 3 s before the new owner is clear gets his turn back with his old since', () => {
    const rows = ride(line([[0, 0], [1, 40], [0, 50]]), {dur: 70});
    assert.equal(at(rows, 43).owner, 'Ben');
    assert.equal(at(rows, 52).owner, 'Ben');
    const r = at(rows, 53);
    assert.equal(r.owner, 'Ann');
    assert.equal(r.since, 0);
    assert.deepEqual(r.st.change, {kind: 'return', from: ID.Ben, to: ID.Ann});
    assert.equal(r.st.prev, null);    // one way: Ben, taken back, is no last owner
    assert.equal(at(rows, 60).v.elapsedS, 60);
    assert.equal(at(rows, 60).v.puller.name, 'Ann');
});

test('return: judged at the retake: Ben leads 40-56 and is never clear, Ann retakes at 57', () => {
    // Ben had 17 s at the front when Ann came back (clear: max(20 s, 30 s / 2)); her 3 s hold confirms it.
    const rows = ride(line([[0, 0], [1, 40], [0, 57]]), {dur: 70});
    assert.equal(at(rows, 59).owner, 'Ben');
    const r = at(rows, 60);
    assert.equal(r.owner, 'Ann');
    assert.equal(r.since, 0);
    assert.equal(r.change, 'return');
    assert.equal(at(rows, 65).v.elapsedS, 65);
    // The last second before Ben is clear (19 s at the retake) still counts.
    const late = ride(line([[0, 0], [1, 40], [0, 59]]), {dur: 70});
    assert.equal(at(late, 62).owner, 'Ann');
    assert.equal(at(late, 62).since, 0);
    assert.equal(at(late, 62).change, 'return');
});

test('return: not once the new owner is clear', () => {
    // Ann retakes the front when Ben has had exactly his clear time (20 s): she needs 20 s, a 'back'.
    const rows = ride(line([[0, 0], [1, 40], [0, 60]]), {dur: 85});
    assert.equal(at(rows, 63).owner, 'Ben');
    assert.equal(at(rows, 79).owner, 'Ben');
    const r = at(rows, 80);
    assert.equal(r.owner, 'Ann');
    assert.equal(r.since, 60);
    assert.equal(r.change, 'back');
});

test('return: the riders a taken-back skip set out are back in the line', () => {
    // Plans of 60 s: clear is 30 s. Dan skips Ben and Cleo (owner at 60, since 40); Ann back in front
    // at 64 gets her turn back at 67 (Dan's clock 27 s).
    const rows = ride(line([[0, 0], [3, 40], [0, 64]]), {plan: mkPlan(6, {pullS: 60}), dur: 75});
    const skip = at(rows, 60);
    assert.equal(skip.owner, 'Dan');
    assert.equal(skip.change, 'skip');
    assert.deepEqual(names(skip.st.line), ['Ann', 'Dan', 'Eve', 'Finn']);
    assert.equal(at(rows, 66).owner, 'Dan');
    const r = at(rows, 67);
    assert.equal(r.owner, 'Ann');
    assert.equal(r.since, 0);
    assert.equal(r.change, 'return');
    assert.deepEqual(r.st.out, {});
    assert.deepEqual(names(r.st.line), NAMES);
});


test('return: not in a line of two, where the last owner is also the plan\'s next', () => {
    // Me = Ben; Cleo..Finn never seen. Ann 0-40, Ben 40-55 (a 15 s pull), Ann takes her normal turn at 55.
    const rows = ride(line([[0, 0], [1, 40], [0, 55], [1, 85]], 2), {selfIdx: 1, dur: 100});
    assert.equal(at(rows, 57).owner, 'Ben');
    const r = at(rows, 58);
    assert.deepEqual([r.owner, r.since, r.change], ['Ann', 55, 'next']);
    assert.equal(at(rows, 70).v.elapsedS, 15);
    assert.deepEqual([at(rows, 88).owner, at(rows, 88).since, at(rows, 88).change], ['Ben', 85, 'next']);
});

test('sit-out back in his plan slot: he is the plan\'s next (3 s), on the flat and on a climb without the display', () => {
    // Me = Finn. Dan rolls through at 40 and holds 20 s (a skip: Ben and Cleo out). Then the plan order
    // from Dan: Eve 100, me 140, Ann 180, Ben (out) in his slot at 215, Cleo (out) at 250, Dan 290.
    const fronts = line([[0, 0], [3, 40], [4, 100], [5, 140], [0, 180], [1, 215], [2, 250], [3, 290]]);
    for (const terrain of [undefined, hills([[200, 400]])]) {
        const rows = ride(fronts, {dur: 300, ...(terrain ? {terrain} : {})});
        const tag = terrain ? 'climb' : 'flat';
        assert.equal(at(rows, 60).change, 'skip', tag);
        assert.equal(at(rows, 217).owner, 'Ann', tag);
        const ben = at(rows, 218);
        assert.deepEqual([ben.owner, ben.since, ben.change], ['Ben', 215, 'next'], tag);
        assert.deepEqual(ben.st.out, {[ID.Cleo]: true}, tag);
        assert.equal(ben.v.elapsedS, 3, tag);
        const cleo = at(rows, 253);
        assert.deepEqual([cleo.owner, cleo.since, cleo.change], ['Cleo', 250, 'next'], tag);
        assert.deepEqual(cleo.st.out, {}, tag);
        assert.deepEqual([at(rows, 293).owner, at(rows, 293).change], ['Dan', 'next'], tag);
        assert.ok(rows.every(x => x.st.disp === null), tag);
    }
});

test('trigger \'front\': not for the last owner taking the front back before the new one is clear', () => {
    // Climb 100-300. Ann -> Ben (her next) at 120 (owner 123); Ann pokes ahead 128-132: her turn back at 131.
    const p3 = ride(line([[0, 0], [1, 120], [0, 128], [1, 133], [2, 330]]), {dur: 340, terrain: CLIMB});
    assert.ok(p3.every(x => x.st.disp === null));
    assert.deepEqual([at(p3, 131).owner, at(p3, 131).since, at(p3, 131).change], ['Ann', 0, 'return']);
    // Ben (her next) from 133: a normal change, no display either.
    assert.deepEqual([at(p3, 136).owner, at(p3, 136).since, at(p3, 136).change], ['Ben', 133, 'next']);
    assert.deepEqual([at(p3, 333).owner, at(p3, 333).change], ['Cleo', 'next']);
    // Plans of 60 s. Dan skips Ben and Cleo on the flat (owner at 60); the climb from 62: Ann back at 64
    // (her turn back at 67), no display up to there.
    // One way: Dan (not Ann's next) in front again from 70 is no return; after 3 s the 'front' display fires.
    const skip = ride(line([[0, 0], [3, 40], [0, 64], [3, 70]]),
                      {plan: mkPlan(6, {pullS: 60}), dur: 90, terrain: hills([[62, 300]])});
    assert.ok(skip.filter(x => x.s < 73).every(x => x.st.disp === null));
    assert.deepEqual([at(skip, 67).owner, at(skip, 67).since, at(skip, 67).change], ['Ann', 0, 'return']);
    assert.equal(at(skip, 67).st.prev, null);
    assert.equal(at(skip, 72).owner, 'Ann');
    assert.equal(at(skip, 73).st.disp?.why, 'front');
});


test('return: in a line of three or more, also when the last owner is the owner\'s plan next (a back change taken back)', () => {
    // Plans of 60 s (clear 30 s). Me = Ben. Ann 0-40; Finn (last in the plan) rolls ahead from 40 and
    // holds 20 s (a back change), Ann takes the front back at 64: her turn back with her since.
    const rows = ride(line([[0, 0], [5, 40], [0, 64], [2, 120]]), {plan: mkPlan(6, {pullS: 60}), selfIdx: 1, dur: 130});
    assert.deepEqual([at(rows, 60).owner, at(rows, 60).change], ['Finn', 'back']);
    assert.deepEqual([at(rows, 67).owner, at(rows, 67).since, at(rows, 67).change], ['Ann', 0, 'return']);
    // Four riders present (Eve and Finn never seen): Dan after Ann is a back change; Ann back at 64.
    const four = ride(line([[0, 0], [3, 40], [0, 64], [2, 120]], 4), {plan: mkPlan(6, {pullS: 60}), selfIdx: 1, dur: 130});
    assert.deepEqual([at(four, 60).owner, at(four, 60).change], ['Dan', 'back']);
    assert.deepEqual([at(four, 67).owner, at(four, 67).since, at(four, 67).change], ['Ann', 0, 'return']);
});

test('return: one way, the owner taken back is no last owner; the new owner taking the front again is a normal change', () => {
    // Me = Finn. Ann 0-40, Ben (her next) from 40 (owner at 43); Ann back in front from 50 (her turn back at 53,
    // her old since 0); Ben in front again from 56: a normal 'next' at 59 with his clock from that front run.
    const rows = ride(line([[0, 0], [1, 40], [0, 50], [1, 56]]), {dur: 80});
    assert.deepEqual([at(rows, 43).owner, at(rows, 43).since, at(rows, 43).change], ['Ben', 40, 'next']);
    const ret = at(rows, 53);
    assert.deepEqual([ret.owner, ret.since], ['Ann', 0]);
    assert.deepEqual(ret.st.change, {kind: 'return', from: ID.Ben, to: ID.Ann});
    assert.equal(ret.st.prev, null);
    assert.equal(at(rows, 58).owner, 'Ann');
    assert.equal(at(rows, 58).st.prev, null);
    const r = at(rows, 59);
    assert.deepEqual([r.owner, r.since, r.change], ['Ben', 56, 'next']);
    assert.deepEqual(r.st.prev, {id: ID.Ann, since: T0, skipped: []});
    assert.equal(at(rows, 70).v.elapsedS, 14);    // from his new front run, not from 40
});


// ---------- countdown ----------

test('countdown: the fixed rule on the owner and his clock', () => {
    const cleo = ride(line([[0, 0]]), {selfIdx: 2, dur: 50});
    assert.equal(at(cleo, 10).v.toMyPullS, 60);    // Ann 30 + 10 - 10, Ben (before me) 30
    const ben = ride(line([[0, 0]]), {selfIdx: 1, dur: 50});
    assert.equal(at(ben, 10).v.toMyPullS, 20);     // Ann before me: her plan only
    assert.equal(at(ben, 45).v.toMyPullS, 0);
    assert.equal(at(ben, 45).v.standing, true);
});


// ---------- my own pull ----------

// Me = Ben unless said otherwise (the plan's next after Ann; plans of 30 s, so Ann is due from 20 s).
// My power 100 W, 300 W from `at`: the jump is seen 2 s later and dated `at`. Draft 0 from `at` for
// `n` s; I (index `me`) lead from `at` for `lead` s, else `fronts` lead (default Ann, Cleo behind me).
const jump = ({at = 25, n = Infinity, lead = Infinity, fronts = [[0, 0]], me = 1} = {}) => s => ({
    order: s >= at && s < at + lead ? [me, ...range(6).filter(i => i !== me)] : line(fronts)(s).order,
    me: {power: s < at ? 100 : 300, draft: s >= at && s < at + n ? 0 : 80}});

test('my start: a power jump while I am next and due, confirmed by my draft, makes me the owner from the jump', () => {
    const rows = ride(jump(), {selfIdx: 1, dur: 50});
    assert.equal(at(rows, 26).owner, 'Ann');
    assert.equal(at(rows, 26).self, null);
    const r = at(rows, 27);
    assert.equal(r.owner, 'Ben');
    assert.equal(r.since, 25);
    assert.equal(r.self, 'start');
    assert.deepEqual(r.st.change, {kind: 'self', class: 'next', from: ID.Ann, to: ID.Ben});
    assert.deepEqual(r.st.prev, {id: ID.Ann, since: T0, skipped: []});
    assert.deepEqual(r.st.out, {});
    assert.deepEqual(names(r.st.line), NAMES);
    assert.deepEqual(r.st.front.ignore, {id: ID.Ann, at: T0 + 27000});
    assert.deepEqual(r.st.front.last, {kind: 'start', at: T0 + 25000});
    assert.equal(r.st.front.pending, null);
    assert.equal(r.v.mine, true);
    for (const x of rows.filter(x => x.s > 27)) {
        assert.equal(x.owner, 'Ben', `s ${x.s}`);
        assert.equal(x.self, null, `s ${x.s}`);
    }
    assert.equal(at(rows, 40).v.elapsedS, 15);
});

test('my start: a draft run makes me the owner from its first sample', () => {
    // No power jump; draft 0 from 22 s (the mean of 3 is ~0 at 24), I lead from 24 (the position rule
    // alone would make me the owner at 27).
    const rows = ride(s => ({order: s >= 24 ? [1, 0, 2, 3, 4, 5] : range(6), me: {power: 200, draft: s >= 22 ? 0 : 80}}),
                      {selfIdx: 1, dur: 40});
    assert.deepEqual(at(rows, 24).st.run, {n: 1, at: T0 + 24000});
    assert.equal(at(rows, 24).owner, 'Ann');
    const r = at(rows, 25);
    assert.equal(r.owner, 'Ben');
    assert.equal(r.since, 24);
    assert.equal(r.self, 'draftStart');
    assert.deepEqual(r.st.change, {kind: 'self', class: 'next', from: ID.Ann, to: ID.Ben});
    assert.deepEqual(r.st.front.last, {kind: 'draftStart', at: T0 + 24000});
    assert.ok(rows.filter(x => x.s > 25).every(x => x.owner === 'Ben' && x.self === null));
});

test('my start: no confirmation within CONFIRM_MS is a revert', () => {
    // The jump at 25 (seen at 27), but my draft stays 80 and Ann stays in front.
    const rows = ride(jump({lead: 0, n: 0}), {selfIdx: 1, dur: 50});
    assert.equal(at(rows, 26).st.front.pending, null);
    for (const x of rows.filter(x => x.s >= 27 && x.s < 37)) {
        assert.deepEqual(x.st.front.pending, {id: ID.Ben, at: T0 + 25000}, `s ${x.s}`);
        assert.equal(x.self, null, `s ${x.s}`);
    }
    const r = at(rows, 37);
    assert.equal(r.self, 'revert');
    assert.equal(r.st.front.pending, null);
    assert.deepEqual(r.st.front.last, {kind: 'revert', at: T0 + 37000});
    assert.equal(r.change, null);
    assert.ok(rows.every(x => x.s < 3 || x.owner === 'Ann'));
    assert.ok(rows.filter(x => x.s > 37).every(x => x.self === null && x.st.front.pending === null));
});

test('my wrong start: the old owner still in front is ignored for SELF_IGNORE_MS, then gets his turn back with his old since', () => {
    // The jump at 25 and draft 0 for 25-29 (seen as my start at 27), but Ann never leaves the front.
    const rows = ride(jump({lead: 0, n: 5}), {selfIdx: 1, dur: 50});
    assert.equal(at(rows, 27).owner, 'Ben');
    assert.equal(at(rows, 27).self, 'start');
    for (const x of rows.filter(x => x.s >= 28 && x.s < 37)) {
        assert.equal(x.owner, 'Ben', `s ${x.s}`);
        assert.equal(x.st.fr.id, null, `s ${x.s}`);
    }
    assert.deepEqual(at(rows, 37).st.fr, {id: ID.Ann, since: T0 + 37000});
    assert.equal(at(rows, 39).owner, 'Ben');
    const r = at(rows, 40);
    assert.equal(r.owner, 'Ann');
    assert.equal(r.since, 0);
    assert.deepEqual(r.st.change, {kind: 'return', from: ID.Ben, to: ID.Ann});
    assert.equal(r.st.prev, null);    // the return leaves no last owner
    assert.equal(at(rows, 45).v.elapsedS, 45);
    assert.ok(rows.filter(x => x.s > 40).every(x => x.owner === 'Ann' && x.self === null));
});

test('my start: the owner I took over from is the last owner for the return rule, not the one before him', () => {
    // Me = Cleo. Ann, Ben from 40 (owner at 43); my jump at 62 as I lead (start at 64, since 62); Ann
    // back in front from 66 is not my next and no last owner of mine: 20 s, no return.
    const rows = ride(jump({at: 62, n: 4, lead: 4, fronts: [[0, 0], [1, 40], [0, 66]], me: 2}), {selfIdx: 2, dur: 90});
    assert.equal(at(rows, 63).owner, 'Ben');
    const r = at(rows, 64);
    assert.equal(r.owner, 'Cleo');
    assert.equal(r.since, 62);
    assert.equal(r.self, 'start');
    assert.deepEqual(r.st.prev, {id: ID.Ben, since: T0 + 40000, skipped: []});
    for (const x of rows.filter(x => x.s >= 64 && x.s < 86)) {
        assert.equal(x.owner, 'Cleo', `s ${x.s}`);
    }
    assert.equal(at(rows, 86).owner, 'Ann');
    assert.equal(at(rows, 86).since, 66);
    assert.notEqual(at(rows, 86).change, 'return');
});

// Me = Dan. Ann leads; Ben and Cleo are not with us before 28 (I am the plan's next in the line then),
// they ride between Ann and me from 28. My jump at 25 (seen at 27) is confirmed by my draft from 29 (I
// lead from 29 for `lead` s, then Eve from `eve`): my start passes over Ben and Cleo.
const skipStart = ({lead = Infinity, eve = Infinity} = {}) => s => ({
    order: s < 28 ? [0, 3, 4, 5] : s >= eve ? [4, 0, 1, 2, 3, 5] :
        s >= 29 && s < 29 + lead ? [3, 0, 1, 2, 4, 5] : range(6),
    me: {power: s < 25 ? 100 : 300, draft: s >= 29 && s < 34 ? 0 : 80}});

test('my start as a skip: the riders I passed over sit out until they pull, and the countdown leaves them out', () => {
    const rows = ride(skipStart({eve: 55}), {selfIdx: 3, dur: 75});
    assert.deepEqual(names(at(rows, 27).st.line), ['Ann', 'Dan', 'Eve', 'Finn']);
    assert.deepEqual(at(rows, 27).st.front.pending, {id: ID.Dan, at: T0 + 25000});
    const r = rows.find(x => x.self === 'start');
    assert.equal(r.s, 29);
    assert.equal(r.owner, 'Dan');
    assert.equal(r.since, 25);
    assert.deepEqual(r.st.change, {kind: 'self', class: 'skip', from: ID.Ann, to: ID.Dan});
    assert.deepEqual(T.turnDet(r.st).change, {kind: 'self', class: 'skip', from: ID.Ann, to: ID.Dan});
    assert.deepEqual(r.st.prev, {id: ID.Ann, since: T0, skipped: [ID.Ben, ID.Cleo]});
    assert.deepEqual(r.st.out, {[ID.Ben]: true, [ID.Cleo]: true});
    assert.deepEqual(names(r.st.line), ['Ann', 'Dan', 'Eve', 'Finn']);
    // Eve (my next) owns at 58 from 55; at 65 my countdown (the fixed rule) is Eve 30 + 10 - 10, Finn
    // 30 + 10 and Ann (before me) 30: no Ben, no Cleo (they would add 80).
    const e = at(rows, 58);
    assert.deepEqual([e.owner, e.since, e.change], ['Eve', 55, 'next']);
    assert.deepEqual(at(rows, 65).st.out, {[ID.Ben]: true, [ID.Cleo]: true});
    assert.equal(at(rows, 65).v.toMyPullS, 100);
});

test('my start held in front, the last owner rolls by: my own start after her return is a normal change', () => {
    // Plans of 60 s (Ann due from 50, clear 30 s). My jump at 55, I lead 55-74; Ann rolls by 75-78 (her turn
    // back at 78), I am in front again from 79 (draft 0): my own start there (its draft run, seen at 80) is a
    // normal change from Ann, my clock from 79: no return of my old since (one-way rule).
    const rows = ride(jump({at: 55, lead: 20, fronts: [[0, 0], [1, 79]]}), {plan: mkPlan(6, {pullS: 60}), selfIdx: 1, dur: 100});
    assert.equal(at(rows, 57).self, 'start');
    assert.deepEqual([at(rows, 78).owner, at(rows, 78).since, at(rows, 78).change], ['Ann', 0, 'return']);
    assert.equal(at(rows, 78).st.prev, null);
    const r = at(rows, 80);
    assert.deepEqual([r.owner, r.since, r.self], ['Ben', 79, 'draftStart']);
    assert.deepEqual(r.st.change, {kind: 'self', class: 'next', from: ID.Ann, to: ID.Ben});
    assert.ok(rows.filter(x => x.s >= 80).every(x => x.owner === 'Ben' && x.since === 79));
    assert.equal(at(rows, 85).v.elapsedS, 6);
});

test('my start as a skip, taken back by the return rule: the riders it set out are back in the line', () => {
    // Ann never leaves the front: my draft alone confirms my start at 31; Ann is ignored until 41, back
    // as the front rider then, the return at 44.
    const rows = ride(skipStart({lead: 0}), {selfIdx: 3, dur: 50});
    const s = rows.find(x => x.self === 'start');
    assert.deepEqual([s.s, s.owner, s.st.change.class], [31, 'Dan', 'skip']);
    for (const x of rows.filter(x => x.s >= 31 && x.s < 44)) {
        assert.deepEqual(x.st.out, {[ID.Ben]: true, [ID.Cleo]: true}, `s ${x.s}`);
    }
    const r = rows.find(x => x.change === 'return');
    assert.equal(r.s, 44);
    assert.deepEqual([r.owner, r.since], ['Ann', 0]);
    assert.deepEqual(r.st.out, {});
    assert.deepEqual(names(r.st.line), NAMES);
});

test('my ease-off does not end my turn', () => {
    // Me = Ann, the owner, down to 120 W at 35 s. Ben in front from 45 s.
    const rows = ride(s => ({...line([[0, 0], [1, 45]])(s), me: {power: s < 35 ? 300 : 120}}), {selfIdx: 0, dur: 55});
    for (const x of rows.filter(x => x.s >= 3 && x.s < 48)) {
        assert.equal(x.owner, 'Ann', `s ${x.s}`);
        assert.equal(x.v.mine, true, `s ${x.s}`);
    }
    assert.ok(rows.every(x => x.self === null));
    const r = at(rows, 48);
    assert.equal(r.owner, 'Ben');
    assert.equal(r.since, 45);
    assert.equal(r.change, 'next');
});

test('no own start on a hill', () => {
    // The first test's ride: my start at 27 on the flat, none on a real hill or a roller.
    assert.equal(at(ride(jump(), {selfIdx: 1, dur: 40}), 27).self, 'start');
    for (const roller of [false, true]) {
        const rows = ride(jump(), {selfIdx: 1, dur: 40, terrain: () => ({hill: {kind: 'climb', roller}})});
        assert.equal(at(rows, 27).st.hill.mode, roller ? 'flag' : 'pause');
        for (const x of rows) {
            assert.equal(x.self, null, `roller ${roller}, s ${x.s}`);
            assert.notEqual(x.change, 'self', `roller ${roller}, s ${x.s}`);
            assert.equal(x.st.front.pending, null, `roller ${roller}, s ${x.s}`);
            assert.deepEqual(x.st.run, {n: 0, at: null}, `roller ${roller}, s ${x.s}`);
        }
    }
    // A start seen on the flat (at 27) is not confirmed on a roller from 28 (my draft 0 from 30): a revert.
    const late = ride(s => ({...jump({lead: 0, n: 0})(s), me: {power: s < 25 ? 100 : 300, draft: s >= 30 ? 0 : 80}}),
                      {selfIdx: 1, dur: 40, terrain: s => (s >= 28 ? {hill: {kind: 'climb', roller: true}} : undefined)});
    assert.deepEqual(at(late, 27).st.front.pending, {id: ID.Ben, at: T0 + 25000});
    assert.equal(at(late, 37).self, 'revert');
    assert.ok(late.every(x => x.s < 3 || x.owner === 'Ann'));
});


// ---------- power filter ----------

// Me = Finn. Ann pulls at 270 W (90 % of her 300 W plan), Ben in front from 40 s at `ben(s)` W.
const filtered = ben => s => ({...line([[0, 0], [1, 40]])(s), power: {0: 270, 1: ben(s)}});

test('filter off (default): the plan\'s next owns after 3 s whatever his power', () => {
    const rows = ride(filtered(() => 100), {dur: 50});
    assert.equal(at(rows, 42).owner, 'Ann');
    const r = at(rows, 43);
    assert.equal(r.owner, 'Ben');
    assert.equal(r.since, 40);
    assert.equal(r.change, 'next');
    assert.ok(rows.every(x => x.st.soft === null));
});

test('filter on: the next at 80 % of plan while the owner rides 90 % waits for 20 s; at 95 % he owns at 5 s; the verdict is not taken back', () => {
    // 240 W (80 %) until 45, then 300 W: the verdict at 45 (samples 40-44) stands.
    const soft = ride(filtered(s => s < 45 ? 240 : 300), {dur: 70, filter: true});
    assert.equal(at(soft, 44).st.soft, null);
    assert.deepEqual(at(soft, 45).st.soft, {id: ID.Ben, since: T0 + 40000, v: true});
    for (const x of soft.filter(x => x.s >= 40 && x.s < 60)) {
        assert.equal(x.owner, 'Ann', `s ${x.s}`);
    }
    assert.deepEqual(at(soft, 59).st.soft, {id: ID.Ben, since: T0 + 40000, v: true});
    assert.equal(at(soft, 60).owner, 'Ben');
    assert.equal(at(soft, 60).since, 40);
    assert.equal(at(soft, 60).change, 'next');
    // 285 W (95 %): decided at 5 s, not 3 s.
    const firm = ride(filtered(() => 285), {dur: 50, filter: true});
    assert.equal(at(firm, 44).owner, 'Ann');
    assert.equal(at(firm, 45).owner, 'Ben');
    assert.equal(at(firm, 45).since, 40);
    assert.deepEqual(at(firm, 45).st.soft, {id: ID.Ben, since: T0 + 40000, v: false});
});


// ---------- hanging and gone ----------

test('hanging and gone: cut off at once and kept in the slot, back under 10 m in my chain, gone only after 30 s outside 30 m links', () => {
    // Me = Ann. Dan, Eve and Finn 14 m behind Cleo from 10 s; from 20 Ben leads (Ben, Cleo, me), the
    // gap 14 m behind me; it closes to 8 m at 40. From 60 Finn rides 25 m behind Eve, from 120 40 m.
    const rows = ride(s => {
        if (s < 10) {
            return {order: [0, 1, 2, 3, 4, 5]};
        }
        if (s < 20) {
            return {order: [0, 1, 2], extra: [{idx: 3, dx: -18}, {idx: 4, dx: -20}, {idx: 5, dx: -22}]};
        }
        const gap = s < 40 ? 14 : s < 60 ? 8 : 2;
        const finn = s < 60 ? gap + 4 : s < 120 ? 4 + 25 : 4 + 40;
        return {order: [1, 2, 0], extra: [{idx: 3, dx: -gap}, {idx: 4, dx: -gap - 2}, {idx: 5, dx: -finn}]};
    }, {selfIdx: 0, dur: 160});
    // Before the gap is open (5 s held) nobody hangs; once the warning's gap is open they do.
    assert.deepEqual(at(rows, 12).st.hanging, []);
    const first = rows.find(r => r.st.hanging.length).s;
    assert.ok(first >= 15 && first <= 18, `hanging from ${first}`);
    const r = at(rows, 30);
    assert.deepEqual(names(r.st.hanging), ['Dan', 'Eve', 'Finn']);
    assert.deepEqual(r.st.cut, {id: ID.Dan, m: 14});
    assert.deepEqual(names(r.st.line), ['Ann', 'Ben', 'Cleo']);
    assert.deepEqual(names(r.st.present).sort(), [...NAMES].sort());
    // The view counts them out: Ben (owner since 20, 10 s in) 30 + 10 - 10, then Cleo (before me) 30.
    assert.equal(r.owner, 'Ben');
    assert.equal(r.since, 20);
    assert.equal(r.v.toMyPullS, 60);
    // Kept while the gap is open, no flicker.
    for (const x of rows.filter(x => x.s >= first && x.s <= 41)) {
        assert.deepEqual(names(x.st.hanging), ['Dan', 'Eve', 'Finn'], `s ${x.s}`);
    }
    // The gap closes to 8 m at 40: back in the line within 3 steps (smoothed under 10 m, in my chain).
    assert.equal(at(rows, 41).gaps.riders[ID.Dan].m, 8);
    assert.deepEqual(at(rows, 42).st.hanging, []);
    assert.deepEqual(names(at(rows, 42).st.line), NAMES);
    // Finn 25 m behind for 60 s is never gone (hanging, still present).
    for (const x of rows.filter(x => x.s >= 60 && x.s < 149)) {
        assert.ok(x.st.present.includes(ID.Finn), `s ${x.s}`);
    }
    assert.ok(at(rows, 100).st.hanging.includes(ID.Finn));
    assert.ok(!at(rows, 100).st.line.includes(ID.Finn));
    // Finn 40 m behind from 120 (last in my chain at 119): gone at 149, not before.
    assert.ok(at(rows, 148).st.present.includes(ID.Finn));
    assert.ok(!at(rows, 149).st.present.includes(ID.Finn));
    assert.ok(!at(rows, 149).st.line.includes(ID.Finn));
});

test('hanging: a rider whose data reappears does not enter the line before the gap state has him', () => {
    // Me = Ann. Dan, Eve and Finn 14 m behind Cleo from 10 s; Finn's data is missing 30-44 (not in my
    // chain, not in the gap state, still present), then he is back 2 m behind Eve, still behind the gap.
    const rows = ride(s => {
        if (s < 10) {
            return {order: [0, 1, 2, 3, 4, 5]};
        }
        const extra = [{idx: 3, dx: -18}, {idx: 4, dx: -20}, {idx: 5, dx: -22}];
        return {order: [0, 1, 2], extra: s >= 30 && s < 45 ? extra.slice(0, 2) : extra};
    }, {selfIdx: 0, dur: 55});
    assert.ok(!at(rows, 44).st.chain.some(c => c.id === ID.Finn));
    assert.ok(at(rows, 45).st.chain.some(c => c.id === ID.Finn));
    assert.ok(!at(rows, 44).gaps.riders[ID.Finn] && !!at(rows, 45).gaps.riders[ID.Finn]);
    for (const r of rows.filter(r => r.s >= 30)) {
        assert.ok(r.st.present.includes(ID.Finn), `s ${r.s}`);
        assert.deepEqual(names(r.st.hanging), ['Dan', 'Eve', 'Finn'], `s ${r.s}`);
        assert.deepEqual(names(r.st.line), ['Ann', 'Ben', 'Cleo'], `s ${r.s}`);
    }
});

test('hanging: a rider bridging up comes back under 10 m; the riders still 14 m behind him stay hanging', () => {
    // Me = Ann. Dan, Eve and Finn 14 m behind Cleo from 10 s; at 40 Dan bridges up to Cleo, Eve and Finn
    // stay 14 m behind him. The warning's gap before Dan closes; the one before Eve opens only after
    // GAP_HOLD_MS, and meanwhile Eve and Finn stay hanging.
    const rows = ride(s => {
        if (s < 10) {
            return {order: [0, 1, 2, 3, 4, 5]};
        }
        return s < 40 ? {order: [0, 1, 2], extra: [{idx: 3, dx: -18}, {idx: 4, dx: -20}, {idx: 5, dx: -22}]} :
            {order: [0, 1, 2, 3], extra: [{idx: 4, dx: -20}, {idx: 5, dx: -22}]};
    }, {selfIdx: 0, dur: 60});
    assert.deepEqual(names(at(rows, 41).st.hanging), ['Dan', 'Eve', 'Finn']);
    assert.ok(rows.some(r => r.s > 41 && r.s < 47 && r.st.cut === null), 'the cut vanishes for a while');
    for (const r of rows.filter(r => r.s >= 42)) {
        assert.deepEqual(names(r.st.hanging), ['Eve', 'Finn'], `s ${r.s}`);
        assert.deepEqual(names(r.st.line), ['Ann', 'Ben', 'Cleo', 'Dan'], `s ${r.s}`);
    }
    assert.deepEqual(at(rows, 55).st.cut, {id: ID.Eve, m: 14});
});

test('hanging: nobody hangs when I am behind the gap myself', () => {
    // Me = Eve. Dan, Eve and Finn 14 m behind Cleo from 10 s.
    const rows = ride(s => s < 10 ? {order: [0, 1, 2, 3, 4, 5]} :
        {order: [3, 4, 5], extra: [{idx: 2, dx: 16}, {idx: 1, dx: 18}, {idx: 0, dx: 20}]}, {selfIdx: 4, dur: 40});
    assert.ok(rows.some(r => r.gaps.riders[ID.Dan]?.open), 'the gap is open');
    for (const r of rows) {
        assert.deepEqual(r.st.hanging, [], `s ${r.s}`);
        assert.equal(r.st.cut, null, `s ${r.s}`);
    }
    assert.deepEqual(names(at(rows, 39).st.line), NAMES);
});


// ---------- climbs ----------

// The route profile's real hills (not rollers) over [from, to) s, else no hill here.
const hills = (spans, kind = 'climb') => s =>
    ({hill: spans.some(([a, b]) => s >= a && s < b) ? {kind, roller: false} : null});
const CLIMB = hills([[100, 300]]);

test('climb: the rotation runs normally on a real climb (next at 3 s, no display)', () => {
    const rows = ride(line([[0, 0], [1, 120], [2, 160]]), {dur: 200, terrain: CLIMB});
    assert.deepEqual(at(rows, 150).st.hill, {mode: 'pause', descent: false});
    assert.equal(at(rows, 122).owner, 'Ann');
    assert.equal(at(rows, 123).owner, 'Ben');
    assert.equal(at(rows, 123).since, 120);
    assert.equal(at(rows, 123).change, 'next');
    assert.equal(at(rows, 163).owner, 'Cleo');
    assert.equal(at(rows, 163).change, 'next');
    for (const r of rows.filter(r => r.s >= 3)) {
        assert.equal(r.st.disp, null, `s ${r.s}`);
        assert.equal(r.reason, null, `s ${r.s}`);
        assert.ok(r.v, `s ${r.s}`);
    }
});

test('trigger \'front\': a rider not the plan\'s next in front 3 s on a climb (not 20 s)', () => {
    // Dan beside Ann for 10 s on the flat: nothing. On the climb from 120: the display at 123.
    const rows = ride(line([[0, 0], [3, 40], [0, 50], [3, 120]]), {dur: 140, terrain: CLIMB});
    for (const r of rows.filter(r => r.s >= 3 && r.s < 123)) {
        assert.equal(r.owner, 'Ann', `s ${r.s}`);
        assert.equal(r.st.disp, null, `s ${r.s}`);
    }
    const r = at(rows, 123);
    assert.deepEqual(r.st.disp, {at: T0 + 123000, why: 'front', pend: null});
    assert.equal(r.change, null);
    assert.equal(r.reason, 'climb');
});

test('trigger \'gap\': an open gap of 15 m in front of a rider of the line, only on a real hill', () => {
    // Me = Ann (the owner, at my plan's 300 W). Dan, Eve and Finn 17 m behind Cleo from 120 (on the climb).
    const script = s => (s < 120 ? {order: range(6), me: {power: 300}} :
        {order: [0, 1, 2], me: {power: 300}, extra: [{idx: 3, dx: -21}, {idx: 4, dx: -23}, {idx: 5, dx: -25}]});
    const rows = ride(script, {selfIdx: 0, dur: 150, terrain: CLIMB});
    const on = rows.find(r => r.st.disp);
    // The gap state opens it (17 m held 5 s on a hill) at 126; the step of 127 reads it. Dan was in the
    // line the step started from; this step's cut hangs him.
    assert.ok(!at(rows, 125).gaps.riders[ID.Dan].open);
    assert.ok(at(rows, 126).gaps.riders[ID.Dan].open);
    assert.equal(on.s, 127);
    assert.deepEqual(on.st.disp, {at: T0 + 127000, why: 'gap', pend: null});
    assert.ok(at(rows, 126).st.line.includes(ID.Dan));
    assert.ok(on.st.hanging.includes(ID.Dan));
    assert.equal(on.owner, 'Ann');
    // Off the hill the same gap never starts the display.
    assert.ok(ride(script, {selfIdx: 0, dur: 150}).every(r => r.st.disp === null));
});

test('trigger \'gap\': not for a gap in front of a rider who is not in the line (already hanging, or never in my chain)', () => {
    // Me = Ann (the owner, at my plan's 300 W). Dan, Eve and Finn 12 m behind Cleo from 60 (open on the
    // flat: they hang from then), 17 m from 130 on the climb.
    const rows = ride(s => {
        if (s < 60) {
            return {order: range(6), me: {power: 300}};
        }
        const gap = s < 130 ? 12 : 17;
        return {order: [0, 1, 2], me: {power: 300},
                extra: [{idx: 3, dx: -4 - gap}, {idx: 4, dx: -6 - gap}, {idx: 5, dx: -8 - gap}]};
    }, {selfIdx: 0, dur: 150, terrain: CLIMB});
    assert.ok(at(rows, 99).gaps.riders[ID.Dan].open);
    assert.equal(at(rows, 131).gaps.riders[ID.Dan].m, 17);
    assert.ok(at(rows, 131).gaps.riders[ID.Dan].open);
    for (const r of rows.filter(r => r.s >= 100)) {
        assert.deepEqual(names(r.st.hanging), ['Dan', 'Eve', 'Finn'], `s ${r.s}`);
        assert.equal(r.st.disp, null, `s ${r.s}`);
    }
    // Finn 40 m behind Eve from the start (in the gap state, never within my chain's 30 m links): his
    // open gap on the climb is no trigger.
    const late = ride(() => ({order: range(5), me: {power: 300}, extra: [{idx: 5, dx: -48}]}),
                      {selfIdx: 0, dur: 150, terrain: CLIMB});
    assert.ok(at(late, 120).gaps.riders[ID.Finn].open);
    assert.ok(at(late, 120).gaps.riders[ID.Finn].m >= 15);
    assert.ok(late.every(r => !r.st.present.includes(ID.Finn)));
    assert.ok(late.every(r => r.st.disp === null));
});

test('trigger \'gap\': a gap behind a rider sitting out (in the group) that drops a rider of the line', () => {
    // Me = Ann. Dan skips Ben and Cleo on the flat (owner at 60, they sit out). On the climb from 120:
    // Dan, Cleo, Eve, me, Ben, then Finn 17 m behind Ben.
    const rows = ride(s => (s < 120 ? line([[0, 0], [3, 40]])(s) :
        {order: [3, 2, 4, 0, 1], extra: [{idx: 5, dx: -19}]}), {selfIdx: 0, dur: 150, terrain: CLIMB});
    assert.equal(at(rows, 60).change, 'skip');
    assert.deepEqual(at(rows, 125).st.out, {[ID.Ben]: true, [ID.Cleo]: true});
    // Finn's gap is a new pair from 120 (Ben ahead, no smoothing lag): open in the gap state of 125, read
    // by the step of 126.
    assert.ok(!at(rows, 124).gaps.riders[ID.Finn].open);
    const g = at(rows, 125).gaps.riders[ID.Finn];
    assert.ok(g.open && g.m >= 15);
    assert.equal(g.ahead, ID.Ben);
    const on = rows.find(r => r.st.disp);
    assert.equal(on.s, 126);
    assert.deepEqual(on.st.disp, {at: T0 + 126000, why: 'gap', pend: null});
});

test('trigger \'gap\': a rider sitting out right behind the gap, a rider of the line further back', () => {
    // Me = Ann. Dan skips Ben and Cleo on the flat (owner at 60; they sit out). Climb from 120: Dan, Eve,
    // me in front; 17 m behind me Ben (out), then Finn (in the line) and Cleo, 2 m apart.
    const rows = ride(s => (s < 120 ? line([[0, 0], [3, 40]])(s) :
        {order: [3, 4, 0], extra: [{idx: 1, dx: -19}, {idx: 5, dx: -21}, {idx: 2, dx: -23}]}),
                      {selfIdx: 0, dur: 160, terrain: CLIMB});
    assert.deepEqual(at(rows, 119).st.out, {[ID.Ben]: true, [ID.Cleo]: true});
    const g = at(rows, 126).gaps.riders[ID.Ben];
    assert.ok(g.open && g.m >= 15);
    assert.equal(g.ahead, ID.Ann);
    assert.deepEqual(names(g.behind), ['Ben', 'Finn', 'Cleo']);
    assert.ok(at(rows, 126).st.line.includes(ID.Finn));
    const on = rows.find(r => r.st.disp);
    assert.equal(on?.s, 127);
    assert.deepEqual(on.st.disp, {at: T0 + 127000, why: 'gap', pend: null});
});

test('trigger \'gap\': not for a gap ahead of the line (a rider not in the line far in front of us all)', () => {
    // Me = Ann. Finn 270 m ahead of the whole line from the start, never in my chain: the gap state's
    // open gap is keyed Ann (in the line), but the rider in front of it is Finn (not in the line).
    const rows = ride(() => ({order: range(5), me: {power: 300}, extra: [{idx: 5, dx: 270}]}),
                      {selfIdx: 0, dur: 150, terrain: CLIMB});
    const g = at(rows, 120).gaps.riders[ID.Ann];
    assert.ok(g.open && g.m >= 15);
    assert.equal(g.ahead, ID.Finn);
    assert.ok(at(rows, 120).st.line.includes(ID.Ann));
    assert.ok(rows.every(r => !r.st.present.includes(ID.Finn)));
    assert.ok(rows.every(r => r.st.disp === null));
});

test('no power trigger: the puller under 70 % of his plan watts on a climb keeps the rotation going', () => {
    // Teams level their W/kg on climbs (22 Nov 2026: the front rider at 88 % of plan watts in the median,
    // 23 % of seconds under 70 %). Ben (the next) in front from 110 at 200 W (67 %), owner at 113.
    const rows = ride(s => ({...line([[0, 0], [1, 110]])(s), power: {1: s >= 110 ? 200 : 250}}),
                      {dur: 160, terrain: CLIMB});
    assert.equal(T.CLIMB_OWNER_FRAC, undefined);
    assert.equal(T.CLIMB_OWNER_AFTER_MS, undefined);
    assert.equal(at(rows, 113).owner, 'Ben');
    for (const r of rows.filter(r => r.s >= 113)) {
        assert.equal(r.st.disp, null, `s ${r.s}`);
        assert.equal(r.owner, 'Ben', `s ${r.s}`);
        assert.ok(r.v, `s ${r.s}`);
    }
});

test('live grade: without terrain the old rule, a roller for ROLLER_LIVE_MS, then a real hill with the same triggers', () => {
    // My grade 5 % from 100: climbing after CLIMB_ENTER_MS (105), a roller until 150. Dan (not the next)
    // in front from 140: the 'front' trigger once it is a real hill.
    const rows = ride(s => ({...line([[0, 0], [3, 140]])(s), me: {grade: s >= 100 ? 5 : 0}}), {dur: 170});
    assert.deepEqual(at(rows, 104).st.hill, {mode: null, descent: false});
    for (const r of rows.filter(r => r.s >= 105 && r.s < 150)) {
        assert.deepEqual(r.st.hill, {mode: 'flag', descent: false}, `s ${r.s}`);
        assert.equal(r.st.disp, null, `s ${r.s}`);
    }
    assert.deepEqual(at(rows, 150).st.hill, {mode: 'pause', descent: false});
    assert.deepEqual(at(rows, 150).st.disp, {at: T0 + 150000, why: 'front', pend: null});
    // A short rise (5 % for 30 s) stays a roller: never a real hill, never the display; the rotation goes
    // on (Dan, in front from 110, owns after 20 s).
    const rise = ride(s => ({...line([[0, 0], [3, 110]])(s), me: {grade: s >= 100 && s < 130 ? 5 : 0}}), {dur: 200});
    assert.ok(rise.some(r => r.st.hill.mode === 'flag'));
    assert.ok(rise.every(r => r.st.hill.mode !== 'pause' && r.st.disp === null));
    assert.equal(at(rise, 130).owner, 'Dan');
});

test('during the display: reason \'climb\' (\'descent\' on a descent), no view, the leader by the plain 3 s rule, no owner change', () => {
    for (const kind of ['climb', 'descent']) {
        const rows = ride(line([[0, 0], [3, 120], [4, 140], [1, 160]]), {dur: 200, terrain: hills([[100, 300]], kind)});
        assert.equal(at(rows, 123).st.disp.why, 'front', kind);
        for (const r of rows.filter(r => r.s >= 123)) {
            assert.equal(r.reason, kind, `${kind} s ${r.s}`);
            assert.equal(r.v, null, `${kind} s ${r.s}`);
            assert.equal(r.change, null, `${kind} s ${r.s}`);
        }
        const lead = s => [at(rows, s).owner, at(rows, s).since];
        assert.deepEqual(lead(123), ['Dan', 120]);
        assert.deepEqual(lead(142), ['Dan', 120]);
        assert.deepEqual(lead(143), ['Eve', 140]);
        assert.deepEqual(lead(162), ['Eve', 140]);
        assert.deepEqual(lead(163), ['Ben', 160]);
    }
});

test('display end: not before the hill is over; before the end phase a long solo pull does not end it; the expected change does', () => {
    // Dan skips Ben and Cleo on the flat (owner at 60). Climb 100-300: Ann in front from 120 (display),
    // Ben (Ann's next) leads 250-269 on the climb, Ann again from 270 and alone for 397 s after the
    // climb, but for Dan (not her next) rolling through 400-409; Ben from 697. Then Cleo from 710, Ben
    // back from 720 (a return), Ann from 730 (a back change).
    const rows = ride(line([[0, 0], [3, 40], [0, 120], [1, 250], [0, 270], [3, 400], [0, 410], [1, 697], [2, 710],
                            [1, 720], [0, 730]]),
                      {dur: 760, terrain: CLIMB});
    assert.equal(at(rows, 60).change, 'skip');
    assert.deepEqual(at(rows, 123).st.disp, {at: T0 + 123000, why: 'front', pend: null});
    for (const r of rows.filter(r => r.s >= 123 && r.s < 700)) {
        assert.ok(r.st.disp, `s ${r.s}`);
        // ▲ while the climb lasts, the quiet 'regroup' on the flat after it (23 Nov 2026).
        assert.equal(r.reason, r.s < 300 ? 'climb' : 'regroup', `s ${r.s}`);
        assert.equal(r.change, null, `s ${r.s}`);
    }
    assert.deepEqual([at(rows, 253).owner, at(rows, 253).since], ['Ben', 250]);
    assert.equal(at(rows, 299).st.disp.pend, null);
    assert.deepEqual(at(rows, 300).st.disp.pend, {id: ID.Ann, since: T0 + 270000});
    // Dan in front 3 s is not the end (he is not Ann's next) and resets the clear puller (he is not
    // clear); Ann is clear again 20 s after she is back in front.
    assert.deepEqual(at(rows, 402).st.disp.pend, {id: ID.Ann, since: T0 + 270000});
    assert.deepEqual([at(rows, 403).owner, at(rows, 403).since], ['Dan', 400]);
    assert.equal(at(rows, 403).st.disp.pend, null);
    assert.equal(at(rows, 429).st.disp.pend, null);
    assert.deepEqual(at(rows, 430).st.disp.pend, {id: ID.Ann, since: T0 + 410000});
    assert.equal(at(rows, 699).owner, 'Ann');
    assert.deepEqual(at(rows, 699).st.out, {[ID.Cleo]: true});
    const r = at(rows, 700);
    assert.equal(r.owner, 'Ben');
    assert.equal(r.since, 697);
    assert.deepEqual(r.st.change, {kind: 'climb', from: ID.Ann, to: ID.Ben});
    assert.deepEqual(r.st.out, {});
    assert.equal(r.st.prev, null);
    assert.equal(r.st.disp, null);
    assert.deepEqual(r.st.check, {n: 0, bad: false});
    assert.equal(r.reason, null);
    assert.equal(r.v.elapsedS, 3);
    assert.deepEqual(names(r.st.line), NAMES);
    // The changes after it are checked; a return does not count. A back change before the end phase
    // settles the check but leaves the next end as it is.
    assert.deepEqual([at(rows, 713).change, at(rows, 713).st.check], ['next', {n: 1, bad: false}]);
    assert.deepEqual([at(rows, 723).change, at(rows, 723).st.check], ['return', {n: 1, bad: false}]);
    assert.equal(at(rows, 750).change, 'back');
    assert.equal(at(rows, 750).st.check, null);
    assert.equal(at(rows, 750).st.careful, false);
});

test('display end in the end phase: the clear puller alone; after a wrong end the next needs the expected change; after a right end the clear puller alone again', () => {
    // 12 m/s since the start 3000 s before T0; (1100 - s) s to go: the last 20 min throughout.
    const init = () => ({...T.initialTurns(), startAt: T0 - 3000e3});
    const script = s => ({...line([[0, 0], [3, 120], [2, 330], [0, 420], [1, 560], [2, 580], [3, 600], [0, 720]])(s),
                          me: {top: {remaining: 12 * (1100 - s), remainingMetric: 'distance', remainingType: 'event'},
                               state: {eventDistance: 12 * (3000 + s)}}});
    const rows = ride(script, {init, dur: 830, terrain: hills([[100, 300], [400, 500], [700, 800]])});
    // Climb 1: Dan in front from 120, clear when the climb is over: the display ends at 300.
    assert.equal(at(rows, 123).st.disp.why, 'front');
    assert.ok(at(rows, 299).st.disp);
    let r = at(rows, 300);
    assert.deepEqual([r.owner, r.since, r.change], ['Dan', 120, 'climb']);
    assert.equal(r.st.disp, null);
    // A wrong end: Cleo (the rider before Dan) takes over with 20 s, a back change.
    assert.deepEqual(at(rows, 349).st.check, {n: 0, bad: false});
    r = at(rows, 350);
    assert.deepEqual([r.owner, r.change], ['Cleo', 'back']);
    assert.equal(r.st.check, null);
    assert.equal(r.st.careful, true);
    // Climb 2: Ann in front from 420 is clear at 500 but alone does not end it; Ben, her next, does.
    assert.equal(at(rows, 423).st.disp.why, 'front');
    assert.deepEqual(at(rows, 500).st.disp.pend, {id: ID.Ann, since: T0 + 420000});
    for (const x of rows.filter(x => x.s >= 500 && x.s < 563)) {
        assert.ok(x.st.disp, `s ${x.s}`);
    }
    r = at(rows, 563);
    assert.deepEqual([r.owner, r.since, r.change], ['Ben', 560, 'climb']);
    assert.equal(r.st.careful, true);
    // A right end: two changes in order after it.
    assert.deepEqual([at(rows, 583).change, at(rows, 583).st.check], ['next', {n: 1, bad: false}]);
    r = at(rows, 603);
    assert.equal(r.change, 'next');
    assert.equal(r.st.check, null);
    assert.equal(r.st.careful, false);
    // Climb 3: the clear puller alone again.
    assert.equal(at(rows, 723).st.disp.why, 'front');
    assert.ok(at(rows, 799).st.disp);
    r = at(rows, 800);
    assert.deepEqual([r.owner, r.since, r.change], ['Ann', 720, 'climb']);
});

// The display after the hill (user, 23 Nov 2026: "▲ goes at the end of the climb"): Dan (neither
// the owner Ann nor her next Ben) in front on the hill from 120 turns the display on; Ann leads again
// from 290 and is clear at 310 (20 s); Ben, her next, ends it at 343.
const REGROUP = line([[0, 0], [3, 120], [0, 290], [1, 340]]);

test('after the hill: ▲ (▼) only on the hill, then the quiet \'regroup\' with no view until the end rule ends the display as before', () => {
    for (const kind of ['climb', 'descent']) {
        const rows = ride(REGROUP, {dur: 360, terrain: hills([[100, 300]], kind)});
        assert.equal(at(rows, 123).st.disp.why, 'front', kind);
        for (const r of rows.filter(r => r.s >= 123 && r.s < 300)) {
            assert.equal(r.reason, kind, `${kind} s ${r.s}`);
            assert.equal(r.v, null, `${kind} s ${r.s}`);
        }
        for (const r of rows.filter(r => r.s >= 300 && r.s < 343)) {
            assert.ok(r.st.disp, `${kind} s ${r.s}`);
            assert.equal(r.reason, 'regroup', `${kind} s ${r.s}`);
            assert.equal(r.v, null, `${kind} s ${r.s}`);
        }
        assert.equal(at(rows, 309).st.disp.pend, null, kind);
        assert.deepEqual(at(rows, 310).st.disp.pend, {id: ID.Ann, since: T0 + 290000}, kind);
        const r = at(rows, 343);
        assert.deepEqual([r.owner, r.since, r.change, r.reason], ['Ben', 340, 'climb', null], kind);
        assert.equal(r.st.disp, null, kind);
        assert.ok(r.v && !r.v.provisional, kind);
        // The recording marks the quiet part: disp as before, plus quiet.
        assert.deepEqual(T.turnDet(at(rows, 299).st).disp, {why: 'front', at: T0 + 123000}, kind);
        assert.deepEqual(T.turnDet(at(rows, 300).st).disp, {why: 'front', at: T0 + 123000, quiet: true}, kind);
        assert.equal(T.turnDet(r.st).disp, null, kind);
    }
});

test('display end: no clear puller kept over a later hill, nor while nobody is in front; the end gives him the since of his current front run', () => {
    // A time event, 1500 - s seconds to go: the end phase from 300. Dan leads on climb 1 (100-200) from
    // 120; Ann from 150 is clear when it ends, but Ben (her next) never comes before climb 2 (230-400).
    // Eve leads there 300-395, Ann from 395: off the hill the display ends only once Ann is clear again
    // (415), her clock from 395.
    const event = fronts => s => ({...line(fronts)(s),
                                   me: {top: {remaining: 1500 - s, remainingMetric: 'time', remainingType: 'event'}}});
    const rows = ride(event([[0, 0], [3, 120], [0, 150], [4, 300], [0, 395]]),
                      {dur: 430, terrain: hills([[100, 200], [230, 400]])});
    assert.deepEqual(at(rows, 229).st.disp.pend, {id: ID.Ann, since: T0 + 150000});
    for (const r of rows.filter(r => r.s >= 230 && r.s < 415)) {
        assert.ok(r.st.disp, `s ${r.s}`);
        assert.equal(r.st.disp.pend, null, `s ${r.s}`);
    }
    const r = at(rows, 415);
    assert.deepEqual([r.owner, r.since, r.change], ['Ann', 395, 'climb']);
    // Nobody in front (I ride alone 210-214): the clear puller goes; Ann back from 215 is clear at 235.
    const alone = ride(s => (s >= 210 && s < 215 ? {order: [5]} : line([[0, 0], [3, 120], [0, 150]])(s)),
                       {dur: 240, terrain: hills([[100, 200]])});
    assert.deepEqual(at(alone, 209).st.disp.pend, {id: ID.Ann, since: T0 + 150000});
    assert.equal(at(alone, 212).st.disp.pend, null);
    assert.equal(at(alone, 234).st.disp.pend, null);
    assert.deepEqual(at(alone, 235).st.disp.pend, {id: ID.Ann, since: T0 + 215000});
    // In the end phase: Ann clear from 200, Eve in front for 2 s (290-291), Ann again from 292; the end
    // at 300 counts Ann's clock from 292.
    const late = ride(event([[0, 0], [3, 120], [0, 150], [4, 290], [0, 292]]), {dur: 310, terrain: hills([[100, 200]])});
    assert.deepEqual(at(late, 299).st.disp.pend, {id: ID.Ann, since: T0 + 150000});
    assert.deepEqual([at(late, 300).owner, at(late, 300).since, at(late, 300).change], ['Ann', 292, 'climb']);
});

test('display end: the expected next of the clear puller leaves out the riders sitting out', () => {
    // Cleo skips Ben on the flat (owner at 60; Ben sits out). Climb 100-300: Eve in front from 120. After it
    // Ann leads from 290 (clear at 310); Cleo, her next without Ben, from 340 ends it at 343.
    const rows = ride(line([[0, 0], [2, 40], [4, 120], [0, 290], [2, 340], [3, 380]]), {dur: 400, terrain: CLIMB});
    assert.equal(at(rows, 60).change, 'skip');
    assert.deepEqual(at(rows, 310).st.out, {[ID.Ben]: true});
    assert.deepEqual(at(rows, 310).st.disp.pend, {id: ID.Ann, since: T0 + 290000});
    assert.ok(at(rows, 342).st.disp);
    const r = at(rows, 343);
    assert.deepEqual([r.owner, r.since, r.change], ['Cleo', 340, 'climb']);
    assert.equal(r.st.disp, null);
});

test('provisional (off by default): after the hill with a clear puller, a view as if he were the owner; none before him, none on the hill', () => {
    const plan = mkPlan();
    const rows = ride(REGROUP, {plan, dur: 360, terrain: CLIMB});
    const status = (r, opts = {}) => T.turnsStatus(r.st, {now: T0 + r.s * 1000, plan, selfId: ID.Finn, live: true, ...opts});
    for (const r of rows.filter(r => r.s >= 123 && r.s < 343)) {
        const on = status(r, {provisional: true});
        if (r.s < 300) {
            assert.deepEqual(on, {view: null, reason: 'climb'}, `on the hill, s ${r.s}`);
        } else if (r.s < 310) {
            assert.deepEqual(on, {view: null, reason: 'regroup'}, `no clear puller yet, s ${r.s}`);
        } else {
            assert.equal(on.reason, null, `s ${r.s}`);
            assert.equal(on.view.provisional, true, `s ${r.s}`);
            assert.equal(on.view.puller.id, ID.Ann, `s ${r.s}`);
            assert.equal(on.view.elapsedS, r.s - 290, `Ann's clock from when she came to the front, s ${r.s}`);
            assert.equal(on.view.mine, false, `s ${r.s}`);
            // The same view rotationView gives for Ann as the owner from 290, only marked.
            const owned = T.turnsStatus({...r.st, disp: null, front: {...r.st.front, puller: ID.Ann, since: T0 + 290000}},
                                        {now: T0 + r.s * 1000, plan, selfId: ID.Finn, live: true});
            assert.deepEqual(on.view, {...owned.view, provisional: true}, `s ${r.s}`);
        }
        // Off (the default and the mod): no view while the display is on.
        assert.equal(status(r).view, null, `s ${r.s}`);
        assert.deepEqual(status(r, {provisional: false}), status(r), `s ${r.s}`);
    }
    // After the end: the real view, not provisional.
    assert.equal(status(at(rows, 343), {provisional: true}).view.provisional, undefined);
});

test('endPhase: time events, distance over the average speed since the start, false without a start or before 60 s', () => {
    const ev = (remaining, remainingMetric, eventDistance) =>
        ({remaining, remainingMetric, remainingType: 'event', state: {eventDistance}});
    const now = T0 + 600e3;
    assert.equal(T.endPhase(ev(1200, 'time'), {now, startAt: null}), true);
    assert.equal(T.endPhase(ev(1201, 'time'), {now, startAt: null}), false);
    // 6000 m in 600 s: 10 m/s.
    assert.equal(T.endPhase(ev(12000, 'distance', 6000), {now, startAt: T0}), true);
    assert.equal(T.endPhase(ev(12010, 'distance', 6000), {now, startAt: T0}), false);
    assert.equal(T.endPhase(ev(100, 'distance', 6000), {now, startAt: null}), false);
    assert.equal(T.endPhase(ev(100, 'distance', 600), {now, startAt: now - 59e3}), false);
    assert.equal(T.endPhase(ev(100, 'distance', 600), {now, startAt: now - 60e3}), true);
    assert.equal(T.endPhase({...ev(100, 'time'), remainingType: 'route'}, {now, startAt: T0}), false);
    assert.equal(T.endPhase({remainingType: 'event', remainingMetric: 'distance', remaining: 100}, {now, startAt: T0}), false);
    assert.equal(T.endPhase(null, {now, startAt: T0}), false);
});


// ---------- alone, start, still ----------

test('alone: no tracking, the owner and his clock are kept; reason \'alone\'', () => {
    // Me = Cleo, alone from 20 to 44 (25 s; I would be my own front rider, not the plan's next).
    const rows = ride(s => s >= 20 && s < 45 ? {order: [2]} : {order: range(6)}, {selfIdx: 2, dur: 60});
    for (const r of rows.filter(r => r.s >= 20 && r.s < 45)) {
        assert.equal(r.reason, 'alone', `s ${r.s}`);
        assert.equal(r.owner, 'Ann', `s ${r.s}`);
        assert.equal(r.since, 0, `s ${r.s}`);
        assert.equal(r.change, null, `s ${r.s}`);
    }
    assert.equal(at(rows, 50).owner, 'Ann');
    assert.equal(at(rows, 50).v.elapsedS, 50);
    assert.ok(rows.every(r => r.s < 3 || r.owner === 'Ann'));
});

test('start: a roll-off after the pen sets plan #1 with the start bonus; nothing changes during the lock', () => {
    // Me = Cleo. The pen until 120 (all within 2 m, standing); Ann leads 120-129, Ben from 130.
    const rows = ride(s => ({order: s < 130 ? range(6) : [1, 0, 2, 3, 4, 5], me: {speed: s < 120 ? 0 : 42}}),
                      {selfIdx: 2, dur: 185});
    assert.ok(rows.filter(r => r.s < 120).every(r => r.owner === null && r.reason === 'still'));
    const r = at(rows, 120);
    assert.equal(r.owner, 'Ann');
    assert.equal(r.since, 120);
    assert.deepEqual(r.st.front.bonus, {id: ID.Ann, since: T0 + 120000, s: 30});
    assert.equal(r.change, 'start');
    assert.equal(r.st.locked, true);
    assert.equal(at(rows, 122).st.startFound, false);
    assert.equal(at(rows, 123).st.startFound, true);
    assert.equal(at(rows, 130).v.pullS, 60);
    // Ben in front from 130 for 50 s: nothing changes during the lock.
    for (const x of rows.filter(x => x.s > 120 && x.s < 180)) {
        assert.equal(x.owner, 'Ann', `s ${x.s}`);
        assert.equal(x.since, 120, `s ${x.s}`);
        assert.equal(x.change, null, `s ${x.s}`);
        assert.equal(x.st.locked, true, `s ${x.s}`);
    }
    assert.equal(at(rows, 180).st.locked, false);
});

test('start: the front rider is followed during the lock, so the owner after it has his real since', () => {
    // Me = Cleo, plans of 20 s. The pen until 120; Ann leads 120-154, Ben from 155 (inside the lock).
    const rows = ride(s => ({order: s < 155 ? range(6) : [1, 0, 2, 3, 4, 5], me: {speed: s < 120 ? 0 : 42}}),
                      {plan: mkPlan(6, {pullS: 20}), selfIdx: 2, dur: 200});
    assert.equal(at(rows, 179).st.locked, true);
    assert.equal(at(rows, 179).owner, 'Ann');
    assert.deepEqual(at(rows, 179).st.fr, {id: ID.Ben, since: T0 + 155000});
    // His 3 s hold counts only from the lock's end (180); his clock from 155.
    assert.equal(at(rows, 180).st.locked, false);
    assert.equal(at(rows, 182).owner, 'Ann');
    const r = at(rows, 183);
    assert.deepEqual([r.owner, r.since, r.change], ['Ben', 155, 'next']);
    assert.equal(at(rows, 190).v.elapsedS, 35);
});

test('start: time in the lock does not count toward the 3 s and 20 s holds', () => {
    // Me = Finn. The pen until 120 (lock until 180). Dan (not the next) leads 150-184, Ann back from 185:
    // Dan never owns, nobody sits out. Ben (the next) pokes ahead 172-181, Ann back from 182: no change.
    const lead = fronts => s => ({order: line(fronts)(s).order, me: {speed: s < 120 ? 0 : 42}});
    const dan = ride(lead([[0, 0], [3, 150], [0, 185]]), {dur: 230});
    for (const x of dan.filter(x => x.s >= 120)) {
        assert.equal(x.owner, 'Ann', `s ${x.s}`);
        assert.deepEqual(x.st.out, {}, `s ${x.s}`);
    }
    const ben = ride(lead([[0, 0], [1, 172], [0, 182]]), {dur: 230});
    assert.ok(ben.filter(x => x.s >= 120).every(x => x.owner === 'Ann' && x.since === 120));
});

test('still: standing resets the owner, sit-outs and the display', () => {
    // Me = Finn. Ann owns with Ben sitting out, a return pending, the display on; I stop at 10.
    const init = () => ({...T.initialTurns(), front: {...T.initialTurns().front, puller: ID.Ann, since: T0},
                         fr: {id: ID.Ann, since: T0}, out: {[ID.Ben]: true},
                         prev: {id: ID.Dan, since: T0, skipped: [ID.Ben]}, disp: {at: T0, why: 'gap', pend: null},
                         careful: true, check: {n: 0, bad: false}, soft: {id: ID.Ben, since: T0, v: true}});
    const rows = ride(s => ({order: [0, 2, 3, 4, 5, 1], me: {speed: s >= 10 && s < 20 ? 0 : 45}}), {init, dur: 30});
    assert.equal(at(rows, 14).owner, 'Ann');
    assert.deepEqual(at(rows, 14).st.out, {[ID.Ben]: true});
    const r = at(rows, 15);    // STOP_MS with a rotation running
    assert.equal(r.reason, 'still');
    assert.equal(r.owner, null);
    assert.equal(r.since, null);
    assert.deepEqual(r.st.out, {});
    assert.deepEqual(r.st.fr, {id: null, since: null});
    for (const k of ['prev', 'disp', 'check', 'soft', 'cut', 'change']) {
        assert.equal(r.st[k], null, k);
    }
    assert.equal(r.st.careful, false);
    assert.deepEqual(r.st.hanging, []);
    // Rolling on: the front rider gets a fresh clock (not the stop), and no start lock (no pen).
    assert.equal(at(rows, 22).owner, null);
    assert.equal(at(rows, 23).owner, 'Ann');
    assert.equal(at(rows, 23).since, 20);
    assert.equal(at(rows, 23).change, 'first');
    assert.equal(at(rows, 23).st.locked, false);
});


// ---------- status and plan changes ----------

test('turnsStatus: never \'chaos\'; \'nofront\' before an owner', () => {
    const rows = ride(line([[0, 0], [1, 40], [0, 80], [1, 130], [0, 170], [3, 200], [0, 240], [2, 300]]),
                      {dur: 340});
    const kinds = new Set(rows.map(r => r.change).filter(Boolean));
    assert.ok(kinds.has('back') && kinds.has('skip'), [...kinds].join());
    assert.deepEqual([...new Set(rows.map(r => r.reason))], ['nofront', null]);
    assert.ok(rows.filter(r => r.s < 3).every(r => r.reason === 'nofront' && r.v === null));
    assert.deepEqual(T.turnsStatus(T.initialTurns(), {now: T0, plan: mkPlan(), selfId: ID.Finn, live: true}),
                     {view: null, reason: 'alone'});
});

test('carryTurns: keeps the owner and his since when he is in the new plan, else starts over keeping the start', () => {
    const base = T.initialTurns();
    const st = {...base, front: {...base.front, puller: ID.Ann, since: T0, pending: {id: ID.Finn, at: T0},
                                 ignore: {id: ID.Finn, at: T0}},
                out: {[ID.Ben]: true, [ID.Finn]: true}, hanging: [ID.Eve, ID.Finn],
                prev: {id: ID.Finn, since: T0, skipped: [ID.Ben]}, seen: {[ID.Ann]: T0, [ID.Finn]: T0},
                present: [ID.Ann, ID.Finn], line: [ID.Ann, ID.Finn], disp: {at: T0, why: 'gap', pend: {id: ID.Finn, since: T0}},
                climb: {...initialClimb(), climbing: true, since: T0}, hill: {mode: 'pause', descent: false},
                rolledAt: T0, startAt: T0};
    const five = {...mkPlan(), riders: mkPlan().riders.slice(0, 5)};
    const c = T.carryTurns(st, five);
    assert.equal(c.front.puller, ID.Ann);
    assert.equal(c.front.since, T0);
    assert.equal(c.front.pending, null);
    assert.equal(c.front.ignore, null);
    assert.deepEqual(c.out, {[ID.Ben]: true});
    assert.deepEqual(c.hanging, [ID.Eve]);
    assert.equal(c.prev, null);
    assert.deepEqual(c.seen, {[ID.Ann]: T0});
    assert.deepEqual(c.present, [ID.Ann]);
    assert.deepEqual(c.line, [ID.Ann]);
    assert.deepEqual(c.disp, {at: T0, why: 'gap', pend: null});
    assert.equal(c.climb, st.climb);
    // A last owner still in the plan is kept, without the riders who left.
    const p = T.carryTurns({...st, prev: {id: ID.Ben, since: T0, skipped: [ID.Cleo, ID.Finn]}}, five).prev;
    assert.deepEqual(p, {id: ID.Ben, since: T0, skipped: [ID.Cleo]});
    // The owner left the plan (or no plan): start over, keeping the climb, the hill and the start.
    const fresh = {...T.initialTurns(), climb: st.climb, hill: st.hill, rolledAt: T0, startAt: T0};
    assert.deepEqual(T.carryTurns(st, {...mkPlan(), riders: mkPlan().riders.slice(1)}), fresh);
    assert.deepEqual(T.carryTurns(st, null), fresh);
});

test('clearMs: half the plan pull, at least 20 s; 20 s for a rider not in the plan', () => {
    assert.equal(T.clearMs(mkPlan(), ID.Ann), 20000);
    assert.equal(T.clearMs(mkPlan(6, {pullS: 60}), ID.Ann), 30000);
    assert.equal(T.clearMs(mkPlan(), '999'), 20000);
});


// ---------- table and det ----------

// A hand-made state: the owner, who is in the group, who hangs and who sits out.
const tableState = ({owner = null, present = Object.values(ID), hanging = [], out = {}, cut = null} = {}) =>
    ({...T.initialTurns(), front: {...T.initialTurns().front, puller: owner}, present, hanging, out, cut});
const view = rows => rows.map(r => `${r.number}${r.rider.name[0]}${r.pulling ? '*' : ''}:${r.state}${r.gapM !== null ? '@' + r.gapM : ''}`);

test('turnTable: plan order from the owner; out and hanging riders in their slots with their state; the first hanging row has the gap metres; gone last', () => {
    const plan = mkPlan();
    // Cleo owns; Dan and Eve hang 14 m back (Eve is also gone: gone wins), Ben sits out, Finn is away.
    const st = tableState({owner: ID.Cleo, present: [ID.Ann, ID.Ben, ID.Cleo, ID.Dan], hanging: [ID.Dan, ID.Eve],
                           out: {[ID.Ben]: true}, cut: {id: ID.Dan, m: 14}});
    const rows = T.turnTable(plan, {st, started: true});
    assert.deepEqual(view(rows), ['3C*:line', '4D:hanging@14', '1A:line', '2B:out', '5E:gone', '6F:gone']);
    assert.deepEqual(rows.map(r => r.present), [true, true, true, true, false, false]);
    assert.deepEqual(rows.map(r => r.rider), [2, 3, 0, 1, 4, 5].map(i => plan.riders[i]));
    // The gap sits on the first hanging row in table order, whichever rider that is.
    const st2 = tableState({owner: ID.Dan, hanging: [ID.Ann, ID.Eve], cut: {id: ID.Eve, m: 22}});
    assert.deepEqual(view(T.turnTable(plan, {st: st2, started: true})),
                     ['4D*:line', '5E:hanging@22', '6F:line', '1A:hanging', '2B:line', '3C:line']);
    // No gap state: the hanging row has none. The owner is never gone, nor does he hang as 'gone'.
    const st3 = tableState({owner: ID.Eve, present: [ID.Ann], hanging: [ID.Ann]});
    assert.deepEqual(view(T.turnTable(plan, {st: st3, started: true})),
                     ['5E*:line', '1A:hanging', '2B:gone', '3C:gone', '4D:gone', '6F:gone']);
    // Without an owner the table starts at #1, gone riders still last in plan order.
    const st4 = tableState({present: [ID.Ben, ID.Dan]});
    assert.deepEqual(view(T.turnTable(plan, {st: st4, started: true})),
                     ['2B:line', '4D:line', '1A:gone', '3C:gone', '5E:gone', '6F:gone']);
});

test('turnTable: a hanging owner keeps the clock row, so the gap goes to the next hanging rider', () => {
    const plan = mkPlan();
    // Cleo owns and is cut off behind the gap herself (she fell back); Eve hangs too. Row 0 shows her
    // clock in the windows, so the gap metres sit on Eve's row, the first hanging row after her.
    const st = tableState({owner: ID.Cleo, hanging: [ID.Cleo, ID.Eve], cut: {id: ID.Cleo, m: 17}});
    assert.deepEqual(view(T.turnTable(plan, {st, started: true})),
                     ['3C*:hanging', '4D:line', '5E:hanging@17', '6F:line', '1A:line', '2B:line']);
    // Only the owner hangs: no row carries the gap (the gap warning shows it).
    const st2 = tableState({owner: ID.Cleo, hanging: [ID.Cleo], cut: {id: ID.Cleo, m: 17}});
    assert.ok(T.turnTable(plan, {st: st2, started: true}).every(r => r.gapM === null));
});

test('turnTable: my own row is never gone, also without me in present (my data stopped)', () => {
    const plan = mkPlan();
    // Finn (me) is not in present: without selfId he would be gone, with it he stays in the line.
    const st = tableState({owner: ID.Ann, present: [ID.Ann, ID.Ben, ID.Cleo]});
    assert.deepEqual(view(T.turnTable(plan, {st, started: true})),
                     ['1A*:line', '2B:line', '3C:line', '4D:gone', '5E:gone', '6F:gone']);
    assert.deepEqual(view(T.turnTable(plan, {st, started: true, selfId: ID.Finn})),
                     ['1A*:line', '2B:line', '3C:line', '6F:line', '4D:gone', '5E:gone']);
});

test('turnTable: before the start everyone is in the line', () => {
    const plan = mkPlan();
    const st = tableState({owner: ID.Cleo, present: [ID.Ann], hanging: [ID.Dan], out: {[ID.Ben]: true},
                           cut: {id: ID.Dan, m: 14}});
    const rows = T.turnTable(plan, {st, started: false});
    assert.deepEqual(view(rows), ['3C*:line', '4D:line', '5E:line', '6F:line', '1A:line', '2B:line']);
    assert.ok(rows.every(r => r.present && r.gapM === null));
    assert.deepEqual(T.turnTable(null, {st, started: true}), []);
});

test('turnDet: the change only in its step; disp with its trigger; hanging and out', () => {
    const rows = ride(line([[0, 0], [1, 40]]), {dur: 50});
    assert.deepEqual(T.turnDet(at(rows, 43).st).change, {kind: 'next', from: ID.Ann, to: ID.Ben});
    assert.equal(T.turnDet(at(rows, 44).st).change, null);
    assert.equal(T.turnDet(at(rows, 3).st).change.kind, 'first');
    assert.deepEqual(T.turnDet(at(rows, 3).st).change, {kind: 'first', from: null, to: ID.Ann});
    // disp keeps its trigger and time, not its pending end; hanging and out are copies.
    // On the hill (a real one): no quiet mark.
    const st = {...T.initialTurns(), disp: {at: T0, why: 'gap', pend: {id: ID.Ben, since: T0}},
                hanging: [ID.Dan, ID.Eve], out: {[ID.Ben]: true, [ID.Cleo]: true}, hill: {mode: 'pause', descent: false}};
    const d = T.turnDet(st);
    assert.deepEqual(d, {change: null, disp: {why: 'gap', at: T0}, hanging: [ID.Dan, ID.Eve], out: [ID.Ben, ID.Cleo]});
    d.hanging.push('x');
    assert.deepEqual(st.hanging, [ID.Dan, ID.Eve]);
    // After it (no hill, or a roller), the display still on: quiet.
    for (const mode of [null, 'flag']) {
        assert.deepEqual(T.turnDet({...st, hill: {mode, descent: false}}).disp, {why: 'gap', at: T0, quiet: true}, String(mode));
    }
    assert.deepEqual(T.turnDet(T.initialTurns()), {change: null, disp: null, hanging: [], out: []});
});

test('turns.mjs is smaller than the logic it replaces (at most 500 lines)', () => {
    const src = readFileSync(new URL('../pages/src/engine/turns.mjs', import.meta.url), 'utf8');
    assert.ok(src.split('\n').length - 1 <= 500, `${src.split('\n').length - 1} lines`);
});
