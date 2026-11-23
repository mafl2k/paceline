// Run with: node --test server/tests/back-equivalence.test.mjs
// Selection equivalence of the team cockpit spec (§9): Make live of version vN gives every rider the
// pick and the plan record that Restore vN gave (legacy-back.mjs, frozen), but for the sheet id and
// the etag. Both run on clones of one club; every rider asks in and outside events, at both edges of
// the event window, at times from Make live to 5 h after the last race's start.
import test from 'node:test';
import assert from 'node:assert/strict';
import {pickForRider, servable} from '../select.mjs';
import {planRecord} from '../api.mjs';
import {convertClub, makeLive, setRaceEvent} from '../club.mjs';
import {planTypes, planOfId} from '../plans.mjs';
import {PRE_RACES} from './pre-races.mjs';
import {T} from './helpers.mjs';
import {cockpitClub, mixedTypes, DATE} from './cockpit-fixture.mjs';
import * as legacy from './legacy-back.mjs';

const strip = rec => { const {sheet, etag, ...rest} = rec; return rest; };
const answer = (club, aid, q) => {
    const p = pickForRider(club, aid, q);
    return p === null ? null : {pick: {slug: p.slug, S: p.S, role: p.role}, record: strip(planRecord(club, p, {body: true}))};
};
const dump = () => { const c = PRE_RACES.find(([n]) => n === 'dump')[1](); convertClub(c, T('2026-11-21T07:00:00Z')); planTypes(c); return c; };
const pinned = () => { const {club} = cockpitClub(); setRaceEvent(club, 'rollers', DATE, 5123456, T('2026-11-19T18:16:30Z')); return club; };
const mixed = () => { const c = mixedTypes(); planTypes(c); return c; };          // the step runs before either operation
const CASES = [
    ['cockpit v1', () => ({club: cockpitClub().club, slug: 'rollers', plan: 'c00001', n: 1, at: T('2026-11-19T18:17:00Z')})],
    ['cockpit v2', () => ({club: cockpitClub().club, slug: 'rollers', plan: 'c00001', n: 2, at: T('2026-11-19T18:17:00Z')})],
    ['an event link', () => ({club: pinned(), slug: 'rollers', plan: 'c00001', n: 2, at: T('2026-11-19T18:17:00Z')})],
    ['the 0.3 dump v1', () => ({club: dump(), slug: 'rollers', plan: 'a00002', n: 1, at: T('2026-11-21T08:00:00Z')})],
    ['the 0.3 dump, the live version itself', () => ({club: dump(), slug: 'rollers', plan: 'a00002', n: 2, at: T('2026-11-21T08:00:00Z')})],
    ['two types before schema 4', () => ({club: mixed(), slug: 'rollers', plan: 'ra0001', n: 1, at: T('2026-11-19T12:00:00Z')})],
];

test('Make live of vN gives every rider the pick and the plan record Restore vN gave, but for the sheet id and the etag', () => {
    let compared = 0;
    let picked = 0;
    for (const [name, build] of CASES) {
        const {club, slug, plan, n, at} = build();
        const a = structuredClone(club);
        const b = structuredClone(club);
        const target = planOfId(b, slug, plan).versions.find(([, v]) => v.n === n)[0];
        let k = 0;
        const r = legacy.backTo(a, slug, {plan, n, version: a.teams[slug].version}, {now: at, newId: () => `z${String(++k).padStart(5, '0')}`});
        assert.equal(r.live, true, name);
        makeLive(b, slug, target, at, {version: b.teams[slug].version});
        const riders = new Set(Object.values(club.sheets).flatMap(s => [...Object.keys(s.json?.riders ?? {}), ...Object.keys(s.json?.roster ?? {})]));
        const events = new Set([1, ...Object.values(club.teams).flatMap(t => Object.values(t.races)).flatMap(x => [x.pinnedEventId, x.eventId]).filter(v => v != null)]);
        const until = Math.max(...servable(b, at).map(c => c.S)) + 5 * 3600e3;
        const step = Math.max(30 * 60000, Math.ceil((until - at) / 60));
        for (let now = at; now <= until; now += step) {
            const queries = [{now}];
            for (const c of servable(b, now)) {
                for (const min of [-61, -60, 30, 31]) {                     // E = S + min: both edges of the event window
                    for (const eventId of events) {
                        queries.push({now, E: c.S + min * 60000, eventId});
                    }
                }
            }
            for (const aid of riders) {
                for (const q of queries) {
                    const was = answer(a, aid, q);
                    assert.deepEqual(answer(b, aid, q), was, `${name} ${aid} ${JSON.stringify(q)}`);
                    compared++;
                    picked += was === null ? 0 : 1;
                }
            }
        }
    }
    assert.ok(compared > 30000 && picked > 6000, `${compared} ${picked}`);
});
