// Preselection in the team page's Store form (plan versions spec §6.2–§6.4, team cockpit spec §5.4):
// the team, the plan and the other choices for an inbox entry (no Make live box: the form's action
// bar has Make live and Store, user 23 Nov 2026). Pure: the clock
// is always passed in.
import {nameKey, cleanName} from './ids.mjs';
import {localDay, zonedToUtc, isDate} from './time.mjs';
import {nextRaceDate, raceStart, raceOver, rhythmDate, stillToRace} from './select.mjs';
import {plansOf, racePlans, planOfId, planNames, ridersShared, teamTypes, typeKey} from './plans.mjs';
import {normalizePlan} from '../pages/src/engine/plan.mjs';
import {racesOf} from './races.mjs';
import {TYPE_MAX} from './club.mjs';


const teamOf = (club, slug) => (typeof slug === 'string' && Object.hasOwn(club.teams, slug) ? club.teams[slug] : null);

// "Thu 19 Nov" for a date in the club's zone.
const dayOf = (club, date) => localDay(zonedToUtc(date, '12:00', club.tz), club.tz);


// A plan's type as its name suggests it (user, 23 Nov 2026: the new plan's Type field prefilled): the
// name the plan came with (`name`: a ZwiftGopher plan's or upload's team name) without team
// `teamName` at its start (any case; the name must end there or at a separator) and the separators
// after it (space, "·", "-", "–", "—", ":"), trimmed and cut to TYPE_MAX (30) characters; '' for a
// name that is only the team's, for none, and for one the type rules refuse (cleanName).
export function typeFromName(teamName, name) {
    if (typeof name !== 'string') {
        return '';
    }
    let s = name.trim();
    const team = typeof teamName === 'string' ? teamName.trim() : '';
    if (team !== '' && s.toLowerCase().startsWith(team.toLowerCase()) && (s.length === team.length || /^[\s·:\-–—]/u.test(s.slice(team.length)))) {
        s = s.slice(team.length).replace(/^[\s·:\-–—]+/u, '');
    }
    s = [...s.trim()].slice(0, TYPE_MAX).join('').trim();
    return s === '' ? '' : cleanName(s, 1, TYPE_MAX) ?? '';
}


// The entry's riders and bench (Zwift IDs, in plan order) and its planner name key.
export function entryPlan(entry) {
    const {plan} = normalizePlan(entry.json, entry.text);
    const name = entry.json?.team?.name;
    return {
        riders: plan.riders.map(r => r.id),
        bench: plan.bench.map(r => r.id),
        key: typeof name === 'string' ? nameKey(name) : null,
    };
}


// §6.2: the entry's own team while it exists, else the club's only team, else none.
export function pickTeam(club, entry) {
    if (teamOf(club, entry.team)) {
        return entry.team;
    }
    const slugs = Object.keys(club.teams);
    return slugs.length === 1 ? slugs[0] : null;
}


// The plans the Store form and the upload page offer as a version target (racePlans, newest version
// not used up), of races that are not over (pre-flight M9: from S + 2 h a race takes no version,
// plan-used).
export function choicePlans(club, slug, now) {
    return racePlans(club, slug, now).filter(p => !raceOver(club, slug, p.date, now));
}


// The plan of team `slug` that `id` names (by its plan id or any version id) when it is one of
// choicePlans, or null.
function racePlanOf(club, slug, id, now) {
    if (typeof id !== 'string' || !teamOf(club, slug)) {
        return null;
    }
    const plan = planOfId(club, slug, id);
    return plan && choicePlans(club, slug, now).some(p => p.id === plan.id) ? plan : null;
}


// §6.3: a plan id, 'new' or null (the captain picks), the first that applies:
// 1. `forPlan` (a hole's link; the plan ⋯'s "New version" link until 23 Nov 2026), any plan of a race not over (choicePlans);
// 2. the one plan of the race whose planner names hold the entry's (two or more: none);
// 3. 'new' when the race has no plan; else null.
// Riders in common never preselect: a fast and a slow plan share their riders (controller ruling).
// The race is the plans of `date` (the page's race date): a plan for next week, or last race's
// plan within S + 4 h, is not a plan of this race. "Store as" lists the plans of every race ahead
// (controller ruling 23 Nov 2026); the suggestion stays this race's.
export function pickPlan(club, slug, entry, now, date = nextRaceDate(club, slug, now)) {
    const forPlan = racePlanOf(club, slug, entry.forPlan, now);
    if (forPlan) {
        return forPlan.id;
    }
    const plans = choicePlans(club, slug, now).filter(p => p.date === date);
    const {key} = entryPlan(entry);
    const named = key === null ? [] : plans.filter(p => planNames(p).has(key));
    if (named.length === 1) {
        return named[0].id;
    }
    return plans.length === 0 ? 'new' : null;
}


// The date a form means (races spec §4: the race of a new plan): its `date` when that was sent, is
// not empty and differs from `startFor` (the date the page was drawn for: the captain typed one),
// else its `race` radio, else its `date` (an emptied field: '', the page asks for a date); null when
// none was sent. `params` is anything with get(k).
export function chosenDate(params) {
    const date = params.get('date');
    if (date !== null && date !== '' && date !== params.get('startFor')) {
        return date;
    }
    return params.get('race') ?? date;
}


// The start time the Store form's field shows for team `slug`'s race on `date` when nothing was
// typed (user, 22 Nov 2026: prefilled): the race's own start, else the team's (raceStart: for both
// kinds, also without a date); '' without one. Store pins the time posted as the race's own (user,
// 23 Nov 2026, club.mjs storedStart). The page carries it as `startWas`, so a Store can tell a race whose
// start (or a weekly team's time) someone changed since the page was drawn (final review I-2).
export function drawnStart(club, slug, date) {
    return teamOf(club, slug) === null ? '' : raceStart(club, slug, date) ?? '';
}


// The races a new plan of team `slug` can go to (races spec §4 "Which race a new plan goes to"): its
// races still to race and, for a weekly team, its rhythm date also when it has no race yet, by date.
// [{date, day, time: 'HH:MM' | null (raceStart: its own, else the team's), plans: how many it has}].
function raceChoices(club, slug, now) {
    const dates = racesOf(club, slug).map(([date]) => date).filter(date => isDate(date) && stillToRace(club, slug, date, now));
    const rhythm = rhythmDate(club, slug, now);
    if (rhythm !== null && !dates.includes(rhythm)) {
        dates.push(rhythm);
    }
    const plans = plansOf(club, slug);
    return dates.sort().map(date => ({
        date, day: dayOf(club, date), time: raceStart(club, slug, date), plans: plans.filter(p => p.date === date).length,
    }));
}


// The page's race when nothing drawn says otherwise: the race the upload was made for (`forDate`:
// a hole's link; the race ⋯'s "Upload a file for this race" until 23 Nov 2026) while that is the entry's team and the
// race is not over (pre-flight M7), else the team's next race (nextRaceDate); '' without one (a
// special team with nothing ahead, decision 11).
function defaultDate(club, slug, entry, now) {
    const forDate = entry.forDate;
    if (slug !== null && slug === entry.team && isDate(forDate) && !raceOver(club, slug, forDate, now)) {
        return forDate;
    }
    return nextRaceDate(club, slug, now) ?? '';
}


// Everything the Store form chooses for `entry`, from the query `params` (anything with get(k))
// and the preselection. A version takes its plan's race (user, 23 Nov 2026: the form shows the race
// date, the start time and the event link for "New plan" only), so the page's race (`date`) is the
// chosen plan's; for a new plan it is the date the form means (chosenDate) with an unchanged team
// and plan choice (`drawn`), else defaultDate. `plans` lists the plans of every race ahead, nearest
// race first, each with its `date` and `day` (controller ruling 23 Nov 2026). Without a race (a
// special team with nothing ahead) the date is '' and `dateRequired`: the page asks for it in the
// race fold, drawn open (store-form.mjs). `races` (raceChoices) and `raceChoice` (two or more of
// them: the new plan's race fold has a radio per race, races spec §4); `startFor` is the
// page's date. The race's start time
// `start`, for every kind of team: the time sent with an unchanged team and plan choice for this very
// date (`startFor`) while the race still has the start the page was drawn with (`startWas`; none
// sent counts as unchanged), else the race's (drawnStart: its raceStart, its own or the team's, for
// every kind of team: prefilled), else ''. It never carries over from another
// date, nor over a change of the race's start by someone else (final review I-2). `startWas` is
// drawnStart now, for the page to carry. A
// redraw keeps the type when the team and plan choice are the ones drawn (`drawn`); otherwise it
// goes back to its default, unless the script lists it in `touched` (Ruling 6). The event link is
// always kept. `touched` comes back as it was received (only the type), so the page carries it on: also through a refused Store, whose page has no query for the
// script to read it from. `raceOpen`: the form's race fold was open (`raceOpen=1`, kept by the
// script), so the redraw draws it open again (store-form.mjs).
export function assignChoices(club, entry, params, now) {
    const asked = params.get('team');
    const team = teamOf(club, asked) ? asked : pickTeam(club, entry);
    const sentDrawn = params.get('drawn');
    // a choice drawn for another team never carries over, 'new' included (Review Focus 4)
    const otherTeam = sentDrawn !== null && sentDrawn.split(':')[0] !== (team ?? '');
    const sent = otherTeam ? null : params.get('as');
    const sentSame = sentDrawn === `${team ?? ''}:${sent ?? ''}`;
    const fallback = defaultDate(club, team, entry, now);
    // the race a new plan joins (a version's is its plan's: its form sends no date, user 23 Nov 2026);
    // a date sent with a plan that is gone decides the race its preselection looks at
    const chosen = sentSame ? chosenDate(params) : null;
    const race = chosen ?? fallback;
    const startFor = params.get('startFor');
    let as = null;
    if (team !== null) {
        const plan = sent === 'new' ? null : racePlanOf(club, team, sent, now);
        as = sent === 'new' ? 'new' : plan ? plan.id : pickPlan(club, team, entry, now, race);
    }
    const own = as !== null && as !== 'new' ? planOfId(club, team, as) : null;
    const drawn = `${team ?? ''}:${as ?? ''}`;
    const same = params.get('drawn') === drawn;
    const touched = new Set((params.get('touched') ?? '').split(','));
    const keep = field => same || touched.has(field);

    // one date for the plan choice and the page (I-1)
    const date = own !== null ? own.date : race;
    // a new plan's type from the name the plan came with (typeFromName; user, 23 Nov 2026), unless the
    // race has it already (typeFor would refuse it): then none
    const named = own === null && team !== null ? typeFromName(teamOf(club, team).name, entry.json?.team?.name) : '';
    const free = named !== '' && !plansOf(club, team).some(p => p.date === date && p.type !== null && typeKey(p.type) === typeKey(named));
    const type = keep('type') ? params.get('type') ?? '' : own !== null ? own.type ?? '' : free ? named : '';

    const {riders} = entryPlan(entry);
    // every race ahead, nearest first (controller ruling 23 Nov 2026; within a race as racePlans)
    const plans = team === null ? [] : choicePlans(club, team, now).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).map(p => {
        const [, v] = p.newest;
        const {shared} = ridersShared(v, riders);
        return {
            id: p.id, label: p.label, date: p.date, day: dayOf(club, p.date), n: v.n, at: v.at, live: p.live !== null,
            shared, total: riders.length,
        };
    });
    // as typeFor refuses it on Store: another plan of that date without a type
    const typeNeeded = team !== null && plansOf(club, team)
        .some(p => p.date === date && p.type === null && (own === null || p.id !== own.id));

    const special = team !== null && teamOf(club, team).kind === 'special';
    let start = '';
    let startWas = '';
    if (team !== null) {
        startWas = drawnStart(club, team, date);
        // a field drawn with another race start than the race has now (someone changed it since)
        // echoes the old one: it is not kept (final review I-2)
        const sentWas = params.get('startWas');
        const typed = sentSame && startFor === date && (sentWas === null || sentWas === startWas) ? params.get('start') : null;
        start = typed ?? startWas;
    }
    const races = team === null ? [] : raceChoices(club, team, now);

    return {
        team,
        teams: Object.entries(club.teams).map(([slug, t]) => ({slug, name: t.name})),
        as, plans,
        date, dateRequired: own === null && fallback === '', special, start, startWas, type, startFor: date,
        races, raceChoice: races.length >= 2,
        types: team === null ? [] : teamTypes(club, team), typeNeeded,
        event: params.get('event') ?? '', drawn, touched: touched.has('type') ? 'type' : '',
        raceOpen: params.get('raceOpen') === '1',
    };
}
