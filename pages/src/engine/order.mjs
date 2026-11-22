// Pure logic (no DOM, no Sauce imports): does the team ride the plan's order? Each change seen at
// the front is classified against the plan order of the line, riders who are skipped sit out, and
// too many changes against the order put the engine into chaos: the countdown goes silent until
// the order holds again (user, 20 Nov 2026: "if nothing fits any more, go silent until a stable
// line is visible again"; spec 2026-11-20-paceline-chaos-counter-design.md, sections 1–3, 7 and 8).
//
// Why: when a team leaves the plan's order (after a climb, a plan that is not the team's plan,
// back-and-forth at the front) the countdown by plan jumped by minutes (the mock-plan race on
// 19 Nov: −141 s and +190 s every round) and the back and skip holds fired every round (23 stalls,
// puller right only 72 %). A rider who sits out (stays in the group, no longer pulls) is no chaos:
// the line goes on without him (12 Nov: #4 in one team, #6 in another; 19 Nov: #3/#4/#6 of one
// team after the climb).
//
// Replay of the report turns with these rules (chaos-sim/sim3.py, return after 3 changes), time
// silent: 19 Nov, 90 s and from +32:26 to the finish in one race (back-and-forth at the end), from
// +3:35 to the finish in the mock-plan race (return after 2 changes flickers 5 times); 12 Nov,
// three races: 404 s (one swap of #3/#5, twice), 160 s (start chaos) and 232 s; the ZRL race on
// 17 Nov 0 s.
//
// The order state (never mutated, every step returns a new one):
//   hist   the last CHAOS_HISTORY_N bad flags, newest last (a return within the round adds two);
//   chaos  true while the order does not hold;
//   okRun  changes in a row classified 'next' while in chaos (a skip leaves it, anything bad
//          resets it);
//   out    {riderId: the turn of the change that took him out}: riders sitting out;
//   n      changes classified so far;
//   turns  new pullers so far, classified or not: the round count (the turn of the next one). A
//          state without it reads turns = n.
// Audit fixes, 20 Nov 2026 (I1; probe p16): the round used to count only classified changes, so my
// hand-off at my end, a resume and the first adoption after riding alone were no turn; a rider who
// missed one turn and was back in his slot the round after came back "within the round" (twice bad):
// 120 s of false chaos (443-562 s) for a team riding the plan. Every new puller is a turn now
// (orderStep, orderCount).

// The window of classified changes and how many bad ones in it mean chaos (user, 20 Nov 2026):
// 2 of the last 4 gave the replay above, silent for most of the mock-plan race and at the
// back-and-forth end, never in the ZRL race on 17 Nov.
export const CHAOS_HISTORY_N = 4;
export const CHAOS_BAD_N = 2;
// Chaos ends after this many changes in a row that are not bad (user, 20 Nov 2026: with 2 the
// mock-plan race on 19 Nov flickered 5 times between silent and counting, with 3 it stayed
// silent from +3:35 to the finish).
export const CHAOS_RETURN_N = 3;


export function initialOrder() {
    return {hist: [], chaos: false, okRun: 0, out: {}, n: 0, turns: 0};
}


export function orderOutIds(order) {
    return Object.keys(order?.out || {});
}


// The line: the plan's riders in plan order who are present and not sitting out; plan riders in
// keepIds are always in it (the riders of the change being classified).
export function lineOf(plan, {presentIds, out, keepIds = []}) {
    const present = new Set(presentIds || []);
    const keep = new Set(keepIds || []);
    const isOut = out || {};
    return (plan?.riders || []).map(r => r.id)
        .filter(id => keep.has(id) || (present.has(id) && !Object.hasOwn(isOut, id)));
}


// A change at the front from fromId to toId against the line (both always in it): 'next' (the
// next rider of the line), 'skip' (further on; skipped = the riders passed over, in line order),
// 'back' (the rider before fromId, only in a line of 3 or more) or 'other' (a rider not in the
// plan, no fromId, the same rider).
export function classifyChange(plan, {fromId, toId, presentIds, out}) {
    const ids = (plan?.riders || []).map(r => r.id);
    if (fromId == null || toId == null || fromId === toId || !ids.includes(fromId) || !ids.includes(toId)) {
        return {kind: 'other', skipped: []};
    }
    const line = lineOf(plan, {presentIds, out, keepIds: [fromId, toId]});
    const n = line.length;
    const a = line.indexOf(fromId);
    const d = (line.indexOf(toId) - a + n) % n;
    if (d === 1) {
        return {kind: 'next', skipped: []};
    }
    if (d === n - 1 && n > 2) {
        return {kind: 'back', skipped: []};
    }
    const skipped = [];
    for (let j = 1; j < d; j++) {
        skipped.push(line[(a + j) % n]);
    }
    return {kind: 'skip', skipped};
}


// One change seen at the front, classified; returns the new order state.
// - toId sitting out: he is back in. If a skip took him out fewer than (present plan riders − 1)
//   turns ago (`turns`: every new puller, see orderCount), he pulls again within the same round: no
//   sit-out but a different order, and the change counts as bad twice (the skip and the return). The
//   present riders are the plan riders in presentIds plus fromId and toId, riders sitting out
//   included (as in sim3.py).
// - A skip takes the skipped riders out with this change's turn, but never me (selfId): I know
//   whether I pull. A rider sitting out who leaves the group stays out; only pulling brings him back.
// - Quick return (20 Nov 2026, spec section 8 rule 1): toId was taken out by the change just before
//   (turn − 1) and `quick` (the caller: that change is less than CHAOS_WINDOW_MS old). That skip was a
//   short wrong front rider, no sit-out: every rider it took out is back in the line, and the change
//   is one bad flag, not two, and not classified further. Why: in a team's race on 19 Nov #6 was side
//   by side at the front for 5 s in the #2 → #3 change; adopted after HOLD_MS, his skip plus the
//   return of #3 counted twice and gave a false 180 s chaos phase at the start. Only within
//   CHAOS_WINDOW_MS: without that limit the mock-plan race on 19 Nov lost 146 s of chaos (a skip and
//   its return a pull later is how a team riding another order looks).
// - Bad = back, other or such a return. Out of chaos: CHAOS_BAD_N bad of the last CHAOS_HISTORY_N
//   start it. In chaos: CHAOS_RETURN_N changes in a row classified 'next' end it, and the history
//   starts empty (bad flags still go into the history while in chaos). A skip leaves that count as
//   it is, a bad change sets it to 0 (rule 4, see chaosStep).
export function orderStep(order, plan, {fromId, toId, presentIds, selfId = null, quick = false}) {
    order = Array.isArray(order?.hist) ? order : initialOrder();   // a missing or older state
    const no = order.turns ?? order.n;    // this change's turn
    const out = {...order.out};
    let twice = false;
    if (toId != null && Object.hasOwn(out, toId)) {
        const ids = (plan?.riders || []).map(r => r.id);
        const present = new Set(presentIds || []);
        const count = ids.filter(id => present.has(id) || id === fromId || id === toId).length;
        twice = no - out[toId] < count - 1;
        if (twice && quick && out[toId] === no - 1) {
            for (const id of Object.keys(out)) {
                if (out[id] === no - 1) {
                    delete out[id];
                }
            }
            return {...chaosStep(order, [true], false), out, n: order.n + 1, turns: no + 1};
        }
        delete out[toId];
    }
    const {kind, skipped} = classifyChange(plan, {fromId, toId, presentIds, out});
    if (kind === 'skip') {
        for (const id of skipped) {
            if (id !== selfId) {
                out[id] = no;
            }
        }
    }
    const bad = twice || kind === 'back' || kind === 'other';
    return {...chaosStep(order, [bad, ...(twice ? [true] : [])], kind === 'next'), out, n: order.n + 1,
            turns: no + 1};
}


// One bad flag without a change (20 Nov 2026, spec section 8 rules 2 and 3): a back candidate held
// and gone without being adopted, or a resume after a pause that is not the line's next. The flag
// goes into the history like a bad change (chaos at CHAOS_BAD_N, in chaos okRun back to 0); the
// change count `n`, the round count `turns` and the riders sitting out stay.
export function orderBad(order) {
    order = Array.isArray(order?.hist) ? order : initialOrder();   // a missing or older state
    return {...chaosStep(order, [true], false), out: order.out, n: order.n,
            turns: order.turns ?? order.n};
}


// A new puller who is not classified (my hand-off at my end, a resume, the first adoption after riding
// alone or after the start): one more turn for the round, nothing else (audit fixes, 20 Nov 2026, I1,
// see the header).
export function orderCount(order) {
    order = Array.isArray(order?.hist) ? order : initialOrder();   // a missing or older state
    return {...order, turns: (order.turns ?? order.n) + 1};
}


// The chaos part of a step: `flags` (bad or not, newest last) go into the history; `next`: the
// change was classified 'next'.
// Back from chaos only on 'next' (user, 20 Nov 2026, spec section 8 rule 4): a skip leaves okRun
// as it is, anything bad sets it to 0. Why: in a team's race on 19 Nov the chaos phase after the
// climbs (with rule 3 alone) ended again 70 s before the finish sprint, although the back-and-forth
// went on: with the holds off in chaos, a 4 s front rider and the recording rider's own start made
// three changes in a row that were not bad.
function chaosStep(order, flags, next) {
    let hist = [...order.hist, ...flags].slice(-CHAOS_HISTORY_N);
    const bad = flags.some(Boolean);
    let chaos = order.chaos;
    let okRun = order.okRun;
    if (!chaos) {
        if (hist.filter(Boolean).length >= CHAOS_BAD_N) {
            chaos = true;
            okRun = 0;
        }
    } else {
        okRun = bad ? 0 : next ? okRun + 1 : okRun;
        if (okRun >= CHAOS_RETURN_N) {
            chaos = false;
            okRun = 0;
            hist = [];
        }
    }
    return {hist, chaos, okRun};
}
