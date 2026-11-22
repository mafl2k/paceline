import test from 'node:test';
import assert from 'node:assert/strict';
import {ordinal, diffVersions, diffSummary, diffPeople, pullTarget} from '../diff.mjs';
import {removeRider} from '../club.mjs';
import {club, sheet, T, setLive} from './helpers.mjs';


const NOW = T('2026-11-19T12:00Z');
const DATE = '2026-11-19';

const teams = () => ({
    rollers: {name: 'Rollers', start: '19:30', live: null},
    sprockets: {name: 'Sprockets', start: '19:40', live: null},
});

// A version of Rollers; `extra` overrides the builder's fields.
const ver = (riders, extra = {}) => sheet({
    team: 'rollers', label: 'Rollers', date: DATE, riders, uploadedAt: '2026-11-17T10:00:00.000Z', ...extra,
});

const kinds = lines => lines.map(l => l.kind);
const line = (lines, kind) => lines.find(l => l.kind === kind);
const diff = (older, newer, extra = {}) => diffVersions(
    club({teams: teams(), sheets: {o: older, n: newer}}), older, newer, NOW, extra);


test('diff: the roster is no part of it: in from the pool, out into it, out with now rides', () => {
    // Eva comes from the planner's roster (the club's rider pool), Dan goes into it, Ben goes into it
    // too but starts for Sprockets
    const older = ver(['1001', '1002', '1003'], {bench: ['1004'], plan: 'p', n: 1});
    const newer = ver(['1002', '1004', '1005'], {bench: ['1003', '1001'], plan: 'p', n: 2});
    const other = sheet({
        team: 'sprockets', label: 'Sprockets', date: DATE, riders: ['1001', '1006'],
        uploadedAt: '2026-11-18T10:00:00.000Z',
    });
    const c = club({teams: teams(), sheets: {old001: older, new001: newer, spr001: other}});
    setLive(c, 'sprockets', 'spr001');
    setLive(c, 'rollers', 'new001');
    const lines = diffVersions(c, older, newer, NOW);
    assert.equal(line(lines, 'in').text, 'Eva in (2nd); Finn in (3rd)');
    assert.deepEqual(line(lines, 'in').names, ['Eva', 'Finn']);
    assert.equal(line(lines, 'out').text, 'Ben out, now rides Sprockets; Dan out');
    assert.deepEqual(line(lines, 'out').names, ['Ben', 'Dan']);
    assert.deepEqual(kinds(lines), ['in', 'out']);
    assert.doesNotMatch(JSON.stringify(lines), /bench/i);
});

test('diff: a rider from the pool reads as a plain in', () => {
    const lines = diff(ver(['1001', '1003'], {bench: ['1002'], n: 1}), ver(['1001', '1002', '1003'], {bench: [], n: 2}));
    assert.deepEqual(lines.map(l => [l.kind, l.text]), [['in', 'Cleo in (2nd)']]);
});

test('diff: a change of the roster alone has no line of its own', () => {
    const lines = diff(ver(['1001', '1002'], {bench: ['1004'], n: 1}), ver(['1001', '1002'], {bench: ['1005'], n: 2}));
    assert.deepEqual(kinds(lines), ['other']);
    assert.doesNotMatch(JSON.stringify(lines), /bench|Eva|Finn/i);
});

test('diff: an insertion alone gives no order line; a swap does', () => {
    let lines = diff(ver(['1001', '1002'], {n: 1}), ver(['1001', '1003', '1002'], {n: 2}));
    assert.equal(lines.some(l => l.kind === 'order'), false);
    assert.equal(line(lines, 'in').text, 'Dan in (2nd)');
    lines = diff(ver(['1001', '1002'], {n: 1}), ver(['1002', '1001'], {n: 2}));
    assert.equal(line(lines, 'order').text, 'New order: Cleo, Ben');
});

test('diff: pull times and targets, W/kg and watts mixed', () => {
    const a = ver(['1003', '1002'], {n: 1});
    const b = ver(['1003', '1002'], {n: 2});
    a.json.riders['1003'].pull_duration = 45;
    b.json.riders['1003'].pull_duration = 60;
    a.json.riders['1002'].pull_duration = 60;
    b.json.riders['1002'].pull_duration = 45;
    a.json.riders['1003'].pull_wkg = 4.2;
    b.json.riders['1003'].pull_wkg = 4.4;
    a.json.riders['1002'].pull_power = 300;
    b.json.riders['1002'].pull_wkg = 4.1;
    const lines = diff(a, b);
    assert.equal(line(lines, 'pulls').text, 'Pull times: Dan 45 → 60 s, Cleo 60 → 45 s');
    assert.equal(line(lines, 'targets').text, 'Targets: Dan 4.2 → 4.4 W/kg; Cleo 300 W → 4.1 W/kg');
});

test('diff: pull and target lines follow the ride order, a missing target reads a dash', () => {
    const a = ver(['1003', '1002'], {n: 1});
    const b = ver(['1003', '1002'], {n: 2});
    a.json.riders['1003'].pull_duration = 45;
    b.json.riders['1003'].pull_duration = 60;
    a.json.riders['1002'].pull_duration = 60;
    b.json.riders['1002'].pull_duration = 45;
    a.json.riders['1003'].pull_wkg = 4.2;
    b.json.riders['1003'].pull_wkg = 4.4;
    b.json.riders['1002'].pull_wkg = 4.1;
    const lines = diff(a, b);
    assert.equal(line(lines, 'pulls').text, 'Pull times: Dan 45 → 60 s, Cleo 60 → 45 s');
    assert.equal(line(lines, 'targets').text, 'Targets: Dan 4.2 → 4.4 W/kg; Cleo – → 4.1 W/kg');
    assert.deepEqual(line(lines, 'pulls').names, ['Dan', 'Cleo']);
});

test('diff: no type line; other details; same names the plan', () => {
    const base = () => ver(['1001', '1002'], {n: 4});
    // a plan has one type (schema 4): two versions that differ only in type read as the same
    const fast = {...ver(['1001', '1002'], {n: 1, type: 'fast'}), label: 'Rollers · fast'};
    let lines = diff(fast, {...ver(['1001', '1002'], {n: 2, type: 'slow'}), label: 'Rollers · slow'});
    assert.deepEqual(lines.map(l => [l.kind, l.text]), [['same', 'Same as \'Rollers · fast\' v1']]);
    lines = diff(ver(['1001', '1002'], {n: 3}), ver(['1002', '1001'], {n: 4, type: 'slow'}));
    assert.deepEqual(kinds(lines), ['order']);
    const colour = base();
    colour.json.riders['1001'].color = '#00ff00';
    lines = diff(base(), colour);
    assert.deepEqual(lines.map(l => [l.kind, l.text]), [['other', 'Other details only']]);
    // "Same as" names the older version's plan and n
    lines = diff(ver(['1001', '1002'], {n: 3}), base());
    assert.deepEqual(lines.map(l => [l.kind, l.text]), [['same', 'Same as \'Rollers\' v3']]);
});


test('diff: targetOf decides what the targets line compares; pullTarget by default', () => {
    // only Ben's weight changes: pullTarget (300 W both) sees no target, a W/kg reading sees one
    const a = ver(['1001', '1002'], {n: 1});
    const b = ver(['1001', '1002'], {n: 2});
    a.json.riders['1001'].pull_power = 300;
    b.json.riders['1001'].pull_power = 300;
    b.json.riders['1001'].weight = 75;
    assert.deepEqual(diff(a, b).map(l => [l.kind, l.text]), [['other', 'Other details only']]);
    const targetOf = (sheet, rider) => (sheet.json.riders[rider.id].pull_power
        ? (sheet.json.riders[rider.id].pull_power / rider.weight).toFixed(1) : null);
    const lines = diff(a, b, {targetOf});
    assert.deepEqual(lines.map(l => [l.kind, l.text, l.names]), [['targets', 'Targets: Ben 4.3 → 4.0', ['Ben']]]);
    assert.equal(diffSummary(lines), '1 target');
    // a number against a target with its unit: both whole
    const c = ver(['1001', '1002'], {n: 3});
    c.json.riders['1001'].pull_wkg = 4.2;
    assert.equal(line(diff(a, c, {targetOf: (sh, r) => (sh === a && r.id === '1001' ? '4.3' : pullTarget(sh, r))}), 'targets').text, 'Targets: Ben 4.3 → 4.2 W/kg');
});


test('diff: the event link is the race\'s, no line of a version\'s diff', () => {
    // event fields on versions (as 0.3 stored them) are never read
    const at = (n, pinnedEventId) => ver(['1001', '1002'], {n, pinnedEventId});
    let lines = diff(at(3, null), at(4, 4567890));
    assert.deepEqual(lines.map(l => [l.kind, l.text]), [['same', 'Same as \'Rollers\' v3']]);
    lines = diff(at(3, 4567890), at(4, 4567899));
    assert.deepEqual(lines.map(l => [l.kind, l.text]), [['same', 'Same as \'Rollers\' v3']]);
    // with other changes: no line for the event (nor for the type)
    const typed = ver(['1002', '1001'], {n: 4, type: 'slow', pinnedEventId: 4567890});
    assert.deepEqual(diff(at(3, null), typed).map(l => l.kind), ['order']);
    // a learned event neither
    assert.deepEqual(diff(at(3, null), {...at(4, null), eventId: 4567890}).map(l => l.kind), ['same']);
});

test('diff: first version', () => {
    const newer = ver(['1001'], {n: 1});
    const c = club({teams: teams(), sheets: {n: newer}});
    assert.deepEqual(diffVersions(c, null, newer, NOW).map(l => [l.kind, l.text, l.names]), [['first', 'First version', []]]);
    assert.equal(diffVersions(c, null, newer, NOW, {newPlan: true})[0].text, 'First version of a new plan');
});

test('diffSummary: names, counts and limits', () => {
    // Eva in, Ben out, Dan and Cleo swapped, two pull times changed
    const a = ver(['1001', '1002', '1003'], {n: 1});
    const b = ver(['1003', '1002', '1004'], {n: 2});
    a.json.riders['1003'].pull_duration = 45;
    a.json.riders['1002'].pull_duration = 45;
    const sum = diffSummary(diff(a, b));
    assert.equal(sum, 'Eva in, Ben out · new order · 2 pull times');

    assert.equal(diffSummary(diff(ver(['1001'], {n: 1}), ver(['1001', '1002'], {n: 2}))), 'Cleo in');
    assert.equal(diffSummary(diff(ver(['1001'], {n: 1}), ver(['1001', '1002', '1003'], {n: 2}))), 'Cleo and Dan in');
    assert.equal(diffSummary(diff(ver(['1001'], {n: 1}), ver(['1001', '1002', '1003', '1004'], {n: 2}))), '3 riders in');
    assert.equal(diffSummary(diff(ver(['1001', '1002', '1003'], {n: 1}), ver(['1001'], {n: 2}))), 'Cleo and Dan out');
    // from the roster counts as in, into it as out
    assert.equal(diffSummary(diff(ver(['1001'], {n: 1, bench: ['1002']}), ver(['1002'], {n: 2, bench: ['1001']}))),
        'Cleo in, Ben out');

    const p1 = ver(['1001', '1002'], {n: 1});
    const p2 = ver(['1001', '1002'], {n: 2});
    p2.json.riders['1001'].pull_duration = 30;
    assert.equal(diffSummary(diff(p1, p2)), '1 pull time');
    p2.json.riders['1001'].pull_duration = 60;
    p2.json.riders['1002'].pull_wkg = 4.0;
    assert.equal(diffSummary(diff(p1, p2)), '1 target');
    p2.json.riders['1001'].pull_wkg = 4.1;
    assert.equal(diffSummary(diff(p1, p2)), '2 targets');

    // the old team page's "v3: …" and Restore's "Restored v4: …" went with them: no option changes the words
    assert.equal(diffSummary(diff(ver(['1001'], {n: 1}), ver(['1001', '1002'], {n: 2})), {n: 3, copyOf: 1}), 'Cleo in');
    // who came and went alone, or null
    assert.equal(diffPeople(diff(ver(['1001', '1003'], {n: 1}), ver(['1002', '1001'], {n: 2}))), 'Cleo in, Dan out');
    assert.equal(diffPeople(diff(ver(['1001', '1002'], {n: 1}), ver(['1002', '1001'], {n: 2}))), null);
});

test('diff: a rider removed by Remove a rider appears nowhere', () => {
    const v1 = ver(['1001', '1002', '1003'], {plan: 'p', n: 1});
    const v2 = ver(['1001', '1003', '1002'], {plan: 'p', n: 2, bench: ['1004']});
    const c = club({teams: teams(), sheets: {v1: v1, v2: v2}});
    removeRider(c, '1001', NOW);
    const lines = diffVersions(c, c.sheets.v1, c.sheets.v2, NOW);
    assert.ok(lines.length > 0);
    const all = JSON.stringify(lines);
    assert.doesNotMatch(all, /\bBen\b|1001/);
});

test('ordinal', () => {
    assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal),
        ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th']);
});
