// The ZwiftGopher push (proof of concept, 19 Nov 2026): the team's upload page links to the planner
// with a short-lived token, ZwiftGopher posts the plan JSON back to POST /api/v3/push with it, and
// the plan lands in the club's inbox for that team (source 'receive', via 'zwiftgopher'), to be
// stored by the captain with the Store form on the team page like an upload. Never live before that Store.
//
// The token is stateless, nothing is stored per token: 40 lower-case hex characters, the expiry
// (unix seconds, 8 hex) and HMAC-SHA256(secret, `push:<cid>:<slug>:<gen>:<expiry>`) cut to 128 bit
// (32 hex). Every render of the link mints a fresh one, valid PUSH_TTL_S. The secret is made once
// and kept in paceline.db's meta (push_secret), so tokens survive restarts; it is never shown. A
// POST finds the team by checking the MAC against every team of the active clubs (memory only),
// then the expiry. `gen` is team.pushGen (club.mjs pushGenOf): "New ZwiftGopher link" in the team
// settings bumps it, which ends every link of the team at once; deleting a team or club ends its
// links by itself, a rename keeps them (the slug stays).
import crypto from 'node:crypto';
import {json, readBody, HttpError, ClientAbort, logPath} from './http.mjs';
import {clientIp, isPublicIp, makeLimiter, makeSlots} from './limits.mjs';
import {ClubError, checkPlan, receiveEntry, pushGenOf} from './club.mjs';
import {checkTexts, clubErrorText, UPLOAD_BYTES} from './manage.mjs';
import {randomId} from './ids.mjs';

const HOUR_MS = 3600 * 1000;
export const PUSH_TTL_S = 7 * 24 * 3600;
export const PLANNER_URL = 'https://zwiftgopher.com/TTT/';
// Origins whose pages may read the answers (CORS); anyone with a token may post.
export const PUSH_ORIGINS = ['https://zwiftgopher.com', 'https://www.zwiftgopher.com'];
// Plans received per team (user, 19 Nov 2026). Per public client address only the failed tries count
// (an unknown, forged or expired token): a flood of made-up tokens is stopped before any HMAC, while
// valid pushes from one server (ZwiftGopher's) share no budget (user, 19 Nov 2026).
export const PUSH_PER_TEAM = [{ms: HOUR_MS, max: 30}];
export const PUSH_PER_IP = [{ms: HOUR_MS, max: 60}];
const BUSY_RETRY_S = 5;
// A token whose expiry lies further ahead than a fresh link's (PUSH_TTL_S) plus this skew was never
// minted by this server's clock: it counts as unknown.
export const PUSH_SKEW_S = 300;
// Pushes in flight: their own slots, one per club and this many on the server, apart from the
// captains' uploads (manage.mjs), with a body deadline of their own: 256 KB from a browser takes
// seconds, so a trickled body holds a slot for 10 s at most.
export const PUSH_SLOTS = 2;
export const PUSH_BODY_MS = 10000;
const SECRET_META = 'push_secret';
const TOKEN_RE = /^[0-9a-f]{40}$/;
const TYPES = ['application/json', 'text/plain'];


// The server's push secret (64 hex), made at the first start that needs it.
export function pushSecret(db) {
    let secret = db.meta(SECRET_META);
    if (secret === null || !/^[0-9a-f]{64}$/.test(secret)) {
        secret = crypto.randomBytes(32).toString('hex');
        db.setMeta(SECRET_META, secret);
    }
    return secret;
}


const mac = (secret, cid, slug, gen, expiry) => crypto.createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(`push:${cid}:${slug}:${gen}:${expiry}`).digest().subarray(0, 16);


// A team's token for `expiry` (unix seconds).
export function mintToken(secret, cid, slug, gen, expiry) {
    return expiry.toString(16).padStart(8, '0') + mac(secret, cid, slug, gen, expiry).toString('hex');
}


// The push links and their limits. `store` is the club store, `cfg` the server's configuration.
export function makePush({secret, store, cfg}) {
    const host = cfg.publicUrl === null ? null : new URL(cfg.publicUrl).host;
    const perTeam = makeLimiter(PUSH_PER_TEAM);
    const perIp = makeLimiter(PUSH_PER_IP);
    const slots = makeSlots(PUSH_SLOTS);

    // "Plan on ZwiftGopher" of team `slug`, with a token minted now; null without PUBLIC_URL (the
    // planner would not know where to post).
    function href(club, slug, now) {
        if (host === null || !Object.hasOwn(club.teams, slug)) {
            return null;
        }
        const expiry = Math.floor(now / 1000) + PUSH_TTL_S;
        const token = mintToken(secret, club.id, slug, pushGenOf(club.teams[slug]), expiry);
        return `${PLANNER_URL}?paceline=${token}&plhost=${encodeURIComponent(host)}`;
    }

    // The team a token was minted for: {cid, slug, expired} (an active club's team whose MAC
    // matches; `expired` once its expiry has come), else null; also null for an expiry further
    // ahead than any link this server hands out (PUSH_TTL_S + PUSH_SKEW_S).
    function find(token, now) {
        if (typeof token !== 'string' || !TOKEN_RE.test(token)) {
            return null;
        }
        const expiry = parseInt(token.slice(0, 8), 16);
        if (expiry * 1000 > now + (PUSH_TTL_S + PUSH_SKEW_S) * 1000) {
            return null;
        }
        const got = Buffer.from(token.slice(8), 'hex');
        for (const club of store.active()) {
            for (const [slug, team] of Object.entries(club.teams)) {
                if (crypto.timingSafeEqual(got, mac(secret, club.id, slug, pushGenOf(team), expiry))) {
                    return {cid: club.id, slug, expired: now >= expiry * 1000};
                }
            }
        }
        return null;
    }

    // `bodyMs`: the body deadline (a test shortens it)
    return {on: host !== null, href, find, perTeam, perIp, slots, bodyMs: PUSH_BODY_MS, sweep: now => perTeam.sweep(now) + perIp.sweep(now)};
}


// CORS for the push: the planner's origins read the answers; any other origin gets no allow header.
function corsOf(req) {
    const origin = req.headers.origin;
    // Retry-After exposed: the planner's page reads it on a 429 or 503 (ZwiftGopher, 19 Nov 2026)
    return PUSH_ORIGINS.includes(origin) ? {'Access-Control-Allow-Origin': origin, 'Access-Control-Expose-Headers': 'Retry-After', Vary: 'Origin'} : {Vary: 'Origin'};
}


// OPTIONS /api/v3/push: the preflight, allowed for the planner's origins only.
export function pushPreflight(req, res) {
    const allowed = PUSH_ORIGINS.includes(req.headers.origin);
    res.writeHead(204, {
        Vary: 'Origin',
        ...(allowed ? {
            'Access-Control-Allow-Origin': req.headers.origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-Paceline-Token', 'Access-Control-Max-Age': '600',
        } : {}),
    });
    res.end();
}


// POST /api/v3/push?paceline=<token> (or the header X-Paceline-Token; the query wins): the planner's
// JSON export, checked as an upload (manage.mjs checkTexts, club.mjs checkPlan), becomes an inbox
// entry of the token's team. In this order: 405, 429 per address (failed tries), 404 unknown-token, 410 expired,
// 415, 429 per team, 503 busy (the push slots), 413/408 the body, 400 the checks, 409 inbox-full,
// 201; a team or club gone while the body came in is 404 unknown-token, and nothing is stored.
// Every answer, a 500 too, carries the CORS headers for an allowed origin. ctx: {store, cfg, now, push}.
export async function handlePush(req, res, ctx, query, method) {
    const cors = corsOf(req);
    const answer = (status, obj, extra = {}) => json(res, status, obj, {...cors, ...extra});
    try {
        await push(req, res, ctx, query, method, answer);
    } catch (e) {
        if (e instanceof ClientAbort || res.headersSent) {
            throw e;
        }
        if (e instanceof HttpError) {
            answer(e.status, {error: 'bad-request'}, {Connection: 'close'});
            return;
        }
        // as the server's own handler logs it: the error's kind and where, never its message or the query
        const frames = String(e?.stack ?? '').split('\n').filter(l => /^\s+at /.test(l)).join('\n');
        console.error(`request failed: ${req.method} ${logPath(String(req.url).split('?')[0])}: ${String(e?.code ?? e?.name ?? 'error')}${frames ? '\n' + frames : ''}`);
        answer(500, {error: 'internal'});
    }
}


async function push(req, res, {store, cfg, now, push: state}, query, method, answer) {
    if (method !== 'POST') {
        answer(405, {error: 'method-not-allowed'}, {Allow: 'POST, OPTIONS'});
        return;
    }
    const ip = clientIp(req, cfg.trustedProxyHops);
    const counted = isPublicIp(ip);
    // only failed tries count per address; at the limit the token is not even looked at
    if (counted && PUSH_PER_IP.some(w => state.perIp.count(ip, now, w.ms) >= w.max)) {
        answer(429, {error: 'rate-limit'}, {'Retry-After': '3600'});
        return;
    }
    const failed = () => counted && state.perIp.add(ip, now);
    const header = req.headers['x-paceline-token'];
    const token = query.get('paceline') ?? (typeof header === 'string' ? header : null);
    const found = state.find(token, now);
    if (found === null) {
        failed();
        answer(404, {error: 'unknown-token'});
        return;
    }
    if (found.expired) {
        failed();
        answer(410, {error: 'expired'});
        return;
    }
    const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (!TYPES.includes(type)) {
        answer(415, {error: 'content-type'});
        return;
    }
    const {cid, slug} = found;
    if (!state.perTeam.allow(`${cid}:${slug}`, now)) {
        answer(429, {error: 'rate-limit'}, {'Retry-After': '3600'});
        return;
    }
    if (state.slots.take(cid) !== 'ok') {
        answer(503, {error: 'busy'}, {'Retry-After': String(BUSY_RETRY_S)});
        return;
    }
    try {
        let body;
        try {
            body = await readBody(req, UPLOAD_BYTES, state.bodyMs);
        } catch (e) {
            if (e instanceof HttpError && (e.status === 413 || e.status === 408)) {
                answer(e.status, {error: e.status === 413 ? 'too-large' : 'too-slow'}, {Connection: 'close'});
                return;
            }
            throw e;
        }
        // a leading BOM goes, as for an upload
        const text = body.toString('utf8').replace(/^\uFEFF/, '');
        const read = checkTexts([text]);
        if (!read.ok) {
            answer(400, {error: read.code, message: read.error});
            return;
        }
        const {imported} = read;
        try {
            const checked = checkPlan(imported.json, imported.text);
            store.change(cid, c => receiveEntry(c, {
                team: slug, via: 'zwiftgopher', json: checked.json, text: checked.text, warnings: imported.warnings, zgShare: checked.zgShare,
            }, {now, newId: () => randomId(6)}));
        } catch (e) {
            if (!(e instanceof ClubError)) {
                throw e;
            }
            if (e.code === 'not-found') {
                // the team (or the club) went while the body came in: its links have ended
                answer(404, {error: 'unknown-token'});
            } else {
                answer(e.code === 'inbox-full' ? 409 : 400, {error: e.code, message: clubErrorText(e)});
            }
            return;
        }
        const club = store.get(cid);
        const page = `/manage/team/${slug}`;
        answer(201, {ok: true, club: club.name, team: club.teams[slug].name, review: cfg.publicUrl === null ? page : cfg.publicUrl + page});
    } finally {
        state.slots.release(cid);
    }
}
