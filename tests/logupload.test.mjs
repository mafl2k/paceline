// Run with: node --test tests/logupload.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as U from '../pages/src/engine/logupload.mjs';
import {toJsonl} from '../pages/src/engine/recording.mjs';

const MIN = 60000;
const DAY = 864e5;
const KF = 'k7f3q9x2m4';    // Kettenfett RC
const SM = 'p2m8c4t1v9';    // Spokesmen CC


test('constants', () => {
    assert.equal(U.UPLOAD_MIN_TICKS, 60);
    assert.equal(U.UPLOAD_RETRY_MS, 300000);
    assert.equal(U.UPLOAD_MAX_AGE_MS, 7 * DAY);
    assert.equal(U.SWEEP_MS, 60000);
});

test('logUploadUrl with circle and mod', () => {
    const ok = {url: 'https://ttt-beta.example.org', slug: 'rollers', circle: KF, sessionId: '1763576400000',
                athleteId: 1001, mod: '0.3.0-beta.2'};
    assert.equal(U.logUploadUrl(ok),
                 'https://ttt-beta.example.org/api/log/rollers?circle=k7f3q9x2m4&session=1763576400000&athlete=1001&mod=0.3.0-beta.2');
    assert.equal(U.logUploadUrl({...ok, url: 'http://localhost:8790/', athleteId: '1002', mod: '0.3.0'}),
                 'http://localhost:8790/api/log/rollers?circle=k7f3q9x2m4&session=1763576400000&athlete=1002&mod=0.3.0');
    // circle: the server's CID_RE (lower case Crockford, 10 characters)
    assert.equal(U.logUploadUrl({...ok, circle: 'K7F3Q9X2M4'}), null);
    assert.equal(U.logUploadUrl({...ok, circle: 'k7f3q9x2m'}), null);
    assert.equal(U.logUploadUrl({...ok, circle: 'k7f3q9x2mi'}), null);    // no i in Crockford
    assert.equal(U.logUploadUrl({...ok, circle: null}), null);
    assert.equal(U.logUploadUrl({...ok, circle: undefined}), null);
    // mod: the server's MOD_RE
    assert.equal(U.logUploadUrl({...ok, mod: '1'}), null);
    assert.equal(U.logUploadUrl({...ok, mod: '0.3'}), null);
    assert.equal(U.logUploadUrl({...ok, mod: '0.3.0-rc.1'}), null);
    assert.equal(U.logUploadUrl({...ok, mod: null}), null);
    assert.equal(U.logUploadUrl({...ok, mod: undefined}), null);
    // server URL, slug and ids as before
    assert.equal(U.logUploadUrl({...ok, url: 'ttt.mafl.net'}), null);
    assert.equal(U.logUploadUrl({...ok, url: 'javascript:alert(1)'}), null);
    assert.equal(U.logUploadUrl({...ok, url: ''}), null);
    assert.equal(U.logUploadUrl({...ok, slug: ''}), null);
    assert.equal(U.logUploadUrl({...ok, slug: null}), null);
    assert.equal(U.logUploadUrl({...ok, slug: 'Zone 23'}), null);    // must already be a slug
    assert.equal(U.logUploadUrl({...ok, slug: '-rollers'}), null);   // the server's isSlug
    assert.equal(U.logUploadUrl({...ok, slug: 'a'.repeat(49)}), null);
    assert.equal(U.logUploadUrl({...ok, sessionId: 'abc'}), null);
    assert.equal(U.logUploadUrl({...ok, sessionId: '12345678901234567'}), null);    // 17 digits
    assert.equal(U.logUploadUrl({...ok, sessionId: ''}), null);
    assert.equal(U.logUploadUrl({...ok, athleteId: 'x12'}), null);
    assert.equal(U.logUploadUrl({...ok, athleteId: '1234567890123'}), null);    // 13 digits
    assert.equal(U.logUploadUrl({...ok, athleteId: null}), null);
    assert.equal(U.logUploadUrl({...ok, athleteId: undefined}), null);
});

// A library with server entries of Kettenfett (Rollers) and Spokesmen (Sprockets), and a file plan.
const LIB = {
    plans: {
        S91T6D: {sig: 'S91T6D', json: '{}', text: null, loadedAt: 1000, source: 'server', slug: 'rollers', circleId: KF},
        QCQ87N: {sig: 'QCQ87N', json: '{}', text: null, loadedAt: 2000, source: 'server', slug: 'sprockets', circleId: SM},
        ABC123: {sig: 'ABC123', json: '{}', text: null, loadedAt: 3000, source: 'file'},
    },
    active: 'ABC123',
};

test('libraryCircleFor: a server entry with that slug in a joined club', () => {
    assert.equal(U.libraryCircleFor('rollers', LIB, [KF]), KF);
    assert.equal(U.libraryCircleFor('rollers', LIB, [SM, KF]), KF);
    assert.equal(U.libraryCircleFor('rollers', LIB, [SM]), null);      // Kettenfett not ticked
    assert.equal(U.libraryCircleFor('rollers', LIB, []), null);
    assert.equal(U.libraryCircleFor('rollers', LIB, null), null);
    assert.equal(U.libraryCircleFor('flyers', LIB, [KF, SM]), null);   // no such team in the library
    assert.equal(U.libraryCircleFor('', LIB, [KF]), null);
    assert.equal(U.libraryCircleFor(null, LIB, [KF]), null);
    assert.equal(U.libraryCircleFor('rollers', null, [KF]), null);
    assert.equal(U.libraryCircleFor('rollers', {plans: {}, active: null}, [KF]), null);
    // a file entry never names a club, even with stray server fields
    const lib = {plans: {X: {sig: 'X', json: '{}', loadedAt: 1, source: 'file', slug: 'rollers', circleId: KF}}, active: 'X'};
    assert.equal(U.libraryCircleFor('rollers', lib, [KF]), null);
});

test('uploadTarget', () => {
    const bound = {state: 'bound', circle: KF, slug: 'rollers', eventKey: '4567890:1763576400000'};
    const sprockets = LIB.plans.QCQ87N;
    const file = LIB.plans.ABC123;
    // a bound lock: its key, even with another active server entry
    assert.deepEqual(U.uploadTarget({lock: bound, entry: sprockets, plan: {team: 'Sprockets'}, lib: LIB, joined: [KF, SM]}),
                     {slug: 'rollers', circle: KF});
    assert.deepEqual(U.uploadTarget({lock: bound, entry: null, plan: null, lib: LIB, joined: []}),
                     {slug: 'rollers', circle: KF});
    // a server entry: its slug and club (an empty lock binds to nothing)
    assert.deepEqual(U.uploadTarget({lock: {state: 'empty', eventKey: null}, entry: sprockets, plan: {team: 'Sprockets fast'},
                                     lib: LIB, joined: [SM]}),
                     {slug: 'sprockets', circle: SM});
    assert.deepEqual(U.uploadTarget({lock: null, entry: sprockets, plan: null, lib: LIB, joined: []}),
                     {slug: 'sprockets', circle: SM});
    // a file plan of team Rollers, Kettenfett has Rollers in the library and is ticked
    assert.deepEqual(U.uploadTarget({lock: null, entry: file, plan: {team: 'Rollers'}, lib: LIB, joined: [KF]}),
                     {slug: 'rollers', circle: KF});
    // the same with Kettenfett not ticked: no club, stays local
    assert.equal(U.uploadTarget({lock: null, entry: file, plan: {team: 'Rollers'}, lib: LIB, joined: [SM]}), null);
    assert.equal(U.uploadTarget({lock: null, entry: file, plan: {team: 'Flyers'}, lib: LIB, joined: [KF, SM]}), null);
    assert.equal(U.uploadTarget({lock: null, entry: null, plan: null, lib: LIB, joined: [KF, SM]}), null);
    assert.equal(U.uploadTarget({}), null);
    // a server entry without a club or slug goes by the plan's team like a file plan
    assert.deepEqual(U.uploadTarget({lock: null, entry: {sig: 'OLD', source: 'server', team: 'Rollers'}, plan: {team: 'Rollers'},
                                     lib: LIB, joined: [KF]}),
                     {slug: 'rollers', circle: KF});
    // a malformed lock counts as none
    assert.deepEqual(U.uploadTarget({lock: {state: 'bound', circle: 'K7F3Q9X2M4', slug: 'rollers'}, entry: sprockets,
                                     plan: null, lib: LIB, joined: []}),
                     {slug: 'sprockets', circle: SM});
});

test('rideTarget: a server plan from another event, or with no event known, is no target', () => {
    const key = '4567890:1763576400000';
    const last = {...LIB.plans.S91T6D, eventKey: '4567000:1762971600000'};    // last week's Rollers plan
    const now = {...LIB.plans.S91T6D, eventKey: key};
    const lib = {...LIB, plans: {...LIB.plans, S91T6D: last}, active: 'S91T6D'};
    // last week's server plan, still active when the recording starts: no target, and its plan's
    // team is not looked up in the library either (that would find last week's club again)
    assert.equal(U.rideTarget({lock: null, entry: last, plan: {team: 'Rollers'}, lib, joined: [KF], eventKey: key}), null);
    assert.equal(U.rideTarget({lock: {state: 'empty', eventKey: key}, entry: last, plan: {team: 'Rollers'}, lib, joined: [KF],
                               eventKey: key}), null);
    // no event key yet (the gate opened before start and event id were known): any server plan is none
    assert.equal(U.rideTarget({lock: null, entry: now, plan: {team: 'Rollers'}, lib, joined: [KF], eventKey: null}), null);
    assert.equal(U.rideTarget({lock: null, entry: now, plan: {team: 'Rollers'}, lib, joined: [KF]}), null);
    // this event's server plan: its team and club
    assert.deepEqual(U.rideTarget({lock: null, entry: now, plan: {team: 'Rollers'}, lib, joined: [KF], eventKey: key}),
                     {slug: 'rollers', circle: KF});
    // this event's bound lock wins over a stale entry
    assert.deepEqual(U.rideTarget({lock: {state: 'bound', circle: SM, slug: 'sprockets', eventKey: key}, entry: last,
                                   plan: null, lib, joined: [], eventKey: key}),
                     {slug: 'sprockets', circle: SM});
    // a file plan does not depend on the event
    assert.deepEqual(U.rideTarget({lock: null, entry: LIB.plans.ABC123, plan: {team: 'Rollers'}, lib: LIB, joined: [KF],
                                   eventKey: null}),
                     {slug: 'rollers', circle: KF});
    assert.equal(U.rideTarget({lock: null, entry: null, plan: null, lib: LIB, joined: [KF], eventKey: key}), null);
});

test('sessionTarget: the club and team stored with the recording', () => {
    assert.deepEqual(U.sessionTarget({slug: 'sprockets', circle: SM, team: 'Rollers'}, LIB, [KF]),
                     {slug: 'sprockets', circle: SM});    // stored, not looked up: the club may be unticked since
});

test('sessionTarget: a 0.3 recording without a club stays local', () => {
    // 0.3 stores `circle` (null without a target at the start or at roll-off): no lookup, even
    // when the team name matches a ticked club's team in the library
    assert.equal(U.sessionTarget({slug: null, circle: null, team: 'Rollers'}, LIB, [KF]), null);
    assert.equal(U.sessionTarget({slug: 'rollers', circle: null, team: 'Rollers'}, LIB, [KF]), null);
    assert.equal(U.sessionTarget({slug: 'rollers', circle: 'bad'}, LIB, [KF]), null);
    assert.equal(U.sessionTarget({slug: 'Rollers!', circle: KF}, LIB, [KF]), null);
});

test('sessionTarget: a 0.2 recording (no circle) stays local, never looked up in the library', () => {
    // a slug without a club, or before 0.2.12 only the plan's team: no lookup, even when a ticked
    // club in the library has that team
    assert.equal(U.sessionTarget({slug: 'rollers'}, LIB, [KF]), null);
    assert.equal(U.sessionTarget({slug: 'rollers', team: 'Rollers'}, LIB, [KF]), null);
    assert.equal(U.sessionTarget({team: 'Rollers'}, LIB, [KF]), null);
    assert.equal(U.sessionTarget({}, LIB, [KF]), null);
    assert.equal(U.sessionTarget(null), null);
    assert.equal(U.sessionTarget(undefined), null);
    assert.equal(U.sessionTarget('x'), null);
    // without the library the stored club and team still count
    assert.deepEqual(U.sessionTarget({slug: 'sprockets', circle: SM}), {slug: 'sprockets', circle: SM});
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


test('pendingUploads: retry delay by the last error kind; final errors never again', () => {
    const now = 1731400000000 + 10 * DAY;
    const since = now - 30 * DAY;
    const row = (i, uploadError, triedAgo) => ({sessionId: String(now - DAY + i), ticks: 600,
        meta: {startedAt: now - DAY + i, uploadError, uploadTriedAt: now - triedAgo}});
    const notfound = row(1, 'notfound', 6 * DAY);
    const forbidden = row(2, 'forbidden', 6 * DAY);
    const offline5 = row(3, 'offline', 5 * MIN);
    const full5 = row(4, 'full', 5 * MIN);
    const http4 = row(5, 'http', 4 * MIN);
    const local5 = row(6, 'local', 5 * MIN);
    const toolarge = row(7, 'toolarge', 6 * DAY);
    const exists = row(8, 'exists', 6 * DAY);
    const refused = row(9, 'refused', 6 * DAY);
    const http5 = row(10, 'http', 5 * MIN);
    const got = U.pendingUploads([notfound, forbidden, offline5, full5, http4, local5, toolarge, exists, refused, http5],
                                 {now, currentSessionId: null, since});
    assert.deepEqual(got, [offline5.sessionId, full5.sessionId, local5.sessionId, http5.sessionId]);
});

test('permanent errors', () => {
    const now = 1731400000000 + 10 * DAY;
    const since = now - 2 * DAY;
    const cases = [[403, 'forbidden'], [404, 'notfound'], [409, 'exists'], [422, 'refused'], [413, 'toolarge']];
    for (const [status, kind] of cases) {
        assert.equal(U.uploadError(status), kind, String(status));
        assert.equal(U.retryAfterMs(kind), Infinity, kind);
        const s = {sessionId: String(now - DAY), ticks: 600,
                   meta: {startedAt: now - DAY, uploadError: kind, uploadTriedAt: now - 7 * DAY + MIN}};
        assert.equal(U.autoUploadState(s, {now, since}), 'manual', kind);
        assert.deepEqual(U.pendingUploads([s], {now: now + 6 * DAY, currentSessionId: null, since}), [], kind);
    }
    // too many uploads today: not final, tried again after UPLOAD_RETRY_MS
    assert.equal(U.uploadError(429), 'http');
    assert.equal(U.retryAfterMs(U.uploadError(429)), U.UPLOAD_RETRY_MS);
    const busy = {sessionId: String(now - DAY), ticks: 600, meta: {startedAt: now - DAY, uploadError: 'http', uploadTriedAt: now}};
    assert.equal(U.autoUploadState(busy, {now, since}), 'waiting');
    assert.deepEqual(U.pendingUploads([busy], {now: now + U.UPLOAD_RETRY_MS - 1, currentSessionId: null, since}), []);
    assert.deepEqual(U.pendingUploads([busy], {now: now + U.UPLOAD_RETRY_MS, currentSessionId: null, since}), [busy.sessionId]);
});

test('retryAfterMs: never for final errors, 5 min otherwise', () => {
    for (const k of ['forbidden', 'notfound', 'exists', 'refused', 'toolarge']) {
        assert.equal(U.retryAfterMs(k), Infinity, k);
    }
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
    assert.equal(st(row(DAY, 600, {uploadError: 'notfound', uploadTriedAt: now - MIN})), 'manual');    // final since 0.3
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
    assert.equal(U.uploadError(403), 'forbidden');
    assert.equal(U.uploadError(404), 'notfound');
    assert.equal(U.uploadError(409), 'exists');
    assert.equal(U.uploadError(413), 'toolarge');
    assert.equal(U.uploadError(422), 'refused');
    assert.equal(U.uploadError(507), 'full');
    assert.equal(U.uploadError(400), 'http');
    assert.equal(U.uploadError(408), 'http');
    assert.equal(U.uploadError(429), 'http');
    assert.equal(U.uploadError(500), 'http');
    assert.equal(U.uploadError(503), 'http');
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
        plan: {sig: 'ABC', riders: [{id: '1', name: 'Me', pullS: 60, watts: 254, weight: 72, ftp: 280, adjustment: 100, wkg: 4.2},
                                    {id: '2', name: 'Two', pullS: 45, watts: 300, weight: 80, ftp: 330, wkg: 3.8}],
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

test('stripForUpload: the head line leaves out the upload bookkeeping, so a retry sends the same bytes (W3)', () => {
    // 20 Nov 2026 audit (W3, s3-upload): a failed attempt writes uploadTriedAt/uploadError into the session
    // row, the row is the head line, so the retry's bytes differed from the first copy (409 'exists').
    assert.deepEqual(U.UPLOAD_DROP_HEAD_FIELDS, ['uploadedAt', 'uploadTriedAt', 'uploadError']);
    const tick = {ts: 1, riders: [{id: '1', self: true, power: 250}]};
    const plain = {sessionId: '1', plan: null, slug: 'team-a', circle: 'c000000001'};
    const planned = {...plain, plan: {sig: 'ABC', riders: [{id: '1', name: 'Me', pullS: 60, weight: 72}]}};
    for (const base of [plain, planned]) {
        const want = U.stripForUpload(toJsonl(base, [tick]));
        for (const extra of [{uploadTriedAt: 5, uploadError: 'http'},
                             {uploadedAt: 9, uploadTriedAt: 7, uploadError: 'offline'}]) {
            const got = U.stripForUpload(toJsonl({...base, ...extra}, [tick]));
            assert.equal(got, want, JSON.stringify(extra) + (base.plan ? ' with a plan' : ''));
            const h = JSON.parse(got.split('\n')[0]);
            for (const f of U.UPLOAD_DROP_HEAD_FIELDS) {
                assert.equal(Object.hasOwn(h, f), false, f);
            }
            assert.equal(h.slug, 'team-a');
            assert.equal(h.circle, 'c000000001');
        }
    }
});

// 17 Nov 2026 (ZRL): the plan changed mid-race; the upload kept only the head plan's riders and
// lost the new plan's. A row the recorder marked inPlan stays; the server checks it again.
test('stripForUpload: keeps a row marked inPlan whose rider is not in the head plan, drops a watched outsider', () => {
    const head = {sessionId: '1', selfId: '1', planSig: 'ABC', plan: {sig: 'ABC', riders: [{id: '1'}, {id: '2'}], bench: []}};
    const tick = {ts: 1, watchingId: '9', riders: [
        {id: '1', self: true, inPlan: true, power: 1},
        {id: '6', inPlan: true, power: 6, heartrate: 120},    // in the plan loaded after the head
        {id: '9', watching: true, power: 9},                  // watched, in no plan
        {id: '8', inPlan: 'true', power: 8},                  // only a real true counts
    ], det: {planSig: 'XYZ'}};
    const t = JSON.parse(U.stripForUpload(toJsonl(head, [tick])).split('\n')[1]);
    assert.deepEqual(t.riders, [{id: '1', self: true, inPlan: true, power: 1}, {id: '6', inPlan: true, power: 6}]);
    assert.equal(t.watchingId, null);
    // a recording from before the flag strips exactly as before: me and the head plan's riders
    const old = {ts: 1, watchingId: null, riders: [{id: '1', self: true, power: 1}, {id: '2', power: 2}, {id: '6', power: 6}]};
    const o = JSON.parse(U.stripForUpload(toJsonl(head, [old])).split('\n')[1]);
    assert.deepEqual(o.riders, [{id: '1', self: true, power: 1}, {id: '2', power: 2}]);
});

test('stripForUpload: unparseable and odd lines pass through untouched', () => {
    const text = '{"kind":"paceline-recording","v":1}\n{broken\n[1,2]\n{"ts":1}\n{"ts":2,"riders":null}\n';
    assert.equal(U.stripForUpload(text), text);
    assert.equal(U.stripForUpload(''), '');
});

