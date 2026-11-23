// A made-up stand-in for terrain.mjs: buildClimbIndex gives one item per route (`route.items`, else
// a hill from 0 to 100 m) and remembers its arguments in `stub.builds`; hillAt finds an item by
// from/to.
export const stub = {builds: []};

export function buildClimbIndex(route, segments, opts) {
    stub.builds.push({route, segments, opts});
    return {preludeM: 0, lapM: 100, weldM: 0, items: route.items ?? [{from: 0, to: 100, kind: 'climb', roller: false, tag: 'built'}]};
}

export function hillAt(items, pos) {
    return (items || []).find(h => pos >= h.from && pos <= h.to) ?? null;
}
