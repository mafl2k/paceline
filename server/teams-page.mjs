// The club hub /manage (spec §5.4; UI panel wave 3, user's sketch B, 19 Nov 2026): the club, its
// next race, "Updated", the DST banner, then each block only when it has something: "To do before
// the race" (every fix item across teams: the team, its start time, the problem in the team page's
// words and the team page's own button for it), "New plans from ZwiftGopher" (every plan waiting,
// with Review and store and Discard), and one table per race day from the next to 7 days ahead (the
// team, its start, the live plan, who has it or when it opens, the worst state). With nothing to do
// and nothing waiting one line says so. From 1024 px that is all (the sidebar lists the teams); on a
// phone the team tiles follow under "Teams" (teamRow: the worst state's colour and icon, the time,
// the status and a quiet line), the folded teams (foldedTeams) in "Other teams (n)". "Add a team" at
// the end. A club without teams gets the first run instead: three steps and the add-team form,
// never reloading. Both in the captain frame (ui.mjs captainPage), the club name marked in its
// sidebar; the footer at the end of the page shows on phones only (the sidebar has it from 1024
// px). Pure: it reads the club and the checks it is given, and the clock is passed in. Every value
// goes through esc().
import {esc, t} from './pages.mjs';
import {captainPage, flashBlock, hidden, sevLine, freshLine, footer, dstBanner} from './ui.mjs';
import {ic} from './icons.mjs';
import {teamView, teamRow, teamOrder, refreshDue, nextRace, nextRaceAt, foldedTeams, SEV} from './team-view.mjs';
import {localHHMM, localLabel, localDate, addDays, dstChangedRecently} from './time.mjs';
import {rhythmFields, noteAction, noStartAction, discardForm, teamSr} from './team-page.mjs';

const teamPath = slug => `/manage/team/${slug}`;
// the race days the hub lists after the next one: up to this many days ahead
const RACE_DAYS = 7;


// The club name with `kicker` above it; without one an empty kicker from 1024 px keeps the title
// where it is on every captain page.
function clubHead(club, kicker) {
    return `<header class="clubhead">
    <div>${kicker === null ? '<p class="kicker desk"></p>' : `<p class="kicker">${esc(kicker)}</p>`}<h1>${esc(club.name)}</h1></div>
    <a class="btn quiet small" href="/manage/settings">${ic('settings')}${esc(t('tp-club-settings'))}</a>
  </header>`;
}


function tile(row) {
    return `<li><a class="tile edge-${esc(row.sev)}" href="/manage/team/${esc(row.slug)}">
      <span class="tile-top"><span class="tile-name">${esc(row.name)}</span><span class="tile-time">${esc(row.timeLine)}</span>${row.received ? `<span class="newplans">${esc(row.received)}</span>` : ''}${ic('right', 'chev')}</span>
      ${sevLine(row.sev, row.icon, row.main, '', 'span')}
      <span class="tile-quiet">${esc(row.quiet)}</span>
    </a></li>`;
}


// A team's start as the hub's lines show it: '19:30' today, 'Fri 20 Nov 19:30' on another day, the
// day alone without a time, '–' without a race.
function startOf(view) {
    const {when} = view;
    return when.time === null ? when.day ?? '–' : when.today ? when.time : `${when.day} ${when.time}`;
}


const sevIcon = sev => (sev === 'err' ? 'x' : sev === 'warn' ? 'alert' : 'info');

// The fix items of one team (UI panel wave 3), each {sev, text, act}: the team page's problem in its
// words and its button. No start time (the red callout: Set the start time, or a special race's
// upload); no live plan near the race (the red status: plans stored, "Make one of its plans live" on
// the team page; none stored, Upload a plan); each note (riders in another event, a rider who now
// rides another team: Remove event link, Upload without <rider>).
function fixItems(club, view, now) {
    const items = [];
    const {status} = view;
    if (status.kind === 'no-start') {
        items.push({sev: 'err', text: status.text, act: noStartAction(club, view, now, {hub: true})});
    } else if (status.sev === 'err' && status.kind === 'none-live') {
        items.push({sev: 'err', text: status.text,
            act: `<a class="btn secondary small" href="${esc(teamPath(view.slug))}#plans-h">${esc(t('tv-row-none-live'))}${teamSr(view, true)}</a>`});
    } else if (status.sev === 'err' && status.kind === 'no-plan') {
        items.push({sev: 'err', text: status.text,
            act: `<a class="btn secondary small" href="/manage/upload?team=${esc(view.slug)}">${ic('upload')}${esc(t('tp-upload-plan'))}${teamSr(view, true)}</a>`});
    }
    for (const n of view.notes) {
        items.push({sev: n.sev, text: n.title, act: noteAction(club, view, n, now, {hub: true})});
    }
    return items;
}


// One line of the hub's lists: the icon, the team (a link) and `when`, the words, the buttons.
function hubLi(view, {sev, icon, when, text, acts}) {
    return `<li class="${esc(sev)}">${ic(icon)}<p class="todo-who"><a href="${esc(teamPath(view.slug))}">${esc(view.name)}</a><span class="muted">${esc(when)}</span></p>`
        + `<p class="todo-what">${esc(text)}</p><div class="todo-acts">${acts}</div></li>`;
}


// "To do before the race": every fix item across teams, by start time (none last), then the worst
// first; '' without any.
function todoHtml(club, views, now) {
    const items = views.flatMap((view, i) => fixItems(club, view, now).map((item, j) => ({...item, view, i, j})));
    if (!items.length) {
        return '';
    }
    const at = x => x.view.S ?? Infinity;
    items.sort((a, b) => at(a) - at(b) || SEV[b.sev] - SEV[a.sev] || a.i - b.i || a.j - b.j);
    const lis = items.map(x => hubLi(x.view, {sev: x.sev, icon: sevIcon(x.sev), when: startOf(x.view), text: x.text, acts: x.act}));
    return `<section class="card" aria-labelledby="todo-h">
    <h2 id="todo-h">${esc(t('hub-todo'))}</h2>
    <ul class="todo">
      ${lis.join('\n      ')}
    </ul>
  </section>`;
}


// "New plans from ZwiftGopher": every plan waiting across teams (in team order, each team's newest
// first), with the team page's Review and store (its assign page) and Discard (back here, asking
// first in its place); '' without any.
function receivedHtml(views) {
    const lis = views.flatMap(view => view.received.map(r => {
        const what = [r.riders === 1 ? t('tp-riders-one') : t('tp-riders-n', {n: r.riders})];
        if (r.name !== null) {
            what.unshift(t('tp-received-name', {name: r.name}));
        }
        const acts = `<a class="btn primary small" href="/manage/inbox/${esc(r.id)}">${esc(t('tp-received-review'))}${teamSr(view, true)}</a>`
            + discardForm(r.id, '/manage', r.line, {small: true, team: view.name});
        return hubLi(view, {sev: 'info', icon: 'file', when: t('tp-received-at', {at: r.at}), text: what.join(' · '), acts});
    }));
    if (!lis.length) {
        return '';
    }
    return `<section class="card" aria-labelledby="recv-h">
    <h2 id="recv-h">${esc(t('hub-received'))}</h2>
    <ul class="todo">
      ${lis.join('\n      ')}
    </ul>
  </section>`;
}


// One table per race day, from the next to RACE_DAYS ahead (a next race further away: that one
// alone): one row per team whose race is that day (its view's race), with the team, its start, the
// live plan and its version, "4 of 6 have it" once the plan is open or "opens 19:00" before, and the
// worst state's icon (its words for screen readers). [] without any race ahead.
function racesHtml(club, views, rows, now) {
    const tz = club.tz;
    const today = localDate(now, tz);
    const last = addDays(today, RACE_DAYS);
    const all = new Map();
    for (const view of views) {
        const date = view.S !== null ? localDate(view.S, tz) : view.raceDate;
        if (date !== null && date >= today) {
            all.set(date, [...(all.get(date) ?? []), view]);
        }
    }
    const dates = [...all.keys()].sort();
    const shown = dates.filter(d => d <= last);
    const byDate = new Map((shown.length ? shown : dates.slice(0, 1)).map(d => [d, all.get(d)]));
    const th = key => `<th scope="col">${esc(t(key))}</th>`;
    return [...byDate.keys()].sort().map((date, k) => {
        const trs = byDate.get(date).map(v => {
            const start = v.when.time !== null ? esc(v.when.time) : v.noStart ? `<span class="err-text">${esc(t('tv-row-no-start'))}</span>` : '–';
            const plan = v.live ? esc(t('hub-plan', {label: v.live.label, n: v.live.n})) : '<span class="muted">–</span>';
            const riders = v.open ? `${esc(t('hub-has', {has: v.has, n: v.count}))}<span class="desk"> ${esc(t(v.count === 1 ? 'hub-has-tail-one' : 'hub-has-tail'))}</span>`
                : v.live?.sent ? esc(t('hub-opens', {opens: localHHMM(v.gateAt, tz)})) : '<span class="muted">–</span>';
            return `<tr><td><a href="${esc(teamPath(v.slug))}">${esc(v.name)}</a></td><td class="t">${start}</td><td>${plan}</td><td>${riders}</td>`
                + `<td class="st"><span class="sevicon ${esc(v.sev)}">${ic(v.icon)}<span class="sr">${esc(rows.get(v.slug).main)}</span></span></td></tr>`;
        });
        const day = byDate.get(date)[0].when.day;
        return `<section class="card" aria-labelledby="race-${k}-h">
    <h2 id="race-${k}-h">${esc(t('hub-race', {day}))}</h2>
    <table class="ptable racetable" aria-labelledby="race-${k}-h">
      <thead><tr>${th('hub-col-team')}<th scope="col" class="t">${esc(t('hub-col-start'))}</th>${th('hub-col-plan')}${th('hub-col-riders')}<th scope="col" class="st"><span class="sr">${esc(t('hub-col-status'))}</span></th></tr></thead>
      <tbody>
        ${trs.join('\n        ')}
      </tbody>
    </table>
  </section>`;
    });
}


const STEPS = [['fr-step-team', 'fr-step-team-sub'], ['fr-step-plan', 'fr-step-plan-sub'], ['fr-step-riders', 'fr-step-riders-sub']];

// No teams yet: the three steps and the add-team form (it posts like the new-team page's, with the
// same race rhythm).
function firstRun(club, {now, seen, flash, others}) {
    const steps = STEPS.map(([title, sub], i) => `<li${i === 0 ? ' class="now"' : ''}><span class="stepnum">${i + 1}</span>`
        + `<span><strong>${esc(t(title))}</strong><span class="sub">${esc(t(sub))}</span></span></li>`);
    const main = `<main class="page" id="main">
  ${clubHead(club, t('fr-welcome'))}
  ${flashBlock(flash)}
  <p class="banner info" role="note">${ic('info')}<span>${esc(t('fr-bookmark', {club: club.name}))}</span></p>
  <section class="card onboard" aria-labelledby="steps-h">
    <h2 id="steps-h">${esc(t('fr-steps'))}</h2>
    <ol class="steps">
      ${steps.join('\n      ')}
    </ol>
  </section>
  <section class="card" aria-labelledby="add-h">
    <h2 id="add-h">${esc(t('fr-add'))}</h2>
    <form class="stack" method="post" action="/manage/team">${hidden({action: 'add'})}
      <label class="field">${esc(t('team-name-label'))}<input name="name" maxlength="40" required autocomplete="off" placeholder="${esc(t('fr-placeholder'))}"></label>
      ${rhythmFields(club, {kind: 'weekly', weekday: null, start: ''})}
      <button class="btn primary block" type="submit">${ic('plus')}${esc(t('team-add'))}</button>
    </form>
  </section>
  ${footer({club: club.name, others})}
</main>`;
    return captainPage(club, {now, seen, others, here: '/manage', herePage: true, main, cls: 'firstrun'});
}


// The hub of `club`, or its first run when it has no teams. `seen` is store.seenOf(cid); `refresh`
// false keeps it from reloading itself (a refusal answers a POST: its URL must not be reloaded).
export function teamsPage(club, {now, seen = {}, flash = null, refresh = true, others = []}) {
    const slugs = teamOrder(club, now);
    if (!slugs.length) {
        return firstRun(club, {now, seen, flash, others});
    }
    const day = nextRace(club, now);
    const updated = localHHMM(now, club.tz);
    const folded = foldedTeams(club, now);
    // one view per team, drawn once: the blocks, the tiles and the sidebar's rows
    const views = slugs.map(s => teamView(club, s, {now, seen}));
    const rows = views.map(teamRow);
    const rowOf = new Map(rows.map(r => [r.slug, r]));
    const todo = todoHtml(club, views, now);
    const received = receivedHtml(views);
    const next = nextRaceAt(club, now);
    const nothing = todo || received ? ''
        : sevLine('ok', 'checkCircle', next === null ? t('hub-nothing-none') : t('hub-nothing', {race: localLabel(next, club.tz)}), 'nothing');
    const blocks = [nothing, todo, received, ...racesHtml(club, views, rowOf, now)].filter(Boolean);
    const tileOf = slug => tile(rowOf.get(slug));
    const tiles = slugs.filter(s => !folded.has(s)).map(tileOf);
    // special teams with nothing in the next 14 days, below the rest (decision 11); the fold holds no
    // form input, so it does not hold the guarded reload (client.mjs holdsReload)
    const other = folded.size === 0 ? '' : `
    <details class="fold" data-keep-refresh><summary>${esc(t('teams-other', {n: folded.size}))}</summary><ul class="tiles">
      ${slugs.filter(s => folded.has(s)).map(tileOf).join('\n      ')}
    </ul></details>`;
    const main = `<main class="page wide" id="main">
  ${clubHead(club, day === null ? null : t('teams-next', {day}))}
  ${freshLine(updated, '/manage')}
  ${dstChangedRecently(club.tz, now) ? dstBanner() : ''}
  ${flashBlock(flash)}
  ${blocks.join('\n  ')}
  <section class="hub-teams" aria-labelledby="teams-h">
    <h2 class="band" id="teams-h">${esc(t('teams-heading'))}</h2>
    <ul class="tiles">
      ${tiles.join('\n      ')}
    </ul>${other}
  </section>
  <a class="btn secondary hub-add" href="/manage/new-team">${ic('plus')}${esc(t('team-add-heading'))}</a>
  ${footer({club: club.name, others})}
</main>`;
    return captainPage(club, {now, seen, others, here: '/manage', herePage: true, main, rows, cls: 'teamspage', refresh: refresh && refreshDue(club, now) ? '/manage' : null, updated});
}
