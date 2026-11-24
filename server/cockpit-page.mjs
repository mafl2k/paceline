// The team page /manage/team/<slug>, the team cockpit (team cockpit spec §5.1-§5.3b, §6, §8): the
// frame (the switch bar, title with Team settings, the ways to a plan (no breadcrumb and no rhythm
// line: the sidebar and the race's line say them, user 23 Nov 2026),
// "Updated", the DST banner), then one grid .cp of the page's slots in this order in the document:
// #panel (the flash and the top of the card), .cp-list (the list per race: the plans not stored yet,
// the plans in their fixed order, their versions, the races that are over, "How races work") and
// #panel-body (the card's body: the rider table, a received plan's Store form, what happens, the
// action bar). Every row of the list is a link alone, with no form beside it (user, 23 Nov 2026), so
// the list never changes height when something is picked. The card shows what is
// picked, and with nothing picked the nearest race's live version (spec §5.3b), its row marked. From
// 1180 px the list is the left column and the card the right one; below that they stack, the card
// right after the nearest race, and a picked row opens it as a sheet (body.has-sel, §5.5). Every row
// is a plain link to the page with that selection (`?v=` / `?e=`, #panel); the script swaps the two
// slots in place from the fragment (cockpitFragment), drawn by the same function. Pure: it reads the
// club and the checks it is given, and the clock is passed in. Every value goes through esc().
import {esc, t} from './pages.mjs';
import {captainPage, teamRows, withClub, freshLine, dstBanner, sevLine, th} from './ui.mjs';
import {ic} from './icons.mjs';
import {refreshDue, WAITING_REFRESH_S, plannerHref, teamShare} from './team-view.mjs';
import {
    cockpitPath, switchBar, raceHead, notesHtml, noStartHtml, headActs, emptyHtml, racesHelpHtml, planMenu,
    liveTag, phaseTag, racePhase, planCode,
} from './team-page.mjs';
import {cockpitView} from './cockpit-view.mjs';
import {panelParts, pendingLine} from './cockpit-panel.mjs';
import {tableModel, planTable, tableBase} from './plan-table.mjs';
import {versionName, shownType} from './plans.mjs';
import {resultHolds} from './store-form.mjs';
import {localHHMM, dstChangedRecently} from './time.mjs';

export {cockpitPath};

const settingsPath = slug => `/manage/team/${slug}/settings`;


// The query of the page's selection ('?v=<id>', '?e=<id>', '?r=<date>'; '' for none or one that is gone).
const selQuery = sel => (sel.kind === 'version' ? `?v=${sel.id}` : sel.kind === 'entry' ? `?e=${sel.id}` : sel.kind === 'race' && sel.date !== null ? `?r=${sel.date}` : '');


// Does the page of `view` reload itself (with the script, or its <noscript> meta refresh)? Every 30 s
// around a race (refreshDue); else every 60 s while plans from ZwiftGopher wait.
const reloadDue = (club, view, now) => refreshDue(club, now) || view.received.length > 0;


// What the page says while its slots hold its reload (Ruling I2 (b)): "Not updating while the Store
// form is open · Refresh" (or "… this result is shown …"), the last thing in #panel-acts, under the
// card; Refresh is a plain link to the page with the same selection, which draws it again (the
// one-shot result gone).
function holdNote(view, path, kind) {
    const here = view.panel.kind === 'entry' ? `${path}?e=${view.panel.id}` : `${path}${selQuery(view.sel)}`;
    const refresh = `<a class="cp-refresh" href="${esc(here)}">${esc(t('cp-refresh'))}</a>`;
    return `<p class="cp-hold">${th(kind === 'entry' ? 'cp-hold-form' : 'cp-hold-result', {refresh})}</p>`;
}


// The slots of the page (shapes), as markup: {kind, hold, panel, body, acts} (panelParts: one card in
// every state; `acts` #panel-acts, the card's actions, user 23 Nov 2026). One function for the page and the fragment. #panel carries the state the slots
// imply, so the script marks the list from a fragment as the page draws it: data-kind (what the card
// shows) and data-sel (the row the card shows, picked in the list: the selection's,
// or with nothing picked the nearest race's live version; '' for none); data-result when it holds a
// Store result (a phone's head then flows with the page, M3). `hold`: the slots hold the page's reload (an
// open Store form, or a Store result with something to keep: resultHolds); while they do and the page
// would reload (`reloads`), #panel-acts ends with holdNote (under the card at every width: below
// 1180 px after the bar at the card's bottom, from 1180 px in the row under the card).
function slotsOf(club, view, {now, path, flash, choices, preview, reloads}) {
    const parts = panelParts(club, view, {now, path, flash, choices, preview});
    const hold = parts.kind === 'entry' || resultHolds(flash);
    const note = hold && reloads ? holdNote(view, path, parts.kind) : '';
    return {
        kind: parts.kind,
        hold,
        panel: `<div id="panel" data-kind="${esc(parts.kind)}" data-sel="${esc(parts.sel)}" tabindex="-1"${flash?.result ? ' data-result' : ''}>${parts.head}</div>`,
        body: `<div id="panel-body">${parts.body}</div>`,
        acts: `<div id="panel-acts">${parts.acts === '' ? '' : `<div class="cp-bar">${parts.acts}</div>`}${note}</div>`,
    };
}


const chev = () => ic('right', 'chev');
const linkAttrs = (href, picked) => `class="cp-link" href="${esc(href)}"${picked ? ' aria-current="true"' : ''}`;


// One version's row: a link to the page with it picked ("v3 · 4/6 have it" after the gate, "v2 ·
// Hanna in, Ben out"); the live version's links to its race's live pointer (`?r=<date>`), so a reload
// follows live; the newer version not live reads "v4 · not live". Nothing beside the link (user, 23
// Nov 2026): Make live is in the card's action bar, there is no Undo.
function versionRow(r, {path, sent, phase = null, over = false}) {
    const cls = ['cp-row', r.live ? 'live' : '', r.picked ? 'picked' : ''].filter(Boolean).join(' ');
    // the version's number and its status, no time (user, 23 Nov 2026: the card says when it was stored)
    const first = r.notice ? t('cp-newer', {n: r.n}) : t('cp-row', {n: r.n});
    const text = [first, r.has, r.summary].filter(x => x !== null).join(' · ');
    // the live row's LIVE tag at its end ("Not sent" without a start time; grey under Over), not on
    // the plan's head (a space before it: a screen reader reads "… have it Live", not "have itLive"),
    // then the race's phase (phaseTag: "Sending", "Started"; user, 23 Nov 2026)
    const tag = r.live ? ` ${liveTag({sent, over}).trim()}${phaseTag(phase)}` : '';
    const href = r.race === null ? `${path}?v=${r.id}#panel` : `${path}?r=${r.race}#panel`;
    return `<li class="${cls}" data-sel="v:${esc(r.id)}"><a ${linkAttrs(href, r.picked)}><span class="cp-what">${esc(text)}</span>${tag}${chev()}</a></li>`;
}


// A list of rows; `sel-rows` on the one that holds the row a selection picked (the phone's sheet,
// Task 10; not the live row picked with nothing selected: no sheet is open).
const rowsList = (items, picked) => `<ul class="cp-rows${picked ? ' sel-rows' : ''}">${items.join('')}</ul>`;


// "Not stored yet": the plans received from ZwiftGopher and the uploads of this race, newest first;
// '' without any. `sfx` follows the heading's id ('-<date>' for a later race). A picked one is a
// plain picked row: its Store form is in the card.
function pendingHtml(list, path, sfx) {
    if (!list.pending.length) {
        return '';
    }
    const items = list.pending.map(p => `<li class="cp-row${p.picked ? ' picked' : ''}" data-sel="e:${esc(p.id)}">`
        + `<a ${linkAttrs(`${path}?e=${p.id}#panel`, p.picked)}><span class="cp-what">${esc(pendingLine(p))}</span>${chev()}</a></li>`);
    return `<section class="cp-pending" aria-labelledby="pending-h${esc(sfx)}"><h3 class="cp-sub" id="pending-h${esc(sfx)}">${esc(t('cp-pending'))}</h3>`
        + `${rowsList(items, list.pending.some(p => p.sheet))}</section>`;
}


// The block of one plan: its tag (Live, or Not sent without a start time), its label and its ⋯
// (planMenu: no Make live in it, every version row has it in the panel), then its versions newest
// first, the older ones in a fold of links only (it keeps the reload).
function planHtml(club, slug, p, {path, now, planner, sent, phase = null, over = false}) {
    const rows = p.shown.map(r => versionRow(r, {path, sent, phase, over}));
    const n = p.older.length;
    const older = n === 0 ? '' : `<details class="fold cp-older" data-keep-refresh><summary>${esc(n === 1 ? t('cp-older-one') : t('cp-older', {n}))}</summary>`
        + `${rowsList(p.older.map(r => versionRow(r, {path, sent, phase, over})), p.older.some(r => r.sheet))}</details>`;
    return `<section class="cp-plan${p.live ? ' live' : ''}" id="plan-${esc(p.planId)}" aria-labelledby="plan-h-${esc(p.planId)}">
      <div class="rowtop"><h3 class="cp-plan-head" id="plan-h-${esc(p.planId)}"><span class="label">${esc(shownType(p.type))}</span></h3>${planMenu(club, slug, p.planId, {now, planner})}</div>
      ${rowsList(rows, p.shown.some(r => r.sheet))}${older}
    </section>`;
}


const holdsPick = list => list.pending.some(p => p.sheet) || list.plans.some(p => [...p.shown, ...p.older].some(r => r.sheet));


// A race ahead: its line with its ⋯; the nearest race its notes, its no-start callout and its empty
// card as on the team page; then the plans not stored yet and the plans. A later race keeps its fold
// with its notes and riders card (closed; it keeps the reload while it holds no form), or its
// status without a live plan. `rv` is the race's raceView, `first` the nearest race.
function raceHtml(club, view, list, rv, {first, path, now, planner, plannerLink}) {
    const sfx = first ? '' : `-${list.date}`;
    const id = list.date === null || (first && view.regular) ? '' : ` id="race-${esc(list.date)}"`;
    const cls = `race cp-race${first ? '' : ' later'}${holdsPick(list) ? ' sel-race' : ''}`;
    const sent = rv.live ? rv.live.sent : true;
    const plans = list.plans.map(p => planHtml(club, view.slug, p, {path, now, planner, sent, phase: racePhase(rv, now)}));
    const top = first ? `${notesHtml(club, rv, now)}${noStartHtml(club, rv, now)}${emptyHtml(rv, now, plannerLink)}` : '';
    let more = '';
    if (!first) {
        if (rv.live) {
            const inner = `<div class="cols">${notesHtml(club, rv, now, sfx)}${noStartHtml(club, rv, now, sfx)}${ridersCard(club, rv, now, {sfx})}</div>`;
            const keep = /<form\b/.test(inner) ? '' : ' data-keep-refresh';
            const n = rv.notes.length;
            more = `<details class="fold race-more"${keep}><summary>${esc(n ? t('tp-race-more-fix', {n}) : t('tp-race-more'))}</summary>${inner}</details>`;
        } else {
            more = sevLine(rv.status.sev, rv.status.icon, rv.status.text, 'race-status');
        }
    }
    return `<div class="${cls}"${id}>
    ${raceHead(club, rv, now)}${top}${pendingHtml(list, path, sfx)}
    ${plans.join('\n    ')}${more}
  </div>`;
}


// The races that are over, in their fold (open when it holds the picked version): each race's day
// and its plans, read only (no Make live; the plan ⋯ has Delete only). It holds forms only in its ⋯
// menus, each a <details> of its own that holds the reload while open, so the fold keeps it.
function overHtml(club, view, {path, now, planner}) {
    if (!view.overLists.length) {
        return '';
    }
    const open = view.overLists.some(holdsPick);
    const races = view.overLists.map(list => `<div class="race cp-race over${holdsPick(list) ? ' sel-race' : ''}" id="race-${esc(list.date)}">
      <p class="race"><span>${esc(list.day)}</span></p>
      ${list.plans.map(p => planHtml(club, view.slug, p, {path, now, planner, sent: true, over: true})).join('\n      ')}
    </div>`);
    return `<details class="fold over" id="over" data-keep-refresh${open ? ' open' : ''}><summary>${esc(t('tp-over', {n: view.overLists.length}))}</summary>
    ${races.join('\n    ')}
  </details>`;
}


// A later race's riders card, in its fold (team cockpit spec §7 amended 22 Nov 2026): the live
// version of that race (`view`, its raceView) in the rider table, as riders get it (tableBase: no
// marks), the live version's plan code under the head. Before the gate the head counts the riders
// and the hint says from when the states show; after it (view.open) the table has the Plan column,
// each rider's state, the head says "4 of 6 have the plan" and the help fold says what the states
// mean (it holds no form, so an open one keeps the reload). `sfx` follows the heading's id
// ('-<date>'). '' without a live plan. (The nearest race's is the panel's card: cockpit-panel.mjs.)
function ridersCard(club, view, now, {sfx = ''} = {}) {
    if (!view.live) {
        return '';
    }
    const live = view.live.id;
    const model = tableModel(club, club.sheets[live], tableBase(club, view.slug, live), {now});
    const n = view.count;
    let count;
    let states = null;
    let hint;
    if (view.open) {
        const has = `<strong>${esc(t('tp-has-count', {has: view.has, n}))}</strong>`;
        count = th(n === 1 ? 'tp-has-one' : 'tp-has', {count: has});
        states = new Map(view.riders.map(r => [r.id, r.state]));
        hint = `<details class="help" data-keep-refresh><summary>${ic('info')}${esc(t('tp-help'))}</summary><p class="hint">${esc(t('tp-help-text'))}</p></details>`;
    } else {
        count = esc(n === 1 ? t('tp-riders-one') : t('tp-riders-n', {n}));
        hint = view.live.sent ? `<p class="hint">${th('tp-plan-hint', {at: `<time>${esc(view.opens)}</time>`})}</p>`
            : `<p class="hint">${esc(t(view.special ? 'tp-no-start-hint-special' : 'tp-no-start-hint'))}</p>`;
    }
    return `<section class="card riders-card" aria-labelledby="riders-h${esc(sfx)}">
      <div class="card-head"><h2 id="riders-h${esc(sfx)}">${esc(t('tp-riders-on', {name: versionName(view.live.type, view.live.n)}))}</h2><p class="count">${count}</p></div>
      ${planCode(view.live.sig)}
      ${planTable(model, {states})}
      ${hint}
    </section>`;
}


// The whole page of team `slug` (a team of the club) with selection `sel` (cockpit-view.mjs
// selectionOf). `seen`, `others`: captainPage's; `flash` the one-shot flash (in the panel's head);
// `refresh` false keeps it from reloading itself (a refusal answers a POST); `planner` push.mjs href
// with a fresh token, or null. `choices` and `preview` are a received plan's Store form's
// (manage-cockpit.mjs entryDraw). The page holds its reload (team cockpit spec §5.4, Rulings F5 and
// I2) while it shows an open Store form or a Store result with something to keep (slotsOf's `hold`):
// no meta refresh (without the script nothing could hold it), data-refresh kept (the script holds
// while [data-hold-reload] is on the page and reloads again once a swap to a version or to nothing
// took it away), and the page says so (holdNote); a version picked, nothing, or a clean Store
// result keeps both. Without the script its note says what still works (M11).
export function cockpitPage(club, slug, {now, seen = {}, others = [], flash = null, refresh = true, planner = null,
    sel = {kind: 'none'}, choices = null, preview = null}) {
    const view = cockpitView(club, slug, {now, seen, sel});
    const plannerLink = plannerHref(planner, teamShare(club, slug, now));
    const rows = teamRows(club, {now, seen}, view);
    const path = cockpitPath(slug);
    const here = `${path}${selQuery(sel)}`;
    const updated = localHHMM(now, club.tz);
    const race = refreshDue(club, now);
    const reload = refresh && reloadDue(club, view, now);
    const slots = slotsOf(club, view, {now, path, flash, choices, preview, reloads: reload});
    const races = view.lists.map((list, i) => raceHtml(club, view, list, view.races[i] ?? view,
        {first: i === 0, path, now, planner, plannerLink}));
    const acts = headActs(view, plannerLink);
    // data-here: the page's own URL for what it drew, also when it answers a POST at another URL (a
    // refused Store at /manage/inbox/<id>): the script puts it in the address bar, so its redraws,
    // Back and its reload ask the cockpit, never the POST's URL
    const main = `<main class="page wide cockpit" id="main" data-tv="${esc(club.teams[slug].version)}" data-here="${esc(here)}">
  <header class="pagehead">
    <div class="teamhead"><p class="kicker">${esc(club.name)}</p><h1 class="desk">${esc(view.name)}</h1><a class="btn quiet small" href="${esc(settingsPath(slug))}">${ic('settings')}${esc(t('tp-settings'))}</a></div>
${acts ? `
    ${acts}` : ''}
    ${freshLine(updated, here)}
  </header>
  ${dstChangedRecently(club.tz, now) ? dstBanner() : ''}
  <div class="cp">
  ${slots.panel}
  <div class="cp-list" role="region" aria-label="${esc(t('cp-list'))}">
  ${acts ? `<div class="cp-ways">${acts}</div>
  ` : ''}${races.join('\n  ')}
  ${overHtml(club, view, {path, now, planner})}${racesHelpHtml()}
  </div>
  ${slots.body}
  ${slots.acts}
  </div>
</main>`;
    // every 30 s around a race; else every 60 s while plans from ZwiftGopher wait; the selection
    // stays. With a received plan picked (an open Store form) or a Store result to keep the script
    // holds it ([data-hold-reload]) and lets it go once a swap takes the form or the result away, so
    // the page keeps data-refresh but has no meta refresh (without the script nothing could hold it).
    // has-sel only for a selection in the URL (a phone's sheet); the card nothing picked draws is no sheet
    const cls = ['teampage', 'cockpit', sel.kind !== 'none' ? 'has-sel' : ''].filter(Boolean).join(' ');
    return captainPage(club, {now, seen, others, here: `/manage/team/${slug}`, herePage: true, rows, bar: switchBar(club, view, rows, now), main,
        cls, refresh: reload ? here : null, refreshS: race ? 30 : WAITING_REFRESH_S, noscript: !slots.hold, updated, needsScript: 'cp-needs-js'});
}


// The slots alone (shapes: #panel, #panel-body, #panel-acts, in this order), as the whole page
// draws them, club field included: the answer to the script's panel fetch. Never the
// one-shot flash (the next whole page shows it); `flash` is only a refusal drawn now (the parse
// budget's). An open Store form carries data-hold-reload in it, so the script can tell on each swap,
// and the note that says so (holdNote) when the page reloads at all.
export function cockpitFragment(club, slug, {now, seen = {}, sel, choices = null, preview = null, flash = null}) {
    const view = cockpitView(club, slug, {now, seen, sel});
    const s = slotsOf(club, view, {now, path: cockpitPath(slug), flash, choices, preview, reloads: reloadDue(club, view, now)});
    return withClub(s.panel + s.body + s.acts, club.id);
}
