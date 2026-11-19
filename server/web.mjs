// The public pages and the club link (spec §5, §5.1): the start page (a browser with a club open
// goes on to /manage), registration, /m/<token> (a
// GET shows a button, the POST opens the club and puts it in the cookie), /t/<token> (the same for
// an address change or a delete confirmed by mail), the lost link, the privacy page (§9), switching
// between the clubs of one browser (POST /switch, /logout-all), and the gate in front of every
// /manage* request (the club's own routes are in manage.mjs).
// Plain forms, no scripts, in the captain pages' look (publicPage in ui.mjs). No GET changes anything: mail scanners and link previews open every link.
// Every POST passes the same-origin check first. Club links travel only by mail (or shown once by
// the admin), built from PUBLIC_URL, never from the Host header. Nothing here logs a token or an
// address.
import {domainToASCII} from 'node:url';
import {TOKEN_RE, tokenHash, newToken, randomId, cleanName, nameKey} from './ids.mjs';
import {ClubError, addLog, newClub} from './club.mjs';
import {isZone} from './time.mjs';
import {isAddress} from './mail.mjs';
import {mailContent} from './mail-content.mjs';
import {clientIp, makeLimiter, makeSlots, SHEET_UPLOADS_MAX} from './limits.mjs';
import {readBody, BODY_MS, send, html, sameOrigin, parseForm, parseCookies} from './http.mjs';
import {esc, t, maskAddress, retentionText, monthsText} from './pages.mjs';
import {addLink, openLink, usableLink, addConfirm, addEmailToken, liveToken, takeToken} from './tokens.mjs';
import {makeFlashes} from './flash.mjs';
import {signedOutPage, publicPage, flashBlock, postForm, sevLine} from './ui.mjs';
import {ic} from './icons.mjs';

export const CLUB_COOKIE = '__Host-pl_club';
const COOKIE_MAX_AGE = 400 * 24 * 3600;  // 400 days, 34560000 s
const COOKIE_ATTRS = 'HttpOnly; Secure; SameSite=Lax; Path=/';
// urlencoded forms: small bodies, the default 30 s deadline
export const FORM_BYTES = 64 * 1024;

const iso = ms => new Date(ms).toISOString();

const HOUR_MS = 3600 * 1000;
// Public form posts per client address (spec §8: register 5/h, 20/day). /lost has the same limits
// in a limiter of its own: a refused mail there still costs two writes.
const FORM_WINDOWS = [{ms: HOUR_MS, max: 5}, {ms: 24 * HOUR_MS, max: 20}];
// Registration (spec §8): clubs per address, active and pending; pending clubs in all. A client
// address starts at most 3 clubs a day (controller ruling, 16 Nov 2026), so one address cannot fill
// all 20 pending places.
export const CLUBS_PER_ADDRESS = 3;
export const MAX_PENDING_CLUBS = 20;
const NEW_CLUBS_PER_IP = [{ms: 24 * HOUR_MS, max: 3}];
// Team deletes per club a day (controller ruling, 16 Nov 2026): each retires a slug for good, and
// retired_slugs is read at every start, so an add-and-delete loop must not grow it without bound.
export const TEAM_DELETES_PER_DAY = 20;
const TEAM_DELETES = [{ms: 24 * HOUR_MS, max: TEAM_DELETES_PER_DAY}];
// Sheet uploads and their previews (the dry run) per club in 10 minutes (plan 3b, spec §5.4 "Calls
// made while planning"): each parses the files, so both count, when they get their slot; then 429.
export const SHEET_PARSES_PER_10_MIN = 60;
const SHEET_PARSES = [{ms: 10 * 60000, max: SHEET_PARSES_PER_10_MIN}];

// The runtime's zone list; it lacks UTC and a few current ids (Europe/Kyiv, Asia/Kolkata).
const ZONES = new Set(Intl.supportedValuesOf('timeZone'));


// What the web routes keep while the server runs, in memory only: the per-address limits of the
// public forms, the clubs each client address started, each club's team deletes and sheet parses
// (uploads and previews, by club id), and the one-shot flashes of the captain pages (flash.mjs).
// sweep(now) drops expired counters and flashes.
export function makeWebState() {
    const limits = {
        register: makeLimiter(FORM_WINDOWS), lost: makeLimiter(FORM_WINDOWS), newClubs: makeLimiter(NEW_CLUBS_PER_IP),
        teamDeletes: makeLimiter(TEAM_DELETES), sheetParses: makeLimiter(SHEET_PARSES),
    };
    // sheetUploads: the sheet uploads in flight, one per club and SHEET_UPLOADS_MAX in all (manage.mjs);
    // sheetBodyMs: the deadline for an upload's body (a test shortens it)
    const flashes = makeFlashes();
    return {
        ...limits, sheetUploads: makeSlots(SHEET_UPLOADS_MAX), sheetBodyMs: BODY_MS, flashes,
        sweep: now => Object.values(limits).reduce((n, l) => n + l.sweep(now), 0) + flashes.sweep(now),
    };
}


// The club cookie keeps up to CLUB_COOKIE_MAX club links, joined by '.' (never in a token, TOKEN_RE):
// 5 tokens are 114 bytes. The first is the active club. One token alone is the format from before
// several clubs, read the same way.
export const CLUB_COOKIE_MAX = 5;
const COOKIE_SEP = '.';


// The well-formed tokens of the club cookie, in its order, each once, at most CLUB_COOKIE_MAX.
export function cookieTokens(req) {
    const raw = parseCookies(req.headers.cookie).get(CLUB_COOKIE);
    if (raw === undefined) {
        return [];
    }
    return [...new Set(raw.split(COOKIE_SEP).filter(tok => TOKEN_RE.test(tok)))].slice(0, CLUB_COOKIE_MAX);
}


// The clubs the club cookie still opens, in its order: {circle (the club id), hash, tok} for each
// token that is the active link of an active club, one per club (its first token). The first is the
// active club; [] when none.
export function cookieClubs(req, {store}) {
    const out = [];
    for (const tok of cookieTokens(req)) {
        const hash = tokenHash(tok);
        const owner = store.tokenOwner(hash);
        if (!owner || !store.get(owner.cid) || out.some(c => c.circle === owner.cid)) {
            continue;
        }
        const {token} = owner;
        if (token.kind === 'link' && token.state === 'active') {
            out.push({circle: owner.cid, hash, tok});
        }
    }
    return out;
}


export function setClubCookie(res, tokens) {
    const value = tokens.slice(0, CLUB_COOKIE_MAX).join(COOKIE_SEP);
    res.setHeader('Set-Cookie', `${CLUB_COOKIE}=${value}; ${COOKIE_ATTRS}; Max-Age=${COOKIE_MAX_AGE}`);
}


export function clearClubCookie(res) {
    res.setHeader('Set-Cookie', `${CLUB_COOKIE}=; ${COOKIE_ATTRS}; Max-Age=0`);
}


// Sets the club cookie anew: `first` (a token of club `without`, or null) on top, then every other
// club the cookie still opens in its order, without club `without` (a club id, or null). Tokens that
// no longer work drop out; at most CLUB_COOKIE_MAX, so the oldest (last) goes. Cleared when nothing
// is left.
export function rewriteClubCookie(req, res, ctx, {first = null, without = null} = {}) {
    const rest = cookieClubs(req, ctx).filter(c => c.circle !== without).map(c => c.tok);
    const tokens = first ? [first, ...rest] : rest;
    if (tokens.length) {
        setClubCookie(res, tokens);
    } else {
        clearClubCookie(res);
    }
}


// A club cookie that holds tokens that no longer open a club loses them (they can never work
// again): rewritten with the ones that still work, cleared when none does.
export function clearDeadCookie(req, res, ctx) {
    const raw = parseCookies(req.headers.cookie).get(CLUB_COOKIE);
    if (raw === undefined) {
        return;
    }
    const good = cookieClubs(req, ctx).map(c => c.tok);
    if (!good.length) {
        clearClubCookie(res);
    } else if (good.join(COOKIE_SEP) !== raw) {
        setClubCookie(res, good);
    }
}


// Who is asking: {circle (the club id), scope: 'club', hash, others} for the active club, the first
// club the cookie still opens (cookieClubs); `others` are the ids of the other clubs it opens, in its
// order (the captain footer's club switch). Else null. Handlers re-read store.get(circle) after an
// await: store.change replaces the club object.
export function principal(req, ctx) {
    const clubs = cookieClubs(req, ctx);
    if (!clubs.length) {
        return null;
    }
    const [{circle, hash}, ...rest] = clubs;
    return {circle, scope: 'club', hash, others: rest.map(c => c.circle)};
}


export function redirect(res, location, extra) {
    send(res, 303, 'text/plain; charset=utf-8', '', {Location: location, ...extra});
}


export function refuseCrossSite(res) {
    send(res, 403, 'text/plain; charset=utf-8', 'cross-site request refused');
}


// The gate in front of every /manage* request: a GET without a working club cookie goes to the
// start page; anything else must come from this site and carry one. The principal, or null when
// the answer is already sent.
export function clubGate(req, res, ctx, method) {
    if (method !== 'GET' && !sameOrigin(req)) {
        refuseCrossSite(res);
        return null;
    }
    const who = principal(req, ctx);
    if (who) {
        return who;
    }
    if (method === 'GET') {
        clearDeadCookie(req, res, ctx);
        redirect(res, '/');
    } else {
        noLonger(req, res, ctx);
    }
    return null;
}


// 403 for a /manage* POST without a working club cookie; dead tokens go (clearDeadCookie).
export function noLonger(req, res, ctx) {
    clearDeadCookie(req, res, ctx);
    html(res, 403, signedOutPage());
}


// A club name as typed on a form: {ok: true, name} (cleaned) or {ok: false, error} with a copy key.
// Unique among active and trashed clubs (nameKey), except the club `exceptCid` itself.
export function checkClubName(store, name, exceptCid = null) {
    const clean = cleanName(name, 2, 60);
    const key = clean === null ? null : nameKey(clean);
    if (key === null) {
        return {ok: false, error: 'name-bad'};
    }
    return store.nameTaken(key, exceptCid) ? {ok: false, error: 'name-taken'} : {ok: true, name: clean};
}


// Mails a link for the club to its address. true when the mail was queued; false when it was
// refused or mail is off.
export function mailLink({cfg, mailer}, club, {token}) {
    if (mailer === null || !cfg.publicUrl) {
        return false;
    }
    const link = `${cfg.publicUrl}/m/${token}`;
    return mailer.send({
        kind: 'new-link', to: club.email, budget: 'other',
        ...mailContent('new-link', {club: club.name, link}, cfg),
    });
}


// A token by mail: `add(club)` stores it first, so no mail carries a token that was never stored (a
// club at its size cap, a failed write); when `mail()` is then refused (over a limit, mail off),
// the club's tokens go back to what they were, so a refused mail cannot push out a token the
// captain already has. All of it is synchronous: nothing else touches the club in between. true
// when the mail went out. Never throws; a failure logs the club id, `what` and the error kind only.
function storeThenMail(ctx, cid, what, add, mail) {
    const {store, cfg, mailer} = ctx;
    if (mailer === null || !cfg.publicUrl) {
        return false;
    }
    const before = structuredClone(store.getAny(cid)?.tokens ?? []);
    try {
        store.change(cid, add);
    } catch (e) {
        console.error(`paceline-server: ${what} for ${cid} not stored: ${e?.code ?? e?.name ?? 'error'}`);
        return false;
    }
    let sent = false;
    try {
        sent = mail();
    } catch (e) {
        console.error(`paceline-server: ${what} for ${cid} not mailed: ${e?.code ?? e?.name ?? 'error'}`);
    }
    if (sent) {
        return true;
    }
    try {
        store.change(cid, c => {
            c.tokens = before;
        });
    } catch (e) {
        console.error(`paceline-server: ${what} for ${cid} not taken back: ${e?.code ?? e?.name ?? 'error'}`);
    }
    return false;
}


// A new pending link by mail (storeThenMail). true when a link went out.
export function newLinkByMail(ctx, club) {
    const tk = newToken();
    return storeThenMail(ctx, club.id, 'new link', c => addLink(c, ctx.now, tk), () => mailLink(ctx, club, tk));
}


// A confirmation by mail to the club's current address (spec §5.1): `action` 'email' (with the new
// address `email`, shown in full: the owner of the current address sees what he approves, a typo
// included) or 'delete'. The confirm token is stored first (storeThenMail). true when the
// mail went out.
export function confirmByMail(ctx, club, {action, email = null}) {
    const {cfg, mailer, now} = ctx;
    const tk = newToken();
    const vars = {club: club.name, link: `${cfg.publicUrl}/t/${tk.token}`, lost: `${cfg.publicUrl}/lost`};
    const kind = action === 'email' ? 'confirm-email' : 'confirm-delete';
    const mail = {kind, ...mailContent(kind, action === 'email' ? {...vars, email} : vars, cfg)};
    return storeThenMail(ctx, club.id, `confirm ${action}`, c => addConfirm(c, {action, email}, now, tk),
        () => mailer.send({...mail, to: club.email, budget: 'other'}));
}


// An address as typed, trimmed, with an internationalized domain in its ASCII form (bücher.de →
// xn--bcher-kva.de, lower case), so it passes isAddress and the mail can go out. Unchanged when
// the domain does not convert; isAddress then decides.
export function mailAddress(s) {
    const v = String(s ?? '').trim();
    const at = v.lastIndexOf('@');
    if (at < 1) {
        return v;
    }
    const domain = domainToASCII(v.slice(at + 1));
    return domain ? `${v.slice(0, at)}@${domain}` : v;
}


// The time zones a form offers: the runtime's list plus UTC (clubs racing WTRL/ZRL times fixed in
// UTC), the server's zone and `current` (a club's zone), sorted. A zone is valid when it is one of
// them and the runtime knows it.
export function zoneOptions(cfg, current = null) {
    return [...new Set([...ZONES, 'UTC', cfg.tz, ...(current ? [current] : [])])].sort();
}

export function zoneOk(cfg, tz, current = null) {
    return isZone(tz) && (ZONES.has(tz) || tz === 'UTC' || tz === cfg.tz || tz === current);
}

export function zoneSelect(cfg, selected, current = null) {
    const options = zoneOptions(cfg, current)
        .map(z => `<option value="${esc(z)}"${z === selected ? ' selected' : ''}>${esc(z)}</option>`).join('');
    return `<select name="tz" required>${options}</select>`;
}


// Open when the admin switch (the registration setting) or else REGISTRATION says so, mail is on
// and the server has room for another active club.
export function registrationOpen({store, cfg, mailer}) {
    return (store.serverSettings().registration ?? cfg.registration) === 'open'
        && mailer !== null && Boolean(cfg.publicUrl) && store.activeCount() < cfg.maxCircles;
}


// After the register answer: a pending club with a pending link, and its confirm mail. Nothing when
// the address has 3 clubs, 20 clubs are pending or the client address `ip` started 3 clubs today;
// the club goes again when the mail is refused (and then does not count for `ip`). The answer never
// tells which.
function registerClub(ctx, {name, email, tz, ip}) {
    const {store, cfg, mailer, now, web} = ctx;
    const key = email.toLowerCase();
    const clubs = [...store.active(), ...store.pending()].filter(c => String(c.email).toLowerCase() === key);
    if (clubs.length >= CLUBS_PER_ADDRESS || store.pendingCount() >= MAX_PENDING_CLUBS
        || web.newClubs.count(ip, now, NEW_CLUBS_PER_IP[0].ms) >= NEW_CLUBS_PER_IP[0].max) {
        return;
    }
    const club = newClub({id: randomId(10), name, email, tz, now});
    const tk = newToken();
    addLink(club, now, tk);
    // stored first, so no mail carries a link that was never stored
    store.create(club);
    let sent = false;
    try {
        const link = `${cfg.publicUrl}/m/${tk.token}`;
        sent = mailer !== null && mailer.send({
            kind: 'confirm-club', to: email, budget: 'new',
            ...mailContent('confirm-club', {club: name, link}, cfg),
        });
    } finally {
        if (sent) {
            web.newClubs.add(ip, now);
        } else {
            store.removePending(club.id);
        }
    }
}


// ---- pages ----
// The public pages, in publicPage() (ui.mjs): the captain pages' cards, buttons and fields, without
// the script (every form is a plain POST). Each has one h1.

// A card with `heading` as the page's h1, then `inner` (HTML).
const card = (heading, inner) => `<section class="card">
    <h1>${esc(heading)}</h1>
    ${inner}
  </section>`;

const lostButton = () => `<a class="btn primary block" href="/lost">${ic('mail')}${esc(t('lost-ask'))}</a>`;


// The start page, for a browser without a club open (GET / sends one with a club to /manage):
// Register a club and Lost link.
function homePage() {
    return publicPage(card(t('home-heading'), `<p>${esc(t('home-intro'))}</p>
    <div class="btnrow">
      <a class="btn primary block" href="/register">${ic('plus')}${esc(t('home-register'))}</a>
      <a class="btn secondary block" href="/lost">${ic('mail')}${esc(t('home-lost'))}</a>
    </div>`), {here: '/'});
}


const badLinkPage = () => publicPage(card(t('home-heading'), `${sevLine('err', 'alert', t('link-bad'))}
    ${lostButton()}`));


const noRoomPage = () => publicPage(card(t('home-heading'), sevLine('err', 'alert', t('link-no-room'))));


function openPage(club, tok) {
    return publicPage(card(club.name, postForm(`/m/${tok}`, {}, t('link-open', {club: club.name}), {cls: 'btn primary block'})));
}


function namePage(tok, name, error) {
    return publicPage(card(t('link-name-heading'), `${flashBlock({kind: 'err', text: error})}
    <form class="stack" method="post" action="/m/${esc(tok)}">
      <label class="field">${esc(t('name-label'))} <span class="hint">${esc(t('name-hint'))}</span><input type="text" name="name" value="${esc(name)}" maxlength="60" required autocomplete="off"></label>
      <button class="btn primary block" type="submit">${esc(t('link-name-button'))}</button>
    </form>`));
}


function lostPage() {
    return publicPage(card(t('lost-heading'), `<p>${esc(t('lost-intro'))}</p>
    <form class="stack" method="post" action="/lost">
      <label class="field">${esc(t('lost-label'))}<input type="email" name="email" maxlength="254" required autocomplete="email"></label>
      <button class="btn primary block" type="submit">${ic('mail')}${esc(t('lost-button'))}</button>
    </form>`));
}


const lostDonePage = () => publicPage(card(t('lost-heading'), sevLine('neutral', 'mail', t('lost-done'))));


// GET /t/<token>: the button that confirms, nothing else.
function confirmPage(club, tok, token) {
    const del = token.kind !== 'email' && token.action !== 'email';
    const button = token.kind === 'email' ? t('confirm-email')
        : token.action === 'email' ? t('confirm-change', {masked: maskAddress(token.email)})
            : t('confirm-delete', {club: club.name});
    return publicPage(card(club.name, postForm(`/t/${tok}`, {}, button, {cls: del ? 'btn danger block' : 'btn primary block'})));
}


// The answer to a POST /t/<token>: `text`, an error when `err`.
const confirmDonePage = (club, text, err) => publicPage(card(club.name, err ? sevLine('err', 'alert', text) : sevLine('ok', 'checkCircle', text)));


function registerPage(cfg, {name = '', email = '', tz = cfg.tz, riders = false, error = null} = {}) {
    const err = error ? `${flashBlock({kind: 'err', text: error})}
    ` : '';
    return publicPage(card(t('register-heading'), `${err}<p>${esc(t('register-intro'))}</p>
    <form class="stack" method="post" action="/register">
      <label class="field">${esc(t('name-label'))} <span class="hint">${esc(t('name-hint'))}</span><input type="text" name="name" value="${esc(name)}" maxlength="60" required autocomplete="organization"></label>
      <label class="field">${esc(t('register-email-label'))} <span class="hint">${esc(t('register-email-hint'))}</span><input type="email" name="email" value="${esc(email)}" maxlength="254" required autocomplete="email"></label>
      <label class="field">${esc(t('register-tz-label'))} <span class="hint">${esc(t('register-tz-hint'))}</span>
        ${zoneSelect(cfg, tz)}</label>
      <label class="choice"><input type="checkbox" name="riders" required${riders ? ' checked' : ''}><span>${esc(t('register-riders'))}</span></label>
      <a class="uplink" href="/privacy">${ic('info')}${esc(t('register-privacy'))}</a>
      <button class="btn primary block" type="submit">${esc(t('register-button'))}</button>
    </form>`));
}


const registerDonePage = () => publicPage(card(t('register-heading'), sevLine('neutral', 'mail', t('register-done'))));

const registerClosedPage = () => publicPage(card(t('register-heading'), sevLine('neutral', 'info', t('register-closed'))));


const PRIVACY_ROWS = ['club', 'address', 'sheets', 'inbox', 'code', 'delivery', 'recordings', 'deleted', 'backups', 'limits'];

// The heading and its intro on top, then a card per section.
function privacyPage({cfg, mailer}) {
    const months = monthsText(cfg.backupRetentionMonths);
    const kept = r => r === 'recordings'
        ? retentionText('privacy-recordings-kept', cfg.logRetentionDays)
        : t(`privacy-${r}-kept`, {months});
    const section = (key, body) => `<section class="card">\n<h2>${esc(t(`privacy-${key}-heading`))}</h2>\n${body}\n</section>\n`;
    const p = s => `<p>${esc(s)}</p>`;
    const rows = PRIVACY_ROWS.map(r => `<tr><td>${esc(t(`privacy-${r}-data`))}</td><td>${esc(t(`privacy-${r}-who`))}</td><td>${esc(kept(r))}</td></tr>`).join('\n');
    const who = cfg.privacyContact ? t('privacy-who', {contact: cfg.privacyContact}) : t('privacy-who-none');
    const mail = mailer !== null && cfg.smtp ? t('privacy-processors-mail', {smtp: cfg.smtp.host}) : t('privacy-processors-no-mail');
    return publicPage(`<header class="pagehead"><h1>${esc(t('privacy-heading'))}</h1>${p(t('privacy-intro'))}</header>\n`
        + section('who', p(who))
        + section('data', `<table class="ptable">
<thead><tr><th>${esc(t('privacy-col-data'))}</th><th>${esc(t('privacy-col-who'))}</th><th>${esc(t('privacy-col-kept'))}</th></tr></thead>
<tbody>${rows}</tbody>
</table>`)
        + section('bases', p(t('privacy-bases')) + p(t('privacy-bases-why')))
        + section('source', p(t('privacy-source')))
        + section('processors', `<ul class="pv-list"><li>${esc(mail)}</li><li>${esc(t('privacy-processors-host'))}</li></ul>`)
        + section('mod', p(t('privacy-mod')))
        + section('lookup', p(t('privacy-lookup')))
        + section('where', p(cfg.privacyWhere ?? t('privacy-where-none')))
        + section('retention', p(t('privacy-retention', {months})))
        + section('cookie', p(t('privacy-cookie')))
        + section('rights', p(t('privacy-rights'))), {here: '/privacy', wide: true});
}


// ---- routes ----

export function methodNotAllowed(res, allow) {
    send(res, 405, 'text/plain; charset=utf-8', 'method not allowed', {Allow: allow});
}


// The club and the link's hash for a /m/ token that opens a club, else null.
function linkOf(store, tok, now) {
    if (!TOKEN_RE.test(tok)) {
        return null;
    }
    const hash = tokenHash(tok);
    const owner = store.tokenOwner(hash);
    const club = owner ? store.getAny(owner.cid) : null;
    return club && usableLink(club, hash, now) ? {club, hash} : null;
}


async function openClub(req, res, ctx, tok) {
    if (!sameOrigin(req)) {
        refuseCrossSite(res);
        return;
    }
    const form = parseForm(await readBody(req, FORM_BYTES, BODY_MS));
    const {store, cfg, now} = ctx;
    const link = linkOf(store, tok, now);
    if (!link) {
        html(res, 404, badLinkPage());
        return;
    }
    const {club, hash} = link;
    if (club.status === 'pending') {
        let name = club.name;
        if (form.has('name')) {
            const check = checkClubName(store, form.get('name'), club.id);
            if (!check.ok) {
                html(res, check.error === 'name-taken' ? 409 : 400, namePage(tok, form.get('name'), t(check.error)));
                return;
            }
            name = check.name;
        } else if (store.nameTaken(nameKey(name), club.id)) {
            html(res, 409, namePage(tok, name, t('link-name-meanwhile')));
            return;
        }
        if (store.activeCount() >= cfg.maxCircles) {
            html(res, 503, noRoomPage());
            return;
        }
        store.change(club.id, c => {
            c.name = name;
            c.status = 'active';
            c.confirmedAt = iso(now);
            openLink(c, hash, now);
            addLog(c, {at: iso(now), what: 'link-opened'});
        });
    } else if (usableLink(club, hash, now).state === 'pending') {
        store.change(club.id, c => {
            openLink(c, hash, now);
            addLog(c, {at: iso(now), what: 'link-opened'});
        });
    }
    // else the club's active link, opened again (another device): nothing changes. The cookie gets
    // it on top, without the club's older tokens.
    rewriteClubCookie(req, res, ctx, {first: tok, without: club.id});
    redirect(res, '/manage');
}


// The club, the hash and the token record for a /t/ token: a confirm or email token of an active
// club that has not expired. Else null (a club link is no confirmation).
function confirmationOf(store, tok, now) {
    if (!TOKEN_RE.test(tok)) {
        return null;
    }
    const hash = tokenHash(tok);
    const owner = store.tokenOwner(hash);
    const kind = owner?.token.kind;
    const club = kind === 'confirm' || kind === 'email' ? store.get(owner.cid) : null;
    const token = club ? liveToken(club, hash, kind, now) : null;
    return token ? {club, hash, token} : null;
}


// POST /t/<token> (spec §5.1), each token once:
//   confirm/email  the current address agrees: an email token goes to the new address
//   email          the new address confirms itself: it becomes the club's address, and the old one
//                  gets a notice. The old address keeps no power: all confirm and email tokens and
//                  the pending links (mailed there) go; the active link stays.
//   confirm/delete the club goes to the trash (a tombstone first: riders get gone: true at once);
//                  its links end with it, and this browser's cookie loses its token (the other
//                  clubs' tokens stay). When the trash fails, the club stays as it was, the
//                  confirm link included.
async function confirmAction(req, res, ctx, tok) {
    if (!sameOrigin(req)) {
        refuseCrossSite(res);
        return;
    }
    await readBody(req, FORM_BYTES, BODY_MS);
    const {store, cfg, mailer, now} = ctx;
    const found = confirmationOf(store, tok, now);
    if (!found) {
        html(res, 404, badLinkPage());
        return;
    }
    const {club, hash, token} = found;
    const cid = club.id;
    const answer = (status, key, cls = null) =>
        html(res, status, confirmDonePage(club, t(key, {club: club.name}), cls === 'err'));
    const dropConfirmations = c => {
        c.tokens = c.tokens.filter(x => x?.kind !== 'confirm' && x?.kind !== 'email');
    };

    if (token.kind === 'confirm' && token.action === 'email') {
        const tk = newToken();
        const vars = {club: club.name, link: `${cfg.publicUrl}/t/${tk.token}`};
        const sent = storeThenMail(ctx, cid, 'new address', c => {
            takeToken(c, hash, 'confirm', now);
            addEmailToken(c, token.email, now, tk);
        }, () => mailer.send({
            kind: 'new-address', to: token.email, budget: 'other',
            ...mailContent('new-address', vars, cfg),
        }));
        answer(sent ? 200 : 503, sent ? 'confirm-email-sent' : 'confirm-failed', sent ? null : 'err');
        return;
    }

    if (token.kind === 'email') {
        const old = club.email;
        try {
            store.change(cid, c => {
                c.email = token.email;
                dropConfirmations(c);
                c.tokens = c.tokens.filter(x => !(x?.kind === 'link' && x.state === 'pending'));
                addLog(c, {at: iso(now), what: 'address-changed'});
            });
        } catch (e) {
            if (!(e instanceof ClubError) || e.code !== 'too-big') {
                throw e;
            }
            answer(409, 'club-too-big', 'err');
            return;
        }
        answer(200, 'confirm-email-done');
        // the notice carries no token: a refused one changes nothing
        const sent = mailer !== null && mailer.send({
            kind: 'address-changed', to: old, budget: 'other',
            ...mailContent('address-changed', {club: club.name, masked: maskAddress(token.email)}, cfg),
        });
        if (!sent) {
            console.warn(`paceline-server: address change notice for ${cid} not sent`);
        }
        return;
    }

    // confirm/delete: no confirmation goes into the trash (a restore would bring it back)
    const before = {tokens: structuredClone(club.tokens), log: structuredClone(club.log)};
    store.change(cid, c => {
        dropConfirmations(c);
        addLog(c, {at: iso(now), what: 'club-deleted'});
    });
    try {
        store.trash(cid);
    } catch (e) {
        console.error(`paceline-server: delete of ${cid} failed: ${e?.code ?? e?.name ?? 'error'}`);
        try {
            store.change(cid, c => {
                c.tokens = before.tokens;
                c.log = before.log;
            });
        } catch (e2) {
            console.error(`paceline-server: delete of ${cid} not taken back: ${e2?.code ?? e2?.name ?? 'error'}`);
        }
        answer(500, 'confirm-delete-failed', 'err');
        return;
    }
    rewriteClubCookie(req, res, ctx, {without: cid});
    answer(200, 'confirm-deleted');
}


// POST /switch (club=<id>): that club becomes the active one when this browser's cookie opens it
// (its token moves first), then /manage. An id the cookie does not open changes nothing: back to /
// (the open club's /manage, or the start page when none is open).
async function switchClub(req, res, ctx) {
    if (!sameOrigin(req)) {
        refuseCrossSite(res);
        return;
    }
    const form = parseForm(await readBody(req, FORM_BYTES, BODY_MS));
    const id = String(form.get('club') ?? '');
    const entry = cookieClubs(req, ctx).find(c => c.circle === id);
    if (!entry) {
        redirect(res, '/');
        return;
    }
    rewriteClubCookie(req, res, ctx, {first: entry.tok, without: entry.circle});
    redirect(res, '/manage');
}


// POST /logout-all: the club cookie goes with all its clubs.
async function logoutAll(req, res) {
    if (!sameOrigin(req)) {
        refuseCrossSite(res);
        return;
    }
    await readBody(req, FORM_BYTES, BODY_MS);
    clearClubCookie(res);
    redirect(res, '/');
}


async function lost(req, res, ctx) {
    if (!sameOrigin(req)) {
        refuseCrossSite(res);
        return;
    }
    const form = parseForm(await readBody(req, FORM_BYTES, BODY_MS));
    const address = mailAddress(form.get('email')).toLowerCase();
    const allowed = ctx.web.lost.allow(clientIp(req, ctx.cfg.trustedProxyHops), ctx.now);
    // The same answer whether or not a club uses the address, whether or not a mail went out and
    // whether or not this client is over its limit, and it leaves before the per-club work (a store
    // write each), so its time tells nothing either.
    html(res, 200, lostDonePage());
    if (allowed && address) {
        // after the answer: a throw here would end the process, so nothing may escape
        setImmediate(() => {
            try {
                for (const club of ctx.store.active()) {
                    if (String(club.email).toLowerCase() === address) {
                        newLinkByMail(ctx, club);
                    }
                }
            } catch (e) {
                console.error(`paceline-server: lost link: ${e?.code ?? e?.name ?? 'error'}`);
            }
        });
    }
}


// The checks in the order of the plan: same origin, open, the per-address limit, the fields, the
// name. A taken name is reported at once (spec §5.1); everything after that (the address's clubs,
// the pending clubs, the mail) runs after the neutral answer, so neither the answer nor its time
// tells whether an address has clubs.
async function register(req, res, ctx) {
    if (!sameOrigin(req)) {
        refuseCrossSite(res);
        return;
    }
    const form = parseForm(await readBody(req, FORM_BYTES, BODY_MS));
    const {store, cfg, now, web} = ctx;
    if (!registrationOpen(ctx)) {
        html(res, 200, registerClosedPage());
        return;
    }
    const ip = clientIp(req, cfg.trustedProxyHops);
    if (!web.register.allow(ip, now)) {
        html(res, 200, registerDonePage());
        return;
    }
    const typed = {
        name: String(form.get('name') ?? ''), email: String(form.get('email') ?? ''),
        tz: String(form.get('tz') ?? ''), riders: form.has('riders'),
    };
    const email = mailAddress(typed.email);
    const name = checkClubName(store, typed.name);
    let error = null;
    if (!name.ok && name.error === 'name-bad') {
        error = 'name-bad';
    } else if (!isAddress(email)) {
        error = 'register-email-bad';
    } else if (!zoneOk(cfg, typed.tz)) {
        error = 'register-tz-bad';
    } else if (!typed.riders) {
        error = 'register-riders-missing';
    } else if (!name.ok) {
        error = name.error;
    }
    if (error) {
        html(res, error === 'name-taken' ? 409 : 400, registerPage(cfg, {...typed, error: t(error)}));
        return;
    }
    html(res, 200, registerDonePage());
    // after the answer: a throw here would end the process, so nothing may escape
    setImmediate(() => {
        try {
            registerClub(ctx, {name: name.name, email, tz: typed.tz, ip});
        } catch (e) {
            console.error(`paceline-server: register: ${e?.code ?? e?.name ?? 'error'}`);
        }
    });
}


// The routes of this module; false when the path is not one of them. `method` has HEAD as GET.
// ctx: {store, cfg, mailer, now (ms), web (makeWebState(), one per server)}.
export async function handleWeb(req, res, ctx, p, method) {
    if (p === '/') {
        if (method !== 'GET') {
            methodNotAllowed(res, 'GET');
            return true;
        }
        // a browser with a club open goes straight to it; the others are in its captain footer
        if (cookieClubs(req, ctx).length) {
            redirect(res, '/manage');
        } else {
            html(res, 200, homePage());
        }
        return true;
    }
    if (p === '/switch' || p === '/logout-all') {
        if (method === 'POST') {
            await (p === '/switch' ? switchClub(req, res, ctx) : logoutAll(req, res));
        } else {
            methodNotAllowed(res, 'POST');
        }
        return true;
    }
    // the raw path: a token never needs decoding
    const m = /^\/m\/([^/]*)$/.exec(p);
    if (m || p.startsWith('/m/')) {
        const tok = m ? m[1] : '';
        if (method === 'POST') {
            await openClub(req, res, ctx, tok);
        } else if (method === 'GET') {
            const link = linkOf(ctx.store, tok, ctx.now);
            html(res, link ? 200 : 404, link ? openPage(link.club, tok) : badLinkPage());
        } else {
            methodNotAllowed(res, 'GET, POST');
        }
        return true;
    }
    const c = /^\/t\/([^/]*)$/.exec(p);
    if (c || p.startsWith('/t/')) {
        const tok = c ? c[1] : '';
        if (method === 'POST') {
            await confirmAction(req, res, ctx, tok);
        } else if (method === 'GET') {
            const found = confirmationOf(ctx.store, tok, ctx.now);
            html(res, found ? 200 : 404, found ? confirmPage(found.club, tok, found.token) : badLinkPage());
        } else {
            methodNotAllowed(res, 'GET, POST');
        }
        return true;
    }
    if (p === '/lost') {
        if (method === 'POST') {
            await lost(req, res, ctx);
        } else if (method === 'GET') {
            html(res, 200, lostPage());
        } else {
            methodNotAllowed(res, 'GET, POST');
        }
        return true;
    }
    if (p === '/register') {
        if (method === 'POST') {
            await register(req, res, ctx);
        } else if (method === 'GET') {
            html(res, 200, registrationOpen(ctx) ? registerPage(ctx.cfg) : registerClosedPage());
        } else {
            methodNotAllowed(res, 'GET, POST');
        }
        return true;
    }
    if (p === '/privacy') {
        if (method === 'GET') {
            html(res, 200, privacyPage(ctx));
        } else {
            methodNotAllowed(res, 'GET');
        }
        return true;
    }
    return false;
}
