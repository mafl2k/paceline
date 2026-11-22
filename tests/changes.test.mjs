// Run with: node --test tests/changes.test.mjs
// scripts/changes.mjs: reading CHANGES.md (the unreleased lines, a version's notes), versioning
// the Unreleased section, and the notes text of a release.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import * as C from '../scripts/changes.mjs';

const DOC = '# Changes\n\n## Unreleased\n\n### Mod\n- Windows invisible outside a TTT\n\n### Server\n- Team page\n\n## 0.3.3 (2026-11-19)\n\n### Mod\n- Older\n';

test('unreleased reads both parts', () => {
    assert.deepEqual(C.unreleased(DOC), {mod: ['Windows invisible outside a TTT'], server: ['Team page']});
    assert.deepEqual(C.unreleased('# Changes\n'), {mod: [], server: []});
});

test('release renames Unreleased and starts a new empty one', () => {
    const out = C.release(DOC, {version: '0.3.4', date: '2026-11-23'});
    assert.match(out, /## Unreleased\n\n### Mod\n\n### Server\n\n## 0\.3\.4 \(2026-11-23\)\n\n### Mod\n- Windows invisible/);
    assert.deepEqual(C.notesFor(out, '0.3.4'), {mod: ['Windows invisible outside a TTT'], server: ['Team page']});
    assert.deepEqual(C.unreleased(out), {mod: [], server: []});
    assert.equal(C.release('# Changes\n', {version: '1.0.0', date: '2026-01-01'}), '# Changes\n');
});

test('notesText and denied', () => {
    assert.equal(C.notesText({mod: ['a', 'b'], server: []}), 'Mod:\n- a\n- b');
    assert.equal(C.notesText({mod: ['a'], server: ['c']}), 'Mod:\n- a\n\nServer:\n- c');
    assert.equal(C.denied('Ride with Ada Example', '\\b(ada example)\\b'), true);
    assert.equal(C.denied('Ride', ''), false);
});

// Pins that the tests above cannot: the older sections stay readable, versions match exactly, and
// a missing section is null, not an empty list.
test('notesFor finds the exact version only', () => {
    assert.deepEqual(C.notesFor(DOC, '0.3.3'), {mod: ['Older'], server: []});
    assert.equal(C.notesFor(DOC, '0.3.4'), null);
    assert.equal(C.notesFor(DOC, '0.3'), null);
    assert.equal(C.notesFor(DOC, '0.3.33'), null);
    assert.equal(C.notesFor(DOC, '0.3.3-beta.1'), null);
    assert.equal(C.notesFor(DOC, 'Unreleased'), null);
    // The dots are literal: 0x3y3 is no 0.3.3.
    assert.equal(C.notesFor('## 0x3y3 (2026-01-01)\n### Mod\n- x\n', '0.3.3'), null);
});

test('release keeps the older sections and leaves them alone', () => {
    const out = C.release(DOC, {version: '0.3.4', date: '2026-11-23'});
    assert.deepEqual(C.notesFor(out, '0.3.3'), {mod: ['Older'], server: []});
    assert.ok(out.startsWith('# Changes\n\n## Unreleased\n'));
    assert.equal(out.match(/^## Unreleased$/gm).length, 1);
    // Releasing twice does not touch the first release.
    const twice = C.release(C.release(DOC, {version: '0.3.4', date: '2026-11-23'}), {version: '0.3.5', date: '2026-11-24'});
    assert.deepEqual(C.notesFor(twice, '0.3.4'), {mod: ['Windows invisible outside a TTT'], server: ['Team page']});
    assert.deepEqual(C.notesFor(twice, '0.3.5'), {mod: [], server: []});
});

test('bullets: only "- " lines count, an indented line continues the bullet, text is trimmed', () => {
    const doc = '## Unreleased\n\n### Mod\n- one\n  continued\n-  two  \nprose, not a bullet\n\n### Server\n- three\n';
    assert.deepEqual(C.unreleased(doc), {mod: ['one continued', 'two'], server: ['three']});
    // A bullet before any ### heading belongs to neither part.
    assert.deepEqual(C.unreleased('## Unreleased\n- loose\n### Mod\n- m\n'), {mod: ['m'], server: []});
    // An unknown ### heading (even one named like an Object property) collects nothing.
    assert.deepEqual(C.unreleased('## Unreleased\n### constructor\n- x\n### Mod\n- m\n'), {mod: ['m'], server: []});
    // CRLF files read the same.
    assert.deepEqual(C.unreleased('## Unreleased\r\n\r\n### Mod\r\n- m\r\n'), {mod: ['m'], server: []});
});

test('notesText of nothing is empty', () => {
    assert.equal(C.notesText({mod: [], server: []}), '');
    assert.equal(C.notesText({mod: [], server: ['c']}), 'Server:\n- c');
});

test('denied: case-insensitive, no hit, and a bad regex is not swallowed', () => {
    assert.equal(C.denied('Ride with ADA EXAMPLE', 'ada example'), true);
    assert.equal(C.denied('Ride with Kim', 'ada example'), false);
    assert.equal(C.denied('Ride', undefined), false);
    // Fail closed, and the private source never shows in the error (message, cause or stack).
    let err = null;
    try {
        C.denied('Ride', '(secretname');
    } catch (e) {
        err = e;
    }
    assert.ok(err, 'a bad regex must throw');
    assert.doesNotMatch(String(err.message) + String(err.stack), /secretname/);
    assert.equal(err.cause, undefined);
});

// The CLI, run in a copy of the layout: <dir>/scripts/changes.mjs reads <dir>/CHANGES.md.
function cli(changes, ...args) {
    const dir = mkdtempSync(path.join(tmpdir(), 'pl-changes-'));
    try {
        mkdirSync(path.join(dir, 'scripts'));
        copyFileSync(new URL('../scripts/changes.mjs', import.meta.url), path.join(dir, 'scripts', 'changes.mjs'));
        if (changes !== null) {
            writeFileSync(path.join(dir, 'CHANGES.md'), changes);
        }
        const r = spawnSync('node', ['scripts/changes.mjs', ...args], {cwd: dir, encoding: 'utf8'});
        return {status: r.status, out: r.stdout, err: r.stderr};
    } finally { rmSync(dir, {recursive: true}); }
}

test('CLI: notes <version> prints the notes text, or nothing', () => {
    const doc = C.release(DOC, {version: '0.3.4', date: '2026-11-23'});
    assert.deepEqual(cli(doc, 'notes', '0.3.4'), {status: 0, out: 'Mod:\n- Windows invisible outside a TTT\n\nServer:\n- Team page\n', err: ''});
    assert.deepEqual(cli(doc, 'notes', '0.3.9'), {status: 0, out: '', err: ''});
    assert.deepEqual(cli(doc, 'notes', 'Unreleased'), {status: 0, out: '', err: ''});
    assert.deepEqual(cli(null, 'notes', '0.3.4'), {status: 0, out: '', err: ''});
    const bad = cli(doc, 'frob');
    assert.equal(bad.status, 2);
    assert.match(bad.err, /usage/);
    assert.equal(cli(doc, 'notes').status, 2);
});

test('CLI: started by an absolute path through a symlink it still prints the notes', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pl-changes-'));
    try {
        mkdirSync(path.join(dir, 'real', 'scripts'), {recursive: true});
        mkdirSync(path.join(dir, 'links'));
        copyFileSync(new URL('../scripts/changes.mjs', import.meta.url), path.join(dir, 'real', 'scripts', 'changes.mjs'));
        writeFileSync(path.join(dir, 'real', 'CHANGES.md'), C.release(DOC, {version: '0.3.4', date: '2026-11-23'}));
        symlinkSync(path.join(dir, 'real', 'scripts', 'changes.mjs'), path.join(dir, 'links', 'c.mjs'));
        symlinkSync(path.join(dir, 'real', 'scripts'), path.join(dir, 'links', 'scripts'));
        for (const script of [path.join(dir, 'links', 'c.mjs'), path.join(dir, 'links', 'scripts', 'changes.mjs')]) {
            const r = spawnSync('node', [script, 'notes', '0.3.4'], {cwd: tmpdir(), encoding: 'utf8'});
            assert.equal(r.status, 0, r.stderr);
            assert.equal(r.stdout, 'Mod:\n- Windows invisible outside a TTT\n\nServer:\n- Team page\n');
        }
    } finally { rmSync(dir, {recursive: true}); }
});
