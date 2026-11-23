import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_TEAMS, MAX_PLANS, MAX_PLANS_PER_RACE, MAX_VERSIONS, MAX_RIDERS, MAX_SHEET_BYTES, MAX_CLUB_BYTES, MAX_LOG, KEEP_DAYS,
    TEAM_NAME_MAX, TYPE_MAX, RIDER_NAME_MAX,
    ClubError, newClub, addTeam, renameTeam, setStart, setKind, setRhythm, deleteTeam, uploadSheet, makeLive,
    deleteSheet, unpin, learnEvent, renamePlan, setRace, setRaceEvent, clubLists, removeRider, sweepClub, sweptSheets, clubBytes, addLog,
    isPrivate, setRiderCode, clearRiderCode, teamHint, isUsed,
    INBOX_MAX, INBOX_BYTES, ENTRY_BYTES, INBOX_KEEP_MS, RECEIVE_KEEP_MS, addEntry, entryOf, discardEntry, storeEntry, staleEntries, sweepInbox,
} from '../club.mjs';
import {plansOf, planOfId, freeVersionId, teamTypes, previousVersion} from '../plans.mjs';
import {plannedStart, servable, pickForRider} from '../select.mjs';
import {undoOffer} from '../team-view.mjs';
import {riderCodeHash, nameKey} from '../ids.mjs';
import {normalizePlan} from '../../pages/src/engine/plan.mjs';
import {club, sheet, planJson, T, CODE_SECRET, liveId, race, assertRaceShape} from './helpers.mjs';
import {tidyRaces} from '../races.mjs';


const NOW = T('2026-11-19T12:00Z');
const DATE = '2026-11-19';
const EIGHT = ['1001', '1002', '1003', '1004', '1005', '1006', '1007', '1008'];

function counter() {
    let n = 0;
    return () => `h${String(++n).padStart(5, '0')}`;
}

const noneTaken = () => false;

function clubError(code) {
    return e => e instanceof ClubError && e.code === code;
}

// A club with the given teams ([name, start]); returns the club, the slugs and an id counter.
function setup(teams = [['Kettenfett Rollers', '19:30']]) {
    const c = club();
    const slugs = teams.map(([name, start]) => addTeam(c, {name, start}, {slugTaken: noneTaken, now: NOW}));
    return {c, slugs, newId: counter()};
}

// A new plan, live, unless `extra` says otherwise. `type` is left out unless `extra` gives it: none
// for a new plan, the plan's for a version.
function upload(c, slug, json, extra = {}, {now = NOW, newId} = {}) {
    return uploadSheet(c, {
        slug, json, text: null, date: DATE, as: 'new', live: true, base: c.teams[slug]?.version,
        pinnedEventId: null, via: 'file', ...extra,
    }, {now, newId});
}


test('caps and limits have the spec values', () => {
    assert.deepEqual(
        [MAX_TEAMS, MAX_PLANS, MAX_PLANS_PER_RACE, MAX_VERSIONS, MAX_RIDERS, MAX_SHEET_BYTES, MAX_CLUB_BYTES, MAX_LOG,
            KEEP_DAYS, TEAM_NAME_MAX, TYPE_MAX, RIDER_NAME_MAX],
        [10, 8, 5, 20, 40, 65536, 2097152, 200, 7, 40, 30, 100]);
    const e = new ClubError('cap-teams', {max: 10});
    assert.ok(e instanceof Error);
    assert.equal(e.code, 'cap-teams');
    assert.deepEqual(e.vars, {max: 10});
    assert.deepEqual(new ClubError('changed').vars, {});
});


test('newClub: the spec shape, a bad zone is refused', () => {
    const c = newClub({id: 'k7f3q9x2m4', name: 'Kettenfett RC', email: 'captain@example.org', tz: 'Europe/Berlin', now: NOW});
    assert.deepEqual(c, {
        id: 'k7f3q9x2m4', name: 'Kettenfett RC', status: 'pending', email: 'captain@example.org',
        tz: 'Europe/Berlin', createdAt: new Date(NOW).toISOString(), confirmedAt: null, riderCode: null, tokens: [],
        teams: {}, sheets: {}, log: [], inbox: [],
    });
    assert.equal(Object.hasOwn(c, 'weekday'), false, 'no race day of the club: every weekly team has its own');
    assert.throws(() => newClub({id: 'k7f3q9x2m4', name: 'Kettenfett RC', email: 'captain@example.org', tz: 'Europe/Nowhere', now: NOW}));
    assert.throws(() => newClub({id: 'k7f3q9x2m4', name: 'Kettenfett RC', email: 'captain@example.org', tz: '', now: NOW}));
});


test('addTeam: global slugs, retired ones stay taken, 10 at most', () => {
    const c = club();
    const slugTaken = s => s === 'kettenfett-rollers';
    const slug = addTeam(c, {name: 'Kettenfett Rollers', start: '19:30'}, {slugTaken, now: NOW});
    assert.equal(slug, 'kettenfett-rollers-2');
    assert.deepEqual(c.teams[slug], {
        name: 'Kettenfett Rollers', start: '19:30', version: 1,
        changedAt: new Date(NOW).toISOString(), kind: 'weekly', weekday: 4, races: {},
    });
    // The club's own teams count as taken too.
    assert.equal(addTeam(c, {name: 'Kettenfett Rollers'}, {slugTaken, now: NOW}), 'kettenfett-rollers-3');
    assert.equal(c.teams['kettenfett-rollers-3'].start, null);
    for (let i = 3; i <= 10; i++) {
        addTeam(c, {name: `Team ${i}`, start: '19:30'}, {slugTaken, now: NOW});
    }
    assert.equal(Object.keys(c.teams).length, 10);
    assert.throws(() => addTeam(c, {name: 'Eleven', start: '19:30'}, {slugTaken, now: NOW}), clubError('cap-teams'));
    const d = club();
    assert.throws(() => addTeam(d, {name: 'x'.repeat(41)}, {slugTaken, now: NOW}), clubError('bad-name'));
    assert.throws(() => addTeam(d, {name: '  '}, {slugTaken, now: NOW}), clubError('bad-name'));
    assert.throws(() => addTeam(d, {name: 'Rollers', start: '7:30'}, {slugTaken, now: NOW}), clubError('bad-start'));
    assert.deepEqual(d.teams, {});
});


test('renameTeam, setStart, deleteTeam', () => {
    const {c, slugs: [slug], newId} = setup();
    upload(c, slug, planJson('Rollers fast', ['1001', '1002']), {}, {newId});
    const later = NOW + 60000;
    renameTeam(c, slug, '  Kettenfett   Wheels ', later);
    assert.equal(c.teams[slug].name, 'Kettenfett Wheels');
    assert.equal(c.teams[slug].version, 3);
    assert.equal(Object.hasOwn(c.teams[slug], 'undo'), false, 'no Undo any more');
    assert.equal(c.teams[slug].changedAt, new Date(later).toISOString());
    assert.throws(() => renameTeam(c, slug, 'x'.repeat(41), later), clubError('bad-name'));
    setStart(c, slug, '20:15', later);
    assert.equal(c.teams[slug].start, '20:15');
    assert.equal(c.teams[slug].version, 4);
    setStart(c, slug, null, later);
    assert.equal(c.teams[slug].start, null);
    assert.throws(() => setStart(c, slug, '24:00', later), clubError('bad-start'));
    assert.equal(c.teams[slug].version, 5);
    assert.equal(deleteTeam(c, slug, later), slug);
    assert.deepEqual(c.teams, {});
    assert.deepEqual(c.sheets, {});
    assert.equal(c.log.at(-1).what, 'team-delete');
});


test('setKind: kinds and weekdays', () => {
    const {c, slugs: [slug], newId} = setup();
    assert.equal(c.teams[slug].kind, 'weekly');
    assert.equal(c.teams[slug].weekday, 4);
    upload(c, slug, planJson('Rollers', ['1001']), {}, {newId});
    const later = NOW + 60000;
    const version = c.teams[slug].version;
    setKind(c, slug, {kind: 'special', weekday: null}, later);
    assert.equal(c.teams[slug].kind, 'special');
    assert.equal(c.teams[slug].weekday, null);
    assert.equal(c.teams[slug].version, version + 1);
    assert.equal(c.teams[slug].changedAt, new Date(later).toISOString());
    assert.deepEqual(c.log.at(-1), {at: new Date(later).toISOString(), what: 'team-kind', team: slug, label: 'special'});
    // weekly on Thursday, then on Tuesday
    setKind(c, slug, {kind: 'weekly', weekday: 4}, later);
    assert.equal(c.teams[slug].weekday, 4);
    assert.deepEqual(c.log.at(-1), {at: new Date(later).toISOString(), what: 'team-kind', team: slug, label: 'weekly, Thursday'});
    setKind(c, slug, {kind: 'weekly', weekday: 2}, later);
    assert.equal(c.teams[slug].weekday, 2);
    assert.deepEqual(c.log.at(-1), {at: new Date(later).toISOString(), what: 'team-kind', team: slug, label: 'weekly, Tuesday'});
    assert.equal(c.teams[slug].version, version + 3);
    // special again: its weekday goes, whatever was posted with it
    setKind(c, slug, {kind: 'special', weekday: 2}, later);
    assert.equal(c.teams[slug].weekday, null);
    setKind(c, slug, {kind: 'weekly', weekday: 2}, later);
    assert.equal(c.teams[slug].version, version + 5);
    // refused: nothing changes; a weekly team needs its own day (there is no club's day any more)
    const before = structuredClone(c);
    assert.throws(() => setKind(c, slug, {kind: 'monthly', weekday: null}, later), clubError('bad-kind'));
    assert.throws(() => setKind(c, slug, {kind: 'weekly', weekday: 8}, later), clubError('bad-weekday'));
    assert.throws(() => setKind(c, slug, {kind: 'weekly', weekday: null}, later), clubError('bad-weekday'));
    assert.throws(() => setKind(c, slug, {kind: 'special', weekday: 8}, later), clubError('bad-weekday'));
    for (const bad of [0, 2.5, '2', undefined]) {
        assert.throws(() => setKind(c, slug, {kind: 'weekly', weekday: bad}, later), clubError('bad-weekday'), String(bad));
    }
    assert.throws(() => setKind(c, 'gone', {kind: 'weekly', weekday: null}, later), clubError('not-found'));
    assert.deepEqual(c, before);
});


test('setRhythm: the race rhythm and a weekly team\'s start time in one, each only when it changes', () => {
    const {c, slugs: [slug]} = setup();
    const later = NOW + 60000;
    const team = c.teams[slug];
    const version = team.version;
    const log = () => c.log.slice(-2).map(e => [e.what, e.label]);
    // both
    assert.deepEqual(setRhythm(c, slug, {kind: 'weekly', weekday: 2, start: '20:05'}, later), {rhythm: true, start: true});
    assert.deepEqual([team.kind, team.weekday, team.start, team.version], ['weekly', 2, '20:05', version + 2]);
    assert.deepEqual(log(), [['team-kind', 'weekly, Tuesday'], ['team-start', '20:05']]);
    // nothing changed: nothing bumped, nothing logged
    const logged = c.log.length;
    assert.deepEqual(setRhythm(c, slug, {kind: 'weekly', weekday: 2, start: '20:05'}, later), {rhythm: false, start: false});
    assert.deepEqual([team.version, c.log.length], [version + 2, logged]);
    // the start alone, cleared
    assert.deepEqual(setRhythm(c, slug, {kind: 'weekly', weekday: 2, start: null}, later), {rhythm: false, start: true});
    assert.deepEqual([team.start, team.version, c.log.at(-1).what], [null, version + 3, 'team-start']);
    setRhythm(c, slug, {kind: 'weekly', weekday: 2, start: '19:30'}, later);
    // special ignores the start, even one that is no time: the stored one stays
    for (const start of ['21:00', null, '25:00']) {
        setRhythm(c, slug, {kind: 'special', weekday: null, start}, later);
        assert.deepEqual([team.kind, team.weekday, team.start], ['special', null, '19:30'], String(start));
    }
    // refused: nothing changes, also when the rhythm alone would have been fine
    const before = structuredClone(c);
    assert.throws(() => setRhythm(c, slug, {kind: 'weekly', weekday: 3, start: '25:00'}, later), clubError('bad-start'));
    assert.throws(() => setRhythm(c, slug, {kind: 'monthly', weekday: 3, start: '19:30'}, later), clubError('bad-kind'));
    assert.throws(() => setRhythm(c, slug, {kind: 'weekly', weekday: 8, start: '19:30'}, later), clubError('bad-weekday'));
    assert.throws(() => setRhythm(c, 'gone', {kind: 'weekly', weekday: 3, start: '19:30'}, later), clubError('not-found'));
    assert.deepEqual(c, before);
});


test('uploadSheet no longer writes lastDate', () => {
    const {c, slugs: [slug], newId} = setup();
    upload(c, slug, planJson('Rollers', ['1001']), {}, {newId});
    upload(c, slug, planJson('Rollers', ['1002']), {as: 'new', type: 'B', date: '2026-11-26', live: false}, {newId});
    assert.equal('lastDate' in c.teams[slug], false);
});


test('uploadSheet: stores the stripped sheet, live when the team has none', () => {
    const {c, slugs: [slug], newId} = setup();
    const r = upload(c, slug, planJson('Rollers fast', ['1001', '1002', '1003'], ['1004']), {}, {newId});
    const team = c.teams[slug];
    assert.equal(r.live, true);
    assert.equal(r.created, true);
    assert.equal(r.same, false);
    assert.equal(r.dropped, null);
    assert.equal(r.changedAt, null);
    assert.equal(liveId(c, slug), r.id);
    const s = c.sheets[r.id];
    assert.doesNotMatch(JSON.stringify(s.json), /"(height|ftp)"/);
    assert.equal(s.json.riders['1001'].weight, 70);
    assert.equal(s.label, 'Kettenfett Rollers', 'the team name; the JSON name is not used');
    assert.equal(s.uploadedAt, new Date(NOW).toISOString());
    assert.equal(team.version, 2);
    assert.equal(team.changedAt, new Date(NOW).toISOString());
    assert.deepEqual(Object.keys(s).sort(), [
        'at', 'date', 'json', 'jsonName', 'label', 'liveAt', 'n', 'plan', 'recSig', 'sig',
        'team', 'text', 'type', 'uploadedAt', 'via',
    ]);
    assert.equal(s.team, slug);
    assert.equal(s.date, DATE);
    assert.equal(s.sig, r.plan.sig);
    assert.equal(s.sig, normalizePlan(s.json, s.text).plan.sig);
    assert.deepEqual(r.plan.riders.map(x => x.id), ['1001', '1002', '1003']);
    assert.equal(Object.hasOwn(team, 'undo'), false, 'no Undo any more');
    assert.deepEqual(c.log.at(-1), {at: new Date(NOW).toISOString(), what: 'upload', team: slug, label: 'Kettenfett Rollers v1'});
});


test('uploadSheet: the label, the pinned event id as a Number, base', () => {
    const {c, slugs: [slug], newId} = setup();
    const a = upload(c, slug, planJson('', ['1001']), {}, {newId});
    assert.equal(c.sheets[a.id].label, 'Kettenfett Rollers');
    assert.equal(c.sheets[a.id].jsonName, null);
    const b = upload(c, slug, planJson('Rollers fast', ['1002']), {type: '  Rollers   B ', as: 'new', pinnedEventId: '4567890'}, {newId});
    assert.equal(c.sheets[b.id].type, 'Rollers B');
    assert.equal(c.sheets[b.id].label, 'Kettenfett Rollers · Rollers B');
    // the link is the race's
    assert.equal(race(c, slug, DATE).pinnedEventId, 4567890);
    assert.throws(() => upload(c, slug, planJson('Rollers fast', ['1001']), {type: 'y'.repeat(31), as: 'new'}, {newId}), clubError('bad-type'));
    // An upload by someone whose page shows an older version reports the team's last change.
    const before = c.teams[slug].changedAt;
    const r = upload(c, slug, planJson('Rollers C', ['1003']), {as: 'new', type: 'C', base: c.teams[slug].version - 1}, {now: NOW + 60000, newId});
    assert.equal(r.changedAt, before);
    assert.throws(() => upload(c, slug, planJson('Rollers C', ['1003']), {as: 'zzzzzz'}, {newId}), clubError('not-found'));
    assert.throws(() => upload(c, slug, {team: {name: 'Nobody'}, riders: {}}, {}, {newId}), clubError('bad-plan'));
});


test('uploadSheet: refused once the race is over (S + 2 h)', () => {
    const {c, slugs: [slug], newId} = setup();
    const json = planJson('Rollers fast', ['1001']);
    assert.throws(() => upload(c, slug, json, {}, {now: T('2026-11-19T20:30:00.001Z'), newId}), clubError('race-over'));
    assert.deepEqual(c.sheets, {});
    const r = upload(c, slug, json, {}, {now: T('2026-11-19T20:30Z'), newId});
    assert.equal(liveId(c, slug), r.id);
    assert.throws(() => upload(c, slug, json, {as: 'new', type: 'B', date: '2026-02-30'}, {newId}), clubError('bad-date'));
});


test('uploadSheet: staggered slots on one date', () => {
    const {c, slugs: [rollers, sprockets], newId} = setup([['Kettenfett Rollers', '19:30'], ['Kettenfett Sprockets', '19:40']]);
    const a = upload(c, rollers, planJson('Rollers fast', ['1001', '1002']), {}, {newId});
    const b = upload(c, sprockets, planJson('Sprockets', ['1003', '1004']), {}, {newId});
    assert.equal(a.live, true);
    assert.equal(b.live, true);
    assert.equal(liveId(c, rollers), a.id);
    assert.equal(liveId(c, sprockets), b.id);
    assert.equal(c.sheets[a.id].date, DATE);
    assert.equal(c.sheets[b.id].date, DATE);
});


test('uploadSheet: content caps', () => {
    const {c, slugs: [slug], newId} = setup();
    const many = Array.from({length: 41}, (_, i) => String(2001 + i));
    assert.throws(() => upload(c, slug, planJson('Big', many.slice(0, 30), many.slice(30)), {}, {newId}), clubError('cap-riders'));
    upload(c, slug, planJson('Big', many.slice(0, 30), many.slice(30, 40)), {as: 'new', live: false}, {newId});
    const long = planJson('Long', ['1001', '1002']);
    long.riders['1002'].name = 'n'.repeat(101);
    assert.throws(() => upload(c, slug, long, {}, {newId}), clubError('long-name'));
    long.riders['1002'].name = 'n'.repeat(100);
    upload(c, slug, long, {as: 'new', type: 'long', live: false}, {newId});
    // White space the 100-character check doesn't see (displayName trims it) is refused too,
    // for riders and the bench.
    long.riders['1002'].name = ' '.repeat(1000) + 'Cleo' + ' '.repeat(996);
    assert.throws(() => upload(c, slug, long, {}, {newId}), clubError('long-name'));
    const benchLong = planJson('Long', ['1001'], ['1003']);
    benchLong.roster['1003'].name = 'Dan' + ' '.repeat(1997);
    assert.throws(() => upload(c, slug, benchLong, {}, {newId}), clubError('long-name'));
    // A long team name in the export is dropped (it can't carry padding into the file), and so is
    // its planner name; a given type is stored cleaned.
    const longTeam = upload(c, slug, planJson('t'.repeat(70000), ['1001']),
        {type: '  Rollers   B' + ' '.repeat(60000), as: 'new', live: false}, {newId});
    assert.equal(c.sheets[longTeam.id].json.team, undefined);
    assert.equal(c.sheets[longTeam.id].jsonName, null);
    assert.equal(c.sheets[longTeam.id].type, 'Rollers B');
    assert.equal(c.sheets[longTeam.id].label, 'Kettenfett Rollers · Rollers B');
    // Rider and bench keys must be Zwift IDs: a 60 KB id is refused, not stored.
    const badId = planJson('Wide', ['1001']);
    badId.riders['9'.repeat(60000)] = {name: 'Cleo', order: 2, pull_duration: 60};
    assert.throws(() => upload(c, slug, badId, {}, {newId}), clubError('bad-plan'));
    const badBench = planJson('Wide', ['1001'], ['1002']);
    badBench.roster['1234567890123'] = {name: 'Dan'};
    assert.throws(() => upload(c, slug, badBench, {}, {newId}), clubError('bad-plan'));
    // The sheet size cap still holds for what stripSheet keeps: 40 names within RAW_NAME_MAX whose
    // trailing vertical tabs (trimmed, so within the 100 characters) are 6 bytes each in JSON.
    const wide = planJson('Wide', many.slice(0, 40));
    for (const r of Object.values(wide.riders)) {
        r.name = 'Cleo' + '\u000b'.repeat(396);
    }
    assert.throws(() => upload(c, slug, wide, {}, {newId}), clubError('cap-bytes'));
});


test('uploadSheet: caps', () => {
    // five plans for one race; a sixth is refused
    const {c, slugs: [slug], newId} = setup();
    for (const type of ['a', 'b', 'c', 'd', 'e']) {
        upload(c, slug, planJson('Rollers', ['1001']), {as: 'new', type, live: false}, {newId});
    }
    const version = c.teams[slug].version;
    assert.throws(() => upload(c, slug, planJson('Rollers', ['1001']), {as: 'new', type: 'f', live: false}, {newId}), e => {
        assert.ok(clubError('cap-race')(e));
        assert.deepEqual(e.vars, {team: 'Kettenfett Rollers', max: 5, day: 'Thu 19 Nov'});
        return true;
    });
    assert.equal(c.teams[slug].version, version);
    // another race is fine
    upload(c, slug, planJson('Rollers', ['1001']), {as: 'new', type: 'f', live: false, date: '2026-11-26'}, {newId});

    // Eight plans, one of them used up (dated a week ago, two versions): the ninth drops it whole.
    const d = setup();
    const t = d.slugs[0];
    for (let i = 0; i < 8; i++) {
        d.c.sheets[`a0000${i}`] = sheet({
            team: t, label: `V${i}`, date: i === 3 ? '2026-11-12' : '2026-11-26', riders: ['1001'],
            uploadedAt: '2026-11-10T10:00:00.000Z', plan: `a0000${i}`,
        });
    }
    d.c.sheets.a00033 = sheet({
        team: t, label: 'V3', date: '2026-11-12', riders: ['1002'], uploadedAt: '2026-11-11T10:00:00.000Z', plan: 'a00003', n: 2,
    });
    // in the races shape: no event field on a version, a race for every date
    for (const v of Object.values(d.c.sheets)) {
        delete v.pinnedEventId;
        delete v.eventId;
        delete v.boundAt;
    }
    tidyRaces(d.c);
    // the dropped plan was live for its race: the race goes with it (tidyRaces after the drops)
    const raced = structuredClone(d.c);
    race(raced, t, '2026-11-12').live = 'a00033';
    race(raced, t, '2026-11-26').live = 'a00000';
    const r = upload(d.c, t, planJson('Ninth', ['1002']), {as: 'new', live: false}, {newId: d.newId});
    assert.deepEqual(r.dropped, {kind: 'plan', label: 'V3', date: '2026-11-12'});
    assert.equal(Object.hasOwn(d.c.sheets, 'a00003'), false);
    assert.equal(Object.hasOwn(d.c.sheets, 'a00033'), false);
    assert.equal(plansOf(d.c, t).length, 8);
    assertRaceShape(d.c);
    assert.equal(race(d.c, t, '2026-11-12'), null);
    const rl = upload(raced, t, planJson('Ninth', ['1002']), {as: 'new', live: true}, {newId: counter()});
    assert.deepEqual(rl.dropped, {kind: 'plan', label: 'V3', date: '2026-11-12'});
    assertRaceShape(raced);
    assert.equal(race(raced, t, '2026-11-12'), null, 'the dropped live plan\'s race goes');
    assert.deepEqual([race(raced, t, DATE).live, race(raced, t, '2026-11-26').live], [rl.id, 'a00000'], 'the other races keep theirs');
    // none used up: refused, nothing changes
    const full = d.c.teams[t].version;
    assert.throws(() => upload(d.c, t, planJson('Tenth', ['1002']), {as: 'new', type: 'x', live: false}, {newId: d.newId}),
        clubError('cap-sheets'));
    assert.equal(d.c.teams[t].version, full);
    // A version in a full team is fine.
    upload(d.c, t, planJson('Ninth', ['1003']), {as: r.id, live: false}, {newId: d.newId});

    // Twenty versions, v1 not live: the 21st drops v1. The plan keeps v1's id: `as` and planOfId
    // still find it by that id, and no new version ever gets it.
    const e = setup();
    const u = e.slugs[0];
    const v1 = upload(e.c, u, planJson('Rollers', ['1001']), {as: 'new', live: false}, {newId: e.newId});
    for (let i = 2; i <= 20; i++) {
        upload(e.c, u, planJson('Rollers', [String(1000 + i)]), {as: v1.id, live: false}, {newId: e.newId});
    }
    assert.equal(plansOf(e.c, u)[0].versions.length, 20);
    const r21 = upload(e.c, u, planJson('Rollers', ['1021']), {as: v1.id, live: false}, {newId: e.newId});
    assert.deepEqual(r21.dropped, {kind: 'version', n: 1, label: 'Kettenfett Rollers'});
    assert.equal(Object.hasOwn(e.c.sheets, v1.id), false);
    assert.equal(r21.n, 21);
    assert.equal(r21.planId, v1.id);
    assert.equal(planOfId(e.c, u, v1.id).id, v1.id);
    assert.equal(planOfId(e.c, u, v1.id).versions.length, 20);
    assert.throws(() => freeVersionId(e.c, () => v1.id), /no free version id/);
    const r22 = upload(e.c, u, planJson('Rollers', ['1022']), {as: v1.id, live: false}, {newId: e.newId});
    assert.equal(r22.planId, v1.id);
    assert.equal(r22.n, 22);
    assert.deepEqual(r22.dropped, {kind: 'version', n: 2, label: 'Kettenfett Rollers'});

    // With v1 live, v2 goes instead, never v1.
    const f = setup();
    const w = f.slugs[0];
    const live = upload(f.c, w, planJson('Rollers', ['1001']), {as: 'new', live: true}, {newId: f.newId});
    for (let i = 2; i <= 20; i++) {
        upload(f.c, w, planJson('Rollers', [String(1000 + i)]), {as: live.id, live: false}, {newId: f.newId});
    }
    const v2 = plansOf(f.c, w)[0].versions[1][0];
    const out = upload(f.c, w, planJson('Rollers', ['1021']), {as: live.id, live: false}, {newId: f.newId});
    assert.deepEqual(out.dropped, {kind: 'version', n: 2, label: 'Kettenfett Rollers'});
    assert.equal(Object.hasOwn(f.c.sheets, live.id), true);
    assert.equal(Object.hasOwn(f.c.sheets, v2), false);
    assert.equal(liveId(f.c, w), live.id);
});


test('a new version keeps v1 and goes live', () => {
    const {c, slugs: [slug], newId} = setup();
    const first = upload(c, slug, planJson('Rollers fast', ['1001', '1002', '1003']), {}, {newId});
    const v1 = structuredClone(c.sheets[first.id]);
    const r = upload(c, slug, planJson('Rollers fast', ['1003', '1002', '1001']), {as: first.id}, {now: NOW + 60000, newId});
    assert.notEqual(r.id, first.id);
    assert.equal(r.planId, first.id);
    assert.equal(r.n, 2);
    assert.equal(r.created, false);
    assert.equal(r.live, true, 'with the box on, a version of the live plan goes live');
    assert.equal(liveId(c, slug), r.id);
    assert.deepEqual(c.sheets[first.id], v1);
    assert.equal(c.log.at(-1).label, 'Kettenfett Rollers v2');
});


test('a version keeps the race\'s learned event without a link; a given link drops it', () => {
    const {c, slugs: [slug], newId} = setup();
    const {id} = upload(c, slug, planJson('Rollers fast', ['1001']), {}, {newId});
    assert.equal(learnEvent(c, id, 4567890, NOW), true);
    upload(c, slug, planJson('Rollers fast', ['1002']), {as: id}, {newId});
    assert.equal(race(c, slug, DATE).eventId, 4567890);
    assert.equal(race(c, slug, DATE).boundAt, new Date(NOW).toISOString());
    upload(c, slug, planJson('Rollers fast', ['1003']), {as: id, pinnedEventId: 4567899}, {newId});
    assert.equal(race(c, slug, DATE).eventId, null);
    assert.equal(race(c, slug, DATE).boundAt, null);
    assert.equal(race(c, slug, DATE).pinnedEventId, 4567899);
    // the date of a version is its plan's
    const v4 = upload(c, slug, planJson('Rollers fast', ['1004']), {as: id, date: '2026-11-26'}, {newId});
    assert.equal(c.sheets[v4.id].date, DATE);
    assert.equal(race(c, slug, DATE).pinnedEventId, 4567899);
    assert.equal(race(c, slug, '2026-11-26'), null);
});


test('makeLive keeps upload times', () => {
    const {c, slugs: [slug], newId} = setup();
    const a = upload(c, slug, planJson('Rollers fast', ['1001']), {}, {newId});
    const b = upload(c, slug, planJson('Rollers slow', ['1002']), {as: 'new', type: 'slow', live: false}, {now: NOW + 60000, newId});
    const uploaded = c.sheets[b.id].uploadedAt;
    const version = c.teams[slug].version;
    makeLive(c, slug, b.id, NOW + 3600000);
    assert.equal(liveId(c, slug), b.id);
    assert.equal(c.sheets[b.id].uploadedAt, uploaded);
    assert.equal(c.sheets[a.id].uploadedAt, new Date(NOW).toISOString());
    assert.equal(c.teams[slug].version, version + 1);
    assert.equal(c.log.at(-1).what, 'live');
});


test('deleteSheet, unpin, learnEvent', () => {
    const {c, slugs: [slug], newId} = setup();
    const a = upload(c, slug, planJson('Rollers fast', ['1001']), {}, {newId});
    const b = upload(c, slug, planJson('Rollers pinned', ['1002']), {as: 'new', type: 'pinned', live: false, pinnedEventId: 4567890}, {newId});
    deleteSheet(c, slug, a.id, NOW);
    assert.equal(liveId(c, slug), null);
    assert.equal(Object.hasOwn(c.sheets, a.id), false);
    assert.equal(c.log.at(-1).what, 'delete');

    const version = c.teams[slug].version;
    assert.equal(learnEvent(c, b.id, 4567891, NOW), false);
    unpin(c, slug, b.id, NOW);
    assert.equal(race(c, slug, DATE).pinnedEventId, null);
    assert.equal(c.teams[slug].version, version + 1);
    assert.equal(c.log.at(-1).what, 'unpin');

    const logged = c.log.length;
    const v = c.teams[slug].version;
    assert.equal(learnEvent(c, b.id, '4567891', NOW), true);
    assert.equal(race(c, slug, DATE).eventId, 4567891);
    assert.equal(race(c, slug, DATE).boundAt, new Date(NOW).toISOString());
    assert.equal(c.teams[slug].version, v);
    assert.equal(c.log.length, logged);
    assert.equal(learnEvent(c, b.id, 4567892, NOW), false);
    assert.equal(race(c, slug, DATE).eventId, 4567891);
    assert.equal(learnEvent(c, b.id, 'x', NOW), false);
    assert.throws(() => learnEvent(c, 'zzzzzz', 4567891, NOW), clubError('not-found'));
});


test('clubLists: live or stored, rider or bench', () => {
    const {c, slugs: [slug], newId} = setup();
    upload(c, slug, planJson('Rollers', ['1001', '1002'], ['1003']), {}, {newId});
    upload(c, slug, planJson('Rollers old', ['1004']), {as: 'new', type: 'old', live: false}, {newId});
    assert.equal(clubLists(c, '1001'), true);
    assert.equal(clubLists(c, '1003'), true);
    assert.equal(clubLists(c, '1004'), true);
    assert.equal(clubLists(c, 1002), true);
    assert.equal(clubLists(c, '1009'), false);
    assert.equal(clubLists(c, '__proto__'), false);
    assert.equal(clubLists(club(), '1001'), false);
});


test('removeRider: every sheet, a new code, an empty sheet goes', () => {
    const {c, slugs: [rollers, sprockets], newId} = setup([['Kettenfett Rollers', '19:30'], ['Kettenfett Sprockets', '19:40']]);
    const text = [
        {name: 'Ben', pullWatts: 400, pullS: 60, colorName: 'Red', colorHex: '#ff0000'},
        {name: 'Cleo', pullWatts: 380, pullS: 60, colorName: 'Red', colorHex: '#ff0000'},
    ];
    const a = upload(c, rollers, planJson('Rollers fast', ['1001', '1002', '1003']), {text}, {newId});
    const b = upload(c, sprockets, planJson('Sprockets', ['1004', '1005'], ['1001']), {}, {newId});
    const solo = upload(c, sprockets, planJson('Sprockets solo', ['1006']), {as: 'new', type: 'solo', live: false}, {newId});
    const sigA = c.sheets[a.id].sig;
    const versions = [c.teams[rollers].version, c.teams[sprockets].version];
    assert.equal(removeRider(c, '1001', NOW), 2);
    for (const id of [a.id, b.id]) {
        const s = c.sheets[id];
        assert.equal(Object.hasOwn(s.json.riders, '1001'), false, id);
        assert.equal(Object.hasOwn(s.json.roster || {}, '1001'), false, id);
        assert.equal(s.sig, normalizePlan(s.json, s.text).plan.sig, id);
    }
    assert.notEqual(c.sheets[a.id].sig, sigA);
    assert.doesNotMatch(JSON.stringify(c.sheets[a.id]), /Ben/);
    assert.deepEqual(c.sheets[a.id].text.map(t => t.name), ['Cleo']);
    assert.deepEqual([c.teams[rollers].version, c.teams[sprockets].version], versions.map(v => v + 1));
    assert.deepEqual(c.log.at(-1), {at: new Date(NOW).toISOString(), what: 'rider-remove'});

    assert.equal(removeRider(c, '1006', NOW), 1);
    assert.equal(Object.hasOwn(c.sheets, solo.id), false);
    assert.equal(liveId(c, sprockets), b.id);
    assert.doesNotMatch(JSON.stringify(c.log), /1001|1006/);
    assert.equal(removeRider(c, '__proto__', NOW), 0);

    // A live one-rider sheet goes, and so does the live pointer; a deleted plan lists him nowhere.
    const d = setup();
    const s = d.slugs[0];
    const x = upload(d.c, s, planJson('Rollers fast', ['1001']), {}, {newId: d.newId});
    assert.equal(removeRider(d.c, 1001, NOW), 1);
    assert.equal(Object.hasOwn(d.c.sheets, x.id), false);
    assert.equal(liveId(d.c, s), null);
    const e = setup();
    const t = e.slugs[0];
    const y = upload(e.c, t, planJson('Rollers fast', ['1001', '1002']), {}, {newId: e.newId});
    deleteSheet(e.c, t, y.id, NOW);
    assert.equal(removeRider(e.c, '1001', NOW), 0);
    assert.doesNotMatch(JSON.stringify(e.c), /"1001"/);
});


test('sweepClub: whole plans, no "last two"', () => {
    const {c, slugs: [rollers, sprockets]} = setup([['Kettenfett Rollers', '19:30'], ['Kettenfett Sprockets', '19:40']]);
    const add = (id, team, date, plan, n = 1) => {
        c.sheets[id] = sheet({team, label: id, date, riders: ['1001'], uploadedAt: `${date}T10:00:00.000Z`, plan, n});
    };
    add('a00005', rollers, '2026-11-05', 'a00005');
    add('a00055', rollers, '2026-11-05', 'a00005', 2);
    add('a00012', rollers, '2026-11-12', 'a00012');
    add('a00122', rollers, '2026-11-12', 'a00012', 2);
    add('a00014', rollers, '2026-11-14', 'a00014');
    add('a00026', rollers, '2026-11-26', 'a00026');
    add('b00012', sprockets, '2026-11-12', 'b00012');
    tidyRaces(c);
    race(c, rollers, '2026-11-12').live = 'a00122';
    const now = T('2026-11-20T12:00Z');   // cutoff 13 Nov
    // the read-only dry run names exactly what sweepClub deletes, and changes nothing
    const copy = structuredClone(c);
    assert.deepEqual(sweptSheets(c, now).sort(), ['a00005', 'a00012', 'a00055', 'a00122', 'b00012']);
    assert.deepEqual(c, copy);
    assert.equal(sweepClub(c, now), 5);
    assert.deepEqual(Object.keys(c.sheets).sort(), ['a00014', 'a00026']);
    assert.equal(liveId(c, rollers), null);
    assert.equal(sweepClub(c, now), 0);
    assert.deepEqual(sweptSheets(c, now), []);
});


test('sweepClub: a plan goes by its newest version, with all its versions', () => {
    const {c, slugs: [slug]} = setup();
    c.sheets.a00001 = sheet({team: slug, label: 'x', date: '2026-11-05', riders: ['1001'], uploadedAt: '2026-11-05T10:00:00.000Z', plan: 'a00001'});
    c.sheets.a00002 = sheet({team: slug, label: 'x', date: '2026-11-05', riders: ['1002'], uploadedAt: '2026-11-05T11:00:00.000Z', plan: 'a00001', n: 2});
    assert.deepEqual(sweptSheets(c, T('2026-11-12T12:00Z')), []);
    assert.deepEqual(sweptSheets(c, T('2026-11-13T12:00Z')).sort(), ['a00001', 'a00002']);
});


test('types survive the sweep of all plans', () => {
    const {c, slugs: [slug], newId} = setup();
    const before = T('2026-11-05T10:00Z');
    upload(c, slug, planJson('Rollers', ['1001']), {as: 'new', type: 'fast', date: '2026-11-05'}, {now: before, newId});
    upload(c, slug, planJson('Rollers', ['1002']), {as: 'new', type: 'slow', date: '2026-11-05', live: false}, {now: before, newId});
    assert.equal(sweepClub(c, T('2026-11-20T12:00Z')), 2);
    assert.deepEqual(c.sheets, {});
    assert.deepEqual(teamTypes(c, slug), ['slow', 'fast']);
    renameTeam(c, slug, 'Kettenfett Racers', NOW);
    assert.deepEqual(teamTypes(c, slug), ['slow', 'fast']);
    deleteTeam(c, slug, NOW);
    assert.equal(Object.hasOwn(c.teams, slug), false);
    assert.deepEqual(teamTypes(c, slug), []);
});


test('rider code: on, new, off, never in the log', () => {
    const c = newClub({id: 'k7f3q9x2m4', name: 'Kettenfett RC', email: 'captain@example.org', tz: 'Europe/Berlin', now: NOW});
    assert.equal(c.riderCode, null);
    assert.equal(isPrivate(c), false);
    // An older club without the field counts as open.
    assert.equal(isPrivate(club()), false);

    const first = riderCodeHash('7Q4MZ2KX9B', CODE_SECRET);
    setRiderCode(c, first, NOW);
    assert.equal(isPrivate(c), true);
    assert.deepEqual(c.riderCode, {hash: first, setAt: new Date(NOW).toISOString()});
    assert.deepEqual(c.log.at(-1), {at: new Date(NOW).toISOString(), what: 'code-on'});

    const second = riderCodeHash('R1D3R0NE5X', CODE_SECRET);
    setRiderCode(c, second, NOW + 1000);
    assert.deepEqual(c.riderCode, {hash: second, setAt: new Date(NOW + 1000).toISOString()});
    assert.deepEqual(c.log.at(-1), {at: new Date(NOW + 1000).toISOString(), what: 'code-new'});

    clearRiderCode(c, NOW + 2000);
    assert.equal(c.riderCode, null);
    assert.equal(isPrivate(c), false);
    assert.deepEqual(c.log.at(-1), {at: new Date(NOW + 2000).toISOString(), what: 'code-off'});
    assert.deepEqual(c.log.map(e => e.what), ['code-on', 'code-new', 'code-off']);

    // Clearing an open club does nothing.
    clearRiderCode(c, NOW + 3000);
    assert.equal(c.log.length, 3);

    const log = JSON.stringify(c.log);
    for (const s of [first, second, '7Q4MZ2KX9B', 'R1D3R0NE5X']) {
        assert.ok(!log.includes(s), s);
    }

    assert.throws(() => setRiderCode(c, 'x', NOW), TypeError);
    assert.throws(() => setRiderCode(c, first.toUpperCase(), NOW), TypeError);
    assert.throws(() => setRiderCode(c, '7Q4MZ2KX9B', NOW), TypeError);
    assert.equal(c.riderCode, null);
    assert.equal(c.log.length, 3);
});


test('clubBytes and addLog', () => {
    const c = club();
    assert.equal(clubBytes(c), Buffer.byteLength(JSON.stringify(c)));
    for (let i = 0; i < 205; i++) {
        addLog(c, {at: String(i), what: 'upload'});
    }
    assert.equal(c.log.length, 200);
    assert.equal(c.log[0].at, '5');
    assert.equal(c.log.at(-1).at, '204');
});


test('ids from requests never touch the prototype', () => {
    const {c, slugs: [slug], newId} = setup();
    const {id} = upload(c, slug, planJson('Rollers fast', ['1001']), {}, {newId});
    assert.throws(() => deleteSheet(c, '__proto__', 'constructor', NOW), clubError('not-found'));
    assert.throws(() => makeLive(c, 'constructor', 'h3k9q2', NOW), clubError('not-found'));
    assert.throws(() => makeLive(c, slug, 'constructor', NOW), clubError('not-found'));
    assert.throws(() => deleteSheet(c, slug, '__proto__', NOW), clubError('not-found'));
    assert.throws(() => unpin(c, slug, 'valueOf', NOW), clubError('not-found'));
    assert.throws(() => learnEvent(c, '__proto__', 4567890, NOW), clubError('not-found'));
    assert.throws(() => renameTeam(c, 'hasOwnProperty', 'X', NOW), clubError('not-found'));
    assert.throws(() => setStart(c, '__proto__', '19:30', NOW), clubError('not-found'));
    assert.throws(() => deleteTeam(c, 'constructor', NOW), clubError('not-found'));
    assert.throws(() => upload(c, '__proto__', planJson('x', ['1001']), {}, {newId}), clubError('not-found'));
    // A sheet of another team is not found either.
    const other = addTeam(c, {name: 'Kettenfett Sprockets', start: '19:40'}, {slugTaken: noneTaken, now: NOW});
    assert.throws(() => makeLive(c, other, id, NOW), clubError('not-found'));
    assert.equal(({}).live, undefined);
    assert.equal(({}).version, undefined);
});


test('the live log entry names the plan and the version', () => {
    // team cockpit spec §5.6: "v2" alone is ambiguous with two plans
    const {c, slugs: [slug], newId} = setup([['Rollers', '19:30']]);
    const fast = upload(c, slug, planJson('Rollers fast', ['1001', '1002']), {type: 'fast'}, {newId});
    const slow = upload(c, slug, planJson('Rollers slow', ['1001', '1003']), {type: 'slow', live: false}, {newId});
    upload(c, slug, planJson('Rollers fast', ['1002', '1001']), {as: fast.id, live: false}, {newId});
    makeLive(c, slug, slow.id, NOW + 60000);
    assert.deepEqual(c.log.at(-1), {at: new Date(NOW + 60000).toISOString(), what: 'live', team: slug, label: 'Rollers · slow v1'});
    // the same file again with the live box: its newest version goes live
    const same = upload(c, slug, planJson('Rollers fast', ['1002', '1001']), {as: fast.id, live: true}, {now: NOW + 120000, newId});
    assert.equal(same.same, true);
    assert.deepEqual(c.log.at(-1), {at: new Date(NOW + 120000).toISOString(), what: 'live', team: slug, label: 'Rollers · fast v2'});
});


test('makeLive: a stale version is refused, the current one and none are not', () => {
    // UI panel, 19 Nov 2026: Make live carries the team's version the page was drawn with
    const {c, slugs: [slug], newId} = setup();
    const {id: a} = upload(c, slug, planJson('Rollers fast', ['1001']), {type: 'fast'}, {newId});
    const {id: b} = upload(c, slug, planJson('Rollers slow', ['1002']), {type: 'slow', live: false}, {newId});
    const drawn = c.teams[slug].version;
    makeLive(c, slug, b, NOW, {version: String(drawn)});
    assert.equal(liveId(c, slug), b);
    const kept = structuredClone(c);
    assert.throws(() => makeLive(c, slug, a, NOW, {version: String(drawn)}), clubError('changed'));
    assert.deepEqual(c, kept, 'nothing changed');
    makeLive(c, slug, a, NOW);
    assert.equal(liveId(c, slug), a);
});


test('teamHint: name first, overlap second', () => {
    const {c, slugs: [rollers, sprockets], newId} = setup([['Rollers', '19:30'], ['Sprockets', '19:40']]);
    const ids = json => Object.keys(json.riders);
    // a name: the planner name of another team's version (keys ignore case, spaces and punctuation)
    upload(c, sprockets, planJson('Sprockets fast', ['1009']), {}, {newId});
    let json = planJson('Sprockets fast', ['1001', '1002']);
    assert.deepEqual(teamHint(c, rollers, json, ids(json), NOW), {kind: 'name', team: 'sprockets'});
    json = planJson(' sprockets-FAST ', ['1001', '1002']);
    assert.deepEqual(teamHint(c, rollers, json, ids(json), NOW), {kind: 'name', team: 'sprockets'});
    // or another team's name
    json = planJson('Sprockets', ['1001']);
    assert.deepEqual(teamHint(c, rollers, json, ids(json), NOW), {kind: 'name', team: 'sprockets'});
    // its own team's name or planner name: no hint
    json = planJson('Rollers', ['1001']);
    assert.equal(teamHint(c, rollers, json, ids(json), NOW), null);
    // a name without a key (one character, non-Latin, emoji only) never matches
    for (const name of ['S', 'Спрокетс', '🚲🚲']) {
        json = planJson(name, ['1001']);
        assert.equal(teamHint(c, rollers, json, ids(json), NOW), null, name);
    }

    // an overlap: 7 of this sheet's 8 riders ride in Sprockets' live sheet
    const EIGHT_S = ['1001', '1002', '1003', '1004', '1005', '1006', '1007', '1009'];
    upload(c, sprockets, planJson('Sprockets', EIGHT_S), {as: 'new', type: 'B', live: true}, {newId});
    json = planJson('Rollers new', EIGHT);
    assert.deepEqual(teamHint(c, rollers, json, ids(json), NOW), {kind: 'overlap', team: 'sprockets', shared: 7, total: 8});
    // a matching name and an overlap together: the name
    json = planJson('Sprockets fast', EIGHT);
    assert.deepEqual(teamHint(c, rollers, json, ids(json), NOW), {kind: 'name', team: 'sprockets'});
    // below 60 %: 4 of 8
    json = planJson('Rollers new', ['1001', '1002', '1003', '1004', '1010', '1011', '1012', '1013']);
    assert.equal(teamHint(c, rollers, json, ids(json), NOW), null);
    // 5 of 8 is 62.5 %
    json = planJson('Rollers new', ['1001', '1002', '1003', '1004', '1005', '1011', '1012', '1013']);
    assert.deepEqual(teamHint(c, rollers, json, ids(json), NOW), {kind: 'overlap', team: 'sprockets', shared: 5, total: 8});
    // this team's live sheet shares as many: no hint
    upload(c, rollers, planJson('Rollers fast', EIGHT), {as: 'new', live: true}, {newId});
    json = planJson('Rollers new', EIGHT);
    assert.equal(teamHint(c, rollers, json, ids(json), NOW), null);
    // bench listings do not count as riders
    json = planJson('Rollers new', ['1010', '1011'], EIGHT_S);
    assert.equal(teamHint(c, rollers, json, ids(json), NOW), null);
});


test('a version keeps its race\'s event link when none is given', () => {
    const {c, slugs: [slug], newId} = setup();
    const {id} = upload(c, slug, planJson('Rollers fast', ['1001']), {pinnedEventId: 4567890}, {newId});
    // the field left empty: the race keeps its link
    const v2 = upload(c, slug, planJson('Rollers fast', ['1002']), {as: id}, {newId});
    assert.strictEqual(race(c, slug, DATE).pinnedEventId, 4567890);
    assert.equal(race(c, slug, DATE).eventId, null);
    // a new link wins: the race's, for every version (they carry none)
    const v3 = upload(c, slug, planJson('Rollers fast', ['1003']), {as: id, pinnedEventId: 4567899}, {newId});
    assert.strictEqual(race(c, slug, DATE).pinnedEventId, 4567899, 'a new link replaces it');
    // a new plan of the race has the race's link; a plan of another date, another race, has none
    const other = upload(c, slug, planJson('Rollers B', ['1004']), {as: 'new', type: 'B', live: false}, {newId}).id;
    assert.strictEqual(race(c, slug, DATE).pinnedEventId, 4567899);
    const later = upload(c, slug, planJson('Rollers B', ['1004']), {as: 'new', type: 'B', live: false, date: '2026-11-26'}, {newId}).id;
    assert.strictEqual(race(c, slug, '2026-11-26').pinnedEventId, null);
    for (const vid of [id, v2.id, v3.id, other, later]) {
        assert.equal(Object.hasOwn(c.sheets[vid], 'pinnedEventId'), false, vid);
    }
});


test('Restore went with the team cockpit: club.mjs has no backTo', async () => {
    const club = await import('../club.mjs');
    assert.equal(Object.hasOwn(club, 'backTo'), false);
});


test('uploadSheet: a new version gets its own id, the plan\'s id and n + 1', () => {
    const {c, slugs: [slug], newId} = setup();
    const v1 = upload(c, slug, planJson('Rollers fast', ['1001', '1002']), {as: 'new', live: true}, {newId});
    const s1 = c.sheets[v1.id];
    assert.equal(s1.plan, v1.id);
    assert.equal(v1.planId, v1.id);
    assert.equal(s1.n, 1);
    assert.equal(v1.n, 1);
    assert.equal(s1.at, new Date(NOW).toISOString());
    assert.equal(s1.uploadedAt, s1.at);
    assert.equal(Object.hasOwn(s1, 'copyOf'), false);                         // Restore went: no copyOf is written
    assert.equal(s1.jsonName, nameKey('Rollers fast'));
    assert.equal(s1.jsonName, 'rollersfast');
    assert.equal(s1.recSig, s1.sig);
    assert.equal(s1.type, null);
    assert.equal(s1.label, 'Kettenfett Rollers');
    assert.equal(s1.via, 'file');
    assert.deepEqual([v1.prev, v1.created, v1.same], [null, true, false]);
    const copy = structuredClone(s1);
    const later = NOW + 60000;
    const v2 = upload(c, slug, planJson('Rollers fast', ['1002', '1001']), {as: v1.id, live: true, via: 'paste'}, {now: later, newId});
    assert.notEqual(v2.id, v1.id);
    const s2 = c.sheets[v2.id];
    assert.equal(s2.plan, v1.id);
    assert.equal(v2.planId, v1.id);
    assert.equal(s2.n, 2);
    assert.equal(v2.n, 2);
    assert.equal(v2.prev, v1.id);
    assert.deepEqual([v2.created, v2.same, v2.live], [false, false, true]);
    assert.equal(s2.at, new Date(later).toISOString());
    assert.equal(s2.uploadedAt, s2.at);
    assert.equal(s2.via, 'paste');
    assert.deepEqual(c.sheets[v1.id], copy);
    // any other `via` is stored as a file upload
    const v3 = upload(c, slug, planJson('Rollers fast', ['1003']), {as: v1.id, live: true, via: 'back'}, {newId});
    assert.equal(c.sheets[v3.id].via, 'file');
});


test('uploadSheet: as names a plan by any of its versions\' ids', () => {
    const {c, slugs: [slug], newId} = setup();
    const v1 = upload(c, slug, planJson('Rollers fast', ['1001']), {as: 'new', live: true}, {newId});
    const v2 = upload(c, slug, planJson('Rollers fast', ['1002']), {as: v1.id, live: true}, {newId});
    const v3 = upload(c, slug, planJson('Rollers fast', ['1003']), {as: v2.id, live: true}, {newId});
    assert.equal(c.sheets[v3.id].plan, v1.id);
    assert.equal(v3.n, 3);
    assert.equal(v3.prev, v2.id);
    assert.equal(plansOf(c, slug).length, 1);
});


test('uploadSheet: a Store as a version ignores a posted type; Rename is the only way to change a plan\'s type', () => {
    const {c, slugs: [slug], newId} = setup([['Rollers', '19:30']]);
    const v1 = upload(c, slug, planJson('Rollers fast', ['1001']), {type: 'fast'}, {newId});
    for (const [type, riders] of [['quick', ['1002']], ['', ['1003']], [undefined, ['1004']]]) {
        const v = upload(c, slug, planJson('Rollers fast', riders), {as: v1.id, type}, {newId});
        assert.deepEqual([c.sheets[v.id].type, c.sheets[v.id].label], ['fast', 'Rollers · fast'], String(type));
    }
    assert.deepEqual([c.sheets[v1.id].type, plansOf(c, slug)[0].type], ['fast', 'fast']);
    assert.deepEqual(teamTypes(c, slug), ['fast']);                       // a posted type is not remembered
    const again = upload(c, slug, planJson('Rollers fast', ['1004']), {as: v1.id, type: 'other'}, {newId});
    assert.equal(again.same, true);                                       // the same file with another type posted stores nothing
    renamePlan(c, slug, v1.planId, 'quick', NOW, {version: c.teams[slug].version});
    assert.deepEqual([...new Set(plansOf(c, slug)[0].versions.map(([, s]) => s.label))], ['Rollers · quick']);
});


test('uploadSheet: a version keeps the plan\'s date', () => {
    const {c, slugs: [slug], newId} = setup();
    const v1 = upload(c, slug, planJson('Rollers fast', ['1001']), {type: 'fast'}, {newId});
    const v2 = upload(c, slug, planJson('Rollers fast', ['1002']), {as: v1.id, date: '2026-11-26'}, {newId});
    assert.deepEqual([c.sheets[v2.id].date, c.sheets[v2.id].label], ['2026-11-19', 'Kettenfett Rollers · fast']);
});


test('liveAt: the time a version last became its race\'s live version; a Store that is not live sets none', () => {
    const {c, slugs: [slug], newId} = setup([['Rollers', '19:30']]);
    const at = hm => T(`2026-11-19T${hm}:00Z`);
    const z = hm => `2026-11-19T${hm}:00.000Z`;
    const v = () => c.teams[slug].version;
    const v1 = upload(c, slug, planJson('Rollers', ['1001', '1002']), {}, {now: at('10:00'), newId}).id;            // Store and make live
    const v2 = upload(c, slug, planJson('Rollers', ['1001', '1003']), {as: v1, live: false}, {now: at('10:05'), newId}).id;
    assert.deepEqual([c.sheets[v1].liveAt, Object.hasOwn(c.sheets[v2], 'liveAt')], [z('10:00'), false]);
    makeLive(c, slug, v2, at('10:10'), {version: v()});
    makeLive(c, slug, v2, at('10:11'), {version: v()});                                                               // live already: the time stays
    assert.deepEqual([c.sheets[v2].liveAt, c.sheets[v1].liveAt], [z('10:10'), z('10:00')]);
    makeLive(c, slug, v1, at('10:12'), {version: v()});                                                               // an older version, directly
    assert.deepEqual([race(c, slug, DATE).live, c.sheets[v1].liveAt], [v1, z('10:12')]);
    const u = undoOffer(c, slug, at('10:13'));
    makeLive(c, slug, u.id, at('10:13'), {version: u.version, undo: false});                                          // Undo brings v2 back
    assert.deepEqual([race(c, slug, DATE).live, c.sheets[v2].liveAt], [v2, z('10:13')]);
    makeLive(c, slug, v1, at('10:20'), {version: v()});
    const same = upload(c, slug, planJson('Rollers', ['1001', '1003']), {as: v1, live: true}, {now: at('10:25'), newId});   // v2's file again, with the box
    assert.deepEqual([same.same, same.id, race(c, slug, DATE).live, c.sheets[v2].liveAt], [true, v2, v2, z('10:25')]);
});


test('liveAt: a new version stored live gets the time', () => {
    const {c, slugs: [slug], newId} = setup([['Rollers', '19:30']]);
    const at = hm => T(`2026-11-19T${hm}:00Z`);
    const z = hm => `2026-11-19T${hm}:00.000Z`;
    const v1 = upload(c, slug, planJson('Rollers', ['1001']), {}, {now: at('10:00'), newId}).id;
    const v2 = upload(c, slug, planJson('Rollers', ['1002']), {as: v1, live: true}, {now: at('10:05'), newId}).id;   // a new version, live
    assert.deepEqual([c.sheets[v1].liveAt, c.sheets[v2].liveAt], [z('10:00'), z('10:05')]);
});


test('makeLive: an older version of another plan of the race becomes the live version, and riders get its own label', () => {
    const {c, slugs: [slug], newId} = setup([['Rollers', '19:30']]);
    const at = hm => T(`2026-11-19T${hm}:00Z`);
    const NOW2 = at('18:40');
    const a1 = upload(c, slug, planJson('Rollers fast', ['1001']), {type: 'fast'}, {now: at('10:00'), newId});
    const a2 = upload(c, slug, planJson('Rollers fast', ['1001', '1002']), {as: a1.id}, {now: at('10:01'), newId});
    const b1 = upload(c, slug, planJson('Rollers slow', ['1001']), {type: 'slow', live: false}, {now: at('10:02'), newId});
    const b2 = upload(c, slug, planJson('Rollers slow', ['1001', '1003']), {as: b1.id, live: false}, {now: at('10:03'), newId});
    assert.equal(race(c, slug, DATE).live, a2.id);
    makeLive(c, slug, b1.id, at('10:10'), {version: c.teams[slug].version});
    assert.equal(race(c, slug, DATE).live, b1.id);
    assert.deepEqual(servable(c, NOW2).map(s => s.id), [b1.id]);
    assert.equal(pickForRider(c, '1001', {now: NOW2}).sheet.label, 'Rollers · slow');
    assert.equal(undoOffer(c, slug, at('10:11')).id, a2.id);
    assert.deepEqual([c.sheets[a2.id].liveAt, c.sheets[b1.id].liveAt, Object.hasOwn(c.sheets[b2.id], 'liveAt')],
        ['2026-11-19T10:01:00.000Z', '2026-11-19T10:10:00.000Z', false]);
});


test('uploadSheet: a version without a link leaves the race\'s event fields as they are, live or not', () => {
    const {c, slugs: [slug], newId} = setup();
    const v1 = upload(c, slug, planJson('Rollers fast', ['1001']), {as: 'new', live: true, pinnedEventId: 4567890}, {newId});
    const v2 = upload(c, slug, planJson('Rollers fast', ['1002']), {as: v1.id, live: false}, {newId});
    const v3 = upload(c, slug, planJson('Rollers fast', ['1003']), {as: v1.id, live: false}, {newId});
    assert.equal(v3.n, 3);
    assert.equal(race(c, slug, DATE).pinnedEventId, 4567890);
    // the link removed and an event learned while v2 is live
    makeLive(c, slug, v2.id, NOW);
    unpin(c, slug, v2.id, NOW);
    assert.equal(learnEvent(c, v2.id, 111, T('2026-11-19T11:30:00.000Z')), true);
    upload(c, slug, planJson('Rollers fast', ['1004']), {as: v1.id, live: false}, {newId});
    assert.deepEqual(race(c, slug, DATE), {start: null, pinnedEventId: null, eventId: 111, boundAt: '2026-11-19T11:30:00.000Z', live: v2.id});
    // a plan that is not live: the same
    race(c, slug, DATE).live = null;
    upload(c, slug, planJson('Rollers fast', ['1005']), {as: v1.id, live: false}, {newId});
    assert.deepEqual(race(c, slug, DATE), {start: null, pinnedEventId: null, eventId: 111, boundAt: '2026-11-19T11:30:00.000Z', live: null});
});


test('uploadSheet: refusals', () => {
    const {c, slugs: [rollers, sprockets], newId} = setup([['Kettenfett Rollers', '19:30'], ['Kettenfett Sprockets', '19:40']]);
    const theirs = upload(c, sprockets, planJson('Sprockets', ['1009']), {as: 'new', live: true}, {newId});
    const json = planJson('Rollers fast', ['1001']);
    assert.throws(() => upload(c, rollers, json, {as: theirs.id, live: true}, {newId}), clubError('not-found'));
    assert.throws(() => upload(c, rollers, json, {as: 'zzzzzz', live: true}, {newId}), clubError('not-found'));
    assert.throws(() => upload(c, rollers, json, {as: '__proto__', live: true}, {newId}), clubError('not-found'));
    c.sheets.pp0012 = sheet({
        team: rollers, label: 'Kettenfett Rollers', date: '2026-11-12', riders: ['1001'], uploadedAt: '2026-11-12T10:00:00.000Z',
        plan: 'pp0012',
    });
    assert.throws(() => upload(c, rollers, json, {as: 'pp0012', live: true}, {newId}), e => {
        assert.ok(clubError('plan-used')(e));
        assert.deepEqual(e.vars, {label: 'Kettenfett Rollers'});
        return true;
    });
    assert.throws(() => upload(c, rollers, json, {as: 'new', live: true, date: '2026-11-12'}, {newId}), clubError('race-over'));
    // the content checks come first
    assert.throws(() => upload(c, rollers, {team: {name: 'x'}, riders: {}}, {as: 'pp0012', live: true}, {newId}), clubError('bad-plan'));
    assert.equal(c.teams[rollers].version, 1);
});


test('uploadSheet: live on and off', () => {
    const {c, slugs: [slug], newId} = setup();
    const v1 = upload(c, slug, planJson('Rollers fast', ['1001']), {as: 'new', live: true}, {newId});
    const v2 = upload(c, slug, planJson('Rollers fast', ['1002']), {as: v1.id, live: false}, {newId});
    assert.equal(liveId(c, slug), v1.id);
    assert.equal(v2.live, false);
    const v3 = upload(c, slug, planJson('Rollers fast', ['1003']), {as: v1.id, live: true}, {newId});
    assert.equal(liveId(c, slug), v3.id);
    assert.equal(v3.live, true);
    const other = upload(c, slug, planJson('Rollers slow', ['1004']), {as: 'new', type: 'slow', live: false}, {newId});
    assert.equal(other.live, false);
    assert.equal(liveId(c, slug), v3.id);
});


test('uploadSheet: identical content stores no version, the live box still applies', () => {
    const {c, slugs: [slug], newId} = setup();
    const v1 = upload(c, slug, planJson('Rollers fast', ['1001', '1002']), {as: 'new', type: 'fast', live: true}, {newId});
    const v2 = upload(c, slug, planJson('Rollers fast', ['1003']), {as: v1.id, live: false}, {newId});
    const count = Object.keys(c.sheets).length;
    const {version} = c.teams[slug];
    const log = c.log.length;
    const later = NOW + 60000;
    const same = upload(c, slug, planJson('Rollers fast', ['1003']), {as: v1.id, live: false}, {now: later, newId});
    assert.deepEqual(same, {
        id: v2.id, planId: v1.id, n: 2, prev: v1.id, live: false, created: false, same: true, dropped: null,
        changedAt: null, plan: same.plan, startMoved: null, linkMoved: null,
    });
    assert.deepEqual(same.plan.riders.map(r => r.id), ['1003']);
    assert.equal(Object.keys(c.sheets).length, count);
    assert.equal(c.teams[slug].version, version);
    assert.equal(c.log.length, log);
    assert.equal(liveId(c, slug), v1.id);
    // the type given again, same as the plan's: still the same
    assert.equal(upload(c, slug, planJson('Rollers fast', ['1003']), {as: v1.id, type: ' fast', live: false}, {newId}).same, true);
    // with the live box on, the newest version goes live: a bump and a log entry, no new version
    const on = upload(c, slug, planJson('Rollers fast', ['1003']), {as: v2.id, live: true}, {now: later, newId});
    assert.equal(on.same, true);
    assert.equal(on.id, v2.id);
    assert.equal(on.live, true);
    assert.equal(liveId(c, slug), v2.id);
    assert.equal(c.teams[slug].version, version + 1);
    assert.equal(Object.keys(c.sheets).length, count);
    assert.deepEqual(c.log.at(-1), {at: new Date(later).toISOString(), what: 'live', team: slug, label: 'Kettenfett Rollers · fast v2'});
    // another type posted for a version is ignored: still the same file, no version (Rename retypes a plan)
    const typed = upload(c, slug, planJson('Rollers fast', ['1003']), {as: v1.id, type: 'slow', live: true}, {newId});
    assert.equal(typed.same, true);
    assert.equal(typed.n, 2);
    // so is other text
    const text = [{name: 'Dan', pullWatts: 380, pullS: 60, colorName: 'Red', colorHex: '#ff0000'}];
    const texted = upload(c, slug, planJson('Rollers fast', ['1003']), {as: v1.id, text, live: true}, {newId});
    assert.equal(texted.same, false);
    assert.equal(texted.n, 3);
});


test('uploadSheet: same content with another event link stores no version; the race gets the link', () => {
    const {c, slugs: [slug], newId} = setup();
    const v1 = upload(c, slug, planJson('Rollers fast', ['1001']), {as: 'new', live: true}, {newId});
    const version = c.teams[slug].version;
    const linked = upload(c, slug, planJson('Rollers fast', ['1001']), {as: v1.id, live: true, pinnedEventId: 4567890}, {now: NOW + 60000, newId});
    assert.equal(linked.same, true);
    assert.equal(linked.id, v1.id);
    assert.equal(linked.n, 1);
    assert.deepEqual(Object.keys(c.sheets), [v1.id]);
    assert.equal(race(c, slug, DATE).pinnedEventId, 4567890);
    assert.equal(c.teams[slug].version, version + 1);
    assert.deepEqual(c.log.at(-1), {at: new Date(NOW + 60000).toISOString(), what: 'race-link', team: slug, label: 'Thu 19 Nov · 4567890'});
    // the same link again, or none (the race keeps its): the same, nothing changes
    const logged = c.log.length;
    assert.equal(upload(c, slug, planJson('Rollers fast', ['1001']), {as: v1.id, live: true, pinnedEventId: 4567890}, {newId}).same, true);
    assert.equal(upload(c, slug, planJson('Rollers fast', ['1001']), {as: v1.id, live: true}, {newId}).same, true);
    assert.equal(c.teams[slug].version, version + 1);
    assert.equal(c.log.length, logged);
    assert.equal(race(c, slug, DATE).pinnedEventId, 4567890);
});


test('uploadSheet: types are unique within a race; one plan may have none', () => {
    const {c, slugs: [slug], newId} = setup();
    const first = upload(c, slug, planJson('Rollers', ['1001']), {as: 'new', live: true}, {newId});
    assert.equal(c.sheets[first.id].label, 'Kettenfett Rollers');
    assert.throws(() => upload(c, slug, planJson('Rollers', ['1002']), {as: 'new', live: false}, {newId}), e => {
        assert.ok(clubError('type-needed')(e));
        assert.deepEqual(e.vars, {team: 'Kettenfett Rollers', day: 'Thu 19 Nov'});
        return true;
    });
    assert.throws(() => upload(c, slug, planJson('Rollers', ['1002']), {as: 'new', type: '  ', live: false}, {newId}),
        clubError('type-needed'));
    const fast = upload(c, slug, planJson('Rollers', ['1002']), {as: 'new', type: '  FAST ', live: false}, {newId});
    assert.equal(c.sheets[fast.id].type, 'FAST');
    assert.equal(c.sheets[fast.id].label, 'Kettenfett Rollers · FAST');
    // the typeless plan's next version stays typeless (a posted type is ignored)
    const v2 = upload(c, slug, planJson('Rollers', ['1003']), {as: first.id, live: true}, {newId});
    assert.equal(c.sheets[v2.id].type, null);
    const v3 = upload(c, slug, planJson('Rollers', ['1004']), {as: first.id, type: '', live: true}, {newId});
    assert.equal(c.sheets[v3.id].type, null);
    assert.throws(() => upload(c, slug, planJson('Rollers', ['1005']), {as: 'new', type: 'fast', live: false}, {newId}), e => {
        assert.ok(clubError('type-taken')(e));
        assert.deepEqual(e.vars, {type: 'fast', team: 'Kettenfett Rollers', day: 'Thu 19 Nov'});
        return true;
    });
    // another race
    const next = upload(c, slug, planJson('Rollers', ['1005']), {as: 'new', live: false, date: '2026-11-26'}, {newId});
    assert.equal(c.sheets[next.id].type, null);
    // a plan retyped (Rename: the only way once it is stored)
    const version = () => c.teams[slug].version;
    assert.throws(() => renamePlan(c, slug, first.id, 'Fast', NOW, {version: version()}), clubError('type-taken'));
    renamePlan(c, slug, first.id, 'slow', NOW, {version: version()});
    const slow = upload(c, slug, planJson('Rollers', ['1006']), {as: first.id, live: true}, {newId});
    assert.equal(c.sheets[slow.id].label, 'Kettenfett Rollers · slow');
    // now the race has no typeless plan: FAST may drop its type
    renamePlan(c, slug, fast.id, '', NOW, {version: version()});
    const bare = upload(c, slug, planJson('Rollers', ['1007']), {as: fast.id, live: false}, {newId});
    assert.equal(c.sheets[bare.id].type, null);
    assert.throws(() => upload(c, slug, planJson('Rollers', ['1001']), {as: 'new', type: 'x'.repeat(31), live: false}, {newId}), e => {
        assert.ok(clubError('bad-type')(e));
        assert.equal(e.vars.max, 30);
        return true;
    });
    assert.throws(() => upload(c, slug, planJson('Rollers', ['1001']), {as: 'new', type: 'a​b', live: false}, {newId}),
        clubError('bad-type'));
    upload(c, slug, planJson('Rollers', ['1001']), {as: 'new', type: 'x'.repeat(30), live: false}, {newId});
});


test('renameTeam: the stored versions\' labels follow', () => {
    const {c, slugs: [slug], newId} = setup();
    const fast = upload(c, slug, planJson('Rollers', ['1001']), {as: 'new', type: 'fast', live: true}, {newId});
    const fast2 = upload(c, slug, planJson('Rollers', ['1002']), {as: fast.id, live: true}, {newId});
    const bare = upload(c, slug, planJson('Rollers', ['1003']), {as: 'new', live: false}, {newId});
    renameTeam(c, slug, 'Kettenfett Racers', NOW);
    assert.deepEqual([fast.id, fast2.id, bare.id].map(id => c.sheets[id].label),
        ['Kettenfett Racers · fast', 'Kettenfett Racers · fast', 'Kettenfett Racers']);
    assert.equal(c.sheets[fast.id].type, 'fast');
});


test('makeLive with any version; delete removes the whole plan; unpin clears the race\'s link', () => {
    const {c, slugs: [slug], newId} = setup();
    const v1 = upload(c, slug, planJson('Rollers', ['1001']), {as: 'new', live: true, pinnedEventId: 4567890}, {newId});
    const v2 = upload(c, slug, planJson('Rollers', ['1002']), {as: v1.id, live: true}, {newId});
    const other = upload(c, slug, planJson('Rollers', ['1003']), {as: 'new', type: 'B', live: false}, {newId});
    makeLive(c, slug, v1.id, NOW);
    assert.equal(liveId(c, slug), v1.id);
    // unpin on v2: the race loses the link, for every plan of it
    assert.equal(race(c, slug, DATE).pinnedEventId, 4567890);
    unpin(c, slug, v2.id, NOW);
    assert.equal(race(c, slug, DATE).pinnedEventId, null);
    assert.deepEqual([c.log.at(-1).what, c.log.at(-1).label], ['unpin', 'Thu 19 Nov'], 'the race\'s link: the log names its day');
    // delete by v2: v1 and v2 go, the live pointer too; the other plan stays
    deleteSheet(c, slug, v2.id, NOW);
    assert.equal(Object.hasOwn(c.sheets, v1.id), false);
    assert.equal(Object.hasOwn(c.sheets, v2.id), false);
    assert.equal(liveId(c, slug), null);
    assert.deepEqual(Object.keys(c.sheets), [other.id]);
    assert.deepEqual(c.log.at(-1), {at: new Date(NOW).toISOString(), what: 'delete', team: slug, label: 'Kettenfett Rollers'});
});


test('removeRider: every version; sig follows the content, recSig stays; plans counted', () => {
    const {c, slugs: [rollers, sprockets], newId} = setup([['Kettenfett Rollers', '19:30'], ['Kettenfett Sprockets', '19:40']]);
    const v1 = upload(c, rollers, planJson('Rollers', ['1001', '1002']), {as: 'new', live: false}, {newId});
    const v2 = upload(c, rollers, planJson('Rollers', ['1001', '1003']), {as: v1.id, live: false}, {newId});
    const v3 = upload(c, rollers, planJson('Rollers', ['1001']), {as: v1.id, live: true}, {newId});
    const sp = upload(c, sprockets, planJson('Sprockets', ['1004', '1001'], ['1006']), {as: 'new', live: true}, {newId});
    const untouched = upload(c, sprockets, planJson('Sprockets', ['1005']), {as: 'new', type: 'B', live: false}, {newId});
    const before = structuredClone(c.sheets);
    assert.equal(removeRider(c, '1001', NOW), 2);
    for (const id of [v1.id, v2.id, sp.id]) {
        const s = c.sheets[id];
        assert.notEqual(s.sig, before[id].sig, id);
        assert.equal(s.sig, normalizePlan(s.json, s.text).plan.sig, id);
        assert.equal(s.recSig, before[id].recSig, id);
        assert.equal(s.recSig, before[id].sig, id);
        assert.doesNotMatch(JSON.stringify(s.json), /"1001"/, id);
    }
    assert.equal(Object.hasOwn(c.sheets, v3.id), false, 'a version with only Ben goes');
    assert.equal(liveId(c, rollers), null);
    assert.deepEqual(c.sheets[untouched.id], before[untouched.id]);
    // every earlier sig stays in pastSigs, so a recording made in between still finds the version
    assert.deepEqual(c.sheets[sp.id].pastSigs, [before[sp.id].sig]);
    assert.equal(c.sheets[untouched.id].pastSigs, undefined);
    const w = upload(c, sprockets, planJson('Sprockets', ['1007', '1008', '1009']), {as: 'new', type: 'C', live: false}, {newId});
    const first = c.sheets[w.id].sig;
    assert.equal(removeRider(c, '1007', NOW), 1);
    const middle = c.sheets[w.id].sig;
    assert.equal(removeRider(c, '1008', NOW), 1);
    assert.deepEqual(c.sheets[w.id].pastSigs, [first, middle]);
    assert.equal(c.sheets[w.id].recSig, first);
});


test('teamHint: the planner name matches other teams\' names and jsonName, not labels', () => {
    const {c, slugs: [rollers, sprockets], newId} = setup([['Rollers', '19:30'], ['Sprockets', '19:40']]);
    const r = upload(c, sprockets, planJson('Sprockets A', ['1009']), {as: 'new', type: 'fast', live: true}, {newId});
    assert.equal(c.sheets[r.id].label, 'Sprockets · fast');
    assert.equal(c.sheets[r.id].jsonName, 'sprocketsa');
    let json = planJson('Sprockets fast', ['1001']);
    assert.equal(teamHint(c, rollers, json, Object.keys(json.riders), NOW), null);
    json = planJson('Sprockets A', ['1001']);
    assert.deepEqual(teamHint(c, rollers, json, Object.keys(json.riders), NOW), {kind: 'name', team: 'sprockets'});
});


test('uploadSheet: no plan chosen is refused; only live true makes it live', () => {
    const {c, slugs: [slug], newId} = setup();
    const file = structuredClone(c);
    // no plan chosen (the assign page with nothing preselected): refused after the content checks
    for (const as of [null, undefined, '']) {
        assert.throws(() => upload(c, slug, planJson('Rollers fast', EIGHT), {as}, {newId}), clubError('pick-plan'));
    }
    assert.throws(() => upload(c, slug, {team: {name: 'x'}, riders: {x: {}}}, {as: null}, {newId}), clubError('bad-plan'));
    assert.deepEqual(c, file, 'nothing stored');
    // the box: only true makes it live, null or a string is off (no defaults any more)
    for (const live of [null, undefined, 'on', 1]) {
        const r = upload(c, slug, planJson('Rollers fast', EIGHT), {as: 'new', type: `t${String(live)}`, live}, {newId});
        assert.equal(r.live, false, String(live));
        assert.equal(liveId(c, slug), null);
    }
    const v1 = upload(c, slug, planJson('Rollers fast', EIGHT), {as: 'new', type: 'fast', live: true}, {newId});
    assert.equal(liveId(c, slug), v1.id);
    // a new version of the live plan with the box off stays not live
    const v2 = upload(c, slug, planJson('Rollers fast', EIGHT.slice(1)), {as: v1.id, live: false}, {newId});
    assert.equal(v2.planId, v1.id);
    assert.equal(liveId(c, slug), v1.id);
});


test('inbox: the spec values, a new club has an empty inbox', () => {
    // 10 entries and 320 KB until the received plans' list (coordinator, 19 Nov 2026): 20 and 640 KB,
    // one entry still at most 320 KB; a received entry waits 7 days
    assert.deepEqual([INBOX_MAX, INBOX_BYTES, ENTRY_BYTES, INBOX_KEEP_MS, RECEIVE_KEEP_MS], [20, 655360, 327680, 86400000, 604800000]);
    assert.deepEqual(club().inbox, []);
});


// ---- the inbox (plan versions spec §4.1, §5) ----

const HOUR = 3600000;

// A bulky planner export, 40 to 60 KB: 40 riders and 40 on the bench, 100-code-point names of 4-byte
// emoji, one text row each (the caps of checkPlan are not applied here). Returns {json, text}.
function bulky(tag) {
    const json = planJson('Rollers', []);
    const text = [];
    for (let i = 0; i < 40; i++) {
        const id = String(2000 + i);
        const name = `${tag}${String(i).padStart(2, '0')}`.padEnd(100, '\u{1F6B4}');
        json.riders[id] = {name, weight: 70, ftp: 250, order: i + 1, pull_duration: 60, color: '#ff0000'};
        json.roster[String(3000 + i)] = {name: name.replace(/^./, 'b'), weight: 70, ftp: 250};
        text.push({name, pullWatts: 400, pullS: 60, colorName: 'Red', colorHex: '#ff0000'});
        text.push({name: name.replace(/^./, 'b'), pullWatts: 400, pullS: 60, colorName: 'Red', colorHex: '#ff0000'});
    }
    return {json, text};
}

const entryArgs = (json, extra = {}) => ({source: 'upload', team: 'rollers', json, text: null, ...extra});


test('inbox: the spec values, a new club has an empty inbox', () => {
    // 10 entries and 320 KB until the received plans' list (coordinator, 19 Nov 2026): 20 and 640 KB,
    // one entry still at most 320 KB; a received entry waits 7 days
    assert.deepEqual([INBOX_MAX, INBOX_BYTES, ENTRY_BYTES, INBOX_KEEP_MS, RECEIVE_KEEP_MS], [20, 655360, 327680, 86400000, 604800000]);
    assert.deepEqual(club().inbox, []);
});


test('inbox: an entry, the caps drop the oldest', () => {
    const {c, slugs: [slug], newId} = setup();
    const id = addEntry(c, entryArgs(planJson('Rollers', ['1001', '1002']), {team: slug}), {now: NOW, newId});
    assert.match(id, /^h\d{5}$/);
    assert.deepEqual(c.inbox, [{
        id, at: new Date(NOW).toISOString(), source: 'upload', team: slug, forPlan: null, via: null,
        json: planJson('Rollers', ['1001', '1002']), text: null, warnings: [], warningsMore: 0,
    }]);
    assert.equal(Object.hasOwn(c.inbox[0], 'name'), false, 'the JSON name is never kept');
    assert.deepEqual(entryOf(c, id), c.inbox[0]);
    assert.equal(entryOf(c, 'zzzzzz'), null);
    assert.equal(c.log.length, 1, 'only the team add is logged');
    const version = c.teams[slug].version;
    assert.equal(c.teams[slug].version, version);

    const ids = [id];
    for (let i = 0; i < 20; i++) {
        ids.push(addEntry(c, entryArgs(planJson('Rollers', ['1001']), {team: slug}), {now: NOW + i, newId}));
    }
    assert.equal(c.inbox.length, 20);
    assert.equal(entryOf(c, ids[0]), null, 'the first is gone');
    assert.deepEqual(c.inbox.map(e => e.id), ids.slice(1));
    assert.equal(c.teams[slug].version, version, 'no bump');
    assert.equal(c.log.length, 1, 'no log');

    // by size: about 60 KB each, the newest stays, the oldest go
    const d = setup();
    const made = [];
    for (let i = 0; i < 16; i++) {
        made.push(addEntry(d.c, entryArgs(bulky(`r${i}`).json, {team: d.slugs[0], text: bulky(`r${i}`).text}), {now: NOW + i, newId: d.newId}));
    }
    const one = Buffer.byteLength(JSON.stringify({json: d.c.inbox.at(-1).json, text: d.c.inbox.at(-1).text, warnings: []}));
    assert.ok(one > 40000 && one < 70000, `about 40 to 60 KB, got ${one}`);
    const sum = d.c.inbox.reduce((n, e) => n + Buffer.byteLength(JSON.stringify({json: e.json, text: e.text, warnings: e.warnings})), 0);
    assert.ok(sum <= INBOX_BYTES, `${sum}`);
    assert.equal(d.c.inbox.length, Math.floor(INBOX_BYTES / one), 'as many as fit, and fewer than were added');
    assert.ok(d.c.inbox.length < 16);
    assert.equal(d.c.inbox.at(-1).id, made.at(-1), 'the newest is kept');
    assert.equal(entryOf(d.c, made[0]), null, 'the oldest went');
    assert.deepEqual(d.c.inbox.map(e => e.id), made.slice(-d.c.inbox.length), 'oldest first, the newest ones stay');
});


test('inbox: the warnings are capped at 21, their names at 100 code points', () => {
    const {c, slugs: [slug], newId} = setup();
    const warnings = Array.from({length: 30}, (_, i) => ({code: 'unmatched-text-row', name: i === 0 ? '\u{1F6B4}'.repeat(150) : `Rider ${i}`}));
    const id = addEntry(c, entryArgs(planJson('Rollers', ['1001']), {team: slug, warnings}), {now: NOW, newId});
    const kept = entryOf(c, id).warnings;
    assert.equal(kept.length, 21);
    assert.equal([...kept[0].name].length, 100);
    assert.deepEqual(kept[1], {code: 'unmatched-text-row', name: 'Rider 1'});
    assert.equal(entryOf(c, id).warningsMore, 9, 'the 9 left out are counted');
    // the warnings count in the 320 KB
    const e = addEntry(c, entryArgs(planJson('Rollers', ['1001']), {team: slug}), {now: NOW, newId});
    assert.equal(c.inbox.length, 2);
    assert.notEqual(e, id);
});


test('addEntry: forPlan must be a plan of the entry\'s team', () => {
    const {c, slugs: [rollers, sprockets], newId} = setup([['Kettenfett Rollers', '19:30'], ['Kettenfett Sprockets', '19:40']]);
    const mine = upload(c, rollers, planJson('Rollers', ['1001']), {as: 'new', live: true}, {newId});
    const theirs = upload(c, sprockets, planJson('Sprockets', ['1002']), {as: 'new', live: true}, {newId});
    const json = planJson('Rollers', ['1001', '1002']);
    const forPlan = x => entryOf(c, addEntry(c, {source: 'upload', team: rollers, forPlan: x, json, text: null}, {now: NOW, newId})).forPlan;
    assert.equal(forPlan(mine.planId), mine.planId);
    const v2 = upload(c, rollers, planJson('Rollers', ['1001', '1003']), {as: mine.planId, live: false}, {newId});
    assert.equal(forPlan(v2.id), v2.id, 'a version id of the plan counts too');
    assert.equal(forPlan(theirs.planId), null);
    assert.equal(forPlan('zzzzzz'), null);
    assert.equal(forPlan(null), null);
    // no team, no plan
    assert.equal(entryOf(c, addEntry(c, {source: 'upload', forPlan: mine.planId, json, text: null}, {now: NOW, newId})).forPlan, null);
});


test('inbox: entries go after 24 h, without a version bump', () => {
    const {c, slugs: [slug], newId} = setup();
    const fresh = addEntry(c, entryArgs(planJson('Rollers', ['1001']), {team: slug}), {now: NOW, newId});
    const old = addEntry(c, entryArgs(planJson('Rollers', ['1002']), {team: slug}), {now: NOW - 25 * HOUR, newId});
    const bad = addEntry(c, entryArgs(planJson('Rollers', ['1003']), {team: slug}), {now: NOW, newId});
    assert.equal(staleEntries(c, NOW), 1);
    const version = c.teams[slug].version;
    const log = c.log.length;
    assert.equal(sweepInbox(c, NOW), 1);
    assert.deepEqual(c.inbox.map(e => e.id), [fresh, bad]);
    assert.equal(c.teams[slug].version, version);
    assert.equal(c.log.length, log);
    assert.equal(old === fresh, false);
    // exactly 24 h stays; an `at` that does not parse goes
    assert.equal(staleEntries(c, NOW + INBOX_KEEP_MS), 0);
    assert.equal(staleEntries(c, NOW + INBOX_KEEP_MS + 1), 2);
    entryOf(c, bad).at = 'not a date';
    assert.equal(staleEntries(c, NOW), 1);
    assert.equal(sweepInbox(c, NOW), 1);
    assert.deepEqual(c.inbox.map(e => e.id), [fresh]);
    assert.equal(sweepInbox(c, NOW), 0);
});


test('inbox: discard logs it; an unknown id is entry-gone', () => {
    const {c, slugs: [slug], newId} = setup();
    const id = addEntry(c, entryArgs(planJson('Rollers', ['1001', '1002', '1003'], ['1004']), {team: slug}), {now: NOW, newId});
    const version = c.teams[slug].version;
    const gone = discardEntry(c, id, NOW + 1000);
    assert.equal(gone.id, id);
    assert.equal(entryOf(c, id), null);
    assert.deepEqual(c.log.at(-1), {at: new Date(NOW + 1000).toISOString(), what: 'discard', team: slug, label: '3 riders'});
    assert.doesNotMatch(JSON.stringify(c.log.at(-1)), /Ben|Cleo|1001/, 'the count, never names');
    assert.equal(c.teams[slug].version, version);
    assert.throws(() => discardEntry(c, id, NOW), clubError('entry-gone'));
    assert.throws(() => discardEntry(c, 'zzzzzz', NOW), clubError('entry-gone'));
    assert.throws(() => discardEntry(c, undefined, NOW), clubError('entry-gone'));
    assert.throws(() => discardEntry(c, '__proto__', NOW), clubError('entry-gone'));
});


test('storeEntry: the entry is used in the same change; a refusal keeps it', () => {
    const {c, slugs: [slug], newId} = setup([['Kettenfett Rollers', '19:30'], ['Kettenfett Sprockets', '19:40']]);
    const sprockets = 'kettenfett-sprockets';
    const other = upload(c, sprockets, planJson('Sprockets', ['1009']), {as: 'new', live: true}, {newId});
    const json = planJson('Rollers', ['1001', '1002']);
    const id = addEntry(c, entryArgs(json, {team: slug}), {now: NOW, newId});
    const spare = structuredClone(c);

    // a refusal (the plan is another team's): not-found, and the entry is still there
    assert.throws(() => storeEntry(spare, id, {slug, as: other.planId, live: false, date: DATE, base: spare.teams[slug].version}, {now: NOW, newId}),
        clubError('not-found'));
    assert.ok(entryOf(spare, id));
    assert.equal(Object.keys(spare.sheets).length, 1);

    const r = storeEntry(c, id, {slug, as: 'new', live: true, date: DATE, type: 'fast', base: c.teams[slug].version}, {now: NOW, newId});
    assert.equal(r.created, true);
    assert.equal(r.entry.id, id);
    assert.deepEqual(r.entry.json, json);
    assert.equal(c.sheets[r.id].label, 'Kettenfett Rollers · fast');
    assert.equal(c.sheets[r.id].via, 'file', 'the upload source is no via of a version');
    assert.equal(liveId(c, slug), r.id);
    assert.equal(entryOf(c, id), null);
    assert.throws(() => storeEntry(c, id, {slug, as: 'new', live: true, date: DATE}, {now: NOW, newId}), clubError('entry-gone'));
    assert.throws(() => storeEntry(c, 'zzzzzz', {slug, as: 'new', date: DATE}, {now: NOW, newId}), clubError('entry-gone'));
});


test('addEntry: team, via, source and warning codes from known values only; a lone entry over the cap is refused', () => {
    const {c, slugs: [slug], newId} = setup();
    const json = planJson('Rollers', ['1001']);
    const add = extra => entryOf(c, addEntry(c, {source: 'upload', team: slug, json, text: null, ...extra}, {now: NOW, newId}));
    // a team that is no team of the club, or a name of Object.prototype, is none
    for (const team of ['gone', '__proto__', 'constructor', 'toString', 5, '']) {
        assert.equal(add({team}).team, null, String(team));
    }
    assert.equal(add({}).team, slug);
    // via: only the four ways a version arrives
    for (const via of ['file', 'paste', 'import', 'receive']) {
        assert.equal(add({via}).via, via);
    }
    for (const via of ['upload', 'back', 'FILE', null, 3]) {
        assert.equal(add({via}).via, null, String(via));
    }
    // source: an unknown one is a caller's bug
    for (const source of ['import', 'receive']) {
        assert.equal(add({source}).source, source);
    }
    for (const source of ['mail', undefined, '']) {
        assert.throws(() => addEntry(c, {source, team: slug, json, text: null}, {now: NOW, newId}), /unknown entry source/);
    }
    // a warning code is at most 40 characters; a longer one or none drops the warning
    const kept = add({warnings: [{code: 'x'.repeat(40), name: 'A'}, {code: 'x'.repeat(41), name: 'B'}, {code: '', name: 'C'}, {name: 'D'}]}).warnings;
    assert.deepEqual(kept, [{code: 'x'.repeat(40), name: 'A'}]);
    // an entry that alone is over ENTRY_BYTES is refused, and nothing is dropped for it
    const n = c.inbox.length;
    const huge = planJson('Rollers', ['1001']);
    huge.riders['1001'].note = 'x'.repeat(ENTRY_BYTES);
    assert.throws(() => addEntry(c, {source: 'upload', team: slug, json: huge, text: null}, {now: NOW, newId}), clubError('cap-bytes'));
    assert.equal(c.inbox.length, n);
});


test('inbox: an entry older than 24 h is gone for entryOf, storeEntry and discardEntry', () => {
    const {c, slugs: [slug], newId} = setup();
    const id = addEntry(c, entryArgs(planJson('Rollers', ['1001']), {team: slug}), {now: NOW, newId});
    assert.ok(entryOf(c, id, NOW + INBOX_KEEP_MS), 'exactly 24 h is still here');
    assert.equal(entryOf(c, id, NOW + INBOX_KEEP_MS + 1), null);
    assert.ok(entryOf(c, id), 'without a clock: as stored (the sweep removes it)');
    const later = NOW + INBOX_KEEP_MS + 1;
    assert.throws(() => storeEntry(c, id, {slug, as: 'new', live: true, date: '2026-11-20', base: c.teams[slug].version}, {now: later, newId}),
        clubError('entry-gone'));
    assert.equal(Object.keys(c.sheets).length, 0, 'nothing stored');
    assert.throws(() => discardEntry(c, id, later), clubError('entry-gone'));
    // before then it stores
    const r = storeEntry(c, id, {slug, as: 'new', live: true, date: DATE, base: c.teams[slug].version}, {now: NOW + 1000, newId});
    assert.equal(r.created, true);
    assert.equal(entryOf(c, id), null);
});


test('removeRider: inbox entries too', () => {
    const {c, slugs: [slug], newId} = setup();
    const text = [
        {name: 'Ben', pullWatts: 400, pullS: 60, colorName: 'Red', colorHex: '#ff0000'},
        {name: 'Cleo', pullWatts: 380, pullS: 60, colorName: 'Red', colorHex: '#ff0000'},
    ];
    const both = addEntry(c, entryArgs(planJson('Rollers', ['1001', '1002'], ['1003']), {
        team: slug, text, warnings: [{code: 'unmatched-text-row', name: 'Ben'}, {code: 'unmatched-text-row', name: 'Zed'}],
    }), {now: NOW, newId});
    const solo = addEntry(c, entryArgs(planJson('Rollers', ['1001']), {team: slug}), {now: NOW, newId});
    const benchOnly = addEntry(c, entryArgs(planJson('Rollers', ['1002'], ['1001']), {team: slug, warnings: [{code: 'unmatched-text-row', name: 'Ben'}]}), {now: NOW, newId});
    const untouched = addEntry(c, entryArgs(planJson('Rollers', ['1002', '1003']), {team: slug, warnings: [{code: 'unmatched-text-row', name: 'Zed'}]}), {now: NOW, newId});
    const before = structuredClone(entryOf(c, untouched));

    assert.equal(removeRider(c, '1001', NOW), 0, 'no plan changed');
    const e = entryOf(c, both);
    assert.deepEqual(Object.keys(e.json.riders), ['1002']);
    assert.deepEqual(Object.keys(e.json.roster), ['1003']);
    assert.deepEqual(e.text.map(t => t.name), ['Cleo']);
    assert.deepEqual(e.warnings, [], 'all warnings of a touched entry go: they may name him');
    assert.equal(e.warningsMore, 0);
    assert.equal(entryOf(c, solo), null, 'an entry with only Ben is dropped');
    assert.deepEqual(Object.keys(entryOf(c, benchOnly).json.roster), []);
    assert.deepEqual(entryOf(c, benchOnly).warnings, []);
    assert.deepEqual(entryOf(c, untouched), before, 'an entry without him is left as it is');
    assert.doesNotMatch(JSON.stringify(c), /1001|Ben/);
    assert.deepEqual(c.log.at(-1), {at: new Date(NOW).toISOString(), what: 'rider-remove'});
});


// ---- a special team: the race rhythm at Add, the start time with each plan (user, 19 Nov 2026) ----

test('addTeam: the race rhythm, with the same checks as setKind', () => {
    const c = club();
    const add = fields => addTeam(c, fields, {slugTaken: noneTaken, now: NOW});
    // weekly on its own day, with its start time
    const owls = add({name: 'Owls', start: '20:00', kind: 'weekly', weekday: 3});
    assert.deepEqual(c.teams[owls], {
        name: 'Owls', start: '20:00', version: 1, changedAt: new Date(NOW).toISOString(), kind: 'weekly', weekday: 3, races: {},
    });
    // special: the start goes, even one that is no time (it is ignored, not checked)
    const cogs = add({name: 'Cogs', start: '19:30', kind: 'special', weekday: null});
    assert.equal(c.teams[cogs].kind, 'special');
    assert.equal(c.teams[cogs].start, null);
    assert.equal(c.teams[add({name: 'Gears', start: '7:30', kind: 'special', weekday: null})].start, null);
    // a special team has no weekday, even with the default one
    assert.equal(c.teams[cogs].weekday, null);
    assert.equal(c.teams[add({name: 'Bolts', kind: 'special'})].weekday, null);
    // without a rhythm: weekly on Thursday
    const wheels = add({name: 'Wheels', start: null});
    assert.equal(c.teams[wheels].kind, 'weekly');
    assert.equal(c.teams[wheels].weekday, 4);
    const count = Object.keys(c.teams).length;
    const log = c.log.length;
    for (const [fields, code] of [
        [{kind: 'monthly', weekday: null}, 'bad-kind'], [{kind: '', weekday: null}, 'bad-kind'], [{kind: null, weekday: null}, 'bad-kind'],
        [{kind: 'weekly', weekday: 0}, 'bad-weekday'], [{kind: 'weekly', weekday: 8}, 'bad-weekday'], [{kind: 'weekly', weekday: null}, 'bad-weekday'],
        [{kind: 'weekly', weekday: NaN}, 'bad-weekday'], [{kind: 'special', weekday: '2'}, 'bad-weekday'],
        [{kind: 'weekly', weekday: 4, start: '24:00'}, 'bad-start'],
    ]) {
        assert.throws(() => add({name: 'Spokes', start: '19:30', ...fields}), clubError(code), JSON.stringify(fields));
    }
    assert.equal(Object.keys(c.teams).length, count);
    assert.equal(c.log.length, log);
});


test('setKind keeps the team\'s start time', () => {
    const {c, slugs: [slug]} = setup();
    setKind(c, slug, {kind: 'special', weekday: null}, NOW);
    assert.equal(c.teams[slug].start, '19:30');
    setKind(c, slug, {kind: 'weekly', weekday: 4}, NOW);
    assert.equal(c.teams[slug].start, '19:30');
});


// The start times of team `slug`'s races, by date (a special team's races all have one).
const starts = (c, slug) => Object.fromEntries(Object.entries(c.teams[slug].races).map(([date, r]) => [date, r.start]));

// Kettenfett RC with Cogs (special, no start time of its own) and Rollers 19:30 (weekly).
function specialSetup() {
    const c = club();
    const cogs = addTeam(c, {name: 'Cogs', kind: 'special', weekday: null}, {slugTaken: noneTaken, now: NOW});
    const rollers = addTeam(c, {name: 'Rollers', start: '19:30'}, {slugTaken: noneTaken, now: NOW});
    return {c, cogs, rollers, newId: counter()};
}


test('uploadSheet: a special team\'s new plan needs its start time; the race keeps it', () => {
    const {c, cogs, newId} = specialSetup();
    const json = planJson('Cogs', ['1001', '1002']);
    for (const start of [undefined, null, '', '7:30', '24:00', ' 20:15']) {
        assert.throws(() => upload(c, cogs, json, {start}, {newId}), clubError('bad-start'), String(start));
    }
    assert.deepEqual(c.sheets, {});
    assert.deepEqual(starts(c, cogs), {});
    // the date is checked first
    assert.throws(() => upload(c, cogs, json, {date: '', start: ''}, {newId}), clubError('bad-date'));
    const r = upload(c, cogs, json, {start: '20:15'}, {newId});
    assert.equal(r.startMoved, null, 'a new race moves nothing');
    // one source of truth: the race's start, none on the version
    assert.deepEqual(starts(c, cogs), {[DATE]: '20:15'});
    assert.equal(Object.hasOwn(c.sheets[r.id], 'start'), false);
    assert.equal(plannedStart(c, c.sheets[r.id]), T('2026-11-19T19:15:00Z'));
    // the race is over 2 h after the posted start (races spec §2), not before
    assert.throws(() => upload(c, cogs, json, {date: '2026-11-18', start: '20:15', type: 'b'}, {now: T('2026-11-18T21:15:00.001Z'), newId}),
        clubError('race-over-time'));
    assert.equal(race(c, cogs, '2026-11-18'), null, 'a refusal sets nothing');
    assert.equal(upload(c, cogs, json, {date: '2026-11-18', start: '20:15', type: 'b'}, {now: T('2026-11-18T21:15:00Z'), newId}).created, true);
    // a weekly team's race takes a posted time of its own too; the team's time stores none
    const w = upload(c, 'rollers', planJson('Rollers', ['1003']), {start: '21:00'}, {newId});
    assert.equal(race(c, 'rollers', DATE).start, '21:00');
    assert.equal(plannedStart(c, c.sheets[w.id]), T('2026-11-19T20:00:00Z'));
    upload(c, 'rollers', planJson('Rollers', ['1004']), {as: w.id, start: '19:30'}, {newId});
    assert.equal(race(c, 'rollers', DATE).start, null);
    assert.equal(plannedStart(c, c.sheets[w.id]), T('2026-11-19T18:30:00Z'));
});


test('uploadSheet: a past date with no race: the team\'s own time (what the form prefills) says the race is over, a time typed says to check it (user, 22 Nov 2026)', () => {
    const {c, rollers, newId} = specialSetup();
    const json = planJson('Rollers', ['1003']);
    const past = {date: '2026-11-05', type: 'p'};
    // the form posts the team's 19:30: no time of the captain's, "choose a later date"
    for (const start of ['19:30', '', undefined]) {
        assert.throws(() => upload(c, rollers, json, {...past, start}, {newId}), clubError('race-over'), String(start));
    }
    // another time typed: it may be the slip, so "check the start time"
    assert.throws(() => upload(c, rollers, json, {...past, start: '21:00'}, {newId}), e => {
        assert.ok(clubError('race-over-time')(e));
        assert.deepEqual(e.vars, {date: '2026-11-05', time: '21:00'});
        return true;
    });
    assert.equal(race(c, rollers, '2026-11-05'), null, 'a refusal sets nothing');
});


test('uploadSheet: a weekly race with its own later time is never ended by the team\'s earlier time typed at its place (user, 22 Nov 2026)', () => {
    const {c, rollers, newId} = specialSetup();
    const v1 = upload(c, rollers, planJson('Rollers', ['1003']), {start: '21:00', type: 'p'}, {newId});
    assert.equal(race(c, rollers, DATE).start, '21:00');
    // 22:00 Berlin: the race (21:00) is not over until 23:00, the team's 19:30 was over at 21:30
    const late = T('2026-11-19T21:00:00Z');
    const sheets = JSON.stringify(c.sheets);
    const version = c.teams[rollers].version;
    // a version with the team's time typed over the prefilled 21:00: refused, nothing stored, the race keeps 21:00
    assert.throws(() => upload(c, rollers, planJson('Rollers', ['1003', '1004']), {as: v1.id, start: '19:30'}, {now: late, newId}), e => {
        assert.ok(clubError('race-over-time')(e));
        assert.deepEqual(e.vars, {date: DATE, time: '19:30'});
        return true;
    });
    assert.equal(race(c, rollers, DATE).start, '21:00');
    assert.equal(JSON.stringify(c.sheets), sheets);
    assert.equal(c.teams[rollers].version, version);
    // a new plan for that date: the same, "check the start time" (the race is not over: it is no
    // "choose a later date")
    assert.throws(() => upload(c, rollers, planJson('Rollers', ['1005']), {start: '19:30', type: 'q'}, {now: late, newId}), e => {
        assert.ok(clubError('race-over-time')(e));
        assert.deepEqual(e.vars, {date: DATE, time: '19:30'});
        return true;
    });
    assert.equal(race(c, rollers, DATE).start, '21:00');
    // the untouched 21:00 stores as it did (a version at the race's own time)
    assert.equal(upload(c, rollers, planJson('Rollers', ['1003', '1004']), {as: v1.id, start: '21:00'}, {now: late, newId}).n, 2);
    assert.equal(race(c, rollers, DATE).start, '21:00');
});


test('uploadSheet: the newest Store for a date sets its race\'s start; the other plans move with it', () => {
    const {c, cogs, newId} = specialSetup();
    const fast = upload(c, cogs, planJson('Cogs', ['1001', '1002']), {start: '20:15', type: 'fast'}, {newId});
    // a second plan of 19 Nov with another time moves the race: both plans start at 21:15
    const slow = upload(c, cogs, planJson('Cogs', ['1003']), {start: '21:15', type: 'slow', live: false}, {newId});
    assert.deepEqual(slow.startMoved, {date: DATE, start: '21:15', was: '20:15', others: ['Cogs · fast']});
    assert.deepEqual(starts(c, cogs), {[DATE]: '21:15'});
    assert.equal(plannedStart(c, c.sheets[fast.id]), T('2026-11-19T20:15:00Z'));
    // a version with another time (the mistyped one corrected), and the date stays the plan's
    const v2 = upload(c, cogs, planJson('Cogs', ['1001']), {as: fast.id, start: '20:45', date: '2026-11-26'}, {newId});
    assert.deepEqual([c.sheets[v2.id].date, v2.startMoved], [DATE, {date: DATE, start: '20:45', was: '21:15', others: ['Cogs · slow']}]);
    // the same time, or none posted: the race keeps it, nothing to say
    const v3 = upload(c, cogs, planJson('Cogs', ['1002']), {as: fast.id, start: '20:45'}, {newId});
    assert.equal(v3.startMoved, null);
    const v4 = upload(c, cogs, planJson('Cogs', ['1004']), {as: fast.id, start: ''}, {newId});
    assert.deepEqual([v4.startMoved, race(c, cogs, DATE).start], [null, '20:45']);
    // the same content with a new time stores no version, but the time applies, with a log entry
    const version = c.teams[cogs].version;
    const same = upload(c, cogs, planJson('Cogs', ['1004']), {as: fast.id, start: '19:50'}, {newId});
    assert.equal(same.same, true);
    assert.deepEqual(same.startMoved, {date: DATE, start: '19:50', was: '20:45', others: ['Cogs · slow']});
    assert.equal(race(c, cogs, DATE).start, '19:50');
    assert.equal(c.teams[cogs].version, version + 1);
    assert.deepEqual(c.log.at(-1), {at: new Date(NOW).toISOString(), what: 'race-start', team: cogs, label: 'Thu 19 Nov 19:50'});
    // storeEntry passes the start on
    const id = addEntry(c, {source: 'upload', team: cogs, json: planJson('Cogs', ['1006']), text: null}, {now: NOW, newId});
    storeEntry(c, id, {slug: cogs, as: 'new', live: false, date: '2026-11-26', start: '18:45', type: null, pinnedEventId: null,
        base: c.teams[cogs].version}, {now: NOW, newId});
    assert.deepEqual(starts(c, cogs), {[DATE]: '19:50', '2026-11-26': '18:45'});
});


test('uploadSheet: race starts go with the last plan of their date', () => {
    const {c, cogs, newId} = specialSetup();
    const a = upload(c, cogs, planJson('Cogs', ['1001']), {start: '20:15', date: '2026-11-21'}, {newId});
    const b = upload(c, cogs, planJson('Cogs', ['1002']), {start: '20:30', date: '2026-11-28', live: false}, {newId});
    assert.deepEqual(starts(c, cogs), {'2026-11-21': '20:15', '2026-11-28': '20:30'});
    // Delete plan
    deleteSheet(c, cogs, b.id, NOW);
    assert.deepEqual(starts(c, cogs), {'2026-11-21': '20:15'});
    // a rider removal that empties the plan
    removeRider(c, '1001', NOW);
    assert.equal(Object.hasOwn(c.sheets, a.id), false);
    assert.deepEqual(starts(c, cogs), {}, 'none left: the race goes');
    // the sweep (7 days after the race)
    const s = upload(c, cogs, planJson('Cogs', ['1003']), {start: '20:00', date: DATE}, {newId});
    assert.deepEqual(starts(c, cogs), {[DATE]: '20:00'});
    assert.equal(sweepClub(c, T('2026-11-27T12:00Z')), 1);
    assert.equal(Object.hasOwn(c.sheets, s.id), false);
    assert.deepEqual(starts(c, cogs), {});
});


test('uploadSheet: a special team\'s race stored by 0.3.0 (no start of its own) gets one with any Store', () => {
    const {c, cogs, newId} = specialSetup();
    // as 0.3.0 stored it: the team's start time, no race start
    c.teams[cogs].start = '19:00';
    const old = upload(c, cogs, planJson('Cogs', ['1001']), {start: '20:15'}, {newId});
    race(c, cogs, DATE).start = null;
    assert.equal(plannedStart(c, c.sheets[old.id]), T('2026-11-19T18:00:00Z'));
    // a version without a time keeps the team's, now stored for the race
    const v2 = upload(c, cogs, planJson('Cogs', ['1002']), {as: old.id, start: ''}, {newId});
    assert.equal(v2.startMoved, null);
    assert.equal(plannedStart(c, c.sheets[v2.id]), T('2026-11-19T18:00:00Z'));
    // one with a time moves the race
    const v3 = upload(c, cogs, planJson('Cogs', ['1003']), {as: old.id, start: '20:15'}, {newId});
    assert.deepEqual(v3.startMoved, {date: DATE, start: '20:15', was: '19:00', others: []});
    // neither the team nor the race has a time: a version without one is refused, one with it sets it
    const {c: d, cogs: dc, newId: dn} = specialSetup();
    const bare = upload(d, dc, planJson('Cogs', ['1001']), {start: '20:00'}, {newId: dn});
    race(d, dc, DATE).start = null;
    assert.equal(plannedStart(d, d.sheets[bare.id]), null);
    assert.throws(() => upload(d, dc, planJson('Cogs', ['1002']), {as: bare.id, start: ''}, {newId: dn}), clubError('bad-start'));
    const set = upload(d, dc, planJson('Cogs', ['1002']), {as: bare.id, start: '20:30'}, {newId: dn});
    assert.deepEqual(set.startMoved, {date: DATE, start: '20:30', was: null, others: []});
    assert.equal(plannedStart(d, d.sheets[set.id]), T('2026-11-19T19:30:00Z'));
});


test('uploadSheet: a special team\'s version never sets a start time that is over already', () => {
    const {c, cogs, newId} = specialSetup();
    // today's race at 20:15 Berlin (19:15Z); at 15:00Z an AM/PM slip types 08:15 (07:15Z, over 2 h after: 09:15Z)
    const now = T('2026-11-19T15:00Z');
    const v1 = upload(c, cogs, planJson('Cogs', ['1001', '1002']), {start: '20:15'}, {now, newId});
    const sheets = JSON.stringify(c.sheets);
    const version = c.teams[cogs].version;
    // a version with other content, and one with the same content: refused like a new plan, nothing changes
    assert.throws(() => upload(c, cogs, planJson('Cogs', ['1001']), {as: v1.id, start: '08:15'}, {now, newId}), clubError('race-over-time'));
    assert.throws(() => upload(c, cogs, planJson('Cogs', ['1001', '1002']), {as: v1.id, start: '08:15'}, {now, newId}), clubError('race-over-time'));
    assert.equal(JSON.stringify(c.sheets), sheets);
    assert.deepEqual(starts(c, cogs), {[DATE]: '20:15'});
    assert.equal(c.teams[cogs].version, version);
    assert.equal(isUsed(c, c.sheets[v1.id], now), false, 'the plan is not used up');
    // a time still to come is fine (races spec §2, over from S + 2 h: 13:00 Berlin is over at
    // 14:00Z; 14:00 at 15:00Z is not yet)
    assert.throws(() => upload(c, cogs, planJson('Cogs', ['1001']), {as: v1.id, start: '13:00'}, {now, newId}), clubError('race-over-time'));
    assert.equal(upload(c, cogs, planJson('Cogs', ['1001']), {as: v1.id, start: '14:00'}, {now, newId}).n, 2);
    assert.equal(race(c, cogs, DATE).start, '14:00');
});


// ---- races (races spec §1): every operation keeps the shape and both race invariants ----

test('every operation leaves the race shape', () => {
    const {c, slugs: [slug], newId} = setup();
    assert.deepEqual(c.teams[slug].races, {});
    assertRaceShape(c);
    // a new plan with a link makes its race, with the link
    const a = upload(c, slug, planJson('Rollers fast', ['1001', '1002']), {pinnedEventId: 4567890}, {newId});
    assertRaceShape(c);
    assert.deepEqual(race(c, slug, DATE), {start: null, pinnedEventId: 4567890, eventId: null, boundAt: null, live: a.id});
    // a version without a link: the race keeps its link
    const a2 = upload(c, slug, planJson('Rollers fast', ['1002', '1001']), {as: a.id}, {newId});
    assertRaceShape(c);
    assert.equal(liveId(c, slug), a2.id);
    assert.equal(race(c, slug, DATE).pinnedEventId, 4567890);
    // the same content with another link stores no version, but sets the race's link
    const version = c.teams[slug].version;
    const same = upload(c, slug, planJson('Rollers fast', ['1002', '1001']), {as: a.id, pinnedEventId: 4567891}, {now: NOW + 60000, newId});
    assertRaceShape(c);
    assert.equal(same.same, true);
    assert.equal(same.id, a2.id);
    assert.equal(race(c, slug, DATE).pinnedEventId, 4567891);
    assert.equal(c.teams[slug].version, version + 1);
    assert.deepEqual(c.log.at(-1), {at: new Date(NOW + 60000).toISOString(), what: 'race-link', team: slug, label: 'Thu 19 Nov · 4567891'});
    // the same content with the same link changes nothing
    const logged = c.log.length;
    upload(c, slug, planJson('Rollers fast', ['1002', '1001']), {as: a.id, pinnedEventId: 4567891}, {newId});
    assert.equal(c.teams[slug].version, version + 1);
    assert.equal(c.log.length, logged);
    // a second plan of the race (Ida only), not live
    const b = upload(c, slug, planJson('Rollers slow', ['1008']), {type: 'slow', live: false}, {newId});
    assertRaceShape(c);
    makeLive(c, slug, b.id, NOW);
    assertRaceShape(c);
    assert.equal(liveId(c, slug), b.id);
    makeLive(c, slug, a2.id, NOW);
    assertRaceShape(c);
    // unpin, then a rider's check learns the race's event
    unpin(c, slug, b.id, NOW);
    assertRaceShape(c);
    assert.equal(race(c, slug, DATE).pinnedEventId, null);
    assert.equal(learnEvent(c, a.id, 4567892, NOW), true);
    assertRaceShape(c);
    assert.equal(race(c, slug, DATE).eventId, 4567892);
    assert.equal(learnEvent(c, b.id, 4567893, NOW), false, 'the race has learned its event already');
    // Remove a rider empties the second plan: it goes, the race stays
    removeRider(c, '1008', NOW);
    assertRaceShape(c);
    assert.equal(planOfId(c, slug, b.id), null);
    assert.notEqual(race(c, slug, DATE), null);
    // the sweep (nothing to sweep yet), then a delete of the race's last plan: the race goes
    const later = structuredClone(c);
    sweepClub(c, NOW);
    assertRaceShape(c);
    deleteSheet(c, slug, a.id, NOW);
    assertRaceShape(c);
    assert.equal(race(c, slug, DATE), null);
    assert.deepEqual(c.teams[slug].races, {});
    // the sweep of a week later takes the plan and its race
    assert.ok(sweepClub(later, T('2026-11-28T12:00Z')) > 0);
    assertRaceShape(later);
    assert.deepEqual(later.teams[slug].races, {});
});


// ---- operations per race (races spec §2, §4 "Race ⋯" and "Plan ⋯", §7) ----

// Kettenfett Rollers (weekly, 19:30): plan A live for Thu 19 Nov (`a`), plan B live for Sun 22 Nov
// at 18:00 (`b`), Ben 1001 in both. `v()` is the team's version.
function two() {
    const {c, slugs: [slug], newId} = setup();
    const a = upload(c, slug, planJson('Rollers', ['1001', '1002']), {}, {newId}).id;
    const b = upload(c, slug, planJson('Rollers', ['1001', '1003']), {date: '2026-11-22', start: '18:00'}, {newId}).id;
    return {c, slug, newId, a, b, v: () => c.teams[slug].version};
}


test('makeLive: live is the race\'s; the team\'s other race keeps its plan, and both are served', () => {
    const {c, slug, newId, a, b, v} = two();
    assert.equal(race(c, slug, '2026-11-19').live, a);
    assert.equal(race(c, slug, '2026-11-22').live, b, 'a live plan in each race');
    const x = upload(c, slug, planJson('Rollers tempo', ['1001', '1002']), {type: 'tempo', live: false}, {newId}).id;
    makeLive(c, slug, x, NOW, {version: v()});
    assert.equal(race(c, slug, '2026-11-19').live, x);
    assert.equal(race(c, slug, '2026-11-22').live, b);
    assert.deepEqual(servable(c, NOW).map(s => s.id).sort(), [b, x].sort());
    assertRaceShape(c);
});


test('a race that is over takes no change, its plans can be deleted, and riders keep its plan until S + 4 h', () => {
    const {c, slug, newId, a, v} = two();
    const planA = c.sheets[a].plan;
    const a2 = upload(c, slug, planJson('Rollers tempo', ['1002']), {type: 'tempo', live: false}, {newId}).id;   // a second plan of the 19 Nov race
    const over = T('2026-11-19T20:30:00Z') + 1;                       // S 18:30Z + 2 h
    const refused = [
        () => makeLive(c, slug, a2, over), () => upload(c, slug, planJson('Rollers', ['1001', '1003']), {as: planA}, {now: over, newId}),
        () => renamePlan(c, slug, planA, 'tempo', over),
        () => setRace(c, slug, '2026-11-19', {to: '2026-11-21', start: ''}, over), () => setRaceEvent(c, slug, '2026-11-19', 5123456, over),
    ];
    const before = JSON.stringify(c);
    for (const run of refused) {
        assert.throws(run, e => e instanceof ClubError && ['race-done', 'plan-used'].includes(e.code));
    }
    assert.throws(() => upload(c, slug, planJson('Rollers late', ['1003']), {type: 'late'}, {now: over, newId}), clubError('race-over'));
    // a later posted time does not reopen it (review I1: it would serve the raced plan again)
    assert.throws(() => upload(c, slug, planJson('Rollers late', ['1003']), {type: 'late', start: '23:00'}, {now: over, newId}), e => {
        assert.ok(clubError('race-over')(e));
        assert.deepEqual(e.vars, {date: '2026-11-19'});
        return true;
    });
    assert.equal(JSON.stringify(c), before);
    assert.equal(servable(c, T('2026-11-19T22:30:00Z')).some(s => s.id === a), true);        // S + 4 h
    assert.equal(servable(c, T('2026-11-19T22:30:00Z') + 1).some(s => s.id === a), false);
    deleteSheet(c, slug, a, over);
    deleteSheet(c, slug, a2, over);
    assert.equal(race(c, slug, '2026-11-19'), null);                   // the race went with its last plan
});


test('the refusals of an over race: race-done names its day, a new version is plan-used, unpin too', () => {
    const {c, slug, newId, a, v} = two();
    upload(c, slug, planJson('Rollers', ['1002', '1001']), {as: a, pinnedEventId: 5123456}, {newId});
    const over = T('2026-11-19T20:30:00Z') + 1;
    const before = JSON.stringify(c);
    assert.throws(() => makeLive(c, slug, a, over, {version: v()}), e => {
        assert.ok(clubError('race-done')(e));
        assert.deepEqual(e.vars, {day: 'Thu 19 Nov'});
        return true;
    });
    assert.throws(() => upload(c, slug, planJson('Rollers', ['1003']), {as: a}, {now: over, newId}), e => {
        assert.ok(clubError('plan-used')(e));
        assert.deepEqual(e.vars, {label: 'Kettenfett Rollers'});
        return true;
    });
    assert.throws(() => unpin(c, slug, a, over), clubError('race-done'));
    assert.equal(JSON.stringify(c), before);
    // until S + 2 h it is still to race
    makeLive(c, slug, a, T('2026-11-19T20:30:00Z'), {version: v()});
});


test('setRace: the race moves with all its plans; a date the team races and a time that is over are refused', () => {
    const {c, slug, a, v} = two();
    race(c, slug, '2026-11-19').eventId = 4567001;                     // learned from a rider's check
    const r = setRace(c, slug, '2026-11-19', {to: '2026-11-21', start: '17:00'}, NOW, {version: v()});
    assert.deepEqual(r, {date: '2026-11-21', start: '17:00', was: {date: '2026-11-19', start: null}, plans: 1});
    assert.equal(race(c, slug, '2026-11-19'), null);
    assert.deepEqual(race(c, slug, '2026-11-21'), {start: '17:00', pinnedEventId: null, eventId: null, boundAt: null, live: a});
    assert.equal(c.sheets[a].date, '2026-11-21');
    assert.deepEqual([c.log.at(-1).what, c.log.at(-1).label], ['race-move', 'Thu 19 Nov 19:30 → Sat 21 Nov 17:00']);
    assert.throws(() => setRace(c, slug, '2026-11-21', {to: '2026-11-22', start: ''}, NOW), clubError('race-taken'));
    assert.throws(() => setRace(c, slug, '2026-11-21', {to: '2026-11-19', start: '07:30'}, NOW), clubError('race-over-time'));   // an AM/PM slip
    assert.throws(() => setRace(c, slug, '2026-11-21', {to: 'soon', start: ''}, NOW), clubError('bad-date'));
    assertRaceShape(c);
});


test('setRace: every plan and version moves; the team\'s time stores none; the link stays; no change does nothing', () => {
    const {c, slug, newId, a, b, v} = two();
    const a2 = upload(c, slug, planJson('Rollers', ['1002', '1001']), {as: a}, {newId}).id;
    const x = upload(c, slug, planJson('Rollers tempo', ['1004']), {type: 'tempo', live: false, pinnedEventId: 5123456}, {newId}).id;
    learnEvent(c, b, 4567002, NOW);
    // a time only: the 22 Nov race at the team's 19:30 stores none, its learned event goes
    const version = v();
    assert.deepEqual(setRace(c, slug, '2026-11-22', {to: '2026-11-22', start: '19:30'}, NOW, {version}),
        {date: '2026-11-22', start: null, was: {date: '2026-11-22', start: '18:00'}, plans: 1});
    assert.deepEqual(race(c, slug, '2026-11-22'), {start: null, pinnedEventId: null, eventId: null, boundAt: null, live: b});
    assert.equal(v(), version + 1);
    assert.deepEqual([c.log.at(-1).what, c.log.at(-1).label], ['race-move', 'Sun 22 Nov 18:00 → Sun 22 Nov 19:30']);
    // nothing changed: no bump, no log
    const logged = c.log.length;
    assert.deepEqual(setRace(c, slug, '2026-11-22', {to: '2026-11-22', start: ''}, NOW, {version: v()}),
        {date: '2026-11-22', start: null, was: {date: '2026-11-22', start: null}, plans: 1});
    assert.deepEqual([v(), c.log.length], [version + 1, logged]);
    // a date: two plans and all their versions move; the link stays, the live plan too
    const r = setRace(c, slug, '2026-11-19', {to: '2026-11-20', start: ''}, NOW, {version: v()});
    assert.deepEqual(r, {date: '2026-11-20', start: null, was: {date: '2026-11-19', start: null}, plans: 2});
    assert.deepEqual([a, a2, x].map(id => c.sheets[id].date), ['2026-11-20', '2026-11-20', '2026-11-20']);
    assert.deepEqual(race(c, slug, '2026-11-20'), {start: null, pinnedEventId: 5123456, eventId: null, boundAt: null, live: a2});
    assert.deepEqual(Object.keys(c.teams[slug].races).sort(), ['2026-11-20', '2026-11-22']);
    assertRaceShape(c);
    // a race that stored the team's own time explicitly, posted blank: the same time, nothing logged
    race(c, slug, '2026-11-22').start = '19:30';
    const quiet = [v(), c.log.length];
    assert.deepEqual(setRace(c, slug, '2026-11-22', {to: '2026-11-22', start: ''}, NOW, {version: v()}),
        {date: '2026-11-22', start: null, was: {date: '2026-11-22', start: '19:30'}, plans: 1});
    assert.deepEqual([v(), c.log.length], quiet);
    assert.equal(race(c, slug, '2026-11-22').start, null);
    // a weekly time that is no time, and a special team's race without one
    assert.throws(() => setRace(c, slug, '2026-11-20', {to: '2026-11-20', start: '7pm'}, NOW), clubError('bad-start'));
    const cogs = addTeam(c, {name: 'Cogs', kind: 'special', weekday: null}, {slugTaken: noneTaken, now: NOW});
    upload(c, cogs, planJson('Cogs', ['1005']), {start: '20:15'}, {newId});
    assert.throws(() => setRace(c, cogs, DATE, {to: '2026-11-21', start: ''}, NOW), clubError('bad-start'));
    assert.deepEqual(setRace(c, cogs, DATE, {to: '2026-11-21', start: '19:00'}, NOW),
        {date: '2026-11-21', start: '19:00', was: {date: DATE, start: '20:15'}, plans: 1});
});


test('a stale page or a race that is gone changes nothing', () => {
    const {c, slug, a, b, v} = two();
    const planA = c.sheets[a].plan;
    const before = JSON.stringify(c);
    const stale = {version: v() - 1};
    for (const run of [() => makeLive(c, slug, b, NOW, stale), () => renamePlan(c, slug, planA, 'x', NOW, stale),
        () => setRace(c, slug, '2026-11-19', {to: '2026-11-20', start: ''}, NOW, stale), () => setRaceEvent(c, slug, '2026-11-19', 5123456, NOW, stale)]) {
        assert.throws(run, clubError('changed'));
    }
    assert.throws(() => setRace(c, slug, '2026-11-25', {to: '2026-11-27', start: ''}, NOW), clubError('not-found'));
    assert.throws(() => setRaceEvent(c, slug, '2026-11-25', 5123456, NOW), clubError('not-found'));
    assert.throws(() => renamePlan(c, slug, 'zzzzzz', 'x', NOW), clubError('not-found'));
    assert.throws(() => setRace(c, 'nobody', '2026-11-19', {to: '2026-11-20', start: ''}, NOW), clubError('not-found'));
    assert.throws(() => setRaceEvent(c, slug, '__proto__', 5123456, NOW), clubError('not-found'));
    assert.equal(JSON.stringify(c), before);
});


test('setRaceEvent: sets, changes and removes the race\'s link; a learned event goes when a link comes', () => {
    const {c, slug, a, v} = two();
    learnEvent(c, a, 4567003, NOW);
    assert.deepEqual(setRaceEvent(c, slug, '2026-11-19', 5123456, NOW, {version: v()}), {was: null});
    assert.deepEqual(race(c, slug, '2026-11-19'), {start: null, pinnedEventId: 5123456, eventId: null, boundAt: null, live: a});
    assert.deepEqual([c.log.at(-1).what, c.log.at(-1).label], ['race-link', 'Thu 19 Nov · 5123456']);
    const version = v();
    assert.deepEqual(setRaceEvent(c, slug, '2026-11-19', 5123457, NOW, {version}), {was: 5123456});
    assert.equal(race(c, slug, '2026-11-19').pinnedEventId, 5123457);
    // the same link: nothing happens
    const logged = c.log.length;
    assert.deepEqual(setRaceEvent(c, slug, '2026-11-19', 5123457, NOW), {was: 5123457});
    assert.deepEqual([v(), c.log.length], [version + 1, logged]);
    // a date change keeps the link
    setRace(c, slug, '2026-11-19', {to: '2026-11-20', start: ''}, NOW);
    assert.equal(race(c, slug, '2026-11-20').pinnedEventId, 5123457);
    assert.deepEqual(setRaceEvent(c, slug, '2026-11-20', null, NOW, {version: v()}), {was: 5123457});
    assert.equal(race(c, slug, '2026-11-20').pinnedEventId, null);
    assert.deepEqual([c.log.at(-1).what, c.log.at(-1).label], ['unpin', 'Fri 20 Nov']);
    // the 22 Nov race was never touched
    assert.equal(race(c, slug, '2026-11-22').pinnedEventId, null);
    assertRaceShape(c);
});


test('renamePlan: every version\'s type and label; unique within the race; a blank type only when no other plan has none', () => {
    const {c, slug, newId, a, b, v} = two();
    const a2 = upload(c, slug, planJson('Rollers', ['1002', '1001']), {as: a}, {newId}).id;
    const r = renamePlan(c, slug, a2, 'tempo', NOW, {version: v()});
    assert.deepEqual(r, {label: 'Kettenfett Rollers · tempo', was: 'Kettenfett Rollers'});
    for (const id of [a, a2]) {
        assert.deepEqual([c.sheets[id].type, c.sheets[id].label], ['tempo', 'Kettenfett Rollers · tempo'], id);
    }
    assert.equal(teamTypes(c, slug)[0], 'tempo');
    assert.deepEqual([c.log.at(-1).what, c.log.at(-1).label], ['plan-rename', '\'Kettenfett Rollers\' → \'Kettenfett Rollers · tempo\'']);
    // the other race's plan keeps its label
    assert.equal(c.sheets[b].label, 'Kettenfett Rollers');
    // a second plan of the race: another type, never the same one; none only while no other has none
    const x = upload(c, slug, planJson('Rollers', ['1004']), {type: 'easy', live: false}, {newId}).id;
    assert.throws(() => renamePlan(c, slug, x, ' TEMPO ', NOW), clubError('type-taken'));
    assert.deepEqual(renamePlan(c, slug, x, '', NOW), {label: 'Kettenfett Rollers', was: 'Kettenfett Rollers · easy'});
    assert.throws(() => renamePlan(c, slug, a, '  ', NOW), clubError('type-needed'));
    assert.throws(() => renamePlan(c, slug, a, 'y'.repeat(31), NOW), clubError('bad-type'));
    // an unchanged type changes nothing
    const version = v();
    const logged = c.log.length;
    assert.deepEqual(renamePlan(c, slug, a, 'tempo', NOW, {version}), {label: 'Kettenfett Rollers · tempo', was: 'Kettenfett Rollers · tempo'});
    assert.deepEqual([v(), c.log.length], [version, logged]);
    assertRaceShape(c);
});


test('uploadSheet: a weekly team\'s race takes its own time; the team\'s time stores none; a link names the plans that share it', () => {
    const {c, slug, newId, b} = two();
    assert.equal(race(c, slug, '2026-11-22').start, '18:00');
    assert.equal(plannedStart(c, c.sheets[b]), T('2026-11-22T17:00:00Z'));
    learnEvent(c, b, 4567004, NOW);
    const r = upload(c, slug, planJson('Rollers', ['1004']), {date: '2026-11-22', start: '17:00', type: 'easy', live: false}, {newId});
    assert.equal(race(c, slug, '2026-11-22').start, '17:00');
    assert.deepEqual(r.startMoved, {date: '2026-11-22', start: '17:00', was: '18:00', others: ['Kettenfett Rollers']});
    // the race's time moved: the event learned for the old time goes (spec §7)
    assert.deepEqual([race(c, slug, '2026-11-22').eventId, race(c, slug, '2026-11-22').boundAt], [null, null]);
    // blank keeps the race's time
    const v2 = upload(c, slug, planJson('Rollers', ['1005']), {as: r.id, start: ''}, {newId});
    assert.deepEqual([v2.startMoved, race(c, slug, '2026-11-22').start], [null, '17:00']);
    // the team's time stores none
    const v3 = upload(c, slug, planJson('Rollers', ['1006']), {as: r.id, start: '19:30'}, {newId});
    assert.equal(race(c, slug, '2026-11-22').start, null);
    assert.deepEqual(v3.startMoved, {date: '2026-11-22', start: '19:30', was: '17:00', others: ['Kettenfett Rollers']});
    assert.throws(() => upload(c, slug, planJson('Rollers', ['1006']), {as: r.id, start: '7pm'}, {newId}), clubError('bad-start'));
    // a new race: its own time, or none
    upload(c, slug, planJson('Rollers', ['1007']), {date: '2026-11-26', start: '18:15', live: false}, {newId});
    assert.equal(race(c, slug, '2026-11-26').start, '18:15');
    upload(c, slug, planJson('Rollers', ['1007']), {date: '2026-11-27', start: '', live: false}, {newId});
    assert.equal(race(c, slug, '2026-11-27').start, null);
    // a link on a race with plans says so, with the plans that share it
    const linked = upload(c, slug, planJson('Rollers', ['1008']), {as: r.id, pinnedEventId: 5123456}, {newId});
    assert.deepEqual(linked.linkMoved, {date: '2026-11-22', id: 5123456, was: null, others: ['Kettenfett Rollers']});
    const again = upload(c, slug, planJson('Rollers', ['1009']), {as: r.id, pinnedEventId: 5123456}, {newId});
    assert.equal(again.linkMoved, null, 'the same link');
    // the same content with another link: the link moves too (no version stored)
    const same = upload(c, slug, planJson('Rollers', ['1009']), {as: r.id, pinnedEventId: 5123457}, {newId});
    assert.equal(same.same, true);
    assert.deepEqual(same.linkMoved, {date: '2026-11-22', id: 5123457, was: 5123456, others: ['Kettenfett Rollers']});
    // a new race with a link: nothing moves
    const fresh = upload(c, slug, planJson('Rollers', ['1001']), {date: '2026-11-29', pinnedEventId: 5123458, live: false}, {newId});
    assert.deepEqual([fresh.linkMoved, fresh.startMoved], [null, null]);
    assertRaceShape(c);
});


test('uploadSheet: Store and make live is the race\'s; the other race keeps its live plan', () => {
    const {c, slug, newId, a, b} = two();
    const r = upload(c, slug, planJson('Rollers', ['1004']), {date: '2026-11-22', type: 'easy'}, {newId});
    assert.equal(r.live, true);
    assert.deepEqual([race(c, slug, '2026-11-19').live, race(c, slug, '2026-11-22').live], [a, r.id]);
    // the same content again, live: the race's live version
    const v2 = upload(c, slug, planJson('Rollers', ['1001', '1003']), {as: b, live: false}, {newId});
    const same = upload(c, slug, planJson('Rollers', ['1001', '1003']), {as: b, live: true}, {newId});
    assert.deepEqual([same.same, same.id, same.live], [true, v2.id, true]);
    assert.deepEqual([race(c, slug, '2026-11-19').live, race(c, slug, '2026-11-22').live], [a, v2.id]);
    assert.deepEqual(undoOffer(c, slug, NOW), {id: r.id, prev: c.sheets[r.id], live: c.sheets[v2.id], version: c.teams[slug].version});
});


test('Undo is the race\'s: after Make live in one race it brings back that race\'s plan and leaves the other race', () => {
    const {c, slug, newId, a, b, v} = two();
    const x = upload(c, slug, planJson('Rollers tempo', ['1004']), {type: 'tempo', live: false}, {newId}).id;
    makeLive(c, slug, x, NOW, {version: v()});
    const u = undoOffer(c, slug, NOW);
    assert.deepEqual(u, {id: a, prev: c.sheets[a], live: c.sheets[x], version: v()});
    makeLive(c, slug, u.id, NOW, {version: u.version, undo: false});
    assert.deepEqual([race(c, slug, '2026-11-19').live, race(c, slug, '2026-11-22').live], [a, b]);
    assert.equal(undoOffer(c, slug, NOW), null);
    // Make live in the other race: its Undo names that race's plan
    const y = upload(c, slug, planJson('Rollers', ['1005']), {date: '2026-11-22', type: 'tempo', live: false}, {newId}).id;
    makeLive(c, slug, y, NOW, {version: v()});
    assert.deepEqual(undoOffer(c, slug, NOW), {id: b, prev: c.sheets[b], live: c.sheets[y], version: v()});
    assert.equal(race(c, slug, '2026-11-19').live, a);
});


test('sweepClub: a race goes with its plans 7 days after its date', () => {
    const {c, slug, newId, a, b} = two();
    const a2 = upload(c, slug, planJson('Rollers', ['1002', '1001']), {as: a}, {newId}).id;
    const now = T('2026-11-27T12:00Z');
    assert.deepEqual(sweptSheets(c, now).sort(), [a, a2].sort());
    assert.equal(sweepClub(c, now), 2);
    assert.equal(race(c, slug, '2026-11-19'), null);
    assert.equal(race(c, slug, '2026-11-22').live, b);
    assert.deepEqual(Object.keys(c.sheets), [b]);
    assertRaceShape(c);
});


test('teamHint: a team\'s riders are the most any of its races\' live plans shares', () => {
    const {c, slugs: [rollers, sprockets], newId} = setup([['Rollers', '19:30'], ['Sprockets', '19:40']]);
    const ids = json => Object.keys(json.riders);
    // Sprockets: most of them in Sunday's live plan, few in Thursday's (stored last, both live)
    upload(c, sprockets, planJson('', EIGHT), {date: '2026-11-22'}, {newId});
    upload(c, sprockets, planJson('', ['1001']), {}, {newId});
    const json = planJson('', EIGHT);
    assert.deepEqual(teamHint(c, rollers, json, ids(json), NOW), {kind: 'overlap', team: 'sprockets', shared: 8, total: 8});
    // Rollers' own later race shares as many: no hint
    upload(c, rollers, planJson('', EIGHT), {date: '2026-11-26'}, {newId});
    upload(c, rollers, planJson('', ['1009']), {}, {newId});
    assert.equal(teamHint(c, rollers, json, ids(json), NOW), null);
});


test('uploadWarnings: a Store that sets or moves its race\'s event link says so, with the plans that share it', async () => {
    const {uploadWarnings} = await import('../upload-page.mjs');
    const {c, slug, newId, b} = two();
    const set = upload(c, slug, planJson('Rollers', ['1004']), {as: b, pinnedEventId: 5123456}, {newId});
    const lines = r => uploadWarnings(c, slug, {result: r}).filter(l => l.text.includes('event link'));
    // the plan's own race: info
    assert.deepEqual(lines(set), [{sev: 'info', text: 'Race on Sun 22 Nov now has event link 5123456.'}]);
    // another plan of the race shares it: warn, naming it; it is the race's live plan, which the link
    // re-pins too (races Task 7, from Task 2's review)
    const other = upload(c, slug, planJson('Rollers', ['1005']), {date: '2026-11-22', type: 'easy', live: false, pinnedEventId: 5123457}, {newId});
    assert.deepEqual(lines(other), [{sev: 'warn', text: 'Race on Sun 22 Nov now has event link 5123457 (was 5123456). \'Kettenfett Rollers\' moves with it.'
        + ' Riders in another event then get nothing from \'Kettenfett Rollers\', the race\'s live plan.'}]);
    // no change of the link: no line
    assert.deepEqual(lines(upload(c, slug, planJson('Rollers', ['1006']), {as: b, pinnedEventId: 5123457}, {newId})), []);
});


test('teamHint: only races still served count; a raced race keeps its live plan but no say (review I2)', () => {
    const {c, slugs: [rollers, sprockets], newId} = setup([['Rollers', '19:30'], ['Sprockets', '19:40']]);
    const last = T('2026-11-12T12:00Z');
    // last week Sprockets raced with Ben … Ida, Rollers with Jo; this week Sprockets has Hanna and Ida
    upload(c, sprockets, planJson('', EIGHT), {date: '2026-11-12'}, {now: last, newId});
    upload(c, rollers, planJson('', ['1009']), {date: '2026-11-12'}, {now: last, newId});
    upload(c, sprockets, planJson('', ['1007', '1008']), {}, {newId});
    assert.notEqual(race(c, sprockets, '2026-11-12').live, null, 'last week\'s race keeps its live plan');
    // Rollers' reshuffled plan takes Ben … Gus and Jo: no hint
    const json = planJson('', ['1001', '1002', '1003', '1004', '1005', '1006', '1009']);
    assert.equal(teamHint(c, rollers, json, Object.keys(json.riders), NOW), null);
    // last week, while that race was still served, the same riders were Sprockets'
    assert.deepEqual(teamHint(c, rollers, json, Object.keys(json.riders), last),
        {kind: 'overlap', team: 'sprockets', shared: 6, total: 7});
    // used up at S + 4 h (19:40 Berlin = 18:40Z): served at 22:40Z, not after
    assert.notEqual(teamHint(c, rollers, json, Object.keys(json.riders), T('2026-11-12T22:40:00Z')), null);
    assert.equal(teamHint(c, rollers, json, Object.keys(json.riders), T('2026-11-12T22:40:00Z') + 1), null);
});


test('renamePlan: a plan without a race date is not-found, not a crash (review M1)', () => {
    const {c, slug} = two();
    c.sheets.dd0001 = {...sheet({team: slug, label: 'Kettenfett Rollers', date: '', riders: ['1004'], uploadedAt: '2026-11-10T10:00:00.000Z'}), plan: 'dd0001'};
    for (const k of ['pinnedEventId', 'eventId', 'boundAt']) {
        delete c.sheets.dd0001[k];
    }
    const before = JSON.stringify(c);
    assert.throws(() => renamePlan(c, slug, 'dd0001', 'tempo', NOW), clubError('not-found'));
    assert.equal(JSON.stringify(c), before);
});


test('setRace: a race without any time moved to a past date says race-over, with no time in it (review M2)', () => {
    const {c, slugs: [slug], newId} = setup([['Kettenfett Rollers', null]]);
    upload(c, slug, planJson('Rollers', ['1001']), {}, {newId});
    assert.throws(() => setRace(c, slug, DATE, {to: '2026-11-18', start: ''}, NOW), e => {
        assert.ok(clubError('race-over')(e));
        assert.deepEqual(e.vars, {date: '2026-11-18'});
        return true;
    });
    // a later date is fine without a time
    assert.deepEqual(setRace(c, slug, DATE, {to: '2026-11-20', start: ''}, NOW).date, '2026-11-20');
});
