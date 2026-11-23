// Scores an engine's output (engines.mjs) against the race reference: the numbers of the spike
// (who is shown as puller, stalls, my clock, the countdown, the display, the table) plus the
// countdown jumps, chaos while the reference was in order, the figures split by cause and how each
// display episode ended. Works on a reference that went through JSON (plain arrays).
//   node tools/race-ref/score.mjs <engine dir> <reference.json> <recording.jsonl[.gz]> [--plan SIG=file ...]
//                                 [--core rotation|turns] [--filter] [--route file] [--segments file] [--provisional]
import fs from 'node:fs';
import {analyse} from '../ride-report/analyse.mjs';
import {parsePlanArg} from '../ride-report/load.mjs';
import {readRecording} from '../ride-report/report.mjs';
import {runEngine} from './engines.mjs';
import {START_S, TRAFFIC_BEFORE_S} from './reference.mjs';

const CHANGES_IN_ORDER = ['next', 'skip', 'same'];        // change classes of a line in order
const IN_ORDER = ['first', ...CHANGES_IN_ORDER];          // reference labels in order
const CD_JUMP_S = 10;                                      // a countdown step of this many seconds is a jump
const STALL_S = 11;                                        // a wrong puller this many seconds in a row is a stall
const PULLER_FROM_S = 5;                                   // the puller is judged from this many seconds into a turn
export const DISP_NEAR_HILL_S = 60;                        // a display this close to a reference hill window belongs to it
export const BELOW_LONG_S = 30;                            // a rider shown below the line this long while in the group is a long drop
const fmt = s => `+${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const pct = (ok, n) => (n ? +(100 * ok / n).toFixed(1) : null);
const amed = xs => {
    const a = xs.map(Math.abs).sort((x, y) => x - y);
    return a.length ? a[a.length >> 1] : null;
};


// The puller figures over a list of turns: {nFlat, okFlat, nRest, okRest, stalls}. Seconds count
// from PULLER_FROM_S into a turn (the change itself is not judged), flat and rest (start, end,
// climb) apart; a stall is STALL_S seconds of a wrong shown puller (not 0) in one turn.
function pullerFigures(ref, out, turns) {
    const f = {nFlat: 0, okFlat: 0, nRest: 0, okRest: 0, stalls: 0};
    for (const t of turns) {
        for (let s = t.start + PULLER_FROM_S; s <= t.end; s++) {
            if (ref.ctx[s] === 'flat') {
                f.nFlat++;
                f.okFlat += out.pul[s] === t.who ? 1 : 0;
            } else {
                f.nRest++;
                f.okRest += out.pul[s] === t.who ? 1 : 0;
            }
        }
        let run = 0;
        for (let s = t.start; s <= t.end; s++) {
            if (out.pul[s] && out.pul[s] !== t.who) {
                run++;
                if (run === STALL_S) {
                    f.stalls++;
                }
            } else {
                run = 0;
            }
        }
    }
    return f;
}


// True when traffic ahead or in the line was seen in the TRAFFIC_BEFORE_S seconds up to the turn's start.
function afterTraffic(ref, turn) {
    for (let s = Math.max(0, turn.start - TRAFFIC_BEFORE_S); s <= turn.start; s++) {
        if (ref.traffic[s]?.ahead === true || ref.traffic[s]?.inLine === true) {
            return true;
        }
    }
    return false;
}


// The display episodes (runs of out.disp = 1, seconds without a tick bridged) as [{start, end, refReturn, wrongEnd}]. refReturn: the
// start of the first reference turn after the episode's start that is the first of two in-order
// changes in a row (null when there is none). wrongEnd: a back change among the next two changes
// of the reference after the episode's end.
function displayEnds(ref, out) {
    const eps = [];
    // A second without a tick (out.seen 0; no out.seen: every second was seen) carries the state of
    // the one before: one missing tick does not end a display. An episode's end is its last second
    // seen on.
    let on = false;
    for (let s = 0; s < ref.N; s++) {
        if (out.seen && !out.seen[s]) {
            continue;
        }
        const now = !!out.disp[s];
        if (now && on) {
            eps.at(-1).end = s;
        } else if (now) {
            eps.push({start: s, end: s});
        }
        on = now;
    }
    const T = ref.turns;
    return eps.map(({start, end}) => {
        let refReturn = null;
        for (let i = 0; i + 1 < T.length; i++) {
            if (T[i].start > start && CHANGES_IN_ORDER.includes(T[i].kind) && CHANGES_IN_ORDER.includes(T[i + 1].kind)) {
                refReturn = T[i].start;
                break;
            }
        }
        const wrongEnd = T.filter(t => t.start > end).slice(0, 2).some(t => t.kind === 'back');
        return {start, end, refReturn, wrongEnd};
    });
}


// The provisional view's figures (score's provS, provRight, provJump); all null without out.prov.
function provFigures(ref, out) {
    const p = out.prov;
    if (!p) {
        return {provS: null, provRight: null, provJump: null};
    }
    let n = 0;
    let ok = 0;
    for (const t of ref.turns) {
        for (let s = t.start + PULLER_FROM_S; s <= t.end && s < ref.N; s++) {
            if (p[s]) {
                n++;
                ok += out.pul[s] === t.who ? 1 : 0;
            }
        }
    }
    const jumps = [];
    for (let s = 1; s < ref.N; s++) {
        const d = Math.abs(out.toMy[s] - out.toMy[s - 1]);
        if (p[s - 1] && !p[s] && !out.mine[s] && out.toMy[s] != null && out.toMy[s - 1] != null && d >= CD_JUMP_S) {
            jumps.push(d);
        }
    }
    return {provS: p.reduce((a, x) => a + (x ? 1 : 0), 0), provRight: pct(ok, n), provJump: {med: amed(jumps), n: jumps.length}};
}


// The score of an engine's output `out` (runEngine) against the reference `ref` (buildReference,
// or its JSON) for the recorder at plan position `me`. Returns {pullerFlat, pullerRest (percent of
// the seconds from 5 s into each reference turn with the right puller shown), stalls, lagMed,
// lagP90 (seconds until the new puller is shown, flat changes), restarts, restartsAt, lostS,
// lostDisp (my clock restarting by more than 10 s inside my turn, my turn seconds without mine, and
// those with a display on), cdVsRef (median absolute error of my countdown 60, 30 and 10 s before
// my flat turns against ref.countdown[me]), cdJumps (seconds my countdown steps by 10 s or more
// while not mine), cdN, dispFlatOk, dispHill, hillS, chaosInOrder (seconds the engine's chaos was
// on while the reference label was in order), belowIn, flick (riders shown below the line while in
// the reference group; episodes under 30 s of such riders), byCause {team, traffic}: {pullerFlat,
// stalls} over the turns that did not and did start within TRAFFIC_BEFORE_S after traffic,
// displayEnds, hillDisp [{start, end, dispS}] (per reference hill window: the seconds of it with a
// display on), dispOffHill (display episodes, as displayEnds, that start more than DISP_NEAR_HILL_S
// outside every hill window), belowLong (per rider, runs of more than BELOW_LONG_S seconds shown
// below the line while in the reference group, seconds up to 2 s apart one run, as flick; counted
// while I am in the group), provS (seconds with a provisional view: the new core's view after a
// climb, --provisional), provRight (percent of those seconds, from 5 s into a reference turn, with
// that turn's rider as the provisional puller), provJump {med, n} (my countdown steps of CD_JUMP_S
// or more at the second a provisional view ends, i.e. when the order was confirmed or replaced:
// their median and count; a second without a countdown or with my pull is not counted)}. A figure
// without a basis is null (the prov figures without out.prov: an old adapter).
export function score(ref, out, {me}) {
    const T = ref.turns;
    const flat = s => ref.ctx[s] === 'flat';
    const all = pullerFigures(ref, out, T);
    const trafficTurns = T.filter(t => afterTraffic(ref, t));
    const byCause = {};
    for (const [name, list] of [['team', T.filter(t => !trafficTurns.includes(t))], ['traffic', trafficTurns]]) {
        const f = pullerFigures(ref, out, list);
        byCause[name] = {pullerFlat: pct(f.okFlat, f.nFlat), stalls: f.stalls};
    }
    const lags = [];
    for (let i = 1; i < T.length; i++) {
        const t = T[i];
        if (!flat(t.start)) {
            continue;
        }
        for (let s = t.start - 20; s <= Math.min(t.end, t.start + 60); s++) {
            if (out.pul[s] === t.who) {
                lags.push(s - t.start);
                break;
            }
        }
    }
    lags.sort((a, b) => a - b);
    // My clock restarts and the lost seconds inside my reference turns.
    let restarts = 0;
    let lostS = 0;
    let lostDisp = 0;
    const at = [];
    for (const t of T.filter(t => t.who === me)) {
        let p = null;
        for (let s = t.start + PULLER_FROM_S; s <= t.end; s++) {
            if (out.el[s] != null && p !== null && out.el[s] < p - 10) {
                restarts++;
                at.push(fmt(s));
            }
            if (!out.mine[s]) {
                lostS++;
                lostDisp += out.disp[s] ? 1 : 0;
            }
            if (out.el[s] != null) {
                p = out.el[s];
            }
        }
    }
    // The countdown against the reference countdown, 60, 30 and 10 s before my flat turns.
    const cdErr = [];
    for (const t of T.filter((t, i) => i > 0 && t.who === me && flat(t.start))) {
        for (const L of [60, 30, 10]) {
            const s = t.start - L;
            const rc = ref.countdown?.[me]?.[s];
            if (s >= 0 && out.toMy[s] != null && !out.mine[s] && rc != null) {
                cdErr.push(out.toMy[s] - rc);
            }
        }
    }
    let cdJumps = 0;
    for (let s = 1; s < ref.N; s++) {
        if (!out.mine[s] && out.toMy[s] != null && out.toMy[s - 1] != null && Math.abs(out.toMy[s] - out.toMy[s - 1]) >= CD_JUMP_S) {
            cdJumps++;
        }
    }
    // The display (chaos or climb) on the flat while the reference was in order, and on climbs.
    let dispFlatOk = 0;
    let dispHill = 0;
    let hillS = 0;
    let chaosInOrder = 0;
    for (let s = 0; s < ref.raceS; s++) {
        if (flat(s) && out.disp[s] && [...IN_ORDER, 'none'].includes(ref.label[s])) {
            dispFlatOk++;
        }
        if (ref.ctx[s] === 'climb') {
            hillS++;
            dispHill += out.disp[s] ? 1 : 0;
        }
        if (out.chaos?.[s] && IN_ORDER.includes(ref.label[s])) {
            chaosInOrder++;
        }
    }
    // The table: riders of the reference group shown below the line while I am in the group, and the
    // episodes of such riders shown for under 30 s.
    let belowIn = 0;
    let flick = 0;
    const cur = {};
    for (let s = START_S; s < ref.raceS; s++) {
        const b = out.below[s];
        if (!b || !ref.present[me]?.[s]) {
            continue;
        }
        const shown = new Set(b);
        for (let k = 1; k <= ref.n; k++) {
            if (k === me || !shown.has(k)) {
                continue;
            }
            if (ref.present[k][s]) {
                belowIn++;
            }
            if (cur[k] && cur[k].end >= s - 2) {
                cur[k].end = s;
            } else {
                if (cur[k] && cur[k].end - cur[k].start < 30 && cur[k].inGrp) {
                    flick++;
                }
                cur[k] = {start: s, end: s, inGrp: true};
            }
            if (!ref.present[k][s]) {
                cur[k].inGrp = false;
            }
        }
    }
    for (const c of Object.values(cur)) {
        if (c.end - c.start < 30 && c.inGrp) {
            flick++;
        }
    }
    // The runs of long drops: a rider both shown below the line and in the reference group, with me.
    let belowLong = 0;
    const runs = {};
    const endRun = k => {
        if (runs[k] && runs[k].end - runs[k].start > BELOW_LONG_S) {
            belowLong++;
        }
    };
    for (let s = START_S; s < ref.raceS; s++) {
        const b = out.below[s];
        if (!b || !ref.present[me]?.[s]) {
            continue;
        }
        for (const k of b) {
            if (k === me || !ref.present[k]?.[s]) {
                continue;
            }
            if (runs[k] && runs[k].end >= s - 2) {
                runs[k].end = s;
            } else {
                endRun(k);
                runs[k] = {start: s, end: s};
            }
        }
    }
    Object.keys(runs).forEach(endRun);
    const ends = displayEnds(ref, out);
    const hills = ref.hills ?? [];
    const hillDisp = hills.map(h => {
        let dispS = 0;
        for (let s = h.start; s <= h.end && s < ref.N; s++) {
            dispS += out.disp[s] ? 1 : 0;
        }
        return {start: h.start, end: h.end, dispS};
    });
    const dispOffHill = ends.filter(e => hills.every(h => e.start < h.start - DISP_NEAR_HILL_S || e.start > h.end + DISP_NEAR_HILL_S)).length;
    const prov = provFigures(ref, out);
    return {pullerFlat: pct(all.okFlat, all.nFlat), pullerRest: pct(all.okRest, all.nRest), stalls: all.stalls,
            lagMed: lags[lags.length >> 1] ?? null, lagP90: lags[Math.floor(lags.length * 0.9)] ?? null,
            restarts, restartsAt: at.join(' '), lostS, lostDisp, cdVsRef: amed(cdErr), cdJumps, cdN: cdErr.length,
            dispFlatOk, chaosInOrder, dispHill, hillS, belowIn, flick, byCause, displayEnds: ends, hillDisp, dispOffHill,
            belowLong, ...prov};
}


const USAGE = 'usage: node tools/race-ref/score.mjs <engine dir> <reference.json> <recording.jsonl[.gz]> [--plan SIG=file ...] ' +
    '[--core rotation|turns] [--filter] [--route <getRoute.json>] [--segments <getSegments.json>] [--provisional]';

// The CLI: reads the reference, replays the recording through the engine at <engine dir> and prints
// the score as JSON. The positions come from the plan the reference was built on (reference.json's
// planSig, which the recording or a --plan file must hold; else an error names it); the grid from the
// reference's t0 (the reference file's own, else the recording's roll-off) and N. --core picks the
// engine adapter (default: by the checkout, see runEngine), --filter turns the new core's power
// filter on, --route is a JSON file with Sauce's getRoute answer (the climb index when the recording
// holds none; the route's own segments count); --segments is accepted and not used for the index;
// --provisional shows the new core's provisional view after a climb (measuring only).
export async function run(argv, {log = console.log} = {}) {
    const files = [];
    const plans = [];
    const opts = {core: 'auto', filter: false, route: null, segments: null, provisional: false};
    const json = (flag, file) => {
        if (!file) {
            throw new Error(`${flag} needs a JSON file`);
        }
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--core') {
            if (!['rotation', 'turns'].includes(argv[i + 1])) {
                throw new Error('--core needs rotation or turns');
            }
            opts.core = argv[++i];
        } else if (argv[i] === '--filter') {
            opts.filter = true;
        } else if (argv[i] === '--provisional') {
            opts.provisional = true;
        } else if (argv[i] === '--route') {
            opts.route = json('--route', argv[++i]);
        } else if (argv[i] === '--segments') {
            opts.segments = json('--segments', argv[++i]);
        } else if (argv[i] === '--plan') {
            if (!argv[i + 1]) {
                throw new Error('--plan needs <SIG>=<plan.json>');
            }
            const p = parsePlanArg(argv[++i]);
            plans.push({sig: p.sig, text: fs.readFileSync(p.path, 'utf8')});
        } else if (argv[i].startsWith('-')) {
            throw new Error(`unknown option ${argv[i]}`);
        } else {
            files.push(argv[i]);
        }
    }
    if (files.length !== 3) {
        log(USAGE);
        return 2;
    }
    const [dir, refFile, recFile] = files;
    const ref = JSON.parse(fs.readFileSync(refFile, 'utf8'));
    const {result, ride} = analyse(readRecording(recFile), {plans});
    if (!ride) {
        throw new Error('no ticks in the recording');
    }
    // The riders are numbered by the plan the reference was built on (planSig), not by the plan the
    // recording ends on: those can differ (a plan switch, or a plan the recording does not hold).
    if (ref.planSig === undefined) {
        throw new Error('the reference has no planSig (made by an older race-ref): build it again');
    }
    const plan = ride.plans.get(ref.planSig);
    if (!plan) {
        throw new Error(`the reference was built on plan ${ref.planSig}, which the recording does not hold (pass --plan ${ref.planSig}=<plan.json>)`);
    }
    const pos = Object.fromEntries(plan.riders.map((r, i) => [String(r.id), i + 1]));
    const t0 = ref.t0 ?? result.overview.rollOff.at;
    const me = pos[String(ride.selfId)] ?? 0;
    const out = await runEngine(dir, ride, {N: ref.N, t0, pos, plan, ...opts});
    log(JSON.stringify(score(ref, out, {me}), null, 2));
    return 0;
}


if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('/race-ref/score.mjs')) {
    try {
        process.exitCode = await run(process.argv.slice(2));
    } catch (e) {
        console.error(`race ref score: ${e.message}`);
        console.error(USAGE);
        process.exitCode = 1;
    }
}
