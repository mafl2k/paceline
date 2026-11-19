// Check 5, gaps in the line: real gaps from the riders' positions, the warnings as shown (det.gap)
// and as the current engine gives them (replay), judged against what followed; closing gaps, a
// drop counter per rider and the critical drops in the last 500 m (muted by design).
import * as G from '../../../pages/src/engine/gaps.mjs';
import {FINISH_M} from '../../../pages/src/engine/rotation.mjs';
import {median, num} from '../util.mjs';

export const REAL_MIN_MS = 5000;       // smoothed gap at or above the warning threshold this long: a real gap
export const REAL_MERGE_MS = 10000;    // real gaps of one rider closer than this are one
export const RAW_M = 8;                // the raw gap a warning is timed against
export const IMPORTANT_MS = 15000;     // a warning is important when the raw gap reaches the threshold within this
export const STABLE_M = 2;             // a warning on a gap that moved no more than this in the 5 s before: stable
export const EXC_START_M = 5;          // closing excursions: from this raw gap
export const EXC_PEAK_M = 6;           // ... peaking at least here
export const EXC_CLOSED_M = 4;         // ... closed below this
export const DRAFT_KEEP_W = 50;        // a real gap of 10 m or more leaves little draft: more (median) = someone unrecorded in between
const PEAKS = [[6, 8], [8, 10], [10, 20], [20, Infinity]];

// Per rider the series of the replay's gap state on active steps: [{now, g, m, hill, ahead, idx}].
function seriesOf(frames) {
    const S = {};
    frames.forEach((fr, idx) => {
        if (fr.skipped || !fr.active) {
            return;
        }
        for (const [id, r] of Object.entries(fr.gaps.riders || {})) {
            (S[id] ??= []).push({now: fr.ts, g: r.g, m: r.m, hill: fr.hill, ahead: r.ahead, idx, critical: r.critical,
                                 draft: fr.rows?.[id]?.draft});
        }
    });
    return S;
}


// Real gaps: the smoothed gap at or above GAP_ON_M (GAP_HILL_ON_M on a hill) for REAL_MIN_MS on
// consecutive active steps, merged when closer than REAL_MERGE_MS. t8/t6: since when the raw gap
// was at least 8/6 m without a break before it.
export function episodes(S) {
    const eps = [];
    for (const [id, xs] of Object.entries(S)) {
        let run = null;
        const close = () => {
            if (run && run.last - run.start >= REAL_MIN_MS) {
                eps.push({id, tReal: run.start, tEnd: run.last, i0: run.i0, i1: run.i1});
            }
            run = null;
        };
        xs.forEach((x, i) => {
            const on = x.hill ? G.GAP_HILL_ON_M : G.GAP_ON_M;
            const contiguous = i > 0 && x.idx === xs[i - 1].idx + 1;
            if (run && !contiguous) {
                close();
            }
            if (x.m >= on) {
                if (!run) {
                    run = {start: x.now, i0: i};
                }
                run.last = x.now;
                run.i1 = i;
            } else {
                close();
            }
        });
        close();
    }
    eps.sort((a, b) => a.id.localeCompare(b.id) || a.tReal - b.tReal);
    const out = [];
    for (const e of eps) {
        const p = out.at(-1);
        if (p && p.id === e.id && e.tReal - p.tEnd < REAL_MERGE_MS) {
            p.tEnd = e.tEnd;
            p.i1 = e.i1;
        } else {
            out.push({...e});
        }
    }
    for (const e of out) {
        const xs = S[e.id];
        const back = th => {
            let i = e.i0;
            while (i > 0 && xs[i - 1].idx === xs[i].idx - 1 && xs[i - 1].g >= th) {
                i--;
            }
            return xs[i].g >= th ? xs[i].now : null;
        };
        e.t6 = back(6);
        e.t8 = back(RAW_M);
        e.maxG = Math.max(...xs.slice(e.i0, e.i1 + 1).map(x => x.g));
        e.hill = xs[e.i0].hill;
        e.critical = xs[e.i0].critical;
        e.draftW = median(xs.slice(e.i0, e.i1 + 1).map(x => x.draft));
    }
    return out.sort((a, b) => a.tReal - b.tReal);
}


// The replay's warnings per rider: [{id, on, off, full, g, m, hill, critical}] (early stage on → off).
function replayWarnings(frames) {
    const open = {};
    const out = [];
    for (const fr of frames) {
        if (fr.skipped) {
            continue;
        }
        const rs = fr.gaps.riders || {};
        for (const [id, r] of Object.entries(rs)) {
            if (r.early && !open[id]) {
                open[id] = {id, on: fr.ts, full: r.open ? fr.ts : null, g: r.g, m: r.m, hill: fr.hill, critical: r.critical};
            }
            if (r.open && open[id] && !open[id].full) {
                open[id].full = fr.ts;
            }
        }
        for (const [id, w] of Object.entries(open)) {
            if (w && !rs[id]?.early) {
                w.off = fr.ts;
                out.push(w);
                open[id] = null;
            }
        }
    }
    for (const w of Object.values(open)) {
        if (w) {
            w.off = frames.at(-1).ts;
            out.push(w);
        }
    }
    return out.sort((a, b) => a.on - b.on);
}


// The warnings as the windows showed them (det.gap names one rider at a time).
function shownWarnings(ride) {
    const out = [];
    let cur = null;
    ride.ticks.forEach(t => {
        const g = t.det?.gap ?? null;
        if (cur && (!g || g.id !== cur.id)) {
            cur.off = t.ts;
            out.push(cur);
            cur = null;
        }
        if (g && !cur) {
            cur = {id: String(g.id), on: t.ts, full: g.level === 'full' ? t.ts : null, m: g.m, g: g.m,
                   critical: !!g.critical, mine: !!g.mine, kind: g.kind};
        }
        if (g && cur && g.level === 'full' && !cur.full) {
            cur.full = t.ts;
        }
    });
    if (cur) {
        cur.off = ride.ticks.at(-1).ts;
        out.push(cur);
    }
    return out;
}


// Warnings judged against the real gaps and by what followed.
function judge(eps, ws, S) {
    const hit = eps.map(e => ws.find(w => w.id === e.id && w.on <= e.tEnd && w.off >= (e.t6 ?? e.tReal) - 10000) ?? null);
    const real = w => eps.some(e => e.id === w.id && w.on <= e.tEnd + 10000 && w.off >= e.tReal - 10000);
    let important = 0, unimportant = 0, stable = 0;
    for (const w of ws) {
        const xs = S[w.id] || [];
        const after = xs.filter(x => x.now >= w.on && x.now <= w.on + IMPORTANT_MS).map(x => x.g);
        const before = xs.filter(x => x.now >= w.on - 5000 && x.now <= w.on).map(x => x.g);
        if (after.length && Math.max(...after) >= (w.hill ? G.GAP_HILL_ON_M : G.GAP_ON_M)) {
            important++;
        } else {
            unimportant++;
            if (before.length >= 4 && Math.max(...before) - Math.min(...before) <= STABLE_M) {
                stable++;
            }
        }
    }
    const lat = hit.map((w, i) => (w && eps[i].t8 ? (w.on - eps[i].t8) / 1000 : null)).filter(Number.isFinite);
    const gAt = hit.filter(Boolean).map(w => w.g);
    return {n: ws.length, detected: hit.filter(Boolean).length, missed: hit.filter(w => !w).length,
            falseAlarms: ws.filter(w => !real(w)).length, important, unimportant, stable,
            afterRaw8: {medianS: num(median(lat)), minS: lat.length ? num(Math.min(...lat)) : null, maxS: lat.length ? num(Math.max(...lat)) : null},
            gapAtWarningM: num(median(gAt), 1), hit};
}


function speedMean(frames, id, a, b) {
    const v = [];
    for (let j = Math.max(0, a); j <= b; j++) {
        const r = frames[j]?.rows?.[id];
        if (r && Number.isFinite(r.speed)) {
            v.push(r.speed);
        }
    }
    return v.length ? v.reduce((x, y) => x + y) / v.length : NaN;
}


// Closing excursions: from EXC_START_M, peaking at EXC_PEAK_M or more, closed below EXC_CLOSED_M.
// Who closed it: the rider behind's speed change vs the rider ahead's (5 s before → peak to close).
function closing(S, frames, ok, until) {
    const exc = [];
    for (const [id, xs] of Object.entries(S)) {
        let cur = null;
        const end = (i, closed) => {
            if (cur) {
                cur.xs = xs.slice(cur.i0, i + 1);
                cur.closed = closed;
                if (cur.peak >= EXC_PEAK_M && ok(id, cur.t0) && cur.t0 < until) {
                    exc.push(cur);
                }
            }
            cur = null;
        };
        xs.forEach((x, i) => {
            const contiguous = i > 0 && x.idx === xs[i - 1].idx + 1 && x.ahead === xs[i - 1].ahead;
            if (cur && !contiguous) {
                end(i - 1, false);
            }
            if (cur) {
                if (x.g > cur.peak) {
                    cur.peak = x.g;
                    cur.ip = i;
                }
                if (x.g < EXC_CLOSED_M) {
                    end(i, true);
                }
            } else if (x.g >= EXC_START_M) {
                cur = {id, t0: x.now, i0: i, ip: i, peak: x.g, ahead: x.ahead};
            }
        });
        if (cur) {
            end(xs.length - 1, false);
        }
    }
    return PEAKS.map(([lo, hi]) => {
        const E = exc.filter(e => e.peak >= lo && e.peak < hi);
        const C = E.filter(e => e.closed);
        let own = 0, team = 0;
        const dvB = [], dvA = [], durs = [];
        for (const e of C) {
            const ipx = e.xs[e.ip - e.i0]?.idx ?? e.xs[0].idx, i0 = e.xs[0].idx, ic = e.xs.at(-1).idx;
            const db = speedMean(frames, e.id, ipx, ic) - speedMean(frames, e.id, i0 - 5, i0 - 1);
            const da = speedMean(frames, e.ahead, ipx, ic) - speedMean(frames, e.ahead, i0 - 5, i0 - 1);
            dvB.push(db);
            dvA.push(da);
            durs.push((e.xs.at(-1).now - e.t0) / 1000);
            if (db > -da) {
                own++;
            } else {
                team++;
            }
        }
        return {peak: hi === Infinity ? `≥${lo} m` : `${lo}–${hi} m`, n: E.length, closed: C.length,
                closeMedianS: num(median(durs)), byRiderBehind: own, byFrontSlower: team,
                dvBehindKmh: num(median(dvB), 1), dvAheadKmh: num(median(dvA), 1)};
    });
}


// The last FINISH_M before the line: the gap engine run as if it were not muted there. The drop
// counter ("before") counts the full warnings the report keeps before the zone (kept: the replay
// warnings after the gap rules, the same list as the drop counter table), plus those earlier in
// the zone itself.
function finishZone(ride, frames, L, {kept}) {
    const {finish, meRows} = ride;
    if (!Number.isFinite(finish.endM) || finish.index === null) {
        return null;
    }
    const zone = i => Number.isFinite(meRows[i]?.eventDistance) && meRows[i].eventDistance >= finish.endM - FINISH_M &&
        meRows[i].eventDistance < finish.endM;
    let st = G.initialGaps();
    const keptFulls = (id, ts) => kept.filter(w => w.id === id && w.full != null && w.full < ts).length;
    const fulls = {};       // full warnings per rider in the zone so far
    let wasOpen = {};
    const seen = {};
    const out = [];
    for (let i = 0; i <= finish.index; i++) {
        const fr = frames[i];
        if (fr.skipped) {
            continue;
        }
        const z = zone(i);
        st = G.gapStep(st, {now: fr.ts, selfId: ride.selfId, positions: fr.positions, active: fr.active || (z && fr.live),
                            hill: fr.hill, needed: fr.needed, riders: fr.rows});
        const before = {...fulls};
        for (const [id, r] of Object.entries(st.riders)) {
            if (r.open && !wasOpen[id] && z) {
                fulls[id] = (fulls[id] || 0) + 1;
            }
        }
        wasOpen = Object.fromEntries(Object.entries(st.riders).map(([id, r]) => [id, r.open]));
        if (!z) {
            continue;
        }
        for (const [id, r] of Object.entries(st.riders)) {
            const row = {who: L(id), at: fr.ts, g: num(r.g), critical: r.critical, before: keptFulls(id, fr.ts) + (before[id] || 0),
                         draftW: num(fr.rows?.[id]?.draft),
                         toLineM: num(finish.endM - meRows[i].eventDistance)};
            if (r.early && !seen[id]) {
                seen[id] = 1;
                out.push({...row, level: 'früh'});
            }
            if (r.open && seen[id] === 1) {
                seen[id] = 2;
                out.push({...row, level: 'voll'});
            }
        }
    }
    return out;
}


export function gapsCheck(ride, frames, {from, to}) {
    const L = ride.labels;
    const S = seriesOf(frames);
    // My measured gap is only mine when my observed wheel (live chain) is a recorded rider: an
    // unrecorded wheel makes the gap to the next recorded rider look far too large.
    const byTs = new Map(ride.ticks.map(t => [t.ts, t]));
    const ok = (id, ts) => {
        if (id !== ride.selfId) {
            return true;
        }
        const w = byTs.get(ts)?.det?.wheelObs;
        return w == null || !!ride.recorded.get(String(w));
    };
    const all = episodes(S).filter(e => e.tReal >= from && e.tReal < to);
    // A "gap" the rider behind rode in full draft: someone without data was in between.
    const drafted = all.filter(e => ok(e.id, e.tReal) && e.draftW >= DRAFT_KEEP_W);
    const inDrafted = (id, ts) => drafted.some(e => e.id === id && ts >= e.tReal - 10000 && ts <= e.tEnd + 10000);
    const valid = (id, ts) => ok(id, ts) && !inDrafted(id, ts);
    const eps = all.filter(e => ok(e.id, e.tReal) && !(e.draftW >= DRAFT_KEEP_W));
    const invalidMine = all.filter(e => !ok(e.id, e.tReal)).length;
    // A warning that began on a gap ridden in full draft still counts when it stays on into a real
    // gap of the same rider (it warned of that one too).
    const intoReal = w => eps.some(e => e.id === w.id && w.on <= e.tEnd && w.off >= e.tReal);
    const keep = w => ok(w.id, w.on) && (!inDrafted(w.id, w.on) || intoReal(w)) && w.on >= from && w.on < to;
    const rep = replayWarnings(frames).filter(keep);
    const hasShown = ride.ticks.some(t => t.det && Object.hasOwn(t.det, 'gap'));
    const shown = hasShown ? shownWarnings(ride).filter(keep) : null;
    for (const w of shown || []) {
        const x = (S[w.id] || []).find(s => s.now === w.on);
        w.hill = x?.hill ?? false;
        if (x) {
            w.g = x.g;
        }
    }
    const R = judge(eps, rep, S);
    // The same without the full-draft filter (how the 17 Nov session counted), to compare.
    const U = judge(all.filter(e => ok(e.id, e.tReal)),
                    replayWarnings(frames).filter(w => ok(w.id, w.on) && w.on >= from && w.on < to), S);
    const W = shown ? judge(eps, shown, S) : null;
    const realList = eps.map((e, i) => ({who: L(e.id), at: e.tReal, s: num((e.tEnd - e.tReal) / 1000 + 1), maxM: num(e.maxG),
                                         hill: e.hill, critical: e.critical, draftW: num(e.draftW),
                                         afterRaw8Replay: R.hit[i] && e.t8 ? num((R.hit[i].on - e.t8) / 1000) : null,
                                         afterRaw8Shown: W?.hit[i] && e.t8 ? num((W.hit[i].on - e.t8) / 1000) : null}));
    // Per rider: real gaps, warnings (replay early/full, shown).
    const ids = new Set([...Object.keys(S)]);
    const perRider = [...ids].map(id => ({
        who: L(id),
        real: eps.filter(e => e.id === id).length,
        replayEarly: rep.filter(w => w.id === id).length,
        replayFull: rep.filter(w => w.id === id && w.full).length,
        shown: shown ? shown.filter(w => w.id === id).length : null,
    })).filter(r => r.real || r.replayEarly || r.shown).sort((a, b) => b.real - a.real || a.who.localeCompare(b.who, 'de', {numeric: true}));
    const strip = ({hit, ...x}) => x;
    const unrecorded = [...new Set([...ride.plans.values()].flatMap(p => p.riders.map(r => String(r.id))))]
        .filter(id => !ride.recorded.get(id));
    const out = {
        rules: {onM: G.GAP_ON_M, hillOnM: G.GAP_HILL_ON_M, realMinS: REAL_MIN_MS / 1000, rawM: RAW_M, importantS: IMPORTANT_MS / 1000},
        real: {n: eps.length, list: realList, invalidMine,
               drafted: drafted.map(e => ({who: L(e.id), at: e.tReal, s: num((e.tEnd - e.tReal) / 1000 + 1), maxM: num(e.maxG),
                                           draftW: num(e.draftW)}))},
        replay: strip(R),
        shown: W ? strip(W) : null,
        closing: closing(S, frames, valid, to),
        perRider,
        finishZone: finishZone(ride, frames, L, {kept: rep}),
        withoutDraftFilter: {real: U.detected + U.missed, warnings: U.n, detected: U.detected, falseAlarms: U.falseAlarms,
                             afterRaw8MedianS: U.afterRaw8.medianS},
        caveat: unrecorded.length ? `${unrecorded.map(L).join(', ')} ohne Daten: Lücken über sie hinweg wirken zu groß` : null,
    };
    const fz = out.finishZone || [];
    const crit = fz.filter(x => x.critical && x.level === 'voll');
    out.verdict = `${eps.length} echte Lücken; Replay: ${R.detected}/${eps.length} gewarnt, ${R.afterRaw8.medianS ?? '–'} s nach 8 m roh, ` +
        `${R.n} Warnungen (${R.important} wichtig, ${R.unimportant} unwichtig)` +
        (W ? `; angezeigt: ${W.detected}/${eps.length}, ${W.afterRaw8.medianS ?? '–'} s nach 8 m, ${W.n} Warnungen` : '; angezeigt: nicht aufgezeichnet') +
        (crit.length ? `; letzte 500 m: ${crit.map(x => x.who).join(', ')} kritisch abgerissen (stumm)` : '');
    return out;
}
