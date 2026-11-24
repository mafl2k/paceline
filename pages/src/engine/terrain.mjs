// The event route's terrain ahead of time (user, 13 Nov 2026: act instead of react). Sauce gives
// every route's elevation profile (Common.getRoute: distances and elevations, the lead-in first);
// from it come the hills, each a roller or a real climb or descent, before the riders get there.
// In the 12 Nov TTT the profile predicted every pause the live grade took (three recordings, the
// same seconds give or take two) and its altitude matched the riders' to 0.2 m.
//
// The climb index (user, 23 Nov 2026: "Climb kom index over km start and end, no more altitude
// matching"): once the event is known, in the pen, the climbs (a segment over a climb joins it) are
// listed by start and end in EVENT distance, the lead-in once and then lap after lap up to the
// event's end. The live position is the rider's event distance, looked up in that list (hillAt); no
// altitude is matched. Why: on 22 Nov the climb at km 92 was missed because the position was found
// only at km 66 and the route position did not wrap by lap. Without the data the engine goes by the
// live grade. Sauce's route fields (top-level leadinDistanceInMeters, distanceInMeters, segments;
// meta.leadinDistance) were read live on 23 Nov (Sauce 2.4.0-alpha.7); Sauce's segments carry no
// type. Every reader tolerates a missing field. Pure logic (no DOM, no Sauce imports).

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


// Flat parts up to this long inside a climb, or between a climb and its descent, do not end it
// (user, 23 Nov 2026).
export const CLIMB_JOIN_M = 1000;


// The route metres before the first lap's start in Sauce's profile: meta.leadinDistance (often 0,
// e.g. 759.5; read live 23 Nov 2026), for every event, laps or not. Sauce's event elevation widget
// fetches the route with the 'leadin' prelude. Never the route's top-level leadinDistanceInMeters:
// that is Zwift's lead-in in event metres (routeLeadin). null unless the value is a finite number
// of at least 0.
export function routePrelude(route) {
    const m = route?.meta;
    const v = m?.leadinDistance ?? m?.leadinDistanceInMeters;
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}


// Zwift's lead-in and lap in event metres: the route's top-level leadinDistanceInMeters and
// distanceInMeters (read live 23 Nov 2026: e.g. 623.5 and 33246.7). null when missing or unusable.
function routeLeadin(route) {
    const v = route?.leadinDistanceInMeters;
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

function routeLap(route) {
    const v = route?.distanceInMeters;
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}


// The route's segments as spans in profile metres: [{from, to}]. route.segments is
// [{id, offset, distance, ...}], offset from the first lap's start (read live 23 Nov 2026). Sauce's
// segments carry no type, so every segment counts (user, 23 Nov 2026: the type does not matter, a
// segment over a climb joins it); climbIndex keeps only those over a real climb. A segment counts
// when offset and distance are finite numbers and the distance is above 0.
export function segmentSpans(route, preludeM) {
    const segs = route?.segments;
    if (!Array.isArray(segs) || !Number.isFinite(preludeM)) {
        return [];
    }
    const spans = [];
    for (const s of segs) {
        if (s && Number.isFinite(s.offset) && Number.isFinite(s.distance) && s.distance > 0) {
            const from = preludeM + s.offset;
            spans.push({from, to: from + s.distance});
        }
    }
    return spans;
}


// The list of climbs and descents by event distance: [{from, to, kind, roller, source: 'profile' |
// 'segment', lengthM, gainM}], sorted; hillAt works on it. profile and hills come from routeProfile
// and routeHills (profile metres, Sauce's lead-in first), preludeM is that lead-in, endM the
// event's end in event metres, spans those of segmentSpans. leadinM and lapM are Zwift's lead-in
// and lap in event metres (default: the profile's). Event metres from profile metres p (measured
// against three races, 23 Nov 2026, altitude within 0.3 m): in the profile's lead-in
// leadinM + (p - preludeM), once; in the lap leadinM + (p - preludeM) x lapM / (profile lap) + k x lapM
// on lap k = 0, 1, ... up to endM. A segment over a real climb makes one climb of it and of every
// real climb it touches. Hills of one kind on different laps at most HILL_EXIT_M apart are one
// (rollers too, the lap line). Real hills (no rollers) of one kind at most CLIMB_JOIN_M apart are
// one; a climb whose descent follows within CLIMB_JOIN_M reaches up to the descent's start.
export function climbIndex(opts) {
    const {profile, hills, preludeM, endM} = opts ?? {};
    const spans = opts?.spans ?? [];
    if (!profile || !Number.isFinite(preludeM) || !Number.isFinite(endM)) {
        return null;
    }
    const end = (profile.alt.length - 1) * profile.step;
    const profileLapM = end - preludeM;
    if (!(profileLapM > 0) || !(endM > 0)) {
        return null;
    }
    const leadinM = Number.isFinite(opts.leadinM) && opts.leadinM >= 0 ? opts.leadinM : preludeM;
    const lapM = Number.isFinite(opts.lapM) && opts.lapM > 0 ? opts.lapM : profileLapM;
    const scale = lapM / profileLapM;
    // Profile metre p on lap k to event metre, and back: only for the end, which lies past lap k's
    // start (the lap loop's condition), so always in the lap's scaled part.
    const toEvent = (p, k) => leadinM + k * lapM + (p - preludeM) * (p > preludeM ? scale : 1);
    const toProfile = (e, k) => preludeM + (e - leadinM - k * lapM) / scale;
    const altAt = d => profileAlt(profile, Math.max(0, Math.min(end, d)));
    let items = (hills || []).map(h => ({
        from: h.from, to: h.to, kind: h.kind, roller: !!h.roller, source: 'profile',
        gainM: h.gainM ?? altAt(h.to) - altAt(h.from)
    }));
    // Segments: one climb over the segment and every real climb it touches.
    for (const s of [...spans].sort((a, b) => a.from - b.from)) {
        const hit = items.filter(h => h.kind === 'climb' && !h.roller && h.from < s.to && h.to > s.from);
        if (!hit.length) {
            continue;
        }
        const from = Math.min(s.from, ...hit.map(h => h.from));
        const to = Math.max(s.to, ...hit.map(h => h.to));
        items = items.filter(h => !hit.includes(h));
        items.push({from, to, kind: 'climb', roller: false, source: 'segment', gainM: altAt(to) - altAt(from)});
    }
    // Lap by lap, in event metres up to the end: lap 0 as listed, then the part inside the lap.
    const out = [];
    for (let k = 0; leadinM + k * lapM < endM; k++) {
        for (const h of items) {
            const a = k ? Math.max(h.from, preludeM) : h.from;
            const b = k ? Math.min(h.to, end) : h.to;
            if (!(b > a)) {
                continue;
            }
            const from = Math.max(0, toEvent(a, k));
            let to = toEvent(b, k);
            let gainM = k ? altAt(b) - altAt(a) : h.gainM;
            if (from > endM || !(to > 0)) {
                continue;
            }
            if (to > endM) {
                to = endM;
                gainM = altAt(toProfile(endM, k)) - altAt(a);
            }
            out.push({...h, from, to, gainM, lengthM: to - from, _k: k});
        }
    }
    out.sort((a, b) => a.from - b.from || a.to - b.to);
    // The lap line: hills of one kind on different laps at most HILL_EXIT_M apart are one, rollers
    // too (routeHills opens a hill 15-20 m late, so a climb over the lap line leaves a small gap);
    // the joined hill is a roller only if both were and it still is by length and height.
    const seamed = [];
    for (const h of out) {
        const prev = seamed[seamed.length - 1];
        if (prev && prev.kind === h.kind && prev._k !== h._k && h.from - prev.to <= HILL_EXIT_M) {
            prev.to = Math.max(prev.to, h.to);
            prev._k = h._k;
            prev.lengthM = prev.to - prev.from;
            prev.gainM += h.gainM;
            prev.source = prev.source === 'segment' || h.source === 'segment' ? 'segment' : 'profile';
            prev.roller = prev.roller && h.roller &&
                prev.lengthM <= ROLLER_MAX_M && Math.abs(prev.gainM) <= ROLLER_MAX_GAIN_M;
        } else {
            seamed.push(h);
        }
    }
    // Flat parts up to CLIMB_JOIN_M: rollers stay as they are and bridge nothing.
    const res = [];
    let last = null;    // the last real hill in res
    for (const h of seamed) {
        if (h.roller) {
            res.push(h);
            continue;
        }
        if (last && h.from - last.to <= CLIMB_JOIN_M) {
            if (last.kind === h.kind) {
                last.to = Math.max(last.to, h.to);
                last.lengthM = last.to - last.from;
                last.gainM += h.gainM;
                last.source = last.source === 'segment' || h.source === 'segment' ? 'segment' : 'profile';
                continue;
            }
            if (last.kind === 'climb' && h.from > last.to) {
                last.to = h.from;
                last.lengthM = last.to - last.from;
            }
        }
        res.push(h);
        last = h;
    }
    return res.map(({_k, ...h}) => h);
}


// The index of a route in the pen: {preludeM, lapM, leadinM, items}. leadinM and lapM are Zwift's
// lead-in and lap in event metres (the route's leadinDistanceInMeters and distanceInMeters, else
// the profile's), preludeM the lead-in in Sauce's profile. endM is the event's end in event metres;
// without it, laps give the end as leadinM + laps x lapM. null without the profile, the prelude or
// the end (the engine then goes by the live grade). segInfos (Common.getSegments' answer) is not
// read: Sauce's segments have no type.
export function buildClimbIndex(route, segInfos, opts) {
    const {laps, endM} = opts ?? {};
    const profile = routeProfile(route);
    const preludeM = routePrelude(route);
    if (!profile || preludeM === null) {
        return null;
    }
    const profileLapM = (profile.alt.length - 1) * profile.step - preludeM;
    if (!(profileLapM > 0)) {
        return null;
    }
    const leadinM = routeLeadin(route) ?? preludeM;
    const lapM = routeLap(route) ?? profileLapM;
    const end = endM > 0 ? endM : laps > 0 ? leadinM + laps * lapM : null;
    if (!(end > 0)) {
        return null;
    }
    const items = climbIndex({
        profile, hills: routeHills(profile), preludeM, leadinM, lapM, endM: end,
        spans: segmentSpans(route, preludeM)
    });
    return items ? {preludeM, lapM, leadinM, items} : null;
}
