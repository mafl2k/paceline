// The team page /manage/team/<slug> (spec §5.4; plan versions §9, the race-day cockpit), drawn from
// teamView (team-view.mjs): on phones a sticky bar with the team switcher (a <details>, no script
// needed), from 1024 px the same rows in the sidebar of every captain page (ui.mjs captainPage) and
// the team name as the title under the club; one race line with the opening time, "Updated" and
// the stale banner; the "N to fix" notes or the no-start-time callout; "Plans for <day>", one row
// per plan of this race in a fixed order, each a link to its plan page (the live row with its
// version, what it changed and Back, and a newer version that is not live; every other row with its
// outdated marks, its riders in short and Make live); the live plan's riders under the plans (the
// plan before the gate, each rider's state after it; never the planner's roster); a plain upload
// link. Team settings
// is a quiet link at the top right on phones, beside the title from 1024 px, as Club settings is on
// the teams page; without a start time the callout has its own "Set the start time" button. Every
// Make live and the live plan's Back ask first in the page. No "…" menu, no status card, no fixed
// bar. Its settings /manage/team/<slug>/settings (rename,
// start time, race rhythm, event links, delete with an in-page confirm), the new-team page
// /manage/new-team, and the question before Make live: the answer to a POST without confirm=1, so
// Make live works without the script, as the only captain action that must (decision 13). None of
// those three reloads itself. Pure: it reads the club and the checks it is given, and the clock is
// passed in. Every value goes through esc().
import {esc, t} from './pages.mjs';
import {captainPage, teamRows, rowsHtml, th, flashBlock, hidden, postForm, freshLine, backBar, dstBanner} from './ui.mjs';
import {ic} from './icons.mjs';
import {teamView, teamRow, refreshDue, nextRace, worst, andList, quote, liveWords, linkedPlan, WAITING_REFRESH_S, plannerHref, teamShare} from './team-view.mjs';
import {uploadHref} from './upload-page.mjs';
import {plansOf, racePlans, planOfId} from './plans.mjs';
import {localHHMM, dstChangedRecently} from './time.mjs';
import {teamWeekday} from './select.mjs';

const teamPath = slug => `/manage/team/${slug}`;
const settingsPath = slug => `/manage/team/${slug}/settings`;
const uploadPath = slug => `/manage/upload?team=${slug}`;
const versionsPath = (slug, plan) => `/manage/team/${slug}/plan/${plan}`;

// The icon of each rider state (teamView's RiderState kind).
const STATE_ICON = {
    none: 'dashed', 'other-event': 'x', 'has-in-event': 'checkCircle', 'in-event': 'clock',
    'other-team': 'swap', has: 'checkCircle', 'old-code': 'older', checked: 'clock',
};
const noteIcon = sev => (sev === 'err' ? 'x' : 'alert');


// The sticky top bar (phones): back to the teams, the team name as the switcher's summary, its panel
// the team rows `list` (teamRows: the sidebar's, from 1024 px).
function switchBar(club, view, list, now) {
    const rows = rowsHtml(list, view.slug);
    const day = nextRace(club, now);
    const head = day === null ? club.name : t('tp-switch-head', {club: club.name, day});
    return `<nav class="topbar" aria-label="${esc(t('tp-nav'))}">
  <div class="topbar-row">
    <a class="back" href="/manage" aria-label="${esc(t('tp-all-teams'))}">${ic('left')}</a>
    <details class="switch" data-switch>
      <summary><span class="sw-icon ${esc(view.sev)}">${ic(view.icon)}</span><h1>${esc(view.name)}</h1><span class="sw-short">${esc(teamRow(view).short)}</span>${ic('down', 'chev')}</summary>
      <div class="switch-panel">
        <p class="switch-head">${esc(head)}</p>
        <ul class="trows">
${rows}
        </ul>
        <p class="switch-foot"><a href="/manage">${esc(t('tp-all-teams'))}</a></p>
      </div>
    </details>
  </div>
</nav>`;
}


function raceLine(view, now) {
    const {when} = view;
    if (when.day === null) {
        return `<p class="race"><span>${esc(t('tp-race-none'))}</span></p>`;
    }
    if (view.noStart) {
        const none = `<span class="err-text">${esc(t('tp-no-start-time'))}</span>`;
        return `<p class="race"><span>${th('tp-race-no-start', {day: esc(when.day), none})}</span></p>`;
    }
    if (view.S === null) {
        // never a missing time: the day alone
        return `<p class="race"><span>${esc(when.day)}</span></p>`;
    }
    // one line with the opening time (spec §9): no status card repeats it; "open since" after the gate
    const open = view.gateAt !== null && now >= view.gateAt;
    return `<p class="race"><span>${th(open ? 'tp-race-open' : 'tp-race-opens', {day: esc(when.day), time: `<time>${esc(when.time)}</time>`, until: esc(when.until), opens: `<time>${esc(view.opens)}</time>`})}</span></p>`;
}


function noteHtml(club, view, n, now) {
    const parts = [`<p class="note-title">${ic(noteIcon(n.sev))}<strong>${esc(n.title)}</strong></p>`, `<p>${esc(n.body)}</p>`];
    if (n.kind === 'pin') {
        parts.push(`<ul class="evcount">${n.events.map(e => `<li>${esc(e.text)}</li>`).join('')}</ul>`);
        parts.push(postForm('/manage/sheet/unpin', {team: view.slug, sheet: n.sheet}, t('tp-unpin'), {icon: 'unlink'}));
    } else if (n.kind === 'hole') {
        parts.push(`<a class="btn secondary small" href="${esc(uploadHref(club, view.slug, view.live.date, now))}">${ic('upload')}${esc(n.linkText)}</a>`);
    }
    parts.push(`<p class="hint">${esc(n.after)}</p>`);
    return `<li class="note ${esc(n.sev)}">
        ${parts.join('\n        ')}
      </li>`;
}


// The plans received from ZwiftGopher (teamView.received, newest first), above everything else: one
// row each with its time, the planner's team name as a hint, the rider count, "Review and store" (its
// assign page, where Make live starts off) and Discard (back to this page).
function receivedHtml(view) {
    if (!view.received.length) {
        return '';
    }
    const rows = view.received.map(r => {
        const what = [r.riders === 1 ? t('tp-riders-one') : t('tp-riders-n', {n: r.riders})];
        if (r.name !== null) {
            what.unshift(t('tp-received-name', {name: r.name}));
        }
        return `<li class="note info">
        <p class="note-title">${ic('file')}<strong>${esc(t('tp-received-at', {at: r.at}))}</strong></p>
        <p>${esc(what.join(' · '))}</p>
        <div class="note-acts"><a class="btn primary small" href="/manage/inbox/${esc(r.id)}">${esc(t('tp-received-review'))}</a>`
            + `${postForm(`/manage/inbox/${r.id}/discard`, {back: teamPath(view.slug)}, t('tp-received-discard'), {cls: 'btn quiet small', icon: 'trash'})}</div>
      </li>`;
    });
    const n = view.received.length;
    return `<section class="callout info" aria-labelledby="recv-h">
      <h2 id="recv-h">${ic('info')}${esc(n === 1 ? t('tp-received-one') : t('tp-received', {n}))}</h2>
      <ol>
      ${rows.join('\n      ')}
      </ol>
    </section>`;
}


// "N to fix": the notes, worst colour first.
function notesHtml(club, view, now) {
    if (!view.notes.length) {
        return '';
    }
    const sev = worst(view.notes.map(n => n.sev));
    return `<section class="callout ${sev}" aria-labelledby="fix-h">
      <h2 id="fix-h">${ic(noteIcon(sev))}${esc(t('tp-fix', {n: view.notes.length}))}</h2>
      <ol>
      ${view.notes.map(n => noteHtml(club, view, n, now)).join('\n      ')}
      </ol>
    </section>`;
}


// No start time: the status itself, red, with what a start time would change (the trap). A weekly
// team sets it in its settings; a special team's race without one (plans stored by 0.3.0) gets it
// with any upload for that date, so its button is the upload page (for the race's plan when it
// has one plan: a new version needs no type).
function noStartHtml(club, view, now) {
    if (view.status.kind !== 'no-start') {
        return '';
    }
    const body = view.special ? t('tp-no-start-body-special', {day: view.when.day})
        : view.live ? t('tp-no-start-body', {label: view.live.label}) : t('tp-no-start-body-none');
    const button = view.special
        ? `<a class="btn secondary small" href="${esc(uploadHref(club, view.slug, view.raceDate, now))}">${ic('upload')}${esc(t('tp-upload-version'))}</a>`
        : `<a class="btn secondary small" href="${esc(settingsPath(view.slug))}">${ic('clock')}${esc(t('tp-set-start'))}</a>`;
    return `<section class="callout err" aria-labelledby="fix-h">
      <h2 id="fix-h">${ic('x')}${esc(view.status.text)}</h2>
      <ol><li class="note err">
        <p>${esc(body)}</p>
        ${view.trap.map(x => `<p>${esc(x.text)}</p>`).join('\n        ')}
        ${button}
      </li></ol>
    </section>`;
}


// "Plan on ZwiftGopher" beside the upload (push.mjs href: a fresh token for this team), or '' without
// one (no PUBLIC_URL). `cls` the link's class: the plain .uplink under the plans, a block button in
// the empty card.
function plannerLink(planner, cls) {
    return planner === null ? '' : `<a class="${cls}" href="${esc(planner)}" target="_blank" rel="noopener noreferrer">${ic('link')}${esc(t('upload-planner'))}</a>`;
}


function emptyHtml(view, planner = null) {
    if (view.live) {
        return '';
    }
    if (view.plans.length) {
        // stored plans, none live: they are listed below, each with Make live
        return `<section class="card empty" aria-labelledby="empty-h">
      ${ic('noPlan', 'big')}
      <h2 id="empty-h">${esc(t('tp-none-live-title', {team: view.name}))}</h2>
      <p>${esc(t('tp-none-live-body'))}</p>
    </section>`;
    }
    const body = view.noStart ? esc(t('tp-empty-body-no-start')) : view.status.kind === 'no-race' ? esc(t('tp-empty-body-no-race'))
        : th('tp-empty-body', {at: `<time>${esc(view.opens)}</time>`});
    return `<section class="card empty" aria-labelledby="empty-h">
      ${ic('noPlan', 'big')}
      <h2 id="empty-h">${esc(t('tp-empty-title', {team: view.name}))}</h2>
      <p>${body}</p>
      <a class="btn primary block" href="${esc(uploadPath(view.slug))}">${ic('upload')}${esc(t('tp-upload-plan'))}</a>${planner === null ? '' : `
      ${plannerLink(planner, 'btn secondary block')}`}
    </section>`;
}


// The words of a confirm's button: "… anyway" after a question (outdated marks, moves or holes),
// else the plain action.
const anyway = words => words.endsWith('?');


// Make live of version `row.id` (spec §9: every Make live asks first): an in-page confirm, its button
// below the summary (never in a fixed bar, never where the finger just tapped), with what it does in
// words (liveWords). `button` is the summary's text; `sr` adds the label for screen readers; `back`
// 'plan' comes back to the plan page. Without the script the summary still opens it; a POST without
// confirm answers liveConfirmPage.
export function makeLiveHtml(view, row, {button, words, sr = true, back = null}) {
    const fields = {team: view.slug, sheet: row.id, ...(back === null ? {} : {back}), confirm: '1'};
    return `<details class="confirm inline">
            <summary class="btn secondary small">${esc(button)}${sr ? `<span class="sr"> ${esc(quote(row.label))}</span>` : ''}</summary>
            <div class="confirm-body"><p>${esc(words)}</p>
            ${postForm('/manage/live', fields, t(anyway(words) ? 'tp-make-live-anyway' : 'tp-confirm-live'), {cls: 'btn primary small'})}</div>
          </details>`;
}


// Back to the version before the live one, live at once: always an in-page confirm (decision 12),
// with what it does (backAsk: "Riders get v4 at once instead of v5.", the moves and holes).
function backHtml(club, view) {
    const lv = view.live;
    const fields = {team: view.slug, plan: lv.planId, n: lv.back.n, version: club.teams[view.slug].version};
    const button = t('tp-back-live', {n: lv.back.n});
    if (lv.back.words === null) {
        // backTo would refuse (a used-up plan): the POST says so
        return postForm('/manage/plan/back', fields, button);
    }
    return `<details class="confirm inline">
            <summary class="btn secondary small">${esc(button)}</summary>
            <div class="confirm-body"><p>${esc(lv.back.words)}</p>
            ${postForm('/manage/plan/back', {...fields, confirm: '1'}, t(anyway(lv.back.words) ? 'back-confirm-button' : 'vp-back', {n: lv.back.n}), {cls: 'btn primary small'})}</div>
          </details>`;
}


// A plan row's first line: the live tag (`tag`, markup), the label and the version, all a link to
// the plan page. A plan for another race than the heading's names its race.
function rowHead(view, p, tag, day) {
    const version = p.day === day ? t('tp-version', {n: p.n, at: p.at ?? '–'}) : t('tp-version-race', {day: p.day, n: p.n, at: p.at ?? '–'});
    return `<h3 class="l1"><a class="planlink" href="${esc(versionsPath(view.slug, p.planId))}">${tag}<span class="label">${esc(p.label)}</span> `
        + `<span class="muted">${esc(version)}</span>${ic('right', 'chev')}</a></h3>`;
}


const ridersCount = n => (n === 1 ? t('tp-riders-one') : t('tp-riders-n', {n}));


// The live plan's row: LIVE, its label and version; the plan code, the riders, the event; what it
// changed with Back to the version before it; under it a newer version that is not live, with Make
// vN live.
function liveRow(club, view, p, day, now) {
    const lv = view.live;
    const tag = `<span class="tag${lv.sent ? '' : ' off'}">${esc(t(lv.sent ? 'tp-live' : 'tp-not-sent'))}</span> `;
    const num = id => `<span class="num">${esc(id)}</span>`;
    const event = lv.pinnedEventId != null ? th('tp-event-link', {id: num(lv.pinnedEventId), yours: `<span class="muted">${esc(t('tp-yours'))}</span>`})
        : lv.eventId != null ? th('tp-event', {id: num(lv.eventId)}) : '';
    const l2 = [`<span class="plancode">${th('tp-plan-code', {sig: `<code>${esc(lv.sig)}</code>`})}</span>`, `<span>${esc(ridersCount(p.riders))}</span>`];
    if (!lv.sent) {
        l2.push(`<span class="err-text">${esc(t('tp-gets-nothing'))}</span>`);
    }
    if (event) {
        l2.push(`<span>${event}</span>`);
    }
    const changed = lv.back === null ? '' : `
          <div class="l3"><p class="vsum">${esc(lv.summary ?? '')}</p>${backHtml(club, view)}</div>`;
    const nw = lv.newer;
    const newer = nw === null ? '' : `
          <div class="newer">
            <p>${ic('info')}<span>${esc(t('tp-newer', {n: nw.n, at: nw.at ?? '–'}))}</span></p>
            ${makeLiveHtml(view, {id: nw.id, label: club.sheets[nw.id].label}, {button: t('tp-make-newer-live', {n: nw.n}), words: liveWords(club, view.slug, nw.id, now), sr: false})}
          </div>`;
    return `<li class="planrow live">
          ${rowHead(view, p, tag, day)}
          <p class="l2">${l2.join('')}</p>${changed}${newer}
        </li>`;
}


// Another plan's row: label and version, its outdated marks, its riders in short, Make live.
function planRow(club, view, p, day, now) {
    const marks = p.marks.length === 0 ? ''
        : `
          <p class="outdated">${ic('alert')}${esc(t('tp-outdated', {marks: andList(p.marks.map(m => t('tp-outdated-mark', {name: m.name, team: m.ridesName})))}))}</p>`;
    const names = p.names.join(', ') + (p.riders > p.names.length ? ' …' : '');
    const riders = p.riders === 1 ? t('tp-row-riders-one', {names}) : t('tp-row-riders', {n: p.riders, names});
    return `<li class="planrow">
          ${rowHead(view, p, '', day)}${marks}
          <div class="l4"><p class="meta">${esc(riders)}</p>${makeLiveHtml(view, p, {button: t('tp-make-live-ask'), words: liveWords(club, view.slug, p.id, now)})}</div>
        </li>`;
}


// "Plans for Thu 19 Nov": one row per plan of this race in a fixed order (teamView.plans), each a
// link to its plan page. The heading names the day when every plan is for it.
function plansHtml(club, view, now) {
    if (!view.plans.length) {
        return '';
    }
    const day = view.live?.day ?? view.when.day;
    const head = day !== null && view.plans.every(p => p.day === day) ? t('tp-plans', {day}) : t('tp-plans-any');
    const rows = view.plans.map(p => (p.live && view.live ? liveRow(club, view, p, day, now) : planRow(club, view, p, day, now)));
    return `<section class="card plans-card" aria-labelledby="plans-h">
      <div class="card-head"><h2 id="plans-h">${esc(head)}</h2><p class="count">${view.plans.length}</p></div>
      <ul class="plans">
        ${rows.join('\n        ')}
      </ul>
    </section>`;
}


function riderLi(name, state) {
    return `<li class="rider ${esc(state.sev)}">${ic(STATE_ICON[state.kind] ?? 'info')}<span class="who"><span class="nm">${esc(name)}</span>`
        + `<span class="what">${esc(state.text)}</span></span>${state.time ? `<time>${esc(state.time)}</time>` : ''}</li>`;
}


// The live plan's riders, under the plans: before the gate (or without a start time) the plan in
// ride order, after it each rider's state.
function ridersHtml(view) {
    if (!view.live) {
        return '';
    }
    const title = `<h2 id="riders-h">${esc(t('tp-riders-on', {label: view.live.label}))}</h2>`;
    let head;
    let riders;
    let hint;
    if (view.open) {
        const count = `<strong>${esc(t('tp-has-count', {has: view.has, n: view.count}))}</strong>`;
        head = `${title}<p class="count">${th(view.count === 1 ? 'tp-has-one' : 'tp-has', {count})}</p>`;
        riders = view.riders.map(r => riderLi(r.name, r.state));
        // no form in it: an open help fold must not hold the reload
        hint = `<details class="help" data-keep-refresh><summary>${ic('info')}${esc(t('tp-help'))}</summary><p class="hint">${esc(t('tp-help-text'))}</p></details>`;
    } else {
        head = `${title}<p class="count">${esc(ridersCount(view.count))}</p>`;
        riders = view.riders.map(r => `<li class="rider plan"><span class="pos">${r.pos}</span><span class="who"><span class="nm">${esc(r.name)}</span>`
            + `<span class="what">${esc(r.pull)}</span></span></li>`);
        hint = view.live.sent ? `<p class="hint">${th('tp-plan-hint', {at: `<time>${esc(view.opens)}</time>`})}</p>`
            : `<p class="hint">${esc(t(view.special ? 'tp-no-start-hint-special' : 'tp-no-start-hint'))}</p>`;
    }
    return `<section class="card riders-card" aria-labelledby="riders-h">
      <div class="card-head">${head}</div>
      <ul class="riders">
        ${riders.join('\n        ')}
      </ul>
      ${hint}
    </section>`;
}


// The plans of this race with an event link (linkedPlan), the live one first: {id, label, pinned,
// live}, `id` the live version's or the newest's (Remove clears every version's link).
function linkedPlans(club, slug, now) {
    return racePlans(club, slug, now).map(p => ({p, pinned: linkedPlan(club, p)})).filter(x => x.pinned !== null).map(({p, pinned}) => {
        const id = p.live ?? p.newest[0];
        return {id, label: club.sheets[id].label, pinned, live: p.live !== null};
    });
}


// The team page of `slug` (a team of the club). `seen` is store.seenOf(cid), `others` captainPage's;
// `refresh` false keeps it from reloading itself (a refusal answers a POST: its URL must not be
// reloaded). The team name is the h1 twice: in the bar on phones, in the page from 1024 px (.desk),
// each hidden where the other shows.
// `planner` (push.mjs href with a fresh token, or null) gets the share id of the team's plan
// (teamShare: the planner opens with it loaded).
export function teamPage(club, slug, {now, seen = {}, others = [], flash = null, refresh = true, planner: base = null}) {
    const view = teamView(club, slug, {now, seen});
    const planner = plannerHref(base, teamShare(club, slug, now));
    const rows = teamRows(club, {now, seen}, view);
    const path = teamPath(slug);
    const updated = localHHMM(now, club.tz);
    // the upload link is plain, under the plans; a team without plans has the empty card's button
    // and beside it the other way to a plan, "Plan on ZwiftGopher" (user, 19 Nov 2026: one step before the upload page)
    const upload = view.live || view.plans.length ? `<div class="uplinks"><a class="uplink" href="${esc(uploadPath(slug))}">${ic('upload')}${esc(t('tp-upload-link'))}</a>${plannerLink(planner, 'uplink')}</div>` : '';
    const main = `<main class="page wide" id="main">
  <header class="pagehead">
    <div class="teamhead"><p class="kicker">${esc(club.name)}</p><h1 class="desk">${esc(view.name)}</h1><a class="btn quiet small" href="${esc(settingsPath(slug))}">${ic('settings')}${esc(t('tp-settings'))}</a></div>
    ${raceLine(view, now)}
    ${freshLine(updated, path)}
  </header>
  ${dstChangedRecently(club.tz, now) ? dstBanner() : ''}
  ${flashBlock(flash)}
  <div class="cols">
    <div class="col-a">${receivedHtml(view)}${notesHtml(club, view, now)}${noStartHtml(club, view, now)}${emptyHtml(view, planner)}${plansHtml(club, view, now)}</div>
    <div class="col-b">${ridersHtml(view)}</div>
    <div class="col-c">${upload}</div>
  </div>
</main>`;
    // every 30 s around a race; else every 60 s while plans from ZwiftGopher wait, so the next one
    // comes in by itself
    const race = refreshDue(club, now);
    const reload = refresh && (race || view.received.length > 0);
    return captainPage(club, {now, seen, others, here: path, rows, bar: switchBar(club, view, rows, now), main,
        cls: 'teampage', refresh: reload ? path : null, refreshS: race ? 30 : WAITING_REFRESH_S, updated});
}


// A team that no longer exists (deleted, renamed away, or a wrong link): back to the teams. The
// caller sets the status (404 for a GET, the refusal's for a POST). `now`, `seen`, `others`:
// captainPage's, as on every page below.
export function teamGonePage(club, {now, seen, others, flash = null}) {
    const main = `<main class="page" id="main">
  ${flashBlock(flash)}
  <section class="card empty" aria-labelledby="gone-h">
    ${ic('team', 'big')}
    <h1 id="gone-h">${esc(t('tp-gone'))}</h1>
    <p>${esc(t('tp-gone-hint'))}</p>
    <a class="btn primary block" href="/manage">${esc(t('tp-all-teams'))}</a>
  </section>
</main>`;
    return captainPage(club, {now, seen, others, here: '/manage', bar: backBar('/manage', t('tp-all-teams'), club.name), main, needsScript: false});
}


function linksHtml(club, view, now) {
    const linked = linkedPlans(club, view.slug, now);
    if (!linked.length) {
        return `<p class="hint">${esc(t('ts-links-none', {team: view.name}))}</p>`;
    }
    const rows = linked.map(p => {
        const sent = view.live?.sent ?? false;
        const tag = p.live ? ` <span class="tag${sent ? '' : ' off'}">${esc(t(sent ? 'tp-live' : 'tp-not-sent'))}</span>` : '';
        return `<li><div><p class="nm">${esc(p.label)}${tag}</p><p class="meta">${th('ts-link-meta', {id: `<span class="num">${esc(p.pinned)}</span>`})}</p></div>
      <form method="post" action="/manage/sheet/unpin">${hidden({team: view.slug, sheet: p.id, back: 'team-settings'})}<button class="btn secondary small" type="submit">`
            + `${ic('unlink')}${esc(t('ts-unpin'))}<span class="sr"> ${esc(t('ts-unpin-sr', {label: p.label}))}</span></button></form></li>`;
    });
    return `<ul class="rows">${rows.join('\n      ')}</ul>
    <p class="hint">${esc(t('ts-links-hint'))}</p>`;
}


// The start time card: a weekly team's form; a special team has none (user, 19 Nov 2026), only a
// line that says where its times come from. `start` is the field's value.
function startCard(club, view, start) {
    if (view.special) {
        return `<section class="card" aria-labelledby="start-h">
    <h2 id="start-h">${esc(t('team-start-label'))}</h2>
    <p class="hint">${esc(t('ts-start-special'))}</p>
  </section>`;
    }
    return `<section class="card" aria-labelledby="start-h">
    <h2 id="start-h">${esc(t('team-start-label'))}</h2>
    <form class="inline-form" method="post" action="/manage/team">${hidden({action: 'start', team: view.slug})}
      <label class="field"><span class="sr">${esc(t('team-start-label'))}</span><input type="time" name="start" value="${esc(start)}"></label>
      <button class="btn secondary" type="submit">${esc(t('team-set-start'))}</button>
    </form>
    <p class="hint">${esc(t('ts-start-hint', {tz: club.tz, team: view.name}))}</p>
  </section>`;
}


// The settings of team `slug` (a team of the club). `typed` ({name}, {start} or {kind, weekday}, as
// posted) is shown in its form instead of the stored value after a refusal. `push` (the server has
// PUBLIC_URL, so the upload page offers "Plan on ZwiftGopher") adds "New ZwiftGopher link", which
// ends every link the upload page has handed out for this team.
export function teamSettingsPage(club, slug, {now, seen, others, flash = null, typed = null, push = false}) {
    const view = teamView(club, slug, {now});
    const name = typed?.name ?? view.name;
    const start = typed?.start ?? view.start ?? '';
    const plans = plansOf(club, slug).length;
    const delBody = plans === 0 ? t('ts-delete-body-none', {team: view.name})
        : plans === 1 ? t('ts-delete-body-one', {team: view.name}) : t('ts-delete-body', {team: view.name, n: plans});
    const del = t('team-delete-button', {team: view.name});
    const main = `<main class="page" id="main">
  <header class="pagehead"><p class="kicker">${esc(view.name)}</p><h1>${esc(t('tp-settings'))}</h1></header>
  ${flashBlock(flash)}
  <section class="card" aria-labelledby="name-h">
    <h2 id="name-h">${esc(t('ts-name'))}</h2>
    <form class="inline-form" method="post" action="/manage/team">${hidden({action: 'rename', team: slug})}
      <label class="field"><span class="sr">${esc(t('team-name-label'))}</span><input name="name" value="${esc(name)}" maxlength="40" required autocomplete="off"></label>
      <button class="btn secondary" type="submit">${esc(t('team-rename'))}</button>
    </form>
    <p class="hint">${esc(t('ts-name-hint'))}</p>
  </section>
  ${startCard(club, view, start)}
  ${rhythmCard(club, slug)}
  <section class="card" aria-labelledby="link-h">
    <h2 id="link-h">${esc(t('ts-links'))}</h2>
    ${linksHtml(club, view, now)}
  </section>${push ? `
  <section class="card" aria-labelledby="push-h">
    <h2 id="push-h">${esc(t('ts-push'))}</h2>
    ${postForm('/manage/team', {action: 'push-link', team: slug}, t('ts-push-new'), {icon: 'link'})}
    <p class="hint">${esc(t('ts-push-hint'))}</p>
  </section>` : ''}
  <section class="danger-zone" aria-labelledby="del-h">
    <h2 id="del-h">${ic('trash')}${esc(del)}</h2>
    <details class="confirm">
      <summary class="btn danger">${ic('trash')}${esc(t('ts-delete-open'))}</summary>
      <div class="confirm-body"><p>${esc(delBody)}</p>
      ${postForm('/manage/team', {action: 'delete', team: slug}, del, {cls: 'btn danger', icon: 'trash'})}</div>
    </details>
  </section>
</main>`;
    return captainPage(club, {now, seen, others, here: teamPath(slug), bar: backBar(teamPath(slug), view.name, club.name), main, cls: 'formpage'});
}


// The race rhythm's choices (plan versions spec §9, decision 11; user, 19 Nov 2026), one builder
// for the team settings and Add a team so the two read alike: weekly on a weekday (`weekday` 1-7,
// or null for the club's day), or special, with date and start time coming with each plan. With
// `start` (a string: the field's value) the weekly choice has the team's start time too (Add a
// team). The weekly fields sit under their choice (data-weekly); the script hides them while
// special is checked, without it they simply show. `legend` false hides the legend (a card's
// heading says it).
export function rhythmFields(club, {kind, weekday, start = null, legend = true}) {
    const special = kind === 'special';
    const own = Number.isInteger(weekday) && weekday >= 1 && weekday <= 7 ? weekday : null;
    const day = n => t(`weekday-${n}`);
    const option = (value, text, selected) => `<option value="${value}"${selected ? ' selected' : ''}>${esc(text)}</option>`;
    const options = [option('', t('ts-weekday-club', {weekday: day(teamWeekday(club, null))}), own === null)];
    for (let n = 1; n <= 7; n++) {
        options.push(option(String(n), day(n), own === n));
    }
    const choice = (value, checked, text) => `<label class="choice"><input type="radio" name="kind" value="${value}"${checked ? ' checked' : ''}>`
        + `<span><strong>${esc(text)}</strong></span></label>`;
    const time = start === null ? '' : `
          <label class="field">${esc(t('team-start-label'))} <span class="hint">${esc(t('nt-start-hint', {tz: club.tz}))}</span><input type="time" name="start" value="${esc(start)}"></label>`;
    return `<fieldset class="choices" data-rhythm><legend${legend ? '' : ' class="sr"'}>${esc(t('ts-rhythm'))}</legend>
        ${choice('weekly', !special, t('ts-weekly', {weekday: day(own ?? teamWeekday(club, null))}))}
        <div class="stack" data-weekly>
          <label class="field">${esc(t('ts-weekday'))}<select name="weekday" aria-describedby="weekday-hint">${options.join('')}</select></label>
          <p class="hint" id="weekday-hint">${th('ts-weekday-hint', {settings: `<a href="/manage/settings">${esc(t('tp-club-settings'))}</a>`})}</p>${time}
        </div>
        ${choice('special', special, t('ts-special'))}
      </fieldset>`;
}


// The team's race rhythm card (rhythmFields with the team's kind and weekday).
function rhythmCard(club, slug) {
    const team = club.teams[slug];
    return `<section class="card" aria-labelledby="kind-h">
    <h2 id="kind-h">${esc(t('ts-rhythm'))}</h2>
    <form class="stack" method="post" action="/manage/team">${hidden({action: 'kind', team: slug})}
      ${rhythmFields(club, {kind: team.kind, weekday: team.weekday, legend: false})}
      <button class="btn secondary" type="submit">${esc(t('ts-rhythm-save'))}</button>
    </form>
  </section>`;
}


// The posted race rhythm as the forms send it (typed): `kind` 'weekly' or 'special' (anything else
// draws as weekly) and `weekday` a string, '' for the club's day.
export function typedRhythm(typed) {
    const day = /^[1-7]$/.test(typed?.weekday ?? '') ? Number(typed.weekday) : null;
    return {kind: typed?.kind === 'special' ? 'special' : 'weekly', weekday: day};
}


// Add a team: the name and the race rhythm with the weekly start time (rhythmFields); weekly on the
// club's day by default. `typed` ({name, start, kind, weekday}, as posted) fills the form again
// after a refusal.
export function newTeamPage(club, {now, seen, others, flash = null, typed = null}) {
    const main = `<main class="page" id="main">
  <header class="pagehead"><p class="kicker desk">${esc(club.name)}</p><h1>${esc(t('team-add-heading'))}</h1></header>
  ${flashBlock(flash)}
  <section class="card">
    <form class="stack" method="post" action="/manage/team">${hidden({action: 'add'})}
      <label class="field">${esc(t('team-name-label'))}<input name="name" value="${esc(typed?.name ?? '')}" maxlength="40" required autocomplete="off" placeholder="${esc(t('nt-placeholder'))}"></label>
      ${rhythmFields(club, {...typedRhythm(typed), start: typed?.start ?? ''})}
      <button class="btn primary block" type="submit">${ic('plus')}${esc(t('team-add'))}</button>
    </form>
  </section>
</main>`;
    return captainPage(club, {now, seen, others, here: '/manage', bar: backBar('/manage', t('tp-nav'), club.name), main, cls: 'formpage'});
}


// POST /manage/live without confirm (the no-script path of every Make live's in-page confirm, spec
// §9): what it does (`words`, liveWords), the outdated marks if any, and a form that posts again with
// confirm=1. `back` 'plan' keeps the way back to the plan page.
export function liveConfirmPage(club, slug, id, {now, seen, others, words, marks = [], back = null}) {
    const team = club.teams[slug].name;
    const name = s => (Object.hasOwn(club.teams, s) ? club.teams[s].name : s);
    const items = marks.map(m => `<p class="outdated">${ic('alert')}${esc(t('tp-outdated-mark', {name: m.name, team: name(m.rides)}))}</p>`);
    const p = planOfId(club, slug, id);
    const toPlan = back === 'plan' && p !== null;
    const home = toPlan ? versionsPath(slug, p.id) : teamPath(slug);
    const intro = marks.length ? `\n  <p class="banner warn" role="note">${ic('alert')}<span>${esc(t('live-confirm-intro'))}</span></p>` : '';
    const fields = {team: slug, sheet: id, ...(toPlan ? {back} : {}), confirm: '1'};
    const main = `<main class="page" id="main">
  <header class="pagehead"><p class="kicker">${esc(t('ui-club-team', {club: club.name, team}))}</p><h1>${esc(t('live-confirm-heading', {label: club.sheets[id].label}))}</h1></header>${intro}
  <section class="card stack">
    <p>${esc(words)}</p>
    ${items.join('\n    ')}
    ${postForm('/manage/live', fields, t(marks.length ? 'live-confirm-button' : 'tp-confirm-live'), {cls: 'btn primary'})}
    <a class="btn secondary" href="${esc(home)}">${ic('left')}${esc(t('live-confirm-back', {team: toPlan ? p.label : team}))}</a>
  </section>
</main>`;
    return captainPage(club, {now, seen, others, here: teamPath(slug), main, cls: 'formpage', needsScript: false});
}
