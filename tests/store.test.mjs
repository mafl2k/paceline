// Run with: node --test tests/store.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

// A stand-in for the window's localStorage (store.mjs reads it on every call).
const mem = new Map();
globalThis.localStorage = {
    getItem: k => mem.has(k) ? mem.get(k) : null,
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: k => mem.delete(k),
};
const {activePlan, PLANS_KEY, PREFS_KEY} = await import('../pages/src/store.mjs');

const json = JSON.stringify({team: {name: 'Old Notice'},
    riders: {0: {name: 'Ada Example', order: 1, pull_duration: 60, color: '#ffffff'}}});


test('activePlan: a 0.2 plan is no plan with the plan server on, the plan with it off', () => {
    mem.clear();
    mem.set(PLANS_KEY, JSON.stringify({plans: {OLD: {sig: 'OLD', json, text: null, loadedAt: 1}}, active: 'OLD'}));
    mem.set(PREFS_KEY, JSON.stringify({serverOn: true}));
    assert.equal(activePlan(), null);
    assert.equal(activePlan({serverOn: true}), null);
    assert.equal(activePlan({serverOn: false}).plan.riders.length, 1);
    mem.set(PREFS_KEY, JSON.stringify({serverOn: false}));
    assert.equal(activePlan().plan.riders.length, 1);
    assert.equal(JSON.parse(mem.get(PLANS_KEY)).active, 'OLD');    // the library is left alone
});
