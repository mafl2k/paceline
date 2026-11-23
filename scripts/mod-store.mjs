// Lists a mod release in the Sauce mod store. Run on main after a mod release (CI job mod-store):
// uploads dist/paceline-<version>.zip to the store's asset API, puts the release into the store's
// directory.json on the branch paceline-<version> of the user's fork of
// SauceLLC/sauce4zwift-mod-store, and prints the link that opens the pull request. Sauce reviews and
// merges it; the job never opens the pull request itself.
//
// Steps (all requests are built below, so the tests can pin them):
//   1. upstream directory.json has this version or a newer one for our mod id: nothing to do (a
//      retried old job never replaces a newer release); a mod of our name under another id is
//      refused (that needs a person).
//   2. the fork branch exists and has this version: print the link only (an earlier run got that
//      far); a newer one there: nothing to do.
//   3. upload the zip (PUT https://mod-api.sauce.llc/edit/release/asset, no login, as Sauce's
//      release tool does); the answer's hash must be the zip's sha256, or nothing is written.
//   4. sync the fork's main with upstream (merge-upstream) and branch it, unless the branch exists.
//   5. write directory.json on the branch (4-space indent and a final newline, as upstream).
//   6. print the compare link.
// The release entry is {url, version, updated, hash, minVersion, size, notes}; the notes are the
// version's "### Mod" lines from CHANGES.md ("Paceline <version>" when it has none). Our entry holds
// that one release only (as Sauce's release tool does by default) and the metadata from
// store/paceline.json, refreshed at every release (its minVersion goes on the release).
//
// Before any request, the public text (the notes and the whole entry) is checked against
// PUBLIC_DENY_REGEX with grep -E -i (GNU grep, the public export's flavour). The regex is passed to
// grep in its environment only, and neither it nor what it matched is ever printed.
//
// Environment (node 22, global fetch, no npm packages):
//   STORE_FORK          owner/name of the fork (required)
//   STORE_TOKEN         GitHub token for the fork, "Contents: Read and write" (required unless
//                       DRY_RUN=1). Only sent in the Authorization header to api.github.com, never
//                       printed, never sent to the asset API.
//   PUBLIC_DENY_REGEX   names that must never go public (required: the store text is public)
//   DRY_RUN=1           read only (the token, when set, only on reads): print the entry and the
//                       link, upload and write nothing
import {readFileSync, realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {notesFor, denied} from './changes.mjs';

const API = 'https://api.github.com';
const UPSTREAM = 'SauceLLC/sauce4zwift-mod-store';
const ASSET_API = 'https://mod-api.sauce.llc/edit/release/asset';
const FILE = 'directory.json';

export function sha256Hex(buf) {
    return createHash('sha256').update(buf).digest('hex');
}

export function uploadRequest(zip) {
    return {url: ASSET_API, method: 'PUT', headers: {'content-type': 'application/octet-stream'}, body: zip};
}

// The key order is the one Sauce's release tool writes.
export function releaseEntry({version, hash, url, size, notes, now, minVersion}) {
    return {url, version, updated: now, hash, minVersion, size, notes};
}

// The fields store/paceline.json sets on our entry, at every release.
const META_FIELDS = ['tags', 'name', 'description', 'logoURL', 'homeURL', 'authorName'];

// The directory with our mod's entry (found by meta.id) holding `release` as its one release, as
// Sauce's release tool does by default ("Replace existing entry"): a listed entry keeps its id,
// created and any other field, gets the metadata from `meta` and its releases replaced; otherwise
// a new entry goes at the end. meta.minVersion belongs on the release, not on the entry. The input
// is not changed. changed: false when the entry has the version already.
export function withRelease(directory, meta, release) {
    const fields = Object.fromEntries(META_FIELDS.map(k => [k, meta[k]]));
    const at = directory.findIndex(m => m.id === meta.id);
    if (at >= 0) {
        const old = directory[at];
        if ((old.releases || []).some(r => r.version === release.version)) {
            return {directory, changed: false};
        }
        const out = directory.slice();
        out[at] = {...old, ...fields, id: old.id, created: old.created, releases: [release]};
        return {directory: out, changed: true};
    }
    const {tags, name, description, logoURL, homeURL, authorName} = fields;
    const entry = {releases: [release], id: meta.id, tags, name, description, logoURL, homeURL,
                   created: release.updated, authorName};
    return {directory: [...directory, entry], changed: true};
}

// Numeric order of X.Y.Z (anything after the third number is ignored): <0, 0 or >0.
export function compareVersions(a, b) {
    const parts = v => (/^(\d+)\.(\d+)\.(\d+)/.exec(String(v)) || [0, -1, -1, -1]).slice(1).map(Number);
    const [x, y] = [parts(a), parts(b)];
    for (let i = 0; i < 3; i++) {
        if (x[i] !== y[i]) {
            return x[i] - y[i];
        }
    }
    return 0;
}

// Where `version` stands against our entry (by meta.id) in a directory: null when the entry is
// missing or all its releases are older; {same: true} when one has this X.Y.Z; {newer: <version>}
// when one is above it (a retried old job must never replace a newer store release). Throws when
// the directory has a mod of our name under another id: that needs a person, not a second entry.
export function standing(directory, meta, version) {
    const mine = directory.find(m => m.id === meta.id);
    if (!mine) {
        const name = String(meta.name).toLowerCase();
        if (directory.some(m => String(m.name || '').toLowerCase() === name)) {
            throw new Stop(`the store has a mod named ${meta.name} under another id than store/paceline.json's: ` +
                           'nothing written, sort that out by hand');
        }
        return null;
    }
    const top = (mine.releases || []).map(r => r.version)
        .reduce((a, v) => a === null || compareVersions(v, a) > 0 ? v : a, null);
    if (top === null || compareVersions(top, version) < 0) {
        return null;
    }
    return compareVersions(top, version) === 0 ? {same: true} : {newer: top};
}

export function compareUrl(fork, branch) {
    const [owner, repo] = fork.split('/');
    return `https://github.com/${UPSTREAM}/compare/main...${owner}:${repo}:${branch}?expand=1`;
}

export function formatDirectory(directory) {
    return JSON.stringify(directory, null, 4) + '\n';
}

// GitHub requests.
export function contentsRequest(repo, ref) {
    return {url: `${API}/repos/${repo}/contents/${FILE}?ref=${encodeURIComponent(ref)}`, method: 'GET'};
}
export function repoRequest(fork) {
    return {url: `${API}/repos/${fork}`, method: 'GET'};
}
export function refRequest(fork, branch) {
    return {url: `${API}/repos/${fork}/git/ref/heads/${encodeURIComponent(branch)}`, method: 'GET'};
}
export function mergeUpstreamRequest(fork) {
    return {url: `${API}/repos/${fork}/merge-upstream`, method: 'POST', body: {branch: 'main'}};
}
export function createRefRequest(fork, branch, sha) {
    return {url: `${API}/repos/${fork}/git/refs`, method: 'POST', body: {ref: `refs/heads/${branch}`, sha}};
}
export function putContentsRequest(fork, branch, text, sha, message) {
    return {url: `${API}/repos/${fork}/contents/${FILE}`, method: 'PUT',
            body: {message, content: Buffer.from(text).toString('base64'), sha, branch}};
}

// grep -E -i -q on `text` (GNU grep: the public export's flavour, e.g. \b). The regex only goes into
// grep's environment. true on a match; throws on any other trouble, never naming the regex.
export function grepDenied(text, regexSource) {
    if (!regexSource) {
        throw new Error('PUBLIC_DENY_REGEX is not set');
    }
    const version = spawnSync('grep', ['-V'], {encoding: 'utf8'});
    if (version.status !== 0 || !String(version.stdout).includes('GNU')) {
        throw new Error('needs GNU grep (apk add grep)');
    }
    const r = spawnSync('sh', ['-c', 'exec grep -E -i -q -e "$PUBLIC_DENY_REGEX"'], {
        input: String(text),
        env: {PATH: process.env.PATH || '/usr/bin:/bin', LC_ALL: 'C.UTF-8', PUBLIC_DENY_REGEX: regexSource},
        stdio: ['pipe', 'ignore', 'ignore'],
    });
    if (r.status === 0) {
        return true;
    }
    if (r.status === 1) {
        return false;
    }
    throw new Error('grep could not check the text');
}

function isMain() {
    try {
        return Boolean(process.argv[1]) &&
            realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
    } catch {
        return false;
    }
}

// A refusal: its message is the one line for the log.
class Stop extends Error {}

export async function run({env = process.env, fetchFn = fetch, readFile = readFileSync, log = console.log,
                           now = Date.now, leakCheck = grepDenied} = {}) {
    const token = env.STORE_TOKEN || '';
    // Whatever a message says, the token must not be in it.
    const clean = text => token ? String(text).split(token).join('***') : String(text);
    const say = text => log(clean(text));
    try {
        return await steps({env, fetchFn, readFile, say, now, leakCheck, token, clean});
    } catch (e) {
        say(`mod-store: ${e?.message || e}`);
        return 1;
    }
}

async function steps({env, fetchFn, readFile, say, now, leakCheck, token, clean}) {
    const fork = env.STORE_FORK || '';
    if (!/^[\w.-]+\/[\w.-]+$/.test(fork)) {
        throw new Stop('STORE_FORK (owner/name) is not set or malformed');
    }
    const dry = env.DRY_RUN === '1';
    if (!dry && !token) {
        throw new Stop('STORE_TOKEN is not set');
    }
    if (!env.PUBLIC_DENY_REGEX) {
        throw new Stop('PUBLIC_DENY_REGEX is not set: nothing goes to the store unchecked (its text is public)');
    }
    const version = JSON.parse(readFile('manifest.json', 'utf8')).version;
    if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version || '')) {
        throw new Stop(`manifest.json has no usable version: ${version}`);
    }
    if (version.includes('-')) {
        throw new Stop(`${version}: the store takes final versions only`);
    }
    const meta = JSON.parse(readFile('store/paceline.json', 'utf8'));
    let changes = '';
    try {
        changes = readFile('CHANGES.md', 'utf8');
    } catch (e) {
        if (e.code !== 'ENOENT') {
            throw e;
        }
    }
    const mod = notesFor(changes, version)?.mod || [];
    const notes = mod.length ? mod.map(l => `- ${l}`).join('\n') : `Paceline ${version}`;
    const file = `paceline-${version}.zip`;
    let zip;
    try {
        zip = readFile(`dist/${file}`);
    } catch {
        throw new Stop(`dist/${file} is missing (it comes from the mod-zip job)`);
    }
    const hash = sha256Hex(zip);
    const updated = now();
    const draft = url => releaseEntry({version, hash, url, size: zip.length, notes, now: updated,
                                       minVersion: meta.minVersion});

    // The public text, before anything leaves: the notes and the whole entry of a first listing.
    const fullEntry = withRelease([], meta, draft('https://mod-api.sauce.llc/assets/')).directory[0];
    const publicText = `${notes}\n${JSON.stringify(fullEntry, null, 4)}`;
    let hit;
    try {
        hit = leakCheck(publicText, env.PUBLIC_DENY_REGEX) || denied(publicText, env.PUBLIC_DENY_REGEX);
    } catch {
        throw new Stop('could not check the store text against PUBLIC_DENY_REGEX (GNU grep, a regex that compiles)');
    }
    if (hit) {
        throw new Stop('the store text names something that must stay private: fix CHANGES.md or store/paceline.json');
    }

    const branch = `paceline-${version}`;
    const link = compareUrl(fork, branch);
    const call = async req => {
        const headers = req.url.startsWith(API) ? {
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'paceline-release',
            ...(token ? {Authorization: `Bearer ${token}`} : {}),
        } : {...req.headers};
        let body = req.body;
        if (body && !Buffer.isBuffer(body)) {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(body);
        }
        return await fetchFn(req.url, {method: req.method, headers, body});
    };
    const fail = async (what, resp) => {
        // Scrub first, then cut: a token across the cut would show in part.
        throw new Stop(`${what}: HTTP ${resp.status} ${clean(await resp.text()).slice(0, 300)}`);
    };
    const readDirectory = async (repo, ref) => {
        const resp = await call(contentsRequest(repo, ref));
        if (!resp.ok) {
            await fail(`Reading ${FILE} of ${repo} (${ref})`, resp);
        }
        const data = await resp.json();
        if (data.encoding !== 'base64' || typeof data.content !== 'string') {
            throw new Stop(`${FILE} of ${repo} (${ref}) came without its content`);
        }
        const directory = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
        if (!Array.isArray(directory)) {
            throw new Stop(`${FILE} of ${repo} (${ref}) is not a list of mods`);
        }
        return {directory, sha: data.sha};
    };
    const newer = (where, top) => `${where} has ${top} already, newer than ${version}: nothing to do.`;

    // 1. In the store already?
    const upstream = await readDirectory(UPSTREAM, 'main');
    const inStore = standing(upstream.directory, meta, version);
    if (inStore?.same) {
        say(`Paceline ${version} is in the store already, nothing to do.`);
        return 0;
    }
    if (inStore?.newer) {
        say(newer('The store', inStore.newer));
        return 0;
    }
    // 2. The fork must exist: a missing repository answers 404 to the branch lookup too, which
    // would read as "no branch yet" and end in an upload with nowhere to go.
    const repo = await call(repoRequest(fork));
    if (repo.status === 404) {
        throw new Stop(`the fork ${fork} does not exist (or STORE_TOKEN can't see it)`);
    }
    if (!repo.ok) {
        await fail(`Looking up the fork ${fork}`, repo);
    }
    // 3. On the fork branch already?
    const ref = await call(refRequest(fork, branch));
    let onBranch = null;    // the branch's directory.json, when the branch exists
    if (ref.ok) {
        onBranch = await readDirectory(fork, branch);
        const there = standing(onBranch.directory, meta, version);
        if (there?.same) {
            say(`The branch ${branch} of ${fork} has ${version} already. Open the pull request: ${link}`);
            return 0;
        }
        if (there?.newer) {
            say(newer(`The branch ${branch} of ${fork}`, there.newer));
            return 0;
        }
    } else if (ref.status !== 404) {
        await fail(`Looking up the branch ${branch} of ${fork}`, ref);
    }

    if (dry) {
        const shown = withRelease(upstream.directory, meta, draft('(the url the upload returns)'));
        const mine = shown.directory.find(m => m.id === meta.id);
        const listed = upstream.directory.some(m => m.id === meta.id);
        say(`Dry run: would upload dist/${file} (${zip.length} bytes, sha256 ${hash}), ` +
            `${onBranch ? 'write to the existing' : 'create the'} branch ${branch} of ${fork} and put this ` +
            `${listed ? 'updated' : 'new'} mod entry into ${FILE}:`);
        say(JSON.stringify(mine, null, 4));
        say(`Then open the pull request: ${link}`);
        return 0;
    }

    // 4. Upload; a hash that is not the zip's stops everything.
    const up = await call(uploadRequest(zip));
    if (!up.ok) {
        await fail(`Uploading dist/${file} to the store`, up);
    }
    const asset = await up.json();
    if (asset?.hash !== hash) {
        throw new Stop(`the store's hash ${String(asset?.hash).slice(0, 64)} differs from the zip's ${hash}: nothing written`);
    }
    if (typeof asset.url !== 'string' || !asset.url.startsWith('https://')) {
        throw new Stop('the store answered the upload without a url: nothing written');
    }
    say(`Uploaded dist/${file} (${zip.length} bytes): ${asset.url}`);

    // 5. The branch, off the fork's main synced with upstream.
    if (!onBranch) {
        const sync = await call(mergeUpstreamRequest(fork));
        if (!sync.ok) {
            await fail(`Syncing main of ${fork} with ${UPSTREAM}`, sync);
        }
        const main = await call(refRequest(fork, 'main'));
        if (!main.ok) {
            await fail(`Looking up main of ${fork}`, main);
        }
        const sha = (await main.json())?.object?.sha;
        if (!/^[0-9a-f]{40}$/.test(sha || '')) {
            throw new Stop(`main of ${fork} has no commit id`);
        }
        const made = await call(createRefRequest(fork, branch, sha));
        if (!made.ok) {
            await fail(`Creating the branch ${branch} of ${fork}`, made);
        }
        say(`Created the branch ${branch} of ${fork} on ${sha.slice(0, 8)}.`);
        onBranch = await readDirectory(fork, branch);
    }

    // 6. directory.json on the branch (the fork sync may have brought a newer release in meanwhile).
    const there = standing(onBranch.directory, meta, version);
    if (there?.newer) {
        say(newer(`The branch ${branch} of ${fork}`, there.newer));
        return 0;
    }
    const listed = onBranch.directory.some(m => m.id === meta.id);
    const next = withRelease(onBranch.directory, meta, draft(asset.url));
    if (next.changed) {
        const message = listed ? `Update Paceline to ${version}` : `Add Paceline ${version}`;
        const put = await call(putContentsRequest(fork, branch, formatDirectory(next.directory), onBranch.sha, message));
        if (!put.ok) {
            await fail(`Writing ${FILE} on ${branch} of ${fork}`, put);
        }
        say(`Wrote ${FILE} on ${branch} of ${fork}: ${message}.`);
    }
    // 7. The link.
    say(`Open the pull request: ${link}`);
    return 0;
}

if (isMain()) {
    process.exit(await run());
}
