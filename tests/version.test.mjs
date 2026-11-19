import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, symlinkSync, realpathSync, rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {channelProblem, serverProblem} from '../scripts/check-channel.mjs';
import {VERSION, CHANNEL} from '../pages/src/version.mjs';
import {DEFAULT_SERVER_URL, RELEASE_SERVER_URL, BETA_SERVER_URL} from '../pages/src/engine/planserver.mjs';

const json = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));

test('channelProblem: main needs a plain release version', () => {
    assert.equal(channelProblem({branch: 'main', version: '0.3.0', channel: 'release'}), null);
    assert.match(channelProblem({branch: 'main', version: '0.3.0-beta.2', channel: 'release'}), /suffix/);
    assert.match(channelProblem({branch: 'main', version: '0.3.0', channel: 'beta'}), /release/);
});

test('channelProblem: next needs the beta channel', () => {
    assert.equal(channelProblem({branch: 'next', version: '0.3.0-beta.2', channel: 'beta'}), null);
    assert.match(channelProblem({branch: 'next', version: '0.3.0', channel: 'release'}), /beta/);
    assert.equal(channelProblem({branch: 'phase0', version: '0.3.0', channel: 'release'}), null);
    assert.equal(channelProblem({branch: '', version: '0.3.0', channel: 'release'}), null);
});

test('manifest, package and VERSION agree', () => {
    assert.equal(json('../manifest.json').version, VERSION);
    assert.equal(json('../package.json').version, VERSION);
    assert.ok(['beta', 'release'].includes(CHANNEL));
    assert.match(VERSION, /^\d{1,3}(\.\d{1,3}){2}(-beta\.\d{1,3})?$/);
});

test('the default server follows CHANNEL', () => {
    assert.equal(DEFAULT_SERVER_URL, CHANNEL === 'beta' ? BETA_SERVER_URL : RELEASE_SERVER_URL);
    assert.equal(RELEASE_SERVER_URL, 'https://ttt.mafl.net');
});

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// The CLI tests run the script in a temporary tree with its own fixed beta version, so they
// exercise the failure path whatever version the repo itself carries (a release commit on main
// has a plain version and must still pass npm test).
function betaTree() {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'paceline-tree-')));
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'pages/src'), {recursive: true});
    copyFileSync(join(repoRoot, 'scripts/check-channel.mjs'), join(root, 'scripts/check-channel.mjs'));
    writeFileSync(join(root, 'pages/src/version.mjs'), "export const VERSION = '0.3.0-beta.1';\nexport const CHANNEL = 'beta';\n");
    writeFileSync(join(root, 'manifest.json'), JSON.stringify({version: '0.3.0-beta.1'}));
    mkdirSync(join(root, 'server'));
    writeFileSync(join(root, 'server/VERSION'), '0.3.0-beta.1\n');
    return root;
}

test('CLI: main with a beta version exits 1 with the suffix message', () => {
    const root = betaTree();
    try {
        const r = spawnSync(process.execPath, [join(root, 'scripts/check-channel.mjs'), 'main'], {encoding: 'utf8'});
        assert.equal(r.status, 1);
        assert.match(r.stdout + r.stderr, /suffix/);
        const n = spawnSync(process.execPath, [join(root, 'scripts/check-channel.mjs'), 'next'], {encoding: 'utf8'});
        assert.equal(n.status, 0);
        assert.match(n.stdout, /channel ok: next mod 0\.3\.0-beta\.1 beta, server 0\.3\.0-beta\.1/);
        const m = spawnSync(process.execPath, [join(root, 'scripts/check-channel.mjs'), ''], {encoding: 'utf8'});
        assert.equal(m.status, 0);
        assert.match(m.stdout, /channel ok: \(no branch\) /);
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});

test('CLI: still checks when the checkout is reached through a symlink', () => {
    const root = betaTree();
    const holder = realpathSync(mkdtempSync(join(tmpdir(), 'paceline-link-')));
    try {
        const link = join(holder, 'linked');
        symlinkSync(root, link);
        const r = spawnSync(process.execPath, [join(link, 'scripts/check-channel.mjs'), 'main'], {encoding: 'utf8'});
        assert.equal(r.status, 1);
        assert.match(r.stdout + r.stderr, /suffix/);
    } finally {
        rmSync(holder, {recursive: true, force: true});
        rmSync(root, {recursive: true, force: true});
    }
});

test('CLI: still checks with --preserve-symlinks-main (must not fail open)', () => {
    const root = betaTree();
    const holder = realpathSync(mkdtempSync(join(tmpdir(), 'paceline-link-')));
    try {
        const link = join(holder, 'linked');
        symlinkSync(root, link);
        const r = spawnSync(process.execPath, ['--preserve-symlinks-main', join(link, 'scripts/check-channel.mjs'), 'main'], {encoding: 'utf8'});
        assert.equal(r.status, 1);
        assert.match(r.stdout + r.stderr, /suffix/);
    } finally {
        rmSync(holder, {recursive: true, force: true});
        rmSync(root, {recursive: true, force: true});
    }
});

test('CLI: importing the module from node -e neither throws nor runs the check', () => {
    const root = betaTree();
    try {
        const script = join(root, 'scripts/check-channel.mjs');
        const r = spawnSync(process.execPath,
            ['-e', 'import(process.env.CHECK_SCRIPT).then(m => console.log(typeof m.channelProblem))', 'no-such-file'],
            {encoding: 'utf8', env: {...process.env, CHECK_SCRIPT: script}});
        assert.equal(r.status, 0, r.stderr);
        assert.equal(r.stdout.trim(), 'function');
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});

test('CLI: manifest.json differing from VERSION exits 1', () => {
    const root = betaTree();
    try {
        writeFileSync(join(root, 'manifest.json'), JSON.stringify({version: '0.3.0-beta.2'}));
        const r = spawnSync(process.execPath, [join(root, 'scripts/check-channel.mjs'), 'next'], {encoding: 'utf8'});
        assert.equal(r.status, 1);
        assert.match(r.stderr, /manifest\.json version 0\.3\.0-beta\.2 differs from VERSION 0\.3\.0-beta\.1/);
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});

test('CLI: CI_DEFAULT_BRANCH decides which branch is the release branch', () => {
    const root = betaTree();
    try {
        const script = join(root, 'scripts/check-channel.mjs');
        const env = {...process.env, CI_DEFAULT_BRANCH: 'trunk'};
        const t = spawnSync(process.execPath, [script, 'trunk'], {encoding: 'utf8', env});
        assert.equal(t.status, 1);
        assert.match(t.stderr, /^trunk needs a plain version/);
        const m = spawnSync(process.execPath, [script, 'main'], {encoding: 'utf8', env});
        assert.equal(m.status, 0);
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
});

test('channelProblem: defaultBranch can be something other than main', () => {
    assert.match(channelProblem({branch: 'trunk', defaultBranch: 'trunk', version: '0.3.0-beta.1', channel: 'release'}), /^trunk needs a plain version/);
    assert.equal(channelProblem({branch: 'main', defaultBranch: 'trunk', version: '0.3.0-beta.1', channel: 'release'}), null);
});


test('serverProblem: server/VERSION is a version, plain on main', () => {
    assert.equal(serverProblem({branch: 'main', version: '0.3.4'}), null);
    assert.match(serverProblem({branch: 'main', version: '0.3.4-beta.1'}), /plain server version/);
    assert.equal(serverProblem({branch: 'next', version: '0.3.4-beta.1'}), null);
    assert.equal(serverProblem({branch: 'next', version: '0.3.4'}), null);
    for (const bad of ['', '0.3', 'v0.3.4', '0.3.4-rc1', ' 0.3.4', undefined]) {
        assert.match(serverProblem({branch: 'next', version: bad}), /not a version/, String(bad));
    }
});
