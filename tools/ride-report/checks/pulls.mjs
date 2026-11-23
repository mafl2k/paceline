// Check 2, ground truth pulls: who was really in front, from the riders' own data. Per second the
// front rider is the plan rider (or I) with fresh data, no draft, race speed and another plan rider
// near who is furthest along. Runs of the same front rider (short holes bridged) make the pulls.
import {FRESH_MS} from '../ride.mjs';
import {FINISH_M} from '../../../pages/src/engine/rotation.mjs';
import {median, num, pct} from '../util.mjs';

export const FRONT_DRAFT_W = 5;      // at most this draft: nobody's wheel
export const FRONT_MIN_KMH = 20;     // faster than this: racing, not a stop
export const BRIDGE_MS = 4000;       // holes up to this keep a run going
export const MIN_PULL_MS = 8000;     // shorter runs are no pull
export const MERGE_MS = 15000;       // two runs of one rider this close are one pull
export const SWAP_FRAC = 0.5;        // a stint shorter than this share of the plan pull is a swap fragment
export const SWAP_MAX = 2;           // in a swap turn each rider's stints add up to at most this × his plan pull
// The front rider has another plan rider (or me) with fresh data at most this far away: a dropped
// rider alone has no draft either (12 Nov 2026, one team: while the whole group drafted behind
// someone without data, #4, 1.8 km back on his own, read as a 9 s pull). Wider than the engine's
// chain gap (20 m), so a puller who opens a gap for a moment still counts.
export const GROUP_M = 50;
export const GROUP_AGE_MS = 10000;   // the other rider's data may be this old: it only says where he is

// The front rider per tick (ids), null when no rider qualifies or the tick has no plan.
export function frontPerTick(ride) {
    return ride.ticks.map((t, i) => {
        const plan = ride.planAt(i);
        if (!plan) {
            return null;
        }
        const ids = new Set(plan.riders.map(r => String(r.id)));
        const mine = t.riders.filter(r => (ids.has(String(r.id)) || r.self === true) && Number.isFinite(r.eventDistance));
        const near = mine.filter(r => (r.age ?? 0) <= GROUP_AGE_MS);
        const c = mine.filter(r => (r.age ?? 0) <= FRESH_MS && Number.isFinite(r.draft) && r.draft <= FRONT_DRAFT_W &&
            r.speed > FRONT_MIN_KMH && near.some(o => o !== r && Math.abs(o.eventDistance - r.eventDistance) <= GROUP_M));
        c.sort((a, b) => b.eventDistance - a.eventDistance);
        return c.length ? String(c[0].id) : null;
    });
}


// Pulls between `from` and `to` (ms): [{id, start, end, s, i0, i1}] (tick indices inclusive).
export function pullsOf(ride, front, {from, to}) {
    const seg = [];
    ride.ticks.forEach((t, i) => {
        const id = front[i];
        if (t.ts < from || t.ts > to || !id) {
            return;
        }
        const s = seg.at(-1);
        if (s && s.id === id && t.ts - s.end <= BRIDGE_MS) {
            s.end = t.ts;
            s.i1 = i;
        } else {
            seg.push({id, start: t.ts, end: t.ts, i0: i, i1: i});
        }
    });
    const pulls = [];
    for (const s of seg.filter(x => x.end - x.start >= MIN_PULL_MS)) {
        const p = pulls.at(-1);
        if (p && p.id === s.id && s.start - p.end <= MERGE_MS) {
            p.end = s.end;
            p.i1 = s.i1;
        } else {
            pulls.push({...s});
        }
    }
    for (const p of pulls) {
        p.s = (p.end - p.start) / 1000;
    }
    return pulls;
}


// Back-and-forth at the front: two riders who swap the front several times within one turn
// (17 Nov 2026: #4 and #5 swapped five times, which gave #5 stints of 9, 20 and 21 s and pulled his
// median to -31 s while he rode about 90 s for a 60 s plan). The stints stay as they are: they are
// who was really in front each second, which the puller check judges by, and the countdown needs
// pulls that follow each other in time. Only the pull lengths count them together: within one
// swap turn a rider's stints are one pull (their sum), and the turn ends when the front passes to
// a third rider. Chosen over leaving the short stints out of the medians: that would drop #5's
// whole turn (9 + 20 + 21 s, each under half his plan) and keep only #4's 42 s of 42 + 20, so both
// riders' pulls would still read short.
// A swap turn: a maximal run of at least three stints that alternate between the same two riders,
// each within MERGE_MS of the one before, with at least one stint shorter than SWAP_FRAC of the
// rider's plan pull (two full pulls each are a rotation of two, not a swap) and neither rider over
// SWAP_MAX × his plan in all (a team down to two riders alternates all race long). planS(p): the
// plan pull of the stint's rider, null when unknown. Sets p.swap = 1, 2, ... on the stints of each
// turn; returns the number of turns.
export function markSwaps(pulls, planS) {
    let n = 0;
    let k = 0;
    const linked = j => pulls[j].id !== pulls[j - 1].id && pulls[j].start - pulls[j - 1].end <= MERGE_MS;
    while (k < pulls.length) {
        let m = k;
        while (m + 1 < pulls.length && linked(m + 1) && (m === k || pulls[m + 1].id === pulls[m - 1].id)) {
            m++;
        }
        const run = pulls.slice(k, m + 1);
        const sums = new Map();
        for (const p of run) {
            sums.set(p.id, (sums.get(p.id) || 0) + p.s);
        }
        const ok = run.length >= 3 && run.every(p => Number.isFinite(planS(p))) &&
            run.some(p => p.s < SWAP_FRAC * planS(p)) &&
            run.every(p => sums.get(p.id) <= SWAP_MAX * planS(p));
        if (ok) {
            n++;
            for (const p of run) {
                p.swap = n;
            }
            k = m + 1;
        } else {
            // A run that is no swap turn has no shorter one inside: go on from its last stint.
            k = m > k ? m : k + 1;
        }
    }
    return n;
}


// A rider's turns: his stints, those within one swap turn as one ({start, end, s, k0, k1, swap}:
// start of the first stint, end of the last, s their sum, k0/k1 indices into pulls).
export function turnsOf(pulls, id) {
    const out = [];
    pulls.forEach((p, k) => {
        if (p.id !== id) {
            return;
        }
        const t = out.at(-1);
        if (t && p.swap && t.swap === p.swap) {
            t.end = p.end;
            t.s += p.s;
            t.k1 = k;
        } else {
            out.push({id, start: p.start, end: p.end, s: p.s, k0: k, k1: k, swap: p.swap ?? null});
        }
    });
    return out;
}


// In the finish sprint at tick i: det.finish as recorded, else (no det) within FINISH_M of the line.
export function inSprint(ride, i) {
    const d = ride.ticks[i]?.det;
    if (d && typeof d.finish === 'boolean') {
        return d.finish;
    }
    const e = ride.finish?.endM;
    const m = ride.meRows[i]?.eventDistance;
    return Number.isFinite(e) && Number.isFinite(m) && m >= e - FINISH_M;
}


// The front rider by the pulls (the truth the puller is judged by): per tick the pull it lies in.
export function truthPerTick(ride, pulls) {
    const out = new Array(ride.ticks.length).fill(null);
    for (const p of pulls) {
        for (let i = p.i0; i <= p.i1; i++) {
            out[i] = p.id;
        }
    }
    return out;
}


export function groundTruth(ride, {from, to}) {
    const front = frontPerTick(ride);
    // Pulls that start in the finish sprint (finish mode: the countdown and the rotation are muted
    // by design) are listed apart and left out of checks 2, 3 and 4.
    const all = pullsOf(ride, front, {from, to});
    const pulls = all.filter(p => !inSprint(ride, p.i0));
    const sprint = all.filter(p => inSprint(ride, p.i0));
    const third = (to - from) / 3;
    const L = ride.labels;
    let raceTicks = 0;
    let unseen = 0;
    let noPlan = 0;
    ride.ticks.forEach((t, i) => {
        if (t.ts < from || t.ts > to) {
            return;
        }
        raceTicks++;
        if (!ride.planAt(i)) {
            noPlan++;
        } else if (!front[i]) {
            unseen++;
        }
    });
    const planSOf = p => {
        const plan = ride.planAt(p.i0);
        return plan?.riders.find(r => String(r.id) === p.id)?.pullS ?? null;
    };
    const swaps = markSwaps(pulls, planSOf);
    const list = pulls.map((p, k) => {
        const plan = ride.planAt(p.i0);
        const planS = planSOf(p);
        return {who: L(p.id), id: p.id, start: p.start, end: p.end, s: num(p.s), planS, sig: plan?.sig ?? null,
                overS: planS === null ? null : num(p.s - planS), first: k === 0,
                third: Math.min(2, Math.floor((p.start - from) / third)), swap: p.swap ?? null, i0: p.i0};
    });
    // The pulls as the riders rode them: a swap turn's stints of one rider are one pull, the two
    // riders of a swap turn in plan order (from the rider before the turn), so the order check sees
    // a normal change into and out of it.
    const turns = [];
    for (let k = 0; k < list.length; k++) {
        const p = list[k];
        if (!p.swap) {
            turns.push({...p, stints: 1});
            continue;
        }
        let m = k;
        while (m + 1 < list.length && list[m + 1].swap === p.swap) {
            m++;
        }
        const run = list.slice(k, m + 1);
        const plan = ride.planAt(p.i0);
        const ids = plan ? plan.riders.map(r => String(r.id)) : [];
        const prev = turns.at(-1);
        const pos = id => (ids.indexOf(id) - (prev ? ids.indexOf(prev.id) : 0) + ids.length) % ids.length;
        const riders = [...new Set(run.map(x => x.id))].sort((a, b) => pos(a) - pos(b));
        for (const id of riders) {
            const own = run.filter(x => x.id === id);
            const s = own.reduce((a, x) => a + x.s, 0);
            const planS = own[0].planS;
            turns.push({...own[0], end: own.at(-1).end, s: num(s), overS: planS === null ? null : num(s - planS),
                        first: own.some(x => x.first), stints: own.length});
        }
        k = m;
    }
    // Per rider: over/under the plan (the first pull of the race is left out: the start bonus and
    // the start chaos), median overall and per race third.
    const per = {};
    for (const p of turns) {
        if (p.first || p.overS === null) {
            continue;
        }
        const r = per[p.who] ??= {who: p.who, n: 0, overs: [], thirds: [[], [], []], planS: new Set()};
        r.n++;
        r.overs.push(p.overS);
        r.thirds[p.third].push(p.overS);
        r.planS.add(p.planS);
    }
    const riders = Object.values(per).map(r => ({
        who: r.who, pulls: r.n, planS: [...r.planS].join('/'), medianOverS: num(median(r.overs)),
        thirds: r.thirds.map(x => (x.length ? num(median(x)) : null)),
        min: num(Math.min(...r.overs)), max: num(Math.max(...r.overs)),
    })).sort((a, b) => a.who.localeCompare(b.who, 'de', {numeric: true}));
    // Order: each change between pulls (swap turns as above) against the plan (the earlier pull's).
    const order = {next: 0, back: 0, skip: 0, skipUnseen: 0, other: 0, changes: []};
    for (let k = 1; k < turns.length; k++) {
        const a = turns[k - 1], b = turns[k];
        const plan = ride.planAt(a.i0);
        const ids = plan ? plan.riders.map(r => String(r.id)) : [];
        const ia = ids.indexOf(a.id), ib = ids.indexOf(b.id);
        let kind = 'other';
        let skipped = [];
        if (ia >= 0 && ib >= 0 && ia !== ib) {
            const d = (ib - ia + ids.length) % ids.length;
            skipped = Array.from({length: d - 1}, (_, j) => ids[(ia + 1 + j) % ids.length]);
            if (d === 1) {
                kind = 'next';
            } else if (d === ids.length - 1 && ids.length > 2) {
                kind = 'back';    // the rider before took the front again
                skipped = [];
            } else if (skipped.every(id => !ride.recorded.get(id))) {
                kind = 'skipUnseen';
            } else {
                kind = 'skip';
            }
        }
        order[kind]++;
        if (kind !== 'next' && kind !== 'skipUnseen') {
            order.changes.push({at: b.start, kind, from: a.who, to: b.who, skipped: skipped.map(L)});
        }
    }
    const swapList = [];
    for (let n = 1; n <= swaps; n++) {
        const st = list.filter(p => p.swap === n);
        swapList.push({at: st[0].start, stints: st.length,
                       riders: turns.filter(t => t.swap === n).map(t => ({who: t.who, stints: t.stints, s: t.s, planS: t.planS}))});
    }
    const overs = riders.map(r => r.medianOverS).filter(Number.isFinite);
    const changes = turns.length - 1;
    const verdict = list.length ?
        `${turns.length} Züge` + (swaps ? ` (${swaps}× Hin und Her an der Spitze: ${list.length} Abschnitte)` : '') + `; Median je Fahrer über Plan ${overs.length ? Math.min(...overs) : '–'}…${overs.length ? Math.max(...overs) : '–'} s; ` +
        `Reihenfolge wie Plan bei ${order.next + order.skipUnseen} von ${changes} Wechseln` +
        (order.skipUnseen ? ` (${order.skipUnseen} über nicht aufgezeichnete Fahrer)` : '') +
        (unseen ? `; vorne nicht sichtbar ${pct(unseen, raceTicks)} % der Zeit` : '') +
        (sprint.length ? `; ${sprint.length} Züge im Zielsprint nicht gezählt` : '') :
        'keine Züge erkannt';
    return {
        verdict,
        rules: {draftW: FRONT_DRAFT_W, minKmh: FRONT_MIN_KMH, groupM: GROUP_M, freshMs: FRESH_MS, minPullS: MIN_PULL_MS / 1000,
                bridgeS: BRIDGE_MS / 1000, mergeS: MERGE_MS / 1000, swapFrac: SWAP_FRAC, swapMax: SWAP_MAX},
        raceTicks, unseenTicks: unseen, noPlanTicks: noPlan,
        pulls: list.map(({id, i0, ...p}) => p), turns: turns.map(({id, i0, ...p}) => p), swaps: swapList, riders, order,
        finishSprint: sprint.map(p => ({who: L(p.id), start: p.start, s: num(p.s)})),
        _pulls: pulls, _front: front,
    };
}
