// Run with: node --test tests/githubrelease.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {run, lookupRequest, createRequest, uploadRequest, releaseFile, listRequest, deleteRequest, staleBetas} from '../scripts/github-release.mjs';

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
const isList = (url, init) => init.method === 'GET' && url.startsWith('https://api.github.com/repos/o/r/releases?per_page=100');
const isDelete = (url, init) => init.method === 'DELETE';
const noBetas = [isList, reply(200, [])];

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

test('release exists with the zip: one lookup and the beta check, nothing else', async () => {
    const {fn, calls} = stub([[isLookup, reply(200, {upload_url: UPLOAD, assets: [{name: 'paceline-1.2.3.zip'}]})], noBetas]);
    const logs = [];
    const status = await run({env: env(), fetchFn: fn, readFile, log: m => logs.push(m)});
    assert.equal(status, 'exists');
    assert.deepEqual(calls.map(c => c.method), ['GET', 'GET']);    // the lookup, then the betas to clean up: none
    assert.equal(calls[1].url, 'https://api.github.com/repos/o/r/releases?per_page=100&page=1');
    assert.ok(!logs.join('\n').includes('Warning'));
    assert.match(logs.join('\n'), /exists already, nothing to do/);
});

test('no release yet: creates it on the snapshot commit, then uploads the zip', async () => {
    const {fn, calls} = stub([
        [isLookup, reply(404, {message: 'Not Found'})],
        [isCreate, reply(201, {id: 7, upload_url: UPLOAD, assets: []})],
        [isUpload, reply(201, {name: 'paceline-1.2.3.zip'})],
        noBetas,
    ]);
    const status = await run({env: env({RELEASE_NOTES: '1.2.3: something'}), fetchFn: fn, readFile, log() {}});
    assert.equal(status, 'created');
    assert.deepEqual(calls.map(c => c.method), ['GET', 'POST', 'POST', 'GET']);
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
        noBetas,
    ]);
    assert.equal(await run({env: env(), fetchFn: fn, readFile, log() {}}), 'repaired');
    assert.deepEqual(calls.map(c => c.method), ['GET', 'POST', 'GET']);
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

test('DRY_RUN: reads only (the release, the betas), sends no token without one, creates nothing', async () => {
    const {fn, calls} = stub([[isLookup, reply(404, '')], noBetas]);
    const logs = [];
    const status = await run({env: {GITHUB_REPO: 'o/r', DRY_RUN: '1'}, fetchFn: fn, readFile, log: m => logs.push(m)});
    assert.equal(status, 'dry-run');
    assert.deepEqual(calls.map(c => c.method), ['GET', 'GET']);    // the lookup and the beta list, read-only
    assert.equal(calls[0].headers.Authorization, undefined);
    assert.match(logs.join('\n'), /Dry run: would create release v1\.2\.3 .* \(dist\/paceline-1\.2\.3\.zip: 9 bytes\)/);

    // Existing release with the zip: still a plain no-op; a missing zip is only reported.
    const s2 = stub([[isLookup, reply(200, {assets: [{name: 'paceline-1.2.3.zip'}]})], noBetas]);
    assert.equal(await run({env: env({DRY_RUN: '1'}), fetchFn: s2.fn, readFile, log() {}}), 'exists');
    const s3 = stub([[isLookup, reply(404, '')], noBetas]);
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

test('GITHUB_PRERELEASE=1 without the zip (no mod change in the push): nothing created, no error', async () => {
    const {fn, calls} = stub([[isBetaLookup, reply(404, {message: 'Not Found'})]]);
    const noZip = (path, enc) => path === 'manifest.json' ? betaFile(path, enc) : (() => {
        throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), {code: 'ENOENT'});
    })();
    const logs = [];
    assert.equal(await run({env: env({GITHUB_PRERELEASE: '1'}), fetchFn: fn, readFile: noZip, log: m => logs.push(m)}), 'no-zip');
    assert.deepEqual(calls.map(c => c.method), ['GET']);
    assert.match(logs.join('\n'), /No dist\/paceline-1\.3\.0-beta\.2\.zip .*next push that changes the mod/);
    // Any other read error still fails, and a stable release without its zip too (test above).
    const broken = (path, enc) => path === 'manifest.json' ? betaFile(path, enc) : (() => { throw new Error('EACCES'); })();
    await assert.rejects(run({env: env({GITHUB_PRERELEASE: '1'}), fetchFn: stub([[isBetaLookup, reply(404, {})]]).fn,
        readFile: broken, log() {}}), /EACCES/);
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


// ---- after a final release the betas it replaces go (user, 25 Nov 2026), their tags stay ----

const rel = (id, tag, prerelease = true) => ({id, tag_name: tag, prerelease});

test('staleBetas: the betas of the version and older, never newer ones or final releases', () => {
    const all = [rel(1, 'v1.2.3-beta.0'), rel(2, 'v1.2.3-beta.4'), rel(3, 'v1.1.9-beta.1'), rel(4, 'v1.2.4-beta.0'),
                 rel(5, 'v1.3.0-beta.1'), rel(6, 'v1.2.2', false), rel(7, 'v0.9.0-rc.1'), rel(8, 'v2.0.0-beta.0'),
                 rel(9, 'weird', true), rel(10, 'v1.2.3', true), rel(11, 'v1.2.0-hotfix', false)];
    assert.deepEqual(staleBetas(all, '1.2.3').map(r => r.id), [1, 2, 3, 7]);
    // numbers, not strings: 0.10.0 is above 0.9.0
    assert.deepEqual(staleBetas([rel(1, 'v0.10.0-beta.1'), rel(2, 'v0.9.0-beta.1')], '0.9.0').map(r => r.id), [2]);
    assert.deepEqual(staleBetas([], '1.2.3'), []);
    assert.deepEqual(listRequest('o/r', 2), {url: 'https://api.github.com/repos/o/r/releases?per_page=100&page=2', method: 'GET'});
    assert.deepEqual(deleteRequest('o/r', 42), {url: 'https://api.github.com/repos/o/r/releases/42', method: 'DELETE'});
});

test('a final release removes the replaced betas (release only, the tag stays); a newer beta stays', async () => {
    const page1 = [...Array.from({length: 99}, (_, i) => rel(100 + i, `v0.0.${i}`, false)), rel(1, 'v1.2.3-beta.1')];
    const page2 = [rel(2, 'v1.1.0-beta.0'), rel(3, 'v1.2.4-beta.0')];
    const {fn, calls} = stub([
        [isLookup, reply(404, '')],
        [isCreate, reply(201, {id: 7, upload_url: UPLOAD, assets: []})],
        [isUpload, reply(201, {})],
        [(url, init) => isList(url, init) && url.endsWith('page=1'), reply(200, page1)],
        [(url, init) => isList(url, init) && url.endsWith('page=2'), reply(200, page2)],
        [isDelete, reply(204, '')],
    ]);
    const logs = [];
    assert.equal(await run({env: env(), fetchFn: fn, readFile, log: m => logs.push(m)}), 'created');
    const deletes = calls.filter(c => c.method === 'DELETE');
    assert.deepEqual(deletes.map(c => c.url), ['https://api.github.com/repos/o/r/releases/1', 'https://api.github.com/repos/o/r/releases/2']);
    assert.ok(!calls.some(c => /\/git\/refs|\/tags\//.test(c.url) && c.method === 'DELETE'));    // tags are never touched
    assert.match(logs.join('\n'), /Removed the beta v1\.2\.3-beta\.1 \(its tag stays\)/);
    for (const c of deletes) {
        assert.equal(c.headers.Authorization, `Bearer ${TOKEN}`);
    }
});

test('a failed clean-up is only a warning (the release is done); dry run only lists', async () => {
    const logs = [];
    const s1 = stub([
        [isLookup, reply(200, {upload_url: UPLOAD, assets: [{name: 'paceline-1.2.3.zip'}]})],
        [isList, reply(200, [rel(1, 'v1.2.3-beta.0')])],
        [isDelete, reply(403, `no ${TOKEN}`)],
    ]);
    assert.equal(await run({env: env(), fetchFn: s1.fn, readFile, log: m => logs.push(m)}), 'exists');
    assert.match(logs.join('\n'), /Warning: the old betas were not all removed: Removing v1\.2\.3-beta\.0: HTTP 403/);
    // one failure does not stop the others
    const s4 = stub([
        [isLookup, reply(200, {upload_url: UPLOAD, assets: [{name: 'paceline-1.2.3.zip'}]})],
        [isList, reply(200, [rel(1, 'v1.2.3-beta.0'), rel(2, 'v1.2.3-beta.1')])],
        [(url, init) => isDelete(url, init) && url.endsWith('/1'), reply(500, 'boom')],
        [isDelete, reply(204, '')],
    ]);
    const l4 = [];
    assert.equal(await run({env: env(), fetchFn: s4.fn, readFile, log: m => l4.push(m)}), 'exists');
    assert.deepEqual(s4.calls.filter(c => c.method === 'DELETE').length, 2);
    assert.match(l4.join('\n'), /Removed the beta v1\.2\.3-beta\.1/);
    assert.ok(!logs.join('\n').includes(TOKEN));
    // Dry run: lists what it would remove, deletes nothing.
    const l2 = [];
    const s2 = stub([[isLookup, reply(404, '')], [isList, reply(200, [rel(1, 'v1.2.3-beta.0')])]]);
    assert.equal(await run({env: env({DRY_RUN: '1'}), fetchFn: s2.fn, readFile, log: m => l2.push(m)}), 'dry-run');
    assert.match(l2.join('\n'), /would remove the betas v1\.2\.3-beta\.0 \(their tags stay\)/);
    assert.ok(!s2.calls.some(c => c.method === 'DELETE'));
});
