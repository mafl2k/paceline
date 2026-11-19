// Check 6, the finish: finish mode on and off, what the engine still did after the line, the end
// of the recording.
import {num, runs} from '../util.mjs';

export const OFF_TOL_M = 20;    // finish mode off this close before the line counts as at the line (estimated lines)

export function finishCheck(ride) {
    const {ticks, meRows, finish} = ride;
    if (!ticks.some(t => t.det)) {
        return {skipped: 'keine det-Felder', verdict: 'entfällt (keine det-Felder)'};
    }
    const km = i => num((meRows[i]?.eventDistance ?? NaN) / 1000, 3);
    const toLine = i => (Number.isFinite(finish.endM) && Number.isFinite(meRows[i]?.eventDistance) ?
        num(meRows[i].eventDistance - finish.endM) : null);
    const modes = runs(ticks, t => (t.det?.finish ? 'on' : null)).map(r => ({
        on: ticks[r.from].ts, off: r.to + 1 < ticks.length ? ticks[r.to + 1].ts : null,
        onKm: km(r.from), onToLineM: toLine(r.from),
        offKm: r.to + 1 < ticks.length ? km(r.to + 1) : null, offToLineM: r.to + 1 < ticks.length ? toLine(r.to + 1) : null,
    }));
    const end = ticks.at(-1);
    // Past the line Zwift may reset or jump the event distance: the last plausible one.
    let lastI = ticks.length - 1;
    while (lastI > 0 && Number.isFinite(finish.endM) && !(meRows[lastI]?.eventDistance <= finish.endM + 5000)) {
        lastI--;
    }
    const out = {modes, line: {at: finish.at, endM: num(finish.endM), source: finish.source},
                 recordingEnd: {at: end.ts, afterLineS: finish.at ? num((end.ts - finish.at) / 1000) : null,
                                pastLineM: lastI === ticks.length - 1 ? toLine(lastI) : null}};
    if (finish.index === null) {
        out.verdict = 'Ziellinie nicht erreicht oder unbekannt: keine Prüfung nach dem Ziel';
        return out;
    }
    // After the line: the engine should be quiet (finish mode on, no puller changes, no gap warnings).
    const after = ticks.slice(finish.index + 1);
    let changes = 0;
    for (let k = 1; k < after.length; k++) {
        if ((after[k].det?.puller ?? null) !== (after[k - 1].det?.puller ?? null)) {
            changes++;
        }
    }
    const gapTicks = after.filter(t => t.det?.gap);
    const notFinish = after.filter(t => t.det && !t.det.finish);
    const lastActive = [...after].reverse().find(t => t.det && !t.det.finish && (t.det.view !== 'dash' || t.det.gap));
    out.afterLine = {ticks: after.length, finishOffTicks: notFinish.length, pullerChanges: changes,
                     gapWarningTicks: gapTicks.length, gapMaxM: gapTicks.length ? Math.max(...gapTicks.map(t => t.det.gap.m)) : null,
                     engineActiveS: lastActive ? num((lastActive.ts - finish.at) / 1000) : 0,
                     views: Object.fromEntries(Object.entries(after.reduce((m, t) => {
                         const v = t.det?.view ?? 'none';
                         m[v] = (m[v] || 0) + 1;
                         return m;
                     }, {})))};
    const offAfter = modes.find(m => m.off && (m.off >= finish.at || m.offToLineM >= -OFF_TOL_M));
    out.verdict = notFinish.length ?
        `Zielmodus ${offAfter ? `aus ${offAfter.offToLineM ?? '?'} m nach der Linie` : 'vor der Linie schon aus'}` +
        `${finish.source === 'finish-mode' ? ' (Linie geschätzt)' : ''}; danach ` +
        `${out.afterLine.engineActiveS} s Engine aktiv, ${changes} Zieherwechsel, ${gapTicks.length} s Lückenwarnung` +
        (gapTicks.length ? ` (bis ${out.afterLine.gapMaxM} m)` : '') :
        'Zielmodus bis zum Ende der Aufzeichnung an, nach der Linie keine Engine-Aktivität';
    return out;
}
