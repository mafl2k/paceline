// Pure logic (no DOM, no Sauce imports): who is pulling (the frontmost rider of my team chain),
// how long until my pull, who is on my wheel, and the power-bar helper.

import {MAX_AGE_MS, selfEntry} from './recording.mjs';
import {initialOrder, orderStep, orderBad, orderCount, orderOutIds, classifyChange} from './order.mjs';
import {handoverStep, freshState} from './handover.mjs';
import {initialEff, effCut, effStep, teamE, teamH} from './efficiency.mjs';

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
// By pull length (user, 20 Nov 2026): the effective overhead from the recoveries of the same
// races shrinks with the plan, about +9 / +7 / +5 / +3.5 s for plans of up to 20 / 21–40 / 41–80 /
// over 80 s (a fixed part of the changeover plus a share that grows with the pull's length). So
// pulls up to LONG_PULL_S count CHANGE_ALLOWANCE_S, longer ones CHANGE_ALLOWANCE_LONG_S. In the
// replay of the races the error split 13.0 against 13.5 s with one value, and about 30 % fewer
// small downward jumps.
// Since 21 Nov 2026 (user; design 2026-11-21-paceline-beta5 §2) the countdown counts the team's
// learned turn time instead (efficiency.mjs): every rider still to pull before me plan + E, the
// rider directly before me plan + E - H. CHANGE_ALLOWANCE_S / CHANGE_ALLOWANCE_LONG_S are now E's
// prior (by the same plan length) and the fixed rule of the shadow countdown (`eff` null). Why: in
// the analysis of the recorded races (21 Nov 2026) the error against T0 (the rider before me easing
// off) went from 10 to 7.3 s abs over 23 rider views.
export const CHANGE_ALLOWANCE_S = 10;
export const CHANGE_ALLOWANCE_LONG_S = 5;
export const LONG_PULL_S = 40;

// The countdown's expected length of a pull: its plan (pullS, the start bonus included for the
// start puller) plus the change overhead, or the plan alone for the rider directly before me.
// The overhead is chosen by planS, the plan's pull without the start bonus (default: pullS).
// With `eff` (the learner's state, efficiency.mjs; 21 Nov 2026, design §2): plan + E, the rider
// before me plan + E - H, E with the prior chosen by planS. `eff` null: the fixed rule above.
export function expectedPullS(pullS, beforeMe, planS = pullS, eff = null) {
    if (eff) {
        return pullS + teamE(eff, planS <= LONG_PULL_S ? CHANGE_ALLOWANCE_S : CHANGE_ALLOWANCE_LONG_S) -
            (beforeMe ? teamH(eff) : 0);
    }
    if (beforeMe) {
        return pullS;
    }
    return pullS + (planS <= LONG_PULL_S ? CHANGE_ALLOWANCE_S : CHANGE_ALLOWANCE_LONG_S);
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
// alone. End: a sharp drop below my end threshold (END_W, or END_FRAC of my target when that is
// lower), the median of END_N samples. Climbs and descents pause the rotation, the final sprint
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
// My end threshold is min(END_W, END_FRAC x target), END_W without a target (audit fixes, 20 Nov
// 2026, C1): with END_W alone a rider with a target under about 140 W lost every pull at END_MIN_S
// (probe p03: a 120 W target ridden at 120 W ended each pull at 20 s, my window showed my pull in
// 61 of 210 s; now 204). Not END_FRAC x target alone: above about 217 W that ends pulls at a
// higher power than before, and in the six-ride replay it gave one race a new 373 s chaos phase
// and cost another puller-right (93 -> 91 %); with min() the replay is unchanged. The shadow rule
// (recorded only) stays END_FRAC x target.
export const END_FRAC = 0.6;
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
// Plan #1 means the first plan rider present in the pen (startPuller; audit fixes, 20 Nov 2026,
// I9; probe p08: with plan #1 not in the race the lock named him anyway, the puller for everyone's
// first 75 s). With no plan rider but me in my chain there is no lock: a plain roll-off
// (START_QUIET_MS), the front rider is tracked as after a stop. Standing START_PEN_MS ends the last
// start (startAt null; M8, probe p41), so a second race in the same session starts like the first;
// not a stand after the finish line (M-4, see rotationStep).
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
// The end: the median of the last END_N samples (audit fixes, 20 Nov 2026, C1; was the mean of 2).
// One dropped sample (0 W) ended my pull at every target up to 259 W (probe p02: at 250 W one zero
// at 30 s ended it, and only the 30 s back hold gave it back, 39 s on the rest countdown while I
// was in front).
const END_N = 3;
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
    return {puller: null, since: null, cand: null, candSince: null, changedAt: null, adopt: null, held: null,
            lost: null, fired: null};
}


function clearCand(s) {
    s.cand = null;
    s.candSince = null;
    s.lost = null;
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
//   Audit fixes, 20 Nov 2026 (C1; probe p02: one 0 W sample at 30 s of a 250 W pull ended it, and
//   only the back hold gave it back at 69 s, 39 s of rest countdown while I was in front): my end
//   can be undone like a wrong start. `prev` keeps my pull (`end: true`); if I am in front again
//   right after the ignore window with `selfOn` (my draft says I lead and my power is back, see
//   powerBack), my pull comes back with its old since ('back'). Once the rider my end named is in
//   front, `prev` is dropped. And no back hold against me while the pull my end handed over runs
//   (handOffCand): the chaos hold applies, as after any change.
// `last` {kind: 'start' | 'draftStart' | 'end' | 'revert', at} is the latest of these (see
// selfEvent). A start that is not newer than it is ignored, so one jump or draft run still in the
// history is not taken twice.
// `adopt` says how the puller changed in this step: 'front' (the front rider after his hold, or the
// first sighting), 'self' (my start), 'end' (the hand-off at my end), 'back' (my wrong start or end undone),
// 'resume' (resumeFront); null when he did not change. Only 'front' and 'self' are changes seen at
// the front, which rotationStep classifies against the plan order (order.mjs).
// `held` is 'back' while the back hold (BACK_HOLD_MS) holds the candidate in this step, else null;
// rotationStep counts a held back candidate who leaves unadopted (backHeldStep).
// In chaos (the order does not hold; user, 20 Nov 2026, spec 2026-11-20-paceline-chaos-counter
// sections 4 and 7) the back hold (backId) and the skip hold (slowId) are off: both assume the plan's
// order is right, and in the mock-plan race of 19 Nov they fired every round (23 stalls, puller right
// only 72 %). HOLD_MS and CHAOS_HOLD_MS stay. My end hands the pull to nobody: the plan's next is a
// guess there, so I stay the puller (ignored as front rider as always) until the next front rider is
// adopted by tracking; a second end of the same pull is not taken.
//
// The hand-over detector (handover.mjs; user, 21 Nov 2026; design 2026-11-21-paceline-beta5 §1):
// `fired` {id, since, kind: 'arm', slow} is the next rider out of the draft and level with the
// puller within 8 s of the puller's power drop (the arm); `since` is the arm moment and `slow` says
// he would skip the planned next (skipsAhead). rotationStep passes it only outside chaos, a roller,
// a pause, the start lock and finish mode, and never while I am the puller or the puller is unseen;
// never for me or a joiner; and only when the fired rider is the front rider of my chain or the
// puller still is (final review of beta.5, I-1, 21 Nov 2026; see rotationStep). A fire makes him
// the candidate with candSince = the arm moment, no earlier than the puller's since + HOLD_MS, and
// HOLD_MS and the chaos hold count as satisfied: he is adopted in this step. The back hold (backId)
// and the skip hold (`slow`, outside chaos) still apply, from that candSince. The early returns (my
// end, my draft start, my pending start) ignore the fire. `fired` in the state is 'arm' in the step
// whose adoption came from a fire, else null.
// Every rule of the detector that counts samples (2 samples out of the draft, median of 5) assumes
// one step per second, as Sauce delivers it. Replay of six recorded races (21 Nov 2026): puller
// right 91 -> 92, 93 -> 96 and 93 -> 94 % in the three races of 12 Nov, 92 -> 94 % in the race of
// 19 Nov; pull start error 4 -> 2 s, decision 7 -> 5 s (medians); no new chaos.
// A fire never moves the candSince of the same rider later, whether he is the candidate or the
// candidate just lost (`lost`, while the old puller is still frontmost): the earlier of his candSince
// and the arm counts (decision 4, 21 Nov 2026). Why: re-arming every 8 s re-dated a held back
// candidate, and a skip candidate in front, at every arm; in synthetic back cases that gave two
// false rule-2 flags and chaos at 77-78 s, and in the mock-plan race of 19 Nov (a chaos check only)
// 30 s more chaos. With the rule: puller right 93 -> 94 % in the ZRL race of 17 Nov and 94 -> 95 %
// in one race of 12 Nov, chaos in the mock-plan race 1394 -> 1364 s, countdown abs against T0
// 7.85 -> 7.60 s (five races); the `lost` part changed no real-data number (it keeps the synthetic
// case of a back rider level with the puller, never in front, free of chaos).
// What the rule does not cover (checked 21 Nov 2026, with the guard of I-1): a skip candidate level
// with the fading puller while the puller is still frontmost. Between fires followCand drops him (no
// long hold: this step's slowId is null, the track rider is the puller), so he is neither the
// candidate nor `lost`, and each re-arm re-dates him (synthetic probe, the rider two places on level
// with the puller from 33 s: candSince 32, 41, 50, 59, 68 s). The fire never adopts him; he waits
// for the position rule once he is in front. No flag and no chaos come of it. The guard leaves this
// case as it was (the puller is the front rider, so the fire passes); it stops the fires of a rider
// behind another front rider, which no longer reach this function.
export function trackFront(state, {now, frontId, selfStart, draftStart, selfEnd, confirm, slowId = null, backId = null,
                                   chaos = false, selfOn = false, fired = null}) {
    const s = {...state, adopt: null, held: null, fired: null};
    // The fired candidate of this step ({id, kind}), set below; never stored in the state.
    let firedCand = null;
    const ignored = id => !!s.ignore && id === s.ignore.id && now - s.ignore.at < SELF_IGNORE_MS;
    const fromIgnored = x => !!s.ignore && x.id === s.ignore.id && x.at >= s.ignore.at &&
        x.at < s.ignore.at + SELF_IGNORE_MS;
    const fresh = x => !!x && x.id !== s.puller && !(x.at <= s.last?.at) && !ignored(x.id) &&
        !fromIgnored(x);
    if (chaos && selfEnd && selfEnd.id === s.puller && !(s.last?.kind === 'end' && s.last.at >= s.since)) {
        s.pending = null;
        s.prev = null;
        s.ignore = {id: selfEnd.id, at: selfEnd.at};
        s.last = {kind: 'end', at: selfEnd.at};
    } else if (!chaos && selfEnd && selfEnd.id === s.puller && selfEnd.nextId != null &&
               selfEnd.nextId !== selfEnd.id) {
        // My pull is kept for the undo (C1): `end` marks it.
        s.prev = {puller: selfEnd.id, since: s.since, at: selfEnd.at, end: true};
        s.puller = selfEnd.nextId;
        s.since = selfEnd.at;
        s.pending = null;
        s.ignore = {id: selfEnd.id, at: selfEnd.at};
        s.last = {kind: 'end', at: selfEnd.at};
        s.resumed = null;
        s.changedAt = now;
        s.adopt = 'end';
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
    // The hold for candidate `id` (in front since `since`), with the state as it is now:
    // Back right after my wrong start: he keeps the since he had, and the normal hold applies (he
    // is the puller we remember, not a new one).
    // The same for my own pull after my end (`prev.end`), but only with selfOn (see rotationStep;
    // audit fixes, 20 Nov 2026, C1, probe p02: two 0 W samples at 300 W gave my pull back after
    // 39 s, now 12 s).
    // No back hold against me right after my end (audit fixes, 20 Nov 2026, C1; probe p02: it kept
    // my rest countdown 39 s while I was in front): while I fade in front as the rider before the
    // plan's next, the chaos hold applies. Only until he has been in front (`prev.end` cleared
    // below), not for his whole pull (21 Nov 2026, review probe q1: me in front 85-92 s during his
    // pull made me the puller 88-107 s, his clock restarted and one bad flag; the 12 Nov flip that
    // BACK_HOLD_MS stops).
    const holdOf = (id, since) => {
        const back = id != null && !!s.prev && s.prev.puller === id &&
            since - s.prev.at <= SELF_IGNORE_MS + HOLD_MS && (!s.prev.end || selfOn);
        const recent = !back && (now - (s.changedAt ?? -Infinity) < CHAOS_WINDOW_MS ||
            (!chaos && slowId != null && id === slowId));
        const backHold = !back && !chaos && backId != null && id === backId && s.resumed !== s.puller &&
            !(s.prev?.end && id === s.ignore?.id && handOffEnd(s));
        // A fired candidate (handover.mjs) has HOLD_MS and the chaos hold satisfied; the back hold and
        // the skip hold still run from his candSince (user, 21 Nov 2026; design 2026-11-21-paceline-
        // beta5 §1).
        if (firedCand && id != null && id === firedCand.id) {
            return {back, backHold, hold: backHold ? BACK_HOLD_MS : (!chaos && fired?.slow) ? CHAOS_HOLD_MS : 0};
        }
        return {back, backHold, hold: backHold ? BACK_HOLD_MS : recent ? CHAOS_HOLD_MS : HOLD_MS};
    };
    // Only a candidate under a hold longer than HOLD_MS (back or chaos hold) keeps his since across a
    // short gap (followCand). Asked with this step's slowId, so not the skip hold (see followCand).
    const longHold = (id, since) => holdOf(id, since).hold > HOLD_MS;
    // The rider my end named is in front: the hand-off happened, no undo of my end any more (audit
    // fixes, 20 Nov 2026, C1). This also ends the exception from the back hold below.
    if (s.prev?.end && frontId != null && frontId === s.puller) {
        s.prev = null;
    }
    if (s.pending) {
        if (confirm) {
            takeOver(s, s.pending, now);
            s.last = {kind: 'start', at: s.pending.at};
            s.pending = null;
            return s;
        }
        if (now - s.pending.at < CONFIRM_MS) {
            followCand(s, frontId, now, longHold);
            return s;
        }
        s.pending = null;
        s.last = {kind: 'revert', at: now};
    }
    followCand(s, frontId, now, longHold);
    // A fire replaces any position candidate. candSince: the earlier of the arm and the candSince he
    // already has (as the candidate, or as the candidate just lost), no earlier than the puller's
    // since + HOLD_MS (decision 4, 21 Nov 2026; see above).
    if (fired && fired.id !== s.puller && !ignored(fired.id)) {
        const was = s.cand === fired.id ? s.candSince : s.lost?.id === fired.id ? s.lost.since : null;
        const base = was != null ? Math.min(was, fired.since) : fired.since;
        s.cand = fired.id;
        s.candSince = Math.max(base, (s.since ?? -Infinity) + HOLD_MS);
        firedCand = {id: fired.id, kind: fired.kind};
    }
    const {back, backHold, hold} = holdOf(s.cand, s.candSince);
    if (s.cand != null && (s.puller == null || now - s.candSince >= hold)) {
        s.puller = s.cand;
        s.since = back ? s.prev.since : s.candSince;
        s.prev = null;
        s.resumed = null;
        s.changedAt = now;
        s.adopt = back ? 'back' : 'front';
        s.fired = firedCand?.id === s.puller ? firedCand.kind : null;
        clearCand(s);
    }
    s.held = s.cand != null && backHold ? 'back' : null;
    return s;
}


// True when the front rider would skip the planned next rider: one or two places further on in
// plan order (12 Nov 2026: while Cora handed over to Selma, Aldo was in front for a moment and
// counted as the puller for 18 s, so the countdown fell by 92 s and rose again).
// Places count on the line (`lineIds`: the plan riders in it plus the puller, the next and the front
// rider; null: the whole plan), and rotationStep passes the line (audit fixes, 20 Nov 2026, M1;
// probe p22 P23: in a plan of six with #3 and #4 not in the race, #5 in front for 6 s in the change
// from #1 to #2 was one past the next on the line but four places on in the plan, so no skip hold:
// he was the puller 103-120 s; now #1 until 108, #2 from 109).
export function skipsAhead(plan, {pullerId, nextId, frontId, lineIds = null}) {
    const on = lineIds ? new Set([...lineIds, pullerId, nextId, frontId]) : null;
    const ids = (plan?.riders || []).map(r => r.id).filter(id => !on || on.has(id));
    const n = ids.length;
    const p = ids.indexOf(pullerId), x = ids.indexOf(nextId), f = ids.indexOf(frontId);
    if (p < 0 || x < 0 || f < 0 || f === x) {
        return false;
    }
    const d = i => (i - p + n) % n;
    return d(f) > d(x) && d(f) <= d(x) + 2;
}


// The present rider directly before `pullerId` in plan order (the one who pulled before him), or
// null. rotationStep passes the line (lineIds: riders sitting out are not in it).
// Null in a line of two (fewer than 3 plan riders in `presentIds` plus the puller), as classifyChange
// has no 'back' there (audit fixes, 20 Nov 2026, I3; probe p01 A and C: in a plan of 2, and in a plan
// of 5 with only me and #2 present, #2 coming past me at 40 s was held by the back hold until 70 s,
// so my pull view stayed 27 s too long while I rested; now he pulls from 43 s, since 40 s).
export function riderBefore(plan, {pullerId, presentIds}) {
    const ids = (plan?.riders || []).map(r => r.id);
    const n = ids.length;
    const p = ids.indexOf(pullerId);
    if (p < 0) {
        return null;
    }
    const present = new Set(presentIds || []);
    if (ids.filter(id => id === pullerId || present.has(id)).length < 3) {
        return null;
    }
    for (let k = 1; k < n; k++) {
        const id = ids[(p - k + n) % n];
        if (present.has(id)) {
            return id;
        }
    }
    return null;
}


// `id` is the candidate during the hand-off of his own pull: the puller is the one his end named
// (the last event is that end, at the puller's since). trackFront passes the ignored rider (me after
// my end), backHeldStep me.
function handOffCand(front, id) {
    return front.cand != null && front.cand === id && handOffEnd(front);
}


// The last event is the end that named the puller (at his since).
function handOffEnd(front) {
    return front.last?.kind === 'end' && front.last.at === front.since;
}


// I take the pull from the current puller (start or draftStart {id, at}).
function takeOver(s, {id, at}, now) {
    s.changedAt = now;
    s.adopt = 'self';
    s.prev = s.puller == null ? null : {puller: s.puller, since: s.since, at: now};
    s.ignore = s.puller == null ? null : {id: s.puller, at: now};
    s.puller = id;
    s.since = at;
    s.resumed = null;
    clearCand(s);
}


// The candidate: the front rider when he is not the puller, with when he got there. No data
// drops the candidate, so it is not backdated across the gap.
// Under a hold longer than HOLD_MS (`longHold(id, since)`: the back or chaos hold), a
// candidate who stops being one (another front rider, the puller in front, nobody) is kept as
// `lost` {id, since, at, n}: not for more than CAND_GAP_N steps without him (n counts them), nor
// HOLD_MS or more after the first of them (`at`). Front rider again meanwhile, and still under a
// long hold, he is the candidate with his old `candSince` (audit fixes, 20 Nov 2026, I5; probe p06
// B: #1 frontmost 60-71 s with one sample of the puller at 66 s restarted his hold and was two
// rule-2 flags, 91 s of chaos from one episode; probe p51: the puller's nose in front for one
// sample every 10 s never let the back hold run out, #1 was named at 83 s after two flags, 161 s of
// chaos, now at 90 s, none). Only one rider is kept.
// Under the plain HOLD_MS a candidate who drops out starts over (21 Nov 2026, review of I5: with
// the restore for everyone, two single samples 3 s apart adopted a new puller; the plan's next on
// the puller's wheel with position noise, 1 m gap and 0.8 m noise, was adopted early in 51 of 100
// runs instead of 3).
// Nor under the skip hold (final review, 21 Nov 2026, M-1): longHold is asked with this step's
// slowId, and rotationStep sets that only for the rider in front in this step (skipsAhead), never
// for the candidate just lost. Probe c1 (plan of 6, #1 pulls, #3 in front from 100 s with #1's nose
// in front every 6th sample): #3's hold restarted (candSince 107 s), no adoption in 120 s, as before
// I5. Keeping it would need the skip status stored with the candidate (not done).
export const CAND_GAP_N = 2;
function followCand(s, frontId, now, longHold = () => false) {
    const id = frontId == null || frontId === s.puller ? null : frontId;
    if (id !== null && id === s.cand) {
        s.lost = ageLost(s.lost, now);
        return;
    }
    const back = id !== null && s.lost?.id === id && now - s.lost.at < HOLD_MS && longHold(id, s.lost.since);
    const lost = s.cand != null && longHold(s.cand, s.candSince) ?
        {id: s.cand, since: s.candSince, at: now, n: 1} :
        back ? null : ageLost(s.lost, now);
    s.candSince = id === null ? null : back ? s.lost.since : now;
    s.cand = id;
    s.lost = lost;
}


// One more step without the lost candidate (followCand): null once he is gone too long.
function ageLost(lost, now) {
    if (!lost) {
        return null;
    }
    const n = lost.n + 1;
    return n > CAND_GAP_N || now - lost.at >= HOLD_MS ? null : {...lost, n};
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
    const s = {...front, adopt: null, held: null, fired: null};
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
        s.adopt = 'resume';     // not classified against the plan order (spec 20 Nov 2026, section 3)
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


// The line (20 Nov 2026, spec 2026-11-20-paceline-chaos-counter section 2): the present riders
// minus those sitting out (skipped at the front, order.mjs). Everything that counts who comes next
// uses it: the countdown (rotationView), the skip hold (its expected next), riderBefore, planWheel,
// the next rider for my end. A rider who sits out is in the group but no longer pulls (12 Nov: #4 of
// one team, #6 of another; 19 Nov: #3/#4/#6 of one team after the climb), and the countdown kept
// counting his pull every round. orderStep never takes me out.
export function lineIds(presentIds, order) {
    const out = new Set(orderOutIds(order));
    return (presentIds || []).filter(id => !out.has(id));
}


// Why there is no rotation view, or null. Order: no plan, not a plan rider, no live data of mine,
// standing still, just rolled off (START_QUIET_MS), final sprint, climb or descent, alone (no
// fresh teammate in my chain), and last chaos (the team does not ride the plan's order, order.mjs;
// user, 20 Nov 2026: "if nothing fits any more, go silent until a stable line is visible again").
// Chaos is the one reason that comes with a view (rotationStatus): the windows still show who
// really pulls and my own pull.
export function dashReason({plan, selfId, live, finish, climbing, descent = false, chain, still = false,
                            starting = false, chaos = false}) {
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
    return chaos ? 'chaos' : null;
}


// The action window's dash for a reason: 'climb' (dim ▲), 'descent' (dim ▼), 'chaos' (dim ≠, 20 Nov
// 2026), 'unknown' (amber ?) or 'none'.
// started: a puller has been seen in this ride. Before that (the start pen) nothing is wrong, so
// no amber "?", just the quiet dash.
export function dashKind(reason, {started = true} = {}) {
    if (reason === 'climb' || reason === 'descent' || reason === 'chaos') {
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


// A plan target I can judge my power by: a number above 0 W (plan.mjs keeps pull_power as given).
function hasTarget(target) {
    return Number.isFinite(target) && target > 0;
}


// The median power of my last END_N samples, or null with fewer.
function lastMedian(hist) {
    if (!hist || hist.length < END_N) {
        return null;
    }
    const ws = hist.slice(-END_N).map(x => x.w).sort((a, b) => a - b);
    return ws[(END_N - 1) >> 1];
}


// End: the median of my last END_N samples is below `below` (END_W; ownPull passes my end
// threshold). Returns the t of the first of those samples below it, else null.
export function powerDrop(hist, below = END_W) {
    const med = Number.isFinite(below) ? lastMedian(hist) : null;
    if (med === null || !(med < below)) {
        return null;
    }
    return hist.slice(-END_N).find(x => x.w < below).t;
}


// My power is back (the undo of my end, trackFront's selfOn): the median of my last END_N samples
// reaches JUMP_TARGET_FRAC of my target. Without a target (or one of 0 W or less), never (audit
// fixes, 20 Nov 2026, C1: without a target nothing tells pull power from rest power).
export function powerBack(hist, target) {
    const med = hasTarget(target) ? lastMedian(hist) : null;
    return med !== null && med >= JUMP_TARGET_FRAC * target;
}


// My power at pull power (audit fixes, final review 21 Nov 2026, I-3): the median of my last END_N
// samples reaches JUMP_TARGET_FRAC of my target, or END_W without a target (or one of 0 W or less).
// rotationStep keeps whether it did since I became the puller (st.pulled); only then can my end
// fire. Why: 5 riders, 300 W target, I pulled 30 s and rode on in front at 100 W with nobody
// passing (probe a1): my end at 31 s, the chaos hold adopted me again at 55 s (past END_MIN_S at
// once, its since backdated), my rest power ended it at 60 s, and so on every 28 s without end
// (24 s rest countdown, 5 s my pull), never chaos. Now I stay the puller from 55 s; my end comes
// again once I pull at power.
export function pullPower(hist, target) {
    const med = lastMedian(hist);
    return med !== null && med >= (hasTarget(target) ? JUMP_TARGET_FRAC * target : END_W);
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


// eff: the learner's state for the countdown (expectedPullS), null for the fixed rule. toMyPullS is
// not rounded (decision 3 of the beta.5 plan, 21 Nov 2026: the windows floor the smoothed clock; in
// the replay of five recorded races Math.round took abs against T0 from 7.85 to 8.0 s).
export function rotationView(plan, {selfId, chainIds, wheelId, front, now, eff = null}) {
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
        between += expectedPullS(r.pullS, r === beforeMe, r.pullS, eff);
    }
    // The puller's expected end (expectedPullS): his plan + E, plan + E - H when he is the rider
    // before me; with the fixed rule (eff null) his plan plus the overhead, his plan alone when he
    // is before me.
    const endS = expectedPullS(pullS, puller === beforeMe, puller.pullS, eff);
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
        startAt: null,             // when the start lock began; null again after START_PEN_MS standing
                                   // (not after the finish line: `over`)
        locked: false,             // in the start lock (START_LOCK_MS)
        startFront: null,          // since when the start puller is in front, in the lock
        startFound: false,         // he has been in front for HOLD_MS: the start chaos is over
        pause: null,               // the puller before the last climb or alone phase (pauseClock)
        order: initialOrder(),     // does the team ride the plan's order (order.mjs): chaos, riders out
        backHeld: null,            // the back candidate being held (backHeldStep)
        backFlags: {},             // ... and when each rider's last rule-2 flag was (backHeldStep)
        joiner: null,              // a rider being caught from ahead (joinerStep)
        pullerAt: null,            // when the last turn began (rule 1's quick; not at my hand-off)
        unseen: null,              // 'alone' | 'start' | 'end': the puller not seen in front since
        unseenFront: null,         // ... and since when he is the front rider of my chain (unseenStep)
        pulled: false,             // I am the puller and my power reached pull power since (pullPower)
        over: false,               // I stand after the finish line (M-4): standing keeps startAt
        hand: null,                // the hand-over detector (handover.mjs), in memory only
        eff: initialEff(),         // the team-efficiency learner (efficiency.mjs), in memory only
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


// The start puller: the first plan rider (plan order) in `presentIds` (the riders seen in my chain
// in the pen), or null when no plan rider but me is in it (nobody known: no start lock). Audit fixes,
// 20 Nov 2026 (I9; probe p08: plan #1 was not in the race, the lock named him anyway and he was the
// puller for everyone's first 75 s while #2 pulled; now #2 from the roll-off).
export function startPuller(plan, {presentIds, selfId}) {
    const ids = new Set(presentIds || []);
    const riders = (plan?.riders || []).filter(r => ids.has(r.id));
    return riders.some(r => r.id !== selfId) ? riders[0].id : null;
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
// Either way the order state starts fresh (user, 20 Nov 2026, spec section 7): a new plan is the
// captain's deliberate act and gets its chance; if it is wrong too, 2 bad changes bring the silence
// back. The held back candidate and the joiner (spec section 8) go with it.
// The learned E and H stay either way, the open turn is dropped (effCut; design 2026-11-21-paceline-
// beta5 §2: no reset after a plan change; decision 5, 21 Nov 2026).
export function carryRotation(st, plan) {
    const ids = new Set((plan?.riders || []).map(r => r.id));
    if (!plan || (st.front.puller != null && !ids.has(st.front.puller))) {
        return {...initialRotation(), climb: st.climb, hill: st.hill ?? initialHill(), rolledAt: st.rolledAt ?? null,
                startAt: st.startAt ?? null, eff: effCut(st.eff)};
    }
    const front = {...st.front};
    if (front.cand != null && !ids.has(front.cand)) {
        clearCand(front);
    }
    if (front.lost && !ids.has(front.lost.id)) {
        front.lost = null;
    }
    if (front.pending && !ids.has(front.pending.id)) {
        front.pending = null;
    }
    if (front.prev && !ids.has(front.prev.puller)) {
        front.prev = null;
    }
    const seen = Object.fromEntries(Object.entries(st.seen || {}).filter(([id]) => ids.has(id)));
    const pause = st.pause && ids.has(st.pause.puller) ? st.pause : null;
    return {...st, front, seen, pause, present: (st.present || []).filter(id => ids.has(id)),
            order: initialOrder(), backHeld: null, backFlags: {}, joiner: null, hand: null, eff: effCut(st.eff)};
}


// The rotation view, or null and why (dashReason; 'nofront' when nobody is tracked yet). `live`:
// a current sample of my own rider; without one, counting down from the last known puller would
// be misleading. `quietStart`: the windows' view, quiet for START_QUIET_MS after rolling off
// ('start'); the engine's own calls leave it out, so tracking goes on meanwhile.
// In chaos (st.order) the reason is 'chaos' and the view is built all the same (20 Nov 2026): the
// windows show the real puller and my own pull, but no countdown or READY from it.
export function rotationStatus(st, {now, plan, selfId, live, quietStart = false}) {
    const reason = dashReason({plan, selfId, live, finish: st.finish, climbing: st.hill?.mode === 'pause',
                               descent: !!st.hill?.descent, chain: st.chain, still: !!st.still?.still,
                               starting: quietStart && startQuiet(st, now) && st.front?.puller !== selfId,
                               chaos: !!st.order?.chaos});
    if (reason && reason !== 'chaos') {
        return {view: null, reason};
    }
    const line = lineIds(st.present, st.order);
    const wheel = planWheel(plan, {selfId, pullerId: st.front.puller, presentIds: line});
    // The countdown counts the state's learned E and H (21 Nov 2026, design 2026-11-21-paceline-beta5
    // §2); a state without them (older states, a test) the fixed rule.
    const view = rotationView(plan, {selfId, chainIds: line, wheelId: wheel, front: st.front, now,
                                     eff: st.eff ?? null});
    return view ? {view, reason} : {view: null, reason: 'nofront'};
}


// What the recorder keeps of the learned countdown (21 Nov 2026, design 2026-11-21-paceline-beta5 §3;
// for a check after the next TTT): `te`, the team's learned turn time E (plans up to LONG_PULL_S /
// longer), the hand-over time H and how many values each rests on; `cdOld`, the countdown the fixed
// rule would have shown (no E, no H) next to the one shown, so a ride report can compare both
// against the real change. Neither names a rider. `view` is the view shown (rotationStatus).
export function teamDet(st, {now, plan, selfId, view}) {
    const eff = st.eff ?? initialEff();
    const tenth = x => Math.round(x * 10) / 10;
    const te = {eS: tenth(teamE(eff, CHANGE_ALLOWANCE_S)), eL: tenth(teamE(eff, CHANGE_ALLOWANCE_LONG_S)),
                h: tenth(teamH(eff)), n: eff.e.length, hn: eff.h.length};
    let cdOld = null;
    if (view && !view.mine && Number.isFinite(view.toMyPullS)) {
        const old = rotationView(plan, {selfId, chainIds: lineIds(st.present, st.order), wheelId: null,
                                        front: st.front, now});
        cdOld = old && Number.isFinite(old.toMyPullS) ? {t: old.toMyPullS, standing: !!old.standing} : null;
    }
    return {te, cdOld};
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
        const next = rotationView(plan, {selfId, chainIds: lineIds(chainIds, st.order), wheelId: null,
                                         front: st.front, now}).next;
        if (view.elapsedS < END_MIN_S || !next) {
            return out;
        }
        // The shadow rule (END_FRAC x target) equals the live one where that is under END_W.
        out.shadowEnd06 = target === null ? null : powerDrop(hist, END_FRAC * target);
        // Not before a pull of mine at power since I became the puller (I-3, see pullPower).
        const at = (grade !== null && grade <= DESCENT_GRADE) || st.pulled === false ? null :
            powerDrop(hist, endThreshold(target));
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


// My end threshold (C1, see END_FRAC): END_FRAC of my target where that is under END_W; END_W
// without a target or with one of 0 W or less (a 0 W target turned my end off).
function endThreshold(target) {
    return hasTarget(target) ? Math.min(END_W, END_FRAC * target) : END_W;
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
    st.order = Array.isArray(prev.order?.hist) ? prev.order : initialOrder();    // older states have none
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
    st.joiner = st.still.still ? null : joinerStep(prev, {now, frontId: st.frontId, plan, selfId});
    const trackId = st.joiner ? null : st.frontId;    // the front rider for front tracking
    // The start (START_LOCK_MS): a roll-off after the pen with a plan sets the first plan rider
    // present as the puller (startPuller); with nobody known it is a plain roll-off.
    const rollOff = st.rolledAt === now && prev.rolledAt !== now && prev.still?.since != null &&
        now - prev.still.since >= START_PEN_MS && !!plan?.riders?.length;
    const p1 = rollOff ? startPuller(plan, {presentIds: st.present, selfId}) : null;
    const starting = p1 !== null;
    // Standing START_PEN_MS (a pen) ends the last start (audit fixes, 20 Nov 2026, M8; probe p41:
    // startAt stayed set from the first race, so in the pen of a second race in the same session
    // penModel did not arm plan #1; now it is null from 30 s of standing).
    // Not while I stand after the finish line (`over`; final review, 21 Nov 2026, M-4; probe m8: plan
    // #1 standing from 140 s after the line at 120 s got READY from 170 s on, while the gate was
    // still open): the stand that began in finish mode keeps the start until I ride on or Sauce
    // shows another event (an event distance or time not at its finish: the next race's pen).
    const entry = selfEntry(nearby);
    const another = live && !!entry && entry.remainingType === 'event' && Number.isFinite(entry.remaining) &&
        !finishMode(entry);
    st.over = st.still.still && !another && (!!prev.finish || !!prev.over);
    const stood = st.still.still && st.still.since != null && now - st.still.since >= START_PEN_MS && !st.over;
    st.startAt = starting ? now : rollOff || stood ? null : prev.startAt ?? null;
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
        st.order = initialOrder();    // chaos and riders sitting out start over (20 Nov 2026)
        st.backHeld = null;
        st.backFlags = {};
        st.unseen = null;
        st.unseenFront = null;
        st.pulled = false;
        st.hand = null;
        // E and H stay, the open turn goes (design 2026-11-21-paceline-beta5 §2: no reset; decision 5,
        // 21 Nov 2026).
        st.eff = effCut(prev.eff);
        return {state: st, self: null, shadowEarly, shadowEnd06};
    }
    // Outside the tracking branch below (start, lock, pause, resume, roller) the hand-over detector is
    // off: its arm and runs are dropped, the puller's history is kept (design 2026-11-21-paceline-
    // beta5 §1).
    st.hand = prev.hand ? {...prev.hand, arm: null, out: {}} : null;
    // The lock's end counts as a change at the front (chaos hold for anyone else).
    const pf = unlocked ? {...prev.front, changedAt: now} : prev.front;
    // The line before this step's change, and chaos: the order state (order.mjs) is updated below.
    const line = lineIds(st.present, st.order);
    const chaos = st.order.chaos;
    if (starting) {
        st.front = {...initialFront(), puller: p1, since: now, changedAt: now,
                    bonus: {id: p1, since: now, s: START_BONUS_S}, adopt: 'start'};
    } else if (locked) {
        st.front = {...prev.front, adopt: null, fired: null};
    } else if (paused) {
        st.front = trackFront(pf, {now, frontId: null});
    } else if (pausedBefore) {
        st.front = resumeFront(pf, {now, frontId: st.frontId, chain: st.chain});
    } else if (st.hill.mode === 'flag') {
        // A roller: the puller or the plan's next may take the front; anyone else in front is
        // ignored. No own pull from my power or draft (both swing on a roller). In chaos the rule is
        // off (spec 20 Nov 2026, section 7): it assumes the plan's order, like the back and skip
        // holds, so the real front rider is followed and the change is classified like any other.
        const expected = rotationView(plan, {selfId, chainIds: line, wheelId: null, front: pf, now});
        const ok = chaos || pf.puller == null || trackId === pf.puller ||
            (trackId != null && trackId === expected?.next?.id);
        st.front = trackFront(pf, {now, frontId: ok ? trackId : null, chaos});
    } else {
        let own = {};
        if (live && !st.finish) {
            ({own, shadowEarly, shadowEnd06} = ownPull(st, {now, plan, selfId, hist, grade}));
        }
        const confirm = live && !st.finish &&
            startConfirmed({drafts, chain: st.chain, selfId, frontId: st.frontId});
        const expected = rotationView(plan, {selfId, chainIds: line, wheelId: null, front: pf, now});
        const slowId = skipsAhead(plan, {pullerId: pf.puller, nextId: expected?.next?.id,
                                         frontId: trackId, lineIds: line}) ? trackId : null;
        const backId = riderBefore(plan, {pullerId: pf.puller, presentIds: line});
        // For the undo of my end (C1): my draft says I lead and my power is back. Both, as I fade in
        // front with my draft 0 until the next rider comes past; the power tells a real end (rest
        // power) from a dropped sample (the existing test with 2 riders and a late pass, `late(52)`,
        // got my pull back at 53 s with the draft alone).
        const selfOn = live && !st.finish && draftFront({drafts, chain: st.chain, selfId}) &&
            powerBack(hist, plan?.riders?.find(r => r.id === selfId)?.watts);
        // The hand-over detector (handover.mjs; user, 21 Nov 2026; design 2026-11-21-paceline-beta5
        // §1). Off while I am the puller, while the puller is unseen, in finish mode and in chaos (the
        // start lock, pauses, rollers and standing still never reach this branch).
        const off = !live || st.finish || chaos || pf.puller == null || pf.puller === selfId ||
            (prev.unseen ?? null) !== null;
        const byId = new Map((nearby || []).map(e => [String(e.athleteId), e]));
        const ho = handoverStep(prev.hand ?? null, {now, puller: pf.puller, since: pf.since, frontId: st.frontId,
                                                    chain: st.chain, byId, lineIds: line, selfId, off});
        st.hand = ho.hand;
        // Never me; never a joiner (front tracking ignores him, joinerStep). And only for the front
        // rider of my chain, or while the puller is still the front rider (final review of beta.5,
        // I-1, 21 Nov 2026). Why: the detector fires for the frontmost rider out of the draft, so
        // when the real front rider has a draft (the team behind another team), a stale row, or is
        // me, a rider behind him fired instead, and each fire threw the front rider back to the start
        // of his hold. Synthetic probes (5 riders, 30 s plan): with the plan's next in front from
        // 36 s and a rider behind him without draft, the puller who eased off at 30 s stayed the
        // puller until 106 s (39 s without the detector); within 30 s of a change a rider who was
        // never in front was the puller for 16-31 s, with one bad flag and riders wrongly out; as the
        // plan's next in front I saw a rest countdown until 106 s instead of my pull from 38 s; in
        // 40 noisy rides 2 had chaos and 4 a rider wrongly out (none without the detector). With the
        // guard every probe equals the position rule or better (noisy rides: puller right 88.6 %
        // against 82.1 %, no chaos, nobody out), and clean lines are unchanged. A rider level with
        // the fading puller while the puller is still frontmost (the back case) still fires.
        let fired = ho.fired && ho.fired.id !== selfId && ho.fired.id !== st.joiner?.id &&
            (ho.fired.id === st.frontId || st.frontId === pf.puller) ? ho.fired : null;
        if (fired) {
            fired = {...fired, slow: skipsAhead(plan, {pullerId: pf.puller, nextId: expected?.next?.id,
                                                       frontId: fired.id, lineIds: line})};
            // Diagnostics (fires, lastFire): read by the replay scripts, never by the engine.
            st.hand = {...st.hand, fires: (st.hand.fires ?? 0) + 1, lastFire: {...fired, at: now, puller: pf.puller}};
        }
        st.front = trackFront(pf, {now, frontId: trackId, ...own, confirm, slowId, backId, chaos, selfOn, fired});
    }
    // My re-adoption by tracking while the rider my end named is still unseen (unseen 'end') is no
    // change at the front (fix wave ruling, 21 Nov 2026; as I8 and M1: it is not classified either):
    // it keeps the changedAt of my end, so it opens no chaos window. Why: after I-3 (see pullPower) a
    // late pass after my end waited CHAOS_HOLD_MS from my re-adoption; review probe e1 (late 26-38 s,
    // 3 rounds) 91 -> 169 s of a wrong puller, fuzz g1 runs with chaos 91 -> 98 and riders out at the
    // end 0 -> 6. Now the named rider gets the plain HOLD_MS once my end's chaos window is over.
    if (st.front.adopt === 'front' && st.front.puller === selfId && prev.front.puller !== selfId &&
        (prev.unseen ?? null) === 'end') {
        st.front = {...st.front, changedAt: pf.changedAt ?? null};
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
    // Does the team ride the plan's order (user, 20 Nov 2026; spec 2026-11-20-paceline-chaos-counter
    // sections 1-3 and 7)? Only changes seen at the front are classified: the front rider adopted by
    // tracking ('front') and my start ('self'), from a known puller. Not the start (and its lock),
    // the adoption after a pause ('resume': the order is scrambled then), the hand-off at my end
    // ('end': given to the plan's next without seeing him) or the undo of my false start ('back').
    // Nor the first adoption while the old puller is `unseen` (unseenStep): after riding alone and
    // after a start whose puller never led, the change from him was not seen at the front.
    // Any new puller is back in the line: he pulls, so he no longer sits out.
    // Every new puller is a turn of the round (audit fixes, 20 Nov 2026, I1; probe p16: my hand-off
    // was no turn, a rider who missed one turn came back "within the round", 120 s of false chaos):
    // classified ones through orderStep, the others through orderCount. Not the undo of my false
    // start or my end ('back'): it gives the old puller his pull back, no new turn.
    // The rider my hand-off names (unseen 'end', audit fixes, 20 Nov 2026, I8; probe p09 P11: a rider
    // after me who sits out was named by my end every round and was the puller for 16 s each time,
    // my countdown snapped 134 → 92): when another rider is adopted at the front before he has been
    // in front, the change is classified from me, so the named rider is skipped and sits out. An
    // adoption of me meanwhile is not classified.
    // My end counted a turn for the rider it named (orderCount). While he is unseen ('end') that turn
    // has not happened, so the change counts from the turn before it (audit fixes, 21 Nov 2026, review
    // of I1/I8): another rider adopted first takes that turn (classified from me), and the undo of my
    // end or an adoption of me (I pulled on) is no new puller. Why: with the hand-off's turn kept,
    // Ann → Cleo skipping Ben, Cleo, Dan, me, my end naming Ann and Ben through instead read Ben's
    // return as a full round later (no flag) instead of within the round (two flags, chaos 177-282 s).
    // `quick` (spec section 8 rule 1): the previous change at the front is less than
    // CHAOS_WINDOW_MS old, so a return of the rider it skipped undoes that skip (orderStep). It
    // counts from the last new puller (`pullerAt`), not from `changedAt` (20 Nov 2026, final
    // review): the end of a climb and the end of the start lock set that without a change, and a
    // skip, a climb and the skipped rider back 65 s after the skip counted as quick (one flag
    // instead of two).
    // `pullerAt` moves only with a turn that has happened: not at my hand-off (its turn is the named
    // rider's only once he pulls), nor at a change that is no turn (audit fixes, 21 Nov 2026, review
    // of I1/I8). Why: with the hand-off's turn taken back, the change just before is my start; my
    // start skipping Dan, my pull and Dan adopted 16 s after my end counted as quick from my end (one
    // flag), though a whole pull of mine lies between the skip and the return (two flags).
    const to = st.front.puller;
    const changed = to != null && to !== prev.front.puller;
    const unseen = prev.unseen ?? null;
    const noTurn = changed && (st.front.adopt === 'back' || (unseen === 'end' && to === selfId));
    if (changed) {
        const order = unseen === 'end' ?
            {...st.order, turns: (st.order.turns ?? st.order.n) - 1} : st.order;
        const fromEnd = unseen === 'end' && to !== selfId;
        const seen = (st.front.adopt === 'front' || st.front.adopt === 'self') && prev.front.puller != null &&
            (!unseen || fromEnd);
        st.order = seen ?
            orderStep(order, plan, {fromId: fromEnd ? selfId : prev.front.puller, toId: to,
                                    presentIds: st.present, selfId,
                                    quick: now - (prev.pullerAt ?? -Infinity) < CHAOS_WINDOW_MS}) :
            noTurn ? backIn(order, to) : orderCount(backIn(order, to));
    }
    // A resume that is not the line's next counts once (20 Nov 2026, spec section 8 rule 3): the
    // adoption after a pause stays unclassified (no sit-outs: the order is scrambled after a climb),
    // but a new puller other than the line's next after the old one is one bad flag. Why: in a team's
    // race on 19 Nov both climb resumes near the end were skips, the back-and-forth after them never
    // reached the counter, and the windows kept counting until 14 s before the finish sprint; with
    // this rule they are silent from the end of the second climb (+29:23). It rests on that race alone
    // (no other resume adoptions in six rides): check after the next TTT.
    // The same for the first adoption after riding alone (unseen 'alone', 20 Nov 2026, final review):
    // that is the end of an alone pause too, but it comes from normal tracking ('front'), as the
    // alone phase's end does not reach resumeFront.
    const resumed = st.front.adopt === 'resume' || (changed && unseen === 'alone');
    if (resumed && prev.front.puller != null &&
        classifyChange(plan, {fromId: prev.front.puller, toId: to, presentIds: st.present, out: st.order.out}).kind !== 'next') {
        st.order = orderBad(st.order);
    }
    ({unseen: st.unseen, front: st.unseenFront} = unseenStep({unseen, front: prev.unseenFront ?? null}, {
        now, alone: st.alone, start: st.front.adopt === 'start', end: st.front.adopt === 'end',
        changed: to !== prev.front.puller, inFront: st.frontId != null && st.frontId === to}));
    st.pullerAt = changed && st.front.adopt !== 'end' && !noTurn ? now : prev.pullerAt ?? null;
    const held = backHeldStep(prev.backHeld ?? null, st.front, {now, locked, selfId, flags: prev.backFlags});
    st.backHeld = held.held;
    st.backFlags = held.flags;
    if (held.bad) {
        st.order = orderBad(st.order);
    }
    // Since I became the puller, has my power been at pull power (I-3, see pullPower)? A new
    // adoption of me starts over; an older state without it counts as yes.
    st.pulled = selfId != null && st.front.puller === selfId &&
        ((prev.front.puller === selfId && prev.pulled !== false) ||
         pullPower(hist, plan?.riders?.find(r => r.id === selfId)?.watts));
    // The team-efficiency learner (efficiency.mjs; user, 21 Nov 2026; design 2026-11-21-paceline-beta5
    // §2; analysis of five recorded races: abs against T0 10 -> 7.3 s): the puller's fresh power (me
    // included; a stale row is no power, freshState) dates his ease-off. Not fed from a step that
    // is not live, in the start lock, in finish mode, in chaos, on a climb or alone. It only feeds
    // the countdown (rotationStatus), never the tracking above.
    // The only front reset (initialFront(), standing still) returns above with effCut, and a start
    // sets its puller at once, so no effCut is needed here (only standing still and carryRotation
    // cut). Until a puller is known again (a new window, or after a stop until the first front
    // rider), effStep gets puller null and keeps no open turn.
    const pid = st.front.puller;
    const pb = st.front.bonus;
    st.eff = effStep(prev.eff ?? initialEff(), {
        now, puller: pid, since: st.front.since,
        planS: plan?.riders?.find(r => r.id === pid)?.pullS ?? null,
        bonus: !!(pb && pb.id === pid && pb.since === st.front.since),
        power: freshState((nearby || []).find(e => String(e.athleteId) === String(pid)), 'power'),
        bad: !live || locked || st.finish || !!st.order.chaos || st.hill.mode === 'pause' || st.alone,
        nextId: rotationView(plan, {selfId, chainIds: lineIds(st.present, st.order), wheelId: null,
                                    front: st.front, now})?.next?.id ?? null,
        rolledAt: st.rolledAt, selfId,
    });
    const self = selfEvent(prev.front, st.front);
    return {state: st, self, shadowEarly, shadowEnd06};
}


// The order state with `id` no longer sitting out.
function backIn(order, id) {
    if (!Object.hasOwn(order.out, id)) {
        return order;
    }
    const out = {...order.out};
    delete out[id];
    return {...order, out};
}


// The puller not seen in front since (20 Nov 2026, final review; spec sections 1, 3 and 7: the
// adoption at the end of an alone pause and the start lock are not classified): 'alone' while I ride
// alone and after it, 'start' from the start (plan #1 set at the roll-off), until the puller is the
// front rider of my chain (for HOLD_MS, see below) or another puller is adopted. While it is set, the
// next adoption is not classified (rotationStep), and after 'alone' it gets rule 3's one flag when it
// is not the line's next; after 'start' it gets none. Why: the alone phase's end never reaches
// resumeFront (`paused` reads the alone flag of the step before), so the first adoption after it was
// classified, and a team that rode the plan while I was dropped for 70 s gave a skip there, a rider
// wrongly out for 97 s and 120 s of false chaos (scenario of the final review, 5 riders, 40 s pulls).
// At the start: plan #1 never in front and #4 first gave a skip #1 → #4 and 160 s of false chaos for a
// team riding the plan from #4 on; in two of six recorded races the start puller was never found.
// Replay of the six rides: unchanged.
// 'end' (audit fixes, 20 Nov 2026, I8): the rider my hand-off names, set at my end, until he is in
// front; the next adoption before that is classified from me (rotationStep).
// It clears only after the puller has been the front rider for HOLD_MS (not while I ride alone), like
// startFound (audit fixes, 20 Nov 2026, I6; probe p05 B: plan #1 frontmost for one sample 10 s after
// the roll-off cleared 'start', Ann → Dan was classified as a skip, 160 s of false chaos). `front`:
// since when he is in front, null while he is not.
function unseenStep({unseen, front}, {now, alone, start, end, changed, inFront}) {
    let u = changed ? null : unseen;
    const f = changed ? null : front;
    if (alone) {
        u = 'alone';
    }
    if (start) {
        u = 'start';
    }
    if (end) {
        u = 'end';
    }
    if (!u || alone || !inFront) {
        return {unseen: u, front: null};
    }
    const since = f ?? now;
    return now - since >= HOLD_MS ? {unseen: null, front: null} : {unseen: u, front: since};
}


// A held back candidate counts once (20 Nov 2026, spec section 8 rule 2). `held` {id, since, ripe}:
// the candidate the back hold holds (front.held 'back', not in the start lock), since when, and
// whether he has been there HOLD_MS. When he stops being that candidate (another front rider, the
// puller in front again, a pause) without being adopted ('front', or 'back' for the undo of my
// start), and was ripe, it is one bad flag (`bad`): no change, so nobody is taken out. Adopted, the
// change itself is classified (a back). Why: in a team's race on 19 Nov the back hold swallowed the
// back-and-forth at the end (#1 13 s and #2 23 s in front, never adopted), and the counter went
// silent only 14 s before the finish sprint. Counting him at HOLD_MS already, before he leaves,
// gave a false 782 s chaos phase in the ZRL race on 17 Nov.
// Not me during the hand-off of my own pull (20 Nov 2026, final review; spec section 7: my hand-off
// is not classified): after my end the puller is the plan's next from my end's time, I fade in front
// as the rider before him, and when he comes past late (19 s after my end in the review's scenario)
// that was one bad flag.
// Still held while he is the lost candidate (front.lost, same since: back within CAND_GAP_N
// samples, see followCand), and at most one flag per rider per BACK_HOLD_MS (`flags` {id: ms of his
// last flag}; audit fixes, 20 Nov 2026, I5; probe p06 B: one episode with one stray sample was two
// flags, 91 s of chaos; Ann in front 80-85 s and 90-95 s, two holds 10 s apart, was two flags and
// 74 s of chaos, now one flag and none; two holds 40 s apart are still two flags).
function backHeldStep(held, front, {now, locked, selfId, flags}) {
    let bad = false;
    const f = Object.fromEntries(Object.entries(flags || {}).filter(([, at]) => now - at < BACK_HOLD_MS));
    const here = h => (front.cand === h.id && front.candSince === h.since) ||
        (front.lost?.id === h.id && front.lost.since === h.since);
    if (held && !here(held)) {
        const adopted = (front.adopt === 'front' || front.adopt === 'back') && front.puller === held.id;
        if (held.ripe && !adopted && !Object.hasOwn(f, held.id)) {
            bad = true;
            f[held.id] = now;
        }
        held = null;
    }
    if (front.cand != null && front.held === 'back' && !locked && !handOffCand(front, selfId)) {
        held = held || {id: front.cand, since: front.candSince, ripe: false};
        if (!held.ripe && now - front.candSince >= HOLD_MS) {
            held = {...held, ripe: true};
        }
    }
    return {held, bad, flags: f};
}


// Caught from ahead (20 Nov 2026, spec section 8 rule 5): a plan rider (not me, not the puller)
// who was not present in the step before (out of my chain for PRESENT_GRACE_MS or longer) and is
// frontmost the moment he joins my chain is being caught, not taking the front. Front tracking
// ignores him while he stays frontmost, at most BACK_HOLD_MS: no candidate, no hold, no
// classification. Only after a group (present riders other than me: I am always in my own chain,
// so after more than PRESENT_GRACE_MS alone the front rider of the group I rejoin was a joiner, and
// the puller stayed wrong for 30 s more; final review, 20 Nov 2026) before; rotationStep skips it
// while standing still. Returns {id, at} or null. Why: in a team's race on 19 Nov #4 had started
// in the wrong group and was caught at +4:45, frontmost 20 m ahead and alone for 17 s; held as a
// back candidate and counted when he left (rule 2), he gave a false 180 s chaos phase. Also a
// puller who rode away and is caught again.
function joinerStep(prev, {now, frontId, plan, selfId}) {
    if (frontId == null) {
        return null;
    }
    const j = prev.joiner;
    if (j && j.id === frontId && now - j.at < BACK_HOLD_MS) {
        return j;
    }
    const before = prev.present || [];
    const planRider = (plan?.riders || []).some(r => r.id === frontId);
    if (planRider && frontId !== selfId && frontId !== prev.front.puller && before.some(id => id !== selfId) &&
        !before.includes(frontId)) {
        return {id: frontId, at: now};
    }
    return null;
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
// (before the start), plan #1, also planned. Nothing in the final sprint or without a plan. In chaos
// {chaos: true}: the line shows that the order differs from the plan, not the plan's guess (spec
// 20 Nov 2026, section 7).
export function captainNext({plan, view, reason, pullerId}) {
    const riders = plan?.riders;
    if (!riders || !riders.length || reason === 'finish') {
        return null;
    }
    if (reason === 'chaos') {
        return {chaos: true};
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
// Riders sitting out (outIds: orderOutIds of the rotation's order) are shown the same way, in normal
// running too, so the table and the Next line agree (spec 20 Nov 2026, section 7).
export function rotationTable(plan, {pullerId = null, presentIds = null, outIds = []} = {}) {
    const riders = plan?.riders || [];
    const pi = riders.findIndex(r => r.id === pullerId);
    const start = Math.max(0, pi);
    const out = new Set(outIds || []);
    const present = presentIds ? new Set(presentIds.filter(id => !out.has(id))) : null;
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
