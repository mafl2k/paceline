// Clubs in the 0.3 shape (team.live, team.raceStarts, the event fields on the sheets), as 0.3
// stored them, for the conversion to races (races.mjs toRaces) and the selection equivalence test.
// Nothing here converts: these are the inputs. Made-up names only (helpers.mjs).
import fs from 'node:fs';
import path from 'node:path';
import {sheet} from './helpers.mjs';

const DUMP_FILE = path.join(import.meta.dirname, 'fixtures', 'club-0.3-dump.json');


// What helpers.mjs club() builds (an active club; a sheet without `plan` is its own plan), plus
// `weekday` when given. Never converted.
export function rawClub({
    id = 'k7f3q9x2m4', name = 'Kettenfett RC', tz = 'Europe/Berlin', teams = {}, sheets = {},
    createdAt = '2026-11-01T10:00:00.000Z', weekday,
} = {}) {
    const stored = {};
    for (const [sid, s] of Object.entries(sheets)) {
        stored[sid] = s.plan === undefined ? {...s, plan: sid} : s;
    }
    return {
        id, name, status: 'active', email: 'captain@example.org', tz, createdAt, confirmedAt: createdAt,
        tokens: [], teams, sheets: stored, log: [], inbox: [],
        ...(weekday === undefined ? {} : {weekday}),
    };
}


// A team as 0.3 stored it.
const team = (name, start, live, extra = {}) => ({
    name, start, live, version: 1, changedAt: '2026-11-15T10:00:00.000Z', kind: 'weekly', weekday: null, ...extra,
});

const DATE = '2026-11-19';


// [[name, () => a fresh club in the 0.3 shape], …]; dates between 2026-11-16 and 2026-11-30.
export const PRE_RACES = [
    // written by the 0.3 operations themselves (13 versions, five teams, one inbox entry)
    ['dump', () => JSON.parse(fs.readFileSync(DUMP_FILE, 'utf8'))],

    // two teams of the same date, starting 10 min apart; Ben rides for both
    ['staggered', () => rawClub({
        teams: {rollers: team('Rollers', '19:30', 'ra0001'), sprockets: team('Sprockets', '19:40', 'sa0001')},
        sheets: {
            ra0001: sheet({team: 'rollers', label: 'Rollers', date: DATE, riders: ['1001', '1002', '1003'], uploadedAt: '2026-11-19T16:00:00.000Z'}),
            sa0001: sheet({team: 'sprockets', label: 'Sprockets', date: DATE, riders: ['1001', '1004', '1005'], uploadedAt: '2026-11-19T16:30:00.000Z'}),
        },
    })],

    // the live plan has a pinned and a learned event; another plan of its date has another link
    ['pinned', () => rawClub({
        teams: {rollers: team('Rollers', '19:30', 'ra0001')},
        sheets: {
            ra0001: sheet({team: 'rollers', label: 'Rollers', date: DATE, riders: ['1001', '1002', '1003'], uploadedAt: '2026-11-19T15:00:00.000Z',
                pinnedEventId: 4567890, eventId: 4567891}),
            rb0001: sheet({team: 'rollers', label: 'Rollers slow', date: DATE, riders: ['1004', '1005'], uploadedAt: '2026-11-19T15:30:00.000Z',
                pinnedEventId: 4567999, type: 'slow'}),
        },
    })],

    // the live plan has only a learned event (no link): the ±4 h of the learned id decide; Ben rides
    // for Sprockets 10 min later too, without any event (final review M-2)
    ['learned', () => rawClub({
        teams: {rollers: team('Rollers', '19:30', 'ra0001'), sprockets: team('Sprockets', '19:40', 'sa0001')},
        sheets: {
            ra0001: {...sheet({team: 'rollers', label: 'Rollers', date: DATE, riders: ['1001', '1002', '1003'], uploadedAt: '2026-11-19T15:00:00.000Z',
                eventId: 4567100}), boundAt: '2026-11-19T18:31:00.000Z'},
            sa0001: sheet({team: 'sprockets', label: 'Sprockets', date: DATE, riders: ['1001', '1004'], uploadedAt: '2026-11-19T15:10:00.000Z'}),
        },
    })],

    // a special team without a start time of its own; its races' times in team.raceStarts
    ['special', () => rawClub({
        teams: {cogs: team('Cogs', null, 'sp0002', {kind: 'special', raceStarts: {'2026-11-22': '18:00', '2026-11-19': '20:15'}})},
        sheets: {
            sp0001: sheet({team: 'cogs', label: 'Cogs', date: DATE, riders: ['1006', '1007'], uploadedAt: '2026-11-18T12:00:00.000Z',
                eventId: 4567001}),
            sp0002: sheet({team: 'cogs', label: 'Cogs', date: '2026-11-22', riders: ['1006', '1007', '1008'], uploadedAt: '2026-11-18T12:30:00.000Z'}),
        },
    })],

    // a weekly team that was special once: its race start stayed behind
    ['leftover', () => rawClub({
        teams: {rollers: team('Rollers', '19:30', 'ra0001', {raceStarts: {[DATE]: '06:00'}})},
        sheets: {
            ra0001: sheet({team: 'rollers', label: 'Rollers', date: DATE, riders: ['1001', '1002'], uploadedAt: '2026-11-19T12:00:00.000Z'}),
        },
    })],

    // no live plan, and a live pointer to a version that is gone
    ['dangling', () => rawClub({
        teams: {rollers: team('Rollers', '19:30', null), sprockets: team('Sprockets', '19:40', 'zzzzzz')},
        sheets: {
            ra0001: sheet({team: 'rollers', label: 'Rollers', date: DATE, riders: ['1001', '1002'], uploadedAt: '2026-11-18T12:00:00.000Z'}),
            rb0001: sheet({team: 'rollers', label: 'Rollers slow', date: '2026-11-26', riders: ['1003'], uploadedAt: '2026-11-18T12:10:00.000Z', type: 'slow'}),
            sa0001: sheet({team: 'sprockets', label: 'Sprockets', date: DATE, riders: ['1004'], uploadedAt: '2026-11-18T12:20:00.000Z'}),
        },
    })],
];
