// Which Paceline windows are open (user, 13 Nov 2026): every window writes a sign of life under its
// own private key every ALIVE_REFRESH_MS ({mode, at, clock, shows}); a window not heard for
// ALIVE_STALE_MS counts as closed. One key per window, so windows never overwrite each other. The Rest window hides
// from READY on only while an Action window is open, and an Action window without the countdown shows
// it anyway while no Rest window is open, so no set of windows leaves the rider without it. The Rest
// window's sign of life says whether it shows its countdown (clock, audit fixes, 20 Nov 2026, W2):
// the Action window hands the countdown over only to one that does (restClockShown), or back to one
// that shows what it showed a moment ago (shows, final review, 21 Nov 2026, I-1: restShows).
// Pure logic (no DOM, no Sauce imports).

export const ALIVE_PREFIX = 'paceline:alive:';
export const ALIVE_REFRESH_MS = 2000;
export const ALIVE_STALE_MS = 6000;
export const ALIVE_DROP_MS = 3600000;    // keys of windows gone this long are removed


export function aliveKey(id) {
    return ALIVE_PREFIX + id;
}


// What a Rest window can say it shows (display.mjs restShowsOf; final review, 21 Nov 2026, I-1).
export const REST_SHOWS = ['clock', 'pull', 'ready', 'dash'];


// A stored sign of life, or null when it is not one. clock: the window shows its countdown (only
// true when written so; a sign of life of an older version has none and counts as false). shows:
// what a Rest window shows (REST_SHOWS), only when it says so.
export function parseAlive(raw) {
    try {
        const v = JSON.parse(raw);
        if (!v || typeof v.mode !== 'string' || !Number.isFinite(v.at)) {
            return null;
        }
        const out = {mode: v.mode, at: v.at, clock: v.clock === true};
        return REST_SHOWS.includes(v.shows) ? {...out, shows: v.shows} : out;
    } catch(e) {
        return null;
    }
}


// entries: [[id, {mode, at, clock} | null], ...] (parseAlive). The modes of the other windows heard recently.
export function aliveModes(entries, {now, selfId}) {
    const modes = new Set();
    for (const [id, v] of entries) {
        if (id !== selfId && v && now - v.at < ALIVE_STALE_MS) {
            modes.add(v.mode);
        }
    }
    return modes;
}


// Whether another Rest window heard recently shows its countdown (audit fixes, 20 Nov 2026, W2).
// The Action window handed the countdown to a Rest window as soon as it was open: probe s9-restopen,
// a Rest window opened mid-rest showed nothing for 1.5 s (1.0 s on the rerun) while the Action
// window was already blank. Now the Rest window must say it shows the countdown (clock).
export function restClockShown(entries, {now, selfId}) {
    return entries.some(([id, v]) => id !== selfId && v && v.mode === 'rest' && v.clock === true &&
                                     now - v.at < ALIVE_STALE_MS);
}


// What the other Rest windows heard recently say they show (REST_SHOWS), for the hand-back of the
// countdown (display.mjs restHandBack; final review, 21 Nov 2026, I-1).
export function restShows(entries, {now, selfId}) {
    const out = new Set();
    for (const [id, v] of entries) {
        if (id !== selfId && v && v.mode === 'rest' && v.shows && now - v.at < ALIVE_STALE_MS) {
            out.add(v.shows);
        }
    }
    return out;
}


// The ids whose entries are unreadable or older than ALIVE_DROP_MS.
export function staleKeys(entries, now) {
    return entries.filter(([, v]) => !v || now - v.at >= ALIVE_DROP_MS).map(([id]) => id);
}


export function aliveDue(lastAt, now) {
    return lastAt === null || now - lastAt >= ALIVE_REFRESH_MS;
}
