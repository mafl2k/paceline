import test from 'node:test';
import assert from 'node:assert/strict';
import {entryPlan, pickTeam, pickPlan, assignChoices, chosenDate, drawnStart, typeFromName} from '../preselect.mjs';
import {versionName} from '../plans.mjs';
import {rememberType} from '../plans.mjs';
import {club, sheet, planJson, T, race, setLive} from './helpers.mjs';
import {tidyRaces} from '../races.mjs';


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
    setLive(c, 'rollers', 'aa0002');
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
    setLive(c, 'rollers', 'aa0001');
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
    setLive(c, 'rollers', 'aa0001');
    assert.equal(pickPlan(c, 'rollers', entry({name: 'Rollers Thursday'}), NOW), null);
});

test('pickPlan: rider overlap never preselects (fast and slow share their riders)', () => {
    // one plan in the race sharing 8 of 8
    const c = club({teams: teams(), sheets: {aa0001: ver({jsonName: 'Rollers File'})}});
    setLive(c, 'rollers', 'aa0001');
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
    setLive(c, 'rollers', 'aa0001');
    // a plan for next week with the same planner name is no second match for this race
    assert.equal(pickPlan(c, 'rollers', entry({name: 'Rollers Thunder'}), NOW), 'aa0001');
    // an explicit date: 26 Nov's plan; 3 Dec has none
    assert.equal(pickPlan(c, 'rollers', entry({name: 'Rollers Thunder'}), NOW, '2026-11-26'), 'nx0001');
    assert.equal(pickPlan(c, 'rollers', entry({name: 'Other'}), NOW, '2026-12-03'), 'new');
    // last race's plan within S + 4 h (19:30 Berlin = 18:30Z, now 21:00Z): the page's race is
    // 26 Nov, and only its plan counts
    const late = T('2026-11-19T21:00Z');
    assert.equal(pickPlan(c, 'rollers', entry({name: 'Rollers Thunder'}), late), 'nx0001');
    // forPlan names no plan of a race that is over (S + 2 h, pre-flight M9: it takes no version),
    // though riders still get it: the page's race (26 Nov) decides
    assert.equal(pickPlan(c, 'rollers', entry({forPlan: 'aa0001', name: 'Other'}), late), null);
    // before it is over, forPlan still names it
    assert.equal(pickPlan(c, 'rollers', entry({forPlan: 'aa0001', name: 'Other'}), T('2026-11-19T20:30Z')), 'aa0001');
});

test('assignChoices: the race of the page\'s date scopes the preselection', () => {
    const c = club({teams: teams(), sheets: {
        aa0001: ver({jsonName: 'Rollers Thunder'}),
        nx0001: ver({date: '2026-11-26', jsonName: 'Rollers Thunder'}),
    }});
    setLive(c, 'rollers', 'aa0001');
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
    setLive(c, 'rollers', 'aa0001');
    const ch = assignChoices(c, entry({name: 'Other'}), params('team=rollers&drawn=rollers:&date=2026-11-26'), NOW);
    assert.equal(ch.as, 'new');
    assert.equal(ch.date, '2026-11-26');
    assert.equal(ch.typeNeeded, false);
    // no Make live box any more (user, 23 Nov 2026): Make live and Store are the bar's buttons
    assert.deepEqual(['live', 'liveKind', 'liveVars'].filter(k => Object.hasOwn(ch, k)), []);
});

test('pickPlan: two plans in the race and no forPlan or name: nothing (Ruling 15)', () => {
    const c = club({teams: teams(), sheets: {
        aa0001: ver(),
        bb0001: ver({type: 'slow', jsonName: 'Rollers Slow'}),
    }});
    setLive(c, 'rollers', 'aa0001');
    assert.equal(pickPlan(c, 'rollers', entry({name: 'Rollers Slow File', riders: EIGHT}), NOW), null);
});

test('pickPlan: no plan in the race is a new plan', () => {
    const c = club({teams: teams(), sheets: {old001: ver({date: '2026-11-12'})}});
    assert.equal(pickPlan(c, 'rollers', entry(), NOW), 'new');
    assert.equal(pickPlan(c, 'sprockets', entry(), NOW), 'new');
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
    setLive(c, 'rollers', 'aa0002');
    setLive(c, 'sprockets', 'st0001');
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
        id: 'aa0001', label: 'Kettenfett Rollers', date: '2026-11-19', day: 'Thu 19 Nov', n: 2, at: '2026-11-17T10:00:00.000Z',
        live: true, shared: 7, total: 8,
    }]);
    assert.deepEqual(['live', 'liveKind', 'liveVars'].filter(k => Object.hasOwn(ch, k)), []);
    assert.equal(ch.type, '');
    assert.equal(ch.date, '2026-11-19');
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

test('assignChoices: drawn keeps the type and the date', () => {
    const c = assignClub();
    const e = entry({name: 'Rollers fast'});
    const kept = q => assignChoices(c, e, params(`team=rollers&as=aa0001&drawn=rollers:aa0001${q}`), NOW);
    assert.equal(kept('&type=slow').type, 'slow');
    // the same without a matching drawn: the defaults
    const fresh = q => assignChoices(c, e, params(`team=rollers&as=aa0001${q}`), NOW);
    assert.equal(fresh('&drawn=rollers:new&type=slow').type, '');
    // a new plan: its type defaults to the plan's name without the team's (typeFromName; user, 23 Nov
    // 2026, replacing "never the JSON name"): 'Rollers fast' does not start with 'Kettenfett Rollers',
    // so all of it; its date is kept by drawn only
    const n = assignChoices(c, e, params('team=rollers&as=new'), NOW);
    assert.equal(n.type, 'Rollers fast');
    assert.equal(n.as, 'new');
    assert.equal(n.date, '2026-11-19');
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

test('assignChoices: a team change drops the old plan choice and re-defaults the type', () => {
    const c = assignClub();
    const e = entry({forPlan: 'aa0001', name: 'Sprockets File B'});
    const q = 'team=sprockets&as=aa0001&drawn=rollers:aa0001&live=on&type=slow';
    const ch = assignChoices(c, e, params(q), NOW);
    assert.equal(ch.team, 'sprockets');
    assert.equal(ch.as, pickPlan(c, 'sprockets', e, NOW));
    assert.equal(ch.as, 'sb0001');
    assert.equal(ch.drawn, 'sprockets:sb0001');
    assert.equal(ch.type, 'fast');
    assert.deepEqual(ch.types, []);
    // a page from before the box went may still send live in touched: only the type is kept
    const touched = assignChoices(c, e, params(`${q}&touched=type,live`), NOW);
    assert.equal(touched.as, 'sb0001');
    assert.equal(touched.type, 'slow');
    assert.equal(touched.touched, 'type');
    assert.equal(Object.hasOwn(touched, 'live'), false);
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

test('assignChoices: no team, no plan choice', () => {
    const c = assignClub();
    const ch = assignChoices(c, entry({team: null}), params('as=new&live=on&touched=live'), NOW);
    assert.equal(ch.team, null);
    assert.equal(ch.as, null);
    assert.deepEqual(ch.plans, []);
    assert.deepEqual(ch.types, []);
    assert.equal(ch.typeNeeded, false);
});

test('assignChoices: two plans in the race, nothing chosen', () => {
    const c = assignClub();
    c.sheets.bb0001 = {...ver({type: 'slow'}), plan: 'bb0001', at: '2026-11-18T10:00:00.000Z'};
    const ch = assignChoices(c, entry({name: 'Other'}), params(''), NOW);
    assert.equal(ch.as, null);
    assert.deepEqual(ch.plans.map(p => [p.id, p.live]), [['aa0001', true], ['bb0001', false]]);
});

test('assignChoices: a version takes its plan\'s date, whatever date is sent (user, 23 Nov 2026)', () => {
    const c = assignClub();
    const ch = assignChoices(c, entry(), params('team=rollers&as=aa0001&drawn=rollers:aa0001&date=2026-11-26'), NOW);
    assert.equal(ch.date, '2026-11-19');
});

test('assignChoices: a special team without a plan has no default date', () => {
    const c = club({teams: {...teams(), cogs: {name: 'Kettenfett Cogs', start: '19:30', live: null, kind: 'special', weekday: null}}});
    const e = entry({team: 'cogs', name: 'Kettenfett Cogs'});
    const ch = assignChoices(c, e, params('team=cogs&as=new&drawn=cogs:new'), NOW);
    assert.equal(ch.as, 'new');
    assert.equal(ch.date, '');
    assert.equal(ch.dateRequired, true);
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
    tidyRaces(c);
    const later = assignChoices(c, e, params('team=cogs&as=new&drawn=cogs:new'), NOW);
    assert.equal(later.date, '2026-12-06');
    assert.equal(later.dateRequired, false);
});


test('assignChoices: a special team\'s default date is its earliest race still to race', () => {
    const c = club({teams: {...teams(), cogs: {name: 'Kettenfett Cogs', start: '19:30', live: null, kind: 'special', weekday: null}}});
    const e = entry({team: 'cogs', name: 'Kettenfett Cogs'});
    for (const [id, date] of [['cc0001', '2026-12-06'], ['cc0002', '2026-11-29'], ['cc0003', '2026-11-18']]) {
        c.sheets[id] = {...ver({team: 'cogs', date, jsonName: 'Kettenfett Cogs', label: 'Kettenfett Cogs'}), plan: id};
    }
    tidyRaces(c);
    // the 18th is over; of 29 Nov and 6 Dec the earlier, also when the later one is live
    assert.equal(assignChoices(c, e, params('team=cogs&as=new&drawn=cogs:new'), NOW).date, '2026-11-29');
    setLive(c, 'cogs', 'cc0001');
    assert.equal(assignChoices(c, e, params(''), NOW).date, '2026-11-29');
    assert.equal(pickPlan(c, 'cogs', e, NOW), 'cc0002');
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
    tidyRaces(c);
    race(c, 'cogs', '2026-12-06').start = '20:15';
    assert.equal(assignChoices(c, e, params('team=cogs&as=new&drawn=cogs:new&date=2026-12-06'), NOW).start, '20:15');
    // typed over it for that date: the typed one (the newest upload sets the race's start)
    const typed = assignChoices(c, e, params(`${q}&startFor=2026-12-06`), NOW);
    assert.deepEqual([typed.date, typed.start], ['2026-12-06', '20:45']);
    // another date: the team's
    assert.equal(assignChoices(c, e, params('team=cogs&as=new&drawn=cogs:new&date=2026-12-13&start=20:15&startFor=2026-12-06'), NOW).start, '19:30');
    // a version: the plan's date, the race's start, editable
    const v = assignChoices(c, e, params('team=cogs&as=cc0001&drawn=cogs:cc0001&date=2026-12-13'), NOW);
    assert.deepEqual([v.date, v.start], ['2026-12-06', '20:15']);
    const vt = assignChoices(c, e, params('team=cogs&as=cc0001&drawn=cogs:cc0001&start=21:00&startFor=2026-12-06'), NOW);
    assert.equal(vt.start, '21:00');
    // a race without a start of its own (0.3.0): the team's
    race(c, 'cogs', '2026-12-06').start = null;
    assert.equal(assignChoices(c, e, params('team=cogs&as=cc0001&drawn=cogs:cc0001'), NOW).start, '19:30');
    // a weekly team has one too (races Task 7: `start` for every kind): typed for its date, else the
    // race's own, else the team's (prefilled, user 22 Nov 2026)
    const w = assignChoices(c, entry(), params('team=rollers&as=new&drawn=rollers:new&start=20:45&startFor=2026-11-19'), NOW);
    assert.deepEqual([w.special, w.start], [false, '20:45']);
    assert.equal(assignChoices(c, entry(), params('team=rollers&as=new&drawn=rollers:new'), NOW).start, '19:30');
});


test('assignChoices: `startWas`, the race start the page is drawn with; a typed time stays only while the race still has it (final review I-2)', () => {
    const c = club({teams: {...teams(), cogs: {name: 'Kettenfett Cogs', start: '19:30', live: null, kind: 'special', weekday: null}}});
    const e = entry({team: 'cogs', name: 'Kettenfett Cogs'});
    c.sheets.cc0001 = {...ver({team: 'cogs', date: '2026-12-06', jsonName: 'Kettenfett Cogs', label: 'Kettenfett Cogs', type: 'fast'}), plan: 'cc0001'};
    tidyRaces(c);
    // a special team: the race's own start, else the team's
    race(c, 'cogs', '2026-12-06').start = '20:15';
    const q = 'team=cogs&as=new&drawn=cogs:new&date=2026-12-06&startFor=2026-12-06';
    assert.equal(assignChoices(c, e, params(q), NOW).startWas, '20:15');
    assert.equal(drawnStart(c, 'cogs', '2026-12-06'), '20:15');
    // the time typed on a page drawn with the race's start as it is: kept
    assert.equal(assignChoices(c, e, params(`${q}&start=20:45&startWas=20:15`), NOW).start, '20:45');
    // the race's start changed since the page was drawn: the race's, as it is now
    const stale = assignChoices(c, e, params(`${q}&start=20:15&startWas=19:00`), NOW);
    assert.deepEqual([stale.start, stale.startWas], ['20:15', '20:15']);
    race(c, 'cogs', '2026-12-06').start = null;
    assert.equal(drawnStart(c, 'cogs', '2026-12-06'), '19:30');
    assert.equal(assignChoices(c, e, params(`${q}&start=20:15&startWas=20:15`), NOW).start, '19:30');
    // a weekly team: its race's own start, else the team's (prefilled, user 22 Nov 2026)
    assert.equal(drawnStart(c, 'rollers', '2026-11-19'), '19:30');
    c.sheets.rr0001 = {...ver({date: '2026-11-19'}), plan: 'rr0001'};
    tidyRaces(c);
    race(c, 'rollers', '2026-11-19').start = '18:30';
    assert.equal(drawnStart(c, 'rollers', '2026-11-19'), '18:30');
    assert.equal(assignChoices(c, entry(), params('team=rollers&as=new&drawn=rollers:new&start=20:45&startFor=2026-11-19&startWas=18:30'), NOW).start, '20:45');
    // the team's time changed since the page was drawn with it: the field echoes the old one, not kept
    race(c, 'rollers', '2026-11-19').start = null;
    c.teams.rollers.start = '20:00';
    assert.equal(assignChoices(c, entry(), params('team=rollers&as=new&drawn=rollers:new&start=19:30&startFor=2026-11-19&startWas=19:30'), NOW).start, '20:00');
});


// ---- the race choice (races spec §4 "Which race a new plan goes to"; races Task 7) ----

// The clock after Thursday's race: Rollers (weekly, Thursdays 19:30) has one race ahead, Sun 22 Nov
// at 18:00, with one plan; its rhythm date Thu 26 Nov has none yet.
const FRI = T('2026-11-20T10:00:00Z');
function sundayOnly() {
    const c = club({teams: {rollers: {name: 'Kettenfett Rollers', start: '19:30', live: null}}, sheets: {
        su0001: ver({date: '2026-11-22', jsonName: 'Rollers Sunday'}),
    }});
    race(c, 'rollers', '2026-11-22').start = '18:00';
    return c;
}
// a pushed plan whose planner name matches no stored plan
const pushed = () => ({...entry({name: 'Other'}), source: 'receive', via: 'zwiftgopher'});

test('assignChoices: a version keeps its plan and its race whatever race is sent; a new plan\'s race follows the radio (user, 23 Nov 2026)', () => {
    const c = sundayOnly();
    // (the race radios are in a new plan's race fold only: a version has its plan's race)
    const q = {team: 'rollers', as: 'su0001', drawn: 'rollers:su0001', startFor: '2026-11-22'};
    for (const race of ['2026-11-26', '2026-11-22']) {
        const ch = assignChoices(c, pushed(), params({...q, race}), FRI);
        assert.deepEqual([ch.date, ch.as], ['2026-11-22', 'su0001'], race);
    }
    const own = assignChoices(c, {...pushed(), forPlan: 'su0001'}, params({...q, race: '2026-11-26'}), FRI);
    assert.deepEqual([own.date, own.as], ['2026-11-22', 'su0001']);
    // a new plan: the race radio decides its race
    const fresh = assignChoices(c, pushed(), params({team: 'rollers', as: 'new', drawn: 'rollers:new', startFor: '2026-11-22', race: '2026-11-26'}), FRI);
    assert.deepEqual([fresh.date, fresh.as, fresh.startFor], ['2026-11-26', 'new', '2026-11-26']);
});

test('chosenDate: a typed date wins over the radio, the radio over the drawn date', () => {
    const of = o => chosenDate(new URLSearchParams(o));
    assert.equal(of({date: '2026-11-22', startFor: '2026-11-22', race: '2026-11-26'}), '2026-11-26');
    assert.equal(of({date: '2026-11-29', startFor: '2026-11-22', race: '2026-11-26'}), '2026-11-29');
    assert.equal(of({date: '2026-11-22'}), '2026-11-22');
    assert.equal(of({}), null);
    // a version's page has no date field: its race radio, else nothing
    assert.equal(of({startFor: '2026-11-22', race: '2026-11-26'}), '2026-11-26');
    assert.equal(of({startFor: '2026-11-22'}), null);
});

test('assignChoices: a weekly team with one extra race ahead still gets the choice: that race and its rhythm date', () => {
    // Rollers, Thursdays 19:30, one race: Sun 22 Nov 18:00; `entry`: a pushed plan whose planner name matches no stored plan
    const sunday = sundayOnly();
    const ch = assignChoices(sunday, pushed(), new URLSearchParams(), FRI);
    assert.deepEqual(ch.races.map(r => [r.date, r.time, r.plans]), [['2026-11-22', '18:00', 1], ['2026-11-26', '19:30', 0]]);
    assert.deepEqual(ch.races.map(r => r.day), ['Sun 22 Nov', 'Thu 26 Nov']);
    assert.deepEqual([ch.raceChoice, ch.date, ch.startFor], [true, '2026-11-22', '2026-11-22']);
    // one race ahead (the rhythm date only): no choice
    const lone = club({teams: {rollers: {name: 'Kettenfett Rollers', start: '19:30', live: null}}});
    const one = assignChoices(lone, pushed(), params(''), FRI);
    assert.deepEqual([one.races.map(r => [r.date, r.time, r.plans]), one.raceChoice], [[['2026-11-26', '19:30', 0]], false]);
    // a special team: its races only, no rhythm date
    const sp = club({teams: {cogs: {name: 'Kettenfett Cogs', start: null, live: null, kind: 'special', weekday: null}}, sheets: {
        cc0001: ver({team: 'cogs', date: '2026-11-29', jsonName: 'Kettenfett Cogs', label: 'Kettenfett Cogs'}),
    }});
    const cogs = assignChoices(sp, {...pushed(), team: 'cogs'}, params(''), FRI);
    assert.deepEqual([cogs.races.map(r => [r.date, r.time, r.plans]), cogs.raceChoice], [[['2026-11-29', null, 1]], false]);
});

test('assignChoices: the race the upload was made for (forDate) is the default while it is not over', () => {
    const c = sundayOnly();
    const forDate = date => ({...entry({name: 'Other'}), forDate: date});
    assert.deepEqual([assignChoices(c, forDate('2026-11-26'), params(''), FRI).date, assignChoices(c, forDate('2026-11-26'), params(''), FRI).as],
        ['2026-11-26', 'new']);
    // a date with no race yet, later than the next race: that date
    assert.equal(assignChoices(c, forDate('2026-12-03'), params(''), FRI).date, '2026-12-03');
    // a race that is over by now (the entry waited): the next race
    assert.equal(assignChoices(c, forDate('2026-11-19'), params(''), FRI).date, '2026-11-22');
    // another team chosen: its own default
    const two = club({teams: teams(), sheets: {su0001: ver({date: '2026-11-22'})}});
    assert.equal(assignChoices(two, forDate('2026-11-22'), params('team=sprockets&drawn=rollers:'), FRI).date, '2026-11-26');
    // a choice drawn for the page wins over it
    assert.equal(assignChoices(c, forDate('2026-11-26'), params('team=rollers&as=new&drawn=rollers:new&date=2026-11-22&startFor=2026-11-22'), FRI).date,
        '2026-11-22');
});

test('assignChoices: a weekly team\'s start time is the race\'s own, a typed one for its date only', () => {
    const c = sundayOnly();
    const e = entry({name: 'Other'});
    const q = 'team=rollers&as=new&drawn=rollers:new';
    assert.equal(assignChoices(c, e, params(`${q}&date=2026-11-22&startFor=2026-11-22`), FRI).start, '18:00');
    // the rhythm date has no time of its own: the team's, prefilled (user 22 Nov 2026)
    assert.equal(assignChoices(c, e, params(`${q}&date=2026-11-26&startFor=2026-11-26`), FRI).start, '19:30');
    assert.equal(assignChoices(c, e, params(`${q}&date=2026-11-22&startFor=2026-11-22&start=17:00`), FRI).start, '17:00');
    // typed for another date: that race's, here the team's
    assert.equal(assignChoices(c, e, params(`${q}&date=2026-11-22&startFor=2026-11-22&race=2026-11-26&start=17:00`), FRI).start, '19:30');
    // the date changed, the prefill follows it: the new date's race's own, else the team's
    assert.equal(assignChoices(c, e, params(`${q}&date=2026-11-26&startFor=2026-11-22&start=18:00`), FRI).start, '19:30');
    assert.equal(assignChoices(c, e, params(`${q}&date=2026-11-22&startFor=2026-11-26&start=19:30`), FRI).start, '18:00');
});

test('assignChoices: a plan of a race that is over is no choice (S + 2 h, before it is used up)', () => {
    // Thursday 19 Nov 19:30 Berlin (18:30Z); at 21:00Z it is over, though riders still get it
    const c = club({teams: teams(), sheets: {aa0001: ver(), nx0001: ver({date: '2026-11-26', type: 'next'})}});
    setLive(c, 'rollers', 'aa0001');
    const late = T('2026-11-19T21:00Z');
    const ch = assignChoices(c, entry({forPlan: 'aa0001', name: 'Other'}), params(''), late);
    assert.deepEqual(ch.plans.map(p => p.id), ['nx0001']);
    assert.notEqual(ch.as, 'aa0001');
    assert.equal(ch.date, '2026-11-26');
    // sent as the choice: not kept either
    assert.notEqual(assignChoices(c, entry({name: 'Other'}), params('team=rollers&as=aa0001&drawn=rollers:aa0001'), late).as, 'aa0001');
});


test('assignChoices: a redraw that names no race keeps the version, also with a forDate without a race (review I1)', () => {
    // Sprockets has one race, Thu 26 Nov; the upload was made for Thu 3 Dec, which has no race
    for (const kind of [{}, {kind: 'special', weekday: null}]) {
        const c = club({teams: {sprockets: {name: 'Kettenfett Sprockets', start: '19:40', live: null, ...kind}}, sheets: {
            sp0026: ver({team: 'sprockets', date: '2026-11-26', jsonName: 'Kettenfett Sprockets', label: 'Kettenfett Sprockets'}),
        }});
        const e = {...entry({team: 'sprockets', name: 'Other'}), forDate: '2026-12-03'};
        assert.equal(assignChoices(c, e, params(''), FRI).date, '2026-12-03', JSON.stringify(kind));
        // the captain picks the 26 Nov plan: a version's page sends no date and, with one race ahead,
        // no race radio
        const picked = assignChoices(c, e, params('team=sprockets&as=sp0026&drawn=sprockets:new&date=2026-12-03&startFor=2026-12-03'), FRI);
        assert.deepEqual([picked.as, picked.date, picked.startFor], ['sp0026', '2026-11-26', '2026-11-26']);
        const live = assignChoices(c, e, params('team=sprockets&as=sp0026&drawn=sprockets:sp0026&startFor=2026-11-26&start=19:40'), FRI);
        assert.deepEqual([live.as, live.date], ['sp0026', '2026-11-26'], JSON.stringify(kind));
    }
});

test('chosenDate: an emptied date field names no race; the checked radio wins (review M3)', () => {
    const of = o => chosenDate(new URLSearchParams(o));
    assert.equal(of({date: '', startFor: '2026-11-22', race: '2026-11-26'}), '2026-11-26');
    assert.equal(of({date: '', startFor: '2026-11-22', race: '2026-11-22'}), '2026-11-22');
    // no radio: the empty field as it is (the page then asks for a date)
    assert.equal(of({date: '', startFor: '2026-11-22'}), '');
});


test('typeFromName: the plan\'s name without the team\'s name at its start, else empty (user, 23 Nov 2026)', () => {
    for (const [name, type] of [
        ['Kettenfett Rollers slow', 'slow'], ['kettenfett rollers · fast', 'fast'], ['Kettenfett Rollers - tempo', 'tempo'],
        ['KETTENFETT ROLLERS: easy B', 'easy B'], ['Kettenfett Rollers–long', 'long'], ['  Kettenfett Rollers   sunday  ', 'sunday'],
        // only the team's name, or nothing: no type (the page shows "Plan")
        ['Kettenfett Rollers', ''], ['kettenfett rollers · ', ''], ['', ''], ['   ', ''],
        // another name: all of it, as a type; the team's name must end at a separator
        ['Morning group', 'Morning group'], ['Kettenfett Rollersfast', 'Kettenfett Rollersfast'],
    ]) {
        assert.equal(typeFromName('Kettenfett Rollers', name), type, JSON.stringify(name));
    }
    for (const name of [null, undefined, 7, {}]) {
        assert.equal(typeFromName('Kettenfett Rollers', name), '', String(name));
    }
    // capped at TYPE_MAX (30), then trimmed; a name the type rules refuse (a control character) gives none
    assert.equal(typeFromName('Kettenfett Rollers', `Kettenfett Rollers ${'x'.repeat(29)} y`), 'x'.repeat(29));
    assert.equal(typeFromName('Kettenfett Rollers', 'Kettenfett Rollers sl\u0007ow'), '');
});


test('assignChoices: a new plan\'s type comes prefilled from the name the plan came with (user, 23 Nov 2026)', () => {
    const c = club({teams: teams(), sheets: {}});
    const fresh = name => assignChoices(c, entry({name}), params('team=rollers&as=new&drawn=rollers:&date=2026-11-26'), NOW);
    assert.equal(fresh('Kettenfett Rollers slow').type, 'slow');
    assert.equal(fresh('Kettenfett Rollers').type, '');
    // a redraw of the same form keeps what the captain made of it, an emptied field too
    const kept = assignChoices(c, entry({name: 'Kettenfett Rollers slow'}), params('team=rollers&as=new&drawn=rollers:new&date=2026-11-26&type='), NOW);
    assert.equal(kept.type, '');
    // a type the race has already (typeFor would refuse it): left empty
    const date = fresh('Kettenfett Rollers slow').date;
    c.sheets.aa0001 = {...sheet({team: 'rollers', label: 'Kettenfett Rollers · slow', date, riders: EIGHT, uploadedAt: '2026-11-17T10:00:00.000Z'}), type: 'slow', plan: 'aa0001'};
    tidyRaces(c);
    assert.equal(fresh('Kettenfett Rollers SLOW').type, '');
    assert.equal(fresh('Kettenfett Rollers fast').type, 'fast');
});


test('versionName: a plan without a type reads "Plan" on the team page (user, 23 Nov 2026)', () => {
    assert.equal(versionName(null, 3), '\'Plan\' v3');
    assert.equal(versionName(undefined, 1), '\'Plan\' v1');
    assert.equal(versionName('fast', 2), '\'fast\' v2');
});
