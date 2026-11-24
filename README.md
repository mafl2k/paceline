<img src="docs/images/banner.png" width="100%" alt="Paceline, hand-drawn on a notebook page: four riders in a line seen from above, an orange arrow showing the rotation, and a team plan in time@W/kg with crossed-out and corrected pulls">

# Paceline 0.3.7-beta.0

Paceline is a mod for Sauce for Zwift that carries your team's TTT plan into the ride. It shows who
is pulling, the countdown to your pull and, during your pull, your target and a power bar. It also
records how the team rides together (who is near you, power, speed, positions) for the team's
analysis. Paceline doesn't calculate plans: they come from the
[ZwiftGopher TTT planner](https://zwiftgopher.com/TTT/), and your captain sends them to the plan
server, where Paceline picks up the plan for your race.

<img src="docs/images/sheet-defaults.png" width="720" alt="Two Paceline Action windows. Recovery: 13 s and #2 in big narrow numbers, caption '#2: you pull next'. Your pull: target 4.0 W/kg, your power now 3.9 in green, 114 s left, and the power bar with red, amber and green zones and its marker in the green, caption 'target · your power · seconds left' and 'bar: green is within 5 % of your target'.">

## What the windows show

<img src="docs/images/sheet-before.png" width="1000" alt="Three windows. READY: the Action window with target 4.0 W/kg, your power now 2.9 and an amber READY, the power bar with a white marker, caption 'last 10 s: come up to your target before the handover'. Rest window: 13 s and #2, caption 'the countdown alone, the Action window then shows your fields'. Recovery with fields: the Action window with heart rate 145 bpm on the left, power 2.9 in the middle, the countdown 3:48 and #6 on the right, and under them in amber ▲ GAP 10 m · 1.3 s, caption 'right: countdown and your place' and '▲ GAP: you lost the wheel, close it'.">

<img src="docs/images/sheet-gaps.png" width="1060" alt="Six Action windows with a gap in the line. Pull · gap opening: target 4.0, your power 3.7 in amber with ▼ 14 m under it, the power bar with an amber edge, caption '▼ 14 m: a gap opens behind you, ease off a little'. Pull · group lost your wheel: in place of the power bar a red band ▼ GROUP 16 m · 1.3 s, caption 'always red: you are alone in front, ease off until the band is gone'. Pull · 4th rider drops: a red band with a white edge, ▼ DANA 16 m · 1.3 s, caption 'red: 3 left, ease off'. Pull · one rider drops: the band in amber, ▼ FINN 16 m · 1.3 s, caption 'amber: 5 left, drop acceptable'. Pull · gap closing: the same band in green, caption 'green: they are closing it themselves, not urgent'. Recovery · you lost the wheel: 3:41 and #6, under it in amber ▲ GAP 12 m · 1.0 s, caption '▲ GAP: your own gap, close it'.">

<img src="docs/images/sheet-info.png" width="800" alt="Two Info windows. Info: Rollers · fast demo · plan RDXZ23, Wheel #6 Finn Weber, You #1 120s@4.0 in green, Front #6 Finn Weber 4s, REC 00:10 · 6 riders, caption 'Wheel: whose wheel you follow by the plan' and 'Front: who pulls, seconds left'. Info, captain mode: the Wheel line in amber, #4 Finn Weber → Dana Lorenz; then the table with you, Alma Keller, pulling in green (103s), Ben Richter next, Cleo Maier and Dana Lorenz, and below a dashed line Eli Sommer and Finn Weber, dimmed, caption 'amber →: your wheel is gone, follow Dana' and 'below the dashed line: dropped riders'.">

<img src="docs/images/sheet-signals.png" width="720" alt="Four Action windows while resting. Wheel cue: 51s and #2, under it Wheel, a black kit swatch and DANA #1 in amber, caption 'amber: your plan wheel dropped, find this wheel instead'. Correction: the countdown 1:44 dimmed and #3, under it ELI, FINN out −45s in amber, caption 'ELI, FINN out −45s: your pull comes sooner'. Waiting for the change: ≥12s dimmed and #3, under it +19, caption '≥12s: your pull is at least 12 s away, +19: the puller is 19 s over his plan'. Real climb: only a dim triangle, caption '▲: the order broke on the climb, rotation paused until it is back'.">

*Demo data with made-up riders.*

More on these in [Paceline Action](docs/guide.md#paceline-action) and
[Rollers and real climbs](docs/guide.md#rollers-and-real-climbs).

## Install

You need Sauce for Zwift installed and working.

1. In Sauce, open **Settings**, then **Mods**, and press **Open unpacked SauceMods folder**. It
   opens the right folder, also with OneDrive or a translated "Documents" name. Without that
   button, the folder is normally:
   - macOS: `~/Documents/SauceMods`
   - Windows: `%USERPROFILE%\Documents\SauceMods`, with OneDrive maybe
     `OneDrive\Documents\SauceMods`

   If the `SauceMods` folder does not exist yet, create it.
2. Download the newest `paceline-<version>.zip` (for example `paceline-0.3.3.zip`) under **Assets**
   of the [latest release](https://github.com/mafl2k/paceline/releases/latest). Betas such as
   `paceline-0.3.4-beta.5.zip` are not the latest release: they are on the
   [releases page](https://github.com/mafl2k/paceline/releases), marked **Pre-release**. Put the
   `paceline` folder from the zip into `SauceMods`. When updating, replace the old `paceline`
   folder completely; your plans and recordings are kept.
   - macOS: double-click the zip, then move the `paceline` folder into `SauceMods`.
   - Windows: open the zip and drag the `paceline` folder into `SauceMods`. With **Extract All**,
     change the destination to the `SauceMods` folder itself and remove the proposed
     `paceline-<version>` from the end of the path. Otherwise you get
     `SauceMods\paceline-<version>\paceline\manifest.json`, and Sauce silently ignores that.
3. Check that `SauceMods/paceline/manifest.json` exists. Sauce does not find
   `SauceMods/paceline/paceline/manifest.json` or `SauceMods/paceline-<version>/...`.
4. Quit Sauce completely and start it again. Sauce only looks for new mods when it starts.
5. Sauce asks **New Sauce MOD Found**: press **Enable Now**. Sauce restarts by itself after about 4
   seconds; wait for it. If you pressed **Ignore**, enable **Paceline** under **Settings**, then
   **Mods**, and restart Sauce once more. An update shows no "New Sauce MOD Found": go on with
   step 6 after the restart.
6. In Sauce's window list, add **Paceline Info** (a small status box) and **Paceline Action** (the
   big countdown and pull display), and if you like **Paceline Rest** (the countdown alone).
   Outside a TTT event they are invisible: click where one sits to open the settings window, and
   press **Start demo** there to see them. If the Info window looks cramped, drag it bigger (about
   340×190).

From its first store release on, Paceline is also in the Sauce mod store (**Settings**, then
**Mods**), and a store install updates by itself when Sauce starts; betas come only as a zip. To
switch from a folder install, remove the old `paceline` folder from `SauceMods` (or disable that
copy under **Mods**) and restart Sauce, so the windows don't come twice, then add the windows again:
plans, preferences and recordings stay, but each window's appearance settings start fresh.

## Before the race

- Click where a Paceline window sits to open the settings, and check that your club is ticked under
  **Clubs**. The plan then arrives by itself in the race; there is nothing to load by hand.
- Check the plan code with your team: everyone must see the same one.
- The windows are invisible outside a TTT. **Start demo** in the settings shows them for 10
  minutes, so you can place and size them.
- The windows catch mouse clicks, even where you hardly see them. Put them over a part of the Zwift
  screen where you never click. Right-click one to show Sauce's title bar for moving and closing.
- Tick **Captain mode** in the Info window's settings for the Next line. Tick **and keep the whole
  rotation listed during the ride** below it to keep the whole rotation too.

Clubs, private club codes, when Paceline checks and loading a plan from a file are in
[Loading the plan](docs/guide.md#loading-the-plan); everything about the windows is in
[During the ride](docs/guide.md#during-the-ride).

## Your ride data

Paceline doesn't know who is pulling. It works it out every second from what Zwift sends: who is at
the front, power, draft and speed. The rules for that can only be checked and improved against real
races. Without riders' recordings Paceline can't get better, so please send yours.

- Paceline records the ride on your computer.
- Tick **Upload my recordings after each ride** in the settings to send your rides, or export a
  recording and send it yourself.
- On the plan server only the Paceline operator opens recordings, to analyse your team's rides.
  Nothing analyses them automatically yet.
- Heart rate and cadence are never uploaded.
- The server deletes recordings after 90 days.

What is sent, the full reasons and how to export a ride:
[Your ride data](docs/guide.md#your-ride-data).

## For captains

<img src="docs/images/sheet-captain.png" width="840" alt="Three phone screens of the plan server. Your club: the hub of Kettenfett RC with Club settings, Nothing to do · next race Thu 19 Nov 19:30, the table of teams racing that day with start, live plan and riders, and the teams Rollers, Sprockets and Cogs, caption 'next race and your teams at a glance'. Plans and races: the team page of Rollers with Team settings, Plan on ZwiftGopher and Upload a file, the race Thu 19 Nov · 19:30, the plan fast with v1 marked LIVE and SENDING (4/6 have it), the plan slow, and the riders on 'fast' v1 with plan code RDXZ23, the one of the mod's demo, starting with Alma Keller at 120 s @ 4.0, caption 'LIVE: riders get this plan'. Make live: 'easy' v2 picked, its plan code against live v1, the rider table with Alma Keller NEW and Gina Hoff crossed out, the lines Alma Keller moves from Sprockets to Rollers and Still to do: Sprockets, and the Make live button, caption 'against the live version: who is new, who is out'.">

1. Register your club on the plan server, [https://ttt.mafl.net](https://ttt.mafl.net). The club
   link comes by mail: open it within 24 hours and keep it, it is the club's link for good.
2. Add a team and say when it races.
3. **Plan on ZwiftGopher** opens the planner; the plan you send from there arrives on the team
   page. Or export it as JSON and use **Upload a file**.
4. Press **Make live**. Riders listed in the plan get it in the race, from 30 minutes before the
   start.

Private clubs, versions, the rider table and race day are in
[For captains](docs/guide.md#for-captains).

## More

The [guide](docs/guide.md) has everything Paceline does, for riders and for captains. Questions and
bug reports go to [GitHub Issues](https://github.com/mafl2k/paceline/issues).

## For developers

Tests, building and releasing: [docs/development.md](docs/development.md).
