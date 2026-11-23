// A made-up stand-in for an old engine's rotation.mjs, for the race reference's engine adapter
// (tools/race-ref/engines.mjs). It has the minimum the adapter calls and nothing newer: no
// DRAFT_N, no rotationStatus view unless asked. The tests change `stub` to pick what it reports;
// `stub.tick(n)` may return overrides for the n-th rotation step (1-based), e.g. to make two ticks
// of one second differ. Every 60 steps the shown puller moves on to the next plan rider (or the
// plan rider `puller` names, 0-based); riders 1-3 of the plan are present (none listed when
// `noPresent`), the third sits out when `out` names him, the rest are not in the group.
export const stub = {outKind: 'set', view: false, chaos: false, reason: null, hill: false, noPresent: false, puller: null, tick: null};

export function initialRotation() {
    return {n: 0, front: {puller: null}, present: [], order: {chaos: false, out: new Set()}, hill: null, cfg: stub};
}

export function pushPower(hist, sample) {
    return [...hist, sample];
}

export function selfLive() {
    return true;
}

export function rotationStep(prev, {plan}) {
    const n = prev.n + 1;
    const cfg = {...stub, ...(stub.tick?.(n) ?? {})};
    const ids = plan.riders.map(r => String(r.id));
    const third = ids[2];
    const out = cfg.outKind === 'set' ? new Set([third]) : cfg.outKind === 'array' ? [third] :
        cfg.outKind === 'object' ? {[third]: true} : undefined;
    const st = {n, cfg, front: {puller: ids[cfg.puller ?? Math.floor((n - 1) / 60) % ids.length]},
                order: {chaos: cfg.chaos, out}, hill: cfg.hill ? {mode: 'pause'} : null};
    if (!cfg.noPresent) {
        st.present = ids.filter(id => id !== ids[3] && id !== ids[4]);
    }
    return {state: st};
}

export function rotationStatus(st) {
    const out = {reason: st.cfg.reason};
    if (st.cfg.view) {
        out.view = st.cfg.view === true ? {mine: false, toMyPullS: 42, elapsedS: 0} : st.cfg.view;
    }
    return out;
}
