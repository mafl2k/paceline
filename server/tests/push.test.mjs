// The ZwiftGopher push (push.mjs): the upload page's "Plan on ZwiftGopher" link with its short-lived
// token, POST /api/v3/push, the received plans on the team page, the picker and the sidebar, the
// assign page, "New ZwiftGopher link", and the inbox rules for received entries (club.mjs).
// Tokens are computed here on their own from the secret in paceline.db, as the contract says.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {planJson, clubJson, seedDb} from './helpers.mjs';
import {CID, NOW, SETUP_AT, ROLLERS, makeClub, serve, textOf, count, post, followPost, intake, upload} from './manage-helpers.mjs';
import {
    addEntry, receiveEntry, entryOf, sweepInbox, ClubError, INBOX_MAX, INBOX_KEEP_MS, RECEIVE_KEEP_MS, deleteTeam, plannerName,
} from '../club.mjs';
import http from 'node:http';
import {randomId} from '../ids.mjs';
import {assignChoices} from '../preselect.mjs';

const ENV = {PUBLIC_URL: 'https://paceline.example.org'};
const WEEK_S = 7 * 24 * 3600;
const ZG = 'https://zwiftgopher.com';


function secretOf(srv) {
    const secret = srv.server.db.meta('push_secret');
    assert.match(secret ?? '', /^[0-9a-f]{64}$/, 'a push secret in paceline.db');
    return secret;
}


// The contract: 8 hex of the expiry (unix s), then HMAC-SHA256(secret, push:<cid>:<slug>:<gen>:<expiry>)
// cut to 128 bit.
function tokenFor(secret, slug, {gen = 0, expiry = Math.floor(NOW / 1000) + WEEK_S, cid = CID} = {}) {
    const mac = crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(`push:${cid}:${slug}:${gen}:${expiry}`).digest();
    return expiry.toString(16).padStart(8, '0') + mac.subarray(0, 16).toString('hex');
}


// POST /api/v3/push. `token` goes in the query unless `query` is false; `headers` add to the JSON type.
async function push(srv, token, body, {headers = {}, query = true} = {}) {
    const res = await fetch(`${srv.base}/api/v3/push${query && token !== null ? `?paceline=${token}` : ''}`, {
        method: 'POST', headers: {'content-type': 'application/json', ...headers},
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let obj = null;
    try {
        obj = JSON.parse(text);
    } catch {
        // not JSON: obj stays null
    }
    return {status: res.status, headers: res.headers, json: obj, text};
}


const plan = (name = 'Rollers fast', riders = ROLLERS.slice(0, 6)) => planJson(name, riders);

// The "Plan on ZwiftGopher" link of a page, or null.
const plannerOf = body => /<a class="btn secondary block" href="([^"]*)" target="_blank" rel="noopener noreferrer">/.exec(body)?.[1]
    .replaceAll('&amp;', '&') ?? null;

async function pageOf(srv, cookie, p) {
    const res = await srv.get(p, cookie);
    const body = await res.text();
    assert.equal(res.status, 200, body);
    return body;
}


test('push: the upload page links to the planner with a fresh token; none without PUBLIC_URL', async t => {
    const kf = makeClub();
    const srv = await serve(t, kf, {env: ENV});
    const secret = secretOf(srv);
    const body = await pageOf(srv, kf.cookie, '/manage/upload?team=rollers');
    const href = plannerOf(body);
    assert.equal(href, `https://zwiftgopher.com/TTT/?paceline=${tokenFor(secret, 'rollers')}&plhost=paceline.example.org`);
    // above the file input, with its hint
    assert.ok(body.indexOf('Plan on ZwiftGopher') < body.indexOf('name="json"'));
    assert.match(textOf(body), /Make the plan there and it comes back here to be stored\. The link works for 7 days\./);
    // another team has another token
    const other = plannerOf(await pageOf(srv, kf.cookie, '/manage/upload?team=sprockets'));
    assert.equal(other, `https://zwiftgopher.com/TTT/?paceline=${tokenFor(secret, 'sprockets')}&plhost=paceline.example.org`);
    assert.notEqual(new URL(other).searchParams.get('paceline'), new URL(href).searchParams.get('paceline'));

    const bare = makeClub();
    const none = await serve(t, bare);
    const page = await pageOf(none, bare.cookie, '/manage/upload?team=rollers');
    assert.equal(plannerOf(page), null);
    assert.doesNotMatch(page, /Plan on ZwiftGopher/);
    assert.doesNotMatch(await pageOf(none, bare.cookie, '/manage/team/rollers/settings'), /New ZwiftGopher link/);
});


test('push: a plan lands in the team\'s inbox, never live; 201 with the club, team and review page', async t => {
    const kf = makeClub();
    const srv = await serve(t, kf, {env: ENV});
    const token = tokenFor(secretOf(srv), 'rollers');
    const res = await push(srv, token, plan(), {headers: {origin: ZG}});
    assert.equal(res.status, 201, res.text);
    assert.deepEqual(res.json, {ok: true, club: 'Kettenfett RC', team: 'Rollers', review: 'https://paceline.example.org/manage/team/rollers'});
    assert.equal(res.headers.get('access-control-allow-origin'), ZG);
    const c = srv.store.get(CID);
    assert.equal(c.inbox.length, 1);
    const [entry] = c.inbox;
    assert.deepEqual([entry.source, entry.via, entry.team, entry.forPlan], ['receive', 'zwiftgopher', 'rollers', null]);
    assert.deepEqual(Object.keys(entry.json.riders), ROLLERS.slice(0, 6));
    assert.equal(c.teams.rollers.live, null, 'nothing live');
    assert.equal(Object.keys(c.sheets).length, 0, 'nothing stored');

    // text/plain is taken too (a simple request, no preflight); the header carries the token as well
    const plain = await push(srv, null, plan('Rollers slow'), {headers: {'content-type': 'text/plain;charset=UTF-8', 'x-paceline-token': token}, query: false});
    assert.equal(plain.status, 201, plain.text);
    // the query wins over the header
    const both = await push(srv, token, plan(), {headers: {'x-paceline-token': tokenFor(secretOf(srv), 'sprockets')}});
    assert.equal(both.status, 201);
    assert.deepEqual(srv.store.get(CID).inbox.map(e => e.team), ['rollers', 'rollers', 'rollers']);
});


test('push: a token for one team never resolves to another; unknown and forged tokens 404', async t => {
    const kf = makeClub();
    const srv = await serve(t, kf, {env: ENV});
    const secret = secretOf(srv);
    assert.equal((await push(srv, tokenFor(secret, 'sprockets'), plan())).status, 201);
    assert.deepEqual(srv.store.get(CID).inbox.map(e => e.team), ['sprockets']);
    const rollers = tokenFor(secret, 'rollers');
    const forged = [
        tokenFor('0'.repeat(64), 'rollers'),                 // another secret
        tokenFor(secret, 'rollers', {cid: 'p2m8c4t1v9'}),    // another club
        tokenFor(secret, 'rollers', {gen: 1}),               // a generation not reached
        (Math.floor(NOW / 1000) + WEEK_S + 1).toString(16) + rollers.slice(8),   // a later expiry, same MAC
        rollers.slice(0, 39) + (rollers.endsWith('0') ? '1' : '0'),
        rollers.toUpperCase(), rollers.slice(0, 32), 'nonsense',
    ];
    for (const token of forged) {
        const res = await push(srv, token, plan());
        assert.equal(res.status, 404, token);
        assert.deepEqual(res.json, {error: 'unknown-token'});
    }
    const none = await push(srv, null, plan(), {query: false});
    assert.deepEqual([none.status, none.json], [404, {error: 'unknown-token'}]);
    assert.equal(srv.store.get(CID).inbox.length, 1);
});


test('push: valid up to its expiry, 410 from then on', async t => {
    const kf = makeClub();
    const srv = await serve(t, kf, {env: ENV});
    const expiry = Math.floor(NOW / 1000) + WEEK_S;
    const token = tokenFor(secretOf(srv), 'rollers', {expiry});
    srv.clock.now = (expiry - 1) * 1000;
    assert.equal((await push(srv, token, plan())).status, 201);
    for (const at of [expiry * 1000, (expiry + 1) * 1000]) {
        srv.clock.now = at;
        const res = await push(srv, token, plan());
        assert.deepEqual([res.status, res.json], [410, {error: 'expired'}]);
    }
    // a link from the page now works again
    const href = plannerOf(await pageOf(srv, kf.cookie, '/manage/upload?team=rollers'));
    assert.equal((await push(srv, new URL(href).searchParams.get('paceline'), plan())).status, 201);
});


test('push: New ZwiftGopher link ends every link of the team, a fresh one too; the others stay', async t => {
    const kf = makeClub();
    const srv = await serve(t, kf, {env: ENV});
    const settings = await pageOf(srv, kf.cookie, '/manage/team/rollers/settings');
    assert.match(settings, /New ZwiftGopher link/);
    const fresh = new URL(plannerOf(await pageOf(srv, kf.cookie, '/manage/upload?team=rollers'))).searchParams.get('paceline');
    const sprockets = tokenFor(secretOf(srv), 'sprockets');
    const done = await followPost(srv, kf.cookie, '/manage/team', {action: 'push-link', team: 'rollers'});
    assert.equal(done.location, '/manage/team/rollers/settings');
    assert.deepEqual(done.flash, {kind: 'ok', text: 'Rollers has a new ZwiftGopher link. Every earlier link no longer works.'});
    assert.equal(srv.store.get(CID).teams.rollers.pushGen, 1);
    assert.equal(srv.store.get(CID).log.at(-1).what, 'push-link');
    assert.deepEqual((await push(srv, fresh, plan())).json, {error: 'unknown-token'});
    assert.equal((await push(srv, tokenFor(secretOf(srv), 'rollers', {gen: 1}), plan())).status, 201);
    assert.equal((await push(srv, sprockets, plan())).status, 201, 'another team keeps its links');
    // a rename keeps the links (the slug stays)
    await followPost(srv, kf.cookie, '/manage/team', {action: 'rename', team: 'rollers', name: 'Rolling Thunder'});
    assert.equal((await push(srv, tokenFor(secretOf(srv), 'rollers', {gen: 1}), plan())).status, 201);
});


test('push: the secret survives a restart, so a link handed out before still works', async () => {
    const {createServer} = await import('../server.mjs');
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paceline-push-'));
    const kf = makeClub();
    seedDb(dataDir, ({store}) => store.create(kf.club));
    const running = [];
    const start = async () => {
        const log = console.log;
        console.log = () => {};
        const server = createServer({env: {DATA_DIR: dataDir, ...ENV}, now: () => NOW});
        console.log = log;
        running.push(server);
        await new Promise(r => server.listen(0, '127.0.0.1', r));
        return {server, base: `http://127.0.0.1:${server.address().port}`};
    };
    const stop = async s => {
        running.splice(running.indexOf(s.server), 1);
        s.server.closeAllConnections();
        await new Promise(r => s.server.close(r));
    };
    try {
        const a = await start();
        const secret = a.server.db.meta('push_secret');
        assert.match(secret ?? '', /^[0-9a-f]{64}$/);
        await stop(a);
        const b = await start();
        assert.equal(b.server.db.meta('push_secret'), secret, 'the same secret');
        const res = await push(b, tokenFor(secret, 'rollers'), plan());
        assert.equal(res.status, 201, res.text);
        await stop(b);
    } finally {
        for (const server of running) {
            server.closeAllConnections();
            server.close();
        }
        fs.rmSync(dataDir, {recursive: true, force: true});
    }
});


test('push: a club stored by 0.3.1 (no pushGen) loads unchanged and its links work at generation 0', async t => {
    const kf = makeClub();
    assert.equal(Object.hasOwn(kf.club.teams.rollers, 'pushGen'), false);
    const srv = await serve(t, kf, {env: ENV, beforeStart: true});
    const before = clubJson(srv.server.db, CID);
    assert.equal(before.includes('pushGen'), false);
    assert.equal((await pageOf(srv, kf.cookie, '/manage/upload?team=rollers')).includes(tokenFor(secretOf(srv), 'rollers')), true);
    assert.equal(clubJson(srv.server.db, CID), before, 'drawing the link writes nothing');
    assert.equal((await push(srv, tokenFor(secretOf(srv), 'rollers'), plan())).status, 201);
});


test('push: refusals as for an upload (400), too large 413, wrong type 415, nothing stored', async t => {
    const kf = makeClub();
    const srv = await serve(t, kf, {env: ENV});
    const token = tokenFor(secretOf(srv), 'rollers');
    const cases = [
        ['{"team": ', 'bad-json'],
        ['[1, 2]', 'bad-json'],
        [{team: {name: 'Rollers'}}, 'not-a-plan'],
        ['['.repeat(40), 'too-complex'],
        [planJson('Rollers', Array.from({length: 41}, (_, i) => String(2000 + i))), 'cap-riders'],
    ];
    for (const [body, code] of cases) {
        const res = await push(srv, token, body);
        assert.equal(res.status, 400, `${code}: ${res.text}`);
        assert.equal(res.json.error, code);
        assert.equal(typeof res.json.message, 'string');
    }
    const long = plan();
    long.riders['1001'].name = 'B'.repeat(101);
    assert.equal((await push(srv, token, long)).json.error, 'long-name');
    const big = await push(srv, token, JSON.stringify({...plan(), pad: 'x'.repeat(256 * 1024)}));
    assert.deepEqual([big.status, big.json], [413, {error: 'too-large'}]);
    const form = await push(srv, token, plan(), {headers: {'content-type': 'application/x-www-form-urlencoded'}});
    assert.deepEqual([form.status, form.json], [415, {error: 'content-type'}]);
    assert.equal(srv.store.get(CID).inbox.length, 0);
    const get = await fetch(`${srv.base}/api/v3/push?paceline=${token}`);
    assert.equal(get.status, 405);
});


test('push: 30 per team and hour, 60 failed tries per public address (valid pushes never count), 503 while both push slots are taken', async t => {
    const kf = makeClub();
    const srv = await serve(t, kf, {env: {...ENV, TRUSTED_PROXY_HOPS: '1'}});
    const rollers = tokenFor(secretOf(srv), 'rollers');
    const sprockets = tokenFor(secretOf(srv), 'sprockets');
    const from = n => ({'x-forwarded-for': `203.0.113.${n}`});
    for (let i = 0; i < 30; i++) {
        assert.equal((await push(srv, rollers, '{', {headers: from(i)})).status, 400, `push ${i + 1}`);
    }
    const over = await push(srv, rollers, plan(), {headers: from(99)});
    assert.deepEqual([over.status, over.json, over.headers.get('retry-after')], [429, {error: 'rate-limit'}, '3600']);
    assert.equal((await push(srv, sprockets, plan(), {headers: from(99)})).status, 201, 'per team');
    srv.clock.now = NOW + 3600 * 1000;
    assert.equal((await push(srv, rollers, plan(), {headers: from(98)})).status, 201, 'an hour later');

    // per address: valid pushes don't count (ZwiftGopher's server posts for every club)
    srv.clock.now = NOW + 2 * 3600 * 1000;
    const teams = ['rollers', 'sprockets'];
    for (let i = 0; i < 60; i++) {
        assert.equal((await push(srv, tokenFor(secretOf(srv), teams[i % 2]), '{', {headers: from(6)})).status, 400, `valid ${i + 1}`);
    }
    assert.equal((await push(srv, 'e'.repeat(40), plan(), {headers: from(6)})).status, 404, 'after 60 valid pushes the address is not limited');
    // failed tries count: 60 unknown tokens, then even a valid one waits (a new hour: the loop above
    // used up both teams' 30)
    srv.clock.now = NOW + 3 * 3600 * 1000;
    for (let i = 0; i < 60; i++) {
        assert.equal((await push(srv, 'f'.repeat(40), plan(), {headers: from(7)})).status, 404);
    }
    assert.equal((await push(srv, sprockets, plan(), {headers: from(7)})).status, 429);

    // a captain's upload in flight takes nothing from a push (coordinator, 19 Nov 2026: own slots)
    assert.equal(srv.server.web.sheetUploads.take(CID), 'ok');
    assert.equal((await push(srv, sprockets, plan(), {headers: from(8)})).status, 201, 'the upload slot is not the push\'s');
    srv.server.web.sheetUploads.release(CID);
    // two pushes in flight on the server: the third waits
    const slots = srv.server.push.slots;
    assert.deepEqual([slots.take('p2m8c4t1v9'), slots.take('x9x9x9x9x9')], ['ok', 'ok']);
    const busy = await push(srv, sprockets, plan(), {headers: from(9)});
    assert.deepEqual([busy.status, busy.json, busy.headers.get('retry-after')], [503, {error: 'busy'}, '5']);
    slots.release('x9x9x9x9x9');
    assert.equal(slots.take(CID), 'ok');
    assert.equal((await push(srv, sprockets, plan(), {headers: from(10)})).status, 503, 'one per club');
    slots.release(CID);
    slots.release('p2m8c4t1v9');
});


test('push: a full inbox (20) refuses with 409 and keeps what waits', async t => {
    const kf = makeClub();
    const srv = await serve(t, kf, {env: ENV});
    srv.store.change(CID, c => {
        for (let i = 0; i < INBOX_MAX; i++) {
            addEntry(c, {source: 'upload', team: 'sprockets', json: planJson('Sprockets', ['1001']), text: null}, {now: NOW - i, newId: () => randomId(6)});
        }
    });
    const ids = srv.store.get(CID).inbox.map(e => e.id);
    const res = await push(srv, tokenFor(secretOf(srv), 'rollers'), plan());
    assert.equal(res.status, 409);
    assert.equal(res.json.error, 'inbox-full');
    assert.deepEqual(srv.store.get(CID).inbox.map(e => e.id), ids);
});


test('push: CORS preflight for zwiftgopher.com only', async t => {
    const kf = makeClub();
    const srv = await serve(t, kf, {env: ENV});
    const pre = origin => fetch(`${srv.base}/api/v3/push?paceline=x`, {
        method: 'OPTIONS', headers: {origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-paceline-token'},
    });
    for (const origin of [ZG, 'https://www.zwiftgopher.com']) {
        const res = await pre(origin);
        assert.equal(res.status, 204);
        assert.equal(res.headers.get('access-control-allow-origin'), origin);
        assert.equal(res.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
        assert.equal(res.headers.get('access-control-allow-headers'), 'Content-Type, X-Paceline-Token');
        assert.equal(res.headers.get('access-control-allow-credentials'), null);
    }
    for (const origin of ['https://evil.example', 'http://zwiftgopher.com', 'https://zwiftgopher.com.evil.example']) {
        const res = await pre(origin);
        assert.equal(res.headers.get('access-control-allow-origin'), null, origin);
        assert.equal(res.headers.get('access-control-allow-methods'), null, origin);
    }
    // the answers too
    const other = await push(srv, tokenFor(secretOf(srv), 'rollers'), plan(), {headers: {origin: 'https://evil.example'}});
    assert.equal(other.headers.get('access-control-allow-origin'), null);
    // the rider check keeps its own preflight
    const rider = await fetch(`${srv.base}/api/v3/rider/1001`, {method: 'OPTIONS'});
    assert.equal(rider.headers.get('access-control-allow-origin'), '*');
});


test('push: the team page lists every received plan, newest first; picker and sidebar count them', async t => {
    const kf = makeClub();
    const srv = await serve(t, kf, {env: ENV});
    // a link drawn 20 minutes ago
    const token = tokenFor(secretOf(srv), 'rollers', {expiry: Math.floor(NOW / 1000) - 20 * 60 + WEEK_S});
    // an upload waiting for the team is no received plan
    await intake(srv, kf.cookie, {team: 'rollers', json: planJson('Rollers', ['1001'])});
    srv.clock.now = NOW - 20 * 60000;
    assert.equal((await push(srv, token, plan('Rollers &amp; <b>fast</b>'))).status, 201);
    srv.clock.now = NOW - 5 * 60000;
    assert.equal((await push(srv, token, plan('Rollers slow', ROLLERS.slice(0, 4)))).status, 201);
    srv.clock.now = NOW;
    const [, first, second] = srv.store.get(CID).inbox;

    const page = await pageOf(srv, kf.cookie, '/manage/team/rollers');
    const text = textOf(page);
    assert.match(text, /2 new plans from ZwiftGopher Sent 19:20 In the planner: Rollers slow · 4 riders Review and store Discard Sent 19:05 In the planner: Rollers & <b>fast<\/b> · 6 riders Review and store Discard/);
    assert.match(page, /In the planner: Rollers &amp; &lt;b&gt;fast&lt;\/b&gt;/, 'the name is escaped');
    assert.ok(page.indexOf(`href="/manage/inbox/${second.id}"`) < page.indexOf(`href="/manage/inbox/${first.id}"`), 'newest first');
    assert.match(page, new RegExp(`<form method="post" action="/manage/inbox/${first.id}/discard"><input type="hidden" name="club" value="${CID}"><input type="hidden" name="back" value="/manage/team/rollers">`));
    // the rows: the sidebar (and switcher) of every page, and the picker's tile
    assert.equal(count(page, '<span class="newplans">2 new plans</span>'), 2, 'switcher and sidebar');
    const picker = await pageOf(srv, kf.cookie, '/manage');
    assert.match(picker, /<span class="tile-name">Rollers<\/span>.*<span class="newplans">2 new plans<\/span>/);
    assert.doesNotMatch(picker, /<span class="tile-name">Sprockets<\/span>[^\n]*newplans/);
    // Sprockets' page has no list, but the Rollers row in its sidebar has the mark
    const sprockets = await pageOf(srv, kf.cookie, '/manage/team/sprockets');
    assert.doesNotMatch(sprockets, /new plans? from ZwiftGopher/);
    assert.match(sprockets, /<span class="trow-name">Rollers <span class="newplans">2 new plans<\/span>/);

    // Discard from the team page comes back to it, with one plan left
    const gone = await followPost(srv, kf.cookie, `/manage/inbox/${first.id}/discard`, {back: '/manage/team/rollers'});
    assert.equal(gone.location, '/manage/team/rollers');
    assert.match(textOf(gone.page), /New plan from ZwiftGopher Sent 19:20/);
    assert.match(gone.page, /<span class="newplans">1 new plan<\/span>/);
});


test('push: the assign page says where it came from and starts with Make live off', async t => {
    const kf = makeClub();
    const srv = await serve(t, kf, {env: ENV});
    assert.equal((await push(srv, tokenFor(secretOf(srv), 'rollers'), plan())).status, 201);
    const [entry] = srv.store.get(CID).inbox;
    const page = await pageOf(srv, kf.cookie, `/manage/inbox/${entry.id}`);
    assert.match(textOf(page), /From ZwiftGopher, 19:25/);
    assert.match(page, /<input type="checkbox" name="live" value="on">/, 'the box is off');
    assert.doesNotMatch(page, /name="live" value="on" checked/);
    // the same plan uploaded: the box starts on (Rollers has nothing live)
    const id = await intake(srv, kf.cookie, {team: 'rollers', json: plan()});
    const up = await pageOf(srv, kf.cookie, `/manage/inbox/${id}`);
    assert.match(textOf(up), /Uploaded 19:25/);
    assert.match(up, /name="live" value="on" checked/);
    // ticked and stored, it goes live
    const stored = await post(srv, kf.cookie, `/manage/inbox/${entry.id}`, {team: 'rollers', as: 'new', live: 'on', drawn: 'rollers:new', base: srv.store.get(CID).teams.rollers.version});
    assert.equal(stored.status, 200, stored.body);
    const c = srv.store.get(CID);
    assert.equal(c.sheets[c.teams.rollers.live].via, 'zwiftgopher');
});


test('push: assignChoices starts a received entry with the box off where an upload has it on', () => {
    const {club: c} = makeClub();
    const json = planJson('Rollers', ['1001', '1002']);
    for (const [source, on] of [['upload', true], ['receive', false]]) {
        const entry = {id: 'h00001', at: new Date(NOW).toISOString(), source, team: 'rollers', forPlan: null, via: null, json, text: null, warnings: []};
        const choices = assignChoices(c, entry, new URLSearchParams(), NOW);
        assert.deepEqual([choices.as, choices.liveKind, choices.live], ['new', 'none', on], source);
        // ticked by the captain, it stays ticked through a redraw
        assert.equal(assignChoices(c, entry, new URLSearchParams({drawn: 'rollers:new', as: 'new', live: 'on'}), NOW).live, true);
    }
});


// ---- the inbox rules for received entries (club.mjs) ----

function inboxClub() {
    const {club: c} = makeClub();
    return c;
}
const newId = () => randomId(6);
const receive = (c, now, json = planJson('Rollers', ['1001'])) => receiveEntry(c, {team: 'rollers', via: 'zwiftgopher', json, text: null}, {now, newId});


test('push inbox: a received plan waits 7 days, an upload still 24 h', () => {
    const c = inboxClub();
    const got = receive(c, NOW);
    const up = addEntry(c, {source: 'upload', team: 'rollers', json: planJson('Rollers', ['1001']), text: null}, {now: NOW, newId});
    assert.equal(RECEIVE_KEEP_MS, 7 * 86400000);
    assert.ok(entryOf(c, got, NOW + INBOX_KEEP_MS + 1), 'past 24 h');
    assert.equal(entryOf(c, up, NOW + INBOX_KEEP_MS + 1), null, 'the upload is gone after 24 h');
    assert.ok(entryOf(c, got, NOW + RECEIVE_KEEP_MS), 'exactly 7 days is still here');
    assert.equal(entryOf(c, got, NOW + RECEIVE_KEEP_MS + 1), null);
    assert.equal(sweepInbox(c, NOW + INBOX_KEEP_MS + 1), 1);
    assert.deepEqual(c.inbox.map(e => e.id), [got]);
    assert.equal(sweepInbox(c, NOW + RECEIVE_KEEP_MS + 1), 1);
    assert.deepEqual(c.inbox, []);
});


test('push inbox: 20 entries at most; a received plan is refused then, an upload drops the oldest', () => {
    const c = inboxClub();
    assert.equal(INBOX_MAX, 20);
    for (let i = 0; i < 20; i++) {
        receive(c, NOW + i);
    }
    assert.equal(c.inbox.length, 20);
    assert.throws(() => receive(c, NOW + 30), e => e instanceof ClubError && e.code === 'inbox-full');
    assert.equal(c.inbox.length, 20);
    const first = c.inbox[0].id;
    addEntry(c, {source: 'upload', team: 'rollers', json: planJson('Rollers', ['1001']), text: null}, {now: NOW + 40, newId});
    assert.equal(c.inbox.length, 20);
    assert.equal(entryOf(c, first), null, 'an upload still pushes the oldest out');
    // a stale received entry makes room: the push sweeps first
    const d = inboxClub();
    for (let i = 0; i < 20; i++) {
        receive(d, NOW + i);
    }
    receive(d, NOW + RECEIVE_KEEP_MS + 100);
    assert.equal(d.inbox.length, 1);
});


// ---- fix round (review of 866bc65) ----

// A push whose body comes in two parts, `between()` run after the first: {status, json}.
function slowPush(srv, token, body, between, {wait = 150} = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(srv.base);
        const req = http.request({host: u.hostname, port: u.port, method: 'POST', path: `/api/v3/push?paceline=${token}`,
            headers: {'content-type': 'application/json', 'content-length': Buffer.byteLength(body), origin: ZG}}, res => {
            let d = '';
            res.on('data', c => {
                d += c;
            });
            res.on('end', () => resolve({status: res.statusCode, json: JSON.parse(d), cors: res.headers['access-control-allow-origin']}));
        });
        req.on('error', reject);
        req.write(body.slice(0, 10));
        setTimeout(async () => {
            await between();
            req.end(body.slice(10));
        }, wait);
    });
}


test('push: deleting a team takes its waiting plans out of the inbox, so other teams can still receive', async t => {
    const kf = makeClub();
    const srv = await serve(t, kf, {env: ENV});
    const sprockets = tokenFor(secretOf(srv), 'sprockets');
    for (let i = 0; i < INBOX_MAX; i++) {
        srv.clock.now = NOW + i;
        assert.equal((await push(srv, sprockets, plan('Sprockets', ['1001']))).status, 201, `push ${i + 1}`);
    }
    srv.clock.now = NOW;
    assert.equal((await push(srv, tokenFor(secretOf(srv), 'rollers'), plan())).status, 409, 'full');
    const done = await followPost(srv, kf.cookie, '/manage/team', {action: 'delete', team: 'sprockets'});
    assert.equal(done.flash.kind, 'ok');
    assert.deepEqual(srv.store.get(CID).inbox, []);
    assert.equal((await push(srv, tokenFor(secretOf(srv), 'rollers'), plan())).status, 201);
});


test('deleteTeam drops the team\'s inbox entries of every source, and only those', () => {
    const {club: c} = makeClub();
    const newId = () => randomId(6);
    const add = (source, team) => addEntry(c, {source, team, json: planJson('X', ['1001']), text: null}, {now: NOW, newId});
    const keep = add('upload', 'rollers');
    add('upload', 'sprockets');
    add('receive', 'sprockets');
    const none = add('upload', null);
    deleteTeam(c, 'sprockets', NOW);
    assert.deepEqual(c.inbox.map(e => e.id), [keep, none]);
});


test('push: an expiry further ahead than a fresh link (7 days and 5 minutes) is an unknown token', async t => {
    const kf = makeClub();
    const srv = await serve(t, kf, {env: ENV});
    const secret = secretOf(srv);
    const nowS = Math.floor(NOW / 1000);
    for (const expiry of [nowS + 365 * 86400, 0xffffffff, nowS + WEEK_S + 301]) {
        const res = await push(srv, tokenFor(secret, 'rollers', {expiry}), plan());
        assert.deepEqual([res.status, res.json], [404, {error: 'unknown-token'}], String(expiry));
    }
    // a clock up to 5 minutes ahead when the link was drawn still passes
    assert.equal((await push(srv, tokenFor(secret, 'rollers', {expiry: nowS + WEEK_S + 300}), plan())).status, 201);
    assert.equal(srv.store.get(CID).inbox.length, 1);
});


test('push: the team deleted while the body comes in: 404 unknown-token, nothing stored, nothing logged', async t => {
    const kf = makeClub();
    const srv = await serve(t, kf, {env: ENV});
    const errors = [];
    const log = console.error;
    console.error = (...a) => errors.push(a.join(' '));
    let res;
    try {
        res = await slowPush(srv, tokenFor(secretOf(srv), 'sprockets'), JSON.stringify(plan('Sprockets', ['1001', '1002'])),
            () => srv.store.change(CID, c => deleteTeam(c, 'sprockets', NOW)));
    } finally {
        console.error = log;
    }
    assert.deepEqual([res.status, res.json, res.cors], [404, {error: 'unknown-token'}, ZG]);
    assert.deepEqual(srv.store.get(CID).inbox, []);
    assert.deepEqual(errors, []);
});


test('push: the body has 10 s, a trickled one is cut off with 408 and frees its slot', async t => {
    const kf = makeClub();
    const srv = await serve(t, kf, {env: ENV});
    assert.equal(srv.server.push.bodyMs, 10000);
    srv.server.push.bodyMs = 100;
    const token = tokenFor(secretOf(srv), 'rollers');
    const res = await slowPush(srv, token, JSON.stringify(plan()), () => {}, {wait: 400}).catch(() => null);
    // the server answers 408 before the rest arrives (the connection may close under the write)
    assert.ok(res === null || (res.status === 408 && res.json.error === 'too-slow'), JSON.stringify(res));
    srv.server.push.bodyMs = 10000;
    assert.equal(srv.server.push.slots.size(), 0, 'the slot is free again');
    assert.equal((await push(srv, token, plan())).status, 201);
});


test('push: every answer carries CORS for an allowed origin, a 500 too', async t => {
    const kf = makeClub();
    const srv = await serve(t, kf, {env: ENV});
    const token = tokenFor(secretOf(srv), 'rollers');
    const h = {origin: ZG};
    const answers = [
        await push(srv, 'f'.repeat(40), plan(), {headers: h}),
        await push(srv, tokenFor(secretOf(srv), 'rollers', {expiry: Math.floor(NOW / 1000) - 1}), plan(), {headers: h}),
        await push(srv, token, '{', {headers: h}),
        await push(srv, token, plan(), {headers: {...h, 'content-type': 'image/png'}}),
        await push(srv, token, 'x'.repeat(300 * 1024), {headers: h}),
    ];
    assert.deepEqual(answers.map(a => a.status), [404, 410, 400, 415, 413]);
    for (const a of answers) {
        assert.equal(a.headers.get('access-control-allow-origin'), ZG, String(a.status));
    }
    const get = await fetch(`${srv.base}/api/v3/push`, {headers: h});
    assert.deepEqual([get.status, get.headers.get('access-control-allow-origin')], [405, ZG]);
    // an error inside: 500 as JSON with CORS, logged without the query
    const change = srv.store.change;
    srv.store.change = () => {
        throw new TypeError('boom');
    };
    const errors = [];
    const log = console.error;
    console.error = (...a) => errors.push(a.join(' '));
    let broken;
    try {
        broken = await push(srv, token, plan(), {headers: h});
    } finally {
        console.error = log;
        srv.store.change = change;
    }
    assert.deepEqual([broken.status, broken.json, broken.headers.get('access-control-allow-origin')], [500, {error: 'internal'}, ZG]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^request failed: POST \/api\/v3\/push: TypeError/);
    assert.equal(errors[0].includes(token), false);
});


test('plannerName: entities decoded, control and bidi characters out, at most 60 code points', () => {
    const of = name => plannerName({json: {team: {name}}});
    assert.equal(of('Rollers &amp; friends'), 'Rollers & friends');
    assert.equal(of('Roll&#8238;ers\u0007 ​fast'), 'Rollers fast');
    assert.equal(of('  Rollers\n\tslow  '), 'Rollers slow');
    assert.equal(of('\u{1F6B4}'.repeat(80)), `${'\u{1F6B4}'.repeat(59)}…`);
    assert.equal(of('A'.repeat(60)), 'A'.repeat(60));
    assert.equal(of('&#8238;'), null);
    assert.equal(of(42), null);
    assert.equal(plannerName({json: {}}), null);
});


test('push: the team page shows the planner name cleaned and capped', async t => {
    const kf = makeClub();
    const srv = await serve(t, kf, {env: ENV});
    assert.equal((await push(srv, tokenFor(secretOf(srv), 'rollers'), plan(`Roll&#8238;ers ${'x'.repeat(100)}`))).status, 201);
    const page = await pageOf(srv, kf.cookie, '/manage/team/rollers');
    assert.ok(page.includes(`In the planner: Rollers ${'x'.repeat(51)}… · 6 riders`), 'cleaned and capped');
    assert.equal(page.includes('‮'), false);
});


test('push: pages reload by themselves while plans wait: the team page every 60 s, the upload page always', async t => {
    const kf = makeClub();
    upload(kf.club, 'rollers', {riders: ROLLERS.slice(0, 6), at: SETUP_AT});
    // 08:00 local: the race is at 19:30, so the team page's own 30 s reload is off
    const srv = await serve(t, kf, {env: ENV, now: Date.parse('2026-11-19T07:00:00Z')});
    const refreshOf = body => /<body[^>]*data-refresh="(\d+)"/.exec(body)?.[1] ?? null;
    const team = await pageOf(srv, kf.cookie, '/manage/team/rollers');
    assert.equal(refreshOf(team), null, 'nothing waits, no race: no reload');
    let up = await pageOf(srv, kf.cookie, '/manage/upload?team=rollers');
    assert.equal(refreshOf(up), '60');
    assert.doesNotMatch(up, /http-equiv="refresh"/, 'no script-less reload: a chosen file would go');
    assert.doesNotMatch(up, /from ZwiftGopher (is|are) waiting/);

    srv.clock.now = Date.parse('2026-11-19T07:00:00Z');
    assert.equal((await push(srv, tokenFor(secretOf(srv), 'rollers', {expiry: Math.floor(srv.clock.now / 1000) + WEEK_S}), plan())).status, 201);
    assert.equal((await push(srv, tokenFor(secretOf(srv), 'rollers', {expiry: Math.floor(srv.clock.now / 1000) + WEEK_S}), plan())).status, 201);
    const waiting = await pageOf(srv, kf.cookie, '/manage/team/rollers');
    assert.equal(refreshOf(waiting), '60');
    assert.match(waiting, /<meta http-equiv="refresh" content="60;url=\/manage\/team\/rollers">/);
    up = await pageOf(srv, kf.cookie, '/manage/upload?team=rollers');
    assert.match(textOf(up), /2 plans from ZwiftGopher are waiting\. Review on the Rollers page/);
    assert.match(up, /<a href="\/manage\/team\/rollers">Review on the Rollers page<\/a>/);
    assert.doesNotMatch(await pageOf(srv, kf.cookie, '/manage/upload?team=sprockets'), /from ZwiftGopher (is|are) waiting/);
    // around the race it stays at 30 s
    srv.clock.now = NOW;
    assert.equal(refreshOf(await pageOf(srv, kf.cookie, '/manage/team/rollers')), '30');
    // a refused upload (the answer to a POST) never reloads
    const refused = await fetch(`${srv.base}/manage/upload?team=rollers`, {method: 'POST', redirect: 'manual',
        headers: {cookie: kf.cookie, 'content-type': 'multipart/form-data; boundary=x'},
        body: `--x\r\nContent-Disposition: form-data; name="club"\r\n\r\n${CID}\r\n--x\r\nContent-Disposition: form-data; name="team"\r\n\r\nrollers\r\n--x\r\nContent-Disposition: form-data; name="paste"\r\n\r\n{"team": 1}\r\n--x--\r\n`});
    const refusedBody = await refused.text();
    assert.equal(refused.status, 400, refusedBody);
    assert.equal(refreshOf(refusedBody), null);
});
