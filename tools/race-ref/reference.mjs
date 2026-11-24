// The race reference ("Soll"): who really led, who was in the group, the turns and their change
// classes, and the terrain, per second, from one or more recordings of the same race. Pure
// (views in, reference out), no files. The constants are this tool's own copies: the engine is
// replaced by a new one later and the reference must not move with it.

export const GROUP_AGE_MS = 10000;        // data at most this old counts for the group
export const CHAIN_M = 30;                // gaps up to this keep a cluster together
export const DROP_S = 30;                 // dropped after this long outside the group, back after this long inside
export const TURN_MIN_S = 8;              // a front run shorter than this is no turn
export const HOLE_S = 4;                  // holes of up to this many seconds inside a turn are bridged
export const MERGE_S = 60;                // the same rider within this many seconds is one turn
export const INTERJECTION_MAX_S = 20;     // a turn shorter than this can be an interjection
export const POWER_FROM_S = 5;            // a turn's power is taken from this many seconds in
export const POWER_AGE_MS = 3000;         // power rows older than this are not used
export const START_S = 120;               // context start: the first seconds of the race
export const END_S = 1200;                // context end: the last seconds of the race
export const GRADE_SPAN_M = 500;          // the grade is measured over the last this many metres
export const GRADE_MIN_M = 200;           // a grade is only given once more than this much is covered
export const HILL_GRADE = 2.5;            // percent: a climb is at least this steep, a descent at most the negative
export const HILL_JOIN_S = 60;            // grade runs of one kind this close are one segment
export const HILL_MIN_KM = 0.8;           // a segment shorter than this is no hill
export const HILL_MIN_GAIN_M = 30;        // a segment with less height change is no hill
export const DESCENT_AFTER_S = 120;       // a descent starting within this long after a climb belongs to its window
export const HILL_MERGE_S = 300;          // hill windows this close are merged
export const TRAFFIC_BEFORE_S = 30;       // a change is blamed on traffic when it was seen this long before it
export const DRAFT_PROXY_W = 30;          // the frontmost team rider's draft above this: someone outside the team rides in front (old recordings without traffic)
export const GAP_MERGE_S = 15;            // real gaps of one rider this close in time (several recordings) are one gap
export const CHANGE_ALLOWANCE_S = 10;     // countdown allowance for plan pulls of at most LONG_PULL_S
export const LONG_PULL_S = 40;            // plan pulls up to this long count as short for the allowance
export const CHANGE_ALLOWANCE_LONG_S = 5; // countdown allowance for longer plan pulls
export const RUN_ON_S = 3;                // the front rider may run on this long after the change


const range = n => [...Array(n).keys()].map(x => x + 1);
const inOrder = kind => kind === 'next' || kind === 'skip' || kind === 'same';


// The reference of a race. input: {n, N, raceS, planS, planW, views} (see input.mjs; views[i]:
// {self, front, frames, dist, alt, traffic, ...}). Returns {n, N, raceS, planS, planW, selfPos,
// front, agreement, present, drops, raw, turns, interjections, hills, ctx, afterClimb, label,
// traffic, marks, countdown}. traffic: per second {ahead, inLine} (true, false or null for not known),
// the views fused. marks: [{type: 'back' | 'interjection' | 'disorder', at, cause: 'team' |
// 'traffic'}] by time. countdown[k][s]: the reference countdown of rider k (see countdownOf).
// interjections: [{who, at, s, between: [A, B], w, wPlan, ownerW, ownerPlanW}]: w and ownerW the median
// power (W, null without data) of the interjector and of the running owner A over the interjection's
// seconds, wPlan and ownerPlanW their plan watts.
export function buildReference(input) {
    const {n, N, raceS, planS, planW, views} = input;
    const {front, agreement} = fuse(views, N);
    const {present, drops} = groupPresence(views, n, N);
    const raw = rawTurns(front, N);
    const turns = raw.map(t => ({...t}));
    const interjections = dropInterjections(turns, present, n);
    // The interjector's and the running owner's power over the interjection's own seconds (short:
    // no POWER_FROM_S offset), with the plan's watts of both.
    for (const x of interjections) {
        const last = x.at + x.s - 1;
        Object.assign(x, {w: turnPower(views, x.who, x.at, last, 0), wPlan: planW[x.who],
                          ownerW: turnPower(views, x.between[0], x.at, last, 0), ownerPlanW: planW[x.between[0]]});
    }
    classify(turns, present, n);
    classify(raw, present, n);
    for (const t of [...raw, ...turns]) {
        t.s = t.end - t.start + 1;
        t.planS = planS[t.who];
        t.w = turnPower(views, t.who, t.start, t.end);
        t.planW = planW[t.who];
    }
    const hills = hillWindows(terrainView(views, present), N);
    const ctx = contexts(hills, N, raceS);
    const afterClimb = afterClimbOf(hills, turns, N);
    const label = new Array(N).fill('none');
    for (let i = 0; i < turns.length; i++) {
        const e = i + 1 < turns.length ? turns[i + 1].start : raceS;
        for (let s = turns[i].start; s < e && s < N; s++) {
            label[s] = turns[i].kind;
        }
    }
    const traffic = fuseTraffic(views, N, present);
    const marks = marksOf(turns, interjections, label, traffic, N);
    const countdown = countdownOf(turns, present, planS, n, N);
    return {n, N, raceS, planS, planW, selfPos: views.map(v => v.self), front, agreement,
            present: present.map(a => Array.from(a)), drops, raw, turns, interjections, hills, ctx, afterClimb, label,
            traffic, marks, countdown};
}


// The fused front per second: the views' votes (0 = no data, no vote); -1 where two views name
// different riders. agreement: the share of seconds with at least two votes where they agree, null
// when no second had two votes (one view).
function fuse(views, N) {
    const front = new Array(N).fill(0);
    let voted = 0;
    let agreed = 0;
    for (let s = 0; s < N; s++) {
        const v = views.map(w => w.front[s]).filter(Boolean);
        const split = v.length >= 2 && v.some(x => x !== v[0]);
        front[s] = split ? -1 : (v[0] ?? 0);
        if (v.length >= 2) {
            voted++;
            agreed += split ? 0 : 1;
        }
    }
    return {front, agreement: voted ? agreed / voted : null};
}


// Who is in the group per second: the largest cluster of riders (gaps up to CHAIN_M, data up to
// GROUP_AGE_MS old), then dropped after DROP_S seconds outside and back after DROP_S inside. The
// switch is dated to the start of that run. present[k][s] (k = 1..n, present[0] is all zero);
// drops: [{who, at, state: 'gone' | 'back'}]. A rider never seen is gone from second 0.
function groupPresence(views, n, N) {
    const inGrp = Array.from({length: n + 1}, () => new Uint8Array(N));
    for (const v of views) {
        for (let s = 0; s < N; s++) {
            const fr = v.frames[s];
            if (!fr) {
                continue;
            }
            const ps = fr.pos.filter(p => (p.age ?? 0) <= GROUP_AGE_MS && Number.isFinite(p.x)).sort((a, b) => b.x - a.x);
            const cl = [];
            for (const p of ps) {
                const c = cl.at(-1);
                if (c && c.lastX - p.x <= CHAIN_M) {
                    c.m.push(p);
                    c.lastX = p.x;
                } else {
                    cl.push({m: [p], lastX: p.x});
                }
            }
            const big = cl.reduce((a, c) => (!a || c.m.length > a.m.length ? c : a), null);
            for (const p of big?.m ?? []) {
                inGrp[p.k][s] = 1;
            }
        }
    }
    const present = Array.from({length: n + 1}, () => new Uint8Array(N));
    const drops = [];
    for (let k = 1; k <= n; k++) {
        let st = 1;
        let run = 0;
        for (let s = 0; s < N; s++) {
            const g = inGrp[k][s];
            run = g === st ? 0 : run + 1;
            if (run >= DROP_S) {
                st = g;
                run = 0;
                for (let b = s - DROP_S + 1; b <= s; b++) {
                    present[k][b] = st;
                }
                drops.push({who: k, at: s - DROP_S + 1, state: st ? 'back' : 'gone'});
            }
            present[k][s] = st;
        }
    }
    return {present, drops};
}


// The turns of the fused front: runs of one rider (holes up to HOLE_S bridged, disagreement and no
// data are holes) of at least TURN_MIN_S seconds, then the same rider within MERGE_S one turn.
function rawTurns(front, N) {
    const runs = [];
    let cur = null;
    for (let s = 0; s < N; s++) {
        const w = front[s];
        if (w <= 0) {
            continue;
        }
        if (cur && cur.who === w && s - cur.end <= HOLE_S + 1) {
            cur.end = s;
        } else {
            if (cur && cur.end - cur.start + 1 >= TURN_MIN_S) {
                runs.push(cur);
            }
            cur = {who: w, start: s, end: s};
        }
    }
    if (cur && cur.end - cur.start + 1 >= TURN_MIN_S) {
        runs.push(cur);
    }
    const raw = [];
    for (const t of runs) {
        const p = raw.at(-1);
        if (p && p.who === t.who && t.start - p.end <= MERGE_S) {
            p.end = t.end;
        } else {
            raw.push({...t});
        }
    }
    return raw;
}


// Removes interjections from the turns (in place): a turn X under INTERJECTION_MAX_S between A and
// B is dropped when A and B are the same rider (the two parts are joined) or when B is the rider
// after A in the line of those present, and X is not (A's turn runs on to the end of X). Returns
// them: [{who, at, s, between: [A, B]}].
function dropInterjections(T, present, n) {
    const out = [];
    const lineAt = (s, keep) => range(n).filter(k => keep.includes(k) || present[k][s]);
    const nextIn = (line, a, b) => line[(line.indexOf(a) + 1) % line.length] === b;
    for (let changed = true; changed;) {
        changed = false;
        for (let i = 1; i + 1 < T.length; i++) {
            const A = T[i - 1];
            const X = T[i];
            const B = T[i + 1];
            if (X.end - X.start + 1 >= INTERJECTION_MAX_S) {
                continue;
            }
            const line = lineAt(X.start, [A.who, X.who, B.who]);
            if (A.who === B.who || (nextIn(line, A.who, B.who) && !nextIn(line, A.who, X.who))) {
                out.push({who: X.who, at: X.start, s: X.end - X.start + 1, between: [A.who, B.who]});
                if (A.who === B.who) {
                    A.end = B.end;
                    T.splice(i, 2);
                } else {
                    A.end = X.end;
                    T.splice(i, 1);
                }
                changed = true;
                break;
            }
        }
    }
    return out;
}


// Sets kind, skipped, sitting, from and lineN on each turn (in place), from the reference's own line (the
// riders present at the change, without those who sat out since being skipped, until they pull):
// first, same, next (d = 1), back (d = line - 1, line of 3 or more) and skip (anything else).
// sitting: the riders sitting out while the turn runs (skipped and not yet pulled).
function classify(list, present, n) {
    const out = new Set();
    for (let i = 1; i < list.length; i++) {
        const a = list[i - 1].who;
        const b = list[i].who;
        const s = list[i].start;
        out.delete(b);
        const line = range(n).filter(k => k === a || k === b || (present[k][s] && !out.has(k)));
        const m = line.length;
        const ia = line.indexOf(a);
        const d = (line.indexOf(b) - ia + m) % m;
        const kind = a === b ? 'same' : d === 1 ? 'next' : (d === m - 1 && m > 2) ? 'back' : 'skip';
        const skipped = [];
        if (kind === 'skip') {
            for (let j = 1; j < d; j++) {
                skipped.push(line[(ia + j) % m]);
            }
        }
        skipped.forEach(k => out.add(k));
        Object.assign(list[i], {kind, skipped, sitting: [...out], from: a, lineN: m});
    }
    if (list[0]) {
        Object.assign(list[0], {kind: 'first', sitting: []});
    }
}


// The median power (W) of rider k over the seconds a..b, from `from` seconds in (a turn: from
// POWER_FROM_S), over all views; null without data.
function turnPower(views, k, a, b, from = POWER_FROM_S) {
    const xs = [];
    for (const v of views) {
        for (let s = a + from; s <= b && s < v.frames.length; s++) {
            const w = v.frames[s]?.power?.[k];
            if (Number.isFinite(w)) {
                xs.push(w);
            }
        }
    }
    xs.sort((x, y) => x - y);
    return xs.length ? xs[xs.length >> 1] : null;
}


// The view the terrain is read from: the one whose recorder was in the group for the most seconds
// (a recorder who quit or was dropped rides another road in time), then the one with the most
// seconds of finite distance, then the first.
function terrainView(views, present) {
    const score = v => [v.self > 0 ? present[v.self].reduce((a, b) => a + b, 0) : 0,
                        v.dist.reduce((a, d) => a + (Number.isFinite(d) ? 1 : 0), 0)];
    let best = null;
    let bestScore = null;
    for (const v of views) {
        const sc = score(v);
        if (!best || sc[0] > bestScore[0] || (sc[0] === bestScore[0] && sc[1] > bestScore[1])) {
            best = v;
            bestScore = sc;
        }
    }
    return best;
}


// The hill windows from one view's own altitude and event distance: segments where the grade over
// the last GRADE_SPAN_M is at least HILL_GRADE (up) or at most minus it (down), joined when closer
// than HILL_JOIN_S; those of at least HILL_MIN_KM and HILL_MIN_GAIN_M are hills. A window runs
// from a climb's start to the end of a descent that starts within DESCENT_AFTER_S after it (else
// the climb's end); windows closer than HILL_MERGE_S are merged; a descent without a climb is a
// window of its own (descentOnly). [{start, end, climbEnd, gain, fromKm, descentOnly?}].
function hillWindows(view, N) {
    const {dist, alt} = view;
    const ok = s => Number.isFinite(dist[s]) && Number.isFinite(alt[s]);
    const grade = new Array(N).fill(0);
    let j = 0;
    for (let s = 0; s < N; s++) {
        if (!ok(s)) {
            continue;
        }
        while (j < s && (!ok(j) || dist[s] - dist[j] > GRADE_SPAN_M)) {
            j++;
        }
        const dd = dist[s] - dist[j];
        grade[s] = dd > GRADE_MIN_M && ok(j) ? 100 * (alt[s] - alt[j]) / dd : 0;
    }
    const segs = [];
    let sg = null;
    for (let s = 0; s < N; s++) {
        const g = grade[s];
        const kind = g >= HILL_GRADE ? 'up' : g <= -HILL_GRADE ? 'down' : null;
        if (kind && sg && sg.kind === kind && s - sg.end <= HILL_JOIN_S) {
            sg.end = s;
        } else if (kind) {
            if (sg) {
                segs.push(sg);
            }
            sg = {kind, start: s, end: s};
        }
    }
    if (sg) {
        segs.push(sg);
    }
    const at = (a, s) => (Number.isFinite(a[s]) ? a[s] : 0);
    const found = [];
    for (const g of segs) {
        const gain = Math.abs(at(alt, g.end) - at(alt, g.start));
        const km = (at(dist, g.end) - at(dist, g.start)) / 1000;
        if (km >= HILL_MIN_KM && gain >= HILL_MIN_GAIN_M) {
            found.push({...g, gain: Math.round(gain), fromKm: +(at(dist, g.start) / 1000).toFixed(1)});
        }
    }
    const hills = [];
    for (const c of found.filter(c => c.kind === 'up')) {
        const dsc = found.find(d => d.kind === 'down' && d.start >= c.end && d.start - c.end <= DESCENT_AFTER_S);
        const w = {start: c.start, end: dsc ? dsc.end : c.end, climbEnd: c.end, gain: c.gain, fromKm: c.fromKm};
        const p = hills.at(-1);
        if (p && w.start - p.end <= HILL_MERGE_S) {
            p.end = Math.max(p.end, w.end);
        } else {
            hills.push(w);
        }
    }
    for (const d of found.filter(c => c.kind === 'down')) {
        if (!hills.some(w => d.start >= w.start && d.start <= w.end + 1)) {
            hills.push({start: d.start, end: d.end, climbEnd: d.start, gain: -d.gain, fromKm: d.fromKm, descentOnly: true});
        }
    }
    return hills.sort((a, b) => a.start - b.start);
}


// The context per second, in this order: start (before START_S), end (the last END_S seconds of
// the race), climb (inside a hill window), flat.
function contexts(hills, N, raceS) {
    return [...Array(N).keys()].map(s => s < START_S ? 'start' : raceS - s <= END_S ? 'end' :
        hills.some(w => s >= w.start && s <= w.end) ? 'climb' : 'flat');
}


// 1 from just after each hill window until the start of the second in-order change (next, skip,
// same) after it, or the end of the race; the changes of the clean turns.
function afterClimbOf(hills, turns, N) {
    const flag = new Array(N).fill(0);
    for (const h of hills) {
        const later = turns.filter(t => t.start > h.end && inOrder(t.kind));
        const stop = later.length >= 2 ? later[1].start : N;
        for (let s = h.end + 1; s < stop && s < N; s++) {
            flag[s] = 1;
        }
    }
    return flag;
}


// The traffic per second over the views: {ahead, inLine}, each true when any view says true, false
// when at least one view knows and none says true, null when no view knows. A view votes at second
// s only while its recorder is in the group (present[self][s]; never when he is not a plan rider):
// "ahead" is measured from the front of the recorder's own group (and the draft proxy reads his
// chain's front rider), which says nothing about the team when he rides elsewhere.
function fuseTraffic(views, N, present) {
    const fold = (vals) => (vals.includes(true) ? true : vals.some(v => v === false) ? false : null);
    return Array.from({length: N}, (_, s) => {
        const rows = views.filter(v => v.self > 0 && present[v.self][s]).map(v => v.traffic?.[s]).filter(Boolean);
        return {ahead: fold(rows.map(r => r.ahead)), inLine: fold(rows.map(r => r.inLine))};
    });
}


// The marks: each back change (clean turns), each interjection and each run of seconds labelled
// back (a disorder episode), at its start second. The cause is traffic when traffic ahead or in the
// line was seen in the TRAFFIC_BEFORE_S seconds up to and including that second, else team.
function marksOf(turns, interjections, label, traffic, N) {
    const caused = at => {
        for (let s = Math.max(0, at - TRAFFIC_BEFORE_S); s <= at && s < N; s++) {
            if (traffic[s].ahead === true || traffic[s].inLine === true) {
                return 'traffic';
            }
        }
        return 'team';
    };
    const marks = [];
    for (const i of interjections) {
        marks.push({type: 'interjection', at: i.at});
    }
    for (const t of turns.filter(t => t.kind === 'back')) {
        marks.push({type: 'back', at: t.start});
    }
    for (let s = 0; s < N; s++) {
        if (label[s] === 'back' && (s === 0 || label[s - 1] !== 'back')) {
            marks.push({type: 'disorder', at: s});
        }
    }
    marks.sort((a, b) => a.at - b.at);
    return marks.map(m => ({...m, cause: caused(m.at)}));
}


// The reference countdown, countdown[k][s] (k = 1..n, [0] all null): the seconds rider k has until
// he takes the front, from the clean turns and the plan, as the owner of the running turn left it
// (his plan pull minus the seconds he has run, held at -RUN_ON_S, plus the allowance after him when
// riders lie between) and the plan pulls of the riders between, in line order, each but the last
// with the change allowance. The line is the owner, k and the riders present who are not sitting
// out (after a skip, until they pull: the line the change classes use). null for the owner himself,
// where no turn runs and while k is not in the group.
function countdownOf(turns, present, planS, n, N) {
    const allow = x => (x <= LONG_PULL_S ? CHANGE_ALLOWANCE_S : CHANGE_ALLOWANCE_LONG_S);
    const out = Array.from({length: n + 1}, () => new Array(N).fill(null));
    for (const turn of turns) {
        const own = turn.who;
        const sitting = turn.sitting ?? [];
        for (let s = turn.start; s <= turn.end && s < N; s++) {
            for (let k = 1; k <= n; k++) {
                if (k === own || !present[k][s]) {
                    continue;
                }
                const line = range(n).filter(x => x === own || x === k || (present[x][s] && !sitting.includes(x)));
                const m = line.length;
                const between = [];
                for (let j = (line.indexOf(own) + 1) % m; line[j] !== k; j = (j + 1) % m) {
                    between.push(line[j]);
                }
                let t = Math.max(-RUN_ON_S, planS[own] + (between.length ? allow(planS[own]) : 0) - (s - turn.start));
                between.forEach((x, i) => {
                    t += planS[x] + (i === between.length - 1 ? 0 : allow(planS[x]));
                });
                out[k][s] = t;
            }
        }
    }
    return out;
}
