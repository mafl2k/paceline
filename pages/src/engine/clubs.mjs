// Pure logic (no DOM, no Sauce imports): the Clubs table (spec §7.2). The plan server's answers
// fill it, the rider ticks the clubs Paceline takes plans from, and private clubs are added by
// their code (spec §3). Stored as {server, clubs: [row]} under CLUBS_KEY; a table recorded for
// another server reads as empty. Every function returns a new state and never changes its input.
//
// Row: {id, name, joined, via, addedAt, changedAt, joinedAt, hinted, lists, teams, private, code,
// codeState}. `teams` are the names of the club's teams whose live plan has the rider among its
// riders (server 0.5.1), or null when the server doesn't say (an older server). `via` is 'auto' | 'rider' | 'code' | null, `code` a private club's code in its normal
// form or null, `codeState` 'ok' | 'bad' | 'needed' | null. `changedAt` moves with the rider's
// data (joined, hinted, code, codeState), never with what the server says (name, lists, teams).
import {penPick} from './planserver.mjs';

export const CLUBS_KEY = 'paceline:clubs:v1';
// As server/ids.mjs: a club id is 10 lower-case Crockford characters.
export const CID_RE = /^[0-9a-hjkmnp-tv-z]{10}$/;
// A private club's rider code (server/ids.mjs RIDER_CODE_RE): 10 upper-case Crockford characters.
export const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{10}$/;
export const MAX_NAME = 60;     // code points, as the server's club names
export const MAX_CODES = 10;    // codes per request (server/api.mjs)
export const MAX_TEAMS = 10;    // team names kept per club
const VIAS = ['auto', 'rider', 'code'];
const CODE_STATES = ['ok', 'bad', 'needed'];


// A code as a rider typed it (server/ids.mjs normalizeRiderCode): case, spaces and hyphens don't
// matter, O reads as 0, I and L as 1. The code, or null when it is none.
export function normalizeCode(s) {
    if (typeof s !== 'string') {
        return null;
    }
    const code = s.toUpperCase().replace(/[ -]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
    return CODE_RE.test(code) ? code : null;
}


// '7Q4MZ2KX9B' -> '7Q4MZ-2KX9B', or null when it is no code.
export function formatCode(code) {
    const clean = normalizeCode(code);
    return clean === null ? null : `${clean.slice(0, 5)}-${clean.slice(5)}`;
}


function isName(s) {
    return typeof s === 'string' && [...s].length <= MAX_NAME;
}


// An answer's or a stored row's team names: the names (each once, at most MAX_TEAMS), or null when
// it has no list.
function teamsOf(v) {
    if (!Array.isArray(v)) {
        return null;
    }
    return [...new Set(v.filter(n => typeof n === 'string' && n.trim() !== '' && isName(n)))].slice(0, MAX_TEAMS);
}


function num(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}


// One stored row, cleaned, or null when it can't be one (no valid id or name).
function normalizeRow(r) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !CID_RE.test(r.id) || !isName(r.name)) {
        return null;
    }
    return {
        id: r.id,
        name: r.name,
        joined: r.joined === true,
        via: VIAS.includes(r.via) ? r.via : null,
        addedAt: num(r.addedAt) ?? 0,
        changedAt: num(r.changedAt) ?? 0,
        joinedAt: num(r.joinedAt),
        hinted: r.hinted === true,
        lists: r.lists === true,
        teams: teamsOf(r.teams),
        private: r.private === true,
        code: typeof r.code === 'string' && CODE_RE.test(r.code) ? r.code : null,
        codeState: CODE_STATES.includes(r.codeState) ? r.codeState : null,
    };
}


// The stored table for `server`: {server, clubs}. Missing, or recorded for another server: empty.
// Bad rows are dropped; of two rows with one id the newer changedAt stays.
export function normalizeClubs(raw, server) {
    if (!raw || typeof raw !== 'object' || raw.server !== server || !Array.isArray(raw.clubs)) {
        return {server, clubs: []};
    }
    const clubs = [];
    for (const r of raw.clubs) {
        const row = normalizeRow(r);
        if (!row) {
            continue;
        }
        const i = clubs.findIndex(x => x.id === row.id);
        if (i < 0) {
            clubs.push(row);
        } else if (row.changedAt > clubs[i].changedAt) {
            clubs[i] = row;
        }
    }
    return {server, clubs};
}


// Local and shared copy (spec §7.2): per id the newer changedAt wins (equal: a), rows on one side
// only are kept. Tables of different servers don't mix: a wins whole.
export function mergeClubs(a, b) {
    if (a.server !== b.server) {
        return a;
    }
    const other = new Map(b.clubs.map(r => [r.id, r]));
    const clubs = a.clubs.map(r => {
        const o = other.get(r.id);
        return o && o.changedAt > r.changedAt ? o : r;
    });
    const mine = new Set(a.clubs.map(r => r.id));
    for (const r of b.clubs) {
        if (!mine.has(r.id)) {
            clubs.push(r);
        }
    }
    return {server: a.server, clubs};
}


export function joinedIds(state) {
    return state.clubs.filter(r => r.joined).map(r => r.id).sort();
}


export function sameJoined(a, b) {
    return joinedIds(a).join(',') === joinedIds(b).join(',');
}


// The codes a check carries (X-Paceline-Codes): rows with a code that isn't known to be bad,
// joined rows first, at most MAX_CODES. Sorted within each group, so equal tables give equal lists.
export function codesToSend(state) {
    const usable = state.clubs.filter(r => r.code !== null && r.codeState !== 'bad');
    const pick = joined => usable.filter(r => r.joined === joined).map(r => r.code).sort();
    return [...new Set([...pick(true), ...pick(false)])].slice(0, MAX_CODES);
}


export function sameCodes(a, b) {
    return codesToSend(a).join(',') === codesToSend(b).join(',');
}


function circlesOf(answer) {
    return Array.isArray(answer?.circles)
        ? answer.circles.filter(c => c && typeof c === 'object' && typeof c.id === 'string' && CID_RE.test(c.id))
        : null;
}


// The rider's code fields changed: changedAt moves.
function withCode(r, code, codeState, priv, now) {
    if (r.code === code && r.codeState === codeState) {
        return r.private === priv ? r : {...r, private: priv};
    }
    return {...r, code, codeState, private: priv, changedAt: now};
}


// An answer's `circles` (spec §7.2) applied to the table. `sentCodes` are the codes the request
// carried. New listing ids come unticked; known rows get the name, `lists` and `teams` (changedAt
// stays); rows the answer doesn't name keep everything but `lists` and `teams`; only `gone` drops a row. Codes: an
// echo makes its row `ok`; `{id, code: 'needed'}` gives `needed` (`bad` with a code); a named entry
// without `private` means the club is open (again): code, codeState and private are cleared; a
// sent code no entry echoes marks its row `bad`. An answer without a `circles` list changes nothing.
export function applyAnswer(state, answer, now, sentCodes = []) {
    const circles = circlesOf(answer);
    if (circles === null) {
        return state;
    }
    const byId = new Map(circles.map(c => [c.id, c]));
    const clubs = [];
    for (const r of state.clubs) {
        const c = byId.get(r.id);
        if (!c) {
            clubs.push(r.lists || r.teams?.length ? {...r, lists: false, teams: r.teams && []} : r);
            continue;
        }
        if (c.gone === true) {
            continue;
        }
        let row = {...r, lists: c.lists === true, teams: teamsOf(c.teams)};
        if (isName(c.name)) {
            row.name = c.name;
        }
        if (c.code === 'needed') {
            row = withCode(row, row.code, row.code !== null ? 'bad' : 'needed', row.private, now);
        } else if (c.private === true) {
            row = withCode(row, row.code, row.code !== null && row.code === c.code ? 'ok' : row.codeState, true, now);
        } else if (typeof c.name === 'string') {
            row = withCode(row, null, null, false, now);
        }
        clubs.push(row);
    }
    const known = new Set(state.clubs.map(r => r.id));
    for (const c of circles) {
        if (!known.has(c.id) && c.lists === true && c.gone !== true && isName(c.name)) {
            known.add(c.id);
            clubs.push({
                id: c.id, name: c.name, joined: false, via: null, addedAt: now, changedAt: now, joinedAt: null,
                hinted: false, lists: true, teams: teamsOf(c.teams), private: c.private === true, code: null,
                codeState: null,
            });
        }
    }
    const echoed = new Set(circles.filter(c => c.private === true && typeof c.code === 'string').map(c => c.code));
    const bad = new Set((Array.isArray(sentCodes) ? sentCodes : []).map(normalizeCode)
        .filter(code => code !== null && !echoed.has(code)));
    return {
        server: state.server,
        clubs: clubs.map(r => (r.code !== null && bad.has(r.code) ? withCode(r, r.code, 'bad', r.private, now) : r)),
    };
}


// Auto-join (spec §7.2): only while the table (`before`, the read the answer goes into) is
// empty, and only open clubs that list the rider. {join: id | null, several, wait}. One listing
// club: join it. Several in an event: wait while a hint of theirs has no body yet (it opens later);
// else the only hinted one, or the pen rule on the hints. Otherwise none, and `several`.
export function autoJoinPick(before, answer, {inEvent, nearbyIds, rolledOff} = {}) {
    const none = {join: null, several: false, wait: false};
    if (before.clubs.length !== 0) {
        return none;
    }
    const listing = (circlesOf(answer) ?? []).filter(c => c.lists === true && c.private !== true && c.gone !== true
        && isName(c.name));
    if (listing.length === 0) {
        return none;
    }
    if (listing.length === 1) {
        return {join: listing[0].id, several: false, wait: false};
    }
    if (inEvent) {
        const ids = new Set(listing.map(c => c.id));
        const hints = (Array.isArray(answer.hint) ? answer.hint : []).filter(h => h && ids.has(h.id));
        if (hints.some(h => h.body !== true)) {
            return {join: null, several: false, wait: true};
        }
        if (hints.length === 1) {
            return {join: hints[0].id, several: false, wait: false};
        }
        if (hints.length > 1) {
            const cands = hints.map(h => ({riderIds: Array.isArray(h.riders) ? h.riders : [], uploadedAt: h.uploadedAt,
                id: h.id}));
            return {join: penPick(cands, {nearbyIds, rolledOff}).id, several: false, wait: false};
        }
    }
    return {join: null, several: true, wait: false};
}


// An answer into a fresh read of the table (spec §7.2 "Lost update": never into the copy the
// request was made from). opts: {now, inEvent, nearbyIds, rolledOff, sentCodes}.
// {clubs, autoJoined: id | null, several}. While auto-join waits, the table stays as read.
export function answerClubs(fresh, answer, opts = {}) {
    const {now, sentCodes = []} = opts;
    const pick = autoJoinPick(fresh, answer, opts);
    if (pick.wait) {
        return {clubs: fresh, autoJoined: null, several: false};
    }
    let clubs = applyAnswer(fresh, answer, now, sentCodes);
    if (pick.join !== null) {
        clubs = setJoined(clubs, pick.join, true, now, 'auto');
    }
    return {clubs, autoJoined: pick.join, several: pick.several};
}


function updateRow(state, id, fn) {
    if (!state.clubs.some(r => r.id === id)) {
        return state;
    }
    return {server: state.server, clubs: state.clubs.map(r => (r.id === id ? fn(r) : r))};
}


// Tick or untick. A club already ticked keeps its joinedAt (the Clubs table's Since).
export function setJoined(state, id, joined, now, via = 'rider') {
    return updateRow(state, id, r => ({
        ...r, joined, via, changedAt: now, joinedAt: joined ? (r.joined && r.joinedAt !== null ? r.joinedAt : now) : null,
    }));
}


// The in-event hint for this club was shown (spec §7.2), so it isn't shown again.
export function markHinted(state, id, now) {
    return updateRow(state, id, r => ({...r, hinted: true, changedAt: now}));
}


// "Add club by code" (spec §7.2): when the answer to a check carrying `code` echoes it, the club's
// row is created or updated, ticked, with the code. {state, added: {id, name} | null}; without
// the echo nothing changes.
export function addByCode(state, answer, code, now) {
    const clean = normalizeCode(code);
    const c = clean === null ? null : (circlesOf(answer) ?? []).find(x => x.private === true && x.code === clean);
    const old = c ? state.clubs.find(r => r.id === c.id) : undefined;
    const name = c && isName(c.name) ? c.name : old?.name;
    if (!c || name === undefined) {
        return {state, added: null};
    }
    const base = old ?? {id: c.id, addedAt: now, hinted: false, joined: false, joinedAt: null};
    const row = {
        ...base, name, joined: true, via: 'code', changedAt: now,
        joinedAt: base.joined && base.joinedAt !== null ? base.joinedAt : now,
        lists: c.lists === true, teams: teamsOf(c.teams), private: true, code: clean, codeState: 'ok',
    };
    const clubs = old ? state.clubs.map(r => (r.id === c.id ? row : r)) : [...state.clubs, normalizeRow(row)];
    return {state: {server: state.server, clubs}, added: {id: c.id, name}};
}


// The settings window's check (spec §7.1): it fills the Clubs table (auto-join included) and tells
// what is waiting, and never activates a plan. {clubs, next: {label, startAt} | null, several,
// recheck}; `next` is the plan with the earliest startAt; recheck: a club was just auto-joined.
export function settingsCheckResult(state, answer, {now, sentCodes = []} = {}) {
    const res = answerClubs(state, answer, {now, inEvent: false, sentCodes});
    let next = null;
    let at = Infinity;
    for (const p of Array.isArray(answer?.plans) ? answer.plans : []) {
        const t = p && typeof p.startAt === 'string' ? Date.parse(p.startAt) : NaN;
        if (Number.isFinite(t) && t < at) {
            at = t;
            next = {label: p.label, startAt: p.startAt};
        }
    }
    return {clubs: res.clubs, next, several: res.several, recheck: res.autoJoined !== null};
}
