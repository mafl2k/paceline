// The two static files every page links: /static/app.css (app-css.mjs) and /static/app.js
// (client.mjs, read once at start). Each carries an ETag of its content; a link with the matching
// ?v= (cssHref, jsHref) may be cached for a year, a bare one is revalidated.
import crypto from 'node:crypto';
import fs from 'node:fs';
import {send, etagMatches, SEC_HEADERS} from './http.mjs';
import {APP_CSS} from './app-css.mjs';

const hash = body => crypto.createHash('sha256').update(body).digest('hex').slice(0, 12);

const FILES = {
    '/static/app.css': {type: 'text/css; charset=utf-8', body: Buffer.from(APP_CSS)},
    '/static/app.js': {type: 'text/javascript; charset=utf-8', body: fs.readFileSync(new URL('./client.mjs', import.meta.url))},
};
for (const f of Object.values(FILES)) {
    f.hash = hash(f.body);
    f.etag = `"${f.hash}"`;
}

export const cssHref = `/static/app.css?v=${FILES['/static/app.css'].hash}`;
export const jsHref = `/static/app.js?v=${FILES['/static/app.js'].hash}`;

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
