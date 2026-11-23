# Test fixtures

This repository is public. **No planner exports or other real rider data as fixtures: made-up
names and numbers only.** That covers names (also in test titles, comments and strings), Zwift
IDs, team and club names, weights, heights, FTP, power profiles, pull watts, race dates tied to a
team, and recordings. Do not copy a real export and replace only the names: the numbers, tags
like `[XYZ]` or a country code and the team name still identify the rider.

- `rollers.json` / `rollers.txt`: a made-up ZwiftGopher planner export (JSON and text export) of
  the team "Rollers" with six riders and one on the bench. Names, body data, power profiles and
  pull watts are invented; it keeps the planner's quirks (a numeric-string `target_speed`, an HTML
  entity, a trailing space and a double space in names, a `(club)` suffix on the bench).
- `ride-report/make.mjs`: builds the synthetic recordings for `tests/ride-report.test.mjs`.
- `zone23-power.json`: a bare 1 Hz power series (watts only) of the maintainer's own ride, with
  no name, ID or body data. It predates this rule; add nothing like it.

To get a new case from a real ride, build a synthetic one that shows the same behaviour.
