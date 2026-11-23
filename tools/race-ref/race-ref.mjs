#!/usr/bin/env node
// Paceline race reference: what really happened in a race, from the recordings of several riders
// (see README.md here).
//   node tools/race-ref/race-ref.mjs <race folder | recording.jsonl[.gz] ...> [--plan <SIG>=<plan.json> ...]
//                                    [--out <dir>] [--names]
// A race folder is what the plan server's Download race tar gives: the recordings (*.jsonl,
// *.jsonl.gz) and plans/<SIG>.json (read as --plan <SIG>=<file>). Writes <dir>/reference.json and
// <dir>/reference.md (default dir: <folder>-reference next to the folder, or <recording name>-reference
// next to the first recording, so real data never lands in the repository by accident).
import fs from 'node:fs';
import path from 'node:path';
import {parsePlanArg} from '../ride-report/load.mjs';
import {readRecording} from '../ride-report/report.mjs';
import {viewsOf} from './input.mjs';
import {buildReference} from './reference.mjs';
import {riderFigures} from './riders.mjs';
import {renderMarkdown} from './render.mjs';

const USAGE = 'usage: node tools/race-ref/race-ref.mjs <race folder | recording.jsonl[.gz] ...> [--plan <SIG>=<plan.json> ...] ' +
    '[--out <dir>] [--names]';
const RECORDING = /\.jsonl(\.gz)?$/i;

// The command line as {inputs, plans: [{sig, path}], outDir, names, help}.
export function parseArgs(argv) {
    const out = {inputs: [], plans: [], outDir: null, names: false, help: false};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--plan') {
            if (!argv[i + 1]) {
                throw new Error('--plan needs <SIG>=<plan.json>');
            }
            out.plans.push(parsePlanArg(argv[++i]));
        } else if (a.startsWith('--plan=')) {
            out.plans.push(parsePlanArg(a.slice(7)));
        } else if (a === '--out') {
            if (!argv[i + 1]) {
                throw new Error('--out needs a directory');
            }
            out.outDir = argv[++i];
        } else if (a.startsWith('--out=')) {
            out.outDir = a.slice(6);
        } else if (a === '--names') {
            out.names = true;
        } else if (a === '-h' || a === '--help') {
            out.help = true;
        } else if (a.startsWith('-')) {
            throw new Error(`unknown option ${a}`);
        } else {
            out.inputs.push(a);
        }
    }
    return out;
}


// The recording files and the plan files the inputs name: a folder gives the *.jsonl and
// *.jsonl.gz files directly in it (other files and folders, such as a ride report's, are left
// alone) and plans/<SIG>.json as the plan <SIG>; a file is a recording. Returns {files, plans}
// with plans as [{sig, path}].
function collect(inputs) {
    const files = [];
    const plans = [];
    for (const input of inputs) {
        if (!fs.statSync(input).isDirectory()) {
            files.push(input);
            continue;
        }
        for (const e of fs.readdirSync(input, {withFileTypes: true}).sort((a, b) => (a.name < b.name ? -1 : 1))) {
            if (e.isFile() && RECORDING.test(e.name)) {
                files.push(path.join(input, e.name));
            }
        }
        const pdir = path.join(input, 'plans');
        if (fs.existsSync(pdir) && fs.statSync(pdir).isDirectory()) {
            for (const name of fs.readdirSync(pdir).sort()) {
                if (/\.json$/i.test(name)) {
                    plans.push({sig: name.slice(0, -5).toUpperCase(), path: path.join(pdir, name)});
                }
            }
        }
    }
    return {files, plans};
}


// reference.json as text: plain arrays for typed arrays, no indentation (per-second data).
function jsonOf(obj) {
    return JSON.stringify(obj, (k, x) => (ArrayBuffer.isView(x) ? Array.from(x) : x)) + '\n';
}


// Builds the reference of the race the arguments name and writes reference.json (the reference
// with t0 and tEnd of the common clock, the code of the plan its positions come from and the rider figures; no rider id or name) and
// reference.md. Returns {outDir} (null for --help).
export function run(argv, {log = console.log} = {}) {
    const args = parseArgs(argv);
    if (args.help) {
        log(USAGE);
        return {outDir: null};
    }
    if (!args.inputs.length) {
        throw new Error('no recording given');
    }
    const {files, plans: folderPlans} = collect(args.inputs);
    if (!files.length) {
        throw new Error('no recording (*.jsonl, *.jsonl.gz) in the input');
    }
    const plans = [...folderPlans, ...args.plans].map(p => ({sig: p.sig, text: fs.readFileSync(p.path, 'utf8')}));
    const input = viewsOf(files.map(f => ({text: readRecording(f)})), {plans});
    const ref = buildReference(input);
    const figures = riderFigures(ref, input);
    const first = path.resolve(args.inputs[0]);
    const dir = args.outDir ?? (fs.statSync(first).isDirectory() ? `${first}-reference` :
        path.join(path.dirname(first), `${path.basename(first).replace(RECORDING, '')}-reference`));
    fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(path.join(dir, 'reference.json'), jsonOf({...ref, t0: input.t0, tEnd: input.tEnd, planSig: input.planSig, figures}));
    fs.writeFileSync(path.join(dir, 'reference.md'), renderMarkdown(ref, figures, {names: args.names ? input.names : null}));
    log(`${files.length} Aufzeichnung(en), ${ref.n} Fahrer, ${ref.turns.length} Züge, ` +
        `Übereinstimmung ${ref.agreement === null ? '–' : `${Math.round(ref.agreement * 1000) / 10} %`}`);
    log(`→ ${path.join(dir, 'reference.md')}, reference.json`);
    return {outDir: dir};
}


if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('/race-ref/race-ref.mjs')) {
    try {
        run(process.argv.slice(2));
    } catch (e) {
        console.error(`race ref: ${e.message}`);
        console.error(USAGE);
        process.exitCode = 1;
    }
}
