// The team view (spec §5.4): one pure model of a team's state, drawn by the picker, the switcher,
// the team page and the assign page. Order (by start time), the status line and the worst state
// (red: riders get nothing; amber: check; grey: before the gate; green: all riders have the plan),
// the notes counted as "N to fix", each rider's state after the gate (none is recorded before it),
// riders-only counts, an inbox entry's riders in words, the pull target in W/kg, the live version
// with what it changed, Back and a newer version that is not live, one row per plan of this race in
// a fixed order, Make live and Back to vN in words, and what a start time would do for a team
// without one. Pure: it reads the
// club and the checks (store.seenOf) it is given, and the clock is passed in. Plain text: the pages
// escape it.
import {t, andList} from './pages.mjs';
import {pullTarget, diffVersions, diffSummary} from './diff.mjs';
import {
    servable, datePicks, effects, outdated, plannedStart, planOpen, nextRaceDate, stillToRace, PLAN_OPEN_MS, USED_UP_MS,
} from './select.mjs';
import {isUsed, backTo, ClubError} from './club.mjs';
import {planOfId, racePlans, previousVersion} from './plans.mjs';
import {localHHMM, localLabel, localDate, localDay, zonedToUtc, isDate, addDays} from './time.mjs';
import {normalizePlan} from '../pages/src/engine/plan.mjs';

const MIN_MS = 60000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MIN = 24 * 60;
const FOLD_DAYS = 14;    // a special team with nothing in this many days folds on the picker
// The team pages reload themselves every 30 s from 90 min before to 60 min after any live plan's
// S (spec §5).
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

// When a version was made (`at`), as the pages show it: a Back copy reads as the time of the Back,
// not of the upload it copies (its uploadedAt, which stays the precedence time). Null without one.
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

// A pinned sheet's check in another event (F27): not "in pen", it counts for the pin mismatch.
export const otherEvent = (entry, sheet) => sheet.pinnedEventId != null && entry.event != null && entry.event !== sheet.pinnedEventId;


// By start time, teams without one last, then by name, then slug. Never by status.
export function teamOrder(club) {
    return Object.keys(club.teams).sort((a, b) => {
        const sa = club.teams[a].start ?? null;
        const sb = club.teams[b].start ?? null;
        if (sa !== sb) {
            return sa === null ? 1 : sb === null ? -1 : (sa < sb ? -1 : 1);
        }
        const na = String(club.teams[a].name);
        const nb = String(club.teams[b].name);
        return na < nb ? -1 : na > nb ? 1 : (a < b ? -1 : 1);
    });
}


// The teams the picker folds into "Other teams" (plan versions spec §9, decision 11): the special
// teams with no live plan still to race and no stored plan dated from today to today + 14 days.
// Weekly teams (any kind but 'special') never fold.
export function foldedTeams(club, now) {
    const today = localDate(now, club.tz);
    const last = addDays(today, FOLD_DAYS);
    const folded = new Set();
    for (const [slug, team] of Object.entries(club.teams)) {
        if (team.kind !== 'special') {
            continue;
        }
        const live = typeof team.live === 'string' && Object.hasOwn(club.sheets, team.live) ? club.sheets[team.live] : null;
        const racing = live !== null && isDate(live.date) && stillToRace(club, slug, live.date, now);
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


// The team's live plan and S. `live` is the servable live plan {slug, id, sheet, S}; for a team
// without a start time its live pointer (S null) unless that is used up; else null. S is the live
// plan's, else (with a start time) the next race day's at the start time, else null.
function liveAndStart(club, slug, now) {
    const team = club.teams[slug];
    const c = servable(club, now).find(x => x.slug === slug);
    if (c) {
        return {live: c, S: c.S};
    }
    let live = null;
    if (team.start == null && typeof team.live === 'string' && Object.hasOwn(club.sheets, team.live)
        && !isUsed(club, club.sheets[team.live], now)) {
        live = {slug, id: team.live, sheet: club.sheets[team.live], S: null};
    }
    const date = team.start == null ? null : nextRaceDate(club, slug, now);
    const S = date === null ? null : plannedStart(club, {team: slug, date});
    return {live, S};
}


// 'Thu 19 Nov': the day of the smallest team S not yet used up, or null.
export function nextRace(club, now) {
    let best = null;
    for (const slug of Object.keys(club.teams)) {
        const {S} = liveAndStart(club, slug, now);
        if (S !== null && now <= S + USED_UP_MS && (best === null || S < best)) {
            best = S;
        }
    }
    return best === null ? null : localDay(best, club.tz);
}


const riderStateOf = (kind, sev, text, time = null) => ({kind, sev, text, time});

// One rider's state against the live sheet, the checks in this order. `versions` are the live
// plan's versions ([id, sheet], by n): a code of one of them reads as its n.
function riderState(club, slug, sheet, S, entry, versions) {
    if (!entry) {
        return riderStateOf('none', 'neutral', t('tv-state-none'));
    }
    const at = atOf(entry);
    const time = Number.isFinite(at) ? localHHMM(at, club.tz) : null;
    if (inPen(club, slug, entry, S)) {
        if (otherEvent(entry, sheet)) {
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
        const older = versions.filter(([, v]) => v.sig === entry.sig).at(-1);
        return riderStateOf('old-code', 'warn', older ? t('tv-state-old-version', {n: older[1].n, ln: sheet.n})
            : t('tv-state-old-code', {sig: entry.sig}), time);
    }
    return riderStateOf('checked', 'neutral', t('tv-state-checked', {time: time ?? '–'}));
}


const isHas = state => state.kind === 'has' || state.kind === 'has-in-event';


// Riders whose in-event check contradicts the live sheet's event link, one note per other event
// (most riders first): in the pen window up to S + 4 h.
function pinNotes(club, slug, {id, sheet, S}, listed, entryOf) {
    const byEvent = new Map();
    const atLink = [];
    for (const r of listed) {
        const e = entryOf(r);
        const at = atOf(e);
        if (!e?.inEvent || teamOfCheck(club, e) !== slug || !(at >= S - PEN_FROM_MS && at <= S + PIN_UNTIL_MS)) {
            continue;
        }
        if (otherEvent(e, sheet)) {
            byEvent.set(e.event, [...(byEvent.get(e.event) ?? []), r.name]);
        } else if (e.event === sheet.pinnedEventId) {
            atLink.push(r.name);
        }
    }
    const pinned = sheet.pinnedEventId;
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


// For a team without a start time: the riders its live plan would take from other teams once a
// start time is set, by team. The latest start (23:59) keeps the plan servable whenever its date
// is today or later, and precedence does not depend on S. A rider listing left behind is a hole
// (effects' holes). A rider who is only in the other team's roster leaves none and is no news (the
// roster is the club's rider pool), so only the riders who leave a hole are named, in this plan's
// ride order; a team they leave no hole in has no entry.
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
    for (const s of teamOrder(club).filter(x => byTeam.has(x))) {
        const holed = namesOf(byTeam.get(s).filter(m => holes.some(h => h.slug === s && h.id === m.id)));
        if (!holed.length) {
            continue;
        }
        const teamName = nameOf(club, s);
        out.push({
            team: s, teamName, names: holed,
            text: holed.length === 1 ? t('tv-trap-one', {name: holed[0], team: teamName})
                : t('tv-trap', {names: andList(holed), team: teamName}),
        });
    }
    return out;
}


// The whole view of one team (spec §5.4). `seen` is store.seenOf(cid): {zwiftId: {at, sig, mod,
// sheet, inEvent, event}}.
export function teamView(club, slug, {now, seen = {}}) {
    const team = club.teams[slug];
    const tz = club.tz;
    const {live: lv, S} = liveAndStart(club, slug, now);
    const sheet = lv?.sheet ?? null;
    const sent = lv !== null && lv.S !== null;
    const open = sent && planOpen(S, now);
    const gateAt = S === null ? null : S - PLAN_OPEN_MS;
    const opens = gateAt === null ? null : atLabel(gateAt, now, tz);
    const today = localDate(now, tz);
    let when;
    if (S === null) {
        const date = nextRaceDate(club, slug, now);
        // a special team without a race: no day
        when = date === null ? {day: null, time: team.start, until: null, today: false}
            : {day: dateDay(date, tz), time: null, until: null, today: date === today};
    } else {
        when = {day: localDay(S, tz), time: team.start, until: untilLabel(S, now), today: localDate(S, tz) === today};
    }
    const marks = outdated(club, slug, now);
    const marksOf = id => (marks.get(id) ?? []).map(m => ({id: m.id, name: m.name, rides: m.rides, ridesName: nameOf(club, m.rides)}));
    const livePlan = lv && planOfId(club, slug, lv.id);
    const live = lv && liveCard(club, slug, lv, livePlan, {now, marksOf});

    const plan = sheet ? planOf(sheet) : {riders: []};
    const entryOf = r => (Object.hasOwn(seen, r.id) ? seen[r.id] : null);
    const stateOf = r => (open ? riderState(club, slug, sheet, S, entryOf(r), livePlan.versions) : null);
    const bySev = (a, b) => SEV[b.state.sev] - SEV[a.state.sev];
    const riders = plan.riders.map((r, i) => {
        const target = pullTarget(sheet, r);
        return {
            id: r.id, name: r.name, pos: i + 1,
            pull: target === null ? t('tv-pull', {s: r.pullS}) : t('tv-pull-target', {s: r.pullS, target}),
            state: stateOf(r),
        };
    });
    if (open) {
        riders.sort((a, b) => bySev(a, b) || a.pos - b.pos);
    }
    const count = riders.length;
    const has = open ? riders.filter(r => isHas(r.state)).length : null;

    let status;
    if (team.start == null) {
        status = {sev: 'err', kind: 'no-start', icon: 'clock', text: t(live ? 'tv-no-start-plan' : 'tv-no-start-none')};
    } else if (!live && when.day === null) {
        // a special team with no race planned: nothing is missing (Task 8b review)
        status = {sev: 'neutral', kind: 'no-race', icon: 'clock', text: t('tp-race-none')};
    } else if (!live) {
        status = {sev: 'err', kind: 'no-plan', icon: 'noPlan', text: t('tv-no-plan')};
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
        if (open && sheet.pinnedEventId != null) {
            notes.push(...pinNotes(club, slug, lv, plan.riders, entryOf));
        }
        notes.push(...holeNotes(club, slug, sheet, now));
    }
    const sev = worst([status.sev, ...notes.map(n => n.sev), ...(open ? riders.map(r => r.state.sev) : [])]);

    // one row per plan of this race (spec §9): the first stored first, so a switch moves only the
    // live flag; the live plan by its live version, every other by its newest
    const firstAt = p => Date.parse(p.versions[0][1].at) || 0;
    const plans = racePlans(club, slug, now)
        .sort((a, b) => firstAt(a) - firstAt(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map(p => {
            const [id, s] = p.live !== null ? [p.live, club.sheets[p.live]] : p.newest;
            const {riders: listed} = planOf(s);
            return {
                planId: p.id, id, label: s.label, day: dateDay(s.date, tz), n: s.n, at: madeLabel(s, now, tz), sig: s.sig,
                riders: listed.length, names: listed.slice(0, 3).map(r => r.name), marks: marksOf(id), live: p.live !== null,
            };
        });

    return {
        slug, name: team.name, start: team.start ?? null, S, gateAt, opens, open, when, live, status, notes, sev,
        icon: sev === status.sev ? status.icon : SEV_ICON[sev],
        riders, has, count, plans,
        trap: team.start == null && live ? trapOf(club, slug, sheet, plan.riders, now) : [],
    };
}


// The live row's model: the live version (`lv` from liveAndStart) of plan `p` with its n, what it
// changed against the version before it (`lines`, `summary`; [] and null for a version that cannot
// be read), Back to that version (`back`, with backAsk's words; null for a plan's first version) and
// the plan's newer version when that is not live.
function liveCard(club, slug, lv, p, {now, marksOf}) {
    const {sheet} = lv;
    const tz = club.tz;
    const prev = previousVersion(club, lv.id);
    const prevN = prev === null ? null : prev[1].n;
    // a version normalizePlan cannot read must not break every page that shows the team
    let lines = [];
    let summary = null;
    try {
        lines = diffVersions(club, prev?.[1] ?? null, sheet, now);
        summary = diffSummary(lines, {copyOf: sheet.copyOf ?? null});
    } catch {
        lines = [];
        summary = null;
    }
    const [newestId, newest] = p.newest;
    return {
        id: lv.id, label: sheet.label, date: sheet.date, day: dateDay(sheet.date, tz), sig: sheet.sig,
        at: madeLabel(sheet, now, tz), pinnedEventId: sheet.pinnedEventId ?? null, eventId: sheet.eventId ?? null,
        sent: lv.S !== null,
        n: sheet.n, planId: p.id, versions: p.versions.length, prevN,
        summary, lines,
        back: prevN === null ? null : {n: prevN, words: backAsk(club, slug, {plan: p.id, n: prevN}, now)},
        newer: newestId === lv.id ? null : {id: newestId, n: newest.n, at: madeLabel(newest, now, tz), marks: marksOf(newestId)},
    };
}


// One row of the picker and the switcher.
export function teamRow(view) {
    const {when, status, notes, live} = view;
    // a team with no race planned says so in its status line; the time line keeps its start time
    const timeLine = view.start === null ? t('tv-row-no-start') : when.day === null ? (status.kind === 'no-race' ? view.start : t('tp-race-none'))
        : t(when.today ? 'tv-row-time' : 'tv-row-day-time', {day: when.day, time: when.time, until: when.until});
    let main;
    let quiet;
    let short;
    if (status.kind === 'no-race') {
        main = status.text;
        quiet = t('tv-row-no-race');
        short = t('tv-short-no-race');
    } else if (status.sev === 'err') {
        main = status.text;
        quiet = status.kind === 'no-plan' ? t('tv-row-upload') : live ? t('tv-row-ready', {label: live.label}) : t('tv-row-neither');
        short = t(status.kind === 'no-plan' ? 'tv-short-no-plan' : 'tv-short-no-start');
    } else if (notes.length) {
        main = t('tv-row-fix', {n: notes.length, short: notes[0].short});
        quiet = status.text;
        short = t('tv-short-fix', {n: notes.length});
    } else {
        main = status.text;
        quiet = t('tv-row-live', {label: live.label});
        short = view.open ? t('tv-short-count', {has: view.has, n: view.count}) : t('tv-short-opens', {opens: view.opens});
    }
    return {slug: view.slug, name: view.name, sev: view.sev, icon: view.icon, timeLine, main, quiet, short};
}


// The id backDry gives its dry run's copy: never a stored id, as freeVersionId checks.
function dryRunIds() {
    let i = 0;
    return () => `zz${String(i++).padStart(4, '0')}`;
}


// The dry run of Back to v`n` of plan `planId` (any of its ids), with club.mjs's own backTo on a copy
// of the club: {r, team, p, moves, holes} (holes of this team only), or null when the plan is not
// live (its copy would not go live) or backTo would refuse. `version` is the team's version the page
// was drawn with (default: the current one), so a stale page is refused, not asked about.
function backDry(club, slug, {plan, n, version}, now) {
    const team = Object.hasOwn(club.teams, slug) ? club.teams[slug] : null;
    const p = team && typeof plan === 'string' ? planOfId(club, slug, plan) : null;
    if (p === null || p.live === null) {
        return null;
    }
    // backTo changes only the team, the sheet map and the log, so these are copied and the sheets
    // themselves shared
    const after = {...club, teams: {...club.teams, [slug]: {...team}}, sheets: {...club.sheets}, log: [...(club.log ?? [])]};
    let r;
    try {
        r = backTo(after, slug, {plan, n, version: version ?? team.version}, {now, newId: dryRunIds()});
    } catch (e) {
        if (e instanceof ClubError) {
            return null;
        }
        throw e;
    }
    const {moves, holes} = effects(club, after, p.date, now);
    return {r, team, p, moves, holes: holes.filter(h => h.slug === slug)};
}


// "v1 lists Ben, who now rides Sprockets. Rollers then rides without him. Back to v1 anyway?": what
// the dry run `backDry` gave would do to riders. Holes of this team first (one sentence), then each
// move, then the question. Null when nothing moves and no hole opens.
function movesWords(club, slug, {r, team, moves, holes}) {
    if (!moves.length && !holes.length) {
        return null;
    }
    const parts = [];
    if (holes.length) {
        const names = [...new Set(holes.map(h => h.name))];
        const teams = [...new Set(holes.map(h => nameOf(club, h.rides)))];
        parts.push(t(names.length === 1 ? 'back-q-hole' : 'back-q-holes', {n: r.from, names: andList(names), teams: andList(teams), team: team.name}));
    }
    parts.push(...moves.map(m => `${t('result-move', {name: m.name, from: nameOf(club, m.from), to: nameOf(club, m.to)})}.`));
    parts.push(t('back-q', {n: r.from}));
    return parts.join(' ');
}


// The question before Back to v`n` of a live plan (spec §8 step 4, decision 12): "Riders get v1 at
// once instead of v2." (for a team without a start time: that riders get nothing until it has one),
// plus the moves and holes (movesWords). Null when no question is due: the plan is
// not live (Back only stores a version), or backTo would refuse (`version` stale, `n` not stored, a
// used-up plan), which the POST then says.
export function backAsk(club, slug, {plan, n, version = null}, now) {
    const dry = backDry(club, slug, {plan, n, version}, now);
    if (dry === null) {
        return null;
    }
    const live = club.sheets[dry.p.live];
    const words = movesWords(club, slug, dry);
    const head = dry.team.start == null ? t('tp-live-words-no-start', {team: dry.team.name}) : t('back-q-live', {n: dry.r.from, ln: live.n});
    return words === null ? head : `${head} ${words}`;
}


// What Make live of version `id` does, in words (spec §9): "Riders get 'Rollers · slow' v2 at once
// instead of 'Rollers · fast' v5." (without a live plan riders get it at once; a team without a start
// time sends nothing, and says so), then the question about its outdated marks. The version's own
// label: a newer version may carry another type.
export function liveWords(club, slug, id, now) {
    const sheet = club.sheets[id];
    const team = club.teams[slug];
    const {live: lv} = liveAndStart(club, slug, now);
    const words = [team.start == null ? t('tp-live-words-no-start', {team: team.name})
        : lv === null || lv.id === id ? t('tp-live-words-none', {label: sheet.label, n: sheet.n})
            : t('tp-live-words', {label: sheet.label, n: sheet.n, live: lv.sheet.label, ln: lv.sheet.n})];
    const marks = outdated(club, slug, now).get(id) ?? [];
    if (marks.length) {
        words.push(t(marks.length === 1 ? 'tp-make-live-q-one' : 'tp-make-live-q', {label: sheet.label, names: andList(marks.map(m => m.name))}));
    }
    return words.join(' ');
}


// Does plan `p` (plansOf) have an event link? A plan whose live version or newest version is pinned
// (the team settings list exactly these; Remove clears the link on every version). The pinned event
// id, or null.
export function linkedPlan(club, p) {
    for (const id of [p.live, p.newest[0]]) {
        if (id !== null && Object.hasOwn(club.sheets, id) && club.sheets[id].pinnedEventId != null) {
            return club.sheets[id].pinnedEventId;
        }
    }
    return null;
}
