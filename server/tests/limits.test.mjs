// Run with: node --test server/tests/limits.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {clientIp, isPublicIp, makeLimiter, makeSlots, SHEET_UPLOADS_MAX} from '../limits.mjs';

const HOUR = 3600000;
const req = (xff, remoteAddress = '127.0.0.1') => ({headers: xff === undefined ? {} : {'x-forwarded-for': xff}, socket: {remoteAddress}});


test('clientIp: the X-Forwarded-For entry `hops` from the end, else the socket', () => {
    const r = req('203.0.113.7, 10.0.0.2', '172.18.0.5');
    assert.equal(clientIp(r, 1), '10.0.0.2');
    assert.equal(clientIp(r, 2), '203.0.113.7');
    assert.equal(clientIp(r, 3), '172.18.0.5');
    assert.equal(clientIp(req(undefined, '172.18.0.5'), 1), '172.18.0.5');
    assert.equal(clientIp(req('  198.51.100.4  ', '172.18.0.5'), 1), '198.51.100.4');
    // no trusted proxy: the header is the client's own and counts for nothing
    assert.equal(clientIp(r, 0), '172.18.0.5');
});


test('makeLimiter: every window counts, a refused hit is not counted', () => {
    const lim = makeLimiter([{ms: HOUR, max: 5}, {ms: 24 * HOUR, max: 20}]);
    const t0 = Date.parse('2026-11-19T00:00:00Z');
    for (let i = 0; i < 5; i++) {
        assert.equal(lim.allow('a', t0 + i), true, `hit ${i + 1}`);
    }
    assert.equal(lim.allow('a', t0 + 5), false);
    assert.equal(lim.count('a', t0 + 5, HOUR), 5);
    assert.equal(lim.allow('b', t0 + 5), true, 'other keys are apart');

    const day = makeLimiter([{ms: HOUR, max: 5}, {ms: 24 * HOUR, max: 20}]);
    let n = 0;
    for (let h = 0; h < 4; h++) {
        for (let i = 0; i < 5; i++) {
            assert.equal(day.allow('a', t0 + h * HOUR + i), true, `hour ${h} hit ${i + 1}`);
            n++;
        }
    }
    assert.equal(n, 20);
    assert.equal(day.allow('a', t0 + 4 * HOUR), false, 'the 21st in one day');
    assert.equal(day.count('a', t0 + 4 * HOUR, 24 * HOUR), 20);
    assert.equal(day.allow('a', t0 + 24 * HOUR), true, 'a day later the first hour has gone');
});


test('makeLimiter: add always counts, old hits drop out, the oldest key goes first', () => {
    const lim = makeLimiter([{ms: HOUR, max: 2}], {maxKeys: 2});
    const t0 = Date.parse('2026-11-19T00:00:00Z');
    for (let i = 0; i < 4; i++) {
        lim.add('a', t0);
    }
    assert.equal(lim.count('a', t0, HOUR), 4);
    assert.equal(lim.allow('a', t0), false);
    assert.equal(lim.count('a', t0 + HOUR - 1, HOUR), 4);
    assert.equal(lim.count('a', t0 + HOUR, HOUR), 0, 'exactly one hour later');
    assert.equal(lim.count('nobody', t0, HOUR), 0);

    lim.add('a', t0);
    lim.add('b', t0);
    lim.add('c', t0);   // past maxKeys: 'a' goes
    assert.equal(lim.count('a', t0, HOUR), 0);
    assert.equal(lim.count('b', t0, HOUR), 1);
    assert.equal(lim.count('c', t0, HOUR), 1);
    lim.add('b', t0);   // touched: 'c' is now the oldest
    lim.add('d', t0);
    assert.equal(lim.count('c', t0, HOUR), 0);
    assert.equal(lim.count('b', t0, HOUR), 2);
    assert.equal(lim.count('__proto__', t0, HOUR), 0);
});


test('makeLimiter: sweep drops keys with no hit inside the longest window', () => {
    const lim = makeLimiter([{ms: HOUR, max: 5}, {ms: 24 * HOUR, max: 20}]);
    const t0 = Date.parse('2026-11-19T00:00:00Z');
    lim.add('idle', t0);
    lim.add('busy', t0);
    lim.add('busy', t0 + 23 * HOUR);
    assert.equal(lim.size(), 2);
    lim.sweep(t0 + 24 * HOUR - 1);
    assert.equal(lim.size(), 2, 'inside the day both stay');
    lim.sweep(t0 + 24 * HOUR);
    assert.equal(lim.size(), 1, 'the idle key is gone');
    assert.equal(lim.count('busy', t0 + 24 * HOUR, 24 * HOUR), 1, 'the busy key keeps its newer hit');
    lim.sweep(t0 + 47 * HOUR);
    assert.equal(lim.size(), 0);
    assert.equal(lim.allow('idle', t0 + 47 * HOUR), true);
});


test('isPublicIp: private, loopback and link-local addresses are not', () => {
    for (const ip of ['203.0.113.7', '2001:db8::1', '8.8.8.8', '172.32.0.1', '100.128.0.1']) {
        assert.equal(isPublicIp(ip), true, ip);
    }
    for (const ip of ['10.0.0.7', '172.20.1.1', '192.168.1.5', '127.0.0.1', '169.254.1.1', '100.64.0.1', '::1',
        '::ffff:10.0.0.7', '::ffff:127.0.0.1', 'fd12::1', 'fc00::1', 'fe80::1', 'nonsense', '', undefined, null]) {
        assert.equal(isPublicIp(ip), false, String(ip));
    }
});


test('makeSlots: one per key, a total cap', () => {
    assert.equal(SHEET_UPLOADS_MAX, 8);
    const s = makeSlots(8);
    assert.equal(s.take('a'), 'ok'); assert.equal(s.take('a'), 'busy');
    for (const k of 'bcdefgh') assert.equal(s.take(k), 'ok');
    assert.equal(s.take('i'), 'full'); assert.equal(s.size(), 8);
    // a key that already holds a slot is busy, not full, even at the cap
    assert.equal(s.take('a'), 'busy');
    s.release('a'); assert.equal(s.busy('a'), false); assert.equal(s.take('i'), 'ok');
    s.release('zz'); assert.equal(s.size(), 8);
});
