// Run with: node --test tests/plan.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as P from '../pages/src/engine/plan.mjs';

const json = readFileSync(new URL('./fixtures/rollers.json', import.meta.url), 'utf8');
const txt = readFileSync(new URL('./fixtures/rollers.txt', import.meta.url), 'utf8');


test('detectFileKind', () => {
    assert.equal(P.detectFileKind(json), 'json');
    assert.equal(P.detectFileKind(txt), 'text');
    assert.equal(P.detectFileKind('hello'), 'unknown');
});

test('parseTextExport reads the planner text export', () => {
    const rows = P.parseTextExport(txt);
    assert.equal(rows.length, 6);
    assert.deepEqual(rows[3], {name: 'Dario Brandl [KFR]', pullWatts: 266, pullS: 60, colorName: 'Black', colorHex: '#000000'});
});

test('parseTextExport handles comma, pipe and no header', () => {
    const comma = 'Edda Voss,319,15,Red,#CC0000\n';
    assert.equal(P.parseTextExport(comma)[0].pullWatts, 319);
    assert.equal(P.parseTextExport('RiderName|PullWatts|PullDurationSeconds|KitColorName|KitColorHex\nA|1|2|Red|#CC0000')[0].colorHex, '#CC0000');
});

test('normalizePlan merges JSON and text export', () => {
    const {plan, warnings} = P.normalizePlan(JSON.parse(json), P.parseTextExport(txt));
    assert.deepEqual(warnings, []);
    assert.equal(plan.team, 'Rollers');
    assert.equal(plan.targetSpeed, 42.6);
    assert.deepEqual(plan.riders.map(r => r.id), ['5100005', '5100004', '5100003', '5100002', '5100001', '51006']);
    assert.deepEqual(plan.riders.map(r => r.watts), [286, 338, 238, 266, 319, 309]);
    assert.equal(plan.riders[0].color, '#ffffff');
    assert.equal(plan.riders[5].colorName, 'Lime');
    assert.equal(plan.riders[2].name, `Kim S ${String.fromCodePoint(9733)} [KFR]`);
    assert.deepEqual(plan.bench, [{id: '510007', name: 'Greta Wendt-Pohl (Kettenfett RC)'}]);
});

test('without text export: no watts, colour words from the table', () => {
    const {plan} = P.normalizePlan(JSON.parse(json), null);
    assert.ok(plan.riders.every(r => r.watts === null));
    assert.deepEqual(plan.riders.map(r => r.colorName), ['White', 'Blue', 'Yellow', 'Black', 'Red', 'Green']);
});

test('pull duration mismatch and unknown names warn', () => {
    const rows = P.parseTextExport(txt);
    rows[1].pullS = 90;
    rows.push({name: 'Nobody', pullWatts: 1, pullS: 1, colorName: 'Red', colorHex: '#CC0000'});
    const {plan, warnings} = P.normalizePlan(JSON.parse(json), rows);
    assert.deepEqual(warnings.map(w => w.code).sort(), ['pull-mismatch', 'unmatched-text-row']);
    assert.equal(plan.riders[1].pullS, 60);   // JSON wins
});

test('importFiles needs the JSON', () => {
    assert.throws(() => P.importFiles([txt]), e => e.code === 'no-json');
    assert.throws(() => P.importFiles(['{"x":1}']), e => e.code === 'not-a-plan');
    assert.throws(() => P.importFiles([json, 'hello']), e => e.code === 'unreadable');
    assert.equal(P.importFiles([txt, json]).plan.riders[3].watts, 266);  // order of files irrelevant
});

test('planSig is stable, short and sensitive to watts', () => {
    const a = P.importFiles([json, txt]).plan.sig;
    assert.match(a, /^[0-9A-HJKMNP-TV-Z]{6}$/);
    const shuffled = JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(json)).reverse()));
    assert.equal(P.importFiles([shuffled, txt]).plan.sig, a);
    assert.notEqual(P.importFiles([json]).plan.sig, a);
    assert.notEqual(P.importFiles([json, txt.replace('\t266\t', '\t267\t')]).plan.sig, a);
});

test('findMe', () => {
    const {plan} = P.importFiles([json, txt]);
    assert.deepEqual(P.findMe(plan, 5100002).position, 4);
    assert.equal(P.findMe(plan, '5100002').rider.name, 'Dario Brandl [KFR]');
    assert.equal(P.findMe(plan, '510007').role, 'bench');
    assert.equal(P.findMe(plan, 1).role, 'none');
    assert.equal(P.findMe(plan, null).role, 'none');
});
