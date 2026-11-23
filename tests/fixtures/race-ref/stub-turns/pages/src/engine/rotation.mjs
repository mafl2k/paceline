// A made-up stand-in for the shared helpers of the new core's checkout, for the race reference's
// adapter of the turn clocks (tools/race-ref/engines.mjs): only what that adapter calls from
// rotation.mjs. Positions are the plan riders in the nearby list's order, 5 m apart.
export const DRAFT_N = 3;

export function pushPower(hist, sample) {
    return [...hist, sample];
}

export function selfLive() {
    return true;
}

export function alignedPositions(nearby, ids) {
    return (nearby || []).filter(e => ids.has(String(e.athleteId))).map((e, i) => ({id: String(e.athleteId), x: -5 * i}));
}
