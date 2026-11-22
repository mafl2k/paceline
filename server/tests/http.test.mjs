// Run with: node --test server/tests/http.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import http from 'node:http';
import net from 'node:net';
import {HttpError, ClientAbort, parseMultipart, parseCookies, readBody, redactPath, logPath, BODY_MS} from '../http.mjs';
import {readConfig, modeLine, mailOn} from '../config.mjs';
import {createServer} from '../server.mjs';
import {startServer} from './helpers.mjs';
import {buildMessage} from '../mail.mjs';

const MB = 1024 * 1024;
const CSP = "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
const fixtureJson = fs.readFileSync(new URL('../../tests/fixtures/rollers.json', import.meta.url), 'utf8');


test('healthz and unknown routes', async () => {
    const s = await startServer();
    try {
        const h = await fetch(s.base + '/healthz');
        assert.equal(h.status, 200);
        assert.equal(await h.text(), 'ok');
        const nope = await fetch(s.base + '/nope');
        assert.equal(nope.status, 404);
        assert.equal(nope.headers.get('content-type'), 'text/plain; charset=utf-8');

        const v3 = await fetch(s.base + '/api/v3/rider/1', {method: 'OPTIONS'});
        assert.equal(v3.status, 204);
        assert.equal(v3.headers.get('access-control-allow-origin'), '*');
        assert.equal(v3.headers.get('access-control-allow-methods'), 'GET, OPTIONS');

        const plan = await fetch(s.base + '/api/plan/x', {method: 'OPTIONS'});
        assert.equal(plan.status, 204);
        assert.equal(plan.headers.get('access-control-allow-origin'), '*');
        assert.equal(plan.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
        assert.equal(plan.headers.get('access-control-allow-headers'), 'If-None-Match');
        assert.equal(plan.headers.get('access-control-max-age'), '600');

        const log = await fetch(s.base + '/api/log/x', {method: 'OPTIONS'});
        assert.equal(log.status, 204);
        assert.equal(log.headers.get('access-control-allow-origin'), '*');
        assert.equal(log.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
        assert.equal(log.headers.get('access-control-allow-headers'), 'Content-Type');
        assert.equal(log.headers.get('access-control-max-age'), '600');

        // the v1 pages are gone: `/` is the start page (web.mjs), without v1's upload form
        const home = await fetch(s.base + '/');
        assert.equal(home.status, 200);
        assert.doesNotMatch(await home.text(), /action="\/upload"|type="file"/);
        assert.equal((await fetch(s.base + '/upload', {method: 'POST', body: 'x'})).status, 404);
    } finally {
        await s.stop();
    }
});


test('security headers on every answer', async () => {
    const s = await startServer();
    try {
        for (const p of ['/healthz', '/nope']) {
            const r = await fetch(s.base + p);
            assert.equal(r.headers.get('x-content-type-options'), 'nosniff', p);
            assert.equal(r.headers.get('referrer-policy'), 'no-referrer', p);
            assert.equal(r.headers.get('content-security-policy'), CSP, p);
            assert.equal(r.headers.get('x-robots-tag'), 'noindex', p);
            assert.equal(r.headers.get('cache-control'), 'no-store', p);
        }
    } finally {
        await s.stop();
    }
});


test('parseCookies: space and tab trimmed, nothing else; a name sent twice counts for neither', () => {
    const of = h => Object.fromEntries(parseCookies(h));
    assert.deepEqual(of('a=1; b=2'), {a: '1', b: '2'});
    assert.deepEqual(of(' \ta=1\t ;\tb = 2 '), {a: '1', b: '2'}, 'space and tab around names and values go');
    // U+00A0 and other Unicode white space stay part of the name or value (String.prototype.trim would drop them)
    assert.deepEqual(of('a=\u00a01; \u00a0b=2; c=3\u2003; \ufeffd=4'), {a: '\u00a01', '\u00a0b': '2', c: '3\u2003', '\ufeffd': '4'});
    // the same name twice (or more): which one the browser meant cannot be told, so neither counts
    assert.deepEqual(of('a=1; b=2; a=3'), {b: '2'});
    assert.deepEqual(of('a=1; a=1'), {});
    assert.deepEqual(of('a=1;a=2;a=3; c=4'), {c: '4'});
    assert.deepEqual(of(' a =1; a=2'), {}, 'trimmed names are the same name');
    // names differ by case: two cookies
    assert.deepEqual(of('a=1; A=2'), {a: '1', A: '2'});
    assert.deepEqual(of('novalue; =x; b=2'), {b: '2'});
    assert.deepEqual(of(undefined), {});
});


test('parseMultipart: anything unexpected is rejected', () => {
    const want = {files: ['json', 'text'], fields: ['team']};
    const parse = (body, type = 'multipart/form-data; boundary=XX') => parseMultipart(Buffer.from(body), type, want);
    const part = (name, filename, content) =>
        `--XX\r\nContent-Disposition: form-data; name="${name}"${filename === null ? '' : `; filename="${filename}"`}\r\n\r\n${content}\r\n`;
    // sanity: a hand-built body is accepted
    const ok = parse(part('team', null, 'Rollers') + part('json', 'a.json', fixtureJson) + '--XX--\r\n');
    assert.equal(ok.team.toString(), 'Rollers');
    assert.equal(ok.json.toString(), fixtureJson);
    assert.equal(ok.text, null);
    const isBad = e => e instanceof HttpError && e.status === 400;
    // unknown field, duplicate field, file in team, text in json, header junk, bad boundary, truncated
    for (const body of [
        part('json', 'a.json', fixtureJson) + part('evil', 'x', 'y') + '--XX--\r\n',
        part('json', 'a.json', fixtureJson) + part('json', 'b.json', fixtureJson) + '--XX--\r\n',
        part('team', 'x.txt', 'Team') + part('json', 'a.json', fixtureJson) + '--XX--\r\n',
        part('json', null, fixtureJson) + '--XX--\r\n',
        part('json', 'a.json', fixtureJson),  // no closing delimiter
        part('json', 'a.json', fixtureJson) + '--XX--\r\ntrailing junk',
        'junk before' + part('json', 'a.json', fixtureJson) + '--XX--\r\n',
        `--XX\r\nX-Other: 1\r\nContent-Disposition: form-data; name="json"; filename="a"\r\n\r\n${fixtureJson}\r\n--XX--\r\n`,
    ]) {
        assert.throws(() => parse(body), isBad, body.slice(0, 80));
    }
    assert.throws(() => parse('x', 'application/json'), isBad);
    assert.throws(() => parse(part('json', 'a.json', fixtureJson) + '--XX--\r\n', 'multipart/form-data; boundary='), isBad);
    // a field name that is valid for another form is unknown here
    assert.throws(() => parseMultipart(Buffer.from(part('team', null, 'T') + '--XX--\r\n'),
        'multipart/form-data; boundary=XX', {files: ['json'], fields: []}), isBad);
});


test('parseMultipart handles empty file parts and binary-ish content', () => {
    const body = Buffer.from('--B\r\nContent-Disposition: form-data; name="json"; filename="a.json"\r\nContent-Type: application/json\r\n\r\n{"a":1}\r\n' +
        '--B\r\nContent-Disposition: form-data; name="text"; filename=""\r\nContent-Type: application/octet-stream\r\n\r\n\r\n--B--\r\n');
    const out = parseMultipart(body, 'multipart/form-data; boundary=B', {files: ['json', 'text'], fields: ['team']});
    assert.deepEqual(Object.keys(out).sort(), ['json', 'team', 'text']);
    assert.equal(out.json.toString(), '{"a":1}');
    assert.equal(out.text.length, 0);
    assert.equal(out.team, null);
});


test('readConfig: empty is unset, bad values stop the start', () => {
    const DATA_DIR = '/tmp/paceline-config-test';
    const cfg = readConfig({DATA_DIR});
    assert.ok(Object.isFrozen(cfg));
    assert.equal(cfg.dataDir, DATA_DIR);
    assert.ok(!('oldApi' in cfg) && !('oldApiCircle' in cfg));
    assert.equal(cfg.maxCircles, 50);
    assert.equal(cfg.logMaxFile, 20 * MB);
    assert.equal(cfg.logMaxTotal, 2000 * MB);
    assert.equal(cfg.logMaxCircle, 300 * MB);
    assert.equal(cfg.logRetentionDays, 90);
    assert.equal(cfg.backupRetentionMonths, 6);
    assert.equal(cfg.mailMaxPerDay, 200);
    assert.equal(cfg.trustedProxyHops, 1);
    assert.equal(cfg.registration, 'open');
    assert.equal(cfg.modNotice, 'Please update Paceline to {min} or newer.');
    assert.equal(cfg.tz, 'Europe/Berlin');
    assert.equal(cfg.smtp, null);
    assert.equal(cfg.admin, null);
    assert.equal(cfg.publicUrl, null);
    assert.equal(cfg.codeSecret, null);

    assert.equal(readConfig({DATA_DIR, PACELINE_HOST: 'ttt-beta.example.org'}).publicUrl, 'https://ttt-beta.example.org');
    assert.equal(readConfig({DATA_DIR, SMTP_HOST: 'smtp.example.org', SMTP_SECURE: 'tls'}).smtp.port, 465);
    assert.equal(readConfig({DATA_DIR, SMTP_HOST: 'smtp.example.org'}).smtp.port, 587);
    assert.deepEqual(readConfig({DATA_DIR, UPLOAD_USER: 'u', UPLOAD_PASS: 'p'}).admin, {user: 'u', pass: 'p'});
    // OLD_API and OLD_API_CIRCLE are gone (hard cut, 17 Nov 2026): a leftover value is ignored, even a bad one
    assert.deepEqual(readConfig({DATA_DIR, OLD_API: 'compat', OLD_API_CIRCLE: 'k7f3q9x2m4'}), cfg);
    assert.deepEqual(readConfig({DATA_DIR, OLD_API: 'off', OLD_API_CIRCLE: 'K7F3Q9X2M4'}), cfg);
    // every variable empty: the defaults, as with nothing set
    const empty = readConfig(Object.fromEntries(['PORT', 'PUBLIC_URL', 'PACELINE_HOST', 'PACELINE_TZ', 'MAX_CIRCLES',
        'LOG_MAX_FILE_MB', 'LOG_MAX_TOTAL_MB', 'LOG_MAX_CIRCLE_MB', 'LOG_RETENTION_DAYS', 'MOD_MIN_VERSION', 'MOD_NOTICE',
        'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM',
        'MAIL_MAX_PER_DAY', 'REGISTRATION', 'PRIVACY_CONTACT', 'PRIVACY_WHERE', 'ADMIN_USER', 'ADMIN_PASS', 'UPLOAD_USER', 'UPLOAD_PASS',
        'TRUSTED_PROXY_HOPS', 'CODE_SECRET', 'BACKUP_RETENTION_MONTHS'].map(k => [k, '']).concat([['DATA_DIR', DATA_DIR]])));
    assert.deepEqual(empty, cfg);

    assert.throws(() => readConfig({DATA_DIR, PACELINE_TZ: 'Mars/Base'}), /PACELINE_TZ/);
    assert.throws(() => readConfig({DATA_DIR, MOD_MIN_VERSION: '0.3'}), /MOD_MIN_VERSION/);

    // keywords ignore surrounding whitespace
    assert.equal(readConfig({DATA_DIR, REGISTRATION: ' closed'}).registration, 'closed');
    assert.equal(readConfig({DATA_DIR, SMTP_HOST: 'smtp.example.org', SMTP_SECURE: ' tls '}).smtp.secure, 'tls');
    // a login is both halves or neither
    assert.throws(() => readConfig({DATA_DIR, ADMIN_USER: 'op'}), /ADMIN_USER and ADMIN_PASS must be set together/);
    assert.throws(() => readConfig({DATA_DIR, UPLOAD_PASS: 'p'}), /UPLOAD_USER and UPLOAD_PASS must be set together/);
    assert.throws(() => readConfig({DATA_DIR, SMTP_HOST: 'smtp.example.org', SMTP_USER: 'mailuser'}),
        /SMTP_USER and SMTP_PASS must be set together/);
    // sizes in MB above 0, decimals allowed
    assert.equal(readConfig({DATA_DIR, LOG_MAX_FILE_MB: '0.5'}).logMaxFile, MB / 2);
    for (const bad of ['0', '-1', 'lots']) {
        assert.throws(() => readConfig({DATA_DIR, LOG_MAX_CIRCLE_MB: bad}), /LOG_MAX_CIRCLE_MB/, bad);
    }
    // backups kept by the operator, in whole months from 1 (the privacy page says it)
    assert.equal(readConfig({DATA_DIR, BACKUP_RETENTION_MONTHS: '12'}).backupRetentionMonths, 12);
    for (const bad of ['0', 'x']) {
        assert.throws(() => readConfig({DATA_DIR, BACKUP_RETENTION_MONTHS: bad}), /BACKUP_RETENTION_MONTHS is not a whole number from 1/, bad);
    }
});


test('readConfig: CODE_SECRET needs 32 characters, and is never printed', () => {
    const DATA_DIR = '/tmp/paceline-config-test';
    const secret = 'made-up-secret-0123456789-abcdefghijk';
    assert.ok(secret.length >= 32);
    assert.equal(readConfig({DATA_DIR, CODE_SECRET: secret}).codeSecret, secret);
    assert.equal(readConfig({DATA_DIR, CODE_SECRET: ''}).codeSecret, null);
    assert.equal(readConfig({DATA_DIR, CODE_SECRET: 'x'.repeat(32)}).codeSecret, 'x'.repeat(32));
    const short = 'short-secret-31-characters-long';
    assert.equal(short.length, 31);
    assert.throws(() => readConfig({DATA_DIR, CODE_SECRET: short}),
        e => e instanceof Error && e.message.includes('CODE_SECRET') && !e.message.includes(short));
    assert.throws(() => readConfig({DATA_DIR, CODE_SECRET: 'tiny'}),
        e => e instanceof Error && e.message.includes('CODE_SECRET') && !e.message.includes('tiny'));

    // the start log line: private clubs on or off, never the secret
    const on = modeLine(readConfig({DATA_DIR, CODE_SECRET: secret}));
    assert.match(on, /private clubs: on(;|$)/);
    assert.ok(!on.includes(secret));
    const off = modeLine(readConfig({DATA_DIR}));
    assert.match(off, /private clubs: off \(no CODE_SECRET\)/);
});


test('readConfig: PRIVACY_WHERE is trimmed free text, 500 characters at most, no control characters', () => {
    const DATA_DIR = '/tmp/paceline-config-test';
    const where = env => readConfig({DATA_DIR, ...env}).privacyWhere;
    assert.equal(where({}), null);
    assert.equal(where({PRIVACY_WHERE: ''}), null);
    assert.equal(where({PRIVACY_WHERE: '   '}), null, 'only spaces counts as unset');
    assert.equal(where({PRIVACY_WHERE: '  Runs on our own servers in Germany (EU).\n'}), 'Runs on our own servers in Germany (EU).');
    assert.equal(where({PRIVACY_WHERE: 'x'.repeat(500)}), 'x'.repeat(500));
    assert.throws(() => readConfig({DATA_DIR, PRIVACY_WHERE: 'x'.repeat(501)}), /PRIVACY_WHERE is too long/);
    for (const bad of ['one\ntwo', 'tab\there', 'bell\u0007', 'nul\u0000', 'esc\u001b[0m', 'del\u007f', 'c1\u0085', 'sep\u2028x']) {
        assert.throws(() => readConfig({DATA_DIR, PRIVACY_WHERE: bad}), /PRIVACY_WHERE has control characters/, JSON.stringify(bad));
    }
    // the start log line says nothing about it
    assert.doesNotMatch(modeLine(readConfig({DATA_DIR, PRIVACY_WHERE: 'Somewhere'})), /Somewhere|PRIVACY_WHERE/);
});


test('readConfig: the .env.example placeholder password is refused, without printing it', () => {
    const DATA_DIR = '/tmp/paceline-config-test';
    const placeholder = 'change-me-to-a-long-random-password';
    const refused = name => e => e instanceof Error && e.message.includes(name) && !e.message.includes(placeholder);
    assert.throws(() => readConfig({DATA_DIR, UPLOAD_USER: 'captain', UPLOAD_PASS: placeholder}), refused('UPLOAD_PASS'));
    assert.throws(() => readConfig({DATA_DIR, ADMIN_USER: 'op', ADMIN_PASS: placeholder}), refused('ADMIN_PASS'));
    // ADMIN_* wins, so a placeholder left in the unused UPLOAD_* pair does not matter
    assert.deepEqual(readConfig({DATA_DIR, ADMIN_USER: 'op', ADMIN_PASS: 'adm-secret-1', UPLOAD_USER: 'captain',
        UPLOAD_PASS: placeholder}).admin, {user: 'op', pass: 'adm-secret-1'});
});


test('the start log names the modes and no secrets', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paceline-server-'));
    const lines = [];
    const log = console.log;
    console.log = (...a) => lines.push(a.join(' '));
    let server;
    try {
        server = createServer({env: {
            DATA_DIR: dataDir, ADMIN_USER: 'opname', ADMIN_PASS: 'adm-secret-1',
            SMTP_HOST: 'smtp.example.org', SMTP_USER: 'mailuser', SMTP_PASS: 'smtp-secret-2',
            MAIL_FROM: 'Paceline <paceline@example.org>', PUBLIC_URL: 'https://ttt-beta.example.org',
            PRIVACY_CONTACT: 'privacy@example.org',
        }});
    } finally {
        console.log = log;
        server?.close();
        fs.rmSync(dataDir, {recursive: true, force: true});
    }
    const mode = lines.filter(l => /mail: on/.test(l) && /admin: on/.test(l) && /registration: open/.test(l) &&
        /private clubs: off/.test(l) && /privacy contact: set(;|$)/.test(l));
    assert.equal(mode.length, 1, lines.join('\n'));
    // no old api any more (hard cut, 17 Nov 2026)
    assert.doesNotMatch(mode[0], /old api|OLD_API/i);
    for (const l of lines) {
        for (const secret of ['opname', 'adm-secret-1', 'mailuser', 'smtp-secret-2', 'privacy@example.org']) {
            assert.ok(!l.includes(secret), `${secret} in ${l}`);
        }
    }
});


test('the start log names the UPLOAD_* fallback of the operator login', () => {
    const DATA_DIR = '/tmp/paceline-config-test';
    const line = env => modeLine(readConfig({DATA_DIR, ...env}));
    const upload = {UPLOAD_USER: 'captain', UPLOAD_PASS: 'upload-secret-1'};
    assert.match(line({}), /; admin: off; /);
    assert.match(line({ADMIN_USER: 'op', ADMIN_PASS: 'adm-secret-1'}), /; admin: on; /);
    assert.match(line({ADMIN_USER: 'op', ADMIN_PASS: 'adm-secret-1', ...upload}), /; admin: on; /);
    assert.match(line(upload), /; admin: on \(UPLOAD_\* fallback — set ADMIN_\*\); /);
    assert.equal(readConfig({DATA_DIR, ...upload}).adminFallback, true);
    assert.equal(readConfig({DATA_DIR, ADMIN_USER: 'op', ADMIN_PASS: 'adm-secret-1', ...upload}).adminFallback, false);
    assert.ok(!line(upload).includes('captain') && !line(upload).includes('upload-secret-1'));
});


test('the start log: mail is on only with SMTP_HOST, MAIL_FROM and PUBLIC_URL', () => {
    const DATA_DIR = '/tmp/paceline-config-test';
    const smtp = {DATA_DIR, SMTP_HOST: 'smtp.example.org'};
    const from = {MAIL_FROM: 'paceline@example.org'};
    const url = {PUBLIC_URL: 'https://ttt-beta.example.org'};
    const line = env => modeLine(readConfig(env));
    assert.match(line({DATA_DIR}), /mail: off; .*registration: off \(no mail\); .*privacy contact: unset$/);
    assert.match(line({...smtp, ...url}), /mail: off \(MAIL_FROM unset\); .*registration: off \(no mail\)/);
    assert.match(line({...smtp, ...from}), /mail: off \(PUBLIC_URL unset\); .*registration: off \(no mail\)/);
    assert.match(line({...from, ...url}), /mail: off; .*registration: off \(no mail\)/);
    assert.match(line({...smtp, ...from, ...url}), /mail: on \(smtp\.example\.org:587 starttls\); .*registration: open/);
    assert.match(line({...smtp, ...from, ...url, REGISTRATION: 'closed'}), /registration: closed/);
    assert.equal(mailOn(readConfig({...smtp, ...from, ...url})), true);
    assert.equal(mailOn(readConfig({...smtp, ...from})), false);
    // PACELINE_HOST also gives the PUBLIC_URL
    assert.match(line({...smtp, ...from, PACELINE_HOST: 'ttt-beta.example.org'}), /mail: on/);
});


test('readConfig: MAIL_FROM is an address, with or without a display name', () => {
    const DATA_DIR = '/tmp/paceline-config-test';
    assert.equal(readConfig({DATA_DIR, MAIL_FROM: 'paceline@example.org'}).mailFrom, 'paceline@example.org');
    assert.equal(readConfig({DATA_DIR, MAIL_FROM: 'Paceline <paceline@example.org>'}).mailFrom,
        'Paceline <paceline@example.org>');
    assert.equal(readConfig({DATA_DIR, MAIL_FROM: ''}).mailFrom, null);
    for (const bad of ['paceline', 'Paceline <paceline>', 'a b@example.org', 'Paceline <>', 'p@example.org\r\nBcc: x@example.org']) {
        assert.throws(() => readConfig({DATA_DIR, MAIL_FROM: bad}), /^Error: MAIL_FROM is not an address/, bad);
    }
});


test('readConfig: MAIL_FROM loses surrounding white space; a control character inside stops the start', () => {
    const DATA_DIR = '/tmp/paceline-config-test';
    const header = from => buildMessage({from, to: 'captain@example.org', subject: 'x', text: 'y', now: 0, host: 'ttt-beta.example.org'});
    // an env file with CRLF line ends or a trailing tab: every mail's From header was refused
    for (const raw of ['Paceline <paceline@example.org>\r', 'Paceline <paceline@example.org>\t', ' Paceline <paceline@example.org>\n']) {
        assert.throws(() => header(raw), /header/, 'the raw value fails every mail');
        const cfg = readConfig({DATA_DIR, MAIL_FROM: raw});
        assert.equal(cfg.mailFrom, 'Paceline <paceline@example.org>');
        assert.match(header(cfg.mailFrom), /^From: Paceline <paceline@example\.org>\r\n/);
    }
    assert.equal(readConfig({DATA_DIR, MAIL_FROM: 'paceline@example.org\r'}).mailFrom, 'paceline@example.org');
    assert.equal(readConfig({DATA_DIR, MAIL_FROM: ' \t'}).mailFrom, null);
    for (const bad of ['Pace\tline <paceline@example.org>', 'Pace\u0007line <paceline@example.org>', 'Pace\u0085line <paceline@example.org>']) {
        assert.throws(() => readConfig({DATA_DIR, MAIL_FROM: bad}), /^Error: MAIL_FROM has control characters: use one line of plain text$/, JSON.stringify(bad));
    }
});


// A request body is held once: when readBody resolves (or refuses), its chunks can be collected
// although the request and its listeners are still alive (the caller works on the body meanwhile).
test('readBody holds the body once', async () => {
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc');
    const fakeReq = () => Object.assign(new EventEmitter(), {headers: {}, complete: false, pause() {}});
    const later = () => new Promise(r => setImmediate(r));
    const collected = async refs => {
        for (let i = 0; i < 10 && refs.some(r => r.deref() !== undefined); i++) {
            await later();
            gc();
        }
        return refs.every(r => r.deref() === undefined);
    };
    // weak refs are made in a function of their own, so no strong reference stays on this stack
    const feed = (req, n) => {
        const refs = [];
        for (let i = 0; i < n; i++) {
            const c = Buffer.alloc(MB, i);
            refs.push(new WeakRef(c));
            req.emit('data', c);
        }
        return refs;
    };

    const req = fakeReq();
    const p = readBody(req, 10 * MB);
    const refs = feed(req, 3);
    req.complete = true;
    req.emit('end');
    const body = await p;
    assert.equal(body.length, 3 * MB);
    assert.equal(body[2 * MB], 2);
    assert.ok(await collected(refs), 'readBody still holds its chunks after resolving');
    assert.equal(req.listenerCount('data'), 1);  // the listener is still there; only its chunks went

    const big = fakeReq();
    const refused = readBody(big, 2 * MB + 1).catch(e => e);
    const bigRefs = feed(big, 3);
    assert.equal((await refused).status, 413);
    assert.ok(await collected(bigRefs), 'readBody still holds its chunks after refusing');
    assert.ok(body.length && req && big);  // all alive up to here
});


test('readBody: a body not complete within its deadline is refused with 408', async t => {
    const req = Object.assign(new EventEmitter(), {headers: {}, complete: false, paused: false, pause() {
        this.paused = true;
    }});
    const keepAlive = setInterval(() => {}, 1000);     // readBody's timer is unref'd
    t.after(() => clearInterval(keepAlive));
    const t0 = Date.now();
    const p = readBody(req, MB, 100).catch(e => e);
    req.emit('data', Buffer.alloc(10));
    const e = await Promise.race([p, new Promise(r => setTimeout(() => r('no deadline'), 2000))]);
    assert.ok(e instanceof HttpError);
    assert.equal(e.status, 408);
    assert.ok(Date.now() - t0 >= 90);
    assert.equal(req.paused, true);
    req.emit('data', Buffer.alloc(10));                     // late data and the end change nothing
    req.complete = true;
    req.emit('end');
    // a body in time is not affected by the deadline, and the timer goes with it
    const ok = Object.assign(new EventEmitter(), {headers: {}, complete: false, pause() {}});
    const q = readBody(ok, MB, 100);
    ok.emit('data', Buffer.from('ab'));
    ok.complete = true;
    ok.emit('end');
    assert.equal(String(await q), 'ab');
    await new Promise(r => setTimeout(r, 150));
});


test('readBody tells a client abort from node\'s request timeout', async () => {
    const seen = [];
    const server = http.createServer({requestTimeout: 200, connectionsCheckingInterval: 50}, (req, res) => {
        readBody(req, MB).then(() => res.end('ok'), e => {
            seen.push(e);
            res.destroy();
        });
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const {port} = server.address();
    const open = () => {
        const socket = net.connect(port, '127.0.0.1');
        socket.on('error', () => {});
        socket.write('POST /x HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 100\r\n\r\n0123456789');
        return socket;
    };
    const until = async n => {
        for (let i = 0; seen.length < n; i++) {
            assert.ok(i < 400, 'readBody never rejected');
            await new Promise(r => setTimeout(r, 5));
        }
    };
    try {
        const gone = open();
        await new Promise(r => setTimeout(r, 50));
        gone.destroy();
        await until(1);
        open();                                             // never sends the rest
        await until(2);
        assert.ok(seen.every(e => e instanceof ClientAbort));
        assert.deepEqual(seen.map(e => [e.timeout, e.message]),
            [[false, 'request aborted by the client'], [true, 'request timed out']]);
    } finally {
        server.closeAllConnections();
        await new Promise(r => server.close(r));
    }
});


test('logPath: tokens and Zwift IDs out', () => {
    assert.equal(logPath('/m/AbCdEfGhIjKlMnOpQrStUv'), '/m/…');
    assert.equal(logPath('/api/v3/rider/1001'), '/api/v3/rider/…');
    assert.equal(logPath('/api/v3/rider/7'), '/api/v3/rider/…');
    assert.equal(logPath('/api/plan/by-athlete/5100005'), '/api/plan/by-athlete/…');
    assert.equal(logPath('/manage/logs/rollers-2/1763280000000-5100005.jsonl.gz'), '/manage/logs/rollers-2/…-….jsonl.gz');
    assert.equal(logPath('/api/log/rollers'), '/api/log/rollers');
    assert.equal(logPath('/manage/upload'), '/manage/upload');
});


test('a failed request logs its path without IDs and the error kind without its message', async () => {
    const srv = await startServer();
    const lines = [];
    const error = console.error;
    console.error = (...a) => lines.push(a.join(' '));
    try {
        srv.store.tokenOwner = () => {
            throw Object.assign(new Error('ENOENT: no such file, open \'/data/logs/k7f3q9x2m4/rollers/1763280000000-5100005.jsonl.gz\''), {code: 'ENOENT'});
        };
        const res = await fetch(srv.base + '/manage/logs/rollers/1763280000000-5100005.jsonl.gz', {
            headers: {cookie: '__Host-pl_club=AbCdEfGhIjKlMnOpQrStUv'},
        });
        assert.equal(res.status, 500);
        assert.equal(await res.text(), 'internal error');
    } finally {
        console.error = error;
        await srv.stop();
    }
    assert.equal(lines.length, 1, lines.join('\n'));
    const [first, ...frames] = lines[0].split('\n');
    assert.equal(first, 'request failed: GET /manage/logs/rollers/…-….jsonl.gz: ENOENT');
    assert.ok(frames.length > 0 && frames.every(l => /^\s+at /.test(l)), lines[0]);
    assert.ok(!lines[0].includes('5100005') && !lines[0].includes('no such file'), lines[0]);
});


test('redactPath', () => {
    assert.equal(redactPath('/m/AbCdEfGhIjKlMnOpQrStUv'), '/m/…');
    assert.equal(redactPath('/t/x/y'), '/t/…/y');
    assert.equal(redactPath('/manage'), '/manage');
    assert.equal(redactPath('/api/v3/rider/1001'), '/api/v3/rider/1001');
});


test('readBody: without a deadline of its own the body gets BODY_MS (30 s)', async t => {
    assert.equal(BODY_MS, 30000);
    t.mock.timers.enable({apis: ['setTimeout']});
    const mk = () => Object.assign(new EventEmitter(), {headers: {}, complete: false, paused: false, pause() {
        this.paused = true;
    }});
    const req = mk();
    const p = readBody(req, MB).catch(e => e);
    req.emit('data', Buffer.alloc(10));
    t.mock.timers.tick(BODY_MS - 1);
    assert.equal(req.paused, false);                       // not yet
    t.mock.timers.tick(1);
    const e = await p;
    assert.ok(e instanceof HttpError);
    assert.equal(e.status, 408);
    assert.equal(req.paused, true);
    // a caller's own deadline replaces it (recordings: 120 s), and 0 turns the deadline off
    const long = mk();
    const q = readBody(long, MB, 120000);
    t.mock.timers.tick(BODY_MS + 1);
    assert.equal(long.paused, false);
    long.emit('data', Buffer.from('ab'));
    long.complete = true;
    long.emit('end');
    assert.equal(String(await q), 'ab');
    const none = mk();
    const r = readBody(none, MB, 0);
    t.mock.timers.tick(10 * BODY_MS);
    assert.equal(none.paused, false);
    none.emit('end');
    assert.equal((await r).length, 0);
});
