import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CLUBS_KEY, normalizeClubs} from '../pages/src/engine/clubs.mjs';
import {canon, planShared, makeShared} from '../pages/src/engine/clubs-shared.mjs';

const SERVER = 'https://ttt-beta.mafl.net';
const K = 'k7f3q9x2m4';     // Kettenfett RC
const S = 'p2m8c4t1v9';     // Spokesmen CC

function row(id, name, more = {}) {
    return {id, name, joined: false, via: null, addedAt: 0, changedAt: 0, joinedAt: null, hinted: false,
            lists: false, private: false, code: null, codeState: null, ...more};
}
const table = (...clubs) => normalizeClubs({server: SERVER, clubs}, SERVER);

// A stand-in for Sauce's app settings and this window's localStorage.
function rig({shared = undefined, local = table(), failRead = false, failWrite = false} = {}) {
    const r = {shared, local, attempts: 0, reads: 0, writes: [], localWrites: [], changed: 0, logs: 0};
    const rpc = {
        async getSetting(key) {
            assert.equal(key, CLUBS_KEY);
            r.reads++;
            if (failRead) {
                throw new Error('rpc down');
            }
            return r.shared === undefined ? undefined : JSON.parse(JSON.stringify(r.shared));
        },
        async setSetting(key, value) {
            assert.equal(key, CLUBS_KEY);
            r.attempts++;
            if (failWrite) {
                throw new Error('rpc down');
            }
            r.writes.push(value);
            r.shared = JSON.parse(JSON.stringify(value));
        },
    };
    r.sync = makeShared({
        rpc,
        readLocal: server => normalizeClubs(r.local, server),
        writeLocal: state => { r.local = state; r.localWrites.push(state); },
        changed: () => { r.changed++; },
        log: () => { r.logs++; },
    });
    return r;
}

test('planShared: per row the newer changedAt wins; writes only where a side differs', () => {
    const local = table(row(K, 'Kettenfett RC', {joined: true, via: 'rider', changedAt: 20}));
    // Shared holds the same row older, and a club only it knows.
    const sharedOld = {server: SERVER, clubs: [row(K, 'Kettenfett RC', {changedAt: 10}), row(S, 'Spokesmen CC', {changedAt: 5})]};
    const p = planShared(local, sharedOld, SERVER);
    assert.deepEqual(p.merged.clubs.map(c => [c.id, c.joined]), [[K, true], [S, false]]);
    assert.equal(p.localChanged, true);       // learned Spokesmen
    assert.equal(p.sharedChanged, true);      // the tick is newer
    // Equal tables, rows in another order: nothing to write either way.
    const same = {server: SERVER, clubs: [...local.clubs].reverse()};
    const q = planShared(local, same, SERVER);
    assert.deepEqual([q.localChanged, q.sharedChanged], [false, false]);
    // The shared copy is newer for a row: local changes, shared doesn't.
    const sharedNew = {server: SERVER, clubs: [row(K, 'Kettenfett RC', {joined: false, changedAt: 30})]};
    const n = planShared(local, sharedNew, SERVER);
    assert.deepEqual([n.localChanged, n.sharedChanged], [true, false]);
    assert.equal(n.merged.clubs[0].joined, false);
});

test('planShared: nothing shared, junk or another server counts as empty', () => {
    const local = table(row(K, 'Kettenfett RC', {changedAt: 1}));
    for (const raw of [undefined, null, 'x', 7, {server: 'https://ttt.mafl.net', clubs: [row(S, 'Spokesmen CC')]}]) {
        const p = planShared(local, raw, SERVER);
        assert.equal(p.localChanged, false);
        assert.equal(p.sharedChanged, true);
        assert.equal(canon(p.merged), canon(local));
    }
    // Both empty: no write, so another server's table is not wiped by an empty window.
    const e = planShared(table(), {server: 'https://ttt.mafl.net', clubs: [row(S, 'Spokesmen CC')]}, SERVER);
    assert.deepEqual([e.localChanged, e.sharedChanged], [false, false]);
});

test('init: merges, writes local and shared where they differ, tells the window', async () => {
    const r = rig({
        local: table(row(K, 'Kettenfett RC', {joined: true, via: 'rider', changedAt: 20})),
        shared: {server: SERVER, clubs: [row(S, 'Spokesmen CC', {changedAt: 5})]},
    });
    await r.sync.init(SERVER);
    assert.equal(r.reads, 1);
    assert.deepEqual(r.local.clubs.map(c => c.id), [K, S]);
    assert.equal(r.changed, 1);
    assert.equal(r.writes.length, 1);
    assert.deepEqual(r.writes[0].clubs.map(c => c.id), [K, S]);
    // A second window starting from the result changes nothing.
    const r2 = rig({local: r.local, shared: r.shared});
    await r2.sync.init(SERVER);
    assert.deepEqual([r2.writes.length, r2.localWrites.length, r2.changed], [0, 0, 0]);
});

test('init: a failed read writes nothing and logs once', async () => {
    const r = rig({local: table(row(K, 'Kettenfett RC', {changedAt: 3})), shared: {server: SERVER, clubs: []}, failRead: true});
    await r.sync.init(SERVER);
    await r.sync.written(r.local);
    await r.sync.written(table(row(K, 'Kettenfett RC', {joined: true, changedAt: 4})));
    assert.deepEqual([r.writes.length, r.localWrites.length, r.changed], [0, 0, 0]);
    assert.equal(r.logs, 1);
});

test('a failed write logs once, keeps the local copy and tries again next time', async () => {
    const r = rig({local: table(row(K, 'Kettenfett RC', {changedAt: 3})), failWrite: true});
    await r.sync.init(SERVER);
    assert.equal(r.attempts, 1);
    await r.sync.written(r.local);
    assert.equal(r.attempts, 2);        // not remembered as written
    assert.equal(r.logs, 1);
    assert.equal(r.local.clubs.length, 1);
});

test('written: overwrites the shared copy without reading, only when the JSON differs', async () => {
    const r = rig({local: table(row(K, 'Kettenfett RC', {changedAt: 3}))});
    await r.sync.init(SERVER);
    assert.deepEqual([r.reads, r.writes.length], [1, 1]);
    // Same table as the last shared write (rows in another order too): no read, no write.
    await r.sync.written(r.local);
    await r.sync.written({server: SERVER, clubs: [...r.local.clubs].reverse()});
    assert.deepEqual([r.reads, r.writes.length], [1, 1]);
    // A tick: overwritten, no read, no merge.
    const ticked = table(row(K, 'Kettenfett RC', {joined: true, via: 'rider', changedAt: 9}));
    r.local = ticked;
    await r.sync.written(ticked);
    assert.deepEqual([r.reads, r.writes.length, r.changed], [1, 2, 0]);
    assert.equal(r.shared.clubs[0].joined, true);
    // The same again is not written twice.
    await r.sync.written(ticked);
    assert.equal(r.writes.length, 2);
});

test('a gone row stays gone after the write', async () => {
    const r = rig({
        local: table(row(K, 'Kettenfett RC', {joined: true, via: 'rider', changedAt: 5}), row(S, 'Spokesmen CC', {changedAt: 3})),
    });
    await r.sync.init(SERVER);
    assert.deepEqual(r.shared.clubs.map(c => c.id).sort(), [K, S].sort());
    const changedAfterInit = r.changed;
    // An answer dropped K (gone: true): the table without it is written.
    const next = table(row(S, 'Spokesmen CC', {changedAt: 100}));
    r.local = next;
    await r.sync.written(next);
    assert.deepEqual(r.shared.clubs.map(c => c.id), [S]);
    assert.deepEqual(r.local.clubs.map(c => c.id), [S]);
    assert.equal(r.changed, changedAfterInit);      // the write never touches the window
    assert.equal(r.localWrites.length, 0);
});

test('written: another profile\'s row is overwritten, not merged (init is where the merge happens)', async () => {
    const r = rig({local: table(row(K, 'Kettenfett RC', {changedAt: 3}))});
    await r.sync.init(SERVER);
    r.shared = {server: SERVER, clubs: [row(K, 'Kettenfett RC', {joined: true, changedAt: 50}), row(S, 'Spokesmen CC', {changedAt: 40})]};
    const mine = table(row(K, 'Kettenfett RC', {hinted: true, changedAt: 4}));
    r.local = mine;
    await r.sync.written(mine);
    assert.deepEqual(r.shared.clubs.map(c => c.id), [K]);
    assert.equal(r.shared.clubs[0].changedAt, 4);
    assert.deepEqual([r.reads, r.changed], [1, 0]);
    // A window started later merges again.
    const r2 = rig({local: table(row(S, 'Spokesmen CC', {changedAt: 60})), shared: r.shared});
    await r2.sync.init(SERVER);
    assert.deepEqual(r2.local.clubs.map(c => c.id).sort(), [K, S].sort());
});

test('a write waits for an init in flight and then wins', async () => {
    let release;
    const gate = new Promise(ok => { release = ok; });
    const r = rig({local: table(row(K, 'Kettenfett RC', {changedAt: 3}))});
    const slow = makeShared({
        rpc: {async getSetting() { await gate; return undefined; }, async setSetting(k, v) { r.writes.push(v); }},
        readLocal: server => normalizeClubs(r.local, server), writeLocal: st => { r.local = st; },
        changed: () => {}, log: () => {},
    });
    const init = slow.init(SERVER);
    const later = table(row(K, 'Kettenfett RC', {joined: true, via: 'rider', changedAt: 8}));
    r.local = later;
    const w = slow.written(later);
    release();
    await Promise.all([init, w]);
    assert.equal(r.writes.at(-1).clubs[0].joined, true);
});

test('written: a table of another server, or before init, is not shared', async () => {
    const r = rig();
    await r.sync.written(table(row(K, 'Kettenfett RC', {changedAt: 1})));
    assert.equal(r.reads, 0);
    await r.sync.init(SERVER);
    assert.equal(r.reads, 1);       // init's own read
    const other = {server: 'https://ttt.mafl.net', clubs: [row(S, 'Spokesmen CC', {changedAt: 1})]};
    await r.sync.written(other);
    assert.deepEqual([r.reads, r.writes.length], [1, 0]);
});

test('no Sauce, no rpc functions, no server: nothing happens', async () => {
    for (const rpc of [null, undefined, {}, {getSetting() {}}]) {
        let touched = 0;
        const s = makeShared({rpc, readLocal: () => { touched++; return table(); }, writeLocal: () => { touched++; },
                              changed: () => { touched++; }, log: () => { touched++; }});
        await s.init(SERVER);
        await s.written(table(row(K, 'Kettenfett RC', {changedAt: 1})));
        assert.equal(touched, 0);
    }
    const r = rig();
    await r.sync.init(null);
    await r.sync.written(table(row(K, 'Kettenfett RC', {changedAt: 1})));
    assert.equal(r.reads, 0);
});
