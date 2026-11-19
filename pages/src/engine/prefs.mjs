// Pure logic (no DOM, no Sauce imports): the rider's preferences kept in localStorage
// (paceline:prefs:v1). Anything missing or malformed falls back to the default.
//   targetUnit       'W' | 'Wkg'          pull target: the unit shown first everywhere (the other in
//                                         brackets in the Info window). W/kg by default (0.2.17)
//   targetUnitSet    boolean              the rider picked the unit; before 0.2.17 a stored 'W' was
//                                         just the old default, so it only counts with this set
//   serverOn         boolean              poll the plan server
//   serverUrl        string               plan server base URL: the typed one, else the build's
//                                         DEFAULT_SERVER_URL (spec §10)
//   serverUrlSet     boolean              the rider typed serverUrl. A stored URL counts only with
//                                         it (true); without it (0.2) the default applies
//   logUpload        boolean              upload finished recordings to the plan server (opt-in)
//   logUploadSince   number | null        when the rider ticked that box (ms); only rides started
//                                         since then go up on their own. null while it is off.
//   showNext         boolean              captain mode: the Info window's "Next" line under Front
//   showRotation     boolean              in captain mode also the rotation table during the ride
//                                         (everyone has it before the start)
//   tttOnly          boolean              everything (windows, recorder, plan server) only during TTT
//                                         events, from the start pen to the finish (default on)
//   recordWithoutPlan boolean             in a TTT event also record without a plan that has me in it
//                                         (default off: such a recording never goes up)
//   demoUntil        number | null        the overlay windows show a made-up ride until then (ms),
//                                         set by the settings window's Demo button
// Plan server status, written by the polling overlay window and shown in settings:
//   serverEtag       string | null        etag of the last plan taken from the server
//   serverSig        string | null        that plan's code
//   serverLabel      string | null        that plan's label (record.label)
//   serverClub       string | null        that plan's club name (record.circle.name)
//   serverNotice     string | null        the server's notice for this Paceline version (answer.notice)
//   serverFits       number | null        2 or more: that many clubs' plans fit, the pen rule picks
//   serverOpensAt    number | null        no plan yet, one opens then (ms, a body-less record's opensAt)
//   serverOpensLabel string | null        that record's label
//   serverOkAt       number | null        last successful check (ms)
//   serverError      string | null        last check failed: one of SERVER_ERRORS
//   serverCheckedAt  number | null        last check attempt by any window (ms)
import {DEFAULT_SERVER_URL, serverBase} from './planserver.mjs';

export const TARGET_UNITS = ['W', 'Wkg'];
export const SERVER_ERRORS = ['offline', 'notfound', 'http', 'invalid', 'badurl'];
export const DEMO_MS = 10 * 60 * 1000;    // the demo stops by itself after this


export function defaultPrefs() {
    return {
        targetUnit: 'Wkg',
        targetUnitSet: false,
        serverOn: true,
        serverUrl: DEFAULT_SERVER_URL,
        serverUrlSet: false,
        serverEtag: null,
        serverSig: null,
        serverLabel: null,
        serverClub: null,
        serverNotice: null,
        serverFits: null,
        serverOpensAt: null,
        serverOpensLabel: null,
        serverOkAt: null,
        serverError: null,
        serverCheckedAt: null,
        logUpload: false,
        logUploadSince: null,
        demoUntil: null,
        showNext: false,
        showRotation: false,
        tttOnly: true,
        recordWithoutPlan: false,
    };
}


const str = v => typeof v === 'string' && v !== '' ? v : null;
const time = v => Number.isFinite(v) ? v : null;


export function normalizePrefs(raw) {
    const p = defaultPrefs();
    if (!raw || typeof raw !== 'object') {
        return p;
    }
    if (raw.targetUnitSet === true && TARGET_UNITS.includes(raw.targetUnit)) {
        p.targetUnit = raw.targetUnit;
        p.targetUnitSet = true;
    }
    if (typeof raw.serverOn === 'boolean') {
        p.serverOn = raw.serverOn;
    }
    const url = typeof raw.serverUrl === 'string' ? raw.serverUrl.trim() : '';
    if (url && raw.serverUrlSet === true) {
        p.serverUrl = url;
        p.serverUrlSet = true;
    }
    p.serverEtag = str(raw.serverEtag);
    p.serverSig = str(raw.serverSig);
    p.serverLabel = str(raw.serverLabel);
    p.serverClub = str(raw.serverClub);
    p.serverNotice = str(raw.serverNotice);
    p.serverFits = time(raw.serverFits);
    p.serverOpensAt = time(raw.serverOpensAt);
    p.serverOpensLabel = str(raw.serverOpensLabel);
    p.serverOkAt = time(raw.serverOkAt);
    p.serverError = SERVER_ERRORS.includes(raw.serverError) ? raw.serverError : null;
    p.serverCheckedAt = time(raw.serverCheckedAt);
    if (typeof raw.logUpload === 'boolean') {
        p.logUpload = raw.logUpload;
    }
    p.logUploadSince = p.logUpload ? time(raw.logUploadSince) : null;
    p.demoUntil = time(raw.demoUntil);
    if (typeof raw.showNext === 'boolean') {
        p.showNext = raw.showNext;
    }
    if (typeof raw.showRotation === 'boolean') {
        p.showRotation = raw.showRotation;
    }
    if (typeof raw.tttOnly === 'boolean') {
        p.tttOnly = raw.tttOnly;
    }
    if (typeof raw.recordWithoutPlan === 'boolean') {
        p.recordWithoutPlan = raw.recordWithoutPlan;
    }
    return p;
}


// The changes for ticking (true) or unticking (false) the upload box.
export function logUploadChange(on, now) {
    return on ? {logUpload: true, logUploadSince: now} : {logUpload: false, logUploadSince: null};
}


// The changes for starting (true) or stopping (false) the demo.
export function demoChange(on, now) {
    return {demoUntil: on ? now + DEMO_MS : null};
}


// True while the demo runs. An end further away than DEMO_MS (clock set back) counts as over.
export function demoOn(prefs, now) {
    const until = prefs && prefs.demoUntil;
    return Number.isFinite(until) && now < until && until - now <= DEMO_MS;
}


// The box was ticked before Paceline kept the tick time (0.2.1): count from now, so rides from
// before the update stay on the machine unless the rider presses Upload. null when nothing to fix.
export function logUploadSinceFix(prefs, now) {
    return prefs.logUpload && prefs.logUploadSince === null ? {logUploadSince: now} : null;
}


// The changes to store when the rider edits the server settings ({serverOn, serverUrl}), or null
// when nothing changed. A URL counts as typed unless it is empty or the build's default. A changed
// server or on/off starts over (no etag, no status, check right away).
export function serverConfigChange(prefs, changes) {
    const merged = {...prefs, ...changes};
    if (typeof changes?.serverUrl === 'string') {
        const trimmed = changes.serverUrl.trim();
        merged.serverUrl = trimmed;
        merged.serverUrlSet = trimmed !== '' && serverBase(trimmed) !== serverBase(DEFAULT_SERVER_URL);
    }
    const next = normalizePrefs(merged);
    const same = next.serverOn === prefs.serverOn && next.serverUrl === prefs.serverUrl &&
        next.serverUrlSet === prefs.serverUrlSet;
    if (same) {
        return null;
    }
    return {serverOn: next.serverOn, serverUrl: next.serverUrl, serverUrlSet: next.serverUrlSet,
            serverEtag: null, serverSig: null, serverLabel: null, serverClub: null, serverNotice: null,
            serverFits: null, serverOpensAt: null, serverOpensLabel: null, serverOkAt: null, serverError: null,
            serverCheckedAt: null};
}
