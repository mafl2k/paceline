// The page frame, club links, the club cookie, principal() and the lost link (plan 3, Task 3);
// registration and the privacy page (Task 4).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import util from 'node:util';
import {startServer, fakeMailer, T, club as activeClub, pageFields, rows, refuseWrites} from './helpers.mjs';
import {newClub, ClubError} from '../club.mjs';
import {tokenHash, newToken, randomId} from '../ids.mjs';
import {SEC_HEADERS} from '../http.mjs';
import {clearDeadCookie, principal} from '../web.mjs';
import {esc, page, maskAddress, t} from '../pages.mjs';
import {addLink, openLink, addConfirm, addEmailToken, takeToken, endAllLinks, dropExpired, usableLink, TOKEN_MS} from '../tokens.mjs';


// Everything the server logs during this file; the last test checks it for tokens and addresses.
const captured = [];
for (const k of ['log', 'warn', 'error']) {
    console[k] = (...a) => {
        captured.push(util.format(...a));
    };
}
// every plain token a test sees (seeded or mailed)
const TOKENS = new Set();

const ENV = {PUBLIC_URL: 'https://ttt-beta.example.org', SMTP_HOST: 'smtp.example.org', MAIL_FROM: 'Paceline <paceline@example.org>'};
const START = T('2026-11-16T10:00:00.000Z');
const CID = 'k7f3q9x2m4';
const CID2 = 'm4x2k7f3q9';
const LINK_RE = /https:\/\/ttt-beta\.example\.org\/m\/([A-Za-z0-9_-]{22})/;
const COOKIE_RE = /^__Host-pl_club=[A-Za-z0-9_-]{22}; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=34560000$/;


// each running server's store by its base URL: post() adds the page's club field (pageFields)
const STORES = new Map();

async function setup({env = ENV, refuse = false} = {}) {
    const clock = {now: START};
    const mailer = fakeMailer({refuse});
    const srv = await startServer({env, clock, mailer});
    STORES.set(srv.base, srv.store);
    return {...srv, clock, mailer};
}


// A pending club with one pending link, as registration leaves it. The plain token.
function seedPending(store, now, {id = CID, name = 'Kettenfett RC', email = 'captain@example.org'} = {}) {
    store.create(newClub({id, name, email, tz: 'Europe/Berlin', now}));
    let tok;
    store.change(id, c => {
        tok = addLink(c, now);
    });
    TOKENS.add(tok);
    return tok;
}


function linksOf(mailer) {
    return mailer.sent.map(m => {
        const tok = LINK_RE.exec(m.text)?.[1];
        TOKENS.add(tok);
        return tok;
    });
}


const get = (base, p, cookie) => fetch(base + p, {redirect: 'manual', headers: cookie ? {cookie} : {}});

const post = (base, p, form = {}, {cookie, site, xff} = {}) => fetch(base + p, {
    method: 'POST', redirect: 'manual',
    headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...(cookie ? {cookie} : {}), ...(site ? {'sec-fetch-site': site} : {}), ...(xff ? {'x-forwarded-for': xff} : {}),
    },
    body: new URLSearchParams(STORES.has(base) ? pageFields(STORES.get(base), cookie, p, form) : form).toString(),
});

// A form post with a Host header of our choice (fetch always sends the real one).
function postWithHost(base, p, form, host) {
    const body = new URLSearchParams(form).toString();
    return new Promise((resolve, reject) => {
        const req = http.request(base + p, {
            method: 'POST',
            headers: {host, 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body)},
        }, res => {
            res.resume();
            res.on('end', () => resolve(res.statusCode));
        });
        req.on('error', reject);
        req.end(body);
    });
}

// The same with the answer's body.
function postWithHostBody(base, p, form, host) {
    const body = new URLSearchParams(form).toString();
    return new Promise((resolve, reject) => {
        const req = http.request(base + p, {
            method: 'POST',
            headers: {host, 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body)},
        }, res => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', d => {
                text += d;
            });
            res.on('end', () => resolve({status: res.statusCode, body: text}));
        });
        req.on('error', reject);
        req.end(body);
    });
}

// /lost answers first and does its per-club work right after: let that run.
const settle = () => new Promise(r => setImmediate(r));

const CLEARED = '__Host-pl_club=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';

// The cookie pair a 303 sets, ready for a Cookie header.
const cookieOf = res => res.headers.get('set-cookie').split(';')[0];

// The page as a reader sees it: tags gone, white space collapsed.
const textOf = s => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ');

// A 303 answer followed with its flash cookie (and the club cookie): the page it leads to, as text.
async function followed(srv, res, cookie) {
    assert.equal(res.status, 303);
    const pair = res.headers.getSetCookie().map(c => c.split(';')[0]).find(c => c.startsWith('__Host-pl_flash='));
    assert.ok(pair, 'the flash cookie');
    const page = await get(srv.base, res.headers.get('location'), `${cookie}; ${pair}`);
    assert.equal(page.status, 200);
    return page.text();
}

// The flash at the top of a page: {kind, text}, or null.
function flashOf(body) {
    const m = /<div class="flash (ok|err)" role="status">[\s\S]*?<p>([^<]*)<\/p><\/div>/.exec(body);
    return m ? {kind: m[1], text: m[2]} : null;
}

// The club as stored: open, then the club and its cookie.
async function activate(srv, tok) {
    const res = await post(srv.base, `/m/${tok}`);
    assert.equal(res.status, 303);
    return cookieOf(res);
}


test('tokens: pure rules', () => {
    const now = START;
    const club = newClub({id: CID, name: 'Kettenfett RC', email: 'captain@example.org', tz: 'Europe/Berlin', now});
    const toks = [0, 1, 2, 3].map(i => addLink(club, now + i));
    assert.equal(club.tokens.length, 3);
    assert.ok(club.tokens.every(tk => tk.kind === 'link' && tk.state === 'pending'));
    assert.deepEqual(club.tokens.map(tk => tk.hash), toks.slice(1).map(tokenHash), 'the first one is gone');
    assert.deepEqual(club.tokens[0], {
        hash: tokenHash(toks[1]), kind: 'link', state: 'pending',
        createdAt: '2026-11-16T10:00:00.001Z', expiresAt: '2026-11-17T10:00:00.001Z',
    });

    assert.equal(openLink(club, tokenHash(toks[2]), now + 10), true);
    assert.deepEqual(club.tokens, [{
        hash: tokenHash(toks[2]), kind: 'link', state: 'active', createdAt: '2026-11-16T10:00:00.002Z', expiresAt: null,
    }]);
    // the active link opens again without a change (a second device); an ended one does not
    const before = structuredClone(club.tokens);
    assert.equal(openLink(club, tokenHash(toks[2]), now + TOKEN_MS * 10), true);
    assert.deepEqual(club.tokens, before);
    assert.equal(openLink(club, tokenHash(toks[3]), now + 10), false);

    // 24 h: a pending link expires
    const late = addLink(club, now);
    assert.equal(usableLink(club, tokenHash(late), now + TOKEN_MS)?.state, 'pending');
    assert.equal(openLink(club, tokenHash(late), now + TOKEN_MS + 1), false);

    // confirm and email tokens: 24 h, taken once, only by their kind
    const c1 = addConfirm(club, {action: 'delete'}, now);
    const c2 = addConfirm(club, {action: 'email', email: 'new@example.org'}, now);
    const e1 = addEmailToken(club, 'new@example.org', now);
    assert.throws(() => addConfirm(club, {action: 'rename'}, now), TypeError);
    assert.equal(takeToken(club, tokenHash(c1), 'email', now), null);
    assert.deepEqual(takeToken(club, tokenHash(c1), 'confirm', now), {
        hash: tokenHash(c1), kind: 'confirm', action: 'delete', email: null,
        createdAt: '2026-11-16T10:00:00.000Z', expiresAt: '2026-11-17T10:00:00.000Z',
    });
    assert.equal(takeToken(club, tokenHash(c1), 'confirm', now), null, 'taken once');
    assert.equal(takeToken(club, tokenHash(c2), 'confirm', now + TOKEN_MS + 1), null, 'after 24 h + 1 ms');
    assert.equal(takeToken(club, tokenHash(e1), 'email', now + TOKEN_MS)?.email, 'new@example.org');

    // a pre-drawn token is the one stored; dropExpired and endAllLinks
    const pre = newToken();
    assert.equal(addLink(club, now, pre), pre.token);
    assert.ok(club.tokens.some(tk => tk.hash === pre.hash));
    dropExpired(club, now + TOKEN_MS + 1);
    assert.deepEqual(club.tokens.map(tk => tk.state), ['active'], 'only the active link outlives 24 h');
    endAllLinks(club);
    assert.deepEqual(club.tokens, []);
});


test('pages: frame, copy and the masked address', () => {
    const p = page('Kettenfett <RC>', '<p>x</p>');
    assert.match(p, /<title>Paceline<\/title>/);
    assert.match(p, /<h1>Kettenfett &lt;RC&gt;<\/h1>/);
    assert.doesNotMatch(p, /http-equiv/);
    assert.match(page('x', '', {refresh: '/manage'}), /<meta http-equiv="refresh" content="30;url=\/manage">/);
    assert.match(p, /<link rel="stylesheet" href="\/static\/app\.css\?v=[0-9a-f]{12}">/);
    assert.equal(esc('<a href="x">\'&'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
    assert.equal(maskAddress('captain@example.org'), 'c…@example.org');
    assert.equal(t('newlink-sent', {masked: 'c…@example.org'}), 'We mailed a new link to c…@example.org.');
    assert.equal(t('link-open', {club: '{masked}'}), 'Open {masked}', 'filled once');
});


test('pages: neutral title, headers', async () => {
    const srv = await setup();
    try {
        for (const p of ['/', '/m/AAAAAAAAAAAAAAAAAAAAAA', '/lost']) {
            const res = await get(srv.base, p);
            const body = await res.text();
            assert.equal(res.status, p.startsWith('/m/') ? 404 : 200, p);
            assert.match(res.headers.get('content-type'), /^text\/html; charset=utf-8$/, p);
            assert.match(body, /<title>Paceline<\/title>/, p);
            assert.equal(res.headers.get('x-robots-tag'), 'noindex', p);
            assert.equal(res.headers.get('referrer-policy'), 'no-referrer', p);
            assert.equal(res.headers.get('content-security-policy'), SEC_HEADERS['Content-Security-Policy'], p);
            assert.doesNotMatch(body, /<script/i, p);
        }
        const home = textOf(await (await get(srv.base, '/')).text());
        assert.match(home, /Register a club/);
        assert.match(home, /Lost link/);
        assert.match(home, /Privacy/);
        assert.doesNotMatch(home, /Open /);
    } finally {
        await srv.stop();
    }
});


// The start page is for a browser without a club open (18 Nov 2026): with one club or more in the
// cookie, / goes straight to /manage (GET and HEAD); without one it is the start page with Register a
// club and Lost link only.
test('start page: / goes to /manage when a club is open, else the start page', async () => {
    const srv = await setup();
    try {
        const [a, b] = seedClubs(srv.store, 2);
        await activate(srv, a);
        await activate(srv, b);
        for (const [what, cookie] of [['one club', jar([a])], ['two clubs', jar([a, b])], ['two, B first', jar([b, a])]]) {
            for (const method of ['GET', 'HEAD']) {
                const res = await fetch(`${srv.base}/`, {method, redirect: 'manual', headers: {cookie}});
                assert.equal(res.status, 303, `${what} ${method}`);
                assert.equal(res.headers.get('location'), '/manage', `${what} ${method}`);
                assert.equal(res.headers.get('set-cookie'), null, `${what} ${method}`);
                assert.equal(await res.text(), '', `${what} ${method}`);
            }
        }
        // the redirect leads to the open club
        assert.equal(await clubShown(srv, jar([b, a])), 'Spokesmen CC');
        // no cookie, or one that opens no club: the start page
        for (const [what, cookie] of [['no cookie', undefined], ['no club', jar(['AAAAAAAAAAAAAAAAAAAAAA'])]]) {
            const res = await get(srv.base, '/', cookie);
            assert.equal(res.status, 200, what);
            const body = await res.text();
            const btnrow = /<div class="btnrow">([\s\S]*?)<\/div>/.exec(body)[1];
            assert.deepEqual([...btnrow.matchAll(/>([^<>]+)<\/a>/g)].map(m => m[1]), ['Register a club', 'Lost link'], what);
            assert.match(btnrow, /<a class="btn primary block" href="\/register">/, what);
            assert.match(btnrow, /<a class="btn secondary block" href="\/lost">/, what);
            assert.doesNotMatch(body, /action="\/switch"|action="\/logout-all"|Open |Kettenfett RC|Spokesmen CC/, what);
            const head = await fetch(`${srv.base}/`, {method: 'HEAD', redirect: 'manual', headers: cookie ? {cookie} : {}});
            assert.equal(head.status, 200, `${what} HEAD`);
        }
        // a POST to / is no route
        assert.equal((await post(srv.base, '/', {}, {cookie: jar([a])})).status, 405);
    } finally {
        await srv.stop();
    }
});


test('GET /m is inert', async () => {
    const srv = await setup();
    try {
        const tok = seedPending(srv.store, START);
        const res = await get(srv.base, `/m/${tok}`);
        const body = await res.text();
        assert.equal(res.status, 200);
        assert.match(body, /<form method="post" action="\/m\/[A-Za-z0-9_-]{22}"><button class="btn primary block" type="submit">Open Kettenfett RC<\/button><\/form>/);
        assert.equal(res.headers.get('set-cookie'), null);
        const club = srv.store.getAny(CID);
        assert.equal(club.status, 'pending');
        assert.deepEqual(club.tokens.map(tk => tk.state), ['pending']);

        const bad = await get(srv.base, '/m/AAAAAAAAAAAAAAAAAAAAAA');
        assert.equal(bad.status, 404);
        const badBody = await bad.text();
        assert.match(textOf(badBody), /This link is not valid\. Lost your link\?/);
        assert.match(badBody, /<a class="btn primary block" href="\/lost"><svg[^>]*>[\s\S]*?<\/svg>Lost your link\?<\/a>/);
        for (const p of ['/m/short', '/m/AAAAAAAAAAAAAAAAAAAAAA/x']) {
            assert.equal((await get(srv.base, p)).status, 404, p);
        }
    } finally {
        await srv.stop();
    }
});


test('first use: the button activates, sets the cookie, leaves the URL', async () => {
    const srv = await setup();
    try {
        const tok = seedPending(srv.store, START);
        srv.clock.now = START + 60000;
        const res = await post(srv.base, `/m/${tok}`);
        assert.equal(res.status, 303);
        assert.equal(res.headers.get('location'), '/manage');
        assert.match(res.headers.get('set-cookie'), COOKIE_RE);
        assert.equal(cookieOf(res), `__Host-pl_club=${tok}`);

        const club = srv.store.get(CID);
        assert.equal(club.status, 'active');
        assert.equal(club.confirmedAt, '2026-11-16T10:01:00.000Z');
        assert.deepEqual(club.tokens.map(tk => [tk.state, tk.expiresAt]), [['active', null]]);
        assert.deepEqual(club.log, [{at: '2026-11-16T10:01:00.000Z', what: 'link-opened'}]);

        const cookie = cookieOf(res);
        const manage = await get(srv.base, '/manage', cookie);
        assert.equal(manage.status, 200);
        assert.match(await manage.text(), /<h1>Kettenfett RC<\/h1>/);
        // with the club open, / goes straight to it
        const home = await get(srv.base, '/', cookie);
        assert.equal(home.status, 303);
        assert.equal(home.headers.get('location'), '/manage');

        // the same mail link on a second device opens the club again, with no change
        srv.clock.now = START + 3 * TOKEN_MS;
        const again = await post(srv.base, `/m/${tok}`);
        assert.equal(again.status, 303);
        assert.equal(cookieOf(again), cookie);
        assert.equal((await get(srv.base, `/m/${tok}`)).status, 200);
        assert.equal(srv.store.get(CID).log.length, 1);
    } finally {
        await srv.stop();
    }
});


test('first use: a name taken meanwhile', async () => {
    const srv = await setup();
    try {
        const tok1 = seedPending(srv.store, START);
        const tok2 = seedPending(srv.store, START, {id: CID2, email: 'second@example.org'});
        await activate(srv, tok1);

        const res = await post(srv.base, `/m/${tok2}`);
        const body = await res.text();
        assert.equal(res.status, 409);
        assert.equal(res.headers.get('set-cookie'), null);
        assert.match(textOf(body), /This name was taken meanwhile\./);
        assert.match(body, new RegExp(`<form class="stack" method="post" action="/m/${tok2}">`));
        assert.match(body, /<input type="text" name="name" value="Kettenfett RC"/);
        assert.equal(srv.store.getAny(CID2).status, 'pending');

        // a look-alike of the taken name is taken too; a bad name is refused
        const alike = await post(srv.base, `/m/${tok2}`, {name: 'kettenfett-rc'});
        assert.equal(alike.status, 409);
        assert.match(textOf(await alike.text()), /This name is taken\. Choose another\./);
        const bad = await post(srv.base, `/m/${tok2}`, {name: 'x'});
        assert.equal(bad.status, 400);
        assert.match(textOf(await bad.text()), /Use 2 to 60 characters/);
        assert.equal(srv.store.getAny(CID2).status, 'pending');

        const ok = await post(srv.base, `/m/${tok2}`, {name: ' Kettenfett  RC Zwei '});
        assert.equal(ok.status, 303);
        assert.equal(ok.headers.get('location'), '/manage');
        const club = srv.store.get(CID2);
        assert.equal(club.status, 'active');
        assert.equal(club.name, 'Kettenfett RC Zwei');
        assert.equal(srv.store.get(CID).name, 'Kettenfett RC');
    } finally {
        await srv.stop();
    }
});


test('first use: no room for new clubs', async () => {
    const srv = await setup({env: {...ENV, MAX_CIRCLES: '1'}});
    try {
        const tok1 = seedPending(srv.store, START);
        const tok2 = seedPending(srv.store, START, {id: CID2, name: 'Spokesmen CC'});
        await activate(srv, tok1);
        const res = await post(srv.base, `/m/${tok2}`);
        assert.equal(res.status, 503);
        assert.equal(res.headers.get('set-cookie'), null);
        assert.match(textOf(await res.text()), /The server has no room for new clubs right now\./);
        assert.equal(srv.store.getAny(CID2).status, 'pending');
    } finally {
        await srv.stop();
    }
});


test('3 pending links; opening one ends the rest and the old cookie', async () => {
    const srv = await setup();
    try {
        const tok = seedPending(srv.store, START);
        const cookieA = await activate(srv, tok);
        for (const email of ['captain@example.org', 'Captain@Example.ORG', 'captain@example.org', ' captain@example.org ']) {
            srv.clock.now += 1000;
            assert.equal(await postWithHost(srv.base, '/lost', {email}, 'evil.example.org'), 200);
            await settle();
        }
        const links = linksOf(srv.mailer);
        assert.equal(links.length, 4);
        for (const m of srv.mailer.sent) {
            assert.equal(m.kind, 'new-link');
            assert.equal(m.budget, 'other');
            assert.equal(m.to, 'captain@example.org');
            assert.equal(m.subject, 'Paceline: new link for Kettenfett RC');
            assert.match(m.text, /opening it ends the old link\. From then on it is your club's link for good/);
            const urls = m.text.match(/https?:\/\/\S+/g);
            assert.equal(urls.length, 1);
            assert.ok(urls[0].startsWith('https://ttt-beta.example.org/m/'), urls[0]);
            assert.doesNotMatch(m.text, /evil/);
        }
        assert.equal(new Set(links).size, 4);
        assert.equal((await get(srv.base, `/m/${links[0]}`)).status, 404, 'the first is dead');
        for (const l of links.slice(1)) {
            assert.equal((await get(srv.base, `/m/${l}`)).status, 200);
        }
        assert.equal((await get(srv.base, '/manage', cookieA)).status, 200, 'A still works');

        const res = await post(srv.base, `/m/${links[3]}`);
        assert.equal(res.status, 303);
        const cookieB = cookieOf(res);
        assert.notEqual(cookieB, cookieA);
        const gone = await get(srv.base, '/manage', cookieA);
        assert.equal(gone.status, 303);
        assert.equal(gone.headers.get('location'), '/');
        assert.equal((await get(srv.base, '/manage', cookieB)).status, 200);
        for (const l of [tok, links[1], links[2]]) {
            assert.equal((await get(srv.base, `/m/${l}`)).status, 404);
        }
        const log = srv.store.get(CID).log.map(e => e.what);
        assert.deepEqual(log, ['link-opened', 'link-opened']);
    } finally {
        await srv.stop();
    }
});


test('a refused mail stores no link', async () => {
    const srv = await setup();
    try {
        const tok = seedPending(srv.store, START);
        const cookie = await activate(srv, tok);
        const earlier = [];
        srv.store.change(CID, c => {
            for (let i = 0; i < 3; i++) {
                earlier.push(addLink(c, START + i));
            }
        });
        earlier.forEach(x => TOKENS.add(x));
        const before = structuredClone(srv.store.get(CID).tokens);
        srv.mailer.refuse = true;
        const lost = await post(srv.base, '/lost', {email: 'captain@example.org'});
        await settle();
        assert.equal(lost.status, 200);
        assert.match(textOf(await lost.text()), /If a club uses this address, we mailed it a new link\. It works for 24 hours\./);
        const newlink = await post(srv.base, '/manage/newlink', {}, {cookie});
        assert.match(flashOf(await followed(srv, newlink, cookie)).text, /^No mail was sent/);
        assert.deepEqual(srv.store.get(CID).tokens, before);
        for (const l of earlier) {
            assert.equal((await get(srv.base, `/m/${l}`)).status, 200);
        }
        assert.equal(srv.mailer.sent.length, 0);
    } finally {
        await srv.stop();
    }
});


test('a new link from the club page', async () => {
    const srv = await setup();
    try {
        const cookie = await activate(srv, seedPending(srv.store, START));
        const res = await post(srv.base, '/manage/newlink', {}, {cookie});
        const body = await followed(srv, res, cookie);
        assert.deepEqual(flashOf(body), {kind: 'ok', text: 'We mailed a new link to c…@example.org.'});
        assert.doesNotMatch(body, /captain@/);
        const [link] = linksOf(srv.mailer);
        assert.equal(srv.mailer.sent.length, 1);
        assert.equal(srv.mailer.sent[0].subject, 'Paceline: new link for Kettenfett RC');
        assert.equal(srv.mailer.sent[0].to, 'captain@example.org');
        assert.equal((await get(srv.base, `/m/${link}`)).status, 200);
        assert.equal((await get(srv.base, '/manage', cookie)).status, 200, 'the old link works until the new one is opened');
    } finally {
        await srv.stop();
    }
});


test('lost link is neutral', async () => {
    const srv = await setup();
    try {
        await activate(srv, seedPending(srv.store, START));
        const unknown = await post(srv.base, '/lost', {email: 'nobody@example.org'});
        const unknownBody = await unknown.text();
        await settle();
        assert.equal(srv.mailer.sent.length, 0, 'the unknown address sends no mail');
        const known = await post(srv.base, '/lost', {email: 'captain@example.org'});
        const knownBody = await known.text();
        await settle();
        assert.equal(srv.mailer.sent.length, 1);
        linksOf(srv.mailer);
        assert.equal(unknown.status, 200);
        assert.equal(known.status, 200);
        assert.equal(knownBody, unknownBody);
        assert.match(textOf(knownBody), /If a club uses this address, we mailed it a new link\. It works for 24 hours\./);
        assert.doesNotMatch(knownBody, /example\.org/);

        // a pending club's address gets nothing (it has its registration link)
        seedPending(srv.store, START, {id: CID2, name: 'Spokesmen CC', email: 'second@example.org'});
        const pending = await post(srv.base, '/lost', {email: 'second@example.org'});
        await settle();
        assert.equal(await pending.text(), unknownBody);
        assert.equal(srv.mailer.sent.length, 1);
    } finally {
        await srv.stop();
    }
});


test('lost link without mail', async () => {
    const plain = await startServer({clock: {now: START}});
    STORES.set(plain.base, plain.store);
    try {
        assert.equal(plain.server.mailer, null);
        const cookie = await activate(plain, seedPending(plain.store, START));
        const before = structuredClone(plain.store.get(CID).tokens);
        const res = await post(plain.base, '/lost', {email: 'captain@example.org'});
        await settle();
        assert.equal(res.status, 200);
        assert.match(textOf(await res.text()), /If a club uses this address, we mailed it a new link\./);
        const newlink = await post(plain.base, '/manage/newlink', {}, {cookie});
        assert.match(flashOf(await followed(plain, newlink, cookie)).text, /^No mail was sent/);
        assert.deepEqual(plain.store.get(CID).tokens, before);
    } finally {
        await plain.stop();
    }
});


test('same origin for every POST', async () => {
    const srv = await setup();
    try {
        const tok = seedPending(srv.store, START);
        const cookie = await activate(srv, tok);
        for (const p of [`/m/${tok}`, '/lost', '/manage/newlink', '/manage/logout', '/register']) {
            const res = await post(srv.base, p, {...REG, name: 'Spokesmen CC', email: 'captain@example.org'}, {cookie, site: 'cross-site'});
            assert.equal(res.status, 403, p);
            assert.equal(res.headers.get('set-cookie'), null, p);
        }
        await settle();
        assert.equal(srv.mailer.sent.length, 0);
        assert.equal(srv.store.pendingCount(), 0, 'no club registered cross-site');
        assert.equal((await get(srv.base, '/manage', cookie)).status, 200, 'still signed in');
    } finally {
        await srv.stop();
    }
});


test('the club pages need the cookie', async () => {
    const srv = await setup();
    try {
        await activate(srv, seedPending(srv.store, START));
        // a pending link works only by opening it, never as the cookie itself
        let pending;
        srv.store.change(CID, c => {
            pending = addLink(c, START);
        });
        TOKENS.add(pending);
        for (const p of ['/manage', '/manage/newlink', '/manage/anything']) {
            for (const cookie of [undefined, '__Host-pl_club=AAAAAAAAAAAAAAAAAAAAAA', '__Host-pl_club=bad', `__Host-pl_club=${pending}`]) {
                const res = await get(srv.base, p, cookie);
                assert.equal(res.status, 303, p);
                assert.equal(res.headers.get('location'), '/', p);
                // a dead cookie is cleared; without one nothing is set
                assert.equal(res.headers.get('set-cookie'), cookie ? CLEARED : null, `${p} ${cookie}`);
            }
        }
        for (const p of ['/manage/newlink', '/manage/logout']) {
            const res = await post(srv.base, p, {}, {cookie: '__Host-pl_club=AAAAAAAAAAAAAAAAAAAAAA'});
            assert.equal(res.status, 403, p);
            assert.equal(res.headers.get('set-cookie'), CLEARED, p);
            const none = await post(srv.base, p);
            assert.equal(none.status, 403, p);
            assert.equal(none.headers.get('set-cookie'), null, p);
            const body = await res.text();
            assert.match(textOf(body), /Signed out Your club link no longer works in this browser\. Someone opened a new club link, or you logged out, or the club was deleted or restored\./, p);
            assert.match(body, /<a class="btn primary block" href="\/lost">/);
        }
        assert.equal(srv.mailer.sent.length, 0);
    } finally {
        await srv.stop();
    }
});


test('logout', async () => {
    const srv = await setup();
    try {
        const cookie = await activate(srv, seedPending(srv.store, START));
        const res = await post(srv.base, '/manage/logout', {}, {cookie});
        assert.equal(res.status, 303);
        assert.equal(res.headers.get('location'), '/');
        assert.equal(res.headers.get('set-cookie'), CLEARED);
        // the browser drops the cookie
        const after = await get(srv.base, '/manage');
        assert.equal(after.status, 303);
        assert.equal(after.headers.get('location'), '/');
        // the link itself still works (logout ends this browser's session only)
        assert.equal((await get(srv.base, '/manage', cookie)).status, 200);

        // a stale tab: the link was replaced meanwhile, so logout answers 403 and clears the cookie
        let next;
        srv.store.change(CID, c => {
            next = addLink(c, START);
        });
        TOKENS.add(next);
        assert.equal((await post(srv.base, `/m/${next}`)).status, 303);
        const stale = await post(srv.base, '/manage/logout', {}, {cookie});
        assert.equal(stale.status, 403);
        assert.equal(stale.headers.get('set-cookie'), CLEARED);
    } finally {
        await srv.stop();
    }
});


test('lost link: a club whose change fails', async () => {
    const srv = await setup();
    try {
        const cookie = await activate(srv, seedPending(srv.store, START));
        await activate(srv, seedPending(srv.store, START, {id: CID2, name: 'Spokesmen CC'}));
        const unknownBody = await (await post(srv.base, '/lost', {email: 'nobody@example.org'})).text();
        await settle();
        const before = structuredClone(srv.store.get(CID).tokens);
        // Kettenfett RC at its size cap: every change of it fails
        const change = srv.store.change;
        srv.store.change = (cid, fn) => {
            if (cid === CID) {
                throw new ClubError('too-big');
            }
            return change(cid, fn);
        };
        const logged = captured.length;
        const res = await post(srv.base, '/lost', {email: 'captain@example.org'});
        assert.equal(res.status, 200);
        assert.equal(await res.text(), unknownBody);
        await settle();
        // no mail for the club whose link was not stored; the other club still gets its link
        assert.deepEqual(srv.mailer.sent.map(m => m.subject), ['Paceline: new link for Spokesmen CC']);
        const [link] = linksOf(srv.mailer);
        assert.equal(srv.store.tokenOwner(tokenHash(link)).cid, CID2);
        assert.equal((await get(srv.base, `/m/${link}`)).status, 200);
        assert.deepEqual(srv.store.get(CID).tokens, before);
        const lines = captured.slice(logged);
        assert.deepEqual(lines, [`paceline-server: new link for ${CID} not stored: too-big`]);

        // the club page says no mail went out
        const newlink = await post(srv.base, '/manage/newlink', {}, {cookie});
        assert.match(flashOf(await followed(srv, newlink, cookie)).text, /^No mail was sent/);
        assert.equal(srv.mailer.sent.length, 1);
        srv.store.change = change;
    } finally {
        await srv.stop();
    }
});


test('unconfirmed clubs go after 24 h', async () => {
    const srv = await setup();
    try {
        const tok = seedPending(srv.store, START);
        srv.clock.now = START + TOKEN_MS + 1000;
        srv.store.sweep();
        assert.equal(srv.store.getAny(CID), null);
        assert.equal((await get(srv.base, `/m/${tok}`)).status, 404);
        assert.equal((await post(srv.base, `/m/${tok}`)).status, 404);
    } finally {
        await srv.stop();
    }
});


test('an expired pending link does not open the club', async () => {
    const srv = await setup();
    try {
        const cookie = await activate(srv, seedPending(srv.store, START));
        let late;
        srv.store.change(CID, c => {
            late = addLink(c, START);
        });
        TOKENS.add(late);
        srv.clock.now = START + TOKEN_MS + 1;
        assert.equal((await get(srv.base, `/m/${late}`)).status, 404);
        assert.equal((await post(srv.base, `/m/${late}`)).status, 404);
        assert.equal((await get(srv.base, '/manage', cookie)).status, 200);
    } finally {
        await srv.stop();
    }
});


// ---- registration and privacy (Task 4) ----

const REG = {name: 'Kettenfett RC', email: 'captain@example.org', tz: 'Europe/Berlin', riders: 'on'};
const DONE = 'Check your inbox. The link works for 24 hours.';
const CLOSED = 'Registration is closed.';
const RIDERS_TEXT = 'I will tell my riders that their Zwift IDs and names are in the plans.';
const CONFIRM_SENTENCES = [
    'From then on it is your club\'s link for good: bookmark it or keep this mail',
    'Share it only with your plan makers: anyone with it can change your club\'s plans.',
    'Not you? Ignore this mail; nothing is kept after 24 hours.',
];

const without = (o, k) => Object.fromEntries(Object.entries(o).filter(([key]) => key !== k));

// A register POST; the work after the answer has run when it returns.
async function register(srv, form = {}, opts = {}) {
    const res = await post(srv.base, '/register', {...REG, ...form}, opts);
    const body = await res.text();
    await settle();
    return {status: res.status, body, text: textOf(body)};
}

// Pending clubs straight into the store (made-up ids), each with its own address.
function seedPendingMany(store, n, now) {
    for (let i = 0; i < n; i++) {
        store.create(newClub({id: randomId(10), name: `Seeded ${i} CC`, email: `seed${i}@example.org`, tz: 'Europe/Berlin', now}));
    }
}


test('register and privacy pages: neutral title, headers, no scripts', async () => {
    const srv = await setup();
    try {
        for (const p of ['/register', '/privacy']) {
            const res = await get(srv.base, p);
            const body = await res.text();
            assert.equal(res.status, 200, p);
            assert.match(res.headers.get('content-type'), /^text\/html; charset=utf-8$/, p);
            assert.match(body, /<title>Paceline<\/title>/, p);
            assert.equal(res.headers.get('x-robots-tag'), 'noindex', p);
            assert.equal(res.headers.get('referrer-policy'), 'no-referrer', p);
            assert.equal(res.headers.get('content-security-policy'), SEC_HEADERS['Content-Security-Policy'], p);
            assert.equal(res.headers.get('cache-control'), 'no-store', p);
            assert.doesNotMatch(body, /<script/i, p);
            // register in the narrow column, privacy in the wide one (its table)
            assert.match(body, p === '/privacy' ? /<main class="page wide" id="main">/ : /<main class="page narrow" id="main">/, p);
        }
        const res = await post(srv.base, '/register', REG);
        assert.match(res.headers.get('content-type'), /^text\/html; charset=utf-8$/);
        assert.match(await res.text(), /<title>Paceline<\/title>/);
        await settle();
        linksOf(srv.mailer);
        assert.equal((await post(srv.base, '/privacy')).status, 405);
    } finally {
        await srv.stop();
    }
});


test('register: the form', async () => {
    const srv = await setup();
    try {
        const body = await (await get(srv.base, '/register')).text();
        assert.ok(body.includes(RIDERS_TEXT), 'the checkbox text verbatim');
        assert.match(body, /<form class="stack" method="post" action="\/register">/);
        assert.match(body, /<input type="text" name="name"[^>]* required/);
        assert.match(body, /<input type="email" name="email"[^>]* required/);
        assert.match(body, /<input type="checkbox" name="riders" required>/);
        assert.match(body, /<select name="tz" required>/);
        assert.match(body, /<option value="Europe\/Berlin" selected>Europe\/Berlin<\/option>/);
        assert.equal(body.match(/ selected>/g).length, 1);
        assert.match(body, /<option value="UTC">UTC<\/option>/, 'UTC for clubs with WTRL/ZRL times');
        assert.match(body, /<a class="uplink" href="\/privacy">/);
    } finally {
        await srv.stop();
    }
    // a server zone that the runtime's list leaves out is still offered, and preselected
    const kolkata = await setup({env: {...ENV, PACELINE_TZ: 'Asia/Kolkata'}});
    try {
        const body = await (await get(kolkata.base, '/register')).text();
        assert.match(body, /<option value="Asia\/Kolkata" selected>/);
    } finally {
        await kolkata.stop();
    }
});


test('register: a pending club and a mail with the PUBLIC_URL link', async () => {
    const srv = await setup();
    try {
        const res = await postWithHostBody(srv.base, '/register', REG, 'evil.example.org');
        await settle();
        assert.equal(res.status, 200);
        assert.match(textOf(res.body), new RegExp(DONE.replace(/\./g, '\\.')));
        assert.equal(srv.mailer.sent.length, 1);
        const [m] = srv.mailer.sent;
        assert.equal(m.subject, 'Paceline: confirm your club Kettenfett RC');
        assert.equal(m.kind, 'confirm-club');
        assert.equal(m.budget, 'new');
        assert.equal(m.to, 'captain@example.org');
        assert.match(m.text, /https:\/\/ttt-beta\.example\.org\/m\/[A-Za-z0-9_-]{22}/);
        assert.doesNotMatch(m.text, /evil/);
        assert.equal(m.text.match(/https?:\/\/\S+/g).length, 1);
        // the HTML part (mail-content.mjs): the same link as the button
        const link = m.text.match(/https?:\/\/\S+/)[0];
        assert.ok(m.html.includes(`<a class="pl-btn-a" href="${link}"`), 'the link as the button');
        for (const sentence of CONFIRM_SENTENCES) {
            assert.ok(m.text.includes(sentence), sentence);
        }
        const [tok] = linksOf(srv.mailer);

        const pending = srv.store.pending();
        assert.equal(pending.length, 1);
        const [c] = pending;
        assert.equal(srv.store.activeCount(), 0);
        assert.deepEqual({name: c.name, email: c.email, tz: c.tz, status: c.status, createdAt: c.createdAt},
            {name: 'Kettenfett RC', email: 'captain@example.org', tz: 'Europe/Berlin', status: 'pending', createdAt: new Date(START).toISOString()});
        assert.deepEqual(c.tokens.map(tk => [tk.kind, tk.state, tk.hash]), [['link', 'pending', tokenHash(tok)]]);

        // the link opens it (Task 3)
        const open = await get(srv.base, `/m/${tok}`);
        assert.equal(open.status, 200);
        assert.match(await open.text(), /Open Kettenfett RC/);
        await activate(srv, tok);
        assert.equal(srv.store.get(c.id).status, 'active');
    } finally {
        await srv.stop();
    }
});


test('register: an internationalized domain', async () => {
    const srv = await setup();
    try {
        const res = await register(srv, {email: ' Captain@Bücher.de '});
        assert.equal(res.status, 200);
        assert.match(res.text, /Check your inbox\./);
        assert.deepEqual(srv.mailer.sent.map(m => m.to), ['Captain@xn--bcher-kva.de']);
        const [tok] = linksOf(srv.mailer);
        assert.equal(srv.store.pending()[0].email, 'Captain@xn--bcher-kva.de');
        await activate(srv, tok);
        // /lost finds it under the address as typed
        await post(srv.base, '/lost', {email: 'captain@bücher.de'});
        await settle();
        assert.deepEqual(srv.mailer.sent.map(m => m.subject),
            ['Paceline: confirm your club Kettenfett RC', 'Paceline: new link for Kettenfett RC']);
        linksOf(srv.mailer);
        // a non-ASCII local part cannot be sent (no SMTPUTF8): a form message
        const bad = await register(srv, {name: 'Spokesmen CC', email: 'kapitän@example.org'});
        assert.equal(bad.status, 400);
        assert.match(bad.text, /Enter an e-mail address/);
        assert.equal(srv.mailer.sent.length, 2);
    } finally {
        await srv.stop();
    }
});


test('register: the checkbox and the fields are required', async () => {
    const srv = await setup();
    try {
        const cases = [
            [without(REG, 'riders'), /Tick the box/],
            [{...REG, email: 'nope'}, /Enter an e-mail address/],
            [{...REG, tz: 'Mars/Base'}, /Choose a time zone from the list\./],
            [{...REG, name: 'K'}, /Use 2 to 60 characters/],
            [{...REG, email: '"><script>alert(1)</script>@example.org'}, /Enter an e-mail address/],
        ];
        for (const [form, message] of cases) {
            const res = await post(srv.base, '/register', form);
            const body = await res.text();
            assert.equal(res.status, 400, JSON.stringify(form));
            assert.match(textOf(body), message);
            assert.doesNotMatch(body, /<script/i);
            assert.match(body, /<form class="stack" method="post" action="\/register">/, 'the form again');
            assert.ok(body.includes(RIDERS_TEXT));
        }
        await settle();
        // what was typed comes back (from another client address: invalid posts count against the limit)
        const again = await (await post(srv.base, '/register', {...REG, tz: 'Europe/London', email: 'nope'}, {xff: '203.0.113.20'})).text();
        assert.match(again, /<input type="text" name="name" value="Kettenfett RC"/);
        assert.match(again, /<input type="email" name="email" value="nope"/);
        assert.match(again, /<option value="Europe\/London" selected>/);
        assert.match(again, /<input type="checkbox" name="riders" required checked>/);
        await settle();
        assert.equal(srv.mailer.sent.length, 0);
        assert.equal(srv.store.pendingCount(), 0);
    } finally {
        await srv.stop();
    }
});


test('register: name keys', async () => {
    const srv = await setup();
    try {
        srv.store.create(activeClub({id: CID}));
        const taken = await register(srv, {name: 'KETTENFETT R.C.', email: 'other@example.org'});
        assert.equal(taken.status, 409);
        assert.match(taken.text, /This name is taken\. Choose another\./);
        assert.match(taken.body, /<input type="text" name="name" value="KETTENFETT R\.C\."/);

        const cyrillic = await register(srv, {name: 'Kettenfеtt RC', email: 'other@example.org'});
        assert.equal(cyrillic.status, 400);
        assert.match(cyrillic.text, /Use 2 to 60 characters, in Latin letters or digits\./);

        srv.store.create(activeClub({id: CID2, name: 'Spokesmen CC'}));
        srv.store.trash(CID2);
        const trashed = await register(srv, {name: 'spokesmen cc', email: 'other@example.org'});
        assert.equal(trashed.status, 409);
        assert.match(trashed.text, /This name is taken\./);

        // a field error comes before the taken name
        const both = await register(srv, {name: 'Kettenfett RC', email: 'nope'});
        assert.equal(both.status, 400);
        assert.equal(srv.mailer.sent.length, 0);
        assert.equal(srv.store.pendingCount(), 0);
    } finally {
        await srv.stop();
    }
});


test('register limits are silent', async () => {
    const srv = await setup();
    try {
        // 5 POSTs an hour per client address, whatever they hold: 3 clubs (the most one address
        // starts a day), then two with a taken name (409), and the 6th gets the neutral answer even
        // though its name is taken: only the per-address limit answers that way.
        srv.store.create(activeClub({id: 'q2w3e4r5t6', name: 'Taken CC'}));
        const first = await register(srv, {name: 'Club 1', email: 'c1@example.org'}, {xff: '203.0.113.7'});
        assert.equal(first.status, 200);
        assert.match(first.text, /Check your inbox\. The link works for 24 hours\./);
        for (let i = 2; i <= 3; i++) {
            srv.clock.now += 60000;
            const res = await register(srv, {name: `Club ${i}`, email: `c${i}@example.org`}, {xff: '203.0.113.7'});
            assert.equal(res.body, first.body, `POST ${i}: the same answer`);
        }
        for (let i = 4; i <= 5; i++) {
            const res = await register(srv, {name: 'Taken CC', email: `c${i}@example.org`}, {xff: '203.0.113.7'});
            assert.equal(res.status, 409, `POST ${i}`);
        }
        const sixth = await register(srv, {name: 'Taken CC', email: 'c6@example.org'}, {xff: '203.0.113.7'});
        assert.equal(sixth.status, 200);
        assert.equal(sixth.body, first.body, 'the 6th POST: the same answer');
        assert.equal(srv.mailer.sent.length, 3);
        assert.equal(srv.store.pendingCount(), 3);
        // the limit is per client address
        const other = await register(srv, {name: 'Club 7', email: 'c7@example.org'}, {xff: '203.0.113.8'});
        assert.equal(other.body, first.body);
        assert.equal(srv.mailer.sent.length, 4);
        // and over an hour later the first address is checked again (a taken name: 409)
        srv.clock.now = START + 3600000 + 1;
        assert.equal((await register(srv, {name: 'Taken CC', email: 'c8@example.org'}, {xff: '203.0.113.7'})).status, 409);

        // a 4th club for one address (active and pending count, in any case)
        srv.store.create({...activeClub({id: CID}), email: 'Captain@Example.org'});
        seedPending(srv.store, srv.clock.now, {id: CID2, name: 'Spokesmen CC', email: 'CAPTAIN@example.org'});
        seedPending(srv.store, srv.clock.now, {id: 'm4q7d2s9pk', name: 'Rollers CC', email: 'captain@example.org'});
        const pendingBefore = srv.store.pendingCount();
        const fourth = await register(srv, {name: 'Sprockets CC', email: 'captain@EXAMPLE.org'}, {xff: '203.0.113.9'});
        assert.equal(fourth.status, 200);
        assert.equal(fourth.body, first.body);
        assert.equal(srv.mailer.sent.length, 4);
        assert.equal(srv.store.pendingCount(), pendingBefore);

        // 20 pending clubs: the 21st gets the same answer and no mail
        seedPendingMany(srv.store, 19 - srv.store.pendingCount(), srv.clock.now);
        assert.equal(srv.store.pendingCount(), 19);
        await register(srv, {name: 'Twentieth CC', email: 'c20@example.org'}, {xff: '203.0.113.10'});
        assert.equal(srv.store.pendingCount(), 20);
        assert.equal(srv.mailer.sent.length, 5);
        const over = await register(srv, {name: 'Twentyfirst CC', email: 'c21@example.org'}, {xff: '203.0.113.11'});
        assert.equal(over.status, 200);
        assert.equal(over.body, first.body);
        assert.equal(srv.mailer.sent.length, 5);
        assert.equal(srv.store.pendingCount(), 20);
        linksOf(srv.mailer);
    } finally {
        await srv.stop();
    }
});


test('register: at most 3 new clubs per client address and day', async () => {
    const srv = await setup();
    try {
        const first = await register(srv, {name: 'Club 1', email: 'c1@example.org'}, {xff: '203.0.113.7'});
        for (let i = 2; i <= 4; i++) {
            srv.clock.now += 60000;
            const res = await register(srv, {name: `Club ${i}`, email: `c${i}@example.org`}, {xff: '203.0.113.7'});
            assert.equal(res.status, 200);
            assert.equal(res.body, first.body, `POST ${i}: the same answer`);
        }
        assert.equal(srv.store.pendingCount(), 3);
        assert.equal(srv.mailer.sent.length, 3);
        // another client address is not affected
        await register(srv, {name: 'Club 5', email: 'c5@example.org'}, {xff: '203.0.113.8'});
        assert.equal(srv.store.pendingCount(), 4);
        // a day after the first one, that address may start a club again (the hourly windows allow it)
        srv.clock.now = START + 24 * 3600000;
        await register(srv, {name: 'Club 6', email: 'c6@example.org'}, {xff: '203.0.113.7'});
        assert.equal(srv.mailer.sent.length, 5);
        linksOf(srv.mailer);
        // the address is kept in memory only, never in a club file
        for (const c of srv.store.pending()) {
            assert.doesNotMatch(JSON.stringify(c), /203\.0\.113/);
        }
    } finally {
        await srv.stop();
    }
});


test('register: a refused mail does not count against the address', async () => {
    const srv = await setup({refuse: true});
    try {
        for (let i = 1; i <= 3; i++) {
            await register(srv, {name: `Club ${i}`, email: `c${i}@example.org`}, {xff: '203.0.113.7'});
        }
        srv.mailer.refuse = false;
        await register(srv, {name: 'Club 4', email: 'c4@example.org'}, {xff: '203.0.113.7'});
        assert.equal(srv.store.pendingCount(), 1);
        linksOf(srv.mailer);
    } finally {
        await srv.stop();
    }
});


test('rate-limit counters go once their windows have passed', async () => {
    const srv = await setup();
    try {
        await register(srv, {}, {xff: '203.0.113.7'});
        await post(srv.base, '/lost', {email: 'nobody@example.org'}, {xff: '203.0.113.7'});
        await settle();
        linksOf(srv.mailer);
        const {web} = srv.server;
        assert.deepEqual([web.register.size(), web.lost.size(), web.newClubs.size()], [1, 1, 1]);
        srv.clock.now = START + 24 * 3600000 - 1;
        srv.server.sweepLimits();
        assert.deepEqual([web.register.size(), web.lost.size(), web.newClubs.size()], [1, 1, 1], 'inside the day');
        srv.clock.now = START + 24 * 3600000;
        const sweeps = srv.mailer.sweeps;
        srv.server.sweepLimits();
        assert.deepEqual([web.register.size(), web.lost.size(), web.newClubs.size()], [0, 0, 0]);
        assert.equal(srv.mailer.sweeps, sweeps + 1, 'the mailer\'s counters are swept too');
    } finally {
        await srv.stop();
    }
});


test('register: a refused confirm mail leaves no pending club', async () => {
    const srv = await setup({refuse: true});
    try {
        const res = await register(srv);
        assert.equal(res.status, 200);
        assert.match(res.text, /Check your inbox\. The link works for 24 hours\./);
        assert.equal(srv.store.pendingCount(), 0);
        assert.equal(srv.mailer.sent.length, 0);
        assert.deepEqual(srv.store.pending(), []);
    } finally {
        await srv.stop();
    }
});


test('register: a failed write after the answer', async () => {
    const srv = await setup();
    try {
        const create = srv.store.create;
        srv.store.create = () => {
            throw new ClubError('too-big');
        };
        const logged = captured.length;
        const res = await register(srv);
        assert.equal(res.status, 200);
        assert.match(res.text, /Check your inbox\. The link works for 24 hours\./);
        assert.deepEqual(captured.slice(logged), ['paceline-server: register: too-big']);
        assert.equal(srv.mailer.sent.length, 0, 'no mail carries a link that was never stored');
        srv.store.create = create;
    } finally {
        await srv.stop();
    }
});


test('register: closed', async () => {
    const srv = await setup({env: {...ENV, REGISTRATION: 'closed'}});
    try {
        const page1 = await get(srv.base, '/register');
        const body1 = await page1.text();
        assert.equal(page1.status, 200);
        assert.match(textOf(body1), /Registration is closed\./);
        assert.doesNotMatch(body1, /<form/);
        const res = await register(srv);
        assert.equal(res.status, 200);
        assert.match(res.text, /Registration is closed\./);
        assert.equal(srv.mailer.sent.length, 0);
        assert.equal(srv.store.pendingCount(), 0);

        // the admin switch (the registration setting) wins over REGISTRATION
        srv.store.setRegistration('open');
        assert.match(await (await get(srv.base, '/register')).text(), /<form class="stack" method="post" action="\/register">/);
        const open = await register(srv);
        assert.match(open.text, /Check your inbox\./);
        assert.equal(srv.mailer.sent.length, 1);
        linksOf(srv.mailer);
    } finally {
        await srv.stop();
    }
    const switched = await setup();
    try {
        switched.store.setRegistration('closed');
        assert.match(textOf(await (await get(switched.base, '/register')).text()), new RegExp(CLOSED.replace('.', '\\.')));
        assert.match((await register(switched)).text, /Registration is closed\./);
        assert.equal(switched.mailer.sent.length, 0);
    } finally {
        await switched.stop();
    }
    // no room for new clubs
    const full = await setup({env: {...ENV, MAX_CIRCLES: '1'}});
    try {
        full.store.create(activeClub({id: CID}));
        assert.match((await register(full, {name: 'Spokesmen CC'})).text, /Registration is closed\./);
        assert.equal(full.mailer.sent.length, 0);
    } finally {
        await full.stop();
    }
    // without mail
    const plain = await startServer({clock: {now: START}});
    try {
        assert.equal(plain.server.mailer, null);
        const body = await (await get(plain.base, '/register')).text();
        assert.match(textOf(body), /Registration is closed\./);
        assert.doesNotMatch(body, /<form/);
        const res = await post(plain.base, '/register', REG);
        assert.match(textOf(await res.text()), /Registration is closed\./);
        await settle();
        assert.equal(plain.store.pendingCount(), 0);
    } finally {
        await plain.stop();
    }
});


test('lost link: a per-IP limit', async () => {
    const srv = await setup();
    try {
        await activate(srv, seedPending(srv.store, START));
        const first = await post(srv.base, '/lost', {email: 'captain@example.org'}, {xff: '203.0.113.7'});
        const firstBody = await first.text();
        await settle();
        for (let i = 2; i <= 6; i++) {
            srv.clock.now += 1000;
            const res = await post(srv.base, '/lost', {email: 'captain@example.org'}, {xff: '203.0.113.7'});
            assert.equal(res.status, 200);
            assert.equal(await res.text(), firstBody);
            await settle();
        }
        assert.equal(srv.mailer.sent.length, 5, 'the 6th POST from that address does nothing');
        const pendingLinks = srv.store.get(CID).tokens.filter(tk => tk.state === 'pending').length;
        await post(srv.base, '/lost', {email: 'captain@example.org'}, {xff: '203.0.113.8'});
        await settle();
        assert.equal(srv.mailer.sent.length, 6, 'another address still works');
        assert.equal(pendingLinks, 3);
        linksOf(srv.mailer);
    } finally {
        await srv.stop();
    }
});


test('privacy page', async () => {
    const srv = await setup({env: {...ENV, PRIVACY_CONTACT: 'Paceline beta, privacy@example.org'}});
    try {
        const res = await get(srv.base, '/privacy');
        const body = await res.text();
        const text = textOf(body);
        assert.equal(res.status, 200);
        assert.ok(text.includes('Paceline beta, privacy@example.org'), 'the contact');
        // the text keeps the apostrophe as an entity
        assert.match(text, /6\(1\)\(b\) for the club, 6\(1\)\(f\) for plans and delivery, 6\(1\)\(a\) for the uploading rider(&#39;|')s own data in recordings, 6\(1\)\(f\) for the rows of the other plan riders in them/, 'the legal bases');
        assert.match(text, /own team and in the same race, the data is what every rider in the race sees, there is no heart rate or cadence, only the operator opens the files/);
        assert.match(text, /Recordings of a race[^.]*The operator\. The club sees the list and can delete a recording\./, 'who sees recordings');
        assert.doesNotMatch(text, /Recordings of a race[^.]*That club/);
        assert.match(text, /untick the box in Paceline/);
        assert.match(text, /already uploaded are deleted by your captain or, on request, by the operator/);
        assert.match(text, /deleted data can stay in backups for up to 6 months\./);
        assert.match(text, /Database dumps: 7 days; the operator(&#39;|')s backups of the whole server \(recordings included\): 6 months/);
        assert.doesNotMatch(text, /An archive file that cannot be read/);
        assert.doesNotMatch(text, /in backups for up to 14 days/);
        assert.match(text, /from 30 minutes before the start/);
        assert.match(text, /smtp\.example\.org/, 'the mail provider');
        assert.match(text, /W\/kg/);
        assert.match(text, /no height, no FTP/i);
        assert.match(text, /only its hash is stored/i);
        assert.match(text, /only of riders the club lists/);
        assert.match(text, /listed by your club/);
        assert.match(text, /supervisory authority/);
        assert.match(text, /__Host-pl_club keeps the links of up to 5 clubs in this browser; each time the server sets it \(opening, switching, logging out …\), all of them are kept for another 400 days\. Log out removes that club, Log out of all clubs removes them all\./);
        // both cookies: the club link and the flash after an action
        assert.match(text, /__Host-pl_flash carries the id of a one-line message after an action for up to 5 minutes/);
        assert.match(body, /<h2>Cookies<\/h2>/);
        assert.doesNotMatch(text, /GDPR compliant/i);
        for (const h of ['Who is responsible', 'What is kept', 'Legal bases', 'Where the data comes from',
            'Who processes it', 'How long', 'Cookie', 'Your rights']) {
            assert.match(body, new RegExp(`<h2>${h}`), h);
        }
        assert.match(body, /<table class="ptable">/);
    } finally {
        await srv.stop();
    }
    const plain = await startServer({clock: {now: START}, env: {PRIVACY_CONTACT: '<b>Kettenfett</b>'}});
    try {
        const body = await (await get(plain.base, '/privacy')).text();
        assert.ok(body.includes('&lt;b&gt;Kettenfett&lt;/b&gt;'), 'escaped');
        assert.match(textOf(body), /No mail provider is set up/);
    } finally {
        await plain.stop();
    }
    const none = await startServer({clock: {now: START}});
    try {
        const text = textOf(await (await get(none.base, '/privacy')).text());
        assert.match(text, /has not named a contact/);
        assert.match(text, /delete a recording\.90 days/, 'recordings: the default retention');
    } finally {
        await none.stop();
    }
    // backups: BACKUP_RETENTION_MONTHS
    const month = await startServer({clock: {now: START}, env: {BACKUP_RETENTION_MONTHS: '1'}});
    try {
        const text = textOf(await (await get(month.base, '/privacy')).text());
        assert.match(text, /deleted data can stay in backups for up to 1 month\./);
        assert.match(text, /Database dumps: 7 days; the operator(&#39;|')s backups of the whole server \(recordings included\): 1 month/);
        assert.doesNotMatch(text, /1 months|6 months/);
    } finally {
        await month.stop();
    }
    // recordings: LOG_RETENTION_DAYS, and 0 keeps them
    for (const [days, kept] of [['30', /delete a recording\.30 days/], ['0', /delete a recording\.until the club deletes them/]]) {
        const srv2 = await startServer({clock: {now: START}, env: {LOG_RETENTION_DAYS: days}});
        try {
            const text = textOf(await (await get(srv2.base, '/privacy')).text());
            assert.match(text, kept, days);
            assert.doesNotMatch(text, /delete a recording\.90 days/, days);
        } finally {
            await srv2.stop();
        }
    }
});


test('privacy page: what the mod sends, the lookup by Zwift ID, where data is processed', async () => {
    const wording = 'When you are in a Zwift event, and when you open these settings, Paceline sends the plan server your Zwift ID, '
        + 'the clubs you ticked, the codes of private clubs you added, your event\'s start time and id, your plan code and the '
        + 'Paceline version. A club you ticked sees when you last checked.';
    const where = 'The plan server and its mail server run on example servers in Germany (EU). No data leaves the EU.';
    const srv = await setup({env: {...ENV, PRIVACY_WHERE: `  ${where} <b>x</b> `}});
    try {
        const body = await (await get(srv.base, '/privacy')).text();
        const text = textOf(body).replaceAll('&#39;', "'");
        assert.ok(text.includes(wording), 'the mod\'s check text, verbatim');
        assert.match(body, /<h2>When Paceline checks/);
        assert.match(body, /<h2>Looking up a Zwift ID/);
        assert.match(text, /Anyone who knows a Zwift ID can ask the server which open clubs list it, and sees the label, team and start time/);
        assert.match(text, /goes only to a check in its race, from 30 minutes before the start/);
        assert.match(text, /A private club shows nothing without its code\. Weight is in the plans for W\/kg\./);
        assert.match(body, /<h2>Where data is processed<\/h2>\n<p>The plan server and its mail server run on example servers in Germany \(EU\)\. No data leaves the EU\. &lt;b&gt;x&lt;\/b&gt;<\/p>/,
            'trimmed and escaped');
        assert.doesNotMatch(text, /Ask the contact above/);
    } finally {
        await srv.stop();
    }
    const none = await startServer({clock: {now: START}});
    try {
        const body = await (await get(none.base, '/privacy')).text();
        assert.match(body, /<h2>Where data is processed<\/h2>\n<p>Ask the contact above where the plan server and its mail server are hosted\.<\/p>/);
        assert.ok(textOf(body).replaceAll('&#39;', "'").includes(wording));
    } finally {
        await none.stop();
    }
});


test('privacy: plans with versions, the inbox, plan codes in recordings', async () => {
    const srv = await setup({env: ENV});
    try {
        const body = await (await get(srv.base, '/privacy')).text();
        const text = textOf(body).replaceAll('&#39;', "'");
        for (const s of ['Plans and their versions', 'every version of the team\'s plans of this race', 'until stored or discarded, an upload at most 24 hours, a plan from ZwiftGopher at most 7 days',
            'with the plan codes found in them', 'should never hold rider names']) {
            assert.ok(text.includes(s), s);
        }
        // the inbox row comes right after the plans' row
        assert.match(body, /should never hold rider names\.<\/td><\/tr>\n<tr><td>Plans waiting to be stored \(inbox\), uploaded or sent from ZwiftGopher: the same plan data and the import warnings<\/td><td>People with the club link<\/td><td>until stored or discarded, an upload at most 24 hours, a plan from ZwiftGopher at most 7 days<\/td><\/tr>\n<tr><td>The rider code of a private club/);
        assert.match(text, /sees the label, team and start time of the plans that list it/);
        for (const gone of [/an undo copy/i, /last two/i, /\bsheets?\b/i]) {
            assert.doesNotMatch(text, gone);
        }
    } finally {
        await srv.stop();
    }
});


// ---- address change and delete, confirmed by mail (Task 8) ----

const CONFIRM_RE = /https:\/\/ttt-beta\.example\.org\/t\/([A-Za-z0-9_-]{22})/;

// The /t/ token of the mailer's n-th mail (kept for the log check).
function confirmOf(mailer, n) {
    const tok = CONFIRM_RE.exec(mailer.sent[n].text)?.[1];
    assert.ok(tok, `mail ${n} carries a /t/ link`);
    TOKENS.add(tok);
    return tok;
}

// The kinds of a club's tokens, as kind/action or kind/state.
const tokenKinds = club => club.tokens.map(tk => `${tk.kind}/${tk.action ?? tk.state ?? ''}`);

const ENV_CONTACT = {...ENV, PRIVACY_CONTACT: 'privacy@example.org'};


test('GET /t is inert', async () => {
    const srv = await setup();
    try {
        const cookie = await activate(srv, seedPending(srv.store, START));
        assert.equal((await post(srv.base, '/manage/email', {email: 'new@example.org'}, {cookie})).status, 303);
        assert.equal((await post(srv.base, '/manage/delete', {}, {cookie})).status, 303);
        const change = confirmOf(srv.mailer, 0);
        const del = confirmOf(srv.mailer, 1);
        const before = structuredClone(srv.store.get(CID));

        const a = await get(srv.base, `/t/${change}`);
        const aBody = await a.text();
        assert.equal(a.status, 200);
        assert.match(aBody, /<form method="post" action="\/t\/[A-Za-z0-9_-]{22}"><button class="btn primary block" type="submit">Change the address to n…@example\.org<\/button><\/form>/);
        assert.doesNotMatch(aBody, /new@example/);
        assert.equal(a.headers.get('set-cookie'), null);
        const d = await get(srv.base, `/t/${del}`, cookie);
        assert.equal(d.status, 200);
        assert.match(await d.text(), /<form method="post" action="\/t\/[A-Za-z0-9_-]{22}"><button class="btn danger block" type="submit">Delete Kettenfett RC<\/button><\/form>/);
        assert.equal(d.headers.get('set-cookie'), null);
        assert.deepEqual(srv.store.get(CID), before, 'nothing changed');
        assert.equal(srv.mailer.sent.length, 2, 'no mail from a GET');

        const bad = await get(srv.base, '/t/AAAAAAAAAAAAAAAAAAAAAA');
        assert.equal(bad.status, 404);
        assert.match(textOf(await bad.text()), /This link is not valid\./);
        // a club link is no confirmation (F5), and a confirmation no club link
        const linkTok = cookie.split('=')[1];
        assert.equal((await get(srv.base, `/t/${linkTok}`)).status, 404);
        assert.equal((await post(srv.base, `/t/${linkTok}`)).status, 404);
        assert.equal((await get(srv.base, `/m/${change}`)).status, 404);
        for (const p of ['/t/short', `/t/${change}/x`, '/t/']) {
            assert.equal((await get(srv.base, p)).status, 404, p);
        }
        assert.equal((await fetch(`${srv.base}/t/${change}`, {method: 'PUT'})).status, 405);
        assert.deepEqual(srv.store.get(CID), before, 'still nothing changed');
    } finally {
        await srv.stop();
    }
});


test('address change: the current address confirms, then the new one', async () => {
    const srv = await setup({env: ENV_CONTACT});
    try {
        const cookie = await activate(srv, seedPending(srv.store, START));
        const res = await post(srv.base, '/manage/email', {email: 'new@example.org'}, {cookie});
        const body = await followed(srv, res, cookie);
        assert.deepEqual(flashOf(body), {kind: 'ok', text: 'We sent a confirmation to c…@example.org.'});
        assert.doesNotMatch(body, /captain@|new@/);
        assert.equal(srv.mailer.sent.length, 1);
        const m0 = srv.mailer.sent[0];
        assert.deepEqual({kind: m0.kind, to: m0.to, subject: m0.subject, budget: m0.budget}, {
            kind: 'confirm-email', to: 'captain@example.org', budget: 'other',
            subject: 'Paceline: confirm: change the address of Kettenfett RC',
        });
        // the owner of the current address sees in full what he approves (a typo included); the
        // mail carries nothing else of the club's: not its own address, no club link
        assert.match(m0.text, /to new@example\.org\./);
        assert.doesNotMatch(m0.text, /captain@|\/m\//);
        assert.equal(m0.text.match(/[A-Za-z0-9_-]{22}/g).length, 1, 'one token: the confirm link');
        const confirm = confirmOf(srv.mailer, 0);
        assert.equal(srv.store.get(CID).email, 'captain@example.org', 'unchanged before the confirmation');
        assert.deepEqual(tokenKinds(srv.store.get(CID)), ['link/active', 'confirm/email']);

        const first = await post(srv.base, `/t/${confirm}`);
        assert.equal(first.status, 200);
        assert.match(textOf(await first.text()), /Now confirm from the new address: we sent it a link\./);
        assert.equal(srv.mailer.sent.length, 2);
        const m1 = srv.mailer.sent[1];
        assert.deepEqual({kind: m1.kind, to: m1.to, subject: m1.subject, budget: m1.budget}, {
            kind: 'new-address', to: 'new@example.org', budget: 'other',
            subject: 'Paceline: confirm the new address for Kettenfett RC',
        });
        const email = confirmOf(srv.mailer, 1);
        assert.equal(srv.store.get(CID).email, 'captain@example.org', 'unchanged until the new address confirms');
        assert.deepEqual(tokenKinds(srv.store.get(CID)), ['link/active', 'email/']);
        assert.equal((await post(srv.base, `/t/${confirm}`)).status, 404, 'the confirm link works once');
        assert.equal(srv.mailer.sent.length, 2);
        // what the old address got meanwhile: a pending club link and a delete confirmation
        assert.equal((await post(srv.base, '/manage/newlink', {}, {cookie})).status, 303);
        assert.equal((await post(srv.base, '/manage/delete', {}, {cookie})).status, 303);
        const [oldLink] = linksOf({sent: [srv.mailer.sent[2]]});
        const oldDelete = confirmOf(srv.mailer, 3);
        assert.deepEqual(srv.mailer.sent.slice(2).map(m => m.to), ['captain@example.org', 'captain@example.org']);
        assert.deepEqual(tokenKinds(srv.store.get(CID)), ['link/active', 'email/', 'link/pending', 'confirm/delete']);

        const page = await get(srv.base, `/t/${email}`);
        assert.equal(page.status, 200);
        assert.match(await page.text(), /<button class="btn primary block" type="submit">Confirm the new address<\/button>/);
        const second = await post(srv.base, `/t/${email}`);
        assert.equal(second.status, 200);
        assert.match(textOf(await second.text()), /The address is changed\./);
        const club = srv.store.get(CID);
        assert.equal(club.email, 'new@example.org');
        assert.deepEqual(tokenKinds(club), ['link/active'], 'the active club link stays, the old address keeps nothing');
        assert.deepEqual(club.log.at(-1), {at: '2026-11-16T10:00:00.000Z', what: 'address-changed'}, 'no address in the log');
        assert.equal(srv.mailer.sent.length, 5);
        const m2 = srv.mailer.sent[4];
        assert.deepEqual({kind: m2.kind, to: m2.to, subject: m2.subject, budget: m2.budget}, {
            kind: 'address-changed', to: 'captain@example.org', budget: 'other',
            subject: 'Paceline: the address of Kettenfett RC was changed',
        });
        assert.match(m2.text, /n…@example\.org/);
        assert.doesNotMatch(m2.text, /new@example\.org/);
        assert.match(m2.text, /Not you\? Contact privacy@example\.org\.\n$/);
        assert.equal((await post(srv.base, `/t/${email}`)).status, 404, 'the email link works once');
        assert.equal(srv.store.get(CID).email, 'new@example.org');

        // the old address's pending link and delete confirmation end with the change
        assert.equal((await get(srv.base, `/m/${oldLink}`)).status, 404);
        assert.equal((await post(srv.base, `/m/${oldLink}`)).status, 404);
        assert.equal((await post(srv.base, `/t/${oldDelete}`)).status, 404);
        assert.ok(srv.store.get(CID), 'not deleted');
        const manage = await get(srv.base, '/manage/settings', cookie);
        assert.equal(manage.status, 200, 'the club link still works');
        assert.match(await manage.text(), /Club e-mail <strong>n…@example\.org<\/strong>/);
    } finally {
        await srv.stop();
    }
});


test('address change: the notice without PRIVACY_CONTACT, a bad address, an internationalized domain', async () => {
    const srv = await setup();
    try {
        const cookie = await activate(srv, seedPending(srv.store, START));
        const bad = await post(srv.base, '/manage/email', {email: 'not an address'}, {cookie});
        assert.equal(bad.status, 400);
        assert.match(textOf(await bad.text()), /Enter an e-mail address/);
        assert.equal(srv.mailer.sent.length, 0);
        assert.deepEqual(tokenKinds(srv.store.get(CID)), ['link/active']);

        assert.equal((await post(srv.base, '/manage/email', {email: ' eva@bücher.de '}, {cookie})).status, 303);
        assert.equal(srv.store.get(CID).tokens[1].email, 'eva@xn--bcher-kva.de');
        assert.equal((await post(srv.base, `/t/${confirmOf(srv.mailer, 0)}`)).status, 200);
        assert.equal(srv.mailer.sent[1].to, 'eva@xn--bcher-kva.de');
        assert.equal((await post(srv.base, `/t/${confirmOf(srv.mailer, 1)}`)).status, 200);
        assert.equal(srv.store.get(CID).email, 'eva@xn--bcher-kva.de');
        assert.match(srv.mailer.sent[2].text, /Not you\? See https:\/\/ttt-beta\.example\.org\/privacy\.\n$/);
        assert.ok(srv.mailer.sent[2].html.includes('Not you? See <a href="https://ttt-beta.example.org/privacy"'));
    } finally {
        await srv.stop();
    }
});


test('a leaked link alone can\'t take the address or delete', async () => {
    const srv = await setup();
    try {
        const cookie = await activate(srv, seedPending(srv.store, START));
        const before = structuredClone(srv.store.get(CID));
        assert.equal((await post(srv.base, '/manage/email', {email: 'thief@example.net'}, {cookie})).status, 303);
        assert.equal((await post(srv.base, '/manage/delete', {}, {cookie})).status, 303);
        assert.deepEqual(srv.mailer.sent.map(m => [m.kind, m.to]), [
            ['confirm-email', 'captain@example.org'], ['confirm-delete', 'captain@example.org'],
        ], 'only the current address hears of it');
        assert.match(srv.mailer.sent[0].text, /to thief@example\.net\./, 'the current address sees the new one in full');
        assert.doesNotMatch(srv.mailer.sent[1].text, /thief@/);
        const club = srv.store.get(CID);
        assert.equal(club.email, 'captain@example.org');
        assert.equal(club.status, 'active');
        assert.deepEqual({...club, tokens: before.tokens}, before, 'only two confirmations were added');
        assert.deepEqual(tokenKinds(club), ['link/active', 'confirm/email', 'confirm/delete']);
        assert.equal((await get(srv.base, '/manage', cookie)).status, 200);

        // a cross-site POST with a mailed token changes nothing either
        const tok = confirmOf(srv.mailer, 1);
        assert.equal((await post(srv.base, `/t/${tok}`, {}, {cookie, site: 'cross-site'})).status, 403);
        assert.ok(srv.store.get(CID), 'still there');
        // only the /t/ POST acts
        assert.equal((await post(srv.base, `/t/${tok}`)).status, 200);
        assert.equal(srv.store.get(CID), null);
    } finally {
        await srv.stop();
    }
});


test('delete: gone at once for riders', async () => {
    const srv = await setup();
    try {
        const cookie = await activate(srv, seedPending(srv.store, START));
        const res = await post(srv.base, '/manage/delete', {}, {cookie});
        assert.deepEqual(flashOf(await followed(srv, res, cookie)), {kind: 'ok', text: 'We sent a confirmation to c…@example.org.'});
        const m = srv.mailer.sent[0];
        assert.deepEqual({kind: m.kind, to: m.to, subject: m.subject, budget: m.budget}, {
            kind: 'confirm-delete', to: 'captain@example.org', budget: 'other', subject: 'Paceline: confirm: delete Kettenfett RC',
        });
        const tok = confirmOf(srv.mailer, 0);
        assert.ok(srv.store.get(CID), 'still there before the confirmation');

        const done = await post(srv.base, `/t/${tok}`, {}, {cookie});
        assert.equal(done.status, 200);
        assert.match(textOf(await done.text()), /Kettenfett RC is deleted\. The operator can restore it within 7 days\./);
        assert.equal(done.headers.get('set-cookie'), CLEARED);
        assert.equal(srv.store.get(CID), null);
        const [row] = rows(srv.server.db, 'SELECT json FROM trash WHERE cid = ?', CID);
        const trashed = JSON.parse(row.json);
        assert.deepEqual(tokenKinds(trashed), ['link/active'], 'no confirmation goes into the trash');
        assert.equal(trashed.log.at(-1).what, 'club-deleted');

        const api = await fetch(`${srv.base}/api/v3/rider/1001?mod=0.3.0&joined=${CID}`);
        assert.equal(api.status, 200);
        assert.deepEqual((await api.json()).circles, [{id: CID, gone: true}]);
        const manage = await get(srv.base, '/manage', cookie);
        assert.equal(manage.status, 303, 'the club link ends');
        assert.equal(manage.headers.get('location'), '/');
        assert.equal((await post(srv.base, '/manage/newlink', {}, {cookie})).status, 403);
        assert.equal((await post(srv.base, `/t/${tok}`)).status, 404, 'the delete link works once');
        assert.equal(srv.mailer.sent.length, 1);
    } finally {
        await srv.stop();
    }
});


test('delete: a failed trash changes nothing', async () => {
    const srv = await setup();
    try {
        const cookie = await activate(srv, seedPending(srv.store, START));
        await post(srv.base, '/manage/delete', {}, {cookie});
        const tok = confirmOf(srv.mailer, 0);
        const before = structuredClone(srv.store.get(CID));
        // paceline.db refuses the trash row (a full disk): trash() changes nothing, and the delete
        // takes its first change back
        const undo = refuseWrites(srv.server.db, 'trash', ['INSERT']);
        let res;
        try {
            res = await post(srv.base, `/t/${tok}`, {}, {cookie});
        } finally {
            undo();
        }
        assert.equal(res.status, 500);
        assert.match(textOf(await res.text()), /The club could not be deleted\. Nothing changed; try again later\./);
        assert.equal(res.headers.get('set-cookie'), null, 'the cookie stays');
        assert.deepEqual(srv.store.get(CID), before, 'the club as it was, the confirm link included');
        assert.equal((await get(srv.base, '/manage', cookie)).status, 200);
        assert.equal((await get(srv.base, `/t/${tok}`)).status, 200, 'the confirm link still works');
        assert.deepEqual(rows(srv.server.db, 'SELECT cid FROM trash'), []);
        assert.equal((await post(srv.base, `/t/${tok}`)).status, 200);
        assert.equal(srv.store.get(CID), null);
    } finally {
        await srv.stop();
    }
});


// ---- several clubs in one browser: the club cookie holds up to CLUB_COOKIE_MAX links ----

// Made-up clubs, each with its own address; CLUBS[0] is CID.
const CLUBS = [
    {id: CID, name: 'Kettenfett RC', email: 'captain@example.org'},
    {id: CID2, name: 'Spokesmen CC', email: 'second@example.org'},
    {id: 'p2r5t8v1w3', name: 'Rollbahn Racing', email: 'third@example.org'},
    {id: 'q3s6z9x2y4', name: 'Velo Kiezrunde', email: 'fourth@example.org'},
    {id: 'h8j4n6c2b7', name: 'Draft Dodgers', email: 'fifth@example.org'},
    {id: 'd5e7g9a3r1', name: 'Echelon Elf', email: 'sixth@example.org'},
    {id: 'w6x8y2z4k1', name: 'Hinterrad Club', email: 'seventh@example.org'},
];

// `n` pending clubs with a link each; their plain tokens, in CLUBS order.
const seedClubs = (store, n) => CLUBS.slice(0, n).map(c => seedPending(store, START, c));

// A club cookie of `tokens`, joined as the server joins them.
const jar = tokens => `__Host-pl_club=${tokens.join('.')}`;

// The tokens of the club cookie a response sets ([] when it clears it), or null when it sets none.
function setTokens(res) {
    const c = res.headers.get('set-cookie');
    if (c === null) {
        return null;
    }
    if (c === CLEARED) {
        return [];
    }
    assert.match(c, MULTI_COOKIE_RE);
    return cookieOf(res).slice('__Host-pl_club='.length).split('.');
}
const MULTI_COOKIE_RE = /^__Host-pl_club=[A-Za-z0-9_-]{22}(\.[A-Za-z0-9_-]{22}){0,4}; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=34560000$/;

// The h1 of the team picker: which club /manage shows.
async function clubShown(srv, cookie) {
    const res = await get(srv.base, '/manage', cookie);
    assert.equal(res.status, 200);
    return /<h1>([^<]*)<\/h1>/.exec(await res.text())?.[1];
}

// The sidebar's footer of /manage in a browser that holds `cookie`.
async function footOf(srv, cookie) {
    const res = await get(srv.base, '/manage', cookie);
    assert.equal(res.status, 200);
    const side = /<aside class="side"[\s\S]*?<\/aside>/.exec(await res.text())[0];
    return /<footer class="foot">[\s\S]*?<\/footer>/.exec(side)[0];
}

// The club switches of a footer: [club id, the name as it stands in the page] for each.
const switchesOf = foot => [...foot.matchAll(/<form method="post" action="\/switch"><input type="hidden" name="club" value="([^"]*)"><button type="submit"><svg[^>]*>[\s\S]*?<\/svg>([^<]*)<\/button><\/form>/g)]
    .map(m => [m[1], m[2]]);

// Opens `tok` in a browser that holds `cookie`; the cookie it ends with.
async function openWith(srv, tok, cookie) {
    const res = await post(srv.base, `/m/${tok}`, {}, {cookie});
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/manage');
    return setTokens(res);
}


test('several clubs: the one-token cookie of before works as it did', async () => {
    const srv = await setup();
    try {
        const [a] = seedClubs(srv.store, 1);
        const cookie = await activate(srv, a);
        assert.equal(cookie, `__Host-pl_club=${a}`, 'one club: one token, no separator');
        assert.equal(await clubShown(srv, cookie), 'Kettenfett RC');
        const home = await get(srv.base, '/', cookie);
        assert.equal(home.status, 303);
        assert.equal(home.headers.get('location'), '/manage');
        // one club: the footer has no club switch and no Log out of all clubs
        const settings = await (await get(srv.base, '/manage/settings', cookie)).text();
        assert.doesNotMatch(settings, /action="\/switch"|action="\/logout-all"|Switch club/);
        assert.deepEqual(switchesOf(await footOf(srv, cookie)), []);
        // a GET of a working cookie sets nothing
        assert.equal((await get(srv.base, '/manage', cookie)).headers.get('set-cookie'), null);
    } finally {
        await srv.stop();
    }
});


test('several clubs: a second link keeps the first, newest first, at most 5', async () => {
    const srv = await setup();
    try {
        const toks = seedClubs(srv.store, 7);
        const [a, b, c, d, e, f, g] = toks;
        let held = await openWith(srv, a);
        assert.deepEqual(held, [a]);
        held = await openWith(srv, b, jar(held));
        assert.deepEqual(held, [b, a], 'the new club first, the first kept');
        assert.equal(await clubShown(srv, jar(held)), 'Spokesmen CC');
        // opening a club the cookie holds moves it first, once
        held = await openWith(srv, a, jar(held));
        assert.deepEqual(held, [a, b]);
        assert.equal(await clubShown(srv, jar(held)), 'Kettenfett RC');
        for (const tok of [c, d, e]) {
            held = await openWith(srv, tok, jar(held));
        }
        assert.deepEqual(held, [e, d, c, a, b]);
        // the cap: a sixth club pushes out the oldest, the last one
        held = await openWith(srv, f, jar(held));
        assert.deepEqual(held, [f, e, d, c, a]);
        assert.equal(held.length, 5);
        // the oldest club's own link still works; it is only out of this browser's cookie
        assert.equal(await clubShown(srv, `__Host-pl_club=${b}`), 'Spokesmen CC');
        // a cookie with more than 5 tokens (not one the server set) counts its first 5 only
        const six = jar([f, e, d, c, a, b]);
        const foot = await footOf(srv, six);
        assert.ok(!foot.includes(`value="${CLUBS[1].id}"`), 'the sixth token is not read');
        assert.deepEqual(switchesOf(foot).map(([id]) => id), [CLUBS[4].id, CLUBS[3].id, CLUBS[2].id, CID]);
        held = await openWith(srv, g, six);
        assert.deepEqual(held, [g, f, e, d, c], 'never more than 5');
        // a new link of a club in the cookie replaces its old token in place of first
        let fresh;
        srv.store.change(CLUBS[3].id, club => {
            fresh = addLink(club, START);
        });
        TOKENS.add(fresh);
        held = await openWith(srv, fresh, jar(held));
        assert.deepEqual(held, [fresh, g, f, e, c], 'the club once, its old token gone');
        assert.ok(srv.mailer.sent.length === 0);
    } finally {
        await srv.stop();
    }
});


test('several clubs: dead tokens drop out; the cookie is cleared only when none works', async () => {
    const srv = await setup();
    try {
        const [a, b, c] = seedClubs(srv.store, 3);
        for (const tok of [a, b, c]) {
            await activate(srv, tok);
        }
        // A's link is replaced: its token is dead
        let a2;
        srv.store.change(CID, club => {
            a2 = addLink(club, START);
            openLink(club, tokenHash(a2), START);
        });
        TOKENS.add(a2);
        // the first token is dead: the active club is the first that still works
        assert.equal(await clubShown(srv, jar([a, b])), 'Spokesmen CC');
        // a malformed piece is skipped as well
        assert.equal(await clubShown(srv, `__Host-pl_club=bad.${a}.${b}`), 'Spokesmen CC');
        const home = await get(srv.base, '/', jar([a, b, c]));
        assert.equal(home.headers.get('location'), '/manage');
        assert.deepEqual(switchesOf(await footOf(srv, jar([a, b, c]))), [[CLUBS[2].id, 'Rollbahn Racing']]);
        assert.doesNotMatch(await (await get(srv.base, '/manage', jar([a, b, c]))).text(), /Kettenfett RC/);
        // the next time the server sets the cookie, the dead token is gone
        assert.deepEqual(await openWith(srv, a2, jar([a, b, c])), [a2, b, c]);
        // the same for a club in the trash
        srv.store.trash(CID2);
        assert.deepEqual(await openWith(srv, a2, jar([b, a2, c])), [a2, c]);
        // nothing works any more: cleared
        const gone = await get(srv.base, '/manage', jar([a, b]));
        assert.equal(gone.status, 303);
        assert.deepEqual(setTokens(gone), []);
    } finally {
        await srv.stop();
    }
});


test('several clubs: clearDeadCookie rewrites the cookie while a token still works', () => {
    const store = {
        tokenOwner: h => h === tokenHash(GOOD) ? {cid: CID, token: {kind: 'link', state: 'active'}}
            : h === tokenHash(PEND) ? {cid: CID2, token: {kind: 'link', state: 'pending'}} : null,
        get: cid => cid === CID || cid === CID2 ? {id: cid} : null,
    };
    const run = cookie => {
        const set = [];
        clearDeadCookie({headers: cookie === undefined ? {} : {cookie}}, {setHeader: (k, v) => set.push([k, v])}, {store});
        return set.map(([k, v]) => {
            assert.equal(k, 'Set-Cookie');
            return v.split(';')[0];
        });
    };
    assert.deepEqual(run(`__Host-pl_club=${DEAD}.${GOOD}`), [`__Host-pl_club=${GOOD}`], 'rewritten, not wiped');
    assert.deepEqual(run(`__Host-pl_club=${PEND}.${GOOD}.junk`), [`__Host-pl_club=${GOOD}`], 'a pending link is no club link');
    assert.deepEqual(run(`__Host-pl_club=${GOOD}`), [], 'nothing to drop');
    assert.deepEqual(run(`__Host-pl_club=${DEAD}.${PEND}`), ['__Host-pl_club='], 'none works: cleared');
    assert.deepEqual(run('__Host-pl_club=bad'), ['__Host-pl_club=']);
    assert.deepEqual(run(undefined), []);
    assert.deepEqual(run('other=1'), []);
    // principal: the active club and the other clubs the cookie opens (none here)
    const who = cookie => principal({headers: {cookie}}, {store});
    assert.deepEqual(who(`__Host-pl_club=${DEAD}.${GOOD}`), {circle: CID, scope: 'club', hash: tokenHash(GOOD), others: []});
    assert.equal(who(`__Host-pl_club=${DEAD}.${PEND}`), null);
});
const GOOD = 'GoodGoodGoodGoodGood01';
const DEAD = 'DeadDeadDeadDeadDead01';
const PEND = 'PendPendPendPendPend01';


test('several clubs: who is asking is the active club', async () => {
    const srv = await setup();
    try {
        const [a, b] = seedClubs(srv.store, 2);
        await activate(srv, a);
        await activate(srv, b);
        assert.equal(await clubShown(srv, jar([a, b])), 'Kettenfett RC');
        assert.equal(await clubShown(srv, jar([b, a])), 'Spokesmen CC');
        // a POST acts on the active club only
        const res = await post(srv.base, '/manage/newlink', {}, {cookie: jar([b, a])});
        assert.equal(res.status, 303);
        assert.deepEqual(srv.mailer.sent.map(m => m.to), ['second@example.org']);
        linksOf(srv.mailer);
        // the captain pages' footer offers the other club first, a POST /switch with its id: the
        // first run (no teams yet), the team picker and the club settings
        const footer = new RegExp(`<footer class="foot">\\s*<div class="foot-clubs" role="group" aria-label="Other clubs"><p class="foot-label" aria-hidden="true">Other clubs</p>\\s*<form method="post" action="/switch"><input type="hidden" name="club" value="${CID}"><button type="submit"><svg[^>]*>[\\s\\S]*?</svg>Kettenfett RC</button></form>`);
        const first = await (await get(srv.base, '/manage', jar([b, a]))).text();
        assert.match(first, /<body class="firstrun"/);
        assert.match(first, footer);
        assert.equal((await post(srv.base, '/manage/team', {action: 'add', name: 'Rollers'}, {cookie: jar([b, a])})).status, 303);
        const picker = await (await get(srv.base, '/manage', jar([b, a]))).text();
        assert.match(picker, /<body class="teamspage"/);
        assert.match(picker, footer);
        assert.match(await (await get(srv.base, '/manage/settings', jar([b, a]))).text(), footer);
        // a refusal renders its page in the POST's answer: the footer is there as well
        const refused = await post(srv.base, '/manage/team', {action: 'bogus'}, {cookie: jar([b, a])});
        assert.equal(refused.status, 400);
        assert.match(await refused.clone().text(), /<body class="teamspage"/);
        assert.match(await refused.text(), footer);
    } finally {
        await srv.stop();
    }
});


test('several clubs: POST /switch moves a club of the cookie first, nothing else', async () => {
    const srv = await setup();
    try {
        const [a, b, c] = seedClubs(srv.store, 3);
        for (const tok of [a, b, c]) {
            await activate(srv, tok);
        }
        const cookie = jar([a, b]);
        const res = await post(srv.base, '/switch', {club: CID2}, {cookie});
        assert.equal(res.status, 303);
        assert.equal(res.headers.get('location'), '/manage');
        assert.deepEqual(setTokens(res), [b, a]);
        assert.equal(await clubShown(srv, jar([b, a])), 'Spokesmen CC');
        // the active club itself: it stays first
        assert.deepEqual(setTokens(await post(srv.base, '/switch', {club: CID}, {cookie})), [a, b]);
        // cross-site: refused, no cookie
        const cross = await post(srv.base, '/switch', {club: CID2}, {cookie, site: 'cross-site'});
        assert.equal(cross.status, 403);
        assert.equal(cross.headers.get('set-cookie'), null);
        // a club this cookie does not hold (C exists and is active), an unknown id, none: back to /
        // (the open club's /manage), nothing set
        for (const form of [{club: CLUBS[2].id}, {club: 'zzzzzzzzzz'}, {club: ''}, {}, {club: b}]) {
            const r = await post(srv.base, '/switch', form, {cookie});
            assert.equal(r.status, 303, JSON.stringify(form));
            assert.equal(r.headers.get('location'), '/');
            assert.equal(r.headers.get('set-cookie'), null, JSON.stringify(form));
        }
        // without a cookie: the same
        const none = await post(srv.base, '/switch', {club: CID});
        assert.equal(none.headers.get('location'), '/');
        assert.equal(none.headers.get('set-cookie'), null);
        // a GET changes nothing
        for (const p of ['/switch', '/logout-all']) {
            const r = await get(srv.base, p, cookie);
            assert.equal(r.status, 405, p);
            assert.equal(r.headers.get('allow'), 'POST');
            assert.equal(r.headers.get('set-cookie'), null);
        }
    } finally {
        await srv.stop();
    }
});


test('several clubs: log out drops the active club, log out of all drops them all', async () => {
    const srv = await setup();
    try {
        const [a, b, c] = seedClubs(srv.store, 3);
        for (const tok of [a, b, c]) {
            await activate(srv, tok);
        }
        const res = await post(srv.base, '/manage/logout', {}, {cookie: jar([a, b, c])});
        assert.equal(res.status, 303);
        assert.equal(res.headers.get('location'), '/');
        assert.deepEqual(setTokens(res), [b, c]);
        // / then leads to the next club's /manage, whose footer offers the one left
        const home = await get(srv.base, '/', jar([b, c]));
        assert.equal(home.status, 303);
        assert.equal(home.headers.get('location'), '/manage');
        assert.equal(await clubShown(srv, jar([b, c])), 'Spokesmen CC');
        const foot = await footOf(srv, jar([b, c]));
        assert.deepEqual(switchesOf(foot), [[CLUBS[2].id, 'Rollbahn Racing']]);
        assert.doesNotMatch(await (await get(srv.base, '/manage', jar([b, c]))).text(), /Kettenfett RC/);
        // the link itself still works (logout ends this browser's session only)
        assert.equal(await clubShown(srv, jar([a])), 'Kettenfett RC');
        // the last club: cleared; / is the start page again
        assert.deepEqual(setTokens(await post(srv.base, '/manage/logout', {}, {cookie: jar([c])})), []);
        const start = await get(srv.base, '/');
        assert.equal(start.status, 200);
        assert.match(textOf(await start.text()), /Register a club/);

        // log out of all clubs: offered with two clubs or more, in the footer
        assert.match(foot, /<form method="post" action="\/logout-all"><button type="submit"><svg[^>]*>[\s\S]*?<\/svg>Log out of all clubs<\/button><\/form>/);
        const cross = await post(srv.base, '/logout-all', {}, {cookie: jar([b, c]), site: 'cross-site'});
        assert.equal(cross.status, 403);
        assert.equal(cross.headers.get('set-cookie'), null);
        const all = await post(srv.base, '/logout-all', {}, {cookie: jar([b, c])});
        assert.equal(all.status, 303);
        assert.equal(all.headers.get('location'), '/');
        assert.equal(all.headers.get('set-cookie'), CLEARED);
        // the links themselves still work
        assert.equal(await clubShown(srv, jar([c])), 'Rollbahn Racing');
    } finally {
        await srv.stop();
    }
});


test('several clubs: deleting a club drops its token only', async () => {
    const srv = await setup();
    try {
        const [a, b] = seedClubs(srv.store, 2);
        await activate(srv, a);
        await activate(srv, b);
        const cookie = jar([a, b]);
        assert.equal((await post(srv.base, '/manage/delete', {}, {cookie})).status, 303);
        assert.equal(srv.mailer.sent[0].to, 'captain@example.org', 'the active club');
        const tok = confirmOf(srv.mailer, 0);
        const done = await post(srv.base, `/t/${tok}`, {}, {cookie});
        assert.equal(done.status, 200);
        assert.equal(srv.store.get(CID), null);
        assert.deepEqual(setTokens(done), [b]);
        assert.equal(await clubShown(srv, jar([b])), 'Spokesmen CC');
        // confirmed in a browser that holds the other club first: it keeps that one
        assert.equal((await post(srv.base, '/manage/delete', {}, {cookie: jar([b])})).status, 303);
        const tok2 = confirmOf(srv.mailer, 1);
        const other = seedPending(srv.store, START, CLUBS[2]);
        const keep = await activate(srv, other);
        const done2 = await post(srv.base, `/t/${tok2}`, {}, {cookie: `${keep}.${b}`});
        assert.equal(done2.status, 200);
        assert.deepEqual(setTokens(done2), [other]);
    } finally {
        await srv.stop();
    }
});


test('several clubs: the captain footer lists the other clubs, with no token in any page', async () => {
    const srv = await setup();
    try {
        const toks = seedClubs(srv.store, 3);
        for (const tok of toks) {
            await activate(srv, tok);
        }
        const cookie = jar(toks);
        // / goes to the open club; its footer: the other clubs in the cookie's order, then Privacy,
        // Log out of the open club, Log out of all clubs
        assert.equal((await get(srv.base, '/', cookie)).headers.get('location'), '/manage');
        const foot = await footOf(srv, cookie);
        const order = [...foot.matchAll(/>([^<>]+)<\/(?:a|button)>/g)].map(m => m[1]);
        assert.deepEqual(order, ['Spokesmen CC', 'Rollbahn Racing', 'Privacy', 'Log out of Kettenfett RC', 'Log out of all clubs']);
        assert.match(foot, new RegExp(`<form method="post" action="/switch"><input type="hidden" name="club" value="${CID2}"><button type="submit"><svg[^>]*>[\\s\\S]*?</svg>Spokesmen CC</button></form>`));
        assert.match(foot, new RegExp(`<form method="post" action="/switch"><input type="hidden" name="club" value="${CLUBS[2].id}"><button type="submit"><svg[^>]*>[\\s\\S]*?</svg>Rollbahn Racing</button></form>`));
        // each switch carries the club id and nothing else
        for (const form of foot.match(/<form method="post" action="\/switch">[\s\S]*?<\/form>/g)) {
            assert.equal(form.match(/<input /g).length, 1, form);
        }
        // the switch is the request the footer's button sends: Spokesmen CC becomes the open club
        const sw = await post(srv.base, '/switch', {club: CID2}, {cookie});
        assert.equal(sw.headers.get('location'), '/manage');
        assert.deepEqual(setTokens(sw), [toks[1], toks[0], toks[2]]);
        assert.deepEqual(switchesOf(await footOf(srv, jar(setTokens(sw)))), [[CID, 'Kettenfett RC'], [CLUBS[2].id, 'Rollbahn Racing']]);
        // a club name is escaped
        srv.store.change(CID2, club => {
            club.name = 'Spokes <b>& Co';
        });
        const escaped = await footOf(srv, cookie);
        assert.ok(escaped.includes('</svg>Spokes &lt;b&gt;&amp; Co</button>'), escaped);
        assert.ok(!escaped.includes('<b>'), escaped);
        // no token in the start page or the captain pages
        for (const p of ['/', '/manage', '/manage/settings', '/manage/new-team', '/privacy']) {
            const body = await (await get(srv.base, p, cookie)).text();
            for (const tok of toks) {
                assert.ok(!body.includes(tok), `${p} carries a token`);
            }
        }
    } finally {
        await srv.stop();
    }
});


test('expired after 24 h', async () => {
    const srv = await setup();
    try {
        const cookie = await activate(srv, seedPending(srv.store, START));
        await post(srv.base, '/manage/email', {email: 'new@example.org'}, {cookie});
        await post(srv.base, '/manage/delete', {}, {cookie});
        await post(srv.base, '/manage/email', {email: 'other@example.org'}, {cookie});
        const [change, del, change2] = [0, 1, 2].map(i => confirmOf(srv.mailer, i));
        // the new address's link, 1 h later
        srv.clock.now = START + 3600 * 1000;
        assert.equal((await post(srv.base, `/t/${change2}`)).status, 200);
        const email = confirmOf(srv.mailer, 3);

        srv.clock.now = START + TOKEN_MS;
        assert.equal((await get(srv.base, `/t/${del}`)).status, 200, 'still open at 24 h');
        srv.clock.now = START + TOKEN_MS + 1;
        for (const tok of [change, del]) {
            assert.equal((await get(srv.base, `/t/${tok}`)).status, 404);
            const res = await post(srv.base, `/t/${tok}`);
            assert.equal(res.status, 404);
            assert.match(textOf(await res.text()), /This link is not valid\./);
        }
        srv.clock.now = START + 3600 * 1000 + TOKEN_MS + 1;
        assert.equal((await post(srv.base, `/t/${email}`)).status, 404);
        const club = srv.store.get(CID);
        assert.ok(club, 'not deleted');
        assert.equal(club.email, 'captain@example.org');
        assert.equal(srv.mailer.sent.length, 4);
    } finally {
        await srv.stop();
    }
});


test('a refused confirmation mail stores no token', async () => {
    const srv = await setup();
    try {
        const cookie = await activate(srv, seedPending(srv.store, START));
        const before = structuredClone(srv.store.get(CID).tokens);
        srv.mailer.refuse = true;
        for (const [p, form] of [['/manage/email', {email: 'new@example.org'}], ['/manage/delete', {}]]) {
            const res = await post(srv.base, p, form, {cookie});
            assert.deepEqual(flashOf(await followed(srv, res, cookie)),
                {kind: 'err', text: 'No mail was sent: the server cannot send mail right now. Try again later.'}, p);
            assert.deepEqual(srv.store.get(CID).tokens, before, p);
        }
        // the current address confirmed, but the mail to the new address is refused: the confirm
        // link stays usable, and no email token was kept
        srv.mailer.refuse = false;
        await post(srv.base, '/manage/email', {email: 'new@example.org'}, {cookie});
        const confirm = confirmOf(srv.mailer, 0);
        const withConfirm = structuredClone(srv.store.get(CID).tokens);
        srv.mailer.refuse = true;
        const refused = await post(srv.base, `/t/${confirm}`);
        assert.equal(refused.status, 503);
        assert.match(textOf(await refused.text()), /No mail was sent/);
        assert.deepEqual(srv.store.get(CID).tokens, withConfirm);
        srv.mailer.refuse = false;
        assert.equal((await post(srv.base, `/t/${confirm}`)).status, 200, 'works once the mail goes out');
        assert.equal(srv.mailer.sent.at(-1).to, 'new@example.org');
    } finally {
        await srv.stop();
    }
});


// A GET with a Cookie header of raw bytes (latin1: one byte per character, 0xA0 as itself), as no
// browser API would send it. {status, location, setCookie}.
async function rawGet(base, p, cookieBytes) {
    const {port} = new URL(base);
    const socket = net.connect(Number(port), '127.0.0.1');
    await new Promise(r => socket.once('connect', r));
    socket.write(Buffer.concat([Buffer.from(`GET ${p} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\nCookie: `, 'latin1'),
        Buffer.from(cookieBytes, 'latin1'), Buffer.from('\r\n\r\n', 'latin1')]));
    const chunks = [];
    socket.on('data', d => chunks.push(d));
    await new Promise(r => socket.once('close', r));
    const head = Buffer.concat(chunks).toString('latin1').split('\r\n\r\n')[0].split('\r\n');
    const header = name => head.filter(l => l.toLowerCase().startsWith(`${name}:`)).map(l => l.slice(name.length + 1).trim());
    return {status: Number(head[0].split(' ')[1]), location: header('location')[0] ?? null, setCookie: header('set-cookie')};
}


test('the club cookie in raw bytes: U+00A0 is no white space; the name twice is no cookie', async () => {
    const srv = await setup();
    try {
        const [a, b] = seedClubs(srv.store, 2);
        await activate(srv, a);
        await activate(srv, b);
        // the plain cookie, and with space and tab around it: A
        for (const bytes of [`__Host-pl_club=${a}`, ` \t__Host-pl_club=${a}\t `, `x=1;\t__Host-pl_club = ${a}.${b} ;y=2`]) {
            const res = await rawGet(srv.base, '/manage', bytes);
            assert.equal(res.status, 200, JSON.stringify(bytes));
        }
        // 0xA0 (U+00A0) before or after the value, or around the name: not trimmed, so no club
        for (const bytes of [`__Host-pl_club=\xa0${a}`, `__Host-pl_club=${a}\xa0`, `\xa0__Host-pl_club=${a}`, `__Host-pl_club\xa0=${a}`]) {
            const res = await rawGet(srv.base, '/manage', bytes);
            assert.equal(res.status, 303, JSON.stringify(bytes));
            assert.equal(res.location, '/');
        }
        // the club cookie's name twice, in either order, the same token or not: treated as absent
        for (const bytes of [`__Host-pl_club=${a}; __Host-pl_club=${b}`, `__Host-pl_club=${b}; __Host-pl_club=${a}`,
            `__Host-pl_club=${a}; x=1; __Host-pl_club=${a}`, `__Host-pl_club=${a}; __Host-pl_club=`]) {
            const res = await rawGet(srv.base, '/manage', bytes);
            assert.equal(res.status, 303, bytes);
            assert.equal(res.location, '/');
            assert.deepEqual(res.setCookie, [], 'absent: nothing to clear');
            const home = await rawGet(srv.base, '/', bytes);
            assert.equal(home.status, 200);
        }
        // no club: the start page itself, naming none
        const homeText = await (await get(srv.base, '/', `__Host-pl_club=${a}; __Host-pl_club=${b}`)).text();
        assert.match(textOf(homeText), /Register a club/);
        assert.doesNotMatch(homeText, /Kettenfett RC|Spokesmen CC/);
    } finally {
        await srv.stop();
    }
});


// A body that never completes: the server logs the aborted request (with its path).
async function abortedPost(base, p, partial) {
    const {port} = new URL(base);
    const before = captured.length;
    const socket = net.connect(Number(port), '127.0.0.1');
    await new Promise(r => socket.once('connect', r));
    socket.write(`POST ${p} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/x-www-form-urlencoded\r\n` +
        `Content-Length: 1000\r\n\r\n${partial}`);
    await new Promise(r => setTimeout(r, 50));
    socket.destroy();
    for (let i = 0; i < 100 && captured.length === before; i++) {
        await new Promise(r => setTimeout(r, 20));
    }
}


test('no tokens or addresses in logs', async () => {
    const srv = await setup();
    try {
        const tok = seedPending(srv.store, START);
        await abortedPost(srv.base, `/m/${tok}`, 'name=Kettenfett');
        await abortedPost(srv.base, '/lost', 'email=captain%40example.org&x=');
        await activate(srv, tok);
        let confirm;
        srv.store.change(CID, c => {
            confirm = addConfirm(c, {action: 'delete'}, START);
        });
        TOKENS.add(confirm);
        await abortedPost(srv.base, `/t/${confirm}`, 'x=');
    } finally {
        await srv.stop();
    }
    assert.ok(captured.some(l => l.includes('POST /m/…')), 'the aborted /m/ request was logged, redacted');
    assert.ok(captured.some(l => l.includes('POST /t/…')), 'the aborted /t/ request was logged, redacted');
    assert.ok(TOKENS.size >= 10, `tokens seen: ${TOKENS.size}`);
    for (const line of captured) {
        for (const tok of TOKENS) {
            assert.ok(!line.includes(tok), `a token in the log: ${line}`);
        }
        assert.ok(!line.includes('@example.org'), `an address in the log: ${line}`);
    }
});


// The public pages share the captain pages' frame (publicPage in ui.mjs): the stylesheet, the skip
// link to main#main, one h1, the footer, no script, and none of the old plain frame.
test('public pages: the app frame, not the plain one', async () => {
    const frame = (body, what) => {
        assert.match(body, /<link rel="stylesheet" href="\/static\/app\.css\?v=[0-9a-f]{12}">/, what);
        assert.match(body, /<body class="public">\n<a class="skip" href="#main">Skip to content<\/a>\n<main class="page (narrow|wide)" id="main">/, what);
        assert.equal(body.match(/<h1[\s>]/g)?.length, 1, `${what}: one h1`);
        assert.match(body, /<footer class="foot">/, what);
        assert.doesNotMatch(body, /class="plain"|<script/i, what);
    };
    const srv = await setup();
    try {
        const seen = [];
        const check = async (what, res, status) => {
            assert.equal(res.status, status, what);
            frame(await res.text(), what);
            seen.push(what);
        };
        await check('start page', await get(srv.base, '/'), 200);
        await check('register', await get(srv.base, '/register'), 200);
        await check('register refused', await post(srv.base, '/register', {...REG, email: 'nope'}), 400);
        await check('lost', await get(srv.base, '/lost'), 200);
        await check('lost done', await post(srv.base, '/lost', {email: 'nobody@example.org'}), 200);
        await check('privacy', await get(srv.base, '/privacy'), 200);
        await check('bad /m link', await get(srv.base, '/m/AAAAAAAAAAAAAAAAAAAAAA'), 404);
        await check('bad /t link', await get(srv.base, '/t/AAAAAAAAAAAAAAAAAAAAAA'), 404);
        const tok1 = seedPending(srv.store, START);
        const tok2 = seedPending(srv.store, START, {id: CID2, email: 'second@example.org'});
        await check('open page', await get(srv.base, `/m/${tok1}`), 200);
        const cookie = await activate(srv, tok1);
        await check('name page', await post(srv.base, `/m/${tok2}`), 409);
        // a browser with a club open: / goes to it; register and the lost link still work
        assert.equal((await get(srv.base, '/', cookie)).headers.get('location'), '/manage');
        await check('register with a club', await get(srv.base, '/register', cookie), 200);
        assert.equal((await post(srv.base, '/manage/email', {email: 'new@example.org'}, {cookie})).status, 303);
        const change = confirmOf(srv.mailer, 0);
        await check('confirm page', await get(srv.base, `/t/${change}`), 200);
        await check('confirm answer', await post(srv.base, `/t/${change}`), 200);
        await settle();
        const done = await register(srv, {name: 'Spokesmen CC', email: 'spokes@example.org'});
        assert.equal(done.status, 200);
        frame(done.body, 'register done');
        srv.store.setRegistration('closed');
        await check('register closed', await get(srv.base, '/register'), 200);
        assert.equal(seen.length, 14);
    } finally {
        await srv.stop();
    }
    const full = await setup({env: {...ENV, MAX_CIRCLES: '1'}});
    try {
        full.store.create(activeClub({id: CID}));
        const res = await post(full.base, `/m/${seedPending(full.store, START, {id: CID2, name: 'Spokesmen CC', email: 'second@example.org'})}`);
        assert.equal(res.status, 503);
        frame(await res.text(), 'no room');
    } finally {
        await full.stop();
    }
});
