// A small SMTP server for the mail tests: STARTTLS, implicit TLS or plain, AUTH PLAIN and LOGIN,
// per-command reply overrides, a silent mode and a dropped connection. Test use only.
//
// startFakeSmtp(options) → Promise of {port, received, commands, ehlo, connections, close()}:
//   received:    [{from, to, auth, user, pass, text}] per accepted mail; text is the message as the
//                client meant it (dots un-stuffed, up to and including the last CRLF before ".").
//   commands:    the command verbs in arrival order (all connections), e.g. ['EHLO', 'STARTTLS', …].
//   ehlo:        the last EHLO argument.
//   connections: how many clients connected.
// Options:
//   mode:      'starttls' (STARTTLS offered, AUTH only after it), 'tls' (implicit TLS), 'plain'.
//   auth:      the AUTH mechanisms offered (after TLS), default ['PLAIN', 'LOGIN']; [] offers none.
//   reply:     a reply code per command verb that replaces the normal answer, e.g. {RCPT: 550};
//              '.' is the answer to the end of the message data.
//   silent:    never send the greeting.
//   dropAfter: a command verb; the connection is closed right after answering it ('DATA': after 354).
import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';

const FIXTURES = new URL('./fixtures/', import.meta.url);
const HOST = 'fake.example.org';

export async function startFakeSmtp({mode, auth = ['PLAIN', 'LOGIN'], reply = {}, silent = false, dropAfter = null} = {}) {
    if (!['starttls', 'tls', 'plain'].includes(mode)) {
        throw new TypeError(`unknown mode ${mode}`);
    }
    const creds = mode === 'plain' ? null : {
        key: fs.readFileSync(new URL('localhost-key.pem', FIXTURES)),
        cert: fs.readFileSync(new URL('localhost-cert.pem', FIXTURES)),
    };
    const state = {received: [], commands: [], ehlo: null, connections: 0};
    const sockets = new Set();

    const onConnection = (socket) => {
        state.connections++;
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.on('error', () => {});
        session(socket, mode === 'tls');
        if (!silent) {
            socket.write(`220 ${HOST} ESMTP fake\r\n`);
        }
    };

    // One client: reads CRLF lines and answers them. `secure` says whether TLS is on.
    function session(socket, secure) {
        let buf = '';
        let mail = null;      // {from, to, auth, user, pass} of the mail being built
        let login = null;     // AUTH LOGIN steps: 'user' | 'pass'
        let authed = {auth: null, user: null, pass: null};
        let lines = null;     // message lines while in DATA

        const send = (verb, code, text) => {
            socket.write(`${reply[verb] ?? code} ${text}\r\n`);
            if (dropAfter === verb) {
                socket.destroy();
            }
        };
        const ok = (verb) => (reply[verb] ?? 250) < 400;

        const onLine = (line) => {
            if (lines) {
                if (line === '.') {
                    const text = lines.map((l) => l + '\r\n').join('');
                    lines = null;
                    if (ok('.')) {
                        state.received.push({...mail, text});
                    }
                    mail = null;
                    send('.', 250, '2.0.0 queued');
                    return;
                }
                lines.push(line.startsWith('.') ? line.slice(1) : line);
                return;
            }
            if (login) {
                const value = Buffer.from(line, 'base64').toString('utf8');
                if (login === 'user') {
                    authed.user = value;
                    login = 'pass';
                    socket.write(`334 ${Buffer.from('Password:').toString('base64')}\r\n`);
                } else {
                    authed.pass = value;
                    authed.auth = 'LOGIN';
                    login = null;
                    send('AUTH', 235, '2.7.0 accepted');
                }
                return;
            }
            const verb = line.split(' ')[0].toUpperCase();
            const arg = line.slice(verb.length + 1);
            state.commands.push(verb);
            if (verb === 'EHLO') {
                state.ehlo = arg;
                const caps = [`250-${HOST}`, '250-8BITMIME'];
                if (mode === 'starttls' && !secure) {
                    caps.push('250-STARTTLS');
                }
                if (secure && auth.length) {
                    caps.push(`250-AUTH ${auth.join(' ')}`);
                }
                caps.push('250 SIZE 1000000');
                if (reply.EHLO) {
                    send('EHLO', 250, 'no');
                } else {
                    socket.write(caps.join('\r\n') + '\r\n');
                }
            } else if (verb === 'STARTTLS' && mode === 'starttls' && !secure) {
                send('STARTTLS', 220, '2.0.0 ready');
                if (!ok('STARTTLS')) {
                    return;
                }
                socket.removeAllListeners('data');
                const secured = new tls.TLSSocket(socket, {isServer: true, ...creds});
                secured.on('error', () => {});
                sockets.add(secured);
                secured.on('close', () => sockets.delete(secured));
                session(secured, true);
            } else if (verb === 'AUTH' && secure) {
                const [mech, initial] = arg.split(' ');
                if (!auth.includes(mech?.toUpperCase())) {
                    socket.write('504 5.5.4 unknown mechanism\r\n');
                } else if (mech.toUpperCase() === 'PLAIN') {
                    const [, user, pass] = Buffer.from(initial ?? '', 'base64').toString('utf8').split('\0');
                    authed = {auth: 'PLAIN', user, pass};
                    send('AUTH', 235, '2.7.0 accepted');
                } else {
                    login = 'user';
                    socket.write(`334 ${Buffer.from('Username:').toString('base64')}\r\n`);
                }
            } else if (verb === 'MAIL') {
                mail = {from: arg.match(/^FROM:<(.*)>$/i)?.[1] ?? null, to: null, ...authed};
                send('MAIL', 250, '2.1.0 ok');
            } else if (verb === 'RCPT') {
                const to = arg.match(/^TO:<(.*)>$/i)?.[1] ?? null;
                if (ok('RCPT')) {
                    mail.to = to;
                }
                // Like real servers, the answer names the address (MailError must not repeat it).
                send('RCPT', 250, `2.1.5 <${to}>`);
            } else if (verb === 'DATA') {
                if (ok('DATA')) {
                    lines = [];
                }
                send('DATA', 354, 'go ahead');
            } else if (verb === 'QUIT') {
                send('QUIT', 221, '2.0.0 bye');
                socket.end();
            } else {
                socket.write('502 5.5.2 not implemented\r\n');
            }
        };

        socket.on('data', (chunk) => {
            buf += chunk.toString('utf8');
            let i;
            while (!socket.destroyed && (i = buf.indexOf('\r\n')) >= 0) {
                const line = buf.slice(0, i);
                buf = buf.slice(i + 2);
                onLine(line);
            }
        });
    }

    const server = mode === 'tls'
        ? tls.createServer(creds, onConnection)
        : net.createServer(onConnection);
    server.on('error', () => {});
    if (mode === 'tls') {
        // Handshake failures (the client refusing the certificate) are expected in the tests.
        server.on('tlsClientError', () => {});
    }
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    return {
        port: server.address().port,
        received: state.received,
        commands: state.commands,
        get ehlo() { return state.ehlo; },
        get connections() { return state.connections; },
        close() {
            for (const s of sockets) {
                s.destroy();
            }
            return new Promise((resolve) => server.close(() => resolve()));
        },
    };
}
