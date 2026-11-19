// Run with: node --test tests/ride-report.test.mjs
// The ride report (tools/ride-report) on a made-up recording (tests/fixtures/ride-report/make.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {analyse, publicResult} from '../tools/ride-report/analyse.mjs';
import {parseRecording, readPlan, parsePlanArg} from '../tools/ride-report/load.mjs';
import {renderMarkdown} from '../tools/ride-report/render.mjs';
import {frontPerTick, markSwaps, turnsOf, groundTruth} from '../tools/ride-report/checks/pulls.mjs';
import {simulateView, judgeView, viewsCheck, MODELS} from '../tools/ride-report/checks/views.mjs';
import {makeRide} from '../tools/ride-report/ride.mjs';
import {run, parseArgs} from '../tools/ride-report/report.mjs';
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


test('a recording with only its head line: no ticks, no crash', () => {
    const head = M.makeRecording().split('\n')[0] + '\n';
    const r = publicResult(analyse(head).result);
    assert.equal(r.overview.verdict, 'keine Ticks: die Aufzeichnung hat nur die Kopfzeile');
    for (const k of ['pulls', 'puller', 'countdown', 'gaps', 'finish', 'upload', 'views']) {
        assert.equal(r[k].verdict, 'entfällt (keine Ticks)');
    }
    const md = renderMarkdown(r);
    assert.equal((md.match(/^## \d\. /gm) || []).length, 8);
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
    assert.equal((md.match(/^## \d\. /gm) || []).length, 8);
});


test('report.md: eight sections with a verdict each', () => {
    const md = renderMarkdown(R);
    const heads = md.match(/^## \d\. .*/gm);
    assert.deepEqual(heads.map(h => h.slice(3, 5)), ['1.', '2.', '3.', '4.', '5.', '6.', '7.', '8.']);
    assert.equal((md.match(/^\*\*Ergebnis:\*\* /gm) || []).length, 8);
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
        assert.equal(log.length, 9);
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
