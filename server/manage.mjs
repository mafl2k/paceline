// The club's own routes, /manage* (spec §5.2, §5.4): the team picker, the upload page and the intake
// (upload-page.mjs; the inbox routes with the assign page, Store and Discard are manage-inbox.mjs), a
// new link by mail, an address change
// or a delete (each confirmed by mail, /t/ in web.mjs), log out, and the forms of the team pages
// (manage-teams.mjs) and of the club settings (manage-club.mjs), the team pages with their settings
// and the new-team page (team-page.mjs), a plan's versions page (versions-page.mjs), and the club
// settings (settings-page.mjs). Every request passes clubGate (web.mjs) first: a GET without a
// working club cookie goes to the start page, a POST must come from this site and carry one. Only
// GET /manage, a team page and its settings, a versions page, the new-team page, the club settings
// the upload page and the assign page are GETs; nothing a GET answers changes the club. Handlers re-read the club from the store after any await: store.change replaces the club
// object.
import {readBody, BODY_MS, HttpError, send, html, parseForm, parseMultipart} from './http.mjs';
import {t, T, maskAddress} from './pages.mjs';
import {
    clubGate, principal, noLonger, cookieClubs, rewriteClubCookie, redirect, methodNotAllowed, newLinkByMail, confirmByMail, mailAddress,
    FORM_BYTES,
} from './web.mjs';
import {uploadPage} from './upload-page.mjs';
import {ClubError, checkPlan, addEntry, MAX_RIDERS} from './club.mjs';
import {isSlug, randomId} from './ids.mjs';
import {isAddress} from './mail.mjs';
import {readSource, importSources, PlanError} from '../pages/src/engine/plan.mjs';
import {renderTeams, renderSettings, frameOf, clubErrorText, field, done, refuse, planOf, postedClub} from './manage-page.mjs';
import {takeFlash} from './flash.mjs';
import {teamPage, teamGonePage, teamSettingsPage, newTeamPage} from './team-page.mjs';
import {versionsPage, planGonePage} from './versions-page.mjs';
import {TEAM_FORMS} from './manage-teams.mjs';
import {CLUB_FORMS} from './manage-club.mjs';
import {handleInbox} from './manage-inbox.mjs';

export {clubErrorText};

// An upload: the planner JSON (a file or pasted) and the optional text export as one multipart
// body, with the team and the plan the page was opened for (`forPlan`). The old upload form's fields
// (label, date, as, live, base, event) are still read and ignored (Ruling 9): a page left open from
// before lands on the assign page instead of a 400. The raw planner files carry more than the stored sheet keeps (at most 64 KB), so the body
// may be larger than that: 256 KB (final review I1; spec: 1 MB, as IMPORT_BODY_MAX). A raw export
// with 40 riders and all of them in the roster again is about 90 KB. Read with the 30 s form deadline.
export const UPLOAD_BYTES = 256 * 1024;
const UPLOAD_PARTS = {files: ['json', 'text'], fields: ['club', 'team', 'forPlan', 'paste', 'label', 'date', 'as', 'live', 'base', 'event']};
// A text export longer than this is refused before matching: a sheet holds MAX_RIDERS riders.
const MAX_TEXT_ROWS = 4 * MAX_RIDERS;
// The shape of each file, counted before any parse (final review I1: 1 MB of `{},{},…` parsed to
// ~350000 objects and cost ~57 MB of RSS): nesting levels, objects and arrays, and commas as the
// rough count of elements. The planner export of 40 riders with all of them in the roster again
// has 5 levels, ~330 objects and ~2300 commas (tests/fixtures/rollers.json, 6 riders: 5, 30, 200).
export const UPLOAD_SHAPE = {depth: 16, containers: 4000, elements: 20000};
// Uploads in flight (final review I1): one per club and 8 on the server (limits.mjs, slots in
// ctx.web.sheetUploads); the next one gets 503 with Retry-After. Over the club's parse budget
// (ctx.web.sheetParses, 10 minutes, shared with the assign page's previews) 429, to try again when
// the window has passed.
const UPLOAD_RETRY_S = 5;
const PARSE_RETRY_S = 600;


// Whether the text holds more than UPLOAD_SHAPE allows, counted outside JSON strings. Linear and
// without allocation. Up to the first point where a text is no JSON, this counts exactly what
// JSON.parse would build, so no text that passes builds more than the caps allow; a text export
// passes it as well (160 rows have a few hundred commas).
function tooComplex(text) {
    let depth = 0, containers = 0, elements = 0, inString = false;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (inString) {
            if (c === 0x5c) {           // \ : the next character is escaped
                i++;
            } else if (c === 0x22) {    // "
                inString = false;
            }
        } else if (c === 0x22) {
            inString = true;
        } else if (c === 0x7b || c === 0x5b) {  // { [
            if (++depth > UPLOAD_SHAPE.depth || ++containers > UPLOAD_SHAPE.containers) {
                return true;
            }
        } else if (c === 0x7d || c === 0x5d) {  // } ]
            depth--;
        } else if (c === 0x2c && ++elements > UPLOAD_SHAPE.elements) {  // ,
            return true;
        }
    }
    return false;
}


// The upload's size before the plan engine sees it: riders plus bench of a JSON, rows of a text
// export, for the sources as readSource gives them. A refusal {code, error}, or null. Linear, so a large
// body of names cannot hold the server up (the cap-riders check in uploadSheet comes only after
// the matching).
function oversized(sources) {
    for (const {text, json: v} of sources) {
        // readSource gives no object for an array: importSources reads it as text
        if (v) {
            const keys = o => (o && typeof o === 'object' ? Object.keys(o) : []);
            const riders = new Set(keys(v.riders));
            const count = riders.size + keys(v.roster).filter(id => !riders.has(id)).length;
            if (count > MAX_RIDERS) {
                return {code: 'cap-riders', error: clubErrorText(new ClubError('cap-riders', {max: MAX_RIDERS, count}))};
            }
        } else {
            let rows = 0;
            for (const line of text.split('\n')) {
                rows += line.trim() ? 1 : 0;
            }
            if (rows > MAX_TEXT_ROWS + 1) {  // + the header row
                return {code: 'text-rows', error: t('upload-text-rows', {max: MAX_TEXT_ROWS})};
            }
        }
    }
    return null;
}


// The checks of the arriving files' texts before they become an entry, shared by the upload and the
// ZwiftGopher push (push.mjs), in this order: the shape of each text before any parse (too-complex),
// one parse each, with `json` the one text must be a JSON object (bad-json), their size (cap-riders,
// text-rows) and the import (its PlanError code: not-a-plan, no-json, unreadable). {ok: true,
// sources, imported}, or {ok: false, code, error} with the text the upload page shows.
export function checkTexts(texts, {json = false} = {}) {
    if (texts.some(tooComplex)) {
        return {ok: false, code: 'too-complex', error: t('upload-shape')};
    }
    // the one parse of each file: the checks, the import and the entry share its object
    const sources = texts.map(readSource);
    if (json && sources.some(x => x.json === null)) {
        return {ok: false, code: 'bad-json', error: t('push-bad-json')};
    }
    const tooBig = oversized(sources);
    if (tooBig !== null) {
        return {ok: false, ...tooBig};
    }
    try {
        return {ok: true, sources, imported: importSources(sources)};
    } catch (e) {
        if (e instanceof PlanError) {
            const known = Object.hasOwn(T, `import-${e.code}`);
            return {ok: false, code: known ? e.code : 'unreadable', error: t(known ? `import-${e.code}` : 'import-unreadable')};
        }
        throw e;
    }
}


// "Plan on ZwiftGopher" of team `slug` (push.mjs), or null (no PUBLIC_URL, or no push in this ctx).
const plannerHref = (ctx, club, slug) => ctx.push?.href(club, slug, ctx.now) ?? null;


// GET /manage/upload?team=<slug>[&plan=<id>[&from=plan]]: the team's upload page, for a new version
// of `plan` when that is a race plan of the team (with from=plan its way back is that plan's page);
// 404 with the team-gone page for a team that does not exist.
function uploadFormPage(req, res, ctx, cid) {
    const club = ctx.store.get(cid);
    const params = new URL(req.url, 'http://localhost').searchParams;
    const slug = params.get('team') ?? '';
    if (!isSlug(slug) || !Object.hasOwn(club.teams, slug)) {
        html(res, 404, teamGonePage(club, frameOf(ctx, cid)));
        return;
    }
    html(res, 200, uploadPage(club, slug, {...frameOf(ctx, cid), plan: params.get('plan'), from: params.get('from'), planner: plannerHref(ctx, club, slug)}));
}


// GET /manage/team/<slug> and /manage/team/<slug>/settings (`raw`, the path segment as sent): the
// team page or its settings with its flash, or 404 with the team-gone page for a team that does not
// exist (or a segment that is no slug).
function teamPageOf(req, res, ctx, cid, raw, {settings = false} = {}) {
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
    if (settings) {
        const flash = takeFlash(req, res, ctx, cid, `/manage/team/${slug}/settings`);
        html(res, 200, teamSettingsPage(club, slug, {...frameOf(ctx, cid), flash, push: ctx.push?.on === true}));
    } else {
        const flash = takeFlash(req, res, ctx, cid, `/manage/team/${slug}`);
        html(res, 200, teamPage(club, slug, {...frameOf(ctx, cid), flash}));
    }
}


// An upload takes the club's slot in ctx.web.sheetUploads (one in flight per club, 8 on this server)
// and counts against its parse budget ctx.web.sheetParses (60 per 10 minutes, counted when the slot
// is taken; the assign page's previews count there too, manage-inbox.mjs). `refused(status, text)`
// answers when either says no (503 with Retry-After 5, 429 with Retry-After 600), before the body is
// read; else `fn` runs with the slot and gives it back however it ends. One club's slow body holds no
// other club up. A body cut off at its deadline (408) is logged with the club id (never a Zwift ID);
// the server's handler answers an HttpError (from the body or the form).
async function withParse(res, ctx, cid, refused, fn) {
    const slots = ctx.web.sheetUploads;
    const got = slots.take(cid);
    if (got !== 'ok') {
        res.setHeader('Retry-After', String(UPLOAD_RETRY_S));
        refused(503, t(got === 'busy' ? 'upload-busy' : 'upload-busy-server'));
        return;
    }
    try {
        if (!ctx.web.sheetParses.allow(cid, ctx.now)) {
            res.setHeader('Retry-After', String(PARSE_RETRY_S));
            refused(429, t('upload-budget'));
            return;
        }
        await fn();
    } catch (e) {
        if (e instanceof HttpError && e.status === 408) {
            console.warn(`paceline-server: sheet upload of club ${cid} cut off, the body took over ${ctx.web.sheetBodyMs / 1000} s`);
        }
        throw e;
    } finally {
        slots.release(cid);
    }
}


// The body of an upload, read and checked (spec §5.2): the principal again (the link may have been
// replaced while the body came in), the form, the team, the shape of each file, one parse each,
// their size and the import, in this order. {ok: true, slug, forPlan, via, sources, imported}; or
// {ok: false, status, error, slug, forPlan}: 403 when the principal is gone, 409 for a page of
// another club (its club field, as postedClub in manage-page.mjs), 400 for a team that does
// not exist (slug null) or a refusal (the text the upload page shows). File content reaches a page
// only as names, escaped there. A body too large or too slow (readBody) or no form (parseMultipart)
// throws an HttpError.
async function readUpload(req, ctx, cid) {
    const body = await readBody(req, UPLOAD_BYTES, ctx.web.sheetBodyMs);
    const who = principal(req, ctx);
    if (!who || who.circle !== cid) {
        return {ok: false, status: 403, error: t('manage-no-longer'), slug: null, forPlan: null};
    }
    const parts = parseMultipart(body, req.headers['content-type'], UPLOAD_PARTS);
    // a leading BOM goes, as the mod's Blob.text() drops it
    const utf8 = buf => buf.toString('utf8').replace(/^\uFEFF/, '');
    const field = k => (parts[k] === null ? '' : utf8(parts[k]));
    // a file input left empty comes as a part without bytes (F30)
    const file = k => (parts[k] !== null && parts[k].length > 0 ? utf8(parts[k]) : null);
    if (field('club') !== cid) {
        return {ok: false, status: 409, error: t(field('club') ? 'manage-other-club' : 'out-of-date'), slug: null, forPlan: null};
    }
    const club = ctx.store.get(cid);
    const slug = field('team');
    if (!isSlug(slug) || !Object.hasOwn(club.teams, slug)) {
        return {ok: false, status: 400, error: t('tp-gone'), slug: null, forPlan: null};
    }
    const forPlan = field('forPlan') || null;
    const refused = error => ({ok: false, status: 400, error, slug, forPlan});
    const paste = field('paste').trim() ? field('paste') : null;
    const jsonText = file('json') ?? paste;
    const via = file('json') === null && paste !== null ? 'paste' : 'file';
    const texts = [jsonText, file('text')].filter(x => x !== null);
    const read = checkTexts(texts);
    if (!read.ok) {
        return refused(read.error);
    }
    return {ok: true, slug, forPlan, via, sources: read.sources, imported: read.imported};
}


// The team named by the upload's ?team= (the form's action), when it exists, else null.
function queryTeam(req, club) {
    const slug = new URL(req.url, 'http://localhost').searchParams.get('team') ?? '';
    return isSlug(slug) && Object.hasOwn(club.teams, slug) ? slug : null;
}


// The upload page of `slug` (for a new version of `plan`; `from` as uploadPage's) with a refusal at
// its top, or the team-gone page without the team.
function refusedPage(res, ctx, cid, slug, status, text, plan = null, from = null) {
    const club = ctx.store.get(cid);
    const flash = {kind: 'err', text};
    html(res, status, slug !== null && Object.hasOwn(club.teams, slug) ? uploadPage(club, slug, {...frameOf(ctx, cid), plan, from, flash, planner: plannerHref(ctx, club, slug), refresh: false})
        : teamGonePage(club, {...frameOf(ctx, cid), flash}));
}


// POST /manage/upload?team=<slug>[&plan=<id>[&from=plan]] (plan versions spec §5.2, §5.3): the
// intake. Busy or over the budget, the team's upload page with the refusal (for the plan and with
// the way back of the query: the body is not read). Every refusal of the body (too large for a plan,
// an import error, a content check, a ClubError) answers 400 with the team's upload page and the text
// at its top (for a team that does not exist, the team-gone page), and makes no entry. Otherwise the
// plan, as checkPlan strips it, becomes an inbox entry with the import warnings, and the answer is
// 303 to its assign page. None of these pages reloads itself.
async function upload(req, res, ctx, cid) {
    const query = new URL(req.url, 'http://localhost').searchParams;
    const from = query.get('from');
    const busy = (status, text) => refusedPage(res, ctx, cid, queryTeam(req, ctx.store.get(cid)), status, text, query.get('plan'), from);
    await withParse(res, ctx, cid, busy, async () => {
        const read = await readUpload(req, ctx, cid);
        if (!read.ok && read.status === 403) {
            noLonger(req, res, ctx);
            return;
        }
        if (!read.ok && read.status === 409) {
            refuse(res, ctx, cid, read.error, {status: 409});
            return;
        }
        if (!read.ok) {
            if (read.slug === null) {
                html(res, read.status, teamGonePage(ctx.store.get(cid), frameOf(ctx, cid)));
            } else {
                refusedPage(res, ctx, cid, read.slug, read.status, read.error, read.forPlan, from);
            }
            return;
        }
        const {slug, forPlan, via, imported} = read;
        const {store, now} = ctx;
        let id;
        try {
            const checked = checkPlan(imported.json, imported.text);
            id = store.change(cid, c => addEntry(c, {
                source: 'upload', team: slug, forPlan, via, json: checked.json, text: checked.text, warnings: imported.warnings,
            }, {now, newId: () => randomId(6)}));
        } catch (e) {
            if (e instanceof ClubError) {
                refusedPage(res, ctx, cid, slug, 400, clubErrorText(e), forPlan, from);
                return;
            }
            throw e;
        }
        redirect(res, `/manage/inbox/${id}`);
    });
}


// GET /manage/team/<slug>/plan/<id> (`rawSlug`, `rawId`: the path segments as sent): the versions page
// of the plan that `id` names, with its flash; 404 with the team-gone page for a team that does not
// exist, with the plan-gone page for a plan that does not (or a segment that is no id).
function versionsPageOf(req, res, ctx, cid, rawSlug, rawId) {
    const club = ctx.store.get(cid);
    const decode = raw => {
        try {
            return decodeURIComponent(raw);
        } catch {
            return '';
        }
    };
    const slug = decode(rawSlug);
    const id = decode(rawId);
    if (!isSlug(slug) || !Object.hasOwn(club.teams, slug)) {
        html(res, 404, teamGonePage(club, frameOf(ctx, cid)));
        return;
    }
    if (!planOf(club, slug, id)) {
        html(res, 404, planGonePage(club, slug, frameOf(ctx, cid)));
        return;
    }
    const flash = takeFlash(req, res, ctx, cid, `/manage/team/${slug}/plan/${id}`);
    html(res, 200, versionsPage(club, slug, id, {...frameOf(ctx, cid), flash}));
}


// The club settings are where these three go back to; a mail that could not be sent is an error
// flash there, not a refusal.
const SETTINGS = {page: 'settings'};


function newLink(req, res, ctx, cid) {
    const club = ctx.store.get(cid);
    if (newLinkByMail(ctx, club)) {
        done(res, ctx, cid, SETTINGS, t('newlink-sent', {masked: maskAddress(club.email)}));
    } else {
        done(res, ctx, cid, SETTINGS, t('newlink-failed'), 'err');
    }
}


// An address change or a delete: nothing changes yet. A confirm link goes to the club's current
// address (spec §5.1), so a leaked club link alone can neither take the address nor delete the club.
// The new address is checked for its syntax only, never against other clubs (F32), and shows only
// masked, so the answer tells nothing about it.
function confirmDone(res, ctx, cid, what) {
    const club = ctx.store.get(cid);
    if (confirmByMail(ctx, club, what)) {
        done(res, ctx, cid, SETTINGS, t('confirm-sent', {masked: maskAddress(club.email)}));
    } else {
        done(res, ctx, cid, SETTINGS, t('confirm-failed'), 'err');
    }
}


// POST /manage/email (email)
function changeEmail(req, res, ctx, cid, form) {
    const email = mailAddress(field(form, 'email'));
    if (!isAddress(email)) {
        refuse(res, ctx, cid, t('register-email-bad'), {place: SETTINGS});
        return;
    }
    confirmDone(res, ctx, cid, {action: 'email', email});
}


// POST /manage/delete
function deleteClub(req, res, ctx, cid) {
    confirmDone(res, ctx, cid, {action: 'delete'});
}


// POST /manage/upload/preview, from an upload page drawn before the assign page took the preview's
// place (Ruling 9): nothing changes; 303 to the teams with the out-of-date flash.
function previewGone(req, res, ctx, cid) {
    done(res, ctx, cid, {page: 'teams'}, t('out-of-date'), 'err');
}


// The urlencoded forms: path -> handler(req, res, ctx, cid, form).
const FORMS = {
    '/manage/newlink': newLink, '/manage/email': changeEmail, '/manage/delete': deleteClub, '/manage/upload/preview': previewGone,
    ...TEAM_FORMS, ...CLUB_FORMS,
};


// The routes of this module; false when the path is not under /manage. `method` has HEAD as GET.
// ctx: {store, cfg, mailer, now (ms), web, logs}.
export async function handleManage(req, res, ctx, p, method) {
    if (p !== '/manage' && !p.startsWith('/manage/')) {
        return false;
    }
    const gate = clubGate(req, res, ctx, method);
    if (!gate) {
        return true;
    }
    // the other clubs this browser's cookie opens (their ids): the footer offers a switch to each
    ctx = {...ctx, others: gate.others};
    if (p === '/manage') {
        if (method === 'GET') {
            html(res, 200, renderTeams(ctx, gate.circle, {flash: takeFlash(req, res, ctx, gate.circle, '/manage')}));
        } else {
            methodNotAllowed(res, 'GET');
        }
        return true;
    }
    if (p === '/manage/upload') {
        if (method === 'POST') {
            await upload(req, res, ctx, gate.circle);
        } else if (method === 'GET') {
            uploadFormPage(req, res, ctx, gate.circle);
        } else {
            methodNotAllowed(res, 'GET, POST');
        }
        return true;
    }
    const inbox = /^\/manage\/inbox\/([^/]+)(\/discard)?$/.exec(p);
    if (inbox) {
        await handleInbox(req, res, ctx, gate.circle, inbox[1], inbox[2] !== undefined, method);
        return true;
    }
    const team = /^\/manage\/team\/([^/]*)(\/settings)?$/.exec(p);
    const versions = /^\/manage\/team\/([^/]*)\/plan\/([^/]*)$/.exec(p);
    if (team || versions || p === '/manage/new-team' || p === '/manage/settings') {
        if (method !== 'GET') {
            methodNotAllowed(res, 'GET');
        } else if (versions) {
            versionsPageOf(req, res, ctx, gate.circle, versions[1], versions[2]);
        } else if (team) {
            teamPageOf(req, res, ctx, gate.circle, team[1], {settings: team[2] !== undefined});
        } else if (p === '/manage/settings') {
            html(res, 200, renderSettings(ctx, gate.circle, {flash: takeFlash(req, res, ctx, gate.circle, p)}));
        } else {
            html(res, 200, newTeamPage(ctx.store.get(gate.circle), {...frameOf(ctx, gate.circle), flash: takeFlash(req, res, ctx, gate.circle, p)}));
        }
        return true;
    }
    const handler = Object.hasOwn(FORMS, p) ? FORMS[p] : null;
    if (!handler && p !== '/manage/logout') {
        send(res, 404, 'text/plain; charset=utf-8', 'not found');
        return true;
    }
    if (method !== 'POST') {
        methodNotAllowed(res, 'POST');
        return true;
    }
    const form = parseForm(await readBody(req, FORM_BYTES, BODY_MS));
    // Log out of a club this cookie holds, open or not (a page left open in another tab): always safe
    // to honour, so it goes; / then leads to the next club the cookie opens (its /manage), or to the
    // start page when none is left. Same origin: clubGate.
    const posted = form.get('club') ?? '';
    if (p === '/manage/logout' && cookieClubs(req, ctx).some(c => c.circle === posted)) {
        rewriteClubCookie(req, res, ctx, {without: posted});
        redirect(res, '/');
        return true;
    }
    // the link may have been replaced while the body came in, and the page must be of the open club
    // (the old preview route changes nothing: any page may still get its answer)
    // (a Log out without a club the cookie holds ends here too: 403 or 409, nothing changes)
    const who = postedClub(req, res, ctx, gate.circle, handler === previewGone ? null : posted);
    if (!who) {
        return true;
    }
    await handler(req, res, ctx, who.circle, form);
    return true;
}
