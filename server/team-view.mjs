// The team view (spec §5.4): one pure model of a team's state, drawn by the picker, the switcher,
// the team page; a view per race (raceView, races spec §4b: the team's own view
// is its nearest race's, with every race ahead and the races that are over). Order (by start time), the status line and the worst state
// (red: riders get nothing; amber: check; grey: before the gate; green: all riders have the plan),
// the notes counted as "N to fix", each rider's state after the gate (none is recorded before it),
// riders-only counts, an inbox entry's riders in words, the pull target in W/kg, the live version
// and a newer version that is not live, one row per plan of this race in a fixed order, Make live in
// words, and what a start time would do for a team
// without one. Pure: it reads the
// club and the checks (store.seenOf) it is given, and the clock is passed in. Plain text: the pages
// escape it.
import {t, andList} from './pages.mjs';
import {pullTarget} from './diff.mjs';
import {
    servable, datePicks, effects, outdated, plannedStart, raceStart, raceStartAt, raceTime, planOpen, nextRaceDate, rhythmDate, raceOver, stillToRace, usedUp,
    PLAN_OPEN_MS, USED_UP_MS,
} from './select.mjs';
import {isUsed, receivedFor, plannerName, isShare} from './club.mjs';
import {planOfId, plansOf, racePlans} from './plans.mjs';
import {raceOf, racesOf, raceOfSheet} from './races.mjs';
import {localHHMM, localLabel, localDate, localDay, zonedToUtc, isDate, addDays} from './time.mjs';
import {normalizePlan} from '../pages/src/engine/plan.mjs';

const MIN_MS = 60000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MIN = 24 * 60;
const FOLD_DAYS = 14;    // a special team with nothing in this many days folds on the picker
// The team pages reload themselves every 30 s from 90 min before to 60 min after any live plan's
// S (spec §5). Outside that window a team page with plans from ZwiftGopher waiting reloads every
// WAITING_REFRESH_S (coordinator, 19 Nov 2026), so a new plan shows by itself.
export const WAITING_REFRESH_S = 60;
export const REFRESH_BEFORE_MS = 90 * MIN_MS;
export const REFRESH_AFTER_MS = 60 * MIN_MS;
// A check inside an event counts for this race from S - 2 h on ("in pen"); the server records
// inEvent only from the resolved sheet's S - PLAN_OPEN_MS (api.mjs), so for a check resolved to
// this team this only keeps an earlier race's check out.
export const PEN_FROM_MS = 2 * HOUR_MS;
// The pin mismatch counts checks up to S + 4 h (when the sheet is used up).
export const PIN_UNTIL_MS = 4 * HOUR_MS;

export const SEV = {ok: 0, neutral: 1, warn: 2, err: 3};
// The icon of a team whose worst state is not its status line's.
const SEV_ICON = {ok: 'checkCircle', neutral: 'users', warn: 'alert', err: 'x'};


export function worst(sevs) {
    return sevs.reduce((a, b) => (SEV[b] > SEV[a] ? b : a), 'ok');
}


// andList and pullTarget live in pages.mjs and diff.mjs; the pages keep importing them from here.
export {andList, pullTarget};


// A label as the pages quote it: 'Rollers A'.
export const quote = s => `'${s}'`;


const atOf = entry => Date.parse(entry?.at);

export const nameOf = (club, slug) => (Object.hasOwn(club.teams, slug) ? club.teams[slug].name : slug);

// A 'YYYY-MM-DD' race date as 'Thu 19 Nov' (noon in the club's zone is always that day).
export const dateDay = (date, tz) => (isDate(date) ? localDay(zonedToUtc(date, '12:00', tz), tz) : String(date ?? ''));

// The riders of an inbox entry in words: "8 riders (Ben, Cleo …)", "2 riders (Ben, Cleo)", "1 rider
// (Ben)": the first two names in ride order. The JSON's name never shows.
export function ridersLine(entry) {
    const {riders} = normalizePlan(entry.json, entry.text).plan;
    const two = riders.slice(0, 2).map(r => r.name).join(', ');
    const names = riders.length > 2 ? t('tv-riders-more', {names: two}) : two;
    return riders.length === 1 ? t('tv-riders-line-one', {names}) : t('tv-riders-line', {n: riders.length, names});
}

// When a version was made (`at`), as the pages show it: an old Restore copy reads as the time of the
// Restore, not of the upload it copies (its uploadedAt, which stays the precedence time). Null without one.
const madeLabel = (sheet, now, tz) => {
    const at = Date.parse(sheet.at);
    return Number.isFinite(at) ? atLabel(at, now, tz) : null;
};


// The riders in ride order. The planner's roster (the club's rider pool, not this race's) is left
// out: the captain pages never show it. A stored sheet always has riders; a damaged one shows none
// instead of breaking the page.
function planOf(sheet) {
    try {
        return {riders: normalizePlan(sheet.json, sheet.text).plan.riders};
    } catch {
        return {riders: []};
    }
}


// The team of the sheet a check resolved to (seen.sheet, api.mjs), or null. A check counts for a
// team only when it resolved to that team: a rider moved to another team checks from that team's
// event and is not in this team's pen. A rider in the wrong event is still stored with this team's
// sheet (the in-event pick fails, the outside pick stays), so a real pin mismatch still counts.
export const teamOfCheck = (club, entry) => (typeof entry?.sheet === 'string' && Object.hasOwn(club.sheets, entry.sheet)
    ? club.sheets[entry.sheet].team : null);

// In this team's pen: a check resolved to this team, inside an event, from S - 2 h on.
export const inPen = (club, slug, entry, S) => Boolean(entry?.inEvent) && teamOfCheck(club, entry) === slug
    && S !== null && atOf(entry) >= S - PEN_FROM_MS;

// A check in another event than the race's link (F27): not "in pen", it counts for the pin mismatch.
// `race` is the race of the checked plan (races.mjs), or null.
export const otherEvent = (entry, race) => race?.pinnedEventId != null && entry.event != null && entry.event !== race.pinnedEventId;

// By start time, then by name, then slug; never by status. A weekly team's start time is the
// team's; a special team's is that of its first race ahead (nextRaceDate, with `now`). Teams
// without one last: weekly ones, then special ones.
export function teamOrder(club, now) {
    const keyOf = slug => {
        const team = club.teams[slug];
        if (team.kind !== 'special') {
            return {group: team.start == null ? 1 : 0, time: team.start ?? ''};
        }
        const date = nextRaceDate(club, slug, now);
        const time = date === null || raceStartAt(club, slug, date) === null ? null : raceStart(club, slug, date);
        return {group: time === null ? 2 : 0, time: time ?? ''};
    };
    const keys = new Map(Object.keys(club.teams).map(s => [s, keyOf(s)]));
    return Object.keys(club.teams).sort((a, b) => {
        const ka = keys.get(a);
        const kb = keys.get(b);
        if (ka.group !== kb.group) {
            return ka.group - kb.group;
        }
        if (ka.time !== kb.time) {
            return ka.time < kb.time ? -1 : 1;
        }
        const na = String(club.teams[a].name);
        const nb = String(club.teams[b].name);
        return na < nb ? -1 : na > nb ? 1 : (a < b ? -1 : 1);
    });
}


// The teams the picker folds into "Other teams" (plan versions spec §9, decision 11): the special
// teams with no race still to race that has a live plan, and no stored plan dated from today to
// today + 14 days. Weekly teams (any kind but 'special') never fold.
export function foldedTeams(club, now) {
    const today = localDate(now, club.tz);
    const last = addDays(today, FOLD_DAYS);
    const folded = new Set();
    for (const [slug, team] of Object.entries(club.teams)) {
        if (team.kind !== 'special') {
            continue;
        }
        const racing = racesOf(club, slug).some(([date, r]) => typeof r.live === 'string' && Object.hasOwn(club.sheets, r.live)
            && isDate(date) && stillToRace(club, slug, date, now));
        const soon = Object.values(club.sheets).some(sh => sh.team === slug && isDate(sh.date) && sh.date >= today && sh.date <= last);
        if (!racing && !soon) {
            folded.add(slug);
        }
    }
    return folded;
}


// True from 90 min before to 60 min after any live plan's S: the team pages reload every 30 s.
// The upload pages never do (a form or the result's warnings would be wiped).
export function refreshDue(club, now) {
    return servable(club, now).some(c => now >= c.S - REFRESH_BEFORE_MS && now <= c.S + REFRESH_AFTER_MS);
}


// "in 18 min", "in 1 h 3 min", "in 2 days"; "started" up to S + USED_UP_MS, then "raced".
export function untilLabel(S, now) {
    if (now >= S) {
        return t(now <= S + USED_UP_MS ? 'tv-started' : 'tv-raced');
    }
    const min = Math.ceil((S - now) / MIN_MS);
    if (min < 60) {
        return t('tv-until-min', {n: min});
    }
    if (min < DAY_MIN) {
        const h = Math.floor(min / 60);
        return min % 60 ? t('tv-until-h-min', {h, min: min % 60}) : t('tv-until-h', {h});
    }
    const days = Math.round(min / DAY_MIN);
    return days === 1 ? t('tv-until-day') : t('tv-until-days', {n: days});
}


// '18:50' on the day of `now`, else 'Thu 12 Nov 17:40'.
export function atLabel(ms, now, tz) {
    return localDate(ms, tz) === localDate(now, tz) ? localHHMM(ms, tz) : localLabel(ms, tz);
}


// The race dates of team `slug` (races spec §4): `ahead` the races still to race by date, the
// nearest first; `over` the races that are over (raceOver: from S + 2 h), the newest first;
// `regular` a weekly team's next rhythm date (rhythmDate) when it has no race ahead, else null. The
// regular race day is no race of its own (spec §8, user 21 Nov 2026): only the default date of an
// upload (nextRaceDate) and, without a race ahead, the team page's neutral "Next regular race".
export function raceDates(club, slug, now) {
    const ahead = [];
    const over = [];
    for (const [date] of racesOf(club, slug)) {
        if (isDate(date)) {
            (raceOver(club, slug, date, now) ? over : ahead).push(date);
        }
    }
    return {ahead, over: over.reverse(), regular: ahead.length ? null : rhythmDate(club, slug, now)};
}


// The live version of team `slug`'s race on `date` while it is not used up (isUsed: 4 h after S;
// without a start time once the date has passed): {slug, id, sheet, S, race}, S null without a start
// time (nothing is sent). Null without one.
function raceLive(club, slug, date, now) {
    const race = date === null ? null : raceOf(club, slug, date);
    const id = race?.live;
    if (typeof id !== 'string' || !Object.hasOwn(club.sheets, id)) {
        return null;
    }
    const sheet = club.sheets[id];
    return isUsed(club, sheet, now) ? null : {slug, id, sheet, S: plannedStart(club, sheet), race};
}


// The smallest S not yet used up among every team's races (the club's next race): the races ahead
// (a team without one: its regular race day, raceDates), and those over but still served (S + 2 h
// to S + 4 h: only with a live plan, which riders still get); null without one.
export function nextRaceAt(club, now) {
    let best = null;
    for (const slug of Object.keys(club.teams)) {
        const {ahead, over, regular} = raceDates(club, slug, now);
        const served = over.filter(date => raceLive(club, slug, date, now) !== null);
        for (const date of [...ahead, ...(regular === null ? [] : [regular]), ...served]) {
            const S = raceStartAt(club, slug, date);
            if (S !== null && now <= S + USED_UP_MS && (best === null || S < best)) {
                best = S;
            }
        }
    }
    return best;
}


// 'Thu 19 Nov': the day of nextRaceAt, or null.
export function nextRace(club, now) {
    const best = nextRaceAt(club, now);
    return best === null ? null : localDay(best, club.tz);
}


const riderStateOf = (kind, sev, text, time = null) => ({kind, sev, text, time});

// One rider's state against the live sheet, the checks in this order. `plans` are the plans of the
// live version's race (plansOf; team cockpit spec §5.6): a code of a version of the live version's
// own plan reads as its n (the highest such n), else a code of another plan's version names that
// plan and n (the one stored last), else the code.
function riderState(club, slug, sheet, S, entry, plans) {
    if (!entry) {
        // a private club records no check of a rider without the code (api.mjs): say it may be that
        // (UI panel, audit S12)
        return riderStateOf('none', 'neutral', t(club.riderCode != null ? 'tv-state-none-code' : 'tv-state-none'));
    }
    const at = atOf(entry);
    const time = Number.isFinite(at) ? localHHMM(at, club.tz) : null;
    if (inPen(club, slug, entry, S)) {
        if (otherEvent(entry, raceOfSheet(club, sheet))) {
            return riderStateOf('other-event', 'err', t('tv-state-other-event', {event: entry.event}), time);
        }
        return entry.sig === sheet.sig ? riderStateOf('has-in-event', 'ok', t('tv-state-has-in-event'))
            : riderStateOf('in-event', 'neutral', t('tv-state-in-event'), time);
    }
    const other = teamOfCheck(club, entry);
    if (other !== null && other !== slug) {
        return riderStateOf('other-team', 'warn', t('tv-state-other-team', {team: nameOf(club, other)}), time);
    }
    if (entry.sig === sheet.sig) {
        return riderStateOf('has', 'ok', t('tv-state-has'));
    }
    if (entry.sig) {
        return riderStateOf('old-code', 'warn', oldCodeText(sheet, entry.sig, plans), time);
    }
    return riderStateOf('checked', 'neutral', t('tv-state-checked', {time: time ?? '–'}));
}


// The words of a code that is not the live sheet's (riderState).
function oldCodeText(sheet, sig, plans) {
    const own = plans.find(p => p.id === sheet.plan)?.versions.filter(([, v]) => v.sig === sig).at(-1);
    if (own) {
        return t('tv-state-old-version', {n: own[1].n, ln: sheet.n});
    }
    const others = plans.filter(p => p.id !== sheet.plan).flatMap(p => p.versions).filter(([, v]) => v.sig === sig);
    const other = others.reduce((best, v) => (best === null || atOf(v[1]) > atOf(best[1]) ? v : best), null);
    return other ? t('tv-state-old-plan', {label: other[1].label, n: other[1].n}) : t('tv-state-old-code', {sig});
}


const isHas = state => state.kind === 'has' || state.kind === 'has-in-event';


// Riders whose in-event check contradicts the live sheet's event link, one note per other event
// (most riders first): in the pen window up to S + 4 h.
function pinNotes(club, slug, {id, sheet, S}, listed, entryOf) {
    const race = raceOfSheet(club, sheet);
    const byEvent = new Map();
    const atLink = [];
    for (const r of listed) {
        const e = entryOf(r);
        const at = atOf(e);
        if (!e?.inEvent || teamOfCheck(club, e) !== slug || !(at >= S - PEN_FROM_MS && at <= S + PIN_UNTIL_MS)) {
            continue;
        }
        if (otherEvent(e, race)) {
            byEvent.set(e.event, [...(byEvent.get(e.event) ?? []), r.name]);
        } else if (e.event === race?.pinnedEventId) {
            atLink.push(r.name);
        }
    }
    const pinned = race?.pinnedEventId;
    return [...byEvent].sort((a, b) => b[1].length - a[1].length || a[0] - b[0]).map(([event, names]) => {
        const one = names.length === 1;
        const list = andList(names);
        const there = !atLink.length ? t('tv-pin-link', {pinned})
            : t(atLink.length === 1 ? 'tv-pin-link-there-one' : 'tv-pin-link-there', {pinned, names: andList(atLink)});
        return {
            sev: 'err', kind: 'pin',
            title: one ? t('tv-pin-title-one') : t('tv-pin-title', {n: names.length}),
            body: `${t(one ? 'tv-pin-in-one' : 'tv-pin-in', {names: list, event})} ${there}`,
            short: t(one ? 'tv-pin-short-one' : 'tv-pin-short', {names: list}),
            after: t('tv-pin-after'),
            event, names, pinned, sheet: id,
            events: [
                {event: pinned, names: atLink, link: true, text: t('tv-pin-event-link', {event: pinned, names: atLink.length ? andList(atLink) : t('tv-nobody')})},
                {event, names, link: false, text: t('tv-pin-event', {event, names: list})},
            ],
        };
    });
}


// Riders on the live sheet whose pick on its date is another team.
function holeNotes(club, slug, sheet, now) {
    const picks = datePicks(club, sheet.date, now);
    return effects(club, club, sheet.date, now).holes.filter(h => h.slug === slug).map(h => {
        const at = Date.parse(picks.get(h.id)?.uploadedAt);
        const since = Number.isFinite(at) ? atLabel(at, now, club.tz) : null;
        const ridesName = nameOf(club, h.rides);
        const title = t('tv-hole-title', {name: h.name, team: ridesName});
        return {
            sev: 'warn', kind: 'hole', title,
            body: since === null ? t('tv-hole-body-no-since', {team: ridesName, name: h.name})
                : t('tv-hole-body', {team: ridesName, name: h.name, since}),
            short: title,
            linkText: t('tv-hole-link', {name: h.name}),
            after: t('tv-hole-after'),
            id: h.id, name: h.name, rides: h.rides, ridesName, since,
        };
    });
}


// For a team without a start time (or a special team's live plan without one): the riders its live
// plan would take from other teams once a start time is set, by team. The latest start (23:59)
// keeps the plan servable whenever its date is today or later, and precedence does not depend on
// S. A rider listing left behind is a hole (effects' holes). A rider who is only in the other
// team's roster leaves none and is no news (the roster is the club's rider pool), so only the
// riders who leave a hole are named, in this plan's ride order; a team they leave no hole in has
// no entry.
function trapOf(club, slug, sheet, listed, now) {
    const withStart = structuredClone(club);
    withStart.teams[slug].start = '23:59';
    const pos = new Map(listed.map((r, i) => [r.id, i]));
    const {moves, holes} = effects(club, withStart, sheet.date, now);
    const byTeam = new Map();
    for (const m of moves) {
        if (m.to === slug) {
            byTeam.set(m.from, [...(byTeam.get(m.from) ?? []), m]);
        }
    }
    const namesOf = list => list.sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0)).map(m => m.name);
    const out = [];
    const special = club.teams[slug].kind === 'special';
    for (const s of teamOrder(club, now).filter(x => byTeam.has(x))) {
        const holed = namesOf(byTeam.get(s).filter(m => holes.some(h => h.slug === s && h.id === m.id)));
        if (!holed.length) {
            continue;
        }
        const teamName = nameOf(club, s);
        out.push({
            team: s, teamName, names: holed,
            text: holed.length === 1 ? t(special ? 'tv-trap-one-special' : 'tv-trap-one', {name: holed[0], team: teamName})
                : t(special ? 'tv-trap-special' : 'tv-trap', {names: andList(holed), team: teamName}),
        });
    }
    return out;
}


// The fixed order of a race's plans (spec §9): the first stored first (by its first version's `at`,
// then the plan id), so a switch moves only the live flag, never a row.
const firstAt = p => Date.parse(p.versions[0][1].at) || 0;
export const byRaceOrder = (a, b) => firstAt(a) - firstAt(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);


// The view of team `slug`'s race on `date` (spec §5.4, races spec §4b; null: nothing ahead, a special
// team without a race). `seen` is store.seenOf(cid): {zwiftId: {at, sig, mod, sheet, inEvent,
// event}}. `date` is the race's date (`raceDate` too); `event` its event: the link {id, pinned:
// true}, else the event learned from a rider's check {id, pinned: false}, else null. `regular`: a
// date without a race (a weekly team's regular race day, raceDates): no race, never an alarm (spec
// §8), only the neutral "Next regular race".
export function raceView(club, slug, date, {now, seen = {}}) {
    const team = club.teams[slug];
    const tz = club.tz;
    const lv = raceLive(club, slug, date, now);
    const S = date === null ? null : raceStartAt(club, slug, date);
    const time = S === null ? null : raceStart(club, slug, date);
    const sheet = lv?.sheet ?? null;
    const sent = lv !== null && lv.S !== null;
    const open = sent && planOpen(S, now);
    const gateAt = S === null ? null : S - PLAN_OPEN_MS;
    const opens = gateAt === null ? null : atLabel(gateAt, now, tz);
    const today = localDate(now, tz);
    let when;
    const raceDate = date;
    if (S === null) {
        // a special team without a race: no day
        when = raceDate === null ? {day: null, time: null, until: null, today: false}
            : {day: dateDay(raceDate, tz), time: null, until: null, today: raceDate === today};
    } else {
        when = {day: localDay(S, tz), time, until: untilLabel(S, now), today: localDate(S, tz) === today};
    }
    const marks = outdated(club, slug, now);
    // stored plans of the race the view is about (the empty card and the none-live status)
    const forRace = racePlans(club, slug, now).some(p => p.date === raceDate);
    const marksOf = id => (marks.get(id) ?? []).map(m => ({id: m.id, name: m.name, rides: m.rides, ridesName: nameOf(club, m.rides)}));
    const livePlan = lv && planOfId(club, slug, lv.id);
    const live = lv && liveCard(club, slug, lv, livePlan, {now, marksOf});

    const plan = sheet ? planOf(sheet) : {riders: []};
    const entryOf = r => (Object.hasOwn(seen, r.id) ? seen[r.id] : null);
    // every plan of the live version's race: a rider may hold any of their versions (spec §5.6)
    const racePlansOf = open ? plansOf(club, slug).filter(p => p.date === sheet.date) : [];
    const stateOf = r => (open ? riderState(club, slug, sheet, S, entryOf(r), racePlansOf) : null);
    // in ride order: the live card draws them in the rider table (cockpit-panel.mjs, a later race's cockpit-page.mjs ridersCard)
    const riders = plan.riders.map((r, i) => ({id: r.id, name: r.name, pos: i + 1, state: stateOf(r)}));
    const count = riders.length;
    const has = open ? riders.filter(r => isHas(r.state)).length : null;

    const regular = raceDate !== null && raceOf(club, slug, raceDate) === null;
    // "No start time" (user, 19 Nov 2026): a race without one, its own or the team's (a weekly
    // team's race may have its own, races spec §1); a special team gets its time with each upload,
    // so only a race with plans but no time at all (plans stored by 0.3.0) has none, live or not
    const special = team.kind === 'special';
    const noStart = special || raceDate !== null ? S === null && raceDate !== null : team.start == null;
    let status;
    if (noStart && regular) {
        // no start time and no plan (a weekly team's regular race day): a setting, no rider is affected
        // yet, so neutral (spec §8, coordinator 21 Nov 2026); a plan whose race has no time is red below
        status = {sev: 'neutral', kind: 'start-unset', icon: 'clock', text: t('tv-start-unset')};
    } else if (noStart) {
        const text = live ? t('tv-no-start-plan') : special ? t('tv-no-start-not-live', {day: when.day}) : t('tv-no-start-none');
        status = {sev: 'err', kind: 'no-start', icon: 'clock', text};
    } else if (!live && when.day === null) {
        // a special team with no race planned: nothing is missing (Task 8b review)
        status = {sev: 'neutral', kind: 'no-race', icon: 'clock', text: t('tp-race-none')};
    } else if (!live && forRace) {
        // plans of this race stored, none live: red at once, at any distance from the race (spec §8,
        // user 21 Nov 2026: a plan stored on Tuesday for Thursday stayed grey and was missed)
        status = {sev: 'err', kind: 'none-live', icon: 'noPlan', text: t('tv-none-live')};
    } else if (!live) {
        // no plan: the regular race day is no race, so nothing is missing (spec §8)
        status = {sev: 'neutral', kind: 'next-race', icon: 'clock', text: t('tv-next-regular', {day: when.day, time: when.time})};
    } else if (!open) {
        status = {sev: 'neutral', kind: 'opens', icon: 'clock', text: count === 1 ? t('tv-opens-one', {opens}) : t('tv-opens', {opens, n: count})};
    } else {
        const all = has === count;
        status = {
            sev: all ? 'ok' : 'neutral', kind: 'count', icon: all ? 'checkCircle' : 'users',
            text: count === 1 ? t('tv-count-one', {has}) : t('tv-count', {has, n: count}),
        };
    }

    // notes only for a plan riders get: the pin mismatch once the plan is open, then the holes
    const notes = [];
    if (sent) {
        if (open && raceOfSheet(club, sheet)?.pinnedEventId != null) {
            notes.push(...pinNotes(club, slug, lv, plan.riders, entryOf));
        }
        notes.push(...holeNotes(club, slug, sheet, now));
    }
    const sev = worst([status.sev, ...notes.map(n => n.sev), ...(open ? riders.map(r => r.state.sev) : [])]);

    // one row per plan of this race (races spec §4) in the fixed order (byRaceOrder): a switch moves
    // only the live flag; the live plan by its live version, every other by its newest
    const plans = racePlans(club, slug, now).filter(p => p.date === raceDate)
        .sort(byRaceOrder)
        .map(p => {
            const [id, s] = p.live !== null ? [p.live, club.sheets[p.live]] : p.newest;
            const {riders: listed} = planOf(s);
            return {
                planId: p.id, id, label: s.label, day: dateDay(s.date, tz), n: s.n, at: madeLabel(s, now, tz), sig: s.sig,
                riders: listed.length, names: listed.slice(0, 3).map(r => r.name), marks: marksOf(id), live: p.live !== null,
            };
        });

    const race = raceDate === null ? null : raceOf(club, slug, raceDate);
    const event = race?.pinnedEventId != null ? {id: race.pinnedEventId, pinned: true}
        : race?.eventId != null ? {id: race.eventId, pinned: false} : null;
    return {
        slug, name: team.name, version: team.version, start: team.start ?? null, special, noStart, regular, raceDate, date: raceDate, event,
        S, gateAt, opens, open, when, live, status, notes, sev,
        icon: sev === status.sev ? status.icon : SEV_ICON[sev],
        riders, has, count, plans, forRace,
        trap: noStart && live ? trapOf(club, slug, sheet, plan.riders, now) : [],
    };
}


// The whole view of one team (spec §5.4; races spec §4b, "mix"): the view of its nearest race
// (raceView of raceDates' first race ahead; without one of its regular race day, a weekly team's,
// else of null), which the picker, the switcher and the tiles show, plus `races` (a view per race
// ahead, nearest first; races[0] is the view's own race; [] without a race ahead),
// `over` (the races that are over, newest first: {date, day, plans: [{planId, label}]}, the plans
// in a race's order) and `received` (the plans waiting from ZwiftGopher).
export function teamView(club, slug, {now, seen = {}}) {
    const {ahead, over, regular} = raceDates(club, slug, now);
    const races = ahead.map(date => raceView(club, slug, date, {now, seen}));
    const view = races[0] ?? raceView(club, slug, regular, {now, seen});
    return {
        ...view, races,
        over: over.map(date => ({
            date, day: dateDay(date, club.tz),
            plans: plansOf(club, slug).filter(p => p.date === date).sort(byRaceOrder).map(p => ({planId: p.id, label: p.label})),
        })),
        received: receivedOf(club, slug, now),
    };
}


// "Plan on ZwiftGopher" (`planner`, push.mjs href, or null) with #t=<share value> (club.mjs shareOf)
// when there is one, so the planner opens with that plan loaded; null stays null. Captain pages only.
export function plannerHref(planner, share) {
    return planner === null ? null : isShare(share) ? `${planner}#t=${share}` : planner;
}


// The share value the team page's planner link carries: that of the team's first race ahead
// (raceDates, the race the page is about): its live version's, else that of the newest version among
// its plans, else null.
export function teamShare(club, slug, now) {
    const date = raceDates(club, slug, now).ahead[0] ?? null;
    const live = raceLive(club, slug, date, now)?.sheet ?? null;
    if (live !== null && isShare(live.zgShare)) {
        return live.zgShare;
    }
    const newest = racePlans(club, slug, now).filter(p => p.date === date).flatMap(p => p.versions.map(([, v]) => v))
        .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))[0];
    return isShare(newest?.zgShare) ? newest.zgShare : null;
}


// An inbox entry as its row shows it: {id, at ('19:42', or the day before it), name (the planner's
// team name in the JSON, or null), riders (the count, riders without the bench), line (ridersLine,
// or the count alone for an entry the engine cannot read)}.
export function entryInfo(club, e, now) {
    const at = Date.parse(e.at);
    let riders = 0;
    let line = null;
    try {
        riders = normalizePlan(e.json, e.text).plan.riders.length;
        line = ridersLine(e);
    } catch {
        // an entry the engine cannot read: its row still offers Review and Discard
    }
    return {id: e.id, at: Number.isFinite(at) ? atLabel(at, now, club.tz) : '–', name: plannerName(e), riders,
        line: line ?? (riders === 1 ? t('tp-riders-one') : t('tp-riders-n', {n: riders}))};
}


// The plans received from ZwiftGopher waiting for the team (club.mjs receivedFor), newest first, as
// entryInfo gives them.
function receivedOf(club, slug, now) {
    return receivedFor(club, slug, now).map(e => entryInfo(club, e, now));
}


// The notice of a newer version that is not live (team cockpit spec §5.6) for the race whose live
// version is `liveId`: the newest version of the live version's own plan (never another plan's: a
// variant kept as a backup must not prompt a Make live), when it is not the live one, was never live
// (no `liveAt`) and was stored at or after the time the live one went live (its `liveAt`; a version
// from before liveAt existed counts from its own `at`). A step back to an older version therefore
// stays quiet. {id, n, at: ISO string} | null.
export function newerNotLive(club, slug, liveId) {
    const p = typeof liveId === 'string' && Object.hasOwn(club.sheets, liveId) ? planOfId(club, slug, liveId) : null;
    if (p === null) {
        return null;
    }
    const [id, newest] = p.newest;
    if (id === liveId || newest.liveAt != null) {
        return null;
    }
    const live = club.sheets[liveId];
    const since = Date.parse(live.liveAt) || Date.parse(live.at) || 0;
    // >=: a version stored in the same millisecond as the Make live counts as after it
    return Date.parse(newest.at) >= since ? {id, n: newest.n, at: newest.at} : null;
}


// The live row's model: the live version (`lv` from raceLive) of plan `p` with its n and the plan's
// newer version when newerNotLive gives one.
function liveCard(club, slug, lv, p, {now, marksOf}) {
    const {sheet} = lv;
    const tz = club.tz;
    const nw = newerNotLive(club, slug, lv.id);
    const race = raceOfSheet(club, sheet);
    return {
        id: lv.id, label: sheet.label, date: sheet.date, day: dateDay(sheet.date, tz), sig: sheet.sig,
        at: madeLabel(sheet, now, tz), pinnedEventId: race?.pinnedEventId ?? null, eventId: race?.eventId ?? null,
        sent: lv.S !== null,
        n: sheet.n, planId: p.id, versions: p.versions.length,
        newer: nw === null ? null : {id: nw.id, n: nw.n, at: madeLabel(club.sheets[nw.id], now, tz), marks: marksOf(nw.id)},
    };
}


// One row of the picker and the switcher.
export function teamRow(view) {
    const {when, status, notes, live} = view;
    // a team with no race planned says so in its status line, with no time line; without a time
    // the day alone
    const timeLine = view.noStart ? t('tv-row-no-start') : when.day === null ? (status.kind === 'no-race' ? '' : t('tp-race-none'))
        : when.time === null ? when.day : t(when.today ? 'tv-row-time' : 'tv-row-day-time', {day: when.day, time: when.time, until: when.until});
    let main;
    let quiet;
    let short;
    if (status.kind === 'no-race') {
        main = status.text;
        quiet = t('tv-row-no-race');
        short = t('tv-short-no-race');
    } else if (status.kind === 'none-live') {
        // plans stored, none live: make one live (red at once, spec §8)
        main = status.text;
        quiet = t('tv-row-none-live');
        short = t('tv-short-none-live');
    } else if (status.kind === 'next-race') {
        // the regular race day without a plan: neutral (spec §8)
        main = status.text;
        quiet = t('tv-row-upload-later');
        short = t('tv-short-next-race');
    } else if (status.kind === 'start-unset') {
        // no start time and no plan: neutral, the start time is still to set (spec §8)
        main = status.text;
        quiet = t('tv-row-neither');
        short = t('tv-short-no-start');
    } else if (status.sev === 'err') {
        // no start time
        main = status.text;
        quiet = live ? t(view.special ? 'tv-row-ready-special' : 'tv-row-ready', {label: live.label})
            : t(view.special ? 'tv-row-special-time' : 'tv-row-neither');
        short = t('tv-short-no-start');
    } else if (notes.length) {
        main = t('tv-row-fix', {n: notes.length, short: notes[0].short});
        quiet = status.text;
        short = t('tv-short-fix', {n: notes.length});
    } else {
        main = status.text;
        quiet = t('tv-row-live', {label: live.label});
        short = view.open ? t('tv-short-count', {has: view.has, n: view.count}) : t('tv-short-opens', {opens: view.opens});
    }
    // plans received from ZwiftGopher: a neutral mark of their own, the status stays as it is
    const n = view.received?.length ?? 0;
    const received = n === 0 ? null : n === 1 ? t('tv-received-one') : t('tv-received', {n});
    return {slug: view.slug, name: view.name, sev: view.sev, icon: view.icon, timeLine, main, quiet, short, ...(received ? {received} : {})};
}


// A copy of a team for a dry run: its races copied too, so a live pointer set on the copy never
// reaches the club.
const teamCopy = team => ({
    ...team, races: Object.fromEntries(Object.entries(team.races ?? {}).map(([date, race]) => [date, {...race}])),
});


// What riders get from a version without a start time: nothing until the team has one; a special
// team's plan stored by 0.3.0 without any never gets one (its time comes with a new plan).
function noStartWords(club, slug, sheet) {
    const team = club.teams[slug];
    return team.kind === 'special' ? t('tp-live-words-no-start-plan', {label: sheet.label}) : t('tp-live-words-no-start', {team: team.name});
}


// What Make live of version `id` does, in words (spec §9), by phase: before the gate "From 19:00,
// riders get 'Rollers · slow' v2 instead of 'Rollers · fast' v5.", after it "Riders in the event get
// … within a minute." (a team without a start time sends nothing, and says so). Live is per race
// (races spec §1): the words name only the plans of the version's own race, never another race's.
// Then the question about its outdated marks, or the riders it moves between teams and the teams it
// leaves with a hole (UI panel wave 2). A question makes the confirm's button "Make live anyway".
// The version's own label: a newer version may carry another type.
export function liveWords(club, slug, id, now) {
    return liveQuestion(club, slug, id, now).words;
}


// Is the gate of `sheet`'s race open: from S - 30 min until the race is used up (never without S).
export function gateOpen(club, sheet, now) {
    const S = plannedStart(club, sheet);
    return S !== null && now >= S - PLAN_OPEN_MS && !usedUp(S, now);
}


// The riders Make live of `id` moves to or from another team and the holes it opens that were not
// there before, on the version's date, from a dry run on a copy of the club (the team with a copy of
// its races; only the version's own race changes): {moves, holes}.
function liveDry(club, slug, id, now) {
    const sheet = club.sheets[id];
    const after = {...club, teams: {...club.teams, [slug]: teamCopy(club.teams[slug])}};
    const race = raceOf(after, slug, sheet.date);
    if (race !== null) {
        race.live = id;
    }
    const key = h => `${h.slug} ${h.id}`;
    const had = new Set(effects(club, club, sheet.date, now).holes.map(key));
    const {moves, holes} = effects(club, after, sheet.date, now);
    return {moves, holes: holes.filter(h => !had.has(key(h)))};
}


// liveWords' words and whether Make live must ask before it acts (UI panel wave 2, the Make live
// rule; the server decides it again on the POST): never for the version that is live already in its
// race; else while the gate is open of that race (from S - 30 min until it is used up), or when the
// words warn: outdated marks, a move, a new hole, no start time. Otherwise it acts at once and
// offers Undo. Only the version's own race counts (races spec §1: the team's other races keep their
// live plans). {words, ask, marks}: `marks` the outdated marks the words ask about (liveConfirmPage
// lists them).
export function liveQuestion(club, slug, id, now) {
    const sheet = club.sheets[id];
    const tz = club.tz;
    // the race's live version while it is not used up
    const lv = raceLive(club, slug, sheet.date, now);
    const S = plannedStart(club, sheet);
    const gate = S === null ? null : S - PLAN_OPEN_MS;
    const v = {label: sheet.label, n: sheet.n, at: gate === null ? null : atLabel(gate, now, tz)};
    let head;
    if (S === null) {
        head = noStartWords(club, slug, sheet);
    } else {
        const open = now >= gate ? '-open' : '';
        head = lv === null || lv.id === id ? t(`tp-live-words-none${open}`, v)
            : t(`tp-live-words${open}`, {...v, live: lv.sheet.label, ln: lv.sheet.n});
    }
    const words = [head];
    const liveId = raceOfSheet(club, sheet)?.live ?? null;
    const {moves, holes} = liveId === id ? {moves: [], holes: []} : liveDry(club, slug, id, now);
    // a rider the switch brings to this team is no outdated mark: the move names him
    const coming = new Set(moves.filter(m => m.to === slug).map(m => m.id));
    const marks = (outdated(club, slug, now).get(id) ?? []).filter(m => !coming.has(m.id));
    // this team's own new holes, for any version (outdated() sees only each plan's newest: an Undo
    // or "Make vN live" of an older version can open one too, review I2), asked about with the marks
    for (const h of holes) {
        if (h.slug === slug && !marks.some(m => m.id === h.id)) {
            marks.push({id: h.id, name: h.name, rides: h.rides});
        }
    }
    words.push(...moves.map(m => `${t('result-move', {name: m.name, from: nameOf(club, m.from), to: nameOf(club, m.to)})}.`));
    const others = [...new Set(holes.filter(h => h.slug !== slug).map(h => h.slug))];
    if (others.length) {
        words.push(`${t('result-holes', {teams: andList(others.map(s => nameOf(club, s)))})}.`);
    }
    if (marks.length) {
        words.push(t(marks.length === 1 ? 'tp-make-live-q-one' : 'tp-make-live-q', {label: sheet.label, n: sheet.n, names: andList(marks.map(m => m.name))}));
    } else if (moves.length || others.length) {
        words.push(t('tp-live-q-anyway'));
    }
    // the race's live version, used up or not (the gate of the plan being replaced)
    const current = typeof liveId === 'string' && Object.hasOwn(club.sheets, liveId) ? club.sheets[liveId] : null;
    const warn = S === null || marks.length > 0 || moves.length > 0 || others.length > 0;
    const open = gateOpen(club, sheet, now) || (current !== null && gateOpen(club, current, now));
    return {words: words.join(' '), ask: liveId !== id && (warn || open), marks};
}


// How long Undo is offered after a Make live that changed the live plan (UI panel wave 2).
export const UNDO_MS = 10 * MIN_MS;


// The Undo of the last change of a live plan of team `slug`, while it is offered: the team's own
// record of it (team.liveBefore, club.mjs makeLive) is of its current version (nothing changed
// since), at most UNDO_MS old, and the version that was live before is still one of the team's.
// Live is per race (races spec §1): the race is that of the version Undo makes live again, and
// `live` that race's live version. {id, prev, live, version}: `prev` the version Undo makes live
// again, `live` the one live now; else null.
export function undoOffer(club, slug, now) {
    const team = Object.hasOwn(club.teams, slug) ? club.teams[slug] : null;
    const u = team?.liveBefore;
    if (u === null || typeof u !== 'object' || typeof u.id !== 'string' || !Object.hasOwn(club.sheets, u.id)) {
        return null;
    }
    const liveId = raceOfSheet(club, club.sheets[u.id])?.live ?? null;
    if (u.version !== team.version || typeof liveId !== 'string' || !Object.hasOwn(club.sheets, liveId)) {
        return null;
    }
    const at = Date.parse(u.at);
    if (!Number.isFinite(at) || now < at || now - at > UNDO_MS) {
        return null;
    }
    if (typeof u.id !== 'string' || u.id === liveId || !Object.hasOwn(club.sheets, u.id) || club.sheets[u.id].team !== slug) {
        return null;
    }
    return {id: u.id, prev: club.sheets[u.id], live: club.sheets[liveId], version: team.version};
}


// Does a change of the start time (or the zone) touch a race within `days` days (S11): a plan of team
// `slug` (of any team with null) that is not used up (also a race still on after midnight, review
// M5) and starts at most `days` days from now; a plan without a start time when its date is from
// today to `days` - 1 days ahead, in the club's zone.
export function raceWithin(club, slug, now, days = 7) {
    const today = localDate(now, club.tz);
    const last = addDays(today, days - 1);
    return Object.values(club.sheets).some(sh => {
        if ((slug !== null && sh.team !== slug) || isUsed(club, sh, now)) {
            return false;
        }
        const S = plannedStart(club, sh);
        return S === null ? sh.date >= today && sh.date <= last : S <= now + days * 24 * HOUR_MS;
    });
}


// What moving team `slug`'s race on `date` to `to` at `start` (as posted: blank is the team's start
// time for a weekly team) does, in words, for the question before the move (races spec §7: a date or
// time change asks first like Make live): the race from and to (its local day and time, the day alone
// without a time) with how many plans move with it; then when riders get the plan for the new start:
// within a minute only while the new start's gate is open (the rider API sends a plan from its S -
// 30 min: an open gate of the old start does not count, its riders lose the plan until the new
// gate), else from the new gate; and that the event learned from riders' checks is forgotten when
// the race has one. Plain text.
export function raceMoveWords(club, slug, date, {to, start}, now) {
    const team = club.teams[slug];
    const tz = club.tz;
    const posted = typeof start === 'string' && start.trim() !== '' ? start.trim() : null;
    const time = raceTime(team, posted);
    const was = raceStartAt(club, slug, date);
    const S = time === null || !isDate(to) ? null : zonedToUtc(to, time, tz);
    const label = (ms, day) => (ms === null ? dateDay(day, tz) : localLabel(ms, tz));
    const n = plansOf(club, slug).filter(p => p.date === date).length;
    const parts = [t(n === 1 ? 'rm-move-words-one' : 'rm-move-words', {from: label(was, date), to: label(S, to), n})];
    if (S !== null) {
        parts.push(planOpen(S, now) && !usedUp(S, now) ? t('rm-move-open') : t('rm-move-later', {at: atLabel(S - PLAN_OPEN_MS, now, tz)}));
    }
    if (raceOf(club, slug, date)?.eventId != null) {
        parts.push(t('rm-move-learned'));
    }
    return parts.join(' ');
}
