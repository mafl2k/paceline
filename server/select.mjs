// The one selection function (spec §3): which of a club's sheets a rider gets, in and outside a
// Zwift event, and what a change does to the other riders. Pure: the clock is always passed in.
import {zonedToUtc, isDate, isWeekday, HHMM_RE, localDate, addDays} from './time.mjs';
import {decodeEntities} from '../pages/src/engine/plan.mjs';
import {raceOf, racesOf} from './races.mjs';

export const MATCH_BEFORE_MS = 30 * 60000;   // S may lie this much before E
export const MATCH_AFTER_MS = 60 * 60000;    // and this much after it
export const LEARNED_MS = 4 * 3600000;       // a learned event id matches within ±4 h of S
export const USED_UP_MS = 4 * 3600000;       // a sheet is never served again 4 h after S
// A plan's content goes out from this long before S, on the server's clock (user, 16 Nov 2026:
// "30 min for now"; to be tuned from check C3).
export const PLAN_OPEN_MS = 30 * 60000;
// A race date is "still to race" until S + 2 h (spec §14.1: a TTT is over by then, staggered starts
// included); the upload forms' default date.
export const STILL_TO_RACE_MS = 2 * 3600000;


const validStart = v => typeof v === 'string' && HHMM_RE.test(v);


// The time a race of `team` starts at with stored start `own` (race.start): `own` when it is a
// valid 'HH:MM', else the team's start time (a weekly team's rhythm; a special team's race stored by
// 0.3.0 without one), else null. The one place of this rule (startOf, club.mjs).
export function raceTime(team, own) {
    return validStart(own) ? own : validStart(team?.start) ? team.start : null;
}


// The local start time 'HH:MM' of a sheet (a stored version, or {team, date}): the start of its
// race (races spec §1: team.races[date].start, a valid 'HH:MM'), else the team's start time (a weekly
// team's rhythm, a special team's race stored by 0.3.0 without one), for every kind. Null without a
// team or a time.
export function startOf(club, sheet) {
    const team = Object.hasOwn(club.teams, sheet.team) ? club.teams[sheet.team] : null;
    if (!team) {
        return null;
    }
    return raceTime(team, raceOf(club, sheet.team, sheet.date)?.start ?? null);
}


// Planned start S in ms, the one place every race time comes from: the sheet's date at its local
// start time (startOf). Null without a team, without a start time, or with a bad date.
export function plannedStart(club, sheet) {
    const start = startOf(club, sheet);
    if (start === null || !isDate(sheet.date)) {
        return null;
    }
    return zonedToUtc(sheet.date, start, club.tz);
}


// The start time 'HH:MM' of team `slug`'s race on `date` (a team races once a date), or null.
export function raceStart(club, slug, date) {
    return startOf(club, {team: slug, date});
}


// S of team `slug`'s race on `date` (raceStart), or null.
export function raceStartAt(club, slug, date) {
    const start = raceStart(club, slug, date);
    return start === null || !isDate(date) ? null : zonedToUtc(date, start, club.tz);
}


// The ISO weekday of a 'YYYY-MM-DD' (Monday = 1 … Sunday = 7).
const weekdayOf = date => new Date(`${date}T12:00:00Z`).getUTCDay() || 7;


// The weekday a weekly team races on (plan versions spec §4.1, user 17 Nov 2026): the team's own,
// else Thursday (4). Only 1-7 counts; an unknown team has Thursday. There is no club's race day any
// more (races spec §4c: the conversion wrote it into the teams that followed it).
export function teamWeekday(club, slug) {
    const team = typeof slug === 'string' && Object.hasOwn(club.teams, slug) ? club.teams[slug] : null;
    return team !== null && isWeekday(team?.weekday) ? team.weekday : 4;
}


// True while team `slug`'s race on `date` is still to race: until its S (raceStartAt) +
// STILL_TO_RACE_MS; without a start time, while `date` is today or later in the club's zone.
export function stillToRace(club, slug, date, now) {
    const S = raceStartAt(club, slug, date);
    return S === null ? date >= localDate(now, club.tz) : now <= S + STILL_TO_RACE_MS;
}


// True once team `slug`'s race on `date` is over (races spec §2): from its S + STILL_TO_RACE_MS;
// without a start time, once `date` has passed in the club's zone. The opposite of stillToRace.
export function raceOver(club, slug, date, now) {
    return !stillToRace(club, slug, date, now);
}


// A weekly team's next race day by its weekday (teamWeekday), 'YYYY-MM-DD' in the club's zone: the
// first date from yesterday on with that weekday that is still to race (yesterday covers a late
// start still racing after midnight). Any kind but 'special' races weekly, and so does an unknown
// team; a special team has no rhythm: null. Past dates are never read.
export function rhythmDate(club, slug, now) {
    const team = typeof slug === 'string' && Object.hasOwn(club.teams, slug) ? club.teams[slug] : null;
    if (team !== null && team.kind === 'special') {
        return null;
    }
    const from = addDays(localDate(now, club.tz), -1);
    let date = addDays(from, (teamWeekday(club, slug) - weekdayOf(from) + 7) % 7);
    // yesterday or today after its S + 2 h: a week on (a later date is always still to race)
    for (let i = 0; i < 2 && !stillToRace(club, slug, date, now); i++) {
        date = addDays(date, 7);
    }
    return date;
}


// The team's nearest race still to race, existing or by its rhythm (races spec §4: the default race
// of a new plan, the race the team's view is about), 'YYYY-MM-DD' in the club's zone: the earlier of
// its earliest race still to race (racesOf) and rhythmDate. Either may be missing; null without
// both (a special team with no race ahead).
export function nextRaceDate(club, slug, now) {
    const team = typeof slug === 'string' && Object.hasOwn(club.teams, slug) ? club.teams[slug] : null;
    const race = team === null ? null : racesOf(club, slug).map(([date]) => date).find(date => isDate(date) && stillToRace(club, slug, date, now)) ?? null;
    const rhythm = rhythmDate(club, slug, now);
    if (race === null || rhythm === null) {
        return race ?? rhythm;
    }
    return race < rhythm ? race : rhythm;
}


export function usedUp(S, now) {
    return now > S + USED_UP_MS;
}


// The gate: true from S - PLAN_OPEN_MS on. False without an S.
export function planOpen(S, now) {
    return S != null && now >= S - PLAN_OPEN_MS;
}


export function roleIn(sheet, athleteId) {
    const json = sheet.json || {};
    if (json.riders && Object.hasOwn(json.riders, athleteId)) {
        return 'rider';
    }
    if (json.roster && Object.hasOwn(json.roster, athleteId)) {
        return 'bench';
    }
    return null;
}


// A race's pinned event id (its event link) matches only itself. Otherwise its learned id within
// ±4 h, or the window.
export function matchesEvent(race, S, {E, eventId}) {
    if (race.pinnedEventId != null) {
        return eventId === race.pinnedEventId;
    }
    return (race.eventId != null && race.eventId === eventId && Math.abs(S - E) <= LEARNED_MS) ||
        (E - MATCH_BEFORE_MS <= S && S <= E + MATCH_AFTER_MS);
}


// Every race's live version that has a planned start and is not used up (races spec §3), team by
// team, each team's races by date: [{slug, id, sheet, S, race}].
export function servable(club, now) {
    const out = [];
    for (const slug of Object.keys(club.teams)) {
        for (const [, race] of racesOf(club, slug)) {
            const id = race.live;
            if (typeof id !== 'string' || !Object.hasOwn(club.sheets, id)) {
                continue;
            }
            const sheet = club.sheets[id];
            const S = plannedStart(club, sheet);
            if (S !== null && !usedUp(S, now)) {
                out.push({slug, id, sheet, S, race});
            }
        }
    }
    return out;
}


// Precedence among one date's listings: a rider listing beats a bench listing, then the newest
// upload, then the lower slug. True when a beats b.
export function better(a, b) {
    if (a.role !== b.role) {
        return a.role === 'rider';
    }
    const ta = Date.parse(a.uploadedAt) || 0;
    const tb = Date.parse(b.uploadedAt) || 0;
    if (ta !== tb) {
        return ta > tb;
    }
    return a.slug < b.slug;
}


// Inside an event: the date of the matching listing whose S is closest to E; on equal distance,
// the later S. Null when nothing matches.
export function closestDate(matching, E) {
    let best = null;
    for (const c of matching) {
        const d = Math.abs(c.S - E);
        const bd = best && Math.abs(best.S - E);
        if (!best || d < bd || (d === bd && c.S > best.S)) {
            best = c;
        }
    }
    return best ? best.sheet.date : null;
}


// Outside events: the date of the earliest upcoming race (the smallest unused S).
function earliestDate(listings) {
    let best = null;
    for (const c of listings) {
        if (!best || c.S < best.S) {
            best = c;
        }
    }
    return best ? best.sheet.date : null;
}


function winner(listings) {
    return listings.reduce((a, b) => (better(b, a) ? b : a));
}


// The one sheet a rider gets from this club, or null: the date first, then precedence, then
// (in an event) the winner's race must match the event. {slug, id, sheet, S, role, race}.
export function pickForRider(club, athleteId, {now, E = null, eventId = null}) {
    const listings = [];
    for (const c of servable(club, now)) {
        const role = roleIn(c.sheet, athleteId);
        if (role) {
            listings.push({...c, role, uploadedAt: c.sheet.uploadedAt});
        }
    }
    const inEvent = E !== null;
    const date = inEvent ?
        closestDate(listings.filter(c => matchesEvent(c.race, c.S, {E, eventId})), E) :
        earliestDate(listings);
    if (date === null) {
        return null;
    }
    const w = winner(listings.filter(c => c.sheet.date === date));
    if (inEvent && !matchesEvent(w.race, w.S, {E, eventId})) {
        return null;
    }
    return {slug: w.slug, id: w.id, sheet: w.sheet, S: w.S, role: w.role, race: w.race};
}


// Every listed athlete's pick among the servable sheets of one date.
export function datePicks(club, date, now) {
    const picks = new Map();
    for (const c of servable(club, now)) {
        if (c.sheet.date !== date) {
            continue;
        }
        const json = c.sheet.json || {};
        const ids = new Set([...Object.keys(json.riders || {}), ...Object.keys(json.roster || {})]);
        for (const athleteId of ids) {
            const cand = {slug: c.slug, id: c.id, role: roleIn(c.sheet, athleteId), uploadedAt: c.sheet.uploadedAt};
            const cur = picks.get(athleteId);
            if (!cur || better(cand, cur)) {
                picks.set(athleteId, cand);
            }
        }
    }
    return picks;
}


function riderName(sheet, athleteId) {
    const json = sheet.json || {};
    const entry = json.riders && Object.hasOwn(json.riders, athleteId) ? json.riders[athleteId] :
        json.roster && Object.hasOwn(json.roster, athleteId) ? json.roster[athleteId] : null;
    const name = entry ? decodeEntities(entry.name).trim() : '';
    return name || athleteId;
}


// Rider listings on servable sheets of this date whose pick is another team.
function holesOf(club, date, now, picks) {
    const holes = [];
    for (const c of servable(club, now)) {
        if (c.sheet.date !== date) {
            continue;
        }
        for (const athleteId of Object.keys(c.sheet.json?.riders || {})) {
            const pick = picks.get(athleteId);
            if (pick && pick.slug !== c.slug) {
                holes.push({slug: c.slug, id: athleteId, name: riderName(c.sheet, athleteId), rides: pick.slug});
            }
        }
    }
    return holes;
}


// What a change does on one date: riders whose pick moved to another team, and live sheets that
// still list a rider who now rides elsewhere.
export function effects(before, after, date, now) {
    const was = datePicks(before, date, now);
    const is = datePicks(after, date, now);
    const moves = [];
    for (const [athleteId, pick] of is) {
        const old = was.get(athleteId);
        if (old && old.slug !== pick.slug) {
            moves.push({id: athleteId, name: riderName(after.sheets[pick.id], athleteId), from: old.slug, to: pick.slug});
        }
    }
    return {moves, holes: holesOf(after, date, now, is)};
}


// The newest version of each of the team's plans, unless its race's live pointer names it, when it
// lists a rider whose pick on that version's date is another team. Only versions with at least one
// such rider are in the map. (Written out here: plans.mjs imports this module.)
export function outdated(club, slug, now) {
    const out = new Map();
    if (!Object.hasOwn(club.teams, slug)) {
        return out;
    }
    const newest = new Map();
    for (const [id, sheet] of Object.entries(club.sheets)) {
        if (sheet.team !== slug) {
            continue;
        }
        const cur = newest.get(sheet.plan);
        if (!cur || sheet.n > cur[1].n) {
            newest.set(sheet.plan, [id, sheet]);
        }
    }
    const byDate = new Map();
    for (const [id, sheet] of newest.values()) {
        if (id === raceOf(club, slug, sheet.date)?.live) {
            continue;
        }
        if (!byDate.has(sheet.date)) {
            byDate.set(sheet.date, datePicks(club, sheet.date, now));
        }
        const picks = byDate.get(sheet.date);
        const marks = [];
        for (const athleteId of Object.keys(sheet.json?.riders || {})) {
            const pick = picks.get(athleteId);
            if (pick && pick.slug !== slug) {
                marks.push({id: athleteId, name: riderName(sheet, athleteId), rides: pick.slug});
            }
        }
        if (marks.length) {
            out.set(id, marks);
        }
    }
    return out;
}
