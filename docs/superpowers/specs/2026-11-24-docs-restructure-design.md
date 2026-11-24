# Docs restructure: a short README with picture sheets, one guide

## Why

The README has grown to about 900 lines of reference text. A rider who opens the project page
should see at a glance what Paceline shows and how to get going. The details stay available, one
click away, for whoever wants them. Captains should find the plan server on the same page; today
the captain pages are described only inside the 1,800-line `server/README.md`, mixed with
operation and development.

## Goals

- `README.md` is the front page for riders and captains: what Paceline is, pictures that show what
  the windows and the captain pages show, install, and the few things a rider or captain must know
  that a picture cannot show. Target: about 170 lines.
- The pictures carry the explanation of the windows. Text in the README does not repeat what a
  picture already shows.
- `docs/guide.md` holds the full reference for everyone: every function and rule for riders, and a
  part for captains using the plan server.
- `server/README.md` stays the reference for running and developing the server.

## Non-goals

- No change to code, behaviour or UI texts.
- No rewrite of `server/README.md` beyond a pointer to the guide's captain part at its top.
- No automation of the window renders themselves (they come from the demo, as before).

## Anti-goals (a failure even if it looks fine)

- A fact a rider needs disappears: every fact of the current README must end up either in a
  picture, in the README text, or in `docs/guide.md`. The same for the captain facts of the
  "Pages" part of `server/README.md` that a captain needs.
- The README still reads like a reference manual.
- Version history comes back ("new in …", "before 0.x"): the previous wording pass removed it.
- Real names in any picture or text (made-up riders and clubs only; the public export checks this).

## Constraints

- `README.md` must keep its title line `# Paceline <version>`: `scripts/promote.mjs` and
  `tests/version.test.mjs` set and check it.
- `README.md` is a mod file: a change to it counts as a mod change for CI (`.gitlab-ci.yml` mod
  paths) and for `promote`. `docs/` is not. Moving the reference into `docs/` means later guide
  edits no longer build a mod zip. The captain part of the README does: a change there (for example
  a new captain sheet after the server pages change) builds a mod zip with no mod change. Accepted
  by the user.
- `README.md` goes into the mod zip (`scripts/zip.sh`) and into the deployed mod folder; `docs/` does
  not. Links from the README to the guides stay relative (`docs/guide.md`), like the pictures
  (my call): GitHub resolves them on the branch being viewed, so the public `beta` branch (mirrored
  from `next`) shows the beta guide and `main` the release guide, with no rewrite in `promote`.
  In the zip copy the links don't resolve, as the pictures don't today; nobody reads the README
  there.
- `docs/` is part of the public GitHub copy (`scripts/export-public.sh`; only `.public-exclude`
  paths are left out). This design doc is public too.
- Style of the previous wording pass stays: plain sentences, bold only for names of buttons,
  settings and windows, no version history, wrapped at 100 columns.

## Approaches considered

1. **Composite sheets plus short text (chosen).** A few pictures, each a sheet of several window
   states on a dark background with a title and a one- or two-line caption burned in. The README
   shows the sheets; the text covers only what pictures cannot. Calm page, one glance shows what
   the windows can do. Cost: wording changes in captions need a re-render; captions are not
   selectable or translatable; alt texts must describe a whole sheet.
2. Individual screenshots in rows with markdown captions (today's README). Easy to edit, but 17
   floating pictures, and the captions repeat what the text says.
3. One long README with collapsible `<details>` sections. Keeps one file, but the page still
   reads as a manual and GitHub's folds hide content from search.

The user picked 1, after seeing drafts, and asked to put the captain part on the same page, as a
picture sheet with a few steps, instead of a separate captain guide.

## The pictures

Four rider sheets, as drafted and approved in the conversation (drafts and the composer script
are in the session scratchpad: `sheet/make.mjs`, `sheet/shot.mjs`), and one captain sheet:

1. `sheet-defaults.png`: Recovery (`action-rest.png`), Your pull (`action-pull.png`).
2. `sheet-before.png`: READY (`action-armed.png`), Rest window (`rest.png`), Recovery with fields
   (`action-fields-clock.png`).
3. `sheet-gaps.png`, 2×2: Pull · gap opening (`action-gap-early.png`), Pull · group lost your wheel
   (`action-gap.png`), Pull · gap closing (`action-gap-green.png`), Recovery · you lost the wheel
   (`rest-gap.png`).
4. `sheet-info.png`: Info (`info.png`), Info, captain mode (`info-captain.png`).
5. `sheet-captain.png`: three phone screens (390 px wide, from the existing renders, cropped to
   their first screen of 844 px where they are taller, shown at about 230 px each) side by side:
   the club hub (`captain-teams-390-light.png`), the team page with its plans and LIVE
   (`captain-team-390-light.png`), and a picked version with **Make live** and its rider table
   (`captain-cockpit-version-390-light.png`). Same look as the rider sheets.

Look: dark radial background (`#2b3038` → `#16181c`), windows at their real size with rounded
corners and a soft shadow, 40 px between tiles, a bold title and a grey caption centred under each
window, rendered at device scale 2. Titles in the gap sheet name the mode (Pull, Recovery).
Captions explain only what a rider cannot read off the window (what a symbol, a colour or a number
means, and what to do), with wording taken from the current README:

| Tile | Caption |
|---|---|
| Recovery | #2: you pull next |
| Your pull | target · your power · seconds left / bar: green is within 5 % of your target |
| READY | last 10 s: come up to your target / before the handover |
| Rest window | the countdown alone, / the Action window then shows your fields |
| Recovery with fields | right: countdown and your place / ▲ GAP: you lost the wheel, close it |
| Pull · gap opening | ▼ 14 m: a gap opens behind you, / ease off a little |
| Pull · group lost your wheel | red: the team needs them, / ease off until the band is gone |
| Pull · gap closing | green: they are closing it themselves, / not urgent |
| Recovery · you lost the wheel | ▲ GAP: your own gap, close it |
| Info | Wheel: whose wheel you follow by the plan / Front: who pulls, seconds left |
| Info, captain mode | amber →: your wheel is gone, follow Dana / below the dashed line: dropped riders |

Captain sheet captions follow the same rule (only what is not obvious; builder's wording within
this sense): Your club (next race, your teams at a glance), Plans and races (LIVE: riders get this
plan), Make live (who has the plan).

**Optional extra rider sheet, "Countdown signals"** (builder's call, only if the demo reaches these
states): the standing clock (`≥27s` dimmed, `+14` under it), a climb (`▲`), the wheel cue
(`Wheel ■ DANA`) and a correction (`ELI out −40s`). If the demo cannot produce a state, that signal
gets one line of README text instead.

The composer script goes into the repo as `scripts/sheets.mjs` (with its HTML template inline), so
a sheet can be rebuilt after a re-render or a caption change. It reads the single window PNGs from
`docs/images/` and writes `docs/images/sheet-*.png`; it needs a headless Chrome with remote
debugging, like the screenshot harness described in `CLAUDE.md`. The single window PNGs stay as its
input. Pictures no longer used anywhere (`action-fields.png`, `action-gap-early-green.png`,
`rest-gap-green.png`) are deleted.

Each sheet gets an alt text that names every tile and what it shows.

Wording: riders who are no longer with the group are "dropped riders" (the user's term), in captions,
alt texts and the guide, instead of "riders gone from the group".

## README.md (front page)

In this order:

1. Banner and title line (unchanged).
2. Two or three sentences: what Paceline is (TTT plan in the ride: who pulls, your countdown, your
   pull target; records the ride for the team's analysis), and that plans come from the ZwiftGopher
   planner via your captain.
3. `sheet-defaults.png`.
4. The other rider sheets (`sheet-before`, `sheet-gaps`, `sheet-info`, and "Countdown signals" if
   built), with no text between them beyond a short heading.
5. **Install**: the current numbered steps, tightened (folder, zip, check `manifest.json`,
   restart, Enable Now, add the windows). The mod store paragraph shrinks to two sentences.
6. **Before the race**, only what pictures cannot show:
   - Your club is ticked under **Clubs** in the settings; the plan arrives by itself in the race.
   - Check the plan code with your team.
   - The windows are invisible outside a TTT; **Start demo** in the settings shows them for
     placing and sizing.
   - The windows catch mouse clicks: put them where you never click.
   - **Captain mode** in the Info window's settings for the rotation table.
7. **Your ride data**, short, and it leads with the why (the user's words: "we need the data to
   analyse the ride to develop the plugin. It doesn't work without that data"): Paceline works out
   who pulls from what Zwift sends, and the rules for that can only be checked and improved
   against real races; without riders' recordings Paceline can't get better. Then the facts:
   Paceline records the ride on your computer; tick **Upload my recordings after each ride** to
   send it; only the Paceline operator opens it; heart rate and cadence are never uploaded;
   deleted after 90 days. Link to the guide for "What is sent" and the full reasons.
8. **For captains**: `sheet-captain.png`, then about four numbered steps: register your club on
   the plan server (`https://ttt.mafl.net`; the link comes by mail, keep it); add a team and say
   when it races; **Plan on ZwiftGopher** sends the plan to the team page (or **Upload a file**);
   **Make live**, and riders get it 30 minutes before the start. A link to the guide's captain
   part for the rest.
9. Links: the guide, questions and bug reports.
10. **For developers**: one line pointing to `docs/development.md`.

## docs/guide.md (the reference)

The full content of today's README, restructured as a reference with a short table of contents:
loading plans (clubs, private clubs, when Paceline checks, two clubs, the ride lock, pull targets,
file plans), the Action window (countdown rules, READY, the pull and the power bar, the smaller
middle field), fields while resting, the Rest window, gaps (thresholds and the early stage),
wheel cue, climbs and descents, when the order breaks, the Info window, how Paceline decides who
pulls, the demo, the background and appearance settings, the recorder, why we ask for ride data,
after the ride, recordings upload, plan server addresses and betas. The settings screenshots
(`settings.png`, `settings-clubs-recordings.png`, `settings-action.png`) move here.

Text is moved, not rewritten: the wording pass just finished. Where a sheet now shows something,
the guide refers to the sheet in the README instead of describing the look again; the rules
(thresholds, timings) stay in full.

### The captain part of docs/guide.md

Its own part at the end of the guide, task-led, about 100–150 lines, for captains using the plan
server's web pages. It holds what the README's four steps and the captain sheet leave out:

1. What the plan server does for your club (plans to riders at the race, who has the plan).
2. Register your club: the mail link, open it within 24 hours, keep it, **Lost link**.
3. The club hub: next race, teams, club settings; private clubs and the club code.
4. Add a team: "When does the team race?" (every week or single dates), start time.
5. Get a plan in: lead with **Plan on ZwiftGopher** (the push works end to end, the user confirmed
   on 24 Nov 2026), with **Upload a file** as the other way.
6. Store a plan and make it live; versions; the rider table (who has the plan, who is in the event).
7. Race day: the plan opens 30 minutes before the start; what riders see.
8. Recordings: you see that a recording arrived and can delete it, not download it.

Source: the "Pages" part and the related sections of `server/README.md` (club hub, team page,
store form, races, the 30-minute gate, private clubs, ZwiftGopher push, recordings). Captain
screenshots: a small set from the existing ones (club hub, team page at phone width, a version at
1280 px, the Store sheet), beyond the three on the README's captain sheet; no new renders
required. Facts that matter only to operators (mail setup, limits, data layout, deploy) stay out.

`server/README.md` gets one line at its top pointing captains to the guide's captain part.

## docs/development.md

"For developers" and "Releasing" from today's README, moved unchanged.

## Checks

- Every fact of the current README is in a picture, the README or `docs/guide.md`: a scripted check
  of numbers with units, quoted UI strings and backtick spans, as in the wording pass.
- `npm test` passes (README title, promote, export check).
- No line over 100 columns outside tables and `<img>` tags; links work on GitHub (all relative).
- No real names: made-up riders and clubs only.

## Settled after the builder check

- Links: relative (see Constraints), my call.
- `readme-no-02` (the README without 0.1/0.2 notes, not merged yet) is the base of this branch and
  goes into `next` with it; the fact check compares against that README.
- The captain part describes the plan server pages as on `next` (server 0.5, the team page in the
  captain screenshots): the guide becomes public on `main` with the promote that releases them.
- No `CHANGES.md` line: documentation only (my call).
- No separate `docs/captain.md`: the captain part goes into the README (sheet and four steps) and
  the guide (details). The user's decision.

## Left to the builder

- Exact README wording within the outline above.
- Whether the fifth sheet is reachable in the demo.
- The guide's section order and table of contents.
- Which captain screenshots in the guide, within the four named.
- The captain sheet's exact captions, within the sense given above.
