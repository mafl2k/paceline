# Paceline race reference

What really happened in a race, worked out from the recordings of several riders, so that an
engine's output can be judged against it. It is the reference the turn clocks are scored against: a
per-second picture of who rode at the front, who was in the group, how the changes went and what
the countdown to each rider's turn should have been. Not part of the mod (only `manifest.json`,
`README.md` and `pages/` are deployed). Plain Node 22, no dependencies. It builds on the ride
report (`tools/ride-report/`), which reads the recordings.

The rules in short (all of them, with the reasons, are in the design for the turn clocks, §1):

- **Front per second:** the ride report's ground-truth pulls of every recording, fused. Where two
  recordings disagree, that second is unknown; the agreement is reported.
- **In the group:** the largest cluster of plan riders with gaps up to 30 m and data up to 10 s
  old, from any recording. Dropped after 30 s outside it, back after 30 s inside.
- **Turns:** runs of at least 8 s of one front rider, holes up to 4 s bridged, the same rider
  within 60 s merged. A turn under 20 s that does not fit the line is an interjection (Störer): it
  is dropped and listed, with the median power of the interjector and of the rider whose turn runs on (W and % of plan).
- **Changes** against the line of the riders in the group: next, skip (the riders passed over sit
  out until they pull) and same are in order, back (the rider just before) is out of order.
- **Context per second:** start (first 120 s), end (last 20 min), climb (windows found from the
  altitude and distance of the recording whose recorder stayed in the group longest), else flat. After a climb is a flag, not a context.
- **Traffic:** riders outside the team in front of the team's front rider or inside the line, as
  the recording logged it; older recordings use the front team rider's draft as a stand-in. A
  recording counts only for the seconds its recorder is in the group. Every
  out-of-order change, interjection and disorder episode is marked team or traffic.
- **Per rider:** turns, median length against plan, power against plan, share of time in the
  group, when he was gone for good, times sat out, interjections, real gaps.
- **Reference countdown:** the plan-based time to each rider's next turn, from what had really
  happened up to then, in the line of the riders in the group without those who sit out after a skip
  until they pull.

Riders are plan positions `#k` (the order of the last known plan), never names or ids. `--names`
adds the plan's names to `reference.md` only; `reference.json` never has them.

## Build a reference

```
node tools/race-ref/race-ref.mjs <race folder | recording.jsonl[.gz] ...> [--plan <SIG>=<plan.json> ...]
                                 [--out <dir>] [--names]
```

- A **race folder** is what the plan server's **Download race** tar gives (`/admin`, a club's
  **Recordings**): the recordings (`*.jsonl`, `*.jsonl.gz`) and `plans/<SIG>.json`, which are read
  as `--plan <SIG>=<file>`. Other files and folders in it (`README.txt`, a ride report's folder) are
  ignored.
- Or give **recording files** and the plans they name with `--plan <SIG>=<file>` (planner JSON, the
  plan server's stored form or an engine plan, as for the ride report). A `--plan` on the command
  line adds to those of a folder.
- `--out`: where `reference.json` and `reference.md` go (default: `<folder>-reference` next to the
  folder, or `<recording name>-reference` next to the first recording).
- `reference.md` (German) has the overview with coverage and agreement, the changes by order and
  context, the interjections, the riders who dropped, the team and traffic marks and a table with
  the figures of every rider. `reference.json` is the same per second, with `t0` and `tEnd` of the
  common clock (ms), `planSig` (the code of the plan the positions `#k` come from) and the rider `figures`.

## Score an engine against it

```
node tools/race-ref/score.mjs <engine dir> <reference.json> <recording.jsonl[.gz]> [--plan <SIG>=<plan.json> ...]
```

Replays the recording through the engine in `<engine dir>` (a checkout of the mod, with
`pages/src/engine/`) and prints the score as JSON: puller shown right, stalls, my clock, the
countdown against the reference countdown, the display, the table. Run it once per recording of
the race, with the recorder's own file; any engine version can be compared on the same reference.
The riders are numbered by the plan the reference was built on (`planSig` in `reference.json`): the
recording or a `--plan` file must hold it, else the run stops and names the code. Give the race
folder's `plans/<SIG>.json` files as `--plan` whenever the recording does not carry its last plan.

To get an engine directory for an old version, from the repository:

```
git -C <repo> worktree add <dir> v0.2.13
# or, without a worktree:
mkdir <dir> && git -C <repo> archive v0.2.13 | tar -x -C <dir>
```

The current engine is the repository itself (`.`).

## Real data stays out of the repository

Recordings, plans, references and reports hold real riders. Unpack the race folder outside this
repository; the default output goes next to the input, never into the repository. Tests and
fixtures use made-up riders only.
