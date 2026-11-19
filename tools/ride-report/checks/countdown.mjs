// Check 4, the countdown to my pull ("recovery") as the windows showed it (shown.act): jumps,
// my recovery phases against the plan, prediction error before my real pulls, READY lead.
import {CHANGE_ALLOWANCE_S} from '../../../pages/src/engine/rotation.mjs';
import {median, num} from '../util.mjs';
import {turnsOf} from './pulls.mjs';

export const JUMP_S = 3;               // a step that moves the clock by this much more than the time passed
export const STEP_MAX_MS = 2500;       // longer steps are a hole, not a jump
export const LOOKS_S = [240, 120, 60, 30, 10];
export const CLOCK_AFTER_S = 3;        // the clock read this long after my pull ended
export const AWAY_M = 100;             // a plan rider this far from me at my pull's end is not in the rotation
const COUNTING = new Set(['rest', 'next']);

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


export function countdownCheck(ride, gt, {from, to}) {
    if (!ride.ticks.some(t => t.shown?.act)) {
        return {skipped: 'keine shown.act in der Aufzeichnung', verdict: 'entfällt (keine Fensteraufzeichnung)'};
    }
    const L = ride.labels;
    const series = seriesOf(ride, to);
    const jumps = jumpsOf(series);
    const byS = new Map(series.map(s => [Math.round(s.ts / 1000), s]));
    const at = ts => {
        const k = Math.round(ts / 1000);
        for (const d of [0, 1, -1, 2]) {
            if (byS.has(k + d)) {
                return byS.get(k + d);
            }
        }
        return null;
    };
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
        const others = plan ? plan.riders.filter(r => String(r.id) !== ride.selfId && !away(r)) : [];
        const gone = plan ? plan.riders.filter(r => String(r.id) !== ride.selfId && away(r)).map(r => L(r.id)) : [];
        // As the engine counts at the change: the others' pulls, a change allowance for each of
        // them but the rider directly before me.
        const planS = plan ? others.reduce((s, r) => s + r.pullS, 0) + CHANGE_ALLOWANCE_S * Math.max(0, others.length - 1) : null;
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
        const errs = LOOKS_S.map(look => {
            const s = at(p.start - look * 1000);
            if (!s) {
                return null;
            }
            return COUNTING.has(s.k) && Number.isFinite(s.t) ? num((s.ts + s.t * 1000 - p.start) / 1000) : s.k;
        });
        const lo = k > 0 ? mine[k - 1][0].end : from;
        let ready = null;
        let prevK = null;
        for (const s of series) {
            if (s.ts <= lo || s.ts > p.start + 10000) {
                prevK = s.k;
                continue;
            }
            if (s.k === 'next' && prevK !== 'next') {
                ready = s.ts;
            }
            prevK = s.k;
        }
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
    const errAt = LOOKS_S.map((look, j) => ({look, medianS: num(median(before.map(b => b.errs[j]).filter(Number.isFinite))),
                                            n: before.filter(b => Number.isFinite(b.errs[j])).length}));
    const effVsPlan = recovery.filter(r => r.planS !== null).map(r => r.effS - r.planS);
    const out = {
        jumps: {n: jumps.length, down: down.length, up: up.length, atChange: jumps.filter(j => j.change).length,
                list: jumps.map(j => ({at: j.ts, fromS: j.from, toS: j.to, errS: num(j.err), change: j.change}))},
        myPulls: mine.length,
        recovery,
        recoveryVsPlanMedianS: num(median(effVsPlan)),
        before,
        errorAt: errAt,
        readyLeadMedianS: num(median(before.map(b => b.readyLeadS))),
        pullShownMedianS: num(median(before.map(b => b.pullShownS))),
    };
    out.verdict = `${jumps.length} Sprünge ≥ ${JUMP_S} s (${down.length} runter, ${up.length} hoch, ${out.jumps.atChange} beim Zieherwechsel); ` +
        `${mine.length} eigene Züge, Erholung gegen Plan Median ${out.recoveryVsPlanMedianS ?? '–'} s; ` +
        `Fehler 60 s vorher Median ${errAt[2].medianS ?? '–'} s; READY ${out.readyLeadMedianS ?? '–'} s vorher`;
    return out;
}
