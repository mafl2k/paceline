// The race reference's per-rider figures, from the reference and the input's real gaps. Pure.
import {GAP_MERGE_S} from './reference.mjs';

// The median by the reference's own rule (the upper middle of an even count), null when empty.
function med(xs) {
    const a = xs.filter(Number.isFinite).sort((x, y) => x - y);
    return a.length ? a[a.length >> 1] : null;
}


// The real gaps of all views for rider k as [{at, s, m}] by start, merged when one starts within
// GAP_MERGE_S seconds of the last second of the one before (the same gap seen by several
// recordings): at the first start, s up to the last second, m the largest.
function mergedGaps(views, k) {
    const all = views.flatMap(v => (v.gaps ?? []).filter(g => g.k === k)).sort((a, b) => a.at - b.at);
    const out = [];
    for (const g of all) {
        const p = out.at(-1);
        const end = g.at + g.s - 1;
        if (p && g.at - (p.at + p.s - 1) <= GAP_MERGE_S) {
            p.s = Math.max(p.at + p.s - 1, end) - p.at + 1;
            p.m = Math.max(p.m, g.m);
        } else {
            out.push({at: g.at, s: g.s, m: g.m});
        }
    }
    return out;
}


// One entry per plan position: {k, turns, flatTurns, medS, medOverPlanFlatS, medWkgVsPlan,
// groupShare, goneAt, satOut, interjections, gaps}. turns: the clean turns; flatTurns: those that
// start in the flat context; medS: the median turn length (s); medOverPlanFlatS: the median of
// length minus plan pull over the flat turns (s); medWkgVsPlan: the median turn power over the
// plan's watts as a ratio (the same ratio as W/kg against the plan), null without power;
// groupShare: the share of the race seconds in the group; goneAt: the second of the last gone drop
// without a back after it, else null; satOut: how often he was passed over in a skip change;
// interjections: his dropped interjections; gaps: the real gaps of all views merged (see mergedGaps).
export function riderFigures(ref, input) {
    return Array.from({length: ref.n}, (_, i) => {
        const k = i + 1;
        const mine = ref.turns.filter(t => t.who === k);
        const flat = mine.filter(t => ref.ctx[t.start] === 'flat');
        const drops = ref.drops.filter(d => d.who === k);
        const last = drops.at(-1);
        return {
            k,
            turns: mine.length,
            flatTurns: flat.length,
            medS: med(mine.map(t => t.s)),
            medOverPlanFlatS: med(flat.map(t => t.s - t.planS)),
            medWkgVsPlan: med(mine.filter(t => t.w !== null && t.planW > 0).map(t => t.w / t.planW)),
            groupShare: ref.present[k].reduce((a, b) => a + b, 0) / ref.N,
            goneAt: last?.state === 'gone' ? last.at : null,
            satOut: ref.turns.filter(t => t.skipped?.includes(k)).length,
            interjections: ref.interjections.filter(x => x.who === k).length,
            gaps: mergedGaps(input.views, k),
        };
    });
}
