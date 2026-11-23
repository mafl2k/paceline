// Runs any version of the mod's engine over a recording and reports what it showed per second, on
// the race reference's clock, so score.mjs can compare it with the reference. The engine is the
// rotation.mjs of a checkout of the repository (a worktree, or `git archive <tag> | tar -x`); an old
// one lacks newer exports, so the adapter asks for nothing it cannot do without (as the spike's
// oldEngine did).
import {pathToFileURL} from 'node:url';


// Steps the engine at `dir` (a checkout holding pages/src/engine/rotation.mjs) tick by tick over
// the ride (analyse()'s ride) with one plan throughout (the live mod was fed each tick's own plan;
// the adapter does not follow a plan switch). {N, t0, pos, plan}: the grid, second = round((tick
// time - t0) / 1000) for 0..N-1; pos maps a rider's id (string) to his plan position; plan the plan
// to feed (the one `pos` numbers; default the plan of the recording's last tick that has one).
// Returns {pul, toMy, mine, el, disp, below, chaos, seen}, plain arrays of N: seen 1 for a second
// in which the engine saw at least one tick (0: nothing is known there, the other arrays hold their
// quiet values), pul the shown puller's position (0 none), toMy the seconds to my turn (null),
// mine 0/1, el my elapsed seconds while mine (null), disp 1 while a climb or chaos display is on
// (the engine's chaos, a climb or descent reason, a hill pause), below the positions shown below
// the line (null where the engine has no list), chaos 1 while the engine's own chaos state is on.
// With several ticks in one second, as in the spike: pul, and below when the engine has a present
// list, take the last tick's value; mine, toMy and el take the last tick that has a view (a tick
// without one leaves them); disp and chaos are on when any tick turned them on.
export async function runEngine(dir, ride, {N, t0, pos, plan: given = null}) {
    const R = await import(pathToFileURL(`${dir}/pages/src/engine/rotation.mjs`).href);
    // The plan given, else that of the last tick that has one (the positions in `pos` come from there too).
    let pi = ride.ticks.length - 1;
    while (!given && pi > 0 && !ride.planAt(pi)) {
        pi--;
    }
    const plan = given ?? ride.planAt(pi) ?? [...ride.plans.values()][0];
    if (!plan) {
        throw new Error('no plan known in the recording');
    }
    const selfId = String(ride.selfId);
    const planIds = plan.riders.map(r => String(r.id));
    const riderIds = new Set(planIds);
    const endM = ride.finish.endM;
    const KEEP_MS = 10000;
    const draftN = R.DRAFT_N ?? 5;
    const nearbyOf = tick => {
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
    };
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
    const out = {pul: new Array(N).fill(0), toMy: new Array(N).fill(null), mine: new Array(N).fill(0),
                 el: new Array(N).fill(null), disp: new Array(N).fill(0), below: new Array(N).fill(null),
                 chaos: new Array(N).fill(0), seen: new Array(N).fill(0)};
    let rot = R.initialRotation();
    let hist = [];
    let drafts = [];
    let lastWt = null;
    for (const tick of ride.ticks) {
        const now = tick.ts;
        const nearby = nearbyOf(tick);
        const self = nearby.find(e => e.self);
        let sampleT = null;
        if (self && self.state.worldTime !== lastWt) {
            lastWt = self.state.worldTime;
            const last = hist.at(-1);
            if (last && now - last.t > KEEP_MS) {
                hist = [];
                drafts = [];
            }
            hist = R.pushPower(hist, {t: now, w: self.state.power});
            if (Number.isFinite(self.state.draft)) {
                drafts = [...drafts, self.state.draft].slice(-draftN);
            }
            sampleT = now;
        }
        const grade = self && Number.isFinite(self.state.grade) ? self.state.grade * 100 : null;
        const res = R.rotationStep(rot, {now, plan, riderIds, selfId: ride.selfId, nearby, hist, drafts, grade, sampleT,
                                         terrain: terrainOf(tick.det)});
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
