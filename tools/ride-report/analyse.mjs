// The ride report's analysis: all checks over one recording. Pure (text in, result out), so the
// tests need no files.
import {parseRecording, readPlan} from './load.mjs';
import {makeRide} from './ride.mjs';
import {replay} from './replay.mjs';
import {overview} from './checks/overview.mjs';
import {groundTruth} from './checks/pulls.mjs';
import {pullerCheck} from './checks/puller.mjs';
import {countdownCheck} from './checks/countdown.mjs';
import {gapsCheck} from './checks/gaps.mjs';
import {finishCheck} from './checks/finish.mjs';
import {uploadCheck} from './checks/upload.mjs';
import {viewsCheck} from './checks/views.mjs';

export const REPORT_VERSION = 1;

// text: the recording. plans: [{sig, text}] (sig null: the file's own code). planAll: {sig, text}:
// judge every second by this plan (--plan-all). names: first names.
export function analyse(text, {plans = [], planAll = null, names = false, file = null} = {}) {
    const parsed = parseRecording(text);
    if (!parsed.ticks.length) {
        return {result: noTicks(parsed, file), ride: null};
    }
    const extraPlans = plans.map(({sig, text: t}) => {
        const {plan, form, warnings} = readPlan(t);
        return {sig, plan, form, warnings};
    });
    let all = null;
    if (planAll) {
        const {plan, form, warnings} = readPlan(planAll.text);
        all = {sig: planAll.sig, plan, form, warnings};
    }
    const ride = makeRide(parsed, {extraPlans, planAll: all, names});
    if (all) {
        ride.notes.push(`Plan ${ride.planAllSig} aus Datei (${all.form}, ${all.plan.riders.length} Fahrer) gilt für jede Sekunde ` +
            '(--plan-all); welcher Plan live lief, zeigen die Plancodes' + (all.warnings.length ? `, Hinweise: ${all.warnings.join(', ')}` : ''));
    }
    for (const p of extraPlans) {
        ride.notes.push(`Plan ${p.sig ?? p.plan.sig} aus Datei (${p.form}, ${p.plan.riders.length} Fahrer)` +
            (p.warnings.length ? `, Hinweise: ${p.warnings.join(', ')}` : ''));
    }
    const {frames, startAt} = replay(ride);
    const ov = overview(ride, {startAt});
    const from = ov.rollOff.at;
    const to = ride.finish.at ?? ride.ticks.at(-1).ts;
    const gt = groundTruth(ride, {from, to});
    const result = {
        kind: 'paceline-ride-report',
        reportVersion: REPORT_VERSION,
        file,
        overview: ov,
        pulls: gt,
        puller: pullerCheck(ride, gt, frames, {from, to, rollOff: from}),
        countdown: countdownCheck(ride, gt, {from, to}),
        gaps: gapsCheck(ride, frames, {from, to}),
        finish: finishCheck(ride),
        upload: uploadCheck(ride, text),
        views: viewsCheck(ride, gt, {from, to}),
    };
    return {result, ride};
}


// A recording with only its head line (the recorder stopped before the first tick).
function noTicks({head, bad}, file) {
    const skip = {skipped: 'keine Ticks in der Aufzeichnung', verdict: 'entfällt (keine Ticks)'};
    return {
        kind: 'paceline-ride-report', reportVersion: REPORT_VERSION, file,
        overview: {...skip, verdict: 'keine Ticks: die Aufzeichnung hat nur die Kopfzeile', team: head.team ?? head.plan?.team ?? null,
                   version: head.version ?? null, startedAt: head.startedAt ?? null, rollOff: {at: null}, ticks: 0, badLines: bad},
        pulls: skip, puller: skip, countdown: skip, gaps: skip, finish: skip, upload: skip, views: skip,
    };
}


// The result without internal fields (keys starting with _), for report.json.
export function publicResult(x) {
    if (Array.isArray(x)) {
        return x.map(publicResult);
    }
    if (x && typeof x === 'object') {
        return Object.fromEntries(Object.entries(x).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, publicResult(v)]));
    }
    return x;
}
