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


// A rolling route, every rise and fall different.
function rolling() {
    return T.routeProfile(route([[400, 1], [250, -2], [600, 0.5], [300, 3], [200, -1], [500, -2.5],
                                 [350, 1.5], [450, 0], [300, -1], [700, 2], [400, -3]]));
}


test('alignStep: finds the offset from my event distance to the route by my altitude', () => {
    const p = rolling();
    let al = T.initialAlign();
    let foundAt = null;
    for (let d = 1; d <= 3000; d += 11) {
        al = T.alignStep(al, {d, alt: T.profileAlt(p, d + 135), profile: p});
        if (al.offset !== null && foundAt === null) {
            foundAt = d;
        }
    }
    assert.equal(al.offset, 135);
    assert.ok(foundAt >= T.ALIGN_MIN_M && foundAt < T.ALIGN_MIN_M + 50, `found at ${foundAt}`);
});


test('alignStep: no offset while two offsets fit equally (a route repeating every 600 m)', () => {
    const segs = [];
    for (let i = 0; i < 12; i++) {
        segs.push([300, i % 2 ? -1.7 : 1.7]);
    }
    const p = T.routeProfile(route(segs));
    let al = T.initialAlign();
    for (let d = 1; d <= 1500; d += 11) {
        al = T.alignStep(al, {d, alt: T.profileAlt(p, d + 135), profile: p});
    }
    assert.equal(al.offset, null);
});


test('alignStep: no offset on a flat route, without a profile, or with a poor fit; a new ride starts over', () => {
    const flat = T.routeProfile(route([[4000, 0]]));
    let al = T.initialAlign();
    for (let d = 1; d <= 3000; d += 11) {
        al = T.alignStep(al, {d, alt: 100, profile: flat});
    }
    assert.equal(al.offset, null, 'nothing to match on a flat route');
    assert.equal(T.alignStep(T.initialAlign(), {d: 500, alt: 100, profile: null}).offset, null);
    // My altitude 5 m off the profile everywhere: no fit good enough.
    const p = rolling();
    al = T.initialAlign();
    for (let d = 1; d <= 3000; d += 11) {
        al = T.alignStep(al, {d, alt: T.profileAlt(p, d) + 5, profile: p});
    }
    assert.equal(al.offset, null);
    // Distance back to the start: the samples so far are dropped.
    al = T.initialAlign();
    for (let d = 1; d <= 800; d += 11) {
        al = T.alignStep(al, {d, alt: T.profileAlt(p, d), profile: p});
    }
    al = T.alignStep(al, {d: 5, alt: T.profileAlt(p, 5), profile: p});
    assert.equal(al.pts.length, 1);
});
