// Pure logic (no DOM, no Sauce imports): what the action window shows for a rotation view, the
// m:ss clock, the pull target in W or W/kg, and the filter of my own power for the power-bar
// marker.
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
// chaos (the rotation's reason 'chaos', 20 Nov 2026, spec 2026-11-20-paceline-chaos-counter section
// 4): the team does not ride the plan's order, so the countdown by plan is wrong. Resting is then
// 'none' (the Rest window's dash, no countdown, never READY); my pull shows as always (my plan and
// my pull are real whatever the order).
export function actionModel(view, meanW, zone, {barW = null, chaos = false} = {}) {
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
// an Action-only rider has nothing else to show the gap. Outside chaos the fields only show with a
// Rest window open, whose status line has the gap already, so it is not shown twice.
export function fieldsGapBand(g, reason) {
    return reason === 'chaos' ? restGapBand(g) : null;
}


function withZone(bar, zone) {
    return bar && zone !== undefined ? {...bar, zone} : bar;
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
        return {kind: 'armed', watts: Number.isFinite(watts) ? watts : null, marker: m.marker ?? null};
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
//   meanW  my 3 s mean power (the bar marker's input), rounded
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
// nothing (an open Rest window has the countdown), and in chaos (no countdown) always.

// The slot choices (the settings' select values) and the slots' defaults: my power now in the
// middle, left and right empty (user, 20 Nov 2026).
export const FIELD_KINDS = ['off', 'now', 'powerW', 'powerWkg', 'draft', 'speed', 'cadence', 'heartrate', 'grade'];
export const FIELD_DEFAULTS = {left: 'off', mid: 'now', right: 'off'};
const FIELD_UNIT = {now: 'powerLabel', powerW: 'wattUnit', powerWkg: 'wkgUnit', draft: 'draftUnit',
                    speed: 'kmhUnit', cadence: 'rpmUnit', heartrate: 'bpmUnit', grade: 'gradeUnit'};
export const SMOOTH5_MS = 5000;


function finite(x) {
    return typeof x === 'number' && Number.isFinite(x) ? x : null;
}


function whole(x) {
    const n = finite(x);
    return n === null ? null : String(Math.round(n) || 0);    // never "-0"
}


// One field as {num, unit}: num the text (null: no value, the window shows the dim "–"), unit the
// line under it. data: my nearby state (power, draft, speed km/h, cadence, heartrate, grade as a
// fraction). unit: Paceline's target unit ('W' | 'Wkg'); weight in kg; nowW my power as the pull's
// "now" shows it (markerPower), so "Power now" has the same kind and smoothing in recovery and in the
// pull; smooth5W my 5 s power (smooth5; null: raw power for W and W/kg).
// Zwift sends 0 for a heart rate without a strap, and a cadence of 0 for a trainer without cadence
// while I pedal: both count as missing (a cadence of 0 without power is me coasting).
export function fieldValue(kind, data, {unit = 'W', weight = null, nowW = null, smooth5W = null} = {}) {
    const d = data || {};
    const watts = finite(smooth5W) ?? finite(d.power);
    const kg = pickWeight(weight);
    let num = null;
    if (kind === 'now') {
        num = nowValue(finite(nowW), kg, unit);
    } else if (kind === 'powerW') {
        num = whole(watts);
    } else if (kind === 'powerWkg') {
        num = watts === null || kg === null ? null : (watts / kg).toFixed(1);
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
    return [slots?.left, slots?.mid, slots?.right].map(k =>
        k && k !== 'off' && FIELD_KINDS.includes(k) ? fieldValue(k, data, opts) : null);
}


// The slots from the Action window's settings: the rider's choices while recFields is on (each
// unset or unknown one its default), else the defaults (chaos shows them with the option off).
export function fieldSlots(s = {}) {
    if (!s || s.recFields !== true) {
        return {...FIELD_DEFAULTS};
    }
    const pick = (v, d) => FIELD_KINDS.includes(v) ? v : d;
    return {left: pick(s.recLeft, FIELD_DEFAULTS.left), mid: pick(s.recMid, FIELD_DEFAULTS.mid),
            right: pick(s.recRight, FIELD_DEFAULTS.right)};
}


// Whether the Action window shows the fields. model: windowModel's (actionModel's) model; reason:
// the rotation's. Only while I rest: the countdown ('rest', the standing clock too) or a dash
// ('none': climb, descent, …, the fields keep showing live values), never in READY (the last WARN_S,
// the start rider in the pen) or my pull. Then in chaos always (no countdown to show), else only
// with the option on and a Rest window open (it has the countdown; when it closes, the countdown
// is back here at once). Outside a TTT event ('noevent') the windows stay quiet.
export function fieldsShown({recFields, restOpen, model, reason}) {
    const ready = model?.kind === 'rest' && (model.next || model.timeS === 0);
    const resting = (model?.kind === 'rest' && !ready) || model?.kind === 'none';
    if (!resting || reason === 'noevent') {
        return false;
    }
    return reason === 'chaos' || (recFields === true && !!restOpen);
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


// My 5 s power for the W and W/kg fields with "5 s smoothed" on (null when off): Sauce's own
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
