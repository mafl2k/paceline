// Run with: node --test tests/promote.test.mjs
// scripts/promote.mjs: the pure parts (finalVersion, nextBeta, versionless, nextVersions, plan),
// run() against a fake git that pins the ordered git calls, and runs against real git repositories
// in a temporary directory (with scripts/check-channel.mjs on the resulting main and next).
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {finalVersion, nextBeta, versionless, nextVersions, plan, run, MOD_PATHS, MOD_VERSIONED, SERVER_PATHS} from '../scripts/promote.mjs';
import {release, unreleased, notesFor} from '../scripts/changes.mjs';

const TODAY = '2026-11-23';
const now = () => new Date(`${TODAY}T10:00:00Z`);
const TOKEN = 'glpat-made-up-secret-value';
const NEXT = '1'.repeat(40);
const VCOMMIT = '2'.repeat(40);
const OLDMAIN = '3'.repeat(40);
const OLDNEXT = '4'.repeat(40);
const PUSH_URL = `https://oauth2:${TOKEN}@gitlab.example.org/team/paceline.git`;

const CHANGES = '# Changes\n\nIntro.\n\n## Unreleased\n\n### Mod\n- A calmer countdown for Rider Alpha.\n\n' +
    '### Server\n- A race list.\n\n## 0.3.3 (2026-11-01)\n\n### Mod\n- old\n';
const SERVER_ONLY_CHANGES = '# Changes\n\n## Unreleased\n\n### Mod\n\n### Server\n- A race list.\n\n## 0.3.3 (2026-11-01)\n\n### Mod\n- old\n';

// ---------------------------------------------------------------- pure parts

test('finalVersion drops the beta suffix, keeps a plain version, throws on anything else', () => {
    assert.equal(finalVersion('0.3.4-beta.5'), '0.3.4');
    assert.equal(finalVersion('0.3.4'), '0.3.4');
    assert.equal(finalVersion('10.20.30-beta.12'), '10.20.30');
    for (const bad of ['', '0.3', '0.3.4-rc.1', 'v0.3.4', '0.3.4-beta', '0.3.4\n', undefined]) {
        assert.throws(() => finalVersion(bad), `${JSON.stringify(bad)} must throw`);
    }
});

test('nextBeta: the first beta after a release', () => {
    assert.equal(nextBeta('0.3.4'), '0.3.5-beta.0');
    assert.equal(nextBeta('0.5.0'), '0.5.1-beta.0');
    assert.equal(nextBeta('1.2.9'), '1.2.10-beta.0');
    assert.throws(() => nextBeta('x'));
});

test('versionless: a version alone is no change, anything else is', () => {
    const m = v => `{\n    "manifest_version": 1,\n    "version": "${v}",\n    "name": "Paceline"\n}\n`;
    assert.equal(versionless('manifest.json', m('0.3.4')), versionless('manifest.json', m('0.3.5-beta.0')));
    assert.notEqual(versionless('manifest.json', m('0.3.4')), versionless('manifest.json', m('0.3.4').replace('Paceline', 'X')));
    const r = v => `<img>\n\n# Paceline ${v}\n\nSince 0.3.4-beta.3.\n`;
    assert.equal(versionless('README.md', r('0.3.4')), versionless('README.md', r('0.3.5-beta.0')));
    assert.notEqual(versionless('README.md', r('0.3.4')), versionless('README.md', r('0.3.4').replace('Since', 'From')));
    assert.equal(versionless('README.md', null), null);
});

test('nextVersions: a released part gets its first beta, the other part keeps next\'s version', () => {
    assert.deepEqual(nextVersions({mainBefore: {mod: '0.3.3', server: '0.3.6'}, mainAfter: {mod: '0.3.4', server: '0.4.0'},
        nextBefore: {mod: '0.3.4-beta.5', server: '0.4.0-beta.2'}}), {mod: '0.3.5-beta.0', server: '0.4.1-beta.0'});
    assert.deepEqual(nextVersions({mainBefore: {mod: '0.3.4', server: '0.4.0'}, mainAfter: {mod: '0.3.4', server: '0.4.1'},
        nextBefore: {mod: '0.3.5-beta.0', server: '0.4.1-beta.1'}}), {mod: '0.3.5-beta.0', server: '0.4.2-beta.0'});
});

const base = {
    modChanged: true, serverChanged: true, mod: {version: '0.3.4-beta.5', channel: 'beta'},
    server: '0.4.0-beta.2', changes: CHANGES, mainHasExtra: false, today: TODAY, main: {mod: '0.3.3', server: '0.3.6'},
};

test('plan: mod and server changed, both beta: final versions, CHANNEL release, CHANGES.md for the mod version', () => {
    const p = plan(base);
    assert.equal(p.refuse, null);
    assert.equal(p.edits.manifestVersion, '0.3.4');
    assert.deepEqual(p.edits.versionMjs, {VERSION: '0.3.4', CHANNEL: 'release'});
    assert.equal(p.edits.serverVersion, '0.4.0');
    assert.equal(p.edits.changes, release(CHANGES, {version: '0.3.4', date: TODAY}));
    assert.match(p.edits.changes, /^## 0\.3\.4 \(2026-11-23\)$/m);
    assert.deepEqual(p.versions, {mod: '0.3.4', server: '0.4.0'});
});

test('plan: server only: no mod version edits, CHANGES.md for the server version, no Mod line needed', () => {
    const p = plan({...base, modChanged: false, mod: {version: '0.3.3', channel: 'beta'}, changes: SERVER_ONLY_CHANGES});
    assert.equal(p.refuse, null);
    assert.equal(p.edits.manifestVersion, undefined);
    // next always says CHANNEL 'beta'; main must keep 'release' and its mod version, so the file
    // goes back to exactly what main has (VERSION unchanged).
    assert.deepEqual(p.edits.versionMjs, {VERSION: '0.3.3', CHANNEL: 'release'});
    assert.equal(p.edits.serverVersion, '0.4.0');
    assert.equal(p.edits.changes, release(SERVER_ONLY_CHANGES, {version: '0.4.0', date: TODAY}));
    assert.deepEqual(p.versions, {mod: '0.3.3', server: '0.4.0'});
});

test('plan: server only after a mod release: next\'s mod beta goes back to main\'s version, never to main', () => {
    const p = plan({...base, modChanged: false, mod: {version: '0.3.5-beta.0', channel: 'beta'}, changes: SERVER_ONLY_CHANGES,
        main: {mod: '0.3.4', server: '0.4.0'}, server: '0.4.1-beta.1'});
    assert.equal(p.refuse, null);
    assert.equal(p.edits.manifestVersion, '0.3.4');
    assert.deepEqual(p.edits.versionMjs, {VERSION: '0.3.4', CHANNEL: 'release'});
    assert.equal(p.edits.serverVersion, '0.4.1');
    assert.deepEqual(p.versions, {mod: '0.3.4', server: '0.4.1'});
});

test('plan: mod only after a server release: next\'s server beta goes back to main\'s version', () => {
    const p = plan({...base, serverChanged: false, server: '0.4.1-beta.0', main: {mod: '0.3.3', server: '0.4.0'}});
    assert.equal(p.edits.serverVersion, '0.4.0');
    assert.deepEqual(p.versions, {mod: '0.3.4', server: '0.4.0'});
});

test('plan: server only with CHANNEL already release: version.mjs is not touched at all', () => {
    const p = plan({...base, modChanged: false, mod: {version: '0.3.3', channel: 'release'}, changes: SERVER_ONLY_CHANGES});
    assert.equal(p.edits.versionMjs, undefined);
    assert.equal(p.edits.manifestVersion, undefined);
});

test('plan: server only leaves the Mod lines of Unreleased where they are (Review Focus 2)', () => {
    const p = plan({...base, modChanged: false, mod: {version: '0.3.3', channel: 'beta'}});
    assert.deepEqual(unreleased(p.edits.changes).mod, ['A calmer countdown for Rider Alpha.']);
    assert.deepEqual(unreleased(p.edits.changes).server, []);
    assert.deepEqual(notesFor(p.edits.changes, '0.4.0'), {mod: [], server: ['A race list.']});
    assert.deepEqual(notesFor(p.edits.changes, '0.3.3'), {mod: ['old'], server: []}, 'older sections stay');
});

test('plan: mod changed without a ### Mod line refuses, naming CHANGES.md', () => {
    const p = plan({...base, changes: SERVER_ONLY_CHANGES});
    assert.match(p.refuse, /CHANGES\.md/);
    assert.deepEqual(p.edits, {});
    const none = plan({...base, changes: '# Changes\n'});
    assert.match(none.refuse, /CHANGES\.md/);
});

test('plan: main has commits next lacks: refuses with merge main into next', () => {
    const p = plan({...base, mainHasExtra: true});
    assert.match(p.refuse, /merge main into next/);
    assert.deepEqual(p.edits, {});
});

test('plan: nothing changed: no refusal, no edits, nothing to promote', () => {
    const p = plan({...base, modChanged: false, serverChanged: false});
    assert.equal(p.refuse, null);
    assert.deepEqual(p.edits, {});
    assert.match(p.summary, /nothing to promote/);
});

test('plan: a promoted part\'s final version must be above main\'s (hotfix merged back): equal or lower refuses', () => {
    const equalMod = plan({...base, mod: {version: '0.3.5-beta.1', channel: 'beta'}, main: {mod: '0.3.5', server: '0.3.6'}});
    assert.equal(equalMod.refuse, 'the mod\'s final version 0.3.5 is not above main\'s 0.3.5: bump next\'s VERSION past main\'s version first (hotfix merged back?)');
    assert.deepEqual(equalMod.edits, {});
    const lowerMod = plan({...base, mod: {version: '0.3.5-beta.1', channel: 'beta'}, main: {mod: '0.3.6', server: '0.3.6'}});
    assert.match(lowerMod.refuse, /^the mod's final version 0\.3\.5 is not above main's 0\.3\.6: /);
    const equalServer = plan({...base, server: '0.4.0-beta.3', main: {mod: '0.3.3', server: '0.4.0'}});
    assert.match(equalServer.refuse, /^the server's final version 0\.4\.0 is not above main's 0\.4\.0: bump next's server\/VERSION/);
    const lowerServer = plan({...base, server: '0.4.0-beta.3', main: {mod: '0.3.3', server: '0.10.0'}});
    assert.match(lowerServer.refuse, /^the server's final version 0\.4\.0 is not above main's 0\.10\.0: /, 'numeric, not text order');
    // above by any of X, Y or Z passes; a part that is not promoted is not checked
    for (const [m, v] of [['0.3.3', '0.3.4-beta.5'], ['0.3.9', '0.4.0-beta.1'], ['0.9.9', '1.0.0-beta.1'], ['0.3.9', '0.3.10']]) {
        assert.equal(plan({...base, mod: {version: v, channel: 'beta'}, main: {mod: m, server: '0.3.6'}}).refuse, null, `${v} over ${m}`);
    }
    assert.equal(plan({...base, serverChanged: false, server: '0.4.0', main: {mod: '0.3.3', server: '0.4.0'}}).refuse, null);
});

test('plan: a version that is no version refuses with one line', () => {
    const p = plan({...base, server: '0.4.0-rc.1'});
    assert.match(p.refuse, /server\/VERSION/);
    assert.deepEqual(p.edits, {});
});

// ---------------------------------------------------------------- run with a fake git

const manifest = v => `{\n    "manifest_version": 1,\n    "name": "Paceline",\n    "version": "${v}",\n    "web_root": "pages"\n}\n`;
const pkg = v => `{"name":"paceline","version":"${v}","private":true}\n`;
const readme = v => `<img src="x">\n\n# Paceline ${v}\n\nText about 0.3.4-beta.5.\n`;
const versionMjs = (v, c) => `export const VERSION = '${v}';\nexport const CHANNEL = '${c}';\n`;
const tree = (mod, channel, server, changes = CHANGES) => ({
    'manifest.json': manifest(mod), 'package.json': pkg(mod), 'README.md': readme(mod),
    'pages/src/version.mjs': versionMjs(mod, channel), 'server/VERSION': `${server}\n`, 'CHANGES.md': changes,
});
const MANIFEST = manifest('0.3.4-beta.5');
const README = readme('0.3.4-beta.5');
const NEXT_TREE = tree('0.3.4-beta.5', 'beta', '0.4.0-beta.2');
const MAIN_TREE = tree('0.3.3', 'release', '0.3.6', '# Changes\n');

const ciEnv = (extra = {}) => ({
    PROMOTE_TOKEN: TOKEN, CI_SERVER_HOST: 'gitlab.example.org', CI_PROJECT_PATH: 'team/paceline',
    CI_COMMIT_SHA: NEXT, ...extra,
});

// The git calls without the leading "-c key=value" options, as one string each.
const bare = args => {
    const a = [...args];
    while (a[0] === '-c') {
        a.splice(0, 2);
    }
    return a.join(' ');
};
const opt = (args, key) => {
    for (let i = 0; i + 1 < args.length && args[i] === '-c'; i += 2) {
        if (args[i + 1].startsWith(`${key}=`)) {
            return args[i + 1].slice(key.length + 1);
        }
    }
    return undefined;
};

// `ancestors`: the "a b" pairs for which merge-base --is-ancestor a b holds.
function fakeGit({ancestors = ['origin/main origin/next'], mod = 1, server = 1, trees = {}, mainLog = `${OLDMAIN}\nsomething`,
    vParents = `${NEXT}\n`, fail = {}} = {}) {
    const refs = {'origin/next': NEXT_TREE, 'origin/main': MAIN_TREE, ...trees};
    const calls = [];
    const exec = (cmd, args, opts) => {
        assert.equal(cmd, 'git');
        calls.push({args, opts});
        const a = bare(args);
        if (fail[a]) {
            return fail[a];
        }
        if (a === 'rev-parse origin/next') {
            return {code: 0, stdout: `${NEXT}\n`};
        }
        if (a.startsWith('merge-base --is-ancestor ')) {
            return {code: ancestors.includes(a.slice('merge-base --is-ancestor '.length)) ? 0 : 1, stdout: ''};
        }
        if (a === `diff --quiet origin/main origin/next -- ${MOD_PATHS.join(' ')}`) {
            return {code: mod, stdout: ''};
        }
        if (a === `diff --quiet origin/main origin/next -- ${SERVER_PATHS.join(' ')}`) {
            return {code: server, stdout: ''};
        }
        const show = /^show ([^:]+):(.+)$/.exec(a);
        if (show) {
            const t = refs[show[1]] || {};
            return show[2] in t && t[show[2]] != null ? {code: 0, stdout: t[show[2]]} :
                {code: 128, stdout: '', stderr: `fatal: path '${show[2]}' does not exist`};
        }
        if (a === 'log -1 --format=%P%n%s origin/main') {
            return {code: 0, stdout: `${mainLog}\n`};
        }
        if (a === `log -1 --format=%P ${VCOMMIT}`) {
            return {code: 0, stdout: vParents};
        }
        return {code: 0, stdout: ''};
    };
    return {calls, exec, list: () => calls.map(c => bare(c.args))};
}

function harness(gitOpts, envExtra) {
    const git = fakeGit(gitOpts);
    const written = [];
    const lines = [];
    const io = {
        env: ciEnv(envExtra), exec: git.exec, now,
        writeFile: (p, text) => written.push([p, text]),
        log: s => lines.push(String(s)),
    };
    return {git, written, lines, io, out: () => lines.join('\n')};
}

const READS = ['manifest.json', 'package.json', 'README.md', 'pages/src/version.mjs', 'server/VERSION', 'CHANGES.md']
    .map(f => `show origin/next:${f}`);
const MAIN_READS = ['manifest.json', 'README.md', 'pages/src/version.mjs', 'server/VERSION'].map(f => `show origin/main:${f}`);
const PREFLIGHT = [
    'fetch origin +refs/heads/main:refs/remotes/origin/main +refs/heads/next:refs/remotes/origin/next',
    'rev-parse origin/next',
    'merge-base --is-ancestor origin/next origin/main',
    'merge-base --is-ancestor origin/main origin/next',
    `diff --quiet origin/main origin/next -- ${MOD_PATHS.join(' ')}`,
    `diff --quiet origin/main origin/next -- ${SERVER_PATHS.join(' ')}`,
    ...READS,
    ...MAIN_READS,
];

test('the path lists: Global Constraints minus the version files, which are compared without versions', () => {
    assert.deepEqual(MOD_PATHS, ['pages/', ':(exclude)pages/src/version.mjs', 'scripts/zip.sh']);
    assert.deepEqual(MOD_VERSIONED, ['manifest.json', 'README.md']);
    assert.deepEqual(SERVER_PATHS, ['server/', ':(exclude)server/VERSION', 'pages/src/engine/plan.mjs', 'pages/src/engine/colors.mjs']);
});

test('run: the ordered git calls of a full promote, the files, the betas and the final pushes', async () => {
    const h = harness();
    assert.equal(await run(h.io), 0, h.out());
    assert.deepEqual(h.git.list(), [
        ...PREFLIGHT,
        'checkout -B next origin/next',
        'add -- manifest.json package.json README.md pages/src/version.mjs server/VERSION CHANGES.md',
        'commit -m Promote: final versions, mod 0.3.4, server 0.4.0',
        'checkout -B main origin/main',
        'merge --no-ff next -m Promote next to production: mod 0.3.4, server 0.4.0',
        'checkout -B next main',
        'add -- manifest.json package.json README.md pages/src/version.mjs server/VERSION',
        'commit -m Next betas: mod 0.3.5-beta.0, server 0.4.1-beta.0',
        'push origin main',
        'push -o ci.skip origin next',
    ]);
    const version = h.written.slice(0, 6);
    const betas = h.written.slice(6);
    assert.deepEqual(version.map(x => x[0]), ['manifest.json', 'package.json', 'README.md', 'pages/src/version.mjs', 'server/VERSION', 'CHANGES.md']);
    const w = Object.fromEntries(version);
    assert.equal(w['manifest.json'], MANIFEST.replace('0.3.4-beta.5', '0.3.4'), 'only the version changes, the layout stays');
    assert.equal(JSON.parse(w['package.json']).version, '0.3.4');
    assert.equal(w['README.md'], '<img src="x">\n\n# Paceline 0.3.4\n\nText about 0.3.4-beta.5.\n', 'the title only');
    assert.equal(w['pages/src/version.mjs'], versionMjs('0.3.4', 'release'));
    assert.equal(w['server/VERSION'], '0.4.0\n');
    assert.equal(w['CHANGES.md'], release(CHANGES, {version: '0.3.4', date: TODAY}));
    assert.deepEqual(Object.fromEntries(betas), {
        'manifest.json': manifest('0.3.5-beta.0'), 'package.json': pkg('0.3.5-beta.0'),
        'README.md': '<img src="x">\n\n# Paceline 0.3.5-beta.0\n\nText about 0.3.4-beta.5.\n',
        'pages/src/version.mjs': versionMjs('0.3.5-beta.0', 'beta'), 'server/VERSION': '0.4.1-beta.0\n',
    }, 'the betas commit leaves CHANGES.md alone');
    // identity and push URL are per-command options, never written into the repository's config
    for (const c of h.git.calls.filter(x => /^(commit|merge --no-ff)/.test(bare(x.args)))) {
        assert.equal(opt(c.args, 'user.name'), 'Paceline CI');
        assert.equal(opt(c.args, 'user.email'), 'ci@invalid');
    }
    for (const c of h.git.calls.filter(x => bare(x.args).startsWith('push'))) {
        assert.equal(opt(c.args, 'remote.origin.pushurl'), PUSH_URL);
    }
    assert.ok(!h.git.list().some(a => a.startsWith('config') || a.startsWith('remote')), 'no persistent config');
    assert.ok(!h.git.list().some(a => a.startsWith('push') && /--force|(^| )-f( |$)| \+/.test(a)), 'no force push');
    assert.match(h.out(), /mod 0\.3\.4-beta\.5 -> 0\.3\.4/);
    assert.match(h.out(), /server 0\.4\.0-beta\.2 -> 0\.4\.0/);
});

test('run: after the main push it says to watch main\'s pipeline, with the link, before next is pushed, never the token', async () => {
    const h = harness({}, {CI_PROJECT_URL: 'https://gitlab.example.org/team/paceline'});
    assert.equal(await run(h.io), 0, h.out());
    const at = re => h.lines.findIndex(l => re.test(l));
    const pushedMain = at(/^pushed main/);
    const watch = at(/^watch main's pipeline: it was started by the promote token's user$/);
    const link = h.lines.indexOf('https://gitlab.example.org/team/paceline/-/pipelines?ref=main');
    const pushedNext = at(/^pushed next/);
    assert.ok(pushedMain >= 0 && watch === pushedMain + 1 && link === watch + 1 && pushedNext > link, h.out());
    assert.ok(!h.out().includes(TOKEN));
    // a failed main push says nothing about watching a pipeline that does not exist
    const failed = harness({fail: {'push origin main': {code: 1, stdout: '', stderr: 'denied'}}},
        {CI_PROJECT_URL: 'https://gitlab.example.org/team/paceline'});
    assert.equal(await run(failed.io), 1);
    assert.ok(!/watch main's pipeline|pipelines\?ref=main/.test(failed.out()), failed.out());
    // DRY_RUN pushes nothing, so it names no pipeline either
    const dry = harness({}, {CI_PROJECT_URL: 'https://gitlab.example.org/team/paceline', DRY_RUN: '1'});
    assert.equal(await run(dry.io), 0);
    assert.ok(!/pipelines\?ref=main/.test(dry.out()), dry.out());
});

test('run: the git identity comes from PROMOTE_GIT_NAME / PROMOTE_GIT_EMAIL', async () => {
    const h = harness({}, {PROMOTE_GIT_NAME: 'Release Bot', PROMOTE_GIT_EMAIL: 'bot@example.org'});
    assert.equal(await run(h.io), 0, h.out());
    for (const c of h.git.calls.filter(x => bare(x.args).startsWith('commit'))) {
        assert.equal(opt(c.args, 'user.name'), 'Release Bot');
        assert.equal(opt(c.args, 'user.email'), 'bot@example.org');
    }
});

test('run: CI_SERVER_TLS_CA_FILE reaches git as GIT_SSL_CAINFO', async () => {
    const h = harness({}, {CI_SERVER_TLS_CA_FILE: '/builds/ca.pem'});
    assert.equal(await run(h.io), 0, h.out());
    for (const c of h.git.calls) {
        assert.equal(c.opts?.env?.GIT_SSL_CAINFO, '/builds/ca.pem', bare(c.args));
    }
    const plain = harness();
    await run(plain.io);
    assert.equal(plain.git.calls[0].opts?.env?.GIT_SSL_CAINFO, undefined);
});

test('run: DRY_RUN=1 reads and plans, then stops before any write and logs the plan', async () => {
    const h = harness({}, {DRY_RUN: '1'});
    assert.equal(await run(h.io), 0, h.out());
    assert.deepEqual(h.git.list(), PREFLIGHT);
    assert.deepEqual(h.written, []);
    assert.match(h.out(), /DRY_RUN/);
    assert.match(h.out(), /Promote next to production: mod 0\.3\.4, server 0\.4\.0/);
    assert.match(h.out(), /Next betas: mod 0\.3\.5-beta\.0, server 0\.4\.1-beta\.0/);
    assert.match(h.out(), /server\/VERSION/);
});

test('run: DRY_RUN=1 works without PROMOTE_TOKEN and the CI variables', async () => {
    const git = fakeGit();
    const lines = [];
    const code = await run({env: {DRY_RUN: '1'}, exec: git.exec, now, writeFile: () => assert.fail('write'), log: s => lines.push(s)});
    assert.equal(code, 0, lines.join('\n'));
});

test('run: without PROMOTE_TOKEN (and no DRY_RUN) it stops before any git call', async () => {
    const h = harness({}, {PROMOTE_TOKEN: ''});
    assert.equal(await run(h.io), 1);
    assert.deepEqual(h.git.list(), []);
    assert.match(h.out(), /PROMOTE_TOKEN/);
});

test('run: server only (Review Focus 2): manifest, package and README untouched; version.mjs is main\'s, then beta again', async () => {
    const next = tree('0.3.3', 'beta', '0.4.0-beta.2', SERVER_ONLY_CHANGES);
    const h = harness({mod: 0, trees: {'origin/next': next}});
    assert.equal(await run(h.io), 0, h.out());
    assert.deepEqual(h.written.map(x => x[0]), ['pages/src/version.mjs', 'server/VERSION', 'CHANGES.md', 'pages/src/version.mjs', 'server/VERSION']);
    assert.equal(h.written[0][1], versionMjs('0.3.3', 'release'), 'the merge carries main\'s version.mjs');
    assert.equal(h.written[3][1], versionMjs('0.3.3', 'beta'), 'next keeps its version and CHANNEL beta');
    assert.equal(h.written[4][1], '0.4.1-beta.0\n');
    assert.ok(h.git.list().includes('merge --no-ff next -m Promote next to production: mod 0.3.3, server 0.4.0'));
    assert.ok(h.git.list().includes('commit -m Next betas: mod 0.3.3, server 0.4.1-beta.0'));
    assert.match(h.written[2][1], /^## 0\.4\.0 \(2026-11-23\)$/m);
});

test('run: a mod beta alone is no mod change (version fields do not count)', async () => {
    // After a mod release next says 0.3.5-beta.0; only the server changed since.
    const next = tree('0.3.5-beta.0', 'beta', '0.4.1-beta.1', SERVER_ONLY_CHANGES);
    const main = tree('0.3.4', 'release', '0.4.0', '# Changes\n');
    const h = harness({mod: 0, trees: {'origin/next': next, 'origin/main': main}});
    assert.equal(await run(h.io), 0, h.out());
    assert.match(h.out(), /mod unchanged \(0\.3\.4 as on main\)/);
    const version = Object.fromEntries(h.written.slice(0, 6));
    assert.equal(version['manifest.json'], manifest('0.3.4'), 'main keeps its mod version');
    assert.equal(version['pages/src/version.mjs'], versionMjs('0.3.4', 'release'));
    assert.ok(h.git.list().includes('commit -m Next betas: mod 0.3.5-beta.0, server 0.4.2-beta.0'));
    // a changed manifest beyond its version is a mod change
    const changed = harness({mod: 0, trees: {'origin/next': {...next, 'manifest.json': next['manifest.json'].replace('Paceline', 'Pace')}, 'origin/main': main}});
    assert.equal(await run(changed.io), 1);
    assert.match(changed.out(), /CHANGES\.md/);
});

test('run: nothing changed: nothing to promote, exit 0, no writes and no pushes', async () => {
    const h = harness({mod: 0, server: 0});
    assert.equal(await run(h.io), 0);
    assert.match(h.out(), /nothing to promote/);
    assert.deepEqual(h.written, []);
    assert.deepEqual(h.git.list(), PREFLIGHT);
});

test('run: main has a commit next lacks (hotfix not merged back): exit 1, one line, nothing written', async () => {
    const h = harness({ancestors: []});
    assert.equal(await run(h.io), 1);
    assert.match(h.out(), /merge main into next first/);
    assert.deepEqual(h.written, []);
    assert.ok(!h.git.list().some(a => a.startsWith('push') || a.startsWith('checkout')));
});

test('run: next moved since this pipeline started: exit 1 before any change', async () => {
    const h = harness({}, {CI_COMMIT_SHA: 'f'.repeat(40)});
    assert.equal(await run(h.io), 1);
    assert.match(h.out(), /next moved/);
    assert.deepEqual(h.git.list(), [...PREFLIGHT.slice(0, 3), `merge-base --is-ancestor ${'f'.repeat(40)} origin/main`]);
});

// After a half-done promote: origin/main = merge(old main, version commit), origin/next = the old next.
const HALF_DONE = {
    ancestors: ['origin/next origin/main'],
    mainLog: `${OLDMAIN} ${VCOMMIT}\nPromote next to production: mod 0.3.4, server 0.4.0`,
    trees: {
        'origin/main': tree('0.3.4', 'release', '0.4.0', release(CHANGES, {version: '0.3.4', date: TODAY})),
        [OLDMAIN]: tree('0.3.3', 'release', '0.3.6'),
    },
};

test('run: rerun after main was pushed but the next push failed (Review Focus 1): next gets the betas on main, no second merge', async () => {
    const h = harness(HALF_DONE);
    assert.equal(await run(h.io), 0, h.out());
    assert.deepEqual(h.git.list(), [
        ...PREFLIGHT.slice(0, 3),
        'log -1 --format=%P%n%s origin/main',
        `log -1 --format=%P ${VCOMMIT}`,
        `show ${OLDMAIN}:pages/src/version.mjs`, `show ${OLDMAIN}:server/VERSION`,
        ...['manifest.json', 'package.json', 'README.md', 'pages/src/version.mjs', 'server/VERSION'].map(f => `show origin/main:${f}`),
        'show origin/next:pages/src/version.mjs', 'show origin/next:server/VERSION',
        'checkout -B next origin/main',
        'add -- manifest.json package.json README.md pages/src/version.mjs server/VERSION',
        'commit -m Next betas: mod 0.3.5-beta.0, server 0.4.1-beta.0',
        'push -o ci.skip origin next',
    ]);
    assert.equal(Object.fromEntries(h.written)['pages/src/version.mjs'], versionMjs('0.3.5-beta.0', 'beta'));
    assert.equal(opt(h.git.calls.at(-1).args, 'remote.origin.pushurl'), PUSH_URL);
    assert.ok(!h.out().includes(TOKEN));
});

test('run: rerun with DRY_RUN=1 says it would finish next, and writes and pushes nothing', async () => {
    const h = harness(HALF_DONE, {DRY_RUN: '1'});
    assert.equal(await run(h.io), 0, h.out());
    assert.ok(!h.git.list().some(a => a.startsWith('push') || a.startsWith('checkout') || a.startsWith('commit')));
    assert.deepEqual(h.written, []);
    assert.match(h.out(), /DRY_RUN.*Next betas: mod 0\.3\.5-beta\.0, server 0\.4\.1-beta\.0/);
});

test('run: main contains next through a merge that is not the promote\'s: nothing to promote, nothing pushed', async () => {
    const manual = harness({...HALF_DONE, mainLog: `${OLDMAIN} ${VCOMMIT}\nMerge branch next`});
    assert.equal(await run(manual.io), 0);
    assert.match(manual.out(), /nothing to promote/);
    assert.ok(!manual.git.list().some(a => a.startsWith('push') || a.startsWith('commit')));
    const other = harness({...HALF_DONE, vParents: `${OLDMAIN}\n`});
    assert.equal(await run(other.io), 0);
    assert.match(other.out(), /nothing to promote/);
    assert.ok(!other.git.list().some(a => a.startsWith('push')));
    const same = harness({ancestors: ['origin/next origin/main', 'origin/main origin/next'], mainLog: `${OLDMAIN}\nx`});
    assert.equal(await run(same.io), 0);
    assert.match(same.out(), /nothing to promote/);
    assert.ok(!same.git.list().some(a => a.startsWith('push') || a.startsWith('merge --')));
});

test('run: the job retried after a complete promote (next moved on to the betas): nothing to promote, exit 0', async () => {
    const h = harness({ancestors: ['origin/main origin/next', `${OLDNEXT} origin/main`]}, {CI_COMMIT_SHA: OLDNEXT});
    assert.equal(await run(h.io), 0, h.out());
    assert.match(h.out(), /nothing to promote/);
    assert.ok(!h.git.list().some(a => a.startsWith('push') || a.startsWith('commit') || a.startsWith('merge --')));
});

test('run: notes hitting PUBLIC_DENY_REGEX (Review Focus 5): exit 1, neither the regex nor the match in the log', async () => {
    const regex = '\\b(Rider Alpha)\\b';
    const h = harness({}, {PUBLIC_DENY_REGEX: regex});
    assert.equal(await run(h.io), 1);
    assert.match(h.out(), /PUBLIC_DENY_REGEX/);
    assert.ok(!h.out().includes(regex), 'regex printed');
    assert.ok(!h.out().includes('Alpha'), 'match printed');
    assert.deepEqual(h.written, []);
    assert.ok(!h.git.list().some(a => a.startsWith('push') || a.startsWith('checkout')));
    // the same notes pass a deny list that does not name them
    const ok = harness({}, {PUBLIC_DENY_REGEX: '\\b(Rider Omega)\\b'});
    assert.equal(await run(ok.io), 0, ok.out());
});

test('run: a deny regex that does not compile stops the job without printing it', async () => {
    const h = harness({}, {PUBLIC_DENY_REGEX: '(Secret Name'});
    assert.equal(await run(h.io), 1);
    assert.ok(!h.out().includes('Secret'));
    assert.deepEqual(h.written, []);
});

test('run: the token never reaches the log, also when git prints it in an error', async () => {
    const h = harness({fail: {'push origin main': {code: 128, stdout: '', stderr: `fatal: unable to access '${PUSH_URL}/': 403`}}});
    assert.equal(await run(h.io), 1);
    assert.ok(!h.out().includes(TOKEN), h.out());
    assert.match(h.out(), /403/);
    assert.ok(!h.git.list().some(a => a.startsWith('push -o')), 'next is not pushed after main failed');
    const good = harness();
    await run(good.io);
    assert.ok(!good.out().includes(TOKEN));
});

test('run: the next push fails after main went out, next unchanged: exit 1 and the log says to re-run', async () => {
    const h = harness({ancestors: ['origin/main origin/next', 'origin/next next'],
        fail: {'push -o ci.skip origin next': {code: 1, stdout: '', stderr: 'fatal: unable to access: timeout'}}});
    assert.equal(await run(h.io), 1);
    assert.deepEqual(h.git.list().slice(-3), ['push -o ci.skip origin next', 'fetch origin +refs/heads/next:refs/remotes/origin/next',
        'merge-base --is-ancestor origin/next next']);
    assert.match(h.out(), /main is pushed/);
    assert.match(h.out(), /re-run/i);
});

test('run: next moved during the promote: exit 1, says to merge main into next by hand, not to re-run', async () => {
    const h = harness({fail: {'push -o ci.skip origin next': {code: 1, stdout: '', stderr: ' ! [rejected]        next -> next (fetch first)\nerror: failed to push some refs\nhint: Updates were rejected\nhint: x\nhint: y'}}});
    assert.equal(await run(h.io), 1);
    assert.match(h.out(), /next moved during the promote/);
    assert.match(h.out(), /merge main into next by hand/);
    assert.ok(!/re-run/i.test(h.out()));
});

test('run: git error details keep the reason and drop git\'s hint: lines', async () => {
    const h = harness({fail: {'push origin main': {code: 1, stdout: '',
        stderr: 'To host\n ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs to \'host\'\nhint: Updates were rejected because the remote contains work\nhint: that you do not have locally.\nhint: See the note about fast-forwards.\n'}}});
    assert.equal(await run(h.io), 1);
    assert.match(h.out(), /! \[rejected\] +main -> main \(fetch first\)/);
    assert.ok(!h.out().includes('hint:'), h.out());
});

test('run: this pipeline\'s commit is on main but main is not in next: exit 1, merge main into next by hand', async () => {
    const h = harness({ancestors: [`${OLDNEXT} origin/main`]}, {CI_COMMIT_SHA: OLDNEXT});
    assert.equal(await run(h.io), 1);
    assert.match(h.out(), /merge main into next by hand/);
    assert.ok(!/nothing to promote/.test(h.out()));
});

test('run: mod changed without a Mod line in CHANGES.md: exit 1, one line', async () => {
    const h = harness({trees: {'origin/next': {...NEXT_TREE, 'CHANGES.md': SERVER_ONLY_CHANGES}}});
    assert.equal(await run(h.io), 1);
    assert.match(h.out(), /CHANGES\.md/);
    assert.deepEqual(h.written, []);
});

// ---------------------------------------------------------------- run against real git

const sh = (cwd, ...args) => {
    const r = spawnSync('git', args, {cwd, encoding: 'utf8'});
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
};
const gitAvailable = spawnSync('git', ['--version']).status === 0;
const skip = !gitAvailable && 'no git';
const ID = ['-c', 'user.name=Test', '-c', 'user.email=test@invalid'];

// origin (bare, push options on, a hook that logs them) with main = mod 0.3.3 / server 0.3.6 and
// next = betas plus a mod and a server change; a CI-like clone at next; run() with real git, the
// push URL rewritten to the bare repository.
function realSetup({serverOnly = false} = {}) {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'pl-promote-')));
    const origin = path.join(root, 'origin.git');
    const work = path.join(root, 'seed');
    sh(root, 'init', '-q', '--bare', '-b', 'main', origin);
    sh(origin, 'config', 'receive.advertisePushOptions', 'true');
    writeFileSync(path.join(origin, 'hooks', 'pre-receive'),
        '#!/bin/sh\nwhile read old new ref; do echo "$ref ${GIT_PUSH_OPTION_COUNT:-0} ${GIT_PUSH_OPTION_0:-}" >> push-options.log; done\n');
    chmodSync(path.join(origin, 'hooks', 'pre-receive'), 0o755);
    sh(root, 'init', '-q', '-b', 'main', work);
    const put = (rel, text) => {
        mkdirSync(path.dirname(path.join(work, rel)), {recursive: true});
        writeFileSync(path.join(work, rel), text);
    };
    const save = (msg, ...refs) => {
        sh(work, 'add', '-A');
        sh(work, ...ID, 'commit', '-q', '-m', msg);
        sh(work, 'push', '-q', origin, ...refs);
    };
    for (const [f, t] of Object.entries(tree('0.3.3', 'release', '0.3.6', '# Changes\n\n## Unreleased\n\n### Mod\n\n### Server\n'))) {
        put(f, t);
    }
    put('pages/src/engine/plan.mjs', 'export const x = 1;\n');
    put('server/app.mjs', 'one\n');
    sh(work, 'add', '-A');
    sh(work, ...ID, 'commit', '-q', '-m', 'main');
    sh(work, 'checkout', '-q', '-b', 'next');
    if (serverOnly) {
        put('pages/src/version.mjs', versionMjs('0.3.3', 'beta'));
        put('CHANGES.md', '# Changes\n\n## Unreleased\n\n### Mod\n\n### Server\n- A race list.\n');
    } else {
        for (const [f, t] of Object.entries(tree('0.3.4-beta.5', 'beta', '0.4.0-beta.2',
            '# Changes\n\n## Unreleased\n\n### Mod\n- A calmer countdown.\n\n### Server\n- A race list.\n'))) {
            put(f, t);
        }
        put('pages/src/thing.mjs', 'new mod code\n');
    }
    put('server/VERSION', '0.4.0-beta.2\n');
    put('server/app.mjs', 'two\n');
    save('next work', 'main', 'next');
    rmSync(path.join(origin, 'push-options.log'), {force: true});   // only the promote's pushes
    const ci = path.join(root, 'ci');
    sh(root, 'clone', '-q', origin, ci);
    const exec = (cmd, args, opts = {}) => {
        const env = {...process.env, ...opts.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.${origin}.insteadOf`,
            GIT_CONFIG_VALUE_0: PUSH_URL, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null'};
        const r = spawnSync(cmd, args, {cwd: ci, env, encoding: 'utf8'});
        return {code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? ''};
    };
    const lines = [];
    const io = {
        env: ciEnv(), exec, now,
        writeFile: (rel, text) => writeFileSync(path.join(ci, rel), text),
        log: s => lines.push(String(s)),
    };
    // A new pipeline on origin's next: the CI clone at that commit, CI_COMMIT_SHA set to it.
    const pipeline = () => {
        sh(ci, 'fetch', '-q', 'origin');
        sh(ci, 'checkout', '-q', '--detach', 'origin/next');
        io.env.CI_COMMIT_SHA = sh(ci, 'rev-parse', 'HEAD');
        lines.length = 0;
    };
    // More work on origin's next, as a builder would push it.
    const work_on_next = (edits, msg) => {
        sh(work, 'fetch', '-q', origin, 'next');
        sh(work, 'checkout', '-q', '-B', 'next', 'FETCH_HEAD');
        for (const [f, t] of Object.entries(edits)) {
            put(f, t);
        }
        save(msg, 'next');
    };
    pipeline();
    return {root, origin, ci, io, lines, pipeline, work_on_next, out: () => lines.join('\n')};
}

const showAt = (repo, ref, file) => sh(repo, 'show', `${ref}:${file}`);
const channelCheck = (repo, ref, branch) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pl-promote-tree-'));
    try {
        for (const f of ['manifest.json', 'pages/src/version.mjs', 'server/VERSION']) {
            mkdirSync(path.dirname(path.join(dir, f)), {recursive: true});
            writeFileSync(path.join(dir, f), showAt(repo, ref, f) + '\n');
        }
        mkdirSync(path.join(dir, 'scripts'));
        writeFileSync(path.join(dir, 'scripts/check-channel.mjs'),
            readFileSync(new URL('../scripts/check-channel.mjs', import.meta.url)));
        return spawnSync(process.execPath, ['scripts/check-channel.mjs', branch], {cwd: dir, encoding: 'utf8'});
    } finally {
        rmSync(dir, {recursive: true, force: true});
    }
};
const assertChannels = (origin, main, next) => {
    const m = channelCheck(origin, 'main', 'main');
    assert.equal(m.status, 0, m.stderr);
    assert.match(m.stdout, new RegExp(`channel ok: main mod ${main.mod.replaceAll('.', '\\.')} release, server ${main.server.replaceAll('.', '\\.')}`));
    const n = channelCheck(origin, 'next', 'next');
    assert.equal(n.status, 0, n.stderr);
    assert.match(n.stdout, new RegExp(`channel ok: next mod ${next.mod.replaceAll('.', '\\.')} beta, server ${next.server.replaceAll('.', '\\.')}`));
    for (const ref of ['main', 'next']) {
        const v = /VERSION = '([^']*)'/.exec(showAt(origin, ref, 'pages/src/version.mjs'))[1];
        assert.equal(JSON.parse(showAt(origin, ref, 'package.json')).version, v, `${ref}: package.json`);
        assert.match(showAt(origin, ref, 'README.md'), new RegExp(`^# Paceline ${v.replaceAll('.', '\\.')}$`, 'm'), `${ref}: README title`);
    }
};

test('real git: a full promote: main final, next on the merge plus the betas, then retries do nothing', {skip}, async () => {
    const s = realSetup();
    try {
        assert.equal(await run(s.io), 0, s.out());
        const main = sh(s.origin, 'rev-parse', 'main');
        const next = sh(s.origin, 'rev-parse', 'next');
        assert.equal(sh(s.origin, 'log', '-1', '--format=%P', 'next'), main, 'next = the merge plus one commit');
        assert.equal(sh(s.origin, 'log', '-1', '--format=%s', 'next'), 'Next betas: mod 0.3.5-beta.0, server 0.4.1-beta.0');
        assert.deepEqual(sh(s.origin, 'diff', '--name-only', 'main', 'next').split('\n').sort(),
            ['README.md', 'manifest.json', 'package.json', 'pages/src/version.mjs', 'server/VERSION']);
        assertChannels(s.origin, {mod: '0.3.4', server: '0.4.0'}, {mod: '0.3.5-beta.0', server: '0.4.1-beta.0'});
        assert.match(showAt(s.origin, 'main', 'CHANGES.md'), /^## 0\.3\.4 \(2026-11-23\)$/m);
        assert.equal(showAt(s.origin, 'next', 'CHANGES.md'), showAt(s.origin, 'main', 'CHANGES.md'));
        assert.equal(sh(s.origin, 'log', '-1', '--format=%an <%ae>', 'main'), 'Paceline CI <ci@invalid>');
        assert.deepEqual(readFileSync(path.join(s.origin, 'push-options.log'), 'utf8').trim().split('\n'),
            ['refs/heads/main 0 ', 'refs/heads/next 1 ci.skip'], 'main a normal push, next with ci.skip');
        assert.ok(!sh(s.ci, 'config', '--list', '--local').includes(TOKEN), 'token persisted in .git/config');
        // the same job again (same pipeline, next moved on), then a pipeline of the new next
        s.lines.length = 0;
        assert.equal(await run(s.io), 0, s.out());
        assert.match(s.out(), /nothing to promote/);
        s.pipeline();
        assert.equal(await run(s.io), 0, s.out());
        assert.match(s.out(), /nothing to promote/);
        assert.equal(sh(s.origin, 'rev-parse', 'main'), main);
        assert.equal(sh(s.origin, 'rev-parse', 'next'), next);
    } finally {
        rmSync(s.root, {recursive: true, force: true});
    }
});

test('real git: main pushed, next push lost: the rerun puts next on main with the betas, never a second merge', {skip}, async () => {
    const s = realSetup();
    try {
        const oldNext = sh(s.origin, 'rev-parse', 'next');
        assert.equal(await run(s.io), 0, s.out());
        const main = sh(s.origin, 'rev-parse', 'main');
        // undo the next push on the server only: as if it had failed
        sh(s.origin, 'update-ref', 'refs/heads/next', oldNext);
        s.lines.length = 0;
        assert.equal(await run(s.io), 0, s.out());
        assert.equal(sh(s.origin, 'rev-parse', 'main'), main, 'no second merge');
        assert.equal(sh(s.origin, 'log', '-1', '--format=%P', 'next'), main, 'next = main plus the betas');
        assertChannels(s.origin, {mod: '0.3.4', server: '0.4.0'}, {mod: '0.3.5-beta.0', server: '0.4.1-beta.0'});
        assert.equal(sh(s.origin, 'rev-list', '--count', '--merges', 'main^1..next'), '1', 'one merge only');
    } finally {
        rmSync(s.root, {recursive: true, force: true});
    }
});

test('real git: next moved between fetch and push: main out, next kept, both runs say to merge main into next by hand', {skip}, async () => {
    const s = realSetup();
    try {
        const exec = s.io.exec;
        let moved = null;
        s.io.exec = (cmd, args, opts) => {
            if (args.join(' ') === 'checkout -B next main' && !moved) {
                s.work_on_next({'pages/src/other.mjs': 'pushed meanwhile\n'}, 'a push to next during the job');
                moved = sh(s.origin, 'rev-parse', 'next');
            }
            return exec(cmd, args, opts);
        };
        assert.equal(await run(s.io), 1, s.out());
        assert.match(s.out(), /pushed main/);
        assert.match(s.out(), /next moved during the promote/);
        assert.match(s.out(), /\[rejected\]/, 'the reason, not hint: lines');
        assert.equal(sh(s.origin, 'rev-parse', 'next'), moved, 'the newer next survives, never forced');
        assert.match(sh(s.origin, 'log', '-1', '--format=%s', 'main'), /^Promote next to production: /);
        const main = sh(s.origin, 'rev-parse', 'main');
        // the same job again: not "nothing to promote"
        s.lines.length = 0;
        assert.equal(await run(s.io), 1, s.out());
        assert.match(s.out(), /merge main into next by hand/);
        // the newest next pipeline: the hotfix refusal (merge main into next first)
        s.pipeline();
        assert.equal(await run(s.io), 1, s.out());
        assert.match(s.out(), /merge main into next first/);
        assert.equal(sh(s.origin, 'rev-parse', 'main'), main);
        assert.equal(sh(s.origin, 'rev-parse', 'next'), moved);
    } finally {
        rmSync(s.root, {recursive: true, force: true});
    }
});

test('real git: server only: main keeps mod 0.3.3 with CHANNEL release, next keeps 0.3.3 beta', {skip}, async () => {
    const s = realSetup({serverOnly: true});
    try {
        const before = Object.fromEntries(['manifest.json', 'pages/src/version.mjs', 'package.json', 'README.md']
            .map(f => [f, showAt(s.origin, 'main', f)]));
        assert.equal(await run(s.io), 0, s.out());
        for (const [f, t] of Object.entries(before)) {
            assert.equal(showAt(s.origin, 'main', f), t, f);
        }
        // the merge brings no mod path to main, so main's mod jobs (changes: *mod-paths) stay idle
        assert.deepEqual(sh(s.origin, 'diff', '--name-only', 'main^1', 'main').split('\n').sort(), ['CHANGES.md', 'server/VERSION', 'server/app.mjs']);
        assertChannels(s.origin, {mod: '0.3.3', server: '0.4.0'}, {mod: '0.3.3', server: '0.4.1-beta.0'});
    } finally {
        rmSync(s.root, {recursive: true, force: true});
    }
});

test('real git: a mod release, then server-only work: the second promote releases no mod', {skip}, async () => {
    const s = realSetup();
    try {
        assert.equal(await run(s.io), 0, s.out());
        s.work_on_next({
            'server/app.mjs': 'three\n', 'server/VERSION': '0.4.1-beta.1\n',
            'CHANGES.md': showAt(s.origin, 'next', 'CHANGES.md').replace('### Server\n', '### Server\n- Faster pages.\n'),
        }, 'server work');
        s.pipeline();
        assert.equal(await run(s.io), 0, s.out());
        assert.match(s.out(), /mod unchanged \(0\.3\.4 as on main\)/);
        assert.deepEqual(sh(s.origin, 'diff', '--name-only', 'main^1', 'main').split('\n').sort(), ['CHANGES.md', 'server/VERSION', 'server/app.mjs'],
            'no mod path changes on main: no empty mod release');
        assert.match(showAt(s.origin, 'main', 'CHANGES.md'), /^## 0\.4\.1 \(2026-11-23\)$/m);
        assertChannels(s.origin, {mod: '0.3.4', server: '0.4.1'}, {mod: '0.3.5-beta.0', server: '0.4.2-beta.0'});
    } finally {
        rmSync(s.root, {recursive: true, force: true});
    }
});
