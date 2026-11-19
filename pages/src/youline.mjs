// The "who am I in this plan" line, shared by the overlay and the settings window:
// "You are Dario · #4 · 60s@4.1W/kg". The target is in the unit set (unit: 'Wkg' | 'W'; W/kg is
// the plan's pull_wkg when it has one, else watts / weight, and falls back to watts without a weight).
import {findMe} from './engine/plan.mjs';
import {riderTarget} from './engine/display.mjs';
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
    // only in the planner's roster (role 'bench', the club's rider pool): the same as not in the plan
    return {head: S.notInPlan, pull: '', position: null};
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
    const t = riderTarget(rider, weight, unit);
    return {secs, target: t ? t.value : null};
}


// One number per the unit setting (user, 13 Nov 2026): W/kg (the plan's pull_wkg when it has one,
// else watts / weight), or watts with 'W' or without a weight (riderTarget).
function pullTarget(rider, weight, unit, bare = false) {
    const t = riderTarget(rider, weight, unit);
    if (!t) {
        return fmt('pullOnly', {pullS: rider.pullS});
    }
    const wkg = t.unit === S.wkgUnit;
    const target = bare ? t.value : wkg ? fmt('wkg', {wkg: t.value}) : fmt('watts', {watts: t.value});
    return fmt('pullAt', {pullS: rider.pullS, target});
}
