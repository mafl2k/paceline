// The ride as the checks see it: ticks, the plan active at each tick, my row, the event and the
// labels riders are shown with (plan positions, never Zwift ids; first names only with --names).
import {FINISH_M} from '../../pages/src/engine/rotation.mjs';

export const FRESH_MS = 3000;    // data this old or younger counts as fresh (ground truth, holes)

// parsed: parseRecording's result. extraPlans: [{sig, plan}] from --plan. planAll: {sig, plan}
// from --plan-all: the plan every second is judged by (the analysis view when the live plan was
// wrong); `sigs` stays what ran live. names: add first names.
export function makeRide(parsed, {extraPlans = [], planAll = null, names = false} = {}) {
    const {head, ticks} = parsed;
    const selfId = String(head.selfId ?? ticks.find(t => t.selfId)?.selfId ?? '');
    const plans = new Map();
    const notes = [];
    const headSig = head.plan?.sig ?? head.planSig ?? null;
    if (head.plan && Array.isArray(head.plan.riders)) {
        plans.set(headSig, {...head.plan, sig: headSig});
    }
    for (const {sig, plan} of extraPlans) {
        const code = sig ?? plan.sig;
        if (sig && plan.sig && sig !== plan.sig) {
            notes.push(`--plan ${sig}: die Datei ergibt den Plancode ${plan.sig}; wie angegeben für ${sig} verwendet`);
        }
        plans.set(code, {...plan, sig: code});
    }
    let all = null;
    if (planAll) {
        const code = planAll.sig ?? planAll.plan.sig;
        if (planAll.sig && planAll.plan.sig && planAll.sig !== planAll.plan.sig) {
            notes.push(`--plan-all ${planAll.sig}: die Datei ergibt den Plancode ${planAll.plan.sig}; wie angegeben für ${planAll.sig} verwendet`);
        }
        all = {...planAll.plan, sig: code};
        plans.set(code, all);
    }
    // The plan code per tick: det.planSig; a tick without det (older versions, or det failed) keeps
    // the last one (the head's at first).
    let sig = headSig;
    const sigs = ticks.map(t => {
        if (t.det && Object.hasOwn(t.det, 'planSig')) {
            sig = t.det.planSig ?? null;
        }
        return sig;
    });
    const recorded = new Map();
    for (const t of ticks) {
        for (const r of t.riders) {
            recorded.set(String(r.id), (recorded.get(String(r.id)) || 0) + 1);
        }
    }
    const meRows = ticks.map(t => t.riders.find(r => r.self === true || String(r.id) === selfId) || null);
    // The event: the first one found with a distance (carried forward from where it was logged).
    const events = ticks.filter(t => t.event).map(t => t.event);
    const event = events.find(e => e && e.found && Number.isFinite(e.endDistance) && e.endDistance > 0) ??
        events.find(e => e && e.found) ?? null;
    const eventIds = [...new Set(events.filter(e => e?.found).map(e => e.eventId))];
    const ride = {head, ticks, selfId, plans, sigs, recorded, meRows, event, eventIds, notes, names,
                  headSig, bad: parsed.bad ?? 0, planAllSig: all ? all.sig : null};
    ride.planAt = all ? () => all : i => plans.get(sigs[i]) ?? null;
    ride.finish = finishLine(ride);
    ride.labels = labeller(ride);
    return ride;
}


// The finish line: the event's endDistance, the moment my eventDistance reached it. Without an
// event (versions before 0.2.13 logged none) the start of finish mode (FINISH_M before the line)
// gives an estimate: it began between the previous tick and this one, so the middle of the two
// plus FINISH_M (12 Nov: 2 m off where the event is known). {endM, at, index, source: 'event' |
// 'finish-mode' | null}.
export function finishLine(ride) {
    const {ticks, meRows, event} = ride;
    let endM = null;
    let source = null;
    if (event && Number.isFinite(event.endDistance) && event.endDistance > 0) {
        endM = event.endDistance;
        source = 'event';
    } else {
        const i = ticks.findIndex((t, k) => t.det?.finish === true && Number.isFinite(meRows[k]?.eventDistance) &&
            meRows[k].eventDistance > 0);
        if (i >= 0) {
            const prev = i > 0 && Number.isFinite(meRows[i - 1]?.eventDistance) ? meRows[i - 1].eventDistance : meRows[i].eventDistance;
            endM = (prev + meRows[i].eventDistance) / 2 + FINISH_M;
            source = 'finish-mode';
        }
    }
    if (endM === null) {
        return {endM: null, at: null, index: null, source: null};
    }
    const index = ticks.findIndex((t, k) => Number.isFinite(meRows[k]?.eventDistance) &&
        meRows[k].eventDistance >= endM && meRows[k].eventDistance < endM + 5000);
    return {endM, at: index >= 0 ? ticks[index].ts : null, index: index >= 0 ? index : null, source};
}


// Labels: the main plan (the one active at the finish, else the last known one, else the head's)
// gives #1 … #n; I am ICH; riders only in another plan get "<code>#k"; bench riders B1 …; anyone
// else ?1 …. With names, the plan's first name follows.
function labeller(ride) {
    const {plans, sigs, head, selfId, finish} = ride;
    let mainSig = null;
    const upto = finish.index ?? sigs.length - 1;
    for (let i = upto; i >= 0 && mainSig === null; i--) {
        if (plans.has(sigs[i])) {
            mainSig = sigs[i];
        }
    }
    mainSig ??= ride.headSig;
    if (ride.planAllSig) {
        mainSig = ride.planAllSig;
    }
    ride.mainSig = mainSig;
    const label = new Map();
    const name = new Map();
    const main = plans.get(mainSig);
    (main?.riders || []).forEach((r, k) => label.set(String(r.id), `#${k + 1}`));
    for (const [sig, p] of plans) {
        if (sig === mainSig) {
            continue;
        }
        p.riders.forEach((r, k) => {
            if (!label.has(String(r.id))) {
                label.set(String(r.id), `${sig}#${k + 1}`);
            }
        });
    }
    const bench = [...(main?.bench || []), ...[...plans.values()].flatMap(p => p.bench || [])];
    let b = 0;
    for (const r of bench) {
        if (!label.has(String(r.id))) {
            label.set(String(r.id), `B${++b}`);
        }
    }
    for (const p of [main, ...plans.values(), head.plan].filter(Boolean)) {
        for (const r of [...(p.riders || []), ...(p.bench || [])]) {
            const first = String(r.name ?? '').trim().split(/\s+/)[0];
            if (first && !name.has(String(r.id))) {
                name.set(String(r.id), first);
            }
        }
    }
    let q = 0;
    return id => {
        if (id === null || id === undefined) {
            return '–';
        }
        const s = String(id);
        if (!label.has(s)) {
            label.set(s, `?${++q}`);
        }
        const base = s === selfId ? `ICH${label.get(s).startsWith('#') ? ` (${label.get(s)})` : ''}` : label.get(s);
        return ride.names && name.has(s) ? `${base} ${name.get(s)}` : base;
    };
}
