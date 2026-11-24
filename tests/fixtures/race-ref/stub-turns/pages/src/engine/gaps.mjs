// A made-up stand-in for gaps.mjs: remembers every step's arguments in `stub.calls`.
export const GAP_FINISHERS = 4;
export const stub = {calls: []};

export function initialGaps() {
    return {riders: {}, frontId: null, pw: {}, n: 0};
}

export function gapStep(prev, args) {
    stub.calls.push(args);
    return {...prev, n: prev.n + 1};
}
