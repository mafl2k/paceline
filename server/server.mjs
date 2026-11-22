// Paceline plan server: clubs ("circles") keep their teams' plan sheets, every rider's Paceline
// mod asks which plan to ride. node:http only, no npm dependencies.
//
// Modules (all in server/, imported by relative path; the image keeps the repo layout):
//   server.mjs   this file: createServer, routes, timers, the main guard
//   config.mjs   readConfig(env), modeLine(cfg)
//   db.mjs       paceline.db: opened with an exclusive lock before listening, the lock wait, schema and
//                migrations, transactions
//   http.mjs     errors, readBody, answers with the security headers, multipart/form/cookies,
//                redactPath and logPath for logs
//   store.mjs    the clubs, trash, tombstones, seen and server settings (in paceline.db, held in
//                memory), sweep; import-files.mjs: the one-time import of the 0.3 file layout at the
//                first start
//   club.mjs     club operations and caps (pure)
//   select.mjs   which sheet a rider gets, event match, the 30-minute gate, effects (pure)
//   api.mjs      the plan check GET /api/v3/rider/<zwiftId>
//   push.mjs     the ZwiftGopher push: the team's short-lived planner link, POST /api/v3/push
//   logs.mjs     recordings per club: POST /api/log/<slug>, content check, quotas, retention
//   erasures.mjs the erasure list (DATA_DIR/erasures.jsonl): every Remove a rider, applied again at
//                start to data a restore brought back
//   dump.mjs     nightly VACUUM INTO dump of paceline.db in DATA_DIR/dumps, the newest 7 kept
//   limits.mjs   client address, public-address check, in-memory rate limits
//   mail.mjs     message builder and SMTP client; mailer.mjs: the queue with budgets and retries
//   web.mjs      the public pages (register, lost link, privacy), club links and cookie, principal(),
//                the /manage* gate
//   admin.mjs    the operator page /admin (Basic auth, throttle, clubs, links, restore, purge)
//   manage.mjs   the club's routes /manage*, the upload and its preview (a dry run);
//                manage-teams.mjs: the team pages' forms; manage-club.mjs: the club settings' forms
//                and recording delete; manage-page.mjs: what they share; teams-page.mjs: the
//                team picker, team-page.mjs: the team pages, settings-page.mjs: the club settings,
//                upload-page.mjs: the upload form; cockpit-page.mjs: the team page (the team
//                cockpit), store-form.mjs: its Store form and the Store flash
//                (all pure)
//   pages.mjs    the copy (T), the plain page frame; tokens.mjs: a club's tokens (pure)
//   static.mjs   /static/app.css (app-css.mjs) and /static/app.js (client.mjs), cached by content;
//                ui.mjs: appPage(), the captain pages' frame
//   ids.mjs      ids, slugs, names, mod versions (pure)
//   time.mjs     time zones and dates (pure)
//   ../pages/src/engine/plan.mjs, colors.mjs   the mod's own plan engine
//
// Variables (spec §11; an empty value counts as unset):
//   DATA_DIR            default /data
//   PORT                default 8080
//   PUBLIC_URL          default https://<PACELINE_HOST>; base of mailed links
//   PACELINE_TZ         default Europe/Berlin; zone for new clubs and of the nightly dump
//   MAX_CIRCLES         default 50 active clubs
//   LOG_MAX_FILE_MB, LOG_MAX_TOTAL_MB, LOG_MAX_CIRCLE_MB   default 20, 2000, 300 (decimals allowed)
//   LOG_RETENTION_DAYS  default 90, 0 keeps all
//   BACKUP_RETENTION_MONTHS   default 6; how long the operator keeps backups of the whole server
//                       (outside this server), for /privacy
//   MOD_MIN_VERSION, MOD_NOTICE   default none, "Please update Paceline to {min} or newer."
//   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS   mail needs SMTP_HOST, MAIL_FROM and PUBLIC_URL;
//                       without them: no mail, no registration
//   MAIL_FROM (an address, 'Name <address>' allowed), MAIL_MAX_PER_DAY (200), REGISTRATION (open), PRIVACY_CONTACT
//   OPERATOR_EMAIL      the notice of every Remove a rider (erasures.mjs); default the address in PRIVACY_CONTACT
//   ADMIN_USER, ADMIN_PASS        default the UPLOAD_USER/UPLOAD_PASS pair
//   TRUSTED_PROXY_HOPS            default 1
//
//   GET /healthz   ok
//   GET /, GET/POST /register, GET/POST /m/<token>, GET/POST /lost, GET /privacy   the pages (web.mjs)
//   GET /manage…, POST /manage/…   the captain pages and their actions (manage.mjs)
//   GET /admin, POST /admin/{link,restore,purge,registration}   the operator page (admin.mjs)
//   GET /api/v3/rider/<zwiftId>   the plan check (api.mjs)
//   POST /api/v3/push?paceline=<token>   a plan from ZwiftGopher into the team's inbox (push.mjs);
//                       anything else under /api/v3/ is a JSON 404
//   GET /api/plan/<anything>   0.2.x mods: the "Update Paceline" notice record (api.mjs)
//   POST /api/log/<slug>?circle=&session=&athlete=&mod=   a recording (logs.mjs)
//   OPTIONS /api/plan/…, /api/log/…, /api/v3/…   CORS preflights; the routes themselves follow
//                       (/api/v3/push: only for zwiftgopher.com, push.mjs)
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readConfig, modeLine, mailOn} from './config.mjs';
import {HttpError, ClientAbort, send, json, logPath} from './http.mjs';
import {openDb, waitForDb} from './db.mjs';
import {openStore} from './store.mjs';
import {importFiles} from './import-files.mjs';
import {handleRider, handleOldPlan, CODE_FAILS_MAX} from './api.mjs';
import {makeLimiter} from './limits.mjs';
import {makeLogStore, makeUploadState, handleLogUpload, LOG_BODY_MS} from './logs.mjs';
import {openErasures, makeEraser, expiryCutoff} from './erasures.mjs';
import {makeDumpJob, leftoverFolders, LEFTOVER_DAYS} from './dump.mjs';
import {makeMailer} from './mailer.mjs';
import {handleWeb, makeWebState} from './web.mjs';
import {handleManage} from './manage.mjs';
import {handleAdmin, makeAdminState} from './admin.mjs';
import {handleStatic} from './static.mjs';
import {pushSecret, makePush, handlePush, pushPreflight} from './push.mjs';

export {slugify} from './ids.mjs';
export {parseMultipart} from './http.mjs';

const SEEN_FLUSH_MS = 60 * 1000;
const SWEEP_MS = 10 * 60 * 1000;
const LOG_SWEEP_MS = 6 * 3600 * 1000;
const DUMP_CHECK_MS = 10 * 60 * 1000;


function preflight(res, methods, headers) {
    res.writeHead(204, {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': methods,
        ...(headers ? {'Access-Control-Allow-Headers': headers} : {}), 'Access-Control-Max-Age': '600'});
    res.end();
}


// An error as a log line may show it: its code (ENOENT …) or class name, never its message.
const errorKind = e => String(e?.code ?? e?.name ?? 'error');

const text = (res, status, body, extra) => send(res, status, 'text/plain; charset=utf-8', body, extra);


// `mailer` replaces the real mail queue (tests); without it one is built when mail is on. `db` is
// paceline.db already open (the main guard waits for its lock); without it createServer opens it.
// The server closes it on 'close'.
export function createServer({env = process.env, now = Date.now, mailer: injected = null, db: given = null} = {}) {
    const cfg = readConfig(env);
    const db = given ?? openDb(cfg.dataDir, {now});
    try {
        return serve({cfg, now, injected, db});
    } catch (e) {
        if (!given) {
            db.close();
        }
        throw e;
    }
}


function serve({cfg, now, injected, db}) {
    // before anything reads paceline.db: an old data dir (circles/ …) is imported once
    importFiles(db, cfg.dataDir, {now: now(), tz: cfg.tz});
    // what an import or a restore by hand left beside paceline.db: old club data, to go by hand
    for (const {name, date} of leftoverFolders(cfg.dataDir)) {
        console.warn(`paceline-server: ${name}/ is still in the data dir; delete it by hand within ${LEFTOVER_DAYS} days of ${date} (see server/README.md)`);
    }
    const mailer = injected ?? (mailOn(cfg) ? makeMailer({cfg, now}) : null);
    // the erasure list first (the uploads consult it), then the log store: the store archives into
    // it the versions a recording used
    const erasureList = openErasures(cfg.dataDir);
    const logs = makeLogStore(cfg.dataDir, {db, now, erasures: erasureList});
    const store = openStore({db, now, archive: logs});
    const erasures = makeEraser({list: erasureList, db, store, logs, now});
    console.log('paceline-server: ' + modeLine(cfg));
    store.sweep();
    const logUploads = makeUploadState();
    // The log sweep, then (in the background) the files its reconcile held back or found changed,
    // against the erasure list (a restore of logs/ brings back what Remove a rider took out).
    // An erasure list that could not be read is read again first: once it is, the removals this
    // database has not applied are applied and the held files checked (erasures.mjs).
    let checked = Promise.resolve();
    let swept = false;    // the start's own sweep: the list was just read
    const sweepLogs = () => {
        const readAgain = swept && erasureList.reload();
        swept = true;
        const n = logs.sweep(now(), cfg.logRetentionDays);
        if (n > 0) {
            console.log(`paceline-server: ${n} recordings older than ${cfg.logRetentionDays} days deleted`);
        }
        checked = logs.checkHeld().then(r => {
            if (r.deleted || r.changed || r.failed || r.unreadable) {
                console.log(`paceline-server: erasure list: recordings found by the reconcile: ${r.deleted} of removed riders deleted, `
                    + `${r.changed} rewritten without them, ${r.failed} failed and ${r.unreadable} not readable (checked again at the next sweep)`);
            }
            return r;
        }, e => {
            console.error(`paceline-server: erasure list: recordings found by the reconcile not checked: ${e?.code ?? e?.name ?? 'error'}`);
        });
        if (readAgain) {
            console.log('paceline-server: erasures.jsonl can be read again');
            erasures.applyPending().catch(e => {
                console.error(`paceline-server: erasures.jsonl: applying again failed: ${e?.code ?? e?.name ?? 'error'}`);
            });
        }
        try {
            const gone = erasures.expire(expiryCutoff(now(), cfg.backupRetentionMonths));
            if (gone > 0) {
                console.log(`paceline-server: erasures.jsonl: ${gone} removals older than the backups dropped`);
            }
        } catch (e) {
            console.error(`paceline-server: erasures.jsonl not swept: ${e?.code ?? e?.name ?? 'error'}`);
        }
    };
    try {
        sweepLogs();
    } catch (e) {
        console.error(`paceline-server: log sweep: ${e.message}`);
    }
    // Removals this paceline.db has not applied (a restore): their database parts now, before the
    // port opens; their recordings in the background (erasures.mjs).
    const erasuresApplied = Promise.all([checked, erasures.applyPending().catch(e => {
        console.error(`paceline-server: erasures.jsonl: applying again failed: ${e?.code ?? e?.name ?? 'error'}`);
    })]);
    const codeFails = makeLimiter([{ms: 3600000, max: CODE_FAILS_MAX}]);
    // the ZwiftGopher push: its secret is made once and kept in paceline.db (push.mjs)
    const push = makePush({secret: pushSecret(db), store, cfg});
    const web = makeWebState();
    const admin = makeAdminState();
    // Nightly dump from 03:00 local on (dump.mjs): it logs its errors and an overdue dump itself,
    // and keeps the last dump and failure for the admin page.
    const dumpJob = makeDumpJob(db, cfg.dataDir, {now, tz: cfg.tz});

    async function route(req, res) {
        const url = new URL(req.url, 'http://localhost');
        const p = url.pathname;
        const method = req.method === 'HEAD' ? 'GET' : req.method;

        if (p === '/healthz' && method === 'GET') {
            text(res, 200, 'ok');
            return;
        }
        if (method === 'OPTIONS') {
            if (p.startsWith('/api/plan/')) {
                preflight(res, 'GET, OPTIONS', 'If-None-Match');
                return;
            }
            if (p.startsWith('/api/log/')) {
                preflight(res, 'POST, OPTIONS', 'Content-Type');
                return;
            }
            if (p === '/api/v3/push') {
                pushPreflight(req, res);
                return;
            }
            if (p.startsWith('/api/v3/')) {
                preflight(res, 'GET, OPTIONS', 'X-Paceline-Codes');
                return;
            }
        }
        if (p.startsWith('/api/plan/')) {
            if (method !== 'GET') {
                text(res, 405, 'method not allowed', {Allow: 'GET, OPTIONS'});
                return;
            }
            handleOldPlan(req, res, {cfg});
            return;
        }
        if (p.startsWith('/api/log/')) {
            if (method !== 'POST') {
                json(res, 405, {error: 'method not allowed'}, {'Access-Control-Allow-Origin': '*', Allow: 'POST, OPTIONS'});
                return;
            }
            let slug;
            try {
                slug = decodeURIComponent(p.slice('/api/log/'.length));
            } catch (e) {
                slug = '';
            }
            await handleLogUpload(req, res, {store, cfg, now: now(), logs, state: logUploads}, slug, url.searchParams);
            return;
        }
        if (p === '/api/v3/push') {
            await handlePush(req, res, {store, cfg, now: now(), push}, url.searchParams, method);
            return;
        }
        if (p.startsWith('/api/v3/')) {
            const m = /^\/api\/v3\/rider\/([^/]+)$/.exec(p);
            if (m && method === 'GET') {
                handleRider(req, res, {store, cfg, now: now(), codeFails}, m[1], url.searchParams);
            } else {
                json(res, 404, {error: 'not found'}, {'Access-Control-Allow-Origin': '*'});
            }
            return;
        }
        if (handleStatic(req, res, p, method, url)) {
            return;
        }
        const pages = {store, cfg, mailer, now: now(), web, logs, admin, dumps: dumpJob, erasures, push};
        if (await handleAdmin(req, res, pages, p, method) || await handleManage(req, res, pages, p, method)
            || await handleWeb(req, res, pages, p, method)) {
            return;
        }
        text(res, 404, 'not found');
    }

    const server = http.createServer((req, res) => {
        route(req, res).catch(e => {
            if (e instanceof ClientAbort) {
                // either the client went away or node's requestTimeout closed the connection
                console.warn(`${e.message}: ${req.method} ${logPath(String(req.url).split('?')[0])}`);
                res.destroy();
                return;
            }
            if (e instanceof HttpError) {
                if (!res.headersSent) {
                    text(res, e.status, e.message, {Connection: 'close'});
                }
                return;
            }
            // the error's kind and where in the code, never its message: an fs error names the
            // file, and a recording's file name holds a Zwift ID
            const frames = String(e?.stack ?? '').split('\n').filter(l => /^\s+at /.test(l)).join('\n');
            console.error(`request failed: ${req.method} ${logPath(String(req.url).split('?')[0])}: ${errorKind(e)}${frames ? '\n' + frames : ''}`);
            if (!res.headersSent) {
                text(res, 500, 'internal error');
            } else {
                res.end();
            }
        });
    });
    // node's whole-request timeout is only a backstop above the recording body deadline (logs.mjs
    // LOG_BODY_MS, an exact timer per body); at 30 s it cut every upload off long before that.
    // Requests without a body are complete with their headers, which headersTimeout bounds.
    server.requestTimeout = LOG_BODY_MS + 10000;
    server.headersTimeout = 15000;

    // A failed write keeps the seen data dirty, so the next tick tries again.
    const every = (ms, what, fn) => {
        const t = setInterval(() => {
            try {
                fn();
            } catch (e) {
                console.error(`paceline-server: ${what}: ${e.message}`);
            }
        }, ms);
        t.unref();
        return t;
    };
    // Rate-limit counters (client and mail addresses) are memory only and go at the first sweep
    // after their windows have passed, so at most 24 hours and 10 minutes: the privacy page says
    // about 24 hours.
    const sweepLimits = () => {
        const t = now();
        codeFails.sweep(t);
        push.sweep(t);
        web.sweep(t);
        admin.sweep(t);
        mailer?.sweep();
    };
    const timers = [
        every(SEEN_FLUSH_MS, 'seen flush', () => store.flushSeen()),
        every(SWEEP_MS, 'sweep', () => store.sweep()),
        every(SWEEP_MS, 'limit sweep', sweepLimits),
        every(LOG_SWEEP_MS, 'log sweep', sweepLogs),
        every(DUMP_CHECK_MS, 'dump', () => dumpJob.tick()),
    ];
    server.on('close', () => {
        for (const t of timers) {
            clearInterval(t);
        }
        mailer?.close();
        try {
            store.flushSeen();
        } catch (e) {
            console.error(`paceline-server: seen flush: ${e.message}`);
        } finally {
            try {
                if (db.sql.isOpen) {
                    db.close();
                }
            } catch (e) {
                console.error(`paceline-server: closing paceline.db: ${e.message}`);
            }
        }
    });

    server.db = db;
    server.store = store;
    server.cfg = cfg;
    server.logs = logs;
    server.erasures = erasures;
    server.erasuresApplied = erasuresApplied;
    server.mailer = mailer;
    server.logUploads = logUploads;
    server.web = web;
    server.push = push;
    server.admin = admin;
    server.sweepLimits = sweepLimits;
    server.sweepLogs = sweepLogs;
    server.dumpJob = dumpJob;
    server.flushSync = () => store.flushSeen();
    return server;
}


// The port opens only after paceline.db is open: a second process on the same data dir (a stale
// task on another host) waits for the lock and never listens; after 10 minutes it exits 1.
async function main() {
    let server;
    try {
        const cfg = readConfig(process.env);
        const db = await waitForDb(cfg.dataDir);
        server = createServer({db});
    } catch (e) {
        console.error(`paceline-server: ${e.message}`);
        process.exit(1);
    }
    server.listen(server.cfg.port, () => console.log(`paceline-server ${process.env.PACELINE_VERSION || 'dev'} listening on :${server.cfg.port}`));
    const stop = () => {
        try {
            server.flushSync();
        } catch (e) {
            console.error(`paceline-server: seen flush: ${e.message}`);
        }
        server.close(() => process.exit(0));
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
}


if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    void main();
}
