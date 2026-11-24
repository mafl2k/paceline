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
- Adding a team asks "When does the team race?": every week, or on single dates (you choose the date and time when you store a plan). The team settings use the same words.
- Team page: opening a plan no longer draws a blue frame around the top of its card (Safari).
- The start page shows the hand-drawn Paceline banner as wide as the box below it, instead of the small square logo.
- Team page: says the team's name and the race time once. No breadcrumb and no rhythm line above the race; plans show their type alone ("fast", "Riders on 'fast' v3", "Same as v4"); the race line says "opens 19:07" without repeating the day. Version rows show only their number and status ("v3 · 3/6 have it", the LIVE tag at the end of the live one); an opened version's card says when it was stored, with the day, and "Live since …" or "Was live …" under its table; the card's line says only what the table is held against ("Against live v3"), the table marks the changes. Plans from ZwiftGopher read "Received 19:12". The list never moves: no button beside any row (Make live is in the card), and a plan not stored yet opens its Store form in the card under the rider table; there is no Undo any more (to go back, open the version that was live and make it live). A plan not stored yet has no Make live box: its card has Make live (stores and makes it live, and asks first only during the race window while another plan is live) and Store (stores only), for plans from ZwiftGopher and uploads alike. A version not live has Make live as its card's blue main button.
- Storing a plan as a new version keeps that plan's race as it is: the race date, start time and event link are asked only for a new plan, "Store as" lists the plans of every race ahead with their day, and the buttons read "Make live", "Store", "Discard" and "Upload a file" (the club page keeps Review and store and Discard on one line on a phone).
- On a computer the team page's head is one line: the team's name with "Updated 19:16" small beside it, then "Plan on ZwiftGopher", a bordered "Upload a file" and Team settings at the right, so the races start higher; the club page keeps "Review and store" and "Discard" together at the end of each new plan's row.
- Team page: a plan's card no longer has a "What happens" block. It ends with its rider table (and the Store form), then the buttons; only what needs attention shows as a line right above them: riders a switch moves from another team, a team left with a gap, a race that would have no live plan, no start time, a new event link, "Pick a plan.". Make live's question in the race window still says when riders get the plan.
- Team page: the ⋯ of a plan no longer has "New version", and the ⋯ of a race no longer has "Upload a file for this race": a new version comes from ZwiftGopher or "Upload a file", and a new plan's race is chosen when you store it. Links to the upload page you already have keep working.
- Add a team: the start time's hint ("In Europe/Berlin. You can set it later …") stands under the time field, as in the team settings.
- A race's start time is fixed when the race is made: the time you give, else the team's start time at that moment. Changing the team's start time later moves no race already planned ("Races already planned keep their time; change one in its ⋯."). The race's ⋯ and the Store form show the race's time, filled in and required; the hint "Empty: the team's start time" is gone. Races stored before keep following the team's time.
- Team page on a computer: one row under the team's name holds "Plan on ZwiftGopher" and "Upload a file" at the left and the plan's buttons at the right, above the card: Discard · Store · Make live for a plan not stored yet, Make live alone for a version, Make live always on the right. On narrower screens the buttons stay at the card's bottom in the same order, and on a phone "Plan on ZwiftGopher" and "Upload a file" sit side by side when they fit.
- Team page: once a race's riders are getting its plan, the live version's row says so with a second tag next to LIVE: "Sending" (blue) until the start, then "Started" (amber) until the race is over; the race line no longer repeats "open since 19:00" or "started". In "Over" the LIVE tag is grey.
- Team page: a plan without a type is called "Plan" (its heading in the list, its card "Riders on 'Plan' v4", "Against live 'Plan' v3", "Store as"); riders still see the team's name. A new plan's Type is filled in from the plan's own name: "Rollers slow" for the team Rollers gives "slow" (you can change or clear it before storing).
- Club settings and Team settings on a computer use the whole width like the team page: their boxes stand side by side in columns instead of one long column, at the same text and button size as the team page.
- Settings pages tidied: Team settings shows the team's name as its title; hints are one line, with "More" for the details; the ZwiftGopher link sits next to Delete team; Club settings lists the common time zones first, shows "Who gets your plans" only when private clubs are possible, and puts Remove a rider after the records.
- Team page: the list is in boxes, "Not stored yet" (headed like a race's line, above the race it belongs to) and each race ahead in a box of its own, and from 1180 px the first box starts on the card's top line; the live version's card shows its LIVE tag (or "Not sent") in its title instead of a "LIVE · riders get this" bar at its end.
- Team page on a computer: the question of Make live and of Discard opens under its button over the plan, so the plan and the list do not move and the button stays under the mouse.
- Team page on a computer: the message after Make live or Store floats over the plan with a close button (a clean one goes by itself after a few seconds), so the plan does not move.
- Team page on a phone: the message after Make live or Store sits under the plan's title (the sheet's title and its close button stay on top) with a close button of its own; it no longer goes by itself there.
- Team page on a computer: the buttons on the row under the team's name (Plan on ZwiftGopher, Upload a file, Discard, Store, Make live) all have one size.
- Team page: a later race no longer has a "Live plan and riders" fold; its warnings stand in its box, and its live row opens the riders in the card.

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
