#!/usr/bin/env node
// CI guard: the default branch ships plain release versions, `next` ships betas.
// Usage: node scripts/check-channel.mjs [branch]
import {readFileSync, realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export function channelProblem({branch, defaultBranch = 'main', version, channel}) {
    if (branch && branch === defaultBranch) {
        if (version.includes('-')) {
            return `${defaultBranch} needs a plain version without a suffix, got ${version}`;
        }
        if (channel !== 'release') {
            return `${defaultBranch} needs CHANNEL 'release', got '${channel}'`;
        }
    } else if (branch === 'next') {
        if (channel !== 'beta') {
            return `next needs CHANNEL 'beta', got '${channel}'`;
        }
    }
    return null;
}

async function main() {
    const branch = process.argv[2] ?? process.env.CI_COMMIT_BRANCH ?? '';
    const defaultBranch = process.env.CI_DEFAULT_BRANCH || 'main';
    const {VERSION, CHANNEL} = await import('../pages/src/version.mjs');
    const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
    let problem = channelProblem({branch, defaultBranch, version: VERSION, channel: CHANNEL});
    if (!problem && manifest.version !== VERSION) {
        problem = `manifest.json version ${manifest.version} differs from VERSION ${VERSION}`;
    }
    if (problem) {
        console.error(problem);
        process.exit(1);
    }
    console.log(`channel ok: ${branch || '(no branch)'} ${VERSION} ${CHANNEL}`);
}

// Run main() only when this file is the entry point. Both sides go through realpath: import.meta.url
// is the real path unless node runs with --preserve-symlinks-main, and argv[1] is never resolved.
// A path that does not exist (the module imported from `node -e`) is not the entry point.
function isEntryPoint() {
    try {
        return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
    } catch {
        return false;
    }
}

if (process.argv[1] && isEntryPoint()) {
    await main();
}
