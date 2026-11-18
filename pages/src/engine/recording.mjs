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
export function recStep(state, {now, present, gate = null, planned = true}) {
    if (gate && !gate.open) {
        return state.recording ? {state: {...state, recording: false}, action: 'stop'} : {state: {...state}, action: null};
    }
    const enough = present >= MIN_RIDERS || (!!gate && (planned || state.recording));
    if (!state.recording) {
        if (enough) {
            return {state: {recording: true, sessionId: String(now), lastSeenAt: now}, action: 'start'};
        }
        return {state: {...state}, action: null};
    }
    // A long gap between ticks (sleeping laptop, throttled window) ends the session even if
    // riders are present now; the next call then starts a fresh one.
    if (state.lastSeenAt != null && now - state.lastSeenAt >= STOP_AFTER_MS) {
        return {state: {...state, recording: false}, action: 'stop'};
    }
    if (enough) {
        return {state: {...state, lastSeenAt: now}, action: null};
    }
    return {state: {...state}, action: null};
}


function makeRow(x) {
    const s = x.state || {};
    return {
        id: String(x.athleteId),
        self: x.self === true,
        watching: x.watching === true,
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
    const riders = list.filter(x => keep.has(x)).map(makeRow);
    return {
        ts: now,
        wt: self?.state?.worldTime ?? null,
        selfId: self ? String(self.athleteId) : null,
        watchingId: watching ? String(watching.athleteId) : null,
        riders,
    };
}


// ---------- the event gate (user, 13 Nov 2026: everything starts in the TTT start pen) ----------

// A gap without my TTT subgroup shorter than this does not close the gate: Zwift's state drops
// out for a few seconds now and then (12 Nov 2026: 9 s mid-race). At the finish the subgroup goes.
export const EVENT_GRACE_MS = 30000;


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


// ev: my event (eventSummary), null outside events, undefined while Sauce is still asked (no
// change). Open from my TTT subgroup (the start pen) until EVENT_GRACE_MS after it is gone.
export function gateStep(prev, {now, ev}) {
    const g = prev || initialGate();
    if (ev === undefined) {
        return g;
    }
    if (isTtt(ev)) {
        return {open: true, seenAt: now};
    }
    if (g.open && now - g.seenAt < EVENT_GRACE_MS) {
        return g;
    }
    return {open: false, seenAt: g.seenAt};
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
