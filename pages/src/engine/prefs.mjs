// Pure logic (no DOM, no Sauce imports): the rider's preferences kept in localStorage
// (paceline:prefs:v1). Anything missing or malformed falls back to the default.
//   targetUnit       'W' | 'Wkg'          pull target: the unit shown first everywhere (the other in
//                                         brackets in the Info window). W/kg by default (0.2.17)
//   targetUnitSet    boolean              the rider picked the unit; before 0.2.17 a stored 'W' was
//                                         just the old default, so it only counts with this set
//   serverOn         boolean              poll the plan server
//   serverUrl        string               plan server base URL
//   serverTeam       string               team name typed by the rider ('' = find me by athlete id)
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
//   restInAction     boolean              action window: also the countdown to my pull (else only my
//                                         pull; the Rest window shows the countdown)
//   demoUntil        number | null        the overlay windows show a made-up ride until then (ms),
//                                         set by the settings window's Demo button
// Plan server status, written by the polling overlay window and shown in settings:
//   serverEtag       string | null        ETag of the last plan taken from the server
//   serverTeamName   string | null        that plan's team name on the server (record.team)
//   serverSig        string | null        that plan's code
//   serverOkAt       number | null        last successful check (ms)
//   serverError      string | null        last check failed: one of SERVER_ERRORS
//   serverCheckedAt  number | null        last check attempt by any window (ms)
import {DEFAULT_SERVER_URL, MAX_TEAM_NAME} from './planserver.mjs';

export const TARGET_UNITS = ['W', 'Wkg'];
export const SERVER_ERRORS = ['offline', 'notfound', 'http', 'invalid', 'badurl'];
export const DEMO_MS = 10 * 60 * 1000;    // the demo stops by itself after this


export function defaultPrefs() {
    return {
        targetUnit: 'Wkg',
        targetUnitSet: false,
        serverOn: true,
        serverUrl: DEFAULT_SERVER_URL,
        serverTeam: '',
        serverEtag: null,
        serverTeamName: null,
        serverSig: null,
        serverOkAt: null,
        serverError: null,
        serverCheckedAt: null,
        logUpload: false,
        logUploadSince: null,
        demoUntil: null,
        showNext: false,
        restInAction: true,
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
    if (typeof raw.serverUrl === 'string' && raw.serverUrl.trim()) {
        p.serverUrl = raw.serverUrl.trim();
    }
    if (typeof raw.serverTeam === 'string') {
        p.serverTeam = raw.serverTeam.trim().replace(/\s+/g, ' ').slice(0, MAX_TEAM_NAME);
    }
    p.serverEtag = str(raw.serverEtag);
    p.serverTeamName = str(raw.serverTeamName);
    p.serverSig = str(raw.serverSig);
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
    if (typeof raw.restInAction === 'boolean') {
        p.restInAction = raw.restInAction;
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


// The changes to store when the rider edits the server settings, or null when nothing changed. A
// changed server, team or on/off starts over (no ETag, no status, check right away), so the new
// choice is fetched and activated.
export function serverConfigChange(prefs, changes) {
    const next = normalizePrefs({...prefs, ...changes});
    const same = next.serverOn === prefs.serverOn && next.serverUrl === prefs.serverUrl &&
        next.serverTeam === prefs.serverTeam;
    if (same) {
        return null;
    }
    return {serverOn: next.serverOn, serverUrl: next.serverUrl, serverTeam: next.serverTeam,
            serverEtag: null, serverTeamName: null, serverSig: null, serverOkAt: null, serverError: null,
            serverCheckedAt: null};
}
