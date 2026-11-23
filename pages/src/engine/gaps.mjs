// Gaps in the team line (user, 13 Nov 2026): a rider who loses the wheel, or the whole group behind
// the puller. From the three recorded races: every real drop was a gap of 10 m or more to the
// rider ahead for several seconds (the draft goes too), while the line normally rides 0–5 m apart
// with ±2 m of noise. So: the gap to the rider ahead, the median of the last GAP_SMOOTH_N steps,
// opens a warning after GAP_HOLD_MS at GAP_ON_M or more (GAP_HILL_ON_M on a real climb or
// descent, where gaps open anyway) and closes it after GAP_CLEAR_MS below GAP_OFF_M. That gave
// 4–8 warnings per race. A gap that grows to GAP_LOST_M is a rider (or group) let go: the warning
// ends there and comes back only after the gap has closed (a rider dropped for good stayed on the
// screen for minutes otherwise). A rider further than GAP_GONE_M from everyone is not followed.
// Where the gap is says who: right behind the front rider = the group, before the last rider =
// one rider, anywhere else = a split.
// Critical (user, 13 Nov 2026): the team's time is taken on its `needed`-th rider over the line
// (WTRL and ZRL: the 4th, GAP_FINISHERS). A gap is critical when fewer than that are still with
// the front ahead of it: then nobody behind it may be lost, so it is never let go either. With
// riders to spare, the last one may drop.
// Two stages (user, 13 Nov 2026): the draft starts to fade from 6 m (about 31 % of the power up
// to 5 m, 22 % at 8 m, 14 % at 10 m, none from 15 m), but 6 m is within the line's normal spread
// (20 to 70 warnings a race). So an early stage from GAP_EARLY_M (8–15 a race, 2–6 s before the
// warning at the real drops), opened and closed like the warning.
// Earlier early stage (user, 17 Nov 2026; analysis of the ZRL race of 17 Nov and the three races of
// 12 Nov): two more ways open it before GAP_HOLD_MS is up; the full warning is unchanged.
// - Area: per rider pair the sum of (m − early threshold) over the seconds at or above it (each
//   step counts at most 2 s), from GAP_AREA_MS metre-seconds: a gap that grows quickly past 8 m
//   warns within 1–2 s. It starts over below the threshold and when the rider ahead changes.
// - Watch: on the raw gap (not smoothed), armed from GAP_ARM_M (until below GAP_DISARM_M or the
//   rider ahead changes). A step counts when both riders' data is at most GAP_WATCH_AGE_MS old,
//   the rider behind is GAP_WATCH_DV_KMH or more slower than the one ahead and rides at most
//   GAP_WATCH_P of his mean power over his previous samples (the last GAP_POWER_N per rider, kept
//   when inactive; none before GAP_POWER_MIN): he is easing off, not just swinging. Early after
//   GAP_WATCH_N counting steps in a row at GAP_WATCH_M or more.
// On a real climb or descent all thresholds move up by GAP_HILL_EARLY_M − GAP_EARLY_M. Together a
// median 2–6 s earlier per race at the real drops, 0–4 more warnings a race.
// Closing (user, 17 Nov 2026: the gap is there, but green): of the gaps of 6–20 m in the four races
// the rider behind closed 60–65 % himself (1.1–1.8 km/h faster, the front only 0.2–0.4 km/h
// slower). So a gap whose raw value fell by GAP_CLOSE_M or more over the last GAP_CLOSE_STEPS steps
// (at most GAP_CLOSE_SPAN_MS apart), with the rider behind GAP_CLOSE_DV_KMH or more faster than the
// one ahead (both data at most GAP_CLOSE_AGE_MS old), is closing; it stays so until the smoothed gap
// is GAP_CLOSE_M above its lowest since then (slow regrowth too; one wild raw sample does not move
// the median), the smoothed gap is under GAP_OFF_M (gone), the state is reset, or the rider ahead
// changes with a raw gap GAP_CLOSE_M or more larger than the old pair's last one (riders swapping
// places while it keeps shrinking: no 2 s of amber in between).
// 53 of the 64 gaps marked so then closed, 1 grew again. Only a flag for the display: the warning
// itself opens and clears as above. Pure logic (no DOM, no Sauce imports).

export const GAP_ON_M = 10;
export const GAP_HILL_ON_M = 15;
export const GAP_EARLY_M = 8;
export const GAP_HILL_EARLY_M = 12;
export const GAP_OFF_M = 6;
export const GAP_HOLD_MS = 5000;
export const GAP_CLEAR_MS = 3000;
export const GAP_SMOOTH_N = 3;
export const GAP_LOST_M = 50;
export const GAP_GONE_M = 300;
export const GAP_FINISHERS = 4;    // the plan's minimum finishers when it gives none
export const GAP_MIN_KMH = 10;    // slower (a stop, a wall): the gap in seconds means nothing
// The earlier early stage (17 Nov 2026, replay of 4 races): area and watch.
export const GAP_AREA_MS = 4;        // metre-seconds (not milliseconds) above the early threshold
export const GAP_AREA_DT_S = 2;      // the most one step counts for, in seconds
export const GAP_ARM_M = 5;
export const GAP_DISARM_M = 4;
export const GAP_WATCH_M = 7;
export const GAP_WATCH_DV_KMH = -1.5;   // the rider behind minus the rider ahead
export const GAP_WATCH_P = 0.9;         // of his mean power over his previous samples
export const GAP_WATCH_N = 2;           // counting steps in a row
export const GAP_WATCH_AGE_MS = 2000;
export const GAP_POWER_N = 30;       // power samples kept per rider (one a step), the current one included
export const GAP_POWER_MIN = 10;     // samples (the current one included) before his mean counts
// Closing (17 Nov 2026, the same 4 races).
export const GAP_CLOSE_M = 1;           // raw smaller by this to turn on, smoothed above its low by this to turn off
export const GAP_CLOSE_STEPS = 2;       // over the last steps
export const GAP_CLOSE_SPAN_MS = 3200;  // the most those steps may span
export const GAP_CLOSE_DV_KMH = 0.5;    // the rider behind minus the rider ahead, at least
export const GAP_CLOSE_AGE_MS = 2000;


export function initialGaps() {
    return {riders: {}, frontId: null, pw: {}};
}


function median(xs) {
    const s = [...xs].sort((a, b) => a - b);
    return s[(s.length - 1) >> 1];
}


// positions: [{id, x}] of the plan riders, front first (larger x = further ahead). The riders
// linked to me by steps of at most GAP_GONE_M (to the front rider's group when I am not among them).
export function gapGroup(positions, selfId) {
    const ps = positions || [];
    if (!ps.length) {
        return [];
    }
    const i = Math.max(0, ps.findIndex(p => p.id === selfId));
    let a = i;
    while (a > 0 && ps[a - 1].x - ps[a].x <= GAP_GONE_M) {
        a--;
    }
    let b = i;
    while (b < ps.length - 1 && ps[b].x - ps[b + 1].x <= GAP_GONE_M) {
        b++;
    }
    return ps.slice(a, b + 1);
}


// The rider's mean power over his samples before the current one, or NaN with fewer than
// GAP_POWER_MIN in all.
function meanBefore(xs) {
    if (!xs || xs.length < GAP_POWER_MIN) {
        return NaN;
    }
    return xs.slice(0, -1).reduce((a, b) => a + b, 0) / (xs.length - 1);
}


// One step. active: false (no live data, start lock, final sprint, standing, muted) forgets
// everything but the power history, so a warning never outlives the situation it was about. hill:
// a real climb or descent (the rotation's pause). needed: the riders the team must bring over the
// line. riders: {[id]: {speed (km/h), power (W), age (ms)}} of the plan riders and me, for the
// watch rule (without it the watch never fires).
export function gapStep(prev, {now, positions, selfId, active, hill = false, needed = GAP_FINISHERS,
                               riders: rows = {}}) {
    // One power sample per rider and step, also while inactive.
    const pw = {...(prev.pw || {})};
    for (const [id, r] of Object.entries(rows || {})) {
        if (Number.isFinite(r?.power)) {
            pw[id] = [...(pw[id] || []), r.power].slice(-GAP_POWER_N);
        }
    }
    if (!active) {
        return {...initialGaps(), pw};
    }
    const group = gapGroup(positions, selfId);
    const onM = hill ? GAP_HILL_ON_M : GAP_ON_M;
    const earlyM = hill ? GAP_HILL_EARLY_M : GAP_EARLY_M;
    const off = earlyM - GAP_EARLY_M;    // the watch thresholds on a hill
    const riders = {};
    let firstBreak = null;    // the first rider (from the front) behind a gap: the front group ends there
    for (let i = 1; i < group.length; i++) {
        const id = group[i].id;
        const aheadId = group[i - 1].id;
        const p = prev.riders[id] ??
            {hist: [], above: null, aboveEarly: null, below: null, open: false, early: false, lost: false};
        // Smoothed per pair: when the rider ahead changes (riders swap places), the history is of
        // another gap and starts over (so do the area and the watch).
        const same = p.ahead === aheadId;
        const g = group[i - 1].x - group[i].x;
        const hist = same ? [...p.hist, g].slice(-GAP_SMOOTH_N) : [g];
        const m = median(hist);
        const above = m >= onM ? p.above ?? now : null;
        const aboveEarly = m >= earlyM ? p.aboveEarly ?? now : null;
        const below = m < GAP_OFF_M ? p.below ?? now : null;
        const cleared = below !== null && now - below >= GAP_CLEAR_MS;
        let open = p.open;
        if (!open && above !== null && now - above >= GAP_HOLD_MS) {
            open = true;
        } else if (open && cleared) {
            open = false;
        }
        // Area above the early threshold.
        const dt = p.t != null ? (now - p.t) / 1000 : 1;
        const area = m >= earlyM ? (same ? p.area ?? 0 : 0) + (m - earlyM) * Math.min(dt, GAP_AREA_DT_S) : 0;
        // Watch: the rider behind slower than the one ahead and easing off.
        const armed = same && p.armed ? g >= GAP_DISARM_M + off : g >= GAP_ARM_M + off;
        const b = rows?.[id];
        const h = rows?.[aheadId];
        const fresh = !!b && !!h && (b.age ?? 0) <= GAP_WATCH_AGE_MS && (h.age ?? 0) <= GAP_WATCH_AGE_MS;
        const counts = armed && fresh && Number.isFinite(b.speed) && Number.isFinite(h.speed) &&
            b.speed - h.speed <= GAP_WATCH_DV_KMH && Number.isFinite(b.power) &&
            b.power <= GAP_WATCH_P * meanBefore(pw[id]);
        const watch = counts ? (same ? p.watch ?? 0 : 0) + 1 : 0;
        // Closing on: the raw gap's change over the last GAP_CLOSE_STEPS steps (null with fewer, or when
        // they span more than GAP_CLOSE_SPAN_MS).
        const gs = same ? [...(p.gs ?? []), [now, g]].slice(-GAP_CLOSE_STEPS - 1) : [[now, g]];
        const dg = gs.length > GAP_CLOSE_STEPS && now - gs[0][0] <= GAP_CLOSE_SPAN_MS ? g - gs[0][1] : null;
        const faster = !!b && !!h && (b.age ?? 0) <= GAP_CLOSE_AGE_MS && (h.age ?? 0) <= GAP_CLOSE_AGE_MS &&
            Number.isFinite(b.speed) && Number.isFinite(h.speed) && b.speed - h.speed >= GAP_CLOSE_DV_KMH;
        // Carried over a new pair (riders swapping places while the gap keeps shrinking) unless the
        // gap jumped up by GAP_CLOSE_M or more; gone once the smoothed gap is under GAP_OFF_M.
        // Off once the smoothed gap is GAP_CLOSE_M above its low since closing turned on (lo; at turn-on
        // the lowest of m and the raw gaps that turned it on, as the median lags).
        const kept = p.closing && (same || g - p.g < GAP_CLOSE_M);
        const lo0 = kept ? Math.min(p.lo ?? m, m) : m;
        const closing = m >= GAP_OFF_M && (kept ? m - lo0 < GAP_CLOSE_M :
            dg !== null && dg <= -GAP_CLOSE_M && faster);
        const lo = closing ? (kept ? lo0 : Math.min(m, ...gs.map(x => x[1]))) : null;
        let early = p.early;
        const trig = (aboveEarly !== null && now - aboveEarly >= GAP_HOLD_MS) || area >= GAP_AREA_MS ||
            (watch >= GAP_WATCH_N && g >= GAP_WATCH_M + off);
        if (!early && trig) {
            early = true;
        } else if (early && cleared) {
            early = false;
        }
        const critical = (firstBreak ?? i) < needed;
        // Let go only while the team can spare them; once let go, they stay so until the gap closes
        // (a gap opening further ahead later does not bring them back). Riders together with one let
        // go are let go too, so they keep it when they swap places among themselves.
        const aheadLost = i > 1 && riders[group[i - 1].id].lost;
        const lost = (aheadLost && m < GAP_ON_M) || (p.lost && (m >= GAP_OFF_M || aheadLost)) ||
            (!critical && m >= GAP_LOST_M);
        riders[id] = {hist, above, aboveEarly, below, open: open && !lost, early: (early || open) && !lost, lost,
                      critical, m, g, t: now, area, armed, watch, gs, closing, lo, at: i, ahead: aheadId, behind: []};
        if (firstBreak === null && (open || lost)) {
            firstBreak = i;
        }
    }
    // Who a gap cuts off: the riders still together behind it, up to the next real gap (one let go,
    // open, or GAP_ON_M and more): riders further back are counted by their own gap.
    const apart = r => r.lost || r.open || r.m >= GAP_ON_M;
    for (let i = 1; i < group.length; i++) {
        let j = i + 1;
        while (j < group.length && !apart(riders[group[j].id])) {
            j++;
        }
        riders[group[i].id].behind = group.slice(i, j).map(c => c.id);
    }
    return {riders, frontId: group.length ? group[0].id : null, pw};
}


// The warning, or null: the gap right before me when I am the one who lost the wheel, else a
// warning before an early stage, a critical gap before one with riders to spare, the one nearest
// the front first. A gap closing again (below GAP_OFF_M, not yet for GAP_CLEAR_MS) is no longer
// shown. A gap that is closing (the rider behind closes it himself) comes after one that is not, of
// the same rank; my own gap while closing comes after a critical full gap of anyone that is not
// closing (a growing gap the team needs calls for action, my green one does not), but before one
// the team can spare and before an early one (the rest line shows no one else's early stage).
// The gap is measured where the line breaks: from the rider ahead of it to the rider behind it.
// {kind: 'group' | 'one' | 'split', id (the rider behind the gap), m (metres), s (seconds at my
//  speed, null below GAP_MIN_KMH), n (riders cut off), critical (the team needs them), mine (I am
//  right behind it), behind (I am cut off by it), level ('early' | 'full'), closing (getting smaller)}
export function gapView(st, selfId, {speedKmh = null} = {}) {
    const open = Object.entries(st?.riders || {}).filter(([, r]) => r.early && r.m >= GAP_OFF_M);
    if (!open.length) {
        return null;
    }
    const rank = (a, b) => (b[1].open - a[1].open) || (b[1].critical - a[1].critical) ||
        (a[1].closing - b[1].closing) || (a[1].at - b[1].at);
    const mine = open.find(([id]) => id === selfId);
    const growing = mine?.[1].closing ? open.filter(([, r]) => r.open && r.critical && !r.closing).sort(rank)[0] : null;
    const pick = (mine && !mine[1].closing ? mine : growing ?? mine) ?? open.sort(rank)[0];
    const [id, r] = pick;
    const n = r.behind.length;
    const kind = n === 1 ? 'one' : r.ahead === st.frontId ? 'group' : 'split';
    const s = speedKmh >= GAP_MIN_KMH ? Math.round(r.m / (speedKmh / 3.6) * 10) / 10 : null;
    return {kind, id, m: Math.round(r.m), s, n, critical: r.critical, mine: id === selfId,
            behind: r.behind.includes(selfId), level: r.open ? 'full' : 'early', closing: !!r.closing};
}


// The riders cut off behind me: everyone behind the first open (or let go) gap behind me in the
// line. Not my wheel to drop in behind after my pull (user, 14 Nov 2026: you let yourself drop back
// into the gap; the wheel is the last rider of the group you are in). An empty set when I am not in
// the line.
export function cutBehind(st, selfId) {
    const rs = st?.riders || {};
    const myAt = rs[selfId]?.at ?? (st?.frontId === selfId ? 0 : null);
    if (myAt === null) {
        return new Set();
    }
    let first = Infinity;
    for (const r of Object.values(rs)) {
        if ((r.open || r.lost) && r.at > myAt) {
            first = Math.min(first, r.at);
        }
    }
    return new Set(Object.entries(rs).filter(([, r]) => r.at >= first).map(([id]) => id));
}
