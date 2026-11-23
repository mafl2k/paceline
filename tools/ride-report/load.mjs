// Reading a Paceline recording (JSONL) and plan files for the ride report. No file system access
// here: the CLI reads the files, so the tests can pass text.
import {importFiles, planSig} from '../../pages/src/engine/plan.mjs';
import {recordFiles} from '../../pages/src/engine/planserver.mjs';

// The recording: the head line and the ticks (lines with a riders array). Lines that are no JSON
// are counted, not fatal (a recording cut off mid-line).
export function parseRecording(text) {
    const lines = String(text).split('\n').filter(l => l.trim());
    if (!lines.length) {
        throw new Error('empty recording');
    }
    let head;
    try {
        head = JSON.parse(lines[0]);
    } catch (e) {
        throw new Error('the first line is no JSON (not a Paceline recording)');
    }
    if (!head || head.kind !== 'paceline-recording') {
        throw new Error(`the first line is no Paceline recording head (kind ${JSON.stringify(head?.kind)})`);
    }
    let bad = 0;
    let other = 0;
    const ticks = [];
    for (const line of lines.slice(1)) {
        let t;
        try {
            t = JSON.parse(line);
        } catch (e) {
            bad++;
            continue;
        }
        if (t && Number.isFinite(t.ts) && Array.isArray(t.riders)) {
            ticks.push(t);
        } else {
            other++;
        }
    }
    ticks.sort((a, b) => a.ts - b.ts);
    return {head, ticks, bad, other};
}


// A plan file in any of three forms, as the engine's plan ({sig, team, riders, bench, ...}):
// - the plan server's stored form {json, text, sig?} (recordFiles turns it back into the files);
// - the planner JSON (riders keyed by Zwift id, as zwiftgopher exports it);
// - an engine plan as a recording's head carries it (riders as an array with id and pullS).
// Returns {plan, form, warnings}.
export function readPlan(text) {
    let obj;
    try {
        obj = JSON.parse(text);
    } catch (e) {
        throw new Error('the plan file is no JSON');
    }
    if (obj && obj.kind === 'paceline-recording' && obj.plan) {
        obj = obj.plan;
    }
    if (obj && (typeof obj.json === 'object' || typeof obj.json === 'string')) {
        const files = recordFiles(obj);
        if (!files) {
            throw new Error('the plan server record holds no planner JSON');
        }
        const {plan, warnings} = importFiles([files.json, files.text].filter(Boolean));
        return {plan, form: 'server', warnings: warnings.map(w => w.code)};
    }
    if (obj && Array.isArray(obj.riders) && obj.riders.every(r => r && r.id != null && Number.isFinite(r.pullS))) {
        const plan = {sig: '', team: obj.team ?? null, targetSpeed: obj.targetSpeed ?? null,
                      minimumFinishers: obj.minimumFinishers ?? 0, bench: Array.isArray(obj.bench) ? obj.bench : [],
                      ...obj, riders: obj.riders.map(r => ({...r, id: String(r.id)}))};
        plan.sig = obj.sig || planSig(plan);
        return {plan, form: 'engine', warnings: []};
    }
    if (obj && obj.riders && typeof obj.riders === 'object') {
        const {plan, warnings} = importFiles([text]);
        return {plan, form: 'planner', warnings: warnings.map(w => w.code)};
    }
    throw new Error('the plan file is neither a planner JSON, a plan server record nor an engine plan');
}


// "--plan SIG=path" → {sig, path}; a bare path takes the sig from the file.
export function parsePlanArg(arg) {
    const m = /^([0-9A-Za-z]{6})=(.+)$/.exec(arg);
    return m ? {sig: m[1].toUpperCase(), path: m[2]} : {sig: null, path: arg};
}
