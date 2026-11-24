// Check 9, traffic: other riders near the team that are not in the plan (the recorder's anonymised
// `traffic`, since 0.3.5: [{n, gap, speed, power, draft, sg}], gap in metres relative to me with
// Sauce's sign, negative = ahead of me). How often was there traffic in front of the team, and
// how often inside its line? Recordings before that version have no traffic: the analysis of
// 22 Nov 2026 had to read it from the front rider's draft instead.
import {FRESH_MS} from '../ride.mjs';
import {num, pct} from '../util.mjs';

export const CHAIN_M = 30;    // a rider this close (or closer) to the next one is part of the team's group

// The team's group in tick i: me and the plan riders with fresh data and a gapDistance, chained
// from me with steps of at most CHAIN_M. {front, rear} (gapDistance, front the smallest) or null.
export function groupAt(ride, i) {
    const t = ride.ticks[i];
    const me = ride.meRows[i];
    if (!me || !Number.isFinite(me.gapDistance) || (me.age ?? 0) > FRESH_MS) {
        return null;
    }
    const ids = new Set((ride.planAt(i)?.riders || []).map(r => String(r.id)));
    const gaps = t.riders.filter(r => r !== me && ids.has(String(r.id)) && (r.age ?? 0) <= FRESH_MS &&
        Number.isFinite(r.gapDistance)).map(r => r.gapDistance);
    let front = me.gapDistance;
    for (const g of gaps.filter(x => x < me.gapDistance).sort((a, b) => b - a)) {
        if (front - g > CHAIN_M) {
            break;
        }
        front = g;
    }
    let rear = me.gapDistance;
    for (const g of gaps.filter(x => x > me.gapDistance).sort((a, b) => a - b)) {
        if (g - rear > CHAIN_M) {
            break;
        }
        rear = g;
    }
    return {front, rear};
}


// The traffic rows of tick i, or null: no traffic array, or no plan known for the tick (it would
// count and collapse the group to me; the puller check and pulls skip such ticks too). The recorder
// puts every rider who is not me and not `inPlan` into `traffic`, and a local export also holds
// the rows of the fallback and watched riders among `riders`: a row whose gap equals the rounded
// gapDistance of such a rider (the recorder's own rule: not me, not inPlan) is him and is not
// counted again. With --plan-all a teammate can be in the analysis plan and still a fallback row
// without inPlan, with his copy in `traffic`.
export function trafficAt(ride, i) {
    const t = ride.ticks[i];
    if (!Array.isArray(t.traffic) || !ride.planAt(i)) {
        return null;
    }
    const me = ride.meRows[i];
    const known = new Set(t.riders.filter(r => r !== me && r.inPlan !== true && Number.isFinite(r.gapDistance))
        .map(r => Math.round(r.gapDistance)));
    return t.traffic.filter(x => x && Number.isFinite(x.gap) && !known.has(x.gap));
}


export function trafficCheck(ride, {from, to}) {
    let raceS = 0;
    let ahead = 0;
    let inLine = 0;
    let maxNear = 0;
    ride.ticks.forEach((t, i) => {
        if (!(t.ts >= from && t.ts < to)) {
            return;
        }
        const rows = trafficAt(ride, i);
        if (!rows) {
            return;
        }
        raceS++;
        maxNear = Math.max(maxNear, rows.length);
        const g = groupAt(ride, i);
        if (!g) {
            return;
        }
        if (rows.some(x => x.gap < g.front)) {
            ahead++;
        }
        if (rows.some(x => x.gap > g.front && x.gap < g.rear)) {
            inLine++;
        }
    });
    const part = s => ({s, pct: num(pct(s, raceS))});
    const out = {recorded: raceS > 0, raceS, ahead: part(ahead), inLine: part(inLine), maxNear};
    out.verdict = out.recorded ?
        `Verkehr vor dem Team in ${out.ahead.pct} % der Rennzeit, in der Linie in ${out.inLine.pct} %` :
        'kein Verkehr aufgezeichnet (vor 0.3.5)';
    return out;
}
