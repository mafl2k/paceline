// Overlay windows and the team recorder. All pages run main(mode): 'info' (paceline.html: plan,
// you, front rider, your wheel, recorder), 'action' (action.html: one big element, the clock to my
// pull or my pull's target in W or W/kg, time left and power bar) and 'rest' (rest.html: the same
// element with only the clock to my pull; while it is open the Action window leaves that to it).
//
// About once a second each open overlay window takes part in a lease (raw localStorage, LEASE_KEY) so
// that exactly one of them records. The owner runs the recorder state machine on the state kept
// in localStorage (REC_STATE_KEY), so a window that takes the lease over continues the same
// session. Ticks go to IndexedDB without blocking the loop. Rider names come from files and from
// Zwift, so they only ever go in through textContent.
//
// Every window (lease owner or not) follows the rotation itself on each step, on the turn clocks
// (turns.mjs): who is at the front of my team chain becomes the owner of the turn after 3 s when he
// is the plan's next, after 20 s otherwise, and his clock runs from his start at the front until the
// next owner takes over. My own pull also starts on a power jump while I am next (confirmed by my
// draft) or on my draft alone. A broken order on a real climb shows the climb display, the final
// sprint ends the rotation, and a rider without a teammate near him sees no rotation. The old core
// (rotation.mjs) runs beside it as a silent shadow, recorded in det.old only. That state lives in
// memory.
//
// One overlay window (its own lease, POLL_LEASE_KEY) checks the plan server, only in an event (with
// the TTT-only option only in a TTT event): at once when the event begins, then every POLL_FAST_MS
// without a plan from this event or after an error, else every POLL_MS (serverTick). It keeps the
// Clubs table, the ride lock and the latest answer (paceline:pending:v1) and activates the plan the
// lock, a file plan and the pen rule allow; the other windows pick it up through the storage event.
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
        recStep, makeTick, detPlanOnly, leaseStep, selfSubgroupId, eventSummary, eventLogStep, initialGate, gateStep,
        gateEv, isTtt, leaseHeld, trafficStep}
    from './engine/recording.mjs';
import {BAR_RANGE_PCT, GREEN_PCT, AMBER_PCT, DRAFT_N, selfLive, draftMean, dashKind, wheelOf, placeOf,
        pushPower as pushHist, initialRotation, rotationStep, carryRotation, shadowDet,
        alignedPositions,
        wheelToFollow, plannedWheel, captainNext, tableShown}
    from './engine/rotation.mjs';
import {initialTurns, turnsStep, turnsStatus, carryTurns, turnTable, turnDet} from './engine/turns.mjs';
import {hillAt, buildClimbIndex} from './engine/terrain.mjs';
import {GAP_FINISHERS, initialGaps, gapStep, gapView, cutBehind} from './engine/gaps.mjs';
import {initialCue, cueStep, cueView, dropWheel, linePlace, freshIds} from './engine/wheelcue.mjs';
import {initialClock, clockStep, deltaText} from './engine/clock.mjs';
import {bandStep, bandFresh, bandNumbers} from './engine/powerband.mjs';
import {ALIVE_PREFIX, aliveKey, parseAlive, aliveModes, restClockShown, restShows, staleKeys, aliveDue}
    from './engine/presence.mjs';
import {POWER_KEEP_MS, clock, restClock, pullSecs, nowValue, actionModel, barBand,
        pullOnlyModel, penModel, riderTarget, barTarget, pickWeight,
        shownModel, fieldsGapBand, fieldsShown, clockInFields, clockField, restClockOf, restTakes, restShowsOf, actionPhase, phaseStep,
        restHandBack, demoBadge, vanishes,
        fieldSlots, recoveryFields, smooth5, powerNow, labelParts, planParts, PART_MARK}
    from './engine/display.mjs';
import {serverBase, pollDue, pollEvery, retryAfterOf, backoffStep, pollLeaseStep, checkUrl, checkHeaders, inEventOf,
        rollStep, choosePlan, lockAtRollOff, lockAfterClubs, lockFor, serverDecision, chooseForLock, pendingFor,
        recordEntry, entryUpdate, answerHint, choiceStatus, dropsAtEventBegin, eventOverStatus, serverRuns,
        eventChange, missedStep}
    from './engine/planserver.mjs';
import {joinedIds, sameJoined, sameCodes, codesToSend, applyAnswer, answerClubs, markHinted} from './engine/clubs.mjs';
import {activeEntry, fileActive, fileEnded, endFilePlan, endsAtGateClose} from './engine/library.mjs';
import {activePlan, initFlush, schedFlush, onLibraryChange, readPrefs, writePrefs, onPrefsChange,
        readLibrary, writeLibrary, readLock, writeLock, readPending, writePending, readEventSeen, writeEventSeen,
        onKeyChange,
        LEASE_KEY, REC_STATE_KEY, POLL_LEASE_KEY, PENDING_KEY} from './store.mjs';
import {readClubs, writeClubs, onClubsChange, initClubs} from './clubs.mjs';
import {logUploadSinceFix, demoOn} from './engine/prefs.mjs';
import {samplePlan} from './engine/demoplan.mjs';
import {SWEEP_MS, rideTarget, sessionTarget, pendingUploads} from './engine/logupload.mjs';
import {addTick, saveSessionMeta, prune, listSessions, markUpload} from './recdb.mjs';
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
let clubsReady = false;          // the shared Clubs copy is merged (or Sauce didn't answer in time)
let mode = 'info';         // 'info' | 'action' | 'rest'
let plan = null;           // active plan or null
let ids = new Set();       // plan rider + bench ids (strings)
let riderIds = new Set();  // plan rider ids only: the bench takes no part in the rotation
let planServerOn = null;   // plan server on/off the plan was loaded for (an ended file plan counts
                           // only with it off)
let planSig = null;        // sig of the loaded plan; a new plan keeps the front tracking when the
                           // puller is still a rider
let detFailed = false;     // detOf threw once (logged once; those ticks record det: null)
let trafficFailed = false; // trafficStep threw once (logged once; those ticks record traffic: null)
let trafficState = null;   // {sessionId, pseudo}: the anonymous numbers of the recording going on
let shownFailed = false;   // shownOf threw once (logged once; those ticks record shown: null)
let gate = initialGate();     // the TTT event gate (gateStep): open from the start pen to the finish
let gateSg;                   // the TTT subgroup the gate saw in this step (undefined: none, or no data)
const eventInfo = new Map();   // my event subgroup id -> {summary, at, busy} (eventSummary)
let eventLogged = null;        // {sessionId, key} of the event last written to a tick
let climbsLogged = null;       // {sessionId, key} of the climb index last written to a tick
let selfId = null;         // own athlete id (string), cached once known
let selfName = null;       // own name from Zwift, if Sauce gives one
let selfWeight = null;     // my weight (kg) from my nearby entry, if Sauce gives one
let rpcWeight = null;      // my weight (kg) from getAthleteData('self'), the fallback
let lastWeightPoll = 0;
let prefs = readPrefs();
let polling = false;       // a plan server request is under way in this window
let pollOwner = false;     // this window held the poll lease in its last step
let rideGate = initialGate();  // the plan server's event gate: TTT only with tttOnly, else any event
let roll = null;           // roll-off tracking (rollStep) in the current event
let evKey = null;          // the event the plan server step is in (inEventOf key), null outside
let planFromEvent = false; // the active plan came from (or was confirmed by) this event's answer
let missGoneAt = null;     // this window's first fresh step without an event (missedGoneAt, W1)
let joinedSeen = null;     // the ticked clubs as last read (ids joined with ','), to see a change
let info = {joined: 0, club: null, hint: null};    // for the Info plan line (refreshInfo)
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
// Rotation (per window, in memory): the turn clocks' state (turns.mjs, what the windows show), the
// old core beside it as a silent shadow (rotation.mjs, recorded in det.old only; spec 2026-11-23
// section 4, removed in the version after) and my own samples.
let rot = initialTurns();
let shadow = initialRotation();
let shadowOk = true;       // the shadow's last step ran (det.old is null after a failed one)
let shadowFailed = false;  // the shadow failed once (logged once; the windows go on)
// The power bar (powerband.mjs): its band all the time (shown with its shadow in READY and my pull),
// its marker from 5 s into my pull.
let band = null;
let gaps = initialGaps();  // gaps in the team line (gaps.mjs): a rider or the group losing the wheel
let cue = initialCue();    // the wheel to drop in behind, in the rest line (wheelcue.mjs)
let restClk = initialClock();    // the rest countdown as shown: corrections absorbed or explained (clock.mjs)
let fadedAt = null;    // the clock's last snap that this window faded in
let powerWt = null;        // worldTime of the last self sample taken
let hist = [];             // my power history {t, w} for my own pull start and end
let drafts = [];           // my last DRAFT_N draft samples (W)
let sampleT = null;        // when the newest self sample arrived, until a step has used it
let grade = null;          // my grade in percent from the last self sample, null if unknown
// The climb index of my event (terrain.mjs, buildClimbIndex): built once in the pen from Sauce's
// route and segments, per route, laps and end (key); my place on it is my event distance. climbs is
// the index as recorded (route data only). Cleared when the event is over, so the last event's
// index is never used nor recorded.
const noTerrain = () => ({key: null, busy: false, at: 0, index: null, climbs: null});
let terrain = noTerrain();
let climbWarned = null;     // the event (sgId) whose missing climb index was logged
let eventDist = null;      // my event distance (m) from the last self sample
let sauceRouteDist = null; // Sauce's own route distance for me (recorded, to compare)
// The last step's own pull event, for the recorder.
let stepOut = {self: null};


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
    const rec = {recording: st.recording, sessionId: st.sessionId, lastSeenAt: st.lastSeenAt};
    return Number.isFinite(st.sg) ? {...rec, sg: st.sg} : rec;
}


function leaseFresh(lease, now) {
    const age = lease && typeof lease.at === 'number' ? now - lease.at : NaN;
    return Number.isFinite(age) && age >= 0 && age < LEASE_STALE_MS;
}


// ---------- plan and self ----------

function loadPlan() {
    let res = null;
    try {
        planServerOn = prefs.serverOn;
        res = activePlan({serverOn: planServerOn});
    } catch(e) {
        console.error('Paceline: loading the plan failed, continuing without one', e);
    }
    plan = res ? res.plan : demoKind ? samplePlan() : null;
    refreshInfo();
    ids = planIds(plan);
    riderIds = new Set((plan ? plan.riders : []).map(r => r.id));
    const sig = plan ? plan.sig : null;
    if (sig !== planSig) {
        // A plan swap mid-race (server upload) keeps the puller's clock when he is still a rider.
        planSig = sig;
        rot = carryTurns(rot, plan);
        shadow = carryRotation(shadow, plan);
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
    rot = initialTurns();
    shadow = initialRotation();
    shadowOk = true;
    band = null;
    gaps = initialGaps();
    cue = initialCue();
    powerWt = null;
    hist = [];
    drafts = [];
    sampleT = null;
    grade = null;
    terrain = noTerrain();    // loaded again for Zwift
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

// Called right before each recorder step, so the tick's `det` matches this step. The old core runs
// first on the same inputs, as a shadow that never stops the windows; the turn clocks get the gap
// state of the step before (gapStep runs after them).
function rotate(now) {
    const list = currentNearby(now);
    const here = terrainHere();
    const inputs = {now, plan, riderIds, selfId, nearby: list, hist, drafts, grade, sampleT, terrain: here};
    try {
        shadow = rotationStep(shadow, inputs).state;
        shadowOk = true;
    } catch (e) {
        shadowOk = false;
        if (!shadowFailed) {
            shadowFailed = true;
            console.error('Paceline: the old rotation core (shadow) failed:', e);
        }
    }
    const {state, self} = turnsStep(rot, {...inputs, gaps});
    rot = state;
    stepOut = {self};
    sampleT = null;
    const live = selfId !== null && selfLive(list, selfId);
    gaps = gapStep(gaps, {
        now, selfId,
        positions: alignedPositions(list, riderIds).filter(p => riderIds.has(p.id)),
        // Not in the start lock, the final sprint, standing still, or outside the event.
        active: live && !!plan && !muted() && !rot.locked && !rot.finish && !rot.still?.still,
        hill: rot.hill?.mode === 'pause',
        // The riders the team must bring over the line: the plan's, else WTRL's and ZRL's 4.
        needed: plan?.minimumFinishers > 0 ? plan.minimumFinishers : GAP_FINISHERS,
        // Speed, power and data age of the plan riders and me, for the watch (and its power history).
        riders: Object.fromEntries(list.filter(x => x && (x.self === true || riderIds.has(String(x.athleteId))))
            .map(x => [String(x.athleteId), {speed: x.state?.speed, power: x.state?.power, age: x.age ?? 0}])),
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


// The riders with my group for the cue: seen in my chain within CUE_FRESH_MS and in the line (not
// sitting out nor hanging, turns.mjs), the puller, not cut off behind an open gap behind me.
function cueGroupIds(now) {
    const cut = cutBehind(gaps, selfId);
    const line = new Set(rot.line);
    return [...freshIds(rot.seen, now).filter(id => line.has(id)), rot.front.puller]
        .filter(id => id != null && !cut.has(id));
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


// The riders with my group: the line (in my chain with the presence grace, turns.mjs), the puller,
// not cut off behind an open gap behind me. A rider sitting out (skipped at the front) or hanging
// behind a gap is out of the rotation, so he is not the wheel I drop in behind.
function groupIds() {
    const cut = cutBehind(gaps, selfId);
    return [...rot.line, rot.front.puller].filter(id => id != null && !cut.has(id));
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
    return turnsStatus(rot, {now, plan, selfId, live: selfId !== null && selfLive(currentNearby(now), selfId),
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


// The power bar's phase for a sample (powerband.mjs bandStep): my pull (by the engine's last step)
// with the marker from 5 s in and its zone colour; else null (READY, rest, chaos: the band runs on
// and the windows show it with its shadow, but there is no marker, below target is right in the
// draft). The goal is the bar's (barTarget: pull_wkg × my weight in W/kg mode, else the plan's watts).
function bandPhase(now) {
    const {view} = turnsStatus(rot, {now, plan, selfId, live: true});
    if (view && view.mine) {
        return {since: rot.front.since, goal: barTarget(view.me, liveWeight(), prefs.targetUnit)};
    }
    return null;
}


// The bar's power, colour and band from the band state while it is fresh: {meanW, zone, band}, meanW
// and zone null without a marker (READY, my pull's first 5 s), band {lo, hi, w} (w: the shadow).
function barPower(now) {
    const b = bandFresh(band, now);
    return {
        meanW: b ? b.marker : null,
        zone: b ? b.zone : null,
        band: b ? {lo: b.lo, hi: b.hi, w: b.w} : null,
    };
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
    // Once per new sample (powerband.mjs): the band runs all the time (it is there at once when READY
    // or my pull begins); the marker only in those phases (no phase: since null).
    const phase = bandPhase(now) ?? {since: null, goal: null};
    band = bandStep(band, {at: now, w: me.state.power, ...phase});
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
}


// ---------- terrain ----------

// My place in the climb index: my event distance, null without the index or the distance.
function routePos() {
    return terrain.index && eventDist !== null ? eventDist : null;
}


// For the engine: the index's hill here ({hill}, hill null on the flat), or undefined without the
// index or my event distance (the engine then goes by the live grade).
function terrainHere() {
    const pos = routePos();
    return pos === null ? undefined : {hill: hillAt(terrain.index.items, pos)};
}


// The getRoute options for the index: the profile must start with the prelude buildClimbIndex
// takes (routePrelude: meta.leadinDistance, Sauce's lead-in in the profile, often 0). Sauce's
// common.mjs: getRoute(id, options={prelude: 'leadin'}). buildClimbIndex places the profile by
// Zwift's own lead-in and lap length (the route's leadinDistanceInMeters and distanceInMeters): the
// profile's lead-in part once, then its lap scaled to Zwift's lap, one Zwift lap per further lap
// (read live 23 Nov 2026, Sauce 2.4.0-alpha.7; no weld).
function routeOptions() {
    return {prelude: 'leadin'};
}


// Builds the climb index of my event once it is known (in the pen): Sauce's route profile and its
// segments (route.segments, a segment over a climb joins it; Sauce's segment infos are not
// needed), every climb by event distance up to the event's end, lead-in once, then lap after lap
// (any number of laps). A failure, or a route without the data, is tried again after
// EVENT_RETRY_MS; a missing index is logged once per event (a timed event has no end distance).
// `seen` (gateEv): null once the event is over (out of it with live data, or my data gone for
// EVENT_LOST_MS in a TTT): the index is dropped then (a load under way too).
function terrainStep(ev, seen, now) {
    if (seen === null && (terrain.key !== null || terrain.busy)) {
        terrain = noTerrain();
    }
    if (!ev || !ev.found || ev.routeId == null || terrain.busy || typeof Common?.getRoute !== 'function') {
        return;
    }
    const key = `${ev.routeId}:${ev.laps}:${ev.endDistance}`;
    if (key === terrain.key && (terrain.index || now - terrain.at < EVENT_RETRY_MS)) {
        return;
    }
    const {routeId, laps, sgId} = ev;
    const endM = ev.endDistance;
    const load = {key, busy: true, at: now, index: null, climbs: null};
    terrain = load;
    (async () => {
        const route = await Common.getRoute(routeId, routeOptions());
        return buildClimbIndex(route, null, {laps, endM});
    })().then(index => {
        if (terrain !== load) {
            return;    // dropped meanwhile (demo)
        }
        terrain = {...load, busy: false, at: Date.now(), index,
                   climbs: index && {routeId, laps, endM, preludeM: index.preludeM, lapM: index.lapM,
                                     items: index.items}};
        if (!index && climbWarned !== sgId) {
            climbWarned = sgId;
            console.warn('Paceline: no climb index for route (the live grade decides)', key);
        }
    }, e => {
        console.warn('Paceline: could not load route', key, e);
        if (terrain === load) {
            terrain = {...load, busy: false, at: Date.now()};
        }
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


// Where the recording goes up, as far as known now (rideTarget): the ride lock of the event I am
// in, else this event's server plan, else a file plan's team in a ticked club. Set again at
// roll-off. The recorder can start before the plan server step has seen the event (and dropped
// last event's server plan), so a server plan counts only when it is from this event.
function startTarget(list, now) {
    const ev = inEventOf(eventOf(list, now), {tttOnly: prefs.tttOnly});
    const lib = readLibrary();
    return rideTarget({lock: ev ? lockFor(readLock(), ev.key) : null, entry: activeEntry(lib), plan, lib,
                       joined: joinedIds(readClubs(serverBase(prefs.serverUrl))), eventKey: ev ? ev.key : null});
}


function onStart(state, list, now) {
    const target = startTarget(list, now);
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
            slug: target?.slug ?? null,    // the club and team to upload this recording to (sessionTarget)
            circle: target?.circle ?? null,
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
    const {state, action} = recStep(before, {now, present: planRidersPresent(list, ids), gate: eventGate(), sg: gateSg,
                                             planned: prefs.recordWithoutPlan || ids.has(String(selfId))});
    if (JSON.stringify(state) !== JSON.stringify(before)) {
        writeJson(REC_STATE_KEY, state);
    }
    maybeSweep(now, state);
    if (action === 'start') {
        onStart(state, list, now);
    } else if (action === 'stop') {
        pendingMeta = null;
        prune().catch(logDb('pruning old recordings'));
        lastSweepAt = 0;    // the finished ride goes up on the next step
        trafficState = null;
    }
    if (state.recording) {
        if (pendingMeta && pendingMeta.sessionId === state.sessionId) {
            storeMeta();
        }
        // In a TTT: the riders of my event near me too when the plan riders are missing.
        const row = makeTick(list, ids, now, {fallback: !!eventGate()});
        try {
            row.det = detPlanOnly(detOf(now), ids, selfId);    // no Zwift ID of a rider in no plan
        } catch (e) {
            if (!detFailed) {
                detFailed = true;
                console.error('Paceline: could not record the decision details:', e);
            }
            row.det = null;
        }
        try {
            // Anonymous traffic near me: numbers that hold for this recording only. Only me and the
            // plan riders are kept out of it: the upload strips the rows of the fallback and watched
            // riders (stripForUpload), so they would be in neither; as traffic they go up anonymised.
            const from = trafficState?.sessionId === state.sessionId ? trafficState.pseudo : null;
            const kept = new Set(row.riders.filter(r => r.self === true || r.inPlan === true).map(r => r.id));
            const {pseudo, traffic} = trafficStep(from, list, kept, now);
            trafficState = {sessionId: state.sessionId, pseudo};
            row.traffic = traffic;
            row.trafficEpoch = pseudo.epoch;
        } catch (e) {
            if (!trafficFailed) {
                trafficFailed = true;
                console.error('Paceline: could not record the traffic:', e);
            }
            row.traffic = null;
        }
        const ev = gateEv(list, eventOf(list, now));    // a gap in my data is no change of event
        if (ev !== undefined) {
            const {log, next} = eventLogStep(eventLogged, {sessionId: state.sessionId, summary: ev});
            eventLogged = next;
            if (log) {
                row.event = ev;    // only when it changed: carry it forward in the analysis
            }
        }
        if (terrain.climbs) {
            // The climb index once per session, and again when it changes (route data, no rider).
            const {log, next} = eventLogStep(climbsLogged, {sessionId: state.sessionId, summary: terrain.climbs});
            climbsLogged = next;
            if (log) {
                row.climbs = terrain.climbs;
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
// his target, the band and its shadow, no marker, like READY).
function windowModel(view, reason, now) {
    const {meanW, zone, band: bandW} = barPower(now);
    const pen = penModel({plan, selfId, reason, started: rot.startAt != null});
    if (pen) {
        const watts = myRider(view)?.watts;
        const ok = Number.isFinite(watts);
        const barW = ok ? barTarget(myRider(view), liveWeight(), prefs.targetUnit) : null;
        return {...pen, watts: ok ? watts : null, marker: null, band: ok ? barBand(bandW, barW) : null};
    }
    // The countdown as shown (clock.mjs): the rotation's clock with its corrections absorbed, or
    // snapped and explained on the line under it (expert panel, 18 Nov 2026). Its riders are the
    // line (present, not sitting out, not hanging), so a rider who goes out explains a snap like one
    // who left.
    // In chaos (20 Nov 2026) there is no countdown: the clock starts over when the order holds again.
    const chaos = reason === 'chaos';
    const resting = !chaos && view && !view.mine && Number.isFinite(view.toMyPullS);
    restClk = clockStep(restClk, {now, trueS: resting ? view.toMyPullS : null, standing: !!view?.standing,
                                  present: resting ? rot.line.filter(id => id !== selfId) : null});
    const shown = resting ? {...view, toMyPullS: Math.floor(restClk.shownS)} : view;
    const m = actionModel(shown, meanW, zone,
                          {barW: barTarget(view?.me ?? null, liveWeight(), prefs.targetUnit), chaos, band: bandW});
    return m.kind === 'rest' ? {...m, correction: restClk.label, fadeAt: restClk.fadeAt} : m;
}


function shownOf(now) {
    const {view, reason} = rotationStatus(now);
    return shownModel({
        m: windowModel(view, reason, now),
        dash: dashKind(reason, {started: rot.front.puller != null}),
        meanW: barPower(now).meanW,
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
        // the hill's descent (route profile or live grade), else the live grade's
        descent: rot.hill?.mode ? !!rot.hill.descent : !!rot.climb.descent,
        hill: rot.hill ? rot.hill.mode : null,    // 'flag' (roller) | 'pause' (real climb/descent) | null
        routePos: routePos(),    // my event distance as looked up in the climb index (null: no index)
        routeDist: sauceRouteDist,    // Sauce's own route distance, to compare
        pending: rot.front.pending ? rot.front.pending.at : null,
        selfDraft3: draftMean(drafts),
        gap: gapNow(),    // the gap warning: {kind, id, m, s, n, mine, behind, level, closing} or null
        // The turn clocks (23 Nov 2026): this step's owner change, the climb display and its trigger,
        // who hangs and who sits out.
        turn: turnDet(rot),
        // The old core beside them (rotation.mjs, silent): its puller, chaos and countdown, for the
        // ride report; null after a failed shadow step.
        old: oldDet(now),
    };
}


// The old core's det (rotation.mjs shadowDet), null after a failed shadow step or when it throws
// (logged once with the step's failure), so the shadow never costs the tick its det.
function oldDet(now) {
    if (!shadowOk) {
        return null;
    }
    try {
        return shadowDet(shadow, {now, plan, selfId, live: selfId !== null && selfLive(currentNearby(now), selfId)});
    } catch (e) {
        if (!shadowFailed) {
            shadowFailed = true;
            console.error('Paceline: the old rotation core (shadow) failed:', e);
        }
        return null;
    }
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


// Uploads the oldest pending recording that has a club to go to (sessionTarget), if any. One
// without stays local and is skipped, so it never holds up the newer ones.
async function sweep(now, p, currentSessionId) {
    const sessions = await listSessions();
    let s = null, target = null;
    for (const id of pendingUploads(sessions, {now, currentSessionId, since: p.logUploadSince})) {
        s = sessions.find(x => x.sessionId === id);
        target = s ? sessionTarget(s.meta) : null;
        if (target) {
            break;
        }
    }
    if (!target) {
        return;
    }
    const res = await uploadSession(s.sessionId, {url: p.serverUrl, slug: target.slug, circle: target.circle,
                                                  athleteId: s.meta.selfId ?? selfId, now});
    if (!res.ok) {
        logUploadError(res.error, res.cause);
    }
}


// ---------- plan server ----------

// What the Info plan line needs besides the plan: the number of ticked clubs, the active server
// plan's club and the pending hint. Read again when the library, the clubs or the pending answer
// change (refreshInfo), not on every render.
function refreshInfo() {
    try {
        const clubs = readClubs(serverBase(prefs.serverUrl));
        const e = activeEntry(readLibrary());
        const joined = joinedIds(clubs);
        info = {joined: joined.length, club: e?.source === 'server' ? e.circleName ?? null : null,
                hint: readPending()?.hint ?? null};
        joinedSeen = joined.join(',');
    } catch(e) {
        console.error('Paceline: reading the clubs failed', e);
    }
}


function setPrefs(changes) {
    prefs = writePrefs(changes);    // the storage event only reaches the other windows
    return prefs;
}


function nearbyIds(now) {
    return currentNearby(now).map(x => x?.athleteId).filter(id => id !== null && id !== undefined).map(String);
}


// Deactivates the active plan when `which(entry)` says so.
function deactivate(which) {
    const lib = readLibrary();
    const e = activeEntry(lib);
    if (!e || !which(e)) {
        return;
    }
    writeLibrary({...lib, active: null});
    if (e.source === 'server') {
        setPrefs({serverEtag: null, serverSig: null, serverLabel: null, serverClub: null});
    }
    loadPlan();
    render();
}


// Carries out serverDecision's verdict on `record` (choosePlan's choice) for the event `key`.
function applyDecision({action, bind}, record, key, now) {
    if (action === 'take') {
        let entry = null;
        try {
            entry = recordEntry(record, {now, eventKey: key});
        } catch(e) {
            console.error('Paceline: unusable server plan', e);
        }
        if (!entry) {
            setPrefs({serverError: 'invalid'});
            return;
        }
        const lib = entryUpdate(readLibrary(), entry);
        if (lib) {
            writeLibrary(lib);
            loadPlan();
            render();
        }
    } else if (action === 'drop') {
        // A server plan goes; so does a file plan that has ended (it no longer overrides the server).
        deactivate(e => e.source === 'server' || fileEnded(e, {now, serverOn: true}));
        planFromEvent = false;
        return;
    }
    if (action === 'take' || action === 'same') {
        planFromEvent = true;
        if (prefs.serverEtag !== record.etag) {
            setPrefs({serverEtag: record.etag ?? null, serverSig: record.sig ?? null, serverLabel: record.label ?? null,
                      serverClub: record.circle?.name ?? null});
        }
        if (bind) {
            writeLock({state: 'bound', circle: record.circle.id, slug: record.slug, eventKey: key});
            // The lock binds after my roll-off (the plan came late): the recording running now
            // goes up under this team, not under the empty lock's null that roll-off gave it.
            retarget(readRecState(), {slug: record.slug, circle: record.circle.id});
        }
    }
}


// serverDecision for choosePlan's result against the stored lock (of this event), the file plan
// and the active server plan; carried out unless `only` names other actions.
function decide(choice, key, now, only = null) {
    const lib = readLibrary();
    const e = activeEntry(lib);
    const dec = serverDecision({
        record: choice.record, waiting: choice.waiting, lock: lockFor(readLock(), key),
        fileActive: fileActive(lib, {now, serverOn: true}), activeEtag: e?.source === 'server' ? e.etag ?? null : null,
    });
    if (!only || only.includes(dec.action)) {
        applyDecision(dec, choice.record, key, now);
    }
}


// A new event (or this window took the poll lease mid-event): a server plan of another event goes,
// and so does a file plan that has ended (dropsAtEventBegin); so do a lock and an answer left from
// one, and the check goes at once.
function eventBegins(key, now) {
    evKey = key;
    planFromEvent = false;
    deactivate(e => dropsAtEventBegin(e, {key, now}));
    const lock = readLock();
    if (lock && !lockFor(lock, key)) {
        writeLock(null);
    }
    const changes = {serverCheckedAt: null};
    const pend = readPending();
    if (pend && pend.eventKey !== key) {
        writePending(null);
        Object.assign(changes, {serverFits: null, serverOpensAt: null, serverOpensLabel: null});
    }
    setPrefs(changes);
    refreshInfo();
}


// The event is over (the gate closed): no lock, no pending answer, the hint was shown, no status
// that only meant this race, and a file plan loaded by the time the event was last seen (`seenAt`)
// ends; one loaded later (the gate closed late, after a gap in the data) stays. The event last seen
// goes too: it has ended (W1).
function eventOver(now, seenAt) {
    writeEventSeen(null);
    writeLock(null);
    const pend = readPending();
    if (pend?.hint) {
        const clubs = readClubs(serverBase(prefs.serverUrl));
        const next = markHinted(clubs, pend.hint.id, now);
        if (next !== clubs) {
            writeClubs(next);
        }
    }
    writePending(null);
    setPrefs(eventOverStatus(readPrefs()));
    const lib = readLibrary();
    if (endsAtGateClose(activeEntry(lib), seenAt)) {
        writeLibrary(endFilePlan(lib, now));
        loadPlan();
        render();
    }
    evKey = null;
    roll = null;
    planFromEvent = false;
    refreshInfo();
}


// My roll-off: the pending answer's plan by the roll-off pen rule, then the lock binds to the
// active server plan (empty without one, or with a file plan), and the recording running now gets
// its final upload target from the new lock (spec §7.7), null (stays local) included.
function rollOff(key, now) {
    decide(choosePlan(pendingFor(readPending(), key), {nearbyIds: nearbyIds(now), rolledOff: true}), key, now);
    const lib = readLibrary();
    const lock = {...lockAtRollOff(activeEntry(lib), {fileActive: fileActive(lib, {now, serverOn: true})}), eventKey: key};
    writeLock(lock);
    const target = rideTarget({lock, entry: activeEntry(lib), plan, lib,
                               joined: joinedIds(readClubs(serverBase(prefs.serverUrl))), eventKey: key});
    retarget(readRecState(), target);
}


// Files the recording running now under `target` ({slug, circle}, or null: it stays local, so a
// start target from last event's plan never survives). Nothing without a recording. The recorder
// may be another window: the row is changed in the database. When this window recorded it and its row is not stored yet, the meta
// about to be stored gets the target too, and the change waits for that write.
function retarget(rec, target) {
    if (!rec.recording || !rec.sessionId) {
        return;
    }
    const fields = {slug: target?.slug ?? null, circle: target?.circle ?? null};
    if (pendingMeta && pendingMeta.sessionId === rec.sessionId) {
        pendingMeta.meta = {...pendingMeta.meta, ...fields};
    }
    const gate = metaGate.sessionId === rec.sessionId && metaGate.ready ? metaGate.ready : Promise.resolve();
    gate.catch(() => {})
        .then(() => markUpload(rec.sessionId, fields))
        .catch(logDb('filing the recording under its team'));
}


// Plan-server failures in a row and the server's Retry-After (W8): pollEvery doubles the wait with
// each failure, pollDue waits for retryAt. This window's own, it starts over with the poll lease,
// and at a new event, server URL or club codes (backoffStep, M-7).
let backoff = {fails: 0, retryAt: null, scope: null};


// The poll lease owner's step (spec §7.1-§7.5): event begin and end, roll-off and lock, the pen
// rule while several clubs' plans fit, and the check when due. Never in the demo, never with the
// plan server off.
function serverTick(now) {
    const list = currentNearby(now);
    // Without fresh data of mine the gate stays as it is (gateEv), up to EVENT_LOST_MS: a gap
    // mid-race never ends the ride, a rider who is gone ends it.
    const summary = gateEv(list, eventOf(list, now), {gate: rideGate, now});
    const ev = inEventOf(summary, {tttOnly: prefs.tttOnly});
    // An event this window did not see end (W1): its poll owner closed (or Sauce quit) within the
    // grace after the finish. The next poll owner ends it once it sees another event, or after its
    // own EVENT_GRACE_MS without one (missedStep), never while still asking Sauce (no data of mine,
    // or a lookup that found nothing yet).
    const seen = readEventSeen();
    const missed = missedStep(missGoneAt, {seen, summary, ev, evKey, now});
    missGoneAt = missed.goneAt;
    if (missed.over) {
        eventOver(now, seen.at);
    }
    const wasOpen = rideGate.open;
    const lastSeen = rideGate.seenAt;    // the old event's, before this step sees a new one
    rideGate = gateStep(rideGate, {now, ev: summary, any: !prefs.tttOnly});
    if (wasOpen && !rideGate.open) {
        eventOver(now, rideGate.seenAt);
    }
    const change = eventChange(evKey, ev);
    if (change.over) {
        eventOver(now, lastSeen);    // the old event was never ended (held through a gap)
    }
    if (change.begin) {
        eventBegins(ev.key, now);
    }
    if (rideGate.open && ev && rideGate.seenAt === now) {
        writeEventSeen({key: ev.key, at: now});    // the event as last seen, for the next poll owner (W1)
    }
    if (ev) {
        const time = selfEntry(list)?.state?.time;
        if (typeof time === 'number' && Number.isFinite(time)) {
            const r = rollStep(roll, {key: ev.key, time});
            roll = r.state;
            if (r.midRide && !lockFor(readLock(), ev.key)) {
                writeLock({state: 'empty', eventKey: ev.key});
            }
            if (r.rolledOff) {
                rollOff(ev.key, now);
            }
        }
        if (!roll?.rolled && prefs.serverFits >= 2) {
            // Before my roll-off the pen rule picks again on every step while several plans fit.
            const choice = choosePlan(pendingFor(readPending(), ev.key), {nearbyIds: nearbyIds(now), rolledOff: false});
            if (choice.fits >= 2) {
                decide(choice, ev.key, now, ['take']);
            }
        }
    }
    const p = readPrefs();
    if (ev) {
        backoff = backoffStep(backoff, {url: p.serverUrl, codes: codesToSend(readClubs(serverBase(p.serverUrl))),
                                        eventKey: ev.key});
    }
    if (!ev || selfId === null || polling || !clubsReady ||
        !pollDue(p.serverCheckedAt, now,
                 pollEvery({inEvent: true, hasPlan: planFromEvent, error: p.serverError, fails: backoff.fails}),
                 backoff.retryAt)) {
        return;
    }
    if (!serverBase(p.serverUrl)) {
        setPrefs({serverError: 'badurl', serverCheckedAt: now});
        return;
    }
    polling = true;
    checkServer(ev, p, now).catch(e => console.error('Paceline: plan server check failed', e))
        .finally(() => {
            polling = false;
        });
}


// One step of this window: the poll lease, and serverTick while it holds it. A step without
// serverTick forgets this window's event state, so it starts over (eventBegins, roll-off seen as
// mid-ride) when the window takes the lease again, instead of resuming stale: a stale roll-off would
// overwrite a bound lock, a stale open gate could close later and end a fresh file plan.
function serverStep(now) {
    const {act, write} = pollLeaseStep(readJson(POLL_LEASE_KEY), ME, now);
    if (write) {
        writeJson(POLL_LEASE_KEY, write);
    }
    pollOwner = act;
    if (serverRuns({act, demo: demoKind, serverOn: prefs.serverOn})) {
        serverTick(now);
    } else {
        rideGate = initialGate();
        roll = null;
        evKey = null;
        planFromEvent = false;
        missGoneAt = null;
        backoff = {fails: 0, retryAt: null, scope: null};
    }
}


// The in-event check (spec §6.1). Errors keep the plan.
async function checkServer(ev, p, now) {
    const base = serverBase(p.serverUrl);
    const clubs = readClubs(base);
    const joined = joinedIds(clubs);
    const codes = codesToSend(clubs);
    const args = {url: p.serverUrl, selfId, mod: VERSION, joined, sig: plan?.sig ?? null};
    const url = checkUrl({...args, start: ev.start, eventId: ev.eventId});
    if (!url || url === checkUrl(args)) {
        return;    // no Zwift ID yet, or no usable start and event id: nothing goes out as in-event
    }
    setPrefs({serverCheckedAt: now});
    const req = {url: p.serverUrl, base, eventKey: ev.key, clubs, joined, codes};
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    let res = null;
    let answer = null;
    let error = null;
    try {
        res = await fetch(url, {cache: 'no-store', headers: checkHeaders(codes), signal: ctl.signal});
        if (res.status === 200) {
            answer = await res.json();
        }
    } catch(e) {
        // No answer, or a timeout while reading it: not reachable. A broken body: invalid.
        error = res && !ctl.signal.aborted ? 'invalid' : 'offline';
    } finally {
        clearTimeout(timer);
    }
    // The rider changed the server or switched it off, or the event changed: the answer no longer counts.
    const cur = readPrefs();
    if (cur.serverUrl !== p.serverUrl || !cur.serverOn || evKey !== ev.key || demoKind) {
        return;
    }
    if (!error && res.status !== 200) {
        error = 'http';    // a 429 for wrong codes too
    }
    if (!error && (!answer || typeof answer !== 'object' || Array.isArray(answer))) {
        error = 'invalid';
    }
    if (error) {
        // Audit fixes, 20 Nov 2026, W8: back off. The page reads Retry-After only where the server
        // lets it (cross-origin in Sauce it reads null: the server exposes no headers), the doubling
        // in pollEvery covers the rest.
        backoff = {...backoff, fails: backoff.fails + 1,
                   retryAt: retryAfterOf(res?.headers?.get('Retry-After') ?? null, Date.now())};
        setPrefs({serverError: error});
        return;
    }
    onAnswer(answer, req, Date.now());
}


// An in-event answer: clubs first (lost update, auto-join), then the status, the pending answer
// and the plan (spec §7.2-§7.5).
function onAnswer(answer, req, now) {
    backoff = {...backoff, fails: 0, retryAt: null};    // an answer: the server is back (W8)
    const fresh = readClubs(req.base);
    if (!sameJoined(fresh, req.clubs) || !sameCodes(fresh, req.clubs)) {
        // Ticked or coded while the request ran: keep the clubs part, drop the plans, ask again.
        writeClubs(applyAnswer(fresh, answer, now, req.codes));
        setPrefs({serverCheckedAt: null});
        refreshInfo();
        return;
    }
    const near = nearbyIds(now);
    const rolledOff = !!roll?.rolled;
    const res = answerClubs(fresh, answer, {now, inEvent: true, nearbyIds: near, rolledOff, sentCodes: req.codes});
    if (JSON.stringify(res.clubs) !== JSON.stringify(fresh)) {
        writeClubs(res.clubs);
    }
    if (res.autoJoined !== null) {
        setPrefs({serverCheckedAt: null});
        refreshInfo();
        return;
    }
    const plans = Array.isArray(answer.plans) ? answer.plans : [];
    setPrefs({serverNotice: typeof answer.notice === 'string' ? answer.notice : null, serverOkAt: now,
              serverError: plans.length ? null : 'notfound'});
    writePending({eventKey: req.eventKey, at: now, plans, hint: answerHint(answer, res.clubs)});
    // Under a bound lock its own team's records come first (a new final applies at once).
    const choice = chooseForLock(plans, lockFor(readLock(), req.eventKey), {nearbyIds: near, rolledOff});
    setPrefs(choiceStatus(choice));
    decide(choice, req.eventKey, now);
    refreshInfo();
}


// Another window changed the clubs. The poll owner clears a lock whose club was unticked (and that
// club's plan), and in an event a changed joined set is checked at once.
function clubsChanged() {
    const before = joinedSeen;
    refreshInfo();
    if (!pollOwner || demoKind || !prefs.serverOn) {
        return;
    }
    const ids = joinedIds(readClubs(serverBase(prefs.serverUrl)));
    const lock = readLock();
    if (lock && lockAfterClubs(lock, ids) === null) {
        writeLock(null);
        deactivate(e => e.source === 'server' && e.circleId === lock.circle);
    }
    if (evKey !== null && ids.join(',') !== before) {
        setPrefs({serverCheckedAt: null});
    }
}


// Another window changed the library. With no plan active (Remove), in an event, the poll owner
// activates the pending plan of this event's latest answer, subject to the lock.
function libraryChanged() {
    if (!pollOwner || demoKind || !prefs.serverOn || evKey === null || !rideGate.open || activeEntry(readLibrary())) {
        return;
    }
    const now = Date.now();
    decide(chooseForLock(pendingFor(readPending(), evKey), lockFor(readLock(), evKey),
                         {nearbyIds: nearbyIds(now), rolledOff: !!roll?.rolled}), evKey, now);
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
    // In chaos a dim "Order ≠ plan" instead of a guess (20 Nov 2026); the Front line below still
    // shows the real puller and his clock.
    const cn = captainNext({plan, view, reason, pullerId: rot.front.puller});
    if (cn?.chaos) {
        textLine(nextEl, S.orderOffPlan, true);
    } else if (cn) {
        const nx = cn.rider;
        riderLine(nextEl, nx, nx.id === selfId ? S.frontYou : nx.name, pullOf(nx));
    } else {
        textLine(nextEl, S.noRotation, true);
    }
    nextEl.classList.toggle('pl-planned', !!cn?.planned);
    if (reason === 'finish' || reason === 'climb' || reason === 'descent') {
        textLine(frontEl, reason === 'finish' ? S.finishOff : reason === 'climb' ? S.climbPaused : S.descentPaused,
                 false);
        return;
    }
    if (reason === 'regroup') {
        // After the hill, until the order is back (23 Nov 2026): no ▲, a quiet dim line.
        textLine(frontEl, S.regroupPaused, true);
        return;
    }
    if (!view) {
        textLine(frontEl, S.noRotation, true);
        return;
    }
    riderLine(frontEl, view.puller, view.mine ? S.frontYou : view.puller.name, frontClock(view));
}


function hhmm(ms) {
    return new Date(ms).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}


// "Rollers fast · plan RE5CFQ" (with the club when two or more are ticked); without a plan "Plan
// opens 19:00 · Rollers fast", the hint for an unticked club, or the prompt to load one.
// As {cut, keep, tail} (display.mjs planParts): only the label and the club may be cut, never
// " · plan RE5CFQ". whole: the hint, which fitInfo keeps whole (its instruction must show).
function planLine() {
    if (plan) {
        return info.joined >= 2 && info.club ?
            planParts('planLineClub', {label: plan.team, sig: plan.sig, club: info.club}) :
            planParts('planLine', {label: plan.team, sig: plan.sig});
    }
    const text = cut => ({cut, keep: '', tail: ''});
    if (prefs.serverOn && Number.isFinite(prefs.serverOpensAt)) {
        return text(fmt('opensLine', {time: hhmm(prefs.serverOpensAt), label: prefs.serverOpensLabel ?? ''}));
    }
    if (prefs.serverOn && info.hint) {
        return {...text(fmt('hintLine', {club: info.hint.name})), whole: true};
    }
    return text(S.noPlanLine);
}


function setPlanLine({cut, keep, tail, whole = false}) {
    const el = $('#pl-line-plan');
    setText(el.querySelector('.pl-plan-cut'), cut);
    setText(el.querySelector('.pl-plan-keep'), keep);
    setText(el.querySelector('.pl-plan-tail'), tail);
    el.classList.toggle('pl-plan-whole', whole);
}


// Makes the window invisible (or not): html.pl-vanish drops a solid background, body.transparent-bg
// makes Sauce paint the body fully transparent. Returns the flag. The class is added only when the
// window changes into the vanished state (an edge), so Sauce's own 3 s "find this window"
// highlight, which removes it, is not undone by the next render; while the window shows it is
// removed on every render (it undoes Sauce's late re-add).
let vanished = false;
function applyVanish(on) {
    document.documentElement.classList.toggle('pl-vanish', on);
    if (!on) {
        document.body.classList.remove('transparent-bg');
    } else if (!vanished) {
        document.body.classList.add('transparent-bg');
    }
    vanished = on;
    return on;
}


function renderInfo(now) {
    document.documentElement.classList.toggle('pl-show-next', prefs.showNext);
    document.documentElement.classList.toggle('pl-table-front', tableFront());
    // Outside a TTT event the window is invisible (nothing, not even its background).
    if (applyVanish(vanishes({mode, quiet: muted()}))) {
        return;
    }
    setPlanLine(planLine());
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
    let rec = demoKind === 'pref' ? {text: fmt('demoLine', {time: mmss(prefs.demoUntil - now)}), live: false} :
        selfId === null ? {text: '', live: false} : recText(now);
    // The server's notice (an outdated Paceline) takes the line while nothing records.
    const notice = !rec.live && demoKind !== 'pref' && prefs.serverOn && prefs.serverNotice;
    if (notice) {
        rec = {text: prefs.serverNotice, live: false};
    }
    recEl.hidden = !notice && selfId === null && demoKind !== 'pref';
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
// when the plan changes. The captain table (tableFront) has one more row: the slot for the
// "Order ≠ plan" row in chaos (20 Nov 2026), kept empty at the bottom otherwise, so the table
// never changes its height when chaos starts or ends (fixed slots).
function tableRows() {
    const table = $('#pl-table');
    const n = plan ? plan.riders.length + (tableFront() ? 1 : 0) : 0;
    const sig = plan ? plan.sig + ':' + n : null;
    if (sig === tableSig) {
        return table.children;
    }
    tableSig = sig;
    const cells = $('#pl-line-front').children;
    table.replaceChildren(...Array.from({length: n}, () => {
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
// rider pulling in bold. Before the start always, during the ride in captain mode with its table
// option (tableShown; user, 13 Nov 2026). Then its first row is the front (bold, his time left, or
// ▲ / ▼ / – while the rotation pauses) and the next rider in the line is set apart from the rest
// below him; no labels, the place says it. The table keeps the plan order (turnTable, spec
// 2026-11-23 section 2): a rider hanging behind a gap or sitting out after a skip stays dim in his
// slot (the first hanging one with the gap's metres); only riders gone from the group are last,
// dim, below a thin line (user, 14 Nov 2026). The old core's chaos never reaches the windows.
function renderTable(now) {
    const table = $('#pl-table');
    const {view, reason} = rotationStatus(now);
    const pullerId = rot.front.puller;
    table.hidden = !tableShown({plan, always: prefs.showNext && prefs.showRotation, pullerId, reason});
    if (table.hidden) {
        return;
    }
    const started = pullerId != null && reason !== 'still';
    const rows = turnTable(plan, {st: rot, started, selfId});
    const els = tableRows();
    const front = tableFront();
    const offPlan = front && reason === 'chaos' && rows.length > 0;
    const text = {text: S.orderOffPlan};
    const slots = offPlan ? [rows[0], text, ...rows.slice(1)] : front ? [...rows, {...text, slot: true}] : rows;
    const nextAt = offPlan ? 1 : front ? slots.findIndex((row, i) => i > 0 && row.rider && row.state === 'line') : -1;
    const droppedAt = slots.findIndex(row => row.rider && !row.present);    // they come last, set apart below
    slots.forEach((row, i) => {
        const el = els[i];
        const c = cellsOf(el);
        el.classList.toggle('pl-gap-after', i === nextAt && i + 1 !== droppedAt);
        el.classList.toggle('pl-dropped-first', i === droppedAt && i > 0);
        el.classList.toggle('pl-top', front && (i === 0 || i === nextAt));    // the two to call out, larger
        el.classList.toggle('pl-trow-slot', !!row.slot);    // the empty slot keeps its height (CSS)
        if (!row.rider) {
            el.classList.remove('pl-me', 'pl-pulling', 'pl-absent', 'pl-hang', 'pl-offplan');
            textLine(el, row.text, true);
            return;
        }
        el.classList.remove('pl-text');
        c.name.classList.remove('pl-dim');
        el.classList.toggle('pl-me', row.rider.id === selfId);
        el.classList.toggle('pl-pulling', row.pulling);
        el.classList.toggle('pl-absent', row.state === 'gone');
        el.classList.toggle('pl-hang', row.state === 'hanging' || row.state === 'out');    // dim, in his slot
        el.classList.toggle('pl-offplan', offPlan && i > 1 && row.present);
        setText(c.label, '');    // the place says it (user, 13 Nov 2026)
        setText(c.num, fmt('place', {n: row.number}));
        paint(c.sw, row.rider.color);
        setText(c.name, row.rider.name);
        let value = row.gapM === null ? pullOf(row.rider) : {clock: fmt('gapM', {m: row.gapM})};
        if (front && i === 0) {
            value = reason === 'climb' ? {clock: S.dashClimb} : reason === 'descent' ? {clock: S.dashDescent} :
                reason === 'finish' || reason === 'regroup' ? {clock: S.noRotation} : view && row.pulling ? frontClock(view) : value;
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
const FIT_HINT_MIN_PX = 8;    // the hint's line alone, when it is too long at FIT_MIN_PX
let fitKey = null;


function fitInfo() {
    const box = $('#pl-box');
    const table = $('#pl-table');
    const key = [innerWidth, innerHeight, plan ? plan.sig : '', prefs.showNext, tableFront(), table.hidden,
                 prefs.targetUnit, $('#pl-line-plan').textContent, $('#pl-line-you').textContent].join('|');
    // Also when the content no longer fits (a font loaded late, a longer text than measured).
    if (key === fitKey && box.scrollHeight <= box.clientHeight + 1) {
        return;
    }
    fitKey = key;
    const planEl = $('#pl-line-plan');
    planEl.style.fontSize = '';
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
    // The hint (another club has a plan for me) shows whole (final review, 20 Nov 2026): when it is
    // still too long at the smallest text, only its own line gets smaller.
    if (planEl.classList.contains('pl-plan-whole')) {
        const need = naturalWidth(planEl);
        if (need > availW) {
            const planPx = parseFloat(getComputedStyle(planEl).fontSize);
            planEl.style.fontSize = `${Math.max(FIT_HINT_MIN_PX, Math.floor(planPx * availW / need * 10) / 10)}px`;
        }
    }
}


// The width a line's content needs.
function naturalWidth(el) {
    const old = el.style.width;
    el.style.width = 'max-content';
    const w = el.getBoundingClientRect().width;
    el.style.width = old;
    return w;
}


// The widest line and the height of the content at the box's current font size.
function contentSize(box, probes) {
    const shown = el => !el.hidden && getComputedStyle(el).display !== 'none';
    // The lines outside the grid, and the grid at its natural width (all its rows, the probes
    // included, share the columns). Of the plan line only " · plan CODE" counts, with room for the
    // "…" of the label before it (user, 20 Nov 2026: the label is cut instead of keeping every
    // line small; final review: the code never is); the hint counts whole. All of it counts for
    // the height below.
    const planEl = $('#pl-line-plan');
    const keep = planEl.querySelector('.pl-plan-keep');
    const lines = [...box.children].filter(el => el.classList.contains('pl-line') && el.id !== 'pl-line-rec' &&
        el !== planEl && shown(el));
    const planW = !shown(planEl) ? 0 : planEl.classList.contains('pl-plan-whole') ? naturalWidth(planEl) :
        keep.textContent ? keep.getBoundingClientRect().width + parseFloat(getComputedStyle(keep).fontSize) : 0;
    const w = Math.max(1, planW, ...lines.map(naturalWidth), naturalWidth($('#pl-grid')));
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
// rider in the pen) and the pull: target, my power now and the time, the power bar below. While I
// rest with the option on, the recovery fields: with a Rest window open (it has the countdown) the
// three picked, without one the countdown as the right field (user, 23 Nov 2026); in
// chaos (20 Nov 2026) always, with or without a Rest window (which shows "≠"), the default fields
// (my power now in the middle) when the option is off (display.mjs fieldsShown). While I would show
// a countdown, a Rest window has it only once it shows it (audit fixes, 20 Nov 2026, W2:
// display.mjs restTakes, its sign of life's clock), or once it shows what I showed a moment ago
// (I-1: restHandBack, no flash of the countdown at the end of my pull or a dash); for a dash an
// open one is enough, as before.
function renderAction(now) {
    const {view, reason} = rotationStatus(now);
    let m = windowModel(view, reason, now);
    const me = myRider(view);
    const quiet = muted();
    if (mode === 'rest') {
        // The Rest window shows only the rest: it disappears completely, background included, outside
        // a TTT and during my pull and from READY on while an Action window is open (vanishes).
        const vanish = applyVanish(vanishes({mode, quiet, model: m, actionOpen: windowOpen('action', now, aliveEntries())}));
        show($('#pl-demo-badge'), demoBadge({demo: demoKind === 'pref', vanish}));    // W12
        renderRestRow(vanish ? {kind: 'blank'} : m, reason);
        // Tell the Action windows at once whether this window shows the countdown (W2), and what it
        // shows (I-1: the hand-back).
        const shown = restClockOf({vanish, model: m});
        const shows = restShowsOf({vanish: vanish && !quiet, model: m});
        if (shown !== restShown || shows !== restShowing) {
            restShown = shown;
            restShowing = shows;
            aliveStep(now, true);
        }
        return;
    }
    // The Action window vanishes outside a TTT only (its content is blank there anyway).
    show($('#pl-demo-badge'), demoBadge({demo: demoKind === 'pref', vanish: applyVanish(quiet)}));
    const alive = aliveEntries();    // parsed once per render
    actPhase = phaseStep(actPhase, {phase: actionPhase(m), now});
    const handBack = restHandBack({shows: restShows(alive, {now, selfId: ME}), phase: actPhase, now});
    const restOpen = restTakes({restOpen: windowOpen('rest', now, alive), restShown: restClockOpen(now, alive),
                                handBack, model: m});
    const fs = {recFields: winSettings.recFields, restOpen, model: m, reason};
    if (fieldsShown(fs)) {
        renderFields(fieldSlots(winSettings), me, now, reason, clockInFields(fs) ? m : null);
        return;
    }
    if (reason === 'chaos') {
        // My pull (the only thing left here in chaos) as always.
    } else if (restOpen) {
        // An open Rest window has the countdown (user, 17 Nov 2026: no setting): here only my pull,
        // blank while resting, armed (READY) in its last seconds. Without an open Rest window the
        // countdown shows here, so it is never missing.
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
let restShown = false;    // the Rest window shows its countdown or READY (its sign of life's clock, W2)
let restShowing = null;    // ... what it shows (display.mjs restShowsOf, its sign of life's shows, I-1)
let actPhase = null;    // the Action window's phase and when it changed (display.mjs phaseStep, I-1)


// Writes this window's sign of life every ALIVE_REFRESH_MS (force: at once) and drops keys of
// windows long gone. clock: a Rest window that shows its countdown (audit fixes, 20 Nov 2026, W2);
// shows: what it shows (I-1).
function aliveStep(now, force = false) {
    if (!force && !aliveDue(aliveAt, now)) {
        return;
    }
    aliveAt = now;
    try {
        localStorage.setItem(aliveKey(ME), JSON.stringify({mode, at: now, clock: mode === 'rest' && restShown,
                                                           shows: mode === 'rest' ? restShowing : null}));
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
function windowOpen(m, now, entries = aliveEntries()) {
    return aliveModes(entries, {now, selfId: ME}).has(m);
}


// True while another Rest window shows its countdown (W2, presence.mjs restClockShown).
function restClockOpen(now, entries = aliveEntries()) {
    return restClockShown(entries, {now, selfId: ME});
}


// My plan rider (in the pen there is no view yet).
function myRider(view) {
    return view?.me ?? (plan && selfId !== null ? plan.riders.find(r => r.id === selfId) ?? null : null);
}


// The rest row: the countdown and my place, READY in its last seconds; the dash says why there is
// nothing (dim ▲ / ▼, amber ?), quiet means empty; 'blank' shows nothing at all.
function renderRestRow(m, reason) {
    $('#pl-act').classList.remove('pl-fields-clock');
    show($('#pl-act-row'), true);
    show($('#pl-act-over'), true);
    show($('#pl-act-tri'), false);
    renderGapBand(false);
    renderGapEarly(false);
    $('#pl-act-bar').classList.add('pl-off');
    const dash = $('#pl-act-dash');
    const clockEl = $('#pl-act-clock');
    const placeEl = $('#pl-act-place');
    const dk = restDash(m, reason);
    show(dash, m.kind === 'none' && dk !== 'none');
    if (m.kind === 'none') {
        setText(dash, dashText(dk));
        dash.classList.toggle('pl-warn', dk === 'unknown');
    }
    const resting = m.kind === 'rest';
    const standing = resting && !!m.standing;
    clockEl.classList.toggle('pl-standing', standing);
    const corr = renderOverLine(m, reason, dk);
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
    snapFade(m, $('#pl-act-cnum'), corr, ready);
    if (m.place !== null) {
        setText(placeEl, fmt('place', {n: m.place}));
    }
}


// The dash's kind while there is no countdown (model 'none'), else null.
function restDash(m, reason) {
    return m.kind === 'none' ? dashKind(reason, {started: rot.front.puller != null}) : null;
}


function dashText(dk) {
    return dk === 'climb' ? S.dashClimb : dk === 'descent' ? S.dashDescent :
        dk === 'chaos' ? S.dashChaos : dk === 'unknown' ? S.dashUnknown : S.noRotation;
}


// After a snap (clock.mjs) the new number fades in once and its explanation with it: no
// movement, no colour, no values in between (expert panel, 18 Nov 2026).
function snapFade(m, numEl, corr, ready) {
    if (m.fadeAt != null && m.fadeAt !== fadedAt) {
        fadedAt = m.fadeAt;
        if (!ready) {
            fadeIn(numEl, 0.25, 400);
        }
        if (corr) {
            fadeIn($('#pl-act-over'), 0, 200);
        }
    }
}


// The status line under the countdown (with the fields, in the bar's place): a gap, the clock's
// correction, the wheel to drop in behind, the standing clock's overrun. Returns the correction
// shown (or null).
function renderOverLine(m, reason, dk) {
    const resting = m.kind === 'rest';
    // In chaos (20 Nov 2026) I still rest behind the dash: the gap line shows under it as under
    // the countdown.
    const chaosRest = dk === 'chaos';
    // The standing clock (expert panel, 13 Nov 2026): the number stays, dimmed with "≥" (my pull is at
    // least that far away), and under it how long the puller is over his plan, "+12". No blinking.
    const standing = resting && !!m.standing;
    // The same line carries a gap in the line (user, 13 Nov 2026): mine first (amber, I must close
    // it), then the standing clock, then someone else's gap (dim, the puller deals with it). A gap
    // that is closing comes after the standing clock too (green when mine or critical).
    // The early stage only when it is mine (close up before the draft is gone).
    const g0 = resting || chaosRest ? gapNow() : null;
    const g = g0 && (g0.level === 'full' || g0.mine) ? g0 : null;
    const over = $('#pl-act-over');
    // Amber when I must close it or the team needs the riders cut off; someone with riders to spare
    // stays dim. A critical gap of someone else goes before the standing clock. Green instead of amber
    // while the gap is closing (user, 17 Nov 2026: the rider behind closes it himself): then it is
    // not urgent and ranks like someone else's gap, after the standing clock and a wheel change.
    const urgent = !!g && (g.mine || g.critical) && !g.closing;
    // The wheel to drop in behind at the start, or when it changes (user, 15 Nov 2026): kit colour
    // and name, amber when it is not the plan's (that rider is dropped). After my own and critical
    // gaps; the start cue also after the standing clock and other gaps, a change goes before them.
    // A correction of the clock (clock.mjs): after my own and critical gaps, before the wheel and
    // the standing clock; in READY only "READY off".
    const ready0 = resting && (m.next || m.timeS === 0);
    const corr = !urgent && resting && m.correction && (!ready0 || m.correction.kind === 'readyOff') ? m.correction : null;
    const cv = !urgent && !corr && (resting || (m.kind === 'none' && reason === 'start')) ? cueView(cue, Date.now()) : null;
    const cueId = cv && (cv.kind === 'change' || (!standing && !g)) ? cv.id : null;
    const cueRider = cueId ? plan?.riders.find(r => r.id === cueId) : null;
    over.classList.toggle('pl-gap-warn', urgent);
    over.classList.toggle('pl-corr', !!corr);
    over.classList.toggle('pl-corr-sooner', !!corr && (corr.deltaS < 0 || corr.kind === 'readyOff'));
    over.classList.toggle('pl-gap-closing', !!g && (g.mine || g.critical) && g.closing && !cueRider && !standing && !corr);
    over.classList.toggle('pl-cue', !!cueRider);
    over.classList.toggle('pl-cue-swap', !!cueRider && cueId !== plannedWheel(plan, selfId)?.id);
    show($('#pl-act-overlbl'), !!cueRider);
    show($('#pl-act-oversw'), !!cueRider);
    let cueParts = null;
    if (cueRider) {
        paint($('#pl-act-oversw'), cueRider.color);
        // Not the plan's wheel: his place in the line, not his plan number (user, 14 Nov 2026).
        const place = over.classList.contains('pl-cue-swap') ?
            linePlace(plan, {pullerId: rot.front.puller, selfId, id: cueId, presentIds: cue.kind === 'start' ? groupIds() : cueGroupIds(Date.now())}) : null;
        cueParts = {pre: '', cut: firstName(cueId).toUpperCase(), post: place ? ` ${fmt('place', {n: place})}` : ''};
    }
    setOverParts(corr ? correctionParts(corr) : cueRider ? cueParts :
        urgent && g.mine ? labelParts('gapMe', {gap: gapAmount(g)}) : urgent ? gapParts(g) :
        standing ? plainParts(`+${m.overS}`) : g?.mine ? labelParts('gapMe', {gap: gapAmount(g)}) : g ? gapParts(g) : plainParts(''));
    // "Wheel" only as a whole word (final review, 20 Nov 2026): when the line is too long for it,
    // the label goes, not shrunk to a clipped piece of the "W".
    const lbl = $('#pl-act-overlbl');
    if (cueRider && lbl.scrollWidth > lbl.clientWidth) {
        show(lbl, false);
    }
    return corr;
}


// The status line under the clock stays on one line (user, 20 Nov 2026; the clock's size counts
// on one line): one text in three parts, the middle one cut with "…" when the line is too long.
// The middle part is the rider names, or without names the label before the gap ("Gap ahead",
// display.mjs labelParts); the gap, the delta and the place are never cut.


function setOverParts({pre, cut, post}) {
    const el = $('#pl-act-overtxt');
    setText(el.querySelector('.pl-over-pre'), pre);
    setText(el.querySelector('.pl-over-cut'), cut);
    setText(el.querySelector('.pl-over-post'), post);
}


function plainParts(text) {
    return {pre: text, cut: '', post: ''};
}


// The text of `key` with vars[cutKey] as the part that may be cut.
function cutParts(key, vars, cutKey) {
    const [pre, post = ''] = fmt(key, {...vars, [cutKey]: PART_MARK}).split(PART_MARK);
    return {pre, cut: String(vars[cutKey]), post};
}


// The clock's correction for the rest line: "DANA out −40s", "DANA back +1:10", "−25s", "READY off +36s".
function correctionParts(c) {
    const delta = deltaText(c.deltaS);
    if (c.kind === 'readyOff') {
        return plainParts(fmt('corrReadyOff', {delta}));
    }
    if (c.kind === 'out' || c.kind === 'back') {
        const name = c.ids.map(id => firstName(id).toUpperCase()).join(', ');
        return cutParts(c.kind === 'out' ? 'corrOut' : 'corrBack', {name, delta}, 'name');
    }
    return plainParts(delta);
}


// One fade-in of an element's opacity from `from` (the Web Animations API; nothing where it is
// missing).
function fadeIn(el, from, ms) {
    if (el && typeof el.animate === 'function') {
        el.animate([{opacity: from}, {opacity: 1}], {duration: ms, easing: 'ease-out'});
    }
}


// Someone else's gap, for the rest line: a rider by name, the gap ahead of me, or the riders behind.
function gapParts(g) {
    if (g.kind === 'one') {
        return cutParts('gapInfoOne', {name: firstName(g.id), gap: gapAmount(g)}, 'name');
    }
    return g.behind ? labelParts('gapInfoAhead', {gap: gapAmount(g)}) : labelParts('gapInfoSplit', {n: g.n, gap: gapAmount(g)});
}


// The gap band in place of the power bar during my pull (user, 13 Nov 2026): red with a white edge
// when the team needs the riders cut off (always the group behind me), amber for a rider or a split
// the team can spare; green while it is closing (user, 17 Nov 2026). Ease off; the target does not
// count then.
// text: a strings key instead of the text by kind ('gapMe', or what restGapBand gives for the
// recovery fields in chaos).
function renderGapBand(on, g, text = null) {
    const band = $('#pl-act-gap');
    $('#pl-act-bar').classList.toggle('pl-gapped', on);
    show(band, on);
    if (!on) {
        return;
    }
    band.dataset.kind = g.kind;
    band.dataset.critical = g.critical ? '1' : '';
    band.dataset.closing = g.closing ? '1' : '';
    const gap = gapAmount(g);
    setText(band, text === 'gapMe' || text === 'gapInfoAhead' ? fmt(text, {gap}) :
        g.kind === 'group' ? fmt('gapGroup', {gap}) :
        g.kind === 'one' ? fmt('gapOne', {name: firstName(g.id).toUpperCase(), gap}) :
        fmt('gapSplit', {n: g.n, gap}));
}


// The early stage during my pull (user, 13 Nov 2026): the bar stays, with an amber edge, and the
// label under my power now says how far back it is ("▼ 9 m"). Short, so the middle never widens.
// While the gap is closing (user, 17 Nov 2026) the bar keeps its normal look (a green edge would melt
// into its green zone) and only the label turns green.
function renderGapEarly(on, g) {
    $('#pl-act-bar').classList.toggle('pl-gap-early', on && !g.closing);
    const label = $('#pl-act-nowlbl');
    label.classList.toggle('pl-gap-warn', on);
    label.classList.toggle('pl-gap-closing', on && g.closing);
    setText(label, on ? fmt('gapEarly', {m: g.m}) : S.nowLabel);
}


// An empty cell that keeps its line height (a no-break space).
const KEEP = '\u00a0';


// READY and the pull: three fixed points with their units under them, and the bar. The target
// left, my power now in the middle (in the marker's zone colour once the marker shows, 5 s into the
// pull; neutral before and in READY), the time right (READY, the pull's seconds, over time "−4" amber).
function renderTriple(m, me, now) {
    $('#pl-act').classList.remove('pl-fields-clock');
    show($('#pl-act-row'), false);
    show($('#pl-act-over'), false);
    show($('#pl-act-tri'), true);
    show($('#pl-act-tplace'), false);
    const weight = pickWeight(liveWeight(), me?.weight);
    const hasTarget = m.watts !== null && m.watts !== undefined;
    // No weight at all: the target and the "now" number are both watts. With the plan's pull_wkg
    // the target is it (riderTarget), and the "now" number my live W/kg (live watts / weight).
    const unit = nowUnit(weight);
    const target = hasTarget ? riderTarget(me, weight, unit) : null;
    const wnum = $('#pl-act-wnum');
    setText(wnum, target ? target.value : S.noRotation);
    wnum.classList.toggle('pl-dim', !target);
    setText($('#pl-act-wunit'), target ? target.unit : '');
    const nowW = myPowerNow(now);
    const nowText = nowW === null ? null : nowValue(nowW, weight, target ? unit : 'W');
    const nowEl = $('#pl-act-now');
    setText(nowEl, nowText ?? S.noRotation);
    const zone = m.kind === 'pull' && nowText !== null ? m.marker?.zone ?? null : null;
    nowEl.dataset.zone = zone ?? '';
    nowEl.classList.toggle('pl-dim', nowText === null);
    const timeEl = $('#pl-act-time');
    timeEl.classList.remove('pl-dim', 'pl-standing');    // a missing recovery field or the countdown there before
    if (m.kind === 'armed') {
        setText(timeEl, S.ready);
        setText($('#pl-act-tunit'), '');
        timeEl.classList.add('pl-warn');
    } else {
        setText(timeEl, (m.over ? '\u2212' : '') + pullSecs(m.timeS));
        setText($('#pl-act-tunit'), S.secUnit);
        timeEl.classList.toggle('pl-warn', !!m.warn);
    }
    // The bar: with a target always (READY too); a pull without target watts gets a neutral track,
    // so it never looks like rest. The band of my last 10 s with its shadow at my power now from the
    // first sample (READY too); the marker (my 10 s average, in its zone colour) from 5 s into my
    // pull over it (user, 25 Nov 2026).
    const bar = $('#pl-act-bar');
    bar.classList.toggle('pl-off', !hasTarget && m.kind !== 'pull');
    bar.classList.toggle('pl-neutral', !hasTarget);
    const markerEl = $('#pl-bar-marker');
    show(markerEl, hasTarget && !!m.marker);
    if (hasTarget && m.marker) {
        markerEl.style.setProperty('--pos', String(m.marker.pos));
        markerEl.dataset.zone = m.marker.zone ?? '';    // no zone (no goal): white
    }
    const bandEl = $('#pl-bar-band');
    const b = hasTarget ? m.band ?? null : null;
    show(bandEl, !!b);
    if (b) {
        bandEl.style.setProperty('--lo', String(b.lo));
        bandEl.style.setProperty('--hi', String(b.hi));
        bandEl.style.setProperty('--now', `${(b.now * 100).toFixed(1)}%`);    // the shadow, gliding (CSS)
    }
    renderBarNums(hasTarget ? barTarget(me, liveWeight(), prefs.targetUnit) : null, weight, unit);
    const g = m.kind === 'pull' ? gapNow() : null;
    const mine = !!g && !g.behind;    // a gap behind me while I pull: mine to deal with
    renderGapBand(mine && g.level === 'full', g);
    renderGapEarly(mine && g.level === 'early', g);
}


// The optional numbers in the bar (Action window option "Numbers on the power bar", spec 2026-11-24
// band bar): where amber and red begin, inside their fields against the edge they name, in the
// window's target unit by the weight the bar uses. barW: the bar's target in watts; null (no target,
// the neutral bar) or the option off: all four hidden, never blank text.
function renderBarNums(barW, weight, unit) {
    const els = document.querySelectorAll('#pl-act-bar .pl-bar-num');
    const on = !!winSettings.barNums && Number.isFinite(barW);
    $('#pl-act-bar').classList.toggle('pl-bar-nums', on);
    const texts = on ? bandNumbers(barW, {kg: weight, unit}) : [];
    els.forEach((el, i) => {
        show(el, on);
        if (on) {
            setText(el, texts[i]);
        }
    });
}


// My power for the number in the middle (pull, READY) and the Power field: as Zwift sends it, or
// Sauce's 5 s power with "5 s smoothed power" on (display.mjs powerNow); the bar keeps its filter.
function myPowerNow(now) {
    return powerNow({raw: selfEntry(currentNearby(now))?.state?.power, smooth5W: mySmooth5(now)});
}


function mySmooth5(now) {
    const entry = selfEntry(currentNearby(now));
    return smooth5({on: winSettings.recSmooth5, sauce: entry?.stats?.power?.smooth?.['5'], hist, now});
}


// The unit of my power now: Paceline's target unit, watts without any weight (as the pull shows it).
function nowUnit(weight) {
    return weight === null ? 'W' : prefs.targetUnit;
}


// The recovery fields (spec 2026-11-20 big numbers section 3): the pull's three cells, each with
// its unit line under it; an Off slot stays empty (KEEP keeps its line height, so nothing moves when
// my pull starts), a missing value is the dim "–". The middle one is the pull's "now" cell, so it
// follows "Smaller middle field". No bar; in chaos a gap the rest line would show goes into the
// bar's place (fieldsGapBand), so an Action-only rider does not lose it; outside chaos the open
// Rest window shows it, or this window's status line in the bar's place (clockModel).
// clockModel (user, 23 Nov 2026): the model while the countdown is mine to show (no Rest window has
// it, display.mjs clockInFields): the right field is then the countdown with my place under it (or
// the dash), and the status line takes the bar's place. null: the three fields picked.
function renderFields(slots, me, now, reason, clockModel = null) {
    $('#pl-act').classList.toggle('pl-fields-clock', !!clockModel);
    show($('#pl-act-row'), false);
    show($('#pl-act-over'), !!clockModel);
    show($('#pl-act-tri'), true);
    const entry = selfEntry(currentNearby(now));
    const weight = pickWeight(liveWeight(), me?.weight);
    const fields = recoveryFields(slots, entry?.state, {
        unit: nowUnit(weight),
        weight,
        smooth5W: mySmooth5(now),
    });
    const g = gapNow();
    renderGapEarly(false, g);    // the middle unit line back to plain (it set "now" there)
    const cells = [['#pl-act-wnum', '#pl-act-wunit'], ['#pl-act-now', '#pl-act-nowlbl'], ['#pl-act-time', '#pl-act-tunit']];
    fields.forEach((f, i) => {
        const num = $(cells[i][0]);
        setText(num, f ? f.num ?? S.noRotation : KEEP);
        num.classList.toggle('pl-dim', !!f && f.num === null);
        num.classList.remove('pl-warn', 'pl-standing');
        num.dataset.zone = '';    // no target in recovery: no colour
        setText($(cells[i][1]), f ? f.unit : KEEP);
    });
    show($('#pl-act-tplace'), false);
    const bar = $('#pl-act-bar');
    bar.classList.add('pl-off', 'pl-neutral');
    show($('#pl-bar-marker'), false);
    show($('#pl-bar-band'), false);
    renderBarNums(null, null, 'W');
    if (clockModel) {
        renderClockField(clockModel, reason);
        return;
    }
    const b = fieldsGapBand(g, reason);
    renderGapBand(!!b, g, b?.text);
}


// The countdown as the right field (user, 23 Nov 2026): the number where READY and my pull's time
// come next, my place "#2" under it (no "s"); the dash (dim ▲ / ▼, amber ?) in its place when there is none. The
// status line as under the big countdown, in the bar's place.
function renderClockField(m, reason) {
    const num = $('#pl-act-time');
    const dk = restDash(m, reason);
    const c = clockField(m);
    setText(num, c ? c.num : dk === 'none' ? KEEP : dashText(dk));
    num.classList.toggle('pl-dim', !c && dk !== 'unknown');
    num.classList.toggle('pl-warn', c ? !!m.warn : dk === 'unknown');
    num.classList.toggle('pl-standing', !!c && !!m.standing);
    setText($('#pl-act-tunit'), c ? c.unit : KEEP);
    const place = $('#pl-act-tplace');
    show(place, !!c?.place);
    setText(place, c?.place ?? '');
    renderGapBand(false);
    const corr = renderOverLine(m, reason, dk);
    if (c) {
        snapFade(m, num, corr, false);
    }
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
        const list = currentNearby(lastStepAt);
        const ev = eventOf(list, lastStepAt);
        // A gap in my data holds the gate (gateEv) up to EVENT_LOST_MS: a Sauce dropout mid-race
        // neither mutes the windows nor splits the recording.
        const seen = gateEv(list, ev, {gate, now: lastStepAt});
        gate = gateStep(gate, {now: lastStepAt, ev: seen});
        gateSg = isTtt(seen) ? seen.sgId : undefined;
        terrainStep(ev, seen, lastStepAt);
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
        serverStep(lastStepAt);
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


// The Action window's own options (Sauce's per-window settings store, settings.html), each with its
// default while unset (and in the plain-browser preview): "Smaller middle field" on, the recovery
// fields off with the slots off / Power / off, "5 s smoothed" off, "Numbers on the power bar" off.
const WIN_DEFAULTS = {midSmall: true, recFields: false, recLeft: 'off', recMid: 'power', recRight: 'off', recSmooth5: false, barNums: false};
let winSettings = {...WIN_DEFAULTS};

function readWinSettings() {
    try {
        const all = Common.settingsStore.get() || {};
        const out = {...WIN_DEFAULTS};
        for (const k of Object.keys(WIN_DEFAULTS)) {
            if (all[k] !== undefined && all[k] !== null) {
                out[k] = all[k];
            }
        }
        winSettings = out;
    } catch(e) {
        console.warn('Paceline: could not read the window settings', e);
    }
}


// "Smaller middle field" (Action window, per window; default on): off makes my power in the
// middle as large as the two sides.
function applyMidSmall() {
    document.documentElement.classList.toggle('pl-mid-same', winSettings.midSmall === false);
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
    // The four numbers sit at the field edges (linear, whatever scale the marker uses beyond them).
    [-AMBER_PCT, -GREEN_PCT, GREEN_PCT, AMBER_PCT].forEach((edge, i) => {
        bar.querySelectorAll('.pl-bar-num')[i]?.style.setProperty('--pos', String(0.5 + edge / (2 * BAR_RANGE_PCT)));
    });
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
            readWinSettings();
            applyMidSmall();
            Common.settingsStore.addEventListener('set', ev => {
                if (ev.data && (ev.data.key == null || BG_KEYS.includes(ev.data.key))) {
                    applyBackground();
                }
                if (ev.data && (ev.data.key == null || Object.hasOwn(WIN_DEFAULTS, ev.data.key))) {
                    readWinSettings();
                    applyMidSmall();
                    render();
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
        libraryChanged();
        render();
    });
    onClubsChange(() => {
        clubsChanged();
        render();
    });
    // The table shared by all window profiles comes first: no plan-server check before it is merged,
    // or a fresh profile's empty table could auto-join before the shared ticks arrive.
    initClubs(Common, serverBase(prefs.serverUrl)).then(() => {
        clubsReady = true;
    });
    onKeyChange(PENDING_KEY, () => {
        refreshInfo();
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
        refreshInfo();    // another server has another Clubs table
        syncDemo(Date.now());
        if (prefs.serverOn !== planServerOn) {
            loadPlan();    // an ended file plan counts only with the plan server off
        }
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
    // Closing the window: its sign of life goes at once, so the others take over without waiting,
    // and so do the recorder and poll leases it holds (W4: they no longer wait LEASE_STALE_MS).
    addEventListener('pagehide', () => {
        try {
            localStorage.removeItem(aliveKey(ME));
            for (const key of [LEASE_KEY, POLL_LEASE_KEY]) {
                if (leaseHeld(readJson(key), ME)) {
                    localStorage.removeItem(key);
                }
            }
        } catch(e) {
            // ignore
        }
    });
    setInterval(fallbackTick, FALLBACK_POLL_MS);
    fallbackTick();
}
