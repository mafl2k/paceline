// select.mjs as 0.3 ran it (59de4b2), frozen: the oracle of the races equivalence test. Never edit.
// The one selection function (spec §3): which of a club's sheets a rider gets, in and outside a
// Zwift event, and what a change does to the other riders. Pure: the clock is always passed in.
import {zonedToUtc, isDate, HHMM_RE, localDate, addDays} from '../time.mjs';
import {decodeEntities} from '../../pages/src/engine/plan.mjs';

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


// A special team's race start on `date` ('HH:MM'), from team.raceStarts, or null. The newest Store
// for a date sets it (user, 19 Nov 2026: the time belongs to the race, team and date, and the
// newest upload wins).
export function storedRaceStart(team, date) {
    const starts = team?.raceStarts;
    if (starts === null || typeof starts !== 'object' || typeof date !== 'string' || !Object.hasOwn(starts, date)) {
        return null;
    }
    return validStart(starts[date]) ? starts[date] : null;
}


// The local start time 'HH:MM' of a sheet (a stored version, or {team, date}): a special team races
// at the start stored for the sheet's date (team.raceStarts, "special has no fixed times at all"),
// else at the team's start time (plans stored by 0.3.0); a weekly team (any kind but 'special')
// always at the team's. Null without a team or a time.
export function startOf(club, sheet) {
    const team = Object.hasOwn(club.teams, sheet.team) ? club.teams[sheet.team] : null;
    if (!team) {
        return null;
    }
    const own = team.kind === 'special' ? storedRaceStart(team, sheet.date) : null;
    return own ?? (validStart(team.start) ? team.start : null);
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


// A weekday 1-7 (Monday = 1, ISO), or false.
const isWeekday = d => Number.isInteger(d) && d >= 1 && d <= 7;

// The ISO weekday of a 'YYYY-MM-DD' (Monday = 1 … Sunday = 7).
const weekdayOf = date => new Date(`${date}T12:00:00Z`).getUTCDay() || 7;


// The weekday a weekly team races on (plan versions spec §4.1, user 17 Nov 2026): the team's own,
// else the club's, else Thursday (4). Only 1-7 counts; an unknown team has the club's.
export function teamWeekday(club, slug) {
    const team = typeof slug === 'string' && Object.hasOwn(club.teams, slug) ? club.teams[slug] : null;
    if (team !== null && isWeekday(team.weekday)) {
        return team.weekday;
    }
    return isWeekday(club.weekday) ? club.weekday : 4;
}


// True while team `slug`'s race on `date` is still to race: until its S (raceStartAt) +
// STILL_TO_RACE_MS; without a start time, while `date` is today or later in the club's zone.
export function stillToRace(club, slug, date, now) {
    const S = raceStartAt(club, slug, date);
    return S === null ? date >= localDate(now, club.tz) : now <= S + STILL_TO_RACE_MS;
}


// The team's next race day, 'YYYY-MM-DD' in the club's zone, or null (plan versions spec §6.5,
// decision 11): the default date of an upload. A date is still to race until its
// S + STILL_TO_RACE_MS; for a team without a start time, today and later dates are. The first that
// applies:
// 1. the date of the team's live plan, if still to race (every kind; a correction sent mid-race
//    lands on today's race, one sent on Monday for a Saturday race on Saturday);
// 2. a weekly team (any kind but 'special', and an unknown team): the first date from yesterday on
//    with its weekday (teamWeekday) that is still to race; yesterday covers a late start that is
//    still racing after midnight;
// 3. a special team: the newest date of its stored plans that is still to race;
// 4. null. Past dates are never read.
export function nextRaceDate(club, slug, now) {
    const today = localDate(now, club.tz);
    const team = typeof slug === 'string' && Object.hasOwn(club.teams, slug) ? club.teams[slug] : null;
    const ahead = date => stillToRace(club, slug, date, now);
    const live = team?.live;
    if (typeof live === 'string' && Object.hasOwn(club.sheets, live) && isDate(club.sheets[live].date)
        && ahead(club.sheets[live].date)) {
        return club.sheets[live].date;
    }
    if (team === null || team.kind !== 'special') {
        const from = addDays(today, -1);
        let date = addDays(from, (teamWeekday(club, slug) - weekdayOf(from) + 7) % 7);
        // yesterday or today after its S + 2 h: a week on (a later date is always still to race)
        for (let i = 0; i < 2 && !ahead(date); i++) {
            date = addDays(date, 7);
        }
        return date;
    }
    let newest = null;
    for (const sheet of Object.values(club.sheets)) {
        if (sheet.team === slug && isDate(sheet.date) && (newest === null || sheet.date > newest) && ahead(sheet.date)) {
            newest = sheet.date;
        }
    }
    return newest;
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


// A pinned event id matches only itself. Otherwise a learned id within ±4 h, or the window.
export function matchesEvent(sheet, S, {E, eventId}) {
    if (sheet.pinnedEventId != null) {
        return eventId === sheet.pinnedEventId;
    }
    return (sheet.eventId != null && sheet.eventId === eventId && Math.abs(S - E) <= LEARNED_MS) ||
        (E - MATCH_BEFORE_MS <= S && S <= E + MATCH_AFTER_MS);
}


// Each team's live sheet that has a planned start and is not used up.
export function servable(club, now) {
    const out = [];
    for (const [slug, team] of Object.entries(club.teams)) {
        const id = team.live;
        if (typeof id !== 'string' || !Object.hasOwn(club.sheets, id)) {
            continue;
        }
        const sheet = club.sheets[id];
        const S = plannedStart(club, sheet);
        if (S !== null && !usedUp(S, now)) {
            out.push({slug, id, sheet, S});
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
// (in an event) the winner must match the event.
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
        closestDate(listings.filter(c => matchesEvent(c.sheet, c.S, {E, eventId})), E) :
        earliestDate(listings);
    if (date === null) {
        return null;
    }
    const w = winner(listings.filter(c => c.sheet.date === date));
    if (inEvent && !matchesEvent(w.sheet, w.S, {E, eventId})) {
        return null;
    }
    return {slug: w.slug, id: w.id, sheet: w.sheet, S: w.S, role: w.role};
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


// The newest version of each of the team's plans, unless the live pointer names it, when it lists a
// rider whose pick on that version's date is another team. Only versions with at least one such
// rider are in the map. (Written out here: plans.mjs imports this module.)
export function outdated(club, slug, now) {
    const out = new Map();
    if (!Object.hasOwn(club.teams, slug)) {
        return out;
    }
    const live = club.teams[slug].live;
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
        if (id === live) {
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
