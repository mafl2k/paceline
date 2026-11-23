// Test-only builders for clubs, sheets and planner exports, and a running server. Later tasks add
// to this file.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {stripSheet, normalizePlan} from '../../pages/src/engine/plan.mjs';
import {nameKey} from '../ids.mjs';
import {isDate} from '../time.mjs';
import {convertClub} from '../club.mjs';
import {raceOf, racesOf, tidyRaces} from '../races.mjs';
import {cookieClubs} from '../web.mjs';
import {openDb} from '../db.mjs';
import {openStore} from '../store.mjs';


export const RIDERS = {
    '1001': 'Ben', '1002': 'Cleo', '1003': 'Dan', '1004': 'Eva', '1005': 'Finn', '1006': 'Gus',
    '1007': 'Hanna', '1008': 'Ida', '1009': 'Jo',
};


export const T = iso => Date.parse(iso);


// A CODE_SECRET for tests (32+ characters, made up).
export const CODE_SECRET = 'test-secret-0123456789-abcdefghijklmnop';


function riderEntry(id) {
    return {name: RIDERS[id] ?? `Rider ${id}`, weight: 70, ftp: 250};
}


// A zwiftgopher planner export: riders in `riders`, the bench in `roster`.
export function planJson(name, riderIds, benchIds = []) {
    const riders = {};
    riderIds.forEach((id, i) => {
        riders[id] = {...riderEntry(id), order: i + 1, pull_duration: 60, color: '#ff0000'};
    });
    const roster = {};
    for (const id of benchIds) {
        roster[id] = riderEntry(id);
    }
    return {team: {name}, riders, roster};
}


// A version as the server stores it: stripped, with its sig. `plan` is left out when not given
// (club() then makes every version its own plan); `at` defaults to `uploadedAt`, `recSig` to `sig`.
export function sheet({
    team, label, date, riders, bench = [], uploadedAt, eventId = null, pinnedEventId = null,
    plan, n = 1, at = uploadedAt, recSig, type = null,
}) {
    const {json, text} = stripSheet(planJson(label, riders, bench), null);
    const {plan: normal} = normalizePlan(json, text);
    return {
        team, label, date, sig: normal.sig, json, text, uploadedAt, via: 'file',
        eventId, boundAt: null, pinnedEventId,
        ...(plan === undefined ? {} : {plan}),
        n, at, jsonName: nameKey(label), type, recSig: recSig ?? normal.sig,
    };
}


// An active club in the shape of spec §4. A sheet without `plan` is its own plan. The teams and
// sheets may be given in the 0.3 shape (team.live, team.raceStarts, the event fields on the sheets):
// the club is converted to races (club.mjs convertClub, at its createdAt) before it is returned.
export function club({
    id = 'k7f3q9x2m4', name = 'Kettenfett RC', tz = 'Europe/Berlin', teams = {}, sheets = {},
    createdAt = '2026-11-01T10:00:00.000Z',
} = {}) {
    const stored = {};
    for (const [sid, s] of Object.entries(sheets)) {
        stored[sid] = s.plan === undefined ? {...s, plan: sid} : s;
    }
    const c = {
        id, name, status: 'active', email: 'captain@example.org', tz, createdAt, confirmedAt: createdAt,
        tokens: [], teams, sheets: stored, log: [], inbox: [],
    };
    convertClub(c, Date.parse(c.createdAt));
    return c;
}


// The live id of team `slug`'s race on `date`; without a date, the one live id of the team: null
// for none, an error for two.
export function liveId(c, slug, date = null) {
    if (date !== null) {
        return raceOf(c, slug, date)?.live ?? null;
    }
    const ids = racesOf(c, slug).map(([, r]) => r.live).filter(id => id !== null);
    if (ids.length > 1) {
        throw new Error(`team ${slug} has ${ids.length} live plans: ${ids.join(', ')}`);
    }
    return ids[0] ?? null;
}


// The race of team `slug` on `date` (races.mjs raceOf), or null.
export const race = (c, slug, date) => raceOf(c, slug, date);


// Makes version `id` the live plan of its race (team `slug`'s race of the version's date), as Make
// live does: the team's other races keep theirs (races spec §1). Null clears the live plan of every
// race of the team. A fixture that added versions by hand gets their races first (tidyRaces: the
// store always holds invariant 1); a version of another team, or one without a date, is an error.
export function setLive(c, slug, id) {
    if (id === null) {
        for (const [, r] of racesOf(c, slug)) {
            r.live = null;
        }
        return;
    }
    const date = c.sheets[id]?.team === slug ? c.sheets[id].date : null;
    if (raceOf(c, slug, date) === null) {
        tidyRaces(c, slug);
    }
    const r = raceOf(c, slug, date);
    if (r === null) {
        throw new Error(`setLive: no race for ${id} of team ${slug}`);
    }
    r.live = id;
}


const EVENT_FIELDS = ['pinnedEventId', 'eventId', 'boundAt'];

// The club is in the races shape: no team.live or team.raceStarts, no event field on a version, a
// race exactly for every date that has a version of its team, and every race's live null or a
// version of that team and date.
export function assertRaceShape(c) {
    for (const [slug, team] of Object.entries(c.teams)) {
        assert.equal(Object.hasOwn(team, 'live'), false, `team ${slug} has live`);
        assert.equal(Object.hasOwn(team, 'raceStarts'), false, `team ${slug} has raceStarts`);
        assert.ok(team.races !== null && typeof team.races === 'object' && !Array.isArray(team.races), `team ${slug} has no races`);
        const dates = [...new Set(Object.values(c.sheets).filter(s => s.team === slug && isDate(s.date)).map(s => s.date))].sort();
        assert.deepEqual(Object.keys(team.races).sort(), dates, `the races of team ${slug}`);
        for (const [date, r] of Object.entries(team.races)) {
            assert.deepEqual(Object.keys(r).sort(), ['boundAt', 'eventId', 'live', 'pinnedEventId', 'start'], `race ${slug} ${date}`);
            if (r.live !== null) {
                const v = c.sheets[r.live];
                assert.ok(v !== undefined && v.team === slug && v.date === date, `race ${slug} ${date}: live ${r.live}`);
            }
        }
    }
    for (const [id, s] of Object.entries(c.sheets)) {
        for (const k of EVENT_FIELDS) {
            assert.equal(Object.hasOwn(s, k), false, `sheet ${id} has ${k}`);
        }
    }
}


// ---- paceline.db ----

// The rows of a query as plain objects (node:sqlite gives them a null prototype).
export function rows(db, sql, ...params) {
    return db.sql.prepare(sql).all(...params).map(r => ({...r}));
}

// A club's stored JSON text, or null when it has no row.
export const clubJson = (db, cid) => db.sql.prepare('SELECT json FROM clubs WHERE cid = ?').get(cid)?.json ?? null;

// Rows written on this connection so far: a delta of 0 means nothing was written.
export const changes = db => db.sql.prepare('SELECT total_changes() AS n').get().n;

// Makes SQLite refuse these writes to `table` (as a full disk would refuse them, but without ending
// the transaction); the returned function takes that back.
export function refuseWrites(db, table, ops = ['INSERT', 'UPDATE', 'DELETE']) {
    const names = ops.map(op => `test_refuse_${table}_${op.toLowerCase()}`);
    ops.forEach((op, i) => db.sql.exec(
        `CREATE TEMP TRIGGER ${names[i]} BEFORE ${op} ON main.${table} BEGIN SELECT RAISE(ABORT, 'test: write refused'); END`));
    return () => {
        for (const name of names) {
            db.sql.exec(`DROP TRIGGER IF EXISTS temp.${name}`);
        }
    };
}

// Stores what `fn({db, store})` stores into DATA_DIR's paceline.db, then closes it (before a server
// opens the same data dir).
export function seedDb(dataDir, fn) {
    const db = openDb(dataDir);
    try {
        fn({db, store: openStore({db, now: Date.now})});
    } finally {
        db.close();
    }
}


// The mail queue's interface (mailer.mjs) without a network: `sent` collects every accepted
// {kind, to, subject, text, html, budget}. With `refuse` (also settable later) send() refuses like a
// mailer over a limit. `results` is a list the test may fill.
export function fakeMailer({refuse = false} = {}) {
    const m = {
        sent: [], refuse, resultList: [], closed: false,
        send({kind, to, subject, text, html = null, budget}) {
            if (m.refuse || m.closed) {
                return false;
            }
            m.sent.push({kind, to, subject, text, html, budget});
            return true;
        },
        results: () => m.resultList.map(r => ({...r})),
        sweeps: 0,
        sweep() {
            m.sweeps++;
            return 0;
        },
        close() {
            m.closed = true;
        },
    };
    return m;
}


// A server on a fresh DATA_DIR and a free port. `clock` is a mutable {now} (as in the store tests);
// without it the server runs on Date.now. `prepare(dataDir)` runs before the server is created.
// `mailer` replaces the mail queue (fakeMailer()); a test that sets SMTP_HOST, MAIL_FROM and
// PUBLIC_URL without one gets a real queue. The start log line is kept out of the test output.
export async function startServer({env = {}, clock, prepare, mailer = null} = {}) {
    const {createServer} = await import('../server.mjs');
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paceline-server-'));
    prepare?.(dataDir);
    const log = console.log;
    console.log = () => {};
    let server;
    try {
        server = createServer({env: {DATA_DIR: dataDir, ...env}, now: clock ? () => clock.now : Date.now, mailer});
    } finally {
        console.log = log;
    }
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function stop() {
        server.closeAllConnections();
        await new Promise(r => server.close(r));
        fs.rmSync(dataDir, {recursive: true, force: true});
    }
    return {base, server, store: server.store, dataDir, stop};
}


// The fields of a form a captain page posts to /manage: `fields` plus the hidden club=<id> that
// every such form carries (withClub in ui.mjs), the club this browser has open (the cookie's
// active club). Left as they are for another path, without a club the cookie opens, or when
// `fields` has its own `club` (undefined: sent without one).
export function pageFields(store, cookie, p, fields) {
    const own = Object.hasOwn(fields, 'club');
    const cid = !own && cookie && /^\/manage(\/|\?|$)/.test(p) ? cookieClubs({headers: {cookie}}, {store})[0]?.circle : undefined;
    const out = cid === undefined ? {...fields} : {club: cid, ...fields};
    for (const [k, v] of Object.entries(out)) {
        if (v === undefined) {
            delete out[k];
        }
    }
    return out;
}
