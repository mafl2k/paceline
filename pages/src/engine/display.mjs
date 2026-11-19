// Pure logic (no DOM, no Sauce imports): what the action window shows for a rotation view, the
// m:ss clock, the pull target in W or W/kg, and the filter of my own power for the power-bar
// marker.
import {WARN_S, SMOOTH_S, powerBar} from './rotation.mjs';
import {S} from '../strings.mjs';

// A power sample older than this no longer counts (no fresh data from Zwift).
export const POWER_KEEP_MS = (SMOOTH_S + 2) * 1000;


// Whole seconds as m:ss (75 -> '1:15'); negative counts as 0.
export function clock(s) {
    const t = Number.isFinite(s) ? Math.max(0, Math.floor(s)) : 0;
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}


// Times as pulls are called, in seconds (expert panel, 13 Nov 2026): the pull's time in whole
// seconds (the "s" stands under it); the rest countdown in seconds below REST_SECS_MAX ("26s"), and
// as m:ss from there ("5:47"), since nobody reads "347s".
export const REST_SECS_MAX = 100;

export function pullSecs(s) {
    return String(Number.isFinite(s) ? Math.max(0, Math.floor(s)) : 0);
}

export function restClock(s) {
    return Number.isFinite(s) && Math.floor(s) < REST_SECS_MAX ? `${pullSecs(s)}s` : clock(s);
}


// My power now for the Action window: the marker's smoothed watts in the target's unit and with
// the same weight (W/kg with one decimal, else whole watts), null without power, so the number and
// the marker always agree (expert panel, 13 Nov 2026).
export function nowValue(watts, weight, unit) {
    if (!Number.isFinite(watts)) {
        return null;
    }
    return formatTarget(Math.round(watts), weight, unit).value;
}


// The first usable weight (kg, > 0) of the candidates in order, or null.
export function pickWeight(...candidates) {
    for (const w of candidates) {
        const n = typeof w === 'string' && w.trim() !== '' ? Number(w) : w;
        if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
            return n;
        }
    }
    return null;
}


// The pull target as {value, unit}. unit 'Wkg' with a weight gives watts / weight with one decimal
// (as Sauce shows W/kg); without a usable weight it falls back to watts.
export function formatTarget(watts, weight, unit) {
    const kg = pickWeight(weight);
    if (unit === 'Wkg' && kg !== null && Number.isFinite(watts)) {
        return {value: (watts / kg).toFixed(1), unit: S.wkgUnit};
    }
    return {value: String(watts), unit: S.wattUnit};
}


// A plan rider's pull_wkg as the plan wrote it (> 0), or null.
function planWkg(rider) {
    return Number.isFinite(rider?.wkg) && rider.wkg > 0 ? rider.wkg : null;
}


// A plan rider's target as {value, unit} like formatTarget, or null without the plan's watts
// (pull_wkg alone sets no target; spec §7.8). unit 'W' is watts, anything else W/kg. In W/kg the
// plan's pull_wkg wins with one decimal, whatever the weights (the number on the plan image, for me
// too); without it watts / weight as before: `weight` is my Zwift weight for me and null for the
// others, the plan rider's weight the fallback, watts when there is none.
export function riderTarget(rider, weight, unit) {
    if (!Number.isFinite(rider?.watts)) {
        return null;
    }
    const wkg = unit !== 'W' ? planWkg(rider) : null;
    if (wkg !== null) {
        return {value: wkg.toFixed(1), unit: S.wkgUnit};
    }
    return formatTarget(rider.watts, pickWeight(weight, rider.weight), unit === 'W' ? 'W' : 'Wkg');
}


// The watts my power bar compares with, or null without the plan's watts: in W/kg with the plan's
// pull_wkg, pull_wkg × my weight (my Zwift weight, else the plan's), so the bar compares my live
// W/kg with pull_wkg; else the plan's watts (W mode, no pull_wkg, or no weight at all).
export function barTarget(rider, weight, unit) {
    if (!Number.isFinite(rider?.watts)) {
        return null;
    }
    const wkg = unit !== 'W' ? planWkg(rider) : null;
    const kg = pickWeight(weight, rider.weight);
    return wkg !== null && kg !== null ? wkg * kg : rider.watts;
}


// ---------- the power marker's filter ----------
// User, 12 Nov 2026: within about 10 W of the target the marker should keep still, a real drop of
// 10 % should show. Zwift's 1 Hz power has single spikes, so a median first throws them out, then
// a short exponential smoothing, then a deadband: the marker only moves when the smoothed power is
// more than DEADBAND_PCT of the target away from where it stands. Compared with 20 other filters
// (16 real pulls, simulated -5/-10 % steps with their noise): 1.2 W/s marker movement (3 s mean:
// 7.4), the wrong colour 1.2 % of the time at target power, a 10 % drop coloured after about 4 s.
export const MEDIAN_N = 5;         // median over the last 5 samples (1 Hz)
export const POWER_TAU_S = 4;      // then exponential smoothing over about this many samples
export const DEADBAND_PCT = 2;     // the marker moves only beyond this (percent of the target)
export const PULL_SETTLE_S = 5;    // the first seconds of my pull: a neutral marker (ramping up)


export function initialMarker() {
    return {w: null, ema: null, buf: [], at: null, pullSince: null, zone: null};
}


function median(xs) {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}


// One power sample {at, w}. pull: {since, target} while I pull, else null. The filter starts over
// after a gap (POWER_KEEP_MS) and at the start of each pull. `w` is the marker's power (the
// deadband only applies with a target); `zone` its colour: the bar zone of `w`, null (neutral)
// outside a pull, without a target and in the first PULL_SETTLE_S of a pull.
export function markerStep(st, {at, w, pull}) {
    if (!Number.isFinite(w) || !Number.isFinite(at)) {
        return st;
    }
    const s = {...initialMarker(), ...st};
    const since = pull ? pull.since : null;
    const fresh = s.w !== null && s.at !== null && at - s.at <= POWER_KEEP_MS;
    const restart = !fresh || (!!pull && since !== s.pullSince);
    const buf = [...(restart ? [] : s.buf), w].slice(-MEDIAN_N);
    const med = median(buf);
    const ema = restart ? med : s.ema + (med - s.ema) / POWER_TAU_S;
    const target = pull && Number.isFinite(pull.target) && pull.target > 0 ? pull.target : null;
    const band = target === null ? 0 : DEADBAND_PCT / 100 * target;
    const shown = restart || Math.abs(ema - s.w) > band ? ema : s.w;
    const settled = !!pull && at - since >= PULL_SETTLE_S * 1000;
    return {w: shown, ema, buf, at, pullSince: since,
            zone: settled && target !== null ? powerBar(shown, target).zone : null};
}


// My smoothed power if its last sample is at most POWER_KEEP_MS old, else null.
export function markerPower(st, now) {
    return st && st.w !== null && st.at !== null && now - st.at <= POWER_KEEP_MS ? st.w : null;
}


// meanW: my filtered power (markerPower); zone: the marker's colour from markerStep (null:
// neutral; left out: the bar zone of meanW).
// kind 'none': nothing to show (no view). 'rest': timeS = seconds to my pull; `next` in the last
// WARN_S of it, when the window shows a steady amber NEXT instead of the seconds (the countdown is
// only good to about 10 s, the handover is called by voice; user, 12 Nov 2026). 'pull': watts =
// my target (the plan's watts, from pull_power or the text export; null without both), timeS =
// seconds left (or over, when `over`),
// marker = powerBar of my smoothed power (null without target or power) against barW (barTarget:
// pull_wkg × my weight in W/kg mode) when it is a number, else against the plan's watts; `watts`
// stays the plan's watts either way (the window's target and the recorder's `w`).
export function actionModel(view, meanW, zone, {barW = null} = {}) {
    if (!view) {
        return {kind: 'none'};
    }
    if (!view.mine) {
        if (view.toMyPullS === null || view.toMyPullS === undefined) {
            return {kind: 'none'};
        }
        const near = view.toMyPullS <= WARN_S;
        const rest = {kind: 'rest', timeS: view.toMyPullS, warn: near, next: near, place: view.place ?? null};
        if (!near) {
            // The standing clock: waiting for the change (overS: the puller over his plan).
            return view.standing ? {...rest, standing: true, overS: view.overS} : rest;
        }
        // READY: my target and where my power is, the marker neutral (below target is right in the
        // draft), so I can come up to the target before the handover instead of surging.
        const watts = Number.isFinite(view.me?.watts) ? view.me.watts : null;
        const bar = Number.isFinite(barW) ? barW : watts;
        return {...rest, watts, marker: watts === null ? null : withZone(powerBar(meanW, bar), null)};
    }
    const over = view.remainingS < 0;
    const watts = Number.isFinite(view.me?.watts) ? view.me.watts : null;
    const bar = Number.isFinite(barW) ? barW : watts;
    return {
        kind: 'pull',
        watts,
        timeS: Math.abs(view.remainingS),
        over,
        warn: view.remainingS <= WARN_S,    // also when over time
        marker: watts === null ? null : withZone(powerBar(meanW, bar), zone),
    };
}


function withZone(bar, zone) {
    return bar && zone !== undefined ? {...bar, zone} : bar;
}


// The Action window when the Rest window has the countdown (an open Rest window; user, 12 Nov
// 2026): 'blank' (nothing at all, not even the dash) while I rest and whenever there is no pull to
// show; 'armed' in the last WARN_S before my pull (NEXT on the countdown): my target `watts` with
// NEXT where the pull's time will run, "get ready". My pull itself is unchanged.
// In the start pen (user, 13 Nov 2026): plan #1 pulls first (the start is set), so his windows are
// armed already: NEXT (and in the pull-only Action window his target). Only before the first start
// of the session (started: the engine's startAt), so a stop later in the ride shows nothing.
// Returns the model for the windows, or null when it does not apply.
export function penModel({plan, selfId, reason, started}) {
    if (reason !== 'still' || started || selfId == null || plan?.riders?.[0]?.id !== selfId) {
        return null;
    }
    return {kind: 'rest', timeS: 0, warn: true, next: true, place: 1};
}


export function pullOnlyModel(m, {watts = null} = {}) {
    if (m.kind === 'pull') {
        return m;
    }
    if (m.kind === 'rest' && (m.next || m.timeS === 0)) {
        return {kind: 'armed', watts: Number.isFinite(watts) ? watts : null, marker: m.marker ?? null};
    }
    return {kind: 'blank'};
}


// What the windows showed in one step, for the recorder, so a ride can be checked against the
// plan by what riders saw. Compact, with rider ids (names are in the session's plan).
//   act    action window: {k: 'rest'|'next', t, place, s?, o?, c?} ('next': READY shown; s: 1 and o: the
//          puller's overrun while the clock stands; c: {k, d} a correction shown under the clock,
//          clock.mjs: its kind and seconds) | {k: 'pull', t, over, w, pos}
//          | {k: dash} with dash from dashKind ('none' = dim dash, 'unknown' = amber ?, 'climb', 'descent')
//   meanW  my 3 s mean power (the bar marker's input), rounded
//   wheel  info "Wheel": {planned, live} (live only while the planned rider is missing)
//   next   captain's "Next" (recorded whether or not the option is on): {id, planned}
export function shownModel({m, dash, meanW = null, wheel = null, next = null}) {
    let act;
    if (m.kind === 'rest') {
        act = {k: m.next || m.timeS === 0 ? 'next' : 'rest', t: m.timeS, place: m.place ?? null};
        if (m.standing) {
            act = {...act, s: 1, o: m.overS};    // the standing clock and the overrun
        }
        if (m.correction) {
            act = {...act, c: {k: m.correction.kind, d: m.correction.deltaS}};
        }
    } else if (m.kind === 'pull') {
        act = {k: 'pull', t: m.timeS, over: !!m.over, w: m.watts ?? null,
               pos: m.marker ? Math.round(m.marker.pos * 100) / 100 : null};
    } else {
        act = {k: dash};
    }
    return {
        act,
        meanW: Number.isFinite(meanW) ? Math.round(meanW) : null,
        wheel: wheel ? {planned: wheel.planned.id, live: wheel.live ? wheel.live.id : null} : null,
        next: next ? {id: next.rider.id, planned: !!next.planned} : null,
    };
}
