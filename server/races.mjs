// Races (races spec §1): a race is a team and a date ('YYYY-MM-DD' in the club's zone), stored as
// club.teams[slug].races[date] = {start, pinnedEventId, eventId, boundAt, live}. The plans and their
// versions stay in club.sheets; a version's race is its team's race of its date.
//
// The two race invariants (tidyRaces restores them): (1) a team has a race exactly for every date
// (isDate) that has at least one of its versions; (2) race.live is null or the id of a version of
// that team and date.
//
// toRaces converts a club stored by 0.3 (team.live, team.raceStarts, the event fields on every
// version, the club's race day) to races (spec §4c, §5). Pure: it changes the club it is given and
// reads no clock.
import {isDate, isWeekday, HHMM_RE} from './time.mjs';

const EVENT_FIELDS = ['pinnedEventId', 'eventId', 'boundAt'];

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const clubShaped = club => isObject(club) && isObject(club.teams) && isObject(club.sheets);


export const emptyRace = () => ({start: null, pinnedEventId: null, eventId: null, boundAt: null, live: null});


// The team's races object, or null (no such team, own keys only; not converted yet).
function racesObject(club, slug) {
    if (!isObject(club) || !isObject(club.teams) || typeof slug !== 'string' || !Object.hasOwn(club.teams, slug)) {
        return null;
    }
    const team = club.teams[slug];
    return isObject(team) && isObject(team.races) ? team.races : null;
}


// The race of team `slug` on `date`, or null. Own keys only.
export function raceOf(club, slug, date) {
    const races = racesObject(club, slug);
    if (races === null || typeof date !== 'string' || !Object.hasOwn(races, date)) {
        return null;
    }
    return isObject(races[date]) ? races[date] : null;
}


export function raceOfSheet(club, sheet) {
    return raceOf(club, sheet?.team, sheet?.date);
}


// [[date, race], …] of team `slug`, by date ascending; [] for an unknown team.
export function racesOf(club, slug) {
    const races = racesObject(club, slug);
    if (races === null) {
        return [];
    }
    return Object.entries(races).filter(([, r]) => isObject(r)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}


// {slug: {date: Set of version ids}} of the versions with a date (isDate); entries that are no
// object are skipped.
function datedVersions(club) {
    const out = new Map();
    for (const [id, sheet] of Object.entries(club.sheets)) {
        if (!isObject(sheet) || typeof sheet.team !== 'string' || !isDate(sheet.date)) {
            continue;
        }
        if (!out.has(sheet.team)) {
            out.set(sheet.team, new Map());
        }
        const dates = out.get(sheet.team);
        if (!dates.has(sheet.date)) {
            dates.set(sheet.date, new Set());
        }
        dates.get(sheet.date).add(id);
    }
    return out;
}


// Restores the two race invariants for team `slug`, or every team: adds an empty race for a dated
// version without one, deletes a race without a version (or under a key that is no date), makes a
// race that is no object an empty one, and clears a `live` that is not a version of that team and
// date. A team that is no object, or has no races object yet (toRaces converts it), is left alone.
// Returns true when it changed something.
export function tidyRaces(club, slug = null) {
    if (!clubShaped(club)) {
        return false;
    }
    const dated = datedVersions(club);
    let changed = false;
    for (const [s, team] of Object.entries(club.teams)) {
        if ((slug !== null && s !== slug) || !isObject(team) || !isObject(team.races)) {
            continue;
        }
        const dates = dated.get(s) ?? new Map();
        const races = team.races;
        for (const date of Object.keys(races)) {
            if (!dates.has(date)) {
                delete races[date];
                changed = true;
            } else if (!isObject(races[date])) {
                races[date] = emptyRace();
                changed = true;
            } else if (races[date].live !== null && !dates.get(date).has(races[date].live)) {
                races[date].live = null;
                changed = true;
            }
        }
        for (const date of [...dates.keys()].sort()) {
            if (!Object.hasOwn(races, date)) {
                races[date] = emptyRace();
                changed = true;
            }
        }
    }
    return changed;
}


const atOf = sheet => Date.parse(sheet.at) || 0;
const nOf = sheet => (Number.isFinite(sheet.n) ? sheet.n : 0);
const ascending = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// [id, sheet] a after b (> 0), before it (< 0): the later `at` (0 when unreadable), then the higher
// n, then the greater id.
const later = (a, b) => atOf(a[1]) - atOf(b[1]) || nOf(a[1]) - nOf(b[1]) || ascending(a[0], b[0]);


// The newest of [[id, sheet], …] (later).
function newest(versions) {
    return versions.reduce((best, v) => (later(v, best) > 0 ? v : best));
}


// The club's race day goes (races spec §4c): every team that is not special (an object of any kind
// but 'special': select.mjs races it weekly) and has no weekday 1-7 of its own gets the club's
// (1-7), else Thursday (4), so no race day moves; a special team's weekday is left alone. True when
// it changed something.
function ownWeekdays(club) {
    let changed = false;
    const day = isWeekday(club.weekday) ? club.weekday : 4;
    for (const team of Object.values(club.teams)) {
        if (isObject(team) && team.kind !== 'special' && !isWeekday(team.weekday)) {
            team.weekday = day;
            changed = true;
        }
    }
    if (Object.hasOwn(club, 'weekday')) {
        delete club.weekday;
        changed = true;
    }
    return changed;
}


// Converts a club stored by 0.3 to races. Each team without a races object gets a race for every
// date of its versions (isDate): `live` is team.live on its version's date; `start` is
// team.raceStarts[date] for a special team (a valid 'HH:MM'), else null (the team's start); the event
// fields are copied from the live version on its date, else from the newest version of the date
// (a live plan without a link gives a race without one, so no rider's pick changes). Every other
// distinct pinned event id of a version of another plan of that date is dropped (returned, for the
// club log); so is one that a version of the source plan newer than the source carried (a live
// older version won over it: returned with `newer: true`, unless another plan carried it too). One
// only the source plan's older versions carried was replaced there and just goes. team.live,
// team.raceStarts and team.liveBefore go, and the event fields go from every version; then
// tidyRaces. The club's race day goes into its weekly teams (ownWeekdays), races or not. A value
// that is not club-shaped is left alone; so are team and sheet entries that are no object, and the
// versions of a team that is no object. Idempotent. Returns {changed, dropped: [{team, date,
// eventId, newer?}]} (teams in club.teams order, dates and ids ascending).
export function toRaces(club) {
    const dropped = [];
    if (!clubShaped(club)) {
        return {changed: false, dropped};
    }
    let changed = false;
    const badTeams = new Set();
    for (const [slug, team] of Object.entries(club.teams)) {
        if (!isObject(team)) {
            badTeams.add(slug);
            continue;
        }
        if (isObject(team.races)) {
            continue;
        }
        const own = Object.entries(club.sheets).filter(([, s]) => isObject(s) && s.team === slug);
        const byDate = new Map();
        for (const v of own) {
            if (isDate(v[1].date)) {
                if (!byDate.has(v[1].date)) {
                    byDate.set(v[1].date, []);
                }
                byDate.get(v[1].date).push(v);
            }
        }
        const L = typeof team.live === 'string' ? own.find(([id]) => id === team.live) ?? null : null;
        const starts = team.kind === 'special' && isObject(team.raceStarts) ? team.raceStarts : {};
        const races = {};
        for (const date of [...byDate.keys()].sort()) {
            const versions = byDate.get(date);
            const live = L !== null && L[1].date === date ? L : null;
            const source = live ?? newest(versions);
            const start = Object.hasOwn(starts, date) && typeof starts[date] === 'string' && HHMM_RE.test(starts[date]) ? starts[date] : null;
            const race = {
                start,
                pinnedEventId: source[1].pinnedEventId ?? null,
                eventId: source[1].eventId ?? null,
                boundAt: source[1].boundAt ?? null,
                live: live === null ? null : live[0],
            };
            races[date] = race;
            // a link the source plan's own older versions carried was replaced on that plan, not
            // decided by another plan of the race: not dropped; a newer version's was (the live
            // older version won over it)
            const samePlan = s => typeof s.plan === 'string' && s.plan === source[1].plan;
            const links = vs => new Set(vs.map(([, s]) => s.pinnedEventId).filter(id => id != null && id !== race.pinnedEventId));
            const others = links(versions.filter(v => v[0] !== source[0] && !samePlan(v[1])));
            const newer = links(versions.filter(v => v[0] !== source[0] && samePlan(v[1]) && later(v, source) > 0));
            const lost = [...others].map(eventId => ({team: slug, date, eventId}));
            for (const eventId of newer) {
                if (!others.has(eventId)) {
                    lost.push({team: slug, date, eventId, newer: true});
                }
            }
            dropped.push(...lost.sort((a, b) => ascending(a.eventId, b.eventId)));
        }
        team.races = races;
        delete team.live;
        delete team.raceStarts;
        delete team.liveBefore;
        changed = true;
    }
    for (const sheet of Object.values(club.sheets)) {
        if (!isObject(sheet) || (typeof sheet.team === 'string' && badTeams.has(sheet.team))) {
            continue;
        }
        for (const k of EVENT_FIELDS) {
            if (Object.hasOwn(sheet, k)) {
                delete sheet[k];
                changed = true;
            }
        }
    }
    if (tidyRaces(club)) {
        changed = true;
    }
    if (ownWeekdays(club)) {
        changed = true;
    }
    return {changed, dropped};
}

