// Run with: node --test server/tests/logs.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {gunzipSync, gzipSync} from 'node:zlib';
import {LOG_NAME_RE, LOG_MAX_LINE, LOG_MAX_DEPTH, LOG_MAX_IN_FLIGHT, LOG_BODY_MS, LOG_MAX_SIGS, LOG_MAX_FILES, ARCHIVE_MAX, QUOTA_BLOCK, quotaBytes,
    checkRecording, knownPlans, makeLogStore, writeAtomic, withoutRiders} from '../logs.mjs';
import {normalizePlan} from '../../pages/src/engine/plan.mjs';
import {parseRecording, readPlan} from '../../tools/ride-report/load.mjs';
import {openDb} from '../db.mjs';
import {openStore} from '../store.mjs';
import {club, sheet, startServer, T, rows, changes, refuseWrites} from './helpers.mjs';

const KF = 'k7f3q9x2m4';
const SP = 'p2m8c4t1v9';
const MOD = '0.3.0-beta.1';
const NOW = T('2026-11-20T12:00Z');
const DAY = 86400000;
const SESSION = String(T('2026-11-19T18:20Z'));
const MB = 1024 * 1024;

const team = name => ({name, start: '19:30', live: null, version: 1, undo: null, changedAt: null});


// Kettenfett RC: team rollers, a stored sheet listing Ben (1001) and Cleo (1002).
function kettenfett() {
    return club({
        teams: {rollers: team('Rollers')},
        sheets: {ra0001: sheet({team: 'rollers', label: 'Rollers', date: '2026-11-19', riders: ['1001', '1002'], uploadedAt: '2026-11-19T16:00:00.000Z'})},
    });
}


// Spokesmen CC: team spokes, a stored sheet listing Ben and Eva.
function spokesmen() {
    return club({
        id: SP, name: 'Spokesmen CC', createdAt: '2026-10-01T10:00:00.000Z',
        teams: {spokes: team('Spokes')},
        sheets: {pa0001: sheet({team: 'spokes', label: 'Spokes', date: '2026-11-19', riders: ['1001', '1004'], uploadedAt: '2026-11-19T15:00:00.000Z'})},
    });
}


const HEAD = {kind: 'paceline-recording', v: 1, plan: {riders: [{id: '1001'}, {id: '1002'}], bench: []}};
const OK_ROWS = [{id: '1001', self: true}, {id: '1002'}];

// A gzip'd recording: the head line, two ticks with these rows, then the `extra` lines.
function rec(rows = OK_ROWS, {extra = []} = {}) {
    const lines = [JSON.stringify(HEAD), JSON.stringify({ts: 1, riders: rows}), JSON.stringify({ts: 2, riders: rows}), ...extra];
    return gzipSync(lines.join('\n') + '\n');
}


async function setup(t, {env = {}, clubs = [kettenfett(), spokesmen()], prepare} = {}) {
    const clock = {now: NOW};
    const s = await startServer({env: {LOG_MAX_FILE_MB: '0.01', ...env}, clock, prepare});
    t.after(() => s.stop());
    for (const c of clubs) {
        s.store.create(c);
    }
    const post = (slug, params, body = rec()) =>
        fetch(`${s.base}/api/log/${slug}?${new URLSearchParams(params)}`, {method: 'POST', body});
    const logFile = (cid, slug, name) => path.join(s.dataDir, 'logs', cid, slug, name);
    return {...s, clock, post, logFile};
}

const params = (extra = {}) => ({circle: KF, session: SESSION, athlete: '1001', mod: MOD, ...extra});

// The text of a gzip. The server stores what it checked, gzip'd again (18 Nov 2026), so a stored
// file is compared by its content.
const unz = buf => gunzipSync(buf).toString('utf8');


// Every file below dir, relative, sorted.
function tree(dir) {
    if (!fs.existsSync(dir)) {
        return [];
    }
    return fs.readdirSync(dir, {recursive: true}).map(String).sort();
}


// Runs fn with console[kind] collected; returns {result, lines}.
function capture(kind, fn) {
    const lines = [];
    const orig = console[kind];
    console[kind] = (...x) => lines.push(x.join(' '));
    try {
        return {result: fn(), lines};
    } finally {
        console[kind] = orig;
    }
}


async function expectStatus(r, status, body) {
    const text = await r.text();
    assert.equal(r.status, status, text);
    if (body !== undefined) {
        assert.deepEqual(JSON.parse(text), body);
    }
}


test('LOG_NAME_RE', () => {
    assert.match(`${SESSION}-1001.jsonl.gz`, LOG_NAME_RE);
    assert.doesNotMatch('../1-1001.jsonl.gz', LOG_NAME_RE);
    assert.doesNotMatch('1-1001.jsonl', LOG_NAME_RE);
    assert.doesNotMatch('12345678901234567-1001.jsonl.gz', LOG_NAME_RE);
    assert.doesNotMatch('1-1234567890123.jsonl.gz', LOG_NAME_RE);
});


test('checkRecording: the rule', async () => {
    const check = gz => checkRecording(gz, {athleteId: '1001', maxBytes: 100000});
    assert.equal(await check(rec()), 'ok');
    // bench riders count as the plan; empty lines are skipped
    const benchHead = {...HEAD, plan: {riders: [{id: '1001'}], bench: [{id: '1003'}]}};
    assert.equal(await check(gzipSync(JSON.stringify(benchHead) + '\n\n' + JSON.stringify({riders: [{id: '1003'}]}) + '\n')), 'ok');
    // a line without a riders array is not checked further
    assert.equal(await check(gzipSync(JSON.stringify(HEAD) + '\n' + JSON.stringify({ts: 1, note: 'x'}))), 'ok');
    // the head must be a JSON object
    assert.equal(await check(gzipSync('[1]\n')), 'refused');
    assert.equal(await check(gzipSync('\n' + JSON.stringify({riders: []}) + '\n')), 'refused');
    assert.equal(await check(gzipSync('')), 'refused');
    // a later line that is no object
    assert.equal(await check(rec(OK_ROWS, {extra: ['[]']})), 'refused');
    assert.equal(await check(rec(OK_ROWS, {extra: ['null']})), 'refused');
    // a row that is no object
    assert.equal(await check(rec([{id: '1001', self: true}, null])), 'refused');
    // self, but another athlete than the uploader, and in no plan: not refused, the row is dropped
    // (user, 18 Nov 2026); both ticks count
    const stats = {dropped: 0};
    assert.equal(await checkRecording(rec([{id: '1009', self: true}]), {athleteId: '1001', maxBytes: 100000, stats}), 'ok');
    assert.equal(stats.dropped, 2);
    // gzip errors
    assert.equal(await check(Buffer.from('not gzip at all')), 'bad');
    assert.equal(await check(rec().subarray(0, 20)), 'bad');
    // over maxBytes unpacked
    assert.equal(await checkRecording(gzipSync(Buffer.alloc(5000, 0x20)), {athleteId: '1001', maxBytes: 4000}), 'toolarge');
});


test('checkRecording: heartrate and cadence anywhere, nesting bounded', async () => {
    const check = gz => checkRecording(gz, {athleteId: '1001', maxBytes: 1000000});
    const lines = (...xs) => gzipSync(xs.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join('\n') + '\n');
    const tick = {ts: 1, riders: OK_ROWS};
    assert.equal(await check(lines(HEAD, tick)), 'ok');
    // at the tick's top level
    assert.equal(await check(lines(HEAD, {...tick, heartrate: 140})), 'refused');
    assert.equal(await check(lines(HEAD, {...tick, cadence: null})), 'refused');
    // nested in an object, and in an array of objects, of a tick
    assert.equal(await check(lines(HEAD, {...tick, self: {power: 300, data: {heartrate: 140}}})), 'refused');
    assert.equal(await check(lines(HEAD, {...tick, extra: [{x: 1}, {cadence: 90}]})), 'refused');
    // riders given as an object is no longer a way round
    assert.equal(await check(lines(HEAD, {ts: 1, riders: {a: {id: '1001', heartrate: 1}}})), 'refused');
    // in the head, at the top and inside the plan
    assert.equal(await check(lines({...HEAD, heartrate: 1}, tick)), 'refused');
    assert.equal(await check(lines({...HEAD, plan: {riders: [{id: '1001', cadence: 80}], bench: []}}, tick)), 'refused');
    // the words as values or in other keys are fine
    assert.equal(await check(lines(HEAD, {...tick, note: 'heartrate', heartrateZone: 2})), 'ok');
    // nesting: LOG_MAX_DEPTH levels of objects are refused, one fewer passes
    const nest = n => {
        let v = 1;
        for (let i = 0; i < n; i++) {
            v = {v};
        }
        return v;
    };
    assert.equal(await check(lines(HEAD, {...tick, deep: nest(LOG_MAX_DEPTH - 1)})), 'ok');
    assert.equal(await check(lines(HEAD, {...tick, deep: nest(LOG_MAX_DEPTH)})), 'refused');
    // a deeply nested array inside a tick does not blow the stack
    assert.equal(await check(lines(HEAD, '{"ts":1,"deep":' + '['.repeat(50000) + ']'.repeat(50000) + '}')), 'refused');
});


test('checkRecording: the line cap', async () => {
    const check = gz => checkRecording(gz, {athleteId: '1001', maxBytes: 10 * LOG_MAX_LINE});
    assert.equal(LOG_MAX_LINE, 256 * 1024);
    // a realistic head: 40 riders with 100-character names, as the mod's onStart meta writes it
    const riders = {};
    for (let i = 0; i < 40; i++) {
        riders[String(2000000 + i)] = {name: 'N'.repeat(99) + (i % 10), weight: 70, ftp: 250, order: i + 1,
            pull_duration: 60, pull_power: 400, color: '#ff0000'};
    }
    const {plan} = normalizePlan({team: {name: 'T'.repeat(40)}, riders, roster: {}}, null);
    const head = {kind: 'paceline-recording', v: 1, sessionId: 1, startedAt: 1, planSig: plan.sig, team: plan.team,
        selfId: '2000000', selfName: 'N'.repeat(100), version: '0.3.0', display: {targetUnit: 'w', showNext: true},
        slug: 'rollers', plan};
    const headLine = JSON.stringify(head);
    assert.equal(plan.riders.length, 40);
    assert.ok(headLine.length < LOG_MAX_LINE / 16, String(headLine.length));
    assert.equal(await check(gzipSync(headLine + '\n' + JSON.stringify({riders: [{id: '2000000', self: true}]}) + '\n')), 'ok');
    // a tick line just under the cap passes, just over it (with or without a newline) is too large
    const padded = n => JSON.stringify({ts: 1, pad: 'x'.repeat(n - 20)}).padEnd(n, ' ');
    assert.equal(await check(gzipSync(JSON.stringify(HEAD) + '\n' + padded(LOG_MAX_LINE) + '\n')), 'ok');
    assert.equal(await check(gzipSync(JSON.stringify(HEAD) + '\n' + padded(LOG_MAX_LINE + 1) + '\n')), 'toolarge');
    assert.equal(await check(gzipSync(JSON.stringify(HEAD) + '\n' + 'x'.repeat(LOG_MAX_LINE + 1))), 'toolarge');
});


test('checkRecording: lines over many chunks', async () => {
    const check = gz => checkRecording(gz, {athleteId: '1001', maxBytes: 10 * LOG_MAX_LINE});
    // ~200 KB lines (a dozen gunzip chunks each) of two- and three-byte characters
    const long = extra => JSON.stringify({ts: 1, note: 'ü✓'.repeat(60000), riders: OK_ROWS, ...extra});
    assert.ok(Buffer.byteLength(long({})) > 200000 && long({}).length < LOG_MAX_LINE);
    const ok = JSON.stringify(HEAD) + '\n' + long({}) + '\n' + long({}) + '\n';
    assert.equal(await check(gzipSync(ok)), 'ok');
    // the forbidden key at the very end of a long line, terminated or not
    assert.equal(await check(gzipSync(ok + long({heartrate: 1}) + '\n')), 'refused');
    assert.equal(await check(gzipSync(ok + long({heartrate: 1}))), 'refused');
    assert.equal(await check(gzipSync(ok + long({}))), 'ok');
    // a long head line split over chunks
    assert.equal(await check(gzipSync(JSON.stringify({...HEAD, note: 'ü✓'.repeat(60000)}) + '\n' + long({}))), 'ok');
});


test('recordings: stored per club', async t => {
    const s = await setup(t);
    const body = rec();
    const r = await s.post('rollers', params(), body);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    const name = `${SESSION}-1001.jsonl.gz`;
    await expectStatus(r, 201, {ok: true, file: name});
    assert.equal(unz(fs.readFileSync(s.logFile(KF, 'rollers', name))), unz(body));
    // the upload was written to logs/.incoming first and moved from there: nothing is left
    assert.deepEqual(tree(path.join(s.dataDir, 'logs')), [KF, `${KF}/rollers`, `${KF}/rollers/${name}`].sort());
    // and it is in the index, with the size of the file as stored
    const size = fs.statSync(s.logFile(KF, 'rollers', name)).size;
    assert.deepEqual(s.server.logs.list(KF), [{slug: 'rollers', file: name, session: Number(SESSION), athlete: '1001', size}]);
    assert.equal(s.server.logs.recordingCount(KF), 1);
    // stored at the server's clock
    assert.deepEqual(rows(s.server.db, 'SELECT stored_at FROM recordings'), [{stored_at: NOW}]);
});


test('recordings: team and circle checks', async t => {
    const s = await setup(t);
    await expectStatus(await s.post('nobody', params()), 404, {error: 'no such team'});
    await expectStatus(await s.post('rollers', params({circle: SP})), 403, {error: 'not in this team'});
    await expectStatus(await s.post('rollers', params({athlete: '1009'})), 403, {error: 'not in this team'});
    // Eva is listed by Spokesmen CC only
    await expectStatus(await s.post('rollers', params({athlete: '1004'})), 403, {error: 'not in this team'});
    assert.deepEqual(tree(path.join(s.dataDir, 'logs')), []);
});


test('recordings: 4 a day', async t => {
    const s = await setup(t);
    const sessions = [1, 2, 3, 4, 5].map(h => String(T('2026-11-19T18:20Z') + h * 3600000));
    for (const session of sessions.slice(0, 4)) {
        await expectStatus(await s.post('rollers', params({session})), 201);
    }
    const r = await s.post('rollers', params({session: sessions[4]}));
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    await expectStatus(r, 429, {error: 'too many'});
    // a retry of a stored file is no new file
    await expectStatus(await s.post('rollers', params({session: sessions[0]})), 201);
    // Cleo has her own four
    await expectStatus(await s.post('rollers', params({session: sessions[4], athlete: '1002'}), rec([{id: '1002', self: true}])), 201);
    // the next UTC day starts again
    s.clock.now = T('2026-11-21T00:00:01Z');
    await expectStatus(await s.post('rollers', params({session: sessions[4]})), 201);
});


test('recordings: session window', async t => {
    const s = await setup(t);
    await expectStatus(await s.post('rollers', params({session: String(NOW - 8 * DAY - 1)})), 400);
    await expectStatus(await s.post('rollers', params({session: String(NOW + 1)})), 400);
    await expectStatus(await s.post('rollers', params({session: String(NOW - 7 * DAY)})), 201);
    await expectStatus(await s.post('rollers', params({session: String(NOW - 8 * DAY)})), 201);
});


test('recordings: refused content', async t => {
    const s = await setup(t);
    // rows of riders in no plan are dropped, not refused (user, 18 Nov 2026): see "rows no plan
    // vouches for" below; a forbidden key refuses on any row, also on one that would be dropped
    const bodies = [
        rec([{id: '1001', self: true, heartrate: null}, {id: '1002'}]),
        rec([{id: '1001', self: true}, {id: '1002', cadence: 90}]),
        rec([{id: '1001', self: true}, {id: '1009', heartrate: 120}]),
        rec([{id: '1001', self: true}, {id: '1009', self: true, cadence: 90}]),
        rec(OK_ROWS, {extra: ['this is no json']}),
    ];
    for (const body of bodies) {
        const r = await s.post('rollers', params(), body);
        assert.equal(r.headers.get('access-control-allow-origin'), '*');
        await expectStatus(r, 422, {error: 'refused'});
    }
    assert.deepEqual(tree(path.join(s.dataDir, 'logs')), []);
    assert.ok(!tree(s.dataDir).some(f => f.endsWith('.tmp')), tree(s.dataDir).join('\n'));
});


test('recordings: retry and conflict', async t => {
    const s = await setup(t);
    const body = rec();
    const name = `${SESSION}-1001.jsonl.gz`;
    await expectStatus(await s.post('rollers', params(), body), 201);
    await expectStatus(await s.post('rollers', params(), Buffer.from(body)), 201, {ok: true, file: name});
    const other = rec([{id: '1001', self: true}]);
    assert.notDeepEqual(other, body);
    await expectStatus(await s.post('rollers', params(), other), 409, {error: 'exists'});
    // same content, different bytes (another MTIME in the gzip header): the server stores what it
    // checked, gzip'd again, so this is the same file, a retry
    const same = Buffer.from(body);
    same[4] ^= 1;
    assert.equal(await checkRecording(same, {athleteId: '1001', maxBytes: 100000}), 'ok');
    assert.notDeepEqual(same, body);
    const stored = fs.readFileSync(s.logFile(KF, 'rollers', name));
    await expectStatus(await s.post('rollers', params(), same), 201, {ok: true, file: name});
    assert.deepEqual(fs.readFileSync(s.logFile(KF, 'rollers', name)), stored);
    assert.equal(unz(stored), unz(body));
});


test('recordings: unpack cap', async t => {
    const s = await setup(t);
    const bomb = gzipSync(Buffer.alloc(200000));
    assert.ok(bomb.length < 10 * 1024);
    await expectStatus(await s.post('rollers', params(), bomb), 413, {error: 'too large'});
    const r = await fetch(s.base + '/healthz');
    assert.equal(await r.text(), 'ok');
    assert.deepEqual(tree(path.join(s.dataDir, 'logs')), []);
});


test('recordings: over LOG_MAX_FILE_MB packed', async t => {
    const s = await setup(t);
    const big = Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.alloc(11000)]);
    await expectStatus(await s.post('rollers', params(), big), 413, {error: 'too large'});
    await expectStatus(await s.post('rollers', params(), Buffer.from('plain text, no gzip')), 400);
    await expectStatus(await s.post('rollers', params(), Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.from('garbage')])), 400);
});


test('recordings: quota', async t => {
    // each recording counts rounded up to 4 KiB: room for one, not for two
    assert.ok(rec().length < QUOTA_BLOCK);
    const limit = String((1.5 * 4096) / MB);
    const ben = params(), benSp = params({circle: SP});
    const ben2 = params({session: String(Number(SESSION) + 60000)});

    const c = await setup(t, {env: {LOG_MAX_CIRCLE_MB: limit}});
    await expectStatus(await c.post('rollers', ben), 201);
    const full = await c.post('rollers', ben2);
    assert.equal(full.headers.get('access-control-allow-origin'), '*');
    await expectStatus(full, 507, {error: 'log storage full'});
    await expectStatus(await c.post('spokes', benSp), 201);

    const all = await setup(t, {env: {LOG_MAX_TOTAL_MB: limit}});
    await expectStatus(await all.post('rollers', ben), 201);
    await expectStatus(await all.post('rollers', ben2), 507, {error: 'log storage full'});
    await expectStatus(await all.post('spokes', benSp), 507, {error: 'log storage full'});
});


// A request whose headers and the first bytes of its body are sent; `finish()` sends the rest and
// resolves with the raw answer.
function openUpload(base, pathAndQuery, body) {
    const {port} = new URL(base);
    const socket = net.connect(port, '127.0.0.1');
    let answer = '';
    const done = new Promise((resolve, reject) => {
        socket.on('data', d => {
            answer += d;
        });
        socket.on('end', () => resolve(answer));
        socket.on('error', reject);
    });
    socket.write(`POST ${pathAndQuery} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n` +
        `Content-Length: ${body.length}\r\n\r\n`);
    socket.write(body.subarray(0, 10));
    return {
        socket,
        finish() {
            socket.write(body.subarray(10));
            return done;
        },
    };
}


// Waits until `n` recording bodies are being read.
async function inFlight(s, n) {
    for (let i = 0; s.server.logUploads.inFlight < n; i++) {
        assert.ok(i < 200, `${n} upload(s) never got in flight`);
        await new Promise(r => setTimeout(r, 5));
    }
}


test('recordings: one body in flight', async t => {
    assert.equal(LOG_MAX_IN_FLIGHT, 1);
    const s = await setup(t);
    const a = openUpload(s.base, `/api/log/rollers?${new URLSearchParams(params({session: String(Number(SESSION) + 1000)}))}`, rec());
    await inFlight(s, 1);
    const r = await s.post('rollers', params());
    assert.equal(r.headers.get('retry-after'), '60');
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    await expectStatus(r, 503, {error: 'busy'});
    assert.match(await a.finish(), /^HTTP\/1\.1 201 /);
    assert.equal(s.server.logUploads.inFlight, 0);
    await expectStatus(await s.post('rollers', params()), 201);
});


test('recordings: a trickled body is cut off at its deadline and frees the slot', async t => {
    const s = await setup(t);
    // 120 s (controller ruling: 20 MB at ~1.4 Mbit/s); node's own request timeout must not cut
    // an upload off before it
    assert.equal(LOG_BODY_MS, 120000);
    assert.equal(s.server.logUploads.bodyMs, LOG_BODY_MS);
    assert.ok(s.server.requestTimeout > LOG_BODY_MS, `requestTimeout ${s.server.requestTimeout}`);
    s.server.logUploads.bodyMs = 300;                       // the same timer, shortened for the test
    const warned = [];
    const warn = console.warn;
    console.warn = m => warned.push(m);
    t.after(() => {
        console.warn = warn;
    });
    const body = rec();
    const up = openUpload(s.base, `/api/log/rollers?${new URLSearchParams(params())}`, body);
    await inFlight(s, 1);
    const t0 = Date.now();
    // one more byte every 50 ms: the body never stalls, it only never ends in time
    let sent = 10;
    const drip = setInterval(() => {
        if (sent < body.length - 1 && !up.socket.destroyed) {
            up.socket.write(body.subarray(sent, sent + 1));
            sent++;
        }
    }, 50);
    t.after(() => clearInterval(drip));
    const answer = await new Promise(resolve => {
        let text = '';
        up.socket.on('data', d => {
            text += d;
        });
        up.socket.on('close', () => resolve(text));
    });
    const took = Date.now() - t0;
    clearInterval(drip);
    assert.match(answer, /^HTTP\/1\.1 408 /);
    assert.match(answer, /"too slow"/);
    assert.equal(s.server.logUploads.inFlight, 0);
    assert.ok(took >= 250 && took < 300 + 700, `cut off after ${took} ms`);
    assert.equal(warned.length, 1);
    assert.match(warned[0], /recording upload cut off, the body took over 0\.3 s: POST \/api\/log\/rollers$/);
    assert.ok(!fs.existsSync(path.join(s.dataDir, 'logs', KF)));
    // the slot is free again: the next upload is stored
    await expectStatus(await s.post('rollers', params()), 201);
});


test('recordings: an upload that ends after midnight keeps the new day\'s counts', async t => {
    const s = await setup(t);
    s.clock.now = T('2026-11-20T23:59:59Z');
    const a = openUpload(s.base, `/api/log/rollers?${new URLSearchParams(params())}`, rec());
    await inFlight(s, 1);
    // the new UTC day starts while the body comes in; Cleo already has her four of that day
    s.clock.now = T('2026-11-21T00:00:01Z');
    await expectStatus(await s.post('rollers', params({athlete: '1002'})), 503);
    s.server.logUploads.perDay.set('rollers/1002', 4);
    assert.match(await a.finish(), /^HTTP\/1\.1 201 /);
    const cleo = String(T('2026-11-20T18:00Z'));
    await expectStatus(await s.post('rollers', params({athlete: '1002', session: cleo}), rec([{id: '1002', self: true}])), 429);
});


test('recordings: a club deleted while the body comes in gets no logs back', async t => {
    const s = await setup(t);
    const up = openUpload(s.base, `/api/log/rollers?${new URLSearchParams(params())}`, rec());
    await inFlight(s, 1);
    s.store.trash(KF);
    const answer = await up.finish();
    assert.match(answer, /^HTTP\/1\.1 404 /);
    assert.match(answer, /"no such team"/);
    assert.ok(!fs.existsSync(path.join(s.dataDir, 'logs', KF)));
    s.store.restore(KF);
});


test('recordings: bad params', async t => {
    const s = await setup(t);
    const before = tree(s.dataDir);
    const bad = [
        ['..%2Fx', params()],
        ['%2E%2E%2Fx', params()],
        ['__proto__', params()],
        ['rollers', params({circle: 'K7F3Q9X2M4'})],
        ['rollers', params({mod: '1'})],
        ['rollers', params({mod: ''})],
        ['rollers', params({athlete: 'abc'})],
        ['rollers', params({athlete: '../1001'})],
        ['rollers', params({session: '17634e9'})],
        ['rollers', params({session: '12345678901234567'})],
        ['rollers', (({circle, ...rest}) => rest)(params())],
    ];
    for (const [slug, p] of bad) {
        const r = await s.post(slug, p);
        assert.equal(r.headers.get('access-control-allow-origin'), '*');
        await expectStatus(r, 400, {error: 'bad request'});
    }
    const r = await fetch(`${s.base}/api/log/rollers?${new URLSearchParams(params())}`);
    assert.equal(r.status, 405);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(tree(s.dataDir), before);
});


test('recordings: without mod 404 update Paceline (hard cut), a leftover OLD_API changes nothing', async t => {
    const old = {session: SESSION, athlete: '1001'};
    for (const env of [{}, {OLD_API_CIRCLE: KF}, {OLD_API: 'compat', OLD_API_CIRCLE: KF}]) {
        const s = await setup(t, {env});
        const label = JSON.stringify(env);
        for (const slug of ['rollers', 'spokes', 'nobody']) {
            const r = await s.post(slug, old);
            assert.equal(r.headers.get('access-control-allow-origin'), '*', label);
            await expectStatus(r, 404, {error: 'update Paceline'});
        }
        assert.deepEqual(tree(path.join(s.dataDir, 'logs')), [], label);
        // a 0.3 mod is served as usual
        await expectStatus(await s.post('rollers', params()), 201);
    }
});


test('recordings: a team is found by its slug only, never by its display name', async t => {
    const s = await setup(t);
    // Rollers renamed to "Rollers A": the slug stays rollers, rollers-a is no team
    s.store.change(KF, c => {
        c.teams.rollers.name = 'Rollers A';
    });
    await expectStatus(await s.post('rollers-a', params()), 404, {error: 'no such team'});
    await expectStatus(await s.post('rollers', params()), 201);
});


test('recordings: retention by session time', async t => {
    const oldName = `${NOW - 100 * DAY}-1001.jsonl.gz`;
    const newName = `${NOW - 10 * DAY}-1001.jsonl.gz`;
    const prepare = dataDir => {
        for (const dir of [path.join(dataDir, 'logs', KF, 'rollers'), path.join(dataDir, 'logs', 'tractors')]) {
            fs.mkdirSync(dir, {recursive: true});
        }
        for (const name of [oldName, newName]) {
            fs.writeFileSync(path.join(dataDir, 'logs', KF, 'rollers', name), rec());
            fs.writeFileSync(path.join(dataDir, 'logs', 'tractors', name), rec());
        }
    };
    const keep = await setup(t, {env: {LOG_RETENTION_DAYS: '90'}, prepare});
    assert.ok(!fs.existsSync(keep.logFile(KF, 'rollers', oldName)));
    assert.ok(fs.existsSync(keep.logFile(KF, 'rollers', newName)));
    assert.deepEqual(tree(path.join(keep.dataDir, 'logs', 'tractors')), [newName, oldName].sort());
    // the log store sees the kept one
    assert.deepEqual(keep.server.logs.list(KF), [{slug: 'rollers', file: newName, session: NOW - 10 * DAY, athlete: '1001', size: rec().length}]);
    assert.equal(keep.server.logs.circleBytes(KF), 4096);
    assert.equal(keep.server.logs.totalBytes(), 4096);

    const all = await setup(t, {env: {LOG_RETENTION_DAYS: '0'}, prepare});
    assert.ok(fs.existsSync(all.logFile(KF, 'rollers', oldName)));
    assert.ok(fs.existsSync(all.logFile(KF, 'rollers', newName)));
    assert.deepEqual(all.server.logs.list(KF).map(x => x.file), [newName, oldName]);
});


test('the log store: paths are built from checked parts only', async t => {
    const s = await setup(t);
    const name = `${SESSION}-1001.jsonl.gz`;
    await expectStatus(await s.post('rollers', params()), 201);
    assert.equal(s.server.logs.has(KF, 'rollers', name), true);
    assert.equal(s.server.logs.has(KF, 'rollers', `${SESSION}-1002.jsonl.gz`), false);
    for (const fn of ['has', 'remove']) {
        assert.throws(() => s.server.logs[fn](KF, '..', name), TypeError, fn);
        assert.throws(() => s.server.logs[fn](KF, 'rollers', '../x.jsonl.gz'), TypeError, fn);
        assert.throws(() => s.server.logs[fn]('../k7f3q9x2', 'rollers', name), TypeError, fn);
    }
    assert.equal(s.server.logs.has(KF, 'rollers', name), true);
});


// ---- plan codes and the archive (plan versions spec §11) ----

const lines = (...xs) => gzipSync(xs.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join('\n') + '\n');
const CODES = Array.from({length: 12}, (_, i) => `AAAAA${'0123456789AB'[i]}`);


test('checkRecording: collects planSig and det.planSig, ignores bad values, keeps at most 10', async () => {
    assert.equal(LOG_MAX_SIGS, 10);
    const tick = det => ({ts: 1, riders: OK_ROWS, det});
    const sigs = [];
    const gz = lines({...HEAD, planSig: 'RE5CFQ'}, tick({planSig: '9TQ4XA'}), tick({planSig: 'bad'}), tick(null),
        tick({planSig: 'RE5CFQ'}), tick('9TQ4XB'), tick([{planSig: '9TQ4XC'}]), tick({planSig: 123456}),
        {ts: 2, riders: OK_ROWS, planSig: '9TQ4XD'}, tick({planSig: 're5cfq'}));
    assert.equal(await checkRecording(gz, {athleteId: '1001', maxBytes: 1000000, sigs}), 'ok');
    assert.deepEqual(sigs, ['RE5CFQ', '9TQ4XA']);
    // a head without a code, then 12 distinct codes: the first 10
    const many = [];
    assert.equal(await checkRecording(lines({...HEAD, planSig: null}, ...CODES.map(c => tick({planSig: c}))),
        {athleteId: '1001', maxBytes: 1000000, sigs: many}), 'ok');
    assert.equal(many.length, 10);
    assert.deepEqual(many, CODES.slice(0, 10));
    // without a list the check is as before
    assert.equal(await checkRecording(gz, {athleteId: '1001', maxBytes: 1000000}), 'ok');
});


test('recordings: plan codes indexed on store, unchanged on an identical retry', async t => {
    const s = await setup(t);
    const db = s.server.db;
    const body = lines({...HEAD, planSig: 'RE5CFQ'}, {ts: 1, riders: OK_ROWS, det: {planSig: 'RE5CFQ'}});
    const name = `${SESSION}-1001.jsonl.gz`;
    await expectStatus(await s.post('rollers', params(), body), 201);
    assert.deepEqual(rows(db, 'SELECT sig FROM recording_sigs WHERE cid = ? AND name = ?', KF, name), [{sig: 'RE5CFQ'}]);
    const stored = rows(db, 'SELECT * FROM recordings');
    const n = changes(db);
    await expectStatus(await s.post('rollers', params(), Buffer.from(body)), 201);
    assert.equal(changes(db), n, 'the retry writes nothing');
    assert.deepEqual(rows(db, 'SELECT * FROM recordings'), stored);
    // a recording without a code adds no sig row
    const other = `${Number(SESSION) + 60000}-1001.jsonl.gz`;
    await expectStatus(await s.post('rollers', params({session: String(Number(SESSION) + 60000)})), 201);
    assert.deepEqual(rows(db, 'SELECT name, sig FROM recording_sigs'), [{name, sig: 'RE5CFQ'}]);
    assert.deepEqual(s.server.logs.list(KF).map(r => r.file), [other, name]);
});


test('recordings: a rider dropped in v5 can still upload while v4 is stored', async t => {
    const v = (n, riders) => sheet({team: 'rollers', label: 'Rollers', date: '2026-11-19', riders, uploadedAt: '2026-11-19T16:00:00.000Z', plan: 'ra0004', n});
    const kf = club({teams: {rollers: team('Rollers')}, sheets: {ra0004: v(4, ['1001', '1002']), ra0005: v(5, ['1002'])}});
    const s = await setup(t, {clubs: [kf]});
    await expectStatus(await s.post('rollers', params()), 201);
    s.store.change(KF, c => {
        delete c.sheets.ra0004;
    });
    await expectStatus(await s.post('rollers', params({session: String(Number(SESSION) + 60000)})), 403, {error: 'not in this team'});
});


// A log store on paceline.db in a temp dir, with a store on the same db holding kettenfett() and a
// clock the test moves; `put(slug, ageDays, codes)` puts a recording of that age with these codes,
// `version(n, recSig, riders, bench)` a stored version of plan pa0001, `read(slug)` the team's
// archive rows as {id: version}.
function archiveSetup(t) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paceline-logs-'));
    const db = openDb(dataDir);
    t.after(() => {
        db.close();
        fs.rmSync(dataDir, {recursive: true, force: true});
    });
    const clock = {now: NOW};
    const now = () => clock.now;
    const logs = makeLogStore(dataDir, {db, now});
    const store = openStore({db, now, archive: logs});
    store.create(kettenfett());
    const dir = slug => path.join(dataDir, 'logs', KF, slug);
    const put = (slug, ageDays, codes, athlete = '1001') => {
        const name = `${NOW - ageDays * DAY}-${athlete}.jsonl.gz`;
        logs.put(KF, slug, name, rec());
        assert.equal(logs.addSigs(KF, slug, name, codes), codes.length > 0);
        return name;
    };
    const version = (n, recSig, riders = ['1001', '1002'], bench = []) => sheet({
        team: 'rollers', label: 'Rollers', date: '2026-11-12', riders, bench, uploadedAt: '2026-11-12T16:00:00.000Z',
        plan: 'pa0001', n, recSig,
    });
    const read = slug => Object.fromEntries(rows(db, 'SELECT id, version FROM archive WHERE cid = ? AND slug = ? ORDER BY rowid', KF, slug)
        .map(r => [r.id, JSON.parse(r.version)]));
    return {dataDir, db, clock, logs, store, dir, put, version, read};
}

const ARCHIVED = ['plan', 'n', 'label', 'type', 'date', 'sig', 'recSig', 'uploadedAt', 'at', 'via', 'copyOf', 'json', 'text'];
// (a field the version does not have is archived as null, as logs.mjs writes it: copyOf on every
// version since Restore went)
const archived = v => ({...Object.fromEntries(ARCHIVED.map(k => [k, v[k] ?? null])), pastSigs: v.pastSigs ?? []});


test('archiveVersions: only versions a recording used, by recSig or the current sig; an id stored stays as it is', t => {
    const a = archiveSetup(t);
    const byRecSig = a.version(1, 'AAAAAA');
    const bySig = a.version(2, 'CCCCCC', ['1001', '1002', '1004']);
    const unused = a.version(3, 'DDDDDD', ['1001']);
    assert.equal(new Set([byRecSig.sig, bySig.sig, unused.sig, 'AAAAAA']).size, 4);
    const name = a.put('rollers', 2, ['AAAAAA', bySig.sig]);
    // nothing used: nothing written
    let n = changes(a.db);
    assert.equal(a.logs.archiveVersions(KF, 'rollers', [['va0003', unused]]), 0);
    assert.equal(changes(a.db), n);
    assert.deepEqual(a.read('rollers'), {});
    assert.equal(a.logs.archiveVersions(KF, 'rollers', [['va0001', byRecSig], ['va0002', bySig], ['va0003', unused]]), 2);
    assert.deepEqual(a.read('rollers'), {va0001: archived(byRecSig), va0002: archived(bySig)});
    assert.deepEqual(rows(a.db, 'SELECT id, plan, n, sig, rec_sig, past_sigs, label, type, date, archived_at FROM archive ORDER BY rowid'), [
        {id: 'va0001', plan: 'pa0001', n: 1, sig: byRecSig.sig, rec_sig: 'AAAAAA', past_sigs: '[]', label: 'Rollers', type: null, date: '2026-11-12', archived_at: NOW},
        {id: 'va0002', plan: 'pa0001', n: 2, sig: bySig.sig, rec_sig: 'CCCCCC', past_sigs: '[]', label: 'Rollers', type: null, date: '2026-11-12', archived_at: NOW},
    ]);
    // again, with a changed copy: kept as it is, nothing written
    n = changes(a.db);
    assert.equal(a.logs.archiveVersions(KF, 'rollers', [['va0001', {...byRecSig, label: 'Rollers · fast'}]]), 0);
    assert.equal(changes(a.db), n);
    assert.deepEqual(a.read('rollers'), {va0001: archived(byRecSig), va0002: archived(bySig)});
    // codes only count while their recording exists
    assert.deepEqual([...a.logs.codes(KF, 'rollers')].sort(), ['AAAAAA', bySig.sig].sort());
    fs.rmSync(path.join(a.dir('rollers'), name));
    capture('log', () => a.logs.reconcile());
    assert.deepEqual([...a.logs.codes(KF, 'rollers')], []);
    assert.equal(a.logs.archiveVersions(KF, 'rollers', [['va0004', a.version(4, 'AAAAAA')]]), 0);
});


test('log sweep: old recordings take their sigs and the archived versions no one uses', t => {
    const a = archiveSetup(t);
    const oldName = a.put('rollers', 100, ['AAAAAA']);
    const newName = a.put('rollers', 2, ['BBBBBB']);
    const vA = a.version(1, 'AAAAAA');
    const vB = a.version(2, 'BBBBBB', ['1001']);
    assert.equal(a.logs.archiveVersions(KF, 'rollers', [['va0001', vA], ['va0002', vB]]), 2);
    const sigRows = () => rows(a.db, 'SELECT slug, name, sig FROM recording_sigs ORDER BY slug, name, sig');
    // days 0 keeps all
    const n = changes(a.db);
    assert.equal(a.logs.sweep(NOW, 0), 0);
    assert.equal(changes(a.db), n);
    assert.ok(fs.existsSync(path.join(a.dir('rollers'), oldName)));
    assert.equal(a.logs.sweep(NOW, 90), 1);
    assert.ok(!fs.existsSync(path.join(a.dir('rollers'), oldName)));
    assert.deepEqual(a.logs.list(KF).map(r => r.file), [newName]);
    assert.deepEqual(sigRows(), [{slug: 'rollers', name: newName, sig: 'BBBBBB'}]);
    assert.deepEqual(a.read('rollers'), {va0002: archived(vB)});
    // a deleted team's folder: its last recording goes, then its archive rows and the folder
    a.put('cogs', 100, ['AAAAAA']);
    assert.equal(a.logs.archiveVersions(KF, 'cogs', [['va0003', a.version(3, 'AAAAAA')]]), 1);
    assert.equal(a.logs.sweep(NOW, 90), 1);
    assert.ok(!fs.existsSync(a.dir('cogs')));
    assert.deepEqual(a.read('cogs'), {});
    assert.deepEqual(a.read('rollers'), {va0002: archived(vB)});
    // a captain's delete of the last recording takes the rest at once
    assert.equal(a.logs.remove(KF, 'rollers', newName), true);
    assert.ok(!fs.existsSync(a.dir('rollers')));
    assert.deepEqual(a.read('rollers'), {});
    assert.deepEqual(sigRows(), []);
    assert.equal(a.logs.remove(KF, 'rollers', newName), false);
});


test('remove rider: archive rows rewritten, sig follows, recSig stays, the version survives the sweeps', t => {
    const a = archiveSetup(t);
    const v1 = a.version(1, 'AAAAAA', ['1001', '1002'], ['1003']);
    const cleoOnly = a.version(2, 'AAAAAA', ['1002']);
    const other = a.version(3, 'AAAAAA', ['1001']);
    a.put('rollers', 2, ['AAAAAA']);
    assert.equal(a.logs.archiveVersions(KF, 'rollers', [['va0001', v1], ['va0002', cleoOnly], ['va0003', other]]), 3);
    const otherRow = rows(a.db, "SELECT * FROM archive WHERE id = 'va0003'");
    a.clock.now += DAY;
    assert.equal(a.logs.removeRider(KF, '1002'), 2);
    const got = a.read('rollers');
    assert.deepEqual(Object.keys(got).sort(), ['va0001', 'va0003']);
    assert.ok(!Object.hasOwn(got.va0001.json.riders, '1002'));
    assert.deepEqual(Object.keys(got.va0001.json.riders), ['1001']);
    assert.deepEqual(Object.keys(got.va0001.json.roster), ['1003']);
    assert.notEqual(got.va0001.sig, v1.sig);
    assert.equal(got.va0001.sig, normalizePlan(got.va0001.json, got.va0001.text).plan.sig);
    assert.equal(got.va0001.recSig, 'AAAAAA');
    assert.deepEqual(got.va0001.pastSigs, [v1.sig]);
    // the columns follow the version, the archive time stays
    const row = rows(a.db, "SELECT * FROM archive WHERE id = 'va0001'")[0];
    assert.deepEqual([row.sig, row.rec_sig, row.past_sigs, row.archived_at], [got.va0001.sig, 'AAAAAA', JSON.stringify([v1.sig]), NOW]);
    assert.equal(row.bytes, Buffer.byteLength(row.version));
    assert.deepEqual(rows(a.db, "SELECT * FROM archive WHERE id = 'va0003'"), otherRow);
    // again: nothing to do, nothing written
    const n = changes(a.db);
    assert.equal(a.logs.removeRider(KF, '1002'), 0);
    assert.equal(changes(a.db), n);
    // the recording lists the recSig: the sweep keeps it
    assert.equal(a.logs.sweep(NOW, 90), 0);
    assert.deepEqual(Object.keys(a.read('rollers')).sort(), ['va0001', 'va0003']);
    // the bench too, and a version left without riders is dropped
    assert.equal(a.logs.removeRider(KF, '1003'), 1);
    assert.ok(!Object.hasOwn(a.read('rollers').va0001.json.roster ?? {}, '1003'));
    assert.equal(a.logs.removeRider(KF, '1001'), 2);
    assert.deepEqual(a.read('rollers'), {});
    assert.equal(a.logs.removeRider(KF, 'abc'), 0);
});


test('remove rider twice with a recording in between: the middle sig keeps the version', t => {
    const a = archiveSetup(t);
    const v1 = a.version(1, 'AAAAAA', ['1001', '1002', '1004'], ['1003']);
    a.put('rollers', 3, ['AAAAAA']);
    assert.equal(a.logs.archiveVersions(KF, 'rollers', [['va0001', v1]]), 1);
    assert.equal(a.logs.removeRider(KF, '1002'), 1);
    const middle = a.read('rollers').va0001.sig;
    assert.deepEqual(a.read('rollers').va0001.pastSigs, [v1.sig]);
    // a recording made now lists the middle sig; the first recording goes
    a.put('rollers', 1, [middle], '1004');
    assert.equal(a.logs.removeRider(KF, '1004'), 1);
    const got = a.read('rollers').va0001;
    assert.deepEqual(got.pastSigs, [v1.sig, middle]);
    assert.notEqual(got.sig, middle);
    assert.equal(got.recSig, 'AAAAAA');
    assert.equal(a.logs.remove(KF, 'rollers', `${NOW - 3 * DAY}-1001.jsonl.gz`), true);
    assert.deepEqual(Object.keys(a.read('rollers')), ['va0001'], 'kept by its middle sig');
    // archiving looks at pastSigs too
    assert.equal(a.logs.archiveVersions(KF, 'rollers', [['va0002', {...a.version(2, 'DDDDDD'), pastSigs: [middle]}]]), 1);
});


test('reconcile: a file without a row is indexed, a row without a file goes, a purged club\'s folder goes, an unknown one stays', t => {
    const a = archiveSetup(t);
    const A = a.put('rollers', 3, []);
    // B planted by hand (a crash between the rename and the index), A's file gone by hand
    const B = `${NOW - 2 * DAY}-1002.jsonl.gz`;
    fs.writeFileSync(path.join(a.dir('rollers'), B), rec());
    const mtime = new Date(NOW - DAY);
    fs.utimesSync(path.join(a.dir('rollers'), B), mtime, mtime);
    fs.rmSync(path.join(a.dir('rollers'), A));
    // a purged club (a tombstone, in neither clubs nor trash) and an unknown one (no tombstone)
    const PURGED = 's9pk2m4q7d';
    a.db.sql.prepare('INSERT INTO tombstone_clubs (cid, deleted_at) VALUES (?, ?)').run(PURGED, new Date(NOW).toISOString());
    for (const cid of [PURGED, SP]) {
        fs.mkdirSync(path.join(a.dataDir, 'logs', cid, 'spokes'), {recursive: true});
        fs.writeFileSync(path.join(a.dataDir, 'logs', cid, 'spokes', `${NOW - DAY}-1001.jsonl.gz`), rec());
    }
    // a name whose session is over 2^53 is never indexed
    const huge = '9999999999999999-1001.jsonl.gz';
    fs.writeFileSync(path.join(a.dir('rollers'), huge), rec());
    const {result, lines: logged} = capture('log', () => a.logs.reconcile());
    assert.deepEqual(result, {indexed: 2, dropped: 1, removed: 1});   // B and p2m8c4t1v9's blob; A's row; s9pk2m4q7d
    assert.deepEqual(logged, ['paceline-server: reconcile: 2 recordings indexed, 1 index rows of missing files dropped, 1 folders of purged clubs removed']);
    assert.deepEqual(a.logs.list(KF).map(r => r.file), [B]);                      // the 2^53 name is not indexed, list() works
    assert.deepEqual(rows(a.db, 'SELECT bytes, stored_at FROM recordings WHERE name = ?', B), [{bytes: rec().length, stored_at: NOW - DAY}]);
    assert.ok(fs.existsSync(path.join(a.dir('rollers'), huge)));
    assert.ok(!fs.existsSync(path.join(a.dataDir, 'logs', PURGED)));
    assert.ok(fs.existsSync(path.join(a.dataDir, 'logs', SP)));
    assert.deepEqual(a.logs.list(SP).map(r => r.file), [`${NOW - DAY}-1001.jsonl.gz`]);
    assert.deepEqual([...a.logs.codes(KF, 'rollers')], []);                        // an indexed file has no codes
    assert.equal(a.logs.circleBytes(KF), 4096);
    // nothing left to do: nothing written, nothing said
    const n = changes(a.db);
    const again = capture('log', () => a.logs.reconcile());
    assert.deepEqual(again.result, {indexed: 0, dropped: 0, removed: 0});
    assert.deepEqual(again.lines, []);
    assert.equal(changes(a.db), n);
});


test('reconcile: with logs/ gone (a mount missing) every row, code and archived version stays, also after it is back', t => {
    const a = archiveSetup(t);
    a.put('rollers', 2, ['AAAAAA']);
    assert.equal(a.logs.archiveVersions(KF, 'rollers', [['va0001', a.version(1, 'AAAAAA')]]), 1);
    const count = () => ['recordings', 'recording_sigs', 'archive'].map(tb => rows(a.db, `SELECT COUNT(*) AS n FROM ${tb}`)[0].n);
    assert.deepEqual(count(), [1, 1, 1]);
    const logsDir = path.join(a.dataDir, 'logs');
    fs.renameSync(logsDir, logsDir + '.away');
    const errors = [];
    const error = console.error;
    console.error = (...x) => errors.push(x.join(' '));
    let logged;
    try {
        logged = capture('log', () => assert.equal(a.logs.sweep(NOW, 0), 0)).lines;
    } finally {
        console.error = error;
    }
    assert.deepEqual(count(), [1, 1, 1]);
    assert.deepEqual(logged, ['paceline-server: reconcile: 1 index rows kept, their folders are missing or unreadable: logs/']);
    assert.deepEqual(errors, []);
    fs.renameSync(logsDir + '.away', logsDir);
    const back = capture('log', () => assert.equal(a.logs.sweep(NOW, 0), 0)).lines;
    assert.deepEqual(back, []);
    assert.deepEqual(count(), [1, 1, 1]);
    assert.deepEqual([...a.logs.codes(KF, 'rollers')], ['AAAAAA']);
    assert.deepEqual(Object.keys(a.read('rollers')), ['va0001']);
});


test('reconcile: a team folder missing or unreadable keeps its rows; another team\'s missing blob still goes', t => {
    const a = archiveSetup(t);
    a.put('rollers', 2, ['AAAAAA']);
    a.put('spokes', 2, ['CCCCCC']);
    const kept = a.put('cogs', 2, ['BBBBBB']);
    const gone = a.put('cogs', 3, ['BBBBBB']);
    fs.rmSync(a.dir('rollers'), {recursive: true});           // the whole team folder
    fs.rmSync(path.join(a.dir('cogs'), gone));                   // one blob of a team whose folder is there
    const readdirSync = fs.readdirSync;
    fs.readdirSync = (p, o) => {
        if (p === a.dir('spokes')) {
            throw Object.assign(new Error('EACCES: permission denied'), {code: 'EACCES'});
        }
        return readdirSync(p, o);
    };
    let got;
    try {
        got = capture('log', () => a.logs.reconcile());
    } finally {
        fs.readdirSync = readdirSync;
    }
    assert.deepEqual(got.result, {indexed: 0, dropped: 1, removed: 0});
    assert.deepEqual(got.lines, [
        'paceline-server: reconcile: 0 recordings indexed, 1 index rows of missing files dropped, 0 folders of purged clubs removed',
        `paceline-server: reconcile: 2 index rows kept, their folders are missing or unreadable: logs/${KF}/rollers/, logs/${KF}/spokes/ (EACCES)`,
    ]);
    assert.deepEqual(a.logs.list(KF).map(r => `${r.slug}/${r.file}`).sort(),
        [`cogs/${kept}`, `rollers/${NOW - 2 * DAY}-1001.jsonl.gz`, `spokes/${NOW - 2 * DAY}-1001.jsonl.gz`].sort());
    assert.deepEqual([...a.logs.codes(KF, 'rollers')], ['AAAAAA']);
    assert.deepEqual([...a.logs.codes(KF, 'spokes')], ['CCCCCC']);
    // the club's folder gone too: named once, at its level
    fs.rmSync(path.join(a.dataDir, 'logs', KF), {recursive: true});
    const again = capture('log', () => a.logs.reconcile());
    assert.deepEqual(again.result, {indexed: 0, dropped: 0, removed: 0});
    assert.deepEqual(again.lines, [`paceline-server: reconcile: 3 index rows kept, their folders are missing or unreadable: logs/${KF}/`]);
    assert.equal(a.logs.recordingCount(KF), 3);
});


test('quota: recordings count rounded up to 4 KiB, archived versions by their bytes; a trashed club is out of the total', t => {
    assert.equal(QUOTA_BLOCK, 4096);
    assert.deepEqual([0, 1, 4096, 4097].map(quotaBytes), [0, 4096, 4096, 8192]);
    const a = archiveSetup(t);
    const name = `${NOW - 2 * DAY}-1001.jsonl.gz`;
    a.logs.put(KF, 'rollers', name, Buffer.alloc(100));
    assert.equal(a.logs.addSigs(KF, 'rollers', name, ['AAAAAA']), true);
    a.logs.put(KF, 'rollers', `${NOW - 2 * DAY}-1002.jsonl.gz`, Buffer.alloc(4097));
    assert.equal(a.logs.archiveVersions(KF, 'rollers', [['va0001', a.version(1, 'AAAAAA')]]), 1);
    const [{version, bytes}] = rows(a.db, 'SELECT version, bytes FROM archive');
    const versionBytes = Buffer.byteLength(version);
    assert.equal(bytes, versionBytes);
    assert.ok(versionBytes > 300);
    assert.equal(a.logs.circleBytes(KF), 4096 + 8192 + versionBytes);
    assert.equal(a.logs.totalBytes(), 4096 + 8192 + versionBytes);
    assert.deepEqual(a.logs.list(KF).map(r => r.size), [100, 4097]);
    a.store.trash(KF);
    assert.equal(a.logs.circleBytes(KF), 4096 + 8192 + versionBytes);
    assert.equal(a.logs.totalBytes(), 0);
    a.store.restore(KF);
    assert.equal(a.logs.totalBytes(), 4096 + 8192 + versionBytes);
});


test('recordings: at most 5 000 per club', async t => {
    assert.equal(LOG_MAX_FILES, 5000);
    const s = await setup(t);
    const db = s.server.db;
    const ins = db.sql.prepare('INSERT INTO recordings (cid, slug, name, session, athlete, bytes, stored_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    db.tx(() => {
        for (let i = 1; i <= 5000; i++) {
            ins.run(KF, 'rollers', `${i}-1009.jsonl.gz`, i, '1009', 1, NOW);
        }
    });
    assert.equal(s.server.logs.recordingCount(KF), 5000);
    await expectStatus(await s.post('rollers', params()), 507, {error: 'log storage full'});
    // another club still takes one
    await expectStatus(await s.post('spokes', params({circle: SP})), 201);
    // one fewer: room for one more
    db.sql.prepare("DELETE FROM recordings WHERE cid = ? AND name = '1-1009.jsonl.gz'").run(KF);
    await expectStatus(await s.post('rollers', params()), 201);
    assert.equal(s.server.logs.recordingCount(KF), 5000);
});


test('archive: at most 1 000 versions per team; the oldest no recording uses goes first, then the oldest; one warning', t => {
    assert.equal(ARCHIVE_MAX, 1000);
    const a = archiveSetup(t);
    a.put('rollers', 3, ['AAAAAA']);
    const r2 = a.put('rollers', 2, ['BBBBBB']);
    const base = a.version(1, 'AAAAAA');
    const vs = (prefix, from, to, recSig) => Array.from({length: to - from + 1}, (_, i) =>
        [`${prefix}${String(from + i).padStart(4, '0')}`, {...base, n: from + i, recSig}]);
    const count = slug => rows(a.db, 'SELECT COUNT(*) AS n FROM archive WHERE cid = ? AND slug = ?', KF, slug)[0].n;
    a.clock.now += 1;
    const first = capture('warn', () => a.logs.archiveVersions(KF, 'rollers', [...vs('v', 1, 2, 'AAAAAA'), ...vs('v', 3, 1000, 'BBBBBB')]));
    assert.equal(first.result, 1000);
    assert.equal(count('rollers'), 1000);
    assert.deepEqual(first.lines, []);
    // R2 goes from the index by hand (its sigs by cascade, no prune): v0003 … v1000 are unused now
    a.db.sql.prepare('DELETE FROM recordings WHERE cid = ? AND slug = ? AND name = ?').run(KF, 'rollers', r2);
    a.clock.now += 1;
    const more = capture('warn', () => a.logs.archiveVersions(KF, 'rollers', vs('v', 1001, 1003, 'AAAAAA')));
    assert.equal(more.result, 3);
    const ids = Object.keys(a.read('rollers'));
    assert.equal(ids.length, 1000);
    for (const id of ['v0003', 'v0004', 'v0005']) {
        assert.ok(!ids.includes(id), id);
    }
    for (const id of ['v0001', 'v0002', 'v0006', 'v1000', 'v1001', 'v1003']) {
        assert.ok(ids.includes(id), id);
    }
    assert.deepEqual(more.lines, [`paceline-server: club ${KF}: team rollers: 3 archived plan versions over the cap of 1000 dropped, oldest first`]);
    // every version used: the oldest of all goes
    a.put('cogs', 2, ['AAAAAA']);
    a.clock.now += 1;
    assert.equal(a.logs.archiveVersions(KF, 'cogs', vs('c', 1, 1000, 'AAAAAA')), 1000);
    a.clock.now += 1;
    const cogs = capture('warn', () => a.logs.archiveVersions(KF, 'cogs', vs('c', 1001, 1001, 'AAAAAA')));
    assert.equal(cogs.result, 1);
    assert.equal(count('cogs'), 1000);
    const left = Object.keys(a.read('cogs'));
    assert.ok(!left.includes('c0001') && left.includes('c0002') && left.includes('c1001'));
    assert.deepEqual(cogs.lines, [`paceline-server: club ${KF}: team cogs: 1 archived plan versions over the cap of 1000 dropped, oldest first`]);
});


test('recordings: the index row and its codes are one transaction after the rename; a refused one leaves the file and the retry indexes it', async t => {
    const s = await setup(t);
    const body = lines({...HEAD, planSig: 'RE5CFQ'}, {ts: 1, riders: OK_ROWS});
    const name = `${SESSION}-1001.jsonl.gz`;
    const undo = refuseWrites(s.server.db, 'recordings', ['INSERT']);
    const error = console.error;
    console.error = () => {};
    let first;
    try {
        first = await s.post('rollers', params(), body);
        await first.text();
    } finally {
        console.error = error;
        undo();
    }
    assert.equal(first.status, 500);
    assert.equal(unz(fs.readFileSync(s.logFile(KF, 'rollers', name))), unz(body), 'the recording is in place');
    assert.deepEqual(s.server.logs.list(KF), []);
    assert.deepEqual(rows(s.server.db, 'SELECT * FROM recording_sigs'), []);
    await expectStatus(await s.post('rollers', params(), Buffer.from(body)), 201, {ok: true, file: name});
    assert.deepEqual(s.server.logs.list(KF).map(r => r.file), [name]);
    assert.deepEqual([...s.server.logs.codes(KF, 'rollers')], ['RE5CFQ']);
    // the codes refused: the row goes with them (one transaction), the file stays for the retry
    const later = String(Number(SESSION) + 60000);
    const name2 = `${later}-1001.jsonl.gz`;
    const undo2 = refuseWrites(s.server.db, 'recording_sigs', ['INSERT']);
    let second;
    console.error = () => {};
    try {
        second = await s.post('rollers', params({session: later}), body);
        await second.text();
    } finally {
        console.error = error;
        undo2();
    }
    assert.equal(second.status, 500);
    assert.ok(fs.existsSync(s.logFile(KF, 'rollers', name2)));
    assert.deepEqual(s.server.logs.list(KF).map(r => r.file), [name]);
    await expectStatus(await s.post('rollers', params({session: later}), Buffer.from(body)), 201, {ok: true, file: name2});
    assert.deepEqual(s.server.logs.list(KF).map(r => r.file), [name2, name]);
    assert.deepEqual(rows(s.server.db, 'SELECT name FROM recording_sigs ORDER BY name'), [{name}, {name: name2}]);
});


test('remove: the transaction first, then the file; a file that cannot be unlinked comes back at the next reconcile', t => {
    const a = archiveSetup(t);
    const name = a.put('rollers', 2, ['AAAAAA']);
    const file = path.join(a.dir('rollers'), name);
    const rmSync = fs.rmSync;
    fs.rmSync = (p, o) => {
        if (p === file) {
            throw Object.assign(new Error('EACCES: permission denied'), {code: 'EACCES'});
        }
        return rmSync(p, o);
    };
    try {
        assert.throws(() => a.logs.remove(KF, 'rollers', name), /EACCES/);
    } finally {
        fs.rmSync = rmSync;
    }
    assert.deepEqual(a.logs.list(KF), []);
    assert.deepEqual([...a.logs.codes(KF, 'rollers')], []);
    assert.ok(fs.existsSync(file));
    assert.deepEqual(capture('log', () => a.logs.reconcile()).result, {indexed: 1, dropped: 0, removed: 0});
    assert.deepEqual(a.logs.list(KF).map(r => r.file), [name]);
    assert.deepEqual([...a.logs.codes(KF, 'rollers')], []);
});


test('writeAtomic fsyncs the file before the rename, then the directory', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paceline-logs-'));
    const {fsyncSync, renameSync} = fs;
    const calls = [];
    fs.fsyncSync = fd => {
        calls.push(['fsync', fs.fstatSync(fd).isDirectory() ? 'dir' : fs.fstatSync(fd).size]);
        return fsyncSync(fd);
    };
    fs.renameSync = (a, b) => {
        calls.push(['rename', path.basename(b)]);
        return renameSync(a, b);
    };
    try {
        const file = path.join(dataDir, 'x.json');
        writeAtomic(file, '{"a":1}');
        writeAtomic(file, Buffer.from('{"a":22}'));
        assert.deepEqual(calls, [
            ['fsync', 7], ['rename', 'x.json'], ['fsync', 'dir'],
            ['fsync', 8], ['rename', 'x.json'], ['fsync', 'dir'],
        ]);
        assert.equal(fs.readFileSync(file, 'utf8'), '{"a":22}');
        assert.deepEqual(fs.readdirSync(dataDir), ['x.json']);
        // a failed write leaves the old file and no temp file
        fs.fsyncSync = () => {
            throw Object.assign(new Error('EIO: i/o error'), {code: 'EIO'});
        };
        assert.throws(() => writeAtomic(file, '{"a":333}'), /EIO/);
        assert.equal(fs.readFileSync(file, 'utf8'), '{"a":22}');
        assert.deepEqual(fs.readdirSync(dataDir), ['x.json']);
    } finally {
        fs.fsyncSync = fsyncSync;
        fs.renameSync = renameSync;
        fs.rmSync(dataDir, {recursive: true, force: true});
    }
});


// ---- rows of a later plan (user, 18 Nov 2026: 17 Nov ZRL, the plan changed mid-race) ----

// Rollers with the race's first plan (Ben 1001, Cleo 1002) and the plan loaded mid-race (Ben, Cleo,
// Dan 1003, Fay 1006 on the bench); Sprockets, another team of the club, with Gus (1005).
const FIRST = sheet({team: 'rollers', label: 'Rollers', date: '2026-11-19', riders: ['1001', '1002'], uploadedAt: '2026-11-19T16:00:00.000Z'});
const LATER = sheet({team: 'rollers', label: 'Rollers', date: '2026-11-19', riders: ['1001', '1002', '1003'], bench: ['1006'], uploadedAt: '2026-11-19T18:50:00.000Z'});
const OTHER = sheet({team: 'sprockets', label: 'Sprockets', date: '2026-11-19', riders: ['1001', '1005'], uploadedAt: '2026-11-19T16:00:00.000Z'});
const UNKNOWN = 'ZZZZZZ';

function twoPlans({later = true} = {}) {
    return club({
        teams: {rollers: team('Rollers'), sprockets: team('Sprockets')},
        sheets: {ra0001: FIRST, ...(later ? {ra0002: LATER} : {}), sa0001: OTHER},
    });
}

const HEAD2 = {...HEAD, planSig: FIRST.sig};
const tick2 = (ts, planSig, rows, extra = {}) => ({ts, riders: rows, ...extra, det: {planSig}});


test('knownPlans: each code of a version to its riders and bench now', () => {
    assert.notEqual(FIRST.sig, LATER.sig);
    const removed = {...LATER, sig: 'AAAAA1', recSig: 'AAAAA2', pastSigs: ['AAAAA3', 'bad', 7]};
    const known = knownPlans([FIRST, removed, null, {sig: 'AAAAA4'}, {sig: 'AAAAA5', json: 'x'}]);
    assert.deepEqual([...known.keys()].sort(), [FIRST.sig, 'AAAAA1', 'AAAAA2', 'AAAAA3'].sort());
    assert.deepEqual([...known.get(FIRST.sig)].sort(), ['1001', '1002']);
    for (const code of ['AAAAA1', 'AAAAA2', 'AAAAA3']) {
        assert.deepEqual([...known.get(code)].sort(), ['1001', '1002', '1003', '1006'], code);
    }
    // two versions with one code pool their ids
    const pooled = knownPlans([FIRST, {...OTHER, sig: FIRST.sig, recSig: FIRST.sig}]);
    assert.deepEqual([...pooled.get(FIRST.sig)].sort(), ['1001', '1002', '1005']);
});


test('checkRecording: a row is verified by me, the head plan or the plan its tick names', async () => {
    const known = knownPlans([FIRST, LATER]);
    const check = async (gz, opts = {}) => {
        const stats = {dropped: 0};
        const verdict = await checkRecording(gz, {athleteId: '1001', maxBytes: 1000000, known, stats, ...opts});
        return [verdict, stats.dropped];
    };
    const me = {id: '1001', self: true};
    // Dan and Fay (bench) of the later plan, by its code
    assert.deepEqual(await check(lines(HEAD2, tick2(1, LATER.sig, [me, {id: '1002'}, {id: '1003'}, {id: '1006'}]))), ['ok', 0]);
    // the same rows under the head plan's code, an unknown code, no det, or without `known`: Dan and Fay go
    assert.deepEqual(await check(lines(HEAD2, tick2(1, FIRST.sig, [me, {id: '1003'}, {id: '1006'}]))), ['ok', 2]);
    assert.deepEqual(await check(lines(HEAD2, tick2(1, UNKNOWN, [me, {id: '1003'}]))), ['ok', 1]);
    assert.deepEqual(await check(lines(HEAD2, {ts: 1, riders: [me, {id: '1003'}]})), ['ok', 1]);
    assert.deepEqual(await check(lines(HEAD2, tick2(1, LATER.sig, [me, {id: '1003'}])), {known: null}), ['ok', 1]);
    // an outsider under a known code, and a self row of another athlete, go; inPlan proves nothing
    assert.deepEqual(await check(lines(HEAD2, tick2(1, LATER.sig, [me, {id: '1009', inPlan: true}, {id: '1009', self: true}]))), ['ok', 2]);
    // a forbidden key refuses, also on a row that would be dropped; a row that is no object refuses
    assert.deepEqual(await check(lines(HEAD2, tick2(1, UNKNOWN, [me, {id: '1009', heartrate: 1}]))), ['refused', 0]);
    assert.deepEqual(await check(lines(HEAD2, tick2(1, LATER.sig, [me, {id: '1003', cadence: 1}]))), ['refused', 0]);
    assert.deepEqual(await check(lines(HEAD2, tick2(1, LATER.sig, [me, 'x']))), ['refused', 0]);
});


// checkRecording with `file`: the text written there (null when the file is gone) and the verdict.
async function written(t, gz, opts) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paceline-check-'));
    t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
    const file = path.join(dir, 'out.tmp');
    const verdict = await checkRecording(gz, {athleteId: '1001', maxBytes: 1000000, ...opts, file});
    return {verdict, file, text: fs.existsSync(file) ? unz(fs.readFileSync(file)) : null};
}


test('checkRecording with a file: writes what it checked, one JSON line each, without the dropped rows', async t => {
    const known = knownPlans([FIRST, LATER]);
    const kept = tick2(1, LATER.sig, [{id: '1001', self: true}, {id: '1003', power: 3}]);
    const text = [
        JSON.stringify(HEAD2).replaceAll('":', '": '),    // spaces go: each line is written as JSON.stringify gives it
        JSON.stringify(kept),
        '',
        JSON.stringify(tick2(2, UNKNOWN, [{id: '1001', self: true}, {id: '1003', power: 3}, {id: '1009', watching: true}], {watchingId: '1009'})),
        JSON.stringify(tick2(3, UNKNOWN, [{id: '1002', watching: true}, {id: '1009'}], {watchingId: '1002'})),
        JSON.stringify({ts: 4, note: 'x'}),
    ].join('\n');    // the last line without a newline
    const gz = gzipSync(text);
    const stats = {dropped: 0};
    const w = await written(t, gz, {known, stats});
    assert.equal(w.verdict, 'ok');
    assert.equal(stats.dropped, 3);
    assert.equal(w.text, [
        JSON.stringify(HEAD2),
        JSON.stringify(kept),
        JSON.stringify(tick2(2, UNKNOWN, [{id: '1001', self: true}], {watchingId: null})),
        JSON.stringify(tick2(3, UNKNOWN, [{id: '1002', watching: true}], {watchingId: '1002'})),
        JSON.stringify({ts: 4, note: 'x'}),
    ].map(l => l + '\n').join(''));
    // the same input gives the same bytes (a retry matches the stored file), and it checks clean
    const again = await written(t, Buffer.from(gz), {known});
    assert.deepEqual(fs.readFileSync(again.file), fs.readFileSync(w.file));
    const clean = {dropped: 0};
    assert.equal(await checkRecording(fs.readFileSync(w.file), {athleteId: '1001', maxBytes: 1000000, known, stats: clean}), 'ok');
    assert.equal(clean.dropped, 0);
    // any other verdict leaves no file
    for (const [bad, verdict] of [[gzipSync('[1]\n'), 'refused'], [Buffer.from('not gzip'), 'bad'],
        [lines(HEAD2, {ts: 1, riders: [{id: '1001', self: true, heartrate: 1}]}), 'refused']]) {
        const r = await written(t, bad, {known});
        assert.equal(r.verdict, verdict);
        assert.equal(r.text, null);
    }
    // the file must be new
    const taken = await written(t, gz, {known});
    await assert.rejects(checkRecording(gz, {athleteId: '1001', maxBytes: 1000000, known, file: taken.file}), {code: 'EEXIST'});
    assert.equal(unz(fs.readFileSync(taken.file)), w.text, 'a file that was there stays');
});


test('checkRecording with a file: a key given twice is stored as checked, the last one', async t => {
    // JSON.parse keeps the last `riders`: the check saw only my row, so only my row is stored (until
    // 18 Nov 2026 the line was stored as sent, the outsider's row and heart rate in it)
    const tick = '{"ts":1,"riders":[{"id":"9999","heartrate":150,"power":300}],"riders":[{"id":"1001","self":true}]}';
    const head = '{"kind":"paceline-recording","plan":{"riders":[{"id":"9999"}],"bench":[]},"plan":{"riders":[{"id":"1001"}],"bench":[]}}';
    const w = await written(t, gzipSync(head + '\n' + tick + '\n'), {});
    assert.equal(w.verdict, 'ok');
    assert.equal(w.text, '{"kind":"paceline-recording","plan":{"riders":[{"id":"1001"}],"bench":[]}}\n{"ts":1,"riders":[{"id":"1001","self":true}]}\n');
    assert.ok(!w.text.includes('9999') && !w.text.includes('heartrate'));
});


test('checkRecording with a file: over maxOut written is too large, and no file stays', async t => {
    const gz = rec();
    const ok = await written(t, gz, {});
    const n = fs.statSync(ok.file).size;
    assert.equal((await written(t, gz, {maxOut: n})).verdict, 'ok');
    const over = await written(t, gz, {maxOut: n - 1});
    assert.deepEqual([over.verdict, over.text], ['toolarge', null]);
});


test('checkRecording with a file: a recording larger than the stream buffers comes through whole', async t => {
    const known = knownPlans([FIRST, LATER]);
    const rows = Array.from({length: 40}, (_, i) => ({id: String(2000 + i), power: i, pad: 'p'.repeat(200)}));
    const ticks = Array.from({length: 400}, (_, i) => tick2(i, i % 2 ? LATER.sig : UNKNOWN, [{id: '1001', self: true, pad: 'q'.repeat(3000)}, {id: '1003'}, ...rows]));
    const gz = lines(HEAD2, ...ticks);
    const stats = {dropped: 0};
    const w = await written(t, gz, {maxBytes: 100 * 1024 * 1024, known, stats});
    assert.equal(w.verdict, 'ok');
    assert.equal(stats.dropped, 400 * 40 + 200);
    const got = w.text.split('\n');
    assert.equal(got.length, 402);
    got.slice(1, 401).forEach((l, i) => assert.deepEqual(JSON.parse(l).riders.map(r => r.id), i % 2 ? ['1001', '1003'] : ['1001'], `tick ${i}`));
});


test('recordings: a later plan\'s riders pass when the tick names a stored version of the team, in the club file or the archive', async t => {
    const s = await setup(t, {clubs: [twoPlans()]});
    const body = lines(HEAD2,
        tick2(1, FIRST.sig, [{id: '1001', self: true, inPlan: true}, {id: '1002', inPlan: true}]),
        tick2(2, LATER.sig, [{id: '1001', self: true, inPlan: true}, {id: '1003', inPlan: true}, {id: '1006', inPlan: true}]));
    const name = `${SESSION}-1001.jsonl.gz`;
    await expectStatus(await s.post('rollers', params(), body), 201, {ok: true, file: name});
    // stored as it came
    assert.equal(unz(fs.readFileSync(s.logFile(KF, 'rollers', name))), unz(body));
    // the later version gone from the club file, kept in the team's archive: still known
    const archived = sheet({team: 'rollers', label: 'Rollers', date: '2026-11-19', riders: ['1001', '1002', '1004'], uploadedAt: '2026-11-19T18:55:00.000Z'});
    const s2 = await setup(t, {clubs: [twoPlans({later: false})]});
    // archived after the start (its sweep prunes archived versions no recording lists), used by Cleo's recording
    const cleo = `${SESSION}-1002.jsonl.gz`;
    s2.server.logs.put(KF, 'rollers', cleo, rec());
    assert.equal(s2.server.logs.addSigs(KF, 'rollers', cleo, [archived.sig]), true);
    assert.equal(s2.server.logs.archiveVersions(KF, 'rollers', [['ra0009', archived]]), 1);
    const viaArchive = lines(HEAD2, tick2(1, archived.sig, [{id: '1001', self: true}, {id: '1004', inPlan: true}]));
    await expectStatus(await s2.post('rollers', params(), viaArchive), 201);
    assert.equal(unz(fs.readFileSync(s2.logFile(KF, 'rollers', name))), unz(viaArchive));
});


test('recordings: rows no plan vouches for are dropped, the rest is stored, one log line', async t => {
    const s = await setup(t, {clubs: [twoPlans()]});
    const logged = [];
    const log = console.log;
    console.log = (...x) => logged.push(x.join(' '));
    t.after(() => {
        console.log = log;
    });
    const me = {id: '1001', self: true, inPlan: true};
    const body = lines(HEAD2,
        // Dan under an unknown code; an outsider watched
        tick2(1, UNKNOWN, [me, {id: '1002', inPlan: true}, {id: '1003', inPlan: true}, {id: '1009', watching: true}], {watchingId: '1009'}),
        // Gus is in Sprockets' plan, not in Rollers'
        tick2(2, OTHER.sig, [me, {id: '1005', inPlan: true}]),
        tick2(3, LATER.sig, [me, {id: '1003', inPlan: true}]));
    const name = `${SESSION}-1001.jsonl.gz`;
    await expectStatus(await s.post('rollers', params(), body), 201, {ok: true, file: name});
    const stored = gunzipSync(fs.readFileSync(s.logFile(KF, 'rollers', name))).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    assert.deepEqual(stored, [
        HEAD2,
        tick2(1, UNKNOWN, [me, {id: '1002', inPlan: true}], {watchingId: null}),
        tick2(2, OTHER.sig, [me]),
        tick2(3, LATER.sig, [me, {id: '1003', inPlan: true}]),
    ]);
    const lines3 = logged.filter(l => l.includes('rider rows'));
    assert.deepEqual(lines3, [`paceline-server: club ${KF}: recording for team rollers stored without 3 rider rows in no known plan of the team`]);
    assert.ok(!lines3[0].includes('1001') && !lines3[0].includes(SESSION));
    // the codes of every tick are kept, as before
    assert.deepEqual(rows(s.server.db, 'SELECT sig FROM recording_sigs WHERE cid = ? AND name = ? ORDER BY sig', KF, name).map(r => r.sig),
        [FIRST.sig, UNKNOWN, OTHER.sig, LATER.sig].sort());
    // a retry of the same body matches the stored file: 201, unchanged, no second log line
    const before = fs.readFileSync(s.logFile(KF, 'rollers', name));
    await expectStatus(await s.post('rollers', params(), Buffer.from(body)), 201, {ok: true, file: name});
    assert.deepEqual(fs.readFileSync(s.logFile(KF, 'rollers', name)), before);
    assert.equal(logged.filter(l => l.includes('rider rows')).length, 1);
});


test('recordings: a key given twice cannot carry a row or heart rate past the check', async t => {
    const s = await setup(t);
    const tick = '{"ts":1,"riders":[{"id":"9999","heartrate":150,"power":300}],"riders":[{"id":"1001","self":true}]}';
    const body = gzipSync(JSON.stringify(HEAD) + '\n' + tick + '\n');
    const name = `${SESSION}-1001.jsonl.gz`;
    await expectStatus(await s.post('rollers', params(), body), 201, {ok: true, file: name});
    assert.equal(unz(fs.readFileSync(s.logFile(KF, 'rollers', name))), JSON.stringify(HEAD) + '\n{"ts":1,"riders":[{"id":"1001","self":true}]}\n');
});


test('recordings: the file as stored is held to LOG_MAX_FILE_MB too', async t => {
    // numbers like 9e27 are written out in full (900000000000000000000000000): the stored file grows
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const nums = Array.from({length: 1500}, () => `${Math.floor(rnd() * 9 + 1)}e${Math.floor(20 + rnd() * 10)}`).join(',');
    const body = gzipSync(JSON.stringify(HEAD) + '\n{"ts":1,"riders":[{"id":"1001","self":true}],"v":[' + nums + ']}\n', {level: 9});
    const grown = gzipSync(JSON.stringify(HEAD) + '\n' + JSON.stringify({ts: 1, riders: [{id: '1001', self: true}], v: JSON.parse('[' + nums + ']')}) + '\n');
    assert.ok(grown.length > body.length + 100, `${grown.length} vs ${body.length}`);
    const limit = (body.length + grown.length) / 2;
    const s = await setup(t, {env: {LOG_MAX_FILE_MB: String(limit / MB)}});
    await expectStatus(await s.post('rollers', params(), body), 413, {error: 'too large'});
    assert.deepEqual(tree(path.join(s.dataDir, 'logs')), []);
    // with room for it, it is stored
    const roomy = await setup(t, {env: {LOG_MAX_FILE_MB: String((grown.length + 100) / MB)}});
    await expectStatus(await roomy.post('rollers', params(), body), 201);
});


test('log sweep: uploads a crash left in logs/.incoming go after a day', t => {
    const a = archiveSetup(t);
    const dir = path.join(a.dataDir, 'logs', '.incoming');
    fs.mkdirSync(dir, {recursive: true});
    const files = ['0123456789abcdef.tmp', 'fedcba9876543210.tmp', 'other.tmp'];
    for (const f of files) {
        fs.writeFileSync(path.join(dir, f), 'x');
        fs.utimesSync(path.join(dir, f), new Date(NOW - 2 * DAY), new Date(NOW - 2 * DAY));
    }
    fs.utimesSync(path.join(dir, files[1]), new Date(NOW - 3600000), new Date(NOW - 3600000));
    assert.equal(a.logs.sweep(NOW, 0), 0);
    assert.deepEqual(files.map(f => fs.existsSync(path.join(dir, f))), [false, true, true]);
    // not a club: nothing lists or counts it
    assert.deepEqual(a.logs.list('.incoming'), []);
    assert.equal(a.logs.totalBytes(), 0);
});


test('recordings: a body that grows when written out is held to the line and unpack caps (413, no file left)', async t => {
    const s = await setup(t);
    const nums = n => Array.from({length: n}, (_, i) => `${i % 9 + 1}e20`).join(',');
    const lineOf = n => `{"ts":1,"riders":[{"id":"1001","self":true}],"v":[${nums(n)}]}`;
    // one line under LOG_MAX_LINE as sent, over it as written (each 9e20 becomes 21 digits)
    const long = lineOf(50000);
    assert.ok(long.length < LOG_MAX_LINE && JSON.stringify(JSON.parse(long)).length > LOG_MAX_LINE);
    const one = gzipSync(JSON.stringify(HEAD) + '\n' + long + '\n', {level: 9});
    assert.ok(one.length < 10 * 1024, String(one.length));
    // ten short lines under the unpack cap (10 × LOG_MAX_FILE_MB) as sent, over it as written
    const ten = Array.from({length: 10}, () => lineOf(1000));
    const cap = 10 * Math.floor(0.01 * MB);
    const text = JSON.stringify(HEAD) + '\n' + ten.join('\n') + '\n';
    assert.ok(text.length < cap && ten.map(l => JSON.stringify(JSON.parse(l))).join('\n').length > cap);
    for (const body of [one, gzipSync(text, {level: 9})]) {
        await expectStatus(await s.post('rollers', params(), body), 413, {error: 'too large'});
        assert.deepEqual(tree(path.join(s.dataDir, 'logs')), []);
    }
    // the same numbers written out in full come through as they are (an honest line keeps its length)
    const plain = gzipSync(JSON.stringify(HEAD) + '\n' + JSON.stringify(JSON.parse(lineOf(200))) + '\n');
    await expectStatus(await s.post('rollers', params(), plain), 201);
});


test('recordings: a line over LOG_MAX_LINE as written is too large on its own, under a roomy unpack cap', async t => {
    // LOG_MAX_FILE_MB 1: the unpack cap is 10 MB, so only the written-line cap can refuse this body
    const s = await setup(t, {env: {LOG_MAX_FILE_MB: '1'}});
    const nums = Array.from({length: 50000}, (_, i) => `${i % 9 + 1}e20`).join(',');
    const long = `{"ts":1,"riders":[{"id":"1001","self":true}],"v":[${nums}]}`;
    const out = JSON.stringify(JSON.parse(long));
    assert.ok(long.length < LOG_MAX_LINE && out.length > LOG_MAX_LINE, 'under the line cap as sent, over it as written');
    const text = JSON.stringify(HEAD) + '\n' + long + '\n';
    assert.ok(JSON.stringify(HEAD).length + out.length + 2 < 10 * MB / 4, 'written in all far under the unpack cap');
    const body = gzipSync(text, {level: 9});
    assert.ok(body.length < MB, 'under LOG_MAX_FILE_MB packed');
    // as sent the body passes the check (no file: the written-line cap does not apply)
    assert.equal(await checkRecording(body, {athleteId: '1001', maxBytes: 10 * MB}), 'ok');
    await expectStatus(await s.post('rollers', params(), body), 413, {error: 'too large'});
    assert.deepEqual(tree(path.join(s.dataDir, 'logs')), []);
});


test('checkRecording with a file: a maxOut that trips mid-stream is too large every time, never a write error', async t => {
    // A write still on its way to the file when the check gives up must not count as the upload's
    // write error (ERR_STREAM_DESTROYED; 18 Nov 2026 re-review: without the guard 380 of 500 runs
    // threw, which the upload answers with 500). 4000 ticks of random numbers, the cap at 50 points.
    let seed = 3;
    const rnd = () => (seed = (seed * 16807) % 2147483647);
    const ticks = Array.from({length: 4000}, (_, i) => ({ts: i, riders: [{id: '1001', self: true, x: rnd(), y: rnd(), z: rnd()}]}));
    const gz = lines(HEAD, ...ticks);
    const whole = await written(t, gz, {maxBytes: 100 * MB});
    assert.ok(fs.statSync(whole.file).size > 2000 + 49 * 1500, 'every cap below the whole file');
    const got = {};
    for (let k = 0; k < 50; k++) {
        let verdict;
        try {
            const r = await written(t, gz, {maxBytes: 100 * MB, maxOut: 2000 + k * 1500});
            verdict = `${r.verdict}, ${r.text === null ? 'no file' : 'a file'}`;
        } catch (e) {
            verdict = `throws ${e.code ?? e.message}`;
        }
        got[verdict] = (got[verdict] ?? 0) + 1;
    }
    assert.deepEqual(got, {'toolarge, no file': 50});
});


test('recordings: a temp folder that cannot be cleaned up after a stored upload is a warning, the answer stays 201', async t => {
    const s = await setup(t);
    const warned = [], errors = [];
    const warn = console.warn, error = console.error;
    console.warn = (...x) => warned.push(x.join(' '));
    console.error = (...x) => errors.push(x.join(' '));
    const discard = s.server.logs.discard;
    s.server.logs.discard = () => {
        throw Object.assign(new Error('EPERM: operation not permitted'), {code: 'EPERM'});
    };
    t.after(() => {
        console.warn = warn;
        console.error = error;
        s.server.logs.discard = discard;
    });
    await expectStatus(await s.post('rollers', params()), 201);
    assert.deepEqual(warned, ['paceline-server: recording upload: logs/.incoming not cleaned up: EPERM']);
    assert.deepEqual(errors, []);
    // the slot is free again
    await expectStatus(await s.post('rollers', params({session: String(Number(SESSION) + 60000)})), 201);
});


// ---- Remove a rider: the recordings (19 Nov 2026) ----

// Hugo (made up), the rider a club removes; Ben (1001) uploads, Dan (1003) and Fay (1006, bench) ride along.
const HUGO = '7350981';
const RACE = T('2026-11-18T18:30Z');
const hugoHead = (selfId = '1001', selfName = 'Ben') => ({
    kind: 'paceline-recording', v: 1, sessionId: String(RACE), startedAt: RACE, planSig: 'AAAAAA', team: 'Rollers', selfId, selfName,
    plan: {sig: 'AAAAAA', team: 'Rollers', targetSpeed: 42, minimumFinishers: 3,
        riders: [{id: '1001', name: 'Ben', order: 0, pullS: 30, watts: 300, color: '#ffffff'},
            {id: HUGO, name: 'Hugo Testrider', order: 1, pullS: 40, watts: 320, color: '#ff0000'},
            {id: '1003', name: 'Dan', order: 2, pullS: 30, watts: 280, color: '#00ff00'}],
        bench: [{id: '1006', name: 'Fay'}, {id: HUGO, name: 'Hugo Testrider'}]},
});
const hugoTick = (ts, self = '1001') => ({
    ts, wt: ts + 5, selfId: self, watchingId: HUGO,
    riders: [{id: self, self: true, watching: false, power: 250, speed: 41.5, gap: 0},
        {id: HUGO, self: false, watching: true, inPlan: true, power: 330, speed: 41.6, gap: 1.2},
        {id: '1003', self: false, watching: false, inPlan: true, power: 280, speed: 41.4, gap: 2.5}],
    det: {planSig: 'AAAAAA', puller: HUGO, since: ts - 10, frontId: HUGO, wheel: HUGO, wheelObs: '1003', wheelCue: HUGO, place: 2,
        gap: {kind: 'drop', id: HUGO, m: 12, s: 1.5}},
    shown: {act: {k: 'rest', t: 20, place: 2}, meanW: 250, wheel: {planned: HUGO, live: '1003'}, next: {id: HUGO, planned: true}},
});
const hugoRecording = (self = '1001') => [hugoHead(self, self === HUGO ? 'Hugo Testrider' : 'Ben'),
    {...hugoTick(RACE + 1000, self), event: {sgId: 77, eventId: 5001, name: 'Made-up TTT', tags: ['ttt']}},
    hugoTick(RACE + 2000, self), {ts: RACE + 3000, note: 'no riders'}];
const gzLines = xs => gzipSync(xs.map(x => JSON.stringify(x)).join('\n') + '\n');
const linesOf = file => unz(fs.readFileSync(file)).split('\n').filter(Boolean).map(l => JSON.parse(l));


test('withoutRiders: rows, plan entries, ID fields and maps by ID go; numbers elsewhere, plan codes and other riders stay', () => {
    const gone = new Set([HUGO]);
    const head = hugoHead();
    const out = withoutRiders(head, gone);
    assert.deepEqual(out.plan.riders.map(r => r.id), ['1001', '1003']);
    assert.deepEqual(out.plan.bench, [{id: '1006', name: 'Fay'}]);
    assert.equal(out.selfName, 'Ben');
    assert.deepEqual(head.plan.riders.length, 3, 'the input is not changed');
    const tick = withoutRiders(hugoTick(1), gone);
    assert.deepEqual(tick.riders, hugoTick(1).riders.filter(r => r.id !== HUGO));
    assert.equal(tick.watchingId, null);
    assert.deepEqual(tick.det, {...hugoTick(1).det, puller: null, frontId: null, wheel: null, wheelCue: null, gap: {kind: 'drop', id: null, m: 12, s: 1.5}});
    assert.deepEqual(tick.shown, {...hugoTick(1).shown, wheel: {planned: null, live: '1003'}, next: {id: null, planned: true}});
    // his own head: his name goes with his id
    assert.deepEqual([withoutRiders(hugoHead(HUGO, 'Hugo Testrider'), gone).selfId, withoutRiders(hugoHead(HUGO, 'Hugo Testrider'), gone).selfName], [null, null]);
    // a number that is no ID field stays, a numeric ID field and a map key by his ID go, a plan code
    // stays, and so does a field that is no ID field (exact values in ID fields only: ruling N3)
    const n = Number(HUGO);
    assert.deepEqual(withoutRiders({power: n, puller: n, roster: {[HUGO]: {name: 'x'}, 1001: {}}, planSig: HUGO, note: HUGO}, gone),
        {power: n, puller: null, roster: {1001: {}}, planSig: HUGO, note: HUGO});
    // nothing of his: the very same value
    const clean = hugoTick(1);
    assert.equal(withoutRiders(clean, new Set(['999'])), clean);
});


test('remove rider: his own uploads go (deleted teams\' too), team-mates\' recordings are rewritten without him, others stay untouched', async t => {
    const a = archiveSetup(t);
    const at = T('2026-11-15T10:00Z');
    const store = (slug, name, xs, codes) => {
        a.logs.put(KF, slug, name, gzLines(xs));
        a.logs.addSigs(KF, slug, name, codes);
        const file = path.join(a.dir(slug), name);
        fs.utimesSync(file, new Date(at), new Date(at));
        return file;
    };
    const ben = `${RACE}-1001.jsonl.gz`, hugoOwn = `${RACE}-${HUGO}.jsonl.gz`, other = `${RACE - DAY}-1003.jsonl.gz`;
    const benFile = store('rollers', ben, hugoRecording('1001'), ['AAAAAA', 'BBBBBB']);
    store('rollers', hugoOwn, hugoRecording(HUGO), ['AAAAAA']);
    store('cogs', hugoOwn, hugoRecording(HUGO), ['CCCCCC']);    // a deleted team's folder
    const withoutHim = [{kind: 'paceline-recording', v: 1, plan: {riders: [{id: '1003', name: 'Dan'}], bench: []}},
        {ts: 1, riders: [{id: '1003', self: true, power: 200}]}];
    const otherFile = store('rollers', other, withoutHim, ['DDDDDD']);
    // an archived version only his own upload in cogs used goes with it (as a captain's Delete)
    assert.equal(a.logs.archiveVersions(KF, 'cogs', [['va0001', a.version(1, 'CCCCCC')]]), 1);
    const row = name => rows(a.db, 'SELECT slug, bytes, stored_at FROM recordings WHERE cid = ? AND name = ? ORDER BY slug', KF, name);
    const sigs = name => rows(a.db, 'SELECT slug, sig FROM recording_sigs WHERE cid = ? AND name = ? ORDER BY slug, sig', KF, name);
    const benRow = row(ben)[0];
    const otherBytes = fs.readFileSync(otherFile), otherMtime = fs.statSync(otherFile).mtimeMs;
    const usedBefore = a.logs.circleBytes(KF);
    a.clock.now += DAY;

    assert.deepEqual(await a.logs.eraseRider(KF, HUGO), {deleted: 2, changed: 1, failed: 0, unreadable: 0});
    // his own: blob, index row, codes, the archived version only it used, the empty folder
    assert.ok(!fs.existsSync(path.join(a.dir('rollers'), hugoOwn)));
    assert.ok(!fs.existsSync(a.dir('cogs')));
    assert.deepEqual([row(hugoOwn), sigs(hugoOwn)], [[], []]);
    assert.deepEqual(a.read('cogs'), {});
    // Ben's: no line holds Hugo's ID or name; everything else as it was
    const text = unz(fs.readFileSync(benFile));
    assert.ok(!text.includes(HUGO) && !text.includes('Hugo'), text);
    const before = hugoRecording('1001'), after = linesOf(benFile);
    assert.equal(after.length, before.length);
    assert.deepEqual(after[0], {...before[0], plan: {...before[0].plan, riders: before[0].plan.riders.filter(r => r.id !== HUGO), bench: [{id: '1006', name: 'Fay'}]}});
    for (const i of [1, 2]) {
        assert.deepEqual(after[i].riders.map(r => JSON.stringify(r)), before[i].riders.filter(r => r.id !== HUGO).map(r => JSON.stringify(r)), `tick ${i}`);
        assert.equal(after[i].watchingId, null);
        assert.deepEqual([after[i].det.puller, after[i].det.frontId, after[i].det.wheel, after[i].det.wheelObs, after[i].det.gap.id], [null, null, null, '1003', null]);
        assert.deepEqual(after[i].shown.next, {id: null, planned: true});
    }
    assert.deepEqual(after[1].event, before[1].event);
    assert.deepEqual(after[3], before[3]);
    // the head still reads as a recording and its plan as an engine plan (the ride report)
    const parsed = parseRecording(text);
    assert.equal(parsed.ticks.length, 2);
    const plan = readPlan(JSON.stringify(parsed.head));
    assert.equal(plan.form, 'engine');
    assert.deepEqual(plan.plan.riders.map(r => r.id), ['1001', '1003']);
    // the index: bytes follow the file, the stored time and the codes stay
    assert.deepEqual(row(ben), [{slug: 'rollers', bytes: fs.statSync(benFile).size, stored_at: benRow.stored_at}]);
    assert.notEqual(fs.statSync(benFile).size, benRow.bytes);
    assert.deepEqual(sigs(ben), [{slug: 'rollers', sig: 'AAAAAA'}, {slug: 'rollers', sig: 'BBBBBB'}]);
    assert.ok(a.logs.circleBytes(KF) < usedBefore);
    // a recording without him: not touched
    assert.deepEqual(fs.readFileSync(otherFile), otherBytes);
    assert.equal(fs.statSync(otherFile).mtimeMs, otherMtime);
    assert.deepEqual(fs.readdirSync(path.join(a.dataDir, 'logs', '.incoming')), [], 'no temp file left');

    // again: nothing to do, nothing written
    const benBytes = fs.readFileSync(benFile), benMtime = fs.statSync(benFile).mtimeMs;
    const n = changes(a.db);
    assert.deepEqual(await a.logs.eraseRider(KF, HUGO), {deleted: 0, changed: 0, failed: 0, unreadable: 0});
    assert.deepEqual(fs.readFileSync(benFile), benBytes);
    assert.equal(fs.statSync(benFile).mtimeMs, benMtime);
    assert.equal(changes(a.db), n);
    assert.deepEqual(await a.logs.eraseRider(KF, 'abc'), {deleted: 0, changed: 0, failed: 0, unreadable: 0});
});


test('remove rider: a recording that cannot be rewritten stays as it was, is logged without his ID, and the next run finishes it', async t => {
    const a = archiveSetup(t);
    const ben = `${RACE}-1001.jsonl.gz`, dan = `${RACE}-1003.jsonl.gz`;
    for (const name of [ben, dan]) {
        a.logs.put(KF, 'rollers', name, gzLines(hugoRecording(LOG_NAME_RE.exec(name)[2])));
    }
    const benFile = path.join(a.dir('rollers'), ben);
    const kept = fs.readFileSync(benFile);
    const bytes = rows(a.db, 'SELECT bytes FROM recordings WHERE name = ?', ben)[0].bytes;
    // the rename of Ben's new file fails (a full disk, a lost mount)
    const renameSync = fs.renameSync;
    fs.renameSync = (from, to) => {
        if (String(to) === benFile) {
            throw Object.assign(new Error('no space'), {code: 'ENOSPC'});
        }
        return renameSync(from, to);
    };
    let got;
    const logged = [];
    const error = console.error;
    console.error = (...x) => logged.push(x.join(' '));
    try {
        got = await a.logs.eraseRider(KF, HUGO);
    } finally {
        fs.renameSync = renameSync;
        console.error = error;
    }
    assert.deepEqual(got, {deleted: 0, changed: 1, failed: 1, unreadable: 0});
    assert.deepEqual(fs.readFileSync(benFile), kept);
    assert.equal(rows(a.db, 'SELECT bytes FROM recordings WHERE name = ?', ben)[0].bytes, bytes);
    assert.deepEqual(logged, [`paceline-server: club ${KF}: team rollers: a recording not rewritten without a removed rider: ENOSPC`]);
    assert.deepEqual(fs.readdirSync(path.join(a.dataDir, 'logs', '.incoming')), [], 'its temp file went');
    // a file that is no recording cannot be read: counted apart (another run cannot fix it)
    a.logs.put(KF, 'rollers', `${RACE}-1004.jsonl.gz`, Buffer.from('not gzip'));
    const unread = [];
    const quiet = console.error;
    console.error = (...x) => unread.push(x.join(' '));
    try {
        assert.deepEqual(await a.logs.eraseRider(KF, HUGO), {deleted: 0, changed: 1, failed: 0, unreadable: 1});
    } finally {
        console.error = quiet;
    }
    assert.deepEqual(unread, [`paceline-server: club ${KF}: team rollers: a recording that cannot be read was not checked for removed riders`]);
    assert.ok(!unz(fs.readFileSync(benFile)).includes(HUGO));
    assert.equal(rows(a.db, 'SELECT bytes FROM recordings WHERE name = ?', ben)[0].bytes, fs.statSync(benFile).size);
});


test('remove rider: a recording deleted while it is rewritten is not brought back', async t => {
    const a = archiveSetup(t);
    const name = `${RACE}-1001.jsonl.gz`;
    // large enough that the pass is still reading it when the Delete lands
    const many = [hugoHead(), ...Array.from({length: 20000}, (_, i) => hugoTick(RACE + i))];
    a.logs.put(KF, 'rollers', name, gzLines(many));
    const pass = a.logs.eraseRider(KF, HUGO);
    const inc = path.join(a.dataDir, 'logs', '.incoming');
    for (let i = 0; i < 2000 && !(fs.existsSync(inc) && fs.readdirSync(inc).length); i++) {
        await new Promise(r => setImmediate(r));
    }
    assert.equal(fs.readdirSync(inc).length, 1, 'the pass is writing its temp file');
    // the captain's Delete lands now, mid-read
    assert.equal(a.logs.remove(KF, 'rollers', name), true);
    assert.deepEqual(await pass, {deleted: 0, changed: 0, failed: 0, unreadable: 0});
    assert.ok(!fs.existsSync(path.join(a.dir('rollers'), name)), 'not brought back');
    assert.deepEqual(a.logs.list(KF), []);
    assert.deepEqual(fs.readdirSync(inc), [], 'its temp file went');
});


test('recordings: a ride from before a rider\'s removal is stored without him, even when its head plan lists him; a later ride keeps him', async t => {
    const s = await setup(t);
    const removedAt = Number(SESSION) + 3600000;
    const erase = (cid, aid, at) => s.server.erasures.list.append({cid, aid, at: new Date(at).toISOString()});
    erase(KF, HUGO, removedAt);
    // Ben's mod still has the plan with Hugo in it: the head plan vouches for his rows
    const body = gzLines(hugoRecording('1001'));
    const name = `${SESSION}-1001.jsonl.gz`;
    await expectStatus(await s.post('rollers', params(), body), 201, {ok: true, file: name});
    const text = unz(fs.readFileSync(s.logFile(KF, 'rollers', name)));
    assert.ok(!text.includes(HUGO) && !text.includes('Hugo'), text);
    assert.deepEqual(linesOf(s.logFile(KF, 'rollers', name))[1].riders.map(r => r.id), ['1001', '1003']);
    // a retry of the same body is the same file
    await expectStatus(await s.post('rollers', params(), Buffer.from(body)), 201, {ok: true, file: name});
    // another club does not erase him; a ride after the removal (he was listed again) keeps him
    erase(SP, '1003', removedAt);
    const later = String(removedAt + 60000);
    await expectStatus(await s.post('rollers', params({session: later}), body), 201);
    assert.ok(unz(fs.readFileSync(s.logFile(KF, 'rollers', `${later}-1001.jsonl.gz`))).includes(HUGO));
});


test('recordings: a removal that lands while the body is checked is applied before the file is stored', async t => {
    const s = await setup(t);
    // the first look finds nothing; the removal is noted while the check runs
    const logs = s.server.logs;
    const erasedFor = logs.erasedFor;
    let calls = 0;
    logs.erasedFor = (cid, session) => {
        calls++;
        if (calls === 1) {
            s.server.erasures.list.append({cid: KF, aid: HUGO, at: new Date(Number(SESSION) + 1000).toISOString()});
            return new Set();
        }
        return erasedFor(cid, session);
    };
    t.after(() => {
        logs.erasedFor = erasedFor;
    });
    const name = `${SESSION}-1001.jsonl.gz`;
    await expectStatus(await s.post('rollers', params(), gzLines(hugoRecording('1001'))), 201, {ok: true, file: name});
    assert.ok(calls >= 3);
    const text = unz(fs.readFileSync(s.logFile(KF, 'rollers', name)));
    assert.ok(!text.includes(HUGO) && !text.includes('Hugo'), text);
    assert.deepEqual(tree(path.join(s.dataDir, 'logs')), [KF, `${KF}/rollers`, `${KF}/rollers/${name}`]);
});
