// The event route's terrain ahead of time (user, 13 Nov 2026: act instead of react). Sauce gives
// every route's elevation profile (Common.getRoute: distances and elevations, the lead-in first);
// from it come the hills, each a roller or a real climb or descent, before the riders get there.
// In the 12 Nov TTT the profile predicted every pause the live grade took (three recordings, the
// same seconds give or take two) and its altitude matched the riders' to 0.2 m.
// Pure logic (no DOM, no Sauce imports).

import {CLIMB_GRADE, CLIMB_EXIT_GRADE, DESCENT_GRADE, DESCENT_EXIT_GRADE} from './rotation.mjs';

export const PROFILE_STEP_M = 10;      // the profile is resampled to one altitude every 10 m
export const GRADE_SPAN_M = 50;        // grade over this distance (centred)
// A hill starts where the grade reaches the climb (descent) grade and stays there for
// HILL_ENTER_M, and ends where it stays below the exit grade for HILL_EXIT_M: the live rule
// (5 s at about 40 km/h), but from the first metre instead of 5 s late.
export const HILL_ENTER_M = 50;
export const HILL_EXIT_M = 50;
// The hill counts this far before and after it: the position is good to about 10 m.
export const HILL_MARGIN_M = 30;
// A roller (user, 13 Nov 2026: "not a real climb, just about 4 %"): at most this long and with at
// most this height difference. The 12 Nov rollers were 110-235 m and 5-10 m; a climb or descent
// beyond either limit pauses the rotation as before.
export const ROLLER_MAX_M = 400;
export const ROLLER_MAX_GAIN_M = 15;
// Where I am on the route: my event distance plus an offset found by matching my altitude with
// the profile (12 Nov: route = event distance + 130 m, the same in all three recordings). Tried
// once ALIGN_MIN_M are ridden with ALIGN_MIN_RISE_M of altitude change, over offsets within
// ALIGN_RANGE_M, on the last ALIGN_KEEP_M. Taken when the best fit is within ALIGN_MAX_RMS_M and
// clearly better than any offset more than ALIGN_APART_M away from it.
export const ALIGN_MIN_M = 1000;
export const ALIGN_MIN_RISE_M = 3;
export const ALIGN_RANGE_M = 2000;
export const ALIGN_STEP_M = 5;
export const ALIGN_KEEP_M = 4000;
export const ALIGN_MAX_RMS_M = 1.5;
export const ALIGN_APART_M = 100;


// The profile from Sauce's route ({distances, elevations}, metres), resampled every
// PROFILE_STEP_M from 0: {step, alt}. null without usable data.
export function routeProfile(route) {
    const ds = route?.distances, es = route?.elevations;
    if (!Array.isArray(ds) || !Array.isArray(es) || ds.length < 2 || ds.length !== es.length) {
        return null;
    }
    const len = ds[ds.length - 1];
    if (!Number.isFinite(len) || len <= 0) {
        return null;
    }
    const alt = [];
    let k = 0;
    for (let d = 0; d <= len; d += PROFILE_STEP_M) {
        while (k < ds.length - 2 && ds[k + 1] < d) {
            k++;
        }
        const span = ds[k + 1] - ds[k];
        const f = span > 0 ? Math.max(0, Math.min(1, (d - ds[k]) / span)) : 0;
        const a = es[k] + (es[k + 1] - es[k]) * f;
        if (!Number.isFinite(a)) {
            return null;
        }
        alt.push(a);
    }
    return {step: PROFILE_STEP_M, alt};
}


// Altitude at route distance d (interpolated), null outside the profile.
export function profileAlt(profile, d) {
    if (!profile || !Number.isFinite(d)) {
        return null;
    }
    const x = d / profile.step;
    const i = Math.floor(x);
    if (i < 0 || i >= profile.alt.length - 1) {
        return i === profile.alt.length - 1 && x === i ? profile.alt[i] : null;
    }
    return profile.alt[i] + (profile.alt[i + 1] - profile.alt[i]) * (x - i);
}


// Grade in percent at d over GRADE_SPAN_M (clamped to the profile's ends).
export function profileGrade(profile, d) {
    const end = (profile.alt.length - 1) * profile.step;
    const a = Math.max(0, d - GRADE_SPAN_M / 2), b = Math.min(end, d + GRADE_SPAN_M / 2);
    return b > a ? (profileAlt(profile, b) - profileAlt(profile, a)) / (b - a) * 100 : 0;
}


// The hills of the route, in order: {from, to, kind: 'climb' | 'descent', lengthM, gainM, roller}.
export function routeHills(profile) {
    if (!profile) {
        return [];
    }
    const hills = [];
    const step = profile.step;
    const end = (profile.alt.length - 1) * step;
    let hill = null, up = null, down = null, flat = null;
    const close = to => {
        const gainM = profileAlt(profile, to) - profileAlt(profile, hill.from);
        const lengthM = to - hill.from;
        hills.push({...hill, to, lengthM, gainM,
                    roller: lengthM <= ROLLER_MAX_M && Math.abs(gainM) <= ROLLER_MAX_GAIN_M});
        hill = null;
    };
    for (let d = 0; d <= end; d += step) {
        const g = profileGrade(profile, d);
        if (!hill) {
            up = g >= CLIMB_GRADE ? up ?? d : null;
            down = g <= DESCENT_GRADE ? down ?? d : null;
            if (up !== null && d - up >= HILL_ENTER_M) {
                hill = {from: up, kind: 'climb'};
            } else if (down !== null && d - down >= HILL_ENTER_M) {
                hill = {from: down, kind: 'descent'};
            }
            if (hill) {
                up = down = flat = null;
            }
            continue;
        }
        const level = hill.kind === 'descent' ? g > DESCENT_EXIT_GRADE : g < CLIMB_EXIT_GRADE;
        flat = level ? flat ?? d : null;
        if (flat !== null && d - flat >= HILL_EXIT_M) {
            close(flat);
            flat = null;
        }
    }
    if (hill) {
        close(end);
    }
    return hills;
}


// The hill at route position pos (HILL_MARGIN_M either side), or null.
export function hillAt(hills, pos) {
    if (!Number.isFinite(pos)) {
        return null;
    }
    return (hills || []).find(h => pos >= h.from - HILL_MARGIN_M && pos <= h.to + HILL_MARGIN_M) || null;
}


export function initialAlign() {
    return {pts: [], offset: null};
}


// One sample of mine (d: event distance, alt: altitude, metres). Finds the offset from my event
// distance to the route distance once (offset: null until then). A distance that goes back by
// more than PROFILE_STEP_M (a new ride) starts over.
export function alignStep(al, {d, alt, profile}) {
    const s = al || initialAlign();
    if (s.offset !== null || !profile || !Number.isFinite(d) || !Number.isFinite(alt) || d <= 0) {
        return s;
    }
    const last = s.pts[s.pts.length - 1];
    if (last && d < last.d - PROFILE_STEP_M) {
        return {pts: [{d, alt}], offset: null};
    }
    if (last && d - last.d < PROFILE_STEP_M) {
        return s;
    }
    const pts = [...s.pts, {d, alt}].filter(p => p.d >= d - ALIGN_KEEP_M);
    const alts = pts.map(p => p.alt);
    if (d - pts[0].d < ALIGN_MIN_M || Math.max(...alts) - Math.min(...alts) < ALIGN_MIN_RISE_M) {
        return {pts, offset: null};
    }
    const fits = [];
    for (let off = -ALIGN_RANGE_M; off <= ALIGN_RANGE_M; off += ALIGN_STEP_M) {
        let sum = 0, ok = true;
        for (const p of pts) {
            const a = profileAlt(profile, p.d + off);
            if (a === null) {
                ok = false;
                break;
            }
            sum += (p.alt - a) ** 2;
        }
        if (ok) {
            fits.push({off, rms: Math.sqrt(sum / pts.length)});
        }
    }
    if (!fits.length) {
        return {pts, offset: null};
    }
    const best = fits.reduce((a, b) => b.rms < a.rms ? b : a);
    const rival = fits.filter(f => Math.abs(f.off - best.off) > ALIGN_APART_M)
        .reduce((a, b) => !a || b.rms < a.rms ? b : a, null);
    const clear = !rival || rival.rms >= 2 * best.rms + 1;
    return best.rms <= ALIGN_MAX_RMS_M && clear ? {pts: [], offset: best.off} : {pts, offset: null};
}
