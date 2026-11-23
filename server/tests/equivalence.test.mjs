// Run with: node --test server/tests/equivalence.test.mjs
// The selection's check of the races spec (§3, §5): with the data 0.3 stored (one live plan per
// team), every rider gets the same pick from the converted club as 0.3's own selection gave from
// the club before the conversion (legacy-select.mjs, frozen), in and outside events, at both edges
// of the event window and of the learned id's ±4 h.
import test from 'node:test';
import assert from 'node:assert/strict';
import {pickForRider} from '../select.mjs';
import {convertClub} from '../club.mjs';
import {PRE_RACES} from './pre-races.mjs';
import {T} from './helpers.mjs';
import * as legacy from './legacy-select.mjs';

// A pick as the API serves it: the plan, its start, the role, and the event id of the plan record
// (api.mjs planRecord: from the race now, from the sheet in 0.3).
const key = p => {
    if (p === null) {
        return null;
    }
    const from = p.race ?? p.sheet;
    return {slug: p.slug, id: p.id, S: p.S, role: p.role, eventId: from.pinnedEventId ?? from.eventId};
};


test('every rider gets the same pick from the converted club as from the 0.3 club', () => {
    let compared = 0;
    let picked = 0;
    const from = T('2026-11-16T00:00:00Z');
    for (const [name, build] of PRE_RACES) {
        const old = build();
        const cur = structuredClone(old);
        convertClub(cur, from);
        const all = Object.values(old.sheets);
        const ids = new Set(all.flatMap(s => [...Object.keys(s.json?.riders ?? {}), ...Object.keys(s.json?.roster ?? {})]));
        const events = new Set([1, ...all.flatMap(s => [s.pinnedEventId, s.eventId]).filter(v => v != null)]);
        for (let now = from; now <= from + 15 * 864e5; now += 12 * 3600e3) {
            const queries = [{now}];
            for (const c of legacy.servable(old, now)) {
                for (const min of [-241, -240, -61, -60, 30, 31, 240, 241]) {     // E = S + min: both edges of the window and of ±4 h
                    for (const eventId of events) {
                        queries.push({now, E: c.S + min * 60000, eventId});
                    }
                }
            }
            for (const aid of ids) {
                for (const q of queries) {
                    const was = key(legacy.pickForRider(old, aid, q));
                    assert.deepEqual(key(pickForRider(cur, aid, q)), was, `${name} ${aid} ${JSON.stringify(q)}`);
                    compared++;
                    picked += was === null ? 0 : 1;
                }
            }
        }
    }
    assert.ok(compared > 10000 && picked > 1000, `${compared} ${picked}`);      // the dump club alone: about 36 000 and 4 000, 3 s
});
