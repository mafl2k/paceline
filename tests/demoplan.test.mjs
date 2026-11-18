import test from 'node:test';
import assert from 'node:assert/strict';
import {samplePlan} from '../pages/src/engine/demoplan.mjs';


test('samplePlan: six riders with pull watts in plan order, one on the bench', () => {
    const plan = samplePlan();
    assert.equal(plan.team, 'Demo team');
    assert.equal(plan.riders.length, 6);
    assert.deepEqual(plan.riders.map(r => r.order), [0, 1, 2, 3, 4, 5]);
    assert.ok(plan.riders.every(r => Number.isFinite(r.watts) && Number.isFinite(r.pullS)));
    assert.equal(plan.bench.length, 1);
    assert.match(plan.sig, /^[0-9A-Z]{6}$/);
    assert.equal(samplePlan().sig, plan.sig);
});
