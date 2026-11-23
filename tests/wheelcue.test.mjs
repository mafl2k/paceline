import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../pages/src/engine/wheelcue.mjs';

const plan = {riders: ['a', 'b', 'c', 'd', 'e'].map(id => ({id}))};

// Steps every second from `from` to `to`; input(t) gives the step's fields. Returns the state, the
// shown id and its kind per second.
function run(input, {from = 0, to, st = C.initialCue()} = {}) {
    const shown = {}, kind = {};
    for (let t = from; t <= to; t += 1000) {
        st = C.cueStep(st, {now: t, active: true, pulling: false, obsId: null, ...input(t)});
        const v = C.cueView(st, t);
        shown[t] = v ? v.id : null;
        kind[t] = v ? v.kind : null;
    }
    return {st, shown, kind};
}

// A ride that started at 0 and where the start cue ended at once (I was on my wheel 'b').
function settled(input, to) {
    return run(t => ({startAt: 0, wheelId: 'b', obsId: 'b', ...(t >= 5000 ? input(t) : {})}), {to});
}


test('dropWheel: the rider before me in plan order who is with the group', () => {
    assert.equal(C.dropWheel(plan, {selfId: 'c', presentIds: ['a', 'b', 'c', 'd', 'e']}).id, 'b');
    assert.equal(C.dropWheel(plan, {selfId: 'c', presentIds: ['a', 'c', 'd']}).id, 'a');    // b dropped
    assert.equal(C.dropWheel(plan, {selfId: 'a', presentIds: ['a', 'b', 'c']}).id, 'c');    // d, e dropped
    assert.equal(C.dropWheel(plan, {selfId: 'a', presentIds: ['a']}), null);
    assert.equal(C.dropWheel(plan, {selfId: 'x', presentIds: ['a']}), null);
    assert.equal(C.dropWheel(null, {selfId: 'a', presentIds: []}), null);
});


test('start: shown from the roll-off until I am on my wheel for CUE_ON_MS', () => {
    const {shown, kind} = run(t => ({startAt: 0, wheelId: 'b', obsId: t < 20000 ? 'd' : 'b'}), {to: 40000});
    assert.equal(shown[0], 'b');
    assert.equal(kind[0], 'start');
    assert.equal(shown[20000 + C.CUE_ON_MS - 1000], 'b');
    assert.equal(shown[20000 + C.CUE_ON_MS], null);
    assert.equal(shown[40000], null);
});


test('start: at most CUE_START_MS, ends with my first pull, none for the start puller', () => {
    let r = run(() => ({startAt: 0, wheelId: 'b', obsId: 'd'}), {to: 100000});
    assert.equal(r.shown[C.CUE_START_MS - 1000], 'b');
    assert.equal(r.shown[C.CUE_START_MS], null);
    // A moment on the wheel shorter than CUE_ON_MS does not end it.
    r = run(t => ({startAt: 0, wheelId: 'b', obsId: t === 15000 ? 'b' : 'd'}), {to: 20000});
    assert.equal(r.shown[20000], 'b');
    r = run(t => ({startAt: 0, wheelId: 'b', obsId: 'd', pulling: t >= 30000}), {to: 40000});
    assert.equal(r.shown[29000], 'b');
    assert.equal(r.shown[30000], null);
    assert.equal(r.shown[40000], null);
    r = run(() => ({startAt: 0, startPuller: true, wheelId: 'e', obsId: null}), {to: 5000});
    assert.equal(r.shown[0], null);
    // The wheel shown follows who is with the group (b missing in the pen: a).
    r = run(t => ({startAt: 0, wheelId: t < 3000 ? 'b' : 'a', obsId: 'd'}), {to: 5000});
    assert.equal(r.shown[5000], 'a');
});


test('no cue after a normal pull', () => {
    const {shown} = settled(t => ({pulling: t >= 100000 && t < 130000, wheelId: 'b', obsId: t < 150000 ? 'd' : 'b'}), 200000);
    for (let t = 5000; t <= 200000; t += 1000) {
        assert.equal(shown[t], null, `t=${t}`);
    }
});


test('a change: shown for CUE_CHANGE_MS once it has held for CUE_SETTLE_MS', () => {
    const {shown, kind} = settled(t => ({wheelId: t < 60000 ? 'b' : 'a', obsId: 'a'}), 100000);
    assert.equal(shown[60000 + C.CUE_SETTLE_MS - 1000], null);
    assert.equal(shown[60000 + C.CUE_SETTLE_MS], 'a');
    assert.equal(kind[60000 + C.CUE_SETTLE_MS], 'change');
    assert.equal(shown[60000 + C.CUE_SETTLE_MS + C.CUE_CHANGE_MS - 1000], 'a');
    assert.equal(shown[60000 + C.CUE_SETTLE_MS + C.CUE_CHANGE_MS], null);
});


test('a flapping rider never shows; a second change in a cue shows the new wheel without starting over', () => {
    let r = settled(t => ({wheelId: Math.floor(t / 2000) % 2 ? 'a' : 'b'}), 120000);
    assert.ok(Object.entries(r.shown).every(([t, v]) => t < 5000 || v === null));
    // a at 60 s (shown from 63 s), b back at 70 s (settled 73 s): the cue shows b until 78 s, then
    // nothing; a again at 100 s: a new cue at 103 s (CUE_REARM_MS after 63 s has passed).
    r = settled(t => ({wheelId: t < 60000 ? 'b' : t < 70000 ? 'a' : t < 100000 ? 'b' : 'a'}), 130000);
    assert.equal(r.shown[65000], 'a');
    assert.equal(r.shown[73000], 'b');
    assert.equal(r.shown[78000], null);
    assert.equal(r.shown[103000], 'a');
    // Within CUE_REARM_MS a change waits: a at 60 s (63 s), gone at 80 s, c at 81 s waits until 93 s.
    r = settled(t => ({wheelId: t < 60000 ? 'b' : t < 81000 ? 'a' : 'c'}), 110000);
    assert.equal(r.shown[84000], null);
    assert.equal(r.shown[63000 + C.CUE_REARM_MS], 'c');
});


test('no change cue in the first CUE_CALM_MS, nor during my pull (it shows after it)', () => {
    let r = settled(t => ({wheelId: t < 20000 ? 'b' : 'a', obsId: 'a'}), 80000);
    assert.ok(Object.entries(r.shown).every(([t, v]) => t < 5000 || v === null));
    r = settled(t => ({pulling: t >= 60000 && t < 90000, wheelId: t < 70000 ? 'b' : 'a'}), 100000);
    assert.equal(r.shown[80000], null);
    assert.equal(r.shown[90000], 'a');
});


test('opened mid-ride: the first wheel is no change; inactive hides but keeps the wheel', () => {
    let r = run(t => ({wheelId: t < 10000 ? 'b' : 'a'}), {to: 20000});
    assert.equal(r.shown[5000], null);
    assert.equal(r.shown[13000], 'a');
    let st = settled(t => ({wheelId: t < 60000 ? 'b' : 'a'}), 64000).st;
    assert.equal(C.cueView(st, 64000).id, 'a');
    st = C.cueStep(st, {now: 65000, active: false, pulling: false, wheelId: 'a', obsId: null});
    assert.equal(C.cueView(st, 65000), null);
    // Back active with the same wheel: no new change.
    st = C.cueStep(st, {now: 120000, active: true, startAt: 0, pulling: false, wheelId: 'a', obsId: null});
    assert.equal(C.cueView(st, 120000), null);
    assert.equal(C.cueView(null, 0), null);
});


test('freshIds: riders seen in my chain within CUE_FRESH_MS', () => {
    const seen = {a: 10000, b: 10000 - C.CUE_FRESH_MS + 1000, c: 10000 - C.CUE_FRESH_MS};
    assert.deepEqual(C.freshIds(seen, 10000), ['a', 'b']);
    assert.deepEqual(C.freshIds(null, 0), []);
});


test('linePlace: the place in the line from the puller, riders with the group only, without me', () => {
    const all = ['a', 'b', 'c', 'd', 'e'];
    // b pulls; c, d, e, a follow: d is 3rd.
    assert.equal(C.linePlace(plan, {pullerId: 'b', selfId: 'a', id: 'd', presentIds: all}), 3);
    // c dropped: d is 2nd.
    assert.equal(C.linePlace(plan, {pullerId: 'b', selfId: 'a', id: 'd', presentIds: ['a', 'b', 'd', 'e']}), 2);
    // I still pull (a): the line I drop back into starts behind me.
    assert.equal(C.linePlace(plan, {pullerId: 'a', selfId: 'a', id: 'c', presentIds: all}), 2);
    assert.equal(C.linePlace(plan, {pullerId: 'b', selfId: 'a', id: 'c', presentIds: ['a', 'b']}), null);
    assert.equal(C.linePlace(null, {pullerId: 'b', selfId: 'a', id: 'c', presentIds: all}), null);
});
