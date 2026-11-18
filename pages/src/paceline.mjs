// Overlay windows and the team recorder. All pages run main(mode): 'info' (paceline.html: plan,
// you, front rider, your wheel, recorder), 'action' (action.html: one big element, the clock to my
// pull or my pull's target in W or W/kg, time left and power bar) and 'rest' (rest.html: the same
// element with only the clock to my pull; prefs.restInAction off leaves that to it alone).
//
// About once a second each open overlay window takes part in a lease (raw localStorage, LEASE_KEY) so
// that exactly one of them records. The owner runs the recorder state machine on the state kept
// in localStorage (REC_STATE_KEY), so a window that takes the lease over continues the same
// session. Ticks go to IndexedDB without blocking the loop. Rider names come from files and from
// Zwift, so they only ever go in through textContent.
//
// Every window (lease owner or not) follows the rotation itself on each step: who is at the front
// of my team chain, held for HOLD_MS before counting as the puller. My own pull also starts on a
// power jump while I am next (confirmed by my draft) or on my draft alone, and ends on a sharp
// power drop (see trackFront). Climbs pause the rotation, the final sprint ends it, and a rider
// without a teammate near him sees no rotation. That state lives in memory.
//
// One overlay window (its own lease, POLL_LEASE_KEY) polls the plan server every POLL_MS (with the
// TTT-only option only during the TTT event, from the start pen on) and
// activates a changed plan right away; the other windows pick it up through the storage event.
// Network errors stay out of the overlay; the settings window shows them.
//
// When the rider switched recording upload on (and the plan server too), the recorder's lease
// owner also looks every SWEEP_MS for finished recordings not yet on the plan server and uploads
// the oldest one (one upload at a time per window, a failed session again after retryAfterMs;
// only rides started after the box was ticked). Never while a recording runs: packing a long
// session freezes the window for a moment, and the stop makes the next step look right away.
// Upload failures only reach the console, once per kind.
//
// Demo: the settings window's Demo button (prefs.demoUntil) makes every overlay window ride a
// made-up ride for a few minutes (demo.mjs; the active plan, else a sample plan), so the windows
// can be placed and sized without Zwift. Zwift's data is ignored then and nothing is recorded or
// uploaded. ?demo in a plain browser (no Sauce) does the same but keeps the recorder running.
import {findMe} from './engine/plan.mjs';
import {MAX_AGE_MS, LEASE_STALE_MS, planIds, selfEntry, planRidersPresent, initialRecState,
        recStep, makeTick, leaseStep, selfSubgroupId, eventSummary, eventLogStep, initialGate, gateStep}
    from './engine/recording.mjs';
import {BAR_RANGE_PCT, GREEN_PCT, AMBER_PCT, DRAFT_N, selfLive, draftMean, dashKind, wheelOf, placeOf,
        pushPower as pushHist, initialRotation, rotationStep, rotationStatus as statusOf, carryRotation,
        alignedPositions,
        wheelToFollow, plannedWheel, captainNext, rotationTable, tableShown, powerBar}
    from './engine/rotation.mjs';
import {routeProfile, routeHills, hillAt, initialAlign, alignStep} from './engine/terrain.mjs';
import {GAP_FINISHERS, initialGaps, gapStep, gapView, cutBehind} from './engine/gaps.mjs';
import {initialCue, cueStep, cueView, dropWheel, linePlace, freshIds} from './engine/wheelcue.mjs';
import {ALIVE_PREFIX, aliveKey, parseAlive, aliveModes, staleKeys, aliveDue} from './engine/presence.mjs';
import {POWER_KEEP_MS, clock, restClock, pullSecs, nowValue, initialMarker, markerStep, markerPower, actionModel,
        pullOnlyModel, penModel, formatTarget, pickWeight,
        shownModel}
    from './engine/display.mjs';
import {planUrl, serverBase, serverEntry, serverPlanUpdate, pollDue, pollEvery, pollLeaseStep}
    from './engine/planserver.mjs';
import {activePlan, initFlush, schedFlush, onLibraryChange, readPrefs, writePrefs, onPrefsChange,
        readLibrary, writeLibrary, LEASE_KEY, REC_STATE_KEY, POLL_LEASE_KEY} from './store.mjs';
import {logUploadSinceFix, demoOn} from './engine/prefs.mjs';
import {samplePlan} from './engine/demoplan.mjs';
import {SWEEP_MS, logSlug, sessionSlug, pendingUploads} from './engine/logupload.mjs';
import {addTick, saveSessionMeta, prune, listSessions} from './recdb.mjs';
import {uploadSession} from './logupload.mjs';
import {loadCommon, isDemo, selfAthleteId} from './sauce.mjs';
import {startDemo} from './demo.mjs';
import {S, fmt} from './strings.mjs';
import {youParts, riderPullParts} from './youline.mjs';
import {VERSION} from './version.mjs';

const $ = sel => document.querySelector(sel);
// Steps follow the nearby updates (about 1 Hz). Those keep arriving while Sauce hides the window,
// when Chromium throttles timers to about once a minute. The timer only covers gaps in the data.
const NEARBY_STEP_MS = 500;      // a nearby update steps when the last step is this old
const FALLBACK_STEP_MS = 1250;   // without updates, the timer steps when the last step is this old
const FALLBACK_POLL_MS = 250;
const SELF_POLL_MS = 3000;
const WEIGHT_POLL_MS = 10000;    // asking Sauce for my weight when the nearby data has none
const EVENT_RETRY_MS = 30000;    // asking Sauce again for an event it could not find
const FETCH_TIMEOUT_MS = 15000;  // a plan server request that takes longer counts as not reachable

// Per-window lease id: every overlay window competes with its own.
const ME = (globalThis.crypto && crypto.randomUUID) ?
    crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

let Common = null;
let mode = 'info';         // 'info' | 'action' | 'rest'
let plan = null;           // active plan or null
let ids = new Set();       // plan rider + bench ids (strings)
let riderIds = new Set();  // plan rider ids only: the bench takes no part in the rotation
let planSig = null;        // sig of the loaded plan; a new plan keeps the front tracking when the
                           // puller is still a rider
let detFailed = false;     // detOf threw once (logged once; those ticks record det: null)
let shownFailed = false;   // shownOf threw once (logged once; those ticks record shown: null)
let gate = initialGate();     // the TTT event gate (gateStep): open from the start pen to the finish
const eventInfo = new Map();   // my event subgroup id -> {summary, at, busy} (eventSummary)
let eventLogged = null;        // {sessionId, key} of the event last written to a tick
let selfId = null;         // own athlete id (string), cached once known
let selfName = null;       // own name from Zwift, if Sauce gives one
let selfWeight = null;     // my weight (kg) from my nearby entry, if Sauce gives one
let rpcWeight = null;      // my weight (kg) from getAthleteData('self'), the fallback
let lastWeightPoll = 0;
let prefs = readPrefs();
let polling = false;       // a plan server request is under way in this window
let uploading = false;     // a recording upload (sweep) is under way in this window
let lastSweepAt = 0;       // when this window last looked for recordings to upload (0: soon)
const uploadLogged = new Set();    // upload error kinds already logged
let nearby = [];           // latest nearby list
let nearbyAt = 0;          // when it arrived (ms)
let lastSelfPoll = 0;
let lastStepAt = 0;
let stopDemo = null;
let demoKind = null;       // null | 'url' (?demo, plain browser) | 'pref' (Demo button)
// Meta of a session this window started, until it is stored; ticks wait for the first attempt.
let pendingMeta = null;    // {sessionId, meta, inFlight}
let metaGate = {sessionId: null, ready: Promise.resolve()};
// Rotation (per window, in memory): the engine's state (rotationStep) and my own samples.
let rot = initialRotation();
let marker = initialMarker();    // my smoothed power and the marker's colour (power bar)
let gaps = initialGaps();  // gaps in the team line (gaps.mjs): a rider or the group losing the wheel
let cue = initialCue();    // the wheel to drop in behind, in the rest line (wheelcue.mjs)
let powerWt = null;        // worldTime of the last self sample taken
let hist = [];             // my power history {t, w} for my own pull start and end
let drafts = [];           // my last DRAFT_N draft samples (W)
let sampleT = null;        // when the newest self sample arrived, until a step has used it
let grade = null;          // my grade in percent from the last self sample, null if unknown
// The event route's terrain (terrain.mjs): its profile and hills from Sauce, loaded once per route,
// and where I am on it (my event distance plus the offset found from my altitude).
let terrain = {routeId: null, busy: false, at: 0, profile: null, hills: [], align: initialAlign()};
let eventDist = null;      // my event distance (m) from the last self sample
let sauceRouteDist = null; // Sauce's own route distance for me (recorded, to compare)
// The last step's own pull event and shadow rules, for the recorder.
let stepOut = {self: null, shadowEarly: null, shadowEnd06: null};


// ---------- storage ----------

function readJson(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw == null ? null : JSON.parse(raw);
    } catch(e) {
        return null;
    }
}


function writeJson(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch(e) {
        console.error('Paceline: saving', key, 'failed', e);
    }
    schedFlush();
}


// Missing or garbage state counts as "not recording".
function readRecState() {
    const st = readJson(REC_STATE_KEY);
    if (!st || typeof st !== 'object' || typeof st.recording !== 'boolean' ||
        (st.sessionId !== null && typeof st.sessionId !== 'string') ||
        (st.lastSeenAt !== null && !Number.isFinite(st.lastSeenAt)) ||
        (st.recording && (st.sessionId === null || st.lastSeenAt === null))) {
        return initialRecState();
    }
    return {recording: st.recording, sessionId: st.sessionId, lastSeenAt: st.lastSeenAt};
}


function leaseFresh(lease, now) {
    const age = lease && typeof lease.at === 'number' ? now - lease.at : NaN;
    return Number.isFinite(age) && age >= 0 && age < LEASE_STALE_MS;
}


// ---------- plan and self ----------

function loadPlan() {
    let res = null;
    try {
        res = activePlan();
    } catch(e) {
        console.error('Paceline: loading the plan failed, continuing without one', e);
    }
    plan = res ? res.plan : demoKind ? samplePlan() : null;
    ids = planIds(plan);
    riderIds = new Set((plan ? plan.riders : []).map(r => r.id));
    const sig = plan ? plan.sig : null;
    if (sig !== planSig) {
        // A plan swap mid-race (server upload) keeps the puller's clock when he is still a rider.
        planSig = sig;
        rot = carryRotation(rot, plan);
    }
    if (stopDemo) {
        stopDemo();
        stopDemo = null;
    }
    if (demoKind) {
        stopDemo = startDemo(plan, list => {
            if (demoKind) {
                onNearby(list);
            }
        });
    }
}


function wantedDemo(now) {
    return isDemo() ? 'url' : demoOn(prefs, now) ? 'pref' : null;
}


// Starts or stops the demo when the Demo button (or its end) says so. Everything learned from
// the data so far is dropped either way, so demo and Zwift riders never mix.
function syncDemo(now) {
    const want = wantedDemo(now);
    if (want === demoKind) {
        return;
    }
    demoKind = want;
    nearby = [];
    nearbyAt = 0;
    selfId = null;
    selfName = null;
    selfWeight = null;
    rot = initialRotation();
    marker = initialMarker();
    gaps = initialGaps();
    cue = initialCue();
    powerWt = null;
    hist = [];
    drafts = [];
    sampleT = null;
    grade = null;
    terrain = {...terrain, align: initialAlign()};
    eventDist = null;
    sauceRouteDist = null;
    planSig = null;
    loadPlan();
    tick();
}


function currentNearby(now) {
    // An update older than MAX_AGE_MS counts as nobody around (Zwift closed, Sauce lost data).
    return now - nearbyAt <= MAX_AGE_MS ? nearby : [];
}


function resolveSelf(list) {
    const me = selfEntry(list);
    resolveWeight(me);
    if (me && me.athleteId != null) {
        selfId = String(me.athleteId);
        const name = me.athlete && (me.athlete.sanitizedFullname || me.athlete.fullname);
        if (name) {
            selfName = String(name);
        }
        return;
    }
    if (selfId === null && Common && Date.now() - lastSelfPoll >= SELF_POLL_MS) {
        lastSelfPoll = Date.now();
        selfAthleteId(Common).then(id => {
            if (id !== null && selfId === null) {
                selfId = id;
            }
        });
    }
}


// My current weight for W/kg, as Sauce computes W/kg: my nearby entry's athlete.weight, else
// getAthleteData('self').athlete.weight (asked at most every WEIGHT_POLL_MS while the entry has
// none, whatever the target unit: the you-line shows W/kg too).
function resolveWeight(me) {
    const w = pickWeight(me && me.athlete && me.athlete.weight);
    if (w !== null) {
        selfWeight = w;
        return;
    }
    const now = Date.now();
    if (Common && now - lastWeightPoll >= WEIGHT_POLL_MS) {
        lastWeightPoll = now;
        new Promise(ok => ok(Common.rpc.getAthleteData('self'))).then(ad => {
            rpcWeight = pickWeight(ad && ad.athlete && ad.athlete.weight) ?? rpcWeight;
        }, e => console.warn('Paceline: could not read own weight', e));
    }
}


// My weight from Zwift, or null (the plan rider's weight is the caller's fallback).
function liveWeight() {
    return pickWeight(selfWeight, rpcWeight);
}


// The plan rider's name, else the name Zwift gives, else 'unknown'.
function sessionName() {
    const me = plan && selfId !== null ? findMe(plan, selfId) : null;
    if (me && me.role === 'rider') {
        return me.rider.name;
    }
    return selfName || 'unknown';
}


// ---------- rotation ----------

// Called right before each recorder step, so the tick's `det` matches this step.
function rotate(now) {
    const {state, ...out} = rotationStep(rot, {
        now, plan, riderIds, selfId, nearby: currentNearby(now), hist, drafts, grade, sampleT,
        terrain: terrainHere(),
    });
    rot = state;
    stepOut = out;
    sampleT = null;
    const list = currentNearby(now);
    const live = selfId !== null && selfLive(list, selfId);
    gaps = gapStep(gaps, {
        now, selfId,
        positions: alignedPositions(list, riderIds).filter(p => riderIds.has(p.id)),
        // Not in the start lock, the final sprint, standing still, or outside the event.
        active: live && !!plan && !muted() && !rot.locked && !rot.finish && !rot.still?.still,
        hill: rot.hill?.mode === 'pause',
        // The riders the team must bring over the line: the plan's, else WTRL's and ZRL's 4.
        needed: plan?.minimumFinishers > 0 ? plan.minimumFinishers : GAP_FINISHERS,
    });
    // The wheel cue: at the start, and when my wheel changes (user, 15 Nov 2026; wheelcue.mjs).
    // My pull ends for the cue as soon as someone is ahead of me (the next puller is confirmed only
    // a few seconds later, and by then I am halfway back).
    const pulling = selfId !== null && rot.front.puller === selfId && rot.frontId === selfId;
    cue = cueStep(cue, {
        now, startAt: rot.startAt ?? null, startPuller: selfId !== null && rot.front.puller === selfId,
        active: live && !!plan && !muted() && !rot.finish && !rot.still?.still && rot.hill?.mode !== 'pause',
        pulling, wheelId: cueWheel(now)?.id ?? null,
        obsId: selfId === null ? null : wheelOf(rot.chain, selfId)});
}


// The wheel for the cue. At the start the riders with the presence grace (who was in the pen), later
// only those in my chain within CUE_FRESH_MS, so a dropped rider stops being my wheel within seconds
// instead of the rotation's 20 s.
function cueWheel(now) {
    if (selfId === null || !plan) {
        return null;
    }
    return dropWheel(plan, {selfId, presentIds: cue.kind === 'start' ? groupIds() : cueGroupIds(now)});
}


// The riders with my group for the cue: seen in my chain within CUE_FRESH_MS, the puller, not cut off
// behind an open gap behind me.
function cueGroupIds(now) {
    const cut = cutBehind(gaps, selfId);
    return [...freshIds(rot.seen, now), rot.front.puller].filter(id => id != null && !cut.has(id));
}


// The wheel I follow, or drop in behind after my pull: the rider before me in plan order who is with
// my group, skipping riders dropped (not in my chain for PRESENT_GRACE_MS) and riders cut off behind
// an open gap behind me (user, 14 Nov 2026: you let yourself drop back into the gap; the wheel is
// the last rider of the group you are in). null without a rotation.
function myWheel(view) {
    if (!view || selfId === null) {
        return null;
    }
    return dropWheel(plan, {selfId, presentIds: groupIds()});
}


// The riders with my group: in my chain (with the presence grace), the puller, not cut off behind an
// open gap behind me.
function groupIds() {
    const cut = cutBehind(gaps, selfId);
    return [...rot.present, rot.front.puller].filter(id => id != null && !cut.has(id));
}


// The open gap warning (gapView), or null.
function gapNow() {
    const speed = Number(selfEntry(currentNearby(Date.now()))?.state?.speed);
    return selfId === null ? null : gapView(gaps, selfId, {speedKmh: Number.isFinite(speed) ? speed : null});
}


// "16 m · 1.3 s" (the seconds at my speed), or only the metres.
function gapAmount(g) {
    return g.s === null ? fmt('gapM', {m: g.m}) : fmt('gapMS', {m: g.m, s: g.s.toFixed(1)});
}


// A plan rider's first name (the gap warning), '?' when unknown.
function firstName(id) {
    const r = plan?.riders.find(x => x.id === id);
    return r ? String(r.name).trim().split(/\s+/)[0] : '?';
}


// What the windows show: quiet for the first seconds after rolling off (the engine goes on).
function rotationStatus(now) {
    if (muted()) {
        return {view: null, reason: 'noevent'};
    }
    return statusOf(rot, {now, plan, selfId, live: selfId !== null && selfLive(currentNearby(now), selfId),
                          quietStart: true});
}


// The event gate for the recorder: null when Paceline is not tied to events (option off, or the
// demo), else the gate.
function eventGate() {
    return prefs.tttOnly && !demoKind ? gate : null;
}


// Outside a TTT event (with the option on): the windows are quiet, nothing records or polls.
function muted() {
    return !!eventGate() && !gate.open;
}


// While I pull (by the engine's last step): {since, target} for the power marker, else null.
function myPull(now) {
    const {view} = statusOf(rot, {now, plan, selfId, live: true});
    return view && view.mine ? {since: rot.front.since, target: Number.isFinite(view.me.watts) ? view.me.watts : null} : null;
}


// One sample per new self state (several nearby updates can carry the same one).
function samplePower(list, now) {
    const me = selfEntry(list);
    if (!me || !me.state) {
        return;
    }
    const wt = me.state.worldTime;
    if (wt !== undefined && wt !== null && wt === powerWt) {
        return;
    }
    powerWt = wt;
    marker = markerStep(marker, {at: now, w: me.state.power, pull: myPull(now)});
    // After a gap in my data the old samples are no rest power to compare a jump with.
    const last = hist[hist.length - 1];
    if (last && now - last.t > POWER_KEEP_MS) {
        hist = [];
        drafts = [];
    }
    hist = pushHist(hist, {t: now, w: me.state.power});
    if (Number.isFinite(me.state.draft)) {
        drafts = [...drafts, me.state.draft].slice(-DRAFT_N);
    }
    sampleT = now;
    // Sauce gives the grade as a fraction (0.03 = 3 %).
    grade = Number.isFinite(me.state.grade) ? me.state.grade * 100 : null;
    eventDist = Number.isFinite(me.state.eventDistance) ? me.state.eventDistance : null;
    sauceRouteDist = Number.isFinite(me.state.routeDistance) ? me.state.routeDistance : null;
    if (terrain.profile) {
        terrain.align = alignStep(terrain.align, {d: eventDist, alt: me.state.altitude, profile: terrain.profile});
    }
}


// ---------- terrain ----------

// My place on the route, null until the offset is found.
function routePos() {
    return terrain.profile && terrain.align.offset !== null && eventDist !== null ?
        eventDist + terrain.align.offset : null;
}


// For the engine: the profile's hill here ({hill}, hill null on the flat), or undefined while the
// profile or my place on it is unknown (the engine then goes by the live grade).
function terrainHere() {
    const pos = routePos();
    return pos === null ? undefined : {hill: hillAt(terrain.hills, pos)};
}


// Loads the profile of my event's route once (one-lap events only: the profile is one lap with
// its lead-in). A failure is tried again after EVENT_RETRY_MS.
function terrainStep(ev, now) {
    const routeId = ev && ev.found && ev.routeId != null && (ev.laps ?? 1) <= 1 ? ev.routeId : null;
    if (routeId === null || terrain.busy || typeof Common?.getRoute !== 'function') {
        return;
    }
    if (routeId === terrain.routeId && (terrain.profile || now - terrain.at < EVENT_RETRY_MS)) {
        return;
    }
    terrain = {routeId, busy: true, at: now, profile: null, hills: [], align: initialAlign()};
    Promise.resolve(Common.getRoute(routeId)).then(route => {
        const profile = routeProfile(route);
        terrain = {...terrain, busy: false, at: Date.now(), profile, hills: routeHills(profile)};
        if (!profile) {
            console.warn('Paceline: no elevation profile for route', routeId);
        }
    }, e => {
        console.warn('Paceline: could not load route', routeId, e);
        terrain = {...terrain, busy: false, at: Date.now()};
    });
}


// ---------- recorder ----------

function logDb(what) {
    return e => console.error(`Paceline: ${what} failed`, e);
}


function storeMeta() {
    const p = pendingMeta;
    if (!p || p.inFlight) {
        return null;
    }
    p.inFlight = true;
    return saveSessionMeta(p.sessionId, p.meta).then(() => {
        if (pendingMeta === p) {
            pendingMeta = null;
        }
    }, e => {
        p.inFlight = false;    // retried on the next tick
        logDb('saving session meta')(e);
    });
}


function onStart(state) {
    pendingMeta = {
        sessionId: state.sessionId,
        inFlight: false,
        meta: {
            startedAt: Number(state.sessionId),
            planSig: plan ? plan.sig : null,
            team: plan ? plan.team : null,
            selfId,
            selfName: sessionName(),
            version: VERSION,
            display: {targetUnit: prefs.targetUnit, showNext: prefs.showNext},
            slug: logSlug(prefs, plan),    // the team to upload this recording to (sessionSlug)
            plan,
        },
    };
    metaGate = {sessionId: state.sessionId, ready: storeMeta()};
}


function writeTick(sessionId, tick) {
    const gate = metaGate.sessionId === sessionId ? metaGate.ready : Promise.resolve();
    gate.then(() => addTick(sessionId, tick)).catch(logDb('saving a tick'));
}


// One recorder step. Only the lease owner gets past the lease check.
function step() {
    if (demoKind === 'pref') {
        return;    // made-up riders are never recorded (nor uploaded: the sweep runs from here)
    }
    const now = Date.now();    // right before reading the lease: takeLease checks its age
    const lease = readJson(LEASE_KEY);
    const list = currentNearby(now);
    resolveSelf(list);
    if (selfId === null) {
        return;    // R7a: no self id, no recording
    }
    // A lease taken in this step only counts from the next one (see leaseStep).
    const {act, write} = leaseStep(lease, ME, now);
    if (write) {
        writeJson(LEASE_KEY, write);
    }
    if (!act) {
        return;
    }
    const before = readRecState();
    const {state, action} = recStep(before, {now, present: planRidersPresent(list, ids), gate: eventGate(),
                                             planned: prefs.recordWithoutPlan || ids.has(String(selfId))});
    if (JSON.stringify(state) !== JSON.stringify(before)) {
        writeJson(REC_STATE_KEY, state);
    }
    maybeSweep(now, state);
    if (action === 'start') {
        onStart(state);
    } else if (action === 'stop') {
        pendingMeta = null;
        prune().catch(logDb('pruning old recordings'));
        lastSweepAt = 0;    // the finished ride goes up on the next step
    }
    if (state.recording) {
        if (pendingMeta && pendingMeta.sessionId === state.sessionId) {
            storeMeta();
        }
        // In a TTT: the riders of my event near me too when the plan riders are missing.
        const row = makeTick(list, ids, now, {fallback: !!eventGate()});
        try {
            row.det = detOf(now);
        } catch (e) {
            if (!detFailed) {
                detFailed = true;
                console.error('Paceline: could not record the decision details:', e);
            }
            row.det = null;
        }
        const ev = eventOf(list, now);
        if (ev !== undefined) {
            const {log, next} = eventLogStep(eventLogged, {sessionId: state.sessionId, summary: ev});
            eventLogged = next;
            if (log) {
                row.event = ev;    // only when it changed: carry it forward in the analysis
            }
        }
        try {
            row.shown = shownOf(now);
        } catch (e) {
            if (!shownFailed) {
                shownFailed = true;
                console.error('Paceline: could not record what the windows showed:', e);
            }
            row.shown = null;
        }
        writeTick(state.sessionId, row);
    }
}


// The event I am in, for the recording (eventSummary), null outside events, undefined while Sauce
// is still being asked. The answer is kept per subgroup; a miss is asked again after a while.
function eventOf(list, now) {
    const sgId = selfSubgroupId(list);
    if (sgId === null) {
        return null;
    }
    const known = eventInfo.get(sgId);
    const rpc = Common && Common.rpc;
    if (rpc && typeof rpc.getEventSubgroup === 'function' && !known?.busy && !known?.summary?.found &&
        (!known || now - known.at >= EVENT_RETRY_MS)) {
        eventInfo.set(sgId, {summary: known?.summary ?? null, at: now, busy: true});
        (async () => {
            const sg = await rpc.getEventSubgroup(sgId);
            let ev = null;
            if (sg && sg.eventId != null && typeof rpc.getEvent === 'function') {
                ev = await Promise.resolve(rpc.getEvent(Number(sg.eventId))).catch(() => null);
            }
            return eventSummary(sgId, sg, ev);
        })().then(summary => {
            eventInfo.set(sgId, {summary, at: Date.now(), busy: false});
        }, e => {
            console.warn('Paceline: could not read the event', sgId, e);
            eventInfo.set(sgId, {summary: eventSummary(sgId, null, null), at: Date.now(), busy: false});
        });
    }
    return eventInfo.get(sgId)?.summary ?? undefined;
}


// What this step saw and decided, for tuning after the ride.
// What the windows showed in this step (both windows' content, whichever window records).
// What the Action and Rest windows show: the rotation, or plan #1 armed in the start pen (with
// his target and a neutral marker, like READY).
function windowModel(view, reason, now) {
    const meanW = markerPower(marker, now);
    const pen = penModel({plan, selfId, reason, started: rot.startAt != null});
    if (pen) {
        const watts = myRider(view)?.watts;
        const ok = Number.isFinite(watts);
        const bar = ok ? powerBar(meanW, watts) : null;
        return {...pen, watts: ok ? watts : null, marker: bar ? {...bar, zone: null} : null};
    }
    return actionModel(view, meanW, marker.zone);
}


function shownOf(now) {
    const {view, reason} = rotationStatus(now);
    return shownModel({
        m: windowModel(view, reason, now),
        dash: dashKind(reason, {started: rot.front.puller != null}),
        meanW: markerPower(marker, now),
        wheel: wheelToFollow(plan, selfId, view && {wheel: myWheel(view)}),
        next: captainNext({plan, view, reason, pullerId: rot.front.puller}),
    });
}


function detOf(now) {
    const {view, reason} = rotationStatus(now);
    let kind = 'dash';
    if (view) {
        kind = view.mine ? 'pull' : view.next?.id === selfId ? 'next' : 'rest';
    }
    return {
        planSig,
        puller: rot.front.puller,
        since: rot.front.since,
        frontId: rot.frontId,
        self: stepOut.self,
        finish: rot.finish,
        view: kind,
        reason,
        wheel: view && view.wheel ? view.wheel.id : null,    // from the plan (shown)
        wheelObs: selfId === null ? null : wheelOf(rot.chain, selfId),    // observed in my chain
        wheelCue: cueView(cue, now)?.id ?? null,    // the wheel shown in the rest line (wheelcue.mjs)
        place: view ? view.place : null,    // my place in the line by plan order, puller = 1
        placeObs: selfId === null ? null : placeOf(rot.chain, selfId),    // observed: my index in the chain, 1 = front
        chainSize: rot.chain.length,
        alone: !rot.chain.some(c => c.id !== selfId),
        gate: gate.open,    // in the TTT event (start pen to finish)
        climb: rot.climb.climbing,
        descent: !!rot.climb.descent,
        hill: rot.hill ? rot.hill.mode : null,    // 'flag' (roller) | 'pause' (real climb/descent) | null
        routePos: routePos(),    // my place on the route by the profile (null: unknown)
        routeDist: sauceRouteDist,    // Sauce's own route distance, to compare
        pending: rot.front.pending ? rot.front.pending.at : null,
        selfDraft3: draftMean(drafts),
        gap: gapNow(),    // the gap warning: {kind, id, m, s, n, mine, behind} or null
        shadowEarly: stepOut.shadowEarly,
        shadowEnd06: stepOut.shadowEnd06,
    };
}


// ---------- recording upload ----------

function logUploadError(kind, e) {
    if (!uploadLogged.has(kind)) {
        uploadLogged.add(kind);
        console.error(`Paceline: uploading a recording failed (${kind})`, e ?? '');
    }
}


// Called by the recorder's lease owner on each step; never throws, never blocks the step. Does
// nothing while a recording runs (the stop sets lastSweepAt back to 0, so the next step sweeps).
function maybeSweep(now, state) {
    try {
        if (state.recording || !prefs.logUpload || uploading || now - lastSweepAt < SWEEP_MS) {
            return;
        }
        const p = readPrefs();
        // a plan server switched off gets nothing, uploads included
        if (!p.logUpload || !p.serverOn || !serverBase(p.serverUrl)) {
            return;
        }
        lastSweepAt = now;
        uploading = true;
        sweep(now, p, null)    // not recording: no session is being written
            .catch(e => logUploadError('exception', e))
            .finally(() => {
                uploading = false;
            });
    } catch(e) {
        uploading = false;
        logUploadError('exception', e);
    }
}


// Uploads the oldest pending recording, if any.
async function sweep(now, p, currentSessionId) {
    const sessions = await listSessions();
    const [id] = pendingUploads(sessions, {now, currentSessionId, since: p.logUploadSince});
    if (id === undefined) {
        return;
    }
    const s = sessions.find(x => x.sessionId === id);
    const slug = sessionSlug(s.meta, p, plan);
    if (!slug) {
        return;    // no team known yet: nothing to file the recording under
    }
    const res = await uploadSession(id, {url: p.serverUrl, slug, athleteId: s.meta.selfId ?? selfId, now});
    if (!res.ok) {
        logUploadError(res.error, res.cause);
    }
}


// ---------- plan server ----------

// One poll step: only the poll lease owner asks, at most every POLL_MS (shared through
// serverCheckedAt, so a window taking the lease over does not ask again right away).
function pollStep(now) {
    const {act, write} = pollLeaseStep(readJson(POLL_LEASE_KEY), ME, now);
    if (write) {
        writeJson(POLL_LEASE_KEY, write);
    }
    const p = readPrefs();
    // In the event, without a plan or after a failed check, ask every 10 s instead of every minute.
    const every = pollEvery({inEvent: !!eventGate() && gate.open, hasPlan: !!plan, error: p.serverError});
    if (!act || polling || !p.serverOn || muted() || !pollDue(p.serverCheckedAt, now, every)) {
        return;
    }
    const url = planUrl({url: p.serverUrl, team: p.serverTeam, selfId});
    if (!url) {
        if (!serverBase(p.serverUrl)) {
            writePrefs({serverError: 'badurl', serverCheckedAt: now});
        }
        return;    // no team name and no athlete id yet: ask once Zwift tells who I am
    }
    polling = true;
    pollServer(url, p, now).catch(e => console.error('Paceline: plan server check failed', e))
        .finally(() => {
            polling = false;
        });
}


async function pollServer(url, p, now) {
    writePrefs({serverCheckedAt: now});
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    let res;
    let rec = null;
    try {
        res = await fetch(url, {
            cache: 'no-store',
            headers: p.serverEtag ? {'If-None-Match': p.serverEtag} : {},
            signal: ctl.signal,
        });
        if (res.status === 200) {
            rec = await res.json();
        }
    } catch(e) {
        // No answer, or a timeout while reading it: not reachable. A broken body: invalid.
        res = res && !ctl.signal.aborted ? {status: 'invalid'} : null;
    } finally {
        clearTimeout(timer);
    }
    // The rider changed server or team while this request ran: its answer no longer counts.
    const cur = readPrefs();
    if (cur.serverUrl !== p.serverUrl || cur.serverTeam !== p.serverTeam || !cur.serverOn) {
        return;
    }
    const at = Date.now();
    if (!res) {
        writePrefs({serverError: 'offline'});
    } else if (res.status === 304) {
        writePrefs({serverOkAt: at, serverError: null});
    } else if (res.status === 404) {
        writePrefs({serverError: 'notfound'});
    } else if (res.status !== 200) {
        writePrefs({serverError: res.status === 'invalid' ? 'invalid' : 'http'});
    } else {
        takeServerPlan(rec, res.headers.get('ETag'), cur, at);
    }
}


// A 200 answer: the record's etag (content-aware: a renamed rider changes it, the plan code not)
// decides whether the plan changed. A changed plan is stored and activated at once.
function takeServerPlan(rec, headerEtag, cur, at) {
    const etag = rec && typeof rec.etag === 'string' && rec.etag ? rec.etag : headerEtag || null;
    if (etag !== null && etag === cur.serverEtag) {
        writePrefs({serverOkAt: at, serverError: null});
        return;
    }
    const got = serverEntry(rec, at);
    if (!got) {
        writePrefs({serverError: 'invalid'});
        return;
    }
    const lib = serverPlanUpdate(readLibrary(), rec, at);
    if (lib) {
        writeLibrary(lib);
        loadPlan();    // the storage event only reaches the other windows
        render();
    }
    writePrefs({serverEtag: etag, serverTeamName: got.entry.team || got.plan.team || null,
                serverSig: got.plan.sig, serverOkAt: at, serverError: null});
}


// ---------- rendering ----------

function setText(el, text) {
    if (el.textContent !== text) {
        el.textContent = text;
    }
}


function mmss(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const p = n => String(n).padStart(2, '0');
    return `${p(Math.floor(s / 60))}:${p(s % 60)}`;
}


// Only called with a known self id; without one the you-line says so and this line is hidden.
function recText(now) {
    const st = readRecState();
    if (st.recording && leaseFresh(readJson(LEASE_KEY), now)) {
        const n = planRidersPresent(currentNearby(now), ids);
        return {
            text: fmt(n === 1 ? 'recOnOne' : 'recOn', {time: mmss(now - Number(st.sessionId)), n}),
            live: true,
        };
    }
    return {text: S.recReady, live: false};
}


// ---------- the Info window's lines ----------
// Every rider line and table row has the same cells in one column grid (paceline.html): label,
// plan number, kit swatch, name, and the value in three cells lined up on the "@": seconds (or
// the front's clock), "@", target (no unit; user, 13 Nov 2026).

function cellsOf(el) {
    return {
        label: el.querySelector('.pl-rot-label'),
        num: el.querySelector('.pl-rot-num'),
        sw: el.querySelector('.pl-swatch'),
        name: el.querySelector('.pl-rot-name'),
        secs: el.querySelector('.pl-rot-secs'),
        at: el.querySelector('.pl-rot-at'),
        target: el.querySelector('.pl-rot-target'),
    };
}


function paint(sw, color) {
    if (sw.dataset.color !== color) {
        sw.dataset.color = color;
        sw.style.background = color;
    }
}


// The rider's plan number ("#3"), '' when he is not in the plan.
function planNumber(rider) {
    const i = plan ? plan.riders.findIndex(r => r.id === rider.id) : -1;
    return i < 0 ? '' : fmt('place', {n: i + 1});
}


// The value cells: {secs, target} (target null: no "@"), or {clock, over} for the front's time
// left (it runs on below zero, amber then).
function setValue(c, v) {
    const clockText = v && v.clock !== undefined ? v.clock : null;
    setText(c.secs, clockText ?? v?.secs ?? '');
    c.secs.classList.toggle('pl-over', !!v?.over);
    c.secs.classList.toggle('pl-clock', clockText !== null);    // right-aligned at the line's end
    const target = clockText === null ? v?.target ?? null : null;
    setText(c.at, target === null ? '' : '@');
    setText(c.target, target ?? '');
}


// A rider line: label, number, swatch, name and value ({secs, target} or {clock, over}; null: none).
function riderLine(el, rider, name, value) {
    el.hidden = false;
    el.classList.remove('pl-text');
    const c = cellsOf(el);
    c.name.classList.remove('pl-dim', 'pl-warn');
    setText(c.num, planNumber(rider));
    paint(c.sw, rider.color);
    setText(c.name, name);
    setValue(c, value);
}


// A line with its label and a text instead of a rider: dim for "nothing now" (–), or a state like
// "Climb – rotation paused". The label stays, so the line never changes its shape.
function textLine(el, text, dim) {
    el.hidden = false;
    el.classList.add('pl-text');
    const c = cellsOf(el);
    c.name.classList.toggle('pl-dim', !!dim);
    c.name.classList.remove('pl-warn');
    setText(c.num, '');
    setText(c.name, text);
    setValue(c, null);
}


// A hidden line keeps its slot (CSS) but no text, so it never widens the grid.
function clearLine(el) {
    el.hidden = true;
    const c = cellsOf(el);
    for (const k of ['num', 'name', 'secs', 'at', 'target']) {
        setText(c[k], '');
    }
}


// The front's time left in seconds like the pulls ("72s"; user, 13 Nov 2026: pulls are called in
// seconds), over his time "−4s" (amber).
function frontClock(view) {
    const r = view.remainingS;
    return {clock: r < 0 ? '\u2212' + fmt('pullOnly', {pullS: -r}) : fmt('pullOnly', {pullS: r}), over: r < 0};
}


// A rider's pull for the Info window: {secs, target}, my live weight for me.
function pullOf(rider) {
    return riderPullParts(rider, rider.id === selfId ? liveWeight() : null, prefs.targetUnit);
}


// Captain mode with the table on: Front and Next are the table's first rows (user, 13 Nov 2026).
function tableFront() {
    return prefs.showNext && prefs.showRotation;
}


// The info window keeps every line in place (hidden lines keep their slot, see the CSS): plan, my
// pull and the wheel I follow on top (they do not change during the ride), then the live part:
// the front, the next rider (captain option) and the recorder.
function renderRotation(now) {
    const {view, reason} = rotationStatus(now);
    const frontEl = $('#pl-line-front');
    const nextEl = $('#pl-line-next');
    const wheelEl = $('#pl-line-wheel');
    // Wheel: the plan's wheel, so it can be memorised; amber "planned → live" while the
    // planned rider is not with the group.
    const wf = wheelToFollow(plan, selfId, view && {wheel: myWheel(view)});
    if (!wf) {
        clearLine(wheelEl);
    } else {
        const shown = wf.live || wf.planned;
        riderLine(wheelEl, shown, wf.live ? fmt('wheelSwap', {planned: wf.planned.name, live: wf.live.name}) : wf.planned.name, null);
        wheelEl.querySelector('.pl-rot-name').classList.toggle('pl-warn', !!wf.live);
    }
    // Next (for the captain, who calls who follows, how hard and how long): the full pull line;
    // dim when it is the plan's guess (before the start, climb, alone, no data), not the live one.
    const cn = captainNext({plan, view, reason, pullerId: rot.front.puller});
    if (cn) {
        const nx = cn.rider;
        riderLine(nextEl, nx, nx.id === selfId ? S.frontYou : nx.name, pullOf(nx));
    } else {
        textLine(nextEl, S.noRotation, true);
    }
    nextEl.classList.toggle('pl-planned', !!cn && cn.planned);
    if (reason === 'finish' || reason === 'climb' || reason === 'descent') {
        textLine(frontEl, reason === 'finish' ? S.finishOff : reason === 'climb' ? S.climbPaused : S.descentPaused,
                 false);
        return;
    }
    if (!view) {
        textLine(frontEl, S.noRotation, true);
        return;
    }
    riderLine(frontEl, view.puller, view.mine ? S.frontYou : view.puller.name, frontClock(view));
}


function renderInfo(now) {
    document.documentElement.classList.toggle('pl-show-next', prefs.showNext);
    document.documentElement.classList.toggle('pl-table-front', tableFront());
    // Outside a TTT event only one quiet line, so a placed window can still be found.
    const quiet = muted();
    document.documentElement.classList.toggle('pl-muted', quiet);
    if (quiet) {
        setText($('#pl-line-muted'), S.mutedLine);
        fitInfo();
        return;
    }
    setText($('#pl-line-plan'), plan ? fmt('planLine', {team: plan.team, sig: plan.sig}) : S.noPlanLine);
    // Without a self id the you-line says "waiting for Zwift" (even with no plan) and the
    // recorder line is hidden, since nothing records then.
    const you = $('#pl-line-you');
    you.hidden = !plan && selfId !== null;
    const me = plan && selfId !== null ? findMe(plan, selfId) : null;
    you.classList.toggle('pl-you-in', !!me && me.role === 'rider');
    // Riding in the plan: "You: #4 · 60s@4.4W/kg (254W)" with my fixed plan number (no name,
    // the settings window shows it); otherwise the status text (waiting for Zwift, bench, not in plan).
    // "You: #4 ■ · 60s@4.4W/kg (254W)": the swatch is my kit colour, so I know which to pick.
    const parts = you.hidden ? {head: '', pull: ''} :
        youParts(plan, selfId, {weight: liveWeight(), unit: prefs.targetUnit});
    const yc = cellsOf(you);
    if (parts.pull && me && me.role === 'rider') {
        you.classList.remove('pl-text', 'pl-text-full');
        setText(yc.num, fmt('place', {n: parts.position}));
        paint(yc.sw, me.rider.color);
        // My pull where the Wheel line has its name (user, 13 Nov 2026).
        const mine = pullOf(me.rider);
        setText(yc.name, mine.target === null ? mine.secs : `${mine.secs}@${mine.target}`);
        setValue(yc, null);
    } else {
        // Waiting for Zwift, on the bench, not in the plan: the text across the whole line.
        you.classList.add('pl-text', 'pl-text-full');
        setText(yc.num, '');
        setText(yc.name, parts.head);
        setValue(yc, null);
    }
    const recEl = $('#pl-line-rec');
    const rec = demoKind === 'pref' ? {text: fmt('demoLine', {time: mmss(prefs.demoUntil - now)}), live: false} :
        selfId === null ? {text: '', live: false} : recText(now);
    recEl.hidden = selfId === null && demoKind !== 'pref';
    recEl.classList.toggle('pl-demo-on', demoKind === 'pref');
    recEl.classList.toggle('pl-rec-on', rec.live);
    setText(recEl, rec.text);
    renderRotation(now);
    renderTable(now);
    fitInfo();
}


// ---------- the rotation table ----------

let tableSig = null;    // the plan the table's rows were made for


// One row per plan rider: "#3 ■ Name  60s @ 4.4", the same cells as the lines above. Made again
// when the plan changes.
function tableRows() {
    const table = $('#pl-table');
    const sig = plan ? plan.sig + ':' + plan.riders.length : null;
    if (sig === tableSig) {
        return table.children;
    }
    tableSig = sig;
    const cells = $('#pl-line-front').children;
    table.replaceChildren(...(plan ? plan.riders : []).map(() => {
        const row = document.createElement('div');
        row.className = 'pl-line pl-rot pl-trow';
        for (const cell of cells) {
            const span = document.createElement('span');
            span.className = cell.className;
            row.append(span);
        }
        return row;
    }));
    return table.children;
}


// The whole rotation, from the rider pulling (before the start from plan #1): me highlighted, the
// rider pulling in bold, riders not with the group dim. Before the start always, during the ride in
// captain mode with its table option (tableShown; user, 13 Nov 2026). Then its first row is the
// front (bold, his time left, or ▲ / ▼ / – while the rotation pauses) and the next rider with the
// group is set apart from the rest below him; no labels, the place says it. Riders dropped from
// the group are last, dim, below a thin line (user, 14 Nov 2026).
function renderTable(now) {
    const table = $('#pl-table');
    const {view, reason} = rotationStatus(now);
    const pullerId = rot.front.puller;
    table.hidden = !tableShown({plan, always: prefs.showNext && prefs.showRotation, pullerId, reason});
    if (table.hidden) {
        return;
    }
    const started = pullerId != null && reason !== 'still';
    const rows = rotationTable(plan, {pullerId, presentIds: started ? rot.present : null});
    const els = tableRows();
    const front = tableFront();
    const nextAt = front ? rows.findIndex((row, i) => i > 0 && row.present) : -1;
    const droppedAt = rows.findIndex(row => !row.present);    // they come last, set apart below
    rows.forEach((row, i) => {
        const el = els[i];
        const c = cellsOf(el);
        el.classList.toggle('pl-me', row.rider.id === selfId);
        el.classList.toggle('pl-pulling', row.pulling);
        el.classList.toggle('pl-absent', !row.present);
        el.classList.toggle('pl-gap-after', i === nextAt && i + 1 !== droppedAt);
        el.classList.toggle('pl-dropped-first', i === droppedAt && i > 0);
        el.classList.toggle('pl-top', front && (i === 0 || i === nextAt));    // the two to call out, larger
        setText(c.label, '');    // the place says it (user, 13 Nov 2026)
        setText(c.num, fmt('place', {n: row.number}));
        paint(c.sw, row.rider.color);
        setText(c.name, row.rider.name);
        let value = pullOf(row.rider);
        if (front && i === 0) {
            value = reason === 'climb' ? {clock: S.dashClimb} : reason === 'descent' ? {clock: S.dashDescent} :
                reason === 'finish' ? {clock: S.noRotation} : view && row.pulling ? frontClock(view) : value;
        }
        setValue(c, value);
    });
}


// ---------- text size of the Info window ----------
// The text grows and shrinks with the window (user, 13 Nov 2026: a large Info window kept small
// text). Fitted when the window size or what is in it changes (plan, captain line, table, unit),
// not on every update, so the size never flickers. Live lines that can grow during the ride
// (Front, Next) are measured with the plan's longest name and pull (hidden probe lines); the
// recorder line may be cut with "…". Every line stays on one row (user, 13 Nov 2026: rather a
// smaller text than lines broken in two).
const FIT_BASE_PX = 20;
const FIT_MIN_PX = 11;
const FIT_MAX_PX = 72;
const FIT_MUTED_PX = 14;
let fitKey = null;


function fitInfo() {
    const box = $('#pl-box');
    const table = $('#pl-table');
    const key = [innerWidth, innerHeight, plan ? plan.sig : '', prefs.showNext, tableFront(), table.hidden, muted(),
                 prefs.targetUnit, $('#pl-line-plan').textContent, $('#pl-line-you').textContent].join('|');
    // Also when the content no longer fits (a font loaded late, a longer text than measured).
    if (key === fitKey && box.scrollHeight <= box.clientHeight + 1) {
        return;
    }
    fitKey = key;
    if (muted()) {
        box.style.fontSize = `${FIT_MUTED_PX}px`;    // the quiet line stays small
        return;
    }
    box.style.fontSize = `${FIT_BASE_PX}px`;
    const cs = getComputedStyle(box);
    const availW = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (!(availW > 0 && availH > 0)) {
        return;
    }
    const probes = fitProbes();
    const scaleAt = px => {
        box.style.fontSize = `${px}px`;
        const {w, h} = contentSize(box, probes);
        return Math.min(availW / w, availH / h);
    };
    // Estimate (sizes scale with the font, nearly), then step down until it really fits.
    let px = FIT_BASE_PX;
    for (let i = 0; i < 4; i++) {
        const next = Math.max(FIT_MIN_PX, Math.min(FIT_MAX_PX, Math.floor(px * scaleAt(px))));
        if (next === px) {
            break;
        }
        px = next;
    }
    while (px > FIT_MIN_PX && scaleAt(px) < 1) {
        px--;
    }
    box.style.fontSize = `${px}px`;
    for (const p of probes) {
        p.remove();
    }
}


// The widest line and the height of the content at the box's current font size.
function contentSize(box, probes) {
    // The width the line's content needs.
    const lineW = el => {
        const old = el.style.width;
        el.style.width = 'max-content';
        const w = el.getBoundingClientRect().width;
        el.style.width = old;
        return w;
    };
    // The lines outside the grid (plan line), and the grid at its natural width (all its rows,
    // the probes included, share the columns).
    const lines = [...box.children].filter(el => el.classList.contains('pl-line') && el.id !== 'pl-line-rec' &&
        !el.hidden && getComputedStyle(el).display !== 'none');
    const w = Math.max(1, ...lines.map(lineW), lineW($('#pl-grid')));
    const {height, justifyContent} = box.style;
    box.style.height = 'auto';
    box.style.justifyContent = 'flex-start';
    const cs = getComputedStyle(box);
    const h = box.scrollHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    box.style.height = height;
    box.style.justifyContent = justifyContent;
    return {w, h: Math.max(1, h)};
}


// Hidden copies of the live lines at their widest, in the grid so they widen its columns but
// without height: Front with the plan's longest name and a clock, Next with the longest name and
// pull.
function fitProbes() {
    const riders = plan ? plan.riders : [];
    const longest = xs => xs.reduce((a, b) => (b.length > a.length ? b : a), '');
    const grid = $('#pl-grid');
    const make = (src, name, value) => {
        const probe = $(src).cloneNode(true);
        probe.id = '';
        probe.hidden = false;
        probe.classList.remove('pl-text');
        probe.classList.add('pl-probe');
        const c = cellsOf(probe);
        setText(c.num, fmt('place', {n: Math.max(1, riders.length)}));
        setText(c.name, name);
        setValue(c, value);
        grid.append(probe);
        return probe;
    };
    const pulls = riders.map(r => pullOf(r));
    const widest = (key) => longest(pulls.map(p => p[key] ?? ''));
    const out = [make('#pl-line-front', longest([S.frontYou, ...riders.map(r => r.name)]), {clock: '\u2212000s'})];
    // Captain table: any rider can be in its larger top rows.
    const row = $('#pl-table').firstElementChild;
    if (tableFront() && row) {
        const probe = row.cloneNode(true);
        probe.classList.add('pl-probe', 'pl-top');
        const c = cellsOf(probe);
        setText(c.name, longest(riders.map(r => r.name)));
        setValue(c, {secs: widest('secs'), target: widest('target') || null});
        $('#pl-table').append(probe);
        out.push(probe);
    }
    if (riders.length) {
        out.push(make('#pl-line-next', longest(riders.map(r => r.name)),
                      {secs: widest('secs'), target: widest('target') || null}));
    }
    return out;
}


function show(el, on) {
    el.hidden = !on;
}


// The action window: one element that keeps its size; only its content changes. Resting: the
// countdown and my place (or the dash). READY (the last WARN_S before my pull, also the start
// rider in the pen) and the pull: target, my power now and the time, the power bar below.
function renderAction(now) {
    show($('#pl-demo-badge'), demoKind === 'pref');
    const {view, reason} = rotationStatus(now);
    let m = windowModel(view, reason, now);
    const me = myRider(view);
    if (mode === 'rest') {
        // The Rest window shows only the rest. During my pull it disappears completely, background
        // included, and from READY on (the last WARN_S before my pull, and the start rider in the
        // pen) too while an Action window is open, which takes over (user, 13 Nov 2026); without
        // one it shows READY itself.
        const ready = m.kind === 'rest' && (m.next || m.timeS === 0);
        const vanish = m.kind === 'pull' || (ready && windowOpen('action', now));
        document.documentElement.classList.toggle('pl-vanish', vanish);
        document.body.classList.toggle('transparent-bg', vanish);
        renderRestRow(vanish ? {kind: 'blank'} : m, reason);
        return;
    }
    if (!prefs.restInAction && windowOpen('rest', now)) {
        // Only my pull: blank while resting, armed (READY) in its last seconds. Without an open
        // Rest window the countdown shows here anyway, so it is never missing.
        m = pullOnlyModel(m, {watts: me?.watts});
    } else if (m.kind === 'rest' && m.next) {
        m = {...m, kind: 'armed'};
    }
    if (m.kind === 'pull' || m.kind === 'armed') {
        renderTriple(m, me, now);
    } else {
        renderRestRow(m, reason);
    }
}


// ---------- which Paceline windows are open (presence.mjs) ----------

let aliveAt = null;    // when this window last wrote its sign of life


// Writes this window's sign of life every ALIVE_REFRESH_MS and drops keys of windows long gone.
function aliveStep(now) {
    if (!aliveDue(aliveAt, now)) {
        return;
    }
    aliveAt = now;
    try {
        localStorage.setItem(aliveKey(ME), JSON.stringify({mode, at: now}));
        const entries = aliveEntries();
        for (const id of staleKeys(entries, now)) {
            localStorage.removeItem(aliveKey(id));
        }
    } catch(e) {
        // No storage: every window then behaves as if it were alone (shows everything).
    }
}


function aliveEntries() {
    const out = [];
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(ALIVE_PREFIX)) {
                out.push([k.slice(ALIVE_PREFIX.length), parseAlive(localStorage.getItem(k))]);
            }
        }
    } catch(e) {
        return [];
    }
    return out;
}


// True while another window of this mode ('action' | 'rest' | 'info') is open.
function windowOpen(m, now) {
    return aliveModes(aliveEntries(), {now, selfId: ME}).has(m);
}


// My plan rider (in the pen there is no view yet).
function myRider(view) {
    return view?.me ?? (plan && selfId !== null ? plan.riders.find(r => r.id === selfId) ?? null : null);
}


// The rest row: the countdown and my place, READY in its last seconds; the dash says why there is
// nothing (dim ▲ / ▼, amber ?), quiet means empty; 'blank' shows nothing at all.
function renderRestRow(m, reason) {
    show($('#pl-act-row'), true);
    show($('#pl-act-over'), true);
    show($('#pl-act-tri'), false);
    renderGapBand(false);
    renderGapEarly(false);
    $('#pl-act-bar').classList.add('pl-off');
    const dash = $('#pl-act-dash');
    const clockEl = $('#pl-act-clock');
    const placeEl = $('#pl-act-place');
    const dk = m.kind === 'none' ? dashKind(reason, {started: rot.front.puller != null}) : null;
    show(dash, m.kind === 'none' && dk !== 'none');
    if (m.kind === 'none') {
        setText(dash, dk === 'climb' ? S.dashClimb : dk === 'descent' ? S.dashDescent :
            dk === 'unknown' ? S.dashUnknown : S.noRotation);
        dash.classList.toggle('pl-warn', dk === 'unknown');
    }
    const resting = m.kind === 'rest';
    // The standing clock (expert panel, 13 Nov 2026): the number stays, dimmed with "≥" (my pull is at
    // least that far away), and under it how long the puller is over his plan, "+12". No blinking.
    const standing = resting && !!m.standing;
    clockEl.classList.toggle('pl-standing', standing);
    // The same line carries a gap in the line (user, 13 Nov 2026): mine first (amber, I must close
    // it), then the standing clock, then someone else's gap (dim, the puller deals with it).
    // The early stage only when it is mine (close up before the draft is gone).
    const g0 = resting ? gapNow() : null;
    const g = g0 && (g0.level === 'full' || g0.mine) ? g0 : null;
    const over = $('#pl-act-over');
    // Amber when I must close it or the team needs the riders cut off; someone with riders to spare
    // stays dim. A critical gap of someone else goes before the standing clock.
    const urgent = !!g && (g.mine || g.critical);
    // The wheel to drop in behind at the start, or when it changes (user, 15 Nov 2026): kit colour
    // and name, amber when it is not the plan's (that rider is dropped). After my own and critical
    // gaps; the start cue also after the standing clock and other gaps, a change goes before them.
    const cv = !urgent && (resting || (m.kind === 'none' && reason === 'start')) ? cueView(cue, Date.now()) : null;
    const cueId = cv && (cv.kind === 'change' || (!standing && !g)) ? cv.id : null;
    const cueRider = cueId ? plan?.riders.find(r => r.id === cueId) : null;
    over.classList.toggle('pl-gap-warn', urgent);
    over.classList.toggle('pl-cue', !!cueRider);
    over.classList.toggle('pl-cue-swap', !!cueRider && cueId !== plannedWheel(plan, selfId)?.id);
    show($('#pl-act-overlbl'), !!cueRider);
    show($('#pl-act-oversw'), !!cueRider);
    let cueText = '';
    if (cueRider) {
        paint($('#pl-act-oversw'), cueRider.color);
        // Not the plan's wheel: his place in the line, not his plan number (user, 14 Nov 2026).
        const place = over.classList.contains('pl-cue-swap') ?
            linePlace(plan, {pullerId: rot.front.puller, selfId, id: cueId, presentIds: cue.kind === 'start' ? groupIds() : cueGroupIds(Date.now())}) : null;
        cueText = firstName(cueId).toUpperCase() + (place ? ` ${fmt('place', {n: place})}` : '');
    }
    setText($('#pl-act-overtxt'), cueRider ? cueText :
        g?.mine ? fmt('gapMe', {gap: gapAmount(g)}) : urgent ? gapInfo(g) :
        standing ? `+${m.overS}` : g ? gapInfo(g) : '');
    show(clockEl, resting);
    show(placeEl, resting && m.place !== null);
    if (!resting) {
        return;
    }
    const ready = m.next || m.timeS === 0;
    // "26s": the "s" half size, set low like the units (user, 13 Nov 2026); "5:47" and READY plain.
    const text = ready ? S.ready : restClock(m.timeS);
    const secs = !ready && text.endsWith(S.secUnit);
    setText($('#pl-act-cnum'), (standing ? '\u2265' : '') + (secs ? text.slice(0, -S.secUnit.length) : text));
    setText($('#pl-act-cunit'), secs ? S.secUnit : '');
    clockEl.classList.toggle('pl-warn', !!m.warn);
    if (m.place !== null) {
        setText(placeEl, fmt('place', {n: m.place}));
    }
}


// Someone else's gap, for the rest line: a rider by name, the gap ahead of me, or the riders behind.
function gapInfo(g) {
    if (g.kind === 'one') {
        return fmt('gapInfoOne', {name: firstName(g.id), gap: gapAmount(g)});
    }
    return g.behind ? fmt('gapInfoAhead', {gap: gapAmount(g)}) : fmt('gapInfoSplit', {n: g.n, gap: gapAmount(g)});
}


// The gap band in place of the power bar during my pull (user, 13 Nov 2026): red with a white edge
// when the team needs the riders cut off (always the group behind me), amber for a rider or a split
// the team can spare. Ease off; the target does not count then.
function renderGapBand(on, g) {
    const band = $('#pl-act-gap');
    $('#pl-act-bar').classList.toggle('pl-gapped', on);
    show(band, on);
    if (!on) {
        return;
    }
    band.dataset.kind = g.kind;
    band.dataset.critical = g.critical ? '1' : '';
    const gap = gapAmount(g);
    setText(band, g.kind === 'group' ? fmt('gapGroup', {gap}) :
        g.kind === 'one' ? fmt('gapOne', {name: firstName(g.id).toUpperCase(), gap}) :
        fmt('gapSplit', {n: g.n, gap}));
}


// The early stage during my pull (user, 13 Nov 2026): the bar stays, with an amber edge, and the
// label under my power now says how far back it is ("▼ 9 m"). Short, so the middle never widens.
function renderGapEarly(on, g) {
    $('#pl-act-bar').classList.toggle('pl-gap-early', on);
    const label = $('#pl-act-nowlbl');
    label.classList.toggle('pl-gap-warn', on);
    setText(label, on ? fmt('gapEarly', {m: g.m}) : S.nowLabel);
}


// READY and the pull: three fixed points with their units under them, and the bar. The target
// left, my power now in the middle (the marker's value, in its zone colour once the pull has
// settled; neutral in READY), the time right (READY, the pull's seconds, over time "−4" amber).
function renderTriple(m, me, now) {
    show($('#pl-act-row'), false);
    show($('#pl-act-over'), false);
    show($('#pl-act-tri'), true);
    const weight = pickWeight(liveWeight(), me?.weight);
    const hasTarget = m.watts !== null && m.watts !== undefined;
    const target = hasTarget ? formatTarget(m.watts, weight, prefs.targetUnit) : null;
    const wnum = $('#pl-act-wnum');
    setText(wnum, target ? target.value : S.noRotation);
    wnum.classList.toggle('pl-dim', !target);
    setText($('#pl-act-wunit'), target ? target.unit : '');
    const nowW = markerPower(marker, now);
    const nowText = nowValue(nowW, weight, target ? prefs.targetUnit : 'W');
    const nowEl = $('#pl-act-now');
    setText(nowEl, nowText ?? S.noRotation);
    const zone = m.kind === 'pull' && nowText !== null ? m.marker?.zone ?? null : null;
    nowEl.dataset.zone = zone ?? '';
    nowEl.classList.toggle('pl-dim', nowText === null);
    const timeEl = $('#pl-act-time');
    if (m.kind === 'armed') {
        setText(timeEl, S.ready);
        setText($('#pl-act-tunit'), '');
        timeEl.classList.add('pl-warn');
    } else {
        setText(timeEl, (m.over ? '\u2212' : '') + pullSecs(m.timeS));
        setText($('#pl-act-tunit'), S.secUnit);
        timeEl.classList.toggle('pl-warn', !!m.warn);
    }
    // The bar: with a target always (READY too, the marker neutral); a pull without target watts
    // gets a neutral track, so it never looks like rest.
    const bar = $('#pl-act-bar');
    bar.classList.toggle('pl-off', !hasTarget && m.kind !== 'pull');
    bar.classList.toggle('pl-neutral', !hasTarget);
    const markerEl = $('#pl-bar-marker');
    show(markerEl, hasTarget && !!m.marker);
    if (hasTarget && m.marker) {
        markerEl.style.setProperty('--pos', String(m.marker.pos));
        markerEl.dataset.zone = m.marker.zone ?? '';    // no zone (READY, start of a pull): white
    }
    const g = m.kind === 'pull' ? gapNow() : null;
    const mine = !!g && !g.behind;    // a gap behind me while I pull: mine to deal with
    renderGapBand(mine && g.level === 'full', g);
    renderGapEarly(mine && g.level === 'early', g);
}


function render() {
    const now = Date.now();
    try {
        if (mode === 'action' || mode === 'rest') {
            renderAction(now);
        } else {
            renderInfo(now);
        }
    } catch(e) {
        console.error('Paceline: rendering failed', e);
    }
}


function tick() {
    lastStepAt = Date.now();
    aliveStep(lastStepAt);
    try {
        const ev = eventOf(currentNearby(lastStepAt), lastStepAt);
        gate = gateStep(gate, {now: lastStepAt, ev});
        terrainStep(ev, lastStepAt);
    } catch(e) {
        console.error('Paceline: event check failed', e);
    }
    try {
        rotate(lastStepAt);
    } catch(e) {
        console.error('Paceline: rotation step failed', e);
    }
    try {
        step();
    } catch(e) {
        console.error('Paceline: recorder step failed', e);
    }
    try {
        pollStep(lastStepAt);
    } catch(e) {
        console.error('Paceline: plan server step failed', e);
    }
    render();
}


// Fallback clock: steps only when no nearby update has stepped for FALLBACK_STEP_MS, so the
// 120 s stop also fires when Zwift stops sending data (an empty or stale list still steps).
// Otherwise it only redraws, so the clocks tick evenly between updates.
function fallbackTick() {
    syncDemo(Date.now());
    if (Date.now() - lastStepAt >= FALLBACK_STEP_MS) {
        tick();
    } else {
        render();
    }
}


// ---------- boot ----------

function onNearby(list) {
    nearby = Array.isArray(list) ? list : [];
    nearbyAt = Date.now();
    resolveSelf(nearby);
    samplePower(nearby, nearbyAt);
    if (nearbyAt - lastStepAt >= NEARBY_STEP_MS) {
        tick();    // each update is recorded once (and none skipped at 1 Hz)
    } else {
        render();
    }
}


// Sauce's per-window background fields, as its own windows and other mods use them. A box ticked
// without picking a colour gives black at full opacity, which is what the settings form shows.
const BG_KEYS = ['solidBackground', 'backgroundColor', 'backgroundAlpha'];

function applyBackground() {
    try {
        Common.setBackground({backgroundColor: '#000000', backgroundAlpha: 100, ...Common.settingsStore.get()});
    } catch(e) {
        console.warn('Paceline: could not apply the background setting', e);
    }
}


function applyStrings() {
    document.title = mode === 'action' ? S.actionTitle : mode === 'rest' ? S.restTitle : S.overlayTitle;
    for (const el of document.querySelectorAll('[data-s]')) {
        el.textContent = S[el.dataset.s];
    }
    for (const el of document.querySelectorAll('[data-s-title]')) {
        el.title = S[el.dataset.sTitle];
    }
}


function openSettings() {
    // Through the titlebar link, so Sauce opens it as a sized child window (and, in a browser,
    // so initInteractionListeners has added our windowId to the URL).
    $('a.open-settings').click();
}


// Bar zones from the engine's constants: red | amber | green | amber | red.
function initBar() {
    const bar = $('#pl-act-bar');
    const at = pct => `${(pct / (2 * BAR_RANGE_PCT)) * 100}%`;
    bar.style.setProperty('--pl-z-amber', at(BAR_RANGE_PCT - AMBER_PCT));
    bar.style.setProperty('--pl-z-green', at(BAR_RANGE_PCT - GREEN_PCT));
}


export async function main(m = 'info') {
    mode = m === 'action' || m === 'rest' ? m : 'info';
    applyStrings();
    if (mode === 'action' || mode === 'rest') {
        initBar();
    }
    Common = await loadCommon();
    initFlush(Common);
    if (Common) {
        Common.initInteractionListeners();
        if (Common.settingsStore && Common.setBackground) {
            applyBackground();
            Common.settingsStore.addEventListener('set', ev => {
                if (ev.data && (ev.data.key == null || BG_KEYS.includes(ev.data.key))) {
                    applyBackground();
                }
            });
        }
    }
    const fix = logUploadSinceFix(readPrefs(), Date.now());
    if (fix) {
        prefs = writePrefs(fix);
    }
    $('#pl-box').addEventListener('click', openSettings);
    demoKind = wantedDemo(Date.now());
    loadPlan();
    onLibraryChange(() => {
        loadPlan();
        render();
    });
    // The Info window's text follows the window size (fitInfo runs when the size changed), and is
    // fitted again once the fonts have loaded.
    addEventListener('resize', render);
    document.fonts?.ready?.then(() => {
        fitKey = null;
        render();
    });
    onPrefsChange(p => {
        prefs = p;
        syncDemo(Date.now());
        render();
    });
    if (Common) {
        // Persistent: the updates (and with them the steps) keep coming while Sauce hides the
        // window and throttles its timers. The demo replaces them.
        Common.subscribe('nearby', list => {
            if (!demoKind) {
                onNearby(list);
            }
        }, {persistent: true});
    }
    // Closing the window: its sign of life goes at once, so the others take over without waiting.
    addEventListener('pagehide', () => {
        try {
            localStorage.removeItem(aliveKey(ME));
        } catch(e) {
            // ignore
        }
    });
    setInterval(fallbackTick, FALLBACK_POLL_MS);
    fallbackTick();
}
