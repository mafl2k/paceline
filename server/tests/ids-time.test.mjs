import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
    CID_RE, TOKEN_RE, MOD_RE, isSlug, isEventId, randomId, newToken, tokenHash, slugify, freeSlug,
    nameKey, cleanName, compareModVersion, parseEventUrl,
    RIDER_CODE_RE, newRiderCode, normalizeRiderCode, riderCodeHash, formatRiderCode,
} from '../ids.mjs';
import {
    isDate, isZone, offsetMin, zonedToUtc, localDate, localHHMM, localLabel, addDays, dstChangedRecently,
} from '../time.mjs';


test('random ids and tokens', () => {
    for (let i = 0; i < 200; i++) {
        assert.match(randomId(10), CID_RE);
    }
    const {token, hash} = newToken();
    assert.match(token, TOKEN_RE);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(tokenHash(token), hash);
});


test('rider codes', () => {
    for (let i = 0; i < 200; i++) {
        assert.match(newRiderCode(), RIDER_CODE_RE);
    }
    // Each character is the low 5 bits of one byte, upper case.
    assert.equal(newRiderCode(n => Buffer.from([0, 31, 32, 63, 10, 17, 18, 21, 27, 255].slice(0, n))), '0Z0ZAHJNVZ');
    assert.equal(normalizeRiderCode('rid3r-one5x'), 'R1D3R0NE5X');
    assert.equal(normalizeRiderCode(' 7q4mz 2kx9b '), '7Q4MZ2KX9B');
    assert.equal(normalizeRiderCode('7Q4MZ-2KX9B'), '7Q4MZ2KX9B');
    assert.equal(normalizeRiderCode('7Q4MZ2KX9'), null);
    assert.equal(normalizeRiderCode('7Q4MZ2KX9U'), null);
    assert.equal(normalizeRiderCode('7Q4MZ2KX9B1'), null);
    assert.equal(normalizeRiderCode(42), null);
    // HMAC-SHA256 of the normalized code, keyed with the server secret: not the plain sha256, and
    // another secret gives another hash
    const secret = 'first-secret-0123456789-abcdefghijklmnop';
    const other = 'other-secret-0123456789-abcdefghijklmnop';
    const hash = riderCodeHash('7Q4MZ2KX9B', secret);
    assert.equal(hash, crypto.createHmac('sha256', secret).update('7Q4MZ2KX9B').digest('hex'));
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.notEqual(hash, tokenHash('7Q4MZ2KX9B'));
    assert.notEqual(hash, riderCodeHash('7Q4MZ2KX9B', other));
    assert.equal(riderCodeHash('7q4mz-2kx9b', secret), hash);
    assert.equal(riderCodeHash('R1D3R0NE5X', secret), riderCodeHash('rid3r-one5x', secret));
    // no secret, or no code: null
    assert.equal(riderCodeHash('7Q4MZ2KX9B'), null);
    assert.equal(riderCodeHash('7Q4MZ2KX9B', null), null);
    assert.equal(riderCodeHash('7Q4MZ2KX9B', ''), null);
    assert.equal(riderCodeHash('7Q4MZ2KX9', secret), null);
    assert.equal(riderCodeHash(42, secret), null);
    assert.equal(formatRiderCode('7Q4MZ2KX9B'), '7Q4MZ-2KX9B');
});


test('slugs', () => {
    assert.equal(slugify('Kettenfett Rollers'), 'kettenfett-rollers');
    assert.equal(freeSlug('Kettenfett Rollers', s => s === 'kettenfett-rollers'), 'kettenfett-rollers-2');
    assert.equal(freeSlug('東京', () => false), 'team');
    assert.equal(freeSlug('x'.repeat(60), () => false).length, 40);
    assert.equal(isSlug('__proto__'), false);
});


test('nameKey: look-alikes collide, other scripts are refused', () => {
    for (const n of ['Kettenfett RC', 'kettenfett-rc', 'KETTENFETT  R.C.', 'Ｋettenfett RC']) {
        assert.equal(nameKey(n), 'kettenfettrc', n);
    }
    for (const n of ['Kеttenfett RC', 'K', 'x'.repeat(61), 'Rad\u0007RC']) {
        assert.equal(nameKey(n), null, n);
    }
});


test('cleanName refuses bidi controls, invisible spaces and lone surrogates', () => {
    // U+202E (right-to-left override) before the reversed name: rendered as "Kettenfett RC", but
    // its name key would be "crttefnettek" and not collide with the real club
    const rtl = '\u202E' + [...'Kettenfett RC'].reverse().join('');
    assert.equal(rtl, '\u202ECR ttefnetteK');
    assert.equal(cleanName(rtl, 2, 60), null);
    assert.equal(nameKey(rtl), null);
    for (const n of [
        'Kettenfett\u200E RC',          // left-to-right mark
        'Kettenfett\u200F RC',          // right-to-left mark
        'Kettenfett\u202A RC',          // embedding
        'Kettenfett\u2066 RC\u2069',    // isolates
        'Kettenfett\u200B RC',          // zero-width space
        'Kettenfett\u2060 RC',          // word joiner
        'Kettenfett\uFEFFRC',           // BOM inside the name
        'Kettenfett \uD800RC',          // lone high surrogate
        'Kettenfett \uDC00RC',          // lone low surrogate
        'Kettenfett RC\uD83D',          // a high surrogate at the end
    ]) {
        assert.equal(cleanName(n, 1, 60), null, JSON.stringify(n));
        assert.equal(nameKey(n), null, JSON.stringify(n));
    }
    // emoji sequences keep their joiners: a rainbow flag (ZWJ) and a ZWNJ pass
    const flag = 'Kettenfett RC \u{1F3F3}\uFE0F\u200D\u{1F308}';
    assert.equal(cleanName(flag, 1, 60), flag);
    assert.equal(nameKey(flag), 'kettenfettrc');
    assert.equal(cleanName('Kettenfett\u200CRC', 1, 60), 'Kettenfett\u200CRC');
    // a pair of surrogates is one ordinary character
    assert.equal(cleanName('Kettenfett RC \u{1F6B2}', 1, 60), 'Kettenfett RC \u{1F6B2}');
    assert.equal(cleanName('  Spokesmen   CC ', 1, 60), 'Spokesmen CC');
});


test('compareModVersion', () => {
    assert.equal(compareModVersion('0.3.0-beta.2', '0.3.0'), -1);
    assert.equal(compareModVersion('0.3.0', '0.3.0'), 0);
    assert.equal(compareModVersion('0.3.0-beta.2', '0.3.0-beta.10'), -1);
    assert.equal(compareModVersion('0.3.1-beta.1', '0.3.0'), 1);
    assert.equal(compareModVersion('0.10.0', '0.9.9'), 1);
    assert.match('0.3.0-beta.1', MOD_RE);
});


test('parseEventUrl', () => {
    for (const u of [
        'https://www.zwift.com/events/view/4567890',
        'https://www.zwift.com/eu/events/view/4567890?eventSecret=x',
        'https://zwift.com/de-de/events/view/4567890/',
        'https://zwiftpower.com/events.php?zid=4567890',
        'https://www.zwiftpower.com/events.php?zid=4567890&x=1',
    ]) {
        assert.deepEqual(parseEventUrl(u), {ok: true, id: 4567890}, u);
    }
    assert.deepEqual(parseEventUrl('  '), {ok: true, id: null});
    for (const u of [
        '4567890',
        'https://www.zwift.com/events/view/2147483648',
        'https://evil.example.org/events/view/4567890',
        'https://www.zwift.com/events/view/12ab',
        'javascript:alert(1)',
    ]) {
        assert.deepEqual(parseEventUrl(u), {ok: false}, u);
    }
});


test('isEventId and isDate and isZone', () => {
    assert.equal(isEventId('2147483647'), true);
    assert.equal(isEventId('0'), false);
    assert.equal(isEventId('2147483648'), false);
    assert.equal(isDate('2026-02-30'), false);
    assert.equal(isDate('1850-01-01'), false);
    assert.equal(isDate('2100-01-01'), false);
    assert.equal(isDate('2000-01-01'), true);
    assert.equal(isDate('2099-12-31'), true);
    assert.equal(isDate('2026-02-28'), true);
    assert.equal(isZone('Mars/Base'), false);
    assert.equal(isZone('Europe/Berlin'), true);
    assert.equal(isZone('UTC'), true);
    for (const tz of ['Asia/Kolkata', 'Europe/Kyiv', 'Etc/UTC']) {
        assert.equal(isZone(tz), true, tz);
    }
    for (const tz of ['', 'Europe/Berlin; x', 'x'.repeat(65), null, 5]) {
        assert.equal(isZone(tz), false, String(tz));
    }
});


test('zonedToUtc and labels', () => {
    assert.equal(zonedToUtc('2026-11-19', '19:30', 'Europe/Berlin'), Date.parse('2026-11-19T18:30:00Z'));
    assert.equal(zonedToUtc('2026-07-02', '19:30', 'Europe/Berlin'), Date.parse('2026-07-02T17:30:00Z'));
    assert.equal(zonedToUtc('2026-11-19', '19:30', 'Europe/London'), Date.parse('2026-11-19T19:30:00Z'));
    assert.ok(Number.isFinite(zonedToUtc('2026-03-29', '02:30', 'Europe/Berlin')));
    // Local mean time before 1895 has an offset with seconds: finite, not a throw.
    assert.ok(Number.isFinite(offsetMin(Date.parse('1850-01-01T00:00:00Z'), 'Europe/Berlin')));
    assert.ok(Number.isFinite(zonedToUtc('1850-01-01', '12:00', 'Europe/Berlin')));
    assert.equal(zonedToUtc('2026-03-08', '02:30', 'America/New_York'), Date.parse('2026-03-08T06:30:00Z'));
    assert.equal(localDate(Date.parse('2026-11-19T23:30:00Z'), 'Europe/Berlin'), '2026-11-20');
    assert.equal(localHHMM(Date.parse('2026-11-19T23:30:00Z'), 'Europe/Berlin'), '00:30');
    assert.equal(localLabel(Date.parse('2026-11-19T18:30:00Z'), 'Europe/Berlin'), 'Thu 19 Nov 19:30');
    assert.equal(addDays('2026-11-30', 1), '2026-12-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});


test('dstChangedRecently', () => {
    const tz = 'Europe/Berlin';
    assert.equal(dstChangedRecently(tz, Date.parse('2026-10-30T12:00:00Z')), true);
    assert.equal(dstChangedRecently(tz, Date.parse('2026-11-07T12:00:00Z')), true);
    assert.equal(dstChangedRecently(tz, Date.parse('2026-11-09T12:00:00Z')), false);
    assert.equal(dstChangedRecently(tz, Date.parse('2026-08-01T12:00:00Z')), false);
});
