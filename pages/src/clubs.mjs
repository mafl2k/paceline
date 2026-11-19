// Browser storage for the Clubs table (spec §7.2): the working copy in localStorage (CLUBS_KEY, per
// Sauce window profile), which every window follows through the storage event. The table belongs
// to one plan server (normalizeClubs): pass the server base URL.
// Inside Sauce, initClubs() also shares the table with the other window profiles through Sauce's
// app settings (engine/clubs-shared.mjs); without Common nothing is shared.
import {CLUBS_KEY, normalizeClubs} from './engine/clubs.mjs';
import {makeShared} from './engine/clubs-shared.mjs';
import {schedFlush} from './store.mjs';

const listeners = [];     // onClubsChange callbacks, also called when a merge changed the local copy


// The table for `server` ({server, clubs}); missing, unreadable or another server's: empty.
export function readClubs(server) {
    try {
        const raw = localStorage.getItem(CLUBS_KEY);
        return normalizeClubs(raw == null ? null : JSON.parse(raw), server);
    } catch(e) {
        return normalizeClubs(null, server);
    }
}


function putLocal(state) {
    try {
        localStorage.setItem(CLUBS_KEY, JSON.stringify(state));
    } catch(e) {
        console.error('Paceline: saving the clubs failed', e);
    }
    schedFlush();
}


let shared = makeShared({rpc: null});


export function writeClubs(state) {
    putLocal(state);
    shared.written(state);
}


const INIT_TIMEOUT_MS = 4000;


// Once per window, at start: with Sauce (Common.rpc), merge the shared copy into the local one and
// store both where they differ (a failed read writes nothing). `server` is the plan server base
// URL; null or no Common: nothing is shared. The window's onClubsChange callbacks run when the
// merge changed the local table. Never rejects. Resolves when done, or after INIT_TIMEOUT_MS if
// Sauce hangs (the window then goes on with the local copy; the merge may still land later).
export function initClubs(Common, server) {
    shared = makeShared({
        rpc: Common && Common.rpc,
        readLocal: readClubs,
        writeLocal: putLocal,
        changed: () => listeners.forEach(cb => cb()),
        log: (msg, e) => console.warn(msg, e),
    });
    let timer;
    const late = new Promise(ok => { timer = setTimeout(ok, INIT_TIMEOUT_MS); });
    return Promise.race([shared.init(server), late]).finally(() => clearTimeout(timer));
}


// Fires when another window changed the table.
export function onClubsChange(cb) {
    listeners.push(cb);
    addEventListener('storage', ev => {
        if (ev.key === CLUBS_KEY) {
            cb();
        }
    });
}
