// The captain pages' shared parts. appPage() is the frame of every page: the one stylesheet and the
// one module script (static.mjs), the skip link, the note that the page needs the script (a
// <noscript>: only Make live works without it, plan versions spec decision 13), and the 30 s refresh
// (a <noscript> meta; client.mjs reloads with a script). captainPage() is the captain pages' frame
// inside it: the top bar for phones and the sidebar from 1024 px. The fragments: the team rows, the
// one-shot flash after an action (flash.mjs), hidden fields and one-button forms, the severity line,
// the "Updated" line with its stale banner, the back bar, the footer and the DST banner; the
// signed-out page, and publicPage(), the public pages' frame. Copy comes from pages.mjs T; every
// value goes through esc().
import {esc, t, T} from './pages.mjs';
import {cssHref, jsHref} from './static.mjs';
import {ic} from './icons.mjs';
import {teamView, teamRow, teamOrder} from './team-view.mjs';

export {andList, quote} from './team-view.mjs';


// `refresh` is the page's own GET path when it should reload, `updated` its 'HH:MM'.
// `needsScript` false leaves out the note that the page needs the script: pages that work without it
// (the Make live and Back confirm pages, the rider code, the gone and signed-out pages).
// `script` false leaves out the script itself: the public pages (publicPage) carry none.
// `cid` (a captain page: the club it shows) names the club in every form that posts to /manage
// (withClub).
export function appPage({body, cls = '', refresh = null, updated = null, needsScript = true, script = true, cid = null}) {
    if (cid !== null) {
        body = withClub(body, cid);
    }
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f3f4f7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0e1116" media="(prefers-color-scheme: dark)">
<title>Paceline</title>
<link rel="stylesheet" href="${cssHref}">
${script ? `<script type="module" src="${jsHref}"></script>\n` : ''}${refresh ? `<noscript><meta http-equiv="refresh" content="30;url=${esc(refresh)}"></noscript>\n` : ''}</head>
<body class="${esc(cls)}"${refresh ? ' data-refresh="30"' : ''}${updated ? ` data-updated="${esc(updated)}"` : ''}>
<a class="skip" href="#main">Skip to content</a>
${needsScript ? `<noscript><div class="nojs"><p class="banner warn" role="note">${ic('alert')}<span>${esc(t('ui-needs-js'))}</span></p></div></noscript>\n` : ''}${body}
</body>
</html>
`;
}


// The captain pages' frame, the same on every /manage page (desktop UI audit, 18 Nov 2026): `bar`
// (the top bar for phones: the team switcher or a back bar; from 1024 px the switcher is hidden,
// where the sidebar navigates, and a back bar is a link line above the page's head), the sidebar (from 1024 px; hidden on phones) and `main`, the page's <main>, beside it.
// The sidebar has the club name (the way to the overview), the team rows, and at its bottom the
// footer (the other clubs of this browser, Privacy, Log out). Club settings is no place in it: the
// overview's button and the team settings' hint lead there. `here` is the path the sidebar marks as
// the current place: '/manage' (the overview and the pages below it that belong to no team), a
// team's '/manage/team/<slug>' (its page and every page below it), or another path such as
// '/manage/settings' (the club settings and the rider code), which marks nothing. `now`, `seen`
// (store.seenOf(cid)) and `others` (the other clubs the cookie opens, [{id, name}]) are what the
// sidebar draws with: manage-page.mjs frameOf gives all three; `rows` (teamRows) when the page has
// drawn them already. The rest goes to appPage.
export function captainPage(club, {now, seen = {}, others = [], here = null, bar = '', main, rows = null, ...page}) {
    if (!Number.isFinite(now)) {
        throw new TypeError('captainPage needs the clock');
    }
    const body = `<div class="app">
${bar ? `${bar}
` : ''}${sideHtml(club, rows ?? teamRows(club, {now, seen}), here, others)}
${main}
</div>`;
    return appPage({...page, body, cid: club.id});
}


// The team rows of the switcher and the sidebar, one per team in teamOrder; `view` (a page's own
// teamView) stands in for its team instead of drawing it again.
export function teamRows(club, {now, seen = {}}, view = null) {
    return teamOrder(club, now).map(s => teamRow(view !== null && s === view.slug ? view : teamView(club, s, {now, seen})));
}


// The team rows as links, the one of team `current` (a slug) marked as the page.
export function rowsHtml(rows, current) {
    return rows.map(r => `<li><a class="trow ${esc(r.sev)}" href="/manage/team/${esc(r.slug)}"${r.slug === current ? ' aria-current="page"' : ''}>`
        + `${ic(r.icon)}<span class="trow-name">${esc(r.name)}</span><span class="trow-time">${esc(r.timeLine)}</span>`
        + `<span class="trow-main">${esc(r.main)}</span></a></li>`).join('\n');
}


const TEAM_HERE = /^\/manage\/team\/([^/]+)$/;

function sideHtml(club, rows, here, others) {
    const home = here === '/manage';
    const team = TEAM_HERE.exec(here ?? '')?.[1] ?? null;
    return `<aside class="side" aria-label="${esc(t('tp-side'))}">
  <p class="side-club"><a href="/manage"${home ? ' aria-current="page"' : ''}>${home ? '' : ic('left')}${esc(club.name)}</a></p>
  <ul class="trows">
${rowsHtml(rows, team)}
  </ul>
  ${footer({club: club.name, others})}
</aside>`;
}


// Every form of `html` that posts to /manage gets a hidden club=<cid> as its first field: the server
// acts only when that is the club this browser has open (manage.mjs postedClub), so a page left
// open from another club, or from a club whose link has ended, changes nothing. One place for all
// forms (postForm, the hand-written ones, the multipart upload, Log out), so none can miss it.
const MANAGE_FORM_RE = /<form\b(?=[^>]*\bmethod="post")(?=[^>]*\baction="\/manage(?:[/?][^"]*)?")[^>]*>/g;

export function withClub(html, cid) {
    const field = `<input type="hidden" name="club" value="${esc(cid)}">`;
    return html.replace(MANAGE_FORM_RE, tag => tag + field);
}


// t() for HTML: the copy's own text escaped, each var inserted as it is, so the caller passes
// HTML (escaped values, or markup such as a <time>).
export function th(key, vars = {}) {
    t(key);
    return T[key].split(/(\{\w+\})/).map(part => {
        const m = /^\{(\w+)\}$/.exec(part);
        return m && Object.hasOwn(vars, m[1]) ? String(vars[m[1]]) : esc(part);
    }).join('');
}


// The flash {kind: 'ok' | 'err', text} at the top of a page; '' for none.
export function flashBlock(flash) {
    if (!flash) {
        return '';
    }
    const ok = flash.kind === 'ok';
    return `<div class="flash ${ok ? 'ok' : 'err'}" role="status">${ic(ok ? 'checkCircle' : 'alert')}<p>${esc(flash.text)}</p></div>`;
}


export const hidden = fields => Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');


// A form of hidden fields and one button with the text `button`; `cls` '' gives a bare button
// (the old club page), `icon` an icon before the text.
export function postForm(action, fields, button, {cls = 'btn secondary small', icon = null} = {}) {
    return `<form method="post" action="${esc(action)}">${hidden(fields)}<button${cls ? ` class="${esc(cls)}"` : ''} type="submit">`
        + `${icon ? ic(icon) : ''}${esc(button)}</button></form>`;
}


// A status line: the severity's colour, an icon and the text; `tag` 'span' inside a link.
export function sevLine(sev, icon, text, cls = '', tag = 'p') {
    return `<${tag} class="sevline ${esc(sev)}${cls ? ` ${esc(cls)}` : ''}">${ic(icon)}<span>${esc(text)}</span></${tag}>`;
}


// "Updated 19:12", and the stale banner the script shows when its reload check fails (shipped
// hidden; the data-why-* texts are its reasons, `path` is the page to try again).
export function freshLine(updated, path) {
    const time = attr => `<time ${attr}>${esc(updated)}</time>`;
    return `<p class="fresh"><span class="dot" aria-hidden="true"></span><span>${th('ui-updated', {time: time('data-updated')})}</span></p>
  <p class="stale-banner" role="status" data-stale hidden data-why-offline="${esc(t('ui-stale-offline'))}" data-why-signedout="${esc(t('ui-stale-signedout'))}" data-why-error="${esc(t('ui-stale-error'))}">`
        + `${ic('offline')}<span><strong>${th('ui-stale-since', {time: time('data-stale-since')})}</strong> <span data-stale-why></span></span>`
        + `<a class="btn secondary small" href="${esc(path)}" data-reload>${esc(t('ui-try-again'))}</a></p>`;
}


// The top bar of a page below another: back to `href`, labelled `text`, and the name of the club
// `club` on the right (left out when `text` is that name), so every captain page says which club
// it shows. From 1024 px only the link shows, above the page's head (the sidebar names the club).
export function backBar(href, text, club = null) {
    const name = club !== null && club !== text ? `<span class="topbar-club">${esc(club)}</span>` : '';
    return `<nav class="topbar plain" aria-label="${esc(t('ui-back'))}">
  <div class="topbar-row"><a class="back" href="${esc(href)}">${ic('left')}${esc(text)}</a>${name}</div>
</nav>`;
}


// The captain pages' footer of club `club` (its name). `others` (the other clubs this browser's
// cookie opens, [{id, name}] in its order) come first, each a one-button POST /switch with its club
// id (never a token in the page); with them Log out names the club (only that club goes) and "Log
// out of all clubs" follows (a shared computer).
export function footer({club = '', others = []} = {}) {
    const multi = others.length > 0;
    // the other clubs as their own group, set apart from Privacy and Log out
    const sw = multi ? `<div class="foot-clubs" role="group" aria-label="${esc(t('manage-other-clubs'))}"><p class="foot-label" aria-hidden="true">${esc(t('manage-other-clubs'))}</p>
    ${others.map(c => postForm('/switch', {club: c.id}, c.name, {cls: '', icon: 'users'})).join('\n    ')}</div>
    ` : '';
    const out = multi ? t('manage-logout-club', {club}) : t('manage-logout');
    const all = multi ? `
    <form method="post" action="/logout-all"><button type="submit">${ic('logout')}${esc(t('home-logout-all'))}</button></form>` : '';
    return `<footer class="foot">
    ${sw}<a href="/privacy">${esc(t('home-privacy'))}</a>
    <form method="post" action="/manage/logout"><button type="submit">${ic('logout')}${esc(out)}</button></form>${all}
  </footer>`;
}


// The note after a DST switch (dstChangedRecently): start times may be fixed in UTC.
export function dstBanner() {
    return `<p class="banner warn" role="note">${ic('clock')}<span>${esc(t('manage-dst'))}</span></p>`;
}


// The public pages' frame (the start page, register, lost link, the /m/ and /t/ pages, privacy):
// appPage without the script, `main` (the page's content) in the narrow column, or with `wide` in
// the wide one (.page.wide, 62rem from 1024 px: the privacy page's table), and a footer with the
// start page and the privacy page; `here` is the page's own path, left out of the footer. Copy and
// every value go through esc() in the caller.
export function publicPage(main, {here = null, wide = false} = {}) {
    const links = [['/', t('home-heading')], ['/privacy', t('home-privacy')]]
        .filter(([href]) => href !== here)
        .map(([href, text]) => `<a href="${href}">${esc(text)}</a>`);
    const body = `<main class="page ${wide ? 'wide' : 'narrow'}" id="main">
  ${main}
  <footer class="foot">${links.join('')}</footer>
</main>`;
    return appPage({body, cls: 'public', needsScript: false, script: false});
}


// 403 for a /manage* POST without a working club cookie (web.mjs noLonger): the way to a new link.
export function signedOutPage() {
    const body = `<main class="page narrow" id="main">
  <section class="card empty">
    ${ic('lock', 'big')}
    <h1>${esc(t('so-heading'))}</h1>
    <p>${esc(t('manage-no-longer'))} ${esc(t('so-why'))}</p>
    <a class="btn primary block" href="/lost">${ic('mail')}${esc(t('so-new-link'))}</a>
  </section>
</main>`;
    return appPage({body, cls: 'formpage', needsScript: false});
}
