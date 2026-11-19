// Pure logic (no DOM, no Sauce imports): who is pulling (the frontmost rider of my team chain),
// how long until my pull, who is on my wheel, and the power-bar helper.

import {MAX_AGE_MS, selfEntry} from './recording.mjs';

export const HOLD_MS = 3000;
// Chaos (several changes at the front in a short time): while the last puller change is less than
// CHAOS_WINDOW_MS old, a new front rider must hold the front for CHAOS_HOLD_MS before he counts
// (user, 12 Nov 2026: remember the puller and change conservatively; in the replay of that ride
// this cut the time-to-pull error from 12.4 to 10.4 s and removed every puller of under 15 s).
export const CHAOS_WINDOW_MS = 30000;
export const CHAOS_HOLD_MS = 15000;
// The rider who pulled before the puller (directly before him in the plan, of those present) back
// at the front is no new pull: a swap, or his last seconds while the new puller settles in. He
// takes the pull back only after BACK_HOLD_MS (user, 18 Nov 2026: in one team on 12 Nov #1 was in
// front again for 15 s while #2 pulled, and the clock went 27 → 152 → 45). Replay of four races
// (three on 12 Nov, a ZRL race on 17 Nov): clock flips (a jump of 30 s or more undone
// within a minute) 9 → 6 with 15 or 20 s, 2 with 30 s (the ZRL swaps of #4 and #5 too); the
// seconds with a wrong puller 760 → 805 of about 3.3 h. Not after a pause that adopted the puller
// (resumeFront): the order is scrambled then, and the rider before may well be the real one.
export const BACK_HOLD_MS = 30000;
// The countdown to my pull keeps running this long past the puller's expected end, since the next
// rider is only taken over HOLD_MS after he got to the front (backdated): no stall at a regular
// change. Longer is worse, riders often pull longer than planned (12 Nov 2026 replay).
export const RUN_ON_S = 3;
// Every pull counts this much longer than planned (user, 13 Nov 2026): in the three races of
// 12 Nov riders went over their pull by about 10 s each, about the same for 30 s and 120 s pulls
// (the changeover itself). Since 18 Nov 2026 (user) the puller's own pull counts it too, and the
// rider directly before me counts only his plan, between and while he pulls (expectedPullS): the
// sum is the same, but the clock no longer stands at the puller's plan end and then drops by the
// next rider's 10 s at the change (the "≥, then a 10 s jump" the user found most irritating), and
// in the last stretch it reaches 0 early rather than late (READY takes over until he swings off).
// Simulated from all 20 rider views of four races (three on 12 Nov; 17 Nov
// ZRL second half): small downward jumps (3–12 s) 351 → 142, error median 13 → 13.5 s, late
// 10 s before the start 43/146 either way; 5 s gave 16 s, 15 s gave 13 s with 160 jumps. Learned
// values (a round factor from my own recoveries, per-rider medians, all × factor) were not more
// accurate across riders, and all × factor was late more often (67/146). Nothing is learned or kept
// per rider: the squad changes from week to week.
export const CHANGE_ALLOWANCE_S = 10;

// The countdown's expected length of a pull: its plan (pullS, the start bonus included for the
// start puller) plus CHANGE_ALLOWANCE_S, or the plan alone for the rider directly before me.
export function expectedPullS(pullS, beforeMe) {
    return pullS + (beforeMe ? 0 : CHANGE_ALLOWANCE_S);
}
export const CHAIN_GAP_M = 20;
export const WARN_S = 10;
// The power bar in percent of the target (user, 12 Nov 2026: 5 W either way does not matter, 10 %
// short does; the planner rounds targets to 10 W): the bar spans BAR_RANGE_PCT either side, green
// up to GREEN_PCT off, amber up to AMBER_PCT, red beyond.
export const BAR_RANGE_PCT = 15;
export const GREEN_PCT = 5;
export const AMBER_PCT = 10;
export const SMOOTH_S = 3;
// Teammates' samples older than this are not extrapolated: a laggy sample would be pushed far ahead.
export const ROT_MAX_AGE_MS = 5000;
// My own pull from my power and draft (1 Hz samples). Start: a jump of JUMP_W over my rest power
// while I am the next rider, confirmed by my draft (or position) within CONFIRM_MS; or my draft
// alone. End: a sharp drop below END_W. Climbs and descents pause the rotation, the final sprint
// ends it.
export const JUMP_W = 40;
export const JUMP_TARGET_FRAC = 0.8;
export const REST_WINDOW_S = 10;
export const JUMP_GATE_S = 10;
export const CLIMB_GRADE = 4;          // percent, held for CLIMB_ENTER_MS
export const CLIMB_ENTER_MS = 5000;
export const CLIMB_EXIT_GRADE = 2;     // percent, held for CLIMB_EXIT_MS
export const CLIMB_EXIT_MS = 5000;
export const DESCENT_GRADE = -3;       // percent: at or below, my pull end is not detected; held
export const DESCENT_ENTER_MS = 5000;  // ... this long, a descent pauses the rotation like a climb
export const DESCENT_EXIT_GRADE = -2;  // percent: above it for DESCENT_EXIT_MS ends the descent
export const DESCENT_EXIT_MS = 5000;
// Rollers and real climbs (user, 13 Nov 2026: the 12 Nov "climbs" were rollers of just about 4 %,
// 14-35 s): on a roller the rotation goes on and only the puller or the plan's next rider may take
// the front (a rider sprinting up from behind is ignored); a real climb or descent pauses it.
// Which is which comes from the route profile (terrain.mjs); without it, from the live grade: a
// climb or descent is a roller for its first ROLLER_LIVE_MS, then a real one.
export const ROLLER_LIVE_MS = 45000;
export const CONFIRM_MS = 12000;
export const SELF_IGNORE_MS = 10000;
export const DRAFT_FRONT_W = 5;        // my draft (W) at most this, averaged over DRAFT_N samples
export const DRAFT_N = 3;
export const DRAFT_RUN_N = 2;          // draft-only start after this many samples in a row
export const BEHIND_MAX_AGE_MS = 2000; // a teammate behind me this fresh confirms my draft
export const PRESENT_GRACE_MS = 20000;
export const SUSTAIN_S = 8;
export const SUSTAIN_TARGET_FRAC = 0.85;
export const END_W = 130;
export const END_MIN_S = 20;
export const END_FRAC = 0.6;           // shadow end rule (recorded only): below END_FRAC x target
// The final sprint: within this distance of the finish the rotation is off.
export const FINISH_M = 500;
export const STOP_KMH = 2;             // my speed below this: standing (start pen, a stop)
export const STOP_MS = 5000;           // ... held this long before a running rotation pauses
// Rolling off (out of the start pen, or after a stop) is chaos for the first seconds: the windows
// show the quiet dash for this long while the engine keeps tracking (user, 12 Nov 2026: in that
// ride three riders counted as puller within 13 s of the start; 13 Nov 2026: in one rider's recording
// plan #2 led the first 33 s, so 30 s showed a wrong countdown that jumped by 152 s).
export const START_QUIET_MS = 40000;
// The start is set, not detected (user, 13 Nov 2026): in all three race recordings plan #1 did the
// start pull, after someone else led the first 10-35 s, and he handed over 32-37 s after his
// plan time from the roll-off in two of them. So at the first roll-off plan #1 is the puller, his
// first pull lasting his plan time plus START_BONUS_S from the roll-off (front.bonus), and for
// START_LOCK_MS nothing at the front is detected (no front rider, no own pull, no climb). He sees
// his pull at once; the others' windows stay quiet until he has been in front for HOLD_MS (the
// start chaos is over), at most for the lock. Then detection takes
// over again; the end of the lock counts as a change (chaos hold), so a front rider other than
// #1 counts only after CHAOS_HOLD_MS. Only a roll-off after standing at least START_PEN_MS (the
// start pen) is a start; a stop during the ride is none.
export const START_BONUS_S = 30;
export const START_PEN_MS = 30000;
export const START_LOCK_MS = 60000;
// A grade beyond this (percent) is no road: Zwift sent 131 % in the start pen and launch (12 Nov,
// the first rider), which paused the rotation for the first 86 s.
export const MAX_GRADE = 30;
// After a climb, a descent or riding alone another rider may be in front first; the rider who pulled before
// the pause gets his clock back when he is in front again within this time (12 Nov ride, 15:57:
// otherwise his pull counted from 0 again).
export const RESUME_MS = 60000;
const REST_MIN_N = 5;                  // rest samples needed before a jump counts
const END_N = 2;
// Enough for the longer of the two jump rules plus a full rest window.
const HIST_KEEP = REST_WINDOW_S + Math.max(SMOOTH_S, SUSTAIN_S);


// Position of every team rider (and me) on a common time line. Nearby samples are taken at
// different moments, so each one is moved forward to the newest sample time at its own speed.
// Larger x = further ahead.
export function alignedPositions(nearby, ids) {
    const used = [];
    for (const e of nearby || []) {
        if (!(ids.has(String(e.athleteId)) || e.self === true)) {
            continue;
        }
        const age = e.age ?? 0;
        if (!(age < MAX_AGE_MS) || (e.self !== true && !(age < ROT_MAX_AGE_MS))) {
            continue;
        }
        used.push(e);
    }
    let tRef = -Infinity;
    for (const e of used) {
        const t = e.state?.worldTime;
        if (typeof t === 'number' && t > tRef) {
            tRef = t;
        }
    }
    const out = [];
    for (const e of used) {
        let x = -e.gapDistance;
        const t = e.state?.worldTime;
        if (typeof t === 'number') {
            x += ((e.state.speed || 0) / 3.6) * (tRef - t) / 1000;
        }
        out.push({id: String(e.athleteId), x, self: e.self === true, age: e.age ?? 0});
    }
    out.sort((a, b) => b.x - a.x);
    return out;
}


// The run of consecutive riders around me where each gap to the next is at most CHAIN_GAP_M.
export function teamChain(positions, selfId) {
    const i = positions.findIndex(p => p.id === selfId);
    if (i < 0) {
        return [];
    }
    let a = i;
    while (a > 0 && positions[a - 1].x - positions[a].x <= CHAIN_GAP_M) {
        a--;
    }
    let b = i;
    while (b < positions.length - 1 && positions[b].x - positions[b + 1].x <= CHAIN_GAP_M) {
        b++;
    }
    return positions.slice(a, b + 1);
}


// The frontmost plan rider of the chain. The chain always holds me, also when I am on the bench
// or not in the plan, and then I must not count as the front rider.
export function frontOf(chain, riderIds) {
    const first = (chain || []).find(c => riderIds.has(c.id));
    return first ? first.id : null;
}


// True when the list has a current sample of my own rider. Without one there is no rotation view.
export function selfLive(nearby, selfId) {
    const me = (nearby || []).find(e => e.self === true);
    return !!me && selfId !== null && String(me.athleteId) === String(selfId) && (me.age ?? 0) < MAX_AGE_MS;
}


export function initialFront() {
    return {puller: null, since: null, cand: null, candSince: null, changedAt: null};
}


function clearCand(s) {
    s.cand = null;
    s.candSince = null;
}


// A new front rider only becomes the puller after being in front for HOLD_MS, or CHAOS_HOLD_MS
// while the last change (`changedAt`: any new puller, also my own start or end and the end of a
// pause) is less than CHAOS_WINDOW_MS old, or when he is `slowId` (he would skip the planned next
// rider, see skipsAhead), BACK_HOLD_MS when he is `backId` (the rider who pulled before the
// puller, see riderBefore); `since` is backdated to when they first appeared there. The very first
// sighting is adopted at once.
//
// My own pull (user decision 11 Nov 2026: my draft near 0 is the hard fact):
// - selfStart {id, at} (a power jump while I am next) only opens a pending start, which nobody
//   sees. `confirm` (my draft is ~0 with a teammate behind me, or I am frontmost with a teammate
//   behind me; see startConfirmed) makes me the puller with since = the jump. Without that within
//   CONFIRM_MS the pending start is dropped ('revert'). While pending, the front candidate is
//   still followed, but nobody is adopted, so the hold cannot hand the pull to someone else.
// - draftStart {id, at} (my draft says I lead, without a jump): I am the puller from `at`.
//   After either start the previous puller does not count as front rider for SELF_IGNORE_MS
//   (positions lag behind the draft while he swings aside). If he is in front again right after
//   that (my start was wrong), he gets his old `since` back (`prev`), not a fresh one.
// - selfEnd {id, at, nextId} (my power drop while pulling): the next rider pulls from `at`. For
//   SELF_IGNORE_MS I do not count as front rider (I stay frontmost for a while as I fade), and no
//   start of mine is taken; nor later a start whose `at` lies in that window (a draft run that
//   began while I faded in front, before the next rider came past).
// `last` {kind: 'start' | 'draftStart' | 'end' | 'revert', at} is the latest of these (see
// selfEvent). A start that is not newer than it is ignored, so one jump or draft run still in the
// history is not taken twice.
export function trackFront(state, {now, frontId, selfStart, draftStart, selfEnd, confirm, slowId = null, backId = null}) {
    const s = {...state};
    const ignored = id => !!s.ignore && id === s.ignore.id && now - s.ignore.at < SELF_IGNORE_MS;
    const fromIgnored = x => !!s.ignore && x.id === s.ignore.id && x.at >= s.ignore.at &&
        x.at < s.ignore.at + SELF_IGNORE_MS;
    const fresh = x => !!x && x.id !== s.puller && !(x.at <= s.last?.at) && !ignored(x.id) &&
        !fromIgnored(x);
    if (selfEnd && selfEnd.id === s.puller && selfEnd.nextId != null && selfEnd.nextId !== selfEnd.id) {
        s.puller = selfEnd.nextId;
        s.since = selfEnd.at;
        s.pending = null;
        s.prev = null;
        s.ignore = {id: selfEnd.id, at: selfEnd.at};
        s.last = {kind: 'end', at: selfEnd.at};
        s.resumed = null;
        s.changedAt = now;
        clearCand(s);
        return s;
    }
    if (!s.pending && fresh(draftStart)) {
        takeOver(s, draftStart, now);
        s.last = {kind: 'draftStart', at: draftStart.at};
        return s;
    }
    if (!s.pending && fresh(selfStart)) {
        s.pending = {id: selfStart.id, at: selfStart.at};
    }
    if (ignored(frontId)) {
        frontId = null;
    }
    if (s.pending) {
        if (confirm) {
            takeOver(s, s.pending, now);
            s.last = {kind: 'start', at: s.pending.at};
            s.pending = null;
            return s;
        }
        if (now - s.pending.at < CONFIRM_MS) {
            followCand(s, frontId, now);
            return s;
        }
        s.pending = null;
        s.last = {kind: 'revert', at: now};
    }
    followCand(s, frontId, now);
    // Back right after my wrong start: he keeps the since he had, and the normal hold applies (he
    // is the puller we remember, not a new one).
    const back = s.cand != null && !!s.prev && s.prev.puller === s.cand &&
        s.candSince - s.prev.at <= SELF_IGNORE_MS + HOLD_MS;
    const chaos = !back && (now - (s.changedAt ?? -Infinity) < CHAOS_WINDOW_MS ||
        (slowId != null && s.cand === slowId));
    const backHold = !back && backId != null && s.cand === backId && s.resumed !== s.puller;
    const hold = backHold ? BACK_HOLD_MS : chaos ? CHAOS_HOLD_MS : HOLD_MS;
    if (s.cand != null && (s.puller == null || now - s.candSince >= hold)) {
        s.puller = s.cand;
        s.since = back ? s.prev.since : s.candSince;
        s.prev = null;
        s.resumed = null;
        s.changedAt = now;
        clearCand(s);
    }
    return s;
}


// True when the front rider would skip the planned next rider: one or two places further on in
// plan order (12 Nov 2026: while Cora handed over to Selma, Aldo was in front for a moment and
// counted as the puller for 18 s, so the countdown fell by 92 s and rose again).
export function skipsAhead(plan, {pullerId, nextId, frontId}) {
    const ids = (plan?.riders || []).map(r => r.id);
    const n = ids.length;
    const p = ids.indexOf(pullerId), x = ids.indexOf(nextId), f = ids.indexOf(frontId);
    if (p < 0 || x < 0 || f < 0 || f === x) {
        return false;
    }
    const d = i => (i - p + n) % n;
    return d(f) > d(x) && d(f) <= d(x) + 2;
}


// The present rider directly before `pullerId` in plan order (the one who pulled before him), or
// null.
export function riderBefore(plan, {pullerId, presentIds}) {
    const ids = (plan?.riders || []).map(r => r.id);
    const n = ids.length;
    const p = ids.indexOf(pullerId);
    if (p < 0) {
        return null;
    }
    const present = new Set(presentIds || []);
    for (let k = 1; k < n; k++) {
        const id = ids[(p - k + n) % n];
        if (present.has(id)) {
            return id;
        }
    }
    return null;
}


// I take the pull from the current puller (start or draftStart {id, at}).
function takeOver(s, {id, at}, now) {
    s.changedAt = now;
    s.prev = s.puller == null ? null : {puller: s.puller, since: s.since, at: now};
    s.ignore = s.puller == null ? null : {id: s.puller, at: now};
    s.puller = id;
    s.since = at;
    s.resumed = null;
    clearCand(s);
}


// The candidate: the front rider when he is not the puller, with when he got there. No data
// drops the candidate, so it is not backdated across the gap.
function followCand(s, frontId, now) {
    if (frontId == null || frontId === s.puller) {
        clearCand(s);
    } else if (frontId !== s.cand) {
        s.cand = frontId;
        s.candSince = now;
    }
}


// After a climb or descent (or after riding alone): the same front rider as the puller carries on
// with his clock; another one is adopted at once (the rotation is scrambled), unless the puller is
// less than RESUME_NEAR_M behind him in my chain (`x` in m): riding side by side (under 2 m apart),
// the order is chance; on his wheel (2–5 m apart in the line) the front really changed. Either way
// the end of the pause counts as a change (chaos rule), so a front rider who stays there takes over
// after CHAOS_HOLD_MS. Without a front rider nothing changes. Everything else (pending start,
// ignore, last event) is kept.
// 17 Nov 2026 (ZRL): at the end of a descent the front rider was adopted in one tick, 0.2 m ahead of
// the puller, side by side at 67 km/h, and the chaos hold then kept that wrong puller for 16 s.
export const RESUME_NEAR_M = 2;
export function resumeFront(front, {now, frontId, chain = []}) {
    const s = {...front};
    clearCand(s);
    s.changedAt = now;
    const f = chain.find(c => c.id === frontId), p = chain.find(c => c.id === s.puller);
    if (f && p && f.x - p.x < RESUME_NEAR_M) {
        return s;
    }
    if (frontId != null && frontId !== s.puller) {
        s.puller = frontId;
        s.since = now;
        s.prev = null;
        s.resumed = frontId;    // adopted from a scrambled order: no BACK_HOLD_MS against him
    }
    return s;
}


// A teammate (plan rider) behind me in my chain whose sample is younger than maxAgeMs.
export function teammateBehind(chain, selfId, maxAgeMs) {
    const i = (chain || []).findIndex(c => c.id === selfId);
    return i >= 0 && chain.slice(i + 1).some(c => !c.self && (c.age ?? 0) < maxAgeMs);
}


// Mean of my last DRAFT_N draft samples, or null with fewer.
export function draftMean(drafts) {
    const d = (drafts || []).slice(-DRAFT_N);
    return d.length < DRAFT_N ? null : d.reduce((a, b) => a + b, 0) / d.length;
}


// My draft says I lead: draft ~0 and a fresh teammate behind me.
export function draftFront({drafts, chain, selfId}) {
    const m = draftMean(drafts);
    return m !== null && m <= DRAFT_FRONT_W && teammateBehind(chain, selfId, BEHIND_MAX_AGE_MS);
}


// A pending start of mine is confirmed by my draft, or by position (I am frontmost with a teammate
// behind me).
export function startConfirmed({drafts, chain, selfId, frontId}) {
    return draftFront({drafts, chain, selfId}) ||
        (frontId === selfId && teammateBehind(chain, selfId, ROT_MAX_AGE_MS));
}


// Consecutive self samples with draftFront true: {n, at} with `at` the t of the first of them.
export function draftRun(run, {t, ok}) {
    if (!ok) {
        return {n: 0, at: null};
    }
    return run && run.n > 0 ? {n: run.n + 1, at: run.at} : {n: 1, at: t};
}


// Plan riders seen in my chain within PRESENT_GRACE_MS count as present, so countdowns do not jump
// when someone flickers out. seen: {id: last seen ms}. Returns the new map and the present ids.
export function presence(seen, {now, chainIds}) {
    const out = {};
    for (const [id, at] of Object.entries(seen || {})) {
        if (now - at < PRESENT_GRACE_MS) {
            out[id] = at;
        }
    }
    for (const id of chainIds || []) {
        out[id] = now;
    }
    return {seen: out, ids: Object.keys(out)};
}


// Why there is no rotation view, or null. Order: no plan, not a plan rider, no live data of mine,
// standing still, just rolled off (START_QUIET_MS), final sprint, climb or descent, alone (no
// fresh teammate in my chain).
export function dashReason({plan, selfId, live, finish, climbing, descent = false, chain, still = false,
                            starting = false}) {
    if (!plan || !Array.isArray(plan.riders)) {
        return 'noplan';
    }
    if (selfId === null || selfId === undefined || !plan.riders.some(r => r.id === selfId)) {
        return 'notin';
    }
    if (!live) {
        return 'nolive';
    }
    if (still) {
        return 'still';
    }
    if (starting) {
        return 'start';
    }
    if (finish) {
        return 'finish';
    }
    if (climbing) {
        return descent ? 'descent' : 'climb';
    }
    if (!(chain || []).some(c => c.id !== selfId)) {
        return 'alone';
    }
    return null;
}


// The action window's dash for a reason: 'climb' (dim ▲), 'descent' (dim ▼), 'unknown' (amber ?) or
// 'none'.
// started: a puller has been seen in this ride. Before that (the start pen) nothing is wrong, so
// no amber "?", just the quiet dash.
export function dashKind(reason, {started = true} = {}) {
    if (reason === 'climb' || reason === 'descent') {
        return reason;
    }
    const unknown = reason === 'alone' || reason === 'nolive' || reason === 'nofront';
    return unknown && started ? 'unknown' : 'none';
}


// What a trackFront step did with my own pull: 'start' | 'draftStart' | 'end' | 'revert' | null.
export function selfEvent(before, after) {
    return after.last && after.last !== before.last ? after.last.kind : null;
}


// Early start (I am next, but the puller still has more than JUMP_GATE_S to go): only when the
// rider in front is gone, i.e. I am the first rider of my team chain.
export function earlyStartAllowed({chainIds, selfId, pullerId}) {
    return Array.isArray(chainIds) && chainIds.length > 0 && chainIds[0] === selfId &&
        pullerId !== selfId;
}


// True in the last FINISH_M of a distance-based event. Sauce puts `remaining`, `remainingMetric`
// ('distance' in m, or 'time' in s) and `remainingType` ('event', or 'route' outside an event) at
// the top level of each athlete entry. A route ride would get the dash at the end of every lap.
export function finishMode(entry) {
    return !!entry && entry.remainingType === 'event' && entry.remainingMetric === 'distance' &&
        Number.isFinite(entry.remaining) && entry.remaining <= FINISH_M;
}


// Finish mode for this step. On from finishMode, then it stays on until I stand still or Sauce
// shows an event distance clearly before the finish (more than FINISH_M: another race). A step
// without live data keeps the previous value. 12 Nov and 17 Nov 2026: finish mode went off just
// past the line and the rotation and the gap warnings ran on for 28 s (a gap of 31 m, puller
// changes).
export function finishStep(prev, {live, entry, still}) {
    if (!live) {
        return !!prev;
    }
    if (finishMode(entry)) {
        return true;
    }
    if (still) {
        return false;
    }
    const another = !!entry && entry.remainingType === 'event' && entry.remainingMetric === 'distance' &&
        Number.isFinite(entry.remaining) && entry.remaining > FINISH_M;
    return !!prev && !another;
}


// ---------- my power ----------

// Adds a sample {t, w} (t in ms) and keeps the newest HIST_KEEP. Non-numeric samples are ignored.
export function pushPower(hist, sample) {
    if (!sample || !Number.isFinite(sample.w) || !Number.isFinite(sample.t)) {
        return hist;
    }
    return [...(hist || []), {t: sample.t, w: sample.w}].slice(-HIST_KEEP);
}


function mean(xs) {
    return xs.reduce((sum, x) => sum + x.w, 0) / xs.length;
}


// The last n samples against the up to REST_WINDOW_S before them (at least REST_MIN_N).
function jumpOf(hist, n, target, frac) {
    if (!hist || hist.length < n + REST_MIN_N) {
        return null;
    }
    const last = hist.slice(-n);
    const rest = hist.slice(Math.max(0, hist.length - n - REST_WINDOW_S), hist.length - n);
    const m = mean(last);
    if (m < mean(rest) + JUMP_W) {
        return null;
    }
    if (Number.isFinite(target) && m < frac * target) {
        return null;
    }
    return last[0].t;
}


// Fast start: my last SMOOTH_S samples jump JUMP_W over my rest (and reach JUMP_TARGET_FRAC of
// the target). Returns the t of the first of those samples, else null.
export function powerJump(hist, target) {
    return jumpOf(hist, SMOOTH_S, target, JUMP_TARGET_FRAC);
}


// Early start: the same over my last SUSTAIN_S samples, against SUSTAIN_TARGET_FRAC of the target.
export function sustainedJump(hist, target) {
    return jumpOf(hist, SUSTAIN_S, target, SUSTAIN_TARGET_FRAC);
}


// End: my last 2 samples average below `below` (END_W). Returns the t of the first of them, else
// null.
export function powerDrop(hist, below = END_W) {
    if (!hist || hist.length < END_N || !Number.isFinite(below)) {
        return null;
    }
    const last = hist.slice(-END_N);
    return mean(last) < below ? last[0].t : null;
}


// ---------- climbs and descents ----------

export function initialClimb() {
    return {climbing: false, descent: false, since: null, above: null, below: null, down: null};
}


// The terrain pause, grade in percent. `climbing` is true on a climb and on a descent (`descent`
// true then); both pause the rotation (user, 12 Nov 2026: on descents riders often sprint up
// from behind while the front rider drops back). A climb starts after CLIMB_ENTER_MS at or above
// CLIMB_GRADE (`above`: since when) and ends after CLIMB_EXIT_MS below CLIMB_EXIT_GRADE; a descent
// starts after DESCENT_ENTER_MS at or below DESCENT_GRADE (`down`) and ends after DESCENT_EXIT_MS
// above DESCENT_EXIT_GRADE (`below`: since when the end condition holds). `since`: when the
// current state began. A missing grade changes nothing.
export function climbState(state, {now, grade}) {
    const s = {...initialClimb(), ...state};
    if (!Number.isFinite(grade) || Math.abs(grade) > MAX_GRADE) {
        return s;
    }
    if (!s.climbing) {
        const above = grade >= CLIMB_GRADE ? s.above ?? now : null;
        const down = grade <= DESCENT_GRADE ? s.down ?? now : null;
        if (above !== null && now - above >= CLIMB_ENTER_MS) {
            return {...initialClimb(), climbing: true, since: now};
        }
        if (down !== null && now - down >= DESCENT_ENTER_MS) {
            return {...initialClimb(), climbing: true, descent: true, since: now};
        }
        return {...s, above, down};
    }
    const flat = s.descent ? grade > DESCENT_EXIT_GRADE : grade < CLIMB_EXIT_GRADE;
    if (!flat) {
        return {...s, below: null};
    }
    const below = s.below ?? now;
    if (now - below >= (s.descent ? DESCENT_EXIT_MS : CLIMB_EXIT_MS)) {
        return {...initialClimb(), since: now};
    }
    return {...s, below};
}


export function initialHill() {
    return {mode: null, descent: false};
}


// The terrain this step: mode 'flag' on a roller (the rotation goes on), 'pause' on a real climb or
// descent, null elsewhere; `descent` on a descent. terrain {hill}: the route profile's hill at my
// place (terrain.mjs hillAt; hill null: no hill here), which wins when given; without it
// (undefined) the live grade (climbState): a roller for the first ROLLER_LIVE_MS, then a real one.
export function hillMode(climb, {now, terrain}) {
    if (terrain !== undefined && terrain !== null) {
        const h = terrain.hill;
        return h ? {mode: h.roller ? 'flag' : 'pause', descent: h.kind === 'descent'} : initialHill();
    }
    if (!climb?.climbing) {
        return initialHill();
    }
    return {mode: now - climb.since < ROLLER_LIVE_MS ? 'flag' : 'pause', descent: !!climb.descent};
}


export function rotationView(plan, {selfId, chainIds, wheelId, front, now}) {
    const riders = plan?.riders;
    if (!riders) {
        return null;
    }
    const pi = riders.findIndex(r => r.id === front?.puller);
    const mi = riders.findIndex(r => r.id === selfId);
    if (pi < 0 || mi < 0) {
        return null;
    }
    const puller = riders[pi];
    const me = riders[mi];
    // The start puller's first pull: his plan time plus the start bonus (front.bonus, START_BONUS_S).
    const b = front.bonus;
    const pullS = puller.pullS + (b && b.id === puller.id && b.since === front.since ? b.s : 0);
    const present = new Set(chainIds || []);
    present.add(puller.id);
    present.add(me.id);
    const elapsedS = Math.floor((now - front.since) / 1000);
    const mine = pi === mi;
    const len = riders.length;
    // The rider directly before me in plan order, of those present (the puller when I am next).
    let beforeMe = null;
    for (let k = 1; k < len && !mine; k++) {
        const r = riders[(mi - k + len) % len];
        if (present.has(r.id)) {
            beforeMe = r;
            break;
        }
    }
    let next = null;
    let between = 0;
    let reachedMe = false;
    let place = mine ? 1 : null;    // my place in the line by plan order: the puller is 1
    let seen = 1;
    for (let k = 1; k < len; k++) {
        const r = riders[(pi + k) % len];
        if (!present.has(r.id)) {
            continue;
        }
        seen++;
        if (next === null) {
            next = r;
        }
        if (r === me) {
            reachedMe = true;
            if (!mine) {
                place = seen;
            }
            break;
        }
        between += expectedPullS(r.pullS, r === beforeMe);
    }
    // The puller's expected end: his plan plus the allowance, his plan alone when he is before me.
    const endS = expectedPullS(pullS, puller === beforeMe);
    let toMyPullS = null;
    if (!mine && reachedMe) {
        // Past his expected end the countdown runs on for RUN_ON_S, then waits for the change.
        toMyPullS = Math.max(0, between + Math.max(endS - elapsedS, -RUN_ON_S));
    }
    // The standing clock (user, 13 Nov 2026): the countdown waits for the change, my pull is at
    // least toMyPullS away; overS: how long the puller is over his plan (with the start bonus).
    const overS = Math.max(0, elapsedS - pullS);
    const standing = toMyPullS !== null && elapsedS - endS > RUN_ON_S;
    return {
        puller,
        elapsedS,
        pullS,
        remainingS: pullS - elapsedS,
        mine,
        toMyPullS,
        standing,
        overS,
        place,
        next,
        wheel: riders.find(r => r.id === wheelId) || null,
        me,
    };
}


// ---------- one rotation step ----------

export function initialRotation() {
    return {
        front: initialFront(),
        climb: initialClimb(),
        hill: initialHill(),       // roller ('flag') or real climb/descent ('pause'): hillMode
        alone: false,              // live, but no teammate in my chain
        finish: false,             // in the final sprint (finishMode)
        chain: [],                 // my team chain, front first
        frontId: null,             // frontmost plan rider of my chain
        seen: {},                  // presence grace
        present: [],
        run: {n: 0, at: null},     // my draft run (draftRun)
        still: {still: false, since: null},    // I stand still (stillStep): no rotation
        rolledAt: null,            // when I last rolled off after standing still (startQuiet)
        startAt: null,             // when the start lock began (my first roll-off with a plan)
        locked: false,             // in the start lock (START_LOCK_MS)
        startFront: null,          // since when the start puller is in front, in the lock
        startFound: false,         // he has been in front for HOLD_MS: the start chaos is over
        pause: null,               // the puller before the last climb or alone phase (pauseClock)
    };
}


// Standing still (start pen, or a stop): no front tracking and no own pull, so the pen never runs
// a rotation (everyone stands within 20 m with draft 0). Before any puller (tracking false) a slow
// sample counts at once; with a rotation running it must last STOP_MS, so a slow corner or a data
// hiccup does not reset it. Moving again ends it at once; a sample without speed keeps the state.
export function stillStep(prev, {now, speed, tracking}) {
    const p = prev || {still: false, since: null};
    if (!Number.isFinite(speed)) {
        return p;
    }
    if (speed >= STOP_KMH) {
        return {still: false, since: null};
    }
    const since = p.since ?? now;
    return {still: p.still || !tracking || now - since >= STOP_MS, since};
}


// The windows' quiet start: after the start (out of the pen) until the start puller has been in
// front for HOLD_MS, at most for START_LOCK_MS; after any other roll-off (a stop) START_QUIET_MS.
export function startQuiet(st, now) {
    if (!Number.isFinite(st?.rolledAt)) {
        return false;
    }
    if (st.startAt != null && st.rolledAt === st.startAt) {
        return now - st.startAt < START_LOCK_MS && !st.startFound;
    }
    return now - st.rolledAt < START_QUIET_MS;
}


// After a climb or riding alone (a pause): the puller from before the pause gets his clock back
// when he is adopted again within RESUME_MS after it, after another rider was in front first: the
// time he had pulled when the pause began (held), plus the time since he is back in front. The
// pause and the other rider's pull do not count (13 Nov 2026: one rider's recording, 78 s instead of
// 10 s). pause: {puller, held, end} (end null while the pause lasts) or null. before/front: the front
// state before and after this step. Returns the new pause memory and the front to use.
export function pauseClock(pause, {now, pausedBefore, pausedNow, before, front}) {
    let p = pause || null;
    if (pausedNow && !pausedBefore) {
        p = before.puller == null ? null : {puller: before.puller, held: now - before.since, end: null};
    } else if (!pausedNow && pausedBefore && p) {
        p = {...p, end: now};
    }
    if (!p || p.end === null) {
        return {pause: p, front};
    }
    if (now - p.end >= RESUME_MS) {
        return {pause: null, front};
    }
    if (front.puller !== p.puller) {
        return {pause: p, front};
    }
    // He is the puller again: back after someone else (his clock goes on from where the pause
    // stopped it), or he simply carried on.
    return {pause: null, front: front.puller !== before.puller ? {...front, since: front.since - p.held} : front};
}


// The rotation state for a newly loaded plan (another sig, e.g. a server plan mid-race). When the
// puller is still a rider of the new plan, the rotation carries on: front (puller and since, so his
// clock does not restart), climb, presence and my own pull state are kept; only references to
// riders no longer in the plan are dropped. Otherwise (no plan, or the puller left the plan) it
// starts over, except the climb and the roll-off time, which do not depend on the plan.
export function carryRotation(st, plan) {
    const ids = new Set((plan?.riders || []).map(r => r.id));
    if (!plan || (st.front.puller != null && !ids.has(st.front.puller))) {
        return {...initialRotation(), climb: st.climb, hill: st.hill ?? initialHill(), rolledAt: st.rolledAt ?? null,
                startAt: st.startAt ?? null};
    }
    const front = {...st.front};
    if (front.cand != null && !ids.has(front.cand)) {
        clearCand(front);
    }
    if (front.pending && !ids.has(front.pending.id)) {
        front.pending = null;
    }
    if (front.prev && !ids.has(front.prev.puller)) {
        front.prev = null;
    }
    const seen = Object.fromEntries(Object.entries(st.seen || {}).filter(([id]) => ids.has(id)));
    const pause = st.pause && ids.has(st.pause.puller) ? st.pause : null;
    return {...st, front, seen, pause, present: (st.present || []).filter(id => ids.has(id))};
}


// The rotation view, or null and why (dashReason; 'nofront' when nobody is tracked yet). `live`:
// a current sample of my own rider; without one, counting down from the last known puller would
// be misleading. `quietStart`: the windows' view, quiet for START_QUIET_MS after rolling off
// ('start'); the engine's own calls leave it out, so tracking goes on meanwhile.
export function rotationStatus(st, {now, plan, selfId, live, quietStart = false}) {
    const reason = dashReason({plan, selfId, live, finish: st.finish, climbing: st.hill?.mode === 'pause',
                               descent: !!st.hill?.descent, chain: st.chain, still: !!st.still?.still,
                               starting: quietStart && startQuiet(st, now) && st.front?.puller !== selfId});
    if (reason) {
        return {view: null, reason};
    }
    const wheel = planWheel(plan, {selfId, pullerId: st.front.puller, presentIds: st.present});
    const view = rotationView(plan, {selfId, chainIds: st.present, wheelId: wheel, front: st.front, now});
    return view ? {view, reason: null} : {view: null, reason: 'nofront'};
}


// My own pull start or end for trackFront, judged on the view before this step's tracking:
// - pulling >= END_MIN_S and not going downhill: the power drop ends it. The next rider comes from
//   my fresh chain (not the presence grace), so a rider just dropped is not handed the pull.
// - next, puller due (remainingS <= JUMP_GATE_S) or gone (I am first in my chain): a power jump
//   (fast rule when due, the 8 s rule when gone), else my draft run (which only counts samples
//   with this gate open, so it never starts before the gate opened).
// Also returns the shadow rules for the recorder.
function ownPull(st, {now, plan, selfId, hist, grade}) {
    const out = {own: {}, shadowEarly: null, shadowEnd06: null};
    const {view} = rotationStatus(st, {now, plan, selfId, live: true});
    if (!view) {
        return out;
    }
    const target = Number.isFinite(view.me.watts) ? view.me.watts : null;
    const chainIds = st.chain.map(c => c.id);
    if (view.mine) {
        const next = rotationView(plan, {selfId, chainIds, wheelId: null, front: st.front, now}).next;
        if (view.elapsedS < END_MIN_S || !next) {
            return out;
        }
        out.shadowEnd06 = target === null ? null : powerDrop(hist, END_FRAC * target);
        const at = grade !== null && grade <= DESCENT_GRADE ? null : powerDrop(hist);
        if (at !== null) {
            out.own = {selfEnd: {id: selfId, at, nextId: next.id}};
        }
        return out;
    }
    if (view.next?.id !== selfId) {
        return out;
    }
    out.shadowEarly = sustainedJump(hist, target);
    const gate = startGate(view, {chainIds, selfId});
    if (!gate) {
        return out;
    }
    const due = gate === 'due';
    const at = due ? powerJump(hist, target) : out.shadowEarly;
    if (at !== null) {
        out.own = {selfStart: {id: selfId, at}};
    } else if (st.run.n >= DRAFT_RUN_N) {
        out.own = {draftStart: {id: selfId, at: st.run.at}};
    }
    return out;
}


// When I am next: 'due' (the puller has JUMP_GATE_S or less left), 'gone' (I am first in my
// chain), else null. Only then can my own pull start.
function startGate(view, {chainIds, selfId}) {
    if (!view || view.mine || view.next?.id !== selfId) {
        return null;
    }
    if (view.remainingS <= JUMP_GATE_S) {
        return 'due';
    }
    return earlyStartAllowed({chainIds, selfId, pullerId: view.puller.id}) ? 'gone' : null;
}


// One step of the rotation (about once a second). inputs: now, plan, riderIds (plan riders),
// selfId, nearby (the list), hist (my power history), drafts (my last draft samples), grade (my
// grade in percent or null), sampleT (t of a self sample not yet seen by a step, or null), terrain
// ({hill} from the route profile when my place on it is known, else undefined: hillMode).
// Returns the new state, my own pull event ('start' | 'draftStart' | 'end' | 'revert' | null) and
// the shadow rules (recorded only).
export function rotationStep(prev, {now, plan, riderIds, selfId, nearby, hist, drafts, grade, sampleT,
                                    terrain = undefined}) {
    const st = {...prev};
    st.chain = selfId === null || selfId === undefined ? [] :
        teamChain(alignedPositions(nearby, riderIds), selfId);
    st.frontId = frontOf(st.chain, riderIds);
    const live = selfId !== null && selfId !== undefined && selfLive(nearby, selfId);
    // Before anything else reads the state: standing still pauses everything below.
    st.still = live ?
        stillStep(prev.still, {now, speed: Number(selfEntry(nearby)?.state?.speed),
                               tracking: prev.front.puller != null}) :
        (prev.still || {still: false, since: null});
    st.rolledAt = live && prev.still?.still && !st.still.still ? now : (prev.rolledAt ?? null);
    st.finish = finishStep(prev.finish, {live, entry: selfEntry(nearby), still: st.still.still});
    ({seen: st.seen, ids: st.present} = presence(prev.seen, {now, chainIds: st.chain.map(c => c.id)}));
    // The start (START_LOCK_MS): my first roll-off with a plan sets plan #1 as the puller.
    const starting = st.rolledAt === now && prev.rolledAt !== now && prev.still?.since != null &&
        now - prev.still.since >= START_PEN_MS && !!plan?.riders?.length;
    st.startAt = starting ? now : prev.startAt ?? null;
    const locked = st.startAt !== null && now - st.startAt < START_LOCK_MS;
    const unlocked = !locked && !!prev.locked;
    st.locked = locked;
    st.climb = climbState(prev.climb, {now, grade: live && !locked ? grade : null});
    st.hill = locked ? initialHill() : hillMode(st.climb, {now, terrain: live ? terrain : undefined});
    const prevHill = prev.hill || initialHill();
    const paused = st.hill.mode === 'pause' || st.alone;
    const pausedBefore = prevHill.mode === 'pause' || prev.alone;
    // Alone, I would be my own front rider: the puller is kept instead (and nothing of mine runs).
    st.alone = live && !st.chain.some(c => c.id !== selfId);
    if (sampleT !== null && sampleT !== undefined) {
        // The draft run counts samples where my draft says I lead AND my start gate is open (on the
        // view before this step's tracking), so its `at` is never before the gate opened.
        const open = live && !locked && !st.finish && !st.hill.mode && !st.alone && !prevHill.mode &&
            !prev.alone && !!startGate(rotationStatus(st, {now, plan, selfId, live}).view,
                                       {chainIds: st.chain.map(c => c.id), selfId});
        st.run = draftRun(prev.run, {t: sampleT, ok: open && draftFront({drafts, chain: st.chain, selfId})});
    }
    let shadowEarly = null;
    let shadowEnd06 = null;
    if (st.still.still) {
        // Start pen or a stop: forget the front (the first front rider after the start gets a
        // fresh clock, not the pen time) and any own-pull attempt.
        st.front = initialFront();
        st.run = {n: 0, at: null};
        st.pause = null;
        return {state: st, self: null, shadowEarly, shadowEnd06};
    }
    // The lock's end counts as a change at the front (chaos hold for anyone else).
    const pf = unlocked ? {...prev.front, changedAt: now} : prev.front;
    if (starting) {
        const p1 = plan.riders[0].id;
        st.front = {...initialFront(), puller: p1, since: now, changedAt: now,
                    bonus: {id: p1, since: now, s: START_BONUS_S}};
    } else if (locked) {
        st.front = prev.front;
    } else if (paused) {
        st.front = trackFront(pf, {now, frontId: null});
    } else if (pausedBefore) {
        st.front = resumeFront(pf, {now, frontId: st.frontId, chain: st.chain});
    } else if (st.hill.mode === 'flag') {
        // A roller: the puller or the plan's next may take the front; anyone else in front is
        // ignored. No own pull from my power or draft (both swing on a roller).
        const expected = rotationView(plan, {selfId, chainIds: st.present, wheelId: null, front: pf, now});
        const ok = pf.puller == null || st.frontId === pf.puller ||
            (st.frontId != null && st.frontId === expected?.next?.id);
        st.front = trackFront(pf, {now, frontId: ok ? st.frontId : null});
    } else {
        let own = {};
        if (live && !st.finish) {
            ({own, shadowEarly, shadowEnd06} = ownPull(st, {now, plan, selfId, hist, grade}));
        }
        const confirm = live && !st.finish &&
            startConfirmed({drafts, chain: st.chain, selfId, frontId: st.frontId});
        const expected = rotationView(plan, {selfId, chainIds: st.present, wheelId: null, front: pf, now});
        const slowId = skipsAhead(plan, {pullerId: pf.puller, nextId: expected?.next?.id,
                                         frontId: st.frontId}) ? st.frontId : null;
        const backId = riderBefore(plan, {pullerId: pf.puller, presentIds: st.present});
        st.front = trackFront(pf, {now, frontId: st.frontId, ...own, confirm, slowId, backId});
    }
    // In the lock: is the start puller in front yet (HOLD_MS)? Then the start chaos is over.
    const inFront = locked && st.frontId != null && st.frontId === st.front.puller;
    st.startFront = inFront ? (starting ? now : prev.startFront ?? now) : null;
    st.startFound = locked && ((!starting && !!prev.startFound) ||
        (st.startFront !== null && now - st.startFront >= HOLD_MS));
    ({pause: st.pause, front: st.front} = pauseClock(prev.pause, {
        now, pausedBefore, pausedNow: paused,
        before: prev.front, front: st.front,
    }));
    const self = selfEvent(prev.front, st.front);
    return {state: st, self, shadowEarly, shadowEnd06};
}


// The observed wheel: the rider right in front of me in my chain. Behind the first few riders the
// observed order is often scrambled, so it is only recorded (det.wheelObs); planWheel is shown.
export function wheelOf(chain, selfId) {
    const i = chain.findIndex(p => p.id === selfId);
    return i > 0 ? chain[i - 1].id : null;
}


// My observed place in my chain (1 = front), or null when I am not in it. Recorded only, to
// compare with the plan-order place that is shown.
export function placeOf(chain, selfId) {
    const i = (chain || []).findIndex(p => p.id === selfId);
    return i < 0 ? null : i + 1;
}


// The wheel I follow by the plan alone: the rider right before me in plan order (the last rider
// when I am #1), whoever is present. null when I am not a plan rider or ride alone in the plan.
// Shown before the start and whenever the live rotation is off, so the rider can memorise it.
export function plannedWheel(plan, selfId) {
    const riders = plan?.riders;
    const mi = riders && selfId != null ? riders.findIndex(r => r.id === selfId) : -1;
    if (mi < 0 || riders.length < 2) {
        return null;
    }
    return riders[(mi - 1 + riders.length) % riders.length];
}


// The "Wheel to follow" line: my planned wheel, and the live one only when it differs, which
// happens when the planned rider is not with the group (view.wheel skips absent riders; the caller
// may pass the wheel it worked out instead, see myWheel in paceline.mjs). null off the plan.
export function wheelToFollow(plan, selfId, view) {
    const planned = plannedWheel(plan, selfId);
    if (!planned) {
        return null;
    }
    const w = view && view.wheel;
    return {planned, live: w && w.id !== planned.id ? w : null};
}


// The captain's "Next" line: who pulls next. While the rotation runs, the live next rider. When
// it is paused or unknown (climb, alone, no data), the plan's next after the last puller (the
// engine keeps that puller through those phases), marked planned; before any puller is known
// (before the start), plan #1, also planned. Nothing in the final sprint or without a plan.
export function captainNext({plan, view, reason, pullerId}) {
    const riders = plan?.riders;
    if (!riders || !riders.length || reason === 'finish') {
        return null;
    }
    if (view && view.next) {
        return {rider: view.next, planned: false};
    }
    const pi = riders.findIndex(r => r.id === pullerId);
    return {rider: pi < 0 ? riders[0] : riders[(pi + 1) % riders.length], planned: true};
}


// My wheel from the plan: the present plan rider right before me in rotation order, counted from
// the puller (so the puller when I am next, null when I pull or either is not a plan rider).
// presentIds: chain members plus presence grace; the puller always counts as present.
export function planWheel(plan, {selfId, pullerId, presentIds}) {
    const riders = plan?.riders;
    if (!riders) {
        return null;
    }
    const pi = riders.findIndex(r => r.id === pullerId);
    const mi = riders.findIndex(r => r.id === selfId);
    if (pi < 0 || mi < 0 || pi === mi) {
        return null;
    }
    const present = new Set(presentIds || []);
    let wheel = riders[pi].id;
    for (let k = 1; k < riders.length; k++) {
        const r = riders[(pi + k) % riders.length];
        if (r.id === selfId) {
            return wheel;
        }
        if (present.has(r.id)) {
            wheel = r.id;
        }
    }
    return wheel;
}


// The whole rotation for the Info window's table (user, 13 Nov 2026): the plan riders in rotation
// order from the current puller (before any puller: from plan #1), so it turns with every change.
// Each row: the rider, his plan number, whether he pulls, and whether he is with the group
// (presentIds; null = everyone, as before the start; the puller always counts). Riders not with the
// group (dropped: out of my chain for PRESENT_GRACE_MS) come last, in plan order, so the rows above
// are the rotation as it really turns and the dropped ones stay put below it (user, 14 Nov 2026).
export function rotationTable(plan, {pullerId = null, presentIds = null} = {}) {
    const riders = plan?.riders || [];
    const pi = riders.findIndex(r => r.id === pullerId);
    const start = Math.max(0, pi);
    const present = presentIds ? new Set(presentIds) : null;
    const rows = riders.map((_, k) => {
        const i = (start + k) % riders.length;
        const r = riders[i];
        return {rider: r, number: i + 1, pulling: i === pi, present: !present || i === pi || present.has(r.id)};
    });
    return [...rows.filter(r => r.present), ...rows.filter(r => !r.present).sort((a, b) => a.number - b.number)];
}


// When the Info window shows the rotation table: before the start (no puller yet, standing in
// the pen, or the quiet seconds after rolling off), and always with the option on.
export function tableShown({plan, always, pullerId, reason}) {
    if (!plan || !Array.isArray(plan.riders) || !plan.riders.length) {
        return false;
    }
    return !!always || pullerId == null || reason === 'still' || reason === 'start';
}


// pos: 0..1 with 0.5 = on target, BAR_RANGE_PCT of the target either side fills the bar; zone by
// how far off the target, in percent.
export function powerBar(watts, target) {
    if (!Number.isFinite(watts) || !Number.isFinite(target) || !(target > 0)) {
        return null;
    }
    const pct = (watts - target) / target * 100;
    const pos = Math.min(1, Math.max(0, 0.5 + pct / (2 * BAR_RANGE_PCT)));
    const a = Math.abs(pct);
    const zone = a <= GREEN_PCT ? 'green' : a <= AMBER_PCT ? 'amber' : 'red';
    return {pos, zone};
}
