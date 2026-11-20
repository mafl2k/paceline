// The operator's recording downloads on /admin (admin-recordings.mjs, user 20 Nov 2026): the gate,
// the list by team and race day in the club's time zone, one file as stored, the race tar with its
// plans, MISSING-PLANS.txt and README.txt, bad parameters, and recordings held for the erasure list.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import util from 'node:util';
import zlib from 'node:zlib';
import {startServer, fakeMailer, T, club as activeClub, sheet} from './helpers.mjs';
import {newClub} from '../club.mjs';
import {fileBytes} from '../admin-recordings.mjs';
import {readPlan} from '../../tools/ride-report/load.mjs';


// Everything the server logs during this file; the tests check it for rider names.
const captured = [];
for (const k of ['log', 'warn', 'error']) {
    console[k] = (...a) => {
        captured.push(util.format(...a));
    };
}

const ENV = {
    PUBLIC_URL: 'https://ttt-beta.example.org', SMTP_HOST: 'smtp.example.org', MAIL_FROM: 'Paceline <paceline@example.org>',
    ADMIN_USER: 'operator', ADMIN_PASS: 'made-up-admin-pass',
};
const START = T('2026-11-20T10:00:00.000Z');
const CID = 'k7f3q9x2m4';
const CID2 = 'm4x2k7f3q9';
const CID3 = 's9pk2m4q7d';
const RIGHT = 'Basic ' + Buffer.from('operator:made-up-admin-pass').toString('base64');
const DAY = '2026-11-19';

// Europe/Berlin is UTC+1 in November: the race day 2026-11-19 runs from 18 Nov 23:00 to 19 Nov 23:00 UTC.
const S_A = T('2026-11-19T18:30:00.000Z');     // Ben, 19:30 local
const S_B = T('2026-11-18T23:30:00.000Z');     // Cleo, 00:30 local on the 19th (UTC still the 18th)
const S_C = T('2026-11-19T23:30:00.000Z');     // Dan, 00:30 local on the 20th: another day
const S_D = T('2026-11-19T18:30:00.000Z');     // Eva, another team
const S_E = T('2026-11-19T18:00:00.000Z');     // Finn, held by the reconcile
const NAME = (s, aid) => `${s}-${aid}.jsonl.gz`;
const MISSING = 'ZZZZZZ';


async function setup({env = ENV} = {}) {
    const clock = {now: START};
    const srv = await startServer({env, clock, mailer: fakeMailer()});
    return {...srv, clock};
}

function get(base, p, {auth = RIGHT, method = 'GET'} = {}) {
    return fetch(base + p, {method, redirect: 'manual', headers: auth ? {authorization: auth} : {}});
}

const bytesOf = async res => Buffer.from(await res.arrayBuffer());

const textOf = html => html.replace(/<[^>]*>/g, ' ').replace(/&#39;/g, '\'').replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const amp = s => s.replace(/&/g, '&amp;');


// A tiny ustar reader: every entry's full name, size and bytes; checks each header's checksum, magic
// and type, the 512-byte padding and the two zero blocks at the end.
function untar(buf) {
    const out = [];
    let pos = 0;
    for (;;) {
        const h = buf.subarray(pos, pos + 512);
        assert.equal(h.length, 512, 'a whole header block');
        if (h.every(b => b === 0)) {
            break;
        }
        const str = (a, b) => h.subarray(a, b).toString('ascii').replace(/\0[\s\S]*$/, '');
        const sum = [...h].reduce((s, b, i) => s + (i >= 148 && i < 156 ? 32 : b), 0);
        assert.equal(parseInt(str(148, 156).trim(), 8), sum, 'checksum');
        assert.equal(str(257, 263), 'ustar');
        assert.equal(str(156, 157), '0');
        const prefix = str(345, 500);
        const name = prefix ? `${prefix}/${str(0, 100)}` : str(0, 100);
        const size = parseInt(str(124, 136), 8);
        out.push({name, size, data: buf.subarray(pos + 512, pos + 512 + size)});
        const padded = Math.ceil(size / 512) * 512;
        assert.ok(buf.subarray(pos + 512 + size, pos + 512 + padded).every(b => b === 0), 'zero padding');
        pos += 512 + padded;
    }
    assert.ok(buf.subarray(pos, pos + 1024).every(b => b === 0));
    assert.equal(buf.length, pos + 1024, 'two zero blocks end it');
    return out;
}


// An active club with two teams (rollers: a version of riders 1001-1003; spokes), recordings A-E,
// a version of rollers only in the archive, and E held back by the reconcile. Returns the codes.
function seed(srv) {
    const vA = sheet({team: 'rollers', label: 'Rollers', date: DAY, riders: ['1001', '1002', '1003'], uploadedAt: '2026-11-18T10:00:00.000Z'});
    const vArc = sheet({team: 'rollers', label: 'Rollers old', date: DAY, riders: ['1001', '1002', '1004'], uploadedAt: '2026-11-10T10:00:00.000Z'});
    const vSp = sheet({team: 'spokes', label: 'Spokes', date: DAY, riders: ['1004'], uploadedAt: '2026-11-18T10:00:00.000Z'});
    assert.notEqual(vA.sig, vArc.sig);
    const team = (name, live) => ({name, start: '19:30', live, version: 1, undo: null, changedAt: null});
    srv.store.create(activeClub({
        id: CID, teams: {rollers: team('Rollers', 'ra0001'), spokes: team('Spokes', 'sa0001')},
        sheets: {ra0001: vA, sa0001: vSp},
    }));
    // another active club, and a pending one
    srv.store.create(activeClub({id: CID2, name: 'Sprockets CC'}));
    srv.store.create(newClub({id: CID3, name: 'Pending Wheelers', email: 'second@example.org', tz: 'Europe/Berlin', now: START}));
    const logs = srv.server.logs;
    const files = {
        A: ['rollers', NAME(S_A, '1001'), zlib.gzipSync('{"kind":"paceline-recording"}\n{"ts":1,"riders":[]}\n')],
        B: ['rollers', NAME(S_B, '1002'), crypto.randomBytes(200_003)],     // several chunks, padded
        C: ['rollers', NAME(S_C, '1003'), crypto.randomBytes(700)],
        D: ['spokes', NAME(S_D, '1004'), crypto.randomBytes(900)],
        E: ['rollers', NAME(S_E, '1005'), crypto.randomBytes(800)],
    };
    for (const [slug, name, buf] of Object.values(files)) {
        logs.put(CID, slug, name, buf);
    }
    logs.addSigs(CID, 'rollers', files.A[1], [vA.sig, vArc.sig, MISSING]);
    logs.addSigs(CID, 'rollers', files.B[1], [vA.sig]);
    logs.addSigs(CID, 'rollers', files.C[1], [vA.sig]);
    assert.equal(logs.archiveVersions(CID, 'rollers', [['ra0000', vArc]]), 1);
    // E: another copy on disk (a restore of logs/) of a ride before a removal: held until checked
    const entry = {cid: CID, aid: '1009', at: '2026-11-19T18:10:00.000Z'};
    srv.server.erasures.list.append(entry);
    srv.server.erasures.markApplied(entry);
    fs.writeFileSync(path.join(srv.dataDir, 'logs', CID, 'rollers', files.E[1]), crypto.randomBytes(801));
    logs.reconcile();
    assert.ok(logs.isHeld(CID, 'rollers', files.E[1]));
    assert.ok(!logs.isHeld(CID, 'rollers', files.B[1]));
    return {vA, vArc, files};
}


test('the gate: 404 without an admin login, 401 without credentials, 405 for other methods', async () => {
    const off = await setup({env: {PUBLIC_URL: 'https://ttt-beta.example.org'}});
    try {
        for (const p of ['/admin/recordings', `/admin/recordings?cid=${CID}`, `/admin/recordings/file?cid=${CID}`, `/admin/recordings/race?cid=${CID}`]) {
            assert.equal((await get(off.base, p)).status, 404, p);
            assert.equal((await get(off.base, p, {auth: null})).status, 404, p);
        }
    } finally {
        await off.stop();
    }
    const srv = await setup();
    try {
        const {files} = seed(srv);
        const before = captured.length;
        const fileUrl = `/admin/recordings/file?cid=${CID}&slug=rollers&file=${files.A[1]}`;
        for (const p of [`/admin/recordings?cid=${CID}`, fileUrl, `/admin/recordings/race?cid=${CID}&slug=rollers&day=${DAY}`]) {
            const res = await get(srv.base, p, {auth: null});
            assert.equal(res.status, 401, p);
            assert.equal(res.headers.get('www-authenticate'), 'Basic realm="Paceline admin", charset="UTF-8"');
            const body = await res.text();
            assert.doesNotMatch(body, /Ben|Rollers|paceline-recording/);
            const wrong = await get(srv.base, p, {auth: 'Basic ' + Buffer.from('operator:nope').toString('base64')});
            assert.equal(wrong.status, 401, p);
            for (const method of ['POST', 'PUT', 'DELETE']) {
                const res2 = await get(srv.base, p, {method});
                assert.equal(res2.status, 405, `${method} ${p}`);
                assert.equal(res2.headers.get('allow'), 'GET');
            }
        }
        assert.ok(!captured.slice(before).some(l => /admin: download/.test(l)), 'nothing downloaded');
    } finally {
        await srv.stop();
    }
});


test('the club table links each active club to its recordings', async () => {
    const srv = await setup();
    try {
        seed(srv);
        const body = await (await get(srv.base, '/admin')).text();
        const row = cid => new RegExp(`<tr id="club-${cid}">([\\s\\S]*?)</tr>`).exec(body)[1];
        assert.match(row(CID), new RegExp(`<a href="/admin/recordings\\?cid=${CID}">Recordings \\(5\\)</a>`));
        assert.match(row(CID2), new RegExp(`<a href="/admin/recordings\\?cid=${CID2}">Recordings \\(0\\)</a>`));
        assert.doesNotMatch(row(CID3), /\/admin\/recordings/);
    } finally {
        await srv.stop();
    }
});


test('the list: by team and race day in the club\'s zone, names as the club knows them, held ones without a link', async () => {
    const srv = await setup();
    try {
        const {files} = seed(srv);
        const res = await get(srv.base, `/admin/recordings?cid=${CID}`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
        const body = await res.text();
        assert.doesNotMatch(body, /<script/i);
        const text = textOf(body);
        assert.ok(text.includes('Recordings of Kettenfett RC'), text);
        assert.ok(text.includes('Europe/Berlin'), text);
        // groups where their newest file is: rollers 20th (C), rollers 19th (A, E, B), spokes 19th (D)
        const titles = [...body.matchAll(/<h3>([^<]*)<\/h3>/g)].map(m => m[1]);
        assert.deepEqual(titles, ['Rollers · Fri 20 Nov (2026-11-20)', 'Rollers · Thu 19 Nov (2026-11-19)', 'Spokes · Thu 19 Nov (2026-11-19)']);
        const group = body.split('<h3>')[2];
        // newest first within the group, local times; Cleo's 23:30 UTC on the 18th is 00:30 on the 19th
        const rowsText = [...group.matchAll(/<tr><td>([\s\S]*?)<\/tr>/g)].map(m => textOf(m[1]).trim());
        assert.deepEqual(rowsText, ['Ben 19:30 1 KB Download', '1005 19:00 1 KB held back', 'Cleo 00:30 196 KB Download']);
        assert.ok(group.includes(amp(`<a href="/admin/recordings/race?cid=${CID}&slug=rollers&day=${DAY}">Download race</a>`)), group);
        assert.ok(textOf(group).includes('(2 recordings, 196 KB)'), textOf(group));
        assert.ok(group.includes(amp(`href="/admin/recordings/file?cid=${CID}&slug=rollers&file=${files.A[1]}"`)));
        assert.ok(!group.includes(`file=${files.E[1]}`), 'no link to the held file');
        assert.ok(text.includes('1 recording is held back until it is checked against the erasure list'), text);
        assert.ok(body.includes('<a href="/admin">Back to the operator page</a>'));
        // the other active club: none
        assert.ok(textOf(await (await get(srv.base, `/admin/recordings?cid=${CID2}`)).text()).includes('No recordings.'));
        // unknown, invalid or pending club: a 404 page
        for (const cid of ['zzzzzzzzzz', 'nope', '', CID3, `${CID}/..`]) {
            const r = await get(srv.base, `/admin/recordings?cid=${encodeURIComponent(cid)}`);
            assert.equal(r.status, 404, cid);
            assert.match(textOf(await r.text()), /This club no longer exists\. Back to the operator page/);
        }
        // HEAD as GET
        assert.equal((await get(srv.base, `/admin/recordings?cid=${CID}`, {method: 'HEAD'})).status, 200);
    } finally {
        await srv.stop();
    }
});


test('one file: the stored bytes as they are, as an attachment; one log line without names', async () => {
    const srv = await setup();
    try {
        const {files} = seed(srv);
        for (const [key, fname] of [['A', `rollers-${DAY}-1930-ben-1001.jsonl.gz`], ['B', `rollers-${DAY}-0030-cleo-1002.jsonl.gz`],
            ['C', 'rollers-2026-11-20-0030-dan-1003.jsonl.gz'], ['D', `spokes-${DAY}-1930-eva-1004.jsonl.gz`]]) {
            const [slug, name, buf] = files[key];
            const before = captured.length;
            const res = await get(srv.base, `/admin/recordings/file?cid=${CID}&slug=${slug}&file=${name}`);
            assert.equal(res.status, 200, key);
            // the rider's name as any version of the club gives it (Eva: the spokes version)
            assert.equal(res.headers.get('content-type'), 'application/gzip');
            assert.equal(res.headers.get('content-disposition'), `attachment; filename="${fname}"`);
            assert.equal(res.headers.get('cache-control'), 'no-store');
            assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
            assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
            assert.equal(res.headers.get('content-length'), String(buf.length));
            assert.ok((await bytesOf(res)).equals(buf), key);
            assert.deepEqual(captured.slice(before).filter(l => /download/.test(l)),
                             [`paceline-server: admin: download ${CID} ${slug} file (1 files, ${buf.length} bytes)`]);
        }
        assert.equal(captured.filter(l => /Ben|Cleo|Dan|Eva|Finn|ben-|cleo-/.test(l)).length, 0);
        // HEAD: the headers, no body, no log line
        const before = captured.length;
        const head = await get(srv.base, `/admin/recordings/file?cid=${CID}&slug=rollers&file=${files.A[1]}`, {method: 'HEAD'});
        assert.equal(head.status, 200);
        assert.equal(head.headers.get('content-length'), String(files.A[2].length));
        assert.equal((await bytesOf(head)).length, 0);
        assert.equal(captured.length, before);
    } finally {
        await srv.stop();
    }
});


test('one file: bad, foreign, unknown or held → 404, never a path outside the index', async () => {
    const srv = await setup();
    try {
        const {files} = seed(srv);
        const before = captured.length;
        // a file next to the recordings that is no recording
        fs.writeFileSync(path.join(srv.dataDir, 'logs', CID, 'rollers', 'secret.txt'), 'x');
        // a stored file without an index row
        fs.writeFileSync(path.join(srv.dataDir, 'logs', CID, 'rollers', NAME(S_A + 1, '1001')), 'y');
        const A = files.A[1];
        const bad = [
            ['nope', 'rollers', A], ['', 'rollers', A], [CID2, 'rollers', A], [CID3, 'rollers', A], [`${CID}/..`, 'rollers', A],
            [CID, 'spokes', A], [CID, '..', A], [CID, 'rollers/..', A], [CID, '', A], [CID, 'Rollers', A], [CID, 'nope', A],
            [CID, 'rollers', '../../paceline.db'], [CID, 'rollers', `../rollers/${A}`], [CID, 'rollers', 'secret.txt'],
            [CID, 'rollers', `${A}/`], [CID, 'rollers', ''], [CID, 'rollers', NAME(S_A + 1, '1001')], [CID, 'rollers', files.E[1]],
            [CID, '..%2Fspokes', files.D[1]],
        ];
        for (const [cid, slug, file] of bad) {
            const q = new URLSearchParams({cid, slug, file}).toString();
            const res = await get(srv.base, `/admin/recordings/file?${q}`);
            assert.equal(res.status, 404, q);
            assert.equal(await res.text(), 'not found', q);
        }
        assert.equal((await get(srv.base, `/admin/recordings/file?cid=${CID}&slug=rollers&file=..%2F..%2Fpaceline.db`)).status, 404);
        assert.equal((await get(srv.base, `/admin/recordings/file?cid=${CID}&slug=rollers`)).status, 404);
        assert.ok(!captured.slice(before).some(l => /admin: download/.test(l)));
    } finally {
        await srv.stop();
    }
});


test('race: a tar of the day\'s recordings of the team, the plans they name, MISSING-PLANS.txt and README.txt', async () => {
    const srv = await setup();
    try {
        const {vA, vArc, files} = seed(srv);
        const before = captured.length;
        const res = await get(srv.base, `/admin/recordings/race?cid=${CID}&slug=rollers&day=${DAY}`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('content-type'), 'application/x-tar');
        assert.equal(res.headers.get('content-disposition'), `attachment; filename="rollers-${DAY}.tar"`);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
        const buf = await bytesOf(res);
        assert.equal(res.headers.get('content-length'), String(buf.length));
        const tar = untar(buf);
        const dir = `rollers-${DAY}`;
        const baseA = `ben-1001-${S_A}.jsonl.gz`;
        const baseB = `cleo-1002-${S_B}.jsonl.gz`;
        const codes = [vA.sig, vArc.sig].sort();
        // README first, then the recordings oldest first, the plans by code, the missing codes; not C
        // (the 20th in Berlin), D (spokes) or E (held)
        assert.deepEqual(tar.map(e => e.name), [
            `${dir}/README.txt`, `${dir}/${baseB}`, `${dir}/${baseA}`, ...codes.map(c => `${dir}/plans/${c}.json`), `${dir}/MISSING-PLANS.txt`,
        ]);
        const entry = name => tar.find(e => e.name === `${dir}/${name}`);
        assert.ok(entry(baseA).data.equals(files.A[2]));
        assert.equal(entry(baseB).size, files.B[2].length);
        assert.ok(entry(baseB).data.equals(files.B[2]));
        // the plans in the server's stored form, as the ride report's --plan reads them
        for (const [v, code] of [[vA, vA.sig], [vArc, vArc.sig]]) {
            const text = entry(`plans/${code}.json`).data.toString('utf8');
            const obj = JSON.parse(text);
            assert.deepEqual(obj, {sig: code, json: v.json, text: v.text});
            const {plan, form} = readPlan(text);
            assert.equal(form, 'server');
            assert.equal(plan.sig, code);
        }
        const missing = entry('MISSING-PLANS.txt').data.toString('utf8');
        assert.match(missing, new RegExp(`\\n${MISSING}\\n$`));
        assert.ok(!codes.some(c => missing.includes(c)));
        const readme = entry('README.txt').data.toString('utf8');
        const lineA = `node "$PACELINE/tools/ride-report/report.mjs" ${baseA} ${codes.map(c => `--plan ${c}=plans/${c}.json`).join(' ')}`;
        const lineB = `node "$PACELINE/tools/ride-report/report.mjs" ${baseB} --plan ${vA.sig}=plans/${vA.sig}.json`;
        const lines = readme.split('\n');
        assert.ok(lines.includes(lineA), readme);
        assert.ok(lines.includes(lineB), readme);
        assert.ok(lines.indexOf(lineB) < lines.indexOf(lineA));
        assert.match(readme, /^Paceline recordings: Rollers \(rollers\), 2026-11-19 \(Europe\/Berlin\), 2 recordings\./);
        assert.match(readme, /MISSING-PLANS\.txt \(1\)/);
        assert.match(readme, /\n1 recording of this day held back until checked against the erasure list/);
        // the last line: the copies are outside the server's retention and Remove a rider
        assert.equal(lines.at(-2), 'These files hold riders\' data: delete this folder once the analysis is done. '
            + 'The server\'s retention and Remove a rider do not reach these copies.');
        assert.equal(lines.at(-1), '');
        assert.ok(!readme.includes('1005') && !readme.includes(files.C[1]));
        // one log line, without names
        assert.deepEqual(captured.slice(before).filter(l => /download/.test(l)),
                         [`paceline-server: admin: download ${CID} rollers ${DAY} (2 files, ${buf.length} bytes)`]);
        assert.equal(captured.filter(l => /Ben|Cleo|ben-|cleo-/.test(l)).length, 0);
        // the other days and teams on their own
        const twenty = untar(await bytesOf(await get(srv.base, `/admin/recordings/race?cid=${CID}&slug=rollers&day=2026-11-20`)));
        assert.deepEqual(twenty.map(e => e.name), ['rollers-2026-11-20/README.txt', `rollers-2026-11-20/dan-1003-${S_C}.jsonl.gz`, `rollers-2026-11-20/plans/${vA.sig}.json`]);
        const spokes = untar(await bytesOf(await get(srv.base, `/admin/recordings/race?cid=${CID}&slug=spokes&day=${DAY}`)));
        assert.deepEqual(spokes.map(e => e.name), [`spokes-${DAY}/README.txt`, `spokes-${DAY}/eva-1004-${S_D}.jsonl.gz`]);
        assert.match(spokes[0].data.toString('utf8'), /^Paceline recordings: Spokes \(spokes\), 2026-11-19 \(Europe\/Berlin\), 1 recording\.\n/);
        // HEAD: headers only
        const head = await get(srv.base, `/admin/recordings/race?cid=${CID}&slug=rollers&day=${DAY}`, {method: 'HEAD'});
        assert.equal(head.status, 200);
        assert.equal(head.headers.get('content-length'), String(buf.length));
    } finally {
        await srv.stop();
    }
});


test('race: bad or foreign club, team or day, or no recordings that day → 404', async () => {
    const srv = await setup();
    try {
        seed(srv);
        for (const [cid, slug, day] of [
            ['nope', 'rollers', DAY], [CID2, 'rollers', DAY], [CID3, 'rollers', DAY], [CID, 'nope', DAY], [CID, '..', DAY],
            [CID, 'rollers/..', DAY], [CID, 'rollers', '2026-11-21'], [CID, 'rollers', '2026-11-31'], [CID, 'rollers', '19.11.2026'],
            [CID, 'rollers', `${DAY}/..`], [CID, 'rollers', ''], [CID, 'spokes', '2026-11-20'],
        ]) {
            const q = new URLSearchParams({cid, slug, day}).toString();
            const res = await get(srv.base, `/admin/recordings/race?${q}`);
            assert.equal(res.status, 404, q);
        }
    } finally {
        await srv.stop();
    }
});


test('a removal not applied in full yet holds back every recording that began before it', async () => {
    const srv = await setup();
    try {
        const {files} = seed(srv);
        // listed but not applied (a Remove a rider still running, or one that failed)
        const entry = {cid: CID, aid: '1003', at: '2026-11-19T20:00:00.000Z'};
        srv.server.erasures.list.append(entry);
        const fileUrl = (slug, name) => `/admin/recordings/file?cid=${CID}&slug=${slug}&file=${name}`;
        for (const k of ['A', 'B', 'D']) {
            assert.equal((await get(srv.base, fileUrl(files[k][0], files[k][1]))).status, 404, k);
        }
        // C began after it
        assert.equal((await get(srv.base, fileUrl('rollers', files.C[1]))).status, 200);
        assert.equal((await get(srv.base, `/admin/recordings/race?cid=${CID}&slug=rollers&day=${DAY}`)).status, 404);
        const body = await (await get(srv.base, `/admin/recordings?cid=${CID}`)).text();
        assert.ok(textOf(body).includes('4 recordings are held back until they are checked against the erasure list'), textOf(body));
        assert.ok(!body.includes(`file=${files.A[1]}`) && !body.includes(`slug=rollers&amp;day=${DAY}`));
        assert.ok(body.includes(`file=${files.C[1]}`));
        // applied: served again
        srv.server.erasures.markApplied(entry);
        assert.equal((await get(srv.base, fileUrl('rollers', files.A[1]))).status, 200);
    } finally {
        await srv.stop();
    }
});


test('fileBytes: a file that grows or shrinks after its fstat throws', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-rec-'));
    try {
        const file = path.join(dir, 'x');
        const drain = async gen => {
            const parts = [];
            for await (const b of gen) {
                parts.push(Buffer.from(b));
            }
            return Buffer.concat(parts);
        };
        const data = crypto.randomBytes(150_000);
        fs.writeFileSync(file, data);
        let fh = await fs.promises.open(file, 'r');
        assert.ok((await drain(fileBytes(fh, (await fh.stat()).size))).equals(data));
        await fh.close();
        for (const change of [() => fs.appendFileSync(file, 'more'), () => fs.truncateSync(file, 1000)]) {
            fs.writeFileSync(file, data);
            fh = await fs.promises.open(file, 'r');
            const {size} = await fh.stat();
            change();
            await assert.rejects(drain(fileBytes(fh, size)), {code: 'changed'});
            await fh.close();
        }
    } finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
});


test('a held recording whose check fails stays held: not served, not in the tar, until a check succeeds', async () => {
    const srv = await setup();
    try {
        const {files} = seed(srv);
        const logs = srv.server.logs;
        // E's copy is no recording (random bytes): its check cannot read it
        assert.deepEqual({...await logs.checkHeld()}, {deleted: 0, changed: 0, failed: 0, unreadable: 1});
        assert.ok(logs.isHeld(CID, 'rollers', files.E[1]));
        const res = await get(srv.base, `/admin/recordings/file?cid=${CID}&slug=rollers&file=${files.E[1]}`);
        assert.equal(res.status, 404);
        const tar = untar(await bytesOf(await get(srv.base, `/admin/recordings/race?cid=${CID}&slug=rollers&day=${DAY}`)));
        assert.ok(!tar.some(e => e.name.includes('1005')), tar.map(e => e.name).join(' '));
        assert.match(tar[0].data.toString('utf8'), /\n1 recording of this day held back/);
        const body = await (await get(srv.base, `/admin/recordings?cid=${CID}`)).text();
        assert.ok(!body.includes(`file=${files.E[1]}`));
        // captains see it as before (its row), and the quota counts it as before
        assert.ok(logs.list(CID).some(r => r.file === files.E[1] && r.size === 800));
        // a copy that checks: written as a real recording without the removed rider, then checked
        fs.writeFileSync(path.join(srv.dataDir, 'logs', CID, 'rollers', files.E[1]),
                         zlib.gzipSync('{"kind":"paceline-recording","athleteId":1005}\n'));
        const r = await logs.checkHeld();
        assert.equal(r.unreadable + r.failed, 0, JSON.stringify(r));
        assert.ok(!logs.isHeld(CID, 'rollers', files.E[1]));
        assert.equal((await get(srv.base, `/admin/recordings/file?cid=${CID}&slug=rollers&file=${files.E[1]}`)).status, 200);
    } finally {
        await srv.stop();
    }
});


test('a held recording stays held while a check of it runs', async () => {
    const srv = await setup();
    try {
        const {files} = seed(srv);
        const logs = srv.server.logs;
        // checkFile asks the erasure list first: at that moment the file is out of the held map
        const list = srv.server.erasures.list;
        const orig = list.erasedFor;
        const seen = [];
        list.erasedFor = (cid, session) => {
            if (session === S_E) {
                seen.push(logs.isHeld(CID, 'rollers', files.E[1]));
            }
            return orig(cid, session);
        };
        try {
            await logs.checkHeld();
        } finally {
            list.erasedFor = orig;
        }
        assert.deepEqual(seen, [true]);
    } finally {
        await srv.stop();
    }
});


test('erasures.jsonl cannot be read: nothing is served (503), the list has no links', async () => {
    const clock = {now: START};
    const srv = await startServer({env: ENV, clock, mailer: fakeMailer(), prepare: dir => fs.mkdirSync(path.join(dir, 'erasures.jsonl'))});
    try {
        assert.ok(srv.server.logs.erasuresBroken());
        srv.store.create(activeClub({id: CID}));
        const name = NAME(S_A, '1001');
        srv.server.logs.put(CID, 'rollers', name, crypto.randomBytes(100));
        const file = await get(srv.base, `/admin/recordings/file?cid=${CID}&slug=rollers&file=${name}`);
        assert.equal(file.status, 503);
        assert.match(await file.text(), /erasures\.jsonl in the data folder cannot be read/);
        assert.equal((await get(srv.base, `/admin/recordings/race?cid=${CID}&slug=rollers&day=${DAY}`)).status, 503);
        const body = await (await get(srv.base, `/admin/recordings?cid=${CID}`)).text();
        assert.ok(!body.includes('/admin/recordings/file') && !body.includes('/admin/recordings/race'));
        assert.ok(textOf(body).includes('erasures.jsonl in the data folder cannot be read'));
    } finally {
        await srv.stop();
    }
});


for (const route of ['file', 'race']) {
    test(`${route}: a recording cut short while it is sent ends the answer with an error`, async () => {
        const srv = await setup();
        try {
            srv.store.create(activeClub({id: CID}));
            const name = NAME(S_A, '1001');
            srv.server.logs.put(CID, 'rollers', name, crypto.randomBytes(30 * 1024 * 1024));
            const before = captured.length;
            const url = route === 'file' ? `/admin/recordings/file?cid=${CID}&slug=rollers&file=${name}`
                : `/admin/recordings/race?cid=${CID}&slug=rollers&day=${DAY}`;
            const res = await get(srv.base, url);
            assert.equal(res.status, 200);
            const length = Number(res.headers.get('content-length'));
            assert.ok(length >= 30 * 1024 * 1024);
            await new Promise(r => setTimeout(r, 200));
            fs.truncateSync(path.join(srv.dataDir, 'logs', CID, 'rollers', name), 1000);
            let got = 0;
            await assert.rejects(async () => {
                for await (const c of res.body) {
                    got += c.length;
                }
            });
            assert.ok(got < length, `${got} of ${length}`);
            await new Promise(r => setTimeout(r, 50));
            assert.ok(captured.slice(before).some(l => /^paceline-server: admin: download .* aborted: changed$/.test(l)),
                      captured.slice(before).join('\n'));
        } finally {
            await srv.stop();
        }
    });
}
