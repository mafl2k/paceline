// Run with: node --test server/tests/races.test.mjs
// Races (races.mjs): the conversion from the 0.3 shape (toRaces, convertClub), the two race
// invariants (tidyRaces), the lookups, and the schema step that converts the stored rows (racesStep).
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {emptyRace, raceOf, raceOfSheet, racesOf, tidyRaces, toRaces} from '../races.mjs';
import {convertClub, MAX_CLUB_BYTES} from '../club.mjs';
import {racesStep} from '../migrate-races.mjs';
import {migrate, MIGRATIONS} from '../db.mjs';
import {isDate} from '../time.mjs';
import {teamWeekday} from '../select.mjs';
import {T, sheet} from './helpers.mjs';
import {PRE_RACES, rawClub} from './pre-races.mjs';
import * as legacy from './legacy-select.mjs';

const pre = name => PRE_RACES.find(([n]) => n === name)[1]();
const dump = () => pre('dump');
const EVENT = ['pinnedEventId', 'eventId', 'boundAt'];
const bare = sheets => Object.fromEntries(Object.entries(sheets).map(([id, s]) => [id, Object.fromEntries(Object.entries(s).filter(([k]) => !EVENT.includes(k)))]));
const NONE = {changed: false, dropped: []};


// The two race invariants (and no 0.3 field left on an object team or sheet).
function assertInvariants(c, name) {
    for (const [slug, team] of Object.entries(c.teams)) {
        if (team === null || typeof team !== 'object') {
            continue;
        }
        assert.equal(typeof team.races, 'object', `${name} ${slug}: races`);
        for (const k of ['live', 'raceStarts', 'liveBefore']) {
            assert.equal(Object.hasOwn(team, k), false, `${name} ${slug}: ${k}`);
        }
        const dates = new Set(Object.values(c.sheets).filter(s => s?.team === slug && isDate(s.date)).map(s => s.date));
        assert.deepEqual(Object.keys(team.races).sort(), [...dates].sort(), `${name} ${slug}: a race exactly for every dated plan`);
        for (const [date, race] of Object.entries(team.races)) {
            assert.deepEqual(Object.keys(race).sort(), ['boundAt', 'eventId', 'live', 'pinnedEventId', 'start'], `${name} ${slug} ${date}`);
            if (race.live !== null) {
                const s = c.sheets[race.live];
                assert.ok(Object.hasOwn(c.sheets, race.live) && s.team === slug && s.date === date, `${name} ${slug} ${date}: live ${race.live}`);
            }
        }
    }
    for (const [id, s] of Object.entries(c.sheets)) {
        if (s !== null && typeof s === 'object') {
            for (const k of EVENT) {
                assert.equal(Object.hasOwn(s, k), false, `${name} sheet ${id}: ${k}`);
            }
        }
    }
}


test('toRaces: the club written by 0.3 becomes races and loses nothing', () => {
    const before = dump();
    const c = structuredClone(before);
    const r = toRaces(c);
    assert.equal(r.changed, true);
    assert.deepEqual(c.teams.rollers.races, {
        '2026-11-17': {start: null, pinnedEventId: null, eventId: 5110001, boundAt: '2026-11-17T18:10:00.000Z', live: null},
        '2026-11-24': {start: null, pinnedEventId: null, eventId: null, boundAt: null, live: 'a00003'},
    });
    assert.deepEqual(c.teams.sprockets.races, {'2026-11-26': {start: null, pinnedEventId: 5120001, eventId: null, boundAt: null, live: 'a00008'}});
    assert.deepEqual(c.teams['sunday-specials'].races, {
        '2026-11-22': {start: '18:00', pinnedEventId: 5130002, eventId: null, boundAt: null, live: null},
        '2026-11-29': {start: '20:15', pinnedEventId: null, eventId: null, boundAt: null, live: 'a00012'},
    });
    assert.deepEqual(c.teams.oldies.races, {'2026-11-23': {start: null, pinnedEventId: null, eventId: null, boundAt: null, live: 'a00013'}});
    assert.deepEqual(r.dropped, [{team: 'rollers', date: '2026-11-24', eventId: 5123456}, {team: 'sunday-specials', date: '2026-11-22', eventId: 5130001}]);
    for (const [slug, team] of Object.entries(c.teams)) {
        const {races, weekday, ...rest} = team;
        const {live, raceStarts, liveBefore, weekday: was, ...kept} = before.teams[slug];
        assert.deepEqual(rest, kept, slug);                // name, start, kind, version, changedAt, types
    }
    assert.deepEqual(c.sheets, bare(before.sheets));       // every version, its json, type, n, label, date
    assert.deepEqual([c.inbox, c.log, c.tokens], [before.inbox, before.log, before.tokens]);
    assert.equal(Object.hasOwn(c, 'weekday'), false, 'the club\'s race day goes');
    // the rest of the club as it was
    const others = x => Object.fromEntries(Object.entries(x).filter(([k]) => !['teams', 'sheets', 'weekday'].includes(k)));
    assert.deepEqual(others(c), others(before));
});


test('toRaces: weekly teams that followed the club\'s race day get it as their own, and no race day moves', () => {
    const c = dump();                                   // club weekday 2; Rollers and Cogs follow it, Sprockets has 4
    assert.equal(toRaces(c).changed, true);
    assert.deepEqual(Object.fromEntries(Object.entries(c.teams).map(([s, t]) => [s, t.weekday])),
        {rollers: 2, sprockets: 4, cogs: 2, 'sunday-specials': null, oldies: null});
    assert.equal(Object.hasOwn(c, 'weekday'), false);
    for (const [name, build] of PRE_RACES) {
        const old = build();
        const cur = structuredClone(old);
        toRaces(cur);
        for (const slug of Object.keys(old.teams).filter(s => old.teams[s].kind !== 'special')) {
            assert.equal(teamWeekday(cur, slug), legacy.teamWeekday(old, slug), `${name} ${slug}`);
        }
    }
});


test('toRaces: without a club race day a following team gets Thursday', () => {
    const team = (name, kind, weekday) => ({name, start: '19:30', live: null, version: 1, changedAt: '2026-11-15T10:00:00.000Z', kind, weekday});
    const teams = () => ({
        rollers: team('Rollers', 'weekly', null), sprockets: team('Sprockets', 'weekly', 6), owls: team('Owls', 'weekly', 0),
        cogs: team('Cogs', 'special', null), gears: team('Gears', 'special', 3),
    });
    const days = c => Object.fromEntries(Object.entries(c.teams).map(([s, t]) => [s, t.weekday]));
    // a club without a race day, and one whose race day is no weekday 1-7: Thursday; a special
    // team's weekday is left alone
    for (const weekday of [undefined, null, 0, 8, '2', 2.5]) {
        const c = rawClub({teams: teams(), weekday});
        assert.equal(toRaces(c).changed, true, String(weekday));
        assert.deepEqual(days(c), {rollers: 4, sprockets: 6, owls: 4, cogs: null, gears: 3}, String(weekday));
        assert.equal(Object.hasOwn(c, 'weekday'), false, String(weekday));
        assert.deepEqual(toRaces(c), NONE, `${weekday}: a second run`);
    }
    // a team without a kind, or with an unknown one, races weekly (select.mjs) and gets the day too
    const odd = rawClub({teams: {rollers: {...team('Rollers', 'weekly', null), kind: undefined}, owls: team('Owls', 'monthly', null)}, weekday: 5});
    toRaces(odd);
    assert.deepEqual(days(odd), {rollers: 5, owls: 5});
    // a club that has races already: only the race day moves into the teams
    const raced = rawClub({teams: teams(), weekday: 1});
    toRaces(raced);
    raced.weekday = 1;
    raced.teams.rollers.weekday = null;
    assert.deepEqual(toRaces(raced), {changed: true, dropped: []});
    assert.equal(raced.teams.rollers.weekday, 1);
    assert.equal(Object.hasOwn(raced, 'weekday'), false);
});


test('toRaces: a second run changes nothing', () => {
    for (const [name, make] of PRE_RACES) {
        const c = make();
        toRaces(c);
        const once = JSON.stringify(c);
        assert.deepEqual(toRaces(c), NONE, name);
        assert.equal(JSON.stringify(c), once, name);
    }
});


test('toRaces: every pre-races club ends with the race invariants', () => {
    assert.deepEqual(PRE_RACES.map(([n]) => n), ['dump', 'staggered', 'pinned', 'learned', 'special', 'leftover', 'dangling']);
    for (const [name, make] of PRE_RACES) {
        const c = make();
        const plans = Object.keys(c.sheets).sort();
        assert.equal(toRaces(c).changed, true, name);
        assertInvariants(c, name);
        assert.deepEqual(Object.keys(c.sheets).sort(), plans, `${name}: no plan lost`);
    }
    // the fixtures' own expectations
    const pinned = pre('pinned');
    assert.deepEqual(toRaces(pinned).dropped, [{team: 'rollers', date: '2026-11-19', eventId: 4567999}]);
    assert.deepEqual(pinned.teams.rollers.races, {'2026-11-19': {start: null, pinnedEventId: 4567890, eventId: 4567891, boundAt: null, live: 'ra0001'}});
    const learned = pre('learned');
    assert.deepEqual(toRaces(learned).dropped, []);
    assert.deepEqual(learned.teams.rollers.races, {'2026-11-19': {start: null, pinnedEventId: null, eventId: 4567100, boundAt: '2026-11-19T18:31:00.000Z', live: 'ra0001'}});
    const special = pre('special');
    assert.deepEqual(toRaces(special).dropped, []);
    assert.deepEqual(special.teams.cogs.races, {
        '2026-11-19': {start: '20:15', pinnedEventId: null, eventId: 4567001, boundAt: null, live: null},
        '2026-11-22': {start: '18:00', pinnedEventId: null, eventId: null, boundAt: null, live: 'sp0002'},
    });
    assert.deepEqual(Object.keys(special.teams.cogs.races), ['2026-11-19', '2026-11-22'], 'by date');
    const staggered = pre('staggered');
    toRaces(staggered);
    assert.equal(staggered.teams.rollers.races['2026-11-19'].live, 'ra0001');
    assert.equal(staggered.teams.sprockets.races['2026-11-19'].live, 'sa0001');
});


test('toRaces: a link replaced on the source plan itself is not logged as dropped', () => {
    // Rollers fast: v1 had event 4567890, v2 has 4567891; Rollers slow has 4567999
    const build = ({live = 'ra0002', slow = true} = {}) => rawClub({
        teams: {rollers: {name: 'Rollers', start: '19:30', live, version: 3, changedAt: '2026-11-18T10:00:00.000Z', kind: 'weekly', weekday: null}},
        sheets: {
            ra0001: sheet({team: 'rollers', label: 'Rollers', date: '2026-11-19', riders: ['1001'], uploadedAt: '2026-11-18T10:00:00.000Z',
                plan: 'ra0001', n: 1, pinnedEventId: 4567890}),
            ra0002: sheet({team: 'rollers', label: 'Rollers', date: '2026-11-19', riders: ['1002'], uploadedAt: '2026-11-18T11:00:00.000Z',
                plan: 'ra0001', n: 2, pinnedEventId: 4567891}),
            ...(slow ? {rb0001: sheet({team: 'rollers', label: 'Rollers · slow', date: '2026-11-19', riders: ['1003'], uploadedAt: '2026-11-18T09:00:00.000Z',
                type: 'slow', pinnedEventId: 4567999})} : {}),
        },
    });
    // v2 live: only the other plan's link is dropped
    const c = build();
    assert.deepEqual(toRaces(c).dropped, [{team: 'rollers', date: '2026-11-19', eventId: 4567999}]);
    assert.equal(c.teams.rollers.races['2026-11-19'].pinnedEventId, 4567891);
    // without the other plan nothing is dropped at all
    const alone = build({slow: false});
    assert.deepEqual(toRaces(alone).dropped, []);
    assert.equal(alone.teams.rollers.races['2026-11-19'].pinnedEventId, 4567891);
    // nor when the source is the newest version of a plan that is not live
    const notLive = build({live: null, slow: false});
    assert.deepEqual(toRaces(notLive).dropped, []);
    assert.deepEqual(notLive.teams.rollers.races['2026-11-19'], {start: null, pinnedEventId: 4567891, eventId: null, boundAt: null, live: null});
    // the live plan's older version: its newer version's other link is dropped, in its own words
    const older = build({live: 'ra0001', slow: false});
    assert.deepEqual(toRaces(older).dropped, [{team: 'rollers', date: '2026-11-19', eventId: 4567891, newer: true}]);
    assert.deepEqual(older.teams.rollers.races['2026-11-19'], {start: null, pinnedEventId: 4567890, eventId: null, boundAt: null, live: 'ra0001'});
    // with the other plan too: both, ids ascending
    const both = build({live: 'ra0001'});
    assert.deepEqual(toRaces(both).dropped, [{team: 'rollers', date: '2026-11-19', eventId: 4567891, newer: true}, {team: 'rollers', date: '2026-11-19', eventId: 4567999}]);
    // a newer version with the live one's link, or none, drops nothing
    const same = build({live: 'ra0001', slow: false});
    same.sheets.ra0002.pinnedEventId = 4567890;
    assert.deepEqual(toRaces(same).dropped, []);
    const none = build({live: 'ra0001', slow: false});
    none.sheets.ra0002.pinnedEventId = null;
    assert.deepEqual(toRaces(none).dropped, []);
    // a link both a newer version and another plan carried is dropped once, as the other plan's
    const shared = build({live: 'ra0001'});
    shared.sheets.ra0002.pinnedEventId = 4567999;
    assert.deepEqual(toRaces(shared).dropped, [{team: 'rollers', date: '2026-11-19', eventId: 4567999}]);
});


test('toRaces: odd data', () => {
    // a live pointer to a version that is gone, and no live plan: every race.live null
    const dangling = pre('dangling');
    toRaces(dangling);
    assert.deepEqual(dangling.teams.rollers.races, {'2026-11-19': emptyRace(), '2026-11-26': emptyRace()});
    assert.deepEqual(dangling.teams.sprockets.races, {'2026-11-19': emptyRace()});

    // a live id of another team's version; a version dated 'soon'; a team without versions; a
    // special team's race start for a date without plans, and one that is no time
    const c = rawClub({
        teams: {
            rollers: {name: 'Rollers', start: '19:30', live: 'sa0001', version: 1, changedAt: '2026-11-15T10:00:00.000Z', kind: 'weekly', weekday: null},
            sprockets: {name: 'Sprockets', start: '19:40', live: null, version: 1, changedAt: '2026-11-15T10:00:00.000Z', kind: 'weekly', weekday: null},
            cogs: {name: 'Cogs', start: null, live: null, version: 1, changedAt: '2026-11-15T10:00:00.000Z', kind: 'special', weekday: null,
                raceStarts: {'2026-11-22': '7pm', '2026-11-29': '18:00'}},
            owls: {name: 'Owls', start: null, live: null, version: 1, changedAt: '2026-11-15T10:00:00.000Z', kind: 'weekly', weekday: null},
        },
        sheets: {
            ra0001: sheet({team: 'rollers', label: 'Rollers', date: '2026-11-19', riders: ['1001'], uploadedAt: '2026-11-18T12:00:00.000Z'}),
            rb0001: sheet({team: 'rollers', label: 'Rollers', date: 'soon', riders: ['1002'], uploadedAt: '2026-11-18T12:05:00.000Z', pinnedEventId: 4567111}),
            sa0001: sheet({team: 'sprockets', label: 'Sprockets', date: '2026-11-19', riders: ['1003'], uploadedAt: '2026-11-18T12:10:00.000Z'}),
            ca0001: sheet({team: 'cogs', label: 'Cogs', date: '2026-11-22', riders: ['1004'], uploadedAt: '2026-11-18T12:20:00.000Z'}),
        },
    });
    assert.deepEqual(toRaces(c).dropped, []);
    assert.deepEqual(c.teams.rollers.races, {'2026-11-19': emptyRace()});
    assert.deepEqual(Object.keys(c.sheets), ['ra0001', 'rb0001', 'sa0001', 'ca0001'], 'the undated version keeps its place');
    assert.equal(c.sheets.rb0001.date, 'soon');
    assert.deepEqual(c.teams.sprockets.races, {'2026-11-19': emptyRace()});
    assert.deepEqual(c.teams.cogs.races, {'2026-11-22': emptyRace()}, "'7pm' is no time; 29 Nov has no plan");
    assert.deepEqual(c.teams.owls.races, {});
    assertInvariants(c, 'odd');

    // a weekly team's leftover race start is not its time
    const leftover = pre('leftover');
    toRaces(leftover);
    assert.deepEqual(leftover.teams.rollers.races, {'2026-11-19': {...emptyRace(), live: 'ra0001'}});

    // the newest version (by `at`, then n, then id) decides a race without a live plan
    const tie = rawClub({
        teams: {rollers: {name: 'Rollers', start: '19:30', live: null, version: 1, changedAt: '2026-11-15T10:00:00.000Z', kind: 'weekly', weekday: null}},
        sheets: {
            ra0001: sheet({team: 'rollers', label: 'Rollers', date: '2026-11-19', riders: ['1001'], uploadedAt: '2026-11-18T12:00:00.000Z', pinnedEventId: 4567001}),
            rb0001: sheet({team: 'rollers', label: 'Rollers', date: '2026-11-19', riders: ['1002'], uploadedAt: '2026-11-18T12:00:00.000Z', pinnedEventId: 4567002}),
            rc0001: sheet({team: 'rollers', label: 'Rollers', date: '2026-11-19', riders: ['1003'], uploadedAt: 'not a time', pinnedEventId: 4567003}),
        },
    });
    assert.deepEqual(toRaces(tie).dropped, [{team: 'rollers', date: '2026-11-19', eventId: 4567001}, {team: 'rollers', date: '2026-11-19', eventId: 4567003}]);
    assert.equal(tie.teams.rollers.races['2026-11-19'].pinnedEventId, 4567002);

    // not club-shaped: left alone
    assert.deepEqual(toRaces(null), NONE);
    assert.deepEqual(toRaces(5), NONE);
    assert.deepEqual(toRaces({teams: 1, sheets: {}}), NONE);
    assert.deepEqual(toRaces({teams: {}, sheets: []}), NONE);
    const shapeless = {teams: 1, sheets: {}};
    toRaces(shapeless);
    assert.deepEqual(shapeless, {teams: 1, sheets: {}});

    // entries that are no objects (M3): skipped and kept as they are; the rest is converted, and
    // the versions of a team that is no object keep their event fields
    const broken = pre('pinned');
    broken.teams.gone = null;
    broken.teams.odd = 'text';
    broken.teams.list = [1, 2];
    broken.sheets.xx0001 = 'not a version';
    broken.sheets.xx0002 = null;
    broken.sheets.lx0001 = sheet({team: 'list', label: 'List', date: '2026-11-19', riders: ['1001'], uploadedAt: '2026-11-18T12:00:00.000Z', pinnedEventId: 4567222});
    const r = toRaces(broken);
    assert.equal(r.changed, true);
    assert.deepEqual(r.dropped, [{team: 'rollers', date: '2026-11-19', eventId: 4567999}]);
    assert.deepEqual([broken.teams.gone, broken.teams.odd, broken.teams.list], [null, 'text', [1, 2]]);
    assert.deepEqual([broken.sheets.xx0001, broken.sheets.xx0002], ['not a version', null]);
    assert.equal(broken.sheets.lx0001.pinnedEventId, 4567222);
    assert.equal(broken.teams.rollers.races['2026-11-19'].live, 'ra0001');
    assert.deepEqual(toRaces(broken), NONE);
    // a live pointer or race start of an odd type
    const odd = pre('special');
    odd.teams.cogs.live = 42;
    odd.teams.cogs.raceStarts = 'none';
    toRaces(odd);
    assert.deepEqual(odd.teams.cogs.races, {
        '2026-11-19': {...emptyRace(), eventId: 4567001},
        '2026-11-22': emptyRace(),
    });
});


test('tidyRaces: adds a missing race, drops an empty one, clears a live outside its race', () => {
    const c = pre('dangling');
    toRaces(c);
    assert.equal(tidyRaces(c), false, 'nothing to do');
    // a new version on a date without a race
    c.sheets.rc0001 = {...c.sheets.ra0001, date: '2026-11-28', plan: 'rc0001'};
    // the last version of 26 Nov gone
    delete c.sheets.rb0001;
    // live: a version of another date, of another team, and one that is gone
    c.teams.rollers.races['2026-11-19'].live = 'rc0001';
    c.teams.sprockets.races['2026-11-19'].live = 'ra0001';
    assert.equal(tidyRaces(c, 'rollers'), true);
    assert.deepEqual(c.teams.rollers.races, {'2026-11-19': emptyRace(), '2026-11-28': emptyRace()});
    assert.equal(c.teams.sprockets.races['2026-11-19'].live, 'ra0001', 'one team only');
    assert.equal(tidyRaces(c, 'rollers'), false);
    assert.equal(tidyRaces(c), true);
    assert.equal(c.teams.sprockets.races['2026-11-19'].live, null);
    c.teams.sprockets.races['2026-11-19'].live = 'zzzzzz';
    // a race that is no object, and one under a key that is no date
    c.teams.rollers.races['2026-11-28'] = null;
    c.teams.rollers.races.soon = emptyRace();
    assert.equal(tidyRaces(c), true);
    assert.deepEqual(c.teams.rollers.races, {'2026-11-19': emptyRace(), '2026-11-28': emptyRace()});
    assert.equal(c.teams.sprockets.races['2026-11-19'].live, null);
    // a valid live stays; the other fields are left alone
    Object.assign(c.teams.rollers.races['2026-11-28'], {live: 'rc0001', start: '18:00', pinnedEventId: 4567890});
    assert.equal(tidyRaces(c), false);
    assert.deepEqual(c.teams.rollers.races['2026-11-28'], {...emptyRace(), live: 'rc0001', start: '18:00', pinnedEventId: 4567890});
    assertInvariants(c, 'tidy');
    // not club-shaped, a team that is no object, a team not converted yet: left alone
    assert.equal(tidyRaces(null), false);
    assert.equal(tidyRaces({teams: [], sheets: {}}), false);
    const raw = pre('staggered');
    raw.teams.gone = null;
    assert.equal(tidyRaces(raw), false);
    assert.equal(Object.hasOwn(raw.teams.rollers, 'races'), false);
    assert.equal(tidyRaces(c, 'nobody'), false);
    // emptyRace is a new object each time
    assert.notEqual(emptyRace(), emptyRace());
    assert.deepEqual(emptyRace(), {start: null, pinnedEventId: null, eventId: null, boundAt: null, live: null});
});


test('raceOf and racesOf: own keys only', () => {
    const c = dump();
    toRaces(c);
    assert.equal(raceOf(c, 'rollers', '2026-11-24'), c.teams.rollers.races['2026-11-24']);
    assert.equal(raceOfSheet(c, c.sheets.a00003), c.teams.rollers.races['2026-11-24']);
    assert.equal(raceOfSheet(c, c.sheets.a00012), c.teams['sunday-specials'].races['2026-11-29']);
    assert.equal(raceOf(c, 'rollers', '2026-11-25'), null);
    assert.equal(raceOf(c, 'gone', '2026-11-24'), null);
    for (const k of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
        assert.equal(raceOf(c, k, '2026-11-24'), null, k);
        assert.equal(raceOf(c, 'rollers', k), null, k);
        assert.deepEqual(racesOf(c, k), [], k);
    }
    assert.equal(raceOfSheet(c, {team: 'gone', date: '2026-11-24'}), null);
    assert.deepEqual(racesOf(c, 'rollers').map(([d]) => d), ['2026-11-17', '2026-11-24']);
    assert.equal(racesOf(c, 'rollers')[1][1], c.teams.rollers.races['2026-11-24']);
    assert.deepEqual(racesOf(c, 'gone'), []);
    // by date, whatever the stored order
    c.teams.cogs.races = {'2026-11-29': emptyRace(), '2026-11-22': emptyRace(), '2026-11-24': emptyRace()};
    assert.deepEqual(racesOf(c, 'cogs').map(([d]) => d), ['2026-11-22', '2026-11-24', '2026-11-29']);
    // a team that is no object, or not converted yet
    c.teams.odd = null;
    assert.deepEqual(racesOf(c, 'odd'), []);
    assert.equal(raceOf(c, 'odd', '2026-11-24'), null);
    const raw = pre('staggered');
    assert.deepEqual(racesOf(raw, 'rollers'), []);
    assert.equal(raceOf(raw, 'rollers', '2026-11-19'), null);
    assert.equal(raceOf(null, 'rollers', '2026-11-19'), null);
});


test('convertClub: logs each dropped link', () => {
    const c = dump();
    assert.equal(convertClub(c, T('2026-11-21T08:00:00Z')), true);
    assert.deepEqual(c.log.slice(-2), [
        {at: '2026-11-21T08:00:00.000Z', what: 'race-link-dropped', team: 'rollers', label: '5123456 (Tue 24 Nov)'},
        {at: '2026-11-21T08:00:00.000Z', what: 'race-link-dropped', team: 'sunday-specials', label: '5130001 (Sun 22 Nov)'},
    ]);
    assert.equal(convertClub(c, T('2026-11-21T09:00:00Z')), false);
    assert.equal(c.log.filter(e => e.what === 'race-link-dropped').length, 2);
    // a newer version of the live plan: its own words
    const newer = pre('pinned');
    newer.sheets.ra0002 = {...structuredClone(newer.sheets.ra0001), plan: 'ra0001', n: 2, at: '2026-11-19T16:00:00.000Z', pinnedEventId: 4567892};
    assert.equal(convertClub(newer, T('2026-11-21T08:00:00Z')), true);
    assert.deepEqual(newer.log, [
        {at: '2026-11-21T08:00:00.000Z', what: 'race-link-newer-dropped', team: 'rollers', label: '4567892 (Thu 19 Nov)'},
        {at: '2026-11-21T08:00:00.000Z', what: 'race-link-dropped', team: 'rollers', label: '4567999 (Thu 19 Nov)'},
    ]);
    assert.equal(newer.teams.rollers.races['2026-11-19'].pinnedEventId, 4567890);
    // odd data never throws: not club-shaped, a zone it cannot use, a log that is no list
    assert.equal(convertClub(null, T('2026-11-21T08:00:00Z')), false);
    const odd = pre('pinned');
    odd.tz = 'Nowhere/Else';
    assert.equal(convertClub(odd, T('2026-11-21T08:00:00Z')), true);
    assert.deepEqual(odd.log, [{at: '2026-11-21T08:00:00.000Z', what: 'race-link-dropped', team: 'rollers', label: '4567999 (2026-11-19)'}]);
    const noLog = pre('pinned');
    noLog.log = 'lost';
    assert.equal(convertClub(noLog, T('2026-11-21T08:00:00Z')), true);
    assert.equal(noLog.log, 'lost');
});


// paceline.db in memory at schema 2, with `clubs` and `trash` rows ([cid, json]).
function schema2({clubs = [], trash = []}) {
    const sql = new DatabaseSync(':memory:');
    assert.equal(migrate(sql, MIGRATIONS.slice(0, 2)), 2);
    for (const [cid, json] of clubs) {
        sql.prepare('INSERT INTO clubs (cid, json) VALUES (?, ?)').run(cid, json);
    }
    for (const [cid, json] of trash) {
        sql.prepare('INSERT INTO trash (cid, json, name, name_key, slugs, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(cid, json, 'Spokesmen CC', 'spokesmen cc', '["rollers"]', '2026-11-01T10:00:00.000Z', '2026-11-18T10:00:00.000Z');
    }
    return sql;
}

const json = (sql, table, cid) => sql.prepare(`SELECT json FROM ${table} WHERE cid = ?`).get(cid).json;


test('racesStep: converts the clubs and trash rows in the caller\'s transaction and skips what it cannot read', () => {
    const inTrash = {...pre('staggered'), id: 'p2m8c4t1v9', name: 'Spokesmen CC'};
    const rows = {
        clubs: [['k7f3q9x2m4', JSON.stringify(dump())], ['q9w8e7r6t5', 'not json']],
        trash: [['p2m8c4t1v9', JSON.stringify(inTrash)], ['z1x2c3v4b5', '{']],
    };
    const sql = schema2(rows);
    const now = T('2026-11-21T08:00:00Z');
    const lines = [];
    const warnings = [];
    const opts = {now, log: l => lines.push(l), warn: l => warnings.push(l)};

    // in the caller's transaction: a rollback takes it back
    sql.exec('BEGIN');
    assert.deepEqual(racesStep(sql, opts), {clubs: 1, trashed: 1});
    assert.equal(sql.isTransaction, true);
    sql.exec('ROLLBACK');
    assert.equal(json(sql, 'clubs', 'k7f3q9x2m4'), rows.clubs[0][1]);
    assert.equal(json(sql, 'trash', 'p2m8c4t1v9'), rows.trash[0][1]);

    lines.length = 0;
    warnings.length = 0;
    sql.exec('BEGIN');
    assert.deepEqual(racesStep(sql, opts), {clubs: 1, trashed: 1});
    sql.exec('COMMIT');
    assert.deepEqual(lines, ['paceline-server: paceline.db: schema 3 (races): 1 clubs and 1 trashed clubs converted']);
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /clubs row q9w8e7r6t5 .*left as it is/);
    assert.match(warnings[1], /trash row z1x2c3v4b5 .*left as it is/);
    for (const [table, cid] of [['clubs', 'k7f3q9x2m4'], ['trash', 'p2m8c4t1v9']]) {
        const c = JSON.parse(json(sql, table, cid));
        assert.equal(c.id, cid);
        for (const [slug, team] of Object.entries(c.teams)) {
            assert.equal(typeof team.races, 'object', `${cid} ${slug}`);
            assert.equal(Object.hasOwn(team, 'live'), false, `${cid} ${slug}`);
        }
        assertInvariants(c, cid);
        // the club's race day goes from the stored row (races spec §4c)
        assert.equal(Object.hasOwn(c, 'weekday'), false, `${cid}: no club weekday`);
    }
    // the dump's club raced on Tuesdays (2): its weekly teams that followed it have that day as their
    // own, Sprockets keeps its 4, the special teams none
    const converted = JSON.parse(json(sql, 'clubs', 'k7f3q9x2m4'));
    assert.deepEqual(Object.fromEntries(Object.entries(converted.teams).map(([s, t]) => [s, t.weekday])),
        {rollers: 2, sprockets: 4, cogs: 2, 'sunday-specials': null, oldies: null});
    // the trashed club had none: its weekly teams got Thursday
    const trashed = JSON.parse(json(sql, 'trash', 'p2m8c4t1v9'));
    assert.deepEqual(Object.fromEntries(Object.entries(trashed.teams).map(([s, t]) => [s, t.weekday])), {rollers: 4, sprockets: 4});
    // the club log names the dropped links
    assert.deepEqual(converted.log.filter(e => e.what === 'race-link-dropped').map(e => e.label), ['5123456 (Tue 24 Nov)', '5130001 (Sun 22 Nov)']);
    // the trash row's other columns as they were
    assert.deepEqual({...sql.prepare('SELECT name, slugs, deleted_at FROM trash WHERE cid = ?').get('p2m8c4t1v9')},
        {name: 'Spokesmen CC', slugs: '["rollers"]', deleted_at: '2026-11-18T10:00:00.000Z'});
    // the rows it cannot read: byte for byte
    assert.equal(json(sql, 'clubs', 'q9w8e7r6t5'), 'not json');
    assert.equal(json(sql, 'trash', 'z1x2c3v4b5'), '{');

    // a second run: nothing to do, no line
    lines.length = 0;
    const kept = json(sql, 'clubs', 'k7f3q9x2m4');
    sql.exec('BEGIN');
    assert.deepEqual(racesStep(sql, opts), {clubs: 0, trashed: 0});
    sql.exec('COMMIT');
    assert.deepEqual(lines, []);
    assert.equal(json(sql, 'clubs', 'k7f3q9x2m4'), kept);
    sql.close();
});


test('racesStep: odd rows convert without throwing and lose no plan; a club over the size cap is written and named', () => {
    const broken = pre('pinned');
    broken.teams.gone = null;
    broken.sheets.xx0001 = 'not a version';
    const big = {...pre('special'), id: 'p2m8c4t1v9', padding: 'x'.repeat(MAX_CLUB_BYTES)};
    const rows = {
        clubs: [
            ['k7f3q9x2m4', JSON.stringify(broken)],
            ['p2m8c4t1v9', JSON.stringify(big)],
            ['a1b2c3d4e5', 'null'],
            ['f6g7h8j9k1', '{"teams": 1, "sheets": {}}'],
        ],
        trash: [['z1x2c3v4b5', '[1, 2]']],
    };
    const sql = schema2(rows);
    const lines = [];
    const warnings = [];
    sql.exec('BEGIN');
    assert.deepEqual(racesStep(sql, {now: T('2026-11-21T08:00:00Z'), log: l => lines.push(l), warn: l => warnings.push(l)}), {clubs: 2, trashed: 0});
    sql.exec('COMMIT');
    assert.deepEqual(lines, ['paceline-server: paceline.db: schema 3 (races): 2 clubs and 0 trashed clubs converted']);

    const c = JSON.parse(json(sql, 'clubs', 'k7f3q9x2m4'));
    assert.deepEqual(Object.keys(c.sheets).sort(), ['ra0001', 'rb0001', 'xx0001']);
    assert.equal(c.teams.gone, null);
    assert.equal(c.sheets.xx0001, 'not a version');
    assert.equal(c.teams.rollers.races['2026-11-19'].live, 'ra0001');
    const b = JSON.parse(json(sql, 'clubs', 'p2m8c4t1v9'));
    assert.equal(typeof b.teams.cogs.races, 'object');
    for (const [cid, text] of rows.clubs.slice(2).concat(rows.trash)) {
        const table = cid === 'z1x2c3v4b5' ? 'trash' : 'clubs';
        assert.equal(json(sql, table, cid), text, cid);
    }
    const said = warnings.join('\n');
    assert.match(said, /clubs row k7f3q9x2m4: team "gone", sheet "xx0001" not objects/);
    assert.match(said, /club p2m8c4t1v9 is \d+ bytes after the conversion, over the 2097152 limit; stored all the same/);
    for (const cid of ['a1b2c3d4e5', 'f6g7h8j9k1', 'z1x2c3v4b5']) {
        assert.match(said, new RegExp(`row ${cid} is not club-shaped`), cid);
    }
    sql.close();
});
