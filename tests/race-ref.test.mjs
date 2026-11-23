// Run with: node --test tests/race-ref.test.mjs
// The race reference (tools/race-ref): the core on hand-built views, the input on the ride report's
// made-up recording (tests/fixtures/ride-report/make.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReference, DRAFT_PROXY_W, TRAFFIC_BEFORE_S} from '../tools/race-ref/reference.mjs';
import {riderFigures} from '../tools/race-ref/riders.mjs';
import {viewsOf} from '../tools/race-ref/input.mjs';
import {runEngine} from '../tools/race-ref/engines.mjs';
import {score, run as scoreRun} from '../tools/race-ref/score.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {parseArgs, run} from '../tools/race-ref/race-ref.mjs';
import {renderMarkdown} from '../tools/race-ref/render.mjs';
import {analyse} from '../tools/ride-report/analyse.mjs';
import {fileURLToPath} from 'node:url';
import * as M from './fixtures/ride-report/make.mjs';

const P2 = [{sig: 'P2TEST', text: JSON.stringify(M.PLAN2)}];

// Hand-built input. fronts: per view a list of [who, from, to] (seconds, inclusive; a view has no
// vote where nothing is listed). positions(s, view): [[k, x], ...] per second, default everybody
// in one line, 2 m apart, riding at 10 m/s; null = no frame. alt(s): [dist, alt] of view 0 (others
// get the same), default flat. The race lasts N - 1 seconds.
function mkViews({n = 4, N, fronts, positions, alt}) {
    const views = fronts.map((spec, i) => {
        const front = new Int32Array(N);
        for (const [who, from, to] of spec) {
            front.fill(who, from, to + 1);
        }
        const frames = [];
        const dist = new Float64Array(N);
        const al = new Float64Array(N);
        for (let s = 0; s < N; s++) {
            const rows = positions ? positions(s, i) : Array.from({length: n}, (_, k) => [k + 1, 10 * s - 2 * k]);
            frames.push(rows ? {pos: rows.map(([k, x]) => ({k, x, age: 0})), power: {}} : null);
            [dist[s], al[s]] = alt ? alt(s) : [10 * s, 10];
        }
        return {self: 2, front, frames, dist, alt: al, traffic: null, gaps: null};
    });
    return {t0: 0, tEnd: (N - 1) * 1000, N, raceS: N - 1, n, ids: ['a', 'b', 'c', 'd', 'e'].slice(0, n),
            planS: [0, ...Array(n).fill(30)], planW: [0, ...Array(n).fill(300)], views};
}
const brief = ref => ref.turns.map(t => [t.who, t.start, t.end, t.kind]);


test('fused front: agreeing views give one front, a disagreement is -1 and lowers agreement', () => {
    const ref = buildReference(mkViews({N: 60, fronts: [[[1, 0, 29], [2, 30, 59]], [[1, 0, 29], [2, 30, 59], [3, 40, 42]]]}));
    assert.equal(ref.front[10], 1);
    assert.equal(ref.front[35], 2);
    assert.deepEqual(ref.front.slice(39, 44), [2, -1, -1, -1, 2]);
    assert.equal(ref.agreement, 57 / 60);
    // The 3 s hole is bridged: still one turn of #2, and the unknown seconds are not a turn.
    assert.deepEqual(brief(ref), [[1, 0, 29, 'first'], [2, 30, 59, 'next']]);
    assert.equal(ref.turns[1].s, 30);
});


test('one view has no agreement to report', () => {
    const ref = buildReference(mkViews({N: 60, fronts: [[[1, 0, 29], [2, 30, 59]]]}));
    assert.equal(ref.agreement, null);
    assert.deepEqual(ref.selfPos, [2]);
});


test('a late view does not vote where it has no data', () => {
    const ref = buildReference(mkViews({N: 60, fronts: [[[1, 0, 29], [2, 30, 59]], [[1, 20, 29], [2, 30, 59]]]}));
    assert.equal(ref.front[10], 1, 'view A alone decides before view B starts');
    assert.equal(ref.front[25], 1);
    assert.equal(ref.agreement, 1, 'only seconds with two votes count');
});


test('turns: under 8 s is no turn, same rider within 60 s is merged', () => {
    const ref = buildReference(mkViews({N: 100, fronts: [[[1, 0, 29], [2, 30, 35], [1, 36, 70]]]}));
    assert.deepEqual(ref.raw.map(t => [t.who, t.start, t.end]), [[1, 0, 70]], '6 s of #2 is no turn');
    assert.deepEqual(brief(ref), [[1, 0, 70, 'first']]);
    // A hole of 4 s inside a turn is bridged, one of 5 s is not (and 6 s runs are no turns).
    const bridged = buildReference(mkViews({N: 100, fronts: [[[1, 0, 5], [1, 10, 15]]]}));
    assert.deepEqual(bridged.raw.map(t => [t.who, t.start, t.end]), [[1, 0, 15]]);
    const open = buildReference(mkViews({N: 100, fronts: [[[1, 0, 5], [1, 11, 16]]]}));
    assert.deepEqual(open.raw, []);
    // The same rider after more than 60 s is another turn.
    const far = buildReference(mkViews({N: 200, fronts: [[[2, 0, 29], [2, 100, 129]]]}));
    assert.deepEqual(far.raw.map(t => [t.who, t.start, t.end, t.kind]), [[2, 0, 29, 'first'], [2, 100, 129, 'same']]);
});


test('interjection: a short non-next turn between a next change is dropped and listed', () => {
    const ref = buildReference(mkViews({N: 100, fronts: [[[1, 0, 29], [3, 30, 41], [2, 42, 71]]]}));
    assert.deepEqual(ref.raw.map(t => [t.who, t.start, t.end]), [[1, 0, 29], [3, 30, 41], [2, 42, 71]]);
    assert.deepEqual(ref.interjections, [{who: 3, at: 30, s: 12, between: [1, 2], w: null, wPlan: 300, ownerW: null, ownerPlanW: 300}]);
    assert.deepEqual(brief(ref), [[1, 0, 41, 'first'], [2, 42, 71, 'next']], 'turn 1 runs on to the end of #3');
    assert.equal(ref.turns[0].s, 42);
});


test('interjection: a short turn inside one rider\'s turn is dropped and the two parts are joined', () => {
    const ref = buildReference(mkViews({N: 100, fronts: [[[2, 0, 24], [4, 25, 34], [2, 35, 54]]]}));
    // The 60 s merge only joins consecutive turns of one rider: raw keeps the three.
    assert.deepEqual(ref.raw.map(t => [t.who, t.start, t.end]), [[2, 0, 24], [4, 25, 34], [2, 35, 54]]);
    assert.deepEqual(brief(ref), [[2, 0, 54, 'first']]);
    assert.deepEqual(ref.interjections, [{who: 4, at: 25, s: 10, between: [2, 2], w: null, wPlan: 300, ownerW: null, ownerPlanW: 300}]);
});


test('a short turn that is the next in line is a change, not an interjection', () => {
    const ref = buildReference(mkViews({N: 100, fronts: [[[1, 0, 29], [2, 30, 41], [3, 42, 71]]]}));
    assert.deepEqual(ref.interjections, []);
    assert.equal(ref.turns.length, 3);
});


test('classes: next, back in a line of 3+, skip marks the passed riders as sitting out until they pull, same', () => {
    const back = buildReference(mkViews({N: 100, fronts: [[[1, 0, 29], [2, 30, 59], [1, 60, 89]]]}));
    assert.deepEqual(brief(back), [[1, 0, 29, 'first'], [2, 30, 59, 'next'], [1, 60, 89, 'back']]);
    assert.equal(back.turns[2].lineN, 4);
    // 1 -> 3 passes #2, who then sits out: 3 -> 1 is a back in the line 1, 3, 4, not a skip in 1..4.
    const skip = buildReference(mkViews({N: 100, fronts: [[[1, 0, 29], [3, 30, 59], [1, 60, 89]]]}));
    assert.deepEqual(brief(skip), [[1, 0, 29, 'first'], [3, 30, 59, 'skip'], [1, 60, 89, 'back']]);
    assert.deepEqual(skip.turns[1].skipped, [2]);
    assert.equal(skip.turns[2].lineN, 3);
    assert.equal(skip.turns[1].from, 1);
    // Once #2 pulls he is back in the line.
    const again = buildReference(mkViews({N: 160, fronts: [[[1, 0, 29], [3, 30, 59], [2, 60, 89], [3, 90, 119]]]}));
    assert.deepEqual(again.turns.map(t => [t.who, t.kind, t.lineN]),
                     [[1, 'first', undefined], [3, 'skip', 4], [2, 'back', 4], [3, 'next', 4]]);
    // The same rider again after more than 60 s.
    const same = buildReference(mkViews({N: 200, fronts: [[[2, 0, 29], [2, 100, 129]]]}));
    assert.equal(same.turns[1].kind, 'same');
    // Plan numbers and power ride along.
    assert.deepEqual([back.turns[1].planS, back.turns[1].planW, back.turns[1].w], [30, 300, null]);
});


test('group: largest cluster with gaps <= 30 m; dropped after 30 s outside, back after 30 s inside; drops lists both', () => {
    const positions = s => Array.from({length: 4}, (_, k) => [k + 1, 10 * s - 2 * k - (k === 3 && s >= 60 && s < 100 ? 50 : 0) -
        (k === 2 && s >= 20 && s < 40 ? 50 : 0)]);
    const ref = buildReference(mkViews({N: 200, fronts: [[[1, 0, 199]]], positions}));
    // #4 is 50 m behind for 40 s: gone from the start of that run, back from the start of his return.
    assert.deepEqual(ref.drops, [{who: 4, at: 60, state: 'gone'}, {who: 4, at: 100, state: 'back'}]);
    assert.equal(ref.present[4][59], 1);
    assert.equal(ref.present[4][60], 0);
    assert.equal(ref.present[4][99], 0);
    assert.equal(ref.present[4][100], 1);
    assert.equal(ref.present[4][199], 1);
    // #3 was out for 20 s only: no drop.
    assert.ok(ref.present[3].every(x => x === 1));
    assert.deepEqual(ref.present[0].slice(0, 3), [0, 0, 0]);
});


test('group: old data does not count for the group', () => {
    const N = 100;
    const views = mkViews({N, fronts: [[[1, 0, 99]]]});
    // #4's rows are 11 s old from second 40 on: he is out of the group (30 s later: gone).
    for (let s = 40; s < N; s++) {
        views.views[0].frames[s].pos.find(p => p.k === 4).age = 11000;
    }
    const ref = buildReference(views);
    assert.deepEqual(ref.drops, [{who: 4, at: 40, state: 'gone'}]);
});


test('a rider never seen is gone from the start without flapping', () => {
    const positions = s => [1, 2, 3].map(k => [k, 10 * s - 2 * k]);
    const ref = buildReference(mkViews({N: 100, fronts: [[[1, 0, 99]]], positions}));
    assert.deepEqual(ref.drops, [{who: 4, at: 0, state: 'gone'}]);
    assert.ok(ref.present[4].every(x => x === 0));
    assert.ok(ref.present[1].every(x => x === 1));
});


test('context: start, end, climb windows from altitude; afterClimb until two in-order changes after the climb', () => {
    // 10 m/s; a 1.2 km climb at 4 % from second 300 (120 s), flat before and after.
    const N = 1800;
    const alt = s => [10 * s, 100 + (s <= 300 ? 0 : s <= 420 ? 0.4 * (s - 300) : 48)];
    const cycle = [];
    for (let i = 0; 30 * i < N; i++) {
        cycle.push([i % 4 + 1, 30 * i, Math.min(30 * i + 29, N - 1)]);
    }
    const ref = buildReference(mkViews({N, fronts: [cycle], alt}));
    assert.equal(ref.hills.length, 1);
    const h = ref.hills[0];
    assert.ok(h.start >= 325 && h.start <= 340, `climb starts at ${h.start}`);
    assert.ok(h.end >= 430 && h.end <= 445, `climb ends at ${h.end}`);
    assert.equal(h.climbEnd, h.end);
    assert.ok(h.gain >= 30 && h.gain <= 50, `gain ${h.gain}`);
    assert.equal(h.fromKm, +(h.start * 10 / 1000).toFixed(1));
    assert.equal(h.descentOnly, undefined);
    assert.equal(ref.ctx[100], 'start');
    assert.equal(ref.ctx[119], 'start');
    assert.equal(ref.ctx[120], 'flat');
    assert.equal(ref.ctx[200], 'flat');
    assert.equal(ref.ctx[350], 'climb');
    assert.equal(ref.ctx[h.end], 'climb');
    assert.equal(ref.ctx[h.end + 1], 'flat');
    assert.equal(ref.ctx[N - 100], 'end');
    assert.equal(ref.ctx[ref.raceS - 1200], 'end');
    assert.equal(ref.ctx[ref.raceS - 1201], 'flat');
    // Changes after the climb: the 3rd and 4th next ones (turns start every 30 s): flag from just
    // after the window to the start of the second change after it.
    const later = ref.turns.filter(t => t.start > h.end);
    assert.ok(later[1].start > later[0].start);
    assert.equal(ref.afterClimb[h.end], 0);
    assert.equal(ref.afterClimb[h.end + 1], 1);
    assert.equal(ref.afterClimb[later[1].start - 1], 1);
    assert.equal(ref.afterClimb[later[1].start], 0);
    assert.equal(ref.afterClimb[100], 0);
    assert.equal(ref.afterClimb.reduce((a, b) => a + b, 0), later[1].start - h.end - 1);
    // afterClimb does not change ctx.
    assert.equal(ref.ctx[h.end + 1], 'flat');
});


test('hills: a recorder without rows in the first seconds still finds the climb', () => {
    const N = 1800;
    const ramp = s => [10 * s, 100 + (s <= 300 ? 0 : s <= 420 ? 0.4 * (s - 300) : 48)];
    const want = buildReference(mkViews({N, fronts: [[[1, 0, 29]]], alt: ramp})).hills;
    assert.equal(want.length, 1);
    for (const gap of [1, 10]) {
        const alt = s => (s < gap ? [NaN, NaN] : ramp(s));
        const ref = buildReference(mkViews({N, fronts: [[[1, 0, 29]]], alt}));
        assert.deepEqual(ref.hills, want, `${gap} s without rows`);
        assert.equal(ref.ctx[350], 'climb');
    }
});


// Two views with the same frames; view 0 (listed first) is flat, view 1 has a 4 % climb of 1.2 km from second 300.
function twoTerrains({N = 1800, positions} = {}) {
    const v = mkViews({N, fronts: [[[1, 0, 29]], [[1, 0, 29]]], positions});
    v.views[0].self = 3;
    v.views[1].self = 2;
    for (let s = 0; s < N; s++) {
        v.views[0].dist[s] = 10 * s;
        v.views[0].alt[s] = 100;
        v.views[1].dist[s] = 10 * s;
        v.views[1].alt[s] = 100 + (s <= 300 ? 0 : s <= 420 ? 0.4 * (s - 300) : 48);
    }
    return v;
}


test('hills: the terrain comes from the view whose recorder was in the group longest, not from the first view', () => {
    // #3 (the first view's recorder) is 60 m behind from 100 on: out of the group for good, riding alone on
    // flat ground; #2's view has the climb. A choice of the first view finds no hill.
    const positions = s => Array.from({length: 4}, (_, k) => [k + 1, 10 * s - 2 * k - (k === 2 && s >= 100 ? 60 : 0)]);
    const v = twoTerrains({positions});
    const ref = buildReference(v);
    assert.equal(ref.present[3][1000], 0, 'the first view\'s recorder is gone');
    assert.equal(ref.present[2][1000], 1);
    assert.equal(ref.hills.length, 1, 'the climb of the view that stayed in the group');
    assert.equal(ref.ctx[350], 'climb');
});


test('hills: the same group time, the view with more seconds of distance data wins; equal, the first', () => {
    const v = twoTerrains();
    // The first view has rows only from second 400 (late start): its distance is NaN before.
    for (let s = 0; s < 400; s++) {
        v.views[0].dist[s] = NaN;
        v.views[0].alt[s] = NaN;
    }
    assert.equal(buildReference(v).hills.length, 1, 'view 1 has the data');
    // Equal everywhere: the first view is used.
    const same = twoTerrains();
    assert.equal(buildReference(same).hills.length, 0, 'ties go to the first view (flat)');
});


test('afterClimb: a change back does not count as an in-order change', () => {
    const N = 1800;
    const alt = s => [10 * s, 100 + (s <= 300 ? 0 : s <= 420 ? 0.4 * (s - 300) : 48)];
    const cycle = [];
    for (let i = 0; i < 14; i++) {
        cycle.push([i % 4 + 1, 30 * i, 30 * i + 29]);
    }
    // 420: #3, 450: #2 (back), 480: #3 (next), 510: #4 (next), then on in order.
    cycle.push([3, 420, 449], [2, 450, 479], [3, 480, 509], [4, 510, 539]);
    for (let i = 18; 30 * i < N; i++) {
        cycle.push([(i + 1) % 4 + 1, 30 * i, Math.min(30 * i + 29, N - 1)]);
    }
    const ref = buildReference(mkViews({N, fronts: [cycle], alt}));
    const h = ref.hills[0];
    assert.deepEqual(ref.turns.filter(t => t.start >= 420 && t.start <= 510).map(t => [t.who, t.kind]),
                     [[3, 'next'], [2, 'back'], [3, 'next'], [4, 'next']]);
    assert.equal(ref.afterClimb[509], 1);
    assert.equal(ref.afterClimb[510], 0);
    assert.equal(ref.afterClimb[h.end + 1], 1);
});


test('label: the running turn\'s kind per second, none before the first', () => {
    const ref = buildReference(mkViews({N: 100, fronts: [[[1, 10, 29], [2, 30, 59]]]}));
    assert.equal(ref.label[5], 'none');
    assert.equal(ref.label[10], 'first');
    assert.equal(ref.label[40], 'next');
    assert.equal(ref.label[98], 'next', 'the last turn runs to the end of the race');
});


test('turn power: median over the views from 5 s in', () => {
    const N = 60;
    const v = mkViews({N, fronts: [[[1, 0, 29], [2, 30, 59]], [[1, 0, 29], [2, 30, 59]]]});
    for (const view of v.views) {
        view.frames.forEach((f, s) => {
            f.power = {2: s < 35 ? 999 : 250 + (s % 2) * 10};
        });
    }
    const ref = buildReference(v);
    assert.equal(ref.turns[1].w, 260, 'the first 5 s of the turn (999) are left out');
    assert.equal(ref.turns[0].w, null, '#1 has no power rows');
});


test('viewsOf: the ride report fixture gives the views', () => {
    const input = viewsOf([{text: M.makeRecording()}], {plans: P2});
    assert.equal(input.n, 5);
    assert.ok(input.N > 470, `N ${input.N}`);
    assert.equal(input.raceS, input.N - 1);
    assert.equal(input.t0, M.T0 + M.PEN_S * 1000);
    assert.deepEqual(input.ids, [M.IDS.alma, M.IDS.bert, M.IDS.cleo, M.IDS.dora, M.IDS.emil]);
    assert.deepEqual(input.planS, [0, 30, 30, 30, 40, 30]);
    assert.deepEqual(input.planW, [0, 300, 300, 300, 300, 300]);
    assert.equal(input.views.length, 1);
    const v = input.views[0];
    assert.equal(v.self, 2);
    assert.equal(v.front.length, input.N);
    assert.equal(v.front[10], 1, 'Alma (#1) leads the first 30 s');
    assert.equal(v.front[40], 2, 'Bert (#2, the recorder) the next 30 s');
    assert.equal(v.traffic.length, input.N);
    assert.deepEqual(v.traffic[100], {ahead: false, inLine: null}, 'no traffic array: the proxy answers (the front rider has no draft)');
    assert.deepEqual(v.gaps.map(g => g.k), [4], 'Dora\'s real gap, as plan position 4');
    // Frames: plan riders only (Benno, the bench rider, is not one), power of the rows.
    const fr = v.frames[10];
    assert.deepEqual(fr.pos.map(p => p.k).sort(), [1, 2, 3, 4]);
    assert.ok(fr.pos.every(p => Number.isFinite(p.x) && p.age >= 0));
    assert.deepEqual(Object.keys(fr.power).sort(), ['1', '2', '3', '4']);
    assert.ok(Math.abs(v.dist[100] - 100 * M.SPEED / 3.6) < 40, `dist ${v.dist[100]}`);
    assert.equal(v.alt[100], 10);
    // The core runs on it: a plain rotation of 30 s turns, one per plan position.
    const ref = buildReference(input);
    assert.deepEqual(ref.turns.slice(0, 4).map(t => [t.who, t.kind]), [[1, 'first'], [2, 'next'], [3, 'next'], [4, 'next']]);
    assert.equal(ref.agreement, null);
    assert.deepEqual(ref.selfPos, [2]);
});


test('viewsOf: two recordings are two views on one clock', () => {
    const text = M.makeRecording();
    const input = viewsOf([{text}, {text}], {plans: P2});
    assert.equal(input.views.length, 2);
    const ref = buildReference(input);
    assert.equal(ref.agreement, 1);
    assert.equal(ref.front[10], 1);
});


// A recording whose ticks carry traffic (as the ride report's tests build it): fn(raceSecond, tick)
// gives a tick's traffic (undefined: none). The plan riders carry inPlan, as the recorder writes it.
function withTraffic(fn, {edit = null, drop = () => false} = {}) {
    return M.makeRecording().trim().split('\n').flatMap((l, i) => {
        if (i === 0) {
            return [l];
        }
        const t = JSON.parse(l);
        const s = Math.round((t.ts - M.T0) / 1000) - M.PEN_S;
        if (drop(s)) {
            return [];
        }
        for (const r of t.riders) {
            if (Object.values(M.IDS).slice(0, 5).includes(r.id)) {
                r.inPlan = true;
            }
        }
        const traffic = fn(s, t);
        if (traffic !== undefined) {
            t.traffic = traffic;
            t.trafficEpoch = 1;
        }
        edit?.(s, t);
        return [JSON.stringify(t)];
    }).join('\n') + '\n';
}
const trafficRow = (gap, n = 1) => ({n, gap, speed: 44, power: 250, draft: 90, sg: false});
const planGaps = t => t.riders.filter(r => Object.values(M.IDS).slice(0, 4).includes(r.id)).map(r => r.gapDistance);
const tr = (ahead, inLine) => ({ahead, inLine});


test('traffic: a row ahead of the group\'s front marks ahead, one between front and rear marks inLine', () => {
    const text = withTraffic((s, t) => {
        if (s >= 1 && s <= 10) {
            return [trafficRow(-30)];
        }
        if (s >= 11 && s <= 15) {
            const g = planGaps(t);
            return [trafficRow(Math.round((Math.min(...g) + Math.max(...g)) / 2))];
        }
        if (s >= 21 && s <= 25) {
            return [trafficRow(50)];
        }
        return s >= 16 && s <= 20 ? [] : undefined;
    });
    const v = viewsOf([{text}], {plans: P2}).views[0];
    assert.equal(v.traffic.length, v.front.length);
    assert.deepEqual(v.traffic.slice(1, 11), Array(10).fill(tr(true, false)));
    assert.deepEqual(v.traffic.slice(11, 16), Array(5).fill(tr(false, true)));
    assert.deepEqual(v.traffic.slice(16, 21), Array(5).fill(tr(false, false)), 'an empty traffic array: none');
    assert.deepEqual(v.traffic.slice(21, 26), Array(5).fill(tr(false, false)), 'a rider behind the team is neither');
});


test('traffic proxy: no traffic array, the front team rider\'s draft above 30 W gives ahead true, inLine null', () => {
    assert.equal(DRAFT_PROXY_W, 30);
    const frontDraft = w => (s, t) => {
        if (w[s] === undefined) {
            return;
        }
        const plan = t.riders.filter(r => Object.values(M.IDS).slice(0, 4).includes(r.id));
        plan.sort((a, b) => a.gapDistance - b.gapDistance)[0].draft = w[s];
    };
    const w = {};
    for (let s = 5; s <= 9; s++) {
        w[s] = 40;
    }
    for (let s = 10; s <= 12; s++) {
        w[s] = 30;
    }
    const v = viewsOf([{text: withTraffic(() => undefined, {edit: frontDraft(w), drop: s => s >= 30 && s <= 32})}],
                      {plans: P2}).views[0];
    assert.deepEqual(v.traffic.slice(4, 5), [tr(false, null)], 'the front rider rides without draft');
    assert.deepEqual(v.traffic.slice(5, 10), Array(5).fill(tr(true, null)));
    assert.deepEqual(v.traffic.slice(10, 13), Array(3).fill(tr(false, null)), '30 W is not above the limit');
    assert.deepEqual(v.traffic.slice(30, 33), [null, null, null], 'no tick that second: no data');
    assert.deepEqual(v.traffic.slice(33, 34), [tr(false, null)]);
});


test('viewsOf: a view\'s real gaps come from the ride report as plan positions in race seconds', () => {
    const v = viewsOf([{text: M.makeRecording()}], {plans: P2}).views[0];
    // Dora (#4 in the last plan) falls 15 m behind for 12 s at +362 s; the full-draft gap at +125 s
    // is no real gap.
    assert.equal(v.gaps.length, 1);
    const g = v.gaps[0];
    assert.deepEqual(Object.keys(g).sort(), ['at', 'k', 'm', 's']);
    assert.equal(g.k, 4);
    assert.ok(g.at >= M.GAP_AT_S && g.at <= M.GAP_AT_S + 2, `at ${g.at}`);
    assert.ok(g.s >= 11 && g.s <= 13, `s ${g.s}`);
    assert.equal(g.m, 17, '15 m back plus the 2 m of the line');
});


test('traffic fused: true if any view says true, false if one knows and none says true, else null', () => {
    const v = mkViews({N: 6, fronts: [[[1, 0, 5]], [[1, 0, 5]], [[1, 0, 5]]]});
    const col = [
        // [view A, view B, view C] per second: null, or [ahead, inLine]
        [null, null, null],
        [[false, null], null, null],
        [[false, null], [true, false], null],
        [[false, false], [false, null], null],
        [[false, null], [false, null], null],
        [[true, true], [false, false], [false, null]],
    ];
    v.views.forEach((view, i) => {
        view.traffic = col.map(c => (c[i] ? {ahead: c[i][0], inLine: c[i][1]} : null));
    });
    const ref = buildReference(v);
    assert.deepEqual(ref.traffic, [tr(null, null), tr(false, null), tr(true, false), tr(false, false),
                                   tr(false, null), tr(true, true)]);
    // No view with traffic at all: unknown everywhere.
    const none = buildReference(mkViews({N: 3, fronts: [[[1, 0, 2]]]}));
    assert.deepEqual(none.traffic, [tr(null, null), tr(null, null), tr(null, null)]);
});


test('traffic fused: a view counts only while its recorder is in the group (never for a recorder outside the plan)', () => {
    // #3 is 50 m behind from 60 to 139: out of the group from 60 until his return at 140.
    const positions = s => Array.from({length: 4}, (_, k) => [k + 1, 10 * s - 2 * k - (k === 2 && s >= 60 && s < 140 ? 50 : 0)]);
    const v = mkViews({N: 200, fronts: [[[1, 0, 199]], [[1, 0, 199]], [[1, 0, 199]]], positions});
    v.views[0].self = 2;
    v.views[1].self = 3;
    v.views[2].self = 0;
    const seen = {ahead: true, inLine: false};
    v.views[1].traffic = Array.from({length: 200}, () => seen);
    v.views[2].traffic = Array.from({length: 200}, () => seen);
    const ref = buildReference(v);
    assert.equal(ref.present[3][59], 1);
    assert.equal(ref.present[3][60], 0);
    assert.equal(ref.present[3][139], 0);
    assert.equal(ref.present[3][140], 1);
    for (const s of [0, 59, 140, 199]) {
        assert.deepEqual(ref.traffic[s], tr(true, false), `second ${s}: recorder #3 is in the group`);
    }
    for (const s of [60, 100, 139]) {
        assert.deepEqual(ref.traffic[s], tr(null, null), `second ${s}: recorder #3 is out, the view that is in the group knows nothing`);
    }
    // A view that is in the group but says false still counts as knowing while the other is out.
    v.views[0].traffic = Array.from({length: 200}, () => ({ahead: false, inLine: false}));
    assert.deepEqual(buildReference(v).traffic[100], tr(false, false));
});


test('marks: a back change with traffic 20 s before is traffic, one with none in 30 s is team', () => {
    assert.equal(TRAFFIC_BEFORE_S, 30);
    // 1 -> 2 next, 2 -> 1 back (60), 1 -> 2 next, 2 -> 3 next, 3 -> 2 back (150), 2 -> 3 next.
    const fronts = [[[1, 0, 29], [2, 30, 59], [1, 60, 89], [2, 90, 119], [3, 120, 149], [2, 150, 179], [3, 180, 209]]];
    const v = mkViews({N: 210, fronts});
    v.views[0].traffic = Array.from({length: 210}, () => tr(false, false));
    v.views[0].traffic[40] = tr(true, false);          // 20 s before the back change at 60
    v.views[0].traffic[119] = tr(false, true);         // 31 s before the back change at 150
    const ref = buildReference(v);
    assert.deepEqual(brief(ref).filter(t => t[3] === 'back').map(t => t[1]), [60, 150]);
    assert.deepEqual(ref.marks, [
        {type: 'back', at: 60, cause: 'traffic'}, {type: 'disorder', at: 60, cause: 'traffic'},
        {type: 'back', at: 150, cause: 'team'}, {type: 'disorder', at: 150, cause: 'team'},
    ]);
    // Exactly 30 s before counts, and an inLine row counts too.
    v.views[0].traffic[119] = tr(false, false);
    v.views[0].traffic[120] = tr(false, true);
    assert.deepEqual(buildReference(v).marks.filter(m => m.at === 150).map(m => m.cause), ['traffic', 'traffic']);
    // Without traffic data at all (views without traffic): team.
    assert.deepEqual(buildReference(mkViews({N: 210, fronts})).marks.map(m => m.cause), ['team', 'team', 'team', 'team']);
});


test('marks: an interjection is marked with its cause, a disorder is a run of back seconds', () => {
    // #3 for 12 s between #1 and #2 (interjection at 30), then #2 next, back to #1 (72), a skip
    // over #2 to #3 (102) and back to #1 in the line without #2 (132).
    const v = mkViews({N: 240, fronts: [[[1, 0, 29], [3, 30, 41], [2, 42, 71], [1, 72, 101], [3, 102, 131], [1, 132, 161]]]});
    v.views[0].traffic = Array.from({length: 240}, () => tr(false, false));
    v.views[0].traffic[20] = tr(true, false);          // 10 s before the interjection at 30
    const ref = buildReference(v);
    assert.deepEqual(brief(ref).map(t => t[3]), ['first', 'next', 'back', 'skip', 'back']);
    assert.deepEqual(ref.marks, [
        {type: 'interjection', at: 30, cause: 'traffic'},
        {type: 'back', at: 72, cause: 'team'}, {type: 'disorder', at: 72, cause: 'team'},
        {type: 'back', at: 132, cause: 'team'}, {type: 'disorder', at: 132, cause: 'team'},
    ]);
});


test('countdown: the owner\'s plan pull minus his elapsed time plus the pulls and allowances between, in line order', () => {
    // Line 1-2-3-4, plan pulls 30 s, #1 pulls 0-29.
    const ref = buildReference(mkViews({N: 120, fronts: [[[1, 0, 29], [2, 30, 59], [3, 60, 89], [4, 90, 119]]]}));
    const cd = ref.countdown;
    assert.equal(cd.length, 5);
    assert.ok(cd.every(a => a.length === 120));
    assert.ok(cd[0].every(x => x === null));
    // 10 s into #1's turn: #2 waits the rest of the pull, #3 adds #2's pull and the allowance after
    // the owner, #4 also #3's pull and the allowance after #2.
    assert.equal(cd[2][10], 30 - 10);
    assert.equal(cd[3][10], (30 + 10 - 10) + 30);
    assert.equal(cd[4][10], (30 + 10 - 10) + (30 + 10) + 30);
    assert.equal(cd[1][10], null, 'null for the owner himself');
    // Second turn: #2 leads, #1 is the last in the line.
    assert.equal(cd[1][40], (30 + 10 - 10) + (30 + 10) + 30);
    assert.equal(cd[3][40], 30 - 10);
});


test('countdown: the owner part never goes below -3 s; null where no turn runs and for riders out of the group', () => {
    // #1 rides on for 60 s against a plan of 30: at 50 s his part is 30 - 50 = -20, held at -3.
    const ref = buildReference(mkViews({N: 140, fronts: [[[1, 0, 59], [2, 70, 99]]]}));
    assert.equal(ref.countdown[2][50], -3);
    assert.equal(ref.countdown[3][50], -3 + 30, 'the pull of #2 comes on top');
    assert.equal(ref.countdown[2][65], null, 'between two turns no turn runs');
    assert.equal(ref.countdown[3][65], null);
    assert.equal(ref.countdown[3][120], null, 'after the last turn');
    // #3 never in the group: his countdown is null, and the line closes up without him.
    const positions = s => Array.from({length: 4}, (_, k) => [k + 1, 10 * s - 2 * k - (k === 2 ? 50 : 0)]);
    const out = buildReference(mkViews({N: 60, fronts: [[[1, 0, 59]]], positions}));
    assert.ok(out.countdown[3].every(x => x === null));
    assert.equal(out.countdown[4][10], (30 + 10 - 10) + 30, 'only #2 between #1 and #4');
    assert.equal(out.countdown[2][10], 20);
});


test('countdown: riders who sit out after a skip are not in the line until they pull; the owner and k always are', () => {
    // Fronts 1, 3 (skipping #2), 4, 1, 2, 3, 4, 1: #2 sits out from the skip until his own turn at 120.
    const fronts = [1, 3, 4, 1, 2, 3, 4, 1].map((k, i) => [k, 30 * i, 30 * i + 29]);
    const ref = buildReference(mkViews({N: 260, fronts: [fronts]}));
    assert.deepEqual(ref.turns.map(t => t.kind), ['first', 'skip', 'next', 'next', 'next', 'next', 'next', 'next']);
    assert.deepEqual(ref.turns[1].skipped, [2]);
    // #4 leads (60-89), 10 s in. #3 follows #1 in a line without #2: #4's rest (30 + 10 - 10) and #1's pull.
    // (With #2 in the line it was 100.)
    assert.equal(ref.countdown[3][70], (30 + 10 - 10) + 30);
    // #2 himself is always in the line (owner #4, #1, then #2), and #1 is right after the owner.
    assert.equal(ref.countdown[2][70], (30 + 10 - 10) + 30);
    assert.equal(ref.countdown[1][70], 30 - 10);
    // #1 leads (90-119), 10 s in, #2 still sits out: #3 is next in the line (30 - 10, no one between).
    assert.equal(ref.countdown[3][100], 30 - 10);
    assert.equal(ref.countdown[4][100], (30 + 10 - 10) + 30, 'only #3 between #1 and #4');
    // #2 has pulled (120-149): back in the line. #1 leads again (210-239): #2 lies between #1 and #3.
    assert.equal(ref.countdown[3][220], (30 + 10 - 10) + 30);
});


test('countdown: the allowance after a plan pull of more than 40 s is 5 s, the owner\'s and that of the riders between', () => {
    const v = mkViews({N: 120, fronts: [[[1, 0, 49], [2, 50, 99], [3, 100, 119]]]});
    v.planS[1] = 50;
    v.planS[2] = 50;
    const ref = buildReference(v);
    // Owner #1 (plan 50 s, allowance 5 after him), 0 s in: #3 has #2 between (last: no allowance after him).
    assert.equal(ref.countdown[3][0], (50 + 5) + 50);
    // #4 has #2 (50 + 5) and #3 (30, last) between.
    assert.equal(ref.countdown[4][0], (50 + 5) + (50 + 5) + 30);
});


// Four riders, a plan pull of 30 s each, with: #2's turns of 30 (at 30, a start-context turn), 40,
// 30 and 36 s; an interjection of #4 inside #3's turn at 190; #1 passing #3 over #2 at 526; #3 out of the
// group 700-799 (gone, then back); #4 out from 1000 for good; power of #2 at 330 W; real gaps.
function figuresInput() {
    const fronts = [[1, 0, 29], [2, 30, 59], [3, 60, 89], [4, 90, 119],
                    [1, 120, 149], [2, 150, 189], [3, 190, 199], [4, 200, 211], [3, 212, 219], [4, 220, 249],
                    [1, 250, 279], [2, 280, 309], [3, 310, 339], [4, 340, 369],
                    [1, 370, 399], [2, 400, 435], [3, 436, 465], [4, 466, 495],
                    [1, 496, 525], [3, 526, 555], [4, 556, 585], [1, 586, 1999]];
    const positions = s => Array.from({length: 4}, (_, k) => [k + 1, 10 * s - 2 * k - (k === 2 && s >= 700 && s < 800 ? 50 : 0) -
        (k === 3 && s >= 1000 ? 50 : 0)]);
    const input = mkViews({N: 2000, fronts: [fronts, fronts], positions});
    for (const view of input.views) {
        view.frames.forEach(f => {
            f.power = {2: 330};
        });
    }
    input.views[0].gaps = [{k: 3, at: 100, s: 12, m: 14}, {k: 3, at: 300, s: 8, m: 9}, {k: 2, at: 50, s: 6, m: 7}];
    input.views[1].gaps = [{k: 3, at: 105, s: 14, m: 16}, {k: 3, at: 130, s: 5, m: 11}];
    return input;
}


test('riderFigures: turns, flat turns, median length over plan, power over plan, group share, goneAt, satOut, interjections', () => {
    const input = figuresInput();
    const ref = buildReference(input);
    const F = riderFigures(ref, input);
    assert.deepEqual(F.map(f => f.k), [1, 2, 3, 4]);
    const f2 = F[1];
    assert.equal(f2.turns, 4);
    assert.equal(f2.flatTurns, 3, 'the turn at 30 is start context');
    assert.equal(f2.medS, 36, 'the upper median of 30, 30, 36, 40');
    assert.equal(f2.medOverPlanFlatS, 6, 'flat turns 40, 30, 36 s against a plan of 30 s: 10, 0, 6');
    assert.equal(f2.medWkgVsPlan, 330 / 300);
    assert.equal(f2.satOut, 1, '#2 was passed over once (526)');
    assert.equal(f2.interjections, 0);
    assert.equal(f2.groupShare, 1);
    assert.equal(f2.goneAt, null);
    assert.deepEqual(f2.gaps, [{at: 50, s: 6, m: 7}]);
    assert.equal(F[0].medWkgVsPlan, null, 'no power rows');
    // #3: out of the group 700-799 and back: not gone. #4: gone from 1000, for good.
    assert.equal(F[2].goneAt, null);
    assert.equal(F[2].groupShare, 1900 / 2000);
    assert.equal(F[3].goneAt, 1000);
    assert.equal(F[3].groupShare, 1000 / 2000);
    assert.equal(F[3].interjections, 1);
    assert.equal(F[3].turns, 5, '90, 220, 340, 466 and 556; the interjection at 200 is no clean turn');
    assert.equal(F[0].interjections, 0);
    // Gaps of all views, merged when the next starts within 15 s of the last second of the one
    // before: 100-111 and 105-118 overlap, 130 is 12 s after 118; 300 stays alone.
    assert.deepEqual(F[2].gaps, [{at: 100, s: 35, m: 16}, {at: 300, s: 8, m: 9}]);
});


test('riderFigures: a rider who never pulled has no medians, a rider never seen is gone from the start', () => {
    const input = mkViews({N: 100, fronts: [[[1, 0, 99]]], positions: s => [1, 2, 3].map(k => [k, 10 * s - 2 * k])});
    const F = riderFigures(buildReference(input), input);
    assert.deepEqual([F[0].turns, F[0].medS], [1, 100]);
    assert.deepEqual([F[3].turns, F[3].flatTurns, F[3].medS, F[3].medOverPlanFlatS, F[3].medWkgVsPlan], [0, 0, null, null, null]);
    assert.equal(F[3].goneAt, 0, 'never seen: gone from the start');
    assert.equal(F[3].groupShare, 0);
    assert.deepEqual(F[3].gaps, []);
});


// ---------------------------------------------------------------- engines and scoring (Task 3)

// A hand-made reference for score(): turns (who, start, end, kind), ctx and label per second
// (default flat / the turn's kind), present (default everybody always), no countdown, no traffic.
function mkRef({N = 100, n = 3, turns, ctx, label, present, countdown, traffic}) {
    const lab = new Array(N).fill('none');
    turns.forEach((t, i) => {
        for (let s = t.start; s < (turns[i + 1]?.start ?? N); s++) {
            lab[s] = t.kind;
        }
    });
    return {n, N, raceS: N - 1, turns, ctx: ctx ?? new Array(N).fill('flat'), label: label ?? lab,
            present: present ?? Array.from({length: n + 1}, (_, k) => new Array(N).fill(k ? 1 : 0)),
            countdown: countdown ?? Array.from({length: n + 1}, () => new Array(N).fill(null)),
            traffic: traffic ?? Array.from({length: N}, () => ({ahead: null, inLine: null}))};
}
// An engine's output for N seconds: everything quiet, then what a test sets.
function mkOut(N, set = {}) {
    return {pul: new Array(N).fill(0), toMy: new Array(N).fill(null), mine: new Array(N).fill(0), el: new Array(N).fill(null),
            disp: new Array(N).fill(0), below: new Array(N).fill(null), chaos: new Array(N).fill(0), ...set};
}
const fill = (a, who, from, to) => {
    for (let s = from; s <= to; s++) {
        a[s] = who;
    }
    return a;
};
const T2 = [{who: 1, start: 0, end: 49, kind: 'first'}, {who: 2, start: 50, end: 99, kind: 'next'}];


test('score: puller right counts from 5 s into each reference turn, flat and rest separately', () => {
    const ctx = new Array(100).fill('flat');
    fill(ctx, 'climb', 70, 99);
    const ref = mkRef({turns: T2, ctx});
    const pul = new Array(100).fill(0);
    fill(pul, 1, 5, 49);
    fill(pul, 2, 55, 99);
    fill(pul, 3, 0, 4);       // the first 5 s of a turn are the change: not counted
    fill(pul, 3, 50, 54);
    fill(pul, 3, 20, 24);     // 5 wrong on the flat
    fill(pul, 0, 70, 79);     // 10 of the 30 climb seconds without a puller
    const sc = score(ref, mkOut(100, {pul}), {me: 2});
    assert.equal(sc.pullerFlat, 91.7, '55 of 60 flat seconds (45 + 15)');
    assert.equal(sc.pullerRest, 66.7, '20 of 30 climb seconds');
    // A run of 5 wrong seconds is no stall.
    assert.equal(sc.stalls, 0);
});


test('score: a stall is 11+ s of a wrong shown puller inside one turn', () => {
    const ref = mkRef({turns: T2});
    const run = (a, b, wrong = 3) => score(ref, mkOut(100, {pul: fill(fill(new Array(100).fill(0), 1, 0, 49), wrong, a, b)}), {me: 2}).stalls;
    assert.equal(run(10, 19), 0, '10 s is no stall');
    assert.equal(run(10, 20), 1, '11 s is');
    assert.equal(run(10, 40), 1, 'a long run counts once');
    assert.equal(run(10, 20, 0), 0, 'no puller shown is no wrong puller');
    const two = fill(fill(fill(new Array(100).fill(0), 1, 0, 49), 3, 2, 12), 3, 30, 40);
    assert.equal(score(ref, mkOut(100, {pul: two}), {me: 2}).stalls, 2, 'two runs in one turn');
    // A run across the change: 6 s in turn 1 and 6 s in turn 2 are two short runs, no stall.
    const across = fill(fill(new Array(100).fill(0), 1, 0, 43), 3, 44, 55);
    fill(across, 2, 56, 99);
    assert.equal(score(ref, mkOut(100, {pul: across}), {me: 2}).stalls, 0);
});


test('score: restarts of my clock inside my turn (el drops by more than 10)', () => {
    const ref = mkRef({turns: T2});
    const el = new Array(100).fill(null);
    const mine = new Array(100).fill(0);
    for (let s = 50; s < 100; s++) {
        mine[s] = 1;
        el[s] = s < 70 ? s - 50 : s < 85 ? s - 65 : s - 76;   // 19 -> 5 at +70 (drop 14); 19 -> 9 at +85 (drop 10)
    }
    const sc = score(ref, mkOut(100, {el, mine}), {me: 2});
    assert.equal(sc.restarts, 1, 'only the drop of 14 counts, not the drop of exactly 10');
    assert.equal(sc.restartsAt, '+0:01:10');
    assert.equal(sc.lostS, 0);
    // Seconds inside my turn (from 5 s in) without mine are lost; those with the display on too.
    mine.fill(0, 60, 64);
    const disp = fill(new Array(100).fill(0), 1, 62, 70);
    const lost = score(ref, mkOut(100, {el, mine, disp}), {me: 2});
    assert.equal(lost.lostS, 4);
    assert.equal(lost.lostDisp, 2);
    // Another rider's turn has no restarts of mine.
    assert.equal(score(ref, mkOut(100, {el, mine}), {me: 1}).restarts, 0);
});


test('score: belowIn counts riders in the reference group shown below the line, only while I am in the group', () => {
    const N = 300;
    const present = Array.from({length: 4}, (_, k) => new Array(N).fill(k ? 1 : 0));
    fill(present[3], 0, 0, N - 1);        // #3 is never in the group
    fill(present[1], 0, 200, 229);        // I (#1) am out of the group for 30 s
    const ref = mkRef({N, n: 3, turns: [{who: 2, start: 0, end: N - 1, kind: 'first'}], present});
    const below = new Array(N).fill(null);
    fill(below, [2, 3], 130, 139);        // #2 in the group: 10 s counted; #3 is not
    fill(below, [2], 100, 105);           // before s = 120: not counted
    fill(below, [2], 200, 220);           // I am not in the group: not counted
    const sc = score(ref, mkOut(N, {below}), {me: 1});
    assert.equal(sc.belowIn, 10);
    // Flicker: a shown-below episode under 30 s of a rider who is in the group, #2 here (130-139);
    // #3's episode is not in the group, so no flicker.
    assert.equal(sc.flick, 1);
    // Two episodes of #2 apart by more than 2 s are two flickers.
    fill(below, [2], 150, 155);
    assert.equal(score(ref, mkOut(N, {below}), {me: 1}).flick, 2);
    // An episode of 30 s or more is no flicker.
    fill(below, [2], 150, 190);
    assert.equal(score(ref, mkOut(N, {below}), {me: 1}).flick, 1);
});


test('score: displayEnds marks a wrong end when a back change follows within two changes', () => {
    const turns = [{who: 1, start: 0, end: 59, kind: 'first'}, {who: 2, start: 60, end: 119, kind: 'next'},
                   {who: 1, start: 120, end: 179, kind: 'back'}, {who: 2, start: 180, end: 239, kind: 'next'},
                   {who: 3, start: 240, end: 299, kind: 'next'}, {who: 1, start: 300, end: 359, kind: 'next'},
                   {who: 2, start: 360, end: 419, kind: 'next'}, {who: 3, start: 420, end: 479, kind: 'next'}];
    const ref = mkRef({N: 480, turns});
    const disp = new Array(480).fill(0);
    fill(disp, 1, 20, 100);     // ends at 100: the next changes are 120 (back) and 180
    fill(disp, 1, 190, 230);    // ends at 230: the next changes are 240 and 300, both in order
    const ends = score(ref, mkOut(480, {disp}), {me: 1}).displayEnds;
    assert.equal(ends.length, 2);
    assert.deepEqual(ends[0], {start: 20, end: 100, refReturn: 180, wrongEnd: true});
    // Two in-order changes in a row after the start of the second episode: 240 and 300.
    assert.deepEqual(ends[1], {start: 190, end: 230, refReturn: 240, wrongEnd: false});
    // A back change in the third place after the end is outside the two: not wrong.
    const later = mkRef({N: 480, turns: turns.map((t, i) => (i === 6 ? {...t, kind: 'back'} : t))});
    const d2 = fill(new Array(480).fill(0), 1, 190, 230);
    assert.equal(score(later, mkOut(480, {disp: d2}), {me: 1}).displayEnds[0].wrongEnd, false);
    // An episode that runs to the end of the race has nothing after it.
    const d3 = fill(new Array(480).fill(0), 1, 450, 479);
    assert.deepEqual(score(ref, mkOut(480, {disp: d3}), {me: 1}).displayEnds, [{start: 450, end: 479, refReturn: null, wrongEnd: false}]);
});


test('score: chaosInOrder, dispFlatOk, dispHill, cdJumps and the countdown against the reference', () => {
    const N = 200;
    const ctx = fill(new Array(N).fill('flat'), 'climb', 100, 149);
    const turns = [{who: 1, start: 0, end: 79, kind: 'first'}, {who: 2, start: 80, end: 139, kind: 'next'},
                   {who: 1, start: 140, end: 199, kind: 'back'}];
    const countdown = Array.from({length: 4}, () => new Array(N).fill(null));
    for (let s = 0; s < 80; s++) {
        countdown[2][s] = 80 - s;           // the reference countdown of #2 to his turn at 80
    }
    const ref = mkRef({N, turns, ctx, countdown});
    const chaos = fill(new Array(N).fill(0), 1, 10, 19);      // the reference is in order: 10 s counted
    fill(chaos, 1, 150, 159);                                  // the reference label is back: not counted
    const disp = fill(new Array(N).fill(0), 1, 30, 39);       // flat, in order
    fill(disp, 1, 100, 109);                                   // climb
    // My countdown runs 1 s per s from 10 s above the reference, with steps of -9 (no jump) at 50,
    // +25 (jump) at 60 and -10 (jump, with the 1 s run -11) at 70.
    const toMy = new Array(N).fill(null);
    for (let s = 20; s < 80; s++) {
        toMy[s] = 90 - s + (s >= 50 ? -8 : 0) + (s >= 60 ? 25 : 0) + (s >= 70 ? -10 : 0);
    }
    const mine = fill(new Array(N).fill(0), 1, 80, 139);
    const sc = score(ref, mkOut(N, {chaos, disp, toMy, mine}), {me: 2});
    assert.equal(sc.chaosInOrder, 10);
    assert.equal(sc.dispFlatOk, 10);
    assert.equal(sc.dispHill, 10);
    assert.equal(sc.hillS, 50);
    assert.equal(sc.cdJumps, 2, 'the +24 and the -11; the step of -9 is no jump');
    // 60, 30 and 10 s before my turn at 80 (s = 20, 50, 70): errors 10, 2 and 17, the median 10.
    assert.equal(sc.cdN, 3);
    assert.equal(sc.cdVsRef, 10);
    // While it is mine, steps are no jumps.
    assert.equal(score(ref, mkOut(N, {toMy, mine: new Array(N).fill(1)}), {me: 2}).cdJumps, 0);
});


test('score: byCause counts the turns after traffic and the others separately', () => {
    const N = 300;
    const turns = [{who: 1, start: 0, end: 99, kind: 'first'}, {who: 2, start: 100, end: 199, kind: 'next'},
                   {who: 1, start: 200, end: 299, kind: 'next'}];
    const traffic = Array.from({length: N}, () => ({ahead: false, inLine: null}));
    traffic[80] = {ahead: true, inLine: false};          // 20 s before the second turn: traffic
    traffic[160] = {ahead: false, inLine: true};         // in the second turn, 40 s before the third: not within 30 s
    const ref = mkRef({N, n: 2, turns, traffic});
    const pul = new Array(N).fill(0);
    fill(pul, 1, 5, 99);
    fill(pul, 2, 105, 199);
    fill(pul, 1, 205, 299);
    fill(pul, 2, 110, 130);                              // all right in turn 2
    fill(pul, 1, 120, 140);                              // 21 s wrong in turn 2 (a stall): traffic turn
    fill(pul, 2, 220, 240);                              // 21 s wrong in turn 3 (a stall): team turn
    const sc = score(ref, mkOut(N, {pul}), {me: 1});
    assert.equal(sc.stalls, 2);
    assert.equal(sc.byCause.traffic.stalls, 1);
    assert.equal(sc.byCause.team.stalls, 1);
    assert.equal(sc.byCause.traffic.pullerFlat, +(100 * (95 - 21) / 95).toFixed(1));
    assert.equal(sc.byCause.team.pullerFlat, +(100 * (95 + 95 - 21) / 190).toFixed(1));
    // Without any traffic knowledge every turn is a team turn.
    const none = mkRef({N, n: 2, turns});
    const nc = score(none, mkOut(N, {pul}), {me: 1}).byCause;
    assert.equal(nc.traffic.pullerFlat, null);
    assert.equal(nc.traffic.stalls, 0);
});


test('score: works on a reference that went through JSON (plain arrays)', () => {
    const ref = JSON.parse(JSON.stringify(mkRef({turns: T2})));
    const out = JSON.parse(JSON.stringify(mkOut(100, {pul: fill(new Array(100).fill(0), 1, 5, 49)})));
    const sc = score(ref, out, {me: 2});
    assert.equal(typeof sc.pullerFlat, 'number');
    assert.deepEqual(sc.displayEnds, []);
});


// A recording through an engine: the ride, the grid and the positions as the CLI would build them.
function engineInput() {
    const input = viewsOf([{text: M.makeRecording()}], {plans: P2});
    const {ride} = analyse(M.makeRecording(), {plans: P2});
    const pos = Object.fromEntries(input.ids.map((id, i) => [id, i + 1]));
    return {ride, opts: {N: input.N, t0: input.t0, pos}, input};
}
const STUB = fileURLToPath(new URL('./fixtures/race-ref/stub-engine', import.meta.url));
const REPO = fileURLToPath(new URL('..', import.meta.url));


test('runEngine: works with the stub engine whose order.out is a Set, an array or an object, and without DRAFT_N', async () => {
    const {ride, opts} = engineInput();
    const {stub} = await import('./fixtures/race-ref/stub-engine/pages/src/engine/rotation.mjs');
    for (const kind of ['set', 'array', 'object']) {
        Object.assign(stub, {outKind: kind, view: false, chaos: false, reason: null, hill: false, noPresent: false, puller: null, tick: null});
        const out = await runEngine(STUB, ride, opts);
        for (const key of ['pul', 'toMy', 'mine', 'el', 'disp', 'below', 'chaos']) {
            assert.equal(out[key].length, opts.N, `${kind}: ${key}`);
        }
        // The stub moves the puller every 60 ticks; the ticks start 40 s before the roll-off.
        assert.equal(out.pul[10], 1);
        assert.equal(out.pul[30], 2);
        assert.equal(out.pul[100], 3);
        assert.deepEqual(out.below[50], [3, 4, 5], `${kind}: #3 is out, #4 and #5 are not in the group, I (#2) am never listed`);
        assert.equal(out.toMy[50], null, 'no view: no countdown');
        assert.equal(out.mine[50], 0);
        assert.equal(out.disp[50], 0);
        assert.equal(out.chaos[50], 0);
    }
    // No order.out at all.
    Object.assign(stub, {outKind: 'none'});
    assert.deepEqual((await runEngine(STUB, ride, opts)).below[50], [4, 5]);
    Object.assign(stub, {outKind: 'set'});
});


test('runEngine: disp follows chaos, the climb and descent reasons and a hill pause; chaos only the chaos state', async () => {
    const {ride, opts} = engineInput();
    const {stub} = await import('./fixtures/race-ref/stub-engine/pages/src/engine/rotation.mjs');
    const at = async set => {
        Object.assign(stub, {outKind: 'set', view: false, chaos: false, reason: null, hill: false, noPresent: false, puller: null, tick: null}, set);
        const out = await runEngine(STUB, ride, opts);
        return [out.disp[50], out.chaos[50]];
    };
    assert.deepEqual(await at({}), [0, 0]);
    assert.deepEqual(await at({chaos: true}), [1, 1]);
    assert.deepEqual(await at({reason: 'chaos'}), [1, 1], 'the status reason chaos is the engine\'s chaos too');
    assert.deepEqual(await at({reason: 'climb'}), [1, 0]);
    assert.deepEqual(await at({reason: 'descent'}), [1, 0]);
    assert.deepEqual(await at({hill: true}), [1, 0]);
    Object.assign(stub, {reason: null, hill: false, view: true});
    const out = await runEngine(STUB, ride, opts);
    assert.equal(out.toMy[50], 42);
    assert.equal(out.mine[50], 0);
    assert.equal(out.el[50], null, 'only mine has an elapsed time');
    Object.assign(stub, {view: false});
});


const STUB_QUIET = {outKind: 'set', view: false, chaos: false, reason: null, hill: false, noPresent: false, puller: null, tick: null};


// The ride with a second tick in the second of tick `i`, 400 ms later (a copy of it).
function withExtraTick(ride, i) {
    const copy = {...ride.ticks[i], ts: ride.ticks[i].ts + 400};
    ride.ticks.splice(i + 1, 0, copy);
    ride.sigs.splice(i + 1, 0, ride.sigs[i]);
    ride.meRows.splice(i + 1, 0, ride.meRows[i]);
    return ride;
}


test('runEngine: two ticks in one second follow the spike: pul and below take the last tick, flags stay on, mine/toMy/el keep the last view', async () => {
    const {stub} = await import('./fixtures/race-ref/stub-engine/pages/src/engine/rotation.mjs');
    const {ride, opts} = engineInput();
    withExtraTick(ride, 90);                  // ticks 90 and 91 are both second 50; steps 91 and 92
    const at = async set => {
        Object.assign(stub, STUB_QUIET, set);
        return runEngine(STUB, ride, opts);
    };
    // The display and chaos flags: on in either tick of the second, never switched off by a later one.
    const on = n => ({tick: k => (k === n ? {chaos: true} : {})});
    for (const n of [91, 92]) {
        const o = await at(on(n));
        assert.equal(o.disp[50], 1, `tick ${n}`);
        assert.equal(o.chaos[50], 1, `tick ${n}`);
    }
    for (const reason of ['climb', 'descent']) {
        assert.equal((await at({tick: k => (k === 91 ? {reason} : {})})).disp[50], 1, `${reason} on the first tick only`);
    }
    assert.equal((await at({tick: k => (k === 91 ? {hill: true} : {})})).disp[50], 1, 'hill pause on the first tick only');
    assert.equal((await at({tick: k => (k === 91 ? {reason: 'climb'} : {})})).chaos[50], 0);
    // The puller: the last tick's.
    assert.equal((await at({tick: k => ({puller: k === 91 ? 0 : 3})})).pul[50], 4);
    // The table: a later tick without a present list leaves the earlier one.
    assert.deepEqual((await at({tick: k => (k === 92 ? {noPresent: true} : {})})).below[50], [3, 4, 5]);
    assert.equal((await at({tick: k => (k === 91 ? {noPresent: true} : {})})).below[50].length, 3, 'a list from the last tick');
    assert.equal((await at({noPresent: true})).below[50], null, 'no list in either tick');
    // My clock: a later tick without a view leaves the earlier view's values; with one it replaces them.
    const mineView = {mine: true, toMyPullS: 7, elapsedS: 12};
    let o = await at({tick: k => (k === 91 ? {view: mineView} : {})});
    assert.deepEqual([o.mine[50], o.toMy[50], o.el[50]], [1, 7, 12]);
    o = await at({tick: k => ({view: k === 91 ? mineView : {mine: false, toMyPullS: 30, elapsedS: 0}})});
    assert.deepEqual([o.mine[50], o.toMy[50], o.el[50]], [0, 30, null]);
    Object.assign(stub, STUB_QUIET);
});


test('displayEnds: a second without a tick does not split a display episode, and the end stays the last second seen on', async () => {
    const {stub} = await import('./fixtures/race-ref/stub-engine/pages/src/engine/rotation.mjs');
    const {ride, opts, input} = engineInput();
    const ref = buildReference(input);
    // The climb display for ticks 150..250 (one tick per second in the fixture).
    Object.assign(stub, STUB_QUIET, {tick: n => (n >= 150 && n <= 250 ? {reason: 'climb'} : {})});
    const whole = await runEngine(STUB, ride, opts);
    const wholeEnds = score(ref, whole, {me: 2}).displayEnds;
    assert.equal(wholeEnds.length, 1);
    // One tick inside the display moved by 600 ms lands in the next second: its own second is empty
    // (as 1 Hz jitter does on a real recording) and the next one holds two ticks.
    const {ride: jittered} = analyse(M.makeRecording(), {plans: P2});
    jittered.ticks[200] = {...jittered.ticks[200], ts: jittered.ticks[200].ts + 600};
    const out = await runEngine(STUB, jittered, opts);
    assert.equal(out.seen.filter(Boolean).length, whole.seen.filter(Boolean).length - 1, 'one second saw no tick');
    assert.deepEqual(score(ref, out, {me: 2}).displayEnds, wholeEnds, 'still one episode, same start and end');
    // A hole after the last second on does not stretch the end.
    const mk = disp => {
        const o = mkOut(480, {disp});
        o.seen = new Array(480).fill(1);
        return o;
    };
    const r2 = mkRef({N: 480, turns: [{who: 1, start: 0, end: 479, kind: 'first'}]});
    const tail = mk(fill(new Array(480).fill(0), 1, 20, 100));
    tail.seen[101] = 0;
    tail.seen[102] = 0;
    assert.deepEqual(score(r2, tail, {me: 1}).displayEnds.map(e => [e.start, e.end]), [[20, 100]]);
    // A tick-less second between two on seconds continues; a tick-less second between on and a seen off does not.
    const mid = mk(fill(new Array(480).fill(0), 1, 20, 100));
    mid.disp[60] = 0;
    mid.seen[60] = 0;
    assert.deepEqual(score(r2, mid, {me: 1}).displayEnds.map(e => [e.start, e.end]), [[20, 100]]);
    Object.assign(stub, STUB_QUIET);
});


test('runEngine: the last ticks without a plan do not change the plan: it is the last known one, as the positions are', async () => {
    const {stub} = await import('./fixtures/race-ref/stub-engine/pages/src/engine/rotation.mjs');
    const lines = M.makeRecording().trim().split('\n');
    for (let i = lines.length - 10; i < lines.length; i++) {
        const t = JSON.parse(lines[i]);
        t.det.planSig = null;
        lines[i] = JSON.stringify(t);
    }
    const {ride} = analyse(lines.join('\n'), {plans: P2});
    assert.equal(ride.planAt(ride.ticks.length - 1), null, 'the last tick has no plan');
    const {opts} = engineInput();
    Object.assign(stub, STUB_QUIET, {puller: 4});
    const out = await runEngine(STUB, ride, opts);
    assert.equal(out.pul[50], 5, 'the 5-rider plan P2 runs, so #5 can be the puller');
    assert.deepEqual(out.below[50], [3, 4, 5]);
    Object.assign(stub, STUB_QUIET);
});


test('runEngine: the current engine runs over the ride-report fixture and returns arrays of length N', async () => {
    const {ride, opts} = engineInput();
    const out = await runEngine(REPO, ride, opts);
    for (const key of ['pul', 'toMy', 'mine', 'el', 'disp', 'below', 'chaos']) {
        assert.ok(Array.isArray(out[key]), key);
        assert.equal(out[key].length, opts.N, key);
    }
    assert.ok(out.pul.slice(60, 460).filter(x => x > 0).length > 300, 'the engine names a puller most of the race');
    assert.ok(out.pul.every(x => Number.isInteger(x) && x >= 0 && x <= 5));
    assert.ok(out.mine.some(x => x === 1), 'my own turns are found');
    // And the score runs on its output: a ref from the same recording.
    const ref = buildReference(engineInput().input);
    const sc = score(ref, out, {me: ref.selfPos[0]});
    // A race of 480 s is all start and end context: no flat seconds, the rest is judged.
    assert.equal(sc.pullerFlat, null);
    assert.ok(sc.pullerRest > 50, `pullerRest ${sc.pullerRest}`);
    assert.equal(typeof sc.byCause.team.stalls, 'number');
});


// ---- Task 4: the CLI, the German report --------------------------------------------------------

// A race folder as the plan server's Download race tar gives it: a plain and a gzip'd recording of
// the made-up race (the same one twice), plans/P2TEST.json, and files and folders that are no input.
// fn(dir, folder) may change it. Returns the temp root; the caller removes it.
function raceFolder(fn = () => {}, {text = M.makeRecording()} = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'race-ref-test-'));
    const dir = path.join(root, 'race');
    fs.mkdirSync(path.join(dir, 'plans'), {recursive: true});
    fs.mkdirSync(path.join(dir, 'other-report'));
    fs.writeFileSync(path.join(dir, 'a.jsonl'), text);
    fs.writeFileSync(path.join(dir, 'b.jsonl.gz'), zlib.gzipSync(text));
    fs.writeFileSync(path.join(dir, 'plans', 'P2TEST.json'), JSON.stringify(M.PLAN2));
    fs.writeFileSync(path.join(dir, 'README.txt'), 'not an input');
    fs.writeFileSync(path.join(dir, 'MISSING-PLANS.txt'), 'not an input');
    fs.writeFileSync(path.join(dir, 'other-report', 'report.json'), '{"not":"an input"}');
    fn(dir, root);
    return root;
}
const quiet = () => {};


test('race-ref parseArgs: folder, files, --plan, --out, --names', () => {
    const a = parseArgs(['race', '--plan', 'p2test=plan.json', '--out', 'x', '--names']);
    assert.deepEqual(a.inputs, ['race']);
    assert.deepEqual(a.plans, [{sig: 'P2TEST', path: 'plan.json'}]);
    assert.equal(a.outDir, 'x');
    assert.equal(a.names, true);
    const b = parseArgs(['one.jsonl', 'two.jsonl.gz', '--plan=P2TEST=p.json', '--out=y']);
    assert.deepEqual(b.inputs, ['one.jsonl', 'two.jsonl.gz']);
    assert.deepEqual(b.plans, [{sig: 'P2TEST', path: 'p.json'}]);
    assert.equal(b.outDir, 'y');
    assert.equal(b.names, false);
    assert.equal(parseArgs(['-h']).help, true);
    assert.deepEqual(parseArgs([]), {inputs: [], plans: [], outDir: null, names: false, help: false});
    assert.throws(() => parseArgs(['--plan']), /--plan needs/);
    assert.throws(() => parseArgs(['--out']), /--out needs/);
    assert.throws(() => parseArgs(['--nope']), /unknown option/);
});


test('run: a folder with two made-up recordings and plans/P2TEST.json writes both files; reference.json has no rider id or name; reference.md is German and lists #k only', () => {
    const root = raceFolder();
    try {
        const dir = path.join(root, 'race');
        const lines = [];
        const {outDir} = run([dir], {log: l => lines.push(l)});
        assert.equal(outDir, path.join(root, 'race-reference'), 'next to the folder');
        assert.deepEqual(fs.readdirSync(outDir).sort(), ['reference.json', 'reference.md']);
        const jsonText = fs.readFileSync(path.join(outDir, 'reference.json'), 'utf8');
        const md = fs.readFileSync(path.join(outDir, 'reference.md'), 'utf8');
        const ref = JSON.parse(jsonText);
        assert.equal(ref.n, 5, 'the plan of the folder (P2TEST) gives the positions');
        assert.equal(ref.t0, M.T0 + M.PEN_S * 1000);
        assert.ok(ref.tEnd > ref.t0);
        assert.equal(ref.N, Math.round((ref.tEnd - ref.t0) / 1000) + 1);
        assert.equal(ref.figures.length, 5);
        assert.equal(ref.agreement, 1, 'two recordings of one race agree');
        assert.deepEqual(ref.selfPos, [2, 2]);
        assert.equal('ids' in ref, false);
        assert.ok(Array.isArray(ref.front) && Array.isArray(ref.present[1]) && Array.isArray(ref.countdown[2]));
        for (const text of [jsonText, md]) {
            for (const id of Object.values(M.IDS)) {
                assert.ok(!text.includes(id), `no Zwift id ${id}`);
            }
            for (const name of ['Alma', 'Bert', 'Cleo', 'Dora', 'Emil', 'Benno', 'Testers']) {
                assert.ok(!text.includes(name), `no name ${name}`);
            }
        }
        assert.match(md, /^# Rennreferenz/);
        assert.match(md, /Überblick/);
        assert.match(md, /Fahrer/);
        assert.match(md, /\| #1 \|/, 'riders by position');
        assert.match(md, /\| #5 \|/);
        assert.match(md, /\| #5 \| \+0:00 \| abgehängt \|/, 'Emil is never in the group: gone from the start');
        assert.ok(lines.some(l => l.includes('reference.md')), 'the log names the output');
        // The score CLI reads this reference.json: t0 is in it, the grid is its own.
        assert.ok(Number.isFinite(ref.t0));
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});


test('run: recording files with --plan, --out given', () => {
    const root = raceFolder();
    try {
        const dir = path.join(root, 'race');
        const out = path.join(root, 'elsewhere');
        const {outDir} = run([path.join(dir, 'a.jsonl'), '--plan', `P2TEST=${path.join(dir, 'plans', 'P2TEST.json')}`, '--out', out], {log: quiet});
        assert.equal(outDir, out);
        const ref = JSON.parse(fs.readFileSync(path.join(out, 'reference.json'), 'utf8'));
        assert.equal(ref.n, 5);
        assert.deepEqual(ref.selfPos, [2], 'one recording');
        assert.equal(ref.agreement, null);
        // Without --out: next to the first recording.
        const def = run([path.join(dir, 'b.jsonl.gz'), '--plan', `P2TEST=${path.join(dir, 'plans', 'P2TEST.json')}`], {log: quiet});
        assert.equal(def.outDir, path.join(dir, 'b-reference'));
        assert.ok(fs.existsSync(path.join(dir, 'b-reference', 'reference.md')));
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});


test('run: --names puts names into reference.md only, never into reference.json', () => {
    const root = raceFolder();
    try {
        const {outDir} = run([path.join(root, 'race'), '--names'], {log: quiet});
        const md = fs.readFileSync(path.join(outDir, 'reference.md'), 'utf8');
        const jsonText = fs.readFileSync(path.join(outDir, 'reference.json'), 'utf8');
        assert.match(md, /#1 Alma A/);
        assert.match(md, /#5 Emil E/);
        for (const name of ['Alma', 'Bert', 'Emil']) {
            assert.ok(!jsonText.includes(name), name);
        }
        for (const id of Object.values(M.IDS)) {
            assert.ok(!jsonText.includes(id), id);
        }
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});


test('run: no input and an input without recordings are errors, -h prints the usage', () => {
    const lines = [];
    assert.equal(run(['-h'], {log: l => lines.push(l)}).outDir, null);
    assert.match(lines.join('\n'), /usage: node tools\/race-ref\/race-ref\.mjs/);
    assert.throws(() => run([], {log: quiet}), /no recording/);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'race-ref-test-'));
    try {
        assert.throws(() => run([root], {log: quiet}), /no recording/);
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});


test('run: the plan switch mid-race does not crash and positions come from the last plan', () => {
    // The fixture's recorder switches from P1TEST (4 riders) to P2TEST (5, Dora pulls 40 s) at +240 s.
    // The last ticks of BOTH recordings lose their plan, so viewsOf walks back in the first one too
    // (a.jsonl): the positions stay the last known plan's.
    const noPlan = M.makeRecording().trim().split('\n').map((l, i, all) => {
        if (i < all.length - 10) {
            return l;
        }
        const t = JSON.parse(l);
        t.det.planSig = null;
        return JSON.stringify(t);
    }).join('\n') + '\n';
    const root = raceFolder(() => {}, {text: noPlan});
    try {
        const {outDir} = run([path.join(root, 'race')], {log: quiet});
        const ref = JSON.parse(fs.readFileSync(path.join(outDir, 'reference.json'), 'utf8'));
        assert.equal(ref.n, 5, 'five riders: the last plan, not the head plan');
        assert.equal(ref.planSig, 'P2TEST');
        assert.deepEqual(ref.planS, [0, 30, 30, 30, 40, 30], 'plan pulls of P2TEST by position (Dora 40 s)');
        assert.deepEqual(ref.turns.slice(0, 4).map(t => t.who), [1, 2, 3, 4]);
        assert.equal(ref.present[5].reduce((a, b) => a + b, 0), 0, 'Emil rides 400 m back and is never in the group');
        assert.equal(ref.figures[4].groupShare, 0);
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});


test('run: the score CLI reads the reference.json that run writes (t0 in it) and gives the in-process score', async () => {
    const root = raceFolder();
    try {
        const dir = path.join(root, 'race');
        const {outDir} = run([dir], {log: quiet});
        const lines = [];
        const code = await scoreRun([REPO, path.join(outDir, 'reference.json'), path.join(dir, 'a.jsonl'),
                                     '--plan', `P2TEST=${path.join(dir, 'plans', 'P2TEST.json')}`], {log: l => lines.push(l)});
        assert.equal(code, 0);
        const sc = JSON.parse(lines.join('\n'));
        // The same in process, on the reference as buildReference gives it (before the JSON).
        const {input, ride} = (() => {
            const i = viewsOf([{text: M.makeRecording()}, {text: M.makeRecording()}], {plans: P2});
            return {input: i, ride: analyse(M.makeRecording(), {plans: P2}).ride};
        })();
        const ref = buildReference(input);
        const pos = Object.fromEntries(input.ids.map((id, i) => [id, i + 1]));
        const out = await runEngine(REPO, ride, {N: input.N, t0: input.t0, pos});
        const expect = JSON.parse(JSON.stringify(score(ref, out, {me: ref.selfPos[0]})));
        assert.deepEqual(sc, expect);
        assert.ok(sc.pullerRest > 50, `pullerRest ${sc.pullerRest}`);
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});


test('run: reference.json records the plan its positions come from', () => {
    const root = raceFolder();
    try {
        const {outDir} = run([path.join(root, 'race')], {log: quiet});
        const ref = JSON.parse(fs.readFileSync(path.join(outDir, 'reference.json'), 'utf8'));
        assert.equal(ref.planSig, 'P2TEST', 'the last plan of the recording, not the head plan');
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});


test('score CLI: numbers the riders by the plan the reference was built on; without it the run stops and names the code', async () => {
    const root = raceFolder();
    try {
        const dir = path.join(root, 'race');
        const {outDir} = run([dir], {log: quiet});
        const refFile = path.join(outDir, 'reference.json');
        const rec = path.join(dir, 'a.jsonl');
        // The recording holds P1TEST (head) only; P2TEST (the reference's plan) is not given: no silent
        // fallback to the plan the walk-back finds.
        await assert.rejects(scoreRun([REPO, refFile, rec], {log: quiet}), /P2TEST.*--plan/s);
        // An older reference.json without a plan code cannot be scored either.
        const old = JSON.parse(fs.readFileSync(refFile, 'utf8'));
        delete old.planSig;
        const oldFile = path.join(outDir, 'old.json');
        fs.writeFileSync(oldFile, JSON.stringify(old));
        await assert.rejects(scoreRun([REPO, oldFile, rec, '--plan', `P2TEST=${path.join(dir, 'plans', 'P2TEST.json')}`], {log: quiet}), /planSig/);
        // The plan the reference names is used even when it is not the recording's last known one:
        // here the reference says P1TEST (the head plan, 4 riders) and the recording ends on P2TEST.
        const ask = async (planSig) => {
            const lines = [];
            const file = path.join(outDir, `${planSig}.json`);
            fs.writeFileSync(file, JSON.stringify({...old, planSig}));
            const code = await scoreRun([REPO, file, rec, '--plan', `P2TEST=${path.join(dir, 'plans', 'P2TEST.json')}`], {log: l => lines.push(l)});
            assert.equal(code, 0);
            return JSON.parse(lines.join('\n'));
        };
        const viaP1 = await ask('P1TEST');
        const viaP2 = await ask('P2TEST');
        const {ride} = analyse(M.makeRecording(), {plans: P2});
        const plan = ride.plans.get('P1TEST');
        const pos = Object.fromEntries(plan.riders.map((r, i) => [String(r.id), i + 1]));
        const t0 = old.t0;
        const out = await runEngine(REPO, ride, {N: old.N, t0, pos, plan});
        assert.deepEqual(viaP1, JSON.parse(JSON.stringify(score(old, out, {me: pos[String(ride.selfId)]}))));
        assert.notDeepEqual(viaP1, viaP2, 'the two plans number the riders differently');
        // A code that no plan file nor the recording knows is named in the error.
        fs.writeFileSync(path.join(outDir, 'zz.json'), JSON.stringify({...old, planSig: 'ZZTEST'}));
        await assert.rejects(scoreRun([REPO, path.join(outDir, 'zz.json'), rec], {log: quiet}), /ZZTEST/);
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});


test('runEngine: a plan given wins over the last known one', async () => {
    const {stub} = await import('./fixtures/race-ref/stub-engine/pages/src/engine/rotation.mjs');
    const {ride, opts} = engineInput();
    Object.assign(stub, STUB_QUIET, {puller: 4});
    const p1 = ride.plans.get('P1TEST');
    const out = await runEngine(STUB, ride, {...opts, plan: p1});
    assert.equal(out.pul[50], 0, 'P1TEST has four riders: no fifth to be the puller');
    Object.assign(stub, STUB_QUIET);
});


// The report on a reference with every kind of mark: the chaos recording (changes back, a disorder).
function chaosRef() {
    const input = viewsOf([{text: M.makeRecording({chaos: true})}]);
    const ref = buildReference(input);
    return {ref, figures: riderFigures(ref, input), input};
}


test('renderMarkdown: sections Überblick (Abdeckung, Übereinstimmung), Wechsel (in Ordnung / außer Ordnung, nach Kontext), Störer, Abgehängt, Verkehr (Team / Verkehr), Fahrer (Tabelle)', () => {
    const {ref, figures} = chaosRef();
    assert.ok(ref.turns.some(t => t.kind === 'back'), 'the chaos race has changes back');
    const md = renderMarkdown(ref, figures);
    const heads = md.split('\n').filter(l => l.startsWith('## '));
    assert.deepEqual(heads, ['## 1. Überblick', '## 2. Wechsel', '## 3. Störer', '## 4. Abgehängt', '## 5. Verkehr', '## 6. Fahrer']);
    const sec = n => md.split(/^## /m).find(s => s.startsWith(`${n}. `));
    assert.match(sec(1), /Abdeckung/);
    assert.match(sec(1), /Übereinstimmung/);
    assert.match(sec(1), /nur eine Aufzeichnung/, 'one recording: no agreement to report');
    assert.match(sec(2), /in Ordnung/);
    assert.match(sec(2), /außer Ordnung/);
    assert.match(sec(2), /nach Kontext/);
    assert.match(sec(2), /\| Start \|/);
    // The interjection rule names both cases: a short turn that is not next between a next change, and one inside a rider's turn.
    assert.match(sec(3), /nächste in der Reihe nach dem früheren ist, er selbst aber nicht/);
    assert.match(sec(3), /mitten im Zug eines Fahrers/);
    assert.match(sec(4), /der Zeitpunkt ist der Beginn der Phase/);
    assert.ok(!/das Datum/.test(md));
    assert.match(sec(5), /Team/);
    assert.match(sec(5), /Verkehr/);
    // The rider table: one row per plan position, by #k.
    const rows = sec(6).split('\n').filter(l => /^\| #\d /.test(l));
    assert.equal(rows.length, 4);
    assert.ok(rows[0].startsWith('| #1 |'));
    assert.ok(!/Alma|Dora/.test(md));
    // The change counts add up: every change is in or out of order.
    const changes = ref.turns.filter(t => t.kind !== 'first');
    const back = changes.filter(t => t.kind === 'back').length;
    assert.match(sec(2), new RegExp(`${changes.length} Wechsel \\(ohne den ersten Zug\\), davon in Ordnung ${changes.length - back} \\(`));
    assert.match(sec(2), new RegExp(`außer Ordnung ${back} \\(zurück\\)`));
    // One line per change back in the list, with its time.
    const listed = sec(2).split('\n').filter(l => /^\| \+\d+:\d\d \| #\d \| #\d \| \S+ \| (Team|Verkehr) \|$/.test(l));
    assert.equal(listed.length, back);
});


test('renderMarkdown: the agreement is a percentage with two recordings; names only when given', () => {
    const text = M.makeRecording({chaos: true});
    const input = viewsOf([{text}, {text}]);
    const ref = buildReference(input);
    const figures = riderFigures(ref, input);
    assert.match(renderMarkdown(ref, figures), /Übereinstimmung[^\n]*100 %/);
    const named = renderMarkdown(ref, figures, {names: input.names});
    assert.match(named, /\| #1 Alma A \|/);
    assert.ok(!/Alma/.test(renderMarkdown(ref, figures)));
});


test('renderMarkdown: interjections, drops and traffic marks are listed', () => {
    const N = 200;
    const ref = buildReference(mkViews({N, fronts: [[[1, 0, 59], [3, 60, 69], [2, 70, 140], [3, 141, 199]]]}));
    const figures = riderFigures(ref, {views: [{gaps: []}]});
    assert.equal(ref.interjections.length, 1);
    const md = renderMarkdown(ref, figures);
    const sec = md.split(/^## /m).find(s => s.startsWith('3. '));
    assert.match(sec, /\| \+1:00 \| #3 \| 10 \|/, 'time, rider, length');
    assert.match(sec, /#1 → #2/, 'between whom');
    const none = md.split(/^## /m).find(s => s.startsWith('4. '));
    assert.match(none, /keine|\| #/, 'drops section renders');
});


test('interjection power: the interjector\'s and the running owner\'s median over the interjection\'s seconds, listed with the plan percent', () => {
    // #3 interjects for 10 s (60..69) between #1 and #2; plan 300 W each (mkViews). #3 rides at about 150 W,
    // #1 (the owner, whose turn runs on) at about 300 W, over all views and over the whole interjection
    // (no 5 s offset). Outside the interjection #3 and #1 ride 999 W, so a wrong window shows.
    const v = mkViews({N: 200, fronts: [[[1, 0, 59], [3, 60, 69], [2, 70, 140], [3, 141, 199]]]});
    for (const view of v.views) {
        view.frames.forEach((f, s) => {
            const inside = s >= 60 && s <= 69;
            f.power = {1: inside ? 295 + (s % 2) * 10 : 999, 3: inside ? 145 + (s % 2) * 10 : 999};
        });
    }
    v.views.push({...v.views[0], frames: v.views[0].frames.map(f => ({...f, power: {1: 305, 3: 155}}))});
    const ref = buildReference(v);
    assert.equal(ref.interjections.length, 1);
    const x = ref.interjections[0];
    assert.deepEqual([x.who, x.at, x.s, x.between], [3, 60, 10, [1, 2]]);
    assert.equal(x.w, 155, 'median of the 20 rows of both views, from the first interjection second');
    assert.equal(x.wPlan, 300);
    assert.equal(x.ownerW, 305);
    assert.equal(x.ownerPlanW, 300);
    const md = renderMarkdown(ref, riderFigures(ref, {views: v.views}));
    const sec = md.split(/^## /m).find(s => s.startsWith('3. '));
    assert.match(sec, /\| \+1:00 \| #3 \| 10 \| #1 → #2 \| 155 W \(52 %\) \| 305 W \(102 %\) \| Team \|/);
    // Without power rows: a dim dash, no crash.
    const plain = buildReference(mkViews({N: 200, fronts: [[[1, 0, 59], [3, 60, 69], [2, 70, 140], [3, 141, 199]]]}));
    const bare = renderMarkdown(plain, riderFigures(plain, {views: [{gaps: []}]}));
    assert.match(bare.split(/^## /m).find(s => s.startsWith('3. ')), /\| #1 → #2 \| – \| – \| Team \|/);
});
