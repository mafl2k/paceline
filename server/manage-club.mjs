// The club settings' forms (spec §5.2), urlencoded POSTs behind the club gate (manage.mjs): the
// club's name and zone, rider removal, recording delete and the rider code. There is no recording
// download: only the operator opens the files (spec §7.7). Each form handler gets (req, res, ctx,
// cid, form) with the principal's club id and answers 303 to the club settings with a flash (done,
// manage-page.mjs), a refusal on the club settings, or a page of its own (settings-page.mjs).
import {html} from './http.mjs';
import {t} from './pages.mjs';
import {checkClubName, zoneOk, redirect} from './web.mjs';
import {codePage} from './settings-page.mjs';
import {removeRider, setRiderCode, clearRiderCode, isPrivate, addLog} from './club.mjs';
import {teamWeekday} from './select.mjs';
import {isSlug, newRiderCode, riderCodeHash, ZWIFT_RE} from './ids.mjs';
import {LOG_NAME_RE} from './logs.mjs';
import {field, placePath, done, refuse, attempt, frameOf} from './manage-page.mjs';

// A new rider code is drawn at most this often while its hash belongs to another club (50 bits:
// a second draw already never happens in practice).
const CODE_DRAWS = 5;

const iso = ms => new Date(ms).toISOString();

// where every form here goes back to, and where its refusals are drawn
const SETTINGS = {page: 'settings'};


// POST /manage/club (name, tz, weekday). All are checked before the store sees them (a zone the
// store refuses would be a 500): the name key is unique among active and trashed clubs other than
// this one, the zone one of the form's, the weekday (the race day of weekly teams) 1-7; a form
// without a weekday (a page from before it) keeps the club's. Each change is noted in the club log.
// A refusal keeps the name as typed.
function clubAction(req, res, ctx, cid, form) {
    const {store, cfg, now} = ctx;
    const club = store.get(cid);
    const name = checkClubName(store, field(form, 'name'), cid);
    const tz = field(form, 'tz');
    const typed = {name: field(form, 'name')};
    if (!name.ok) {
        refuse(res, ctx, cid, t(name.error), {status: name.error === 'name-taken' ? 409 : 400, place: SETTINGS, typed});
        return;
    }
    if (!zoneOk(cfg, tz, club.tz)) {
        refuse(res, ctx, cid, t('register-tz-bad'), {place: SETTINGS, typed});
        return;
    }
    const typedDay = form.get('weekday');
    if (typedDay !== null && !/^[1-7]$/.test(typedDay)) {
        refuse(res, ctx, cid, t('club-bad-weekday'), {place: SETTINGS, typed});
        return;
    }
    const weekday = typedDay === null ? teamWeekday(club, null) : Number(typedDay);
    if (name.name === club.name && tz === club.tz && weekday === teamWeekday(club, null)) {
        done(res, ctx, cid, SETTINGS, t('club-saved'));
        return;
    }
    const saved = attempt(res, ctx, cid, c => {
        if (c.name !== name.name) {
            c.name = name.name;
            addLog(c, {at: iso(now), what: 'club-rename', label: name.name});
        }
        if (c.tz !== tz) {
            c.tz = tz;
            addLog(c, {at: iso(now), what: 'club-tz', label: tz});
        }
        if (teamWeekday(c, null) !== weekday) {
            c.weekday = weekday;
            addLog(c, {at: iso(now), what: 'club-weekday', label: t(`weekday-${weekday}`)});
        }
    }, {place: SETTINGS, typed});
    if (saved) {
        done(res, ctx, cid, SETTINGS, t('club-saved'));
    }
}


// POST /manage/rider/remove (zwiftId): out of every archived version of the club (the archive
// table, deleted teams' rows too), out of every version and inbox entry of the club and out of the
// checks (seen), all in the club change's one transaction: a refused write anywhere leaves all
// three as they were. The club change archives nothing (archive: false): the versions it drops
// would go to the archive with the rider in them, and the archive is rewritten in the same
// transaction.
function riderAction(req, res, ctx, cid, form) {
    const aid = field(form, 'zwiftId').trim();
    if (!ZWIFT_RE.test(aid)) {
        refuse(res, ctx, cid, t('rider-bad'), {place: SETTINGS});
        return;
    }
    let archived = 0;
    const removed = attempt(res, ctx, cid, c => removeRider(c, aid, ctx.now), {
        place: SETTINGS, archive: false,
        also: () => {
            archived = ctx.logs.removeRider(cid, aid);
            ctx.store.forget(cid, aid);
        },
    });
    if (removed) {
        const n = removed.result;
        // the archived versions too, so an erasure request visibly reached them
        const text = archived === 0 ? (n === 1 ? t('rider-removed-one') : t('rider-removed', {n}))
            : t('rider-removed-both', {
                plans: n === 1 ? t('rider-plans-one') : t('rider-plans', {n}),
                archived: archived === 1 ? t('rider-archived-one') : t('rider-archived', {n: archived}),
            });
        done(res, ctx, cid, SETTINGS, text);
    }
}


// POST /manage/logs/delete (slug, file): one of this club's recordings.
function deleteRecording(req, res, ctx, cid, form) {
    const slug = field(form, 'slug');
    const file = field(form, 'file');
    if (!isSlug(slug) || !LOG_NAME_RE.test(file) || !ctx.logs.remove(cid, slug, file)) {
        refuse(res, ctx, cid, t('rec-gone'), {place: SETTINGS});
        return;
    }
    done(res, ctx, cid, SETTINGS, t('rec-deleted'));
}


// POST /manage/code (action = on | new | off, confirm, setAt; spec §5.2). `on` on an open club and
// `new` with confirm=1 on a private one make a code and show it on a page of its own, once: it goes
// into no log, cookie, URL or later page, and only its HMAC is stored. The confirm form carries the
// time of the code it replaces (riderCode.setAt, not secret): a code made since then (another
// captain, or this code page sent again) is not replaced (409). Without CODE_SECRET no code can
// be made (409), but a club still private can be made open (F11). `new` without confirm=1 (there is
// no confirm page of its own, decision 13) is refused as a form not understood. Anything else that
// fits no state goes back to the club settings unchanged, without a flash.
function codeAction(req, res, ctx, cid, form) {
    const {store, cfg, now} = ctx;
    const action = field(form, 'action');
    if (!['on', 'new', 'off'].includes(action)) {
        refuse(res, ctx, cid, t('manage-bad-form'), {place: SETTINGS});
        return;
    }
    if (action !== 'off' && !cfg.codeSecret) {
        refuse(res, ctx, cid, t('private-disabled'), {status: 409, place: SETTINGS});
        return;
    }
    // `new` asks first in the page only (decision 13): without confirm=1 the form is not understood
    if (action === 'new' && field(form, 'confirm') !== '1') {
        refuse(res, ctx, cid, t('manage-bad-form'), {place: SETTINGS});
        return;
    }
    const club = store.get(cid);
    const priv = isPrivate(club);
    if (action === 'new' && priv && field(form, 'setAt') !== club.riderCode.setAt) {
        refuse(res, ctx, cid, t('code-changed'), {status: 409, place: SETTINGS});
        return;
    }
    if ((action === 'on' && !priv) || (action === 'new' && priv)) {
        let code = null;
        let hash = null;
        for (let i = 0; i < CODE_DRAWS && hash === null; i++) {
            code = newRiderCode();
            hash = riderCodeHash(code, cfg.codeSecret);
            if (store.codeOwner(hash) !== null) {
                hash = null;
            }
        }
        if (hash === null) {
            throw new Error('no free rider code');
        }
        if (attempt(res, ctx, cid, c => setRiderCode(c, hash, now), {place: SETTINGS})) {
            html(res, 200, codePage(store.get(cid), code, frameOf(ctx, cid)));
        }
        return;
    }
    if (action === 'off' && priv) {
        if (attempt(res, ctx, cid, c => clearRiderCode(c, now), {place: SETTINGS})) {
            done(res, ctx, cid, SETTINGS, t('code-off-done', {club: club.name}));
        }
        return;
    }
    redirect(res, placePath(SETTINGS));
}


// path -> handler
export const CLUB_FORMS = {
    '/manage/club': clubAction,
    '/manage/rider/remove': riderAction,
    '/manage/logs/delete': deleteRecording,
    '/manage/code': codeAction,
};

