// The operator's downloads of recordings (user, 20 Nov 2026), behind the /admin gate (admin.mjs):
// GET /admin/recordings?cid= lists an active club's recordings by team and race day (the club's time
// zone, as the captain's Recordings list on /manage/settings groups them), GET
// /admin/recordings/file?cid=&slug=&file= sends one stored .jsonl.gz as it is, and GET
// /admin/recordings/race?cid=&slug=&day=YYYY-MM-DD one uncompressed tar of the day's recordings of
// that team with the plans they name (plans/<SIG>.json, the plan server's stored form that the ride
// report's --plan reads), MISSING-PLANS.txt for codes the server no longer has, and README.txt with
// the ride report lines (tools/ride-report). Read only: nothing here writes.
//
// Only a recording in the index (logs.list) is served, by a path built from CID_RE, isSlug and
// LOG_NAME_RE-checked parts (logs.openFile). Never one the reconcile holds back for the erasure list
// (logs.isHeld), nor one that began before a removal not yet applied in full (a Remove a rider still
// running, or one that failed and runs again at the next start: erasures.pending), and none at all
// while erasures.jsonl cannot be read. Files are streamed, never read whole; each size comes from an
// fstat of the opened handle, and a file whose bytes differ from it aborts the answer. One log line
// per download, without rider names or Zwift IDs.
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {CID_RE, isSlug} from './ids.mjs';
import {LOG_NAME_RE} from './logs.mjs';
import {SEC_HEADERS, send, html} from './http.mjs';
import {esc, t, page} from './pages.mjs';
import {isDate, localDate, localDay, localHHMM} from './time.mjs';
import {nameOf} from './team-view.mjs';
import {riderNames} from './settings-page.mjs';

export const RECORDING_PATHS = new Set(['/admin/recordings', '/admin/recordings/file', '/admin/recordings/race']);
const CHUNK = 64 * 1024;
const BLOCK = 512;

const notFound = res => send(res, 404, 'text/plain; charset=utf-8', 'not found');
const para = (s, cls = null) => `<p${cls ? ` class="${cls}"` : ''}>${esc(s)}</p>`;
const back = () => `<p><a href="/admin">${esc(t('admin-back'))}</a></p>`;
const href = (p, params) => `${p}?${new URLSearchParams(params).toString()}`;
const kb = bytes => Math.ceil(bytes / 1024);
const errCode = e => e?.code ?? e?.name ?? 'error';
// '1 recording', '2 recordings'
const recordings = n => `${n} recording${n === 1 ? '' : 's'}`;


// ---- names ----

// A name as a file name part: ASCII letters and digits in lower case, runs of anything else one '-',
// at most `max` characters; '' when nothing is left.
export function asciiPart(s, max = 24) {
    return String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, max).replace(/-+$/, '');
}

// The rider in a file name: his name as the club knows it and his Zwift ID ('ben-1001'), or the ID.
const athleteLabel = (names, aid) => {
    const a = asciiPart(names.get(aid));
    return a ? `${a}-${aid}` : aid;
};


// ---- what may be served ----

// {broken, held(f)}: whether erasures.jsonl cannot be read (then nothing is served), and whether the
// recording f (a logs.list entry) is held back: the reconcile holds it, or it began before a removal
// of this club that is not applied in full yet (its rider may still be in it).
function holdOf(ctx, cid) {
    if (ctx.logs.erasuresBroken()) {
        return {broken: true, held: () => true};
    }
    const before = Math.max(-Infinity, ...ctx.erasures.pending().filter(e => e.cid === cid).map(e => Date.parse(e.at)));
    return {broken: false, held: f => f.session < before || ctx.logs.isHeld(cid, f.slug, f.file)};
}


// The version of team `slug` for plan code `sig`, in the plan server's stored form ({sig, json,
// text}): the club's versions of the team first, then its archived ones; a version whose current sig
// is the code before one stored with it (recSig), before one that had it before a rider was removed
// (pastSigs). null when none has it.
function planFor(club, logs, cid, slug, sig) {
    const versions = [...Object.values(club.sheets).filter(s => s?.team === slug), ...logs.archived(cid, slug)]
        .filter(v => v && typeof v === 'object' && (typeof v.json === 'string' || (v.json && typeof v.json === 'object')));
    for (const has of [v => v.sig === sig, v => v.recSig === sig, v => Array.isArray(v.pastSigs) && v.pastSigs.includes(sig)]) {
        const v = versions.find(has);
        if (v) {
            return {sig, json: v.json, text: v.text ?? null};
        }
    }
    return null;
}


// ---- the list ----

function listPage(res, ctx, club) {
    const cid = club.id;
    const files = ctx.logs.list(cid);
    const hold = holdOf(ctx, cid);
    const names = riderNames(club);
    const groups = new Map();
    for (const f of files) {
        const date = localDate(f.session, club.tz);
        const key = `${f.slug}/${date}`;
        if (!groups.has(key)) {
            groups.set(key, {slug: f.slug, date, title: t('admin-rec-group', {team: nameOf(club, f.slug), day: `${localDay(f.session, club.tz)} (${date})`}), files: []});
        }
        groups.get(key).files.push(f);
    }
    const notes = [para(t('admin-rec-intro', {tz: club.tz}))];
    if (hold.broken) {
        notes.push(para(t('admin-rec-broken'), 'warn'));
    } else {
        const n = files.filter(hold.held).length;
        if (n) {
            notes.push(para(t(n === 1 ? 'admin-rec-held-note-one' : 'admin-rec-held-note', {n}), 'warn'));
        }
    }
    const th = ['rider', 'started', 'size', 'file'].map(k => `<th${k === 'size' ? ' class="n"' : ''}>${esc(t(`admin-col-${k}`))}</th>`).join('');
    const sections = [...groups.values()].map(g => {
        const free = g.files.filter(f => !hold.held(f));
        const race = free.length
            ? `<p><a href="${esc(href('/admin/recordings/race', {cid, slug: g.slug, day: g.date}))}">${esc(t('admin-rec-race'))}</a> `
              + `(${esc(t('admin-rec-race-size', {n: free.length, kb: kb(free.reduce((s, f) => s + f.size, 0))}))})</p>`
            : '';
        const rows = g.files.map(f => {
            const cell = hold.held(f) ? esc(t('admin-rec-held'))
                : `<a href="${esc(href('/admin/recordings/file', {cid, slug: f.slug, file: f.file}))}">${esc(t('admin-rec-download'))}</a>`;
            return `<tr><td>${esc(names.get(f.athlete) ?? f.athlete)}</td><td>${esc(localHHMM(f.session, club.tz))}</td>`
                + `<td class="n">${esc(t('admin-size', {kb: kb(f.size)}))}</td><td>${cell}</td></tr>`;
        });
        return `<h3>${esc(g.title)}</h3>\n${race}<table><tr>${th}</tr>\n${rows.join('\n')}\n</table>`;
    });
    html(res, 200, page(t('admin-rec-heading', {club: club.name}), [
        ...notes,
        sections.length ? sections.join('\n') : para(t('admin-rec-none')),
        back(),
    ].join('\n')));
}


// ---- streaming ----

// The bytes of an opened file, `size` of them (its fstat); throws when the file holds more or fewer.
export async function* fileBytes(fh, size) {
    let pos = 0;
    for (;;) {
        const buf = Buffer.allocUnsafe(CHUNK);
        const {bytesRead} = await fh.read(buf, 0, CHUNK, pos);
        if (bytesRead === 0) {
            break;
        }
        pos += bytesRead;
        if (pos > size) {
            break;
        }
        yield buf.subarray(0, bytesRead);
    }
    if (pos !== size) {
        throw Object.assign(new Error('recording changed while it was sent'), {code: 'changed'});
    }
}


// One ustar header block: `dir` goes into the prefix field, `base` into the name field (ASCII).
export function tarHeader(dir, base, size, mtimeS) {
    if (Buffer.byteLength(base) > 100 || Buffer.byteLength(dir) > 155) {
        throw new TypeError('tar name too long');
    }
    const h = Buffer.alloc(BLOCK);
    const put = (s, at) => h.write(s, at, 'ascii');
    const octal = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0';
    put(base, 0);
    put('0000644\0', 100);
    put('0000000\0', 108);
    put('0000000\0', 116);
    put(octal(size, 12), 124);
    put(octal(Math.max(0, Math.floor(mtimeS)), 12), 136);
    put('        ', 148);
    put('0', 156);
    put('ustar\0', 257);
    put('00', 263);
    put(dir, 345);
    let sum = 0;
    for (const b of h) {
        sum += b;
    }
    put(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    return h;
}

const padOf = size => (BLOCK - (size % BLOCK)) % BLOCK;


// Sends `body` (an async iterable of Buffers, `length` bytes) as an attachment; HEAD gets the
// headers only. A failure after the headers (a file changed, the client gone) ends the connection.
async function sendFile(req, res, {type, filename, length, body, logLine}) {
    res.writeHead(200, {
        ...SEC_HEADERS, 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Length': String(length),
        'Content-Disposition': `attachment; filename="${filename}"`,
    });
    if (req.method === 'HEAD') {
        res.end();
        return;
    }
    console.log(`paceline-server: admin: ${logLine}`);
    try {
        await pipeline(Readable.from(body), res);
    } catch (e) {
        console.error(`paceline-server: admin: ${logLine} aborted: ${errCode(e)}`);
        res.destroy();
    }
}


// ---- the downloads ----

function fileRoute(req, res, ctx, club, q) {
    const cid = club.id;
    const slug = q.get('slug') ?? '';
    const name = q.get('file') ?? '';
    if (!isSlug(slug) || !LOG_NAME_RE.test(name)) {
        return notFound(res);
    }
    const f = ctx.logs.list(cid).find(r => r.slug === slug && r.file === name);
    if (!f) {
        return notFound(res);
    }
    const hold = holdOf(ctx, cid);
    if (hold.broken) {
        return send(res, 503, 'text/plain; charset=utf-8', t('admin-rec-broken'));
    }
    if (hold.held(f)) {
        return notFound(res);
    }
    return (async () => {
        const fh = await ctx.logs.openFile(cid, slug, name);
        if (!fh) {
            return notFound(res);
        }
        try {
            const {size} = await fh.stat();
            const day = localDate(f.session, club.tz);
            const hhmm = localHHMM(f.session, club.tz).replace(':', '');
            await sendFile(req, res, {
                type: 'application/gzip', length: size, body: fileBytes(fh, size),
                filename: `${slug}-${day}-${hhmm}-${athleteLabel(riderNames(club), f.athlete)}.jsonl.gz`,
                logLine: `download ${cid} ${slug} file (1 files, ${size} bytes)`,
            });
        } finally {
            await fh.close();
        }
    })();
}


async function raceRoute(req, res, ctx, club, q) {
    const cid = club.id;
    const slug = q.get('slug') ?? '';
    const day = q.get('day') ?? '';
    if (!isSlug(slug) || !isDate(day)) {
        return notFound(res);
    }
    const all = ctx.logs.list(cid).filter(r => r.slug === slug && localDate(r.session, club.tz) === day);
    if (!all.length) {
        return notFound(res);
    }
    const hold = holdOf(ctx, cid);
    if (hold.broken) {
        return send(res, 503, 'text/plain; charset=utf-8', t('admin-rec-broken'));
    }
    const names = riderNames(club);
    const dir = `${slug}-${day}`;
    const opened = [];
    try {
        // oldest first; each file opened before the headers, its size from its handle
        for (const f of all.filter(r => !hold.held(r)).sort((a, b) => a.session - b.session || (a.file < b.file ? -1 : 1))) {
            const fh = await ctx.logs.openFile(cid, slug, f.file);
            if (fh) {
                opened.push({f, fh, stat: null});
                opened.at(-1).stat = await fh.stat();
            }
        }
        if (!opened.length) {
            return notFound(res);
        }
        const used = new Set();
        const recs = opened.map(o => {
            let base = `${athleteLabel(names, o.f.athlete)}-${o.f.session}.jsonl.gz`;
            for (let k = 2; used.has(base); k++) {
                base = `${athleteLabel(names, o.f.athlete)}-${o.f.session}-${k}.jsonl.gz`;
            }
            used.add(base);
            return {...o, base, sigs: ctx.logs.sigsOf(cid, slug, o.f.file)};
        });
        const codes = [...new Set(recs.flatMap(r => r.sigs))].sort();
        const plans = new Map();
        const missing = [];
        for (const sig of codes) {
            const p = planFor(club, ctx.logs, cid, slug, sig);
            if (p) {
                plans.set(sig, Buffer.from(JSON.stringify(p) + '\n'));
            } else {
                missing.push(sig);
            }
        }
        const heldN = all.length - recs.length;
        const lines = [
            `Paceline recordings: ${nameOf(club, slug)} (${slug}), ${day} (${club.tz}), ${recordings(recs.length)}.`,
            '',
            'The ride report for each (tools/ride-report in the Paceline repository). Run in this folder,',
            'with PACELINE set to your Paceline checkout:',
            '',
            ...recs.map(r => ['node "$PACELINE/tools/ride-report/report.mjs"', r.base,
                ...r.sigs.filter(s => plans.has(s)).map(s => `--plan ${s}=plans/${s}.json`)].join(' ')),
            '',
            ...(missing.length ? [`Plan codes the server no longer has: see MISSING-PLANS.txt (${missing.length}).`] : []),
            ...(heldN ? [`${recordings(heldN)} of this day held back until checked against the erasure list (see /admin and the server log).`, ''] : []),
            'These files hold riders\' data: delete this folder once the analysis is done. The server\'s retention and Remove a rider do not reach these copies.',
        ];
        const now = ctx.now / 1000;
        const entries = [
            {base: 'README.txt', dir, data: Buffer.from(lines.join('\n').trimEnd() + '\n'), mtime: now},
            ...recs.map(r => ({base: r.base, dir, fh: r.fh, size: r.stat.size, mtime: r.stat.mtimeMs / 1000})),
            ...[...plans].map(([sig, data]) => ({base: `${sig}.json`, dir: `${dir}/plans`, data, mtime: now})),
            ...(missing.length ? [{base: 'MISSING-PLANS.txt', dir, mtime: now, data: Buffer.from(
                'Plan codes these recordings name that no version of the team and no archived version holds any more.\n'
                + 'The ride report skips the seconds under them.\n\n' + missing.join('\n') + '\n')}] : []),
        ].map(e => ({...e, size: e.data ? e.data.length : e.size}));
        const length = entries.reduce((s, e) => s + BLOCK + e.size + padOf(e.size), 0) + 2 * BLOCK;
        async function* body() {
            for (const e of entries) {
                yield tarHeader(e.dir, e.base, e.size, e.mtime);
                if (e.data) {
                    yield e.data;
                } else {
                    yield* fileBytes(e.fh, e.size);
                }
                if (padOf(e.size)) {
                    yield Buffer.alloc(padOf(e.size));
                }
            }
            yield Buffer.alloc(2 * BLOCK);
        }
        await sendFile(req, res, {
            type: 'application/x-tar', length, body: body(), filename: `${dir}.tar`,
            logLine: `download ${cid} ${slug} ${day} (${recs.length} files, ${length} bytes)`,
        });
    } finally {
        await Promise.all(opened.map(o => o.fh.close()));
    }
}


// GET (HEAD as GET) of one of RECORDING_PATHS, after the admin gate. An unknown or invalid cid, or
// a club that is not active: 404.
export async function handleRecordings(req, res, ctx, p) {
    const q = new URL(req.url, 'http://localhost').searchParams;
    const cid = q.get('cid') ?? '';
    const club = CID_RE.test(cid) ? ctx.store.get(cid) : null;
    if (!club) {
        if (p === '/admin/recordings') {
            html(res, 404, page(t('admin-heading'), `${para(t('admin-not-found'), 'err')}\n${back()}`));
        } else {
            notFound(res);
        }
        return;
    }
    if (p === '/admin/recordings') {
        listPage(res, ctx, club);
    } else if (p === '/admin/recordings/file') {
        await fileRoute(req, res, ctx, club, q);
    } else {
        await raceRoute(req, res, ctx, club, q);
    }
}
