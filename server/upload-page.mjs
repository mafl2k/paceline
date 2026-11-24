// The team's upload page (plan versions spec §5.2; GET /manage/upload?team=<slug>[&plan=<id>][&date=<date>]),
// the file only, and the pieces the Store form and its answer in the team page (store-form.mjs)
// take from here: the warnings, the move and hole lines, the dropped line and the link to a team's
// upload page. The page never reloads itself (a chosen file would be lost). Pure: the clock is
// passed in. Every value from a club, rider or file goes through esc().
import {esc, t, T} from './pages.mjs';
import {plannedStart, usedUp} from './select.mjs';
import {planOfId} from './plans.mjs';
import {choicePlans} from './preselect.mjs';
import {localHHMM, isDate} from './time.mjs';
import {captainPage, flashBlock, hidden, placeNav} from './ui.mjs';
import {ic} from './icons.mjs';
import {nameOf, dateDay, andList, quote} from './team-view.mjs';
import {receivedFor} from './club.mjs';
import {raceOf} from './races.mjs';

// The Store preview and its answer show this many import warnings, then "and N more".
const MAX_IMPORT_WARNINGS = 20;

const teamPath = slug => `/manage/team/${slug}`;
const uploadPath = slug => `/manage/upload?team=${slug}`;

// The icon of each line's severity (the Store form's and its answer's lists).
export const SEV_ICON = {ok: 'checkCircle', info: 'swap', neutral: 'info', warn: 'alert', err: 'x'};


// The live version {id, sheet} of team `slug`'s race on `date` (races spec §1: live is per race),
// used up or not, or null.
export function liveOf(club, slug, date) {
    const id = raceOf(club, slug, date)?.live;
    return typeof id === 'string' && Object.hasOwn(club.sheets, id) ? {id, sheet: club.sheets[id]} : null;
}


// What riders get from the team's race on `date` meanwhile: that race's live version unless it is
// used up, or null.
export function keptOf(club, slug, date, now) {
    const keep = liveOf(club, slug, date);
    const S = keep && plannedStart(club, keep.sheet);
    return keep && (S === null || !usedUp(S, now)) ? keep : null;
}


// The key of the red words of a Store that is not live while nothing in its race is live (spec §8):
// `base` ('result-stored-v-none' or 'result-not-live'), or its '-no-start' form for a race without
// any start time, which gets nothing even once a plan is live (no promise of Make live alone).
export const notLiveKey = (club, sheet, base) => `${base}${plannedStart(club, sheet) === null ? '-no-start' : ''}`;


// The plan of team `slug` that `id` names when it can take a version (preselect.mjs choicePlans: not
// used up, its race not over, M9), or null.
export function racePlanOf(club, slug, id, now) {
    const p = typeof id === 'string' && id !== '' ? planOfId(club, slug, id) : null;
    return p !== null && choicePlans(club, slug, now).some(r => r.id === p.id) ? p : null;
}


// The way to team `slug`'s upload page from another page (a hole to fill): with `plan` set to the
// team's plan for race `date` only when that race has exactly one plan (controller, 17 Nov 2026);
// with two or more the captain picks in the Store form. It carries `date` (when it is one), so the
// Store form opens on that race (races Task 7).
export function uploadHref(club, slug, date, now) {
    const plans = choicePlans(club, slug, now).filter(p => p.date === date);
    const race = isDate(date) ? `&date=${date}` : '';
    return plans.length === 1 ? `${uploadPath(slug)}&plan=${plans[0].id}${race}` : `${uploadPath(slug)}${race}`;
}


// GET /manage/upload?team=<slug>[&plan=<id>][&date=<date>]: the planner's JSON export (a file, or
// pasted in a fold; races spec §4: the text upload went); the captain picks the file and Continue
// makes an inbox entry and goes on to the team page with it picked (?e=<id>#panel, manage.mjs; nothing
// goes on by itself). `plan` (any id of a race plan of this team; any other value is ignored) is the
// plan the page was opened for (a hole's link; the plan ⋯'s New version until 23 Nov 2026, links of it already handed out): it is sent on as `forPlan`,
// the Store form's preselection. `date` (when it passes isDate) is the race the page was opened for
// (a hole's link; the race ⋯'s "Upload a file for this race" until 23 Nov 2026, links of it already handed out): it is sent on as `forDate`, the Store
// form's race. The way back is the team page. The form's action keeps `plan` and `date`, so a refused
// upload (also one refused before its body is read) draws the same page again. `flash` (a refused
// upload's text, kind 'err') at the top. Never reloads itself. `seen`, `others`: captainPage's.
// Plans from ZwiftGopher waiting for the team show as a line with the way to the team page; "Plan on
// ZwiftGopher" itself sits on the team page, above "Upload a file" (user, 19 Nov 2026; races
// spec §4), not here: this page is for the file. A `from` in the query (a link from before the team
// cockpit) is ignored.
export function uploadPage(club, slug, {now, seen, others, plan = null, date = null, flash = null}) {
    const name = club.teams[slug].name;
    const p = racePlanOf(club, slug, plan, now);
    const team = teamPath(slug);
    const nav = placeNav(club, [{href: team, label: name}, {label: t('crumb-upload')}]);
    const forDate = isDate(date) ? date : '';
    const action = (p === null ? uploadPath(slug) : `${uploadPath(slug)}&plan=${p.id}`) + (forDate ? `&date=${forDate}` : '');
    const as = p === null ? '' : `\n    <p class="sub">${esc(t('upload-as-version', {label: p.label}))}</p>`;
    const main = `<main class="page" id="main">
  ${nav.crumbs}
  <header class="pagehead"><h1>${esc(t('upload-heading-for', {team: name}))}</h1>${as}</header>
  ${flashBlock(flash)}${waitingLine(club, slug, now, team)}
  <form class="stack" method="post" action="${esc(action)}" enctype="multipart/form-data" data-upload>${hidden({team: slug, forPlan: p === null ? '' : p.id, ...(forDate ? {forDate} : {})})}
    <section class="card stack">
      <label class="field">${esc(t('upload-json'))}<input id="json-in" type="file" name="json" accept=".json,application/json"></label>
      <details class="fold"><summary>${esc(t('upload-paste'))}</summary><label class="field"><span class="sr">${esc(t('upload-paste-label'))}</span><textarea name="paste" rows="5" spellcheck="false"></textarea></label></details>
    </section>
    <button class="btn primary block" type="submit">${esc(t('upload-continue'))}</button>
  </form>
</main>`;
    return captainPage(club, {now, seen, others, here: teamPath(slug), bar: nav.bar, main, cls: 'formpage upload'});
}


// "2 plans from ZwiftGopher are waiting", with the way to the team page (`team`, its path); '' without any.
function waitingLine(club, slug, now, team) {
    const n = receivedFor(club, slug, now).length;
    if (n === 0) {
        return '';
    }
    return `
  <p class="banner info" role="note">${ic('info')}<span>${esc(t(n === 1 ? 'upload-waiting-one' : 'upload-waiting', {n}))} `
        + `<a href="${esc(team)}">${esc(t('upload-waiting-link', {team: club.teams[slug].name}))}</a></span></p>`;
}


// The hint that a plan looks like another team's (teamHint), as a line; with `link` the way to
// upload it there. Null without a hint.
export function hintLine(club, hint, {link = true} = {}) {
    if (hint?.kind !== 'name' && hint?.kind !== 'overlap') {
        return null;
    }
    const other = nameOf(club, hint.team);
    const text = hint.kind === 'name' ? t('result-hint-name', {team: other})
        : t('result-hint-overlap', {team: other, shared: hint.shared, total: hint.total});
    return link ? {sev: 'warn', text, href: uploadPath(hint.team), link: t('upload-hint-link', {team: other})} : {sev: 'warn', text};
}


// The warnings of a stored plan, for the Store preview and its answer alike, in this order: no
// start time (err: a weekly team without one, a version of a special team's plan stored without
// one); a race whose start time this Store changed (`result.startMoved`), with the other plans of
// that date that move with it (info; warn with others); a race whose event link this Store set or
// changed (`result.linkMoved`), with the other plans that share it and, when the race's live plan is
// another one, that riders in another event then get nothing from it (likewise); the hint that the
// plan looks like another team's, with the way to upload it there
// (warn; the Store preview puts it first itself and passes none); a change since the page was drawn
// (`base`); no pull watts (every rider's watts null after the import, as the mod warns: no usable
// pull_power and no text row); the import warnings, at most MAX_IMPORT_WARNINGS of them, then how many
// more (`importMore`: the ones the entry did not keep). `club` is the club after the Store, `hint`
// teamHint(before, …). [{sev, text, href?, link?}].
export function uploadWarnings(club, slug, {result, hint = null, importWarnings = [], importMore = 0}) {
    const team = club.teams[slug];
    const out = [];
    const sheet = club.sheets[result.id];
    if (sheet !== undefined && plannedStart(club, sheet) === null) {
        out.push({sev: 'err', text: team.kind === 'special' ? t('result-no-start-plan') : t('result-no-start', {team: team.name})});
    }
    const moved = result.startMoved ?? null;
    if (moved !== null) {
        const day = dateDay(moved.date, club.tz);
        const parts = [moved.was === null ? t('result-race-set', {day, start: moved.start}) : t('result-race-moved', {day, start: moved.start, was: moved.was})];
        if (moved.others.length) {
            parts.push(t(moved.others.length === 1 ? 'result-race-moves-one' : 'result-race-moves', {labels: andList(moved.others.map(quote))}));
        }
        // other plans that move with it are news; the plan's own race is what was asked for
        out.push({sev: moved.others.length ? 'warn' : 'info', text: parts.join(' ')});
    }
    const link = result.linkMoved ?? null;
    if (link !== null) {
        const day = dateDay(link.date, club.tz);
        const parts = [link.was === null ? t('result-link-set', {day, id: link.id}) : t('result-link-moved', {day, id: link.id, was: link.was})];
        if (link.others.length) {
            parts.push(t(link.others.length === 1 ? 'result-race-moves-one' : 'result-race-moves', {labels: andList(link.others.map(quote))}));
        }
        // the link is the race's: a Store that does not make its plan live re-pins the race's live
        // plan too, so riders already in another event then get nothing from it (races Task 2)
        const live = liveOf(club, slug, link.date);
        if (live !== null && live.id !== result.id) {
            parts.push(t('result-link-live', {label: live.sheet.label}));
        }
        // the race's link: other plans that share it are news
        out.push({sev: link.others.length ? 'warn' : 'info', text: parts.join(' ')});
    }
    const h = hintLine(club, hint);
    if (h !== null) {
        out.push(h);
    }
    const changedAt = Date.parse(result.changedAt);
    if (result.changedAt != null && Number.isFinite(changedAt)) {
        out.push({sev: 'warn', text: t('result-changed', {team: team.name, time: localHHMM(changedAt, club.tz)})});
    }
    if (result.plan.riders.every(r => r.watts === null)) {
        out.push({sev: 'warn', text: t('import-no-watts')});
    }
    // one per unmatched text row: at most MAX_IMPORT_WARNINGS
    const known = importWarnings.filter(w => Object.hasOwn(T, `import-${w.code}`));
    for (const w of known.slice(0, MAX_IMPORT_WARNINGS)) {
        out.push({sev: 'warn', text: t(`import-${w.code}`, {name: w.name})});
    }
    const more = Math.max(0, known.length - MAX_IMPORT_WARNINGS) + (Number.isInteger(importMore) && importMore > 0 ? importMore : 0);
    if (more > 0) {
        out.push({sev: 'warn', text: t('import-more', {n: more})});
    }
    return out;
}


// The moves (info) of effects(before, after, date).
export function moveLines(club, moves) {
    return moves.map(m => ({sev: 'info', text: `${t('result-move', {name: m.name, from: nameOf(club, m.from), to: nameOf(club, m.to)})}.`}));
}

export const holeTeams = holes => [...new Set(holes.map(h => h.slug))];

// What the Store deleted to make room (the oldest raced plan, or a plan's oldest version), as a
// line, or null.
export function droppedLine(result) {
    const d = result.dropped;
    return d === null ? null : d.kind === 'plan' ? {sev: 'info', text: t('result-dropped', {label: d.label, date: d.date})}
        : {sev: 'info', text: t('result-dropped-version', {n: d.n, label: d.label})};
}


// A line of the lists: its icon and text; a hint's link after the text; `extra` (markup) after the
// text's span.
export function lineLi(line, extra = '') {
    const link = line.href ? ` <a href="${esc(line.href)}">${esc(line.link)}</a>` : '';
    return `<li class="${esc(line.sev)}">${ic(SEV_ICON[line.sev])}<span>${esc(line.text)}${link}</span>${extra}</li>`;
}
