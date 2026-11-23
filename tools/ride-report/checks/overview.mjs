// Check 1, overview: team, event, mod version, plan codes over time, roll-off, finish line,
// duration, holes in my data, riders recorded vs riders in the plan(s), what the recording lacks.
import {FRESH_MS} from '../ride.mjs';
import {num, runs, pct} from '../util.mjs';

export const HOLE_MS = 3000;    // longer without fresh data of mine: a hole

// The fields a current recording has, and what a missing one costs.
const EXPECT = [
    ['det', t => !!t.det, 'keine Entscheidungsdetails (det): Prüfungen 3, 5 (angezeigt) und 6 entfallen'],
    ['shown.act', t => !!t.shown?.act, 'keine Fensteraufzeichnung (shown.act): Prüfung 4 entfällt'],
    ['det.gap', t => !!t.det && Object.hasOwn(t.det, 'gap'), 'keine angezeigte Lückenwarnung (det.gap): Prüfung 5 nur mit dem Replay'],
    ['det.hill', t => !!t.det && Object.hasOwn(t.det, 'hill'), 'kein Geländezustand (det.hill): Pausen aus det.climb, das Replay nimmt die Live-Steigung'],
    ['det.routePos', t => !!t.det && Object.hasOwn(t.det, 'routePos'), 'keine Streckenposition (det.routePos): das Replay nimmt für Anstiege die Live-Steigung'],
];

export function overview(ride, {startAt}) {
    const {ticks, meRows, head, finish} = ride;
    const t0 = ticks[0]?.ts ?? null;
    const tEnd = ticks.at(-1)?.ts ?? null;
    // Roll-off: the engine's start (first roll-off after the start pen), else my first 10 km/h.
    let rollOff = startAt;
    let rollSource = startAt != null ? 'engine' : null;
    if (rollOff == null) {
        const i = meRows.findIndex(r => Number.isFinite(r?.speed) && r.speed >= 10);
        rollOff = i >= 0 ? ticks[i].ts : t0;
        rollSource = i >= 0 ? 'speed' : 'recording start';
    }
    const raceEnd = finish.at ?? tEnd;
    // Plan codes over time.
    const plans = runs(ride.sigs, s => s ?? '(none)').map(r => ({
        sig: r.key, from: ticks[r.from].ts, to: ticks[r.to].ts, ticks: r.to - r.from + 1,
        known: ride.plans.has(r.key),
        riders: ride.plans.get(r.key)?.riders.length ?? null,
    }));
    // Ticks the checks skip for want of a plan (none with --plan-all).
    const unknownTicks = ticks.filter((t, i) => !ride.planAt(i)).length;
    // With --plan-all: the seconds a different plan ran live (shown, wrongly or not, to the riders).
    const otherLive = ride.planAllSig ? ride.sigs.filter(s => s !== ride.planAllSig).length : 0;
    // Holes: time between fresh samples of mine longer than HOLE_MS.
    const fresh = ticks.map((t, i) => meRows[i] && (meRows[i].age ?? 0) <= FRESH_MS ? t.ts : null).filter(x => x !== null);
    const holes = [];
    for (let i = 1; i < fresh.length; i++) {
        if (fresh[i] - fresh[i - 1] > HOLE_MS) {
            holes.push({from: fresh[i - 1], to: fresh[i], s: (fresh[i] - fresh[i - 1]) / 1000,
                        inRace: fresh[i] > rollOff && fresh[i - 1] < raceEnd});
        }
    }
    if (fresh.length && fresh[0] - t0 > HOLE_MS) {
        holes.unshift({from: t0, to: fresh[0], s: (fresh[0] - t0) / 1000, inRace: false});
    }
    // Riders recorded vs riders in each plan used.
    const usedSigs = [...new Set([...ride.sigs, ride.planAllSig].filter(Boolean))].filter(s => ride.plans.has(s));
    const headIds = new Set([...(head.plan?.riders || []), ...(head.plan?.bench || [])].map(r => String(r.id)));
    const riders = usedSigs.map(sig => {
        const p = ride.plans.get(sig);
        const list = p.riders.map(r => ({label: ride.labels(r.id), rows: ride.recorded.get(String(r.id)) || 0,
                                         inHead: headIds.has(String(r.id))}));
        const missing = list.filter(r => !r.rows);
        // A later plan's riders missing entirely while all of them are outside the head plan: the
        // upload kept only the head plan's riders (stripForUpload).
        const stripped = sig !== ride.headSig && missing.length > 0 && missing.every(r => !r.inHead);
        return {sig, total: list.length, recorded: list.filter(r => r.rows).map(r => r.label),
                missing: missing.map(r => r.label), stripped};
    });
    const lacking = EXPECT.filter(([, has]) => !ticks.some(has)).map(([field, , why]) => ({field, why}));
    if (!ride.event) {
        lacking.push({field: 'event', why: finish.source === 'finish-mode' ?
            'kein Event aufgezeichnet (vor 0.2.13): Ziellinie geschätzt aus dem Beginn des Zielmodus + 500 m' :
            'kein Event und kein Zielmodus: keine Ziellinie, das Rennen läuft bis zum Ende der Aufzeichnung'});
    }
    const ev = ride.event;
    const out = {
        team: head.team ?? head.plan?.team ?? null,
        version: head.version ?? null,
        format: head.v ?? null,
        startedAt: head.startedAt ?? t0,
        event: ev ? {name: ev.name ?? null, type: ev.eventType ?? null, endDistanceM: num(ev.endDistance),
                     laps: ev.laps ?? null, events: ride.eventIds.length} : null,
        plans,
        unknownPlanTicks: unknownTicks,
        analysisPlan: ride.planAllSig ? {sig: ride.planAllSig, otherLiveTicks: otherLive,
                                         otherLive: plans.filter(p => p.sig !== ride.planAllSig).map(p => ({sig: p.sig, from: p.from, to: p.to}))} : null,
        rollOff: {at: rollOff, source: rollSource},
        finish: {endM: num(finish.endM), at: finish.at, source: finish.source},
        recordingS: t0 !== null ? num((tEnd - t0) / 1000) : null,
        raceS: num((raceEnd - rollOff) / 1000),
        ticks: ticks.length,
        badLines: ride.bad,
        holes: {count: holes.length, inRace: holes.filter(h => h.inRace).length, totalS: num(holes.reduce((a, h) => a + h.s, 0)),
                longest: [...holes].sort((a, b) => b.s - a.s).slice(0, 5).map(h => ({from: h.from, s: num(h.s), inRace: h.inRace}))},
        riders,
        lacking,
        notes: ride.notes,
    };
    const issues = [];
    if (ride.planAllSig) {
        issues.push(`ausgewertet mit Plan ${ride.planAllSig} für die ganze Fahrt` +
            (otherLive ? `; live lief ${pct(otherLive, ticks.length)} % der Zeit ein anderer Plan ` +
                `(${out.analysisPlan.otherLive.map(p => p.sig).join(', ')})` : ''));
    }
    if (unknownTicks) {
        issues.push(`${pct(unknownTicks, ticks.length)} % der Ticks unter einem Plancode ohne Plan (--plan angeben)`);
    }
    for (const r of riders) {
        if (r.missing.length) {
            issues.push(`Plan ${r.sig}: ${r.missing.join(', ')} nicht aufgezeichnet${r.stripped ? ' (gekürzter Upload)' : ''}`);
        }
    }
    if (out.holes.inRace) {
        issues.push(`${out.holes.inRace} Lücken > 3 s in meinen Daten im Rennen`);
    }
    if (!finish.at) {
        issues.push('Ziellinie in der Aufzeichnung nicht erreicht');
    } else if (finish.source === 'finish-mode') {
        issues.push('Ziellinie nur geschätzt (aus dem Zielmodus)');
    }
    if (lacking.length) {
        issues.push(`es fehlen: ${lacking.map(x => x.field).join(', ')}`);
    }
    out.verdict = issues.length ? issues.join('; ') : 'vollständig: alle Planfahrer aufgezeichnet, keine Datenlücken, Ziellinie bekannt';
    return out;
}
