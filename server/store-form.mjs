// Store, its form and its answer (team cockpit spec §5.4, §8 "the flash model"): the preview of
// Store drawn on the server (assignPreview, "What happens"), the form's choices (the team, the race,
// the plans, the type for a new plan only, the "Make live" box, the date, the start time, the event
// link), the team page's Store form in the picked row (storeForm), what a Store did (resultParts),
// the Store flash built from it (storeResult, drawn by resultBlock), and the page an inbox entry that
// is gone answers (entryGonePage). An open form carries data-hold-reload, a Store result only while
// it has something to keep (resultHolds, Ruling I2): the page does not reload itself while one is
// shown (client.mjs, Task 9). Pure: it reads the clubs and
// choices it is given, and the clock is passed in. Every value goes through esc().
import {esc, t} from './pages.mjs';
import {captainPage, flashBlock, hidden, placeNav, th} from './ui.mjs';
import {ic} from './icons.mjs';
import {atLabel, dateDay, nameOf, ridersLine} from './team-view.mjs';
import {
    lineLi, hintLine, keptOf, liveOf, notLiveKey, droppedLine, moveLines, holeTeams, uploadWarnings, uploadHref,
} from './upload-page.mjs';
import {diffSummary, diffVersions} from './diff.mjs';
import {parseEventUrl} from './ids.mjs';
import {teamHint} from './club.mjs';
import {plannedStart, effects, raceStartAt, nextRaceDate, PLAN_OPEN_MS} from './select.mjs';
import {localLabel, isDate} from './time.mjs';
import {planOfId, ridersShared, previousVersion} from './plans.mjs';
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


// What Store would do, from its dry run (spec §6.6): {lines, diff, riders, button, same};
// `same` {n, live} when the entry is the plan's newest version again (`live`: riders have it).
// `before` is the club now, `after` the dry run's club, `result` storeEntry's answer, `live` the box.
// The lines, in this order: the team hint (with no link: the team is picked on this page), the
// outcome, the summary of the diff (`diff: true`; its lines are `diff`), what the caps drop, the
// moves and holes for the stored version's date, the other warnings.
export function assignPreview(before, after, entry, {result, live, now}) {
    const sheet = after.sheets[result.id];
    const slug = sheet.team;
    const team = after.teams[slug];
    const tz = after.tz;
    const {plan} = result;
    const lines = [];
    const hint = hintLine(after, teamHint(before, slug, entry.json, plan.riders.map(r => r.id), now), {link: false});
    if (hint !== null) {
        lines.push(hint);
    }
    const {label, n} = sheet;
    const S = plannedStart(after, sheet);
    const when = S === null ? null : localLabel(S, tz);
    const at = S === null ? null : atLabel(S - PLAN_OPEN_MS, now, tz);
    // after the gate riders in the event get it within a minute, not "from 19:00"
    const phase = S === null ? '-no-start' : now >= S - PLAN_OPEN_MS ? '-open' : '';
    // the same file as a version: nothing stored, but the box can still make that version live
    // live is per race (races spec §1): the stored version's race
    const wasLive = (raceOf(before, slug, sheet.date)?.live ?? null) === result.id;
    if (result.same && result.live && !wasLive) {
        lines.push({sev: 'ok', text: t(`as-pv-same-live${phase}`, {n, when, at})});
    } else if (result.same) {
        lines.push({sev: 'info', text: t('as-pv-same', {n})});
        // not live while nothing in its race is live: red before Store, as in the Store flash (spec §8)
        if (!result.live && keptOf(after, slug, sheet.date, now) === null) {
            lines.push({sev: 'err', text: t(notLiveKey(after, sheet, 'result-not-live'))});
        }
    } else if (result.live) {
        const key = `as-pv-${result.created ? 'new-' : ''}live${phase}`;
        lines.push({sev: 'ok', text: t(key, {n, label, when, at})});
    } else {
        // not live while nothing in its race is live: red before Store, as in the Store flash (spec §8)
        const kept = keptOf(after, slug, sheet.date, now);
        const key = `as-pv-${result.created ? 'new-' : ''}off${kept ? '' : '-none'}`;
        lines.push({sev: kept ? 'info' : 'err', text: t(key, {n, label, team: team.name, live: kept?.sheet.label, ln: kept?.sheet.n})});
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
    const {moves, holes} = effects(before, after, sheet.date, now);
    lines.push(...moveLines(after, moves));
    const todo = holeTeams(holes);
    if (todo.length) {
        lines.push({sev: 'warn', text: t('result-holes', {teams: todo.map(s => nameOf(after, s)).join(', ')})});
    }
    lines.push(...uploadWarnings(after, slug, {result, importWarnings: entry.warnings ?? [], importMore: entry.warningsMore ?? 0}));
    return {
        lines, diff, riders: plan.riders,
        button: t(live ? 'as-store-live' : 'as-store'),
        same: result.same ? {n, live: wasLive} : null,
    };
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


// The race (races spec §4 "Which race a new plan goes to"): with two or more races ahead
// (`raceChoice`), one radio each, above the fold before the plans, its day and time and how many
// plans it has; the page's date is checked (none when it is none of them). '' with one race or none.
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


// The plans of the race, one radio each (the live plan with its live version's n, any other its
// newest; a plan of another date with its day), then "New plan"; none checked when `as` is null.
// The fieldset's legend is "Store as".
function plansHtml(club, entry, choices, now) {
    const {team, as, plans, date} = choices;
    const {riders} = entryPlan(entry);
    const rows = plans.map(p => {
        const plan = planOfId(club, team, p.id);
        const v = plan.live !== null ? club.sheets[plan.live] : plan.newest[1];
        const at = Date.parse(v.at);
        let meta = t('as-plan-meta', {
            live: plan.live !== null ? t('as-plan-live') : '', n: v.n, at: Number.isFinite(at) ? atLabel(at, now, club.tz) : '–',
            shared: ridersShared(v, riders).shared, total: p.total,
        });
        if (plan.date !== date) {
            meta = t('as-plan-day', {meta, day: p.day});
        }
        return radio('as', p.id, as === p.id, t('as-new-version', {label: p.label}), meta);
    });
    rows.push(radio('as', 'new', as === 'new', t('as-new-plan')));
    return `<fieldset class="choices"><legend>${esc(t('cp-store-as'))}</legend>
        ${rows.join('\n        ')}
      </fieldset>`;
}


// The "Make live" box, then the type, its suggestions and its hint, only for a new plan and last in
// the form before the race fold, so choosing "New plan" moves no field above it (a version keeps its plan's type: Rename
// is the only way to change it); the box's label says what ticking it does
// for the chosen plan (with no plan chosen: pick one first). The same file as the plan's newest
// version stores nothing: the label names that version, or says riders have it already. A new
// version of the live plan says when riders get it: before the race's gate from its time, never "at
// once" (review M2, as liveWords).
function typeLiveHtml(club, choices, preview, now) {
    const {team, type, types, typeNeeded, date, live} = choices;
    let {liveKind, liveVars} = choices;
    const same = preview?.same ?? null;
    if (same !== null && liveKind === 'live-plan') {
        [liveKind, liveVars] = same.live ? ['is-live', {n: same.n}] : [liveKind, {...liveVars, n: same.n}];
    }
    const S = liveKind === 'live-plan' && team !== null && isDate(date) ? raceStartAt(club, team, date) : null;
    if (S !== null && now < S - PLAN_OPEN_MS) {
        [liveKind, liveVars] = ['live-plan-later', {...liveVars, at: atLabel(S - PLAN_OPEN_MS, now, club.tz)}];
    }
    const hint = typeNeeded ? t('as-type-needed', {team: nameOf(club, team), day: dateDay(date, club.tz)}) : t('as-type-optional');
    const typeField = choices.as !== 'new' ? '' : `<label class="field">${esc(t('as-type'))} <input name="type" maxlength="30" value="${esc(type)}" list="types" autocomplete="off"></label>`
        + `<datalist id="types">${types.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      <p class="hint">${esc(hint)}</p>
      `;
    return `<label><input type="checkbox" name="live" value="on"${live ? ' checked' : ''}> ${esc(t(`as-live-${liveKind}`, liveVars))}</label>
      ${typeField}`;
}


// The race date and the start time of the choices, side by side, the date's hint under its box (team
// cockpit spec §5.3b, so the two boxes stand on one line), in the race fold (raceFoldHtml): one date
// field in one place, prefilled with the team's default (assignChoices: the next race by its
// rhythm), a calendar that opens on a click anywhere in it (client.mjs, where the browser can); a new
// version's date is its plan's, in the same box, read only and without a name (Store keeps the
// plan's date), each with its one-line hint under the box, so switching "Store as" moves nothing. The date is required for a special team, or
// for a new plan without a default date (a special team with nothing ahead). A special team's start
// time is required too (user, 19 Nov 2026: the newest upload for a date sets it). The time is
// prefilled (user, 22 Nov 2026, assignChoices' `start`) and has no hint, for every kind of team;
// posting a weekly team's own time keeps the race on its rhythm (club.mjs storedStart).
function whenHtml(club, choices) {
    const {team} = choices;
    const special = team !== null && choices.special === true;
    const required = team !== null && !choices.dateFixed && (special || choices.dateRequired === true);
    const date = choices.dateFixed
        ? `<label class="field">${esc(t('upload-date'))}<input type="date" value="${esc(choices.date ?? '')}" readonly><span class="hint">${esc(t('as-date-fixed-hint'))}</span></label>`
        : `<label class="field">${esc(t('upload-date'))}<input type="date" name="date" value="${esc(choices.date ?? '')}"${required ? ' required' : ''}>`
            + `<span class="hint">${esc(t('as-date-hint'))}</span></label>`;
    const start = `<label class="field">${esc(t('team-start-label'))}<input type="time" name="start" value="${esc(choices.start ?? '')}"${special ? ' required' : ''}></label>`;
    return `<div class="as-when">
        ${date}
        ${start}
      </div>`;
}


// The event link field, as typed; under it the link the chosen race has now, when it has one (the
// race line that said it went, team cockpit spec §5.3b: What happens says what a typed link changes).
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
        ${whenHtml(club, choices)}
        ${eventHtml(club, choices)}
      </div></details>`;
}


// Is the race fold open (raceFoldHtml)? When the captain has to look (user, 22 Nov 2026): a special
// team; no race ahead to prefill (nextRaceDate: none); the form's race is not the team's next one (a
// race radio, a typed date, a plan of a later race) or the plan named another date (the entry's
// `forDate`, also one that is over); a dry run that said something about the date, the time or the
// link (`preview.race`, a {note}: the date or a special team's time still empty); and `raceOpen`: the
// captain opened it (the script keeps it open across a redraw) or a refused Store concerned the race
// (manage-inbox.mjs).
function raceOpen(club, entry, choices, preview, now) {
    const {team, date} = choices;
    const next = nextRaceDate(club, team, now);
    const named = entry.team === team && isDate(entry.forDate) ? entry.forDate : null;
    return choices.raceOpen === true || choices.special === true || next === null || date !== next || (named !== null && named !== next)
        || preview?.race === true || Object.hasOwn(preview ?? {}, 'note');
}


// The lines of "What happens" as list items: the preview's lines without the diff summary (the rider
// table shows it); an error instead when the dry run was refused, a neutral line ({note}) while a
// field it needs is empty; none without a preview.
function whatItems(preview) {
    if (preview === null) {
        return [];
    }
    if (Object.hasOwn(preview, 'error')) {
        return [lineLi({sev: 'err', text: preview.error})];
    }
    if (Object.hasOwn(preview, 'note')) {
        return [lineLi({sev: 'neutral', text: preview.note})];
    }
    return preview.lines.filter(l => !l.diff).map(l => lineLi(l));
}


// The team page's Store form of `entry` (spec §5.4, §5.3b), drawn inside its picked row: {row, what,
// actions}. `row` is the form (id store-<entry id>, posting to the entry's Store; data-assign: the
// script redraws on a change; data-hold-reload: the page does not reload while it is open) with the
// hidden fields (drawn, base, touched, startFor, startWas: Store's stale-page guards; raceOpen: the
// race fold is open, which the script keeps up to date for a redraw) and only what the card does not
// show: the team (the other teams in a fold), the race radios, "Store as" (the plans and New plan),
// the Make live box, the type for a new plan only (so a choice in "Store as" moves no field above
// it) and, last, the race fold with the race date, the start time and the event link
// (raceFoldHtml; user, 22 Nov 2026). No line with the riders: the row says them. `what` is "What happens" (the preview
// without its diff line: the table shows it) for the card's slot above its action bar; `actions`
// the action bar: the Store button (form="store-<id>": it posts the form from outside it;
// preview.button as today) and, at the bar's other end, Discard back to `back`. `choices`
// assignChoices' (or a refused Store's), `preview` assignPreview's, {error}, {note} or null.
export function storeForm(club, entry, {choices, preview, now, back}) {
    const {team} = choices;
    const id = `store-${entry.id}`;
    const base = team === null ? '' : club.teams[team].version;
    const open = team !== null && raceOpen(club, entry, choices, preview, now);
    const choose = team === null ? '' : `
      ${racesHtml(choices)}
      ${plansHtml(club, entry, choices, now)}
      ${typeLiveHtml(club, choices, preview, now)}
      ${raceFoldHtml(club, choices, open)}`;
    const items = whatItems(preview);
    const what = items.length === 0 ? '' : `<section class="as-what" aria-labelledby="wh-${esc(entry.id)}"><h3 id="wh-${esc(entry.id)}">${esc(t('as-what'))}</h3>
      <ul class="pv-list">
        ${items.join('\n        ')}
      </ul></section>`;
    const row = `<form id="${esc(id)}" method="post" action="${esc(inboxPath(entry.id))}" data-assign data-hold-reload>`
        + `${hidden({drawn: choices.drawn, base, touched: choices.touched ?? '', startFor: choices.date ?? '', startWas: choices.startWas ?? '', raceOpen: open ? '1' : ''})}
      ${teamHtml(club, choices, entry.team)}${choose}
    </form>`;
    const button = preview?.button ?? t(choices.live ? 'as-store-live' : 'as-store');
    const actions = `<button class="btn primary" type="submit" form="${esc(id)}" data-submit>${esc(button)}</button>
<div class="as-discard">${discardForm(entry.id, back, ridersLine(entry))}</div>`;
    return {row, what, actions};
}


// What a Store did (spec §6.9, circles §5.4), for the Store flash (storeResult): {sheet, head, notLive, said, undo, event, changes, todo, warnings}. `head` {sev: 'ok' |
// 'neutral' | 'err', text}: the version and what riders get (live now; stored and what riders keep;
// red when its race has nothing live); `notLive` the red line after the same file again while its
// race has nothing live, or null; `said` (only after a live Store) that the plan live before stays as
// another plan and when riders get it; `undo` whether the Store switched the race's live version (the
// same Undo as Make live); `event` the race's event link line, or null; `changes` what the caps
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
        sheet, head, notLive, said, undo: result.live && wasId !== result.id,
        event: link === null ? null : t('result-event', {id: link}), changes, todo,
        warnings: uploadWarnings(after, slug, {result, hint, importWarnings, importMore}),
    };
}


// The team page's answer to Store (spec §5.4 "After Store", §8): the Store flash (shapes) {kind, text,
// undo?, result: {id, lines, links}}. `text` is the head line of what the Store did, `kind` 'err' only for
// its red "not live, nothing live in the race"; `undo` when the Store switched the race's live
// version (flashBlock then draws Undo inside it). `lines` in this order: the red line
// after the same file, when riders get it (and the plan that stays), the event link, what the caps
// dropped, the moves, the teams still to do, the warnings. `links` one per team still to do, to its
// upload page. No "Wrong file?": a wrong file made live is undone with Undo, or with Make live of
// the version live before (its row reads "was live"); Delete plan would delete every version.
export function storeResult(before, after, slug, opts) {
    const r = resultParts(before, after, slug, opts);
    const lines = [r.notLive, ...r.said.map(text => ({sev: 'neutral', text})), r.event === null ? null : {sev: 'neutral', text: r.event},
        ...r.changes, ...r.warnings].filter(Boolean);
    const links = r.todo.map(s => ({href: uploadHref(after, s, r.sheet.date, opts.now), text: t('result-hole-link', {team: nameOf(after, s)})}));
    return {kind: r.head.sev === 'err' ? 'err' : 'ok', text: r.head.text, ...(r.undo ? {undo: true} : {}), result: {id: opts.result.id, lines, links}};
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


// A Store flash as markup: flashBlock(flash, undo), then the result's lines and links in
// <div class="result">, data-hold-reload on it while it holds the page's reload (resultHolds).
function resultBlock(flash, undo = null) {
    const {lines, links} = flash.result;
    const list = lines.length === 0 ? '' : `<ul class="pv-list">${lines.map(l => lineLi(l)).join('')}</ul>`;
    const ways = links.map(l => `<a class="btn secondary block" href="${esc(l.href)}">${esc(l.text)}</a>`).join('');
    return `${flashBlock(flash, undo)}<div class="result"${resultHolds(flash) ? ' data-hold-reload' : ''}>${list}${ways}</div>`;
}


// The flash of a page: a Store flash with its result (resultBlock), any other with flashBlock.
export const flashHtml = (flash, undo = null) => (flash?.result ? resultBlock(flash, undo) : flashBlock(flash, undo));


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
