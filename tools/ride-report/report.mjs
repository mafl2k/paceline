#!/usr/bin/env node
// Paceline ride report: the standard analysis for a ride recording (see README.md here).
//   node tools/ride-report/report.mjs <recording.jsonl[.gz]> [--plan <SIG>=<plan.json> ...] [--plan-all <SIG>=<plan.json>]
//                                     [--out <dir>] [--names]
// Writes <dir>/report.md and <dir>/report.json (default dir: <recording name>-report next to the
// recording, so a report with real data never lands in the repository by accident). A gzip'd
// recording (the server's stored .jsonl.gz, as /admin downloads it) is read as it is.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {analyse, publicResult} from './analyse.mjs';
import {parsePlanArg} from './load.mjs';
import {renderMarkdown} from './render.mjs';

const USAGE = 'usage: node tools/ride-report/report.mjs <recording.jsonl[.gz]> [--plan <SIG>=<plan.json> ...] ' +
    '[--plan-all <SIG>=<plan.json>] [--out <dir>] [--names]';

export function parseArgs(argv) {
    const out = {file: null, plans: [], planAll: null, outDir: null, names: false};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--plan') {
            if (!argv[i + 1]) {
                throw new Error('--plan needs <SIG>=<plan.json>');
            }
            out.plans.push(parsePlanArg(argv[++i]));
        } else if (a === '--plan-all') {
            if (!argv[i + 1]) {
                throw new Error('--plan-all needs <SIG>=<plan.json>');
            }
            out.planAll = parsePlanArg(argv[++i]);
        } else if (a.startsWith('--plan-all=')) {
            out.planAll = parsePlanArg(a.slice(11));
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
        } else if (out.file === null) {
            out.file = a;
        } else {
            throw new Error(`one recording at a time (${a})`);
        }
    }
    return out;
}


// The recording's text: gunzipped when the file starts with the gzip magic bytes.
export function readRecording(file) {
    const buf = fs.readFileSync(file);
    return (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf) : buf).toString('utf8');
}


export function run(argv, {log = console.log} = {}) {
    const args = parseArgs(argv);
    if (args.help || !args.file) {
        log(USAGE);
        return args.help ? 0 : 2;
    }
    const text = readRecording(args.file);
    const plans = args.plans.map(p => ({sig: p.sig, text: fs.readFileSync(p.path, 'utf8')}));
    const base = path.basename(args.file).replace(/\.jsonl?(\.gz)?$/i, '');
    // The file name of an export holds the recorder's name: only with --names.
    const planAll = args.planAll ? {sig: args.planAll.sig, text: fs.readFileSync(args.planAll.path, 'utf8')} : null;
    const {result} = analyse(text, {plans, planAll, names: args.names, file: args.names ? path.basename(args.file) : null});
    const pub = publicResult(result);
    const dir = args.outDir ?? path.join(path.dirname(args.file), `${base}-report`);
    fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(pub, null, 1) + '\n');
    fs.writeFileSync(path.join(dir, 'report.md'), renderMarkdown(pub));
    for (const [n, k] of [[1, 'overview'], [2, 'pulls'], [3, 'puller'], [4, 'countdown'], [5, 'gaps'], [6, 'finish'], [7, 'upload'], [8, 'views'], [9, 'traffic']]) {
        log(`${n}. ${pub[k].verdict}`);
    }
    log(`→ ${path.join(dir, 'report.md')}, report.json`);
    return 0;
}


if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('/ride-report/report.mjs')) {
    try {
        process.exitCode = run(process.argv.slice(2));
    } catch (e) {
        console.error(`ride report: ${e.message}`);
        console.error(USAGE);
        process.exitCode = 1;
    }
}
