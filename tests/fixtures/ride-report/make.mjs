// A made-up recording for the ride report tests (made-up riders and ids). Four plan riders ride a
// paceline at 45 km/h, 30 s pulls in plan order (Alma, Bert = me, Cleo, Dora), after 40 s in the
// start pen. Known things to find:
// - the puller (det.puller) follows the true front 2 s late;
// - one countdown jump of 10 s down (my clock, at +100 s after the roll-off);
// - Dora (last in the line) drops 15 m behind for 12 s with no draft (a real gap) at +362 s, and
//   14 m for 10 s in full draft at +125 s (someone not in the data in between: no real gap);
// - plan P2 from +240 s (Dora pulls 40 s by the plan) with Emil, who rides 400 m behind (not
//   in the head plan: the upload would drop him);
// - the windows showed Dora's gap (det.gap) from 5 s after it opened, for 6 s;
// - the event's finish line at +470 s; finish mode from 500 m before; the recording ends at +480 s.
//   With afterLine: finish mode goes off at the line, the puller changes 3 s later and a gap
//   warning shows for 2 s (the engine still running after the line).
// - With draftIntoDrop the full-draft "gap" at +121 s is followed by a real one: Dora 12 m back in
//   full draft for 8 s, 5 m back for 12 s (the warning stays on), then 13 m back with no draft for
//   9 s (+141 s).
// - With swap: Cleo and Dora swap the front during their turn at +180 s (Cleo 20 s, Dora 10 s,
//   Cleo 12 s, Dora 18 s): stints of 19, 9, 11 and 17 s, one turn of 30 s for Cleo and 26 s for Dora.
// - With emilLeavesS: Emil's rows stop from that race second on (he left, 400 m back).
// - With chaos: plan P1 all race (no switch, no Emil) and the front leaves the plan's order:
//   Dora and Alma swap the front back and forth from +150 s (Dora 40 s, Alma 40 s, Dora 40 s),
//   then the plan's order again from +270 s (Alma, Bert = me, Cleo, ...): two changes back to the
//   rider before (bad), then three in order. My clock (shown.act) keeps counting by the regular
//   schedule, as a version without the chaos counter would. With chaos 'live' the recording also
//   holds the live chaos state (det.order, det.reason 'chaos', act 'chaos' while resting) from
//   CHAOS_FROM_S to CHAOS_TO_S.
// - With cdOld (seconds): the recording holds the fixed rule's countdown as a shadow (det.cdOld,
//   since 0.3.4-beta.5), that many seconds above my shown clock while it counts, else null.
// - With shadow: a recording of the turn-clock version (23 Nov 2026): the old core runs beside the
//   windows' core and is recorded as det.old = {puller, since, frontId, reason, chaos, out, cd}.
//   It copies the live fields (the chaos of the 'live' option, the countdown of cdOld, else
//   cd = my shown clock) and drops det.order and det.cdOld; the windows' reason never says 'chaos'
//   (the new core has no chaos), so the live chaos state is only in det.old.
// - With easeOffS (seconds): the front rider eases off to 100 W for the last that many seconds of
//   each 30 s pull while still in front (the plain rotation; not combined with swap or chaos), so
//   the rider before me eases off (T0) before his stint ends. The pulls stay the same.
export const IDS = {alma: '9000001', bert: '9000002', cleo: '9000003', dora: '9000004', emil: '9000005', bench: '9000009'};
export const SPEED = 45;              // km/h
const V = SPEED / 3.6;                // m/s
export const T0 = Date.parse('2026-11-01T18:00:00Z');
export const PEN_S = 40;
export const PULL_S = 30;
export const RACE_S = 480;
export const LINE_S = 470;
export const SWITCH_S = 240;
export const JUMP_AT_S = 100;
export const GAP_AT_S = 362;
export const DRAFTED_AT_S = 125;

const rider = (id, name, order, pullS, watts) => ({id, name, order, pullS, watts, color: '#ffffff', colorName: 'White'});

export const PLAN1 = {sig: 'P1TEST', team: 'Testers', targetSpeed: 45, minimumFinishers: 0,
                      riders: [rider(IDS.alma, 'Alma A', 0, 30, 300), rider(IDS.bert, 'Bert B', 1, 30, 300),
                               rider(IDS.cleo, 'Cleo C', 2, 30, 300), rider(IDS.dora, 'Dora D', 3, 30, 300)],
                      bench: [{id: IDS.bench, name: 'Benno B'}]};
export const PLAN2 = {...PLAN1, sig: 'P2TEST',
                      riders: [...PLAN1.riders.slice(0, 3), rider(IDS.dora, 'Dora D', 3, 40, 300), rider(IDS.emil, 'Emil E', 4, 30, 300)],
                      bench: []};

const ORDER = [IDS.alma, IDS.bert, IDS.cleo, IDS.dora];

export const SWAP_AT_S = 180;
// The front with chaos: [race second it starts, rider].
export const CHAOS_FRONTS = [[0, IDS.alma], [30, IDS.bert], [60, IDS.cleo], [90, IDS.dora], [120, IDS.alma], [150, IDS.dora],
                             [190, IDS.alma], [230, IDS.dora], [270, IDS.alma], [300, IDS.bert], [330, IDS.cleo],
                             [360, IDS.dora], [390, IDS.alma], [420, IDS.bert], [450, IDS.cleo]];
export const CHAOS_FROM_S = 265;
export const CHAOS_TO_S = 335;

// The true front rider s seconds after the roll-off (s >= 0).
export function frontAt(s, {swap = false, chaos = false} = {}) {
    if (chaos) {
        return CHAOS_FRONTS.filter(([at]) => at <= s).at(-1)[1];
    }
    if (swap && s >= SWAP_AT_S && s < SWAP_AT_S + 60) {
        const d = s - SWAP_AT_S;
        return d < 20 ? IDS.cleo : d < 30 ? IDS.dora : d < 42 ? IDS.cleo : IDS.dora;
    }
    return ORDER[Math.floor(s / PULL_S) % ORDER.length];
}


function row(id, {self = false, dist, gap, draft, speed, ts, power = draft ? 250 : 320}) {
    return {id, self, watching: false, age: 100, gap: 0, gapDistance: gap, power, draft, speed,
            distance: dist, eventDistance: dist, worldTime: ts, grade: 0, altitude: 10, x: 0, y: 0, roadId: 1,
            reverse: false, courseId: 6};
}


export function makeRecording({stripE = false, afterLine = false, draftIntoDrop = false, swap = false, emilLeavesS = null,
                               chaos = false, cdOld = null, easeOffS = 0, shadow = false} = {}) {
    const front = s => frontAt(s, {swap, chaos});
    const switchS = chaos ? Infinity : SWITCH_S;
    const head = {kind: 'paceline-recording', v: 1, sessionId: String(T0), startedAt: T0, planSig: PLAN1.sig,
                  team: PLAN1.team, selfId: IDS.bert, selfName: 'Bert B', version: '0.3.0-test', plan: PLAN1};
    const lines = [JSON.stringify(head)];
    const endM = V * LINE_S;
    for (let k = 0; k <= PEN_S + RACE_S; k++) {
        const ts = T0 + k * 1000;
        const s = k - PEN_S;                  // seconds since the roll-off
        const moving = s >= 0;
        const base = moving ? V * s : 0;      // the front rider's distance
        const speed = moving ? SPEED : 0;
        // The line: front rider first, then the others in plan order after him, 2 m apart.
        const f = moving ? ORDER.indexOf(front(s)) : 0;
        const line = ORDER.map((_, j) => ORDER[(f + j) % ORDER.length]);
        const pos = {};
        line.forEach((id, j) => {
            pos[id] = base - 2 * j;
        });
        let doraDraft = null;
        if (moving && s >= GAP_AT_S && s < GAP_AT_S + 12 && line.at(-1) === IDS.dora) {
            pos[IDS.dora] -= 15;
            doraDraft = 0;
        }
        if (draftIntoDrop && moving && s >= 121 && s < 150 && line.at(-1) === IDS.dora) {
            const [off, draft] = s < 129 ? [12, 110] : s < 141 ? [5, 60] : [13, 0];
            pos[IDS.dora] -= off;
            doraDraft = draft;
        } else if (moving && s >= DRAFTED_AT_S && s < DRAFTED_AT_S + 10 && line.at(-1) === IDS.dora) {
            pos[IDS.dora] -= 14;
            doraDraft = 110;
        }
        const me = pos[IDS.bert];
        const riders = ORDER.map(id => row(id, {
            self: id === IDS.bert, dist: Math.max(0, pos[id]), gap: -(pos[id] - me), speed, ts,
            draft: !moving ? 0 : id === line[0] ? 0 : id === IDS.dora && doraDraft !== null ? doraDraft : 120,
            ...(moving && id === line[0] && s % PULL_S >= PULL_S - easeOffS ? {power: 100} : {}),
        }));
        riders.push(row(IDS.bench, {dist: Math.max(0, base - 30), gap: -(base - 30 - me), draft: 80, speed, ts}));
        if (s >= switchS && !stripE && !(emilLeavesS !== null && s >= emilLeavesS)) {
            riders.push(row(IDS.emil, {dist: base - 400, gap: -(base - 400 - me), draft: 0, speed, ts}));
        }
        const sig = s >= switchS ? PLAN2.sig : PLAN1.sig;
        let truth = moving ? front(Math.max(0, s - 2)) : null;
        const past = moving && me >= endM;
        const finish = moving && endM - me <= 500 && !(afterLine && past);
        let gapShown = moving && s >= GAP_AT_S + 5 && s < GAP_AT_S + 11 ?
            {kind: 'one', id: IDS.dora, m: 15, s: 1.2, n: 1, critical: true, mine: false, behind: false, level: 'early'} : null;
        if (afterLine && past && s >= LINE_S + 3) {
            truth = IDS.cleo;
            gapShown = s < LINE_S + 5 ? {kind: 'one', id: IDS.dora, m: 31, s: 2.5, n: 1, critical: true, mine: false, behind: false, level: 'full'} : null;
        }
        // My countdown: seconds to my next pull start (front Bert), with one jump.
        let act;
        if (!moving) {
            act = {k: 'none'};
        } else if (finish || past) {
            act = {k: 'none'};
        } else if (front(s) === IDS.bert) {
            act = {k: 'pull', t: PULL_S - (s % PULL_S), over: false, w: 300, pos: 0.5};
        } else {
            // My pulls start at 30 + 120 m s; from JUMP_AT_S to my next pull the clock is 10 s low.
            const next = PULL_S + PULL_S * 4 * Math.max(0, Math.ceil((s - PULL_S) / (PULL_S * 4)));
            const low = s >= JUMP_AT_S && JUMP_AT_S > next - PULL_S * 4 ? 10 : 0;
            const t = Math.max(0, next - s - low);
            act = {k: t <= 10 ? 'next' : 'rest', t, place: 2};
        }
        const liveChaos = chaos === 'live' && moving && s >= CHAOS_FROM_S && s < CHAOS_TO_S;
        if (liveChaos && !finish && act.k !== 'pull') {
            act = {k: 'chaos'};
        }
        const tick = {ts, wt: ts, selfId: IDS.bert, watchingId: null, riders,
                      det: {planSig: sig, puller: truth, since: null, frontId: line[0], self: null, finish,
                            view: act.k === 'pull' ? 'pull' : act.k === 'none' ? 'dash' : act.k, reason: null, wheel: null,
                            wheelObs: null, place: null, placeObs: null, chainSize: 4, alone: false, gate: true, climb: false,
                            descent: false, hill: null, routePos: null, gap: gapShown},
                      shown: {act, meanW: 280, wheel: null, next: null}};
        if (cdOld !== null) {
            tick.det.cdOld = act.k === 'rest' || act.k === 'next' ? {t: act.t + cdOld, standing: false} : null;
        }
        if (chaos === 'live') {
            tick.det.order = {chaos: liveChaos, out: []};
            if (liveChaos && !finish) {
                tick.det.reason = 'chaos';
            }
        }
        if (shadow) {
            // The old core's det beside the windows' own: cd is the countdown it would show.
            tick.det.old = {puller: tick.det.puller, since: tick.det.since, frontId: tick.det.frontId, reason: tick.det.reason,
                            chaos: liveChaos, out: [],
                            cd: act.k === 'rest' || act.k === 'next' ? {t: act.t + (cdOld ?? 0), standing: false} : null};
            delete tick.det.order;
            delete tick.det.cdOld;
            if (tick.det.reason === 'chaos') {
                tick.det.reason = null;
            }
        }
        if (k === 0) {
            tick.event = {sgId: 1, found: true, eventId: 2, name: 'Test TTT', eventType: 'TEAM_TIME_TRIAL', endDistance: endM, laps: 1};
        }
        lines.push(JSON.stringify(tick));
    }
    return lines.join('\n') + '\n';
}
