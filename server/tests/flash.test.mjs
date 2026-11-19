// The one-shot flash (plan 3b, Task 4): kept in memory, its id in a cookie, bound to its club and
// the page it was meant for, taken once by a GET.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeFlashes, redirectWithFlash, takeFlash, FLASH_COOKIE, FLASH_TTL_MS, FLASH_MAX, FLASH_ID_RE} from '../flash.mjs';

const CID = 'k7f3q9x2m4';
const OTHER = 'p2m8c4t1v9';
const SET_RE = /^__Host-pl_flash=[0-9a-hjkmnp-tv-z]{16}; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=300$/;
const CLEARED = '__Host-pl_flash=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';


// A response that records its headers and its answer.
function fakeRes() {
    const res = {
        cookies: [], status: null, headers: null,
        appendHeader(k, v) {
            assert.equal(k, 'Set-Cookie');
            res.cookies.push(v);
            return res;
        },
        writeHead(status, headers) {
            res.status = status;
            res.headers = headers;
        },
        end() {},
    };
    return res;
}

const reqOf = (method, cookie) => ({method, headers: cookie === null ? {} : {cookie}});


test('flash: one-shot, bound to club and path, expires', () => {
    const f = makeFlashes();
    const id = f.put('k7f3q9x2m4', '/manage/team/rollers', {kind: 'ok', text: 'x'}, 0);
    assert.match(id, FLASH_ID_RE);
    assert.equal(f.take(id, 'p2m8c4t1v9', '/manage/team/rollers', 1), null);   // another club
    assert.equal(f.take(id, 'k7f3q9x2m4', '/manage/settings', 1), null);       // another page
    assert.deepEqual(f.take(id, 'k7f3q9x2m4', '/manage/team/rollers', 1), {kind: 'ok', text: 'x'});
    assert.equal(f.take(id, 'k7f3q9x2m4', '/manage/team/rollers', 2), null);   // once
    const old = f.put('k7f3q9x2m4', '/manage', {kind: 'ok', text: 'y'}, 0);
    assert.equal(f.take(old, 'k7f3q9x2m4', '/manage', FLASH_TTL_MS + 1), null);
});


test('flash: has() tells a flash meant elsewhere from an unknown or expired one', () => {
    const f = makeFlashes();
    const id = f.put(CID, '/manage', {kind: 'ok', text: 'x'}, 0);
    assert.equal(f.has(id, 1), true);
    assert.equal(f.take(id, CID, '/manage/settings', 1), null);
    assert.equal(f.has(id, 1), true, 'a mismatch leaves it in place');
    assert.equal(f.has(id, FLASH_TTL_MS + 1), false, 'expired');
    assert.equal(f.has('zzzzzzzzzzzzzzzz', 1), false, 'unknown');
    assert.equal(f.has('__proto__', 1), false);
    assert.equal(f.take('__proto__', CID, '/manage', 1), null);
});


test('flash: at most FLASH_MAX, the oldest goes; sweep drops expired ones', () => {
    assert.equal(FLASH_MAX, 1000);
    assert.equal(FLASH_TTL_MS, 300000);
    const f = makeFlashes();
    const ids = [];
    for (let i = 0; i < FLASH_MAX; i++) {
        ids.push(f.put(CID, '/manage', {kind: 'ok', text: String(i)}, i));
    }
    assert.equal(f.size(), FLASH_MAX);
    const last = f.put(CID, '/manage', {kind: 'ok', text: 'last'}, FLASH_MAX);
    assert.equal(f.size(), FLASH_MAX);
    assert.equal(f.take(ids[0], CID, '/manage', FLASH_MAX), null, 'the oldest went');
    assert.deepEqual(f.take(ids[1], CID, '/manage', FLASH_MAX), {kind: 'ok', text: '1'});
    assert.equal(f.size(), FLASH_MAX - 1);
    // put at 2..999 and FLASH_MAX: at 300000 + 500 those put before 500 have expired
    assert.equal(f.sweep(FLASH_TTL_MS + 500), 498);
    assert.equal(f.size(), FLASH_MAX - 1 - 498);
    assert.equal(f.take(ids[499], CID, '/manage', FLASH_TTL_MS + 500), null);
    assert.deepEqual(f.take(ids[500], CID, '/manage', FLASH_TTL_MS + 500), {kind: 'ok', text: '500'});
    assert.deepEqual(f.take(last, CID, '/manage', FLASH_TTL_MS + 500), {kind: 'ok', text: 'last'});
    assert.equal(f.sweep(10 * FLASH_TTL_MS), FLASH_MAX - 1 - 498 - 2);
    assert.equal(f.size(), 0);
});


test('redirectWithFlash: 303 to the path, the cookie appended', () => {
    const ctx = {web: {flashes: makeFlashes()}, now: 1000};
    const res = fakeRes();
    res.cookies.push('__Host-pl_club=x; Path=/');
    redirectWithFlash(res, ctx, CID, '/manage', {kind: 'err', text: 'No mail was sent.'});
    assert.equal(res.status, 303);
    assert.equal(res.headers.Location, '/manage');
    assert.equal(res.cookies.length, 2, 'another Set-Cookie stays');
    assert.match(res.cookies[1], SET_RE);
    const id = res.cookies[1].split(';')[0].slice(FLASH_COOKIE.length + 1);
    assert.deepEqual(ctx.web.flashes.take(id, CID, '/manage', 1000), {kind: 'err', text: 'No mail was sent.'});
});


test('takeFlash: GET only, a hit or a dead id clears the cookie, a flash meant elsewhere keeps it', () => {
    const ctx = {web: {flashes: makeFlashes()}, now: 1000};
    const put = (cid = CID, p = '/manage') => ctx.web.flashes.put(cid, p, {kind: 'ok', text: 'Saved.'}, 1000);
    const take = (method, cookie, cid = CID, p = '/manage') => {
        const res = fakeRes();
        return {flash: takeFlash(reqOf(method, cookie), res, ctx, cid, p), cookies: res.cookies};
    };
    const id = put();
    // HEAD never takes it, and leaves the cookie
    assert.deepEqual(take('HEAD', `${FLASH_COOKIE}=${id}`), {flash: null, cookies: []});
    assert.deepEqual(take('POST', `${FLASH_COOKIE}=${id}`), {flash: null, cookies: []});
    // two tabs: the other page's GET leaves it and its cookie
    assert.deepEqual(take('GET', `__Host-pl_club=abc; ${FLASH_COOKIE}=${id}`, CID, '/manage/settings'), {flash: null, cookies: []});
    // another club's GET too
    assert.deepEqual(take('GET', `${FLASH_COOKIE}=${id}`, OTHER), {flash: null, cookies: []});
    assert.deepEqual(take('GET', `__Host-pl_club=abc; ${FLASH_COOKIE}=${id}`), {flash: {kind: 'ok', text: 'Saved.'}, cookies: [CLEARED]});
    // taken: the id is dead now
    assert.deepEqual(take('GET', `${FLASH_COOKIE}=${id}`), {flash: null, cookies: [CLEARED]});
    for (const bad of ['zzzzzzzzzzzzzzzz', '../x', '', 'ZZZZZZZZZZZZZZZZ']) {
        assert.deepEqual(take('GET', `${FLASH_COOKIE}=${bad}`), {flash: null, cookies: [CLEARED]}, bad);
    }
    // expired
    const old = put();
    ctx.now = 1000 + FLASH_TTL_MS + 1;
    assert.deepEqual(take('GET', `${FLASH_COOKIE}=${old}`), {flash: null, cookies: [CLEARED]});
    // no cookie: nothing to clear
    assert.deepEqual(take('GET', null), {flash: null, cookies: []});
    assert.deepEqual(take('GET', '__Host-pl_club=abc'), {flash: null, cookies: []});
});
