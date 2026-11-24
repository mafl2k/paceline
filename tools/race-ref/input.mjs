// The race reference's input: one view per recording (ride report analysis plus replay), on a
// common clock of whole seconds since the earliest roll-off. Riders are plan positions 1..n (the
// order of the last known plan), never ids in the output.
import {analyse} from '../ride-report/analyse.mjs';
import {replay} from '../ride-report/replay.mjs';
import {FRESH_MS} from '../ride-report/ride.mjs';
import {groupAt, trafficAt} from '../ride-report/checks/traffic.mjs';
import {POWER_AGE_MS, DRAFT_PROXY_W} from './reference.mjs';


// recordings: [{text}] (the recording's JSONL text). plans: [{sig, text}] as analyse() takes them.
// Returns {t0, tEnd, N, raceS, n, planSig, ids, names, planS, planW, views}: planSig the code of the plan the
// positions come from (null when the plan has none), t0 the earliest roll-off (ms), tEnd
// the latest finish (ms), N the seconds t0..tEnd, raceS the race length in seconds, ids the plan
// riders' ids by position (internal only), names their names by position (index 0 = '', shown in
// the report only with --names, never written to reference.json), planS / planW the plan's pull seconds and watts by
// position (index 0 = 0), and per recording views[i] = {self, front, frames, dist, alt, traffic,
// gaps}: self the recorder's position (0 if not in the plan), front Int32Array(N) of positions
// (0 = none), frames Array(N) of null | {pos: [{k, x, age}], power: {k: W}} (the first usable
// replay frame of each second), dist and alt Float64Array(N) of my own event distance and
// altitude (NaN before the first row, carried forward over holes), traffic Array(N) of null (no
// data that second) | {ahead, inLine} (see trafficSeries), gaps [{k, at, s, m}] the recording's
// real gaps (ride report check 5) by plan position, start second, length and largest size.
export function viewsOf(recordings, {plans = []} = {}) {
    const logs = [];
    for (const {text} of recordings) {
        const {result: rep, ride} = analyse(text, {plans});
        if (!ride) {
            continue;
        }
        logs.push({rep, ride, frames: replay(ride).frames});
    }
    if (!logs.length) {
        throw new Error('no recording with ticks');
    }
    // The positions come from the last tick that has a plan (the first recording that has one).
    let plan = null;
    for (const l of logs) {
        let pi = l.ride.ticks.length - 1;
        while (pi > 0 && !l.ride.planAt(pi)) {
            pi--;
        }
        plan = l.ride.planAt(pi);
        if (plan) {
            break;
        }
    }
    if (!plan) {
        throw new Error('no plan known in any recording');
    }
    const ids = plan.riders.map(r => String(r.id));
    const n = ids.length;
    const posOf = Object.fromEntries(ids.map((id, i) => [id, i + 1]));
    const names = ['', ...plan.riders.map(r => String(r.name ?? ''))];
    const planS = [0, ...plan.riders.map(r => r.pullS)];
    const planW = [0, ...plan.riders.map(r => r.watts)];
    const t0 = Math.min(...logs.map(l => l.rep.overview.rollOff.at));
    const tEnd = Math.max(...logs.map(l => l.rep.overview.finish?.at ?? l.ride.finish.at ?? l.ride.ticks.at(-1).ts));
    const N = Math.ceil((tEnd - t0) / 1000) + 1;
    const sec = ts => Math.round((ts - t0) / 1000);
    const views = logs.map(l => {
        const front = new Int32Array(N);
        // The ground-truth pulls with their ids (the report's public list carries labels only, which
        // follow the plan at the finish, not the last plan the positions come from).
        for (const p of l.rep.pulls._pulls) {
            const k = posOf[String(p.id)];
            if (!k) {
                continue;
            }
            for (let s = Math.max(0, sec(p.start)); s <= sec(p.end) && s < N; s++) {
                front[s] = k;
            }
        }
        const frames = new Array(N).fill(null);
        for (const fr of l.frames) {
            const s = sec(fr.ts);
            if (fr.skipped || s < 0 || s >= N || frames[s]) {
                continue;
            }
            const pos = fr.positions.filter(p => posOf[String(p.id)] && Number.isFinite(p.x))
                .map(p => ({k: posOf[String(p.id)], x: p.x, age: p.age ?? 0}));
            const power = {};
            ids.forEach((id, i) => {
                const r = fr.rows?.[id];
                if (r && (r.age ?? 0) <= POWER_AGE_MS && Number.isFinite(r.power)) {
                    power[i + 1] = r.power;
                }
            });
            frames[s] = {pos, power};
        }
        const dist = new Float64Array(N).fill(NaN);
        const alt = new Float64Array(N).fill(NaN);
        for (const t of l.ride.ticks) {
            const me = t.riders.find(r => r.self);
            const s = sec(t.ts);
            if (me && s >= 0 && s < N && Number.isNaN(dist[s]) && Number.isFinite(me.eventDistance)) {
                dist[s] = me.eventDistance;
                alt[s] = Number.isFinite(me.altitude) ? me.altitude : NaN;
            }
        }
        for (let s = 1; s < N; s++) {
            if (Number.isNaN(dist[s])) {
                dist[s] = dist[s - 1];
                alt[s] = alt[s - 1];
            }
        }
        return {self: posOf[String(l.ride.selfId)] ?? 0, front, frames, dist, alt,
                traffic: trafficSeries(l.ride, sec, N), gaps: gapsOf(l.rep, l.ride, posOf, sec)};
    });
    return {t0, tEnd, N, raceS: sec(tEnd), n, planSig: plan.sig ?? null, ids, names, planS, planW, views};
}


// Per second of one recording: null where nothing is known, else {ahead, inLine}. With a traffic
// array on the tick (since 0.3.5, same rules as the ride report's traffic check): ahead = a row
// ahead of the front of my group, inLine = a row between its front and rear. Without one (older
// recordings) the proxy: ahead = the draft of the frontmost team rider above DRAFT_PROXY_W (someone
// outside the team rides in front of him), inLine unknown (null). Ticks without a plan or a group
// give nothing; several ticks in one second are folded (true wins).
function trafficSeries(ride, sec, N) {
    const out = new Array(N).fill(null);
    const either = (a, b) => (a === true || b === true ? true : a === null || b === null ? (a ?? b) : false);
    ride.ticks.forEach((t, i) => {
        const s = sec(t.ts);
        const plan = ride.planAt(i);
        if (s < 0 || s >= N || !plan) {
            return;
        }
        const g = groupAt(ride, i);
        if (!g) {
            return;
        }
        let ahead = null;
        let inLine = null;
        const rows = trafficAt(ride, i);
        if (rows) {
            ahead = rows.some(x => x.gap < g.front);
            inLine = rows.some(x => x.gap > g.front && x.gap < g.rear);
        } else if (!Array.isArray(t.traffic)) {
            const team = new Set(plan.riders.map(r => String(r.id)));
            const lead = t.riders.find(r => (r === ride.meRows[i] || team.has(String(r.id))) && (r.age ?? 0) <= FRESH_MS &&
                r.gapDistance === g.front);
            if (lead && Number.isFinite(lead.draft)) {
                ahead = lead.draft > DRAFT_PROXY_W;
            }
        }
        if (ahead === null && inLine === null) {
            return;
        }
        const o = out[s];
        out[s] = o ? {ahead: either(o.ahead, ahead), inLine: either(o.inLine, inLine)} : {ahead, inLine};
    });
    return out;
}


// The recording's real gaps (the ride report's gaps check) as [{k, at, s, m}]: plan position, start
// second of the race, length in seconds, largest gap in metres. The report names riders by label;
// the labels are turned back into ids and those into positions, so a plan change is no problem.
function gapsOf(rep, ride, posOf, sec) {
    const list = rep.gaps?.real?.list ?? [];
    if (!list.length) {
        return [];
    }
    const byLabel = new Map();
    const known = new Set([...ride.plans.values()].flatMap(p => [...(p.riders || []), ...(p.bench || [])].map(r => String(r.id))));
    for (const id of known) {
        byLabel.set(ride.labels(id), id);
    }
    const out = [];
    for (const e of list) {
        const k = posOf[byLabel.get(e.who)];
        if (k) {
            out.push({k, at: sec(e.at), s: e.s, m: e.maxM});
        }
    }
    return out;
}
