// ?demo in a plain browser: fake Sauce's `nearby` data for the riders of a plan, so the overlay
// and its recorder can be watched without Zwift. Only paceline.mjs calls this, and only when
// isDemo() is true. `?demo=<s>` starts that many seconds into the timeline.
//
// The self rider is the plan's first rider. The team rotates in plan order (the leader swings to
// the back); each pull is a scripted segment, and the timeline shows every case of my own pull:
//   A  the rider before me pulls 3 s over his plan (NEXT), I ramp up and take over (jump start,
//      confirmed when my draft drops to 0), pull 30 s and drop to ~80 W for 2 s, still in front
//      for a few seconds (drop end); at the end of that round the rider two before me pulls
//      OVER_STAND_S over his plan, so my countdown waits for the change (the standing clock, ≥);
//   B  the rider before me pulls 9 s over; in his last 10 s I surge for 4 s but stay on his wheel
//      (the pending start is never confirmed and is dropped unseen), then he swings aside and I
//      lead without a jump (draft start: my draft is 0 before the positions show it);
//   C  the two riders before me are dropped, the one in front of them is passed through early:
//      I ramp while still on his wheel and pass him 5 s later (early start by sustained power);
//      later a climb at 5 %: without a route profile a roller for its first 45 s (the rotation
//      goes on), then a real climb. There the rider before the climber jumps the queue to the
//      front, which breaks the order: the windows show ▲ until the top. Over the top he leads on
//      (regroup, quiet) until he is a clear puller and the rotation goes on from him;
//      the last FINISH_LAST_S of the team ride are the final sprint (my entry's `remaining`
//      counts down to the finish, and is within 500 m from then on).
// Gaps in the line (gaps.mjs): in my first pull the whole group lets GAP_M open behind me, in my
// second one the last rider drifts to EARLY_M (the early stage) and from LATE_AT_S on drops GAP_M:
// with five still in front his drop is acceptable, so the band is amber (user, 24 Nov 2026); in my
// last one (in C, four left) the last rider drops GAP_M (red), and in the pull after my first one
// I (now last) do. Each gap opens within
// GAP_RAMP_S and closes again over GAP_CLOSE_S, the rider behind faster by what it takes, so it
// shows green while it closes (user, 17 Nov 2026).
// After each of my pulls I drift back to the end of the line over DRIFT_S.
// Then 130 s with only the self rider left (past the finish: the rotation shows Finish, since
// finish mode stays on until I stand still or the next round's distance shows), so the recorder's
// stop (120 s without 2 team riders) shows up, and the timeline repeats.
//
// Like real Sauce data, every entry is a sample of a slightly different moment: an entry with
// age `a` reports worldTime = now - a and the distance its rider had then. gapDistance is the
// self rider's sampled distance minus that, so moving each sample forward at its speed (as the
// rotation engine does) recovers the true order.
const SPEED_MS = 12;
const SPACING_M = 2;
const DROPPED_M = 100;     // dropped riders ride this far behind (outside the team chain)
const OTHER_PULL_S = 20;
const MY_PULL_S = 30;
const OVER_A_S = 3;        // the rider before me pulls this much over his plan in A ...
const OVER_B_S = 9;        // ... and in B
const SURGE_S = 4;
const RAMP_LEAD_S = 2;     // I ramp this long before the rider in front swings off
const SOFT_LEAD_S = 4;     // B: he swings aside this long before the positions show me in front
const CUT_S = 23;          // C: the passed-through pull, and when in it I ramp
const CUT_RAMP_S = 18;
const OVER_STAND_S = 24;    // the rider two before me pulls this much over his plan (standing clock)
const CLIMB_S = 58;        // a roller for ROLLER_LIVE_MS (45 s) after 5 s at the grade, then real
const BREAK_S = 20;        // on the real climb another rider leads this long (the order breaks: ▲)
const REGROUP_S = 14;      // ... and over the top on, until he is a clear puller
const CLIMB_GRADE = 0.05;  // Sauce gives the grade as a fraction
const ALONE_S = 130;
const FINISH_LAST_S = 30;
const FINISH_AT_M = 500;
const SUBGROUP_ID = 4242;
const DEFAULT_WATTS = 250;
const DEFAULT_PULL_S = 30;
const GAP_M = 14;          // a gap in the line opens to this ...
const EARLY_M = 7;         // ... or only to this (the early stage; plus the 2 m spacing)
const LATE_AT_S = 12;      // my second pull: the early stage first, from here on the full gap ...
const LATE_PULL_S = 42;    // ... in a pull this long, so the band shows before it closes (my last one too)
const GAP_EDGE_S = 4;      // ... from this long into the pull until this long before its end
const GAP_RAMP_S = 3;
const GAP_CLOSE_S = 10;    // ... and closes again over this long (the rider behind closes it)
const DRIFT_S = 20;        // after my pull I drift back to the end of the line this long


function rand(min, max) {
    return min + Math.random() * (max - min);
}


function mod(a, n) {
    return ((a % n) + n) % n;
}


// The scripted pulls of one cycle: {lead, dur, out: Set of dropped rider indexes, flags}.
function script(riders) {
    const n = riders.length;
    const pullOf = i => Number.isFinite(riders[i].pullS) ? riders[i].pullS : DEFAULT_PULL_S;
    const segs = [];
    const none = new Set();
    const add = (lead, dur, extra = {}) => segs.push({lead, dur, out: none, ...extra});
    const round = (from, to, extra) => {
        for (let i = from; i <= to; i++) {
            add(i, i === 0 ? MY_PULL_S : Math.min(pullOf(i), OTHER_PULL_S), extra);
        }
    };
    if (n === 1) {
        add(0, MY_PULL_S);
        return segs;
    }
    const before = n - 1;
    // A
    add(before, pullOf(before) + OVER_A_S, {ramp: true});
    round(0, n - 2);
    if (n >= 3) {
        segs.at(-1).dur += OVER_STAND_S;
    }
    // B
    const overB = pullOf(before) + OVER_B_S;
    add(before, overB, {soft: true, surgeAt: Math.max(0, overB - OVER_B_S - 9)});
    if (n < 4) {
        round(0, n - 2);
        return segs;
    }
    // C: riders n-2 and n-1 are dropped; n-3 is passed through.
    round(0, n - 4);
    const out = new Set([n - 2, n - 1]);
    add(n - 3, CUT_S, {out, cut: true});
    add(0, MY_PULL_S, {out});
    add(1, 10, {out});
    const climber = Math.min(2, n - 3);
    add(climber, CLIMB_S, {out, grade: CLIMB_GRADE});
    if (n >= 5) {
        // Rider 1 is neither the climber nor his plan's next (rider 3, or me with 5 riders).
        add(1, BREAK_S, {out, grade: CLIMB_GRADE});
        add(1, REGROUP_S, {out});
    }
    round(climber, n - 2);
    markGaps(segs);
    return segs;
}


// The gap segments: my first pull 'group', my second 'late' (the last rider), my last one 'last'
// (one rider), the first pull of rider 1 'last' (that is me; at least MY_PULL_S long).
function markGaps(segs) {
    const mine = segs.filter(sg => sg.lead === 0);
    if (mine.length) {
        mine[0].gap = 'group';
    }
    if (mine.length > 2) {
        mine[1].gap = 'late';
        mine[1].dur = LATE_PULL_S;
        mine.at(-1).gap = 'last';
        mine.at(-1).dur = LATE_PULL_S;    // the red band (four left) stays before it closes
    }
    const after = segs.find(sg => sg.lead === 1 && !sg.out.size);
    if (after) {
        after.gap = 'last';
        after.dur = Math.max(after.dur, MY_PULL_S);    // long enough to open fully and close slowly
    }
}


// Calls onNearby(list) once per second. Returns a function that stops the demo.
export function startDemo(plan, onNearby) {
    const riders = (plan && plan.riders) || [];
    if (!riders.length) {
        return () => {};
    }
    const n = riders.length;
    const offsetS = Number(new URLSearchParams(location.search).get('demo')) || 0;
    const t0 = Date.now() - offsetS * 1000;
    const wt0 = 1e12;
    const segs = script(riders);
    let teamS = 0;
    for (const sg of segs) {
        sg.from = teamS;
        teamS += sg.dur;
    }
    const cycleS = teamS + ALONE_S;
    const target = Number.isFinite(riders[0].watts) ? riders[0].watts : DEFAULT_WATTS;
    // The segment at s seconds into the demo, and how far into it (u); null when riding alone.
    const segAt = s => {
        const c = mod(s, cycleS);
        const sg = segs.find(x => c >= x.from && c < x.from + x.dur);
        return sg ? {sg, u: c - sg.from} : null;
    };
    // Place in the line (0 = front), counting from the leader; dropped riders have none.
    const slotOf = (i, sg) => {
        if (sg.out.has(i)) {
            return null;
        }
        let k = 0;
        for (let d = 0; d < n; d++) {
            const j = mod(sg.lead + d, n);
            if (j === i) {
                return k;
            }
            if (!sg.out.has(j)) {
                k++;
            }
        }
        return null;
    };
    // How far rider i has dropped back in a gap segment (0 elsewhere).
    const gapBack = (i, s) => {
        const at = segAt(s);
        if (!at || !at.sg.gap) {
            return 0;
        }
        const slot = slotOf(i, at.sg);
        const last = n - at.sg.out.size - 1;
        if (slot === null || !(at.sg.gap === 'group' ? slot >= 1 : slot === last)) {
            return 0;
        }
        const f = Math.min((at.u - GAP_EDGE_S) / GAP_RAMP_S, (at.sg.dur - GAP_EDGE_S - at.u) / GAP_CLOSE_S);
        const late = Math.max(0, Math.min(1, (at.u - LATE_AT_S) / GAP_RAMP_S));
        const m = at.sg.gap === 'late' ? EARLY_M + (GAP_M - EARLY_M) * late : GAP_M;
        return m * Math.max(0, Math.min(1, f));
    };
    const distAt = (i, s) => {
        const at = segAt(s);
        const slot = at ? slotOf(i, at.sg) : 0;
        if (slot === null) {
            return 1000 + s * SPEED_MS - DROPPED_M;
        }
        // Right after my pull I drift back from behind the new puller to my place at the end.
        let line = slot * SPACING_M;
        const k = at && i === 0 ? segs.indexOf(at.sg) : -1;
        if (k > 0 && segs[k - 1].lead === 0 && at.u < DRIFT_S) {
            line = SPACING_M + (line - SPACING_M) * (at.u / DRIFT_S);
        }
        return 1000 + s * SPEED_MS - line - gapBack(i, s);
    };
    // My power at the real time t (one sample per emit, so a 2 s phase gets 2 samples).
    const selfPower = t => {
        const at = segAt(t);
        const rest = target * 0.75 + rand(-15, 15);
        if (!at) {
            return target + 35 * Math.sin(t / 6) + rand(-6, 6);    // alone: as if pulling
        }
        const {sg, u} = at;
        if (sg.grade) {
            return target * 1.05 + rand(-10, 10);
        }
        if (sg.lead === 0) {
            if (u >= sg.dur - 4 && u < sg.dur - 2) {
                return 80 + rand(-5, 5);    // swinging off
            }
            return u < sg.dur - 2 ? target + 35 * Math.sin(t / 6) + rand(-6, 6) : rest;
        }
        if (sg.soft && u >= sg.dur - SOFT_LEAD_S) {
            return target * 0.75 + 25 + rand(-6, 6);    // no jump
        }
        const rampAt = sg.cut ? CUT_RAMP_S : sg.ramp ? sg.dur - RAMP_LEAD_S : Infinity;
        if (u >= rampAt) {
            return (u < rampAt + 1 ? target * 0.92 : target) + rand(-6, 6);
        }
        if (sg.surgeAt !== undefined && u >= sg.surgeAt && u < sg.surgeAt + SURGE_S) {
            return target + 55 + rand(-6, 6);
        }
        return rest;
    };

    const emit = () => {
        const nowMs = Date.now();
        const t = (nowMs - t0) / 1000;
        const now = segAt(t);
        const present = now ? riders.slice() : riders.slice(0, 1);
        const ages = present.map(() => Math.round(rand(300, 1500)));
        const sampleS = ages.map(a => Math.max(0, t - a / 1000));
        const selfDist = distAt(0, sampleS[0]);
        onNearby(present.map((r, i) => {
            const self = i === 0;
            const s = sampleS[i];
            const at = segAt(s);
            const distance = Math.round(distAt(i, s) * 10) / 10;
            const gapDistance = self ? 0 : Math.round((selfDist - distance) * 10) / 10;
            const atFront = !at || slotOf(i, at.sg) === 0;
            // B's soft start: the rider before me has swung aside, so I am in the wind already.
            const inWind = atFront ||
                (self && at.sg.soft && at.u >= at.sg.dur - SOFT_LEAD_S);
            // On the flat my road rolls a little (below 1 %, far from a climb or descent), so the
            // Action window's grade field shows something plausible.
            const grade = at && at.sg.grade ? at.sg.grade : self ? Math.round(0.008 * Math.sin(s / 23) * 1000) / 1000 : 0;
            // Distance to the finish (self only, while the team rides): 500 m FINISH_LAST_S
            // before the end of the team ride.
            const toFinish = self && at ?
                {remaining: Math.max(0, Math.round(FINISH_AT_M + (teamS - FINISH_LAST_S - mod(s, cycleS)) * SPEED_MS)),
                 remainingMetric: 'distance', remainingType: 'event'} : {};
            let power;
            if (self) {
                power = selfPower(t);
            } else if (grade) {
                power = rand(290, 330);
            } else {
                power = atFront ? rand(300, 340) : rand(200, 240);
            }
            return {
                athleteId: Number(r.id),
                self,
                watching: self,
                age: ages[i],
                gap: Math.round(gapDistance / SPEED_MS * 100) / 100,
                gapDistance,
                isGapEst: false,
                eventSubgroupId: SUBGROUP_ID,
                ...toFinish,
                athlete: {sanitizedFullname: r.name},
                state: {
                    power: Math.round(power),
                    draft: inWind ? 0 : gapBack(i, s) > 8 ? Math.round(rand(0, 15)) : Math.round(rand(80, 110)),
                    // Slower while his gap opens, faster while he closes it.
                    speed: Math.round((SPEED_MS - (gapBack(i, s) - gapBack(i, s - 0.5)) / 0.5) * 3.6 * 10) / 10,
                    distance,
                    eventDistance: distance,
                    grade,
                    worldTime: wt0 + Math.round(s * 1000),
                    heartrate: Math.round(atFront ? rand(165, 175) : rand(140, 150)),
                    cadence: Math.round(rand(85, 95)),
                },
            };
        }));
    };
    emit();
    const timer = setInterval(emit, 1000);
    return () => clearInterval(timer);
}
