// Fixture clubs for the team cockpit (team cockpit spec). Made-up names only (helpers.mjs).
import {club, sheet, planJson, T} from './helpers.mjs';
import {addTeam, uploadSheet, makeLive, receiveEntry, addEntry} from '../club.mjs';
import {makeClub} from './manage-helpers.mjs';

export const NOW = T('2026-11-19T18:16:00Z');      // Thu 19 Nov 19:16 in Berlin: Rollers' gate (19:00) is open
export const DATE = '2026-11-19';

const team = (name, start, live) => ({name, start, live, version: 1, changedAt: '2026-11-10T10:00:00.000Z'});

const ver = (team, plan, n, type, label, riders, uploadedAt) =>
    sheet({team, label, date: DATE, riders, uploadedAt, plan, n, type});


// Kettenfett RC with plans whose versions carry different types (as a Store as a version could
// leave them before schema 4): Rollers 19:30, live ra0002 (plan ra0001: v1 'fast', v2 none; plan
// rb0001: 'slow'); Sprockets 19:40, live sa0002 (plan sa0001: v1 none, v2 'late').
export function mixedTypes() {
    return club({
        teams: {rollers: team('Rollers', '19:30', 'ra0002'), sprockets: team('Sprockets', '19:40', 'sa0002')},
        sheets: {
            ra0001: ver('rollers', 'ra0001', 1, 'fast', 'Rollers · fast', ['1001', '1002'], '2026-11-18T20:00:00.000Z'),
            ra0002: ver('rollers', 'ra0001', 2, null, 'Rollers', ['1001', '1003'], '2026-11-19T10:00:00.000Z'),
            rb0001: ver('rollers', 'rb0001', 1, 'slow', 'Rollers · slow', ['1004'], '2026-11-18T20:02:00.000Z'),
            sa0001: ver('sprockets', 'sa0001', 1, null, 'Sprockets', ['1005'], '2026-11-18T20:05:00.000Z'),
            sa0002: ver('sprockets', 'sa0001', 2, 'late', 'Sprockets · late', ['1005', '1006'], '2026-11-19T10:05:00.000Z'),
        },
    });
}


// [type, label] of every version, by id.
export const typesOf = c => Object.fromEntries(Object.entries(c.sheets).map(([id, s]) => [id, [s.type ?? null, s.label]]));

// typesOf(mixedTypes()) once every plan has one type, that of its highest version.
export const ONE_TYPE = {
    ra0001: [null, 'Rollers'], ra0002: [null, 'Rollers'], rb0001: ['slow', 'Rollers · slow'],
    sa0001: ['late', 'Sprockets · late'], sa0002: ['late', 'Sprockets · late'],
};


// A planner export named `name`: rows [[zwiftId, pull seconds, {pull_power} | {pull_wkg} | undefined], …].
export function plan(name, rows) {
    const json = planJson(name, rows.map(([id]) => id));
    for (const [id, secs, extra] of rows) {
        Object.assign(json.riders[id], {pull_duration: secs}, extra ?? {});
    }
    return json;
}


// Kettenfett RC (the link cookie as makeClub's) with Rollers 19:30 and Sprockets 19:40, then the
// versions and entries of the cockpit spec's example, in this order (one id counter: c00001, c00002,
// …), all for DATE; every rider 60 s and 300 W unless said:
//   f1 Rollers 'fast' (live) 1001-1006 · s1 Rollers 'slow' 1001, 1002 at 280 W, 1003, 1005, 1006 ·
//   sp1 Sprockets (live) 1007 · f2, f3 versions of 'fast' (made live 17:57 and 18:14) 1002-1007 and
//   1001-1006 · e1, e2 pushed entries (ZwiftGopher; 'Rollers fast', 'Rollers slow') · u1 an upload
//   entry for 'fast' 1001-1005.
export function cockpitClub() {
    const made = makeClub({teams: []});
    const {club, cookie} = made;
    const setup = T('2026-11-10T10:00:00Z');
    for (const [name, start] of [['Rollers', '19:30'], ['Sprockets', '19:40']]) {
        addTeam(club, {name, start}, {slugTaken: () => false, now: setup});
    }
    let k = 0;
    const newId = () => `c${String(++k).padStart(5, '0')}`;
    const rows = (riders, power = {}) => riders.map(id => [id, 60, {pull_power: power[id] ?? 300}]);
    const store = (slug, name, riders, at, {as = 'new', type = null, live = false, power} = {}) => {
        const r = uploadSheet(club, {
            slug, json: plan(name, rows(riders, power)), text: null, date: DATE, base: club.teams[slug].version,
            via: 'file', type, as, live,
        }, {now: T(at), newId});
        return r.id;
    };
    const ids = {};
    ids.f1 = store('rollers', 'Rollers fast', ['1001', '1002', '1003', '1004', '1005', '1006'], '2026-11-18T20:00:00Z', {type: 'fast', live: true});
    ids.s1 = store('rollers', 'Rollers slow', ['1001', '1002', '1003', '1005', '1006'], '2026-11-18T20:02:00Z', {type: 'slow', power: {1001: 280, 1002: 280}});
    ids.sp1 = store('sprockets', 'Sprockets', ['1007'], '2026-11-18T20:05:00Z', {live: true});
    ids.f2 = store('rollers', 'Rollers fast', ['1002', '1003', '1004', '1005', '1006', '1007'], '2026-11-19T17:55:00Z', {as: ids.f1});
    makeLive(club, 'rollers', ids.f2, T('2026-11-19T17:57:00Z'));
    ids.f3 = store('rollers', 'Rollers fast', ['1001', '1002', '1003', '1004', '1005', '1006'], '2026-11-19T18:12:00Z', {as: ids.f1});
    makeLive(club, 'rollers', ids.f3, T('2026-11-19T18:14:00Z'));
    ids.fast = ids.f1;
    ids.slow = ids.s1;
    ids.e1 = receiveEntry(club, {
        team: 'rollers', via: 'zwiftgopher', json: plan('Rollers fast', rows(['1002', '1003', '1004', '1005', '1006', '1007'])), text: null,
    }, {now: T('2026-11-19T18:10:00Z'), newId});
    ids.e2 = receiveEntry(club, {
        team: 'rollers', via: 'zwiftgopher', json: plan('Rollers slow', rows(['1001', '1002', '1003', '1005'])), text: null,
    }, {now: T('2026-11-19T18:12:00Z'), newId});
    ids.u1 = addEntry(club, {
        source: 'upload', team: 'rollers', forPlan: ids.fast, forDate: DATE, via: 'file',
        json: plan('Rollers', rows(['1001', '1002', '1003', '1004', '1005'])), text: null,
    }, {now: T('2026-11-19T18:05:00Z'), newId});
    return {club, cookie, ids, newId};
}
