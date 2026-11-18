// Run with: node --test tests/library.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../pages/src/engine/library.mjs';


test('normalizeLibrary tolerates junk', () => {
    assert.deepEqual(L.normalizeLibrary(null), {plans: {}, active: null});
    assert.deepEqual(L.normalizeLibrary({plans: 3, active: 'X'}), {plans: {}, active: null});
});


test('addPlan activates and caps at 10, never dropping the active one', () => {
    let lib = L.normalizeLibrary(null);
    for (let i = 0; i < 12; i++) {
        lib = L.addPlan(lib, {sig: 'S' + i, json: '{}', text: null, loadedAt: i});
    }
    assert.equal(Object.keys(lib.plans).length, 10);
    assert.equal(lib.active, 'S11');
    assert.ok(!lib.plans.S0 && !lib.plans.S1);
    assert.equal(L.activeEntry(lib).sig, 'S11');
});


test('re-adding the same sig replaces it', () => {
    let lib = L.addPlan(L.normalizeLibrary(null), {sig: 'A', json: '1', text: null, loadedAt: 1});
    lib = L.addPlan(lib, {sig: 'A', json: '2', text: 't', loadedAt: 2});
    assert.equal(Object.keys(lib.plans).length, 1);
    assert.equal(lib.plans.A.text, 't');
});
