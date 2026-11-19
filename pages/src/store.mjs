// Browser storage for the plan library and the rider's preferences (localStorage, per Sauce
// window profile).
// The key has no leading "/" on purpose: Sauce-global keys broadcast every write to all windows.
import {importFiles, PlanError} from './engine/plan.mjs';
import {normalizeLibrary, activeEntry} from './engine/library.mjs';
import {LEASE_STALE_MS} from './engine/recording.mjs';
import {normalizePrefs} from './engine/prefs.mjs';
import {normalizeLock, normalizePending} from './engine/planserver.mjs';

export const PLANS_KEY = 'paceline:plans:v1';
export const PREFS_KEY = 'paceline:prefs:v1';
// The ride lock and the latest in-event answer (spec §7.4), written by the poll lease owner.
export const LOCK_KEY = 'paceline:lock:v1';
export const PENDING_KEY = 'paceline:pending:v1';
const FLUSH_EVERY_MS = 60000;

let Common = null;    // Sauce common module, null when opened outside Sauce (standalone preview)
let lastFlush = 0;
let flushTimer = null;


export function readLibrary() {
    let raw;
    try {
        raw = localStorage.getItem(PLANS_KEY);
    } catch(e) {/* storage unavailable */}
    if (raw == null) {
        return normalizeLibrary(null);
    }
    try {
        return normalizeLibrary(JSON.parse(raw));
    } catch(e) {
        console.error('Paceline: unreadable plan library, starting empty', e);
        return normalizeLibrary(null);
    }
}


export function writeLibrary(lib) {
    try {
        localStorage.setItem(PLANS_KEY, JSON.stringify(lib));
    } catch(e) {
        console.error('Paceline: saving plan library failed', e);
    }
    schedFlush();
}


// Re-imports the active entry from its raw files. A corrupt stored entry gives null, not a crash.
export function activePlan() {
    const entry = activeEntry(readLibrary());
    if (!entry) {
        return null;
    }
    try {
        const {plan, warnings} = importFiles([entry.json, entry.text].filter(Boolean));
        if (entry.team) {
            plan.team = entry.team;    // the team name the plan server has it under
        }
        return {plan, warnings};
    } catch(e) {
        if (e instanceof PlanError) {
            console.error('Paceline: stored plan is unusable', e);
            return null;
        }
        throw e;
    }
}


// Sauce writes localStorage to disk lazily: ask it to commit now and then, and when the page closes.
export function initFlush(common) {
    Common = common || null;
    addEventListener('pagehide', flushNow);
}


// Throttled flush (at most once per FLUSH_EVERY_MS); call after every localStorage write.
export function schedFlush() {
    if (!Common || flushTimer) {
        return;
    }
    const wait = Math.max(0, lastFlush + FLUSH_EVERY_MS - Date.now());
    flushTimer = setTimeout(flushNow, wait);
}


function flushNow() {
    clearTimeout(flushTimer);
    flushTimer = null;
    lastFlush = Date.now();
    if (Common) {
        Common.rpc.flushSessionStorage().catch(e => console.warn('Paceline: flush failed', e));
    }
}


// Fires when another window changed the library (the storage event never fires in the writer).
export function onLibraryChange(cb) {
    addEventListener('storage', ev => {
        if (ev.key === PLANS_KEY) {
            cb(readLibrary());
        }
    });
}


// ---- Preferences ----

export function readPrefs() {
    try {
        const raw = localStorage.getItem(PREFS_KEY);
        return normalizePrefs(raw == null ? null : JSON.parse(raw));
    } catch(e) {
        return normalizePrefs(null);
    }
}


// Merges `changes` into the stored preferences and returns the result.
export function writePrefs(changes) {
    const prefs = normalizePrefs({...readPrefs(), ...changes});
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch(e) {
        console.error('Paceline: saving preferences failed', e);
    }
    schedFlush();
    return prefs;
}


// Fires when another window changed the preferences.
export function onPrefsChange(cb) {
    addEventListener('storage', ev => {
        if (ev.key === PREFS_KEY) {
            cb(readPrefs());
        }
    });
}


// ---- Ride lock and pending answer ----

function readKey(key, normalize) {
    try {
        const raw = localStorage.getItem(key);
        return raw == null ? null : normalize(JSON.parse(raw));
    } catch(e) {
        return null;
    }
}


function writeKey(key, value) {
    try {
        if (value === null) {
            localStorage.removeItem(key);
        } else {
            localStorage.setItem(key, JSON.stringify(value));
        }
    } catch(e) {
        console.error('Paceline: saving', key, 'failed', e);
    }
    schedFlush();
}


// null, {state: 'empty', eventKey} or {state: 'bound', circle, slug, eventKey}; malformed: null.
export function readLock() {
    return readKey(LOCK_KEY, normalizeLock);
}


export function writeLock(lock) {
    writeKey(LOCK_KEY, normalizeLock(lock));
}


// {eventKey, at, plans, hint} or null; malformed: null.
export function readPending() {
    return readKey(PENDING_KEY, normalizePending);
}


export function writePending(p) {
    writeKey(PENDING_KEY, normalizePending(p));
}


// Fires when another window changed `key` (the storage event never fires in the writer).
export function onKeyChange(key, cb) {
    addEventListener('storage', ev => {
        if (ev.key === key) {
            cb();
        }
    });
}


// ---- Recorder state, written by the overlay (Task 5), read here to mark the live session ----
export const LEASE_KEY = 'paceline:rec-owner';
// The one overlay window that polls the plan server (pollLeaseStep). Separate from the recorder's
// lease, which needs my athlete id; the plan server is also polled before Zwift runs.
export const POLL_LEASE_KEY = 'paceline:poll-owner';
export const REC_STATE_KEY = 'paceline:rec-state';


// The session the overlay is recording right now, or null. A stale lease means a dead recorder.
export function liveSessionId() {
    try {
        const st = JSON.parse(localStorage.getItem(REC_STATE_KEY));
        const lease = JSON.parse(localStorage.getItem(LEASE_KEY));
        if (!st || st.recording !== true || !lease) {
            return null;
        }
        const age = Date.now() - lease.at;
        if (!(age >= 0 && age < LEASE_STALE_MS)) {
            return null;
        }
        return st.sessionId ?? null;
    } catch(e) {
        return null;
    }
}
