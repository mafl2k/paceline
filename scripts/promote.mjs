// GitLab CI (manual job "promote" on branch next): makes the beta versions final and promotes next
// to production. Steps, all with git:
//   1. fetch main and next; stop when next moved since this pipeline started (re-run the newest one);
//   2. stop when origin/main has commits origin/next lacks (a hotfix not merged back: merge main
//      into next first);
//   3. the mod changed = mod content differs between main and next, the server likewise (the paths
//      below, as in .gitlab-ci.yml minus the CI file; version fields do not count: next always
//      carries betas, so a version alone is no change);
//   4. the version commit on next: the final version (0.3.4-beta.5 -> 0.3.4) of each part that
//      changed, main's version for a part that did not, CHANNEL 'release', and CHANGES.md's
//      "## Unreleased" becomes "## <version> (<date>)" (the mod's version when the mod changed, else
//      the server's). A mod change needs a "### Mod" line there; the notes must pass
//      PUBLIC_DENY_REGEX (never printed, nor what it matched);
//   5. that commit is merged into main (--no-ff); next moves to that merge and gets one more commit,
//      the next betas: X.Y.(Z+1)-beta.0 for each promoted part, next's old version for the other,
//      CHANNEL 'beta';
//   6. main is pushed (its pipeline releases what changed), then next with -o ci.skip.
// A re-run after main went out but the next push failed finds main containing next: it makes the
// betas commit on main again and pushes next only. It never merges twice and never force-pushes.
//
// Environment:
//   PROMOTE_TOKEN       GitLab project access token (write_repository), only in the push URL
//                       https://oauth2:<token>@<CI_SERVER_HOST>/<CI_PROJECT_PATH>.git, which is a
//                       per-command git option: never stored in .git/config, never printed.
//   CI_SERVER_HOST, CI_PROJECT_PATH, CI_COMMIT_SHA   predefined CI variables
//   CI_SERVER_TLS_CA_FILE   the GitLab server's CA chain, given to git as GIT_SSL_CAINFO
//   PROMOTE_GIT_NAME / PROMOTE_GIT_EMAIL   author of the commits (default "Paceline CI" / ci@invalid)
//   PUBLIC_DENY_REGEX   names that must never go public (as for scripts/export-public.sh)
//   DRY_RUN=1           fetch, read and plan, log what would happen, change nothing (no token needed)
import {spawnSync} from 'node:child_process';
import {writeFileSync, realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {unreleased, release, notesText, denied} from './changes.mjs';

// The git-diffed parts of the path lists. The version files are left out: pages/src/version.mjs
// (CHANNEL is 'beta' on next, 'release' on main) and server/VERSION. manifest.json and README.md
// are compared without their version (versionless below).
export const MOD_PATHS = ['pages/', ':(exclude)pages/src/version.mjs', 'scripts/zip.sh'];
export const MOD_VERSIONED = ['manifest.json', 'README.md'];
export const SERVER_PATHS = ['server/', ':(exclude)server/VERSION', 'pages/src/engine/plan.mjs', 'pages/src/engine/colors.mjs'];

const JSON_VERSION = /("version"\s*:\s*")[^"]*(")/;
const README_TITLE = /^# Paceline (\S+)[ \t]*$/m;

export function finalVersion(v) {
    const m = /^(\d+\.\d+\.\d+)(?:-beta\.\d+)?$/.exec(typeof v === 'string' ? v : '');
    if (!m) {
        throw new Error(`not a version like 0.3.4 or 0.3.4-beta.5: '${v}'`);
    }
    return m[1];
}

// The first beta after a release: 0.3.4 -> 0.3.5-beta.0.
export function nextBeta(v) {
    const [x, y, z] = finalVersion(v).split('.').map(Number);
    return `${x}.${y}.${z + 1}-beta.0`;
}

// A mod file's text without its version, so a version alone is no change.
export function versionless(file, text) {
    if (text == null) {
        return null;
    }
    return file === 'README.md' ? text.replace(README_TITLE, '# Paceline') : text.replace(JSON_VERSION, '$1$2');
}

// next's versions after a promote: the first beta after the release for each part that main
// released (its version on main changed), next's old version for the other.
export function nextVersions({mainBefore, mainAfter, nextBefore}) {
    return {
        mod: mainAfter.mod !== mainBefore.mod ? nextBeta(mainAfter.mod) : nextBefore.mod,
        server: mainAfter.server !== mainBefore.server ? nextBeta(mainAfter.server) : nextBefore.server,
    };
}

// Like release(), but the Mod lines stay under the new Unreleased: a server-only promote releases
// the Server lines only and leaves the Mod part as it is.
function releaseServerOnly(text, {version, date}) {
    if (!unreleased(text).mod.length) {
        return release(text, {version, date});
    }
    const all = String(text).split(/\r?\n/);
    const at = all.findIndex(l => /^## Unreleased\s*$/.test(l));
    let end = all.findIndex((l, i) => i > at && /^## /.test(l));
    end = end < 0 ? all.length : end;
    const body = all.slice(at + 1, end);
    const modAt = body.findIndex(l => /^### +Mod\s*$/i.test(l));
    let modEnd = body.findIndex((l, i) => i > modAt && /^### /.test(l));
    modEnd = modEnd < 0 ? body.length : modEnd;
    const mod = body.slice(modAt + 1, modEnd);
    while (mod.length && !mod[0].trim()) {
        mod.shift();
    }
    while (mod.length && !mod.at(-1).trim()) {
        mod.pop();
    }
    const rest = [...body.slice(0, modAt), ...body.slice(modEnd)];
    const head = ['## Unreleased', '', '### Mod', ...mod, '', '### Server', '', `## ${version} (${date})`];
    return [...all.slice(0, at), ...head, ...rest, ...all.slice(end)].join('\n');
}

// a > b for X.Y.Z versions (a beta suffix is ignored).
function above(a, b) {
    const n = v => (/^(\d+)\.(\d+)\.(\d+)/.exec(String(v)) || []).slice(1).map(Number);
    const [x, y] = [n(a), n(b)];
    for (let i = 0; i < 3; i++) {
        if (x[i] !== y[i]) {
            return x[i] > y[i];
        }
    }
    return false;
}

// `main` holds main's versions {mod, server}: a part that is not promoted gets main's version in the
// version commit (next may carry a beta of it), so main never receives a beta.
export function plan({modChanged, serverChanged, mod, server, changes, mainHasExtra, today, main = {}}) {
    const no = (refuse, summary = refuse) => ({refuse, edits: {}, summary});
    if (mainHasExtra) {
        return no('origin/main has commits that next lacks: merge main into next first (hotfix), then promote again');
    }
    if (!modChanged && !serverChanged) {
        return {refuse: null, edits: {}, summary: 'nothing to promote: no mod or server content differs between main and next'};
    }
    let modTo = main.mod ?? mod.version;
    let serverTo = main.server ?? server;
    try {
        if (modChanged) {
            modTo = finalVersion(mod.version);
        }
    } catch {
        return no(`the mod's VERSION (pages/src/version.mjs) is not a version: '${mod.version}'`);
    }
    try {
        if (serverChanged) {
            serverTo = finalVersion(server);
        }
    } catch {
        return no(`server/VERSION is not a version: '${server}'`);
    }
    // A final version that main has already (or passed) would release nothing, or downgrade main:
    // after a hotfix merged back, next must be bumped past main's version first.
    for (const [part, changed, to, onMain, file] of [['mod', modChanged, modTo, main.mod, 'VERSION'],
        ['server', serverChanged, serverTo, main.server, 'server/VERSION']]) {
        if (changed && onMain && !above(to, onMain)) {
            return no(`the ${part}'s final version ${to} is not above main's ${onMain}: bump next's ${file} past main's version first (hotfix merged back?)`);
        }
    }
    if (modChanged && !unreleased(changes).mod.length) {
        return no('the mod changed, but CHANGES.md has no "### Mod" line under "## Unreleased": add the mod\'s changes on next first');
    }
    const edits = {};
    if (modTo !== mod.version) {
        edits.manifestVersion = modTo;
    }
    if (modTo !== mod.version || mod.channel !== 'release') {
        edits.versionMjs = {VERSION: modTo, CHANNEL: 'release'};
    }
    if (serverTo !== server) {
        edits.serverVersion = serverTo;
    }
    const heading = {version: modChanged ? modTo : serverTo, date: today};
    edits.changes = modChanged ? release(changes, heading) : releaseServerOnly(changes, heading);
    const part = (name, changed, from, to) => changed ? `${name} ${from} -> ${to}` : `${name} unchanged (${to} as on main)`;
    return {
        refuse: null,
        edits,
        versions: {mod: modTo, server: serverTo},
        summary: `promote: ${part('mod', modChanged, mod.version, modTo)}, ${part('server', serverChanged, server, serverTo)}`,
    };
}

// ---------------------------------------------------------------- file edits

function setJsonVersion(text, version, file) {
    const out = text.replace(JSON_VERSION, `$1${version}$2`);
    if (JSON.parse(out).version !== version) {
        throw new Error(`could not set the version in ${file}`);
    }
    return out;
}

function setVersionMjs(text, {VERSION, CHANNEL}) {
    const re = name => new RegExp(`(export const ${name} = ')[^']*(';)`);
    if (!re('VERSION').test(text) || !re('CHANNEL').test(text)) {
        throw new Error('pages/src/version.mjs has no VERSION or CHANNEL line');
    }
    return text.replace(re('VERSION'), `$1${VERSION}$2`).replace(re('CHANNEL'), `$1${CHANNEL}$2`);
}

// The README title "# Paceline <version>", only when it names the old version.
function setReadmeTitle(text, from, to) {
    return text.replace(README_TITLE, (line, v) => v === from ? `# Paceline ${to}` : line);
}

const modVersionOf = mjs => ({
    version: (/export const VERSION = '([^']*)'/.exec(mjs ?? '') || [])[1],
    channel: (/export const CHANNEL = '([^']*)'/.exec(mjs ?? '') || [])[1],
});

// [path, new text] for every file whose text changes, in a fixed order. `src` holds the current
// texts by path (null: no such file).
function fileEdits(edits, src) {
    const out = [];
    const put = (file, text) => {
        if (text != null && text !== src[file]) {
            out.push([file, text]);
        }
    };
    if (edits.manifestVersion) {
        put('manifest.json', setJsonVersion(src['manifest.json'], edits.manifestVersion, 'manifest.json'));
        // the mod's version is also in package.json (tests/version.test.mjs) and the README title
        if (src['package.json'] != null) {
            put('package.json', setJsonVersion(src['package.json'], edits.manifestVersion, 'package.json'));
        }
        if (src['README.md'] != null) {
            put('README.md', setReadmeTitle(src['README.md'], modVersionOf(src['pages/src/version.mjs']).version, edits.manifestVersion));
        }
    }
    if (edits.versionMjs) {
        put('pages/src/version.mjs', setVersionMjs(src['pages/src/version.mjs'], edits.versionMjs));
    }
    if (edits.serverVersion) {
        put('server/VERSION', `${edits.serverVersion}\n`);
    }
    if (edits.changes != null && src['CHANGES.md'] != null) {
        put('CHANGES.md', edits.changes);
    }
    return out;
}

// The next-betas commit's files on top of the merge (texts `onMain`).
function betaEdits(betas, onMain) {
    return fileEdits({
        manifestVersion: betas.mod,
        versionMjs: {VERSION: betas.mod, CHANNEL: 'beta'},
        serverVersion: betas.server,
    }, onMain);
}

// ---------------------------------------------------------------- run

const READ = ['manifest.json', 'package.json', 'README.md', 'pages/src/version.mjs', 'server/VERSION', 'CHANGES.md'];
const OPTIONAL = new Set(['package.json', 'README.md', 'CHANGES.md']);
const MAIN_READ = ['manifest.json', 'README.md', 'pages/src/version.mjs', 'server/VERSION'];
const MERGE_SUBJECT = 'Promote next to production:';

const strip = args => {
    const a = [...args];
    while (a[0] === '-c') {
        a.splice(0, 2);
    }
    return a.join(' ');
};

export async function run({env = process.env, exec = realExec, writeFile = writeFileSync, log = console.log,
    now = () => new Date()} = {}) {
    const token = env.PROMOTE_TOKEN || '';
    const scrub = s => token ? String(s).split(token).join('[MASKED]') : String(s);
    const say = s => log(scrub(s));
    const dry = env.DRY_RUN === '1';
    try {
        if (!dry) {
            for (const k of ['PROMOTE_TOKEN', 'CI_SERVER_HOST', 'CI_PROJECT_PATH']) {
                if (!env[k]) {
                    say(`promote: ${k} is not set (the job needs it to push; DRY_RUN=1 runs without)`);
                    return 1;
                }
            }
        }
        const gitEnv = env.CI_SERVER_TLS_CA_FILE ? {...env, GIT_SSL_CAINFO: env.CI_SERVER_TLS_CA_FILE} : env;
        const git = async (args, ok = [0]) => {
            const r = await exec('git', args, {env: gitEnv});
            if (!ok.includes(r.code)) {
                // git's hint: lines would push the reason (e.g. "! [rejected]") out of the tail
                const detail = String(r.stderr || r.stdout || '').split('\n')
                    .filter(l => l.trim() && !/^hint:/.test(l)).slice(-3).join(' | ');
                throw new Error(`git ${strip(args)} failed (exit ${r.code})${detail ? `: ${detail}` : ''}`);
            }
            return r;
        };
        const isAncestor = async (a, b) => (await git(['merge-base', '--is-ancestor', a, b], [0, 1])).code === 0;
        const differs = async paths => (await git(['diff', '--quiet', 'origin/main', 'origin/next', '--', ...paths], [0, 1])).code === 1;
        const readAt = async (ref, files) => {
            const out = {};
            for (const file of files) {
                const r = await git(['show', `${ref}:${file}`], OPTIONAL.has(file) || file === 'README.md' ? [0, 128] : [0]);
                out[file] = r.code === 0 ? r.stdout : null;
            }
            return out;
        };
        const versionsOf = src => ({mod: modVersionOf(src['pages/src/version.mjs']).version, server: src['server/VERSION'].trim()});
        const pushUrl = `https://oauth2:${token}@${env.CI_SERVER_HOST}/${env.CI_PROJECT_PATH}.git`;
        const push = (...refspec) => git(['-c', `remote.origin.pushurl=${pushUrl}`, 'push', ...refspec]);
        const name = env.PROMOTE_GIT_NAME || 'Paceline CI';
        const email = env.PROMOTE_GIT_EMAIL || 'ci@invalid';
        const as = ['-c', `user.name=${name}`, '-c', `user.email=${email}`];
        const commit = async (files, msg) => {
            for (const [file, text] of files) {
                await writeFile(file, text);
            }
            if (files.length) {
                await git(['add', '--', ...files.map(f => f[0])]);
                await git([...as, 'commit', '-m', msg]);
            }
        };
        const betaMsg = b => `Next betas: mod ${b.mod}, server ${b.server}`;
        const pushNext = () => push('-o', 'ci.skip', 'origin', 'next');

        await git(['fetch', 'origin', '+refs/heads/main:refs/remotes/origin/main', '+refs/heads/next:refs/remotes/origin/next']);
        const next = (await git(['rev-parse', 'origin/next'])).stdout.trim();

        // main contains all of next: the merge went out but next did not move on (a half-done run).
        // Only the promote's own merge (subject, second parent = the version commit on next, or next)
        // counts; anything else is nothing to promote.
        if (await isAncestor('origin/next', 'origin/main')) {
            const [parentLine = '', subject = ''] = (await git(['log', '-1', '--format=%P%n%s', 'origin/main'])).stdout.split('\n');
            const parents = parentLine.trim().split(/\s+/).filter(Boolean);
            let ours = false;
            if (parents.length === 2 && subject.startsWith(MERGE_SUBJECT)) {
                ours = parents[1] === next ||
                    (await git(['log', '-1', '--format=%P', parents[1]])).stdout.trim() === next;
            }
            if (!ours) {
                say('nothing to promote: main already has everything on next');
                return 0;
            }
            const mainBefore = versionsOf(await readAt(parents[0], ['pages/src/version.mjs', 'server/VERSION']));
            const onMain = await readAt('origin/main', ['manifest.json', 'package.json', 'README.md', 'pages/src/version.mjs', 'server/VERSION']);
            const nextBefore = versionsOf(await readAt('origin/next', ['pages/src/version.mjs', 'server/VERSION']));
            const betas = nextVersions({mainBefore, mainAfter: versionsOf(onMain), nextBefore});
            const files = betaEdits(betas, onMain);
            if (dry) {
                say(`DRY_RUN: main already has the promote; would put next on it with "${betaMsg(betas)}" and push next`);
                return 0;
            }
            await git(['checkout', '-B', 'next', 'origin/main']);
            await commit(files, betaMsg(betas));
            await pushNext();
            say(`main already had the promote; pushed next on top of it: ${betaMsg(betas)}`);
            return 0;
        }

        // A pipeline of an older next would promote less than next holds (or race a newer promote).
        if (env.CI_COMMIT_SHA && env.CI_COMMIT_SHA !== next) {
            if (await isAncestor(env.CI_COMMIT_SHA, 'origin/main')) {
                if (!(await isAncestor('origin/main', 'origin/next'))) {
                    say(`promote: this pipeline's commit ${env.CI_COMMIT_SHA.slice(0, 8)} is on main already, but main is not in next: merge main into next by hand, then set the next betas`);
                    return 1;
                }
                say(`nothing to promote: this pipeline's commit ${env.CI_COMMIT_SHA.slice(0, 8)} is on main already`);
                return 0;
            }
            say(`promote: next moved since this pipeline started (${env.CI_COMMIT_SHA.slice(0, 8)} -> ${next.slice(0, 8)}): run the promote job of the newest next pipeline`);
            return 1;
        }
        const mainHasExtra = !(await isAncestor('origin/main', 'origin/next'));
        const modCode = await differs(MOD_PATHS);
        const serverChanged = await differs(SERVER_PATHS);
        const src = await readAt('origin/next', READ);
        const onMainBefore = await readAt('origin/main', MAIN_READ);
        const modChanged = modCode ||
            MOD_VERSIONED.some(f => versionless(f, src[f]) !== versionless(f, onMainBefore[f]));
        const mainBefore = versionsOf(onMainBefore);
        const nextBefore = versionsOf(src);
        const p = plan({
            modChanged, serverChanged, mod: modVersionOf(src['pages/src/version.mjs']),
            server: nextBefore.server, changes: src['CHANGES.md'] ?? '', mainHasExtra,
            today: now().toISOString().slice(0, 10), main: mainBefore,
        });
        if (p.refuse) {
            say(`promote: ${p.refuse}`);
            return 1;
        }
        say(p.summary);
        if (!Object.keys(p.edits).length) {
            return 0;
        }

        // The notes are public: an early refusal here; the public export's leak check stays the gate.
        const notes = unreleased(src['CHANGES.md'] ?? '');
        if (!env.PUBLIC_DENY_REGEX) {
            say('PUBLIC_DENY_REGEX is not set: the notes are not checked here (the public export checks them)');
        } else {
            let hit;
            try {
                hit = denied(notesText(notes), env.PUBLIC_DENY_REGEX);
            } catch {
                say('promote: PUBLIC_DENY_REGEX does not compile; fix the CI variable');
                return 1;
            }
            if (hit) {
                say('promote: the notes under "## Unreleased" in CHANGES.md name something PUBLIC_DENY_REGEX denies: fix them on next');
                return 1;
            }
        }

        // Every text is computed before anything is written. The merge's tree is the version
        // commit's (main is an ancestor of next), so the betas build on those texts.
        const files = fileEdits(p.edits, src);
        const onMerge = {...src, ...Object.fromEntries(files)};
        const betas = nextVersions({mainBefore, mainAfter: p.versions, nextBefore});
        const betaFiles = betaEdits(betas, onMerge);
        const commitMsg = `Promote: final versions, mod ${p.versions.mod}, server ${p.versions.server}`;
        const mergeMsg = `${MERGE_SUBJECT} mod ${p.versions.mod}, server ${p.versions.server}`;
        const notesCount = `${notes.mod.length} Mod and ${notes.server.length} Server lines`;
        if (dry) {
            say(`DRY_RUN: would write ${files.map(f => f[0]).join(', ') || 'no file'} (notes: ${notesCount}), ` +
                `commit them on next as "${commitMsg}", merge next into main as "${mergeMsg}", ` +
                `then on next "${betaMsg(betas)}" (${betaFiles.map(f => f[0]).join(', ') || 'no file'}), push main, then next`);
            return 0;
        }

        await git(['checkout', '-B', 'next', 'origin/next']);
        await commit(files, commitMsg);
        await git(['checkout', '-B', 'main', 'origin/main']);
        await git([...as, 'merge', '--no-ff', 'next', '-m', mergeMsg]);
        await git(['checkout', '-B', 'next', 'main']);
        await commit(betaFiles, betaMsg(betas));
        try {
            await push('origin', 'main');
        } catch (e) {
            say(`promote: pushing main failed, nothing was pushed: ${e.message}`);
            return 1;
        }
        say(`pushed main: "${mergeMsg}" (its pipeline releases what changed)`);
        // The token's bot user starts that pipeline, so no failure mail and no triage reaches a person.
        say("watch main's pipeline: it was started by the promote token's user");
        if (env.CI_PROJECT_URL) {
            say(`${env.CI_PROJECT_URL}/-/pipelines?ref=main`);
        }
        try {
            await pushNext();
        } catch (e) {
            // A push to next since the fetch makes ours a non-fast-forward (never forced). A re-run
            // cannot fix that: next needs main merged in by hand.
            let moved = false;
            try {
                await git(['fetch', 'origin', '+refs/heads/next:refs/remotes/origin/next']);
                moved = !(await isAncestor('origin/next', 'next'));
            } catch {
                // the fetch failed as well: keep the first error
            }
            if (moved) {
                say(`promote: main is pushed, but next moved during the promote, so next was not pushed (${e.message}): merge main into next by hand, then set the next betas ("${betaMsg(betas)}")`);
            } else {
                say(`promote: main is pushed, but pushing next failed: ${e.message}. Re-run this job: it finishes next`);
            }
            return 1;
        }
        say(`pushed next (no pipeline): the merge, then "${betaMsg(betas)}" (notes: ${notesCount})`);
        return 0;
    } catch (e) {
        say(`promote: ${e.message || e}`);
        return 1;
    }
}

function realExec(cmd, args, {env} = {}) {
    const r = spawnSync(cmd, args, {encoding: 'utf8', env: env ?? process.env, maxBuffer: 64 * 1024 * 1024});
    return {code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? String(r.error ?? '')};
}

// True when this file is the program node was started with (also through a symlink).
function isMain() {
    try {
        return Boolean(process.argv[1]) &&
            realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
    } catch {
        return false;
    }
}

if (isMain()) {
    process.exitCode = await run();
}
