// The captain pages' shared parts. appPage() is the frame of every page: the one stylesheet and the
// one module script (static.mjs), the skip link, the note that the page needs the script (a
// <noscript>: Make live and the actions that ask first work without it), and the 30 s refresh
// (a <noscript> meta; client.mjs reloads with a script). captainPage() is the captain pages' frame
// inside it: the top bar for phones and the sidebar from 1024 px. The fragments: the team rows, the
// one-shot flash after an action (flash.mjs), hidden fields and one-button forms, the severity line,
// the "Updated" line with its stale banner, the back bar, the footer and the DST banner; the
// signed-out page, and publicPage(), the public pages' frame. Copy comes from pages.mjs T; every
// value goes through esc().
import {esc, t, T} from './pages.mjs';
import {cssHref, jsHref, iconLinks} from './static.mjs';
import {ic} from './icons.mjs';
import {teamView, teamRow, teamOrder} from './team-view.mjs';

export {andList, quote} from './team-view.mjs';


// `refresh` is the page's own GET path when it should reload, every `refreshS` seconds (30 by
// default); `noscript` false leaves out the <noscript> meta refresh, which would reload without the
// script's guard (the upload page: a chosen file would be lost). `updated` is the page's 'HH:MM'.
// `needsScript` false leaves out the note that the page needs the script: pages that work without it
// (the Make live and other confirm pages, the rider code, the gone and signed-out pages); a string is
// the t() key of a note of the page's own (the team page's says what works without it).
// `script` false leaves out the script itself: the public pages (publicPage) carry none.
// `cid` (a captain page: the club it shows) names the club in every form that posts to /manage
// (withClub).
export function appPage({body, cls = '', refresh = null, refreshS = 30, noscript = true, updated = null, needsScript = true, script = true, cid = null}) {
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
${iconLinks}
<link rel="stylesheet" href="${cssHref}">
${script ? `<script type="module" src="${jsHref}"></script>\n` : ''}${refresh && noscript ? `<noscript><meta http-equiv="refresh" content="${refreshS};url=${esc(refresh)}"></noscript>\n` : ''}</head>
<body class="${esc(cls)}"${refresh ? ` data-refresh="${refreshS}"` : ''}${updated ? ` data-updated="${esc(updated)}"` : ''}>
<a class="skip" href="#main">Skip to content</a>
${needsScript ? `<noscript><div class="nojs"><p class="banner warn" role="note">${ic('alert')}<span>${esc(t(needsScript === true ? 'ui-needs-js' : needsScript))}</span></p></div></noscript>\n` : ''}${body}
</body>
</html>
`;
}


// The captain pages' frame, the same on every /manage page (desktop UI audit, 18 Nov 2026): `bar`
// (the top bar for phones: the team switcher or a back bar; from 1024 px both are hidden, where the
// sidebar navigates and the page's breadcrumb, placeNav, says where it is), the sidebar (from 1024
// px; hidden on phones) and `main`, the page's <main>, beside it.
// The sidebar has the club name (the way to the overview), the team rows, and at its bottom the
// footer (the other clubs of this browser, Privacy, Log out). Club settings is no place in it: the
// overview's button and the team settings' hint lead there. `here` is the path the sidebar marks as
// the current place: '/manage' (the overview and the pages below it that belong to no team), a
// team's '/manage/team/<slug>' (its page and every page below it), or another path such as
// '/manage/settings' (the club settings and the rider code), which marks nothing. `now`, `seen`
// (store.seenOf(cid)) and `others` (the other clubs the cookie opens, [{id, name}]) are what the
// sidebar draws with: manage-page.mjs frameOf gives all three; `rows` (teamRows) when the page has
// drawn them already. The rest goes to appPage.
export function captainPage(club, {now, seen = {}, others = [], here = null, herePage = false, bar = '', main, rows = null, ...page}) {
    if (!Number.isFinite(now)) {
        throw new TypeError('captainPage needs the clock');
    }
    const body = `<div class="app">
${bar ? `${bar}
` : ''}${sideHtml(club, rows ?? teamRows(club, {now, seen}), here, others, herePage)}
${main}
</div>`;
    return appPage({...page, body, cid: club.id});
}


// The team rows of the switcher and the sidebar, one per team in teamOrder; `view` (a page's own
// teamView) stands in for its team instead of drawing it again.
export function teamRows(club, {now, seen = {}}, view = null) {
    return teamOrder(club, now).map(s => teamRow(view !== null && s === view.slug ? view : teamView(club, s, {now, seen})));
}


// The team rows as links, the one of team `current` (a slug) marked: as the page (`mark` 'page'), or
// as where the page is ('location': a page below the team's, whose breadcrumb holds the page itself).
export function rowsHtml(rows, current, mark = 'page') {
    return rows.map(r => `<li><a class="trow ${esc(r.sev)}" href="/manage/team/${esc(r.slug)}"${r.slug === current ? ` aria-current="${mark}"` : ''}>`
        + `${ic(r.icon)}<span class="trow-name">${esc(r.name)}${r.received ? ` <span class="newplans">${esc(r.received)}</span>` : ''}</span><span class="trow-time">${esc(r.timeLine)}</span>`
        + `<span class="trow-main">${esc(r.main)}</span></a></li>`).join('\n');
}


const TEAM_HERE = /^\/manage\/team\/([^/]+)$/;

function sideHtml(club, rows, here, others, herePage) {
    const home = here === '/manage';
    const team = TEAM_HERE.exec(here ?? '')?.[1] ?? null;
    // the place itself (the hub, a team page) is the page; a page below it is only there
    const mark = herePage ? 'page' : 'location';
    return `<aside class="side" aria-label="${esc(t('tp-side'))}">
  <p class="side-club"><a href="/manage"${home ? ` aria-current="${mark}"` : ''}>${home && herePage ? '' : ic('left')}${esc(club.name)}</a></p>
  <ul class="trows">
${rowsHtml(rows, team, mark)}
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
    if (flash.kind !== 'ok') {
        return `<div class="flash err" role="status">${ic('alert')}<p>${esc(flash.text)}</p></div>`;
    }
    return `<div class="flash ok" role="status">${ic('checkCircle')}<p>${esc(flash.text)}</p></div>`;
}


export const hidden = fields => Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');


// A form of hidden fields and one button with the text `button`; `cls` '' gives a bare button
// (the old club page), `icon` an icon before the text, `sr` words after it for screen readers.
export function postForm(action, fields, button, {cls = 'btn secondary small', icon = null, sr = null} = {}) {
    return `<form method="post" action="${esc(action)}">${hidden(fields)}<button${cls ? ` class="${esc(cls)}"` : ''} type="submit">`
        + `${icon ? ic(icon) : ''}${esc(button)}${sr ? `<span class="sr"> ${esc(sr)}</span>` : ''}</button></form>`;
}


// A one-button POST that asks first in its own place (UI panel wave 2, "arm in place"; it replaces
// the <details> confirms). The form posts `fields` to `action` and has two submit buttons: the
// trigger `button` (class `cls`, an `icon` before it, `sr` after it for screen readers) without
// confirm, and the strip's confirm button `yes` (class `yesCls`: 'btn primary', or 'btn danger' for
// a destructive action) with confirm=1, which the server needs to act. Without the script the strip
// stays hidden and the trigger posts: the server answers with its confirm page. With it (client.mjs
// arms) the trigger's press turns the form, in its place, into the strip: `words` (what it does, the
// button's description; `wordsHtml` instead: markup, every value escaped by the caller), the confirm
// button and Cancel, as a group labelled with the action. `key` makes the ids unique on the page.
// `when` ({when: 'empty' | 'changed', field}) arms only while that field of the form is empty or
// changed (a start time cleared, another zone); else the trigger posts. `body` (markup: the form's
// own fields) goes before the trigger, `formCls` is the form's class.
export function armForm(action, fields, {key, button, cls = 'btn secondary small', icon = null, sr = null, words = '', wordsHtml = null,
    yes, yesCls = 'btn primary', body = '', formCls = '', when = null}) {
    const id = `arm-${key}`;
    const cond = when === null ? '' : ` data-arm-when="${esc(when.when)}" data-arm-field="${esc(when.field)}"`;
    return `<form${formCls ? ` class="${esc(formCls)}"` : ''} method="post" action="${esc(action)}" data-arm${cond}>${hidden(fields)}${body}`
        + `<button class="${esc(cls)}" type="submit" data-arm-open>${icon ? ic(icon) : ''}${esc(button)}${sr ? `<span class="sr"> ${esc(sr)}</span>` : ''}</button>`
        + `<div class="arm-strip" role="group" aria-label="${esc(t('arm-label', {action: yes}))}" data-arm-strip hidden>`
        + `<p id="${esc(id)}">${wordsHtml ?? esc(words)}</p><div class="arm-btns">`
        + `<button class="${esc(yesCls)}" type="submit" name="confirm" value="1" aria-describedby="${esc(id)}" data-arm-yes>${esc(yes)}</button>`
        + `<button class="btn secondary" type="button" data-arm-cancel>${esc(t('arm-cancel'))}</button></div></div></form>`;
}


// A ⋯ menu (races spec §4: the race's and the plan's): a <details> whose summary is a quiet ⋯ button
// named `label` for screen readers and voice control, its panel the `items` (markup; empty ones are
// left out) under it; '' without items. `key` makes its id unique on the page (menu-<key>). It
// holds forms, so an open one holds the page's reload (no data-keep-refresh, client.mjs holdsReload);
// with the script Esc and a click outside close it, and opening one closes the others (client.mjs
// menus). Without the script it opens and closes as any <details>.
export function menu(label, items, {key}) {
    const list = items.filter(Boolean);
    if (!list.length) {
        return '';
    }
    return `<details class="menu" data-menu id="menu-${esc(key)}"><summary class="btn quiet small" aria-label="${esc(label)}">${ic('dots')}</summary>`
        + `<div class="menu-panel">${list.join('')}</div></details>`;
}


// The page that asks before an action posted without confirm=1 (the no-script path of an
// armForm, UI panel wave 2): `heading`, `words` (what it does), a form that posts `fields` to
// `action` again with confirm=1, its button `button` (`danger`: the danger style, else primary) and
// the way back (`back` {href, label}). `kicker` names the club (and team) on phones; from 1024 px the
// breadcrumb does: `trail` (placeNav's, without the page's own crumb) ends at the page `back` goes to,
// then "Confirm". It needs no script and never reloads itself. `frame`: captainPage's (now, seen,
// others, here).
export function confirmPage(club, {kicker, trail, heading, words, action, fields, button, danger = true, back, ...frame}) {
    const {crumbs} = placeNav(club, [...trail, {label: t('crumb-confirm')}], {back: false});
    const main = `<main class="page" id="main">
  ${crumbs}
  <header class="pagehead"><p class="kicker">${esc(kicker)}</p><h1>${esc(heading)}</h1></header>
  <section class="card stack">
    <p>${esc(words)}</p>
    <div class="confirm-acts">${postForm(action, {...fields, confirm: '1'}, button, {cls: danger ? 'btn danger' : 'btn primary'})}
    <a class="btn secondary" href="${esc(back.href)}">${ic('left')}${esc(back.label)}</a></div>
  </section>
</main>`;
    return captainPage(club, {...frame, main, cls: 'formpage', needsScript: false});
}


// A status line: the severity's colour, an icon and the text; `tag` 'span' inside a link.
// The rest of a hint in a closed fold under it (user, 23 Nov 2026: a hint is one line): "More", for
// screen readers "More about <topic>". `about` the words after "More" ("about Remove a rider").
export const moreFold = (text, about) => `<details class="fold more"><summary>${esc(t('ui-more'))}<span class="sr"> ${esc(about)}</span></summary>`
    + `<p class="hint">${esc(text)}</p></details>`;


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


// The top bar of a page below another (phones): back to `href`, labelled `text`, and the name of the
// club `club` on the right (left out when `text` is that name), so every captain page says which club
// it shows. From 1024 px it gives way to the breadcrumb (placeNav, which draws both).
export function backBar(href, text, club = null) {
    const name = club !== null && club !== text ? `<span class="topbar-club">${esc(club)}</span>` : '';
    return `<nav class="topbar plain" aria-label="${esc(t('ui-back'))}">
  <div class="topbar-row"><a class="back" href="${esc(href)}">${ic('left')}${esc(text)}</a>${name}</div>
</nav>`;
}


// The place of a captain page below the overview (UI panel wave 3), one source for both widths:
// `trail` is the way from the club to the page, [{href, label}, …, {label}], the last item the page
// itself (no link). From 1024 px it is one breadcrumb line ("Kettenfett RC › Rollers › Upload"),
// which replaces the back link line and the kicker there; on phones the back bar goes to the crumb
// before the page, so the two always agree, labelled as that crumb; only the way to the hub reads
// "All teams" (one label for that way on every phone bar and button; the club's name is its crumb).
// `back` false leaves out the back bar (a page that has none on phones: the questions without the
// script, the rider code). {bar, crumbs}: the back bar
// for captainPage's `bar` ('' without one) and the breadcrumb for the top of the page's <main>.
export function placeNav(club, trail, {back = true} = {}) {
    const crumbs = [{href: '/manage', label: club.name}, ...trail];
    const last = crumbs.length - 1;
    const parent = crumbs[last - 1];
    const items = crumbs.map((c, i) => (i === last ? `<li><span aria-current="page">${esc(c.label)}</span></li>`
        : `<li><a href="${esc(c.href)}">${esc(c.label)}</a><span class="sep" aria-hidden="true">›</span></li>`));
    return {
        bar: back ? backBar(parent.href, parent.href === '/manage' ? t('tp-all-teams') : parent.label, club.name) : '',
        crumbs: `<nav class="crumbs desk" aria-label="${esc(t('ui-breadcrumb'))}"><ol>${items.join('')}</ol></nav>`,
    };
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
// every value go through esc() in the caller. `bar` (backBar's markup, or '') goes above the page: the
// privacy page's way back to /manage for a signed-in captain.
export function publicPage(main, {here = null, wide = false, bar = ''} = {}) {
    const links = [['/', t('home-heading')], ['/privacy', t('home-privacy')]]
        .filter(([href]) => href !== here)
        .map(([href, text]) => `<a href="${href}">${esc(text)}</a>`);
    const body = `${bar ? `${bar}\n` : ''}<main class="page ${wide ? 'wide' : 'narrow'}" id="main">
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
