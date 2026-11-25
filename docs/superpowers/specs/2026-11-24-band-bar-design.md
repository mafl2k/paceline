# Band bar in the Action window (design)

Date: 24 Nov 2026. Decided by the user over a day of rides and comparisons in the Bar test window
(branch `bar-workout`, `pages/src/engine/barfilters.mjs` there is the reference implementation).

## Why

The power bar's marker was one filtered value that had to be quick and calm at once, and was
neither ("jumpy and late"). Zwift's power is already 1-2 s late, and the number above the bar shows
"now". So the bar no longer tries to show now: it shows where the rider has been, as a band (the
range) and the average (the trend). "This bar is so far the best of all. The band is not critical if
jumpy, and the pointer is stable."

## What the rider sees

Final state after the replay of the 22 Nov race (user, 25 Nov 2026); the late changes are listed at
the end of "Approaches considered".

- **Band:** a soft white band, the plain min and max of my last 10 seconds ("take 10s band", the
  average's span, so the average and the shadow always sit inside it) of my de-spiked power (median
  of the last 3 samples, so a gear change's single dip never shows). It is continuous: it runs all
  the time, through READY into the pull, and never starts over at a phase change ("the band resets
  after the switch" was wrong); only a data gap clears it. It is shown in READY and the pull only.
  Both edges go through a 1 s first-order lowpass, so the band glides instead of jumping.
- **Shadow:** inside the band a soft shadow at my de-spiked power now ("the shadow band replaces it
  perfectly"), kept inside the drawn edges, gliding like them. It is what shows where I am while
  there is no marker.
- **Red ends, log scale:** green and amber are linear; each red end covers 10 % to 30 % off the
  target on a log scale ("should we make the bar logarithmic? I meant the ends"), so a surge or the
  draft in READY shows how far out it is instead of sitting at the end.
- **Pointer (my pull only):** the big marker the bar had (12 px, 3 px dark border, 5 px over the bar
  above and below), standing at my **average of the last 10 seconds**, counting only the pull's own
  seconds (of the same de-spiked power): the average runs from the pull's first sample ("begin with
  the avg as we get it"), no prefill, no snap marker. It shows from **5 s into the pull** ("I would
  hide the avg until 5 sec in"), in the zone colour of that average (green within 5 % of the target,
  amber within 10 %, red beyond; the colour holds 1 % past an edge so it does not flicker). Centred
  on its value, kept inside the bar at the ends. Before that the bar shows the band and its shadow
  only.
- **READY** (the last 10 s before my pull, and the armed start pen): the band and its shadow, **no
  marker** (a white READY marker "pops up shortly at the beginning"; below target is right in the
  draft). READY turning into the pull starts the pull's average fresh; the band runs on.
- **No target tick.** The green field is the target.
- **Numbers (new option, off by default):** "Numbers on the power bar". Each red and amber field
  shows the edge it shares towards the middle, inside its own field, against that edge: at a 200 W
  target `180` (red, left) `190` (amber, left) `210` (amber, right) `220` (red, right). No unit. The
  unit follows the window's target unit (Pull target W or W/kg): watts rounded to 10, W/kg rounded to
  0.1 (target 3.0 W/kg: `2.7 2.9 3.2 3.3`, by the same weight the bar uses).
- **The "now" number** above the bar is unchanged (raw, or 5 s with "5 s smoothed power"). Its
  colour during the pull is the pointer's zone once the pointer shows; before that, and in READY,
  it has no colour.
- **No power for POWER_KEEP_MS** (Zwift stopped): no band, no shadow, no pointer; it starts over with
  the next sample, as the marker did.

## Approaches considered (in the Bar test, all on real or made-up 1 Hz power)

- Single marker filters (old median 5 + smoothing + deadband; snap; light; raw): too late or too
  jumpy. Dropped.
- Band 10 s + a "now" line; snap + 1 s lowpass line: the line was 5-6 s behind the pedals. Dropped.
- Band 10 s: reacts in 2 s but holds the old power 10 s. Band 5 s: clears in 5 s. **Kept, with a
  1 s lowpass on its edges.**
- Snap bands (let go of the old power on a change over 5 %): "the snap always collapses to a value
  and begins new". Dropped.
- Pointer: 10 s average vs snap 5 s + lowpass: "the pointer is perfect with avg 10". **Kept.**
- Pointer size: the small 8 px one inside the bar vs the old big one: "the big one". **Kept.**
- Start of a phase, first design (24 Nov 2026: "at READY we start with the current state, snap 5 s,
  and after 3 or 5 s we begin with average and band"): a white snap marker at my current power,
  then the average 5 s in, prefilled with the median of seconds 3 to 5; READY the same with a white
  marker. Built, then replaced after replaying the 22 Nov race (25 Nov 2026):
  - "drop the pointer... begin with the avg as we get it": no snap marker, no prefill; the average
    runs from the phase's first sample.
  - "I would hide the avg until 5 sec in": the marker shows 5 s into the pull, not before.
  - "the shadow band replaces it perfectly": a shadow at my power now inside the band shows where I
    am meanwhile.
  - READY has no marker at all (its white marker "pops up shortly at the beginning"), only the band
    and its shadow.
  - "take 10s band": the band covers the last 10 s instead of 5 s, the average's span, so the
    average and the shadow always sit inside it. Band 5 s (above) is replaced by this.

## Out of scope

- The Bar test window stays on `bar-workout` (a test tool), as does its workout goal.
- The Rest window's bar behaves the same as the Action window's (same code, same markup); the
  numbers option lives with the Action window's options.
- Recording: what the windows showed keeps its fields; `pos` becomes the pointer's position and
  `meanW` the average the pointer shows (none in READY and the pull's first 5 s).
