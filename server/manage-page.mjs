// What the /manage routes share: the team picker (renderTeams), the club settings (renderSettings),
// the text of a ClubError, the form fields, the places an action goes back to (placePath) and their
// pages (renderPlace), and the answers every form gives (done, refuse, attempt). The routes are in
// manage.mjs, the team forms in manage-teams.mjs, the club settings' in manage-club.mjs.
import {html} from './http.mjs';
import {t} from './pages.mjs';
import {teamsPage} from './teams-page.mjs';
import {teamGonePage, teamSettingsPage, newTeamPage} from './team-page.mjs';
import {settingsPage} from './settings-page.mjs';
import {ClubError} from './club.mjs';
import {isSlug, SHEET_RE} from './ids.mjs';
import {planOfId} from './plans.mjs';
import {redirectWithFlash} from './flash.mjs';
import {principal, noLonger} from './web.mjs';
import {frameOf, clubErrorText} from './manage-frame.mjs';
import {renderCockpit} from './manage-cockpit.mjs';
import {cockpitPath} from './cockpit-page.mjs';

// The captain frame's clock, riders seen and other clubs (a leaf module: manage-cockpit.mjs uses it
// too, without an import cycle).
export {frameOf};


// The team picker of club `cid` as HTML, with an optional flash ({kind: 'ok' | 'err', text});
// `refresh` false keeps it from reloading itself near a start.
export function renderTeams(ctx, cid, {flash = null, refresh = true} = {}) {
    return teamsPage(ctx.store.get(cid), {...frameOf(ctx, cid), flash, refresh});
}


// The club settings of club `cid` as HTML, with an optional flash and the club form filled with
// `typed` ({name}) after a refusal.
export function renderSettings(ctx, cid, {flash = null, typed = null} = {}) {
    const {store, cfg, logs} = ctx;
    return settingsPage(store.get(cid), {
        ...frameOf(ctx, cid), cfg, recordings: {files: logs.list(cid), bytes: logs.circleBytes(cid)}, flash, typed,
    });
}


// The page text of a ClubError: in the leaf manage-frame.mjs (the cockpit's dry run needs it).
export {clubErrorText};


// ---- the forms of the captain pages (urlencoded, POST) ----

export const field = (form, k) => String(form.get(k) ?? '');

export const teamOf = (club, slug) => (isSlug(slug) && Object.hasOwn(club.teams, slug) ? club.teams[slug] : null);

// The plan of team `slug` that `id` names (its plan id or a version id), or null.
export const planOf = (club, slug, id) => (teamOf(club, slug) && typeof id === 'string' && SHEET_RE.test(id)
    ? planOfId(club, slug, id) : null);

// A sheet of team `slug`, or null.
export const sheetOf = (club, slug, id) => (teamOf(club, slug) && Object.hasOwn(club.sheets, id) && club.sheets[id].team === slug
    ? club.sheets[id] : null);


// The page an action goes back to (spec §5.4): {page: 'team', slug, v?, e?}, {page:
// 'team-settings', slug}, {page: 'new-team'}, {page: 'settings'} or {page: 'teams'}. The team place
// is its team page (the team cockpit, team cockpit spec §8; `v` or `e` its selection, the query
// placeQuery gives), the team-settings place the team's settings, new-team the new-team page,
// settings the club settings, teams the team picker /manage. A place from before the switch
// (`versions`, a plan's page) is no place any more: every caller names the team place instead.
export function placePath(place) {
    if (place.page === 'team') {
        return cockpitPath(place.slug);
    }
    if (place.page === 'team-settings') {
        return `/manage/team/${place.slug}/settings`;
    }
    if (place.page === 'settings') {
        return '/manage/settings';
    }
    return place.page === 'new-team' ? '/manage/new-team' : '/manage';
}


// The place of a team form's answer: the team page with the selection `sel` ({v} or {e}).
export const teamPlace = (slug, sel = {}) => ({page: 'team', slug, ...sel});

// The query of a place's selection: '?v=<id>', '?e=<id>', '?r=<race date>' (that race's live version,
// whichever it is: where an action that made a version live lands, so a reload follows live) or ''.
export function placeQuery(place) {
    return typeof place.v === 'string' ? `?v=${place.v}` : typeof place.e === 'string' ? `?e=${place.e}` : typeof place.r === 'string' ? `?r=${place.r}` : '';
}


// The page of `place` as HTML, drawn now (a refusal answers with it): the team page with the
// place's selection, which then never reloads itself, or the team's settings (neither of a team that
// is no more: then the team-gone page); the new-team page; the club settings; for the teams place
// the team picker, which then never reloads itself either. `typed` (what was posted) fills the forms
// of the team settings, the new-team page and the club settings again.
export function renderPlace(ctx, cid, place, {flash = null, typed = null} = {}) {
    const club = ctx.store.get(cid);
    const frame = frameOf(ctx, cid);
    if (place.page === 'team' || place.page === 'team-settings') {
        if (!teamOf(club, place.slug)) {
            return teamGonePage(club, {...frame, flash});
        }
        return place.page === 'team' ? renderCockpit(ctx, cid, place.slug, {v: place.v ?? null, e: place.e ?? null, r: place.r ?? null, flash, refresh: false})
            : teamSettingsPage(club, place.slug, {...frame, flash, typed, push: ctx.push?.on === true});
    }
    if (place.page === 'new-team') {
        return newTeamPage(club, {...frame, flash, typed});
    }
    if (place.page === 'settings') {
        return renderSettings(ctx, cid, {flash, typed});
    }
    return renderTeams(ctx, cid, {flash, refresh: false});
}


// After the body of a /manage POST: who is asking, again. It must still be the club the gate saw
// (`cid`; the link may have been replaced while the body came in): else 403 (noLonger). And it must
// be the club the page names, `posted` (its hidden club field, withClub in ui.mjs): a page of
// another club (the captain switched in another tab, or the page's club link ended and the cookie
// fell through to the next club) gets 409 with the open club's teams and the reason, and nothing
// changes; a form without one (a page from before the field) the same, as out of date. `posted`
// null skips that check: only for a route that changes nothing. The principal, or null when the
// answer is sent.
export function postedClub(req, res, ctx, cid, posted) {
    const who = principal(req, ctx);
    if (!who || who.circle !== cid) {
        noLonger(req, res, ctx);
        return null;
    }
    if (posted !== null && posted !== who.circle) {
        refuse(res, ctx, who.circle, t(posted ? 'manage-other-club' : 'out-of-date'), {status: 409});
        return null;
    }
    return who;
}


// What was done, as a one-shot flash on the page of `place`: 303 there (POST -> 303 -> GET). `extra`
// goes into the flash ({undo}: a change of the live plan offers Undo in the panel's head).
// `extra.anchor` (a string, an element id: a race's 'race-<date>', a plan's block) is the 303's
// fragment and stays out of the flash. A team place with a selection goes to it (its query) and
// lands on the panel (#panel), whose head shows the flash.
export function done(res, ctx, cid, place, text, kind = 'ok', extra = {}) {
    const {anchor, ...rest} = extra;
    const query = placeQuery(place);
    const hash = query !== '' ? 'panel' : typeof anchor === 'string' ? anchor : null;
    redirectWithFlash(res, ctx, cid, placePath(place), {kind, text, ...rest}, {hash, query});
}


// A refusal: the page of `place` with the text as an error flash, its form filled with `typed`.
export function refuse(res, ctx, cid, text, {status = 400, place = {page: 'teams'}, typed = null} = {}) {
    html(res, status, renderPlace(ctx, cid, place, {flash: {kind: 'err', text}, typed}));
}


// store.change(cid, fn, {archive, also}) as {result}; a ClubError is refused on the page of `place`
// (409 for a team that changed meanwhile, else 400; `word` may word it; `typed` as for refuse) and
// gives null. Other errors go up.
export function attempt(res, ctx, cid, fn, {place = {page: 'teams'}, word = clubErrorText, typed = null, archive = 'force', also = null} = {}) {
    try {
        return {result: ctx.store.change(cid, fn, {archive, also})};
    } catch (e) {
        if (!(e instanceof ClubError)) {
            throw e;
        }
        refuse(res, ctx, cid, word(e), {status: e.code === 'changed' ? 409 : 400, place, typed});
        return null;
    }
}
