import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
    CLUBS_KEY, CID_RE, CODE_RE, normalizeCode, formatCode, codesToSend, normalizeClubs, mergeClubs,
    joinedIds, sameJoined, sameCodes, applyAnswer, autoJoinPick, answerClubs, setJoined, markHinted,
    addByCode, settingsCheckResult,
} from '../pages/src/engine/clubs.mjs';
import {CID_RE as SERVER_CID_RE, RIDER_CODE_RE, normalizeRiderCode, formatRiderCode} from '../server/ids.mjs';

const SERVER = 'https://ttt.mafl.net';
const K = 'k7f3q9x2m4';     // Kettenfett RC
const S = 'p2m8c4t1v9';     // Spokesmen CC
const CODE = '7Q4MZ2KX9B';

function row(id, name, more = {}) {
    return {
        id, name, joined: false, via: null, addedAt: 50, changedAt: 50, joinedAt: null, hinted: false,
        lists: true, teams: null, private: false, code: null, codeState: null, ...more,
    };
}

function table(...rows) {
    return normalizeClubs({server: SERVER, clubs: rows}, SERVER);
}

const byId = (state, id) => state.clubs.find(r => r.id === id);
const deepFreeze = o => {
    if (o && typeof o === 'object') {
        Object.values(o).forEach(deepFreeze);
        Object.freeze(o);
    }
    return o;
};


test('key and id rule as the server', () => {
    assert.equal(CLUBS_KEY, 'paceline:clubs:v1');
    // server/ids.mjs CID_RE: lower-case Crockford, 10 characters
    assert.ok(CID_RE.test(K));
    assert.ok(CID_RE.test(S));
    assert.ok(!CID_RE.test('K7F3Q9X2M4'));
    assert.ok(!CID_RE.test('k7f3q9x2mi'));   // i is no Crockford character
    assert.ok(!CID_RE.test('k7f3q9x2m'));
    assert.ok(!CID_RE.test('k7f3q9x2m4a'));
    assert.ok(CODE_RE.test(CODE));
    assert.ok(!CODE_RE.test('7q4mz2kx9b'));
});


test('codes and ids: the same rules as the server', () => {
    assert.equal(CID_RE.source, SERVER_CID_RE.source);
    assert.equal(CODE_RE.source, RIDER_CODE_RE.source);
    const inputs = ['rid3r-one5x', ' 7q4mz 2kx9b ', '7Q4MZ2KX9', '7Q4MZ2KX9U', '7Q4MZ2KX9B', '7q4mz-2kx9b',
        'oooooiiiii', 'LLLLL-lllll', '7Q4MZ\t2KX9B', '7Q4MZ–2KX9B', '7Q4MZ_2KX9B', '', null, 1234567890,
        '7Q4MZ2KX9BB', ' - 7Q4MZ - 2KX9B - '];
    for (const s of inputs) {
        assert.equal(normalizeCode(s), normalizeRiderCode(s), JSON.stringify(s));
        assert.equal(formatCode(s), formatRiderCode(s), JSON.stringify(s));
    }
});


test('a different server starts empty', () => {
    const r = row(K, 'Kettenfett RC', {joined: true, via: 'rider', joinedAt: 60});
    assert.deepEqual(
        normalizeClubs({server: 'https://ttt-beta.example.org', clubs: [r]}, 'https://ttt.mafl.net'),
        {server: 'https://ttt.mafl.net', clubs: []},
    );
    assert.deepEqual(normalizeClubs(null, SERVER), {server: SERVER, clubs: []});
    assert.deepEqual(normalizeClubs(undefined, SERVER), {server: SERVER, clubs: []});
    assert.deepEqual(normalizeClubs({clubs: [r]}, SERVER), {server: SERVER, clubs: []});
    assert.deepEqual(normalizeClubs({server: SERVER, clubs: [r]}, SERVER), {server: SERVER, clubs: [r]});
});


test('normalize: bad rows dropped, fields cleaned', () => {
    const raw = {server: SERVER, clubs: [
        row(K, 'Kettenfett RC'),
        row('K7F3Q9X2M4', 'Upper'),
        row('tooshort', 'Short'),
        row('a1b2c3d4e5', 7),
        row('a1b2c3d4e6', 'x'.repeat(61)),
        null,
        'k7f3q9x2m4',
        {...row(S, 'Spokesmen CC'), joined: 'yes', via: 'mail', joinedAt: 'soon', hinted: 1, lists: 'y',
            private: 'true', code: 'rid3r-one5x', codeState: 'fine', extra: 1},
    ]};
    const st = normalizeClubs(raw, SERVER);
    assert.deepEqual(st.clubs.map(r => r.id), [K, S]);
    assert.deepEqual(byId(st, S), row(S, 'Spokesmen CC', {lists: false}));
    // 60 characters is fine
    assert.equal(table(row(K, 'x'.repeat(60))).clubs.length, 1);
    // a stored code is kept only in its normal form
    assert.equal(byId(table(row(K, 'Kettenfett RC', {code: CODE, codeState: 'ok'})), K).code, CODE);
});


test('merge: the newer changedAt wins per row', () => {
    const a = table(
        row(K, 'Kettenfett RC', {joined: true, via: 'rider', joinedAt: 200, changedAt: 200}),
        row(S, 'Spokesmen CC', {changedAt: 100}),
    );
    const b = table(
        row(K, 'Kettenfett RC', {changedAt: 100}),
        row(S, 'Spokesmen CC', {joined: true, via: 'rider', joinedAt: 300, changedAt: 300}),
    );
    for (const m of [mergeClubs(a, b), mergeClubs(b, a)]) {
        assert.equal(byId(m, K).joined, true);
        assert.equal(byId(m, S).joined, true);
        assert.equal(m.clubs.length, 2);
    }
    // rows on one side only are kept
    const c = table(row('a1b2c3d4e5', 'Rollers Club'));
    assert.deepEqual(mergeClubs(a, c).clubs.map(r => r.id).sort(), [K, 'a1b2c3d4e5', S].sort());
    assert.deepEqual(mergeClubs(c, a).clubs.map(r => r.id).sort(), [K, 'a1b2c3d4e5', S].sort());
    // equal changedAt: a wins
    const x = table(row(K, 'Old name', {changedAt: 100}));
    const y = table(row(K, 'New name', {changedAt: 100}));
    assert.equal(byId(mergeClubs(x, y), K).name, 'Old name');
    assert.equal(byId(mergeClubs(y, x), K).name, 'New name');
    // different servers: a whole
    const other = normalizeClubs({server: 'https://ttt-beta.mafl.net', clubs: [row(S, 'Spokesmen CC')]},
        'https://ttt-beta.mafl.net');
    assert.deepEqual(mergeClubs(c, other), c);
    assert.deepEqual(mergeClubs(other, c), other);
});


test('answers: team names (server 0.5.1) are kept per club, null from an older server', () => {
    const st = deepFreeze(table(
        row(K, 'Kettenfett RC', {joined: true, via: 'rider', joinedAt: 60, changedAt: 60}),
        row(S, 'Spokesmen CC', {changedAt: 70}),
    ));
    const r1 = applyAnswer(st, {circles: [
        {id: K, name: 'Kettenfett RC', lists: true, teams: ['Rollers', 'Cogs', 'Rollers', 7, '', 'x'.repeat(61)]},
        {id: S, name: 'Spokesmen CC', lists: true, teams: []},
    ]}, 1000);
    assert.deepEqual(byId(r1, K).teams, ['Rollers', 'Cogs']);
    assert.deepEqual(byId(r1, S).teams, []);
    assert.equal(byId(r1, K).changedAt, 60);
    // an older server: no list, so null (unknown), not "no team"
    const r2 = applyAnswer(r1, {circles: [{id: K, name: 'Kettenfett RC', lists: true}]}, 2000);
    assert.equal(byId(r2, K).teams, null);
    // a club the answer doesn't name: no teams any more
    assert.deepEqual(byId(r2, S).teams, []);
    // a new listing club gets its teams; stored rows are cleaned
    const N = 'a1b2c3d4e5';
    const r3 = applyAnswer(st, {circles: [{id: N, name: 'Rollers Club', lists: true, teams: ['Wheelies']}]}, 1000);
    assert.deepEqual(byId(r3, N).teams, ['Wheelies']);
    const many = Array.from({length: 12}, (_, i) => `Team ${i}`);
    assert.deepEqual(normalizeClubs({server: SERVER, clubs: [row(K, 'Kettenfett RC', {teams: many})]}, SERVER).clubs[0].teams,
        many.slice(0, 10));
    assert.equal(normalizeClubs({server: SERVER, clubs: [row(K, 'Kettenfett RC', {teams: 'Rollers'})]}, SERVER).clubs[0].teams, null);
});


test('answers: new rows unticked, names refreshed, rows dropped only on gone', () => {
    const st = deepFreeze(table(
        row(K, 'Kettenfett RC', {joined: true, via: 'rider', joinedAt: 60, changedAt: 60}),
        row(S, 'Spokesmen CC', {changedAt: 70}),
    ));
    // a known id missing from the answer: kept, no longer lists
    const r1 = applyAnswer(st, {circles: [{id: K, name: 'Kettenfett RC', lists: true}]}, 1000);
    assert.deepEqual(byId(r1, S), {...byId(st, S), lists: false});
    assert.equal(byId(r1, K).lists, true);
    // gone drops it
    const r2 = applyAnswer(st, {circles: [{id: K, name: 'Kettenfett RC', lists: true}, {id: S, gone: true}]}, 1000);
    assert.deepEqual(r2.clubs.map(r => r.id), [K]);
    // renamed: new name, changedAt unchanged
    const r3 = applyAnswer(st, {circles: [{id: K, name: 'Kettenfett Racing', lists: false}]}, 1000);
    assert.equal(byId(r3, K).name, 'Kettenfett Racing');
    assert.equal(byId(r3, K).lists, false);
    assert.equal(byId(r3, K).changedAt, 60);
    // a new id that lists: an unticked row
    const N = 'a1b2c3d4e5';
    const r4 = applyAnswer(st, {circles: [{id: N, name: 'Rollers Club', lists: true}]}, 1000);
    assert.deepEqual(byId(r4, N), {
        id: N, name: 'Rollers Club', joined: false, via: null, addedAt: 1000, changedAt: 1000, joinedAt: null,
        hinted: false, lists: true, teams: null, private: false, code: null, codeState: null,
    });
    // a new id that doesn't list is not added
    const r5 = applyAnswer(st, {circles: [{id: N, name: 'Rollers Club', lists: false}]}, 1000);
    assert.equal(byId(r5, N), undefined);
    // the server and the input are kept
    assert.equal(r4.server, SERVER);
});


test('auto-join', () => {
    const empty = table();
    const one = {circles: [{id: K, name: 'Kettenfett RC', lists: true}], plans: [], hint: []};
    // an empty table plus one listing club: joined, via auto, recheck
    const res = settingsCheckResult(empty, one, {now: 1000});
    assert.equal(byId(res.clubs, K).joined, true);
    assert.equal(byId(res.clubs, K).via, 'auto');
    assert.equal(byId(res.clubs, K).joinedAt, 1000);
    assert.equal(res.recheck, true);
    assert.equal(res.several, false);

    // two listing clubs outside an event: none, several
    const two = {circles: [{id: K, name: 'Kettenfett RC', lists: true}, {id: S, name: 'Spokesmen CC', lists: true}],
        plans: [], hint: []};
    const r2 = answerClubs(empty, two, {now: 1000, inEvent: false});
    assert.deepEqual(joinedIds(r2.clubs), []);
    assert.equal(r2.clubs.clubs.length, 2);
    assert.equal(r2.several, true);
    assert.equal(r2.autoJoined, null);
    const s2 = settingsCheckResult(empty, two, {now: 1000});
    assert.equal(s2.several, true);
    assert.equal(s2.recheck, false);

    // in an event with one hint: that one
    const hintS = {id: S, name: 'Spokesmen CC', riders: ['1002'], uploadedAt: '2026-11-16T10:00:00Z', body: true};
    const r3 = answerClubs(empty, {...two, hint: [hintS]}, {now: 1000, inEvent: true, nearbyIds: [], rolledOff: false});
    assert.equal(r3.autoJoined, S);
    assert.deepEqual(joinedIds(r3.clubs), [S]);
    assert.equal(r3.several, false);

    // two hints: the pen rule; K lists all three nearby riders, S one
    const hintK = {id: K, name: 'Kettenfett RC', riders: ['1001', '1002', '1003', '1004'],
        uploadedAt: '2026-11-15T10:00:00Z', body: true};
    const both = {...two, hint: [hintK, hintS]};
    const r4 = answerClubs(empty, both, {now: 1000, inEvent: true, nearbyIds: [1001, 1002, 1003], rolledOff: false});
    assert.equal(r4.autoJoined, K);
    assert.deepEqual(joinedIds(r4.clubs), [K]);
    assert.equal(byId(r4.clubs, K).via, 'auto');
    // in an event without any hint: several
    const r5 = answerClubs(empty, two, {now: 1000, inEvent: true, nearbyIds: [], rolledOff: false});
    assert.equal(r5.autoJoined, null);
    assert.equal(r5.several, true);

    // a non-empty table: never
    const some = table(row(S, 'Spokesmen CC', {lists: false}));
    assert.deepEqual(autoJoinPick(some, one, {inEvent: false}), {join: null, several: false, wait: false});
    const r6 = answerClubs(some, one, {now: 1000, inEvent: false});
    assert.deepEqual(joinedIds(r6.clubs), []);
    assert.equal(r6.autoJoined, null);
    assert.equal(byId(r6.clubs, K).joined, false);
    assert.equal(settingsCheckResult(some, both, {now: 1000}).recheck, false);
});


test('auto-join: never a private club, waits for closed hints', () => {
    const empty = table();
    const priv = {circles: [{id: S, name: 'Spokesmen CC', lists: true, private: true, code: CODE}], plans: [], hint: []};
    assert.deepEqual(autoJoinPick(empty, priv, {inEvent: false}), {join: null, several: false, wait: false});
    const r1 = answerClubs(empty, priv, {now: 1000, inEvent: false, sentCodes: [CODE]});
    assert.equal(r1.autoJoined, null);
    assert.deepEqual(joinedIds(r1.clubs), []);
    // one open and one private listing club: the open one is the only one
    const mixed = {...priv, circles: [{id: K, name: 'Kettenfett RC', lists: true}, ...priv.circles]};
    assert.equal(autoJoinPick(empty, mixed, {inEvent: false}).join, K);

    const two = {circles: [{id: K, name: 'Kettenfett RC', lists: true}, {id: S, name: 'Spokesmen CC', lists: true}],
        plans: []};
    const closed = deepFreeze({...two, hint: [
        {id: K, name: 'Kettenfett RC', riders: [], uploadedAt: '2026-11-15T10:00:00Z', body: false},
        {id: S, name: 'Spokesmen CC', riders: [], uploadedAt: '2026-11-16T10:00:00Z', body: false},
    ]});
    const opts = {now: 1000, inEvent: true, nearbyIds: [1001, 1002, 1003], rolledOff: false};
    assert.deepEqual(autoJoinPick(empty, closed, opts), {join: null, several: false, wait: true});
    const r2 = answerClubs(empty, closed, opts);
    assert.deepEqual(r2, {clubs: empty, autoJoined: null, several: false});
    // one closed hint is enough to wait
    const half = {...two, hint: [{...closed.hint[0], body: true, riders: ['1001', '1002', '1003']}, closed.hint[1]]};
    assert.equal(autoJoinPick(empty, half, opts).wait, true);
    // both open: the pen rule
    const open = {...two, hint: [
        {id: K, name: 'Kettenfett RC', riders: ['1001', '1002', '1003'], uploadedAt: '2026-11-15T10:00:00Z', body: true},
        {id: S, name: 'Spokesmen CC', riders: ['1001'], uploadedAt: '2026-11-16T10:00:00Z', body: true},
    ]};
    const r3 = answerClubs(empty, open, opts);
    assert.equal(r3.autoJoined, K);
    assert.deepEqual(joinedIds(r3.clubs), [K]);
    // outside an event closed hints don't matter: several
    assert.deepEqual(autoJoinPick(empty, closed, {inEvent: false}), {join: null, several: true, wait: false});
});


test('lost update', () => {
    const before = table(
        row(K, 'Kettenfett RC', {changedAt: 100}),
        row(S, 'Spokesmen CC', {changedAt: 100, code: CODE, codeState: 'ok', private: true}),
    );
    assert.ok(sameJoined(before, structuredClone(before)));
    assert.ok(sameCodes(before, structuredClone(before)));
    // another window ticks K while the check is in flight
    const fresh = setJoined(structuredClone(before), K, true, 500);
    assert.equal(sameJoined(before, fresh), false);
    assert.equal(byId(before, K).joined, false);
    // the answer's new row goes into the fresh read and keeps the tick
    const N = 'a1b2c3d4e5';
    const answer = {circles: [
        {id: K, name: 'Kettenfett RC', lists: true},
        {id: S, name: 'Spokesmen CC', lists: true, private: true, code: CODE},
        {id: N, name: 'Rollers Club', lists: true},
    ], plans: [], hint: []};
    const res = answerClubs(fresh, answer, {now: 1000, inEvent: false, sentCodes: [CODE]});
    assert.equal(byId(res.clubs, K).joined, true);
    assert.equal(byId(res.clubs, K).via, 'rider');
    assert.equal(byId(res.clubs, N).joined, false);
    assert.equal(res.autoJoined, null);
    assert.deepEqual(joinedIds(res.clubs), [K]);

    // the codes to send changed
    const recoded = structuredClone(before);
    byId(recoded, S).code = 'R1D3R0NE5X';
    assert.equal(sameCodes(before, recoded), false);
    assert.equal(sameJoined(before, recoded), true);
});


test('joinedIds is sorted, setJoined bumps and records', () => {
    const st = deepFreeze(table(row(S, 'Spokesmen CC'), row(K, 'Kettenfett RC')));
    const a = setJoined(setJoined(st, S, true, 300), K, true, 400, 'auto');
    assert.deepEqual(joinedIds(a), [K, S]);
    assert.deepEqual(
        [byId(a, S).joined, byId(a, S).via, byId(a, S).joinedAt, byId(a, S).changedAt],
        [true, 'rider', 300, 300],
    );
    assert.deepEqual(
        [byId(a, K).joined, byId(a, K).via, byId(a, K).joinedAt, byId(a, K).changedAt],
        [true, 'auto', 400, 400],
    );
    const b = setJoined(a, S, false, 500);
    assert.deepEqual(
        [byId(b, S).joined, byId(b, S).via, byId(b, S).joinedAt, byId(b, S).changedAt],
        [false, 'rider', null, 500],
    );
    assert.deepEqual(joinedIds(b), [K]);
    // an unknown id changes nothing
    assert.deepEqual(setJoined(st, 'a1b2c3d4e5', true, 600), st);
});


test('settingsCheckResult never activates a plan', () => {
    const st = table(row(K, 'Kettenfett RC', {joined: true, via: 'rider', joinedAt: 60, changedAt: 60}));
    const answer = deepFreeze({
        circles: [{id: K, name: 'Kettenfett RC', lists: true}],
        plans: [
            {circle: {id: K, name: 'Kettenfett RC'}, team: 'Sprockets', slug: 'sprockets', label: 'Sprockets late',
                role: 'rider', startAt: '2026-11-20T18:30:00.000Z', body: false},
            {circle: {id: K, name: 'Kettenfett RC'}, team: 'Rollers', slug: 'rollers', label: 'Rollers fast',
                role: 'rider', startAt: '2026-11-19T18:30:00.000Z', body: true, json: {riders: {}}},
        ],
        hint: [],
    });
    const copy = structuredClone(answer);
    const res = settingsCheckResult(st, answer, {now: 1000});
    assert.deepEqual(Object.keys(res).sort(), ['clubs', 'next', 'recheck', 'several']);
    assert.deepEqual(res.next, {label: 'Rollers fast', startAt: '2026-11-19T18:30:00.000Z'});
    assert.equal(res.recheck, false);
    assert.equal(res.several, false);
    assert.deepEqual(answer, copy);
    // no plans: next is null
    assert.equal(settingsCheckResult(st, {circles: [], plans: [], hint: []}, {now: 1000}).next, null);
    assert.equal(settingsCheckResult(st, {circles: []}, {now: 1000}).next, null);
});


test('hinted once', () => {
    const st = deepFreeze(table(row(S, 'Spokesmen CC', {changedAt: 100})));
    const h = markHinted(st, S, 900);
    assert.equal(byId(h, S).hinted, true);
    assert.equal(byId(h, S).changedAt, 900);
    assert.equal(byId(st, S).hinted, false);
});


test('codes: read and shown', () => {
    assert.equal(normalizeCode('rid3r-one5x'), 'R1D3R0NE5X');
    assert.equal(normalizeCode(' 7q4mz 2kx9b '), '7Q4MZ2KX9B');
    assert.equal(normalizeCode('7Q4MZ2KX9'), null);
    assert.equal(normalizeCode('7Q4MZ2KX9U'), null);
    assert.equal(formatCode('7Q4MZ2KX9B'), '7Q4MZ-2KX9B');
    // the server's normalizeRiderCode on the same inputs
    assert.equal(normalizeCode('7q4mz-2kx9b'), '7Q4MZ2KX9B');
    assert.equal(normalizeCode('7Q4MZ2KX9BB'), null);
    assert.equal(normalizeCode(''), null);
    assert.equal(normalizeCode(null), null);
    assert.equal(normalizeCode(1234567890), null);
    assert.equal(normalizeCode('7Q4MZ_2KX9B'), null);
});


test('add club by code', () => {
    const entry = {id: 'p2m8c4t1v9', name: 'Spokesmen CC', lists: false, private: true, code: '7Q4MZ2KX9B'};
    const answer = deepFreeze({circles: [entry], plans: [], hint: []});
    const empty = deepFreeze(table());
    const r1 = addByCode(empty, answer, '7q4mz-2kx9b', 1000);
    assert.deepEqual(r1.added, {id: 'p2m8c4t1v9', name: 'Spokesmen CC'});
    const s = byId(r1.state, S);
    assert.deepEqual(
        {joined: s.joined, via: s.via, code: s.code, codeState: s.codeState, private: s.private},
        {joined: true, via: 'code', code: '7Q4MZ2KX9B', codeState: 'ok', private: true},
    );
    assert.deepEqual([s.joinedAt, s.changedAt, s.addedAt, s.lists, s.hinted], [1000, 1000, 1000, false, false]);

    // an existing unticked row gets the code and the tick
    const had = deepFreeze(table(row(S, 'Spokesmen', {changedAt: 100, addedAt: 40, hinted: true})));
    const r2 = addByCode(had, answer, '7Q4MZ2KX9B', 2000);
    assert.deepEqual(byId(r2.state, S), {
        id: S, name: 'Spokesmen CC', joined: true, via: 'code', addedAt: 40, changedAt: 2000, joinedAt: 2000,
        hinted: true, lists: false, teams: null, private: true, code: '7Q4MZ2KX9B', codeState: 'ok',
    });
    assert.deepEqual(r2.added, {id: S, name: 'Spokesmen CC'});
    // an already ticked row keeps its joinedAt
    const ticked = table(row(S, 'Spokesmen CC', {joined: true, via: 'rider', joinedAt: 70, changedAt: 70}));
    assert.equal(byId(addByCode(ticked, answer, CODE, 3000).state, S).joinedAt, 70);
    // the answer's team names come along (server 0.5.1)
    const withTeams = deepFreeze({circles: [{...entry, lists: true, teams: ['Spokes']}], plans: [], hint: []});
    assert.deepEqual(byId(addByCode(empty, withTeams, CODE, 4000).state, S).teams, ['Spokes']);

    // no echo: nothing
    const open = deepFreeze({circles: [{id: S, name: 'Spokesmen CC', lists: true}], plans: [], hint: []});
    assert.deepEqual(addByCode(had, open, CODE, 2000), {state: had, added: null});
    assert.deepEqual(addByCode(had, {circles: []}, CODE, 2000), {state: had, added: null});
    // another code echoed: nothing
    assert.deepEqual(addByCode(had, answer, 'R1D3R0NE5X', 2000), {state: had, added: null});
    // a malformed code: nothing
    assert.deepEqual(addByCode(had, answer, 'nope', 2000), {state: had, added: null});
});


test('code states', () => {
    const coded = (more = {}) => row(S, 'Spokesmen CC', {joined: true, via: 'code', joinedAt: 60, changedAt: 100,
        private: true, code: CODE, codeState: 'ok', ...more});
    // sent and no echo: bad, and no longer sent
    const st = deepFreeze(table(coded()));
    assert.deepEqual(codesToSend(st), [CODE]);
    const r1 = applyAnswer(st, {circles: [], plans: [], hint: []}, 1000, [CODE]);
    assert.equal(byId(r1, S).codeState, 'bad');
    assert.equal(byId(r1, S).changedAt, 1000);
    assert.equal(byId(r1, S).code, CODE);
    assert.deepEqual(codesToSend(r1), []);
    // echoed: ok again, no bump when nothing changed
    const echo = {circles: [{id: S, name: 'Spokesmen CC', lists: true, private: true, code: CODE}]};
    const r1b = applyAnswer(r1, echo, 2000, [CODE]);
    assert.equal(byId(r1b, S).codeState, 'ok');
    assert.equal(byId(r1b, S).changedAt, 2000);
    assert.equal(byId(applyAnswer(st, echo, 3000, [CODE]), S).changedAt, 100);
    // a code not sent is not marked
    assert.equal(byId(applyAnswer(st, {circles: []}, 1000, []), S).codeState, 'ok');

    // {id, code: 'needed'}: needed without a code, bad with one
    const plain = deepFreeze(table(row(K, 'Kettenfett RC', {joined: true, via: 'rider', joinedAt: 60, changedAt: 100})));
    const r2 = applyAnswer(plain, {circles: [{id: K, code: 'needed'}]}, 1000);
    assert.equal(byId(r2, K).codeState, 'needed');
    assert.equal(byId(r2, K).changedAt, 1000);
    assert.equal(byId(r2, K).name, 'Kettenfett RC');
    assert.equal(byId(r2, K).lists, false);
    // (not sent here, so only the 'needed' entry marks it)
    const r3 = applyAnswer(st, {circles: [{id: S, code: 'needed'}]}, 1000);
    assert.equal(byId(r3, S).codeState, 'bad');
    assert.equal(byId(r3, S).changedAt, 1000);
    // needed again: no bump
    assert.equal(byId(applyAnswer(r2, {circles: [{id: K, code: 'needed'}]}, 2000), K).changedAt, 1000);

    // open again: the code is dropped
    const r4 = applyAnswer(st, {circles: [{id: S, name: 'Spokesmen CC', lists: true}]}, 1000, [CODE]);
    assert.deepEqual(
        [byId(r4, S).code, byId(r4, S).codeState, byId(r4, S).private, byId(r4, S).changedAt],
        [null, null, false, 1000],
    );
    assert.equal(byId(r4, S).joined, true);
    // a needed row whose club is open again loses 'needed'
    const r5 = applyAnswer(r2, {circles: [{id: K, name: 'Kettenfett RC', lists: true}]}, 2000);
    assert.deepEqual([byId(r5, K).codeState, byId(r5, K).changedAt], [null, 2000]);

    // 11 rows with codes: 10 are sent, the joined ones first
    const ids = ['a1b2c3d4e0', 'a1b2c3d4e1', 'a1b2c3d4e2', 'a1b2c3d4e3', 'a1b2c3d4e4', 'a1b2c3d4e5',
        'a1b2c3d4e6', 'a1b2c3d4e7', 'a1b2c3d4e8', 'a1b2c3d4e9', 'a1b2c3d4ea'];
    const codes = ids.map(id => `${id.slice(-1).toUpperCase()}ABCDEFGHJ`);
    const rows = ids.map((id, i) => row(id, `Club ${i}`, {code: codes[i], codeState: 'ok', private: true,
        joined: i >= 8, via: i >= 8 ? 'code' : null, joinedAt: i >= 8 ? 60 : null}));
    rows.push(row('b1b2c3d4e0', 'Bad club', {code: 'ZZZZZZZZZZ', codeState: 'bad', private: true, joined: true}));
    const many = table(...rows);
    assert.equal(many.clubs.length, 12);
    const sent = codesToSend(many);
    assert.equal(sent.length, 10);
    assert.deepEqual(sent.slice(0, 3).sort(), codes.slice(8).sort());
    assert.ok(!sent.includes('ZZZZZZZZZZ'));
    // rows without a code send nothing
    assert.deepEqual(codesToSend(plain), []);
});
