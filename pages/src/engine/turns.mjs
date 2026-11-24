// The rotation core built on turn clocks (spec docs/superpowers/specs/2026-11-23-paceline-turn-clocks-
// design.md §2). Every turn has an owner, and his clock runs from his real start at the front until
// the next owner takes over.
// Why (22 Nov 2026 race): one soft rider beside the puller was adopted after 3 s and his "skip" set
// 5-7 riders out, which gave false chaos for half the race; the table tore the plan apart while the
// team rode it; my pull clock restarted after a short overtake (83 -> 16 s); the rules added since
// 0.2.14 named the puller worse than 0.2.13's simple front rule.
// User decisions (22-23 Nov 2026): start over instead of adding fixes; one clock per rider, which keeps
// running while he is briefly overtaken; plan deviation is no engine error; the table keeps plan order
// in every state; no chaos state; hanging riders leave the line at once, gone only later.
import {alignedPositions, teamChain, frontOf, selfLive, stillStep, finishStep, presence, startStep, startQuiet,
        climbState, initialClimb, initialHill, hillMode, dashReason, rotationView, planWheel, HOLD_MS, START_BONUS_S,
        SELF_IGNORE_MS, startGate, powerJump, sustainedJump, startConfirmed, draftFront, draftRun, selfEvent,
        CONFIRM_MS, DRAFT_RUN_N, START_LOCK_MS} from './rotation.mjs';
import {selfEntry} from './recording.mjs';
import {lineOf, classifyChange} from './order.mjs';
import {cutOff, GAP_ON_M} from './gaps.mjs';

export const NEXT_HOLD_MS = 3000;           // spec §2: the plan's next in the line holds the front 3 s
export const OTHER_HOLD_MS = 20000;         // spec §2: anyone else holds it 20 s
export const CLEAR_FRAC = 0.5;              // spec §2/§3: a clear puller, in front half his plan pull ...
export const CLEAR_MIN_MS = 20000;          // ... and at least 20 s
export const FILTER_NEXT_FRAC = 0.9;        // spec §2 power filter: the next under 90 % of his plan power ...
export const FILTER_OWNER_FRAC = 0.85;      // ... while the owner is still at 85 % of his
export const FILTER_AT_MS = 5000;           // spec §2 power filter: decided at 5 s
export const CLIMB_GAP_M = 15;              // spec §3: a real gap of 15 m or more (GAP_HILL_ON_M)
export const TURN_CHAIN_M = 30;             // spec §2 gone rule: riders linked within 30 m ...
export const TURN_PRESENT_MS = 30000;       // ... gone after 30 s outside my chain (user's yes, 23 Nov 2026)
export const END_PHASE_S = 1200;            // spec §3: the last 20 min
export const POWER_N = 5;                   // prototype, measured 23 Nov: a rider's power = mean of his last 5
export const END_SPEED_MIN_S = 60;          // our call: the end-phase estimate needs 60 s ridden


const initialFront = () => ({puller: null, since: null, bonus: null, pending: null, last: null, ignore: null});

export function initialTurns() {
    return {
        front: initialFront(),     // puller = the owner (the leader during the climb display)
        fr: {id: null, since: null},           // the front rider of my chain and since when
        prev: null,                // {id, since, skipped}: the last owner (the return rule)
        out: {},                   // {id: true}: sitting out after a skip
        hanging: [],               // cut off behind a full gap (gaps.mjs cutOff), in plan order
        cut: null,                 // {id, m} of the cutting gap
        line: [],                  // the plan riders in the group, not out, not hanging, in plan order
        disp: null, careful: false, check: null, soft: null,     // climb display and filter
        change: null,              // this step's change {kind, from, to}, else null
        chain: [], frontId: null, seen: {}, present: [], still: {still: false, since: null}, rolledAt: null,
        startAt: null, locked: false, startFront: null, startFound: false, over: false, finish: false,
        alone: false, climb: initialClimb(), hill: initialHill(), run: {n: 0, at: null},
    };
}


// How long a new owner must have pulled before the last owner can no longer take his turn back:
// half his plan pull (no start bonus), at least CLEAR_MIN_MS.
export function clearMs(plan, id) {
    const pullS = plan?.riders?.find(r => r.id === id)?.pullS;
    return Number.isFinite(pullS) ? Math.max(CLEAR_MIN_MS, CLEAR_FRAC * pullS * 1000) : CLEAR_MIN_MS;
}


// The largest smoothed gap between me and a rider behind me in the gap state (gaps.mjs): the gap that
// cut him off and any after it. 0 without a gap state (off: my chain decides) and for its front rider;
// Infinity while the state does not have him (yet: it is a step behind the positions).
function gapTo(gaps, selfId, id) {
    const rs = gaps?.riders;
    if (!gaps?.frontId || id === gaps.frontId) {
        return 0;
    }
    if (!rs[id]) {
        return Infinity;
    }
    const myAt = rs[selfId]?.at ?? 0;
    return Math.max(0, ...Object.values(rs).filter(r => r.at > myAt && r.at <= rs[id].at).map(r => r.m));
}


// A rider's power as a fraction of his plan watts: the mean of his last POWER_N samples in the gap
// state (gapStep keeps one a step). Fewer samples or no plan power: null.
function powerFrac(gaps, plan, id) {
    const xs = (gaps?.pw?.[id] || []).slice(-POWER_N);
    const w = plan?.riders?.find(r => r.id === id)?.watts;
    return xs.length < POWER_N || !(w > 0) ? null : xs.reduce((a, b) => a + b, 0) / xs.length / w;
}

// The power filter's verdict on the plan's next: under FILTER_NEXT_FRAC of his plan power while the
// owner is at FILTER_OWNER_FRAC of his. Unknown power: false.
function softNext(gaps, plan, nextId, ownerId) {
    const n = powerFrac(gaps, plan, nextId), o = powerFrac(gaps, plan, ownerId);
    return n !== null && o !== null && n < FILTER_NEXT_FRAC && o >= FILTER_OWNER_FRAC;
}


// True in the last END_PHASE_S of an event (my nearby entry): the time left, or the distance left
// over my average speed since startAt (ms; only END_SPEED_MIN_S after it). Else false.
export function endPhase(entry, {now, startAt}) {
    if (entry?.remainingType !== 'event' || !Number.isFinite(entry.remaining)) {
        return false;
    }
    if (entry.remainingMetric === 'time') {
        return entry.remaining <= END_PHASE_S;
    }
    const t = (now - startAt) / 1000;
    const v = entry.state?.eventDistance / t;
    return entry.remainingMetric === 'distance' && startAt != null && t >= END_SPEED_MIN_S && v > 0 &&
        entry.remaining / v <= END_PHASE_S;
}


// The riders who can pull: present and not hanging.
const avail = st => st.present.filter(id => !st.hanging.includes(id));

// Bookkeeping at the end of every step: the owner pulls, so he does not sit out; the line. `self` is
// what happened to my own pull start in this step (rotation.mjs selfEvent).
function done(st, prev, plan, selfId) {
    delete st.out[st.front.puller];
    st.line = lineOf(plan, {presentIds: avail(st), out: st.out, keepIds: [st.front.puller, selfId]});
    return {state: st, self: selfEvent(prev.front, st.front)};
}


// One step (about once a second), with rotationStep's inputs plus `gaps`, the gap state of the step
// before (gapStep's last result, or null), and `filter` (the power filter, off; the replay sets it).
// Returns the new state and my own pull event ('start' | 'draftStart' | 'revert' | null).
export function turnsStep(prev, {now, plan, riderIds, selfId, nearby, hist, drafts, grade, sampleT,
                                 terrain = undefined, gaps = null, filter = false}) {
    const st = {...prev, out: {...prev.out}, change: null};
    // 1. Sensors.
    const has = selfId !== null && selfId !== undefined;
    st.chain = has ? teamChain(alignedPositions(nearby, riderIds), selfId, TURN_CHAIN_M) : [];
    st.frontId = frontOf(st.chain, riderIds);
    const live = has && selfLive(nearby, selfId);
    const entry = selfEntry(nearby);
    st.still = live ?
        stillStep(prev.still, {now, speed: Number(entry?.state?.speed), tracking: prev.front.puller != null}) :
        (prev.still || {still: false, since: null});
    st.finish = finishStep(prev.finish, {live, entry, still: st.still.still});
    ({seen: st.seen, ids: st.present} = presence(prev.seen, {now, chainIds: st.chain.map(c => c.id),
                                                             graceMs: TURN_PRESENT_MS}));
    const {rolledAt, over, startAt, locked, starting, p1} =
        startStep(prev, {now, live, still: st.still, present: st.present, plan, selfId, entry});
    Object.assign(st, {rolledAt, over, startAt, locked});
    st.climb = climbState(prev.climb, {now, grade: live && !locked ? grade : null});
    st.alone = live && !st.chain.some(c => c.id !== selfId);
    // The terrain: the route profile's hill at my place, else the old core's live-grade rule (a roller for
    // ROLLER_LIVE_MS, then a real hill; user, 23 Nov 2026: "no route, back to old percentage").
    st.hill = locked ? initialHill() : hillMode(st.climb, {now, terrain: live ? terrain : undefined});
    // 2. Hanging: everyone the warning's frontmost full gap cuts off (none when I am behind it), at once.
    // A hanging rider (still present) is back only in my chain with every smoothed gap between us under
    // GAP_ON_M (spec §2), also when the cut moves to a later gap or vanishes: no flicker.
    const cut = cutOff(gaps, selfId);
    const inChain = new Set(st.chain.map(c => c.id));
    const back = id => inChain.has(id) && gapTo(gaps, selfId, id) < GAP_ON_M;
    const hang = new Set([...(cut?.ids || []),
                          ...(prev.hanging || []).filter(id => st.present.includes(id) && !back(id))]);
    st.hanging = (plan?.riders || []).map(r => r.id).filter(id => id !== selfId && hang.has(id));
    st.cut = cut ? {id: cut.id, m: cut.m} : null;
    // 3. Standing still: no turns (the first front rider after the stop gets a fresh clock).
    if (st.still.still) {
        Object.assign(st, {front: initialFront(), fr: {id: null, since: null}, prev: null, out: {}, hanging: [],
                           cut: null, disp: null, check: null, soft: null, run: {n: 0, at: null}, careful: false});
        return done(st, prev, plan, selfId);
    }
    // 4. The start: plan #1 with his bonus; nothing changes during the lock.
    if (starting) {
        st.front = {...initialFront(), puller: p1, since: now, bonus: {id: p1, since: now, s: START_BONUS_S}};
        st.change = {kind: 'start', from: null, to: p1};
    }
    const inFront = locked && st.frontId != null && st.frontId === st.front.puller;
    st.startFront = inFront ? (starting ? now : prev.startFront ?? now) : null;
    st.startFound = locked && ((!starting && !!prev.startFound) ||
        (st.startFront !== null && now - st.startFront >= HOLD_MS));
    // 5. The front rider and since when (none while alone, nor the old owner just after my own start), also
    // during the lock: the owner after it gets his real since.
    const ig = st.front.ignore;
    const f = st.alone || (ig && st.frontId === ig.id && now - ig.at < SELF_IGNORE_MS) ? null : st.frontId;
    st.fr = f === prev.fr?.id ? prev.fr : {id: f, since: now};
    if (locked) {
        return done(st, prev, plan, selfId);
    }
    // How long he holds the front, for the holds: not the time in the start lock (his clock still runs from
    // his real since).
    const unlock = st.startAt == null ? -Infinity : st.startAt + START_LOCK_MS;
    const held = f == null ? 0 : now - Math.max(st.fr.since, unlock);
    const owner = st.front.puller;
    const line0 = lineOf(plan, {presentIds: avail(st), out: st.out, keepIds: [owner, selfId]});
    const next = line0[(line0.indexOf(owner) + 1) % line0.length];
    // The plan's next: also a rider sitting out whose change from the owner is 'next' (back in his plan
    // slot: the line with him kept, as classifyChange does for every change).
    const isNext = id => id === next || (id != null && id !== owner &&
        classifyChange(plan, {fromId: owner, toId: id, presentIds: avail(st), out: st.out}).kind === 'next');
    // 6. My own pull start, as today (rotation.mjs ownPull and trackFront): only on the flat, and only
    // while I am the plan's next with the owner due or gone (startGate, on the view before this step).
    // A power jump (the 8 s rule when gone) waits CONFIRM_MS for my draft or my place in front; a
    // draft run starts at once. Either makes me the owner from its start. My ease-off is not computed:
    // my turn ends only when the next owner takes over (spec §2).
    const flat = live && !st.finish && !st.alone && !st.disp && st.hill.mode === null;
    const view0 = flat ? turnsStatus({...st, front: prev.front, line: prev.line}, {now, plan, selfId, live: true}).view : null;
    const gate = startGate(view0, {chainIds: st.chain.map(c => c.id), selfId});
    if (sampleT !== null && sampleT !== undefined) {
        st.run = draftRun(prev.run, {t: sampleT, ok: !!gate && draftFront({drafts, chain: st.chain, selfId})});
    }
    const w = plan?.riders?.find(r => r.id === selfId)?.watts;
    const target = Number.isFinite(w) ? w : null;
    const jump = gate === 'due' ? powerJump(hist, target) : gate ? sustainedJump(hist, target) : null;
    const fresh = t => !(t <= st.front.last?.at);
    // I take over: the owner I passed is the last owner (the return rule), ignored as front rider for
    // SELF_IGNORE_MS; after a wrong start the return rule gives him his turn back. My start is classified
    // like any owner change (`class`): on a skip the riders I passed over sit out until they pull, and
    // the return rule brings them back (19 Nov 2026: a rider I passed stayed in my countdown).
    const take = (kind, at) => {
        const c = classifyChange(plan, {fromId: owner, toId: selfId, presentIds: avail(st), out: st.out});
        for (const id of c.skipped) {
            st.out[id] = true;
        }
        st.prev = owner == null ? null : {id: owner, since: st.front.since, skipped: c.skipped};
        st.front = {...st.front, puller: selfId, since: at, pending: null, last: {kind, at},
                    ignore: owner == null ? null : {id: owner, at: now}};
        st.change = {kind: 'self', class: c.kind, from: owner, to: selfId};
    };
    if (st.front.pending && owner === selfId) {
        st.front = {...st.front, pending: null};    // the owner by the rules below meanwhile
    } else if (!st.front.pending && jump !== null) {
        if (fresh(jump)) {
            st.front = {...st.front, pending: {id: selfId, at: jump}};
        }
    } else if (!st.front.pending && gate && st.run.n >= DRAFT_RUN_N && fresh(st.run.at)) {
        take('draftStart', st.run.at);
    }
    const pend = st.front.pending;
    if (pend && flat && startConfirmed({drafts, chain: st.chain, selfId, frontId: st.frontId})) {
        take('start', pend.at);
    } else if (pend && now - pend.at >= CONFIRM_MS) {
        st.front = {...st.front, pending: null, last: {kind: 'revert', at: now}};
    }
    // 7. The climb display (spec §3), only on a real hill (route profile or live grade). On at the first
    // trigger: a rider not the owner nor the plan's next in front NEXT_HOLD_MS, or an open gap of
    // CLIMB_GAP_M that splits my group: a rider behind it (the gap state's `behind`, not only the one right
    // behind it: he may sit out) in the line this step started from (st.line), the rider in front of it
    // (`ahead`) in it or present (sitting out counts);
    // not a rider who never joined or already hangs, nor one far ahead of us all (19 Nov 2026). No power
    // trigger: teams level their W/kg on climbs, so the puller under 70 % of his plan watts is normal
    // climbing (22 Nov 2026; user, 23 Nov: "power trigger raus"). Meanwhile the front rider of
    // NEXT_HOLD_MS leads, with no owner change.
    // The return rule (step 8): the last owner back in front before the new owner is clear, counted from the
    // new owner's start. Not in a line of two (the last owner is the plan's next there: a normal change).
    const returning = !!st.prev && f === st.prev.id && line0.length !== 2 &&
        st.fr.since - st.front.since < clearMs(plan, owner);
    const real = st.hill.mode === 'pause';
    if (!st.disp && owner != null && real) {
        const why = f != null && f !== owner && !isNext(f) && !returning && held >= NEXT_HOLD_MS ? 'front' :
            Object.entries(gaps?.riders || {}).some(([id, r]) => r.open && r.m >= CLIMB_GAP_M &&
                (r.behind || [id]).some(x => st.line.includes(x)) &&
                (st.line.includes(r.ahead) || st.present.includes(r.ahead))) ?
                'gap' : null;
        st.disp = why ? {at: now, why, pend: null} : null;
    }
    if (st.disp) {
        if (f != null && held >= NEXT_HOLD_MS) {
            st.front = {...st.front, puller: f, since: st.fr.since};
        }
        // The end, once the hill (and the descent after it) is over: a clear puller (`pend`), and before
        // the end phase, or after a wrong end in it (`careful`), then his plan's next for NEXT_HOLD_MS.
        // No clear puller is kept over a hill or while nobody is in front (a later end would take his old run).
        if (real || f == null) {
            st.disp = st.disp.pend ? {...st.disp, pend: null} : st.disp;
        } else {
            const needNext = !endPhase(entry, {now, startAt: st.startAt ?? st.rolledAt}) || st.careful;
            let pend = st.disp.pend, to = null;
            if (!pend && held >= clearMs(plan, f)) {
                pend = {id: f, since: st.fr.since};
            }
            if (pend && f === pend.id && !needNext) {
                to = {id: f, since: st.fr.since};    // his current front run (he may have dropped back)
            } else if (pend && f !== pend.id && held >= NEXT_HOLD_MS) {
                // His plan's next in the line with the riders sitting out, as for every change.
                const c = classifyChange(plan, {fromId: pend.id, toId: f, presentIds: avail(st), out: st.out});
                if (c.kind === 'next') {
                    to = {id: f, since: st.fr.since};
                } else {
                    pend = held >= clearMs(plan, f) ? {id: f, since: st.fr.since} : null;
                }
            }
            if (to) {
                st.front = {...st.front, puller: to.id, since: to.since};
                Object.assign(st, {out: {}, prev: null, disp: null, check: {n: 0, bad: false},
                                   change: {kind: 'climb', from: owner, to: to.id}});
            } else {
                st.disp = {...st.disp, pend};
            }
        }
    }
    // 8. Owner rules (not during the climb display, nor right after my own start). The power filter
    // (switchable, off): the plan's next is decided once per front stint at FILTER_AT_MS, and a soft
    // next (softNext) waits OTHER_HOLD_MS.
    if (!st.disp && !st.change) {
        const stint = x => x?.id === f && x.since === st.fr.since;
        if (filter && owner != null && isNext(f) && held >= FILTER_AT_MS && !stint(st.soft)) {
            st.soft = {id: f, since: st.fr.since, v: softNext(gaps, plan, f, owner)};
        }
        const nextHold = !filter ? NEXT_HOLD_MS : stint(st.soft) && st.soft.v ? OTHER_HOLD_MS : FILTER_AT_MS;
        if (owner == null) {
            if (held >= NEXT_HOLD_MS) {
                st.front = {...st.front, puller: f, since: st.fr.since};
                st.change = {kind: 'first', from: null, to: f};
            }
        } else if (returning && held >= NEXT_HOLD_MS) {
            // The return: the last owner took the front back (held 3 s) before the new one was clear. The change
            // is taken back, with the riders it set out, and his clock goes on from his old since. One way: no
            // last owner afterwards (if the new one takes the front again, that is a normal change).
            for (const id of st.prev.skipped) {
                delete st.out[id];
            }
            st.front = {...st.front, puller: st.prev.id, since: st.prev.since};
            st.change = {kind: 'return', from: owner, to: st.prev.id};
            st.prev = null;
        } else if (f != null && f !== owner && held >= (isNext(f) ? nextHold : OTHER_HOLD_MS)) {
            const {kind, skipped} = classifyChange(plan, {fromId: owner, toId: f, presentIds: avail(st), out: st.out});
            for (const id of skipped) {
                if (id !== selfId) {
                    st.out[id] = true;
                }
            }
            st.prev = {id: owner, since: st.front.since, skipped};
            st.front = {...st.front, puller: f, since: st.fr.since};
            st.change = {kind, from: owner, to: f};
        }
    }
    // 9. After a display's end, the next owner changes (not a return): a back change within two makes
    // the next end in the end phase wait for the expected change (`careful`), two others undo that.
    const kind = st.change?.kind;
    if (st.check && kind && kind !== 'climb' && kind !== 'return') {
        const check = {n: st.check.n + 1, bad: st.check.bad || kind === 'back'};
        const settled = check.n >= 2 || check.bad;
        if (settled && endPhase(entry, {now, startAt: st.startAt ?? st.rolledAt})) {
            st.careful = check.bad;
        }
        st.check = settled ? null : check;
    }
    return done(st, prev, plan, selfId);
}


// True while the climb display waits for its end after the hill (and its descent) is over.
const afterHill = st => !!st.disp && st.hill?.mode !== 'pause';

const viewOf = (st, front, {now, plan, selfId}) => rotationView(plan, {selfId, chainIds: st.line, front, now, eff: null,
    wheelId: planWheel(plan, {selfId, pullerId: front.puller, presentIds: st.line})});

// The view and why there is none (dashReason; 'nofront' before an owner). Never 'chaos'. The
// countdown is the fixed rule (eff null) on the owner, his clock and the line. The climb display
// is 'climb'/'descent' (▲/▼) only on the hill; after it, until its end, the quiet 'regroup' (user,
// 23 Nov 2026: "▲ goes at the end of the climb"). `provisional` (measuring only, off in the mod):
// in 'regroup' with a clear puller, his view as if he were the owner, marked provisional.
export function turnsStatus(st, {now, plan, selfId, live, quietStart = false, provisional = false}) {
    let reason = dashReason({plan, selfId, live, finish: st.finish, climbing: !!st.disp,
                             descent: !!st.hill?.descent, chain: st.chain, still: !!st.still?.still,
                             starting: quietStart && startQuiet(st, now) && st.front?.puller !== selfId});
    if ((reason === 'climb' || reason === 'descent') && afterHill(st)) {
        reason = 'regroup';
        const pend = st.disp.pend;
        const view = provisional && pend ? viewOf(st, {puller: pend.id, since: pend.since}, {now, plan, selfId}) : null;
        if (view) {
            return {view: {...view, provisional: true}, reason: null};
        }
    }
    if (reason) {
        return {view: null, reason};
    }
    const view = viewOf(st, st.front, {now, plan, selfId});
    return view ? {view, reason: null} : {view: null, reason: 'nofront'};
}


// The state for a newly loaded plan, as carryRotation: the owner still in the plan keeps his turn and
// clock, and riders who left the plan are dropped; else it starts over, keeping the climb and the start.
export function carryTurns(st, plan) {
    const ids = new Set((plan?.riders || []).map(r => r.id));
    if (!plan || (st.front.puller != null && !ids.has(st.front.puller))) {
        return {...initialTurns(), climb: st.climb, hill: st.hill ?? initialHill(), rolledAt: st.rolledAt ?? null,
                startAt: st.startAt ?? null};
    }
    const keep = id => ids.has(id);
    const ref = x => (x && keep(x.id) ? x : null);
    const prev = ref(st.prev);
    return {...st,
            front: {...st.front, pending: ref(st.front.pending), ignore: ref(st.front.ignore)},
            out: Object.fromEntries(Object.entries(st.out || {}).filter(([id]) => keep(id))),
            hanging: (st.hanging || []).filter(keep),
            prev: prev && {...prev, skipped: (prev.skipped || []).filter(keep)},
            seen: Object.fromEntries(Object.entries(st.seen || {}).filter(([id]) => keep(id))),
            present: (st.present || []).filter(keep),
            line: (st.line || []).filter(keep),
            disp: st.disp && {...st.disp, pend: ref(st.disp.pend)}};
}


// The rotation table (spec §2 "Rotation table"): the plan in order from the owner (from #1 without
// one). Everyone keeps his slot, with his state: 'gone' (started, not in the group, not the owner),
// 'hanging' (cut off behind a full gap), 'out' (sitting out after a skip), else 'line'. A rider both
// gone and hanging is gone. Gone riders go below the dashed line, in plan order. The first hanging
// row has the gap's metres, not the owner's (his row shows his clock). Before the start everyone is
// in the line. My own row (selfId) is never gone: my presence follows my own data.
export function turnTable(plan, {st, started, selfId = null}) {
    const riders = plan?.riders || [];
    const pi = riders.findIndex(r => r.id === st.front?.puller);
    const start = Math.max(0, pi);
    const here = new Set(st.present || []);
    const hang = new Set(st.hanging || []);
    const rows = riders.map((_, k) => {
        const i = (start + k) % riders.length;
        const rider = riders[i];
        const gone = started && i !== pi && rider.id !== selfId && !here.has(rider.id);
        const state = !started ? 'line' : gone ? 'gone' : hang.has(rider.id) ? 'hanging' :
            Object.hasOwn(st.out || {}, rider.id) ? 'out' : 'line';
        return {rider, number: i + 1, pulling: i === pi, present: state !== 'gone', state, gapM: null};
    });
    const first = rows.find(r => r.state === 'hanging' && !r.pulling);
    if (first) {
        first.gapM = st.cut?.m ?? null;
    }
    return [...rows.filter(r => r.present), ...rows.filter(r => !r.present).sort((a, b) => a.number - b.number)];
}


// What the recording keeps of a step (det.turn): this step's change only, the climb display with its
// trigger (quiet: after the hill, the windows' 'regroup'), who hangs and who sits out.
export function turnDet(st) {
    const c = st.change;
    return {change: c ? {kind: c.kind, ...(c.class ? {class: c.class} : {}), from: c.from, to: c.to} : null,
            disp: st.disp ? {why: st.disp.why, at: st.disp.at, ...(afterHill(st) ? {quiet: true} : {})} : null,
            hanging: [...(st.hanging || [])],
            out: Object.keys(st.out || {})};
}
