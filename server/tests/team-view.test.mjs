// The team view (plan 3b, Task 3): the pure model behind the picker, the switcher and the team page
// (spec §5.4): order, status (worst state), notes and "N to fix", rider states, the before-gate
// view, riders-only counts, the pull target, the no-start-time trap, Back to vN in words, the
// refresh window.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {club as clubOf, sheet, planJson, T} from './helpers.mjs';
import {
    teamView, teamRow, teamOrder, backAsk, refreshDue, untilLabel, atLabel, pullTarget, nextRace, SEV, worst,
    andList, quote, foldedTeams, liveWords, liveQuestion, backQuestion, undoOffer, raceWithin, gateOpen, UNDO_MS,
} from '../team-view.mjs';
import {localDay} from '../time.mjs';
import {uploadSheet, backTo, makeLive} from '../club.mjs';
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
    assert.equal(view.riders[0].pull, 'Pull 60 s');
    assert.equal(view.has, null);
    assert.equal(view.count, 6);
    // the planner's roster (Hanna) is no part of the view
    assert.equal(Object.hasOwn(view, 'bench'), false);
    assert.equal(view.sev, 'neutral');
    assert.equal(view.S, S);
    assert.equal(view.gateAt, S - 30 * MIN);
    assert.equal(view.opens, '19:00');
    assert.deepEqual(view.when, {day: 'Thu 19 Nov', time: '19:30', until: 'in 35 min', today: true});
    const {lines, ...card} = view.live;
    assert.deepEqual(card, {
        id: 'rrrr01', label: 'Rollers A', date: DATE, day: 'Thu 19 Nov', sig: live, at: '15:00',
        pinnedEventId: null, eventId: null, sent: true,
        n: 1, planId: 'rrrr01', versions: 1, prevN: null, summary: 'First version', back: null, newer: null,
    });
    assert.deepEqual(lines.map(l => [l.kind, l.text]), [['first', 'First version']]);
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


test('teamView: rider states and their order', () => {
    const c = statesClub();
    const view = teamView(c, 'rollers', {now: S - 5 * MIN, seen: statesSeen(c)});
    assert.deepEqual(view.riders.map(r => [r.name, r.pos]), [
        ['Ben', 4], ['Cleo', 6], ['Dan', 8], ['Hanna', 2], ['Gus', 3], ['Finn', 5], ['Eva', 7], ['Ida', 1],
    ]);
    assert.deepEqual(view.riders.map(r => r.state), [
        {kind: 'other-event', sev: 'err', text: 'In event 4567891 · gets nothing', time: '19:22'},
        {kind: 'other-team', sev: 'warn', text: 'Rides Sprockets now', time: '19:22'},
        {kind: 'old-code', sev: 'warn', text: 'Has an older plan (code ABC123)', time: '19:22'},
        {kind: 'none', sev: 'neutral', text: 'Not seen yet', time: null},
        {kind: 'checked', sev: 'neutral', text: 'Checked 19:22 · not in the event yet', time: null},
        {kind: 'checked', sev: 'neutral', text: 'Checked 19:22 · not in the event yet', time: null},
        {kind: 'in-event', sev: 'neutral', text: 'In the event · plan comes at the next check', time: '19:22'},
        {kind: 'has', sev: 'ok', text: 'Has the plan', time: null},
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
    c.teams.sprockets.live = 'ssss01';
    c.sheets.ssss01 = sheet({team: 'sprockets', label: 'Sprockets A', date: DATE, riders: ['1001', '1008'], uploadedAt: '2026-11-19T16:00:00.000Z'});
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
    c.sheets.rrrr01.pinnedEventId = 4567890;
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


test('teamView: no live plan is red only near the race; plans stored say "No live plan"', () => {
    // Spokes races on Thursdays (the club's day) at 20:15; the morning after its race it has no plan:
    // neutral "Next race Thu 26 Nov", not red for six days (UI panel, 19 Nov 2026)
    const c = clubOf({teams: {spokes: team('Spokes', '20:15')}});
    const after = teamView(c, 'spokes', {now: T('2026-11-20T08:00:00Z'), seen: {}});
    assert.deepEqual(after.status, {sev: 'neutral', kind: 'next-race', icon: 'clock', text: 'Next race Thu 26 Nov'});
    assert.equal(after.sev, 'neutral');
    assert.deepEqual(teamRow(after), {
        slug: 'spokes', name: 'Spokes', sev: 'neutral', icon: 'clock', timeLine: 'Thu 26 Nov 20:15 · in 6 days',
        main: 'Next race Thu 26 Nov', quiet: 'No plan yet', short: 'No plan yet',
    });
    // red from 2 days before the start (Thu 26 Nov 19:15Z)
    assert.equal(teamView(c, 'spokes', {now: T('2026-11-24T19:14:59Z'), seen: {}}).status.sev, 'neutral');
    const near = teamView(c, 'spokes', {now: T('2026-11-24T19:15:00Z'), seen: {}});
    assert.deepEqual(near.status, {sev: 'err', kind: 'no-plan', icon: 'noPlan', text: 'No plan: riders get nothing'});
    assert.equal(teamRow(near).quiet, 'Upload a plan to fix this');

    // a plan stored for that race, none live: the row says "No live plan", never "upload one"
    c.sheets.pppp01 = {...sheet({team: 'spokes', label: 'Spokes', date: '2026-11-26', riders: ['1001'], uploadedAt: '2026-11-20T09:00:00.000Z'}), plan: 'pppp01'};
    const stored = teamView(c, 'spokes', {now: T('2026-11-20T10:00:00Z'), seen: {}});
    assert.deepEqual(stored.status, {sev: 'neutral', kind: 'none-live', icon: 'noPlan', text: 'No live plan yet'});
    assert.deepEqual([teamRow(stored).main, teamRow(stored).quiet, teamRow(stored).short], ['No live plan yet', 'Make one of its plans live', 'No live plan']);
    const storedNear = teamView(c, 'spokes', {now: T('2026-11-26T18:00:00Z'), seen: {}});
    assert.deepEqual(storedNear.status, {sev: 'err', kind: 'none-live', icon: 'noPlan', text: 'No live plan: riders get nothing'});
    assert.deepEqual(teamRow(storedNear), {
        slug: 'spokes', name: 'Spokes', sev: 'err', icon: 'noPlan', timeLine: '20:15 · in 1 h 15 min',
        main: 'No live plan: riders get nothing', quiet: 'Make one of its plans live', short: 'No live plan',
    });
});


test('teamView: no plan and no start time are the status, not notes', () => {
    const c = clubOf({
        teams: {spokes: team('Spokes', '20:15'), cogs: team('Cogs', null, 'cccc01'), cranks: team('Cranks', null)},
        sheets: {cccc01: sheet({team: 'cogs', label: 'Cogs B', date: DATE, riders: ['1008'], uploadedAt: '2026-11-19T17:00:00.000Z'})},
    });
    const now = S - 5 * MIN;
    const spokes = teamView(c, 'spokes', {now, seen: {}});
    assert.deepEqual(spokes.status, {sev: 'err', kind: 'no-plan', icon: 'noPlan', text: 'No plan: riders get nothing'});
    assert.deepEqual(spokes.notes, []);
    assert.equal(spokes.sev, 'err');
    assert.equal(spokes.live, null);
    assert.deepEqual(teamRow(spokes), {
        slug: 'spokes', name: 'Spokes', sev: 'err', icon: 'noPlan', timeLine: '20:15 · in 50 min',
        main: 'No plan: riders get nothing', quiet: 'Upload a plan to fix this', short: 'No plan',
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
    const cranks = teamView(c, 'cranks', {now, seen: {}});
    assert.equal(cranks.status.text, 'No start time and no plan');
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
    c.teams.sprockets.live = 'ssss01';
    c.sheets.ssss01 = sheet({team: 'sprockets', label: 'Sprockets A', date: DATE, riders: ['1007', '1009'], uploadedAt: '2026-11-19T14:30:00.000Z', pinnedEventId: 4567899});
    c.sheets.rrrr01.pinnedEventId = 4567890;
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
    // the rider row carries it
    const c = base();
    c.sheets.rrrr01.json.riders['1002'].pull_wkg = 4.25;
    assert.equal(teamView(c, 'rollers', {now: S - 60 * MIN, seen: {}}).riders[1].pull, 'Pull 60 s · 4.3 W/kg');
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
    c.teams.rollers.live = null;
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
    late.teams.cogs.live = 'cccc01';
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


test('backAsk: what riders get, then holes and moves in words; null without a question', () => {
    // ported from backWords (fix round 1: only backAsk is left); Back of the live plan always asks
    // before the gate (UP is 18:50 in Berlin, the gate 19:00) no "at once" but when riders get it,
    // then the riders that change, as the version diffs name them (UI panel, 19 Nov 2026)
    const ASK = 'From 19:00, riders get v1 instead of v2.';
    // Rollers is live on v2 without Ben; its v1 lists Ben, who now rides Sprockets
    const withSprockets = (c, riders, uploadedAt = '2026-11-19T16:00:00.000Z') => {
        c.teams.sprockets.live = 'ssss01';
        c.sheets.ssss01 = sheet({team: 'sprockets', label: 'Sprockets A', date: DATE, riders, uploadedAt});
    };
    let c = structuredClone(base());
    withSprockets(c, ['1001', '1009']);
    upload(c, {as: 'rrrr01', riders: ROLLERS.slice(1)});
    const kept = structuredClone(c);
    assert.equal(backAsk(c, 'rollers', {plan: 'rrrr01', n: 1}, UP), `${ASK} With v1: Ben in. v1 lists Ben, who now rides Sprockets. Rollers then rides without him. Restore v1 anyway?`);
    assert.deepEqual(c, kept, 'backAsk changes nothing');
    // a plan named by any of its version ids, and n as the form sends it
    assert.equal(backAsk(c, 'rollers', {plan: c.teams.rollers.live, n: '1'}, UP), `${ASK} With v1: Ben in. v1 lists Ben, who now rides Sprockets. Rollers then rides without him. Restore v1 anyway?`);
    // after the gate: riders in the event get it within a minute
    assert.equal(backAsk(c, 'rollers', {plan: 'rrrr01', n: 1}, S - 10 * MIN),
        'Riders in the event get v1 instead of v2 within a minute. With v1: Ben in. v1 lists Ben, who now rides Sprockets. Rollers then rides without him. Restore v1 anyway?');
    // the newest n, an unknown n or plan, or a team that is gone: nothing to say
    assert.equal(backAsk(c, 'rollers', {plan: 'rrrr01', n: 2}, UP), null);
    assert.equal(backAsk(c, 'rollers', {plan: 'rrrr01', n: 7}, UP), null);
    assert.equal(backAsk(c, 'rollers', {plan: 'zzzzzz', n: 1}, UP), null);
    assert.equal(backAsk(c, 'gone', {plan: 'rrrr01', n: 1}, UP), null);

    // several holes
    c = structuredClone(base());
    withSprockets(c, ['1001', '1002', '1009']);
    upload(c, {as: 'rrrr01', riders: ROLLERS.slice(2)});
    assert.equal(backAsk(c, 'rollers', {plan: 'rrrr01', n: 1}, UP), `${ASK} With v1: Ben and Cleo in. v1 lists Ben and Cleo, who now ride Sprockets. Rollers then rides without them. Restore v1 anyway?`);

    // a move: v1 (uploaded 16:00) lists Ida, who rides Sprockets (15:00) since v2 left her out
    c = structuredClone(base({uploadedAt: '2026-11-19T16:00:00.000Z'}));
    c.sheets.rrrr01 = sheet({team: 'rollers', label: 'Rollers A', date: DATE, riders: [...ROLLERS, '1008'], uploadedAt: '2026-11-19T16:00:00.000Z', plan: 'rrrr01'});
    withSprockets(c, ['1008', '1009'], '2026-11-19T15:00:00.000Z');
    upload(c, {as: 'rrrr01', riders: ROLLERS});
    assert.equal(backAsk(c, 'rollers', {plan: 'rrrr01', n: 1}, UP), `${ASK} With v1: Ida in. Ida moves from Sprockets to Rollers. Restore v1 anyway?`);

    // no moves and no holes: only what riders get
    c = structuredClone(base());
    upload(c, {as: 'rrrr01', riders: ROLLERS.slice(1)});
    assert.equal(backAsk(c, 'rollers', {plan: 'rrrr01', n: 1}, UP), `${ASK} With v1: Ben in.`);
    // riders out too: v3 has Ben again (v2 then drops him), v4 only Cleo, Dan and Hanna
    const both = structuredClone(c);
    upload(both, {as: 'rrrr01', riders: [...ROLLERS.slice(1), '1001']});
    assert.equal(backAsk(both, 'rollers', {plan: 'rrrr01', n: 2}, UP), 'From 19:00, riders get v2 instead of v3. With v2: Ben out.');
    upload(both, {as: 'rrrr01', riders: ['1002', '1003', '1007']});
    assert.equal(backAsk(both, 'rollers', {plan: 'rrrr01', n: 1}, UP), 'From 19:00, riders get v1 instead of v4. With v1: 4 riders in, Hanna out.');
    // the same riders in another order: no rider line
    upload(both, {as: 'rrrr01', riders: ['1003', '1002', '1007']});
    assert.equal(backAsk(both, 'rollers', {plan: 'rrrr01', n: 4}, UP), 'From 19:00, riders get v4 instead of v5.');
    // a stale page: no question, the POST refuses it
    assert.equal(backAsk(c, 'rollers', {plan: 'rrrr01', n: 1, version: c.teams.rollers.version - 1}, UP), null);
    // a team without a start time gets nothing: no "at once"
    c.teams.rollers.start = null;
    assert.equal(backAsk(c, 'rollers', {plan: 'rrrr01', n: 1}, UP), 'Riders get nothing until Rollers has a start time. With v1: Ben in.');

    // a plan that is not live: null, even with a hole
    c = structuredClone(base());
    withSprockets(c, ['1001', '1009']);
    const b = upload(c, {type: 'B', riders: ['1001', '1008'], live: false});
    upload(c, {as: b.id, riders: ['1008'], live: false});
    assert.equal(backAsk(c, 'rollers', {plan: b.id, n: 1}, UP), null);
});


// Rollers without a plan yet, then its plan 'Rollers' as uploads build it (the clock of `at`).
function versionsClub() {
    return clubOf({teams: {rollers: team('Rollers', '19:30'), sprockets: team('Sprockets', '19:30')}});
}
const V1 = ['1001', '1003', '1004', '1005', '1006'];          // Ben, Dan, Eva, Finn, Gus
const V2 = ['1002', '1003', '1004', '1005', '1006'];          // Cleo in, Ben out


test('teamView: the live version, its summary and Back', () => {
    const c = versionsClub();
    const r1 = upload(c, {riders: V1, at: T('2026-11-19T14:00:00Z')});
    const r2 = upload(c, {as: r1.planId, riders: V2, at: T('2026-11-19T15:00:00Z')});
    const view = teamView(c, 'rollers', {now: S - 35 * MIN, seen: {}});
    assert.equal(view.live.id, r2.id);
    assert.equal(view.live.n, 2);
    assert.equal(view.live.planId, r1.planId);
    assert.equal(view.live.versions, 2);
    assert.equal(view.live.prevN, 1);
    // the change note carries its version (UI panel, 19 Nov 2026: never "Back to v1: …" beside Restore v1)
    assert.equal(view.live.summary, 'v2: Cleo in, Ben out');
    assert.deepEqual(view.live.lines.map(l => l.text), ['Cleo in (1st)', 'Ben out']);
    assert.equal(view.live.at, '16:00');
    assert.equal(view.live.back.n, 1);
    // Back of the live plan always asks (decision 12): nothing moves, no hole, so only what riders get
    assert.deepEqual(view.live.back, {n: 1, words: 'From 19:00, riders get v1 instead of v2. With v1: Ben in, Cleo out.'});
    assert.equal(view.live.newer, null);
    // Back's words when v1 lists a rider who now rides Sprockets
    c.teams.sprockets.live = 'ssss01';
    c.sheets.ssss01 = {...sheet({team: 'sprockets', label: 'Sprockets', date: DATE, riders: ['1001', '1009'], uploadedAt: '2026-11-19T16:30:00.000Z'}), plan: 'ssss01'};
    const asked = teamView(c, 'rollers', {now: S - 35 * MIN, seen: {}});
    assert.deepEqual(asked.live.back, {n: 1, words: 'From 19:00, riders get v1 instead of v2. With v1: Ben in, Cleo out. v1 lists Ben, who now rides Sprockets. Rollers then rides without him. Restore v1 anyway?'});
    // a Back copy reads as one
    const r3 = upload(c, {as: r1.planId, riders: V1, at: T('2026-11-19T16:40:00Z')});
    c.sheets[r3.id].copyOf = 1;
    const copy = teamView(c, 'rollers', {now: S - 35 * MIN, seen: {}});
    assert.equal(copy.live.n, 3);
    assert.equal(copy.live.prevN, 2);
    assert.equal(copy.live.summary, 'v3 (restored v1): Ben in, Cleo out');
    // a real Back: the copy reads as made at the Back (17:40), not at v1's upload (15:00)
    const backed = structuredClone(c);
    const k = backTo(backed, 'rollers', {plan: r1.planId, n: 1, version: backed.teams.rollers.version}, {now: T('2026-11-19T16:40:00Z'), newId: () => 'bbbb01'});
    assert.equal(backed.sheets[k.id].uploadedAt, backed.sheets[r1.id].uploadedAt, 'uploadedAt stays the precedence time');
    const afterBack = teamView(backed, 'rollers', {now: S - 35 * MIN, seen: {}});
    assert.equal(afterBack.live.id, k.id);
    assert.equal(afterBack.live.at, '17:40');
    // the version before is the stored one below: with v2 gone (cap, Remove a rider) it is v1
    delete c.sheets[r2.id];
    const gap = teamView(c, 'rollers', {now: S - 35 * MIN, seen: {}});
    assert.equal(gap.live.prevN, 1);
    assert.equal(gap.live.back.n, 1);
    assert.equal(gap.live.summary, 'v3 (restored v1): Same as v1');
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
    c.teams.sprockets.live = 'ssss01';
    c.sheets.ssss01 = {...sheet({team: 'sprockets', label: 'Sprockets', date: DATE, riders: ['1002', '1009'], uploadedAt: '2026-11-19T16:30:00.000Z'}), plan: 'ssss01'};
    view = teamView(c, 'rollers', {now: S - 35 * MIN, seen: {}});
    assert.deepEqual(view.live.newer.marks, [{id: '1002', name: 'Cleo', rides: 'sprockets', ridesName: 'Sprockets'}]);
    // a newer version made by Back while another version is live: its own time, not its upload's
    const d = versionsClub();
    const d1 = upload(d, {riders: V1, at: T('2026-11-19T14:00:00Z')});
    upload(d, {as: d1.planId, riders: V2, at: T('2026-11-19T15:00:00Z')});
    upload(d, {as: d1.planId, riders: ['1002', '1003'], at: T('2026-11-19T15:30:00Z')});
    const live3 = d.teams.rollers.live;
    const k = backTo(d, 'rollers', {plan: d1.planId, n: 2, version: d.teams.rollers.version}, {now: T('2026-11-19T16:50:00Z'), newId: () => 'bbbb03'});
    d.teams.rollers.live = live3;
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
    // a plan for next week's race: listed with its own day, in the fixed order
    const next = upload(c, {type: 'next', riders: ['1009'], live: false, at: T('2026-11-19T14:30:00Z'), date: '2026-11-26'});
    const two = teamView(c, 'rollers', {now: S - 35 * MIN, seen: {}});
    assert.deepEqual(two.plans.map(p => [p.id, p.day, p.live]), [[live.id, 'Thu 19 Nov', true], [b2.id, 'Thu 19 Nov', false], [next.id, 'Thu 26 Nov', false]]);
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
    // another plan's code is no version of the live plan
    const b = upload(c, {type: 'B', riders: ['1009'], live: false, at: T('2026-11-19T15:10:00Z')});
    const bSig = c.sheets[b.id].sig;
    view = teamView(c, 'rollers', {now: S - 5 * MIN, seen: {1002: seen(at, {sig: bSig, sheet: r2.id})}});
    assert.equal(stateOf(view, 'Cleo').text, `Has an older plan (code ${bSig})`);
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
    c.teams.rollers.live = null;
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
    assert.equal(view.plans[0].id, c.teams.rollers.live);
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
    assert.equal(view.live.summary, null);
    assert.deepEqual(view.live.lines, []);
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
    c.teams.sprockets.live = 'ssss01';
    c.sheets.ssss01 = {...sheet({team: 'sprockets', label: 'Sprockets', date: DATE, riders: ['1002', '1009'], uploadedAt: '2026-11-19T16:30:00.000Z'}), plan: 'ssss01'};
    assert.equal(liveWords(c, 'rollers', slow.id, now), 'From 19:00, riders get \'Rollers · slow\' v1 instead of \'Rollers · fast\' v1. '
        + '\'Rollers · slow\' still lists Cleo, who now rides another team. Make it live anyway?');
    // without a live plan
    const d = versionsClub();
    const only = upload(d, {type: 'fast', riders: V1, live: false, at: T('2026-11-19T14:00:00Z')});
    assert.equal(liveWords(d, 'rollers', only.id, now), 'From 19:00, riders get \'Rollers · fast\' v1.');
    assert.equal(liveWords(d, 'rollers', only.id, S - 5 * MIN), 'Riders in the event get \'Rollers · fast\' v1 within a minute.');
    // a team without a start time sends nothing: no "at once" (fix round 1)
    d.teams.rollers.start = null;
    assert.equal(liveWords(d, 'rollers', only.id, now), 'Riders get nothing until Rollers has a start time.');
    c.teams.rollers.start = null;
    assert.equal(liveWords(c, 'rollers', slow.id, now), 'Riders get nothing until Rollers has a start time. '
        + '\'Rollers · slow\' still lists Cleo, who now rides another team. Make it live anyway?');
    assert.equal(fast.id, c.teams.rollers.live);
});


test('liveWords: a plan of another race ends the live plan for its race, and asks', () => {
    // a team has one live plan (UI panel, 19 Nov 2026: the audit's worst finding): making next
    // week's plan live leaves tonight's race without a plan
    const c = versionsClub();
    const fast = upload(c, {type: 'fast', riders: V1, at: T('2026-11-19T14:00:00Z')});
    const next = upload(c, {type: 'next', riders: V2, live: false, date: '2026-11-26', at: T('2026-11-19T14:10:00Z')});
    assert.equal(c.teams.rollers.live, fast.id);
    const words = 'Rollers · next\' v1 for Thu 26 Nov becomes live. That ends \'Rollers · fast\' v1 for Thu 19 Nov: riders get nothing for that race. Make it live anyway?';
    assert.equal(liveWords(c, 'rollers', next.id, S - 35 * MIN), `'${words}`);
    // the same after the gate and during the race: tonight's plan is still to be served
    assert.equal(liveWords(c, 'rollers', next.id, S + 60 * MIN), `'${words}`);
    // once tonight's plan is used up (S + 4 h, as the assign page's box), nothing ends
    assert.equal(liveWords(c, 'rollers', next.id, S + 4 * 60 * MIN + 1), 'From Thu 26 Nov 19:00, riders get \'Rollers · next\' v1.');
    // the other way round: next week's plan live, tonight's made live ends next week's
    const d = versionsClub();
    const tonight = upload(d, {type: 'fast', riders: V1, live: false, at: T('2026-11-19T14:00:00Z')});
    upload(d, {type: 'next', riders: V2, live: true, date: '2026-11-26', at: T('2026-11-19T14:10:00Z')});
    assert.equal(liveWords(d, 'rollers', tonight.id, S - 35 * MIN), '\'Rollers · fast\' v1 for Thu 19 Nov becomes live. That ends \'Rollers · next\' v1 for Thu 26 Nov: riders get nothing for that race. Make it live anyway?');
    // with outdated marks the marks' question is the one question
    c.teams.sprockets.live = 'ssss01';
    c.sheets.ssss01 = {...sheet({team: 'sprockets', label: 'Sprockets', date: '2026-11-26', riders: ['1002', '1009'], uploadedAt: '2026-11-19T16:30:00.000Z'}), plan: 'ssss01'};
    assert.equal(liveWords(c, 'rollers', next.id, S - 35 * MIN), `'${words.replace(' Make it live anyway?', '')} 'Rollers · next' still lists Cleo, who now rides another team. Make it live anyway?`);
});


// ---- a special team's start time belongs to its race, team and date (user, 19 Nov 2026) ----

test('teamView: a special team races at its race\'s start; "No start time" only for a race without any', () => {
    const now = T('2026-11-19T12:00Z');
    // Cogs has no start time of its own; its live plan of 21 Nov races at 20:15 (19:15Z)
    const c = kinds('2026-11-21');
    c.teams.cogs = {...c.teams.cogs, start: null, live: 'cccc01', raceStarts: {'2026-11-21': '20:15'}};
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
    // neutral while the race is more than 2 days off, red from then (UI panel, 19 Nov 2026)
    c.teams.cogs.live = null;
    const stored = teamView(c, 'cogs', {now, seen: {}});
    assert.deepEqual(stored.status, {sev: 'neutral', kind: 'none-live', icon: 'noPlan', text: 'No live plan yet'});
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
    old.teams.cogs = {...old.teams.cogs, start: null, live: 'cccc01'};
    const red = teamView(old, 'cogs', {now, seen: {}});
    assert.equal(red.noStart, true);
    assert.deepEqual(red.status, {sev: 'err', kind: 'no-start', icon: 'clock', text: 'No start time: riders on this plan get nothing'});
    assert.deepEqual(teamRow(red), {
        slug: 'cogs', name: 'Cogs', sev: 'err', icon: 'clock', timeLine: 'No start time',
        main: 'No start time: riders on this plan get nothing', quiet: '\'Cogs\' has no start time · upload a new version with it', short: 'No start time',
    });
    assert.equal(liveWords(old, 'cogs', 'cccc01', now), 'Riders get nothing: \'Cogs\' has no start time. Upload a new version of it with its start time.');
    // the same plan stored but not live: still red, never "null" in a line (review I3)
    old.teams.cogs.live = null;
    const notLive = teamView(old, 'cogs', {now, seen: {}});
    assert.equal(notLive.noStart, true);
    assert.deepEqual(notLive.status, {sev: 'err', kind: 'no-start', icon: 'clock', text: 'No start time for Sat 21 Nov'});
    const row = teamRow(notLive);
    assert.deepEqual([row.timeLine, row.quiet], ['No start time', 'Upload a new version with its start time']);
    assert.ok(!JSON.stringify(row).includes('null'), JSON.stringify(row));
    // with the team's start time (0.3.0's way) it races at that, as before
    old.teams.cogs = {...old.teams.cogs, start: '19:30', live: 'cccc01'};
    assert.equal(teamView(old, 'cogs', {now, seen: {}}).S, T('2026-11-21T18:30:00Z'));

    // a weekly team without a start time: "No start time", as before
    const weekly = kinds();
    weekly.teams.rollers.start = null;
    assert.deepEqual(teamView(weekly, 'rollers', {now, seen: {}}).status, {sev: 'err', kind: 'no-start', icon: 'clock', text: 'No start time and no plan'});
});


test('teamView: a special team\'s trap names the race\'s start time, not a team start time', () => {
    // Cogs (special, no time anywhere) has a live plan listing Ida, who rides Rollers now
    const c = kinds('2026-11-19');
    c.teams.cogs = {...c.teams.cogs, start: null, live: 'cccc01'};
    c.teams.rollers.live = 'rrrr01';
    c.sheets.rrrr01 = sheet({team: 'rollers', label: 'Rollers A', date: DATE, riders: ['1008', '1001'], uploadedAt: '2026-11-19T10:00:00.000Z'});
    c.sheets.cccc01.uploadedAt = '2026-11-19T11:00:00.000Z';
    const now = T('2026-11-19T12:00Z');
    assert.deepEqual(teamView(c, 'cogs', {now, seen: {}}).trap.map(x => x.text),
        ['Ida rides Rollers for now; once this race has its start time (it comes with the plan), Ida moves here and Rollers has a hole.']);
    // with the race's start it is sent, and no trap
    c.teams.cogs.raceStarts = {[DATE]: '21:00'};
    assert.deepEqual(teamView(c, 'cogs', {now, seen: {}}).trap, []);
});


test('teamOrder: a special team by its next race\'s start, after the weekly teams without one', () => {
    const now = T('2026-11-19T12:00Z');
    const c = kinds('2026-11-21');
    c.teams.axles = {...team('Axles', '20:00'), kind: 'weekly', weekday: null};
    c.teams.owls = {...team('Owls', null), kind: 'weekly', weekday: null};
    c.teams.bolts = {...team('Bolts', '18:00'), kind: 'special', weekday: null};
    // Cogs' race of 21 Nov at 19:45; Bolts has no race (its stale 18:00 does not count)
    c.teams.cogs = {...c.teams.cogs, start: null, raceStarts: {'2026-11-21': '19:45'}};
    assert.deepEqual(teamOrder(c, now), ['rollers', 'cogs', 'axles', 'owls', 'bolts']);
    // without a time Cogs goes after the weekly teams; the special teams without one by name
    delete c.teams.cogs.raceStarts;
    assert.deepEqual(teamOrder(c, now), ['rollers', 'axles', 'owls', 'bolts', 'cogs']);
});


// ---- the Make live rule, Undo and the race window (UI panel wave 2) ----

test('liveQuestion: asks only while the gate is open or the words warn', () => {
    const c = versionsClub();
    const fast = upload(c, {type: 'fast', riders: V1, at: T('2026-11-19T14:00:00Z')});
    const slow = upload(c, {type: 'slow', riders: V2, live: false, at: T('2026-11-19T14:10:00Z')});
    // before the gate, nothing to warn about: it acts at once (Undo follows), with the words as before
    const pre = liveQuestion(c, 'rollers', slow.id, S - 35 * MIN);
    assert.deepEqual(pre, {words: 'From 19:00, riders get \'Rollers · slow\' v1 instead of \'Rollers · fast\' v1.', ask: false, marks: []});
    assert.equal(liveWords(c, 'rollers', slow.id, S - 35 * MIN), pre.words);
    // the gate edge: from S - 30 min it asks, until the race is used up (S + 4 h)
    assert.equal(liveQuestion(c, 'rollers', slow.id, S - 30 * MIN - 1).ask, false);
    assert.equal(liveQuestion(c, 'rollers', slow.id, S - 30 * MIN).ask, true);
    assert.equal(liveQuestion(c, 'rollers', slow.id, S + 4 * 60 * MIN).ask, true);
    assert.equal(gateOpen(c, c.sheets[slow.id], S + 4 * 60 * MIN + 1), false);
    // the version that is live already never asks
    assert.equal(liveQuestion(c, 'rollers', fast.id, S - 10 * MIN).ask, false);
    // an outdated mark warns before the gate: Cleo now rides Sprockets
    c.teams.sprockets.live = 'ssss01';
    c.sheets.ssss01 = {...sheet({team: 'sprockets', label: 'Sprockets', date: DATE, riders: ['1002', '1009'], uploadedAt: '2026-11-19T16:30:00.000Z'}), plan: 'ssss01'};
    const marked = liveQuestion(c, 'rollers', slow.id, S - 35 * MIN);
    assert.equal(marked.ask, true);
    assert.ok(marked.words.endsWith('Make it live anyway?'), marked.words);
    assert.deepEqual(marked.marks.map(m => m.name), ['Cleo']);
    // no start time warns too: riders get nothing
    const d = versionsClub();
    const only = upload(d, {type: 'fast', riders: V1, live: false, at: T('2026-11-19T14:00:00Z')});
    assert.equal(liveQuestion(d, 'rollers', only.id, S - 35 * MIN).ask, false, 'the first plan of a team, before the gate');
    d.teams.rollers.start = null;
    assert.deepEqual(liveQuestion(d, 'rollers', only.id, S - 35 * MIN), {words: 'Riders get nothing until Rollers has a start time.', ask: true, marks: []});
});


test('liveQuestion: a plan that takes a rider from another team names the move and asks', () => {
    const c = versionsClub();
    upload(c, {type: 'fast', riders: V1, at: T('2026-11-19T14:00:00Z')});
    // Sprockets' live plan lists Cleo, uploaded before 'Rollers · slow': once that is live, Cleo rides Rollers
    c.teams.sprockets.live = 'ssss01';
    c.sheets.ssss01 = {...sheet({team: 'sprockets', label: 'Sprockets', date: DATE, riders: ['1002', '1009'], uploadedAt: '2026-11-19T14:05:00.000Z'}), plan: 'ssss01'};
    const slow = upload(c, {type: 'slow', riders: V2, live: false, at: T('2026-11-19T14:10:00Z')});
    const q = liveQuestion(c, 'rollers', slow.id, S - 35 * MIN);
    assert.equal(q.ask, true);
    assert.equal(q.words, 'From 19:00, riders get \'Rollers · slow\' v1 instead of \'Rollers · fast\' v1. Cleo moves from Sprockets to Rollers. '
        + 'Still to do: Sprockets. Make it live anyway?');
});


test('liveQuestion: the gate of the race being replaced asks too', () => {
    // tonight's plan is live and its gate open; making next week's plan live ends it (and warns anyway)
    const c = versionsClub();
    upload(c, {type: 'fast', riders: V1, at: T('2026-11-19T14:00:00Z')});
    const next = upload(c, {type: 'next', riders: V1, live: false, at: T('2026-11-19T14:10:00Z'), date: '2026-11-26'});
    assert.equal(liveQuestion(c, 'rollers', next.id, S - 10 * MIN).ask, true);
    // a plan of tonight's race replaced while next week's plan is live: tonight's gate is what is open
    const d = versionsClub();
    const tonight = upload(d, {type: 'fast', riders: V1, live: false, at: T('2026-11-19T14:00:00Z')});
    upload(d, {type: 'next', riders: V1, at: T('2026-11-19T14:10:00Z'), date: '2026-11-26'});
    assert.equal(liveQuestion(d, 'rollers', tonight.id, S - 10 * MIN).ask, true);
});


test('backQuestion: Restore asks only while the gate is open or it moves riders, leaves a hole, or has no start time', () => {
    const c = versionsClub();
    const r1 = upload(c, {riders: V1, at: T('2026-11-19T14:00:00Z')});
    upload(c, {as: r1.planId, riders: V2, at: T('2026-11-19T15:00:00Z')});
    const pre = backQuestion(c, 'rollers', {plan: r1.planId, n: 1}, S - 35 * MIN);
    assert.deepEqual(pre, {words: 'From 19:00, riders get v1 instead of v2. With v1: Ben in, Cleo out.', ask: false});
    assert.equal(backAsk(c, 'rollers', {plan: r1.planId, n: 1}, S - 35 * MIN), pre.words);
    assert.equal(backQuestion(c, 'rollers', {plan: r1.planId, n: 1}, S - 30 * MIN).ask, true);
    // Ben now rides Sprockets: v1 would leave Rollers without him
    c.teams.sprockets.live = 'ssss01';
    c.sheets.ssss01 = {...sheet({team: 'sprockets', label: 'Sprockets', date: DATE, riders: ['1001', '1009'], uploadedAt: '2026-11-19T16:30:00.000Z'}), plan: 'ssss01'};
    assert.equal(backQuestion(c, 'rollers', {plan: r1.planId, n: 1}, S - 35 * MIN).ask, true);
    delete c.sheets.ssss01;
    c.teams.sprockets.live = null;
    c.teams.rollers.start = null;
    assert.equal(backQuestion(c, 'rollers', {plan: r1.planId, n: 1}, S - 35 * MIN).ask, true, 'no start time');
});


test('undoOffer: the version live before, for 10 minutes, while nothing changed since', () => {
    const c = versionsClub();
    const fast = upload(c, {type: 'fast', riders: V1, at: T('2026-11-19T14:00:00Z')});
    const slow = upload(c, {type: 'slow', riders: V2, live: false, at: T('2026-11-19T14:10:00Z')});
    const at = S - 40 * MIN;
    assert.equal(undoOffer(c, 'rollers', at), null, 'nothing switched yet');
    makeLive(c, 'rollers', slow.id, at);
    assert.deepEqual(c.teams.rollers.liveBefore, {id: fast.id, version: c.teams.rollers.version, at: iso(at)});
    const u = undoOffer(c, 'rollers', at + UNDO_MS);
    assert.equal(u.id, fast.id);
    assert.equal(u.prev.label, 'Rollers · fast');
    assert.equal(u.live.label, 'Rollers · slow');
    assert.equal(u.version, c.teams.rollers.version);
    assert.equal(undoOffer(c, 'rollers', at + UNDO_MS + 1), null, 'too late');
    // any later change of the team bumps its version: no Undo
    const d = structuredClone(c);
    d.teams.rollers.version++;
    assert.equal(undoOffer(d, 'rollers', at + MIN), null, 'changed since');
    // the Undo itself (undo: false) leaves none, and a team without a live plan before has none
    makeLive(c, 'rollers', fast.id, at + MIN, {undo: false});
    assert.equal(c.teams.rollers.liveBefore, undefined);
    assert.equal(undoOffer(c, 'rollers', at + MIN), null);
    const e = versionsClub();
    const first = upload(e, {type: 'fast', riders: V1, live: false, at: T('2026-11-19T14:00:00Z')});
    makeLive(e, 'rollers', first.id, at);
    assert.equal(undoOffer(e, 'rollers', at), null, 'no live version before');
    // Restore of the live plan keeps the version it replaced
    const f = versionsClub();
    const r1 = upload(f, {riders: V1, at: T('2026-11-19T14:00:00Z')});
    const r2 = upload(f, {as: r1.planId, riders: V2, at: T('2026-11-19T15:00:00Z')});
    backTo(f, 'rollers', {plan: r1.planId, n: 1, version: f.teams.rollers.version}, {now: at, newId});
    assert.equal(undoOffer(f, 'rollers', at).id, r2.id);
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
    c.teams.cogs = {...c.teams.cogs, start: null, raceStarts: {'2026-11-21': '20:15', '2026-12-05': '20:15'}};
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
    // once tonight's race is over, the far one
    const later = teamView(c, 'cogs', {now: T('2026-11-22T12:00:00Z'), seen: {}});
    assert.equal(later.raceDate, '2026-12-05');
    assert.equal(later.status.sev, 'neutral');
});


test('teamView: "plans stored" counts only the plans of the race in question (review M1)', () => {
    // Rollers (weekly, Thursdays 19:30) has only a plan for 26 Nov; on Wed 18 Nov its next race is
    // the 19th: no plan for it, so "upload one", as 0.3.4 said, not "Make one of its plans live"
    const c = kinds();
    c.sheets.rrrr01 = {...sheet({team: 'rollers', label: 'Rollers', date: '2026-11-26', riders: ['1001'], uploadedAt: '2026-11-15T10:00:00.000Z'}), plan: 'rrrr01'};
    const near = teamView(c, 'rollers', {now: T('2026-11-18T12:00:00Z'), seen: {}});
    assert.deepEqual(near.status, {sev: 'err', kind: 'no-plan', icon: 'noPlan', text: 'No plan: riders get nothing'});
    assert.notEqual(teamRow(near).quiet, 'Make one of its plans live');
    // after an unplayed race (S + 2 h to S + 4 h): tonight's plans no longer count for next week's race
    c.sheets.rrrr02 = {...sheet({team: 'rollers', label: 'Rollers · tonight', date: '2026-11-19', riders: ['1001'], uploadedAt: '2026-11-15T10:00:00.000Z'}), plan: 'rrrr02'};
    delete c.sheets.rrrr01;
    const after = teamView(c, 'rollers', {now: T('2026-11-19T21:00:00Z'), seen: {}});
    assert.equal(after.raceDate, '2026-11-26');
    assert.deepEqual(after.status, {sev: 'neutral', kind: 'next-race', icon: 'clock', text: 'Next race Thu 26 Nov'});
    // with a plan of the race itself: "No live plan", as before
    const own = teamView(c, 'rollers', {now: T('2026-11-19T12:00:00Z'), seen: {}});
    assert.equal(own.status.kind, 'none-live');
});


// ---- wave 2 review fixes ----

test('liveQuestion: an older version that reopens a hole of this team asks, also as an Undo (review I2)', () => {
    // Rollers v1 lists Ben; Sprockets has taken him since; v2 without Ben is made live before the gate
    const c = versionsClub();
    const v1 = upload(c, {riders: ['1001', '1002', '1003'], at: T('2026-11-19T10:00:00Z')});
    c.teams.sprockets.live = 'ssss01';
    c.sheets.ssss01 = {...sheet({team: 'sprockets', label: 'Sprockets', date: DATE, riders: ['1001', '2002', '2003'], uploadedAt: '2026-11-19T11:00:00.000Z'}), plan: 'ssss01'};
    const v2 = upload(c, {as: v1.planId, riders: ['1002', '1003', '1004'], live: false, at: T('2026-11-19T12:00:00Z')});
    const now = S - 150 * MIN;
    assert.equal(liveQuestion(c, 'rollers', v2.id, now).ask, false, 'v2 closes the hole: no question');
    makeLive(c, 'rollers', v2.id, now, {version: c.teams.rollers.version});
    const u = undoOffer(c, 'rollers', now + MIN);
    assert.equal(u.id, v1.id);
    // v1 is not its plan's newest version, so outdated() does not see it: the dry run does
    const q = liveQuestion(c, 'rollers', u.id, now + MIN);
    assert.equal(q.ask, true);
    assert.ok(q.words.endsWith('\'Rollers\' still lists Ben, who now rides another team. Make it live anyway?'), q.words);
    assert.deepEqual(q.marks.map(m => [m.id, m.rides]), [['1001', 'sprockets']]);
});
