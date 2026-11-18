// Run with: node --test tests/logupload.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as U from '../pages/src/engine/logupload.mjs';
import {toJsonl} from '../pages/src/engine/recording.mjs';

const MIN = 60000;
const DAY = 864e5;


test('constants', () => {
    assert.equal(U.UPLOAD_MIN_TICKS, 60);
    assert.equal(U.UPLOAD_RETRY_MS, 300000);
    assert.equal(U.UPLOAD_MAX_AGE_MS, 7 * DAY);
    assert.equal(U.SWEEP_MS, 60000);
    assert.equal(U.NOTFOUND_RETRY_MS, 3600000);
});

test('logSlug: typed team > server team name > plan team > null; blanks count as empty', () => {
    const plan = {team: 'Plan Team'};
    assert.equal(U.logSlug({serverTeam: 'Zone 23', serverTeamName: 'Server Name'}, plan), 'zone-23');
    assert.equal(U.logSlug({serverTeam: '', serverTeamName: 'Server Name'}, plan), 'server-name');
    assert.equal(U.logSlug({serverTeam: '  ', serverTeamName: null}, plan), 'plan-team');
    assert.equal(U.logSlug({serverTeam: '', serverTeamName: '  '}, plan), 'plan-team');
    assert.equal(U.logSlug({serverTeam: '', serverTeamName: null}, null), null);
    assert.equal(U.logSlug({serverTeam: '  ', serverTeamName: '  '}, {team: '  '}), null);
    assert.equal(U.logSlug({serverTeam: '!!!', serverTeamName: null}, {team: 'Rollers'}), 'rollers');
});

test('logUploadUrl: exact URL, null for a bad server, slug or id', () => {
    const ok = {url: 'https://ttt.mafl.net/', slug: 'zone-23', sessionId: '1731400000000', athleteId: 123};
    assert.equal(U.logUploadUrl(ok), 'https://ttt.mafl.net/api/log/zone-23?session=1731400000000&athlete=123');
    assert.equal(U.logUploadUrl({...ok, url: 'http://localhost:8790', athleteId: '5100002'}),
                 'http://localhost:8790/api/log/zone-23?session=1731400000000&athlete=5100002');
    assert.equal(U.logUploadUrl({...ok, url: 'ttt.mafl.net'}), null);
    assert.equal(U.logUploadUrl({...ok, url: 'javascript:alert(1)'}), null);
    assert.equal(U.logUploadUrl({...ok, url: ''}), null);
    assert.equal(U.logUploadUrl({...ok, slug: ''}), null);
    assert.equal(U.logUploadUrl({...ok, slug: null}), null);
    assert.equal(U.logUploadUrl({...ok, slug: 'Zone 23'}), null);    // must already be a slug
    assert.equal(U.logUploadUrl({...ok, sessionId: 'abc'}), null);
    assert.equal(U.logUploadUrl({...ok, sessionId: '12345678901234567'}), null);    // 17 digits
    assert.equal(U.logUploadUrl({...ok, sessionId: ''}), null);
    assert.equal(U.logUploadUrl({...ok, athleteId: 'x12'}), null);
    assert.equal(U.logUploadUrl({...ok, athleteId: '1234567890123'}), null);    // 13 digits
    assert.equal(U.logUploadUrl({...ok, athleteId: null}), null);
    assert.equal(U.logUploadUrl({...ok, athleteId: undefined}), null);
});

test('pendingUploads: finished, long enough, not uploaded, not tried lately, not too old; oldest first', () => {
    const now = 1731400000000 + 10 * DAY;
    const row = (startOffset, ticks, meta = {}) => {
        const start = now - startOffset;
        return {sessionId: String(start), meta: {startedAt: start, ...meta}, ticks};
    };
    const current = row(10 * MIN, 600);
    const short = row(3 * 3600e3, 59);
    const enough = row(4 * 3600e3, 60);
    const uploaded = row(5 * 3600e3, 600, {uploadedAt: now - 3600e3});
    const tried4 = row(6 * 3600e3, 600, {uploadTriedAt: now - 4 * MIN, uploadError: 'offline'});
    const tried5 = row(7 * 3600e3, 600, {uploadTriedAt: now - 5 * MIN, uploadError: 'offline'});
    const old = row(8 * DAY, 600);
    const noStartedAt = {sessionId: String(now - 2 * DAY), meta: {}, ticks: 600};
    // listSessions gives newest first
    const sessions = [current, short, enough, uploaded, tried4, tried5, noStartedAt, old];
    const since = now - 30 * DAY;    // box ticked long before all of them
    const got = U.pendingUploads(sessions, {now, currentSessionId: current.sessionId, since});
    assert.deepEqual(got, [noStartedAt.sessionId, tried5.sessionId, enough.sessionId]);
    // not recording: the latest one is due too (and is the newest, so last)
    assert.deepEqual(U.pendingUploads(sessions, {now, currentSessionId: null, since}),
                     [noStartedAt.sessionId, tried5.sessionId, enough.sessionId, current.sessionId]);
    assert.deepEqual(U.pendingUploads([], {now, currentSessionId: null, since}), []);
});

test('pendingUploads: only rides started at or after the box was ticked; none without a tick time', () => {
    const now = 1731400000000 + 10 * DAY;
    const row = startOffset => ({sessionId: String(now - startOffset), meta: {startedAt: now - startOffset}, ticks: 600});
    const before = row(3 * 3600e3);
    const atTick = row(2 * 3600e3);
    const after = row(1 * 3600e3);
    const sessions = [after, atTick, before];
    const since = now - 2 * 3600e3;
    assert.deepEqual(U.pendingUploads(sessions, {now, currentSessionId: null, since}), [atTick.sessionId, after.sessionId]);
    assert.deepEqual(U.pendingUploads(sessions, {now, currentSessionId: null, since: null}), []);
    assert.deepEqual(U.pendingUploads(sessions, {now, currentSessionId: null}), []);
    assert.deepEqual(U.pendingUploads(sessions, {now, currentSessionId: null, since: 'x'}), []);
});

test('pendingUploads: retry delay by the last error kind', () => {
    const now = 1731400000000 + 10 * DAY;
    const since = now - 30 * DAY;
    const row = (i, uploadError, triedAgo) => ({sessionId: String(now - DAY + i), ticks: 600,
        meta: {startedAt: now - DAY + i, uploadError, uploadTriedAt: now - triedAgo}});
    const notfound59 = row(1, 'notfound', 59 * MIN);
    const notfound60 = row(2, 'notfound', 60 * MIN);
    const offline5 = row(3, 'offline', 5 * MIN);
    const full5 = row(4, 'full', 5 * MIN);
    const http4 = row(5, 'http', 4 * MIN);
    const local5 = row(6, 'local', 5 * MIN);
    const toolarge = row(7, 'toolarge', 6 * DAY);
    const got = U.pendingUploads([notfound59, notfound60, offline5, full5, http4, local5, toolarge],
                                 {now, currentSessionId: null, since});
    assert.deepEqual(got, [notfound60.sessionId, offline5.sessionId, full5.sessionId, local5.sessionId]);
});

test('retryAfterMs: 1 h for no plan, never for too large, 5 min otherwise', () => {
    assert.equal(U.retryAfterMs('notfound'), 3600000);
    assert.equal(U.retryAfterMs('toolarge'), Infinity);
    for (const k of ['offline', 'full', 'http', 'local', null, undefined, 'junk']) {
        assert.equal(U.retryAfterMs(k), U.UPLOAD_RETRY_MS, String(k));
    }
});

test('autoUploadState: uploaded, waiting, or manual (Upload button only)', () => {
    const now = 1731400000000 + 10 * DAY;
    const since = now - 2 * DAY;
    const row = (startOffset, ticks, meta = {}) =>
        ({sessionId: String(now - startOffset), meta: {startedAt: now - startOffset, ...meta}, ticks});
    const st = (s, opts = {now, since}) => U.autoUploadState(s, opts);
    assert.equal(st(row(DAY, 600)), 'waiting');
    assert.equal(st(row(DAY, 60)), 'waiting');
    assert.equal(st(row(DAY, 600, {uploadError: 'offline', uploadTriedAt: now - MIN})), 'waiting');    // retried later
    assert.equal(st(row(DAY, 600, {uploadError: 'notfound', uploadTriedAt: now - MIN})), 'waiting');
    assert.equal(st(row(DAY, 600, {uploadedAt: now - 3600e3})), 'uploaded');
    assert.equal(st(row(10 * DAY, 10, {uploadedAt: now - 3600e3}), {now, since: null}), 'uploaded');    // uploaded by hand
    assert.equal(st(row(DAY, 59)), 'manual');                                  // too short
    assert.equal(st(row(DAY, 600), {now, since: now - 30 * DAY}), 'waiting');
    assert.equal(st(row(7 * DAY - 1, 600), {now, since: now - 30 * DAY}), 'waiting');
    assert.equal(st(row(7 * DAY, 600), {now, since: now - 30 * DAY}), 'manual');    // too old
    assert.equal(st(row(3 * DAY, 600)), 'manual');                             // before the box was ticked
    assert.equal(st(row(2 * DAY, 600)), 'waiting');                            // started right at the tick
    assert.equal(st(row(DAY, 600), {now, since: null}), 'manual');             // box not ticked
    assert.equal(st(row(DAY, 600), {now}), 'manual');
    assert.equal(st(row(DAY, 600, {uploadError: 'toolarge', uploadTriedAt: now - MIN})), 'manual');
    assert.equal(st({sessionId: 'abc', meta: {}, ticks: 600}), 'manual');     // no start time
    assert.equal(st({sessionId: String(now - DAY), ticks: 600}), 'waiting');   // start from the id, no meta
    assert.equal(st(row(DAY, 600), {now, since, serverOn: false}), 'manual');  // plan server switched off
    assert.equal(st(row(DAY, 600), {now, since, serverOn: true}), 'waiting');
    assert.equal(st(row(DAY, 600, {uploadedAt: now - MIN}), {now, since, serverOn: false}), 'uploaded');
});

test('uploadError: status to error kind', () => {
    assert.equal(U.uploadError(404), 'notfound');
    assert.equal(U.uploadError(413), 'toolarge');
    assert.equal(U.uploadError(507), 'full');
    assert.equal(U.uploadError(400), 'http');
    assert.equal(U.uploadError(500), 'http');
    assert.equal(U.uploadError(302), 'http');
    assert.equal(U.uploadError(null), 'offline');
    assert.equal(U.uploadError(201), null);
    // only 201 means the server stored the file
    assert.equal(U.uploadError(200), 'http');
    assert.equal(U.uploadError(204), 'http');
    assert.equal(U.uploadError(299), 'http');
    assert.equal(U.uploadError(undefined), 'offline');
});

test('stripForUpload: no heart rate or cadence, no plan weight/FTP, only me and plan riders', () => {
    const head = {sessionId: '1731400000000', team: 'Zone 23', selfId: '1', planSig: 'ABC',
        plan: {sig: 'ABC', riders: [{id: '1', name: 'Me', pullS: 60, watts: 254, weight: 72, ftp: 280, adjustment: 100},
                                    {id: '2', name: 'Two', pullS: 45, watts: 300, weight: 80, ftp: 330}],
               bench: [{id: '5', name: 'Bench'}]}};
    const tick = {ts: 1, wt: 2, selfId: '1', watchingId: '9', riders: [
        {id: '1', self: true, watching: false, power: 250, heartrate: 150, cadence: 90, draft: 10},
        {id: '2', self: false, watching: false, power: 240, heartrate: 140, cadence: 88, gapDistance: -3},
        {id: '5', self: false, watching: false, power: 200, heartrate: 120},
        {id: '9', self: false, watching: true, power: 180, heartrate: 130},
    ], det: {puller: '2'}};
    const out = U.stripForUpload(toJsonl(head, [tick]));
    const lines = out.split('\n');
    const h = JSON.parse(lines[0]);
    assert.deepEqual(h.plan.riders, [{id: '1', name: 'Me', pullS: 60, watts: 254}, {id: '2', name: 'Two', pullS: 45, watts: 300}]);
    assert.deepEqual(h.plan.bench, [{id: '5', name: 'Bench'}]);
    assert.equal(h.planSig, 'ABC');
    const t = JSON.parse(lines[1]);
    assert.deepEqual(t.riders.map(r => r.id), ['1', '2', '5']);    // the watched outsider is gone
    for (const r of t.riders) {
        assert.equal(Object.hasOwn(r, 'heartrate'), false, r.id);
        assert.equal(Object.hasOwn(r, 'cadence'), false, r.id);
    }
    assert.equal(t.riders[0].draft, 10);
    assert.equal(t.riders[1].gapDistance, -3);
    assert.equal(t.watchingId, null);
    assert.deepEqual(t.det, {puller: '2'});
    assert.ok(out.endsWith('\n'));
    assert.equal(lines.length, 3);
});

test('stripForUpload: without a plan only my own row stays', () => {
    const out = U.stripForUpload(toJsonl({sessionId: '1', plan: null}, [{ts: 1, watchingId: '1', riders: [
        {id: '1', self: true, watching: true, power: 1, heartrate: 99}, {id: '2', power: 2}, {id: '3', self: 'true', power: 3}]}]));
    const t = JSON.parse(out.split('\n')[1]);
    assert.deepEqual(t.riders, [{id: '1', self: true, watching: true, power: 1}]);
    assert.equal(t.watchingId, '1');
});

test('stripForUpload: unparseable and odd lines pass through untouched', () => {
    const text = '{"kind":"paceline-recording","v":1}\n{broken\n[1,2]\n{"ts":1}\n{"ts":2,"riders":null}\n';
    assert.equal(U.stripForUpload(text), text);
    assert.equal(U.stripForUpload(''), '');
});


test('sessionSlug: a recording goes to the team it was recorded with, older ones to the current team', () => {
    const prefs = {serverTeam: '', serverTeamName: 'Team B'};
    assert.equal(U.sessionSlug({slug: 'team-a'}, prefs, null), 'team-a');
    assert.equal(U.sessionSlug({}, prefs, null), 'team-b');            // recorded before 0.2.12
    assert.equal(U.sessionSlug(null, {}, {team: 'Rollers'}), 'rollers');
    assert.equal(U.sessionSlug({slug: '../x'}, prefs, null), 'x');     // never a path, only a slug
    assert.equal(U.sessionSlug({}, {}, null), null);
});
