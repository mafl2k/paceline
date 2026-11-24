import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../pages/src/engine/terrain.mjs';

// A route from grade segments [[length m, grade %], ...] as Sauce gives it (distances and
// elevations), one point every 5 m, starting at 100 m altitude.
function route(segs) {
    const distances = [0], elevations = [100];
    for (const [len, g] of segs) {
        for (let x = 5; x <= len; x += 5) {
            distances.push(distances.at(-1) + 5);
            elevations.push(elevations.at(-1) + 5 * g / 100);
        }
    }
    return {distances, elevations};
}


test('routeProfile: resamples every 10 m; profileAlt interpolates, null outside', () => {
    const p = T.routeProfile(route([[100, 0], [100, 5]]));
    assert.equal(p.step, 10);
    assert.equal(p.alt.length, 21);
    assert.equal(T.profileAlt(p, 100), 100);
    assert.ok(Math.abs(T.profileAlt(p, 155) - 102.75) < 1e-9);
    assert.equal(T.profileAlt(p, 200), 105);
    assert.equal(T.profileAlt(p, -1), null);
    assert.equal(T.profileAlt(p, 201), null);
    assert.equal(T.routeProfile(null), null);
    assert.equal(T.routeProfile({distances: [0], elevations: [1]}), null);
    assert.equal(T.routeProfile({distances: [0, 10], elevations: [1]}), null);
});


test('routeHills: a short climb and a short descent are rollers, a long climb is not', () => {
    const p = T.routeProfile(route([[1000, 0], [200, 5], [1000, 0], [150, -4], [1000, 0], [1000, 5], [500, 0]]));
    const h = T.routeHills(p);
    assert.equal(h.length, 3);
    const near = (a, b, tol = 40) => assert.ok(Math.abs(a - b) <= tol, `${a} not near ${b}`);
    assert.equal(h[0].kind, 'climb');
    near(h[0].from, 1000); near(h[0].to, 1200);
    near(h[0].gainM, 10, 3);
    assert.equal(h[0].roller, true);
    assert.equal(h[1].kind, 'descent');
    near(h[1].from, 2200); near(h[1].to, 2350);
    assert.equal(h[1].roller, true);
    assert.equal(h[2].kind, 'climb');
    near(h[2].lengthM, 1000);
    assert.equal(h[2].roller, false, '1000 m and 50 m up is a real climb');
});


test('routeHills: a steep blip shorter than HILL_ENTER_M is no hill; height alone makes a climb', () => {
    assert.deepEqual(T.routeHills(T.routeProfile(route([[500, 0], [20, 8], [500, 0]]))), []);
    // 300 m at 7 %: short, but 21 m up.
    const h = T.routeHills(T.routeProfile(route([[500, 0], [300, 7], [500, 0]])));
    assert.equal(h.length, 1);
    assert.equal(h[0].roller, false);
    assert.deepEqual(T.routeHills(null), []);
});


test('hillAt: within HILL_MARGIN_M of a hill', () => {
    const hills = [{from: 1000, to: 1200, kind: 'climb', roller: true}];
    assert.equal(T.hillAt(hills, 1000 - T.HILL_MARGIN_M), hills[0]);
    assert.equal(T.hillAt(hills, 1200 + T.HILL_MARGIN_M), hills[0]);
    assert.equal(T.hillAt(hills, 1000 - T.HILL_MARGIN_M - 1), null);
    assert.equal(T.hillAt(hills, NaN), null);
    assert.equal(T.hillAt([], 1100), null);
});


// A route with a lead-in: meta as Sauce gives it, segments positioned from the lap start. The weld
// is there to show it is ignored; without Zwift's own lead-in and lap (top-level
// leadinDistanceInMeters, distanceInMeters) event metres are profile metres.
function metaRoute(segs, segments = []) {
    return {...route(segs), meta: {leadinDistanceInMeters: 600, weldDistance: 400}, segments};
}
const near = (a, b, tol, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} not near ${b}`);
const realHills = r => T.routeHills(T.routeProfile(r)).filter(h => !h.roller);


test('climbIndex: the lead-in once, then every lap up to the event\'s end', () => {
    // 600 m flat lead-in, then a 3000 m lap with a 900 m climb at 5 % from lap metre 1000.
    const r = metaRoute([[600, 0], [1000, 0], [900, 5], [1100, 0]]);
    const profile = T.routeProfile(r);
    const items = T.climbIndex({profile, hills: T.routeHills(profile), preludeM: 600, endM: 8100});
    assert.equal(items.length, 3);
    [1600, 4600, 7600].forEach((from, i) => {
        near(items[i].from, from, 40, `climb ${i} from`);
        assert.equal(items[i].kind, 'climb');
        assert.equal(items[i].roller, false);
        assert.equal(items[i].source, 'profile');
    });
    near(items[0].to, 2500, 40);
    near(items[1].to, 5500, 40);
    assert.equal(items[2].to, 8100, 'the last climb is cut at the event\'s end');
    near(items[2].gainM, 500 * 0.05, 3, 'gain of the cut climb');
    assert.equal(items[2].lengthM, items[2].to - items[2].from);
    // hillAt works on the list.
    assert.equal(T.hillAt(items, 5000), items[1]);
    assert.equal(T.hillAt(items, 3500), null);
    // No lap before the event's end is added: 4000 m ends inside lap 1's flat part.
    const short = T.climbIndex({profile, hills: T.routeHills(profile), preludeM: 600, endM: 4000});
    assert.equal(short.length, 1);
    // Unusable input.
    assert.equal(T.climbIndex({profile, hills: [], preludeM: 600, endM: 0}), null);
    assert.equal(T.climbIndex({profile, hills: [], preludeM: 5000, endM: 8100}), null);
    assert.equal(T.climbIndex({profile: null, hills: [], preludeM: 600, endM: 8100}), null);
});


test('buildClimbIndex: Zwift\'s lead-in outside the profile and Zwift\'s lap shorter than the profile\'s place every lap by event metres', () => {
    // Sauce's profile has no lead-in (meta.leadinDistance 0) and a lap of 64010 m; Zwift's lead-in
    // is 2280 m and its lap 63857 m. A climb at profile 26780-27490 lies at event
    // 2280 + 26780 x 63857 / 64010 on lap 0 and one Zwift lap later on lap 1.
    const r = {...route([[26780, 0], [710, 6], [36520, 0]]),
               leadinDistanceInMeters: 2280, distanceInMeters: 63857,
               meta: {leadinDistance: 0, lapDistance: 64010, weldDistance: 0}, segments: []};
    const [h] = realHills(r);
    near(h.from, 26780, 40, 'profile climb');
    const index = T.buildClimbIndex(r, [], {laps: 2});
    assert.equal(index.preludeM, 0);
    assert.equal(index.leadinM, 2280);
    assert.equal(index.lapM, 63857);
    assert.equal(index.items.length, 2, JSON.stringify(index.items));
    const scale = 63857 / 64010;
    near(index.items[0].from, 2280 + 26780 * scale, 40, 'lap 0');
    near(index.items[0].from, 2280 + h.from * scale, 1e-6, 'lap 0 exactly');
    near(index.items[0].to, 2280 + h.to * scale, 1e-6, 'lap 0 end');
    near(index.items[1].from, 2280 + 26780 * scale + 63857, 40, 'lap 1');
    near(index.items[1].from - index.items[0].from, 63857, 1e-6, 'one Zwift lap apart');
    near(index.items[1].gainM, 710 * 0.06, 3);
    assert.equal(index.items[1].lengthM, index.items[1].to - index.items[1].from);
    // Without an end distance the laps give it: 2280 + 2 x 63857; a third lap is not listed.
    assert.ok(index.items[1].to < 2280 + 2 * 63857);
    assert.equal(T.buildClimbIndex(r, [], {laps: 3}).items.length, 3);
    // Cut by the end 400 profile metres into the lap-1 climb: the gain is that of those 400 m.
    const cutEnd = index.items[1].from + 400 * scale;
    const cut = T.buildClimbIndex(r, [], {laps: 0, endM: cutEnd}).items;
    assert.equal(cut.length, 2);
    assert.equal(cut[1].to, cutEnd);
    near(cut[1].gainM, 400 * 0.06, 1, 'gain of the cut climb');
});


test('buildClimbIndex: a profile lead-in of 760 m and Zwift\'s 623 m move lap 0 by -137 m; a climb in the lead-in is listed once', () => {
    // Profile: 760 m lead-in with a 400 m climb at 5 % from 200 m, then a 3000 m lap with a 900 m
    // climb at 5 % from lap metre 1000. No distanceInMeters: Zwift's lap is the profile's.
    const r = {...route([[200, 0], [400, 5], [160, 0], [1000, 0], [900, 5], [1100, 0]]),
               leadinDistanceInMeters: 623, meta: {leadinDistance: 760, weldDistance: 0}};
    const hills = realHills(r);
    assert.equal(hills.length, 2);
    const index = T.buildClimbIndex(r, [], {laps: 2});
    assert.equal(index.preludeM, 760);
    assert.equal(index.leadinM, 623);
    assert.equal(index.lapM, 3000);
    const items = index.items;
    assert.equal(items.length, 3, JSON.stringify(items));
    near(items[0].from, hills[0].from - 137, 1e-9, 'lead-in climb: e = 623 + (p - 760)');
    near(items[0].to, hills[0].to - 137, 1e-9);
    near(items[1].from, hills[1].from - 137, 1e-9, 'lap 0');
    near(items[2].from, hills[1].from - 137 + 3000, 1e-9, 'lap 1');
    near(items[1].from, 1623, 40);
    // With Zwift's lap of 2900 m only the lap part is scaled; the lead-in part keeps its metres.
    const short = T.buildClimbIndex({...r, distanceInMeters: 2900}, [], {laps: 2}).items;
    assert.equal(short.length, 3);
    near(short[0].from, hills[0].from - 137, 1e-9, 'lead-in climb, not scaled');
    near(short[0].to, hills[0].to - 137, 1e-9);
    near(short[1].from, 623 + (hills[1].from - 760) * 2900 / 3000, 1e-9, 'lap 0, scaled');
    near(short[2].from - short[1].from, 2900, 1e-9, 'lap 1');
    // A lead-in hill before event metre 0 is cut at 0, one wholly before it is dropped.
    const profile = T.routeProfile(r);
    const cut = T.climbIndex({profile, preludeM: 760, leadinM: 623, endM: 3000,
                              hills: [{from: 50, to: 500, kind: 'climb', roller: false, gainM: 20}]});
    assert.deepEqual([cut[0].from, cut[0].to, cut[0].lengthM], [0, 363, 363]);
    assert.deepEqual(T.climbIndex({profile, preludeM: 760, leadinM: 623, endM: 3000,
                                   hills: [{from: 0, to: 100, kind: 'climb', roller: false, gainM: 5}]}), []);
});


test('buildClimbIndex: without Zwift\'s lead-in or lap (or with unusable ones) the profile\'s are used; the weld is ignored', () => {
    // Lead-in 600 m, a lap of 3000 m, a weld of 400 m in meta: the climb at lap metre 1000 lies at
    // 600 + k x 3000 + 1000.
    const r = metaRoute([[600, 0], [1000, 0], [900, 5], [1100, 0]]);
    for (const extra of [{}, {leadinDistanceInMeters: -5, distanceInMeters: 0},
                         {leadinDistanceInMeters: '623', distanceInMeters: '2900'},
                         {leadinDistanceInMeters: NaN, distanceInMeters: -1}, {distanceInMeters: Infinity}]) {
        const index = T.buildClimbIndex({...r, ...extra}, [], {laps: 3});
        const what = JSON.stringify(extra);
        assert.equal(index.preludeM, 600, what);
        assert.equal(index.leadinM, 600, what);
        assert.equal(index.lapM, 3000, what);
        assert.equal('weldM' in index, false);
        assert.equal(index.items.length, 3, what);
        index.items.forEach((it, k) => near(it.from, 600 + k * 3000 + 1000, 40, `${what} lap ${k}`));
    }
    // A lead-in of 0 is a lead-in: every lap 600 m earlier, the end 3 x 3000.
    const zero = T.buildClimbIndex({...r, leadinDistanceInMeters: 0}, [], {laps: 3});
    assert.equal(zero.leadinM, 0);
    zero.items.forEach((it, k) => near(it.from, k * 3000 + 1000, 40, `lap ${k}`));
    // Zwift's lap alone: lap 1 one Zwift lap after lap 0.
    const lap = T.buildClimbIndex({...r, distanceInMeters: 2950}, [], {laps: 2});
    assert.equal(lap.lapM, 2950);
    near(lap.items[1].from - lap.items[0].from, 2950, 1e-6);
});


test('climbIndex: a 22 Nov-like route, one climb at km 28 of a 64 km lap, finds it on lap 1 and lap 2, one Zwift lap apart', () => {
    // A 400 m lead-in, then a profile lap of 63.6 km with one 1.2 km climb at 6 % at profile km 28;
    // Zwift's lap is 63.5 km. Event: 400 + 27600 x 63500 / 63600, then + 63500 per lap.
    const r = {...route([[28000, 0], [1200, 6], [34800, 0]]),
               leadinDistanceInMeters: 400, distanceInMeters: 63500,
               meta: {leadinDistance: 400, weldDistance: 0}};
    const profile = T.routeProfile(r);
    assert.equal((profile.alt.length - 1) * profile.step, 64000);
    assert.equal(T.routePrelude(r), 400);
    const index = T.buildClimbIndex(r, [], {laps: 0, endM: 100000});
    const items = index.items;
    assert.equal(items.length, 2);
    const first = 400 + 27600 * 63500 / 63600;
    near(items[0].from, first, 40, 'first');
    near(items[1].from, first + 63500, 40, 'second');
    near(items[1].from - items[0].from, 63500, 1e-6, 'one Zwift lap apart');
    assert.equal(T.hillAt(items, 92000), items[1], 'the climb on lap 2 is found');
    const three = T.buildClimbIndex(r, [], {laps: 0, endM: 160000}).items;
    assert.equal(three.length, 3);
    near(three[2].from, first + 2 * 63500, 40, 'third');
});


// Sauce's event elevation widget fetches the route with the 'leadin' prelude for every event; the
// profile's lead-in is meta's, never Zwift's top-level leadinDistanceInMeters.
test('routePrelude: the lead-in for every event, laps or not (Sauce\'s event widget); missing gives null', () => {
    const r = metaRoute([[100, 0]]);
    assert.equal(T.routePrelude(r), 600, 'the lead-in, not the 400 m weld');
    assert.equal(T.routePrelude({meta: {leadinDistance: 250}}), 250);
    assert.equal(T.routePrelude({meta: {leadinDistanceInMeters: 600}}), 600);
    assert.equal(T.routePrelude({meta: {weldDistance: 400}}), null, 'a weld is no lead-in');
    assert.equal(T.routePrelude({meta: {weldDistanceInMeters: 150}}), null);
    assert.equal(T.routePrelude({meta: {leadinDistanceInMeters: -5}}), null);
    assert.equal(T.routePrelude({meta: {leadinDistanceInMeters: '600'}}), null);
    assert.equal(T.routePrelude({meta: {leadinDistanceInMeters: NaN}}), null);
    assert.equal(T.routePrelude({}), null);
    assert.equal(T.routePrelude(null), null);
    assert.equal(T.routePrelude({meta: {leadinDistanceInMeters: 0}}), 0);
    assert.equal(T.routePrelude({leadinDistanceInMeters: 623, meta: {leadinDistance: 760}}), 760);
    assert.equal(T.routePrelude({leadinDistanceInMeters: 623, meta: {}}), null, 'Zwift\'s lead-in is not the profile\'s');
});


test('segmentSpans and climbIndex: a segment over a climb extends it, before, through a flat part and after; a flat segment is ignored; the segment type is never read', () => {
    // Lead-in 600 m; lap: 500 flat, climb A 500 m 5 % (lap 500-1000), 2000 flat, climb C 500 m 5 %
    // (lap 3000-3500), 1000 flat.
    const untouchable = {get type() { throw new Error('type read'); }, get name() { throw new Error('name read'); }};
    const segs = [{id: 7, offset: 300, distance: 1400, reverse: false, ...{}},   // route 900-2300, over A
                  {id: 8, offset: 4100, distance: 200, reverse: false},          // flat land
                  {id: 9, offset: 'x', distance: 100},                            // unusable
                  {id: 10, offset: 1, distance: NaN},
                  {id: 11, offset: 1},
                  null];
    Object.defineProperties(segs[0], Object.getOwnPropertyDescriptors(untouchable));
    const r = metaRoute([[600, 0], [500, 0], [500, 5], [2000, 0], [500, 5], [1000, 0]], segs);
    const spans = T.segmentSpans(r, 600);
    assert.deepEqual(spans, [{from: 900, to: 2300}, {from: 4700, to: 4900}]);
    assert.deepEqual(T.segmentSpans({}, 600), []);
    assert.deepEqual(T.segmentSpans(null, 600), []);
    assert.deepEqual(T.segmentSpans(r, NaN), []);
    assert.deepEqual(T.segmentSpans(r, undefined), []);
    assert.equal('isKom' in T, false);
    assert.equal('komSpans' in T, false);

    const profile = T.routeProfile(r);
    const hills = realHills(r);
    assert.equal(hills.length, 2, 'without segments the profile has A and C');
    const items = T.climbIndex({profile, hills: T.routeHills(profile), preludeM: 600, endM: 5000, spans});
    assert.equal(items.length, 2, JSON.stringify(items));
    assert.equal(items[0].kind, 'climb');
    assert.equal(items[0].source, 'segment');
    assert.equal(items[0].roller, false);
    assert.deepEqual([items[0].from, items[0].to], [900, 2300], 'from before A to 700 m after it');
    near(items[0].gainM, 0.05 * 500, 3, 'altitude at its end minus at its start');
    assert.equal(items[0].lengthM, 1400);
    assert.equal(items[1].source, 'profile');
    assert.deepEqual([items[1].from, items[1].to], [hills[1].from, hills[1].to], 'C stays as the profile gives it');
    // Through buildClimbIndex, with segment infos that must not be read.
    const built = T.buildClimbIndex(r, [{id: 7, ...{}}, untouchable], {laps: 1});
    assert.equal(built.items[0].source, 'segment');
    assert.deepEqual([built.items[0].from, built.items[0].to], [900, 2300]);
    assert.equal(T.buildClimbIndex(r, null, {laps: 1}).items[0].source, 'segment');
});


test('climbIndex: rollers and descents stay as the profile gives them; a segment over a roller adds nothing', () => {
    const r = metaRoute([[600, 0], [500, 0], [200, 5], [1100, 0], [600, -5], [500, 0]]);
    const profile = T.routeProfile(r);
    const items = T.climbIndex({profile, hills: T.routeHills(profile), preludeM: 600, endM: 3500,
                                spans: [{from: 1000, to: 1400}]});
    assert.deepEqual(items.map(i => [i.kind, i.roller, i.source]),
        [['climb', true, 'profile'], ['descent', false, 'profile']]);
});


// Hand-made hills on a flat 600 m lead-in + 3000 m lap, all on lap 0.
function joined(hills, spans) {
    const profile = T.routeProfile(metaRoute([[600, 0], [3000, 0]]));
    return T.climbIndex({profile, hills, preludeM: 600, endM: 3500, spans});
}
const hill = (from, to, kind = 'climb', gainM = 25, roller = false) => ({from, to, kind, roller, gainM});


test('climbIndex: flat parts up to CLIMB_JOIN_M inside a climb do not end it', () => {
    assert.equal(T.CLIMB_JOIN_M, 1000);
    const one = joined([hill(1000, 1500, 'climb', 25), hill(2100, 2600, 'climb', 20)]);
    assert.deepEqual(one, [{from: 1000, to: 2600, kind: 'climb', roller: false, source: 'profile',
                            gainM: 45, lengthM: 1600}], '600 m apart: one climb');
    assert.equal(joined([hill(1000, 1500), hill(2500, 3000)]).length, 1, 'exactly 1000 m apart: one');
    const two = joined([hill(1000, 1500), hill(2700, 3200)]);
    assert.deepEqual(two.map(i => [i.from, i.to]), [[1000, 1500], [2700, 3200]], '1200 m apart: two');
    // Two descents join the same way.
    assert.deepEqual(joined([hill(1000, 1500, 'descent', -25), hill(2100, 2600, 'descent', -20)])
        .map(i => [i.from, i.to, i.kind, i.gainM]), [[1000, 2600, 'descent', -45]]);
    // A segment climb joined to a profile climb stays a segment climb.
    const seg = joined([hill(1000, 1500), hill(2100, 2600)], [{from: 990, to: 1510}]);
    assert.deepEqual(seg.map(i => [i.from, i.to, i.source]), [[990, 2600, 'segment']]);
    // On a real profile: a 600 m flat part inside a climb, and a 1200 m one.
    const near1 = T.buildClimbIndex(metaRoute([[600, 0], [1000, 0], [500, 5], [600, 0], [500, 5], [1000, 0]]), [], {laps: 1});
    assert.equal(near1.items.length, 1, JSON.stringify(near1.items));
    near(near1.items[0].from, 1600, 40);
    near(near1.items[0].to, 3200, 40);
    const far = T.buildClimbIndex(metaRoute([[600, 0], [1000, 0], [500, 5], [1200, 0], [500, 5], [400, 0]]), [], {laps: 1});
    assert.equal(far.items.length, 2, JSON.stringify(far.items));
});


test('climbIndex: a flat top up to CLIMB_JOIN_M before the descent belongs to the climb; the descent stays a descent', () => {
    const items = joined([hill(1000, 1500, 'climb', 25), hill(2000, 2500, 'descent', -25)]);
    assert.deepEqual(items.map(i => [i.from, i.to, i.kind, i.lengthM]),
        [[1000, 2000, 'climb', 1000], [2000, 2500, 'descent', 500]]);
    assert.equal(T.hillAt(items, 1800).kind, 'climb', 'a hill on the flat top');
    assert.equal(T.hillAt(items, 2300).kind, 'descent');
    // 1200 m of flat top: the climb ends.
    assert.deepEqual(joined([hill(1000, 1500), hill(2700, 3200, 'descent', -25)]).map(i => [i.from, i.to]),
        [[1000, 1500], [2700, 3200]]);
    assert.equal(T.hillAt(joined([hill(1000, 1500), hill(2700, 3200, 'descent', -25)]), 2000), null);
    // A valley (descent, then a climb) is no climb and its descent: not bridged.
    assert.deepEqual(joined([hill(1000, 1500, 'descent', -25), hill(2000, 2500)]).map(i => [i.from, i.to]),
        [[1000, 1500], [2000, 2500]]);
});


test('climbIndex: rollers are neither joined nor bridging', () => {
    // A roller 500 m after a climb and 500 m before the next, the climbs 1200 m apart: three items.
    const items = joined([hill(1000, 1500), hill(2000, 2200, 'climb', 8, true), hill(2700, 3200)]);
    assert.deepEqual(items.map(i => [i.from, i.to, i.roller]),
        [[1000, 1500, false], [2000, 2200, true], [2700, 3200, false]]);
    // Two rollers 300 m apart stay two.
    assert.equal(joined([hill(1000, 1200, 'climb', 8, true), hill(1500, 1700, 'climb', 8, true)]).length, 2);
    // A roller in a short gap: the climbs around it are one, the roller stays as it is, and hillAt
    // finds the climb on it.
    const around = joined([hill(1000, 1500), hill(1600, 1700, 'climb', 5, true), hill(1900, 2400)]);
    assert.deepEqual(around.map(i => [i.from, i.to, i.roller]),
        [[1000, 2400, false], [1600, 1700, true]]);
    assert.equal(T.hillAt(around, 1650).roller, false);
});


test('climbIndex: a climb across the lap line whose halves are roller-sized is one real climb; two short halves stay a roller', () => {
    // The review's case: rollers at [3300, 3600] (the lap's end) and [600, 900] (the lap's start)
    // on a 3000 m lap after a 600 m lead-in, each 300 m at 5 % (15 m up). Over the lap line they
    // are one 600 m climb, 30 m up: a real climb.
    const r = metaRoute([[600, 0], [300, 5], [2400, 0], [300, 5]]);
    const profile = T.routeProfile(r);
    const hills = T.routeHills(profile);
    assert.deepEqual(hills.map(h => [h.kind, h.roller]), [['climb', true], ['climb', true]], 'two rollers on the profile');
    near(hills[0].from, 600, 25);
    near(hills[1].to, 3600, 1);
    const items = T.climbIndex({profile, hills, preludeM: 600, endM: 6000});
    const seam = items.filter(i => i.from <= 3600 && i.to >= 3600);
    assert.equal(seam.length, 1, JSON.stringify(items));
    near(seam[0].from, 3300, 25);
    near(seam[0].to, 3900, 15, "routeHills closes about 10 m late");
    assert.equal(seam[0].roller, false, 'one real climb over the lap line');
    assert.equal(seam[0].lengthM, seam[0].to - seam[0].from);
    near(seam[0].gainM, 30, 2);
    assert.equal(items.filter(i => i.from < 3600 && i.to > 3600).length, 1);
    assert.equal(items[0].roller, true, 'lap 0\'s first roller stays a roller');
    // Two halves of 100 m and 5 m up on a flat profile: 200 m and 5 m, still a roller.
    const flat = T.routeProfile(metaRoute([[600, 0], [3000, 0]]));
    const small = T.climbIndex({profile: flat, preludeM: 600, endM: 4000,
                                hills: [hill(600, 700, 'climb', 5, true), hill(3500, 3600, 'climb', 5, true)]});
    assert.deepEqual(small.map(i => [i.from, i.to, i.roller]), [[600, 700, true], [3500, 3700, true]]);
    // Rollers of one lap 30 m apart stay two (only the lap line joins them).
    assert.equal(joined([hill(1000, 1200, 'climb', 8, true), hill(1230, 1400, 'climb', 8, true)]).length, 2);
});


test('climbIndex: a climb across the lap seam is one item', () => {
    // 600 m lead-in whose last 300 m already climb at 5 %, climbing on to lap metre 400; then
    // 1500 m flat and a 1100 m climb at 5 % up to the lap's (and the profile's) end at 3600 m.
    // Each lap ends climbing and the next lap's start continues the climb.
    const r = metaRoute([[300, 0], [700, 5], [1500, 0], [1100, 5]]);
    const profile = T.routeProfile(r);
    const items = T.climbIndex({profile, hills: T.routeHills(profile), preludeM: 600, endM: 6000});
    // The seam is at 3600 event metres (600 + one lap of 3000 m).
    const seam = items.filter(i => i.from <= 3600 && i.to >= 3600);
    assert.equal(seam.length, 1, 'one item over the seam: ' + JSON.stringify(items));
    near(seam[0].from, 2520, 40, 'starts with the end of lap 0');
    near(seam[0].to, 4000, 40, 'ends with the start of lap 1');
    assert.equal(seam[0].lengthM, seam[0].to - seam[0].from);
    near(seam[0].gainM, 0.05 * seam[0].lengthM, 3);
    assert.equal(seam[0].roller, false);
    // Pass 0 keeps its lead-in part (before the lap start), unjoined.
    assert.equal(items[0].from < 600 && items[0].to > 600, true);
    assert.equal(items.filter(i => i.from < 3600 && i.to > 3600).length, 1, 'no duplicate over the seam');
});


test('climbIndex: a climb that starts right at the lap start is joined across the seam (hills open 15-20 m late)', () => {
    // 600 m flat lead-in, then a lap that starts climbing at once (500 m at 5 %), 1400 m flat and
    // 1100 m climbing at 5 % up to the end at 3600 m.
    const r = metaRoute([[600, 0], [500, 5], [1400, 0], [1100, 5]]);
    const profile = T.routeProfile(r);
    const hills = T.routeHills(profile);
    assert.ok(hills[0].from > 600 && hills[0].from - 600 <= 25, 'the profile opens the first hill late: ' + hills[0].from);
    const items = T.climbIndex({profile, hills, preludeM: 600, endM: 6000});
    const seam = items.filter(i => i.from <= 3600 && i.to >= 3600);
    assert.equal(seam.length, 1, JSON.stringify(items));
    near(seam[0].from, 2520, 40);
    near(seam[0].to, 4100, 40);
    assert.equal(seam[0].lengthM, seam[0].to - seam[0].from);
    near(seam[0].gainM, 0.05 * seam[0].lengthM, 3);
    // The first climb of lap 0 and the last one of lap 1 stand alone: three items in all.
    assert.equal(items.length, 3);
});


test('climbIndex and buildClimbIndex: null or missing options and null spans do not throw', () => {
    const r = metaRoute([[600, 0], [1000, 0], [900, 5], [1100, 0]]);
    const profile = T.routeProfile(r);
    const hills = T.routeHills(profile);
    assert.equal(T.climbIndex(null), null);
    assert.equal(T.climbIndex(undefined), null);
    assert.equal(T.climbIndex({}), null);
    assert.equal(T.climbIndex({profile, hills, preludeM: 600, endM: 4000, spans: null}).length, 1);
    assert.equal(T.climbIndex({profile, hills: null, preludeM: 600, endM: 4000, spans: null}).length, 0);
    const nan = T.climbIndex({profile, hills, preludeM: 600, endM: 4000, leadinM: NaN, lapM: NaN});
    assert.equal(nan.length, 1);
    near(nan[0].from, 1600, 40, 'NaN lead-in and lap fall back to the profile\'s');
    assert.equal(T.buildClimbIndex(r, [], null), null);
    assert.equal(T.buildClimbIndex(r, [], undefined), null);
    assert.equal(T.buildClimbIndex(r, null, {laps: 0, endM: 4000}).items.length, 1);
    assert.equal(T.buildClimbIndex(r, undefined, {laps: 0, endM: 4000}).items.length, 1);
});


test('buildClimbIndex: null without meta, profile or end; an explicit end wins over the laps', () => {
    const r = metaRoute([[600, 0], [1000, 0], [900, 5], [1100, 0]]);
    assert.equal(T.buildClimbIndex({...r, meta: undefined}, [], {laps: 0, endM: 5000}), null);
    assert.equal(T.buildClimbIndex({...r, meta: {}}, [], {laps: 0, endM: 5000}), null);
    assert.equal(T.buildClimbIndex(null, [], {laps: 0, endM: 5000}), null);
    assert.equal(T.buildClimbIndex({meta: r.meta}, [], {laps: 0, endM: 5000}), null, 'no profile');
    assert.equal(T.buildClimbIndex(r, [], {laps: 0}), null, 'no laps, no end');
    assert.equal(T.buildClimbIndex(r, [], {laps: null, endM: 0}), null);
    assert.equal(T.buildClimbIndex({...r, meta: {leadinDistance: 3600}}, [], {laps: 1}), null, 'no lap in the profile');
    const full = T.buildClimbIndex(r, [], {laps: 0, endM: 9000});
    assert.deepEqual([full.preludeM, full.leadinM, full.lapM], [600, 600, 3000]);
    assert.equal(full.items.length, 3);
    near(full.items[2].from, 7600, 40);
    assert.equal(T.buildClimbIndex(r, [], {laps: 3, endM: 4000}).items.length, 1);
    // Segments go through the route alone.
    const withSeg = T.buildClimbIndex({...r, segments: [{id: 1, offset: 900, distance: 1100}]}, [], {laps: 0, endM: 3600});
    assert.equal(withSeg.items[0].source, 'segment');
    assert.equal(withSeg.items[0].to, 2600);
});
