// Check 7, the upload: what stripForUpload (the mod's own) would keep of this recording, and the
// plan riders it would lose (a plan switched mid-ride: only the head line's plan is kept).
import {stripForUpload} from '../../../pages/src/engine/logupload.mjs';

export function uploadCheck(ride, text) {
    const L = ride.labels;
    const stripped = stripForUpload(text).split('\n').filter(l => l.trim());
    const kept = new Map();
    for (const line of stripped.slice(1)) {
        let t;
        try {
            t = JSON.parse(line);
        } catch (e) {
            continue;
        }
        for (const r of t?.riders || []) {
            kept.set(String(r.id), (kept.get(String(r.id)) || 0) + 1);
        }
    }
    const planIds = new Set([...ride.plans.values()].flatMap(p => p.riders.map(r => String(r.id))));
    const lost = [...ride.recorded.keys()].filter(id => !kept.get(id));
    const lostPlan = lost.filter(id => planIds.has(id));
    // Riders of a later plan (not in the head line's plan or bench) without any rows: most likely
    // already stripped (an uploaded copy). Riders of the head plan are always kept, so when they
    // have no rows they were not there.
    const head = ride.head.plan || {};
    const headIds = new Set([...(head.riders || []), ...(head.bench || [])].map(r => String(r.id)));
    const absent = [...planIds].filter(id => !headIds.has(id) && !ride.recorded.get(id) &&
        ride.sigs.some(s => ride.plans.get(s)?.riders.some(r => String(r.id) === id)));
    const out = {
        ridersRecorded: ride.recorded.size,
        ridersKept: kept.size,
        lostPlanRiders: lostPlan.map(L),
        lostOthers: lost.length - lostPlan.length,
        absentPlanRiders: absent.map(L),
        keptRows: [...kept.values()].reduce((a, b) => a + b, 0),
        rows: [...ride.recorded.values()].reduce((a, b) => a + b, 0),
    };
    out.verdict = lostPlan.length ?
        `das Hochladen würde ${lostPlan.map(L).join(', ')} verlieren (nur der Plan der Kopfzeile bleibt)` :
        absent.length ? `nichts verloren beim Hochladen; ${absent.map(L).join(', ')} fehlen schon in dieser Datei (hochgeladene Kopie?)` :
        `nichts verloren: alle Planfahrer bleiben (${out.lostOthers} andere Fahrer fallen weg, wie gewollt)`;
    return out;
}
