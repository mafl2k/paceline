// What the /manage routes share: the team picker (renderTeams), the club settings (renderSettings),
// the text of a ClubError, the form fields, the places an action goes back to (placePath) and their
// pages (renderPlace), and the answers every form gives (done, refuse, attempt). The routes are in
// manage.mjs, the team forms in manage-teams.mjs, the club settings' in manage-club.mjs.
import {html} from './http.mjs';
import {t, T} from './pages.mjs';
import {teamsPage} from './teams-page.mjs';
import {teamPage, teamGonePage, teamSettingsPage, newTeamPage} from './team-page.mjs';
import {versionsPage, planGonePage} from './versions-page.mjs';
import {settingsPage} from './settings-page.mjs';
import {ClubError} from './club.mjs';
import {isSlug, SHEET_RE} from './ids.mjs';
import {planOfId} from './plans.mjs';
import {redirectWithFlash} from './flash.mjs';
import {principal, noLonger} from './web.mjs';


// What the captain frame (ui.mjs captainPage) of club `cid` draws its sidebar with, for every
// captain page: the clock, the riders seen (the team rows' states) and `others`: the other clubs
// this browser's cookie opens ({id, name}, in its order; ctx.others from handleManage holds their
// ids), each a switch in the footer, which then also has "Log out of <club>" and "Log out of all
// clubs". A club gone since the gate looked is left out.
export function frameOf(ctx, cid) {
    const others = (ctx.others ?? []).map(id => ctx.store.get(id)).filter(Boolean).map(c => ({id: c.id, name: c.name}));
    return {now: ctx.now, seen: ctx.store.seenOf(cid), others};
}


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


// The page text of a ClubError (T['club-' + code] with its vars).
export function clubErrorText(e) {
    const key = `club-${e.code}`;
    return Object.hasOwn(T, key) ? t(key, e.vars) : String(e.code);
}


// ---- the forms of the captain pages (urlencoded, POST) ----

export const field = (form, k) => String(form.get(k) ?? '');

export const teamOf = (club, slug) => (isSlug(slug) && Object.hasOwn(club.teams, slug) ? club.teams[slug] : null);

// The plan of team `slug` that `id` names (its plan id or a version id), or null.
export const planOf = (club, slug, id) => (teamOf(club, slug) && typeof id === 'string' && SHEET_RE.test(id)
    ? planOfId(club, slug, id) : null);

// A sheet of team `slug`, or null.
export const sheetOf = (club, slug, id) => (teamOf(club, slug) && Object.hasOwn(club.sheets, id) && club.sheets[id].team === slug
    ? club.sheets[id] : null);


// The page an action goes back to (spec §5.4): {page: 'team', slug}, {page: 'team-settings', slug},
// {page: 'versions', slug, plan}, {page: 'new-team'}, {page: 'settings'} or {page: 'teams'}. The team
// place is its team page, the team-settings place the team's settings, versions the versions page of
// plan `plan` (an id of it), new-team the new-team page, settings the club settings, teams the team
// picker /manage.
export function placePath(place) {
    if (place.page === 'team') {
        return `/manage/team/${place.slug}`;
    }
    if (place.page === 'versions') {
        return `/manage/team/${place.slug}/plan/${place.plan}`;
    }
    if (place.page === 'team-settings') {
        return `/manage/team/${place.slug}/settings`;
    }
    if (place.page === 'settings') {
        return '/manage/settings';
    }
    return place.page === 'new-team' ? '/manage/new-team' : '/manage';
}


// The page of `place` as HTML, drawn now (a refusal answers with it): the team page, which then
// never reloads itself, the team's settings or a plan's versions page (none of them a team that is no
// more: then the team-gone page; nor a plan that is no more: then the plan-gone page); the new-team
// page; the club settings; for the teams place the team picker, which
// then never reloads itself either. `typed` (what was posted) fills the forms of the team settings,
// the new-team page and the club settings again.
export function renderPlace(ctx, cid, place, {flash = null, typed = null} = {}) {
    const club = ctx.store.get(cid);
    const frame = frameOf(ctx, cid);
    if (place.page === 'team' || place.page === 'team-settings' || place.page === 'versions') {
        if (!teamOf(club, place.slug)) {
            return teamGonePage(club, {...frame, flash});
        }
        if (place.page === 'versions') {
            return planOf(club, place.slug, place.plan) ? versionsPage(club, place.slug, place.plan, {...frame, flash, planner: ctx.push?.href(club, place.slug, ctx.now) ?? null})
                : planGonePage(club, place.slug, {...frame, flash});
        }
        return place.page === 'team' ? teamPage(club, place.slug, {...frame, flash, refresh: false, planner: ctx.push?.href(club, place.slug, ctx.now) ?? null})
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
// goes into the flash. A change of the live plan passes {row, undo} (user, 19 Nov 2026: Undo where
// the action was): `row` the id of the plan live now, whose row (team page) or head (plan page)
// shows the flash in place of the top flash, with Undo when `undo`; the 303 lands on that row
// (#plan-<row>).
export function done(res, ctx, cid, place, text, kind = 'ok', extra = {}) {
    redirectWithFlash(res, ctx, cid, placePath(place), {kind, text, ...extra}, {hash: typeof extra.row === 'string' ? `plan-${extra.row}` : null});
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
