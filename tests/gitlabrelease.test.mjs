// Run with: node --test tests/gitlabrelease.test.mjs
// scripts/gitlab-release.mjs against a local stand-in for the GitLab API: what the release's
// description says. The script is not in the public copy (.public-exclude): there this is skipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {existsSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

const SCRIPT = new URL('../scripts/gitlab-release.mjs', import.meta.url).pathname;
const HELPER = new URL('../scripts/changes.mjs', import.meta.url).pathname;
const skip = !existsSync(SCRIPT) && 'scripts/gitlab-release.mjs is not in this copy';

// Runs the script in a throwaway layout and returns the body it POSTed to /releases.
async function release({changes, commitMessage}) {
    const dir = mkdtempSync(path.join(tmpdir(), 'pl-glrel-'));
    let posted = null;
    const server = createServer((req, res) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            const url = req.url;
            if (req.method === 'GET' && url.includes('/releases/')) {
                res.writeHead(404).end('{}');
            } else if (req.method === 'PUT') {
                res.writeHead(201).end('{}');
            } else if (req.method === 'POST' && url.endsWith('/releases')) {
                posted = JSON.parse(Buffer.concat(chunks).toString());
                res.writeHead(201).end('{}');
            } else {
                res.writeHead(500).end(url);
            }
        });
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    try {
        mkdirSync(path.join(dir, 'scripts'));
        mkdirSync(path.join(dir, 'dist'));
        copyFileSync(SCRIPT, path.join(dir, 'scripts', 'gitlab-release.mjs'));
        copyFileSync(HELPER, path.join(dir, 'scripts', 'changes.mjs'));
        writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({version: '1.2.3'}));
        writeFileSync(path.join(dir, 'dist', 'paceline-1.2.3.zip'), 'zip');
        if (changes !== null) {
            writeFileSync(path.join(dir, 'CHANGES.md'), changes);
        }
        const env = {
            ...process.env, CI_API_V4_URL: `http://127.0.0.1:${server.address().port}`, CI_PROJECT_ID: '1',
            CI_JOB_TOKEN: 't', CI_COMMIT_SHA: 'a'.repeat(40), CI_COMMIT_MESSAGE: commitMessage,
        };
        const child = spawn('node', ['scripts/gitlab-release.mjs'], {cwd: dir, env});
        let err = '';
        child.stderr.on('data', d => err += d);
        const code = await new Promise(r => child.on('close', r));
        assert.equal(code, 0, err);
        return posted;
    } finally {
        server.close();
        rmSync(dir, {recursive: true});
    }
}

const COMMIT = 'mod: something\n\nbody\n\nCo-Authored-By: Someone <x@example.org>';

test('the description is the version\'s CHANGES.md notes', {skip}, async () => {
    const body = await release({changes: '## Unreleased\n\n### Mod\n- not yet\n\n## 1.2.3 (2026-01-01)\n\n### Mod\n- a\n\n### Server\n- c\n', commitMessage: COMMIT});
    assert.equal(body.description, 'Mod:\n- a\n\nServer:\n- c');
    assert.equal(body.name, 'Paceline 1.2.3');
    assert.equal(body.tag_name, 'v1.2.3');
});

test('without a section for the version, or without CHANGES.md, it is the commit message as before', {skip}, async () => {
    const other = await release({changes: '## 1.2.2 (2026-01-01)\n\n### Mod\n- a\n', commitMessage: COMMIT});
    assert.equal(other.description, 'mod: something\n\nbody');
    const none = await release({changes: null, commitMessage: COMMIT});
    assert.equal(none.description, 'mod: something\n\nbody');
    const empty = await release({changes: '## 1.2.3 (2026-01-01)\n\n### Mod\n', commitMessage: ''});
    assert.equal(empty.description, 'Paceline 1.2.3');
});
