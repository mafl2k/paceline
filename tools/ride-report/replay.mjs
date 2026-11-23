// Replays a recording through the mod's own engine (rotation.mjs, gaps.mjs), fed as paceline.mjs
// feeds it: one rotation step and one gap step per tick, with the plan active at that tick.
import * as R from '../../pages/src/engine/rotation.mjs';
import * as G from '../../pages/src/engine/gaps.mjs';
import {POWER_KEEP_MS} from '../../pages/src/engine/display.mjs';

// Sauce-like nearby entries from a tick's rows. `remaining` (finish mode) comes from the recorded
// det.finish (what Sauce said live); without it from the event's distance.
function nearbyOf(tick, endM) {
    const d = tick.det || {};
    return tick.riders.map(x => {
        const e = {athleteId: x.id, self: x.self, watching: x.watching, age: x.age, gapDistance: x.gapDistance,
                   state: {worldTime: x.worldTime, speed: x.speed, power: x.power, draft: x.draft, grade: x.grade,
                           eventDistance: x.eventDistance, altitude: x.altitude}};
        if (x.self) {
            let remaining = null;
            if (typeof d.finish === 'boolean') {
                remaining = d.finish ? 0 : 1e9;
            } else if (Number.isFinite(endM) && Number.isFinite(x.eventDistance)) {
                remaining = endM - x.eventDistance;
            }
            if (remaining !== null) {
                Object.assign(e, {remainingType: 'event', remainingMetric: 'distance', remaining});
            }
        }
        return e;
    });
}


// The route profile's hill as recorded (det.hill when the mod knew its place on the route), else
// undefined: the engine then uses the live grade, as it did live.
function terrainOf(det) {
    if (!det || det.routePos === null || det.routePos === undefined || !Object.hasOwn(det, 'hill')) {
        return undefined;
    }
    if (!det.hill) {
        return {hill: null};
    }
    const descent = det.reason === 'descent' || (det.hill === 'pause' && det.descent === true);
    return {hill: {roller: det.hill === 'flag', kind: descent ? 'descent' : 'climb'}};
}


// frames[i] for ticks[i]: {ts, plan, skipped, rot, self, view, reason, positions, active, hill,
// gaps, rows}. A tick without a known plan is skipped (the state is kept, nothing steps).
export function replay(ride) {
    const {ticks, selfId} = ride;
    const endM = ride.finish.endM;
    let rot = R.initialRotation();
    let gaps = G.initialGaps();
    let hist = [];
    let drafts = [];
    let lastWt = null;
    let sig;
    let firstStart = null;
    const frames = [];
    ticks.forEach((tick, i) => {
        const now = tick.ts;
        const plan = ride.planAt(i);
        const nearby = nearbyOf(tick, endM);
        const me = nearby.find(e => e.self);
        // My samples (as samplePower): one per new world time.
        let sampleT = null;
        if (me && me.state.worldTime !== lastWt) {
            lastWt = me.state.worldTime;
            const last = hist[hist.length - 1];
            if (last && now - last.t > POWER_KEEP_MS) {
                hist = [];
                drafts = [];
            }
            hist = R.pushPower(hist, {t: now, w: me.state.power});
            if (Number.isFinite(me.state.draft)) {
                drafts = [...drafts, me.state.draft].slice(-R.DRAFT_N);
            }
            sampleT = now;
        }
        const grade = me && Number.isFinite(me.state.grade) ? me.state.grade * 100 : null;
        if (!plan) {
            frames.push({ts: now, plan: null, skipped: true, rot, self: null, view: null, reason: 'noplan',
                         positions: [], active: false, hill: false, gaps, rows: {}});
            return;
        }
        if (plan.sig !== sig) {
            if (sig !== undefined) {
                rot = R.carryRotation(rot, plan);
            }
            sig = plan.sig;
        }
        const riderIds = new Set(plan.riders.map(r => String(r.id)));
        const res = R.rotationStep(rot, {now, plan, riderIds, selfId, nearby, hist, drafts, grade, sampleT,
                                         terrain: terrainOf(tick.det)});
        rot = res.state;
        if (firstStart === null && rot.startAt != null) {
            firstStart = rot.startAt;
        }
        const live = R.selfLive(nearby, selfId);
        const positions = R.alignedPositions(nearby, riderIds).filter(p => riderIds.has(p.id));
        const active = live && !rot.locked && !rot.finish && !rot.still?.still;
        const hill = rot.hill?.mode === 'pause';
        const rows = Object.fromEntries(tick.riders
            .filter(x => x.self === true || riderIds.has(String(x.id)))
            .map(x => [String(x.id), {speed: x.speed, power: x.power, age: x.age ?? 0, draft: x.draft}]));
        gaps = G.gapStep(gaps, {now, selfId, positions, active, hill,
                                needed: plan.minimumFinishers > 0 ? plan.minimumFinishers : G.GAP_FINISHERS, riders: rows});
        const st = R.rotationStatus(rot, {now, plan, selfId, live});
        frames.push({ts: now, plan, skipped: false, rot, self: res.self, view: st.view, reason: st.reason,
                     positions, active, hill, gaps, rows, live,
                     needed: plan.minimumFinishers > 0 ? plan.minimumFinishers : G.GAP_FINISHERS});
    });
    return {frames, startAt: firstStart};
}
