// Run with: node --test tests/exportcheck.test.mjs
// The leak check of scripts/export-public.sh (bash scripts/export-public.sh --check <dir> ...).
// The script is not in the public copy (.public-exclude): there these tests are skipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const SCRIPT = new URL('../scripts/export-public.sh', import.meta.url).pathname;
const skip = !existsSync(SCRIPT) && 'scripts/export-public.sh is not in this copy';
const DENY = 'Zorro|Quixote';

function check(dir, texts = [], deny = DENY) {
    const env = {...process.env};
    delete env.PUBLIC_DENY_REGEX;
    if (deny !== null) {
        env.PUBLIC_DENY_REGEX = deny;
    }
    const r = spawnSync('bash', [SCRIPT, '--check', dir, ...texts], {env, encoding: 'utf8'});
    return {status: r.status, err: r.stderr, listed: r.stderr.split('\n').filter(l => l.startsWith('  ')).map(l => l.trim())};
}

function tree(files) {
    const dir = mkdtempSync(path.join(tmpdir(), 'pl-leak-'));
    for (const [name, data] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(dir, name)), {recursive: true});
        writeFileSync(path.join(dir, name), data);
    }
    return dir;
}

// A PNG made of chunks (CRCs left 0: the check does not verify them).
function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
}
function png(...chunks) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), ...chunks, chunk('IEND', Buffer.alloc(0))]);
}
const tEXt = (key, text) => chunk('tEXt', Buffer.from(`${key}\0${text}`, 'latin1'));
const zTXt = (key, text) => chunk('zTXt', Buffer.concat([Buffer.from(`${key}\0\0`, 'latin1'), zlib.deflateSync(text)]));
const iTXt = (key, text) => chunk('iTXt', Buffer.concat([Buffer.from(`${key}\0\x01\0en\0\0`, 'latin1'), zlib.deflateSync(Buffer.from(text, 'utf8'))]));
// Pixel data that happens to contain the bytes of a name: not text, never a hit.
const IDAT = chunk('IDAT', Buffer.from('\x00\x01zorro\x02', 'latin1'));

const CLEAN = {
    'README.md': 'Made-up riders: Arvid, Bodo, Kim.\n',
    'pages/a.mjs': 'export const x = 1;\n',
    'docs/images/shot.png': png(tEXt('Software', 'headless Chrome'), IDAT),
};

test('a clean tree and clean texts pass', {skip}, () => {
    const dir = tree(CLEAN);
    try {
        const r = check(dir, ['commit message', 'Synthetic fixture', 'release notes', 'Synthetic fixture']);
        assert.equal(r.status, 0, r.err);
        assert.equal(r.err, '');
    } finally { rmSync(dir, {recursive: true}); }
});

test('no deny regex: the check fails instead of skipping', {skip}, () => {
    const dir = tree(CLEAN);
    try {
        for (const deny of [null, '']) {
            const r = check(dir, [], deny);
            assert.equal(r.status, 2, String(deny));
            assert.match(r.err, /PUBLIC_DENY_REGEX is empty or not set/);
        }
    } finally { rmSync(dir, {recursive: true}); }
});

test('a deny regex that does not compile fails the check', {skip}, () => {
    const dir = tree(CLEAN);
    try {
        const r = check(dir, [], 'Zorro|(');
        assert.equal(r.status, 2);
        assert.match(r.err, /does not compile/);
    } finally { rmSync(dir, {recursive: true}); }
});

test('text contents, case-insensitively', {skip}, () => {
    const dir = tree({...CLEAN, 'tests/t.test.mjs': "test('ZORRO pulls', () => {});\n", 'notes.txt': 'quixote\n'});
    try {
        const r = check(dir);
        assert.equal(r.status, 1);
        assert.deepEqual(r.listed, ['notes.txt (text)', 'tests/t.test.mjs (text)']);
    } finally { rmSync(dir, {recursive: true}); }
});

test('paths: also of binary files and folders', {skip}, () => {
    const dir = tree({...CLEAN, 'docs/images/zorro-team.png': png(IDAT), 'fixtures/quixote/a.bin': Buffer.from([0, 1, 2, 0])});
    try {
        const r = check(dir);
        assert.equal(r.status, 1);
        assert.deepEqual(r.listed, ['docs/images/zorro-team.png (name)', 'fixtures/quixote/a.bin (name)']);
    } finally { rmSync(dir, {recursive: true}); }
});

test('PNGs: the text chunks (also compressed), not the pixel bytes', {skip}, () => {
    const dir = tree({
        ...CLEAN,
        'a.png': png(tEXt('Comment', 'shot of Zorro'), IDAT),
        'b.png': png(zTXt('Comment', 'by quixote'), IDAT),
        'c.png': png(iTXt('Description', 'Zorro’s window'), IDAT),
        'd.png': png(IDAT),
    });
    try {
        const r = check(dir);
        assert.equal(r.status, 1);
        assert.deepEqual(r.listed, ['a.png (png-text)', 'b.png (png-text)', 'c.png (png-text)']);
    } finally { rmSync(dir, {recursive: true}); }
});

test('other binary files: their raw bytes', {skip}, () => {
    const dir = tree({...CLEAN, 'font.woff2': Buffer.concat([Buffer.from([0, 0xff, 0]), Buffer.from('ZoRRo'), Buffer.from([0])])});
    try {
        const r = check(dir);
        assert.equal(r.status, 1);
        assert.deepEqual(r.listed, ['font.woff2 (binary)']);
    } finally { rmSync(dir, {recursive: true}); }
});

test('commit message and release notes: named by label, the text never printed', {skip}, () => {
    const dir = tree(CLEAN);
    try {
        const r = check(dir, ['commit message', 'fixture from zorro\n\nSnapshot of 0123abcd.', 'release notes', 'Quixote secret']);
        assert.equal(r.status, 1);
        assert.deepEqual(r.listed, ['commit message', 'release notes']);
        assert.doesNotMatch(r.err, /zorro|quixote|secret/i);
    } finally { rmSync(dir, {recursive: true}); }
});

// The whole export in a throwaway repository: it stops at the check, before any network access.
function exportRepo(subject, files) {
    const dir = mkdtempSync(path.join(tmpdir(), 'pl-export-'));
    const git = (...args) => {
        const r = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
                            {cwd: dir, encoding: 'utf8', env: {...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.org',
                                                               GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.org'}});
        assert.equal(r.status, 0, r.stderr);
    };
    mkdirSync(path.join(dir, 'scripts'));
    copyFileSync(SCRIPT, path.join(dir, 'scripts', 'export-public.sh'));
    writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({version: '1.0.0-beta.1'}));
    writeFileSync(path.join(dir, '.public-exclude'), '.public-exclude\nscripts/export-public.sh\ninternal/\n');
    for (const [name, data] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(dir, name)), {recursive: true});
        writeFileSync(path.join(dir, name), data);
    }
    git('init', '-q', '-b', 'next');
    git('add', '-A');
    git('commit', '-q', '-m', subject);
    return dir;
}
function runExport(dir, deny = DENY) {
    const env = {...process.env, GITHUB_REPO: 'o/r', PUBLIC_BRANCH: 'beta', DRY_RUN: '1'};
    delete env.GITHUB_TOKEN;
    delete env.PUBLIC_DENY_REGEX;
    if (deny !== null) {
        env.PUBLIC_DENY_REGEX = deny;
    }
    return spawnSync('bash', ['scripts/export-public.sh'], {cwd: dir, env, encoding: 'utf8'});
}

test('export: the commit subject is checked as commit message and release notes', {skip}, () => {
    const dir = exportRepo('Add the zorro fixture', {'README.md': 'clean\n'});
    try {
        const r = runExport(dir);
        assert.equal(r.status, 1, r.stderr);
        assert.match(r.stderr, /^ {2}commit message$/m);
        assert.match(r.stderr, /^ {2}release notes$/m);
        assert.doesNotMatch(r.stdout, /dry run/);
    } finally { rmSync(dir, {recursive: true}); }
});

test('export: stops without a deny regex; excluded files are not checked', {skip}, () => {
    const dir = exportRepo('Clean subject', {'README.md': 'clean\n', 'internal/notes.md': 'Zorro\n', 'pages/x.mjs': '// QUIXOTE\n'});
    try {
        const none = runExport(dir, null);
        assert.equal(none.status, 1);
        assert.match(none.stderr, /PUBLIC_DENY_REGEX is empty or not set/);
        const r = runExport(dir);
        assert.equal(r.status, 1, r.stderr);
        assert.deepEqual(r.stderr.split('\n').filter(l => l.startsWith('  ')), ['  pages/x.mjs (text)']);
    } finally { rmSync(dir, {recursive: true}); }
});
