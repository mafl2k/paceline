// Run with: node --test server/tests/server.test.mjs
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {createServer, parseMultipart, slugify} from '../server.mjs';
import {importFiles, normalizePlan, parseTextExport} from '../../pages/src/engine/plan.mjs';

const fixture = name => fs.readFileSync(new URL(`../../tests/fixtures/${name}`, import.meta.url), 'utf8');
const rollersJson = fixture('rollers.json');
const rollersTxt = fixture('rollers.txt');

const USER = 'captain';
const PASS = 'correct horse battery';
const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

let server, base, dataDir;

before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paceline-server-'));
    server = createServer({uploadUser: USER, uploadPass: PASS, dataDir});
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
    fs.rmSync(dataDir, {recursive: true, force: true});
});


function form({team, json, text} = {}) {
    const f = new FormData();
    if (team !== undefined) {
        f.append('team', team);
    }
    if (json !== undefined) {
        f.append('json', new Blob([json]), 'plan.json');
    }
    if (text !== undefined) {
        f.append('text', new Blob([text]), 'plan.txt');
    }
    return f;
}


function upload(fields, headers = {Authorization: AUTH}) {
    return fetch(base + '/upload', {method: 'POST', headers, body: form(fields)});
}


function storedFiles() {
    return fs.readdirSync(path.join(dataDir, 'plans')).sort();
}


function clearPlans() {
    for (const f of storedFiles()) {
        fs.rmSync(path.join(dataDir, 'plans', f));
    }
}


function renamedPlan(name, mutate) {
    const j = JSON.parse(rollersJson);
    j.team.name = name;
    if (mutate) {
        mutate(j);
    }
    return JSON.stringify(j);
}


test('refuses to start without credentials', () => {
    assert.throws(() => createServer({uploadUser: '', uploadPass: 'x', dataDir}), /UPLOAD_USER and UPLOAD_PASS/);
    assert.throws(() => createServer({uploadUser: 'x', uploadPass: '', dataDir}), /UPLOAD_USER and UPLOAD_PASS/);
    assert.throws(() => createServer({uploadUser: 'x', uploadPass: 'change-me-to-a-long-random-password', dataDir}), /placeholder/);
});

test('healthz needs no login', async () => {
    const r = await fetch(base + '/healthz');
    assert.equal(r.status, 200);
    assert.equal(await r.text(), 'ok');
});

test('upload without auth is 401 and stores nothing', async () => {
    clearPlans();
    const r = await upload({json: rollersJson, text: rollersTxt}, {});
    assert.equal(r.status, 401);
    assert.match(r.headers.get('www-authenticate'), /^Basic /);
    assert.deepEqual(storedFiles(), []);
    for (const bad of ['Basic ' + Buffer.from(`${USER}:wrong`).toString('base64'),
        'Basic ' + Buffer.from(`wrong:${PASS}`).toString('base64'),
        'Basic ' + Buffer.from(USER).toString('base64'),
        'Bearer abc']) {
        assert.equal((await upload({json: rollersJson}, {Authorization: bad})).status, 401, bad);
    }
    assert.equal((await fetch(base + '/')).status, 401);
    assert.deepEqual(storedFiles(), []);
});

test('upload with the Rollers fixtures stores the plan, API returns sig 5FWHC3', async () => {
    clearPlans();
    const r = await upload({team: '', json: rollersJson, text: rollersTxt});
    assert.equal(r.status, 200);
    const page = await r.text();
    assert.match(page, /5FWHC3/);
    assert.match(page, /Dario Brandl \[KFR\]/);
    assert.deepEqual(storedFiles(), ['rollers.json']);

    const api = await fetch(base + '/api/plan/rollers');
    assert.equal(api.status, 200);
    const rec = await api.json();
    assert.equal(rec.sig, '5FWHC3');
    assert.equal(rec.team, 'Rollers');
    assert.equal(rec.slug, 'rollers');
    assert.ok(rec.json.riders['5100002']);
    assert.equal(rec.text.length, 6);
    assert.ok(!Number.isNaN(Date.parse(rec.uploadedAt)));
    assert.match(api.headers.get('etag'), /^"5FWHC3-[0-9a-f]{8}"$/);
    assert.equal(rec.etag, api.headers.get('etag'));
    assert.equal(api.headers.get('access-control-expose-headers'), 'ETag');
    assert.equal(api.headers.get('cache-control'), 'no-cache');
    assert.equal(api.headers.get('access-control-allow-origin'), '*');
    // slug lookup is forgiving about case
    assert.equal((await fetch(base + '/api/plan/Rollers')).status, 200);
});

test('by-athlete finds the plan for a rider and for a bench rider, 404 otherwise', async () => {
    const r = await fetch(base + '/api/plan/by-athlete/5100002');
    assert.equal(r.status, 200);
    assert.equal((await r.json()).sig, '5FWHC3');
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.match(r.headers.get('etag'), /^"5FWHC3-[0-9a-f]{8}"$/);
    assert.equal((await fetch(base + '/api/plan/by-athlete/510007')).status, 200);  // bench
    assert.equal((await fetch(base + '/api/plan/by-athlete/999')).status, 404);
    assert.equal((await fetch(base + '/api/plan/by-athlete/abc')).status, 404);
    assert.equal((await fetch(base + '/api/plan/nobody')).status, 404);
    assert.equal((await fetch(base + '/api/plan/..%2F..%2Fetc%2Fpasswd')).status, 404);
});

test('304 on a matching If-None-Match, 200 on a stale one', async () => {
    const etag = (await fetch(base + '/api/plan/rollers')).headers.get('etag');
    const hit = await fetch(base + '/api/plan/rollers', {headers: {'If-None-Match': etag}});
    assert.equal(hit.status, 304);
    assert.equal(hit.headers.get('etag'), etag);
    assert.equal(hit.headers.get('access-control-expose-headers'), 'ETag');
    assert.equal(hit.headers.get('access-control-allow-origin'), '*');
    assert.equal((await hit.text()), '');
    assert.equal((await fetch(base + '/api/plan/rollers', {headers: {'If-None-Match': '"OTHER1"'}})).status, 200);
    assert.equal((await fetch(base + '/api/plan/by-athlete/5100002', {headers: {'If-None-Match': etag}})).status, 304);
    // the bare plan code is no longer a valid validator
    assert.equal((await fetch(base + '/api/plan/rollers', {headers: {'If-None-Match': '"5FWHC3"'}})).status, 200);
});

test('ETag is content-aware: rename-only re-upload changes it, identical re-upload does not', async () => {
    clearPlans();
    assert.equal((await upload({json: rollersJson, text: rollersTxt})).status, 200);
    const first = await fetch(base + '/api/plan/rollers');
    const etag1 = first.headers.get('etag');
    const rec1 = await first.json();

    // identical re-upload (new uploadedAt): same ETag, old validator still 304
    await new Promise(r => setTimeout(r, 5));
    assert.equal((await upload({json: rollersJson, text: rollersTxt})).status, 200);
    const again = await fetch(base + '/api/plan/rollers', {headers: {'If-None-Match': etag1}});
    assert.equal(again.status, 304);
    assert.equal(again.headers.get('etag'), etag1);
    const rec1b = await (await fetch(base + '/api/plan/rollers')).json();
    assert.notEqual(rec1b.uploadedAt, rec1.uploadedAt);
    assert.equal(rec1b.etag, etag1);

    // rename a rider and the bench entry only: order, pulls, watts and sig stay the same
    const renamed = renamedPlan('Rollers', j => {
        j.riders['5100002'].name = 'Dario Renamed';
        j.roster['510007'].name = 'Benched Renamed';
    });
    assert.equal((await upload({json: renamed, text: rollersTxt.replace('Dario Brandl [KFR]', 'Dario Renamed')})).status, 200);
    const stale = await fetch(base + '/api/plan/rollers', {headers: {'If-None-Match': etag1}});
    assert.equal(stale.status, 200);
    const rec2 = await stale.json();
    assert.equal(rec2.sig, rec1.sig);
    assert.notEqual(rec2.etag, etag1);
    assert.match(rec2.etag, /^"5FWHC3-[0-9a-f]{8}"$/);
    assert.equal(stale.headers.get('etag'), rec2.etag);
    assert.equal((await fetch(base + '/api/plan/rollers', {headers: {'If-None-Match': rec2.etag}})).status, 304);
});

test('by-athlete flipping between two teams with equal plan codes changes the ETag', async () => {
    clearPlans();
    assert.equal((await upload({team: 'Alpha', json: rollersJson, text: rollersTxt})).status, 200);
    await new Promise(r => setTimeout(r, 5));
    assert.equal((await upload({team: 'Bravo', json: rollersJson, text: rollersTxt})).status, 200);
    const b = await fetch(base + '/api/plan/by-athlete/5100002');
    assert.equal((await b.json()).slug, 'bravo');
    await new Promise(r => setTimeout(r, 5));
    assert.equal((await upload({team: 'Alpha', json: rollersJson, text: rollersTxt})).status, 200);
    const a = await fetch(base + '/api/plan/by-athlete/5100002', {headers: {'If-None-Match': b.headers.get('etag')}});
    assert.equal(a.status, 200);
    assert.equal((await a.json()).slug, 'alpha');
});

test('CORS preflight and header on the API', async () => {
    const r = await fetch(base + '/api/plan/rollers', {method: 'OPTIONS'});
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.equal((await fetch(base + '/api/plan/nobody')).headers.get('access-control-allow-origin'), '*');
});

test('text-only upload is an error and stores nothing new', async () => {
    const before = storedFiles();
    const r = await upload({team: 'Only Text', text: rollersTxt});
    assert.equal(r.status, 400);
    assert.match(await r.text(), /Load the JSON export too/);
    assert.deepEqual(storedFiles(), before);
    assert.equal((await fetch(base + '/api/plan/only-text')).status, 404);
});

test('error copy matches the mod for other bad uploads', async () => {
    const before = storedFiles();
    let r = await upload({json: 'hello'});
    assert.equal(r.status, 400);
    assert.match(await r.text(), /Could not read this file/);
    r = await upload({json: '{"hello": 1}'});
    assert.equal(r.status, 400);
    assert.match(await r.text(), /This is not a ZwiftGopher TTT plan\./);
    r = await upload({});
    assert.equal(r.status, 400);
    assert.match(await r.text(), /Load the JSON export too/);
    assert.deepEqual(storedFiles(), before);
});

test('json-only upload warns that watts are missing', async () => {
    const r = await upload({team: 'No Watts', json: rollersJson});
    assert.equal(r.status, 200);
    assert.match(await r.text(), /No text export loaded – pull watts will be missing\./);
    const rec = await (await fetch(base + '/api/plan/no-watts')).json();
    assert.equal(rec.text, null);
    assert.equal(rec.team, 'No Watts');
});

test('team name falls back to the JSON, and a plan without one needs one typed', async () => {
    clearPlans();
    const nameless = renamedPlan('', j => delete j.team);
    let r = await upload({json: nameless});
    assert.equal(r.status, 400);
    assert.match(await r.text(), /no team name/);
    r = await upload({team: '!!!', json: rollersJson});
    assert.equal(r.status, 400);
    assert.match(await r.text(), /at least one letter or digit/);
    assert.deepEqual(storedFiles(), []);
    r = await upload({team: 'Typed Name', json: nameless});
    assert.equal(r.status, 200);
    assert.deepEqual(storedFiles(), ['typed-name.json']);
});

test('by-athlete: the plan with the rider in the line-up beats a newer one with them only on the bench', async () => {
    clearPlans();
    assert.equal((await upload({json: rollersJson, text: rollersTxt})).status, 200);
    const reserve = renamedPlan('Freight Movers', j => {
        j.roster = {...(j.roster || {}), '5100002': j.riders['5100002']};
        delete j.riders['5100002'];
    });
    assert.equal((await upload({json: reserve})).status, 200);    // newer, rider only in its roster
    assert.equal((await (await fetch(base + '/api/plan/by-athlete/5100002')).json()).slug, 'rollers');
    // only on a bench anywhere: that plan is still found
    clearPlans();
    assert.equal((await upload({json: reserve})).status, 200);
    assert.equal((await (await fetch(base + '/api/plan/by-athlete/5100002')).json()).slug, 'freight-movers');
});


test('multi-team: slots are independent, upload replaces only its slot, delete removes one', async () => {
    clearPlans();
    assert.equal((await upload({json: rollersJson, text: rollersTxt})).status, 200);
    const other = renamedPlan('Wind Breakers', j => {
        j.riders['5100002'].pull_duration = 30;
    });
    assert.equal((await upload({json: other})).status, 200);
    assert.deepEqual(storedFiles(), ['rollers.json', 'wind-breakers.json']);

    const t1 = await (await fetch(base + '/api/plan/rollers')).json();
    const w1 = await (await fetch(base + '/api/plan/wind-breakers')).json();
    assert.equal(t1.sig, '5FWHC3');
    assert.notEqual(w1.sig, t1.sig);

    // by-athlete: both contain the rider, the newest upload wins
    assert.equal((await (await fetch(base + '/api/plan/by-athlete/5100002')).json()).slug, 'wind-breakers');

    // re-upload Rollers with a changed pull: only that slot changes, and it becomes the newest
    const changed = renamedPlan('Rollers', j => {
        j.riders['5100002'].pull_duration = 45;
    });
    assert.equal((await upload({json: changed})).status, 200);
    const t2 = await (await fetch(base + '/api/plan/rollers')).json();
    const w2 = await (await fetch(base + '/api/plan/wind-breakers')).json();
    assert.notEqual(t2.sig, '5FWHC3');
    assert.equal(w2.sig, w1.sig);
    assert.equal(w2.uploadedAt, w1.uploadedAt);
    assert.equal((await (await fetch(base + '/api/plan/by-athlete/5100002')).json()).slug, 'rollers');

    // the index lists both teams
    const index = await (await fetch(base + '/', {headers: {Authorization: AUTH}})).text();
    assert.match(index, /Rollers/);
    assert.match(index, /Wind Breakers/);

    // delete removes one
    const del = await fetch(base + '/delete', {method: 'POST', headers: {Authorization: AUTH, 'Content-Type': 'application/x-www-form-urlencoded'},
        body: 'slug=rollers'});
    assert.equal(del.status, 200);
    assert.equal((await fetch(base + '/api/plan/rollers')).status, 404);
    assert.equal((await fetch(base + '/api/plan/wind-breakers')).status, 200);
    assert.deepEqual(storedFiles(), ['wind-breakers.json']);
    assert.equal((await fetch(base + '/delete', {method: 'POST', headers: {Authorization: AUTH}, body: 'slug=..%2Fx'})).status, 404);
    assert.equal((await fetch(base + '/delete', {method: 'POST', body: 'slug=wind-breakers'})).status, 401);
    assert.deepEqual(storedFiles(), ['wind-breakers.json']);
});

test('rider names are HTML escaped on the result and index pages', async () => {
    clearPlans();
    const evil = renamedPlan('Evil <b>Team</b>', j => {
        j.riders['5100002'].name = 'Dario <script>alert(1)</script> &quot;x&quot;';
    });
    const r = await upload({json: evil});
    assert.equal(r.status, 200);
    const page = await r.text();
    assert.ok(!page.includes('<script>'), 'raw <script> in result page');
    assert.ok(!page.includes('<b>Team'), 'raw team markup in result page');
    assert.ok(page.includes('Dario &lt;script&gt;alert(1)&lt;/script&gt; &quot;x&quot;'));
    const index = await (await fetch(base + '/', {headers: {Authorization: AUTH}})).text();
    assert.ok(!index.includes('<b>Team'));
    assert.ok(index.includes('Evil &lt;b&gt;Team&lt;/b&gt;'));
    assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
});

test('uploads over 1 MB are refused', async () => {
    clearPlans();
    const big = JSON.stringify({pad: 'x'.repeat(1024 * 1024 + 10)});
    const r = await fetch(base + '/upload', {method: 'POST', headers: {Authorization: AUTH}, body: form({json: big})});
    assert.equal(r.status, 413);
    assert.match(await r.text(), /larger than 1 MB/);
    assert.deepEqual(storedFiles(), []);
});

test('a chunked upload without Content-Length is cut off at 1 MB too', async () => {
    clearPlans();
    const chunk = Buffer.alloc(64 * 1024, 120);
    const body = new ReadableStream({
        start(c) {
            for (let i = 0; i < 20; i++) {
                c.enqueue(chunk);
            }
            c.close();
        },
    });
    const r = await fetch(base + '/upload', {method: 'POST', duplex: 'half', body,
        headers: {Authorization: AUTH, 'Content-Type': 'multipart/form-data; boundary=XX'}});
    assert.equal(r.status, 413);
    assert.deepEqual(storedFiles(), []);
});

test('cross-site posts are refused even with credentials', async () => {
    clearPlans();
    let r = await fetch(base + '/upload', {method: 'POST', headers: {Authorization: AUTH, Origin: 'https://evil.example'}, body: form({json: rollersJson})});
    assert.equal(r.status, 403);
    r = await fetch(base + '/upload', {method: 'POST', headers: {Authorization: AUTH, 'Sec-Fetch-Site': 'cross-site'}, body: form({json: rollersJson})});
    assert.equal(r.status, 403);
    r = await fetch(base + '/upload', {method: 'POST', headers: {Authorization: AUTH, Origin: base}, body: form({json: rollersJson})});
    assert.equal(r.status, 200);
});

test('real browser header combination Origin: null + Sec-Fetch-Site: same-origin is allowed', async () => {
    clearPlans();
    const r = await fetch(base + '/upload', {method: 'POST', headers: {Authorization: AUTH, Origin: 'null', 'Sec-Fetch-Site': 'same-origin'},
        body: form({json: rollersJson})});
    assert.equal(r.status, 200);
    // Origin: null alone (no Sec-Fetch-Site) is not trusted
    const r2 = await fetch(base + '/upload', {method: 'POST', headers: {Authorization: AUTH, Origin: 'null'}, body: form({json: rollersJson})});
    assert.equal(r2.status, 403);
});

test('rider names with replacement patterns survive in warnings', async () => {
    clearPlans();
    const txt = rollersTxt + 'Odd $& $1 $$ Name\t100\t30\tRed\t#CC0000\n';
    const r = await upload({json: rollersJson, text: txt});
    assert.equal(r.status, 200);
    assert.ok((await r.text()).includes('&quot;Odd $&amp; $1 $$ Name&quot; from the text export is not in the JSON.'));
});

test('raw multipart: anything unexpected is rejected', async () => {
    clearPlans();
    const post = (body, type = 'multipart/form-data; boundary=XX') =>
        fetch(base + '/upload', {method: 'POST', headers: {Authorization: AUTH, 'Content-Type': type}, body});
    const part = (name, filename, content) =>
        `--XX\r\nContent-Disposition: form-data; name="${name}"${filename === null ? '' : `; filename="${filename}"`}\r\n\r\n${content}\r\n`;
    // sanity: a hand-built body is accepted
    assert.equal((await post(part('json', 'a.json', rollersJson) + '--XX--\r\n')).status, 200);
    clearPlans();
    // unknown field, duplicate field, file in team, text in json-less, header junk, bad boundary, truncated
    for (const body of [
        part('json', 'a.json', rollersJson) + part('evil', 'x', 'y') + '--XX--\r\n',
        part('json', 'a.json', rollersJson) + part('json', 'b.json', rollersJson) + '--XX--\r\n',
        part('team', 'x.txt', 'Team') + part('json', 'a.json', rollersJson) + '--XX--\r\n',
        part('json', null, rollersJson) + '--XX--\r\n',
        part('json', 'a.json', rollersJson),  // no closing delimiter
        part('json', 'a.json', rollersJson) + '--XX--\r\ntrailing junk',
        'junk before' + part('json', 'a.json', rollersJson) + '--XX--\r\n',
        `--XX\r\nX-Other: 1\r\nContent-Disposition: form-data; name="json"; filename="a"\r\n\r\n${rollersJson}\r\n--XX--\r\n`,
    ]) {
        assert.equal((await post(body)).status, 400, body.slice(0, 80));
    }
    assert.equal((await post('x', 'application/json')).status, 400);
    assert.equal((await post(part('json', 'a.json', rollersJson) + '--XX--\r\n', 'multipart/form-data; boundary=')).status, 400);
    assert.deepEqual(storedFiles(), []);
});

test('parseMultipart handles empty file parts and binary-ish content', () => {
    const body = Buffer.from('--B\r\nContent-Disposition: form-data; name="json"; filename="a.json"\r\nContent-Type: application/json\r\n\r\n{"a":1}\r\n' +
        '--B\r\nContent-Disposition: form-data; name="text"; filename=""\r\nContent-Type: application/octet-stream\r\n\r\n\r\n--B--\r\n');
    const out = parseMultipart(body, 'multipart/form-data; boundary=B');
    assert.equal(out.json.toString(), '{"a":1}');
    assert.equal(out.text.length, 0);
    assert.equal(out.team, null);
});

test('slugify', () => {
    assert.equal(slugify('Rollers'), 'rollers');
    assert.equal(slugify('  Wind  Breakers! '), 'wind-breakers');
    assert.equal(slugify('A/B..C'), 'a-b-c');
    assert.equal(slugify('日本'), '');
});

test('unknown routes and methods', async () => {
    assert.equal((await fetch(base + '/nope')).status, 404);
    assert.equal((await fetch(base + '/api/plan/rollers', {method: 'POST'})).status, 405);
    assert.equal((await fetch(base + '/upload')).status, 404);
});

test('a half-written temp file or damaged plan does not break listing', async () => {
    clearPlans();
    fs.writeFileSync(path.join(dataDir, 'plans', 'broken.json'), '{nope');
    fs.writeFileSync(path.join(dataDir, 'plans', '.x.json.1234.tmp'), '{');
    assert.equal((await upload({json: rollersJson})).status, 200);
    assert.equal((await fetch(base + '/', {headers: {Authorization: AUTH}})).status, 200);
    assert.equal((await fetch(base + '/api/plan/by-athlete/5100002')).status, 200);
    assert.equal((await fetch(base + '/api/plan/broken')).status, 404);
});

// ---- recording upload ----
// Every log test runs against its own server and DATA_DIR (withLogServer), so none depends on
// what an earlier one stored.

const SESSION = '1731400000000';
const gz = text => zlib.gzipSync(text);


function logPost(b, slug, query, body, headers = {}) {
    return fetch(`${b}/api/log/${slug}?${query}`, {method: 'POST', headers: {'Content-Type': 'application/octet-stream', ...headers}, body});
}


// A fresh server with its own DATA_DIR and a plan for Zone 23 (slug zone-23).
async function startOther(options) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paceline-server-'));
    const srv = createServer({uploadUser: USER, uploadPass: PASS, dataDir: dir, ...options});
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const b = `http://127.0.0.1:${srv.address().port}`;
    const up = await fetch(b + '/upload', {method: 'POST', headers: {Authorization: AUTH}, body: form({team: 'Zone 23', json: rollersJson})});
    assert.equal(up.status, 200);
    return {
        base: b,
        dir,
        port: srv.address().port,
        logs: (...p) => path.join(dir, 'logs', ...p),
        async stop() {
            srv.closeAllConnections();
            await new Promise(r => srv.close(r));
            fs.rmSync(dir, {recursive: true, force: true});
        },
    };
}


async function withLogServer(fn, options) {
    const o = await startOther(options);
    try {
        await fn(o);
    } finally {
        await o.stop();
    }
}


test('log upload stores the gzip for a team with a plan', () => withLogServer(async o => {
    const body = gz('{"kind":"paceline-recording"}\n');
    const r = await logPost(o.base, 'zone-23', `session=${SESSION}&athlete=123`, body);
    assert.equal(r.status, 201);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(await r.json(), {ok: true, file: `${SESSION}-123.jsonl.gz`});
    assert.deepEqual(fs.readFileSync(o.logs('zone-23', `${SESSION}-123.jsonl.gz`)), body);
    assert.deepEqual(fs.readdirSync(o.logs('zone-23')), [`${SESSION}-123.jsonl.gz`]);
}));

test('log upload without a plan is 404 and keeps the connection', () => withLogServer(async o => {
    const r = await logPost(o.base, 'nobody', `session=${SESSION}&athlete=123`, gz('x'));
    assert.equal(r.status, 404);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.notEqual(r.headers.get('connection'), 'close');
    assert.deepEqual(await r.json(), {error: 'no plan for this team'});
    assert.ok(!fs.existsSync(o.logs('nobody')));
}));

test('log upload rejects non-gzip and empty bodies, leaving no file and no .tmp', () => withLogServer(async o => {
    assert.equal((await logPost(o.base, 'zone-23', `session=${SESSION}&athlete=123`, gz('a'))).status, 201);
    const before = fs.readdirSync(o.logs('zone-23')).sort();
    for (const body of ['hello', Buffer.from([0x1f, 0x8b, 0x07, 0, 0]), '']) {
        const r = await logPost(o.base, 'zone-23', 'session=1731400000001&athlete=123', body);
        assert.equal(r.status, 400);
        assert.deepEqual(await r.json(), {error: 'bad request'});
    }
    assert.deepEqual(fs.readdirSync(o.logs('zone-23')).sort(), before);
}));

test('log upload rejects bad params, keeps the connection and never writes outside logs/', () => withLogServer(async o => {
    const files = () => fs.readdirSync(o.dir, {recursive: true}).sort();
    const before = files();
    for (const query of ['session=abc&athlete=123', `session=${SESSION}`, `athlete=123`, `session=${SESSION}&athlete=12x`,
        `session=${'1'.repeat(17)}&athlete=123`, `session=${SESSION}&athlete=${'1'.repeat(13)}`, 'session=&athlete=', `session=-1&athlete=2`,
        `session=1-2&athlete=3`, `session=1&athlete=2.jsonl.gz`]) {
        const r = await logPost(o.base, 'zone-23', query, gz('x'));
        assert.equal(r.status, 400, query);
        assert.notEqual(r.headers.get('connection'), 'close', query);
    }
    for (const slug of ['..%2Fx', '..%2Fplans%2Fzone-23', 'Zone-23', 'zone%2023', '%E0%A4%A']) {
        const r = await logPost(o.base, slug, `session=${SESSION}&athlete=123`, gz('x'));
        assert.ok([400, 404].includes(r.status), `${slug} -> ${r.status}`);
        assert.notEqual(r.headers.get('connection'), 'close', slug);
    }
    assert.deepEqual(files(), before);
}));

test('log upload: a body cut off by the client is dropped quietly, the server carries on', () => withLogServer(async o => {
    const logged = [];
    const orig = {error: console.error, warn: console.warn, log: console.log};
    for (const k of Object.keys(orig)) {
        console[k] = (...a) => logged.push(a);
    }
    try {
        const sent = gz('{"kind":"paceline-recording"}\n');
        await new Promise((resolve, reject) => {
            const sock = net.connect(o.port, '127.0.0.1', () => {
                sock.write(`POST /api/log/zone-23?session=${SESSION}&athlete=123 HTTP/1.1\r\n` +
                    `Host: 127.0.0.1\r\nContent-Type: application/gzip\r\nContent-Length: ${sent.length + 1000}\r\n\r\n`);
                sock.write(sent);
                setTimeout(() => {
                    sock.destroy();
                    resolve();
                }, 100);
            });
            sock.on('error', reject);
        });
        await new Promise(r => setTimeout(r, 200));
        // no stack trace (at most one plain line), no file and no .tmp
        assert.ok(logged.length <= 1, JSON.stringify(logged));
        for (const args of logged) {
            assert.ok(args.every(a => typeof a === 'string' && !a.includes('\n')), JSON.stringify(args));
        }
        assert.deepEqual(fs.existsSync(o.logs('zone-23')) ? fs.readdirSync(o.logs('zone-23')) : [], []);
    } finally {
        Object.assign(console, orig);
    }
    // the next request still works
    const body = gz('b');
    const r = await logPost(o.base, 'zone-23', `session=${SESSION}&athlete=123`, body);
    assert.equal(r.status, 201);
    assert.deepEqual(fs.readFileSync(o.logs('zone-23', `${SESSION}-123.jsonl.gz`)), body);
}));

test('log upload over the file cap is 413', () => withLogServer(async o => {
    const big = gz(crypto.randomBytes(1000));
    assert.ok(big.length > 100);
    const r = await logPost(o.base, 'zone-23', `session=${SESSION}&athlete=123`, big);
    assert.equal(r.status, 413);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(await r.json(), {error: 'too large'});
    assert.ok(!fs.existsSync(o.logs('zone-23', `${SESSION}-123.jsonl.gz`)));
    // a chunked body without Content-Length is cut off as well
    const chunked = new ReadableStream({start(c) { c.enqueue(big); c.close(); }});
    const r2 = await fetch(`${o.base}/api/log/zone-23?session=${SESSION}&athlete=124`, {method: 'POST', duplex: 'half', body: chunked});
    assert.equal(r2.status, 413);
    // at the cap is fine
    const small = gz('a');
    assert.ok(small.length <= 100);
    assert.equal((await logPost(o.base, 'zone-23', `session=${SESSION}&athlete=125`, small)).status, 201);
}, {logMaxFileBytes: 100}));

test('log upload over the total cap is 507, an overwrite counts only the difference', () => withLogServer(async o => {
    const a = Buffer.concat([Buffer.from([0x1f, 0x8b, 0x08]), Buffer.alloc(197, 1)]);
    const b = Buffer.concat([Buffer.from([0x1f, 0x8b, 0x08]), Buffer.alloc(197, 2)]);
    assert.equal(a.length, 200);
    assert.equal((await logPost(o.base, 'zone-23', `session=${SESSION}&athlete=1`, a)).status, 201);
    const r = await logPost(o.base, 'zone-23', `session=${SESSION}&athlete=2`, b);
    assert.equal(r.status, 507);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(await r.json(), {error: 'log storage full'});
    assert.deepEqual(fs.readdirSync(o.logs('zone-23')), [`${SESSION}-1.jsonl.gz`]);
    // same file again: 200 bytes replace 200 bytes, so it fits
    assert.equal((await logPost(o.base, 'zone-23', `session=${SESSION}&athlete=1`, b)).status, 201);
    assert.deepEqual(fs.readFileSync(o.logs('zone-23', `${SESSION}-1.jsonl.gz`)), b);
    // the total counts every team: a second team's 200 bytes do not fit next to the first
    assert.equal((await fetch(o.base + '/upload', {method: 'POST', headers: {Authorization: AUTH}, body: form({team: 'Other', json: rollersJson})})).status, 200);
    assert.equal((await logPost(o.base, 'other', `session=${SESSION}&athlete=1`, a)).status, 507);
}, {logMaxTotalBytes: 300}));

test('log preflight', () => withLogServer(async o => {
    const r = await fetch(o.base + '/api/log/zone-23', {method: 'OPTIONS'});
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.equal(r.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
    assert.equal(r.headers.get('access-control-allow-headers'), 'Content-Type');
    assert.equal(r.headers.get('access-control-max-age'), '600');
}));

test('log upload: other methods are 405', () => withLogServer(async o => {
    const r = await fetch(o.base + '/api/log/zone-23', {method: 'GET'});
    assert.equal(r.status, 405);
    assert.equal(r.headers.get('allow'), 'POST, OPTIONS');
    assert.equal((await fetch(o.base + '/api/log/zone-23', {method: 'PUT', body: 'x'})).status, 405);
}));

test('log download needs login', () => withLogServer(async o => {
    const body = gz('{"kind":"paceline-recording"}\n');
    assert.equal((await logPost(o.base, 'zone-23', `session=${SESSION}&athlete=123`, body)).status, 201);
    const url = `${o.base}/logs/zone-23/${SESSION}-123.jsonl.gz`;
    const anon = await fetch(url);
    assert.equal(anon.status, 401);
    assert.match(anon.headers.get('www-authenticate'), /^Basic /);
    const r = await fetch(url, {headers: {Authorization: AUTH}});
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/gzip');
    assert.equal(r.headers.get('content-disposition'), `attachment; filename="paceline-zone-23-${SESSION}-123.jsonl.gz"`);
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), body);
    assert.equal((await fetch(`${o.base}/logs/zone-23/${SESSION}-999.jsonl.gz`, {headers: {Authorization: AUTH}})).status, 404);
}));

test('log download refuses traversal', () => withLogServer(async o => {
    assert.equal((await logPost(o.base, 'zone-23', `session=${SESSION}&athlete=123`, gz('a'))).status, 201);
    for (const p of ['/logs/zone-23/..%2Fplans%2Fzone-23.json', '/logs/..%2Fplans/x', '/logs/zone-23/..%2F..%2Fplans%2Fzone-23.json',
        `/logs/zone-23/${SESSION}-123.jsonl.gz%00`, '/logs/zone-23/%E0%A4%A', '/logs/zone-23/x.jsonl.gz']) {
        const r = await fetch(o.base + p, {headers: {Authorization: AUTH}});
        assert.equal(r.status, 404, p);
        assert.ok(!(r.headers.get('content-type') || '').includes('gzip'), p);
    }
}));

test('log delete removes the file; cross-site and anonymous are refused', () => withLogServer(async o => {
    const file = `${SESSION}-123.jsonl.gz`;
    assert.equal((await logPost(o.base, 'zone-23', `session=${SESSION}&athlete=123`, gz('a'))).status, 201);
    const post = (body, headers) => fetch(o.base + '/logs/delete', {method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded', ...headers}, body});
    const q = `slug=zone-23&file=${file}`;
    assert.equal((await post(q, {})).status, 401);
    assert.equal((await post(q, {Authorization: AUTH, 'Sec-Fetch-Site': 'cross-site'})).status, 403);
    assert.ok(fs.existsSync(o.logs('zone-23', file)));
    const r = await post(q, {Authorization: AUTH, 'Sec-Fetch-Site': 'same-origin'});
    assert.equal(r.status, 200);
    assert.match(await r.text(), /Recording deleted/);
    assert.ok(!fs.existsSync(o.logs('zone-23', file)));
    // gone now, and a traversal attempt never touches the plan
    assert.equal((await post(q, {Authorization: AUTH})).status, 404);
    const bad = await post('slug=zone-23&file=..%2F..%2Fplans%2Fzone-23.json', {Authorization: AUTH});
    assert.equal(bad.status, 404);
    assert.equal((await fetch(o.base + '/api/plan/zone-23')).status, 200);
}));

test('index lists recordings with rider name or id, size and download link; deleting a plan keeps them', () => withLogServer(async o => {
    const named = `${SESSION}-5100002.jsonl.gz`;
    const unknown = `1731500000000-777.jsonl.gz`;
    assert.equal((await logPost(o.base, 'zone-23', `session=${SESSION}&athlete=5100002`, gz('a'.repeat(3000)))).status, 201);
    assert.equal((await logPost(o.base, 'zone-23', 'session=1731500000000&athlete=777', gz('b'))).status, 201);
    const index = await (await fetch(o.base + '/', {headers: {Authorization: AUTH}})).text();
    assert.ok(index.includes(`href="/logs/zone-23/${named}"`));
    assert.ok(index.includes(`href="/logs/zone-23/${unknown}"`));
    assert.match(index, /Dario Brandl \[KFR\]/);
    assert.match(index, /<td>777<\/td>/);
    assert.match(index, /2024-11-12 08:26/);
    assert.match(index, /2024-11-13 12:13/);
    assert.match(index, /Recordings: [\d.]+ MB of 2000 MB/);
    // newest session first
    assert.ok(index.indexOf(unknown) < index.indexOf(named));
    assert.match(index, /action="\/logs\/delete"/);

    // the plan goes, the recordings stay and the team is still listed (under its slug)
    assert.equal((await fetch(o.base + '/delete', {method: 'POST', headers: {Authorization: AUTH}, body: 'slug=zone-23'})).status, 200);
    const after = await (await fetch(o.base + '/', {headers: {Authorization: AUTH}})).text();
    assert.ok(after.includes(`href="/logs/zone-23/${named}"`));
    assert.ok(fs.existsSync(o.logs('zone-23', named)));
}));


const PRIVATE_KEYS = ['height', 'ftp', 'wkg300', 'power_profile', 'alt_name', 'adjustment'];

function keysDeep(v, out = new Set()) {
    if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
            out.add(k);
            keysDeep(x, out);
        }
    }
    return out;
}

// What the mod shows from a plan: code, and per rider order, pull, watts and colours.
function shown(json, text) {
    const {plan} = normalizePlan(json, text);
    return {
        sig: plan.sig, team: plan.team, targetSpeed: plan.targetSpeed, minimumFinishers: plan.minimumFinishers,
        riders: plan.riders.map(r => ({id: r.id, name: r.name, order: r.order, pullS: r.pullS, watts: r.watts,
            color: r.color, colorName: r.colorName})),
        bench: plan.bench,
    };
}

test('riders height, FTP and power profile are neither stored nor served, weight stays; the mod shows the same plan', async () => {
    clearPlans();
    const orig = JSON.parse(rollersJson);
    assert.ok(keysDeep(orig).has('weight') && keysDeep(orig).has('power_profile'), 'fixture carries the private fields');
    assert.equal((await upload({json: rollersJson, text: rollersTxt})).status, 200);
    const expected = shown(orig, parseTextExport(rollersTxt));
    assert.equal(expected.sig, '5FWHC3');

    const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'plans', 'rollers.json'), 'utf8'));
    for (const k of PRIVATE_KEYS) {
        assert.ok(!keysDeep(stored).has(k), `stored file has ${k}`);
        assert.ok(!fs.readFileSync(path.join(dataDir, 'plans', 'rollers.json'), 'utf8').includes(`"${k}"`), k);
    }
    for (const url of ['/api/plan/rollers', '/api/plan/by-athlete/5100002', '/api/plan/by-athlete/51006']) {
        const served = await (await fetch(base + url)).json();
        for (const k of PRIVATE_KEYS) {
            assert.ok(!keysDeep(served).has(k), `${url} serves ${k}`);
        }
        assert.deepEqual(shown(served.json, served.text), expected, url);
        // weight stays: the mod shows other riders' targets in W/kg with it
        assert.deepEqual(Object.fromEntries(Object.entries(served.json.riders).map(([id, r]) => [id, r.weight])),
            Object.fromEntries(Object.entries(orig.riders).map(([id, r]) => [id, r.weight])), url);
        // the mod's own import path (strings in, as the library stores them) gives the same code
        assert.equal(importFiles([JSON.stringify(served.json)]).plan.sig, normalizePlan(orig, null).plan.sig, url);
    }
});

test('a plan stored before the strip (with height and FTP) is served stripped, ETag stable across re-upload', async () => {
    clearPlans();
    const orig = JSON.parse(renamedPlan('Old Timers'));
    const text = parseTextExport(rollersTxt);
    const old = {team: 'Old Timers', slug: 'old-timers', sig: normalizePlan(orig, text).plan.sig, json: orig, text,
        uploadedAt: '2026-11-01T10:00:00.000Z'};
    fs.writeFileSync(path.join(dataDir, 'plans', 'old-timers.json'), JSON.stringify(old));
    assert.ok(keysDeep(old.json).has('ftp'));

    const r = await fetch(base + '/api/plan/old-timers');
    assert.equal(r.status, 200);
    const served = await r.json();
    for (const k of PRIVATE_KEYS) {
        assert.ok(!keysDeep(served).has(k), `served ${k}`);
    }
    assert.deepEqual(shown(served.json, served.text), shown(orig, text));
    const by = await (await fetch(base + '/api/plan/by-athlete/5100002')).json();
    assert.ok(!keysDeep(by).has('ftp') && keysDeep(by).has('weight'));
    // the same plan uploaded now is stored stripped and carries the very same ETag
    assert.equal((await upload({json: JSON.stringify(orig), text: rollersTxt})).status, 200);
    const again = await fetch(base + '/api/plan/old-timers');
    assert.equal(again.headers.get('etag'), r.headers.get('etag'));
    assert.equal((await fetch(base + '/api/plan/old-timers', {headers: {'If-None-Match': r.headers.get('etag')}})).status, 304);
});
