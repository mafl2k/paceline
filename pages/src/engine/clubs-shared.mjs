// The Clubs table shared by all Sauce window profiles (spec §7.2, C1 passed): Sauce's app settings
// (rpc.getSetting/setSetting under CLUBS_KEY) hold one copy next to the per-profile localStorage
// copy. No DOM, no Sauce: the storage calls are passed in, so it runs under node.
// The merge (newer changedAt per row) happens once, when a window starts (init). A later write
// overwrites the shared copy with the local table and does not merge: a row the server dropped
// (`gone`) must stay dropped, and Sauce has one active profile at a time. setSetting rewrites
// Sauce's whole settings blob and there is no change event, so a write is made only when the table
// differs from the last one this window read or wrote.
import {CLUBS_KEY, normalizeClubs, mergeClubs} from './clubs.mjs';


// The table as a string, rows sorted by id, so equal tables compare equal whatever their row order.
export function canon(state) {
    return JSON.stringify({server: state.server, clubs: [...state.clubs].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)});
}


// What to do with the local table and the shared value as read (anything: it is normalised).
// merged = mergeClubs(local, shared): the newer changedAt wins per row. `localChanged`: store merged
// locally; `sharedChanged`: store merged in the shared copy. Another server's shared table counts
// as empty, as for the local one.
export function planShared(local, rawShared, server) {
    const shared = normalizeClubs(rawShared, server);
    const merged = mergeClubs(local, shared);
    const m = canon(merged);
    return {merged, localChanged: m !== canon(local), sharedChanged: m !== canon(shared)};
}


// rpc: {getSetting, setSetting} (Sauce), or null/without them (plain browser: nothing is shared).
// readLocal(server) -> table; writeLocal(table) stores the local copy only (it must not call
// written()); changed() tells the window its local table moved (init only); log(msg, err) is called
// once.
export function makeShared({rpc, readLocal, writeLocal, changed, log}) {
    let server = null;
    let lastJson = null;      // the table as this window last read or wrote it in the shared copy
    let queue = Promise.resolve();
    let warned = false;

    function fail(what, e) {
        if (!warned) {
            warned = true;
            log(`Paceline: the shared clubs copy failed (${what}); the local copy keeps working`, e);
        }
    }

    // One read-merge-write at a time, so nothing lands between a read and its write. A failed read
    // never writes, and switches sharing off for this window.
    async function sync() {
        let raw;
        try {
            raw = await rpc.getSetting(CLUBS_KEY);
        } catch(e) {
            // Never write what was not merged: this window stays local-only.
            fail('read', e);
            server = null;
            return;
        }
        const plan = planShared(readLocal(server), raw, server);
        if (plan.localChanged) {
            writeLocal(plan.merged);
            changed();
        }
        if (plan.sharedChanged) {
            try {
                await rpc.setSetting(CLUBS_KEY, JSON.parse(JSON.stringify(plan.merged)));
            } catch(e) {
                fail('write', e);
                return;     // lastJson stays: the next write tries again
            }
        }
        lastJson = canon(plan.merged);
    }

    function job() {
        queue = queue.then(sync).catch(e => fail('sync', e));
        return queue;
    }

    return {
        // Once per window, at start: read the shared copy, merge it with the local one, write local
        // and shared where they differ. Resolves when done; never rejects.
        init(base) {
            if (!rpc || typeof rpc.getSetting !== 'function' || typeof rpc.setSetting !== 'function' || !base) {
                return Promise.resolve();
            }
            server = base;
            lastJson = null;
            return job();
        },
        // After the local copy was stored: overwrite the shared copy with this table (no read, no
        // merge) unless it already holds exactly this. Runs after an init still in flight.
        written(state) {
            if (server === null || state.server !== server || canon(state) === lastJson) {
                return Promise.resolve();
            }
            const json = canon(state);
            const copy = JSON.parse(JSON.stringify(state));
            queue = queue.then(async () => {
                if (json === lastJson) {
                    return;
                }
                try {
                    await rpc.setSetting(CLUBS_KEY, copy);
                } catch(e) {
                    fail('write', e);
                    return;     // lastJson stays: the next write tries again
                }
                lastJson = json;
            }).catch(e => fail('sync', e));
            return queue;
        },
    };
}
