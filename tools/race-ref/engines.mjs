// Runs any version of the mod's engine over a recording and reports what it showed per second, on
// the race reference's clock, so score.mjs can compare it with the reference. The engine is the
// rotation.mjs of a checkout of the repository (a worktree, or `git archive <tag> | tar -x`); an old
// one lacks newer exports, so the adapter asks for nothing it cannot do without (as the spike's
// oldEngine did).
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

const CORES = ['auto', 'rotation', 'turns'];
const KEEP_MS = 10000;


// The plan to feed: the one given, else that of the last tick that has one (the positions in `pos`
// come from there too), else the first the recording holds.
function planOf(ride, given) {
    let pi = ride.ticks.length - 1;
    while (!given && pi > 0 && !ride.planAt(pi)) {
        pi--;
    }
    const plan = given ?? ride.planAt(pi) ?? [...ride.plans.values()][0];
    if (!plan) {
        throw new Error('no plan known in the recording');
    }
    return plan;
}


// Sauce-like nearby entries from a tick's rows. My entry carries `remaining` for the finish: the
// old adapter takes what Sauce said live (det.finish) first, then the distance to the event's end;
// the new one the distance first (so the end phase has a number to work with), then det.finish.
function nearbyOf(tick, endM, {distanceFirst = false} = {}) {
    const d = tick.det || {};
    return tick.riders.map(x => {
        const e = {athleteId: x.id, self: x.self, watching: x.watching, age: x.age, gapDistance: x.gapDistance,
                   state: {worldTime: x.worldTime, speed: x.speed, power: x.power, draft: x.draft, grade: x.grade,
                           eventDistance: x.eventDistance, altitude: x.altitude}};
        if (x.self) {
            const byDist = Number.isFinite(endM) && Number.isFinite(x.eventDistance) ? endM - x.eventDistance : null;
            const byFlag = typeof d.finish === 'boolean' ? (d.finish ? 0 : 1e9) : null;
            const remaining = distanceFirst ? byDist ?? byFlag : byFlag ?? byDist;
            if (remaining !== null) {
                Object.assign(e, {remainingType: 'event', remainingMetric: 'distance', remaining});
            }
        }
        return e;
    });
}


// My power samples (one per new world time, as samplePower does) and my last draft values; both
// start over after KEEP_MS without a sample. feed(self, now) returns the sample time or null.
function powerFeed(R) {
    const draftN = R.DRAFT_N ?? 5;
    const f = {hist: [], drafts: [], lastWt: null, feed(self, now) {
        if (!self || self.state.worldTime === f.lastWt) {
            return null;
        }
        f.lastWt = self.state.worldTime;
        const last = f.hist.at(-1);
        if (last && now - last.t > KEEP_MS) {
            f.hist = [];
            f.drafts = [];
        }
        f.hist = R.pushPower(f.hist, {t: now, w: self.state.power});
        if (Number.isFinite(self.state.draft)) {
            f.drafts = [...f.drafts, self.state.draft].slice(-draftN);
        }
        return now;
    }};
    return f;
}


const quiet = N => ({pul: new Array(N).fill(0), toMy: new Array(N).fill(null), mine: new Array(N).fill(0),
                     el: new Array(N).fill(null), disp: new Array(N).fill(0), below: new Array(N).fill(null),
                     chaos: new Array(N).fill(0), seen: new Array(N).fill(0)});


// Steps the engine at `dir` (a checkout holding pages/src/engine/) tick by tick over the ride
// (analyse()'s ride) with one plan throughout (the live mod was fed each tick's own plan; the
// adapter does not follow a plan switch). {N, t0, pos, plan}: the grid, second = round((tick time -
// t0) / 1000) for 0..N-1; pos maps a rider's id (string) to his plan position; plan the plan to feed
// (the one `pos` numbers; default the plan of the recording's last tick that has one).
// core: which engine adapter. 'auto' (default) takes the new one (turns.mjs, the turn clocks) when
// the checkout has pages/src/engine/turns.mjs, else today's (rotation.mjs); 'rotation' forces
// today's, which scores the shadow rotation.mjs of a new checkout; 'turns' the new one. Only the
// new one reads the rest: filter (the power filter, off in the live mod), route (Sauce's getRoute
// answer: the climb index when the recording holds none) and segments (Sauce's getSegments answer,
// passed through to buildClimbIndex, which does not read it: the index takes route.segments) and
// provisional (turnsStatus's provisional view after a climb, off in the mod; measuring only).
// Returns {pul, toMy, mine, el, disp, below, chaos, seen}, plain arrays of N (the new adapter adds
// hang and prov): seen 1 for a second in which the engine saw at least one tick (0: nothing is known there,
// the other arrays hold their quiet values), pul the shown puller's position (0 none), toMy the seconds to my turn (null),
// mine 0/1, el my elapsed seconds while mine (null), disp 1 while a climb or chaos display is on
// (the engine's chaos, a climb or descent reason, a hill pause; the new core: its climb display),
// below the positions shown below the line (null where the engine has no list), chaos 1 while the
// engine's own chaos state is on (the new core has none: 0), hang the positions shown as hanging
// (new adapter only, null where unknown), prov 1 while the view shown is provisional (new adapter
// only; pul, toMy and mine then are that view's).
// With several ticks in one second, as in the spike: pul, and below (hang) when the engine has a
// present list, take the last tick's value; mine, toMy and el take the last tick that has a view (a
// tick without one leaves them); disp and chaos are on when any tick turned them on.
export async function runEngine(dir, ride, {N, t0, pos, plan: given = null, core = 'auto', filter = false,
                                             route = null, segments = null, provisional = false}) {
    if (!CORES.includes(core)) {
        throw new Error(`unknown core ${JSON.stringify(core)} (auto, rotation or turns)`);
    }
    const turns = core === 'turns' || (core === 'auto' && fs.existsSync(`${dir}/pages/src/engine/turns.mjs`));
    return turns ? runTurns(dir, ride, {N, t0, pos, plan: given, filter, route, segments, provisional}) :
        runRotation(dir, ride, {N, t0, pos, plan: given});
}


// Today's adapter (rotation.mjs, up to 0.3.4): unchanged, so the old versions score as they did.
async function runRotation(dir, ride, {N, t0, pos, plan: given}) {
    const R = await import(pathToFileURL(`${dir}/pages/src/engine/rotation.mjs`).href);
    const plan = planOf(ride, given);
    const selfId = String(ride.selfId);
    const planIds = plan.riders.map(r => String(r.id));
    const riderIds = new Set(planIds);
    const endM = ride.finish.endM;
    // The recorded route hill, as the live mod got it (undefined: the engine uses the live grade).
    const terrainOf = det => {
        if (!det || det.routePos === null || det.routePos === undefined || !Object.hasOwn(det, 'hill')) {
            return undefined;
        }
        if (!det.hill) {
            return {hill: null};
        }
        const descent = det.reason === 'descent' || (det.hill === 'pause' && det.descent === true);
        return {hill: {roller: det.hill === 'flag', kind: descent ? 'descent' : 'climb'}};
    };
    const out = quiet(N);
    let rot = R.initialRotation();
    const power = powerFeed(R);
    for (const tick of ride.ticks) {
        const now = tick.ts;
        const nearby = nearbyOf(tick, endM);
        const self = nearby.find(e => e.self);
        const sampleT = power.feed(self, now);
        const grade = self && Number.isFinite(self.state.grade) ? self.state.grade * 100 : null;
        const res = R.rotationStep(rot, {now, plan, riderIds, selfId: ride.selfId, nearby, hist: power.hist, drafts: power.drafts,
                                         grade, sampleT, terrain: terrainOf(tick.det)});
        rot = res.state;
        const live = R.selfLive(nearby, ride.selfId);
        const st = R.rotationStatus(rot, {now, plan, selfId: ride.selfId, live});
        const s = Math.round((now - t0) / 1000);
        if (s < 0 || s >= N) {
            continue;
        }
        out.seen[s] = 1;
        out.pul[s] = pos[String(rot.front?.puller)] ?? 0;
        if (st.view) {
            out.mine[s] = st.view.mine ? 1 : 0;
            out.toMy[s] = Number.isFinite(st.view.toMyPullS) ? st.view.toMyPullS : null;
            out.el[s] = st.view.mine ? st.view.elapsedS : null;
        }
        // Flags only ever go on within a second (as the spike's disp did); a later tick does not clear them.
        const chaos = !!(rot.order?.chaos || st.reason === 'chaos');
        if (chaos) {
            out.chaos[s] = 1;
        }
        if (chaos || st.reason === 'climb' || st.reason === 'descent' || rot.hill?.mode === 'pause') {
            out.disp[s] = 1;
        }
        // order.out: a Set, an array or an object keyed by id, depending on the version.
        const o = rot.order?.out;
        const outIds = new Set((Array.isArray(o) ? o : o instanceof Set ? [...o] : o && typeof o === 'object' ? Object.keys(o) : []).map(String));
        if (Array.isArray(rot.present)) {
            out.below[s] = planIds.filter(id => id !== selfId && (!rot.present.includes(id) || outIds.has(id))).map(id => pos[id]);
        }
    }
    return out;
}


// The adapter of the turn clocks (turns.mjs): steps turnsStep and gapStep of `dir` per tick, as
// paceline.mjs does. The terrain is the recorded climb index (a tick's `climbs.items`, the last one
// seen so far), else the one built from `route`, else the live grade (undefined). `segments` is
// passed through to buildClimbIndex unused (the index reads route.segments; the --segments flag
// still works).
async function runTurns(dir, ride, {N, t0, pos, plan: given, filter, route, segments, provisional}) {
    const url = f => pathToFileURL(`${dir}/pages/src/engine/${f}.mjs`).href;
    const [R, T, G, Terr] = await Promise.all([import(url('rotation')), import(url('turns')), import(url('gaps')),
                                               import(url('terrain'))]);
    const plan = planOf(ride, given);
    const selfId = String(ride.selfId);
    const planIds = plan.riders.map(r => String(r.id));
    const riderIds = new Set(planIds);
    const endM = ride.finish.endM;
    const needed = plan.minimumFinishers > 0 ? plan.minimumFinishers : G.GAP_FINISHERS;
    const built = route ? Terr.buildClimbIndex(route, segments ?? [], {laps: ride.event?.laps, endM: ride.event?.endDistance})?.items ?? null : null;
    let items = built;
    const out = {...quiet(N), hang: new Array(N).fill(null), prov: new Array(N).fill(0)};
    let st = T.initialTurns();
    let gaps = G.initialGaps();
    const power = powerFeed(R);
    for (const tick of ride.ticks) {
        const now = tick.ts;
        if (Array.isArray(tick.climbs?.items)) {
            items = tick.climbs.items;
        }
        const nearby = nearbyOf(tick, endM, {distanceFirst: true});
        const self = nearby.find(e => e.self);
        const sampleT = power.feed(self, now);
        const grade = self && Number.isFinite(self.state.grade) ? self.state.grade * 100 : null;
        const ed = self?.state.eventDistance;
        const terrain = items && Number.isFinite(ed) ? {hill: Terr.hillAt(items, ed)} : undefined;
        st = T.turnsStep(st, {now, plan, riderIds, selfId: ride.selfId, nearby, hist: power.hist, drafts: power.drafts, grade,
                              sampleT, terrain, gaps, filter}).state;
        const live = R.selfLive(nearby, ride.selfId);
        const rows = Object.fromEntries(tick.riders.filter(x => x.self === true || riderIds.has(String(x.id)))
            .map(x => [String(x.id), {speed: x.speed, power: x.power, age: x.age ?? 0}]));
        gaps = G.gapStep(gaps, {now, selfId: ride.selfId, positions: R.alignedPositions(nearby, riderIds).filter(p => riderIds.has(p.id)),
                                active: live && !st.locked && !st.finish && !st.still?.still, hill: st.hill?.mode === 'pause',
                                needed, riders: rows});
        const view = T.turnsStatus(st, {now, plan, selfId: ride.selfId, live, provisional}).view;
        const s = Math.round((now - t0) / 1000);
        if (s < 0 || s >= N) {
            continue;
        }
        out.seen[s] = 1;
        // A provisional view shows its own puller (the display's clear puller), as the windows would.
        out.pul[s] = pos[String(view?.provisional ? view.puller?.id : st.front?.puller)] ?? 0;
        out.prov[s] = view?.provisional ? 1 : 0;
        if (view) {
            out.mine[s] = view.mine ? 1 : 0;
            out.toMy[s] = Number.isFinite(view.toMyPullS) ? view.toMyPullS : null;
            out.el[s] = view.mine ? view.elapsedS : null;
        }
        // The display only ever goes on within a second, as in the old adapter; there is no chaos.
        if (st.disp) {
            out.disp[s] = 1;
        }
        out.below[s] = planIds.filter(id => id !== selfId && !st.present.includes(id)).map(id => pos[id]);
        out.hang[s] = (st.hanging || []).map(id => pos[String(id)]);
    }
    return out;
}
