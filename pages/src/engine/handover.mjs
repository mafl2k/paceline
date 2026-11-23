// Hand-over detector (design 2026-11-21-paceline-beta5 §1): the puller's power drop arms it, the
// next rider out of the draft and level with him fires it. Pure: state in, state out, no imports.
// Validated 21 Nov 2026 in this form: arm path only, no short-stint path, level margin 0 m.
//
// Every sample-count rule below (HANDOVER_OUT_N, HANDOVER_MED_N) assumes one step per second, as
// Sauce delivers it: with other step rates the times in seconds change with them.
//
// State (engine state `hand`, in memory only, never persisted):
//   {puller, frontAt, sum, n, w, arm, out, run}
//   puller:  the rider this history belongs to; another puller starts a new history.
//   frontAt: the puller's first step as the front rider of my chain since he became the puller.
//            The pull starts at max(since, frontAt): a backdated `since` does not count (user,
//            21 Nov 2026; design §1).
//   sum, n:  his fresh power from pull start + HANDOVER_AVG_FROM_S (the running average).
//   w:       his last HANDOVER_MED_N power samples, null where the row was missing or stale.
//   arm:     {at} once the median of w fell below HANDOVER_DROP_FRAC of his average, else null.
//   out:     per rider the run of steps "out of the draft and level": {n, at, x}.
//   run:     {id, at}: the current front rider of my chain and since when; kept across puller
//            changes (see handoverStep).

// The constants are the validated set (user, 21 Nov 2026: no tuning without the user). Replay of
// six recorded races, 21 Nov 2026: puller right 91 -> 92, 93 -> 96 and 93 -> 94 % in the three
// races of 12 Nov, 92 -> 94 % in the race of 19 Nov, 93 % in the ZRL race of 17 Nov; pull start
// error 4 -> 2 s, decision 7 -> 5 s (medians, 82 fires in these five); 105 fire episodes, 97 real,
// 2 false ones adopted (both 2-3 s ahead of the position rule); no new chaos, also in the mock-plan
// race of 19 Nov (a chaos check only).

// His median power must fall below this share of his own average to arm.
export const HANDOVER_DROP_FRAC = 0.8;
// No arm and no fire before this many seconds into the pull: a shorter stint never fires and stays
// on the position rule (user, 21 Nov 2026: the short-stint path was dropped; it caused 507 s of
// chaos in one ride and lowered puller-right in another).
export const HANDOVER_MIN_S = 15;
// His average counts from this many seconds into the pull, so the effort of the swap does not
// inflate it.
export const HANDOVER_AVG_FROM_S = 5;
// A rider with at most this much draft benefit (W) is out of the draft.
export const HANDOVER_DRAFT_W = 5;
// A rider is level with the puller from his aligned position x >= the puller's x - this (m). 0 m
// (user, 21 Nov 2026): the design's first 1 m margin was rejected by the validation on the
// recorded races.
export const HANDOVER_LEVEL_M = 0;
// An arm fires only within this time after it was set; an older arm is dropped, and a new one may
// be set in the same step.
export const HANDOVER_WINDOW_MS = 8000;
// Consecutive samples out of the draft and level before a rider counts. 1 Hz steps: 2 samples are
// 2 s.
export const HANDOVER_OUT_N = 2;
// The median is taken over this many samples, 1 Hz: the last 5 s. It needs all 5 entries, at least
// 3 of them real samples, and takes the lower median.
export const HANDOVER_MED_N = 5;
// A row this old (ms) or younger is a sample; an older one gives none.
export const HANDOVER_FRESH_MS = 2000;

// The value of key in the entry's state when the row is fresh and the value finite, else null.
export function freshState(entry, key) {
    if (!entry || (entry.age ?? 0) > HANDOVER_FRESH_MS) {
        return null;
    }
    const v = entry.state?.[key];
    return Number.isFinite(v) ? v : null;
}

export function initialHand(puller = null) {
    return {puller, frontAt: null, sum: 0, n: 0, w: [], arm: null, out: {}};
}

// The lower median (xs is not empty).
function median(xs) {
    const s = xs.slice().sort((a, b) => a - b);
    return s[(s.length - 1) >> 1];
}

// One step. off: the detector does not run in this step (it keeps the puller's history and drops
// arm and runs).
// Inputs: now (ms), puller and since (A and his since, before this step's tracking), frontId (this
// step's front rider), chain ([{id, x}], aligned positions, front first), byId (Map of nearby
// entries by id), lineIds (the present riders of the line), selfId.
// Returns {hand, fired: {id, since, kind: 'arm'} | null}; since is the arm's time: when the puller
// really eased off, which dates the adoption of the fired rider.
export function handoverStep(prev, {now, puller, since, frontId, chain, byId, lineIds, selfId, off}) {
    // The run of the current front rider of my chain, kept across puller changes: a puller adopted
    // from the front has been front rider since the start of that run, not since his adoption.
    const run = prev?.run && prev.run.id === frontId ? prev.run : {id: frontId, at: now};
    let h = prev && prev.puller === puller ? prev : {
        ...initialHand(puller),
        frontAt: prev?.run && prev.run.id === puller && puller != null ? prev.run.at : null,
    };
    h = {...h, out: {...h.out}, run};
    if (puller == null) {
        return {hand: h, fired: null};
    }
    if (h.frontAt === null && frontId === puller) {
        h.frontAt = now;
    }
    if (off) {
        return {hand: {...h, arm: null, out: {}}, fired: null};
    }
    // The puller's power sample (null: no fresh row or no power).
    const wA = freshState(byId.get(String(puller)), 'power');
    h.w = [...h.w, wA].slice(-HANDOVER_MED_N);
    const start = h.frontAt === null ? null : Math.max(since ?? -Infinity, h.frontAt);
    if (start !== null && wA !== null && now >= start + HANDOVER_AVG_FROM_S * 1000) {
        h.sum += wA;
        h.n += 1;
    }
    const elapsed = start === null ? null : now - start;
    // Arm: median of the last 5 below 80 % of the running average, from 15 s into the pull. An arm
    // older than the window is dropped first, so that a new one can be set in this step.
    if (h.arm && now - h.arm.at > HANDOVER_WINDOW_MS) {
        h.arm = null;
    }
    if (!h.arm && elapsed !== null && elapsed >= HANDOVER_MIN_S * 1000 && h.n > 0) {
        const vals = h.w.filter(x => x !== null);
        const m = vals.length >= 3 && h.w.length >= HANDOVER_MED_N ? median(vals) : null;
        if (m !== null && m < HANDOVER_DROP_FRAC * (h.sum / h.n)) {
            h.arm = {at: now};
        }
    }
    // Riders of the line out of the draft and level with the puller (aligned x at least his).
    const pa = chain.find(c => c.id === String(puller));
    const line = new Set(lineIds || []);
    const out = {};
    for (const c of chain) {
        if (!pa || c.id === String(puller) || c.id === String(selfId) || !line.has(c.id)) {
            continue;
        }
        const d = freshState(byId.get(c.id), 'draft');
        if (d !== null && d <= HANDOVER_DRAFT_W && c.x >= pa.x - HANDOVER_LEVEL_M) {
            const o = h.out[c.id];
            out[c.id] = {n: (o?.n ?? 0) + 1, at: o?.at ?? now, x: c.x};
        }
    }
    h.out = out;
    // The frontmost of the ready riders fires, while an arm is set.
    const ready = Object.entries(out).filter(([, o]) => o.n >= HANDOVER_OUT_N).sort((a, b) => b[1].x - a[1].x);
    let fired = null;
    if (ready.length && elapsed !== null && elapsed >= HANDOVER_MIN_S * 1000 && h.arm) {
        fired = {id: ready[0][0], since: h.arm.at, kind: 'arm'};
    }
    return {hand: h, fired};
}
