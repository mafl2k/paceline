// Run with: node --test server/tests/mail.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import {MailError, addressOf, buildMessage, isAddress, sendMail} from '../mail.mjs';
import {startFakeSmtp} from './fake-smtp.mjs';

// The fixture key pair is left out of the public copy (.public-exclude): the TLS tests skip there.
const CERT_URL = new URL('./fixtures/localhost-cert.pem', import.meta.url);
const KEY_URL = new URL('./fixtures/localhost-key.pem', import.meta.url);
const haveCert = fs.existsSync(CERT_URL) && fs.existsSync(KEY_URL);
const cert = haveCert ? fs.readFileSync(CERT_URL, 'utf8') : null;
const needsCert = haveCert ? {} : {skip: 'server/tests/fixtures/localhost-*.pem missing (public copy)'};

const NOW = Date.parse('2026-11-19T18:30:05Z');
const msg = (over = {}) => buildMessage({
    from: 'Paceline <paceline@example.org>', to: 'captain@example.org',
    subject: 'Paceline: new link for Kettenfett RC', text: 'Hello.\nOpening it ends the old link.\n',
    now: NOW, host: 'ttt-beta.example.org', ...over,
});
const headersOf = (m) => m.slice(0, m.indexOf('\r\n\r\n')).split('\r\n');
const bodyOf = (m) => m.slice(m.indexOf('\r\n\r\n') + 4);
const login = {user: 'u', pass: 'p'};
const opts = (over = {}) => ({ehlo: 'ttt-beta.example.org', tls: {ca: cert}, ...over});
const envelope = {from: 'paceline@example.org', to: 'captain@example.org', data: msg()};

// Fails the test when anything escapes as an uncaught exception while `fn` runs.
async function noUncaught(fn) {
    const seen = [];
    const onUncaught = (err) => seen.push(err);
    process.on('uncaughtException', onUncaught);
    try {
        await fn();
        await new Promise((r) => setTimeout(r, 50));
    } finally {
        process.off('uncaughtException', onUncaught);
    }
    assert.deepEqual(seen, [], 'no uncaughtException');
}


test('buildMessage: CRLF lines and the header list', () => {
    const m = msg();
    assert.match(m, /\r\n$/);
    assert.equal(m.replace(/\r\n/g, '').includes('\n'), false, 'no bare LF');
    assert.equal(m.replace(/\r\n/g, '').includes('\r'), false, 'no bare CR');
    const names = headersOf(m).map((l) => l.slice(0, l.indexOf(':')));
    assert.deepEqual(names, ['From', 'To', 'Subject', 'Date', 'Message-ID', 'MIME-Version',
        'Content-Type', 'Content-Transfer-Encoding']);
    const h = headersOf(m);
    assert.equal(h[0], 'From: Paceline <paceline@example.org>');
    assert.equal(h[1], 'To: captain@example.org');
    assert.equal(h[2], 'Subject: Paceline: new link for Kettenfett RC');
    assert.match(h[4], /^Message-ID: <[0-9a-f]{32}@ttt-beta\.example\.org>$/);
    assert.equal(h[5], 'MIME-Version: 1.0');
    assert.equal(h[6], 'Content-Type: text/plain; charset=utf-8');
    assert.notEqual(msg().match(/^Message-ID: .*$/m)[0], msg().match(/^Message-ID: .*$/m)[0], 'a new id per mail');
});


test('buildMessage: 7bit for ASCII, base64 and RFC 2047 otherwise', () => {
    const ascii = msg();
    assert.match(ascii, /^Content-Transfer-Encoding: 7bit$/m);
    assert.equal(bodyOf(ascii), 'Hello.\r\nOpening it ends the old link.\r\n');

    const text = 'Grüße an Rädle RC.\n' + 'Eine lange Zeile. '.repeat(20) + '\n';
    const m = msg({subject: 'Paceline: confirm your club Rädle RC', text});
    assert.match(m, /^Content-Transfer-Encoding: base64$/m);
    const lines = bodyOf(m).split('\r\n');
    assert.equal(lines.pop(), '', 'the body ends in CRLF');
    assert.ok(lines.length > 1);
    for (const l of lines.slice(0, -1)) {
        assert.equal(l.length, 76);
    }
    assert.ok(lines.at(-1).length <= 76);
    assert.equal(Buffer.from(lines.join(''), 'base64').toString('utf8'), text.replace(/\n/g, '\r\n'));

    const subject = m.match(/^Subject: (.*)$/m)[1];
    const word = subject.match(/^=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/);
    assert.ok(word, subject);
    assert.equal(Buffer.from(word[1], 'base64').toString('utf8'), 'Paceline: confirm your club Rädle RC');
});


test('buildMessage: a long non-ASCII subject is folded into encoded words of at most 75 chars', () => {
    const long = 'Paceline: confirm: change the address of Ränder Röller Rädle Rennrad-Club Südstadt 🚴‍♀️';
    const m = msg({subject: long});
    const start = m.indexOf('Subject: ');
    const block = m.slice(start, m.indexOf('\r\nDate: ')).slice('Subject: '.length);
    const words = block.split('\r\n ');
    assert.ok(words.length > 1);
    let bytes = [];
    for (const w of words) {
        assert.ok(w.length <= 75, w);
        const b = w.match(/^=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/);
        assert.ok(b, w);
        const part = Buffer.from(b[1], 'base64');
        assert.equal(part.toString('utf8').includes('�'), false, 'no split character');
        bytes.push(part);
    }
    assert.equal(Buffer.concat(bytes).toString('utf8'), long);
});


test('buildMessage: Date is RFC 5322 in +0000', () => {
    const m = msg();
    assert.match(m, /^Date: \w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} \+0000$/m);
    assert.match(m, /^Date: Thu, 19 Nov 2026 18:30:05 \+0000$/m);
    assert.match(msg({now: Date.parse('2026-12-03T07:04:09Z')}), /^Date: Thu, 03 Dec 2026 07:04:09 \+0000$/m);
});


test('buildMessage: CR, LF and control characters in a header value throw', () => {
    const bad = [
        {subject: 'Hi\r\nBcc: x@example.org'},
        {subject: 'Hi\nBcc: x@example.org'},
        {subject: 'Hi\rthere'},
        {subject: 'tab\there'},
        {subject: 'nul\u0000'},
        {subject: 'del\u007f'},
        {subject: 'c1\u0085'},
        {to: 'captain@example.org\r\nBcc: x@example.org'},
        {from: 'Paceline <paceline@example.org>\n'},
        {host: 'ttt-beta.example.org\r\nX: y'},
    ];
    for (const over of bad) {
        assert.throws(() => msg(over), (err) => err instanceof MailError && err.kind === 'header' && err.code === null,
            JSON.stringify(over));
    }
});


test('MailError: kind and code, the message names nothing else', () => {
    const e = new MailError('reply', 451);
    assert.ok(e instanceof Error);
    assert.equal(e.kind, 'reply');
    assert.equal(e.code, 451);
    assert.equal(e.name, 'MailError');
    assert.equal(new MailError('network').code, null);
    assert.match(new MailError('network').message, /network/);
    assert.match(e.message, /reply/);
    assert.match(e.message, /451/);
});


test('isAddress and addressOf', () => {
    assert.equal(isAddress('captain@example.org'), true);
    assert.equal(isAddress('cleo.rider+ttt@mail.example.org'), true);
    for (const s of ['a@b', 'a@@example.org', 'a b@example.org', 'x'.repeat(250) + '@example.org',
        'a@example.org\r\n', 'a@example.org\n', '@example.org', 'a@.org', 'a@example.', 'a@example..org',
        '<a@example.org>', 'a@exa\u0000mple.org', '', null, undefined, 42]) {
        assert.equal(isAddress(s), false, JSON.stringify(s));
    }
    assert.equal(isAddress('x'.repeat(242) + '@example.org'), true, '254 characters');
    assert.equal(isAddress('x'.repeat(243) + '@example.org'), false, '255 characters');

    assert.equal(addressOf('Paceline <paceline@example.org>'), 'paceline@example.org');
    assert.equal(addressOf('paceline@example.org'), 'paceline@example.org');
    assert.equal(addressOf('  paceline@example.org '), 'paceline@example.org');
});


test('starttls with AUTH PLAIN, dot-stuffing', needsCert, async () => {
    const fake = await startFakeSmtp({mode: 'starttls'});
    try {
        const data = msg({text: 'Line one\n.hidden\n..two dots\n.\nend\n'});
        const r = await sendMail({host: 'localhost', port: fake.port, secure: 'starttls', ...login},
            {...envelope, data}, opts());
        assert.deepEqual(r, {code: 250});
        assert.equal(fake.received.length, 1);
        const got = fake.received[0];
        assert.equal(got.auth, 'PLAIN');
        assert.equal(got.user, 'u');
        assert.equal(got.pass, 'p');
        assert.equal(got.from, 'paceline@example.org');
        assert.equal(got.to, 'captain@example.org');
        assert.equal(got.text, data);
        assert.ok(got.text.includes('\r\n.hidden\r\n'));
        assert.ok(got.text.includes('\r\n..two dots\r\n.\r\nend\r\n'));
        assert.deepEqual(fake.commands.slice(0, 4), ['EHLO', 'STARTTLS', 'EHLO', 'AUTH']);
        assert.equal(fake.ehlo, 'ttt-beta.example.org');
    } finally {
        await fake.close();
    }
});


test('only LOGIN offered → LOGIN', needsCert, async () => {
    const fake = await startFakeSmtp({mode: 'starttls', auth: ['LOGIN']});
    try {
        const r = await sendMail({host: 'localhost', port: fake.port, secure: 'starttls', ...login}, envelope, opts());
        assert.deepEqual(r, {code: 250});
        assert.equal(fake.received[0].auth, 'LOGIN');
        assert.equal(fake.received[0].user, 'u');
        assert.equal(fake.received[0].pass, 'p');
    } finally {
        await fake.close();
    }
});


test('no AUTH without a user; a user without PLAIN or LOGIN offered → reply error before MAIL FROM', needsCert, async () => {
    const fake = await startFakeSmtp({mode: 'starttls', auth: []});
    try {
        const r = await sendMail({host: 'localhost', port: fake.port, secure: 'starttls', user: null, pass: null},
            envelope, opts());
        assert.deepEqual(r, {code: 250});
        assert.equal(fake.received[0].auth, null);

        await assert.rejects(
            sendMail({host: 'localhost', port: fake.port, secure: 'starttls', ...login}, envelope, opts()),
            (err) => err instanceof MailError && err.kind === 'reply' && err.code === null);
        assert.equal(fake.received.length, 1);
        assert.equal(fake.commands.filter((c) => c === 'MAIL').length, 1, 'no second MAIL FROM');
    } finally {
        await fake.close();
    }
});


test('implicit tls on its own port', needsCert, async () => {
    const fake = await startFakeSmtp({mode: 'tls'});
    try {
        const r = await sendMail({host: 'localhost', port: fake.port, secure: 'tls', ...login}, envelope, opts());
        assert.deepEqual(r, {code: 250});
        assert.equal(fake.received[0].auth, 'PLAIN');
        assert.equal(fake.received[0].text, envelope.data);
        assert.equal(fake.commands.includes('STARTTLS'), false);
    } finally {
        await fake.close();
    }
});


test('starttls is required', async () => {
    const fake = await startFakeSmtp({mode: 'plain'});
    try {
        await assert.rejects(
            sendMail({host: 'localhost', port: fake.port, secure: 'starttls', ...login}, envelope, opts()),
            (err) => err instanceof MailError && err.kind === 'tls' && err.code === null);
        assert.equal(fake.received.length, 0);
        assert.deepEqual(fake.commands, ['EHLO'], 'nothing after EHLO: no AUTH, no MAIL FROM');
    } finally {
        await fake.close();
    }
});


test('the certificate is checked', needsCert, async (t) => {
    // No SNI for an IP host: node would warn (DEP0123), the identity is checked all the same.
    const warnings = [];
    const onWarning = (w) => warnings.push(w.code ?? w.name);
    process.on('warning', onWarning);
    t.after(() => process.off('warning', onWarning));
    for (const mode of ['starttls', 'tls']) {
        const fake = await startFakeSmtp({mode});
        try {
            await assert.rejects(
                sendMail({host: '127.0.0.1', port: fake.port, secure: mode, ...login}, envelope, opts()),
                (err) => err instanceof MailError && err.kind === 'tls', mode);
            // an unknown issuer fails too
            await assert.rejects(
                sendMail({host: 'localhost', port: fake.port, secure: mode, ...login}, envelope, opts({tls: {}})),
                (err) => err instanceof MailError && err.kind === 'tls', mode + ', no ca');
            assert.equal(fake.received.length, 0);
            assert.equal(fake.commands.includes('AUTH'), false);
        } finally {
            await fake.close();
        }
    }
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(warnings, []);
});


test('5xx reply', needsCert, async () => {
    const fake = await startFakeSmtp({mode: 'starttls', reply: {RCPT: 550}});
    try {
        await assert.rejects(
            sendMail({host: 'localhost', port: fake.port, secure: 'starttls', ...login}, envelope, opts()),
            (err) => err instanceof MailError && err.kind === 'reply' && err.code === 550
                && !err.message.includes('example.org'));
        assert.equal(fake.received.length, 0);
    } finally {
        await fake.close();
    }
});


test('bad addresses are refused before connecting', async () => {
    const fake = await startFakeSmtp({mode: 'plain'});
    try {
        for (const e of [{to: 'captain@example.org\r\nRCPT TO:<x@example.org>'}, {from: 'nobody'}]) {
            await assert.rejects(
                sendMail({host: 'localhost', port: fake.port, secure: 'starttls', ...login}, {...envelope, ...e}, opts()),
                (err) => err instanceof MailError && err.kind === 'address');
        }
        await assert.rejects(
            sendMail({host: 'localhost', port: fake.port, secure: 'starttls', ...login}, envelope,
                opts({ehlo: 'x\r\nMAIL FROM:<a@example.org>'})),
            (err) => err instanceof MailError && err.kind === 'header');
        assert.equal(fake.connections, 0);
    } finally {
        await fake.close();
    }
});


test('network and timeout errors are caught', {timeout: 10000}, async (t) => {
    await t.test('silent server → timeout', async () => {
        await noUncaught(async () => {
            const fake = await startFakeSmtp({mode: 'plain', silent: true});
            try {
                const t0 = Date.now();
                await assert.rejects(
                    sendMail({host: 'localhost', port: fake.port, secure: 'starttls', ...login}, envelope,
                        opts({timeoutMs: 200})),
                    (err) => err instanceof MailError && err.kind === 'timeout' && err.code === null);
                assert.ok(Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
            } finally {
                await fake.close();
            }
        });
    });

    await t.test('connection dropped after DATA → network', needsCert, async () => {
        await noUncaught(async () => {
            const fake = await startFakeSmtp({mode: 'starttls', dropAfter: 'DATA'});
            try {
                await assert.rejects(
                    sendMail({host: 'localhost', port: fake.port, secure: 'starttls', ...login}, envelope, opts()),
                    (err) => err instanceof MailError && err.kind === 'network' && err.code === null);
                assert.equal(fake.received.length, 0);
            } finally {
                await fake.close();
            }
        });
    });

    await t.test('the server closes while a reply is awaited → network, not timeout', async () => {
        await noUncaught(async () => {
            const server = net.createServer((socket) => socket.end());
            await new Promise((r) => server.listen(0, '127.0.0.1', r));
            try {
                const t0 = Date.now();
                await assert.rejects(
                    sendMail({host: 'localhost', port: server.address().port, secure: 'starttls', ...login}, envelope,
                        opts({timeoutMs: 5000})),
                    (err) => err instanceof MailError && err.kind === 'network');
                assert.ok(Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
            } finally {
                await new Promise((r) => server.close(r));
            }
        });
    });

    await t.test('nothing listening → network', async () => {
        await noUncaught(async () => {
            const fake = await startFakeSmtp({mode: 'plain'});
            const port = fake.port;
            await fake.close();
            await assert.rejects(
                sendMail({host: 'localhost', port, secure: 'starttls', ...login}, envelope, opts()),
                (err) => err instanceof MailError && err.kind === 'network');
        });
    });
});
