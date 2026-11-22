// Team-efficiency learner (design 2026-11-21-paceline-beta5 §2). Pure: state in, state out, no imports.
// E = how much longer a turn takes than planned, measured from one puller's ease-off (T0) to the next
// one's, minus the earlier puller's plan pull. H = the time from a puller's ease-off to the next
// puller's adopted `since` (the engine's own hand-over lateness). Both are the median of the last 12
// fed values, mixed with today's prior (10 s / 5 s) at weight 2; analysis of five recorded races
// (21 Nov 2026: T0 to T0, N 12, prior 10/5 at weight 2). Decisions 1 and 2 of the beta.5 plan.
//
// One T0 rule for E, H and the ride report (decision 1, 21 Nov 2026): the analysis' 85 % rule, not
// the hand-over detector's 80 % arm (that one stays a trigger, not a time). The validated E/H numbers
// used this rule, with the window ending at the next since + 1 s: ending it at the next since took
// the READY median from 11.0 to 10.0 s (replay of five recorded races, 21 Nov 2026).
//
// State (engine state `eff`, in memory only, never persisted):
//   {seg, last, e, h}
//   seg:  the open turn {id, since, planS, bonus, bad, next, pw: [[ts, w|null]]} or null.
//   last: the turn closed before it {id, since, T0, bad, next, nextSince} or null.
//   e, h: the last EFF_N fed values in seconds.
//
// Every sample rule below assumes one step per second, as Sauce delivers it.

export const EFF_N = 12;
// Weight of the prior against the learned median, in turns (so 2 turns' worth).
export const EFF_PRIOR_K = 2;
// E is clamped to this range (s) after mixing in the prior.
export const EFF_MIN_S = -5;
export const EFF_MAX_S = 25;
// Robust start and limits (beta.5 addendum, user, 21 Nov 2026): a turn's value is stored clipped to
// -10...+10 s, E is the prior until this many values are learned, and E stays within its prior
// +- 10 s (inside EFF_MIN_S...EFF_MAX_S). The 10 s are the user's number, not fitted. On the five
// recorded races: abs 7.36 s, READY median 11.000 s, jumps of more than 10 s at learning steps 53
// to 40 (positions only; the countdown is judged against T0).
export const EFF_CLIP_S = 10;
export const EFF_MIN_N = 3;
export const EFF_PRIOR_BAND_S = 10;
// H: prior 5 s (today's fixed allowance), clamped to 0...10 s.
export const EFF_H_PRIOR_S = 5;
export const EFF_H_MIN_S = 0;
export const EFF_H_MAX_S = 10;
// No learning from turns that began before the roll-off + this long (the start is chaotic; user,
// 21 Nov 2026; design §2).
export const EFF_LEARN_AFTER_MS = 120000;
// A step is "still pulling" when the median of 3 power samples is at least this share of the
// puller's own average; the last such step plus 1 s is his T0.
export const EASE_FRAC = 0.85;
// His average counts from this long into the turn (the swap's effort does not inflate it), and
// needs at least EASE_MIN_N samples.
export const EASE_AVG_FROM_MS = 5000;
export const EASE_MIN_N = 5;
// Memory cap on one turn's power log, not a model constant: 900 entries are about 900 s at one
// engine step per second (21 Nov 2026). Such a turn is never fed for plans up to 435 s (a turn
// is fed only up to 2 x plan + 30 s, and 2 x 435 + 30 = 900); a full log marks the turn bad.
export const EFF_PW_MAX = 900;

export function initialEff() {
    return {seg: null, last: null, e: [], h: []};
}
// A plan change or standing still: the open turn and its predecessor are dropped, what was learned
// stays (design §2: no reset; decision 5).
export function effCut(eff) {
    return {...(eff ?? initialEff()), seg: null, last: null};
}

// The lower of the two middle values for an even count (the median that does not invent a value).
function lowerMedian(xs) {
    const s = xs.slice().sort((a, b) => a - b);
    return s.length ? s[(s.length - 1) >> 1] : null;
}
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// T0 of a turn from his power log `samples` [[ts, w|null]] (sorted by ts): the last step in
// [from + 5 s, to] whose lower median of the last 3 non-null samples (at least 2) is at least 85 %
// of his average over that window, plus 1 s, but not after `cap`. null when the average has fewer
// than EASE_MIN_N samples or no step qualifies. The same rule as in the analysis (decision 1).
export function easeOffAt(samples, {from, to, cap = to + 1000}) {
    let sum = 0, n = 0;
    for (const [ts, w] of samples) {
        if (ts >= from + EASE_AVG_FROM_MS && ts <= to && w !== null) {
            sum += w;
            n++;
        }
    }
    if (n < EASE_MIN_N) {
        return null;
    }
    const avg = sum / n;
    let last = null;
    for (let j = 2; j < samples.length; j++) {
        const ts = samples[j][0];
        if (ts < from + EASE_AVG_FROM_MS || ts > to) {
            continue;
        }
        const v = [samples[j - 2][1], samples[j - 1][1], samples[j][1]].filter(w => w !== null);
        if (v.length >= 2 && lowerMedian(v) >= EASE_FRAC * avg) {
            last = ts;
        }
    }
    return last === null ? null : Math.min(last + 1000, cap);
}

// A turn counts only if it is between half the plan short and the plan + 30 s long (the same
// bounds apply to its length and to its E); a wild one is a mis-adoption or a stop, not a rhythm.
export const turnFits = (x, planS) => -0.5 * planS <= x && x <= planS + 30;

// One engine step. `puller` null (nobody in front): the open turn is closed without a trace.
// Otherwise a changed (puller, since) closes the open turn and may feed E and H; then the open turn
// takes this step's power. `bad`: chaos, pause or a skipped step in this step. `nextId`: the plan's
// expected next puller. `rolledAt`: the roll-off time (ms). `selfId`: me.
export function effStep(prev, {now, puller, since, planS, bonus, power, bad, nextId, rolledAt, selfId}) {
    const eff = prev ?? initialEff();
    if (puller == null) {
        return {...eff, seg: null};
    }
    let {seg, last, e, h} = eff;
    if (seg && (seg.id !== puller || seg.since !== since)) {
        const r = seg;
        const T0p = easeOffAt(r.pw, {from: r.since, to: since + 1000, cap: since + 1000});
        const T0 = T0p ?? since;
        if (!r.bad && !r.bonus && r.planS > 0 &&
                (!Number.isFinite(rolledAt) || r.since >= rolledAt + EFF_LEARN_AFTER_MS) &&
                r.next === puller &&
                last && last.nextSince === r.since && !last.bad && last.next === r.id &&
                turnFits((since - r.since) / 1000 - r.planS, r.planS)) {
            const x = (T0 - last.T0) / 1000 - r.planS;
            if (turnFits(x, r.planS)) {
                e = [...e, clamp(x, -EFF_CLIP_S, EFF_CLIP_S)].slice(-EFF_N);
                // H only from a power-dated T0 and never when the next puller is me: my adoption is
                // power-dated too (decision 2, 21 Nov 2026).
                if (T0p !== null && puller !== selfId) {
                    h = [...h, (since - T0p) / 1000].slice(-EFF_N);
                }
            }
        }
        last = {id: r.id, since: r.since, T0, bad: r.bad, next: r.next, nextSince: since};
        seg = null;
    }
    if (!seg) {
        seg = {id: puller, since, planS, bonus: !!bonus, bad: false, next: null, pw: []};
    }
    const full = seg.pw.length >= EFF_PW_MAX;
    seg = {
        ...seg,
        bad: seg.bad || !!bad || full,
        next: nextId ?? seg.next,
        pw: full ? seg.pw : [...seg.pw, [now, power ?? null]],
    };
    return {seg, last, e, h};
}

// E for the countdown: `priorS` until EFF_MIN_N values are learned, then the median of the last 12
// mixed with `priorS` at weight 2, clamped to the prior +- EFF_PRIOR_BAND_S (and EFF_MIN_S...MAX_S).
export function teamE(eff, priorS) {
    const xs = eff?.e ?? [];
    if (xs.length < EFF_MIN_N) {
        return priorS;
    }
    return clamp((xs.length * lowerMedian(xs) + EFF_PRIOR_K * priorS) / (xs.length + EFF_PRIOR_K),
                 Math.max(EFF_MIN_S, priorS - EFF_PRIOR_BAND_S), Math.min(EFF_MAX_S, priorS + EFF_PRIOR_BAND_S));
}
// H for the countdown: the same with the prior 5 s and the clamp 0...10 s.
export function teamH(eff) {
    const xs = eff?.h ?? [];
    if (!xs.length) {
        return EFF_H_PRIOR_S;
    }
    return clamp((xs.length * lowerMedian(xs) + EFF_PRIOR_K * EFF_H_PRIOR_S) / (xs.length + EFF_PRIOR_K),
                 EFF_H_MIN_S, EFF_H_MAX_S);
}
