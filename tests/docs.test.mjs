import {VERSION} from '../pages/src/version.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SHEETS} from '../scripts/sheets.mjs';

const IMAGES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'images');
const tiles = () => Object.entries(SHEETS).flatMap(([name, s]) => s.rows.flat().map(t => ({name, ...t})));

test('every sheet source exists', () => {
    for (const t of tiles()) {
        assert.ok(fs.existsSync(path.join(IMAGES, t.src)), `${t.name}: ${t.src} missing`);
    }
});

test('sheet captions have one or two lines', () => {
    for (const t of tiles()) {
        assert.ok(t.caption.length >= 1 && t.caption.length <= 2, `${t.name}/${t.src}: ${t.caption.length} lines`);
        for (const line of t.caption) {
            assert.ok(line.length <= 60, `${t.name}/${t.src}: line too long: ${line}`);
        }
    }
});

test('the sheets are the six of the spec', () => {
    assert.deepEqual(Object.keys(SHEETS), ['defaults', 'before', 'gaps', 'info', 'signals', 'captain']);
});

const ROOT = path.join(IMAGES, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
// GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens.
const slug = h => h.trim().toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/ /g, '-');
const anchors = f => new Set(read(f).split('\n').filter(l => /^#{1,6} /.test(l)).map(l => slug(l.replace(/^#+ /, ''))));

test('relative links and images resolve', () => {
    for (const file of ['README.md', 'docs/guide.md', 'docs/development.md']) {
        const text = read(file);
        const refs = [...text.matchAll(/\]\(([^)\s]+)\)/g), ...text.matchAll(/src="([^"]+)"/g)].map(m => m[1]);
        for (const ref of refs) {
            if (/^(https?:|mailto:)/.test(ref)) { continue; }
            const [p, anchor] = ref.split('#');
            const target = p ? path.posix.normalize(path.posix.join(path.posix.dirname(file), p)) : file;
            assert.ok(fs.existsSync(path.join(ROOT, target)), `${file}: ${ref} does not exist`);
            if (anchor && target.endsWith('.md')) {
                assert.ok(anchors(target).has(anchor), `${file}: ${ref}: no heading #${anchor} in ${target}`);
            }
        }
    }
});

test('cross references resolve', () => {
    const flat = s => s.replace(/\s+/g, ' '); // a reference may wrap onto the next line
    const all = flat(read('README.md') + '\n' + read('docs/guide.md'));
    for (const file of ['README.md', 'docs/guide.md']) {
        for (const [, x] of flat(read(file)).matchAll(/\bsee "([^"]+)"/gi)) {
            const total = all.split(x).length - 1;
            const refs = all.split(`ee "${x}"`).length - 1;
            assert.ok(total >= 2 && total > refs, `${file}: see "${x}" has no target`);
        }
    }
});

test('no version history', () => {
    for (const file of ['README.md', 'docs/guide.md']) {
        const m = read(file).match(/new in [0-9]|before 0\.[0-9]|since 0\.[0-9]/i);
        assert.equal(m, null, `${file}: ${m?.[0]}`);
    }
});

test('guide has the captain facts', () => {
    const guide = read('docs/guide.md');
    for (const s of ['Lost link', '24 hours', 'Plan on ZwiftGopher', 'Upload a file', 'Make live', '30 minutes']) {
        assert.ok(guide.includes(s), `docs/guide.md lacks ${s}`);
    }
});

test('README stays short', () => {
    const lines = read('README.md').replace(/\n$/, '').split('\n').length;
    assert.ok(lines <= 200, `README.md has ${lines} lines`);
});

test('README title', () => {
    const title = read('README.md').split('\n').find(l => /^# /.test(l));
    assert.equal(title, `# Paceline ${VERSION}`);
});

test('every docs image is used', () => {
    const text = ['README.md', 'docs/guide.md', 'server/README.md'].map(read).join('\n');
    const srcs = new Set(Object.values(SHEETS).flatMap(s => s.rows.flat().map(t => t.src)));
    const unused = fs.readdirSync(IMAGES).filter(f => f.endsWith('.png') && f !== 'banner.png' &&
        f !== 'logo.png' && !srcs.has(f) && !text.includes(`images/${f}`));
    assert.deepEqual(unused, [], 'docs/images: not used anywhere');
});
