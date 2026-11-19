// The inbox routes (plan versions spec §6): GET /manage/inbox/<id> (the assign page with the dry run
// of Store), POST /manage/inbox/<id> (Store) and POST /manage/inbox/<id>/discard. Routed from
// manage.mjs after clubGate; the POSTs read the form like the other forms and check the principal
// again. The GET changes nothing (its dry run counts against the club's parse budget, Ruling 7).
import {readBody, BODY_MS, html, parseForm} from './http.mjs';
import {t} from './pages.mjs';
import {methodNotAllowed, FORM_BYTES} from './web.mjs';
import {ClubError, entryOf, storeEntry, discardEntry, teamHint} from './club.mjs';
import {effects, nextRaceDate, raceStart} from './select.mjs';
import {SHEET_RE, isSlug, parseEventUrl, randomId} from './ids.mjs';
import {assignChoices} from './preselect.mjs';
import {assignPage, assignPreview, entryGonePage} from './assign-page.mjs';
import {uploadResultPage} from './upload-page.mjs';
import {ridersLine} from './team-view.mjs';
import {clubErrorText, field, postedClub, frameOf} from './manage-page.mjs';
import {redirectWithFlash} from './flash.mjs';

const PARSE_RETRY_S = 600;


// What Store gets from the choices (uploadSheet's input without the content): the event link as
// its id, null when it does not parse (the callers check parseEventUrl(...).ok first).
export function storeInput(choices, base) {
    const event = parseEventUrl(choices.event ?? '');
    return {
        slug: choices.team, as: choices.as, live: choices.live, date: choices.date, start: choices.start ?? null, type: choices.type,
        pinnedEventId: event.ok ? event.id : null, base,
    };
}


// The choices of a Store POST, straight from the form: never preselected. A blank `as` is no plan;
// a missing `type` keeps a version's type (a blank one is none); a missing `date` is the team's next
// race (the page always sends it for a new plan); `start` is a special team's new plan's start time
// (uploadSheet ignores it for anything else).
function formChoices(form) {
    const has = k => form.get(k) !== null;
    return {
        team: field(form, 'team'), as: field(form, 'as') || null, live: field(form, 'live') === 'on',
        date: has('date') ? field(form, 'date') : null, start: field(form, 'start'),
        type: has('type') ? field(form, 'type') : undefined, event: field(form, 'event'),
    };
}


// The assign page's choices for a refused Store: the form read as a redraw (assignChoices with the
// posted `drawn`), except that a blank `as` stays no choice.
function refusedChoices(club, entry, form, now) {
    const choices = assignChoices(club, entry, form, now);
    if (field(form, 'as') !== '' || choices.as === null) {
        return choices;
    }
    return {...choices, as: null, live: false, liveKind: 'pick', liveVars: {}, dateFixed: false, drawn: `${choices.team ?? ''}:`};
}


// True when a special team's Store posts a start time drawn for another date (`startFor`, the date
// changed without a redraw) and the posted date's race has a time of its own that differs: storing
// would move that race to a time nobody chose for it (the coordinator, 19 Nov 2026).
function staleStart(club, choices, startFor) {
    const team = isSlug(choices.team) && Object.hasOwn(club.teams, choices.team) ? club.teams[choices.team] : null;
    if (team?.kind !== 'special' || startFor === null || choices.date === null || startFor === choices.date) {
        return false;
    }
    const raced = Object.values(club.sheets).some(sh => sh.team === choices.team && sh.date === choices.date);
    const current = raceStart(club, choices.team, choices.date);
    return raced && current !== null && choices.start !== '' && current !== choices.start;
}


// GET /manage/inbox/<id>: the assign page. Over the parse budget, 429 with the page and no preview.
function inboxGet(req, res, ctx, cid, id) {
    const {store, now} = ctx;
    const club = store.get(cid);
    const entry = entryOf(club, id, now);
    if (entry === null) {
        html(res, 404, entryGonePage(club, frameOf(ctx, cid)));
        return;
    }
    const params = new URL(req.url, 'http://localhost').searchParams;
    const choices = assignChoices(club, entry, params, now);
    if (!ctx.web.sheetParses.allow(cid, now)) {
        res.setHeader('Retry-After', String(PARSE_RETRY_S));
        html(res, 429, assignPage(club, entry, {...frameOf(ctx, cid), choices, preview: null, flash: {kind: 'err', text: t('upload-budget')}}));
        return;
    }
    html(res, 200, assignPage(club, entry, {...frameOf(ctx, cid), choices, preview: previewOf(ctx, cid, club, entry, choices)}));
}


// The dry run of Store for `choices` (spec §6.6): assignPreview's answer, {error} for a refusal or an
// event link that does not parse, {note} while the date or a special team's start time is empty,
// null without a team. Counts nothing: the caller does.
function previewOf(ctx, cid, club, entry, choices) {
    const {store, now} = ctx;
    if (choices.team === null) {
        return null;
    }
    if (!parseEventUrl(choices.event).ok) {
        return {error: t('upload-bad-event')};
    }
    // nothing typed yet is no error (the coordinator, 19 Nov 2026): a neutral line until the date
    // (and a special team's start time) is there; a value that is there but wrong is an error
    if (choices.date === '' || (choices.special && choices.start === '')) {
        const key = choices.date !== '' ? 'as-pv-choose-time' : choices.special && choices.start === '' ? 'as-pv-choose' : 'as-pv-choose-date';
        return {note: t(key)};
    }
    const base = club.teams[choices.team].version;
    try {
        const run = store.dryRun(cid, c => storeEntry(c, entry.id, storeInput(choices, base), {now, newId: () => randomId(6)}));
        return assignPreview(club, run.club, entry, {result: run.result, live: choices.live, now});
    } catch (e) {
        if (!(e instanceof ClubError)) {
            throw e;
        }
        return {error: clubErrorText(e)};
    }
}


// POST /manage/inbox/<id> (team, as, live, type, date, start, startFor, event, base, drawn, touched):
// Store. A special team's start time drawn for another date than the posted one, when that date's
// race has another time, stores nothing either: the page is redrawn for it (staleStart). A team or
// plan choice the page was not drawn for (`drawn` is not `<team>:<as>`: the captain changed it and
// stored without a redraw) stores nothing: 400 with the page redrawn for the new choice (its
// defaults, its preview; not counted, Ruling 7) and a note to check it. A refusal answers 400 with
// the assign page and the text on top, and keeps the entry; an entry that is gone answers 400 with
// its page; success the result page (circles §5.4: a direct answer).
function inboxStore(req, res, ctx, cid, form, id) {
    const {store, now} = ctx;
    const before = store.get(cid);
    const entry = entryOf(before, id, now);
    if (entry === null) {
        html(res, 400, entryGonePage(before, frameOf(ctx, cid)));
        return;
    }
    const refused = text => {
        const club = store.get(cid);
        html(res, 400, assignPage(club, entry, {...frameOf(ctx, cid), choices: refusedChoices(club, entry, form, now), preview: null, flash: {kind: 'err', text}}));
    };
    const choices = formChoices(form);
    const redraw = key => {
        const redrawn = assignChoices(before, entry, form, now);
        html(res, 400, assignPage(before, entry, {
            ...frameOf(ctx, cid), choices: redrawn, preview: previewOf(ctx, cid, before, entry, redrawn), flash: {kind: 'err', text: t(key)},
        }));
    };
    if (form.get('drawn') !== `${choices.team}:${choices.as ?? ''}`) {
        redraw('as-redrawn');
        return;
    }
    if (staleStart(before, choices, form.get('startFor'))) {
        redraw('as-redrawn-time');
        return;
    }
    if (choices.team === '') {
        refused(t('as-pick-team'));
        return;
    }
    if (!parseEventUrl(choices.event).ok) {
        refused(t('upload-bad-event'));
        return;
    }
    const input = storeInput(choices, field(form, 'base'));
    if (input.date === null) {
        // the team's next race when no date came (never from the page's own form)
        input.date = nextRaceDate(before, choices.team, now);
    }
    let result;
    try {
        result = store.change(cid, c => storeEntry(c, id, input, {now, newId: () => randomId(6)}));
    } catch (e) {
        if (!(e instanceof ClubError)) {
            throw e;
        }
        if (e.code === 'entry-gone') {
            html(res, 400, entryGonePage(store.get(cid), frameOf(ctx, cid)));
        } else {
            refused(clubErrorText(e));
        }
        return;
    }
    const after = store.get(cid);
    const slug = after.sheets[result.id].team;
    // moves and holes for the stored version's date: the plan's for a version (controller ruling 15)
    const {moves, holes} = effects(before, after, after.sheets[result.id].date, now);
    const hint = teamHint(before, slug, entry.json, result.plan.riders.map(r => r.id));
    html(res, 200, uploadResultPage(after, slug, {
        ...frameOf(ctx, cid), before, result, moves, holes, hint, importWarnings: entry.warnings ?? [], importMore: entry.warningsMore ?? 0,
    }));
}


// Where Discard goes back to: /manage, or a team page of a team that exists; anything else /manage.
function backOf(club, back) {
    const m = /^\/manage\/team\/([^/?#]+)$/.exec(back);
    return m && isSlug(m[1]) && Object.hasOwn(club.teams, m[1]) ? back : '/manage';
}


// POST /manage/inbox/<id>/discard (back): removes the entry; 303 to `back` with what was discarded
// (or, for an entry that is gone, that it is).
function inboxDiscard(req, res, ctx, cid, form, id) {
    const {store, now} = ctx;
    const to = backOf(store.get(cid), field(form, 'back'));
    let entry;
    try {
        entry = store.change(cid, c => discardEntry(c, id, now));
    } catch (e) {
        if (!(e instanceof ClubError)) {
            throw e;
        }
        redirectWithFlash(res, ctx, cid, to, {kind: 'err', text: clubErrorText(e)});
        return;
    }
    redirectWithFlash(res, ctx, cid, to, {kind: 'ok', text: t('discarded', {riders: ridersLine(entry)})});
}


// The routes of /manage/inbox/<raw>[/discard] (`raw` the path segment as sent), after clubGate.
// `method` has HEAD as GET.
export async function handleInbox(req, res, ctx, cid, raw, discard, method) {
    let id;
    try {
        id = decodeURIComponent(raw);
    } catch {
        id = '';
    }
    if (method === 'GET' && !discard) {
        if (!SHEET_RE.test(id)) {
            html(res, 404, entryGonePage(ctx.store.get(cid), frameOf(ctx, cid)));
            return;
        }
        inboxGet(req, res, ctx, cid, id);
        return;
    }
    if (method !== 'POST') {
        methodNotAllowed(res, discard ? 'POST' : 'GET, POST');
        return;
    }
    const form = parseForm(await readBody(req, FORM_BYTES, BODY_MS));
    // the link may have been replaced while the body came in, and the page must be of the open club
    const who = postedClub(req, res, ctx, cid, form.get('club') ?? '');
    if (!who) {
        return;
    }
    if (!SHEET_RE.test(id)) {
        html(res, 404, entryGonePage(ctx.store.get(who.circle), frameOf(ctx, who.circle)));
        return;
    }
    if (discard) {
        inboxDiscard(req, res, ctx, who.circle, form, id);
    } else {
        inboxStore(req, res, ctx, who.circle, form, id);
    }
}
