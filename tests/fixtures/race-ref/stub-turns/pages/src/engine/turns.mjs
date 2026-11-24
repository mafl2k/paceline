// A made-up stand-in for turns.mjs, for the race reference's adapter of the turn clocks. `stub`
// says what the engine reports: the shown puller (0-based plan index, `puller`; null none), with
// `onlyFiltered` only while the power filter is on (the step's `filter`), the display, who is
// present and who hangs (plan indexes), a view. `stub.calls` keeps every step's arguments,
// `stub.status` every turnsStatus call's options. `prov` ({puller: plan index, toMy}): the
// provisional view turnsStatus gives while its `provisional` option is on (else none).
export const stub = {puller: null, onlyFiltered: false, disp: false, present: [0, 1, 2], hanging: [], view: null, calls: [],
                     prov: null, status: []};

export function initialTurns() {
    return {n: 0, front: {puller: null}, present: [], hanging: [], disp: null, hill: {mode: null}};
}

export function turnsStep(prev, args) {
    stub.calls.push(args);
    const ids = args.plan.riders.map(r => String(r.id));
    const show = stub.puller !== null && (!stub.onlyFiltered || args.filter === true);
    return {state: {n: prev.n + 1, front: {puller: show ? ids[stub.puller] : null}, present: stub.present.map(i => ids[i]),
                    hanging: stub.hanging.map(i => ids[i]), disp: stub.disp ? {at: args.now} : null,
                    hill: {mode: args.terrain?.hill && !args.terrain.hill.roller ? 'pause' : null},
                    locked: false, finish: false, still: {still: false}}, self: null};
}

export function turnsStatus(st, opts = {}) {
    stub.status.push(opts);
    if (stub.prov && opts.provisional) {
        return {view: {provisional: true, puller: opts.plan.riders[stub.prov.puller], mine: false, toMyPullS: stub.prov.toMy,
                       elapsedS: 5}, reason: null};
    }
    return stub.view ? {view: stub.view, reason: null} : {view: null, reason: 'nofront'};
}
