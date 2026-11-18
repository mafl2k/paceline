// Paceline plan server: the captain uploads the zwiftgopher TTT planner export behind a fixed
// login, every rider's Paceline mod fetches the plan. node:http only, no npm dependencies.
//
//   UPLOAD_USER, UPLOAD_PASS   required (the server refuses to start without them)
//   DATA_DIR                   default /data   (plans live in DATA_DIR/plans/<slug>.json,
//                              recordings in DATA_DIR/logs/<slug>/<session>-<athlete>.jsonl.gz)
//   PORT                       default 8080
//   LOG_MAX_FILE_MB            default 20      largest accepted recording upload
//   LOG_MAX_TOTAL_MB           default 2000    all recordings together
//
//   GET  /api/plan/<slug>, /api/plan/by-athlete/<id>   open, the mod fetches the plan
//   POST /api/log/<slug>?session=<ms>&athlete=<id>     open (CORS), the mod uploads a gzip recording;
//                                                      only for a team that has a plan, stored as is
//   GET  /, POST /upload, /delete                      login: plans
//   GET  /logs/<slug>/<file>, POST /logs/delete        login: download / delete a recording
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

// The engine is the mod's own plan.mjs/colors.mjs: copied to ./engine in the Docker image, read
// from the repo (../pages/src/engine) when running from a checkout.
const here = path.dirname(fileURLToPath(import.meta.url));
const engineDir = [path.join(here, 'engine'), path.join(here, '..', 'pages', 'src', 'engine')]
    .find(d => fs.existsSync(path.join(d, 'plan.mjs')));
if (!engineDir) {
    throw new Error('plan.mjs not found (looked in ./engine and ../pages/src/engine)');
}
const {importFiles, PlanError, decodeEntities} = await import(pathToFileURL(path.join(engineDir, 'plan.mjs')).href);

export const MAX_BODY = 1024 * 1024;
const MAX_TEAM_NAME = 80;
const MB = 1024 * 1024;
const SLUG_RE = /^[a-z0-9-]+$/;
const LOG_FILE_RE = /^(\d{1,16})-(\d{1,12})\.jsonl\.gz$/;
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b, 0x08]);

// Same texts as the mod (pages/src/strings.mjs); copied, not imported (that module is browser-only).
const STRINGS = {
    noJson: 'Load the JSON export too – it has the Zwift IDs.',
    notAPlan: 'This is not a ZwiftGopher TTT plan.',
    unreadable: 'Could not read this file – expected the planner\'s JSON or text export.',
    pullMismatch: 'Pull time for {name} differs between the files – using the JSON.',
    unmatched: '"{name}" from the text export is not in the JSON.',
    noWatts: 'No text export loaded – pull watts will be missing.',
    noTeam: 'This plan has no team name – please enter one.',
    badTeam: 'The team name needs at least one letter or digit.',
    badForm: 'The upload was not a valid form (expected fields team, json and text).',
    tooBig: 'The upload is larger than 1 MB.',
};


class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}


// The client went away before its body was complete (connection reset or closed): nothing to
// answer and nothing to store.
class ClientAbort extends Error {}


export function slugify(name) {
    return String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}


function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;'}[c]));
}


// ---- multipart/form-data (strict: fields team, json, text; each at most once) ----

const CRLF = Buffer.from('\r\n');
const HEADER_END = Buffer.from('\r\n\r\n');
const DISPOSITION = /^form-data;\s*name="([^"]*)"(?:;\s*filename="([^"]*)")?$/i;


export function parseMultipart(body, contentType) {
    const m = /^multipart\/form-data;\s*boundary=(?:"([^"\r\n]{1,70})"|([^\s;"]{1,70}))\s*$/i.exec(contentType || '');
    if (!m) {
        throw new HttpError(400, STRINGS.badForm);
    }
    const delim = Buffer.from('--' + (m[1] || m[2]));
    const nextDelim = Buffer.concat([CRLF, delim]);
    if (body.indexOf(delim) !== 0) {
        throw new HttpError(400, STRINGS.badForm);
    }
    const out = {team: null, json: null, text: null};
    let pos = delim.length;
    for (;;) {
        const tail = body.subarray(pos, pos + 2).toString('latin1');
        if (tail === '--') {
            const rest = body.subarray(pos + 2);
            if (rest.length && !rest.equals(CRLF)) {
                throw new HttpError(400, STRINGS.badForm);
            }
            break;
        }
        if (tail !== '\r\n') {
            throw new HttpError(400, STRINGS.badForm);
        }
        const hEnd = body.indexOf(HEADER_END, pos);
        if (hEnd < 0) {
            throw new HttpError(400, STRINGS.badForm);
        }
        const headers = body.subarray(pos + 2, hEnd).toString('utf8').split('\r\n');
        const start = hEnd + HEADER_END.length;
        const end = body.indexOf(nextDelim, start);
        if (end < start) {
            throw new HttpError(400, STRINGS.badForm);
        }
        const content = body.subarray(start, end);
        let name = null, filename = null;
        for (const h of headers) {
            const colon = h.indexOf(':');
            const key = colon < 0 ? '' : h.slice(0, colon).trim().toLowerCase();
            if (key === 'content-disposition') {
                const d = DISPOSITION.exec(h.slice(colon + 1).trim());
                if (!d || name !== null) {
                    throw new HttpError(400, STRINGS.badForm);
                }
                name = d[1];
                filename = d[2] === undefined ? null : d[2];
            } else if (key !== 'content-type') {
                throw new HttpError(400, STRINGS.badForm);
            }
        }
        if (!['team', 'json', 'text'].includes(name) || out[name] !== null) {
            throw new HttpError(400, STRINGS.badForm);
        }
        if ((name === 'team') !== (filename === null)) {
            throw new HttpError(400, STRINGS.badForm);
        }
        out[name] = content;
        pos = end + nextDelim.length;
    }
    return out;
}


function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        const declared = req.headers['content-length'];
        if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
            reject(new HttpError(413, STRINGS.tooBig));
            return;
        }
        const chunks = [];
        let size = 0;
        req.on('data', c => {
            size += c.length;
            if (size > limit) {
                reject(new HttpError(413, STRINGS.tooBig));
                req.pause();
                return;
            }
            chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', e => reject(e && (e.code === 'ECONNRESET' || e.message === 'aborted') ? new ClientAbort() : e));
        req.on('close', () => {
            if (!req.complete) {
                reject(new ClientAbort());
            }
        });
    });
}


// ---- storage ----

function writeAtomic(file, data) {
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    try {
        fs.writeFileSync(tmp, data, {mode: 0o640});
        fs.renameSync(tmp, file);
    } catch (e) {
        fs.rmSync(tmp, {force: true});
        throw e;
    }
}


function makeStore(dataDir) {
    const dir = path.join(dataDir, 'plans');
    fs.mkdirSync(dir, {recursive: true});
    const file = slug => path.join(dir, slug + '.json');
    return {
        get(slug) {
            if (!/^[a-z0-9-]+$/.test(slug)) {
                return null;
            }
            try {
                return JSON.parse(fs.readFileSync(file(slug), 'utf8'));
            } catch (e) {
                return null;
            }
        },
        list() {
            const out = [];
            for (const f of fs.readdirSync(dir)) {
                if (!f.endsWith('.json') || f.startsWith('.')) {
                    continue;
                }
                try {
                    const rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
                    if (rec && rec.slug === f.slice(0, -5)) {
                        out.push(rec);
                    }
                } catch (e) {
                    // a damaged file must not take the whole server down
                }
            }
            return out.sort((a, b) => String(a.team).localeCompare(String(b.team)));
        },
        put(rec) {
            writeAtomic(file(rec.slug), JSON.stringify(rec));
        },
        remove(slug) {
            if (!/^[a-z0-9-]+$/.test(slug)) {
                return false;
            }
            try {
                fs.unlinkSync(file(slug));
                return true;
            } catch (e) {
                return false;
            }
        },
    };
}


// Recordings are opaque gzip files: DATA_DIR/logs/<slug>/<session>-<athlete>.jsonl.gz. Every name
// is validated against the regexes above before it is joined to a path.
function makeLogStore(dataDir) {
    const root = path.join(dataDir, 'logs');
    const file = (slug, name) => SLUG_RE.test(slug) && LOG_FILE_RE.test(name) ? path.join(root, slug, name) : null;
    const entries = dir => {
        try {
            return fs.readdirSync(dir, {withFileTypes: true});
        } catch (e) {
            return [];
        }
    };
    const sizeOf = f => {
        try {
            return fs.statSync(f).size;
        } catch (e) {
            return 0;
        }
    };
    return {
        sizeOf(slug, name) {
            const f = file(slug, name);
            return f ? sizeOf(f) : 0;
        },
        put(slug, name, buf) {
            const f = file(slug, name);
            if (!f) {
                throw new Error('bad recording name');
            }
            fs.mkdirSync(path.dirname(f), {recursive: true});
            writeAtomic(f, buf);
        },
        get(slug, name) {
            const f = file(slug, name);
            try {
                return f ? fs.readFileSync(f) : null;
            } catch (e) {
                return null;
            }
        },
        remove(slug, name) {
            const f = file(slug, name);
            try {
                if (f) {
                    fs.unlinkSync(f);
                    return true;
                }
            } catch (e) {
                // fall through: not there
            }
            return false;
        },
        // newest session first
        list(slug) {
            if (!SLUG_RE.test(slug)) {
                return [];
            }
            const dir = path.join(root, slug);
            return entries(dir).filter(e => e.isFile()).flatMap(e => {
                const m = LOG_FILE_RE.exec(e.name);
                return m ? [{file: e.name, session: m[1], athlete: m[2], size: sizeOf(path.join(dir, e.name))}] : [];
            }).sort((a, b) => {
                const d = BigInt(b.session) - BigInt(a.session);
                return d > 0n ? 1 : d < 0n ? -1 : (a.athlete < b.athlete ? -1 : a.athlete > b.athlete ? 1 : 0);
            });
        },
        slugs() {
            return entries(root).filter(e => e.isDirectory() && SLUG_RE.test(e.name)).map(e => e.name).sort();
        },
        totalBytes() {
            let sum = 0;
            for (const d of entries(root)) {
                if (d.isDirectory()) {
                    for (const e of entries(path.join(root, d.name))) {
                        sum += e.isFile() ? sizeOf(path.join(root, d.name, e.name)) : 0;
                    }
                }
            }
            return sum;
        },
    };
}


// ---- html ----

const PAGE_CSS = `
body{font:16px/1.4 system-ui,sans-serif;max-width:46rem;margin:1.5rem auto;padding:0 1rem;color:#222;background:#fafafa}
h1{font-size:1.5rem}h2{font-size:1.15rem;margin-top:2rem}h3{font-size:1rem;margin:1.2rem 0 .4rem}
form.up{display:grid;gap:.8rem;background:#fff;border:1px solid #ccc;border-radius:6px;padding:1rem}
label{display:grid;gap:.25rem;font-weight:600}label span{font-weight:400;color:#555;font-size:.9rem}
input[type=text]{font:inherit;padding:.4rem}
button{font:inherit;padding:.5rem 1rem;cursor:pointer}
table{border-collapse:collapse;width:100%;background:#fff}th,td{border:1px solid #ccc;padding:.3rem .6rem;text-align:left}
td.n,th.n{text-align:right}
.err{background:#fde8e8;border:1px solid #c33;padding:.7rem 1rem;border-radius:6px}
.ok{background:#e6f5e6;border:1px solid #3a3;padding:.7rem 1rem;border-radius:6px}
.warn{background:#fff6dd;border:1px solid #c90;padding:.5rem 1rem;border-radius:6px}
code{font-size:1.1em;letter-spacing:.08em}
form.del{margin:0}`;


function page(title, body) {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${PAGE_CSS}</style></head>
<body><h1>${esc(title)}</h1>
${body}
</body></html>`;
}


function teamsTable(teams) {
    if (!teams.length) {
        return '<p>No plans stored yet.</p>';
    }
    const rows = teams.map(t => `<tr><td>${esc(t.team)}</td><td><code>${esc(t.sig)}</code></td>` +
        `<td>${esc(t.uploadedAt)}</td>` +
        `<td><form class="del" method="post" action="/delete"><input type="hidden" name="slug" value="${esc(t.slug)}">` +
        `<button type="submit">Delete</button></form></td></tr>`).join('');
    return `<table><thead><tr><th>Team</th><th>Plan code</th><th>Uploaded (UTC)</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}


function uploadForm() {
    return `<form class="up" method="post" action="/upload" enctype="multipart/form-data">
<label>Team name <span>Optional. Empty uses the team name from the JSON. Each team name is its own plan.</span>
<input type="text" name="team" maxlength="${MAX_TEAM_NAME}" autocomplete="off"></label>
<label>Planner JSON export <span>Required.</span><input type="file" name="json" accept=".json,application/json"></label>
<label>Planner text export <span>Optional, adds the pull watts.</span><input type="file" name="text" accept=".txt,.csv,text/*"></label>
<button type="submit">Upload plan</button></form>`;
}


// The rider's name as the planner JSON knows it (riders first, then the bench), else the Zwift id.
function riderName(rec, athlete) {
    for (const group of [rec && rec.json && rec.json.riders, rec && rec.json && rec.json.roster]) {
        if (group && typeof group === 'object' && Object.prototype.hasOwnProperty.call(group, athlete)) {
            const name = decodeEntities(group[athlete] && group[athlete].name).trim();
            if (name) {
                return name;
            }
        }
    }
    return athlete;
}


function sessionStart(session) {
    const d = new Date(Number(session));
    return Number.isNaN(d.getTime()) ? session : d.toISOString().slice(0, 16).replace('T', ' ');
}


function recordingsSection(logs, plans, limits) {
    const byslug = new Map(plans.map(r => [r.slug, r]));
    const sections = logs.slugs().map(slug => ({slug, files: logs.list(slug)})).filter(t => t.files.length).map(({slug, files}) => {
        const rec = byslug.get(slug);
        const rows = files.map(f => `<tr><td>${esc(riderName(rec, f.athlete))}</td><td>${esc(sessionStart(f.session))}</td>` +
            `<td class="n">${esc(Math.ceil(f.size / 1024))} KB</td>` +
            `<td><a href="/logs/${esc(slug)}/${esc(f.file)}">Download</a></td>` +
            `<td><form class="del" method="post" action="/logs/delete"><input type="hidden" name="slug" value="${esc(slug)}">` +
            `<input type="hidden" name="file" value="${esc(f.file)}"><button type="submit">Delete</button></form></td></tr>`).join('');
        return `<h3>${esc(rec ? rec.team : slug)}</h3><table><thead><tr><th>Rider</th><th>Session start (UTC)</th><th class="n">Size</th><th></th><th></th></tr></thead>` +
            `<tbody>${rows}</tbody></table>`;
    });
    const mb = n => Math.round(n / MB * 10) / 10;
    return `<h2>Recordings</h2><p>Recordings: ${mb(logs.totalBytes())} MB of ${mb(limits.total)} MB</p>` +
        (sections.length ? sections.join('') : '<p>No recordings yet.</p>');
}


function indexPage(store, logs, limits, flash) {
    const plans = store.list();
    return page('Paceline plan server', `${flash || ''}${uploadForm()}<h2>Stored plans</h2>${teamsTable(plans)}` +
        recordingsSection(logs, plans, limits));
}


function resultPage(rec, warnings) {
    const riders = rec.riders.map(r => `<tr><td class="n">${esc(r.order)}</td><td>${esc(r.name)}</td>` +
        `<td class="n">${esc(r.pullS)}</td><td class="n">${r.watts === null ? '–' : esc(r.watts)}</td></tr>`).join('');
    const warn = warnings.length ? `<div class="warn"><ul>${warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '';
    return page('Plan stored', `<div class="ok">Stored the plan for <strong>${esc(rec.team)}</strong>. Plan code: <code>${esc(rec.sig)}</code>.
Riders' Paceline picks it up on its next check.</div>${warn}
<table><thead><tr><th class="n">Order</th><th>Rider</th><th class="n">Pull (s)</th><th class="n">Watts</th></tr></thead><tbody>${riders}</tbody></table>
<p><a href="/">Back</a></p>`);
}


function errorPage(message) {
    return page('Upload failed', `<div class="err">${esc(message)}</div><p>Nothing was stored.</p><p><a href="/">Back</a></p>`);
}


function warningTexts(warnings, hasText) {
    const out = warnings.map(w => {
        if (w.code === 'pull-mismatch') {
            return STRINGS.pullMismatch.replace('{name}', () => w.name);
        }
        if (w.code === 'unmatched-text-row') {
            return STRINGS.unmatched.replace('{name}', () => w.name);
        }
        return String(w.code);
    });
    if (!hasText) {
        out.push(STRINGS.noWatts);
    }
    return out;
}


// ---- server ----

const SEC_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': 'default-src \'none\'; style-src \'unsafe-inline\'; form-action \'self\'; frame-ancestors \'none\'; base-uri \'none\'',
};


function send(res, status, type, body, extra) {
    res.writeHead(status, {'Content-Type': type, 'Cache-Control': 'no-store', ...SEC_HEADERS, ...extra});
    res.end(body);
}


// The planner JSON carries every rider's weight, height, FTP and power profile. The API is open, so
// only what the mod reads is stored and served. Weight stays: the mod shows other riders' targets
// in W/kg with it (the planner gets it from public ZwiftPower profiles anyway).
// Rider ids (the object keys) are kept: they are the Zwift ids the by-athlete lookup and the mod need.
const nameOnly = o => ({name: o && typeof o === 'object' ? o.name : undefined});
const mapEntries = (obj, pick) => obj && typeof obj === 'object'
    ? Object.fromEntries(Object.entries(obj).map(([id, v]) => [id, pick(v)]))
    : undefined;
export function stripPlanJson(json) {
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
        return null;
    }
    const out = {};
    const roster = mapEntries(json.roster, nameOnly);
    if (roster) {
        out.roster = roster;
    }
    out.riders = mapEntries(json.riders, r => {
        r = r && typeof r === 'object' ? r : {};
        return {name: r.name, pull_duration: r.pull_duration, order: r.order, color: r.color, weight: r.weight};
    });
    out.target_speed = json.target_speed;
    out.team = nameOnly(json.team);
    out.minimum_finishers = json.minimum_finishers;
    return JSON.parse(JSON.stringify(out));  // drops undefined fields
}


const html = (res, status, body) => send(res, status, 'text/html; charset=utf-8', body);


// Content-aware: the plan code only covers order/pull/watts, so names, colours, bench and team name
// are in the hash too. uploadedAt is left out so an identical re-upload stays a 304.
export function etagOf(rec) {
    const h = crypto.createHash('sha1').update(JSON.stringify({slug: rec.slug, team: rec.team, json: rec.json, text: rec.text}))
        .digest('hex').slice(0, 8);
    return `"${rec.sig}-${h}"`;
}


function sha(s) {
    return crypto.createHash('sha256').update(String(s)).digest();
}


export function createServer(options = {}) {
    const user = options.uploadUser ?? process.env.UPLOAD_USER;
    const pass = options.uploadPass ?? process.env.UPLOAD_PASS;
    if (!user || !pass) {
        throw new Error('UPLOAD_USER and UPLOAD_PASS must be set');
    }
    if (String(pass).startsWith('change-me')) {
        throw new Error('UPLOAD_PASS is still the placeholder from .env.example, choose your own');
    }
    const dataDir = options.dataDir ?? process.env.DATA_DIR ?? '/data';
    const store = makeStore(dataDir);
    const logs = makeLogStore(dataDir);
    const mbEnv = (name, dflt) => {
        const n = Number(process.env[name]);
        return (Number.isFinite(n) && n > 0 ? n : dflt) * MB;
    };
    const limits = {
        file: options.logMaxFileBytes ?? mbEnv('LOG_MAX_FILE_MB', 20),
        total: options.logMaxTotalBytes ?? mbEnv('LOG_MAX_TOTAL_MB', 2000),
    };
    const index = flash => indexPage(store, logs, limits, flash);
    const userHash = sha(user);
    const passHash = sha(pass);

    function authorized(req) {
        const m = /^Basic ([A-Za-z0-9+/=]+)$/.exec(req.headers.authorization || '');
        if (!m) {
            return false;
        }
        const given = Buffer.from(m[1], 'base64').toString('utf8');
        const i = given.indexOf(':');
        const u = sha(i < 0 ? given : given.slice(0, i));
        const p = sha(i < 0 ? '' : given.slice(i + 1));
        // equal-length digests, both compared always (no short circuit)
        const okU = crypto.timingSafeEqual(u, userHash);
        const okP = crypto.timingSafeEqual(p, passHash);
        return okU && okP && i >= 0;
    }

    // Browsers attach Basic credentials to cross-site form posts, so refuse those.
    function sameOrigin(req) {
        const site = req.headers['sec-fetch-site'];
        if (site !== undefined) {
            return site === 'same-origin' || site === 'none';
        }
        const origin = req.headers.origin;
        if (origin === undefined) {
            return true;  // curl and friends
        }
        try {
            return new URL(origin).host === req.headers.host;
        } catch (e) {
            return false;
        }
    }

    function apiHeaders(etag) {
        return {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'ETag',
            'Cache-Control': 'no-cache',
            'ETag': etag,
        };
    }

    function sendApi(req, res, rec) {
        if (!rec) {
            send(res, 404, 'application/json; charset=utf-8', '{"error":"not found"}', {'Access-Control-Allow-Origin': '*'});
            return;
        }
        rec = {...rec, json: stripPlanJson(rec.json)};  // plans stored before the strip are cleaned on the way out
        const etag = etagOf(rec);
        const headers = apiHeaders(etag);
        const inm = String(req.headers['if-none-match'] || '');
        if (inm.split(',').map(s => s.trim().replace(/^W\//, '')).some(t => t === etag || t === '*')) {
            res.writeHead(304, {'ETag': etag, 'Cache-Control': headers['Cache-Control'], 'Access-Control-Allow-Origin': '*',
                'Access-Control-Expose-Headers': 'ETag'});
            res.end();
            return;
        }
        res.writeHead(200, headers);
        res.end(JSON.stringify({...rec, etag}));
    }

    async function handleUpload(req, res) {
        let body;
        try {
            body = await readBody(req, MAX_BODY);
        } catch (e) {
            if (e instanceof HttpError) {
                res.setHeader('Connection', 'close');
                html(res, e.status, errorPage(e.message));
                return;
            }
            throw e;
        }
        try {
            const form = parseMultipart(body, req.headers['content-type']);
            const decode = b => b.toString('utf8').replace(/^﻿/, '');
            const texts = [form.json, form.text].filter(b => b && b.length).map(decode);
            let result;
            try {
                result = importFiles(texts);
            } catch (e) {
                if (e instanceof PlanError) {
                    const msg = {'no-json': STRINGS.noJson, 'not-a-plan': STRINGS.notAPlan, 'unreadable': STRINGS.unreadable}[e.code];
                    throw new HttpError(400, msg || STRINGS.unreadable);
                }
                throw e;
            }
            const typed = (form.team || Buffer.alloc(0)).toString('utf8').trim().replace(/\s+/g, ' ');
            const team = typed || result.plan.team;
            if (!team) {
                throw new HttpError(400, STRINGS.noTeam);
            }
            if (team.length > MAX_TEAM_NAME) {
                throw new HttpError(400, STRINGS.badForm);
            }
            const slug = slugify(team);
            if (!slug) {
                throw new HttpError(400, STRINGS.badTeam);
            }
            const rec = {
                team,
                slug,
                sig: result.plan.sig,
                json: stripPlanJson(result.json),
                text: result.text,
                uploadedAt: new Date().toISOString(),
            };
            store.put(rec);
            html(res, 200, resultPage({...rec, riders: result.plan.riders}, warningTexts(result.warnings, !!result.text)));
        } catch (e) {
            if (e instanceof HttpError) {
                html(res, e.status, errorPage(e.message));
                return;
            }
            throw e;
        }
    }

    async function handleDelete(req, res) {
        const body = await readBody(req, 4096);
        const slug = new URLSearchParams(body.toString('utf8')).get('slug') || '';
        const removed = store.remove(slug);
        html(res, removed ? 200 : 404, index(removed ? '<div class="ok">Plan deleted.</div>' : '<div class="err">No such plan.</div>'));
    }

    async function handleLogDelete(req, res) {
        const body = new URLSearchParams((await readBody(req, 4096)).toString('utf8'));
        const removed = logs.remove(body.get('slug') || '', body.get('file') || '');
        html(res, removed ? 200 : 404, index(removed ? '<div class="ok">Recording deleted.</div>' : '<div class="err">No such recording.</div>'));
    }

    function logJson(res, status, obj, extra) {
        send(res, status, 'application/json; charset=utf-8', JSON.stringify(obj), {'Access-Control-Allow-Origin': '*', ...extra});
    }

    // Open on purpose (every rider's mod posts here without a login), so the checks are strict: the
    // team must have a plan, the names are digits only, the body is gzip (never decompressed) and
    // capped per file and in total.
    async function handleLogUpload(req, res, url, slug) {
        const session = url.searchParams.get('session') || '';
        const athlete = url.searchParams.get('athlete') || '';
        // the file name rule is the parameter rule: both ids must come back unchanged from it
        const name = `${session}-${athlete}.jsonl.gz`;
        const m = LOG_FILE_RE.exec(name);
        // Answered before the body is read; node discards the unread body itself. No
        // `Connection: close` here: with it, clients sending ~1 MB or more lose the answer (EPIPE).
        if (!SLUG_RE.test(slug) || !m || m[1] !== session || m[2] !== athlete) {
            logJson(res, 400, {error: 'bad request'});
            return;
        }
        if (!store.get(slug)) {
            logJson(res, 404, {error: 'no plan for this team'});
            return;
        }
        let body;
        try {
            body = await readBody(req, limits.file);
        } catch (e) {
            if (e instanceof HttpError) {
                logJson(res, e.status, {error: 'too large'}, {Connection: 'close'});
                return;
            }
            throw e;
        }
        if (body.length < GZIP_MAGIC.length || !body.subarray(0, GZIP_MAGIC.length).equals(GZIP_MAGIC)) {
            logJson(res, 400, {error: 'bad request'});
            return;
        }
        // check and write run in one synchronous stretch, so two uploads cannot both pass the check
        if (logs.totalBytes() - logs.sizeOf(slug, name) + body.length > limits.total) {
            logJson(res, 507, {error: 'log storage full'});
            return;
        }
        logs.put(slug, name, body);
        logJson(res, 201, {ok: true, file: name});
    }

    function handleLogDownload(res, rawSlug, rawName) {
        let buf = null, slug = '', name = '';
        try {
            slug = decodeURIComponent(rawSlug);
            name = decodeURIComponent(rawName);
            buf = logs.get(slug, name);
        } catch (e) {
            // malformed escape: treated as absent
        }
        if (!buf) {
            send(res, 404, 'text/plain; charset=utf-8', 'not found');
            return;
        }
        send(res, 200, 'application/gzip', buf, {'Content-Disposition': `attachment; filename="paceline-${slug}-${name}"`});
    }

    async function route(req, res) {
        const url = new URL(req.url, 'http://localhost');
        const p = url.pathname;
        const method = req.method === 'HEAD' ? 'GET' : req.method;

        if (p === '/healthz' && method === 'GET') {
            send(res, 200, 'text/plain; charset=utf-8', 'ok');
            return;
        }
        if (p.startsWith('/api/plan/')) {
            if (method === 'OPTIONS') {
                res.writeHead(204, {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Access-Control-Allow-Headers': 'If-None-Match', 'Access-Control-Max-Age': '600'});
                res.end();
                return;
            }
            if (method !== 'GET') {
                send(res, 405, 'text/plain; charset=utf-8', 'method not allowed', {Allow: 'GET, OPTIONS'});
                return;
            }
            let rest;
            try {
                rest = decodeURIComponent(p.slice('/api/plan/'.length));
            } catch (e) {
                rest = '';
            }
            const by = /^by-athlete\/(\d{1,12})$/.exec(rest);
            if (by) {
                // A plan where the rider is in the line-up (riders) wins over one where they are only in
                // the team roster (bench), so a reserve entry in another team never hides the plan the
                // rider actually starts in; within each group the newest upload wins.
                const has = (o, id) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, id);
                const hits = store.list().map(r => ({r, starts: has(r.json && r.json.riders, by[1])}))
                    .filter(x => x.starts || has(x.r.json && x.r.json.roster, by[1]))
                    .sort((a, b) => (b.starts - a.starts) ||
                        String(b.r.uploadedAt).localeCompare(String(a.r.uploadedAt)));
                sendApi(req, res, hits[0] ? hits[0].r : null);
                return;
            }
            sendApi(req, res, store.get(slugify(rest)));
            return;
        }
        if (p.startsWith('/api/log/')) {
            if (method === 'OPTIONS') {
                res.writeHead(204, {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600'});
                res.end();
                return;
            }
            if (method !== 'POST') {
                send(res, 405, 'text/plain; charset=utf-8', 'method not allowed', {Allow: 'POST, OPTIONS'});
                return;
            }
            let slug;
            try {
                slug = decodeURIComponent(p.slice('/api/log/'.length));
            } catch (e) {
                slug = '';
            }
            await handleLogUpload(req, res, url, slug);
            return;
        }
        const logGet = method === 'GET' ? /^\/logs\/([^/]+)\/([^/]+)$/.exec(p) : null;
        if ((p === '/' && method === 'GET') || (p === '/upload' && method === 'POST') || (p === '/delete' && method === 'POST') ||
            (p === '/logs/delete' && method === 'POST') || logGet) {
            if (!authorized(req)) {
                res.setHeader('WWW-Authenticate', 'Basic realm="Paceline plan server", charset="UTF-8"');
                send(res, 401, 'text/plain; charset=utf-8', 'login required');
                return;
            }
            if (method === 'POST' && !sameOrigin(req)) {
                send(res, 403, 'text/plain; charset=utf-8', 'cross-site request refused');
                return;
            }
            if (p === '/') {
                html(res, 200, index());
            } else if (logGet) {
                handleLogDownload(res, logGet[1], logGet[2]);
            } else if (p === '/upload') {
                await handleUpload(req, res);
            } else if (p === '/logs/delete') {
                await handleLogDelete(req, res);
            } else {
                await handleDelete(req, res);
            }
            return;
        }
        send(res, 404, 'text/plain; charset=utf-8', 'not found');
    }

    const server = http.createServer((req, res) => {
        route(req, res).catch(e => {
            if (e instanceof ClientAbort) {
                console.warn(`request aborted by the client: ${req.method} ${String(req.url).split('?')[0]}`);
                res.destroy();
                return;
            }
            if (e instanceof HttpError) {
                if (!res.headersSent) {
                    res.setHeader('Connection', 'close');
                    html(res, e.status, errorPage(e.message));
                }
                return;
            }
            console.error('request failed:', e);
            if (!res.headersSent) {
                send(res, 500, 'text/plain; charset=utf-8', 'internal error');
            } else {
                res.end();
            }
        });
    });
    server.requestTimeout = 30000;
    server.headersTimeout = 15000;
    return server;
}


if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    let server;
    try {
        server = createServer();
    } catch (e) {
        console.error(`paceline-server: ${e.message}`);
        process.exit(1);
    }
    const port = Number(process.env.PORT || 8080);
    server.listen(port, () => console.log(`paceline-server listening on :${port}`));
    const stop = () => server.close(() => process.exit(0));
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
}
