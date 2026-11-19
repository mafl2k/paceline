// The club settings /manage/settings (spec §5.2 "Club section", §5.4): the club's name, zone and
// the race day of its weekly teams, who gets the plans (open, or private with the rider code),
// sign-in (the masked address with Change e-mail, a new club link), Remove a rider; then the
// "Records" band: the recordings per rider file with the quota, grouped by team and the session's
// local day, the activity (the newest entries, the rest folded), and Delete club. The page never
// reloads itself. A new rider code asks first in the page only (decision 13). Also the rider code
// page, the answer of /manage/code that shows the code once. Pure: it
// reads the club and the recordings it is given, and the clock is passed in. Every value goes
// through esc().
import {esc, t, maskAddress, retentionText} from './pages.mjs';
import {captainPage, th, flashBlock, hidden, postForm, sevLine, backBar, footer} from './ui.mjs';
import {ic} from './icons.mjs';
import {atLabel, nameOf} from './team-view.mjs';
import {isPrivate} from './club.mjs';
import {teamWeekday} from './select.mjs';
import {formatRiderCode} from './ids.mjs';
import {localDay, localHHMM} from './time.mjs';
import {zoneSelect} from './web.mjs';
import {decodeEntities} from '../pages/src/engine/plan.mjs';

const MB = 1024 * 1024;
// The activity shows this many entries, newest first; the rest are folded.
const LOG_SHOWN = 6;
// The log entries with words of their own (T['log-' + what]); any other shows its raw `what`.
const LOG_WORDS = new Set([
    'upload', 'live', 'delete', 'unpin', 'undo', 'back', 'discard', 'team-add', 'team-rename', 'team-start', 'team-kind', 'team-delete',
    'club-rename', 'club-tz', 'club-weekday',
    'rider-remove', 'code-on', 'code-new', 'code-off', 'link-opened', 'admin-link', 'address-changed', 'club-restored', 'club-deleted',
]);
const SETTINGS_PATH = '/manage/settings';


function clubCard(club, cfg, typed) {
    const day = teamWeekday(club, null);
    const days = [1, 2, 3, 4, 5, 6, 7].map(n => `<option value="${n}"${n === day ? ' selected' : ''}>${esc(t(`weekday-${n}`))}</option>`);
    return `<section class="card" aria-labelledby="club-h">
    <h2 id="club-h">${esc(t('manage-club-heading'))}</h2>
    <form class="stack" method="post" action="/manage/club">
      <label class="field">${esc(t('name-label'))}<input name="name" value="${esc(typed?.name ?? club.name)}" maxlength="60" required autocomplete="off"></label>
      <label class="field">${esc(t('register-tz-label'))} <span class="hint">${esc(t('cs-tz-hint'))}</span>
        ${zoneSelect(cfg, club.tz, club.tz)}</label>
      <label class="field">${esc(t('cs-weekday'))}
        <select name="weekday">${days.join('')}</select></label>
      <button class="btn secondary" type="submit">${esc(t('manage-club-save'))}</button>
    </form>
  </section>`;
}


// Open or private, and what the captain can do about it. Without CODE_SECRET no code can be made,
// but a club still private can be made open (F11).
function whoCard(club, cfg, now) {
    const priv = isPrivate(club);
    const off = postForm('/manage/code', {action: 'off'}, t('private-off'), {cls: 'btn secondary', icon: 'users'});
    const out = [priv ? sevLine('neutral', 'lock', t('private-private')) : sevLine('neutral', 'users', t('private-open'))];
    if (!cfg.codeSecret) {
        out.push(`<p class="hint">${esc(t('private-disabled'))}</p>`);
        if (priv) {
            out.push(`<div class="btnrow">${off}</div>`);
        }
    } else if (priv) {
        const at = Date.parse(club.riderCode.setAt);
        if (Number.isFinite(at)) {
            out.push(`<p class="hint">${esc(t('cs-code-made', {at: atLabel(at, now, club.tz)}))}</p>`);
        }
        out.push(`<div class="btnrow">
      <details class="confirm">
        <summary class="btn secondary">${esc(t('cs-new-code'))}</summary>
        <div class="confirm-body"><p>${esc(t('code-confirm'))}</p>
        ${postForm('/manage/code', {action: 'new', confirm: '1', setAt: club.riderCode.setAt}, t('private-new'), {cls: 'btn secondary'})}</div>
      </details>
      ${off}
    </div>`);
    } else {
        out.push(postForm('/manage/code', {action: 'on'}, t('private-on'), {cls: 'btn secondary', icon: 'lock'}));
    }
    return `<section class="card" aria-labelledby="who-h">
    <h2 id="who-h">${esc(t('cs-who'))}</h2>
    ${out.join('\n    ')}
  </section>`;
}


function signInCard(club) {
    const masked = `<strong>${esc(maskAddress(club.email))}</strong>`;
    return `<section class="card" aria-labelledby="sign-h">
    <h2 id="sign-h">${esc(t('cs-sign-in'))}</h2>
    <p class="value">${ic('mail')}<span>${th('cs-email', {masked})}</span></p>
    <form class="inline-form" method="post" action="/manage/email">
      <label class="field">${esc(t('manage-email-label'))}<input type="email" name="email" maxlength="254" required autocomplete="email" placeholder="name@example.org"></label>
      <button class="btn secondary" type="submit">${esc(t('manage-email-button'))}</button>
    </form>
    <p class="hint">${esc(t('cs-email-hint'))}</p>
    ${postForm('/manage/newlink', {}, t('manage-newlink'), {cls: 'btn secondary block', icon: 'link'})}
    <p class="hint">${esc(t('cs-newlink-hint'))}</p>
  </section>`;
}


function riderCard() {
    return `<section class="card" aria-labelledby="rm-h">
    <h2 id="rm-h">${esc(t('rider-heading'))}</h2>
    <form class="inline-form" method="post" action="/manage/rider/remove">
      <label class="field">${esc(t('rider-label'))}<input type="text" name="zwiftId" inputmode="numeric" pattern="[0-9]{1,12}" maxlength="12" required autocomplete="off"></label>
      <button class="btn secondary" type="submit">${esc(t('rider-button'))}</button>
    </form>
    <p class="hint">${esc(t('rider-hint'))}</p>
  </section>`;
}


// Zwift ID -> display name, from any of the club's plans.
function riderNames(club) {
    const names = new Map();
    for (const sheet of Object.values(club.sheets)) {
        for (const list of [sheet.json?.riders, sheet.json?.roster]) {
            for (const [aid, r] of Object.entries(list && typeof list === 'object' ? list : {})) {
                const name = decodeEntities(r?.name).trim();
                if (name && !names.has(aid)) {
                    names.set(aid, name);
                }
            }
        }
    }
    return names;
}


// The recordings (logs.list: newest session first) grouped by team and the session's local day,
// each group where its newest file is.
function recordingsCard(club, cfg, {files, bytes}) {
    const quota = t('rec-quota', {used: (bytes / MB).toFixed(1), quota: Math.round(cfg.logMaxCircle / MB)});
    const head = `<div class="card-head"><h3 id="rec-h">${esc(t('rec-heading'))}</h3><p class="count">${esc(quota)}</p></div>`;
    if (!files.length) {
        return `<section class="card" aria-labelledby="rec-h">
    ${head}
    <p class="hint">${esc(t('rec-none'))}</p>
  </section>`;
    }
    const names = riderNames(club);
    const groups = new Map();
    for (const f of files) {
        const day = localDay(f.session, club.tz);
        const key = `${f.slug}/${day}`;
        if (!groups.has(key)) {
            groups.set(key, {title: t('rec-group', {team: nameOf(club, f.slug), day}), day, files: []});
        }
        groups.get(key).files.push(f);
    }
    const row = (f, day) => {
        const rider = names.get(f.athlete) ?? f.athlete;
        const meta = t('rec-meta', {time: localHHMM(f.session, club.tz), kb: Math.ceil(f.size / 1024)});
        return `<li><div><p>${esc(rider)}</p><p class="meta">${esc(meta)}</p></div>
          <span class="rowbtns"><form method="post" action="/manage/logs/delete">${hidden({slug: f.slug, file: f.file})}<button class="btn secondary small" type="submit">`
            + `${ic('trash')}<span class="sr">${esc(t('rec-delete', {rider, day}))}</span></button></form></span></li>`;
    };
    const items = [...groups.values()].map(g => `<li class="recgroup"><p class="nm">${esc(g.title)}</p>
        <ul class="rows">${g.files.map(f => row(f, g.day)).join('\n        ')}</ul></li>`);
    return `<section class="card" aria-labelledby="rec-h">
    ${head}
    <ul class="recs">
      ${items.join('\n      ')}
    </ul>
    <p class="hint">${esc(retentionText('rec-hint', cfg.logRetentionDays))}</p>
  </section>`;
}


function logItem(club, e, now) {
    const at = Date.parse(e.at);
    const label = e.label ?? '';
    // setStart logs an empty label when the start time was cleared
    const cleared = e.what === 'team-start' && label === '';
    const words = cleared ? t('log-team-start-cleared') : LOG_WORDS.has(e.what) ? t(`log-${e.what}`, {label}) : String(e.what);
    const team = e.team ? th('log-team', {team: `<span class="team">${esc(nameOf(club, e.team))}</span>`}) : '';
    return `<li><time>${esc(Number.isFinite(at) ? atLabel(at, now, club.tz) : '')}</time><span>${team}${esc(words)}</span></li>`;
}


// The newest LOG_SHOWN entries, then the rest in a <details>.
function activityCard(club, now) {
    const head = `<h3 id="act-h">${esc(t('log-heading'))}</h3>`;
    if (!club.log.length) {
        return `<section class="card" aria-labelledby="act-h">
    ${head}
    <p class="hint">${esc(t('log-none'))}</p>
  </section>`;
    }
    const items = [...club.log].reverse().map(e => logItem(club, e, now));
    const rest = items.slice(LOG_SHOWN);
    const fold = rest.length === 0 ? '' : `
    <details class="all-log">
      <summary class="btn quiet">${esc(t('log-all'))}</summary>
      <ul class="log">
      ${rest.join('\n      ')}
      </ul>
    </details>`;
    return `<section class="card" aria-labelledby="act-h">
    ${head}
    <ul class="log">
      ${items.slice(0, LOG_SHOWN).join('\n      ')}
    </ul>${fold}
  </section>`;
}


function dangerZone(club, recordings) {
    const del = t('cs-delete', {club: club.name});
    const teams = Object.keys(club.teams).length;
    const plans = new Set(Object.values(club.sheets).map(s => s.plan)).size;
    const files = recordings.files.length;
    const body = t('cs-delete-body', {
        teams: teams === 1 ? t('cs-delete-teams-one') : t('cs-delete-teams', {n: teams}),
        plans: plans === 1 ? t('cs-delete-plans-one') : t('cs-delete-plans', {n: plans}),
        recordings: files === 1 ? t('cs-delete-recordings-one') : t('cs-delete-recordings', {n: files}),
        masked: maskAddress(club.email),
    });
    return `<section class="danger-zone" aria-labelledby="dz">
    <h2 id="dz">${ic('trash')}${esc(del)}</h2>
    <p>${esc(body)}</p>
    ${postForm('/manage/delete', {}, t('cs-delete-open'), {cls: 'btn danger', icon: 'trash'})}
  </section>`;
}


// The club settings. `recordings` is {files: logs.list(cid), bytes: logs.circleBytes(cid)}; `typed`
// ({name}, as posted) fills the club form again after a refused rename. `seen` and `others`:
// captainPage's; the footer at the end of the page shows on phones only (the sidebar has it from
// 1024 px), the club name above the title from 1024 px only (the back bar has it on phones).
export function settingsPage(club, {now, seen, others = [], cfg, recordings, flash = null, typed = null}) {
    const main = `<main class="page" id="main">
  <header class="pagehead"><p class="kicker desk">${esc(club.name)}</p><h1>${esc(t('tp-club-settings'))}</h1></header>
  ${flashBlock(flash)}
  ${clubCard(club, cfg, typed)}
  ${whoCard(club, cfg, now)}
  ${signInCard(club)}
  ${riderCard()}
  <h2 class="band">${esc(t('cs-records'))}</h2>
  ${recordingsCard(club, cfg, recordings)}
  ${activityCard(club, now)}
  ${dangerZone(club, recordings)}
  ${footer({club: club.name, others})}
</main>`;
    return captainPage(club, {now, seen, others, here: SETTINGS_PATH, bar: backBar('/manage', t('tp-nav'), club.name), main, cls: 'formpage clubpage'});
}


function backToSettings() {
    return `<a class="btn secondary" href="${SETTINGS_PATH}">${ic('left')}${esc(t('cs-back'))}</a>`;
}


// The new rider code, shown this once (spec §5.2). Only this answer holds it: it never goes into a
// URL, a log, a cookie or a later page. The copy button needs the script, so it ships hidden. The
// page never reloads itself. `now`, `seen`, `others`: captainPage's.
export function codePage(club, code, {now, seen, others}) {
    const formatted = formatRiderCode(code);
    const shown = th('code-shown', {club: esc(club.name), code: `<code>${esc(formatted)}</code>`});
    const main = `<main class="page" id="main">
  <header class="pagehead"><p class="kicker">${esc(club.name)}</p><h1>${esc(t('cs-code-heading'))}</h1></header>
  <div class="flash ok" role="status">${ic('checkCircle')}<p>${shown}</p></div>
  <section class="card stack">
    <button type="button" class="btn secondary" data-js data-copy="${esc(formatted)}" data-copied="${esc(t('cs-copied'))}" hidden>${esc(t('cs-copy'))}</button>
    ${backToSettings()}
  </section>
</main>`;
    return captainPage(club, {now, seen, others, here: SETTINGS_PATH, main, cls: 'formpage', needsScript: false});
}
