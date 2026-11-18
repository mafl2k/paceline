// Which Paceline windows are open (user, 13 Nov 2026): every window writes a sign of life under its
// own private key every ALIVE_REFRESH_MS ({mode, at}); a window not heard for ALIVE_STALE_MS counts
// as closed. One key per window, so windows never overwrite each other. The Rest window hides from
// READY on only while an Action window is open, and an Action window without the countdown shows
// it anyway while no Rest window is open, so no set of windows leaves the rider without it.
// Pure logic (no DOM, no Sauce imports).

export const ALIVE_PREFIX = 'paceline:alive:';
export const ALIVE_REFRESH_MS = 2000;
export const ALIVE_STALE_MS = 6000;
export const ALIVE_DROP_MS = 3600000;    // keys of windows gone this long are removed


export function aliveKey(id) {
    return ALIVE_PREFIX + id;
}


// A stored sign of life, or null when it is not one.
export function parseAlive(raw) {
    try {
        const v = JSON.parse(raw);
        return v && typeof v.mode === 'string' && Number.isFinite(v.at) ? {mode: v.mode, at: v.at} : null;
    } catch(e) {
        return null;
    }
}


// entries: [[id, {mode, at} | null], ...]. The modes of the other windows heard recently.
export function aliveModes(entries, {now, selfId}) {
    const modes = new Set();
    for (const [id, v] of entries) {
        if (id !== selfId && v && now - v.at < ALIVE_STALE_MS) {
            modes.add(v.mode);
        }
    }
    return modes;
}


// The ids whose entries are unreadable or older than ALIVE_DROP_MS.
export function staleKeys(entries, now) {
    return entries.filter(([, v]) => !v || now - v.at >= ALIVE_DROP_MS).map(([id]) => id);
}


export function aliveDue(lastAt, now) {
    return lastAt === null || now - lastAt >= ALIVE_REFRESH_MS;
}
