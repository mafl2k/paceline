// Run with: node --test tests/ride-report.test.mjs
// The ride report (tools/ride-report) on a made-up recording (tests/fixtures/ride-report/make.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {analyse, publicResult} from '../tools/ride-report/analyse.mjs';
import {parseRecording, readPlan, parsePlanArg} from '../tools/ride-report/load.mjs';
import {renderMarkdown} from '../tools/ride-report/render.mjs';
import {frontPerTick, markSwaps, turnsOf, groundTruth} from '../tools/ride-report/checks/pulls.mjs';
import {recoveryPlanS, stintEaseOff} from '../tools/ride-report/checks/countdown.mjs';
import {chaosPhases, liveChaosAt, replayChaosAt, pausedAt} from '../tools/ride-report/checks/puller.mjs';
import {simulateView, judgeView, viewsCheck, MODELS} from '../tools/ride-report/checks/views.mjs';
import {trafficCheck} from '../tools/ride-report/checks/traffic.mjs';
import {makeRide} from '../tools/ride-report/ride.mjs';
import {replay} from '../tools/ride-report/replay.mjs';
import {run, parseArgs, readRecording} from '../tools/ride-report/report.mjs';
import {planSig} from '../pages/src/engine/plan.mjs';
import * as M from './fixtures/ride-report/make.mjs';

const S = s => M.T0 + (M.PEN_S + s) * 1000;    // race second → timestamp
const P2 = [{sig: 'P2TEST', text: JSON.stringify(M.PLAN2)}];
const report = (opts = {}, plans = P2, more = {}) => publicResult(analyse(M.makeRecording(opts), {plans, ...more}).result);
const R = report();


test('parseRecording: the head, ticks, broken lines', () => {
    const text = M.makeRecording();
    const p = parseRecording(text + '{"ts": 1, "riders": [\n');
    assert.equal(p.head.kind, 'paceline-recording');
    assert.equal(p.ticks.length, M.PEN_S + M.RACE_S + 1);
    assert.equal(p.bad, 1);
    assert.throws(() => parseRecording('{"kind":"other"}\n'), /no Paceline recording head/);
    assert.throws(() => parseRecording('not json\n'), /no JSON/);
    assert.throws(() => parseRecording(''), /empty/);
});


test('readPlan: plan server record, planner JSON and engine plan', () => {
    const json = {team: {name: 'Testers'}, target_speed: '45', minimum_finishers: 0,
                  riders: {9000001: {name: 'Alma A', pull_duration: 30, order: 0, color: '#ffffff'},
                           9000002: {name: 'Bert B', pull_duration: 45, order: 1, color: '#000000'}},
                  roster: {9000009: {name: 'Benno B'}}};
    const text = [{name: 'Alma A', pullWatts: 300, pullS: 30, colorName: 'White', colorHex: '#ffffff'},
                  {name: 'Bert B', pullWatts: 310, pullS: 45, colorName: 'Black', colorHex: '#000000'}];
    const server = readPlan(JSON.stringify({team: 'Testers', sig: 'XXXXXX', json, text}));
    assert.equal(server.form, 'server');
    assert.deepEqual(server.plan.riders.map(r => [r.id, r.pullS, r.watts]), [['9000001', 30, 300], ['9000002', 45, 310]]);
    assert.equal(server.plan.sig, planSig(server.plan));
    assert.deepEqual(server.plan.bench.map(b => b.id), ['9000009']);
    const planner = readPlan(JSON.stringify(json));
    assert.equal(planner.form, 'planner');
    assert.deepEqual(planner.plan.riders.map(r => [r.id, r.pullS, r.watts]), [['9000001', 30, null], ['9000002', 45, null]]);
    const engine = readPlan(JSON.stringify(M.PLAN2));
    assert.equal(engine.form, 'engine');
    assert.equal(engine.plan.sig, 'P2TEST');
    assert.equal(engine.plan.riders.length, 5);
    assert.throws(() => readPlan('{"x": 1}'), /neither/);
    assert.deepEqual(parsePlanArg('ab12cd=/tmp/p.json'), {sig: 'AB12CD', path: '/tmp/p.json'});
    assert.deepEqual(parsePlanArg('/tmp/p.json'), {sig: null, path: '/tmp/p.json'});
});


test('1 overview: event, plans over time, roll-off, finish line, riders', () => {
    const o = R.overview;
    assert.equal(o.team, 'Testers');
    assert.equal(o.event.endDistanceM, 5875);
    assert.deepEqual(o.rollOff, {at: S(0), source: 'engine'});
    assert.equal(o.finish.source, 'event');
    assert.ok(o.finish.at >= S(M.LINE_S) && o.finish.at <= S(M.LINE_S + 1), `line at ${(o.finish.at - S(0)) / 1000}`);
    assert.deepEqual(o.plans.map(p => [p.sig, p.from, p.known, p.riders]),
                     [['P1TEST', M.T0, true, 4], ['P2TEST', S(M.SWITCH_S), true, 5]]);
    assert.equal(o.unknownPlanTicks, 0);
    assert.equal(o.holes.count, 0);
    assert.deepEqual(o.riders.map(r => [r.sig, r.recorded, r.missing, r.stripped]),
                     [['P1TEST', ['#1', 'ICH (#2)', '#3', '#4'], [], false],
                      ['P2TEST', ['#1', 'ICH (#2)', '#3', '#4', '#5'], [], false]]);
    assert.deepEqual(o.lacking, []);
});


test('1 overview: a later plan without its riders (stripped upload), a plan code without plan', () => {
    const s = report({stripE: true});
    assert.deepEqual(s.overview.riders[1], {sig: 'P2TEST', total: 5, recorded: ['#1', 'ICH (#2)', '#3', '#4'],
                                            missing: ['#5'], stripped: true});
    assert.match(s.overview.verdict, /P2TEST: #5 nicht aufgezeichnet \(gekürzter Upload\)/);
    const u = report({}, []);
    assert.equal(u.overview.unknownPlanTicks, M.PEN_S + M.RACE_S + 1 - (M.PEN_S + M.SWITCH_S));
    assert.equal(u.overview.plans[1].known, false);
    assert.match(u.overview.verdict, /ohne Plan \(--plan angeben\)/);
    assert.ok(u.pulls.noPlanTicks > 0);
    assert.equal(u.pulls.pulls.at(-1).sig, 'P1TEST');    // nothing judged without the plan
});


test('--plan-all: every second by one plan, the live plans still listed', () => {
    // P2 for the whole ride: Dora's pulls are judged against 40 s from the start, Emil is in the
    // rotation from the start (his rows only exist from the switch), the live P1 period stays visible.
    const r = report({}, [], {planAll: {sig: 'P2TEST', text: JSON.stringify(M.PLAN2)}});
    const o = r.overview;
    assert.deepEqual(o.plans.map(p => [p.sig, p.from, p.known]), [['P1TEST', M.T0, true], ['P2TEST', S(M.SWITCH_S), true]]);
    assert.deepEqual(o.analysisPlan, {sig: 'P2TEST', otherLiveTicks: M.PEN_S + M.SWITCH_S,
                                      otherLive: [{sig: 'P1TEST', from: M.T0, to: S(M.SWITCH_S - 1)}]});
    assert.equal(o.unknownPlanTicks, 0);
    assert.match(o.verdict, /^ausgewertet mit Plan P2TEST für die ganze Fahrt; live lief \d+ % der Zeit ein anderer Plan \(P1TEST\)/);
    assert.deepEqual(r.pulls.pulls.filter(p => p.who === '#4').map(p => [p.planS, p.sig]),
                     [[40, 'P2TEST'], [40, 'P2TEST'], [40, 'P2TEST']]);
    // Every Dora → Alma change now skips Emil (3 of them), not only the one after the switch.
    assert.deepEqual([r.pulls.order.next, r.pulls.order.skip], [11, 3]);
    // Before the switch Emil has no rows, so he counts as present (30 + 30 + 40 + 30 + 3 × 10);
    // after it his rows put him 400 m back and he is left out.
    assert.deepEqual(r.countdown.recovery.map(x => [x.sig, x.planS, x.gone]),
                     [['P2TEST', 160, []], ['P2TEST', 160, []], ['P2TEST', 120, ['#5']]]);
    // Emil's rows stop at +280 s, 400 m back: at my pull's end (+299 s) his last row says he is
    // gone, so he stays out of the sum (not 160 as for a rider never recorded).
    const left = report({emilLeavesS: 280}, [], {planAll: {sig: 'P2TEST', text: JSON.stringify(M.PLAN2)}});
    assert.deepEqual(left.countdown.recovery.map(x => [x.planS, x.gone]), [[160, []], [160, []], [120, ['#5']]]);
    // The replay ran P2 where P1 was live: not comparable there, and no missing riders blamed.
    assert.deepEqual(r.puller.replay.fidelity.map(f => [f.sig, f.otherPlan]), [['P1TEST', true], ['P2TEST', false]]);
    assert.match(r.puller.verdict, /Replay mit P2TEST, live lief P1TEST: dort nicht mit live vergleichbar/);
    assert.doesNotMatch(r.puller.verdict, /unvollständig/);
    const md = renderMarkdown(r);
    assert.match(md, /\| Ausgewertet mit \| Plan P2TEST für jede Sekunde \(--plan-all\); live lief: P1TEST -0:40 bis \+3:59 \(280 s\) \|/);
    assert.match(md, /\*\*Plancodes, wie sie live liefen\*\* \(ausgewertet wird mit P2TEST\)/);
    // Without it, the same recording is judged by P1 until the switch.
    assert.deepEqual(R.overview.analysisPlan, null);
    assert.deepEqual(R.pulls.pulls.filter(p => p.who === '#4').map(p => p.planS), [30, 30, 40]);
    assert.deepEqual(parseArgs(['a.jsonl', '--plan-all', 'P2TEST=p.json']).planAll, {sig: 'P2TEST', path: 'p.json'});
});


test('2 ground truth: pulls, over/under the plan, order', () => {
    const g = R.pulls;
    // 16 pulls up to the line; Dora's last one starts in the finish sprint and is listed apart.
    assert.equal(g.pulls.length, 15);
    assert.deepEqual(g.finishSprint, [{who: '#4', start: S(450), s: 21}]);
    assert.match(g.verdict, /1 Züge im Zielsprint nicht gezählt/);
    assert.deepEqual(g.pulls.slice(0, 5).map(p => [p.who, p.start, p.s, p.planS]),
                     [['#1', S(0), 29, 30], ['ICH (#2)', S(30), 29, 30], ['#3', S(60), 29, 30], ['#4', S(90), 29, 30],
                      ['#1', S(120), 29, 30]]);
    assert.equal(g.pulls[0].first, true);
    // Dora: 30 s by P1, 40 s by P2 (and her last pull ends at the line).
    assert.deepEqual(g.pulls.filter(p => p.who === '#4').map(p => [p.planS, p.overS]), [[30, -1], [30, -1], [40, -11]]);
    const dora = g.riders.find(r => r.who === '#4');
    assert.deepEqual([dora.pulls, dora.planS, dora.medianOverS, dora.min, dora.max], [3, '30/40', -1, -11, -1]);
    assert.deepEqual(g.riders.find(r => r.who === '#1').thirds, [-1, -1, -1]);
    // Under P2 Emil (#5) follows Dora but never pulls: one change skips him.
    assert.deepEqual([g.order.next, g.order.skip, g.order.skipUnseen, g.order.back, g.order.other], [13, 1, 0, 0, 0]);
    assert.deepEqual(g.order.changes, [{at: S(360), kind: 'skip', from: '#4', to: '#1', skipped: ['#5']}]);
    assert.equal(g.unseenTicks, 0);
});


test('2 ground truth: a back-and-forth at the front counts as one pull per rider', () => {
    // Cleo and Dora swap the front four times in their turn (stints 19, 9, 11, 17 s, 30 s plans).
    const g = report({swap: true}).pulls;
    assert.deepEqual(g.pulls.filter(p => p.swap).map(p => [p.who, p.start, p.s, p.swap]),
                     [['#3', S(M.SWAP_AT_S), 19, 1], ['#4', S(M.SWAP_AT_S + 20), 9, 1], ['#3', S(M.SWAP_AT_S + 30), 11, 1],
                      ['#4', S(M.SWAP_AT_S + 42), 17, 1]]);
    assert.deepEqual(g.swaps, [{at: S(M.SWAP_AT_S), stints: 4, riders: [{who: '#3', stints: 2, s: 30, planS: 30},
                                                                       {who: '#4', stints: 2, s: 26, planS: 30}]}]);
    // The stints stay in the list, the turns count: 15 pulls as without the swap, Cleo +0 and Dora
    // -4 there (not -11/-19 and -21/-13), Dora's median -4 (not -13).
    assert.equal(g.pulls.length, 17);
    assert.equal(g.turns.length, 15);
    assert.deepEqual(g.turns.filter(t => t.swap).map(t => [t.who, t.s, t.overS, t.stints]), [['#3', 30, 0, 2], ['#4', 26, -4, 2]]);
    const dora = g.riders.find(r => r.who === '#4');
    assert.deepEqual([dora.pulls, dora.medianOverS, dora.min], [3, -4, -11]);
    assert.deepEqual(g.riders.find(r => r.who === '#3').pulls, 4);
    // The order sees Cleo → Dora → Alma, no "back" changes.
    assert.deepEqual([g.order.next, g.order.back, g.order.skip], [13, 0, 1]);
    assert.match(g.verdict, /^15 Züge \(1× Hin und Her an der Spitze: 17 Abschnitte\)/);
    assert.match(renderMarkdown(report({swap: true})), /\| \+3:00 \| 4 \| #3 30 \(30, 2×\), #4 26 \(30, 2×\) \|/);
    // Without the swap nothing is marked.
    assert.deepEqual([R.pulls.swaps, R.pulls.turns.length], [[], 15]);
});


test('2 ground truth: markSwaps needs a short stint, a third rider ends the turn, two riders alone are no swap', () => {
    const P = (id, start, s) => ({id, start: start * 1000, end: (start + s) * 1000, s});
    const plan = () => 60;
    // a b a b c: one turn (b's 10 s is short), c ends it.
    const x = [P('a', 0, 40), P('b', 41, 10), P('a', 52, 20), P('b', 73, 40), P('c', 114, 60)];
    assert.equal(markSwaps(x, plan), 1);
    assert.deepEqual(x.map(p => p.swap ?? null), [1, 1, 1, 1, null]);
    assert.deepEqual(turnsOf(x, 'b').map(t => [t.start, t.s, t.k0, t.k1]), [[41000, 50, 1, 3]]);
    // Only full pulls: a rotation, no swap.
    const y = [P('a', 0, 60), P('b', 61, 58), P('a', 120, 62), P('c', 183, 60)];
    assert.equal(markSwaps(y, plan), 0);
    // Two riders left alternate all race long: no swap even with one short pull among them.
    const z = [P('a', 0, 60), P('b', 61, 20), P('a', 82, 60), P('b', 143, 60), P('a', 204, 60), P('b', 265, 60)];
    assert.equal(markSwaps(z, plan), 0);
    // A hole of more than 15 s breaks the alternation.
    const w = [P('a', 0, 40), P('b', 41, 10), P('a', 70, 20)];
    assert.equal(markSwaps(w, plan), 0);
});


test('2 ground truth: the front rider needs fresh data, no draft, race speed and the group near', () => {
    const row = (id, eventDistance, draft, extra = {}) => ({id, eventDistance, draft, speed: 45, age: 100, ...extra});
    const plan = {sig: 'T', riders: [{id: 'a'}, {id: 'b'}, {id: 'c'}]};
    const ride = {planAt: () => plan, ticks: [
        {riders: [row('a', 100, 120), row('b', 98, 0)]},                 // a has a wheel: b leads
        {riders: [row('a', 100, 120), row('b', 98, 130)]},               // someone without data in front
        {riders: [row('a', 100, 0, {age: 3500}), row('b', 98, 0)]},      // a's data is stale
        {riders: [row('a', 100, 0, {speed: 15}), row('b', 98, 0)]},      // a is not racing
        {riders: [row('x', 120, 0), row('a', 100, 0), row('b', 98, 90)]},    // x is in no plan
        {riders: [row('c', 99, 0, {self: true}), row('a', 100, 5)]},     // 5 W still counts as no draft
        // The group drafts behind someone without data; b, 1.8 km back on his own, has no draft either.
        {riders: [row('a', 2000, 120), row('c', 1998, 130, {self: true}), row('b', 200, 0)]},
        {riders: [row('a', 100, 0), row('b', 51, 120)]},                 // b 49 m back still makes a group
        {riders: [row('a', 100, 0), row('b', 80, 120, {age: 12000})]},   // b's data too old to say where he is
    ]};
    assert.deepEqual(frontPerTick(ride), ['b', null, 'b', 'b', 'a', 'a', null, 'a', null]);
});


test('3 puller detection: 2 s late at every change, no locks', () => {
    const p = R.puller;
    assert.equal(p.live.changes, 14);    // not the change into the finish sprint
    assert.ok(p.live.lags.every(l => l.lagS === 2), JSON.stringify(p.live.lags));
    assert.equal(p.live.lagMedianS, 2);
    assert.equal(p.live.missedChanges, 0);
    assert.deepEqual(p.live.locks, []);
    assert.equal(p.excluded.lock, 60);
    assert.equal(p.live.unrecordedPullerTicks, 0);
    // Wrong only in the 2 s after each change that is judged (not in the start lock or finish mode).
    assert.ok(p.live.agreePct >= 90 && p.live.agreePct < 100, String(p.live.agreePct));
    assert.equal(p.live.wrongS % 2, 0);
    // The replay sees every rider the recording has: the front agrees everywhere.
    assert.deepEqual(p.replay.fidelity.map(f => [f.sig, f.frontPct]), [['P1TEST', 100], ['P2TEST', 100]]);
    assert.ok(Number.isFinite(p.replay.agreePct));
});


test('4 countdown: one 10 s jump down, recovery vs plan, prediction error, READY', () => {
    const c = R.countdown;
    assert.deepEqual([c.jumps.n, c.jumps.down, c.jumps.up, c.jumps.atChange], [1, 1, 0, 0]);
    assert.deepEqual(c.jumps.list[0], {at: S(M.JUMP_AT_S), fromS: 51, toS: 40, errS: -10, change: false});
    assert.equal(c.myPulls, 4);
    // Recovery 91 s (three 29 s pulls and the ticks between); plan: 3 × 30 + 2 × 10, under P2
    // 30 + 30 + 40 + 2 × 10 without Emil, who is 400 m back.
    assert.deepEqual(c.recovery.map(r => [r.effS, r.planS, r.sig, r.gone, r.clockS]),
                     [[91, 110, 'P1TEST', [], 88], [91, 110, 'P1TEST', [], 88], [91, 120, 'P2TEST', ['#5'], 88]]);
    assert.deepEqual(c.recovery[0].between.map(b => [b.who, b.s, b.planS]), [['#3', 29, 30], ['#4', 29, 30], ['#1', 29, 30]]);
    assert.equal(c.recovery[0].unseenS, 4);
    // Before my pull at +150 s: right at −60 s, 10 s early from the jump on.
    assert.deepEqual(c.before[1].errs, [null, 'pull', 0, -10, -10]);
    assert.equal(c.before[1].readyLeadS, 20);
    assert.equal(c.before[2].readyLeadS, 10);
    assert.ok(c.before.every(b => b.pullShownS === 0));
});


test('4 countdown: the plan sum follows the overhead split and leaves the rider before me at plan', () => {
    const riders = [['m', 60], ['a', 30], ['b', 50], ['c', 40], ['d', 90]].map(([id, pullS]) => ({id, pullS}));
    // After me (m): a 30 + 10, b 50 + 5, c 40 + 10 (40 s is still short), d 90 (directly before me, plan only).
    assert.equal(recoveryPlanS(riders, 'm'), 40 + 55 + 50 + 90);
    // c away: d stays the rider before me.
    assert.equal(recoveryPlanS(riders, 'm', r => r.id === 'c'), 40 + 55 + 90);
    // The rider before me comes from the plan order round the corner: with d away it is c, at plan.
    assert.equal(recoveryPlanS(riders, 'm', r => r.id === 'd'), 40 + 55 + 40);
    // Me in the middle (b): the order runs on from the rider after me and wraps: c 50, d 95, m 65, a (before me) 30.
    assert.equal(recoveryPlanS(riders, 'b'), 50 + 95 + 65 + 30);
});


test('4 countdown: errors against T0, the ease-off of the rider before me', () => {
    // T0 = the rider before me eases off (user, 21 Nov 2026). In the fixture the puller rides 320 W
    // and 250 W off the front, so the 85 % rule puts T0 at his stint's end + 1 s, my start.
    const t = R.countdown.t0;
    assert.deepEqual(t.before.map(b => [b.start, b.T0, b.main, b.errs, b.readyLeadS]), [
        [S(150), S(150), false, [null, null, 0, -10, -10], 20],
        [S(270), S(270), false, [null, null, 0, 0, 0], 10],
        [S(390), S(390), true, [null, null, 0, 0, 0], 10],
    ]);
    assert.equal(t.n, 1);
    assert.equal(t.absErrorMedianS, 0);
    assert.equal(t.late10Pct, 0);
    assert.equal(t.readyLeadMedianS, 10);
    assert.equal(t.shadow, null);
    assert.match(R.countdown.verdict, /gegen T0 \|Fehler\| Median 0 s/);
    assert.doesNotMatch(R.countdown.verdict, /fest/);
});


test('4 countdown: the shadow against T0', () => {
    const r = report({cdOld: 5}).countdown;
    const t = r.t0;
    // The fixed rule's clock 5 s above the shown one: 5 s late everywhere, 10 s early less 5 s after the jump.
    assert.deepEqual(t.shadow.before.map(b => b.errs), [[null, null, 5, -5, -5], [null, null, 5, 5, 5], [null, null, 5, 5, 5]]);
    assert.deepEqual(t.shadow.before.map(b => b.readyLeadS), [15, 5, 5]);
    assert.equal(t.shadow.absErrorMedianS, 5);
    assert.equal(t.shadow.signedMedianS, 5);
    assert.equal(t.shadow.late10Pct, 100);
    assert.equal(t.shadow.readyLeadMedianS, 5);
    assert.equal('shadow' in t.shadow, false);
    // The live part is as without the shadow.
    const {shadow, ...live} = t;
    const {shadow: none, ...base} = R.countdown.t0;
    assert.equal(none, null);
    assert.deepEqual(live, base);
    assert.match(r.verdict, /gegen T0 \|Fehler\| Median 0 s \(fest 5 s\)/);
});


test('4 countdown: the shadow series reads det.old.cd', () => {
    const old = report({cdOld: 5}).countdown;
    const r = report({cdOld: 5, shadow: true}).countdown;
    const {source, ...shadow} = r.t0.shadow;
    assert.equal(source, 'det.old.cd');
    assert.deepEqual(shadow, old.t0.shadow);
    // The live part is as without the shadow.
    assert.deepEqual({...r.t0, shadow: null}, {...old.t0, shadow: null});
    // Older recordings (det.cdOld) say nothing of a source.
    assert.equal('source' in old.t0.shadow, false);
    // A recording of this version without a countdown in det.old has no shadow.
    assert.equal(report({shadow: true}).countdown.t0.shadow?.source, 'det.old.cd');
    const none = M.makeRecording({shadow: true}).split('\n').map(l => {
        if (!l.startsWith('{"ts"')) {
            return l;
        }
        const t = JSON.parse(l);
        t.det.old.cd = null;
        return JSON.stringify(t);
    }).join('\n');
    assert.equal(publicResult(analyse(none, {plans: P2}).result).countdown.t0.shadow, null);
});


test('4 countdown: the shadow counts only where a countdown showed, not in chaos', () => {
    // The recorder writes det.cdOld in chaos too, while the windows show the dim "≠": those ticks
    // must not step the shadow clock (21 Nov 2026).
    const text = M.makeRecording({chaos: 'live', cdOld: 5});
    const inChaos = text.split('\n').map(l => {
        if (!l.includes('"k":"chaos"')) {
            return l;
        }
        const t = JSON.parse(l);
        t.det.cdOld = {t: 1, standing: false};
        return JSON.stringify(t);
    }).join('\n');
    const shadowOf = x => publicResult(analyse(x, {plans: []}).result).countdown.t0.shadow;
    const base = shadowOf(text);
    assert.ok(base.before.some(b => b.errs.includes('chaos')), JSON.stringify(base.before));
    assert.ok(inChaos.split('\n').filter(l => l.includes('"cdOld":{"t":1')).length > 0);
    assert.deepEqual(shadowOf(inChaos), base);
});


test('4 countdown: T0 before my start when the rider before me eases off early', () => {
    // Alma eases off to 100 W for the last 8 s of her pull (+142…+149 s before my turn at +150 s):
    // the 85 % rule's last full step is +142 s, so T0 = +143 s, 7 s before my start. Every error
    // against T0 is the one against my start + 7 s, the READY lead before T0 7 s shorter.
    const t = report({easeOffS: 8}).countdown.t0;
    assert.deepEqual(t.before.map(b => [b.start, b.T0, b.main, b.errs, b.readyLeadS]), [
        [S(150), S(143), false, [null, null, 7, -3, -3], 13],
        [S(270), S(263), false, [null, null, 7, 7, 7], 3],
        [S(390), S(383), true, [null, null, 7, 7, 7], 3],
    ]);
    assert.deepEqual([t.n, t.signedMedianS, t.absErrorMedianS, t.late10Pct, t.readyLeadMedianS], [1, 7, 7, 100, 3]);
    // The fixed shadow 10 s below my shown clock: early against T0, so the signed median is not
    // the absolute one.
    const sh = report({easeOffS: 8, cdOld: -10}).countdown.t0.shadow;
    assert.deepEqual(sh.before.map(b => [b.T0, b.errs, b.readyLeadS]), [
        [S(143), [null, null, -3, -13, -13], 23],
        [S(263), [null, null, -3, -3, -3], 13],
        [S(383), [null, null, -3, -3, -3], 13],
    ]);
    assert.deepEqual([sh.n, sh.signedMedianS, sh.absErrorMedianS, sh.late10Pct, sh.readyLeadMedianS], [1, -3, 3, 0, 13]);
});


test('stintEaseOff: the 85 % rule on a stint\'s rows', () => {
    const ts0 = M.T0;
    const ticks = Array.from({length: 40}, (_, i) => ({ts: ts0 + i * 1000,
        riders: [{id: 'x', age: 100, power: i < 30 ? 300 : 100}, {id: 'y', age: 100, power: 400}]}));
    const p = {id: 'x', start: ts0, end: ts0 + 39000, i0: 0, i1: 39};
    assert.equal(stintEaseOff({ticks}, p), ts0 + 30000 + 1000);
    // Stale power (age > 2 s) is no sample: without enough samples there is no ease-off.
    const stale = ticks.map(t => ({...t, riders: t.riders.map(x => ({...x, age: 5000}))}));
    assert.equal(stintEaseOff({ticks: stale}, p), null);
});


test('5 gaps: the real gap, the one in full draft, warnings shown and replayed', () => {
    const G = R.gaps;
    assert.equal(G.real.n, 1);
    assert.equal(G.real.list[0].who, '#4');
    assert.ok(Math.abs(G.real.list[0].at - S(M.GAP_AT_S)) <= 2000);
    assert.equal(G.real.list[0].draftW, 0);
    assert.deepEqual(G.real.drafted.map(e => [e.who, e.draftW]), [['#4', 110]]);
    assert.deepEqual([G.replay.n, G.replay.detected, G.replay.missed, G.replay.falseAlarms, G.replay.important], [1, 1, 0, 0, 1]);
    assert.deepEqual([G.shown.n, G.shown.detected, G.shown.afterRaw8.medianS], [1, 1, 5]);
    assert.deepEqual(G.perRider, [{who: '#4', real: 1, replayEarly: 1, replayFull: 1, shown: 1}]);
    // Without the filter the gap in full draft counts too (with its warning).
    assert.deepEqual([G.withoutDraftFilter.real, G.withoutDraftFilter.warnings, G.withoutDraftFilter.detected,
                      G.withoutDraftFilter.falseAlarms], [2, 2, 2, 0]);
    assert.ok(Array.isArray(G.finishZone));
    assert.equal(G.caveat, null);
});


// The fixture's ticks as objects, changed by fn(tick, s) (s: race second), back as text.
function edited(fn, opts = {}) {
    return M.makeRecording(opts).trim().split('\n').map((l, i) => {
        const x = JSON.parse(l);
        if (i > 0) {
            fn(x, (x.ts - S(0)) / 1000);
        }
        return JSON.stringify(x);
    }).join('\n');
}


test('5 gaps: a warning from a full-draft gap that runs on into a real gap counts for it', () => {
    const G = report({draftIntoDrop: true}).gaps;
    assert.deepEqual(G.real.drafted.map(e => [e.who, e.draftW]), [['#4', 110]]);
    const real = G.real.list.find(e => Math.abs(e.at - S(141)) <= 2000);
    assert.ok(real, JSON.stringify(G.real.list));
    // Warned since the full-draft gap began, 19 s before the raw gap reached 8 m in the real one.
    assert.equal(real.afterRaw8Replay, -19);
    assert.deepEqual([G.replay.n, G.replay.detected, G.replay.missed], [2, 2, 0]);
});


test('3 lag: a brief early naming that the engine leaves again is not the change', () => {
    // At +55 s the live puller names Cleo for one tick, then Bert again until +62 s.
    const r = publicResult(analyse(edited((t, s) => {
        if (s === 55) {
            t.det.puller = M.IDS.cleo;
        }
    }), {plans: P2}).result);
    const toCleo = r.puller.live.lags.find(l => l.at === S(60));
    assert.equal(toCleo.lagS, 2);
});


test('2–4 pulls in the finish sprint: listed apart, not my pulls', () => {
    // Finish mode from +390 s: my pull at +390 starts in it.
    const r = publicResult(analyse(edited((t, s) => {
        if (s >= 390 && t.det) {
            t.det.finish = true;
        }
    }), {plans: P2}).result);
    assert.deepEqual(r.pulls.finishSprint.map(p => [p.who, p.start]),
                     [['ICH (#2)', S(390)], ['#3', S(420)], ['#4', S(450)]]);
    assert.equal(r.countdown.myPulls, 3);
    assert.deepEqual(r.countdown.before.map(b => b.start), [S(30), S(150), S(270)]);
    assert.equal(r.countdown.recovery.length, 2);
    assert.ok(r.puller.live.lags.every(l => l.at < S(390)));
});


test('5 gaps: the drop counter in the last 500 m counts only the gaps the report counts', () => {
    // Cleo (last in the line) 14 m back in full draft at +92 s (no real gap), then 15 m back with
    // no draft at +455 s, in the last 500 m.
    const back = (t, id, m, draft) => {
        const r = t.riders.find(x => x.id === id);
        r.eventDistance -= m;
        r.distance -= m;
        r.gapDistance += m;
        r.draft = draft;
    };
    const r = publicResult(analyse(edited((t, s) => {
        if (s >= 92 && s < 102) {
            back(t, M.IDS.cleo, 14, 110);
        }
        if (s >= 455 && s < 467) {
            back(t, M.IDS.cleo, 15, 0);
        }
    }), {plans: P2}).result);
    assert.deepEqual(r.gaps.real.drafted.filter(e => e.who === '#3').map(e => e.draftW), [110]);
    const cleo = r.gaps.finishZone.filter(x => x.who === '#3');
    assert.ok(cleo.length, JSON.stringify(r.gaps.finishZone));
    assert.ok(cleo.every(x => x.before === 0), JSON.stringify(cleo));
});


test('5 gaps: the last-500 m counter uses the same rule as the warnings', () => {
    // draftIntoDrop: Dora's warning begins on the full-draft gap at +121 s and runs into the real
    // one at +141 s, so it is kept; the real gap at +362 s gives a second one. Then Dora drops
    // 15 m back in the last 500 m (+432 s).
    const r = publicResult(analyse(edited((t, s) => {
        if (s >= 432 && s < 446) {
            const d = t.riders.find(x => x.id === M.IDS.dora);
            d.eventDistance -= 15;
            d.distance -= 15;
            d.gapDistance += 15;
            d.draft = 0;
        }
    }, {draftIntoDrop: true}), {plans: P2}).result);
    assert.deepEqual(r.gaps.perRider.find(x => x.who === '#4').replayFull, 2);
    const dora = r.gaps.finishZone.filter(x => x.who === '#4');
    assert.ok(dora.length, JSON.stringify(r.gaps.finishZone));
    assert.equal(dora[0].before, 2);
});


test('3 lag: a run of one naming ends at a hole in the ticks', () => {
    // The live puller names Cleo from +40 s; ticks +47 … +56 are missing; Cleo again from +57 s.
    // The naming that stuck began at +57 s, not at +40 s.
    const lines = edited((t, s) => {
        if (s >= 40 && s < 62) {
            t.det.puller = M.IDS.cleo;
        }
    }).split('\n').filter((l, i) => {
        const s = i === 0 ? null : (JSON.parse(l).ts - S(0)) / 1000;
        return s === null || s < 47 || s > 56;
    });
    const r = publicResult(analyse(lines.join('\n'), {plans: P2}).result);
    const toCleo = r.puller.live.lags.find(l => l.at === S(60));
    assert.ok(toCleo && !toCleo.unseen, JSON.stringify(r.puller.live.lags.slice(0, 3)));
    assert.equal(toCleo.lagS, -3);
});


// A made-up rotation for the views: A, B, C, me, 30 s plans each; A and B ride 40 s, C (before
// me) and I ride 30 s.
function rotationPulls(rounds, {dropB = null} = {}) {
    const out = [];
    let t = 0;
    for (let n = 0; n < rounds; n++) {
        for (const [id, s] of [['a', 40], ['b', 40], ['c', 30], ['me', 30]]) {
            if (id === 'b' && dropB !== null && n >= dropB) {
                continue;
            }
            out.push({id, start: t * 1000, end: (t + s - 1) * 1000, s: s - 1, i0: 0});
            t += s;
        }
    }
    return out;
}
const VIEW_PLAN = {sig: 'V', riders: ['a', 'b', 'c', 'me'].map((id, order) => ({id, order, pullS: 30}))};
const viewRide = {planAt: () => VIEW_PLAN};
const model = key => MODELS.find(m => m.key === key);


test('8 views: the new model has no jump at a change and is exact when riders pull plan + 10 s', () => {
    const pulls = rotationPulls(4);
    const to = pulls.at(-1).end;
    const mine = pulls.filter(p => p.id === 'me');
    const starts = mine.slice(1).map((p, j) => ({start: p.start, after: mine[j].end}));
    const run = key => simulateView(viewRide, pulls, 'me', model(key), {to, tickAt: () => 0});
    const at = (ser, s) => ser.find(x => x.ts === s * 1000).v;
    // At A's start: B 30 + 10, C (before me) 30, A himself 30 + 10; the old model counts A at
    // plan and C + 10 s: the same sum.
    assert.equal(at(run('new'), 140), 110);
    assert.equal(at(run('old'), 140), 110);
    // The puller's expected end is his plan + 10 s: the clock runs on through A's 31st to 40th
    // second and B takes over without a jump.
    assert.deepEqual([173, 179, 180].map(s => at(run('new'), s)), [77, 71, 70]);
    const neu = judgeView(run('new'), starts, {evalFrom: 0});
    assert.deepEqual([neu.jumps, neu.smallJumps, neu.late, neu.absErrorMedianS], [0, 0, 0, 0]);
    // 180 and 120 s before my start lie before my last pull's end (a 110 s recovery): no value.
    assert.deepEqual(neu.errorAt.map(e => [e.medianS, e.n]), [[null, 0], [null, 0], [0, 3], [0, 3], [0, 3]]);
    // The old model: the clock stands 3 s past A's plan and drops 6 s when B takes over, and again
    // at C: two small jumps a round.
    assert.deepEqual([173, 179, 180].map(s => at(run('old'), s)), [77, 77, 70]);
    const alt = judgeView(run('old'), starts, {evalFrom: 0});
    assert.deepEqual([alt.jumps, alt.smallJumps], [8, 8]);
    assert.deepEqual(alt.errorAt.map(e => e.medianS), [null, null, 0, 0, 0]);
});


test('8 views: present are the riders who pulled between my last two pulls', () => {
    // B stops pulling from round 3 (A 280 s, C 320 s, me 350 s, A 380 s ...).
    const pulls = rotationPulls(5, {dropB: 2});
    const ser = simulateView(viewRide, pulls, 'me', model('new'), {to: pulls.at(-1).end, tickAt: () => 0});
    const at = s => ser.find(x => x.ts === s * 1000).v;
    assert.equal(at(280), 110);    // B pulled between my pulls at 110 and 250 s: still counted
    assert.equal(at(320), 30);     // C (before me) takes over from A: B is not between, 41 s down
    assert.equal(at(380), 70);     // between my pulls at 250 and 350 s only A and C pulled: A 40 + C 30
});


test('8 views: every plan rider as me, the recorder by his own id', () => {
    const r = publicResult(analyse(M.makeRecording(), {plans: P2}).result).views;
    assert.match(r.verdict, /^keine Fahrer mit 5 Zügen/);
    const ride = makeRide(parseRecording(M.makeRecording()), {extraPlans: [{sig: 'P2TEST', plan: M.PLAN2}]});
    const from = S(0), to = ride.finish.at;
    const gt = groundTruth(ride, {from, to});
    const v = viewsCheck(ride, gt, {from, to, minPulls: 3});
    // Dora's fourth pull starts in the finish sprint; Emil never pulls.
    assert.deepEqual(v.riders.map(x => [x.who, x.pulls]), [['#1', 4], ['ICH (#2)', 4], ['#3', 4], ['#4', 3]]);
    // My pulls are the recorder's (+30, +150, +270, +390 s): judged after the first 5 min, only +390 s.
    assert.equal(v.evalFrom, S(300));
    assert.deepEqual([v.riders[1].new.pulls, v.riders[1].old.pulls], [1, 1]);
    assert.deepEqual(v.lateRiders, []);
    assert.deepEqual(Object.keys(v.total), ['old', 'new']);
    assert.deepEqual(v.riders.map(x => x.new.pulls), [1, 1, 2, 1]);
    assert.equal(v.total.new.pulls, 5);
});


// Chaos (20 Nov 2026): the front leaves the plan's order (tests/fixtures/ride-report/make.mjs,
// chaos). Dora back in front at +150 s and +230 s (the rider before Alma: 'back', bad), held
// 30 s each (BACK_HOLD_MS); the second makes 2 bad of the last 4: chaos from her adoption at
// +260 s. Then Alma (+270), me (+300) and Cleo (+330) in plan order: Cleo, adopted 3 s later, is
// the third change in order and ends it. Plan P1 all race.
const C = report({chaos: true}, []);

test('3 chaos phases: one replay phase ended by the order, none live in a recording without det.order', () => {
    const ch = C.puller.chaos;
    assert.deepEqual(ch.replay, [{from: S(260), to: S(332), s: 73, endedBy: 'order'}]);
    assert.deepEqual([ch.live, ch.liveRecorded], [[], false]);
    // Chaos seconds are judged like normal running (the info window shows a puller): no reason
    // excludes them, and the judged ones are counted apart.
    assert.equal(Object.hasOwn(C.puller.excluded, 'chaos'), false);
    assert.ok(ch.judged.replay.s > 60 && ch.judged.replay.s <= 73, JSON.stringify(ch.judged));
    assert.ok(Number.isFinite(ch.judged.replay.agreePct));
    assert.deepEqual(ch.judged.live, {s: 0, agreePct: null});
    assert.match(C.puller.verdict, /; Chaos: Replay 1 Phase \(73 s\)$/);
    // Without chaos: nothing.
    assert.deepEqual([R.puller.chaos.live, R.puller.chaos.replay], [[], []]);
    assert.doesNotMatch(R.puller.verdict, /Chaos/);
});


test('3 chaos phases: the live state (det.order) gives its own phase', () => {
    const L = report({chaos: 'live'}, []).puller.chaos;
    assert.deepEqual([L.live, L.liveRecorded], [[{from: S(M.CHAOS_FROM_S), to: S(M.CHAOS_TO_S - 1), s: 70, endedBy: 'order'}], true]);
    assert.deepEqual(L.replay, C.puller.chaos.replay);
    assert.ok(L.judged.live.s > 60, JSON.stringify(L.judged));
});


test('3 chaos phases: with det.old the live phase comes from det.old.chaos', () => {
    // The turn-clock version records the old core's chaos in det.old only; the windows' own reason
    // never says 'chaos' and det.order is gone.
    const text = M.makeRecording({chaos: 'live', shadow: true});
    const ticks = text.trim().split('\n').slice(1).map(l => JSON.parse(l));
    assert.ok(ticks.every(t => !('order' in t.det) && t.det.reason !== 'chaos'));
    assert.ok(ticks.some(t => t.det.old.chaos === true));
    const L = report({chaos: 'live', shadow: true}, []).puller.chaos;
    assert.deepEqual([L.live, L.liveRecorded], [[{from: S(M.CHAOS_FROM_S), to: S(M.CHAOS_TO_S - 1), s: 70, endedBy: 'order'}], true]);
    assert.deepEqual(L.replay, C.puller.chaos.replay);
    assert.ok(L.judged.live.s > 60, JSON.stringify(L.judged));
    // The same recording without det.old has no live phase: the windows' det alone does not say.
    const bare = text.split('\n').map(l => {
        if (!l.startsWith('{"ts"')) {
            return l;
        }
        const t = JSON.parse(l);
        delete t.det.old;
        return JSON.stringify(t);
    }).join('\n');
    const B = publicResult(analyse(bare, {plans: []}).result).puller.chaos;
    assert.deepEqual([B.live, B.liveRecorded], [[], false]);
});


test('3 chaos phases: liveChaosAt: det.old wins over det.order and reason', () => {
    assert.equal(liveChaosAt({old: {chaos: true}, order: {chaos: false, out: []}, reason: 'climb'}), true);
    assert.equal(liveChaosAt({old: {chaos: false}, order: {chaos: true, out: []}, reason: 'chaos'}), false);
    assert.equal(liveChaosAt({old: {chaos: false}, reason: 'chaos'}), false);
    // A failed shadow step (det.old null, the key stays): no chaos known, nothing is read from the rest.
    assert.equal(liveChaosAt({old: null, order: {chaos: true, out: []}}), false);
    assert.equal(liveChaosAt({old: null, reason: 'climb'}), false);
});


test('3 pausedAt: old recordings keep det.hill / det.climb; the turn clocks pause only while the climb display is on', () => {
    // Old shape (no `old`, no `turn`): today's rule, unchanged.
    assert.equal(pausedAt({hill: 'pause'}), true);
    assert.equal(pausedAt({hill: 'flag'}), false);
    assert.equal(pausedAt({hill: null, climb: true}), false);
    assert.equal(pausedAt({climb: true}), true);
    assert.equal(pausedAt({climb: false}), false);
    assert.equal(pausedAt(null), false);
    // New shape: a real hill alone is no pause, the display (det.turn.disp) is.
    const disp = {why: 'front', at: 1};
    assert.equal(pausedAt({hill: 'pause', climb: true, old: null, turn: {disp: null}}), false);
    assert.equal(pausedAt({hill: 'pause', old: {puller: 1}, turn: {disp: null}}), false);
    assert.equal(pausedAt({hill: 'pause', old: {puller: 1}, turn: {disp}}), true);
    assert.equal(pausedAt({hill: null, old: null, turn: {disp}}), true);
    // The key marks the shape: det.turn alone, or `old` without det.turn (no display known).
    assert.equal(pausedAt({hill: 'pause', turn: {disp: null}}), false);
    assert.equal(pausedAt({hill: 'pause', old: null}), false);
});


// A real hill from race second 200 to 230 (det.hill 'pause'); with `dispFrom..dispTo` the turn clocks'
// climb display is on (new shape), in the old shape the hill alone is the pause.
function hillRecording({shadow, dispFrom = 210, dispTo = 220}) {
    return edited((t, s) => {
        if (s >= 200 && s <= 230) {
            t.det.hill = 'pause';
            t.det.climb = true;
            t.det.reason = s >= dispFrom && s <= dispTo && shadow ? 'climb' : t.det.reason;
        }
        if (shadow) {
            t.det.turn = {change: null, disp: s >= dispFrom && s <= dispTo ? {why: 'front', at: S(dispFrom)} : null,
                          hanging: [], out: []};
        }
    }, {shadow});
}


test('3 pauses: a recording of the turn clocks lists only the climb display, not every real hill', () => {
    const P = publicResult(analyse(hillRecording({shadow: true}), {plans: P2}).result).puller;
    assert.deepEqual(P.pauses.map(p => [p.from, p.s, p.kind]), [[S(210), 11, 'Anstieg']]);
    assert.equal(P.excluded.pause, 11);
    // No display at all on the hill: no pause, the hill's seconds are judged.
    const none = publicResult(analyse(hillRecording({shadow: true, dispFrom: 999, dispTo: 999}), {plans: P2}).result).puller;
    assert.deepEqual(none.pauses, []);
    assert.equal(none.excluded.pause, 0);
    // A display on a descent is listed as Abfahrt.
    const down = publicResult(analyse(edited((t, s) => {
        if (s >= 200 && s <= 230) {
            t.det.hill = 'pause';
        }
        if (s >= 210 && s <= 220) {
            t.det.descent = true;
        }
        t.det.turn = {change: null, disp: s >= 210 && s <= 220 ? {why: 'gap', at: S(210)} : null, hanging: [], out: []};
    }, {shadow: true}), {plans: P2}).result).puller;
    assert.deepEqual(down.pauses.map(p => [p.from, p.s, p.kind]), [[S(210), 11, 'Abfahrt']]);
});


test('3 pauses: an old recording (no det.old, no det.turn) still pauses on every real hill', () => {
    const P = publicResult(analyse(hillRecording({shadow: false}), {plans: P2}).result).puller;
    assert.deepEqual(P.pauses.map(p => [p.from, p.s, p.kind]), [[S(200), 31, 'Anstieg']]);
    assert.equal(P.excluded.pause, 31);
});


test('3 replay fidelity compares the shadow (det.old) with the replay', () => {
    // The windows' puller (the new core) is Cleo all along; the shadow keeps the live puller the old
    // core had. The replay runs the old core: fidelity follows det.old, the live column det.puller.
    const base = report({shadow: true}, []).puller;
    const text = M.makeRecording({shadow: true}).split('\n').map(l => {
        if (!l.startsWith('{"ts"')) {
            return l;
        }
        const t = JSON.parse(l);
        t.det.puller = M.IDS.cleo;
        t.det.frontId = M.IDS.cleo;
        return JSON.stringify(t);
    }).join('\n');
    const x = publicResult(analyse(text, {plans: []}).result).puller;
    assert.equal(base.replay.fidelity[0].frontPct, 100);
    assert.ok(base.replay.fidelity[0].pullerPct > 50, JSON.stringify(base.replay.fidelity));
    assert.deepEqual(x.replay.fidelity, base.replay.fidelity);
    // The live column is the new core: Cleo all along agrees a quarter of the time.
    assert.ok(x.live.agreePct < 40 && base.live.agreePct > 90, `${x.live.agreePct} ${base.live.agreePct}`);
    // Without det.old the top-level fields are the old core's, as in older recordings.
    const old = report({}, []).puller;
    assert.deepEqual(old.replay.fidelity, base.replay.fidelity);
});


test('3 shadow failed: det.old null keeps the new-core shape (every tick, or a single one)', () => {
    const withOld = (text, f) => text.split('\n').map(l => {
        if (!l.startsWith('{"ts"')) {
            return l;
        }
        const t = JSON.parse(l);
        f(t);
        return JSON.stringify(t);
    }).join('\n');
    const text = M.makeRecording({chaos: 'live', cdOld: 5, shadow: true});
    const run = x => publicResult(analyse(x, {plans: []}).result);
    const base = run(text);
    // Every tick: the key `old` is there and null. Still the new core's recording.
    const all = run(withOld(text, t => {
        t.det.old = null;
    }));
    assert.equal(all.puller.live.core, 'new');
    assert.equal(all.puller.chaos.liveRecorded, true);
    assert.deepEqual(all.puller.chaos.live, []);
    assert.deepEqual(all.puller.replay.fidelity, []);
    assert.equal(all.countdown.t0.shadow, null);
    const md = renderMarkdown(publicResult(analyse(withOld(text, t => {
        t.det.old = null;
    }), {plans: []}).result));
    assert.match(md, /live, neuer Kern \(det\.puller\)/);
    assert.doesNotMatch(md, /kein det\.order/);
    // A single failed tick: left out of the fidelity, the rest as before.
    let k = 0;
    const one = run(withOld(text, t => {
        if (t.det.puller !== null && ++k === 50) {
            t.det.old = null;
        }
    }));
    assert.equal(k > 50, true);
    assert.equal(one.puller.live.core, 'new');
    assert.equal(one.puller.chaos.liveRecorded, true);
    const [b, o] = [base.puller.replay.fidelity[0], one.puller.replay.fidelity[0]];
    assert.equal(o.ticks, b.ticks - 1);
    assert.equal(o.frontPct, 100);
    assert.deepEqual(one.puller.chaos.live, base.puller.chaos.live);
});


test('3 chaos phases: how a phase ends (order, plan, finish mode, end)', () => {
    const rows = (flags, {finishFrom = Infinity, planFrom = Infinity} = {}) =>
        [...flags].map((f, i) => ({ts: i * 1000, chaos: f === 'x', finish: i >= finishFrom, sig: i >= planFrom ? 'B' : 'A'}));
    assert.deepEqual(chaosPhases(rows('..xxx..')), [{from: 2000, to: 4000, s: 3, endedBy: 'order'}]);
    // A new plan resets the order state.
    assert.deepEqual(chaosPhases(rows('.xx.', {planFrom: 3})), [{from: 1000, to: 2000, s: 2, endedBy: 'plan'}]);
    // Finish mode takes over (the chaos state is kept there, but the windows show the final sprint).
    assert.deepEqual(chaosPhases(rows('.xxxx', {finishFrom: 3})), [{from: 1000, to: 2000, s: 2, endedBy: 'finish'}]);
    assert.deepEqual(chaosPhases(rows('..xx')), [{from: 2000, to: 3000, s: 2, endedBy: 'end'}]);
    assert.deepEqual(chaosPhases(rows('x.x')), [{from: 0, to: 0, s: 1, endedBy: 'order'}, {from: 2000, to: 2000, s: 1, endedBy: 'end'}]);
    assert.deepEqual(chaosPhases([]), []);
    // A tick is in chaos by the order state, also while a climb pause shows its own reason; never
    // by det.view, which still says 'rest' in chaos.
    assert.deepEqual([liveChaosAt({order: {chaos: true, out: []}, reason: 'climb'}), liveChaosAt({reason: 'chaos'}),
                      liveChaosAt({view: 'rest', order: {chaos: false, out: []}}), liveChaosAt(null)], [true, true, false, false]);
    assert.deepEqual([replayChaosAt({skipped: false, reason: 'climb', rot: {order: {chaos: true}}}),
                      replayChaosAt({skipped: false, reason: null, rot: {order: {chaos: false}}}),
                      replayChaosAt({skipped: true, reason: 'noplan', rot: {order: {chaos: true}}})], [true, false, false]);
});


test('4 countdown: chaos seconds count as silent, not as errors', () => {
    const c = C.countdown;
    // My pulls at +30, +300 and +420 s. As shown (my clock kept counting by the regular schedule):
    // before +300 s the clock said +270 s (−30 s) and, after the jump at +271 s, +390 s (+90 s).
    assert.deepEqual(c.before.map(b => b.start), [S(30), S(300), S(420)]);
    assert.deepEqual(c.before[1].errs, [-150, -30, -30, -30, 90]);
    // With the replay's chaos seconds (+260…+332 s) silent, the looks at +270 and +290 s are no errors.
    const z = c.chaos.replay;
    assert.equal(c.chaos.replayS, 73);
    assert.deepEqual(z.before[1].errs, [-150, -30, -30, 'chaos', 'chaos']);
    assert.deepEqual(z.errorAt.map(e => e.n), [c.errorAt[0].n, c.errorAt[1].n, c.errorAt[2].n, c.errorAt[3].n - 1, c.errorAt[4].n - 1]);
    // The jump at +271 s lies in chaos: not counted there.
    assert.ok(c.jumps.list.some(j => j.at === S(271)), JSON.stringify(c.jumps.list));
    assert.equal(z.jumps, c.jumps.n - 1);
    assert.ok(z.absErrorMedianS <= c.absErrorMedianS, `${z.absErrorMedianS} vs ${c.absErrorMedianS}`);
    assert.match(c.verdict, /; Chaos: live 0 s still, heutige Engine 73 s still: \|Fehler\| Median \d+ → \d+ s$/);
    // Without chaos nothing changes.
    assert.equal(R.countdown.chaos.replayS, 0);
    assert.deepEqual(R.countdown.chaos.replay.before.map(b => b.errs), R.countdown.before.map(b => b.errs));
    assert.doesNotMatch(R.countdown.verdict, /Chaos/);
});


test('4 countdown: the live chaos dash ("≠") is silent, no error', () => {
    const c = report({chaos: 'live'}, []).countdown;
    assert.deepEqual(c.before[1].errs, [-150, -30, -30, 'chaos', 'chaos']);
    assert.equal(c.jumps.list.some(j => j.at === S(271)), false);
    assert.equal(c.chaos.liveS, M.CHAOS_TO_S - M.CHAOS_FROM_S - 30);    // my pull (+300…+329 s) is no dash
});


test('8 views: chaos seconds of the replay are silent for both models', () => {
    const pulls = rotationPulls(4);
    const to = pulls.at(-1).end;
    // Silent from 150 s to 199 s (the tick index here is the second); A pulls 140…179 s, B from 180 s.
    const silent = i => i >= 150 && i < 200;
    const run = key => simulateView(viewRide, pulls, 'me', model(key), {to, tickAt: ts => ts / 1000, silent});
    for (const key of ['old', 'new']) {
        const ser = run(key);
        assert.deepEqual([149, 150, 199, 200].map(s => ser.find(x => x.ts === s * 1000).v === null), [false, true, true, false]);
    }
    const r = publicResult(analyse(M.makeRecording({chaos: true})).result).views;
    assert.equal(r.rules.chaosS, 73);
    assert.equal(R.views.rules.chaosS, 0);
    // In the chaos ride the looks that fall into the replay's chaos (+260…+332 s) have no value.
    const ride = makeRide(parseRecording(M.makeRecording({chaos: true})));
    const w = {from: S(0), to: ride.finish.at};
    const gt = groundTruth(ride, w);
    const looks = v => v.riders.reduce((a, x) => a + x.new.errorAt.reduce((b, e) => b + e.n, 0) + x.old.errorAt.reduce((b, e) => b + e.n, 0), 0);
    const without = viewsCheck(ride, gt, {...w, minPulls: 2});
    const withChaos = viewsCheck(ride, gt, {...w, minPulls: 2, frames: replay(ride).frames});
    assert.ok(looks(withChaos) < looks(without), `${looks(withChaos)} vs ${looks(without)}`);
});


test('report.md: the chaos phases after the pause table, chaos in the countdown', () => {
    const md = renderMarkdown(C);
    const pauses = md.indexOf('**Anstiegs-/Abfahrtspausen:**');
    const chaos = md.indexOf('**Chaos-Phasen**');
    assert.ok(pauses > 0 && chaos > pauses && chaos < md.indexOf('## 4.'), `${pauses} ${chaos}`);
    assert.match(md, /\| Replay \| \+4:20 \| \+5:32 \| 73 \| 3 Wechsel in Planfolge \|/);
    assert.match(md, /live: nicht aufgezeichnet/);
    assert.match(md, /\*\*Chaos \(still statt Countdown\):\*\*/);
    assert.match(renderMarkdown(report({chaos: 'live'}, [])), /\| live \| \+4:25 \| \+5:34 \| 70 \| 3 Wechsel in Planfolge \|/);
    assert.match(renderMarkdown(R), /\*\*Chaos-Phasen\*\*[^\n]*\n\n_keine_/);
});


test('report.md: the countdown against T0', () => {
    const md = renderMarkdown(R);
    assert.match(md, /\*\*Gegen T0\*\*/);
    assert.match(md, /Schatten: entfällt/);
    const sh = renderMarkdown(report({cdOld: 5}));
    assert.match(sh, /Schatten \(feste Zuschläge bis 0\.3\.4-beta\.4, det\.cdOld\): /);
    assert.doesNotMatch(sh, /Schatten: entfällt/);
});


test('report.md: with det.old the live column and the shadow line name the cores', () => {
    const md = renderMarkdown(report({cdOld: 5, shadow: true}));
    assert.match(md, /\| live, neuer Kern \(det\.puller\) \|/);
    assert.match(md, /Schatten: alter Kern \(det\.old\.cd\): /);
    assert.doesNotMatch(md, /det\.cdOld/);
    const older = renderMarkdown(report({cdOld: 5}));
    assert.match(older, /\| live \(det\.puller\) \|/);
    assert.doesNotMatch(older, /neuer Kern|alter Kern/);
});


test('a recording with only its head line: no ticks, no crash', () => {
    const head = M.makeRecording().split('\n')[0] + '\n';
    const r = publicResult(analyse(head).result);
    assert.equal(r.overview.verdict, 'keine Ticks: die Aufzeichnung hat nur die Kopfzeile');
    for (const k of ['pulls', 'puller', 'countdown', 'gaps', 'finish', 'upload', 'views', 'traffic']) {
        assert.equal(r[k].verdict, 'entfällt (keine Ticks)');
    }
    const md = renderMarkdown(r);
    assert.equal((md.match(/^## \d\. /gm) || []).length, 9);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ride-report-'));
    try {
        fs.writeFileSync(path.join(dir, 'head.jsonl'), head);
        assert.equal(run([path.join(dir, 'head.jsonl'), '--out', path.join(dir, 'out')], {log: () => {}}), 0);
    } finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
});


test('6 finish: quiet after the line, or the engine still running', () => {
    assert.match(R.finish.verdict, /bis zum Ende der Aufzeichnung an/);
    const f = report({afterLine: true}).finish;
    assert.deepEqual([f.afterLine.pullerChanges, f.afterLine.gapWarningTicks, f.afterLine.gapMaxM], [1, 2, 31]);
    assert.ok(f.afterLine.finishOffTicks > 0);
    assert.match(f.verdict, /Zielmodus aus \d+ m nach der Linie; danach \d+ s Engine aktiv, 1 Zieherwechsel, 2 s Lückenwarnung \(bis 31 m\)/);
});


// A recording whose ticks carry traffic: fn(raceSecond, tick) gives a tick's traffic (undefined: none).
function withTraffic(fn, opts = {}) {
    return M.makeRecording(opts).trim().split('\n').map((l, i) => {
        if (i === 0) {
            return l;
        }
        const t = JSON.parse(l);
        for (const r of t.riders) {       // as the recorder writes them: the plan riders carry inPlan
            if (Object.values(M.IDS).slice(0, 5).includes(r.id)) {
                r.inPlan = true;
            }
        }
        const traffic = fn(Math.round((t.ts - M.T0) / 1000) - M.PEN_S, t);
        if (traffic !== undefined) {
            t.traffic = traffic;
            t.trafficEpoch = 1;
        }
        return JSON.stringify(t);
    }).join('\n') + '\n';
}
const trafficRow = (gap, n = 1) => ({n, gap, speed: 44, power: 250, draft: 90, sg: false});
const planGaps = t => t.riders.filter(r => Object.values(M.IDS).slice(0, 4).includes(r.id)).map(r => r.gapDistance);
const trafficOf = text => {
    const ride = makeRide(parseRecording(text));
    return trafficCheck(ride, {from: S(0), to: S(60)});
};


test('9 traffic: in front of the team, inside the line, none recorded', () => {
    const text = withTraffic((s, t) => {
        if (s >= 1 && s <= 10) {
            return [trafficRow(-30)];
        }
        if (s >= 11 && s <= 15) {
            const g = planGaps(t);
            return [trafficRow(Math.round((Math.min(...g) + Math.max(...g)) / 2))];
        }
        return s >= 16 && s <= 20 ? [] : undefined;
    });
    const r = trafficOf(text);
    assert.equal(r.recorded, true);
    assert.equal(r.ahead.s, 10);
    assert.equal(r.inLine.s, 5);
    assert.equal(r.maxNear, 1);
    assert.equal(r.raceS, 20);                  // only the ticks with a traffic array are the base
    assert.deepEqual([r.ahead.pct, r.inLine.pct], [50, 25]);
    assert.equal(r.verdict, 'Verkehr vor dem Team in 50 % der Rennzeit, in der Linie in 25 %');
    const old = trafficOf(M.makeRecording());
    assert.equal(old.recorded, false);
    assert.match(old.verdict, /kein Verkehr aufgezeichnet/);
    // the section: heading, verdict and the two table rows (through the whole analysis)
    const md = renderMarkdown(publicResult(analyse(text, {plans: P2}).result));
    assert.match(md, /## 9\. Verkehr\n\n\*\*Ergebnis:\*\* Verkehr vor dem Team in \d+ % der Rennzeit, in der Linie in \d+ %/);
    assert.match(md, /\| vor dem Team \| \d+ \| \d+ \|\n\| in der Linie \| \d+ \| \d+ \|/);
    assert.match(renderMarkdown(R), /## 9\. Verkehr\n\n\*\*Ergebnis:\*\* kein Verkehr aufgezeichnet \(vor 0\.3\.5\)/);
    assert.deepEqual([old.raceS, old.ahead.s, old.inLine.s, old.maxNear], [0, 0, 0, 0]);
    // traffic: null (a failed tick) is no traffic array
    assert.equal(trafficOf(withTraffic(() => null)).recorded, false);
});


test('9 traffic: a rider behind the team is neither ahead nor in the line; the group is chained from me', () => {
    const behind = trafficOf(withTraffic(s => (s >= 1 && s <= 10 ? [trafficRow(50)] : undefined)));
    assert.deepEqual([behind.recorded, behind.ahead.s, behind.inLine.s, behind.maxNear], [true, 0, 0, 1]);
    // Emil (P2 from +240 s) rides 400 m back: not chained to me (steps over 30 m), so a traffic rider
    // at +200 m is behind the group, not inside a line stretching to Emil.
    const ride = makeRide(parseRecording(withTraffic(s => (s >= 250 && s <= 255 ? [trafficRow(200)] : undefined))),
                          {extraPlans: [{sig: 'P2TEST', plan: M.PLAN2}]});
    const e = trafficCheck(ride, {from: S(240), to: S(300)});
    assert.deepEqual([e.recorded, e.ahead.s, e.inLine.s, e.maxNear], [true, 0, 0, 1]);
});


test('9 traffic: a row that is a recorded non-plan rider (local export) is not counted twice', () => {
    // The bench rider is no plan rider and sits at gap +30 - 2k m; the traffic holds him too.
    const dup = withTraffic((s, t) => {
        if (s < 1 || s > 10) {
            return undefined;
        }
        const bench = t.riders.find(r => r.id === M.IDS.bench);
        return [trafficRow(Math.round(bench.gapDistance)), trafficRow(-30, 2)];
    });
    const r = trafficOf(dup);
    assert.equal(r.maxNear, 1);                 // the duplicate is skipped, the anonymous rider stays
    assert.equal(r.ahead.s, 10);
    const only = trafficOf(withTraffic((s, t) => (s >= 1 && s <= 10 ?
        [trafficRow(Math.round(t.riders.find(x => x.id === M.IDS.bench).gapDistance))] : undefined)));
    assert.deepEqual([only.recorded, only.maxNear, only.ahead.s, only.inLine.s], [true, 0, 0, 0]);
});


test('9 traffic: the duplicate rule is the recorder\'s (not me, not inPlan), not the analysis plan\'s', () => {
    const benchGap = t => Math.round(t.riders.find(x => x.id === M.IDS.bench).gapDistance);
    const dup = withTraffic((s, t) => (s >= 1 && s <= 10 ? [trafficRow(benchGap(t))] : undefined));
    // --plan-all names the fallback teammate (no inPlan) in the plan: his copy in traffic is still his.
    const planBench = {...M.PLAN1, sig: 'PB', riders: [...M.PLAN1.riders, {id: M.IDS.bench, name: 'Benno B', pos: 4, pullS: 30, ftp: 300}]};
    const ride = makeRide(parseRecording(dup), {planAll: {sig: 'PB', plan: planBench}});
    const r = trafficCheck(ride, {from: S(0), to: S(60)});
    assert.deepEqual([r.recorded, r.maxNear, r.ahead.s, r.inLine.s], [true, 0, 0, 0]);
    // An inPlan row at the same gap is no copy of a traffic row: the real traffic rider stays.
    const same = withTraffic((s, t) => {
        if (s < 1 || s > 10) {
            return undefined;
        }
        const alma = t.riders.find(x => x.id === M.IDS.alma);
        assert.equal(alma.inPlan, true);
        return [trafficRow(Math.round(alma.gapDistance))];
    });
    const t = trafficOf(same);
    assert.equal(t.maxNear, 1);
});


test('9 traffic: ticks with an unknown plan code are not in the base', () => {
    const text = withTraffic((s, t) => {
        if (s >= 1 && s <= 10) {
            t.det.planSig = 'NOPLAN';          // no plan for this code: skipped like pulls and puller do
        }
        return s >= 1 && s <= 20 ? [trafficRow(-30)] : undefined;
    });
    const r = trafficOf(text);
    assert.equal(r.raceS, 10);                 // the 10 ticks with a known plan
    assert.equal(r.ahead.s, 10);
    assert.equal(r.maxNear, 1);
});


test('7 upload: the head plan only, so a later plan rider is lost', () => {
    assert.deepEqual(R.upload.lostPlanRiders, ['#5']);
    assert.match(R.upload.verdict, /würde #5 verlieren/);
    const stripped = report({stripE: true});
    const s = stripped.upload;
    assert.deepEqual([s.lostPlanRiders, s.absentPlanRiders], [[], ['#5']]);
    assert.equal(stripped.puller.live.unrecordedPullerTicks, 0);    // Emil never pulls
    // A head plan rider without rows was not there (the upload keeps the head plan's riders).
    const noCleo = M.makeRecording().trim().split('\n').map((l, i) => {
        const x = JSON.parse(l);
        if (i > 0) {
            x.riders = x.riders.filter(r => r.id !== M.IDS.cleo);
        }
        return JSON.stringify(x);
    }).join('\n');
    const c = publicResult(analyse(noCleo, {plans: P2}).result);
    assert.deepEqual(c.upload.absentPlanRiders, []);
    assert.deepEqual(c.overview.riders.map(r => [r.missing, r.stripped]), [[['#3'], false], [['#3'], false]]);
});


test('riders by plan position only; first names with names', () => {
    const json = JSON.stringify(R) + renderMarkdown(R);
    for (const id of Object.values(M.IDS)) {
        assert.ok(!json.includes(id), `id ${id} in the report`);
    }
    for (const name of ['Alma', 'Bert', 'Cleo', 'Dora', 'Emil', 'Benno']) {
        assert.ok(!json.includes(name), `${name} in the report`);
    }
    const named = report({}, P2, {names: true});
    assert.equal(named.pulls.pulls[0].who, '#1 Alma');
    assert.equal(named.pulls.pulls[1].who, 'ICH (#2) Bert');
});


test('an old recording without det and shown: the checks say what is missing', () => {
    const lines = M.makeRecording().trim().split('\n').map(l => JSON.parse(l));
    const old = lines.map((x, i) => {
        if (i === 0) {
            return x;
        }
        const {det, shown, event, ...rest} = x;
        return rest;
    });
    const r = publicResult(analyse(old.map(x => JSON.stringify(x)).join('\n'), {}).result);
    assert.deepEqual(r.overview.lacking.map(x => x.field), ['det', 'shown.act', 'det.gap', 'det.hill', 'det.routePos', 'event']);
    assert.equal(r.overview.finish.source, null);
    assert.match(r.overview.verdict, /es fehlen: det, shown\.act, det\.gap, det\.hill, det\.routePos, event/);
    assert.doesNotMatch(r.overview.verdict, /vollständig/);
    assert.match(r.puller.verdict, /entfällt/);
    assert.match(r.countdown.verdict, /entfällt/);
    assert.match(r.finish.verdict, /entfällt/);
    assert.equal(r.gaps.shown, null);
    assert.equal(r.pulls.pulls.length > 10, true);    // the ground truth needs only the rows
    const md = renderMarkdown(r);
    assert.equal((md.match(/^## \d\. /gm) || []).length, 9);
});


test('report.md: nine sections with a verdict each', () => {
    const md = renderMarkdown(R);
    const heads = md.match(/^## \d\. .*/gm);
    assert.deepEqual(heads.map(h => h.slice(3, 5)), ['1.', '2.', '3.', '4.', '5.', '6.', '7.', '8.', '9.']);
    assert.equal((md.match(/^\*\*Ergebnis:\*\* /gm) || []).length, 9);
});


test('CLI: arguments, report.md and report.json', () => {
    assert.deepEqual(parseArgs(['a.jsonl', '--plan', 'ABCDEF=p.json', '--out=x', '--names']),
                     {file: 'a.jsonl', plans: [{sig: 'ABCDEF', path: 'p.json'}], planAll: null, outDir: 'x', names: true});
    assert.throws(() => parseArgs(['a.jsonl', '--bogus']), /unknown option/);
    assert.throws(() => parseArgs(['a.jsonl', 'b.jsonl']), /one recording/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ride-report-'));
    try {
        fs.writeFileSync(path.join(dir, 'rec.jsonl'), M.makeRecording());
        fs.writeFileSync(path.join(dir, 'p2.json'), JSON.stringify(M.PLAN2));
        const log = [];
        const code = run([path.join(dir, 'rec.jsonl'), '--plan', `P2TEST=${path.join(dir, 'p2.json')}`, '--out', path.join(dir, 'out')],
                         {log: x => log.push(x)});
        assert.equal(code, 0);
        assert.equal(log.length, 10);
        const json = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'report.json'), 'utf8'));
        assert.equal(json.kind, 'paceline-ride-report');
        assert.equal(json.file, null);
        assert.equal(json.countdown.jumps.n, 1);
        assert.match(fs.readFileSync(path.join(dir, 'out', 'report.md'), 'utf8'), /^# Fahrtbericht Testers/);
        assert.equal(run([], {log: () => {}}), 2);
    } finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
});


test('CLI: a gzip\'d recording (the server\'s .jsonl.gz) gives the same report as the plain one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ride-report-'));
    try {
        const text = M.makeRecording();
        fs.writeFileSync(path.join(dir, 'rec.jsonl'), text);
        fs.writeFileSync(path.join(dir, 'gz.jsonl.gz'), zlib.gzipSync(text));
        fs.writeFileSync(path.join(dir, 'p2.json'), JSON.stringify(M.PLAN2));
        assert.equal(readRecording(path.join(dir, 'gz.jsonl.gz')), text);
        assert.equal(readRecording(path.join(dir, 'rec.jsonl')), text);
        const plan = `P2TEST=${path.join(dir, 'p2.json')}`;
        assert.equal(run([path.join(dir, 'rec.jsonl'), '--plan', plan], {log: () => {}}), 0);
        assert.equal(run([path.join(dir, 'gz.jsonl.gz'), '--plan', plan], {log: () => {}}), 0);
        // the default folder drops .jsonl.gz as it drops .jsonl
        const plain = fs.readFileSync(path.join(dir, 'rec-report', 'report.json'), 'utf8');
        const gz = fs.readFileSync(path.join(dir, 'gz-report', 'report.json'), 'utf8');
        assert.equal(gz, plain);
        assert.equal(JSON.parse(gz).countdown.jumps.n, 1);
    } finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
});
