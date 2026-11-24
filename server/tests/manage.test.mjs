// The /manage routes (plan 3, Task 5): the one-shot flash, the upload and the club actions. The
// team picker, the team page, the club settings and their tests are in captain.test.mjs.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {gzipSync, gunzipSync} from 'node:zlib';
import {planJson, sheet, T, CODE_SECRET, rows as dbRows, refuseWrites, liveId, race} from './helpers.mjs';
import {
    CID, DATE, NOW, SETUP_AT, ROLLERS, makeClub, secondClub, upload, serve, textOf, count, flashOf, post, followPost,
    postUpload, storeOk, storePost, storeFlash, intake, uploadPageOf, formOf, VERSION_OF, sheetsOf, storedClub, CLUB_FIELD, armOf, armHas, element,
} from './manage-helpers.mjs';
import {setRiderCode, uploadSheet, setRace, setStart, receiveEntry, addEntry} from '../club.mjs';
import {newRiderCode, riderCodeHash, formatRiderCode, tokenHash, randomId} from '../ids.mjs';
import {addLink, openLink} from '../tokens.mjs';


const FLASH_CLEARED = '__Host-pl_flash=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';

test('a POST answers 303 with a one-shot flash', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    // mail is off on this server
    const res = await post(srv, c.cookie, '/manage/newlink');
    assert.equal(res.status, 303, res.body);
    assert.equal(res.headers.get('location'), '/manage/settings');
    const set = res.headers.getSetCookie();
    assert.equal(set.length, 1, JSON.stringify(set));
    assert.match(set[0], /^__Host-pl_flash=[0-9a-hjkmnp-tv-z]{16}; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=300$/);
    const cookie = `${c.cookie}; ${set[0].split(';')[0]}`;
    // a flash for the club settings stays until that page is drawn
    const elsewhere = await srv.get('/manage', cookie);
    assert.equal(elsewhere.status, 200);
    assert.deepEqual(elsewhere.headers.getSetCookie(), []);
    assert.equal(flashOf(await elsewhere.text()), null);
    const got = await srv.get('/manage/settings', cookie);
    assert.equal(got.status, 200);
    assert.deepEqual(got.headers.getSetCookie(), [FLASH_CLEARED]);
    const body = await got.text();
    assert.deepEqual(flashOf(body), {kind: 'err', text: 'No mail was sent: the server cannot send mail right now. Try again later.'});
    // the page it lands on never reloads itself, even inside the refresh window
    assert.ok(!body.includes('http-equiv'));
    assert.ok(!body.includes('data-refresh'));
    // once
    const again = await srv.get('/manage/settings', cookie);
    assert.equal(again.status, 200);
    assert.equal(flashOf(await again.text()), null);
});


test('flash: HEAD never takes it, a stale id is cleared', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    // Spokesmen CC with its own link
    const other = secondClub();
    srv.store.create(other.club);
    // a team delete answers /manage
    const res = await post(srv, c.cookie, '/manage/team', {action: 'delete', team: 'sprockets', confirm: '1'});
    assert.equal(res.status, 303, res.body);
    assert.equal(res.headers.get('location'), '/manage');
    const pair = res.headers.getSetCookie()[0].split(';')[0];
    const DELETED = {kind: 'ok', text: 'Deleted Sprockets and its plans.'};

    const head = await fetch(srv.base + '/manage', {method: 'HEAD', redirect: 'manual', headers: {cookie: `${c.cookie}; ${pair}`}});
    assert.equal(head.status, 200);
    assert.deepEqual(head.headers.getSetCookie(), [], 'a HEAD leaves the cookie');
    // another club's GET with this id: no flash, the cookie stays
    const theirs = await srv.get('/manage', `${other.cookie}; ${pair}`);
    assert.equal(theirs.status, 200);
    assert.deepEqual(theirs.headers.getSetCookie(), []);
    const theirsBody = await theirs.text();
    assert.match(theirsBody, /<h1>Spokesmen CC<\/h1>/);
    assert.equal(flashOf(theirsBody), null);
    // Kettenfett's GET still shows it
    const got = await srv.get('/manage', `${c.cookie}; ${pair}`);
    assert.deepEqual(got.headers.getSetCookie(), [FLASH_CLEARED]);
    assert.deepEqual(flashOf(await got.text()), DELETED);
    // an unknown or malformed id: no flash, the cookie goes
    for (const id of ['zzzzzzzzzzzzzzzz', '../x']) {
        const stale = await srv.get('/manage', `${c.cookie}; __Host-pl_flash=${id}`);
        assert.equal(stale.status, 200, id);
        assert.deepEqual(stale.headers.getSetCookie(), [FLASH_CLEARED], id);
        assert.equal(flashOf(await stale.text()), null, id);
    }
});


// ---- the upload page /manage/upload?team=<slug>, the intake, the assign page /manage/inbox/<id>,
// Store and Discard, and the result page (plan versions, Task 7) ----


// A text export for these riders, tab-separated with its header row.
function textExport(ids, extra = []) {
    const rows = ids.map((id, i) => `${RIDERS_BY_ID[id]}\t${300 - i}\t60\tRed\t#ff0000`);
    return ['Name\tWatts\tPull\tColor\tHex', ...rows, ...extra].join('\n') + '\n';
}
const RIDERS_BY_ID = {1001: 'Ben', 1002: 'Cleo', 1003: 'Dan', 1004: 'Eva', 1005: 'Finn', 1006: 'Gus', 1007: 'Hanna', 1008: 'Ida', 1009: 'Jo'};

// The part of a page from `start` to the end of its element (sections hold no nested section).
const section = (body, start) => {
    const i = body.indexOf(start);
    assert.ok(i >= 0, `${start}\n${body}`);
    return body.slice(i, body.indexOf('</section>', i) + '</section>'.length);
};

const inboxOf = srv => srv.store.get(CID).inbox;

// GET of the Store form of entry `id`: the team page of the entry's team with it picked (?e=<id>, the
// assign page's place since the team cockpit; `query` the form's fields as a redraw sends them, '?…'
// or ''); an entry that is gone: its old URL, the entry-gone page. {status, headers, body}.
async function assignOf(srv, id, query = '') {
    const entry = srv.store.get(CID).inbox.find(e => e.id === id);
    const p = entry ? `/manage/team/${entry.team}?e=${id}${query.replace(/^\?/, '&')}` : `/manage/inbox/${id}${query}`;
    const res = await srv.get(p);
    return {status: res.status, headers: res.headers, body: await res.text()};
}

// The texts of the Store form's warning lines above its action bar, in order (the text of each
// line's own <span>; user, 23 Nov 2026: no "What happens" heading, no routine line; the diff summary
// is none of them: the rider table shows it); [] without any.
const whatHappens = body => [...(element(element(body, '<div id="panel-body"') ?? '', '<div class="cp-what"') ?? '')
    .matchAll(/<li class="(?:ok|info|warn|err)"><svg[^>]*>[\s\S]*?<\/svg><span>([^<]*)<\/span>/g)].map(m => textOf(m[1]).trim());

// The checked radios of a group.
const checkedOf = (body, name) => [...body.matchAll(new RegExp(`<input type="radio" name="${name}" value="([^"]*)" checked>`, 'g'))].map(m => m[1]);
// The Store form's action bar (user, 23 Nov 2026): Make live (primary) then Store (quiet), and no Make
// live box anywhere on the page.
// (Discard · Store · Make live, Make live the rightmost: user, 23 Nov 2026)
const barButtons = body => /<button class="btn secondary" type="submit" form="store-[^"]+" data-submit="store">Store<\/button><button class="btn primary" type="submit" form="store-[^"]+" name="live" value="on" aria-label="Store and make live"(?: data-arm-open)? data-submit="live">Make live<\/button>/.test(body)
    && !body.includes('type="checkbox" name="live"');

// The plan id of stored version `id`, and the back link of a page's back bar: [href, text].
const planIdOf = (srv, id) => srv.store.get(CID).sheets[id].plan;
const backOf = body => {
    const m = /<nav class="topbar plain" aria-label="Back">\s*<div class="topbar-row"><a class="back" href="([^"]*)"><svg[^>]*>[\s\S]*?<\/svg>([^<]*)<\/a>/.exec(body);
    return m && [m[1], m[2]];
};


test('upload page: the file only, with the plan it was opened for', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-15T14:00:00Z')});
    const sp = upload(c.club, 'sprockets', {riders: ['1009'], at: T('2026-11-15T14:05:00Z')});
    const srv = await serve(t, c, {now: T('2026-11-16T09:00:00Z')});
    // each team page links to it; the picker and the team pages have no upload form of their own
    for (const slug of ['rollers', 'sprockets']) {
        const team = await (await srv.get(`/manage/team/${slug}`)).text();
        assert.ok(team.includes(`href="/manage/upload?team=${slug}"`), slug);
        assert.ok(!team.includes('action="/manage/upload'), slug);
    }
    assert.ok(!(await srv.body()).includes('action="/manage/upload'), 'no form on the picker');
    const res = await srv.get(`/manage/upload?team=rollers&plan=${live}`);
    const page = await res.text();
    assert.equal(res.status, 200, page);
    assert.match(page, /<nav class="topbar plain" aria-label="Back">\s*<div class="topbar-row"><a class="back" href="\/manage\/team\/rollers"><svg[^>]*>[\s\S]*?<\/svg>Rollers<\/a><span class="topbar-club">Kettenfett RC<\/span><\/div>/);
    assert.ok(page.includes('<h1>Upload a plan for Rollers</h1>'), page);
    assert.ok(textOf(page).includes('as a new version of \'Rollers · fast\''), textOf(page));
    // the action keeps the plan, so a refusal before the body is read draws the same page (F5)
    assert.ok(page.includes(`<form class="stack" method="post" action="/manage/upload?team=rollers&amp;plan=${planIdOf(srv, live)}" enctype="multipart/form-data" data-upload>`), page);
    const f = formOf(page);
    assert.ok(f.includes('<input type="hidden" name="team" value="rollers">'), f);
    assert.ok(f.includes(`<input type="hidden" name="forPlan" value="${live}">`), f);
    assert.ok(f.includes('<label class="field">ZwiftGopher JSON export<input id="json-in" type="file" name="json" accept=".json,application/json"></label>'), f);
    assert.match(f, /<details class="fold"><summary>Paste the JSON instead<\/summary>[\s\S]*?<textarea name="paste"/);
    // the JSON only (races Task 7: the text upload went); only the paste is folded
    assert.ok(!f.includes('name="text"') && !textOf(f).includes('Text export'), f);
    assert.equal(count(f, 'type="file"'), 1, 'one file field');
    assert.equal(count(f, '<details'), 1, 'only the paste fold');
    assert.ok(!f.includes('data-text-fold'), f);
    // no auto-Continue: the captain presses Continue
    assert.ok(f.includes('<button class="btn primary block" type="submit">Continue</button>'), f);
    assert.ok(!page.includes('data-continue'), page);
    for (const gone of ['name="label"', 'name="as"', 'name="live"', 'name="date"', 'name="event"', 'name="base"', 'data-preview']) {
        assert.ok(!page.includes(gone), gone);
    }
    assert.ok(!page.includes('http-equiv'));
    assert.equal(count(page, '<script'), 1);
    // a plan of Sprockets, an unknown or no plan: no "as a new version"
    for (const q of [`&plan=${sp}`, '&plan=zzzzzz', '&plan=', '']) {
        const other = await (await srv.get(`/manage/upload?team=rollers${q}`)).text();
        assert.ok(!other.includes('as a new version'), q);
        assert.ok(formOf(other).includes('<input type="hidden" name="forPlan" value="">'), q);
        assert.ok(other.includes('action="/manage/upload?team=rollers" enctype'), q);
    }
    // without a principal: the start page, as every /manage GET
    assert.equal((await srv.get('/manage/upload?team=rollers', null)).status, 303);
    // race day near the start: the team picker reloads itself, the upload page never does
    srv.clock.now = NOW;
    assert.ok((await srv.body()).includes('http-equiv="refresh"'), 'the team picker');
    const race = await uploadPageOf(srv, c.cookie, 'rollers');
    assert.ok(!race.includes('http-equiv') && !race.includes('data-refresh'));
});


test('upload page: opened for a plan (a link already handed out); a `from` is ignored, the way back is the team page', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-15T14:00:00Z')});
    const sp = upload(c.club, 'sprockets', {riders: ['1009'], at: T('2026-11-15T14:05:00Z')});
    const srv = await serve(t, c, {now: T('2026-11-16T09:00:00Z')});
    const plan = planIdOf(srv, live);
    // the plan ⋯ on the team page draws no New version any more (user, 23 Nov 2026), nor a from; the
    // upload page still takes `plan=` (a hole's link, links already handed out)
    const team = await (await srv.get('/manage/team/rollers')).text();
    assert.equal(team.includes(`/manage/upload?team=rollers&amp;plan=${plan}`), false, team);
    assert.equal(team.includes('from=plan'), false);
    // a link from before the team cockpit (from=plan, from=cockpit), a plan of another team, an unknown
    // plan, no plan: the team page, and the action carries no from
    for (const q of [`&plan=${plan}`, `&plan=${plan}&from=plan`, `&plan=${plan}&from=cockpit`, `&plan=${planIdOf(srv, sp)}&from=plan`, '&plan=zzzzzz&from=plan', '&from=plan', '']) {
        const other = await (await srv.get(`/manage/upload?team=rollers${q}`)).text();
        assert.deepEqual(backOf(other), ['/manage/team/rollers', 'Rollers'], q);
        assert.ok(!other.includes('from='), q);
    }
    const page = await (await srv.get(`/manage/upload?team=rollers&plan=${plan}&from=plan`)).text();
    assert.ok(page.includes(`action="/manage/upload?team=rollers&amp;plan=${plan}" enctype`), page);
    assert.ok(textOf(page).includes('as a new version of \'Rollers · fast\''), textOf(page));
});


test('upload: makes an entry and answers 303 to the team page with it picked', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const sheets = Object.keys(srv.store.get(CID).sheets).length;
    const version = VERSION_OF(srv, 'rollers');
    const res = await postUpload(srv, c.cookie, {team: 'rollers', forPlan: live, json: planJson('Rollers fast', ROLLERS.slice(1))});
    assert.equal(res.status, 303, await res.text());
    assert.match(res.headers.get('location'), /^\/manage\/team\/rollers\?e=[0-9a-hjkmnp-tv-z]{6}#panel$/);
    const club = srv.store.get(CID);
    assert.equal(club.inbox.length, 1);
    const [e] = club.inbox;
    assert.equal(res.headers.get('location'), `/manage/team/rollers?e=${e.id}#panel`);
    assert.deepEqual([e.source, e.team, e.via, e.forPlan], ['upload', 'rollers', 'file', live]);
    assert.equal(Object.hasOwn(e, 'name'), false);
    assert.deepEqual(Object.keys(e.json.riders), ROLLERS.slice(1));
    assert.equal(Object.keys(club.sheets).length, sheets);
    assert.equal(club.teams.rollers.version, version);
    // a pasted plan; a forPlan of another team is dropped
    const paste = await postUpload(srv, c.cookie, {team: 'sprockets', forPlan: live, paste: JSON.stringify(planJson('Sprockets', ['1009']))});
    assert.equal(paste.status, 303);
    const e2 = srv.store.get(CID).inbox.at(-1);
    assert.deepEqual([e2.team, e2.via, e2.forPlan], ['sprockets', 'paste', null]);
    // only GET and POST
    const put = await fetch(srv.base + '/manage/upload', {method: 'PUT', headers: {cookie: c.cookie}});
    assert.equal(put.status, 405);
});


test('upload: every refusal makes no entry', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    const refused = async (fields, text, {status = 400, slug = 'rollers'} = {}) => {
        const file = storedClub(srv);
        const res = await postUpload(srv, c.cookie, fields);
        const body = await res.text();
        assert.equal(res.status, status, body);
        assert.deepEqual(flashOf(body), {kind: 'err', text}, body);
        assert.ok(body.includes(`<h1>Upload a plan for ${slug === 'rollers' ? 'Rollers' : 'Sprockets'}</h1>`), body);
        assert.ok(formOf(body).includes(`<input type="hidden" name="team" value="${slug}">`));
        assert.ok(!body.includes('http-equiv'), 'a refusal never reloads');
        assert.equal(storedClub(srv), file, 'nothing stored');
        assert.equal(inboxOf(srv).length, 0);
    };
    // over a cap
    const many = Array.from({length: 41}, (_, i) => String(2001 + i));
    await refused({team: 'rollers', json: planJson('Rollers fast', many)}, 'A plan holds at most 40 riders, the planner\'s roster included; this one has 41.');
    // the import errors, in today's words
    await refused({team: 'rollers', json: {team: {name: 'Rollers'}}}, 'This is not a ZwiftGopher TTT plan.');
    // nothing chosen, and a file that is no JSON object (races Task 7: the JSON export only)
    await refused({team: 'rollers'}, 'Choose the planner\'s JSON export, or paste it.');
    await refused({team: 'rollers', json: 'not a plan at all'}, 'This is not a planner JSON export.');
    // the content checks of the intake: a rider key that is no Zwift ID
    const bad = planJson('Rollers fast', ['1001']);
    bad.riders.x1 = {name: 'X', weight: 70, ftp: 250, order: 2, pull_duration: 60};
    await refused({team: 'rollers', json: bad}, 'This plan cannot be stored: every rider needs a Zwift ID, and it needs at least one rider.');
    // a team that is gone: the team-gone page
    const res = await postUpload(srv, c.cookie, {team: 'gone', json: planJson('Rollers fast', ROLLERS)});
    assert.equal(res.status, 400);
    assert.ok((await res.text()).includes('<h1 id="gone-h">This team no longer exists.</h1>'));
    assert.equal(inboxOf(srv).length, 0);
});


test('upload: a refusal keeps the plan the page was opened for', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const res = await postUpload(srv, c.cookie, {team: 'rollers', forPlan: live, json: {team: {name: 'Rollers'}}});
    const body = await res.text();
    assert.equal(res.status, 400);
    assert.ok(textOf(body).includes('as a new version of \'Rollers · fast\''), textOf(body));
    assert.ok(formOf(body).includes(`<input type="hidden" name="forPlan" value="${live}">`));
    assert.equal(inboxOf(srv).length, 0);
    // a page from before the team cockpit (from=plan): the refusal keeps the plan, the way back is the team
    const plan = planIdOf(srv, live);
    const to = `/manage/upload?team=rollers&plan=${plan}&from=plan`;
    const fromPlan = await postUpload(srv, c.cookie, {team: 'rollers', forPlan: plan, json: {team: {name: 'Rollers'}}}, {path: to});
    const again = await fromPlan.text();
    assert.equal(fromPlan.status, 400, again);
    assert.ok(textOf(again).includes('as a new version of \'Rollers · fast\''), textOf(again));
    assert.deepEqual(backOf(again), ['/manage/team/rollers', 'Rollers']);
    assert.ok(again.includes(`action="/manage/upload?team=rollers&amp;plan=${plan}" enctype`), again);
    // busy (503) and over the budget (429) are refused before the body is read: the plan comes from
    // the form's action
    srv.server.web.sheetUploads.take(CID);
    const busy = await postUpload(srv, c.cookie, {team: 'rollers', forPlan: plan, json: planJson('Rollers fast', ROLLERS)}, {path: to});
    const busyBody = await busy.text();
    assert.equal(busy.status, 503, busyBody);
    assert.ok(textOf(busyBody).includes('as a new version of \'Rollers · fast\''), textOf(busyBody));
    assert.ok(formOf(busyBody).includes(`<input type="hidden" name="forPlan" value="${plan}">`), busyBody);
    assert.deepEqual(backOf(busyBody), ['/manage/team/rollers', 'Rollers']);
    srv.server.web.sheetUploads.release(CID);
    for (let i = 0; i < 60; i++) {
        srv.server.web.sheetParses.add(CID, srv.clock.now);
    }
    const over = await postUpload(srv, c.cookie, {team: 'rollers', forPlan: plan, json: planJson('Rollers fast', ROLLERS)}, {path: to});
    const overBody = await over.text();
    assert.equal(over.status, 429, overBody);
    assert.ok(textOf(overBody).includes('as a new version of \'Rollers · fast\''), textOf(overBody));
    assert.deepEqual(backOf(overBody), ['/manage/team/rollers', 'Rollers']);
    assert.equal(inboxOf(srv).length, 0);
});


test('upload: an old page\'s fields are accepted and ignored', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const file = storedClub(srv);
    const res = await postUpload(srv, c.cookie, {
        team: 'rollers', json: planJson('Rollers fast', ROLLERS.slice(1)), label: 'fast', date: DATE, as: live, live: 'on',
        base: VERSION_OF(srv, 'rollers'), event: 'not a link',
    });
    assert.equal(res.status, 303, await res.text());
    assert.match(res.headers.get('location'), /^\/manage\/team\/rollers\?e=[0-9a-hjkmnp-tv-z]{6}#panel$/);
    const [e] = inboxOf(srv);
    assert.equal(e.forPlan, null, 'as is not forPlan');
    assert.equal(Object.keys(srv.store.get(CID).sheets).length, 1, 'nothing stored');
    assert.equal(liveId(srv.store.get(CID), 'rollers'), live);
    assert.notEqual(storedClub(srv), file, 'the entry is written');
});


test('assign page: the same file as a stored version stores nothing new, and Make live makes it live', async t => {
    // final review M-3: v1 live, v2 stored not live, v2's file again: there is no v3
    const c = makeClub();
    const v1 = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const json = planJson('Rollers fast', ROLLERS.slice(1));
    await storeOk(srv, c.cookie, {team: 'rollers', json}, {as: v1, live: undefined});
    const v2 = sheetsOf(srv, 'rollers').find(([, s]) => s.n === 2)[0];
    assert.equal(liveId(srv.store.get(CID), 'rollers'), v1);
    const id = await intake(srv, c.cookie, {team: 'rollers', forPlan: v1, json});
    const {body} = await assignOf(srv, id);
    // nothing to warn about but the file's own (user, 23 Nov 2026: no "What happens"; v1 stays live
    // meanwhile, so Store alone warns nothing)
    assert.deepEqual(whatHappens(body), ['No pull watts in this plan: export it from ZwiftGopher with pull power.']);
    assert.ok(!textOf(body).includes('v3'), textOf(body));
    // Make live (its strip's confirm: the gate is open and v1 is live) makes v2 live
    const res = await storePost(srv, c.cookie, id, {team: 'rollers', as: v1, type: 'fast', live: 'on', confirm: '1', base: String(VERSION_OF(srv, 'rollers')), drawn: `rollers:${v1}`});
    assert.equal(res.status, 303, res.body);
    assert.equal(liveId(srv.store.get(CID), 'rollers'), v2);
    assert.equal(sheetsOf(srv, 'rollers').length, 2, 'nothing new stored');
    // the result says that v2 went live, not only that nothing was stored (UI panel, audit S9)
    assert.ok(storeFlash(res.body).all.includes('Same as \'Rollers · fast\' v2: nothing new stored, but it is live now (was \'Rollers · fast\' v1). Riders in the event get it within a minute.'), storeFlash(res.body).all);
    // the live version's file again: riders have it already
    const again = await intake(srv, c.cookie, {team: 'rollers', forPlan: v1, json});
    const live = (await assignOf(srv, again)).body;
    // nothing to warn about but the file's own (user, 23 Nov 2026: no "What happens")
    assert.deepEqual(whatHappens(live), ['No pull watts in this plan: export it from ZwiftGopher with pull power.']);
    assert.ok(!textOf(live).includes('v3'), textOf(live));
});


test('Store form: the planner\'s roster shows nowhere; the row and the table count the ride order alone', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    // Ida and Jo are in the planner's roster (the club's rider pool), not in the ride order
    const id = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers pool', ['1001', '1002', '1003'], ['1008', '1009'])});
    const {status, body} = await assignOf(srv, id);
    assert.equal(status, 200, body);
    assert.match(textOf(element(body, '<div id="panel"')), /Uploaded \d\d:\d\d · 'Rollers pool' · 3 riders/);
    assert.deepEqual([...element(body, '<div id="panel-body"').matchAll(/<span class="pt-nm">([^<]*)<\/span>/g)].map(m => m[1]), ['Ben', 'Cleo', 'Dan']);
    assert.ok(!/bench/i.test(textOf(body)), textOf(body));
    assert.ok(!textOf(body).includes('Ida') && !textOf(body).includes('Jo '), textOf(body));
});


test('Store form: preselected, Make live and Store, never reloads, changes nothing', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS.slice(0, 7), at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const id = await intake(srv, c.cookie, {team: 'rollers', forPlan: live, json: planJson('Rollers other', ROLLERS)});
    const file = storedClub(srv);
    const version = VERSION_OF(srv, 'rollers');
    const {status, body} = await assignOf(srv, id);
    assert.equal(status, 200, body);
    assert.equal(storedClub(srv), file, 'a GET changes nothing');
    assert.equal(VERSION_OF(srv, 'rollers'), version);
    assert.equal(inboxOf(srv).length, 1);
    // (data-arm: past the gate, with v1 live, Make live asks first)
    assert.ok(body.includes(`<form id="store-${id}" method="post" action="/manage/inbox/${id}" data-assign data-hold-reload data-arm>`), body);
    const text = textOf(body);
    assert.match(textOf(element(body, '<div id="panel"')), /Uploaded \d\d:\d\d · 'Rollers other' · 8 riders/);
    // the team: Rollers, the other team in a fold
    assert.deepEqual([...body.matchAll(/<input type="radio" name="team" value="([^"]+)"/g)].map(m => m[1]), ['rollers', 'sprockets']);
    assert.deepEqual(checkedOf(body, 'team'), ['rollers']);
    assert.match(body, /<details class="fold"><summary>Other team<\/summary>/);
    // no race line: the list's race says it, the date field the date (team cockpit spec §5.3b)
    assert.equal(text.includes('Race Thu 19 Nov 19:30'), false, text);
    // the plan the page came from, with the live version's n and the riders in common
    assert.deepEqual(checkedOf(body, 'as'), [live]);
    assert.ok(text.includes('New version of \'Rollers · fast\' live · v1 · 15:00 · 7 of 8 riders the same New plan'), text);
    // a version keeps its plan's type: the page asks for none (and has no suggestions or hint for it)
    const form = element(body, '<div class="cp-form"');
    assert.ok(!form.includes('name="type"') && !form.includes('id="types"') && !text.includes('Optional, e.g. fast'), form);
    // no Make live box (user, 23 Nov 2026)
    assert.ok(!form.includes('name="live"') && !form.includes('type="checkbox"'), form);
    // only what warns above the bar (user, 23 Nov 2026: no "What happens", no routine line)
    assert.deepEqual(whatHappens(body), ['No pull watts in this plan: export it from ZwiftGopher with pull power.']);
    assert.equal(/What happens|Make live:|Store:/.test(textOf(element(body, '<div id="panel-body"'))), false);
    // a version takes its plan's race (user, 23 Nov 2026): no date, time or link fields, no race fold
    assert.ok(!/name="(date|start|event)"|as-race|type="date"/.test(form), form);
    // no redraw button: the script redraws the form by itself (decision 13)
    assert.ok(!body.includes('data-redraw') && !body.includes('formmethod') && !text.includes('Update preview'), body);
    assert.ok(body.includes(`<button class="btn secondary" type="submit" form="store-${id}" data-submit="store">Store</button>`
        + `<button class="btn primary" type="submit" form="store-${id}" name="live" value="on" aria-label="Store and make live" data-arm-open data-submit="live">Make live</button>`), body);
    assert.ok(body.includes(`<input type="hidden" name="drawn" value="rollers:${live}">`), body);
    assert.ok(body.includes(`<input type="hidden" name="base" value="${version}">`), body);
    assert.ok(body.includes('<input type="hidden" name="touched" value="">'), body);
    // Discard, before Store and Make live (Make live the rightmost: user, 23 Nov 2026)
    const discard = body.indexOf(`<form class="discard" method="post" action="/manage/inbox/${id}/discard" data-arm>`);
    assert.ok(discard > 0 && discard < body.indexOf('data-submit'), body);
    // one word for one action (UI panel wave 3): "Discard" as on the team page (no "…", user 23 Nov
    // 2026), the riders for screen readers
    assert.match(body.slice(discard), /data-arm-open><svg[^>]*>[\s\S]*?<\/svg>Discard<span class="sr">/);
    assert.ok(!body.includes('Discard…') && !body.includes('Discard this plan'), textOf(body.slice(discard)));
    // an open form: no meta refresh (the script holds the reload while the form is there)
    assert.ok(!body.includes('http-equiv'));
    // race day near the start: still no meta refresh
    srv.clock.now = T('2026-11-19T18:10:00Z');
    assert.ok(!(await assignOf(srv, id)).body.includes('http-equiv'));
});


test('assign page: the preview equals the stored result', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ['1002', '1003'], at: T('2026-11-19T14:00:00Z')});
    const sp = upload(c.club, 'sprockets', {riders: ['1001', '1009'], at: T('2026-11-19T14:05:00Z')});
    const srv = await serve(t, c);
    const id = await intake(srv, c.cookie, {team: 'rollers', forPlan: live, json: planJson('Rollers fast', ['1001', '1002', '1003'])});
    const page = await assignOf(srv, id);
    const lines = whatHappens(page.body);
    assert.ok(lines.includes('Ben moves from Sprockets to Rollers.'), lines.join('\n'));
    assert.ok(lines.includes('Still to do: Sprockets'), lines.join('\n'));
    assert.ok(lines.indexOf('Ben moves from Sprockets to Rollers.') < lines.indexOf('Still to do: Sprockets'));
    // the diff is the rider table itself (Ben NEW): no diff line in What happens, and the table's
    // caption only names what it is held against (user, 23 Nov 2026)
    assert.ok(!lines.includes('Ben in'), lines.join('\n'));
    assert.match(element(page.body, '<div id="panel"'), /<span class="cp-cap" title="Against live [^"]*">Against live [^<·]*<\/span>/);
    // Store as a new version, no date posted (as the page posts it)
    // a date sent with a version (a stale field) does not move the moves and holes off the plan's race
    const res = await storePost(srv, c.cookie, id, {team: 'rollers', as: live, live: 'on', confirm: '1', type: 'fast', date: '2026-11-26', base: VERSION_OF(srv, 'rollers'), drawn: `rollers:${live}`, touched: '', event: ''});
    assert.equal(res.status, 303, res.body);
    const text = storeFlash(res.body).all;
    assert.ok(text.includes('Ben moves from Sprockets to Rollers.'), text);
    assert.ok(text.includes('Still to do: Sprockets'), text);
    // the stored version is live: its table as riders get it, no old lines (team cockpit spec §5.3b);
    // the row of the version it replaced says the difference
    assert.equal(/pt-old|pt-mark|pt-cap/.test(element(res.body, '<div id="panel-body"')), false);
    assert.ok(textOf(element(res.body, `<li class="cp-row" data-sel="v:${live}">`)).includes('Ben out'), res.body);
    const club = srv.store.get(CID);
    assert.equal(club.sheets[liveId(club, 'rollers')].plan, live);
    assert.equal(club.sheets[liveId(club, 'rollers')].n, 2);
    assert.equal(liveId(club, 'sprockets'), sp);
    assert.equal(club.inbox.length, 0);
});


test('Store: a version keeps its plan\'s type whatever the POST says', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS.slice(0, 7), at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const id = await intake(srv, c.cookie, {team: 'rollers', forPlan: live, json: planJson('Rollers other', ROLLERS)});
    const res = await storePost(srv, c.cookie, id, {
        team: 'rollers', as: live, live: 'on', confirm: '1', type: 'quick', base: VERSION_OF(srv, 'rollers'), drawn: `rollers:${live}`, touched: 'type', event: '',
    });
    assert.equal(res.status, 303, res.body);
    const club = srv.store.get(CID);
    const stored = club.sheets[liveId(club, 'rollers')];
    assert.deepEqual([stored.plan, stored.n, stored.type, stored.label], [live, 2, 'fast', 'Rollers · fast']);
    assert.equal((club.teams.rollers.types ?? []).includes('quick'), false, 'a posted type is not remembered');
    assert.equal(textOf(res.body).includes('quick'), false, textOf(res.body));
});


test('assign page: the team hint comes first', async t => {
    const c = makeClub();
    upload(c.club, 'sprockets', {riders: [...ROLLERS.slice(0, 7), '1009'], at: T('2026-11-19T13:00:00Z')});
    const srv = await serve(t, c);
    const id = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers new', ROLLERS)});
    const lines = whatHappens((await assignOf(srv, id)).body);
    assert.equal(lines[0], 'It looks like Sprockets (7 of 8 riders)');
    assert.equal(lines.some(l => l.startsWith('Make live:')), false, lines.join('\n'));
    // the planner name of another team
    const named = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Sprockets', ['1010'])});
    assert.equal(whatHappens((await assignOf(srv, named)).body)[0], 'This plan says Sprockets');
});


test('assign page: two plans in the race and no forPlan → no plan checked', async t => {
    const c = makeClub();
    const fast = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    upload(c.club, 'rollers', {type: 'slow', riders: ROLLERS.slice(0, 6), at: T('2026-11-19T14:10:00Z'), live: false});
    // fast's v2, not live: its row still shows the live v1; and a plan for next week's race
    uploadSheet(c.club, {
        slug: 'rollers', json: planJson('Rollers fast', ROLLERS.slice(0, 2)), text: null, as: fast, live: false,
        base: c.club.teams.rollers.version, pinnedEventId: null, via: 'file',
    }, {now: T('2026-11-19T14:20:00Z'), newId: () => 'vf0002'});
    upload(c.club, 'rollers', {type: 'next', riders: ROLLERS.slice(0, 4), at: T('2026-11-19T14:30:00Z'), live: false, date: '2026-11-26'});
    const srv = await serve(t, c);
    const fields = {team: 'rollers', json: planJson('Rollers other', ROLLERS)};
    const id = await intake(srv, c.cookie, fields);
    const {body} = await assignOf(srv, id);
    assert.deepEqual(checkedOf(body, 'as'), []);
    assert.ok(barButtons(body), body);
    // the one line above the bar: what is missing (user, 23 Nov 2026: refusals and red lines stay)
    assert.deepEqual(whatSev(body), [['err', 'Pick a plan.']]);
    assert.ok(textOf(body).includes('New version of \'Rollers · fast\' Thu 19 Nov · live · v1 · 15:00 · 8 of 8 riders the same'), textOf(body));
    assert.ok(textOf(body).includes('New version of \'Rollers · slow\' Thu 19 Nov · v1 · 15:10 · 6 of 8 riders the same'), textOf(body));
    // plans of more than one race: every row starts with its race's day, nearest race first
    // (controller ruling 23 Nov 2026)
    assert.ok(textOf(body).includes('New version of \'Rollers · next\' Thu 26 Nov · v1 · 15:30 · 4 of 8 riders the same'), textOf(body));
    assert.ok(textOf(body).indexOf('Thu 19 Nov · live · v1') < textOf(body).indexOf('Thu 26 Nov · v1'), textOf(body));
    // Store without a plan
    const sheets = Object.keys(srv.store.get(CID).sheets).length;
    const res = await storePost(srv, c.cookie, id, {team: 'rollers', live: 'on', confirm: '1', base: VERSION_OF(srv, 'rollers'), drawn: 'rollers:'});
    assert.equal(res.status, 400, res.body);
    assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'Pick a plan.'});
    assert.ok(res.body.includes('data-assign'), 'the Store form');
    assert.equal(Object.keys(srv.store.get(CID).sheets).length, sheets);
    assert.equal(inboxOf(srv).length, 1);
});


test('assign page: the touched fields go on through a refused Store and a redraw', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    upload(c.club, 'rollers', {type: 'slow', riders: ROLLERS.slice(0, 6), at: T('2026-11-19T14:10:00Z'), live: false});
    const srv = await serve(t, c);
    const id = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers other', ROLLERS)});
    const touchedOf = body => /<input type="hidden" name="touched" value="([^"]*)">/.exec(body)?.[1];
    const typeOf = body => /<input name="type" maxlength="30" value="([^"]*)"/.exec(body)?.[1];
    // a fresh page: nothing touched
    assert.equal(touchedOf((await assignOf(srv, id)).body), '');
    // the captain typed a type and pressed Store without a plan: the refusal is drawn at the POST's
    // URL, with no query, so the page itself carries what the script sent
    const res = await storePost(srv, c.cookie, id, {
        team: 'rollers', type: 'tempo', base: VERSION_OF(srv, 'rollers'), drawn: 'rollers:', touched: 'type',
    });
    assert.equal(res.status, 400, res.body);
    assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'Pick a plan.'});
    assert.equal(touchedOf(res.body), 'type');
    assert.equal(typeOf(res.body), undefined, 'no plan chosen: no type field yet');
    // the next redraw (New plan) sends it on: the type stays
    const {body} = await assignOf(srv, id, '?team=rollers&as=new&drawn=rollers%3A&type=tempo&touched=type');
    assert.deepEqual(checkedOf(body, 'as'), ['new']);
    assert.equal(typeOf(body), 'tempo');
    assert.equal(touchedOf(body), 'type');
    // only the type (no Make live box any more, user 23 Nov 2026); anything else is dropped
    assert.equal(touchedOf((await assignOf(srv, id, '?touched=type%2Cx%2Clive%2C%3Cb%3E')).body), 'type');
    // a Store for a choice the page was not drawn for (the drawn guard's redraw) carries it too
    const guard = await storePost(srv, c.cookie, id, {
        team: 'rollers', as: 'new', type: 'tempo', base: VERSION_OF(srv, 'rollers'), drawn: 'rollers:', touched: 'live,type',
    });
    assert.equal(guard.status, 400, guard.body);
    assert.deepEqual(flashOf(guard.body), {kind: 'err', text: 'Check the choices: the preview was for another team or plan.'});
    assert.equal(touchedOf(guard.body), 'type');
    assert.equal(typeOf(guard.body), 'tempo');
});


test('assign page: what Store alone does into a race with nothing live is a warning (spec §8; user, 23 Nov 2026)', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    // Sprockets has nothing live: the warning about Store alone (no line about Make live, user 23 Nov 2026)
    const id = await intake(srv, c.cookie, {team: 'sprockets', json: planJson('Sprockets', ['1009'])});
    const off = (await assignOf(srv, id, '?team=sprockets&as=new&drawn=sprockets:new')).body;
    const store = whatSev(off).find(([, text]) => text.startsWith('Store:'));
    assert.deepEqual(store, ['warn', 'Store: new plan \'Sprockets\', not live. Riders get no plan for this race yet.']);
    assert.equal(whatSev(off).some(([, text]) => text.startsWith('Make live:')), false);
    // a new version of Rollers' plan: Rollers keeps its live plan, so no warning
    const rid = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS.slice(1))});
    const plan = Object.keys(srv.store.get(CID).sheets)[0];
    const kept = (await assignOf(srv, rid, `?team=rollers&as=${plan}&drawn=rollers:${plan}&type=fast`)).body;
    assert.equal(whatSev(kept).some(([, text]) => text.startsWith('Store:')), false, JSON.stringify(whatSev(kept)));
});


// The warning lines as [sev, text], in order.
const whatSev = body => [...(element(element(body, '<div id="panel-body"') ?? '', '<div class="cp-what"') ?? '')
    .matchAll(/<li class="(ok|info|warn|err)"><svg[^>]*>[\s\S]*?<\/svg><span>([^<]*)<\/span>/g)].map(m => [m[1], textOf(m[2]).trim()]);

test('assign page and result: the same file again, not live, while nothing in its race is live warns too (spec §8)', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    await storeOk(srv, c.cookie, {team: 'sprockets', json: planJson('Sprockets', ['1009'])}, {live: '', date: DATE});
    const [[sid, sheet]] = sheetsOf(srv, 'sprockets');
    const plan = sheet.plan ?? sid;
    const id = await intake(srv, c.cookie, {team: 'sprockets', json: planJson('Sprockets', ['1009'])});
    const preview = (await assignOf(srv, id, `?team=sprockets&as=${plan}&drawn=sprockets:${plan}`)).body;
    assert.deepEqual(whatSev(preview)[0], ['warn', 'Store: same as v1, not live. Riders get no plan for this race yet.']);
    assert.equal(whatSev(preview).some(([, text]) => text.startsWith('Make live:')), false);
    // Rollers keeps its live plan: the same file of it, not live, says nothing red
    const [[rid, rsheet]] = sheetsOf(srv, 'rollers');
    const rentry = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS)});
    const kept = (await assignOf(srv, rentry, `?team=rollers&as=${rsheet.plan ?? rid}&drawn=rollers:${rsheet.plan ?? rid}&type=fast`)).body;
    assert.ok(!whatSev(kept).some(([sev, text]) => sev === 'err' || (sev === 'warn' && text.startsWith('Store:'))), JSON.stringify(whatSev(kept)));
});


test('assign page and result: a race without any start time is not promised a plan on Make live alone', async t => {
    // Cranks (weekly) has no start time: a plan stored not live gets nothing even when made live
    const c = makeClub({teams: [['Rollers', '19:30'], ['Cranks', null]]});
    const srv = await serve(t, c);
    const id = await intake(srv, c.cookie, {team: 'cranks', json: planJson('Cranks', ['1012'])});
    const preview = (await assignOf(srv, id, `?team=cranks&as=new&drawn=cranks:new`)).body;
    assert.deepEqual(whatSev(preview).slice(0, 2), [['warn', 'Store: new plan \'Cranks\', not live. Riders get no plan for this race yet.'],
        ['err', 'Cranks has no start time: riders on this plan get nothing.']]);
    assert.ok(!whatHappens(preview).join(' ').includes('Riders get it') && !whatHappens(preview).join(' ').includes('within a minute'), whatHappens(preview).join('\n'));
    const body = await storeOk(srv, c.cookie, {team: 'cranks', json: planJson('Cranks', ['1012'])}, {live: '', date: DATE});
    const {kind, text} = storeFlash(body);
    assert.ok(kind === 'err' && text === 'Stored as v1 of \'Cranks\'. Not live, and the race has no start time: riders get nothing until it has one and a plan is live.', text);
    assert.ok(!textOf(body).includes('until you press Make live'), textOf(body));
    // the same file again: the red line without the promise
    const again = await intake(srv, c.cookie, {team: 'cranks', json: planJson('Cranks', ['1012'])});
    const [[cid, cs]] = sheetsOf(srv, 'cranks');
    const same = (await assignOf(srv, again, `?team=cranks&as=${cs.plan ?? cid}&drawn=cranks:${cs.plan ?? cid}`)).body;
    assert.deepEqual(whatSev(same)[0], ['warn', 'Store: same as v1, not live. Riders get no plan for this race yet.']);
    assert.ok(!whatHappens(same).join(' ').includes('until you press Make live'));
});


test('assign page: a redraw keeps the plan drawn, and re-applies another team\'s defaults', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const id = await intake(srv, c.cookie, {team: 'rollers', forPlan: live, json: planJson('Rollers fast', ROLLERS.slice(1))});
    // the same team and plan as drawn: kept, with both buttons
    const kept = (await assignOf(srv, id, `?team=rollers&as=${live}&drawn=rollers:${live}&type=fast`)).body;
    assert.deepEqual(checkedOf(kept, 'as'), [live]);
    assert.ok(barButtons(kept), kept);
    assert.deepEqual(whatHappens(kept), ['No pull watts in this plan: export it from ZwiftGopher with pull power.']);
    // another team: its defaults (Sprockets has no plan: a new plan); nothing live there, so its
    // Make live asks nothing
    const other = (await assignOf(srv, id, `?team=sprockets&as=${live}&drawn=rollers:${live}`)).body;
    assert.deepEqual(checkedOf(other, 'team'), ['sprockets']);
    assert.deepEqual(checkedOf(other, 'as'), ['new']);
    assert.ok(barButtons(other) && !other.includes('data-arm-open data-submit="live"'), other);
    assert.ok(other.includes('<input type="hidden" name="drawn" value="sprockets:new">'));
    assert.ok(other.includes('<input type="date" name="date" value="2026-11-19">'), 'a new plan has a date field');
});


test('assign page: the preview counts against the parse budget', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    const BUDGET = 'Too many uploads and previews in 10 minutes. Try again shortly.';
    const id = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS)});
    // the upload and the first draw: 2 of the 60
    assert.equal((await assignOf(srv, id)).status, 200);
    assert.equal(srv.server.web.sheetParses.count(CID, NOW, 10 * 60000), 2);
    for (let i = 0; i < 58; i++) {
        srv.server.web.sheetParses.add(CID, NOW);
    }
    const over = await assignOf(srv, id);
    assert.equal(over.status, 429, over.body);
    assert.equal(over.headers.get('retry-after'), '600');
    assert.deepEqual(flashOf(over.body), {kind: 'err', text: BUDGET});
    assert.ok(over.body.includes('data-assign'), 'the page, without a preview');
    assert.ok(!over.body.includes('aria-labelledby="wh-h"'));
    // an upload gets the upload page with the refusal, and makes no entry
    const up = await postUpload(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS)});
    const body = await up.text();
    assert.equal(up.status, 429);
    assert.equal(up.headers.get('retry-after'), '600');
    assert.deepEqual(flashOf(body), {kind: 'err', text: BUDGET});
    assert.equal(inboxOf(srv).length, 1);
    // Store does not count: it still works
    const res = await storePost(srv, c.cookie, id, {team: 'rollers', as: 'new', live: 'on', confirm: '1', date: DATE, base: VERSION_OF(srv, 'rollers'), drawn: 'rollers:new'});
    assert.equal(res.status, 303, res.body);
    // ten minutes later: allowed again
    srv.clock.now = NOW + 10 * 60000;
    const again = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS)});
    assert.equal((await assignOf(srv, again)).status, 200);
});


test('assign page: the type field, its suggestions, and never the JSON name', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'slow', riders: ROLLERS.slice(0, 6), at: T('2026-11-19T13:00:00Z'), live: false});
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const fields = {team: 'rollers', json: planJson('Rollers Thunder', ROLLERS)};
    const id = await intake(srv, c.cookie, fields);
    const {body} = await assignOf(srv, id, '?team=rollers&as=new&drawn=rollers:new');
    assert.ok(body.includes('<label class="field">Type <input name="type" maxlength="30" value="" list="types" autocomplete="off"></label>'), body);
    assert.ok(body.includes('<datalist id="types"><option value="fast"><option value="slow"></datalist>'), body);
    // never the JSON name in the form (the row above it names the planner's team, team cockpit spec §5.2)
    assert.ok(!element(body, '<div class="cp-form"').includes('Rollers Thunder'), 'never the JSON name');
    assert.ok(textOf(body).includes('Optional, e.g. fast, slow. Add one now if a second plan may follow. No rider names.'), textOf(body));
    // a typeless plan in the race: a new plan needs a type
    const typeless = await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers Thunder', ROLLERS.slice(0, 5))}, {as: 'new', live: '', type: '', date: DATE});
    assert.ok(textOf(typeless).includes('Stored as v1 of \'Rollers\', not live.'), textOf(typeless));
    const plain = sheetsOf(srv, 'rollers').find(([, s]) => s.type === null)[1].plan;
    const next = await intake(srv, c.cookie, fields);
    const needed = (await assignOf(srv, next, '?team=rollers&as=new&drawn=rollers:new')).body;
    assert.ok(textOf(needed).includes('Needed: Rollers already has a plan without a type for Thu 19 Nov. No rider names.'), textOf(needed));
    assert.ok(whatHappens(needed).includes('Rollers already has a plan for Thu 19 Nov: give this one a type of its own.'), whatHappens(needed).join('\n'));
    const store = choices => storePost(srv, c.cookie, next, {team: 'rollers', live: '', date: DATE, base: VERSION_OF(srv, 'rollers'), drawn: `rollers:${choices.as}`, ...choices});
    let res = await store({as: 'new', type: ''});
    assert.equal(res.status, 400);
    assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'Rollers already has a plan for Thu 19 Nov: give this one a type of its own.'});
    assert.ok(inboxOf(srv).some(e => e.id === next), 'the entry stays');
    // a new version of the typeless plan may stay typeless
    res = await store({as: plain, type: ''});
    assert.equal(res.status, 303, res.body);
    assert.ok(textOf(res.body).includes('Stored as v2 of \'Rollers\', not live.'), textOf(res.body));
    // a taken type, in other letters
    const third = await intake(srv, c.cookie, fields);
    res = await storePost(srv, c.cookie, third, {team: 'rollers', as: 'new', type: 'FAST', live: 'on', confirm: '1', date: DATE, base: VERSION_OF(srv, 'rollers'), drawn: 'rollers:new'});
    assert.equal(res.status, 400);
    assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'Rollers already has a plan \'FAST\' for Thu 19 Nov: choose another type.'});
    res = await storePost(srv, c.cookie, third, {team: 'rollers', as: 'new', type: 'steady', live: 'on', confirm: '1', date: DATE, base: VERSION_OF(srv, 'rollers'), drawn: 'rollers:new'});
    assert.equal(res.status, 303, res.body);
    assert.match(storeFlash(res.body).text, /'Rollers · steady' v1 is live for Thu 19 Nov 19:30\. Plan code [A-Z0-9]{6}\./);
    assert.ok(!element(res.body, '<div id="panel"').includes('Rollers Thunder'));
});


test('store: a refusal keeps the entry', async t => {
    const c = makeClub();
    const fast = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const sp = upload(c.club, 'sprockets', {riders: ['1009'], at: T('2026-11-19T14:05:00Z')});
    const srv = await serve(t, c);
    const id = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers slow', ROLLERS.slice(2))});
    const refused = async (choices, text) => {
        const file = storedClub(srv);
        const sent = {team: 'rollers', live: 'on', base: VERSION_OF(srv, 'rollers'), type: 'slow', ...choices};
        const res = await storePost(srv, c.cookie, id, {drawn: `${sent.team}:${sent.as ?? ''}`, ...sent});
        assert.equal(res.status, 400, res.body);
        assert.deepEqual(flashOf(res.body), {kind: 'err', text}, res.body);
        assert.ok(res.body.includes(`action="/manage/inbox/${id}" data-assign`), 'the assign page');
        assert.ok(!res.body.includes('http-equiv'));
        assert.equal(storedClub(srv), file, 'nothing changed');
        assert.ok(inboxOf(srv).some(e => e.id === id), 'the entry stays');
    };
    await refused({}, 'Pick a plan.');
    await refused({as: 'new', team: ''}, 'Pick a team.');
    await refused({as: 'new', date: '2026-11-12'}, 'The race on 2026-11-12 is over: choose a later date.');
    await refused({as: 'new', date: '2026-02-30'}, 'Enter the race date as YYYY-MM-DD.');
    await refused({as: 'new', date: DATE, event: 'https://example.org/x'}, 'This is not a Zwift or ZwiftPower event link.');
    await refused({as: 'zzzzzz', date: DATE}, 'This team or plan no longer exists. Nothing was changed.');
    // a plan of another team: refused, never stored there
    await refused({as: sp, date: DATE}, 'This team or plan no longer exists. Nothing was changed.');
    // the refusal page shows what was posted: no plan, though the entry came from fast's page
    const from = await intake(srv, c.cookie, {team: 'rollers', forPlan: fast, json: planJson('Rollers slow', ROLLERS.slice(3))});
    assert.deepEqual(checkedOf((await assignOf(srv, from)).body, 'as'), [fast], 'preselected on the page');
    const none = await storePost(srv, c.cookie, from, {team: 'rollers', live: 'on', confirm: '1', type: 'fast', base: VERSION_OF(srv, 'rollers'), drawn: 'rollers:'});
    assert.equal(none.status, 400);
    assert.deepEqual(flashOf(none.body), {kind: 'err', text: 'Pick a plan.'});
    assert.deepEqual(checkedOf(none.body, 'as'), []);
    assert.ok(barButtons(none.body), none.body);
    // after S + 4 h of today's race
    srv.clock.now = T('2026-11-19T22:30:00.001Z');
    await refused({as: 'new', date: DATE}, 'The race on 2026-11-19 is over: choose a later date.');
});


test('store: a team or plan changed without a redraw stores nothing and redraws', async t => {
    const c = makeClub();
    const sp = upload(c.club, 'sprockets', {riders: [...ROLLERS.slice(0, 7), '1009'], at: T('2026-11-19T13:00:00Z')});
    const srv = await serve(t, c);
    const id = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers new', ROLLERS)});
    const page = (await assignOf(srv, id)).body;
    assert.equal(whatHappens(page)[0], 'It looks like Sprockets (7 of 8 riders)');
    assert.ok(page.includes('<input type="hidden" name="drawn" value="rollers:new">'));
    // the captain picks Sprockets under "Other team" and presses Store at once: the page was drawn
    // for Rollers' new plan, so nothing is stored
    const file = storedClub(srv);
    const res = await storePost(srv, c.cookie, id, {
        team: 'sprockets', as: 'new', live: 'on', confirm: '1', type: '', date: DATE, base: VERSION_OF(srv, 'rollers'), drawn: 'rollers:new', touched: '', event: '',
    });
    assert.equal(res.status, 400, res.body);
    assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'Check the choices: the preview was for another team or plan.'});
    assert.equal(storedClub(srv), file, 'nothing stored');
    assert.ok(inboxOf(srv).some(e => e.id === id), 'the entry stays');
    // redrawn for Sprockets with its defaults: its race has a plan, so the captain picks one
    assert.deepEqual(checkedOf(res.body, 'team'), ['sprockets']);
    assert.deepEqual(checkedOf(res.body, 'as'), []);
    assert.ok(res.body.includes('<input type="hidden" name="drawn" value="sprockets:">'), res.body);
    assert.ok(res.body.includes(`<input type="hidden" name="base" value="${VERSION_OF(srv, 'sprockets')}">`));
    assert.deepEqual(whatHappens(res.body), ['Pick a plan.']);
    // the same plan choice as drawn: stored, with no false "Someone changed"
    const ok = await storePost(srv, c.cookie, id, {
        team: 'sprockets', as: sp, live: 'on', confirm: '1', base: VERSION_OF(srv, 'sprockets'), drawn: `sprockets:${sp}`, touched: '', event: '',
    });
    assert.equal(ok.status, 303, ok.body);
    assert.ok(!textOf(ok.body).includes('Someone changed'), textOf(ok.body));
    const club = srv.store.get(CID);
    assert.equal(club.sheets[liveId(club, 'sprockets')].plan, sp);
    assert.equal(club.sheets[liveId(club, 'sprockets')].n, 2);
    assert.equal(sheetsOf(srv, 'rollers').length, 0);
    // a missing drawn counts as another choice
    const id2 = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers new', ROLLERS)});
    const bare = await storePost(srv, c.cookie, id2, {team: 'rollers', as: 'new', live: 'on', confirm: '1', date: DATE, base: VERSION_OF(srv, 'rollers')});
    assert.equal(bare.status, 400);
    assert.deepEqual(flashOf(bare.body), {kind: 'err', text: 'Check the choices: the preview was for another team or plan.'});
    assert.equal(sheetsOf(srv, 'rollers').length, 0);
});


test('assign page: the outcome without a start time', async t => {
    const c = makeClub({teams: [['Rollers', '19:30'], ['Cranks', null]]});
    const srv = await serve(t, c);
    const id = await intake(srv, c.cookie, {team: 'cranks', json: planJson('Cranks', ['1001', '1002'])});
    const lines = whatHappens((await assignOf(srv, id)).body);
    assert.equal(lines.some(l => l.startsWith('Make live:')), false, lines.join('\n'));
    assert.ok(lines.includes('Cranks has no start time: riders on this plan get nothing.'), lines.join('\n'));
    const body = (await assignOf(srv, id)).body;
    assert.match(body, /<li class="err"><svg[^>]*>[\s\S]*?<\/svg><span>Cranks has no start time: riders on this plan get nothing\.<\/span><\/li>/);
    // the day in the date field (no race line, team cockpit spec §5.3b); the time field empty
    assert.ok(element(body, '<div class="as-when"').includes('<input type="date" name="date" value="2026-11-19">'), 'the day without a start time');
    assert.ok(element(body, '<div class="as-when"').includes('<input type="time" name="start" value="">'), 'no time');
    await storeOk(srv, c.cookie, {team: 'cranks', json: planJson('Cranks', ['1001', '1002'])}, {date: DATE});
    const plan = liveId(srv.store.get(CID), 'cranks');
    // a new version of the live plan
    const next = await intake(srv, c.cookie, {team: 'cranks', forPlan: plan, json: planJson('Cranks', ['1002', '1001'])});
    const v2 = whatHappens((await assignOf(srv, next)).body);
    assert.equal(v2.some(l => l.startsWith('Make live:')), false, v2.join('\n'));
    assert.ok(v2.includes('Cranks has no start time: riders on this plan get nothing.'));
});


test('store twice: the second finds no entry', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const id = await intake(srv, c.cookie, {team: 'rollers', forPlan: live, json: planJson('Rollers fast', ROLLERS.slice(1))});
    const fields = {team: 'rollers', as: live, live: 'on', confirm: '1', type: 'fast', base: VERSION_OF(srv, 'rollers'), drawn: `rollers:${live}`, touched: '', event: ''};
    const first = await storePost(srv, c.cookie, id, fields);
    assert.equal(first.status, 303, first.body);
    assert.equal(sheetsOf(srv, 'rollers').length, 2);
    const file = storedClub(srv);
    // the same POST again (Store pressed twice, or a stale second tab)
    const second = await storePost(srv, c.cookie, id, fields);
    assert.equal(second.status, 400, second.body);
    assert.ok(textOf(second.body).includes('This plan is stored or no longer here.'), second.body);
    assert.ok(second.body.includes('href="/manage"'));
    assert.equal(sheetsOf(srv, 'rollers').length, 2, 'still exactly one new version');
    assert.equal(storedClub(srv), file);
    const got = await assignOf(srv, id);
    assert.equal(got.status, 404);
    assert.ok(textOf(got.body).includes('This plan is stored or no longer here.'));
    assert.ok(got.body.includes('<a class="btn primary block" href="/manage">'), got.body);
    // an id that is no id, and a discard of the used entry
    assert.equal((await assignOf(srv, 'NOT-AN-ID')).status, 404);
    const gone = await followPost(srv, c.cookie, `/manage/inbox/${id}/discard`, {back: '/manage/team/rollers', confirm: '1'});
    assert.deepEqual(gone.flash, {kind: 'err', text: 'This plan is stored or no longer here.'});
    // an entry older than 24 h is gone too
    const old = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS.slice(2))});
    srv.clock.now = NOW + 24 * 3600000 + 1;
    assert.equal((await srv.get(`/manage/inbox/${old}`)).status, 404);
    const late = await storePost(srv, c.cookie, old, {...fields, base: VERSION_OF(srv, 'rollers')});
    assert.equal(late.status, 400);
    assert.ok(textOf(late.body).includes('This plan is stored or no longer here.'));
    assert.equal(sheetsOf(srv, 'rollers').length, 2);
});


test('discard: removes the entry, back to the page it came from', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    const id = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS)});
    // the page's own form goes back to the entry's team
    const page = (await assignOf(srv, id)).body;
    assert.ok(page.includes(`<form class="discard" method="post" action="/manage/inbox/${id}/discard" data-arm>${CLUB_FIELD}<input type="hidden" name="back" value="/manage/team/rollers">`), page);
    // without confirm=1 (B1, UI panel wave 2): the question on a page of its own, nothing discarded
    const asked = await post(srv, c.cookie, `/manage/inbox/${id}/discard`, {back: '/manage/team/rollers'});
    assert.equal(asked.status, 200, asked.body);
    assert.ok(asked.body.includes('<h1>Discard this plan?</h1>'), asked.body);
    assert.ok(textOf(asked.body).includes('Discards the plan with 8 riders (Ben, Cleo …). It cannot be brought back: send it again from ZwiftGopher, or upload it again.'), textOf(asked.body));
    assert.ok(asked.body.includes(`<form method="post" action="/manage/inbox/${id}/discard">${CLUB_FIELD}<input type="hidden" name="back" value="/manage/team/rollers"><input type="hidden" name="confirm" value="1"><button class="btn danger" type="submit">Discard plan</button></form>`), asked.body);
    assert.ok(asked.body.includes('<a class="btn secondary" href="/manage/team/rollers">'), asked.body);
    assert.equal(inboxOf(srv).length, 1);
    const res = await followPost(srv, c.cookie, `/manage/inbox/${id}/discard`, {back: '/manage/team/rollers', confirm: '1'});
    assert.equal(res.location, '/manage/team/rollers');
    assert.deepEqual(res.flash, {kind: 'ok', text: 'Discarded the plan with 8 riders (Ben, Cleo …).'});
    assert.equal(inboxOf(srv).length, 0);
    assert.deepEqual(srv.store.get(CID).log.at(-1), {at: new Date(NOW).toISOString(), what: 'discard', team: 'rollers', label: '8 riders'});
    // anything but /manage or an existing team page goes to /manage
    for (const back of ['https://evil.example.org', '/manage/team/gone', '//evil.example.org', '/manage/settings', '']) {
        const next = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ['1001', '1002'])});
        const r = await followPost(srv, c.cookie, `/manage/inbox/${next}/discard`, {back, confirm: '1'});
        assert.equal(r.location, '/manage', back);
        assert.deepEqual(r.flash, {kind: 'ok', text: 'Discarded the plan with 2 riders (Ben, Cleo).'});
    }
    const one = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ['1001'])});
    assert.equal((await followPost(srv, c.cookie, `/manage/inbox/${one}/discard`, {back: '/manage', confirm: '1'})).flash.text, 'Discarded the plan with 1 rider (Ben).');
    // only POST
    assert.equal((await srv.get(`/manage/inbox/${one}/discard`)).status, 405);
});


test('Store form: Discard goes back to the entry\'s team page, also with another team chosen', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    const id = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS)});
    const discardOf = body => /<form class="discard" method="post" action="\/manage\/inbox\/[0-9a-z]{6}\/discard" data-arm>[^]*?<input type="hidden" name="back" value="([^"]*)">/.exec(body)?.[1];
    for (const q of ['', '?team=sprockets&as=new&drawn=sprockets:new']) {
        const {status, body} = await assignOf(srv, id, q);
        assert.equal(status, 200, body);
        assert.equal(discardOf(body), '/manage/team/rollers', q);
    }
});


test('Store flash: the version, the diff in the table, upload for the hole team with its plan', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ['1002', '1003'], at: T('2026-11-19T14:00:00Z')});
    const sp = upload(c.club, 'sprockets', {riders: ['1001', '1009'], at: T('2026-11-19T14:05:00Z')});
    const srv = await serve(t, c);
    const body = await storeOk(srv, c.cookie, {team: 'rollers', forPlan: live, json: planJson('Rollers fast', ['1001', '1002', '1003'])}, {as: live});
    const club = srv.store.get(CID);
    const v2 = liveId(club, 'rollers');
    const flash = storeFlash(body);
    assert.equal(flash.text, `'Rollers · fast' v2 is live for Thu 19 Nov 19:30. Plan code ${club.sheets[v2].sig}.`);
    // the new live version as riders get it (no old lines, team cockpit spec §5.3b); what changed is
    // the row of the version it replaced, against the live one
    assert.equal(/pt-old|pt-mark|pt-cap/.test(element(body, '<div id="panel-body"')), false);
    assert.ok(textOf(element(body, `<li class="cp-row" data-sel="v:${live}">`)).includes('Ben out'), body);
    // the hole's upload carries its race (races Task 7)
    assert.deepEqual(flash.links, [[`/manage/upload?team=sprockets&plan=${sp}&date=2026-11-19`, 'Upload for Sprockets']]);
    // no "Wrong file?" and no Undo: Make live of the version before takes it back (spec §4.1; user, 23 Nov 2026)
    assert.ok(!textOf(body).includes('Wrong file?') && !element(body, '<div id="panel"').includes('/manage/plan/back'), body);

    // with two plans in Sprockets' race the link leaves the plan out: the captain picks
    const d = makeClub();
    const dLive = upload(d.club, 'rollers', {type: 'fast', riders: ['1002', '1003'], at: T('2026-11-19T14:00:00Z')});
    upload(d.club, 'sprockets', {riders: ['1001', '1009'], at: T('2026-11-19T14:05:00Z')});
    upload(d.club, 'sprockets', {type: 'B', riders: ['1009'], at: T('2026-11-19T14:06:00Z'), live: false});
    const srv2 = await serve(t, d);
    const two = await storeOk(srv2, d.cookie, {team: 'rollers', forPlan: dLive, json: planJson('Rollers fast', ['1001', '1002', '1003'])}, {as: dLive});
    assert.deepEqual(storeFlash(two).links, [['/manage/upload?team=sprockets&date=2026-11-19', 'Upload for Sprockets']]);
});


test('assign page: one team, no picker', async t => {
    const c = makeClub({teams: [['Rollers', '19:30']]});
    const srv = await serve(t, c);
    const id = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS)});
    const {body} = await assignOf(srv, id);
    assert.ok(body.includes('<input type="hidden" name="team" value="rollers">'), body);
    assert.ok(!body.includes('name="team" value="rollers" checked'));
    assert.ok(!/<input type="radio" name="team"/.test(body));
    assert.ok(!body.includes('Other team'));
    assert.equal(textOf(element(body, '<div class="cp-form"')).includes('Team'), false, 'the page\'s own team: no line repeats it');
    const res = await storePost(srv, c.cookie, id, {team: 'rollers', as: 'new', live: 'on', confirm: '1', date: DATE, type: '', base: VERSION_OF(srv, 'rollers'), drawn: 'rollers:new', touched: '', event: ''});
    assert.equal(res.status, 303, res.body);
    assert.ok(liveId(srv.store.get(CID), 'rollers'));
});


test('upload: live by default for a team without a plan', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    // the date left out: the team's next race
    const body = await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS)});
    const club = srv.store.get(CID);
    const id = liveId(club, 'rollers');
    assert.ok(id, 'live');
    const sig = club.sheets[id].sig;
    assert.equal(club.sheets[id].via, 'file');
    assert.equal(club.sheets[id].date, DATE);
    // no type: the label is the team's name
    assert.equal(club.sheets[id].label, 'Rollers');
    assert.equal(club.sheets[id].type, null);
    // the team page with the new version picked, the Store flash in its panel's head
    // stored live: the race's live pointer (a reload follows live), the new version's card
    assert.match(body, new RegExp(`<main class="page wide cockpit" id="main" data-tv="\\d+" data-here="/manage/team/rollers\\?r=${DATE}">`));
    assert.match(body, new RegExp(`<div id="panel" data-kind="version" data-sel="v:${id}"`));
    const flash = storeFlash(body);
    assert.deepEqual([flash.kind, flash.text], ['ok', `'Rollers' v1 is live for Thu 19 Nov 19:30. Plan code ${sig}.`]);
    assert.ok(flash.lines.includes('Riders in the event get it within a minute.'), flash.all);
    assert.ok(!flash.all.includes('Riders get it from'), flash.all);
    // the warnings after it, in the result page's order
    assert.deepEqual(flash.lines.slice(-1), ['No pull watts in this plan: export it from ZwiftGopher with pull power.']);
    // no Wrong file? and no Delete plan in its place (spec §4.1), no way back to an earlier version
    const panel = element(body, '<div id="panel"');
    assert.ok(!panel.includes('/manage/sheet/delete') && !textOf(body).includes('Wrong file?'), panel);
    assert.ok(!body.includes('/manage/undo'));
    assert.ok(!body.includes('/manage/plan/back'), 'no earlier version to go back to');
    assert.ok(!flash.all.includes('What this changes'), flash.all);
    assert.ok(!body.includes('http-equiv'));
    assert.equal(srv.store.get(CID).inbox.length, 0, 'the entry is used');
});


test('Store flash: live, plan code, what changes, never the planner\'s roster', async t => {
    const c = makeClub();
    const prev = upload(c.club, 'rollers', {type: 'A', riders: ['1002', '1003'], at: T('2026-11-19T14:00:00Z')});
    const sp = upload(c.club, 'sprockets', {riders: ['1001', '1009'], at: T('2026-11-19T14:05:00Z')});
    const srv = await serve(t, c);
    // Ben moves from Sprockets to Rollers; Cleo has a W/kg target, Dan watts only
    const json = planJson('Rollers fast', ['1001', '1002', '1003'], ['1004']);
    json.riders['1002'].pull_wkg = 4.2;
    json.riders['1003'].pull_power = 325;
    const body = await storeOk(srv, c.cookie, {team: 'rollers', json}, {as: 'new', live: 'on', type: 'fast', date: DATE});
    const club = srv.store.get(CID);
    const id = liveId(club, 'rollers');
    assert.notEqual(id, prev);
    const flash = storeFlash(body);
    assert.equal(flash.text, `'Rollers · fast' v1 is live for Thu 19 Nov 19:30. Plan code ${club.sheets[id].sig}.`);
    assert.ok(flash.all.includes('\'Rollers · A\' stays as another plan. Riders in the event get it within a minute.'), flash.all);
    // what this changes: the move, the hole, and one way to fill it, with Sprockets' only plan
    assert.ok(flash.all.includes('Ben moves from Sprockets to Rollers. Still to do: Sprockets.'), flash.all);
    assert.deepEqual(flash.links, [[`/manage/upload?team=sprockets&plan=${sp}&date=2026-11-19`, 'Upload for Sprockets']]);
    // the rider table: the ride order, never the planner's roster (Eva)
    const table = element(body, '<div id="panel-body"');
    assert.deepEqual([...new Set([...table.matchAll(/<span class="pt-nm">([^<]*)<\/span>/g)].map(m => m[1]))], ['Ben', 'Cleo', 'Dan']);
    assert.ok(!/bench/i.test(textOf(body)), textOf(body));
    assert.ok(!textOf(table).includes('Eva'), textOf(table));
    // each rider's pull @ target in the club's unit (W/kg): Cleo's own, Dan's watts over his 70 kg, Ben
    // none; the live version as riders get it, so no NEW mark (team cockpit spec §5.3b; the Plan
    // column's states left out here)
    const rows = [...table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(m => textOf(m[1].replace(/<td class="rstate[^"]*">[\s\S]*?<\/td>/, '')).replace(/\s+/g, ' ').trim()).filter(r => /^\d/.test(r));
    assert.deepEqual(rows, ['1 Ben 60 s', '2 Cleo 60 s @ 4.2', '3 Dan 60 s @ 4.6'], table);
});


test('upload: Store and make live for the Sunday race leaves Thursday\'s live plan; "Riders keep" names the same race\'s plan', async t => {
    // live is per race (races spec §1)
    const c = makeClub();
    const thu = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const sun = upload(c.club, 'rollers', {type: 'sunday', riders: ROLLERS.slice(0, 4), at: T('2026-11-19T14:10:00Z'), date: '2026-11-22'});
    const srv = await serve(t, c);
    assert.deepEqual([liveId(srv.store.get(CID), 'rollers', DATE), liveId(srv.store.get(CID), 'rollers', '2026-11-22')], [thu, sun]);
    // a second Sunday plan stored, not live: riders keep Sunday's plan, not Thursday's
    const kept = storeFlash(await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers easy', ['1005', '1006'])},
        {as: 'new', live: '', type: 'easy', date: '2026-11-22'})).all;
    assert.ok(kept.includes('Stored as v1 of \'Rollers · easy\', not live. Riders keep \'Rollers · sunday\' v1.'), kept);
    // Store and make live for Sunday: Thursday keeps its live plan
    const made = storeFlash(await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers late', ['1007', '1008'])},
        {as: 'new', live: 'on', type: 'late', date: '2026-11-22'})).all;
    assert.ok(made.includes('\'Rollers · late\' v1 is live for Sun 22 Nov 19:30.'), made);
    // the plan it replaced is that race's: Sunday's, never Thursday's
    assert.ok(made.includes('\'Rollers · sunday\' stays as another plan.'), made);
    assert.ok(!made.includes('Rollers · fast'), made);
    const club = srv.store.get(CID);
    assert.equal(liveId(club, 'rollers', DATE), thu, 'Thursday keeps its live plan');
    assert.notEqual(liveId(club, 'rollers', '2026-11-22'), sun);
    assert.equal(club.sheets[liveId(club, 'rollers', '2026-11-22')].type, 'late');
});


test('upload: stored, not live', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const body = await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers slow', ['1001', '1002', '1003'])}, {as: 'new', live: '', type: 'slow', date: DATE});
    const flash = storeFlash(body);
    assert.deepEqual([flash.kind, flash.text], ['ok', 'Stored as v1 of \'Rollers · slow\', not live. Riders keep \'Rollers · fast\' v1.']);
    const club = srv.store.get(CID);
    assert.equal(liveId(club, 'rollers'), live);
    const [[id]] = sheetsOf(srv, 'rollers').filter(([i]) => i !== live);
    // Make live for the new version in the panel: past the gate it asks first, in its place (the Make live rule)
    const ask = armOf(element(body, '<div id="panel-acts"'), '/manage/live') ?? '';
    assert.ok(textOf(ask).includes('Riders in the event get \'Rollers · slow\' v1 instead of \'Rollers · fast\' v1 within a minute.'), textOf(ask));
    assert.ok(armHas(ask, '/manage/live', `<input type="hidden" name="team" value="rollers"><input type="hidden" name="sheet" value="${id}"><input type="hidden" name="version" value="${VERSION_OF(srv, 'rollers')}">`, 'btn primary small', 'Make live'), body);
    assert.ok(!flash.all.includes('is live'));
    // a team without a live plan: its race has none
    const noneBody = await storeOk(srv, c.cookie, {team: 'sprockets', json: planJson('Sprockets', ['1009'])}, {live: '', date: DATE});
    const none = storeFlash(noneBody);
    // red at once, with Make live in the panel (spec §8)
    assert.deepEqual([none.kind, none.text], ['err', 'Stored as v1 of \'Sprockets\'. Not live: riders get nothing until you press Make live.']);
    assert.ok(armOf(element(noneBody, '<div id="panel-acts"'), '/manage/live'), noneBody);
    assert.equal(liveId(srv.store.get(CID), 'sprockets'), null);
});


test('upload: effects and holes', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const body = await storeOk(srv, c.cookie, {team: 'sprockets', json: planJson('Sprockets', ['1001', '1009'])}, {date: DATE});
    const flash = storeFlash(body);
    const effects = flash.all;
    assert.ok(effects.includes('Ben moves from Rollers to Sprockets.'), effects);
    assert.ok(effects.includes('Still to do: Rollers.'), effects);
    assert.ok(effects.indexOf('moves from') < effects.indexOf('Still to do'));
    assert.deepEqual(flash.links.map(([, text]) => text), ['Upload for Rollers']);
    const plan = liveId(srv.store.get(CID), 'sprockets');
    // the same plan again: nothing new, no move lines
    const again = storeFlash(await storeOk(srv, c.cookie, {team: 'sprockets', json: planJson('Sprockets', ['1001', '1009'])}, {as: plan})).all;
    assert.ok(again.includes('Same as \'Sprockets\' v1: nothing new stored.'), again);
    assert.ok(!again.includes('moves from'), again);
    // Ben off Sprockets' plan: back to Rollers, and nothing is left to do
    const back = storeFlash(await storeOk(srv, c.cookie, {team: 'sprockets', json: planJson('Sprockets', ['1009'])}, {as: plan})).all;
    assert.ok(back.includes('Ben moves from Sprockets to Rollers.'), back);
    assert.ok(!back.includes('Still to do'), back);
});


test('upload: warnings', async t => {
    const c = makeClub({teams: [['Rollers', '19:30'], ['Sprockets', '19:40'], ['Cranks', null]]});
    const EIGHT_S = [...ROLLERS.slice(0, 7), '1009'];
    upload(c.club, 'sprockets', {riders: EIGHT_S, at: T('2026-11-19T13:00:00Z')});
    const srv = await serve(t, c);
    // the name, with the way to the team it names
    let body = await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Sprockets', ['1010'])}, {live: '', date: DATE});
    let text = textOf(body);
    assert.ok(text.includes('This plan says Sprockets'), text);
    assert.match(body, /<li class="warn"><svg[^>]*>[\s\S]*?<\/svg><span>This plan says Sprockets <a href="\/manage\/upload\?team=sprockets">Upload it for Sprockets instead<\/a><\/span><\/li>/);
    assert.ok(!text.includes('It looks like'));
    // the overlap: 7 of these 8 riders ride in Sprockets' live plan; the upload goes live, and the
    // hint compares with Rollers' live plan before it
    text = textOf(await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers new', ROLLERS)}, {type: 'new', date: DATE}));
    assert.ok(text.includes('\'Rollers · new\' v1 is live for Thu 19 Nov 19:30.'), text);
    assert.ok(text.includes('It looks like Sprockets (7 of 8 riders)'), text);
    assert.ok(!text.includes('This plan says'));
    assert.ok(!text.includes('Someone changed'), 'base is the version now');
    // base older than the team's version: the earlier change's time in the club's zone
    srv.clock.now = T('2026-11-19T18:21:00Z');
    await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ['1010'])}, {live: '', type: 'fast', date: DATE});
    srv.clock.now = NOW;
    const fast = sheetsOf(srv, 'rollers').find(([, s]) => s.type === 'fast')[1].plan;
    const base = VERSION_OF(srv, 'rollers') - 1;
    text = textOf(await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ['1010', '1002'])}, {as: fast, live: '', base}));
    assert.ok(text.includes('Someone changed Rollers at 19:21, after you opened this page'), text);
    // no start time, in red
    body = await storeOk(srv, c.cookie, {team: 'cranks', json: planJson('Cranks', ['1011'])}, {date: DATE});
    text = textOf(body);
    const cranks = liveId(srv.store.get(CID), 'cranks');
    assert.match(body, /<li class="err"><svg[^>]*>[\s\S]*?<\/svg><span>Cranks has no start time: riders on this plan get nothing\.<\/span><\/li>/);
    assert.ok(text.includes(`'Cranks' v1 is live. Plan code ${srv.store.get(CID).sheets[cranks].sig}.`), text);
    assert.ok(!text.includes('Riders get it from'), text);
    // no pull power in the JSON: no watts (the JSON export only, races Task 7) ...
    assert.ok(text.includes('No pull watts in this plan: export it from ZwiftGopher with pull power.'), text);
    // ... not with pull_power in the JSON (spec §5.2, F13)
    const pp = planJson('Cranks', ['1001', '1002']);
    pp.riders['1001'].pull_power = 310;
    const ppBody = await storeOk(srv, c.cookie, {team: 'cranks', json: pp}, {as: cranks});
    text = textOf(ppBody);
    assert.ok(!text.includes('No pull watts in this plan'), text);
    // the watts in the rider table (as W/kg there: 310 W at Ben's weight); the live version as riders
    // get it, no NEW mark (team cockpit spec §5.3b)
    assert.match(textOf(element(ppBody, '<div id="panel-body"')), /1 Ben 60 s @ 4\.4/);
    // a blank pull_power for every rider: no watts, so the warning shows (as the mod's import warns)
    const blank = planJson('Cranks', ['1001', '1002']);
    for (const r of Object.values(blank.riders)) {
        r.pull_power = '';
    }
    body = await storeOk(srv, c.cookie, {team: 'cranks', json: blank}, {as: cranks});
    assert.match(body, /<li class="warn"><svg[^>]*>[\s\S]*?<\/svg><span>No pull watts in this plan: export it from ZwiftGopher with pull power\.<\/span><\/li>/);
});


test('upload: event link', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    const ok = textOf(await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS)}, {date: DATE, event: 'https://www.zwift.com/eu/events/view/4567890'}));
    assert.ok(ok.includes('Event link 4567890: the plan goes only to riders in that event.'), ok);
    const club = srv.store.get(CID);
    assert.strictEqual(race(club, 'rollers', DATE).pinnedEventId, 4567890);
    assert.ok(textOf(await (await srv.get('/manage/team/rollers')).text()).includes('Event link 4567890 (yours)'));
    // the assign page with a link that does not parse: no dry run, the text instead
    const id = await intake(srv, c.cookie, {team: 'sprockets', json: planJson('Sprockets', ['1009'])});
    const page = await assignOf(srv, id, '?team=sprockets&as=new&drawn=sprockets:new&event=https%3A%2F%2Fexample.org%2Fx');
    assert.deepEqual(whatHappens(page.body), ['This is not a Zwift or ZwiftPower event link.']);
    assert.ok(page.body.includes('name="event" maxlength="300" inputmode="url" autocomplete="off" value="https://example.org/x"'), page.body);
    // Store with it: refused, nothing stored, the entry stays
    const file = storedClub(srv);
    const res = await storePost(srv, c.cookie, id, {team: 'sprockets', as: 'new', live: 'on', confirm: '1', date: DATE, base: VERSION_OF(srv, 'sprockets'), drawn: 'sprockets:new', event: 'https://example.org/x'});
    assert.equal(res.status, 400);
    assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'This is not a Zwift or ZwiftPower event link.'});
    assert.ok(res.body.indexOf('class="flash err"') < res.body.indexOf('data-assign'));
    assert.equal(storedClub(srv), file);
    assert.equal(inboxOf(srv).length, 1);
});


test('upload: paste', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    await storeOk(srv, c.cookie, {team: 'rollers', paste: JSON.stringify(planJson('Rollers fast', ROLLERS))}, {date: DATE});
    const club = srv.store.get(CID);
    assert.equal(club.sheets[liveId(club, 'rollers')].via, 'paste');
    // an empty file input counts as absent (F30): a browser sends it with filename="" and no bytes
    // (undici's FormData leaves the filename out, so the body is written by hand)
    const B = '----paceline-test-boundary';
    const part = (name, value, filename) => `--${B}\r\nContent-Disposition: form-data; name="${name}"`
        + `${filename === undefined ? '' : `; filename="${filename}"\r\nContent-Type: application/octet-stream`}\r\n\r\n${value}\r\n`;
    const raw = part('club', CID) + part('team', 'sprockets') + part('forPlan', '') + part('json', '', '')
        + part('paste', JSON.stringify(planJson('Sprockets', ['1009']))) + part('text', '', '') + `--${B}--\r\n`;
    const res = await fetch(srv.base + '/manage/upload?team=sprockets', {
        method: 'POST', redirect: 'manual', headers: {cookie: c.cookie, 'content-type': `multipart/form-data; boundary=${B}`}, body: raw,
    });
    assert.equal(res.status, 303, await res.text());
    const entry = inboxOf(srv).at(-1);
    assert.deepEqual([entry.via, entry.text], ['paste', null]);
    assert.equal(res.headers.get('location'), `/manage/team/sprockets?e=${entry.id}#panel`);
    const stored = await storePost(srv, c.cookie, entry.id, {team: 'sprockets', as: 'new', live: 'on', confirm: '1', date: DATE, base: VERSION_OF(srv, 'sprockets'), drawn: 'sprockets:new'});
    assert.equal(stored.status, 303, stored.body);
    const after = srv.store.get(CID);
    assert.equal(after.sheets[liveId(after, 'sprockets')].via, 'paste');
    // a file wins over the paste
    await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers B', ['1001']), paste: '{"no": "plan"}'}, {as: 'new', live: '', type: 'B', date: DATE});
    assert.ok(sheetsOf(srv, 'rollers').some(([, s]) => s.label === 'Rollers · B' && s.via === 'file'));
});


test('upload: names from the file are escaped', async t => {
    const EVIL = '<img src=x onerror=alert(1)>';
    const c = makeClub();
    const srv = await serve(t, c);
    const json = planJson(EVIL, ROLLERS);
    json.riders['1001'].name = EVIL;
    const fields = {team: 'rollers', json, text: textExport([], [`${EVIL}x\t1\t1\tRed\t#ff0000`])};
    const id = await intake(srv, c.cookie, fields);
    const page = (await assignOf(srv, id)).body;
    assert.ok(!page.includes('<img'), 'no raw tag on the assign page');
    assert.ok(page.includes('&lt;img src=x onerror=alert(1)&gt;'));
    const body = await storeOk(srv, c.cookie, fields, {date: DATE});
    assert.ok(!body.includes('<img'), 'no raw tag');
    assert.ok(body.includes('&lt;img src=x onerror=alert(1)&gt;'));
});


test('upload: a new version of the live plan with "store only" stays not live', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const v1 = structuredClone(srv.store.get(CID).sheets[live]);
    const body = await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers draft', ['1001'])}, {as: live, live: ''});
    const club = srv.store.get(CID);
    assert.equal(liveId(club, 'rollers'), live);
    assert.deepEqual(club.sheets[live], v1, 'the live version is untouched');
    const versions = sheetsOf(srv, 'rollers');
    assert.equal(versions.length, 2, 'one more version');
    const [[id, v2]] = versions.filter(([i]) => i !== live);
    assert.deepEqual([v2.plan, v2.n, v2.label], [live, 2, 'Rollers · fast']);
    assert.ok(textOf(body).includes('Stored as v2 of \'Rollers · fast\', not live. Riders keep \'Rollers · fast\' v1.'), textOf(body));
    assert.ok(body.includes(`<input type="hidden" name="sheet" value="${id}">`), 'Make live for the new version');
});


test('upload: an empty event field keeps the link of the race', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-16T09:00:00Z'), pinned: 4567890});
    const srv = await serve(t, c);
    // the pull-time fix on race day: a new version, no link typed: the race keeps its link
    const body = textOf(await storeOk(srv, c.cookie, {team: 'rollers', forPlan: live, json: planJson('Rollers fast', ROLLERS.slice(0, 7))}, {as: live, event: ''}));
    assert.ok(body.includes('\'Rollers · fast\' v2 is live for Thu 19 Nov 19:30.'), body);
    assert.ok(!body.includes('stays as another plan'), body);
    assert.ok(body.includes('Event link 4567890: the plan goes only to riders in that event.'), body);
    const club = srv.store.get(CID);
    assert.notEqual(liveId(club, 'rollers'), live);
    assert.equal(club.sheets[liveId(club, 'rollers')].plan, live);
    assert.strictEqual(race(club, 'rollers', DATE).pinnedEventId, 4567890);
    assert.ok(textOf(await (await srv.get('/manage/team/rollers')).text()).includes('Event link 4567890 (yours)'));
});


test('upload: the planner name preselects the plan; Store with the box off keeps the live version', async t => {
    // the review's repro: 19:10 on race day, a 2-rider draft with the live plan's planner name
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: SETUP_AT});
    const srv = await serve(t, c, {now: T('2026-11-19T18:10:00Z')});
    const fields = {team: 'rollers', json: planJson('Rollers fast', ['1001', '1002'])};
    const id = await intake(srv, c.cookie, fields);
    const page = (await assignOf(srv, id)).body;
    assert.deepEqual(checkedOf(page, 'as'), [live]);
    const res = await storePost(srv, c.cookie, id, {team: 'rollers', as: live, type: 'fast', date: DATE, base: VERSION_OF(srv, 'rollers'), drawn: `rollers:${live}`});
    assert.equal(res.status, 303, res.body);
    assert.ok(textOf(res.body).includes('Stored as v2 of \'Rollers · fast\', not live. Riders keep \'Rollers · fast\' v1.'), textOf(res.body));
    const club = srv.store.get(CID);
    assert.equal(liveId(club, 'rollers'), live);
    assert.deepEqual(Object.keys(club.sheets[live].json.riders), ROLLERS);
    const versions = sheetsOf(srv, 'rollers');
    assert.equal(versions.length, 2, 'one more version');
    assert.ok(versions.every(([, s]) => s.plan === live));
});


test('upload: at most 20 import warnings, then how many more', async t => {
    // the warnings of a text export's rows: only an entry uploaded before the text upload went (races
    // Task 7) has them now, so the entry is made as that upload made it
    const c = makeClub();
    const srv = await serve(t, c);
    const warnings = Array.from({length: 25}, (_, i) => ({code: 'unmatched-text-row', name: `Nobody ${i}`}));
    // the entry keeps 21 of the 25 warnings (Ruling 8) and counts the other 4: 20 shown, then "5 more"
    const id = srv.store.change(CID, cl => addEntry(cl, {source: 'upload', team: 'rollers', via: 'file', json: planJson('Rollers fast', ROLLERS), text: null, warnings},
        {now: NOW, newId: () => randomId(6)}));
    assert.equal(inboxOf(srv).at(-1).warnings.length, 21);
    assert.equal(inboxOf(srv).at(-1).warningsMore, 4);
    const lines = whatHappens((await assignOf(srv, id)).body);
    assert.equal(lines.filter(l => l.endsWith('from the text export is not in the JSON.')).length, 20);
    assert.equal(lines.at(-1), '… and 5 more import warnings.');
    const stored = await storePost(srv, c.cookie, id, {team: 'rollers', as: 'new', live: 'on', confirm: '1', date: DATE, base: VERSION_OF(srv, 'rollers'), drawn: 'rollers:new'});
    assert.equal(stored.status, 303, stored.body);
    const body = stored.body;
    assert.equal(count(body, 'from the text export is not in the JSON.'), 20);
    assert.ok(body.includes('"Nobody 19" from'.replace(/"/g, '&quot;')));
    assert.ok(!body.includes('Nobody 20'));
    assert.match(body, /<li class="warn"><svg[^>]*>[\s\S]*?<\/svg><span>… and 5 more import warnings\.<\/span><\/li>/);
});


test('old pages: the preview answers 303 out of date', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const file = storedClub(srv);
    const res = await followPost(srv, c.cookie, '/manage/upload/preview', {team: 'rollers', label: 'fast', date: DATE});
    assert.equal(res.location, '/manage');
    assert.deepEqual(res.flash, {kind: 'err', text: 'This page was out of date. Nothing was changed.'});
    assert.equal(storedClub(srv), file);
    assert.equal(inboxOf(srv).length, 0);
    // as a multipart body, as the old script sent it
    const multi = await postUpload(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS)}, {path: '/manage/upload/preview'});
    assert.equal(multi.status, 303);
    assert.equal(multi.headers.get('location'), '/manage');
    assert.equal(storedClub(srv), file);
    const get = await srv.get('/manage/upload/preview');
    assert.equal(get.status, 405);
    assert.equal(get.headers.get('allow'), 'POST');
});


test('upload: cross-site and anonymous', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    const fields = {team: 'rollers', json: planJson('Rollers fast', ROLLERS)};
    const cross = await postUpload(srv, c.cookie, fields, {headers: {'sec-fetch-site': 'cross-site'}});
    assert.equal(cross.status, 403);
    const anon = await postUpload(srv, null, fields);
    assert.equal(anon.status, 403);
    assert.equal(sheetsOf(srv, 'rollers').length, 0);
    assert.equal(inboxOf(srv).length, 0);
    // only GET and POST
    const put = await fetch(srv.base + '/manage/upload', {method: 'PUT', headers: {cookie: c.cookie}});
    assert.equal(put.status, 405);
});


test('upload: a huge plan is refused before matching; a text export is never read', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    // the review's payload: 8000 riders and text rows under other names; matching them one by one
    // held the server for about 15 s. 5000 rows (not 8000) keep the body under UPLOAD_BYTES.
    const n = 8000;
    const riders = {};
    const rows = ['Name\tWatts\tPull\tColor\tHex'];
    for (let i = 0; i < n; i++) {
        riders[String(100000 + i)] = 0;
    }
    for (let i = 0; i < 5000; i++) {
        rows.push(`Other ${i}\t300\t60\tRed\t#ff0000`);
    }
    const before = JSON.stringify(srv.store.get(CID));
    const t0 = performance.now();
    const pending = postUpload(srv, c.cookie, {team: 'rollers', json: {riders}, text: rows.join('\n')});
    // the server answers others meanwhile
    const health = await fetch(srv.base + '/healthz');
    assert.equal(health.status, 200);
    const res = await pending;
    const body = await res.text();
    assert.equal(res.status, 400);
    assert.ok(performance.now() - t0 < 1000, `${Math.round(performance.now() - t0)} ms`);
    assert.deepEqual(flashOf(body), {kind: 'err', text: 'A plan holds at most 40 riders, the planner\'s roster included; this one has 8000.'}, body);
    // riders plus the planner's roster count
    const bench = {};
    for (let i = 0; i < 35; i++) {
        bench[String(200000 + i)] = {name: `Bench ${i}`};
    }
    const res2 = await postUpload(srv, c.cookie, {team: 'rollers', json: {...planJson('Rollers fast', ROLLERS), roster: bench}});
    assert.deepEqual(flashOf(await res2.text()), {kind: 'err', text: 'A plan holds at most 40 riders, the planner\'s roster included; this one has 43.'});
    assert.equal(JSON.stringify(srv.store.get(CID)), before, 'nothing stored');
    assert.equal(inboxOf(srv).length, 0);
    // the 5000 text rows beside a plan: never read, never matched (races Task 7: the text upload
    // went; the 160-row cap went with it)
    const t1 = performance.now();
    await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS), text: rows.join('\n')});
    assert.ok(performance.now() - t1 < 1000, `${Math.round(performance.now() - t1)} ms`);
    assert.deepEqual(inboxOf(srv).map(e => [e.text, e.warnings]), [[null, []]]);
});


// The reviewer's I1 payload: `{},{},…` behind a riders key, `kb` KB long.
function emptyObjects(kb) {
    const head = '{"riders":{},"x":[';
    return head + Array(Math.floor((kb * 1024 - head.length - 2) / 3)).fill('{}').join(',') + ']}';
}

// The planner export at its largest that a sheet takes: 40 riders with every field of the
// fixture, all of them in the roster again, indented as the planner writes it (~88 KB).
function largestExport() {
    const fixture = JSON.parse(fs.readFileSync(new URL('../../tests/fixtures/rollers.json', import.meta.url), 'utf8'));
    const entry = Object.values(fixture.riders)[0];
    const big = {...fixture, riders: {}, roster: {}};
    for (let i = 0; i < 40; i++) {
        const id = String(5200000 + i);
        // braces, brackets and commas inside strings are not counted
        big.riders[id] = {...structuredClone(entry), name: `Rider {${i}}, [Kettenfett RC]`, order: i + 1};
        big.roster[id] = structuredClone(big.riders[id]);
    }
    return JSON.stringify(big, null, 4);
}

// A POST to `p` (the upload, or the preview) that declares `bytes` of body and sends none of it:
// {status, text, headers}. (A body sent in full races the server closing the connection after its
// early 413.)
function declared(srv, cookie, bytes, p = '/manage/upload?team=rollers') {
    return new Promise((resolve, reject) => {
        const req = http.request(srv.base + p, {method: 'POST', headers: {
            cookie, 'content-type': 'multipart/form-data; boundary=x', 'content-length': bytes,
        }}, res => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', d => {
                text += d;
            });
            res.on('end', () => resolve({status: res.statusCode, text, headers: res.headers}));
        });
        req.on('error', reject);
        req.flushHeaders();
    });
}

// JSON.parse calls on exactly this text while `fn` runs (the server runs in this process).
async function parsesOf(text, fn) {
    const parse = JSON.parse;
    let n = 0;
    JSON.parse = function (s, ...rest) {
        n += s === text ? 1 : 0;
        return parse.call(this, s, ...rest);
    };
    try {
        await fn();
    } finally {
        JSON.parse = parse;
    }
    return n;
}


test('upload: the body and the shape of each file are capped before any parse', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    const before = JSON.stringify(srv.store.get(CID));
    // over 256 KB: 413 before any of the body is read (the review's 1 MB payload, and just over)
    for (const bytes of [1024 * 1024, 256 * 1024 + 1]) {
        const res = await declared(srv, c.cookie, bytes);
        assert.deepEqual([res.status, res.text], [413, 'The upload is larger than 256 KB.']);
    }
    // under 256 KB, but far more objects, nesting or elements than a planner export: refused
    // without a parse, pasted or loaded
    const SHAPE_TEXT = 'This file holds far more than a planner export. Load the planner\'s JSON export of this team\'s plan.';
    // each at its cap (4000 objects and arrays, 16 levels, 20000 commas), and one over it
    const containers = '{"riders":{},"x":[' + Array(3997).fill('{}').join(',') + ']}';
    const levels = '{"riders":{},"x":' + '['.repeat(15) + ']'.repeat(15) + '}';
    const commas = '{"riders":{},"x":[' + Array(20000).fill('0').join(',') + ']}';
    for (const [fields, what] of [
        [{json: emptyObjects(250)}, 'the review payload at 250 KB'],
        [{json: containers.replace(']}', ',{}]}')}, '4001 objects and arrays'],
        [{json: levels.replace('[', '[[').replace(']', ']]')}, '17 levels'],
        [{json: commas.replace(']}', ',0]}')}, '20001 commas'],
        [{paste: emptyObjects(200)}, 'pasted'],
    ]) {
        let res;
        const n = await parsesOf(fields.json ?? fields.paste ?? fields.text, async () => {
            res = await postUpload(srv, c.cookie, {team: 'rollers', ...fields});
        });
        const body = await res.text();
        assert.equal(res.status, 400, what);
        assert.deepEqual(flashOf(body), {kind: 'err', text: SHAPE_TEXT}, what);
        assert.equal(n, 0, `${what}: not parsed`);
    }
    assert.equal(JSON.stringify(srv.store.get(CID)), before, 'nothing stored');
    assert.equal(inboxOf(srv).length, 0);
    // at the caps: past the shape check, then refused as no plan
    for (const json of [containers, levels, commas]) {
        const res = await postUpload(srv, c.cookie, {team: 'rollers', json});
        const body = await res.text();
        assert.equal(res.status, 400);
        assert.deepEqual(flashOf(body), {kind: 'err', text: 'This is not a ZwiftGopher TTT plan.'}, body);
    }
    assert.equal(inboxOf(srv).length, 0);
    // the largest real export passes, parsed once for the checks, the import and the entry
    const largest = largestExport();
    assert.ok(Buffer.byteLength(largest) > 80 * 1024, `${Buffer.byteLength(largest)} bytes`);
    let id;
    const n = await parsesOf(largest, async () => {
        id = await intake(srv, c.cookie, {team: 'rollers', json: largest});
    });
    assert.equal(n, 1, 'parsed once');
    const entry = inboxOf(srv).find(e => e.id === id);
    assert.equal(Object.keys(entry.json.riders).length, 40);
    // and it stores
    const res = await storePost(srv, c.cookie, id, {team: 'rollers', as: 'new', live: 'on', confirm: '1', date: DATE, base: VERSION_OF(srv, 'rollers'), drawn: 'rollers:new'});
    assert.equal(res.status, 303, res.body);
    const club = srv.store.get(CID);
    assert.equal(Object.keys(club.sheets[liveId(club, 'rollers')].json.riders).length, 40);
});


// An upload whose headers and first half of the body are sent now; `finish()` sends the rest.
// `done` resolves to {status, text}.
function trickled(srv, cookie, {team, version, title, riders}) {
    const B = '----paceline-slow-boundary';
    const part = (name, value, filename) => `--${B}\r\nContent-Disposition: form-data; name="${name}"`
        + `${filename === undefined ? '' : `; filename="${filename}"\r\nContent-Type: application/json`}\r\n\r\n${value}\r\n`;
    const raw = Buffer.from(part('club', CID) + part('team', team) + part('base', String(version))
        + part('json', JSON.stringify(planJson(title, riders)), 'plan.json') + part('date', DATE) + `--${B}--\r\n`);
    const half = Math.floor(raw.length / 2);
    const {port} = new URL(srv.base);
    let finish;
    const done = new Promise((resolve, reject) => {
        const req = http.request({host: '127.0.0.1', port, method: 'POST', path: `/manage/upload?team=${team}`, headers: {
            cookie, 'content-type': `multipart/form-data; boundary=${B}`, 'content-length': raw.length,
        }}, res => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', d => {
                text += d;
            });
            res.on('end', () => resolve({status: res.statusCode, text}));
        });
        req.on('error', reject);
        req.write(raw.subarray(0, half));
        finish = () => req.end(raw.subarray(half));
    });
    return {done, finish: () => finish()};
}

async function waitBusy(srv, cid) {
    for (let i = 0; i < 100 && !srv.server.web.sheetUploads.busy(cid); i++) {
        await new Promise(r => setTimeout(r, 10));
    }
}


test('upload: one at a time per club, other clubs go on', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    // a second club with its own team and link cookie
    const other = secondClub({teams: [['Spokes', '19:30']]});
    const [spokes] = other.slugs;
    srv.store.create(other.club);
    const otherCookie = other.cookie;
    // the first upload's body comes in slowly: its headers and half of it, the rest later
    const first = trickled(srv, c.cookie, {team: 'rollers', version: VERSION_OF(srv, 'rollers'), title: 'Rollers fast', riders: ROLLERS});
    await waitBusy(srv, CID);
    assert.equal(srv.server.web.sheetUploads.busy(CID), true, 'the first upload holds its club\'s slot');
    assert.equal(srv.server.web.sheetUploads.busy('p2m8c4t1v9'), false);
    const before = JSON.stringify(srv.store.get(CID));
    const second = await postUpload(srv, c.cookie, {team: 'sprockets', json: planJson('Sprockets', ['1009'])});
    const body = await second.text();
    assert.equal(second.status, 503);
    assert.equal(second.headers.get('retry-after'), '5');
    // Sprockets' upload page, the refusal at its top
    assert.deepEqual(flashOf(body), {kind: 'err', text: 'Another upload is running, try again in a moment.'}, body);
    assert.ok(body.includes('<h1>Upload a plan for Sprockets</h1>'), body);
    assert.ok(formOf(body).includes('<input type="hidden" name="team" value="sprockets">'));
    assert.equal(JSON.stringify(srv.store.get(CID)), before, 'nothing stored');
    // the other club is not held up by the first one's slow body
    const elsewhere = await postUpload(srv, otherCookie, {team: spokes, json: planJson('Spokes', ['1009'])});
    assert.equal(elsewhere.status, 303, await elsewhere.text());
    assert.equal(srv.store.get('p2m8c4t1v9').inbox.length, 1);
    assert.equal(srv.server.web.sheetUploads.busy(CID), true, 'the first still holds its slot');
    // the first goes through, and then the slot is free again
    first.finish();
    const done = await first.done;
    assert.equal(done.status, 303, done.text);
    assert.equal(srv.server.web.sheetUploads.busy(CID), false);
    await intake(srv, c.cookie, {team: 'sprockets', json: planJson('Sprockets', ['1009'])});
    // a refused body frees it as well
    assert.equal((await declared(srv, c.cookie, 1024 * 1024)).status, 413);
    assert.equal(srv.server.web.sheetUploads.busy(CID), false);
    assert.deepEqual(inboxOf(srv).map(e => e.team), ['rollers', 'sprockets']);
    // busy, for a team that is gone: the team-gone page with the refusal
    srv.server.web.sheetUploads.take(CID);
    const gone = await postUpload(srv, c.cookie, {team: 'gone', json: planJson('Sprockets', ['1009'])});
    const goneBody = await gone.text();
    assert.equal(gone.status, 503);
    assert.ok(goneBody.includes('This team no longer exists.'), goneBody);
    assert.deepEqual(flashOf(goneBody), {kind: 'err', text: 'Another upload is running, try again in a moment.'});
    srv.server.web.sheetUploads.release(CID);
});


test('upload: at most 8 bodies in flight on the server', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    const slots = srv.server.web.sheetUploads;
    for (let i = 0; i < 8; i++) {
        assert.equal(slots.take(`x${i}`), 'ok');
    }
    const before = JSON.stringify(srv.store.get(CID));
    const res = await postUpload(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS)});
    const body = await res.text();
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('retry-after'), '5');
    assert.deepEqual(flashOf(body), {kind: 'err', text: 'The server is busy with other uploads, try again in a moment.'}, body);
    assert.ok(formOf(body).includes('<input type="hidden" name="team" value="rollers">'));
    assert.equal(JSON.stringify(srv.store.get(CID)), before, 'nothing stored');
    assert.equal(slots.size(), 8, 'a refused upload takes no slot');
    slots.release('x0');
    await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS)});
    assert.equal(slots.busy(CID), false);
    assert.equal(slots.size(), 7);
});


test('upload: a body that takes too long is cut off with 408, and the log names the club', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    assert.equal(srv.server.web.sheetBodyMs, 30000);
    srv.server.web.sheetBodyMs = 300;
    const warned = [];
    const warn = console.warn;
    console.warn = m => warned.push(String(m));
    t.after(() => {
        console.warn = warn;
    });
    const slow = trickled(srv, c.cookie, {team: 'rollers', version: VERSION_OF(srv, 'rollers'), title: 'Rollers fast', riders: ROLLERS});
    await waitBusy(srv, CID);
    const done = await slow.done;
    assert.equal(done.status, 408, done.text);
    const line = warned.find(m => /sheet upload of club k7f3q9x2m4 cut off/.test(m));
    assert.ok(line, warned.join('\n'));
    assert.ok(!/1001|1009/.test(line), 'no Zwift ID');
    assert.equal(srv.server.web.sheetUploads.busy(CID), false);
    assert.equal(inboxOf(srv).length, 0);
});


test('upload: a byte order mark is no error', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    await intake(srv, c.cookie, {team: 'rollers', json: '﻿' + JSON.stringify(planJson('Rollers fast', ROLLERS))});
    assert.deepEqual(Object.keys(inboxOf(srv)[0].json.riders), ROLLERS);
});


test('upload: a JSON array is no planner JSON export', async t => {
    // importFiles reads a JSON array of '|' rows as a text export; the upload takes the JSON export
    // only (races Task 7), so the array is refused as no JSON object, as the file or pasted
    const c = makeClub();
    const srv = await serve(t, c);
    const before = JSON.stringify(srv.store.get(CID));
    const rows = JSON.stringify(Array.from({length: 200}, () => '|1|1||')).replace(/","/g, '",\n"');
    for (const fields of [{json: rows}, {paste: rows}]) {
        const res = await postUpload(srv, c.cookie, {team: 'rollers', ...fields});
        assert.equal(res.status, 400);
        assert.deepEqual(flashOf(await res.text()), {kind: 'err', text: 'This is not a planner JSON export.'});
    }
    assert.equal(JSON.stringify(srv.store.get(CID)), before);
    assert.equal(inboxOf(srv).length, 0);
});


// ---- the race choice, the file as the quiet way in (races spec §4 "Upload / assign", "Which race a
// new plan goes to"; races Task 7) ----

// The clock after Thursday's race: Rollers (weekly, Thursdays 19:30) has two races ahead, Sun 22 Nov
// at 18:00 (its plan live) and Thu 26 Nov (its plan not live), one plan each.
const FRI = T('2026-11-20T10:00:00Z');
async function twoRaces(t) {
    const c = makeClub();
    const sun = upload(c.club, 'rollers', {riders: ROLLERS, at: T('2026-11-18T10:00:00Z'), date: '2026-11-22'});
    race(c.club, 'rollers', '2026-11-22').start = '18:00';
    const thu = upload(c.club, 'rollers', {riders: ROLLERS, at: T('2026-11-18T10:05:00Z'), date: '2026-11-26', live: false});
    const srv = await serve(t, c, {now: FRI});
    return {c, srv, sun, thu};
}
// a plan pushed from ZwiftGopher for Rollers: its entry id
const pushedEntry = srv => srv.store.change(CID, c => receiveEntry(c, {team: 'rollers', via: 'zwiftgopher', json: planJson('Rollers', ['1001', '1002']), text: null},
    {now: FRI, newId: () => randomId(6)}));


test('a pushed plan with two races ahead: every race\'s plans in "Store as"; a new plan\'s race fold has the race radios, the nearest checked', async t => {   // [Review Focus 5]
    const {srv} = await twoRaces(t);
    const id = pushedEntry(srv);
    // its planner name matches Sunday's plan: that version, the plans of both races listed with their
    // days, no race radio (a version takes its plan's race, user 23 Nov 2026)
    const version = (await assignOf(srv, id)).body;
    assert.deepEqual(checkedOf(version, 'as').length, 1);
    assert.ok(textOf(version).includes('Sun 22 Nov · live · v1') && textOf(version).includes('Thu 26 Nov · v1'), textOf(version));
    assert.ok(!version.includes('name="race"'), version);
    const page = (await assignOf(srv, id, '?team=rollers&as=new&drawn=rollers:new')).body;
    const radios = [...page.matchAll(/<input type="radio" name="race" value="([^"]+)"( checked)?>/g)].map(m => [m[1], Boolean(m[2])]);
    assert.deepEqual(radios, [['2026-11-22', true], ['2026-11-26', false]]);
    // in the race fold, before the date field: each with its day and time and how many plans it has
    const fold = element(page, '<details class="fold as-race"');
    assert.ok(fold.indexOf('name="race"') > 0 && fold.indexOf('name="race"') < fold.indexOf('type="date"'), fold);
    assert.ok(barButtons(page), page);
    const fieldset = /<fieldset class="choices"><legend>Race<\/legend>[\s\S]*?<\/fieldset>/.exec(page)?.[0] ?? '';
    assert.deepEqual(textOf(fieldset).trim(), 'Race Sun 22 Nov · 18:00 1 plan Thu 26 Nov · 19:30 1 plan');
    assert.ok(page.indexOf('<legend>Store as</legend>') < page.indexOf('<legend>Race</legend>'), page);
    // the page says which race it was drawn for
    assert.ok(page.includes('<input type="hidden" name="startFor" value="2026-11-22">'), page);
    // one race ahead: no choice
    const one = makeClub();
    upload(one.club, 'rollers', {riders: ROLLERS, at: T('2026-11-18T10:00:00Z'), date: '2026-11-26'});
    const lone = await serve(t, one, {now: FRI});
    const solo = (await assignOf(lone, pushedEntry(lone), '?team=rollers&as=new&drawn=rollers:new')).body;
    assert.ok(!solo.includes('name="race"'), solo);
    assert.ok(solo.includes('<input type="hidden" name="startFor" value="2026-11-26">'), solo);
});


test('Store for a race the page was not drawn for stores nothing and redraws', async t => {                              // [Review Focus 5]
    const {c, srv} = await twoRaces(t);
    const id = pushedEntry(srv);
    const choice = {team: 'rollers', as: 'new', type: 'tempo', drawn: 'rollers:new', base: VERSION_OF(srv, 'rollers'), date: '2026-11-22', startFor: '2026-11-22'};
    const file = storedClub(srv);
    const other = await storePost(srv, c.cookie, id, {...choice, race: '2026-11-26'});
    assert.equal(other.status, 400);
    assert.equal(flashOf(other.body).text, 'Check the choices: the preview was for another race.');
    assert.ok(/name="race" value="2026-11-26" checked/.test(other.body));
    assert.ok(other.body.includes('<input type="hidden" name="startFor" value="2026-11-26">'), 'redrawn for that race');
    assert.equal(sheetsOf(srv, 'rollers').length, 2);
    assert.equal(storedClub(srv), file, 'nothing stored');
    assert.equal(inboxOf(srv).length, 1);
    // a date typed in More and stored without a redraw: the same
    const typed = await storePost(srv, c.cookie, id, {...choice, date: '2026-12-03', race: '2026-11-22'});
    assert.equal(typed.status, 400);
    assert.equal(flashOf(typed.body).text, 'Check the choices: the preview was for another race.');
    assert.ok(typed.body.includes('<input type="date" name="date" value="2026-12-03">'), typed.body);
    assert.equal(storedClub(srv), file);
    const stored = await storePost(srv, c.cookie, id, {...choice, race: '2026-11-26', date: '2026-11-26', startFor: '2026-11-26'});
    assert.equal(stored.status, 303);
    const made = sheetsOf(srv, 'rollers').find(([, s]) => s.type === 'tempo');
    assert.equal(made[1].date, '2026-11-26');
    assert.notEqual(srv.store.get(CID).teams.rollers.races['2026-11-26'].live, made[0]);
});


// The fields the Store form posts as drawn (hidden, text, time and date fields, the checked radios
// and boxes): what a Store without any change sends.
function assignFields(body) {
    const form = /<form id="store-[^"]*" method="post" action="\/manage\/inbox\/[^"]*" data-assign data-hold-reload>([\s\S]*?)<\/form>/.exec(body)?.[1];
    assert.ok(form, body);
    const fields = {};
    for (const [tag] of form.matchAll(/<input [^>]*>/g)) {
        const name = /name="([^"]*)"/.exec(tag)?.[1];
        const type = /type="([^"]*)"/.exec(tag)?.[1] ?? 'text';
        if (name === undefined || ((type === 'radio' || type === 'checkbox') && !/ checked[ >]/.test(tag))) {
            continue;
        }
        fields[name] = (/value="([^"]*)"/.exec(tag)?.[1] ?? '').replaceAll('&#39;', '\'').replaceAll('&quot;', '"').replaceAll('&amp;', '&');
    }
    return fields;
}


test('Store from a page drawn before the race\'s start time changed stores nothing and redraws (final review I-2)', async t => {
    // Sun 22 Nov 18:00 with its live plan; the assign page of a pushed plan is drawn at 18:00, for a
    // new plan (a version takes its plan's race and posts no time, user 23 Nov 2026)
    const {c, srv, sun} = await twoRaces(t);
    const id = pushedEntry(srv);
    const page = (await assignOf(srv, id, '?team=rollers&as=new&drawn=rollers:new&type=tempo')).body;
    const drawn = assignFields(page);
    assert.equal(drawn.start, '18:00');
    assert.equal(drawn.startWas, '18:00', 'the page carries the race start it was drawn with');
    // another captain (or a second tab) moves the race to 17:00 in its ⋯
    const moved = await followPost(srv, c.cookie, '/manage/race', {team: 'rollers', date: '2026-11-22', version: VERSION_OF(srv, 'rollers'),
        action: 'when', to: '2026-11-22', start: '17:00', confirm: '1'});
    assert.deepEqual(moved.flash, {kind: 'ok', text: 'Race moved to Sun 22 Nov 17:00.'});
    const file = storedClub(srv);
    // Store from the stale page: nothing stored, the race stays at 17:00
    const stale = await storePost(srv, c.cookie, id, drawn);
    assert.equal(stale.status, 400, stale.body);
    assert.deepEqual(flashOf(stale.body), {kind: 'err', text: 'Check the choices: the race\'s start time was changed meanwhile.'});
    assert.equal(storedClub(srv), file, 'nothing stored');
    assert.equal(srv.store.get(CID).teams.rollers.races['2026-11-22'].start, '17:00');
    assert.equal(srv.store.get(CID).teams.rollers.races['2026-11-22'].live, sun);
    assert.equal(inboxOf(srv).length, 1);
    // redrawn with the current time, and the page says what Store does
    const again = assignFields(stale.body);
    assert.deepEqual([again.start, again.startWas, again.startFor], ['17:00', '17:00', '2026-11-22']);
    assert.ok(whatHappens(stale.body).length > 0, stale.body);
    assert.ok(!whatHappens(stale.body).some(l => l.includes('now starts at 18:00')), JSON.stringify(whatHappens(stale.body)));
    // a GET redraw from the stale page (the script's) draws the current time as well
    const query = `?${new URLSearchParams(drawn)}`;
    assert.equal(assignFields((await assignOf(srv, id, query)).body).start, '17:00');
    // the redrawn page stores, and the race keeps 17:00
    const stored = await storePost(srv, c.cookie, id, again);
    assert.equal(stored.status, 303, stored.body);
    assert.equal(srv.store.get(CID).teams.rollers.races['2026-11-22'].start, '17:00');
    assert.equal(inboxOf(srv).length, 0);
});


test('Store from a page drawn before the team\'s time changed: a race already made keeps its time; one stored before times were pinned stores nothing and redraws (user, 22 and 23 Nov 2026)', async t => {
    // Thu 26 Nov was made at the team's 19:30, pinned as its own (user, 23 Nov 2026)
    const {c, srv} = await twoRaces(t);
    assert.equal(srv.store.get(CID).teams.rollers.races['2026-11-26'].start, '19:30');
    const id = pushedEntry(srv);
    const drawn = assignFields((await assignOf(srv, id, '?team=rollers&as=new&drawn=rollers:new&date=2026-11-26&startFor=2026-11-26&type=tempo')).body);
    assert.deepEqual([drawn.start, drawn.startWas], ['19:30', '19:30']);
    // the team's time is changed to 20:00 meanwhile: the race keeps 19:30, so the page is not stale
    srv.store.change(CID, cl => setStart(cl, 'rollers', '20:00', FRI));
    const kept = await storePost(srv, c.cookie, id, drawn);
    assert.equal(kept.status, 303, kept.body);
    assert.equal(srv.store.get(CID).teams.rollers.races['2026-11-26'].start, '19:30');
    // a race stored before times were pinned follows the team's time: a page drawn with the old one is stale
    srv.store.change(CID, cl => {
        cl.teams.rollers.races['2026-11-26'].start = null;
    });
    const id2 = pushedEntry(srv);
    const old = assignFields((await assignOf(srv, id2, '?team=rollers&as=new&drawn=rollers:new&date=2026-11-26&startFor=2026-11-26&type=easy')).body);
    assert.deepEqual([old.start, old.startWas], ['20:00', '20:00']);
    srv.store.change(CID, cl => setStart(cl, 'rollers', '20:15', FRI));
    const file = storedClub(srv);
    const stale = await storePost(srv, c.cookie, id2, old);
    assert.equal(stale.status, 400, stale.body);
    assert.deepEqual(flashOf(stale.body), {kind: 'err', text: 'Check the choices: the race\'s start time was changed meanwhile.'});
    assert.equal(storedClub(srv), file, 'nothing stored');
    assert.equal(srv.store.get(CID).teams.rollers.races['2026-11-26'].start, null, 'the race is not pinned to 20:00');
    assert.equal(inboxOf(srv).length, 1);
    // redrawn with the time as it is now; that form stores it as the race's own
    const again = assignFields(stale.body);
    assert.deepEqual([again.start, again.startWas], ['20:15', '20:15']);
    const stored = await storePost(srv, c.cookie, id2, again);
    assert.equal(stored.status, 303, stored.body);
    assert.equal(srv.store.get(CID).teams.rollers.races['2026-11-26'].start, '20:15');
});


test('Store: a start time the captain typed on a page that is not stale still moves the race (final review I-2)', async t => {
    const {c, srv} = await twoRaces(t);
    const id = pushedEntry(srv);
    const drawn = assignFields((await assignOf(srv, id, '?team=rollers&as=new&drawn=rollers:new&type=tempo')).body);
    assert.equal(drawn.startWas, '18:00');
    const res = await storePost(srv, c.cookie, id, {...drawn, start: '17:30'});
    assert.equal(res.status, 303, res.body);
    assert.equal(srv.store.get(CID).teams.rollers.races['2026-11-22'].start, '17:30');
    // a typed time on a GET redraw of a page that is not stale stays in the field
    const id2 = pushedEntry(srv);
    const fields = assignFields((await assignOf(srv, id2, '?team=rollers&as=new&drawn=rollers:new&type=easy')).body);
    assert.equal(fields.startWas, '17:30');
    assert.equal(assignFields((await assignOf(srv, id2, `?${new URLSearchParams({...fields, start: '17:45'})}`)).body).start, '17:45');
});


test('assign: the Store form\'s start time is prefilled, the race\'s own else the team\'s, required, with no hint (user, 22 and 23 Nov 2026)', async t => {
    const {srv} = await twoRaces(t);
    const id = pushedEntry(srv);
    const draw = async d => (await assignOf(srv, id, `?team=rollers&as=new&drawn=rollers:new&date=${d}&startFor=${d}`)).body;
    const field = body => /<label class="field">Start time(<input type="time" name="start"[^>]*>)(<span class="hint">[^<]*<\/span>)?<\/label>/.exec(element(body, '<div class="cp-form"'));
    // Sun 22 Nov has its own 18:00, Thu 26 Nov its 19:30 (the team's when it was made), Thu 3 Dec has
    // no race yet (the team's time, pinned by Store); required, so a cleared field is no "team's time"
    // (user, 23 Nov 2026)
    for (const [date, time] of [['2026-11-22', '18:00'], ['2026-11-26', '19:30'], ['2026-12-03', '19:30']]) {
        const body = await draw(date);
        const m = field(body);
        assert.ok(m, `${date}: the field`);
        assert.equal(m[1], `<input type="time" name="start" value="${time}" required>`, date);
        assert.equal(m[2], undefined, `${date}: no hint under the time`);
        assert.equal(assignFields(body).start, time, date);
        for (const gone of ['Empty: ', 'A time here is', 'keeps this race']) {
            assert.equal(element(body, '<div class="cp-form"').includes(gone), false, `${date}: ${gone}`);
        }
    }
    // a new version takes its plan's race (user, 23 Nov 2026): no date or time field at all
    const sheets = Object.entries(srv.store.get(CID).sheets);
    for (const date of ['2026-11-22', '2026-11-26']) {
        const [vid, v] = sheets.find(([, sh]) => sh.date === date);
        const body = (await assignOf(srv, id, `?team=rollers&as=${v.plan}&drawn=rollers:${v.plan}`)).body;
        assert.equal(field(body), null, vid);
        assert.equal(element(body, '<div class="cp-form"').includes('as-when'), false, vid);
    }
});


test('assign: the prefilled start time follows the date; a time typed for the drawn date stays (user, 22 Nov 2026)', async t => {
    const {srv} = await twoRaces(t);
    const id = pushedEntry(srv);
    const start = async q => assignFields((await assignOf(srv, id, `?team=rollers&as=new&drawn=rollers:new&${q}`)).body).start;
    // the page was drawn for Sun (18:00 prefilled, sent back with the date): the date changed to Thu
    // redraws with Thu's, to a date without a race with the team's; and back
    assert.equal(await start('date=2026-11-26&startFor=2026-11-22&start=18:00&startWas=18:00'), '19:30');
    assert.equal(await start('date=2026-12-03&startFor=2026-11-22&start=18:00&startWas=18:00'), '19:30');
    assert.equal(await start('date=2026-11-22&startFor=2026-11-26&start=19:30&startWas=19:30'), '18:00');
    // a time typed over the prefill of the same date is kept
    assert.equal(await start('date=2026-11-22&startFor=2026-11-22&start=17:45&startWas=18:00'), '17:45');
    assert.equal(await start('date=2026-11-26&startFor=2026-11-26&start=20:00&startWas=19:30'), '20:00');
});


test('Store: the prefilled time is stored as the race\'s own and moves nothing; the race\'s own time stays (user, 22 and 23 Nov 2026)', async t => {
    const {c, srv} = await twoRaces(t);
    const drawn = async (id, d, type) => assignFields((await assignOf(srv, id, `?team=rollers&as=new&drawn=rollers:new&date=${d}&startFor=${d}&type=${type}`)).body);
    // Thu 26 Nov was made at the team's 19:30: the form carries it and Store keeps it
    const thuId = pushedEntry(srv);
    const thu = await drawn(thuId, '2026-11-26', 'tempo');
    assert.equal(thu.start, '19:30');
    const lines = whatHappens((await assignOf(srv, thuId, `?${new URLSearchParams(thu)}`)).body);
    assert.equal(lines.some(l => l.includes('now starts at')), false, JSON.stringify(lines));
    const a = await storePost(srv, c.cookie, thuId, thu);
    assert.equal(a.status, 303, a.body);
    assert.equal(textOf(a.body).includes('now starts at'), false);
    assert.equal(srv.store.get(CID).teams.rollers.races['2026-11-26'].start, '19:30');
    assert.equal(srv.store.get(CID).teams.rollers.races['2026-11-22'].start, '18:00');
    // Sun 22 Nov has its own 18:00: the form carries it, Store keeps it, nothing moves
    const sunId = pushedEntry(srv);
    const sun = await drawn(sunId, '2026-11-22', 'easy');
    assert.equal(sun.start, '18:00');
    const b = await storePost(srv, c.cookie, sunId, sun);
    assert.equal(b.status, 303, b.body);
    assert.equal(textOf(b.body).includes('now starts at'), false);
    assert.equal(srv.store.get(CID).teams.rollers.races['2026-11-22'].start, '18:00');
    // another time is the race's own, as before: Thu 26 Nov at 20:00
    const otherId = pushedEntry(srv);
    const c2 = await storePost(srv, c.cookie, otherId, {...await drawn(otherId, '2026-11-26', 'hard'), start: '20:00'});
    assert.equal(c2.status, 303, JSON.stringify(flashOf(c2.body)));
    assert.equal(srv.store.get(CID).teams.rollers.races['2026-11-26'].start, '20:00');
});


test('assign: a weekly team\'s time and link in the form, and the form says what Store changes on the race', async t => {
    const {c, srv, sun} = await twoRaces(t);
    const id = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers tempo', ROLLERS.slice(0, 6))});
    const q = '?team=rollers&as=new&drawn=rollers:new&date=2026-11-22&startFor=2026-11-22&start=17:00'
        + '&event=https%3A%2F%2Fwww.zwift.com%2Fevents%2Fview%2F5123456&type=tempo';
    const {body} = await assignOf(srv, id, q);
    // in the form, not folded (the team cockpit): the date, the start time with its hint, the event link
    const more = element(body, '<div class="cp-form"') ?? '';
    assert.ok(more.includes('<input type="date" name="date" value="2026-11-22">'), more);
    // the race has a time of its own (the typed one wins in the field); no hint under the time
    assert.ok(more.includes('<label class="field">Start time<input type="time" name="start" value="17:00" required></label>'), more);
    assert.ok(more.includes('name="event"'), more);
    // the race radios name the race; no line repeats the race or the link typed (team cockpit spec
    // §5.3b: the date and the link are in their fields)
    assert.deepEqual(checkedOf(body, 'race'), ['2026-11-22']);
    assert.ok(more.includes('name="event" maxlength="300" inputmode="url" autocomplete="off" value="https://www.zwift.com/events/view/5123456">'), more);
    assert.ok(!body.includes('class="as-row"'), 'no race line naming the race again');
    // the rhythm date has no time of its own: the field shows the team's (user, 22 Nov 2026), no hint
    const rhythm = (await assignOf(srv, id, '?team=rollers&as=new&drawn=rollers:new&date=2026-11-26&startFor=2026-11-26&type=tempo')).body;
    assert.ok(rhythm.includes('<label class="field">Start time<input type="time" name="start" value="19:30" required></label>'), rhythm);
    const lines = whatHappens(body);
    assert.ok(lines.includes('Race on Sun 22 Nov now starts at 17:00 (was 18:00). \'Rollers\' moves with it.'), JSON.stringify(lines));
    const link = lines.find(l => l.startsWith('Race on Sun 22 Nov now has event link 5123456.')) ?? '';
    assert.ok(link.startsWith('Race on Sun 22 Nov now has event link 5123456. \'Rollers\' moves with it.'), JSON.stringify(lines));
    // What happens follows Make live (user, 23 Nov 2026): the new plan becomes the race's live plan,
    // so no line about the plan live there now (the Store result says it, below)
    assert.equal(link, 'Race on Sun 22 Nov now has event link 5123456. \'Rollers\' moves with it.', JSON.stringify(lines));
    // a field drawn without a typed time: the race's own
    assert.ok((await assignOf(srv, id, '?team=rollers&as=new&drawn=rollers:new&date=2026-11-22&startFor=2026-11-22')).body
        .includes('<input type="time" name="start" value="18:00" required>'));
    // Store: the race starts then and has the link; the live plan stays
    const res = await storePost(srv, c.cookie, id, {team: 'rollers', as: 'new', drawn: 'rollers:new', base: VERSION_OF(srv, 'rollers'),
        date: '2026-11-22', startFor: '2026-11-22', start: '17:00', event: 'https://www.zwift.com/events/view/5123456', type: 'tempo'});
    assert.equal(res.status, 303, res.body);
    const r = srv.store.get(CID).teams.rollers.races['2026-11-22'];
    assert.deepEqual([r.start, r.pinnedEventId, r.live], ['17:00', 5123456, sun]);
    // the link is the race's: its live plan follows it, so riders already in another event get nothing
    assert.ok(storeFlash(res.body).all.includes('Riders in another event then get nothing from \'Rollers\', the race\'s live plan.'), storeFlash(res.body).all);
    // an emptied field keeps the race's own time (review I2)
    const blank = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers easy', ROLLERS.slice(0, 5))});
    const kept = await storePost(srv, c.cookie, blank, {team: 'rollers', as: 'new', drawn: 'rollers:new', base: VERSION_OF(srv, 'rollers'),
        date: '2026-11-22', startFor: '2026-11-22', start: '', type: 'easy'});
    assert.equal(kept.status, 303, kept.body);
    assert.equal(srv.store.get(CID).teams.rollers.races['2026-11-22'].start, '17:00');
});


test('assign: one race ahead: no race line; the date, the time and the link in their fields, the race\'s link under the link\'s (spec §5.3b)', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {riders: ROLLERS, at: T('2026-11-18T10:00:00Z'), date: '2026-11-26', pinned: 4567890});
    const srv = await serve(t, c, {now: FRI});
    const id = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers tempo', ROLLERS.slice(0, 6))});
    const form = async q2 => element((await assignOf(srv, id, q2)).body, '<div class="cp-form"');
    const q = '?team=rollers&as=new&drawn=rollers:new&date=2026-11-26&startFor=2026-11-26&type=tempo';
    const plain = await form(q);
    // (the race line "Race Thu 26 Nov 19:30 · event link 4567890" went, review M7's facts stay in the fields)
    assert.equal(/class="as-row"|Race Thu 26 Nov/.test(plain), false, plain);
    assert.ok(plain.includes('<input type="date" name="date" value="2026-11-26">'), plain);
    assert.ok(plain.includes('<label class="field">Start time<input type="time" name="start" value="19:30" required></label>'), plain);
    assert.ok(plain.includes('<span class="hint">This race&#39;s event link now: 4567890</span>'), plain);
    // a time and a link typed: in their fields; the race's link still says what the race has now
    const typed = await form(`${q}&start=20:00&event=https%3A%2F%2Fwww.zwift.com%2Fevents%2Fview%2F5123456`);
    assert.ok(typed.includes('<input type="time" name="start" value="20:00" required>'), typed);
    assert.ok(typed.includes('value="https://www.zwift.com/events/view/5123456">'), typed);
    assert.ok(typed.includes('<span class="hint">This race&#39;s event link now: 4567890</span>'), typed);
    // an emptied date and Store: the date is asked for, not a redraw for another race (review M3)
    const res = await storePost(srv, c.cookie, id, {team: 'rollers', as: 'new', drawn: 'rollers:new', base: VERSION_OF(srv, 'rollers'),
        date: '', startFor: '2026-11-26', type: 'tempo'});
    assert.equal(res.status, 400, res.body);
    assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'Enter the race date as YYYY-MM-DD.'});
    // with a race choice the checked radio wins over the emptied field
    const two = await twoRaces(t);
    const pid = pushedEntry(two.srv);
    const radio = await storePost(two.srv, two.c.cookie, pid, {team: 'rollers', as: 'new', drawn: 'rollers:new', base: VERSION_OF(two.srv, 'rollers'),
        date: '', race: '2026-11-22', startFor: '2026-11-22', type: 'tempo'});
    assert.equal(radio.status, 303, radio.body);
    assert.ok(sheetsOf(two.srv, 'rollers').some(([, sh]) => sh.type === 'tempo' && sh.date === '2026-11-22'));
});


test('assign: a race choice whose date matches no radio: the date in its field, no radio checked, no race line (spec §5.3b)', async t => {
    const {c, srv} = await twoRaces(t);
    const id = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers tempo', ROLLERS.slice(0, 6))});
    // Thu 3 Dec, typed in the date field: no radio names it, the field does, the time hint the team's
    const q = '?team=rollers&as=new&drawn=rollers:new&date=2026-12-03&startFor=2026-12-03&type=tempo';
    let {body} = await assignOf(srv, id, q);
    assert.ok(body.includes('name="race"'), 'still a race choice');
    assert.deepEqual(checkedOf(body, 'race'), []);
    const form = element(body, '<div class="cp-form"');
    assert.ok(form.includes('<input type="date" name="date" value="2026-12-03">'), form);
    assert.ok(form.includes('<input type="time" name="start" value="19:30" required>') && !form.includes('Empty:'), form);
    assert.equal(/class="as-row"|Race Thu 3 Dec/.test(form), false, form);
    // a checked radio: the same, the date in its field
    ({body} = await assignOf(srv, id, '?team=rollers&as=new&drawn=rollers:new&date=2026-11-22&startFor=2026-11-22&type=tempo'));
    assert.deepEqual(checkedOf(body, 'race'), ['2026-11-22']);
    assert.ok(element(body, '<div class="cp-form"').includes('<input type="date" name="date" value="2026-11-22">'));
    assert.equal(body.includes('class="as-row"'), false);
});



test('upload page: a plan of a race that is over is no "new version of" (M9)', async t => {
    // Thursday 19 Nov 19:30 Berlin (18:30Z); at 21:00Z the race is over, though riders still get it
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c, {now: T('2026-11-19T21:00:00Z')});
    const page = await (await srv.get(`/manage/upload?team=rollers&plan=${live}`)).text();
    assert.ok(!page.includes('as a new version'), page);
    assert.ok(formOf(page).includes('<input type="hidden" name="forPlan" value="">'), page);
    const {uploadHref} = await import('../upload-page.mjs');
    assert.equal(uploadHref(srv.store.get(CID), 'rollers', DATE, T('2026-11-19T21:00:00Z')), '/manage/upload?team=rollers&date=2026-11-19');
    // before it is over: the plan
    assert.equal(uploadHref(srv.store.get(CID), 'rollers', DATE, T('2026-11-19T20:30:00Z')), `/manage/upload?team=rollers&plan=${live}&date=2026-11-19`);
});


test('assign: a new plan for a race with an event link shows it; a version takes its race\'s link as it is (user, 23 Nov 2026)', async t => {
    const {c, srv, sun} = await twoRaces(t);
    srv.store.change(CID, cl => {
        race(cl, 'rollers', '2026-11-22').pinnedEventId = 4567890;
    });
    const id = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers tempo', ROLLERS.slice(0, 6))});
    const {body} = await assignOf(srv, id, '?team=rollers&as=new&drawn=rollers:new&date=2026-11-22&startFor=2026-11-22');
    // (a race choice: the radios name the race, the hint under the link field its link)
    assert.ok(body.includes('<span class="hint">This race&#39;s event link now: 4567890</span>'), body);
    // the live plan's own file again, a link sent along (a page from before): a version has no link
    // field and changes no link, so nothing happens at all
    const same = srv.store.get(CID).sheets[sun];
    const again = await intake(srv, c.cookie, {team: 'rollers', json: same.json});
    const page = await assignOf(srv, again, `?team=rollers&as=${sun}&drawn=rollers:${sun}&startFor=2026-11-22&event=https%3A%2F%2Fwww.zwift.com%2Fevents%2Fview%2F5123456`);
    const lines = whatHappens(page.body);
    assert.deepEqual(lines, ['No pull watts in this plan: export it from ZwiftGopher with pull power.'], JSON.stringify(lines));
    assert.ok(!lines.some(l => l.includes('event link')), JSON.stringify(lines));
    assert.ok(!element(page.body, '<div class="cp-form"').includes('name="event"'));
});


test('upload page: the JSON only; a file for a race carries its date to the assign page', async t => {
    const {c, srv} = await twoRaces(t);
    const plain = await uploadPageOf(srv, c.cookie, 'rollers');
    assert.ok(!plain.includes('name="text"'), plain);
    assert.ok(!plain.includes('name="forDate"'), plain);
    assert.ok(!textOf(plain).includes('Text export'), textOf(plain));
    const res = await srv.get('/manage/upload?team=rollers&date=2026-11-26');
    const page = await res.text();
    assert.equal(res.status, 200, page);
    assert.ok(formOf(page).includes('<input type="hidden" name="forDate" value="2026-11-26">'), page);
    assert.ok(page.includes('action="/manage/upload?team=rollers&amp;date=2026-11-26" enctype'), page);
    // a date that is none is dropped
    const bad = await (await srv.get('/manage/upload?team=rollers&date=2026-02-30')).text();
    assert.ok(!bad.includes('name="forDate"') && bad.includes('action="/manage/upload?team=rollers" enctype'), bad);
    // Continue: the entry keeps the date, and the assign page is drawn for that race
    const up = await postUpload(srv, c.cookie, {team: 'rollers', forDate: '2026-11-26', json: planJson('Other', ROLLERS.slice(0, 4))},
        {path: '/manage/upload?team=rollers&date=2026-11-26'});
    assert.equal(up.status, 303, await up.text());
    const entry = inboxOf(srv).at(-1);
    assert.equal(entry.forDate, '2026-11-26');
    // (a new plan: its race fold has the race radios; a version takes its plan's race)
    const assign = (await assignOf(srv, entry.id, '?team=rollers&as=new&drawn=rollers:new')).body;
    assert.deepEqual(checkedOf(assign, 'race'), ['2026-11-26']);
    assert.ok(assign.includes('<input type="hidden" name="startFor" value="2026-11-26">'), assign);
    // a refusal keeps the date in the form and its action
    const refused = await postUpload(srv, c.cookie, {team: 'rollers', forDate: '2026-11-26', json: {team: {name: 'Rollers'}}},
        {path: '/manage/upload?team=rollers&date=2026-11-26'});
    const again = await refused.text();
    assert.equal(refused.status, 400, again);
    assert.ok(formOf(again).includes('<input type="hidden" name="forDate" value="2026-11-26">'), again);
    // a forDate that is no date is not kept
    await postUpload(srv, c.cookie, {team: 'rollers', forDate: 'soon', json: planJson('Other', ROLLERS.slice(0, 3))});
    assert.equal(Object.hasOwn(inboxOf(srv).at(-1), 'forDate'), false);
});


test('upload: nothing chosen and a text export alone are refused with words; a text part beside the JSON is ignored', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    const refused = async (fields, text) => {
        const file = storedClub(srv);
        const res = await postUpload(srv, c.cookie, {team: 'rollers', ...fields});
        const body = await res.text();
        assert.equal(res.status, 400, body);
        assert.deepEqual(flashOf(body), {kind: 'err', text}, JSON.stringify(fields));
        assert.equal(storedClub(srv), file);
        assert.equal(inboxOf(srv).length, 0);
    };
    await refused({}, 'Choose the planner\'s JSON export, or paste it.');
    // a text part alone is nothing chosen: the page has no field for it any more
    await refused({text: textExport(ROLLERS)}, 'Choose the planner\'s JSON export, or paste it.');
    // a text export as the file or pasted
    await refused({json: textExport(ROLLERS)}, 'This is not a planner JSON export.');
    await refused({paste: textExport(ROLLERS)}, 'This is not a planner JSON export.');
    await refused({json: '[1, 2]'}, 'This is not a planner JSON export.');
    // beside the JSON (a page from before): ignored, the entry has no text
    const res = await postUpload(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS), text: textExport(ROLLERS, ['Zed\t250\t30\tBlue\t#0000ff'])});
    assert.equal(res.status, 303, await res.text());
    const entry = inboxOf(srv).at(-1);
    assert.deepEqual([entry.text, entry.warnings], [null, []]);
    const page = (await assignOf(srv, entry.id)).body;
    assert.ok(!textOf(page).includes('text export'), textOf(page));
});


// ---- the other club actions (Task 7) ----


test('make live on an outdated sheet asks first', async t => {
    const c = makeClub();
    const fast = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ['1001', '1002', '1003'], at: T('2026-11-19T14:10:00Z'), live: false});
    upload(c.club, 'sprockets', {riders: ['1001', '1009'], at: T('2026-11-19T16:30:00Z')});
    const srv = await serve(t, c);
    const uploadedAt = srv.store.get(CID).sheets[slow].uploadedAt;
    // the question itself: captain.test.mjs 'live confirm page'
    assert.equal((await post(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: slow})).status, 200);
    assert.equal(liveId(srv.store.get(CID), 'rollers'), fast, 'nothing changed yet');

    const yes = await followPost(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: slow, confirm: '1'});
    const club = srv.store.get(CID);
    assert.equal(liveId(club, 'rollers'), slow);
    assert.equal(club.sheets[slow].uploadedAt, uploadedAt);
    // Ben still rides Sprockets (the newer upload): a hole on Rollers' new live sheet
    assert.deepEqual(yes.flash, {kind: 'ok', text: '\'Rollers · slow\' v1 is live for Rollers. Still to do: Rollers'});
    assert.equal(yes.location, `/manage/team/rollers?r=${DATE}#panel`);
    assert.ok(yes.page.includes(`<meta http-equiv="refresh" content="30;url=/manage/team/rollers?r=${DATE}">`), 'the team page');
    // the live sheet is not outdated: no question
    const again = await followPost(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: slow});
    assert.ok(again.flash?.kind === 'ok', again.page);
    // a sheet of another team, or none
    for (const fields of [{team: 'sprockets', sheet: slow}, {team: 'rollers', sheet: 'zzzzzz'}, {team: '__proto__', sheet: slow}, {}]) {
        const res = await post(srv, c.cookie, '/manage/live', fields);
        assert.equal(res.status, 400, JSON.stringify(fields));
        assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'This team or plan no longer exists. Nothing was changed.'});
    }
});


test('make live: the flash, the confirm page and its question name the plan and the version', async t => {
    // team cockpit spec §5.6: "v2" alone is ambiguous with two plans
    const c = makeClub();
    const fast = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS.slice(1), at: T('2026-11-19T14:00:00Z')});
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ['1002', '1003'], at: T('2026-11-19T14:10:00Z'), live: false});
    const v2 = uploadSheet(c.club, {
        slug: 'rollers', json: planJson('Rollers fast', ROLLERS), text: null, base: c.club.teams.rollers.version, via: 'file',
        as: fast, live: false, pinnedEventId: null,
    }, {now: T('2026-11-19T15:00:00Z'), newId: () => randomId(6)}).id;
    upload(c.club, 'sprockets', {riders: ['1001', '1009'], at: T('2026-11-19T16:30:00Z')});
    const srv = await serve(t, c);
    const ask = await post(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: v2});
    assert.equal(ask.status, 200, ask.body);
    assert.equal(textOf(/<h1>([\s\S]*?)<\/h1>/.exec(ask.body)[1]), 'Make \'Rollers · fast\' v2 live?');
    assert.ok(textOf(ask.body).includes('\'Rollers · fast\' v2 still lists Ben, who now rides another team. Make it live anyway?'), textOf(ask.body));
    assert.equal(liveId(srv.store.get(CID), 'rollers'), fast, 'nothing changed yet');
    const res = await followPost(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: slow, confirm: '1'});
    assert.equal(liveId(srv.store.get(CID), 'rollers'), slow);
    assert.deepEqual(res.flash, {kind: 'ok', text: '\'Rollers · slow\' v1 is live for Rollers.'});
});


test('make live: the flash shows the moves and the holes', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    upload(c.club, 'sprockets', {riders: ['1009'], at: T('2026-11-19T14:05:00Z')});
    const plus = upload(c.club, 'sprockets', {type: 'plus Ben', riders: ['1009', '1001'], at: T('2026-11-19T16:30:00Z'), live: false});
    const srv = await serve(t, c);
    const res = await followPost(srv, c.cookie, '/manage/live', {team: 'sprockets', sheet: plus, confirm: '1'});
    assert.deepEqual(res.flash, {kind: 'ok', text: '\'Sprockets · plus Ben\' v1 is live for Sprockets. Ben moves from Rollers to Sprockets. Still to do: Rollers'});
});


test('delete and unpin', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z'), pinned: 4567890});
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ['1001', '1002'], at: T('2026-11-19T14:10:00Z'), live: false});
    const sp = upload(c.club, 'sprockets', {riders: ['1009'], at: T('2026-11-19T16:30:00Z')});
    const srv = await serve(t, c);
    const unpin = await followPost(srv, c.cookie, '/manage/sheet/unpin', {team: 'rollers', sheet: live});
    assert.deepEqual(unpin.flash, {kind: 'ok', text: 'Removed the event link of \'Rollers · fast\'.'});
    assert.equal(race(srv.store.get(CID), 'rollers', DATE).pinnedEventId, null);
    assert.equal(unpin.location, '/manage/team/rollers');
    assert.ok(unpin.page.includes('<h1>Rollers</h1>'));
    assert.ok(!textOf(unpin.page).includes('Event link 4567890'), 'the team page shows no link');
    const del = await followPost(srv, c.cookie, '/manage/sheet/delete', {team: 'rollers', sheet: slow, confirm: '1'});
    assert.deepEqual(del.flash, {kind: 'ok', text: 'Deleted \'Rollers · slow\' with its versions.'});
    assert.ok(!Object.hasOwn(srv.store.get(CID).sheets, slow));
    // another team's sheet, a deleted one: refused, nothing changed
    const file = storedClub(srv);
    for (const [p, fields] of [['/manage/sheet/delete', {team: 'rollers', sheet: sp, confirm: '1'}], ['/manage/sheet/delete', {team: 'rollers', sheet: slow, confirm: '1'}],
        ['/manage/sheet/unpin', {team: 'rollers', sheet: sp}], ['/manage/sheet/unpin', {team: 'gone', sheet: live}]]) {
        const res = await post(srv, c.cookie, p, fields);
        assert.equal(res.status, 400, p);
        assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'This team or plan no longer exists. Nothing was changed.'});
    }
    assert.equal(storedClub(srv), file);
});


test('club rename checks the name key', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    srv.store.create(secondClub().club);
    const file = storedClub(srv);
    let res = await post(srv, c.cookie, '/manage/club', {name: 'Spokesmen C.C.', tz: 'Europe/Berlin'});
    assert.equal(res.status, 409, res.body);
    assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'This name is taken. Choose another.'});
    res = await post(srv, c.cookie, '/manage/club', {name: 'x', tz: 'Europe/Berlin'});
    assert.equal(res.status, 400);
    assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'Use 2 to 60 characters, in Latin letters or digits.'});
    // a zone not in the list: refused before the store sees it
    for (const tz of ['Mars/Olympus', '', 'Europe/../etc']) {
        res = await post(srv, c.cookie, '/manage/club', {name: 'Kettenfett RC', tz});
        assert.equal(res.status, 400, tz);
        assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'Choose a time zone from the list.'});
    }
    assert.equal(storedClub(srv), file);
    // its own name in other letters, and a free one
    await followPost(srv, c.cookie, '/manage/club', {name: 'KETTENFETT R.C.', tz: 'Europe/Berlin'});
    const saved = await followPost(srv, c.cookie, '/manage/club', {name: 'Kettenfett Racing', tz: 'UTC'});
    assert.deepEqual(saved.flash, {kind: 'ok', text: 'Saved.'});
    assert.equal(saved.location, '/manage/settings');
    assert.ok(saved.page.includes('<h1>Club settings</h1>'));
    assert.ok(saved.page.includes('name="name" value="Kettenfett Racing"'), saved.page);
    assert.match(saved.page, /<option value="UTC" selected>/);
    const club = srv.store.get(CID);
    assert.equal(club.name, 'Kettenfett Racing');
    assert.equal(club.tz, 'UTC');
    const log = club.log.filter(e => e.what === 'club-rename' || e.what === 'club-tz').map(e => [e.what, e.label]);
    assert.deepEqual(log, [['club-rename', 'KETTENFETT R.C.'], ['club-rename', 'Kettenfett Racing'], ['club-tz', 'UTC']]);
    // the old name is free now
    assert.ok(!srv.store.nameTaken('kettenfettrc'));
    // nothing changed: no log entry
    const n = club.log.length;
    assert.deepEqual((await followPost(srv, c.cookie, '/manage/club', {name: 'Kettenfett Racing', tz: 'UTC'})).flash, {kind: 'ok', text: 'Saved.'});
    assert.equal(srv.store.get(CID).log.length, n);
});


test('club settings from a page with the old race day: name and zone saved, the race day ignored', async t => {
    const c = makeClub();
    c.club.teams.sprockets.weekday = 6;
    const srv = await serve(t, c);
    const days = () => Object.fromEntries(Object.entries(srv.store.get(CID).teams).map(([s, team]) => [s, team.weekday]));
    const before = days();
    assert.deepEqual(before, {rollers: 4, sprockets: 6});
    const saved = await followPost(srv, c.cookie, '/manage/club', {name: 'Kettenfett Racing', tz: 'UTC', weekday: '2'});
    assert.deepEqual(saved.flash, {kind: 'ok', text: 'Saved.'});
    const club = srv.store.get(CID);
    assert.deepEqual([club.name, club.tz], ['Kettenfett Racing', 'UTC']);
    assert.equal(Object.hasOwn(club, 'weekday'), false);
    assert.deepEqual(club.log.map(e => e.what).filter(w => w.startsWith('club-')), ['club-rename', 'club-tz']);
    assert.deepEqual(days(), before);
    // a race day alone changes nothing, not even one that is no weekday
    const file = storedClub(srv);
    for (const weekday of ['3', '0', 'Mon']) {
        const res = await followPost(srv, c.cookie, '/manage/club', {name: 'Kettenfett Racing', tz: 'UTC', weekday});
        assert.deepEqual(res.flash, {kind: 'ok', text: 'Saved.'}, weekday);
    }
    assert.equal(storedClub(srv), file);
});


test('club settings: targets in W/kg or watts', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const radios = page => {
        const form = /<form class="stack" method="post" action="\/manage\/club"[^>]*>([\s\S]*?)<\/form>/.exec(page)?.[1] ?? '';
        return [...form.matchAll(/<input type="radio" name="unit" value="(\w+)"( checked)?>/g)].map(m => [m[1], m[2] === ' checked']);
    };
    const settings = async () => (await srv.get('/manage/settings', c.cookie)).text();
    // a club stored without it: W/kg, checked in the club card's form
    let page = await settings();
    assert.deepEqual(radios(page), [['wkg', true], ['watts', false]]);
    assert.ok(textOf(page).includes('Targets in'), textOf(page));
    assert.ok(page.includes('<legend>Targets in</legend>'), page);
    const teams = () => Object.fromEntries(Object.entries(srv.store.get(CID).teams).map(([s, team]) => [s, team.version]));
    const before = teams();
    // watts: stored, logged, checked
    const saved = await followPost(srv, c.cookie, '/manage/club', {name: 'Kettenfett RC', tz: 'Europe/Berlin', unit: 'watts'});
    assert.deepEqual(saved.flash, {kind: 'ok', text: 'Saved.'});
    assert.deepEqual(radios(saved.page), [['wkg', false], ['watts', true]]);
    let club = srv.store.get(CID);
    assert.equal(club.targetUnit, 'watts');
    assert.deepEqual(club.log.filter(e => e.what === 'unit').map(e => e.label), ['watts']);
    assert.ok(textOf(saved.page).includes('Targets in Watts'), textOf(saved.page));
    assert.deepEqual(teams(), before, 'a display setting: no team changes its version');
    // the same again, or a form without the field (a page from before it): nothing changes
    let file = storedClub(srv);
    for (const fields of [{unit: 'watts'}, {}]) {
        const res = await followPost(srv, c.cookie, '/manage/club', {name: 'Kettenfett RC', tz: 'Europe/Berlin', ...fields});
        assert.deepEqual(res.flash, {kind: 'ok', text: 'Saved.'}, JSON.stringify(fields));
    }
    assert.equal(storedClub(srv), file);
    // a bad value is refused, nothing changes (the name typed stays)
    for (const unit of ['w', 'WKG', '', 'kg']) {
        const res = await post(srv, c.cookie, '/manage/club', {name: 'Kettenfett Racing', tz: 'Europe/Berlin', unit});
        assert.equal(res.status, 400, unit);
        assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'Choose W/kg or watts.'}, unit);
        assert.ok(res.body.includes('name="name" value="Kettenfett Racing"'), unit);
    }
    assert.equal(storedClub(srv), file);
    // back to W/kg, with a new name in the same Save
    const back = await followPost(srv, c.cookie, '/manage/club', {name: 'Kettenfett Racing', tz: 'Europe/Berlin', unit: 'wkg'});
    assert.deepEqual(radios(back.page), [['wkg', true], ['watts', false]]);
    club = srv.store.get(CID);
    assert.deepEqual([club.name, club.targetUnit], ['Kettenfett Racing', 'wkg']);
    assert.deepEqual(club.log.filter(e => e.what === 'unit' || e.what === 'club-rename').map(e => [e.what, e.label]),
        [['unit', 'watts'], ['club-rename', 'Kettenfett Racing'], ['unit', 'wkg']]);
    assert.ok(textOf(back.page).includes('Targets in W/kg'), textOf(back.page));
    // another zone while a race is near asks first: the question keeps the unit posted
    file = storedClub(srv);
    const ask = await post(srv, c.cookie, '/manage/club', {name: 'Kettenfett Racing', tz: 'UTC', unit: 'watts'});
    assert.equal(ask.status, 200);
    assert.ok(ask.body.includes('<input type="hidden" name="unit" value="watts">'), ask.body);
    assert.equal(storedClub(srv), file);
});


test('remove a rider', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    upload(c.club, 'sprockets', {riders: ['1009'], bench: ['1001'], at: T('2026-11-19T16:30:00Z')});
    const srv = await serve(t, c);
    srv.see('1001', '2026-11-19T18:00:00Z', {sig: c.club.sheets[live].sig, mod: '0.3.0', sheet: live, inEvent: false, event: null});
    srv.see('1002', '2026-11-19T18:00:00Z', {sig: c.club.sheets[live].sig, mod: '0.3.0', sheet: live, inEvent: false, event: null});
    assert.ok(Object.hasOwn(srv.store.seenOf(CID), '1001'));
    const res = await followPost(srv, c.cookie, '/manage/rider/remove', {zwiftId: ' 1001 ', confirm: '1'});
    assert.deepEqual(res.flash, {kind: 'ok', text: 'Removed from 2 plans.'});
    const club = srv.store.get(CID);
    for (const s of Object.values(club.sheets)) {
        assert.ok(!Object.hasOwn(s.json.riders, '1001') && !Object.hasOwn(s.json.roster ?? {}, '1001'), s.label);
    }
    assert.ok(!Object.hasOwn(srv.store.seenOf(CID), '1001'));
    assert.ok(Object.hasOwn(srv.store.seenOf(CID), '1002'), 'the others stay');
    assert.equal(res.location, '/manage/settings');
    const rollers = await srv.get('/manage/team/rollers');
    assert.equal(rollers.status, 200);
    const riders = await rollers.text();
    assert.ok(textOf(riders).includes('Cleo'));
    assert.ok(!textOf(riders).includes('Ben'));
    const one = await followPost(srv, c.cookie, '/manage/rider/remove', {zwiftId: '1009', confirm: '1'});
    assert.deepEqual(one.flash, {kind: 'ok', text: 'Removed from 1 plan.'});
    // again: removed in full already, nothing of his since (coordinator ruling, 19 Nov 2026: no
    // "0 plans", no second line, mail or pass)
    const none = await followPost(srv, c.cookie, '/manage/rider/remove', {zwiftId: '1001', confirm: '1'});
    assert.deepEqual(none.flash, {kind: 'ok', text: 'This rider was removed already, and nothing of theirs was stored since.'});
    const file = storedClub(srv);
    for (const zwiftId of ['abc', '', '1234567890123', '-1']) {
        const bad = await post(srv, c.cookie, '/manage/rider/remove', {zwiftId, confirm: '1'});
        assert.equal(bad.status, 400, zwiftId);
        assert.deepEqual(flashOf(bad.body), {kind: 'err', text: 'Enter a Zwift ID: digits only.'});
    }
    assert.equal(storedClub(srv), file);
});


test('recordings: own club only', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const name = `${T('2026-11-12T18:31:00Z')}-1002.jsonl.gz`;
    const bytes = Buffer.from(Array.from({length: 5000}, (_, i) => i % 251));
    const own = path.join(srv.dataDir, 'logs', CID, 'rollers');
    const theirs = path.join(srv.dataDir, 'logs', 'p2m8c4t1v9', 'spokes');
    srv.server.logs.put(CID, 'rollers', name, bytes);
    srv.server.logs.put('p2m8c4t1v9', 'spokes', name, bytes);

    // the list and the quota line, on the club settings
    const got = await srv.get('/manage/settings');
    assert.equal(got.status, 200);
    const page = await got.text();
    assert.ok(textOf(page).includes('Recordings 0.0 MB of 300 MB'), textOf(page));
    assert.ok(!page.includes('href="/manage/logs/'), 'no download link');
    assert.ok(!textOf(page).includes('Download'));
    assert.ok(page.includes('<form method="post" action="/manage/logs/delete" data-arm>'));

    // no download for captains (17 Nov 2026): every GET under /manage/logs/ is an unknown path, 404,
    // with a valid club session, for this club's file and for anything else
    for (const p of [`rollers/${name}`, `%72ollers/${name.replace('.', '%2E')}`, `spokes/${name}`, `..%2Fp2m8c4t1v9%2Fspokes/${name}`,
        `rollers/..%2F..%2Fp2m8c4t1v9%2Fspokes%2F${name}`, `rollers/..%2F..%2F..%2Fcircles%2F${CID}.json`, `rollers/${name}x`, 'rollers/%E0%A4%A',
        `rollers/${T('2026-11-12T18:31:00Z')}-1003.jsonl.gz`]) {
        const r = await srv.get(`/manage/logs/${p}`);
        assert.equal(r.status, 404, p);
        // the captain frame's not-found page (UI panel, 19 Nov 2026), never the file
        const body = await r.text();
        assert.match(r.headers.get('content-type'), /^text\/html/, p);
        assert.ok(body.includes('<h1 id="gone-h">This page does not exist.</h1>'), p);
        assert.ok(!body.includes(name) && !body.includes('jsonl'), p);
    }
    const head = await fetch(srv.base + `/manage/logs/rollers/${name}`, {method: 'HEAD', headers: {cookie: c.cookie}});
    assert.equal(head.status, 404);
    // the file is still there, and the gate still comes first
    assert.ok(fs.existsSync(path.join(own, name)));
    const anon = await srv.get(`/manage/logs/rollers/${name}`, null);
    assert.equal(anon.status, 303);
    const put = await post(srv, c.cookie, `/manage/logs/rollers/${name}`);
    assert.equal(put.status, 404);

    // delete: only this club's file
    const otherDel = await post(srv, c.cookie, '/manage/logs/delete', {slug: 'spokes', file: name});
    assert.equal(otherDel.status, 400);
    assert.deepEqual(flashOf(otherDel.body), {kind: 'err', text: 'This recording no longer exists.'});
    assert.ok(fs.existsSync(path.join(theirs, name)));
    for (const fields of [{slug: '..', file: name}, {slug: 'rollers', file: `../${name}`}, {}]) {
        const bad = await post(srv, c.cookie, '/manage/logs/delete', fields);
        assert.equal(bad.status, 400, JSON.stringify(fields));
    }
    // without confirm=1 (review I1, UI panel wave 2): the question, naming the rider and the session;
    // the file stays
    const asked = await post(srv, c.cookie, '/manage/logs/delete', {slug: 'rollers', file: name});
    assert.equal(asked.status, 200, asked.body);
    assert.ok(asked.body.includes('<h1>Delete this recording?</h1>'), asked.body);
    assert.ok(textOf(asked.body).includes('Deletes the recording of Cleo from Thu 12 Nov 19:31 for good. This cannot be undone.'), textOf(asked.body));
    assert.ok(asked.body.includes(`<input type="hidden" name="slug" value="rollers"><input type="hidden" name="file" value="${name}"><input type="hidden" name="confirm" value="1"><button class="btn danger" type="submit">Delete recording</button>`), asked.body);
    assert.ok(fs.existsSync(path.join(own, name)));
    const del = await followPost(srv, c.cookie, '/manage/logs/delete', {slug: 'rollers', file: name, confirm: '1'});
    assert.deepEqual(del.flash, {kind: 'ok', text: 'Recording deleted.'});
    assert.ok(!fs.existsSync(path.join(own, name)));
    assert.ok(textOf(del.page).includes('No recordings yet.'));
    assert.ok(fs.existsSync(path.join(theirs, name)));
});


test('recordings: the sweep\'s error line names the club and the error kind, never the file', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const old = T('2026-08-01T18:31:00Z');
    const name = `${old}-1002.jsonl.gz`;
    const dir = path.join(srv.dataDir, 'logs', CID, 'rollers');
    srv.server.logs.put(CID, 'rollers', name, Buffer.from('x'));
    const fsError = op => Object.assign(new Error(`EACCES: permission denied, ${op} '${path.join(dir, name)}'`), {code: 'EACCES'});
    const lines = [];
    const error = console.error;
    console.error = (...a) => lines.push(a.join(' '));
    const rmSync = fs.rmSync;
    try {
        // the retention sweep cannot delete it
        fs.rmSync = () => {
            throw fsError('unlink');
        };
        assert.equal(srv.server.logs.sweep(NOW, 90), 0);
    } finally {
        fs.rmSync = rmSync;
        console.error = error;
    }
    assert.deepEqual(lines, [
        `paceline-server: log sweep of club ${CID}: a recording not deleted: EACCES`,
    ]);
});


test('every action needs same origin and a principal', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z'), pinned: 4567890});
    const srv = await serve(t, c, {env: {CODE_SECRET}});
    const name = `${T('2026-11-12T18:31:00Z')}-1002.jsonl.gz`;
    srv.server.logs.put(CID, 'rollers', name, Buffer.alloc(100));
    const version = c.club.teams.rollers.version;
    const routes = [
        ['/manage/live', {team: 'rollers', sheet: live, confirm: '1'}],
        ['/manage/undo', {team: 'rollers', version}],
        ['/manage/live/undo', {team: 'rollers', version, confirm: '1'}],
        ['/manage/plan/back', {team: 'rollers', plan: live, n: '1', version}],
        ['/manage/sheet/delete', {team: 'rollers', sheet: live, confirm: '1'}],
        ['/manage/sheet/unpin', {team: 'rollers', sheet: live}],
        ['/manage/team', {action: 'add', name: 'Cranks', start: ''}],
        ['/manage/team', {action: 'rename', team: 'rollers', name: 'Rollers Elite'}],
        ['/manage/team', {action: 'rhythm', team: 'rollers', kind: 'weekly', weekday: '2', start: '20:00'}],
        ['/manage/team', {action: 'start', team: 'rollers', start: ''}],
        ['/manage/team', {action: 'kind', team: 'rollers', kind: 'special', weekday: ''}],
        ['/manage/team', {action: 'delete', team: 'rollers', confirm: '1'}],
        ['/manage/club', {name: 'Kettenfett Racing', tz: 'UTC'}],
        ['/manage/rider/remove', {zwiftId: '1001', confirm: '1'}],
        ['/manage/logs/delete', {slug: 'rollers', file: name}],
        ['/manage/code', {action: 'on'}],
        ['/manage/code', {action: 'off'}],
        ['/manage/upload/preview', {}],
    ];
    const file = storedClub(srv);
    for (const [p, fields] of routes) {
        const cross = await post(srv, c.cookie, p, fields, {headers: {'sec-fetch-site': 'cross-site'}});
        assert.equal(cross.status, 403, `${p} cross-site`);
        const foreign = await post(srv, c.cookie, p, fields, {headers: {origin: 'https://evil.example.org'}});
        assert.equal(foreign.status, 403, `${p} other origin`);
        const anon = await post(srv, null, p, fields);
        assert.equal(anon.status, 403, `${p} without a cookie`);
        assert.ok(anon.body.includes('Your club link no longer works in this browser.'));
        const dead = await post(srv, '__Host-pl_club=AAAAAAAAAAAAAAAAAAAAAA', p, fields);
        assert.equal(dead.status, 403, `${p} dead cookie`);
        // no GET changes state
        const get = await srv.get(`${p}?${new URLSearchParams(fields)}`);
        assert.equal(get.status, 405, `${p} GET`);
        await get.text();
    }
    assert.equal(storedClub(srv), file);
    // Store and Discard of an entry: the same gate; the entry stays as it is
    const id = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS.slice(1))});
    const entry = JSON.stringify(inboxOf(srv));
    const withEntry = storedClub(srv);
    const store = {team: 'rollers', as: live, live: 'on', base: String(VERSION_OF(srv, 'rollers')), drawn: `rollers:${live}`};
    for (const [p, fields] of [[`/manage/inbox/${id}`, store], [`/manage/inbox/${id}/discard`, {back: '/manage/team/rollers', confirm: '1'}]]) {
        const cross = await post(srv, c.cookie, p, fields, {headers: {'sec-fetch-site': 'cross-site'}});
        assert.equal(cross.status, 403, `${p} cross-site`);
        const foreign = await post(srv, c.cookie, p, fields, {headers: {origin: 'https://evil.example.org'}});
        assert.equal(foreign.status, 403, `${p} other origin`);
        const anon = await post(srv, null, p, fields);
        assert.equal(anon.status, 403, `${p} without a cookie`);
        assert.ok(anon.body.includes('Your club link no longer works in this browser.'));
        const dead = await post(srv, '__Host-pl_club=AAAAAAAAAAAAAAAAAAAAAA', p, fields);
        assert.equal(dead.status, 403, `${p} dead cookie`);
    }
    // a GET of the Store path goes to the team page with the entry picked, and changes nothing; Discard
    // is POST only
    const got = await srv.get(`/manage/inbox/${id}?${new URLSearchParams(store)}`);
    assert.deepEqual([got.status, got.headers.get('location')], [303, `/manage/team/rollers?e=${id}#panel`]);
    assert.equal((await srv.get(`/manage/inbox/${id}/discard?back=%2Fmanage`)).status, 405);
    assert.equal(JSON.stringify(inboxOf(srv)), entry);
    assert.equal(storedClub(srv), withEntry);
    assert.ok(fs.existsSync(path.join(srv.dataDir, 'logs', CID, 'rollers', name)));
    assert.deepEqual(srv.server.logs.list(CID).map(r => r.file), [name]);
    assert.ok(!srv.store.slugTaken('cranks'));
    assert.ok(!srv.store.slugTaken('rollers-2'));
    assert.ok(srv.store.get(CID).teams.rollers);
});


// ---- the archive (plan versions spec §11) ----

// A recording of `slug` with these plan codes, written through the server's log store (a head line
// only, as the server stores one: Remove a rider reads it).
function recordingOf(srv, slug, codes) {
    const name = `${T('2026-11-18T18:00:00Z')}-1001.jsonl.gz`;
    srv.server.logs.put(CID, slug, name, gzipSync('{"kind":"paceline-recording","v":1}\n'));
    srv.server.logs.addSigs(CID, slug, name, codes);
    return name;
}

// The team's archive rows as {id: version}.
const archiveOf = (srv, slug) => Object.fromEntries(dbRows(srv.server.db, 'SELECT id, version FROM archive WHERE cid = ? AND slug = ? ORDER BY rowid', CID, slug)
    .map(r => [r.id, JSON.parse(r.version)]));


test('remove a rider: the archive is rewritten too, also a deleted team\'s', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const v = (riders, recSig) => sheet({team: 'rollers', label: 'Rollers', date: '2026-11-12', riders, uploadedAt: '2026-11-12T16:00:00.000Z',
        plan: 'ha0001', n: 1, recSig});
    for (const slug of ['rollers', 'cogs']) {
        recordingOf(srv, slug, ['AAAAAA']);
        assert.equal(srv.server.logs.archiveVersions(CID, slug, [['ha0001', v(['1001', '1002'], 'AAAAAA')], ['ha0002', v(['1002'], 'AAAAAA')]]), 2);
        assert.ok(JSON.stringify(archiveOf(srv, slug)).includes('"1002"'));
    }
    assert.ok(storedClub(srv).includes('"1002"'));
    const res = await followPost(srv, c.cookie, '/manage/rider/remove', {zwiftId: '1002', confirm: '1'});
    // the flash counts the archived versions too (2 per folder, one of each dropped)
    assert.deepEqual(res.flash, {kind: 'ok', text: 'Removed from 1 plan and 4 archived versions.'});
    for (const slug of ['rollers', 'cogs']) {
        const kept = archiveOf(srv, slug);
        assert.deepEqual(Object.keys(kept), ['ha0001'], slug);
        assert.ok(!JSON.stringify(kept).includes('"1002"'), slug);
        assert.equal(kept.ha0001.recSig, 'AAAAAA');
    }
    assert.ok(!storedClub(srv).includes('"1002"'));
});


// A POST that answers 500, with the server's error line kept off the test output.
async function quiet500(srv, cookie, p, form) {
    const error = console.error;
    console.error = () => {};
    try {
        return await post(srv, cookie, p, form);
    } finally {
        console.error = error;
    }
}


test('remove a rider: archive, club and checks change in one transaction', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const v = (riders, recSig) => sheet({team: 'rollers', label: 'Rollers', date: '2026-11-12', riders, uploadedAt: '2026-11-12T16:00:00.000Z',
        plan: 'ha0001', n: 1, recSig});
    recordingOf(srv, 'rollers', ['AAAAAA']);
    assert.equal(srv.server.logs.archiveVersions(CID, 'rollers', [['ha0001', v(['1001', '1002'], 'AAAAAA')], ['ha0002', v(['1002'], 'AAAAAA')]]), 2);
    srv.see('1002', '2026-11-19T18:20:00Z', {sig: c.club.sheets[live].sig, mod: '0.3.0', sheet: live, inEvent: false, event: null});
    const listed = () => Object.values(srv.store.get(CID).sheets).some(s => Object.hasOwn(s.json.riders, '1002'));
    assert.ok(listed());

    // the club's row refuses the change: the archive rewrite and the seen removal go too
    const undo = refuseWrites(srv.server.db, 'clubs', ['UPDATE']);
    let refused;
    try {
        refused = await quiet500(srv, c.cookie, '/manage/rider/remove', {zwiftId: '1002', confirm: '1'});
    } finally {
        undo();
    }
    assert.equal(refused.status, 500);
    const kept = archiveOf(srv, 'rollers');
    assert.deepEqual(Object.keys(kept), ['ha0001', 'ha0002']);
    for (const id of ['ha0001', 'ha0002']) {
        assert.ok(JSON.stringify(kept[id]).includes('"1002"'), id);
    }
    assert.ok(listed());
    assert.ok(storedClub(srv).includes('"1002"'));
    assert.ok(Object.hasOwn(srv.store.seenOf(CID), '1002'));

    // the seen row refuses its delete (it is on disk once flushed): archive and club stay too
    assert.equal(srv.store.flushSeen(), true);
    const undoSeen = refuseWrites(srv.server.db, 'seen', ['DELETE']);
    try {
        refused = await quiet500(srv, c.cookie, '/manage/rider/remove', {zwiftId: '1002', confirm: '1'});
    } finally {
        undoSeen();
    }
    assert.equal(refused.status, 500);
    assert.deepEqual(archiveOf(srv, 'rollers'), kept);
    assert.ok(listed());
    assert.ok(storedClub(srv).includes('"1002"'));
    assert.ok(Object.hasOwn(srv.store.seenOf(CID), '1002'));
    assert.deepEqual(dbRows(srv.server.db, 'SELECT athlete FROM seen WHERE cid = ?', CID), [{athlete: '1002'}]);

    const res = await followPost(srv, c.cookie, '/manage/rider/remove', {zwiftId: '1002', confirm: '1'});
    assert.deepEqual(res.flash, {kind: 'ok', text: 'Removed from 1 plan and 2 archived versions.'});
    const after = archiveOf(srv, 'rollers');
    assert.deepEqual(Object.keys(after), ['ha0001']);
    assert.ok(!JSON.stringify(after).includes('"1002"'));
    assert.ok(!listed());
    assert.ok(!storedClub(srv).includes('"1002"'));
    assert.ok(!Object.hasOwn(srv.store.seenOf(CID), '1002'));
});


test('team delete: the slug is retired in the club change\'s transaction', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    const retired = () => dbRows(srv.server.db, "SELECT slug FROM retired_slugs WHERE slug = 'rollers'");
    const undo = refuseWrites(srv.server.db, 'clubs', ['UPDATE']);
    let refused;
    try {
        refused = await quiet500(srv, c.cookie, '/manage/team', {action: 'delete', team: 'rollers', confirm: '1'});
    } finally {
        undo();
    }
    assert.equal(refused.status, 500);
    assert.deepEqual(retired(), []);
    assert.ok(Object.hasOwn(srv.store.get(CID).teams, 'rollers'));
    assert.equal(srv.store.slugTaken('rollers'), true, 'the team itself still holds it');

    const del = await post(srv, c.cookie, '/manage/team', {action: 'delete', team: 'rollers', confirm: '1'});
    assert.equal(del.status, 303, del.body);
    assert.deepEqual(retired(), [{slug: 'rollers'}]);
    assert.ok(!Object.hasOwn(srv.store.get(CID).teams, 'rollers'));
    assert.equal(srv.store.slugTaken('rollers'), true);
});


test('delete plan: its used version is archived in the club change\'s transaction', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ['1001', '1002'], at: T('2026-11-19T14:10:00Z'), live: false});
    const srv = await serve(t, c);
    recordingOf(srv, 'rollers', [c.club.sheets[slow].recSig]);
    // the club's row refuses the change: the archive row written before it in the same transaction goes too
    const undo = refuseWrites(srv.server.db, 'clubs', ['UPDATE']);
    const error = console.error;
    console.error = () => {};
    let refused;
    try {
        refused = await post(srv, c.cookie, '/manage/sheet/delete', {team: 'rollers', sheet: slow, confirm: '1'});
    } finally {
        console.error = error;
        undo();
    }
    assert.equal(refused.status, 500);
    assert.ok(Object.hasOwn(srv.store.get(CID).sheets, slow));
    assert.ok(storedClub(srv).includes(`"${slow}"`));
    assert.deepEqual(archiveOf(srv, 'rollers'), {});
    const del = await followPost(srv, c.cookie, '/manage/sheet/delete', {team: 'rollers', sheet: slow, confirm: '1'});
    assert.equal(del.status, 303);
    assert.deepEqual(del.flash, {kind: 'ok', text: 'Deleted \'Rollers · slow\' with its versions.'});
    assert.ok(!Object.hasOwn(srv.store.get(CID).sheets, slow));
    assert.deepEqual(Object.keys(archiveOf(srv, 'rollers')), [slow]);
    assert.equal(archiveOf(srv, 'rollers')[slow].recSig, c.club.sheets[slow].recSig);
});


test('remove a rider: a version left without riders is not archived with him (the club change archives nothing)', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ['1001', '1003'], at: T('2026-11-19T14:00:00Z')});
    const solo = upload(c.club, 'rollers', {type: 'solo', riders: ['1002'], at: T('2026-11-19T14:10:00Z'), live: false});
    const srv = await serve(t, c);
    recordingOf(srv, 'rollers', [c.club.sheets[solo].recSig]);
    const res = await followPost(srv, c.cookie, '/manage/rider/remove', {zwiftId: '1002', confirm: '1'});
    assert.deepEqual(res.flash, {kind: 'ok', text: 'Removed from 1 plan.'});
    assert.ok(!Object.hasOwn(srv.store.get(CID).sheets, solo));
    const leaked = dbRows(srv.server.db, 'SELECT slug, id FROM archive WHERE cid = ? AND instr(version, \'"1002"\') > 0', CID);
    assert.deepEqual(leaked, [], 'rider 1002 in the archive after Remove a rider');
});


test('remove a rider: his own recordings are deleted and his rows leave the others; the flash counts them, also what failed', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const session = T('2026-11-18T18:30:00Z');
    const head = {kind: 'paceline-recording', v: 1, plan: {riders: [{id: '1001', name: 'Ben'}, {id: '1002', name: 'Cleo'}], bench: []}};
    const rec = self => gzipSync([head, {ts: 1, watchingId: '1002', riders: [{id: self, self: true}, {id: self === '1001' ? '1002' : '1001'}]}]
        .map(x => JSON.stringify(x)).join('\n') + '\n');
    const dir = path.join(srv.dataDir, 'logs', CID);
    srv.server.logs.put(CID, 'rollers', `${session}-1001.jsonl.gz`, rec('1001'));
    srv.server.logs.put(CID, 'rollers', `${session}-1002.jsonl.gz`, rec('1002'));
    srv.server.logs.put(CID, 'cogs', `${session}-1003.jsonl.gz`, rec('1003'));
    // the rename of Dan's rewritten file fails once
    const danFile = path.join(dir, 'cogs', `${session}-1003.jsonl.gz`);
    const renameSync = fs.renameSync;
    fs.renameSync = (from, to) => {
        if (String(to) === danFile) {
            throw Object.assign(new Error('io'), {code: 'EIO'});
        }
        return renameSync(from, to);
    };
    const error = console.error;
    console.error = () => {};
    let res;
    try {
        res = await followPost(srv, c.cookie, '/manage/rider/remove', {zwiftId: '1002', confirm: '1'});
    } finally {
        fs.renameSync = renameSync;
        console.error = error;
    }
    assert.deepEqual(res.flash, {kind: 'err', text: 'Removed from 1 plan and 1 recording. 1 of their own recordings deleted. ' +
        '1 recording could not be changed: remove the rider again to finish it.'});
    assert.equal(res.location, '/manage/settings');
    assert.ok(!fs.existsSync(path.join(dir, 'rollers', `${session}-1002.jsonl.gz`)));
    assert.ok(!gunzipSync(fs.readFileSync(path.join(dir, 'rollers', `${session}-1001.jsonl.gz`))).toString().includes('1002'));
    assert.ok(gunzipSync(fs.readFileSync(danFile)).toString().includes('1002'), 'the failed one as it was');
    // again: the rest is done
    const lines = () => fs.readFileSync(path.join(srv.dataDir, 'erasures.jsonl'), 'utf8').split('\n').filter(Boolean);
    assert.equal(lines().length, 1);
    const again = await followPost(srv, c.cookie, '/manage/rider/remove', {zwiftId: '1002', confirm: '1'});
    assert.deepEqual(again.flash, {kind: 'ok', text: 'Removed from 1 recording.'});
    assert.ok(!gunzipSync(fs.readFileSync(danFile)).toString().includes('1002'));
    assert.equal(lines().length, 1, 'the retry runs the pending entry again, no new line');
    const last = await followPost(srv, c.cookie, '/manage/rider/remove', {zwiftId: '1002', confirm: '1'});
    assert.deepEqual(last.flash, {kind: 'ok', text: 'This rider was removed already, and nothing of theirs was stored since.'});
    assert.equal(lines().length, 1);
    // the activity log names no one
    assert.ok(!JSON.stringify(srv.store.get(CID).log).includes('1002'));
    // the hint and the privacy page say it reaches the recordings
    const settings = textOf(await (await srv.get('/manage/settings')).text());
    assert.match(settings, /out of the rider status lists and out of every recording of the club: their own uploaded recordings are deleted, and their rows are taken out of their team-mates'\./);
    assert.doesNotMatch(settings, /stay until you delete them under Recordings/);
    const privacy = textOf(await (await srv.get('/privacy')).text());
    assert.match(privacy, /90 days; Remove a rider deletes the rider's own recordings and takes their rows out of the others at once/);
    assert.match(privacy, /seen only by the operator\. Remove a rider takes a rider out of all of them at once \(backups: see below\)\./);
});


// ---- several clubs in one browser: every form names its club (security audit I1, M1, M3) ----

const BID = 'p2m8c4t1v9';
const jarOf = toks => `__Host-pl_club=${toks.join('.')}`;
const tokenOf = cookie => cookie.slice(cookie.indexOf('=') + 1);

// Kettenfett RC (A) and Spokesmen CC (B), each with riders in a live plan; one browser holds both,
// A active. {srv, a, b} with their plain tokens.
async function twoClubs(t) {
    const a = makeClub();
    upload(a.club, 'rollers', {riders: ROLLERS, at: T('2026-11-18T20:00:00Z')});
    const b = secondClub({teams: [['Spokes', '19:30']]});
    upload(b.club, b.slugs[0], {riders: ['1001', '2002', '2003'], at: T('2026-11-18T20:00:00Z')});
    const srv = await serve(t, a);
    srv.store.create(b.club);
    return {srv, a: tokenOf(a.cookie), b: tokenOf(b.cookie), spokes: b.slugs[0]};
}

// A club's link replaced (another device opened a new one): its old token is dead. The new token.
function replaceLink(srv, cid) {
    let tok;
    srv.store.change(cid, c => {
        tok = addLink(c, NOW);
        openLink(c, tokenHash(tok), NOW);
    });
    return tok;
}

// The club field of the first form of `page` that posts to `action`.
function clubFieldOf(page, action) {
    const m = new RegExp(`<form [^>]*action="${action.replace(/[/?]/g, '\\$&')}"[^>]*><input type="hidden" name="club" value="([^"]*)">`).exec(page);
    assert.ok(m, `${action} carries the club`);
    return m[1];
}

// The forms A's settings page would post, as they stand in the page (its club field included).
async function formsOfA(srv, cookie) {
    const page = await (await fetch(`${srv.base}/manage/settings`, {headers: {cookie}})).text();
    const club = clubFieldOf(page, '/manage/rider/remove');
    assert.equal(club, CID);
    assert.equal(clubFieldOf(page, '/manage/club'), CID);
    assert.equal(clubFieldOf(page, '/manage/logout'), CID);
    return {
        remove: {club, zwiftId: '1001'},
        rename: {club, name: 'Kettenfett Racing', tz: 'UTC', weekday: '2'},
        logout: {club},
    };
}

// Sends A's forms `which` with `cookie`: each answers 409 with the open club's teams and the reason,
// sets no cookie, and neither club changes.
async function refusedAll(srv, cookie, forms, openName, which = ['remove', 'rename', 'logout']) {
    const before = [JSON.stringify(srv.store.get(CID)), JSON.stringify(srv.store.get(BID))];
    const paths = {remove: '/manage/rider/remove', rename: '/manage/club', logout: '/manage/logout'};
    for (const [p, fields] of which.map(k => [paths[k], forms[k]])) {
        const res = await post(srv, cookie, p, fields);
        assert.equal(res.status, 409, `${p}: ${res.body.slice(0, 200)}`);
        assert.equal(res.headers.get('set-cookie'), null, p);
        assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'This page was for another club than the one open in this browser now. Nothing was changed.'}, p);
        assert.match(res.body, new RegExp(`<h1>${openName}</h1>`), `${p}: the page shows the club that is open`);
    }
    assert.deepEqual([JSON.stringify(srv.store.get(CID)), JSON.stringify(srv.store.get(BID))], before, 'neither club changed');
}

const ridersOf = (srv, cid) => [...new Set(Object.values(srv.store.get(cid).sheets).flatMap(s => Object.keys(s.json.riders)))].sort();


test('several clubs: a page of A, the browser switched to B in another tab: 409, B unchanged', async t => {
    const {srv, a, b} = await twoClubs(t);
    const forms = await formsOfA(srv, jarOf([a, b]));
    // the other tab switches to B
    const sw = await post(srv, jarOf([a, b]), '/switch', {club: BID});
    assert.equal(sw.status, 303);
    const cookie = sw.headers.get('set-cookie').split(';')[0];
    assert.equal(cookie, jarOf([b, a]));
    assert.ok(ridersOf(srv, BID).includes('1001'));
    await refusedAll(srv, cookie, forms, 'Spokesmen CC', ['remove', 'rename']);
    assert.ok(ridersOf(srv, BID).includes('1001'), 'rider 1001 still in B');
    assert.equal(srv.store.get(BID).name, 'Spokesmen CC');
    assert.ok(ridersOf(srv, CID).includes('1001'), 'and in A');
    // a form without the field (a page from before it): out of date, nothing changes
    const old = await post(srv, cookie, '/manage/rider/remove', {club: undefined, zwiftId: '1001', confirm: '1'});
    assert.equal(old.status, 409);
    assert.deepEqual(flashOf(old.body), {kind: 'err', text: 'This page was out of date. Nothing was changed.'});
    assert.ok(ridersOf(srv, BID).includes('1001'));
    // B's own page acts on B; its Log out drops B only
    const ok = await post(srv, cookie, '/manage/rider/remove', {club: BID, zwiftId: '1001', confirm: '1'});
    assert.equal(ok.status, 303);
    assert.ok(!ridersOf(srv, BID).includes('1001'));
    assert.ok(ridersOf(srv, CID).includes('1001'), 'A keeps rider 1001');
    const out = await post(srv, cookie, '/manage/logout', {club: BID});
    assert.equal(out.status, 303);
    assert.equal(out.headers.get('set-cookie').split(';')[0], jarOf([a]));
});


test('several clubs: Log out from a tab of A while B is active drops A, B stays active', async t => {
    const {srv, a, b} = await twoClubs(t);
    const forms = await formsOfA(srv, jarOf([a, b]));
    const before = [JSON.stringify(srv.store.get(CID)), JSON.stringify(srv.store.get(BID))];
    const out = await post(srv, jarOf([b, a]), '/manage/logout', forms.logout);
    assert.equal(out.status, 303);
    assert.equal(out.headers.get('location'), '/');
    assert.equal(out.headers.get('set-cookie'), `${jarOf([b])}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=34560000`);
    const page = await (await fetch(`${srv.base}/manage`, {headers: {cookie: jarOf([b])}})).text();
    assert.match(page, /<h1>Spokesmen CC<\/h1>/, 'B is the open club');
    assert.deepEqual([JSON.stringify(srv.store.get(CID)), JSON.stringify(srv.store.get(BID))], before, 'no club changed');
    // cross-site: refused, the cookie stays
    const cross = await post(srv, jarOf([b, a]), '/manage/logout', forms.logout, {headers: {'sec-fetch-site': 'cross-site'}});
    assert.equal(cross.status, 403);
    assert.equal(cross.headers.get('set-cookie'), null);
    // a club the cookie does not hold (A's link ended): 409, B stays
    replaceLink(srv, CID);
    const gone = await post(srv, jarOf([b, a]), '/manage/logout', forms.logout);
    assert.equal(gone.status, 409);
    assert.equal(gone.headers.get('set-cookie'), null);
    // no club field (a page from before it): 409 out of date, B stays
    const old = await post(srv, jarOf([b]), '/manage/logout', {club: undefined});
    assert.equal(old.status, 409);
    assert.equal(old.headers.get('set-cookie'), null);
});


test('several clubs: a page of A whose link ended, the cookie fell through to B: 409, B unchanged', async t => {
    const {srv, a, b} = await twoClubs(t);
    const forms = await formsOfA(srv, jarOf([a, b]));
    replaceLink(srv, CID);
    // the GET shows B plainly
    const page = await (await fetch(`${srv.base}/manage`, {headers: {cookie: jarOf([a, b])}})).text();
    assert.match(page, /<h1>Spokesmen CC<\/h1>/);
    await refusedAll(srv, jarOf([a, b]), forms, 'Spokesmen CC');
    assert.ok(ridersOf(srv, BID).includes('1001'));
});


test('several clubs: the upload and the assign page name their club too', async t => {
    const {srv, a, b, spokes} = await twoClubs(t);
    const id = await intake(srv, jarOf([a, b]), {team: 'rollers', json: planJson('Rollers fast', ROLLERS)});
    const assign = await (await fetch(`${srv.base}/manage/inbox/${id}`, {headers: {cookie: jarOf([a, b])}})).text();
    assert.equal(clubFieldOf(assign, `/manage/inbox/${id}`), CID);
    const upPage = await (await fetch(`${srv.base}/manage/upload?team=rollers`, {headers: {cookie: jarOf([a, b])}})).text();
    assert.equal(clubFieldOf(upPage, '/manage/upload?team=rollers'), CID);
    const before = [JSON.stringify(srv.store.get(CID)), JSON.stringify(srv.store.get(BID))];
    // switched to B: A's upload form and A's Store and Discard are refused
    const cookie = jarOf([b, a]);
    const up = await postUpload(srv, cookie, {club: CID, team: spokes, json: planJson('Spokes', ['1009'])});
    assert.equal(up.status, 409);
    assert.deepEqual(flashOf(await up.text()), {kind: 'err', text: 'This page was for another club than the one open in this browser now. Nothing was changed.'});
    for (const p of [`/manage/inbox/${id}`, `/manage/inbox/${id}/discard`]) {
        const res = await post(srv, cookie, p, {club: CID, team: 'rollers', as: 'new', live: 'on'});
        assert.equal(res.status, 409, p);
    }
    assert.deepEqual([JSON.stringify(srv.store.get(CID)), JSON.stringify(srv.store.get(BID))], before);
});


// A POST whose body comes in after `between()` has run (the gate has seen the club by then).
function slowPost(srv, cookie, p, fields, between) {
    const body = new URLSearchParams(fields).toString();
    const {port} = new URL(srv.base);
    return new Promise((resolve, reject) => {
        const req = http.request({host: '127.0.0.1', port, method: 'POST', path: p, headers: {
            cookie, 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body),
        }}, res => {
            res.resume();
            res.on('end', () => resolve({status: res.statusCode, setCookie: res.headers['set-cookie'] ?? null}));
        });
        req.on('error', reject);
        req.flushHeaders();
        setTimeout(() => {
            between();
            req.end(body);
        }, 100);
    });
}


// The gate sees A; A's link is replaced before the body is read, so the cookie now opens B first. Even
// a form naming B (or A) changes nothing: 403, as an upload's (M1). (Log out of B would be honoured:
// it drops a club the cookie holds, which is always safe.)
test('several clubs: the link replaced while the body comes in: 403, the next club unchanged', async t => {
    const {srv, a, b} = await twoClubs(t);
    let tok = a;
    for (const [p, fields] of [['/manage/club', {club: CID, name: 'Renamed Mid Flight', tz: 'UTC', weekday: '2'}],
        ['/manage/club', {club: BID, name: 'Renamed Mid Flight', tz: 'UTC', weekday: '2'}],
        ['/manage/rider/remove', {club: BID, zwiftId: '1001', confirm: '1'}], ['/manage/logout', {club: CID}],
        ['/manage/team', {club: BID, action: 'add', name: 'Gears'}]]) {
        const before = JSON.stringify(srv.store.get(BID));
        const res = await slowPost(srv, jarOf([tok, b]), p, fields, () => {
            tok = replaceLink(srv, CID);
        });
        assert.equal(res.status, 403, `${p} ${fields.club}`);
        // the dead token drops out, B's stays (clearDeadCookie)
        assert.deepEqual(res.setCookie?.map(c => c.split(';')[0]), [jarOf([b])], `${p}: B's token stays`);
        assert.equal(JSON.stringify(srv.store.get(BID)), before, `${p}: B unchanged`);
    }
    assert.equal(srv.store.get(BID).name, 'Spokesmen CC');
    assert.equal(srv.store.get(CID).name, 'Kettenfett RC');
});


test('several clubs: every form of the captain pages names its club; the heads name the club', async t => {
    const {srv, a, b, spokes} = await twoClubs(t);
    const plan = Object.values(srv.store.get(CID).sheets)[0].plan;
    const id = await intake(srv, jarOf([a, b]), {team: 'rollers', json: planJson('Rollers fast', ROLLERS)});
    const pages = ['/manage', '/manage/settings', '/manage/team/rollers', '/manage/team/rollers/settings', '/manage/new-team',
        '/manage/upload?team=rollers', `/manage/team/rollers/plan/${plan}`, `/manage/inbox/${id}`];
    let forms = 0;
    for (const p of pages) {
        const page = await (await fetch(srv.base + p, {headers: {cookie: jarOf([a, b])}})).text();
        const all = page.match(/<form\b[^>]*\bmethod="post"[^>]*\baction="\/manage[^"]*"[^>]*>/g) ?? [];
        const named = page.match(/<form\b[^>]*\bmethod="post"[^>]*\baction="\/manage[^"]*"[^>]*><input type="hidden" name="club" value="k7f3q9x2m4">/g) ?? [];
        assert.equal(named.length, all.length, `${p}: every /manage form starts with the club field`);
        // the other club's id only in the footer's switch to it (POST /switch, not /manage)
        const switches = page.match(/<form method="post" action="\/switch"><input type="hidden" name="club" value="[^"]*">/g) ?? [];
        assert.ok(switches.length >= 1 && switches.every(f => f.includes(`value="${BID}"`)), `${p}: ${switches}`);
        assert.equal(page.split(`value="${BID}"`).length - 1, switches.length, `${p}: no other club's id elsewhere`);
        forms += all.length;
    }
    assert.ok(forms >= 16, `forms seen: ${forms}`);
    // A's link ended: every page of B (the club the cookie falls through to) names B in its head
    replaceLink(srv, CID);
    const head = /<h1>Spokesmen CC<\/h1>|<span class="topbar-club">Spokesmen CC<\/span>|<p class="kicker">Spokesmen CC<\/p>/;
    for (const p of ['/manage', '/manage/settings', `/manage/team/${spokes}`, `/manage/team/${spokes}/settings`, '/manage/new-team',
        `/manage/upload?team=${spokes}`]) {
        const res = await fetch(srv.base + p, {headers: {cookie: jarOf([a, b])}});
        assert.equal(res.status, 200, p);
        const page = await res.text();
        assert.match(page, head, p);
        assert.ok(!page.includes('Kettenfett RC'), `${p}: nothing of A`);
    }
});


test('several clubs: the footer switches to the other club, names the club in Log out and offers Log out of all clubs', async t => {
    const {srv, a, b} = await twoClubs(t);
    // every footer of the page: the sidebar's (desktop) and, on the overview and the club settings,
    // the page's own (phones): the same
    for (const p of ['/manage', '/manage/settings', '/manage/team/rollers']) {
        const two = await (await fetch(srv.base + p, {headers: {cookie: jarOf([a, b])}})).text();
        const feet = two.match(/<footer class="foot">[\s\S]*?<\/footer>/g);
        assert.equal(feet.length, p === '/manage/team/rollers' ? 1 : 2, p);
        assert.equal(new Set(feet).size, 1, `${p}: the footers are the same`);
        const [foot] = feet;
        // the other club first: a one-button POST /switch with its id, its name as the text
        assert.ok(foot.startsWith(`<footer class="foot">\n    <div class="foot-clubs" role="group" aria-label="Other clubs"><p class="foot-label" aria-hidden="true">Other clubs</p>\n    <form method="post" action="/switch"><input type="hidden" name="club" value="${BID}"><button type="submit"><svg`), `${p}: ${foot}`);
        assert.match(foot, new RegExp(`<form method="post" action="/switch"><input type="hidden" name="club" value="${BID}"><button type="submit"><svg[^>]*>[\\s\\S]*?</svg>Spokesmen CC</button></form>`), p);
        assert.ok(!foot.includes(b) && !foot.includes(a), `${p}: no token`);
        assert.doesNotMatch(foot, /Switch club|href="\/"/, p);
        assert.match(foot, /<form method="post" action="\/manage\/logout"><input type="hidden" name="club" value="k7f3q9x2m4"><button type="submit"><svg[^>]*>[\s\S]*?<\/svg>Log out of Kettenfett RC<\/button><\/form>/, p);
        assert.match(foot, /<form method="post" action="\/logout-all"><button type="submit"><svg[^>]*>[\s\S]*?<\/svg>Log out of all clubs<\/button><\/form>/, p);
        assert.ok(foot.indexOf('action="/switch"') < foot.indexOf('href="/privacy"') && foot.indexOf('href="/privacy"') < foot.indexOf('action="/manage/logout"')
            && foot.indexOf('action="/manage/logout"') < foot.indexOf('action="/logout-all"'), `${p}: clubs, Privacy, Log out, Log out of all`);
        const one = await (await fetch(srv.base + p, {headers: {cookie: jarOf([a])}})).text();
        const foot1 = /<footer class="foot">[\s\S]*?<\/footer>/.exec(one)[0];
        assert.match(foot1, /<\/svg>Log out<\/button>/, p);
        assert.doesNotMatch(foot1, /Switch club|Log out of|logout-all|action="\/switch"/, p);
    }
    // the switch: B becomes the open club; its footer offers A
    const sw = await post(srv, jarOf([a, b]), '/switch', {club: BID});
    assert.equal(sw.status, 303);
    assert.equal(sw.headers.get('location'), '/manage');
    const bPage = await (await fetch(`${srv.base}/manage`, {headers: {cookie: jarOf([b, a])}})).text();
    assert.match(bPage, /<h1>Spokesmen CC<\/h1>/);
    assert.match(/<footer class="foot">[\s\S]*?<\/footer>/.exec(bPage)[0], new RegExp(`action="/switch"><input type="hidden" name="club" value="${CID}"><button type="submit"><svg[^>]*>[\\s\\S]*?</svg>Kettenfett RC</button>`));
    // logging out of the open club of two: / and then the other club's /manage
    const out = await post(srv, jarOf([a, b]), '/manage/logout', {club: CID});
    assert.equal(out.status, 303);
    assert.equal(out.headers.get('location'), '/');
    const left = out.headers.get('set-cookie').split(';')[0];
    assert.equal(left, jarOf([b]));
    const home = await fetch(`${srv.base}/`, {redirect: 'manual', headers: {cookie: left}});
    assert.equal(home.status, 303);
    assert.equal(home.headers.get('location'), '/manage');
    assert.match(await (await fetch(`${srv.base}/manage`, {headers: {cookie: left}})).text(), /<h1>Spokesmen CC<\/h1>/);
    // the footer's Log out of all clubs clears the cookie
    const all = await post(srv, jarOf([a, b]), '/logout-all', {});
    assert.equal(all.status, 303);
    assert.equal(all.headers.get('set-cookie'), '__Host-pl_club=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
});


// ---- wave 1 review fixes (UI panel, 19 Nov 2026) ----

test('before the gate: the result says when riders get it, and Make live asks nothing (review M2, M5)', async t => {
    const c = makeClub();
    const v1 = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    // 17:00 in Berlin: Rollers starts 19:30, its gate opens 19:00
    const srv = await serve(t, c, {now: T('2026-11-19T16:00:00Z')});
    const id = await intake(srv, c.cookie, {team: 'rollers', forPlan: v1, json: planJson('Rollers fast', ROLLERS.slice(1))});
    const {body} = await assignOf(srv, id);
    assert.ok(barButtons(body) && !body.includes('data-arm-strip data-for'), body);
    assert.ok(!textOf(body).includes('at once'), textOf(body));
    // the card says only what warns (user, 23 Nov 2026: no "What happens"); the result says when
    assert.equal(whatHappens(body).some(l => l.startsWith('Make live:')), false, whatHappens(body).join('\n'));
    // before the gate Make live acts at once, without confirm (user, 23 Nov 2026)
    const res = await storePost(srv, c.cookie, id, {team: 'rollers', as: v1, type: 'fast', live: 'on', confirm: '1', base: String(VERSION_OF(srv, 'rollers')), drawn: `rollers:${v1}`});
    assert.equal(res.status, 303, res.body);
    assert.ok(textOf(res.body).includes('\'Rollers · fast\' v2 is live for Thu 19 Nov 19:30.'), textOf(res.body));
    assert.ok(textOf(res.body).includes('Riders get it from 19:00.'), textOf(res.body));
    assert.ok(!textOf(res.body).includes('within a minute'), textOf(res.body));
});


test('the same file made live: "(was …)" names only a plan live for the same race (review M3)', async t => {
    const c = makeClub();
    // last week's race keeps its live plan; tonight's plan is stored, not live
    upload(c.club, 'rollers', {type: 'old', riders: ROLLERS, at: T('2026-11-12T10:00:00Z'), date: '2026-11-12'});
    const json = planJson('Rollers fast', ROLLERS.slice(1));
    const fast = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS.slice(1), at: T('2026-11-19T14:00:00Z'), live: false, json});
    const srv = await serve(t, c);
    const id = await intake(srv, c.cookie, {team: 'rollers', forPlan: fast, json});
    const res = await storePost(srv, c.cookie, id, {team: 'rollers', as: fast, type: 'fast', live: 'on', confirm: '1', base: String(VERSION_OF(srv, 'rollers')), drawn: `rollers:${fast}`});
    assert.equal(res.status, 303, res.body);
    assert.equal(liveId(srv.store.get(CID), 'rollers', DATE), fast);
    assert.ok(liveId(srv.store.get(CID), 'rollers', '2026-11-12') !== null, 'last week\'s race keeps its own (live per race)');
    assert.ok(textOf(res.body).includes('Same as \'Rollers · fast\' v1: nothing new stored, but it is live now.'), textOf(res.body));
    assert.ok(!textOf(res.body).includes('(was'), textOf(res.body));
});


// ---- the race ⋯ (POST /manage/race) and the plan ⋯'s Rename (POST /manage/plan/rename), races
// Task 6 ----

// Wednesday 18 Nov, 11:00 in Berlin: the day before Rollers' race.
const WED = T('2026-11-18T10:00:00Z');

// Kettenfett RC: Rollers (weekly, Thursday 19:30) with its live plan 'Rollers' for Thu 19 Nov,
// which lists Ben (1001). The version id.
function raceClub() {
    const c = makeClub();
    const id = upload(c.club, 'rollers', {riders: ROLLERS, at: T('2026-11-17T10:00:00Z')});
    return {c, id};
}


test('POST /manage/race when: asks first, then moves the race, and riders get the new start', async t => {
    const {c} = raceClub();
    const srv = await serve(t, c, {now: WED});
    const fields = {team: 'rollers', date: DATE, version: VERSION_OF(srv, 'rollers'), action: 'when', to: '2026-11-22', start: '18:00'};
    const file = storedClub(srv);
    const asked = await post(srv, c.cookie, '/manage/race', fields);
    assert.equal(asked.status, 200);
    assert.ok(textOf(asked.body).includes('Moves the race of Thu 19 Nov 19:30 to Sun 22 Nov 18:00 with its plan. Riders get it from Sun 22 Nov 17:30.'), textOf(asked.body));
    assert.ok(asked.body.includes('<h1>Move this race?</h1>'), asked.body);
    // the question posts the same fields again with confirm=1, its button not in the danger style
    assert.ok(asked.body.includes(`<input type="hidden" name="team" value="rollers"><input type="hidden" name="date" value="${DATE}"><input type="hidden" name="version" value="${fields.version}">`
        + '<input type="hidden" name="action" value="when"><input type="hidden" name="to" value="2026-11-22"><input type="hidden" name="start" value="18:00">'
        + '<input type="hidden" name="confirm" value="1"><button class="btn primary" type="submit">Move the race</button>'), asked.body);
    assert.ok(asked.body.includes('href="/manage/team/rollers"'), 'back to the team page');
    // nothing changed yet
    assert.ok(srv.store.get(CID).teams.rollers.races[DATE]);
    assert.equal(storedClub(srv), file);
    const moved = await followPost(srv, c.cookie, '/manage/race', {...fields, confirm: '1'});
    assert.equal(moved.location, '/manage/team/rollers#race-2026-11-22');
    assert.deepEqual(moved.flash, {kind: 'ok', text: 'Race moved to Sun 22 Nov 18:00.'});
    assert.deepEqual(Object.keys(srv.store.get(CID).teams.rollers.races), ['2026-11-22']);
    const api = await (await fetch(`${srv.base}/api/v3/rider/1001?mod=0.3.0&joined=${CID}`)).json();
    assert.deepEqual([api.plans[0].date, api.plans[0].startAt], ['2026-11-22', '2026-11-22T17:00:00.000Z']);
    // the same date and time again: nothing to ask, nothing changes
    const again = await followPost(srv, c.cookie, '/manage/race', {...fields, date: '2026-11-22', version: VERSION_OF(srv, 'rollers')});
    assert.deepEqual(again.flash, {kind: 'ok', text: 'Saved.'});
    assert.equal(again.location, '/manage/team/rollers#race-2026-11-22');
});


test('POST /manage/race: a date the team races is refused at once, nothing is asked', async t => {
    const {c} = raceClub();
    upload(c.club, 'rollers', {type: 'sunday', riders: ['1002'], at: T('2026-11-17T11:00:00Z'), date: '2026-11-22', live: false});
    const srv = await serve(t, c, {now: WED});
    const file = storedClub(srv);
    for (const confirm of [undefined, '1']) {
        const res = await post(srv, c.cookie, '/manage/race', {team: 'rollers', date: DATE, version: VERSION_OF(srv, 'rollers'), action: 'when', to: '2026-11-22', start: '',
            ...(confirm ? {confirm} : {})});
        assert.equal(res.status, 400, res.body);
        assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'Rollers already races on Sun 22 Nov: a team races once a date.'});
        assert.ok(!res.body.includes('Move this race?'), 'nothing is asked');
        assert.ok(res.body.includes('<h1 class="desk">Rollers</h1>'), 'the team page');
    }
    // a bad time is refused the same way
    const bad = await post(srv, c.cookie, '/manage/race', {team: 'rollers', date: DATE, version: VERSION_OF(srv, 'rollers'), action: 'when', to: '2026-11-21', start: '25:00'});
    assert.equal(bad.status, 400);
    assert.deepEqual(flashOf(bad.body), {kind: 'err', text: 'Enter the start time as HH:MM.'});
    assert.equal(storedClub(srv), file);
});


test('POST /manage/race from a stale page, and for a race that is gone', async t => {
    const {c} = raceClub();
    const srv = await serve(t, c, {now: WED});
    const file = storedClub(srv);
    const stale = await post(srv, c.cookie, '/manage/race', {team: 'rollers', date: DATE, version: VERSION_OF(srv, 'rollers') - 1, action: 'when', to: '2026-11-22', start: '', confirm: '1'});
    assert.equal(stale.status, 409);
    assert.deepEqual(flashOf(stale.body), {kind: 'err', text: 'Rollers changed since you opened the page. Nothing was changed.'});
    for (const action of ['event', 'unlink']) {
        const res = await post(srv, c.cookie, '/manage/race', {team: 'rollers', date: DATE, version: VERSION_OF(srv, 'rollers') - 1, action, event: 'https://www.zwift.com/events/view/5123456'});
        assert.equal(res.status, 409, action);
    }
    // a page drawn before another captain moved the race: stale (409), not "no longer exists"
    const before = VERSION_OF(srv, 'rollers');
    srv.store.change(CID, x => setRace(x, 'rollers', DATE, {to: '2026-11-20', start: ''}, WED));
    const moved = await post(srv, c.cookie, '/manage/race', {team: 'rollers', date: DATE, version: before, action: 'event', event: 'https://www.zwift.com/events/view/5123456'});
    assert.equal(moved.status, 409, moved.body);
    assert.deepEqual(flashOf(moved.body), {kind: 'err', text: 'Rollers changed since you opened the page. Nothing was changed.'});
    srv.store.change(CID, x => setRace(x, 'rollers', '2026-11-20', {to: DATE, start: ''}, WED));
    const file2 = storedClub(srv);
    const gone = await post(srv, c.cookie, '/manage/race', {team: 'rollers', date: '2026-11-25', version: VERSION_OF(srv, 'rollers'), action: 'event', event: 'https://www.zwift.com/events/view/5123456'});
    assert.equal(gone.status, 400);
    assert.equal(flashOf(gone.body).text, 'This team or plan no longer exists. Nothing was changed.');
    const goneWhen = await post(srv, c.cookie, '/manage/race', {team: 'rollers', date: '2026-11-25', version: VERSION_OF(srv, 'rollers'), action: 'when', to: '2026-11-27', start: ''});
    assert.equal(goneWhen.status, 400);
    assert.equal(flashOf(goneWhen.body).text, 'This team or plan no longer exists. Nothing was changed.');
    assert.deepEqual(Object.keys(srv.store.get(CID).teams.rollers.races), [DATE]);
    // a race that is over (from S + 2 h) takes no change
    srv.clock.now = T('2026-11-19T20:31:00Z');
    for (const fields of [{action: 'when', to: '2026-11-22', start: '', confirm: '1'}, {action: 'event', event: 'https://www.zwift.com/events/view/5123456'}, {action: 'unlink'}]) {
        const res = await post(srv, c.cookie, '/manage/race', {team: 'rollers', date: DATE, version: VERSION_OF(srv, 'rollers'), ...fields});
        assert.equal(res.status, 400, fields.action);
        assert.equal(flashOf(res.body).text, 'The race on Thu 19 Nov is over: its plans can no longer be changed.', fields.action);
    }
    // an unknown action
    const odd = await post(srv, c.cookie, '/manage/race', {team: 'rollers', date: DATE, version: VERSION_OF(srv, 'rollers'), action: 'nope'});
    assert.equal(odd.status, 400);
    assert.equal(storedClub(srv), file2);
    assert.ok(file !== file2, 'the two moves made by hand bumped the version');
});


test('POST /manage/race event and unlink', async t => {
    const {c} = raceClub();
    const srv = await serve(t, c, {now: WED});
    const at = () => ({team: 'rollers', date: DATE, version: VERSION_OF(srv, 'rollers')});
    const set = await followPost(srv, c.cookie, '/manage/race', {...at(), action: 'event', event: 'https://www.zwift.com/events/view/5123456'});
    assert.equal(set.location, `/manage/team/rollers#race-${DATE}`);
    assert.deepEqual(set.flash, {kind: 'ok', text: 'Event link 5123456 set for the race on Thu 19 Nov.'});
    assert.equal(race(srv.store.get(CID), 'rollers', DATE).pinnedEventId, 5123456);
    const file = storedClub(srv);
    for (const [event, text] of [['not a link', 'This is not a Zwift or ZwiftPower event link.'], ['https://example.org/events/view/5123456', 'This is not a Zwift or ZwiftPower event link.'],
        ['', 'Paste a Zwift or ZwiftPower event link.'], ['   ', 'Paste a Zwift or ZwiftPower event link.']]) {
        const res = await post(srv, c.cookie, '/manage/race', {...at(), action: 'event', event});
        assert.equal(res.status, 400, event);
        assert.deepEqual(flashOf(res.body), {kind: 'err', text}, event);
    }
    assert.equal(storedClub(srv), file);
    const unlinked = await followPost(srv, c.cookie, '/manage/race', {...at(), action: 'unlink'});
    assert.equal(unlinked.location, `/manage/team/rollers#race-${DATE}`);
    assert.deepEqual(unlinked.flash, {kind: 'ok', text: 'Event link removed for the race on Thu 19 Nov.'});
    assert.equal(race(srv.store.get(CID), 'rollers', DATE).pinnedEventId, null);
});


test('POST /manage/plan/rename: every version renamed, back on the team page at the plan; a type taken in the race is refused there', async t => {
    const {c, id: v1} = raceClub();
    const v2 = uploadSheet(c.club, {
        slug: 'rollers', json: planJson('Rollers', ROLLERS.slice(1)), text: null, base: c.club.teams.rollers.version, via: 'file', as: v1, live: true, pinnedEventId: null,
    }, {now: T('2026-11-17T12:00:00Z'), newId: () => 'rv0002'}).id;
    upload(c.club, 'rollers', {type: 'slow', riders: ['1002'], at: T('2026-11-17T13:00:00Z'), live: false});
    const srv = await serve(t, c, {now: WED});
    const plan = srv.store.get(CID).sheets[v2].plan;
    assert.equal(plan, v1);
    // a back=plan of a page from before the team cockpit is ignored
    const renamed = await followPost(srv, c.cookie, '/manage/plan/rename', {team: 'rollers', plan: v2, type: 'tempo', version: VERSION_OF(srv, 'rollers'), back: 'plan'});
    assert.equal(renamed.location, `/manage/team/rollers#plan-${plan}`);
    assert.deepEqual(renamed.flash, {kind: 'ok', text: 'Renamed to \'Rollers · tempo\'.'});
    for (const id of [v1, v2]) {
        const s = srv.store.get(CID).sheets[id];
        assert.deepEqual([s.type, s.label], ['tempo', 'Rollers · tempo'], id);
    }
    // a type another plan of the race has: refused on the team page, nothing changes
    const file = storedClub(srv);
    const taken = await post(srv, c.cookie, '/manage/plan/rename', {team: 'rollers', plan, type: 'slow', version: VERSION_OF(srv, 'rollers'), back: 'plan'});
    assert.equal(taken.status, 400);
    assert.deepEqual(flashOf(taken.body), {kind: 'err', text: 'Rollers already has a plan \'slow\' for Thu 19 Nov: choose another type.'});
    assert.ok(taken.body.includes('<main class="page wide cockpit" id="main"'), 'the team page');
    // from a stale page: 409, nothing changes
    const stale = await post(srv, c.cookie, '/manage/plan/rename', {team: 'rollers', plan, type: 'easy', version: VERSION_OF(srv, 'rollers') - 1});
    assert.equal(stale.status, 409);
    assert.ok(stale.body.includes('<h1 class="desk">Rollers</h1>'), 'the team page');
    // a plan that is gone
    const gone = await post(srv, c.cookie, '/manage/plan/rename', {team: 'rollers', plan: 'zz0000', type: 'easy', version: VERSION_OF(srv, 'rollers')});
    assert.equal(gone.status, 400);
    assert.equal(flashOf(gone.body).text, 'This team or plan no longer exists. Nothing was changed.');
    assert.equal(storedClub(srv), file);
    // without back=plan: the same
    const home = await followPost(srv, c.cookie, '/manage/plan/rename', {team: 'rollers', plan, type: '', version: VERSION_OF(srv, 'rollers')});
    assert.equal(home.location, `/manage/team/rollers#plan-${plan}`);
    assert.deepEqual(home.flash, {kind: 'ok', text: 'Renamed to \'Rollers\'.'});
});


test('POST /manage/race when: the question names every plan, the new gate (only an open one is "within a minute") and the learned event', async t => {
    const {c} = raceClub();
    upload(c.club, 'rollers', {type: 'slow', riders: ['1002'], at: T('2026-11-17T11:00:00Z'), live: false});
    Object.assign(race(c.club, 'rollers', DATE), {eventId: 5123999, boundAt: '2026-11-19T17:50:00.000Z'});
    // 19:10 in Berlin: the gate of 19:30 opened at 19:00
    const srv = await serve(t, c, {now: T('2026-11-19T18:10:00Z')});
    const ask = async (to, start) => {
        const res = await post(srv, c.cookie, '/manage/race', {team: 'rollers', date: DATE, version: VERSION_OF(srv, 'rollers'), action: 'when', to, start});
        assert.equal(res.status, 200, res.body);
        return textOf(res.body);
    };
    const LEARNED = 'The event learned from riders\' checks is forgotten.';
    // later tonight: the old gate is open, the new one (19:30) is not; the rider API sends the plan
    // only from the new start's gate, so no "within a minute"
    const later = await ask(DATE, '20:00');
    assert.ok(later.includes(`Moves the race of Thu 19 Nov 19:30 to Thu 19 Nov 20:00 with its 2 plans. Riders get it from 19:30. ${LEARNED}`), later);
    assert.ok(!later.includes('within a minute'), later);
    // postponed to Sunday at 19:10: from Sunday's gate
    const sunday = await ask('2026-11-22', '19:10');
    assert.ok(sunday.includes(`Moves the race of Thu 19 Nov 19:30 to Sun 22 Nov 19:10 with its 2 plans. Riders get it from Sun 22 Nov 18:40. ${LEARNED}`), sunday);
    // earlier tonight, its gate (18:50) open: within a minute
    const earlier = await ask(DATE, '19:20');
    assert.ok(earlier.includes(`Moves the race of Thu 19 Nov 19:30 to Thu 19 Nov 19:20 with its 2 plans. Riders in the event get the plan for the new start within a minute. ${LEARNED}`), earlier);
    const fields = {team: 'rollers', date: DATE, version: VERSION_OF(srv, 'rollers'), action: 'when', to: DATE, start: '20:00'};
    const moved = await followPost(srv, c.cookie, '/manage/race', {...fields, confirm: '1'});
    assert.deepEqual(moved.flash, {kind: 'ok', text: 'Race moved to Thu 19 Nov 20:00.'});
    assert.deepEqual([race(srv.store.get(CID), 'rollers', DATE).start, race(srv.store.get(CID), 'rollers', DATE).eventId], ['20:00', null]);
});




test('assign: a weekly team without any start time: the time field empty and not required, the fold open (user, 23 Nov 2026)', async t => {
    const c = makeClub({teams: [['Rollers', null]]});
    const srv = await serve(t, c, {now: FRI});
    const id = pushedEntry(srv);
    const body = (await assignOf(srv, id, '?team=rollers&as=new&drawn=rollers:new')).body;
    const form = element(body, '<div class="cp-form"');
    assert.ok(form.includes('<input type="time" name="start" value="">'), form);
    assert.ok(/<details class="fold as-race" open>/.test(form), form);
});
