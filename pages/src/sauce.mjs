// Sauce glue shared by the pages: load Sauce's common module (with a standalone fallback so the
// pages also open in a plain browser) and read the own athlete id.
let common = null;


export async function loadCommon() {
    try {
        common = await import('/pages/src/common.mjs');
    } catch(e) {
        console.warn('Paceline: Sauce common.mjs not available, running standalone.', e);
        common = null;
        document.documentElement.classList.add('standalone');
    }
    return common;
}


// ?demo and no Sauce: a plain-browser preview.
export function isDemo() {
    return !common && new URLSearchParams(location.search).has('demo');
}


// My weight (kg) as Sauce has it, or null.
export async function selfWeight(Common) {
    if (!Common) {
        return null;
    }
    try {
        const ad = await Common.rpc.getAthleteData('self');
        const w = ad && ad.athlete && ad.athlete.weight;
        return Number.isFinite(w) && w > 0 ? w : null;
    } catch(e) {
        return null;
    }
}


export async function selfAthleteId(Common) {
    if (!Common) {
        return null;
    }
    try {
        const ad = await Common.rpc.getAthleteData('self');
        const id = ad && (ad.athleteId ?? ad.state?.athleteId);
        return id === null || id === undefined ? null : String(id);
    } catch(e) {
        console.warn('Paceline: could not read own athlete id', e);
        return null;
    }
}
