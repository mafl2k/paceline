# For developers

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

## Releasing

Work happens on branches off `next`; `main` is production and `next` is the beta channel. A push
to either builds and deploys what changed. Every change a rider or a team captain can notice gets
one plain line in `CHANGES.md`, under `## Unreleased`, `### Mod` or `### Server` (see the header of
that file). Those lines become the release notes of GitHub, GitLab and the Sauce mod store.

To promote `next` to production, run the manual job `promote` (the play button) on a branch pipeline
of `next`. It does the release with git only:

- It gives each part that changed its final version (`0.3.4-beta.5` becomes `0.3.4`) and the part
  that did not keeps main's version; the channel in `pages/src/version.mjs` becomes `release`.
  `CHANGES.md`'s `## Unreleased` becomes `## <version> (<date>)`. A part counts as changed when its
  content differs from `main` (the mod's files, `README.md` included because it ships in the zip;
  for the server `server/` and the two shared engine files); a version number alone is no change.
- That commit is merged into `main` (a merge commit). `next` moves to that merge plus one commit
  with the next betas (`X.Y.(Z+1)-beta.0` for each released part), and is pushed without a
  pipeline.
- It refuses, and says why, when `main` has commits `next` lacks (a hotfix not merged back), when
  `next` moved since the pipeline started (run the newest one), when a released part's final
  version is not above `main`'s, when the mod changed but `CHANGES.md` has no `### Mod` line, or
  when the notes match the deny list of names that must stay out of the public repository (it only
  warns when `PUBLIC_DENY_REGEX` is not set; the public export is then the last gate). A re-run
  after `main` went out only finishes `next`. `DRY_RUN=1` shows the plan and changes nothing.
- The button only appears on a branch pipeline of `next`: while a merge request from `next` is open
  GitLab runs merge request pipelines instead, and those have no button.

The push to `main` then releases by itself. It updates the public GitHub repository, builds the
production server image when the server changed (its deploy stays a manual play button), and, only
when the mod changed, makes the GitLab release, the GitHub release with the zip and runs the mod
store job.

A branch cut before a promote can merge its `CHANGES.md` line without a conflict into the section
that was just released, and the line then misses the next release notes. After a promote, open
branches first merge `next` and check that their line sits under `## Unreleased`; when you merge a
branch into `next`, look at where its line landed.

A change that touches no mod or server file (only scripts, CI, tests, `store/`, `CHANGES.md`) is not
a promote: the job says "nothing to promote" and exits 0, and the change reaches `main` with the
next real promote. When it must reach `main` sooner, take the hotfix route below without a version
bump or a `CHANGES.md` line.

Retrying a failed `mod-store` job re-runs the old commit, so after a fix, or after setting
`STORE_FORK` and `STORE_TOKEN` late, start a new pipeline on `main` instead: Build, Pipelines,
**Run pipeline**, branch `main`. `changes:` rules count as true in such a pipeline, so the mod jobs
run, and `mod-store` runs only if both store variables are set (and `main` has the fixed script).
Expect the rest to run again too: the GitLab release finds its tag and does nothing, `github-sync`
runs, the server image is rebuilt under the same version, and `deploy` shows up as a manual button
you leave alone. `mod-store` itself does nothing when the store or the fork branch has the version
already (the latter prints the link again).

The `mod-store` job uploads the zip to the Sauce mod store's asset API and writes the release into
the store's `directory.json` on the branch `paceline-<version>` of our fork of
`SauceLLC/sauce4zwift-mod-store` (the fork's `main` is synced with upstream first). Our entry keeps
that one release; the notes are the version's `### Mod` lines. Nothing older ever replaces a newer
store release. The job prints a link: open it, press **Create pull request**, and Sauce reviews and
merges it. Nothing is listed in the store before that merge. The entry's id, name, description,
tags, logo, home page and `minVersion` come from `store/paceline.json` at every release. The store
text is checked against `PUBLIC_DENY_REGEX` by the job itself; the export's fixed list of internal
names only applies to the GitHub export.

CI variables (project settings, masked; the person who owns the accounts creates the tokens):

- `PROMOTE_TOKEN`: a GitLab project access token with `write_repository` and a role that the branch
  protection of both `main` and `next` lets push (`next` must be protected for a protected
  variable). Without it the promote job does not exist.
- `STORE_FORK` (`owner/name` of the fork) and `STORE_TOKEN`: a fine-grained GitHub token for the
  fork only, with **Contents** read and write. If upstream changes files under `.github/workflows/`,
  syncing the fork may also need the **Workflows** permission. Without both the job does not run.
- `PUBLIC_DENY_REGEX`: the names that must never go public (also used by the export). The store
  job refuses without it; `promote` only warns.

Watch `main`'s pipeline after a promote. The push to `main` is made with `PROMOTE_TOKEN`, so
the token's bot user starts that pipeline, not you. GitLab's failure mail goes to that bot and the
Claude failure triage (routed by the login that started the pipeline) finds no routine for it, so a
failed release job tells nobody. `promote` prints the link `<project>/-/pipelines?ref=main` after
the push: open it and check that the pipeline went green. For failure triage on that pipeline,
set the routine variables for the token's bot login, `CLAUDE_ROUTINE_FIRE_URL_<BOTLOGIN>` and
`CLAUDE_ROUTINE_TOKEN_<BOTLOGIN>` (`<BOTLOGIN>` is the bot's GitLab login in upper case, every
character other than A-Z and 0-9 as `_`), pointing at your routine like your own pair does.

A hotfix is a fix for production that cannot wait for `next`:

1. Branch off `main` (`git worktree add -b hotfix-<topic> ../paceline-hotfix-<topic> main`), make
   the fix, bump the version of the part (a plain `X.Y.Z` to `X.Y.(Z+1)` in all version files the
   part has: for the mod `manifest.json`, `package.json`, the README title and `VERSION` in
   `pages/src/version.mjs`, whose `CHANNEL` stays `'release'` on `main`; for the server
   `server/VERSION`) and add the section `## <version> (<date>)` with its lines to `CHANGES.md`.
2. Merge it into `main` after a yes (a merge commit); the release runs as for any push to `main`.
3. Merge `main` into `next`. Expect conflicts in the version files and in `CHANGES.md`: keep
   `next`'s lines and `## Unreleased`, add the hotfix section, and keep `CHANNEL` at `'beta'` in
   `pages/src/version.mjs`. Bump `next`'s betas past the hotfix version (a hotfix `0.3.5` makes
   `0.3.5-beta.0` too low; use `0.3.6-beta.0`). Until then `promote` refuses on purpose. After any
   promote (CI pushes the betas commit to `next`): fast-forward your local `next`. CI never pushes
   a merge-back you made by hand; you push that.
