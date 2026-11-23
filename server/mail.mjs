// Outgoing mail (spec §11): the message builder and a small SMTP client for the operator's own
// server. STARTTLS (required) or implicit TLS, the certificate checked for SMTP_HOST, AUTH PLAIN
// (LOGIN if only that). Failures come back as a rejected Promise of a MailError, which carries a
// kind and an SMTP code only: never server text, addresses, credentials or message content.
import crypto from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';


// kind: 'network' | 'timeout' | 'tls' | 'reply' | 'header' | 'address'; code: an SMTP reply code or null.
export class MailError extends Error {
    constructor(kind, code = null) {
        super(code === null ? `mail ${kind}` : `mail ${kind} ${code}`);
        this.name = 'MailError';
        this.kind = kind;
        this.code = code;
    }
}


// A syntax check only (spec §5): at most 254 characters, one @, a dot in the domain. Printable
// ASCII without spaces and the characters that end an address in SMTP or a header; the client
// does not speak SMTPUTF8.
const ADDRESS_RE = /^[!#-'*+\-/-9=?A-Z^-~]+(?:\.[!#-'*+\-/-9=?A-Z^-~]+)*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

export function isAddress(s) {
    return typeof s === 'string' && s.length <= 254 && ADDRESS_RE.test(s);
}


// The bare address of a MAIL_FROM value: 'Paceline <paceline@example.org>' → 'paceline@example.org'.
export function addressOf(mailFrom) {
    const s = String(mailFrom).trim();
    const m = s.match(/<([^<>]*)>$/);
    return m ? m[1].trim() : s;
}


// Header values never hold CR, LF or other control characters (no header injection).
function headerValue(v) {
    if (typeof v !== 'string' || /\p{Cc}/u.test(v)) {
        throw new MailError('header');
    }
    return v;
}

const isAscii = (s) => /^[\x00-\x7f]*$/.test(s);

// RFC 2047 for a non-ASCII subject: base64 encoded words of at most 75 characters, split between
// characters and folded onto continuation lines.
function encodeSubject(subject) {
    if (isAscii(subject)) {
        return subject;
    }
    const words = [];
    let chunk = '';
    for (const ch of subject) {
        if (Buffer.byteLength(chunk + ch) > 45) {   // 45 bytes → 60 base64 characters + 12
            words.push(chunk);
            chunk = '';
        }
        chunk += ch;
    }
    words.push(chunk);
    return words.map((w) => `=?UTF-8?B?${Buffer.from(w).toString('base64')}?=`).join('\r\n ');
}

// RFC 5322 date in UTC: 'Thu, 19 Nov 2026 18:30:05 +0000'.
function mailDate(ms) {
    return new Date(ms).toUTCString().replace(/GMT$/, '+0000');
}

const crlf = (s) => s.replace(/\r\n|\r|\n/g, '\r\n');


// The plain text with CRLF line ends and a final CRLF: 7bit when it is ASCII with lines of at most
// 998 characters, else base64 in lines of 76.
function textBody(text) {
    let body = crlf(String(text));
    if (!body.endsWith('\r\n')) {
        body += '\r\n';
    }
    const sevenBit = isAscii(body) && body.split('\r\n').every((l) => l.length <= 998);
    if (!sevenBit) {
        body = Buffer.from(body).toString('base64').match(/.{1,76}/g).join('\r\n') + '\r\n';
    }
    return {body, encoding: sevenBit ? '7bit' : 'base64'};
}

// Quoted-printable (RFC 2045 §6.7) of UTF-8 text: CRLF line ends, encoded lines of at most 76
// characters (soft breaks), '=' and everything outside printable ASCII encoded, and so are a space
// or tab at a line end and a dot at a line start. Ends in CRLF.
export function quotedPrintable(s) {
    const hex = (b) => '=' + b.toString(16).toUpperCase().padStart(2, '0');
    const lines = crlf(String(s)).replace(/\r\n$/, '').split('\r\n');
    const out = [];
    for (const line of lines) {
        const bytes = Buffer.from(line, 'utf8');
        let cur = '';
        bytes.forEach((b, i) => {
            const last = i === bytes.length - 1;
            const plain = (b >= 33 && b <= 126 && b !== 61 && !(b === 46 && cur === ''))
                || ((b === 32 || b === 9) && !last);
            const tok = plain ? String.fromCharCode(b) : hex(b);
            if (cur.length + tok.length > 75) {
                out.push(cur + '=');
                cur = '';
            }
            // a dot that a soft break moved to the line start
            cur += tok === '.' && cur === '' ? hex(b) : tok;
        });
        out.push(cur);
    }
    return out.join('\r\n') + '\r\n';
}

// A message with CRLF line ends: plain text, or with `html` multipart/alternative of the text
// (first, encoded as above) and the HTML (quoted-printable). Same headers either way, but for the
// Content-Type (and the transfer encoding, which multipart leaves to its parts).
export function buildMessage({from, to, subject, text, html = null, now, host}) {
    for (const v of [from, to, subject, host]) {
        headerValue(v);
    }
    const plain = textBody(text);
    const headers = [
        `From: ${from}`,
        `To: ${to}`,
        `Subject: ${encodeSubject(subject)}`,
        `Date: ${mailDate(now)}`,
        `Message-ID: <${crypto.randomBytes(16).toString('hex')}@${host}>`,
        'MIME-Version: 1.0',
    ];
    if (html === null) {
        headers.push('Content-Type: text/plain; charset=utf-8', `Content-Transfer-Encoding: ${plain.encoding}`);
        return headers.join('\r\n') + '\r\n\r\n' + plain.body;
    }
    // '=_' never occurs in base64 or quoted-printable; the 7bit text is checked.
    let boundary;
    do {
        boundary = `=_${crypto.randomBytes(16).toString('hex')}`;
    } while (plain.body.includes(boundary));
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    // The CRLF before a delimiter belongs to the delimiter, so each part keeps its final CRLF.
    return headers.join('\r\n') + '\r\n\r\n'
        + `--${boundary}\r\n`
        + `Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: ${plain.encoding}\r\n\r\n`
        + plain.body
        + `\r\n--${boundary}\r\n`
        + 'Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n'
        + quotedPrintable(html)
        + `\r\n--${boundary}--\r\n`;
}


// One SMTP connection: reads multi-line replies, one step at a time with its own deadline. The
// first failure (socket error, close, timeout, bad reply) is kept, every socket is destroyed, and
// each later step rejects with it.
const REPLY_MAX = 64 * 1024;

class Conversation {
    #sockets = [];
    #socket = null;
    #buf = '';
    #waiter = null;       // the running step: {reject, timer}
    #ready = null;        // resolves the running reply() with a complete reply
    #failure = null;
    #handshaking = false;
    #timeoutMs;

    constructor(timeoutMs) {
        this.#timeoutMs = timeoutMs;
    }

    // Takes `socket` as the one to talk on. `handshaking`: a TLS handshake runs first.
    #use(socket, handshaking) {
        this.#socket = socket;
        this.#sockets.push(socket);
        this.#handshaking = handshaking;
        socket.on('error', (err) => this.#onError(socket, err));
        socket.on('data', (chunk) => this.#onData(socket, chunk));
        socket.on('close', () => this.#onGone(socket));
        socket.on('end', () => this.#onGone(socket));
    }

    // Opens the connection: plain TCP, or TLS on its own port. Resolves with the greeting.
    connect({host, port, secure}, tlsOptions) {
        if (secure === 'tls') {
            const socket = tls.connect({...tlsOptions, ...serverOptions(host), port});
            this.#use(socket, true);
            socket.once('secureConnect', () => { this.#handshaking = false; });
        } else {
            this.#use(net.connect({host, port}), false);
        }
        return this.reply();
    }

    // STARTTLS: the same TCP connection, now in TLS. Resolves when the handshake is done.
    upgrade(host, tlsOptions) {
        if (this.#failure) {
            return Promise.reject(this.#failure);
        }
        if (this.#buf !== '') {
            // Bytes sent before the handshake must not be read as answers after it.
            this.fail(new MailError('tls'));
            return Promise.reject(this.#failure);
        }
        const plain = this.#socket;
        plain.removeAllListeners('data');
        plain.removeAllListeners('close');
        plain.removeAllListeners('end');
        const socket = tls.connect({...tlsOptions, ...serverOptions(host), socket: plain});
        this.#use(socket, true);
        return this.#wait((done) => socket.once('secureConnect', () => {
            this.#handshaking = false;
            done();
        }));
    }

    // Sends one command (or the message data) and resolves with the reply `{code, lines}`.
    command(line) {
        if (this.#failure) {
            return Promise.reject(this.#failure);
        }
        this.#socket.write(line + '\r\n');
        return this.reply();
    }

    reply() {
        return this.#wait((done) => {
            this.#ready = done;
            this.#drain();
        });
    }

    // Runs `start(done)` under the step deadline. done(value) resolves; a failure rejects.
    #wait(start) {
        if (this.#failure) {
            return Promise.reject(this.#failure);
        }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => this.fail(new MailError('timeout')), this.#timeoutMs);
            timer.unref();
            this.#waiter = {reject, timer};
            start((value) => {
                if (this.#waiter?.timer === timer) {
                    clearTimeout(timer);
                    this.#waiter = null;
                    this.#ready = null;
                    resolve(value);
                }
            });
        });
    }

    // Hands a complete reply to the waiting step, if there is one.
    #drain() {
        if (!this.#ready) {
            return;
        }
        let reply;
        try {
            reply = this.#take();
        } catch (err) {
            this.fail(err);
            return;
        }
        if (reply) {
            this.#ready(reply);
        }
    }

    // One complete reply from the start of the buffer, or null while it is incomplete. Multi-line
    // replies continue with 'NNN-' and end with 'NNN ' (or a bare 'NNN').
    #take() {
        const lines = [];
        let pos = 0;
        for (;;) {
            const end = this.#buf.indexOf('\n', pos);
            if (end < 0) {
                return null;
            }
            const line = this.#buf.slice(pos, end).replace(/\r$/, '');
            pos = end + 1;
            const m = line.match(/^([2-5]\d\d)([ -]|$)/);
            if (!m) {
                throw new MailError('reply');
            }
            lines.push(line.slice(4));
            if (m[2] !== '-') {
                this.#buf = this.#buf.slice(pos);
                return {code: Number(m[1]), lines};
            }
        }
    }

    #onData(socket, chunk) {
        if (socket !== this.#socket) {
            return;
        }
        this.#buf += chunk.toString('latin1');
        if (this.#buf.length > REPLY_MAX) {
            this.fail(new MailError('reply'));
            return;
        }
        this.#drain();
    }

    #onError(socket, err) {
        const handshake = socket === this.#socket && this.#handshaking;
        // A handshake that fails without a socket-level cause is a TLS failure (certificate, protocol).
        const tlsFailure = handshake && !err?.syscall && err?.code !== 'ECONNRESET';
        this.fail(new MailError(tlsFailure ? 'tls' : 'network'));
    }

    #onGone(socket) {
        if (socket === this.#socket) {
            this.fail(new MailError('network'));
        }
    }

    // Keeps the first failure, ends the waiting step with it, and destroys every socket.
    fail(err) {
        this.#failure ??= err;
        const waiter = this.#waiter;
        this.#waiter = null;
        this.#ready = null;
        if (waiter) {
            clearTimeout(waiter.timer);
            waiter.reject(this.#failure);
        }
        this.destroy();
    }

    // QUIT after a sent mail: its answer and its errors don't matter.
    quit() {
        if (this.#failure) {
            return;
        }
        this.command('QUIT').catch(() => {}).finally(() => this.destroy());
    }

    destroy() {
        for (const s of this.#sockets) {
            s.destroy();
        }
    }
}

// host for the identity check; SNI only for a name (node warns on an IP servername, DEP0123).
function serverOptions(host) {
    return net.isIP(host) ? {host} : {host, servername: host};
}

// The reply must be in the class `want` (2 or 3), else MailError('reply', code).
function expect(reply, want) {
    if (Math.floor(reply.code / 100) !== want) {
        throw new MailError('reply', reply.code);
    }
    return reply;
}

// The AUTH mechanisms in an EHLO reply ('AUTH PLAIN LOGIN', or the old 'AUTH=PLAIN LOGIN').
function authMechanisms(ehloReply) {
    for (const line of ehloReply.lines.slice(1)) {
        const m = line.match(/^AUTH[ =](.*)$/i);
        if (m) {
            return new Set(m[1].trim().toUpperCase().split(/\s+/));
        }
    }
    return new Set();
}

const offers = (ehloReply, keyword) =>
    ehloReply.lines.slice(1).some((l) => l.trim().toUpperCase().split(/\s+/)[0] === keyword);

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

// CRLF line ends, a final CRLF, and a dot doubled at the start of every line.
function stuff(data) {
    let s = crlf(String(data));
    if (!s.endsWith('\r\n')) {
        s += '\r\n';
    }
    return s.replace(/(^|\r\n)\./g, '$1..');
}


// Sends one message (spec §11 steps 1–4). smtp = {host, port, secure: 'starttls' | 'tls', user,
// pass}; `from` and `to` are bare addresses, `data` the message from buildMessage; `ehlo` is the
// PUBLIC_URL host; `tls` is merged into every tls.connect (tests pass {ca}). Resolves with {code}
// of the accepted message; rejects with a MailError only.
export async function sendMail(smtp, {from, to, data}, {ehlo, tls: tlsOptions = {}, timeoutMs = 20000} = {}) {
    if (!isAddress(from) || !isAddress(to)) {
        throw new MailError('address');
    }
    if (typeof ehlo !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(ehlo)) {
        throw new MailError('header');
    }
    const conv = new Conversation(timeoutMs);
    try {
        expect(await conv.connect(smtp, tlsOptions), 2);
        let caps = expect(await conv.command(`EHLO ${ehlo}`), 2);
        if (smtp.secure !== 'tls') {
            // starttls is required: never go on without it.
            if (!offers(caps, 'STARTTLS')) {
                throw new MailError('tls');
            }
            expect(await conv.command('STARTTLS'), 2);
            await conv.upgrade(smtp.host, tlsOptions);
            caps = expect(await conv.command(`EHLO ${ehlo}`), 2);
        }
        if (smtp.user != null) {
            const mechs = authMechanisms(caps);
            const pass = smtp.pass ?? '';
            if (mechs.has('PLAIN')) {
                expect(await conv.command(`AUTH PLAIN ${b64(`\0${smtp.user}\0${pass}`)}`), 2);
            } else if (mechs.has('LOGIN')) {
                expect(await conv.command('AUTH LOGIN'), 3);
                expect(await conv.command(b64(smtp.user)), 3);
                expect(await conv.command(b64(pass)), 2);
            } else {
                // Credentials are set, so never send unauthenticated.
                throw new MailError('reply');
            }
        }
        expect(await conv.command(`MAIL FROM:<${from}>`), 2);
        expect(await conv.command(`RCPT TO:<${to}>`), 2);
        expect(await conv.command('DATA'), 3);
        const done = expect(await conv.command(stuff(data) + '.'), 2);
        conv.quit();
        return {code: done.code};
    } catch (err) {
        const mailError = err instanceof MailError ? err : new MailError('network');
        conv.fail(mailError);
        throw mailError;
    }
}
