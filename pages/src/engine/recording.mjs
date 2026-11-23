// Pure logic (no DOM, no Sauce imports): when to record, what a tick row looks like,
// which window owns the recording, and the JSONL export.

export const MIN_RIDERS = 2;
export const STOP_AFTER_MS = 120000;
export const LEASE_STALE_MS = 6000;
export const LEASE_REFRESH_MS = 2000;
export const MAX_AGE_MS = 15000;
// When fewer than MIN_RIDERS plan riders are near (no plan, a wrong plan, ids that do not match),
// a TTT recording also keeps the riders of my event subgroup within FALLBACK_RANGE_M of me, the
// FALLBACK_MAX nearest (user, 13 Nov 2026: a record also when something fails). In a TTT that is
// in practice my team: the teams start apart.
export const FALLBACK_RANGE_M = 300;
export const FALLBACK_MAX = 15;
// Traffic: riders near me who are not me and not a plan rider (other teams, and the fallback and
// watched riders, whom the upload strips from `riders`), TRAFFIC_AHEAD_M ahead to TRAFFIC_BEHIND_M
// behind, the TRAFFIC_MAX nearest.
export const TRAFFIC_AHEAD_M = 100;
export const TRAFFIC_BEHIND_M = 50;
export const TRAFFIC_MAX = 20;


export function planIds(plan) {
    const ids = new Set();
    for (const r of plan?.riders || []) {
        ids.add(String(r.id));
    }
    for (const r of plan?.bench || []) {
        ids.add(String(r.id));
    }
    return ids;
}


export function selfEntry(nearby) {
    return (nearby || []).find(x => x.self === true) || null;
}


export function planRidersPresent(nearby, ids) {
    let n = 0;
    for (const x of nearby || []) {
        if (ids.has(String(x.athleteId)) && (x.age ?? 0) < MAX_AGE_MS) {
            n++;
        }
    }
    return n;
}


export function initialRecState() {
    return {recording: false, sessionId: null, lastSeenAt: null};
}


// gate: null (not tied to events: the prefs' tttOnly is off) or {open} from gateStep. With a gate
// the event alone decides (user, 13 Nov 2026): it starts when the gate opens (the start pen), with
// or without teammates or a plan, and stops when it shuts (the event is over); the whole event is
// recorded. Without a gate it starts at MIN_RIDERS plan riders and stops STOP_AFTER_MS after.
// planned: a plan with me in it (or the rider records without one). With a gate a recording only
// starts with it (user, 15 Nov 2026: a recording without a plan never goes up, so it only fills the
// rider's storage); once started it runs to the end of the event.
// sg: with a gate, the TTT subgroup Sauce shows me in now (undefined: not known in this step, e.g.
// a gap in the data). The session keeps the one it started in (`sg` in the state); another one
// ends it, and the next step starts a fresh session for the new event. A gap in the same event is
// only a hole in the ticks (user, 17 Nov 2026: a Sauce dropout must not split the race).
export function recStep(state, {now, present, gate = null, planned = true, sg = undefined}) {
    if (gate && !gate.open) {
        return state.recording ? {state: {...state, recording: false}, action: 'stop'} : {state: {...state}, action: null};
    }
    const known = !!gate && Number.isFinite(sg);
    if (known && state.recording && Number.isFinite(state.sg) && sg !== state.sg) {
        return {state: {...state, recording: false}, action: 'stop'};
    }
    const enough = present >= MIN_RIDERS || (!!gate && (planned || state.recording));
    if (!state.recording) {
        if (enough) {
            return {state: {recording: true, sessionId: String(now), lastSeenAt: now, ...(known ? {sg} : {})},
                    action: 'start'};
        }
        return {state: {...state}, action: null};
    }
    // A long gap between ticks (sleeping laptop, throttled window) ends the session even if
    // riders are present now; the next call then starts a fresh one. In an event (gate) only after
    // EVENT_LOST_MS, the bound the gate itself uses for "the rider is gone".
    if (state.lastSeenAt != null && now - state.lastSeenAt >= (gate ? EVENT_LOST_MS : STOP_AFTER_MS)) {
        return {state: {...state, recording: false}, action: 'stop'};
    }
    if (enough) {
        return {state: {...state, lastSeenAt: now, ...(known && !Number.isFinite(state.sg) ? {sg} : {})}, action: null};
    }
    return {state: {...state}, action: null};
}


function makeRow(x, inPlan) {
    const s = x.state || {};
    return {
        id: String(x.athleteId),
        self: x.self === true,
        watching: x.watching === true,
        ...(inPlan ? {inPlan: true} : {}),
        age: x.age,
        gap: x.gap,
        gapDistance: x.gapDistance,
        isGapEst: x.isGapEst,
        eventSubgroupId: x.eventSubgroupId,
        sgRaw: s.eventSubgroupId,    // Zwift's own field: may be set before Sauce's top-level one
        time: s.time,                // ride time (s): shows when Zwift starts the clock in the pen
        eventPosition: x.eventPosition,
        eventParticipants: x.eventParticipants,
        power: s.power,
        draft: s.draft,
        speed: s.speed,
        distance: s.distance,
        eventDistance: s.eventDistance,
        worldTime: s.worldTime,
        heartrate: s.heartrate,
        cadence: s.cadence,
        grade: s.grade,
        altitude: s.altitude,
        x: s.x,
        y: s.y,
        roadId: s.roadId,
        reverse: s.reverse,
        courseId: s.courseId,
    };
}


// fallback: with fewer than MIN_RIDERS plan riders near, also the riders of my event subgroup
// within FALLBACK_RANGE_M (the FALLBACK_MAX nearest).
// A row of a rider in the current plan (`ids`: starters and bench) carries `inPlan: true`, a watched
// or fallback rider's row does not. The upload keeps the flagged rows (stripForUpload): 17 Nov 2026
// (ZRL) the plan changed mid-race (7AA3FX -> Y8EAQW), and the upload, which kept only the head
// plan's riders, lost the new plan's. The server does not trust the flag; it checks each row against
// the plan the tick names (det.planSig).
export function makeTick(nearby, ids, now, {fallback = false} = {}) {
    const list = nearby || [];
    const self = selfEntry(list);
    const watching = list.find(x => x.watching === true) || null;
    const keep = new Set(list.filter(x => x.self === true || x.watching === true || ids.has(String(x.athleteId))));
    if (fallback && planRidersPresent(list, ids) < MIN_RIDERS) {
        const sg = selfSubgroupId(list);
        const sgOf = x => Number(x.eventSubgroupId || x.state?.eventSubgroupId) || null;
        if (sg !== null) {
            list.filter(x => !keep.has(x) && sgOf(x) === sg && Number.isFinite(x.gapDistance) &&
                             Math.abs(x.gapDistance) <= FALLBACK_RANGE_M)
                .sort((a, b) => Math.abs(a.gapDistance) - Math.abs(b.gapDistance))
                .slice(0, FALLBACK_MAX)
                .forEach(x => keep.add(x));
        }
    }
    const riders = list.filter(x => keep.has(x)).map(x => makeRow(x, ids.has(String(x.athleteId))));
    return {
        ts: now,
        wt: self?.state?.worldTime ?? null,
        selfId: self ? String(self.athleteId) : null,
        watchingId: watching ? String(watching.athleteId) : null,
        riders,
    };
}


// The riders near me who are not me and not plan riders, as anonymous rows {n, gap, speed, power,
// draft, sg}, nearest first. `keptIds`: the athlete ids of me and the plan riders only (the tick's
// rows with `self` or `inPlan`). The fallback and watched rows of the tick are not passed: the
// upload strips them, so as traffic they go up anonymised. Why: on 22 Nov 2026
// other teams caused the disorder at the end of a race, and the recordings held only the team.
// Privacy: a row has no Zwift ID, no name and no map position. `n` is a number per rider within one
// recording (`pseudo`: {epoch, next, ids}, epoch = start of the numbering), so a rider can be
// followed from tick to tick; the id -> number map lives only in memory and is never written
// anywhere. Only a rider in the returned list gets a number. `sg`: he is in my event subgroup.
// `pseudo` null starts a new numbering; the input is not mutated.
export function trafficStep(pseudo, list, keptIds, now) {
    const ids = new Map(pseudo ? pseudo.ids : []);
    let next = pseudo ? pseudo.next : 1;
    const sgOf = x => Number(x.eventSubgroupId || x.state?.eventSubgroupId) || null;
    const mySg = selfSubgroupId(list);
    // rounded: speed to 0.1 km/h, power and draft to whole watts (digits is the decimals kept)
    const num = (v, digits = 0) => Number.isFinite(v) ? Math.round(v * 10 ** digits) / 10 ** digits : null;
    const traffic = (list || [])
        .filter(x => x.self !== true && !keptIds.has(String(x.athleteId)) && Number.isFinite(x.gapDistance) &&
                     x.gapDistance >= -TRAFFIC_AHEAD_M && x.gapDistance <= TRAFFIC_BEHIND_M &&
                     (x.age ?? 0) <= MAX_AGE_MS)
        .sort((a, b) => Math.abs(a.gapDistance) - Math.abs(b.gapDistance))
        .slice(0, TRAFFIC_MAX)
        .map(x => {
            const id = String(x.athleteId);
            if (!ids.has(id)) {
                ids.set(id, next++);
            }
            return {
                n: ids.get(id),
                gap: Math.round(x.gapDistance) || 0,      // || 0: no -0
                speed: num(x.state?.speed, 1),
                power: num(x.state?.power),
                draft: num(x.state?.draft),
                sg: mySg !== null && sgOf(x) === mySg,
            };
        });
    return {pseudo: {epoch: pseudo ? pseudo.epoch : now, next, ids}, traffic};
}


// The det fields that name a rider: each one goes into the recording only when it is a rider of the
// current plan (`ids`: starters and bench) or me, else null (final review 18 Nov 2026: no Zwift ID
// of a rider in no plan in the recording; the rows already keep only those riders). The rotation's
// chain and the gap warnings follow plan riders only, but state carried over a plan change (the
// wheel cue) can still name a rider of the plan before. `gap` keeps its numbers, without the id.
// `order.out` (riders sitting out, 20 Nov 2026) keeps only the ids that pass. The turn clocks' fields
// (23 Nov 2026) follow the same rule: `turn.change.from/to`, `turn.hanging`, `turn.out` and the old
// core's `old.puller`, `old.frontId` and `old.out`.
export const DET_ID_FIELDS = ['puller', 'frontId', 'wheel', 'wheelObs', 'wheelCue'];

export function detPlanOnly(det, ids, selfId) {
    if (!det || typeof det !== 'object') {
        return det;
    }
    const known = id => ids.has(String(id)) || (selfId != null && String(id) === String(selfId));
    const ok = id => (id != null && known(id) ? id : null);
    const out = {...det};
    for (const k of DET_ID_FIELDS) {
        if (k in out) {
            out[k] = ok(out[k]);
        }
    }
    if (out.gap && typeof out.gap === 'object' && 'id' in out.gap) {
        out.gap = {...out.gap, id: ok(out.gap.id)};
    }
    if (out.order && typeof out.order === 'object' && Array.isArray(out.order.out)) {
        out.order = {...out.order, out: out.order.out.filter(id => id != null && known(id))};
    }
    const keep = ids => ids.filter(id => id != null && known(id));
    const t = out.turn;
    if (t && typeof t === 'object') {
        out.turn = {...t};
        if (t.change && typeof t.change === 'object') {
            out.turn.change = {...t.change, from: ok(t.change.from), to: ok(t.change.to)};
        }
        for (const k of ['hanging', 'out']) {
            if (Array.isArray(t[k])) {
                out.turn[k] = keep(t[k]);
            }
        }
    }
    const o = out.old;
    if (o && typeof o === 'object') {
        out.old = {...o};
        for (const k of ['puller', 'frontId']) {
            if (k in o) {
                out.old[k] = ok(o[k]);
            }
        }
        if (Array.isArray(o.out)) {
            out.old.out = keep(o.out);
        }
    }
    return out;
}


// ---------- the event gate (user, 13 Nov 2026: everything starts in the TTT start pen) ----------

// A gap without my TTT subgroup shorter than this does not close the gate: Zwift's state drops
// out for a few seconds now and then (12 Nov 2026: 9 s mid-race). At the finish the subgroup goes.
export const EVENT_GRACE_MS = 30000;
// Without any data of mine (no fresh self entry, or no step at all) for this long the rider is gone
// (Zwift quit mid-race, a sleeping laptop): the gates close and the recording ends. Shorter gaps
// in the event keep the ride (user, 17 Nov 2026: a Sauce dropout after the start split a race).
// 30 min: far longer than a Sauce or Zwift reconnect (seconds to a few minutes), while the stale
// race state ("No plan for you in this race yet.", the race's plan) lasts no longer than that; a
// race that lost half an hour of data has no usable rest anyway.
export const EVENT_LOST_MS = 30 * 60000;


// A team time trial: Zwift's event type, WTRL's tags, or the event's name (user, 15 Nov 2026:
// private TTTs have no TTT type, e.g. "TTT to end all TTT's - 100kms, 100% effort ...").
const TTT_NAME = /\bttt\b|team time trial/i;

export function isTtt(ev) {
    return !!ev && (ev.eventType === 'TEAM_TIME_TRIAL' ||
        (Array.isArray(ev.tags) && ev.tags.some(t => t === 'ttt' || t === 'wtrlttt')) ||
        [ev.name, ev.sgName].some(n => typeof n === 'string' && TTT_NAME.test(n)));
}


export function initialGate() {
    return {open: false, seenAt: null};
}


// ev: my event (eventSummary), null outside events, undefined while Sauce is still asked or has
// no data of mine (gateEv). Open from my TTT subgroup (the start pen) until EVENT_GRACE_MS after it
// is gone. With `any` every event opens it (Paceline not tied to TTTs).
// While open, a run of undefined steps is a hold: the time without data does not count toward the
// grace (`shift`, user 17 Nov 2026: a blip without my subgroup right after a Sauce gap must not end
// the race). Once fresh data showed my subgroup gone (`goneAt`, when the grace began), the grace
// runs on through a hold (the finish, then Zwift quit). A hold of EVENT_LOST_MS since the event was
// last seen closes it (the rider is gone). heldTo: the last undefined step of the current hold.
export function gateStep(prev, {now, ev, any = false}) {
    const g = prev || initialGate();
    const closed = {open: false, seenAt: g.seenAt};
    if (ev === undefined) {
        if (!g.open) {
            return g;
        }
        if (now - g.seenAt >= EVENT_LOST_MS) {
            return closed;
        }
        if (Number.isFinite(g.goneAt)) {
            return now - g.goneAt >= EVENT_GRACE_MS ? closed : g;
        }
        const shift = (g.shift ?? 0) + (Number.isFinite(g.heldTo) ? now - g.heldTo : 0);
        return {open: true, seenAt: g.seenAt, heldTo: now, shift};
    }
    if (any ? !!ev : isTtt(ev)) {
        return {open: true, seenAt: now};
    }
    if (!g.open || now - g.seenAt >= EVENT_LOST_MS) {
        return closed;
    }
    const goneAt = Number.isFinite(g.goneAt) ? g.goneAt : g.seenAt + (g.shift ?? 0);
    return now - goneAt < EVENT_GRACE_MS ? {open: true, seenAt: g.seenAt, goneAt} : closed;
}


// The gate's `ev` from the nearby list and eventOf's answer: without a fresh entry of mine (Sauce
// lost the data, Zwift is reconnecting) it is undefined, "still asking Sauce", so the gate stays as
// it is. A gap in the data mid-race must never end the ride (final review I-1, 17 Nov 2026). Once
// an open `gate` has not seen the event for EVENT_LOST_MS it is null: the rider is gone, it closes.
export function gateEv(nearby, summary, {gate = null, now = null} = {}) {
    if (selfEntry(nearby)) {
        return summary;
    }
    return gate?.open && Number.isFinite(now) && Number.isFinite(gate.seenAt) && now - gate.seenAt >= EVENT_LOST_MS
        ? null : undefined;
}


// My event subgroup: Sauce's top-level id (set once Sauce has loaded the event), else Zwift's raw
// one from the player state. null outside events (Zwift sends 0 there).
export function selfSubgroupId(nearby) {
    const self = selfEntry(nearby);
    const id = Number(self?.eventSubgroupId || self?.state?.eventSubgroupId);
    return Number.isFinite(id) && id > 0 ? id : null;
}


// The event as recorded once per change: what the event gating (pen, TTT only) will rely on.
// sg from Common.rpc.getEventSubgroup, ev from Common.rpc.getEvent (either may be missing).
export function eventSummary(sgId, sg, ev) {
    const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
    const str = v => (typeof v === 'string' && v) ? v : null;
    return {
        sgId: num(sgId),
        found: !!sg,
        eventId: num(sg?.eventId ?? ev?.id),
        name: str(ev?.name),
        sgName: str(sg?.name),
        label: str(sg?.subgroupLabel),
        eventType: str(ev?.eventType ?? sg?.eventType),
        start: num(sg?.ts),                 // this subgroup's start (server time, ms)
        eventStart: num(ev?.ts),
        durationInSeconds: num(sg?.durationInSeconds),
        endDistance: num(sg?.endDistance),
        laps: num(sg?.laps),
        routeId: num(sg?.routeId),
        courseId: num(sg?.courseId),
        signedUp: typeof sg?.signedUp === 'boolean' ? sg.signedUp : null,
        tags: Array.isArray(sg?.allTags) ? sg.allTags.slice(0, 40) : null,
    };
}


// Whether this tick carries the event: on the first tick of a session and whenever it changed
// (also to null when I leave the event). prev = {sessionId, key} of the last logged one.
export function eventLogStep(prev, {sessionId, summary}) {
    const key = JSON.stringify(summary ?? null);
    if (prev && prev.sessionId === sessionId && prev.key === key) {
        return {log: false, next: prev};
    }
    return {log: true, next: {sessionId, key}};
}


export function takeLease(current, me, now) {
    // A lease is only valid when `at` is a finite number in the past and younger than
    // LEASE_STALE_MS. Malformed or future-dated leases (clock stepped back) are takeable.
    const age = typeof current?.at === 'number' ? now - current.at : NaN;
    const fresh = Number.isFinite(age) && age >= 0 && age < LEASE_STALE_MS;
    if (!fresh) {
        return {own: true, write: {id: me, at: now}};
    }
    if (current.id === me) {
        return {own: true, write: age >= LEASE_REFRESH_MS ? {id: me, at: now} : null};
    }
    return {own: false, write: null};
}


// takeLease plus the rule for acting on it: a window records only when the lease it read before
// writing was already its own. A lease taken over in this step counts from the next step on, so
// two windows that both took the same stale lease cannot both record: on the next step only the
// one whose id ended up in storage acts.
export function leaseStep(current, me, now) {
    const {own, write} = takeLease(current, me, now);
    return {act: own && current?.id === me, write};
}


// Whether `me` holds the lease as stored (audit fixes, 20 Nov 2026, W4; probe s6-close: a closed
// recorder left its lease behind, a 7 s hole in the ticks until LEASE_STALE_MS ran out). A window
// that closes removes only a lease it holds, never another window's.
export function leaseHeld(current, me) {
    return current?.id === me;
}


export function toJsonl(meta, ticks) {
    const head = {kind: 'paceline-recording', v: 1, ...meta};
    return [head, ...ticks].map(x => JSON.stringify(x)).join('\n') + '\n';
}


export function recordingFileName({team, selfName, startedAt}) {
    const d = new Date(startedAt);
    const p = (n, w = 2) => String(n).padStart(w, '0');
    const stamp = `${p(d.getFullYear(), 4)}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
    const clean = s => String(s ?? '').replace(/[^A-Za-z0-9]/g, '_');
    return `paceline-${clean(team)}-${stamp}-${clean(selfName)}.jsonl`;
}


// What the recordings list in the settings window shows, as a key (audit fixes, 20 Nov 2026, W7):
// whether a recording runs, its session and the live session. The window re-read the stored
// recordings on every storage event of the recording state, which also fires with each heartbeat
// (lastSeenAt): probe s4-settings. It re-reads only when this key changes.
export function recListKey(state, liveId) {
    return JSON.stringify([state?.recording === true, state?.sessionId ?? null, liveId ?? null]);
}
