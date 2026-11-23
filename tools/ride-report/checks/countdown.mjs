// Check 4, the countdown to my pull ("recovery") as the windows showed it (shown.act): jumps,
// my recovery phases against the plan, prediction error before my real pulls, READY lead.
import {expectedPullS, WARN_S} from '../../../pages/src/engine/rotation.mjs';
import {easeOffAt} from '../../../pages/src/engine/efficiency.mjs';
import {clockStep, initialClock} from '../../../pages/src/engine/clock.mjs';
import {median, num} from '../util.mjs';
import {turnsOf} from './pulls.mjs';

export const JUMP_S = 3;               // a step that moves the clock by this much more than the time passed
export const STEP_MAX_MS = 2500;       // longer steps are a hole, not a jump
export const LOOKS_S = [240, 120, 60, 30, 10];
export const CLOCK_AFTER_S = 3;        // the clock read this long after my pull ended
export const AWAY_M = 100;             // a plan rider this far from me at my pull's end is not in the rotation
const COUNTING = new Set(['rest', 'next']);
// Against T0 only my turns from this long after the roll-off count (the start is chaotic), as in the
// validation of 21 Nov 2026 (design 2026-11-21-paceline-beta5 §4).
export const T0_FROM_MS = 300000;
// T0 needs the rider before me to have pulled right before my start: a longer pause between his
// stint's end and my start (a hole, a rider without data in between) gives no T0 (as in the
// validation).
const T0_NEAR_MS = 15000;
// Power older than this is no sample for the ease-off (the rows are re-sent while a rider is stale).
const FRESH_MS = 2000;

// The plan's recovery between two pulls of mine by the fixed rule up to 0.3.4-beta.4
// (expectedPullS without the learned E/H; since beta.5 the engine counts the team's learned turn
// time instead, design 2026-11-21-paceline-beta5 §2): the pulls of the others still with the
// group, in plan order from the one after me round to the one directly before me; each with the
// change overhead its own plan length gets (10 s up to 40 s, 5 s above), the rider directly before
// me at plan alone. away(r): r is not in the rotation.
export function recoveryPlanS(riders, selfId, away = () => false) {
    const mi = riders.findIndex(r => String(r.id) === String(selfId));
    const ordered = mi < 0 ? riders : [...riders.slice(mi + 1), ...riders.slice(0, mi)];
    const others = ordered.filter(r => String(r.id) !== String(selfId) && !away(r));
    return others.reduce((s, r, k) => s + expectedPullS(r.pullS, k === others.length - 1), 0);
}

// The countdown series: [{ts, k, t, puller}] up to `to`.
function seriesOf(ride, to) {
    return ride.ticks.filter(t => t.ts <= to).map(t => ({ts: t.ts, k: t.shown?.act?.k ?? null, t: t.shown?.act?.t ?? null,
                                                          puller: t.det?.puller ?? null}));
}


// Jumps: two counting steps in a row whose clock moved by JUMP_S or more against the time passed.
// err < 0: the clock jumped down (my pull came closer at once), > 0: up.
export function jumpsOf(series) {
    const out = [];
    for (let i = 1; i < series.length; i++) {
        const a = series[i - 1], b = series[i];
        if (!COUNTING.has(a.k) || !COUNTING.has(b.k) || b.ts - a.ts > STEP_MAX_MS ||
            !Number.isFinite(a.t) || !Number.isFinite(b.t)) {
            continue;
        }
        const err = (b.t - a.t) + (b.ts - a.ts) / 1000;
        if (Math.abs(err) >= JUMP_S) {
            out.push({ts: b.ts, err, from: a.t, to: b.t, change: a.puller !== b.puller});
        }
    }
    return out;
}


// The series entry nearest to ts (the same second, else one after, before, two after), or null.
function lookup(series) {
    const byS = new Map(series.map(s => [Math.round(s.ts / 1000), s]));
    return ts => {
        const k = Math.round(ts / 1000);
        for (const d of [0, 1, -1, 2]) {
            if (byS.has(k + d)) {
                return byS.get(k + d);
            }
        }
        return null;
    };
}


// The clock's error at each look before my real start `start`: seconds (+ = the clock said later),
// or what showed instead of a countdown (e.g. 'pull', 'chaos', 'none'), null without a tick.
function errsAt(at, start) {
    return LOOKS_S.map(look => {
        const s = at(start - look * 1000);
        if (!s) {
            return null;
        }
        return COUNTING.has(s.k) && Number.isFinite(s.t) ? num((s.ts + s.t * 1000 - start) / 1000) : s.k;
    });
}


// The clock's error at each look before T0 (the rider before me eases off): seconds (+ = the clock
// said later), what showed instead, or null without a tick or when the look falls at or before my
// previous turn's end (that clock counted to my previous pull).
function errsAtT0(at, T0, prevEnd) {
    return LOOKS_S.map(look => {
        const ts = T0 - look * 1000;
        if (ts <= prevEnd) {
            return null;
        }
        const s = at(ts);
        if (!s) {
            return null;
        }
        return COUNTING.has(s.k) && Number.isFinite(s.t) ? num((s.ts + s.t * 1000 - T0) / 1000) : s.k;
    });
}


// The onset of the last READY run ('next') in (lo, start + 10 s], or null.
function readyOnset(series, lo, start) {
    let ready = null;
    let prevK = null;
    for (const s of series) {
        if (s.ts > lo && s.ts <= start + 10000 && s.k === 'next' && prevK !== 'next') {
            ready = s.ts;
        }
        prevK = s.k;
    }
    return ready;
}


// T0 of a stint p ({id, start, end, i0, i1}) by the one T0 rule (efficiency.mjs easeOffAt, the 85 %
// rule; decision 1 of the beta.5 plan): the rider's fresh power on the stint's ticks and the two
// before it (the median of 3 needs them at the start). ms, or null when the rule finds no step.
export function stintEaseOff(ride, p) {
    const samples = [];
    for (let i = Math.max(0, p.i0 - 2); i <= p.i1 && i < ride.ticks.length; i++) {
        const t = ride.ticks[i];
        const row = t.riders?.find(r => String(r.id) === String(p.id));
        const w = row && Number.isFinite(row.power) && Number.isFinite(row.age) && row.age <= FRESH_MS ? row.power : null;
        samples.push([t.ts, w]);
    }
    return easeOffAt(samples, {from: p.start, to: p.end});
}


function errorAtOf(errs) {
    return LOOKS_S.map((look, j) => ({look, medianS: num(median(errs.map(e => e[j]).filter(Number.isFinite))),
                                      n: errs.filter(e => Number.isFinite(e[j])).length}));
}


// The median of the absolute errors over all looks before all my pulls.
function absErrorOf(errs) {
    return num(median(errs.flat().filter(Number.isFinite).map(Math.abs)));
}


// The shadow series: the fixed rule's countdown (det.cdOld, recorded since 0.3.4-beta.5) through
// the windows' clock (clock.mjs), as the windows would have shown it: [{ts, k, t}], READY ('next')
// at WARN_S or less. Stepped only while the live window showed a countdown (shown.act.k rest or
// next): cdOld is also recorded in chaos, where no countdown shows (the dim "≠"), so chaos ticks
// do not count, as they do not count live (21 Nov 2026). null without any cdOld.
function shadowSeriesOf(ride, to) {
    if (!ride.ticks.some(t => t.det?.cdOld && typeof t.det.cdOld === 'object')) {
        return null;
    }
    let clk = initialClock();
    return ride.ticks.filter(t => t.ts <= to).map(t => {
        const k = t.shown?.act?.k ?? null;
        const old = t.det?.cdOld;
        const on = COUNTING.has(k) && old && Number.isFinite(old.t);
        clk = clockStep(clk, {now: t.ts, trueS: on ? old.t : null, standing: on ? !!old.standing : false});
        if (!on) {
            return {ts: t.ts, k: COUNTING.has(k) ? 'none' : k, t: null};
        }
        const s = Math.floor(clk.shownS);
        return {ts: t.ts, k: s <= WARN_S ? 'next' : 'rest', t: s};
    });
}


// The countdown against T0 (the new definition of its 0: the rider before me eases off; user,
// 21 Nov 2026; design 2026-11-21-paceline-beta5 §4), on one series. Rows: every turn of mine but
// the first whose rider before me pulled right before it; the summary over the rows from
// T0_FROM_MS on (main). The same measurement as the validation of 21 Nov 2026, on the recorder's
// view.
function againstT0(series, rows, from) {
    const at = lookup(series);
    const before = rows.map(r => {
        const ready = readyOnset(series, r.prevEnd, r.start);
        return {start: r.start, T0: r.T0, main: r.start >= from + T0_FROM_MS, errs: errsAtT0(at, r.T0, r.prevEnd),
                readyLeadS: ready === null ? null : num((r.start - ready) / 1000 - (r.start - r.T0) / 1000)};
    });
    const main = before.filter(b => b.main);
    const errs = main.map(b => b.errs);
    const all = errs.flat().filter(Number.isFinite);
    const at10 = errs.map(e => e[LOOKS_S.length - 1]).filter(Number.isFinite);
    return {before, n: main.length, errorAt: errorAtOf(errs), signedMedianS: num(median(all)), absErrorMedianS: absErrorOf(errs),
            late10Pct: at10.length ? num(100 * at10.filter(e => e > 3).length / at10.length) : null,
            readyLeadMedianS: num(median(main.map(b => b.readyLeadS)))};
}


export function countdownCheck(ride, gt, {from, to, frames = null}) {
    if (!ride.ticks.some(t => t.shown?.act)) {
        return {skipped: 'keine shown.act in der Aufzeichnung', verdict: 'entfällt (keine Fensteraufzeichnung)'};
    }
    const L = ride.labels;
    const series = seriesOf(ride, to);
    const jumps = jumpsOf(series);
    const at = lookup(series);
    const pulls = gt._pulls;
    // My pulls: a swap turn of mine (check 2) is one pull, from its first stint to its last.
    const mine = turnsOf(pulls, ride.selfId).map(t => [{...t, i0: pulls[t.k0].i0, i1: pulls[t.k1].i1}, t]);
    // Recovery: my pull end → my next pull start.
    const recovery = [];
    for (let k = 0; k + 1 < mine.length; k++) {
        const [a, ta] = mine[k], [b, tb] = mine[k + 1];
        const mid = pulls.slice(ta.k1 + 1, tb.k0);
        const eff = (b.start - a.end) / 1000;
        const plan = ride.planAt(a.i1);
        // The others with the group at my pull's end: a rider whose data puts him more than
        // AWAY_M from me is gone (dropped) and the engine skips him. A rider without a row then
        // is judged by his last row before (12 Nov 2026, one team: #4's rows ended 1.8 km back and
        // he came back into this sum); one who never had a row counts (not recorded).
        const away = r => {
            for (let i = a.i1; i >= 0; i--) {
                const row = ride.ticks[i].riders.find(x => String(x.id) === String(r.id));
                if (row) {
                    const myD = ride.meRows[i]?.eventDistance;
                    return Number.isFinite(myD) && Number.isFinite(row.eventDistance) && Math.abs(row.eventDistance - myD) > AWAY_M;
                }
            }
            return false;
        };
        const gone = plan ? plan.riders.filter(r => String(r.id) !== ride.selfId && away(r)).map(r => L(r.id)) : [];
        const planS = plan ? recoveryPlanS(plan.riders, ride.selfId, away) : null;
        const s3 = at(a.end + CLOCK_AFTER_S * 1000);
        const midS = mid.reduce((s, p) => s + p.s, 0);
        const planOf = id => plan?.riders.find(r => String(r.id) === id)?.pullS ?? null;
        recovery.push({end: a.end, next: b.start, effS: num(eff), planS, sig: plan?.sig ?? null, gone,
                       clockS: s3 && COUNTING.has(s3.k) ? s3.t : null, clockKind: s3?.k ?? null,
                       between: mid.map(p => ({who: L(p.id), s: num(p.s), planS: planOf(p.id)})),
                       unseenS: num(eff - midS)});
    }
    // Before each of my real pulls: the clock's error at fixed looks, READY lead, "pull" shown.
    const before = mine.map(([p], k) => {
        const errs = errsAt(at, p.start);
        const lo = k > 0 ? mine[k - 1][0].end : from;
        const ready = readyOnset(series, lo, p.start);
        // "Pull" shown: the start of the "pull" run going on at my real start, else the first one
        // within a minute after it (no limit backwards).
        let pullAt = null;
        const i0 = series.findIndex(s => s.ts >= p.start);
        if (i0 >= 0 && series[i0].k === 'pull') {
            let j = i0;
            while (j > 0 && series[j - 1].k === 'pull' && series[j].ts - series[j - 1].ts <= STEP_MAX_MS) {
                j--;
            }
            pullAt = series[j].ts;
        } else {
            pullAt = series.find(s => s.ts >= p.start && s.ts <= p.start + 60000 && s.k === 'pull')?.ts ?? null;
        }
        return {start: p.start, errs, readyLeadS: ready === null ? null : num((p.start - ready) / 1000),
                pullShownS: pullAt === null ? null : num((pullAt - p.start) / 1000)};
    });
    const down = jumps.filter(j => j.err < 0), up = jumps.filter(j => j.err > 0);
    const errAt = errorAtOf(before.map(b => b.errs));
    // Chaos (20 Nov 2026, spec 2026-11-20-paceline-chaos-counter section 6): while the order does
    // not hold the windows show no countdown (act 'chaos', the dim "≠"), so those seconds are silent,
    // not errors; COUNTING leaves them out already. The same once more with the seconds the current
    // engine would be silent in (the replay's reason 'chaos'): a recording made before the chaos
    // counter still shows its countdown there. My own pull stays (it is real in chaos too).
    const quiet = new Set();
    (frames || []).forEach((f, i) => {
        if (!f.skipped && f.reason === 'chaos' && ride.ticks[i].ts >= from && ride.ticks[i].ts <= to) {
            quiet.add(ride.ticks[i].ts);
        }
    });
    const silenced = series.map(s => (quiet.has(s.ts) && COUNTING.has(s.k) ? {...s, k: 'chaos', t: null} : s));
    const atQ = lookup(silenced);
    const beforeQ = mine.map(([p]) => ({start: p.start, errs: errsAt(atQ, p.start)}));
    const chaos = {
        liveS: series.filter(s => s.ts >= from && s.k === 'chaos').length,
        replayS: quiet.size,
        replay: {jumps: jumpsOf(silenced).length, errorAt: errorAtOf(beforeQ.map(b => b.errs)),
                 absErrorMedianS: absErrorOf(beforeQ.map(b => b.errs)), before: beforeQ},
    };
    // Against T0: T0 = the ease-off of the rider who pulled right before my turn, else his stint's end.
    const t0Rows = [];
    mine.forEach(([p, t], k) => {
        const pb = k > 0 && t.k0 > 0 ? pulls[t.k0 - 1] : null;
        if (pb && p.start - pb.end <= T0_NEAR_MS) {
            t0Rows.push({start: p.start, T0: stintEaseOff(ride, pb) ?? pb.end, prevEnd: mine[k - 1][0].end});
        }
    });
    const shadowSeries = shadowSeriesOf(ride, to);
    const t0 = {...againstT0(series, t0Rows, from), shadow: shadowSeries ? againstT0(shadowSeries, t0Rows, from) : null};
    const effVsPlan = recovery.filter(r => r.planS !== null).map(r => r.effS - r.planS);
    const out = {
        jumps: {n: jumps.length, down: down.length, up: up.length, atChange: jumps.filter(j => j.change).length,
                list: jumps.map(j => ({at: j.ts, fromS: j.from, toS: j.to, errS: num(j.err), change: j.change}))},
        myPulls: mine.length,
        recovery,
        recoveryVsPlanMedianS: num(median(effVsPlan)),
        before,
        errorAt: errAt,
        absErrorMedianS: absErrorOf(before.map(b => b.errs)),
        readyLeadMedianS: num(median(before.map(b => b.readyLeadS))),
        pullShownMedianS: num(median(before.map(b => b.pullShownS))),
        t0,
    };
    out.verdict = `${jumps.length} Sprünge ≥ ${JUMP_S} s (${down.length} runter, ${up.length} hoch, ${out.jumps.atChange} beim Zieherwechsel); ` +
        `${mine.length} eigene Züge, Erholung gegen Plan Median ${out.recoveryVsPlanMedianS ?? '–'} s; ` +
        `Fehler 60 s vorher Median ${errAt[2].medianS ?? '–'} s; READY ${out.readyLeadMedianS ?? '–'} s vorher; ` +
        `gegen T0 |Fehler| Median ${t0.absErrorMedianS ?? '–'} s` + (t0.shadow ? ` (fest ${t0.shadow.absErrorMedianS ?? '–'} s)` : '');
    out.chaos = chaos;
    if (chaos.liveS || chaos.replayS) {
        out.verdict += `; Chaos: live ${chaos.liveS} s still, heutige Engine ${chaos.replayS} s still: ` +
            `|Fehler| Median ${out.absErrorMedianS ?? '–'} → ${chaos.replay.absErrorMedianS ?? '–'} s`;
    }
    return out;
}
