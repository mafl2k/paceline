// A club's tokens (spec §4): only the sha256 of a token is stored, the plain token leaves once (by
// mail, or shown once by the admin). Pure: the functions change the club object they get (the
// clone inside store.change) and take the time as `now` (ms). Times are stored as ISO strings.
//   link     one active (expiresAt null) and up to 3 pending, a pending one expires in 24 h
//   confirm  an address change or deletion, confirmed by the current address, 24 h
//   email    the new address confirms itself, 24 h
// The add* functions take an optional pre-drawn {token, hash} (newToken()), so a route can mail the
// token first and store it only when the mail was queued.
import {newToken} from './ids.mjs';

export const TOKEN_MS = 24 * 3600 * 1000;
export const MAX_PENDING_LINKS = 3;
const CONFIRM_ACTIONS = ['email', 'delete'];

const iso = ms => new Date(ms).toISOString();

// An unreadable expiresAt counts as expired.
const expired = (tk, now) => tk.expiresAt != null && !(Date.parse(tk.expiresAt) >= now);

const isPendingLink = tk => tk.kind === 'link' && tk.state === 'pending';


// Whether dropExpired would remove anything (reads only).
export function hasExpired(club, now) {
    return club.tokens.some(tk => tk === null || typeof tk !== 'object' || expired(tk, now));
}


export function dropExpired(club, now) {
    club.tokens = club.tokens.filter(tk => tk !== null && typeof tk === 'object' && !expired(tk, now));
}


function add(club, now, t, fields) {
    dropExpired(club, now);
    club.tokens.push({hash: t.hash, ...fields, createdAt: iso(now), expiresAt: iso(now + TOKEN_MS)});
    return t.token;
}


// A new pending link; the oldest pending one goes when there would be more than 3.
export function addLink(club, now, t = newToken()) {
    const token = add(club, now, t, {kind: 'link', state: 'pending'});
    const pending = club.tokens.filter(isPendingLink);
    if (pending.length > MAX_PENDING_LINKS) {
        const drop = new Set(pending.slice(0, pending.length - MAX_PENDING_LINKS));
        club.tokens = club.tokens.filter(tk => !drop.has(tk));
    }
    return token;
}


// The club's link with this hash when it opens the club: a pending one that has not expired, or the
// active one (a second device opening the same mail). Else null.
export function usableLink(club, hash, now) {
    const link = club.tokens.find(tk => tk?.kind === 'link' && tk.hash === hash);
    if (!link) {
        return null;
    }
    return link.state === 'active' || (link.state === 'pending' && !expired(link, now)) ? link : null;
}


// Opens a link: a pending one becomes the active link and every other link ends. The active link
// opens again without a change. false when the link does not open the club.
export function openLink(club, hash, now) {
    const link = usableLink(club, hash, now);
    if (!link) {
        return false;
    }
    if (link.state !== 'active') {
        link.state = 'active';
        link.expiresAt = null;
        club.tokens = club.tokens.filter(tk => tk.kind !== 'link' || tk === link);
    }
    return true;
}


// `email` is the new address for an address change; a deletion keeps none.
export function addConfirm(club, {action, email}, now, t = newToken()) {
    if (!CONFIRM_ACTIONS.includes(action)) {
        throw new TypeError(`bad confirm action ${action}`);
    }
    return add(club, now, t, {kind: 'confirm', action, email: action === 'email' ? email : null});
}


export function addEmailToken(club, email, now, t = newToken()) {
    return add(club, now, t, {kind: 'email', email});
}


// The club's token record of that kind with this hash, or null when there is none or it expired.
// Nothing changes (a GET of /t/ only looks).
export function liveToken(club, hash, kind, now) {
    const tk = club.tokens.find(x => x?.kind === kind && x.hash === hash);
    return tk && !expired(tk, now) ? tk : null;
}


// The token record (removed from the club), or null when there is none of that kind or it expired.
export function takeToken(club, hash, kind, now) {
    const tk = liveToken(club, hash, kind, now);
    if (!tk) {
        return null;
    }
    club.tokens = club.tokens.filter(x => x !== tk);
    return tk;
}


export function endAllLinks(club) {
    club.tokens = club.tokens.filter(tk => tk?.kind !== 'link');
}
