// Pure logic (no DOM, no Sauce imports): the plan server (server/, ttt.mafl.net) as Paceline sees it.
// In an event the poll lease owner checks GET {url}/api/v3/rider/{zwiftId} (checkUrl, spec §6.1) and
// gets {circles, plans, hint, notice}. Each plan record carries the planner JSON as an object and
// the parsed text-export rows [{name, pullWatts, pullS, colorName, colorHex}] or null; the library
// keeps raw files, so the record is turned back into the two files first (recordFiles).
import {importFiles, PlanError} from './plan.mjs';
import {addPlan, activeEntry, fileEnded} from './library.mjs';
import {takeLease, isTtt} from './recording.mjs';
import {CHANNEL} from '../version.mjs';

export const RELEASE_SERVER_URL = 'https://ttt.mafl.net';
export const BETA_SERVER_URL = 'https://ttt-beta.mafl.net';
// The build's own server (spec §10): the beta channel talks to the beta stack.
export const DEFAULT_SERVER_URL = CHANNEL === 'beta' ? BETA_SERVER_URL : RELEASE_SERVER_URL;
export const POLL_MS = 60000;
// In the TTT event without a plan, or after a failed check: ask this often (user, 13 Nov 2026:
// riders join the start pen as late as 45 s before the start, and the captain may upload late).
export const POLL_FAST_MS = 10000;
const TEXT_HEADER = ['RiderName', 'PullWatts', 'PullDurationSeconds', 'KitColorName', 'KitColorHex'];


// The server's slug rule (slugify in server/server.mjs), so a typed team name finds its plan.
export function teamSlug(name) {
    return String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}


// The server URL without trailing slashes, or null when it is not an http(s) URL.
export function serverBase(url) {
    const base = String(url ?? '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/i.test(base)) {
        return null;
    }
    return base;
}


// start and eventId go out as digits only (the server takes /^\d{1,15}$/).
const eventNumber = x => Number.isSafeInteger(x) && x >= 0;


// The v3 check URL (spec §6, §7.1), or null when the server URL is unusable or selfId is no
// Zwift ID. joined: ids of the ticked clubs. start and eventId go in only together (in an event).
// The codes of private clubs never go in the URL: see checkHeaders.
export function checkUrl({url, selfId, mod, joined, start = null, eventId = null, sig = null}) {
    const base = serverBase(url);
    const id = selfId === null || selfId === undefined ? '' : String(selfId);
    if (!base || !/^\d{1,12}$/.test(id)) {
        return null;
    }
    let out = `${base}/api/v3/rider/${id}?mod=${encodeURIComponent(String(mod ?? ''))}`;
    const ids = (Array.isArray(joined) ? joined : []).map(x => encodeURIComponent(String(x)));
    if (ids.length) {
        out += `&joined=${ids.join(',')}`;
    }
    if (eventNumber(start) && eventNumber(eventId)) {
        out += `&start=${start}&event=${eventId}`;
    }
    if (typeof sig === 'string' && /^[0-9A-HJKMNP-TV-Z]{6}$/.test(sig)) {
        out += `&sig=${sig}`;
    }
    return out;
}


export const CODE_HEADER = 'X-Paceline-Codes';
const MAX_CODES = 10;


// The request headers carrying the codes of private clubs (spec §6.1, 16 Nov 2026): at most 10.
export function checkHeaders(codes) {
    const list = (Array.isArray(codes) ? codes : []).slice(0, MAX_CODES);
    return list.length ? {[CODE_HEADER]: list.join(',')} : {};
}


// 'In an event' (spec §7.1): the event summary has a start (the subgroup's, else the event's) and
// an event id; with tttOnly only a TTT counts. null otherwise. key tells one event from the next.
export function inEventOf(summary, {tttOnly = false} = {}) {
    if (!summary || typeof summary !== 'object' || (tttOnly && !isTtt(summary))) {
        return null;
    }
    const start = summary.start ?? summary.eventStart;
    const eventId = summary.eventId;
    if (!Number.isFinite(start) || !Number.isFinite(eventId)) {
        return null;
    }
    return {start, eventId, key: `${eventId}:${start}`};
}


// Roll-off tracking (spec §7.4) for one event key. prev: null or {key, sawZero, rolled}; time: my
// ride time (s). rolledOff is true in the one step where time turns > 0 after having been 0;
// midRide when the event is first seen with time > 0 (a window opened mid-ride).
export function rollStep(prev, {key, time}) {
    if (key === null || key === undefined) {
        return {state: null, rolledOff: false, midRide: false};
    }
    const num = typeof time === 'number' && Number.isFinite(time);
    if (!prev || prev.key !== key) {
        const mid = num && time > 0;
        return {state: {key, sawZero: num && time === 0, rolled: mid}, rolledOff: false, midRide: mid};
    }
    if (!num) {
        return {state: prev, rolledOff: false, midRide: false};
    }
    if (time === 0) {
        return {state: {...prev, sawZero: true}, rolledOff: false, midRide: false};
    }
    if (time > 0 && prev.sawZero && !prev.rolled) {
        return {state: {...prev, rolled: true}, rolledOff: true, midRide: false};
    }
    return {state: prev, rolledOff: false, midRide: false};
}


function field(v) {
    return String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();
}


// The record as the two raw files {json, text} the library keeps (text null without rows), or
// null when the record holds no planner JSON.
export function recordFiles(record) {
    if (!record || typeof record !== 'object') {
        return null;
    }
    let json = null;
    if (typeof record.json === 'string') {
        json = record.json;
    } else if (record.json && typeof record.json === 'object' && !Array.isArray(record.json)) {
        json = JSON.stringify(record.json);
    }
    if (json === null) {
        return null;
    }
    let text = null;
    if (typeof record.text === 'string' && record.text.trim()) {
        text = record.text;
    } else if (Array.isArray(record.text)) {
        const rows = record.text
            .filter(r => r && typeof r === 'object' && Number.isFinite(r.pullWatts) && Number.isFinite(r.pullS))
            .map(r => [field(r.name), r.pullWatts, r.pullS, field(r.colorName), field(r.colorHex)].join('\t'));
        text = rows.length ? [TEXT_HEADER.join('\t'), ...rows].join('\n') + '\n' : null;
    }
    return {json, text};
}


const uploadedMs = r => Date.parse(r?.uploadedAt) || 0;


// The candidate with the latest uploadedAt (the first one on a tie).
function newest(cands) {
    return cands.reduce((best, c) => (uploadedMs(c) > uploadedMs(best) ? c : best));
}


// The pen rule (spec §7.3) over candidates [{riderIds, uploadedAt, ...}]: the score is the count of
// a candidate's riderIds in nearbyIds (Sauce's nearby list). No nearby data: the newest upload.
// At roll-off: the highest score, the newest of the tied. Before: the top one when it leads the
// second by 2 or more, else the newest.
export function penPick(cands, {nearbyIds, rolledOff}) {
    if (!Array.isArray(cands) || !cands.length) {
        return null;
    }
    if (cands.length === 1 || !Array.isArray(nearbyIds) || !nearbyIds.length) {
        return newest(cands);
    }
    const near = new Set(nearbyIds.map(String));
    const scored = cands.map(c => ({c, n: (c.riderIds ?? []).filter(id => near.has(String(id))).length}));
    scored.sort((x, y) => y.n - x.n);
    if (rolledOff) {
        return newest(scored.filter(x => x.n === scored[0].n).map(x => x.c));
    }
    return scored[0].n - scored[1].n >= 2 ? scored[0].c : newest(cands);
}


// Which of an answer's plan records to show (spec §7.3): {record, fits, waiting}. Notice records
// are dropped. A record without a body (body !== true, spec §6.1) is no plan: waiting is the one
// opening first, or null. Of the rest a rider plan beats a bench plan; two or more rider plans go to
// the pen rule (fits counts them); no rider plan: the newest bench plan; else record is null.
export function choosePlan(plans, {nearbyIds, rolledOff}) {
    const live = (Array.isArray(plans) ? plans : []).filter(r => r && r.notice !== true);
    const closed = live.filter(r => r.body !== true);
    const waiting = closed.length
        ? closed.reduce((best, r) => ((Date.parse(r.opensAt) || Infinity) < (Date.parse(best.opensAt) || Infinity) ? r : best))
        : null;
    const open = live.filter(r => r.body === true);
    const riders = open.filter(r => r.role === 'rider');
    const fits = riders.length;
    if (fits >= 2) {
        const cands = riders.map(r => ({riderIds: Object.keys(r.json?.riders ?? {}), uploadedAt: r.uploadedAt, record: r}));
        return {record: penPick(cands, {nearbyIds, rolledOff}).record, fits, waiting};
    }
    if (fits === 1) {
        return {record: riders[0], fits, waiting};
    }
    const bench = open.filter(r => r.role === 'bench');
    return {record: bench.length ? newest(bench) : null, fits, waiting};
}


// choosePlan under a bound lock (spec §7.4: the locked team's plans apply at once): the pick among
// the records the lock accepts when one of them has a body, else the pick over all plans (which
// then waits). fits and waiting always come from all plans, for the status. No lock, or an empty
// one: choosePlan.
export function chooseForLock(plans, lock, opts) {
    const all = choosePlan(plans, opts);
    if (lock?.state !== 'bound') {
        return all;
    }
    const own = choosePlan((Array.isArray(plans) ? plans : []).filter(r => r && lockAccepts(lock, r)), opts);
    return own.record ? {...all, record: own.record} : all;
}


// The ride lock (spec §7.4): null, {state: 'empty'} or {state: 'bound', circle, slug}. Null and
// empty accept any server record; bound only its own club and team (a new sheet of it too).
export function lockAccepts(lock, record) {
    if (!lock || lock.state !== 'bound') {
        return true;
    }
    return record?.circle?.id === lock.circle && record?.slug === lock.slug;
}


// The lock at my roll-off: bound to the active server plan's club and team, empty when there is
// none or a file plan is active.
export function lockAtRollOff(entry, {fileActive}) {
    // A server entry without a club or slug has nothing to bind to.
    if (entry?.source === 'server' && entry.circleId && entry.slug && !fileActive) {
        return {state: 'bound', circle: entry.circleId, slug: entry.slug};
    }
    return {state: 'empty'};
}


// Unticking the locked club clears the lock (null); any other lock stays as it is.
export function lockAfterClubs(lock, joinedIds) {
    if (lock?.state === 'bound' && !(Array.isArray(joinedIds) ? joinedIds : []).includes(lock.circle)) {
        return null;
    }
    return lock;
}


// What an answer does to the active plan (spec §7.3-§7.5): {action, bind}. record is
// choosePlan's choice (null: no plan with a body), waiting its body-less record.
//   keep  nothing changes     drop  deactivate the server plan   pend  wait (lock or file plan)
//   same  already active      take  activate the record
// bind: an empty lock binds to the team that becomes (or is) active.
export function serverDecision({record, waiting = null, lock, fileActive, activeEtag}) {
    let action;
    if (!record) {
        // A body-less record changes nothing; no plan at all drops, unless locked or a file plan.
        action = waiting || lock?.state === 'bound' || fileActive ? 'keep' : 'drop';
    } else if (fileActive || !lockAccepts(lock, record)) {
        action = 'pend';
    } else if (record.etag === activeEtag) {
        action = 'same';
    } else {
        action = 'take';
    }
    return {action, bind: lock?.state === 'empty' && (action === 'take' || action === 'same')};
}


// The stored ride lock (paceline:lock:v1): null, {state: 'empty', eventKey} or {state: 'bound',
// circle, slug, eventKey}; anything else is null. eventKey (the event it was made in, or null)
// lets a window that starts mid-event tell its own event's lock from a stale one.
export function normalizeLock(raw) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const eventKey = typeof raw.eventKey === 'string' ? raw.eventKey : null;
    if (raw.state === 'empty') {
        return {state: 'empty', eventKey};
    }
    if (raw.state === 'bound' && typeof raw.circle === 'string' && raw.circle && typeof raw.slug === 'string' &&
        raw.slug) {
        return {state: 'bound', circle: raw.circle, slug: raw.slug, eventKey};
    }
    return null;
}


// The stored lock when it was made in this event, else null (no lock).
export function lockFor(lock, key) {
    return lock && key !== null && key !== undefined && lock.eventKey === key ? lock : null;
}


// The stored pending answer (paceline:pending:v1): {eventKey, at, plans, hint}, hint {id, name} or
// null; null when malformed.
export function normalizePending(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.eventKey !== 'string' || !Number.isFinite(raw.at) ||
        !Array.isArray(raw.plans)) {
        return null;
    }
    const h = raw.hint;
    const hint = h && typeof h === 'object' && typeof h.id === 'string' && typeof h.name === 'string'
        ? {id: h.id, name: h.name} : null;
    return {eventKey: raw.eventKey, at: raw.at, plans: raw.plans, hint};
}


// The hint to show (spec §7.2): when the answer has no plans, the first of its hints for a club the
// table (clubs: {clubs: [row]}) has not hinted yet, as {id, name}; else null.
export function answerHint(answer, clubs) {
    const plans = Array.isArray(answer?.plans) ? answer.plans : [];
    if (plans.length || !Array.isArray(answer?.hint)) {
        return null;
    }
    const hinted = new Set((clubs?.clubs ?? []).filter(r => r.hinted).map(r => r.id));
    const h = answer.hint.find(x => x && typeof x === 'object' && typeof x.id === 'string' &&
        typeof x.name === 'string' && !hinted.has(x.id));
    return h ? {id: h.id, name: h.name} : null;
}


// The plan status prefs for choosePlan's result: serverFits (2 or more, else null), and while no
// plan with a body is chosen the body-less record that opens first (serverOpensAt, serverOpensLabel).
export function choiceStatus({record, fits, waiting}) {
    const open = !record && waiting ? waiting : null;
    const at = open ? Date.parse(open.opensAt) : NaN;
    return {
        serverFits: fits >= 2 ? fits : null,
        serverOpensAt: Number.isFinite(at) ? at : null,
        serverOpensLabel: open && typeof open.label === 'string' && open.label ? open.label : null,
    };
}


// The plans of the pending answer when it is for this event, else none.
export function pendingFor(pending, key) {
    return pending && pending.eventKey === key && Array.isArray(pending.plans) ? pending.plans : [];
}


// A server plan from another event than this one (a file plan never is stale).
export function staleForEvent(entry, key) {
    return entry?.source === 'server' && entry.eventKey !== key;
}


// What serverTick does when it sees `ev` (inEventOf, or null) while `prevKey` (evKey) is set:
// begin a new event, and end the old one first when it was never ended (the gate held through a gap
// and the next data shows another event: Zwift quit mid-race, the next session in another pen).
export function eventChange(prevKey, ev) {
    const begin = !!ev && ev.key !== prevKey;
    return {over: begin && prevKey !== null && prevKey !== undefined, begin};
}


// What a new event deactivates: a server plan of another event, and a file plan that has ended
// (at the last gate close, after 18 h, or a 0.2 entry): it no longer overrides the server, so the
// pen and "Plan opens ..." show this event's plan.
export function dropsAtEventBegin(entry, {key, now}) {
    return staleForEvent(entry, key) || fileEnded(entry, {now, serverOn: true});
}


// The status changes at the end of an event: what only meant "in this race" goes (the pen rule's
// count, the plan that opens, "No plan for you in this race yet."). Other errors stay.
export function eventOverStatus(prefs) {
    const changes = {serverOpensAt: null, serverOpensLabel: null, serverFits: null};
    if (prefs?.serverError === 'notfound') {
        changes.serverError = null;
    }
    return changes;
}


// The library entry for a v3 plan record, or null when it holds no usable plan.
export function recordEntry(record, {now, eventKey}) {
    const files = recordFiles(record);
    if (!files) {
        return null;
    }
    let plan;
    try {
        ({plan} = importFiles([files.json, files.text].filter(Boolean)));
    } catch(e) {
        if (e instanceof PlanError) {
            return null;
        }
        throw e;
    }
    return {
        sig: plan.sig, json: files.json, text: files.text, loadedAt: now, source: 'server',
        team: record.label, label: record.label, circleId: record.circle.id, circleName: record.circle.name,
        slug: record.slug, eventKey, etag: record.etag, startAt: record.startAt, role: record.role,
    };
}


// The library with the entry added and active, or null when the active entry already holds the
// same sig, files and etag.
export function entryUpdate(lib, entry) {
    const cur = activeEntry(lib);
    if (cur && cur.sig === entry.sig && cur.json === entry.json && cur.text === entry.text &&
        cur.etag === entry.etag) {
        return null;
    }
    return addPlan(lib, entry);
}


// The poll lease: the window acts as soon as it holds the lease (takeLease's `own`), unlike the
// recorder's leaseStep, which waits a step. Two hidden windows stepping about once a minute always
// find the other's lease stale; with leaseStep neither would ever act. A rare double take is
// harmless: pollDue on the shared serverCheckedAt keeps the second window from asking again.
export function pollLeaseStep(current, me, now) {
    const {own, write} = takeLease(current, me, now);
    return {act: own, write};
}


// Whether this window runs serverTick in this step: it holds the poll lease, no demo runs and the
// plan server is on. When it does not, its event state (gate, roll-off, event key) starts over, so
// it never resumes stale when the window takes the lease again.
export function serverRuns({act, demo, serverOn}) {
    return !!act && !demo && !!serverOn;
}


// True when it is time to ask the server again (checkedAt: the last attempt by any window), every
// `every` ms (POLL_MS, or POLL_FAST_MS when a plan is missing in the event).
export function pollDue(checkedAt, now, every = POLL_MS) {
    return !Number.isFinite(checkedAt) || now - checkedAt >= every || now < checkedAt;
}


// How often to ask: POLL_FAST_MS in the TTT event (inEvent) while there is no plan or the last
// check failed (no answer, no plan for me on the server, ...), else POLL_MS.
export function pollEvery({inEvent, hasPlan, error}) {
    return inEvent && (!hasPlan || !!error) ? POLL_FAST_MS : POLL_MS;
}
