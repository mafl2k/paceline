// Run with: node --test tests/githubrelease.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {run, lookupRequest, createRequest, uploadRequest, releaseFile} from '../scripts/github-release.mjs';

const SHA = 'a'.repeat(40);
const TOKEN = 'ghp_secret_token_value';
const UPLOAD = 'https://uploads.github.com/repos/o/r/releases/7/assets{?name,label}';
const ZIP = Buffer.from('zip-bytes');

const env = (extra = {}) => ({GITHUB_REPO: 'o/r', GITHUB_TOKEN: TOKEN, GITHUB_RELEASE_SHA: SHA, ...extra});
const readFile = (path, enc) => {
    if (path === 'manifest.json') {
        return JSON.stringify({version: '1.2.3'});
    }
    if (path === 'dist/paceline-1.2.3.zip') {
        return ZIP;
    }
    throw new Error(`ENOENT ${path}`);
};
const reply = (status, data) => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => data,
    text: async () => typeof data === 'string' ? data : JSON.stringify(data),
});

// A fetch stub that answers from a list of [matcher, response] and records every call.
function stub(routes) {
    const calls = [];
    const fn = async (url, init) => {
        calls.push({url, ...init});
        for (const [match, resp] of routes) {
            if (match(url, init)) {
                return typeof resp === 'function' ? resp(url, init) : resp;
            }
        }
        throw new Error(`unexpected request ${init.method} ${url}`);
    };
    return {fn, calls};
}
const isLookup = (url, init) => init.method === 'GET' && url.endsWith('/releases/tags/v1.2.3');
const isCreate = (url, init) => init.method === 'POST' && url === 'https://api.github.com/repos/o/r/releases';
const isUpload = (url, init) => init.method === 'POST' && url.startsWith('https://uploads.github.com/');

test('requests: lookup, create and upload are built as the GitHub API wants them', () => {
    assert.deepEqual(lookupRequest('o/r', 'v1.2.3'),
        {url: 'https://api.github.com/repos/o/r/releases/tags/v1.2.3', method: 'GET'});
    const c = createRequest('o/r', '1.2.3', SHA, 'notes');
    assert.equal(c.url, 'https://api.github.com/repos/o/r/releases');
    assert.equal(c.method, 'POST');
    assert.deepEqual(c.body, {tag_name: 'v1.2.3', target_commitish: SHA, name: 'Paceline 1.2.3', body: 'notes',
                              draft: false, prerelease: false});
    assert.equal(createRequest('o/r', '1.2.3', SHA, '').body.body, 'Paceline 1.2.3');
    assert.deepEqual(uploadRequest(UPLOAD, '1.2.3'), {
        url: 'https://uploads.github.com/repos/o/r/releases/7/assets?name=paceline-1.2.3.zip',
        method: 'POST', contentType: 'application/zip'});
    assert.equal(releaseFile('1.2.3'), 'paceline-1.2.3.zip');
});

test('release exists with the zip: one lookup, nothing else', async () => {
    const {fn, calls} = stub([[isLookup, reply(200, {upload_url: UPLOAD, assets: [{name: 'paceline-1.2.3.zip'}]})]]);
    const logs = [];
    const status = await run({env: env(), fetchFn: fn, readFile, log: m => logs.push(m)});
    assert.equal(status, 'exists');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'GET');
    assert.match(logs.join('\n'), /exists already, nothing to do/);
});

test('no release yet: creates it on the snapshot commit, then uploads the zip', async () => {
    const {fn, calls} = stub([
        [isLookup, reply(404, {message: 'Not Found'})],
        [isCreate, reply(201, {id: 7, upload_url: UPLOAD, assets: []})],
        [isUpload, reply(201, {name: 'paceline-1.2.3.zip'})],
    ]);
    const status = await run({env: env({RELEASE_NOTES: '1.2.3: something'}), fetchFn: fn, readFile, log() {}});
    assert.equal(status, 'created');
    assert.deepEqual(calls.map(c => c.method), ['GET', 'POST', 'POST']);
    const create = JSON.parse(calls[1].body);
    assert.equal(create.tag_name, 'v1.2.3');
    assert.equal(create.target_commitish, SHA);
    assert.equal(create.name, 'Paceline 1.2.3');
    assert.equal(create.body, '1.2.3: something');
    assert.equal(calls[2].url, 'https://uploads.github.com/repos/o/r/releases/7/assets?name=paceline-1.2.3.zip');
    assert.equal(calls[2].headers['Content-Type'], 'application/zip');
    assert.equal(calls[2].body, ZIP);
    for (const c of calls) {
        assert.equal(c.headers.Authorization, `Bearer ${TOKEN}`);
    }
});

test('release exists without the zip (an earlier run stopped): only the zip is uploaded', async () => {
    const {fn, calls} = stub([
        [isLookup, reply(200, {id: 7, upload_url: UPLOAD, assets: []})],
        [isUpload, reply(201, {})],
    ]);
    assert.equal(await run({env: env(), fetchFn: fn, readFile, log() {}}), 'repaired');
    assert.deepEqual(calls.map(c => c.method), ['GET', 'POST']);
});

test('the token is not in the log or in an error message', async () => {
    const logs = [];
    const {fn} = stub([
        [isLookup, reply(404, 'Not Found')],
        [isCreate, reply(422, `bad credentials ${TOKEN}`)],
    ]);
    await assert.rejects(run({env: env(), fetchFn: fn, readFile, log: m => logs.push(m)}), e => {
        assert.match(e.message, /Creating release v1\.2\.3: HTTP 422/);
        assert.ok(!e.message.includes(TOKEN));
        return true;
    });
    assert.ok(!logs.join('\n').includes(TOKEN));
});

test('lookup errors other than 404 stop the run (nothing is created)', async () => {
    const {fn, calls} = stub([[isLookup, reply(500, 'boom')]]);
    await assert.rejects(run({env: env(), fetchFn: fn, readFile, log() {}}), /Looking up release v1\.2\.3: HTTP 500/);
    assert.equal(calls.length, 1);
});

test('a failing zip upload fails the run', async () => {
    const {fn} = stub([
        [isLookup, reply(404, '')],
        [isCreate, reply(201, {upload_url: UPLOAD, assets: []})],
        [isUpload, reply(502, 'bad gateway')],
    ]);
    await assert.rejects(run({env: env(), fetchFn: fn, readFile, log() {}}), /Uploading paceline-1\.2\.3\.zip.*HTTP 502/);
});

test('no token, no sha or no zip: refused before any request (outside a dry run)', async () => {
    const {fn, calls} = stub([]);
    await assert.rejects(run({env: env({GITHUB_TOKEN: ''}), fetchFn: fn, readFile, log() {}}), /GITHUB_TOKEN is not set/);
    await assert.rejects(run({env: env({GITHUB_RELEASE_SHA: 'main'}), fetchFn: fn, readFile, log() {}}), /GITHUB_RELEASE_SHA/);
    await assert.rejects(run({env: {GITHUB_TOKEN: TOKEN}, fetchFn: fn, readFile, log() {}}), /GITHUB_REPO/);
    assert.equal(calls.length, 0);
    // The zip is read before anything is created: no release without its file.
    const noZip = (path, enc) => path === 'manifest.json' ? readFile(path, enc) : (() => { throw new Error('ENOENT'); })();
    const s2 = stub([[isLookup, reply(404, '')]]);
    await assert.rejects(run({env: env(), fetchFn: s2.fn, readFile: noZip, log() {}}), /ENOENT/);
    assert.deepEqual(s2.calls.map(c => c.method), ['GET']);
});

test('DRY_RUN: looks up only, sends no token without one, creates nothing', async () => {
    const {fn, calls} = stub([[isLookup, reply(404, '')]]);
    const logs = [];
    const status = await run({env: {GITHUB_REPO: 'o/r', DRY_RUN: '1'}, fetchFn: fn, readFile, log: m => logs.push(m)});
    assert.equal(status, 'dry-run');
    assert.deepEqual(calls.map(c => c.method), ['GET']);
    assert.equal(calls[0].headers.Authorization, undefined);
    assert.match(logs.join('\n'), /Dry run: would create release v1\.2\.3 .* \(dist\/paceline-1\.2\.3\.zip: 9 bytes\)/);

    // Existing release with the zip: still a plain no-op; a missing zip is only reported.
    const s2 = stub([[isLookup, reply(200, {assets: [{name: 'paceline-1.2.3.zip'}]})]]);
    assert.equal(await run({env: env({DRY_RUN: '1'}), fetchFn: s2.fn, readFile, log() {}}), 'exists');
    const s3 = stub([[isLookup, reply(404, '')]]);
    const l3 = [];
    const noZip = (path, enc) => path === 'manifest.json' ? readFile(path, enc) : (() => { throw new Error('ENOENT'); })();
    assert.equal(await run({env: env({DRY_RUN: '1'}), fetchFn: s3.fn, readFile: noZip, log: m => l3.push(m)}), 'dry-run');
    assert.match(l3.join('\n'), /missing: this would fail/);
});

test('a manifest without a usable version is refused', async () => {
    const bad = path => JSON.stringify({version: 'dev'});
    await assert.rejects(run({env: env(), fetchFn: stub([]).fn, readFile: bad, log() {}}), /no usable version/);
});


// ---- pre-releases (GITHUB_PRERELEASE=1, the github-sync-beta job on branch next) ----

const BETA = '1.3.0-beta.2';
const betaFile = (path, enc) => {
    if (path === 'manifest.json') {
        return JSON.stringify({version: BETA});
    }
    if (path === `dist/paceline-${BETA}.zip`) {
        return ZIP;
    }
    throw new Error(`ENOENT ${path}`);
};
const isBetaLookup = (url, init) => init.method === 'GET' && url === `https://api.github.com/repos/o/r/releases/tags/v${BETA}`;

test('pre-release request: prerelease, never latest, the text says beta', () => {
    assert.deepEqual(createRequest('o/r', BETA, SHA, '', {prerelease: true}), {
        url: 'https://api.github.com/repos/o/r/releases',
        method: 'POST',
        body: {tag_name: `v${BETA}`, target_commitish: SHA, name: `Paceline ${BETA}`, body: `Paceline ${BETA} (beta)`,
               draft: false, prerelease: true, make_latest: 'false'},
    });
    assert.equal(createRequest('o/r', BETA, SHA, 'mod: something', {prerelease: true}).body.body,
        `Paceline ${BETA} (beta)\n\nmod: something`);
    // a stable release keeps exactly its body: no make_latest, so GitHub makes it latest as before
    assert.deepEqual(createRequest('o/r', '1.2.3', SHA, '', {prerelease: false}).body,
        {tag_name: 'v1.2.3', target_commitish: SHA, name: 'Paceline 1.2.3', body: 'Paceline 1.2.3', draft: false, prerelease: false});
});

test('GITHUB_PRERELEASE=1: creates the pre-release on the snapshot commit, then uploads the zip', async () => {
    const {fn, calls} = stub([
        [isBetaLookup, reply(404, {message: 'Not Found'})],
        [isCreate, reply(201, {id: 8, upload_url: UPLOAD, assets: []})],
        [isUpload, reply(201, {})],
    ]);
    const logs = [];
    const status = await run({env: env({GITHUB_PRERELEASE: '1', RELEASE_NOTES: 'mod: beta 2'}), fetchFn: fn,
        readFile: betaFile, log: m => logs.push(m)});
    assert.equal(status, 'created');
    assert.deepEqual(calls.map(c => c.method), ['GET', 'POST', 'POST']);
    assert.equal(calls[0].url, `https://api.github.com/repos/o/r/releases/tags/v${BETA}`);
    assert.deepEqual(JSON.parse(calls[1].body), {tag_name: `v${BETA}`, target_commitish: SHA, name: `Paceline ${BETA}`,
        body: `Paceline ${BETA} (beta)\n\nmod: beta 2`, draft: false, prerelease: true, make_latest: 'false'});
    assert.equal(calls[2].url, `https://uploads.github.com/repos/o/r/releases/7/assets?name=paceline-${BETA}.zip`);
    assert.equal(calls[2].body, ZIP);
    assert.match(logs.join('\n'), new RegExp(`Created pre-release v${BETA.replace(/\./g, '\\.')} on aaaaaaaa`));
});

test('GITHUB_PRERELEASE=1: an existing pre-release with the zip means nothing happens', async () => {
    const {fn, calls} = stub([[isBetaLookup, reply(200, {prerelease: true, upload_url: UPLOAD, assets: [{name: `paceline-${BETA}.zip`}]})]]);
    assert.equal(await run({env: env({GITHUB_PRERELEASE: '1'}), fetchFn: fn, readFile: betaFile, log() {}}), 'exists');
    assert.equal(calls.length, 1);
});

test('a beta never becomes a normal release, a plain version never a pre-release', async () => {
    const {fn, calls} = stub([]);
    await assert.rejects(run({env: env(), fetchFn: fn, readFile: betaFile, log() {}}),
        /1\.3\.0-beta\.2 is a beta: set GITHUB_PRERELEASE=1/);
    await assert.rejects(run({env: env({GITHUB_PRERELEASE: '1'}), fetchFn: fn, readFile, log() {}}),
        /GITHUB_PRERELEASE=1 needs a beta version with a suffix, got 1\.2\.3/);
    await assert.rejects(run({env: env({DRY_RUN: '1'}), fetchFn: fn, readFile: betaFile, log() {}}), /is a beta/);
    assert.equal(calls.length, 0);
});

test('DRY_RUN with GITHUB_PRERELEASE=1: says it would create a pre-release, creates nothing', async () => {
    const {fn, calls} = stub([[isBetaLookup, reply(404, '')]]);
    const logs = [];
    const status = await run({env: {GITHUB_REPO: 'o/r', DRY_RUN: '1', GITHUB_PRERELEASE: '1'}, fetchFn: fn,
        readFile: betaFile, log: m => logs.push(m)});
    assert.equal(status, 'dry-run');
    assert.deepEqual(calls.map(c => c.method), ['GET']);
    assert.match(logs.join('\n'), new RegExp(`Dry run: would create pre-release v${BETA.replace(/\./g, '\\.')} .* \\(dist/paceline-${BETA.replace(/\./g, '\\.')}\\.zip: 9 bytes\\)`));
});
