// Club operations (spec §3–§5.2): teams, sheet uploads with their defaults, the live pointer and its
// Undo, rider removal, the sweep and the caps (Restore went with the team cockpit, team cockpit spec
// §4.1: an old copy keeps the number of the version it copied, no new version gets one). Pure and
// synchronous: every function changes the club object it is given (the store passes a clone), and
// the clock is always passed in.
import {CID_RE, SHEET_RE, ZWIFT_RE, isSlug, isEventId, cleanName, freeSlug, nameKey} from './ids.mjs';
import {isDate, isWeekday, HHMM_RE, localDate, localDay, zonedToUtc, addDays, isZone} from './time.mjs';
import {plannedStart, teamWeekday, raceStart, raceOver, raceTime, STILL_TO_RACE_MS} from './select.mjs';
import {toRaces, tidyRaces, emptyRace, raceOf, raceOfSheet, racesOf} from './races.mjs';
import {t} from './pages.mjs';
import {
    isUsed, SHARED_SHARE, plansOf, planOfId, planLabel, typeKey, rememberType, previousVersion, freeVersionId,
} from './plans.mjs';
import {normalizePlan, stripSheet, PlanError, RAW_NAME_MAX, decodeEntities} from '../pages/src/engine/plan.mjs';

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
// The inbox (coordinator, 19 Nov 2026: received plans wait in a list, so 10 became 20 entries and
// the bytes grew with them; one entry still at most ENTRY_BYTES)
export const INBOX_MAX = 20;              // entries per club
export const INBOX_BYTES = 655360;        // 640 KB: the sum of the entries' {json, text, warnings}
export const ENTRY_BYTES = 327680;        // 320 KB: one entry's {json, text, warnings}
export const INBOX_KEEP_MS = 86400000;    // an uploaded entry nobody stored goes after 24 h
export const RECEIVE_KEEP_MS = 7 * 86400000;   // a received one (ZwiftGopher) after 7 days, as its link
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


// A page drawn with another version of the team is refused (`changed`); null skips the check.
function checkVersion(team, version) {
    if (version !== null && Number(version) !== team.version) {
        throw new ClubError('changed');
    }
}


// The race of team `slug` on `date`, else not-found.
function raceAt(club, slug, date) {
    const race = raceOf(club, slug, date);
    if (race === null) {
        throw new ClubError('not-found');
    }
    return race;
}


// A race that is over (races spec §2: from S + 2 h) takes no change: race-done, with its day.
function checkStillToRace(club, slug, date, now) {
    if (raceOver(club, slug, date, now)) {
        throw new ClubError('race-done', {day: raceDay(club, date)});
    }
}


// Is a race on `date` at local `time` ('HH:MM', or null: none) over at `now`: from its S + 2 h;
// without a time once `date` has passed in the club's zone (select.mjs raceOver).
function overAt(club, date, time, now) {
    return time === null ? date < localDate(now, club.tz) : now > zonedToUtc(date, time, club.tz) + STILL_TO_RACE_MS;
}


const isBlank = v => v == null || (typeof v === 'string' && v.trim() === '');
const validTime = v => typeof v === 'string' && HHMM_RE.test(v);


// The start a race of `team` stores for a posted time (setRace): a weekly team's blank is null (the
// team's time), and so is an 'HH:MM' equal to the team's start; another 'HH:MM' is stored. A special
// team needs an 'HH:MM'. Anything else is bad-start.
function storedStart(team, posted) {
    if (team.kind === 'special' ? !validTime(posted) : !isBlank(posted) && !validTime(posted)) {
        throw new ClubError('bad-start');
    }
    return isBlank(posted) || (team.kind !== 'special' && posted === team.start) ? null : posted;
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


// The conversion of a club stored by 0.3 to races (races.mjs toRaces), plus one club log entry per
// event link it dropped: 'race-link-dropped' (another plan of the race decided it) or
// 'race-link-newer-dropped' (a newer version of the live plan had it), label '5123456 (Tue 24 Nov)'.
// Never throws on odd data: a zone it cannot use writes the date, and a log that is no list gets no
// entry. Returns true when it changed the club.
export function convertClub(club, now = Date.now()) {
    const {changed, dropped} = toRaces(club);
    if (Array.isArray(club?.log)) {
        for (const {team, date, eventId, newer} of dropped) {
            const day = isZone(club.tz) ? raceDay(club, date) : date;
            addLog(club, {at: iso(now), what: newer ? 'race-link-newer-dropped' : 'race-link-dropped', team, label: `${eventId} (${day})`});
        }
    }
    return changed;
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
        teams: {}, sheets: {}, log: [], inbox: [],
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


// The unit the captain pages show pull targets in (team cockpit spec §7): 'wkg' (also when absent)
// or 'watts'. Additive: a club stored without it reads as 'wkg'. The log names the unit; nothing
// happens when it stays. Only the captain pages read it, never the mod or the rider API.
export const TARGET_UNITS = ['wkg', 'watts'];

export function setTargetUnit(club, unit, now) {
    if (!TARGET_UNITS.includes(unit)) {
        throw new TypeError('bad target unit');
    }
    if ((club.targetUnit ?? 'wkg') === unit) {
        return;
    }
    club.targetUnit = unit;
    addLog(club, {at: iso(now), what: 'unit', label: unit});
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


// The race rhythm's checks (setKind, addTeam): a weekly team needs its weekday 1-7 (races spec §4c:
// there is no club's race day to follow); a special team has none, so its weekday is null or 1-7
// (what the form sent along) and is not stored. Returns the weekday to store.
function checkKind(kind, weekday) {
    if (kind !== 'weekly' && kind !== 'special') {
        throw new ClubError('bad-kind');
    }
    if (kind === 'weekly' ? !isWeekday(weekday) : weekday !== null && !isWeekday(weekday)) {
        throw new ClubError('bad-weekday');
    }
    return kind === 'special' ? null : weekday;
}


// The slug is unique across all clubs and never reused: `slugTaken` answers for the store
// (other clubs, retired slugs), this club's own teams are checked here. `kind` and `weekday` as
// setKind takes them (user, 19 Nov 2026: Add a team asks for the race rhythm), weekly on Thursday
// by default; a special team gets its start time with each plan, so it ignores `start` and has
// none, and it has no weekday.
export function addTeam(club, {name, start = null, kind = 'weekly', weekday = 4}, {slugTaken, now}) {
    if (Object.keys(club.teams).length >= MAX_TEAMS) {
        throw new ClubError('cap-teams', {max: MAX_TEAMS});
    }
    const clean = checkTeamName(name);
    const day = checkKind(kind, weekday);
    const own = kind === 'special' ? null : start;
    checkStart(own);
    const slug = freeSlug(clean, s => Object.hasOwn(club.teams, s) || slugTaken(s));
    club.teams[slug] = {name: clean, start: own, version: 1, changedAt: iso(now), kind, weekday: day, races: {}};
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


// Weekly (on `weekday` 1-7) or special (plan versions spec §3.1, user 17 Nov 2026; a special team's
// weekday is null). The log label is "weekly, Thursday" (the day it then races on) or "special".
// The team's start time stays as it is, and so do its races' own start times: a special team's
// plans have their own (startOf), and a team made weekly again races at it.
export function setKind(club, slug, {kind, weekday}, now) {
    const team = teamOf(club, slug);
    const day = checkKind(kind, weekday);
    team.kind = kind;
    team.weekday = day;
    bump(team, now);
    const label = kind === 'special' ? 'special' : `weekly, ${t(`weekday-${teamWeekday(club, slug)}`)}`;
    addLog(club, {at: iso(now), what: 'team-kind', team: slug, label});
}


// The race day and time of the team settings in one change (user, 22 Nov 2026): setKind, and for a
// weekly team setStart with `start` (null clears it). A special team ignores `start`, even one that
// is no time: its stored start stays, as setKind keeps it. Each part applies only when it changes
// something, so a save of the start alone bumps and logs only the start. Everything is checked
// first: a refusal changes nothing. Returns {rhythm, start}: whether each changed.
export function setRhythm(club, slug, {kind, weekday, start}, now) {
    const team = teamOf(club, slug);
    const day = checkKind(kind, weekday);
    const weekly = kind === 'weekly';
    if (weekly) {
        checkStart(start);
    }
    const rhythm = team.kind !== kind || team.weekday !== day;
    const moved = weekly && start !== (team.start ?? null);
    if (rhythm) {
        setKind(club, slug, {kind, weekday}, now);
    }
    if (moved) {
        setStart(club, slug, start, now);
    }
    return {rhythm, start: moved};
}


// Removes the team, its sheets and the inbox entries waiting for it (uploads and received plans
// alike: no page would show them again, the slug is retired, and received ones would fill the inbox
// for 7 days). Returns the slug, for the store to retire.
export function deleteTeam(club, slug, now) {
    const team = teamOf(club, slug);
    for (const [id] of teamSheets(club, slug)) {
        delete club.sheets[id];
    }
    club.inbox = club.inbox.filter(e => e.team !== slug);
    delete club.teams[slug];
    addLog(club, {at: iso(now), what: 'team-delete', team: slug, label: team.name});
    return slug;
}


// Does an upload for `slug` look like another team's plan (spec §5.2, the Store preview and flash)? `json` is the
// planner JSON, `riderIds` its riders' Zwift IDs. The first that applies:
// - {kind: 'name', team}: the JSON's team name has the name key of another team's name or of the
//   planner name of one of its versions (`jsonName`; labels start with the team name and would match
//   by accident). A name without a key (e.g. one character or non-Latin) never matches;
// - {kind: 'overlap', team, shared, total}: another team's live version lists at least 60 % of these
//   riders as riders, and more of them than this team's live version does (the most shared wins; a
//   team's count is the most that any of its races' live versions still served at `now` shares:
//   isUsed, so a race already raced, which keeps its live plan until the sweep, never counts);
// - null.
export function teamHint(club, slug, json, riderIds, now) {
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
    // a team's: the most that any of its races' live versions still served shares
    const sharedWith = s => {
        let most = 0;
        for (const [, race] of Object.hasOwn(club.teams, s) ? racesOf(club, s) : []) {
            const id = race.live;
            const sheet = typeof id === 'string' && Object.hasOwn(club.sheets, id) ? club.sheets[id] : null;
            const riders = sheet !== null && !isUsed(club, sheet, now) ? sheet.json?.riders : null;
            const shared = riders && typeof riders === 'object' ? ids.filter(a => Object.hasOwn(riders, a)).length : 0;
            most = Math.max(most, shared);
        }
        return most;
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


// ZwiftGopher's share link of a plan (the export's plan.share_link). Its #t= value is the whole plan
// encoded (base64url, about 3 KB: riders with FTP, height and power profiles), so it is captain-only
// data (user, 19 Nov 2026): kept only when the link is exactly https://zwiftgopher.com/TTT/#t=<value>
// with <value> of base64url characters and the link at most ZG_LINK_MAX long; of it only <value>, as
// zgShare on the inbox entry and the stored version, never inside the plan's json or text. The rider
// answers (api.mjs planRecord) never carry it, the archive beside recordings never keeps it (logs.mjs
// ARCHIVED), and Remove a rider deletes it from every version and entry that lists the rider (the
// encoded plan cannot be edited). "Plan on ZwiftGopher" and "Edit on ZwiftGopher" append #t=<value>,
// so the planner opens with that plan loaded. Anything else is dropped without a word.
export const ZG_LINK_PREFIX = 'https://zwiftgopher.com/TTT/#t=';
export const ZG_LINK_MAX = 16384;
const SHARE_RE = /^[A-Za-z0-9_-]+$/;

export const isShare = v => typeof v === 'string' && v.length > 0 && v.length <= ZG_LINK_MAX - ZG_LINK_PREFIX.length && SHARE_RE.test(v);

export function shareOf(json) {
    const link = json?.plan?.share_link;
    if (typeof link !== 'string' || link.length > ZG_LINK_MAX || !link.startsWith(ZG_LINK_PREFIX)) {
        return null;
    }
    const value = link.slice(ZG_LINK_PREFIX.length);
    return isShare(value) ? value : null;
}


// The content checks of an arriving plan (json and text as importFiles gives them), in a fixed order
// so the page shows the first problem: {json, text} stripped by stripSheet, the normalized plan, and
// the share value (shareOf, or null), read before the strip drops it.
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
    return {json: stripped.json, text: stripped.text, plan, zgShare: shareOf(json)};
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


const VIAS = ['file', 'paste', 'import', 'receive', 'zwiftgopher'];


// The cap of versions per plan for a new version of `plan` (labelled `label`): with MAX_VERSIONS
// stored, the lowest version that is not live goes. {dropped, dropIds}.
function versionCap(plan, label) {
    if (plan.versions.length < MAX_VERSIONS) {
        return {dropped: null, dropIds: []};
    }
    const [vid, v] = plan.versions.find(([i]) => i !== plan.live);
    return {dropped: {kind: 'version', n: v.n, label}, dropIds: [vid]};
}


// The start time a Store of team `slug`'s plan for `date` gives its race (races spec §1; user, 19
// Nov 2026: the time belongs to the race, and the newest upload sets it). A special team: the posted
// 'HH:MM'; a blank one keeps the race's start (raceStart: the stored one, else the team's), and is
// refused without one (bad-start). A weekly team: a blank keeps the race's stored start (a new
// race: null, the team's time); an 'HH:MM' equal to the team's start stores null, another one is
// stored. A posted value that is no time is bad-start for both. `own` is the plan the Store makes a
// version of, or null. {stored, start, moved}: `stored` race.start, `start` the race's time then
// ('HH:MM', or null without any), `moved` {date, start, was, others} when the date had plans already
// and their start changes (raceStart before and after; `was` null when they had none), `others` the
// labels of that date's other plans, which move with it; else null.
function storeStart(club, slug, date, posted, own) {
    const team = club.teams[slug];
    const current = raceStart(club, slug, date);
    let stored;
    if (!isBlank(posted)) {
        stored = storedStart(team, posted);
    } else if (team.kind !== 'special') {
        stored = raceOf(club, slug, date)?.start ?? null;
    } else if (current === null) {
        throw new ClubError('bad-start');
    } else {
        stored = current;
    }
    const start = raceTime(team, stored);
    const plans = plansOf(club, slug).filter(p => p.date === date);
    if (!plans.length || start === current) {
        return {stored, start, moved: null};
    }
    const others = plans.filter(p => own === null || p.id !== own.id).map(p => p.label).sort();
    return {stored, start, moved: {date, start, was: current, others}};
}


// Stores one upload as a version: of a new plan (`as` 'new') or of the plan `as` names by any of its
// ids. Without `as` it is refused (pick-plan: the Store form never stores a plan the captain did
// not see chosen); only `live` true makes it live, in its own race only (races spec §1: a live plan
// per race). A version always keeps its plan's type, whatever `type` says (Rename is the only way
// to change it), and the date is the plan's; `type` counts for a new plan only. A version stored
// live, or made live by this Store (the same file again), gets `liveAt`, the time it last became
// its race's live version. A race that is over takes no version (plan-used). The race of the date
// (team.races[date]) is made with its first plan. Every Store sets the race's start time from `start` (storeStart; the same
// content stores no version, but a new time still applies); a new plan, and a Store with a time,
// is refused when the race would be over at it (race-over-time with a posted time, else
// race-over). A Store with an event link (`pinnedEventId`) sets the race's link and clears the event
// it learned; so does a new start time of a race with plans (spec §7, the link stays); one without
// leaves the race's link as it is. Versions carry no event field. Checks run in a fixed order, so the
// page shows the first problem. Returns {id, planId, n, prev, live, created, same, dropped,
// changedAt, plan, startMoved, linkMoved}; `startMoved` is storeStart's `moved`, `linkMoved` {date,
// id, was, others} when the date had plans and the link differs from the race's (`others` the
// labels of the date's other plans, which share it), else null.
export function uploadSheet(club, input, {now, newId}) {
    const {slug, base} = input;
    const team = teamOf(club, slug);
    const pinnedEventId = eventIdOrNull(input.pinnedEventId);
    const {json, text, plan, zgShare: own} = checkPlan(input.json, input.text ?? null);
    // an entry's json is stripped already: its share value comes with it (input.zgShare)
    const zgShare = isShare(input.zgShare) ? input.zgShare : own;

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
        if (raceOver(club, slug, date, now)) {
            throw new ClubError('plan-used', {label: target.label});
        }
    } else {
        date = input.date;
        if (!isDate(date)) {
            throw new ClubError('bad-date');
        }
        // a race that is over takes no new plan, whatever time is posted: a later one would move
        // the race and serve its raced plan again (races spec §2)
        if (raceOf(club, slug, date) !== null && raceOver(club, slug, date, now)) {
            throw new ClubError('race-over', {date});
        }
    }
    const {stored, start, moved: startMoved} = storeStart(club, slug, date, input.start, target);
    // a new plan, and a Store with a time: never a race that is over at it (an AM/PM slip would end
    // the race at once)
    const posted = !isBlank(input.start);
    // (the team's own time, which the form prefills for a race on the rhythm, is no time the captain
    // typed: stored null and the race's time now, so it ends a race that is over with "choose a later
    // date", not "check the start time"; the check itself is the same for every posted time)
    const untouched = stored === null && start === raceStart(club, slug, date);
    if ((target === null || posted) && overAt(club, date, start, now)) {
        throw posted && !untouched ? new ClubError('race-over-time', {date, time: start}) : new ClubError('race-over', {date});
    }

    const type = typeFor(club, slug, {as: target === null ? 'new' : target.id, type: target === null ? input.type : undefined, date}, now);
    const label = planLabel(team.name, type);
    const changedAt = Number(base) !== team.version ? team.changedAt : null;
    const before = raceOf(club, slug, date);
    // the race's time changed: set at every Store, also one that stores no version
    const newStart = before !== null && raceStart(club, slug, date) !== start;
    const datePlans = plansOf(club, slug).filter(p => p.date === date);
    const wasLink = before?.pinnedEventId ?? null;
    const linkMoved = pinnedEventId !== null && datePlans.length > 0 && wasLink !== pinnedEventId
        ? {date, id: pinnedEventId, was: wasLink, others: datePlans.filter(p => target === null || p.id !== target.id).map(p => p.label).sort()}
        : null;
    // the race of the date, made with its first plan (after every check: a refusal leaves no race
    // without a plan); then its start time and event link. True when the link changed.
    const fileRace = () => {
        const race = raceOf(club, slug, date) ?? (team.races[date] = emptyRace());
        race.start = stored;
        if (startMoved !== null) {
            race.eventId = null;
            race.boundAt = null;
        }
        if (pinnedEventId !== null && race.pinnedEventId !== pinnedEventId) {
            race.pinnedEventId = pinnedEventId;
            race.eventId = null;
            race.boundAt = null;
            return true;
        }
        return false;
    };

    // The same content (json, text and type) as the plan's newest version stores nothing; the live
    // box still applies, and so does a new start time or event link (they belong to the race).
    if (target !== null) {
        const [nid, newest] = target.newest;
        if (JSON.stringify(newest.json) === JSON.stringify(json) && JSON.stringify(newest.text ?? null) === JSON.stringify(text)
            && (newest.type ?? null) === type) {
            const newLink = fileRace();
            const race = raceOf(club, slug, date);
            const prevLive = race.live;
            if (live === true && prevLive !== nid) {
                race.live = nid;
                newest.liveAt = iso(now);
                changed(club, slug, team, now, 'live', `${newest.label} v${newest.n}`);
            }
            if (newStart) {
                changed(club, slug, team, now, 'race-start', `${raceDay(club, date)} ${start}`);
            }
            if (newLink) {
                changed(club, slug, team, now, 'race-link', `${raceDay(club, date)} · ${pinnedEventId}`);
            }
            if (race.live !== prevLive) {
                // Store and make live offers the same Undo as Make live (S17, UI panel wave 2)
                rememberLive(club, team, race, prevLive, true, now);
            }
            return {
                id: nid, planId: target.id, n: newest.n, prev: previousVersion(club, nid)?.[0] ?? null,
                live: race.live === nid, created: false, same: true, dropped: null, changedAt, plan, startMoved, linkMoved,
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
        ({dropped, dropIds} = versionCap(target, label));
    }

    fileRace();
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
        plan: planId, n, at: iso(now), jsonName: nameKey(input.json?.team?.name), type, recSig: plan.sig,
        ...(zgShare === null ? {} : {zgShare}),
    };
    const race = raceOf(club, slug, date);
    const prevLive = race.live;
    if (live === true) {
        race.live = id;
        club.sheets[id].liveAt = iso(now);
    }
    // a dropped version's live pointer, a dropped plan's race
    tidyRaces(club, slug);
    rememberType(team, type);
    changed(club, slug, team, now, 'upload', `${label} v${n}`);
    if (live === true && prevLive !== id) {
        // Store and make live offers the same Undo as Make live (S17, UI panel wave 2)
        rememberLive(club, team, race, prevLive, true, now);
    }
    return {
        id, planId, n, prev: target === null ? null : target.newest[0], live: race.live === id,
        created: target === null, same: false, dropped, changedAt, plan, startMoved, linkMoved,
    };
}


// Make live of version `id`: the live plan of its own race (races spec §1), and of no other race;
// the team's other races keep theirs. Upload times stay. `version` is the team's version the page
// was drawn with: another one is refused (`changed`), so a page drawn before another captain's
// change cannot replace a newer live plan (UI panel, 19 Nov 2026); null (a page from before the
// check) skips it. A race that is over is refused (race-done). With `undo` (the default) the team
// keeps what Undo needs (rememberLive); the Undo itself passes false. Checks: the team, `version`,
// the version (`not-found`), its race over.
export function makeLive(club, slug, id, now, {version = null, undo = true} = {}) {
    const team = teamOf(club, slug);
    checkVersion(team, version);
    const {sheet} = sheetOf(club, slug, id);
    const race = raceAt(club, slug, sheet.date);
    checkStillToRace(club, slug, sheet.date, now);
    const prev = race.live;
    race.live = id;
    if (prev !== id) {
        sheet.liveAt = iso(now);
    }
    changed(club, slug, team, now, 'live', `${sheet.label} v${sheet.n}`);
    rememberLive(club, team, race, prev, undo, now);
}


// What Undo of a change of a race's live plan needs (UI panel wave 2, team-view.mjs undoOffer), kept
// on the team after the change bumped its version: team.liveBefore = {id, version, at}, the version
// that was live in that race before and the team's version right after the change (one record per
// team: Undo reads the race of `id`). Any later change of the team bumps its version, so Undo is
// offered only while nothing changed since. Nothing (and an older record goes) when the race had no
// live version before, it is gone, or `undo` is false. Additive: a club stored without it loads
// unchanged.
function rememberLive(club, team, race, prev, undo, now) {
    if (undo && race !== null && typeof prev === 'string' && prev !== race.live && Object.hasOwn(club.sheets, prev)) {
        team.liveBefore = {id: prev, version: team.version, at: iso(now)};
    } else {
        delete team.liveBefore;
    }
}


// The versions of the plan that version `id` belongs to: [[id, sheet], …], lowest n first.
function planVersions(club, slug, id) {
    const {sheet} = sheetOf(club, slug, id);
    return plansOf(club, slug).find(p => p.id === sheet.plan);
}


// Deletes the whole plan of version `id`, every version of it, for good (spec §8: no Undo; the
// confirm says so). The log names the plan's label. `version` as for makeLive (S7: a page drawn
// before a newer upload cannot delete it unseen); null skips the check.
export function deleteSheet(club, slug, id, now, {version = null} = {}) {
    const team = teamOf(club, slug);
    if (version !== null && Number(version) !== team.version) {
        throw new ClubError('changed');
    }
    const p = planVersions(club, slug, id);
    for (const [vid] of p.versions) {
        delete club.sheets[vid];
    }
    // its race loses the live pointer, and goes with its last plan
    tidyRaces(club, slug);
    changed(club, slug, team, now, 'delete', p.label);
}


// Removes the event link of the race of version `id` (setRaceEvent with null; races spec §1: the
// link is the race's).
export function unpin(club, slug, id, now) {
    const {sheet} = sheetOf(club, slug, id);
    setRaceEvent(club, slug, sheet.date, null, now);
}


// The event link of team `slug`'s race on `date` (races spec §4 "Race ⋯"): a number sets it and
// clears the event the race learned (log 'race-link', label 'Thu 19 Nov · 5123456'); null removes it
// (log 'unpin', label 'Thu 19 Nov'). The link the race has already changes nothing (no bump, no
// log). Checks: the team, `version` (`changed`; null skips), the race (`not-found`), the race over
// (race-done). A value that is no event id is a caller's bug (TypeError, as uploadSheet's). {was}:
// the link before.
export function setRaceEvent(club, slug, date, eventId, now, {version = null} = {}) {
    const team = teamOf(club, slug);
    checkVersion(team, version);
    const race = raceAt(club, slug, date);
    checkStillToRace(club, slug, date, now);
    const id = eventIdOrNull(eventId);
    const was = race.pinnedEventId ?? null;
    if (id === was) {
        return {was};
    }
    race.pinnedEventId = id;
    if (id !== null) {
        race.eventId = null;
        race.boundAt = null;
        changed(club, slug, team, now, 'race-link', `${raceDay(club, date)} · ${id}`);
    } else {
        changed(club, slug, team, now, 'unpin', raceDay(club, date));
    }
    return {was};
}


// Changes the date and the start time of team `slug`'s race on `date` (races spec §4 "Race ⋯"):
// the race moves to `to` with all its plans (every version of the team on `date` gets `date: to`),
// keeps its live plan and its event link, and the event it learned goes when the date or the time
// changed (spec §7). `start` as the race stores it (storedStart: a weekly team's blank or the team's
// own time is null). Checks, in this order: the team, `version` (`changed`; null skips), the race
// (`not-found`), the race over (race-done), `to` (bad-date), another race of the team on `to`
// (race-taken), `start` (bad-start), the race over at its new date and time (race-over-time;
// race-over without any time). Without a change of date or time nothing happens: no bump, no log. Else one bump and a
// log entry 'race-move', label 'Thu 19 Nov 19:30 → Sat 21 Nov 17:00' ('–' for no time). Returns
// {date, start, was: {date, start}, plans}: the race's date and stored start after and before, and
// how many plans moved with it.
export function setRace(club, slug, date, {to, start}, now, {version = null} = {}) {
    const team = teamOf(club, slug);
    checkVersion(team, version);
    const race = raceAt(club, slug, date);
    checkStillToRace(club, slug, date, now);
    if (!isDate(to)) {
        throw new ClubError('bad-date');
    }
    if (to !== date && raceOf(club, slug, to) !== null) {
        throw new ClubError('race-taken', {team: team.name, day: raceDay(club, to)});
    }
    const stored = storedStart(team, start);
    const time = raceTime(team, stored);
    if (overAt(club, to, time, now)) {
        throw time === null ? new ClubError('race-over', {date: to}) : new ClubError('race-over-time', {date: to, time});
    }
    const was = {date, start: race.start};
    const plans = plansOf(club, slug).filter(p => p.date === date).length;
    const oldTime = raceStart(club, slug, date);
    if (to === date && time === oldTime) {
        // the same date and time: no change for riders, no bump, no log (a race that stored the
        // team's own time explicitly stores none from now on)
        race.start = stored;
        return {date, start: stored, was, plans};
    }
    delete team.races[date];
    team.races[to] = race;
    race.start = stored;
    if (to !== date || time !== oldTime) {
        race.eventId = null;
        race.boundAt = null;
    }
    for (const [, sheet] of teamSheets(club, slug)) {
        if (sheet.date === date) {
            sheet.date = to;
        }
    }
    changed(club, slug, team, now, 'race-move', `${raceDay(club, date)} ${oldTime ?? '–'} → ${raceDay(club, to)} ${time ?? '–'}`);
    return {date: to, start: stored, was, plans};
}


// Rename (races spec §4 "Plan ⋯", §7): plan `plan` (any of its ids) gets type `type` (typeFor:
// unique within its race, blank is none, and at most one plan of the race has none) on every one of
// its versions, and the label team name + type. Checks: the team, `version` (`changed`; null
// skips), the plan and its race (`not-found`), its race over (race-done), then the type. An unchanged type
// changes nothing; else one bump, rememberType and a log entry 'plan-rename', label "'Rollers' →
// 'Rollers · tempo'". {label, was}: the plan's label after and before.
export function renamePlan(club, slug, plan, type, now, {version = null} = {}) {
    const team = teamOf(club, slug);
    checkVersion(team, version);
    const p = typeof plan === 'string' && SHEET_RE.test(plan) ? planOfId(club, slug, plan) : null;
    if (p === null) {
        throw new ClubError('not-found');
    }
    raceAt(club, slug, p.date);
    checkStillToRace(club, slug, p.date, now);
    const clean = typeFor(club, slug, {as: p.id, type: type === undefined ? null : type, date: p.date}, now);
    const label = planLabel(team.name, clean);
    const was = p.label;
    if (p.versions.every(([, v]) => (v.type ?? null) === clean && v.label === label)) {
        return {label, was};
    }
    for (const [, v] of p.versions) {
        v.type = clean;
        v.label = label;
    }
    rememberType(team, clean);
    changed(club, slug, team, now, 'plan-rename', `'${was}' → '${label}'`);
    return {label, was};
}


// A rider's check on version `id` learned its race's event (races spec §3). Only a race with neither
// a learned nor a pinned id learns. No version bump, so a check never makes a captain's open page
// stale; no log entry.
export function learnEvent(club, id, eventId, now) {
    if (typeof id !== 'string' || !SHEET_RE.test(id) || !Object.hasOwn(club.sheets, id)) {
        throw new ClubError('not-found');
    }
    const race = raceOfSheet(club, club.sheets[id]);
    if (race === null || !isEventId(eventId) || race.eventId != null || race.pinnedEventId != null) {
        return false;
    }
    race.eventId = Number(eventId);
    race.boundAt = iso(now);
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


// Whether a version or inbox entry was stored before `before` (epoch ms): its `at`; one without a
// readable `at` counts as before.
export const storedBefore = (x, before) => !(Date.parse(x?.at) >= before);

// True when a version or inbox entry stored before `before` lists the Zwift ID (Remove a rider
// applied again after a restore, erasures.mjs).
export function clubListsBefore(club, athleteId, before) {
    const aid = String(athleteId);
    return [...Object.values(club.sheets), ...club.inbox].some(x => lists(x, aid) && storedBefore(x, before));
}


// Takes the rider out of every version of the club (riders, bench and his text row) and out of the
// inbox entries. A version left without riders is deleted. A changed version gets a new sig, keeps its recSig and adds
// the old sig to `pastSigs`. Each team it
// touched gets a new version. Returns how many plans changed; the log entry names no one.
// `before` (epoch ms): only versions and entries stored before it (applied again after a restore,
// erasures.mjs: what was stored later lists him again on purpose).
export function removeRider(club, athleteId, now, {before = Infinity} = {}) {
    const aid = String(athleteId);
    if (!ZWIFT_RE.test(aid)) {
        return 0;
    }
    const teams = new Set();
    const plans = new Set();
    for (const [id, sheet] of Object.entries(club.sheets)) {
        if (!lists(sheet, aid) || !storedBefore(sheet, before)) {
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
            continue;
        }
        // stripSheet keeps only the text rows still matched to a rider.
        const stripped = stripSheet(json, sheet.text);
        const {plan} = normalizePlan(stripped.json, stripped.text);
        // pastSigs: every earlier sig, so a recording made in between still finds the version
        const pastSigs = [...(Array.isArray(sheet.pastSigs) ? sheet.pastSigs : []), sheet.sig];
        // its ZwiftGopher link encodes the whole plan, the rider included, and cannot be edited: it goes
        const {zgShare: gone, ...rest} = sheet;
        club.sheets[id] = {...rest, json: stripped.json, text: stripped.text, sig: plan.sig, pastSigs};
    }
    // The inbox too: his row goes from every entry that lists him, an entry left without riders is
    // dropped, and a touched entry loses all its warnings (they may name him).
    club.inbox = club.inbox.flatMap(entry => {
        if (!lists(entry, aid) || !storedBefore(entry, before)) {
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
        const {zgShare: gone, ...rest} = entry;
        return [{...rest, json: stripped.json, text: stripped.text, warnings: [], warningsMore: 0}];
    });
    // a deleted version's live pointer, the race of a date left without plans
    tidyRaces(club);
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
        delete club.sheets[id];
    }
    // the swept plans' races go with them (KEEP_DAYS, races spec §2)
    tidyRaces(club);
    return ids.length;
}



// ---- the inbox (plan versions spec §4.1, §5) ----
// A plan that came in and waits for its Store (the Store form in the team page): {id, at, source, team, forPlan, via, json, text,
// warnings, warningsMore}, `json` and `text` as checkPlan stripped them (`text` null on every entry
// made since the text upload went, races Task 7; an entry from before keeps its own; one from before
// the team cockpit may carry `fromPlan`, read by nothing now); `forDate` the
// race the upload was made for (the race ⋯'s "Upload a file for this race", a hole's link): the
// Store form's default race while it is not over (absent on every other entry). Not part of any team's state: no version
// bump, no log (but discard), and an entry nobody stores goes after keepOf (24 h, a received one 7 days).

// the share value counts too (up to 16 KB)
const entryBytes = e => Buffer.byteLength(JSON.stringify({json: e.json, text: e.text, warnings: e.warnings, zgShare: e.zgShare}));


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


// Where an entry came from: an upload, a push from ZwiftGopher (receive, push.mjs); /import later.
const SOURCES = ['upload', 'import', 'receive'];


// Adds an entry and returns its id. `source` must be one of SOURCES (else an Error: a caller's bug).
// `team` is kept only when it is a team of the club, `via` only when it is one of VIAS, `forPlan`
// only when it names a plan of `team`; else each is null. `forDate` only when it passes isDate. An entry that alone is over ENTRY_BYTES is
// refused (cap-bytes; a checked plan is at most MAX_SHEET_BYTES plus its warnings, far below).
// Then the oldest entries go until at most INBOX_MAX are left and they fit INBOX_BYTES (the new one
// stays).
export function addEntry(club, {source, team = null, forPlan = null, forDate = null, via = null, json, text, warnings = [], zgShare = null}, {now, newId}) {
    if (!SOURCES.includes(source)) {
        throw new Error(`unknown entry source ${source}`);
    }
    const slug = typeof team === 'string' && isSlug(team) && Object.hasOwn(club.teams, team) ? team : null;
    const kept = cleanWarnings(warnings);
    const entry = {
        id: null, at: iso(now), source, team: slug, forPlan: null, via: VIAS.includes(via) ? via : null,
        json, text, warnings: kept.warnings, warningsMore: kept.more,
        ...(isShare(zgShare) ? {zgShare} : {}),
    };
    if (entryBytes(entry) > ENTRY_BYTES) {
        throw new ClubError('cap-bytes', {max: ENTRY_BYTES / 1024});
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
    club.inbox.push({
        ...entry, id, forPlan: plan === null ? null : forPlan,
        ...(isDate(forDate) ? {forDate} : {}),
    });
    let bytes = club.inbox.reduce((n, e) => n + entryBytes(e), 0);
    while (club.inbox.length > 1 && (club.inbox.length > INBOX_MAX || bytes > INBOX_BYTES)) {
        bytes -= entryBytes(club.inbox.shift());
    }
    return id;
}


// How long an entry waits: a received one RECEIVE_KEEP_MS, any other INBOX_KEEP_MS.
export const keepOf = entry => (entry.source === 'receive' ? RECEIVE_KEEP_MS : INBOX_KEEP_MS);

const expired = (entry, now) => {
    const at = Date.parse(entry.at);
    return !Number.isFinite(at) || now - at > keepOf(entry);
};


// The entry `id`, or null. With `now`, an entry older than keepOf allows is gone too (the sweep has
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
export function storeEntry(club, id, {slug, as, live, date, start, type, pinnedEventId, base}, {now, newId}) {
    const entry = entryOf(club, id, now);
    if (entry === null) {
        throw new ClubError('entry-gone');
    }
    const result = uploadSheet(club, {
        slug, json: entry.json, text: entry.text, via: entry.via ?? entry.source, as, live, date, start, type, pinnedEventId, base,
        zgShare: entry.zgShare ?? null,
    }, {now, newId});
    club.inbox = club.inbox.filter(e => e.id !== id);
    return {...result, entry};
}


// A plan pushed from outside (POST /api/v3/push, push.mjs) as an entry of `team`: the stale entries
// go first (sweepInbox), then, unlike an upload, nothing is pushed out to make room: an inbox with
// INBOX_MAX entries, or one the new entry would take over INBOX_BYTES, refuses it (inbox-full), so a
// link holder cannot flush out what the captain has not stored yet. Else addEntry's id.
export function receiveEntry(club, {team, via, json, text, warnings = [], zgShare = null}, {now, newId}) {
    // the team may have gone since its token was checked (deleted while the body came in)
    teamOf(club, team);
    sweepInbox(club, now);
    const add = entryBytes({json, text, warnings: cleanWarnings(warnings).warnings, zgShare: isShare(zgShare) ? zgShare : undefined});
    const bytes = club.inbox.reduce((n, e) => n + entryBytes(e), 0);
    if (club.inbox.length >= INBOX_MAX || bytes + add > INBOX_BYTES) {
        throw new ClubError('inbox-full', {max: INBOX_MAX});
    }
    return addEntry(club, {source: 'receive', team, via, json, text, warnings, zgShare}, {now, newId});
}


// The received entries waiting for team `slug`, newest first (the team page's list, the rows' count).
export function receivedFor(club, slug, now) {
    // the inbox is in arrival order, so the newest first is that order turned round (also for two of
    // the same millisecond)
    return club.inbox.filter(e => e.source === 'receive' && e.team === slug && !expired(e, now)).reverse();
}


// The generation of a team's push link (push.mjs): team.pushGen, absent (a club stored by 0.3.1)
// or anything but a whole number from 0 counts as 0.
export function pushGenOf(team) {
    const gen = team?.pushGen;
    return Number.isSafeInteger(gen) && gen >= 0 ? gen : 0;
}


// The planner's team name of an entry as the team page shows it (a hint, never stored): entities
// decoded as the riders' names are, control and format characters (bidi overrides among them) out,
// white space collapsed, at most PLANNER_NAME_MAX code points with "…". Null when nothing is left.
export const PLANNER_NAME_MAX = 60;

export function plannerName(entry) {
    const raw = entry?.json?.team?.name;
    if (typeof raw !== 'string') {
        return null;
    }
    const clean = [...decodeEntities(raw).replace(/\s+/g, ' ').replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/ +/g, ' ').trim()];
    if (!clean.length) {
        return null;
    }
    return clean.length > PLANNER_NAME_MAX ? `${clean.slice(0, PLANNER_NAME_MAX - 1).join('').trimEnd()}…` : clean.join('');
}


// "New ZwiftGopher link": the team's push link gets its next generation, so the old link stops
// working. No version bump (riders get nothing new); the log names the step, never a token.
export function newPushLink(club, slug, now) {
    const team = teamOf(club, slug);
    team.pushGen = pushGenOf(team) + 1;
    addLog(club, {at: iso(now), what: 'push-link', team: slug, label: team.name});
}


// How many entries sweepInbox would remove (only reads, for the sweep's dry check).
export function staleEntries(club, now) {
    return club.inbox.filter(e => expired(e, now)).length;
}


// Drops the entries older than keepOf allows, or with an `at` that does not parse. No version bump
// and no log: nobody sees an entry on a team page. Returns how many went.
export function sweepInbox(club, now) {
    const before = club.inbox.length;
    club.inbox = club.inbox.filter(e => !expired(e, now));
    return before - club.inbox.length;
}
