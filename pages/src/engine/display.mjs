// Pure logic (no DOM, no Sauce imports): what the action window shows for a rotation view, the
// m:ss clock, the pull target in W or W/kg, and the power bar's marker and band (their filter is
// powerband.mjs).
import {WARN_S, SMOOTH_S, powerBar} from './rotation.mjs';
import {S, fmt} from '../strings.mjs';

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


// My power now for the Action window: watts in the target's unit and with the same weight (W/kg
// with one decimal, else whole watts), null without power. The number is my power as Zwift sends it,
// or 5 s smoothed (powerNow); only the bar is filtered (user, 24 Nov 2026: "bar marker needs
// filter, but the number should be raw or 5 s", as O101's live data shows it; the bar's band and
// marker are powerband.mjs).
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


// meanW: the bar marker's power (powerband.mjs bandStep's `marker`: my 10 s average from 5 s into my
// pull, null before and in READY); zone: its colour from bandStep (null: neutral, white; left out:
// the bar zone of meanW). band: {lo, hi, w} in watts, the band of my last 10 s and my de-spiked power
// now (its shadow), or null.
// kind 'none': nothing to show (no view). 'rest': timeS = seconds to my pull; `next` in the last
// WARN_S of it, when the window shows a steady amber NEXT instead of the seconds (the countdown is
// only good to about 10 s, the handover is called by voice; user, 12 Nov 2026). 'pull': watts =
// my target (the plan's watts, from pull_power or the text export; null without both), timeS =
// seconds left (or over, when `over`),
// marker = barMarker of meanW (null without target or power) against barW (barTarget: pull_wkg × my
// weight in W/kg mode) when it is a number, else against the plan's watts, band = barBand of band
// against the same (null without target or band; it shows without a marker too); `watts` stays the
// plan's watts either way (the window's target and the recorder's `w`).
// chaos (the rotation's reason 'chaos', 20 Nov 2026, spec 2026-11-20-paceline-chaos-counter section
// 4): the team does not ride the plan's order, so the countdown by plan is wrong. Resting is then
// 'none' (the Rest window's dash, no countdown, never READY); my pull shows as always (my plan and
// my pull are real whatever the order).
export function actionModel(view, meanW, zone, {barW = null, chaos = false, band = null} = {}) {
    if (!view) {
        return {kind: 'none'};
    }
    if (!view.mine) {
        if (chaos || view.toMyPullS === null || view.toMyPullS === undefined) {
            return {kind: 'none'};
        }
        const near = view.toMyPullS <= WARN_S;
        const rest = {kind: 'rest', timeS: view.toMyPullS, warn: near, next: near, place: view.place ?? null};
        if (!near) {
            // The standing clock: waiting for the change (overS: the puller over his plan).
            return view.standing ? {...rest, standing: true, overS: view.overS} : rest;
        }
        // READY: my target and where my power is, as the band and its shadow, no marker (user, 25 Nov
        // 2026: its white marker "pops up shortly at the beginning"; below target is right in the
        // draft), so I can come up to the target before the handover instead of surging. Never a
        // marker here, whatever meanW comes in (a stale sample from my pull, say).
        const watts = Number.isFinite(view.me?.watts) ? view.me.watts : null;
        const bar = Number.isFinite(barW) ? barW : watts;
        return {...rest, watts, marker: null, band: watts === null ? null : barBand(band, bar)};
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
        marker: watts === null ? null : barMarker(meanW, bar, zone),
        band: watts === null ? null : barBand(band, bar),
    };
}


// The gap while the Action window shows the recovery fields (spec 2026-11-20 chaos counter section 4:
// gap warnings stay on; coordinator ruling 20 Nov 2026: an Action-only rider must not lose them). g:
// gapView's warning. The band follows the rest line's urgency rule (review ruling, 20 Nov 2026):
// only my own gap (also in its early stage) and a critical full gap of someone else; a spare gap of
// someone else, which the rest line keeps dim, shows no band. In the bar's place with the pull's band
// colours (critical red, closing green, else amber). text: the strings key, the rest line's words
// where the pull's would point the wrong way: "▲ GAP" for my own gap, "Gap ahead" when I am cut off
// behind someone else's; else the pull's band text by kind. null: nothing to show.
export function restGapBand(g) {
    if (!g || !(g.mine || (g.critical && g.level === 'full'))) {
        return null;
    }
    const text = g.mine ? 'gapMe' : g.behind ? 'gapInfoAhead' :
        g.kind === 'group' ? 'gapGroup' : g.kind === 'one' ? 'gapOne' : 'gapSplit';
    return {text, critical: !!g.critical, closing: !!g.closing};
}


// The gap band under the recovery fields (coordinator ruling, 20 Nov 2026): only in chaos, where
// an Action-only rider has nothing else to show the gap. Outside chaos the gap is in a status line
// already: the open Rest window's, or (no Rest window, user, 23 Nov 2026) the Action window's own in
// the bar's place (clockInFields), so it is not shown twice.
export function fieldsGapBand(g, reason) {
    return reason === 'chaos' ? restGapBand(g) : null;
}


// The bar's marker: powerBar of meanW against the bar target `barW` with `zone` (null: white; left
// out: the bar zone of meanW). null without power (no average shown yet) or target.
export function barMarker(meanW, barW, zone) {
    const bar = powerBar(meanW, barW);
    return bar ? {...bar, ...(zone !== undefined ? {zone} : {})} : null;
}


// A band narrower than this (bar positions) has its shadow in the middle.
const SHADOW_MIN_SPAN = 0.004;

// The bar's band, apart from the marker (user, 25 Nov 2026: READY and my pull's first 5 s show the
// band and its shadow without a marker): `band` ({lo, hi, w} watts: its edges and my de-spiked power
// now) against the bar target `barW` as bar positions {lo, hi, now}, `now` the shadow's place inside
// the band (0 its left end, 1 its right end, kept inside; 0.5 without w or when the band is narrower
// than SHADOW_MIN_SPAN). null without band or target.
export function barBand(band, barW) {
    const lo = band ? powerBar(band.lo, barW) : null;
    const hi = band ? powerBar(band.hi, barW) : null;
    if (!lo || !hi) {
        return null;
    }
    const w = powerBar(band.w, barW);
    const span = hi.pos - lo.pos;
    const now = w && span > SHADOW_MIN_SPAN ? Math.min(1, Math.max(0, (w.pos - lo.pos) / span)) : 0.5;
    return {lo: lo.pos, hi: hi.pos, now};
}


// The Action window when the Rest window has the countdown (an open Rest window; user, 12 Nov
// 2026): 'blank' (nothing at all, not even the dash) while I rest and whenever there is no pull to
// show; 'armed' in the last WARN_S before my pull (NEXT on the countdown): my target `watts` with
// NEXT where the pull's time will run, "get ready". My pull itself is unchanged.
// In the start pen (user, 13 Nov 2026): plan #1 pulls first (the start is set), so his windows are
// armed already: NEXT (and in the pull-only Action window his target). Only while no start runs
// (started: the engine's startAt), so a short stop in the ride shows nothing. The engine clears
// startAt after START_PEN_MS of standing (audit fixes, 20 Nov 2026, M8), so the pen of a second
// race in the same session (or a stop that long, which the engine takes as a new start too) arms
// him again; a stand right after the finish line does not (final review, 21 Nov 2026, M-4).
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
        return {kind: 'armed', watts: Number.isFinite(watts) ? watts : null, marker: m.marker ?? null,
                band: m.band ?? null};
    }
    return {kind: 'blank'};
}


// What the windows showed in one step, for the recorder, so a ride can be checked against the
// plan by what riders saw. Compact, with rider ids (names are in the session's plan).
//   act    action window: {k: 'rest'|'next', t, place, s?, o?, c?} ('next': READY shown; s: 1 and o: the
//          puller's overrun while the clock stands; c: {k, d} a correction shown under the clock,
//          clock.mjs: its kind and seconds) | {k: 'pull', t, over, w, pos}
//          | {k: dash} with dash from dashKind ('none' = dim dash, 'unknown' = amber ?, 'climb', 'descent',
//          'chaos' = dim ≠ while I rest and the order does not hold, 20 Nov 2026)
//   meanW  the bar marker's power (my 10 s average, from 5 s into my pull), rounded; null without a
//          marker: READY, my pull's first 5 s and outside my pull (since the band bar, 24 Nov 2026;
//          before, the marker's filter ran all the time; nothing reads it but a server test fixture)
//   wheel  info "Wheel": {planned, live} (live only while the planned rider is missing)
//   next   captain's "Next" (recorded whether or not the option is on): {id, planned}, or {chaos: true}
//          while it says "Order ≠ plan"
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
        next: next ? (next.chaos ? {chaos: true} : {id: next.rider.id, planned: !!next.planned}) : null,
    };
}


// ---------- the recovery fields (spec 2026-11-20-paceline-big-numbers, section 3) ----------
// While I rest, the Action window can show three fields in the pull's three slots instead of
// nothing (an open Rest window has the countdown) or the big countdown (without one the countdown
// is the right field, user, 23 Nov 2026), and in chaos (no countdown) always.

// The slot choices (the settings' select values) and the slots' defaults: my power in the middle,
// left and right empty (user, 20 Nov 2026). One power field in Paceline's unit (user, 24 Nov 2026:
// "nobody wants to see his pull in W/kg and recovery in watts"); the earlier Power now, Power W and
// Power W/kg are read as it (OLD_POWER_KINDS, fieldKind).
export const FIELD_KINDS = ['off', 'power', 'draft', 'speed', 'cadence', 'heartrate', 'grade'];
export const FIELD_DEFAULTS = {left: 'off', mid: 'power', right: 'off'};
export const OLD_POWER_KINDS = ['now', 'powerW', 'powerWkg'];
const FIELD_UNIT = {power: 'powerLabel', draft: 'draftUnit',
                    speed: 'kmhUnit', cadence: 'rpmUnit', heartrate: 'bpmUnit', grade: 'gradeUnit'};
export const SMOOTH5_MS = 5000;


function finite(x) {
    return typeof x === 'number' && Number.isFinite(x) ? x : null;
}


function whole(x) {
    const n = finite(x);
    return n === null ? null : String(Math.round(n) || 0);    // never "-0"
}


// A stored slot choice as one of FIELD_KINDS: an earlier power choice is 'power', anything unknown
// null.
export function fieldKind(v) {
    return OLD_POWER_KINDS.includes(v) ? 'power' : FIELD_KINDS.includes(v) ? v : null;
}


// My power for the number (pull and recovery alike): the 5 s power when "5 s smoothed power" is on
// and there is one (smooth5), else my power as Zwift sends it; null without either.
export function powerNow({raw, smooth5W = null}) {
    return finite(smooth5W) ?? finite(raw);
}


// One field as {num, unit}: num the text (null: no value, the window shows the dim "–"), unit the
// line under it. data: my nearby state (power, draft, speed km/h, cadence, heartrate, grade as a
// fraction). unit: Paceline's target unit ('W' | 'Wkg'); weight in kg; smooth5W my 5 s power
// (smooth5; null: raw power). Power is the number the pull shows (nowValue of powerNow), so it keeps
// its kind and unit when my pull starts.
// Zwift sends 0 for a heart rate without a strap, and a cadence of 0 for a trainer without cadence
// while I pedal: both count as missing (a cadence of 0 without power is me coasting).
export function fieldValue(kind, data, {unit = 'W', weight = null, smooth5W = null} = {}) {
    const d = data || {};
    const kg = pickWeight(weight);
    let num = null;
    if (kind === 'power') {
        const w = powerNow({raw: d.power, smooth5W});
        num = w === null ? null : nowValue(w, kg, unit);
    } else if (kind === 'draft' || kind === 'speed') {
        num = whole(d[kind]);
    } else if (kind === 'heartrate') {
        num = finite(d.heartrate) > 0 ? whole(d.heartrate) : null;
    } else if (kind === 'cadence') {
        const pedalling = finite(d.power) > 0;
        num = finite(d.cadence) > 0 || (finite(d.cadence) === 0 && !pedalling) ? whole(d.cadence) : null;
    } else if (kind === 'grade') {
        const g = finite(d.grade);
        num = g === null ? null : (g * 100).toFixed(1).replace(/^-(0\.0)$/, '$1');
    }
    return {num, unit: FIELD_UNIT[kind] ? S[FIELD_UNIT[kind]] : ''};
}


// The three fields [left, mid, right]; an Off (or unknown) slot is null: empty, keeping its place.
export function recoveryFields(slots, data, opts) {
    return [slots?.left, slots?.mid, slots?.right].map(k => {
        const kind = fieldKind(k);
        return kind && kind !== 'off' ? fieldValue(kind, data, opts) : null;
    });
}


// The slots from the Action window's settings: the rider's choices while recFields is on (each
// unset or unknown one its default), else the defaults (chaos shows them with the option off).
export function fieldSlots(s = {}) {
    if (!s || s.recFields !== true) {
        return {...FIELD_DEFAULTS};
    }
    const pick = (v, d) => fieldKind(v) ?? d;
    return {left: pick(s.recLeft, FIELD_DEFAULTS.left), mid: pick(s.recMid, FIELD_DEFAULTS.mid),
            right: pick(s.recRight, FIELD_DEFAULTS.right)};
}


// Whether the Action window shows the fields. model: windowModel's (actionModel's) model; reason:
// the rotation's. Only while I rest: the countdown ('rest', the standing clock too) or a dash
// ('none': climb, descent, …, the fields keep showing live values), never in READY (the last WARN_S,
// the start rider in the pen) or my pull. Then in chaos always (no countdown to show), else with the
// option on: with a Rest window open (it has the countdown) the three fields picked, without one the
// countdown in the right field (clockInFields; user, 23 Nov 2026). Outside a TTT event ('noevent')
// the windows stay quiet.
export function fieldsShown({recFields, restOpen, model, reason}) {
    if (!restingModel(model) || reason === 'noevent') {
        return false;
    }
    return reason === 'chaos' || recFields === true;
}


// Whether the fields carry the countdown (user, 23 Nov 2026): the option on and no Rest window that
// has it, so the Action window alone shows two fields and the countdown with my place as the third
// one, in the right field, where READY and my pull's time come next. Not in chaos (no countdown).
export function clockInFields({recFields, restOpen, model, reason}) {
    return fieldsShown({recFields, restOpen, model, reason}) && reason !== 'chaos' && !restOpen;
}


function restingModel(model) {
    const ready = model?.kind === 'rest' && (model.next || model.timeS === 0);
    return (model?.kind === 'rest' && !ready) || model?.kind === 'none';
}


// The countdown as one field (user, 23 Nov 2026): the number on top ("≥" while the clock stands),
// under it my place, "#2"; no "s" for the seconds (user, 23 Nov 2026: the field is plain enough
// without). null: no countdown.
// "≥" only up to 9:59: "≥10:47" is wider than the field and runs into the middle one (review, 23 Nov
// 2026); the dimmed number and the "+N" under the fields still say the clock stands.
export function clockField(m) {
    if (m?.kind !== 'rest') {
        return null;
    }
    const text = restClock(m.timeS);
    const secs = text.endsWith(S.secUnit);
    const num = secs ? text.slice(0, -S.secUnit.length) : text;
    return {num: (m.standing && num.length < 5 ? '\u2265' : '') + num,
            unit: '',
            place: m.place === null || m.place === undefined ? '' : fmt('place', {n: m.place})};
}


// Whether the Rest window shows its countdown (or READY), for its sign of life (presence.mjs
// restClockShown; audit fixes, 20 Nov 2026, W2): not while it vanishes, nor for a dash or blank.
export function restClockOf({vanish, model}) {
    return !vanish && model?.kind === 'rest';
}


// What the Rest window shows, for its sign of life (presence.mjs restShows; final review, 21 Nov
// 2026, I-1): 'clock' (its countdown or READY), 'pull' (vanished for my pull), 'ready' (vanished in
// READY while an Action window is open), 'dash' (model 'none': climb, descent, chaos, the quiet
// start), null otherwise.
export function restShowsOf({vanish, model}) {
    const k = model?.kind;
    if (vanish) {
        return k === 'pull' ? 'pull' : k === 'rest' ? 'ready' : null;
    }
    return k === 'rest' ? 'clock' : k === 'none' ? 'dash' : null;
}


// The same for the Action window's own model: 'pull', 'ready' (the last WARN_S, or the clock at 0),
// 'clock', 'dash' or null.
export function actionPhase(model) {
    const k = model?.kind;
    if (k === 'rest') {
        return model.next || model.timeS === 0 ? 'ready' : 'clock';
    }
    return k === 'pull' ? 'pull' : k === 'none' ? 'dash' : null;
}


// The Action window's phase {phase, prev, at}: `prev` the phase before the last change, `at` when it
// changed. The same object while the phase stays.
export function phaseStep(prev, {phase, now}) {
    return prev && prev.phase === phase ? prev : {phase, prev: prev?.phase ?? null, at: now};
}


// The hand-back of the countdown (final review, 21 Nov 2026, I-1; probes t1, t2): at the end of my
// pull, of a dash and of READY both windows change in the same moment, but the Action window often
// renders first and read the Rest window's last sign of life (vanished, or the dash: no countdown),
// so it showed the countdown for 129-181 ms (at every pull end, and the first countdown), with
// "Fields while resting" on the countdown and then the fields. A Rest window that shows what the
// Action window showed until just now (`shows`: presence.mjs restShows) is in step and takes the
// countdown too, for REST_HANDBACK_MS after the change; a Rest window that does not show the
// countdown by then (its engine disagrees) leaves it here. A Rest window opened mid-rest (probe
// s9-restopen) shows nothing yet, or a dash of its own long after my change: it does not take it.
export const REST_HANDBACK_MS = 1000;
export function restHandBack({shows, phase, now}) {
    return !!phase?.prev && phase.prev !== phase.phase && !!shows?.has(phase.prev) &&
        now - phase.at < REST_HANDBACK_MS;
}


// Whether an open Rest window takes the countdown from the Action window (audit fixes, 20 Nov 2026,
// W2), the restOpen of fieldsShown and the pull-only hand-off. It took it as soon as it was open:
// probe s9-restopen, a Rest window opened mid-rest showed nothing for 1.5 s while the Action window
// was already blank. Now, while the Action window would show a countdown ('rest'), only a Rest window
// that shows one (restShown) takes it, or one it hands the countdown back to (handBack, restHandBack,
// I-1). For a dash ('none': climb, descent, chaos) an open Rest window is enough, as before, so the
// fields while resting stay as they were there.
export function restTakes({restOpen, restShown, handBack = false, model}) {
    return !!restOpen && (model?.kind !== 'rest' || !!restShown || !!handBack);
}


// Whether a window vanishes completely, background included. Outside a TTT event (the quiet state,
// paceline.mjs muted()) all three do (user, 22 Nov 2026). Otherwise only the Rest window: during my
// pull, and from READY on (the last WARN_S before my pull, and the start rider in the pen) while an
// Action window is open, which takes over (user, 13 Nov 2026); without one it shows READY itself.
export function vanishes({mode, quiet, model = null, actionOpen = false}) {
    if (quiet) {
        return true;
    }
    if (mode !== 'rest' || !model) {
        return false;
    }
    const ready = model.kind === 'rest' && (model.next || model.timeS === 0);
    return model.kind === 'pull' || (ready && !!actionOpen);
}


// Whether the DEMO badge shows (audit fixes, 20 Nov 2026, W12): in the demo, but not while the Rest
// window has vanished (probe s7-demo: the badge stayed over the otherwise empty window).
export function demoBadge({demo, vanish}) {
    return !!demo && !vanish;
}


// My 5 s power for the power number with "5 s smoothed" on (null when off): Sauce's own
// (stats.power.smooth['5'] of my nearby entry) when it has one, else the mean of my samples
// {t, w} of the last SMOOTH5_MS (null without any).
export function smooth5({on, sauce, hist, now}) {
    if (!on) {
        return null;
    }
    if (finite(sauce) !== null) {
        return sauce;
    }
    const xs = (hist || []).filter(x => x.t > now - SMOOTH5_MS && x.t <= now && finite(x.w) !== null);
    return xs.length ? xs.reduce((sum, x) => sum + x.w, 0) / xs.length : null;
}


// ---------- the rest line's parts (the line under the clock, paceline.mjs setOverParts) ----------

// Marks the place of a value in a formatted string (never in a string or a name).
export const PART_MARK = '\u0000';

// The text of `key` without names, as {pre, cut, post}: what comes before the gap may be cut.
// A minus sign right before the gap ("12 riders −14 m", strings.mjs gapInfoSplit) stays with the gap.
export function labelParts(key, vars) {
    const [label, post = ''] = fmt(key, {...vars, gap: PART_MARK}).split(PART_MARK);
    const sign = label.endsWith('\u2212') ? '\u2212' : '';
    return {pre: '', cut: label.slice(0, label.length - sign.length), post: sign + vars.gap + post};
}


// The Info window's plan line (strings.mjs planLine, planLineClub) as {cut, keep, tail}: the label
// (the team) may be cut with "…", " · plan HM4ZNJ" never (riders compare the code before the start;
// final review, 20 Nov 2026); the club after it (two or more clubs ticked) may be cut too.
export function planParts(key, vars) {
    const [pre, mid, tail = ''] = fmt(key, {...vars, label: PART_MARK, sig: PART_MARK}).split(PART_MARK);
    return {cut: pre + String(vars.label), keep: mid + String(vars.sig), tail};
}
