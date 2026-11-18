// Pure logic (no DOM, no Sauce imports): the plan server (server/server.mjs, ttt.mafl.net) as
// Paceline sees it. The overlay fetches GET {url}/api/plan/{teamSlug} (or, without a team name,
// /api/plan/by-athlete/{selfId}) and gets the stored record {team, slug, sig, etag, json, text,
// uploadedAt}: `json` is the planner JSON as an object, `text` the parsed text-export rows
// [{name, pullWatts, pullS, colorName, colorHex}] or null. The library keeps raw files, so the
// record is turned back into the two files first.
import {importFiles, PlanError} from './plan.mjs';
import {addPlan, activeEntry} from './library.mjs';
import {takeLease} from './recording.mjs';

export const DEFAULT_SERVER_URL = 'https://ttt.mafl.net';
export const POLL_MS = 60000;
// In the TTT event without a plan, or after a failed check: ask this often (user, 13 Nov 2026:
// riders join the start pen as late as 45 s before the start, and the captain may upload late).
export const POLL_FAST_MS = 10000;
export const MAX_TEAM_NAME = 80;    // as the server
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


// The API URL to poll: by team name when one is entered, else by my athlete id; null when neither
// (or the server URL is unusable).
export function planUrl({url, team, selfId}) {
    const base = serverBase(url);
    if (!base) {
        return null;
    }
    const slug = teamSlug(team);
    if (slug) {
        return `${base}/api/plan/${encodeURIComponent(slug)}`;
    }
    const id = selfId === null || selfId === undefined ? '' : String(selfId);
    return /^\d{1,12}$/.test(id) ? `${base}/api/plan/by-athlete/${id}` : null;
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


// The library entry for a server record ({entry, plan}), or null when the record is no usable plan.
export function serverEntry(record, now) {
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
    const team = typeof record.team === 'string' ? record.team.trim() : '';
    const entry = {sig: plan.sig, json: files.json, text: files.text, loadedAt: now};
    if (team) {
        entry.team = team;
    }
    return {entry, plan};
}


// The library with the server's plan added (an entry with the same sig is replaced) and active,
// or null when there is nothing to do: the record is no usable plan, or the active entry already
// is this plan with the same files and team name. A name, colour or bench edit keeps the sig but
// changes the files, so it does update.
export function serverPlanUpdate(lib, record, now = Date.now()) {
    const res = serverEntry(record, now);
    if (!res) {
        return null;
    }
    const {entry} = res;
    const cur = activeEntry(lib);
    if (cur && cur.sig === entry.sig && cur.json === entry.json && cur.text === entry.text &&
        (cur.team ?? null) === (entry.team ?? null)) {
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
