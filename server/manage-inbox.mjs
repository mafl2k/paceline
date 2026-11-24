// The inbox routes (plan versions spec §6, team cockpit spec §5.4, §8): GET /manage/inbox/<id> (a
// link from before the team cockpit: to the team page with the entry picked), POST /manage/inbox/<id>
// (Store, from the team page's form) and POST /manage/inbox/<id>/discard. Routed from manage.mjs
// after clubGate; the POSTs read the form like the other forms and check the principal again. The
// GET changes nothing.
import {readBody, BODY_MS, html, parseForm} from './http.mjs';
import {t} from './pages.mjs';
import {methodNotAllowed, redirect, FORM_BYTES} from './web.mjs';
import {ClubError, entryOf, storeEntry, discardEntry, teamHint} from './club.mjs';
import {effects, nextRaceDate} from './select.mjs';
import {SHEET_RE, isSlug, parseEventUrl, randomId} from './ids.mjs';
import {assignChoices, chosenDate, drawnStart} from './preselect.mjs';
import {storeResult, entryGonePage, storeAsk} from './store-form.mjs';
import {ridersLine} from './team-view.mjs';
import {clubErrorText, field, postedClub, frameOf} from './manage-page.mjs';
import {redirectWithFlash} from './flash.mjs';
import {confirmPage} from './ui.mjs';
import {cockpitPath} from './team-page.mjs';
import {raceOf} from './races.mjs';
import {renderCockpit, previewOf, storeInput, isVersion, RACE_CODES} from './manage-cockpit.mjs';

// The Store input and the dry run live in manage-cockpit.mjs (the cockpit's form draws it too).
export {storeInput, previewOf};


// The choices of a Store POST, straight from the form: never preselected. `live`: the form's Make
// live (live=on), or the confirm of its strip or of the server's question (confirm=1, which only
// Make live sends); Store sends neither. A blank `as` is no plan;
// a missing `type` keeps a version's type (a blank one is none); the date is the one the form means
// (chosenDate: a typed date, else the race radio, else the date field), none sent is the team's next
// race (the page always sends one for a new plan); `start` is the race's start time as posted
// (uploadSheet stores it for every kind of team: a blank keeps the race's).
function formChoices(form) {
    const has = k => form.get(k) !== null;
    return {
        team: field(form, 'team'), as: field(form, 'as') || null, live: field(form, 'live') === 'on' || field(form, 'confirm') === '1',
        date: chosenDate(form), start: field(form, 'start'),
        type: has('type') ? field(form, 'type') : undefined, event: field(form, 'event'),
    };
}


// The Store form's choices for a refused Store: the form read as a redraw (assignChoices with the
// posted `drawn`), except that a blank `as` stays no choice.
function refusedChoices(club, entry, form, now) {
    const choices = assignChoices(club, entry, form, now);
    if (field(form, 'as') !== '' || choices.as === null) {
        return choices;
    }
    return {...choices, as: null, drawn: `${choices.team ?? ''}:`};
}


// GET /manage/inbox/<id> (the assign page's URL before the team cockpit, team cockpit spec §8): 303
// to the team page of the entry's team with the entry picked (?e=<id>#panel). An entry that is gone,
// or one of no team of the club (none can be made, ruling F12), answers 404 with the entry-gone page.
function inboxGet(req, res, ctx, cid, id) {
    const club = ctx.store.get(cid);
    const entry = entryOf(club, id, ctx.now);
    if (entry === null || typeof entry.team !== 'string' || !Object.hasOwn(club.teams, entry.team)) {
        html(res, 404, entryGonePage(club, frameOf(ctx, cid)));
        return;
    }
    redirect(res, `${cockpitPath(entry.team)}?e=${id}#panel`);
}


// POST /manage/inbox/<id> (team, as, live, confirm, type, race, date, start, startFor, startWas, event,
// base, drawn, touched, raceOpen): Store, or with live=on Store and make live (the form's Make live).
// Make live without confirm=1 asks first when the rule says so (storeAsk: the race window with
// another version live in that race; user, 23 Nov 2026): 200 with the question on a page of its own
// (the no-script path of the bar's strip), its form posting the same fields again with confirm=1,
// and nothing changes. A team or plan choice the form was not drawn for (`drawn` is not `<team>:<as>`:
// the captain changed it and stored without a redraw) stores nothing: 400 with the form redrawn for
// the new choice (its defaults, its preview; not counted, Ruling 7) and a note to check it. So does a
// race the form was not drawn for (the date the form means, chosenDate, is not `startFor`: the race
// radio or the date changed without a redraw; Review Focus 5): the form is redrawn for that race, so
// a start time drawn for another date never moves its race. And so does a race whose start is no
// longer `startWas`, the one the form was drawn with (someone changed it since: final review I-2),
// redrawn with the race's start as it is now. A refusal answers 400 with the form and the text on
// top, and keeps the entry. Every one of these answers is the team page of the entry's team with the
// entry picked (?e=, not reloading itself) and its form as posted. An entry that is gone answers 400
// with the team page of the posted team, whose panel says so (the entry-gone page without such a
// team); so does an entry of no team of the club. Success is 303 to the team page of the stored
// version's team (a Store for another team: that team's) with the version picked (?r=<race date>, the
// race's live pointer, when it is live now; else ?v=<id>) and the Store flash (storeResult) in the
// panel's head. A `from` of a page from before the team cockpit is ignored.
function inboxStore(req, res, ctx, cid, form, id) {
    const {store, now} = ctx;
    const before = store.get(cid);
    const entry = entryOf(before, id, now);
    const teamOf = slug => (isSlug(slug) && Object.hasOwn(store.get(cid).teams, slug) ? slug : null);
    const gone = slug => {
        html(res, 400, teamOf(slug) !== null ? renderCockpit(ctx, cid, slug, {e: id, refresh: false})
            : entryGonePage(store.get(cid), frameOf(ctx, cid)));
    };
    const home = entry === null ? null : teamOf(entry.team);
    if (home === null) {
        gone(field(form, 'team'));
        return;
    }
    // the form again with `choices` and `preview`, and the text on top
    const again = (choices, preview, text) => renderCockpit(ctx, cid, home, {e: id, flash: {kind: 'err', text}, refresh: false, choices, preview});
    // `race`: the refusal concerns the race date, the start time or the event link, so the form's
    // race fold is drawn open (store-form.mjs raceOpen)
    const refused = (text, race = false) => {
        const club = store.get(cid);
        const choices = refusedChoices(club, entry, form, now);
        html(res, 400, again(race ? {...choices, raceOpen: true} : choices, null, text));
    };
    const choices = formChoices(form);
    // (also open when the redraw drew another date than the one typed: a team or plan changed without
    // a redraw puts the form back on its default race, and the captain must see the typed date went)
    const redraw = (key, race = false) => {
        const redrawn = assignChoices(before, entry, form, now);
        const typed = chosenDate(form);
        const open = race || (typed !== null && typed !== '' && typed !== redrawn.date);
        html(res, 400, again(open ? {...redrawn, raceOpen: true} : redrawn, previewOf(ctx, cid, before, entry, redrawn), t(key)));
    };
    if (form.get('drawn') !== `${choices.team}:${choices.as ?? ''}`) {
        redraw('as-redrawn');
        return;
    }
    // a version takes its plan's race (user, 23 Nov 2026): a date, time or link posted with it (a page
    // from before) is ignored, and so are the guards that concern them
    const version = isVersion(choices);
    const startFor = version ? null : form.get('startFor');
    // (an emptied date names no race: uploadSheet asks for one, bad-date)
    if (startFor !== null && choices.date !== null && choices.date !== '' && choices.date !== startFor) {
        redraw('as-redrawn-race', true);
        return;
    }
    // the race's start was changed since the page was drawn (another captain, another tab): the
    // field echoes the old one, so storing it would put the race back without asking (final review
    // I-2); redrawn with the race's start as it is now
    const startWas = form.get('startWas');
    if (startWas !== null && startFor !== null && Object.hasOwn(before.teams, choices.team) && startWas !== drawnStart(before, choices.team, startFor)) {
        redraw('as-redrawn-start', true);
        return;
    }
    if (choices.team === '') {
        refused(t('as-pick-team'));
        return;
    }
    if (!version && !parseEventUrl(choices.event).ok) {
        refused(t('upload-bad-event'), true);
        return;
    }
    const input = storeInput(choices, field(form, 'base'));
    if (input.date === null) {
        // the team's next race when no date came (never from the page's own form)
        input.date = nextRaceDate(before, choices.team, now);
    }
    if (choices.live && field(form, 'confirm') !== '1' && asked(ctx, cid, res, before, entry, form, input)) {
        return;
    }
    let result;
    try {
        result = store.change(cid, c => storeEntry(c, id, input, {now, newId: () => randomId(6)}));
    } catch (e) {
        if (!(e instanceof ClubError)) {
            throw e;
        }
        if (e.code === 'entry-gone') {
            gone(entry.team);
        } else {
            refused(clubErrorText(e), RACE_CODES.has(e.code));
        }
        return;
    }
    const after = store.get(cid);
    const slug = after.sheets[result.id].team;
    // moves and holes for the stored version's date: the plan's for a version (controller ruling 15)
    const {moves, holes} = effects(before, after, after.sheets[result.id].date, now);
    const hint = teamHint(before, slug, entry.json, result.plan.riders.map(r => r.id), now);
    const importWarnings = entry.warnings ?? [];
    const importMore = entry.warningsMore ?? 0;
    // the stored version live now: its race's live pointer (a reload follows live); else the version
    const stored = after.sheets[result.id];
    const isLive = raceOf(after, slug, stored.date)?.live === result.id;
    redirectWithFlash(res, ctx, cid, cockpitPath(slug), storeResult(before, after, slug, {result, moves, holes, hint, importWarnings, importMore, now}),
        {query: isLive ? `?r=${stored.date}` : `?v=${result.id}`, hash: 'panel'});
}


// Make live of the Store form posted without confirm=1 (`form`, `input` its storeInput): when the
// rule says it asks (storeAsk, from a dry run of the same Store), the question on a page of its own
// (the version's words, "Make live anyway" posting every field again with confirm=1, the way back
// the team page with the entry picked) and true; else false (a dry run that is refused stores
// nothing: the Store itself refuses it with its words).
function asked(ctx, cid, res, before, entry, form, input) {
    let run;
    try {
        run = ctx.store.dryRun(cid, c => storeEntry(c, entry.id, input, {now: ctx.now, newId: () => randomId(6)}));
    } catch (e) {
        if (e instanceof ClubError) {
            return false;
        }
        throw e;
    }
    const ask = storeAsk(before, run.club, run.result, ctx.now);
    if (ask === null) {
        return false;
    }
    const sheet = run.club.sheets[run.result.id];
    const team = before.teams[entry.team].name;
    const fields = Object.fromEntries([...form].filter(([k]) => k !== 'club' && k !== 'confirm' && k !== 'live'));
    const back = `${cockpitPath(entry.team)}?e=${entry.id}`;
    html(res, 200, confirmPage(before, {...frameOf(ctx, cid), here: cockpitPath(entry.team), kicker: t('ui-club-team', {club: before.name, team}),
        trail: [{href: back, label: team}], heading: t('live-confirm-heading', {label: sheet.label, n: sheet.n}), words: ask.words,
        action: `/manage/inbox/${entry.id}`, fields: {...fields, live: 'on'}, button: t('live-confirm-button'), danger: false,
        back: {href: back, label: t('live-confirm-back', {team})}}));
    return true;
}


// Where Discard goes back to: /manage, or the team page of a team that exists; anything else (a
// plan page's or the build's own route, from before the team cockpit, too) /manage.
function backOf(club, back) {
    const m = /^\/manage\/team\/([^/?#]+)$/.exec(back);
    return m && isSlug(m[1]) && Object.hasOwn(club.teams, m[1]) ? back : '/manage';
}


// POST /manage/inbox/<id>/discard (back, confirm): removes the entry; 303 to `back` with what was
// discarded (or, for an entry that is gone, that it is). Without confirm=1 (B1, UI panel wave 2: the
// no-script path of the in-page confirm) an entry that is still there is asked about first, on a page
// of its own, and nothing changes.
function inboxDiscard(req, res, ctx, cid, form, id) {
    const {store, now} = ctx;
    const club = store.get(cid);
    const to = backOf(club, field(form, 'back'));
    const waiting = entryOf(club, id, now);
    if (waiting !== null && field(form, 'confirm') !== '1') {
        const riders = ridersLine(waiting);
        const team = /^\/manage\/team\/([^/]+)/.exec(to)?.[1] ?? null;
        // the crumbs end where the way back goes (backOf: the overview or a team page)
        const trail = team === null ? [] : [{href: to, label: club.teams[team].name}];
        html(res, 200, confirmPage(club, {...frameOf(ctx, cid), here: team === null ? '/manage' : `/manage/team/${team}`,
            kicker: club.name, trail, heading: t('ask-discard'), words: t('discard-confirm', {riders}), action: `/manage/inbox/${id}/discard`,
            fields: {back: to}, button: t('discard-yes'), back: {href: to, label: team === null ? t('tp-all-teams') : t('result-back', {team: club.teams[team].name})}}));
        return;
    }
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
