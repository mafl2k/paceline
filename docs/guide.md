# Paceline guide

Everything Paceline does, for riders and for captains. The [front page](../README.md) shows the
windows in pictures and has the install steps.

- [Loading the plan](#loading-the-plan): [Clubs](#clubs),
  [When Paceline checks](#when-paceline-checks),
  [Two clubs and the teammates in the pen](#two-clubs-and-the-teammates-in-the-pen),
  [The ride lock](#the-ride-lock), [Pull targets from the plan](#pull-targets-from-the-plan),
  [Load a plan from a file instead](#load-a-plan-from-a-file-instead), [Plan server](#plan-server)
- [During the ride](#during-the-ride): [Paceline Action](#paceline-action),
  [Fields while resting](#fields-while-resting), [Paceline Rest](#paceline-rest),
  [A gap in the line](#a-gap-in-the-line), [Wheel cue](#wheel-cue),
  [Rollers and real climbs](#rollers-and-real-climbs),
  [When the order breaks](#when-the-order-breaks), [Paceline Info](#paceline-info),
  [How Paceline decides who pulls](#how-paceline-decides-who-pulls), [Demo](#demo),
  [Background and appearance](#background-and-appearance), [Recorder](#recorder)
- [Your ride data](#your-ride-data):
  [Why we ask for your ride data](#why-we-ask-for-your-ride-data),
  [After the ride](#after-the-ride), [Recordings upload](#recordings-upload)
- [For captains](#for-captains): [Register your club](#register-your-club),
  [Your club](#your-club), [Add a team](#add-a-team), [Get a plan in](#get-a-plan-in),
  [Store a plan and make it live](#store-a-plan-and-make-it-live), [Race day](#race-day),
  [Recordings](#recordings)

## Loading the plan

Nothing to load by hand: your captain uploads the plan to the plan server for your club, and
Paceline gets it when you are in the race.

1. Click a Paceline window to open the Paceline settings window. Outside a TTT event the window is
   invisible: click where it sits, or right-click it and press the tune icon in Sauce's title bar.
2. Under **Clubs**, check that your club is ticked. The first time, Paceline asks the plan server
   which clubs list your Zwift ID (Zwift must have run once, so Paceline knows it), and ticks the
   first club that lists you by itself. If the table says "No club lists you yet. Your Zwift ID is
   …: send it to your captain.", do that.
3. Under **Plan**, a line says what waits for you, for example "Next: Rollers fast, Thu 19 Nov
   19:30". That is the next race with a plan listing you, in a club you ticked.
4. In the race the plan arrives by itself. The status line then says "Rollers fast · F9E98R ·
   Kettenfett RC · checked 19:02" (plan, plan code, club, last check) and the plan shows under
   **Plan**. Check the plan code as described below.

<img src="images/settings.png" width="420" alt="Paceline settings, the Plan part for all windows: Get plans from the plan server, ticked, with the line what Paceline sends; the status line Rollers fast · F9E98R · Kettenfett RC · checked 19:02; Next: Rollers fast, Thu 19 Nov 19:30; the plan with its code and six riders, Ben highlighted; Load a plan from a file instead, collapsed">

*The settings window below "All Paceline windows": the plan server box with what Paceline sends,
and the server plan of Kettenfett RC with its code and riders. Made-up clubs and riders.*

### Clubs

The Clubs table lists the clubs whose plans have your Zwift ID. Paceline takes plans only from
ticked clubs. Tick the club you ride for, and leave a club you don't know unticked.

<img src="images/settings-clubs-recordings.png" width="420" alt="Below the plan: the Clubs table with the columns Club, Your teams and Since: Kettenfett RC ticked, Cogs, Rollers, 12 Nov; Kettenfett Masters ticked, a dash, 24 Oct; Spokesmen CC unticked, Spokes; Add club by code; then Recordings: Upload my recordings after each ride, ticked, the line why, What is sent, collapsed, and three rides (uploaded; waiting for upload · plan server not reachable; not sent automatically) with Upload, Export and Delete; Demo; Pull target W/kg; Advanced, collapsed">

*Clubs and Recordings in the settings window. Made-up clubs and teams.*

- One row per club. **Your teams** names the teams of that club whose current plan has you among its
  riders, for example "Cogs, Rollers". It shows "lists you" when a plan has you only on the bench
  (the planner's roster), or with a plan server older than 0.5.1. A dim "–" means that no current
  plan of the club lists you. **Since** is the day you ticked the club.
- Only the first club is ticked by itself, and only while the table is empty. Clubs that come later
  show up unticked and have no effect until you tick them. If two clubs list you at once, none is
  ticked and the table says "Several clubs list you. Tick yours." In a race, Paceline ticks the club
  that has the plan for it.
- Ticking and unticking apply at once, also during a ride.
- A club can be private. The plan server then doesn't show it to anyone without its code, and it is
  never ticked by itself. Your captain gives you the code (10 letters and digits, like
  `7Q4MZ-2KX9B`). Type it under **Add club by code** and press **Add**. Case, spaces and hyphens
  don't matter. The club is then added and ticked, and its row shows "private · code 7Q4MZ-2KX9B",
  so you can pass the code on to a teammate. Messages:
  - "A club code has 10 letters and digits.": a typo.
  - "No club has this code. Check it with your captain.": nothing is stored.
  - "Too many wrong codes from your network. Try again in an hour."
  - "this code no longer works: ask your captain for the new one" in the row: the captain made a
    new code.
  - "private now: enter its code below" in the row: an open club you ticked became private.

### When Paceline checks

Under **Get plans from the plan server** the settings window says what goes to the server:

> When you are in a Zwift event, and when you open these settings, Paceline sends the plan server
> your Zwift ID, the clubs you ticked, the codes of private clubs you added, your event's start
> time and id, your plan code and the Paceline version. A club you ticked sees when you last
> checked.

- In a Zwift event, a Paceline window must be open. One of them asks the server at once when the
  event begins, then every 10 seconds while there is no plan for this event yet, else every minute.
  When the server does not answer properly (it is busy, or unreachable), Paceline waits longer after
  each failed check: 10, 20, 40, then 60 seconds. With **Only during TTT events** (the default) only
  a TTT counts. Unticked, any Zwift event does. A team ride outside any Zwift event gets no plan
  from the server, so load the file (see "Load a plan from a file instead").
- The server sends a plan only from 30 minutes before the team's start time that the captain set.
  Until then the Info window and the settings say "Plan opens 19:00 · Rollers fast". Paceline keeps
  checking every 10 seconds, so the plan arrives within 10 seconds after that time.
- When the settings window opens, it checks once. That fills the Clubs table and the "Next:" line,
  but never makes a plan active.
- Nothing else checks. Outside events, and with the settings window closed, Paceline doesn't ask the
  server at all.
- A server plan from an earlier race is not shown in a new event until this event's answer has
  arrived. When the server has no plan for you in this race, the settings say "No plan for you in
  this race yet." The old server plan then goes away, unless the ride lock holds it (see "The ride
  lock").
- When the captain uploads a changed plan, Paceline switches to it within a minute, also during
  the race (the rider pulling keeps his clock).
- If the server cannot be reached, Paceline keeps the plan it has. The settings window shows the
  error, the overlay windows do not. If that lasts, load the files yourself (see "Load a plan from a
  file instead").
- When a club you haven't ticked has a plan for you in this race and no ticked club has one, the
  Info window says, once per club, "Spokesmen CC has a plan for you in this race. Click, then
  tick it under Clubs."

### Two clubs and the teammates in the pen

If two clubs you ticked both have a plan with you as a rider in the same race, the teammates near
you decide. You don't pick. For each plan Paceline counts its riders (not the planner's roster) in
Sauce's list of riders near you:

- In the start pen, as soon as one plan has 2 or more riders more than the other, it is taken. It
  can still change while riders come and go. Until then the newest upload is active.
- At the roll-off the plan with the most riders near you wins. On a tie the newest upload wins. The
  ride lock then keeps it.
- Without data on riders near you, the newest upload wins.

The settings status then adds "2 clubs fit: picked by the teammates near you". With two or more
clubs ticked, the Info window's plan line also names the club (`Rollers fast · plan F9E98R ·
Kettenfett RC`).

### The ride lock

From your roll-off until the event ends, Paceline keeps the team whose plan was active at the
roll-off:

- A new plan for that team (the captain fixed something) applies at once.
- Another team's plan, or "no plan", waits until the event is over.
- What you do yourself applies at once: loading a file, **Remove**, ticking a club. Unticking the
  locked club ends the lock and its plan.
- With no server plan at the roll-off (none yet, a failed check, or a file plan), the lock binds
  to the first server plan that arrives during the ride. It never binds to a file plan.
- In the start pen and outside events there is no lock.

### Pull targets from the plan

The plan's JSON export has, for each rider, the pull watts (`pull_power`) and the target in W/kg
(`pull_wkg`), the number on the plan image the captain reads out.

- Watts come from the JSON, else from the text export, else there are none. When both files have
  them and they differ, the JSON wins, because it matches riders by Zwift ID and the text only by
  name. The import then warns: "Pull watts for Ben differ between the files – using the JSON."
- The W/kg target (the default target unit) is the plan's `pull_wkg` for every rider, you included,
  shown with one decimal like Sauce. It is not worked out from watts and weight. Only for a plan
  without `pull_wkg` does Paceline divide the watts by the weight.
- A rider with W/kg but no watts gets no target.
- The plan code covers the watts, not the W/kg, so a plan's code stays the same with or without
  `pull_wkg`.

### Load a plan from a file instead

A plan from a file overrides the plan server. Use it when the server is down, or for a team ride
outside a Zwift event.

The captain gives you the files from the [ZwiftGopher TTT planner](https://zwiftgopher.com/TTT/):
the JSON export, and the text export too if the JSON has no pull watts. The JSON has the Zwift IDs
and, in the planner's newer exports, the pull watts and W/kg. The text export has the pull watts.

1. Click a Paceline window to open the Paceline settings window. Outside a TTT event the window is
   invisible: click where it sits, or right-click it and press the tune icon in Sauce's title bar.
2. Under **Plan**, open **Load a plan from a file instead** and drop the files into the box, or
   press **Choose files…**. If you have the file contents as text, use **Paste instead**. With the
   plan server switched off the box is open already.
3. You should now see the team name, the riders table and a line "You are *your name* · #position ·
   60s@4.4" (your pull time and target in W/kg, or in watts with that setting). Until Zwift is
   running with your rider, that line says "Waiting for Zwift…" instead. That is normal: the plan
   code check below works without Zwift. If Zwift runs and the line says "You are not in this plan",
   tell the captain. It also says so when you are only in the planner's roster.
4. Check the **Plan code**. It is 6 characters long, and everyone on the team must see the same
   code. Compare it with the captain's. If yours is different, you have a different or older plan
   file. Load the files again, and ask the captain to resend them if the code still differs.

While the file plan is active, the settings say "Plan from file, not from the server", with
**Remove**. Paceline still checks the server (for the Clubs table and what waits), but its plans
wait. A file plan ends when the first event after you loaded it is over (for a TTT, 30 seconds after
the finish), or 18 hours after you loaded it, whichever comes first. **Remove** ends it at once, and
the server's plan for this race, if there is one, takes over. With the plan server switched off
(**Get plans from the plan server** unticked), a file plan never ends by itself.

Press **Done** to close the settings window.

### Plan server

The plan server keeps the team plans that clubs upload and gives each rider's Paceline the plan for
the race. When you are in a Zwift event, and when you open these settings, Paceline sends the plan
server your Zwift ID, the clubs you ticked, the codes of private clubs you added, your event's
start time and id, your plan code and the Paceline version. A club you ticked sees when you last
checked. Recordings go up only when you tick the upload box (see "Recordings upload").

Releases use the plan server `https://ttt.mafl.net`. Betas (`0.3.x-beta.N`) use the beta plan server
(`https://ttt-beta.mafl.net`), which has its own clubs and plans. The address is under **Advanced**,
**Server**. Leave it as it is, unless your club uses another server. An address you type there is
kept; otherwise each build uses its own server.

What the server keeps, who sees it, for how long and where it is processed is on the privacy page of
the server you use: its address plus `/privacy` (for example `https://ttt.example.org/privacy`).
That page is the binding text, not this guide.

Operators find the server's pages, mail setup and limits in
[`server/README.md`](../server/README.md).

## During the ride

Paceline stays quiet until you join a team time trial in Zwift. It recognises one by Zwift's event
type, by WTRL's TTT tags, or, for private TTTs, by "TTT" or "Team Time Trial" in the event's name.
Until then the Action, Rest and Info windows are invisible: nothing shows, not even their
background. Nothing records, and the plan server is not asked; only the settings window checks once
when you open it. The windows appear when you enter the start pen and go invisible again 30 seconds
after the finish.

To find a window while it is invisible, move the mouse over where it sits. With a Transparent theme
its outline and background show then, but not with a solid background. To move or resize it,
right-click there (Sauce's settings mode shows its title bar), or press **Start demo** in the
settings window, which shows all windows. To use Paceline outside a TTT event, for a team practice
ride or if Zwift ever changes how it marks TTT events, untick **Only during TTT events** in the
settings window.

The Paceline windows catch mouse clicks, even where you hardly see them. Put them over a part of the
Zwift screen where you never click. To move or close one, right-click it to show Sauce's title bar.
Right-click again to hide it.

### Paceline Action

**Paceline Action** is the window to glance at while riding. Its numbers are big, narrow and bold,
in Sauce's own font, and they use the window's height as well as its width. Make the window taller
or wider and they grow.

- While you rest it shows one big clock: the time until your pull starts. It counts in seconds as
  pulls are called (`26s`), and above 100 seconds in minutes (`5:47`). It adds up the planned pulls
  of the riders before you, the rider at the front included, plus 10 seconds for each (5 seconds for
  a pull over 40 seconds). In our races a turn took 2 to 11 seconds longer than planned. Only the
  rider directly before you counts with his planned pull alone. So near the end the clock reaches 0
  a little early rather than late, and READY covers the rest until he swings off. At a normal change
  the clock runs down without a jump when the next rider takes over. The countdown is only good to
  about 10 seconds, as riders pull longer or shorter than planned. The handover itself is called out
  by voice.
- When the rider at the front has pulled his plan plus that extra time, the countdown runs on for 3
  more seconds, the time Paceline needs to see the change. Then it waits until the next rider is at
  the front, so it does not run out while someone pulls longer. While it waits it says so. The
  number is dimmed with a `≥` in front, as in `≥27s`, which means your pull is at least that far
  away. Under it, small, is how long the rider in front is over his plan (`+14`). When the change
  comes, the clock runs on as usual.
- When the race does not go as planned (a rider swings off early, drops out of the line or comes
  back), the clock corrects itself without jumping where it can. A difference of a few seconds it
  makes up by running a little faster or slower until it is right. A bigger change it takes at once,
  softly faded in, and the line under it says why for 5 seconds: `ELI out −40s` in amber when your
  pull comes sooner, `ELI back +1:10` dimmed when it comes later, or just the amount (`−25s`) when
  no rider explains it. A change to later waits 3 seconds first, so a short shuffle at the front
  never moves the clock. In the last 15 seconds the clock is always exact. If READY was on and the
  pull moves away again, it says `READY off +36s`.
- Right of the clock is your place in the line right now, counted in plan order from the rider who
  is pulling (`#1`). `#2` means you are next.
- **READY:** in the last 10 seconds before your pull the window shows your target, your power now
  and `READY` in amber; [the pictures](../README.md) on the front page show how it looks. The power
  bar is there already with its band and the shadow of your power now (see your pull, below), but
  without a marker. It shows where you are against the target, so you come up to it before the
  handover instead of surging. Being below the target in the draft is right: the band only shows
  how far below you are. The middle number is drawn smaller than the two at the sides (see
  **Smaller middle field** below).
- During your pull the window shows three numbers: your target on the left, your power now in the
  middle, and the time left of your pull in seconds on the right (`110`, `s`). The time turns
  amber in the last 10 seconds and, over time, runs on below zero in amber (`−4`). Below is the
  power bar. Its green field is your target: green is within 5 % of it, amber within 10 %, red
  beyond. The red ends reach out to 30 % off the target, squeezed towards the ends, so a surge or a
  soft spell still shows how far out you are. A soft white band on the bar shows where your power
  has been in the last 10 seconds, from the lowest second to the highest, with a soft shadow inside
  it at your power now. Single spikes in Zwift's power, like the dip of a gear change, are left
  out, and the band glides over about a second instead of jumping. 5 seconds into your pull the
  big marker appears: your average of the seconds of your pull so far, up to the last 10, in the
  colour of its zone. The ramp-up counts, so after a slow start the marker can show amber for a
  few seconds. After that the marker keeps still while you ride on target,
  and the band and its shadow show quickly when you move away.
  The number in the middle is your power as Zwift sends it, once a second, like other live-data
  windows, in the marker's colour once the marker shows. Tick **5 s smoothed power** to see the
  average of the last 5 seconds instead. The number moves more than the marker: ride by the bar,
  the number only tells you what you push. It is kept small on purpose. Without pull watts in the
  plan, neither in the JSON nor from a text export, there is no target. You then see `–` as the
  target, your power now, the time and a plain grey bar.
- **Smaller middle field**: the middle number is drawn a little smaller than the two at the sides.
  That is your power now in READY and during your pull, and the middle field while resting (see
  "Fields while resting"). So the target and the time stand out, and the bar stays what you ride by.
  It is on by default. To have all three numbers the same size, untick **Smaller middle field** in
  the Action window's settings (under "This window").
- **Numbers on the power bar** (off by default): each amber and red field shows where it begins,
  on its side towards the middle, in your **Pull target** unit: watts rounded to 10, W/kg to 0.1.
  At a 200 W target that is `180` and `190` on the left, `210` and `220` on the right. Tick it in
  the Action window's settings (under "This window").
- **Fields while resting** (off by default): three fields of your choice in the Action window while
  you rest. See "Fields while resting" below.
- Targets are shown in W/kg by default, everywhere one number. To see watts instead, open the
  settings window and set **Pull target** to **W**. The W/kg is the plan's own (`pull_wkg`, see
  "Pull targets from the plan"), for you too. For a plan without it Paceline divides by your weight
  in Zwift, or by the planner's weight if Zwift gives none, with one decimal like Sauce. Without any
  weight it shows watts. In W/kg your power bar compares your power now in W/kg (by your weight in
  Zwift, else the plan's) with that target. In W it compares watts with the plan's watts.
- An empty window means Paceline has nothing to show. No plan is loaded, Paceline does not know your
  rider yet (Zwift has not run in this Sauce session), you are not a rider in the plan (only in the
  planner's roster, or not listed), or it is finish mode. In finish mode the rotation is off for the
  sprint, from 500 m before the finish line and past the line until you stand still or Sauce shows
  another race.
- An amber `?` means Paceline cannot tell. No teammate is near you (dropped, or their data has
  stopped), there is no current Zwift data for your own rider (Zwift stopped, you only spectate, or
  no data for 15 seconds), or nobody is being tracked at the front. Before the start the window
  stays empty instead, because Paceline tracks nothing while you stand still in the start pen. After
  a stop during the ride the windows stay empty for 40 seconds after rolling on, because the order
  at the front is chaos then.
- The start is set, not detected. Plan #1 does the start pull. In the TTTs of 12 Nov 2026 he always
  did, often after someone else led for the first seconds. In the start pen plan #1's windows are
  armed already: `READY` with his target, his power now and the bar. If he is not in the pen with
  the group, the first plan rider who is does the start pull instead; he is then the start puller.
  With no other plan rider there, nothing is set and the front is followed as after a stop. When the
  group rolls off, the start puller pulls at once. His first pull is his plan time plus 30 seconds,
  counted from the roll-off, so a 2:00 pull shows 2:30. Everyone else's windows stay empty until the
  start puller has been in front for 3 seconds (the start chaos is over), at most 60 seconds. For
  those 60 seconds Paceline detects nothing at the front, no climb either. After that it follows the
  front as usual (see "How Paceline decides who pulls" below).

### Fields while resting

While a Rest window is open, it has the countdown once it shows one, and the Action window stays
empty while you rest. If you would rather have numbers there, tick **Fields while resting** in the
Action window's settings. It is off by default. The window then shows three fields while you rest,
laid out like your pull (left, middle, right, each with its unit under it), and you pick what each
one shows:

| Choice | Shows | Unit line |
|---|---|---|
| **Off** | an empty field, it keeps its place | |
| **Power** | your power, the same number as in your pull: W/kg with one decimal or whole watts as you set **Pull target** | `power` |
| **Draft** | the watts of your draft, whole number | `draft` |
| **Speed** | km/h, no decimals | `km/h` |
| **Cadence** | your cadence, whole number | `rpm` |
| **Heart rate** | your heart rate, whole number | `bpm` |
| **Grade** | one decimal, `0.0` for flat | `%` |

By default the middle field is **Power** and the left and right ones are **Off**, so the number
does not change its kind when your pull starts. It is your power as Zwift sends it, or the average
of the last 5 seconds with **5 s smoothed power** ticked, as in your pull. Without a weight it shows
watts. A value Paceline does not have shows a dim `–`, for example no heart rate or cadence from a
power-only trainer. There is no countdown to pick: with a Rest window open, the countdown is the Rest window's. The fields show
until READY, the last 10 seconds before your pull. From then on the window shows READY and your pull
as always. A climb or descent (the Rest window shows `▲` or `▼`) does not change them, and they keep
showing live values.

<img src="images/settings-action.png" width="420" alt="The Action window's settings: Smaller middle field ticked, the 5 s smoothed power box and the Numbers on the power bar box (both unticked), Fields while resting ticked with Heart rate on the left, Power in the middle and Draft on the right (labelled: if Rest window active, otherwise countdown)">

Without a Rest window, or with one that has no countdown yet, the countdown is the right field. The
number is on top and your place under it (`13` over `#2`, `3:59` over `#6`). While the clock stands
it is dimmed with `≥`. From 10:00 it is only dimmed, as `≥10:47` is too wide for the field. Your
left and middle fields stay as you picked them. What you picked for the right one shows again once a
Rest window takes the countdown, as the setting says:
**Right (if Rest window active, otherwise countdown)**. The line under the countdown takes the power
bar's place. It shows a gap, the wheel to drop in behind, `+50` while the clock stands, or a
correction. READY comes up exactly where the countdown was.

With **Fields while resting** unticked and no Rest window, the Action window shows the big countdown
and your place.

When there is no countdown at all, the left and middle fields still show. That is the case with no
plan yet, in the start pen, at the finish, when riding alone, on a climb or descent and in the quiet
after it. The right field then stays empty, or shows the dim `▲` / `▼` or the amber `?` that the big
countdown would show.

[The pictures](../README.md) on the front page show the Action window with fields and the countdown
as its right field.

The Rest window shows the countdown only, never the fields.

### Paceline Rest

- **Paceline Rest** is an optional third window with only the countdown to your pull and your place.
  During your pull it disappears completely, background included. From `READY` on, the last 10
  seconds before your pull, it also disappears while an Action window is open, which takes over
  then. Without one it shows `READY` itself. The Paceline windows notice each other: each one leaves
  a sign of life every 2 seconds, and one not heard for 6 seconds counts as closed. In place of the
  countdown the Rest window shows a dim `▲` or `▼` while the order on a real climb or descent is
  broken, and nothing after the hill until the order is back (see "Rollers and real climbs").
- While a Rest window shows the countdown, the Action window leaves it to it. While you rest the
  Action window stays empty, not even the dash, or shows the fields you picked (see "Fields while
  resting" above). It wakes up with READY in the last 10 seconds before your pull (target, power
  now, the bar), and when your pull starts the time takes over. So if the big countdown in the
  middle of the screen is too much while you rest, open the Rest window and put it wherever it suits
  you, for example lower down. Tip: with Sauce's Transparent theme for the Action window, the empty
  window disappears completely.
- With no Rest window open, the Action window shows the countdown itself, so it is never missing.
  With **Fields while resting** ticked, the countdown is its right field. A Rest window without a
  countdown yet, just opened or still waiting for data, leaves the countdown to the Action window
  until it shows one.

### A gap in the line

Paceline watches the distance from each team rider to the rider ahead of him. When it is 10 m or
more for 5 seconds (15 m on a real climb or descent), someone has lost the wheel. The warning ends
when the gap has been under 6 m for 3 seconds. The distance is measured where the line breaks, from
the rider ahead of the gap to the first one behind it. It is shown in metres and in seconds at your
speed (`16 m · 1.3 s`). In the three recorded races of 12 Nov 2026 this caught every rider who
dropped and stayed quiet otherwise (4 to 6 warnings a race).

- Early stage: the draft starts to fade from about 6 m. In those races a rider got about 31 % of
  his power from the draft up to 5 m, 22 % at 8 m, 14 % at 10 m, and none from 15 m. From 8 m for
  5 seconds (12 m on a real climb or descent) your power bar gets an amber edge during your pull,
  and the label under your power now says how far back it is (`▼ 9 m`). Ease off a little before
  the draft is gone. While you rest, only your own early gap shows (`▲ GAP 9 m · 0.7 s`): close
  up. A threshold of 6 m would have warned 20 to 70 times a race, as the line normally rides up to
  5 m apart. From 8 m it is 4 to 16 times, 2 to 6 seconds before the full warning at the real
  drops. The early stage also comes sooner when the gap grows past 8 m quickly (10 m for 2 seconds
  is enough), or when the rider behind is clearly slower than the one ahead and easing off (from
  7 m). In four recorded races that was typically 2 to 6 seconds sooner, with 0 to 4 more warnings
  a race.
- During your pull a band takes the power bar's place: `▼ GROUP 16 m · 1.3 s` when the
  whole line behind you is gone, `▼ CORA 16 m · 1.3 s` for one rider, `▼ 3 RIDERS …` when the
  line breaks further back. Ease off until it is gone.
- The band is red with a white edge when the team needs the riders who are cut off. The team's
  time is taken on its 4th rider over the line in WTRL and ZRL, or on the plan's minimum finishers
  if it gives one. So with fewer than 4 still together at the front, nobody behind the gap may be
  lost. The group behind the puller is always red. The band is amber when their drop is acceptable
  (a 5th, 6th or 7th rider with 4 still together at the front).
- While you rest the line under the clock says it: `▲ GAP 16 m · 1.2 s` in amber when you
  are the one who lost the wheel (close it), someone else's gap in amber when the team needs
  them (`Cora −16 m · 1.3 s`, `Gap ahead 16 m · 1.3 s`), dim when their drop is acceptable. Your own
  gap and a needed rider go before the standing clock's `+12` while they are amber.
- Green, in the same place instead of amber or red, means the gap is still there but getting
  smaller: the rider behind is closing it himself. In the early stage only the `▼ 9 m` label turns
  green, and the bar keeps its normal look. Once the gap is 1 m wider than its smallest, it turns
  amber or red again. A green gap is not urgent. While you rest, the standing clock and a wheel
  change cue go before it. While your own gap is green, the full warning of a needed rider who is
  not closing is shown instead, but not one of a rider whose drop is acceptable.
- A rider whose drop is acceptable and who falls 50 m or more behind is let go: the warning ends and comes back
  only after he has closed up. A needed rider stays in the warning. No warnings at the start
  (the first 60 seconds), while standing still, or in finish mode (from 500 m before the finish
  line, and past it until you stand still or Sauce shows another race).

### Wheel cue

The line under the clock tells you whose wheel to find, with their kit colour (`Wheel ■ DANA`). It
comes:

- At the start, from the roll-off until you have been on that wheel for 2 seconds, your
  first pull begins, or 90 seconds have passed. The first puller gets none.
- When your wheel changes because a rider dropped from the group or came back. The cue is shown
  for 15 seconds once the change has held for 3 seconds. It is amber with the place in the line
  when it is not the plan's wheel (`DANA #3`). It is not shown more than once in 30 seconds, or in
  the first 45 seconds of the ride. A change during your pull shows after it.
- Not after every pull, so it means something when it comes. The planned wheel stays in the
  Info window. The wheel comes from the plan and who is with the group, not from Zwift's order,
  so a team riding in a bunch only sees it at the start.
- Your own gap and a needed rider go first, unless the gap is closing. A change cue goes before
  the standing clock's `+12`, the start cue after it.

### Rollers and real climbs

A hill is a climb from 4 % and a descent from -3 %, until the road is back below 2 % or above -2 %.
In a TTT event Paceline knows the hills before you get there. In the start pen it loads the route's
elevation profile from Sauce and lists every climb and descent of the profile by race distance. It
lists the lead-in once and then lap after lap up to the finish, so a climb on the second lap is
known too. The places follow Zwift's own lead-in and lap length. A segment that runs over a climb (a
KOM, for example) belongs to the climb, and the climb counts over the whole segment. A flat part of
up to 1 km inside a climb, or between the top and the descent, does not end the climb. Your place on
that list is your race distance.

A roller (at most 400 m long and 15 m up or down, like all hills of the 12 Nov 2026 TTT) changes
nothing: the rotation and the countdown go on as on the flat. On a real climb or descent the
rotation goes on as well, as long as the team keeps its order. Once one of these happens, the
order counts as broken and the windows show a triangle (`▲`, or `▼` for a descent) instead of the
countdown:
- A rider who is neither the puller nor the plan's next rider has been in front for 3 seconds. The
  last puller coming back to the front before the new one is clear does not count. That is a
  return, and it shows no triangle.
- A gap of 15 m or more opens in the line.

The puller's power does not count: on a climb teams ride level W/kg, so a puller well under his
planned pull power is normal climbing.

The triangle shows while the climb, and the descent after it, lasts. After the hill the windows go
quiet until the order is back, with a dim `–` in the Info window's table and no symbol in the
Action and Rest windows. Meanwhile Paceline still follows who leads (anyone in front for 3
seconds), but counts no turns. The order is back only once the climb, and the descent after it, is
over and there is a clear puller. A clear puller is a rider in front for at least half his planned
pull and at least 20 seconds. Before the last 20 minutes of the race, the plan's next rider after
him must then also take over (3 seconds in front). The countdown goes on from that rider, with his
pull time counted from when he came to the front. In the last 20 minutes the clear puller alone
ends the pause. An end can turn out wrong, when the rider before the puller takes the front back
within the next two changes. After a wrong end, the next end waits for the plan's next rider
again. After a right end, the clear puller alone ends it again.

Without the route data, because Sauce has no profile for the route or it could not be loaded yet,
Paceline goes by the grade under your wheels. A hill then counts once the grade has held for 5
seconds, and every hill counts as a real climb or descent, since without the profile there is no
telling a roller.

The Info window shows `Front: –` in these cases, or "Climb – rotation paused", "Descent – rotation
paused", after the hill a dim "Regrouping – rotation paused", or "Finish – rotation off".

### When the order breaks

When the order breaks, Paceline does not go quiet. Every change at the front is counted, and the
countdown goes on from the new puller. A change that was not the planned one moves the clock once,
and that is all.

- Who takes over: the plan's next rider in the line takes over after 3 seconds in front. Anyone else
  needs 20 seconds, so a rider who rolls up beside the puller or shows up in front for a moment
  during a change does not count. The new puller's time counts from when he came to the front. In
  the first minute after the start nobody takes over. A rider in front then needs his 3 or 20
  seconds after that minute, but his time still counts from when he came to the front.
- The puller comes back: the front often eases off for riders behind, and someone rolls by. When the
  last puller takes the front back (3 seconds in front) before the new rider has been a clear puller
  (in front for half his planned pull, at least 20 seconds), the change is taken back. His turn goes
  on, with his pull time from his own start. The same holds for your own pull: your clock keeps
  running when someone rolls by for a moment. The way back goes one way only. If the new rider takes
  the front again after that, it is a normal change (3 or 20 seconds, his pull time from when he
  came to the front again). With only two riders left, every change is a normal change. Your own
  pull start is taken back the same way, when a start turns out wrong or you ease off early and the
  last puller rolls by. Your clock then starts again when you come to the front.
- Riders sitting out: when the plan says Cora pulls next, but Dana takes the front and holds it for
  20 seconds, Cora is passed over and sits out. The countdown and the plan's next skip her until she
  pulls again. You are never taken out yourself, as you know whether you pull. In the table she
  keeps her place, dimmed. When she comes back in her planned place, right after the rider before
  her in the plan, she is the plan's next and takes over after 3 seconds, on a climb too. When the
  change that passed her over is taken back, she is back in the line.
- Riders hanging behind a gap: a rider cut off behind a full gap warning (see "A gap in the line")
  is out of the line at once, the same as a rider sitting out. He is back in as soon as the gap
  before him is under 10 m and he is with your group again. He counts as a dropped rider (the bottom
  of the table) only after 30 seconds away from your group.
- Stops and new plans: standing still (a stop) clears the riders sitting out. A new plan keeps the
  puller and his pull time when he is in it, and the riders sitting out who are.

### Paceline Info

**Paceline Info** is the status box. Every line keeps its place, so the box never jumps. The text is
narrow and bold, in Sauce's own font, and grows and shrinks with the window. Make the window bigger
for bigger text. Every line stays on one row. The text grows until the window's width or its height
is used up, and the rider names are the boldest. On top is what stays the same during the ride, in
the order you ride: the wheel you follow, then you. Below, set apart, is the live part.
[The pictures](../README.md) on the front page show how the rider lines are laid out. In `60s@4.4`
the pull time comes first, then the target without its unit, which **Pull target** decides (see
"Paceline Action").

- The plan line: the plan's name and code (`Rollers fast · plan F9E98R`), with the club when you
  ticked two or more. It is set a little smaller than the rider lines and cut with `…` when it is
  too long, so a long team name never makes all the other lines small. Without a plan it says "No
  plan – click to load one", or "Plan opens 19:00 · Rollers fast" while the plan waits for its 30
  minutes, or that another club has a plan for you.
- **Wheel:** the wheel you follow by the plan, which is the rider before you in plan order (the last
  rider if you are #1). Learn it before the start. It stays put while you pull too, since that is
  the rider you drop in behind. If that rider is not with the group, it shows in amber who to follow
  for now, e.g. `Dana → Cora`. Zwift's positions behind the first few riders are often jumbled, so
  Paceline takes this from the plan, not from where riders appear.
- **You:** your number in the plan, a swatch of your kit colour (so you know which socks/kit to
  pick), and, where the Wheel line has its name, your planned pull time and target (`#4 ■ 60s@4.4`).
- **Front:** who is pulling, their number and kit colour, and at the right the time left of their
  pull in seconds, as pulls are called (`12s`). Over their time it runs on below zero in amber
  (`−4s`). During your own pull it says **You**. A dim `–` means no rotation right now (before the
  start, alone, no data).
- **Next** (captain mode): tick **Captain mode** in the Info window's settings (at the top, under
  "This window"). A line under Front then shows who pulls next with their full pull line
  (`#4 ■ Dana  60s@4.4`), ready to call out. When it is dimmed, it is the plan's guess. Before the
  start it shows plan #1, who starts. While the climb triangle (`▲`/`▼`) shows, while the windows
  wait after a climb, when riding alone or without data, it shows the plan's next after the last
  puller. It turns live again as soon as a puller is at the front. In finish mode (from 500 m before
  the line until you stop) it shows `–`.
- The whole rotation, shown before the start for everyone: one row per rider (`#3 ■ Name 60s@4.4`),
  from the rider pulling (before the start from plan #1), with you highlighted. Once the rotation
  runs it goes away. In **Captain mode** you can keep it: tick
  **and keep the whole rotation listed during the ride** below it. It then stays and turns with
  every change, always in plan order. A rider sitting out or hanging behind a gap (see "When the
  order breaks") keeps his place, dimmed. The first of them hanging shows the gap in metres
  (`14 m`) instead of his pull. Only dropped
  riders, not linked to the group within 30 m for 30 seconds, move to the bottom. There they are
  dimmed, in plan order below a dashed line, and they come back into the rotation once they are with
  the group again. The first two rows take the place of the Front and Next lines, in a larger text
  and set apart from the rest by a small gap. The first row is the rider pulling: bold, with the
  time left, with `▲`/`▼` while the order on a real climb or descent is broken, or with a dim `–`
  after the hill until the order is back. The second row is the next rider in the line.
- The recorder line.

Make the Info window a little taller for the Next line, and taller still for the whole rotation.

### How Paceline decides who pulls

The front rider is the frontmost rider of your team group (teammates within 30 m of each other). He
becomes the puller once he has been in front long enough (see "Who takes over" under "When the order
breaks"). His pull time counts from when he got to the front and keeps running while someone else is
briefly in front. A turn ends only when the next puller takes over. When the last puller takes the
front back before the new one is a clear puller, his turn goes on (see "The puller comes back").
Nothing is tracked while you stand still (below 2 km/h, e.g. in the start pen).

Your own pull is also picked up from your riding, on the flat, once you are the next rider and the
rider in front is due (10 seconds or less of his pull left) or gone (nobody of the team ahead of
you). It starts when you jump up in power and your draft drops to zero, or as soon as your draft is
zero with a teammate behind you. It ends when the next rider has taken over, not when you ease off
early (see "The puller comes back"). Once you are a clear puller, waiting for riders behind never
restarts your clock.

The time to your pull adds up the planned pulls of the riders in the line before you, plus the extra
time for each change (see "Paceline Action"). It skips dropped riders and riders sitting out or
hanging behind a gap. Paceline does not know the plan was followed. After a crash, a dropped rider
or a messy changeover the display can be wrong for a while. Ride the plan and talk on voice. Use the
display as a help, not as the referee.

Tip: open both Paceline windows before the start. A window opened mid-race shows its own pull
timing until the next handover.

### Demo

To place and size the windows without Zwift, use the demo. Open the settings window (the tune icon,
or a click where a Paceline window sits, even when it is invisible) and press **Start demo**. For 10
minutes all windows show a made-up ride with your plan, or with a sample plan if none is loaded,
marked `DEMO`. Meanwhile Zwift data is ignored, and nothing is recorded or uploaded. **Stop demo**
ends it early. The ride also has the rarer moments: gaps in the line, a puller well over his plan
(the countdown waits with `≥`), dropped riders and a real climb where the order breaks (`▲`).

### Background and appearance

The windows look like Sauce's own, with the theme colours, the background texture and the theme's
transparency. With a **Transparent** theme such as Dark, the background disappears and shows again
when you move the mouse over the window. For your own colour or opacity, open the settings from that
window, tick **Solid background** under Appearance and set the opacity with the slider (100 =
opaque). Each Paceline window keeps its own, as in Sauce's windows. The Action window has its own
settings window for that, with its own options below the appearance: **Smaller middle field**,
**5 s smoothed power**, **Numbers on the power bar** and **Fields while resting**.

### Recorder

- Start Zwift and Sauce as usual and keep a Paceline window open (either one records). The Info
  box shows the plan name and code, and either "Recorder ready (needs 2 team riders)" or "● REC"
  with a timer.
- Recording starts by itself when you enter the TTT start pen and stops by itself 30 seconds after
  the finish. It needs a plan with you in it, which may arrive a few seconds into the pen. It
  records with or without teammates near you, so there is a recording also when something went
  wrong. Between start and stop it keeps recording even when you ride alone (dropped). You do not
  have to press anything.
- Without such a plan it does not record, since that recording would never go up. To record anyway,
  tick **Also record without a plan** in the settings window (under **Advanced**).
- A recording holds you and the plan's riders, and the planner's roster. When fewer than two of them
  are near you (no plan, the wrong plan), it also holds the riders of your event within 300 m of
  you, the 15 nearest, which in a TTT is in practice your team. It also notes the other riders
  within 100 m ahead of you and 50 m behind (the 20 nearest), without who they are. For them it
  keeps only a number that holds for this recording, their distance to you, speed, power, draft and
  whether they ride in your event. That shows when other teams disturb the line.
- After the stop the ride goes up if you upload. That needs a plan from a club you ticked, or a file
  plan of one of its teams. Otherwise export it from the settings window.
- With **Only during TTT events** unticked, recording starts when you and a teammate from the plan
  are near each other, and stops 120 seconds after fewer than 2 are left.
- Each recorded second also notes who Paceline thought was pulling and what the windows showed:
  countdown or pull, your place, Wheel, the captain's Next, a gap warning. It notes each change at
  the front, the climb triangle and why it came, and who is hanging behind a gap or sitting out. For
  comparison it also notes the puller and countdown of 0.3.4's way of following the front. With all
  this the ride can be compared with the plan afterwards. It also notes the Zwift event you are in
  (name, type, subgroup and start time) and Zwift's ride clock, so a later version can tell the
  start pen from the race.
- If the box says "Waiting for Zwift…", Sauce does not see your own rider (for example when you
  only spectate). Nothing is recorded then.
- Hiding Sauce's overlays with its hotkey is fine, recording continues. Closing the Paceline
  windows or Sauce stops recording.
- With more than one Paceline window open, only one of them records. The others just show
  the status.
- Some Zwift events hide the overlays and rider data from Sauce on purpose (events marked
  "nooverlays" or "hidethehud"). Sauce gets no nearby riders there, so nothing can be recorded.

## Your ride data

### Why we ask for your ride data

Paceline does not know who is pulling. It works it out every second from what Zwift tells Sauce: who
is at the front of the group, power, draft and speed. The rules for that were set from a few FIT
files of past races. They decide how long a rider must be in front to take over the pull, how big a
power jump starts your own pull, how far apart riders may be and still count as one group, and when
the order on a real climb counts as broken and the triangle shows. Those files have no positions in
the line and no draft, so nobody has checked the rules against the data Paceline sees during a race.
Your recordings do that.

With them we can check, second by second, what Paceline showed against what happened:

- Did it see the change at the front on time, or late, or not at all?
- Did your own pull start and end when you went to the front and swung off?
- Did the place in the line (`#3`) and "Wheel" match the real order?
- How old is your teammates' data when it reaches Sauce, and how much does that jumble the order?
- Is draft a better signal than position? This decides how the next version detects pulls.

The recordings also show how the plan held up in the race: how long each pull lasted, at what power,
and where the rotation broke up (climbs, a dropped rider, the sprint). That helps to set pull times
everyone can hold. It is not a ranking, and nobody is judged on it.

What happens to the data: on the plan server only the Paceline operator opens the recordings, to
analyse your team's rides and improve Paceline. Your captain sees that a recording arrived and can
delete it, but can't download it. Recordings are not passed on and not published. Heart rate and
cadence are never uploaded. The server deletes recordings after 90 days. You can always ride
without sending anything: a recording stays on your computer unless you export it or tick the
upload box.

### After the ride

1. Click where a Paceline window sits to open the settings. The window is invisible after the
   finish; right-click and the tune icon work too.
2. Under **Recordings** find your ride (it shows the date, how long it lasted and the plan code).
3. Press **Export**. A normal Save dialog opens and asks where to save the file (it ends in
   `.jsonl`). Pick a place you can find again, such as the Desktop.
4. Send that file to whoever analyses your team's rides.

You can export a ride more than once. **Delete** removes a recording from your computer for good.
Paceline keeps the newest 20 recordings and removes any older than 14 days, so export soon after
the ride.

### Recordings upload

Instead of exporting by hand you can let Paceline send each ride to the plan server. It is off until
you switch it on. In the settings window, under **Recordings** (right below Clubs), tick
**Upload my recordings after each ride**. The box needs **Get plans from the plan server**. While
that is off, an unticked box is greyed out, and a ticked one says the uploads are paused; you can
always untick it. One line under the box says why the rides matter, and **What is sent** opens the
full text:

> Sends each finished recording (power, draft, speed and position of you and the plan riders; the
> other riders near you only as a number for that ride, distance, speed, power, draft and whether
> they ride in your event, without name or Zwift ID; no weight or FTP) to the plan server. Only
> the Paceline operator can open the file, to analyse your team's rides and improve Paceline; your
> captain sees that it arrived and can delete it. Heart rate and cadence are never sent. The
> server deletes recordings after 90 days. Only rides recorded after you tick this box go up on
> their own; send older ones with Upload.

- What is sent is only what the analysis needs: power, draft, speed and position of you and of the
  riders in the plan, with your Zwift ID and the plan. When the plan changes during the ride, the
  riders of the new plan are kept too. Other riders within 100 m ahead and 50 m behind (the 20
  nearest) go up without name, Zwift ID or map position. For them only a number for that recording
  goes up, with distance, speed, power, draft and whether they ride in your event. Left out are
  everyone's heart rate (yours too) and cadence, weight, W/kg and FTP in the plan, and the named row
  of any rider you watch who is in no plan of the ride. When such a rider is near you, he goes up as
  one of the anonymous other riders above. Paceline's notes on the rotation in each second (who
  pulled, who was in front, whose wheel, whose gap) name only riders of the plan loaded at that
  moment, or you. The server keeps the riders of the plan you started with as they are. A rider who
  joins later stays only if the plan named at that moment is a plan of the team that the server
  stores. A rider of a file plan loaded during the ride loses his power, draft, speed and position
  there, but those notes can still name him by his Zwift ID. The file you export yourself still has
  everything.
- Where it goes: to the plan server set under **Advanced** (normally the build's own, see "Plan
  server"), filed under your club and team. The team is the one whose plan was active at your
  roll-off, the ride lock's team. A ride with a file plan goes up only when a club you ticked has a
  team of that name. Otherwise it stays on your computer. On the server only the Paceline operator
  opens the file. Your captain sees that it arrived and can delete it, but can't download it. The
  server deletes recordings after 90 days.
- When: right after a recording stops, or later while a Paceline window is open and Zwift runs.
  Paceline never uploads while it is still recording, and only while the plan server is switched on.
  Only rides recorded after you ticked the box go up on their own. Older ones, and recordings
  shorter than a minute or older than 7 days, are not sent automatically, but **Upload** sends them.
  If the server cannot be reached, answers with an error or has no room, Paceline tries again every
  5 minutes.
- Errors that a retry can't fix stop the automatic upload of that ride. **Upload** then tries once
  more. These errors are:
  - "you are not in this team on the plan server"
  - "this team is not on the plan server"
  - "a different copy of this recording is on the plan server"
  - "the plan server refused this recording"
  - "recording too large for the plan server"
- Under **Recordings** each ride then shows "uploaded", "waiting for upload" or "not sent
  automatically" (with the reason if the last try failed), and **Upload** sends a ride right away.

## For captains

The plan server keeps your club's TTT plans and gives each rider's Paceline the plan for the race.
A rider gets a plan only when it lists him, only from inside his race and only from 30 minutes
before the start. The team page shows you which riders have it. The recordings your riders upload
go to the server too, filed under your club. You work in a browser, on a phone or a computer, at
`https://ttt.mafl.net` (for betas see "Plan server").

### Register your club

1. Open the plan server and press **Register a club**. Give the club's name (2 to 60 characters, in
   Latin letters or digits), your e-mail address and the club's time zone, and tick "I will tell my
   riders that their Zwift IDs and names are in the plans". The page answers "Check your inbox".
2. The mail brings the club link. Open it within 24 hours, or the club is deleted again. The page
   has one button, **Open** with the club's name: press it.
3. From then on it is the club's link for good. Bookmark it or keep the mail: it opens the club on
   any device. Share it only with your plan makers.

Lost the link? Press **Lost link** on the start page, enter the club's address and press **Mail a
new link**. Each club with this address gets a new link by mail. It works for 24 hours, and your
old link works until you open the new one. Opening a new link ends the older ones, also on other
phones. **Mail a new link** under **Sign-in** in the club settings does the same.

### Your club

After the club link you land on the club hub. It shows the next race and, only when there is
something:

- **To do before the race**: each thing to fix, by team and start time, with the button that fixes
  it, for example **Remove event link**, **Set the start time** or **Make a plan live**.
- **New plans from ZwiftGopher**: every plan waiting, with **Review and store** and **Discard**.
- One table per race day, up to 7 days ahead: each team racing, its start time, the live plan and
  version, and "4 of 6 have it" once the plan is open ("opens 19:00" before).

With nothing to do, one line says so: "Nothing to do · next race Thu 19 Nov 19:30". Each team's
line has the colour of its worst state: red when riders get nothing (plans stored but none live, no
start time, riders in another event than the event link), amber for something to check (a hole,
riders on an older plan code), grey before the plan opens, green when every rider has the plan.

**Club settings**, a button on the hub, holds the club's name and time zone, **Targets in** (W/kg or
watts, for the rider tables), **Who gets your plans** (below), **Sign-in** (your address,
**Change e-mail** and **Mail a new link**), then **Records**: the recordings, the activity and
**Remove a rider**, and last **Delete club**. **Remove a rider** is for data-protection requests:
enter the Zwift ID of a rider who asks the club to delete their data. It takes them out of every
plan, every older version and every recording of the club, and cannot be undone.

An open club gives its plans to every rider listed in them, and Paceline adds the club by itself.
A private club is hidden from everyone without its rider code. Under **Who gets your plans** press
**Make private (creates a rider code)**. It asks first: riders get no plans from the club until they
enter the code in Paceline, so don't do this on a race day. The code (10 letters and digits, like
`7Q4MZ-2KX9B`) is shown once: pass it on to your riders. They type it under **Add club by code** in
Paceline's settings (see "Clubs"). In the rider table, a rider without it shows "Not seen yet · may
need the rider code". **New rider code…** makes a new code and the old one stops working: riders
who still have it see "this code no longer works: ask your captain for the new one". **Make open**
opens the club again.

### Add a team

Press **Add a team** on the hub. It asks for the team's name and "When does the team race?":

- "Every week", with the race day (Thursday is filled in) and the start time, in the club's time
  zone. You can set the time later.
- "On single dates", for a ZRL team or a yearly event: you choose the date and the start time when
  you store a plan.

**Team settings** on the team page changes the name and the race day and time, and has **New
ZwiftGopher link** (below) and **Delete team**. A new start time applies to new races only: "Races
already planned keep their time; change one in its ⋯." An extra race on another day needs no second
team: store a plan for that date. When daylight saving time changes, the pages remind you to check
your start times, as WTRL and ZRL times may be fixed in UTC.

### Get a plan in

On the team page, **Plan on ZwiftGopher** opens the
[ZwiftGopher TTT planner](https://zwiftgopher.com/TTT/) in a new tab, with the team's current plan
loaded when it has one. Make the plan there and send it to Paceline from the planner. It arrives on
the team page under "Not stored yet" ("Received 19:12 · 'Rollers slow' · 4 riders") and on the hub
under **New plans from ZwiftGopher**. It is not live yet: riders get nothing from it until you store
it and make it live. A plan that is not stored goes after 7 days.

The link behind **Plan on ZwiftGopher** works for 7 days. Treat it like a password: anyone who holds
it can send a plan to the team. **New ZwiftGopher link** in the team settings ends every link handed
out so far. A plan's ⋯ has **Edit on ZwiftGopher**, which opens the planner with that plan.

**Upload a file** is the other way. Export the plan from ZwiftGopher as JSON, with pull power, pick
the file under "ZwiftGopher JSON export" (or paste it under "Paste the JSON instead") and press
**Continue**. The team page then opens with the plan picked and its Store form open. A file that is
not a planner export is refused ("This is not a planner JSON export."). An upload that is not stored
goes after 24 hours.

### Store a plan and make it live

A plan that is not stored yet shows its rider table and the Store form:

- **Store as**: "New version of 'Rollers · fast'" for a plan of the race, or "New plan". When
  nothing fits, nothing is picked, and **Store** asks you to "Pick a plan."
- For a new plan, its type (up to 30 characters, optional): "Rollers slow" from the planner gives
  "slow", and the plan reads "Rollers · slow". Each plan of a race has its own type; a plan without
  one reads "Plan".
- For a new plan, the race: its date, start time and event link. Another date makes a new race.
  With an event link (Zwift or ZwiftPower) the race's plans go only to riders in that event; without
  one they find the event by the start time.
- "Other team", to store the plan for another team of the club.

Then press **Make live** (stores the plan and makes it what riders get), **Store** (stores it only,
for a spare or a variant) or **Discard**. **Make live** asks first only in the race window, from 30
minutes before the start, while another version is live in that race. The page then names the plan
and its code ("'Rollers · fast' v3 is live for Thu 19 Nov 19:30. Plan code RE5CFQ."): give the code
to your riders, so they can check it. A plan stored but not live says so in red: "Not live: riders
get nothing until you press Make live."

<img src="images/captain-cockpit-store-390-light.png" width="260" alt="A plan not stored yet picked on a phone, the Store sheet: the title Received 19:12 · 'Rollers' · 3 riders with ✕ and the caption Against live 'easy' v1; the rider table, every pull 60 s at its target (60 s @ 3.3 to 60 s @ 3.6), with Alma Keller marked NEW, Ben Richter and Cleo Maier, and Dana Lorenz, Eli Sommer and Gina Hoff crossed out; under it the form: the fold Other team; Store as with New version of 'Rollers · easy' (live · v1 · 2 of 3 riders the same), of 'Rollers · fast' and of 'Rollers · spare', and New plan, none chosen yet; the red line Pick a plan.; then the action bar with Discard, Store and Make live in that order at its right end; last the line Not updating while the Store form is open · Refresh">

Every Store of a plan is a new version (v1, v2, …), and up to 20 are kept per plan. A race can have
several plans ("Rollers · fast", "Rollers · slow"), and any version of any of them can be made live.
The team page lists every race still to race with its plans and versions. A version's row says what
it changes against the live version ("Gina Hoff in, Alma Keller out · 2 targets"), and the live one carries
LIVE. Pick a version to see its rider table, and press its **Make live**. It asks first in the race
window, and also whenever its warning lines show: outdated marks, a rider it moves, a team it leaves
with a hole, no start time. There is no Undo: to take a switch back, open the version that was live
(its card says "Was live …") and press its **Make live**. The same file again stores nothing
("Same as 'Rollers · fast' v2: nothing new stored.").

A race's ⋯ has "Date and time" with **Save date and time…**, which moves the race with all its
plans, and its event link with **Save event link** and **Remove event link**. A plan's ⋯ has
**Rename**, **Edit on ZwiftGopher** and **Delete plan…**.

<img src="images/captain-cockpit-version-1280-light.png" width="780" alt="The Rollers team page at 1280 px with a version picked: the sidebar with Rollers (1 new plan, 0 of 5 riders have the plan), Sprockets and Cogs; the title line Rollers with Updated 19:12 raised beside it and Team settings at its right end; under it Plan on ZwiftGopher and Upload a file at the left and, above the card at the right, Make live; in the left column two boxes, the first starting on the card's top line: Not stored yet (headed like a race's line, with Received 19:12 · 'Rollers' · 3 riders), then the race's box with its line Thu 19 Nov · 19:30 · in 18 min, the plans fast (v2 · 5 targets, v1 · Alma Keller and Finn Weber in, Gina Hoff out · 1 pull time · 4 targets), spare (v1 · 5 targets), and easy with the picked row v2 · not live and v1 · 0/5 have it tagged LIVE and SENDING; under them How races work; in the right column one framed card: 'easy' v2 · stored Thu 19 Nov 19:12, its Plan code and Against live v1, the rider table (every pull 60 s at its target, 60 s @ 3.3 to 60 s @ 3.6) with Alma Keller NEW and Gina Hoff crossed out, the warning lines Alma Keller moves from Sprockets to Rollers. and Still to do: Sprockets., and no button bar in the card (its Make live is in the row above)">

The rider table shows the plan as riders get it: number, rider, and pull @ target ("60 s @ 4.2"). It
is marked against the race's live version: a changed rider is followed by his old row, dimmed; a
rider no longer in the plan is crossed out at the end ("→ Sprockets" when he rides for another team
now); a new one has NEW. The warning lines say what else it does: "Ben moves from Sprockets to
Rollers.", "Still to do: Sprockets".

From 30 minutes before the start the live version's table has a column "Plan", with each rider's
state and the time of his last check (**What do these mean?** explains them).
Before that it shows none, as riders get the plan only then.

- ✓ "Has the plan", "Has the plan · in the event".
- ⚠ "Has an older plan (code …)", "Has v2, not the live v3", "Rides Sprockets now", "In event … ·
  gets nothing".
- – "Not seen yet", "Checked 19:05 · not in the event yet", "In the event · plan comes at the next
  check".

### Race day

- The plan opens 30 minutes before the start. Riders in the race whom the live version lists get it
  within 10 seconds. Before that their Info window says "Plan opens 19:00 · Rollers fast".
- From then until the start, the live version's row says "Sending", and "Started" from the start
  until the race is over.
- **Make live** of a version in that time asks first and says what riders get ("Riders in the
  event get … within a minute"). Riders switch to the new plan within a minute, also during the
  race.
- From 90 minutes before to 60 minutes after the start, the hub and the team page update every 30
  seconds.
- **Captain mode** in your Info window shows who pulls next; tick **and keep the whole rotation
  listed during the ride** to keep the whole rotation too (see "Paceline Info").
- A race is over 2 hours after its start, and riders still get its plan for 2 more hours. It then
  sits in the fold "Over" and can't be changed. Its plans are kept for 7 days after its date, then
  deleted.

### Recordings

Riders who tick **Upload my recordings after each ride** send their rides to the plan server, filed
under your club and team. Under **Records** in the club settings you see each recording (team, date,
rider) and the club's quota, and you can delete one. It asks first and cannot be undone. Deleting is
also how a rider's withdrawn consent reaches recordings already uploaded. You can't download a
recording: only the Paceline operator opens them, to analyse the team's rides. The server deletes
recordings after 90 days.
