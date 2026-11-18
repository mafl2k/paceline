// Pure logic (no DOM, no Sauce imports): the library of imported plans kept in localStorage.
// An Entry is {sig, json, text, loadedAt}: the raw export files, so a plan is re-imported on load.
// A plan from the plan server also has `team`: the team name it was uploaded under.
export const MAX_PLANS = 10;


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
