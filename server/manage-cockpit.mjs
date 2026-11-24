// The team page's route (team cockpit spec §5.1, §5.4, §6, §8): GET /manage/team/<slug>, the whole
// page or, with panel=1, the fragment of its three slots the script swaps in place; the page as HTML
// for a refusal (manage-page.mjs renderPlace, manage-inbox.mjs's Store); and the dry run of Store
// that a received plan's form shows (previewOf). Behind the club gate (manage.mjs).
import {html, send} from './http.mjs';
import {t} from './pages.mjs';
import {isSlug, parseEventUrl, randomId} from './ids.mjs';
import {takeFlash} from './flash.mjs';
import {frameOf, clubErrorText} from './manage-frame.mjs';
import {teamGonePage} from './team-page.mjs';
import {selectionOf} from './cockpit-view.mjs';
import {cockpitPage, cockpitFragment, cockpitPath} from './cockpit-page.mjs';
import {ClubError, entryOf, storeEntry} from './club.mjs';
import {assignChoices} from './preselect.mjs';
import {assignPreview} from './store-form.mjs';

// Retry-After of an answer over the club's parse budget (ctx.web.sheetParses).
export const PARSE_RETRY_S = 600;

// "Plan on ZwiftGopher" of team `slug` (push.mjs), or null (no PUBLIC_URL, or no push in this ctx).
const plannerOf = (ctx, club, slug) => ctx.push?.href(club, slug, ctx.now) ?? null;

const stale = res => send(res, 409, 'text/plain; charset=utf-8', '');

const budgetFlash = () => ({kind: 'err', text: t('upload-budget')});


// What Store gets from the choices (uploadSheet's input without the content): `live` true for Make
// live, false for Store; the event link as its id, null when it does not parse (the callers check
// parseEventUrl(...).ok first). A version (`as` a plan) takes its plan's race as it is (user, 23 Nov
// 2026): no start time and no event link go along, whatever was posted (uploadSheet keeps the race's
// and takes the plan's date).
export function storeInput(choices, base) {
    const version = isVersion(choices);
    const event = version ? {ok: false} : parseEventUrl(choices.event ?? '');
    return {
        slug: choices.team, as: choices.as, live: choices.live, date: choices.date, start: version ? null : choices.start ?? null, type: choices.type,
        pinnedEventId: event.ok ? event.id : null, base,
    };
}


// Is the Store a new version of a plan (its `as` a plan id), not a new plan or no choice?
export const isVersion = choices => typeof choices.as === 'string' && choices.as !== '' && choices.as !== 'new';


// The refusals of Store that concern the race date, the start time (club.mjs uploadSheet): the
// Store form opens its race fold for them (store-form.mjs raceOpen), as for an event link that does
// not parse and for the redraws for another race or a start time changed meanwhile (manage-inbox.mjs).
export const RACE_CODES = new Set(['bad-date', 'race-over', 'race-over-time', 'bad-start']);


// The dry runs of the Store form's two buttons for `choices` (spec §6.6; user, 23 Nov 2026: Make live
// stores and makes live, Store only stores): assignPreview's answer, {error} for a refusal or an
// event link that does not parse (with `race: true` when it concerns the race fold's fields: an
// event link, RACE_CODES), {note} while the date or a special team's start time is empty, null
// without a team. Counts nothing: the caller does (one draw, both runs).
export function previewOf(ctx, cid, club, entry, choices) {
    const {store, now} = ctx;
    if (choices.team === null) {
        return null;
    }
    // a version takes its plan's race: its date, time and link are none of the form's
    const fresh = !isVersion(choices);
    if (fresh && !parseEventUrl(choices.event).ok) {
        return {error: t('upload-bad-event'), race: true};
    }
    // nothing typed yet is no error (the coordinator, 19 Nov 2026): a neutral line until the date
    // (and a special team's start time) is there; a value that is there but wrong is an error
    if (fresh && (choices.date === '' || (choices.special && choices.start === ''))) {
        const key = choices.date !== '' ? 'as-pv-choose-time' : choices.special && choices.start === '' ? 'as-pv-choose' : 'as-pv-choose-date';
        return {note: t(key)};
    }
    const base = club.teams[choices.team].version;
    const run = live => store.dryRun(cid, c => storeEntry(c, entry.id, storeInput({...choices, live}, base), {now, newId: () => randomId(6)}));
    try {
        return assignPreview(club, entry, {live: run(true), off: run(false), now});
    } catch (e) {
        if (!(e instanceof ClubError)) {
            throw e;
        }
        return {error: clubErrorText(e), ...(RACE_CODES.has(e.code) ? {race: true} : {})};
    }
}


// The Store form of `entry` as the request's query `params` asks (anything with get(k)): {choices,
// preview, status}. assignChoices' choices and the dry run, counted against the club's parse budget
// (Ruling 7); over it, status 429 and no preview.
export function entryDraw(ctx, cid, club, entry, params) {
    const choices = assignChoices(club, entry, params, ctx.now);
    if (!ctx.web.sheetParses.allow(cid, ctx.now)) {
        return {choices, preview: null, status: 429};
    }
    return {choices, preview: previewOf(ctx, cid, club, entry, choices), status: 200};
}


// The team page of team `slug` (a team of club `cid`) as HTML, with the selection `v`, `e` or `r` (as a
// URL would send them; selectionOf judges them), an optional flash, and `refresh` false for a
// refusal's answer (its URL is a POST's: it must not reload itself). A received plan picked draws its
// Store form with `choices` and `preview` (a refused Store's: the form as posted) or, without them,
// entryDraw's defaults (over the parse budget: its flash, when there is no other).
export function renderCockpit(ctx, cid, slug, {v = null, e = null, r = null, flash = null, refresh = true, choices = null, preview = null} = {}) {
    const club = ctx.store.get(cid);
    const params = new URLSearchParams();
    if (typeof v === 'string') {
        params.set('v', v);
    }
    if (typeof e === 'string') {
        params.set('e', e);
    }
    if (typeof r === 'string') {
        params.set('r', r);
    }
    const sel = selectionOf(club, slug, params, ctx.now);
    let form = {choices, preview};
    if (sel.kind === 'entry' && choices === null) {
        form = entryDraw(ctx, cid, club, entryOf(club, sel.id, ctx.now), params);
        if (form.status === 429 && flash === null) {
            flash = budgetFlash();
        }
    }
    return cockpitPage(club, slug, {...frameOf(ctx, cid), flash, refresh, planner: plannerOf(ctx, club, slug), sel, choices: form.choices, preview: form.preview});
}


// GET /manage/team/<raw> (`raw`, the path segment as sent): 404 with the team-gone page for a team
// that does not exist (or a segment that is no slug). A received plan of another team of the club
// (selectionOf 'elsewhere') goes there (303 to that team's page with ?e=). With panel=1 the
// fragment (cockpitFragment, never the one-shot flash), only for a page drawn with the team's version
// now (`tv`): else 409 with an empty body, and the script loads the whole page; another team's entry
// is 409 there too. Else the page with its flash. A received plan picked: its Store form as the
// query asks (entryDraw: the script's redraw sends the form's fields); over the parse budget 429 with
// Retry-After, the form without a preview and the budget's text in place of the flash.
export function cockpitGet(req, res, ctx, cid, raw) {
    const club = ctx.store.get(cid);
    let slug;
    try {
        slug = decodeURIComponent(raw);
    } catch {
        slug = '';
    }
    if (!isSlug(slug) || !Object.hasOwn(club.teams, slug)) {
        html(res, 404, teamGonePage(club, frameOf(ctx, cid)));
        return;
    }
    const params = new URL(req.url, 'http://localhost').searchParams;
    const panel = params.get('panel') === '1';
    const sel = selectionOf(club, slug, params, ctx.now);
    if (sel.kind === 'elsewhere') {
        if (panel) {
            stale(res);
        } else {
            send(res, 303, 'text/plain; charset=utf-8', '', {Location: `${cockpitPath(sel.slug)}?e=${sel.id}`});
        }
        return;
    }
    if (panel && params.get('tv') !== String(club.teams[slug].version)) {
        stale(res);
        return;
    }
    let form = {choices: null, preview: null, status: 200};
    if (sel.kind === 'entry') {
        form = entryDraw(ctx, cid, club, entryOf(club, sel.id, ctx.now), params);
        if (form.status === 429) {
            res.setHeader('Retry-After', String(PARSE_RETRY_S));
        }
    }
    const {choices, preview, status} = form;
    const budget = status === 429 ? budgetFlash() : null;
    if (panel) {
        html(res, status, cockpitFragment(club, slug, {now: ctx.now, seen: ctx.store.seenOf(cid), sel, choices, preview, flash: budget}));
        return;
    }
    const flash = budget ?? takeFlash(req, res, ctx, cid, cockpitPath(slug));
    html(res, status, cockpitPage(club, slug, {...frameOf(ctx, cid), flash, planner: plannerOf(ctx, club, slug), sel, choices, preview}));
}
