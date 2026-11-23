// Pure logic (no DOM, no Sauce imports): uploading finished recordings to the plan server
// (POST {server}/api/log/<slug>?circle=<cid>&session=<ms>&athlete=<id>&mod=<x.y.z>, raw gzip body,
// see server/logs.mjs). A recording goes up under one club and team (spec §7.7): the ride lock's,
// else the active server plan's, else, for a file plan, the ticked club that has a team with the
// plan's slug in the plan library; without a club it stays local.
// The lease-owning overlay window sweeps the recordings now and then and uploads one at a time;
// each session row keeps uploadedAt, or uploadTriedAt and uploadError after a failed attempt.
// Only rides started after the rider ticked the upload box (prefs.logUploadSince) go up on their
// own; the Upload button in settings sends any finished one.
import {serverBase, teamSlug, staleForEvent} from './planserver.mjs';
import {CID_RE} from './clubs.mjs';

export const UPLOAD_MIN_TICKS = 60;             // shorter recordings are no ride worth sending
export const UPLOAD_RETRY_MS = 300000;          // a failed session is tried again after this
export const UPLOAD_MAX_AGE_MS = 7 * 864e5;     // older recordings are left alone
export const SWEEP_MS = 60000;                  // how often the overlay looks for pending ones
// The server's rule for `mod` (server/ids.mjs MOD_RE).
export const MOD_RE = /^\d{1,3}(\.\d{1,3}){2}(-beta\.\d{1,3})?$/;


// The server's slug rule (server/ids.mjs isSlug).
function isSlug(s) {
    return typeof s === 'string' && s.length <= 48 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s);
}


const isCircle = c => typeof c === 'string' && CID_RE.test(c);


// The club (circle id) whose team `slug` the plan library knows from a server plan, among the
// ticked clubs (`joined`); null when none. Slugs are unique on a server, so at most one club
// should match; with several, the newest entry wins.
export function libraryCircleFor(slug, lib, joined) {
    if (!isSlug(slug) || !Array.isArray(joined) || !lib || typeof lib.plans !== 'object' || !lib.plans) {
        return null;
    }
    const hit = Object.values(lib.plans)
        .filter(e => e && e.source === 'server' && e.slug === slug && isCircle(e.circleId) && joined.includes(e.circleId))
        .sort((a, b) => (Number(b.loadedAt) || 0) - (Number(a.loadedAt) || 0))[0];
    return hit ? hit.circleId : null;
}


// The team of a plan by its name, filed under the ticked club the library knows it from.
function byTeam(name, lib, joined) {
    const slug = teamSlug(name);
    const circle = libraryCircleFor(slug, lib, joined);
    return circle ? {slug, circle} : null;
}


// Where a recording goes up ({slug, circle}), or null (it stays local): a bound ride lock's key;
// else the active server entry's team and club; else the plan's team (a file plan) under the
// ticked club the library has that team from.
export function uploadTarget({lock, entry, plan, lib, joined} = {}) {
    if (lock?.state === 'bound' && isSlug(lock.slug) && isCircle(lock.circle)) {
        return {slug: lock.slug, circle: lock.circle};
    }
    if (entry?.source === 'server' && isSlug(entry.slug) && isCircle(entry.circleId)) {
        return {slug: entry.slug, circle: entry.circleId};
    }
    return byTeam(plan?.team, lib, joined);
}


// uploadTarget for a ride in event `eventKey` (null: none known yet), at its start and at my
// roll-off: a server plan from another event, or any server plan while no event is known, is no
// target at all (its plan's team is not looked up either: that would find its club again). A
// bound lock still wins, and a file plan goes by its team as in uploadTarget.
export function rideTarget({eventKey = null, entry, plan, ...rest} = {}) {
    const stale = entry?.source === 'server' && (eventKey === null || staleForEvent(entry, eventKey));
    return uploadTarget({...rest, entry: stale ? null : entry, plan: stale ? null : plan});
}


// Where a stored recording goes up: the club and team stored with it (at the start, set again at
// roll-off), else null: it stays local. A 0.2 recording has no `circle` and stays local too.
export function sessionTarget(meta) {
    const m = meta && typeof meta === 'object' ? meta : {};
    return isSlug(m.slug) && isCircle(m.circle) ? {slug: m.slug, circle: m.circle} : null;
}


const idOf = v => v === null || v === undefined ? '' : String(v);


// The upload URL, or null when the server URL, the slug, the club, an id or the version is
// unusable (each checked by the server's own rule).
export function logUploadUrl({url, slug, circle, sessionId, athleteId, mod}) {
    const base = serverBase(url);
    const session = idOf(sessionId);
    const athlete = idOf(athleteId);
    if (!base || !isSlug(slug) || !isCircle(circle) || typeof mod !== 'string' || !MOD_RE.test(mod) ||
        !/^\d{1,16}$/.test(session) || !/^\d{1,12}$/.test(athlete)) {
        return null;
    }
    return `${base}/api/log/${slug}?circle=${circle}&session=${session}&athlete=${athlete}&mod=${mod}`;
}


function startOf(s) {
    const t = s.meta?.startedAt;
    return Number.isFinite(t) ? t : Number(s.sessionId);
}


// Error kinds a retry cannot fix (spec §7.7): not in this team, no such team, a different copy
// already there, refused by the content check, too large. Only the Upload button sends those again.
const FINAL_ERRORS = new Set(['forbidden', 'notfound', 'exists', 'refused', 'toolarge']);


// How long after a failed attempt the sweep tries a session again, by the attempt's error kind:
// never after a final one, else UPLOAD_RETRY_MS.
export function retryAfterMs(kind) {
    return FINAL_ERRORS.has(kind) ? Infinity : UPLOAD_RETRY_MS;
}


// What becomes of a recording on its own: 'uploaded', 'waiting' (the sweep sends it, perhaps after
// a retry delay) or 'manual' (only the Upload button sends it: too short, too old, started before
// the box was ticked (`since`, null when it is not), a final upload error (retryAfterMs), or the
// plan server is switched off (`serverOn` false; left out counts as on)).
export function autoUploadState(s, {now, since, serverOn = true}) {
    const meta = s.meta || {};
    if (Number.isFinite(meta.uploadedAt)) {
        return 'uploaded';
    }
    const start = startOf(s);
    if (!(s.ticks >= UPLOAD_MIN_TICKS) || !Number.isFinite(start) || !(now - start < UPLOAD_MAX_AGE_MS) ||
        !Number.isFinite(since) || start < since || retryAfterMs(meta.uploadError) === Infinity || serverOn === false) {
        return 'manual';
    }
    return 'waiting';
}


// The sessions to upload now (ids, oldest first): 'waiting' (see autoUploadState), finished (not
// the one recording), and not tried within retryAfterMs of the last attempt's error.
export function pendingUploads(sessions, {now, currentSessionId, since}) {
    const current = currentSessionId === null || currentSessionId === undefined ? null : String(currentSessionId);
    return (sessions || [])
        .filter(s => {
            const meta = s.meta || {};
            return autoUploadState(s, {now, since}) === 'waiting' && String(s.sessionId) !== current &&
                !(Number.isFinite(meta.uploadTriedAt) && now - meta.uploadTriedAt < retryAfterMs(meta.uploadError));
        })
        .sort((a, b) => startOf(a) - startOf(b))
        .map(s => s.sessionId);
}


// The error kind for an upload answer's HTTP status (null: no answer at all), or null for 201,
// the server's only success answer (any other status, other 2xx included, is not a stored file).
export function uploadError(status) {
    if (status === null || status === undefined) {
        return 'offline';
    }
    if (status === 201) {
        return null;
    }
    return {403: 'forbidden', 404: 'notfound', 409: 'exists', 413: 'toolarge', 422: 'refused', 507: 'full'}[status] ?? 'http';
}


// Rider fields never uploaded: heart rate (health data) and cadence (not used by the analysis).
export const UPLOAD_DROP_FIELDS = ['heartrate', 'cadence'];
// Plan rider fields never uploaded: the captain has them already, and they are personal data.
// wkg (the plan's pull_wkg) goes with weight: watts / wkg gives the weight, and the consent text
// says "no weight or FTP". The recording on the rider's PC keeps it.
export const UPLOAD_DROP_PLAN_FIELDS = ['weight', 'ftp', 'adjustment', 'wkg'];
// Head line fields never uploaded: the upload bookkeeping the session row carries (audit fixes,
// 20 Nov 2026, W3). A failed attempt wrote uploadTriedAt and uploadError into the row, which is the
// head line, so the retry's bytes differed from the first copy (probe s3-upload: heads not identical,
// uploadTriedAt/uploadError in the second). The server compares its own processed file on a retry
// (server/logs.mjs:1606-1615), so a landed first copy then answered 409 'exists'.
export const UPLOAD_DROP_HEAD_FIELDS = ['uploadedAt', 'uploadTriedAt', 'uploadError'];


// The recording as uploaded, cut down to what the analysis needs:
// - head line: loses the upload bookkeeping (W3), its plan's riders lose weight, FTP, adjustment and wkg;
// - ticks: only my own row, the rows of riders in the head plan (starters and bench) and the rows
//   marked `inPlan: true` (a rider of the plan loaded at that tick, makeTick) stay, so a watched
//   rider outside the team is left out; every row loses heart rate and cadence. The flag exists
//   since 17 Nov 2026 (ZRL): the plan changed mid-race (7AA3FX -> Y8EAQW), and keeping only the
//   head plan's riders lost the new plan's. A recording from before the flag strips as before. The
//   server drops a row it cannot match to me, the head plan or the tick's plan (det.planSig).
// Lines that are no JSON object, or no tick, pass through untouched. The local export is unchanged.
export function stripForUpload(jsonl) {
    const lines = String(jsonl).split('\n');
    let ids = new Set();
    return lines.map((line, i) => {
        if (!line) {
            return line;
        }
        let obj;
        try {
            obj = JSON.parse(line);
        } catch(e) {
            return line;
        }
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
            return line;
        }
        if (i === 0) {
            const plan = obj.plan && typeof obj.plan === 'object' ? obj.plan : null;
            const list = plan ? [...(Array.isArray(plan.riders) ? plan.riders : []),
                                 ...(Array.isArray(plan.bench) ? plan.bench : [])] : [];
            ids = new Set(list.filter(r => r && typeof r === 'object').map(r => String(r.id)));
            let changed = false;
            for (const f of UPLOAD_DROP_HEAD_FIELDS) {
                if (Object.hasOwn(obj, f)) {
                    delete obj[f];
                    changed = true;
                }
            }
            if (!plan || !Array.isArray(plan.riders)) {
                return changed ? JSON.stringify(obj) : line;
            }
            for (const r of plan.riders) {
                for (const f of UPLOAD_DROP_PLAN_FIELDS) {
                    if (r && typeof r === 'object' && Object.hasOwn(r, f)) {
                        delete r[f];
                        changed = true;
                    }
                }
            }
            return changed ? JSON.stringify(obj) : line;
        }
        if (!Array.isArray(obj.riders)) {
            return line;
        }
        const kept = obj.riders.filter(row => row && typeof row === 'object' &&
            (row.self === true || ids.has(String(row.id)) || row.inPlan === true));
        let changed = kept.length !== obj.riders.length;
        for (const row of kept) {
            for (const f of UPLOAD_DROP_FIELDS) {
                if (Object.hasOwn(row, f)) {
                    delete row[f];
                    changed = true;
                }
            }
        }
        if (!changed) {
            return line;
        }
        obj.riders = kept;
        if (obj.watchingId !== null && obj.watchingId !== undefined &&
            !kept.some(row => String(row.id) === String(obj.watchingId))) {
            obj.watchingId = null;
        }
        return JSON.stringify(obj);
    }).join('\n');
}
