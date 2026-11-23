import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {importFiles, PlanError} from '../pages/src/engine/plan.mjs';
import {emptyPending, mergePending, markImported} from '../pages/src/engine/pending.mjs';

const J1 = readFileSync(new URL('./fixtures/rollers.json', import.meta.url), 'utf8');
const T1 = readFileSync(new URL('./fixtures/rollers.txt', import.meta.url), 'utf8');
// A second plan: other pull time for the first rider, and a text export that matches it.
const j2obj = JSON.parse(J1);
// Arvid Lindqvist, rotation position 1 (not Object.keys()[0]: integer-like keys sort numerically)
j2obj.riders['5100005'].pull_duration = 90;
const J2 = JSON.stringify(j2obj);
const T2 = T1.replace('\t286\t120\t', '\t286\t90\t');
assert.notEqual(T2, T1);

// Mimics settings.mjs: merge, import, keep pending as the window does. Returns {pending, res, code}.
function step(pending, texts) {
    const m = mergePending(pending, texts);
    if (m.error) {
        return {pending, code: m.error};
    }
    try {
        const res = importFiles([m.pending.json, m.pending.text].filter(Boolean));
        return {pending: markImported(m.pending), res, code: null};
    } catch(e) {
        assert.ok(e instanceof PlanError);
        return {pending: e.code === 'no-json' ? m.pending : pending, code: e.code};
    }
}

const NO_WATTS = '/////';   // six riders, all watts null
const watts = res => res.plan.riders.map(r => r.watts).join('/');

test('J and T together', () => {
    const r = step(emptyPending(), [J1, T1]);
    assert.equal(r.code, null);
    assert.equal(watts(r.res), '286/338/238/266/319/309');
    assert.equal(r.res.warnings.length, 0);
});

test('J then T pairs with the pending JSON', () => {
    const a = step(emptyPending(), [J1]);
    assert.equal(a.code, null);
    assert.equal(watts(a.res), NO_WATTS);
    const b = step(a.pending, [T1]);
    assert.equal(b.code, null);
    assert.equal(watts(b.res), '286/338/238/266/319/309');
    assert.equal(b.res.plan.sig, step(emptyPending(), [J1, T1]).res.plan.sig);
});

test('T then J pairs with the pending text', () => {
    const a = step(emptyPending(), [T1]);
    assert.equal(a.code, 'no-json');
    const b = step(a.pending, [J1]);
    assert.equal(b.code, null);
    assert.equal(watts(b.res), '286/338/238/266/319/309');
    assert.equal(b.res.warnings.length, 0);
});

test('completed pair, then T2 alone waits for its JSON, then J2 alone pairs with T2', () => {
    const done = step(emptyPending(), [J1, T1]);
    assert.equal(done.pending.used, true);
    const t2 = step(done.pending, [T2]);
    assert.equal(t2.code, 'no-json');           // not paired with the old J1
    assert.equal(t2.pending.json, null);
    const j2 = step(t2.pending, [J2]);
    assert.equal(j2.code, null);
    assert.equal(j2.res.warnings.length, 0);   // J2 and T2 agree (no pull mismatch)
    assert.equal(j2.res.plan.riders[0].pullS, 90);
    assert.equal(watts(j2.res), '286/338/238/266/319/309');
});

test('completed pair, then J2 alone does not reuse the old text', () => {
    const done = step(emptyPending(), [J1, T1]);
    const j2 = step(done.pending, [J2]);
    assert.equal(j2.code, null);
    assert.equal(watts(j2.res), NO_WATTS);
    assert.equal(j2.pending.text, null);
});

test('unreadable file leaves pending untouched', () => {
    const done = step(emptyPending(), [J1, T1]);
    const r = step(done.pending, ['hello']);
    assert.equal(r.code, 'unreadable');
    assert.deepEqual(r.pending, done.pending);
});

test('JSON-only import is not a completed pair, so a text afterwards still pairs', () => {
    const a = step(emptyPending(), [J1]);
    assert.equal(a.pending.used, false);
});
