// Check 8, the countdown from every plan rider's view: a recording holds every plan rider, so the
// countdown to the next pull can be simulated with each of them as "me" on the ground truth
// timeline (check 2). Not what any window showed (no puller detection, no presence grace, no
// pauses), but the same model on the same race for every rider: a usable dataset to compare
// countdown models. Reference: docs/countdown-sim/team-clock.mjs (17/18 Nov 2026).
import {RUN_ON_S, CHANGE_ALLOWANCE_S, expectedPullS} from '../../../pages/src/engine/rotation.mjs';
import {median, num} from '../util.mjs';
import {turnsOf} from './pulls.mjs';

export const MIN_PULLS = 5;            // a rider with fewer pulls (turns) has no view of his own
export const START_SKIP_MS = 300000;   // the start chaos: nothing judged in the first 5 min
export const LOOKS_S = [180, 120, 60, 30, 10];
export const ERR_LOOKS_S = [180, 120, 60, 30];    // the error median runs over these
export const LATE_S = 3;               // 10 s before the start the clock said later than this: late
export const SMALL_JUMP_S = [-12, -3]; // a step down by this much (beyond the time passed): a small jump
export const JUMP_S = 3;
export const MY_PULL_MIN_S = 20;       // a turn of mine this long closes a round (presence)

// The countdown models: the expected length of rider r's pull ({id, pullS}) while he is between
// the puller and me, and while he pulls; beforeMe: r is the rider directly before me in the plan
// order (of those present). 'new' is the engine's (rotationView, expectedPullS).
export const MODELS = [
    {key: 'old', label: 'bis 0.3.0-beta.3: Plan + 10 s je Fahrer zwischen Zieher und mir, der Zieher nur sein Plan',
     between: r => r.pullS + CHANGE_ALLOWANCE_S, puller: r => r.pullS},
    {key: 'new', label: 'Engine heute: jeder Fahrer Plan + 10 s, auch der Zieher; der Fahrer direkt vor mir nur sein Plan',
     between: (r, beforeMe) => expectedPullS(r.pullS, beforeMe), puller: (r, beforeMe) => expectedPullS(r.pullS, beforeMe)},
];


// The timeline for my view: the stints of check 2, my own swap turns as one pull of mine (the
// partner's stints inside it are part of my turn).
function timelineFor(pulls, me) {
    const out = [];
    for (let k = 0; k < pulls.length; k++) {
        const p = pulls[k];
        if (p.id === me && p.swap) {
            let m = k;
            for (let j = k + 1; j < pulls.length && pulls[j].swap === p.swap; j++) {
                if (pulls[j].id === me) {
                    m = j;
                }
            }
            out.push({id: me, start: p.start, end: pulls[m].end, i0: p.i0});
            k = m;
        } else {
            out.push(p);
        }
    }
    return out;
}


// One view: the clock per second from the first pull to `to` ({ts, v}: v null during my pull or
// without a plan), with `me` and the model. tickAt(ts): the tick index at ts, for the plan.
export function simulateView(ride, pulls, me, model, {to, tickAt}) {
    const line = timelineFor(pulls, me);
    const myTurns = turnsOf(pulls, me);
    const out = [];
    if (!line.length) {
        return out;
    }
    let k = 0;
    for (let ts = line[0].start; ts < to; ts += 1000) {
        while (k + 1 < line.length && line[k + 1].start <= ts) {
            k++;
        }
        const cur = line[k];
        const plan = ride.planAt(tickAt(ts));
        const R = plan ? plan.riders.map(r => ({id: String(r.id), pullS: r.pullS})) : [];
        const pi = R.findIndex(r => r.id === cur.id);
        const mi = R.findIndex(r => r.id === me);
        if (cur.id === me || pi < 0 || mi < 0) {
            out.push({ts, v: null});
            continue;
        }
        // Present: the riders who pulled between my last two pulls (the live engine knows the
        // chain; this is the proxy), all of the plan before that; the puller always.
        const done = myTurns.filter(t => t.s >= MY_PULL_MIN_S && t.end <= ts);
        const last = done.at(-1), before = done.at(-2);
        const present = last && before ?
            new Set(line.filter(p => p.id !== me && p.start >= before.end && p.start < last.start).map(p => p.id)) :
            new Set(R.map(r => r.id));
        present.add(cur.id);
        let lastBefore = null;
        for (let j = 1; j < R.length; j++) {
            const r = R[(mi - j + R.length) % R.length];
            if (present.has(r.id)) {
                lastBefore = r.id;
                break;
            }
        }
        let between = 0;
        for (let j = 1; j < R.length; j++) {
            const r = R[(pi + j) % R.length];
            if (r.id === me) {
                break;
            }
            if (present.has(r.id)) {
                between += model.between(r, r.id === lastBefore);
            }
        }
        const el = (ts - cur.start) / 1000;
        const v = Math.max(0, between + Math.max(model.puller(R[pi], cur.id === lastBefore) - el, -RUN_ON_S));
        out.push({ts, v: Math.round(v)});
    }
    return out;
}


// The numbers of one view: jumps from evalFrom, the error before each of my pulls that starts
// after evalFrom (the race's first pull left out). starts: [{start, after}]: a look before `after`
// (the end of my pull before) has no value: the clock was counting to that pull.
export function judgeView(series, starts, {evalFrom}) {
    const t0 = series[0]?.ts;
    const at = new Map(series.map(s => [s.ts, s]));
    const near = ts => at.get(t0 + Math.round((ts - t0) / 1000) * 1000);
    const jumps = [];
    for (let i = 1; i < series.length; i++) {
        const a = series[i - 1], b = series[i];
        if (a.v === null || b.v === null || b.ts < evalFrom) {
            continue;
        }
        const e = b.v - a.v + 1;
        if (Math.abs(e) >= JUMP_S) {
            jumps.push(e);
        }
    }
    const errs = starts.map(({start, after = -Infinity}) => LOOKS_S.map(look => {
        const s = near(start - look * 1000);
        return s && s.v !== null && s.ts > after ? Math.round((s.ts + s.v * 1000 - start) / 1000) : null;
    }));
    const iErr = ERR_LOOKS_S.map(l => LOOKS_S.indexOf(l));
    const abs = errs.flatMap(e => iErr.map(i => e[i])).filter(Number.isFinite).map(Math.abs);
    const e10 = errs.map(e => e[LOOKS_S.indexOf(10)]).filter(Number.isFinite);
    return {
        pulls: starts.length,
        errorAt: LOOKS_S.map((look, j) => ({look, medianS: num(median(errs.map(e => e[j]))), n: errs.filter(e => Number.isFinite(e[j])).length})),
        absErrorMedianS: num(median(abs)),
        late: e10.filter(e => e > LATE_S).length,
        n10: e10.length,
        smallJumps: jumps.filter(e => e >= SMALL_JUMP_S[0] && e <= SMALL_JUMP_S[1]).length,
        jumps: jumps.length,
        _abs: abs,
    };
}


// From when every view is judged: START_SKIP_MS after the roll-off, and not before every plan rider
// with rows in the race has them (17 Nov: 0.2.33 recorded only the riders of the plan loaded at the
// time; with --plan-all the correct plan's #1 and #2 had no rows for the first 16 minutes, so
// the timeline missed their pulls).
export function evalStart(ride, {from, to}) {
    const first = new Map();
    ride.ticks.forEach((t, i) => {
        if (t.ts < from || t.ts > to) {
            return;
        }
        const ids = new Set((ride.planAt(i)?.riders || []).map(r => String(r.id)));
        for (const r of t.riders) {
            const id = String(r.id);
            if (ids.has(id) && !first.has(id)) {
                first.set(id, t.ts);
            }
        }
    });
    let at = from + START_SKIP_MS;
    const late = [];
    for (const [id, ts] of first) {
        if (ts > from + START_SKIP_MS) {
            late.push(id);
            at = Math.max(at, ts);
        }
    }
    return {at, late};
}


export function viewsCheck(ride, gt, {from, to, minPulls = MIN_PULLS}) {
    const pulls = gt._pulls;
    if (!pulls?.length) {
        return {skipped: 'keine Züge erkannt', verdict: 'entfällt (keine Züge)'};
    }
    const L = ride.labels;
    const main = ride.plans.get(ride.mainSig);
    if (!main) {
        return {skipped: 'kein Plan bekannt', verdict: 'entfällt (kein Plan)'};
    }
    const tsIdx = ride.ticks.map(t => t.ts);
    let ptr = 0;
    const tickAt = ts => {
        // ts grows within one view; start over for the next one.
        if (ptr > 0 && tsIdx[ptr] > ts) {
            ptr = 0;
        }
        while (ptr + 1 < tsIdx.length && tsIdx[ptr + 1] <= ts) {
            ptr++;
        }
        return ptr;
    };
    const {at: evalFrom, late} = evalStart(ride, {from, to});
    const firstStart = pulls[0].start;
    const riders = [];
    for (const r of main.riders) {
        const id = String(r.id);
        const turns = turnsOf(pulls, id);
        if (turns.length < minPulls) {
            continue;
        }
        const starts = turns.map((t, j) => ({start: t.start, after: j ? turns[j - 1].end : -Infinity}))
            .filter(t => t.start !== firstStart && t.start >= evalFrom);
        const by = {};
        for (const m of MODELS) {
            ptr = 0;
            by[m.key] = judgeView(simulateView(ride, pulls, id, m, {to, tickAt}), starts, {evalFrom});
        }
        riders.push({who: L(id), pulls: turns.length, ...by});
    }
    const total = {};
    for (const m of MODELS) {
        const xs = riders.map(r => r[m.key]);
        const meds = xs.map(x => x.absErrorMedianS).filter(Number.isFinite).sort((a, b) => a - b);
        const n = meds.length;
        total[m.key] = {
            // The median of the riders' medians (the middle two averaged), and over all errors.
            absErrorMedianS: n ? num(n % 2 ? meds[(n - 1) / 2] : (meds[n / 2 - 1] + meds[n / 2]) / 2, 1) : null,
            absErrorAllMedianS: num(median(xs.flatMap(x => x._abs))),
            late: xs.reduce((a, x) => a + x.late, 0),
            n10: xs.reduce((a, x) => a + x.n10, 0),
            smallJumps: xs.reduce((a, x) => a + x.smallJumps, 0),
            jumps: xs.reduce((a, x) => a + x.jumps, 0),
            pulls: xs.reduce((a, x) => a + x.pulls, 0),
        };
    }
    const T = total;
    const verdict = riders.length ?
        `${riders.length} Fahrersichten ab ${minPulls} Zügen; |Fehler| Median ${T.old.absErrorMedianS ?? '–'} → ${T.new.absErrorMedianS ?? '–'} s, ` +
        `zu spät ${T.old.late}/${T.old.n10} → ${T.new.late}/${T.new.n10}, kleine Sprünge ${T.old.smallJumps} → ${T.new.smallJumps} (alt → neu)` :
        `keine Fahrer mit ${minPulls} Zügen`;
    return {
        verdict,
        rules: {minPulls, startSkipS: START_SKIP_MS / 1000, looks: LOOKS_S, errLooks: ERR_LOOKS_S, lateS: LATE_S,
                smallJump: SMALL_JUMP_S, runOnS: RUN_ON_S},
        evalFrom, lateRiders: late.map(L),
        models: MODELS.map(m => ({key: m.key, label: m.label})),
        riders, total,
    };
}
