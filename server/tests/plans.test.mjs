import test from 'node:test';
import assert from 'node:assert/strict';
import {
    SHARED_SHARE, isUsed, plansOf, planLabel, typeKey, rememberType, teamTypes, racePlans, planOfId,
    previousVersion, planNames, ridersShared, freeVersionId,
} from '../plans.mjs';
import {isUsed as isUsedViaClub} from '../club.mjs';
import {club, sheet, T} from './helpers.mjs';


const EIGHT = ['1001', '1002', '1003', '1004', '1005', '1006', '1007', '1008'];
const teams = () => ({
    rollers: {name: 'Kettenfett Rollers', start: '19:30', live: null},
    sprockets: {name: 'Kettenfett Sprockets', start: '19:40', live: null},
});

// A version of Kettenfett Rollers by default; `extra` overrides the builder's fields.
function ver(extra = {}) {
    return sheet({
        team: 'rollers', label: 'Kettenfett Rollers', date: '2026-11-19', riders: EIGHT,
        uploadedAt: '2026-11-17T10:00:00.000Z', ...extra,
    });
}


test('plansOf: versions grouped by plan, n ascending, newest and live', () => {
    const c = club({
        teams: teams(),
        sheets: {
            aa0002: ver({plan: 'aa0001', n: 2, label: 'Kettenfett Rollers · fast', type: 'fast'}),
            aa0001: ver({plan: 'aa0001', n: 1}),
            bb0001: ver({plan: 'bb0001'}),
            cc0001: ver({team: 'sprockets', label: 'Kettenfett Sprockets'}),
        },
    });
    c.teams.rollers.live = 'aa0001';
    const plans = plansOf(c, 'rollers');
    assert.equal(plans.length, 2);
    const a = plans.find(p => p.id === 'aa0001');
    assert.deepEqual(a.versions.map(([id]) => id), ['aa0001', 'aa0002']);
    assert.equal(a.newest[0], 'aa0002');
    assert.equal(a.live, 'aa0001');
    assert.equal(a.label, 'Kettenfett Rollers · fast');
    assert.equal(a.type, 'fast');
    assert.equal(a.team, 'rollers');
    assert.equal(a.date, '2026-11-19');
    const b = plans.find(p => p.id === 'bb0001');
    assert.equal(b.live, null);
    assert.equal(plans.some(p => p.versions.some(([id]) => id === 'cc0001')), false);
});

test('plansOf: a live pointer outside the plan is null', () => {
    const c = club({teams: teams(), sheets: {aa0001: ver()}});
    c.teams.rollers.live = 'zz0001';
    assert.equal(plansOf(c, 'rollers')[0].live, null);
});

test('racePlans: this race only, the live plan first, then the newest', () => {
    const NOW = T('2026-11-19T12:00Z');
    const c = club({
        teams: teams(),
        sheets: {
            old001: ver({date: '2026-11-12'}),
            liv001: ver({uploadedAt: '2026-11-17T10:00:00.000Z'}),
            new001: ver({uploadedAt: '2026-11-18T10:00:00.000Z'}),
            mid001: ver({uploadedAt: '2026-11-17T20:00:00.000Z'}),
            spr001: ver({team: 'sprockets'}),
        },
    });
    c.teams.rollers.live = 'liv001';
    assert.deepEqual(racePlans(c, 'rollers', NOW).map(p => p.id), ['liv001', 'new001', 'mid001']);
});

test('racePlans: a plan whose newest version is used up is left out', () => {
    const NOW = T('2026-11-19T12:00Z');
    const c = club({teams: teams(), sheets: {
        aa0001: ver({plan: 'aa0001', date: '2026-11-12'}),
        aa0002: ver({plan: 'aa0001', n: 2}),
    }});
    assert.deepEqual(racePlans(c, 'rollers', NOW).map(p => p.id), ['aa0001']);
});

test('planOfId: a plan by its id or any version id, only of that team', () => {
    const c = club({teams: teams(), sheets: {
        aa0002: ver({plan: 'aa0001', n: 2}),
    }});
    assert.equal(planOfId(c, 'rollers', 'aa0002').id, 'aa0001');
    assert.equal(planOfId(c, 'rollers', 'aa0001').id, 'aa0001');
    assert.equal(planOfId(c, 'sprockets', 'aa0001'), null);
    assert.equal(planOfId(c, 'rollers', 'zzzzzz'), null);
});

test('previousVersion: the highest n below, skipping dropped ones', () => {
    const c = club({teams: teams(), sheets: {
        aa0001: ver({plan: 'aa0001', n: 1}),
        aa0003: ver({plan: 'aa0001', n: 3}),
        aa0004: ver({plan: 'aa0001', n: 4}),
        bb0009: ver({plan: 'bb0001', n: 2}),
    }});
    assert.equal(previousVersion(c, 'aa0004')[0], 'aa0003');
    assert.equal(previousVersion(c, 'aa0003')[0], 'aa0001');
    assert.equal(previousVersion(c, 'aa0001'), null);
    assert.equal(previousVersion(c, 'bb0009'), null);
    assert.equal(previousVersion(c, 'nope00'), null);
});

test('planNames: the planner names only', () => {
    const c = club({teams: teams(), sheets: {
        aa0001: ver({plan: 'aa0001', n: 1, label: 'Rollers fast'}),
        aa0002: ver({plan: 'aa0001', n: 2, label: 'Kettenfett Rollers · A', type: 'A'}),
    }});
    c.sheets.aa0002.jsonName = null;
    assert.deepEqual(planNames(plansOf(c, 'rollers')[0]), new Set(['rollersfast']));
});

test('planLabel and typeKey', () => {
    assert.equal(planLabel('Rollers', null), 'Rollers');
    assert.equal(planLabel('Rollers', 'fast'), 'Rollers · fast');
    assert.equal(typeKey('  Fast  Lane '), 'fast lane');
    assert.equal(typeKey(null), '');
});

test('rememberType and teamTypes: most recent first, distinct, at most 10', () => {
    const c = club({teams: teams()});
    const team = c.teams.rollers;
    assert.deepEqual(teamTypes(c, 'rollers'), []);
    for (const t of ['slow', 'fast', null, 'Fast']) {
        rememberType(team, t);
    }
    assert.deepEqual(teamTypes(c, 'rollers'), ['Fast', 'slow']);

    const many = club({teams: teams()});
    for (let i = 1; i <= 12; i++) {
        rememberType(many.teams.rollers, `type ${i}`);
    }
    const kept = teamTypes(many, 'rollers');
    assert.equal(kept.length, 10);
    assert.equal(kept[0], 'type 12');
    assert.equal(kept.includes('type 1'), false);
    assert.equal(kept.includes('type 2'), false);
    assert.equal(kept.includes('type 3'), true);

    assert.deepEqual(teamTypes(c, 'sprockets'), []);
    rememberType(c.teams.sprockets, 'only sprockets');
    assert.deepEqual(teamTypes(c, 'rollers'), ['Fast', 'slow']);
    assert.deepEqual(teamTypes(c, 'sprockets'), ['only sprockets']);
});

test('rememberType: null changes nothing and creates no array', () => {
    const c = club({teams: teams()});
    const team = c.teams.rollers;
    rememberType(team, null);
    assert.equal(team.types, undefined);
    rememberType(team, 'slow');
    rememberType(team, null);
    assert.deepEqual(team.types, ['slow']);
});

test('teamTypes: a damaged value is no suggestions', () => {
    const c = club({teams: teams()});
    c.teams.rollers.types = 'fast';
    assert.deepEqual(teamTypes(c, 'rollers'), []);
    c.teams.rollers.types = ['fast', 7];
    assert.deepEqual(teamTypes(c, 'rollers'), []);
    assert.deepEqual(teamTypes(c, 'nobody'), []);
});

test('ridersShared: riders only, not bench', () => {
    const s = ver({riders: EIGHT, bench: ['1009']});
    assert.deepEqual(ridersShared(s, ['1001', '1002', '1009']), {shared: 2, total: 8});
});

test('freeVersionId: never a version id or a plan id', () => {
    const c = club({teams: teams(), sheets: {aa0002: ver({plan: 'aa0001', n: 2})}});
    const draws = ['aa0001', 'aa0002', 'c3c3c3'];
    assert.equal(freeVersionId(c, () => draws.shift()), 'c3c3c3');
    assert.throws(() => freeVersionId(c, () => 'aa0002'), /no free version id/);
    const calls = [];
    assert.throws(() => freeVersionId(c, () => (calls.push(1), 'aa0001')));
    assert.equal(calls.length, 20);
    const bad = ['TOOLONG', 'ab', 'd4d4d4'];
    assert.equal(freeVersionId(c, () => bad.shift()), 'd4d4d4');
});

test('isUsed: a team without a start time is used up once its date has passed', () => {
    const c = club({teams: {rollers: {name: 'Kettenfett Rollers', start: null, live: null}}, sheets: {aa0001: ver()}});
    const s = c.sheets.aa0001;
    assert.equal(isUsed(c, s, T('2026-11-19T22:30Z')), false);   // 23:30 in Berlin, still 19 Nov
    assert.equal(isUsed(c, s, T('2026-11-19T23:30Z')), true);    // 00:30 on 20 Nov in Berlin
    assert.equal(isUsed(c, s, T('2026-11-18T12:00Z')), false);
});

test('isUsed and SHARED_SHARE: moved here, club.mjs still exports isUsed', () => {
    assert.equal(isUsedViaClub, isUsed);
    assert.equal(SHARED_SHARE, 0.6);
    const c = club({teams: teams(), sheets: {aa0001: ver()}});
    assert.equal(isUsed(c, c.sheets.aa0001, T('2026-11-19T12:00Z')), false);
    assert.equal(isUsed(c, c.sheets.aa0001, T('2026-11-20T00:00Z')), true);
});
