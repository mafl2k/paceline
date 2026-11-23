// Run with: node --test server/tests/erasures.test.mjs
// The erasure list (erasures.mjs): written on Remove a rider, applied again after a restore, the
// operator mail with its line, and /admin "Removals to re-apply".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {gzipSync, gunzipSync} from 'node:zlib';
import {openErasures, parseEntry, entryLine, expiryCutoff, ERASURES_FILE} from '../erasures.mjs';
import {openDb} from '../db.mjs';
import {openStore} from '../store.mjs';
import {makeLogStore} from '../logs.mjs';
import {createServer} from '../server.mjs';
import {club, sheet, T, rows, fakeMailer, startServer, refuseWrites} from './helpers.mjs';
import {makeClub, upload, followPost, post, flashOf, CID, ROLLERS, NOW as MANAGE_NOW} from './manage-helpers.mjs';

const KF = 'k7f3q9x2m4';
const AT = '2026-11-15T12:00:00.000Z';      // when Cleo (1002, made up) was removed
const NOW = T('2026-11-19T20:00:00Z');
const DAY = 86400000;

const tmpDir = t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paceline-erasures-'));
    t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
    return dir;
};

// Runs fn with console[kind] collected; returns the lines.
async function capture(kind, fn) {
    const lines = [];
    const orig = console[kind];
    console[kind] = (...x) => lines.push(x.join(' '));
    try {
        await fn();
    } finally {
        console[kind] = orig;
    }
    return lines;
}


test('the list: appended and synced line by line, known entries once, a bad line skipped and logged by its number', async t => {
    const dir = tmpDir(t);
    const file = path.join(dir, ERASURES_FILE);
    const list = openErasures(dir);
    const e = {cid: KF, aid: '1002', at: AT};
    // fsync before the append returns
    const fsyncSync = fs.fsyncSync;
    let synced = 0;
    fs.fsyncSync = fd => {
        synced++;
        return fsyncSync(fd);
    };
    try {
        assert.equal(list.append(e), true);
    } finally {
        fs.fsyncSync = fsyncSync;
    }
    assert.ok(synced >= 1);
    assert.equal(list.append({...e}), false, 'known');
    assert.equal(fs.readFileSync(file, 'utf8'), `{"cid":"${KF}","aid":"1002","at":"${AT}"}\n`);
    assert.equal(entryLine(e), `{"cid":"${KF}","aid":"1002","at":"${AT}"}`);
    assert.throws(() => list.append({cid: KF, aid: 'x', at: AT}), TypeError);
    // what parseEntry takes: exactly the three fields, an ISO time as toISOString writes it
    for (const bad of ['', 'x', '[]', JSON.stringify({...e, extra: 1}), JSON.stringify({...e, at: '2026-11-15'}),
        JSON.stringify({...e, aid: 1002}), JSON.stringify({...e, cid: 'KF'}), JSON.stringify({...e, at: '2026-02-30T12:00:00.000Z'})]) {
        assert.equal(parseEntry(bad), null, bad);
    }
    assert.deepEqual(parseEntry(` ${entryLine(e)} `), e);
    // a damaged line and a line cut off by a crash: skipped and logged by number, never fatal
    fs.appendFileSync(file, 'not json\n{"cid":"k7f3q9x2m4","aid":"1003","at":"2026-11-16T0');
    let again;
    const warned = await capture('warn', () => {
        again = openErasures(dir);
    });
    assert.deepEqual(warned, [`paceline-server: ${ERASURES_FILE}: line 2 is no removal entry, skipped`,
        `paceline-server: ${ERASURES_FILE}: line 3 is no removal entry, skipped`]);
    assert.ok(!warned.join('').includes('1002') && !warned.join('').includes('1003'));
    assert.deepEqual(again.entries(), [e]);
    // the next append starts on a line of its own
    const f = {cid: KF, aid: '1004', at: '2026-11-17T08:00:00.000Z'};
    assert.equal(again.append(f), true);
    assert.deepEqual(openErasures(dir).entries(), [e, f]);
    // erasedFor: rides that began before a removal of that club
    assert.deepEqual([...again.erasedFor(KF, T(AT) - 1)].sort(), ['1002', '1004']);
    assert.deepEqual([...again.erasedFor(KF, T(AT))], ['1004']);
    assert.deepEqual([...again.erasedFor('p2m8c4t1v9', 0)], []);
});


test('the list: entries older than the backups plus a month go, the file rewritten whole', async t => {
    const dir = tmpDir(t);
    const list = openErasures(dir);
    assert.equal(new Date(expiryCutoff(T('2026-11-19T20:00:00Z'), 6)).toISOString(), '2026-04-19T20:00:00.000Z');
    const old = {cid: KF, aid: '1002', at: '2026-04-19T19:59:59.999Z'};
    const edge = {cid: KF, aid: '1003', at: '2026-04-19T20:00:00.000Z'};
    list.append(old);
    list.append(edge);
    assert.equal(list.expire(expiryCutoff(T('2026-11-19T20:00:00Z'), 6)), 1);
    assert.deepEqual(list.entries(), [edge]);
    assert.equal(fs.readFileSync(path.join(dir, ERASURES_FILE), 'utf8'), entryLine(edge) + '\n');
    assert.deepEqual(fs.readdirSync(dir), [ERASURES_FILE], 'no temp file left');
    assert.equal(list.expire(0), 0);
});


// ---- a restore: an older paceline.db and older recordings, the current erasures.jsonl ----

const head = riders => ({kind: 'paceline-recording', v: 1, planSig: 'AAAAAA', plan: {riders: riders.map(id => ({id, name: `R${id}`})), bench: []}});
const recording = (self, riders) => gzipSync([head(riders), {ts: 1, riders: riders.map(id => ({id, self: id === self, power: 200}))}]
    .map(x => JSON.stringify(x)).join('\n') + '\n');
const unz = file => gunzipSync(fs.readFileSync(file)).toString('utf8');

// The data folder as a backup from before Cleo's removal has it, plus what was stored after it
// (she was listed again): versions, a check, an archived version, recordings.
function seedOld(dataDir) {
    const db = openDb(dataDir);
    try {
        const clock = {now: T('2026-11-10T16:00:00Z')};
        const logs = makeLogStore(dataDir, {db, now: () => clock.now});
        const store = openStore({db, now: () => clock.now, archive: logs});
        const old = sheet({team: 'rollers', label: 'Rollers', date: '2026-11-19', riders: ['1001', '1002'], uploadedAt: '2026-11-10T16:00:00.000Z'});
        const later = sheet({team: 'rollers', label: 'Rollers B', date: '2026-11-19', riders: ['1001', '1002', '1003'], uploadedAt: '2026-11-18T10:00:00.000Z'});
        store.create(club({teams: {rollers: {name: 'Rollers', start: '19:30', live: 'ra0002', version: 1, undo: null, changedAt: null}},
            sheets: {ra0001: old, ra0002: later}}));
        assert.equal(store.see(KF, '1002', {sig: old.sig, mod: '0.3.0', sheet: 'ra0001', inEvent: false, event: null}), true);
        store.flushSeen();
        const put = (name, buf, codes) => {
            logs.put(KF, 'rollers', name, buf);
            logs.addSigs(KF, 'rollers', name, codes);
        };
        put(`${T('2026-11-12T18:30:00Z')}-1001.jsonl.gz`, recording('1001', ['1001', '1002']), ['AAAAAA']);
        put(`${T('2026-11-12T18:30:00Z')}-1002.jsonl.gz`, recording('1002', ['1001', '1002']), ['AAAAAA']);
        put(`${T('2026-11-18T18:30:00Z')}-1003.jsonl.gz`, recording('1003', ['1002', '1003']), ['BBBBBB']);
        const arch = v => ({...v, plan: 'ra0009', recSig: 'AAAAAA'});
        assert.equal(logs.archiveVersions(KF, 'rollers', [['ra0009', arch(sheet({team: 'rollers', label: 'Rollers', date: '2026-11-12',
            riders: ['1001', '1002'], uploadedAt: '2026-11-11T16:00:00.000Z'}))]]), 1);
    } finally {
        db.close();
    }
}

// A server on `dataDir` (not removed at stop), with its start log lines.
async function boot(t, dataDir) {
    let server;
    const logged = await capture('log', async () => {
        server = createServer({env: {DATA_DIR: dataDir}, now: () => NOW});
        await server.erasuresApplied;
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const stop = () => new Promise(r => server.close(r));
    return {server, logged, stop};
}


test('a restore: at start every removal this paceline.db has not applied is applied again, to what was stored before it only', async t => {
    const dataDir = tmpDir(t);
    seedOld(dataDir);
    fs.writeFileSync(path.join(dataDir, ERASURES_FILE), `${entryLine({cid: KF, aid: '1002', at: AT})}\n{broken\n`);
    const dir = path.join(dataDir, 'logs', KF, 'rollers');
    const warned = [];
    const warn = console.warn;
    console.warn = (...x) => warned.push(x.join(' '));
    let a;
    try {
        a = await boot(t, dataDir);
    } finally {
        console.warn = warn;
    }
    assert.ok(warned.some(l => l.includes(`${ERASURES_FILE}: line 2 is no removal entry`)), 'a bad line is logged, the start goes on');
    const lines = a.logged.filter(l => l.includes('applied again'));
    assert.equal(lines.length, 1);
    assert.match(lines[0], /1 removals applied again: 1 plans, 1 archived versions, 1 recordings changed, 1 deleted, 0 parts failed/);
    assert.ok(!lines[0].includes('1002'));
    const c = a.server.store.get(KF);
    // the version from before the removal loses her, the one stored after it keeps her
    assert.deepEqual(Object.keys(c.sheets.ra0001.json.riders), ['1001']);
    assert.deepEqual(Object.keys(c.sheets.ra0002.json.riders).sort(), ['1001', '1002', '1003']);
    assert.ok(!Object.hasOwn(a.server.store.seenOf(KF), '1002'), 'her check from before');
    const archived = rows(a.server.db, 'SELECT version FROM archive WHERE cid = ?', KF).map(r => JSON.parse(r.version));
    assert.deepEqual(archived.map(v => Object.keys(v.json.riders)), [['1001']]);
    // her own upload from before goes, a team-mate's loses her, a ride after the removal keeps her
    assert.ok(!fs.existsSync(path.join(dir, `${T('2026-11-12T18:30:00Z')}-1002.jsonl.gz`)));
    assert.ok(!unz(path.join(dir, `${T('2026-11-12T18:30:00Z')}-1001.jsonl.gz`)).includes('1002'));
    const laterFile = path.join(dir, `${T('2026-11-18T18:30:00Z')}-1003.jsonl.gz`);
    assert.ok(unz(laterFile).includes('1002'));
    assert.deepEqual(a.server.erasures.pending(), []);
    await a.stop();

    // the next start: nothing pending, nothing written
    const mtime = fs.statSync(path.join(dir, `${T('2026-11-12T18:30:00Z')}-1001.jsonl.gz`)).mtimeMs;
    const b = await boot(t, dataDir);
    assert.deepEqual(b.logged.filter(l => l.includes('applied again')), []);
    assert.equal(fs.statSync(path.join(dir, `${T('2026-11-12T18:30:00Z')}-1001.jsonl.gz`)).mtimeMs, mtime);
    assert.deepEqual(Object.keys(b.server.store.get(KF).sheets.ra0002.json.riders).sort(), ['1001', '1002', '1003']);
    // the meta row holds hashes, never the Zwift ID
    const meta = rows(b.server.db, "SELECT value FROM meta WHERE name = 'erasures_applied'")[0].value;
    assert.equal(JSON.parse(meta).length, 1);
    assert.ok(!meta.includes('1002'));
    await b.stop();
});


test('a restore: a recording that cannot be rewritten keeps the entry pending, the next start finishes it', async t => {
    const dataDir = tmpDir(t);
    seedOld(dataDir);
    fs.writeFileSync(path.join(dataDir, ERASURES_FILE), `${entryLine({cid: KF, aid: '1002', at: AT})}\n`);
    const target = path.join(dataDir, 'logs', KF, 'rollers', `${T('2026-11-12T18:30:00Z')}-1001.jsonl.gz`);
    const renameSync = fs.renameSync;
    fs.renameSync = (from, to) => {
        if (String(to) === target) {
            throw Object.assign(new Error('io'), {code: 'EIO'});
        }
        return renameSync(from, to);
    };
    let a;
    const errors = await capture('error', async () => {
        try {
            a = await boot(t, dataDir);
        } finally {
            fs.renameSync = renameSync;
        }
    });
    assert.deepEqual(errors, [`paceline-server: club ${KF}: team rollers: a recording not rewritten without a removed rider: EIO`]);
    assert.ok(unz(target).includes('1002'));
    assert.equal(a.server.erasures.pending().length, 1);
    await a.stop();
    const b = await boot(t, dataDir);
    assert.ok(!unz(target).includes('1002'));
    assert.deepEqual(b.server.erasures.pending(), []);
    await b.stop();
});


// ---- Remove a rider: the entry, the mark, the operator mail ----

const MAIL_ENV = {PUBLIC_URL: 'https://ttt-beta.example.org', SMTP_HOST: 'smtp.example.org', MAIL_FROM: 'Paceline <paceline@example.org>'};

// A server holding makeClub() with Rollers' plan, its mail queue `mailer`.
async function clubServer(t, {env = {}, mailer = fakeMailer()} = {}) {
    const c = makeClub();
    upload(c.club, 'rollers', {riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const clock = {now: MANAGE_NOW};
    const srv = await startServer({env, clock, mailer});
    t.after(() => srv.stop());
    srv.store.create(c.club);
    return {srv, cookie: c.cookie, mailer, clock};
}


test('Remove a rider: the entry is on the list, marked applied, and the operator gets its line by mail', async t => {
    const {srv, cookie, mailer, clock} = await clubServer(t, {env: {...MAIL_ENV, PRIVACY_CONTACT: 'Paceline beta, privacy@example.org.'}});
    const at = new Date(MANAGE_NOW).toISOString();
    const res = await followPost(srv, cookie, '/manage/rider/remove', {zwiftId: '1002', confirm: '1'});
    assert.equal(res.flash.kind, 'ok');
    const line = `{"cid":"${CID}","aid":"1002","at":"${at}"}`;
    assert.equal(fs.readFileSync(path.join(srv.dataDir, ERASURES_FILE), 'utf8'), line + '\n');
    assert.deepEqual(srv.server.erasures.pending(), []);
    assert.equal(mailer.sent.length, 1);
    const m = mailer.sent[0];
    assert.deepEqual([m.kind, m.to, m.budget], ['rider-removed', 'privacy@example.org', 'operator']);
    assert.equal(m.subject, 'Paceline: a rider was removed from Kettenfett RC');
    assert.match(m.text, new RegExp(`^On ${at.slice(0, 16).replace('T', ' ')} UTC a captain of Kettenfett RC \\(${CID}\\) used Remove a rider for Zwift ID 1002\\.`));
    assert.ok(m.text.split('\n').includes(line), 'the line as it is in the file, on a line of its own');
    assert.match(m.text, /paste this line, with those of every removal since the backup was made, into \/admin under Removals to re-apply/);
    assert.ok(m.html.includes(line.replace(/"/g, '&quot;')));
    // every Remove a rider is an entry and a mail of its own
    const second = new Date(MANAGE_NOW + 60000).toISOString();
    clock.now = MANAGE_NOW + 60000;
    assert.equal((await followPost(srv, cookie, '/manage/rider/remove', {zwiftId: '1003', confirm: '1'})).flash.kind, 'ok');
    assert.deepEqual(fs.readFileSync(path.join(srv.dataDir, ERASURES_FILE), 'utf8').split('\n').filter(Boolean),
        [line, `{"cid":"${CID}","aid":"1003","at":"${second}"}`]);
    assert.equal(mailer.sent.length, 2);
});


test('Remove a rider: no operator mail without an address in PRIVACY_CONTACT or without mail; a refused mail changes nothing', async t => {
    for (const env of [{...MAIL_ENV}, {...MAIL_ENV, PRIVACY_CONTACT: 'the operator of this server'}]) {
        const {srv, cookie, mailer} = await clubServer(t, {env});
        assert.equal((await followPost(srv, cookie, '/manage/rider/remove', {zwiftId: '1002', confirm: '1'})).flash.kind, 'ok');
        assert.deepEqual(mailer.sent, [], JSON.stringify(env));
        assert.ok(fs.readFileSync(path.join(srv.dataDir, ERASURES_FILE), 'utf8').includes('"aid":"1002"'));
    }
    // mail off altogether (no mailer): the removal as always
    const off = await startServer({clock: {now: MANAGE_NOW}, env: {PRIVACY_CONTACT: 'privacy@example.org'}});
    t.after(() => off.stop());
    const c = makeClub();
    upload(c.club, 'rollers', {riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    off.store.create(c.club);
    assert.equal(off.server.mailer, null);
    assert.deepEqual((await followPost(off, c.cookie, '/manage/rider/remove', {zwiftId: '1002', confirm: '1'})).flash, {kind: 'ok', text: 'Removed from 1 plan.'});
    // the queue refuses (over its budget): logged without the ID, the removal stands
    const {srv, cookie} = await clubServer(t, {env: {...MAIL_ENV, PRIVACY_CONTACT: 'privacy@example.org'}, mailer: fakeMailer({refuse: true})});
    let res;
    const warned = await capture('warn', async () => {
        res = await followPost(srv, cookie, '/manage/rider/remove', {zwiftId: '1002', confirm: '1'});
    });
    assert.deepEqual(res.flash, {kind: 'ok', text: 'Removed from 1 plan.'});
    assert.deepEqual(warned, [`paceline-server: club ${CID}: the operator mail of a removal was not sent`]);
    assert.ok(!Object.values(srv.store.get(CID).sheets).some(x => Object.hasOwn(x.json.riders, '1002')));
});


// ---- /admin: Removals to re-apply ----

const ADMIN = {ADMIN_USER: 'operator', ADMIN_PASS: 'made-up-admin-pass'};
const AUTH = 'Basic ' + Buffer.from(`${ADMIN.ADMIN_USER}:${ADMIN.ADMIN_PASS}`).toString('base64');
const adminPost = (srv, lines) => fetch(`${srv.base}/admin/erasures`, {
    method: 'POST', redirect: 'manual',
    headers: {authorization: AUTH, 'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({lines}).toString(),
});
const flashText = body => /<p class="(\w+)">([^<]*)<\/p>/.exec(body).slice(1, 3).map(x => x.replace(/&#39;/g, '\''));


test('/admin Removals to re-apply: new lines go onto the list and are applied to data stored before them; known, unreadable and unknown clubs counted', async t => {
    const {srv} = await clubServer(t, {env: ADMIN});
    // Ben (1001) was removed on 18 Nov (a line from an operator mail after a full restore); the
    // live version was uploaded on 19 Nov and lists him again: it stays
    const store = srv.store;
    const live = Object.values(store.get(CID).sheets)[0];
    assert.equal(live.at, '2026-11-19T14:00:00.000Z');
    store.change(CID, cl => {
        cl.sheets.zz0001 = {...live, plan: 'zz0001', at: '2026-11-17T10:00:00.000Z', type: 'old'};
    });
    const before = {cid: CID, aid: '1001', at: '2026-11-18T10:00:00.000Z'};
    const known = {cid: CID, aid: '1003', at: '2026-11-18T11:00:00.000Z'};
    srv.server.erasures.list.append(known);
    const elsewhere = {cid: 'm4x2k7f3q9', aid: '1009', at: '2026-11-18T12:00:00.000Z'};
    const page = await (await fetch(`${srv.base}/admin`, {headers: {authorization: AUTH}})).text();
    assert.match(page, /<h2>Removals to re-apply<\/h2>/);
    assert.match(page, /<form method="post" action="\/admin\/erasures"><label>Lines from the operator mails<br><textarea name="lines"/);
    const res = await adminPost(srv, [entryLine(before), '', entryLine(known), 'garbage', `  ${entryLine(elsewhere)}  `, entryLine(before)].join('\r\n'));
    assert.equal(res.status, 200);
    const [cls, text] = flashText(await res.text());
    assert.equal(cls, 'warn');
    assert.equal(text, 'Removals: 2 new and applied, 2 already known, 1 not readable. 1 of the new ones are for clubs this server does not have: kept, for a later restore of those clubs.');
    assert.deepEqual(srv.server.erasures.list.entries(), [known, before, elsewhere]);
    assert.ok(fs.readFileSync(path.join(srv.dataDir, ERASURES_FILE), 'utf8').endsWith(entryLine(elsewhere) + '\n'));
    const sheets = store.get(CID).sheets;
    assert.ok(!Object.hasOwn(sheets.zz0001.json.riders, '1001'), 'the version from before the line');
    assert.ok(Object.hasOwn(Object.values(sheets).find(x => x.at === live.at).json.riders, '1001'), 'the version after it keeps him');
    // all of them applied, the unknown club's too (nothing of it here)
    assert.deepEqual(srv.server.erasures.pending(), [known]);
    // nothing readable: 400, nothing changes
    const bad = await adminPost(srv, 'x\ny');
    assert.equal(bad.status, 400);
    assert.deepEqual(flashText(await bad.text()), ['warn', 'Removals: 0 new and applied, 0 already known, 2 not readable.']);
    // a cross-site POST is refused like the other admin actions
    const cross = await fetch(`${srv.base}/admin/erasures`, {method: 'POST', redirect: 'manual',
        headers: {authorization: AUTH, 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'cross-site'},
        body: new URLSearchParams({lines: entryLine({cid: CID, aid: '1004', at: '2026-11-18T10:00:00.000Z'})}).toString()});
    assert.equal(cross.status, 403);
    assert.equal(srv.server.erasures.list.entries().length, 3);
    // without the login: 401, nothing read
    assert.equal((await fetch(`${srv.base}/admin/erasures`, {method: 'POST'})).status, 401);
});


// ---- fix round (review of 19 Nov 2026) ----

// I1: a restore of logs/ alone (paceline.db and erasures.jsonl current) brings back what Remove a
// rider took out: the reconcile holds those files back and checks them against the list.
test('a restore of logs/ alone: the reconcile checks the files it finds against the list before they count', async t => {
    const dataDir = tmpDir(t);
    {
        const db = openDb(dataDir);
        const logs = makeLogStore(dataDir, {db, now: () => T('2026-11-10T16:00:00Z')});
        const store = openStore({db, now: () => T('2026-11-10T16:00:00Z'), archive: logs});
        store.create(club({teams: {rollers: {name: 'Rollers', start: '19:30', live: 'ra0001', version: 1, undo: null, changedAt: null}},
            sheets: {ra0001: sheet({team: 'rollers', label: 'Rollers', date: '2026-11-19', riders: ['1001', '1002'], uploadedAt: '2026-11-10T16:00:00.000Z'})}}));
        logs.put(KF, 'rollers', `${T('2026-11-12T18:30:00Z')}-1001.jsonl.gz`, recording('1001', ['1001', '1002']));
        logs.put(KF, 'rollers', `${T('2026-11-12T18:30:00Z')}-1002.jsonl.gz`, recording('1002', ['1001', '1002']));
        db.close();
    }
    const dir = path.join(dataDir, 'logs', KF, 'rollers');
    const backup = tmpDir(t);
    fs.cpSync(dir, backup, {recursive: true});    // the backup of logs/ from before the removal
    fs.writeFileSync(path.join(dataDir, ERASURES_FILE), entryLine({cid: KF, aid: '1002', at: AT}) + '\n');
    const a = await boot(t, dataDir);
    assert.deepEqual(a.server.erasures.pending(), []);
    await a.stop();
    // the operator restores logs/ only
    fs.cpSync(backup, dir, {recursive: true});
    const b = await boot(t, dataDir);
    const ben = path.join(dir, `${T('2026-11-12T18:30:00Z')}-1001.jsonl.gz`);
    assert.deepEqual(fs.readdirSync(dir), [path.basename(ben)], 'her own recording went again');
    assert.ok(!unz(ben).includes('1002'), 'and her rows from Ben\'s');
    assert.deepEqual(b.server.logs.list(KF).map(r => [r.file, r.size]), [[path.basename(ben), fs.statSync(ben).size]], 'its size follows the file (M3)');
    // held, not corrected first: the row follows once the file is checked
    assert.ok(b.logged.some(l => /reconcile: 0 index rows corrected from their files \(size or time\), 2 recordings to check against the erasure list first/.test(l)), b.logged.join('\n'));
    await b.stop();
});


test('reconcile: a file the list concerns is not indexed until it is checked; a row of another size gets the file\'s size', async t => {
    const dir = tmpDir(t);
    const db = openDb(dir);
    t.after(() => db.close());
    const list = openErasures(null);
    list.append({cid: KF, aid: '1002', at: AT});
    const logs = makeLogStore(dir, {db, now: () => NOW, erasures: list});
    const team = path.join(dir, 'logs', KF, 'rollers');
    fs.mkdirSync(team, {recursive: true});
    const before = `${T('2026-11-12T18:30:00Z')}-1001.jsonl.gz`, after = `${T('2026-11-16T18:30:00Z')}-1001.jsonl.gz`;
    fs.writeFileSync(path.join(team, before), recording('1001', ['1001', '1002']));
    fs.writeFileSync(path.join(team, after), recording('1001', ['1001', '1002']));
    await capture('log', () => logs.reconcile());
    // a ride after the removal is indexed at once; the one before waits for its check
    assert.deepEqual(logs.list(KF).map(r => r.file), [after]);
    const r = await logs.checkHeld();
    assert.deepEqual(r, {deleted: 0, changed: 1, failed: 0, unreadable: 0});
    assert.deepEqual(logs.list(KF).map(r => r.file).sort(), [before, after].sort());
    assert.ok(!unz(path.join(team, before)).includes('1002'));
    assert.ok(unz(path.join(team, after)).includes('1002'), 'he rode again after it');
    // M3: an index row whose size is off (an update refused after the rename) is corrected
    db.sql.prepare('UPDATE recordings SET bytes = 1 WHERE name = ?').run(after);
    await capture('log', () => logs.reconcile());
    assert.equal(logs.list(KF).find(x => x.file === after).size, fs.statSync(path.join(team, after)).size);
});


// I2: the removed rider's own upload, in flight while Remove a rider runs, is refused (p6)
test('the removed rider\'s own upload: refused while its body comes in during the removal, and refused at once afterwards', async t => {
    const {srv, cookie} = await clubServer(t);
    const session = String(T('2026-11-19T17:00:00Z'));
    const body = gzipSync([{kind: 'paceline-recording', v: 1, selfId: '1002', selfName: 'Cleo', plan: {riders: [{id: '1001', name: 'Ben'}, {id: '1002', name: 'Cleo'}], bench: []}},
        {ts: 1, selfId: '1002', riders: [{id: '1002', self: true, power: 210}, {id: '1001', power: 300}]}].map(x => JSON.stringify(x)).join('\n') + '\n');
    const url = new URL(`${srv.base}/api/log/rollers?circle=${CID}&session=${session}&athlete=1002&mod=0.3.0`);
    let finish;
    const answer = new Promise(resolve => {
        const req = http.request(url, {method: 'POST', headers: {'content-length': body.length}}, res => {
            let text = '';
            res.on('data', c => {
                text += c;
            });
            res.on('end', () => resolve([res.statusCode, text]));
        });
        req.write(body.subarray(0, 10));
        finish = () => req.end(body.subarray(10));
    });
    for (let i = 0; srv.server.logUploads.inFlight < 1; i++) {
        assert.ok(i < 400, 'the upload never got in flight');
        await new Promise(r => setTimeout(r, 5));
    }
    assert.equal((await followPost(srv, cookie, '/manage/rider/remove', {zwiftId: '1002', confirm: '1'})).flash.kind, 'ok');
    finish();
    assert.deepEqual(await answer, [403, '{"error":"not in this team"}']);
    const team = path.join(srv.dataDir, 'logs', CID, 'rollers');
    assert.deepEqual(fs.existsSync(team) ? fs.readdirSync(team) : [], []);
    assert.deepEqual(srv.server.logs.list(CID), []);
    const inc = path.join(srv.dataDir, 'logs', '.incoming');
    assert.deepEqual(fs.existsSync(inc) ? fs.readdirSync(inc) : [], [], 'no temp file left');
    // a later try of the same ride: refused before its body is read
    const again = await fetch(url, {method: 'POST', body});
    assert.equal(again.status, 403);
    assert.equal(srv.server.logUploads.inFlight, 0);
});


// I3: the daily limit, the repeated removal, one pass per club
test('Remove a rider: 20 a day per club, then 429; a repeat with nothing stored since writes no line, sends no mail, runs no pass', async t => {
    const mailer = fakeMailer();
    const {srv, cookie, clock} = await clubServer(t, {env: {...MAIL_ENV, OPERATOR_EMAIL: 'operator@example.org'}, mailer});
    const file = () => fs.readFileSync(path.join(srv.dataDir, ERASURES_FILE), 'utf8').split('\n').filter(Boolean);
    assert.equal((await followPost(srv, cookie, '/manage/rider/remove', {zwiftId: '1002', confirm: '1'})).flash.kind, 'ok');
    const passes = [];
    const eraseRider = srv.server.logs.eraseRider;
    srv.server.logs.eraseRider = (...x) => {
        passes.push(x);
        return eraseRider(...x);
    };
    t.after(() => {
        srv.server.logs.eraseRider = eraseRider;
    });
    const repeat = await followPost(srv, cookie, '/manage/rider/remove', {zwiftId: '1002', confirm: '1'});
    assert.deepEqual(repeat.flash, {kind: 'ok', text: 'This rider was removed already, and nothing of theirs was stored since.'});
    assert.deepEqual([file().length, mailer.sent.length, passes.length], [1, 1, 0]);
    // the limit: 19 more removals of other IDs pass, the 21st is refused and changes nothing
    for (let i = 0; i < 19; i++) {
        assert.equal((await followPost(srv, cookie, '/manage/rider/remove', {zwiftId: String(5000 + i), confirm: '1'})).flash.kind, 'ok', String(i));
    }
    const refused = await post(srv, cookie, '/manage/rider/remove', {zwiftId: '1003', confirm: '1'});
    assert.equal(refused.status, 429);
    assert.deepEqual(flashOf(refused.body), {kind: 'err', text: 'Too many riders removed today. Try again tomorrow.'});
    assert.equal(file().length, 20);
    assert.ok(Object.values(srv.store.get(CID).sheets).some(x => Object.hasOwn(x.json.riders, '1003')));
    // and the next day again
    clock.now += DAY;
    assert.equal((await followPost(srv, cookie, '/manage/rider/remove', {zwiftId: '1003', confirm: '1'})).flash.kind, 'ok');
});


test('a restore: several pending removals of one club run as one pass over its recordings', async t => {
    const dataDir = tmpDir(t);
    seedOld(dataDir);
    // a recording that holds both riders removed
    const both = `${T('2026-11-13T18:30:00Z')}-1001.jsonl.gz`;
    {
        const db = openDb(dataDir);
        makeLogStore(dataDir, {db, now: () => T('2026-11-13T20:00:00Z')}).put(KF, 'rollers', both, recording('1001', ['1001', '1002', '1003']));
        db.close();
    }
    fs.writeFileSync(path.join(dataDir, ERASURES_FILE), [entryLine({cid: KF, aid: '1002', at: AT}), entryLine({cid: KF, aid: '1003', at: '2026-11-19T19:00:00.000Z'})].join('\n') + '\n');
    const target = path.join(dataDir, 'logs', KF, 'rollers', `${T('2026-11-18T18:30:00Z')}-1003.jsonl.gz`);
    const renameSync = fs.renameSync;
    let renames = 0;
    fs.renameSync = (from, to) => {
        renames += String(to) === path.join(dataDir, 'logs', KF, 'rollers', both) ? 1 : 0;
        return renameSync(from, to);
    };
    let a;
    try {
        a = await boot(t, dataDir);
    } finally {
        fs.renameSync = renameSync;
    }
    assert.equal(renames, 1, 'Ben\'s recording written once for both');
    assert.ok(!unz(path.join(dataDir, 'logs', KF, 'rollers', both)).match(/100[23]/));
    assert.ok(!fs.existsSync(target), 'Dan\'s own recording (before his removal) went');
    assert.deepEqual(a.server.erasures.pending(), []);
    await a.stop();
});


// M1 and N3: exact values only, in ID fields and as list elements; never inside text (p9)
test('withoutRiders: his ID as a list element goes; text that only contains it stays, also for a short ID', async () => {
    const {withoutRiders} = await import('../logs.mjs');
    const gone = new Set(['7350981']);
    assert.deepEqual(withoutRiders({present: ['1001', '7350981', 7350981], note: 'wheel 7350981', n: 7350981, planSig: '7350981', puller: 7350981}, gone),
        {present: ['1001'], note: 'wheel 7350981', n: 7350981, planSig: '7350981', puller: null});
    const head = {kind: 'paceline-recording', v: 1, version: '0.3.1', team: 'Rollers 2', selfId: '1001', selfName: 'Ben',
        plan: {team: 'Rollers 2', riders: [{id: '1001', name: 'Ben'}, {id: '1003', name: 'Dan 2'}, {id: '2', name: 'Two'}], bench: []}};
    const tick = {ts: 1, riders: [{id: '1001', self: true}, {id: 2}], event: {name: 'WTRL TTT Zone 2 - Race 2', sgName: 'Zone 2', label: 'B', tags: ['ttt', 'zone2']}};
    const two = new Set(['2']);
    assert.deepEqual(withoutRiders(head, two), {...head, plan: {...head.plan, riders: head.plan.riders.slice(0, 2)}});
    assert.deepEqual(withoutRiders(tick, two), {...tick, riders: [{id: '1001', self: true}]});
});


// M2: an upload's discard while a pass writes its temp file (p5b)
test('a pass writing in logs/.incoming keeps the folder while an upload discards its own temp file', async t => {
    const dir = tmpDir(t);
    const db = openDb(dir);
    t.after(() => db.close());
    const logs = makeLogStore(dir, {db, now: () => NOW});
    const name = `${T('2026-11-12T18:30:00Z')}-1001.jsonl.gz`;
    logs.put(KF, 'rollers', name, recording('1001', ['1001', '1002']));
    const pass = logs.eraseRider(KF, '1002');
    const inc = path.join(dir, 'logs', '.incoming');
    for (let i = 0; i < 50 && !fs.existsSync(inc); i++) {
        await Promise.resolve();
    }
    assert.ok(fs.existsSync(inc));
    logs.discard(null);
    assert.ok(fs.existsSync(inc), 'kept while the pass writes there');
    assert.deepEqual(await pass, {deleted: 0, changed: 1, failed: 0, unreadable: 0});
    logs.discard(null);
    assert.ok(!fs.existsSync(inc), 'removed once it is empty and no pass writes');
});


// M5: a club taken back from the trash gets its waiting removals at once
test('/admin restore: the removals that waited for a club in the trash are applied at once', async t => {
    const {srv} = await clubServer(t, {env: ADMIN});
    srv.store.trash(CID);
    srv.server.erasures.list.append({cid: CID, aid: '1002', at: new Date(MANAGE_NOW - 60000).toISOString()});
    assert.equal(srv.server.erasures.pending().length, 1);
    const res = await fetch(`${srv.base}/admin/restore`, {method: 'POST', redirect: 'manual',
        headers: {authorization: AUTH, 'content-type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({cid: CID}).toString()});
    assert.equal(res.status, 200);
    assert.ok(!Object.values(srv.store.get(CID).sheets).some(x => Object.hasOwn(x.json.riders, '1002')), 'out of the plans before the answer');
    for (let i = 0; srv.server.erasures.pending().length && i < 200; i++) {
        await new Promise(r => setTimeout(r, 5));
    }
    assert.deepEqual(srv.server.erasures.pending(), []);
});


// M6: the operator's notices have a small cap of their own
test('mailer: the operator notices have their own cap of 50 a day and no per-address limit; the club mails keep theirs', async () => {
    const {makeMailer, OPERATOR_PER_DAY} = await import('../mailer.mjs');
    const {readConfig} = await import('../config.mjs');
    assert.equal(OPERATOR_PER_DAY, 50);
    const cfg = readConfig({DATA_DIR: '/tmp/x', ...MAIL_ENV, MAIL_MAX_PER_DAY: '5'});
    const mailer = makeMailer({cfg, now: () => NOW, transport: () => Promise.resolve({code: 250}), schedule: () => 0});
    const m = budget => ({kind: budget === 'operator' ? 'rider-removed' : 'new-link', to: 'operator@example.org', subject: 's', text: 't', budget});
    let sent = 0;
    while (mailer.send(m('operator'))) {
        sent++;
    }
    assert.equal(sent, 50);
    // the club mails' own budget and per-address limit are untouched (3 an hour to one address)
    assert.deepEqual([1, 2, 3, 4].map(() => mailer.send(m('other'))), [true, true, true, false]);
    mailer.close();
});


// OPERATOR_EMAIL and M7: the address, the config check, the privacy page without one
test('OPERATOR_EMAIL: the operator mail goes there before PRIVACY_CONTACT; without either /privacy promises no re-apply of a full restore', async t => {
    const {readConfig} = await import('../config.mjs');
    const {operatorAddress} = await import('../mail-content.mjs');
    assert.throws(() => readConfig({DATA_DIR: '/tmp/x', OPERATOR_EMAIL: 'not an address'}), /OPERATOR_EMAIL/);
    assert.equal(operatorAddress(readConfig({DATA_DIR: '/tmp/x', OPERATOR_EMAIL: 'op@example.org', PRIVACY_CONTACT: 'P, privacy@example.org'})), 'op@example.org');
    assert.equal(operatorAddress(readConfig({DATA_DIR: '/tmp/x', PRIVACY_CONTACT: 'P, privacy@example.org'})), 'privacy@example.org');
    assert.equal(operatorAddress(readConfig({DATA_DIR: '/tmp/x', PRIVACY_CONTACT: 'the operator'})), null);
    const mailer = fakeMailer();
    const {srv, cookie} = await clubServer(t, {env: {...MAIL_ENV, OPERATOR_EMAIL: 'op@example.org', PRIVACY_CONTACT: 'P, privacy@example.org'}, mailer});
    await followPost(srv, cookie, '/manage/rider/remove', {zwiftId: '1002', confirm: '1'});
    assert.deepEqual(mailer.sent.map(m => m.to), ['op@example.org']);
    const page = async s => (await (await fetch(`${s.base}/privacy`)).text()).replace(/&#39;/g, '\'');
    const withMail = await page(srv);
    assert.match(withMail, /if a backup is ever restored, every removal is applied again/);
    assert.match(withMail, /who can remove a rider from all plans and recordings, or the operator/);
    const {srv: bare} = await clubServer(t, {env: {...MAIL_ENV, PRIVACY_CONTACT: 'the operator'}});
    const without = await page(bare);
    assert.doesNotMatch(without, /if a backup is ever restored/);
    assert.match(without, /If the database or the recordings are restored from a backup, every removal is applied again; after a restore of the whole server, the operator applies them again from their own records\./);
    assert.match(without, /every Remove a rider since is applied again; after a restore of the whole server, the operator applies them again from their own records\./);
});


// the rest of the review
test('Remove a rider: the operator mail goes when the entry is written, also when the club change is then refused', async t => {
    const mailer = fakeMailer();
    const {srv, cookie} = await clubServer(t, {env: {...MAIL_ENV, OPERATOR_EMAIL: 'op@example.org'}, mailer});
    const undo = refuseWrites(srv.server.db, 'clubs', ['UPDATE']);
    const error = console.error;
    console.error = () => {};
    let res;
    try {
        res = await post(srv, cookie, '/manage/rider/remove', {zwiftId: '1002', confirm: '1'});
    } finally {
        console.error = error;
        undo();
    }
    assert.equal(res.status, 500);
    assert.equal(mailer.sent.length, 1, 'the line reached the operator');
    assert.equal(srv.server.erasures.pending().length, 1, 'applied at the next start');
});


test('Remove a rider: an unwritable erasures.jsonl changes nothing and says so; an unreadable one at start is one clear line', async t => {
    const {srv, cookie} = await clubServer(t);
    const list = srv.server.erasures.list;
    const append = list.append;
    list.append = () => {
        throw Object.assign(new Error('denied'), {code: 'EACCES'});
    };
    let res;
    const errors = await capture('error', async () => {
        res = await post(srv, cookie, '/manage/rider/remove', {zwiftId: '1002', confirm: '1'});
    });
    list.append = append;
    assert.equal(res.status, 503);
    assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'The removal could not be recorded; nothing was changed. Tell the operator.'});
    assert.deepEqual(errors, [`paceline-server: club ${CID}: a removal not recorded in erasures.jsonl, nothing changed: EACCES`]);
    assert.ok(Object.values(srv.store.get(CID).sheets).some(x => Object.hasOwn(x.json.riders, '1002')));
    // unreadable at start: the server starts, says what to do, and refuses to append
    const dir = tmpDir(t);
    fs.mkdirSync(path.join(dir, ERASURES_FILE));    // a folder in its place: EISDIR on read
    let opened;
    const said = await capture('error', () => {
        opened = openErasures(dir);
    });
    assert.equal(said.length, 1);
    assert.match(said[0], /erasures\.jsonl cannot be read \(EISDIR\): removals are not applied again, Remove a rider is refused, recording uploads wait \(503\) and new recording files are held, until the file is readable and writable by the server \(uid 1000\); fix its owner or mode and never delete it: the next log sweep \(or a restart\) reads it again/);
    assert.equal(opened.broken(), 'EISDIR');
    assert.throws(() => opened.append({cid: KF, aid: '1002', at: AT}), {code: 'EISDIR'});
    assert.equal(opened.expire(Infinity), 0);
});


test('/admin Removals to re-apply: an `at` to come is not readable; the form says its 64 KB cap', async t => {
    const {srv} = await clubServer(t, {env: ADMIN});
    const res = await adminPost(srv, entryLine({cid: CID, aid: '1002', at: new Date(MANAGE_NOW + DAY).toISOString()}));
    assert.deepEqual(flashText(await res.text()), ['warn', 'Removals: 0 new and applied, 0 already known, 1 not readable.']);
    assert.deepEqual(srv.server.erasures.list.entries(), []);
    const page = await (await fetch(`${srv.base}/admin`, {headers: {authorization: AUTH}})).text();
    assert.match(page, /at most 64 KB \(about 500 lines\) at a time/);
});


test('the flash of Remove a rider: only parts that are not zero; a recording that cannot be read is named as such', async () => {
    const {riderRemovedText} = await import('../manage-club.mjs');
    assert.equal(riderRemovedText(0, 0, {}), 'Nothing to remove: this Zwift ID is in no plan, plan version or recording of the club.');
    assert.equal(riderRemovedText(0, 2, {changed: 1}), 'Removed from 2 archived versions and 1 recording.');
    assert.equal(riderRemovedText(3, 1, {changed: 2, deleted: 1}), 'Removed from 3 plans, 1 archived version and 2 recordings. 1 of their own recordings deleted.');
    assert.equal(riderRemovedText(0, 0, {unreadable: 2}), '2 recordings could not be read, so they were not checked: delete them under Recordings.');
});


// ---- fix round 2 (re-review of bc11765) ----

// N2: a removal while a team folder is away (a mount gone; reconcile keeps its rows) is not done (p8)
test('a pass while a team folder is away fails for its files, and the next one finishes them', async t => {
    const dir = tmpDir(t);
    const db = openDb(dir);
    t.after(() => db.close());
    const list = openErasures(dir);
    const logs = makeLogStore(dir, {db, now: () => NOW, erasures: list});
    const name = `${T('2026-11-18T18:30:00Z')}-1001.jsonl.gz`;
    logs.put(KF, 'rollers', name, recording('1001', ['1001', '1002']));
    const team = path.join(dir, 'logs', KF, 'rollers');
    fs.renameSync(team, team + '.away');
    list.append({cid: KF, aid: '1002', at: new Date(NOW).toISOString()});
    let r;
    const errors = await capture('error', async () => {
        r = await logs.eraseRider(KF, '1002');
    });
    assert.deepEqual(r, {deleted: 0, changed: 0, failed: 1, unreadable: 0});
    assert.deepEqual(errors, [`paceline-server: club ${KF}: team rollers: a recording not rewritten without a removed rider: ENOENT`]);
    assert.deepEqual(logs.list(KF).map(x => x.file), [name], 'its row stays');
    fs.renameSync(team + '.away', team);
    assert.deepEqual(await logs.eraseRider(KF, '1002'), {deleted: 0, changed: 1, failed: 0, unreadable: 0});
    assert.ok(!unz(path.join(team, name)).includes('1002'));
    // a row that went (a Delete meanwhile) is no failure
    logs.put(KF, 'rollers', `${T('2026-11-17T18:30:00Z')}-1001.jsonl.gz`, recording('1001', ['1001', '1002']));
    assert.equal(logs.remove(KF, 'rollers', `${T('2026-11-17T18:30:00Z')}-1001.jsonl.gz`), true);
    assert.equal(await logs.rewrite(KF, 'rollers', `${T('2026-11-17T18:30:00Z')}-1001.jsonl.gz`, new Set(['1002'])), 'gone');
});


// N1: an unreadable list fails closed (p10)
test('an unreadable erasures.jsonl: uploads wait (503), the reconcile holds the files it finds, and once it is readable they are checked', async t => {
    const at = '2026-11-19T19:00:00.000Z';
    let file, s;
    const said = await capture('error', async () => {
        s = await startServer({clock: {now: MANAGE_NOW + DAY}, prepare: dir => {
            file = path.join(dir, ERASURES_FILE);
            // unreadable for root too (CI runs as root, where chmod 000 still reads): a directory
            fs.mkdirSync(file);
        }});
    });
    t.after(() => s.stop());
    assert.equal(said.filter(l => l.includes('erasures.jsonl cannot be read')).length, 1, 'one line at start');
    const c = makeClub();
    upload(c.club, 'rollers', {riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    s.store.create(c.club);
    // Ben's mod still has the plan with Cleo: refused for now (the mod retries a 503 later)
    const session = String(T('2026-11-19T18:00:00Z'));
    const body = recording('1001', ['1001', '1002']);
    const r = await fetch(`${s.base}/api/log/rollers?circle=${CID}&session=${session}&athlete=1001&mod=0.3.0`, {method: 'POST', body});
    assert.deepEqual([r.status, r.headers.get('retry-after'), await r.text()], [503, '300', '{"error":"busy"}']);
    // a file the reconcile finds (a restore of logs/) is held, not indexed
    const team = path.join(s.dataDir, 'logs', CID, 'rollers');
    fs.mkdirSync(team, {recursive: true});
    const found = `${T('2026-11-19T17:00:00Z')}-1001.jsonl.gz`;
    fs.writeFileSync(path.join(team, found), recording('1001', ['1001', '1002']));
    const swept = await capture('error', async () => {
        await capture('log', () => s.server.sweepLogs());
    });
    assert.equal(swept.filter(l => l.includes('erasures.jsonl cannot be read')).length, 1, 'one line every sweep while it lasts');
    assert.deepEqual(s.server.logs.list(CID), []);
    assert.deepEqual(await s.server.logs.checkHeld(), {deleted: 0, changed: 0, failed: 0, unreadable: 0}, 'not checked while unreadable');
    // fixed: the next sweep reads it, checks the held file, and uploads go through again
    fs.rmSync(file, {recursive: true});
    fs.writeFileSync(file, entryLine({cid: CID, aid: '1002', at}) + '\n', {mode: 0o640});
    await capture('log', () => s.server.sweepLogs());
    await s.server.logs.checkHeld();
    assert.deepEqual(s.server.logs.list(CID).map(x => x.file), [found]);
    assert.ok(!unz(path.join(team, found)).includes('1002'));
    const ok = await fetch(`${s.base}/api/log/rollers?circle=${CID}&session=${session}&athlete=1001&mod=0.3.0`, {method: 'POST', body});
    assert.equal(ok.status, 201);
    assert.ok(!unz(path.join(team, `${session}-1001.jsonl.gz`)).includes('1002'));
});


// R1: an older copy with the same size, known by its mtime
test('reconcile: a file whose mtime is not its row\'s is checked like one of another size', async t => {
    const dir = tmpDir(t);
    const db = openDb(dir);
    t.after(() => db.close());
    const list = openErasures(null);
    const logs = makeLogStore(dir, {db, now: () => NOW, erasures: list});
    const name = `${T('2026-11-12T18:30:00Z')}-1001.jsonl.gz`;
    logs.put(KF, 'rollers', name, recording('1001', ['1001', '1002']));
    const file = path.join(dir, 'logs', KF, 'rollers', name);
    list.append({cid: KF, aid: '1002', at: AT});
    // the restored copy: same bytes, the old time
    fs.utimesSync(file, new Date(T('2026-11-12T19:00:00Z')), new Date(T('2026-11-12T19:00:00Z')));
    const logged = await capture('log', () => logs.reconcile());
    assert.deepEqual(logged, ['paceline-server: reconcile: 0 index rows corrected from their files (size or time), 1 recordings to check against the erasure list first']);
    assert.deepEqual(await logs.checkHeld(), {deleted: 0, changed: 1, failed: 0, unreadable: 0});
    assert.ok(!unz(file).includes('1002'));
    const row = rows(db, 'SELECT bytes, mtime FROM recordings WHERE name = ?', name)[0];
    assert.deepEqual(row, {bytes: fs.statSync(file).size, mtime: Math.floor(fs.statSync(file).mtimeMs)}, 'the row follows the rewrite');
    assert.deepEqual(await capture('log', () => logs.reconcile()), [], 'nothing left to check');
});


test('schema 2: a schema-1 paceline.db gets recordings.mtime, its rows kept; the next reconcile fills the times in', async t => {
    const dir = tmpDir(t);
    const {DatabaseSync} = await import('node:sqlite');
    const {MIGRATIONS} = await import('../db.mjs');
    const old = new DatabaseSync(path.join(dir, 'paceline.db'));
    old.exec(MIGRATIONS[0]);
    old.exec('PRAGMA user_version = 1');
    const name = `${T('2026-11-12T18:30:00Z')}-1001.jsonl.gz`;
    old.prepare('INSERT INTO recordings (cid, slug, name, session, athlete, bytes, stored_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(KF, 'rollers', name, T('2026-11-12T18:30:00Z'), '1001', 0, T('2026-11-12T20:00:00Z'));
    old.close();
    fs.mkdirSync(path.join(dir, 'logs', KF, 'rollers'), {recursive: true});
    const file = path.join(dir, 'logs', KF, 'rollers', name);
    fs.writeFileSync(file, recording('1001', ['1001']));
    const lines = [];
    const db = openDb(dir, {log: line => lines.push(line)});
    t.after(() => db.close());
    assert.equal(db.sql.prepare('PRAGMA user_version').get().user_version, 4);
    // the backup before schema 3 (no club to convert, so no count line)
    assert.equal(lines.length, 1, lines.join('\n'));
    assert.match(lines[0], /^paceline-server: paceline\.db: backup before schema 3: dumps\/paceline-pre-races-\d{4}-\d{2}-\d{2}\.db \(\d+ bytes\)$/);
    assert.deepEqual(rows(db, 'SELECT bytes, stored_at, mtime FROM recordings'), [{bytes: 0, stored_at: T('2026-11-12T20:00:00Z'), mtime: null}]);
    const logs = makeLogStore(dir, {db, now: () => NOW, erasures: openErasures(null)});
    await capture('log', () => logs.reconcile());
    assert.deepEqual(rows(db, 'SELECT bytes, stored_at, mtime FROM recordings'),
        [{bytes: fs.statSync(file).size, stored_at: T('2026-11-12T20:00:00Z'), mtime: Math.floor(fs.statSync(file).mtimeMs)}]);
});


// R2: a held file that cannot be read: retention by its session, its line once
test('a held file that cannot be read is logged once and goes with retention by its session age', async t => {
    const dir = tmpDir(t);
    const db = openDb(dir);
    t.after(() => db.close());
    const list = openErasures(null);
    list.append({cid: KF, aid: '1002', at: AT});
    const logs = makeLogStore(dir, {db, now: () => NOW, erasures: list});
    const team = path.join(dir, 'logs', KF, 'rollers');
    fs.mkdirSync(team, {recursive: true});
    const name = `${T('2026-11-12T18:30:00Z')}-1001.jsonl.gz`;
    fs.writeFileSync(path.join(team, name), 'not gzip');
    const errors = await capture('error', async () => {
        for (let i = 0; i < 3; i++) {
            await capture('log', () => logs.reconcile());
            assert.equal((await logs.checkHeld()).unreadable, 1);
        }
    });
    assert.deepEqual(errors, [`paceline-server: club ${KF}: team rollers: a recording that cannot be read was not checked for removed riders; `
        + 'it has no index row, so captains cannot delete it: the retention sweep does, or delete it by hand']);
    assert.deepEqual(logs.list(KF), []);
    // 10 days later with a retention of 7: it goes by its session, like an indexed one
    await capture('log', () => logs.reconcile());
    let deleted;
    await capture('log', () => {
        deleted = logs.sweep(NOW + 10 * DAY, 7);
    });
    assert.equal(deleted, 1);
    assert.ok(!fs.existsSync(path.join(team, name)));
});


// R3: a removal the list refused does not count toward the day's 20
test('Remove a rider: removals refused for an unwritable list do not count toward the daily limit', async t => {
    const {srv, cookie} = await clubServer(t);
    const list = srv.server.erasures.list;
    const append = list.append;
    list.append = () => {
        throw Object.assign(new Error('denied'), {code: 'EACCES'});
    };
    await capture('error', async () => {
        for (let i = 0; i < 25; i++) {
            assert.equal((await post(srv, cookie, '/manage/rider/remove', {zwiftId: '1002', confirm: '1'})).status, 503);
        }
    });
    list.append = append;
    assert.equal((await followPost(srv, cookie, '/manage/rider/remove', {zwiftId: '1002', confirm: '1'})).flash.kind, 'ok');
});
