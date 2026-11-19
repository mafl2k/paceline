// The team picker /manage (spec §5.4): the club, its next race, "Updated", the DST banner, one tile
// per team in teamOrder (teamRow: the worst state's colour and icon, the time, the status and a
// quiet line), "Add a team", then the folded teams (foldedTeams) in "Other teams (n)", the club
// settings link. A club without teams gets the first run instead: three steps and the add-team
// form, never reloading. Both in the captain frame (ui.mjs captainPage), the club name marked in
// its sidebar; the footer at the end of the page shows on phones only (the sidebar has it from
// 1024 px). Pure: it reads the club and the checks it is given, and the clock is passed in. Every
// value goes through esc().
import {esc, t} from './pages.mjs';
import {captainPage, flashBlock, hidden, sevLine, freshLine, footer, dstBanner} from './ui.mjs';
import {ic} from './icons.mjs';
import {teamView, teamRow, teamOrder, refreshDue, nextRace, foldedTeams} from './team-view.mjs';
import {localHHMM, dstChangedRecently} from './time.mjs';
import {rhythmFields} from './team-page.mjs';


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
      <span class="tile-top"><span class="tile-name">${esc(row.name)}</span><span class="tile-time">${esc(row.timeLine)}</span>${ic('right', 'chev')}</span>
      ${sevLine(row.sev, row.icon, row.main, '', 'span')}
      <span class="tile-quiet">${esc(row.quiet)}</span>
    </a></li>`;
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
    return captainPage(club, {now, seen, others, here: '/manage', main, cls: 'firstrun'});
}


// The picker of `club`, or its first run when it has no teams. `seen` is store.seenOf(cid);
// `refresh` false keeps it from reloading itself (a refusal answers a POST: its URL must not be
// reloaded).
export function teamsPage(club, {now, seen = {}, flash = null, refresh = true, others = []}) {
    const slugs = teamOrder(club, now);
    if (!slugs.length) {
        return firstRun(club, {now, seen, flash, others});
    }
    const day = nextRace(club, now);
    const updated = localHHMM(now, club.tz);
    const folded = foldedTeams(club, now);
    const tileOf = slug => tile(teamRow(teamView(club, slug, {now, seen})));
    const tiles = slugs.filter(s => !folded.has(s)).map(tileOf);
    const add = `<li><a class="tile add" href="/manage/new-team">${ic('plus')}${esc(t('team-add-heading'))}</a></li>`;
    // special teams with nothing in the next 14 days, below the rest (decision 11); the fold holds no
    // form input, so it does not hold the guarded reload (client.mjs holdsReload)
    const other = folded.size === 0 ? '' : `
  <details class="fold" data-keep-refresh><summary>${esc(t('teams-other', {n: folded.size}))}</summary><ul class="tiles">
    ${slugs.filter(s => folded.has(s)).map(tileOf).join('\n    ')}
  </ul></details>`;
    const main = `<main class="page wide" id="main">
  ${clubHead(club, day === null ? null : t('teams-next', {day}))}
  ${freshLine(updated, '/manage')}
  ${dstChangedRecently(club.tz, now) ? dstBanner() : ''}
  ${flashBlock(flash)}
  <h2 class="sr">${esc(t('teams-heading'))}</h2>
  <ul class="tiles">
    ${[...tiles, add].join('\n    ')}
  </ul>${other}
  ${footer({club: club.name, others})}
</main>`;
    return captainPage(club, {now, seen, others, here: '/manage', main, cls: 'teamspage', refresh: refresh && refreshDue(club, now) ? '/manage' : null, updated});
}
