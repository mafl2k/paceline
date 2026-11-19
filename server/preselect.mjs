// Preselection on the assign page (plan versions spec §6.2–§6.4): the team, the plan, the "Make
// live" box and the other choices for an inbox entry. Pure: the clock is always passed in.
import {nameKey} from './ids.mjs';
import {localDay, zonedToUtc} from './time.mjs';
import {nextRaceDate} from './select.mjs';
import {isUsed, plansOf, racePlans, planOfId, planNames, ridersShared, teamTypes} from './plans.mjs';
import {normalizePlan} from '../pages/src/engine/plan.mjs';


const teamOf = (club, slug) => (typeof slug === 'string' && Object.hasOwn(club.teams, slug) ? club.teams[slug] : null);

// "Thu 19 Nov" for a date in the club's zone.
const dayOf = (club, date) => localDay(zonedToUtc(date, '12:00', club.tz), club.tz);


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


// The race plan of team `slug` that `id` names (by its plan id or any version id), or null.
function racePlanOf(club, slug, id, now) {
    if (typeof id !== 'string' || !teamOf(club, slug)) {
        return null;
    }
    const plan = planOfId(club, slug, id);
    return plan && racePlans(club, slug, now).some(p => p.id === plan.id) ? plan : null;
}


// §6.3: a plan id, 'new' or null (the captain picks), the first that applies:
// 1. `forPlan` (the plan's own "New version" link), any plan not used up;
// 2. the one plan of the race whose planner names hold the entry's (two or more: none);
// 3. 'new' when the race has no plan; else null.
// Riders in common never preselect: a fast and a slow plan share their riders (controller ruling).
// The race is the plans of `date` (the page's race date): a plan for next week, or last race's
// plan within S + 4 h, is not a plan of this race.
export function pickPlan(club, slug, entry, now, date = nextRaceDate(club, slug, now)) {
    const forPlan = racePlanOf(club, slug, entry.forPlan, now);
    if (forPlan) {
        return forPlan.id;
    }
    const plans = racePlans(club, slug, now).filter(p => p.date === date);
    const {key} = entryPlan(entry);
    const named = key === null ? [] : plans.filter(p => planNames(p).has(key));
    if (named.length === 1) {
        return named[0].id;
    }
    return plans.length === 0 ? 'new' : null;
}


// §6.4: the box's default for `as` (a plan by any of its ids, 'new' or null) and, for a new plan,
// its race `date`. {on, kind, vars}; `kind` names the sentence beside the box.
export function liveDefault(club, slug, {as, date}, now) {
    const team = teamOf(club, slug);
    const own = as === 'new' ? null : team ? planOfId(club, slug, as) : null;
    if (!team || (as !== 'new' && own === null)) {
        return {on: false, kind: 'pick', vars: {}};
    }
    const liveId = team.live;
    const live = typeof liveId === 'string' && Object.hasOwn(club.sheets, liveId) ? club.sheets[liveId] : null;
    if (live === null || isUsed(club, live, now)) {
        return {on: true, kind: 'none', vars: {team: team.name}};
    }
    if (own !== null && own.live !== null) {
        return {on: true, kind: 'live-plan', vars: {n: own.newest[1].n + 1, ln: live.n}};
    }
    if (live.date !== (own !== null ? own.date : date)) {
        return {on: false, kind: 'other-race', vars: {label: live.label, day: dayOf(club, live.date)}};
    }
    return {on: false, kind: own !== null ? 'other-plan' : 'new-plan', vars: {label: live.label, ln: live.n}};
}


// Everything the assign page chooses for `entry`, from the query `params` (anything with get(k))
// and the preselection. A new plan's date defaults to the team's next race; without one (a special
// team with nothing ahead) it is '' and `dateRequired`: the page asks for it outside the fold. A
// redraw keeps the box, the type and the date when the team and plan choice are the ones drawn
// (`drawn`); otherwise they go back to their defaults, except the fields the script lists in
// `touched` (Ruling 6). The event link is always kept. `touched` comes back as it was received
// (only type and live, sorted), so the page carries it on: also through a refused Store, whose page
// has no query for the script to read it from.
export function assignChoices(club, entry, params, now) {
    const asked = params.get('team');
    const team = teamOf(club, asked) ? asked : pickTeam(club, entry);
    const sentDrawn = params.get('drawn');
    // a choice drawn for another team never carries over, 'new' included (Review Focus 4)
    const otherTeam = sentDrawn !== null && sentDrawn.split(':')[0] !== (team ?? '');
    const sent = otherTeam ? null : params.get('as');
    // the page's race: the date sent with an unchanged team and plan choice, else the next race;
    // none ('') for a special team without one (decision 11)
    const sentSame = sentDrawn === `${team ?? ''}:${sent ?? ''}`;
    const next = nextRaceDate(club, team, now) ?? '';
    const race = sentSame && params.get('date') !== null ? params.get('date') : next;
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
    const def = liveDefault(club, team, {as, date}, now);
    // no plan chosen: the box is off, whatever was sent (spec §6.3)
    const live = as === null ? false : keep('live') ? params.get('live') === 'on' : def.on;
    const type = keep('type') ? params.get('type') ?? '' : own !== null ? own.type ?? '' : '';

    const {riders} = entryPlan(entry);
    const plans = team === null ? [] : racePlans(club, team, now).map(p => {
        const [, v] = p.newest;
        const {shared} = ridersShared(v, riders);
        return {
            id: p.id, label: p.label, day: dayOf(club, p.date), n: v.n, at: v.at, live: p.live !== null,
            shared, total: riders.length,
        };
    });
    // as typeFor refuses it on Store: another plan of that date without a type
    const typeNeeded = team !== null && plansOf(club, team)
        .some(p => p.date === date && p.type === null && (own === null || p.id !== own.id));

    return {
        team,
        teams: Object.entries(club.teams).map(([slug, t]) => ({slug, name: t.name})),
        as, plans, live, liveKind: def.kind, liveVars: def.vars,
        date, dateFixed: own !== null, dateRequired: own === null && next === '', type,
        types: team === null ? [] : teamTypes(club, team), typeNeeded,
        event: params.get('event') ?? '', drawn, touched: ['live', 'type'].filter(f => touched.has(f)).join(','),
    };
}
