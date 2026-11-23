// Ids, tokens, names and event links. Pure: no files, no clock, no network.
import crypto from 'node:crypto';

export const CID_RE = /^[0-9a-hjkmnp-tv-z]{10}$/;
export const SHEET_RE = /^[0-9a-hjkmnp-tv-z]{6}$/;
export const ZWIFT_RE = /^\d{1,12}$/;
export const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
export const SIG_RE = /^[0-9A-HJKMNP-TV-Z]{6}$/;
export const MOD_RE = /^\d{1,3}(\.\d{1,3}){2}(-beta\.\d{1,3})?$/;
export const RIDER_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{10}$/;

const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';


export function isSlug(s) {
    return typeof s === 'string' && s.length <= 48 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s);
}


export function isEventId(s) {
    if (typeof s !== 'string' && typeof s !== 'number') {
        return false;
    }
    s = String(s);
    if (!/^\d{1,10}$/.test(s)) {
        return false;
    }
    const n = Number(s);
    return n >= 1 && n <= 2147483647;
}


// Lower-case Crockford base32: each character is the low 5 bits of one random byte.
export function randomId(len, rand = crypto.randomBytes) {
    const bytes = rand(len);
    let out = '';
    for (let i = 0; i < len; i++) {
        out += CROCKFORD[bytes[i] & 31];
    }
    return out;
}


export function tokenHash(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}


// A private club's rider code (spec §3): 10 upper-case Crockford characters, 50 bits.
export function newRiderCode(rand = crypto.randomBytes) {
    return randomId(10, rand).toUpperCase();
}


// A code as a rider typed it: case, spaces and hyphens don't matter, O reads as 0, I and L as 1.
// The code, or null when it is none.
export function normalizeRiderCode(s) {
    if (typeof s !== 'string') {
        return null;
    }
    const code = s.toUpperCase().replace(/[ -]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
    return RIDER_CODE_RE.test(code) ? code : null;
}


// The stored form: the HMAC-SHA256 hex of the normalized code, keyed with the server's CODE_SECRET.
// A plain hash of a 50-bit code could be cracked offline from a leaked data folder or backup; the
// secret lives in the environment, outside DATA_DIR. Changing the secret ends every club's code
// (the stored hashes no longer match). null when the code is malformed or there is no secret.
export function riderCodeHash(code, secret) {
    const clean = normalizeRiderCode(code);
    if (clean === null || typeof secret !== 'string' || secret === '') {
        return null;
    }
    return crypto.createHmac('sha256', secret).update(clean).digest('hex');
}


// '7Q4MZ2KX9B' -> '7Q4MZ-2KX9B', or null when it is no code.
export function formatRiderCode(code) {
    const clean = normalizeRiderCode(code);
    return clean === null ? null : `${clean.slice(0, 5)}-${clean.slice(5)}`;
}


export function newToken() {
    const token = crypto.randomBytes(16).toString('base64url');
    return {token, hash: tokenHash(token)};
}


export function slugify(name) {
    return String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}


export function freeSlug(name, taken) {
    const base = slugify(name).slice(0, 40).replace(/-+$/, '') || 'team';
    let slug = base;
    for (let n = 2; taken(slug); n++) {
        slug = `${base}-${n}`;
    }
    return slug;
}


// Bidi controls (LRM, RLM, the embeddings and overrides U+202A-202E, the isolates U+2066-2069) and
// invisible spaces (zero-width space, word joiner, BOM). A name shown reversed or with invisible
// parts would get past nameKey. ZWJ and ZWNJ stay allowed: emoji sequences need them.
const HIDDEN_RE = /[\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/u;


// Trimmed, white space collapsed. null when it has a control character, a bidi control or an
// invisible space (HIDDEN_RE), a lone surrogate, or the length (in code points) is outside
// [min, max].
export function cleanName(s, min, max) {
    if (typeof s !== 'string') {
        return null;
    }
    const clean = s.trim().replace(/\s+/g, ' ');
    // on the raw string: trim() and \s would turn a BOM into white space
    if (/[\p{Cc}\p{Cs}]/u.test(clean) || HIDDEN_RE.test(s)) {
        return null;
    }
    const len = [...clean].length;
    return len < min || len > max ? null : clean;
}


// Comparison key for club names: look-alikes (case, width, punctuation, spacing) collide. Only
// Latin letters are accepted, so a Cyrillic or Greek look-alike cannot imitate another club.
export function nameKey(name) {
    const clean = cleanName(name, 2, 60);
    if (clean == null) {
        return null;
    }
    const key = clean.normalize('NFKC').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');
    if (!key || /\p{L}/u.test(key.replace(/\p{Script=Latin}/gu, ''))) {
        return null;
    }
    return key;
}


function parseMod(v) {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/.exec(String(v));
    if (!m) {
        return [0, 0, 0, 0];
    }
    // A beta sorts below its release: release = Infinity.
    return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] == null ? Infinity : Number(m[4])];
}


export function compareModVersion(a, b) {
    const x = parseMod(a);
    const y = parseMod(b);
    for (let i = 0; i < 4; i++) {
        if (x[i] !== y[i]) {
            return x[i] < y[i] ? -1 : 1;
        }
    }
    return 0;
}


// A Zwift or ZwiftPower event link. Blank is fine (no link). Anything else must be a known host
// and path with an id Zwift could have issued.
export function parseEventUrl(s) {
    const text = String(s ?? '').trim();
    if (!text) {
        return {ok: true, id: null};
    }
    let u;
    try {
        u = new URL(text);
    } catch {
        return {ok: false};
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        return {ok: false};
    }
    let id = null;
    if (u.host === 'zwift.com' || u.host === 'www.zwift.com') {
        const m = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?events\/view\/(\d{1,10})\/?$/i.exec(u.pathname);
        id = m && m[1];
    } else if (u.host === 'zwiftpower.com' || u.host === 'www.zwiftpower.com') {
        if (u.pathname === '/events.php') {
            const zid = u.searchParams.get('zid');
            id = zid && /^\d+$/.test(zid) ? zid : null;
        }
    }
    return id && isEventId(id) ? {ok: true, id: Number(id)} : {ok: false};
}
