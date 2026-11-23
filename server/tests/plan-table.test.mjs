// The rider table (team cockpit spec §7): one model of a version (or an inbox entry) marked against
// its race's live version, and its HTML. Made-up names only (helpers.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {raceBase, tableBase, tableModel, planTable, targetIn, STATE_SIGN} from '../plan-table.mjs';
import {cockpitClub, plan, NOW, DATE} from './cockpit-fixture.mjs';
import {makeClub} from './manage-helpers.mjs';
import {uploadSheet} from '../club.mjs';
import {T} from './helpers.mjs';
import {normalizePlan} from '../../pages/src/engine/plan.mjs';


const of = (c, id, now = NOW) => tableModel(c, c.sheets[id], tableBase(c, 'rollers', id), {now});

// Every line in short: a row as [pos, name, isNew, pull, changed.pull, changed.target]; an old line
// as ['old', pos, name, pull]; a dropped one as ['dropped', pos, name, pull, rides].
const show = m => m.lines.map(l => (l.kind === 'row' ? [l.pos, l.name, l.isNew, l.pull, l.changed.pull, l.changed.target]
    : l.dropped ? ['dropped', l.pos, l.name, l.pull, l.rides] : ['old', l.pos, l.name, l.pull]));

// The fixture's riders weigh 70 kg (planJson): 300 W is 4.3 W/kg, 280 W 4.0 W/kg.
const plain = (names, pull = '60 s @ 4.3') => names.map((name, i) => [i + 1, name, false, pull, false, false]);


test('a version against the live one: a new rider, the riders in live and not here', () => {
    const {club: c, ids} = cockpitClub();
    const m = of(c, ids.f2);                                     // v2: Cleo … Gus, Hanna; live v3: Ben, Cleo … Gus
    assert.deepEqual([m.state, m.caption, m.unit], ['diff', 'Against live v3 · Hanna in, Ben out', 'wkg']);
    assert.deepEqual(show(m), [
        ...plain(['Cleo', 'Dan', 'Eva', 'Finn', 'Gus']),         // Ben left the front: nobody else has an old line
        [6, 'Hanna', true, '60 s @ 4.3', false, false],
        ['dropped', 1, 'Ben', '60 s @ 4.3', null],               // at the end (user, 22 Nov 2026); Ben rides for Rollers that day (live v3)
    ]);
    // the whole shape of a dropped line and of a row
    assert.deepEqual(m.lines[6], {kind: 'old', pos: 1, id: '1001', name: 'Ben', pull: '60 s @ 4.3', dropped: true, rides: null});
    assert.deepEqual(m.lines[0], {kind: 'row', pos: 1, id: '1002', name: 'Cleo', isNew: false, pull: '60 s @ 4.3',
        parts: {s: '60', v: '4.3'}, changed: {pull: false, target: false}});
});


test('across plans: the caption names the live plan; a changed target gets an old line; a rider who left is no move', () => {
    const {club: c, ids} = cockpitClub();
    const m = of(c, ids.s1);                                     // Ben, Cleo at 280 W, Dan, Finn, Gus
    assert.deepEqual([m.state, m.caption], ['diff', 'Against live \'Rollers · fast\' v3 · Eva out · 2 targets']);
    assert.deepEqual(show(m), [
        [1, 'Ben', false, '60 s @ 4.0', false, true], ['old', 1, 'Ben', '60 s @ 4.3'],
        [2, 'Cleo', false, '60 s @ 4.0', false, true], ['old', 2, 'Cleo', '60 s @ 4.3'],
        [3, 'Dan', false, '60 s @ 4.3', false, false],
        [4, 'Finn', false, '60 s @ 4.3', false, false],
        [5, 'Gus', false, '60 s @ 4.3', false, false],
        ['dropped', 4, 'Eva', '60 s @ 4.3', null],               // at the end, with her old number
    ]);
    assert.deepEqual(m.lines[1], {kind: 'old', pos: 1, id: '1001', name: 'Ben', pull: '60 s @ 4.3', dropped: false});
    // the club's targets in watts: the same marks, in whole watts
    c.targetUnit = 'watts';
    const w = of(c, ids.s1);
    assert.equal(w.unit, 'watts');
    assert.deepEqual(show(w).slice(0, 3), [[1, 'Ben', false, '60 s @ 280', false, true], ['old', 1, 'Ben', '60 s @ 300'],
        [2, 'Cleo', false, '60 s @ 280', false, true]]);
});


test('the live version: the plan as riders get it, no old lines, also within the Undo window (spec §5.3b)', () => {
    const {club: c, ids} = cockpitClub();                        // v3 went live 18:14Z, NOW is 18:16Z: Undo is offered
    assert.deepEqual(tableBase(c, 'rollers', ids.f3), {kind: 'self', id: ids.f3});
    const m = of(c, ids.f3);
    assert.deepEqual([m.state, m.caption], ['live', 'LIVE · riders get this']);
    assert.deepEqual(show(m), plain(['Ben', 'Cleo', 'Dan', 'Eva', 'Finn', 'Gus']));
    const later = NOW + 10 * 60000 + 1;                          // just after 18:24Z: Undo is over, the same table
    const live = of(c, ids.f3, later);
    assert.deepEqual([live.state, live.caption], ['live', 'LIVE · riders get this']);
    assert.deepEqual(show(live), plain(['Ben', 'Cleo', 'Dan', 'Eva', 'Finn', 'Gus']));
    // any other version of the race is marked against the live one
    assert.deepEqual(tableBase(c, 'rollers', ids.f2), {kind: 'live', id: ids.f3});
    assert.deepEqual(tableBase(c, 'rollers', ids.s1), {kind: 'live', id: ids.f3});
    assert.deepEqual(raceBase(c, 'rollers', DATE), {kind: 'live', id: ids.f3});
    assert.deepEqual(raceBase(c, 'rollers', '2026-11-26'), {kind: 'none', id: null});
    assert.deepEqual(tableBase(c, 'rollers', 'c09999'), {kind: 'none', id: null});
});


test('the same rows as live, nothing live, a live version that cannot be read, a version that cannot be read', () => {
    const {club: c, ids} = cockpitClub();
    const same = of(c, ids.f1);
    assert.deepEqual([same.state, same.caption], ['same', 'Same riders, order, pulls and targets as live v3']);
    assert.deepEqual(show(same), plain(['Ben', 'Cleo', 'Dan', 'Eva', 'Finn', 'Gus']));
    const f2Rows = plain(['Cleo', 'Dan', 'Eva', 'Finn', 'Gus', 'Hanna']);  // no marks: no NEW, no old lines
    const none = structuredClone(c);
    none.teams.rollers.races[DATE].live = null;
    assert.deepEqual(tableBase(none, 'rollers', ids.f2), {kind: 'none', id: null});
    const n = of(none, ids.f2);
    assert.deepEqual([n.state, n.caption, show(n)], ['none', 'Nothing live for Thu 19 Nov yet: nothing to compare', f2Rows]);
    // without a date
    assert.equal(tableModel(none, {...none.sheets[ids.f2], date: null}, {kind: 'none', id: null}, {now: NOW}).caption,
        'Nothing live yet: nothing to compare');
    const bad = structuredClone(c);
    bad.sheets[ids.f3].json = {riders: 'x'};
    const u = of(bad, ids.f2);
    assert.deepEqual([u.state, u.caption, show(u)], ['unreadable', 'Live v3 can\'t be read: nothing to compare', f2Rows]);
    assert.equal(of(bad, ids.s1).caption, 'Live \'Rollers · fast\' v3 can\'t be read: nothing to compare');
    const broken = of(bad, ids.f3, NOW + 10 * 60000 + 1);
    assert.deepEqual([broken.state, broken.caption, broken.lines], ['broken', 'This version can\'t be read.', []]);
});


// Kettenfett RC with Rollers' race on DATE: the live version of `liveRows` (as plan() takes them), and
// add(rows) storing another version of that plan; with `sprockets`, Sprockets' live version of those
// riders, stored after Rollers' (its listing is the newer one: the riders' pick that day).
function oneRace(liveRows, {sprockets = null} = {}) {
    const {club} = makeClub();
    let k = 0;
    const newId = () => `t${String(++k).padStart(5, '0')}`;
    let minute = 0;
    const store = (slug, rows, as, live) => uploadSheet(club, {
        slug, json: plan(slug === 'rollers' ? 'Rollers' : 'Sprockets', rows), text: null, date: DATE,
        base: club.teams[slug].version, via: 'file', type: null, as, live,
    }, {now: T('2026-11-19T10:00:00Z') + 60000 * minute++, newId}).id;
    const live = store('rollers', liveRows, 'new', true);
    if (sprockets !== null) {
        store('sprockets', sprockets.map(id => [id, 60]), 'new', true);
    }
    const add = rows => store('rollers', rows, club.sheets[live].plan, false);
    return {club, live, add};
}

const W = v => ({pull_wkg: v});


test('the spec sketch: a dropped rider at the end, NEW, old lines for a move and a pull', () => {
    // live: Ben, Cleo, Dan, Eva, Finn; the version: Cleo, Hanna, Eva 45 s, Dan, Finn; Ben rides for Sprockets
    const {club, add} = oneRace([['1001', 60, W(4.2)], ['1002', 60, W(4.2)], ['1003', 60, W(4.4)], ['1004', 60, W(4.2)], ['1005', 60, W(4.0)]],
        {sprockets: ['1001']});
    const id = add([['1002', 60, W(4.2)], ['1007', 60, W(3.9)], ['1004', 45, W(4.2)], ['1003', 60, W(4.4)], ['1005', 60, W(4.0)]]);
    const m = of(club, id);
    assert.deepEqual([m.state, m.caption], ['diff', 'Against live v1 · Hanna in, Ben out · new order · 1 pull time']);
    assert.deepEqual(show(m), [
        [1, 'Cleo', false, '60 s @ 4.2', false, false],          // 2 → 1 only because Ben left: no old line
        [2, 'Hanna', true, '60 s @ 3.9', false, false],
        [3, 'Eva', false, '45 s @ 4.2', true, false], ['old', 4, 'Eva', '60 s @ 4.2'],
        [4, 'Dan', false, '60 s @ 4.4', false, false], ['old', 3, 'Dan', '60 s @ 4.4'],
        [5, 'Finn', false, '60 s @ 4.0', false, false],
        ['dropped', 1, 'Ben', '60 s @ 4.2', 'Sprockets'],
    ]);
});


test('dropped riders: all at the end of the table, in their old order (user, 22 Nov 2026)', () => {
    const rows = ids => ids.map(i => [i, 60, W(4.0)]);
    const r = oneRace(rows(['1001', '1002', '1003', '1004']));
    const last = of(r.club, r.add(rows(['1001', '1002', '1003'])));
    assert.deepEqual(show(last), [...plain(['Ben', 'Cleo', 'Dan'], '60 s @ 4.0'), ['dropped', 4, 'Eva', '60 s @ 4.0', null]]);
    const two = of(r.club, r.add(rows(['1001', '1004'])));
    assert.deepEqual(show(two), [
        [1, 'Ben', false, '60 s @ 4.0', false, false],
        [2, 'Eva', false, '60 s @ 4.0', false, false],
        ['dropped', 2, 'Cleo', '60 s @ 4.0', null], ['dropped', 3, 'Dan', '60 s @ 4.0', null],
    ]);
    assert.equal(two.caption, 'Against live v1 · Cleo and Dan out');
    // a new order with the first riders gone: they never land between two riders of the plan
    const reordered = of(r.club, r.add(rows(['1004', '1003', '1005'])));
    assert.deepEqual(show(reordered).map(l => l[0]), [1, 'old', 2, 'old', 3, 'dropped', 'dropped']);   // Eva and Dan swap: both have an old line
    assert.deepEqual(show(reordered).slice(-2), [['dropped', 1, 'Ben', '60 s @ 4.0', null], ['dropped', 2, 'Cleo', '60 s @ 4.0', null]]);
});


test('moves among the riders in both versions; pulls; W/kg and watts; same plan code, other W/kg; an entry for a new plan', () => {
    // live L = Ben, Cleo, Dan, Eva, Finn (60 s; Ben 4.0 W/kg, Cleo 300 W at 70 kg = 4.3 W/kg, the others 4.1 W/kg)
    const L = [['1001', 60, W(4.0)], ['1002', 60, {pull_power: 300}], ['1003', 60, W(4.1)], ['1004', 60, W(4.1)], ['1005', 60, W(4.1)]];
    const {club, live, add} = oneRace(L);
    const [ben, cleo, dan, eva, finn] = L;

    // A = Finn, Ben, Cleo, Dan, Eva: every rider moved, each row followed by its old line
    const a = of(club, add([finn, ben, cleo, dan, eva]));
    assert.deepEqual([a.state, a.caption], ['diff', 'Against live v1 · new order']);
    assert.deepEqual(show(a), [
        [1, 'Finn', false, '60 s @ 4.1', false, false], ['old', 5, 'Finn', '60 s @ 4.1'],
        [2, 'Ben', false, '60 s @ 4.0', false, false], ['old', 1, 'Ben', '60 s @ 4.0'],
        [3, 'Cleo', false, '60 s @ 4.3', false, false], ['old', 2, 'Cleo', '60 s @ 4.3'],
        [4, 'Dan', false, '60 s @ 4.1', false, false], ['old', 3, 'Dan', '60 s @ 4.1'],
        [5, 'Eva', false, '60 s @ 4.1', false, false], ['old', 4, 'Eva', '60 s @ 4.1'],
    ]);

    // B = Gus, Ben, Cleo, Dan, Eva, Finn: Gus is new, nobody moved
    const b = of(club, add([['1006', 60, W(3.8)], ...L]));
    assert.deepEqual([b.state, b.caption], ['diff', 'Against live v1 · Gus in']);
    assert.deepEqual(show(b), [[1, 'Gus', true, '60 s @ 3.8', false, false],
        [2, 'Ben', false, '60 s @ 4.0', false, false], [3, 'Cleo', false, '60 s @ 4.3', false, false],
        ...plain(['Dan', 'Eva', 'Finn'], '60 s @ 4.1').map(([pos, ...rest]) => [pos + 3, ...rest])]);

    // C = L with Ben 45 s at 4.2 W/kg and Cleo at 4.1 W/kg
    const cId = add([['1001', 45, W(4.2)], ['1002', 60, W(4.1)], dan, eva, finn]);
    const cm = of(club, cId);
    assert.deepEqual([cm.state, cm.caption], ['diff', 'Against live v1 · 1 pull time · 2 targets']);
    assert.deepEqual(show(cm).slice(0, 5), [
        [1, 'Ben', false, '45 s @ 4.2', true, true], ['old', 1, 'Ben', '60 s @ 4.0'],
        [2, 'Cleo', false, '60 s @ 4.1', false, true], ['old', 2, 'Cleo', '60 s @ 4.3'],
        [3, 'Dan', false, '60 s @ 4.1', false, false],
    ]);
    assert.equal(show(cm).length, 7);
    // in watts: Ben's and Cleo's W/kg times 70 kg
    club.targetUnit = 'watts';
    assert.deepEqual(show(of(club, cId)).slice(0, 4), [
        [1, 'Ben', false, '45 s @ 294', true, true], ['old', 1, 'Ben', '60 s @ 280'],
        [2, 'Cleo', false, '60 s @ 287', false, true], ['old', 2, 'Cleo', '60 s @ 300'],
    ]);
    delete club.targetUnit;

    // D = L with Ben at 4.2 W/kg only: the plan code ignores W/kg, the table does not
    const d = add([['1001', 60, W(4.2)], cleo, dan, eva, finn]);
    assert.equal(club.sheets[d].sig, club.sheets[live].sig);
    const dm = of(club, d);
    assert.deepEqual([dm.state, dm.caption], ['diff', 'Against live v1 · 1 target']);
    assert.deepEqual(show(dm).slice(0, 2), [[1, 'Ben', false, '60 s @ 4.2', false, true], ['old', 1, 'Ben', '60 s @ 4.0']]);

    // an inbox entry for a new plan: marked against the race's live version, of another plan
    const entry = {json: plan('Rollers', [ben, dan]), text: null, team: 'rollers', date: DATE, plan: null};
    const em = tableModel(club, entry, raceBase(club, 'rollers', DATE), {now: NOW});
    assert.deepEqual([em.state, em.caption], ['diff', 'Against live \'Rollers\' v1 · 3 riders out']);
    assert.deepEqual(show(em), [
        [1, 'Ben', false, '60 s @ 4.0', false, false],
        [2, 'Dan', false, '60 s @ 4.1', false, false],
        ['dropped', 2, 'Cleo', '60 s @ 4.3', null],
        ['dropped', 4, 'Eva', '60 s @ 4.1', null], ['dropped', 5, 'Finn', '60 s @ 4.1', null],
    ]);
    // the same riders as live, in an entry of a new plan: 'same', naming the live plan
    const again = {json: plan('Rollers', L), text: null, team: 'rollers', date: DATE, plan: null};
    assert.equal(tableModel(club, again, raceBase(club, 'rollers', DATE), {now: NOW}).caption,
        'Same riders, order, pulls and targets as live \'Rollers\' v1');
});


// One rider's targetIn: `fields` are the rider's planner fields (weight only when given).
const oneTarget = (fields, unit) => {
    const json = plan('Rollers', [['1001', 60, fields]]);
    if (!Object.hasOwn(fields, 'weight')) {
        delete json.riders['1001'].weight;
    }
    const sheet = {json, text: null};
    const club = unit === undefined ? {} : {targetUnit: unit};
    return targetIn(club, sheet, normalizePlan(json, null).plan.riders[0]);
};

test('targetIn: W/kg, watts, conversion both ways, rounding, no weight keeps its own unit', () => {
    // W/kg, the default (also for any other value)
    assert.deepEqual(oneTarget({pull_wkg: 4.24}), {v: '4.2', unit: 'wkg', own: false});
    assert.deepEqual(oneTarget({pull_wkg: 4.26}, 'wkg'), {v: '4.3', unit: 'wkg', own: false});
    assert.deepEqual(oneTarget({pull_wkg: 4.2}, 'x'), {v: '4.2', unit: 'wkg', own: false});
    assert.deepEqual(oneTarget({pull_power: 300, weight: 71.4}), {v: '4.2', unit: 'wkg', own: false});
    assert.deepEqual(oneTarget({pull_power: 300}), {v: '300', unit: 'watts', own: true});
    // pull_wkg wins over pull_power in W/kg
    assert.deepEqual(oneTarget({pull_wkg: 3.9, pull_power: 300, weight: 70}), {v: '3.9', unit: 'wkg', own: false});
    // watts
    assert.deepEqual(oneTarget({pull_power: 299.6}, 'watts'), {v: '300', unit: 'watts', own: false});
    assert.deepEqual(oneTarget({pull_wkg: 4.2, weight: 71.4}, 'watts'), {v: '300', unit: 'watts', own: false});
    assert.deepEqual(oneTarget({pull_wkg: 4.2}, 'watts'), {v: '4.2', unit: 'wkg', own: true});
    assert.deepEqual(oneTarget({pull_wkg: 3.9, pull_power: 300, weight: 70}, 'watts'), {v: '300', unit: 'watts', own: false});
    // nothing to show
    assert.equal(oneTarget({}), null);
    assert.equal(oneTarget({weight: 70}, 'watts'), null);
    assert.equal(oneTarget({pull_wkg: 0, pull_power: -5}), null);
    // the text export's watts (rider.watts without a pull_power) count as watts
    assert.deepEqual(targetIn({}, {json: {riders: {}}, text: null}, {id: '1001', watts: 250, weight: 0}), {v: '250', unit: 'watts', own: true});
    assert.deepEqual(targetIn({}, {json: {riders: {}}, text: null}, {id: '1001', watts: 250, weight: 62.5}), {v: '4.0', unit: 'wkg', own: false});
});


test('the shown values decide: W/kg and the same watts are no change', () => {
    // live Ben at 4.2 W/kg, the version Ben at 300 W, both at 71.4 kg: 4.2 W/kg and 300 W either way
    const {club, add} = oneRace([['1001', 60, {pull_wkg: 4.2, weight: 71.4}], ['1002', 60, W(4.0)]]);
    const id = add([['1001', 60, {pull_power: 300, weight: 71.4}], ['1002', 60, W(4.0)]]);
    for (const unit of [undefined, 'watts']) {
        club.targetUnit = unit;
        const m = of(club, id);
        assert.deepEqual([m.state, m.caption], ['same', 'Same riders, order, pulls and targets as live v1'], String(unit));
        assert.ok(m.lines.every(l => l.kind === 'row' && !l.changed.pull && !l.changed.target), String(unit));
    }
    // without the weight the units differ: a change
    const {club: c2, add: add2} = oneRace([['1001', 60, {pull_wkg: 4.2, weight: undefined}]]);
    const m2 = of(c2, add2([['1001', 60, {pull_power: 300, weight: undefined}]]));
    assert.deepEqual([m2.state, show(m2)], ['diff', [[1, 'Ben', false, '60 s @ 300 W', false, true], ['old', 1, 'Ben', '60 s @ 4.2']]]);
});


test('the caption counts what the table marks: an export switch is no target, a new weight is one', () => {
    // case 1: W/kg became watts at the same weights (the same shown targets), and Gus came in
    const r1 = oneRace([['1001', 60, {pull_wkg: 4.2, weight: 71.4}], ['1002', 60, {pull_wkg: 4.0, weight: 75}]]);
    const v1 = r1.add([['1001', 60, {pull_power: 300, weight: 71.4}], ['1002', 60, {pull_power: 300, weight: 75}], ['1006', 60, W(3.8)]]);
    for (const unit of [undefined, 'watts']) {
        r1.club.targetUnit = unit;
        const m = of(r1.club, v1);
        assert.equal(m.caption, 'Against live v1 · Gus in', String(unit));
        assert.ok(m.lines.every(l => l.kind === 'row' && !l.changed.target), String(unit));
    }
    // case 2: only Ben's weight changed (70 → 75 kg at 300 W): 4.3 → 4.0 W/kg in the table and the caption
    const r2 = oneRace([['1001', 60, {pull_power: 300, weight: 70}], ['1002', 60, W(4.0)]]);
    const m2 = of(r2.club, r2.add([['1001', 60, {pull_power: 300, weight: 75}], ['1002', 60, W(4.0)]]));
    assert.deepEqual([m2.state, m2.caption], ['diff', 'Against live v1 · 1 target']);
    assert.deepEqual(show(m2).slice(0, 2), [[1, 'Ben', false, '60 s @ 4.0', false, true], ['old', 1, 'Ben', '60 s @ 4.3']]);
    // in watts nothing changed for Ben: the same 300 W
    r2.club.targetUnit = 'watts';
    assert.equal(of(r2.club, Object.keys(r2.club.sheets).at(-1)).state, 'same');
});


const count = (s, sub) => s.split(sub).length - 1;

test('planTable: words, never colour alone; every value escaped', () => {
    const {club: c, ids} = cockpitClub();
    // v3 against v2 (the 'before' base went with spec §5.3b: the same marks against v2 as a live base)
    const model = tableModel(c, c.sheets[ids.f3], {kind: 'live', id: ids.f2}, {now: NOW});
    const html = planTable(model);
    assert.ok(html.startsWith('<p class="pt-cap">Against live v2 · Ben in, Hanna out</p>\n<table class="ptable ptable-plan">'), html);
    // the cockpit's card says the caption in its head: without it the table alone
    assert.equal(planTable(model, {caption: false}), html.slice(html.indexOf('<table')));
    assert.ok(html.includes('<thead><tr><th class="n pt-pos">#</th><th>Rider</th><th class="n pt-pull">Pull @ W/kg</th></tr></thead>'), html);
    assert.ok(html.includes('<tr><td class="n pt-pos">1</td><td class="nmcol"><span class="pt-who"><span class="pt-nm">Ben</span>'
        + ' <span class="pt-mark">NEW</span></span></td><td class="n pt-pull">60 s @ 4.3</td></tr>'), html);
    assert.ok(html.includes('<tr class="pt-old pt-dropped"><td class="n pt-pos"><s>6</s></td><td class="nmcol"><span class="pt-who">'
        + '<span class="vh">dropped:</span> <span class="pt-nm"><s>Hanna</s></span> <span class="pt-rides">→ Sprockets</span></span></td>'
        + '<td class="n pt-pull"><s>60 s @ 4.3</s></td></tr>'), html);
    assert.equal(count(html, 'pt-chg'), 0);
    assert.ok(html.endsWith('</tbody></table>'), html);

    // an old line, and the changed value of the row only: the spec sketch's Eva (45 s, moved) and Dan (moved)
    const {club, add} = oneRace([['1001', 60, W(4.2)], ['1003', 60, W(4.4)], ['1004', 60, W(4.2)]]);
    const sk = planTable(of(club, add([['1001', 60, W(4.2)], ['1004', 45, W(4.2)], ['1003', 60, W(4.4)]])));
    assert.ok(sk.includes('<tr><td class="n pt-pos">2</td><td class="nmcol"><span class="pt-who"><span class="pt-nm">Eva</span></span></td>'
        + '<td class="n pt-pull"><span class="pt-chg">45</span> s @ 4.2</td></tr>\n'
        + '<tr class="pt-old"><td class="n pt-pos">3</td><td class="nmcol"><span class="pt-who"><span class="vh">before:</span> <span class="pt-nm">Eva</span></span></td>'
        + '<td class="n pt-pull">60 s @ 4.2</td></tr>'), sk);
    assert.ok(sk.includes('<td class="n pt-pull">60 s @ 4.4</td></tr>\n<tr class="pt-old"><td class="n pt-pos">2</td>'), sk);
    assert.equal(count(sk, 'pt-chg'), 1);
    assert.equal(count(sk, '<span class="vh">before:</span>'), 2);
    // a changed target, and a target alone; watts in the header
    club.targetUnit = 'watts';
    const tg = planTable(of(club, add([['1001', 60, W(4.0)], ['1003', 60, W(4.4)], ['1004', 60, W(4.2)]])));
    assert.ok(tg.includes('<th class="n pt-pull">Pull @ W</th>'), tg);
    assert.ok(tg.includes('<td class="n pt-pull">60 s @ <span class="pt-chg">280</span></td></tr>'), tg);
    assert.equal(count(tg, 'pt-chg'), 1);

    // every value escaped: a hand-made model with markup in each field
    const x = '<b>&\'"</b>';
    const ex = '&lt;b&gt;&amp;&#39;&quot;&lt;/b&gt;';
    const evil = planTable({state: 'diff', caption: x, unit: 'wkg', lines: [
        {kind: 'row', pos: x, id: '1', name: x, isNew: true, pull: x, parts: {s: x, v: x}, changed: {pull: true, target: true}},
        {kind: 'row', pos: 2, id: '2', name: x, isNew: false, pull: x, parts: {s: x, v: null}, changed: {pull: false, target: false}},
        {kind: 'old', pos: x, id: '1', name: x, pull: x, dropped: false},
        {kind: 'old', pos: x, id: '3', name: x, pull: x, dropped: true, rides: x},
    ]});
    assert.ok(!evil.includes('<b>'), evil);
    assert.equal(count(evil, ex), 14, evil);
    assert.ok(evil.includes(`<span class="pt-chg">${ex}</span> s @ <span class="pt-chg">${ex}</span>`), evil);
    assert.ok(evil.includes(`<span class="pt-rides">→ ${ex}</span>`), evil);

    // a version that cannot be read: the caption alone
    const bad = structuredClone(c);
    bad.sheets[ids.f3].json = {riders: 'x'};
    assert.equal(planTable(of(bad, ids.f3)), '<p class="pt-cap">This version can&#39;t be read.</p>');
});


// ---- the Plan column: the riders card after the gate (team cockpit spec §7, amended 22 Nov 2026) ----

test('the sign of every rider state: ✓ has it, ⚠ needs action, – waiting; every kind teamView gives has one', async () => {
    assert.deepEqual(STATE_SIGN, {
        has: '✓', 'has-in-event': '✓',
        'old-code': '⚠︎', 'other-team': '⚠︎', 'other-event': '⚠︎',
        none: '–', checked: '–', 'in-event': '–',
    });
    // the kinds riderState draws (team-view.mjs), read from its source: none is left without a sign
    const {readFile} = await import('node:fs/promises');
    const src = await readFile(new URL('../team-view.mjs', import.meta.url), 'utf8');
    const kinds = [...src.matchAll(/riderStateOf\('([a-z-]+)'/g)].map(m => m[1]);
    assert.equal(new Set(kinds).size, 8, kinds.join());
    assert.deepEqual([...new Set(kinds)].filter(k => !Object.hasOwn(STATE_SIGN, k)), []);
});


test('planTable with states: a Plan column, a state per real row, none on an old or a dropped line; escaped', () => {
    const {club: c, ids} = cockpitClub();
    const st = (kind, sev, text, time = null) => ({kind, sev, text, time});
    const states = new Map([
        ['1001', st('has-in-event', 'ok', 'Has the plan · in the event')],
        ['1002', st('has', 'ok', 'Has the plan')],
        ['1003', st('old-code', 'warn', 'Has an older plan (code ABC123)', '17:10')],
        ['1004', st('none', 'neutral', 'Not seen yet')],
        ['1005', st('other-team', 'warn', 'Rides Ev<il>" now', '18:00')],
        ['1006', st('in-event', 'neutral', 'In the event · plan comes at the next check', '19:05')],
    ]);
    const html = planTable(tableModel(c, c.sheets[ids.f3], {kind: 'live', id: ids.f2}, {now: NOW}), {states});   // against v2: Ben NEW, Hanna dropped
    assert.ok(html.startsWith('<p class="pt-cap">Against live v2 · Ben in, Hanna out</p>\n<table class="ptable ptable-plan rstates">'), html);
    assert.ok(html.includes('<thead><tr><th class="n pt-pos">#</th><th>Rider</th><th class="n pt-pull">Pull @ W/kg</th>'
        + '<th class="rstate">Plan</th></tr></thead>'), html);
    // a row: its state cell last, the sign hidden from screen readers, the text and the check's time
    assert.ok(html.includes('<tr><td class="n pt-pos">1</td><td class="nmcol"><span class="pt-who"><span class="pt-nm">Ben</span>'
        + ' <span class="pt-mark">NEW</span></span></td><td class="n pt-pull">60 s @ 4.3</td>'
        + '<td class="rstate ok"><span class="rstate-sign" aria-hidden="true">✓</span> <span class="rstate-text">Has the plan · in the event</span></td></tr>'), html);
    assert.ok(html.includes('<td class="rstate warn"><span class="rstate-sign" aria-hidden="true">⚠︎</span> '
        + '<span class="rstate-text">Has an older plan (code ABC123)</span> <time>17:10</time></td></tr>'), html);
    assert.ok(html.includes('<td class="rstate neutral"><span class="rstate-sign" aria-hidden="true">–</span> <span class="rstate-text">Not seen yet</span></td></tr>'), html);
    // a team's name in a state is escaped
    assert.ok(html.includes('<span class="rstate-text">Rides Ev&lt;il&gt;&quot; now</span> <time>18:00</time>'), html);
    assert.equal(html.includes('<il>'), false);
    // one state cell per line; the dropped line's is empty (no sign, no text)
    assert.equal(count(html, '<td class="rstate'), 7);
    assert.equal(count(html, '<span class="rstate-sign"'), 6);
    assert.ok(html.includes('<td class="n pt-pull"><s>60 s @ 4.3</s></td><td class="rstate"></td></tr>'), html);
    // the signs in ride order: never colour alone
    assert.deepEqual([...html.matchAll(/<span class="rstate-sign" aria-hidden="true">([^<]*)<\/span>/g)].map(m => m[1]),
        ['✓', '✓', '⚠︎', '–', '⚠︎', '–']);

    // an old line (not dropped) gets an empty state cell too: the spec sketch's Eva and Dan
    const {club, add} = oneRace([['1001', 60, W(4.2)], ['1003', 60, W(4.4)], ['1004', 60, W(4.2)]]);
    const sk = planTable(of(club, add([['1001', 60, W(4.2)], ['1004', 45, W(4.2)], ['1003', 60, W(4.4)]])),
        {states: new Map(['1001', '1003', '1004'].map(id => [id, st('has', 'ok', 'Has the plan')]))});
    assert.equal(count(sk, '<tr class="pt-old">'), 2);
    for (const old of sk.split('\n').filter(l => l.startsWith('<tr class="pt-old">'))) {
        assert.ok(old.endsWith('<td class="rstate"></td></tr>'), old);
    }
    assert.equal(count(sk, '<span class="rstate-sign"'), 3);

    // without states: no Plan column, three cells a line (as before the gate)
    const plainHtml = planTable(of(c, ids.f3));
    assert.equal(/rstate|rstates|>Plan</.test(plainHtml), false);
    assert.equal(planTable(of(c, ids.f3), {states: null}), plainHtml);
});
