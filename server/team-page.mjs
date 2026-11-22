// The pieces of the team page /manage/team/<slug> (the team cockpit, cockpit-page.mjs, draws the
// page itself) and the team's other pages, drawn from teamView (team-view.mjs). The frame pieces: on
// phones a sticky bar with the team switcher (a <details>, no script needed; from 1024 px the same
// rows in the sidebar of every captain page, ui.mjs captainPage), the team's rhythm, the line of a
// race with its ⋯ (races spec §4, §7: its date and time asking first, its event link, the upload of
// a file for it), the plan ⋯ (Rename, New version, "Edit on ZwiftGopher", Delete asking first; for a
// race that is over Delete only), the "N to fix" notes and the no-start callout with their buttons
// (the club hub offers the same), the ways to a plan ("Plan on ZwiftGopher", "Upload a plan"), the
// empty card, Discard of an inbox entry, Make live asking first in its place as the Make live rule
// says (UI panel wave 2: the gate open or a warning) and its Undo, the live tag, the plan code and
// "How races work" (the riders card is cockpit-page.mjs's). The team's settings /manage/team/<slug>/settings (rename, start time, race
// rhythm, delete; what destroys asks first in its place), the new-team page /manage/new-team, the
// pages of a team that is gone and of an unknown path, and the question before Make live: the answer
// to a POST without confirm=1 that must ask, so Make live works without the script. None of the
// pages reloads itself. Pure: it reads the club and the checks it is given, and the clock is passed
// in. Every value goes through esc().
import {esc, t} from './pages.mjs';
import {captainPage, rowsHtml, th, flashBlock, hidden, postForm, armForm, placeNav, menu} from './ui.mjs';
import {ic} from './icons.mjs';
import {teamView, teamRow, nextRace, worst, quote, liveQuestion, undoOffer, raceWithin, plannerHref} from './team-view.mjs';
import {uploadHref} from './upload-page.mjs';
import {plansOf, planOfId} from './plans.mjs';
import {teamWeekday, raceOver} from './select.mjs';
import {raceOf} from './races.mjs';
import {isShare, TYPE_MAX} from './club.mjs';
import {isWeekday} from './time.mjs';

const teamPath = slug => `/manage/team/${slug}`;
// The team page, the team cockpit (team cockpit spec §8; cockpit-page.mjs).
export const cockpitPath = slug => `/manage/team/${slug}`;
const settingsPath = slug => `/manage/team/${slug}/settings`;
const uploadPath = slug => `/manage/upload?team=${slug}`;

const noteIcon = sev => (sev === 'err' ? 'x' : 'alert');


// The sticky top bar (phones): back to the teams, the team name as the switcher's summary, its panel
// the team rows `list` (teamRows: the sidebar's, from 1024 px).
export function switchBar(club, view, list, now) {
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


// The team's race rhythm in the head (races spec §4): "Weekly · Thursday 19:30", or that a special
// team's races each have their own date and time.
export function rhythmLine(club, view) {
    if (view.special) {
        return `<p class="rhythm">${esc(t('tp-rhythm-special'))}</p>`;
    }
    const weekday = t(`weekday-${teamWeekday(club, view.slug)}`);
    return `<p class="rhythm">${esc(view.start === null ? t('tp-rhythm-weekly-no-time', {weekday}) : t('tp-rhythm-weekly', {weekday, time: view.start}))}</p>`;
}


// The line of a race (a raceView): its day, time and gate, and its event (the link, else the event
// learned from a rider's check). A weekly team's regular race day without a plan is no race (spec
// §8): its neutral status alone, "Next regular race Thu 26 Nov 19:30" (or "No start time set").
function raceLine(view, now) {
    const {when} = view;
    if (when.day === null) {
        return `<p class="race"><span>${esc(t('tp-race-none'))}</span></p>`;
    }
    if (view.regular) {
        return `<p class="race"><span>${esc(view.status.text)}</span></p>`;
    }
    const event = view.event === null ? '' : esc(t('tp-race-event', {id: view.event.id}));
    if (view.noStart) {
        const none = `<span class="err-text">${esc(t('tp-no-start-time'))}</span>`;
        return `<p class="race"><span>${th('tp-race-no-start', {day: esc(when.day), none})}${event}</span></p>`;
    }
    if (view.S === null) {
        // never a missing time: the day alone
        return `<p class="race"><span>${esc(when.day)}${event}</span></p>`;
    }
    // one line with the opening time (spec §9): no status card repeats it; "open since" after the gate
    const open = view.gateAt !== null && now >= view.gateAt;
    return `<p class="race"><span>${th(open ? 'tp-race-open' : 'tp-race-opens', {day: esc(when.day), time: `<time>${esc(when.time)}</time>`, until: esc(when.until), opens: `<time>${esc(view.opens)}</time>`})}${event}</span></p>`;
}


// The race ⋯ (races spec §4 "Race ⋯", §7) of a race ahead with plans (a raceView), in the corner of
// its line; '' for a date without plans (a weekly team's rhythm date) or without a race. Its date and
// time ask first in their place (armForm: a date or time change moves what riders get; without the
// script the server's question): the date, and the time (a special team's is required; a weekly
// team's empty field is the team's start time). Then its event: the link (with Remove), else the
// event learned from a rider's check, else none, and a field to set or change the link. Last, the
// upload of a file for this race (its date goes on to the Store form). Every form carries the
// team's version, so a page drawn before another change is refused.
function raceMenu(club, view) {
    if (view.date === null || !view.plans.length) {
        return '';
    }
    const team = club.teams[view.slug];
    const race = raceOf(club, view.slug, view.date);
    if (race === null) {
        return '';
    }
    const fields = action => ({action, team: view.slug, date: view.date, version: team.version});
    const special = team.kind === 'special';
    // the race's own time; a special team's race stored by 0.3.0 without one starts at the team's
    const own = race.start ?? (special ? team.start ?? '' : '');
    const hint = !special && team.start != null ? ` <span class="hint">${esc(t('rm-start-hint', {time: team.start}))}</span>` : '';
    const body = `<div class="as-when"><label class="field">${esc(t('upload-date'))}<input type="date" name="to" value="${esc(view.date)}" required></label>`
        + `<label class="field">${esc(t('team-start-label'))}${hint}<input type="time" name="start" value="${esc(own)}"${special ? ' required' : ''}></label></div>`;
    const when = armForm('/manage/race', fields('when'), {key: `when-${view.date}`, body, button: t('rm-when-save'), formCls: 'stack',
        // the strip shows the day and time typed, formatted (client.mjs fillText); a weekly race's
        // empty time is the team's; the time brings its own space, so a weekly team without any
        // start time reads "… Sun 22 Nov." (no stray space)
        wordsHtml: th('rm-when-words', {to: '<span data-arm-fill="to" data-arm-format="day"></span>',
            start: `<span data-arm-fill="start" data-arm-pre=" "${!special && team.start != null ? ` data-arm-empty="${esc(team.start)}"` : ''}></span>`}),
        yes: t('rm-when-yes'), yesCls: 'btn primary small'});
    const line = race.pinnedEventId != null ? t('rm-event-link', {id: race.pinnedEventId})
        : race.eventId != null ? t('rm-event-learned', {id: race.eventId}) : t('rm-event-none');
    const event = `<form method="post" action="/manage/race">${hidden(fields('event'))}`
        + `<label class="field">${esc(t('upload-event'))}<input name="event" value="" maxlength="300" inputmode="url" autocomplete="off"></label>`
        + `<button class="btn secondary small" type="submit">${esc(t('rm-event-save'))}</button></form>`;
    const unlink = race.pinnedEventId != null ? postForm('/manage/race', fields('unlink'), t('tp-unpin'), {icon: 'unlink'}) : '';
    return menu(t('rm-label', {day: view.when.day}), [
        `<div class="menu-sec"><p class="menu-head">${esc(t('rm-when'))}</p>${when}</div>`,
        `<div class="menu-sec"><p class="menu-head">${esc(t('upload-event'))}</p><p class="hint">${esc(line)}</p>${event}${unlink}</div>`,
        `<a class="menu-link" href="${esc(`${uploadPath(view.slug)}&date=${view.date}`)}">${ic('upload')}<span>${esc(t('rm-upload'))}</span></a>`,
    ], {key: `race-${view.date}`});
}


// The line of a race with its ⋯ in the corner; without a ⋯ (a rhythm date without plans) no room
// kept for one (.nomenu).
export function raceHead(club, view, now) {
    const menuHtml = raceMenu(club, view);
    return `<div class="racehead${menuHtml ? '' : ' nomenu'}">${raceLine(view, now)}${menuHtml}</div>`;
}


// What Delete plan of version `id` does, in words: with all its versions, for good; a live plan's
// race then gives riders nothing until another plan is made live, which a race that is over (from
// S + 2 h) no longer takes: its plans get the plain words.
export function deletePlanWords(club, slug, id, now) {
    const p = planOfId(club, slug, id);
    return p.live !== null && !raceOver(club, slug, p.date, now) ? t('tp-delete-live') : t('tp-delete-other');
}


// The plan ⋯ (races spec §4 "Plan ⋯", §7) of plan `planId` (any of its ids) of team `slug`, in the
// corner of its block on the team page. For a race still to race: Rename (the type, on every
// version; the label stays the team's name plus the type), New version (the upload page for this
// plan), "Edit on ZwiftGopher" (`planner`, for a version with a share value), Delete asking first in
// its place. No Make live: every version row has it in the panel. For a race that is over (from S +
// 2 h): Delete only (spec §7). Each button names its plan for screen readers (a team page has a menu
// per plan).
export function planMenu(club, slug, planId, {now, planner = null}) {
    const team = club.teams[slug];
    const p = planOfId(club, slug, planId);
    const [id] = p.newest;
    const label = p.label;
    const sr = `<span class="sr"> ${esc(quote(label))}</span>`;
    const items = [];
    if (!raceOver(club, slug, p.date, now)) {
        const type = club.sheets[p.live ?? id].type ?? '';
        items.push(`<form class="stack" method="post" action="/manage/plan/rename">${hidden({team: slug, plan: p.id, version: team.version})}`
            + `<label class="field">${esc(t('as-type'))} <span class="hint">${esc(t('pm-rename-hint'))}</span><input name="type" value="${esc(type)}" maxlength="${TYPE_MAX}" autocomplete="off"></label>`
            + `<button class="btn secondary small" type="submit">${esc(t('pm-rename'))}${sr}</button></form>`);
        items.push(`<a class="menu-link" href="${esc(`/manage/upload?team=${slug}&plan=${p.id}`)}">${ic('upload')}<span>${esc(t('pp-new-version'))}</span></a>`);
        // "Edit on ZwiftGopher": the plan's own version (the live one, else the newest) opened in the
        // planner by its share value; only when that version has one (else the planner would open empty)
        const share = (p.live !== null ? club.sheets[p.live] : p.newest[1])?.zgShare;
        if (planner !== null && isShare(share)) {
            items.push(`<a class="menu-link" href="${esc(plannerHref(planner, share))}" target="_blank" rel="noopener noreferrer">${ic('link')}<span>${esc(t('pp-edit-planner'))}</span></a>`);
        }
    }
    items.push(armForm('/manage/sheet/delete', {team: slug, sheet: id, version: team.version}, {key: `del-${id}`, button: t('tp-delete-plan'), sr: quote(label),
        cls: 'btn secondary danger-text small', icon: 'trash', words: deletePlanWords(club, slug, id, now), yes: t('tp-delete-button', {label}),
        yesCls: 'btn danger small'}));
    return menu(t('pm-label', {label}), items, {key: `plan-${p.id}`});
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


// "N to fix": the notes, worst colour first. `sfx` follows the heading's id (a later race's
// '-<date>').
export function notesHtml(club, view, now, sfx = '') {
    if (!view.notes.length) {
        return '';
    }
    const sev = worst(view.notes.map(n => n.sev));
    return `<section class="callout ${sev}" aria-labelledby="fix-h${esc(sfx)}">
      <h2 id="fix-h${esc(sfx)}">${ic(noteIcon(sev))}${esc(t('tp-fix', {n: view.notes.length}))}</h2>
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
// button (noStartAction). `sfx` as notesHtml's.
export function noStartHtml(club, view, now, sfx = '') {
    if (view.status.kind !== 'no-start') {
        return '';
    }
    const body = view.special ? t('tp-no-start-body-special', {day: view.when.day})
        : view.live ? t('tp-no-start-body', {label: view.live.label}) : t('tp-no-start-body-none');
    const button = noStartAction(club, view, now);
    return `<section class="callout err" aria-labelledby="fix-h${esc(sfx)}">
      <h2 id="fix-h${esc(sfx)}">${ic('x')}${esc(view.status.text)}</h2>
      <ol><li class="note err">
        <p>${esc(body)}</p>
        ${view.trap.map(x => `<p>${esc(x.text)}</p>`).join('\n        ')}
        ${button}
      </li></ol>
    </section>`;
}


// "Plan on ZwiftGopher" (push.mjs href: a fresh token for this team), in a new tab: the primary way
// to a plan (races spec §4), its name for screen readers saying so. `cls` the link's class: a small
// button in the head, a block button in the empty card.
function plannerLink(planner, cls) {
    return `<a class="${cls}" href="${esc(planner)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(t('tp-planner-label'))}">${ic('external')}${esc(t('upload-planner'))}</a>`;
}


// The ways to a plan (races spec §4): with a planner link (`planner`; none without PUBLIC_URL) "Plan on
// ZwiftGopher" (`cls`) and after it the file upload as a quiet link, "Upload a file instead"; without
// one "Upload a plan" (`uploadCls`) alone, as before.
function planWays(view, planner, {cls, uploadCls}) {
    const href = esc(uploadPath(view.slug));
    if (planner === null) {
        return `<a class="${uploadCls}" href="${href}">${ic('upload')}${esc(t('tp-upload-plan'))}</a>`;
    }
    return `${plannerLink(planner, cls)}<a class="btn quiet small" href="${href}">${ic('upload')}${esc(t('tp-upload-instead'))}</a>`;
}


// Does the team page show the empty card with the ways to a plan? Not with a live plan, nor with
// stored plans of this race (they are listed, each with Make live).
const emptyButtons = view => !view.live && !view.forRace;


// The ways to a plan under the race line (UI panel wave 3; races spec §4): "Plan on ZwiftGopher" with
// the quiet "Upload a file instead" under it (.planner), else "Upload a plan" (secondary, full width
// on phones); '' where the empty card has them. The planner pair is a block of its own (a section
// without a name, so no landmark): the page's primary action comes first in its block, never after
// the head's "Team settings" (the button system).
export function headActs(view, planner) {
    if (emptyButtons(view)) {
        return '';
    }
    const ways = planWays(view, planner, {cls: 'btn primary small', uploadCls: 'btn secondary small'});
    return planner === null ? `<div class="headacts">${ways}</div>` : `<section class="headacts planner">${ways}</section>`;
}


export function emptyHtml(view, now, planner = null) {
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
      <h2 id="empty-h">${esc(view.date === null ? t('tp-empty-title-none', {team: view.name}) : t('tp-empty-title'))}</h2>
      <p>${body}</p>
      ${planWays(view, planner, {cls: 'btn primary block', uploadCls: 'btn primary block'})}
    </section>`;
}


// The words of a confirm's button: "… anyway" after a question (outdated marks, moves or holes),
// else the plain action.
const anyway = words => words.endsWith('?');


// Discard of the inbox entry `id` (a plan received from ZwiftGopher, or an upload, in its Store form
// on the team page; on the club hub), back to `back`: secondary with danger text, asking first in its place (armForm; without the
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
// for screen readers; `cls` the trigger's class; `key` tells its ids from another Make live of the
// same version on the page (the team cockpit's row and panel).
export function makeLiveHtml(club, slug, id, {now, button, plain, sr = true, cls = 'btn secondary small', key = null}) {
    const team = club.teams[slug];
    const {words, ask} = liveQuestion(club, slug, id, now);
    const fields = {team: slug, sheet: id, version: team.version};
    const label = sr ? quote(club.sheets[id].label) : null;
    if (!ask) {
        return `<form method="post" action="/manage/live">${hidden(fields)}<button class="${esc(cls)}" type="submit">${esc(plain)}${label ? `<span class="sr"> ${esc(label)}</span>` : ''}</button></form>`;
    }
    return armForm('/manage/live', fields, {key: `live-${id}${key === null ? '' : `-${key}`}`, button, cls, sr: label, words,
        yes: t(anyway(words) ? 'tp-make-live-anyway' : 'tp-confirm-live'), yesCls: 'btn primary small'});
}


// The Undo of the last change of the live plan (undoOffer): {form} (flashBlock, the live card's action bar, the live row of a later race) or null.
export function undoBlock(club, slug, now) {
    const u = undoOffer(club, slug, now);
    if (u === null) {
        return null;
    }
    const fields = {team: slug, version: u.version};
    return {
        form: `<form method="post" action="/manage/live/undo">${hidden(fields)}<button class="btn secondary small" type="submit">${ic('undo')}`
            + `${esc(t('undo-button'))}<span class="sr"> ${esc(t('undo-sr', {n: u.prev.n, label: u.prev.label}))}</span></button></form>`,
    };
}


// The live tag of a plan block: Live, or Not sent without a start time.
export const liveTag = lv => `<span class="tag${lv.sent ? '' : ' off'}">${esc(t(lv.sent ? 'tp-live' : 'tp-not-sent'))}</span> `;


// "Plan code RE5CFQ" of a version (its `sig`): the code every rider's mod shows, to compare (final
// review I1); '' without one.
export const planCode = sig => (sig ? `<p class="plancode">${th('cp-code', {sig: `<code>${esc(sig)}</code>`})}</p>` : '');


// "How races work" (races spec §6): a help fold at the end of the team page's list. It holds no form, so an
// open one keeps the page's reload (data-keep-refresh, client.mjs holdsReload).
export function racesHelpHtml() {
    return `
  <details class="help" data-keep-refresh><summary>${ic('info')}${esc(t('tp-races-help-title'))}</summary><p class="hint">${esc(t('tp-races-help'))}</p></details>`;
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


// What Delete team does, in words: the team, its plans, the inbox, the recordings.
export function teamDeleteWords(club, slug) {
    const team = club.teams[slug].name;
    const plans = plansOf(club, slug).length;
    return plans === 0 ? t('ts-delete-body-none', {team}) : plans === 1 ? t('ts-delete-body-one', {team}) : t('ts-delete-body', {team, n: plans});
}


// The settings of team `slug` (a team of the club). `typed` ({name}, {kind, weekday, start} or
// {start}, as posted) is shown in its form instead of the stored value after a refusal. `push` (the server has
// PUBLIC_URL, so the team page offers "Plan on ZwiftGopher") adds "New ZwiftGopher link", which
// ends every link the team page has handed out for this team.
export function teamSettingsPage(club, slug, {now, seen, others, flash = null, typed = null, push = false}) {
    const view = teamView(club, slug, {now});
    const name = typed?.name ?? view.name;
    const start = typed?.start ?? view.start ?? '';
    const posted = typed !== null && Object.hasOwn(typed, 'kind') ? typedRhythm(typed) : null;
    const {kind, weekday} = club.teams[slug];
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
  ${rhythmCard(club, view, {kind: posted?.kind ?? kind, weekday: posted?.weekday ?? weekday, start}, now)}${push ? `
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
// for the team settings and Add a team so the two read alike: weekly on a weekday (`weekday` 1-7;
// anything else selects Thursday, races spec §4c: there is no club's day to follow), or special,
// with date and start time coming with each plan. With `start` (a string: the field's value) the
// weekly choice has the team's start time too (Add a team, the team settings). The weekly fields
// sit under their choice (data-weekly); the script hides them while special is checked, without it
// they simply show. `legend` false hides the legend (a card's heading says it), `title` replaces its
// words ("Race rhythm"). `hint` (the team settings) puts that hint under the start field instead of
// Add a team's above it.
export function rhythmFields(club, {kind, weekday, start = null, legend = true, title = null, hint = null}) {
    const special = kind === 'special';
    const own = isWeekday(weekday) ? weekday : 4;
    const day = n => t(`weekday-${n}`);
    const options = [];
    for (let n = 1; n <= 7; n++) {
        options.push(`<option value="${n}"${own === n ? ' selected' : ''}>${esc(day(n))}</option>`);
    }
    const choice = (value, checked, text) => `<label class="choice"><input type="radio" name="kind" value="${value}"${checked ? ' checked' : ''}>`
        + `<span><strong>${esc(text)}</strong></span></label>`;
    const input = `<input type="time" name="start" value="${esc(start)}">`;
    const time = start === null ? '' : hint !== null ? `
          <label class="field">${esc(t('team-start-label'))}${input}<span class="hint">${esc(hint)}</span></label>` : `
          <label class="field">${esc(t('team-start-label'))} <span class="hint">${esc(t('nt-start-hint', {tz: club.tz}))}</span>${input}</label>`;
    return `<fieldset class="choices" data-rhythm><legend${legend ? '' : ' class="sr"'}>${esc(title ?? t('ts-rhythm'))}</legend>
        ${choice('weekly', !special, t('ts-weekly', {weekday: day(own)}))}
        <div class="stack" data-weekly>
          <label class="field">${esc(t('ts-weekday'))}<select name="weekday">${options.join('')}</select></label>${time}
        </div>
        ${choice('special', special, t('ts-special'))}
      </fieldset>`;
}


// The team's race day and time card (user, 22 Nov 2026): the race rhythm with the weekly start time
// in one form, built as Add a team's (rhythmFields; its start hint, under the field, says when riders
// get the plan and that a race's own time stays), posting action rhythm. `kind`, `weekday` and
// `start` are drawn (the team's, or as typed after a refusal); a special team's stored start stays in
// the weekly fields, hidden by the script while special is checked. While the team has a start time
// and a race within 7 days, emptying it asks first in its place (S11; the server asks too); with
// special checked the hidden field asks nothing (client.mjs armNeeded), as the server ignores it.
function rhythmCard(club, view, {kind, weekday, start}, now) {
    const fields = {action: 'rhythm', team: view.slug};
    const body = `
      ${rhythmFields(club, {kind, weekday, start, legend: false, title: t('ts-rhythm-card'), hint: t('ts-start-hint', {tz: club.tz})})}
      `;
    const form = view.start !== null && raceWithin(club, view.slug, now)
        ? armForm('/manage/team', fields, {key: 'start', body, button: t('ts-rhythm-save'), cls: 'btn primary', formCls: 'stack',
            when: {when: 'empty', field: 'start'}, words: t('ts-start-clear-confirm', {team: view.name}), yes: t('ts-start-clear-yes'), yesCls: 'btn danger'})
        : `<form class="stack" method="post" action="/manage/team">${hidden(fields)}${body}<button class="btn primary" type="submit">${esc(t('ts-rhythm-save'))}</button>
    </form>`;
    return `<section class="card" aria-labelledby="rhythm-h">
    <h2 id="rhythm-h">${esc(t('ts-rhythm-card'))}</h2>
    ${form}
  </section>`;
}


// The posted race rhythm as the forms send it (typed): `kind` 'weekly' or 'special' (anything else
// draws as weekly) and `weekday` a string ('' or anything but 1-7 draws as Thursday).
export function typedRhythm(typed) {
    const day = /^[1-7]$/.test(typed?.weekday ?? '') ? Number(typed.weekday) : null;
    return {kind: typed?.kind === 'special' ? 'special' : 'weekly', weekday: day};
}


// Add a team: the name and the race rhythm with the weekly start time (rhythmFields); weekly on
// Thursday by default. `typed` ({name, start, kind, weekday}, as posted) fills the form again
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
// confirm=1. `undo` ({version}: an Undo that has to ask, UI panel wave 2) asks it as an Undo: its
// form posts the Undo again, so it is confirmed as one (its own flash, no Undo of it). The way back
// is the team page with the version picked (for an Undo the live one it was offered on).
export function liveConfirmPage(club, slug, id, {now, seen, others, words, marks = [], undo = null}) {
    const team = club.teams[slug].name;
    const name = s => (Object.hasOwn(club.teams, s) ? club.teams[s].name : s);
    const items = marks.map(m => `<p class="outdated">${ic('alert')}${esc(t('tp-outdated-mark', {name: m.name, team: name(m.rides)}))}</p>`);
    const liveNow = undo !== null ? raceOf(club, slug, club.sheets[id].date)?.live ?? null : id;
    const home = `${teamPath(slug)}${liveNow === null ? '' : `?v=${liveNow}`}`;
    const intro = marks.length ? `\n  <p class="banner warn" role="note">${ic('alert')}<span>${esc(t('live-confirm-intro'))}</span></p>` : '';
    // the words are drawn now, so the form carries the team's version now
    const fields = undo !== null ? {team: slug, version: undo.version, confirm: '1'}
        : {team: slug, sheet: id, version: club.teams[slug].version, confirm: '1'};
    const heading = t(undo !== null ? 'undo-confirm-heading' : 'live-confirm-heading', {label: club.sheets[id].label, n: club.sheets[id].n});
    // the crumbs end where the way back goes: the team page
    const trail = [{href: home, label: team}, {label: t('crumb-confirm')}];
    const main = `<main class="page" id="main">
  ${placeNav(club, trail, {back: false}).crumbs}
  <header class="pagehead"><p class="kicker">${esc(t('ui-club-team', {club: club.name, team}))}</p><h1>${esc(heading)}</h1></header>${intro}
  <section class="card stack">
    <p>${esc(words)}</p>
    ${items.join('\n    ')}
    <div class="confirm-acts">${postForm(undo !== null ? '/manage/live/undo' : '/manage/live', fields, t(anyway(words) ? 'live-confirm-button' : 'tp-confirm-live'), {cls: 'btn primary'})}
    <a class="btn secondary" href="${esc(home)}">${ic('left')}${esc(t('live-confirm-back', {team}))}</a></div>
  </section>
</main>`;
    return captainPage(club, {now, seen, others, here: teamPath(slug), main, cls: 'formpage', needsScript: false});
}
