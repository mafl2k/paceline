// The club settings' forms (spec §5.2), urlencoded POSTs behind the club gate (manage.mjs): the
// club's name and zone, rider removal, recording delete and the rider code. There is no recording
// download: only the operator opens the files (spec §7.7). Each form handler gets (req, res, ctx,
// cid, form) with the principal's club id and answers 303 to the club settings with a flash (done,
// manage-page.mjs), a refusal on the club settings, or a page of its own (settings-page.mjs).
import {html} from './http.mjs';
import {t} from './pages.mjs';
import {checkClubName, zoneOk, redirect, RIDER_REMOVALS_PER_DAY} from './web.mjs';
import {codePage} from './settings-page.mjs';
import {removeRider, setRiderCode, clearRiderCode, setTargetUnit, TARGET_UNITS, isPrivate, addLog, clubListsBefore} from './club.mjs';
import {isSlug, newRiderCode, riderCodeHash, ZWIFT_RE} from './ids.mjs';
import {LOG_NAME_RE} from './logs.mjs';
import {field, placePath, done, refuse, attempt, frameOf} from './manage-page.mjs';
import {confirmPage} from './ui.mjs';
import {raceWithin} from './team-view.mjs';
import {decodeEntities} from '../pages/src/engine/plan.mjs';
import {localDay, localHHMM} from './time.mjs';
import {entryLine} from './erasures.mjs';
import {operatorAddress, operatorRemovalMail} from './mail-content.mjs';

// A new rider code is drawn at most this often while its hash belongs to another club (50 bits:
// a second draw already never happens in practice).
const CODE_DRAWS = 5;

const iso = ms => new Date(ms).toISOString();
const DAY_MS = 24 * 3600 * 1000;

// where every form here goes back to, and where its refusals are drawn
const SETTINGS = {page: 'settings'};


// The question a club settings form gets without confirm=1 (UI panel wave 2, the no-script path of
// its in-page confirm): `heading`, `words`, the form's `fields` again to `action` with `button`, and
// the way back to the club settings. Nothing changes.
function clubAsk(res, ctx, cid, {heading, words, action, fields, button, danger = true}) {
    const club = ctx.store.get(cid);
    html(res, 200, confirmPage(club, {...frameOf(ctx, cid), here: placePath(SETTINGS), kicker: club.name,
        trail: [{href: placePath(SETTINGS), label: t('tp-club-settings')}], heading, words, action, fields, button, danger,
        back: {href: placePath(SETTINGS), label: t('cs-back')}}));
}


// The name a plan of the club gives Zwift ID `aid`, or null.
function riderName(club, aid) {
    for (const sheet of Object.values(club.sheets)) {
        for (const list of [sheet.json?.riders, sheet.json?.roster]) {
            const r = list && typeof list === 'object' && Object.hasOwn(list, aid) ? list[aid] : null;
            const name = decodeEntities(r?.name).trim();
            if (name) {
                return name;
            }
        }
    }
    return null;
}


// POST /manage/club (name, tz, unit). All are checked before the store sees them (a zone the store
// refuses would be a 500): the name key is unique among active and trashed clubs other than this
// one, the zone one of the form's, the unit the targets are shown in 'wkg' or 'watts' (team cockpit
// spec §7; a form without it, from a page before it, keeps the club's). A weekday (from a page
// before races spec §4c, when the club had a race day) is ignored: every weekly team has its own.
// Each change is noted in the club log. A refusal keeps the name as typed. Another zone while a plan
// of the club races within 7 days asks first without confirm=1 (S11): the question, with the form's
// fields again, and nothing changes. The unit is a display setting: no team's version changes (an
// open team page draws the new unit when it next loads).
function clubAction(req, res, ctx, cid, form) {
    const {store, cfg, now} = ctx;
    const club = store.get(cid);
    const name = checkClubName(store, field(form, 'name'), cid);
    const tz = field(form, 'tz');
    const unitNow = club.targetUnit ?? 'wkg';
    const unit = form.get('unit') === null ? unitNow : field(form, 'unit');
    const typed = {name: field(form, 'name')};
    if (!name.ok) {
        refuse(res, ctx, cid, t(name.error), {status: name.error === 'name-taken' ? 409 : 400, place: SETTINGS, typed});
        return;
    }
    if (!zoneOk(cfg, tz, club.tz)) {
        refuse(res, ctx, cid, t('register-tz-bad'), {place: SETTINGS, typed});
        return;
    }
    if (!TARGET_UNITS.includes(unit)) {
        refuse(res, ctx, cid, t('set-unit-bad'), {place: SETTINGS, typed});
        return;
    }
    if (name.name === club.name && tz === club.tz && unit === unitNow) {
        done(res, ctx, cid, SETTINGS, t('club-saved'));
        return;
    }
    if (tz !== club.tz && field(form, 'confirm') !== '1' && raceWithin(club, null, now)) {
        clubAsk(res, ctx, cid, {heading: t('ask-tz', {club: club.name}), words: t('cs-tz-confirm', {club: club.name}), action: '/manage/club',
            fields: {name: field(form, 'name'), tz, unit}, button: t('cs-tz-yes'), danger: false});
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
        setTargetUnit(c, unit, now);
    }, {place: SETTINGS, typed});
    if (saved) {
        done(res, ctx, cid, SETTINGS, t('club-saved'));
    }
}


// POST /manage/rider/remove (zwiftId, confirm). Without confirm=1 (S13, UI panel wave 2: the no-script
// path of the in-page confirm) a removal that would run asks first, naming the rider a plan of the
// club gives that ID; nothing changes. When the rider's newest entry on the erasure list is still
// live and nothing of his was stored since (no version, inbox entry, archived version or check lists
// him, no recording of the club began since), there is no new line and no mail: an entry applied in
// full means nothing to do at all; one that left failures is run again (steps 3 and 4) and marked
// then. Otherwise a new removal. Both run at most RIDER_REMOVALS_PER_DAY a day per club (each costs a
// pass over the club's recordings; 429 beyond):
// 1. onto the erasure list (erasures.mjs, appended and synced: a restore applies it again, and the
//    uploads leave him out of rides from before it); when it cannot be written nothing changes and
//    the captain is told to tell the operator;
// 2. the operator's mail with the entry's line (notifyOperator);
// 3. out of every archived version of the club (deleted teams' too), every version and inbox entry
//    and the checks (seen), in the club change's one transaction (archive: false: the versions it
//    drops would go to the archive with him in them, and the archive is rewritten in it);
// 4. the club's recordings, one pass (logs.eraseRider): his own uploads deleted, every other one
//    rewritten without him. What failed is counted in the flash; Remove again (or the next start)
//    finishes it. Marked applied once nothing failed.
async function riderAction(req, res, ctx, cid, form) {
    const aid = field(form, 'zwiftId').trim();
    if (!ZWIFT_RE.test(aid)) {
        refuse(res, ctx, cid, t('rider-bad'), {place: SETTINGS});
        return;
    }
    const prior = ctx.erasures.latestEntry(cid, aid);
    const again = prior !== null && !heldSince(ctx, cid, aid, Date.parse(prior.at));
    if (again && ctx.erasures.isApplied(prior)) {
        done(res, ctx, cid, SETTINGS, t('rider-removed-already'));
        return;
    }
    if (field(form, 'confirm') !== '1') {
        const club = ctx.store.get(cid);
        const name = riderName(club, aid);
        const who = name === null ? t('rider-who-id', {id: aid}) : t('rider-who-name', {name, id: aid});
        clubAsk(res, ctx, cid, {heading: t('ask-rider'), words: t('rider-confirm', {who, club: club.name}), action: '/manage/rider/remove',
            fields: {zwiftId: aid}, button: t('rider-yes')});
        return;
    }
    // counted once it is recorded: a removal refused for an unwritable list costs nothing
    if (ctx.web.riderRemovals.count(cid, ctx.now, DAY_MS) >= RIDER_REMOVALS_PER_DAY) {
        refuse(res, ctx, cid, t('rider-remove-limit'), {status: 429, place: SETTINGS});
        return;
    }
    const entry = again ? prior : {cid, aid, at: iso(ctx.now)};
    if (!again) {
        try {
            ctx.erasures.list.append(entry);
        } catch (e) {
            console.error(`paceline-server: club ${cid}: a removal not recorded in erasures.jsonl, nothing changed: ${e?.code ?? e?.name ?? 'error'}`);
            refuse(res, ctx, cid, t('rider-not-recorded'), {status: 503, place: SETTINGS});
            return;
        }
        notifyOperator(ctx, ctx.store.get(cid), entry);
    }
    ctx.web.riderRemovals.add(cid, ctx.now);
    let archived = 0;
    const removed = attempt(res, ctx, cid, c => removeRider(c, aid, ctx.now), {
        place: SETTINGS, archive: false,
        also: () => {
            archived = ctx.logs.removeRider(cid, aid);
            ctx.store.forget(cid, aid);
        },
    });
    if (!removed) {
        return;
    }
    const recs = await ctx.logs.eraseRider(cid, aid);
    if (!recs.failed && !recs.unreadable) {
        try {
            ctx.erasures.markApplied(entry);
        } catch (e) {
            console.error(`paceline-server: club ${cid}: a removal applied but not marked: ${e?.code ?? e?.name ?? 'error'}`);
        }
    }
    done(res, ctx, cid, SETTINGS, riderRemovedText(removed.result, archived, recs), recs.failed || recs.unreadable ? 'err' : 'ok');
}


// Whether anything of rider `aid` in club `cid` may be stored since `since` (epoch ms): a version or
// inbox entry, an archived version or a check lists him, or a recording of the club began since.
function heldSince(ctx, cid, aid, since) {
    const club = ctx.store.get(cid);
    return clubListsBefore(club, aid, Infinity) || ctx.logs.archiveLists(cid, aid) || Object.hasOwn(ctx.store.seenOf(cid), aid)
        || ctx.logs.list(cid).some(r => r.session >= since);
}


// Mails the operator (operatorAddress: OPERATOR_EMAIL, else the address in PRIVACY_CONTACT) the
// removal with its erasure-list line, for a full restore of the data folder (erasures.mjs). Sent
// when the entry is written, before the removal itself. Nothing without a mailer or an address; a
// mail refused or failing never touches the removal, and is logged without the ID.
function notifyOperator(ctx, club, entry) {
    const to = operatorAddress(ctx.cfg);
    if (!ctx.mailer || !to) {
        return;
    }
    let sent = false;
    try {
        sent = ctx.mailer.send({kind: 'rider-removed', to, budget: 'operator',
            ...operatorRemovalMail({club: club?.name ?? entry.cid, ...entry, line: entryLine(entry)}, ctx.cfg)});
    } catch (e) {
        sent = false;
    }
    if (!sent) {
        console.warn(`paceline-server: club ${entry.cid}: the operator mail of a removal was not sent`);
    }
}


// The flash of Remove a rider: what he was removed from (plans, archived versions, recordings),
// his own recordings deleted, then those that could not be changed or read; only the parts that are
// not zero, and a sentence of its own when there was nothing at all.
export function riderRemovedText(plans, archived, {changed = 0, deleted = 0, failed = 0, unreadable = 0} = {}) {
    const count = (key, n) => n === 1 ? t(`${key}-one`) : t(key, {n});
    const from = [[plans, 'rider-plans'], [archived, 'rider-archived'], [changed, 'rider-recordings']].filter(([n]) => n > 0).map(([n, key]) => count(key, n));
    const parts = [];
    if (from.length) {
        const list = from.length === 1 ? from[0] : from.length === 2 ? t('rider-list-two', {a: from[0], b: from[1]})
            : t('rider-list-three', {a: from[0], b: from[1], c: from[2]});
        parts.push(t('rider-removed', {list}));
    }
    if (deleted) {
        parts.push(count('rider-own-deleted', deleted));
    }
    if (failed) {
        parts.push(count('rider-recs-failed', failed));
    }
    if (unreadable) {
        parts.push(count('rider-recs-unreadable', unreadable));
    }
    return parts.length ? parts.join(' ') : t('rider-removed-none');
}


// POST /manage/logs/delete (slug, file, confirm): one of this club's recordings. Without confirm=1
// (review I1, UI panel wave 2: the no-script path of its in-page confirm) a recording that exists
// is asked about first, naming the rider and the session; nothing changes.
function deleteRecording(req, res, ctx, cid, form) {
    const slug = field(form, 'slug');
    const file = field(form, 'file');
    const rec = isSlug(slug) && LOG_NAME_RE.test(file) ? ctx.logs.list(cid).find(r => r.slug === slug && r.file === file) ?? null : null;
    if (rec !== null && field(form, 'confirm') !== '1') {
        const club = ctx.store.get(cid);
        const rider = riderName(club, rec.athlete) ?? rec.athlete;
        clubAsk(res, ctx, cid, {heading: t('ask-rec-delete'), words: t('rec-delete-confirm', {rider, day: localDay(rec.session, club.tz), time: localHHMM(rec.session, club.tz)}),
            action: '/manage/logs/delete', fields: {slug, file}, button: t('rec-delete-yes')});
        return;
    }
    if (rec === null || !ctx.logs.remove(cid, slug, file)) {
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
// be made (409), but a club still private can be made open (F11). `on` and `new` without confirm=1
// (the no-script path of their in-page confirms, S2, UI panel wave 2) answer with the question and
// change nothing. Anything else that fits no state goes back to the club settings unchanged, without
// a flash.
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
    const club = store.get(cid);
    const priv = isPrivate(club);
    if (action === 'new' && priv && field(form, 'setAt') !== club.riderCode.setAt) {
        refuse(res, ctx, cid, t('code-changed'), {status: 409, place: SETTINGS});
        return;
    }
    // both ask first: on a page of their own without confirm=1
    if (field(form, 'confirm') !== '1' && ((action === 'on' && !priv) || (action === 'new' && priv))) {
        clubAsk(res, ctx, cid, action === 'on'
            ? {heading: t('ask-code-on', {club: club.name}), words: t('private-on-confirm', {club: club.name}), action: '/manage/code', fields: {action}, button: t('private-on-yes')}
            : {heading: t('ask-code-new'), words: t('code-confirm'), action: '/manage/code', fields: {action, setAt: field(form, 'setAt')}, button: t('private-new')});
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

