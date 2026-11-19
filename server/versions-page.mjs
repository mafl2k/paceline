// The plan page (plan versions spec §9, decision 12), GET /manage/team/<slug>/plan/<plan id>, the
// former versions page at the same URL. Top to bottom: the plan head (label and race, LIVE or not
// live, the outdated marks, Make live for a plan that is not live); the rider order of its newest
// version; its versions newest first, each with its time, live mark, copy mark, first-version mark and
// plan code, the summary of what it changed (diff.mjs) with all its lines in a fold, and "Back to vN"
// on every version but the newest, the live one and those with the live (else newest) version's plan
// code (the live plan's always asks first); then the items of the former
// "…" menu: New version, the race date, Remove event link, Delete plan behind its confirm. A used-up
// plan shows the lists without buttons. Also the page a plan that is gone answers, and the question
// before Back to vN (the no-script path of the in-page confirm). None of them reloads itself. Pure: it
// reads the club it is given, and the clock is passed in. Every value goes through esc().
import {esc, t} from './pages.mjs';
import {captainPage, th, flashBlock, postForm, hidden, backBar} from './ui.mjs';
import {ic} from './icons.mjs';
import {atLabel, dateDay, backAsk, liveWords, linkedPlan, andList, nameOf, plannerHref} from './team-view.mjs';
import {isShare} from './club.mjs';
import {makeLiveHtml} from './team-page.mjs';
import {ridersTable} from './upload-page.mjs';
import {diffVersions, diffSummary} from './diff.mjs';
import {planOfId, previousVersion, isUsed} from './plans.mjs';
import {plannedStart, outdated, PLAN_OPEN_MS} from './select.mjs';
import {localLabel} from './time.mjs';
import {normalizePlan} from '../pages/src/engine/plan.mjs';

const teamPath = slug => `/manage/team/${slug}`;
const versionsPath = (slug, plan) => `/manage/team/${slug}/plan/${plan}`;


// The Back to vN form of one version: for the live plan always an in-page confirm with what it does
// (backAsk), for another plan a plain button (it only stores a version).
function backForm(club, slug, p, v, now) {
    const team = club.teams[slug];
    const fields = {team: slug, plan: p.id, n: v.n, version: team.version, back: 'versions'};
    const button = t(p.live !== null ? 'vp-back-live' : 'vp-back', {n: v.n});
    const words = backAsk(club, slug, {plan: p.id, n: v.n}, now);
    if (words === null) {
        return postForm('/manage/plan/back', fields, button);
    }
    return `<details class="confirm inline">
            <summary class="btn secondary small">${esc(button)}</summary>
            <div class="confirm-body"><p>${esc(words)}</p>
            ${postForm('/manage/plan/back', {...fields, confirm: '1'}, t(words.endsWith('?') ? 'back-confirm-button' : 'vp-back', {n: v.n}), {cls: 'btn primary small'})}</div>
          </details>`;
}


// What a version changed, as lines; none for a version that cannot be read (the page still answers).
function linesOf(club, prev, v, now) {
    try {
        return {lines: diffVersions(club, prev, v, now), summary: null};
    } catch {
        return {lines: [], summary: ''};
    }
}


// One version's row.
function versionLi(club, slug, p, [id, v], {now, used}) {
    const tz = club.tz;
    const prev = previousVersion(club, id)?.[1] ?? null;
    const at = Date.parse(v.at);
    const meta = [esc(`v${v.n}`), esc(Number.isFinite(at) ? atLabel(at, now, tz) : '–')];
    if (club.teams[slug].live === id) {
        meta.push(esc(t('vp-live')));
    }
    if (v.copyOf != null) {
        meta.push(esc(t('vp-back-of', {n: v.copyOf})));
    }
    if (prev === null) {
        meta.push(esc(t('vp-first')));
    }
    meta.push(th('vp-code', {sig: `<code>${esc(v.sig)}</code>`}));
    const {lines, summary} = linesOf(club, prev, v, now);
    // no Back on the newest version, nor on the live one: it would only copy what riders have (a
    // newer version that is not live gets Make vN live in the head instead); nor on a version with
    // the plan code of the live version (of the newest, for a plan that is not live): its copy would
    // be the same plan again
    const same = v.sig === club.sheets[p.live ?? p.newest[0]].sig;
    const action = used || same || id === p.newest[0] || id === club.teams[slug].live ? '' : `\n          ${backForm(club, slug, p, v, now)}`;
    return `<li class="version">
          <div class="planinfo">
          <p class="meta">${meta.join(' · ')}</p>
          <p class="vsum">${esc(summary ?? diffSummary(lines, {copyOf: v.copyOf ?? null}))}</p>
          <details class="fold"><summary>${esc(t('vp-details'))}</summary><ul>${lines.map(l => `<li>${esc(l.text)}</li>`).join('')}</ul></details>${action}
          </div>
        </li>`;
}


// The plan head: LIVE (with the live version's n when a newer version is not live) and when riders
// get it, or not live; the outdated marks of its newest version and Make live (back to this page) for
// a plan that is not live; for a live plan whose newest version is not live, that version with Make vN
// live, as on the team page. Nothing to press on a used-up plan.
function headHtml(club, slug, p, {now, used, S}) {
    const lines = [];
    const [id, newest] = p.newest;
    const make = (button, sr) => makeLiveHtml({slug}, {id, label: newest.label}, {button, words: liveWords(club, slug, id, now), sr, back: 'plan'});
    if (p.live !== null) {
        const gate = S === null ? null : S - PLAN_OPEN_MS;
        const key = (p.live === id ? 'pp-live' : 'pp-live-v') + (gate !== null && now >= gate ? '-open' : '');
        lines.push(gate === null ? `<p class="pp-state err-text">${esc(t('tp-gets-nothing'))}</p>`
            : `<p class="pp-state live">${esc(t(key, {at: atLabel(gate, now, club.tz), n: club.sheets[p.live].n}))}</p>`);
        if (p.live !== id && !used) {
            const at = Date.parse(newest.at);
            lines.push(`<div class="newer">
      <p>${ic('info')}<span>${esc(t('tp-newer', {n: newest.n, at: Number.isFinite(at) ? atLabel(at, now, club.tz) : '–'}))}</span></p>
      ${make(t('tp-make-newer-live', {n: newest.n}), false)}
    </div>`);
        }
    } else {
        lines.push(`<p class="pp-state muted">${esc(t('pp-not-live'))}</p>`);
        const marks = outdated(club, slug, now).get(id) ?? [];
        if (marks.length) {
            lines.push(`<p class="outdated">${ic('alert')}${esc(t('tp-outdated', {marks: andList(marks.map(m => t('tp-outdated-mark', {name: m.name, team: nameOf(club, m.rides)})))}))}</p>`);
        }
        if (!used) {
            lines.push(make(t('tp-make-live-ask'), true));
        }
    }
    return `<section class="card planhead stack">
    ${lines.join('\n    ')}
  </section>`;
}


// The rider order of the plan's newest version: riders with pull and target (never the planner's
// roster).
function ridersHtml(p) {
    const [, sheet] = p.newest;
    let riders = [];
    try {
        ({riders} = normalizePlan(sheet.json, sheet.text).plan);
    } catch {
        // a version that cannot be read lists no riders
    }
    const n = riders.length === 1 ? t('tp-riders-one') : t('tp-riders-n', {n: riders.length});
    return `<section class="card" aria-labelledby="pr-h">
    <div class="card-head"><h2 id="pr-h">${esc(t(p.live !== null && p.live !== p.newest[0] ? 'pp-riders-not-live' : 'pp-riders', {n: sheet.n}))}</h2><p class="count">${esc(n)}</p></div>
    ${ridersTable(sheet, riders)}
  </section>`;
}


// The items of the former "…" menu: New version (the upload page for this plan, back to this page), the race date,
// Remove event link for a linked plan (back to this page), Delete plan behind its confirm (back to
// the team page). A used-up plan keeps only the race date.
function actionsHtml(club, slug, p, {used, planner}) {
    const team = club.teams[slug];
    const [id] = p.newest;
    const items = [];
    if (!used) {
        items.push(`<a class="rowlink" href="${esc(`/manage/upload?team=${slug}&plan=${p.id}&from=plan`)}">${ic('upload')}<span><strong>${esc(t('pp-new-version'))}</strong></span>${ic('right', 'chev')}</a>`);
    }
    // "Edit on ZwiftGopher": the plan's own version (the live one, else the newest) opened in the
    // planner by its share value; only when that version has one (else the planner would open empty)
    const share = (p.live !== null ? club.sheets[p.live] : p.newest[1])?.zgShare;
    if (!used && planner !== null && isShare(share)) {
        items.push(`<a class="rowlink" href="${esc(plannerHref(planner, share))}" target="_blank" rel="noopener noreferrer">${ic('link')}<span><strong>${esc(t('pp-edit-planner'))}</strong></span>${ic('right', 'chev')}</a>`);
    }
    // a special team's start time comes with each upload (the newest for the date sets it)
    const hint = team.kind === 'special' ? 'tp-race-time-hint' : 'tp-race-date-hint';
    items.push(`<p class="menu-info"><strong>${esc(t('tp-race-date', {day: dateDay(p.date, club.tz)}))}</strong><span>${esc(t(hint))}</span></p>`);
    const pinned = linkedPlan(club, p);
    if (!used && pinned !== null) {
        items.push(`<form method="post" action="/manage/sheet/unpin">${hidden({team: slug, sheet: p.live ?? id, back: 'plan'})}<button class="btn secondary small" type="submit">`
            + `${ic('unlink')}${th('tp-unpin-menu', {id: `<span class="sub">${esc(t('tp-unpin-id', {id: pinned}))}</span>`})}</button></form>`);
    }
    if (!used) {
        const del = p.live !== null ? t('tp-delete-live', {team: team.name}) : t('tp-delete-other');
        items.push(`<details class="confirm">
      <summary class="btn danger small">${ic('trash')}${esc(t('tp-delete-plan'))}</summary>
      <div class="confirm-body"><p>${esc(del)}</p>
      ${postForm('/manage/sheet/delete', {team: slug, sheet: id}, t('tp-delete-button', {label: p.label}), {cls: 'btn danger small', icon: 'trash'})}</div>
    </details>`);
    }
    return `<section class="card plan-actions stack">
    ${items.join('\n    ')}
  </section>`;
}


// The plan page of plan `planId` (any of its ids; the caller has checked that the team and the plan
// exist), with an optional flash. A used-up plan lists its versions without buttons.
// `planner` (push.mjs href with a fresh token for the team, or null) gives "Edit on ZwiftGopher".
export function versionsPage(club, slug, planId, {now, seen, others, flash = null, planner = null}) {
    const team = club.teams[slug];
    const p = planOfId(club, slug, planId);
    const S = plannedStart(club, p.newest[1]);
    const race = S === null ? dateDay(p.date, club.tz) : localLabel(S, club.tz);
    const used = isUsed(club, p.newest[1], now);
    const rows = [...p.versions].reverse().map(entry => versionLi(club, slug, p, entry, {now, used}));
    const main = `<main class="page" id="main">
  <header class="pagehead"><p class="kicker">${esc(team.name)}</p><h1>${esc(t('vp-heading', {label: p.label, race}))}</h1></header>
  ${flashBlock(flash)}
  ${headHtml(club, slug, p, {now, used, S})}
  ${ridersHtml(p)}
  <section class="card" aria-labelledby="pv-h">
    <div class="card-head"><h2 id="pv-h">${esc(t('pp-versions'))}</h2><p class="count">${p.versions.length}</p></div>
    <ul class="plans versions">
        ${rows.join('\n        ')}
    </ul>
  </section>
  ${actionsHtml(club, slug, p, {used, planner})}
</main>`;
    return captainPage(club, {now, seen, others, here: teamPath(slug), bar: backBar(teamPath(slug), team.name, club.name), main, cls: 'formpage'});
}


// A plan of team `slug` that no longer exists (deleted, swept, or a wrong link): back to the team.
// The caller sets the status (404 for a GET, the refusal's for a POST).
export function planGonePage(club, slug, {now, seen, others, flash = null}) {
    const name = club.teams[slug].name;
    const main = `<main class="page" id="main">
  ${flashBlock(flash)}
  <section class="card empty" aria-labelledby="gone-h">
    ${ic('noPlan', 'big')}
    <h1 id="gone-h">${esc(t('vp-gone'))}</h1>
    <a class="btn primary block" href="${esc(teamPath(slug))}">${esc(t('result-back', {team: name}))}</a>
  </section>
</main>`;
    return captainPage(club, {now, seen, others, here: teamPath(slug), bar: backBar(teamPath(slug), name, club.name), main, needsScript: false});
}


// POST /manage/plan/back of a live plan without confirm (the no-script path of the in-page confirm):
// the question, `words` (backAsk), and a form that posts again with confirm=1. `back` 'versions'
// keeps the way back to the plan page, and the link back names the plan instead of the team.
export function backConfirmPage(club, slug, {now, seen, others, plan, n, version, words, back = null}) {
    const team = club.teams[slug].name;
    const p = planOfId(club, slug, plan);
    const k = Number(n);
    const fields = {team: slug, plan: p.id, n: k, version, ...(back === 'versions' ? {back} : {}), confirm: '1'};
    const home = back === 'versions' ? versionsPath(slug, p.id) : teamPath(slug);
    const main = `<main class="page" id="main">
  <header class="pagehead"><p class="kicker">${esc(t('ui-club-team', {club: club.name, team}))}</p><h1>${esc(t('back-confirm-heading', {n: k, label: p.label}))}</h1></header>
  <p class="banner warn" role="note">${ic('alert')}<span>${esc(words)}</span></p>
  <section class="card stack">
    ${postForm('/manage/plan/back', fields, t(words.endsWith('?') ? 'back-confirm-button' : 'vp-back', {n: k}), {cls: 'btn primary'})}
    <a class="btn secondary" href="${esc(home)}">${ic('left')}${esc(t('live-confirm-back', {team: back === 'versions' ? p.label : team}))}</a>
  </section>
</main>`;
    return captainPage(club, {now, seen, others, here: teamPath(slug), main, cls: 'formpage', needsScript: false});
}
