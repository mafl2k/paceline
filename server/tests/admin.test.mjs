// The operator page /admin (plan 3, Task 9, spec §5.3): HTTP Basic auth with a throttle, the club
// list, "Show a new link once", restore, purge, the registration switch and the last mail results.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import {startServer, fakeMailer, T, club as activeClub, rows, refuseWrites} from './helpers.mjs';
import {newClub, addTeam, MAX_CLUB_BYTES} from '../club.mjs';
import {newToken} from '../ids.mjs';
import {addLink, openLink, addConfirm, addEmailToken} from '../tokens.mjs';
import {zonedToUtc} from '../time.mjs';


// Everything the server logs during this file; tests check it for tokens.
const captured = [];
for (const k of ['log', 'warn', 'error']) {
    console[k] = (...a) => {
        captured.push(util.format(...a));
    };
}

const MAIL_ENV = {PUBLIC_URL: 'https://ttt-beta.example.org', SMTP_HOST: 'smtp.example.org', MAIL_FROM: 'Paceline <paceline@example.org>'};
const ADMIN = {ADMIN_USER: 'operator', ADMIN_PASS: 'made-up-admin-pass'};
const ENV = {...MAIL_ENV, ...ADMIN};
const START = T('2026-11-16T10:00:00.000Z');
const CID = 'k7f3q9x2m4';
const CID2 = 'm4x2k7f3q9';
const CID3 = 's9pk2m4q7d';
const LINK_RE = /https:\/\/ttt-beta\.example\.org\/m\/([A-Za-z0-9_-]{22})/;
const XFF = '203.0.113.7';
const iso = ms => new Date(ms).toISOString();


async function setup({env = ENV, refuse = false} = {}) {
    const clock = {now: START};
    const mailer = fakeMailer({refuse});
    const srv = await startServer({env, clock, mailer});
    return {...srv, clock, mailer};
}


const basic = (user, pass) => 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
const RIGHT = basic(ADMIN.ADMIN_USER, ADMIN.ADMIN_PASS);
const WRONG = basic(ADMIN.ADMIN_USER, 'not-the-pass');

function req(base, p, {auth = RIGHT, form = null, xff = XFF, site = null, cookie = null} = {}) {
    return fetch(base + p, {
        method: form ? 'POST' : 'GET', redirect: 'manual',
        headers: {
            ...(auth ? {authorization: auth} : {}), ...(xff ? {'x-forwarded-for': xff} : {}),
            ...(site ? {'sec-fetch-site': site} : {}), ...(cookie ? {cookie} : {}),
            ...(form ? {'content-type': 'application/x-www-form-urlencoded'} : {}),
        },
        body: form ? new URLSearchParams(form).toString() : undefined,
    });
}

async function adminPage(srv, opts) {
    const res = await req(srv.base, '/admin', opts);
    assert.equal(res.status, 200);
    return res.text();
}

// The visible text: tags out, entities decoded, white space collapsed.
const textOf = html => html.replace(/<[^>]*>/g, ' ').replace(/&#39;/g, '\'').replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

// The table row of one club.
function rowOf(body, cid) {
    const m = new RegExp(`<tr id="club-${cid}">([\\s\\S]*?)</tr>`).exec(body);
    assert.ok(m, `row ${cid}`);
    return m[1];
}

// An active club with an active link; the cookie holds it.
function seedActive(store, {id = CID, name = 'Kettenfett RC', teams = [], createdAt = '2026-11-01T10:00:00.000Z'} = {}) {
    const c = activeClub({id, name, createdAt});
    const tk = newToken();
    addLink(c, START, tk);
    openLink(c, tk.hash, START);
    for (const n of teams) {
        addTeam(c, {name: n, start: '19:30'}, {slugTaken: () => false, now: START});
    }
    store.create(c);
    return {cookie: `__Host-pl_club=${tk.token}`, token: tk.token};
}

const kinds = club => club.tokens.map(x => `${x.kind}/${x.state ?? x.action ?? ''}`).sort();


test('404 without ADMIN_* and UPLOAD_*', async () => {
    const srv = await setup({env: MAIL_ENV});
    try {
        for (const p of ['/admin', '/admin/', '/admin/anything']) {
            assert.equal((await req(srv.base, p)).status, 404, p);
            assert.equal((await req(srv.base, p, {auth: null})).status, 404, p);
        }
        for (const p of ['/admin/link', '/admin/restore', '/admin/purge', '/admin/registration']) {
            const res = await req(srv.base, p, {form: {cid: CID, confirm: '1', state: 'closed'}});
            assert.equal(res.status, 404, p);
        }
        assert.equal(srv.store.serverSettings().registration, null);
    } finally {
        await srv.stop();
    }
});


test('UPLOAD_* is the fallback', async () => {
    const upload = {UPLOAD_USER: 'captain', UPLOAD_PASS: 'made-up-upload-pass'};
    const srv = await setup({env: {...MAIL_ENV, ...upload}});
    try {
        assert.equal((await req(srv.base, '/admin', {auth: basic('captain', 'made-up-upload-pass')})).status, 200);
        assert.equal((await req(srv.base, '/admin', {auth: RIGHT})).status, 401);
    } finally {
        await srv.stop();
    }
    // ADMIN_* wins over UPLOAD_*
    const both = await setup({env: {...ENV, ...upload}});
    try {
        assert.equal((await req(both.base, '/admin', {auth: RIGHT})).status, 200);
        assert.equal((await req(both.base, '/admin', {auth: basic('captain', 'made-up-upload-pass')})).status, 401);
    } finally {
        await both.stop();
    }
});


test('auth: wrong user, wrong password, no colon, not Basic', async () => {
    const srv = await setup();
    try {
        for (const auth of [basic('someone', ADMIN.ADMIN_PASS), WRONG, basic(ADMIN.ADMIN_USER, ''),
            'Basic ' + Buffer.from(ADMIN.ADMIN_USER + ADMIN.ADMIN_PASS).toString('base64'), 'Bearer abc', 'Basic !!!']) {
            const res = await req(srv.base, '/admin', {auth, xff: '198.51.100.9'});
            assert.equal(res.status, 401, auth);
            assert.equal(res.headers.get('www-authenticate'), 'Basic realm="Paceline admin", charset="UTF-8"');
            assert.doesNotMatch(await res.text(), /Kettenfett|Operator/);
        }
    } finally {
        await srv.stop();
    }
});


test('throttle: correct credentials always pass', async () => {
    const srv = await setup();
    try {
        // without Authorization: 401, not counted
        for (let i = 0; i < 5; i++) {
            const res = await req(srv.base, '/admin', {auth: null});
            assert.equal(res.status, 401);
            assert.equal(res.headers.get('www-authenticate'), 'Basic realm="Paceline admin", charset="UTF-8"');
        }
        for (let i = 1; i <= 10; i++) {
            const res = await req(srv.base, '/admin', {auth: WRONG});
            assert.equal(res.status, 401, `wrong login ${i}`);
        }
        const eleventh = await req(srv.base, '/admin', {auth: WRONG});
        assert.equal(eleventh.status, 429);
        assert.equal(eleventh.headers.get('retry-after'), '900');
        // a POST is throttled the same way, and changes nothing
        const post = await req(srv.base, '/admin/registration', {auth: WRONG, form: {state: 'closed'}});
        assert.equal(post.status, 429);
        assert.equal(srv.store.serverSettings().registration, null);
        // the right credentials from the same address pass
        assert.equal((await req(srv.base, '/admin')).status, 200);
        assert.equal((await req(srv.base, '/admin/registration', {form: {state: 'closed'}})).status, 200);
        assert.equal(srv.store.serverSettings().registration, 'closed');
        // another address is not throttled
        assert.equal((await req(srv.base, '/admin', {auth: WRONG, xff: '198.51.100.9'})).status, 401);
        // 15 minutes after the failures the address may try again
        srv.clock.now += 15 * 60 * 1000;
        assert.equal((await req(srv.base, '/admin', {auth: WRONG})).status, 401);
    } finally {
        await srv.stop();
    }
});


test('the list', async () => {
    const srv = await setup();
    try {
        seedActive(srv.store);
        srv.store.create(newClub({id: CID2, name: 'Spokes & <Co>', email: 'second@example.org', tz: 'Europe/Berlin', now: T('2026-11-16T09:00:00Z')}));
        seedActive(srv.store, {id: CID3, name: 'Sprockets CC', createdAt: '2026-11-05T08:00:00.000Z'});
        srv.server.logs.put(CID, 'rollers', '1763280000000-1001.jsonl.gz', Buffer.alloc(3000));
        srv.clock.now = T('2026-11-16T09:30:00Z');
        srv.store.trash(CID3);
        srv.clock.now = START;

        const body = await adminPage(srv);
        assert.match(body, /<title>Paceline<\/title>/);
        assert.ok(textOf(body).includes('Your address as the server sees it: 203.0.113.7'), textOf(body));
        assert.doesNotMatch(body, /<script/i);

        const active = textOf(rowOf(body, CID));
        assert.match(active, /Kettenfett RC/);
        assert.match(active, /active/);
        assert.match(active, /2026-11-01 10:00/);
        // club file plus recordings (each counted rounded up to 4 KiB), in KB
        const kb = Math.ceil((Buffer.byteLength(JSON.stringify(srv.store.get(CID))) + 4096) / 1024);
        assert.ok(active.includes(`${kb} KB`), active);
        assert.match(rowOf(body, CID), /action="\/admin\/link"/);
        assert.match(rowOf(body, CID), /action="\/admin\/purge"/);
        assert.doesNotMatch(rowOf(body, CID), /action="\/admin\/restore"/);

        const pending = rowOf(body, CID2);
        assert.match(pending, /Spokes &amp; &lt;Co&gt;/);
        assert.match(textOf(pending), /pending/);
        assert.match(textOf(pending), /2026-11-16 09:00/);
        assert.match(pending, /action="\/admin\/link"/);
        assert.match(pending, /action="\/admin\/purge"/);
        assert.doesNotMatch(pending, /action="\/admin\/restore"/);

        const trashed = textOf(rowOf(body, CID3));
        assert.match(trashed, /Sprockets CC/);
        assert.match(trashed, /deleted 2026-11-16 09:30/);
        assert.match(trashed, /2026-11-05 08:00/);
        assert.match(rowOf(body, CID3), /action="\/admin\/restore"/);
        assert.match(rowOf(body, CID3), /action="\/admin\/purge"/);
        assert.doesNotMatch(rowOf(body, CID3), /action="\/admin\/link"/);

        // active, pending, trashed in that order
        assert.ok(body.indexOf(`club-${CID}"`) < body.indexOf(`club-${CID2}"`));
        assert.ok(body.indexOf(`club-${CID2}"`) < body.indexOf(`club-${CID3}"`));
        // no address and no token on the page
        assert.doesNotMatch(body, /captain@example\.org|second@example\.org/);
        assert.doesNotMatch(body, /\/m\//);
        // HEAD as GET
        assert.equal((await fetch(srv.base + '/admin', {method: 'HEAD', headers: {authorization: RIGHT}})).status, 200);
    } finally {
        await srv.stop();
    }
});


test('show a new link once', async () => {
    // works when mail is down: the mailer refuses everything
    const srv = await setup({refuse: true});
    try {
        const {cookie} = seedActive(srv.store);
        const res = await req(srv.base, '/admin/link', {form: {cid: CID}});
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        const body = await res.text();
        const tok = LINK_RE.exec(body)?.[1];
        assert.ok(tok, body);
        assert.match(textOf(body), /Kettenfett RC/);
        assert.equal(srv.mailer.sent.length, 0);
        const club = srv.store.get(CID);
        assert.deepEqual(kinds(club), ['link/active', 'link/pending']);
        assert.deepEqual(club.log.at(-1), {at: iso(START), what: 'admin-link'});
        assert.doesNotMatch(JSON.stringify(club.log), new RegExp(tok));
        // shown once: the list does not show it again
        assert.doesNotMatch(await adminPage(srv), new RegExp(tok));
        // the old link works until the new one is opened
        assert.equal((await req(srv.base, '/manage', {auth: null, cookie})).status, 200);

        const open = await fetch(`${srv.base}/m/${tok}`, {method: 'POST', redirect: 'manual'});
        assert.equal(open.status, 303);
        assert.equal(open.headers.get('location'), '/manage');
        const fresh = open.headers.get('set-cookie').split(';')[0];
        assert.equal(fresh, `__Host-pl_club=${tok}`);
        assert.equal((await req(srv.base, '/manage', {auth: null, cookie: fresh})).status, 200);
        assert.equal((await req(srv.base, '/manage', {auth: null, cookie})).status, 303, 'the old cookie no longer works');

        // a pending club gets one too; opening it activates the club
        srv.store.create(newClub({id: CID2, name: 'Spokesmen CC', email: 'second@example.org', tz: 'Europe/Berlin', now: START}));
        const tok2 = LINK_RE.exec(await (await req(srv.base, '/admin/link', {form: {cid: CID2}})).text())?.[1];
        assert.ok(tok2);
        assert.equal((await fetch(`${srv.base}/m/${tok2}`, {method: 'POST', redirect: 'manual'})).status, 303);
        assert.equal(srv.store.get(CID2).status, 'active');

        // an unknown or trashed club gets nothing
        srv.store.trash(CID2);
        for (const cid of [CID2, 'zzzzzzzzzz', '']) {
            const r = await req(srv.base, '/admin/link', {form: {cid}});
            assert.equal(r.status, 404, cid);
            assert.doesNotMatch(await r.text(), /\/m\//);
        }
        assert.ok(!captured.some(l => l.includes(tok) || l.includes(tok2)), 'no token in the log');
    } finally {
        await srv.stop();
    }
});


test('restore ends all links and mails a new one', async () => {
    const srv = await setup();
    try {
        const {cookie} = seedActive(srv.store, {teams: ['Rollers']});
        srv.store.change(CID, c => {
            addLink(c, START);
            addConfirm(c, {action: 'email', email: 'new@example.org'}, START);
            addEmailToken(c, 'new@example.org', START);
        });
        const logs = path.join(srv.dataDir, 'logs', CID, 'rollers');
        srv.server.logs.put(CID, 'rollers', '1763280000000-1001.jsonl.gz', Buffer.from('x'));
        srv.store.trash(CID);
        srv.clock.now += 3600000;

        const res = await req(srv.base, '/admin/restore', {form: {cid: CID}});
        assert.equal(res.status, 200);
        const body = await res.text();
        const shown = LINK_RE.exec(body)?.[1];
        assert.ok(shown, body);
        assert.match(textOf(body), /Kettenfett RC is restored/);

        const club = srv.store.get(CID);
        assert.equal(club.status, 'active');
        assert.deepEqual(kinds(club), ['link/pending'], 'every link and confirmation ended, one new pending link');
        assert.equal(club.log.at(-1).what, 'club-restored');
        assert.ok(fs.existsSync(path.join(logs, '1763280000000-1001.jsonl.gz')), 'recordings back');
        assert.deepEqual(srv.server.logs.list(CID).map(r => r.file), ['1763280000000-1001.jsonl.gz'], 'and in the index');
        srv.store.get(CID);
        assert.equal(srv.store.gone(CID), false);
        assert.deepEqual(srv.store.trashed(), []);

        // the old cookie → the start page
        const old = await req(srv.base, '/manage', {auth: null, cookie});
        assert.equal(old.status, 303);
        assert.equal(old.headers.get('location'), '/');
        // the mail carries the same link
        assert.equal(srv.mailer.sent.length, 1);
        const [mail] = srv.mailer.sent;
        assert.equal(mail.kind, 'new-link');
        assert.equal(mail.to, 'captain@example.org');
        assert.equal(LINK_RE.exec(mail.text)?.[1], shown);
        // and it opens the club
        const open = await fetch(`${srv.base}/m/${shown}`, {method: 'POST', redirect: 'manual'});
        assert.equal(open.status, 303);
        assert.ok(!captured.some(l => l.includes(shown)), 'no token in the log');

        // restoring again: not in the trash
        const again = await req(srv.base, '/admin/restore', {form: {cid: CID}});
        assert.equal(again.status, 404);
    } finally {
        await srv.stop();
    }
});


test('restore: mail refused, the link is still shown; a failed restore shows why', async () => {
    const srv = await setup({refuse: true});
    try {
        seedActive(srv.store);
        srv.store.trash(CID);
        const res = await req(srv.base, '/admin/restore', {form: {cid: CID}});
        assert.equal(res.status, 200);
        const body = await res.text();
        assert.ok(LINK_RE.test(body));
        assert.match(textOf(body), /No mail went out/);

        seedActive(srv.store, {id: CID2, name: 'Spokesmen CC'});
        srv.store.trash(CID2);
        // paceline.db refuses the club row (a full disk)
        const undo = refuseWrites(srv.server.db, 'clubs', ['INSERT']);
        let failed;
        try {
            failed = await req(srv.base, '/admin/restore', {form: {cid: CID2}});
        } finally {
            undo();
        }
        assert.equal(failed.status, 409);
        const text = textOf(await failed.text());
        assert.match(text, /test: write refused/);
        assert.doesNotMatch(text, /\/m\//);
        assert.deepEqual(srv.store.trashed().map(x => x.id), [CID2]);
        assert.equal(srv.store.get(CID2), null);
        assert.deepEqual(rows(srv.server.db, 'SELECT cid FROM trash'), [{cid: CID2}]);
    } finally {
        await srv.stop();
    }
});


test('restore: when the link reset does not fit, nothing is restored', async () => {
    const srv = await setup();
    try {
        const {cookie} = seedActive(srv.store);
        // pad the club to 10 bytes under the cap: the reset adds a pending link and a log entry
        srv.store.change(CID, c => {
            c.log.push({at: iso(START), what: 'upload', label: ''});
        });
        const size = () => Buffer.byteLength(JSON.stringify(srv.store.get(CID)));
        srv.store.change(CID, c => {
            c.log.at(-1).label = 'x'.repeat(MAX_CLUB_BYTES - 10 - size());
        });
        assert.equal(size(), MAX_CLUB_BYTES - 10);
        srv.store.trash(CID);
        const res = await req(srv.base, '/admin/restore', {form: {cid: CID}});
        assert.equal(res.status, 409);
        const body = await res.text();
        assert.match(textOf(body), /The club is at its size limit/);
        assert.doesNotMatch(body, LINK_RE);
        // still in the trash, its old link opens nothing, no mail
        assert.equal(srv.store.get(CID), null);
        assert.deepEqual(srv.store.trashed().map(x => x.id), [CID]);
        const old = await req(srv.base, '/manage', {auth: null, cookie});
        assert.equal(old.status, 303);
        assert.equal(srv.mailer.sent.length, 0);
    } finally {
        await srv.stop();
    }
});


test('purge frees the name, slugs stay retired', async () => {
    const srv = await setup();
    try {
        seedActive(srv.store, {teams: ['Rollers']});
        assert.equal(srv.store.slugTaken('rollers'), true);
        // without confirm=1: a page that asks, nothing purged
        const ask = await req(srv.base, '/admin/purge', {form: {cid: CID}});
        assert.equal(ask.status, 200);
        const askBody = await ask.text();
        assert.match(askBody, new RegExp(`<form method="post" action="/admin/purge"><input type="hidden" name="cid" value="${CID}"><input type="hidden" name="confirm" value="1">`));
        assert.ok(srv.store.get(CID));

        const res = await req(srv.base, '/admin/purge', {form: {cid: CID, confirm: '1'}});
        assert.equal(res.status, 200);
        assert.match(textOf(await res.text()), /Kettenfett RC is purged/);
        assert.equal(srv.store.get(CID), null);
        assert.equal(srv.store.nameTaken('kettenfettrc'), false);
        assert.equal(srv.store.slugTaken('rollers'), true);
        assert.equal(srv.store.gone(CID), true);

        // a trashed club: its name is free at once
        seedActive(srv.store, {id: CID2, name: 'Spokesmen CC'});
        srv.store.trash(CID2);
        assert.equal(srv.store.nameTaken('spokesmencc'), true);
        assert.equal((await req(srv.base, '/admin/purge', {form: {cid: CID2, confirm: '1'}})).status, 200);
        assert.equal(srv.store.nameTaken('spokesmencc'), false);
        assert.deepEqual(srv.store.trashed(), []);
        assert.deepEqual(rows(srv.server.db, 'SELECT cid FROM trash WHERE cid = ?', CID2), []);

        // a pending club (a squatted name or slot): gone at once
        srv.store.create(newClub({id: CID3, name: 'Sprockets CC', email: 'third@example.org', tz: 'Europe/Berlin', now: START}));
        assert.equal((await req(srv.base, '/admin/purge', {form: {cid: CID3, confirm: '1'}})).status, 200);
        assert.equal(srv.store.getAny(CID3), null);
        assert.equal(srv.store.pendingCount(), 0);

        // unknown
        assert.equal((await req(srv.base, '/admin/purge', {form: {cid: CID3, confirm: '1'}})).status, 404);
    } finally {
        await srv.stop();
    }
});


test('registration switch wins over REGISTRATION', async () => {
    const srv = await setup({env: {...ENV, REGISTRATION: 'closed'}});
    try {
        assert.match(textOf(await (await req(srv.base, '/register', {auth: null})).text()), /Registration is closed\./);
        assert.match(textOf(await adminPage(srv)), /Registration is closed \(REGISTRATION\)/);
        const res = await req(srv.base, '/admin/registration', {form: {state: 'open'}});
        assert.equal(res.status, 200);
        assert.match(textOf(await res.text()), /Registration is open \(set here\)/);
        assert.deepEqual(rows(srv.server.db, "SELECT value FROM settings WHERE name = 'registration'"), [{value: '"open"'}]);
        assert.match(await (await req(srv.base, '/register', {auth: null})).text(), /<form class="stack" method="post" action="\/register">/);

        assert.equal((await req(srv.base, '/admin/registration', {form: {state: 'closed'}})).status, 200);
        assert.match(textOf(await (await req(srv.base, '/register', {auth: null})).text()), /Registration is closed\./);
        assert.equal(srv.store.serverSettings().registration, 'closed');

        const bad = await req(srv.base, '/admin/registration', {form: {state: 'maybe'}});
        assert.equal(bad.status, 400);
        assert.equal(srv.store.serverSettings().registration, 'closed');
    } finally {
        await srv.stop();
    }
});


test('mail results', async () => {
    const srv = await setup();
    try {
        assert.match(textOf(await adminPage(srv)), /No mail results yet\./);
        srv.mailer.resultList.push(
            {at: T('2026-11-16T09:59:00Z'), kind: 'new-link', code: 250},
            {at: T('2026-11-16T09:58:00Z'), kind: 'confirm-club', code: 451},
            {at: T('2026-11-16T09:57:00Z'), kind: 'confirm-delete', code: 'network'},
        );
        const text = textOf(await adminPage(srv));
        assert.ok(text.includes('2026-11-16 09:59:00 new-link 250'), text);
        assert.ok(text.includes('2026-11-16 09:58:00 confirm-club 451'));
        assert.ok(text.includes('2026-11-16 09:57:00 confirm-delete network'));
        // at most 20
        srv.mailer.resultList.length = 0;
        for (let i = 0; i < 25; i++) {
            srv.mailer.resultList.push({at: START - i * 1000, kind: `kind${i}`, code: 250});
        }
        const many = await adminPage(srv);
        assert.match(many, /kind19</);
        assert.doesNotMatch(many, /kind20</);
    } finally {
        await srv.stop();
    }
    // mail off
    const off = await startServer({env: ADMIN});
    try {
        assert.match(textOf(await adminPage(off)), /Mail is off\./);
    } finally {
        await off.stop();
    }
});


test('the admin page shows the database size and the last dump, or its failure, and folders left to delete by hand', async () => {
    const clock = {now: zonedToUtc('2026-11-16', '03:10', 'Europe/Berlin')};
    const srv = await startServer({env: ADMIN, clock});
    try {
        const first = await adminPage(srv);
        const text = textOf(first);
        // between the clubs and the mail
        assert.match(first, /<h2>Clubs<\/h2>[\s\S]*<h2>Database<\/h2>[\s\S]*<h2>Mail<\/h2>/);
        assert.match(text, /paceline\.db holds \d+ KB\./);
        assert.ok(text.includes('No dump yet; the first is written after 03:00.'), text);
        assert.doesNotMatch(text, /Last dump|failed/);

        const blocker = path.join(srv.dataDir, 'dumps');
        fs.writeFileSync(blocker, 'in the way');
        assert.equal(srv.server.dumpJob.tick(), false);
        const failed = await adminPage(srv);
        assert.match(failed, /<p class="warn">The last dump failed at 2026-11-16 02:10 \(UTC\): /);
        assert.ok(textOf(failed).includes('No dump yet; the first is written after 03:00.'));

        fs.rmSync(blocker);
        clock.now += 3600 * 1000;
        assert.equal(srv.server.dumpJob.tick(), true);
        const done = textOf(await adminPage(srv));
        assert.match(done, /Last dump: 2026-11-16, \d+ KB\./);
        assert.doesNotMatch(done, /No dump yet|failed/);
        const kb = Math.ceil(fs.statSync(path.join(srv.dataDir, 'dumps', 'paceline-2026-11-16.db')).size / 1024);
        assert.ok(done.includes(`Last dump: 2026-11-16, ${kb} KB.`), done);
        assert.ok(done.includes(`paceline.db holds ${Math.ceil(srv.server.db.bytes() / 1024)} KB.`), done);
        assert.doesNotMatch(done, /still in the data folder/);

        // a folder an import or a restore left: a warning in the Database section while it is there
        fs.mkdirSync(path.join(srv.dataDir, 'imported-2026-11-16'));
        fs.mkdirSync(path.join(srv.dataDir, 'before-restore-2026-11-17-0930'));
        const left = await adminPage(srv);
        assert.match(left, /<h2>Database<\/h2>[\s\S]*<p class="warn">before-restore-2026-11-17-0930\/ is still in the data folder\. It holds old club data: delete it by hand within 7 days of 2026-11-17 \(see server\/README\.md\)\.<\/p>\n<p class="warn">imported-2026-11-16\/ is still in the data folder\. It holds old club data: delete it by hand within 7 days of 2026-11-16 \(see server\/README\.md\)\.<\/p>[\s\S]*<h2>Mail<\/h2>/);
        fs.rmSync(path.join(srv.dataDir, 'imported-2026-11-16'), {recursive: true});
        fs.rmSync(path.join(srv.dataDir, 'before-restore-2026-11-17-0930'), {recursive: true});
        assert.doesNotMatch(await adminPage(srv), /still in the data folder/);
    } finally {
        await srv.stop();
    }
});


test('cross-site admin POST → 403', async () => {
    const srv = await setup();
    try {
        seedActive(srv.store);
        for (const [p, form] of [['/admin/registration', {state: 'closed'}], ['/admin/link', {cid: CID}],
            ['/admin/purge', {cid: CID, confirm: '1'}]]) {
            const res = await req(srv.base, p, {form, site: 'cross-site'});
            assert.equal(res.status, 403, p);
            assert.doesNotMatch(await res.text(), /\/m\//);
        }
        // Origin of another site, without Sec-Fetch-Site
        const other = await fetch(srv.base + '/admin/registration', {
            method: 'POST',
            headers: {authorization: RIGHT, origin: 'https://evil.example.org', 'content-type': 'application/x-www-form-urlencoded'},
            body: 'state=closed',
        });
        assert.equal(other.status, 403);
        assert.equal(srv.store.serverSettings().registration, null);
        assert.deepEqual(kinds(srv.store.get(CID)), ['link/active']);
        // GETs change nothing: the action paths answer 405
        for (const p of ['/admin/registration', '/admin/link', '/admin/restore', '/admin/purge']) {
            const res = await req(srv.base, `${p}?cid=${CID}&state=closed&confirm=1`);
            assert.equal(res.status, 405, p);
            assert.equal(res.headers.get('allow'), 'POST');
        }
        assert.equal((await req(srv.base, '/admin', {form: {x: '1'}})).status, 405);
        assert.equal((await req(srv.base, '/admin/nothing')).status, 404);
        assert.equal(srv.store.serverSettings().registration, null);
        assert.deepEqual(kinds(srv.store.get(CID)), ['link/active']);
    } finally {
        await srv.stop();
    }
});
