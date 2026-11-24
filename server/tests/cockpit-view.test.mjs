// The team cockpit's model (team cockpit spec §5.2, §5.3, §5.6): the list per race, the selection
// and the panel. Made-up names only (helpers.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {SHOWN_VERSIONS, selectionOf, pendingFor, cockpitView} from '../cockpit-view.mjs';
import {teamRow} from '../team-view.mjs';
import {uploadSheet, makeLive, addEntry} from '../club.mjs';
import {cockpitClub, plan, NOW, DATE} from './cockpit-fixture.mjs';
import {T} from './helpers.mjs';


const row = r => [r.n, r.at, r.live, r.summary, r.notice, r.picked];
// a version panel with its race view as that race's date
const panelOf = p => (p.kind === 'version' ? {...p, rv: p.rv?.date ?? null} : p);
const sel = (c, q, slug = 'rollers', now = NOW) => selectionOf(c, slug, new URLSearchParams(q), now);

// A version of plan `as` of Rollers (or a new plan for DATE), every rider 60 s at 300 W, stored at `at`.
const rows = riders => riders.map(id => [id, 60, {pull_power: 300}]);
function store(c, newId, riders, at, {as = 'new', date = DATE, start, type = null, json} = {}) {
    return uploadSheet(c, {
        slug: 'rollers', json: json ?? plan('Rollers fast', rows(riders)), text: null, date, start, base: c.teams.rollers.version,
        via: 'file', type, as, live: false,
    }, {now: T(at), newId}).id;
}
const upload = (c, newId, at, extra = {}) => addEntry(c, {
    source: 'upload', team: 'rollers', via: 'file', json: plan('Rollers', rows(['1001', '1002'])), text: null, ...extra,
}, {now: T(at), newId});


test('the nearest race\'s list: plans not stored yet on top, plans in their fixed order, versions newest first', () => {
    const {club: c, ids} = cockpitClub();
    const v = cockpitView(c, 'rollers', {now: NOW});
    assert.equal(v.lists.length, 1);
    const [race] = v.lists;
    assert.deepEqual([race.date, race.day, race.over], [DATE, 'Thu 19 Nov', false]);
    assert.deepEqual(race.pending.map(p => [p.id, p.source, p.at, p.name, p.riders, p.picked]), [
        [ids.e2, 'receive', '19:12', 'Rollers slow', 4, false], [ids.e1, 'receive', '19:10', 'Rollers fast', 6, false],
        [ids.u1, 'upload', '19:05', 'Rollers', 5, false],
    ]);
    assert.equal(race.pending[0].line, '4 riders (Ben, Cleo …)');
    assert.deepEqual(race.plans.map(p => [p.planId, p.label, p.live]), [[ids.fast, 'Rollers · fast', true], [ids.slow, 'Rollers · slow', false]]);
    assert.deepEqual(race.plans[0].shown.map(row), [
        [3, '19:12', true, null, false, true],     // nothing picked: the live version is (spec §5.3b)
        [2, '18:55', false, 'Hanna in, Ben out', false, false],
    ]);
    // after the gate the live row counts the riders who have it, the riders card's count (spec §5.3b)
    assert.deepEqual(race.plans[0].shown.map(r => r.has), ['0/6 have it', null]);
    assert.deepEqual(race.plans[0].shown.map(r => r.id), [ids.f3, ids.f2]);
    assert.deepEqual(race.plans[0].older.map(row),
        [[1, 'Wed 18 Nov 21:00', false, 'Same as v3', false, false]]);
    assert.deepEqual(race.plans[1].shown.map(row), [[1, 'Wed 18 Nov 21:02', false, 'Eva out · 2 targets', false, false]]);
    assert.deepEqual(race.plans[1].older, []);
    assert.deepEqual([v.sel, panelOf(v.panel), v.overLists], [{kind: 'none'},
        {kind: 'version', id: ids.f3, planId: ids.fast, date: DATE, isLive: true, over: false, base: {kind: 'self', id: ids.f3}, dflt: true, rv: DATE}, []]);
    // before the gate the live row has no count
    assert.equal(cockpitView(c, 'rollers', {now: T('2026-11-19T12:00:00Z')}).lists[0].plans[0].shown[0].has, null);
    assert.equal(v.received.length, 2);                         // the count, the hub and the 60 s reload: pushed plans only
    assert.equal(teamRow(v).received, '2 new plans');
    // teamView's answer is all there: the nearest race's view
    assert.deepEqual([v.slug, v.date, v.live.id, v.races.length], ['rollers', DATE, ids.f3, 1]);
    assert.equal(SHOWN_VERSIONS, 2);
});


test('the live version without liveAt reads "live"; the row summary compares the targets as shown', () => {
    const {club: c, ids, newId} = cockpitClub();
    delete c.sheets[ids.f3].liveAt;                              // stored before liveAt existed
    // a W/kg export of the live riders: 300 W over 70 kg is 4.3 W/kg, so the table marks no target
    const wkg = plan('Rollers fast', ['1001', '1002', '1003', '1004', '1005', '1006'].map(id => [id, 60, {pull_wkg: 4.3}]));
    const id = store(c, newId, null, '2026-11-19T18:15:00Z', {as: ids.fast, json: wkg});
    const [race] = cockpitView(c, 'rollers', {now: NOW}).lists;
    const shown = race.plans[0].shown;
    assert.deepEqual(shown.map(r => [r.id, r.live]), [[id, false], [ids.f3, true]]);
    assert.equal(shown[0].summary, 'Other details only');     // not "6 targets": 300 W and 4.3 W/kg show the same
});


test('the selection: one at a time; gone, another team\'s, an entry past its time', () => {
    const {club: c, ids} = cockpitClub();
    assert.deepEqual(sel(c, `v=${ids.f2}`), {kind: 'version', id: ids.f2});
    assert.deepEqual(sel(c, `e=${ids.e1}`), {kind: 'entry', id: ids.e1});
    assert.deepEqual(sel(c, `v=${ids.f2}&e=${ids.e1}`), {kind: 'version', id: ids.f2});
    assert.deepEqual(sel(c, ''), {kind: 'none'});
    for (const v of ['zzzzzz', ids.sp1, '__proto__', '']) {
        assert.deepEqual(sel(c, `v=${v}`), v === '' ? {kind: 'none'} : {kind: 'gone', what: 'version'}, v);
    }
    assert.deepEqual(sel(c, `v=&e=${ids.e1}`), {kind: 'entry', id: ids.e1});   // an empty v leaves e
    assert.deepEqual(sel(c, 'e=zzzzzz'), {kind: 'gone', what: 'entry'});
    assert.deepEqual(sel(c, 'e=__proto__'), {kind: 'gone', what: 'entry'});
    assert.deepEqual(sel(c, 'e='), {kind: 'none'});
    assert.deepEqual(sel(c, `e=${ids.e1}`, 'sprockets'), {kind: 'elsewhere', slug: 'rollers', id: ids.e1});
    assert.deepEqual(sel(c, `e=${ids.u1}`, 'rollers', T('2026-11-20T18:05:00Z')), {kind: 'entry', id: ids.u1});   // 24 h to the ms
    assert.deepEqual(sel(c, `e=${ids.u1}`, 'rollers', T('2026-11-20T18:05:00Z') + 1), {kind: 'gone', what: 'entry'});   // an upload: 24 h
    // an entry of no team (ruling F12: none can be made, deleteTeam removes them) answers like a gone one
    for (const team of [null, 'cogs']) {
        c.inbox.find(e => e.id === ids.e2).team = team;
        assert.deepEqual(sel(c, `e=${ids.e2}`), {kind: 'gone', what: 'entry'}, String(team));
    }
});


test('the panel: a version against live, the live version right after its switch and later, a race that is over', () => {
    const {club: c, ids} = cockpitClub();
    const panel = (q, now = NOW) => panelOf(cockpitView(c, 'rollers', {now, sel: sel(c, q, 'rollers', now)}).panel);
    assert.deepEqual(panel(`v=${ids.f2}`),
        {kind: 'version', id: ids.f2, planId: ids.fast, date: DATE, isLive: false, over: false, base: {kind: 'live', id: ids.f3}, dflt: false, rv: null});
    // the live version: against itself (no old lines) also two minutes after its switch (no Undo, user 23 Nov 2026)
    assert.deepEqual(panel(`v=${ids.f3}`),
        {kind: 'version', id: ids.f3, planId: ids.fast, date: DATE, isLive: true, over: false, base: {kind: 'self', id: ids.f3}, dflt: false, rv: DATE});
    assert.deepEqual(panel(''), {...panel(`v=${ids.f3}`), dflt: true});          // nothing picked: the same, opened
    assert.deepEqual(panel(`v=${ids.f3}`, NOW + 10 * 60000).base, {kind: 'self', id: ids.f3});
    assert.deepEqual(panel(`v=${ids.s1}`).base, {kind: 'live', id: ids.f3});     // another plan: against the race's live version
    const over = T('2026-11-19T20:30:00Z') + 1;                 // S 18:30Z + 2 h
    assert.equal(panel(`v=${ids.f2}`, over - 1).over, false);
    assert.equal(panel(`v=${ids.f2}`, over).over, true);
    const v = cockpitView(c, 'rollers', {now: over, sel: sel(c, `v=${ids.f2}`, 'rollers', over)});
    assert.deepEqual([v.overLists.map(r => [r.date, r.over, r.plans.length]), v.lists.map(r => [r.date, r.plans.length, r.pending.length])],
        [[[DATE, true, 2]], [['2026-11-26', 0, 3]]]);           // nothing ahead: the three plans not stored yet wait with the next regular race day
    assert.deepEqual([v.overLists[0].day, v.overLists[0].pending, v.lists[0].day, v.lists[0].over], ['Thu 19 Nov', [], 'Thu 26 Nov', false]);
    // the race that is over lists its versions the same way, the picked one marked
    assert.deepEqual(v.overLists[0].plans[0].shown.map(r => [r.n, r.picked]), [[3, false], [2, true]]);
    assert.deepEqual(panel(`e=${ids.e1}`), {kind: 'entry', id: ids.e1});
    // nothing live in the nearest race: "Nothing live for <day>" while it has plans; no card without any
    const none = structuredClone(c);
    none.teams.rollers.races[DATE].live = null;
    assert.deepEqual(cockpitView(none, 'rollers', {now: NOW}).panel, {kind: 'none', date: DATE, close: false});
    assert.equal(cockpitView(none, 'rollers', {now: NOW}).lists[0].plans.flatMap(p => p.shown).some(r => r.picked), false);
    assert.deepEqual(cockpitView(c, 'rollers', {now: over}).panel, {kind: 'blank'});        // nothing ahead with plans: no card
    assert.deepEqual(panel('v=zzzzzz'), {kind: 'gone', what: 'version'});
    assert.deepEqual(panel('e=zzzzzz'), {kind: 'gone', what: 'entry'});
    // another team's entry: the route sends the captain there (303); the panel never shows it here
    assert.deepEqual(cockpitView(c, 'sprockets', {now: NOW, sel: sel(c, `e=${ids.e1}`, 'sprockets')}).panel, {kind: 'gone', what: 'entry'});
    // the picked entry is marked in its row, the sel is passed through
    const picked = cockpitView(c, 'rollers', {now: NOW, sel: sel(c, `e=${ids.e1}`)});
    assert.deepEqual(picked.sel, {kind: 'entry', id: ids.e1});
    assert.deepEqual(picked.lists[0].pending.map(p => [p.id, p.picked]), [[ids.e2, false], [ids.e1, true], [ids.u1, false]]);
    assert.ok(picked.lists[0].plans.every(p => [...p.shown, ...p.older].every(r => !r.picked)));
});


test('the fold: two newest shown, the live and the picked row always, the notice on the live plan\'s newest', () => {
    const {club: c, ids, newId} = cockpitClub();
    // (a version the same as the newest would store nothing new: each has other riders)
    const f4 = store(c, newId, ['1001', '1002', '1003', '1004', '1005'], '2026-11-19T18:17:00Z', {as: ids.fast});
    makeLive(c, 'rollers', ids.f2, T('2026-11-19T18:18:00Z'));
    const f5 = store(c, newId, ['1001', '1002', '1003', '1004', '1005', '1007'], '2026-11-19T18:19:00Z', {as: ids.fast});
    const now = T('2026-11-19T18:20:00Z');
    const fast = v => v.lists[0].plans.find(p => p.planId === ids.fast);
    const ns = rs => rs.map(r => r.n);

    const v = cockpitView(c, 'rollers', {now});
    assert.deepEqual([ns(fast(v).shown), ns(fast(v).older)], [[5, 4, 2], [3, 1]]);
    assert.deepEqual(fast(v).shown.map(r => [r.id, r.live]), [[f5, false], [f4, false], [ids.f2, true]]);
    assert.deepEqual(fast(v).older.map(r => r.live), [false, false]);
    // v5: stored after v2 went live, never live: the notice; v4 is not the newest, the other plan none
    const all = v.lists[0].plans.flatMap(p => [...p.shown, ...p.older]);
    assert.deepEqual(all.filter(r => r.notice).map(r => r.id), [f5]);

    const picked = cockpitView(c, 'rollers', {now, sel: sel(c, `v=${ids.f1}`, 'rollers', now)});
    assert.deepEqual([ns(fast(picked).shown), ns(fast(picked).older)], [[5, 4, 2, 1], [3]]);
    assert.deepEqual(fast(picked).shown.map(r => r.picked), [false, false, false, true]);
    // a picked row among the two newest takes no extra slot
    const top = cockpitView(c, 'rollers', {now, sel: sel(c, `v=${f4}`, 'rollers', now)});
    assert.deepEqual([ns(fast(top).shown), ns(fast(top).older)], [[5, 4, 2], [3, 1]]);
    // v5 made live: no notice anywhere (it is the live one), v2 now "was live"
    makeLive(c, 'rollers', f5, T('2026-11-19T18:21:00Z'));
    const after = cockpitView(c, 'rollers', {now: T('2026-11-19T18:22:00Z')});
    assert.deepEqual(after.lists[0].plans.flatMap(p => [...p.shown, ...p.older]).filter(r => r.notice), []);
    assert.deepEqual([ns(fast(after).shown), ns(fast(after).older)], [[5, 4], [3, 2, 1]]);
});


test('a race that is over offers no newer-version notice', () => {
    const {club: c, ids, newId} = cockpitClub();
    // v4 of 'fast', stored after v3 went live and never live: the notice while the race is to race
    const f4 = store(c, newId, ['1001', '1002', '1003', '1004', '1005'], '2026-11-19T18:15:00Z', {as: ids.fast});
    const notices = v => [...v.lists, ...v.overLists].flatMap(r => r.plans.flatMap(p => [...p.shown, ...p.older])).filter(r => r.notice).map(r => r.id);
    const over = T('2026-11-19T20:30:00Z') + 1;                 // S 18:30Z + 2 h
    assert.deepEqual(notices(cockpitView(c, 'rollers', {now: over - 1})), [f4]);
    assert.deepEqual(notices(cockpitView(c, 'rollers', {now: over})), []);
    // the same version in the same place, only the race is over now: its row is in overLists, quiet
    assert.deepEqual(cockpitView(c, 'rollers', {now: over}).overLists[0].plans[0].shown.map(r => [r.id, r.notice]), [[f4, false], [ids.f3, false]]);

    // v2 made live a minute before the race is over: the table shows it as riders get it, before and after
    makeLive(c, 'rollers', ids.f2, over - 60000);
    const panel = now => cockpitView(c, 'rollers', {now, sel: sel(c, `v=${ids.f2}`, 'rollers', now)}).panel;
    assert.deepEqual([panel(over - 1).base, panel(over - 1).over], [{kind: 'self', id: ids.f2}, false]);
    assert.deepEqual([panel(over).base, panel(over).over], [{kind: 'self', id: ids.f2}, true]);
    // no row and no card carries anything of an Undo (user, 23 Nov 2026)
    const v = cockpitView(c, 'rollers', {now: over - 1, sel: sel(c, `v=${ids.f2}`, 'rollers', over - 1)});
    assert.equal(Object.hasOwn(v.panel, 'undo'), false);
    assert.ok([...v.lists, ...v.overLists].flatMap(r => r.plans.flatMap(p => [...p.shown, ...p.older])).every(r => !Object.hasOwn(r, 'undo')));
});


test('an upload not stored yet sits with the race it was made for, else with the nearest', () => {
    const {club: c, ids, newId} = cockpitClub();
    store(c, newId, ['1001', '1002', '1003'], '2026-11-19T18:01:00Z', {date: '2026-11-22', start: '18:00', type: 'sun'});
    const sun = upload(c, newId, '2026-11-19T18:13:00Z', {forDate: '2026-11-22'});
    const none = upload(c, newId, '2026-11-19T18:14:00Z', {forDate: '2026-11-12'});
    const plain = upload(c, newId, '2026-11-19T18:15:00Z');
    const v = cockpitView(c, 'rollers', {now: NOW});
    assert.deepEqual(v.lists.map(r => [r.date, r.day, r.plans.map(p => p.label)]),
        [[DATE, 'Thu 19 Nov', ['Rollers · fast', 'Rollers · slow']], ['2026-11-22', 'Sun 22 Nov', ['Rollers · sun']]]);
    assert.deepEqual(v.lists[1].pending.map(p => p.id), [sun]);
    assert.deepEqual(v.lists[0].pending.map(p => p.id), [plain, none, ids.e2, ids.e1, ids.u1]);   // every pushed plan here
    assert.equal(v.received.length, 2);                         // the uploads stay out of the count
    // pendingFor: the race an upload was made for while it is still to race, else null
    assert.deepEqual(pendingFor(c, 'rollers', NOW).map(p => [p.id, p.source, p.date]), [
        [plain, 'upload', null], [none, 'upload', null], [sun, 'upload', '2026-11-22'], [ids.e2, 'receive', null],
        [ids.e1, 'receive', null], [ids.u1, 'upload', DATE],
    ]);
    // once the 19 Nov race is over, u1 waits with the nearest race (now 22 Nov)
    const over = T('2026-11-19T20:30:00Z') + 1;
    const later = cockpitView(c, 'rollers', {now: over});
    assert.deepEqual(later.lists.map(r => r.date), ['2026-11-22']);
    assert.ok(later.lists[0].pending.some(p => p.id === ids.u1));
    assert.deepEqual(pendingFor(c, 'sprockets', NOW), []);
});


test('pendingFor: two entries of the same time, the later arrival first; an entry it cannot read still has a row', () => {
    const {club: c, newId} = cockpitClub();
    const a = upload(c, newId, '2026-11-19T18:15:00Z');
    const b = upload(c, newId, '2026-11-19T18:15:00Z');
    c.inbox.find(e => e.id === b).json = {riders: 'no'};
    const [first, second] = pendingFor(c, 'rollers', NOW);
    assert.deepEqual([first.id, second.id], [b, a]);
    assert.deepEqual([first.riders, first.line, first.name], [0, '0 riders', null]);
    assert.deepEqual([second.riders, second.line], [2, '2 riders (Ben, Cleo)']);
});
