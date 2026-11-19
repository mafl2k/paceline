// The one-shot flash after a captain's POST (spec §5.4): the POST answers 303 to the page it came
// from, and that page's next GET shows what was done, once. The flash is kept in memory (one
// replica), only its id travels in a cookie. Each flash is bound to its club and the path it was
// meant for, lives FLASH_TTL_MS and is taken by a GET only (a HEAD never takes it); at most
// FLASH_MAX are kept, the oldest goes first.
import {send, parseCookies} from './http.mjs';
import {randomId} from './ids.mjs';

export const FLASH_COOKIE = '__Host-pl_flash';
export const FLASH_TTL_MS = 300000;
export const FLASH_MAX = 1000;
export const FLASH_ID_RE = /^[0-9a-hjkmnp-tv-z]{16}$/;
const COOKIE_ATTRS = 'HttpOnly; Secure; SameSite=Lax; Path=/';


// The store: id -> {cid, path, flash ({kind: 'ok' | 'err', text}), at}, oldest first.
export function makeFlashes() {
    const entries = new Map();
    const expired = (e, now) => now - e.at > FLASH_TTL_MS;
    return {
        put(cid, path, flash, now) {
            let id = randomId(16);
            while (entries.has(id)) {
                id = randomId(16);
            }
            entries.set(id, {cid, path, flash, at: now});
            if (entries.size > FLASH_MAX) {
                entries.delete(entries.keys().next().value);
            }
            return id;
        },
        // The flash, deleted, when it is for this club and path and still fresh, else null. A
        // mismatch leaves it in place; an expired one goes.
        take(id, cid, path, now) {
            const e = entries.get(id);
            if (!e) {
                return null;
            }
            if (expired(e, now)) {
                entries.delete(id);
                return null;
            }
            if (e.cid !== cid || e.path !== path) {
                return null;
            }
            entries.delete(id);
            return e.flash;
        },
        // Whether a fresh flash has this id (for any club and path).
        has(id, now) {
            const e = entries.get(id);
            return e !== undefined && !expired(e, now);
        },
        sweep(now) {
            let n = 0;
            for (const [id, e] of entries) {
                if (expired(e, now)) {
                    entries.delete(id);
                    n++;
                }
            }
            return n;
        },
        size: () => entries.size,
    };
}


// 303 to `path` with `flash` kept for club `cid`; the cookie is appended, so another Set-Cookie of
// the answer stays.
export function redirectWithFlash(res, ctx, cid, path, flash) {
    const id = ctx.web.flashes.put(cid, path, flash, ctx.now);
    res.appendHeader('Set-Cookie', `${FLASH_COOKIE}=${id}; ${COOKIE_ATTRS}; Max-Age=${FLASH_TTL_MS / 1000}`);
    send(res, 303, 'text/plain; charset=utf-8', '', {Location: path});
}


// The flash a GET of `path` by club `cid` shows, or null. A taken flash, or an id that is unknown,
// expired or malformed, clears the cookie; a flash meant for another club or page (another tab)
// keeps it, and its cookie with it. A HEAD or any other method takes nothing.
export function takeFlash(req, res, ctx, cid, path) {
    if (req.method !== 'GET') {
        return null;
    }
    const id = parseCookies(req.headers.cookie).get(FLASH_COOKIE);
    if (id === undefined) {
        return null;
    }
    const {flashes} = ctx.web;
    const flash = FLASH_ID_RE.test(id) ? flashes.take(id, cid, path, ctx.now) : null;
    if (flash === null && FLASH_ID_RE.test(id) && flashes.has(id, ctx.now)) {
        return null;
    }
    res.appendHeader('Set-Cookie', `${FLASH_COOKIE}=; ${COOKIE_ATTRS}; Max-Age=0`);
    return flash;
}
