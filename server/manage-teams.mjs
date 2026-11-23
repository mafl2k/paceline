// The team forms (spec §5.2), urlencoded POSTs behind the club gate (manage.mjs): make live and its
// Undo, delete, unpin and rename a plan, a race's date, time and event link (races spec §4: the two
// ⋯ menus), and the team's add, rename, start time and delete; the old Undo form (/manage/undo) and
// the old Restore form (gone with the team cockpit, team cockpit spec §4.1) answer that their page
// was out of date. Each handler gets
// (req, res, ctx, cid, form) with the principal's club id and answers 303 to the page it came from
// with a flash (done, manage-page.mjs), a refusal on that page, or a page of its own.
import {html} from './http.mjs';
import {t} from './pages.mjs';
import {
    makeLive, deleteSheet, unpin, addTeam, renameTeam, setStart, setKind, setRhythm, deleteTeam, newPushLink, setRace, setRaceEvent, renamePlan, ClubError,
} from './club.mjs';
import {effects, teamWeekday, raceStartAt} from './select.mjs';
import {parseEventUrl} from './ids.mjs';
import {clubErrorText, field, teamOf, sheetOf, planOf, done, refuse, attempt, frameOf, placePath, teamPlace} from './manage-page.mjs';
import {liveQuestion, undoOffer, raceWithin, raceMoveWords, dateDay} from './team-view.mjs';
import {liveConfirmPage, teamDeleteWords, deletePlanWords} from './team-page.mjs';
import {confirmPage} from './ui.mjs';
import {raceOf} from './races.mjs';
import {localLabel} from './time.mjs';


// The flash text of a change on the date `date`: `head`, then the moves and the holes it makes.
function effectsText(before, after, date, now, head) {
    const {moves, holes} = effects(before, after, date, now);
    const name = s => (teamOf(after, s)?.name ?? s);
    const parts = [head];
    parts.push(...moves.map(m => t('result-move', {name: m.name, from: name(m.from), to: name(m.to)}) + '.'));
    if (holes.length) {
        parts.push(t('result-holes', {teams: [...new Set(holes.map(h => h.slug))].map(name).join(', ')}));
    }
    return parts.join(' ');
}


// POST /manage/live (team, sheet, version, confirm). `version` is the team's version the page
// was drawn with: a stale one is refused at once (409, the page drawn anew with the out-of-date
// flash, nothing changes); a POST without it (a page from before the check) is not
// checked. The Make live rule (UI panel wave 2, liveQuestion) is applied here, so the page's script
// and a browser without it agree, and a page drawn before the gate opened still asks: without
// confirm=1, a switch that must ask (the gate open for the plan replaced or the one becoming live, or
// a warning) answers with the question (liveConfirmPage: what it does, the outdated marks) and nothing
// changes; any other acts at once, and the page it goes back to offers Undo (team-page.mjs undoBlock).
// The flash names the moves and the holes the change makes on the sheet's date. Upload times stay.
// Back to the team page at the race's live pointer (?r=<date>: the version now live, and after a
// later switch by someone else the one live then; a `back` or `from` of a page from before the team
// cockpit is ignored); a refusal answers with the version picked (?v=).
function live(req, res, ctx, cid, form) {
    const {store, now} = ctx;
    const slug = field(form, 'team');
    const id = field(form, 'sheet');
    const version = form.get('version');
    const before = store.get(cid);
    const team = teamOf(before, slug);
    const sheet = sheetOf(before, slug, id);
    const stale = team !== null && version !== null && Number(version) !== team.version;
    if (sheet && !stale && field(form, 'confirm') !== '1') {
        const q = liveQuestion(before, slug, id, now);
        if (q.ask) {
            html(res, 200, liveConfirmPage(before, slug, id, {...frameOf(ctx, cid), words: q.words, marks: q.marks}));
            return;
        }
    }
    const place = teamPlace(slug, {v: id});
    const word = e => (e.code === 'changed' ? t('back-changed', {team: team.name}) : clubErrorText(e));
    if (!attempt(res, ctx, cid, c => makeLive(c, slug, id, now, {version}), {place, word})) {
        return;
    }
    const after = store.get(cid);
    done(res, ctx, cid, teamPlace(slug, {r: sheet.date}), effectsText(before, after, sheet.date, now, t('live-done', {label: sheet.label, n: sheet.n, team: after.teams[slug].name})), 'ok', {undo: true});
}


// POST /manage/live/undo (team, version, confirm): Undo of the last change of the team's live
// plan (UI panel wave 2): makes the version that was live before it live again, while Undo is
// offered (undoOffer: at most 10 minutes after the change, and nothing changed since). A stale
// `version` is refused as Make live's (409, nothing changes); an Undo no longer offered says so
// (409). Then the same rule as Make live: without confirm=1, an Undo that must ask answers with the
// question (its form posts this Undo again, with confirm=1); else it acts, says "Undone", and offers
// no Undo of its own. It goes on to the team page at that race's live pointer (?r=<date>; a refusal:
// the same, the version live now).
function undoLive(req, res, ctx, cid, form) {
    const {store, now} = ctx;
    const slug = field(form, 'team');
    const before = store.get(cid);
    const team = teamOf(before, slug);
    if (!team) {
        refuse(res, ctx, cid, t('club-not-found'));
        return;
    }
    // a refusal keeps picked the version live now in the race of the team's last change
    // (where the Undo was offered), as a stale Make live keeps its version
    const lb = team.liveBefore;
    const liveNow = lb && typeof lb.id === 'string' && Object.hasOwn(before.sheets, lb.id) ? raceOf(before, slug, before.sheets[lb.id].date)?.live ?? null : null;
    const place = teamPlace(slug, typeof liveNow === 'string' ? {r: before.sheets[lb.id].date} : {});
    if (Number(field(form, 'version')) !== team.version) {
        refuse(res, ctx, cid, t('back-changed', {team: team.name}), {status: 409, place});
        return;
    }
    const u = undoOffer(before, slug, now);
    if (u === null) {
        refuse(res, ctx, cid, t('undo-late'), {status: 409, place});
        return;
    }
    if (field(form, 'confirm') !== '1') {
        const q = liveQuestion(before, slug, u.id, now);
        if (q.ask) {
            html(res, 200, liveConfirmPage(before, slug, u.id, {...frameOf(ctx, cid), words: q.words, marks: q.marks, undo: {version: team.version}}));
            return;
        }
    }
    const to = teamPlace(slug, {r: u.prev.date});
    const word = e => (e.code === 'changed' ? t('back-changed', {team: team.name}) : clubErrorText(e));
    if (!attempt(res, ctx, cid, c => makeLive(c, slug, u.id, now, {version: team.version, undo: false}), {place: to, word})) {
        return;
    }
    const after = store.get(cid);
    done(res, ctx, cid, to, effectsText(before, after, u.prev.date, now, t('undo-done', {n: u.prev.n, label: u.prev.label, team: after.teams[slug].name})));
}


// POST /manage/undo (team, version), from a page drawn before Undo went (Ruling 9), and Restore's
// POST (team, plan, n, version, confirm) from a page drawn before Restore went (team cockpit spec
// §4.1): nothing changes; 303 to the team page (or the teams, for a team that is gone)
// with the out-of-date flash.
function outOfDate(req, res, ctx, cid, form) {
    const slug = field(form, 'team');
    const place = teamOf(ctx.store.get(cid), slug) ? teamPlace(slug) : {page: 'teams'};
    done(res, ctx, cid, place, t('out-of-date'), 'err');
}


// POST /manage/sheet/unpin (team, sheet, back): back to the team page; with back=team-settings to
// the team's settings, with back=hub to the club hub (any other back, a plan page's from before the
// team cockpit too, is the team page).
function unpinAction(req, res, ctx, cid, form) {
    const slug = field(form, 'team');
    const id = field(form, 'sheet');
    const sheet = sheetOf(ctx.store.get(cid), slug, id);
    const to = field(form, 'back');
    // `back` 'hub': the club hub's to-do list, which the captain works down
    const place = to === 'team-settings' ? {page: 'team-settings', slug} : to === 'hub' ? {page: 'teams'} : teamPlace(slug);
    if (attempt(res, ctx, cid, c => unpin(c, slug, id, ctx.now), {place})) {
        done(res, ctx, cid, place, t('sheet-unpinned', {label: sheet.label}));
    }
}


// POST /manage/sheet/delete (team, sheet, version, confirm): Delete plan, back to the team page.
// `version` is the team's version the page was drawn with: a stale one is refused at once (S7, as
// Make live: 409, nothing changes; a POST without it, a page from before the check, is not checked).
// Without confirm=1 (the no-script path of the in-page confirm, UI panel wave 2) the answer is the
// question, drawn now, and nothing changes; its way back is the team page, and so is the answer.
function deleteAction(req, res, ctx, cid, form) {
    const {store, now} = ctx;
    const slug = field(form, 'team');
    const id = field(form, 'sheet');
    const version = form.get('version');
    const club = store.get(cid);
    const team = teamOf(club, slug);
    const sheet = sheetOf(club, slug, id);
    const place = teamPlace(slug);
    const stale = team !== null && version !== null && Number(version) !== team.version;
    if (sheet && !stale && field(form, 'confirm') !== '1') {
        html(res, 200, confirmPage(club, {...frameOf(ctx, cid), here: placePath(place), kicker: t('ui-club-team', {club: club.name, team: team.name}),
            trail: [{href: placePath(place), label: team.name}],
            heading: t('ask-delete-plan', {label: sheet.label}), words: deletePlanWords(club, slug, id, now), action: '/manage/sheet/delete',
            fields: {team: slug, sheet: id, version: team.version}, button: t('tp-delete-button', {label: sheet.label}),
            back: {href: placePath(place), label: t('live-confirm-back', {team: team.name})}}));
        return;
    }
    const word = e => (e.code === 'changed' ? t('back-changed', {team: team.name}) : clubErrorText(e));
    if (attempt(res, ctx, cid, c => deleteSheet(c, slug, id, now, {version}), {place, word})) {
        done(res, ctx, cid, place, t('sheet-deleted', {label: sheet.label}));
    }
}


// POST /manage/race (team, date, version, action, to, start, event, confirm): the race ⋯ (races spec
// §4 "Race ⋯", §7) of team `team`'s race on `date`. `version` is the team's version the page was
// drawn with: a stale one is refused at once (409, nothing changes; checked before the race, so a
// race another captain moved since says so), and so is a race that no longer exists (400) or is over
// (club.mjs checks again in the change). Every answer is on the
// team page; a change lands on the race (#race-<date>, its new date after a move).
// - when (`to`, `start` as setRace takes them): a dry run first, so a refusal (another race on `to`,
//   a bad time, a race over at its new time) is said at once and nothing is asked. A date or time
//   change asks first (spec §7: it moves what riders get): without confirm=1 the question
//   (raceMoveWords), with it the move, its flash the new start and the moves and holes on the new
//   date. A POST that changes neither date nor time asks nothing and says Saved.
// - event (`event`): a Zwift or ZwiftPower event link (parseEventUrl, checked before setRaceEvent,
//   which takes event ids only); blank is refused (unlink removes a link).
// - unlink: removes the race's event link.
function raceAction(req, res, ctx, cid, form) {
    const {store, now} = ctx;
    const slug = field(form, 'team');
    const date = field(form, 'date');
    const version = form.get('version');
    const action = field(form, 'action');
    const before = store.get(cid);
    const team = teamOf(before, slug);
    const place = teamPlace(slug);
    // as setRace checks: the team, the page's version (a page drawn before another captain moved the
    // race is stale, not "gone"), then the race
    if (team !== null && version !== null && Number(version) !== team.version) {
        refuse(res, ctx, cid, t('back-changed', {team: team.name}), {status: 409, place});
        return;
    }
    if (team === null || raceOf(before, slug, date) === null) {
        refuse(res, ctx, cid, t('club-not-found'), {place});
        return;
    }
    const word = e => (e.code === 'changed' ? t('back-changed', {team: team.name}) : clubErrorText(e));
    const anchor = d => ({anchor: `race-${d}`});
    if (action === 'when') {
        const to = field(form, 'to').trim();
        const start = field(form, 'start').trim();
        const move = c => setRace(c, slug, date, {to, start}, now, {version});
        let dry;
        try {
            dry = store.dryRun(cid, move);
        } catch (e) {
            if (!(e instanceof ClubError)) {
                throw e;
            }
            refuse(res, ctx, cid, word(e), {status: e.code === 'changed' ? 409 : 400, place});
            return;
        }
        // setRace bumps the team's version only when the date or the time changes
        const changes = dry.club.teams[slug].version !== team.version;
        if (changes && field(form, 'confirm') !== '1') {
            html(res, 200, confirmPage(before, {...frameOf(ctx, cid), here: placePath(place), kicker: t('ui-club-team', {club: before.name, team: team.name}),
                trail: [{href: placePath(place), label: team.name}], heading: t('ask-race-move'), words: raceMoveWords(before, slug, date, {to, start}, now),
                action: '/manage/race', fields: {team: slug, date, version: team.version, action: 'when', to, start}, button: t('rm-when-yes'), danger: false,
                back: {href: placePath(place), label: t('live-confirm-back', {team: team.name})}}));
            return;
        }
        const got = attempt(res, ctx, cid, move, {place, word});
        if (!got) {
            return;
        }
        const to2 = got.result.date;
        if (!changes) {
            done(res, ctx, cid, place, t('club-saved'), 'ok', anchor(to2));
            return;
        }
        const after = store.get(cid);
        const S = raceStartAt(after, slug, to2);
        const when = S === null ? dateDay(to2, after.tz) : localLabel(S, after.tz);
        done(res, ctx, cid, place, effectsText(before, after, to2, now, t('race-moved', {when})), 'ok', anchor(to2));
    } else if (action === 'event' || action === 'unlink') {
        let id = null;
        if (action === 'event') {
            const link = parseEventUrl(field(form, 'event'));
            if (!link.ok || link.id === null) {
                refuse(res, ctx, cid, t(link.ok ? 'rm-event-empty' : 'upload-bad-event'), {place});
                return;
            }
            id = link.id;
        }
        if (attempt(res, ctx, cid, c => setRaceEvent(c, slug, date, id, now, {version}), {place, word})) {
            const day = dateDay(date, before.tz);
            done(res, ctx, cid, place, id === null ? t('race-unlinked', {day}) : t('race-link-set', {id, day}), 'ok', anchor(date));
        }
    } else {
        refuse(res, ctx, cid, t('manage-bad-form'), {place});
    }
}


// POST /manage/plan/rename (team, plan, type, version): Rename in the plan ⋯ (races spec §4
// "Plan ⋯", §7): plan `plan` (any of its ids) gets type `type` on every version (renamePlan: unique
// in its race; blank is none). `version` as for Make live: a page drawn before another change, a plan
// gone or a race over is refused, nothing changes. Back to the team page at the plan's block; a
// refusal answers there too (409 for a stale page).
function renameAction(req, res, ctx, cid, form) {
    const {store, now} = ctx;
    const slug = field(form, 'team');
    const plan = field(form, 'plan');
    const before = store.get(cid);
    const team = teamOf(before, slug);
    const p = planOf(before, slug, plan);
    const place = teamPlace(slug);
    const word = e => (e.code === 'changed' ? t('back-changed', {team: team.name}) : clubErrorText(e));
    const got = attempt(res, ctx, cid, c => renamePlan(c, slug, plan, field(form, 'type'), now, {version: form.get('version')}), {place, word});
    if (got) {
        done(res, ctx, cid, place, t('plan-renamed', {label: got.result.label}), 'ok', {anchor: `plan-${p.id}`});
    }
}


// The question a team settings form gets without confirm=1 (UI panel wave 2): `heading`, `words`,
// the form's own `fields` again with `button`, and the way back to the team's settings.
function teamAsk(res, ctx, cid, slug, {heading, words, fields, button, danger = true}) {
    const club = ctx.store.get(cid);
    const team = club.teams[slug];
    const settings = {page: 'team-settings', slug};
    html(res, 200, confirmPage(club, {...frameOf(ctx, cid), here: placePath({page: 'team', slug}), kicker: t('ui-club-team', {club: club.name, team: team.name}),
        trail: [{href: placePath({page: 'team', slug}), label: team.name}, {href: placePath(settings), label: t('tp-settings')}],
        heading, words, action: '/manage/team', fields: {...fields, team: slug}, button, danger,
        back: {href: placePath(settings), label: t('live-confirm-back', {team: t('tp-settings')})}}));
}


// The flash after a change of team `slug`'s race rhythm (after: the club changed; `was` its kind
// before; `changed` setRhythm's {rhythm, start}, null for the kind action): the rhythm, or the start
// time alone when only it changed, or both in one sentence naming the team once (user, 22 Nov 2026);
// then, when the kind changed and the team has plans, what the switch does to the start of its plans
// (the coordinator, 19 Nov 2026); a race with its own time keeps it (races Task 2 ruling), so with
// one only the others move.
function rhythmFlash(after, slug, was, changed = null) {
    const {name, kind, start: own} = after.teams[slug];
    const day = t(`weekday-${teamWeekday(after, slug)}`);
    const rhythm = kind === 'special' ? t('ts-special') : t('ts-weekly', {weekday: day});
    const said = changed?.start !== true ? t('team-kind-set', {team: name, rhythm})
        : !changed.rhythm ? (own === null ? t('team-start-cleared', {team: name}) : t('team-start-set', {team: name, start: own}))
        : own === null ? t('team-rhythm-no-start', {team: name, weekday: day}) : t('team-rhythm-start', {team: name, weekday: day, start: own});
    const plans = Object.values(after.sheets).some(sh => sh.team === slug);
    const ownTime = Object.values(after.teams[slug].races ?? {}).some(r => r.start != null);
    const what = !plans || kind === was ? null : kind === 'special' ? t('team-kind-special-keep')
        : own != null ? t(ownTime ? 'team-kind-weekly-start-others' : 'team-kind-weekly-start', {start: own})
        : t(ownTime ? 'team-kind-weekly-none-others' : 'team-kind-weekly-none');
    return [said, what].filter(Boolean).join(' ');
}


// The posted weekday: a blank or missing one is `blank`, anything but 1-7 NaN (bad-weekday).
function postedWeekday(form, blank) {
    const typed = field(form, 'weekday');
    return typed === '' ? blank : /^[1-7]$/.test(typed) ? Number(typed) : NaN;
}


// POST /manage/team (action = add | rename | rhythm | start | kind | push-link | delete, team, name,
// start, kind, weekday, confirm). Clearing the start time while a plan of the team races within 7
// days, New ZwiftGopher link and delete ask first without confirm=1 (S11, UI panel wave 2: the
// question as a page of its own, the no-script path of the in-page confirm), and nothing changes.
// A blank start clears the start time (F8). Add takes the race rhythm too (user, 19 Nov 2026):
// without `kind` (a page from before) it is weekly, a blank or missing weekday is Thursday, and a
// special team ignores the start; for rhythm and kind a blank or missing weekday is the team's own
// day (teamWeekday). Rhythm is the team settings' race day and time (user, 22 Nov 2026): kind,
// weekday and, for a weekly team, the start time in one change (setRhythm; special ignores the
// start); it asks first (S11) only when it empties a weekly team's start time. Start and kind are
// the two forms before it, still taken from a page open from before. Add goes to the new team's
// page, rename, rhythm, start and kind to the team's settings,
// delete to the teams; a refusal shows the new-team page or the settings with what was typed. A
// deleted team's slug is retired in the club change's transaction, so it is never used again (a
// failed change retires nothing). Retired slugs are kept for good, so a club deletes at most
// TEAM_DELETES_PER_DAY teams a day (429 on the team's settings beyond, nothing retired).
function teamAction(req, res, ctx, cid, form) {
    const {store, now} = ctx;
    const action = field(form, 'action');
    const slug = field(form, 'team');
    const name = field(form, 'name');
    const typedStart = field(form, 'start');
    const start = typedStart.trim() || null;
    const team = teamOf(store.get(cid), slug);
    const settings = {page: 'team-settings', slug};
    if (action === 'add') {
        const kind = field(form, 'kind') || 'weekly';
        const weekday = postedWeekday(form, 4);
        const added = attempt(res, ctx, cid, c => addTeam(c, {name, start, kind, weekday}, {slugTaken: s => store.slugTaken(s), now}),
            {place: {page: 'new-team'}, typed: {name, start: typedStart, kind, weekday: field(form, 'weekday')}});
        if (added) {
            done(res, ctx, cid, teamPlace(added.result), t('team-added', {team: store.get(cid).teams[added.result].name}));
        }
    } else if (action === 'rename') {
        if (attempt(res, ctx, cid, c => renameTeam(c, slug, name, now), {place: settings, typed: {name}})) {
            done(res, ctx, cid, settings, t('team-renamed', {team: store.get(cid).teams[slug].name}));
        }
    } else if (action === 'rhythm') {
        const kind = field(form, 'kind');
        const weekday = postedWeekday(form, teamWeekday(store.get(cid), slug));
        const typed = {kind, weekday: field(form, 'weekday'), start: typedStart};
        if (team && kind === 'weekly' && start === null && team.start != null && field(form, 'confirm') !== '1' && raceWithin(store.get(cid), slug, now)) {
            teamAsk(res, ctx, cid, slug, {heading: t('ask-start-clear', {team: team.name}), words: t('ts-start-clear-confirm', {team: team.name}),
                fields: {action: 'rhythm', ...typed, start: ''}, button: t('ts-start-clear-yes')});
            return;
        }
        const was = team?.kind === 'special' ? 'special' : 'weekly';
        const set = attempt(res, ctx, cid, c => setRhythm(c, slug, {kind, weekday, start}, now), {place: settings, typed});
        if (set) {
            done(res, ctx, cid, settings, rhythmFlash(store.get(cid), slug, was, set.result));
        }
    } else if (action === 'start') {
        if (team && start === null && field(form, 'confirm') !== '1' && raceWithin(store.get(cid), slug, now)) {
            teamAsk(res, ctx, cid, slug, {heading: t('ask-start-clear', {team: team.name}), words: t('ts-start-clear-confirm', {team: team.name}),
                fields: {action: 'start', start: ''}, button: t('ts-start-clear-yes')});
            return;
        }
        if (attempt(res, ctx, cid, c => setStart(c, slug, start, now), {place: settings, typed: {start: typedStart}})) {
            const {name: team} = store.get(cid).teams[slug];
            done(res, ctx, cid, settings, start === null ? t('team-start-cleared', {team}) : t('team-start-set', {team, start}));
        }
    } else if (action === 'kind') {
        const weekday = postedWeekday(form, teamWeekday(store.get(cid), slug));
        const was = team?.kind === 'special' ? 'special' : 'weekly';
        if (attempt(res, ctx, cid, c => setKind(c, slug, {kind: field(form, 'kind'), weekday}, now), {place: settings})) {
            done(res, ctx, cid, settings, rhythmFlash(store.get(cid), slug, was));
        }
    } else if (action === 'push-link') {
        // "New ZwiftGopher link": every link of the team handed out so far stops working
        if (team && field(form, 'confirm') !== '1') {
            teamAsk(res, ctx, cid, slug, {heading: t('ask-push', {team: team.name}), words: t('ts-push-confirm', {team: team.name}),
                fields: {action: 'push-link'}, button: t('ts-push-yes')});
            return;
        }
        if (attempt(res, ctx, cid, c => newPushLink(c, slug, now), {place: settings})) {
            done(res, ctx, cid, settings, t('team-push-new', {team: store.get(cid).teams[slug].name}));
        }
    } else if (action === 'delete') {
        if (!team) {
            refuse(res, ctx, cid, t('club-not-found'));
            return;
        }
        if (field(form, 'confirm') !== '1') {
            teamAsk(res, ctx, cid, slug, {heading: t('ask-delete-team', {team: team.name}), words: teamDeleteWords(store.get(cid), slug),
                fields: {action: 'delete'}, button: t('team-delete-button', {team: team.name})});
            return;
        }
        if (!ctx.web.teamDeletes.allow(cid, now)) {
            refuse(res, ctx, cid, t('team-delete-limit'), {status: 429, place: settings});
            return;
        }
        if (attempt(res, ctx, cid, c => deleteTeam(c, slug, now), {also: () => store.retireSlugs([slug])})) {
            done(res, ctx, cid, {page: 'teams'}, t('team-deleted', {team: team.name}));
        }
    } else {
        refuse(res, ctx, cid, t('manage-bad-form'));
    }
}


// path -> handler
export const TEAM_FORMS = {
    '/manage/live': live,
    '/manage/live/undo': undoLive,
    '/manage/plan/back': outOfDate,
    '/manage/plan/rename': renameAction,
    '/manage/race': raceAction,
    '/manage/undo': outOfDate,
    '/manage/sheet/delete': deleteAction,
    '/manage/sheet/unpin': unpinAction,
    '/manage/team': teamAction,
};
