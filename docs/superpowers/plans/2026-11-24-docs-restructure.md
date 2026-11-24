# Docs restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the 900-line README into a short front page carried by picture sheets, with the full
reference (riders and captains) in `docs/guide.md`.

**Architecture:** A composer script builds sheet PNGs from the existing single window renders. The
reference text moves from `README.md` (and the captain-facing facts from `server/README.md`) into
`docs/guide.md`, maintainer text into `docs/development.md`; then `README.md` is rewritten short. A
docs test guards links, images, length and history notes.

**Tech Stack:** Markdown, Node 22 (`node --test`, global `WebSocket` for CDP), headless Chrome.

**Spec:** `docs/superpowers/specs/2026-11-24-docs-restructure-design.md` (read it first; every task
implements part of it).

Worktree: `paceline-docs` (next to the other worktrees), branch `docs-restructure` (based on
`readme-no-02`, which is based on local `next` 03d262f). Never switch branches, never push.

## Global Constraints

- `README.md` keeps its title line `# Paceline 0.3.5-beta.0` exactly (promote and `tests/version.test.mjs`).
- All links and image paths in `README.md` and `docs/*.md` are relative (`docs/guide.md`, `docs/images/…`; from inside `docs/`: `guide.md`, `images/…`, `../server/README.md`).
- Bold only for names of buttons, settings, windows and settings sections; plain sentences; no version history ("new in …", "before 0.x", "since 0.x"); wrapped at 100 columns (tables and `<img>` lines excepted).
- Made-up riders and clubs only (Alma, Ben, Cleo, Dana, Eli, Finn, Kettenfett RC, Rollers …); no real names.
- Riders no longer with the group are "dropped riders".
- No change to code under `pages/` or `server/` (except the one pointer line at the top of `server/README.md`), no `CHANGES.md` line.
- Sheet look: background `radial-gradient(120% 140% at 30% 0%, #2b3038 0%, #16181c 70%)`, windows at their CSS size (PNG pixels / 2) with `border-radius: 8px` and shadow `0 8px 24px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.06)`, 40 px between tiles, 28 px top padding, title 15 px weight 600 `#e8e8e8`, caption 12 px `#9aa1ab`, device scale 2, figure max-width 340 px.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A fact of the old README silently lost in the move → Task 3's fact check against `README.before.md` must list zero missing items (history items named in the spec excepted).
- A `see "X"` cross reference that no longer finds its target after the move → `tests/docs.test.mjs` "cross references resolve".
- A sheet that references a window PNG which was deleted or renamed → `tests/docs.test.mjs` "every sheet source exists".
- The README growing back into a manual → `tests/docs.test.mjs` "README stays short" (≤ 200 lines).
- A captain fact a captain needs (Lost link, 24 h, private club code, 30-minute gate) missing from the guide → Task 3 step checks these strings in `docs/guide.md`.

---

### Task 1: Sheet composer, sheets, docs test

**Files:**
- Create: `scripts/sheets.mjs`
- Create: `docs/images/sheet-defaults.png`, `sheet-before.png`, `sheet-gaps.png`, `sheet-info.png`, `sheet-captain.png`
- Delete: `docs/images/action-fields.png`, `docs/images/action-gap-early-green.png`, `docs/images/rest-gap-green.png` (after Task 4 no longer references them; delete in Task 4, see there)
- Create: `tests/docs.test.mjs`
- Modify: `package.json` (append `tests/docs.test.mjs` to the one-line test list)

**Interfaces:**
- Produces: `export const SHEETS` in `scripts/sheets.mjs`: `{[name]: {width: number, rows: Array<Array<{src: string, title: string, caption: string[], crop?: number}>>}}` where `src` is a file name in `docs/images/`, `caption` is one or two lines, `crop` the CSS height to cut a tall phone render to. Output file is `docs/images/sheet-<name>.png`.
- Produces: CLI `node scripts/sheets.mjs [--port 19701] [name …]` connects to a running headless Chrome with remote debugging on that port, renders the named sheets (all when none named) from an inline HTML template and writes the PNGs. Importing the module must not run the CLI (guard with `import.meta.url === pathToFileURL(process.argv[1]).href`).
- Produces: `tests/docs.test.mjs`, extended by Tasks 3 and 4.

- [ ] **Step 1: Write `tests/docs.test.mjs` with these tests**

```js
import {SHEETS} from '../scripts/sheets.mjs';
test('every sheet source exists', ...)        // each rows[][].src is a file in docs/images/
test('sheet captions have one or two lines', ...) // 1 <= caption.length <= 2, no line over 60 chars
test('the sheets are the five of the spec', ...)  // Object.keys(SHEETS) deep-equals
                                                   // ['defaults','before','gaps','info','captain']
                                                   // (plus 'signals' only if Task 2 adds it)
```

- [ ] **Step 2: Run it, expect FAIL** (`node --test tests/docs.test.mjs`: cannot find `scripts/sheets.mjs`)

- [ ] **Step 3: Write `scripts/sheets.mjs`**

`SHEETS` with exactly these tiles and captions (`/` separates the two lines):

| sheet (width) | src | title | caption |
|---|---|---|---|
| defaults (720) | action-rest.png | Recovery | #2: you pull next |
| | action-pull.png | Your pull | target · your power · seconds left / bar: green is within 5 % of your target |
| before (1000) | action-armed.png | READY | last 10 s: come up to your target / before the handover |
| | rest.png | Rest window | the countdown alone, / the Action window then shows your fields |
| | action-fields-clock.png | Recovery with fields | right: countdown and your place / ▲ GAP: you lost the wheel, close it |
| gaps (720), row 1 | action-gap-early.png | Pull · gap opening | ▼ 14 m: a gap opens behind you, / ease off a little |
| | action-gap.png | Pull · group lost your wheel | red: the team needs them, / ease off until the band is gone |
| gaps, row 2 | action-gap-green.png | Pull · gap closing | green: they are closing it themselves, / not urgent |
| | rest-gap.png | Recovery · you lost the wheel | ▲ GAP: your own gap, close it |
| info (800) | info.png | Info | Wheel: whose wheel you follow by the plan / Front: who pulls, seconds left |
| | info-captain.png | Info, captain mode | amber →: your wheel is gone, follow Dana / below the dashed line: dropped riders |
| captain (840) | captain-teams-390-light.png, crop 844 | Your club | next race and your teams / at a glance |
| | captain-team-390-light.png, crop 844 | Plans and races | LIVE: riders get this plan |
| | captain-cockpit-version-390-light.png, crop 844 | Make live | the rider table: / who has the plan |

Captain tiles are shown at 230 px wide (the 390 px render scaled), cropped to the first 844 CSS px
of the render (`object-fit: cover; object-position: top` on a box of 230 × 498). Template and CDP
client: port the scratchpad drafts (`sheet/make.mjs`, `sheet/shot.mjs` and the CDP helper) into this one file: open a target, set device metrics (width, scale 2), load the HTML as a `data:` URL or a temp file with `file://` image paths, wait for images (`document.images` all `complete`), size the height to `document.body` and capture.

- [ ] **Step 4: Run the test, expect PASS**

- [ ] **Step 5: Render** — start Chrome if none runs on the port (`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=19721 --user-data-dir=<scratch dir>` in the background), run `node scripts/sheets.mjs --port 19721`, open each PNG and check: every tile visible, captions not cut, captain phones cropped at the top of the page. Compare `sheet-defaults/before/gaps/info` with the approved drafts in the scratchpad `sheet/` folder (same content; only the captain caption reads "dropped riders").

- [ ] **Step 6: Add `tests/docs.test.mjs` to `package.json`'s test list, run `npm test`, expect all pass. Commit** (`scripts/sheets.mjs`, the five PNGs, the test, `package.json`).

### Task 2: "Countdown signals" sheet (only if the demo reaches the states)

**Files:**
- Create: `docs/images/signal-standing.png`, `signal-climb.png`, `signal-wheel.png`, `signal-correction.png` (those reached), `docs/images/sheet-signals.png`
- Modify: `scripts/sheets.mjs` (add `signals`), `tests/docs.test.mjs` (expected sheet names)

**Interfaces:**
- Consumes: `SHEETS` and the CLI from Task 1.

- [ ] **Step 1: Find each state in the demo.** Render the Action window (300×130, default settings, DEMO badge hidden) through the in-Sauce demo (`paceline:prefs:v1` `{serverOn:false, demoUntil: Date.now()+600000}`) with the scratchpad harness (`…/scratchpad/h/server.mjs`, `setup.mjs`, `tttStub()`; recording approach of `…/scratchpad/rs/record.mjs`). Watch for: the standing clock (`≥` in `#pl-act-cnum`'s text, `+NN` under it), the climb triangle `▲`, the wheel cue (`Wheel ■ …`), a correction (`… out −NNs` or `… back +…`). Record which appear within 10 demo minutes.
- [ ] **Step 2: If at least two states appear**, save them as `signal-*.png` (600×260 like the others), add the `signals` sheet (width 1000; titles: Waiting clock / Climb / Wheel cue / Correction; captions: "≥ 27s: the rider in front is over his plan, / +14 how much" · "▲: a real climb, rotation paused" · "the wheel to find, / in amber when not the plan's" · "ELI out −40s: your pull comes sooner"), render it, update the test's expected names. A state the demo cannot reach is reported, not faked.
- [ ] **Step 3: If fewer than two appear**, make no sheet; report which states were missing (Task 4 then gives each one line of README text).
- [ ] **Step 4: `npm test`, commit.**

### Task 3: `docs/guide.md`, `docs/development.md`, server pointer

**Files:**
- Create: `docs/guide.md`, `docs/development.md`
- Modify: `server/README.md` (one line at the top)
- Modify: `tests/docs.test.mjs`
- Scratch (not committed): `README.before.md` copy of the current `README.md`, and the fact-check script

**Interfaces:**
- Consumes: the sheet names from Tasks 1–2 (the guide refers to "the pictures on the front page" by heading, not by file).
- Produces: `docs/guide.md` headings that Task 4 links to: `## Loading the plan`, `## During the ride`, `## Your ride data`, `## For captains` (anchors `#loading-the-plan`, `#during-the-ride`, `#your-ride-data`, `#for-captains`).

- [ ] **Step 1: Add tests to `tests/docs.test.mjs`**

```js
test('relative links and images resolve', ...)  // in README.md, docs/guide.md, docs/development.md:
   // every ](path) and src="path" that is not http(s) or #anchor exists relative to that file
test('cross references resolve', ...)            // every see "X" in README.md and docs/guide.md:
   // X occurs at least twice across README.md + docs/guide.md (the reference and its target)
test('no version history', ...)                  // no /new in [0-9]|before 0\.[0-9]|since 0\.[0-9]/ in
   // README.md, docs/guide.md
test('guide has the captain facts', ...)         // docs/guide.md contains 'Lost link', '24 hours',
   // 'Plan on ZwiftGopher', 'Upload a file', 'Make live', '30 minutes'
```

- [ ] **Step 2: Run, expect FAIL** (no `docs/guide.md`).

- [ ] **Step 3: Write `docs/guide.md`.** Copy `README.md` to the scratchpad as `README.before.md` first. Move (not rewrite) every section of the current README from "Load the plan" to "Recordings upload" and the plan server section into the guide, ordered under the four produced headings plus a short table of contents at the top; `## During the ride` holds the Action window, fields while resting, the Rest window, gaps, wheel cue, climbs, when the order breaks, the Info window, how Paceline decides who pulls, demo, background, the recorder. The settings screenshots (`settings.png`, `settings-clubs-recordings.png`, `settings-action.png`) and their alt texts move along with paths changed to `images/…`. Where the old text describes the look of a window that a sheet now shows, replace that description with one sentence pointing to the pictures on the front page (`[the pictures](../README.md)`); keep every rule, threshold and timing. Use "dropped riders" for riders gone from the group. `## For captains`: task-led, 100–150 lines, built from `server/README.md` (the "Pages" part, "The 30-minute gate", "Private clubs", "ZwiftGopher push" captain-facing parts, "Recordings" captain view) in the order of the spec's captain part: what the plan server does; register (mail link, 24 hours, keep it, **Lost link**); the club hub and private clubs with the club code; add a team ("When does the team race?", start time); get a plan in (lead with **Plan on ZwiftGopher**, then **Upload a file**); store and **Make live**, versions, the rider table states; race day (30 minutes before the start); recordings (see and delete, not download). Captain screenshots in this part: `captain-cockpit-version-1280-light.png` and `captain-cockpit-store-390-light.png` with their existing alt texts. Leave out operator facts (mail setup, limits, data layout, deploy, configuration).

- [ ] **Step 4: Write `docs/development.md`** with "For developers" and "Releasing" from the README, unchanged except relative paths (`../`).

- [ ] **Step 5: Add to the top of `server/README.md`** (after its title) the line: `Captains: how to use the plan server is in [the guide](../docs/guide.md#for-captains). This file is for running and developing the server.`

- [ ] **Step 6: Fact check.** Script in the scratchpad: extract from `README.before.md` numbers with units, quoted strings and backtick spans (as `count.mjs` in the scratchpad did) and report every one missing from `docs/guide.md` + `docs/development.md`. Expected: none missing except the intro/install facts that stay in the README (Task 4 checks those) and the history items the spec names. Fix any other gap.

- [ ] **Step 7: Run `node --test tests/docs.test.mjs`** — the guide tests pass; "relative links" may still fail on README links until Task 4 (note which). **Commit.**

### Task 4: The short `README.md`

**Files:**
- Modify: `README.md` (rewrite)
- Delete: `docs/images/action-fields.png`, `docs/images/action-gap-early-green.png`, `docs/images/rest-gap-green.png`
- Modify: `tests/docs.test.mjs`

**Interfaces:**
- Consumes: sheet PNGs (Tasks 1–2), guide anchors (Task 3).

- [ ] **Step 1: Add tests**

```js
test('README stays short', ...)     // README.md has at most 200 lines
test('README title', ...)           // first heading line is exactly '# Paceline 0.3.5-beta.0'
test('every docs image is used', ...) // each docs/images/*.png is referenced by README.md,
   // docs/guide.md, server/README.md or a SHEETS src (banner.png, logo.png and the
   // *.html sources excepted)
```

- [ ] **Step 2: Run, expect FAIL** (README too long; three unused images still present).

- [ ] **Step 3: Rewrite `README.md`** in the spec's order (sections 1–10 of "README.md (front page)"): banner and title unchanged; two or three sentences on what Paceline is; `sheet-defaults.png`; heading "What the windows show" and the other rider sheets (and `sheet-signals.png` if Task 2 made it; otherwise one line each for the states it could not show); `## Install` (current steps, tightened; the store in two sentences); `## Before the race` (the five bullets of the spec); `## Your ride data` (leads with: Paceline works out who pulls from what Zwift sends; those rules can only be checked and improved against real races, and without riders' recordings Paceline can't get better; then the five facts; link to `docs/guide.md#your-ride-data`); `## For captains` (`sheet-captain.png`, the four numbered steps of the spec, link to `docs/guide.md#for-captains`); `## More` (link to the guide, Questions and bug reports with the GitHub Issues link); `## For developers` (one line to `docs/development.md`). Each sheet `<img src="docs/images/sheet-….png" width="<sheet width>" alt="…">` with an alt text naming every tile and its caption.

- [ ] **Step 4: Delete the three unused images.** Run the Task 3 fact check again, now against `README.md` + `docs/guide.md` + `docs/development.md`: nothing missing except the named history items.

- [ ] **Step 5: `npm test`, expect all pass. Check the rendered look:** open README and guide in a Markdown preview (or GitHub-like render) and confirm sheets show at their width and links go where they say. **Commit.**
