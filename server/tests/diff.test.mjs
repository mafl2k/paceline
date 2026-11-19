import test from 'node:test';
import assert from 'node:assert/strict';
import {ordinal, diffVersions, diffSummary, diffPeople} from '../diff.mjs';
import {removeRider} from '../club.mjs';
import {club, sheet, T} from './helpers.mjs';


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
    c.teams.sprockets.live = 'spr001';
    c.teams.rollers.live = 'new001';
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

test('diff: type, other details, same', () => {
    const base = () => ver(['1001', '1002'], {n: 4});
    let lines = diff(ver(['1001', '1002'], {n: 3, type: 'fast'}), ver(['1001', '1002'], {n: 4, type: 'slow'}));
    assert.deepEqual(lines.map(l => l.text), ['Type: fast → slow']);
    lines = diff(ver(['1001', '1002'], {n: 3}), ver(['1001', '1002'], {n: 4, type: 'slow'}));
    assert.equal(line(lines, 'type').text, 'Type: none → slow');
    lines = diff(ver(['1001', '1002'], {n: 3, type: 'fast'}), ver(['1001', '1002'], {n: 4}));
    assert.equal(line(lines, 'type').text, 'Type: fast → none');
    const colour = base();
    colour.json.riders['1001'].color = '#00ff00';
    lines = diff(base(), colour);
    assert.deepEqual(lines.map(l => [l.kind, l.text]), [['other', 'Other details only']]);
    // "Same as" names the older version's n
    lines = diff(ver(['1001', '1002'], {n: 3}), base());
    assert.deepEqual(lines.map(l => [l.kind, l.text]), [['same', 'Same as v3']]);
});


test('diff: a version that differs only in its event link is no "Same as"', () => {
    const at = (n, pinnedEventId) => ver(['1001', '1002'], {n, pinnedEventId});
    let lines = diff(at(3, null), at(4, 4567890));
    assert.deepEqual(lines.map(l => [l.kind, l.text]), [['event', 'Event link added']]);
    assert.equal(diffSummary(lines), 'Event link added');
    lines = diff(at(3, 4567890), at(4, 4567899));
    assert.deepEqual(lines.map(l => [l.kind, l.text]), [['event', 'Event link changed']]);
    lines = diff(at(3, 4567890), at(4, null));
    assert.deepEqual(lines.map(l => [l.kind, l.text]), [['event', 'Event link removed']]);
    assert.equal(diffSummary(lines, {copyOf: 1}), 'Restored v1: Event link removed');
    lines = diff(at(3, 4567890), at(4, 4567890));
    assert.deepEqual(lines.map(l => [l.kind, l.text]), [['same', 'Same as v3']]);
    // with other changes, after the type line
    const typed = ver(['1002', '1001'], {n: 4, type: 'slow', pinnedEventId: 4567890});
    assert.deepEqual(diff(at(3, null), typed).map(l => l.kind), ['order', 'type', 'event']);
    // a learned event is no link
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

    assert.equal(diffSummary(diff(p1, p1), {copyOf: 4}), 'Restored v4: Same as v1');
    assert.equal(diffSummary(diff(ver(['1001'], {n: 1}), ver(['1001', '1002'], {n: 2})), {copyOf: 4}), 'Restored v4: Cleo in');
    // with the version's own n (the team page's live row, UI panel 19 Nov 2026): "v3: …", a restore
    // "v3 (restored v1): …"
    assert.equal(diffSummary(diff(ver(['1001'], {n: 1}), ver(['1001', '1002'], {n: 2})), {n: 2}), 'v2: Cleo in');
    assert.equal(diffSummary(diff(ver(['1001'], {n: 1}), ver(['1001', '1002'], {n: 2})), {n: 3, copyOf: 1}), 'v3 (restored v1): Cleo in');
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
