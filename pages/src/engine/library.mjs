// Pure logic (no DOM, no Sauce imports): the library of imported plans kept in localStorage.
// An Entry is {sig, json, text, loadedAt}: the raw export files, so a plan is re-imported on load.
// A plan from the plan server also has `team`: the team name it was uploaded under.
// `source` is 'file' (loaded by the rider) or 'server'. A file plan has `endedAt` once removed or
// replaced (spec §7.5); a server entry also keeps label, circleId, circleName, slug, eventKey,
// etag, startAt and role. An entry without `source` (0.2, with or without `team`) is an ended
// file plan: never active with the plan server on, still usable with it off (fileEnded).
export const MAX_PLANS = 10;
// A file plan never outlives its load by more than this (it also ends at the first gate close).
export const FILE_MAX_MS = 18 * 3600000;
const SERVER_FIELDS = ['label', 'circleId', 'circleName', 'slug', 'eventKey', 'etag', 'startAt', 'role'];


function normalizeEntry(sig, e) {
    if (!e || typeof e !== 'object' || typeof e.json !== 'string') {
        return null;
    }
    const entry = {
        sig,
        json: e.json,
        text: typeof e.text === 'string' ? e.text : null,
        loadedAt: Number.isFinite(e.loadedAt) ? e.loadedAt : 0,
    };
    if (typeof e.team === 'string' && e.team.trim()) {
        entry.team = e.team.trim();
    }
    if (e.source === 'file' || e.source === 'server') {
        entry.source = e.source;
    } else {
        entry.source = 'file';
        entry.endedAt = 0;    // a 0.2 plan: ended, as far as the plan server is concerned
    }
    if (entry.source === 'file' && Number.isFinite(e.endedAt)) {
        entry.endedAt = e.endedAt;
    }
    for (const k of SERVER_FIELDS) {
        if (typeof e[k] === 'string') {
            entry[k] = e[k];
        }
    }
    return entry;
}


export function normalizeLibrary(raw) {
    const plans = {};
    const src = raw && typeof raw === 'object' && raw.plans && typeof raw.plans === 'object' ? raw.plans : {};
    for (const [sig, e] of Object.entries(src)) {
        const entry = normalizeEntry(sig, e);
        if (entry) {
            plans[sig] = entry;
        }
    }
    const active = raw && typeof raw.active === 'string' && Object.hasOwn(plans, raw.active) ? raw.active : null;
    return {plans, active};
}


export function addPlan(lib, entry) {
    const plans = {...lib.plans, [entry.sig]: {...entry}};
    const keep = Object.values(plans)
        .sort((a, b) => b.loadedAt - a.loadedAt)
        .slice(0, MAX_PLANS)
        .map(e => e.sig);
    if (!keep.includes(entry.sig)) {
        // The new plan is the active one and must survive even with an old loadedAt.
        keep[keep.length - 1] = entry.sig;
    }
    const kept = {};
    for (const sig of keep) {
        kept[sig] = plans[sig];
    }
    return {plans: kept, active: entry.sig};
}


export function activeEntry(lib) {
    return lib.active != null ? lib.plans[lib.active] ?? null : null;
}


// The library entry for a plan the rider loaded from files.
export function fileEntry({sig, json, text, now}) {
    return {sig, json, text, loadedAt: now, source: 'file'};
}


// A file plan is over once it was ended, or 18 h after loading. The gate-close end is recorded
// with endFilePlan. With the plan server off nothing ends: the rider keeps his plan.
export function fileEnded(entry, {now, serverOn}) {
    if (!serverOn || !entry || entry.source !== 'file') {
        return false;
    }
    return Number.isFinite(entry.endedAt) || now - entry.loadedAt >= FILE_MAX_MS;
}


// The active entry is a file plan that has not ended.
export function fileActive(lib, {now, serverOn}) {
    const e = activeEntry(lib);
    return !!e && e.source === 'file' && !fileEnded(e, {now, serverOn});
}


// The entry the windows ride: the active one, unless it is a file plan that has ended (a 0.2
// plan, e.g. the server's "Update Paceline" notice, is one with the plan server on). The library
// keeps it active until the next server check drops it; until then the windows have no plan.
export function planEntry(lib, {now, serverOn}) {
    const e = activeEntry(lib);
    return e && !fileEnded(e, {now, serverOn}) ? e : null;
}


// Mark the active file plan ended and deactivate it. Anything else comes back unchanged.
export function endFilePlan(lib, now) {
    const e = activeEntry(lib);
    if (!e || e.source !== 'file') {
        return lib;
    }
    return {plans: {...lib.plans, [e.sig]: {...e, endedAt: now}}, active: null};
}


// The file plan a gate close ends: one loaded by the time the event was last seen (`seenAt`, the
// gate's). A file plan loaded after that (a late close, e.g. after a long gap in the data) stays.
export function endsAtGateClose(entry, seenAt) {
    return entry?.source === 'file' && Number.isFinite(seenAt) && entry.loadedAt <= seenAt;
}
