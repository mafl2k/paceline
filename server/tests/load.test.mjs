import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {
    MAX_TEAMS, MAX_PLANS, MAX_RIDERS, MAX_LOG, MAX_SHEET_BYTES, MAX_CLUB_BYTES, RIDER_NAME_MAX, TYPE_MAX,
    TEAM_NAME_MAX, ClubError, addTeam, uploadSheet, addLog, clubBytes,
} from '../club.mjs';
import {openStore} from '../store.mjs';
import {openDb} from '../db.mjs';
import {MAX_CIRCLES_DEFAULT, readConfig} from '../config.mjs';
import {RAW_TEAM_NAME_MAX, RAW_SHORT_MAX} from '../../pages/src/engine/plan.mjs';
import {club as baseClub, T, clubJson} from './helpers.mjs';


// The club count is the config's MAX_CIRCLES default itself, so raising it re-runs this test at
// the new count. The stack has no memory limit (the 384M one went with paceline.db): RSS and heap
// are only reported, for the record.
const NOW = T('2026-11-19T12:00Z');

const STORE_URL = pathToFileURL(path.join(import.meta.dirname, '..', 'store.mjs')).href;
const DB_URL = pathToFileURL(path.join(import.meta.dirname, '..', 'db.mjs')).href;
const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';

function base32(n, len) {
    let s = '';
    for (let i = 0; i < len; i++) {
        s = CROCKFORD[n % 32] + s;
        n = Math.floor(n / 32);
    }
    return s;
}

// What a captain can send that costs the most memory per stored byte:
// - shapes stripSheet must drop (big arrays and objects in every field it reads);
// - names, labels and colour names at their limits, as two-byte strings (one character outside
//   Latin-1 makes V8 store every character in 2 bytes), padded with white space the visible
//   length checks don't count (displayName trims it), up to the raw limits stripSheet keeps:
//   names RAW_NAME_MAX, the export's team name RAW_TEAM_NAME_MAX, colours and the numeric
//   strings of weight, pull_power and pull_wkg RAW_SHORT_MAX.
const HOSTILE = Array.from({length: 3000}, () => ({}));
const wide = (s, len) => `${s} ✓ `.padEnd(len, 'x');
// a log entry's label: the team name, " · ", the type and " v<n>"
const LOG_LABEL_MAX = TEAM_NAME_MAX + 3 + TYPE_MAX + 4;

function upload(c, slug, {type, date, pad, as = 'new', newId}) {
    const riders = {};
    const text = [];
    const first = 1000000 + Object.keys(c.teams).indexOf(slug) * MAX_RIDERS;
    for (let r = 0; r < MAX_RIDERS; r++) {
        const name = wide(['Ben', 'Cleo', 'Dan', 'Eva', 'Finn', 'Gus', 'Hanna', 'Ida', 'Jo'][r % 9] + ` ${r}`, RIDER_NAME_MAX) +
            ' '.repeat(pad);
        riders[String(first + r)] = {name, order: r + 1, pull_duration: 30 + r, color: [{}, {}], ftp: HOSTILE,
            weight: '7'.repeat(RAW_SHORT_MAX), pull_power: '3'.repeat(RAW_SHORT_MAX), pull_wkg: '5'.repeat(RAW_SHORT_MAX)};
        text.push({name, pullWatts: 300 + r, pullS: 30 + r, colorName: wide('orange', RAW_SHORT_MAX),
            colorHex: '#FF8800'.padStart(RAW_SHORT_MAX)});
    }
    const json = {
        team: {name: wide('Kettenfett Rollers', RAW_TEAM_NAME_MAX)},
        target_speed: HOSTILE, minimum_finishers: {n: HOSTILE}, riders, roster: {},
    };
    return uploadSheet(c, {
        slug, json, text, type, date, as, live: true, base: c.teams[slug].version, pinnedEventId: null, via: 'file',
    }, {now: NOW, newId});
}

// A club at full caps, built with club.mjs as the server does: 10 teams × 8 plans × 40 riders, a
// re-upload per team (v2 of its first plan), types and team names at their limits, the full log and
// six tokens.
function fullClub(n, pad) {
    const c = baseClub({id: base32(1000003 + n * 7919, 10), name: `Kettenfett RC ${String(n).padStart(2, '0')}`,
        createdAt: new Date(NOW - (100 - n) * 60000).toISOString()});
    for (let k = 0; k < 6; k++) {
        c.tokens.push({hash: (n * 10 + k).toString(16).padStart(64, '0'), kind: 'link', state: 'pending', expiresAt: null});
    }
    let ids = 0;
    const newId = () => base32(ids++, 6);
    for (let t = 0; t < MAX_TEAMS; t++) {
        const slug = addTeam(c, {name: wide(`Rollers ${n} ${t}`, TEAM_NAME_MAX), start: '19:30'},
            {slugTaken: () => false, now: NOW});
        let firstId = null;
        for (let s = 0; s < MAX_PLANS; s++) {
            const type = wide(`${t} ${s}`, TYPE_MAX);
            const res = upload(c, slug, {type, date: `2026-11-${19 + s}`, pad, newId});
            assert.ok(Buffer.byteLength(JSON.stringify({json: c.sheets[res.id].json, text: c.sheets[res.id].text})) <= MAX_SHEET_BYTES);
            firstId ??= res.id;
        }
        upload(c, slug, {type: wide(`${t} 0`, TYPE_MAX), date: '2026-11-19', pad, as: firstId, newId});
    }
    for (let i = c.log.length; i < MAX_LOG; i++) {
        addLog(c, {at: new Date(NOW).toISOString(), what: 'upload', team: Object.keys(c.teams)[0], label: wide('Rollers', LOG_LABEL_MAX)});
    }
    return c;
}

// A club with this much padding passes every cap (name length, sheet and file size).
function fits(pad) {
    try {
        return clubBytes(fullClub(99, pad)) <= MAX_CLUB_BYTES;
    } catch (e) {
        if (e instanceof ClubError && (e.code === 'cap-bytes' || e.code === 'long-name')) {
            return false;
        }
        throw e;
    }
}

// The most white space per name that keeps a club within the caps.
function maxPad() {
    let lo = 0;
    let hi = 4000;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (fits(mid)) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    return lo;
}


test('startup load test: MAX_CIRCLES clubs at full caps', t => {
    assert.equal(readConfig({DATA_DIR: 'x'}).maxCircles, MAX_CIRCLES_DEFAULT);
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paceline-load-'));
    try {
        const pad = maxPad();
        const db = openDb(dataDir);
        let bytes = 0;
        let sample;
        try {
            const store = openStore({db, now: () => NOW});
            for (let n = 0; n < MAX_CIRCLES_DEFAULT; n++) {
                const c = fullClub(n, pad);
                bytes = clubBytes(c);
                store.create(c);   // refuses a club over MAX_CLUB_BYTES
            }
            sample = clubJson(db, store.active()[0].id);
        } finally {
            db.close();   // the child opens paceline.db: the lock is exclusive
        }
        // Nothing stripSheet should drop reached the rows.
        assert.doesNotMatch(sample, /\{\},\{\}|"ftp"|"target_speed"|"minimum_finishers"|"color":\[/);
        assert.ok(bytes > 0.95 * MAX_CLUB_BYTES, `a full club is only ${bytes} bytes`);

        const code = `Promise.all([import(${JSON.stringify(DB_URL)}), import(${JSON.stringify(STORE_URL)})]).then(([{openDb}, {openStore}]) => {
            const store = openStore({db: openDb(${JSON.stringify(dataDir)}), now: Date.now});
            gc();
            const m = process.memoryUsage();
            const t0 = performance.now();
            const swept = store.sweep();
            const sweepMs = performance.now() - t0;
            console.log(JSON.stringify({rss: m.rss, heap: m.heapUsed, clubs: store.activeCount(),
                listed: store.listedIn('1000000').length, sweepMs, swept: swept.sheets}));
        });`;
        const out = JSON.parse(execFileSync(process.execPath, ['--expose-gc', '-e', code], {encoding: 'utf8', timeout: 120000}));
        assert.equal(out.clubs, MAX_CIRCLES_DEFAULT);
        // the first rider of each club's first team rides in all its MAX_PLANS races, and each race
        // has its own live plan (races spec §1): one listing per race
        assert.equal(out.listed, MAX_CIRCLES_DEFAULT * MAX_PLANS);
        const mb = v => (v / 1048576).toFixed(1);
        t.diagnostic(`load test: ${MAX_CIRCLES_DEFAULT} clubs of ${mb(bytes)} MB each, RSS ${mb(out.rss)} MB, heap ${mb(out.heap)} MB, ` +
            `a sweep with nothing to delete ${out.sweepMs.toFixed(0)} ms`);
        assert.equal(out.swept, 0);
    } finally {
        fs.rmSync(dataDir, {recursive: true, force: true});
    }
});
