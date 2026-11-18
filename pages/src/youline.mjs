// The "who am I in this plan" line, shared by the overlay and the settings window:
// "You are Dario · #4 · 60s@4.1W/kg". The target is in the unit set (unit: 'Wkg' | 'W'; W/kg
// falls back to watts without a weight).
import {findMe} from './engine/plan.mjs';
import {pickWeight} from './engine/display.mjs';
import {S, fmt} from './strings.mjs';


// weight: my current weight from Zwift (kg) or null; the plan rider's weight is the fallback.
export function youText(plan, selfId, opts) {
    const {head, pull} = youParts(plan, selfId, opts);
    return pull ? head + S.joiner + pull : head;
}


// The line in parts: {head: 'You are Dario · #4', pull: '60s@4.1W/kg', position: 4}. The settings
// window shows head and pull (the name confirms the plan found me); the info window shows
// "You: #4 · 60s@4.1W/kg". pull is '' and position null unless I ride in the plan.
export function youParts(plan, selfId, {weight = null, unit = 'Wkg', bare = false} = {}) {
    if (selfId === null || selfId === undefined) {
        return {head: S.noSelf, pull: '', position: null};
    }
    const me = findMe(plan, selfId);
    if (me.role === 'rider') {
        const r = me.rider;
        return {
            head: fmt('youAre', {name: r.name, position: me.position}),
            pull: pullTarget(r, weight, unit, bare),
            position: me.position,
        };
    }
    return {head: me.role === 'bench' ? S.bench : S.notInPlan, pull: '', position: null};
}


// Another plan rider's pull: "60s@4.1W/kg" (the plan's weight for W/kg, or the weight given).
// Used by the captain's "Next" line and the rotation table (who, how long, how hard). bare: the
// number without its unit, "60s@4.4" (the Info window; user, 13 Nov 2026: the unit is clear and
// only takes room during the race).
export function riderPull(rider, weight = null, unit = 'Wkg', {bare = false} = {}) {
    return pullTarget(rider, weight, unit, bare);
}


// The pull in its parts for the Info window's columns (lined up on the "@"; user, 13 Nov 2026):
// {secs: '60s', target: '4.4'}, target without its unit, null without the plan's watts.
export function riderPullParts(rider, weight = null, unit = 'Wkg') {
    const secs = fmt('pullOnly', {pullS: rider.pullS});
    if (!Number.isFinite(rider.watts)) {
        return {secs, target: null};
    }
    const kg = pickWeight(weight, rider.weight);
    return {secs, target: unit !== 'W' && kg !== null ? (rider.watts / kg).toFixed(1) : String(rider.watts)};
}


// One number per the unit setting (user, 13 Nov 2026): W/kg, or watts with 'W' or without a weight.
function pullTarget(rider, weight, unit, bare = false) {
    if (!Number.isFinite(rider.watts)) {
        return fmt('pullOnly', {pullS: rider.pullS});
    }
    const kg = pickWeight(weight, rider.weight);
    const wkg = unit !== 'W' && kg !== null;
    const value = wkg ? (rider.watts / kg).toFixed(1) : String(rider.watts);
    const target = bare ? value : wkg ? fmt('wkg', {wkg: value}) : fmt('watts', {watts: value});
    return fmt('pullAt', {pullS: rider.pullS, target});
}
