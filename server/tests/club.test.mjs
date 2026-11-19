import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_TEAMS, MAX_PLANS, MAX_PLANS_PER_RACE, MAX_VERSIONS, MAX_RIDERS, MAX_SHEET_BYTES, MAX_CLUB_BYTES, MAX_LOG, KEEP_DAYS,
    TEAM_NAME_MAX, TYPE_MAX, RIDER_NAME_MAX,
    ClubError, newClub, addTeam, renameTeam, setStart, setKind, deleteTeam, uploadSheet, makeLive,
    deleteSheet, unpin, backTo, learnEvent, clubLists, removeRider, sweepClub, sweptSheets, clubBytes, addLog,
    isPrivate, setRiderCode, clearRiderCode, teamHint, isUsed,
    INBOX_MAX, INBOX_BYTES, ENTRY_BYTES, INBOX_KEEP_MS, RECEIVE_KEEP_MS, addEntry, entryOf, discardEntry, storeEntry, staleEntries, sweepInbox,
} from '../club.mjs';
import {plansOf, planOfId, freeVersionId, teamTypes, previousVersion} from '../plans.mjs';
import {plannedStart} from '../select.mjs';
import {riderCodeHash, nameKey} from '../ids.mjs';
import {normalizePlan} from '../../pages/src/engine/plan.mjs';
import {club, sheet, planJson, T, CODE_SECRET} from './helpers.mjs';


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
        teams: {}, sheets: {}, log: [], inbox: [], weekday: 4,
    });
    assert.throws(() => newClub({id: 'k7f3q9x2m4', name: 'Kettenfett RC', email: 'captain@example.org', tz: 'Europe/Nowhere', now: NOW}));
    assert.throws(() => newClub({id: 'k7f3q9x2m4', name: 'Kettenfett RC', email: 'captain@example.org', tz: '', now: NOW}));
});


test('addTeam: global slugs, retired ones stay taken, 10 at most', () => {
    const c = club();
    const slugTaken = s => s === 'kettenfett-rollers';
    const slug = addTeam(c, {name: 'Kettenfett Rollers', start: '19:30'}, {slugTaken, now: NOW});
    assert.equal(slug, 'kettenfett-rollers-2');
    assert.deepEqual(c.teams[slug], {
        name: 'Kettenfett Rollers', start: '19:30', live: null, version: 1,
        changedAt: new Date(NOW).toISOString(), kind: 'weekly', weekday: null,
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
    assert.equal(c.teams[slug].weekday, null);
    assert.equal(newClub({id: 'k7f3q9x2m4', name: 'Kettenfett RC', email: 'captain@example.org', tz: 'Europe/Berlin', now: NOW}).weekday, 4);
    upload(c, slug, planJson('Rollers', ['1001']), {}, {newId});
    const later = NOW + 60000;
    const version = c.teams[slug].version;
    setKind(c, slug, {kind: 'special', weekday: null}, later);
    assert.equal(c.teams[slug].kind, 'special');
    assert.equal(c.teams[slug].weekday, null);
    assert.equal(c.teams[slug].version, version + 1);
    assert.equal(c.teams[slug].changedAt, new Date(later).toISOString());
    assert.deepEqual(c.log.at(-1), {at: new Date(later).toISOString(), what: 'team-kind', team: slug, label: 'special'});
    // weekly on the club's day (Thursday), then on its own
    setKind(c, slug, {kind: 'weekly', weekday: null}, later);
    assert.deepEqual(c.log.at(-1), {at: new Date(later).toISOString(), what: 'team-kind', team: slug, label: 'weekly, Thursday'});
    setKind(c, slug, {kind: 'weekly', weekday: 2}, later);
    assert.equal(c.teams[slug].weekday, 2);
    assert.deepEqual(c.log.at(-1), {at: new Date(later).toISOString(), what: 'team-kind', team: slug, label: 'weekly, Tuesday'});
    assert.equal(c.teams[slug].version, version + 3);
    // refused: nothing changes
    const before = structuredClone(c);
    assert.throws(() => setKind(c, slug, {kind: 'monthly', weekday: null}, later), clubError('bad-kind'));
    assert.throws(() => setKind(c, slug, {kind: 'weekly', weekday: 8}, later), clubError('bad-weekday'));
    for (const bad of [0, 2.5, '2', undefined]) {
        assert.throws(() => setKind(c, slug, {kind: 'weekly', weekday: bad}, later), clubError('bad-weekday'), String(bad));
    }
    assert.throws(() => setKind(c, 'gone', {kind: 'weekly', weekday: null}, later), clubError('not-found'));
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
    assert.equal(team.live, r.id);
    const s = c.sheets[r.id];
    assert.doesNotMatch(JSON.stringify(s.json), /"(height|ftp)"/);
    assert.equal(s.json.riders['1001'].weight, 70);
    assert.equal(s.label, 'Kettenfett Rollers', 'the team name; the JSON name is not used');
    assert.equal(s.uploadedAt, new Date(NOW).toISOString());
    assert.equal(team.version, 2);
    assert.equal(team.changedAt, new Date(NOW).toISOString());
    assert.deepEqual(Object.keys(s).sort(), [
        'at', 'boundAt', 'copyOf', 'date', 'eventId', 'json', 'jsonName', 'label', 'n', 'pinnedEventId', 'plan', 'recSig', 'sig',
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
    assert.equal(c.sheets[b.id].pinnedEventId, 4567890);
    assert.throws(() => upload(c, slug, planJson('Rollers fast', ['1001']), {type: 'y'.repeat(31), as: 'new'}, {newId}), clubError('bad-type'));
    // An upload by someone whose page shows an older version reports the team's last change.
    const before = c.teams[slug].changedAt;
    const r = upload(c, slug, planJson('Rollers C', ['1003']), {as: 'new', type: 'C', base: c.teams[slug].version - 1}, {now: NOW + 60000, newId});
    assert.equal(r.changedAt, before);
    assert.throws(() => upload(c, slug, planJson('Rollers C', ['1003']), {as: 'zzzzzz'}, {newId}), clubError('not-found'));
    assert.throws(() => upload(c, slug, {team: {name: 'Nobody'}, riders: {}}, {}, {newId}), clubError('bad-plan'));
});


test('uploadSheet: refused once S + 4 h has passed', () => {
    const {c, slugs: [slug], newId} = setup();
    const json = planJson('Rollers fast', ['1001']);
    assert.throws(() => upload(c, slug, json, {}, {now: T('2026-11-19T22:30:00.001Z'), newId}), clubError('race-over'));
    assert.deepEqual(c.sheets, {});
    const r = upload(c, slug, json, {}, {now: T('2026-11-19T22:30Z'), newId});
    assert.equal(c.teams[slug].live, r.id);
    assert.throws(() => upload(c, slug, json, {as: 'new', type: 'B', date: '2026-02-30'}, {newId}), clubError('bad-date'));
});


test('uploadSheet: staggered slots on one date', () => {
    const {c, slugs: [rollers, sprockets], newId} = setup([['Kettenfett Rollers', '19:30'], ['Kettenfett Sprockets', '19:40']]);
    const a = upload(c, rollers, planJson('Rollers fast', ['1001', '1002']), {}, {newId});
    const b = upload(c, sprockets, planJson('Sprockets', ['1003', '1004']), {}, {newId});
    assert.equal(a.live, true);
    assert.equal(b.live, true);
    assert.equal(c.teams[rollers].live, a.id);
    assert.equal(c.teams[sprockets].live, b.id);
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
    const r = upload(d.c, t, planJson('Ninth', ['1002']), {as: 'new', live: false}, {newId: d.newId});
    assert.deepEqual(r.dropped, {kind: 'plan', label: 'V3', date: '2026-11-12'});
    assert.equal(Object.hasOwn(d.c.sheets, 'a00003'), false);
    assert.equal(Object.hasOwn(d.c.sheets, 'a00033'), false);
    assert.equal(plansOf(d.c, t).length, 8);
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
    assert.equal(f.c.teams[w].live, live.id);
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
    assert.equal(c.teams[slug].live, r.id);
    assert.deepEqual(c.sheets[first.id], v1);
    assert.equal(c.log.at(-1).label, 'Kettenfett Rollers v2');
});


test('a version keeps the learned event without a link; a given link drops it', () => {
    const {c, slugs: [slug], newId} = setup();
    const {id} = upload(c, slug, planJson('Rollers fast', ['1001']), {}, {newId});
    assert.equal(learnEvent(c, id, 4567890, NOW), true);
    const v2 = upload(c, slug, planJson('Rollers fast', ['1002']), {as: id}, {newId});
    assert.equal(c.sheets[v2.id].eventId, 4567890);
    assert.equal(c.sheets[v2.id].boundAt, new Date(NOW).toISOString());
    const v3 = upload(c, slug, planJson('Rollers fast', ['1003']), {as: id, pinnedEventId: 4567899}, {newId});
    assert.equal(c.sheets[v3.id].eventId, null);
    assert.equal(c.sheets[v3.id].boundAt, null);
    assert.equal(c.sheets[v3.id].pinnedEventId, 4567899);
    // the date of a version is its plan's
    const v4 = upload(c, slug, planJson('Rollers fast', ['1004']), {as: id, date: '2026-11-26'}, {newId});
    assert.equal(c.sheets[v4.id].date, DATE);
    assert.equal(c.sheets[v4.id].pinnedEventId, 4567899);
});


test('makeLive keeps upload times', () => {
    const {c, slugs: [slug], newId} = setup();
    const a = upload(c, slug, planJson('Rollers fast', ['1001']), {}, {newId});
    const b = upload(c, slug, planJson('Rollers slow', ['1002']), {as: 'new', type: 'slow', live: false}, {now: NOW + 60000, newId});
    const uploaded = c.sheets[b.id].uploadedAt;
    const version = c.teams[slug].version;
    makeLive(c, slug, b.id, NOW + 3600000);
    assert.equal(c.teams[slug].live, b.id);
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
    assert.equal(c.teams[slug].live, null);
    assert.equal(Object.hasOwn(c.sheets, a.id), false);
    assert.equal(c.log.at(-1).what, 'delete');

    const version = c.teams[slug].version;
    assert.equal(learnEvent(c, b.id, 4567891, NOW), false);
    unpin(c, slug, b.id, NOW);
    assert.equal(c.sheets[b.id].pinnedEventId, null);
    assert.equal(c.teams[slug].version, version + 1);
    assert.equal(c.log.at(-1).what, 'unpin');

    const logged = c.log.length;
    const v = c.teams[slug].version;
    assert.equal(learnEvent(c, b.id, '4567891', NOW), true);
    assert.equal(c.sheets[b.id].eventId, 4567891);
    assert.equal(c.sheets[b.id].boundAt, new Date(NOW).toISOString());
    assert.equal(c.teams[slug].version, v);
    assert.equal(c.log.length, logged);
    assert.equal(learnEvent(c, b.id, 4567892, NOW), false);
    assert.equal(c.sheets[b.id].eventId, 4567891);
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
    assert.equal(c.teams[sprockets].live, b.id);
    assert.doesNotMatch(JSON.stringify(c.log), /1001|1006/);
    assert.equal(removeRider(c, '__proto__', NOW), 0);

    // A live one-rider sheet goes, and so does the live pointer; a deleted plan lists him nowhere.
    const d = setup();
    const s = d.slugs[0];
    const x = upload(d.c, s, planJson('Rollers fast', ['1001']), {}, {newId: d.newId});
    assert.equal(removeRider(d.c, 1001, NOW), 1);
    assert.equal(Object.hasOwn(d.c.sheets, x.id), false);
    assert.equal(d.c.teams[s].live, null);
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
    c.teams[rollers].live = 'a00122';
    const now = T('2026-11-20T12:00Z');   // cutoff 13 Nov
    // the read-only dry run names exactly what sweepClub deletes, and changes nothing
    const copy = structuredClone(c);
    assert.deepEqual(sweptSheets(c, now).sort(), ['a00005', 'a00012', 'a00055', 'a00122', 'b00012']);
    assert.deepEqual(c, copy);
    assert.equal(sweepClub(c, now), 5);
    assert.deepEqual(Object.keys(c.sheets).sort(), ['a00014', 'a00026']);
    assert.equal(c.teams[rollers].live, null);
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
    assert.throws(() => backTo(c, 'toString', {plan: id, n: 1, version: 1}, {now: NOW, newId}), clubError('not-found'));
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


test('teamHint: name first, overlap second', () => {
    const {c, slugs: [rollers, sprockets], newId} = setup([['Rollers', '19:30'], ['Sprockets', '19:40']]);
    const ids = json => Object.keys(json.riders);
    // a name: the planner name of another team's version (keys ignore case, spaces and punctuation)
    upload(c, sprockets, planJson('Sprockets fast', ['1009']), {}, {newId});
    let json = planJson('Sprockets fast', ['1001', '1002']);
    assert.deepEqual(teamHint(c, rollers, json, ids(json)), {kind: 'name', team: 'sprockets'});
    json = planJson(' sprockets-FAST ', ['1001', '1002']);
    assert.deepEqual(teamHint(c, rollers, json, ids(json)), {kind: 'name', team: 'sprockets'});
    // or another team's name
    json = planJson('Sprockets', ['1001']);
    assert.deepEqual(teamHint(c, rollers, json, ids(json)), {kind: 'name', team: 'sprockets'});
    // its own team's name or planner name: no hint
    json = planJson('Rollers', ['1001']);
    assert.equal(teamHint(c, rollers, json, ids(json)), null);
    // a name without a key (one character, non-Latin, emoji only) never matches
    for (const name of ['S', 'Спрокетс', '🚲🚲']) {
        json = planJson(name, ['1001']);
        assert.equal(teamHint(c, rollers, json, ids(json)), null, name);
    }

    // an overlap: 7 of this sheet's 8 riders ride in Sprockets' live sheet
    const EIGHT_S = ['1001', '1002', '1003', '1004', '1005', '1006', '1007', '1009'];
    upload(c, sprockets, planJson('Sprockets', EIGHT_S), {as: 'new', type: 'B', live: true}, {newId});
    json = planJson('Rollers new', EIGHT);
    assert.deepEqual(teamHint(c, rollers, json, ids(json)), {kind: 'overlap', team: 'sprockets', shared: 7, total: 8});
    // a matching name and an overlap together: the name
    json = planJson('Sprockets fast', EIGHT);
    assert.deepEqual(teamHint(c, rollers, json, ids(json)), {kind: 'name', team: 'sprockets'});
    // below 60 %: 4 of 8
    json = planJson('Rollers new', ['1001', '1002', '1003', '1004', '1010', '1011', '1012', '1013']);
    assert.equal(teamHint(c, rollers, json, ids(json)), null);
    // 5 of 8 is 62.5 %
    json = planJson('Rollers new', ['1001', '1002', '1003', '1004', '1005', '1011', '1012', '1013']);
    assert.deepEqual(teamHint(c, rollers, json, ids(json)), {kind: 'overlap', team: 'sprockets', shared: 5, total: 8});
    // this team's live sheet shares as many: no hint
    upload(c, rollers, planJson('Rollers fast', EIGHT), {as: 'new', live: true}, {newId});
    json = planJson('Rollers new', EIGHT);
    assert.equal(teamHint(c, rollers, json, ids(json)), null);
    // bench listings do not count as riders
    json = planJson('Rollers new', ['1010', '1011'], EIGHT_S);
    assert.equal(teamHint(c, rollers, json, ids(json)), null);
});


test('a version keeps the event link of its plan when none is given', () => {
    const {c, slugs: [slug], newId} = setup();
    const {id} = upload(c, slug, planJson('Rollers fast', ['1001']), {pinnedEventId: 4567890}, {newId});
    // the field left empty: the plan's link carries over
    const v2 = upload(c, slug, planJson('Rollers fast', ['1002']), {as: id}, {newId});
    assert.strictEqual(c.sheets[v2.id].pinnedEventId, 4567890);
    assert.equal(c.sheets[v2.id].eventId, null);
    // a new link wins; the earlier versions keep theirs
    const v3 = upload(c, slug, planJson('Rollers fast', ['1003']), {as: id, pinnedEventId: 4567899}, {newId});
    assert.strictEqual(c.sheets[v3.id].pinnedEventId, 4567899, 'a new link replaces it');
    assert.strictEqual(c.sheets[v2.id].pinnedEventId, 4567890);
    assert.strictEqual(c.sheets[id].pinnedEventId, 4567890);
    // a new plan never takes another plan's link
    const other = upload(c, slug, planJson('Rollers B', ['1004']), {as: 'new', type: 'B', live: false}, {newId}).id;
    assert.strictEqual(c.sheets[other].pinnedEventId, null);
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
    assert.equal(s1.copyOf, null);
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


test('uploadSheet: a version keeps the plan\'s type and date; a changed type retypes from then on', () => {
    const {c, slugs: [slug], newId} = setup();
    const v1 = upload(c, slug, planJson('Rollers fast', ['1001']), {as: 'new', type: 'fast', live: true}, {newId});
    assert.equal(c.sheets[v1.id].label, 'Kettenfett Rollers · fast');
    const v2 = upload(c, slug, planJson('Rollers fast', ['1002']), {as: v1.id, type: undefined, date: '2026-11-26', live: true}, {newId});
    assert.equal(c.sheets[v2.id].type, 'fast');
    assert.equal(c.sheets[v2.id].label, 'Kettenfett Rollers · fast');
    assert.equal(c.sheets[v2.id].date, '2026-11-19');
    const v3 = upload(c, slug, planJson('Rollers fast', ['1003']), {as: v1.id, type: 'A', live: true}, {newId});
    assert.equal(c.sheets[v3.id].label, 'Kettenfett Rollers · A');
    assert.equal(plansOf(c, slug)[0].type, 'A');
    assert.equal(c.sheets[v1.id].type, 'fast', 'older versions keep theirs');
    assert.deepEqual(teamTypes(c, slug), ['A', 'fast']);
});


test('uploadSheet: event fields from the live version of a live plan, else from the newest', () => {
    const {c, slugs: [slug], newId} = setup();
    const v1 = upload(c, slug, planJson('Rollers fast', ['1001']), {as: 'new', live: true, pinnedEventId: 4567890}, {newId});
    c.sheets.vv0002 = sheet({
        team: slug, label: 'Kettenfett Rollers', date: DATE, riders: ['1002'], uploadedAt: '2026-11-19T11:00:00.000Z',
        plan: v1.id, n: 2, pinnedEventId: null,
    });
    const v3 = upload(c, slug, planJson('Rollers fast', ['1003']), {as: v1.id, live: false}, {newId});
    assert.equal(v3.n, 3);
    assert.equal(c.sheets[v3.id].pinnedEventId, 4567890, 'from the live v1, not the newest v2');
    c.teams[slug].live = 'vv0002';
    c.sheets.vv0002.eventId = 111;
    c.sheets.vv0002.boundAt = '2026-11-19T11:30:00.000Z';
    const v4 = upload(c, slug, planJson('Rollers fast', ['1004']), {as: v1.id, live: false}, {newId});
    assert.equal(c.sheets[v4.id].eventId, 111);
    assert.equal(c.sheets[v4.id].boundAt, '2026-11-19T11:30:00.000Z');
    assert.equal(c.sheets[v4.id].pinnedEventId, null);
    // a plan that is not live: from its newest version (v4)
    c.teams[slug].live = null;
    c.sheets[v4.id].eventId = 222;
    const v5 = upload(c, slug, planJson('Rollers fast', ['1005']), {as: v1.id, live: false}, {newId});
    assert.equal(c.sheets[v5.id].eventId, 222);
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
    assert.equal(c.teams[slug].live, v1.id);
    assert.equal(v2.live, false);
    const v3 = upload(c, slug, planJson('Rollers fast', ['1003']), {as: v1.id, live: true}, {newId});
    assert.equal(c.teams[slug].live, v3.id);
    assert.equal(v3.live, true);
    const other = upload(c, slug, planJson('Rollers slow', ['1004']), {as: 'new', type: 'slow', live: false}, {newId});
    assert.equal(other.live, false);
    assert.equal(c.teams[slug].live, v3.id);
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
        changedAt: null, plan: same.plan, startMoved: null,
    });
    assert.deepEqual(same.plan.riders.map(r => r.id), ['1003']);
    assert.equal(Object.keys(c.sheets).length, count);
    assert.equal(c.teams[slug].version, version);
    assert.equal(c.log.length, log);
    assert.equal(c.teams[slug].live, v1.id);
    // the type given again, same as the plan's: still the same
    assert.equal(upload(c, slug, planJson('Rollers fast', ['1003']), {as: v1.id, type: ' fast', live: false}, {newId}).same, true);
    // with the live box on, the newest version goes live: a bump and a log entry, no new version
    const on = upload(c, slug, planJson('Rollers fast', ['1003']), {as: v2.id, live: true}, {now: later, newId});
    assert.equal(on.same, true);
    assert.equal(on.id, v2.id);
    assert.equal(on.live, true);
    assert.equal(c.teams[slug].live, v2.id);
    assert.equal(c.teams[slug].version, version + 1);
    assert.equal(Object.keys(c.sheets).length, count);
    assert.deepEqual(c.log.at(-1), {at: new Date(later).toISOString(), what: 'live', team: slug, label: 'Kettenfett Rollers · fast'});
    // another type is a new version
    const typed = upload(c, slug, planJson('Rollers fast', ['1003']), {as: v1.id, type: 'slow', live: true}, {newId});
    assert.equal(typed.same, false);
    assert.equal(typed.n, 3);
    // so is other text
    const text = [{name: 'Dan', pullWatts: 380, pullS: 60, colorName: 'Red', colorHex: '#ff0000'}];
    const texted = upload(c, slug, planJson('Rollers fast', ['1003']), {as: v1.id, text, live: true}, {newId});
    assert.equal(texted.same, false);
    assert.equal(texted.n, 4);
});


test('uploadSheet: same content with another event link is a new version', () => {
    const {c, slugs: [slug], newId} = setup();
    const v1 = upload(c, slug, planJson('Rollers fast', ['1001']), {as: 'new', live: true}, {newId});
    const linked = upload(c, slug, planJson('Rollers fast', ['1001']), {as: v1.id, live: true, pinnedEventId: 4567890}, {newId});
    assert.equal(linked.same, false);
    assert.equal(linked.n, 2);
    assert.equal(c.sheets[linked.id].pinnedEventId, 4567890);
    // the same link again, or none (the plan's carries over): the same
    assert.equal(upload(c, slug, planJson('Rollers fast', ['1001']), {as: v1.id, live: true, pinnedEventId: 4567890}, {newId}).same, true);
    assert.equal(upload(c, slug, planJson('Rollers fast', ['1001']), {as: v1.id, live: true}, {newId}).same, true);
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
    // the typeless plan's next version may stay typeless (left out or blank)
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
    // a version retyped
    assert.throws(() => upload(c, slug, planJson('Rollers', ['1006']), {as: first.id, type: 'Fast', live: true}, {newId}),
        clubError('type-taken'));
    const slow = upload(c, slug, planJson('Rollers', ['1006']), {as: first.id, type: 'slow', live: true}, {newId});
    assert.equal(c.sheets[slow.id].label, 'Kettenfett Rollers · slow');
    // now the race has no typeless plan: a version of FAST may drop its type
    const bare = upload(c, slug, planJson('Rollers', ['1007']), {as: fast.id, type: '', live: false}, {newId});
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


test('makeLive with any version; delete removes the whole plan; unpin clears every version', () => {
    const {c, slugs: [slug], newId} = setup();
    const v1 = upload(c, slug, planJson('Rollers', ['1001']), {as: 'new', live: true, pinnedEventId: 4567890}, {newId});
    const v2 = upload(c, slug, planJson('Rollers', ['1002']), {as: v1.id, live: true}, {newId});
    const other = upload(c, slug, planJson('Rollers', ['1003']), {as: 'new', type: 'B', live: false}, {newId});
    makeLive(c, slug, v1.id, NOW);
    assert.equal(c.teams[slug].live, v1.id);
    // unpin on v2: both versions lose the link
    assert.equal(c.sheets[v2.id].pinnedEventId, 4567890);
    unpin(c, slug, v2.id, NOW);
    assert.equal(c.sheets[v1.id].pinnedEventId, null);
    assert.equal(c.sheets[v2.id].pinnedEventId, null);
    assert.equal(c.log.at(-1).label, 'Kettenfett Rollers');
    // delete by v2: v1 and v2 go, the live pointer too; the other plan stays
    deleteSheet(c, slug, v2.id, NOW);
    assert.equal(Object.hasOwn(c.sheets, v1.id), false);
    assert.equal(Object.hasOwn(c.sheets, v2.id), false);
    assert.equal(c.teams[slug].live, null);
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
    assert.equal(c.teams[rollers].live, null);
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
    assert.equal(teamHint(c, rollers, json, Object.keys(json.riders)), null);
    json = planJson('Sprockets A', ['1001']);
    assert.deepEqual(teamHint(c, rollers, json, Object.keys(json.riders)), {kind: 'name', team: 'sprockets'});
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
        assert.equal(c.teams[slug].live, null);
    }
    const v1 = upload(c, slug, planJson('Rollers fast', EIGHT), {as: 'new', type: 'fast', live: true}, {newId});
    assert.equal(c.teams[slug].live, v1.id);
    // a new version of the live plan with the box off stays not live
    const v2 = upload(c, slug, planJson('Rollers fast', EIGHT.slice(1)), {as: v1.id, live: false}, {newId});
    assert.equal(v2.planId, v1.id);
    assert.equal(c.teams[slug].live, v1.id);
});


test('backTo: content, copyOf, via, upload time from vN, at now; live only for a live plan; guard; unknown or newest n; redo', () => {
    const {c, slugs: [slug], newId} = setup();
    const at = hhmm => T(`2026-11-19T${hhmm}:00Z`);
    const v1 = upload(c, slug, planJson('Rollers fast', ['1001', '1002', '1003']), {as: 'new', type: 'fast', live: true}, {now: at('14:00'), newId});
    const v2 = upload(c, slug, planJson('Rollers fast', ['1002', '1003']), {as: v1.id}, {now: at('15:00'), newId});
    const v3 = upload(c, slug, planJson('Rollers fast', ['1003', '1002']), {as: v1.id, type: 'A', pinnedEventId: 4567890}, {now: at('16:00'), newId});
    assert.equal(c.teams[slug].live, v3.id);
    const old = structuredClone(c.sheets[v1.id]);
    const version = c.teams[slug].version;
    const r = backTo(c, slug, {plan: v1.planId, n: 1, version}, {now: at('17:00'), newId});
    assert.deepEqual({n: r.n, from: r.from, planId: r.planId, live: r.live, dropped: r.dropped}, {n: 4, from: 1, planId: v1.id, live: true, dropped: null});
    const s = c.sheets[r.id];
    assert.deepEqual(s.json, old.json);
    assert.deepEqual(s.text, old.text);
    assert.equal(s.sig, old.sig);
    assert.equal(s.recSig, old.sig);
    assert.equal(s.jsonName, old.jsonName);
    assert.equal(s.type, 'A', 'the plan\'s current type, not v1\'s');
    assert.equal(old.type, 'fast');
    assert.equal(s.label, 'Kettenfett Rollers · A');
    assert.equal(s.copyOf, 1);
    assert.equal(s.via, 'back');
    assert.equal(s.uploadedAt, old.uploadedAt);
    assert.equal(s.uploadedAt, new Date(at('14:00')).toISOString());
    assert.equal(s.at, new Date(at('17:00')).toISOString());
    assert.equal(s.plan, v1.id);
    assert.equal(s.date, DATE);
    assert.equal(s.pinnedEventId, 4567890, 'the event link of the live version');
    assert.deepEqual(Object.keys(s).sort(), Object.keys(old).sort());
    assert.deepEqual(c.sheets[v1.id], old, 'v1 itself stays');
    assert.equal(c.teams[slug].live, r.id);
    assert.equal(c.teams[slug].version, version + 1);
    assert.equal(c.teams[slug].changedAt, new Date(at('17:00')).toISOString());
    assert.deepEqual(c.log.at(-1), {at: new Date(at('17:00')).toISOString(), what: 'back', team: slug, label: 'Kettenfett Rollers · A v1 → v4'});
    assert.equal(Object.hasOwn(c.teams[slug], 'lastDate'), false, 'Back writes no lastDate');
    assert.equal(Object.hasOwn(c.teams[slug], 'undo'), false);

    // the guard: the version the page was drawn with
    const now = at('17:05');
    const ver = () => c.teams[slug].version;
    assert.throws(() => backTo(c, slug, {plan: v1.planId, n: 2, version}, {now, newId}), clubError('changed'));
    assert.throws(() => backTo(c, slug, {plan: v1.planId, n: 2, version: ver() - 1}, {now, newId}), clubError('changed'));
    // an n that is not stored, or the newest
    assert.throws(() => backTo(c, slug, {plan: v1.planId, n: 9, version: ver()}, {now, newId}), clubError('not-found'));
    assert.throws(() => backTo(c, slug, {plan: v1.planId, n: 4, version: ver()}, {now, newId}), clubError('not-found'));
    assert.throws(() => backTo(c, slug, {plan: v1.planId, n: '', version: ver()}, {now, newId}), clubError('not-found'));
    assert.throws(() => backTo(c, slug, {plan: 'zzzzzz', n: 1, version: ver()}, {now, newId}), clubError('not-found'));
    assert.throws(() => backTo(c, slug, {plan: '__proto__', n: 1, version: ver()}, {now, newId}), clubError('not-found'));
    // any id of the plan names it
    assert.equal(planOfId(c, slug, v2.id).id, v1.id);
    // redo: the copy's previous version is the one just left
    assert.equal(previousVersion(c, r.id)[1].n, 3);
    const redo = backTo(c, slug, {plan: v2.id, n: '3', version: ver()}, {now, newId});
    assert.equal(redo.n, 5);
    assert.equal(c.sheets[redo.id].sig, c.sheets[v3.id].sig);
    assert.equal(c.sheets[redo.id].copyOf, 3);
    assert.equal(c.teams[slug].live, redo.id);

    // a plan that is not live: the copy is stored, the live version stays
    const b1 = upload(c, slug, planJson('Rollers B', ['1004']), {as: 'new', type: 'B', live: false}, {now: at('14:30'), newId});
    upload(c, slug, planJson('Rollers B', ['1004', '1005']), {as: b1.id, live: false}, {now: at('15:30'), newId});
    const stored = backTo(c, slug, {plan: b1.id, n: 1, version: ver()}, {now, newId});
    assert.equal(stored.live, false);
    assert.equal(stored.n, 3);
    assert.equal(c.teams[slug].live, redo.id);
    assert.equal(c.sheets[stored.id].pinnedEventId, null);

    // a used-up plan
    const u1 = upload(c, slug, planJson('Rollers old', ['1006']), {as: 'new', type: 'old', live: false, date: '2026-11-12'}, {now: T('2026-11-12T10:00Z'), newId});
    upload(c, slug, planJson('Rollers old', ['1006', '1007']), {as: u1.id, live: false}, {now: T('2026-11-12T10:00Z'), newId});
    assert.throws(() => backTo(c, slug, {plan: u1.id, n: 1, version: ver()}, {now, newId}), clubError('plan-used'));
    // the guard comes first
    assert.throws(() => backTo(c, slug, {plan: u1.id, n: 1, version: ver() - 1}, {now, newId}), clubError('changed'));
});


test('backTo: counts against MAX_VERSIONS; the lowest version that is not live goes, vN\'s content stays', () => {
    const {c, slugs: [slug], newId} = setup();
    const v1 = upload(c, slug, planJson('Rollers fast', ['1001']), {as: 'new', live: false}, {newId});
    for (let i = 2; i <= MAX_VERSIONS; i++) {
        upload(c, slug, planJson('Rollers fast', ['1001', String(1000 + i)]), {as: v1.id, live: false}, {newId});
    }
    const sig1 = c.sheets[v1.id].sig;
    const r = backTo(c, slug, {plan: v1.id, n: 1, version: c.teams[slug].version}, {now: NOW, newId});
    assert.equal(r.n, MAX_VERSIONS + 1);
    assert.deepEqual(r.dropped, {kind: 'version', n: 1, label: 'Kettenfett Rollers'});
    assert.equal(Object.hasOwn(c.sheets, v1.id), false);
    assert.equal(c.sheets[r.id].sig, sig1);
    assert.equal(plansOf(c, slug)[0].versions.length, MAX_VERSIONS);
    assert.equal(plansOf(c, slug)[0].id, v1.id, 'the plan keeps its id');
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
    assert.equal(c.teams[slug].live, r.id);
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
        name: 'Owls', start: '20:00', live: null, version: 1, changedAt: new Date(NOW).toISOString(), kind: 'weekly', weekday: 3,
    });
    // special: the start goes, even one that is no time (it is ignored, not checked)
    const cogs = add({name: 'Cogs', start: '19:30', kind: 'special', weekday: null});
    assert.equal(c.teams[cogs].kind, 'special');
    assert.equal(c.teams[cogs].start, null);
    assert.equal(c.teams[add({name: 'Gears', start: '7:30', kind: 'special', weekday: null})].start, null);
    // without a rhythm: weekly on the club's day
    const wheels = add({name: 'Wheels', start: null});
    assert.equal(c.teams[wheels].kind, 'weekly');
    assert.equal(c.teams[wheels].weekday, null);
    const count = Object.keys(c.teams).length;
    const log = c.log.length;
    for (const [fields, code] of [
        [{kind: 'monthly', weekday: null}, 'bad-kind'], [{kind: '', weekday: null}, 'bad-kind'], [{kind: null, weekday: null}, 'bad-kind'],
        [{kind: 'weekly', weekday: 0}, 'bad-weekday'], [{kind: 'weekly', weekday: 8}, 'bad-weekday'],
        [{kind: 'weekly', weekday: NaN}, 'bad-weekday'], [{kind: 'special', weekday: '2'}, 'bad-weekday'],
        [{kind: 'weekly', weekday: null, start: '24:00'}, 'bad-start'],
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
    setKind(c, slug, {kind: 'weekly', weekday: null}, NOW);
    assert.equal(c.teams[slug].start, '19:30');
});


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
    assert.equal(c.teams[cogs].raceStarts, undefined);
    // the date is checked first
    assert.throws(() => upload(c, cogs, json, {date: '', start: ''}, {newId}), clubError('bad-date'));
    const r = upload(c, cogs, json, {start: '20:15'}, {newId});
    assert.equal(r.startMoved, null, 'a new race moves nothing');
    // one source of truth: the race's start on the team, none on the version
    assert.deepEqual(c.teams[cogs].raceStarts, {[DATE]: '20:15'});
    assert.equal(Object.hasOwn(c.sheets[r.id], 'start'), false);
    assert.equal(plannedStart(c, c.sheets[r.id]), T('2026-11-19T19:15:00Z'));
    // the race is over 4 h after the posted start, not before
    assert.throws(() => upload(c, cogs, json, {date: '2026-11-18', start: '20:15', type: 'b'}, {now: T('2026-11-18T23:15:00.001Z'), newId}),
        clubError('race-over-time'));
    assert.equal(c.teams[cogs].raceStarts['2026-11-18'], undefined, 'a refusal sets nothing');
    assert.equal(upload(c, cogs, json, {date: '2026-11-18', start: '20:15', type: 'b'}, {now: T('2026-11-18T23:15:00Z'), newId}).created, true);
    // a weekly team's plans start at the team's start, whatever is posted
    const w = upload(c, 'rollers', planJson('Rollers', ['1003']), {start: '21:00'}, {newId});
    assert.equal(c.teams.rollers.raceStarts, undefined);
    assert.equal(plannedStart(c, c.sheets[w.id]), T('2026-11-19T18:30:00Z'));
});


test('uploadSheet: the newest Store for a date sets its race\'s start; the other plans move with it', () => {
    const {c, cogs, newId} = specialSetup();
    const fast = upload(c, cogs, planJson('Cogs', ['1001', '1002']), {start: '20:15', type: 'fast'}, {newId});
    // a second plan of 19 Nov with another time moves the race: both plans start at 21:15
    const slow = upload(c, cogs, planJson('Cogs', ['1003']), {start: '21:15', type: 'slow', live: false}, {newId});
    assert.deepEqual(slow.startMoved, {date: DATE, start: '21:15', was: '20:15', others: ['Cogs · fast']});
    assert.deepEqual(c.teams[cogs].raceStarts, {[DATE]: '21:15'});
    assert.equal(plannedStart(c, c.sheets[fast.id]), T('2026-11-19T20:15:00Z'));
    // a version with another time (the mistyped one corrected), and the date stays the plan's
    const v2 = upload(c, cogs, planJson('Cogs', ['1001']), {as: fast.id, start: '20:45', date: '2026-11-26'}, {newId});
    assert.deepEqual([c.sheets[v2.id].date, v2.startMoved], [DATE, {date: DATE, start: '20:45', was: '21:15', others: ['Cogs · slow']}]);
    // the same time, or none posted: the race keeps it, nothing to say
    const v3 = upload(c, cogs, planJson('Cogs', ['1002']), {as: fast.id, start: '20:45'}, {newId});
    assert.equal(v3.startMoved, null);
    const v4 = upload(c, cogs, planJson('Cogs', ['1004']), {as: fast.id, start: ''}, {newId});
    assert.deepEqual([v4.startMoved, c.teams[cogs].raceStarts[DATE]], [null, '20:45']);
    // the same content with a new time stores no version, but the time applies, with a log entry
    const version = c.teams[cogs].version;
    const same = upload(c, cogs, planJson('Cogs', ['1004']), {as: fast.id, start: '19:50'}, {newId});
    assert.equal(same.same, true);
    assert.deepEqual(same.startMoved, {date: DATE, start: '19:50', was: '20:45', others: ['Cogs · slow']});
    assert.equal(c.teams[cogs].raceStarts[DATE], '19:50');
    assert.equal(c.teams[cogs].version, version + 1);
    assert.deepEqual(c.log.at(-1), {at: new Date(NOW).toISOString(), what: 'race-start', team: cogs, label: 'Thu 19 Nov 19:50'});
    // Back to v1 keeps the race's start
    backTo(c, cogs, {plan: fast.id, n: 1, version: c.teams[cogs].version}, {now: NOW, newId});
    assert.equal(c.teams[cogs].raceStarts[DATE], '19:50');
    // storeEntry passes the start on
    const id = addEntry(c, {source: 'upload', team: cogs, json: planJson('Cogs', ['1006']), text: null}, {now: NOW, newId});
    storeEntry(c, id, {slug: cogs, as: 'new', live: false, date: '2026-11-26', start: '18:45', type: null, pinnedEventId: null,
        base: c.teams[cogs].version}, {now: NOW, newId});
    assert.deepEqual(c.teams[cogs].raceStarts, {[DATE]: '19:50', '2026-11-26': '18:45'});
});


test('uploadSheet: race starts go with the last plan of their date', () => {
    const {c, cogs, newId} = specialSetup();
    const a = upload(c, cogs, planJson('Cogs', ['1001']), {start: '20:15', date: '2026-11-21'}, {newId});
    const b = upload(c, cogs, planJson('Cogs', ['1002']), {start: '20:30', date: '2026-11-28', live: false}, {newId});
    assert.deepEqual(c.teams[cogs].raceStarts, {'2026-11-21': '20:15', '2026-11-28': '20:30'});
    // Delete plan
    deleteSheet(c, cogs, b.id, NOW);
    assert.deepEqual(c.teams[cogs].raceStarts, {'2026-11-21': '20:15'});
    // a rider removal that empties the plan
    removeRider(c, '1001', NOW);
    assert.equal(Object.hasOwn(c.sheets, a.id), false);
    assert.equal(c.teams[cogs].raceStarts, undefined, 'none left: the field goes');
    // the sweep (7 days after the race)
    const s = upload(c, cogs, planJson('Cogs', ['1003']), {start: '20:00', date: DATE}, {newId});
    assert.deepEqual(c.teams[cogs].raceStarts, {[DATE]: '20:00'});
    assert.equal(sweepClub(c, T('2026-11-27T12:00Z')), 1);
    assert.equal(Object.hasOwn(c.sheets, s.id), false);
    assert.equal(c.teams[cogs].raceStarts, undefined);
});


test('uploadSheet: a special team\'s race stored by 0.3.0 (no start of its own) gets one with any Store', () => {
    const {c, cogs, newId} = specialSetup();
    // as 0.3.0 stored it: the team's start time, no race start
    c.teams[cogs].start = '19:00';
    const old = upload(c, cogs, planJson('Cogs', ['1001']), {start: '20:15'}, {newId});
    delete c.teams[cogs].raceStarts;
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
    delete d.teams[dc].raceStarts;
    assert.equal(plannedStart(d, d.sheets[bare.id]), null);
    assert.throws(() => upload(d, dc, planJson('Cogs', ['1002']), {as: bare.id, start: ''}, {newId: dn}), clubError('bad-start'));
    const set = upload(d, dc, planJson('Cogs', ['1002']), {as: bare.id, start: '20:30'}, {newId: dn});
    assert.deepEqual(set.startMoved, {date: DATE, start: '20:30', was: null, others: []});
    assert.equal(plannedStart(d, d.sheets[set.id]), T('2026-11-19T19:30:00Z'));
});


test('uploadSheet: a special team\'s version never sets a start time that is over already', () => {
    const {c, cogs, newId} = specialSetup();
    // today's race at 20:15 Berlin (19:15Z); at 15:00Z an AM/PM slip types 08:15 (07:15Z, over 4 h after: 11:15Z)
    const now = T('2026-11-19T15:00Z');
    const v1 = upload(c, cogs, planJson('Cogs', ['1001', '1002']), {start: '20:15'}, {now, newId});
    const sheets = JSON.stringify(c.sheets);
    const version = c.teams[cogs].version;
    // a version with other content, and one with the same content: refused like a new plan, nothing changes
    assert.throws(() => upload(c, cogs, planJson('Cogs', ['1001']), {as: v1.id, start: '08:15'}, {now, newId}), clubError('race-over-time'));
    assert.throws(() => upload(c, cogs, planJson('Cogs', ['1001', '1002']), {as: v1.id, start: '08:15'}, {now, newId}), clubError('race-over-time'));
    assert.equal(JSON.stringify(c.sheets), sheets);
    assert.deepEqual(c.teams[cogs].raceStarts, {[DATE]: '20:15'});
    assert.equal(c.teams[cogs].version, version);
    assert.equal(isUsed(c, c.sheets[v1.id], now), false, 'the plan is not used up');
    // a time still to come is fine (11:15 Berlin is used up at 14:15Z: over; 12:00 at 15:00Z: not)
    assert.throws(() => upload(c, cogs, planJson('Cogs', ['1001']), {as: v1.id, start: '11:15'}, {now, newId}), clubError('race-over-time'));
    assert.equal(upload(c, cogs, planJson('Cogs', ['1001']), {as: v1.id, start: '12:00'}, {now, newId}).n, 2);
    assert.equal(c.teams[cogs].raceStarts[DATE], '12:00');
});
