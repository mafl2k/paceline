# Paceline 0.3.1

Paceline is a mod for Sauce for Zwift that helps our team time trial. It:

1. Loads the team's TTT plan and shows you the plan code, so we know everyone has the same plan.
2. Shows who is pulling, whose wheel you are on and how long until your pull, and during your
   pull your target watts, the time left and a power bar (new in 0.2).
3. Records how the team rides together (who is near you, power, speed, positions) while you ride.

Paceline doesn't calculate plans. The rotation, pull times and pull watts come from the
[ZwiftGopher TTT planner](https://zwiftgopher.com/TTT/), which does all the maths; Paceline
carries its plan into the ride.

Your captain uploads the plan to the plan server for your club, and Paceline gets it from there
when you are in the race (see "Load the plan"). Paceline records the ride on your computer. You
can export a recording and send it yourself, or tick **Upload my recordings after each ride**:
then each finished recording goes to the plan server, where only the Paceline operator opens it,
to analyse your team's rides. The server doesn't analyse recordings automatically yet.

**0.3 and the plan server.** Paceline 0.3 gets its plans from the plan server
(`https://ttt.mafl.net`): your captain registers the club there and uploads the plans there. It is
a new server: nothing from 0.2 is carried over, so the captain registers the club again. The
captain gets the club link by mail: open it within 24 hours; from then on it is the club's link for
good. Bookmark it or keep the mail: it opens the club on any device, until a new link is asked for
with "Lost link". Paceline
0.3 talks only to this new server, and 0.2 gets only "Update Paceline" from it, so update before
your next race. Coming from 0.2, a plan you loaded there no longer counts while the plan server is
on, and recordings made with 0.2 stay on your computer (export them to send them). The server
address is under **Advanced**, **Server**: leave it as it is, unless your club uses another server.
An address you type there is kept; otherwise each build uses its own server. Betas (`0.3.x-beta.N`)
talk to the beta plan server (`https://ttt-beta.mafl.net`), which has its own clubs and plans.

<p>
  <img src="docs/images/action-rest.png" width="300" alt="Paceline Action while resting: 37 s until your pull, #3 in the line">
  <img src="docs/images/action-pull.png" width="300" alt="Paceline Action during your pull: target 4.0 W/kg on the left, your power now 3.8 in green in the middle, 110 s left on the right, power bar with a green marker">
</p>
<p>
  <img src="docs/images/action-armed.png" width="300" alt="Paceline Action shortly before your pull: target 4.0 W/kg, your power now 3.1, an amber READY, the power bar with a white marker">
  <img src="docs/images/rest.png" width="220" alt="Paceline Rest: 36 s until your pull, #3 in the line">
</p>
<p>
  <img src="docs/images/info.png" width="340" alt="Paceline Info: plan code, the wheel you follow, your pull, who is in front, recorder">
  <img src="docs/images/info-captain.png" width="340" alt="Paceline Info in captain mode with the table: the rider pulling and the next rider as its first rows, then the rest of the rotation, all lined up on the @, and below a dashed line two riders dropped from the group, dimmed">
</p>
<p>
  <img src="docs/images/action-gap-early.png" width="300" alt="Paceline Action during your pull with a gap opening behind you: the power bar with an amber edge, and under your power now in amber 9 m">
  <img src="docs/images/action-gap.png" width="300" alt="Paceline Action during your pull with a gap behind you: in place of the power bar a red band with a white edge, GROUP 16 m · 1.3 s">
  <img src="docs/images/rest-gap.png" width="220" alt="Paceline Rest when you lost the wheel: 3:57 until your pull, #6, and under it in amber GAP 13 m · 1.1 s">
</p>
<p>
  <img src="docs/images/action-gap-early-green.png" width="300" alt="Paceline Action during your pull with a gap behind you that the rider behind is closing: the power bar in its normal look, and under your power now in green 8 m">
  <img src="docs/images/action-gap-green.png" width="300" alt="Paceline Action during your pull with the group behind you closing the gap: in place of the power bar a green band with a white edge, GROUP 16 m · 1.3 s">
  <img src="docs/images/rest-gap-green.png" width="220" alt="Paceline Rest while you close the gap to your wheel: 3:53 until your pull, #6, and under it in green GAP 14 m · 1.0 s">
</p>

*Top: the Action window while resting (time to your pull, your place in the line) and during your
pull (target, time left, power bar). Middle: the Action window when the Rest window has the
countdown, with READY shortly before your pull, and the Rest window. Then the Info
window, for riders and in captain mode with the rotation table (two riders dropped, below the line). Bottom: a gap in the line, first
a gap opening behind you during your pull (early stage), then the group lost your wheel, and you
lost the wheel while resting. Last row: the same three in green, the gap is getting smaller (new
in 0.3.0). Demo data with made-up riders.*

## Install

You need Sauce for Zwift already installed and working.

1. In Sauce, open **Settings**, then **Mods**, and press **Open unpacked SauceMods folder**.
   This opens the right folder for you, also when you use OneDrive or a translated
   "Documents" name. If you cannot find that button, the folder is normally:
   - macOS: `~/Documents/SauceMods`
   - Windows: `%USERPROFILE%\Documents\SauceMods` (with OneDrive it may be
     `OneDrive\Documents\SauceMods` instead)

   If the `SauceMods` folder does not exist yet, create it.
2. Download the newest `paceline-<version>.zip` (for example `paceline-0.3.1.zip`) from the
   [latest release](https://github.com/mafl2k/paceline/releases/latest), under **Assets**. A beta
   such as `paceline-0.3.2-beta.1.zip` is not the latest release: it is on the
   [releases page](https://github.com/mafl2k/paceline/releases), marked **Pre-release**.
   Put the `paceline` folder from the zip into that folder. When updating, replace the old
   `paceline` folder completely; your plans and recordings are kept.
   - macOS: double-click the zip, then move the `paceline` folder into `SauceMods`.
   - Windows: open the zip and drag the `paceline` folder into `SauceMods`. If you use
     **Extract All** instead, change the destination to the `SauceMods` folder itself and
     remove the proposed `paceline-<version>` from the end of the path. Otherwise you get
     `SauceMods\paceline-<version>\paceline\manifest.json`, and Sauce silently ignores that.
3. Check that this file exists: `SauceMods/paceline/manifest.json`. The `paceline` folder must
   sit directly inside `SauceMods` and contain `manifest.json` itself. Not
   `SauceMods/paceline/paceline/manifest.json`, and not `SauceMods/paceline-<version>/...`: Sauce
   does not find those.
4. Quit Sauce completely and start it again. Sauce only looks for new mods when it starts.
5. On that start Sauce asks **New Sauce MOD Found**. Press **Enable Now**. Sauce then restarts
   by itself after about 4 seconds; wait for it. (If you pressed Ignore, enable **Paceline** in
   Settings, then **Mods**, and restart Sauce once more.) Updating from 0.1.0: replace the
   folder, restart Sauce, skip to step 6. Sauce does not show "New Sauce MOD Found" then.
6. Add the windows: in Sauce's window list, open **Paceline Info** (a small status box) and
   **Paceline Action** (the big countdown and pull display). Optionally also **Paceline Rest**
   (only the countdown, see below). If you had Paceline 0.1.0 open,
   that window is now **Paceline Info**. If the Paceline Info window looks cramped after
   updating, drag it bigger (about 340×190).

## Load the plan

Nothing to load by hand: your captain uploads the plan to the plan server for your club, and
Paceline gets it when you are in the race.

1. Click a Paceline window. This opens the Paceline settings window.
2. Under **Clubs**, check that your club is ticked. The first time, Paceline asks the plan server
   which clubs list your Zwift ID (Zwift must have run once, so Paceline knows it), and ticks the
   first club that lists you by itself. If the table says "No club lists you yet. Your Zwift ID is
   …: send it to your captain.", do that.
3. Under **Plan**, a line says what waits for you, for example "Next: Rollers fast, Thu 19 Nov
   19:30": the next race with a plan listing you, in a club you ticked.
4. In the race the plan arrives by itself. The status line then says "Rollers fast · F9E98R ·
   Kettenfett RC · checked 19:02" (plan, plan code, club, last check) and the plan shows under
   **Plan**. Check the plan code as described below.

<img src="docs/images/settings.png" width="420" alt="Paceline settings, the part for all windows: Get plans from the plan server, ticked, with the line what Paceline sends; the status line Rollers fast · F9E98R · Kettenfett RC · checked 19:02; Next: Rollers fast, Thu 19 Nov 19:30; the plan with its code and six riders, Ben highlighted; Load a plan from a file instead, collapsed; Clubs with Kettenfett RC ticked (lists you · your club since 12 Nov) and Spokesmen CC unticked (lists you); Add club by code; Demo; Pull target W/kg; Advanced, collapsed">

*The settings window below "All Paceline windows": the plan server box with what Paceline sends,
the server plan of Kettenfett RC with its code and riders, and the Clubs table. Made-up clubs and
riders.*

### Clubs

The Clubs table lists the clubs whose plans have your Zwift ID. Paceline takes plans only from
ticked clubs. Tick the club you ride for, and leave a club you don't know unticked.

- A row shows "lists you" while the club has a plan with your Zwift ID, and "your club since
  12 Nov" once you ticked it.
- Only the first club is ticked by itself, and only while the table is empty. Clubs that come
  later show up unticked and have no effect until you tick them. If two clubs list you at once,
  none is ticked and the table says "Several clubs list you. Tick yours." (In a race, Paceline
  ticks the club that has the plan for it.)
- Ticking and unticking apply at once, also during a ride.
- **Private clubs.** A club can be private: then the plan server doesn't show it to anyone without
  its code, and it is never ticked by itself. Your captain gives you the code (10 letters and
  digits, like `7Q4MZ-2KX9B`). Type it under **Add club by code** and press **Add**; case, spaces
  and hyphens don't matter. The club is then added, ticked, and its row shows "private · code
  7Q4MZ-2KX9B", so you can pass the code on to a teammate. Messages:
  - "A club code has 10 letters and digits.": a typo.
  - "No club has this code. Check it with your captain.": nothing is stored.
  - "Too many wrong codes from your network. Try again in an hour."
  - In the row, "this code no longer works: ask your captain for the new one" (the captain made a
    new code), or "private now: enter its code below" (an open club you ticked became private).

### When Paceline checks

Under **Get plans from the plan server** the settings window says what goes to the server:

> When you are in a Zwift event, and when you open these settings, Paceline sends the plan server
> your Zwift ID, the clubs you ticked, the codes of private clubs you added, your event's start
> time and id, your plan code and the Paceline version. A club you ticked sees when you last
> checked.

- **In a Zwift event.** A Paceline window must be open: one of them asks the server, at once when
  the event begins, then every 10 seconds while there is no plan for this event yet or the last
  check failed, else every minute. With **Only during TTT events** (the default) only a TTT
  counts; unticked, any Zwift event does. A team ride outside any Zwift event gets no plan from the
  server: load the file (below).
- **The plan opens 30 minutes before the start.** The server sends a plan only from 30 minutes
  before the team's start time the captain set. Until then the Info window and the settings say
  "Plan opens 19:00 · Rollers fast", and Paceline keeps checking every 10 seconds, so the plan
  arrives within 10 seconds after that time.
- **When the settings window opens** it checks once. That fills the Clubs table and the "Next:"
  line, but never makes a plan active.
- **Nothing else checks.** Outside events (and with the settings window closed) Paceline doesn't
  ask the server at all.
- A server plan from an earlier race is not shown in a new event until this event's answer has
  arrived. When the server has no plan for you in this race, the settings say "No plan for you in
  this race yet." and the old server plan goes away (unless the ride lock below holds it).
- When the captain uploads a changed plan, Paceline switches to it within a minute, also during
  the race (the rider pulling keeps his clock).
- If the server cannot be reached, Paceline keeps the plan it has; the settings window shows the
  error, the overlay windows do not. If that lasts, load the files yourself (below).
- When a club you haven't ticked has a plan for you in this race and no ticked club has one, the
  Info window says, once per club, "Spokesmen CC has a plan for you in this race. Click, then
  tick it under Clubs."

### Two clubs and the teammates in the pen

If two clubs you ticked both have a plan with you as a rider in the same race, the teammates near
you decide; you don't pick. For each plan Paceline counts its riders (not the planner's roster) in Sauce's
list of riders near you:

- In the start pen, as soon as one plan has 2 or more riders more than the other, it is taken. It
  can still change while riders come and go. Until then the newest upload is active.
- At the roll-off the plan with the most riders near you wins, on a tie the newest upload. The
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

- **Watts** come from the JSON, else from the text export, else there are none. When both files
  have them and they differ, the JSON wins (it matches riders by Zwift ID, the text only by name),
  and the import warns: "Pull watts for Ben differ between the files – using the JSON."
- **W/kg** (the default target unit) is the plan's `pull_wkg` for every rider, you included,
  shown with one decimal like Sauce. It is not worked out from watts and weight. Only for a plan
  without `pull_wkg` Paceline divides the watts by the weight, as before.
- A rider with W/kg but no watts gets no target.
- The plan code covers the watts, not the W/kg, so a plan's code stays the same with or without
  `pull_wkg`.

### Load a plan from a file instead

A plan from a file overrides the plan server. Use it when the server is down, or for a team ride
outside a Zwift event.

The captain gives you the files from the [ZwiftGopher TTT planner](https://zwiftgopher.com/TTT/):
the **JSON export**, and if it has no pull watts, the **text export** too. The JSON has the Zwift
IDs and, from the planner's newer exports, the pull watts and W/kg; the text export has the pull
watts.

1. Click a Paceline window. This opens the Paceline settings window.
2. Under **Plan**, open **Load a plan from a file instead** and drop the files into the box, or
   press **Choose files…**. (There is also **Paste instead** if you have the file contents as
   text.) With the plan server switched off the box is open already.
3. You should now see the team name, the riders table and a line "You are *your name* · #position ·
   60s@4.4" (your pull time and target in W/kg, or in watts with that setting). Until Zwift is
   running with your rider, that line says "Waiting for Zwift…" instead. That is normal: the plan
   code check below works without Zwift. Once Zwift runs and you are not in the plan ("You are not
   in this plan", also when you are only in the planner's roster), tell the captain.
4. Check the **Plan code**. It is 6 characters long, and everyone on the team must see the same
   code. Compare it with the captain's. If yours is different, you have a different or older plan
   file: load the files again, and ask the captain to resend them if the code still differs.

While the file plan is active, the settings say "Plan from file, not from the server", with
**Remove**. Paceline still checks the server (for the Clubs table and what waits), but its plans
wait. A file plan ends when the first event after you loaded it is over (for a TTT, 30 seconds
after the finish), or 18 hours after you loaded it, whichever comes first; **Remove** ends it at
once, and the server's plan for this race, if there is one, takes over. With the plan server
switched off (untick **Get plans from the plan server**) a file plan never ends by itself.

Press **Done** to close the settings window.

## During the ride

**Only during TTT events.** Paceline stays quiet until you join a team time trial in Zwift
(Zwift's event type, WTRL's TTT tags, or "TTT" or "Team Time Trial" in the event's name, for
private TTTs; new in 0.2.31): the Action and Rest windows are empty, the Info window
shows one quiet line "Paceline waits for the TTT start pen", nothing records and the plan server
is not asked (only the settings window checks once when you open it). It wakes up when you enter the start pen, and goes quiet again 30 seconds after
the finish. To use Paceline outside a TTT event (a team practice ride, or if Zwift ever changes
how it marks TTT events), untick **Only during TTT events** in the settings window.

**Paceline Action** is the window to glance at while riding:

- While you rest it shows one big clock: the time until your pull starts, in seconds as pulls
  are called (`26s`), above 100 seconds as minutes (`5:47`). It adds up the planned pulls of the
  riders before you plus 10 seconds for each, the rider at the front included (in the races of
  12 Nov 2026 riders went over their pull by about that much, whatever its length: the changeover
  itself). Only the rider directly before you counts his planned pull alone: near the end the clock
  rather reaches 0 a little early, and READY covers the rest until he swings off. So the clock
  simply runs down at a normal change, without a jump when the next rider takes over. The
  countdown is only good to about 10 seconds (riders pull longer or shorter than planned); the
  handover itself is called out by voice. When the rider at the front has pulled his plan plus
  the 10 seconds, the countdown runs on for 3 more seconds (the time Paceline needs to see the
  change) and then waits until the next rider is at the front, so it does not run out while
  someone pulls longer. While it waits it says so: the number is dimmed with a `≥` in front
  (`≥27s`: your pull is at least that far away), and under it, small, how long the rider in front
  is over his plan (`+14`). When the change comes it runs on as usual.
  When the race does not go as planned (a rider swings off early, drops out of the line or comes
  back), the clock corrects itself without jumping where it can. A few seconds it simply runs a
  little faster or slower until it is right. A bigger change it takes at once, softly faded in,
  and the line under it says why for 5 seconds: `ELI out −40s` (amber: your pull comes sooner) or
  `ELI back +1:10` (dim: later), or just the amount (`−25s`) when no rider explains it. A change to
  later waits 3 seconds first, so a short shuffle at the front never moves the clock. In the last
  15 seconds the clock is always exact; if READY was on and the pull moves away again, it says
  `READY off +36s`.
  Right of the clock is your place in the line right now, counted in plan order from the rider
  who is pulling (`#1`): `#2` means you are next.
- **READY:** in the last 10 seconds before your pull the window shows three fixed points, each
  with a small label under it: your target on the left (`4.0`, `W/kg`), your power now small in
  the middle (`3.1`, `now`), and `READY` in amber on the right. The power bar is there already,
  its marker white: it shows where you are against the target, so you come up to it before the
  handover instead of surging (being below it in the draft is right, so nothing turns red yet).
- **During your pull** the same three points: your target on the left, your power now in the
  middle, the time left of your pull in seconds on the right (`110`, `s`; amber in the last 10
  seconds, over time it runs on below zero in amber, `−4`). Below is the power
  bar: the middle line is your target, green is within 5 % of it, amber within 10 %, red beyond.
  The marker is your filtered power: single spikes in Zwift's power are thrown out, the rest is
  smoothed over a few seconds, and the marker only moves once that is more than 2 % (about 5 W)
  away from where it stands. So it keeps still while you ride on target, and a real drop of 10 %
  shows after about 4 seconds. Its colour is the zone it is in. In the first seconds of your pull,
  while you ramp up, the marker stays white. The number in the middle is the marker's value (the
  same filtered power, so they always agree), in the marker's colour; kept small on purpose, so the
  bar stays what you ride by and the number only confirms it. Without pull watts in the plan
  (neither in the JSON nor from a text export) there is no target, so you see `–` as the target,
  your power now, the time and a plain grey bar.
- **A gap in the line** (new in 0.2.28). Paceline watches the distance from each team rider to
  the rider ahead of him. When it is 10 m or more for 5 seconds (15 m on a real climb or
  descent), someone has lost the wheel; the warning ends when the gap has been under 6 m for 3
  seconds. The distance is measured where the line breaks, from the rider ahead of the gap to the
  first one behind it, and shown in metres and in seconds at your speed (`16 m · 1.3 s`). In the
  three recorded races of 12 Nov 2026 this caught every rider who dropped and stayed quiet
  otherwise (4 to 6 warnings a race).
  - **Early stage** (new in 0.2.29): the draft starts to fade from about 6 m (in those races a
    rider got about 31 % of his power from the draft up to 5 m, 22 % at 8 m, 14 % at 10 m, none
    from 15 m). From 8 m for 5 seconds (12 m on a real climb or descent) your power bar gets an
    amber edge during your pull, and the label under your power now says how far back it is
    (`▼ 9 m`): ease off a little before the draft is gone. While you rest, only your own early
    gap shows (`▲ GAP 9 m · 0.7 s`): close up. A threshold of 6 m would have warned 20 to 70
    times a race, as the line normally rides up to 5 m apart; from 8 m it is 4 to 16 times, 2 to
    6 seconds before the full warning at the real drops. Since 0.3.0 it also comes sooner when
    the gap grows past 8 m quickly (10 m for 2 seconds is enough) or when the rider behind is
    clearly slower than the one ahead and easing off (from 7 m): in four recorded races typically
    2 to 6 seconds sooner, with 0 to 4 more warnings a race.
  - **During your pull** a band takes the power bar's place: `▼ GROUP 16 m · 1.3 s` when the
    whole line behind you is gone, `▼ CORA 16 m · 1.3 s` for one rider, `▼ 3 RIDERS …` when the
    line breaks further back. Ease off until it is gone.
  - **Red with a white edge** when the team needs the riders cut off: the team's time is taken on
    its 4th rider over the line (WTRL and ZRL; the plan's minimum finishers if it gives one), so
    with fewer than 4 still together at the front nobody behind the gap may be lost. The group
    behind the puller is always red. **Amber** when the team can spare them (a 6th or 7th rider).
  - **While you rest** the line under the clock says it: `▲ GAP 16 m · 1.2 s` in amber when you
    are the one who lost the wheel (close it), someone else's gap in amber when the team needs
    them (`Cora −16 m · 1.3 s`, `Gap ahead 16 m · 1.3 s`), dim when they can be spared. Your own
    gap and a needed rider go before the standing clock's `+12` while they are amber.
  - **Green** (new in 0.3.0) instead of amber or red, in the same place: the gap is still there
    but getting smaller, the rider behind is closing it himself (in the early stage only the
    `▼ 9 m` label; the bar keeps its normal look). Once it is 1 m wider than its smallest it
    turns amber or red again. A green gap is not urgent: while you rest the standing clock and a
    wheel change cue go before it, and while your own gap is green the full warning of a needed
    rider that is not closing is shown instead (not one of a rider the team can spare).
  - A rider the team can spare who drops 50 m or more is let go: the warning ends and comes back
    only after he has closed up. A needed rider stays in the warning. No warnings at the start
    (the first 60 seconds), while standing still, or in finish mode (from 500 m before the finish
    line, and past it until you stand still or Sauce shows another race).
- **Wheel cue** (new in 0.2.31): the line under the clock tells you whose wheel to find, with
  their kit colour (`Wheel ■ DANA`):
  - **At the start**, from the roll-off until you have been on that wheel for 2 seconds, your
    first pull begins, or 90 seconds have passed. The first puller gets none.
  - **When your wheel changes** because a rider dropped from the group or came back. The cue is
    shown for 15 seconds once the change has held for 3 seconds, and is amber with the place in the
    line when it is not the plan's wheel (`DANA #3`). It is not shown more than once in 30 seconds
    or in the first 45 seconds of the ride. A change during your pull shows after it.
  - Not after every pull, so it means something when it comes. The planned wheel stays in the
    Info window. The wheel comes from the plan and who is with the group, not from Zwift's order,
    so a team riding in a bunch only sees it at the start.
  - Your own gap and a needed rider go first (unless the gap is closing). A change cue goes before
    the standing clock's `+12`, the start cue after it.
- **Paceline Rest** is an optional third window with only the countdown to your pull and your
  place. During your pull it disappears completely, background included, and from `READY` on (the
  last 10 seconds before your pull) too while an Action window is open, which takes over then;
  without one it shows `READY` itself. The Paceline windows notice each other: each one leaves a
  sign of life every 2 seconds, and one not heard for 6 seconds counts as closed.
  While a Rest window is open, the Action window leaves the countdown to it: it stays empty while
  you rest (not even the dash), wakes up with READY in the last 10 seconds before your pull (target,
  power now, the bar), and when your pull starts the time takes over. So if the big countdown in
  the middle of the screen is too much while you rest, open the Rest window and put it wherever it
  suits you, for example lower down. With no Rest window open, the Action window shows
  the countdown itself, so it is never missing. Tip: with Sauce's Transparent theme for the Action
  window, the empty window disappears completely.
- Targets are shown in W/kg (since 0.2.17; before it was watts), everywhere one number. To see
  watts instead, open the settings window and set **Pull target** to **W**. The W/kg is the
  plan's own (`pull_wkg`, see "Pull targets from the plan"), for you too. For a plan without it
  Paceline divides by your weight in Zwift (or the planner's weight if Zwift gives none), with one
  decimal like Sauce; without any weight it shows watts. In W/kg your power bar compares your
  power now in W/kg (by your weight in Zwift, else the plan's) with that target; in W it compares
  watts with the plan's watts. If you had picked W before 0.2.17, pick it once more.
- An empty window means Paceline has nothing to show: outside a TTT event, no plan is loaded,
  Paceline does not know your rider yet (Zwift has not run in this Sauce session), you are not a
  rider in the plan (only in the planner's roster, or not listed), or finish mode (the rotation is off for the sprint):
  from 500 m before the finish line, and past the line until you stand still or Sauce shows
  another race.
- An amber `?` means Paceline cannot tell: no teammate is near you (dropped, or their data has
  stopped), there is no current Zwift data for your own rider (Zwift stopped, you only
  spectate, or no data for 15 seconds), or nobody is being tracked at the front. Before the
  start the window stays empty instead: while you stand still (the start pen) Paceline tracks
  nothing. After a stop during the ride the windows stay empty for 40 seconds after rolling on,
  because the order at the front is chaos then.
- **The start is set, not detected.** Plan #1 does the start pull (in the TTTs of 12 Nov 2026 he
  always did, often after someone else led for the first seconds). In the start pen his windows
  are armed already: `READY` with his target, his power now and the bar. When the group rolls
  off he pulls at once, and his first pull is his plan time plus 30 seconds (a 2:00 pull shows
  2:30), counted from the roll-off. Everyone else's windows stay empty until #1 has been in front
  for 3 seconds (the start chaos is over), at most 60 seconds. For those 60 seconds Paceline
  detects nothing at the front, no climb either. After that it follows the front again; a rider
  other than #1 then has to stay in front for 15 seconds to count.
- **Rollers and real climbs.** A hill is a climb from 4 % and a descent from -3 % (until the road
  is back below 2 % or above -2 %). In a TTT event Paceline knows the hills before you get there:
  it loads the route's elevation profile from Sauce and finds your place on it from your altitude
  (after the first kilometre; one-lap events). A **roller** (at most 400 m long and 15 m up or
  down, like all hills of the 12 Nov 2026 TTT) does not stop anything: the countdown goes on, and
  only the rider pulling or the plan's next rider can take the front, so a teammate sprinting up
  from behind (often on descents, while the front rider drops back) is ignored. A **real climb or
  descent** pauses the rotation: a triangle (`▲`, or `▼` for a descent). Without the profile
  (before your place on it is known, or on a route Sauce has no profile for) Paceline goes by the
  grade under your wheels: a hill counts once the grade has held for 5 seconds, as a roller for
  its first 45 seconds and as a real climb or descent after that. If the same rider is still
  in front after a real climb, his pull time simply goes on. If another teammate is in front first and
  the rider from before comes back to the front within a minute, his pull time goes on from
  where the climb stopped it instead of starting at 0; the climb and the other rider's turn do
  not count (the same after riding alone).
- The Info window shows `Front: –` in these cases, or "Climb – rotation paused", "Descent –
  rotation paused" or "Finish – rotation off".

**Paceline Info** is the status box. Every line keeps its place, so the box never jumps. The text
grows and shrinks with the window: make the window bigger for bigger text (every line stays on
one row, so a wider window helps most). On top what stays the same during the ride, in the order
you ride (the wheel you follow, then you); below, set apart, the live part. All rider lines
share one set of columns: label, plan number, kit swatch, name, and the pull right-aligned and
lined up on the `@` (`60s@4.4`: pull time, then the target without its unit, which the setting
below decides):

- The plan line: the plan's name and code (`Rollers fast · plan F9E98R`), with the club when you
  ticked two or more. Without a plan it says "No plan – click to load one", or "Plan opens 19:00 ·
  Rollers fast" while the plan waits for its 30 minutes, or that another club has a plan for you.
- **Wheel:** the wheel you follow, by the plan: the rider before you in plan order (the
  last rider if you are #1). Learn it before the start; it stays put while you pull too, since
  that is the rider you drop in behind. If that rider is not with the group, it shows in amber
  who to follow for now, e.g. `Dana → Cora`. Zwift's positions behind the first few riders are
  often jumbled, so Paceline takes this from the plan, not from where riders appear.
- **You:** your number in the plan, a swatch of your kit colour (so you know
  which socks/kit to pick), and where the Wheel line has its name your planned pull time and
  target (`#4 ■ 60s@4.4`).
- **Front:** who is pulling, their number and kit colour, and at the right the time left of their
  pull in seconds, as pulls are called (`12s`); over their time it runs on below zero in amber
  (`−4s`). During your own pull it says **You**. A dim `–` means no rotation right now (before the start, alone, no data).
- **Next** (captain mode): tick **Captain mode** in the Info window's settings (at the top, under "This window"), and a line
  under Front shows who pulls next with their full pull line (`#4 ■ Dana  60s@4.4`),
  ready to call out. Dimmed, it is the plan's guess: before the start it shows plan #1 (who
  starts), on a real climb or descent, riding alone or without data the plan's next after the last puller. It
  turns live again as soon as a puller is at the front; in finish mode (from 500 m before the line until you stop) it shows `–`. Make the Info window a little taller for it.
- **The whole rotation** (before the start for everyone): one row per rider, `#3 ■ Name
  60s@4.4`, from the rider pulling (before the start from plan #1), you highlighted. Once the
  rotation runs it goes away. In **Captain mode** you can keep it: tick **and keep the whole
  rotation listed during the ride** below it. Then it stays and turns with every change. Riders
  dropped from the group (more than 20 m back for 20 s) move to the bottom (new in 0.2.30), dimmed, in plan order
  below a dashed line, and come back into the rotation once they are with the group again. Its first two rows take the place of the Front and Next lines: the
  rider pulling (bold, with the time left, or `▲`/`▼` while a real climb or descent pauses the
  rotation) and the next rider, in a larger text and set apart from the rest by a small gap. Make the Info window
  taller for it.
- The recorder line.

How Paceline decides who pulls: the puller is simply the frontmost rider of your team group
(teammates within 20 m of each other), once they have been in front for 3 seconds. Within 30
seconds of a change at the front (a new puller, your own pull starting or ending, the end of a
real climb or descent) a new front rider must stay there for 15 seconds instead, so a short shuffle in
the chaos does not count as a pull; his pull time still counts from when he got there. The same
15 seconds apply to a teammate who would skip the planned next rider (one or two places further
on in the plan), for example when he shows up at the front for a moment during a change. The rider
who pulled just before (the one before the puller in the plan) has to be back in front for 30
seconds to take the pull back: two riders swapping the front, or his last seconds while the new
puller settles in, do not throw your countdown a whole round up and down (after a climb or descent
the order is mixed up, so there the 15 seconds apply). Nothing is
tracked while you stand still (below 2 km/h, e.g. in the start pen). The pull
time counts from when they got there. Your own pull is also picked up from your riding, once
you are the next rider and the rider in front is due (10 seconds or less of his pull left) or
gone (nobody of the team ahead of you): it starts when you jump up in power and your draft
drops to zero, or as soon as your draft is zero with a teammate behind you. It ends when your
power drops sharply below 130 W after at least 20 seconds of pulling, so swing off clearly when
you are done. The time to your pull adds up the planned pulls of the riders before you, plus 10
seconds for each changeover, skipping riders who are not with the group. Paceline does not know the plan was followed: after
a crash, a dropped rider or a messy changeover the display can be wrong for a while. Ride the
plan and talk on voice; use the display as a help, not as the referee.

Tip: open both Paceline windows before the start. A window opened mid-race shows its own pull
timing until the next handover.

**Demo:** to place and size the windows without Zwift, open the settings window (the tune icon
or a click on a Paceline window) and press **Start demo**. For 10 minutes all windows show a
made-up ride with your plan (or a sample plan if none is loaded), marked `DEMO`. Zwift data is
ignored and nothing is recorded or uploaded meanwhile. **Stop demo** ends it early.

**Background:** the windows look like Sauce's own: theme colours, background texture, and the
theme's transparency (with a **Transparent** theme such as Dark the background disappears and
shows again when you move the mouse over the window). For your own colour or opacity, open the
settings from that window and tick **Solid background** under Appearance and set the opacity with the slider (100 = opaque). Each
Paceline window keeps its own, as in Sauce's windows; the Action window has its own settings
window for that.

### Recorder

- Start Zwift and Sauce as usual and keep a Paceline window open (either one records). The Info
  box shows the plan name and code, and either "Recorder ready (needs 2 team riders)" or "● REC"
  with a timer.
- Recording starts by itself when you enter the TTT start pen and stops by itself 30 seconds after
  the finish, once Paceline has a plan with you in it (it may arrive a few seconds into the pen),
  with or without teammates near you, so there is a recording also when something went wrong.
  Without such a plan it does not record (new in 0.2.31: that recording would never go up), unless
  you tick **Also record without a plan** in the settings window (under **Advanced**). It holds you and the plan's
  riders (and the planner's roster); when fewer than two of them are near you (no plan, the wrong plan), it also
  holds the riders of your event within 300 m of you, the 15 nearest, which in a TTT is in
  practice your team. In between it keeps recording even when you ride alone (dropped). After
  the stop the ride goes up, if you upload (that needs a plan from a club you ticked, or a file
  plan of one of its teams; otherwise export it from the settings window). You do not have to
  press anything. (With **Only during TTT events**
  unticked it works as before 0.2.18: it starts when you and a teammate from the plan are near
  each other and stops 120 seconds after fewer than 2 are left.) Each recorded second also notes who Paceline thought
  was pulling and what the windows showed (countdown or pull, your place, Wheel, the captain's
  Next, a gap warning), so the ride can be compared with the plan afterwards. It also notes the Zwift event you
  are in (name, type, subgroup and start time) and Zwift's ride clock, so a later version can tell
  the start pen from the race.
- If the box says "Waiting for Zwift…", Sauce does not see your own rider (for example when you
  only spectate). Nothing is recorded then.
- Hiding Sauce's overlays with its hotkey is fine, recording continues. Closing the Paceline
  windows or Sauce stops recording.
- With more than one Paceline window open, only one of them records. The others just show
  the status.
- Some Zwift events hide the overlays and rider data from Sauce on purpose (events marked
  "nooverlays" or "hidethehud"). Sauce gets no nearby riders there, so nothing can be recorded.

**The Paceline windows catch mouse clicks**, even where you hardly see them. Put them over a part
of the Zwift screen where you never click. To move or close one, right-click it: that shows Sauce's
title bar. Right-click again to hide it.

## Why we ask for your ride data

Paceline does not know who is pulling. It works it out every second from what Zwift tells
Sauce: who is at the front of the group, power, draft and speed. The rules for that (how long a
rider must be in front to count as the puller, how big a power jump starts your pull, how sharp
a drop ends it, how far apart riders may be and still count as one group, from which gradient a
climb pauses the rotation) were set from a few FIT files of past races. Those files have no
positions in the line and no draft, so nobody has checked the rules against the data Paceline
actually sees during a race. Your recordings do that.

With them we can check, second by second, what Paceline showed against what really happened:

- Did it see the change at the front on time, or late, or not at all?
- Did your own pull start and end when you actually went to the front and swung off?
- Did the place in the line (`#3`) and "Wheel" match the real order?
- How old is your teammates' data when it reaches Sauce, and how much does that jumble the order?
- Is draft a better signal than position? This decides how the next version detects pulls.

The recordings also show how the plan held up in the race: how long each pull really lasted, at
what power, and where the rotation broke up (climbs, a dropped rider, the sprint). That helps to
set pull times everyone can actually hold. It is not a ranking, and nobody is judged on it.

What happens to the data: on the plan server only the Paceline operator opens the recordings, to
analyse your team's rides and improve Paceline. Your captain sees that a recording arrived and can
delete it, but can't download it. Recordings are not passed on and not published. Heart rate and
cadence are never uploaded. The server deletes recordings after 90 days. You can always ride
without sending anything: a recording stays on your computer unless you export it or tick the
upload box.

## After the ride

1. Click a Paceline window to open the settings.
2. Open **Advanced**, and under **Recordings** find your ride (it shows the date, how long it lasted and the plan code).
3. Press **Export**. A normal Save dialog opens and asks where to save the file (it ends in
   `.jsonl`). Pick a place you can find again, such as the Desktop.
4. Send that file to whoever analyses your team's rides.

You can export a ride more than once. **Delete** removes a recording from your computer for good.
Paceline keeps the newest 20 recordings and removes any older than 14 days, so export soon after
the ride.

### Recordings upload

Instead of exporting by hand you can let Paceline send each ride to the plan server. It is off
until you switch it on: in the settings window, under **Advanced**, tick **Upload my recordings
after each ride**. Next to the box the settings say what that means:

> Sends each finished recording (power, draft, speed and position of you and the plan riders; no
> weight or FTP) to the plan server. Only the Paceline operator can open the file, to analyse your
> team's rides and improve Paceline; your captain sees that it arrived and can delete it. Heart
> rate and cadence are never sent. The server deletes recordings after 90 days. Only rides
> recorded after you tick this box go up on their own; send older ones with Upload.

- **What is sent:** only what the analysis needs: power, draft, speed and position of you and
  of the riders in the plan, with your Zwift ID and the plan. When the plan changes during the
  ride, the riders of the new plan are kept too (new in 0.3.0). Left out: everyone's heart
  rate (yours too) and cadence, weight, W/kg and FTP in the plan, and any rider you watch who is in
  no plan of the ride. Paceline's notes on the rotation in each second (who pulled, who was in
  front, whose wheel, whose gap) name only riders of the plan loaded at that moment, or you. The
  server keeps the riders of the plan you started with as they are; a rider who joins later stays
  only if the plan named at that moment is a plan of the team that the server stores. A rider of a
  file plan loaded during the ride loses his power, draft, speed and position there, but those
  notes can still name him by his Zwift ID. The file you export yourself still has everything.
- **Where it goes:** to the plan server set under **Advanced** (normally the build's own, see
  "Beta" above), filed under your club and team: the team whose plan was active at your roll-off
  (the ride lock's). A ride with a file plan goes up only when a club you ticked has a team of that
  name; otherwise it stays on your computer, as do recordings made with 0.2. On the server only
  the Paceline operator opens the file; your captain sees that it arrived and can delete it, but
  can't download it. The server deletes recordings after 90 days.
- **When:** right after a recording stops, or later while a Paceline window is open and Zwift
  runs; never while it is still recording, and only while the plan server is switched on. Only
  rides recorded after you ticked the box go up on their own; older ones, and recordings shorter
  than a minute or older than 7 days, are not sent automatically, but **Upload** sends them. If
  the server cannot be reached, answers with an error or has no room, Paceline tries again every
  5 minutes.
- **Errors that a retry can't fix** stop the automatic upload of that ride; **Upload** tries once
  more:
  - "you are not in this team on the plan server"
  - "this team is not on the plan server"
  - "a different copy of this recording is on the plan server"
  - "the plan server refused this recording"
  - "recording too large for the plan server"
- Under **Recordings** each ride then shows "uploaded", "waiting for upload" or "not sent
  automatically" (with the reason if the last try failed), and **Upload** sends a ride right away.

## Plan server

The plan server keeps the team plans that clubs upload and gives each rider's Paceline the plan for
the race. When you are in a Zwift event, and when you open these settings, Paceline sends the plan
server your Zwift ID, the clubs you ticked, the codes of private clubs you added, your event's
start time and id, your plan code and the Paceline version. A club you ticked sees when you last
checked. Recordings go up only when you tick the upload box (see "Recordings upload").

**Privacy.** What the server keeps, who sees it, for how long and where it is processed is on the
privacy page of the server you use: its address plus `/privacy` (for example
`https://ttt.example.org/privacy`). That page is the binding text, not this README.

Operators find the server's pages, mail setup and limits in `server/README.md`.

## For developers

- `npm test` runs the tests.
- Test fixtures are made up: no planner exports or other real rider data, made-up names and
  numbers only (see `tests/fixtures/README.md`). This repository is public.
- `bash scripts/zip.sh` builds `dist/paceline-<version>.zip`.
- `node tools/ride-report/report.mjs <recording.jsonl>` writes the standard analysis of a ride
  recording (see `tools/ride-report/README.md`).
- Open `pages/paceline.html?demo` and `pages/action.html?demo` through a local web server to try
  them without Sauce (load the plan first in `pages/settings.html?demo`). The demo team rotates
  every 20 s for 60 s, then only you are left for 130 s. Gaps open in your first pull (the
  group), in the pull after it (you), in your second pull (the early stage only) and in your last
  pull (one rider); each closes again slowly and shows green meanwhile.
