import test from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../pages/src/engine/presence.mjs';

test('aliveKey and parseAlive: one key per window, its mode and time', () => {
    assert.equal(W.aliveKey('abc'), `${W.ALIVE_PREFIX}abc`);
    assert.ok(!W.ALIVE_PREFIX.startsWith('/'), 'a private key, not Sauce-global');
    assert.deepEqual(W.parseAlive('{"mode":"rest","at":5}'), {mode: 'rest', at: 5, clock: false});
    assert.deepEqual(W.parseAlive('{"mode":"rest","at":5,"clock":true}'), {mode: 'rest', at: 5, clock: true});
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


test('W2: restClockShown: another Rest window heard within ALIVE_STALE_MS that shows its countdown', () => {
    // Probe s9-restopen: a Rest window opened mid-rest was blank 1.5 s while the Action window
    // already handed it the countdown; only a Rest window that says it shows one takes it.
    const now = 100000;
    assert.equal(W.restClockShown([['me', {mode: 'rest', at: now, clock: true}]], {now, selfId: 'me'}), false);
    assert.equal(W.restClockShown([['a', {mode: 'rest', at: now - 1000, clock: false}]], {now, selfId: 'me'}), false);
    assert.equal(W.restClockShown([['a', {mode: 'rest', at: now - 1000, clock: true}]], {now, selfId: 'me'}), true);
    assert.equal(W.restClockShown([['a', {mode: 'rest', at: now - W.ALIVE_STALE_MS, clock: true}]], {now, selfId: 'me'}), false);
    assert.equal(W.restClockShown([['a', {mode: 'action', at: now, clock: true}]], {now, selfId: 'me'}), false);
});


test('I-1: restShows: what the other Rest windows heard recently say they show', () => {
    const now = 100000;
    assert.deepEqual(W.parseAlive('{"mode":"rest","at":5,"clock":false,"shows":"pull"}'),
                     {mode: 'rest', at: 5, clock: false, shows: 'pull'});
    assert.deepEqual(W.parseAlive('{"mode":"rest","at":5,"shows":"nonsense"}'), {mode: 'rest', at: 5, clock: false});
    const entries = [
        ['me', {mode: 'rest', at: now, clock: false, shows: 'dash'}],
        ['a', {mode: 'rest', at: now - 1000, clock: false, shows: 'pull'}],
        ['b', {mode: 'rest', at: now - W.ALIVE_STALE_MS, clock: false, shows: 'ready'}],    // closed
        ['c', {mode: 'action', at: now, clock: false, shows: 'clock'}],
        ['d', {mode: 'rest', at: now, clock: false}],                                  // nothing shown yet
        ['e', null],
    ];
    assert.deepEqual([...W.restShows(entries, {now, selfId: 'me'})], ['pull']);
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
