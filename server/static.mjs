// The static files: /static/app.css (app-css.mjs) and /static/app.js (client.mjs, read once at
// start), which every page links, and the brand images from assets/ (the favicon and touch icon on
// every page, the logo on the start page; user, 22 Nov 2026). Each carries an ETag of its content; a link with the matching
// ?v= (cssHref, jsHref) may be cached for a year, a bare one is revalidated.
import crypto from 'node:crypto';
import fs from 'node:fs';
import {send, etagMatches, SEC_HEADERS} from './http.mjs';
import {APP_CSS} from './app-css.mjs';

const hash = body => crypto.createHash('sha256').update(body).digest('hex').slice(0, 12);

const FILES = {
    '/static/app.css': {type: 'text/css; charset=utf-8', body: Buffer.from(APP_CSS)},
    '/static/app.js': {type: 'text/javascript; charset=utf-8', body: fs.readFileSync(new URL('./client.mjs', import.meta.url))},
    '/static/logo.png': {type: 'image/png', body: fs.readFileSync(new URL('./assets/logo.png', import.meta.url))},
    '/static/favicon.svg': {type: 'image/svg+xml', body: fs.readFileSync(new URL('./assets/favicon.svg', import.meta.url))},
    '/static/apple-touch-icon.png': {type: 'image/png', body: fs.readFileSync(new URL('./assets/apple-touch-icon.png', import.meta.url))},
};
for (const f of Object.values(FILES)) {
    f.hash = hash(f.body);
    f.etag = `"${f.hash}"`;
}

export const cssHref = `/static/app.css?v=${FILES['/static/app.css'].hash}`;
export const jsHref = `/static/app.js?v=${FILES['/static/app.js'].hash}`;
export const logoHref = `/static/logo.png?v=${FILES['/static/logo.png'].hash}`;
export const faviconHref = `/static/favicon.svg?v=${FILES['/static/favicon.svg'].hash}`;
export const touchIconHref = `/static/apple-touch-icon.png?v=${FILES['/static/apple-touch-icon.png'].hash}`;

// The icon links of every page's head (appPage, and page() of the admin pages).
export const iconLinks = `<link rel="icon" href="${faviconHref}" type="image/svg+xml">
<link rel="apple-touch-icon" href="${touchIconHref}">`;

const IMMUTABLE = 'public, max-age=31536000, immutable';
const notFound = res => send(res, 404, 'text/plain; charset=utf-8', 'not found');


// Answers everything under /static/ (true); false for any other path. `method` has HEAD as GET.
export function handleStatic(req, res, p, method, url) {
    if (!p.startsWith('/static/')) {
        return false;
    }
    const f = Object.hasOwn(FILES, p) ? FILES[p] : null;
    if (!f) {
        notFound(res);
        return true;
    }
    if (method !== 'GET') {
        send(res, 405, 'text/plain; charset=utf-8', 'method not allowed', {Allow: 'GET'});
        return true;
    }
    const cache = url.searchParams.get('v') === f.hash ? IMMUTABLE : 'no-cache';
    if (etagMatches(req, f.etag)) {
        res.writeHead(304, {...SEC_HEADERS, ETag: f.etag, 'Cache-Control': cache});
        res.end();
        return true;
    }
    send(res, 200, f.type, f.body, {'Cache-Control': cache, ETag: f.etag});
    return true;
}
