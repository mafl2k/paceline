// Run with: node --test tests/powerband.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../pages/src/engine/powerband.mjs';
import {POWER_KEEP_MS} from '../pages/src/engine/display.mjs';

const GOAL = 300;

// Feeds one sample per second from second 0 (since = 0): `ws[i]` is the raw power at second i.
// Returns every state, so a test can look at any second.
function run(ws, {goal = GOAL, since = 0} = {}) {
    const out = [];
    let st = null;
    ws.forEach((w, i) => {
        st = B.bandStep(st, {at: (since ?? 0) + i * 1000, w, goal, since});
        out.push(st);
    });
    return out;
}

// Ramp up over 3 s, then steady 300 W up to second 14; from second 15 on a 10 % drop to 270 W.
const ramp = [100, 200, 300];
const steady = [...ramp, ...Array(12).fill(300)];            // seconds 0..14
const drop = [...steady, ...Array(21).fill(270)];            // seconds 0..35

test('start of a phase: the band and the average run from the first sample, the marker from 5 s', () => {
    const s = run(steady);
    // The first sample is the average and the whole band at once, no filter; no marker yet.
    assert.equal(s[0].w, 100);
    assert.equal(s[0].mean, 100);
    assert.equal(s[0].marker, null);
    assert.equal(s[0].lo, 100);
    assert.equal(s[0].hi, 100);
    // Second sample: de-spiked 150 (median of 100, 200); the user's 10 s min max of [100, 150] is
    // 100 / 150, each edge half way (1 s lowpass over 1 s) from 100. The average of 100 and 150.
    assert.equal(s[1].w, 150);
    assert.equal(s[1].lo, 100);
    assert.equal(s[1].hi, 125);
    assert.equal(s[1].mean, 125);
    // De-spiked 100, 150, 200, 300, 300: the average of the seconds so far, but no marker and no zone.
    const means = [100, 125, 150, 187.5, 210];
    for (let i = 0; i < 5; i++) {
        assert.equal(s[i].mean, means[i], `mean at ${i} s`);
        assert.equal(s[i].hist.length, i + 1);
        assert.equal(s[i].marker, null, `marker at ${i} s`);
        assert.equal(s[i].zone, null);
        assert.ok(s[i].lo <= s[i].hi && s[i].lo !== null, `band at ${i} s`);
    }
    // From 5 s the marker is the average (no prefill: the ramp-up is in it) with its zone.
    assert.equal(s[5].mean, 225);                         // (100 + 150 + 200 + 3 * 300) / 6
    assert.equal(s[5].marker, 225);
    assert.equal(s[5].zone, 'red');                       // -25 %
    assert.equal(s[5].hist.length, 6);
    assert.ok(s[5].lo < 300 && s[5].hi < 300);
    // At most the last 10 s: at 9 s all ten seconds, at 10 s the first one has left, from 12 s 300.
    assert.equal(s[9].hist.length, 10);
    assert.equal(s[9].mean, 255);
    assert.equal(s[10].hist.length, 10);
    assert.equal(s[10].mean, 275);
    assert.equal(s[12].mean, 300);
    assert.equal(s[12].zone, 'green');
    // The band catches up with the steady power: the high edge at once, the low edge once the ramp's
    // 100, 150 and 200 W have left its 10 s (at 10, 11 and 12 s), half its way a second from then.
    assert.ok(Math.abs(s[14].hi - 300) < 0.05);
    assert.equal(s[9].lo, 100);
    assert.deepEqual(s.slice(10, 15).map(x => x.lo), [125, 162.5, 231.25, 265.625, 282.8125]);
});

test('the average and the band take the real samples only (no prefill)', () => {
    // 10 W at second 0 and 300 W afterwards (de-spiked: 10, 155, then 300 from second 2): at 5 s the
    // average holds the real 10 and 155 W, and the band sees them as well (its low edge stays at 10).
    const s = run([10, 300, 300, 300, 300, 300]);
    assert.equal(s[5].mean, (10 + 155 + 4 * 300) / 6);
    assert.equal(s[5].marker, s[5].mean);
    assert.equal(s[5].lo, 10);
    // Its window at 5 s holds seconds 0..5: 10, 155, 300, 300, 300, 300 -> min 10.
    assert.equal(Math.min(...s[5].bhist.map(x => x.w)), 10);
    assert.equal(s[5].bhist.length, 6);
});

test('a single 150 W second moves nothing (de-spiked)', () => {
    const ws = [...steady];
    ws[10] = 150;
    const s = run(ws);
    const plain = run(steady);
    for (let i = 0; i < ws.length; i++) {
        assert.equal(s[i].mean, plain[i].mean, `mean at ${i} s`);
        assert.equal(s[i].marker, plain[i].marker, `marker at ${i} s`);
        assert.equal(s[i].zone, plain[i].zone);
        assert.equal(s[i].lo, plain[i].lo, `lo at ${i} s`);
        assert.equal(s[i].hi, plain[i].hi, `hi at ${i} s`);
    }
});

// The user's 10 s min max (25 Nov 2026: "take 10 s band"): the 270 W reaches the low edge after one
// de-spiked sample and it halves its way each second (285, 277.5, ...); the last 300 W leaves the
// window after 10 s, then the high edge halves its way (285, 277.5, ...).
const BAND_AFTER_DROP = [[300, 300], [285, 300], [278, 300], [274, 300], [272, 300], [271, 300],
                         [270, 300], [270, 300], [270, 300], [270, 300], [270, 285], [270, 278],
                         [270, 274], [270, 272], [270, 271], [270, 270], [270, 270], [270, 270],
                         [270, 270], [270, 270]];

test('a 10 % drop from 15 s: the band glides, the average turns amber after 7 s', () => {
    // 300 W from the first sample, so the lowpass has nothing left over from a ramp.
    const s = run([...Array(15).fill(300), ...Array(21).fill(270)]);
    const band = s.slice(15, 35).map(x => [Math.round(x.lo), Math.round(x.hi)]);
    assert.deepEqual(band, BAND_AFTER_DROP);
    // Average: j seconds of 270 in the window after j seconds (3 W each).
    for (let j = 0; j <= 10; j++) {
        assert.equal(Math.round(s[15 + j].mean * 1000) / 1000, 300 - 3 * j, `mean ${j} s after the drop`);
    }
    assert.equal(s[15 + 6].zone, 'green');
    assert.equal(s[15 + 7].zone, 'amber');
    assert.equal(s[15 + 10].mean, 270);
    assert.equal(s[15 + 10].zone, 'amber');
});

test('the same drop after a ramp: the band is the same within the lowpass tail of the ramp', () => {
    // The ramp's low edge (282.8 W at 14 s) is still on its way up when the drop comes: the first four
    // seconds' low edge lies above the plain drop's (291, 281, 275, 273), then within 1 W.
    const s = run(drop);
    assert.deepEqual(s.slice(15, 19).map(x => Math.round(x.lo)), [291, 281, 275, 273]);
    s.slice(15, 35).forEach((x, j) => {
        assert.ok(j < 4 || Math.abs(x.lo - BAND_AFTER_DROP[j][0]) <= 1, `lo ${j} s after the drop`);
        assert.ok(Math.abs(x.hi - BAND_AFTER_DROP[j][1]) <= 1, `hi ${j} s after the drop`);
    });
    assert.equal(s[15 + 7].zone, 'amber');
    assert.equal(s[15 + 10].mean, 270);
});

test('without a goal there is no zone, with a goal of 0 neither', () => {
    run(steady, {goal: null}).forEach(x => assert.equal(x.zone, null));
    run(steady, {goal: 0}).forEach(x => assert.equal(x.zone, null));
});

test('a gap of POWER_KEEP_MS + 1 ms starts over', () => {
    const s = run(steady);
    const last = s[s.length - 1];
    assert.notEqual(last.mean, null);
    const after = B.bandStep(last, {at: last.at + POWER_KEEP_MS + 1, w: 250, goal: GOAL, since: 0});
    // The band and the average run from the first sample again: a single value, no marker.
    assert.equal(after.mean, 250);
    assert.equal(after.hist.length, 1);
    assert.equal(after.lo, 250);
    assert.equal(after.hi, 250);
    assert.equal(after.zone, null);
    assert.equal(after.marker, null);
    // Exactly POWER_KEEP_MS is still the same phase.
    const kept = B.bandStep(last, {at: last.at + POWER_KEEP_MS, w: 300, goal: GOAL, since: 0});
    assert.notEqual(kept.marker, null);
});

test('the gap restart counts the five seconds from the new samples, not from since', () => {
    const s = run(steady);
    const last = s[s.length - 1];
    let st = B.bandStep(last, {at: last.at + POWER_KEEP_MS + 1, w: 250, goal: GOAL, since: 0});
    const t0 = st.at;
    // Still no marker 4 s later (it shows MARKER_AFTER_S after the restart).
    for (let i = 1; i <= 4; i++) {
        st = B.bandStep(st, {at: t0 + i * 1000, w: 250, goal: GOAL, since: 0});
    }
    assert.equal(st.marker, null);
    assert.equal(st.mean, 250);
    st = B.bandStep(st, {at: t0 + 5000, w: 250, goal: GOAL, since: 0});
    assert.equal(st.marker, 250);
});

test('a new since starts over', () => {
    const s = run(steady);
    const last = s[s.length - 1];
    const at = last.at + 1000;
    const next = B.bandStep(last, {at, w: 300, goal: GOAL, since: at});
    assert.equal(next.since, at);
    assert.equal(next.t0, at);
    assert.deepEqual(next.hist.map(x => x.t), [at]);      // the average from the new phase's first sample
    assert.equal(next.mean, 300);
    assert.equal(next.marker, null);
    assert.equal(next.zone, null);
    // A since after the sample (never sent): no samples in the phase yet, no average, no NaN.
    const ahead = B.bandStep(last, {at, w: 300, goal: GOAL, since: at + 5000});
    assert.equal(ahead.mean, null);
    assert.equal(ahead.marker, null);
    assert.equal(ahead.zone, null);
});

test('a non-finite power returns the state unchanged', () => {
    const s = run(steady);
    const last = s[s.length - 1];
    assert.equal(B.bandStep(last, {at: last.at + 1000, w: NaN, goal: GOAL, since: 0}), last);
    assert.equal(B.bandStep(last, {at: last.at + 1000, w: undefined, goal: GOAL, since: 0}), last);
    assert.equal(B.bandStep(null, {at: 0, w: NaN, goal: GOAL, since: 0}), null);
});

test('bandStep does not change the state it is given', () => {
    const s = run(steady.slice(0, 4));
    const before = JSON.stringify(s[3]);
    B.bandStep(s[3], {at: 4000, w: 300, goal: GOAL, since: 0});
    B.bandStep(s[3], {at: 5000, w: 300, goal: GOAL, since: 0});
    assert.equal(JSON.stringify(s[3]), before);
});

test('bandFresh: the state while the band runs and its last sample is at most POWER_KEEP_MS old, else null', () => {
    const s = run(steady);
    const last = s[s.length - 1];
    assert.equal(B.bandFresh(last, last.at), last);
    assert.equal(B.bandFresh(last, last.at + POWER_KEEP_MS), last);
    assert.equal(B.bandFresh(last, last.at + POWER_KEEP_MS + 1), null);
    assert.equal(B.bandFresh(null, 0), null);
    assert.equal(B.bandFresh(undefined, 0), null);
    // The pull's first seconds and READY: no marker, the band (and the shadow) show.
    const early = run(steady.slice(0, 3));
    assert.equal(early[2].marker, null);
    assert.equal(B.bandFresh(early[2], early[2].at), early[2]);
    const ready = run(steady, {since: null});
    assert.equal(B.bandFresh(ready[14], ready[14].at + POWER_KEEP_MS), ready[14]);
    assert.equal(B.bandFresh(ready[14], ready[14].at + POWER_KEEP_MS + 1), null);
    // No band (a state without lo/hi): nothing.
    assert.equal(B.bandFresh({...last, lo: null, hi: null}, last.at), null);
});

test('bandNumbers: the four edges, watts rounded to 10 or W/kg to 0.1', () => {
    assert.deepEqual(B.bandNumbers(200, {kg: null, unit: 'W'}), ['180', '190', '210', '220']);
    assert.deepEqual(B.bandNumbers(210, {kg: 70, unit: 'Wkg'}), ['2.7', '2.9', '3.2', '3.3']);
    assert.deepEqual(B.bandNumbers(287, {kg: null, unit: 'W'}), ['260', '270', '300', '320']);
    // W/kg without a weight falls back to watts; watts ignore the weight.
    assert.deepEqual(B.bandNumbers(200, {kg: null, unit: 'Wkg'}), ['180', '190', '210', '220']);
    assert.deepEqual(B.bandNumbers(200, {kg: 70, unit: 'W'}), ['180', '190', '210', '220']);
});

test('zoneWithHysteresis: green holds to 6 %, amber turns green only under 4 %', () => {
    const z = B.zoneWithHysteresis;
    assert.equal(z(300, 300, null), 'green');
    assert.equal(z(315, 300, null), 'green');            // 5 %
    assert.equal(z(316, 300, null), 'amber');
    assert.equal(z(317, 300, 'green'), 'green');         // 5.67 % but was green
    assert.equal(z(318.5, 300, 'green'), 'amber');       // 6.17 %
    assert.equal(z(317, 300, 'amber'), 'amber');
    assert.equal(z(289, 300, 'amber'), 'green');         // 3.67 %: under 4 %, back to green
    assert.equal(z(288, 300, 'amber'), 'green');         // exactly 4 %
    assert.equal(z(287, 300, 'amber'), 'amber');         // 4.33 %: stays amber
    assert.equal(z(289, 300, 'red'), 'green');
    assert.equal(z(330, 300, null), 'amber');            // 10 %
    assert.equal(z(331, 300, 'amber'), 'amber');         // 10.33 % but was amber
    assert.equal(z(334, 300, 'amber'), 'red');
    assert.equal(z(331, 300, 'red'), 'red');             // 10.33 % stays
    assert.equal(z(329, 300, 'red'), 'red');             // 9.67 %: red leaves only under 9 %
    assert.equal(z(327, 300, 'red'), 'amber');           // 9 %
});


test('a non-finite since counts from the sample itself (no marker at once, no NaN clock)', () => {
    for (const since of [NaN, Infinity, 'x']) {
        const st = B.bandStep(null, {at: 60000, w: 250, goal: GOAL, since});
        assert.equal(st.since, 60000, String(since));
        assert.equal(st.t0, 60000, String(since));
        assert.equal(st.mean, 250, String(since));
        assert.equal(st.marker, null, String(since));
    }
});


test('since null or left out: no phase, the band only (resting, chaos, no target)', () => {
    for (const since of [null, undefined]) {
        let st = null;
        for (let i = 0; i < 12; i++) {
            st = B.bandStep(st, {at: i * 1000, w: 200 + 10 * (i % 2), goal: null, since});
            assert.equal(st.since, null);
            assert.equal(st.marker, null);
            assert.equal(st.mean, null);
            assert.equal(st.zone, null);
            assert.ok(Number.isFinite(st.w));
        }
        assert.ok(st.lo >= 200 && st.hi <= 210 && st.lo <= st.hi, String(since));
        assert.equal(B.bandFresh(st, 11000), st);      // the band runs (the windows show it in READY and the pull only)
    }
});


test('a pull recognised 4 s late (since dated back): its marker 1 s later, the average of its real seconds', () => {
    // READY (no phase) from 0; I really start my pull at 3 s; the engine sees it at 7 s and dates its
    // since back to 3 s (coordinator ruling, 24 Nov 2026: the band engine handles a since in the past).
    // De-spiked: 200, 200, 200, 200, 280, 300, 300, 300, 310, 310.
    const raw = [200, 200, 200, 280, 300, 300, 300, 310, 320, 280];
    let st = null;
    for (let i = 0; i < 7; i++) {
        st = B.bandStep(st, {at: i * 1000, w: raw[i], goal: GOAL, since: null});
        assert.equal(st.marker, null);
        assert.equal(st.zone, null);
    }
    const ready = st;
    st = B.bandStep(st, {at: 7000, w: raw[7], goal: GOAL, since: 3000});
    // 4 s into the pull: its real seconds 3..7 s are the average, no marker yet.
    assert.equal(st.t0, 3000);
    assert.deepEqual(st.hist.map(x => x.t), [3000, 4000, 5000, 6000, 7000]);
    assert.equal(st.mean, (200 + 280 + 300 + 300 + 300) / 5);
    assert.equal(st.marker, null);
    assert.equal(st.zone, null);
    // The band: the de-spiked samples of the last 10 s (0..7 s: 200, 200, 200, 200, 280, 300, 300,
    // 300), its edges one lowpass step on from READY's (no break at the switch).
    assert.deepEqual(st.bhist.map(x => x.t), [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000]);
    assert.equal(st.lo, ready.lo + (200 - ready.lo) / 2);
    assert.equal(st.hi, ready.hi + (300 - ready.hi) / 2);
    // 1 s later (5 s since since): the marker, at the average of the pull's six real seconds.
    st = B.bandStep(st, {at: 8000, w: raw[8], goal: GOAL, since: 3000});
    assert.equal(st.w, 310);
    assert.equal(st.mean, 1690 / 6);
    assert.equal(st.marker, 1690 / 6);
    assert.equal(st.zone, 'amber');                       // -6.1 %
    // The next sample: seven seconds, the hysteresis goes on (-4.8 %: amber holds until under 4 %).
    const next = B.bandStep(st, {at: 9000, w: raw[9], goal: GOAL, since: 3000});
    assert.equal(next.w, 310);                             // median of 310, 320, 280
    assert.equal(next.hist.length, 7);
    assert.equal(next.marker, 2000 / 7);
    assert.equal(next.zone, 'amber');
});


test('the log runs across phases but a gap clears it', () => {
    let st = null;
    for (let i = 0; i < 8; i++) {
        st = B.bandStep(st, {at: i * 1000, w: 300, goal: GOAL, since: null});
    }
    const at = 7000 + POWER_KEEP_MS + 1;
    let gap = B.bandStep(st, {at, w: 250, goal: GOAL, since: 3000});
    assert.equal(gap.log.length, 1);
    assert.equal(gap.w, 250);
    assert.equal(gap.lo, 250);
    // since + 5 s lies back, but the log starts with this sample: the five seconds count from it, so
    // the marker does not show at once from this one sample (fix round 1).
    assert.equal(gap.t0, at);
    assert.equal(gap.mean, 250);
    assert.equal(gap.marker, null);
    assert.equal(gap.zone, null);
    for (let i = 1; i <= 5; i++) {
        gap = B.bandStep(gap, {at: at + i * 1000, w: 300, goal: GOAL, since: 3000});
        assert.equal(gap.marker === null, i < 5, `marker ${i} s after the gap`);
    }
    // De-spiked 250, 275, 300, 300, 300, 300.
    assert.equal(gap.mean, 287.5);
    assert.equal(gap.marker, 287.5);
    assert.equal(gap.zone, 'green');
});


test('no state before a pull whose since lies back (window opened mid-pull): the clock starts at the first sample', () => {
    let st = B.bandStep(null, {at: 60000, w: 250, goal: GOAL, since: 40000});
    assert.equal(st.t0, 60000);
    assert.equal(st.mean, 250);
    assert.equal(st.marker, null);
    for (let i = 1; i <= 5; i++) {
        st = B.bandStep(st, {at: 60000 + i * 1000, w: 300, goal: GOAL, since: 40000});
    }
    assert.equal(st.marker, 287.5);                       // de-spiked 250, 275, 300, 300, 300, 300
});


test('the band is continuous: READY to the pull and rest to the pull, one lowpass step, no restart', () => {
    // User, 25 Nov 2026 (replay of a real race): "the start is not correct. the band resets after the
    // switch". READY at 200 W, then the pull (since = at) at 350 W.
    let st = null;
    for (let i = 0; i < 8; i++) {
        st = B.bandStep(st, {at: i * 1000, w: 200, goal: GOAL, since: null});
    }
    const ready = st;
    st = B.bandStep(st, {at: 8000, w: 350, goal: GOAL, since: 8000});
    assert.deepEqual(st.bhist.map(x => x.t), [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000]);    // READY's seconds too
    assert.equal(st.w, 200);                              // de-spiked across the phases: 200, 200, 350
    assert.equal(st.lo, ready.lo);                        // all 200: nothing moves
    assert.equal(st.hi, ready.hi);
    st = B.bandStep(st, {at: 9000, w: 350, goal: GOAL, since: 8000});
    assert.equal(st.hi, 200 + (350 - 200) / 2);           // the 350 W reaches the high edge, one step
    assert.equal(st.lo, 200);
    // Resting (no phase) at 220..240 W for 12 s, then the pull at 300 W: the pull's first band holds
    // the last 10 s of rest power, its edges one lowpass step on from the rest band.
    st = null;
    const rest = [220, 240, 230, 220, 240, 230, 220, 240, 230, 220, 240, 230];
    rest.forEach((w, i) => { st = B.bandStep(st, {at: i * 1000, w, goal: null, since: null}); });
    const before = st;
    st = B.bandStep(st, {at: 12000, w: 300, goal: GOAL, since: 11000});
    assert.deepEqual(st.bhist.map(x => x.t), [3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000]);
    const ws = st.bhist.map(x => x.w);
    assert.equal(st.lo, before.lo + (Math.min(...ws) - before.lo) / 2);
    assert.equal(st.hi, before.hi + (Math.max(...ws) - before.hi) / 2);
    assert.notEqual(st.lo, st.hi);                        // not a single point
    assert.equal(st.marker, null);                        // the marker shows 5 s into the phase
    assert.deepEqual(st.hist.map(x => x.t), [11000, 12000]);    // the average from since on
    // A gap still clears it: one point again.
    const gap = B.bandStep(st, {at: 12000 + POWER_KEEP_MS + 1, w: 280, goal: GOAL, since: 11000});
    assert.deepEqual([gap.lo, gap.hi, gap.bhist.length], [280, 280, 1]);
});


test('the average is the last 10 seconds, not the last 10 samples (1.12 s spacing, 2 Hz)', () => {
    // Review probe: the pull starts at 250 W for 5 s, then 289 W (goal 300), a sample every 1.12 s.
    // The 250 W ages out by time, not by a count of entries.
    let st = null;
    for (let i = 0; i < 40; i++) {
        const at = i * 1120;
        st = B.bandStep(st, {at, w: at < 5000 ? 250 : 289, goal: GOAL, since: 0});
    }
    assert.equal(st.mean, 289);
    assert.equal(st.zone, 'green');
    // 2 Hz: 300 W for 20 s, then 270 W for 5 s: the window still holds 10 s, about half of each.
    st = null;
    for (let i = 0; i <= 50; i++) {
        const at = i * 500;
        st = B.bandStep(st, {at, w: at <= 20000 ? 300 : 270, goal: GOAL, since: 0});
    }
    assert.ok(st.mean > 283 && st.mean < 288, String(st.mean));
});



test('the constants: the marker 5 s into the phase; no snap and no prefill left', () => {
    assert.equal(B.MARKER_AFTER_S, 5);
    for (const gone of ['AVG_PREFILL_S', 'AVG_FROM_S', 'SNAP_PCT', 'SNAP_TAU_S']) {
        assert.equal(B[gone], undefined, gone);
    }
    const st = run(steady)[14];
    for (const gone of ['snap', 'ema', 'prefill']) {
        assert.equal(gone in st, false, gone);
    }
});
