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
// warning at the real drops), opened and closed like the warning. Pure logic (no DOM, no Sauce
// imports).

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


export function initialGaps() {
    return {riders: {}, frontId: null};
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


// One step. active: false (no live data, start lock, final sprint, standing, muted) forgets
// everything, so a warning never outlives the situation it was about. hill: a real climb or
// descent (the rotation's pause). needed: the riders the team must bring over the line.
export function gapStep(prev, {now, positions, selfId, active, hill = false, needed = GAP_FINISHERS}) {
    if (!active) {
        return initialGaps();
    }
    const group = gapGroup(positions, selfId);
    const onM = hill ? GAP_HILL_ON_M : GAP_ON_M;
    const earlyM = hill ? GAP_HILL_EARLY_M : GAP_EARLY_M;
    const riders = {};
    let firstBreak = null;    // the first rider (from the front) behind a gap: the front group ends there
    for (let i = 1; i < group.length; i++) {
        const id = group[i].id;
        const p = prev.riders[id] ??
            {hist: [], above: null, aboveEarly: null, below: null, open: false, early: false, lost: false};
        // Smoothed per pair: when the rider ahead changes (riders swap places), the history is of
        // another gap and starts over.
        const g = group[i - 1].x - group[i].x;
        const hist = p.ahead === group[i - 1].id ? [...p.hist, g].slice(-GAP_SMOOTH_N) : [g];
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
        let early = p.early;
        if (!early && aboveEarly !== null && now - aboveEarly >= GAP_HOLD_MS) {
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
                      critical, m, at: i, ahead: group[i - 1].id, behind: []};
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
    return {riders, frontId: group.length ? group[0].id : null};
}


// The warning, or null: the gap right before me when I am the one who lost the wheel, else a
// warning before an early stage, a critical gap before one with riders to spare, the one nearest
// the front first. A gap closing again (below GAP_OFF_M, not yet for GAP_CLEAR_MS) is no longer
// shown.
// The gap is measured where the line breaks: from the rider ahead of it to the rider behind it.
// {kind: 'group' | 'one' | 'split', id (the rider behind the gap), m (metres), s (seconds at my
//  speed, null below GAP_MIN_KMH), n (riders cut off), critical (the team needs them), mine (I am
//  right behind it), behind (I am cut off by it), level ('early' | 'full')}
export function gapView(st, selfId, {speedKmh = null} = {}) {
    const open = Object.entries(st?.riders || {}).filter(([, r]) => r.early && r.m >= GAP_OFF_M);
    if (!open.length) {
        return null;
    }
    const pick = open.find(([id]) => id === selfId) ??
        open.sort((a, b) => (b[1].open - a[1].open) || (b[1].critical - a[1].critical) || (a[1].at - b[1].at))[0];
    const [id, r] = pick;
    const n = r.behind.length;
    const kind = n === 1 ? 'one' : r.ahead === st.frontId ? 'group' : 'split';
    const s = speedKmh >= GAP_MIN_KMH ? Math.round(r.m / (speedKmh / 3.6) * 10) / 10 : null;
    return {kind, id, m: Math.round(r.m), s, n, critical: r.critical, mine: id === selfId,
            behind: r.behind.includes(selfId), level: r.open ? 'full' : 'early'};
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
