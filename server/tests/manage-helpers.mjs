// What the /manage tests share (manage.test.mjs, captain.test.mjs): Kettenfett RC with its teams
// and link cookie, a second club, uploads, a server on a mutable clock, form and upload POSTs, the
// intake with Store, the visible text of a page and its flash.
import assert from 'node:assert/strict';
import {startServer, planJson, T, pageFields, seedDb, clubJson} from './helpers.mjs';
import {newClub, addTeam, uploadSheet} from '../club.mjs';
import {newToken, randomId} from '../ids.mjs';
import {addLink, openLink} from '../tokens.mjs';

export const CID = 'k7f3q9x2m4';
export const DATE = '2026-11-19';
export const NOW = T('2026-11-19T18:25:00Z');
export const SETUP_AT = T('2026-11-10T10:00:00Z');
export const ROLLERS = ['1001', '1002', '1003', '1004', '1005', '1006', '1007', '1008'];
export const iso = ms => new Date(ms).toISOString();
// the hidden field every form of Kettenfett RC's pages that posts to /manage starts with (withClub)
export const CLUB_FIELD = `<input type="hidden" name="club" value="${CID}">`;


// Kettenfett RC, active, with its teams and an active link. The cookie holds that link.
export function makeClub({name = 'Kettenfett RC', teams = [['Rollers', '19:30'], ['Sprockets', '19:40']]} = {}) {
    const club = newClub({id: CID, name, email: 'captain@example.org', tz: 'Europe/Berlin', now: SETUP_AT});
    club.status = 'active';
    club.confirmedAt = iso(SETUP_AT);
    const tk = newToken();
    addLink(club, SETUP_AT, tk);
    openLink(club, tk.hash, SETUP_AT);
    const slugs = teams.map(([n, start]) => addTeam(club, {name: n, start}, {slugTaken: () => false, now: SETUP_AT}));
    return {club, slugs, cookie: `__Host-pl_club=${tk.token}`};
}


// Spokesmen CC (p2m8c4t1v9), active, with its teams and its own link: {club, slugs, cookie}. The
// test stores it (srv.store.create).
export function secondClub({teams = []} = {}) {
    const club = newClub({id: 'p2m8c4t1v9', name: 'Spokesmen CC', email: 'spokes@example.org', tz: 'Europe/Berlin', now: SETUP_AT});
    club.status = 'active';
    club.confirmedAt = iso(SETUP_AT);
    const tk = newToken();
    addLink(club, SETUP_AT, tk);
    openLink(club, tk.hash, SETUP_AT);
    const slugs = teams.map(([n, start]) => addTeam(club, {name: n, start}, {slugTaken: () => false, now: SETUP_AT}));
    return {club, slugs, cookie: `__Host-pl_club=${tk.token}`};
}


// One upload for `date` (19 Nov), as a new plan with type `type` (none by default): its label is the
// team's name, plus " · type". The planner JSON (unless `json` is given) is named "<team> <type>".
// The version id.
export function upload(club, slug, {type = null, riders = [], bench = [], at, live = true, pinned = null, json = null, date = DATE}) {
    const name = type === null ? club.teams[slug].name : `${club.teams[slug].name} ${type}`;
    return uploadSheet(club, {
        slug, json: json ?? planJson(name, riders, bench), text: null, date, base: club.teams[slug].version,
        via: 'file', type, as: 'new', live, pinnedEventId: pinned,
    }, {now: at, newId: () => randomId(6)}).id;
}


// A server holding `club`; GET as the captain (or without a cookie). With `beforeStart` the club is
// in paceline.db before the server starts (so the start's sweep sees it).
export async function serve(t, {club, cookie}, {env = {}, now = NOW, beforeStart = false} = {}) {
    const clock = {now};
    const prepare = beforeStart ? dataDir => seedDb(dataDir, ({store}) => store.create(club)) : undefined;
    const srv = await startServer({env, clock, prepare});
    t.after(() => srv.stop());
    if (!beforeStart) {
        srv.store.create(club);
    }
    const get = (p = '/manage', c = cookie) => fetch(srv.base + p, {redirect: 'manual', headers: c ? {cookie: c} : {}});
    const body = async () => {
        const res = await get();
        assert.equal(res.status, 200);
        return res.text();
    };
    // a check recorded at `at` (the store stamps its own clock)
    const see = (aid, at, entry) => {
        clock.now = T(at);
        assert.ok(srv.store.see(CID, aid, entry), `see ${aid}`);
        clock.now = now;
    };
    return {...srv, clock, get, body, see};
}


// The visible text: tags out, entities decoded, white space collapsed.
export const textOf = html => html.replace(/<[^>]*>/g, ' ').replace(/&#39;/g, '\'').replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

export const count = (s, sub) => s.split(sub).length - 1;


// The whole element that starts at the first match of `open` (e.g. '<details class="more">'),
// nested elements of the same tag included; null without one.
export function element(html, open, from = 0) {
    const start = html.indexOf(open, from);
    if (start < 0) {
        return null;
    }
    const tag = /^<([a-z0-9]+)/.exec(open)[1];
    const re = new RegExp(`<${tag}[\\s>]|</${tag}>`, 'g');
    re.lastIndex = start + 1;
    let depth = 1;
    for (let m = re.exec(html); m; m = re.exec(html)) {
        depth += m[0].startsWith('</') ? -1 : 1;
        if (depth === 0) {
            return html.slice(start, m.index + m[0].length);
        }
    }
    return null;
}

// Every element that starts with `open`.
export function elements(html, open) {
    const out = [];
    for (let at = html.indexOf(open); at >= 0; at = html.indexOf(open, at + 1)) {
        out.push(element(html, open, at));
    }
    return out;
}


// The flash at the top of a page: {kind, text}, or null (a flash holds its text alone: no Undo in it
// any more, user 23 Nov 2026).
export function flashOf(body) {
    const m = /<div class="flash (ok|err)" role="status">[\s\S]*?<p>([^<]*)<\/p><\/div>/.exec(body);
    return m ? {kind: m[1], text: textOf(m[2]).trim()} : null;
}


// A urlencoded form POST as the captain (or without a cookie), with the page's club field
// (pageFields). {status, body, headers}.
export async function post(srv, cookie, p, fields = {}, {headers = {}} = {}) {
    const h = {'content-type': 'application/x-www-form-urlencoded', ...(cookie ? {cookie} : {}), ...headers};
    const body = new URLSearchParams(pageFields(srv.store, cookie, p, fields)).toString();
    const res = await fetch(srv.base + p, {method: 'POST', redirect: 'manual', headers: h, body});
    return {status: res.status, body: await res.text(), headers: res.headers};
}


// A form POST that answers 303 with a flash, followed: its Location is fetched with the club cookie
// and the flash cookie. {status, location, setCookie (all Set-Cookie lines), page, flash}.
export async function followPost(srv, cookie, p, fields = {}) {
    const res = await post(srv, cookie, p, fields);
    assert.equal(res.status, 303, `${p}: ${res.body}`);
    const location = res.headers.get('location');
    const setCookie = res.headers.getSetCookie();
    const pair = setCookie.map(c => c.split(';')[0]).find(c => c.startsWith('__Host-pl_flash='));
    assert.ok(pair, JSON.stringify(setCookie));
    const got = await fetch(srv.base + location, {redirect: 'manual', headers: {cookie: `${cookie}; ${pair}`}});
    assert.equal(got.status, 200, location);
    const page = await got.text();
    return {status: res.status, location, setCookie, page, flash: flashOf(page)};
}


export const VERSION_OF = (srv, slug) => srv.store.get(CID).teams[slug].version;
export const sheetsOf = (srv, slug) => Object.entries(srv.store.get(CID).sheets).filter(([, s]) => s.team === slug);
// Kettenfett RC's stored JSON text (its clubs row).
export const storedClub = srv => clubJson(srv.server.db, CID);


// POST /manage/upload?team=<team> as the upload page's form: string fields, `json` and `text` as
// files (an object is sent as JSON), with the page's club field (pageFields). `base` defaults to the
// team's version now. `path` posts the same form elsewhere (the preview).
export async function postUpload(srv, cookie, fields, {headers = {}, path: to = null} = {}) {
    const fd = new FormData();
    const p = to ?? `/manage/upload${fields.team === undefined ? '' : `?team=${encodeURIComponent(fields.team)}`}`;
    const all = pageFields(srv.store, cookie, p, {base: fields.team && srv.store.get(CID).teams[fields.team] ? VERSION_OF(srv, fields.team) : '', ...fields});
    for (const [k, v] of Object.entries(all)) {
        if (v === undefined) {
            continue;
        }
        if (k === 'json' || k === 'text') {
            const content = typeof v === 'string' ? v : JSON.stringify(v);
            fd.append(k, new Blob([content], {type: k === 'json' ? 'application/json' : 'text/plain'}), k === 'json' ? 'plan.json' : 'plan.txt');
        } else {
            fd.append(k, String(v));
        }
    }
    const h = cookie ? {cookie, ...headers} : headers;
    return fetch(srv.base + p, {method: 'POST', redirect: 'manual', headers: h, body: fd});
}

// The entry id of the intake's answer: the Location /manage/team/<slug>?e=<id>#panel (the team page
// with the entry picked).
function entryOfLocation(location) {
    const m = /^\/manage\/team\/[a-z0-9-]+\?e=([0-9a-hjkmnp-tv-z]{6})#panel$/.exec(location ?? '');
    assert.ok(m, location);
    return m[1];
}


// An upload through the intake: POST /manage/upload (expects 303 to the team page with the entry
// picked), then Store from its form (POST /manage/inbox/<id>) with `choices`: team (the upload's),
// as 'new', live 'on' (its Make live) with confirm '1' (its strip's confirm: Make live in the race
// window with another plan live asks first, user 23 Nov 2026; the tests of that question post
// without it), the team's version as base and drawn `<team>:<as>` (the form drawn for these
// choices) by default; a choice set to undefined is not sent; live '' is its Store (no confirm). {id, status, body, location} of the
// Store: after a 303 `body` is the page it leads to (fetched with the club cookie and the flash
// cookie, so its panel's head shows the Store flash), else the Store's own answer.
export async function storeUpload(srv, cookie, fields, choices = {}) {
    const res = await postUpload(srv, cookie, fields);
    const text = await res.text();
    assert.equal(res.status, 303, text);
    const id = entryOfLocation(res.headers.get('location'));
    const team = Object.hasOwn(choices, 'team') ? choices.team : fields.team;
    const base = team && srv.store.get(CID).teams[team] ? VERSION_OF(srv, team) : '';
    const merged = {team, as: 'new', live: 'on', base, ...choices};
    if (merged.live === 'on' && !Object.hasOwn(choices, 'confirm')) {
        merged.confirm = '1';
    }
    const all = {drawn: `${merged.team ?? ''}:${merged.as ?? ''}`, ...merged};
    const sent = Object.fromEntries(Object.entries(all).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
    return {id, ...await storePost(srv, cookie, id, sent)};
}

// Store of entry `id` (POST /manage/inbox/<id>) with `fields` as the form posts them: {status, body,
// location}. After a 303 `body` is the page it leads to (the team page with the stored version
// picked, fetched with the club cookie and the flash cookie: its panel's head shows the Store flash),
// else the Store's own answer (a refusal: the team page with the form as posted).
export async function storePost(srv, cookie, id, fields) {
    const stored = await post(srv, cookie, `/manage/inbox/${id}`, fields);
    if (stored.status !== 303) {
        return {status: stored.status, body: stored.body, location: null};
    }
    const location = stored.headers.get('location');
    const pair = stored.headers.getSetCookie().map(c => c.split(';')[0]).find(c => c.startsWith('__Host-pl_flash='));
    const got = await fetch(srv.base + location, {redirect: 'manual', headers: {cookie: pair ? `${cookie}; ${pair}` : cookie}});
    assert.equal(got.status, 200, location);
    return {status: 303, body: await got.text(), location};
}

// storeUpload that must answer 303 (to the team page with the stored version picked): the body of
// the page it leads to.
export async function storeOk(srv, cookie, fields, choices = {}) {
    const {status, body} = await storeUpload(srv, cookie, fields, choices);
    assert.equal(status, 303, body);
    return body;
}

// POST /manage/upload as the upload page: 303 to the team page with the entry picked; the entry id.
export async function intake(srv, cookie, fields) {
    const res = await postUpload(srv, cookie, fields);
    const text = await res.text();
    assert.equal(res.status, 303, text);
    return entryOfLocation(res.headers.get('location'));
}


// The upload page of a team (its body, after a 200).
export async function uploadPageOf(srv, cookie, slug) {
    const res = await srv.get(`/manage/upload?team=${slug}`, cookie);
    const body = await res.text();
    assert.equal(res.status, 200, body);
    return body;
}

// The upload form of a page: what is between its tags (the action names the team: ?team=<slug>).
export const formOf = body => {
    const m = /<form class="stack" method="post" action="\/manage\/upload\?team=[^"]*" enctype="multipart\/form-data" data-upload>([\s\S]*?)<\/form>/.exec(body);
    assert.ok(m, body);
    return m[1];
};


// Arm in place (UI panel wave 2, ui.mjs armForm): the form of an action that asks first in its place,
// the first one at or after `from` that posts to `action` (any with null), as drawn; null without one.
export function armOf(html, action = null, from = 0) {
    for (let at = html.indexOf('<form ', from); at >= 0; at = html.indexOf('<form ', at + 1)) {
        const tag = html.slice(at, html.indexOf('>', at) + 1);
        if (/ data-arm[ >]/.test(tag) && (action === null || tag.includes(`action="${action}"`))) {
            return html.slice(at, html.indexOf('</form>', at) + '</form>'.length);
        }
    }
    return null;
}


// Does the armed form `form` post `fields` (the markup of its hidden fields after the club's) to
// `action` without confirm, and its strip's confirm button `yes` (class `cls`) with confirm=1,
// described by the strip's words?
export function armHas(form, action, fields, cls, yes) {
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return typeof form === 'string' && new RegExp(`^<form (?:class="[^"]*" )?method="post" action="${esc(action)}" data-arm[ >]`).test(form)
        && form.includes(`>${CLUB_FIELD}${fields}`) && !form.includes('<input type="hidden" name="confirm"')
        && new RegExp(`<p id="(arm-[^"]+)">[^]*<button class="${esc(cls)}" type="submit" name="confirm" value="1" aria-describedby="\\1" data-arm-yes>${esc(yes)}</button>`).test(form);
}


// The Store flash in the panel's head of the team page a Store led to (store-form.mjs resultBlock):
// {kind, text, lines, links, all} (`lines` the texts of its result lines, `links` [href, text] of
// its ways to the teams still to do, `all` the text and the lines as one string, as the result page
// read); null without one.
export function storeFlash(body) {
    const panel = element(body, '<div id="panel"') ?? '';
    const flash = flashOf(panel);
    if (flash === null) {
        return null;
    }
    const result = element(panel, '<div class="result" data-hold-reload>') ?? '';
    const lines = [...result.matchAll(/<li class="[a-z]+"><svg[^>]*>[\s\S]*?<\/svg><span>([\s\S]*?)<\/span><\/li>/g)].map(m => textOf(m[1]).trim());
    const links = [...result.matchAll(/<a class="btn secondary block" href="([^"]*)">([^<]*)<\/a>/g)].map(m => [m[1].replace(/&amp;/g, '&'), textOf(m[2]).trim()]);
    return {...flash, lines, links, all: [flash.text, ...lines].join(' ')};
}
