// The assign page /manage/inbox/<id> (plan versions spec §6): an inbox entry with its choices (the
// team, the plan, the type, the "Make live" box, and folded the race date and the event link), the
// preview of Store drawn on the server ("What happens"), the riders, Store and Discard. The script
// redraws it (a GET with the form's fields) when the team, plan, live box or date change; there is
// no button for that (decision 13). The page an entry that is gone answers. Neither reloads itself. Pure: it reads the club, the entry and the choices it is given, and the clock is passed in.
// Every value goes through esc().
import {esc, t} from './pages.mjs';
import {captainPage, flashBlock, hidden, placeNav} from './ui.mjs';
import {ic} from './icons.mjs';
import {atLabel, dateDay, ridersLine, nameOf} from './team-view.mjs';
import {
    lineLi, ridersTable, hintLine, keptOf, droppedLine, moveLines, holeTeams, uploadWarnings, storedDiff,
} from './upload-page.mjs';
import {diffSummary} from './diff.mjs';
import {teamHint} from './club.mjs';
import {plannedStart, effects, raceStartAt, PLAN_OPEN_MS} from './select.mjs';
import {localLabel, isDate, HHMM_RE, zonedToUtc} from './time.mjs';
import {planOfId, ridersShared} from './plans.mjs';
import {entryPlan} from './preselect.mjs';
import {normalizePlan} from '../pages/src/engine/plan.mjs';
import {discardForm} from './team-page.mjs';

const inboxPath = id => `/manage/inbox/${id}`;
const teamPath = slug => `/manage/team/${slug}`;


// Where the assign page, Discard and the result of `entry` go back to: {href, label}. The plan's page
// when the upload came from it (its New version: entry.fromPlan) and the plan still exists; else the
// page of the team the upload was made for; else the teams (the club's name).
export function entryBack(club, entry) {
    const slug = typeof entry.team === 'string' && Object.hasOwn(club.teams, entry.team) ? entry.team : null;
    if (slug === null) {
        return {href: '/manage', label: club.name};
    }
    const p = entry.fromPlan === true && typeof entry.forPlan === 'string' ? planOfId(club, slug, entry.forPlan) : null;
    return p !== null ? {href: `/manage/team/${slug}/plan/${p.id}`, label: p.label} : {href: teamPath(slug), label: club.teams[slug].name};
}


// The crumbs between the club and a page of `entry` (placeNav), ending at entryBack's page: the team
// the upload was made for, and the plan when it came from that plan's New version; none for an entry
// of no team.
export function entryTrail(club, entry) {
    const back = entryBack(club, entry);
    if (back.href === '/manage') {
        return [];
    }
    const slug = entry.team;
    const team = {href: teamPath(slug), label: club.teams[slug].name};
    return back.href === team.href ? [team] : [team, back];
}


// What Store would do, from its dry run (spec §6.6): {lines, diff, riders, withText, button, same};
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
    const hint = hintLine(after, teamHint(before, slug, entry.json, plan.riders.map(r => r.id)), {link: false});
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
    const wasLive = before.teams[slug].live === result.id;
    if (result.same && result.live && !wasLive) {
        lines.push({sev: 'ok', text: t(`as-pv-same-live${phase}`, {n, when, at})});
    } else if (result.same) {
        lines.push({sev: 'info', text: t('as-pv-same', {n})});
    } else if (result.live) {
        const key = `as-pv-${result.created ? 'new-' : ''}live${phase}`;
        lines.push({sev: 'ok', text: t(key, {n, label, when, at})});
    } else {
        const kept = keptOf(after, slug, now);
        const key = `as-pv-${result.created ? 'new-' : ''}off${kept ? '' : '-none'}`;
        lines.push({sev: 'info', text: t(key, {n, label, team: team.name, live: kept?.sheet.label, ln: kept?.sheet.n})});
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
        lines, diff, riders: plan.riders, withText: entry.text != null,
        button: t(live ? 'as-store-live' : 'as-store'),
        same: result.same ? {n, live: wasLive} : null,
    };
}


// One radio of a choice: its title, and a meta line under it.
function radio(name, value, checked, title, meta = '') {
    return `<label class="choice"><input type="radio" name="${name}" value="${esc(value)}"${checked ? ' checked' : ''}><span><strong>${esc(title)}</strong>`
        + `${meta ? `<span>${esc(meta)}</span>` : ''}</span></label>`;
}


// The team (spec §6.2): the chosen one as text, the others in a fold; a club with one team sends it
// as a hidden field; without a chosen team the radios show with "Pick a team.".
function teamHtml(club, {team, teams}) {
    if (team !== null && teams.length === 1) {
        return `${hidden({team})}
      <p class="as-row"><span class="kicker">${esc(t('as-team'))}</span> <strong>${esc(nameOf(club, team))}</strong></p>`;
    }
    const radios = teams.map(x => radio('team', x.slug, x.slug === team, x.name)).join('\n        ');
    if (team === null) {
        return `<fieldset class="choices"><legend>${esc(t('as-team'))}</legend>
        <p class="err-text">${esc(t('as-pick-team'))}</p>
        ${radios}
      </fieldset>`;
    }
    return `<p class="as-row"><span class="kicker">${esc(t('as-team'))}</span> <strong>${esc(nameOf(club, team))}</strong></p>
      <details class="fold"><summary>${esc(t('as-other-team'))}</summary><fieldset class="choices"><legend class="sr">${esc(t('as-team'))}</legend>
        ${radios}
      </fieldset></details>`;
}


// The race line: "Race Thu 19 Nov 19:30" (the day without a start time), with the chosen plan's
// event link. A special team's time is the page's (`start`, what Store would set).
function raceHtml(club, {team, as, date, start, special}) {
    if (!isDate(date)) {
        return '';
    }
    const own = as !== null && as !== 'new' ? planOfId(club, team, as) : null;
    const S = !special ? plannedStart(club, {team, date}) : HHMM_RE.test(start ?? '') ? zonedToUtc(date, start, club.tz) : null;
    let text = t('as-race', {race: S === null ? dateDay(date, club.tz) : localLabel(S, club.tz)});
    const src = own === null ? null : own.live !== null ? club.sheets[own.live] : own.newest[1];
    if (src?.pinnedEventId != null) {
        text += t('as-race-event', {id: src.pinnedEventId});
    }
    return `<p class="as-row">${esc(text)}</p>`;
}


// The plans of the race, one radio each (the live plan with its live version's n, any other its
// newest; a plan of another date with its day), then "New plan"; none checked when `as` is null.
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
    return `<fieldset class="choices"><legend>${esc(t('as-plan'))}</legend>
        ${rows.join('\n        ')}
      </fieldset>`;
}


// The type, its suggestions and its hint; the "Make live" box, its label saying what ticking it does
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
    return `<label class="field">${esc(t('as-type'))} <input name="type" maxlength="30" value="${esc(type)}" list="types" autocomplete="off"></label>`
        + `<datalist id="types">${types.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      <p class="hint">${esc(hint)}</p>
      <label><input type="checkbox" name="live" value="on"${live ? ' checked' : ''}> ${esc(t(`as-live-${liveKind}`, liveVars))}</label>`;
}


// "What happens": the preview's lines, the diff summary with all its lines in a fold; an error
// instead when the dry run was refused, a neutral line ({note}) while a field it needs is empty;
// nothing without a preview.
function whatHtml(preview) {
    if (preview === null) {
        return '';
    }
    const items = Object.hasOwn(preview, 'error') ? [lineLi({sev: 'err', text: preview.error})]
        : Object.hasOwn(preview, 'note') ? [lineLi({sev: 'neutral', text: preview.note})]
        : preview.lines.map(l => (l.diff ? lineLi(l, `<details class="fold"><summary>${esc(t('as-changed'))}</summary>`
            + `<ul>${preview.diff.map(d => `<li>${esc(d.text)}</li>`).join('')}</ul></details>`) : lineLi(l)));
    return `<section class="card" aria-labelledby="wh-h">
    <h2 id="wh-h">${esc(t('as-what'))}</h2>
    <ul class="pv-list">
      ${items.join('\n      ')}
    </ul>
  </section>`;
}


// The assign page of `entry` (spec §6.1). `choices` is assignChoices' (or, after a refused Store, the
// form's), `preview` assignPreview's, {error} or null (no team, or over the parse budget), `flash` a
// refusal's text at the top. Store posts the form; the script sends it as a GET of this page to
// redraw it (data-assign; `touched` is its field). Discard is a form of its own, after it on a line of
// its own, set apart from Store (P2), and asks first in its place.
export function assignPage(club, entry, {now, seen, others, choices, preview, flash = null}) {
    const tz = club.tz;
    const {team} = choices;
    const home = team ?? (typeof entry.team === 'string' && Object.hasOwn(club.teams, entry.team) ? entry.team : null);
    const {riders} = normalizePlan(entry.json, entry.text).plan;
    const title = ridersLine(entry);
    const at = Date.parse(entry.at);
    const source = t(entry.source === 'receive' && entry.via === 'zwiftgopher' ? 'as-source-zwiftgopher' : 'as-source-upload',
        {at: Number.isFinite(at) ? atLabel(at, now, tz) : '–'})
        + (entry.text != null ? t('as-with-text') : '');
    const base = team === null ? '' : club.teams[team].version;
    // a new plan without a default date (a special team with nothing ahead) asks for it above the
    // fold; a special team's plan (new or a version) has its race date and start time there, the
    // time always editable and needed (user, 19 Nov 2026: the newest upload for a date sets it); a
    // version keeps the plan's date. `startFor` says which date the time was drawn for.
    const special = team !== null && choices.special === true;
    const above = team !== null && (special || (!choices.dateFixed && choices.dateRequired === true));
    const date = choices.dateFixed ? `<p>${esc(t('as-date-fixed', {day: dateDay(choices.date, tz)}))}</p>`
        : `<label class="field">${esc(t('upload-date'))} <input type="date" name="date" value="${esc(choices.date ?? '')}"${above ? ' required' : ''}></label>`;
    // a version's fixed date sits beside the time like a field
    const fixed = `<p class="as-fixed"><strong>${esc(t('upload-date'))}</strong><span>${esc(t('as-date-fixed-short', {day: dateDay(choices.date, tz)}))}</span></p>`;
    const when = !special ? date : `<div class="as-when">${hidden({startFor: choices.date ?? ''})}
        ${choices.dateFixed ? fixed : date}
        <label class="field">${esc(t('team-start-label'))} <input type="time" name="start" value="${esc(choices.start ?? '')}" required></label>
      </div>
      <p class="hint">${esc(t('as-start-hint', {tz, team: nameOf(club, team)}))}</p>`;
    const choose = team === null ? '' : `
      ${raceHtml(club, choices)}
      ${plansHtml(club, entry, choices, now)}
      ${typeLiveHtml(club, choices, preview, now)}${above ? `
      ${when}` : ''}`;
    const button = preview?.button ?? t(choices.live ? 'as-store-live' : 'as-store');
    const {href: back} = entryBack(club, entry);
    // the bar and the crumbs go where Discard goes: the plan the upload came from, or the team it was
    // made for, not the one chosen here
    const nav = placeNav(club, [...entryTrail(club, entry), {label: t('as-heading')}]);
    const main = `<main class="page" id="main">
  ${nav.crumbs}
  <header class="pagehead">${home === null ? '' : `<p class="kicker">${esc(nameOf(club, home))}</p>`}<h1>${esc(t('as-heading'))}</h1></header>
  ${flashBlock(flash)}
  <form class="stack" method="post" action="${esc(inboxPath(entry.id))}" data-assign>${hidden({drawn: choices.drawn, base, touched: choices.touched ?? ''})}
    <section class="card stack">
      <p class="as-title"><strong>${esc(title)}</strong></p>
      <p class="hint">${esc(source)}</p>
    </section>
    <section class="card stack">
      ${teamHtml(club, choices)}${choose}
    </section>
    ${whatHtml(preview)}
    <details class="card fold"><summary>${esc(t('as-riders', {n: riders.length}))}</summary>
    ${ridersTable({json: entry.json}, riders)}
    </details>
    <details class="card fold"><summary>${esc(t(above ? 'as-more-link' : 'as-more'))}</summary><div class="stack">${above ? '' : `
      ${date}`}
      <label class="field">${esc(t('upload-event'))} <span class="hint">${esc(t('upload-event-hint'))}</span><input type="text" name="event" maxlength="300" inputmode="url" autocomplete="off" value="${esc(choices.event)}"></label>
    </div></details>
    <button class="btn primary block" type="submit" data-submit>${esc(button)}</button>
  </form>
  <div class="as-discard">${discardForm(entry.id, back, title)}</div>
</main>`;
    return captainPage(club, {now, seen, others, here: home === null ? '/manage' : teamPath(home), bar: nav.bar, main, cls: 'formpage'});
}


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
