// The team page /manage/team/<slug> (spec §5.4; plan versions §9, the race-day cockpit), drawn from
// teamView (team-view.mjs): on phones a sticky bar with the team switcher (a <details>, no script
// needed), from 1024 px the same rows in the sidebar of every captain page (ui.mjs captainPage) and
// the team name as the title under the club; one race line with the opening time, "Updated" and
// the stale banner; the "N to fix" notes or the no-start-time callout; "Plans for <day>", one row
// per plan of this race in a fixed order, each a link to its plan page (the live row with its
// version, what it changed and Restore, and a newer version that is not live; every other row with its
// outdated marks, its riders in short and Make live); the live plan's riders under the plans (the
// plan before the gate, each rider's state after it; never the planner's roster). Under the race
// line the two ways to a plan, "Upload a plan" and "Plan on ZwiftGopher" (UI panel wave 3; a team
// without plans has them as the empty card's two big buttons instead). From 1024 px a breadcrumb
// line names the club above the title. Team settings
// is a quiet link at the top right on phones, beside the title from 1024 px, as Club settings is on
// the teams page; without a start time the callout has its own "Set the start time" button. Make
// live and the live plan's Restore ask first in their place only as the Make live rule says (UI
// panel wave 2: the gate open or a warning), else they act at once and the page offers Undo. No "…"
// menu, no status card, no fixed bar. Its settings /manage/team/<slug>/settings (rename, start time,
// race rhythm, event links, delete; what destroys asks first in its place), the new-team page
// /manage/new-team, and the question before Make live: the answer to a POST without confirm=1 that
// must ask, so Make live works without the script. None of those three reloads itself. Pure: it reads the club and the checks it is given, and the clock is
// passed in. Every value goes through esc().
import {esc, t} from './pages.mjs';
import {captainPage, teamRows, rowsHtml, th, flashBlock, hidden, postForm, armForm, freshLine, placeNav, dstBanner} from './ui.mjs';
import {ic} from './icons.mjs';
import {teamView, teamRow, refreshDue, nextRace, worst, andList, quote, liveQuestion, backQuestion, undoOffer, raceWithin, linkedPlan, WAITING_REFRESH_S, plannerHref, teamShare} from './team-view.mjs';
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


// The words a hub button carries after its text for screen readers and voice control: its team
// ("(Rollers)"), as the hub lists the same button for several teams; '' on the team page.
export const teamSr = (view, hub) => (hub ? `<span class="sr"> ${esc(t('hub-team-sr', {team: view.name}))}</span>` : '');


// The button of a note: Remove event link for riders in another event, Upload without <rider> for a
// hole. The club hub's "To do before the race" offers the same (teams-page.mjs) with `hub`: the
// button names its team, and Remove event link comes back to the hub.
export function noteAction(club, view, n, now, {hub = false} = {}) {
    if (n.kind === 'pin') {
        return postForm('/manage/sheet/unpin', {team: view.slug, sheet: n.sheet, ...(hub ? {back: 'hub'} : {})}, t('tp-unpin'),
            {icon: 'unlink', sr: hub ? t('hub-team-sr', {team: view.name}) : null});
    }
    return n.kind === 'hole' ? `<a class="btn secondary small" href="${esc(uploadHref(club, view.slug, view.live.date, now))}">${ic('upload')}${esc(n.linkText)}${teamSr(view, hub)}</a>` : '';
}


function noteHtml(club, view, n, now) {
    const parts = [`<p class="note-title">${ic(noteIcon(n.sev))}<strong>${esc(n.title)}</strong></p>`, `<p>${esc(n.body)}</p>`];
    if (n.kind === 'pin') {
        parts.push(`<ul class="evcount">${n.events.map(e => `<li>${esc(e.text)}</li>`).join('')}</ul>`);
    }
    const act = noteAction(club, view, n, now);
    if (act) {
        parts.push(act);
    }
    parts.push(`<p class="hint">${esc(n.after)}</p>`);
    return `<li class="note ${esc(n.sev)}">
        ${parts.join('\n        ')}
      </li>`;
}


// The plans received from ZwiftGopher (teamView.received, newest first), above everything else: one
// row each with its time, the planner's team name as a hint, the rider count, "Review and store" (its
// assign page, where Make live starts off) and Discard (back to this page), set apart at the right and
// asking first in its place (B1, P2).
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
            + `${discardForm(r.id, teamPath(view.slug), r.line, {small: true})}</div>
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


// The button of the no-start callout: a weekly team sets the time in its settings; a special team's
// race without one (plans stored by 0.3.0) gets it with any upload for that date, so its button is
// the upload page (for the race's plan when it has one plan: a new version needs no type). The club
// hub offers the same, naming the team (`hub`).
export function noStartAction(club, view, now, {hub = false} = {}) {
    return view.special
        ? `<a class="btn secondary small" href="${esc(uploadHref(club, view.slug, view.raceDate, now))}">${ic('upload')}${esc(t('tp-upload-version'))}${teamSr(view, hub)}</a>`
        : `<a class="btn secondary small" href="${esc(settingsPath(view.slug))}">${ic('clock')}${esc(t('tp-set-start'))}${teamSr(view, hub)}</a>`;
}


// No start time: the status itself, red, with what a start time would change (the trap) and its
// button (noStartAction).
function noStartHtml(club, view, now) {
    if (view.status.kind !== 'no-start') {
        return '';
    }
    const body = view.special ? t('tp-no-start-body-special', {day: view.when.day})
        : view.live ? t('tp-no-start-body', {label: view.live.label}) : t('tp-no-start-body-none');
    const button = noStartAction(club, view, now);
    return `<section class="callout err" aria-labelledby="fix-h">
      <h2 id="fix-h">${ic('x')}${esc(view.status.text)}</h2>
      <ol><li class="note err">
        <p>${esc(body)}</p>
        ${view.trap.map(x => `<p>${esc(x.text)}</p>`).join('\n        ')}
        ${button}
      </li></ol>
    </section>`;
}


// "Plan on ZwiftGopher" beside the upload (push.mjs href: a fresh token for this team), in a new tab,
// or '' without one (no PUBLIC_URL). `cls` the link's class: a small button in the head, a block
// button in the empty card. With `short` it reads "ZwiftGopher" on phones (two buttons side by side
// in the head), its name for screen readers the whole text either way.
function plannerLink(planner, cls, {short = false} = {}) {
    if (planner === null) {
        return '';
    }
    const text = short ? `<span class="desk">${esc(t('upload-planner'))}</span><span class="mob">${esc(t('tp-planner-short'))}</span>` : esc(t('upload-planner'));
    return `<a class="${cls}" href="${esc(planner)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(t('tp-planner-label'))}">${ic('external')}${text}</a>`;
}


// Does the team page show the empty card with its two big buttons (Upload a plan, Plan on
// ZwiftGopher)? Not with a live plan, nor with stored plans of this race (they are listed, each with
// Make live).
const emptyButtons = view => !view.live && !view.forRace;


// The two ways to a plan under the race line (UI panel wave 3): "Upload a plan" and "Plan on
// ZwiftGopher", both secondary, side by side at full width on phones; '' where the empty card has them.
function headActs(view, planner) {
    if (emptyButtons(view)) {
        return '';
    }
    return `<div class="headacts"><a class="btn secondary small" href="${esc(uploadPath(view.slug))}">${ic('upload')}${esc(t('tp-upload-plan'))}</a>`
        + `${plannerLink(planner, 'btn secondary small', {short: true})}</div>`;
}


function emptyHtml(view, now, planner = null) {
    if (view.live) {
        return '';
    }
    if (!emptyButtons(view)) {
        // stored plans of this race, none live: they are listed below, each with Make live (a later
        // race's plan alone gives riders nothing: the empty card, review M1)
        return `<section class="card empty" aria-labelledby="empty-h">
      ${ic('noPlan', 'big')}
      <h2 id="empty-h">${esc(t('tp-none-live-title', {team: view.name}))}</h2>
      <p>${esc(t('tp-none-live-body'))}</p>
    </section>`;
    }
    // after the gate riders in the event get a plan within a minute of it going live
    const open = view.gateAt !== null && now >= view.gateAt;
    const body = view.noStart ? esc(t('tp-empty-body-no-start')) : view.status.kind === 'no-race' ? esc(t('tp-empty-body-no-race'))
        : th(open ? 'tp-empty-body-open' : 'tp-empty-body', {at: `<time>${esc(view.opens)}</time>`});
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


// Discard of the inbox entry `id` (a plan received from ZwiftGopher, or an upload on its assign
// page), back to `back`: secondary with danger text, asking first in its place (armForm; without the
// script the server's confirm page), named by `riders` for screen readers.
export function discardForm(id, back, riders, {small = false, team = null} = {}) {
    // on the hub the button names its team first ("Discard… (Rollers) 2 riders (Ben, Cleo)")
    const sr = team === null ? riders : `${t('hub-team-sr', {team})} ${riders}`;
    return armForm(`/manage/inbox/${id}/discard`, {back}, {key: `discard-${id}`, button: t('tp-received-discard'), sr,
        cls: `btn secondary danger-text${small ? ' small' : ''}`, icon: 'trash', formCls: 'discard', words: t('discard-confirm', {riders}),
        yes: t('discard-yes'), yesCls: `btn danger${small ? ' small' : ''}`});
}


// Make live of version `id` of team `slug` (UI panel wave 2, the Make live rule: liveQuestion). When
// it must ask, the trigger `button` ("Make live…") asks first in its place, with what it does in words
// (armForm; without the script the server's confirm page, liveConfirmPage); else the plain button
// `now` ("Make live") acts at once, and the page comes back with Undo. `sr` adds the plan's label
// for screen readers; `back` 'plan' comes back to the plan page; `cls` the trigger's class.
export function makeLiveHtml(club, slug, id, {now, button, plain, sr = true, back = null, cls = 'btn secondary small'}) {
    const team = club.teams[slug];
    const {words, ask} = liveQuestion(club, slug, id, now);
    const fields = {team: slug, sheet: id, version: team.version, ...(back === null ? {} : {back})};
    const label = sr ? quote(club.sheets[id].label) : null;
    if (!ask) {
        return `<form method="post" action="/manage/live">${hidden(fields)}<button class="${esc(cls)}" type="submit">${esc(plain)}${label ? `<span class="sr"> ${esc(label)}</span>` : ''}</button></form>`;
    }
    return armForm('/manage/live', fields, {key: `live-${id}`, button, cls, sr: label, words,
        yes: t(anyway(words) ? 'tp-make-live-anyway' : 'tp-confirm-live'), yesCls: 'btn primary small'});
}


// Restore v`n` of plan `planId` of team `slug` ("Restore vN", UI panel 19 Nov 2026: "Back" is
// navigation): for a live plan it asks first in its place only as the Make live rule says
// (backQuestion: the gate open, moves, holes, no start time), with what it does; else it acts at
// once (Undo follows). A plan that is not live only stores a version: a plain button. `fields` go
// along (back, …); `button` is the trigger's text when it asks, `plain` the button's otherwise.
export function restoreHtml(club, slug, planId, n, now, {fields = {}, button, plain, cls = 'btn secondary small', icon = null}) {
    const all = {team: slug, plan: planId, n, version: club.teams[slug].version, ...fields};
    const q = backQuestion(club, slug, {plan: planId, n}, now);
    if (q === null || !q.ask) {
        // nothing to ask: a plan that is not live, a Restore that acts at once, or one backTo would
        // refuse (the POST says so)
        return postForm('/manage/plan/back', all, plain, {cls, icon});
    }
    return armForm('/manage/plan/back', all, {key: `back-${planId}-${n}`, button, cls, icon, words: q.words,
        yes: t(anyway(q.words) ? 'back-confirm-button' : 'vp-back', {n}), yesCls: 'btn primary small'});
}


// Restore the version before the live one, on the live row (restoreHtml).
function backHtml(club, view, now) {
    const lv = view.live;
    return restoreHtml(club, view.slug, lv.planId, lv.back.n, now, {button: t('tp-back-live', {n: lv.back.n}), plain: t('vp-back', {n: lv.back.n})});
}


// The Undo of the last change of the live plan (undoOffer), for flashBlock: {text, form} or null.
// `back` 'plan' (with `plan`, the id of the plan page it is drawn on) comes back to the plan page of
// the version Undo makes live, and a refusal to the page it was drawn on.
export function undoBlock(club, slug, now, {back = null, plan = null} = {}) {
    const u = undoOffer(club, slug, now);
    if (u === null) {
        return null;
    }
    const fields = {team: slug, version: u.version, ...(back === null ? {} : {back}), ...(plan === null ? {} : {plan})};
    return {
        text: t('undo-line', {n: u.live.n, label: u.live.label}),
        form: `<form method="post" action="/manage/live/undo">${hidden(fields)}<button class="btn secondary small" type="submit">${ic('undo')}`
            + `${esc(t('undo-button'))}<span class="sr"> ${esc(t('undo-sr', {n: u.prev.n, label: u.prev.label}))}</span></button></form>`,
    };
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
// The line of a change of the live plan in the row (team page) or head (plan page) of plan `planId`,
// where the action was (user, 19 Nov 2026): the flash of that change when it is for this plan
// (`flash.row`: Make live, Restore, Undo), with Undo while it is offered; after a reload (or on
// another captain's page) the Undo line alone, for the plan live now. '' when there is neither.
// `opts` as undoBlock's.
export function rowNote(club, slug, planId, now, flash, opts = {}) {
    const mine = flash?.kind === 'ok' && flash.row === planId ? flash : null;
    const u = undoOffer(club, slug, now);
    const offer = u !== null && u.live.plan === planId ? undoBlock(club, slug, now, opts) : null;
    return mine === null && offer === null ? '' : flashBlock(mine, offer);
}


// Does `flash` belong in the row of plan `planId` (rowNote) rather than at the top of the page?
export const inRow = (flash, planId) => flash?.kind === 'ok' && typeof flash.row === 'string' && flash.row === planId;


function liveRow(club, view, p, day, now, flash) {
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
          <div class="l3"><p class="vsum">${esc(lv.summary ?? '')}</p>${backHtml(club, view, now)}</div>`;
    const nw = lv.newer;
    const newer = nw === null ? '' : `
          <div class="newer">
            <p>${ic('info')}<span>${esc(t('tp-newer', {n: nw.n, at: nw.at ?? '–'}))}</span></p>
            ${makeLiveHtml(club, view.slug, nw.id, {now, button: t('tp-make-newer-live', {n: nw.n}), plain: t('tp-make-newer-live-now', {n: nw.n}), sr: false})}
          </div>`;
    const note = rowNote(club, view.slug, p.planId, now, flash);
    return `<li class="planrow live" id="plan-${esc(p.planId)}">
          ${rowHead(view, p, tag, day)}
          <p class="l2">${l2.join('')}</p>${note ? `
          ${note}` : ''}${changed}${newer}
        </li>`;
}


// Another plan's row: label and version, its outdated marks, its riders in short, Make live.
function planRow(club, view, p, day, now) {
    const marks = p.marks.length === 0 ? ''
        : `
          <p class="outdated">${ic('alert')}${esc(t('tp-outdated', {marks: andList(p.marks.map(m => t('tp-outdated-mark', {name: m.name, team: m.ridesName})))}))}</p>`;
    const names = p.names.join(', ') + (p.riders > p.names.length ? ' …' : '');
    const riders = p.riders === 1 ? t('tp-row-riders-one', {names}) : t('tp-row-riders', {n: p.riders, names});
    return `<li class="planrow" id="plan-${esc(p.planId)}">
          ${rowHead(view, p, '', day)}${marks}
          <div class="l4"><p class="meta">${esc(riders)}</p>${makeLiveHtml(club, view.slug, p.id, {now, button: t('tp-make-live-ask'), plain: t('tp-confirm-live')})}</div>
        </li>`;
}


// "Plans for Thu 19 Nov": one row per plan of this race in a fixed order (teamView.plans), each a
// link to its plan page. The heading names the day when every plan is for it.
function plansHtml(club, view, now, flash = null) {
    if (!view.plans.length) {
        return '';
    }
    const day = view.live?.day ?? view.when.day;
    const head = day !== null && view.plans.every(p => p.day === day) ? t('tp-plans', {day}) : t('tp-plans-any');
    const rows = view.plans.map(p => (p.live && view.live ? liveRow(club, view, p, day, now, flash) : planRow(club, view, p, day, now)));
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
    // the phone's bar is the team switcher; from 1024 px the breadcrumb instead of the kicker
    const {crumbs} = placeNav(club, [{label: view.name}], {back: false});
    const main = `<main class="page wide" id="main">
  ${crumbs}
  <header class="pagehead">
    <div class="teamhead"><p class="kicker">${esc(club.name)}</p><h1 class="desk">${esc(view.name)}</h1><a class="btn quiet small" href="${esc(settingsPath(slug))}">${ic('settings')}${esc(t('tp-settings'))}</a></div>
    ${raceLine(view, now)}${headActs(view, planner) ? `
    ${headActs(view, planner)}` : ''}
    ${freshLine(updated, path)}
  </header>
  ${dstChangedRecently(club.tz, now) ? dstBanner() : ''}
  ${view.live && inRow(flash, view.live.planId) ? '' : flashBlock(flash)}
  <div class="cols">
    <div class="col-a">${receivedHtml(view)}${notesHtml(club, view, now)}${noStartHtml(club, view, now)}${emptyHtml(view, now, planner)}${plansHtml(club, view, now, flash)}</div>
    <div class="col-b">${ridersHtml(view)}</div>
  </div>
</main>`;
    // every 30 s around a race; else every 60 s while plans from ZwiftGopher wait, so the next one
    // comes in by itself
    const race = refreshDue(club, now);
    const reload = refresh && (race || view.received.length > 0);
    return captainPage(club, {now, seen, others, here: path, herePage: true, rows, bar: switchBar(club, view, rows, now), main,
        cls: 'teampage', refresh: reload ? path : null, refreshS: race ? 30 : WAITING_REFRESH_S, updated});
}


// A team that no longer exists (deleted, renamed away, or a wrong link): back to the teams. The
// caller sets the status (404 for a GET, the refusal's for a POST). `now`, `seen`, `others`:
// captainPage's, as on every page below.
export function teamGonePage(club, {now, seen, others, flash = null}) {
    const nav = placeNav(club, [{label: t('crumb-gone')}]);
    const main = `<main class="page" id="main">
  ${nav.crumbs}
  ${flashBlock(flash)}
  <section class="card empty" aria-labelledby="gone-h">
    ${ic('team', 'big')}
    <h1 id="gone-h">${esc(t('tp-gone'))}</h1>
    <p>${esc(t('tp-gone-hint'))}</p>
    <a class="btn primary block" href="/manage">${esc(t('tp-all-teams'))}</a>
  </section>
</main>`;
    return captainPage(club, {now, seen, others, here: '/manage', bar: nav.bar, main, needsScript: false});
}


// An unknown /manage/... path (a wrong or old link): a 404 page in the captain frame with the way to
// the teams, not bare text.
export function manageNotFoundPage(club, {now, seen, others}) {
    const nav = placeNav(club, [{label: t('crumb-gone')}]);
    const main = `<main class="page" id="main">
  ${nav.crumbs}
  <section class="card empty" aria-labelledby="gone-h">
    ${ic('info', 'big')}
    <h1 id="gone-h">${esc(t('manage-not-found'))}</h1>
    <p>${esc(t('manage-not-found-hint'))}</p>
    <a class="btn primary block" href="/manage">${esc(t('tp-all-teams'))}</a>
  </section>
</main>`;
    return captainPage(club, {now, seen, others, here: '/manage', bar: nav.bar, main, needsScript: false});
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
            + `${ic('unlink')}${esc(t('tp-unpin'))}<span class="sr"> ${esc(t('ts-unpin-sr', {label: p.label}))}</span></button></form></li>`;
    });
    return `<ul class="rows">${rows.join('\n      ')}</ul>
    <p class="hint">${esc(t('ts-links-hint'))}</p>`;
}


// The start time card: a weekly team's form; a special team has none (user, 19 Nov 2026), only a
// line that says where its times come from. `start` is the field's value. Clearing it while a race
// of the team is within 7 days asks first in its place (S11; the server asks too).
function startCard(club, view, start, now) {
    if (view.special) {
        return `<section class="card" aria-labelledby="start-h">
    <h2 id="start-h">${esc(t('team-start-label'))}</h2>
    <p class="hint">${esc(t('ts-start-special'))}</p>
  </section>`;
    }
    const field = `
      <label class="field"><span class="sr">${esc(t('team-start-label'))}</span><input type="time" name="start" value="${esc(start)}"></label>
      `;
    const form = raceWithin(club, view.slug, now)
        ? armForm('/manage/team', {action: 'start', team: view.slug}, {key: 'start', body: field, button: t('team-set-start'), cls: 'btn primary',
            formCls: 'inline-form', when: {when: 'empty', field: 'start'}, words: t('ts-start-clear-confirm', {team: view.name}),
            yes: t('ts-start-clear-yes'), yesCls: 'btn danger'})
        : `<form class="inline-form" method="post" action="/manage/team">${hidden({action: 'start', team: view.slug})}${field}<button class="btn primary" type="submit">${esc(t('team-set-start'))}</button>
    </form>`;
    return `<section class="card" aria-labelledby="start-h">
    <h2 id="start-h">${esc(t('team-start-label'))}</h2>
    ${form}
    <p class="hint">${esc(t('ts-start-hint', {tz: club.tz, team: view.name}))}</p>
  </section>`;
}


// What Delete team does, in words: the team, its plans, the inbox, the recordings.
export function teamDeleteWords(club, slug) {
    const team = club.teams[slug].name;
    const plans = plansOf(club, slug).length;
    return plans === 0 ? t('ts-delete-body-none', {team}) : plans === 1 ? t('ts-delete-body-one', {team}) : t('ts-delete-body', {team, n: plans});
}


// The settings of team `slug` (a team of the club). `typed` ({name}, {start} or {kind, weekday}, as
// posted) is shown in its form instead of the stored value after a refusal. `push` (the server has
// PUBLIC_URL, so the team page offers "Plan on ZwiftGopher") adds "New ZwiftGopher link", which
// ends every link the team page has handed out for this team.
export function teamSettingsPage(club, slug, {now, seen, others, flash = null, typed = null, push = false}) {
    const view = teamView(club, slug, {now});
    const name = typed?.name ?? view.name;
    const start = typed?.start ?? view.start ?? '';
    const delBody = teamDeleteWords(club, slug);
    const del = t('team-delete-button', {team: view.name});
    const nav = placeNav(club, [{href: teamPath(slug), label: view.name}, {label: t('tp-settings')}]);
    const main = `<main class="page" id="main">
  ${nav.crumbs}
  <header class="pagehead"><p class="kicker">${esc(view.name)}</p><h1>${esc(t('tp-settings'))}</h1></header>
  ${flashBlock(flash)}
  <section class="card" aria-labelledby="name-h">
    <h2 id="name-h">${esc(t('ts-name'))}</h2>
    <form class="inline-form" method="post" action="/manage/team">${hidden({action: 'rename', team: slug})}
      <label class="field"><span class="sr">${esc(t('team-name-label'))}</span><input name="name" value="${esc(name)}" maxlength="40" required autocomplete="off"></label>
      <button class="btn primary" type="submit">${esc(t('team-rename'))}</button>
    </form>
    <p class="hint">${esc(t('ts-name-hint'))}</p>
  </section>
  ${startCard(club, view, start, now)}
  ${rhythmCard(club, slug)}
  <section class="card" aria-labelledby="link-h">
    <h2 id="link-h">${esc(t('ts-links'))}</h2>
    ${linksHtml(club, view, now)}
  </section>${push ? `
  <section class="card" aria-labelledby="push-h">
    <h2 id="push-h">${esc(t('ts-push'))}</h2>
    ${armForm('/manage/team', {action: 'push-link', team: slug}, {key: 'push', button: t('ts-push-new'), cls: 'btn secondary danger-text small', icon: 'link',
        words: t('ts-push-confirm', {team: view.name}), yes: t('ts-push-yes'), yesCls: 'btn danger small'})}
    <p class="hint">${esc(t('ts-push-hint'))}</p>
  </section>` : ''}
  <section class="danger-zone" aria-labelledby="del-h">
    <h2 id="del-h">${ic('trash')}${esc(del)}</h2>
    ${armForm('/manage/team', {action: 'delete', team: slug}, {key: 'team-delete', button: t('ts-delete-open'), cls: 'btn secondary danger-text', icon: 'trash',
        words: delBody, yes: del, yesCls: 'btn danger'})}
  </section>
</main>`;
    return captainPage(club, {now, seen, others, here: teamPath(slug), bar: nav.bar, main, cls: 'formpage'});
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
      <button class="btn primary" type="submit">${esc(t('ts-rhythm-save'))}</button>
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
    const nav = placeNav(club, [{label: t('team-add-heading')}]);
    const main = `<main class="page" id="main">
  ${nav.crumbs}
  <header class="pagehead"><h1>${esc(t('team-add-heading'))}</h1></header>
  ${flashBlock(flash)}
  <section class="card">
    <form class="stack" method="post" action="/manage/team">${hidden({action: 'add'})}
      <label class="field">${esc(t('team-name-label'))}<input name="name" value="${esc(typed?.name ?? '')}" maxlength="40" required autocomplete="off" placeholder="${esc(t('nt-placeholder'))}"></label>
      ${rhythmFields(club, {...typedRhythm(typed), start: typed?.start ?? ''})}
      <button class="btn primary block" type="submit">${ic('plus')}${esc(t('team-add'))}</button>
    </form>
  </section>
</main>`;
    return captainPage(club, {now, seen, others, here: '/manage', bar: nav.bar, main, cls: 'formpage'});
}


// POST /manage/live without confirm (the no-script path of every Make live's in-page confirm, spec
// §9): what it does (`words`, liveWords), the outdated marks if any, and a form that posts again with
// confirm=1. `back` 'plan' keeps the way back to the plan page. `undo` ({version, plan}: an Undo
// that has to ask, UI panel wave 2) asks it as an Undo: its form posts the Undo again, so it is
// confirmed as one (its own flash, no Undo of it).
export function liveConfirmPage(club, slug, id, {now, seen, others, words, marks = [], back = null, undo = null}) {
    const team = club.teams[slug].name;
    const name = s => (Object.hasOwn(club.teams, s) ? club.teams[s].name : s);
    const items = marks.map(m => `<p class="outdated">${ic('alert')}${esc(t('tp-outdated-mark', {name: m.name, team: name(m.rides)}))}</p>`);
    const p = planOfId(club, slug, id);
    const toPlan = back === 'plan' && p !== null;
    const home = toPlan ? versionsPath(slug, p.id) : teamPath(slug);
    const intro = marks.length ? `\n  <p class="banner warn" role="note">${ic('alert')}<span>${esc(t('live-confirm-intro'))}</span></p>` : '';
    // the words are drawn now, so the form carries the team's version now
    const fields = undo !== null ? {team: slug, version: undo.version, ...(back === null ? {} : {back}), ...(undo.plan ? {plan: undo.plan} : {}), confirm: '1'}
        : {team: slug, sheet: id, version: club.teams[slug].version, ...(toPlan ? {back} : {}), confirm: '1'};
    const heading = t(undo !== null ? 'undo-confirm-heading' : 'live-confirm-heading', {label: club.sheets[id].label, n: club.sheets[id].n});
    // the crumbs end where the way back goes: the plan page, or the team page
    const trail = [{href: teamPath(slug), label: team}, ...(toPlan ? [{href: home, label: p.label}] : []), {label: t('crumb-confirm')}];
    const main = `<main class="page" id="main">
  ${placeNav(club, trail, {back: false}).crumbs}
  <header class="pagehead"><p class="kicker">${esc(t('ui-club-team', {club: club.name, team}))}</p><h1>${esc(heading)}</h1></header>${intro}
  <section class="card stack">
    <p>${esc(words)}</p>
    ${items.join('\n    ')}
    <div class="confirm-acts">${postForm(undo !== null ? '/manage/live/undo' : '/manage/live', fields, t(anyway(words) ? 'live-confirm-button' : 'tp-confirm-live'), {cls: 'btn primary'})}
    <a class="btn secondary" href="${esc(home)}">${ic('left')}${esc(t('live-confirm-back', {team: toPlan ? p.label : team}))}</a></div>
  </section>
</main>`;
    return captainPage(club, {now, seen, others, here: teamPath(slug), main, cls: 'formpage', needsScript: false});
}
