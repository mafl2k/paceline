// The team forms (spec §5.2), urlencoded POSTs behind the club gate (manage.mjs): make live, Back to
// vN (plan versions §8), delete and unpin a plan, and the team's add, rename, start time and delete;
// the old Undo form answers that its page was out of date. Each handler gets
// (req, res, ctx, cid, form) with the principal's club id and answers 303 to the page it came from
// with a flash (done, manage-page.mjs), a refusal on that page, or a page of its own.
import {html} from './http.mjs';
import {t} from './pages.mjs';
import {makeLive, backTo, deleteSheet, unpin, addTeam, renameTeam, setStart, setKind, deleteTeam} from './club.mjs';
import {effects, outdated, teamWeekday} from './select.mjs';
import {randomId} from './ids.mjs';
import {clubErrorText, field, teamOf, sheetOf, done, refuse, attempt, frameOf} from './manage-page.mjs';
import {backAsk, liveWords} from './team-view.mjs';
import {liveConfirmPage} from './team-page.mjs';
import {backConfirmPage} from './versions-page.mjs';
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


// POST /manage/live (team, sheet, confirm, back). Every Make live asks first (spec §9, decision
// 12): without confirm=1 the answer is the question (liveConfirmPage: what it does, the outdated
// marks), and nothing changes; only the version that is live already needs none. The flash names the
// moves and the holes the change makes on the sheet's date. Upload times stay. Back to the plan page
// with back=plan, else the team page; a refusal answers there too.
function live(req, res, ctx, cid, form) {
    const {store, now} = ctx;
    const slug = field(form, 'team');
    const id = field(form, 'sheet');
    const before = store.get(cid);
    const sheet = sheetOf(before, slug, id);
    const toPlan = field(form, 'back') === 'plan' && sheet !== null;
    if (sheet && field(form, 'confirm') !== '1' && before.teams[slug].live !== id) {
        const marks = outdated(before, slug, now).get(id) ?? [];
        html(res, 200, liveConfirmPage(before, slug, id, {...frameOf(ctx, cid), words: liveWords(before, slug, id, now), marks, back: toPlan ? 'plan' : null}));
        return;
    }
    const place = toPlan ? {page: 'versions', slug, plan: sheet.plan} : {page: 'team', slug};
    if (!attempt(res, ctx, cid, c => makeLive(c, slug, id, now), {place})) {
        return;
    }
    const after = store.get(cid);
    done(res, ctx, cid, place, effectsText(before, after, sheet.date, now, t('live-done', {label: sheet.label, team: after.teams[slug].name})));
}


// POST /manage/plan/back (team, plan, n, version, confirm, back): Back to vN (plan versions §8).
// `version` is the team's version the page was drawn with. Without confirm=1, Back of a live plan is
// asked about first, always (backAsk: what riders get, the moves and holes; the no-script path of the
// pages' in-page confirms); Back of another plan only stores a version and asks nothing. A POST that
// backTo refuses (a stale version, an n that is not stored, a used-up plan) is refused at once. The
// flash names the new version, the version that was live, the version the cap dropped, and what it
// changes. Back to the versions page with back=versions, else the team page; a refusal answers
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
        const words = backAsk(before, slug, {plan, n, version}, now);
        if (words !== null) {
            html(res, 200, backConfirmPage(before, slug, {...frameOf(ctx, cid), plan, n, version, words, back: toVersions ? 'versions' : null}));
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
        effectsText(before, after, sheet.date, now, head));
}


// POST /manage/undo (team, version), from a page drawn before Undo went (Ruling 9): nothing
// changes; 303 to the team page (or the teams, for a team that is gone) with the out-of-date flash.
function outOfDate(req, res, ctx, cid, form) {
    const slug = field(form, 'team');
    const place = teamOf(ctx.store.get(cid), slug) ? {page: 'team', slug} : {page: 'teams'};
    done(res, ctx, cid, place, t('out-of-date'), 'err');
}


// POST /manage/sheet/delete and /manage/sheet/unpin (team, sheet; unpin also back). Both go back
// to the team page; an unpin with back=team-settings to the team's settings, with back=plan to the
// plan page (any other back is the team page).
function sheetAction(change, doneKey, {unpinning = false} = {}) {
    return (req, res, ctx, cid, form) => {
        const slug = field(form, 'team');
        const id = field(form, 'sheet');
        const sheet = sheetOf(ctx.store.get(cid), slug, id);
        const to = unpinning ? field(form, 'back') : '';
        const place = to === 'team-settings' ? {page: 'team-settings', slug}
            : to === 'plan' && sheet ? {page: 'versions', slug, plan: sheet.plan} : {page: 'team', slug};
        if (attempt(res, ctx, cid, c => change(c, slug, id, ctx.now), {place})) {
            done(res, ctx, cid, place, t(doneKey, {label: sheet.label}));
        }
    };
}


// The posted weekday: a blank one is the club's (null), anything but 1-7 NaN (bad-weekday).
function postedWeekday(form) {
    const typed = field(form, 'weekday');
    return typed === '' ? null : /^[1-7]$/.test(typed) ? Number(typed) : NaN;
}


// POST /manage/team (action = add | rename | start | kind | delete, team, name, start, kind, weekday).
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
    } else if (action === 'delete') {
        if (!team) {
            refuse(res, ctx, cid, t('club-not-found'));
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
    '/manage/plan/back': back,
    '/manage/undo': outOfDate,
    '/manage/sheet/delete': sheetAction(deleteSheet, 'sheet-deleted'),
    '/manage/sheet/unpin': sheetAction(unpin, 'sheet-unpinned', {unpinning: true}),
    '/manage/team': teamAction,
};
