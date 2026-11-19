// Club operations (spec §3–§5.2): teams, sheet uploads with their defaults, the live pointer, Back
// to vN (plan versions §8), rider removal, the sweep and the caps. Pure and synchronous: every function changes the club
// object it is given (the store passes a clone), and the clock is always passed in.
import {CID_RE, SHEET_RE, ZWIFT_RE, isSlug, isEventId, cleanName, freeSlug, nameKey} from './ids.mjs';
import {isDate, HHMM_RE, localDate, localDay, zonedToUtc, addDays, isZone} from './time.mjs';
import {plannedStart, usedUp, teamWeekday} from './select.mjs';
import {t} from './pages.mjs';
import {
    isUsed, SHARED_SHARE, plansOf, planOfId, planLabel, typeKey, rememberType, previousVersion, freeVersionId,
} from './plans.mjs';
import {normalizePlan, stripSheet, PlanError, RAW_NAME_MAX} from '../pages/src/engine/plan.mjs';

export const MAX_TEAMS = 10;
export const MAX_PLANS = 8;               // per team
export const MAX_PLANS_PER_RACE = 5;      // per team and date, an abuse cap
export const MAX_VERSIONS = 20;           // per plan
export const MAX_RIDERS = 40;             // per version, riders plus bench
export const MAX_SHEET_BYTES = 65536;     // JSON.stringify({json, text}) of the stored version
export const MAX_CLUB_BYTES = 2097152;    // the club's whole JSON, as stored
export const MAX_LOG = 200;
export const KEEP_DAYS = 7;               // a used-up plan goes this many days after its date
export const TEAM_NAME_MAX = 40;
export const TYPE_MAX = 30;               // a plan's type; its label is the team name plus the type
export const RIDER_NAME_MAX = 100;
export const INBOX_MAX = 10;              // entries per club
export const INBOX_BYTES = 327680;        // 320 KB: the sum of the entries' {json, text, warnings}
export const INBOX_KEEP_MS = 86400000;    // an entry nobody stored goes after 24 h
const WARNINGS_MAX = 21;                  // import warnings kept with an entry
const WARNING_CODE_MAX = 40;              // a warning's code (the import's codes are short words)

export {isUsed} from './plans.mjs';


export class ClubError extends Error {
    constructor(code, vars = {}) {
        super(code);
        this.name = 'ClubError';
        this.code = code;
        this.vars = vars;
    }
}


const iso = ms => new Date(ms).toISOString();


function teamOf(club, slug) {
    if (!isSlug(slug) || !Object.hasOwn(club.teams, slug)) {
        throw new ClubError('not-found');
    }
    return club.teams[slug];
}


function sheetOf(club, slug, id) {
    const team = teamOf(club, slug);
    if (typeof id !== 'string' || !SHEET_RE.test(id) || !Object.hasOwn(club.sheets, id) ||
        club.sheets[id].team !== slug) {
        throw new ClubError('not-found');
    }
    return {team, sheet: club.sheets[id]};
}


function teamSheets(club, slug) {
    return Object.entries(club.sheets).filter(([, s]) => s.team === slug);
}


function bump(team, now) {
    team.version++;
    team.changedAt = iso(now);
}


// Bumps the team's version and logs the change `what` with `label`.
function changed(club, slug, team, now, what, label) {
    bump(team, now);
    addLog(club, {at: iso(now), what, team: slug, label});
}


// Older first: by S, else by date, then by upload time.
function older(club, a, b) {
    const Sa = plannedStart(club, a);
    const Sb = plannedStart(club, b);
    if (Sa !== null && Sb !== null && Sa !== Sb) {
        return Sa - Sb;
    }
    if (a.date !== b.date) {
        return a.date < b.date ? -1 : 1;
    }
    return (Date.parse(a.uploadedAt) || 0) - (Date.parse(b.uploadedAt) || 0);
}


// 'Thu 19 Nov' for a race date, as the pages write it.
const raceDay = (club, date) => localDay(zonedToUtc(date, '12:00', club.tz), club.tz);


export function clubBytes(club) {
    return Buffer.byteLength(JSON.stringify(club));
}


export function addLog(club, entry) {
    club.log.push(entry);
    if (club.log.length > MAX_LOG) {
        club.log.splice(0, club.log.length - MAX_LOG);
    }
}


// A pending club. The page checks the name key and the address; an id or zone the server cannot
// use is a programming error.
export function newClub({id, name, email, tz, now}) {
    if (typeof id !== 'string' || !CID_RE.test(id)) {
        throw new TypeError(`bad club id ${id}`);
    }
    if (!isZone(tz)) {
        throw new TypeError(`bad time zone ${tz}`);
    }
    const clean = cleanName(name, 2, 60);
    if (clean === null) {
        throw new ClubError('bad-name', {min: 2, max: 60});
    }
    return {
        id, name: clean, status: 'pending', email, tz, createdAt: iso(now), confirmedAt: null, riderCode: null, tokens: [],
        teams: {}, sheets: {}, log: [], inbox: [], weekday: 4,
    };
}


// A private club needs a rider code besides the Zwift ID (spec §3). A missing field counts as open.
export function isPrivate(club) {
    return club.riderCode != null;
}


// Turns the rider code on or replaces it; the old code ends at once. `hash` is riderCodeHash's.
// The log names the step, never the code or its hash.
export function setRiderCode(club, hash, now) {
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) {
        throw new TypeError('bad rider code hash');
    }
    const what = isPrivate(club) ? 'code-new' : 'code-on';
    club.riderCode = {hash, setAt: iso(now)};
    addLog(club, {at: iso(now), what});
}


// Makes the club open again. Nothing happens to an open club.
export function clearRiderCode(club, now) {
    if (!isPrivate(club)) {
        return;
    }
    club.riderCode = null;
    addLog(club, {at: iso(now), what: 'code-off'});
}


function checkStart(start) {
    if (start !== null && (typeof start !== 'string' || !HHMM_RE.test(start))) {
        throw new ClubError('bad-start');
    }
}


function checkTeamName(name) {
    const clean = cleanName(name, 1, TEAM_NAME_MAX);
    if (clean === null) {
        throw new ClubError('bad-name', {max: TEAM_NAME_MAX});
    }
    return clean;
}


// The slug is unique across all clubs and never reused: `slugTaken` answers for the store
// (other clubs, retired slugs), this club's own teams are checked here.
export function addTeam(club, {name, start = null}, {slugTaken, now}) {
    if (Object.keys(club.teams).length >= MAX_TEAMS) {
        throw new ClubError('cap-teams', {max: MAX_TEAMS});
    }
    const clean = checkTeamName(name);
    checkStart(start);
    const slug = freeSlug(clean, s => Object.hasOwn(club.teams, s) || slugTaken(s));
    club.teams[slug] = {name: clean, start, live: null, version: 1, changedAt: iso(now), kind: 'weekly', weekday: null};
    addLog(club, {at: iso(now), what: 'team-add', team: slug, label: clean});
    return slug;
}


// The stored versions' labels follow the new name (their types stay).
export function renameTeam(club, slug, name, now) {
    const team = teamOf(club, slug);
    team.name = checkTeamName(name);
    for (const [, sheet] of teamSheets(club, slug)) {
        sheet.label = planLabel(team.name, sheet.type ?? null);
    }
    bump(team, now);
    addLog(club, {at: iso(now), what: 'team-rename', team: slug, label: team.name});
}


export function setStart(club, slug, start, now) {
    const team = teamOf(club, slug);
    checkStart(start);
    team.start = start;
    bump(team, now);
    addLog(club, {at: iso(now), what: 'team-start', team: slug, label: start ?? ''});
}


// Weekly (on `weekday` 1-7, or null for the club's) or special (plan versions spec §3.1, user 17 Nov
// 2026). The log label is "weekly, Thursday" (the day it then races on) or "special".
export function setKind(club, slug, {kind, weekday}, now) {
    const team = teamOf(club, slug);
    if (kind !== 'weekly' && kind !== 'special') {
        throw new ClubError('bad-kind');
    }
    if (weekday !== null && !(Number.isInteger(weekday) && weekday >= 1 && weekday <= 7)) {
        throw new ClubError('bad-weekday');
    }
    team.kind = kind;
    team.weekday = weekday;
    bump(team, now);
    const label = kind === 'special' ? 'special' : `weekly, ${t(`weekday-${teamWeekday(club, slug)}`)}`;
    addLog(club, {at: iso(now), what: 'team-kind', team: slug, label});
}


// Removes the team and its sheets. Returns the slug, for the store to retire.
export function deleteTeam(club, slug, now) {
    const team = teamOf(club, slug);
    for (const [id] of teamSheets(club, slug)) {
        delete club.sheets[id];
    }
    delete club.teams[slug];
    addLog(club, {at: iso(now), what: 'team-delete', team: slug, label: team.name});
    return slug;
}


// Does an upload for `slug` look like another team's plan (spec §5.2 result page)? `json` is the
// planner JSON, `riderIds` its riders' Zwift IDs. The first that applies:
// - {kind: 'name', team}: the JSON's team name has the name key of another team's name or of the
//   planner name of one of its versions (`jsonName`; labels start with the team name and would match
//   by accident). A name without a key (e.g. one character or non-Latin) never matches;
// - {kind: 'overlap', team, shared, total}: another team's live version lists at least 60 % of these
//   riders as riders, and more of them than this team's live version does (the most shared wins);
// - null.
export function teamHint(club, slug, json, riderIds) {
    const others = Object.keys(club.teams).filter(s => s !== slug);
    const key = typeof json?.team?.name === 'string' ? nameKey(json.team.name) : null;
    if (key !== null) {
        for (const other of others) {
            if (nameKey(club.teams[other].name) === key || teamSheets(club, other).some(([, s]) => s.jsonName === key)) {
                return {kind: 'name', team: other};
            }
        }
    }
    const ids = [...new Set((riderIds || []).map(String))];
    const sharedWith = s => {
        const id = Object.hasOwn(club.teams, s) ? club.teams[s].live : null;
        const riders = typeof id === 'string' && Object.hasOwn(club.sheets, id) ? club.sheets[id].json?.riders : null;
        return riders && typeof riders === 'object' ? ids.filter(a => Object.hasOwn(riders, a)).length : 0;
    };
    const own = sharedWith(slug);
    let best = null;
    for (const other of others) {
        const shared = sharedWith(other);
        if (ids.length && shared >= SHARED_SHARE * ids.length && shared > own && (best === null || shared > best.shared)) {
            best = {kind: 'overlap', team: other, shared, total: ids.length};
        }
    }
    return best;
}


function eventIdOrNull(v) {
    if (v == null) {
        return null;
    }
    if (!isEventId(v)) {
        throw new TypeError(`bad event id ${v}`);
    }
    return Number(v);
}


// The content checks of an arriving plan (json and text as importFiles gives them), in a fixed order
// so the page shows the first problem: {json, text} stripped by stripSheet, and the normalized plan.
export function checkPlan(json, text) {
    // stripSheet drops entries under keys that are no Zwift ID; refuse such a plan instead.
    for (const list of [json?.riders, json?.roster]) {
        if (list && typeof list === 'object' && Object.keys(list).some(id => !ZWIFT_RE.test(id))) {
            throw new ClubError('bad-plan');
        }
    }
    const stripped = stripSheet(json, text);
    let plan;
    try {
        plan = normalizePlan(stripped.json, stripped.text).plan;
    } catch (e) {
        if (e instanceof PlanError) {
            throw new ClubError('bad-plan');
        }
        throw e;
    }
    for (const r of [...plan.riders, ...plan.bench]) {
        if ([...r.name].length > RIDER_NAME_MAX) {
            throw new ClubError('long-name', {max: RIDER_NAME_MAX});
        }
    }
    // stripSheet drops a raw name over RAW_NAME_MAX (white space or entity padding); refuse it
    // here instead of storing a nameless rider.
    for (const list of [json.riders, json.roster]) {
        for (const r of list && typeof list === 'object' ? Object.values(list) : []) {
            if (r && typeof r.name === 'string' && r.name.length > RAW_NAME_MAX) {
                throw new ClubError('long-name', {max: RIDER_NAME_MAX});
            }
        }
    }
    if (plan.riders.length + plan.bench.length > MAX_RIDERS) {
        throw new ClubError('cap-riders', {max: MAX_RIDERS, count: plan.riders.length + plan.bench.length});
    }
    if (Buffer.byteLength(JSON.stringify(stripped)) > MAX_SHEET_BYTES) {
        throw new ClubError('cap-bytes', {max: MAX_SHEET_BYTES / 1024});
    }
    return {json: stripped.json, text: stripped.text, plan};
}


// The type of a plan or version of team `slug` for race `date` (spec decision 10). `as` is 'new' or
// the plan (any id of it). A blank type is none; for a version, `type` undefined keeps the plan's.
// Within a race types are unique by typeKey, and at most one plan has none.
export function typeFor(club, slug, {as, type, date}, now) {
    const team = teamOf(club, slug);
    const own = typeof as === 'string' && as !== 'new' ? planOfId(club, slug, as) : null;
    let clean;
    if (type === undefined && own !== null) {
        clean = own.type;
    } else if (type == null || (typeof type === 'string' && !type.trim())) {
        clean = null;
    } else {
        clean = cleanName(type, 1, TYPE_MAX);
        if (clean === null) {
            throw new ClubError('bad-type', {max: TYPE_MAX});
        }
    }
    const others = plansOf(club, slug).filter(p => p.date === date && (own === null || p.id !== own.id));
    if (clean === null && others.some(p => p.type === null)) {
        throw new ClubError('type-needed', {team: team.name, day: raceDay(club, date)});
    }
    if (clean !== null && others.some(p => p.type !== null && typeKey(p.type) === typeKey(clean))) {
        throw new ClubError('type-taken', {type: clean, team: team.name, day: raceDay(club, date)});
    }
    return clean;
}


const VIAS = ['file', 'paste', 'import', 'receive'];


// The cap of versions per plan for a new version of `plan` (labelled `label`): with MAX_VERSIONS
// stored, the lowest version that is not live goes. {dropped, dropIds}.
function versionCap(team, plan, label) {
    if (plan.versions.length < MAX_VERSIONS) {
        return {dropped: null, dropIds: []};
    }
    const [vid, v] = plan.versions.find(([i]) => i !== team.live);
    return {dropped: {kind: 'version', n: v.n, label}, dropIds: [vid]};
}


// A new version's event fields: from the plan's live version when the plan is live, else from its
// newest. A given link (`pinnedEventId`, or null) wins; the learned event carries over only without
// a link. {pin, eventId, boundAt}.
function eventFields(club, plan, pinnedEventId) {
    const src = plan.live !== null ? club.sheets[plan.live] : plan.newest[1];
    const pin = pinnedEventId ?? src.pinnedEventId ?? null;
    return pin === null ? {pin, eventId: src.eventId ?? null, boundAt: src.boundAt ?? null} : {pin, eventId: null, boundAt: null};
}


// Stores one upload as a version: of a new plan (`as` 'new') or of the plan `as` names by any of its
// ids. Without `as` it is refused (pick-plan: the assign page never stores a plan the captain did
// not see chosen); only `live` true makes it live. For a version, `type` undefined keeps the plan's
// type, and the date is the plan's. Checks run in a fixed order, so the page shows the first problem.
// Returns {id, planId, n, prev, live, created, same, dropped, changedAt, plan}.
export function uploadSheet(club, input, {now, newId}) {
    const {slug, base} = input;
    const team = teamOf(club, slug);
    const pinnedEventId = eventIdOrNull(input.pinnedEventId);
    const {json, text, plan} = checkPlan(input.json, input.text ?? null);

    const as = input.as === '' ? null : input.as ?? null;
    const live = input.live === true;
    if (as === null) {
        throw new ClubError('pick-plan');
    }
    const target = as === 'new' ? null : typeof as === 'string' && SHEET_RE.test(as) ? planOfId(club, slug, as) : null;
    if (as !== 'new' && target === null) {
        throw new ClubError('not-found');
    }

    let date;
    if (target !== null) {
        date = target.date;
        if (isUsed(club, target.newest[1], now)) {
            throw new ClubError('plan-used', {label: target.label});
        }
    } else {
        date = input.date;
        if (!isDate(date)) {
            throw new ClubError('bad-date');
        }
        const S = plannedStart(club, {team: slug, date});
        if (S !== null && usedUp(S, now)) {
            throw new ClubError('race-over', {date});
        }
    }

    const type = typeFor(club, slug, {as: target === null ? 'new' : target.id, type: input.type, date}, now);
    const label = planLabel(team.name, type);
    const changedAt = Number(base) !== team.version ? team.changedAt : null;

    // The same content (json, text, type and event link) as the plan's newest version stores nothing;
    // the live box still applies.
    if (target !== null) {
        const [nid, newest] = target.newest;
        if (JSON.stringify(newest.json) === JSON.stringify(json) && JSON.stringify(newest.text ?? null) === JSON.stringify(text)
            && (newest.type ?? null) === type && (pinnedEventId === null || pinnedEventId === newest.pinnedEventId)) {
            if (live === true && team.live !== nid) {
                team.live = nid;
                changed(club, slug, team, now, 'live', newest.label);
            }
            return {
                id: nid, planId: target.id, n: newest.n, prev: previousVersion(club, nid)?.[0] ?? null,
                live: team.live === nid, created: false, same: true, dropped: null, changedAt, plan,
            };
        }
    }

    // Caps: plans per race, plans per team (the oldest used-up plan goes), versions per plan (the
    // lowest version that is not live goes).
    let dropped = null;
    let dropIds = [];
    if (target === null) {
        const plans = plansOf(club, slug);
        if (plans.filter(p => p.date === date).length >= MAX_PLANS_PER_RACE) {
            throw new ClubError('cap-race', {team: team.name, max: MAX_PLANS_PER_RACE, day: raceDay(club, date)});
        }
        if (plans.length >= MAX_PLANS) {
            const used = plans.filter(p => isUsed(club, p.newest[1], now)).sort((a, b) => older(club, a.newest[1], b.newest[1]));
            if (!used.length) {
                throw new ClubError('cap-sheets', {max: MAX_PLANS});
            }
            dropped = {kind: 'plan', label: used[0].label, date: used[0].date};
            dropIds = used[0].versions.map(([vid]) => vid);
        }
    } else {
        ({dropped, dropIds} = versionCap(team, target, label));
    }

    const {pin, eventId, boundAt} = target === null ? {pin: pinnedEventId, eventId: null, boundAt: null}
        : eventFields(club, target, pinnedEventId);

    // the id before the drops: a dropped plan's ids stay taken in this change
    const id = freeVersionId(club, newId);
    const planId = target === null ? id : target.id;
    const n = target === null ? 1 : target.newest[1].n + 1;
    for (const vid of dropIds) {
        delete club.sheets[vid];
    }
    club.sheets[id] = {
        team: slug, label, date, sig: plan.sig, json, text,
        uploadedAt: iso(now), via: VIAS.includes(input.via) ? input.via : 'file',
        eventId, boundAt, pinnedEventId: pin,
        plan: planId, n, at: iso(now), copyOf: null, jsonName: nameKey(input.json?.team?.name), type, recSig: plan.sig,
    };
    if (live === true) {
        team.live = id;
    } else if (dropIds.includes(team.live)) {
        team.live = null;
    }
    rememberType(team, type);
    changed(club, slug, team, now, 'upload', `${label} v${n}`);
    return {
        id, planId, n, prev: target === null ? null : target.newest[0], live: team.live === id,
        created: target === null, same: false, dropped, changedAt, plan,
    };
}


// Make live keeps upload times.
export function makeLive(club, slug, id, now) {
    const {team, sheet} = sheetOf(club, slug, id);
    team.live = id;
    changed(club, slug, team, now, 'live', sheet.label);
}


// The versions of the plan that version `id` belongs to: [[id, sheet], …], lowest n first.
function planVersions(club, slug, id) {
    const {sheet} = sheetOf(club, slug, id);
    return plansOf(club, slug).find(p => p.id === sheet.plan);
}


// Deletes the whole plan of version `id`, every version of it, for good (spec §8: no Undo; the
// confirm says so). The log names the plan's label.
export function deleteSheet(club, slug, id, now) {
    const team = teamOf(club, slug);
    const p = planVersions(club, slug, id);
    for (const [vid] of p.versions) {
        delete club.sheets[vid];
        if (team.live === vid) {
            team.live = null;
        }
    }
    changed(club, slug, team, now, 'delete', p.label);
}


// Removes the event link from every version of the plan of version `id`, so no older version brings
// it back. Copies take the versions' places.
export function unpin(club, slug, id, now) {
    const team = teamOf(club, slug);
    const p = planVersions(club, slug, id);
    for (const [vid, v] of p.versions) {
        club.sheets[vid] = {...v, pinnedEventId: null};
    }
    changed(club, slug, team, now, 'unpin', p.label);
}


// Back to vN (plan versions §8): a new version of plan `plan` (any of its ids) with version `n`'s
// JSON, text and sig, `via: 'back'`, `copyOf: n`, `at` now and vN's upload time (O4). The type stays
// the plan's current one; the event fields come from the plan's live version, else its newest, as an
// upload without a link takes them. It goes live at once when the plan is live, and counts against
// MAX_VERSIONS. `version` is the team's version the page was drawn with. Checks, in this order:
// the version (`changed`), the plan (`not-found`), a used-up plan (`plan-used`), and `n`: a stored
// version that is not the newest (`not-found`). Returns {id, planId, n, from, live, dropped}.
export function backTo(club, slug, {plan, n, version}, {now, newId}) {
    const team = teamOf(club, slug);
    if (Number(version) !== team.version) {
        throw new ClubError('changed');
    }
    const p = typeof plan === 'string' && SHEET_RE.test(plan) ? planOfId(club, slug, plan) : null;
    if (p === null) {
        throw new ClubError('not-found');
    }
    if (isUsed(club, p.newest[1], now)) {
        throw new ClubError('plan-used', {label: p.label});
    }
    const from = Number(n);
    const entry = p.versions.find(([, v]) => v.n === from);
    if (!entry || from === p.newest[1].n) {
        throw new ClubError('not-found');
    }
    const old = entry[1];
    const type = p.type;
    const label = planLabel(team.name, type);
    const {dropped, dropIds} = versionCap(team, p, label);
    const {pin, eventId, boundAt} = eventFields(club, p, null);
    const id = freeVersionId(club, newId);
    const k = p.newest[1].n + 1;
    // read vN before the cap may drop it
    const json = structuredClone(old.json);
    const text = structuredClone(old.text ?? null);
    for (const vid of dropIds) {
        delete club.sheets[vid];
    }
    club.sheets[id] = {
        team: slug, label, date: p.date, sig: old.sig, json, text,
        uploadedAt: old.uploadedAt, via: 'back',
        eventId, boundAt, pinnedEventId: pin,
        plan: p.id, n: k, at: iso(now), copyOf: from, jsonName: old.jsonName ?? null, type, recSig: old.sig,
    };
    if (p.live !== null) {
        team.live = id;
    }
    rememberType(team, type);
    changed(club, slug, team, now, 'back', `${label} v${from} → v${k}`);
    return {id, planId: p.id, n: k, from, live: team.live === id, dropped};
}


// A rider's check learned the sheet's event. Only a sheet with neither a learned nor a pinned id
// learns. No version bump, so a check never makes a captain's open page stale; no log entry.
export function learnEvent(club, id, eventId, now) {
    if (typeof id !== 'string' || !SHEET_RE.test(id) || !Object.hasOwn(club.sheets, id)) {
        throw new ClubError('not-found');
    }
    const sheet = club.sheets[id];
    if (!isEventId(eventId) || sheet.eventId != null || sheet.pinnedEventId != null) {
        return false;
    }
    sheet.eventId = Number(eventId);
    sheet.boundAt = iso(now);
    return true;
}


// True when a stored sheet of the club (live or not) lists the Zwift ID as a rider or on the bench.
export function clubLists(club, athleteId) {
    const aid = String(athleteId);
    return Object.values(club.sheets).some(sheet => lists(sheet, aid));
}


function lists(sheet, athleteId) {
    const json = sheet.json || {};
    return (json.riders != null && Object.hasOwn(json.riders, athleteId)) ||
        (json.roster != null && Object.hasOwn(json.roster, athleteId));
}


// Takes the rider out of every version of the club (riders, bench and his text row) and out of the
// inbox entries. A version left without riders is deleted. A changed version gets a new sig, keeps its recSig and adds
// the old sig to `pastSigs`. Each team it
// touched gets a new version. Returns how many plans changed; the log entry names no one.
export function removeRider(club, athleteId, now) {
    const aid = String(athleteId);
    if (!ZWIFT_RE.test(aid)) {
        return 0;
    }
    const teams = new Set();
    const plans = new Set();
    for (const [id, sheet] of Object.entries(club.sheets)) {
        if (!lists(sheet, aid)) {
            continue;
        }
        plans.add(`${sheet.team}/${sheet.plan}`);
        teams.add(sheet.team);
        const json = {...sheet.json};
        for (const k of ['riders', 'roster']) {
            if (json[k] != null) {
                json[k] = Object.fromEntries(Object.entries(json[k]).filter(([k2]) => k2 !== aid));
            }
        }
        if (!json.riders || !Object.keys(json.riders).length) {
            delete club.sheets[id];
            if (Object.hasOwn(club.teams, sheet.team) && club.teams[sheet.team].live === id) {
                club.teams[sheet.team].live = null;
            }
            continue;
        }
        // stripSheet keeps only the text rows still matched to a rider.
        const stripped = stripSheet(json, sheet.text);
        const {plan} = normalizePlan(stripped.json, stripped.text);
        // pastSigs: every earlier sig, so a recording made in between still finds the version
        const pastSigs = [...(Array.isArray(sheet.pastSigs) ? sheet.pastSigs : []), sheet.sig];
        club.sheets[id] = {...sheet, json: stripped.json, text: stripped.text, sig: plan.sig, pastSigs};
    }
    // The inbox too: his row goes from every entry that lists him, an entry left without riders is
    // dropped, and a touched entry loses all its warnings (they may name him).
    club.inbox = club.inbox.flatMap(entry => {
        if (!lists(entry, aid)) {
            return [entry];
        }
        const json = {...entry.json};
        for (const k of ['riders', 'roster']) {
            if (json[k] != null) {
                json[k] = Object.fromEntries(Object.entries(json[k]).filter(([k2]) => k2 !== aid));
            }
        }
        if (!json.riders || !Object.keys(json.riders).length) {
            return [];
        }
        const stripped = stripSheet(json, entry.text);
        return [{...entry, json: stripped.json, text: stripped.text, warnings: [], warningsMore: 0}];
    });
    for (const [slug, team] of Object.entries(club.teams)) {
        if (teams.has(slug)) {
            bump(team, now);
        }
    }
    addLog(club, {at: iso(now), what: 'rider-remove'});
    return plans.size;
}


// The ids of the versions sweepClub deletes: every version of each plan whose newest version is used
// up and whose date lies more than KEEP_DAYS days before today in the club's zone. Only reads the
// club, so the 10-minute sweep can ask every club without cloning it.
export function sweptSheets(club, now) {
    const cutoff = addDays(localDate(now, club.tz), -KEEP_DAYS);
    const byPlan = new Map();
    for (const [id, sheet] of Object.entries(club.sheets)) {
        const key = `${sheet.team}/${sheet.plan}`;
        if (!byPlan.has(key)) {
            byPlan.set(key, []);
        }
        byPlan.get(key).push([id, sheet]);
    }
    const out = [];
    for (const versions of byPlan.values()) {
        const newest = versions.reduce((a, b) => (b[1].n > a[1].n ? b : a))[1];
        if (newest.date < cutoff && isUsed(club, newest, now)) {
            out.push(...versions.map(([id]) => id));
        }
    }
    return out;
}


// Deletes the versions of sweptSheets. No version bump: the sweep must not make a captain's open
// page stale. Returns how many versions went.
export function sweepClub(club, now) {
    const ids = sweptSheets(club, now);
    for (const id of ids) {
        const slug = club.sheets[id].team;
        delete club.sheets[id];
        if (Object.hasOwn(club.teams, slug) && club.teams[slug].live === id) {
            club.teams[slug].live = null;
        }
    }
    return ids.length;
}



// ---- the inbox (plan versions spec §4.1, §5) ----
// A plan that came in and waits on the assign page: {id, at, source, team, forPlan, via, json, text,
// warnings, warningsMore}, `json` and `text` as checkPlan stripped them. Not part of any team's state: no version
// bump, no log (but discard), and an entry nobody stores goes after INBOX_KEEP_MS.

const entryBytes = e => Buffer.byteLength(JSON.stringify({json: e.json, text: e.text, warnings: e.warnings}));


// Keeps the warnings an import gave: {warnings: [{code, name}], more}, at most WARNINGS_MAX of them
// and `more` the count of the ones left out (the page says "… and N more"); a name at most
// RIDER_NAME_MAX code points. A warning without a code, or with a code over WARNING_CODE_MAX
// characters, is dropped and not counted.
function cleanWarnings(warnings) {
    const valid = (Array.isArray(warnings) ? warnings : [])
        .filter(w => w && typeof w.code === 'string' && w.code.length > 0 && w.code.length <= WARNING_CODE_MAX);
    return {
        warnings: valid.slice(0, WARNINGS_MAX)
            .map(w => ({code: w.code, name: typeof w.name === 'string' ? [...w.name].slice(0, RIDER_NAME_MAX).join('') : null})),
        more: Math.max(0, valid.length - WARNINGS_MAX),
    };
}


// Where an entry came from: an upload now; /import and receive (circles §14) later.
const SOURCES = ['upload', 'import', 'receive'];


// Adds an entry and returns its id. `source` must be one of SOURCES (else an Error: a caller's bug).
// `team` is kept only when it is a team of the club, `via` only when it is one of VIAS, `forPlan`
// only when it names a plan of `team`; else each is null. An entry that alone is over INBOX_BYTES is
// refused (cap-bytes; a checked plan is at most MAX_SHEET_BYTES plus its warnings, far below).
// Then the oldest entries go until at most INBOX_MAX are left and they fit INBOX_BYTES (the new one
// stays).
export function addEntry(club, {source, team = null, forPlan = null, via = null, json, text, warnings = []}, {now, newId}) {
    if (!SOURCES.includes(source)) {
        throw new Error(`unknown entry source ${source}`);
    }
    const slug = typeof team === 'string' && isSlug(team) && Object.hasOwn(club.teams, team) ? team : null;
    const kept = cleanWarnings(warnings);
    const entry = {
        id: null, at: iso(now), source, team: slug, forPlan: null, via: VIAS.includes(via) ? via : null,
        json, text, warnings: kept.warnings, warningsMore: kept.more,
    };
    if (entryBytes(entry) > INBOX_BYTES) {
        throw new ClubError('cap-bytes', {max: INBOX_BYTES / 1024});
    }
    let id = null;
    for (let i = 0; i < 20 && id === null; i++) {
        const cand = newId();
        if (SHEET_RE.test(cand) && !club.inbox.some(e => e.id === cand)) {
            id = cand;
        }
    }
    if (id === null) {
        throw new Error('no free entry id');
    }
    const plan = slug !== null && typeof forPlan === 'string' ? planOfId(club, slug, forPlan) : null;
    club.inbox.push({...entry, id, forPlan: plan === null ? null : forPlan});
    let bytes = club.inbox.reduce((n, e) => n + entryBytes(e), 0);
    while (club.inbox.length > 1 && (club.inbox.length > INBOX_MAX || bytes > INBOX_BYTES)) {
        bytes -= entryBytes(club.inbox.shift());
    }
    return id;
}


const expired = (entry, now) => {
    const at = Date.parse(entry.at);
    return !Number.isFinite(at) || now - at > INBOX_KEEP_MS;
};


// The entry `id`, or null. With `now`, an entry older than INBOX_KEEP_MS is gone too (the sweep has
// not removed it yet).
export function entryOf(club, id, now = null) {
    const entry = typeof id === 'string' ? club.inbox.find(e => e.id === id) ?? null : null;
    return entry !== null && now !== null && expired(entry, now) ? null : entry;
}


// Removes an entry nobody wants. The log gets the rider count, never names (spec §6.8).
export function discardEntry(club, id, now) {
    const entry = entryOf(club, id, now);
    if (entry === null) {
        throw new ClubError('entry-gone');
    }
    club.inbox = club.inbox.filter(e => e !== entry);
    const n = Object.keys(entry.json?.riders ?? {}).length;
    addLog(club, {at: iso(now), what: 'discard', team: entry.team, label: n === 1 ? '1 rider' : `${n} riders`});
    return entry;
}


// Stores an entry as a version (uploadSheet's rules and errors) and removes it, in one change: a
// refusal throws before the entry is touched, and the store's change drops the whole clone.
export function storeEntry(club, id, {slug, as, live, date, type, pinnedEventId, base}, {now, newId}) {
    const entry = entryOf(club, id, now);
    if (entry === null) {
        throw new ClubError('entry-gone');
    }
    const result = uploadSheet(club, {
        slug, json: entry.json, text: entry.text, via: entry.via ?? entry.source, as, live, date, type, pinnedEventId, base,
    }, {now, newId});
    club.inbox = club.inbox.filter(e => e.id !== id);
    return {...result, entry};
}


// How many entries sweepInbox would remove (only reads, for the sweep's dry check).
export function staleEntries(club, now) {
    return club.inbox.filter(e => expired(e, now)).length;
}


// Drops the entries older than INBOX_KEEP_MS, or with an `at` that does not parse. No version bump
// and no log: nobody sees an entry on a team page. Returns how many went.
export function sweepInbox(club, now) {
    const before = club.inbox.length;
    club.inbox = club.inbox.filter(e => !expired(e, now));
    return before - club.inbox.length;
}
