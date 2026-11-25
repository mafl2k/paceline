// Pure logic (no DOM, no Sauce imports): the band, shadow and pointer of the Action window's power bar
// (design 2026-11-24-band-bar). Ported from the Bar test window's `barfilters.mjs` (branch
// bar-workout), where the user compared the filters over a day of rides, plus the restart after a
// gap, `bandFresh` and the numbers of the red and amber fields.
import {POWER_KEEP_MS} from './display.mjs';
import {GREEN_PCT, AMBER_PCT} from './rotation.mjs';

// Band and average (user, 24 Nov 2026: "we have the live power number above, the band shows the
// range"; "the pointer is perfect with avg 10"; "the band could start from the beginning"). The band
// is where I have been; its soft shadow marks power now (`w`), which the number above the bar shows too.
// `w` is my de-spiked power: the median of the last 3 raw samples, so a gear change's single dip is
// gone.
// - The band is the min and max of the real de-spiked samples of the last BAND_S seconds (user,
//   25 Nov 2026: "the band should always do its 5 s min max", then "take 10 s band": the same span
//   as the average, so the average and the shadow sit inside its raw min/max; barBand keeps the
//   shadow inside the drawn, lowpassed edges), whatever the
//   phase (no prefill: it runs from the first sample), both edges through a
//   first-order lowpass of LP_TAU_S so it glides instead of jumping.
// - The average `mean` is the pointer, the only thing with a colour (`zone`, held ZONE_HYST_PCT at
//   an edge): the average of `w` since the phase began, at most the last AVG_S seconds, from the
//   phase's first sample (user, 25 Nov 2026, replaying the 22 Nov race: "drop the pointer... begin
//   with the avg as we get it"). The marker shows it from MARKER_AFTER_S into my pull ("I would hide
//   the avg until 5 sec in"); READY is no phase (its white marker "pops up shortly at the
//   beginning"), so it has no marker. Meanwhile the band and its shadow at `w` show where I am ("the shadow band
//   replaces it perfectly").
export const BAND_S = 10;
export const AVG_S = 10;
export const LP_TAU_S = 1;
export const MARKER_AFTER_S = 5;   // the marker shows this long into my pull
// The samples kept across phases (a late-detected pull's since lies back). At least BAND_S and AVG_S:
// every window lies in the last 10 s, and a since further back than the log only clamps t0, which
// changes nothing (its marker shows at once either way).
export const LOG_S = 20;
export const ZONE_HYST_PCT = 1;    // the colour changes only this far past a zone's edge (percent)


// The bar zone of `w` against `target`, kept as `prev` until `w` is ZONE_HYST_PCT past the edge.
export function zoneWithHysteresis(w, target, prev) {
    const pct = Math.abs(w - target) / target * 100;
    const h = ZONE_HYST_PCT;
    const greenEdge = GREEN_PCT + (prev === 'green' ? h : prev === 'amber' || prev === 'red' ? -h : 0);
    const amberEdge = AMBER_PCT + (prev === 'red' ? -h : prev === 'amber' || prev === 'green' ? h : 0);
    return pct <= greenEdge ? 'green' : pct <= amberEdge ? 'amber' : 'red';
}


function median(xs) {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}


// A first-order lowpass step from `prev` to `x` after `dtMs`; the first value (prev null) is x.
function lowpass(prev, x, dtMs) {
    if (prev === null || prev === undefined) {
        return x;
    }
    const dt = Math.max(0, dtMs);
    return prev + (x - prev) * (dt / (dt + LP_TAU_S * 1000));
}


// One power sample: at (ms), w (raw watts), goal (watts or null), since (ms: my pull's start; null
// or left out: no phase, i.e. READY, resting, chaos, no target: the band only). A phase needs a
// finite since: any other non-null value counts as this sample's `at`.
// The samples go into a log of the last LOG_S seconds that runs across phases: the engine detects
// my pull a few seconds late and dates its `since` back, so the pull's first seconds were seen
// during READY (coordinator ruling, 24 Nov 2026). Only a gap of more than POWER_KEEP_MS (Zwift
// stopped) clears it.
// - band: always the de-spiked samples of the last BAND_S seconds, whatever the phase, its edges
//   through the lowpass without a break at a phase change (user, 25 Nov 2026, replay of a real
//   race: "the start is not correct. the band resets after the switch"); also with no phase, so it
//   is there at once when READY or the pull begins. Only a gap starts it over.
// - average, per phase: the de-spiked samples since the phase's start (`since`, never before the
//   log's first sample: after a gap, with no state before or a window opened mid-pull, the first
//   sample I have) and of the last AVG_S seconds, from the first one; the marker shows it from
//   MARKER_AFTER_S after that start, outside READY;
// - the zone's hysteresis starts over with a new phase (a new `since`, or a gap).
// Returns the new state (the old one is not changed): {since, t0, at, w, mean, lo, hi, marker, zone,
// log, bhist, hist} with w the de-spiked power now (the shadow), lo and hi from the first sample,
// marker and zone null before MARKER_AFTER_S; with no phase, since, t0, hist, mean,
// marker and zone are null.
export function bandStep(st, {at, w: raw, goal, since: sinceIn}) {
    if (!Number.isFinite(raw) || !Number.isFinite(at)) {
        return st;
    }
    const phase = sinceIn !== null && sinceIn !== undefined;
    const since = !phase ? null : Number.isFinite(sinceIn) ? sinceIn : at;
    const fresh = !!st && at - st.at <= POWER_KEEP_MS;    // no gap: the log and the band go on
    const same = phase && fresh && st.since === since;     // the same phase
    const prev = fresh ? st.log : [];
    const w = median([...prev.slice(-2).map(x => x.raw), raw]);
    const log = [...prev, {t: at, raw, w}].filter(x => x.t > at - LOG_S * 1000);

    // Band: the de-spiked samples of the last BAND_S seconds, across phases.
    const bhist = log.filter(x => x.t > at - BAND_S * 1000).map(x => ({t: x.t, w: x.w}));
    const bs = bhist.map(x => x.w);
    const lo = lowpass(fresh ? st.lo : null, Math.min(...bs), fresh ? at - st.at : 0);
    const hi = lowpass(fresh ? st.hi : null, Math.max(...bs), fresh ? at - st.at : 0);
    if (!phase) {
        return {since: null, t0: null, at, log, bhist, hist: null, w, mean: null, lo, hi, marker: null, zone: null};
    }
    // The phase's start: `since`, but never before the log's first sample (fix round 1, 24 Nov 2026):
    // after a gap, with no state before, or a window opened mid-pull, the clock starts at the first
    // sample I have (design: no power for POWER_KEEP_MS, it starts over with the next sample), so the
    // marker never shows at once from one sample.
    const t0 = same ? st.t0 : Math.max(since, log[0].t);

    // Average: my de-spiked seconds since the phase's start, at most the last AVG_S (by time, whatever
    // the sample rate); a since after this sample (never sent) has none yet.
    const hist = log.filter(x => x.t >= t0 && x.t > at - AVG_S * 1000).map(x => ({t: x.t, w: x.w}));
    const mean = hist.length ? hist.reduce((a, x) => a + x.w, 0) / hist.length : null;
    const marker = mean !== null && at - t0 >= MARKER_AFTER_S * 1000 ? mean : null;
    const zone = marker !== null && Number.isFinite(goal) && goal > 0
        ? zoneWithHysteresis(marker, goal, same ? st.zone : null) : null;
    return {since, t0, at, log, bhist, hist, w, mean, lo, hi, marker, zone};
}


// The state while its band runs and its last sample is at most POWER_KEEP_MS old, else null; with or
// without a marker (READY and my pull's first seconds show the band and its shadow only).
export function bandFresh(st, now) {
    return st && Number.isFinite(st.lo) && Number.isFinite(st.hi) && Number.isFinite(st.at)
        && now - st.at <= POWER_KEEP_MS ? st : null;
}


// The watts (or W/kg) at the four field edges of the bar, left to right: -AMBER_PCT, -GREEN_PCT,
// +GREEN_PCT, +AMBER_PCT of the goal (user: "each red and amber field shows the edge it shares
// towards the middle"). Watts are rounded to 10, W/kg to 0.1 (by the weight the bar uses); no
// weight shows watts.
export function bandNumbers(goalW, {kg, unit}) {
    const wkg = unit === 'Wkg' && Number.isFinite(kg) && kg > 0;
    return [-AMBER_PCT, -GREEN_PCT, GREEN_PCT, AMBER_PCT].map(p => {
        const edgeW = goalW * (100 + p) / 100;
        return wkg ? (Math.round(edgeW * 10 / kg) / 10).toFixed(1) : String(Math.round(edgeW / 10) * 10);
    });
}
