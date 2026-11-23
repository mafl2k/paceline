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
- The power bar's marker reacts at once to a real change and smooths small wobbles: a 10 % drop shows after about a second and is gone a second after you push back (before: still showing for 3 s, then creeping back); it glides between seconds.
- The Info window's lines start at its top edge instead of in the middle, so a taller window grows downwards.
- With "Fields while resting" on and no Rest window, the Action window shows two of your fields and the countdown as the third, your place under it, instead of only the big countdown; the Right setting says so.
- Recordings also note other riders near the team (anonymous: no name or Zwift ID), so the analysis can tell when other teams disturbed the line.
- The settings window has its own Recordings section right below Clubs: the upload box comes first, with one line on why and "What is sent" for the full text, then your rides; while the plan server is off it says uploads are paused (and can't be ticked). Advanced keeps only the server address and recording without a plan.
- Clubs is a compact table: one row per club with the teams you ride for there (for example "Cogs, Rollers") and the day you ticked it.
- The gap warning counts every rider behind the gap ("4 riders −12 m"), not only those up to the next gap; riders already let go are not counted.
- Climbs are known from the route profile before the start, on every lap of longer races too (a climb on the second lap is no longer missed). Their places follow Zwift's lead-in and lap length; a segment that runs over a climb (a KOM, for example) belongs to the climb, and flat parts of up to 1 km inside a climb, or before its descent, do not end it.
- Your pull clock keeps running when someone rolls by for a moment; if the last puller takes the front back, his turn simply goes on.
- With only two riders left, every change is a normal change: the clock starts when the rider comes to the front.
- A rider who sat out and comes back in his planned place takes over after 3 seconds, on a climb too: the countdown no longer stalls and then jumps.
- A rider out of turn at the front counts only after 20 seconds (the plan's next after 3); there is no more 'Order ≠ plan', the countdown goes on from the new puller.
- The rotation table keeps the plan order: a rider cut off behind a gap stays dim in his place (the first one with the gap in metres), and only riders gone from the group for 30 seconds move below the line.
- On a climb the rotation runs on until the order breaks (a rider out of turn in front, a gap of 15 m); then ▲ while the climb (and its descent) lasts, and after it the windows go quiet until the order is back: a rider pulling clearly and, before the last 20 minutes, the planned change after him.
- When the countdown comes back after a climb, the puller's clock counts from his current time at the front, not from a pull before the climb or before he dropped back.
- After a climb the planned change that brings the countdown back leaves out riders sitting out, as the rotation does.
- The countdown counts 10 seconds per rider again (5 for a pull over 40 seconds) instead of learning it during the race.
- On a climb ▲ starts for a gap only when it splits the group; a rider who has not joined since the start (behind the group or far ahead of it), or one already cut off, does not start it.
- On a climb ▲ also starts for a gap right behind a rider sitting out, when riders of the line are cut off behind him.
- A rider who takes the front while the start is still settling gets his pull clock from when he came to the front, not from the end of the start; he takes over only after his usual 3 or 20 seconds once the start has settled.
- Without route data a rise counts as a real climb only after 45 seconds; a shorter rise keeps the rotation going.
- When you start your pull ahead of riders who were due before you, they sit out until they pull and your countdown leaves them out; if the last puller takes the front back, they are back in the line.

### Server
- The privacy page says that recordings also hold anonymous rows of other riders near the team (no name or Zwift ID).
- The plan check names the teams whose current plan has the rider among its riders, so Paceline's Clubs table can show them.
- Removing a rider also removes him from the recorded changes at the front, so no recording names him there afterwards.

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
