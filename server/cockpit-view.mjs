// The team cockpit's model (team cockpit spec §5.2, §5.3, §5.6): the one team page's list per race
// (the plans not stored yet, the plans in their fixed order, their versions newest first with the
// two newest shown and the rest folded), the selection from the page's URL and what the panel shows.
// Pure: it reads the club and the checks it is given, and the clock is passed in. Plain text: the
// page (Task 7) escapes it.
import {t} from './pages.mjs';
import {teamView, raceDates, byRaceOrder, newerNotLive, atLabel, dateDay, entryInfo, undoOffer} from './team-view.mjs';
import {raceBase, tableBase, shownTarget} from './plan-table.mjs';
import {diffVersions, diffSummary} from './diff.mjs';
import {plansOf} from './plans.mjs';
import {entryOf} from './club.mjs';
import {raceOver} from './select.mjs';
import {isDate} from './time.mjs';

// A plan's versions shown above its fold "N older": this many of the newest, plus the live and the
// picked one wherever they are.
export const SHOWN_VERSIONS = 2;

const param = (params, key) => {
    const v = params.get(key);
    return typeof v === 'string' && v !== '' ? v : null;
};


// The Undo the cockpit offers (undoOffer) while the race of the version it changed is still to race:
// a race that is over takes no Undo (makeLive refuses it, race-done), so the page offers none, with
// a version picked or not. null otherwise.
export function undoInRace(club, slug, now) {
    const u = undoOffer(club, slug, now);
    return u !== null && !raceOver(club, slug, u.live.date, now) ? u : null;
}


// What the page's URL picks (shapes: `?v=` wins over `?e=`, `?e=` over `?r=`): {kind: 'version', id}
// for a version of team `slug`; {kind: 'race', date} for `?r=<date>`, a race of the team (ahead, over,
// or its regular race day): that race's live version, whichever it is when the page is drawn (the
// live row's link, so a reload follows the live pointer, never pins a version); date null for a date
// that is no race (any more): the nearest race's, as the bare page; {kind: 'entry', id}
// for an inbox entry of the team still waiting (entryOf with `now`);
// {kind: 'elsewhere', slug, id} for one of another team of the club (the route sends the captain
// there); {kind: 'gone', what: 'version' | 'entry'} for anything else named (an entry of no team
// answers like a gone one: none can be made, deleteTeam removes them, ruling F12; a `?r=` that is no
// date, or a date that is no race while the team has no race to fall back to: a special team with
// none ahead, whose bare page draws no card, so a phone's sheet would be empty, with no ✕);
// {kind: 'none'}.
export function selectionOf(club, slug, params, now) {
    const v = param(params, 'v');
    if (v !== null) {
        return Object.hasOwn(club.sheets, v) && club.sheets[v].team === slug ? {kind: 'version', id: v} : {kind: 'gone', what: 'version'};
    }
    const e = param(params, 'e');
    if (e === null) {
        const r = param(params, 'r');
        if (r === null) {
            return {kind: 'none'};
        }
        const {ahead, over, regular} = raceDates(club, slug, now);
        if (!isDate(r)) {
            return {kind: 'gone', what: 'version'};
        }
        if ([...ahead, ...over, regular].includes(r)) {
            return {kind: 'race', date: r};
        }
        // a race moved or deleted since the link was drawn (another captain's race ⋯): the nearest
        // race's live version, as the bare page (date null), never "no longer exists"; without a
        // nearest race (the lists' first: ahead[0], else the regular day) the selection is gone
        return ahead.length || regular !== null ? {kind: 'race', date: null} : {kind: 'gone', what: 'version'};
    }
    const entry = entryOf(club, e, now);
    if (entry !== null && entry.team === slug) {
        return {kind: 'entry', id: e};
    }
    if (entry !== null && typeof entry.team === 'string' && Object.hasOwn(club.teams, entry.team)) {
        return {kind: 'elsewhere', slug: entry.team, id: e};
    }
    return {kind: 'gone', what: 'entry'};
}


// The team's inbox entries still waiting (entryOf with `now`), pushed ('receive') and uploaded
// ('upload': every other source), newest first (the later arrival first at the same time), as
// entryInfo gives them, with `date`: the race an upload was made for (`forDate`) while that race is
// still to race, else null (a pushed plan has no race yet). Unlike teamView's `received` (pushed
// plans only, which the hub, the rows' count and the 60 s reload read), it lists the uploads too.
export function pendingFor(club, slug, now) {
    const ahead = new Set(raceDates(club, slug, now).ahead);
    return club.inbox
        .map((e, i) => ({e, i}))
        .filter(({e}) => e.team === slug && entryOf(club, e.id, now) === e)
        .sort((a, b) => (Date.parse(b.e.at) || 0) - (Date.parse(a.e.at) || 0) || b.i - a.i)
        .map(({e}) => {
            const upload = e.source !== 'receive';
            return {
                ...entryInfo(club, e, now), source: upload ? 'upload' : 'receive',
                date: upload && ahead.has(e.forDate) ? e.forDate : null,
            };
        });
}


// One version's row (spec §5.2): `at` when it was stored; `liveLine` "live since 19:14" for the
// race's live version ("live" without a liveAt: stored before it existed), "was live 18:57" for
// another that was live, else null; `has` "4/6 have it" on the live version's row once its race's
// gate is open (spec §5.3b: opening another version never hides the count), else null; `summary` the
// one-line difference against the race's live version, comparing the targets as the rider table
// shows them (plan-table.mjs shownTarget, spec §7: a W/kg export and the next in watts is no change),
// null for the live one, without a live version and when either cannot be read; `notice` the newer
// version not live (newerNotLive), never in a race that is over (`over`: nothing can be made live
// there); `picked` the row the card shows, `sheet` when the URL picked it (a phone's sheet: with
// nothing picked the live row is picked, but no sheet is open); `race` the live row's race date (its
// link is the race's live pointer, `?r=`), else null; `undo` (cockpitView) when the row offers Undo.
function versionRow(club, [id, s], {liveId, noticeId, pickedId, sheet, over, has, now}) {
    const tz = club.tz;
    const when = iso => {
        const ms = Date.parse(iso);
        return Number.isFinite(ms) ? atLabel(ms, now, tz) : null;
    };
    const live = id === liveId;
    const liveAt = s.liveAt == null ? null : when(s.liveAt);
    const liveLine = live ? (liveAt === null ? t('cp-live') : t('cp-live-since', {at: liveAt}))
        : liveAt === null ? null : t('cp-was-live', {at: liveAt});
    let summary = null;
    if (liveId !== null && !live) {
        try {
            const targetOf = (sh, r) => shownTarget(club, sh, r);
            summary = diffSummary(diffVersions(club, club.sheets[liveId], s, now, {targetOf}));
        } catch {
            // a version normalizePlan cannot read: its row stays, without a summary
        }
    }
    return {id, n: s.n, at: when(s.at) ?? '–', live, race: live ? s.date : null, liveLine, has: live ? has : null, summary, notice: !over && id === noticeId,
        picked: id === pickedId, sheet: sheet && id === pickedId, undo: false};
}


// "4/6 have it" (the riders card's count, spec §5.3b) of a race view (raceView) whose gate is open
// and that has a live version, else null.
function hasLine(rv) {
    if (!rv?.live || !rv.open) {
        return null;
    }
    return t(rv.count === 1 ? 'cp-row-has-one' : 'cp-row-has', {has: rv.has, n: rv.count});
}


// The list of team `slug`'s race on `date` (null: a team without any race ahead or regular race
// day): {date, day, over, pending, plans}. `pending` are given; `plans` the plans of that date in
// the race's fixed order (byRaceOrder), each {planId, label, live, shown, older} with its versions
// newest first: `shown` the SHOWN_VERSIONS newest, the live and the picked one, `older` the rest.
// `has` the live row's count (hasLine), or null.
function raceList(club, slug, date, {over, pending, pickedId, sheet, has = null, now}) {
    const base = date === null ? {id: null} : raceBase(club, slug, date);
    const liveId = base.id;
    const noticeId = liveId === null ? null : newerNotLive(club, slug, liveId)?.id ?? null;
    const plans = date === null ? [] : plansOf(club, slug).filter(p => p.date === date).sort(byRaceOrder).map(p => {
        const rows = [...p.versions].reverse().map(v => versionRow(club, v, {liveId, noticeId, pickedId, sheet, over, has, now}));
        const keep = (r, i) => i < SHOWN_VERSIONS || r.live || r.picked;
        return {
            planId: p.id, label: p.label, live: p.live !== null,
            shown: rows.filter(keep), older: rows.filter((r, i) => !keep(r, i)),
        };
    });
    return {date, day: date === null ? null : dateDay(date, club.tz), over, pending, plans};
}


// What the panel shows for selection `sel` (selectionOf), one card in every state (team cockpit
// spec §5.3b): a received or uploaded plan ('entry'), a gone one ('gone'; also another team's entry,
// which the route sends elsewhere), or a version: {kind: 'version', id, planId, date, isLive (its
// race's live version), over (the race is over: read only), base (tableBase: what the table marks it
// against; the live version itself, nothing), undo (the Undo of the team's last change, offered on
// the version that change made live while its race is still to race: a race that is over takes
// none), dflt (nothing picked: the nearest race's live version, drawn as if picked), rv (the race
// view of its race while it is ahead: its count and, after the gate, its riders' states; null for a
// race that is over)}. Nothing picked: the nearest race's live version (dflt); without one 'none'
// ({date, close: false}: "Nothing live for <day> yet") when the race has plans, else 'blank' (no
// card: the list's empty card says it). A race picked (`?r=`): its live version, else 'none' ({date,
// close: true}: a phone's sheet needs its ✕), and with no race to draw at all 'gone' (selectionOf
// answers that one as gone itself): a selection always has a card with the ✕, never 'blank', since
// the page is a sheet for it (body.has-sel hides the list below 1180 px).
function panelOf(club, slug, sel, view, now) {
    if (sel.kind === 'entry') {
        return {kind: 'entry', id: sel.id};
    }
    if (sel.kind === 'gone' || sel.kind === 'elsewhere') {
        return {kind: 'gone', what: sel.kind === 'gone' ? sel.what : 'entry'};
    }
    let id = sel.kind === 'version' ? sel.id : null;
    const first = view.lists[0];
    if (sel.kind === 'race') {
        const date = sel.date ?? first.date;
        id = date === null ? null : raceBase(club, slug, date).id;
        if (id === null) {
            return date === null ? {kind: 'gone', what: 'version'} : {kind: 'none', date, close: true};
        }
    }
    if (id === null) {
        const live = first.date === null ? null : raceBase(club, slug, first.date).id;
        if (live === null) {
            return first.plans.length ? {kind: 'none', date: first.date, close: false} : {kind: 'blank'};
        }
        id = live;
    }
    const s = club.sheets[id];
    const isLive = raceBase(club, slug, s.date).id === id;
    const u = isLive ? undoInRace(club, slug, now) : null;
    const dflt = sel.kind === 'none';
    const rv = view.races.find(r => r.live && r.live.id === id) ?? null;
    return {
        kind: 'version', id, planId: s.plan, date: s.date, isLive, over: raceOver(club, slug, s.date, now),
        base: tableBase(club, slug, id), undo: u !== null && u.live === s, dflt, rv,
    };
}


// The cockpit of team `slug`: teamView's answer (the nearest race's view, `races`, `over`, and
// `received`, the pushed plans only), plus `lists` (a list per race ahead, nearest first; without a
// race ahead one list of the regular race day, or of null), `overLists` (the races that are over,
// newest first: read only, no plans waiting there), `sel` and `panel` (panelOf). The plans not
// stored yet (pendingFor) sit with the race an upload was made for, else with lists[0]. The row the
// panel draws is picked: the selection's, or with nothing picked the nearest race's live version
// (spec §5.3b). The Undo of the team's last switch (undoInRace) is offered once per page: on the
// card when the card shows the version it made live, else on that version's row (`undo` 'shown'); the
// row draws it also then, hidden ('hidden'), so a swap that takes the card's away can show it (the
// fragment holds no list rows).
export function cockpitView(club, slug, {now, seen = {}, sel = {kind: 'none'}}) {
    const view = teamView(club, slug, {now, seen});
    const {ahead, over, regular} = raceDates(club, slug, now);
    const dflt = sel.kind === 'none' && ahead.length ? raceBase(club, slug, ahead[0]).id : null;
    const raceDate = sel.kind === 'race' ? sel.date ?? (ahead.length ? ahead[0] : regular) : null;
    const pickedId = sel.kind === 'version' ? sel.id : raceDate !== null ? raceBase(club, slug, raceDate).id : dflt;
    const sheet = sel.kind !== 'none';
    const pickedEntry = sel.kind === 'entry' ? sel.id : null;
    const pending = pendingFor(club, slug, now)
        .map(({date, ...p}) => ({date, p: {id: p.id, source: p.source, at: p.at, name: p.name, riders: p.riders, line: p.line, picked: p.id === pickedEntry,
            sheet: p.id === pickedEntry}}));
    const dates = ahead.length ? ahead : [regular];
    const lists = dates.map((date, i) => raceList(club, slug, date, {
        over: false, pickedId, sheet, now, has: ahead.length ? hasLine(view.races[i]) : null,
        pending: pending.filter(x => x.date === date || (i === 0 && x.date === null)).map(x => x.p),
    }));
    const overLists = over.map(date => raceList(club, slug, date, {over: true, pending: [], pickedId, sheet, now}));
    const out = {...view, lists, overLists, sel};
    const panel = panelOf(club, slug, sel, out, now);
    // the Undo of the last switch on the switched race's live row, always while it is offered (a swap
    // can take the card's away), hidden while the card offers it (the script shows and hides it)
    const u = undoInRace(club, slug, now);
    const onRow = u === null ? null : raceBase(club, slug, u.live.date).id;
    const inCard = panel.kind === 'version' && panel.undo;
    for (const list of [...lists, ...overLists]) {
        for (const p of list.plans) {
            for (const r of [...p.shown, ...p.older]) {
                r.undo = r.id === onRow ? (inCard ? 'hidden' : 'shown') : false;
            }
        }
    }
    return {...out, panel};
}
