// The wheel cue in the rest line: who to drop in behind, with kit colour and name.
// - At the start (user, 15 Nov 2026: "the event starts, chaos, I look for my rider, my place in the
//   team"): from my first roll-off with a plan until I am on that wheel (seen right before me in my
//   chain for CUE_ON_MS), my first pull begins, or CUE_START_MS. Not for the start puller.
// - When my wheel changes (a rider dropped, or back): for CUE_CHANGE_MS, once the new wheel has
//   held for CUE_SETTLE_MS, at most once per CUE_REARM_MS and not in the first CUE_CALM_MS of the
//   ride. A change during my pull shows after it.
// - Not after every pull (expert panel, 15 Nov 2026: shown 8-20 times a ride it becomes wallpaper
//   and the rare change cue loses its force; the Info window keeps the planned wheel).
// The wheel comes from the plan and who is with the group, not from Zwift's order, so teams that
// ride in a bunch do not trip it. Pure logic (no DOM, no Sauce imports).

export const CUE_ON_MS = 2000;
export const CUE_START_MS = 90000;
export const CUE_CHANGE_MS = 15000;
export const CUE_SETTLE_MS = 3000;
export const CUE_REARM_MS = 30000;
export const CUE_CALM_MS = 45000;
// Who counts as with the group for the cue: seen in my chain this recently. Shorter than the
// rotation's presence grace (20 s), which would show a dropped rider as my wheel for 20 s.
export const CUE_FRESH_MS = 5000;


export function initialCue() {
    return {startAt: null, wheelId: null, known: null, cand: null, candSince: null, lastFire: null,
            kind: null, until: null, onSince: null, off: false};
}


// The plan riders seen in my chain within CUE_FRESH_MS. seen: {id: last seen ms} (rotation state).
export function freshIds(seen, now) {
    return Object.entries(seen || {}).filter(([, at]) => now - at < CUE_FRESH_MS).map(([id]) => id);
}


// The wheel I drop in behind: the rider before me in plan order who is with the group (presentIds),
// skipping riders dropped. null when I am not a plan rider or nobody else is with the group.
export function dropWheel(plan, {selfId, presentIds}) {
    const riders = plan?.riders || [];
    const mi = riders.findIndex(r => r.id === selfId);
    if (mi < 0) {
        return null;
    }
    const present = new Set(presentIds || []);
    for (let k = 1; k < riders.length; k++) {
        const r = riders[(mi - k + riders.length) % riders.length];
        if (present.has(r.id)) {
            return r;
        }
    }
    return null;
}


// The place in the line of rider `id` (1 = the puller), counting the riders with the group
// (presentIds) in rotation order from the puller, without me (I drop in behind them). null when he
// is not among them. Shown when the wheel is not the plan's (user, 14 Nov 2026: "drop back to
// Matthias at position 3", not his plan number).
export function linePlace(plan, {pullerId, selfId, id, presentIds}) {
    const riders = plan?.riders || [];
    const pi = Math.max(0, riders.findIndex(r => r.id === pullerId));
    const present = new Set(presentIds || []);
    let n = 0;
    for (let k = 0; k < riders.length; k++) {
        const r = riders[(pi + k) % riders.length];
        if (r.id === selfId || !present.has(r.id)) {
            continue;
        }
        n++;
        if (r.id === id) {
            return n;
        }
    }
    return null;
}


// One step. startAt: when the ride's start lock began (rotation state), null before. active: live,
// a plan rider, in the event, not paused (climb, finish, standing still); inactive steps hide the
// cue and detect nothing, but keep what is known. startPuller: I pull first at the start.
// pulling: I am the puller. wheelId: the wheel I follow (or drop in behind while I pull). obsId:
// the rider right before me in my chain.
export function cueStep(prev, {now, active, startAt = null, startPuller = false, pulling, wheelId, obsId}) {
    let st = {...(prev || initialCue())};
    if (startAt !== null && startAt !== st.startAt) {
        // A new ride: the start cue.
        st = {...initialCue(), startAt};
        if (!startPuller) {
            st.kind = 'start';
            st.until = startAt + CUE_START_MS;
        }
    }
    st.wheelId = wheelId ?? null;
    st.off = !active;
    if (!active) {
        st.cand = null;
        st.candSince = null;
        st.onSince = null;
        return st;
    }
    if (st.kind && (pulling || now >= st.until)) {
        st.kind = null;
        st.until = null;
    }
    if (st.kind === 'start') {
        // The wheel I look for; no change cue on top of it.
        st.known = wheelId ?? st.known;
        st.onSince = wheelId && obsId === wheelId ? st.onSince ?? now : null;
        if (st.onSince !== null && now - st.onSince >= CUE_ON_MS) {
            st.kind = null;
            st.until = null;
            st.onSince = null;
        }
        return st;
    }
    st.onSince = null;
    if (!wheelId || wheelId === st.known || st.known === null) {
        st.known = st.known ?? wheelId ?? null;
        st.cand = null;
        st.candSince = null;
        return st;
    }
    if (st.cand !== wheelId) {
        st.cand = wheelId;
        st.candSince = now;
    }
    const settled = now - st.candSince >= CUE_SETTLE_MS;
    const calm = st.startAt === null || now - st.startAt >= CUE_CALM_MS;
    const armed = st.lastFire === null || now - st.lastFire >= CUE_REARM_MS;
    if (settled && calm && armed && !pulling) {
        st.kind = 'change';
        st.until = now + CUE_CHANGE_MS;
        st.known = wheelId;
        st.lastFire = now;
        st.cand = null;
        st.candSince = null;
    } else if (settled && (!calm || (st.kind === 'change' && !pulling))) {
        // Still the start's sorting out, or a further change while a change cue shows (it shows the
        // new wheel without starting over): take it as known without a new cue.
        st.known = wheelId;
        st.cand = null;
        st.candSince = null;
    }
    return st;
}


// The cue to show, {id, kind: 'start' | 'change'}, or null.
export function cueView(st, now) {
    if (!st || st.off || !st.kind || st.until === null || now >= st.until) {
        return null;
    }
    const id = st.kind === 'start' ? st.wheelId : st.known;
    return id ? {id, kind: st.kind} : null;
}
