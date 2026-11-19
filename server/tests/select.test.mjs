import test from 'node:test';
import assert from 'node:assert/strict';
import {
    LEARNED_MS, USED_UP_MS, PLAN_OPEN_MS, planOpen, plannedStart, usedUp, roleIn, matchesEvent, servable, pickForRider, datePicks,
    effects, outdated, nextRaceDate, teamWeekday, STILL_TO_RACE_MS, startOf, raceStart, raceStartAt, stillToRace,
} from '../select.mjs';
import {club, sheet, T} from './helpers.mjs';


const DATE = '2026-11-19';
const NOW = T('2026-11-19T11:00:00Z');
const MIN = 60000;
const HOUR = 3600000;

const team = (name, start, live = null) => ({name, start, live, version: 1, undo: null});
const rollers = (live, start = '19:30') => team('Kettenfett Rollers', start, live);
const sprockets = (live, start = '19:40') => team('Kettenfett Sprockets', start, live);


test('plannedStart and usedUp', () => {
    const c = club({
        teams: {rollers: rollers('ra0001'), owls: team('Kettenfett Owls', null, 'wa0001')},
        sheets: {
            ra0001: sheet({team: 'rollers', label: 'Rollers fast', date: DATE, riders: ['1001'], uploadedAt: '2026-11-19T16:00:00.000Z'}),
            wa0001: sheet({team: 'owls', label: 'Owls', date: DATE, riders: ['1001'], uploadedAt: '2026-11-19T16:00:00.000Z'}),
        },
    });
    const S = plannedStart(c, c.sheets.ra0001);
    assert.equal(S, T('2026-11-19T18:30:00Z'));
    assert.equal(plannedStart(c, c.sheets.wa0001), null);
    assert.equal(plannedStart(c, {...c.sheets.ra0001, date: '2026-02-30'}), null);
    assert.equal(plannedStart(c, {...c.sheets.ra0001, team: 'gone'}), null);
    assert.equal(plannedStart(c, {...c.sheets.ra0001, team: '__proto__'}), null);
    assert.equal(usedUp(S, S + 4 * 3600000), false);
    assert.equal(usedUp(S, S + 4 * 3600000 + 1), true);
    assert.equal(USED_UP_MS, 4 * HOUR);
    assert.deepEqual(servable(c, NOW).map(x => [x.slug, x.id, x.S]), [['rollers', 'ra0001', S]]);
    assert.deepEqual(servable(c, S + USED_UP_MS + 1), []);
});


test('roleIn: rider, bench or nothing, own keys only', () => {
    const s = sheet({team: 'rollers', label: 'Rollers', date: DATE, riders: ['1001', '1002'], bench: ['1003'], uploadedAt: '2026-11-19T16:00:00.000Z'});
    assert.equal(roleIn(s, '1001'), 'rider');
    assert.equal(roleIn(s, '1003'), 'bench');
    assert.equal(roleIn(s, '1004'), null);
    for (const k of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
        assert.equal(roleIn(s, k), null, k);
    }
});


const at1830 = (extra = {}) => sheet({team: 'rollers', label: 'Rollers', date: DATE, riders: ['1001'], uploadedAt: '2026-11-19T16:00:00.000Z', ...extra});


test('matchesEvent: the window', () => {
    const s = at1830();
    const S = T('2026-11-19T18:30:00Z');
    assert.equal(matchesEvent(s, S, {E: S + 30 * MIN, eventId: null}), true);
    assert.equal(matchesEvent(s, S, {E: S + 31 * MIN, eventId: null}), false);
    assert.equal(matchesEvent(s, S, {E: S - 60 * MIN, eventId: null}), true);
    assert.equal(matchesEvent(s, S, {E: S - 61 * MIN, eventId: null}), false);
});


test('matchesEvent: a learned id within ±4 h only', () => {
    const s = at1830({eventId: 4567890});
    const S = T('2026-11-19T18:30:00Z');
    assert.equal(matchesEvent(s, S, {E: S + 3 * HOUR, eventId: 4567890}), true);
    assert.equal(matchesEvent(s, S, {E: S - 5 * HOUR, eventId: 4567890}), false);
    assert.equal(matchesEvent(s, S, {E: S + 3 * HOUR, eventId: 4567891}), false);
    // the edges of ±4 h
    assert.equal(matchesEvent(s, S, {E: S + LEARNED_MS, eventId: 4567890}), true);
    assert.equal(matchesEvent(s, S, {E: S - LEARNED_MS - 1, eventId: 4567890}), false);
    // no learned id: a missing request id does not match it
    assert.equal(matchesEvent(at1830(), S, {E: S + 3 * HOUR, eventId: null}), false);
});


test('matchesEvent: a pinned id only', () => {
    const S = T('2026-11-19T18:30:00Z');
    const s = at1830({pinnedEventId: 4567890});
    assert.equal(matchesEvent(s, S, {E: S + 10 * HOUR, eventId: 4567890}), true);
    assert.equal(matchesEvent(s, S, {E: S, eventId: 4567891}), false);
    assert.equal(matchesEvent(s, S, {E: S, eventId: null}), false);
    const learned = at1830({pinnedEventId: 4567890, eventId: 4567891});
    assert.equal(matchesEvent(learned, S, {E: S, eventId: 4567891}), false);
});


// Ben (1001) rides in Rollers 19:30 and in Sprockets 19:40.
function staggered({rollersAt = '2026-11-19T16:00:00.000Z', sprocketsAt = '2026-11-19T16:30:00.000Z', benOnBench = false} = {}) {
    return club({
        teams: {rollers: rollers('ra0001'), sprockets: sprockets('sa0001')},
        sheets: {
            ra0001: sheet({team: 'rollers', label: 'Rollers fast', date: DATE, riders: ['1001', '1002', '1003'], uploadedAt: rollersAt}),
            sa0001: sheet({
                team: 'sprockets', label: 'Sprockets', date: DATE,
                riders: benOnBench ? ['1004', '1005'] : ['1001', '1004', '1005'], bench: benOnBench ? ['1001'] : [],
                uploadedAt: sprocketsAt,
            }),
        },
    });
}


test('pickForRider: precedence across a date\'s sheets with different team times', () => {
    const c = staggered();
    const out = pickForRider(c, '1001', {now: NOW});
    assert.equal(out.slug, 'sprockets');
    assert.equal(out.id, 'sa0001');
    assert.equal(out.role, 'rider');
    assert.equal(out.S, T('2026-11-19T18:40:00Z'));
    assert.equal(out.sheet, c.sheets.sa0001);
    assert.deepEqual(Object.keys(out).sort(), ['S', 'id', 'role', 'sheet', 'slug']);
    assert.equal(pickForRider(c, '1001', {now: NOW, E: T('2026-11-19T18:31:00Z'), eventId: 4567890}).slug, 'sprockets');

    const bench = staggered({benOnBench: true});
    assert.equal(pickForRider(bench, '1001', {now: NOW}).slug, 'rollers');
    assert.equal(pickForRider(bench, '1001', {now: NOW, E: T('2026-11-19T18:31:00Z'), eventId: 4567890}).slug, 'rollers');
    assert.equal(pickForRider(bench, '1001', {now: NOW}).role, 'rider');

    const tie = staggered({sprocketsAt: '2026-11-19T16:00:00.000Z'});
    assert.equal(pickForRider(tie, '1001', {now: NOW}).slug, 'rollers');
    assert.equal(pickForRider(tie, '1001', {now: NOW, E: T('2026-11-19T18:31:00Z'), eventId: 4567890}).slug, 'rollers');

    assert.equal(pickForRider(c, '1009', {now: NOW}), null);
    assert.equal(pickForRider(c, '__proto__', {now: NOW}), null);
});


test('pickForRider: a bench listing is served when nothing else lists the rider', () => {
    const c = staggered({benOnBench: true});
    c.sheets.ra0001 = sheet({team: 'rollers', label: 'Rollers fast', date: DATE, riders: ['1002'], uploadedAt: '2026-11-19T16:00:00.000Z'});
    const out = pickForRider(c, '1001', {now: NOW});
    assert.equal(out.slug, 'sprockets');
    assert.equal(out.role, 'bench');
});


test('pickForRider: the date closest to the event', () => {
    const c = club({
        teams: {rollers: rollers('ra0001', '23:50'), owls: team('Kettenfett Owls', '00:10', 'wa0001')},
        sheets: {
            ra0001: sheet({team: 'rollers', label: 'Rollers late', date: '2026-11-19', riders: ['1001'], uploadedAt: '2026-11-19T16:00:00.000Z'}),
            wa0001: sheet({team: 'owls', label: 'Owls', date: '2026-11-20', riders: ['1001'], uploadedAt: '2026-11-18T16:00:00.000Z'}),
        },
    });
    const now = T('2026-11-19T22:00:00Z');
    assert.equal(plannedStart(c, c.sheets.ra0001), T('2026-11-19T22:50:00Z'));
    assert.equal(plannedStart(c, c.sheets.wa0001), T('2026-11-19T23:10:00Z'));
    assert.equal(pickForRider(c, '1001', {now, E: T('2026-11-19T23:00:00Z'), eventId: 4567890}).slug, 'owls');
    assert.equal(pickForRider(c, '1001', {now, E: T('2026-11-19T22:55:00Z'), eventId: 4567890}).slug, 'rollers');
    // outside events: the earliest upcoming race
    assert.equal(pickForRider(c, '1001', {now}).slug, 'rollers');
});


test('pickForRider: the 06:00 case', () => {
    const c = club({
        teams: {rollers: rollers('ra0001', '19:00')},
        sheets: {ra0001: sheet({team: 'rollers', label: 'Rollers', date: DATE, riders: ['1001'], uploadedAt: '2026-11-19T04:00:00.000Z'})},
    });
    const now = T('2026-11-19T05:00:00Z');
    assert.equal(pickForRider(c, '1001', {now, E: T('2026-11-19T05:00:00Z'), eventId: 7777777}), null);
    assert.equal(pickForRider(c, '1001', {now}).slug, 'rollers');
});


test('pickForRider: a date winner that does not match serves nothing', () => {
    const c = club({
        teams: {rollers: rollers('ra0001'), sprockets: sprockets('sa0001', '21:00')},
        sheets: {
            ra0001: sheet({team: 'rollers', label: 'Rollers', date: DATE, riders: ['1001'], uploadedAt: '2026-11-19T16:00:00.000Z'}),
            sa0001: sheet({team: 'sprockets', label: 'Sprockets', date: DATE, riders: ['1001'], uploadedAt: '2026-11-19T16:30:00.000Z'}),
        },
    });
    assert.equal(pickForRider(c, '1001', {now: NOW}).slug, 'sprockets');
    assert.equal(pickForRider(c, '1001', {now: NOW, E: T('2026-11-19T18:31:00Z'), eventId: 4567890}), null);
});


test('pickForRider: only live, unused sheets', () => {
    const c = club({
        teams: {rollers: rollers('ra0001'), sprockets: sprockets(null)},
        sheets: {
            ra0001: sheet({team: 'rollers', label: 'Rollers', date: DATE, riders: ['1001'], uploadedAt: '2026-11-19T16:00:00.000Z'}),
            ra0002: sheet({team: 'rollers', label: 'Rollers B', date: DATE, riders: ['1001'], uploadedAt: '2026-11-19T17:00:00.000Z'}),
            sa0001: sheet({team: 'sprockets', label: 'Sprockets', date: DATE, riders: ['1001'], uploadedAt: '2026-11-19T17:00:00.000Z'}),
        },
    });
    const S = T('2026-11-19T18:30:00Z');
    assert.equal(pickForRider(c, '1001', {now: NOW}).id, 'ra0001');
    assert.equal(pickForRider(c, '1001', {now: S + 4 * HOUR}).id, 'ra0001');
    assert.equal(pickForRider(c, '1001', {now: S + 4 * HOUR + 1}), null);
    assert.equal(pickForRider(c, '1001', {now: S + 4 * HOUR + 1, E: S + 4 * HOUR, eventId: 4567890}), null);
});


// before: Ben only in Rollers' live sheet. after: Sprockets' live sheet lists him too (newer).
function beforeAfter({benOnBench = false} = {}) {
    const before = club({
        teams: {rollers: rollers('ra0001'), sprockets: sprockets(null)},
        sheets: {ra0001: sheet({team: 'rollers', label: 'Rollers fast', date: DATE, riders: ['1001', '1002', '1003'], uploadedAt: '2026-11-19T16:00:00.000Z'})},
    });
    const after = structuredClone(before);
    after.teams.sprockets.live = 'sa0001';
    after.sheets.sa0001 = sheet({
        team: 'sprockets', label: 'Sprockets', date: DATE, plan: 'sa0001',
        riders: benOnBench ? ['1004', '1005'] : ['1001', '1004', '1005'], bench: benOnBench ? ['1001'] : [],
        uploadedAt: '2026-11-19T16:30:00.000Z',
    });
    return {before, after};
}


test('datePicks: one pick per athlete over the date\'s servable sheets', () => {
    const {after} = beforeAfter();
    const picks = datePicks(after, DATE, NOW);
    assert.deepEqual([...picks.keys()].sort(), ['1001', '1002', '1003', '1004', '1005']);
    assert.deepEqual(picks.get('1001'), {slug: 'sprockets', id: 'sa0001', role: 'rider', uploadedAt: '2026-11-19T16:30:00.000Z'});
    assert.deepEqual(picks.get('1002'), {slug: 'rollers', id: 'ra0001', role: 'rider', uploadedAt: '2026-11-19T16:00:00.000Z'});
    assert.equal(datePicks(after, '2026-11-20', NOW).size, 0);
    assert.equal(datePicks(after, DATE, T('2026-11-20T00:00:00Z')).size, 0);
});


test('effects: a move and a hole', () => {
    const {before, after} = beforeAfter();
    assert.deepEqual(effects(before, after, DATE, NOW), {
        moves: [{id: '1001', name: 'Ben', from: 'rollers', to: 'sprockets'}],
        holes: [{slug: 'rollers', id: '1001', name: 'Ben', rides: 'sprockets'}],
    });
    // and back: removing Sprockets' live sheet moves Ben back and leaves no hole
    assert.deepEqual(effects(after, before, DATE, NOW), {
        moves: [{id: '1001', name: 'Ben', from: 'sprockets', to: 'rollers'}],
        holes: [],
    });
    const bench = beforeAfter({benOnBench: true});
    assert.deepEqual(effects(bench.before, bench.after, DATE, NOW), {moves: [], holes: []});
});


test('effects: names are decoded and trimmed, else the id', () => {
    const {before, after} = beforeAfter();
    after.sheets.sa0001.json.riders['1001'].name = ' Ben &amp; Co ';
    after.sheets.ra0001.json.riders['1001'].name = '   ';
    assert.deepEqual(effects(before, after, DATE, NOW), {
        moves: [{id: '1001', name: 'Ben & Co', from: 'rollers', to: 'sprockets'}],
        holes: [{slug: 'rollers', id: '1001', name: '1001', rides: 'sprockets'}],
    });
});


test('DST: the team time is local, a learned id still matches', () => {
    const c = club({
        teams: {rollers: rollers('ra0001')},
        sheets: {
            ra0001: sheet({team: 'rollers', label: 'Rollers', date: '2026-10-29', riders: ['1001'], uploadedAt: '2026-10-20T16:00:00.000Z', eventId: 4567890}),
            ra0002: sheet({team: 'rollers', label: 'Rollers', date: '2026-10-22', riders: ['1001'], uploadedAt: '2026-10-20T16:00:00.000Z'}),
        },
    });
    const S = plannedStart(c, c.sheets.ra0001);
    assert.equal(S, T('2026-10-29T18:30:00Z'));
    assert.equal(plannedStart(c, c.sheets.ra0002), T('2026-10-22T17:30:00Z'));
    const req = {E: S + 70 * MIN, eventId: 4567890};
    assert.equal(matchesEvent(c.sheets.ra0001, S, req), true);
    assert.equal(matchesEvent({...c.sheets.ra0001, eventId: null}, S, req), false);
    assert.equal(pickForRider(c, '1001', {now: T('2026-10-29T12:00:00Z'), ...req}).id, 'ra0001');
});


test('outdated', () => {
    const {after} = beforeAfter();
    after.sheets.ra0002 = sheet({team: 'rollers', label: 'Rollers B', date: DATE, riders: ['1001', '1002'], uploadedAt: '2026-11-19T15:00:00.000Z', plan: 'ra0002'});
    after.sheets.ra0003 = sheet({team: 'rollers', label: 'Rollers C', date: DATE, riders: ['1002'], bench: ['1001'], uploadedAt: '2026-11-19T15:00:00.000Z', plan: 'ra0003'});
    const out = outdated(after, 'rollers', NOW);
    assert.deepEqual(out.get('ra0002'), [{id: '1001', name: 'Ben', rides: 'sprockets'}]);
    assert.deepEqual([...out.keys()], ['ra0002']);   // not the live sheet, not a sheet with Ben on the bench
    assert.equal(outdated(after, 'sprockets', NOW).size, 0);
    assert.equal(outdated(after, '__proto__', NOW).size, 0);
});


test('outdated: only each plan\'s newest version, never the live one or an older version of the live plan', () => {
    // Ben moved to Sprockets (its live version is newer); Rollers' live v2, its v1 and another plan's
    // v1 all list him
    const at = (h, m = '00') => `2026-11-19T${h}:${m}:00.000Z`;
    const c = club({
        teams: {rollers: rollers('ra0002'), sprockets: sprockets('sa0001')},
        sheets: {
            ra0001: sheet({team: 'rollers', label: 'Rollers', date: DATE, riders: ['1001', '1002'], uploadedAt: at(14), plan: 'ra0001'}),
            ra0002: sheet({team: 'rollers', label: 'Rollers', date: DATE, riders: ['1001', '1003'], uploadedAt: at(15), plan: 'ra0001', n: 2}),
            rb0001: sheet({team: 'rollers', label: 'Rollers · B', date: DATE, riders: ['1001'], uploadedAt: at(15), plan: 'rb0001', type: 'B'}),
            sa0001: sheet({team: 'sprockets', label: 'Sprockets', date: DATE, riders: ['1001', '1004'], uploadedAt: at(16, 30)}),
        },
    });
    assert.equal(datePicks(c, DATE, NOW).get('1001').slug, 'sprockets');
    let out = outdated(c, 'rollers', NOW);
    assert.deepEqual([...out.keys()], ['rb0001']);
    assert.deepEqual(out.get('rb0001'), [{id: '1001', name: 'Ben', rides: 'sprockets'}]);
    // a newer v3 of the live plan listing Ben is its newest version, and not live
    c.sheets.ra0003 = sheet({team: 'rollers', label: 'Rollers', date: DATE, riders: ['1001'], uploadedAt: at(15, 30), plan: 'ra0001', n: 3});
    out = outdated(c, 'rollers', NOW);
    assert.deepEqual([...out.keys()].sort(), ['ra0003', 'rb0001']);
});


test('servable, pickForRider, datePicks and effects ignore versions that are not live', () => {
    const base = club({
        teams: {rollers: rollers('ra0001'), sprockets: sprockets('sa0001')},
        sheets: {
            ra0001: sheet({team: 'rollers', label: 'Rollers', date: DATE, riders: ['1001', '1002'], uploadedAt: '2026-11-19T14:00:00.000Z'}),
            sa0001: sheet({team: 'sprockets', label: 'Sprockets', date: DATE, riders: ['1003'], uploadedAt: '2026-11-19T16:30:00.000Z'}),
        },
    });
    const withV2 = structuredClone(base);
    // newer than Sprockets' live version, and it lists Dan
    withV2.sheets.ra0002 = sheet({
        team: 'rollers', label: 'Rollers', date: DATE, riders: ['1003', '1001'], uploadedAt: '2026-11-19T17:00:00.000Z', plan: 'ra0001', n: 2,
    });
    assert.deepEqual(servable(withV2, NOW).map(x => x.id), ['ra0001', 'sa0001']);
    for (const id of ['1001', '1002', '1003']) {
        assert.deepEqual(pickForRider(withV2, id, {now: NOW}), pickForRider(base, id, {now: NOW}), id);
    }
    assert.equal(pickForRider(withV2, '1003', {now: NOW}).id, 'sa0001');
    assert.deepEqual(datePicks(withV2, DATE, NOW), datePicks(base, DATE, NOW));
    assert.deepEqual(effects(base, withV2, DATE, NOW), {moves: [], holes: []});
});


test('planOpen: 30 min before S', () => {
    const S = T('2026-11-19T18:30:00Z');
    assert.equal(PLAN_OPEN_MS, 1800000);
    assert.equal(planOpen(S, S - 1800000), true);
    assert.equal(planOpen(S, S - 1800001), false);
    assert.equal(planOpen(S, S + 4 * HOUR), true);
    assert.equal(planOpen(null, S), false);
    assert.equal(planOpen(undefined, S), false);
});


test('nextRaceDate: the live sheet while still to race (until S + 2 h)', () => {
    const c = club({
        teams: {rollers: rollers('ra0001')},
        sheets: {ra0001: sheet({team: 'rollers', label: 'Rollers fast', date: DATE, riders: ['1001'], uploadedAt: '2026-11-16T10:00:00.000Z'})},
    });
    assert.equal(STILL_TO_RACE_MS, 2 * HOUR);
    // a fix sent on Monday for Thursday lands on Thursday
    assert.equal(nextRaceDate(c, 'rollers', T('2026-11-16T09:00:00Z')), DATE);
    // a correction at 19:45 for the 19:30 team stays on today's race (S = 18:30Z)
    assert.equal(nextRaceDate(c, 'rollers', T('2026-11-19T18:45:00Z')), DATE);
    assert.equal(nextRaceDate(c, 'rollers', T('2026-11-19T20:30:00Z')), DATE);
    // after S + 2 h: rule 2, the same weekday a week on
    assert.equal(nextRaceDate(c, 'rollers', T('2026-11-19T20:30:00.001Z')), '2026-11-26');
});


test('nextRaceDate: a weekly team\'s stored dates do not move its weekday', () => {
    const at = '2026-11-01T10:00:00.000Z';
    const c = club({
        teams: {rollers: rollers(null)},
        sheets: {
            ra0001: sheet({team: 'rollers', label: 'Rollers old', date: '2026-10-29', riders: ['1001'], uploadedAt: '2026-11-05T10:00:00.000Z'}),
            ra0002: sheet({team: 'rollers', label: 'Rollers fast', date: '2026-11-05', riders: ['1001'], uploadedAt: at}),
        },
    });
    // the club's Thursday: Monday 16 Nov gives Thursday 19 Nov
    assert.equal(nextRaceDate(c, 'rollers', T('2026-11-16T09:00:00Z')), DATE);
    // on the race day until S + 2 h, then the week after
    assert.equal(nextRaceDate(c, 'rollers', T('2026-11-19T20:30:00Z')), DATE);
    assert.equal(nextRaceDate(c, 'rollers', T('2026-11-19T20:30:00.001Z')), '2026-11-26');
    // a stored sheet still to race counts with zero weeks
    assert.equal(nextRaceDate(c, 'rollers', T('2026-11-05T12:00:00Z')), '2026-11-05');
    // a live sheet that has been raced: rule 2, the club's weekday
    c.teams.rollers.live = 'ra0001';
    assert.equal(nextRaceDate(c, 'rollers', T('2026-11-16T09:00:00Z')), DATE);
    // a stored plan on another weekday (Saturday 14 Nov, not live) does not count
    c.sheets.ra0003 = {...sheet({team: 'rollers', label: 'Rollers', date: '2026-11-14', riders: ['1001'], uploadedAt: at}), plan: 'ra0003'};
    assert.equal(nextRaceDate(c, 'rollers', T('2026-11-16T09:00:00Z')), DATE);
});


test('nextRaceDate: whole weeks across a DST change, S in the club\'s zone', () => {
    // autumn: 22 Oct is CEST (S = 17:30Z), 29 Oct is CET (S = 18:30Z, still to race until 20:30Z)
    const autumn = club({
        teams: {rollers: rollers(null)},
        sheets: {ra0001: sheet({team: 'rollers', label: 'Rollers fast', date: '2026-10-22', riders: ['1001'], uploadedAt: '2026-10-20T10:00:00.000Z'})},
    });
    assert.equal(nextRaceDate(autumn, 'rollers', T('2026-10-29T20:00:00Z')), '2026-10-29');
    assert.equal(nextRaceDate(autumn, 'rollers', T('2026-10-29T20:30:00.001Z')), '2026-11-05');
    // spring: 18 Mar 2027 is CET, 1 Apr 2027 CEST (S = 17:30Z, still to race until 19:30Z)
    const spring = club({
        teams: {rollers: rollers(null)},
        sheets: {ra0001: sheet({team: 'rollers', label: 'Rollers fast', date: '2027-03-18', riders: ['1001'], uploadedAt: '2027-03-15T10:00:00.000Z'})},
    });
    assert.equal(nextRaceDate(spring, 'rollers', T('2027-04-01T19:30:00Z')), '2027-04-01');
    assert.equal(nextRaceDate(spring, 'rollers', T('2027-04-01T20:00:00Z')), '2027-04-08');
});


// Kettenfett RC with its race day Thursday: Rollers 19:30 weekly on the club's day, Sprockets 19:30
// weekly on Tuesday, Cogs 19:30 special.
function kinds(sheets = {}) {
    return {
        ...club({
            teams: {
                rollers: {...rollers(null), kind: 'weekly', weekday: null},
                sprockets: {...sprockets(null, '19:30'), kind: 'weekly', weekday: 2},
                cogs: {...team('Kettenfett Cogs', '19:30'), kind: 'special', weekday: null},
            },
            sheets,
        }),
        weekday: 4,
    };
}


test('nextRaceDate: weekly by the club\'s weekday', () => {
    const c = kinds();
    assert.equal(nextRaceDate(c, 'rollers', T('2026-11-16T12:00Z')), '2026-11-19');
    // on the day until S + 2 h (S = 18:30Z), then a week later
    assert.equal(nextRaceDate(c, 'rollers', T('2026-11-19T20:30Z')), '2026-11-19');
    assert.equal(nextRaceDate(c, 'rollers', T('2026-11-19T20:31Z')), '2026-11-26');
    // the club's day changes: Monday is today
    c.weekday = 1;
    assert.equal(nextRaceDate(c, 'rollers', T('2026-11-16T12:00Z')), '2026-11-16');
    // missing, or not 1-7: Thursday
    for (const bad of [undefined, null, 0, 8, 2.5, '1']) {
        c.weekday = bad;
        assert.equal(teamWeekday(c, 'rollers'), 4, String(bad));
        assert.equal(nextRaceDate(c, 'rollers', T('2026-11-16T12:00Z')), '2026-11-19', String(bad));
    }
    // a team without a kind, or with an unknown one, is weekly
    delete c.teams.rollers.kind;
    assert.equal(nextRaceDate(c, 'rollers', T('2026-11-16T12:00Z')), '2026-11-19');
    c.teams.rollers.kind = 'monthly';
    assert.equal(nextRaceDate(c, 'rollers', T('2026-11-16T12:00Z')), '2026-11-19');
    // an unknown team: the club's day
    assert.equal(nextRaceDate(c, 'gone', T('2026-11-16T12:00Z')), '2026-11-19');
    assert.equal(nextRaceDate(c, '__proto__', T('2026-11-16T12:00Z')), '2026-11-19');
});


test('nextRaceDate: a team\'s own weekday', () => {
    const c = kinds();
    assert.equal(teamWeekday(c, 'sprockets'), 2);
    assert.equal(nextRaceDate(c, 'sprockets', T('2026-11-16T12:00Z')), '2026-11-17');
    // the team's day wins over the club's
    c.weekday = 1;
    assert.equal(nextRaceDate(c, 'sprockets', T('2026-11-16T12:00Z')), '2026-11-17');
    // a team weekday that is not 1-7 is the club's
    for (const bad of [0, 8, '2', 1.5]) {
        c.teams.sprockets.weekday = bad;
        assert.equal(teamWeekday(c, 'sprockets'), 1, String(bad));
    }
    // Sunday is 7
    c.teams.sprockets.weekday = 7;
    assert.equal(nextRaceDate(c, 'sprockets', T('2026-11-16T12:00Z')), '2026-11-22');
});


test('nextRaceDate: the live plan first', () => {
    const c = kinds({ra0001: sheet({team: 'rollers', label: 'Kettenfett Rollers', date: '2026-11-21', riders: ['1001'], uploadedAt: '2026-11-15T10:00:00.000Z'})});
    c.teams.rollers.live = 'ra0001';
    // a Saturday, not the club's Thursday
    assert.equal(nextRaceDate(c, 'rollers', T('2026-11-16T12:00Z')), '2026-11-21');
    // a special team's live plan too
    c.sheets.ca0001 = {...sheet({team: 'cogs', label: 'Kettenfett Cogs', date: '2026-11-21', riders: ['1001'], uploadedAt: '2026-11-15T10:00:00.000Z'}), plan: 'ca0001'};
    c.teams.cogs.live = 'ca0001';
    assert.equal(nextRaceDate(c, 'cogs', T('2026-11-16T12:00Z')), '2026-11-21');
});


test('nextRaceDate: special', () => {
    const c = kinds();
    assert.equal(nextRaceDate(c, 'cogs', T('2026-11-16T12:00Z')), null);
    c.sheets.ca0001 = {...sheet({team: 'cogs', label: 'Kettenfett Cogs', date: '2026-12-06', riders: ['1001'], uploadedAt: '2026-11-15T10:00:00.000Z'}), plan: 'ca0001'};
    assert.equal(nextRaceDate(c, 'cogs', T('2026-11-16T12:00Z')), '2026-12-06');
    // the newest of its dates still to race; another team's plan does not count
    c.sheets.ca0002 = {...sheet({team: 'cogs', label: 'Kettenfett Cogs', date: '2026-11-28', riders: ['1001'], uploadedAt: '2026-11-16T10:00:00.000Z'}), plan: 'ca0002'};
    c.sheets.ra0001 = {...sheet({team: 'rollers', label: 'Kettenfett Rollers', date: '2026-12-20', riders: ['1001'], uploadedAt: '2026-11-16T10:00:00.000Z'}), plan: 'ra0001'};
    assert.equal(nextRaceDate(c, 'cogs', T('2026-11-16T12:00Z')), '2026-12-06');
    // 6 Dec S = 18:30Z: still to race until 20:30Z
    assert.equal(nextRaceDate(c, 'cogs', T('2026-12-06T20:30Z')), '2026-12-06');
    assert.equal(nextRaceDate(c, 'cogs', T('2026-12-06T20:31Z')), null);
});


test('nextRaceDate: weekly without a start time', () => {
    const c = kinds();
    c.teams.owls = {...team('Kettenfett Owls', null), kind: 'weekly', weekday: null};
    // the next Thursday from today on
    assert.equal(nextRaceDate(c, 'owls', T('2026-11-16T12:00Z')), '2026-11-19');
    // Thursday, however late; Friday in Berlin (23:00Z): a week on
    assert.equal(nextRaceDate(c, 'owls', T('2026-11-19T22:50:00Z')), '2026-11-19');
    assert.equal(nextRaceDate(c, 'owls', T('2026-11-19T23:00:00Z')), '2026-11-26');
    // a live sheet dated today or later counts until the day is over
    c.sheets.wa0001 = {...sheet({team: 'owls', label: 'Owls', date: '2026-11-21', riders: ['1001'], uploadedAt: '2026-11-10T10:00:00.000Z'}), plan: 'wa0001'};
    c.teams.owls.live = 'wa0001';
    assert.equal(nextRaceDate(c, 'owls', T('2026-11-21T22:50:00Z')), '2026-11-21');
    assert.equal(nextRaceDate(c, 'owls', T('2026-11-21T23:00:00Z')), '2026-11-26');
    // a special team without a start time: its plan's date from today on
    c.teams.owls = {...c.teams.owls, kind: 'special', live: null};
    assert.equal(nextRaceDate(c, 'owls', T('2026-11-21T22:50:00Z')), '2026-11-21');
    assert.equal(nextRaceDate(c, 'owls', T('2026-11-21T23:00:00Z')), null);
});


test('nextRaceDate: a late start still racing after midnight', () => {
    // 23:30 Berlin: the 18 Nov race (S = 22:30Z) is still to race until 00:30Z on the 19th
    // Owls race Wednesdays (weekday 3), the club's day is Thursday
    const c = club({teams: {owls: {...team('Kettenfett Owls', '23:30'), kind: 'weekly', weekday: 3}}});
    assert.equal(nextRaceDate(c, 'owls', T('2026-11-18T23:30:00Z')), '2026-11-18');
    assert.equal(nextRaceDate(c, 'owls', T('2026-11-19T00:30:00.001Z')), '2026-11-25');
});


// ---- a special team's start time belongs to its race, team and date (user, 19 Nov 2026) ----

const cogsSheet = (date, extra = {}) => ({...sheet({team: 'cogs', label: 'Kettenfett Cogs', date, riders: ['1001'], uploadedAt: '2026-11-15T10:00:00.000Z'}), ...extra});


test('plannedStart: a special team races at its race\'s start, a weekly team at the team\'s', () => {
    const c = kinds({ca0001: cogsSheet('2026-11-21'), ca0002: cogsSheet('2026-11-28')});
    c.teams.cogs.raceStarts = {'2026-11-21': '20:15'};
    // special: the start stored for the date (Berlin, UTC+1)
    assert.equal(startOf(c, c.sheets.ca0001), '20:15');
    assert.equal(plannedStart(c, c.sheets.ca0001), T('2026-11-21T19:15:00Z'));
    // a date without one (a plan stored by 0.3.0): the team's start, as before
    assert.equal(startOf(c, c.sheets.ca0002), '19:30');
    assert.equal(plannedStart(c, c.sheets.ca0002), T('2026-11-28T18:30:00Z'));
    // a stored start that is no HH:MM counts as none; a key from the prototype never matches
    for (const bad of ['25:00', '7:30', '', 1930, null]) {
        c.teams.cogs.raceStarts = {'2026-11-21': bad};
        assert.equal(plannedStart(c, c.sheets.ca0001), T('2026-11-21T18:30:00Z'), String(bad));
    }
    c.teams.cogs.raceStarts = {'2026-11-21': '20:15'};
    assert.equal(startOf(c, {team: 'cogs', date: 'toString'}), '19:30');
    assert.equal(startOf(c, {team: 'cogs', date: '__proto__'}), '19:30');
    // neither: no S
    c.teams.cogs.start = null;
    assert.equal(plannedStart(c, c.sheets.ca0002), null);
    assert.equal(plannedStart(c, c.sheets.ca0001), T('2026-11-21T19:15:00Z'));
    // a weekly team always races at the team's start, whatever is stored (a team made weekly again)
    c.teams.rollers.raceStarts = {[DATE]: '21:00'};
    const ra = sheet({team: 'rollers', label: 'Kettenfett Rollers', date: DATE, riders: ['1001'], uploadedAt: '2026-11-15T10:00:00.000Z'});
    assert.equal(plannedStart(c, ra), T('2026-11-19T18:30:00Z'));
    c.teams.cogs.kind = 'weekly';
    c.teams.cogs.start = '19:00';
    assert.equal(plannedStart(c, c.sheets.ca0001), T('2026-11-21T18:00:00Z'));
});


test('raceStart: one race per team and date', () => {
    const c = kinds({ca0001: cogsSheet('2026-11-21'), ca0002: cogsSheet('2026-11-28')});
    c.teams.cogs.raceStarts = {'2026-11-21': '20:15'};
    // every plan of that date starts with it
    assert.equal(raceStart(c, 'cogs', '2026-11-21'), '20:15');
    assert.equal(raceStartAt(c, 'cogs', '2026-11-21'), T('2026-11-21T19:15:00Z'));
    assert.equal(raceStart(c, 'cogs', '2026-11-28'), '19:30');
    c.teams.cogs.start = null;
    assert.equal(raceStart(c, 'cogs', '2026-11-28'), null);
    assert.equal(raceStartAt(c, 'cogs', '2026-11-28'), null);
    // weekly (and an unknown team): the team's start on any date
    assert.equal(raceStart(c, 'rollers', '2026-12-05'), '19:30');
    assert.equal(raceStart(c, 'gone', '2026-12-12'), null);
    assert.equal(raceStart(c, '__proto__', '2026-12-12'), null);
    // still to race until the race's S + 2 h
    assert.equal(stillToRace(c, 'cogs', '2026-11-21', T('2026-11-21T21:15:00Z')), true);
    assert.equal(stillToRace(c, 'cogs', '2026-11-21', T('2026-11-21T21:15:00.001Z')), false);
    assert.equal(nextRaceDate(c, 'cogs', T('2026-11-21T21:15:00Z')), '2026-11-28');
});


test('servable and pickForRider: a special team\'s plan at its race\'s start', () => {
    const c = kinds({ca0001: cogsSheet('2026-11-21')});
    c.teams.cogs.raceStarts = {'2026-11-21': '20:15'};
    c.teams.cogs.live = 'ca0001';
    const S = T('2026-11-21T19:15:00Z');
    assert.deepEqual(servable(c, NOW).map(x => [x.slug, x.S]), [['cogs', S]]);
    // used up 4 h after the race's start, not the team's
    assert.deepEqual(servable(c, S + USED_UP_MS).map(x => x.slug), ['cogs']);
    assert.deepEqual(servable(c, S + USED_UP_MS + 1), []);
    // in the event at 20:15 Berlin, not at the team's 19:30
    assert.equal(pickForRider(c, '1001', {now: S - HOUR, E: S, eventId: null})?.id, 'ca0001');
    assert.equal(pickForRider(c, '1001', {now: S - HOUR, E: T('2026-11-21T17:30:00Z'), eventId: null}), null);
});
