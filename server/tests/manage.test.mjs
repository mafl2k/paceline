// The /manage routes (plan 3, Task 5): the one-shot flash, the upload and the club actions. The
// team picker, the team page, the club settings and their tests are in captain.test.mjs.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {gzipSync, gunzipSync} from 'node:zlib';
import {planJson, sheet, T, CODE_SECRET, rows as dbRows, refuseWrites} from './helpers.mjs';
import {
    CID, DATE, NOW, SETUP_AT, ROLLERS, makeClub, secondClub, upload, serve, textOf, count, flashOf, post, followPost,
    postUpload, storeOk, intake, uploadPageOf, formOf, VERSION_OF, sheetsOf, storedClub, CLUB_FIELD,
} from './manage-helpers.mjs';
import {setRiderCode, uploadSheet} from '../club.mjs';
import {newRiderCode, riderCodeHash, formatRiderCode, tokenHash} from '../ids.mjs';
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
    const res = await post(srv, c.cookie, '/manage/team', {action: 'delete', team: 'sprockets'});
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

// GET of the assign page: {status, headers, body}.
async function assignOf(srv, id, query = '') {
    const res = await srv.get(`/manage/inbox/${id}${query}`);
    return {status: res.status, headers: res.headers, body: await res.text()};
}

// The texts of the "What happens" lines, in order (the text of each line's own <span>).
const whatHappens = body => [...section(body, '<section class="card" aria-labelledby="wh-h">')
    .matchAll(/<li class="(?:ok|info|warn|err)"><svg[^>]*>[\s\S]*?<\/svg><span>([^<]*)<\/span>/g)].map(m => textOf(m[1]).trim());

// The checked radios of a group and the live box.
const checkedOf = (body, name) => [...body.matchAll(new RegExp(`<input type="radio" name="${name}" value="([^"]*)" checked>`, 'g'))].map(m => m[1]);
const liveChecked = body => body.includes('<input type="checkbox" name="live" value="on" checked>');

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
    assert.ok(f.includes('<label class="field">Planner JSON<input id="json-in" type="file" name="json" accept=".json,application/json"></label>'), f);
    assert.match(f, /<details class="fold"><summary>Paste the JSON instead<\/summary>[\s\S]*?<textarea name="paste"/);
    // the text export: a plain optional field, outside any fold; only the paste is folded
    assert.ok(f.includes('<label class="field">Text export (optional) <span class="hint">The pull watts come from the JSON&#39;s pull power, or else from this file.</span>'
        + '<input type="file" name="text" accept=".txt,text/plain"></label>'), f);
    const outside = f.replace(/<details[\s\S]*?<\/details>/g, '');
    assert.ok(outside.includes('<input type="file" name="text"'), 'the text export is in no <details>');
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


test('upload page: opened from the plan page, its way back is that plan', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-15T14:00:00Z')});
    const sp = upload(c.club, 'sprockets', {riders: ['1009'], at: T('2026-11-15T14:05:00Z')});
    const srv = await serve(t, c, {now: T('2026-11-16T09:00:00Z')});
    const plan = planIdOf(srv, live);
    // the plan page's New version says where it comes from
    const planPage = await (await srv.get(`/manage/team/rollers/plan/${plan}`)).text();
    assert.ok(planPage.includes(`<a class="rowlink" href="/manage/upload?team=rollers&amp;plan=${plan}&amp;from=plan">`), planPage);
    // from=plan: back to the plan, labelled with it, the club still named for the phone
    const page = await (await srv.get(`/manage/upload?team=rollers&plan=${plan}&from=plan`)).text();
    assert.deepEqual(backOf(page), [`/manage/team/rollers/plan/${plan}`, 'Rollers · fast']);
    assert.ok(page.includes('<span class="topbar-club">Kettenfett RC</span>'), page);
    assert.ok(page.includes(`action="/manage/upload?team=rollers&amp;plan=${plan}&amp;from=plan" enctype`), page);
    // a version id names the plan too: the link goes to the plan's own page
    assert.deepEqual(backOf(await (await srv.get(`/manage/upload?team=rollers&plan=${live}&from=plan`)).text())[0], `/manage/team/rollers/plan/${plan}`);
    // without from=plan (a hole link sets plan too), with a plan of another team, an unknown plan, no
    // plan or another from: the team page, and the action carries no from
    for (const q of [`&plan=${plan}`, `&plan=${plan}&from=team`, `&plan=${planIdOf(srv, sp)}&from=plan`, '&plan=zzzzzz&from=plan', '&from=plan', '']) {
        const other = await (await srv.get(`/manage/upload?team=rollers${q}`)).text();
        assert.deepEqual(backOf(other), ['/manage/team/rollers', 'Rollers'], q);
        assert.ok(!other.includes('from=plan'), q);
    }
});


test('upload: makes an entry and answers 303 to the assign page', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const sheets = Object.keys(srv.store.get(CID).sheets).length;
    const version = VERSION_OF(srv, 'rollers');
    const res = await postUpload(srv, c.cookie, {team: 'rollers', forPlan: live, json: planJson('Rollers fast', ROLLERS.slice(1))});
    assert.equal(res.status, 303, await res.text());
    assert.match(res.headers.get('location'), /^\/manage\/inbox\/[0-9a-hjkmnp-tv-z]{6}$/);
    const club = srv.store.get(CID);
    assert.equal(club.inbox.length, 1);
    const [e] = club.inbox;
    assert.equal(res.headers.get('location'), `/manage/inbox/${e.id}`);
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
    await refused({team: 'rollers'}, 'Load the JSON export too – it has the Zwift IDs.');
    await refused({team: 'rollers', json: 'not a plan at all'}, 'Could not read this file – expected the planner\'s JSON or text export.');
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
    // opened from the plan page: the refusal keeps the plan and the way back to it
    const plan = planIdOf(srv, live);
    const to = `/manage/upload?team=rollers&plan=${plan}&from=plan`;
    const fromPlan = await postUpload(srv, c.cookie, {team: 'rollers', forPlan: plan, json: {team: {name: 'Rollers'}}}, {path: to});
    const again = await fromPlan.text();
    assert.equal(fromPlan.status, 400, again);
    assert.ok(textOf(again).includes('as a new version of \'Rollers · fast\''), textOf(again));
    assert.deepEqual(backOf(again), [`/manage/team/rollers/plan/${plan}`, 'Rollers · fast']);
    assert.ok(again.includes(`action="/manage/upload?team=rollers&amp;plan=${plan}&amp;from=plan" enctype`), again);
    // busy (503) and over the budget (429) are refused before the body is read: the plan and the way
    // back come from the form's action
    srv.server.web.sheetUploads.take(CID);
    const busy = await postUpload(srv, c.cookie, {team: 'rollers', forPlan: plan, json: planJson('Rollers fast', ROLLERS)}, {path: to});
    const busyBody = await busy.text();
    assert.equal(busy.status, 503, busyBody);
    assert.ok(textOf(busyBody).includes('as a new version of \'Rollers · fast\''), textOf(busyBody));
    assert.ok(formOf(busyBody).includes(`<input type="hidden" name="forPlan" value="${plan}">`), busyBody);
    assert.deepEqual(backOf(busyBody), [`/manage/team/rollers/plan/${plan}`, 'Rollers · fast']);
    srv.server.web.sheetUploads.release(CID);
    for (let i = 0; i < 60; i++) {
        srv.server.web.sheetParses.add(CID, srv.clock.now);
    }
    const over = await postUpload(srv, c.cookie, {team: 'rollers', forPlan: plan, json: planJson('Rollers fast', ROLLERS)}, {path: to});
    const overBody = await over.text();
    assert.equal(over.status, 429, overBody);
    assert.ok(textOf(overBody).includes('as a new version of \'Rollers · fast\''), textOf(overBody));
    assert.deepEqual(backOf(overBody), [`/manage/team/rollers/plan/${plan}`, 'Rollers · fast']);
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
    assert.match(res.headers.get('location'), /^\/manage\/inbox\/[0-9a-hjkmnp-tv-z]{6}$/);
    const [e] = inboxOf(srv);
    assert.equal(e.forPlan, null, 'as is not forPlan');
    assert.equal(Object.keys(srv.store.get(CID).sheets).length, 1, 'nothing stored');
    assert.equal(srv.store.get(CID).teams.rollers.live, live);
    assert.notEqual(storedClub(srv), file, 'the entry is written');
});


test('assign page: the same file as a stored version names that version, and says it goes live', async t => {
    // final review M-3: v1 live, v2 stored not live, v2's file again: there is no v3
    const c = makeClub();
    const v1 = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const json = planJson('Rollers fast', ROLLERS.slice(1));
    await storeOk(srv, c.cookie, {team: 'rollers', json}, {as: v1, live: undefined});
    const v2 = sheetsOf(srv, 'rollers').find(([, s]) => s.n === 2)[0];
    assert.equal(srv.store.get(CID).teams.rollers.live, v1);
    const id = await intake(srv, c.cookie, {team: 'rollers', forPlan: v1, json});
    const {body} = await assignOf(srv, id);
    assert.ok(body.includes('<label><input type="checkbox" name="live" value="on" checked> Make live: riders get v2 at once instead of v1</label>'), body);
    assert.deepEqual(whatHappens(body).slice(0, 1), ['Same as v2: nothing new would be stored, but v2 goes live for Thu 19 Nov 19:30. Riders get it from 19:00.']);
    assert.ok(!textOf(body).includes('v3'), textOf(body));
    // unticked: nothing happens, and the label still names v2
    const off = (await assignOf(srv, id, `?team=rollers&as=${v1}&type=fast&drawn=rollers:${v1}&touched=live`)).body;
    assert.ok(off.includes('<label><input type="checkbox" name="live" value="on"> Make live: riders get v2 at once instead of v1</label>'), off);
    assert.deepEqual(whatHappens(off).slice(0, 1), ['Same as v2: nothing new would be stored.']);
    // Store makes v2 live
    const res = await post(srv, c.cookie, `/manage/inbox/${id}`, {team: 'rollers', as: v1, type: 'fast', live: 'on', base: String(VERSION_OF(srv, 'rollers')), drawn: `rollers:${v1}`});
    assert.equal(res.status, 200, res.body);
    assert.equal(srv.store.get(CID).teams.rollers.live, v2);
    assert.equal(sheetsOf(srv, 'rollers').length, 2, 'nothing new stored');
    // the live version's file again: riders have it already
    const again = await intake(srv, c.cookie, {team: 'rollers', forPlan: v1, json});
    const live = (await assignOf(srv, again)).body;
    assert.ok(live.includes('> Make live: riders have v2 already</label>'), live);
    assert.deepEqual(whatHappens(live).slice(0, 1), ['Same as v2: nothing new would be stored.']);
    assert.ok(!textOf(live).includes('v3'), textOf(live));
});


test('assign page: the planner\'s roster shows nowhere, title and riders fold alike', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    // Ida and Jo are in the planner's roster (the club's rider pool), not in the ride order
    const id = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers pool', ['1001', '1002', '1003'], ['1008', '1009'])});
    const {status, body} = await assignOf(srv, id);
    assert.equal(status, 200, body);
    assert.ok(body.includes('<p class="as-title"><strong>3 riders (Ben, Cleo …)</strong></p>'), body);
    assert.match(body, /<details class="card fold"><summary>Riders \(3\)<\/summary>/);
    assert.ok(!/bench/i.test(textOf(body)), textOf(body));
    assert.ok(!textOf(body).includes('Ida') && !textOf(body).includes('Jo '), textOf(body));
});


test('assign page: preselected, the box in words, never reloads, changes nothing', async t => {
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
    assert.ok(body.includes(`<form class="stack" method="post" action="/manage/inbox/${id}" data-assign>`), body);
    assert.ok(body.includes('<h1>Store a plan</h1>'));
    const text = textOf(body);
    assert.ok(text.includes('8 riders (Ben, Cleo …)'), text);
    assert.match(text, /Uploaded \d\d:\d\d/);
    // the team: Rollers, the other team in a fold
    assert.deepEqual([...body.matchAll(/<input type="radio" name="team" value="([^"]+)"/g)].map(m => m[1]), ['rollers', 'sprockets']);
    assert.deepEqual(checkedOf(body, 'team'), ['rollers']);
    assert.match(body, /<details class="fold"><summary>Other team<\/summary>/);
    assert.ok(text.includes('Race Thu 19 Nov 19:30'), text);
    // the plan the page came from, with the live version's n and the riders in common
    assert.deepEqual(checkedOf(body, 'as'), [live]);
    assert.ok(text.includes('New version of \'Rollers · fast\' live · v1 · 15:00 · 7 of 8 riders the same New plan'), text);
    assert.ok(body.includes('<input name="type" maxlength="30" value="fast" list="types" autocomplete="off">'), body);
    // the box's label says what ticking it does; no sentence beside it that follows the default
    assert.ok(body.includes('<label><input type="checkbox" name="live" value="on" checked> Make live: riders get v2 at once instead of v1</label>'), body);
    assert.equal(count(text, 'instead of v1'), 1, text);
    // what happens: the outcome first
    assert.match(whatHappens(body)[0], /^v2 of 'Rollers · fast', live for Thu 19 Nov 19:30\. Riders get it from 19:00\.$/);
    assert.ok(whatHappens(body).includes('Ida in'), whatHappens(body).join('\n'));
    assert.match(body, /<details class="card fold"><summary>Riders \(8\)<\/summary>/);
    assert.match(body, /<details class="card fold"><summary>More: race date, event link<\/summary>/);
    assert.ok(text.includes('Race Thu 19 Nov (the plan\'s date)'), 'a version takes the plan\'s date');
    assert.ok(!body.includes('name="date"'));
    // no redraw button: the script redraws the page by itself (decision 13)
    assert.ok(!body.includes('data-redraw') && !body.includes('formmethod') && !text.includes('Update preview'), body);
    assert.ok(body.includes('<button class="btn primary block" type="submit" data-submit>Store and make live</button>'), body);
    assert.ok(body.includes(`<input type="hidden" name="drawn" value="rollers:${live}">`), body);
    assert.ok(body.includes(`<input type="hidden" name="base" value="${version}">`), body);
    assert.ok(body.includes('<input type="hidden" name="touched" value="">'), body);
    // Discard, after the form
    const discard = body.indexOf(`<form method="post" action="/manage/inbox/${id}/discard">`);
    assert.ok(discard > body.indexOf('data-submit'), body);
    assert.ok(textOf(body.slice(discard)).includes('Discard this plan'));
    assert.ok(!body.includes('http-equiv'));
    assert.ok(!body.includes('data-refresh'));
    // the JSON name is never shown
    assert.ok(!text.includes('Rollers other'), text);
    // race day near the start: still no reload
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
    assert.ok(lines.includes('Ben in'), lines.join('\n'));
    assert.ok(lines.indexOf('Ben in') < lines.indexOf('Ben moves from Sprockets to Rollers.'));
    assert.ok(lines.indexOf('Ben moves from Sprockets to Rollers.') < lines.indexOf('Still to do: Sprockets'));
    // all lines of the diff in a fold
    assert.match(page.body, /<details class="fold"><summary>What changed<\/summary><ul><li>Ben in \(1st\)<\/li><\/ul><\/details>/);
    // Store as a new version, no date posted (as the page posts it)
    // a date sent with a version (a stale field) does not move the moves and holes off the plan's race
    const res = await post(srv, c.cookie, `/manage/inbox/${id}`, {team: 'rollers', as: live, live: 'on', type: 'fast', date: '2026-11-26', base: VERSION_OF(srv, 'rollers'), drawn: `rollers:${live}`, touched: '', event: ''});
    assert.equal(res.status, 200, res.body);
    const text = textOf(res.body);
    assert.ok(text.includes('Ben moves from Sprockets to Rollers.'), text);
    assert.ok(text.includes('Still to do: Sprockets'), text);
    assert.ok(text.includes('Ben in'), text);
    const club = srv.store.get(CID);
    assert.equal(club.sheets[club.teams.rollers.live].plan, live);
    assert.equal(club.sheets[club.teams.rollers.live].n, 2);
    assert.equal(club.teams.sprockets.live, sp);
    assert.equal(club.inbox.length, 0);
});


test('assign page: the team hint comes first', async t => {
    const c = makeClub();
    upload(c.club, 'sprockets', {riders: [...ROLLERS.slice(0, 7), '1009'], at: T('2026-11-19T13:00:00Z')});
    const srv = await serve(t, c);
    const id = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers new', ROLLERS)});
    const lines = whatHappens((await assignOf(srv, id)).body);
    assert.equal(lines[0], 'It looks like Sprockets (7 of 8 riders)');
    assert.match(lines[1], /^New plan 'Rollers', live for Thu 19 Nov 19:30\./);
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
    assert.equal(liveChecked(body), false);
    assert.ok(body.includes('<label><input type="checkbox" name="live" value="on"> Make live (pick a plan first)</label>'), body);
    assert.ok(textOf(body).includes('New version of \'Rollers · fast\' live · v1 · 15:00 · 8 of 8 riders the same'), textOf(body));
    assert.ok(textOf(body).includes('New version of \'Rollers · slow\' v1 · 15:10 · 6 of 8 riders the same'), textOf(body));
    assert.ok(textOf(body).includes('New version of \'Rollers · next\' v1 · 15:30 · 4 of 8 riders the same · race Thu 26 Nov'), textOf(body));
    assert.ok(!textOf(body).includes('race Thu 19 Nov'), 'rows of the page\'s race show no day');
    assert.ok(body.includes('<button class="btn primary block" type="submit" data-submit>Store</button>'));
    // Store without a plan
    const sheets = Object.keys(srv.store.get(CID).sheets).length;
    const res = await post(srv, c.cookie, `/manage/inbox/${id}`, {team: 'rollers', live: 'on', base: VERSION_OF(srv, 'rollers'), drawn: 'rollers:'});
    assert.equal(res.status, 400, res.body);
    assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'Pick a plan.'});
    assert.ok(res.body.includes('data-assign'), 'the assign page');
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
    const res = await post(srv, c.cookie, `/manage/inbox/${id}`, {
        team: 'rollers', type: 'tempo', base: VERSION_OF(srv, 'rollers'), drawn: 'rollers:', touched: 'type',
    });
    assert.equal(res.status, 400, res.body);
    assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'Pick a plan.'});
    assert.equal(touchedOf(res.body), 'type');
    assert.equal(typeOf(res.body), 'tempo');
    // the next redraw (New plan) sends it on: the type stays
    const {body} = await assignOf(srv, id, '?team=rollers&as=new&drawn=rollers%3A&type=tempo&touched=type');
    assert.deepEqual(checkedOf(body, 'as'), ['new']);
    assert.equal(typeOf(body), 'tempo');
    assert.equal(touchedOf(body), 'type');
    // only type and live, sorted; anything else is dropped
    assert.equal(touchedOf((await assignOf(srv, id, '?touched=type%2Cx%2Clive%2C%3Cb%3E')).body), 'live,type');
    // a Store for a choice the page was not drawn for (the drawn guard's redraw) carries it too
    const guard = await post(srv, c.cookie, `/manage/inbox/${id}`, {
        team: 'rollers', as: 'new', type: 'tempo', base: VERSION_OF(srv, 'rollers'), drawn: 'rollers:', touched: 'live,type',
    });
    assert.equal(guard.status, 400, guard.body);
    assert.deepEqual(flashOf(guard.body), {kind: 'err', text: 'Check the choices: the preview was for another team or plan.'});
    assert.equal(touchedOf(guard.body), 'live,type');
    assert.equal(typeOf(guard.body), 'tempo');
});


test('assign page: redraw keeps or re-applies the box by drawn', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const id = await intake(srv, c.cookie, {team: 'rollers', forPlan: live, json: planJson('Rollers fast', ROLLERS.slice(1))});
    assert.equal(liveChecked((await assignOf(srv, id)).body), true, 'the default');
    // the same team and plan as drawn, the box left off: it stays off
    const kept = (await assignOf(srv, id, `?team=rollers&as=${live}&drawn=rollers:${live}&type=fast`)).body;
    assert.deepEqual(checkedOf(kept, 'as'), [live]);
    assert.equal(liveChecked(kept), false);
    assert.ok(kept.includes('<button class="btn primary block" type="submit" data-submit>Store</button>'));
    assert.match(whatHappens(kept)[0], /^Stored as v2 of 'Rollers · fast', not live\. Riders keep 'Rollers · fast' v1\.$/);
    // another team: its defaults (Sprockets has no plan: a new plan, live)
    const other = (await assignOf(srv, id, `?team=sprockets&as=${live}&drawn=rollers:${live}`)).body;
    assert.deepEqual(checkedOf(other, 'team'), ['sprockets']);
    assert.deepEqual(checkedOf(other, 'as'), ['new']);
    assert.equal(liveChecked(other), true);
    assert.ok(other.includes('<label><input type="checkbox" name="live" value="on" checked> Make live: riders get this plan; Sprockets has no live plan yet</label>'), other);
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
    const res = await post(srv, c.cookie, `/manage/inbox/${id}`, {team: 'rollers', as: 'new', live: 'on', date: DATE, base: VERSION_OF(srv, 'rollers'), drawn: 'rollers:new'});
    assert.equal(res.status, 200, res.body);
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
    assert.ok(!body.includes('Rollers Thunder'), 'never the JSON name');
    assert.ok(textOf(body).includes('Optional, e.g. fast, slow. Add one now if a second plan may follow. No rider names.'), textOf(body));
    // a typeless plan in the race: a new plan needs a type
    const typeless = await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers Thunder', ROLLERS.slice(0, 5))}, {as: 'new', live: '', type: '', date: DATE});
    assert.ok(textOf(typeless).includes('Stored as v1 of \'Rollers\', not live.'), textOf(typeless));
    const plain = sheetsOf(srv, 'rollers').find(([, s]) => s.type === null)[1].plan;
    const next = await intake(srv, c.cookie, fields);
    const needed = (await assignOf(srv, next, '?team=rollers&as=new&drawn=rollers:new')).body;
    assert.ok(textOf(needed).includes('Needed: Rollers already has a plan without a type for Thu 19 Nov. No rider names.'), textOf(needed));
    assert.ok(whatHappens(needed).includes('Rollers already has a plan for Thu 19 Nov: give this one a type of its own.'), whatHappens(needed).join('\n'));
    const store = choices => post(srv, c.cookie, `/manage/inbox/${next}`, {team: 'rollers', live: '', date: DATE, base: VERSION_OF(srv, 'rollers'), drawn: `rollers:${choices.as}`, ...choices});
    let res = await store({as: 'new', type: ''});
    assert.equal(res.status, 400);
    assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'Rollers already has a plan for Thu 19 Nov: give this one a type of its own.'});
    assert.ok(inboxOf(srv).some(e => e.id === next), 'the entry stays');
    // a new version of the typeless plan may stay typeless
    res = await store({as: plain, type: ''});
    assert.equal(res.status, 200, res.body);
    assert.ok(textOf(res.body).includes('Stored as v2 of \'Rollers\', not live.'), textOf(res.body));
    // a taken type, in other letters
    const third = await intake(srv, c.cookie, fields);
    res = await post(srv, c.cookie, `/manage/inbox/${third}`, {team: 'rollers', as: 'new', type: 'FAST', live: 'on', date: DATE, base: VERSION_OF(srv, 'rollers'), drawn: 'rollers:new'});
    assert.equal(res.status, 400);
    assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'Rollers already has a plan \'FAST\' for Thu 19 Nov: choose another type.'});
    res = await post(srv, c.cookie, `/manage/inbox/${third}`, {team: 'rollers', as: 'new', type: 'steady', live: 'on', date: DATE, base: VERSION_OF(srv, 'rollers'), drawn: 'rollers:new'});
    assert.equal(res.status, 200, res.body);
    assert.match(textOf(res.body), /'Rollers · steady' v1 is live for Thu 19 Nov 19:30\. Plan code [A-Z0-9]{6}\./);
    assert.ok(!res.body.includes('Rollers Thunder'));
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
        const res = await post(srv, c.cookie, `/manage/inbox/${id}`, {drawn: `${sent.team}:${sent.as ?? ''}`, ...sent});
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
    await refused({as: 'zzzzzz', date: DATE}, 'This team or plan no longer exists. Reload the page.');
    // a plan of another team: refused, never stored there
    await refused({as: sp, date: DATE}, 'This team or plan no longer exists. Reload the page.');
    // the refusal page shows what was posted: no plan, though the entry came from fast's page
    const from = await intake(srv, c.cookie, {team: 'rollers', forPlan: fast, json: planJson('Rollers slow', ROLLERS.slice(3))});
    assert.deepEqual(checkedOf((await assignOf(srv, from)).body, 'as'), [fast], 'preselected on the page');
    const none = await post(srv, c.cookie, `/manage/inbox/${from}`, {team: 'rollers', live: 'on', type: 'fast', base: VERSION_OF(srv, 'rollers'), drawn: 'rollers:'});
    assert.equal(none.status, 400);
    assert.deepEqual(flashOf(none.body), {kind: 'err', text: 'Pick a plan.'});
    assert.deepEqual(checkedOf(none.body, 'as'), []);
    assert.equal(liveChecked(none.body), false);
    assert.ok(none.body.includes('<label><input type="checkbox" name="live" value="on"> Make live (pick a plan first)</label>'), none.body);
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
    const res = await post(srv, c.cookie, `/manage/inbox/${id}`, {
        team: 'sprockets', as: 'new', live: 'on', type: '', date: DATE, base: VERSION_OF(srv, 'rollers'), drawn: 'rollers:new', touched: '', event: '',
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
    const ok = await post(srv, c.cookie, `/manage/inbox/${id}`, {
        team: 'sprockets', as: sp, live: 'on', base: VERSION_OF(srv, 'sprockets'), drawn: `sprockets:${sp}`, touched: '', event: '',
    });
    assert.equal(ok.status, 200, ok.body);
    assert.ok(!textOf(ok.body).includes('Someone changed'), textOf(ok.body));
    const club = srv.store.get(CID);
    assert.equal(club.sheets[club.teams.sprockets.live].plan, sp);
    assert.equal(club.sheets[club.teams.sprockets.live].n, 2);
    assert.equal(sheetsOf(srv, 'rollers').length, 0);
    // a missing drawn counts as another choice
    const id2 = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers new', ROLLERS)});
    const bare = await post(srv, c.cookie, `/manage/inbox/${id2}`, {team: 'rollers', as: 'new', live: 'on', date: DATE, base: VERSION_OF(srv, 'rollers')});
    assert.equal(bare.status, 400);
    assert.deepEqual(flashOf(bare.body), {kind: 'err', text: 'Check the choices: the preview was for another team or plan.'});
    assert.equal(sheetsOf(srv, 'rollers').length, 0);
});


test('assign page: the outcome without a start time', async t => {
    const c = makeClub({teams: [['Rollers', '19:30'], ['Cranks', null]]});
    const srv = await serve(t, c);
    const id = await intake(srv, c.cookie, {team: 'cranks', json: planJson('Cranks', ['1001', '1002'])});
    const lines = whatHappens((await assignOf(srv, id)).body);
    assert.equal(lines[0], 'New plan \'Cranks\', live.');
    assert.ok(lines.includes('Cranks has no start time: riders on this plan get nothing.'), lines.join('\n'));
    const body = (await assignOf(srv, id)).body;
    assert.match(body, /<li class="err"><svg[^>]*>[\s\S]*?<\/svg><span>Cranks has no start time: riders on this plan get nothing\.<\/span><\/li>/);
    assert.ok(textOf(body).includes('Race Thu 19 Nov'), 'the day without a start time');
    assert.ok(!textOf(body).includes('Race Thu 19 Nov 1'), 'no time');
    await storeOk(srv, c.cookie, {team: 'cranks', json: planJson('Cranks', ['1001', '1002'])}, {date: DATE});
    const plan = srv.store.get(CID).teams.cranks.live;
    // a new version of the live plan
    const next = await intake(srv, c.cookie, {team: 'cranks', forPlan: plan, json: planJson('Cranks', ['1002', '1001'])});
    const v2 = whatHappens((await assignOf(srv, next)).body);
    assert.equal(v2[0], 'v2 of \'Cranks\', live.');
    assert.ok(v2.includes('Cranks has no start time: riders on this plan get nothing.'));
});


test('store twice: the second finds no entry', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const id = await intake(srv, c.cookie, {team: 'rollers', forPlan: live, json: planJson('Rollers fast', ROLLERS.slice(1))});
    const fields = {team: 'rollers', as: live, live: 'on', type: 'fast', base: VERSION_OF(srv, 'rollers'), drawn: `rollers:${live}`, touched: '', event: ''};
    const first = await post(srv, c.cookie, `/manage/inbox/${id}`, fields);
    assert.equal(first.status, 200, first.body);
    assert.equal(sheetsOf(srv, 'rollers').length, 2);
    const file = storedClub(srv);
    // the same POST again (Store pressed twice, or a stale second tab)
    const second = await post(srv, c.cookie, `/manage/inbox/${id}`, fields);
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
    const gone = await followPost(srv, c.cookie, `/manage/inbox/${id}/discard`, {back: '/manage/team/rollers'});
    assert.deepEqual(gone.flash, {kind: 'err', text: 'This plan is stored or no longer here.'});
    // an entry older than 24 h is gone too
    const old = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS.slice(2))});
    srv.clock.now = NOW + 24 * 3600000 + 1;
    assert.equal((await assignOf(srv, old)).status, 404);
    const late = await post(srv, c.cookie, `/manage/inbox/${old}`, {...fields, base: VERSION_OF(srv, 'rollers')});
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
    assert.ok(page.includes(`<form method="post" action="/manage/inbox/${id}/discard">${CLUB_FIELD}<input type="hidden" name="back" value="/manage/team/rollers">`), page);
    const res = await followPost(srv, c.cookie, `/manage/inbox/${id}/discard`, {back: '/manage/team/rollers'});
    assert.equal(res.location, '/manage/team/rollers');
    assert.deepEqual(res.flash, {kind: 'ok', text: 'Discarded the plan with 8 riders (Ben, Cleo …).'});
    assert.equal(inboxOf(srv).length, 0);
    assert.deepEqual(srv.store.get(CID).log.at(-1), {at: new Date(NOW).toISOString(), what: 'discard', team: 'rollers', label: '8 riders'});
    // anything but /manage or an existing team page goes to /manage
    for (const back of ['https://evil.example.org', '/manage/team/gone', '//evil.example.org', '/manage/settings', '']) {
        const next = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ['1001', '1002'])});
        const r = await followPost(srv, c.cookie, `/manage/inbox/${next}/discard`, {back});
        assert.equal(r.location, '/manage', back);
        assert.deepEqual(r.flash, {kind: 'ok', text: 'Discarded the plan with 2 riders (Ben, Cleo).'});
    }
    const one = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ['1001'])});
    assert.equal((await followPost(srv, c.cookie, `/manage/inbox/${one}/discard`, {back: '/manage'})).flash.text, 'Discarded the plan with 1 rider (Ben).');
    // only POST
    assert.equal((await srv.get(`/manage/inbox/${one}/discard`)).status, 405);
});


test('assign page: the back bar goes where Discard goes, also with another team chosen', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    const id = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS)});
    const discardOf = body => /<form method="post" action="\/manage\/inbox\/[0-9a-z]{6}\/discard">[^]*?<input type="hidden" name="back" value="([^"]*)">/.exec(body)?.[1];
    for (const q of ['', '?team=sprockets&as=new&drawn=sprockets:new']) {
        const {status, body} = await assignOf(srv, id, q);
        assert.equal(status, 200, body);
        assert.equal(discardOf(body), '/manage/team/rollers', q);
        assert.deepEqual(backOf(body), ['/manage/team/rollers', 'Rollers'], q);
    }
});


test('result page: the version, the diff, upload for the hole team with its plan', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ['1002', '1003'], at: T('2026-11-19T14:00:00Z')});
    const sp = upload(c.club, 'sprockets', {riders: ['1001', '1009'], at: T('2026-11-19T14:05:00Z')});
    const srv = await serve(t, c);
    const body = await storeOk(srv, c.cookie, {team: 'rollers', forPlan: live, json: planJson('Rollers fast', ['1001', '1002', '1003'])}, {as: live});
    const club = srv.store.get(CID);
    const v2 = club.teams.rollers.live;
    assert.ok(body.includes('<h1>Plan stored</h1>'), body);
    const text = textOf(body);
    assert.ok(text.includes(`'Rollers · fast' v2 is live for Thu 19 Nov 19:30. Plan code ${club.sheets[v2].sig}.`), text);
    assert.match(body, /<p class="vsum">Ben in<\/p>/);
    assert.ok(body.includes(`href="/manage/upload?team=sprockets&amp;plan=${sp}"`), body);
    assert.equal(count(body, 'Upload for Sprockets'), 1);
    // Wrong file? Back to v1
    assert.ok(textOf(section(body, '<section class="card undocard"')).includes('Wrong file? Back to v1'));

    // with two plans in Sprockets' race the link leaves the plan out: the captain picks
    const d = makeClub();
    const dLive = upload(d.club, 'rollers', {type: 'fast', riders: ['1002', '1003'], at: T('2026-11-19T14:00:00Z')});
    upload(d.club, 'sprockets', {riders: ['1001', '1009'], at: T('2026-11-19T14:05:00Z')});
    upload(d.club, 'sprockets', {type: 'B', riders: ['1009'], at: T('2026-11-19T14:06:00Z'), live: false});
    const srv2 = await serve(t, d);
    const two = await storeOk(srv2, d.cookie, {team: 'rollers', forPlan: dLive, json: planJson('Rollers fast', ['1001', '1002', '1003'])}, {as: dLive});
    assert.ok(two.includes('href="/manage/upload?team=sprockets"'), two);
    assert.ok(!two.includes('team=sprockets&amp;plan='), two);
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
    assert.ok(textOf(body).includes('Team Rollers'), textOf(body));
    const res = await post(srv, c.cookie, `/manage/inbox/${id}`, {team: 'rollers', as: 'new', live: 'on', date: DATE, type: '', base: VERSION_OF(srv, 'rollers'), drawn: 'rollers:new', touched: '', event: ''});
    assert.equal(res.status, 200, res.body);
    assert.ok(srv.store.get(CID).teams.rollers.live);
});


test('upload: live by default for a team without a plan', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    // the date left out: the team's next race
    const body = await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS)});
    const club = srv.store.get(CID);
    const id = club.teams.rollers.live;
    assert.ok(id, 'live');
    const sig = club.sheets[id].sig;
    assert.equal(club.sheets[id].via, 'file');
    assert.equal(club.sheets[id].date, DATE);
    // no type: the label is the team's name
    assert.equal(club.sheets[id].label, 'Rollers');
    assert.equal(club.sheets[id].type, null);
    assert.ok(body.includes('<header class="pagehead"><p class="kicker">Rollers</p><h1>Plan stored</h1></header>'), body);
    assert.match(body, /<a class="back" href="\/manage\/team\/rollers">/);
    const text = textOf(body);
    assert.match(body, /<p class="sevline ok big"><svg[^>]*>[\s\S]*?<\/svg><span>&#39;Rollers&#39; v1 is live for Thu 19 Nov 19:30\. Plan code [A-Z0-9]+\.<\/span><\/p>/);
    assert.ok(text.includes(`'Rollers' v1 is live for Thu 19 Nov 19:30. Plan code ${sig}.`), text);
    assert.ok(body.includes('<p class="vsum">First version of a new plan</p>'), body);
    assert.ok(text.includes('Riders get it from 19:00.'), text);
    // the riders table in plan order: no pull target without watts or W/kg
    const table = /<table class="ptable">([\s\S]*?)<\/table>/.exec(body);
    assert.ok(table, body);
    assert.ok(table[1].includes('<thead><tr><th class="n">#</th><th>Rider</th><th class="n">Pull</th><th class="n">Target</th></tr></thead>'), table[1]);
    const rows = [...table[1].matchAll(/<tr><td class="n">(\d+)<\/td><td class="nmcol">([^<]*)<\/td><td class="n">([^<]*)<\/td><td class="n">([^<]*)<\/td><\/tr>/g)].map(m => m.slice(1));
    assert.deepEqual(rows, ROLLERS.map((aid, i) => [String(i + 1), RIDERS_BY_ID[aid], '60 s', '–']));
    // Wrong file? A new plan that went live: Delete it, behind an in-page confirm that says the team
    // is then left without a live plan
    const wrong = section(body, '<section class="card undocard"');
    const confirm = /<details class="confirm">[\s\S]*?<\/details>/.exec(wrong)?.[0];
    assert.ok(confirm, wrong);
    assert.ok(confirm.includes(`<form method="post" action="/manage/sheet/delete">${CLUB_FIELD}<input type="hidden" name="team" value="rollers"><input type="hidden" name="sheet" value="${id}">`), confirm);
    assert.ok(textOf(wrong).includes('Wrong file? Delete \'Rollers\' Deletes \'Rollers\' with all its versions. Riders get nothing from Rollers until you make another plan live. '
        + 'This cannot be undone. Versions used in a ride recording stay with it for analysis (90 days by default). Delete \'Rollers\''), textOf(wrong));
    assert.ok(!body.includes('/manage/undo'));
    assert.ok(!body.includes('/manage/plan/back'), 'no earlier version to go back to');
    assert.match(body, /<a class="btn quiet" href="\/manage\/team\/rollers"><svg[^>]*>[\s\S]*?<\/svg>Back to Rollers<\/a>/);
    assert.ok(!body.includes('What this changes'), body);
    // the order of the page: status, warnings, Wrong file?, riders, back
    const order = ['is live for', 'No pull watts in this plan', 'action="/manage/sheet/delete"', '<table', 'Back to Rollers'].map(s => body.indexOf(s));
    assert.deepEqual([...order].sort((a, b) => a - b), order, String(order));
    assert.ok(order[0] > 0);
    assert.ok(!body.includes('http-equiv'));
    assert.equal(srv.store.get(CID).inbox.length, 0, 'the entry is used');
});


test('upload result: live, plan code, what changes, wrong file, target', async t => {
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
    const id = club.teams.rollers.live;
    assert.notEqual(id, prev);
    const text = textOf(body);
    assert.ok(text.includes(`'Rollers · fast' v1 is live for Thu 19 Nov 19:30. Plan code ${club.sheets[id].sig}.`), text);
    assert.ok(text.includes('\'Rollers · A\' stays as another plan. Riders get it from 19:00.'), text);
    // what this changes: the move, the hole, and one way to fill it, with Sprockets' only plan
    const effects = section(body, '<section class="card" aria-labelledby="eff-h">');
    assert.ok(textOf(effects).includes('What this changes Ben moves from Sprockets to Rollers. Still to do: Sprockets.'), textOf(effects));
    assert.equal(count(body, 'Upload for Sprockets'), 1);
    assert.match(effects, new RegExp(`<a class="btn secondary block" href="/manage/upload\\?team=sprockets&amp;plan=${sp}"><svg[^>]*>[\\s\\S]*?</svg>Upload for Sprockets</a>`));
    // Wrong file? after a new plan that went live: Delete it, with the warning
    const wrong = section(body, '<section class="card undocard"');
    assert.ok(wrong.includes(`<form method="post" action="/manage/sheet/delete">${CLUB_FIELD}<input type="hidden" name="team" value="rollers"><input type="hidden" name="sheet" value="${id}">`), wrong);
    assert.ok(textOf(wrong).includes('Deletes \'Rollers · fast\' with all its versions. Riders get nothing from Rollers until you make another plan live.'), textOf(wrong));
    // the riders: W/kg first, then the JSON's watts; never the planner's roster (Eva)
    const riders = section(body, '<section class="card" aria-labelledby="rr-h">');
    assert.ok(textOf(riders).includes('Riders 3 riders'), textOf(riders));
    assert.ok(!/bench/i.test(textOf(body)), textOf(body));
    assert.ok(!textOf(riders).includes('Eva'), textOf(riders));
    assert.ok(riders.includes('<tr><td class="n">2</td><td class="nmcol">Cleo</td><td class="n">60 s</td><td class="n">4.2 W/kg</td></tr>'), riders);
    assert.ok(riders.includes('<tr><td class="n">3</td><td class="nmcol">Dan</td><td class="n">60 s</td><td class="n">325 W</td></tr>'), riders);
    assert.ok(riders.includes('<tr><td class="n">1</td><td class="nmcol">Ben</td><td class="n">60 s</td><td class="n">–</td></tr>'), riders);
});


test('upload: stored, not live', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const body = await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers slow', ['1001', '1002', '1003'])}, {as: 'new', live: '', type: 'slow', date: DATE});
    const text = textOf(body);
    assert.ok(text.includes('Stored as v1 of \'Rollers · slow\', not live. Riders keep \'Rollers · fast\' v1.'), text);
    assert.ok(body.includes('<p class="vsum">First version of a new plan</p>'), body);
    const club = srv.store.get(CID);
    assert.equal(club.teams.rollers.live, live);
    const [[id]] = sheetsOf(srv, 'rollers').filter(([i]) => i !== live);
    // Make live for the new plan: it asks first, in the page (Task 8c)
    const ask = /<details class="confirm inline">[\s\S]*?<\/details>/.exec(body)?.[0] ?? '';
    assert.ok(textOf(ask).includes('Make live… Riders get \'Rollers · slow\' v1 at once instead of \'Rollers · fast\' v1.'), textOf(ask));
    assert.ok(ask.includes(`<form method="post" action="/manage/live">${CLUB_FIELD}<input type="hidden" name="team" value="rollers"><input type="hidden" name="sheet" value="${id}"><input type="hidden" name="confirm" value="1"><button class="btn primary small" type="submit">Make live</button></form>`), body);
    assert.ok(!text.includes('is live'));
    // a new plan that did not go live: its Delete has no live warning
    assert.ok(!textOf(section(body, '<section class="card undocard"')).includes('Riders get nothing'), 'no live warning');
    // a team without a live plan
    const none = textOf(await storeOk(srv, c.cookie, {team: 'sprockets', json: planJson('Sprockets', ['1009'])}, {live: '', date: DATE}));
    assert.ok(none.includes('Stored as v1 of \'Sprockets\', not live. Riders get no plan from Sprockets until you press Make live.'), none);
    assert.equal(srv.store.get(CID).teams.sprockets.live, null);
});


test('upload: effects and holes', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const body = await storeOk(srv, c.cookie, {team: 'sprockets', json: planJson('Sprockets', ['1001', '1009'])}, {date: DATE});
    const effects = textOf(section(body, '<section class="card" aria-labelledby="eff-h">'));
    assert.ok(effects.includes('Ben moves from Rollers to Sprockets.'), effects);
    assert.ok(effects.includes('Still to do: Rollers.'), effects);
    assert.ok(effects.indexOf('moves from') < effects.indexOf('Still to do'));
    assert.ok(effects.includes('Upload for Rollers'), effects);
    const plan = srv.store.get(CID).teams.sprockets.live;
    // the same plan again: nothing new, no move lines
    const again = textOf(await storeOk(srv, c.cookie, {team: 'sprockets', json: planJson('Sprockets', ['1001', '1009'])}, {as: plan}));
    assert.ok(again.includes('Same as v1: nothing new stored.'), again);
    assert.ok(!again.includes('moves from'), again);
    // Ben off Sprockets' plan: back to Rollers, and nothing is left to do
    const back = textOf(section(await storeOk(srv, c.cookie, {team: 'sprockets', json: planJson('Sprockets', ['1009'])}, {as: plan}), '<section class="card" aria-labelledby="eff-h">'));
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
    const cranks = srv.store.get(CID).teams.cranks.live;
    assert.match(body, /<li class="err"><svg[^>]*>[\s\S]*?<\/svg><span>Cranks has no start time: riders on this plan get nothing\.<\/span><\/li>/);
    assert.ok(text.includes(`'Cranks' v1 is live. Plan code ${srv.store.get(CID).sheets[cranks].sig}.`), text);
    assert.ok(!text.includes('Riders get it from'), text);
    // no text export ...
    assert.ok(text.includes('No pull watts in this plan: load the text export too, or a JSON with pull power.'), text);
    // ... not with one, and its import warnings (kept with the entry)
    const json = planJson('Cranks', ['1001', '1002']);
    json.riders['1002'].pull_duration = 45;
    text = textOf(await storeOk(srv, c.cookie, {team: 'cranks', json, text: textExport(['1001', '1002'], ['Zed\t250\t30\tBlue\t#0000ff'])}, {as: cranks}));
    assert.ok(!text.includes('No pull watts in this plan'), text);
    assert.ok(text.includes('Pull time for Cleo differs between the files – using the JSON.'), text);
    assert.ok(text.includes('"Zed" from the text export is not in the JSON.'), text);
    // the watts in the riders table
    assert.match(text, /1 Ben 60 s 300 W/);
    // ... nor with pull_power in the JSON (spec §5.2, F13)
    const pp = planJson('Cranks', ['1001', '1002']);
    pp.riders['1001'].pull_power = 310;
    text = textOf(await storeOk(srv, c.cookie, {team: 'cranks', json: pp}, {as: cranks}));
    assert.ok(!text.includes('No pull watts in this plan'), text);
    assert.match(text, /1 Ben 60 s 310 W/);
    // pull_power and a text row that differ: the JSON wins, with a warning (spec §7.8), on the assign
    // page as on the result page
    const fields = {team: 'cranks', json: pp, text: textExport(['1001', '1002'])};
    const id = await intake(srv, c.cookie, fields);
    assert.ok(whatHappens((await assignOf(srv, id)).body).includes('Pull watts for Ben differ between the files – using the JSON.'));
    body = await storeOk(srv, c.cookie, fields, {as: cranks});
    text = textOf(body);
    assert.match(body, /<li class="warn"><svg[^>]*>[\s\S]*?<\/svg><span>Pull watts for Ben differ between the files – using the JSON\.<\/span><\/li>/);
    assert.ok(!text.includes('Pull watts for Cleo'), text);
    assert.match(text, /1 Ben 60 s 310 W/);
    assert.match(text, /2 Cleo 60 s 299 W/);
    // the same watts in both: no warning
    pp.riders['1001'].pull_power = 300;
    text = textOf(await storeOk(srv, c.cookie, {...fields, json: pp}, {as: cranks}));
    assert.ok(!text.includes('Pull watts for'), text);
    // a blank pull_power for every rider and no text export: no watts, so the warning shows (as the
    // mod's import warns)
    const blank = planJson('Cranks', ['1001', '1002']);
    for (const r of Object.values(blank.riders)) {
        r.pull_power = '';
    }
    body = await storeOk(srv, c.cookie, {team: 'cranks', json: blank}, {as: cranks});
    assert.match(body, /<li class="warn"><svg[^>]*>[\s\S]*?<\/svg><span>No pull watts in this plan: load the text export too, or a JSON with pull power\.<\/span><\/li>/);
});


test('upload: event link', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    const ok = textOf(await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS)}, {date: DATE, event: 'https://www.zwift.com/eu/events/view/4567890'}));
    assert.ok(ok.includes('Event link 4567890: the plan goes only to riders in that event.'), ok);
    const club = srv.store.get(CID);
    assert.strictEqual(club.sheets[club.teams.rollers.live].pinnedEventId, 4567890);
    assert.ok(textOf(await (await srv.get('/manage/team/rollers')).text()).includes('Event link 4567890 (yours)'));
    // the assign page with a link that does not parse: no dry run, the text instead
    const id = await intake(srv, c.cookie, {team: 'sprockets', json: planJson('Sprockets', ['1009'])});
    const page = await assignOf(srv, id, '?team=sprockets&as=new&drawn=sprockets:new&event=https%3A%2F%2Fexample.org%2Fx');
    assert.deepEqual(whatHappens(page.body), ['This is not a Zwift or ZwiftPower event link.']);
    assert.ok(page.body.includes('name="event" maxlength="300" inputmode="url" autocomplete="off" value="https://example.org/x"'), page.body);
    // Store with it: refused, nothing stored, the entry stays
    const file = storedClub(srv);
    const res = await post(srv, c.cookie, `/manage/inbox/${id}`, {team: 'sprockets', as: 'new', live: 'on', date: DATE, base: VERSION_OF(srv, 'sprockets'), drawn: 'sprockets:new', event: 'https://example.org/x'});
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
    assert.equal(club.sheets[club.teams.rollers.live].via, 'paste');
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
    const stored = await post(srv, c.cookie, res.headers.get('location'), {team: 'sprockets', as: 'new', live: 'on', date: DATE, base: VERSION_OF(srv, 'sprockets'), drawn: 'sprockets:new'});
    assert.equal(stored.status, 200, stored.body);
    const after = srv.store.get(CID);
    assert.equal(after.sheets[after.teams.sprockets.live].via, 'paste');
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
    assert.equal(club.teams.rollers.live, live);
    assert.deepEqual(club.sheets[live], v1, 'the live version is untouched');
    const versions = sheetsOf(srv, 'rollers');
    assert.equal(versions.length, 2, 'one more version');
    const [[id, v2]] = versions.filter(([i]) => i !== live);
    assert.deepEqual([v2.plan, v2.n, v2.label], [live, 2, 'Rollers · fast']);
    assert.ok(textOf(body).includes('Stored as v2 of \'Rollers · fast\', not live. Riders keep \'Rollers · fast\' v1.'), textOf(body));
    assert.ok(body.includes(`<input type="hidden" name="sheet" value="${id}">`), 'Make live for the new version');
});


test('upload: an empty event field keeps the link of the plan', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-16T09:00:00Z'), pinned: 4567890});
    const srv = await serve(t, c);
    // the pull-time fix on race day: a new version, no link typed: it carries the plan's link
    const body = textOf(await storeOk(srv, c.cookie, {team: 'rollers', forPlan: live, json: planJson('Rollers fast', ROLLERS.slice(0, 7))}, {as: live, event: ''}));
    assert.ok(body.includes('\'Rollers · fast\' v2 is live for Thu 19 Nov 19:30.'), body);
    assert.ok(!body.includes('stays as another plan'), body);
    assert.ok(body.includes('Event link 4567890: the plan goes only to riders in that event.'), body);
    const club = srv.store.get(CID);
    assert.notEqual(club.teams.rollers.live, live);
    assert.equal(club.sheets[club.teams.rollers.live].plan, live);
    assert.strictEqual(club.sheets[club.teams.rollers.live].pinnedEventId, 4567890);
    assert.strictEqual(club.sheets[live].pinnedEventId, 4567890);
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
    const res = await post(srv, c.cookie, `/manage/inbox/${id}`, {team: 'rollers', as: live, type: 'fast', date: DATE, base: VERSION_OF(srv, 'rollers'), drawn: `rollers:${live}`});
    assert.equal(res.status, 200, res.body);
    assert.ok(textOf(res.body).includes('Stored as v2 of \'Rollers · fast\', not live. Riders keep \'Rollers · fast\' v1.'), textOf(res.body));
    const club = srv.store.get(CID);
    assert.equal(club.teams.rollers.live, live);
    assert.deepEqual(Object.keys(club.sheets[live].json.riders), ROLLERS);
    const versions = sheetsOf(srv, 'rollers');
    assert.equal(versions.length, 2, 'one more version');
    assert.ok(versions.every(([, s]) => s.plan === live));
});


test('upload: at most 20 import warnings, then how many more', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    const extra = Array.from({length: 25}, (_, i) => `Nobody ${i}\t1\t60\tRed\t#ff0000`);
    const fields = {team: 'rollers', json: planJson('Rollers fast', ROLLERS), text: textExport(ROLLERS, extra)};
    // the entry keeps 21 of the 25 warnings (Ruling 8) and counts the other 4: 20 shown, then "5 more"
    const id = await intake(srv, c.cookie, fields);
    assert.equal(inboxOf(srv).at(-1).warnings.length, 21);
    assert.equal(inboxOf(srv).at(-1).warningsMore, 4);
    const lines = whatHappens((await assignOf(srv, id)).body);
    assert.equal(lines.filter(l => l.endsWith('from the text export is not in the JSON.')).length, 20);
    assert.equal(lines.at(-1), '… and 5 more import warnings.');
    const body = await storeOk(srv, c.cookie, fields, {date: DATE});
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


test('upload: a huge plan or text export is refused before matching', async t => {
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
    // riders plus the planner's roster count; a long text export alone is refused too
    const bench = {};
    for (let i = 0; i < 35; i++) {
        bench[String(200000 + i)] = {name: `Bench ${i}`};
    }
    const res2 = await postUpload(srv, c.cookie, {team: 'rollers', json: {...planJson('Rollers fast', ROLLERS), roster: bench}});
    assert.deepEqual(flashOf(await res2.text()), {kind: 'err', text: 'A plan holds at most 40 riders, the planner\'s roster included; this one has 43.'});
    const res3 = await postUpload(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS), text: rows.slice(0, 162).join('\n')});
    assert.equal(res3.status, 400);
    assert.deepEqual(flashOf(await res3.text()), {kind: 'err', text: 'This text export has more than 160 rows. Load the text export of this team\'s plan.'});
    assert.equal(JSON.stringify(srv.store.get(CID)), before, 'nothing stored');
    assert.equal(inboxOf(srv).length, 0);
    // 160 rows and the header are fine
    await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS), text: rows.slice(0, 161).join('\n')});
    assert.equal(inboxOf(srv).length, 1);
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
    // without a parse, the file as JSON or as a text export, pasted or loaded
    const SHAPE_TEXT = 'This file holds far more than a planner export. Load the planner\'s JSON or text export of this team\'s plan.';
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
        [{json: planJson('Rollers fast', ROLLERS), text: '['.repeat(4001)}, 'the text export'],
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
    const res = await post(srv, c.cookie, `/manage/inbox/${id}`, {team: 'rollers', as: 'new', live: 'on', date: DATE, base: VERSION_OF(srv, 'rollers'), drawn: 'rollers:new'});
    assert.equal(res.status, 200, res.body);
    const club = srv.store.get(CID);
    assert.equal(Object.keys(club.sheets[club.teams.rollers.live].json.riders).length, 40);
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


test('upload: a JSON array is counted as a text export', async t => {
    // importFiles reads a JSON array of '|' rows as a text export: the 160-row cap holds for it
    const c = makeClub();
    const srv = await serve(t, c);
    const before = JSON.stringify(srv.store.get(CID));
    const rows = JSON.stringify(Array.from({length: 200}, () => '|1|1||')).replace(/","/g, '",\n"');
    const res = await postUpload(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS), text: rows});
    assert.equal(res.status, 400);
    assert.ok(flashOf(await res.text()).text.startsWith('This text export has more than 160 rows.'));
    assert.equal(JSON.stringify(srv.store.get(CID)), before);
    assert.equal(inboxOf(srv).length, 0);
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
    assert.equal(srv.store.get(CID).teams.rollers.live, fast, 'nothing changed yet');

    const yes = await followPost(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: slow, confirm: '1'});
    const club = srv.store.get(CID);
    assert.equal(club.teams.rollers.live, slow);
    assert.equal(club.sheets[slow].uploadedAt, uploadedAt);
    // Ben still rides Sprockets (the newer upload): a hole on Rollers' new live sheet
    assert.deepEqual(yes.flash, {kind: 'ok', text: '\'Rollers · slow\' is live for Rollers. Still to do: Rollers'});
    assert.equal(yes.location, '/manage/team/rollers');
    assert.ok(yes.page.includes('<meta http-equiv="refresh" content="30;url=/manage/team/rollers">'), 'the team page');
    // the live sheet is not outdated: no question
    const again = await followPost(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: slow});
    assert.ok(again.flash?.kind === 'ok', again.page);
    // a sheet of another team, or none
    for (const fields of [{team: 'sprockets', sheet: slow}, {team: 'rollers', sheet: 'zzzzzz'}, {team: '__proto__', sheet: slow}, {}]) {
        const res = await post(srv, c.cookie, '/manage/live', fields);
        assert.equal(res.status, 400, JSON.stringify(fields));
        assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'This team or plan no longer exists. Reload the page.'});
    }
});


test('make live: the flash shows the moves and the holes', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    upload(c.club, 'sprockets', {riders: ['1009'], at: T('2026-11-19T14:05:00Z')});
    const plus = upload(c.club, 'sprockets', {type: 'plus Ben', riders: ['1009', '1001'], at: T('2026-11-19T16:30:00Z'), live: false});
    const srv = await serve(t, c);
    const res = await followPost(srv, c.cookie, '/manage/live', {team: 'sprockets', sheet: plus, confirm: '1'});
    assert.deepEqual(res.flash, {kind: 'ok', text: '\'Sprockets · plus Ben\' is live for Sprockets. Ben moves from Rollers to Sprockets. Still to do: Rollers'});
});


test('back is guarded', async t => {
    const c = makeClub();
    const fast = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS.slice(0, 6))}, {as: fast});
    const after = srv.store.get(CID);
    const added = after.teams.rollers.live;
    assert.notEqual(added, fast);
    // the page was drawn before the upload: refused, nothing changed
    const file = storedClub(srv);
    const old = await post(srv, c.cookie, '/manage/plan/back', {team: 'rollers', plan: fast, n: '1', version: after.teams.rollers.version - 1});
    assert.equal(old.status, 409, old.body);
    assert.deepEqual(flashOf(old.body), {kind: 'err', text: 'Rollers changed since you opened the page. Nothing was changed.'});
    assert.equal(storedClub(srv), file);
    const none = await post(srv, c.cookie, '/manage/plan/back', {team: 'rollers', plan: fast, n: '1'});
    assert.equal(none.status, 409);
    assert.equal(storedClub(srv), file);
    // a team that is gone
    const gone = await post(srv, c.cookie, '/manage/plan/back', {team: 'gone', plan: fast, n: '1', version: '1'});
    assert.equal(gone.status, 400);
    assert.ok(gone.body.includes('This team no longer exists.'));
    assert.equal(storedClub(srv), file);
    // with the page's version (and the confirm a live plan's Back always needs, Task 8c): v3, a copy
    // of v1, live
    const res = await followPost(srv, c.cookie, '/manage/plan/back', {team: 'rollers', plan: fast, n: '1', version: after.teams.rollers.version, confirm: '1'});
    assert.deepEqual(res.flash, {kind: 'ok', text: 'Back to v1: \'Rollers · fast\' v3 is live (was v2).'});
    const club = srv.store.get(CID);
    assert.equal(club.sheets[club.teams.rollers.live].n, 3);
    assert.equal(club.sheets[club.teams.rollers.live].sig, club.sheets[fast].sig);
    assert.ok(Object.hasOwn(club.sheets, added), 'v2 stays');
    // the activity names it
    assert.equal(club.log.at(-1).what, 'back');
    assert.ok(textOf(await (await srv.get('/manage/settings')).text()).includes('Back to an earlier version: \'Rollers · fast v1 → v3\''));
});


test('upload result: Wrong file? after a new version is Back to the one before; nothing after the same file', async t => {
    const c = makeClub();
    const v1 = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const json = planJson('Rollers fast', ROLLERS.slice(1));
    const body = await storeOk(srv, c.cookie, {team: 'rollers', json}, {as: v1});
    const wrong = section(body, '<section class="card undocard"');
    assert.ok(textOf(wrong).includes('Wrong file? Back to v1… Riders get v1 at once instead of v2.'), textOf(wrong));
    // v2 went live: Back changes what riders get, so it asks first in the page (Task 8c)
    assert.ok(wrong.includes('<details class="confirm inline">'), wrong);
    assert.ok(wrong.includes(`<form method="post" action="/manage/plan/back">${CLUB_FIELD}<input type="hidden" name="team" value="rollers"><input type="hidden" name="plan" value="${v1}">`
        + `<input type="hidden" name="n" value="1"><input type="hidden" name="version" value="${VERSION_OF(srv, 'rollers')}"><input type="hidden" name="confirm" value="1"><button`), wrong);
    assert.ok(!wrong.includes('/manage/sheet/delete'));
    // the same file again: nothing to take back
    const same = await storeOk(srv, c.cookie, {team: 'rollers', json}, {as: v1});
    assert.ok(textOf(same).includes('Same as v2: nothing new stored.'), textOf(same));
    assert.ok(!same.includes('undocard'));
    assert.ok(!same.includes('/manage/plan/back'));
    assert.ok(!same.includes('Wrong file?'));
    const res = await followPost(srv, c.cookie, '/manage/plan/back', {team: 'rollers', plan: v1, n: '1', version: String(VERSION_OF(srv, 'rollers')), confirm: '1'});
    assert.equal(res.location, '/manage/team/rollers');
    assert.deepEqual(res.flash, {kind: 'ok', text: 'Back to v1: \'Rollers · fast\' v3 is live (was v2).'});
});


test('upload result: no Back after a version of the live plan stored not live; Back stays for a plan that is not live', async t => {
    const c = makeClub();
    const v1 = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ['1001', '1002'], at: T('2026-11-19T14:10:00Z'), live: false});
    const srv = await serve(t, c);
    // v1 live, v2 stored with Make live unticked: riders still have v1, nothing to take back
    const body = await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS.slice(1))}, {as: v1, live: undefined});
    assert.equal(srv.store.get(CID).teams.rollers.live, v1);
    assert.ok(textOf(body).includes('Stored as v2 of \'Rollers · fast\', not live.'), textOf(body));
    assert.ok(!body.includes('undocard'), body);
    assert.ok(!body.includes('/manage/plan/back'), body);
    assert.ok(!textOf(body).includes('Back to v1'), textOf(body));
    // v3 not live either: Back to v2 would make v2 live, which never was; still nothing
    const v3 = await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS.slice(2))}, {as: v1, live: undefined});
    assert.equal(srv.store.get(CID).teams.rollers.live, v1);
    assert.ok(!v3.includes('/manage/plan/back'), v3);
    assert.ok(!textOf(v3).includes('Back to v2'), textOf(v3));
    // a plan that is not live: Back to v1 undoes the upload (its newest goes back), without a confirm
    const off = await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers slow', ['1001', '1003'])}, {as: slow, live: undefined});
    const wrong = section(off, '<section class="card undocard"');
    assert.ok(textOf(wrong).includes('Wrong file? Back to v1'), textOf(wrong));
    assert.ok(wrong.includes('/manage/plan/back'), wrong);
    assert.ok(!wrong.includes('<details class="confirm inline">'), wrong);
});


test('delete and unpin', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z'), pinned: 4567890});
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ['1001', '1002'], at: T('2026-11-19T14:10:00Z'), live: false});
    const sp = upload(c.club, 'sprockets', {riders: ['1009'], at: T('2026-11-19T16:30:00Z')});
    const srv = await serve(t, c);
    const unpin = await followPost(srv, c.cookie, '/manage/sheet/unpin', {team: 'rollers', sheet: live});
    assert.deepEqual(unpin.flash, {kind: 'ok', text: 'Removed the event link of \'Rollers · fast\'.'});
    assert.equal(srv.store.get(CID).sheets[live].pinnedEventId, null);
    assert.equal(unpin.location, '/manage/team/rollers');
    assert.ok(unpin.page.includes('<h1>Rollers</h1>'));
    assert.ok(!textOf(unpin.page).includes('Event link 4567890'), 'the team page shows no link');
    const del = await followPost(srv, c.cookie, '/manage/sheet/delete', {team: 'rollers', sheet: slow});
    assert.deepEqual(del.flash, {kind: 'ok', text: 'Deleted \'Rollers · slow\' with its versions.'});
    assert.ok(!Object.hasOwn(srv.store.get(CID).sheets, slow));
    // another team's sheet, a deleted one: refused, nothing changed
    const file = storedClub(srv);
    for (const [p, fields] of [['/manage/sheet/delete', {team: 'rollers', sheet: sp}], ['/manage/sheet/delete', {team: 'rollers', sheet: slow}],
        ['/manage/sheet/unpin', {team: 'rollers', sheet: sp}], ['/manage/sheet/unpin', {team: 'gone', sheet: live}]]) {
        const res = await post(srv, c.cookie, p, fields);
        assert.equal(res.status, 400, p);
        assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'This team or plan no longer exists. Reload the page.'});
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


test('remove a rider', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    upload(c.club, 'sprockets', {riders: ['1009'], bench: ['1001'], at: T('2026-11-19T16:30:00Z')});
    const srv = await serve(t, c);
    srv.see('1001', '2026-11-19T18:00:00Z', {sig: c.club.sheets[live].sig, mod: '0.3.0', sheet: live, inEvent: false, event: null});
    srv.see('1002', '2026-11-19T18:00:00Z', {sig: c.club.sheets[live].sig, mod: '0.3.0', sheet: live, inEvent: false, event: null});
    assert.ok(Object.hasOwn(srv.store.seenOf(CID), '1001'));
    const res = await followPost(srv, c.cookie, '/manage/rider/remove', {zwiftId: ' 1001 '});
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
    const one = await followPost(srv, c.cookie, '/manage/rider/remove', {zwiftId: '1009'});
    assert.deepEqual(one.flash, {kind: 'ok', text: 'Removed from 1 plan.'});
    // again: removed in full already, nothing of his since (coordinator ruling, 19 Nov 2026: no
    // "0 plans", no second line, mail or pass)
    const none = await followPost(srv, c.cookie, '/manage/rider/remove', {zwiftId: '1001'});
    assert.deepEqual(none.flash, {kind: 'ok', text: 'This rider was removed already, and nothing of theirs was stored since.'});
    const file = storedClub(srv);
    for (const zwiftId of ['abc', '', '1234567890123', '-1']) {
        const bad = await post(srv, c.cookie, '/manage/rider/remove', {zwiftId});
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
    assert.ok(page.includes('<form method="post" action="/manage/logs/delete">'));

    // no download for captains (17 Nov 2026): every GET under /manage/logs/ is an unknown path, 404,
    // with a valid club session, for this club's file and for anything else
    for (const p of [`rollers/${name}`, `%72ollers/${name.replace('.', '%2E')}`, `spokes/${name}`, `..%2Fp2m8c4t1v9%2Fspokes/${name}`,
        `rollers/..%2F..%2Fp2m8c4t1v9%2Fspokes%2F${name}`, `rollers/..%2F..%2F..%2Fcircles%2F${CID}.json`, `rollers/${name}x`, 'rollers/%E0%A4%A',
        `rollers/${T('2026-11-12T18:31:00Z')}-1003.jsonl.gz`]) {
        const r = await srv.get(`/manage/logs/${p}`);
        assert.equal(r.status, 404, p);
        assert.equal(await r.text(), 'not found', p);
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
    const del = await followPost(srv, c.cookie, '/manage/logs/delete', {slug: 'rollers', file: name});
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
        ['/manage/plan/back', {team: 'rollers', plan: live, n: '1', version}],
        ['/manage/sheet/delete', {team: 'rollers', sheet: live}],
        ['/manage/sheet/unpin', {team: 'rollers', sheet: live}],
        ['/manage/team', {action: 'add', name: 'Cranks', start: ''}],
        ['/manage/team', {action: 'rename', team: 'rollers', name: 'Rollers Elite'}],
        ['/manage/team', {action: 'start', team: 'rollers', start: ''}],
        ['/manage/team', {action: 'kind', team: 'rollers', kind: 'special', weekday: ''}],
        ['/manage/team', {action: 'delete', team: 'rollers'}],
        ['/manage/club', {name: 'Kettenfett Racing', tz: 'UTC'}],
        ['/manage/rider/remove', {zwiftId: '1001'}],
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
    // Store and Discard on the assign page: the same gate; the entry stays as it is
    const id = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS.slice(1))});
    const entry = JSON.stringify(inboxOf(srv));
    const withEntry = storedClub(srv);
    const store = {team: 'rollers', as: live, live: 'on', base: String(VERSION_OF(srv, 'rollers')), drawn: `rollers:${live}`};
    for (const [p, fields] of [[`/manage/inbox/${id}`, store], [`/manage/inbox/${id}/discard`, {back: '/manage/team/rollers'}]]) {
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
    // a GET of the Store path is the assign page, and changes nothing; Discard is POST only
    assert.equal((await srv.get(`/manage/inbox/${id}?${new URLSearchParams(store)}`)).status, 200);
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
    const res = await followPost(srv, c.cookie, '/manage/rider/remove', {zwiftId: '1002'});
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
        refused = await quiet500(srv, c.cookie, '/manage/rider/remove', {zwiftId: '1002'});
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
        refused = await quiet500(srv, c.cookie, '/manage/rider/remove', {zwiftId: '1002'});
    } finally {
        undoSeen();
    }
    assert.equal(refused.status, 500);
    assert.deepEqual(archiveOf(srv, 'rollers'), kept);
    assert.ok(listed());
    assert.ok(storedClub(srv).includes('"1002"'));
    assert.ok(Object.hasOwn(srv.store.seenOf(CID), '1002'));
    assert.deepEqual(dbRows(srv.server.db, 'SELECT athlete FROM seen WHERE cid = ?', CID), [{athlete: '1002'}]);

    const res = await followPost(srv, c.cookie, '/manage/rider/remove', {zwiftId: '1002'});
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
        refused = await quiet500(srv, c.cookie, '/manage/team', {action: 'delete', team: 'rollers'});
    } finally {
        undo();
    }
    assert.equal(refused.status, 500);
    assert.deepEqual(retired(), []);
    assert.ok(Object.hasOwn(srv.store.get(CID).teams, 'rollers'));
    assert.equal(srv.store.slugTaken('rollers'), true, 'the team itself still holds it');

    const del = await post(srv, c.cookie, '/manage/team', {action: 'delete', team: 'rollers'});
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
        refused = await post(srv, c.cookie, '/manage/sheet/delete', {team: 'rollers', sheet: slow});
    } finally {
        console.error = error;
        undo();
    }
    assert.equal(refused.status, 500);
    assert.ok(Object.hasOwn(srv.store.get(CID).sheets, slow));
    assert.ok(storedClub(srv).includes(`"${slow}"`));
    assert.deepEqual(archiveOf(srv, 'rollers'), {});
    const del = await followPost(srv, c.cookie, '/manage/sheet/delete', {team: 'rollers', sheet: slow});
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
    const res = await followPost(srv, c.cookie, '/manage/rider/remove', {zwiftId: '1002'});
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
        res = await followPost(srv, c.cookie, '/manage/rider/remove', {zwiftId: '1002'});
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
    const again = await followPost(srv, c.cookie, '/manage/rider/remove', {zwiftId: '1002'});
    assert.deepEqual(again.flash, {kind: 'ok', text: 'Removed from 1 recording.'});
    assert.ok(!gunzipSync(fs.readFileSync(danFile)).toString().includes('1002'));
    assert.equal(lines().length, 1, 'the retry runs the pending entry again, no new line');
    const last = await followPost(srv, c.cookie, '/manage/rider/remove', {zwiftId: '1002'});
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
    const old = await post(srv, cookie, '/manage/rider/remove', {club: undefined, zwiftId: '1001'});
    assert.equal(old.status, 409);
    assert.deepEqual(flashOf(old.body), {kind: 'err', text: 'This page was out of date. Nothing was changed.'});
    assert.ok(ridersOf(srv, BID).includes('1001'));
    // B's own page acts on B; its Log out drops B only
    const ok = await post(srv, cookie, '/manage/rider/remove', {club: BID, zwiftId: '1001'});
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
        ['/manage/rider/remove', {club: BID, zwiftId: '1001'}], ['/manage/logout', {club: CID}],
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
