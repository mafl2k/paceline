import test from 'node:test';
import assert from 'node:assert/strict';
import {entryPlan, pickTeam, pickPlan, liveDefault, assignChoices} from '../preselect.mjs';
import {rememberType} from '../plans.mjs';
import {club, sheet, planJson, T} from './helpers.mjs';


const NOW = T('2026-11-19T12:00Z');
const EIGHT = ['1001', '1002', '1003', '1004', '1005', '1006', '1007', '1008'];
const teams = () => ({
    rollers: {name: 'Kettenfett Rollers', start: '19:30', live: null},
    sprockets: {name: 'Kettenfett Sprockets', start: '19:40', live: null},
});

// A version of Kettenfett Rollers for 19 Nov by default. `jsonName` is the planner name it came
// with (the helper takes it from `label`); `label` is then the derived label.
function ver({jsonName = 'Kettenfett Rollers', label, ...extra} = {}) {
    const team = extra.team ?? 'rollers';
    const s = sheet({
        team, label: jsonName, date: '2026-11-19', riders: EIGHT, uploadedAt: '2026-11-17T10:00:00.000Z',
        ...extra,
    });
    const name = team === 'rollers' ? 'Kettenfett Rollers' : 'Kettenfett Sprockets';
    return {...s, label: label ?? (s.type === null ? name : `${name} · ${s.type}`)};
}

// An inbox entry: the planner export `name` with these riders.
const entry = ({team = 'rollers', forPlan = null, name = 'Kettenfett Rollers', riders = EIGHT, bench = []} = {}) =>
    ({team, forPlan, json: planJson(name, riders, bench), text: null});

const params = q => new URLSearchParams(q);


test('entryPlan: the riders, the bench and the planner name key', () => {
    const e = entry({name: 'Rollers Fast!', riders: ['1003', '1001'], bench: ['1009']});
    assert.deepEqual(entryPlan(e), {riders: ['1003', '1001'], bench: ['1009'], key: 'rollersfast'});
    assert.equal(entryPlan({...e, json: {...e.json, team: {}}}).key, null);
});


test('pickTeam: the entry\'s team, the only team, none', () => {
    const c = club({teams: teams()});
    assert.equal(pickTeam(c, entry({team: 'sprockets'})), 'sprockets');
    assert.equal(pickTeam(c, entry({team: 'gone'})), null);
    assert.equal(pickTeam(c, entry({team: null})), null);
    const one = club({teams: {rollers: teams().rollers}});
    assert.equal(pickTeam(one, entry({team: 'gone'})), 'rollers');
    assert.equal(pickTeam(one, entry({team: null})), 'rollers');
    assert.equal(pickTeam(club({teams: {}}), entry()), null);
});


test('pickPlan: forPlan of a race plan wins, also with two plans in the race', () => {
    const c = club({teams: teams(), sheets: {
        aa0001: ver({plan: 'aa0001'}),
        aa0002: ver({plan: 'aa0001', n: 2}),
        bb0001: ver({type: 'slow', riders: ['1009']}),
    }});
    c.teams.rollers.live = 'aa0002';
    // bb0001 shares no rider and has no matching name: only forPlan can choose it
    assert.equal(pickPlan(c, 'rollers', entry({forPlan: 'bb0001'}), NOW), 'bb0001');
    // any version id names its plan (Ruling 3)
    assert.equal(pickPlan(c, 'rollers', entry({forPlan: 'aa0002', name: 'Other'}), NOW), 'aa0001');
});

test('pickPlan: forPlan of another team or of a raced plan is ignored', () => {
    const c = club({teams: teams(), sheets: {
        aa0001: ver({jsonName: 'Rollers File'}),
        old001: ver({date: '2026-11-12', riders: ['1009']}),
        spr001: ver({team: 'sprockets', riders: ['1009']}),
    }});
    // the race has one plan, but no forPlan and no planner name choose it: nothing
    assert.equal(pickPlan(c, 'rollers', entry({forPlan: 'spr001', name: 'Other'}), NOW), null);
    assert.equal(pickPlan(c, 'rollers', entry({forPlan: 'old001', name: 'Other'}), NOW), null);
    // the planner name still applies after an ignored forPlan
    assert.equal(pickPlan(c, 'rollers', entry({forPlan: 'spr001', name: 'Rollers File'}), NOW), 'aa0001');
});

test('pickPlan: the remembered planner name within this race', () => {
    const c = club({teams: teams(), sheets: {
        aa0001: ver(),
        bb0001: ver({type: 'slow', jsonName: 'Rollers Slow File', riders: ['1009']}),
    }});
    c.teams.rollers.live = 'aa0001';
    assert.equal(pickPlan(c, 'rollers', entry({name: 'rollers  slow-file'}), NOW), 'bb0001');
    // a name held by any version of the plan
    c.sheets.bb0002 = {...ver({type: 'slow', jsonName: 'Rollers B', n: 2}), plan: 'bb0001'};
    assert.equal(pickPlan(c, 'rollers', entry({name: 'Rollers Slow File'}), NOW), 'bb0001');
    // last week's plan with that name does not count (decision 2): the race has no plan
    const last = club({teams: teams(), sheets: {
        old001: ver({date: '2026-11-12', jsonName: 'Rollers Slow File'}),
    }});
    assert.equal(pickPlan(last, 'rollers', entry({name: 'Rollers Slow File'}), NOW), 'new');
});

test('pickPlan: a planner name held by two plans of the race chooses nothing', () => {
    // fast and slow made from one planner file: no tie rule, not even the live plan
    const c = club({teams: teams(), sheets: {
        aa0001: ver({type: 'fast', jsonName: 'Rollers Thursday'}),
        bb0001: ver({type: 'slow', jsonName: 'Rollers Thursday'}),
    }});
    c.teams.rollers.live = 'aa0001';
    assert.equal(pickPlan(c, 'rollers', entry({name: 'Rollers Thursday'}), NOW), null);
});

test('pickPlan: rider overlap never preselects (fast and slow share their riders)', () => {
    // one plan in the race sharing 8 of 8
    const c = club({teams: teams(), sheets: {aa0001: ver({jsonName: 'Rollers File'})}});
    c.teams.rollers.live = 'aa0001';
    assert.equal(pickPlan(c, 'rollers', entry({name: 'Other', riders: EIGHT}), NOW), null);
    // two plans, 8 of 8 with the live one
    c.sheets.bb0001 = {...ver({type: 'slow', jsonName: 'Rollers Slow'}), plan: 'bb0001'};
    assert.equal(pickPlan(c, 'rollers', entry({name: 'Other', riders: EIGHT}), NOW), null);
    // a planner name without a key (non-Latin) matches nothing either
    assert.equal(pickPlan(c, 'rollers', entry({name: 'Ролики', riders: EIGHT}), NOW), null);
});

test('pickPlan: the race is the page\'s date, a plan of another date does not count', () => {
    const c = club({teams: teams(), sheets: {
        aa0001: ver({jsonName: 'Rollers Thunder'}),
        nx0001: ver({date: '2026-11-26', jsonName: 'Rollers Thunder'}),
    }});
    c.teams.rollers.live = 'aa0001';
    // a plan for next week with the same planner name is no second match for this race
    assert.equal(pickPlan(c, 'rollers', entry({name: 'Rollers Thunder'}), NOW), 'aa0001');
    // an explicit date: 26 Nov's plan; 3 Dec has none
    assert.equal(pickPlan(c, 'rollers', entry({name: 'Rollers Thunder'}), NOW, '2026-11-26'), 'nx0001');
    assert.equal(pickPlan(c, 'rollers', entry({name: 'Other'}), NOW, '2026-12-03'), 'new');
    // last race's plan within S + 4 h (19:30 Berlin = 18:30Z, now 21:00Z): the page's race is
    // 26 Nov, and only its plan counts
    const late = T('2026-11-19T21:00Z');
    assert.equal(pickPlan(c, 'rollers', entry({name: 'Rollers Thunder'}), late), 'nx0001');
    // forPlan still names any plan not used up
    assert.equal(pickPlan(c, 'rollers', entry({forPlan: 'aa0001', name: 'Other'}), late), 'aa0001');
});

test('assignChoices: the race of the page\'s date scopes the preselection', () => {
    const c = club({teams: teams(), sheets: {
        aa0001: ver({jsonName: 'Rollers Thunder'}),
        nx0001: ver({date: '2026-11-26', jsonName: 'Rollers Thunder'}),
    }});
    c.teams.rollers.live = 'aa0001';
    const e = entry({name: 'Rollers Thunder'});
    // the default race (19 Nov)
    assert.equal(assignChoices(c, e, params(''), NOW).as, 'aa0001');
    // a plan that is gone, drawn with the date 26 Nov: the 26 Nov race decides
    assert.equal(assignChoices(c, e, params('team=rollers&as=zz0001&drawn=rollers:zz0001&date=2026-11-26'), NOW).as,
        'nx0001');
    // the date without a matching drawn does not count
    assert.equal(assignChoices(c, e, params('team=rollers&as=zz0001&drawn=rollers:new&date=2026-11-26'), NOW).as,
        'aa0001');
    // both plans stay on the page
    assert.deepEqual(assignChoices(c, e, params(''), NOW).plans.map(p => p.id), ['aa0001', 'nx0001']);
});

test('assignChoices: the race picked for the plan is the date shown (I-1)', () => {
    // two plans on 19 Nov, nothing chosen; the captain sets 26 Nov
    const c = club({teams: teams(), sheets: {
        aa0001: ver(),
        bb0001: ver({type: 'slow'}),
    }});
    c.teams.rollers.live = 'aa0001';
    const ch = assignChoices(c, entry({name: 'Other'}), params('team=rollers&drawn=rollers:&date=2026-11-26'), NOW);
    assert.equal(ch.as, 'new');
    assert.equal(ch.date, '2026-11-26');
    assert.equal(ch.typeNeeded, false);
    assert.equal(ch.liveKind, 'other-race');
});

test('pickPlan: two plans in the race and no forPlan or name: nothing (Ruling 15)', () => {
    const c = club({teams: teams(), sheets: {
        aa0001: ver(),
        bb0001: ver({type: 'slow', jsonName: 'Rollers Slow'}),
    }});
    c.teams.rollers.live = 'aa0001';
    assert.equal(pickPlan(c, 'rollers', entry({name: 'Rollers Slow File', riders: EIGHT}), NOW), null);
});

test('pickPlan: no plan in the race is a new plan', () => {
    const c = club({teams: teams(), sheets: {old001: ver({date: '2026-11-12'})}});
    assert.equal(pickPlan(c, 'rollers', entry(), NOW), 'new');
    assert.equal(pickPlan(c, 'sprockets', entry(), NOW), 'new');
});


test('liveDefault: every row of the table', () => {
    const c = club({teams: teams(), sheets: {
        aa0001: ver({plan: 'aa0001'}),
        aa0004: ver({plan: 'aa0001', n: 4}),
        bb0001: ver({type: 'slow'}),
    }});
    // no live version
    assert.deepEqual(liveDefault(c, 'rollers', {as: null, date: '2026-11-19'}, NOW), {on: false, kind: 'pick', vars: {}});
    assert.deepEqual(liveDefault(c, 'rollers', {as: 'aa0001', date: '2026-11-19'}, NOW),
        {on: true, kind: 'none', vars: {team: 'Kettenfett Rollers'}});
    // a used-up live version
    c.sheets.old001 = {...ver({date: '2026-11-12'}), plan: 'old001'};
    c.teams.rollers.live = 'old001';
    assert.deepEqual(liveDefault(c, 'rollers', {as: 'new', date: '2026-11-19'}, NOW),
        {on: true, kind: 'none', vars: {team: 'Kettenfett Rollers'}});
    // the live plan, newest n 4
    c.teams.rollers.live = 'aa0004';
    assert.deepEqual(liveDefault(c, 'rollers', {as: 'aa0001', date: '2026-11-26'}, NOW),
        {on: true, kind: 'live-plan', vars: {n: 5, ln: 4}});
    assert.deepEqual(liveDefault(c, 'rollers', {as: 'aa0004', date: '2026-11-19'}, NOW),
        {on: true, kind: 'live-plan', vars: {n: 5, ln: 4}});
    // live is v1, v4 newer and not live
    c.teams.rollers.live = 'aa0001';
    assert.deepEqual(liveDefault(c, 'rollers', {as: 'aa0001', date: '2026-11-19'}, NOW),
        {on: true, kind: 'live-plan', vars: {n: 5, ln: 1}});
    c.teams.rollers.live = 'aa0004';
    // another plan of 19 Nov, and a new plan for 19 Nov
    assert.deepEqual(liveDefault(c, 'rollers', {as: 'bb0001', date: '2026-11-19'}, NOW),
        {on: false, kind: 'other-plan', vars: {label: 'Kettenfett Rollers', ln: 4}});
    assert.deepEqual(liveDefault(c, 'rollers', {as: 'new', date: '2026-11-19'}, NOW),
        {on: false, kind: 'new-plan', vars: {label: 'Kettenfett Rollers', ln: 4}});
    // the selection's slug matters: Sprockets has no live version
    assert.equal(liveDefault(c, 'sprockets', {as: 'new', date: '2026-11-19'}, NOW).kind, 'none');
});

test('liveDefault: a live plan of another race that is not used up', () => {
    const c = club({teams: teams(), sheets: {
        nx0001: ver({date: '2026-11-26', type: 'fast'}),
        bb0001: ver({type: 'slow'}),
    }});
    c.teams.rollers.live = 'nx0001';
    assert.deepEqual(liveDefault(c, 'rollers', {as: 'new', date: '2026-11-19'}, NOW),
        {on: false, kind: 'other-race', vars: {label: 'Kettenfett Rollers · fast', day: 'Thu 26 Nov'}});
    // a version: the plan's date counts, not the date sent
    assert.equal(liveDefault(c, 'rollers', {as: 'bb0001', date: '2026-11-26'}, NOW).kind, 'other-race');
    // a new plan for 26 Nov sits next to it
    assert.equal(liveDefault(c, 'rollers', {as: 'new', date: '2026-11-26'}, NOW).kind, 'new-plan');
});


// Rollers: live "Kettenfett Rollers" (typeless, 19 Nov, v1–v2). Sprockets: live "steady" (no rider
// in common) and "fast" with the planner name "Sprockets File B".
function assignClub() {
    const c = club({teams: teams(), sheets: {
        aa0001: ver({plan: 'aa0001'}),
        aa0002: ver({plan: 'aa0001', n: 2, riders: ['1001', '1002', '1003', '1004', '1005', '1006', '1007', '1009']}),
        st0001: ver({team: 'sprockets', type: 'steady', riders: ['1009']}),
        sb0001: ver({team: 'sprockets', type: 'fast', jsonName: 'Sprockets File B', riders: ['1009']}),
    }});
    c.teams.rollers.live = 'aa0002';
    c.teams.sprockets.live = 'st0001';
    rememberType(c.teams.rollers, 'slow');
    rememberType(c.teams.rollers, 'fast');
    return c;
}

test('assignChoices: the preselection, the plans and the defaults', () => {
    const c = assignClub();
    const e = entry({forPlan: 'aa0001', name: 'Sprockets File B'});
    const ch = assignChoices(c, e, params(''), NOW);
    assert.equal(ch.team, 'rollers');
    assert.deepEqual(ch.teams, [{slug: 'rollers', name: 'Kettenfett Rollers'}, {slug: 'sprockets', name: 'Kettenfett Sprockets'}]);
    assert.equal(ch.as, 'aa0001');
    assert.equal(ch.drawn, 'rollers:aa0001');
    assert.deepEqual(ch.plans, [{
        id: 'aa0001', label: 'Kettenfett Rollers', day: 'Thu 19 Nov', n: 2, at: '2026-11-17T10:00:00.000Z',
        live: true, shared: 7, total: 8,
    }]);
    assert.equal(ch.live, true);
    assert.equal(ch.liveKind, 'live-plan');
    assert.deepEqual(ch.liveVars, {n: 3, ln: 2});
    assert.equal(ch.type, '');
    assert.equal(ch.date, '2026-11-19');
    assert.equal(ch.dateFixed, true);
    assert.equal(ch.typeNeeded, false);
    assert.equal(ch.event, '');
    assert.deepEqual(ch.types, ['fast', 'slow']);
    // shared/total: the entry's riders in the newest version, of the entry's riders
    const nine = [...EIGHT, '1009'];
    assert.deepEqual(assignChoices(c, entry({name: 'Other', riders: nine}), params(''), NOW).plans
        .map(p => [p.shared, p.total]), [[8, 9]]);
    // the event link is always kept
    assert.equal(assignChoices(c, e, params('event=https://zwift.com/events/view/123'), NOW).event,
        'https://zwift.com/events/view/123');
});

test('assignChoices: drawn keeps the box, the type and the date', () => {
    const c = assignClub();
    const e = entry({name: 'Rollers fast'});
    const kept = q => assignChoices(c, e, params(`team=rollers&as=aa0001&drawn=rollers:aa0001${q}`), NOW);
    assert.equal(kept('').live, false);
    assert.equal(kept('&live=on').live, true);
    assert.equal(kept('&type=slow').type, 'slow');
    // the same without a matching drawn: the defaults
    const fresh = q => assignChoices(c, e, params(`team=rollers&as=aa0001${q}`), NOW);
    assert.equal(fresh('').live, true);
    assert.equal(fresh('&drawn=rollers:new&type=slow').type, '');
    // a new plan: its type defaults to '', never the JSON name; its date is kept by drawn only
    const n = assignChoices(c, e, params('team=rollers&as=new'), NOW);
    assert.equal(n.type, '');
    assert.equal(n.as, 'new');
    assert.equal(n.date, '2026-11-19');
    assert.equal(n.dateFixed, false);
    assert.equal(n.live, false);
    assert.equal(n.liveKind, 'new-plan');
    assert.equal(assignChoices(c, e, params('team=rollers&as=new&drawn=rollers:new&date=2026-11-26'), NOW).date,
        '2026-11-26');
    assert.equal(assignChoices(c, e, params('team=rollers&as=new&drawn=rollers:aa0001&date=2026-11-26'), NOW).date,
        '2026-11-19');
    assert.equal(assignChoices(c, e, params('team=rollers&as=new&touched=date&date=2026-11-26'), NOW).date,
        '2026-11-19');
    // the team's earlier types, most recent first
    assert.deepEqual(n.types, ['fast', 'slow']);
    // next to a typeless plan of the race a new plan needs a type; a version of that plan does not
    assert.equal(n.typeNeeded, true);
    assert.equal(kept('').typeNeeded, false);
    // a new plan for another race does not
    assert.equal(assignChoices(c, e, params('team=rollers&as=new&drawn=rollers:new&date=2026-11-26'), NOW).typeNeeded,
        false);
});

test('assignChoices: a team change drops the old plan choice and re-defaults live and type', () => {
    const c = assignClub();
    const e = entry({forPlan: 'aa0001', name: 'Sprockets File B'});
    const q = 'team=sprockets&as=aa0001&drawn=rollers:aa0001&live=on&type=slow';
    const ch = assignChoices(c, e, params(q), NOW);
    assert.equal(ch.team, 'sprockets');
    assert.equal(ch.as, pickPlan(c, 'sprockets', e, NOW));
    assert.equal(ch.as, 'sb0001');
    assert.equal(ch.drawn, 'sprockets:sb0001');
    const def = liveDefault(c, 'sprockets', {as: 'sb0001', date: ch.date}, NOW);
    assert.equal(def.on, false);
    assert.equal(ch.live, def.on);
    assert.equal(ch.liveKind, 'other-plan');
    assert.equal(ch.type, 'fast');
    assert.deepEqual(ch.types, []);
    const touched = assignChoices(c, e, params(`${q}&touched=type,live`), NOW);
    assert.equal(touched.as, 'sb0001');
    assert.equal(touched.type, 'slow');
    assert.equal(touched.live, true);
    // a Rollers plan id is never kept for Sprockets, also when drawn names Sprockets
    assert.equal(assignChoices(c, e, params('team=sprockets&as=aa0001&drawn=sprockets:aa0001'), NOW).as, 'sb0001');
    // a sent 'new' does not survive a team change either (M-2); it stays when drawn for Sprockets
    assert.equal(assignChoices(c, e, params('team=sprockets&as=new&drawn=rollers:aa0001'), NOW).as, 'sb0001');
    assert.equal(assignChoices(c, e, params('team=sprockets&as=new&drawn=rollers:new'), NOW).as, 'sb0001');
    assert.equal(assignChoices(c, e, params('team=sprockets&as=new&drawn=sprockets:sb0001'), NOW).as, 'new');
    // nor does a Sprockets plan id sent with the Rollers drawn
    assert.equal(assignChoices(c, entry({name: 'Other'}), params('team=sprockets&as=st0001&drawn=rollers:aa0001'), NOW).as,
        null);
    // an unknown team falls back to the entry's
    assert.equal(assignChoices(c, e, params('team=gone'), NOW).team, 'rollers');
});

test('assignChoices: with no plan chosen the box is off, whatever was sent', () => {
    const c = assignClub();
    c.sheets.bb0001 = {...ver({type: 'slow'}), plan: 'bb0001'};
    const e = entry({name: 'Other'});
    for (const q of ['live=on&touched=live', 'team=rollers&live=on&drawn=rollers:', 'team=rollers&live=on&drawn=rollers:&touched=live']) {
        const ch = assignChoices(c, e, params(q), NOW);
        assert.equal(ch.as, null, q);
        assert.equal(ch.live, false, q);
        assert.equal(ch.liveKind, 'pick', q);
    }
});

test('assignChoices: no team, no plan choice', () => {
    const c = assignClub();
    const ch = assignChoices(c, entry({team: null}), params('as=new&live=on&touched=live'), NOW);
    assert.equal(ch.team, null);
    assert.equal(ch.live, false);
    assert.equal(ch.as, null);
    assert.deepEqual(ch.plans, []);
    assert.deepEqual(ch.types, []);
    assert.equal(ch.liveKind, 'pick');
    assert.equal(ch.typeNeeded, false);
    assert.equal(ch.dateFixed, false);
});

test('assignChoices: two plans in the race, nothing chosen', () => {
    const c = assignClub();
    c.sheets.bb0001 = {...ver({type: 'slow'}), plan: 'bb0001', at: '2026-11-18T10:00:00.000Z'};
    const ch = assignChoices(c, entry({name: 'Other'}), params(''), NOW);
    assert.equal(ch.as, null);
    assert.equal(ch.live, false);
    assert.equal(ch.liveKind, 'pick');
    assert.deepEqual(ch.plans.map(p => [p.id, p.live]), [['aa0001', true], ['bb0001', false]]);
});

test('assignChoices: a version\'s date is fixed', () => {
    const c = assignClub();
    const ch = assignChoices(c, entry(), params('team=rollers&as=aa0001&drawn=rollers:aa0001&date=2026-11-26'), NOW);
    assert.equal(ch.date, '2026-11-19');
    assert.equal(ch.dateFixed, true);
});

test('assignChoices: a special team without a plan has no default date', () => {
    const c = club({teams: {...teams(), cogs: {name: 'Kettenfett Cogs', start: '19:30', live: null, kind: 'special', weekday: null}}});
    const e = entry({team: 'cogs', name: 'Kettenfett Cogs'});
    const ch = assignChoices(c, e, params('team=cogs&as=new&drawn=cogs:new'), NOW);
    assert.equal(ch.as, 'new');
    assert.equal(ch.date, '');
    assert.equal(ch.dateRequired, true);
    assert.equal(ch.dateFixed, false);
    // preselected (no plan in its race: a new plan), the same
    const pre = assignChoices(c, e, params(''), NOW);
    assert.equal(pre.as, 'new');
    assert.equal(pre.date, '');
    assert.equal(pre.dateRequired, true);
    // a date typed and redrawn stays, and the field stays required
    const typed = assignChoices(c, e, params('team=cogs&as=new&drawn=cogs:new&date=2026-12-06'), NOW);
    assert.equal(typed.date, '2026-12-06');
    assert.equal(typed.dateRequired, true);
    // a weekly team has its date and needs none
    const rollers = assignChoices(c, entry(), params('team=rollers&as=new&drawn=rollers:new'), NOW);
    assert.equal(rollers.date, '2026-11-19');
    assert.equal(rollers.dateRequired, false);
    // once Cogs has a plan still to race, its date
    c.sheets.cc0001 = {...ver({team: 'cogs', date: '2026-12-06', jsonName: 'Kettenfett Cogs', label: 'Kettenfett Cogs'}), plan: 'cc0001'};
    const later = assignChoices(c, e, params('team=cogs&as=new&drawn=cogs:new'), NOW);
    assert.equal(later.date, '2026-12-06');
    assert.equal(later.dateRequired, false);
});


test('assignChoices: a special team\'s start time (user, 19 Nov 2026)', () => {
    const c = club({teams: {...teams(), cogs: {name: 'Kettenfett Cogs', start: null, live: null, kind: 'special', weekday: null}}});
    const e = entry({team: 'cogs', name: 'Kettenfett Cogs'});
    // nothing to go by: empty
    const none = assignChoices(c, e, params(''), NOW);
    assert.deepEqual([none.special, none.start], [true, '']);
    // the team's start time (a team that was weekly before)
    c.teams.cogs.start = '19:30';
    assert.equal(assignChoices(c, e, params(''), NOW).start, '19:30');
    // a time typed and redrawn for this very date (startFor) stays; for another plan choice or
    // another date it goes: no carry-over
    const q = 'team=cogs&as=new&drawn=cogs:new&date=2026-12-06&start=20:45';
    assert.equal(assignChoices(c, e, params(`${q}&startFor=2026-12-06`), NOW).start, '20:45');
    assert.equal(assignChoices(c, e, params(`${q}&startFor=2026-11-29`), NOW).start, '19:30');
    assert.equal(assignChoices(c, e, params(q), NOW).start, '19:30');
    assert.equal(assignChoices(c, e, params('team=cogs&as=new&drawn=rollers:new&date=2026-12-06&start=20:45&startFor=2026-12-06'), NOW).start, '19:30');
    // the race's stored start for that date
    c.sheets.cc0001 = {...ver({team: 'cogs', date: '2026-12-06', jsonName: 'Kettenfett Cogs', label: 'Kettenfett Cogs', type: 'fast'}), plan: 'cc0001'};
    c.teams.cogs.raceStarts = {'2026-12-06': '20:15'};
    assert.equal(assignChoices(c, e, params('team=cogs&as=new&drawn=cogs:new&date=2026-12-06'), NOW).start, '20:15');
    // typed over it for that date: the typed one (the newest upload sets the race's start)
    const typed = assignChoices(c, e, params(`${q}&startFor=2026-12-06`), NOW);
    assert.deepEqual([typed.date, typed.start], ['2026-12-06', '20:45']);
    // another date: the team's
    assert.equal(assignChoices(c, e, params('team=cogs&as=new&drawn=cogs:new&date=2026-12-13&start=20:15&startFor=2026-12-06'), NOW).start, '19:30');
    // a version: the plan's date, the race's start, editable
    const v = assignChoices(c, e, params('team=cogs&as=cc0001&drawn=cogs:cc0001&date=2026-12-13'), NOW);
    assert.deepEqual([v.date, v.dateFixed, v.start], ['2026-12-06', true, '20:15']);
    const vt = assignChoices(c, e, params('team=cogs&as=cc0001&drawn=cogs:cc0001&start=21:00&startFor=2026-12-06'), NOW);
    assert.equal(vt.start, '21:00');
    // a race without a start of its own (0.3.0): the team's
    delete c.teams.cogs.raceStarts;
    assert.equal(assignChoices(c, e, params('team=cogs&as=cc0001&drawn=cogs:cc0001'), NOW).start, '19:30');
    // a weekly team never has one
    const w = assignChoices(c, entry(), params('team=rollers&as=new&drawn=rollers:new&start=20:45&startFor=2026-11-19'), NOW);
    assert.deepEqual([w.special, w.start], [false, '']);
});
