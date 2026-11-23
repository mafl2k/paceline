# Changes

What changed in Paceline, for the release notes of GitHub, GitLab and the Sauce mod store.

**Adding a line:** put one plain line under `## Unreleased` for every change a rider or a team
captain can notice, under `### Mod` (the Sauce mod) or `### Server` (the plan server). Write it
as the effect, not the commit ("Windows are invisible outside a TTT"), with made-up names only:
this file is public and the promote job refuses notes with names that must stay private. Skip
what nobody sees (tests, refactors, CI).

**Releasing:** the manual `promote` job on `next` renames `## Unreleased` to
`## <version> (<date>)` (the mod's version when the mod changed, else the server's) and starts a
new, empty one. A mod release without `### Mod` lines is refused. A hotfix on `main` adds its own
`## <version> (<date>)` section by hand. The notes of a version are its `### Mod` lines for the mod
store and both parts for the GitHub and GitLab releases (`node scripts/changes.mjs notes <version>`).

## Unreleased

### Mod
- The Info window's lines start at its top edge instead of in the middle, so a taller window grows downwards.
- With "Fields while resting" on and no Rest window, the Action window shows two of your fields and the countdown as the third, your place under it, instead of only the big countdown; the Right setting says so.
- Recordings also note other riders near the team (anonymous: no name or Zwift ID), so the analysis can tell when other teams disturbed the line.
- The settings window has its own Recordings section right below Clubs: the upload box comes first, with one line on why and "What is sent" for the full text, then your rides; while the plan server is off it says uploads are paused (and can't be ticked). Advanced keeps only the server address and recording without a plan.
- Clubs is a compact table: one row per club with the teams you ride for there (for example "Cogs, Rollers") and the day you ticked it.

### Server
- The privacy page says that recordings also hold anonymous rows of other riders near the team (no name or Zwift ID).
- The plan check names the teams whose current plan has the rider among its riders, so Paceline's Clubs table can show them.

## 0.3.4 (2026-11-22)

### Mod
- Chaos counter: when the order in the line breaks (riders drop, swap or sit out), the countdown goes quiet, the Info window says "Order ≠ plan", and the Rest window shows a dim `≠` instead of a countdown.
- The countdown counts how much longer your team's turns take than planned. Paceline learns it during the race (from 2 minutes after the roll-off); until then it counts 10 seconds per rider, 5 seconds for a pull over 40 seconds.
- A hand-over detector: it sees the puller ease off and the next rider come out of the draft, so the line follows the real order.
- Big narrow numbers in the Action and Rest windows (Sauce's own font); they use the whole height of the window, and the Rest clock fills it.
- New Action window option "Smaller middle field", on by default.
- New Action window option "Fields while resting": three fields (power, draft, speed, cadence, heart rate, grade) while a Rest window is open.
- Recovery fields say "power" and "draft" instead of "now" and "W".
- The gap band under your power shows in chaos too, and follows the Rest window's urgency colours.
- Action, Rest and Info are invisible outside a TTT event, background included. Click where one sits to open its settings, or press Start demo to see them all.
- A pull ends against your own target (the median of 3 riders), with an Undo and no back-hold against you.
- The plan server is asked less often after failed checks (10, 20, 40, then 60 seconds).
- A failed event lookup never ends a race that runs, and a second race in one session starts fresh.
- Closing a window releases what it held, so the other windows take over at once.
- An ended plan from a file is no plan while the plan server is on.
- The overlay reloads the plan for the plan-server setting it was loaded with.
- The settings list shows an overlay's upload at once.
- The Paceline logo and a banner for the Sauce mod store and the README.

### Server
- Races: every weekly team has its own race day, and a team can have several races ahead, each with its own live plan, date, time and event link.
- The team page is the team cockpit: the list of races and plans, one panel per pick, Make live and Undo, and Store a plan right in the row (on phones the panel is a sheet).
- A rider table with each rider's state and the plan version they hold, marked against the race's live version.
- Every version of a plan has its plan's type (weekly or special); the server writes a backup before it converts an older database.
- A plan stored as a version keeps its plan's type.
- The start page shows the Paceline logo; every page has a favicon and a touch icon.
- Plan and version are named in every Make live text, and a race that is over takes no new plan.
- Start times: the Store form's start time is prefilled, a team's weekly time never ends a race that has its own time, and a past date says the race is over.
- Dropped riders are listed at the end of the rider table, in their old order.
- Team settings: race day and start time in one card with one Save.
- Store form: the race date, start time and event link sit in a fold at the bottom, closed; its line names the race the plan joins, and it opens by itself for a special-date team or when the date needs a look.
