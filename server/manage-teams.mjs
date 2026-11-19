// The team forms (spec §5.2), urlencoded POSTs behind the club gate (manage.mjs): make live and its
// Undo, Restore vN (plan versions §8), delete and unpin a plan, and the team's add, rename, start time
// and delete; the old Undo form (/manage/undo) answers that its page was out of date. Each handler gets
// (req, res, ctx, cid, form) with the principal's club id and answers 303 to the page it came from
// with a flash (done, manage-page.mjs), a refusal on that page, or a page of its own.
import {html} from './http.mjs';
import {t} from './pages.mjs';
import {makeLive, backTo, deleteSheet, unpin, addTeam, renameTeam, setStart, setKind, deleteTeam, newPushLink} from './club.mjs';
import {effects, teamWeekday} from './select.mjs';
import {randomId} from './ids.mjs';
import {clubErrorText, field, teamOf, sheetOf, planOf, done, refuse, attempt, frameOf, placePath} from './manage-page.mjs';
import {backQuestion, liveQuestion, undoOffer, raceWithin} from './team-view.mjs';
import {liveConfirmPage, teamDeleteWords} from './team-page.mjs';
import {backConfirmPage, deletePlanWords} from './versions-page.mjs';
import {confirmPage} from './ui.mjs';
import {droppedLine} from './upload-page.mjs';


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


// POST /manage/live (team, sheet, version, confirm, back). `version` is the team's version the page
// was drawn with: a stale one is refused at once (409, the page drawn anew with the out-of-date
// flash, nothing changes), as Restore is; a POST without it (a page from before the check) is not
// checked. The Make live rule (UI panel wave 2, liveQuestion) is applied here, so the page's script
// and a browser without it agree, and a page drawn before the gate opened still asks: without
// confirm=1, a switch that must ask (the gate open for the plan replaced or the one becoming live, or
// a warning) answers with the question (liveConfirmPage: what it does, the outdated marks) and nothing
// changes; any other acts at once, and the page it goes back to offers Undo (team-page.mjs undoBlock).
// The flash names the moves and the holes the change makes on the sheet's date. Upload times stay.
// Back to the plan page with back=plan, else the team page; a refusal answers there too.
function live(req, res, ctx, cid, form) {
    const {store, now} = ctx;
    const slug = field(form, 'team');
    const id = field(form, 'sheet');
    const version = form.get('version');
    const before = store.get(cid);
    const team = teamOf(before, slug);
    const sheet = sheetOf(before, slug, id);
    const toPlan = field(form, 'back') === 'plan' && sheet !== null;
    const stale = team !== null && version !== null && Number(version) !== team.version;
    if (sheet && !stale && field(form, 'confirm') !== '1') {
        const q = liveQuestion(before, slug, id, now);
        if (q.ask) {
            html(res, 200, liveConfirmPage(before, slug, id, {...frameOf(ctx, cid), words: q.words, marks: q.marks, back: toPlan ? 'plan' : null}));
            return;
        }
    }
    const place = toPlan ? {page: 'versions', slug, plan: sheet.plan} : {page: 'team', slug};
    const word = e => (e.code === 'changed' ? t('back-changed', {team: team.name}) : clubErrorText(e));
    if (!attempt(res, ctx, cid, c => makeLive(c, slug, id, now, {version}), {place, word})) {
        return;
    }
    const after = store.get(cid);
    done(res, ctx, cid, place, effectsText(before, after, sheet.date, now, t('live-done', {label: sheet.label, team: after.teams[slug].name})), 'ok', {undo: true, row: sheet.plan});
}


// POST /manage/live/undo (team, version, confirm, back): Undo of the last change of the team's live
// plan (UI panel wave 2): makes the version that was live before it live again, while Undo is
// offered (undoOffer: at most 10 minutes after the change, and nothing changed since). A stale
// `version` is refused as Make live's (409, nothing changes); an Undo no longer offered says so
// (409). Then the same rule as Make live: without confirm=1, an Undo that must ask answers with the
// question (its form posts this Undo again, with confirm=1); else it acts, says "Undone", and offers
// no Undo of its own. With back=plan it goes on to the plan page of the version made live, and a
// refusal answers on the plan page it came from (`plan`, while that plan exists); else the team page.
function undoLive(req, res, ctx, cid, form) {
    const {store, now} = ctx;
    const slug = field(form, 'team');
    const before = store.get(cid);
    const team = teamOf(before, slug);
    if (!team) {
        refuse(res, ctx, cid, t('club-not-found'));
        return;
    }
    const from = field(form, 'plan');
    const toPlan = field(form, 'back') === 'plan';
    const place = toPlan && planOf(before, slug, from) ? {page: 'versions', slug, plan: from} : {page: 'team', slug};
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
            html(res, 200, liveConfirmPage(before, slug, u.id, {...frameOf(ctx, cid), words: q.words, marks: q.marks, back: toPlan ? 'plan' : null,
                undo: {version: team.version, plan: toPlan && from ? from : null}}));
            return;
        }
    }
    const to = toPlan ? {page: 'versions', slug, plan: u.prev.plan} : {page: 'team', slug};
    const word = e => (e.code === 'changed' ? t('back-changed', {team: team.name}) : clubErrorText(e));
    if (!attempt(res, ctx, cid, c => makeLive(c, slug, u.id, now, {version: team.version, undo: false}), {place: to, word})) {
        return;
    }
    const after = store.get(cid);
    done(res, ctx, cid, to, effectsText(before, after, u.prev.date, now, t('undo-done', {n: u.prev.n, label: u.prev.label, team: after.teams[slug].name})), 'ok',
        {row: u.prev.plan});
}


// POST /manage/plan/back (team, plan, n, version, confirm, back): Restore vN (plan versions §8).
// `version` is the team's version the page was drawn with. Without confirm=1, Restore of a live plan
// asks first only as the Make live rule says (backQuestion: the gate open, moves, holes, no start
// time; the no-script path of the pages' in-page confirms); otherwise it acts at once and the page it
// goes back to offers Undo. Restore of another plan only stores a version and asks nothing. A POST
// that backTo refuses (a stale version, an n that is not stored, a used-up plan) is refused at once.
// The flash names the new version, the version that was live, the version the cap dropped, and what
// it changes. Back to the versions page with back=versions, else the team page; a refusal answers
// there too.
function back(req, res, ctx, cid, form) {
    const {store, now} = ctx;
    const slug = field(form, 'team');
    const plan = field(form, 'plan');
    const n = field(form, 'n');
    const version = field(form, 'version');
    const toVersions = field(form, 'back') === 'versions';
    const before = store.get(cid);
    const team = teamOf(before, slug);
    if (team && field(form, 'confirm') !== '1') {
        const q = backQuestion(before, slug, {plan, n, version}, now);
        if (q !== null && q.ask) {
            html(res, 200, backConfirmPage(before, slug, {...frameOf(ctx, cid), plan, n, version, words: q.words, back: toVersions ? 'versions' : null}));
            return;
        }
    }
    const place = toVersions ? {page: 'versions', slug, plan} : {page: 'team', slug};
    const word = e => (e.code === 'changed' ? t('back-changed', {team: team.name}) : clubErrorText(e));
    const got = attempt(res, ctx, cid, c => backTo(c, slug, {plan, n, version}, {now, newId: () => randomId(6)}), {place, word});
    if (!got) {
        return;
    }
    const r = got.result;
    const after = store.get(cid);
    const sheet = after.sheets[r.id];
    const was = before.sheets[before.teams[slug].live]?.n;
    // the version the cap dropped to make room is named, as on the result page
    const head = [t(r.live ? 'back-done-live' : 'back-done', {n: r.from, label: sheet.label, k: r.n, was}), droppedLine(r)?.text].filter(Boolean).join(' ');
    done(res, ctx, cid, toVersions ? {page: 'versions', slug, plan: r.planId} : {page: 'team', slug},
        effectsText(before, after, sheet.date, now, head), 'ok', r.live ? {undo: true, row: r.planId} : {});
}


// POST /manage/undo (team, version), from a page drawn before Undo went (Ruling 9): nothing
// changes; 303 to the team page (or the teams, for a team that is gone) with the out-of-date flash.
function outOfDate(req, res, ctx, cid, form) {
    const slug = field(form, 'team');
    const place = teamOf(ctx.store.get(cid), slug) ? {page: 'team', slug} : {page: 'teams'};
    done(res, ctx, cid, place, t('out-of-date'), 'err');
}


// POST /manage/sheet/unpin (team, sheet, back): back to the team page; with back=team-settings to
// the team's settings, with back=plan to the plan page, with back=hub to the club hub (any other
// back is the team page).
function unpinAction(req, res, ctx, cid, form) {
    const slug = field(form, 'team');
    const id = field(form, 'sheet');
    const sheet = sheetOf(ctx.store.get(cid), slug, id);
    const to = field(form, 'back');
    // `back` 'hub': the club hub's to-do list, which the captain works down
    const place = to === 'team-settings' ? {page: 'team-settings', slug}
        : to === 'plan' && sheet ? {page: 'versions', slug, plan: sheet.plan} : to === 'hub' ? {page: 'teams'} : {page: 'team', slug};
    if (attempt(res, ctx, cid, c => unpin(c, slug, id, ctx.now), {place})) {
        done(res, ctx, cid, place, t('sheet-unpinned', {label: sheet.label}));
    }
}


// POST /manage/sheet/delete (team, sheet, version, confirm): Delete plan, back to the team page.
// `version` is the team's version the page was drawn with: a stale one is refused at once (S7, as
// Make live: 409, nothing changes; a POST without it, a page from before the check, is not checked).
// Without confirm=1 (the no-script path of the in-page confirm, UI panel wave 2) the answer is the
// question, drawn now, and nothing changes.
function deleteAction(req, res, ctx, cid, form) {
    const {store, now} = ctx;
    const slug = field(form, 'team');
    const id = field(form, 'sheet');
    const version = form.get('version');
    const club = store.get(cid);
    const team = teamOf(club, slug);
    const sheet = sheetOf(club, slug, id);
    const place = {page: 'team', slug};
    const stale = team !== null && version !== null && Number(version) !== team.version;
    if (sheet && !stale && field(form, 'confirm') !== '1') {
        html(res, 200, confirmPage(club, {...frameOf(ctx, cid), here: placePath(place), kicker: t('ui-club-team', {club: club.name, team: team.name}),
            trail: [{href: placePath(place), label: team.name}, {href: placePath({page: 'versions', slug, plan: sheet.plan}), label: sheet.label}],
            heading: t('ask-delete-plan', {label: sheet.label}), words: deletePlanWords(club, slug, id), action: '/manage/sheet/delete',
            fields: {team: slug, sheet: id, version: team.version}, button: t('tp-delete-button', {label: sheet.label}),
            back: {href: placePath({page: 'versions', slug, plan: sheet.plan}), label: t('live-confirm-back', {team: sheet.label})}}));
        return;
    }
    const word = e => (e.code === 'changed' ? t('back-changed', {team: team.name}) : clubErrorText(e));
    if (attempt(res, ctx, cid, c => deleteSheet(c, slug, id, now, {version}), {place, word})) {
        done(res, ctx, cid, place, t('sheet-deleted', {label: sheet.label}));
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


// The posted weekday: a blank one is the club's (null), anything but 1-7 NaN (bad-weekday).
function postedWeekday(form) {
    const typed = field(form, 'weekday');
    return typed === '' ? null : /^[1-7]$/.test(typed) ? Number(typed) : NaN;
}


// POST /manage/team (action = add | rename | start | kind | push-link | delete, team, name, start, kind,
// weekday, confirm). Clearing the start time while a plan of the team races within 7 days, New
// ZwiftGopher link and delete ask first without confirm=1 (S11, UI panel wave 2: the question as a
// page of its own, the no-script path of the in-page confirm), and nothing changes.
// A blank start clears the start time (F8); a blank weekday is the club's. Add takes the race rhythm
// too (user, 19 Nov 2026): without `kind` (a page from before) it is weekly on the club's day, and a
// special team ignores the start. Add goes to the new team's page, rename, start and kind to the
// team's settings, delete to the teams; a refusal shows the new-team page or the settings with what
// was typed. A deleted team's slug is retired in the club change's transaction, so it is never used
// again (a failed change retires nothing). Retired slugs are kept for good, so a club
// deletes at most TEAM_DELETES_PER_DAY teams a day (429 on the team's settings beyond, nothing
// retired).
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
        const weekday = postedWeekday(form);
        const added = attempt(res, ctx, cid, c => addTeam(c, {name, start, kind, weekday}, {slugTaken: s => store.slugTaken(s), now}),
            {place: {page: 'new-team'}, typed: {name, start: typedStart, kind, weekday: field(form, 'weekday')}});
        if (added) {
            done(res, ctx, cid, {page: 'team', slug: added.result}, t('team-added', {team: store.get(cid).teams[added.result].name}));
        }
    } else if (action === 'rename') {
        if (attempt(res, ctx, cid, c => renameTeam(c, slug, name, now), {place: settings, typed: {name}})) {
            done(res, ctx, cid, settings, t('team-renamed', {team: store.get(cid).teams[slug].name}));
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
        const weekday = postedWeekday(form);
        const was = team?.kind === 'special' ? 'special' : 'weekly';
        if (attempt(res, ctx, cid, c => setKind(c, slug, {kind: field(form, 'kind'), weekday}, now), {place: settings})) {
            const after = store.get(cid);
            const {name, kind, start: own} = after.teams[slug];
            const rhythm = kind === 'special' ? t('ts-special') : t('ts-weekly', {weekday: t(`weekday-${teamWeekday(after, slug)}`)});
            // what a switch does to the start of its plans (the coordinator, 19 Nov 2026)
            const plans = Object.values(after.sheets).some(sh => sh.team === slug);
            const what = !plans || kind === was ? null : kind === 'special' ? t('team-kind-special-keep')
                : own != null ? t('team-kind-weekly-start', {start: own}) : t('team-kind-weekly-none');
            done(res, ctx, cid, settings, [t('team-kind-set', {team: name, rhythm}), what].filter(Boolean).join(' '));
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
    '/manage/plan/back': back,
    '/manage/undo': outOfDate,
    '/manage/sheet/delete': deleteAction,
    '/manage/sheet/unpin': unpinAction,
    '/manage/team': teamAction,
};
