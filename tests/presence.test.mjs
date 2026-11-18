import test from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../pages/src/engine/presence.mjs';

test('aliveKey and parseAlive: one key per window, its mode and time', () => {
    assert.equal(W.aliveKey('abc'), `${W.ALIVE_PREFIX}abc`);
    assert.ok(!W.ALIVE_PREFIX.startsWith('/'), 'a private key, not Sauce-global');
    assert.deepEqual(W.parseAlive('{"mode":"rest","at":5}'), {mode: 'rest', at: 5});
    assert.equal(W.parseAlive('nonsense'), null);
    assert.equal(W.parseAlive('{"mode":"rest"}'), null);
    assert.equal(W.parseAlive(null), null);
});


test('aliveModes: the modes of other windows heard within ALIVE_STALE_MS', () => {
    const now = 100000;
    const entries = [
        ['me', {mode: 'action', at: now}],
        ['a', {mode: 'rest', at: now - W.ALIVE_STALE_MS + 1}],
        ['b', {mode: 'info', at: now - W.ALIVE_STALE_MS}],    // too old: closed
        ['c', null],
    ];
    assert.deepEqual([...W.aliveModes(entries, {now, selfId: 'me'})], ['rest']);
    assert.deepEqual([...W.aliveModes([], {now, selfId: 'me'})], []);
});


test('staleKeys: entries older than ALIVE_DROP_MS (or unreadable) are cleaned up', () => {
    const now = 1e7;
    const entries = [['x', {mode: 'rest', at: now - W.ALIVE_DROP_MS}], ['y', {mode: 'rest', at: now - 1000}], ['z', null]];
    assert.deepEqual(W.staleKeys(entries, now), ['x', 'z']);
});


test('aliveDue: write again every ALIVE_REFRESH_MS', () => {
    assert.equal(W.aliveDue(null, 5000), true);
    assert.equal(W.aliveDue(5000, 5000 + W.ALIVE_REFRESH_MS - 1), false);
    assert.equal(W.aliveDue(5000, 5000 + W.ALIVE_REFRESH_MS), true);
    assert.ok(W.ALIVE_STALE_MS >= 3 * W.ALIVE_REFRESH_MS, 'a throttled window is not taken for closed at once');
});
