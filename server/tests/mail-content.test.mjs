// Run with: node --test server/tests/mail-content.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readConfig} from '../config.mjs';
import {buildMessage, quotedPrintable} from '../mail.mjs';
import {makeMailer} from '../mailer.mjs';
import {mailContent, mailHtml, ownLink, paletteOf} from '../mail-content.mjs';
import {APP_CSS} from '../app-css.mjs';

const NOW = Date.parse('2026-11-19T18:30:05Z');
const PUBLIC = 'https://ttt-beta.example.org';
const cfg = {publicUrl: PUBLIC, privacyContact: null};
const VARS = {
    club: 'Kettenfett RC', link: `${PUBLIC}/m/LINKTOKEN`, lost: `${PUBLIC}/lost`,
    email: 'new@example.org', masked: 'n…@example.org',
};

// The texts as the server sent them before the HTML part (91e0ff4), byte for byte.
const BEFORE = {
    'new-link': 'Here is a new link for Kettenfett RC:\n\nhttps://ttt-beta.example.org/m/LINKTOKEN\n\nOpen it within 24 hours; opening it ends the old link. From then on it is your club\'s link for good: bookmark it or keep this mail, and use it on every device you manage the club from.\n',
    'confirm-club': 'Open this link and press the button to start Kettenfett RC on Paceline:\n\nhttps://ttt-beta.example.org/m/LINKTOKEN\n\nOpen it within 24 hours. From then on it is your club\'s link for good: bookmark it or keep this mail, and use it on every device you manage the club from. Share it only with your plan makers: anyone with it can change your club\'s plans.\n\nNot you? Ignore this mail; nothing is kept after 24 hours.\n',
    'confirm-email': 'Someone with the club link asked to change the address of Kettenfett RC on Paceline to new@example.org. To allow it, open this link and press the button:\n\nhttps://ttt-beta.example.org/m/LINKTOKEN\n\nIt works for 24 hours. The new address then confirms itself.\n\nNot you? Ignore this mail and nothing changes. Someone else has your club link then: get a new one at https://ttt-beta.example.org/lost; opening it ends the old link.\n',
    'new-address': 'This address is to become the address of Kettenfett RC on Paceline. To confirm it, open this link and press the button:\n\nhttps://ttt-beta.example.org/m/LINKTOKEN\n\nIt works for 24 hours. Club links then go to this address.\n\nNot you? Ignore this mail; the address is not changed.\n',
    'confirm-delete': 'Someone with the club link asked to delete Kettenfett RC on Paceline. To delete it, open this link and press the button:\n\nhttps://ttt-beta.example.org/m/LINKTOKEN\n\nIt works for 24 hours. Riders get no more plans from Kettenfett RC at once; the operator can restore it within 7 days.\n\nNot you? Ignore this mail and nothing is deleted. Someone else has your club link then: get a new one at https://ttt-beta.example.org/lost; opening it ends the old link.\n',
    'address-changed': 'The address of Kettenfett RC on Paceline is now n…@example.org. Club links go there from now on.\n\nNot you? See https://ttt-beta.example.org/privacy.\n',
};
const BEFORE_CONTACT = 'The address of Kettenfett RC on Paceline is now n…@example.org. Club links go there from now on.\n\nNot you? Contact operator@example.org.\n';
const SUBJECTS = {
    'new-link': 'Paceline: new link for Kettenfett RC',
    'confirm-club': 'Paceline: confirm your club Kettenfett RC',
    'confirm-email': 'Paceline: confirm: change the address of Kettenfett RC',
    'new-address': 'Paceline: confirm the new address for Kettenfett RC',
    'confirm-delete': 'Paceline: confirm: delete Kettenfett RC',
    'address-changed': 'Paceline: the address of Kettenfett RC was changed',
};
const WITH_LINK = ['new-link', 'confirm-club', 'confirm-email', 'new-address', 'confirm-delete'];

const message = (content, over = {}) => buildMessage({
    from: 'Paceline <paceline@example.org>', to: 'captain@example.org',
    subject: content.subject, text: content.text, html: content.html,
    now: NOW, host: 'ttt-beta.example.org', ...over,
});
const headersOf = (m) => m.slice(0, m.indexOf('\r\n\r\n')).split('\r\n');
const bodyOf = (m) => m.slice(m.indexOf('\r\n\r\n') + 4);

// The parts of a multipart message: [{headers, body}], body as sent (still encoded).
function partsOf(m) {
    const type = headersOf(m).find(h => h.startsWith('Content-Type: '));
    const boundary = type.match(/^Content-Type: multipart\/alternative; boundary="([^"]+)"$/)?.[1];
    assert.ok(boundary, type);
    const body = bodyOf(m);
    const open = `--${boundary}\r\n`;
    const close = `\r\n--${boundary}--\r\n`;
    assert.ok(body.startsWith(open), 'the body starts with the first delimiter');
    assert.ok(body.endsWith(close), 'the body ends with the close delimiter');
    return body.slice(open.length, -close.length).split(`\r\n--${boundary}\r\n`).map(p => ({
        headers: p.slice(0, p.indexOf('\r\n\r\n')).split('\r\n'),
        body: p.slice(p.indexOf('\r\n\r\n') + 4),
    }));
}

function unQuotedPrintable(s) {
    const flat = s.replace(/=\r\n/g, '');
    const bytes = [];
    for (let i = 0; i < flat.length; i++) {
        if (flat[i] === '=') {
            assert.match(flat.slice(i + 1, i + 3), /^[0-9A-F]{2}$/);
            bytes.push(parseInt(flat.slice(i + 1, i + 3), 16));
            i += 2;
        } else {
            bytes.push(flat.charCodeAt(i));
        }
    }
    return Buffer.from(bytes).toString('utf8');
}

const decode = (part) => {
    const enc = part.headers.find(h => h.startsWith('Content-Transfer-Encoding: ')).slice(27);
    return enc === 'base64' ? Buffer.from(part.body.replace(/\r\n/g, ''), 'base64').toString('utf8')
        : enc === 'quoted-printable' ? unQuotedPrintable(part.body) : part.body;
};
const crlf = (s) => s.replace(/\n/g, '\r\n');


test('mailContent: subject and text are what the server sent before, byte for byte', () => {
    for (const kind of Object.keys(BEFORE)) {
        const c = mailContent(kind, VARS, cfg);
        assert.equal(c.text, BEFORE[kind], kind);
        assert.equal(c.subject, SUBJECTS[kind], kind);
    }
    const contact = mailContent('address-changed', VARS, {...cfg, privacyContact: 'operator@example.org'});
    assert.equal(contact.text, BEFORE_CONTACT);
    assert.throws(() => mailContent('nope', VARS, cfg), /Unknown mail/);
});


test('buildMessage with html: multipart/alternative, the text part first and as before, then the HTML', () => {
    for (const kind of Object.keys(BEFORE)) {
        const c = mailContent(kind, VARS, cfg);
        const m = message(c);
        const plainOnly = message({...c, html: null});
        const parts = partsOf(m);
        assert.equal(parts.length, 2, kind);
        const [text, html] = parts;
        assert.deepEqual(text.headers, headersOf(plainOnly).slice(6), `${kind}: text part headers as the plain mail's`);
        assert.equal(text.body, bodyOf(plainOnly), `${kind}: the text part is the plain mail's body, byte for byte`);
        assert.equal(decode(text), crlf(BEFORE[kind]), kind);
        assert.deepEqual(html.headers, ['Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable']);
        assert.equal(decode(html), crlf(c.html), `${kind}: the HTML part decodes to the HTML`);
    }
});


test('buildMessage with html: the headers are the plain mail\'s but for the Content-Type', () => {
    const c = mailContent('confirm-club', {...VARS, club: 'Rädle RC'}, cfg);
    const m = message(c);
    const plain = message({...c, html: null});
    const h = headersOf(m);
    assert.deepEqual(h.map(l => l.slice(0, l.indexOf(':'))).filter(n => n !== ''),
        ['From', 'To', 'Subject', 'Date', 'Message-ID', 'MIME-Version', 'Content-Type']);
    // the encoded subject is folded the same way; the Message-ID is new per mail
    const strip = (lines) => lines.filter(l => !l.startsWith('Message-ID: ') && !l.startsWith('Content-'));
    assert.deepEqual(strip(h), strip(headersOf(plain)));
    assert.equal(h[0], 'From: Paceline <paceline@example.org>');
    assert.equal(h[1], 'To: captain@example.org');
    assert.match(h[2], /^Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    assert.equal(h[3], 'Date: Thu, 19 Nov 2026 18:30:05 +0000');
    assert.match(h[4], /^Message-ID: <[0-9a-f]{32}@ttt-beta\.example\.org>$/);
    assert.equal(h[5], 'MIME-Version: 1.0');
    assert.match(h[6], /^Content-Type: multipart\/alternative; boundary="=_[0-9a-f]{32}"$/);
    assert.notEqual(h[6], headersOf(message(c))[6], 'a new boundary per mail');
});


test('buildMessage with html: CRLF only, every line at most 998 (the HTML at most 76)', () => {
    const long = {...VARS, club: `Kettenfett ${'Rädle '.repeat(9)}RC`, link: `${PUBLIC}/m/${'x'.repeat(300)}`};
    for (const kind of Object.keys(BEFORE)) {
        const m = message(mailContent(kind, long, cfg));
        assert.match(m, /\r\n$/);
        assert.equal(m.replace(/\r\n/g, '').includes('\n'), false, 'no bare LF');
        assert.equal(m.replace(/\r\n/g, '').includes('\r'), false, 'no bare CR');
        for (const line of m.split('\r\n')) {
            assert.ok(line.length <= 998, `${kind}: ${line.length}`);
        }
        for (const line of partsOf(m)[1].body.split('\r\n')) {
            assert.ok(line.length <= 76, `${kind}: html line ${line.length}`);
            assert.doesNotMatch(line, /[^\x20-\x7e]/, 'printable ASCII only');
            assert.doesNotMatch(line, /^\./, 'no dot at a line start');
        }
    }
});


test('quotedPrintable: round trip of UTF-8, long lines, dots, trailing blanks and =', () => {
    const s = `.dot\nä ö ü – 🚴 ${'a'.repeat(200)}\ntrailing \ntab\t\n= sign=3D\n\n${'.'.repeat(80)}\n`;
    const qp = quotedPrintable(s);
    for (const line of qp.split('\r\n')) {
        assert.ok(line.length <= 76, line);
        assert.doesNotMatch(line, /[ \t]$/, 'no blank at a line end');
        assert.doesNotMatch(line, /^\./);
    }
    assert.equal(unQuotedPrintable(qp), crlf(s));
});


test('the HTML: club name as the heading, the link as a button and as text, footer pieces', () => {
    for (const kind of WITH_LINK) {
        const {html} = mailContent(kind, VARS, cfg);
        assert.match(html, /^<!doctype html>\n<html lang="en"/);
        assert.match(html, /<h1 [^>]*>Kettenfett RC<\/h1>/, kind);
        const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map(m => m[1]);
        assert.ok(hrefs.filter(h => h === VARS.link).length >= 2, `${kind}: the link as button and as text`);
        assert.ok(html.includes(`>${VARS.link}</a>`), `${kind}: the link as text`);
        assert.match(html, /<table role="presentation"[^>]*>\s*<tr><td class="pl-btn" align="center" bgcolor="#1b5fc1"/);
        assert.ok(html.includes('Or copy this link into your browser:'));
        assert.match(html, /Open it within 24 hours|It works for 24 hours\./, kind);
        assert.match(html, />Paceline</);
    }
    const ce = mailContent('confirm-email', VARS, cfg).html;
    assert.ok(ce.includes(`>Review the change</a>`));
    assert.ok(ce.includes(`<a href="${PUBLIC}/lost" class="pl-link"`), 'the lost page as a link');
    assert.ok(ce.includes('to new@example.org.'), 'the new address in full');

    const ac = mailContent('address-changed', VARS, cfg).html;
    assert.doesNotMatch(ac, /class="pl-btn"|Or copy this link/, 'no link, no button');
    assert.ok(ac.includes('<span style="white-space:nowrap;">n…@example.org</span>'), 'the masked address on one line');
    assert.ok(ac.includes(`Not you? See <a href="${PUBLIC}/privacy"`));
    const acContact = mailContent('address-changed', VARS, {...cfg, privacyContact: 'operator@example.org'}).html;
    assert.ok(acContact.includes('Not you? Contact operator@example.org.'));
});


test('the HTML: every value escaped (a club name with <script> and quotes)', () => {
    const evil = '<script>alert("x")</script> \'RC\' & Co';
    for (const kind of Object.keys(BEFORE)) {
        const {html, text} = mailContent(kind, {...VARS, club: evil, email: 'a"b@example.org'}, cfg);
        assert.ok(text.includes(evil), 'the text part keeps the raw name');
        assert.doesNotMatch(html, /<script|alert\("x"\)|'RC'|a"b@/, kind);
        assert.ok(html.includes('<h1 ') && html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &#39;RC&#39; &amp; Co</h1>'), kind);
        assert.ok(html.includes('<title>Paceline: '), kind);
        assert.doesNotMatch(html.match(/<title>.*<\/title>/)[0], /<script/);
    }
});


test('the HTML: links only to PUBLIC_URL over http(s), nothing from elsewhere', () => {
    assert.equal(ownLink(`${PUBLIC}/m/x`, PUBLIC), `${PUBLIC}/m/x`);
    assert.equal(ownLink('https://evil.example.org/m/x', PUBLIC), null);
    assert.equal(ownLink(`${PUBLIC}.evil.example/m/x`, PUBLIC), null);
    assert.equal(ownLink('javascript:alert(1)', PUBLIC), null);
    assert.equal(ownLink(`${PUBLIC}/m/"x`, PUBLIC), null, 'not as the URL parser writes it');
    assert.equal(ownLink(`${PUBLIC}/m/x`, null), null);
    assert.equal(ownLink('https://ex.org/sub/m/x', 'https://ex.org/sub'), 'https://ex.org/sub/m/x');
    assert.equal(ownLink('https://ex.org/m/x', 'https://ex.org/sub'), null, 'under the path of PUBLIC_URL');

    for (const link of ['javascript:alert(1)', 'https://evil.example.org/m/x']) {
        const {html, text} = mailContent('new-link', {...VARS, link}, cfg);
        assert.ok(text.includes(link));
        assert.doesNotMatch(html, /class="pl-btn"/, 'no button for a foreign link');
        assert.doesNotMatch(html, /href="(?!https:\/\/ttt-beta\.example\.org\/)/);
        assert.ok(html.includes(`>${link}</p>`), 'shown as text only');
    }
    for (const kind of Object.keys(BEFORE)) {
        const {html} = mailContent(kind, VARS, cfg);
        for (const [, href] of html.matchAll(/href="([^"]*)"/g)) {
            assert.ok(href.startsWith(`${PUBLIC}/`), href);
        }
        assert.doesNotMatch(html, /\bsrc=|url\(|@import|<img|<link|<script|https?:\/\/(?!ttt-beta\.example\.org\/)/i, kind);
    }
});


test('the palette comes from app.css, light inline and dark in the media block', () => {
    const p = paletteOf(APP_CSS);
    assert.equal(p.light.accent, '#1b5fc1');
    assert.equal(p.dark.accent, '#7fb0ff');
    assert.equal(p.light.bg, '#f3f4f7');
    assert.equal(p.dark['accent-ink'], '#0b1526');
    assert.doesNotMatch(p.font, /"/, 'no double quote in a style attribute');
    assert.throws(() => paletteOf(':root{color-scheme:light dark;--bg:#fff}'), /no --/);
    const {html} = mailContent('new-link', VARS, cfg);
    assert.ok(html.includes(`background:${p.light.bg};`));
    assert.ok(html.includes(`color:${p.light['accent-ink']};`));
    assert.match(html, /@media \(prefers-color-scheme:dark\)\{[^}]*\.pl-bg\{background:#0e1116!important\}/);
    assert.ok(html.includes(`font-family:${p.font};`));
    assert.equal(mailHtml({title: 't', heading: 'h', lead: 'l', link: null, linkText: null, button: null, footer: []})
        .includes('class="pl-btn"'), false);
});


test('the mail queue sends text and HTML as multipart/alternative through the transport', async () => {
    const calls = [];
    const transport = (smtp, envelope) => {
        calls.push(envelope);
        return Promise.resolve({code: 250});
    };
    const config = readConfig({
        DATA_DIR: '/tmp/paceline-mail-content-test', SMTP_HOST: 'smtp.example.org',
        MAIL_FROM: 'Paceline <paceline@example.org>', PUBLIC_URL: PUBLIC,
    });
    const mailer = makeMailer({cfg: config, now: () => NOW, transport, schedule: () => 0});
    const c = mailContent('confirm-club', VARS, config);
    assert.equal(mailer.send({kind: 'confirm-club', to: 'captain@example.org', budget: 'new', ...c}), true);
    assert.equal(mailer.send({kind: 'new-link', to: 'captain@example.org', budget: 'other', subject: 's', text: 'plain\n'}), true);
    for (let i = 0; i < 10; i++) {
        await new Promise(r => setImmediate(r));
    }
    assert.equal(calls.length, 2);
    const [text, html] = partsOf(calls[0].data);
    assert.equal(decode(text), crlf(BEFORE['confirm-club']));
    assert.equal(decode(html), crlf(c.html));
    assert.match(calls[1].data, /^Content-Type: text\/plain; charset=utf-8$/m, 'without html: plain text as before');
    mailer.close();
});
