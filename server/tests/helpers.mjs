// Test-only builders for clubs, sheets and planner exports, and a running server. Later tasks add
// to this file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {stripSheet, normalizePlan} from '../../pages/src/engine/plan.mjs';
import {nameKey} from '../ids.mjs';
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
    plan, n = 1, at = uploadedAt, copyOf = null, recSig, type = null,
}) {
    const {json, text} = stripSheet(planJson(label, riders, bench), null);
    const {plan: normal} = normalizePlan(json, text);
    return {
        team, label, date, sig: normal.sig, json, text, uploadedAt, via: 'file',
        eventId, boundAt: null, pinnedEventId,
        ...(plan === undefined ? {} : {plan}),
        n, at, copyOf, jsonName: nameKey(label), type, recSig: recSig ?? normal.sig,
    };
}


// An active club in the shape of spec §4. A sheet without `plan` is its own plan.
export function club({
    id = 'k7f3q9x2m4', name = 'Kettenfett RC', tz = 'Europe/Berlin', teams = {}, sheets = {},
    createdAt = '2026-11-01T10:00:00.000Z',
} = {}) {
    const stored = {};
    for (const [sid, s] of Object.entries(sheets)) {
        stored[sid] = s.plan === undefined ? {...s, plan: sid} : s;
    }
    return {
        id, name, status: 'active', email: 'captain@example.org', tz, createdAt, confirmedAt: createdAt,
        tokens: [], teams, sheets: stored, log: [], inbox: [],
    };
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
