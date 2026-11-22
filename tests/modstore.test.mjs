// Run with: node --test tests/modstore.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {
    run, sha256Hex, uploadRequest, releaseEntry, withRelease, compareUrl, grepDenied, compareVersions, standing,
} from '../scripts/mod-store.mjs';

const META_TEXT = readFileSync(new URL('../store/paceline.json', import.meta.url), 'utf8');
const META = JSON.parse(META_TEXT);
const TOKEN = 'github_pat_fake_store_token_0123456789';
const FORK = 'mafl2k/sauce4zwift-mod-store';
const ZIP = Buffer.from('fake zip bytes for paceline 0.3.4');
const HASH = createHash('sha256').update(ZIP).digest('hex');
const ASSET_URL = `https://mod-api.sauce.llc/assets/paceline/${HASH}.zip`;
const NOW = 1795000000000;
const DENY = '\\b(Zorblax|Quuxley)\\b';

const API = 'https://api.github.com';
const UPSTREAM_GET = `GET ${API}/repos/SauceLLC/sauce4zwift-mod-store/contents/directory.json?ref=main`;
const REPO_GET = `GET ${API}/repos/${FORK}`;
const REF_GET = `GET ${API}/repos/${FORK}/git/ref/heads/paceline-0.3.4`;
const UPLOAD = 'PUT https://mod-api.sauce.llc/edit/release/asset';
const MERGE = `POST ${API}/repos/${FORK}/merge-upstream`;
const MAIN_GET = `GET ${API}/repos/${FORK}/git/ref/heads/main`;
const REF_POST = `POST ${API}/repos/${FORK}/git/refs`;
const BRANCH_GET = `GET ${API}/repos/${FORK}/contents/directory.json?ref=paceline-0.3.4`;
const FILE_PUT = `PUT ${API}/repos/${FORK}/contents/directory.json`;
const LINK = 'https://github.com/SauceLLC/sauce4zwift-mod-store/compare/main...mafl2k:sauce4zwift-mod-store:paceline-0.3.4?expand=1';

// The store's directory with two made-up mods, formatted as upstream (4 spaces, final newline).
const OTHER = [
    {
        releases: [{url: 'https://mod-api.sauce.llc/assets/gizmo/aa.zip', version: '1.0.0', updated: 1700000000000,
                    hash: 'aa', minVersion: '1.2.0', size: 10, notes: 'First.'}],
        id: '11111111-2222-3333-4444-555555555555', tags: ['fun'], name: 'Gizmo Widget',
        description: 'A made-up mod.', logoURL: 'https://example.invalid/gizmo.png',
        homeURL: 'https://example.invalid/gizmo', created: 1690000000000, authorName: 'Ada Example',
    },
    {
        releases: [{url: 'https://mod-api.sauce.llc/assets/doodad/bb.zip', version: '2.0.0', updated: 1710000000000,
                    hash: 'bb', minVersion: '2.3.0', size: 20, notes: 'Second.'}],
        id: '66666666-7777-8888-9999-000000000000', tags: ['tools'], name: 'Doodad',
        description: 'Another made-up mod.', logoURL: 'https://example.invalid/doodad.png',
        homeURL: 'https://example.invalid/doodad', created: 1705000000000, authorName: 'Bob Example',
        authorURL: 'https://example.invalid/bob',
    },
];
const format = dir => JSON.stringify(dir, null, 4) + '\n';
const b64 = text => Buffer.from(text).toString('base64').replace(/(.{60})/g, '$1\n');  // GitHub wraps it
const unb64 = text => Buffer.from(text, 'base64').toString('utf8');

const CHANGES = [
    '# Changes', '', '## Unreleased', '', '### Mod', '', '### Server', '',
    '## 0.3.4 (2026-11-23)', '', '### Mod', '- The countdown learns your team.', '- Big numbers.',
    '', '### Server', '- A server change.', '',
    '## 0.3.3 (2026-11-01)', '', '### Mod', '- Older.', '',
].join('\n');
const NOTES = '- The countdown learns your team.\n- Big numbers.';

function files({version = '0.3.4', changes = CHANGES, meta = META_TEXT} = {}) {
    return (path, enc) => {
        const map = {
            'manifest.json': JSON.stringify({name: 'Paceline', version}),
            'CHANGES.md': changes,
            'store/paceline.json': meta,
            [`dist/paceline-${version}.zip`]: ZIP,
        };
        if (!(path in map)) {
            throw Object.assign(new Error(`ENOENT: no such file, open '${path}'`), {code: 'ENOENT'});
        }
        return enc ? String(map[path]) : Buffer.from(map[path]);
    };
}
const env = (extra = {}) => ({STORE_FORK: FORK, STORE_TOKEN: TOKEN, PUBLIC_DENY_REGEX: DENY, ...extra});
const reply = (status, data) => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => data,
    text: async () => typeof data === 'string' ? data : JSON.stringify(data),
});
const jsDeny = (text, re) => new RegExp(re, 'i').test(text);

// A fetch stub: answers by "METHOD url", records every call. A missing route is a test failure.
function stub(routes) {
    const calls = [];
    const fn = async (url, init = {}) => {
        const key = `${init.method || 'GET'} ${url}`;
        calls.push({key, url, ...init});
        if (!(key in routes)) {
            throw new Error(`unexpected request ${key}`);
        }
        const r = routes[key];
        return typeof r === 'function' ? r(url, init) : r;
    };
    return {fn, calls};
}
const happyRoutes = (over = {}) => ({
    [UPSTREAM_GET]: reply(200, {content: b64(format(OTHER)), encoding: 'base64', sha: 'up1'}),
    [REPO_GET]: reply(200, {full_name: FORK}),
    [REF_GET]: reply(404, {message: 'Not Found'}),
    [UPLOAD]: reply(200, {hash: HASH, url: ASSET_URL}),
    [MERGE]: reply(200, {message: 'ok', merge_type: 'fast-forward', base_branch: 'SauceLLC:main'}),
    [MAIN_GET]: reply(200, {ref: 'refs/heads/main', object: {sha: 'c'.repeat(40), type: 'commit'}}),
    [REF_POST]: reply(201, {ref: 'refs/heads/paceline-0.3.4'}),
    [BRANCH_GET]: reply(200, {content: b64(format(OTHER)), encoding: 'base64', sha: 'blob1'}),
    [FILE_PUT]: reply(200, {content: {sha: 'blob2'}}),
    ...over,
});
async function go({routes = happyRoutes(), e = env(), read = files(), leak = jsDeny} = {}) {
    const {fn, calls} = stub(routes);
    const logs = [];
    const code = await run({env: e, fetchFn: fn, readFile: read, log: m => logs.push(String(m)), now: () => NOW,
                            leakCheck: leak});
    return {code, calls, keys: calls.map(c => c.key), logs, text: logs.join('\n')};
}
const writes = keys => keys.filter(k => !k.startsWith('GET '));
const githubWrites = keys => writes(keys).filter(k => k.includes('api.github.com'));

const expectedRelease = {url: ASSET_URL, version: '0.3.4', updated: NOW, hash: HASH, minVersion: '2.3.0',
                         size: ZIP.length, notes: NOTES};

// ---- the pure parts

test('store/paceline.json: the fixed store metadata', () => {
    assert.deepEqual(Object.keys(META).sort(),
        ['authorName', 'description', 'homeURL', 'id', 'logoURL', 'minVersion', 'name', 'tags']);
    assert.match(META.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(META.name, 'Paceline');
    assert.equal(META.homeURL, 'https://github.com/mafl2k/paceline');
    assert.equal(META.logoURL, 'https://raw.githubusercontent.com/mafl2k/paceline/main/docs/images/logo.png');
    assert.equal(META.authorName, 'Matthew Butcher');
    assert.equal(META.minVersion, '2.3.0');
    assert.deepEqual(META.tags, ['ttt', 'team time trial', 'pacing', 'rotation', 'wtrl']);
    const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
    assert.ok(META.description.startsWith(manifest.description + ' '), 'the manifest description comes first');
    assert.equal(META_TEXT, format(META), 'formatted like the store');
});

test('sha256Hex: the hex digest the store compares', () => {
    assert.equal(sha256Hex(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('uploadRequest: PUT of the raw zip to mod-api, no login', () => {
    const req = uploadRequest(ZIP);
    assert.equal(req.url, 'https://mod-api.sauce.llc/edit/release/asset');
    assert.equal(req.method, 'PUT');
    assert.deepEqual(req.headers, {'content-type': 'application/octet-stream'});
    assert.equal(req.body, ZIP);
});

test('releaseEntry: exactly the seven store keys, minVersion 2.3.0', () => {
    const r = releaseEntry({version: '0.3.4', hash: HASH, url: ASSET_URL, size: 33, notes: 'n', now: NOW,
                            minVersion: '2.3.0'});
    assert.deepEqual(Object.keys(r).sort(), ['hash', 'minVersion', 'notes', 'size', 'updated', 'url', 'version']);
    assert.deepEqual(r, {url: ASSET_URL, version: '0.3.4', updated: NOW, hash: HASH, minVersion: '2.3.0', size: 33,
                         notes: 'n'});
});

test('withRelease: a new mod gets the metadata, without minVersion or authorURL', () => {
    const rel = releaseEntry({version: '0.3.4', hash: HASH, url: ASSET_URL, size: 33, notes: 'n', now: NOW,
                              minVersion: META.minVersion});
    const before = structuredClone(OTHER);
    const {directory, changed} = withRelease(OTHER, META, rel);
    assert.equal(changed, true);
    assert.deepEqual(OTHER, before, 'the input is not changed');
    assert.equal(directory.length, 3);
    assert.deepEqual(directory.slice(0, 2), OTHER, 'the other mods stay as they are, in their order');
    const mine = directory[2];
    assert.deepEqual(mine, {
        releases: [rel], id: META.id, tags: META.tags, name: 'Paceline', description: META.description,
        logoURL: META.logoURL, homeURL: META.homeURL, created: NOW, authorName: 'Matthew Butcher',
    });
    assert.equal('authorURL' in mine, false);
    assert.equal('minVersion' in mine, false);
    assert.equal(mine.releases[0].minVersion, '2.3.0');
});

test('withRelease: a listed mod: its one release is the new one, the metadata refreshed, id and created kept', () => {
    const old = {url: 'https://mod-api.sauce.llc/assets/paceline/00.zip', version: '0.3.3', updated: 1, hash: '00',
                 minVersion: '2.3.0', size: 5, notes: 'old'};
    const older = {...old, version: '0.3.2', hash: '01'};
    const stale = {releases: [old, older], id: META.id, tags: ['old'], name: 'Paceline', description: 'Old text.',
                   logoURL: 'https://example.invalid/old-logo.png', homeURL: 'https://example.invalid/old',
                   created: 1, authorName: 'Old Name'};
    const listed = [OTHER[0], stale, OTHER[1]];
    const before = structuredClone(listed);
    const rel = {...old, version: '0.3.4', hash: HASH, updated: NOW};
    const {directory, changed} = withRelease(listed, META, rel);
    assert.equal(changed, true);
    assert.deepEqual(listed, before, 'the input is not changed');
    assert.equal(directory.length, 3);
    assert.deepEqual([directory[0], directory[2]], OTHER, 'the other mods stay as they are, in their order');
    assert.deepEqual(directory[1], {
        releases: [rel], id: META.id, tags: META.tags, name: 'Paceline', description: META.description,
        logoURL: META.logoURL, homeURL: META.homeURL, created: 1, authorName: 'Matthew Butcher',
    });
    assert.deepEqual(Object.keys(directory[1]), Object.keys(stale), 'the key order stays');
    assert.equal('authorURL' in directory[1], false);
    assert.equal('authorAvatarURL' in directory[1], false);
    assert.equal('minVersion' in directory[1], false);

    const again = withRelease(directory, META, {...rel, updated: NOW + 1});
    assert.equal(again.changed, false);
    assert.deepEqual(again.directory, directory);
    assert.equal(again.directory[1].releases.length, 1);
});

test('compareVersions: numeric per part', () => {
    assert.ok(compareVersions('0.3.10', '0.3.9') > 0);
    assert.ok(compareVersions('1.0.0', '0.9.9') > 0);
    assert.ok(compareVersions('0.3.4', '0.4.0') < 0);
    assert.equal(compareVersions('0.3.4', '0.3.4'), 0);
});

test('standing: same, newer, older or missing; our name under another id is refused', () => {
    const entry = versions => ({id: META.id, name: 'Paceline', releases: versions.map(version => ({version}))});
    assert.equal(standing(OTHER, META, '0.3.4'), null);
    assert.equal(standing([...OTHER, entry(['0.3.3'])], META, '0.3.4'), null);
    assert.deepEqual(standing([entry(['0.3.4'])], META, '0.3.4'), {same: true});
    assert.deepEqual(standing([entry(['0.3.3', '0.3.10'])], META, '0.3.4'), {newer: '0.3.10'});
    assert.throws(() => standing([...OTHER, {id: 'another-id', name: 'paceline', releases: []}], META, '0.3.4'),
        /named Paceline under another id/);
});

test('compareUrl: the pull-request link from the fork branch', () => {
    assert.equal(compareUrl('mafl2k/sauce4zwift-mod-store', 'paceline-0.3.4'), LINK);
});

// ---- run

test('run: the happy path uploads, branches the fork, writes directory.json and logs the link', async () => {
    const {code, calls, keys, text} = await go();
    assert.equal(code, 0);
    assert.deepEqual(keys, [UPSTREAM_GET, REPO_GET, REF_GET, UPLOAD, MERGE, MAIN_GET, REF_POST, BRANCH_GET, FILE_PUT]);

    const up = calls[3];
    assert.deepEqual(up.body, ZIP);
    assert.equal(up.headers['content-type'], 'application/octet-stream');
    assert.equal(Object.keys(up.headers).some(h => h.toLowerCase() === 'authorization'), false, 'no token to mod-api');

    for (const c of calls.filter(c => c.url.startsWith(API))) {
        assert.equal(c.headers.Authorization, `Bearer ${TOKEN}`, c.key);
    }
    assert.deepEqual(JSON.parse(calls[4].body), {branch: 'main'});
    assert.deepEqual(JSON.parse(calls[6].body), {ref: 'refs/heads/paceline-0.3.4', sha: 'c'.repeat(40)});

    const put = JSON.parse(calls[8].body);
    assert.equal(put.branch, 'paceline-0.3.4');
    assert.equal(put.sha, 'blob1');
    assert.equal(put.message, 'Add Paceline 0.3.4');
    const written = unb64(put.content);
    const expected = [...OTHER, {
        releases: [expectedRelease], id: META.id, tags: META.tags, name: 'Paceline', description: META.description,
        logoURL: META.logoURL, homeURL: META.homeURL, created: NOW, authorName: 'Matthew Butcher',
    }];
    assert.equal(written, format(expected), '4-space indent, final newline, other mods untouched');
    assert.ok(text.includes(LINK));
    assert.equal(text.includes(TOKEN), false);
});

test('run: a listed mod gets an update commit', async () => {
    const old = {url: 'u', version: '0.3.3', updated: 1, hash: '00', minVersion: '2.3.0', size: 5, notes: 'old'};
    const listed = [...OTHER, {releases: [old], id: META.id, name: 'Paceline', created: 1}];
    const {code, calls} = await go({routes: happyRoutes({
        [UPSTREAM_GET]: reply(200, {content: b64(format(listed)), encoding: 'base64', sha: 'up1'}),
        [BRANCH_GET]: reply(200, {content: b64(format(listed)), encoding: 'base64', sha: 'blob1'}),
    })});
    assert.equal(code, 0);
    const put = JSON.parse(calls.at(-1).body);
    assert.equal(put.message, 'Update Paceline to 0.3.4');
    const mine = JSON.parse(unb64(put.content))[2];
    assert.deepEqual(mine.releases, [expectedRelease], 'one release: the new one');
    assert.equal(mine.description, META.description);
    assert.equal(mine.created, 1);
});

test('run (Review Focus 3): the version is already in the store: no upload, no write, says so', async () => {
    const listed = [...OTHER, {releases: [{...expectedRelease}], id: META.id, name: 'Paceline', created: 1}];
    const {code, keys, text} = await go({routes: happyRoutes({
        [UPSTREAM_GET]: reply(200, {content: b64(format(listed)), encoding: 'base64', sha: 'up1'}),
    })});
    assert.equal(code, 0);
    assert.deepEqual(keys, [UPSTREAM_GET]);
    assert.match(text, /Paceline 0\.3\.4 is in the store already, nothing to do/);
});

test('run (Review Focus 3): the fork branch has the version already: only the link', async () => {
    const mine = [...OTHER, {releases: [expectedRelease], id: META.id, name: 'Paceline', created: NOW}];
    const {code, keys, text} = await go({routes: happyRoutes({
        [REF_GET]: reply(200, {ref: 'refs/heads/paceline-0.3.4', object: {sha: 'd'.repeat(40)}}),
        [BRANCH_GET]: reply(200, {content: b64(format(mine)), encoding: 'base64', sha: 'blob9'}),
    })});
    assert.equal(code, 0);
    assert.deepEqual(keys, [UPSTREAM_GET, REPO_GET, REF_GET, BRANCH_GET]);
    assert.match(text, /branch paceline-0\.3\.4 of mafl2k\/sauce4zwift-mod-store has 0\.3\.4 already/);
    assert.ok(text.includes(LINK));
});

test('run: the fork branch exists without the version (an earlier run stopped): writes it there', async () => {
    const {code, keys, calls} = await go({routes: happyRoutes({
        [REF_GET]: reply(200, {ref: 'refs/heads/paceline-0.3.4', object: {sha: 'd'.repeat(40)}}),
    })});
    assert.equal(code, 0);
    assert.deepEqual(keys, [UPSTREAM_GET, REPO_GET, REF_GET, BRANCH_GET, UPLOAD, FILE_PUT]);
    assert.equal(JSON.parse(calls.at(-1).body).sha, 'blob1');
});

const listedWith = version => [...OTHER, {releases: [{...expectedRelease, version}], id: META.id, name: 'Paceline',
                                          created: 1}];
const dirReply = (dir, sha) => reply(200, {content: b64(format(dir)), encoding: 'base64', sha});

test('run: a newer release in the store (an old job retried): no upload, no write, exit 0', async () => {
    const {code, keys, text} = await go({routes: happyRoutes({[UPSTREAM_GET]: dirReply(listedWith('0.3.10'), 'up1')})});
    assert.equal(code, 0);
    assert.deepEqual(keys, [UPSTREAM_GET]);
    assert.match(text, /The store has 0\.3\.10 already, newer than 0\.3\.4: nothing to do/);
});

test('run: a newer release on the fork branch: no upload, no write, exit 0', async () => {
    const {code, keys, text} = await go({routes: happyRoutes({
        [UPSTREAM_GET]: dirReply(listedWith('0.3.3'), 'up1'),
        [REF_GET]: reply(200, {ref: 'refs/heads/paceline-0.3.4', object: {sha: 'd'.repeat(40)}}),
        [BRANCH_GET]: dirReply(listedWith('0.3.10'), 'blob1'),
    })});
    assert.equal(code, 0);
    assert.deepEqual(keys, [UPSTREAM_GET, REPO_GET, REF_GET, BRANCH_GET]);
    assert.match(text, /The branch paceline-0\.3\.4 of mafl2k\/sauce4zwift-mod-store has 0\.3\.10 already, newer than 0\.3\.4/);
});

test('run: a newer release arriving with the fork sync is not replaced', async () => {
    const {code, keys} = await go({routes: happyRoutes({[BRANCH_GET]: dirReply(listedWith('0.3.5'), 'blob1')})});
    assert.equal(code, 0);
    assert.deepEqual(keys, [UPSTREAM_GET, REPO_GET, REF_GET, UPLOAD, MERGE, MAIN_GET, REF_POST, BRANCH_GET]);
});

test('run: a Paceline in the store under another id is refused, not listed twice', async () => {
    const foreign = [...OTHER, {releases: [], id: 'abcdef00-0000-4000-8000-000000000000', name: 'Paceline', created: 1}];
    const {code, keys, text} = await go({routes: happyRoutes({[UPSTREAM_GET]: dirReply(foreign, 'up1')})});
    assert.equal(code, 1);
    assert.deepEqual(keys, [UPSTREAM_GET]);
    assert.match(text, /a mod named Paceline under another id/);
});

test('run: an error body is scrubbed before it is cut, a token across the cut never shows', async () => {
    for (const at of [280, 290, 295, 299]) {
        const {code, text} = await go({routes: happyRoutes({[MERGE]: reply(409, 'x'.repeat(at) + TOKEN + ' tail')})});
        assert.equal(code, 1);
        assert.equal(text.includes(TOKEN.slice(0, 8)), false, String(at));
    }
});

test('run (Review Focus 4): an upload hash that differs stops before any GitHub write', async () => {
    const {code, keys, text} = await go({routes: happyRoutes({
        [UPLOAD]: reply(200, {hash: 'f'.repeat(64), url: ASSET_URL}),
    })});
    assert.equal(code, 1);
    assert.deepEqual(keys, [UPSTREAM_GET, REPO_GET, REF_GET, UPLOAD]);
    assert.deepEqual(githubWrites(keys), []);
    assert.match(text, /hash .* differs from the zip's/);
});

test('run (Review Focus 4): mod-api answering 500 stops before any GitHub write', async () => {
    const {code, keys, text} = await go({routes: happyRoutes({
        [UPLOAD]: reply(500, `internal error near ${TOKEN}`),
    })});
    assert.equal(code, 1);
    assert.deepEqual(keys, [UPSTREAM_GET, REPO_GET, REF_GET, UPLOAD]);
    assert.match(text, /HTTP 500/);
    assert.equal(text.includes(TOKEN), false);
});

test('run: a missing fork (404) stops before the branch lookup and the upload, naming the fork', async () => {
    const {code, keys, text} = await go({routes: happyRoutes({[REPO_GET]: reply(404, {message: 'Not Found'})})});
    assert.equal(code, 1);
    assert.deepEqual(keys, [UPSTREAM_GET, REPO_GET], 'the fork is looked up before the branch, never uploaded to');
    assert.match(text, new RegExp(`the fork ${FORK} does not exist \\(or STORE_TOKEN can't see it\\)`));
    assert.equal(text.includes(TOKEN), false);
});

test('run: another answer for the fork (500) stops before the upload too', async () => {
    const {code, keys, text} = await go({routes: happyRoutes({[REPO_GET]: reply(500, 'boom')})});
    assert.equal(code, 1);
    assert.deepEqual(keys, [UPSTREAM_GET, REPO_GET]);
    assert.match(text, /Looking up the fork .*HTTP 500/);
});

test('run: a failed fork sync (merge-upstream) stops before the branch is made', async () => {
    const {code, keys} = await go({routes: happyRoutes({[MERGE]: reply(409, {message: 'conflict'})})});
    assert.equal(code, 1);
    assert.deepEqual(keys, [UPSTREAM_GET, REPO_GET, REF_GET, UPLOAD, MERGE]);
});

test('run (Review Focus 5): notes that hit PUBLIC_DENY_REGEX stop before any request, quietly', async () => {
    const changes = CHANGES.replace('- Big numbers.', '- Big numbers for team Zorblax.');
    const {code, calls, text} = await go({read: files({changes})});
    assert.equal(code, 1);
    assert.equal(calls.length, 0);
    assert.match(text, /the store text names something that must stay private/);
    for (const secret of [DENY, 'Zorblax', 'zorblax', 'Quuxley', 'Big numbers']) {
        assert.equal(text.toLowerCase().includes(secret.toLowerCase()), false, secret);
    }
});

test('run: the whole entry is checked, the store metadata too', async () => {
    const meta = JSON.stringify({...META, description: META.description + ' Made by quuxley.'});
    const {code, calls, text} = await go({read: files({meta})});
    assert.equal(code, 1);
    assert.equal(calls.length, 0);
    assert.equal(text.toLowerCase().includes('quuxley'), false);
});

test('run: the checker gets the text and the regex, and an error in it refuses without the regex', async () => {
    const seen = [];
    const ok = await go({leak: (t, re) => { seen.push([t, re]); return false; }});
    assert.equal(ok.code, 0);
    assert.equal(seen.length, 1);
    assert.equal(seen[0][1], DENY);
    for (const part of [NOTES, META.description, META.logoURL, META.authorName, '0.3.4', 'ttt']) {
        assert.ok(seen[0][0].includes(part), part);
    }
    const bad = await go({leak: () => { throw new Error(`grep: bad regex ${DENY}`); }});
    assert.equal(bad.code, 1);
    assert.equal(bad.calls.length, 0);
    assert.equal(bad.text.includes(DENY), false);
    assert.match(bad.text, /could not check the store text/);
});

test('run: PUBLIC_DENY_REGEX not set: refused, the store text is public', async () => {
    const {code, calls, text} = await go({e: env({PUBLIC_DENY_REGEX: ''})});
    assert.equal(code, 1);
    assert.equal(calls.length, 0);
    assert.match(text, /PUBLIC_DENY_REGEX is not set/);
});

test('run: a beta version is refused', async () => {
    const {code, calls, text} = await go({read: files({version: '0.3.4-beta.5'})});
    assert.equal(code, 1);
    assert.equal(calls.length, 0);
    assert.match(text, /the store takes final versions only/);
});

test('run: no notes for the version: "Paceline <version>"', async () => {
    const {code, calls} = await go({read: files({changes: '# Changes\n\n## Unreleased\n'})});
    assert.equal(code, 0);
    const written = JSON.parse(unb64(JSON.parse(calls.at(-1).body).content));
    assert.equal(written[2].releases[0].notes, 'Paceline 0.3.4');
});

test('run: a missing zip, STORE_FORK or STORE_TOKEN is refused before any request', async () => {
    const noZip = (path, enc) => {
        if (path.startsWith('dist/')) {
            throw Object.assign(new Error('ENOENT'), {code: 'ENOENT'});
        }
        return files()(path, enc);
    };
    for (const [opts, re] of [
        [{read: noZip}, /dist\/paceline-0\.3\.4\.zip/],
        [{e: env({STORE_FORK: ''})}, /STORE_FORK/],
        [{e: env({STORE_FORK: 'not a repo'})}, /STORE_FORK/],
        [{e: env({STORE_TOKEN: ''})}, /STORE_TOKEN/],
    ]) {
        const {code, calls, text} = await go(opts);
        assert.equal(code, 1, String(re));
        assert.equal(calls.length, 0, String(re));
        assert.match(text, re);
    }
});

test('run: the token never shows in the log, also when GitHub echoes it', async () => {
    const echo = reply(422, {message: `Bad credentials for ${TOKEN}`});
    for (const over of [{}, {[UPSTREAM_GET]: echo}, {[REPO_GET]: echo}, {[REF_GET]: echo}, {[MERGE]: echo}, {[REF_POST]: echo},
                        {[FILE_PUT]: echo}, {[UPLOAD]: async () => { throw new Error(`socket ${TOKEN}`); }}]) {
        const {text} = await go({routes: happyRoutes(over)});
        assert.equal(text.includes(TOKEN), false, Object.keys(over).join());
    }
});

test('run: DRY_RUN=1 logs the entry and the link, reads only, needs no token', async () => {
    const {code, calls, keys, text} = await go({e: env({DRY_RUN: '1', STORE_TOKEN: ''})});
    assert.equal(code, 0);
    assert.deepEqual(keys, [UPSTREAM_GET, REPO_GET, REF_GET]);
    assert.deepEqual(writes(keys), []);
    for (const c of calls) {
        assert.equal('Authorization' in c.headers, false, 'no token, no header');
    }
    assert.ok(text.includes(LINK));
    assert.ok(text.includes('"version": "0.3.4"'));
    assert.ok(text.includes(`"hash": "${HASH}"`));
    assert.ok(text.includes('"minVersion": "2.3.0"'));
    assert.ok(text.includes('"authorName": "Matthew Butcher"'), 'a first listing shows the new mod entry');
});

test('run: DRY_RUN=1 with a token sends it on the reads only, never prints it', async () => {
    const {code, keys, text} = await go({e: env({DRY_RUN: '1'})});
    assert.equal(code, 0);
    assert.deepEqual(writes(keys), []);
    assert.equal(text.includes(TOKEN), false);
});

// ---- the default checker: grep -E -i, the regex only in the child's environment

const grepOk = spawnSync('grep', ['-V'], {encoding: 'utf8'}).stdout?.includes('GNU');
test('grepDenied: grep -E -i on the text, the regex never in the error', {skip: !grepOk && 'needs GNU grep'}, () => {
    assert.equal(grepDenied('Big numbers for team ZORBLAX.', DENY), true);
    assert.equal(grepDenied('Big numbers for team Zorblaxer.', DENY), false, 'word boundaries as grep -E knows them');
    assert.equal(grepDenied('line one\nline two', DENY), false);
    assert.equal(grepDenied('two\nlines: quuxley', DENY), true);
    assert.equal(grepDenied('a [[:digit:]] class: 7', '[[:digit:]]'), true, 'POSIX classes work (grep flavour)');
    assert.throws(() => grepDenied('x', '(Zorblax'), e => !e.message.includes('Zorblax'));
    assert.throws(() => grepDenied('x', ''), /not set/);
});
