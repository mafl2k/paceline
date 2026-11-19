// The operator page /admin (spec §5.3): HTTP Basic auth with the ADMIN_* login (else UPLOAD_*),
// a throttle on failed logins, the clubs with name, status, created and size, "Show a new link
// once", restore, purge, the registration switch, the database with its last dump, and the last
// mail results. Without a login configured every /admin* path answers 404, like any unknown path.
// Plain forms, no scripts. GETs only look; every change is a POST from this site. A link shown here
// leaves only in that one answer (no-store): never in a URL, a mail of ours (except the restore
// mail to the club), the club log or the server log.
import crypto from 'node:crypto';
import {ClubError, addLog, clubBytes} from './club.mjs';
import {newToken} from './ids.mjs';
import {clientIp, makeLimiter} from './limits.mjs';
import {readBody, BODY_MS, send, html, sameOrigin, parseForm} from './http.mjs';
import {esc, t, page} from './pages.mjs';
import {addLink, endAllLinks} from './tokens.mjs';
import {leftoverFolders, LEFTOVER_DAYS} from './dump.mjs';
import {parseEntry} from './erasures.mjs';
import {FORM_BYTES, refuseCrossSite, methodNotAllowed, mailLink} from './web.mjs';

// Failed logins per client address (spec §8): 10 in 15 min, then 429 until the window has passed.
export const ADMIN_FAILS_MAX = 10;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const REALM = 'Basic realm="Paceline admin", charset="UTF-8"';
const MAIL_RESULTS = 20;
const ACTIONS = new Set(['/admin/link', '/admin/restore', '/admin/purge', '/admin/registration', '/admin/erasures']);

const iso = ms => new Date(ms).toISOString();
// '2026-11-16 09:30' (UTC); '' for a time that does not parse
const minute = s => {
    const ms = typeof s === 'number' ? s : Date.parse(s);
    return Number.isFinite(ms) ? iso(ms).slice(0, 16).replace('T', ' ') : '';
};
const second = ms => (Number.isFinite(ms) ? iso(ms).slice(0, 19).replace('T', ' ') : '');


// The failed logins per client address, in memory only; sweep(now) drops expired counters.
export function makeAdminState() {
    const fails = makeLimiter([{ms: FAIL_WINDOW_MS, max: ADMIN_FAILS_MAX}]);
    return {fails, sweep: now => fails.sweep(now)};
}


const sha = s => crypto.createHash('sha256').update(s, 'utf8').digest();

// Whether the request carries the operator login. Equal-length digests, both compared always (no
// short circuit), so the answer time tells nothing about either part.
function authorized(req, login) {
    const m = /^Basic ([A-Za-z0-9+/=]+)$/.exec(req.headers.authorization || '');
    if (!m) {
        return false;
    }
    const given = Buffer.from(m[1], 'base64').toString('utf8');
    const i = given.indexOf(':');
    const okU = crypto.timingSafeEqual(sha(i < 0 ? given : given.slice(0, i)), sha(login.user));
    const okP = crypto.timingSafeEqual(sha(i < 0 ? '' : given.slice(i + 1)), sha(login.pass));
    return okU && okP && i >= 0;
}


// Correct credentials always pass. Otherwise a request that carries an Authorization header is a
// failed login for its client address: 429 once that address has 10 in 15 min (not counted again),
// else counted and 401. Without the header: 401, not counted (the browser's first request).
function gate(req, res, {cfg, now, admin}) {
    if (authorized(req, cfg.admin)) {
        return true;
    }
    if (req.headers.authorization !== undefined) {
        const ip = clientIp(req, cfg.trustedProxyHops) ?? '';
        if (admin.fails.count(ip, now, FAIL_WINDOW_MS) >= ADMIN_FAILS_MAX) {
            send(res, 429, 'text/plain; charset=utf-8', 'too many failed logins, try again later', {'Retry-After': String(FAIL_WINDOW_MS / 1000)});
            return false;
        }
        admin.fails.add(ip, now);
    }
    send(res, 401, 'text/plain; charset=utf-8', 'login required', {'WWW-Authenticate': REALM});
    return false;
}


const notFound = res => send(res, 404, 'text/plain; charset=utf-8', 'not found');

const para = (s, cls = null) => `<p${cls ? ` class="${cls}"` : ''}>${esc(s)}</p>`;

const back = () => `<p><a href="/admin">${esc(t('admin-back'))}</a></p>`;

const button = (action, fields, label) => `<form method="post" action="${action}">${
    Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join('')
}<button type="submit">${esc(label)}</button></form>`;


// ---- the page ----

function registrationSection({store, cfg, mailer}) {
    const switched = store.serverSettings().registration;
    const state = switched ?? cfg.registration;
    const notes = [];
    if (mailer === null || !cfg.publicUrl) {
        notes.push(para(t('admin-reg-no-mail'), 'warn'));
    }
    if (store.activeCount() >= cfg.maxCircles) {
        notes.push(para(t('admin-reg-full', {n: store.activeCount()}), 'warn'));
    }
    const next = state === 'open' ? 'closed' : 'open';
    return `<h2>${esc(t('admin-reg-heading'))}</h2>
${para(t('admin-reg-state', {state: t(`admin-reg-${state}`), source: t(switched ? 'admin-reg-switch' : 'admin-reg-env')}))}
${notes.join('\n')}${notes.length ? '\n' : ''}${button('/admin/registration', {state: next}, t(next === 'open' ? 'admin-reg-do-open' : 'admin-reg-do-close'))}`;
}


// Active, pending, then trashed clubs. Size: the club's JSON plus its recordings and archived
// versions (a trashed club: its JSON and archived versions as they were when it was trashed).
function clubRows({store, logs}) {
    const rows = [
        ...store.active().map(c => ({c, status: t('admin-status-active'), bytes: clubBytes(c) + logs.circleBytes(c.id), actions: ['link', 'purge']})),
        ...store.pending().map(c => ({c, status: t('admin-status-pending'), bytes: clubBytes(c), actions: ['link', 'purge']})),
        ...store.trashed().map(c => ({c, status: t('admin-status-trashed', {at: minute(c.deletedAt)}), bytes: c.bytes, actions: ['restore', 'purge']})),
    ];
    const label = {link: 'admin-link-button', restore: 'admin-restore-button', purge: 'admin-purge-button'};
    return rows.map(({c, status, bytes, actions}) => `<tr id="club-${esc(c.id)}"><td>${esc(c.name)}</td><td>${esc(status)}</td>`
        + `<td>${esc(minute(c.createdAt))}</td><td class="n">${esc(t('admin-size', {kb: Math.ceil(bytes / 1024)}))}</td>`
        + `<td>${actions.map(a => button(`/admin/${a}`, {cid: c.id}, t(label[a]))).join(' ')}</td></tr>`);
}


function clubsSection(ctx) {
    const rows = clubRows(ctx);
    const head = `<h2>${esc(t('admin-clubs-heading'))}</h2>`;
    if (!rows.length) {
        return `${head}\n${para(t('admin-clubs-none'))}`;
    }
    const th = ['name', 'status', 'created', 'size', 'actions']
        .map(k => `<th${k === 'size' ? ' class="n"' : ''}>${esc(t(`admin-col-${k}`))}</th>`).join('');
    return `${head}\n<table><tr>${th}</tr>\n${rows.join('\n')}\n</table>`;
}


// paceline.db's size and the last nightly dump (dump.mjs), or its failure; a warning for each
// folder an import or a restore by hand left in the data dir.
function databaseSection({dumps, cfg}) {
    const {dbBytes, last, error} = dumps.status();
    const kb = bytes => Math.ceil(bytes / 1024);
    return [
        `<h2>${esc(t('admin-db-heading'))}</h2>`,
        para(t('admin-db-size', {kb: kb(dbBytes)})),
        para(last ? t('admin-dump-last', {date: last.date, kb: kb(last.bytes)}) : t('admin-dump-none')),
        error ? para(t('admin-dump-failed', {at: minute(error.at), error: error.message}), 'warn') : '',
        ...leftoverFolders(cfg.dataDir).map(({name, date}) => para(t('admin-leftover', {name, date, days: LEFTOVER_DAYS}), 'warn')),
    ].filter(Boolean).join('\n');
}


function mailSection({mailer}) {
    const head = `<h2>${esc(t('admin-mail-heading'))}</h2>`;
    if (mailer === null) {
        return `${head}\n${para(t('admin-mail-off'))}`;
    }
    const results = mailer.results().slice(0, MAIL_RESULTS);
    if (!results.length) {
        return `${head}\n${para(t('admin-mail-none'))}`;
    }
    const rows = results.map(r => `<tr><td>${esc(second(r.at))}</td><td>${esc(r.kind)}</td><td>${esc(r.code)}</td></tr>`);
    return `${head}\n${para(t('admin-mail-intro', {n: MAIL_RESULTS}))}
<table><tr><th>${esc(t('admin-col-time'))}</th><th>${esc(t('admin-col-kind'))}</th><th>${esc(t('admin-col-code'))}</th></tr>
${rows.join('\n')}
</table>`;
}


// After a full restore of the data folder: the lines of the operator mails of every removal since
// the backup (erasures.mjs). The form takes FORM_BYTES (64 KB, about 500 lines) at a time.
function erasuresSection() {
    return `<h2>${esc(t('admin-erasures-heading'))}</h2>
${para(t('admin-erasures-intro'))}
<form method="post" action="/admin/erasures"><label>${esc(t('admin-erasures-label'))}<br><textarea name="lines" rows="6" cols="80" spellcheck="false"></textarea></label>
<button type="submit">${esc(t('admin-erasures-button'))}</button></form>`;
}


// The operator page; `flash` = {text, cls} on top after an action.
function adminPage(req, res, ctx, {status = 200, flash = null} = {}) {
    const ip = clientIp(req, ctx.cfg.trustedProxyHops) ?? '';
    html(res, status, page(t('admin-heading'), [
        flash ? para(flash.text, flash.cls) : '',
        para(t('admin-ip', {ip})),
        registrationSection(ctx),
        clubsSection(ctx),
        databaseSection(ctx),
        erasuresSection(),
        mailSection(ctx),
    ].filter(Boolean).join('\n')));
}


// The page that shows a link once: `notes` (plain text, each with its class) above it.
function linkPage(res, ctx, club, token, notes) {
    const link = `${ctx.cfg.publicUrl ?? ''}/m/${token}`;
    html(res, 200, page(t('admin-link-heading', {club: club.name}),
        `${notes.map(([s, cls]) => para(s, cls)).join('\n')}
<p><code>${esc(link)}</code></p>
${back()}`));
}


// ---- actions ----

// Any active or pending club: a new pending link (at most 3 pending, the oldest goes), shown on this
// answer only. No mail, so it works when mail is down.
function showLink(req, res, ctx, cid) {
    const {store, now} = ctx;
    const club = store.getAny(cid);
    if (!club) {
        adminPage(req, res, ctx, {status: 404, flash: {text: t('admin-not-found'), cls: 'err'}});
        return;
    }
    const tk = newToken();
    try {
        store.change(cid, c => {
            addLink(c, now, tk);
            addLog(c, {at: iso(now), what: 'admin-link'});
        });
    } catch (e) {
        if (!(e instanceof ClubError) || e.code !== 'too-big') {
            throw e;
        }
        adminPage(req, res, ctx, {status: 409, flash: {text: t('club-too-big'), cls: 'err'}});
        return;
    }
    console.log(`paceline-server: admin: new link for ${cid}`);
    linkPage(res, ctx, club, tk.token, [[t('admin-link-once'), 'warn']]);
}


// A trashed club comes back. Every link, confirm and email token ends; one new pending link is
// shown here and mailed to the club. When the store refuses (a damaged row, a database error), the
// page says why.
function restore(req, res, ctx, cid) {
    const {store, now} = ctx;
    const meta = store.trashed().find(x => x.id === cid);
    if (!meta) {
        adminPage(req, res, ctx, {status: 404, flash: {text: t('admin-not-found'), cls: 'err'}});
        return;
    }
    // The link reset is part of the restore's one write: a club never comes back with its old links.
    const tk = newToken();
    try {
        store.restore(cid, c => {
            endAllLinks(c);
            c.tokens = c.tokens.filter(x => x?.kind !== 'confirm' && x?.kind !== 'email');
            addLink(c, now, tk);
            addLog(c, {at: iso(now), what: 'club-restored'});
        });
    } catch (e) {
        if (e instanceof ClubError && e.code === 'too-big') {
            adminPage(req, res, ctx, {status: 409, flash: {text: t('club-too-big'), cls: 'err'}});
            return;
        }
        if (e instanceof ClubError) {
            adminPage(req, res, ctx, {status: 404, flash: {text: t('admin-not-found'), cls: 'err'}});
            return;
        }
        console.error(`paceline-server: admin: restore of ${cid} failed: ${e.message}`);
        adminPage(req, res, ctx, {status: 409, flash: {text: t('admin-restore-failed', {club: meta.name, error: e.message}), cls: 'err'}});
        return;
    }
    const club = store.get(cid);
    // removals that waited for this club in the trash (erasures.mjs): its data now, its recordings next
    ctx.erasures.applyPending({cid}).catch(e => {
        console.error(`paceline-server: admin: removals of ${cid} not applied: ${e?.code ?? e?.name ?? 'error'}`);
    });
    let mailed = false;
    try {
        mailed = mailLink(ctx, club, tk);
    } catch (e) {
        console.error(`paceline-server: admin: restore mail for ${cid}: ${e?.code ?? e?.name ?? 'error'}`);
    }
    console.log(`paceline-server: admin: ${cid} restored`);
    linkPage(res, ctx, club, tk.token, [
        [t('admin-restored', {club: club.name}), 'ok'],
        mailed ? [t('admin-restored-mailed'), null] : [t('admin-restored-not-mailed'), 'warn'],
        [t('admin-link-once'), 'warn'],
    ]);
}


// An active, pending or trashed club goes for good, after a page that asks (confirm=1). An active
// one leaves a tombstone (riders get gone: true); a trashed one has it already; a pending one was
// never shown to riders (purging it frees a squatted name or pending place at once).
function purge(req, res, ctx, cid, confirmed) {
    const {store} = ctx;
    const club = store.getAny(cid);
    const name = club?.name ?? store.trashed().find(x => x.id === cid)?.name;
    if (name === undefined) {
        adminPage(req, res, ctx, {status: 404, flash: {text: t('admin-not-found'), cls: 'err'}});
        return;
    }
    if (!confirmed) {
        html(res, 200, page(t('admin-purge-heading', {club: name}), `${para(t('admin-purge-intro'))}
${button('/admin/purge', {cid, confirm: '1'}, t('admin-purge-confirm'))}
${back()}`));
        return;
    }
    if (club?.status === 'pending') {
        store.removePending(cid);
    } else {
        store.purge(cid);
    }
    console.log(`paceline-server: admin: ${cid} purged`);
    adminPage(req, res, ctx, {flash: {text: t('admin-purged', {club: name}), cls: 'ok'}});
}


// POST /admin/erasures (lines): each line that is a removal entry and not on the erasure list yet is
// appended there and applied to the data stored before its time (erasures.mjs); a line for a club
// this server does not have is kept (a later restore of that club needs it). The answer counts the
// new, the known and the lines that are none, the new ones for unknown clubs, and what failed (tried
// again at the next start). Nothing is logged but the counts: the lines hold Zwift IDs.
async function reapply(req, res, ctx, text) {
    const {store, erasures} = ctx;
    if (erasures.list.broken() !== null) {
        adminPage(req, res, ctx, {status: 503, flash: {text: t('admin-erasures-broken'), cls: 'err'}});
        return;
    }
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let invalid = 0, known = 0, unknown = 0, failed = 0;
    const fresh = [];
    // a little clock skew allowed; a time to come would erase him from all stored until then
    const notAfter = ctx.now + 5 * 60000;
    for (const line of lines) {
        const e = parseEntry(line, {notAfter});
        if (e === null) {
            invalid++;
        } else if (!erasures.list.append(e)) {
            known++;
        } else {
            fresh.push(e);
            if (!store.getAny(e.cid) && !store.trashed().some(x => x.id === e.cid)) {
                unknown++;
            }
        }
    }
    if (fresh.length) {
        const sum = await erasures.applyAll(fresh);
        failed = sum.failed + sum.unreadable + sum.waiting;
    }
    console.log(`paceline-server: admin: removals to re-apply: ${fresh.length} new, ${known} known, ${invalid} not readable`);
    const notes = [t('admin-erasures-done', {fresh: fresh.length, known, invalid})];
    if (unknown) {
        notes.push(t('admin-erasures-unknown', {n: unknown}));
    }
    if (failed) {
        notes.push(t('admin-erasures-failed', {n: failed}));
    }
    adminPage(req, res, ctx, {status: lines.length && invalid === lines.length ? 400 : 200,
                              flash: {text: notes.join(' '), cls: invalid || failed ? 'warn' : 'ok'}});
}


function registration(req, res, ctx, state) {
    if (state !== 'open' && state !== 'closed') {
        adminPage(req, res, ctx, {status: 400, flash: {text: t('admin-reg-bad'), cls: 'err'}});
        return;
    }
    ctx.store.setRegistration(state);
    console.log(`paceline-server: admin: registration ${state}`);
    adminPage(req, res, ctx, {flash: {text: t('admin-saved'), cls: 'ok'}});
}


// The routes of this module; false when the path is not one of them. `method` has HEAD as GET.
// ctx: {store, cfg, mailer, now (ms), logs, admin (makeAdminState(), one per server), dumps (the
// dump job, makeDumpJob())}.
export async function handleAdmin(req, res, ctx, p, method) {
    if (p !== '/admin' && !p.startsWith('/admin/')) {
        return false;
    }
    if (!ctx.cfg.admin) {
        notFound(res);
        return true;
    }
    if (!gate(req, res, ctx)) {
        return true;
    }
    if (p === '/admin') {
        if (method === 'GET') {
            adminPage(req, res, ctx);
        } else {
            methodNotAllowed(res, 'GET');
        }
        return true;
    }
    if (!ACTIONS.has(p)) {
        notFound(res);
        return true;
    }
    if (method !== 'POST') {
        methodNotAllowed(res, 'POST');
        return true;
    }
    if (!sameOrigin(req)) {
        refuseCrossSite(res);
        return true;
    }
    const form = parseForm(await readBody(req, FORM_BYTES, BODY_MS));
    const cid = String(form.get('cid') ?? '');
    if (p === '/admin/link') {
        showLink(req, res, ctx, cid);
    } else if (p === '/admin/restore') {
        restore(req, res, ctx, cid);
    } else if (p === '/admin/purge') {
        purge(req, res, ctx, cid, form.get('confirm') === '1');
    } else if (p === '/admin/erasures') {
        await reapply(req, res, ctx, String(form.get('lines') ?? ''));
    } else {
        registration(req, res, ctx, String(form.get('state') ?? ''));
    }
    return true;
}
