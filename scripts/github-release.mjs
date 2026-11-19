// Publishes a GitHub release for the mod version in manifest.json, with dist/paceline-<version>.zip
// attached, so people who only see the public GitHub copy can download the mod. Run by
// scripts/export-public.sh after the snapshot is pushed (or found up to date); the tag v<version>
// is created on that snapshot commit.
//
// If the release v<version> exists with the zip, nothing happens. If it exists without the zip
// (an earlier run stopped after creating it), only the zip is uploaded.
//
// Environment (node 22, global fetch, no npm packages):
//   GITHUB_REPO         owner/name of the public repository (required)
//   GITHUB_TOKEN        token with write access to that repository's contents (required unless
//                       DRY_RUN=1). It is only sent in the Authorization header, never printed.
//   GITHUB_RELEASE_SHA  commit the tag points at (required unless DRY_RUN=1)
//   RELEASE_NOTES       text of the release (default: "Paceline <version>")
//   GITHUB_PRERELEASE=1 a beta from branch next: the version must have a suffix (0.3.0-beta.3), the
//                       release is a pre-release that never becomes "latest" (the README's
//                       .../releases/latest link stays on the stable release), and its text starts
//                       with "Paceline <version> (beta)". Without it the version must be plain (0.2.33).
//   DRY_RUN=1           look up the release (read-only, without the token if there is none), say
//                       what would be done, change nothing
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const API = 'https://api.github.com';

export function releaseFile(version) {
    return `paceline-${version}.zip`;
}

// The requests are built here (and only here), so the tests can pin them.
export function lookupRequest(repo, tag) {
    return {url: `${API}/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, method: 'GET'};
}

export function createRequest(repo, version, sha, notes, {prerelease = false} = {}) {
    const head = prerelease ? `Paceline ${version} (beta)` : '';
    const body = {
        tag_name: `v${version}`,
        target_commitish: sha,
        name: `Paceline ${version}`,
        body: prerelease ? (notes ? `${head}\n\n${notes}` : head) : notes || `Paceline ${version}`,
        draft: false,
        prerelease,
    };
    if (prerelease) {
        body.make_latest = 'false';    // a string in GitHub's API: 'true', 'false' or 'legacy'
    }
    return {url: `${API}/repos/${repo}/releases`, method: 'POST', body};
}

// `uploadUrl` is the release's upload_url, e.g. https://uploads.github.com/repos/o/r/releases/1/assets{?name,label}
export function uploadRequest(uploadUrl, version) {
    const base = String(uploadUrl).replace(/\{.*$/, '');
    return {url: `${base}?name=${encodeURIComponent(releaseFile(version))}`, method: 'POST', contentType: 'application/zip'};
}

export async function run({env = process.env, fetchFn = fetch, readFile = readFileSync, log = console.log} = {}) {
    const repo = env.GITHUB_REPO;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) {
        throw new Error('GITHUB_REPO (owner/name) is not set or malformed');
    }
    const dry = env.DRY_RUN === '1';
    const prerelease = env.GITHUB_PRERELEASE === '1';
    const token = env.GITHUB_TOKEN || '';
    const sha = env.GITHUB_RELEASE_SHA || '';
    if (!dry) {
        if (!token) {
            throw new Error('GITHUB_TOKEN is not set');
        }
        if (!/^[0-9a-f]{40}$/.test(sha)) {
            throw new Error('GITHUB_RELEASE_SHA is not set to a full commit id');
        }
    }
    const version = JSON.parse(readFile('manifest.json', 'utf8')).version;
    if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version || '')) {
        throw new Error(`manifest.json has no usable version: ${version}`);
    }
    // A beta never becomes a normal release, a plain version never a pre-release.
    if (prerelease !== version.includes('-')) {
        throw new Error(prerelease
            ? `GITHUB_PRERELEASE=1 needs a beta version with a suffix, got ${version}`
            : `${version} is a beta: set GITHUB_PRERELEASE=1 for a pre-release`);
    }
    const kind = prerelease ? 'pre-release' : 'release';
    const tag = `v${version}`;
    const file = releaseFile(version);

    // Whatever a message says, the token must not be in it.
    const clean = text => token ? String(text).split(token).join('***') : String(text);
    const call = async (req, {raw} = {}) => {
        const headers = {
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'paceline-release',
        };
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
        let payload;
        if (req.body) {
            headers['Content-Type'] = 'application/json';
            payload = JSON.stringify(req.body);
        } else if (raw) {
            headers['Content-Type'] = req.contentType;
            payload = raw;
        }
        return await fetchFn(req.url, {method: req.method, headers, body: payload});
    };
    const fail = async (what, resp) => {
        throw new Error(clean(`${what}: HTTP ${resp.status} ${(await resp.text()).slice(0, 500)}`));
    };

    const found = await call(lookupRequest(repo, tag));
    let rel = null;
    if (found.ok) {
        rel = await found.json();
    } else if (found.status !== 404) {
        await fail(`Looking up release ${tag}`, found);
    }
    if (rel && (rel.assets || []).some(a => a.name === file)) {
        log(`Release ${tag} exists already, nothing to do.`);
        return 'exists';
    }

    if (dry) {
        let size = 'missing: this would fail';
        try {
            size = `${readFile(`dist/${file}`).length} bytes`;
        } catch { /* reported above */ }
        log(rel
            ? `Dry run: release ${tag} exists without ${file}; would upload it (dist/${file}: ${size}).`
            : `Dry run: would create ${kind} ${tag} on ${sha || 'the new snapshot commit'} with ${file} (dist/${file}: ${size}).`);
        return 'dry-run';
    }

    // Read the zip first: no release without the file it is about.
    const zip = readFile(`dist/${file}`);
    let status = 'repaired';
    if (!rel) {
        const made = await call(createRequest(repo, version, sha, env.RELEASE_NOTES, {prerelease}));
        if (!made.ok) {
            await fail(`Creating release ${tag}`, made);
        }
        rel = await made.json();
        status = 'created';
        log(`Created ${kind} ${tag} on ${sha.slice(0, 8)}.`);
    }
    const up = await call(uploadRequest(rel.upload_url, version), {raw: zip});
    if (!up.ok) {
        await fail(`Uploading ${file} to release ${tag}`, up);
    }
    log(`Uploaded ${file} (${zip.length} bytes) to release ${tag}.`);
    return status;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        await run();
    } catch (e) {
        console.error(`github-release: ${e.message}`);
        process.exit(1);
    }
}
