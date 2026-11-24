// The team view (plan 3b, Task 3): the pure model behind the picker, the switcher and the team page
// (spec §5.4): order, status (worst state), notes and "N to fix", rider states, the before-gate
// view, riders-only counts, the pull target, the no-start-time trap, Back to vN in words, the
// refresh window.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {club as clubOf, sheet, planJson, T, liveId, race, setLive} from './helpers.mjs';
import {tidyRaces} from '../races.mjs';
import {
    teamView, teamRow, teamOrder, refreshDue, untilLabel, atLabel, pullTarget, nextRace, SEV, worst,
    andList, quote, foldedTeams, liveWords, liveQuestion, raceWithin, gateOpen,
    raceDates, raceView, nextRaceAt, teamShare, newerNotLive,
} from '../team-view.mjs';
import {cockpitClub, plan, NOW} from './cockpit-fixture.mjs';
import {nextRaceDate} from '../select.mjs';
import {assignChoices} from '../preselect.mjs';
import {localDay} from '../time.mjs';
import {uploadSheet, makeLive} from '../club.mjs';
// Restore went with the team cockpit (team cockpit spec §4.1); copies it made before stay ordinary versions
import {backTo} from './legacy-back.mjs';
import {stripSheet, normalizePlan} from '../../pages/src/engine/plan.mjs';

const DATE = '2026-11-19';
const S = T('2026-11-19T18:30:00Z');          // Rollers and Sprockets, 19:30 in Berlin
const MIN = 60000;
const ROLLERS = ['1001', '1002', '1003', '1004', '1005', '1006'];
const iso = ms => new Date(ms).toISOString();


function team(name, start, live = null) {
    return {name, start, live, version: 1, undo: null, changedAt: '2026-11-10T10:00:00.000Z'};
}


// Kettenfett RC (Europe/Berlin): Rollers 19:30 with its live plan 'Rollers A' (rrrr01: Ben, Cleo,
// Dan, Eva, Finn, Gus; Hanna only in the planner's roster) and Sprockets 19:30 without a plan.
function base({date = DATE, uploadedAt = `${date}T14:00:00.000Z`} = {}) {
    return clubOf({
        teams: {rollers: team('Rollers', '19:30', 'rrrr01'), sprockets: team('Sprockets', '19:30')},
        sheets: {rrrr01: sheet({team: 'rollers', label: 'Rollers A', date, riders: ROLLERS, bench: ['1007'], uploadedAt})},
    });
}


// A seen entry as store.seenOf gives it.
function seen(at, {sig = null, mod = '0.3.0', sheet: id = 'rrrr01', inEvent = false, event = null} = {}) {
    return {at: iso(T(at)), sig, mod, sheet: id, inEvent, event};
}


test('localDay, andList and quote', () => {
    assert.equal(localDay(S, 'Europe/Berlin'), 'Thu 19 Nov');
    assert.equal(localDay(T('2026-11-19T23:30:00Z'), 'Europe/Berlin'), 'Fri 20 Nov');
    assert.equal(andList([]), '');
    assert.equal(andList(['Ida']), 'Ida');
    assert.equal(andList(['Ida', 'Jo']), 'Ida and Jo');
    assert.equal(andList(['Ida', 'Jo', 'Ben']), 'Ida, Jo and Ben');
    assert.equal(quote('Rollers A'), '\'Rollers A\'');
    assert.equal(worst([]), 'ok');
    assert.equal(worst(['neutral', 'err', 'warn']), 'err');
    assert.deepEqual(SEV, {ok: 0, neutral: 1, warn: 2, err: 3});
});


test('teamView: before the gate, the plan in ride order and no rider state', () => {
    const c = base();
    const live = c.sheets.rrrr01.sig;
    // a check with the live code is no state before the gate
    const view = teamView(c, 'rollers', {now: S - 35 * MIN, seen: {1001: seen('2026-11-19T17:40:00Z', {sig: live})}});
    assert.deepEqual(view.status, {sev: 'neutral', kind: 'opens', icon: 'clock', text: 'Opens 19:00 · 6 riders on this plan'});
    assert.equal(view.open, false);
    assert.deepEqual(view.riders.map(r => r.pos), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(view.riders.map(r => r.name), ['Ben', 'Cleo', 'Dan', 'Eva', 'Finn', 'Gus']);
    assert.ok(view.riders.every(r => r.state === null));
    assert.equal(view.has, null);
    assert.equal(view.count, 6);
    // the planner's roster (Hanna) is no part of the view
    assert.equal(Object.hasOwn(view, 'bench'), false);
    assert.equal(view.sev, 'neutral');
    assert.equal(view.S, S);
    assert.equal(view.gateAt, S - 30 * MIN);
    assert.equal(view.opens, '19:00');
    assert.deepEqual(view.when, {day: 'Thu 19 Nov', time: '19:30', until: 'in 35 min', today: true});
    // (what it changed and Restore went with the old team page's live row)
    assert.deepEqual(view.live, {
        id: 'rrrr01', label: 'Rollers A', type: null, date: DATE, day: 'Thu 19 Nov', sig: live, at: '15:00',
        pinnedEventId: null, eventId: null, sent: true,
        n: 1, planId: 'rrrr01', versions: 1, newer: null,
    });
    const row = teamRow(view);
    assert.deepEqual(row, {
        slug: 'rollers', name: 'Rollers', sev: 'neutral', icon: 'clock', timeLine: '19:30 · in 35 min',
        main: 'Opens 19:00 · 6 riders on this plan', quiet: 'Live: \'Rollers A\'', short: 'Opens 19:00',
    });
});


test('teamView: the gate edge, also after the DST switch', () => {
    // 29 Oct 2026 is winter time (UTC+1): 19:30 is 18:30Z, the gate 18:00Z
    const c = base({date: '2026-10-29'});
    const live = c.sheets.rrrr01.sig;
    const all = Object.fromEntries(ROLLERS.map(id => [id, seen('2026-10-29T17:50:00Z', {sig: live})]));
    const before = teamView(c, 'rollers', {now: T('2026-10-29T17:59:59.999Z'), seen: all});
    assert.equal(before.S, T('2026-10-29T18:30:00Z'));
    assert.equal(before.when.time, '19:30');
    assert.equal(before.open, false);
    assert.equal(before.status.text, 'Opens 19:00 · 6 riders on this plan');
    assert.ok(before.riders.every(r => r.state === null));
    const after = teamView(c, 'rollers', {now: T('2026-10-29T18:00:00Z'), seen: all});
    assert.equal(after.open, true);
    assert.ok(after.riders.every(r => r.state !== null));
    assert.equal(after.status.text, '6 of 6 riders have the plan');
    // 22 Oct is summer time (UTC+2)
    const summer = base({date: '2026-10-22'});
    assert.equal(teamView(summer, 'rollers', {now: T('2026-10-22T12:00:00Z'), seen: {}}).S, T('2026-10-22T17:30:00Z'));
});


test('teamView: counts cover riders only, the roster has no state', () => {
    const c = base();
    const live = c.sheets.rrrr01.sig;
    const all = Object.fromEntries(ROLLERS.map(id => [id, seen('2026-11-19T18:15:00Z', {sig: live, inEvent: true, event: 4567890})]));
    const view = teamView(c, 'rollers', {now: S - 10 * MIN, seen: all});
    assert.equal(view.status.text, '6 of 6 riders have the plan');
    assert.equal(view.status.sev, 'ok');
    assert.equal(view.status.icon, 'checkCircle');
    assert.equal(view.sev, 'ok');
    assert.ok(!view.riders.some(r => r.name === 'Hanna'), 'Hanna is only in the roster');
    assert.equal(Object.hasOwn(view, 'bench'), false);
    assert.equal(view.count, 6);
    assert.equal(view.has, 6);
    assert.deepEqual(view.riders[0].state, {kind: 'has-in-event', sev: 'ok', text: 'Has the plan · in the event', time: null});
    assert.equal(teamRow(view).short, '6 of 6');
    // one of one rider: the singular
    const one = clubOf({
        teams: {rollers: team('Rollers', '19:30', 'rrrr01')},
        sheets: {rrrr01: sheet({team: 'rollers', label: 'Rollers A', date: DATE, riders: ['1001'], uploadedAt: '2026-11-19T14:00:00.000Z'})},
    });
    assert.equal(teamView(one, 'rollers', {now: S - 40 * MIN, seen: {}}).status.text, 'Opens 19:00 · 1 rider on this plan');
    const oneSeen = {1001: seen('2026-11-19T18:15:00Z', {sig: one.sheets.rrrr01.sig, inEvent: true, event: 4567890})};
    assert.equal(teamView(one, 'rollers', {now: S - 10 * MIN, seen: oneSeen}).status.text, '1 of 1 rider has the plan');
});


// Rollers' live plan rrrr01, pinned to event 4567890, with eight riders in a ride order that is
// not the order of their states; Sprockets' live plan ssss01 lists Jo.
function statesClub() {
    const order = ['1008', '1007', '1006', '1001', '1005', '1002', '1004', '1003'];
    return clubOf({
        teams: {rollers: team('Rollers', '19:30', 'rrrr01'), sprockets: team('Sprockets', '19:30', 'ssss01')},
        sheets: {
            rrrr01: sheet({team: 'rollers', label: 'Rollers A', date: DATE, riders: order, uploadedAt: '2026-11-19T14:00:00.000Z', pinnedEventId: 4567890}),
            ssss01: sheet({team: 'sprockets', label: 'Sprockets A', date: DATE, riders: ['1009'], uploadedAt: '2026-11-19T15:00:00.000Z'}),
        },
    });
}


function statesSeen(c) {
    const live = c.sheets.rrrr01.sig;
    const at = '2026-11-19T18:22:00Z';
    return {
        1001: seen(at, {inEvent: true, event: 4567891}),                 // other-event
        1002: seen(at, {sig: live, sheet: 'ssss01'}),                    // other-team
        1003: seen(at, {sig: 'ABC123'}),                                 // old-code
        1004: seen(at, {sig: 'ABC123', inEvent: true, event: 4567890}),  // in-event
        1005: seen(at),                                                  // checked
        1006: seen(at, {mod: '0.2'}),                                    // checked: no "old Paceline" mark (hard cut)
        // 1007: none
        1008: seen(at, {sig: live}),                                     // has
    };
}


test('teamView: rider states, in ride order', () => {
    const c = statesClub();
    const view = teamView(c, 'rollers', {now: S - 5 * MIN, seen: statesSeen(c)});
    // in ride order, as the rider table draws them (team cockpit spec §7, amended 22 Nov 2026)
    assert.deepEqual(view.riders.map(r => [r.name, r.pos]), [
        ['Ida', 1], ['Hanna', 2], ['Gus', 3], ['Ben', 4], ['Finn', 5], ['Cleo', 6], ['Eva', 7], ['Dan', 8],
    ]);
    assert.deepEqual(view.riders.map(r => r.state), [
        {kind: 'has', sev: 'ok', text: 'Has the plan', time: null},
        {kind: 'none', sev: 'neutral', text: 'Not seen yet', time: null},
        {kind: 'checked', sev: 'neutral', text: 'Checked 19:22 · not in the event yet', time: null},
        {kind: 'other-event', sev: 'err', text: 'In event 4567891 · gets nothing', time: '19:22'},
        {kind: 'checked', sev: 'neutral', text: 'Checked 19:22 · not in the event yet', time: null},
        {kind: 'other-team', sev: 'warn', text: 'Rides Sprockets now', time: '19:22'},
        {kind: 'in-event', sev: 'neutral', text: 'In the event · plan comes at the next check', time: '19:22'},
        {kind: 'old-code', sev: 'warn', text: 'Has an older plan (code ABC123)', time: '19:22'},
    ]);
    assert.equal(view.has, 1);
    assert.equal(view.status.text, '1 of 8 riders have the plan');
    assert.equal(view.sev, 'err');
    assert.equal(view.icon, 'x');
    // a private club records no check without the code: the unseen rider may need it (audit S12)
    c.riderCode = {hash: 'x', setAt: '2026-11-10T10:00:00.000Z'};
    const priv = teamView(c, 'rollers', {now: S - 5 * MIN, seen: statesSeen(c)});
    assert.deepEqual(priv.riders.find(r => r.name === 'Hanna').state, {kind: 'none', sev: 'neutral', text: 'Not seen yet · may need the rider code', time: null});
});


test('teamView: the pin note names who is where', () => {
    const c = statesClub();
    const view = teamView(c, 'rollers', {now: S - 5 * MIN, seen: statesSeen(c)});
    assert.equal(view.notes.length, 1);
    const [pin] = view.notes;
    assert.equal(pin.sev, 'err');
    assert.equal(pin.kind, 'pin');
    assert.equal(pin.title, '1 rider is in another event and gets nothing');
    assert.equal(pin.body, 'Ben is in event 4567891. Your event link says 4567890 (Eva is there).');
    assert.equal(pin.short, 'Ben gets nothing');
    assert.equal(pin.after, 'Then riders in either event get the plan by its start time. Or upload the plan again with the right link.');
    assert.equal(pin.event, 4567891);
    assert.deepEqual(pin.names, ['Ben']);
    assert.equal(pin.pinned, 4567890);
    assert.equal(pin.sheet, 'rrrr01');
    assert.deepEqual(pin.events, [
        {event: 4567890, names: ['Eva'], link: true, text: '4567890 (your link): Eva'},
        {event: 4567891, names: ['Ben'], link: false, text: '4567891: Ben'},
    ]);
    // two riders in the other event, nobody at the link
    const s = statesSeen(c);
    s[1004] = seen('2026-11-19T18:22:00Z', {inEvent: true, event: 4567891});
    const two = teamView(c, 'rollers', {now: S - 5 * MIN, seen: s}).notes[0];
    assert.equal(two.title, '2 riders are in another event and get nothing');
    assert.equal(two.body, 'Ben and Eva are in event 4567891. Your event link says 4567890.');
    assert.equal(two.short, 'Ben and Eva get nothing');
    assert.deepEqual(two.events.map(e => e.text), ['4567890 (your link): nobody', '4567891: Ben and Eva']);
    // before the gate: no pin note
    assert.deepEqual(teamView(c, 'rollers', {now: S - 31 * MIN, seen: statesSeen(c)}).notes, []);
});


test('teamView: the worst state wins, notes count the fixes', () => {
    const c = base();
    const live = c.sheets.rrrr01.sig;
    const now = S - 5 * MIN;
    const s = {
        1001: seen('2026-11-19T18:20:00Z', {sig: live}),
        1002: seen('2026-11-19T18:20:00Z', {sig: live}),
        1003: seen('2026-11-19T18:20:00Z', {sig: live}),
    };
    let view = teamView(c, 'rollers', {now, seen: s});
    assert.equal(view.status.text, '3 of 6 riders have the plan');
    assert.equal(view.status.icon, 'users');
    assert.equal(view.sev, 'neutral');
    // an older plan code: amber, but no note
    s[1004] = seen('2026-11-19T18:20:00Z', {sig: 'ABC123'});
    view = teamView(c, 'rollers', {now, seen: s});
    assert.equal(view.sev, 'warn');
    assert.equal(view.icon, 'alert');
    assert.equal(view.notes.length, 0);
    assert.equal(teamRow(view).main, '3 of 6 riders have the plan');
    // a hole: a newer Sprockets plan lists Ben
    c.sheets.ssss01 = sheet({team: 'sprockets', label: 'Sprockets A', date: DATE, riders: ['1001', '1008'], uploadedAt: '2026-11-19T16:00:00.000Z'});
    setLive(c, 'sprockets', 'ssss01');
    view = teamView(c, 'rollers', {now, seen: s});
    assert.equal(view.sev, 'warn');
    assert.equal(view.notes.length, 1);
    assert.deepEqual(view.notes[0], {
        sev: 'warn', kind: 'hole', title: 'Ben now rides Sprockets',
        body: 'Sprockets has Ben in its plan from 17:00; your live plan still lists Ben.',
        short: 'Ben now rides Sprockets', linkText: 'Upload without Ben',
        after: 'Reshuffle: upload every team involved. This clears when the last one is in.',
        id: '1001', name: 'Ben', rides: 'sprockets', ridesName: 'Sprockets', since: '17:00',
    });
    let row = teamRow(view);
    assert.ok(row.main.startsWith('1 to fix · Ben now rides Sprockets'), row.main);
    assert.equal(row.quiet, '3 of 6 riders have the plan');
    assert.equal(row.short, '1 to fix');
    // a pin mismatch: red, the pin note first
    race(c, 'rollers', DATE).pinnedEventId = 4567890;
    s[1005] = seen('2026-11-19T18:22:00Z', {inEvent: true, event: 4567891});
    view = teamView(c, 'rollers', {now, seen: s});
    assert.equal(view.sev, 'err');
    assert.deepEqual(view.notes.map(n => n.kind), ['pin', 'hole']);
    row = teamRow(view);
    assert.ok(row.main.startsWith('2 to fix'), row.main);
    assert.equal(row.main, '2 to fix · Finn gets nothing');
    assert.equal(row.sev, 'err');
    assert.equal(row.icon, 'x');
});


test('teamView: the regular race day only preselects: a weekly team without plans is neutral at any time (spec §8)', () => {
    // Spokes races on Thursdays at 20:15 (19:15Z) and has no plan: from the morning after its race to
    // its regular race's S + 2 h the neutral "Next regular race", never red, never a race of its own
    const c = clubOf({teams: {spokes: team('Spokes', '20:15')}});
    for (const at of ['2026-11-20T08:00:00Z', '2026-11-24T19:15:00Z', '2026-11-26T18:45:00Z', '2026-11-26T19:15:00Z', '2026-11-26T21:15:00Z']) {
        const v = teamView(c, 'spokes', {now: T(at), seen: {}});
        assert.deepEqual(v.status, {sev: 'neutral', kind: 'next-race', icon: 'clock', text: 'Next regular race Thu 26 Nov 20:15'}, at);
        assert.deepEqual([v.sev, v.regular, v.raceDate, v.races, v.notes], ['neutral', true, '2026-11-26', [], []], at);
        assert.equal(teamRow(v).sev, 'neutral', at);
    }
    assert.deepEqual(teamRow(teamView(c, 'spokes', {now: T('2026-11-20T08:00:00Z'), seen: {}})), {
        slug: 'spokes', name: 'Spokes', sev: 'neutral', icon: 'clock', timeLine: 'Thu 26 Nov 20:15 · in 6 days',
        main: 'Next regular race Thu 26 Nov 20:15', quiet: 'No plan yet', short: 'No plan yet',
    });
    // a week on from S + 2 h
    assert.equal(teamView(c, 'spokes', {now: T('2026-11-26T21:15:00.001Z'), seen: {}}).status.text, 'Next regular race Thu 3 Dec 20:15');
    // the rhythm date is no race ahead, only the regular date
    assert.deepEqual(raceDates(c, 'spokes', T('2026-11-20T08:00:00Z')), {ahead: [], over: [], regular: '2026-11-26'});
});


test('teamView: plans stored but none live are red at once, at any distance from the race (spec §8)', () => {
    // a plan stored on Friday for next Thursday's race, none live: red 6 days ahead already
    const c = clubOf({teams: {spokes: team('Spokes', '20:15')}});
    c.sheets.pppp01 = {...sheet({team: 'spokes', label: 'Spokes', date: '2026-11-26', riders: ['1001'], uploadedAt: '2026-11-20T09:00:00.000Z'}), plan: 'pppp01'};
    tidyRaces(c);
    for (const at of ['2026-11-20T10:00:00Z', '2026-11-21T10:00:00Z', '2026-11-26T18:00:00Z']) {
        const v = teamView(c, 'spokes', {now: T(at), seen: {}});
        assert.deepEqual(v.status, {sev: 'err', kind: 'none-live', icon: 'noPlan', text: 'No live plan: riders get nothing'}, at);
        assert.deepEqual([v.sev, v.regular, v.raceDate], ['err', false, '2026-11-26'], at);
    }
    // the picker row 5 days ahead: red, "Make one of its plans live"
    assert.deepEqual(teamRow(teamView(c, 'spokes', {now: T('2026-11-21T10:00:00Z'), seen: {}})), {
        slug: 'spokes', name: 'Spokes', sev: 'err', icon: 'noPlan', timeLine: 'Thu 26 Nov 20:15 · in 5 days',
        main: 'No live plan: riders get nothing', quiet: 'Make one of its plans live', short: 'No live plan',
    });
    assert.deepEqual(teamRow(teamView(c, 'spokes', {now: T('2026-11-26T18:00:00Z'), seen: {}})), {
        slug: 'spokes', name: 'Spokes', sev: 'err', icon: 'noPlan', timeLine: '20:15 · in 1 h 15 min',
        main: 'No live plan: riders get nothing', quiet: 'Make one of its plans live', short: 'No live plan',
    });
    // an over race keeps its rules: no alarm, under Over (S + 2 h on), the regular date neutral again
    const over = teamView(c, 'spokes', {now: T('2026-11-26T21:15:00.001Z'), seen: {}});
    assert.deepEqual([over.status.sev, over.status.kind, over.raceDate, over.over.map(o => o.date)], ['neutral', 'next-race', '2026-12-03', ['2026-11-26']]);
});


test('teamView: a weekly team without a start time is neutral until it has a plan whose race has no time (spec §8)', () => {
    // Cranks races on Thursdays and has no start time: no plan, so no rider is affected yet
    const c = clubOf({teams: {cranks: team('Cranks', null)}});
    for (const at of ['2026-11-20T08:00:00Z', '2026-11-26T18:00:00Z']) {
        const v = teamView(c, 'cranks', {now: T(at), seen: {}});
        assert.deepEqual([v.status, v.sev, v.noStart, v.regular, v.races], [{sev: 'neutral', kind: 'start-unset', icon: 'clock', text: 'No start time set'}, 'neutral', true, true, []], at);
    }
    assert.deepEqual(teamRow(teamView(c, 'cranks', {now: T('2026-11-20T08:00:00Z'), seen: {}})), {
        slug: 'cranks', name: 'Cranks', sev: 'neutral', icon: 'clock', timeLine: 'No start time',
        main: 'No start time set', quiet: 'Set a start time and upload a plan', short: 'No start time',
    });
    // a plan for its race (no time of its own): the red "No start time", live or not, as before
    c.sheets.kkkk01 = {...sheet({team: 'cranks', label: 'Cranks', date: '2026-11-26', riders: ['1001'], uploadedAt: '2026-11-20T09:00:00.000Z'}), plan: 'kkkk01'};
    tidyRaces(c);
    const notLive = teamView(c, 'cranks', {now: T('2026-11-20T10:00:00Z'), seen: {}});
    assert.deepEqual([notLive.status, notLive.sev, notLive.regular], [{sev: 'err', kind: 'no-start', icon: 'clock', text: 'No start time and no live plan'}, 'err', false]);
    setLive(c, 'cranks', 'kkkk01');
    assert.deepEqual(teamView(c, 'cranks', {now: T('2026-11-20T10:00:00Z'), seen: {}}).status,
        {sev: 'err', kind: 'no-start', icon: 'clock', text: 'No start time: riders on this plan get nothing'});
    // the race with its own time: no "No start time" (it has one), red as not live instead
    setLive(c, 'cranks', null);
    race(c, 'cranks', '2026-11-26').start = '19:30';
    assert.deepEqual(teamView(c, 'cranks', {now: T('2026-11-20T10:00:00Z'), seen: {}}).status.kind, 'none-live');
});


test('teamView: a race moved off its rhythm day leaves nothing on that day (spec §8)', () => {
    // Rollers races on Thursdays at 19:30; this week's race moved to Fri 27 Nov 19:30 with its plan,
    // none live yet: Thursday 26 Nov shows nothing, the team's state is Friday's (red at once)
    const c = clubOf({
        teams: {rollers: {...team('Rollers', '19:30'), kind: 'weekly', weekday: 4}},
        sheets: {fri001: {...sheet({team: 'rollers', label: 'Rollers', date: '2026-11-27', riders: ROLLERS, uploadedAt: '2026-11-20T09:00:00.000Z'}), plan: 'fri001', zgShare: 'abcdefghij'}},
    });
    const now = T('2026-11-21T10:00:00Z');
    assert.deepEqual(raceDates(c, 'rollers', now), {ahead: ['2026-11-27'], over: [], regular: null});
    const v = teamView(c, 'rollers', {now, seen: {}});
    assert.deepEqual([v.raceDate, v.races.map(r => r.date), v.status.kind, v.status.sev], ['2026-11-27', ['2026-11-27'], 'none-live', 'err']);
    // the club's next race is Friday's, not the vacated Thursday
    assert.equal(nextRace(c, now), 'Fri 27 Nov');
    // the planner link carries the Friday plan's share (the race the page is about)
    assert.equal(teamShare(c, 'rollers', now), 'abcdefghij');
    // the regular race day still preselects: the upload's default date is the rhythm's Thursday
    assert.equal(nextRaceDate(c, 'rollers', now), '2026-11-26');
    assert.equal(assignChoices(c, {id: 'up0001', team: 'rollers', json: planJson('Rollers', ROLLERS)}, new URLSearchParams(), now).date, '2026-11-26');
});


test('teamView: no plan (neutral, spec §8) and no start time are the status, not notes', () => {
    const c = clubOf({
        teams: {spokes: team('Spokes', '20:15'), cogs: team('Cogs', null, 'cccc01'), cranks: team('Cranks', null)},
        sheets: {cccc01: sheet({team: 'cogs', label: 'Cogs B', date: DATE, riders: ['1008'], uploadedAt: '2026-11-19T17:00:00.000Z'})},
    });
    const now = S - 5 * MIN;
    // no plan 50 min before the regular race: neutral, the regular race day is no race (spec §8)
    const spokes = teamView(c, 'spokes', {now, seen: {}});
    assert.deepEqual(spokes.status, {sev: 'neutral', kind: 'next-race', icon: 'clock', text: 'Next regular race Thu 19 Nov 20:15'});
    assert.deepEqual(spokes.notes, []);
    assert.equal(spokes.sev, 'neutral');
    assert.equal(spokes.live, null);
    assert.deepEqual(teamRow(spokes), {
        slug: 'spokes', name: 'Spokes', sev: 'neutral', icon: 'clock', timeLine: '20:15 · in 50 min',
        main: 'Next regular race Thu 19 Nov 20:15', quiet: 'No plan yet', short: 'No plan yet',
    });
    const cogs = teamView(c, 'cogs', {now, seen: {1008: seen('2026-11-19T18:20:00Z')}});
    assert.deepEqual(cogs.status, {sev: 'err', kind: 'no-start', icon: 'clock', text: 'No start time: riders on this plan get nothing'});
    assert.equal(cogs.live.sent, false);
    assert.equal(cogs.live.label, 'Cogs B');
    assert.deepEqual(cogs.notes, []);
    assert.equal(cogs.S, null);
    assert.equal(cogs.gateAt, null);
    assert.equal(cogs.open, false);
    assert.deepEqual(cogs.when, {day: 'Thu 19 Nov', time: null, until: null, today: true});
    assert.deepEqual(cogs.riders.map(r => r.state), [null]);
    assert.deepEqual(teamRow(cogs), {
        slug: 'cogs', name: 'Cogs', sev: 'err', icon: 'clock', timeLine: 'No start time',
        main: 'No start time: riders on this plan get nothing', quiet: '\'Cogs B\' is ready · set a start time', short: 'No start time',
    });
    // no start time and no plan: a setting, no rider affected yet: neutral (coordinator, spec §8)
    const cranks = teamView(c, 'cranks', {now, seen: {}});
    assert.deepEqual(cranks.status, {sev: 'neutral', kind: 'start-unset', icon: 'clock', text: 'No start time set'});
    assert.equal(teamRow(cranks).sev, 'neutral');
    assert.equal(teamRow(cranks).quiet, 'Set a start time and upload a plan');
    assert.equal(teamRow(cranks).short, 'No start time');
});


test('teamView: the no-start-time trap', () => {
    const c = clubOf({
        teams: {
            rollers: team('Rollers', '19:30'), sprockets: team('Sprockets', '19:30', 'ssss01'),
            pistons: team('Pistons', '20:15', 'pppp01'), cogs: team('Cogs', null, 'cccc01'),
        },
        sheets: {
            ssss01: sheet({team: 'sprockets', label: 'Sprockets A', date: DATE, riders: ['1008', '1001'], uploadedAt: '2026-11-19T16:00:00.000Z'}),
            pppp01: sheet({team: 'pistons', label: 'Pistons A', date: DATE, riders: ['1009', '1002'], uploadedAt: '2026-11-19T17:30:00.000Z'}),
            cccc01: sheet({team: 'cogs', label: 'Cogs B', date: DATE, riders: ['1008', '1009'], uploadedAt: '2026-11-19T17:00:00.000Z'}),
        },
    });
    const before = structuredClone(c);
    const now = T('2026-11-19T17:12:00Z');
    const view = teamView(c, 'cogs', {now, seen: {}});
    assert.deepEqual(view.trap, [{
        team: 'sprockets', teamName: 'Sprockets', names: ['Ida'],
        text: 'Ida rides Sprockets for now; once you set a start time, Ida moves here and Sprockets has a hole.',
    }]);
    assert.deepEqual(c, before);
    // several riders from one team
    c.sheets.cccc01 = sheet({team: 'cogs', label: 'Cogs B', date: DATE, riders: ['1008', '1001', '1009'], uploadedAt: '2026-11-19T17:00:00.000Z'});
    assert.deepEqual(teamView(c, 'cogs', {now, seen: {}}).trap.map(x => x.text),
        ['Ida and Ben ride Sprockets for now; once you set a start time, they move here and Sprockets has a hole.']);
    // a team with a start time has no trap
    assert.deepEqual(teamView(c, 'sprockets', {now, seen: {}}).trap, []);
});


test('teamView: the trap names only riders who leave a hole, never the roster', () => {
    // Ida is only in Sprockets' roster (the club's rider pool): a rider listing on Cogs takes her,
    // Sprockets has no hole, and the trap says nothing about her
    const c = clubOf({
        teams: {sprockets: team('Sprockets', '19:30', 'ssss01'), cogs: team('Cogs', null, 'cccc01')},
        sheets: {
            ssss01: sheet({team: 'sprockets', label: 'Sprockets A', date: DATE, riders: ['1001'], bench: ['1008'], uploadedAt: '2026-11-19T16:00:00.000Z'}),
            cccc01: sheet({team: 'cogs', label: 'Cogs B', date: DATE, riders: ['1008'], uploadedAt: '2026-11-19T15:00:00.000Z'}),
        },
    });
    const now = T('2026-11-19T17:12:00Z');
    assert.deepEqual(teamView(c, 'cogs', {now, seen: {}}).trap, []);
    // a rider listing and a roster listing from the same team: only the rider who leaves a hole
    c.sheets.cccc01 = sheet({team: 'cogs', label: 'Cogs B', date: DATE, riders: ['1008', '1001'], uploadedAt: '2026-11-19T17:00:00.000Z'});
    assert.deepEqual(teamView(c, 'cogs', {now, seen: {}}).trap, [{
        team: 'sprockets', teamName: 'Sprockets', names: ['Ben'],
        text: 'Ben rides Sprockets for now; once you set a start time, Ben moves here and Sprockets has a hole.',
    }]);
    // two from the roster: no trap entry at all
    c.sheets.ssss01 = sheet({team: 'sprockets', label: 'Sprockets A', date: DATE, riders: ['1002'], bench: ['1008', '1001'], uploadedAt: '2026-11-19T16:00:00.000Z'});
    assert.deepEqual(teamView(c, 'cogs', {now, seen: {}}).trap, []);
    // the trap never takes this team's own roster into account
    c.sheets.cccc01 = sheet({team: 'cogs', label: 'Cogs B', date: DATE, riders: ['1003'], bench: ['1008', '1001'], uploadedAt: '2026-11-19T17:00:00.000Z'});
    assert.deepEqual(teamView(c, 'cogs', {now, seen: {}}).trap, []);
});


test('teamView: a roster rider who starts for another team gives this team no row and no warning', () => {
    // Hanna (1007) is only in Rollers' roster and starts for Sprockets; her check resolved to
    // Sprockets' plan, in Sprockets' event
    const c = base();
    c.sheets.ssss01 = sheet({team: 'sprockets', label: 'Sprockets A', date: DATE, riders: ['1007', '1009'], uploadedAt: '2026-11-19T14:30:00.000Z'});
    setLive(c, 'sprockets', 'ssss01');
    race(c, 'sprockets', DATE).pinnedEventId = 4567899;
    race(c, 'rollers', DATE).pinnedEventId = 4567890;
    const live = c.sheets.rrrr01.sig;
    const all = Object.fromEntries(ROLLERS.map(id => [id, seen('2026-11-19T18:15:00Z', {sig: live, inEvent: true, event: 4567890})]));
    all['1007'] = seen('2026-11-19T18:20:00Z', {sig: c.sheets.ssss01.sig, sheet: 'ssss01', inEvent: true, event: 4567899});
    const view = teamView(c, 'rollers', {now: S - 5 * MIN, seen: all});
    assert.equal(view.open, true);
    assert.deepEqual(view.riders.map(r => r.name).sort(), ['Ben', 'Cleo', 'Dan', 'Eva', 'Finn', 'Gus']);
    assert.ok(view.riders.every(r => r.state.sev === 'ok'), JSON.stringify(view.riders.map(r => r.state)));
    assert.deepEqual(view.notes, []);
    assert.equal(view.sev, 'ok');
    assert.equal(view.status.text, '6 of 6 riders have the plan');
    assert.equal(Object.hasOwn(view, 'bench'), false);
});


test('pullTarget: W/kg first, then watts', () => {
    const s = sheet({team: 'rollers', label: 'Rollers A', date: DATE, riders: ['1001'], uploadedAt: '2026-11-19T14:00:00.000Z'});
    const rider = normalizePlan(s.json, s.text).plan.riders[0];
    s.json.riders['1001'].pull_wkg = 4.2;
    assert.equal(pullTarget(s, rider), '4.2 W/kg');
    s.json.riders['1001'].pull_wkg = '4.0';
    assert.equal(pullTarget(s, rider), '4.0 W/kg');
    s.json.riders['1001'].pull_wkg = 'x';
    s.json.riders['1001'].pull_power = 324.6;
    assert.equal(pullTarget(s, rider), '325 W');
    // only the text export's watts
    const {json, text} = stripSheet(planJson('Rollers A', ['1001']), [{name: 'Ben', pullWatts: 310, pullS: 60}]);
    const withText = {json, text};
    const textRider = normalizePlan(json, text).plan.riders[0];
    assert.equal(textRider.watts, 310);
    assert.equal(pullTarget(withText, textRider), '310 W');
    // nothing
    const bare = sheet({team: 'rollers', label: 'Rollers A', date: DATE, riders: ['1001'], uploadedAt: '2026-11-19T14:00:00.000Z'});
    assert.equal(pullTarget(bare, normalizePlan(bare.json, bare.text).plan.riders[0]), null);
});


test('untilLabel and atLabel', () => {
    assert.equal(untilLabel(S, S - 18 * MIN), 'in 18 min');
    assert.equal(untilLabel(S, S - 63 * MIN), 'in 1 h 3 min');
    assert.equal(untilLabel(S, S - 60 * MIN), 'in 1 h');
    assert.equal(untilLabel(S, S - 26 * 60 * MIN), 'in 1 day');
    assert.equal(untilLabel(S, S - 60 * 60 * MIN), 'in 3 days');
    assert.equal(untilLabel(S, S - 30 * 1000), 'in 1 min');
    assert.equal(untilLabel(S, S), 'started');
    assert.equal(untilLabel(S, S + MIN), 'started');
    assert.equal(untilLabel(S, S + 4 * 60 * MIN), 'started');
    assert.equal(untilLabel(S, S + 4 * 60 * MIN + 1), 'raced');
    const tz = 'Europe/Berlin';
    assert.equal(atLabel(T('2026-11-19T17:50:00Z'), S, tz), '18:50');
    assert.equal(atLabel(T('2026-11-12T16:40:00Z'), S, tz), 'Thu 12 Nov 17:40');
});


test('teamOrder: by start time, no start last, then name, never by status', () => {
    const c = clubOf({
        teams: {
            cranks: team('Cranks', null), sprockets: team('Sprockets', '19:40', 'ssss01'),
            rollers: team('Rollers', '19:30', 'rrrr01'), axles: team('Axles', '19:40', 'aaaa01'),
        },
        sheets: {
            ssss01: sheet({team: 'sprockets', label: 'Sprockets A', date: DATE, riders: ['1008'], uploadedAt: '2026-11-19T14:00:00.000Z'}),
            rrrr01: sheet({team: 'rollers', label: 'Rollers A', date: DATE, riders: ['1001'], uploadedAt: '2026-11-19T14:00:00.000Z'}),
            aaaa01: sheet({team: 'axles', label: 'Axles A', date: DATE, riders: ['1009'], uploadedAt: '2026-11-19T14:00:00.000Z'}),
        },
    });
    assert.deepEqual(teamOrder(c), ['rollers', 'axles', 'sprockets', 'cranks']);
    // Rollers red (no plan): still first
    setLive(c, 'rollers', null);
    assert.equal(teamView(c, 'rollers', {now: S, seen: {}}).sev, 'err');
    assert.deepEqual(teamOrder(c), ['rollers', 'axles', 'sprockets', 'cranks']);
});


test('nextRace: the day of the next team start not yet used up', () => {
    const c = base();
    // Sprockets race on Fridays (Rollers on the club's Thursday)
    c.teams.sprockets.weekday = 5;
    assert.equal(nextRace(c, S - 60 * MIN), 'Thu 19 Nov');
    assert.equal(nextRace(c, S + 4 * 60 * MIN), 'Thu 19 Nov');
    // Rollers raced: next week; Sprockets (no plan) tomorrow
    assert.equal(nextRace(c, S + 4 * 60 * MIN + 1), 'Fri 20 Nov');
    assert.equal(nextRace(clubOf({teams: {cogs: team('Cogs', null)}}), S), null);
});


// Kettenfett RC (race day Thursday): Rollers 19:30 weekly, Cogs 19:30 special, neither with a plan;
// `sheets` are Cogs plans by date.
function kinds(...dates) {
    const c = clubOf({
        teams: {rollers: {...team('Rollers', '19:30'), kind: 'weekly', weekday: null}, cogs: {...team('Cogs', '19:30'), kind: 'special', weekday: null}},
        sheets: Object.fromEntries(dates.map((date, i) => [`cccc0${i + 1}`, sheet({team: 'cogs', label: 'Cogs', date, riders: ['1008'], uploadedAt: '2026-11-15T10:00:00.000Z'})])),
    });
    return {...c, weekday: 4};
}


test('foldedTeams: special teams with nothing in 14 days fold, weekly never', () => {
    const now = T('2026-11-19T12:00Z');
    assert.deepEqual([...foldedTeams(kinds(), now)], ['cogs']);
    // a plan dated 29 Nov unfolds Cogs, one dated 10 Dec does not
    assert.deepEqual([...foldedTeams(kinds('2026-11-29'), now)], []);
    assert.deepEqual([...foldedTeams(kinds('2026-12-10'), now)], ['cogs']);
    // today + 14 days is the edge; a plan dated today counts, yesterday's does not
    assert.deepEqual([...foldedTeams(kinds('2026-12-03'), now)], []);
    assert.deepEqual([...foldedTeams(kinds('2026-12-04'), now)], ['cogs']);
    assert.deepEqual([...foldedTeams(kinds('2026-11-19'), now)], []);
    assert.deepEqual([...foldedTeams(kinds('2026-11-18'), now)], ['cogs']);
    // a live plan still to race: yesterday's 23:30 start at 00:30 Berlin
    const late = kinds('2026-11-18');
    late.teams.cogs.start = '23:30';
    setLive(late, 'cogs', 'cccc01');
    assert.deepEqual([...foldedTeams(late, T('2026-11-18T23:30Z'))], []);
    assert.deepEqual([...foldedTeams(late, T('2026-11-19T00:30:00.001Z'))], ['cogs']);
    // a weekly team with nothing never folds; Rollers without a kind is weekly
    const c = kinds();
    delete c.teams.rollers.kind;
    assert.deepEqual([...foldedTeams(c, T('2027-03-01T12:00Z'))], ['cogs']);
});


test('teamView: a special team without a race', () => {
    const c = kinds();
    const now = T('2026-11-19T12:00Z');
    const cogs = teamView(c, 'cogs', {now, seen: {}});
    assert.equal(cogs.S, null);
    assert.equal(cogs.gateAt, null);
    assert.deepEqual(cogs.when, {day: null, time: null, until: null, today: false});
    // no race planned is neutral, not the red "No plan: riders get nothing" (Task 8b review)
    assert.deepEqual(cogs.status, {sev: 'neutral', kind: 'no-race', icon: 'clock', text: 'No race planned'});
    assert.equal(cogs.sev, 'neutral');
    assert.deepEqual(teamRow(cogs), {
        slug: 'cogs', name: 'Cogs', sev: 'neutral', icon: 'clock', timeLine: '',
        main: 'No race planned', quiet: 'Upload a plan with its date and start time', short: 'No race',
    });
    // with a plan dated 6 Dec, its race
    const later = kinds('2026-12-06');
    const v = teamView(later, 'cogs', {now, seen: {}});
    assert.equal(v.S, T('2026-12-06T18:30:00Z'));
    assert.equal(v.when.day, 'Sun 6 Dec');
    // a weekly team always has one
    assert.equal(teamView(c, 'rollers', {now, seen: {}}).when.day, 'Thu 19 Nov');
});


// Rollers with 'Rollers A' (rrrr01, live, no type) and the clock of the 18:50 upload. An upload's
// label is the team's name plus " · type"; a version keeps its plan's type unless `type` is given.
const UP = T('2026-11-19T17:50:00Z');
let n = 0;
const newId = () => `xxxx${String(++n).padStart(2, '0')}`;
function upload(c, {type, riders = ROLLERS, as = 'new', live = true, at = UP, date = DATE}) {
    return uploadSheet(c, {
        slug: 'rollers', json: planJson(type ? `Rollers ${type}` : 'Rollers', riders), text: null, date,
        base: c.teams.rollers.version, via: 'file', type, as, live, pinnedEventId: null,
    }, {now: at, newId});
}


// Rollers without a plan yet, then its plan 'Rollers' as uploads build it (the clock of `at`).
function versionsClub() {
    return clubOf({teams: {rollers: team('Rollers', '19:30'), sprockets: team('Sprockets', '19:30')}});
}
const V1 = ['1001', '1003', '1004', '1005', '1006'];          // Ben, Dan, Eva, Finn, Gus
const V2 = ['1002', '1003', '1004', '1005', '1006'];          // Cleo in, Ben out


test('teamView: the live version', () => {
    const c = versionsClub();
    const r1 = upload(c, {riders: V1, at: T('2026-11-19T14:00:00Z')});
    const r2 = upload(c, {as: r1.planId, riders: V2, at: T('2026-11-19T15:00:00Z')});
    const view = teamView(c, 'rollers', {now: S - 35 * MIN, seen: {}});
    assert.equal(view.live.id, r2.id);
    assert.equal(view.live.n, 2);
    assert.equal(view.live.planId, r1.planId);
    assert.equal(view.live.versions, 2);
    assert.equal(view.live.at, '16:00');
    assert.equal(view.live.newer, null);
    // what it changed and Restore went with the old team page's live row (the panel's rider table has them)
    for (const gone of ['prevN', 'summary', 'lines', 'back']) {
        assert.equal(Object.hasOwn(view.live, gone), false, gone);
    }
    // a Restore copy made before Restore went reads as made at the Restore (17:40), not at v1's upload (15:00)
    const backed = structuredClone(c);
    const k = backTo(backed, 'rollers', {plan: r1.planId, n: 1, version: backed.teams.rollers.version}, {now: T('2026-11-19T16:40:00Z'), newId: () => 'bbbb01'});
    assert.equal(backed.sheets[k.id].uploadedAt, backed.sheets[r1.id].uploadedAt, 'uploadedAt stays the precedence time');
    const afterBack = teamView(backed, 'rollers', {now: S - 35 * MIN, seen: {}});
    assert.equal(afterBack.live.id, k.id);
    assert.equal(afterBack.live.at, '17:40');
});


test('teamView: a newer version that is not live', () => {
    const c = versionsClub();
    const r1 = upload(c, {riders: V1, at: T('2026-11-19T14:00:00Z')});
    const r2 = upload(c, {as: r1.planId, riders: V2, at: T('2026-11-19T15:00:00Z')});
    const r3 = upload(c, {as: r1.planId, riders: ['1002', '1003', '1004'], live: false, at: T('2026-11-19T16:00:00Z')});
    let view = teamView(c, 'rollers', {now: S - 35 * MIN, seen: {}});
    assert.equal(view.live.id, r2.id);
    assert.equal(view.live.n, 2);
    assert.equal(view.live.versions, 3);
    assert.deepEqual(view.live.newer, {id: r3.id, n: 3, at: '17:00', marks: []});
    assert.equal(view.plans.length, 1, 'the live plan\'s newer version is not another plan');
    assert.equal(view.plans[0].id, r2.id);
    // its outdated marks: v3 lists Cleo, who now rides Sprockets
    c.sheets.ssss01 = {...sheet({team: 'sprockets', label: 'Sprockets', date: DATE, riders: ['1002', '1009'], uploadedAt: '2026-11-19T16:30:00.000Z'}), plan: 'ssss01'};
    setLive(c, 'sprockets', 'ssss01');
    view = teamView(c, 'rollers', {now: S - 35 * MIN, seen: {}});
    assert.deepEqual(view.live.newer.marks, [{id: '1002', name: 'Cleo', rides: 'sprockets', ridesName: 'Sprockets'}]);
    // a newer version made by Back while another version is live: its own time, not its upload's
    const d = versionsClub();
    const d1 = upload(d, {riders: V1, at: T('2026-11-19T14:00:00Z')});
    upload(d, {as: d1.planId, riders: V2, at: T('2026-11-19T15:00:00Z')});
    upload(d, {as: d1.planId, riders: ['1002', '1003'], at: T('2026-11-19T15:30:00Z')});
    const live3 = liveId(d, 'rollers');
    const k = backTo(d, 'rollers', {plan: d1.planId, n: 2, version: d.teams.rollers.version}, {now: T('2026-11-19T16:50:00Z'), newId: () => 'bbbb03'});
    // the copy went live; Restore stamped liveAt on such a copy until it went (its frozen copy predates liveAt)
    d.sheets[k.id].liveAt = new Date(T('2026-11-19T16:50:00Z')).toISOString();
    setLive(d, 'rollers', live3);
    // the Back copy went live (liveAt): a version that was live gets no notice (team cockpit spec §5.6)
    assert.equal(teamView(d, 'rollers', {now: S - 35 * MIN, seen: {}}).live.newer, null);
    // as data from before liveAt it has none
    delete d.sheets[k.id].liveAt;
    const nw = teamView(d, 'rollers', {now: S - 35 * MIN, seen: {}}).live.newer;
    assert.deepEqual([nw.id, nw.n, nw.at], [k.id, 4, '17:50']);
    assert.equal(d.sheets[k.id].uploadedAt, '2026-11-19T15:00:00.000Z');
});


test('teamView: other plans are this race\'s, each by its newest version', () => {
    // ported from view.others (dropped in fix round 1) to view.plans
    const c = versionsClub();
    const live = upload(c, {riders: V1, at: T('2026-11-19T14:00:00Z')});
    const b1 = upload(c, {type: 'B', riders: ['1007'], live: false, at: T('2026-11-19T14:10:00Z')});
    const b2 = upload(c, {as: b1.planId, riders: ['1007', '1008'], live: false, at: T('2026-11-19T14:20:00Z')});
    // last week's plan, used up
    c.sheets.wwww01 = sheet({team: 'rollers', label: 'Rollers · old', type: 'old', date: '2026-11-12', riders: V1, uploadedAt: '2026-11-12T10:00:00.000Z', plan: 'wwww01'});
    const view = teamView(c, 'rollers', {now: S - 35 * MIN, seen: {}});
    assert.equal(view.live.id, live.id);
    const others = view.plans.filter(p => !p.live);
    assert.equal(others.length, 1, JSON.stringify(view.plans));
    assert.deepEqual(others[0], {
        planId: b1.planId, id: b2.id, label: 'Rollers · B', day: 'Thu 19 Nov', n: 2, at: '15:20', sig: c.sheets[b2.id].sig,
        riders: 2, names: ['Hanna', 'Ida'], marks: [], live: false,
    });
    assert.ok(!view.plans.some(p => p.planId === 'wwww01'), 'the 12 Nov plan is not listed');
    // Back to v1 of plan B, not live: its newest version (v3) reads as made at the Back
    const backed = structuredClone(c);
    const k = backTo(backed, 'rollers', {plan: b1.planId, n: 1, version: backed.teams.rollers.version}, {now: T('2026-11-19T16:45:00Z'), newId: () => 'bbbb02'});
    const other = teamView(backed, 'rollers', {now: S - 35 * MIN, seen: {}}).plans.find(p => !p.live);
    assert.deepEqual([other.id, other.n, other.at], [k.id, 3, '17:45']);
    assert.equal(backed.sheets[k.id].uploadedAt, backed.sheets[b1.id].uploadedAt);
    // a plan for next week's race: listed under that race, not this one (races spec §4)
    const next = upload(c, {type: 'next', riders: ['1009'], live: false, at: T('2026-11-19T14:30:00Z'), date: '2026-11-26'});
    const two = teamView(c, 'rollers', {now: S - 35 * MIN, seen: {}});
    assert.deepEqual(two.plans.map(p => [p.id, p.day, p.live]), [[live.id, 'Thu 19 Nov', true], [b2.id, 'Thu 19 Nov', false]]);
    assert.deepEqual(two.races.map(r => [r.date, r.plans.map(p => [p.id, p.day, p.live])]),
        [['2026-11-19', [[live.id, 'Thu 19 Nov', true], [b2.id, 'Thu 19 Nov', false]]], ['2026-11-26', [[next.id, 'Thu 26 Nov', false]]]]);
    assert.ok(!('others' in two), 'no others any more');
});


test('teamView: has v1, not the live v2', () => {
    const c = versionsClub();
    const r1 = upload(c, {riders: V1, at: T('2026-11-19T14:00:00Z')});
    const r2 = upload(c, {as: r1.planId, riders: V2, at: T('2026-11-19T15:00:00Z')});
    const old = c.sheets[r1.id].sig;
    assert.notEqual(old, c.sheets[r2.id].sig);
    const at = '2026-11-19T18:22:00Z';
    const checks = {1002: seen(at, {sig: old, sheet: r2.id}), 1003: seen(at, {sig: 'ABC123', sheet: r2.id})};
    const stateOf = (view, name) => view.riders.find(r => r.name === name).state;
    let view = teamView(c, 'rollers', {now: S - 5 * MIN, seen: checks});
    assert.deepEqual(stateOf(view, 'Cleo'), {kind: 'old-code', sev: 'warn', text: 'Has v1, not the live v2', time: '19:22'});
    assert.deepEqual(stateOf(view, 'Dan'), {kind: 'old-code', sev: 'warn', text: 'Has an older plan (code ABC123)', time: '19:22'});
    // another plan's code is no version of the live plan: it names that plan and its n (team cockpit
    // spec §5.6)
    const b = upload(c, {type: 'B', riders: ['1009'], live: false, at: T('2026-11-19T15:10:00Z')});
    const bSig = c.sheets[b.id].sig;
    view = teamView(c, 'rollers', {now: S - 5 * MIN, seen: {1002: seen(at, {sig: bSig, sheet: r2.id})}});
    assert.deepEqual(stateOf(view, 'Cleo'), {kind: 'old-code', sev: 'warn', text: 'Has \'Rollers · B\' v1, not the live one', time: '19:22'});
    // the highest version with that code: v3 stores v1's content again, not live
    upload(c, {as: r1.planId, riders: V1, live: false, at: T('2026-11-19T16:00:00Z')});
    view = teamView(c, 'rollers', {now: S - 5 * MIN, seen: checks});
    assert.equal(stateOf(view, 'Cleo').text, 'Has v3, not the live v2');
});


test('refreshDue: 90 min before to 60 min after any servable S', () => {
    const c = base();
    // Rollers' S is 18:30Z
    for (const [at, on] of [['16:59', false], ['17:00', true], ['19:30', true], ['19:31', false]]) {
        assert.equal(refreshDue(c, T(`2026-11-19T${at}:00Z`)), on, at);
    }
    setLive(c, 'rollers', null);
    assert.equal(refreshDue(c, S), false);
});


test('teamView: plans in a fixed order; only the live flag moves', () => {
    const c = versionsClub();
    const fast = upload(c, {type: 'fast', riders: V1, at: T('2026-11-19T14:00:00Z')});
    const slow = upload(c, {type: 'slow', riders: ['1002', '1003', '1004', '1005'], live: false, at: T('2026-11-19T14:10:00Z')});
    const slow2 = upload(c, {as: slow.planId, riders: ['1002', '1003', '1004', '1005', '1006'], live: false, at: T('2026-11-19T14:20:00Z')});
    let view = teamView(c, 'rollers', {now: S - 35 * MIN, seen: {}});
    assert.deepEqual(view.plans.map(p => p.label), ['Rollers · fast', 'Rollers · slow']);
    assert.deepEqual(view.plans.map(p => p.live), [true, false]);
    assert.deepEqual(view.plans[1], {
        planId: slow.planId, id: slow2.id, label: 'Rollers · slow', day: 'Thu 19 Nov', n: 2, at: '15:20', sig: c.sheets[slow2.id].sig,
        riders: 5, names: ['Cleo', 'Dan', 'Eva'], marks: [], live: false,
    });
    assert.deepEqual(view.plans[0].names, ['Ben', 'Dan', 'Eva']);
    assert.equal(view.plans[0].id, fast.id);
    // after a switch the rows stay; only the live flag moves
    makeLive(c, 'rollers', slow2.id, T('2026-11-19T14:30:00Z'));
    view = teamView(c, 'rollers', {now: S - 35 * MIN, seen: {}});
    assert.deepEqual(view.plans.map(p => p.label), ['Rollers · fast', 'Rollers · slow']);
    assert.deepEqual(view.plans.map(p => p.live), [false, true]);
    // the same first time: by plan id
    const d = versionsClub();
    const a = upload(d, {type: 'a', riders: V1, at: T('2026-11-19T14:00:00Z')});
    const b = upload(d, {type: 'b', riders: V2, live: false, at: T('2026-11-19T14:00:00Z')});
    const ids = [a.planId, b.planId].sort();
    assert.deepEqual(teamView(d, 'rollers', {now: S - 35 * MIN, seen: {}}).plans.map(p => p.planId), ids);
});


test('teamView: the live row\'s n is the live version\'s', () => {
    const c = versionsClub();
    const v1 = upload(c, {type: 'fast', riders: V1, at: T('2026-11-19T14:00:00Z')});
    for (let i = 2; i <= 5; i++) {
        upload(c, {as: v1.planId, riders: i % 2 ? V1 : V2, at: T(`2026-11-19T14:0${i}:00Z`)});
    }
    const v6 = upload(c, {as: v1.planId, riders: ['1002', '1003'], live: false, at: T('2026-11-19T14:10:00Z')});
    const view = teamView(c, 'rollers', {now: S - 35 * MIN, seen: {}});
    assert.equal(view.plans.length, 1);
    assert.equal(view.plans[0].live, true);
    assert.equal(view.plans[0].n, 5);
    assert.equal(view.plans[0].id, liveId(c, 'rollers'));
    assert.equal(view.live.n, 5);
    assert.equal(view.live.newer.n, 6);
    assert.equal(view.live.newer.id, v6.id);
});


test('teamView: a damaged version does not break the view', () => {
    const c = versionsClub();
    const r1 = upload(c, {riders: V1, at: T('2026-11-19T14:00:00Z')});
    upload(c, {as: r1.planId, riders: V2, at: T('2026-11-19T15:00:00Z')});
    c.sheets[r1.id].json = {riders: 'x'};
    let view;
    assert.doesNotThrow(() => {
        view = teamView(c, 'rollers', {now: S - 35 * MIN, seen: {}});
    });
    assert.equal(view.live.n, 2);
});


test('liveWords: what Make live does, in words', () => {
    const c = versionsClub();
    const fast = upload(c, {type: 'fast', riders: V1, at: T('2026-11-19T14:00:00Z')});
    const slow = upload(c, {type: 'slow', riders: V2, live: false, at: T('2026-11-19T14:10:00Z')});
    const now = S - 35 * MIN;
    // before the gate: when riders get it, never "at once" (UI panel, 19 Nov 2026)
    assert.equal(liveWords(c, 'rollers', slow.id, now), 'From 19:00, riders get \'Rollers · slow\' v1 instead of \'Rollers · fast\' v1.');
    // after the gate: riders in the event get it within a minute
    assert.equal(liveWords(c, 'rollers', slow.id, S - 30 * MIN), 'Riders in the event get \'Rollers · slow\' v1 instead of \'Rollers · fast\' v1 within a minute.');
    assert.equal(liveWords(c, 'rollers', slow.id, S - 30 * MIN - 1), 'From 19:00, riders get \'Rollers · slow\' v1 instead of \'Rollers · fast\' v1.');
    // the outdated marks follow: Cleo now rides Sprockets
    c.sheets.ssss01 = {...sheet({team: 'sprockets', label: 'Sprockets', date: DATE, riders: ['1002', '1009'], uploadedAt: '2026-11-19T16:30:00.000Z'}), plan: 'ssss01'};
    setLive(c, 'sprockets', 'ssss01');
    assert.equal(liveWords(c, 'rollers', slow.id, now), 'From 19:00, riders get \'Rollers · slow\' v1 instead of \'Rollers · fast\' v1. '
        + '\'Rollers · slow\' v1 still lists Cleo, who now rides another team. Make it live anyway?');
    // without a live plan
    const d = versionsClub();
    const only = upload(d, {type: 'fast', riders: V1, live: false, at: T('2026-11-19T14:00:00Z')});
    assert.equal(liveWords(d, 'rollers', only.id, now), 'From 19:00, riders get \'Rollers · fast\' v1.');
    assert.equal(liveWords(d, 'rollers', only.id, S - 5 * MIN), 'Riders in the event get \'Rollers · fast\' v1 within a minute.');
    // a team without a start time sends nothing: no "at once" (fix round 1); its race stored before
    // times were pinned (user, 23 Nov 2026: a Store now pins the team's)
    d.teams.rollers.start = null;
    d.teams.rollers.races[DATE].start = null;
    assert.equal(liveWords(d, 'rollers', only.id, now), 'Riders get nothing until Rollers has a start time.');
    c.teams.rollers.start = null;
    c.teams.rollers.races[DATE].start = null;
    assert.equal(liveWords(c, 'rollers', slow.id, now), 'Riders get nothing until Rollers has a start time. '
        + '\'Rollers · slow\' v1 still lists Cleo, who now rides another team. Make it live anyway?');
    assert.equal(fast.id, liveId(c, 'rollers'));
});


test('liveQuestion: Make live in one race says and asks nothing about another race', () => {
    // live is per race (races spec §1): making next week's plan live leaves tonight's live plan
    const c = versionsClub();
    const fast = upload(c, {type: 'fast', riders: V1, at: T('2026-11-19T14:00:00Z')});
    const next = upload(c, {type: 'next', riders: V2, live: false, date: '2026-11-26', at: T('2026-11-19T14:10:00Z')});
    const words = 'From Thu 26 Nov 19:00, riders get \'Rollers · next\' v1.';
    // before tonight's gate, after it and during the race: the 26 Nov race has no live plan
    for (const now of [S - 35 * MIN, S + 60 * MIN]) {
        assert.deepEqual(liveQuestion(c, 'rollers', next.id, now), {words, ask: false, marks: [], warnings: []});
    }
    // tonight's plan is not touched by it
    assert.equal(liveId(c, 'rollers', DATE), fast.id);
    // the other way round: next week's plan live, tonight's plan made live names only tonight's race
    const d = versionsClub();
    const tonight = upload(d, {type: 'fast', riders: V1, live: false, at: T('2026-11-19T14:00:00Z')});
    upload(d, {type: 'next', riders: V2, live: true, date: '2026-11-26', at: T('2026-11-19T14:10:00Z')});
    assert.deepEqual(liveQuestion(d, 'rollers', tonight.id, S - 35 * MIN), {words: 'From 19:00, riders get \'Rollers · fast\' v1.', ask: false, marks: [], warnings: []});
    // within the race: the plan it replaces, that race's live plan
    const slow = upload(d, {type: 'slow', riders: V2, live: false, at: T('2026-11-19T14:20:00Z')});
    makeLive(d, 'rollers', tonight.id, S - 40 * MIN);
    assert.deepEqual(liveQuestion(d, 'rollers', slow.id, S - 35 * MIN),
        {words: 'From 19:00, riders get \'Rollers · slow\' v1 instead of \'Rollers · fast\' v1.', ask: false, marks: [], warnings: []});
    // with outdated marks the marks' question is the one question
    c.sheets.ssss01 = {...sheet({team: 'sprockets', label: 'Sprockets', date: '2026-11-26', riders: ['1002', '1009'], uploadedAt: '2026-11-19T16:30:00.000Z'}), plan: 'ssss01'};
    setLive(c, 'sprockets', 'ssss01');
    const q = liveQuestion(c, 'rollers', next.id, S - 35 * MIN);
    assert.equal(q.words, `${words} 'Rollers · next' v1 still lists Cleo, who now rides another team. Make it live anyway?`);
    assert.equal(q.ask, true);
});


test('Make vN live of a later race reads that race\'s live plan', () => {
    // Task 4 review: the later race's questions named the team's nearest live plan
    const c = versionsClub();
    const fast = upload(c, {type: 'fast', riders: V1, at: T('2026-11-19T14:00:00Z')});
    const n1 = upload(c, {type: 'next', riders: V1, date: '2026-11-26', at: T('2026-11-19T14:10:00Z')});
    const n2 = upload(c, {as: n1.planId, riders: V2, live: false, date: '2026-11-26', at: T('2026-11-19T14:20:00Z')});
    // both races live: tonight's 'fast', the 26 Nov race's v1
    setLive(c, 'rollers', fast.id);
    assert.deepEqual([liveId(c, 'rollers', DATE), liveId(c, 'rollers', '2026-11-26')], [fast.id, n1.id]);
    // Make v2 live in the 26 Nov race: instead of that race's v1, never tonight's plan
    assert.deepEqual(liveQuestion(c, 'rollers', n2.id, S - 35 * MIN),
        {words: 'From Thu 26 Nov 19:00, riders get \'Rollers · next\' v2 instead of \'Rollers · next\' v1.', ask: false, marks: [], warnings: []});
    makeLive(c, 'rollers', n2.id, S - 35 * MIN);
    assert.deepEqual([liveId(c, 'rollers', DATE), liveId(c, 'rollers', '2026-11-26')], [fast.id, n2.id]);
    // back to v1 (Make live of the version live before, no Undo): against v2, never tonight's plan
    assert.deepEqual(liveQuestion(c, 'rollers', n1.id, S - 34 * MIN),
        {words: 'From Thu 26 Nov 19:00, riders get \'Rollers · next\' v1 instead of \'Rollers · next\' v2.', ask: false, marks: [], warnings: []});
});


test('nextRace: a race that is over counts until S + 4 h only with a live plan', () => {
    // Task 4 review: plans but none live at S + 3 h is no next race
    const c = versionsClub();
    const r = upload(c, {type: 'fast', riders: V1, at: T('2026-11-19T14:00:00Z')});
    assert.equal(nextRaceAt(c, S + 3 * 60 * MIN), S);
    setLive(c, 'rollers', null);
    // the next race is then the teams' next one by the rhythm (both race on Thursdays)
    assert.equal(nextRaceAt(c, S + 3 * 60 * MIN), S + 7 * 24 * 60 * MIN);
    assert.equal(nextRace(c, S + 3 * 60 * MIN), 'Thu 26 Nov');
    makeLive(c, 'rollers', r.id, S + 60 * MIN);
    assert.equal(nextRace(c, S + 3 * 60 * MIN), 'Thu 19 Nov');
});


test('teamView: a weekly team without a start time whose race has its own does not read "No start time"', () => {
    // Task 4 review: the race's own S counts, not only the team's
    const c = versionsClub();
    c.teams.rollers.start = null;
    upload(c, {type: 'fast', riders: V1, at: T('2026-11-19T14:00:00Z')});
    race(c, 'rollers', DATE).start = '18:00';
    const view = teamView(c, 'rollers', {now: T('2026-11-19T12:00:00Z'), seen: {}});
    assert.equal(view.noStart, false);
    assert.equal(view.S, T('2026-11-19T17:00:00Z'));
    assert.notEqual(view.status.kind, 'no-start');
    assert.notEqual(teamRow(view).timeLine, 'No start time');
    // without it, the race has no time: "No start time"
    race(c, 'rollers', DATE).start = null;
    assert.equal(teamView(c, 'rollers', {now: T('2026-11-19T12:00:00Z'), seen: {}}).noStart, true);
});


// ---- a special team's start time belongs to its race, team and date (user, 19 Nov 2026) ----

test('teamView: a special team races at its race\'s start; "No start time" only for a race without any', () => {
    const now = T('2026-11-19T12:00Z');
    // Cogs has no start time of its own; its live plan of 21 Nov races at 20:15 (19:15Z)
    const c = kinds('2026-11-21');
    c.teams.cogs.start = null;
    setLive(c, 'cogs', 'cccc01');
    race(c, 'cogs', '2026-11-21').start = '20:15';
    const cogs = teamView(c, 'cogs', {now, seen: {}});
    assert.equal(cogs.S, T('2026-11-21T19:15:00Z'));
    assert.equal(cogs.noStart, false);
    assert.deepEqual(cogs.when, {day: 'Sat 21 Nov', time: '20:15', until: 'in 2 days', today: false});
    assert.deepEqual(cogs.status, {sev: 'neutral', kind: 'opens', icon: 'clock', text: 'Opens Sat 21 Nov 19:45 · 1 rider on this plan'});
    assert.deepEqual(cogs.trap, []);
    assert.equal(teamRow(cogs).timeLine, 'Sat 21 Nov 20:15 · in 2 days');
    assert.equal(liveWords(c, 'cogs', 'cccc01', now), 'From Sat 21 Nov 19:45, riders get \'Cogs\' v1.');
    // its gate: 30 min before the race's start
    assert.equal(teamView(c, 'cogs', {now: T('2026-11-21T18:45:00Z'), seen: {}}).open, true);
    assert.equal(teamView(c, 'cogs', {now: T('2026-11-21T18:44:59Z'), seen: {}}).open, false);
    // stored, not live, with its time: "No live plan" as for a weekly team, with its day and time;
    // red at once, also 2 days off (spec §8)
    setLive(c, 'cogs', null);
    const stored = teamView(c, 'cogs', {now, seen: {}});
    assert.deepEqual(stored.status, {sev: 'err', kind: 'none-live', icon: 'noPlan', text: 'No live plan: riders get nothing'});
    assert.equal(teamRow(stored).timeLine, 'Sat 21 Nov 20:15 · in 2 days');
    const near = teamView(c, 'cogs', {now: T('2026-11-19T19:15:00Z'), seen: {}});
    assert.deepEqual(near.status, {sev: 'err', kind: 'none-live', icon: 'noPlan', text: 'No live plan: riders get nothing'});

    // nothing stored: the neutral no-race status and no time line, even with a stale team start
    for (const start of [null, '19:30']) {
        const none = kinds();
        none.teams.cogs.start = start;
        const empty = teamView(none, 'cogs', {now, seen: {}});
        assert.equal(empty.noStart, false);
        assert.deepEqual(empty.status, {sev: 'neutral', kind: 'no-race', icon: 'clock', text: 'No race planned'});
        assert.deepEqual([teamRow(empty).timeLine, teamRow(empty).main], ['', 'No race planned'], String(start));
    }

    // a live plan stored by 0.3.0, neither the race nor the team with a time: red "no start time"
    const old = kinds('2026-11-21');
    old.teams.cogs.start = null;
    setLive(old, 'cogs', 'cccc01');
    const red = teamView(old, 'cogs', {now, seen: {}});
    assert.equal(red.noStart, true);
    assert.deepEqual(red.status, {sev: 'err', kind: 'no-start', icon: 'clock', text: 'No start time: riders on this plan get nothing'});
    assert.deepEqual(teamRow(red), {
        slug: 'cogs', name: 'Cogs', sev: 'err', icon: 'clock', timeLine: 'No start time',
        main: 'No start time: riders on this plan get nothing', quiet: '\'Cogs\' has no start time · upload a new version with it', short: 'No start time',
    });
    assert.equal(liveWords(old, 'cogs', 'cccc01', now), 'Riders get nothing: \'Cogs\' has no start time. Set the race\'s start time in its ⋯.');
    // the same plan stored but not live: still red, never "null" in a line (review I3)
    setLive(old, 'cogs', null);
    const notLive = teamView(old, 'cogs', {now, seen: {}});
    assert.equal(notLive.noStart, true);
    assert.deepEqual(notLive.status, {sev: 'err', kind: 'no-start', icon: 'clock', text: 'No start time for Sat 21 Nov'});
    const row = teamRow(notLive);
    assert.deepEqual([row.timeLine, row.quiet], ['No start time', 'Set the race\'s start time in its ⋯']);
    assert.ok(!JSON.stringify(row).includes('null'), JSON.stringify(row));
    // with the team's start time (0.3.0's way) it races at that, as before
    old.teams.cogs.start = '19:30';
    setLive(old, 'cogs', 'cccc01');
    assert.equal(teamView(old, 'cogs', {now, seen: {}}).S, T('2026-11-21T18:30:00Z'));

    // a weekly team without a start time and without a plan: neutral "No start time set" (spec §8)
    const weekly = kinds();
    weekly.teams.rollers.start = null;
    assert.deepEqual(teamView(weekly, 'rollers', {now, seen: {}}).status, {sev: 'neutral', kind: 'start-unset', icon: 'clock', text: 'No start time set'});
});


test('teamView: a special team\'s trap names the race\'s start time, not a team start time', () => {
    // Cogs (special, no time anywhere) has a live plan listing Ida, who rides Rollers now
    const c = kinds('2026-11-19');
    c.teams.cogs.start = null;
    setLive(c, 'cogs', 'cccc01');
    c.sheets.rrrr01 = sheet({team: 'rollers', label: 'Rollers A', date: DATE, riders: ['1008', '1001'], uploadedAt: '2026-11-19T10:00:00.000Z'});
    setLive(c, 'rollers', 'rrrr01');
    c.sheets.cccc01.uploadedAt = '2026-11-19T11:00:00.000Z';
    const now = T('2026-11-19T12:00Z');
    assert.deepEqual(teamView(c, 'cogs', {now, seen: {}}).trap.map(x => x.text),
        ['Ida rides Rollers for now; once this race has its start time (it comes with the plan), Ida moves here and Rollers has a hole.']);
    // with the race's start it is sent, and no trap
    race(c, 'cogs', DATE).start = '21:00';
    assert.deepEqual(teamView(c, 'cogs', {now, seen: {}}).trap, []);
});


test('teamOrder: a special team by its next race\'s start, after the weekly teams without one', () => {
    const now = T('2026-11-19T12:00Z');
    const c = kinds('2026-11-21');
    c.teams.axles = {...team('Axles', '20:00'), kind: 'weekly', weekday: null};
    c.teams.owls = {...team('Owls', null), kind: 'weekly', weekday: null};
    c.teams.bolts = {...team('Bolts', '18:00'), kind: 'special', weekday: null};
    // Cogs' race of 21 Nov at 19:45; Bolts has no race (its stale 18:00 does not count)
    c.teams.cogs.start = null;
    race(c, 'cogs', '2026-11-21').start = '19:45';
    assert.deepEqual(teamOrder(c, now), ['rollers', 'cogs', 'axles', 'owls', 'bolts']);
    // without a time Cogs goes after the weekly teams; the special teams without one by name
    race(c, 'cogs', '2026-11-21').start = null;
    assert.deepEqual(teamOrder(c, now), ['rollers', 'axles', 'owls', 'bolts', 'cogs']);
});


// ---- the Make live rule and the race window (UI panel wave 2) ----

test('liveQuestion: asks only while the gate is open or the words warn', () => {
    const c = versionsClub();
    const fast = upload(c, {type: 'fast', riders: V1, at: T('2026-11-19T14:00:00Z')});
    const slow = upload(c, {type: 'slow', riders: V2, live: false, at: T('2026-11-19T14:10:00Z')});
    // before the gate, nothing to warn about: it acts at once, with the words as before
    const pre = liveQuestion(c, 'rollers', slow.id, S - 35 * MIN);
    assert.deepEqual(pre, {words: 'From 19:00, riders get \'Rollers · slow\' v1 instead of \'Rollers · fast\' v1.', ask: false, marks: [], warnings: []});
    assert.equal(liveWords(c, 'rollers', slow.id, S - 35 * MIN), pre.words);
    // the gate edge: from S - 30 min it asks, until the race is used up (S + 4 h)
    assert.equal(liveQuestion(c, 'rollers', slow.id, S - 30 * MIN - 1).ask, false);
    assert.equal(liveQuestion(c, 'rollers', slow.id, S - 30 * MIN).ask, true);
    assert.equal(liveQuestion(c, 'rollers', slow.id, S + 4 * 60 * MIN).ask, true);
    assert.equal(gateOpen(c, c.sheets[slow.id], S + 4 * 60 * MIN + 1), false);
    // the version that is live already never asks
    assert.equal(liveQuestion(c, 'rollers', fast.id, S - 10 * MIN).ask, false);
    // an outdated mark warns before the gate: Cleo now rides Sprockets
    c.sheets.ssss01 = {...sheet({team: 'sprockets', label: 'Sprockets', date: DATE, riders: ['1002', '1009'], uploadedAt: '2026-11-19T16:30:00.000Z'}), plan: 'ssss01'};
    setLive(c, 'sprockets', 'ssss01');
    const marked = liveQuestion(c, 'rollers', slow.id, S - 35 * MIN);
    assert.equal(marked.ask, true);
    assert.ok(marked.words.endsWith('Make it live anyway?'), marked.words);
    assert.deepEqual(marked.marks.map(m => m.name), ['Cleo']);
    assert.deepEqual(marked.warnings.at(-1), {sev: 'warn', text: '\'Rollers · slow\' v1 still lists Cleo, who now rides another team.'});
    // no start time warns too: riders get nothing
    const d = versionsClub();
    const only = upload(d, {type: 'fast', riders: V1, live: false, at: T('2026-11-19T14:00:00Z')});
    assert.equal(liveQuestion(d, 'rollers', only.id, S - 35 * MIN).ask, false, 'the first plan of a team, before the gate');
    d.teams.rollers.start = null;
    d.teams.rollers.races[DATE].start = null;        // a race stored before times were pinned
    assert.deepEqual(liveQuestion(d, 'rollers', only.id, S - 35 * MIN), {words: 'Riders get nothing until Rollers has a start time.', ask: true, marks: [], warnings: [{sev: 'err', text: 'Riders get nothing until Rollers has a start time.'}]});
});


test('liveQuestion: a plan that takes a rider from another team names the move and asks', () => {
    const c = versionsClub();
    upload(c, {type: 'fast', riders: V1, at: T('2026-11-19T14:00:00Z')});
    // Sprockets' live plan lists Cleo, uploaded before 'Rollers · slow': once that is live, Cleo rides Rollers
    c.sheets.ssss01 = {...sheet({team: 'sprockets', label: 'Sprockets', date: DATE, riders: ['1002', '1009'], uploadedAt: '2026-11-19T14:05:00.000Z'}), plan: 'ssss01'};
    setLive(c, 'sprockets', 'ssss01');
    const slow = upload(c, {type: 'slow', riders: V2, live: false, at: T('2026-11-19T14:10:00Z')});
    const q = liveQuestion(c, 'rollers', slow.id, S - 35 * MIN);
    assert.equal(q.ask, true);
    assert.equal(q.words, 'From 19:00, riders get \'Rollers · slow\' v1 instead of \'Rollers · fast\' v1. Cleo moves from Sprockets to Rollers. '
        + 'Still to do: Sprockets. Make it live anyway?');
    // the version card shows only what warns, as lines (user, 23 Nov 2026: no "What happens"); the
    // first sentence is the strip's question alone
    assert.deepEqual(q.warnings, [{sev: 'info', text: 'Cleo moves from Sprockets to Rollers.'}, {sev: 'warn', text: 'Still to do: Sprockets.'}]);
});


test('liveQuestion: the gate of the plan\'s own race asks; another race\'s open gate does not', () => {
    // tonight's plan is live and its gate open; next week's plan made live ends nothing tonight
    // (live is per race, races spec §1)
    const c = versionsClub();
    upload(c, {type: 'fast', riders: V1, at: T('2026-11-19T14:00:00Z')});
    const next = upload(c, {type: 'next', riders: V1, live: false, at: T('2026-11-19T14:10:00Z'), date: '2026-11-26'});
    assert.equal(liveQuestion(c, 'rollers', next.id, S - 10 * MIN).ask, false);
    // a plan of tonight's race made live while next week's plan is live: tonight's gate is open
    const d = versionsClub();
    const tonight = upload(d, {type: 'fast', riders: V1, live: false, at: T('2026-11-19T14:00:00Z')});
    upload(d, {type: 'next', riders: V1, at: T('2026-11-19T14:10:00Z'), date: '2026-11-26'});
    assert.equal(liveQuestion(d, 'rollers', tonight.id, S - 10 * MIN).ask, true);
});


test('raceWithin: a plan of the team (or any team) starting within 7 days, not used up', () => {
    const c = versionsClub();
    assert.equal(raceWithin(c, 'rollers', S - 60 * MIN), false, 'no plan');
    upload(c, {type: 'next', riders: V1, at: T('2026-11-19T14:00:00Z'), date: '2026-11-27'});
    assert.equal(raceWithin(c, 'rollers', S - 60 * MIN), false, 'more than 7 days ahead');
    // the 27th at 19:30 (18:30Z): from 7 days before its start (review M5: not today..today+7)
    assert.equal(raceWithin(c, 'rollers', T('2026-11-20T18:30:00Z')), true, '7 days ahead');
    assert.equal(raceWithin(c, 'rollers', T('2026-11-20T18:29:59Z')), false, 'a second more');
    upload(c, {type: 'fast', riders: V1, at: T('2026-11-19T14:10:00Z')});
    assert.equal(raceWithin(c, 'rollers', S - 60 * MIN), true, 'tonight');
    assert.equal(raceWithin(c, 'sprockets', S - 60 * MIN), false, 'another team\'s');
    assert.equal(raceWithin(c, null, S - 60 * MIN), true, 'any team');
    // still the 19th in Berlin: tonight's race is used up, next week's more than 7 days ahead
    assert.equal(raceWithin(c, 'rollers', S + 4 * 60 * MIN + 1), false, 'used up');
    // a 23:00 race still on at 00:30 the next day (review M5): its date is yesterday, it is not used up
    const late = versionsClub();
    late.teams.rollers.start = '23:00';
    upload(late, {type: 'late', riders: V1, at: T('2026-11-19T14:00:00Z')});
    assert.equal(raceWithin(late, 'rollers', T('2026-11-19T23:30:00Z')), true, 'after midnight');
    assert.equal(raceWithin(late, 'rollers', T('2026-11-20T02:00:01Z')), false, 'used up at 03:00');
});


// ---- wave 1 review fixes (UI panel, 19 Nov 2026) ----

test('teamView: a special team with two races stored and none live is about the nearer race (review I1)', () => {
    // 'near' Sat 21 Nov 20:15 and 'far' Sat 5 Dec 20:15, neither live: at Sat 21 Nov 19:00 riders get
    // nothing for tonight's race, which the view must say, in red, naming that race
    const c = kinds('2026-11-21', '2026-12-05');
    c.teams.cogs.start = null;
    race(c, 'cogs', '2026-11-21').start = '20:15';
    race(c, 'cogs', '2026-12-05').start = '20:15';
    c.sheets.cccc01.label = 'Cogs · near';
    c.sheets.cccc02.label = 'Cogs · far';
    const now = T('2026-11-21T18:00:00Z');
    const view = teamView(c, 'cogs', {now, seen: {}});
    assert.deepEqual(view.status, {sev: 'err', kind: 'none-live', icon: 'noPlan', text: 'No live plan: riders get nothing'});
    assert.equal(view.raceDate, '2026-11-21');
    assert.equal(view.S, T('2026-11-21T19:15:00Z'));
    assert.equal(view.when.day, 'Sat 21 Nov');
    // today's race: the time line leaves the day out, as for every team on race day
    assert.equal(teamRow(view).timeLine, '20:15 · in 1 h 15 min');
    assert.equal(teamRow(teamView(c, 'cogs', {now: T('2026-11-20T12:00:00Z'), seen: {}})).timeLine, 'Sat 21 Nov 20:15 · in 1 day');
    // once tonight's race is over, the far one: red as well, 13 days ahead (spec §8)
    const later = teamView(c, 'cogs', {now: T('2026-11-22T12:00:00Z'), seen: {}});
    assert.equal(later.raceDate, '2026-12-05');
    assert.equal(later.status.sev, 'err');
});


test('teamView: "plans stored" counts only the plans of the race in question (review M1)', () => {
    // Rollers (weekly, Thursdays 19:30) has only a plan for 26 Nov; on Wed 18 Nov the rhythm's 19th
    // has no plan, so it is no race (spec §8): the view is the 26th's, whose plan is not live: red
    const c = kinds();
    c.sheets.rrrr01 = {...sheet({team: 'rollers', label: 'Rollers', date: '2026-11-26', riders: ['1001'], uploadedAt: '2026-11-15T10:00:00.000Z'}), plan: 'rrrr01'};
    tidyRaces(c);
    const near = teamView(c, 'rollers', {now: T('2026-11-18T12:00:00Z'), seen: {}});
    assert.equal(near.raceDate, '2026-11-26');
    assert.deepEqual(near.status, {sev: 'err', kind: 'none-live', icon: 'noPlan', text: 'No live plan: riders get nothing'});
    // after an unplayed race (S + 2 h to S + 4 h): tonight's plans no longer count for next week's race
    c.sheets.rrrr02 = {...sheet({team: 'rollers', label: 'Rollers · tonight', date: '2026-11-19', riders: ['1001'], uploadedAt: '2026-11-15T10:00:00.000Z'}), plan: 'rrrr02'};
    delete c.sheets.rrrr01;
    tidyRaces(c);
    const after = teamView(c, 'rollers', {now: T('2026-11-19T21:00:00Z'), seen: {}});
    assert.equal(after.raceDate, '2026-11-26');
    assert.deepEqual(after.status, {sev: 'neutral', kind: 'next-race', icon: 'clock', text: 'Next regular race Thu 26 Nov 19:30'});
    // with a plan of the race itself: "No live plan", as before
    const own = teamView(c, 'rollers', {now: T('2026-11-19T12:00:00Z'), seen: {}});
    assert.equal(own.status.kind, 'none-live');
});


// ---- wave 2 review fixes ----

test('liveQuestion: an older version that reopens a hole of this team asks, also the version live before (review I2)', () => {
    // Rollers v1 lists Ben; Sprockets has taken him since; v2 without Ben is made live before the gate
    const c = versionsClub();
    const v1 = upload(c, {riders: ['1001', '1002', '1003'], at: T('2026-11-19T10:00:00Z')});
    c.sheets.ssss01 = {...sheet({team: 'sprockets', label: 'Sprockets', date: DATE, riders: ['1001', '2002', '2003'], uploadedAt: '2026-11-19T11:00:00.000Z'}), plan: 'ssss01'};
    setLive(c, 'sprockets', 'ssss01');
    const v2 = upload(c, {as: v1.planId, riders: ['1002', '1003', '1004'], live: false, at: T('2026-11-19T12:00:00Z')});
    const now = S - 150 * MIN;
    assert.equal(liveQuestion(c, 'rollers', v2.id, now).ask, false, 'v2 closes the hole: no question');
    makeLive(c, 'rollers', v2.id, now, {version: c.teams.rollers.version});
    // back to v1, the version live before (Make live, no Undo): v1 is not its plan's newest version,
    // so outdated() does not see it: the dry run does
    const q = liveQuestion(c, 'rollers', v1.id, now + MIN);
    assert.equal(q.ask, true);
    assert.ok(q.words.endsWith('\'Rollers\' v1 still lists Ben, who now rides another team. Make it live anyway?'), q.words);
    assert.deepEqual(q.marks.map(m => [m.id, m.rides]), [['1001', 'sprockets']]);
});


// ---- the views per race (races spec §4, §4b: "mix") ----

const FRI = T('2026-11-20T10:00:00Z');        // Friday 20 Nov, 11:00 in Berlin
const raceOf = (fields = {}) => ({start: null, pinnedEventId: null, eventId: null, boundAt: null, live: null, ...fields});

// Kettenfett RC: Rollers weekly on Thursday at 19:30 with the races of Thu 19 Nov (over: 'Rollers'
// and 'Rollers · slow'), Sun 22 Nov at 18:00 with the event link 5123456 (live 'Rollers · fast', and
// 'Rollers · slow' stored after it) and Thu 26 Nov (live 'Rollers').
function racesClub() {
    const v = (label, type, date, uploadedAt) => sheet({team: 'rollers', label, type, date, riders: ROLLERS, uploadedAt});
    return clubOf({
        teams: {
            rollers: {
                name: 'Rollers', start: '19:30', kind: 'weekly', weekday: 4, version: 1, changedAt: '2026-11-10T10:00:00.000Z',
                races: {
                    '2026-11-19': raceOf(),
                    '2026-11-22': raceOf({start: '18:00', pinnedEventId: 5123456, live: 'sun001'}),
                    '2026-11-26': raceOf({live: 'thu001'}),
                },
            },
        },
        sheets: {
            old001: v('Rollers', null, '2026-11-19', '2026-11-15T10:00:00.000Z'),
            old002: v('Rollers · slow', 'slow', '2026-11-19', '2026-11-15T11:00:00.000Z'),
            sun001: v('Rollers · fast', 'fast', '2026-11-22', '2026-11-18T10:00:00.000Z'),
            sun002: v('Rollers · slow', 'slow', '2026-11-22', '2026-11-18T11:00:00.000Z'),
            thu001: v('Rollers', null, '2026-11-26', '2026-11-19T10:00:00.000Z'),
        },
    });
}

// racesClub without the versions `ids` (and their races).
function without(...ids) {
    const c = racesClub();
    for (const id of ids) {
        delete c.sheets[id];
    }
    tidyRaces(c);
    return c;
}


test('raceDates: races ahead nearest first, the rhythm date only as the regular date without one, over races newest first', () => {
    const c = racesClub();
    assert.deepEqual(raceDates(c, 'rollers', FRI), {ahead: ['2026-11-22', '2026-11-26'], over: ['2026-11-19'], regular: null});
    // Sunday is nearer than the rhythm's Thursday, which has no race: not ahead
    const withoutThursday = without('thu001');
    assert.deepEqual(raceDates(withoutThursday, 'rollers', FRI).ahead, ['2026-11-22']);
    // only an over race: no race ahead, the rhythm date is the regular date (spec §8: no race)
    const onlyOver = without('sun001', 'sun002', 'thu001');
    assert.deepEqual(raceDates(onlyOver, 'rollers', FRI), {ahead: [], over: ['2026-11-19'], regular: '2026-11-26'});
    const specialNoRace = clubOf({teams: {specials: {name: 'Cogs', start: '19:30', kind: 'special', weekday: null, version: 1, races: {}}}});
    assert.deepEqual(raceDates(specialNoRace, 'specials', FRI), {ahead: [], over: [], regular: null});
    // over races newest first; the Sunday race is over from its S + 2 h (20:00 Berlin)
    assert.deepEqual(raceDates(c, 'rollers', T('2026-11-22T19:00:00Z')), {ahead: ['2026-11-22', '2026-11-26'], over: ['2026-11-19'], regular: null});
    assert.deepEqual(raceDates(c, 'rollers', T('2026-11-22T19:00:00.001Z')), {ahead: ['2026-11-26'], over: ['2026-11-22', '2026-11-19'], regular: null});
});


test('teamView: the nearest race\'s state, and every race ahead with its own live card, plans and riders', () => {
    const c = racesClub();
    const v = teamView(c, 'rollers', {now: FRI});
    assert.equal(v.raceDate, '2026-11-22');
    assert.equal(v.date, '2026-11-22');
    assert.deepEqual([v.when.day, v.when.time], ['Sun 22 Nov', '18:00']);
    assert.equal(v.S, T('2026-11-22T17:00:00Z'));
    assert.deepEqual(v.event, {id: 5123456, pinned: true});
    assert.deepEqual(v.races.map(r => [r.date, r.live?.id ?? null, r.plans.map(p => p.id)]),
        [['2026-11-22', 'sun001', ['sun001', 'sun002']], ['2026-11-26', 'thu001', ['thu001']]]);
    assert.equal(v.races[0].live, v.live);
    assert.deepEqual(v.over, [{date: '2026-11-19', day: 'Thu 19 Nov', plans: [{planId: 'old001', label: 'Rollers'}, {planId: 'old002', label: 'Rollers · slow'}]}]);
    assert.equal(teamRow(v).timeLine.startsWith('Sun 22 Nov 18:00'), true);
    // the later race: its own time, live card and riders, and no event of its own
    const thu = v.races[1];
    assert.deepEqual([thu.when.day, thu.when.time, thu.S, thu.event], ['Thu 26 Nov', '19:30', T('2026-11-26T18:30:00Z'), null]);
    assert.deepEqual([thu.live.label, thu.count, thu.status.kind], ['Rollers', 6, 'opens']);
    assert.ok(!('races' in thu) && !('over' in thu) && !('received' in thu), Object.keys(thu).join());
    assert.deepEqual(v.received, []);
    // a learned event: not pinned
    race(c, 'rollers', '2026-11-26').eventId = 4567001;
    assert.deepEqual(teamView(c, 'rollers', {now: FRI}).races[1].event, {id: 4567001, pinned: false});
    // the plans in the fixed order: a switch moves only the live flag
    race(c, 'rollers', '2026-11-22').live = 'sun002';
    assert.deepEqual(teamView(c, 'rollers', {now: FRI}).plans.map(p => [p.id, p.live]), [['sun001', false], ['sun002', true]]);
    // a special team without a race: raceView of nothing, no races
    const none = teamView(clubOf({teams: {specials: {name: 'Cogs', start: '19:30', kind: 'special', weekday: null, version: 1, races: {}}}}), 'specials', {now: FRI});
    assert.deepEqual([none.raceDate, none.date, none.status.kind, none.races, none.over, none.event], [null, null, 'no-race', [], [], null]);
});


test('raceView: every race with plans but none live is red at once, the nearest and a later one (spec §8)', () => {
    const c = racesClub();
    race(c, 'rollers', '2026-11-22').live = null;
    race(c, 'rollers', '2026-11-26').live = null;
    const sunday = T('2026-11-22T10:00:00Z');                     // 7 h before the Sunday race
    const sun = raceView(c, 'rollers', '2026-11-22', {now: sunday});
    const thu = raceView(c, 'rollers', '2026-11-26', {now: sunday});
    assert.deepEqual([sun.date, sun.status.kind, sun.status.sev, sun.status.text], ['2026-11-22', 'none-live', 'err', 'No live plan: riders get nothing']);
    assert.deepEqual([thu.date, thu.status.kind, thu.status.sev, thu.status.text], ['2026-11-26', 'none-live', 'err', 'No live plan: riders get nothing']);
    assert.deepEqual([sun.live, thu.live, sun.plans.map(p => p.id), thu.plans.map(p => p.id)], [null, null, ['sun001', 'sun002'], ['thu001']]);
    // the later race is red 4 days before its own start (Thu 26 Nov 18:30Z) already
    assert.equal(raceView(c, 'rollers', '2026-11-26', {now: T('2026-11-22T18:29:59Z')}).status.sev, 'err');
    // the team's view is its nearest race's: red, and the later race is red too
    const v = teamView(c, 'rollers', {now: sunday});
    assert.deepEqual([v.raceDate, v.status.sev, v.races[1].status.sev], ['2026-11-22', 'err', 'err']);
    assert.equal(teamRow(v).main, 'No live plan: riders get nothing');
    // without a team start time the later race (no time of its own) is live with S null: nothing sent
    const d = racesClub();
    d.teams.rollers.start = null;
    const later = teamView(d, 'rollers', {now: FRI}).races[1];
    assert.deepEqual([later.date, later.S, later.live.id, later.live.sent, later.status.kind], ['2026-11-26', null, 'thu001', false, 'no-start']);
    // the Sunday race keeps its own 18:00
    assert.equal(teamView(d, 'rollers', {now: FRI}).S, T('2026-11-22T17:00:00Z'));
    // nothing ahead: raceView of null
    assert.deepEqual(raceView(c, 'rollers', null, {now: FRI}).when, {day: null, time: null, until: null, today: false});
});


// Team cockpit spec §5.6: the newer-version notice and the rider states of every plan of the race.
test('newerNotLive: only the live plan\'s newest version, stored after the live one went live, and never live itself', () => {
    const {club: c, ids, newId} = cockpitClub();                 // 'Rollers · fast' v3 live since 18:14Z; v2 was live
    const up = (as, riders, hm) => uploadSheet(c, {slug: 'rollers', json: plan('Rollers', riders.map(id => [id, 60])), text: null,
        base: c.teams.rollers.version, via: 'file', pinnedEventId: null, live: false, as}, {now: T(`2026-11-19T${hm}:00Z`), newId}).id;
    const live = (id, hm) => makeLive(c, 'rollers', id, T(`2026-11-19T${hm}:00Z`), {version: c.teams.rollers.version});
    assert.equal(newerNotLive(c, 'rollers', ids.f3), null);                                          // the newest is live
    const f4 = up(ids.fast, ['1001', '1002'], '18:20');
    assert.deepEqual(newerNotLive(c, 'rollers', ids.f3), {id: f4, n: 4, at: '2026-11-19T18:20:00.000Z'});
    live(ids.f2, '18:22');                                                                           // a step back: v4 was there before v2 went live
    assert.equal(newerNotLive(c, 'rollers', ids.f2), null);
    const f5 = up(ids.fast, ['1001', '1003'], '18:25');
    assert.equal(newerNotLive(c, 'rollers', ids.f2).id, f5);
    live(f5, '18:26');
    live(ids.f2, '18:27');                                                                           // v5 was live: quiet
    assert.equal(newerNotLive(c, 'rollers', ids.f2), null);
    up(ids.slow, ['1004'], '18:28');                                                                 // a variant kept as a backup never prompts
    assert.equal(newerNotLive(c, 'rollers', ids.f2), null);
    for (const s of Object.values(c.sheets)) {
        delete s.liveAt;                                                                             // stored before this version
    }
    assert.equal(newerNotLive(c, 'rollers', ids.f2).id, f5);                                         // the live version's own `at` counts
});


test('rider states: a code of any version of any plan of the race', () => {
    const {club: c, ids} = cockpitClub();
    const has = id => ({at: '2026-11-19T18:10:00.000Z', sig: c.sheets[id].sig, mod: '0.3.4', sheet: id, inEvent: false, event: null});
    const v = teamView(c, 'rollers', {now: NOW, seen: {'1001': has(ids.s1), '1002': has(ids.f2), '1003': {...has(ids.f2), sig: 'ZZZZZZ'}}});
    const text = id => v.riders.find(r => r.id === id).state.text;
    assert.deepEqual([text('1001'), text('1002'), text('1003')],
        ['Has \'Rollers · slow\' v1, not the live one', 'Has v2, not the live v3', 'Has an older plan (code ZZZZZZ)']);
    assert.equal(v.riders.find(r => r.id === '1001').state.kind, 'old-code');
});
