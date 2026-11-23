// Check 3, puller detection: the engine's puller (det.puller as it ran live, and the current
// engine in the replay) against the ground truth pulls.
import {START_LOCK_MS, HOLD_MS} from '../../../pages/src/engine/rotation.mjs';
import {median, quantile, num, pct} from '../util.mjs';

export const LOCK_MS = 10000;          // a wrong puller held longer than this while the front is someone else
export const SLOW_KMH = 10;            // slower: no rotation to judge
export const AFTER_PAUSE_MS = 20000;   // a lock starting this soon after a pause counts as caused by it
export const HANDOVER_MS = 15000;
export const RUN_HOLE_MS = 3000;       // a longer hole between ticks ends a run of one naming      // a change with a longer unseen stretch between two pulls has no lag

// A pause of the rotation in the tick. Recordings of the old core: a real climb or descent, det.hill
// 'pause' (older versions det.climb). Since the turn clocks (23 Nov 2026; the key `old` or det.turn)
// the rotation runs normally on a real hill and det.hill says 'pause' on every one of them: the
// pause is then only the seconds the climb display was on (det.turn.disp, reason 'climb'/'descent';
// after the hill 'regroup', det.turn.disp.quiet).
export function pausedAt(det) {
    if (!det) {
        return false;
    }
    if (hasShadow(det) || Object.hasOwn(det, 'turn')) {
        return !!det.turn?.disp;
    }
    return Object.hasOwn(det, 'hill') ? det.hill === 'pause' : det.climb === true;
}


// Chaos (20 Nov 2026, spec 2026-11-20-paceline-chaos-counter sections 3 and 6): the engine finds the
// team no longer rides the plan's order and the countdown goes silent; the info window still shows
// the real puller, so these seconds are judged here like normal running. A tick is in chaos by the
// order state: live det.order.chaos (or det.reason 'chaos'; det.view still says 'rest'/'next'
// there), in the replay the engine's state `order`. Recordings before 0.3.4 have no det.order:
// no live phases then (the replay still finds them). Since the windows run on the turn clocks
// (23 Nov 2026) the old core's chaos is recorded in det.old.chaos, and the windows' own reason
// never says 'chaos': with the key `old` (also null after a failed shadow step: then the chaos
// is unknown, not false-from-reason) that is the only source. Older recordings go the old way.
export function liveChaosAt(det) {
    if (!det) {
        return false;
    }
    if (hasShadow(det)) {
        return det.old?.chaos === true;
    }
    return det.order?.chaos === true || det.reason === 'chaos';
}


// A recording of the turn-clock version: detOf always writes the key `old` (null after a failed
// shadow step), older recordings never have it. The key marks the shape, not its value.
const hasShadow = det => !!det && Object.hasOwn(det, 'old');


// The old core's fields of a tick: det.old with the turn clocks (the replay runs the old core, so
// the fidelity compares with it), else the top-level det of an older recording, which is the old
// core's. Null without det, and null after a failed shadow step (no old core to compare with).
function oldCoreOf(det) {
    return !det ? null : hasShadow(det) ? det.old : det;
}


// The same for a replay frame: the engine's order state, which a climb or descent pause in chaos
// keeps (the reason is 'climb' then, but the phase goes on).
export function replayChaosAt(frame) {
    return !!frame && !frame.skipped && frame.rot?.order?.chaos === true;
}


// The chaos phases in rows [{ts, chaos, finish, sig}] (the race window's ticks in order): runs of
// chaos ticks outside finish mode, and how each ended: 'order' (changes in the plan's order again),
// 'plan' (a new plan code: the order state starts over), 'finish' (finish mode; the state is kept
// there, but the windows show the final sprint) or 'end' (the race window ended).
export function chaosPhases(rows) {
    const out = [];
    let a = null;
    rows.forEach((r, i) => {
        const on = r.chaos && !r.finish;
        if (on && a === null) {
            a = i;
        }
        if (a === null || (on && i + 1 < rows.length)) {
            return;
        }
        const last = on ? i : i - 1;
        const next = on ? null : r;
        const endedBy = !next ? 'end' : next.sig !== rows[last].sig ? 'plan' : next.finish ? 'finish' : 'order';
        out.push({from: rows[a].ts, to: rows[last].ts, s: num((rows[last].ts - rows[a].ts) / 1000 + 1), endedBy});
        a = null;
    });
    return out;
}


function judge(ride, truth, pullerOf, {from, to, excluded}) {
    let judged = 0, agree = 0, unseen = 0, unseenNamed = 0;
    const bad = [];
    ride.ticks.forEach((t, i) => {
        if (t.ts < from || t.ts > to || excluded[i]) {
            return;
        }
        const e = pullerOf(i);
        if (truth[i] === null) {
            unseen++;
            if (e != null && !ride.recorded.get(String(e))) {
                unseenNamed++;
            }
            return;
        }
        judged++;
        if (e === truth[i]) {
            agree++;
        } else {
            bad.push(i);
        }
    });
    return {judged, agree, unseen, unseenNamed, bad};
}


// Runs where one wrong puller is held while the truth names someone else (ticks without truth do
// not break a run, excluded ticks do).
function locks(ride, truth, pullerOf, {from, to, excluded}) {
    const out = [];
    let run = null;
    const close = () => {
        if (run && run.b - run.a + 1000 > LOCK_MS) {
            out.push(run);
        }
        run = null;
    };
    ride.ticks.forEach((t, i) => {
        if (t.ts < from || t.ts > to || excluded[i]) {
            close();
            return;
        }
        if (truth[i] === null) {
            return;
        }
        const e = pullerOf(i);
        if (e !== truth[i] && e != null) {
            if (run && run.puller !== e) {
                close();
            }
            if (!run) {
                run = {puller: e, a: t.ts, b: t.ts, i0: i, truths: new Set()};
            }
            run.b = t.ts;
            run.truths.add(truth[i]);
        } else {
            close();
        }
    });
    close();
    return out;
}


// Lag at each change: when the engine's naming of the new puller settled, against the true start.
// Settled = the start of the run of ticks naming him that covers the middle of his pull (the
// naming that stuck), else the first run starting during his pull that lasts HOLD_MS. A brief
// naming that the engine left again does not count. Negative: the engine named him for good
// before the truth (no limit). null: never settled during his pull. A change with more than
// HANDOVER_MS unseen between the two pulls (someone without data in front) has no measurable lag
// (unseen: true).
function lags(ride, pulls, pullerOf) {
    const out = [];
    const ts = i => ride.ticks[i].ts;
    for (let k = 1; k < pulls.length; k++) {
        const prev = pulls[k - 1], p = pulls[k];
        if (p.start - prev.end > HANDOVER_MS) {
            out.push({at: p.start, to: p.id, lagS: null, unseen: true});
            continue;
        }
        // A run of ticks naming him ends at a hole of more than RUN_HOLE_MS between ticks.
        const joined = j => ts(j) - ts(j - 1) <= RUN_HOLE_MS;
        const runStart = i => {
            let j = i;
            while (j > 0 && pullerOf(j - 1) === p.id && joined(j)) {
                j--;
            }
            return j;
        };
        let at = null;
        const mid = p.start + (p.end - p.start) / 2;
        const im = ride.ticks.findIndex((t, i) => i >= p.i0 && t.ts >= mid);
        if (im >= 0 && pullerOf(im) === p.id) {
            at = ts(runStart(im));
        } else {
            for (let i = p.i0; i <= p.i1 && at === null; i++) {
                if (pullerOf(i) !== p.id || (i > p.i0 && pullerOf(i - 1) === p.id)) {
                    continue;
                }
                let j = i;
                while (j + 1 < ride.ticks.length && pullerOf(j + 1) === p.id && joined(j + 1)) {
                    j++;
                }
                if (ts(j) - ts(i) >= HOLD_MS) {
                    at = ts(runStart(i));
                }
            }
        }
        out.push({at: p.start, to: p.id, lagS: at === null ? null : (at - p.start) / 1000});
    }
    return out;
}


export function pullerCheck(ride, gt, frames, {from, to, rollOff}) {
    const {ticks, meRows} = ride;
    if (!ticks.some(t => t.det)) {
        return {skipped: 'keine det-Felder in der Aufzeichnung', verdict: 'entfällt (keine det-Felder)'};
    }
    const truth = new Array(ticks.length).fill(null);
    for (const p of gt._pulls) {
        for (let i = p.i0; i <= p.i1; i++) {
            truth[i] = p.id;
        }
    }
    const L = ride.labels;
    const why = {lock: 0, finish: 0, pause: 0, alone: 0, slow: 0, nodet: 0, noplan: 0};
    const excluded = ticks.map((t, i) => {
        const d = t.det;
        const reason = !ride.planAt(i) ? 'noplan' : !d ? 'nodet' : t.ts < rollOff + START_LOCK_MS ? 'lock' :
            d.finish ? 'finish' : pausedAt(d) ? 'pause' : d.alone === true ? 'alone' :
            !(meRows[i]?.speed >= SLOW_KMH) ? 'slow' : null;
        if (reason && t.ts >= from && t.ts <= to) {
            why[reason]++;
        }
        return !!reason;
    });
    const live = i => ticks[i].det?.puller ?? null;
    const rep = i => (frames[i].skipped ? null : frames[i].rot.front.puller ?? null);
    const J = judge(ride, truth, live, {from, to, excluded});
    const JR = judge(ride, truth, rep, {from, to, excluded});
    const lagList = lags(ride, gt._pulls, live);
    const lagS = lagList.filter(l => !l.unseen).map(l => l.lagS).filter(Number.isFinite);
    const lockList = locks(ride, truth, live, {from, to, excluded});
    const repLocks = locks(ride, truth, rep, {from, to, excluded});
    // Pauses: what the puller was before and after, and whether it was right soon after.
    const pauses = [];
    let cur = null;
    ticks.forEach((t, i) => {
        const on = t.ts >= from && t.ts <= to && pausedAt(t.det);
        if (on && !cur) {
            cur = {i0: i, i1: i, descent: false};
        }
        if (on) {
            cur.i1 = i;
            cur.descent ||= t.det.descent === true || t.det.reason === 'descent';
        }
        if (!on && cur) {
            pauses.push(cur);
            cur = null;
        }
    });
    if (cur) {
        pauses.push(cur);
    }
    const pauseList = pauses.map(p => {
        const a = ticks[p.i0].ts, b = ticks[p.i1].ts;
        const after = p.i1 + 1 < ticks.length ? p.i1 + 1 : p.i1;
        let settled = null;
        for (let i = after; i < ticks.length && ticks[i].ts <= b + 60000; i++) {
            if (truth[i] !== null && live(i) === truth[i]) {
                settled = (ticks[i].ts - b) / 1000;
                break;
            }
        }
        const truthAfter = truth.slice(after, after + 15).find(x => x !== null) ?? null;
        const lock = lockList.find(l => l.a >= b && l.a - b <= AFTER_PAUSE_MS);
        return {from: a, s: num((b - a) / 1000 + 1), kind: p.descent ? 'Abfahrt' : 'Anstieg',
                km: num((meRows[p.i0]?.eventDistance ?? NaN) / 1000, 2),
                pullerBefore: L(live(Math.max(0, p.i0 - 1))), pullerAfter: L(live(after)), truthAfter: L(truthAfter),
                rightAfterS: settled === null ? null : num(settled), lockAfterS: lock ? num((lock.b - lock.a) / 1000 + 1) : null};
    });
    for (const l of lockList) {
        l.afterPause = pauses.some(p => l.a >= ticks[p.i1].ts && l.a - ticks[p.i1].ts <= AFTER_PAUSE_MS);
    }
    // How faithful the replay is, per plan: replay puller == live puller, and the front rider
    // (frontId: only the riders' positions, no history). A front below ~99 % means the recording
    // lacks rows the live engine had (a stripped upload), and the replay cannot follow there.
    const fid = {};
    ticks.forEach((t, i) => {
        if (t.det && !frames[i].skipped && oldCoreOf(t.det)) {
            const f = fid[ride.sigs[i]] ??= {sig: ride.sigs[i], n: 0, puller: 0, front: 0};
            f.n++;
            const o = oldCoreOf(t.det);
            f.puller += (o.puller ?? null) === rep(i) ? 1 : 0;
            f.front += (o.frontId ?? null) === (frames[i].rot.frontId ?? null) ? 1 : 0;
        }
    });
    // With --plan-all the replay runs another plan than live where the live code differs: then a
    // different front is the plan's doing (other riders count), not missing rows.
    const fidelity = Object.values(fid).map(f => ({sig: f.sig, ticks: f.n, pullerPct: pct(f.puller, f.n), frontPct: pct(f.front, f.n),
                                                   otherPlan: !!ride.planAllSig && f.sig !== ride.planAllSig}));
    const missingRows = fidelity.filter(f => f.frontPct < 99 && !f.otherPlan);
    const otherPlan = fidelity.filter(f => f.otherPlan);
    const lockOut = ls => ls.map(l => ({from: l.a, s: num((l.b - l.a) / 1000 + 1), puller: L(l.puller),
                                        front: [...l.truths].map(L).join('/'),
                                        km: num((meRows[l.i0]?.eventDistance ?? NaN) / 1000, 2), afterPause: !!l.afterPause}));
    // Chaos phases, live and replay, and how the seconds in them were judged (normal running).
    const inRace = i => ticks[i].ts >= from && ticks[i].ts <= to;
    const liveOn = ticks.map(t => liveChaosAt(t.det));
    const repOn = frames.map(replayChaosAt);
    const rowsOf = (on, finish, sig) => ticks.map((t, i) => (inRace(i) ? {ts: t.ts, chaos: on[i], finish: finish(i), sig: sig(i)} : null))
        .filter(Boolean);
    const liveRecorded = ticks.some(t => t.det && (hasShadow(t.det) || Object.hasOwn(t.det, 'order')));
    const chaosJudged = (on, pullerOf) => {
        const x = judge(ride, truth, pullerOf, {from, to, excluded: excluded.map((e, i) => e || !on[i])});
        return {s: x.judged, agreePct: pct(x.agree, x.judged)};
    };
    const chaos = {
        liveRecorded,
        live: chaosPhases(rowsOf(liveOn, i => ticks[i].det?.finish === true, i => ride.sigs[i])),
        replay: chaosPhases(rowsOf(repOn, i => !!frames[i].rot?.finish, i => frames[i].plan?.sig ?? null)),
        judged: {live: chaosJudged(liveOn, live), replay: chaosJudged(repOn, rep)},
    };
    const out = {
        judgedTicks: J.judged, excluded: why,
        live: {...(ticks.some(t => hasShadow(t.det)) ? {core: 'new'} : {}),
               agreePct: pct(J.agree, J.judged), wrongS: J.bad.length, unseenTicks: J.unseen, unseenNamedUnrecorded: J.unseenNamed,
               // Over the whole recording: ticks whose live puller has no rows at all (stripped riders).
               unrecordedPullerTicks: ticks.filter(t => t.det?.puller != null && !ride.recorded.get(String(t.det.puller))).length,
               lagMedianS: num(median(lagS)), lagP90S: num(quantile(lagS, 0.9)), changes: lagList.length,
               missedChanges: lagList.filter(l => l.lagS === null && !l.unseen).length,
               unseenChanges: lagList.filter(l => l.unseen).length,
               lags: lagList.map(l => ({at: l.at, to: L(l.to), lagS: num(l.lagS), unseen: !!l.unseen})), locks: lockOut(lockList)},
        replay: {agreePct: pct(JR.agree, JR.judged), wrongS: JR.bad.length, locks: lockOut(repLocks),
                 fidelity},
        pauses: pauseList,
        chaos,
    };
    out.verdict = `live ${out.live.agreePct ?? '–'} % richtig (${out.live.wrongS} s falsch), Verzug Median ${out.live.lagMedianS ?? '–'} s ` +
        `(p90 ${out.live.lagP90S ?? '–'} s), ${lockList.length} Hänger > 10 s` +
        (lockList.filter(l => l.afterPause).length ? ` (${lockList.filter(l => l.afterPause).length} nach einer Pause)` : '') +
        `; heutige Engine im Replay ${out.replay.agreePct ?? '–'} %` +
        (missingRows.length ? ` (Replay unvollständig: ${missingRows.map(f => `${f.sig} Front ${f.frontPct} %`).join(', ')})` : '') +
        (otherPlan.length ? ` (Replay mit ${ride.planAllSig}, live lief ${otherPlan.map(f => f.sig).join(', ')}: dort nicht mit live vergleichbar)` : '');
    const phases = (xs, label) => (xs.length ? `${label} ${xs.length} Phase${xs.length > 1 ? 'n' : ''} (${xs.reduce((a, x) => a + x.s, 0)} s)` : null);
    const chaosText = [phases(chaos.live, 'live'), phases(chaos.replay, 'Replay')].filter(Boolean);
    if (chaosText.length) {
        out.verdict += `; Chaos: ${chaosText.join(', ')}`;
    }
    return out;
}
