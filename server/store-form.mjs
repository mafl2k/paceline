// Store, its form and its answer (team cockpit spec §5.4, §8 "the flash model"): the preview of
// Store drawn on the server (assignPreview: what of it warns), the form's choices (the team, the race,
// the plans, the type for a new plan only, the date, the start time, the event link; Make live and
// Store in the action bar), the team page's Store form in its card (storeForm), the question before
// its Make live (storeAsk), what a Store did (resultParts),
// the Store flash built from it (storeResult, drawn by resultBlock), and the page an inbox entry that
// is gone answers (entryGonePage). An open form carries data-hold-reload, a Store result only while
// it has something to keep (resultHolds, Ruling I2): the page does not reload itself while one is
// shown (client.mjs, Task 9). Pure: it reads the clubs and
// choices it is given, and the clock is passed in. Every value goes through esc().
import {esc, t} from './pages.mjs';
import {captainPage, flashBlock, hidden, placeNav, th} from './ui.mjs';
import {ic} from './icons.mjs';
import {atLabel, dateDay, nameOf, ridersLine, gateOpen} from './team-view.mjs';
import {
    lineLi, hintLine, keptOf, liveOf, notLiveKey, droppedLine, moveLines, holeTeams, uploadWarnings, uploadHref,
} from './upload-page.mjs';
import {diffSummary, diffVersions} from './diff.mjs';
import {parseEventUrl} from './ids.mjs';
import {teamHint} from './club.mjs';
import {plannedStart, effects, nextRaceDate, PLAN_OPEN_MS} from './select.mjs';
import {localLabel, isDate} from './time.mjs';
import {planOfId, ridersShared, previousVersion, shownLabel} from './plans.mjs';
import {raceOf, raceOfSheet} from './races.mjs';
import {entryPlan} from './preselect.mjs';
import {discardForm} from './team-page.mjs';

const inboxPath = id => `/manage/inbox/${id}`;


// The lines of what a stored version changed against the version before it in its plan (diff.mjs);
// a new plan's first version reads "First version of a new plan".
function storedDiff(club, result, now) {
    const sheet = club.sheets[result.id];
    const prev = previousVersion(club, result.id)?.[1] ?? null;
    return diffVersions(club, prev, sheet, now, {newPlan: result.created});
}


// The question before Make live of a received or uploaded plan (user, 23 Nov 2026): only in the
// race window (the gate open for the stored version's race or for the version live there) while
// another version is live in that race and not used up; then its words as the version card's strip
// says them ("Riders in the event get 'Rollers · slow' v2 instead of 'Rollers · fast' v3 within a
// minute. Make it live anyway?"), {words}; else null: Make live acts at once (nothing live in the
// race, or before the gate). `before` is the club now, `after` the dry run's club of Store and make
// live, `result` its storeEntry answer. The server asks the same on the POST (manage-inbox.mjs).
export function storeAsk(before, after, result, now) {
    const sheet = after.sheets[result.id];
    const lv = keptOf(before, sheet.team, sheet.date, now);
    if (lv === null || lv.id === result.id || (!gateOpen(after, sheet, now) && !gateOpen(before, lv.sheet, now))) {
        return null;
    }
    const words = t('tp-live-words-open', {label: sheet.label, n: sheet.n, live: lv.sheet.label, ln: lv.sheet.n});
    return {words: `${words} ${t('tp-live-q-anyway')}`};
}


// What of the Store form's two buttons warns (spec §6.6; user, 23 Nov 2026: Make live stores and
// makes live, Store only stores; no "What happens", the buttons say what they do and in the race
// window Make live's own question says when riders get it), from their dry runs `live` and `off`
// ({club, result}: the dry run's club and storeEntry's answer, with the box on and off): {lines,
// diff, riders, ask}. `before` is the club now. The lines, in this order: the team hint (with no
// link: the team is picked on this page), the riders Make live moves and the teams it leaves with a
// hole (only Make live changes who rides where), Store alone into a race with nothing live (a
// warning: "Store: v4 of 'Rollers · fast', not live. Riders get no plan for this race yet."), the
// summary of the diff (`diff: true`, never drawn: the rider table shows it; its lines are `diff`),
// what the caps drop, the other warnings of Make live (no start time, the race's time or link it
// changes, no pull watts, the import's). `ask` the question before Make live (storeAsk), or null.
export function assignPreview(before, entry, {live, off, now}) {
    const after = live.club;
    const {result} = live;
    const sheet = after.sheets[result.id];
    const slug = sheet.team;
    const {plan} = result;
    const lines = [];
    const hint = hintLine(after, teamHint(before, slug, entry.json, plan.riders.map(r => r.id), now), {link: false});
    if (hint !== null) {
        lines.push(hint);
    }
    const {moves, holes} = effects(before, after, sheet.date, now);
    lines.push(...moveLines(after, moves));
    const todo = holeTeams(holes);
    if (todo.length) {
        lines.push({sev: 'warn', text: t('result-holes', {teams: todo.map(s => nameOf(after, s)).join(', ')})});
    }
    // Store alone into a race with nothing live: riders get nothing (spec §8: a plan stored early
    // and not made live was missed)
    const os = off.club.sheets[off.result.id];
    if (keptOf(off.club, slug, os.date, now) === null) {
        const key = off.result.same ? 'as-pv-same-none' : `as-pv-${off.result.created ? 'new-' : ''}off-none`;
        lines.push({sev: 'warn', text: t(key, {n: os.n, label: os.label})});
    }
    let diff = [];
    if (!result.same) {
        diff = storedDiff(after, result, now);
        lines.push({sev: 'info', text: diffSummary(diff), diff: true});
    }
    const dropped = droppedLine(result);
    if (dropped !== null) {
        lines.push(dropped);
    }
    lines.push(...uploadWarnings(after, slug, {result, importWarnings: entry.warnings ?? [], importMore: entry.warningsMore ?? 0}));
    return {lines, diff, riders: plan.riders, ask: storeAsk(before, after, result, now)};
}


// One radio of a choice: its title, and a meta line under it.
function radio(name, value, checked, title, meta = '') {
    return `<label class="choice"><input type="radio" name="${name}" value="${esc(value)}"${checked ? ' checked' : ''}><span><strong>${esc(title)}</strong>`
        + `${meta ? `<span>${esc(meta)}</span>` : ''}</span></label>`;
}


// The team (spec §6.2): the page's own team as a hidden field when the club has one team, else the
// others in the fold "Other team" (the page's team says itself: no line repeats it, spec §5.3b); a team
// chosen there other than `own` (the page's) names itself above the fold; without a chosen team the
// radios show with "Pick a team.".
function teamHtml(club, {team, teams}, own) {
    if (team !== null && teams.length === 1) {
        return hidden({team});
    }
    const radios = teams.map(x => radio('team', x.slug, x.slug === team, x.name)).join('\n        ');
    if (team === null) {
        return `<fieldset class="choices"><legend>${esc(t('as-team'))}</legend>
        <p class="err-text">${esc(t('as-pick-team'))}</p>
        ${radios}
      </fieldset>`;
    }
    const other = team === own ? '' : `<p class="as-row"><span class="kicker">${esc(t('as-team'))}</span> <strong>${esc(nameOf(club, team))}</strong></p>
      `;
    return `${other}<details class="fold"><summary>${esc(t('as-other-team'))}</summary><fieldset class="choices"><legend class="sr">${esc(t('as-team'))}</legend>
        ${radios}
      </fieldset></details>`;
}


// The race of a new plan (races spec §4 "Which race a new plan goes to"): with two or more races ahead
// (`raceChoice`), one radio each, first in the race fold (only "New plan" has one, user 23 Nov
// 2026), its day and time and how many plans it has; the page's date is checked (none when it is
// none of them). '' with one race or none.
function racesHtml(choices) {
    if (!choices.raceChoice) {
        return '';
    }
    const rows = choices.races.map(r => radio('race', r.date, r.date === choices.date, r.time === null ? r.day : t('as-race-when', {day: r.day, time: r.time}),
        t(r.plans === 0 ? 'as-race-plans-none' : r.plans === 1 ? 'as-race-plans-one' : 'as-race-plans', {n: r.plans})));
    return `<fieldset class="choices"><legend>${esc(t('as-race-pick'))}</legend>
        ${rows.join('\n        ')}
      </fieldset>`;
}


// "Store as": the plans of every race ahead, nearest race first (controller ruling 23 Nov 2026: a
// version takes its plan's race), one radio each (the live plan with its live version's n, any other
// its newest), its sub-line starting with its race day when the plans are of more than one race
// ("Thu 26 Nov · v2 · …"); then "New plan"; none checked when `as` is null.
function plansHtml(club, entry, choices, now) {
    const {team, as, plans} = choices;
    const {riders} = entryPlan(entry);
    const days = new Set(plans.map(p => p.date)).size > 1;
    const rows = plans.map(p => {
        const plan = planOfId(club, team, p.id);
        const v = plan.live !== null ? club.sheets[plan.live] : plan.newest[1];
        const at = Date.parse(v.at);
        let meta = t('as-plan-meta', {
            live: plan.live !== null ? t('as-plan-live') : '', n: v.n, at: Number.isFinite(at) ? atLabel(at, now, club.tz) : '–',
            shared: ridersShared(v, riders).shared, total: p.total,
        });
        if (days) {
            meta = t('as-plan-day', {meta, day: p.day});
        }
        // a plan without a type: "New version of 'Rollers · Plan'" (user, 23 Nov 2026: display only)
        return radio('as', p.id, as === p.id, t('as-new-version', {label: shownLabel(club.teams[team].name, plan.type)}), meta);
    });
    rows.push(radio('as', 'new', as === 'new', t('as-new-plan')));
    return `<fieldset class="choices"><legend>${esc(t('cp-store-as'))}</legend>
        ${rows.join('\n        ')}
      </fieldset>`;
}


// The type, its suggestions and its hint, only for a new plan, after "Store as" and before the race
// fold, so choosing "New plan" moves no field above it (a version keeps its plan's type: Rename is
// the only way to change it). There is no Make live box (user, 23 Nov 2026): the action bar has
// Make live and Store.
function typeHtml(club, choices) {
    const {team, type, types, typeNeeded, date} = choices;
    if (choices.as !== 'new') {
        return '';
    }
    const hint = typeNeeded ? t('as-type-needed', {team: nameOf(club, team), day: dateDay(date, club.tz)}) : t('as-type-optional');
    return `<label class="field">${esc(t('as-type'))} <input name="type" maxlength="30" value="${esc(type)}" list="types" autocomplete="off"></label>`
        + `<datalist id="types">${types.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      <p class="hint">${esc(hint)}</p>`;
}


// The race date and the start time of a new plan, side by side, the date's hint under its box (team
// cockpit spec §5.3b, so the two boxes stand on one line), in the race fold (raceFoldHtml): one date
// field, prefilled with the team's default (assignChoices: the next race by its rhythm), a calendar
// that opens on a click anywhere in it (client.mjs, where the browser can). The date is required for
// a special team, or without a default date (a special team with nothing ahead). A special team's
// start time is required too (user, 19 Nov 2026: the newest upload for a date sets it). The time is
// prefilled (user, 22 Nov 2026, assignChoices' `start`: the race's, else the team's) and has no hint,
// for every kind of team; it is required whenever it was prefilled (user, 23 Nov 2026: a race's start
// time is pinned when the race is made, club.mjs storedStart, so a cleared field is no "team's
// time"); a weekly team without any start time draws it empty and not required. A version has none
// of it: it takes its plan's race (user, 23 Nov 2026).
function whenHtml(club, choices) {
    const {team} = choices;
    const special = team !== null && choices.special === true;
    const required = team !== null && (special || choices.dateRequired === true);
    const date = `<label class="field">${esc(t('upload-date'))}<input type="date" name="date" value="${esc(choices.date ?? '')}"${required ? ' required' : ''}>`
        + `<span class="hint">${esc(t('as-date-hint'))}</span></label>`;
    const timeRequired = special || (choices.startWas ?? '') !== '';
    const start = `<label class="field">${esc(t('team-start-label'))}<input type="time" name="start" value="${esc(choices.start ?? '')}"${timeRequired ? ' required' : ''}></label>`;
    return `<div class="as-when">
        ${date}
        ${start}
      </div>`;
}


// The event link field, as typed; under it the link the chosen race has now, when it has one (the
// race line that said it went, team cockpit spec §5.3b: the warnings say what a typed link changes).
function eventHtml(club, choices) {
    const now = choices.team === null || !isDate(choices.date) ? null : raceOf(club, choices.team, choices.date)?.pinnedEventId ?? null;
    return `<label class="field">${esc(t('upload-event'))} <span class="hint">${esc(t('upload-event-hint'))}</span>`
        + `<input type="text" name="event" maxlength="300" inputmode="url" autocomplete="off" value="${esc(choices.event)}">`
        + `${now === null ? '' : `<span class="hint">${esc(t('as-event-now', {id: now}))}</span>`}</label>`;
}


// The race fold (user, 22 Nov 2026: "move date/time to bottom closed … except it's a special date
// team"): the race date and start time (whenHtml) and the event link (eventHtml) in a <details>, the
// form's last block. Its summary says the race the plan joins, as the date decides it: "Race: Thu 26
// Nov · 19:30 · Event 5123456 · Change" (the time typed, else the race's as drawn: a blank keeps it;
// the event the link posted when it parses, else the race's pinned one, else the one it learned unless
// the time typed moves the race, which clears it; "Race: no date yet" without a date). Closed it still
// posts every field. Open (raceOpen) when the captain has to look; else closed, as for a weekly team
// whose next race is prefilled.
function raceFoldHtml(club, choices, open) {
    const {team, date} = choices;
    const tz = club.tz;
    let race = isDate(date) ? dateDay(date, tz) : null;
    // a blank time keeps the race's (Store: storeStart), so the summary says that one (startWas)
    const start = choices.start || choices.startWas || '';
    if (race !== null && /^\d{2}:\d{2}$/.test(start)) {
        race = t('as-race-when', {day: race, time: start});
    }
    const posted = parseEventUrl(choices.event ?? '');
    const r = race === null ? null : raceOf(club, team, date);
    // the event the race learned goes when the Store moves its start (uploadSheet clears it): not named
    const moved = Boolean(choices.start) && choices.start !== choices.startWas;
    const event = posted.ok && posted.id !== null ? posted.id : r?.pinnedEventId ?? (moved ? null : r?.eventId ?? null);
    if (race !== null && event !== null) {
        race = t('as-race-event', {race, id: event});
    }
    const sum = race === null ? t('as-race-sum-none') : t('as-race-sum', {race});
    return `<details class="fold as-race"${open ? ' open' : ''}><summary><span>${th('as-race-fold', {race: esc(sum), change: `<span class="as-change">${esc(t('as-race-change'))}</span>`})}</span></summary><div class="as-race-body">
        ${racesHtml(choices)}
        ${whenHtml(club, choices)}
        ${eventHtml(club, choices)}
      </div></details>`;
}


// Is the race fold open (raceFoldHtml, a new plan's only)? When the captain has to look (user, 22 Nov
// 2026): a special team; no time to prefill (a weekly team without any start time: riders get nothing
// until the race has one, user 23 Nov 2026); no race ahead to prefill (nextRaceDate: none); the form's race is not the
// team's next one (a race radio, a typed date) or the upload named another date (the entry's
// `forDate`, also one that is over); a dry run that said something about the date, the time or the
// link (`preview.race`, a {note}: the date or a special team's time still empty); and `raceOpen`: the
// captain opened it (the script keeps it open across a redraw) or a refused Store concerned the race
// (manage-inbox.mjs).
function raceOpen(club, entry, choices, preview, now) {
    const {team, date} = choices;
    const next = nextRaceDate(club, team, now);
    const named = entry.team === team && isDate(entry.forDate) ? entry.forDate : null;
    return choices.raceOpen === true || choices.special === true || (choices.startWas ?? '') === '' || next === null || date !== next || (named !== null && named !== next)
        || preview?.race === true || Object.hasOwn(preview ?? {}, 'note');
}


// Warning lines (`lines`: {sev, text}) as the card draws them right above its action bar (user, 23
// Nov 2026: no "What happens" heading), with their icons; '' without any.
export const warnLines = lines => (lines.length === 0 ? '' : `<ul class="pv-list">${lines.map(l => lineLi(l)).join('')}</ul>`);


// The Store form's warning lines: the preview's lines without the diff summary (the rider table
// shows it); an error instead when the dry run was refused ("Pick a plan.", a date that is over, …),
// a neutral line ({note}) while a field it needs is empty; none without a preview.
function warnItems(preview) {
    if (preview === null) {
        return [];
    }
    if (Object.hasOwn(preview, 'error')) {
        return [{sev: 'err', text: preview.error}];
    }
    if (Object.hasOwn(preview, 'note')) {
        return [{sev: 'neutral', text: preview.note}];
    }
    return preview.lines.filter(l => !l.diff);
}


// The team page's Store form of `entry` (spec §5.4, §5.3b), drawn in its card under the rider table
// (user, 23 Nov 2026: never in its row, so the list never moves): {form, what, actions}. `form` is the
// form (id store-<entry id>, posting to the entry's Store; data-assign: the script redraws on a
// change; data-hold-reload: the page does not reload while it is open; data-arm while Make live asks
// first) with the hidden fields (drawn, base, touched; for a new plan startFor, startWas: Store's
// stale-page guards, and raceOpen: the race fold is open, which the script keeps up to date for a
// redraw) and only what the card does not show: the team (the other teams in a fold), "Store as"
// (the plans of every race ahead and New plan) and, for "New plan" only (user, 23 Nov 2026: a
// version takes its plan's race), the type (after "Store as", so a choice there moves no field above
// it) and last the race fold with the race radios, the race date, the start time and the event link
// (raceFoldHtml; user, 22 Nov 2026). No line with the riders: the card's title says them. `what` is its
// warning lines (warnItems; user, 23 Nov 2026: no "What happens") for the card's slot above its action bar;
// `actions` the action bar (user, 23 Nov 2026), in this order: Discard back to `back`, Store
// (secondary: stores only) and Make live (primary, always the rightmost: it posts the form with
// live=on, stores and makes live; "Store and make live" for screen readers), both outside the form
// (form="store-<id>"; the bar stands in #panel-acts, cockpit-panel.mjs). While the
// preview says Make live must ask (preview.ask: the race window with another version live), Make
// live opens the strip after them in its place, its confirm button posting the form with confirm=1;
// without the script the server asks on its own page. `choices` assignChoices' (or a refused
// Store's), `preview` assignPreview's, {error}, {note} or null.
export function storeForm(club, entry, {choices, preview, now, back}) {
    const {team} = choices;
    const id = `store-${entry.id}`;
    const base = team === null ? '' : club.teams[team].version;
    // the race (its date, time and event link) only for a new plan: a version takes its plan's race,
    // which the race's and the plan's ⋯ change (user, 23 Nov 2026)
    const fresh = team !== null && choices.as === 'new';
    const open = fresh && raceOpen(club, entry, choices, preview, now);
    const choose = team === null ? '' : `
      ${plansHtml(club, entry, choices, now)}${fresh ? `
      ${typeHtml(club, choices)}
      ${raceFoldHtml(club, choices, open)}` : ''}`;
    const what = warnLines(warnItems(preview));
    const ask = preview?.ask ?? null;
    const form = `<form id="${esc(id)}" method="post" action="${esc(inboxPath(entry.id))}" data-assign data-hold-reload${ask ? ' data-arm' : ''}>`
        + `${hidden({drawn: choices.drawn, base, touched: choices.touched ?? '', ...(fresh ? {startFor: choices.date ?? '', startWas: choices.startWas ?? '', raceOpen: open ? '1' : ''} : {})})}
      ${teamHtml(club, choices, entry.team)}${choose}
    </form>`;
    const make = `<button class="btn primary" type="submit" form="${esc(id)}" name="live" value="on" aria-label="${esc(t('as-store-live'))}"${ask ? ' data-arm-open' : ''} data-submit="live">${esc(t('as-make-live'))}</button>`;
    const only = `<button class="btn secondary" type="submit" form="${esc(id)}" data-submit="store">${esc(t('as-store'))}</button>`;
    const words = `arm-${id}`;
    const strip = ask === null ? '' : `<div class="arm-strip" role="group" aria-label="${esc(t('arm-label', {action: t('tp-make-live-anyway')}))}" data-arm-strip data-for="${esc(id)}" hidden>`
        + `<p id="${esc(words)}">${esc(ask.words)}</p><div class="arm-btns">`
        + `<button class="btn primary small" type="submit" form="${esc(id)}" name="confirm" value="1" aria-describedby="${esc(words)}" data-arm-yes>${esc(t('tp-make-live-anyway'))}</button>`
        + `<button class="btn secondary" type="button" data-arm-cancel>${esc(t('arm-cancel'))}</button></div></div>`;
    const actions = `<div class="as-discard">${discardForm(entry.id, back, ridersLine(entry))}</div>${only}${make}${strip}`;
    return {form, what, actions};
}


// What a Store did (spec §6.9, circles §5.4), for the Store flash (storeResult): {sheet, head, notLive, said, event, changes, todo, warnings}. `head` {sev: 'ok' |
// 'neutral' | 'err', text}: the version and what riders get (live now; stored and what riders keep;
// red when its race has nothing live); `notLive` the red line after the same file again while its
// race has nothing live, or null; `said` (only after a live Store) that the plan live before stays as
// another plan and when riders get it; `event` the race's event link line, or null; `changes` what the caps
// dropped, the moves and one line per team still to do (`todo`, their slugs); `warnings`
// uploadWarnings'. `after` is the club after the Store, `before` the one before it, `result`
// storeEntry's answer, `moves`/`holes` effects(before, after, date) for the stored version's date,
// `hint` teamHint(before, …), `importWarnings` and `importMore` the entry's.
function resultParts(before, after, slug, {result, moves = [], holes = [], hint = null, importWarnings = [], importMore = 0, now}) {
    const sheet = after.sheets[result.id];
    const tz = after.tz;
    const v = {label: sheet.label, n: sheet.n, sig: sheet.sig};
    // live is per race (races spec §1): the stored version's race before the Store
    const wasId = liveOf(before, slug, sheet.date)?.id ?? null;
    let head;
    let notLive = null;
    if (result.same && result.live && wasId !== result.id) {
        // nothing new stored, but the box made that version live: say so (UI panel, audit S9); the
        // version it replaced in that race while it was not used up (review M3: never a raced plan)
        const was = keptOf(before, slug, sheet.date, now)?.sheet ?? null;
        head = {sev: 'ok', text: was === null ? t('result-same-live-none', v) : t('result-same-live', {...v, was: was.label, wn: was.n})};
    } else if (result.same) {
        head = {sev: 'neutral', text: t('result-same', v)};
        // the same file again, not live, and its race has no live plan: red as well (spec §8)
        if (!result.live && keptOf(after, slug, sheet.date, now) === null) {
            notLive = {sev: 'err', text: t(notLiveKey(after, sheet, 'result-not-live'))};
        }
    } else if (result.live) {
        const S = plannedStart(after, sheet);
        head = {sev: 'ok', text: S === null ? t('result-live-v-no-start', v) : t('result-live-v', {...v, when: localLabel(S, tz)})};
    } else {
        // stored, not live, and its race has no live plan: red at once, with Make live (spec §8: a
        // plan stored early and not made live was missed)
        const kept = keptOf(after, slug, sheet.date, now);
        head = kept ? {sev: 'neutral', text: t('result-stored-v', {...v, live: kept.sheet.label, ln: kept.sheet.n})}
            : {sev: 'err', text: t(notLiveKey(after, sheet, 'result-stored-v-none'), v)};
    }
    const said = [];
    if (result.live) {
        const S = plannedStart(after, sheet);
        // the plan live before in this race stays as another plan (not an earlier version of this one)
        if (!result.same && wasId !== null && Object.hasOwn(after.sheets, wasId) && after.sheets[wasId].plan !== result.planId) {
            said.push(t('result-stays', {label: after.sheets[wasId].label}));
        }
        if (S !== null) {
            // after the gate: riders in the event get it within a minute
            said.push(now >= S - PLAN_OPEN_MS ? t('result-from-open') : t('result-from', {at: atLabel(S - PLAN_OPEN_MS, now, tz)}));
        }
    }
    // the event link is the race's (races spec §1)
    const link = raceOfSheet(after, sheet)?.pinnedEventId ?? null;
    // what this changes: the dropped version or plan, the moves, and each team still to do
    const changes = [droppedLine(result), ...moveLines(after, moves)].filter(Boolean);
    const todo = holeTeams(holes);
    changes.push(...todo.map(s => ({sev: 'warn', text: `${t('result-holes', {teams: nameOf(after, s)})}.`})));
    return {
        sheet, head, notLive, said,
        event: link === null ? null : t('result-event', {id: link}), changes, todo,
        warnings: uploadWarnings(after, slug, {result, hint, importWarnings, importMore}),
    };
}


// The team page's answer to Store (spec §5.4 "After Store", §8): the Store flash (shapes) {kind, text,
// result: {id, lines, links}}. `text` is the head line of what the Store did, `kind` 'err' only for
// its red "not live, nothing live in the race". `lines` in this order: the red line
// after the same file, when riders get it (and the plan that stays), the event link, what the caps
// dropped, the moves, the teams still to do, the warnings. `links` one per team still to do, to its
// upload page. No "Wrong file?" and no Undo (user, 23 Nov 2026): a wrong file made live is undone
// with Make live of the version live before (its card reads "Was live …"); Delete plan would delete
// every version.
export function storeResult(before, after, slug, opts) {
    const r = resultParts(before, after, slug, opts);
    const lines = [r.notLive, ...r.said.map(text => ({sev: 'neutral', text})), r.event === null ? null : {sev: 'neutral', text: r.event},
        ...r.changes, ...r.warnings].filter(Boolean);
    const links = r.todo.map(s => ({href: uploadHref(after, s, r.sheet.date, opts.now), text: t('result-hole-link', {team: nameOf(after, s)})}));
    return {kind: r.head.sev === 'err' ? 'err' : 'ok', text: r.head.text, result: {id: opts.result.id, lines, links}};
}


// Does the Store flash `flash` hold the page's reload (Ruling I2)? Only a result with something to
// keep: its head red (stored, not live, nothing live in the race), a line that warns or is red (the
// red "Not live" line, a team still to do, a warning) or a way to a team still to do. A clean result
// ("is live", "Stored as v4 …, riders keep v3", when riders get it, the event link, a move or a cap
// that is done) lets it go, so the live card counts again; the next reload drops it.
export function resultHolds(flash) {
    if (!flash?.result) {
        return false;
    }
    const {lines, links} = flash.result;
    return flash.kind === 'err' || links.length > 0 || lines.some(l => l.sev === 'warn' || l.sev === 'err');
}


// A Store flash as markup: flashBlock(flash), then the result's lines and links in
// <div class="result">, data-hold-reload on it while it holds the page's reload (resultHolds).
function resultBlock(flash) {
    const {lines, links} = flash.result;
    const list = lines.length === 0 ? '' : `<ul class="pv-list">${lines.map(l => lineLi(l)).join('')}</ul>`;
    const ways = links.map(l => `<a class="btn secondary block" href="${esc(l.href)}">${esc(l.text)}</a>`).join('');
    return `${flashBlock(flash)}<div class="result"${resultHolds(flash) ? ' data-hold-reload' : ''}>${list}${ways}</div>`;
}


// The flash of a page: a Store flash with its result (resultBlock), any other with flashBlock.
export const flashHtml = flash => (flash?.result ? resultBlock(flash) : flashBlock(flash));


// An entry that is stored, discarded, expired or never was: back to the teams. The caller sets the
// status (404 for a GET, 400 for a POST).
export function entryGonePage(club, {now, seen, others}) {
    const nav = placeNav(club, [{label: t('crumb-gone')}]);
    const main = `<main class="page" id="main">
  ${nav.crumbs}
  <section class="card empty" aria-labelledby="gone-h">
    ${ic('noPlan', 'big')}
    <h1 id="gone-h">${esc(t('club-entry-gone'))}</h1>
    <a class="btn primary block" href="/manage">${esc(t('tp-all-teams'))}</a>
  </section>
</main>`;
    return captainPage(club, {now, seen, others, here: '/manage', bar: nav.bar, main, needsScript: false});
}
