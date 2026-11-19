// HTTP helpers shared by every route: errors, body reading, answers with the security headers,
// the same-origin check, strict multipart and form parsing, cookies, and log-safe paths.
// node:http only, no npm dependencies.

const MB = 1024 * 1024;


export class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}


// The client went away before its body was complete (connection reset or closed): nothing to
// answer and nothing to store. `timeout` is true when it was the server's own request timeout
// (node's requestTimeout) that closed the connection, not the client.
export class ClientAbort extends Error {
    constructor(timeout = false) {
        super(timeout ? 'request timed out' : 'request aborted by the client');
        this.timeout = timeout;
    }
}


const sizeText = n => n % MB === 0 ? `${n / MB} MB` : `${Math.ceil(n / 1024)} KB`;


// node's requestTimeout destroys the socket with this error before the request sees 'aborted'.
const timedOut = req => req.socket?.errored?.code === 'ERR_HTTP_REQUEST_TIMEOUT';


// The default body deadline: every route that reads a body gets it unless it passes its own (a
// recording upload takes LOG_BODY_MS, 120 s, state.bodyMs in logs.mjs). 30 s is long for the small
// forms and bodies, short enough that a trickled one does not hold a connection for minutes.
export const BODY_MS = 30000;


// The body as one Buffer. The chunk list is emptied as soon as it is joined (or refused), so the
// listeners that stay on `req` until the request ends never hold a second copy of the body.
// A body that is not complete `ms` after the call (BODY_MS unless given; 0 = no deadline) is
// refused with 408 (a timer of its own: node checks requestTimeout only every 30 s, so a trickled
// body would be read for up to a minute); the caller answers and the connection closes.
export function readBody(req, limit, ms = BODY_MS) {
    const tooBig = () => new HttpError(413, `The upload is larger than ${sizeText(limit)}.`);
    return new Promise((resolve, reject) => {
        const declared = req.headers['content-length'];
        if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
            reject(tooBig());
            return;
        }
        const chunks = [];
        let size = 0, settled = false;
        let timer = null;
        const settle = (fn, v) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                chunks.length = 0;
                fn(v);
            }
        };
        if (ms > 0) {
            timer = setTimeout(() => {
                settle(reject, new HttpError(408, 'The upload took too long.'));
                req.pause();
            }, ms);
            timer.unref();
        }
        req.on('data', c => {
            if (settled) {
                return;
            }
            size += c.length;
            if (size > limit) {
                settle(reject, tooBig());
                req.pause();
                return;
            }
            chunks.push(c);
        });
        req.on('end', () => {
            if (!settled) {
                const body = Buffer.concat(chunks);
                settle(resolve, body);
            }
        });
        req.on('error', e => settle(reject, e && (e.code === 'ECONNRESET' || e.message === 'aborted') ? new ClientAbort(timedOut(req)) : e));
        req.on('close', () => {
            if (!req.complete) {
                settle(reject, new ClientAbort(timedOut(req)));
            }
        });
    });
}


// ---- answers ----

export const SEC_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    'X-Robots-Tag': 'noindex',
};


export function send(res, status, type, body, extra) {
    res.writeHead(status, {'Content-Type': type, 'Cache-Control': 'no-store', ...SEC_HEADERS, ...extra});
    res.end(body);
}


// A request's If-None-Match names this etag (weak tags and `*` count).
export function etagMatches(req, etag) {
    const inm = String(req.headers['if-none-match'] || '');
    return inm.split(',').map(x => x.trim().replace(/^W\//, '')).some(t => t === etag || t === '*');
}


export const json = (res, status, obj, extra) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(obj), extra);

export const html = (res, status, body) => send(res, status, 'text/html; charset=utf-8', body);


// Browsers attach credentials (cookies, Basic auth) to cross-site form posts, so refuse those.
export function sameOrigin(req) {
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined) {
        return site === 'same-origin' || site === 'none';
    }
    const origin = req.headers.origin;
    if (origin === undefined) {
        return true;  // curl and friends
    }
    try {
        return new URL(origin).host === req.headers.host;
    } catch (e) {
        return false;
    }
}


// ---- request bodies ----

const CRLF = Buffer.from('\r\n');
const HEADER_END = Buffer.from('\r\n\r\n');
const DISPOSITION = /^form-data;\s*name="([^"]*)"(?:;\s*filename="([^"]*)")?$/i;


// Strict multipart/form-data: only the names in `files` (each needs a filename attribute) and
// `fields` (must not have one), each at most once. Every name comes back, null when absent.
export function parseMultipart(body, contentType, {files, fields}) {
    const bad = () => new HttpError(400, `The upload was not a valid form (expected fields ${[...fields, ...files].join(', ')}).`);
    const isFile = new Map([...files.map(n => [n, true]), ...fields.map(n => [n, false])]);
    const m = /^multipart\/form-data;\s*boundary=(?:"([^"\r\n]{1,70})"|([^\s;"]{1,70}))\s*$/i.exec(contentType || '');
    if (!m) {
        throw bad();
    }
    const delim = Buffer.from('--' + (m[1] || m[2]));
    const nextDelim = Buffer.concat([CRLF, delim]);
    if (body.indexOf(delim) !== 0) {
        throw bad();
    }
    const out = Object.fromEntries([...isFile.keys()].map(n => [n, null]));
    let pos = delim.length;
    for (;;) {
        const tail = body.subarray(pos, pos + 2).toString('latin1');
        if (tail === '--') {
            const rest = body.subarray(pos + 2);
            if (rest.length && !rest.equals(CRLF)) {
                throw bad();
            }
            break;
        }
        if (tail !== '\r\n') {
            throw bad();
        }
        const hEnd = body.indexOf(HEADER_END, pos);
        if (hEnd < 0) {
            throw bad();
        }
        const headers = body.subarray(pos + 2, hEnd).toString('utf8').split('\r\n');
        const start = hEnd + HEADER_END.length;
        const end = body.indexOf(nextDelim, start);
        if (end < start) {
            throw bad();
        }
        const content = body.subarray(start, end);
        let name = null, filename = null;
        for (const h of headers) {
            const colon = h.indexOf(':');
            const key = colon < 0 ? '' : h.slice(0, colon).trim().toLowerCase();
            if (key === 'content-disposition') {
                const d = DISPOSITION.exec(h.slice(colon + 1).trim());
                if (!d || name !== null) {
                    throw bad();
                }
                name = d[1];
                filename = d[2] === undefined ? null : d[2];
            } else if (key !== 'content-type') {
                throw bad();
            }
        }
        if (!isFile.has(name) || out[name] !== null) {
            throw bad();
        }
        if (isFile.get(name) !== (filename !== null)) {
            throw bad();
        }
        out[name] = content;
        pos = end + nextDelim.length;
    }
    return out;
}


export function parseForm(buf) {
    return new URLSearchParams(buf.toString('utf8'));
}


// `a=1; b=2` as a Map, values as sent. Only space and tab around a name or value go (RFC 6265 OWS),
// never U+00A0 or other Unicode white space. A name sent more than once is left out: which one the
// browser meant cannot be told (a __Host- cookie exists once per host), so neither counts.
const OWS = /^[ \t]+|[ \t]+$/g;

export function parseCookies(header) {
    const out = new Map();
    const twice = new Set();
    for (const pair of String(header ?? '').split(';')) {
        const i = pair.indexOf('=');
        if (i < 0) {
            continue;
        }
        const name = pair.slice(0, i).replace(OWS, '');
        if (!name) {
            continue;
        }
        if (out.has(name)) {
            twice.add(name);
        } else {
            out.set(name, pair.slice(i + 1).replace(OWS, ''));
        }
    }
    for (const name of twice) {
        out.delete(name);
    }
    return out;
}


// Tokens never reach the log: the segment after /m/ or /t/ becomes `…`.
export function redactPath(p) {
    return String(p).replace(/(^|\/)([mt])\/[^/]+/g, '$1$2/…');
}


// A request path for an error line: redactPath, and Zwift IDs out as well (any segment of digits
// only, and runs of 3 or more digits elsewhere, as in a recording's <session>-<athlete> name).
export function logPath(p) {
    return redactPath(p).split('/').map(seg => (/^\d+$/.test(seg) ? '…' : seg.replace(/\d{3,}/g, '…'))).join('/');
}
