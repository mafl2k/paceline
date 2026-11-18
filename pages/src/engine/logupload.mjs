// Pure logic (no DOM, no Sauce imports): uploading finished recordings to the plan server
// (POST {server}/api/log/<slug>?session=<ms>&athlete=<id>, raw gzip body, see server/server.mjs).
// The lease-owning overlay window sweeps the recordings now and then and uploads one at a time;
// each session row keeps uploadedAt, or uploadTriedAt and uploadError after a failed attempt.
// Only rides started after the rider ticked the upload box (prefs.logUploadSince) go up on their
// own; the Upload button in settings sends any finished one.
import {serverBase, teamSlug} from './planserver.mjs';

export const UPLOAD_MIN_TICKS = 60;             // shorter recordings are no ride worth sending
export const UPLOAD_RETRY_MS = 300000;          // a failed session is tried again after this
export const NOTFOUND_RETRY_MS = 3600000;       // ... or after this when the team had no plan
export const UPLOAD_MAX_AGE_MS = 7 * 864e5;     // older recordings are left alone
export const SWEEP_MS = 60000;                  // how often the overlay looks for pending ones


// The team slug a recording goes under: the typed team name, else the server plan's team name,
// else the active plan's team; null when none gives a slug.
export function logSlug(prefs, plan) {
    return teamSlug(prefs?.serverTeam) || teamSlug(prefs?.serverTeamName) || teamSlug(plan?.team) || null;
}


// The team a recording is filed under: the slug stored when it started (so a ride with team A
// goes to team A even after the rider's plan switched to team B), else, for recordings made
// before 0.2.12, the current one.
export function sessionSlug(meta, prefs, plan) {
    return teamSlug(meta?.slug) || logSlug(prefs, plan);
}


const idOf = v => v === null || v === undefined ? '' : String(v);


// The upload URL, or null when the server URL, the slug or an id is unusable.
export function logUploadUrl({url, slug, sessionId, athleteId}) {
    const base = serverBase(url);
    const session = idOf(sessionId);
    const athlete = idOf(athleteId);
    if (!base || typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug) ||
        !/^\d{1,16}$/.test(session) || !/^\d{1,12}$/.test(athlete)) {
        return null;
    }
    return `${base}/api/log/${slug}?session=${session}&athlete=${athlete}`;
}


function startOf(s) {
    const t = s.meta?.startedAt;
    return Number.isFinite(t) ? t : Number(s.sessionId);
}


// How long after a failed attempt the sweep tries a session again, by the attempt's error kind:
// a missing plan an hour later, a too large one never (its size won't change), else UPLOAD_RETRY_MS.
export function retryAfterMs(kind) {
    return kind === 'notfound' ? NOTFOUND_RETRY_MS : kind === 'toolarge' ? Infinity : UPLOAD_RETRY_MS;
}


// What becomes of a recording on its own: 'uploaded', 'waiting' (the sweep sends it, perhaps after
// a retry delay) or 'manual' (only the Upload button sends it: too short, too old, started before
// the box was ticked (`since`, null when it is not), too large for the server, or the plan server
// is switched off (`serverOn` false; left out counts as on)).
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
    return status === 404 ? 'notfound' : status === 413 ? 'toolarge' : status === 507 ? 'full' : 'http';
}


// Rider fields never uploaded: heart rate (health data) and cadence (not used by the analysis).
export const UPLOAD_DROP_FIELDS = ['heartrate', 'cadence'];
// Plan rider fields never uploaded: the captain has them already, and they are personal data.
export const UPLOAD_DROP_PLAN_FIELDS = ['weight', 'ftp', 'adjustment'];


// The recording as uploaded, cut down to what the analysis needs:
// - head line: the plan's riders lose weight, FTP and adjustment;
// - ticks: only my own row and the rows of riders in the plan (starters and bench) stay, so a
//   watched rider outside the team is left out; every row loses heart rate and cadence.
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
            if (!plan || !Array.isArray(plan.riders)) {
                return line;
            }
            let changed = false;
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
            (row.self === true || ids.has(String(row.id))));
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
