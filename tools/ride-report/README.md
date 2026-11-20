# Paceline ride report

The standard analysis that runs on every Paceline ride recording (the `.jsonl` a rider exports or
uploads, or the `.jsonl.gz` the plan server stores; a gzip'd file is read as it is). It replaces the one-off scripts of earlier analyses: the same checks, in the same order,
for every ride, so two races can be compared. Not part of the mod (only `manifest.json`,
`README.md` and `pages/` are deployed). Plain Node 22, no dependencies; the replays use the mod's
own engine (`pages/src/engine/`), so they always show what the current engine would do.

```
node tools/ride-report/report.mjs <recording.jsonl[.gz]> [--plan <SIG>=<plan.json> ...] [--plan-all <SIG>=<plan.json>]
                                  [--out <dir>] [--names]
```

- `--plan SIG=file`: the plan for a plan code the recording only names. The head line holds only
  the plan at the start; when the plan changed mid-ride (a server plan after the start), the ticks
  carry the new code in `det.planSig`. The file may be the planner JSON, the plan server's stored
  form (`{json, text}`) or an engine plan; a code that differs from the file's own is used as given,
  with a note. Without it, the seconds under that code are skipped and counted.
- `--plan-all SIG=file`: judge every second by this plan (same file forms), the analysis view
  when the live plan was wrong (17 Nov: a wrong plan ran live for the first 18 minutes). The
  overview still lists the plan codes as they ran live, with times, and says how long another plan
  was live, so the wrong-plan period stays visible. The replay also runs with this plan.
- `--out`: where `report.md` and `report.json` go (default: `<recording>-report/` next to the
  recording, without `.jsonl` or `.jsonl.gz`).
- Riders are shown by plan position (`#1 … #n` of the plan active at the finish, `ICH (#k)` for the
  recorder, `<code>#k` for riders only in another plan, `B1 …` for the bench). `--names` adds the
  plan's first names and the file name: for local use only.

**From the plan server.** The operator page `/admin` → a club's **Recordings** offers each stored
recording and, per team and race day, **Download race**: a tar with the day's recordings, the plans
they name in the server's stored form (`plans/<SIG>.json`, for `--plan`), `MISSING-PLANS.txt` for
codes the server no longer has, and a `README.txt` with the report line of each recording. Unpack it
outside this repository (the reports land next to the recordings).

`report.md` has one section per check, each with a one-line verdict (German); `report.json` has the
same numbers. Times are race times from the roll-off (`+mm:ss`).

## The checks

Each check that needs the plan uses the plan active at that second. The race window runs from
the roll-off to the finish line (not to the start of finish mode). Pulls that start in finish mode
(the last 500 m, where the rotation and the countdown are muted by design) are listed apart and
left out of checks 2, 3 and 4. The gap check needs no such rule: finish mode turns it off.

1. **Overview**: team, event, mod version, plan codes over time, roll-off (the engine's start, else
   my first 10 km/h), finish line, duration, holes (> 3 s without fresh data of mine), riders
   recorded vs the riders of each plan, and what the recording lacks (older versions).
2. **Ground truth pulls**: per second the front rider is the plan rider (or I) with data ≤ 3 s old,
   draft ≤ 5 W, faster than 20 km/h, with another plan rider (data ≤ 10 s old) within 50 m (a
   dropped rider alone has no draft either), furthest along. Runs of ≥ 8 s (holes ≤ 4 s bridged, one
   rider's runs within 15 s merged) are pulls. A back-and-forth at the front (at least three runs
   alternating between the same two riders, each within 15 s of the one before, one of them under
   half the rider's plan pull, neither rider over twice his plan in all) is one swap turn: the
   runs stay in the list (they are who was in front each second, which checks 3 and 4 use), but
   each rider's runs in it count as one pull of their summed length, and the order check sees the
   two riders in plan order. Per rider the pull length minus the plan (median, by race third; the
   race's first pull left out), and each change against the plan order. Pull lengths are first to
   last tick, so a 30 s pull reads 29 s.
3. **Puller detection**: `det.puller` (live) and the current engine (replay) against the truth:
   agreement; lag at each change, measured to when the engine's naming of the new puller settled:
   the start of the run of ticks naming him that covers the middle of his pull, else the first run
   during his pull that holds 3 s (a brief naming the engine left again does not count; no limit
   backwards; a change across more than 15 s with nobody visible in front is not measurable);
   locks (a wrong puller held > 10 s while the front is someone
   else), climb/descent pauses and what followed. Not judged: the start lock (60 s), finish mode,
   pauses, riding alone, < 10 km/h. Replay fidelity per plan: when the front rider of the replay
   differs from the live one, the recording lacks riders the live engine saw, except with
   `--plan-all` where another plan was live: there the replay runs a different plan and is not
   comparable with live (the report says so). A run of ticks naming a puller ends at a hole of more
   than 3 s between ticks.
4. **Countdown to my pull** (`shown.act`): jumps ≥ 3 s per step, my recovery phases (my pull's end
   to my next start) against the plan's sum as the engine counts it (the others' pulls plus 10 s for
   each of them but the rider directly before me; riders > 100 m away left out, by their last row
   when they have none then; a rider never recorded counts) and the clock 3 s after
   my pull ended, the prediction error 240/120/60/30/10 s before my real start, READY lead, and
   when "pull" showed (the start of the "pull" display running at my real start, no limit
   backwards; else the first one within a minute after it).
5. **Gaps**: real gaps (smoothed ≥ 10 m, 15 m on a hill, for ≥ 5 s); warnings as shown
   (`det.gap`) and as the current engine gives them (replay), timed against the raw gap's 8 m,
   judged by what followed (important: the raw gap reached 10 m within 15 s; stable: it moved no
   more than 2 m in the 5 s before), closing excursions (who closed them), a drop counter per rider,
   and the critical drops in the last 500 m (muted by design, listed only). A "gap" the rider
   behind rode in full draft (median ≥ 50 W) is no gap: someone without data, or not in the plan,
   was in between; such gaps are listed apart and their warnings left out, unless a warning stays
   on into a real gap of the same rider (then it warned of that one). My own gap is not counted
   while my observed wheel (`det.wheelObs`, from the live chain) is a rider without rows: the gap
   to the next recorded rider ahead would be far too large. The drop counter in the last 500 m
   counts only the full warnings these rules keep.
6. **Finish**: finish mode on and off, what the engine still did after the line (puller changes,
   gap warnings), the end of the recording.
7. **Upload**: what `stripForUpload` would keep: it keeps the riders of the head line's plan, so
   the riders of a plan loaded mid-ride are lost.
8. **Countdown from every rider's view** (simulation): every plan rider with at least 5 pulls as
   "me", on the pulls of check 2 (a swap turn of mine is one pull), the clock computed each second
   with the old countdown model (to 0.3.0-beta.3: plan + 10 s for each rider between the puller and
   me, the puller at plan) and the engine's (`expectedPullS`: every rider plan + 10 s, the puller
   too, the rider directly before me at plan). Present are the riders who pulled between my last two
   pulls (before that the whole plan), as the live chain would have them. Per rider and in total:
   the error 180/120/60/30/10 s before each real start (a look before my previous pull's end has no
   value), the median of the absolute errors over −180…−30 s, how often the clock 10 s before
   said more than 3 s later than the real start, and the small downward jumps (−12…−3 s against the
   time passed). Judged from 5 min after the roll-off, or from when the last plan rider has rows
   (17 Nov with `--plan-all`: #1 and #2 only from +18 min), the race's first pull left out. Not what
   any window showed: no puller detection, presence grace or pauses. Reference:
   `docs/countdown-sim/team-clock.mjs` (same numbers per rider without swap turns and with its
   start).

## Limits

- The full-draft filter (check 5) is the report's own rule, not the engine's: an apparent gap of
  10 m or more that the rider behind rode with a median draft of 50 W or more (`DRAFT_KEEP_W`) is
  not counted as real, nor are its warnings. On 12 Nov the real gaps had 0–39 W, the ones left out
  50–137 W, so the boundary is close; each one left out is listed with its draft, and the gap
  counts without the filter are given too (`withoutDraftFilter`), to compare with older analyses.
- A recording that was uploaded is already stripped: riders of a later plan have no rows. The
  report says so; the truth cannot see them in front, gaps across them look too large, and the
  replay cannot follow where they were in front.
- The finish line comes from the event (`endDistance`); recordings before 0.2.13 logged no event,
  then the start of finish mode (500 m before the line) gives it to a few metres.
- Older recordings lack `det.gap`, `det.hill` and `det.routePos`: the shown warnings are unknown
  and the replay takes hills from the live grade, as the engine did then.
- A recording that starts mid-ride (the engine ran before the recorder) starts the replay without
  that history.

Tests: `node --test tests/ride-report.test.mjs` (a made-up ride, `tests/fixtures/ride-report/`).
