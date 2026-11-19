// The upload pages (plan versions spec §5.2, §6.9): the team's upload page, the file only (uploadPage;
// GET /manage/upload?team=<slug>[&plan=<id>[&from=plan]]), and the answer to Store on the assign page
// (uploadResultPage). The pieces the assign page (assign-page.mjs) shares with the result page live
// here too: the warnings, the move and hole lines, the dropped line, the riders table and the link to
// a team's upload page. None of the pages reloads itself (a form or the result's warnings would be
// wiped). Pure: the clock is passed in. Every value from a club, rider or file goes through esc().
import {esc, t, T} from './pages.mjs';
import {plannedStart, usedUp, PLAN_OPEN_MS} from './select.mjs';
import {planOfId, racePlans, previousVersion} from './plans.mjs';
import {localLabel, localHHMM} from './time.mjs';
import {captainPage, flashBlock, hidden, postForm, armForm, sevLine, placeNav} from './ui.mjs';
import {ic} from './icons.mjs';
import {nameOf, atLabel, pullTarget, dateDay, andList, quote} from './team-view.mjs';
import {makeLiveHtml, restoreHtml, undoBlock} from './team-page.mjs';
import {receivedFor} from './club.mjs';
import {diffVersions, diffSummary} from './diff.mjs';

// The result page and the assign page show this many import warnings, then "and N more".
const MAX_IMPORT_WARNINGS = 20;

const teamPath = slug => `/manage/team/${slug}`;
const uploadPath = slug => `/manage/upload?team=${slug}`;
const planPath = (slug, plan) => `/manage/team/${slug}/plan/${plan}`;

// The icon of each line's severity (the assign page's and the result page's lists).
export const SEV_ICON = {ok: 'checkCircle', info: 'swap', neutral: 'info', warn: 'alert', err: 'x'};


// The team's live version {id, sheet}, used up or not, or null.
function liveOf(club, slug) {
    const id = club.teams[slug]?.live;
    return typeof id === 'string' && Object.hasOwn(club.sheets, id) ? {id, sheet: club.sheets[id]} : null;
}


// What riders get from the team meanwhile: its live version unless that has been raced, or null.
export function keptOf(club, slug, now) {
    const keep = liveOf(club, slug);
    const S = keep && plannedStart(club, keep.sheet);
    return keep && (S === null || !usedUp(S, now)) ? keep : null;
}


// The plan of team `slug` that `id` names when it is one of its race plans (not used up), or null.
export function racePlanOf(club, slug, id, now) {
    const p = typeof id === 'string' && id !== '' ? planOfId(club, slug, id) : null;
    return p !== null && racePlans(club, slug, now).some(r => r.id === p.id) ? p : null;
}


// The way to team `slug`'s upload page from another page (a hole to fill): with `plan` set to the
// team's plan for race `date` only when that race has exactly one plan (controller, 17 Nov 2026);
// with two or more the captain picks on the assign page.
export function uploadHref(club, slug, date, now) {
    const plans = racePlans(club, slug, now).filter(p => p.date === date);
    return plans.length === 1 ? `${uploadPath(slug)}&plan=${plans[0].id}` : uploadPath(slug);
}


// GET /manage/upload?team=<slug>[&plan=<id>[&from=plan]]: the planner JSON (a file, or pasted in a
// fold) and an optional text export, a plain field; the captain picks the file(s) and Continue makes
// an inbox entry and goes on to the assign page (nothing goes on by itself).
// `plan` (any id of a race plan of this team; any other value is ignored) is the plan the page was
// opened for: it is sent on as `forPlan`, the assign page's preselection. `from` 'plan' (the plan
// page's New version) makes that plan's page the way back; else it is the team page (a hole link
// sets `plan` too, from the team or the result page). The form's action keeps `plan` and `from`, so
// a refused upload (also one refused before its body is read) draws the same page again. `flash` (a
// refused upload's text, kind 'err') at the top. Never reloads itself. `seen`, `others`:
// captainPage's, as on the result page. Plans from ZwiftGopher waiting for the team show as a line
// with the way to the team page; "Plan on ZwiftGopher" itself sits on the team page, beside "Upload a
// plan" (user, 19 Nov 2026), not here: this page is for the file.
export function uploadPage(club, slug, {now, seen, others, plan = null, from = null, flash = null}) {
    const name = club.teams[slug].name;
    const p = racePlanOf(club, slug, plan, now);
    const toPlan = p !== null && from === 'plan';
    // the way back: the plan the upload was opened from (its New version), else the team
    const nav = placeNav(club, [{href: teamPath(slug), label: name}, ...(toPlan ? [{href: planPath(slug, p.id), label: p.label}] : []), {label: t('crumb-upload')}]);
    const action = p === null ? uploadPath(slug) : `${uploadPath(slug)}&plan=${p.id}${toPlan ? '&from=plan' : ''}`;
    const as = p === null ? '' : `\n    <p class="sub">${esc(t('upload-as-version', {label: p.label}))}</p>`;
    const main = `<main class="page" id="main">
  ${nav.crumbs}
  <header class="pagehead"><h1>${esc(t('upload-heading-for', {team: name}))}</h1>${as}</header>
  ${flashBlock(flash)}${waitingLine(club, slug, now)}
  <form class="stack" method="post" action="${esc(action)}" enctype="multipart/form-data" data-upload>${hidden({team: slug, forPlan: p === null ? '' : p.id})}
    <section class="card stack">
      <label class="field">${esc(t('upload-json'))}<input id="json-in" type="file" name="json" accept=".json,application/json"></label>
      <details class="fold"><summary>${esc(t('upload-paste'))}</summary><label class="field"><span class="sr">${esc(t('upload-paste-label'))}</span><textarea name="paste" rows="5" spellcheck="false"></textarea></label></details>
      <label class="field">${esc(t('upload-text'))} <span class="hint">${esc(t('upload-text-hint'))}</span><input type="file" name="text" accept=".txt,text/plain"></label>
    </section>
    <button class="btn primary block" type="submit">${esc(t('upload-continue'))}</button>
  </form>
</main>`;
    return captainPage(club, {now, seen, others, here: teamPath(slug), bar: nav.bar, main, cls: 'formpage upload'});
}


// "2 plans from ZwiftGopher are waiting", with the way to the team page; '' without any.
function waitingLine(club, slug, now) {
    const n = receivedFor(club, slug, now).length;
    if (n === 0) {
        return '';
    }
    return `
  <p class="banner info" role="note">${ic('info')}<span>${esc(t(n === 1 ? 'upload-waiting-one' : 'upload-waiting', {n}))} `
        + `<a href="${esc(teamPath(slug))}">${esc(t('upload-waiting-link', {team: club.teams[slug].name}))}</a></span></p>`;
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


// The warnings of a stored plan, for the assign page and the result page alike, in this order: no
// start time (err: a weekly team without one, a version of a special team's plan stored without
// one); a special race whose start time this Store changed (`result.startMoved`), with the other
// plans of that date that move with it (info); the hint that the plan looks like another team's, with the way to upload it there
// (warn; the assign page puts it first itself and passes none); a change since the page was drawn
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


// The lines of what a stored version changed against the version before it in its plan (diff.mjs);
// a new plan's first version reads "First version of a new plan".
export function storedDiff(club, result, now) {
    const sheet = club.sheets[result.id];
    const prev = previousVersion(club, result.id)?.[1] ?? null;
    return diffVersions(club, prev, sheet, now, {newPlan: result.created});
}


// "Wrong file?" on the result page (spec §6.9): after a new version, Restore the version before it
// (restoreHtml: a live plan's asks first in its place as the Make live rule says); after a new plan,
// Delete it, asking first in its place, with a warning when that plan went live (the team is then
// left without a live plan); after the same file, nothing ('').
function wrongFile(club, slug, before, result, now) {
    if (result.same) {
        return '';
    }
    if (!result.created) {
        // a version of a live plan stored without going live changed nothing riders get: Back would
        // only make another version live, which undoes nothing (as the plan page, no Back on the live
        // version)
        const liveId = club.teams[slug].live;
        if (!result.live && liveId !== null && Object.hasOwn(club.sheets, liveId) && club.sheets[liveId].plan === result.planId) {
            return '';
        }
        const prev = before.sheets[result.prev];
        return restoreHtml(club, slug, result.planId, prev.n, now, {button: t('result-back-to-ask', {n: prev.n}), plain: t('result-back-to', {n: prev.n}),
            cls: 'btn secondary', icon: 'undo'});
    }
    const {label} = club.sheets[result.id];
    const del = t('result-delete-plan', {label});
    const words = result.live ? t('result-delete-confirm-live', {label, team: club.teams[slug].name}) : t('result-delete-confirm', {label});
    return armForm('/manage/sheet/delete', {team: slug, sheet: result.id, version: club.teams[slug].version}, {key: `del-${result.id}`,
        button: t('result-delete-plan-ask', {label}), cls: 'btn secondary danger-text', icon: 'trash', words, yes: del, yesCls: 'btn danger small'});
}


// A line of the lists: its icon and text; a hint's link after the text; `extra` (markup) after the
// text's span.
export function lineLi(line, extra = '') {
    const link = line.href ? ` <a href="${esc(line.href)}">${esc(line.link)}</a>` : '';
    return `<li class="${esc(line.sev)}">${ic(SEV_ICON[line.sev])}<span>${esc(line.text)}${link}</span>${extra}</li>`;
}


// The riders in ride order with their pull time and target, as a table (never the planner's
// roster). `sheet` holds the plan's json (for the targets), `riders` are normalizePlan's.
export function ridersTable(sheet, riders) {
    const rows = riders.map((r, i) => `<tr><td class="n">${i + 1}</td><td class="nmcol">${esc(r.name)}</td>`
        + `<td class="n">${esc(t('result-pull', {s: r.pullS}))}</td><td class="n">${esc(pullTarget(sheet, r) ?? '–')}</td></tr>`);
    return `<table class="ptable"><thead><tr><th class="n">${esc(t('result-col-pos'))}</th><th>${esc(t('result-col-rider'))}</th>`
        + `<th class="n">${esc(t('result-col-pull'))}</th><th class="n">${esc(t('result-col-target'))}</th></tr></thead>
      <tbody>
        ${rows.join('\n        ')}
      </tbody></table>`;
}


// The answer to Store (spec §6.9, circles §5.4): the version and what riders get (live now, or stored
// and what riders keep, with Make live), the summary of what changed, what it changes for other teams
// with a way to each team still to do, the warnings, "Wrong file?", the riders with their pull
// targets, and the way back. `club` is the club after the Store, `before` the one before it, `result`
// storeEntry's answer, `moves`/`holes` effects(before, club, date) for the stored version's date,
// `hint` teamHint(before, …), `importWarnings` and `importMore` the entry's.
export function uploadResultPage(club, slug, {now, seen, others, before, result, moves = [], holes = [], hint = null, importWarnings = [], importMore = 0, back = null}) {
    const team = club.teams[slug];
    const sheet = club.sheets[result.id];
    const tz = club.tz;
    const parts = [];
    const v = {label: sheet.label, n: sheet.n, sig: sheet.sig};
    const wasId = before.teams[slug]?.live ?? null;
    if (result.same && result.live && wasId !== result.id) {
        // nothing new stored, but the box made that version live: say so (UI panel, audit S9); the
        // version it replaced only when that was live for the same race (review M3: never last
        // week's raced plan)
        const kept = keptOf(before, slug, now);
        const was = kept !== null && kept.sheet.date === sheet.date ? kept.sheet : null;
        parts.push(sevLine('ok', 'checkCircle', was === null ? t('result-same-live-none', {n: sheet.n})
            : t('result-same-live', {n: sheet.n, was: was.label, wn: was.n}), 'big'));
    } else if (result.same) {
        parts.push(sevLine('neutral', 'info', t('result-same', {n: sheet.n}), 'big'));
    } else if (result.live) {
        const S = plannedStart(club, sheet);
        parts.push(sevLine('ok', 'checkCircle', S === null ? t('result-live-v-no-start', v)
            : t('result-live-v', {...v, when: localLabel(S, tz)}), 'big'));
    } else {
        const kept = keptOf(club, slug, now);
        parts.push(kept ? sevLine('neutral', 'info', t('result-stored-v', {...v, live: kept.sheet.label, ln: kept.sheet.n}), 'big')
            : sevLine('warn', 'alert', t('result-stored-v-none', {...v, team: team.name}), 'big'));
    }
    if (!result.same) {
        parts.push(`<p class="vsum">${esc(diffSummary(storedDiff(club, result, now)))}</p>`);
    }
    if (result.live) {
        const S = plannedStart(club, sheet);
        const said = [];
        // the plan live before stays as another plan (not an earlier version of this one)
        const prev = before.teams[slug].live;
        if (!result.same && prev !== null && Object.hasOwn(club.sheets, prev) && club.sheets[prev].plan !== result.planId) {
            said.push(t('result-stays', {label: club.sheets[prev].label}));
        }
        if (S !== null) {
            // after the gate: riders in the event get it within a minute
            said.push(now >= S - PLAN_OPEN_MS ? t('result-from-open') : t('result-from', {at: atLabel(S - PLAN_OPEN_MS, now, tz)}));
        }
        if (said.length) {
            parts.push(`<p>${esc(said.join(' '))}</p>`);
        }
        // Store and make live switched the live plan: the same Undo as Make live (S17, UI panel wave 2)
        const undo = wasId !== result.id ? undoBlock(club, slug, now) : null;
        if (undo !== null) {
            parts.push(flashBlock(null, undo));
        }
    } else {
        // Make live asks first in its place only as the Make live rule says (makeLiveHtml)
        parts.push(makeLiveHtml(club, slug, result.id, {now, button: t('tp-make-live-ask'), plain: t('tp-confirm-live'), sr: false, cls: 'btn primary'}));
    }
    if (sheet.pinnedEventId != null) {
        parts.push(`<p class="hint">${esc(t('result-event', {id: sheet.pinnedEventId}))}</p>`);
    }
    // what this changes: the dropped version or plan, the moves, and each team still to do with its
    // upload page
    const changes = [droppedLine(result), ...moveLines(club, moves)].filter(Boolean);
    const todo = holeTeams(holes);
    changes.push(...todo.map(s => ({sev: 'warn', text: `${t('result-holes', {teams: nameOf(club, s)})}.`})));
    if (changes.length) {
        const links = todo.map(s => `<a class="btn secondary block" href="${esc(uploadHref(club, s, sheet.date, now))}">${ic('upload')}${esc(t('result-hole-link', {team: nameOf(club, s)}))}</a>`);
        parts.push(`<section class="card" aria-labelledby="eff-h">
    <h2 id="eff-h">${esc(t('result-effects'))}</h2>
    <ul class="pv-list">
      ${changes.map(l => lineLi(l)).join('\n      ')}
    </ul>${links.length ? `\n    ${links.join('\n    ')}` : ''}
  </section>`);
    }
    const warnings = uploadWarnings(club, slug, {result, hint, importWarnings, importMore});
    if (warnings.length) {
        parts.push(`<section class="card">
    <ul class="pv-list">
      ${warnings.map(l => lineLi(l)).join('\n      ')}
    </ul>
  </section>`);
    }
    const wrong = wrongFile(club, slug, before, result, now);
    if (wrong) {
        parts.push(`<section class="card undocard" aria-labelledby="wrong-h">
    <h2 id="wrong-h" class="kicker">${ic('undo')}${esc(t('result-wrong'))}</h2>
    ${wrong}
  </section>`);
    }
    const {riders} = result.plan;
    const n = riders.length === 1 ? t('tp-riders-one') : t('tp-riders-n', {n: riders.length});
    parts.push(`<section class="card" aria-labelledby="rr-h">
    <div class="card-head"><h2 id="rr-h">${esc(t('result-riders'))}</h2><p class="count">${esc(n)}</p></div>
    ${ridersTable(sheet, riders)}
  </section>`);
    // `back` ({href, label}: the plan page the upload came from, assign-page.mjs entryBack), else the team
    const home = back ?? {href: teamPath(slug), label: team.name};
    parts.push(`<a class="btn quiet" href="${esc(home.href)}">${ic('left')}${esc(t('result-back', {team: home.label}))}</a>`);
    const nav = placeNav(club, [{href: teamPath(slug), label: team.name}, ...(home.href === teamPath(slug) ? [] : [home]), {label: t('result-heading')}]);
    const main = `<main class="page" id="main">
  ${nav.crumbs}
  <header class="pagehead"><p class="kicker">${esc(team.name)}</p><h1>${esc(t('result-heading'))}</h1></header>
  ${parts.join('\n  ')}
</main>`;
    return captainPage(club, {now, seen, others, here: teamPath(slug), bar: nav.bar, main, cls: 'formpage'});
}
