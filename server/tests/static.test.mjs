// Run with: node --test server/tests/static.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {startServer} from './helpers.mjs';
import {SEC_HEADERS} from '../http.mjs';
import {APP_CSS} from '../app-css.mjs';
import {appPage} from '../ui.mjs';

const CLIENT = fs.readFileSync(new URL('../client.mjs', import.meta.url));
const hash = body => crypto.createHash('sha256').update(body).digest('hex').slice(0, 12);
const count = (s, part) => s.split(part).length - 1;
const ENV = {PUBLIC_URL: 'https://ttt-beta.example.org', SMTP_HOST: 'smtp.example.org', MAIL_FROM: 'Paceline <paceline@example.org>'};


function securityHeaders(res, what) {
    assert.equal(res.headers.get('content-security-policy'), SEC_HEADERS['Content-Security-Policy'], what);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', what);
}


test('static: app.css and app.js, cached by content', async () => {
    const s = await startServer();
    try {
        const h = hash(APP_CSS);
        const css = await fetch(s.base + '/static/app.css');
        assert.equal(css.status, 200);
        assert.equal(css.headers.get('content-type'), 'text/css; charset=utf-8');
        assert.equal(await css.text(), APP_CSS);
        assert.equal(css.headers.get('etag'), `"${h}"`);
        assert.equal(css.headers.get('cache-control'), 'no-cache');
        securityHeaders(css, 'css');

        const pinned = await fetch(s.base + `/static/app.css?v=${h}`);
        assert.equal(pinned.status, 200);
        assert.equal(pinned.headers.get('cache-control'), 'public, max-age=31536000, immutable');
        await pinned.arrayBuffer();

        const again = await fetch(s.base + '/static/app.css', {headers: {'If-None-Match': `"${h}"`}});
        assert.equal(again.status, 304);
        assert.equal(await again.text(), '');
        assert.equal(again.headers.get('etag'), `"${h}"`);
        securityHeaders(again, '304');

        const head = await fetch(s.base + '/static/app.css', {method: 'HEAD'});
        assert.equal(head.status, 200);
        assert.equal(await head.text(), '');

        const post = await fetch(s.base + '/static/app.css', {method: 'POST'});
        assert.equal(post.status, 405);
        assert.equal(post.headers.get('allow'), 'GET');
        await post.arrayBuffer();

        const nope = await fetch(s.base + '/static/nope');
        assert.equal(nope.status, 404);
        securityHeaders(nope, '404');
        await nope.arrayBuffer();

        const js = await fetch(s.base + '/static/app.js');
        assert.equal(js.status, 200);
        assert.equal(js.headers.get('content-type'), 'text/javascript; charset=utf-8');
        assert.deepEqual(Buffer.from(await js.arrayBuffer()), CLIENT);
        assert.equal(js.headers.get('etag'), `"${hash(CLIENT)}"`);
        securityHeaders(js, 'js');
    } finally {
        await s.stop();
    }
});


test('the CSP allows only own scripts, styles and fetches', () => {
    assert.equal(SEC_HEADERS['Content-Security-Policy'],
        "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
});


test('appPage: one module script, the stylesheet, no inline style or script', () => {
    const p = appPage({body: '<main id="main"></main>', refresh: '/manage/team/rollers', updated: '19:12'});
    assert.equal(count(p, '<script'), 1);
    assert.match(p, /<script type="module" src="\/static\/app\.js\?v=[0-9a-f]{12}"><\/script>/);
    assert.match(p, /<link rel="stylesheet" href="\/static\/app\.css\?v=[0-9a-f]{12}">/);
    assert.ok(p.includes('<noscript><meta http-equiv="refresh" content="30;url=/manage/team/rollers"></noscript>'));
    assert.match(p, /<body class="" data-refresh="30" data-updated="19:12">/);
    assert.doesNotMatch(p, /<style|\sstyle=|\son[a-z]+=/i);
    assert.doesNotMatch(appPage({body: ''}), /http-equiv|data-refresh/);
});


test('appPage: the head in order, the skip link first, hrefs pinned to the content', () => {
    const p = appPage({body: '<main id="main">x</main>', cls: 'teampage'});
    const order = [
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
        '<meta name="color-scheme" content="light dark">',
        '<meta name="theme-color" content="#f3f4f7" media="(prefers-color-scheme: light)">',
        '<meta name="theme-color" content="#0e1116" media="(prefers-color-scheme: dark)">',
        '<title>Paceline</title>',
        `<link rel="stylesheet" href="/static/app.css?v=${hash(APP_CSS)}">`,
        `<script type="module" src="/static/app.js?v=${hash(CLIENT)}"></script>`,
        '</head>',
        '<body class="teampage">',
        '<a class="skip" href="#main">Skip to content</a>',
        '<main id="main">x</main>',
    ];
    const at = order.map(part => p.indexOf(part));
    assert.ok(at.every(i => i >= 0), JSON.stringify(at));
    assert.deepEqual([...at].sort((a, b) => a - b), at, 'in this order');
    assert.doesNotMatch(p, /data-updated/);
});


test('public pages link the stylesheet and stay script-free', async () => {
    const s = await startServer({env: ENV});
    try {
        for (const p of ['/', '/privacy']) {
            const res = await fetch(s.base + p);
            assert.equal(res.status, 200, p);
            const body = await res.text();
            assert.ok(body.includes(`<link rel="stylesheet" href="/static/app.css?v=${hash(APP_CSS)}">`), p);
            assert.ok(body.includes('<meta name="color-scheme" content="light dark">'), p);
            assert.match(body, /<body class="public">/, p);
            assert.doesNotMatch(body, /<style|\sstyle=|<script/i, p);
        }
    } finally {
        await s.stop();
    }
});


test('the plain section keeps the old pages\' rules under .plain', () => {
    const plain = APP_CSS.slice(APP_CSS.indexOf('/* plain pages */'));
    assert.ok(APP_CSS.indexOf('/* plain pages */') > 0);
    assert.match(plain, /body\.plain\{font:16px\/1\.4 system-ui,sans-serif;max-width:46rem;margin:1\.5rem auto;padding:0 1rem;color:var\(--text\);background:var\(--bg\)\}/);
    assert.match(plain, /\.plain \.amber\{background:var\(--warn-bg\);color:var\(--warn-fg\);/);
    assert.match(plain, /\.plain :is\(h1,h2,h3,h4,p,ul,ol,form\)\{margin:revert\}/);
    // the reverts come before the old rules, or they would undo `h2{margin-top:2rem}`
    assert.ok(plain.indexOf(':is(h1,h2,h3,h4,p,ul,ol,form){margin:revert}') < plain.indexOf('.plain h2{'));
    // the base's word breaking and hidden disclosure marker stay off the old pages (tables, "Delete team")
    assert.match(plain, /\n\.plain\{overflow-wrap:normal\}/);
    assert.match(plain, /\.plain details>summary\{list-style:revert\}\.plain details>summary::-webkit-details-marker\{display:revert\}/);
    assert.doesNotMatch(plain, /#[0-9a-f]{3,6}\b/i, 'tokens only');
    assert.match(APP_CSS, /@media \(min-width:1024px\)\{/);
    assert.doesNotMatch(APP_CSS, /min-width:900px/);
});


test('client.mjs imports without a DOM', async () => {
    await import('../client.mjs');
});


test('appPage: a note without the script', () => {
    // the captain pages need the script (plan versions spec decision 13); only Make live works without it
    const note = '<noscript><div class="nojs"><p class="banner warn" role="note"><svg class="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false">';
    const words = '<span>This page needs JavaScript. Make live still works without it.</span></p></div></noscript>';
    for (const p of [appPage({body: '<main id="main"></main>'}), appPage({body: '<main id="main"></main>', refresh: '/manage/team/rollers', updated: '19:12'})]) {
        assert.equal(count(p, note), 1);
        assert.equal(count(p, words), 1);
        assert.ok(p.indexOf(words) > p.indexOf(note));
        // in the body, before the page: the first thing a reader without the script sees
        assert.ok(p.indexOf('<body') < p.indexOf(note) && p.indexOf(note) < p.indexOf('<main id="main">'), p);
    }
    // a page that works without the script leaves it out
    assert.doesNotMatch(appPage({body: '<main id="main"></main>', needsScript: false}), /noscript|nojs|needs JavaScript/);
    // the page's side padding and width, as the banners inside the page have
    assert.ok(APP_CSS.includes('.nojs{max-width:44rem;margin:0 auto;padding:.75rem max(1rem,env(safe-area-inset-right)) 0 max(1rem,env(safe-area-inset-left))}'));
    // the no-script redraw button went with decision 13, and so did its rule
    assert.doesNotMatch(APP_CSS, /nojs-only/);
});
