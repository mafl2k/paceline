// The plan check every 0.3 mod calls (spec §6.1): GET /api/v3/rider/<zwiftId>. It answers the
// rider's clubs, at most one plan per joined club, hints and a notice, and records `seen` and the
// learned event id as the 30-minute gate allows (spec §3).
//
// Rider codes arrive only in the X-Paceline-Codes header. They are never logged, never stored and
// never echoed unless they work; only their hashes are compared.
import crypto from 'node:crypto';
import {json, send, etagMatches, SEC_HEADERS} from './http.mjs';
import {normalizePlan} from '../pages/src/engine/plan.mjs';
import {CID_RE, ZWIFT_RE, SIG_RE, MOD_RE, isEventId, compareModVersion, normalizeRiderCode, riderCodeHash} from './ids.mjs';
import {PLAN_OPEN_MS, planOpen, pickForRider, servable, roleIn} from './select.mjs';
import {isPrivate, learnEvent} from './club.mjs';
import {clientIp, isPublicIp} from './limits.mjs';

export const CODE_HEADER = 'x-paceline-codes';
export const MAX_CODES = 10;
export const CODE_FAILS_MAX = 20;            // wrong codes per public address and hour
const CODE_FAILS_MS = 3600000;
const MAX_JOINED = 10;
const MAX_UNJOINED = 10;
const START_RANGE_MS = 86400000;            // `start` at most a day from now

const CORS = {'Access-Control-Allow-Origin': '*'};
const iso = ms => new Date(ms).toISOString();


// The header's codes as read (spec §3): the first MAX_CODES comma-separated entries, each
// normalized; malformed entries and duplicates are dropped. Besides the spaces and hyphens that
// normalizeRiderCode ignores, any white space (tab, NBSP) and the Unicode dashes count as nothing.
export function readCodes(value) {
    if (typeof value !== 'string' || !value) {
        return [];
    }
    const out = [];
    for (const entry of value.split(',').slice(0, MAX_CODES)) {
        const code = normalizeRiderCode(entry.replace(/[\s‐-―−]/g, ''));
        if (code !== null && !out.includes(code)) {
            out.push(code);
        }
    }
    return out;
}


// The content etag the mod compares: "<sig>-<8 hex>" over the club id, slug, sheet id, label,
// JSON and text; uploadedAt stays out, so an identical re-upload keeps it.
export function sheetEtag(cid, slug, id, sheet) {
    const h = crypto.createHash('sha1')
        .update(JSON.stringify({c: cid, slug, id, label: sheet.label, json: sheet.json, text: sheet.text}))
        .digest('hex').slice(0, 8);
    return `"${sheet.sig}-${h}"`;
}


// One plan record. Without its body it carries only the metadata (spec §6.1): no etag and no
// eventId, so it can never pass for a plan the mod holds.
export function planRecord(club, pick, {body}) {
    const {sheet, S} = pick;
    const head = {
        circle: {id: club.id, name: club.name}, team: club.teams[pick.slug].name, slug: pick.slug, sheet: pick.id,
        label: sheet.label, role: pick.role, date: sheet.date, startAt: iso(S), opensAt: iso(S - PLAN_OPEN_MS),
    };
    if (!body) {
        return {...head, uploadedAt: sheet.uploadedAt, sig: sheet.sig, body: false};
    }
    return {
        ...head, eventId: sheet.pinnedEventId ?? sheet.eventId, uploadedAt: sheet.uploadedAt, sig: sheet.sig,
        etag: sheetEtag(club.id, pick.slug, pick.id, sheet), body: true, json: sheet.json, text: sheet.text,
    };
}


// True when one of the club's live, unused sheets lists the Zwift ID (rider or bench).
function lists(club, zwiftId, now) {
    return servable(club, now).some(c => roleIn(c.sheet, zwiftId) !== null);
}


const byAge = (a, b) => ((Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0)) || (a.id < b.id ? -1 : 1);


// The query, checked (spec §6.1). Null when the request is bad.
function readQuery(zwiftId, query, now) {
    if (!ZWIFT_RE.test(zwiftId)) {
        return null;
    }
    const mod = query.get('mod');
    if (mod === null || !MOD_RE.test(mod)) {
        return null;
    }
    const startRaw = query.get('start');
    const eventRaw = query.get('event');
    if ((startRaw === null) !== (eventRaw === null)) {
        return null;
    }
    let start = null, event = null;
    if (startRaw !== null) {
        start = /^\d{1,15}$/.test(startRaw) ? Number(startRaw) : NaN;
        if (!(Math.abs(start - now) <= START_RANGE_MS) || !isEventId(eventRaw)) {
            return null;
        }
        event = Number(eventRaw);
    }
    const joined = [];
    for (const cid of String(query.get('joined') ?? '').split(',')) {
        if (joined.length < MAX_JOINED && CID_RE.test(cid) && !joined.includes(cid)) {
            joined.push(cid);
        }
    }
    const sigRaw = query.get('sig');
    return {mod, start, event, joined, sig: sigRaw !== null && SIG_RE.test(sigRaw) ? sigRaw : null};
}


// GET /api/v3/rider/<zwiftId>. `codeFails` is the server's makeLimiter for wrong codes.
export function handleRider(req, res, {store, cfg, now, codeFails}, zwiftId, query) {
    const q = readQuery(zwiftId, query, now);
    if (!q) {
        json(res, 400, {error: 'bad request'}, CORS);
        return;
    }
    const inEvent = q.start !== null;

    // Codes: throttled per public address before any lookup.
    // Without CODE_SECRET private clubs are off: codes are ignored (no lookup, no failure counted).
    const codes = cfg.codeSecret ? readCodes(req.headers[CODE_HEADER]) : [];
    const byCode = new Map();   // cid -> the code as read
    if (codes.length) {
        const ip = clientIp(req, cfg.trustedProxyHops);
        const counted = isPublicIp(ip);
        if (counted && codeFails.count(ip, now, CODE_FAILS_MS) >= CODE_FAILS_MAX) {
            json(res, 429, {error: 'busy'}, {...CORS, 'Retry-After': '3600'});
            return;
        }
        for (const code of codes) {
            const cid = store.codeOwner(riderCodeHash(code, cfg.codeSecret));
            if (cid !== null && store.get(cid)) {
                byCode.set(cid, code);
            } else if (counted) {
                codeFails.add(ip, now);
            }
        }
    }
    const visible = c => !isPrivate(c) || byCode.has(c.id);
    const joinedSet = new Set(q.joined);

    // Visible clubs: the joined ones, those found by a code, and up to 10 unjoined open clubs
    // whose live, unused sheet lists the rider (oldest first).
    const shown = new Map();    // cid -> club
    const needed = [];
    const gone = [];
    for (const cid of q.joined) {
        const c = store.get(cid);
        if (c) {
            if (visible(c)) {
                shown.set(cid, c);
            } else {
                needed.push(cid);
            }
        } else if (store.gone(cid)) {
            gone.push(cid);
        }
    }
    for (const cid of byCode.keys()) {
        shown.set(cid, store.get(cid));
    }
    const listing = [...new Set(store.listedIn(zwiftId).map(x => x.cid))]
        .map(cid => store.get(cid))
        .filter(c => c && !isPrivate(c) && !joinedSet.has(c.id) && lists(c, zwiftId, now))
        .sort(byAge)
        .slice(0, MAX_UNJOINED);
    for (const c of listing) {
        shown.set(c.id, c);
    }

    const circles = [];
    for (const c of [...shown.values()].sort(byAge)) {
        const entry = {id: c.id, name: c.name, lists: lists(c, zwiftId, now)};
        circles.push(byCode.has(c.id) ? {...entry, private: true, code: byCode.get(c.id)} : entry);
    }
    for (const cid of needed) {
        circles.push({id: cid, code: 'needed'});
    }
    for (const cid of gone) {
        circles.push({id: cid, gone: true});
    }

    const eventPick = c => pickForRider(c, zwiftId, inEvent ? {now, E: q.start, eventId: q.event} : {now});

    // Plans, event learning and seen: joined visible clubs only.
    const plans = [];
    for (const cid of q.joined) {
        if (!shown.has(cid)) {
            continue;
        }
        let c = shown.get(cid);
        let pick = eventPick(c);
        const body = inEvent && pick !== null && planOpen(pick.S, now);
        // Only a rider listing may bind the event id; a bench listing never does.
        if (body && pick.role === 'rider' && pick.sheet.eventId == null && pick.sheet.pinnedEventId == null) {
            try {
                store.change(cid, d => learnEvent(d, pick.id, q.event, now));
                c = store.get(cid);
                pick = {...pick, sheet: c.sheets[pick.id]};
            } catch (e) {
                console.error(`paceline-server: learning the event of club ${cid} failed: ${e.message}`);
            }
        }
        if (pick) {
            plans.push(planRecord(c, pick, {body}));
        }
        const ref = pick ?? pickForRider(c, zwiftId, {now});
        const open = inEvent && planOpen(ref?.S, now);
        store.see(cid, zwiftId, {
            sig: q.sig, mod: q.mod, sheet: ref?.id ?? null, inEvent: open, event: open ? q.event : null,
        });
    }

    // Hints: unjoined visible clubs with a plan matching this event, only from inside one.
    const hint = [];
    if (inEvent) {
        for (const c of [...shown.values()].sort(byAge)) {
            if (joinedSet.has(c.id)) {
                continue;
            }
            const pick = eventPick(c);
            if (pick) {
                const body = planOpen(pick.S, now);
                hint.push({
                    id: c.id, name: c.name, riders: body ? Object.keys(pick.sheet.json?.riders || {}) : [],
                    uploadedAt: pick.sheet.uploadedAt, body,
                });
            }
        }
    }

    const min = cfg.modMinVersion;
    const notice = min && compareModVersion(q.mod, min) < 0 ? cfg.modNotice.replaceAll('{min}', min) : null;
    json(res, 200, {circles, plans, hint, notice}, CORS);
}


// ---- old endpoints for 0.2.x mods (spec §6.3: hard cut, the notice only) ----

// The one record every `GET /api/plan/<anything>` answers. A 0.2.x mod shows its team and rider
// names, so the rider's name carries the message. The etag is constant per host.
export function noticeRecord(publicHost) {
    const host = publicHost || 'the plan server';
    const planJson = {
        team: {name: 'Update Paceline'},
        riders: {0: {name: `Update Paceline from ${host}`, order: 1, pull_duration: 60, color: '#ffffff'}},
    };
    const {sig} = normalizePlan(planJson, null).plan;
    const h = crypto.createHash('sha1').update(JSON.stringify(planJson)).digest('hex').slice(0, 8);
    return {
        team: 'Update Paceline', slug: 'update-paceline', sig, json: planJson, text: null,
        uploadedAt: '2026-11-15T00:00:00.000Z', etag: `"${sig}-${h}"`, notice: true,
    };
}


const OLD_HEADERS = {
    'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'ETag', 'Cache-Control': 'no-cache',
};


// GET /api/plan/<anything>: the notice record in the v1 way, with its ETag and a 304 on a matching
// If-None-Match (weak tags and `*` count). Nothing is recorded in `seen`.
export function handleOldPlan(req, res, {cfg}) {
    const rec = noticeRecord(cfg.publicHost);
    if (etagMatches(req, rec.etag)) {
        res.writeHead(304, {...SEC_HEADERS, ...OLD_HEADERS, ETag: rec.etag});
        res.end();
        return;
    }
    send(res, 200, 'application/json; charset=utf-8', JSON.stringify(rec), {...OLD_HEADERS, ETag: rec.etag});
}
