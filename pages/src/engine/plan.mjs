// Pure logic (no DOM, no Sauce imports): import a zwiftgopher TTT planner export
// (JSON, plus the optional text export with pull watts) and derive a short plan code.
import {colorNameFor} from './colors.mjs';


export class PlanError extends Error {
    constructor(code, message) {
        super(message || code);
        this.name = 'PlanError';
        this.code = code;
    }
}


const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';


export function decodeEntities(s) {
    return String(s ?? '').replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(amp|lt|gt|quot));/g, (m, dec, hex, named) => {
        if (named) {
            return {amp: '&', lt: '<', gt: '>', quot: '"'}[named];
        }
        const cp = dec !== undefined ? parseInt(dec, 10) : parseInt(hex, 16);
        return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    });
}


export function normName(s) {
    return decodeEntities(s).trim().replace(/\s+/g, ' ').toLowerCase();
}


function displayName(s) {
    return decodeEntities(s).trim();
}


function isNum(s) {
    return s !== '' && Number.isFinite(Number(s));
}


function splitFields(line, delim) {
    return line.split(delim).map(f => f.trim());
}


const DELIMS = ['\t', '|', ','];


function lines(text) {
    return String(text ?? '').split(/\r?\n/).filter(l => l.trim() !== '');
}


function parseJsonObject(text) {
    try {
        const v = JSON.parse(text);
        return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    } catch (e) {
        return null;
    }
}


function dataRowFields(line) {
    for (const d of DELIMS) {
        const f = splitFields(line, d);
        if (f.length === 5 && isNum(f[1]) && isNum(f[2])) {
            return f;
        }
    }
    return null;
}


// A loaded file as importSources reads it: its text, and the JSON object it holds (null when it is
// no JSON object). Parsing once here lets a caller check the parsed file before the import without
// a second parse (the server reads uploads).
export function readSource(text) {
    return {text, json: parseJsonObject(text)};
}


function kindOf(source) {
    if (source.json) {
        return 'json';
    }
    return lines(source.text).some(l => dataRowFields(l)) ? 'text' : 'unknown';
}


export function detectFileKind(text) {
    return kindOf(readSource(text));
}


export function parseTextExport(text) {
    const ls = lines(text);
    if (!ls.length) {
        return [];
    }
    const delim = DELIMS.find(d => ls[0].split(d).length === 5);
    if (delim === undefined) {
        return [];
    }
    const out = [];
    ls.forEach((l, i) => {
        const f = splitFields(l, delim);
        if (f.length !== 5) {
            return;
        }
        if (i === 0 && !isNum(f[1])) {
            return;  // header
        }
        if (!isNum(f[1]) || !isNum(f[2])) {
            return;
        }
        out.push({name: f[0], pullWatts: Number(f[1]), pullS: Number(f[2]), colorName: f[3], colorHex: f[4]});
    });
    return out;
}


function num(v, fallback=0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}


// A planner number (pull_power, pull_wkg): a finite number, or a non-blank numeric string of at
// most RAW_SHORT_MAX characters (the longest stripSheet keeps); else null.
function planNumber(v) {
    if (typeof v === 'number') {
        return Number.isFinite(v) ? v : null;
    }
    if (typeof v === 'string' && v.trim() !== '' && v.length <= RAW_SHORT_MAX) {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}


function normHex(h) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(h ?? '').trim());
    return m ? '#' + m[1].toLowerCase() : null;
}


// Text rows by normalized name, each row taken at most once: take(key) gives the first row not yet
// taken with that key (in file order) or null, rest() the rows never taken, in file order. Linear in
// the rows, so a long text export cannot make the matching quadratic (the server reads uploads).
function rowMatcher(rows) {
    const byKey = new Map();
    rows.forEach((t, i) => {
        const key = normName(t.name);
        const q = byKey.get(key);
        if (q) {
            q.list.push(i);
        } else {
            byKey.set(key, {list: [i], next: 0});
        }
    });
    const taken = new Set();
    return {
        take(key) {
            const q = byKey.get(key);
            if (!q || q.next >= q.list.length) {
                return null;
            }
            const i = q.list[q.next++];
            taken.add(i);
            return rows[i];
        },
        rest: () => rows.filter((_, i) => !taken.has(i)),
    };
}


// Every field read here must also be kept by stripSheet below (the server stores only that),
// except the ones it drops on purpose: a rider's ftp and adjustment. A rider's watts come from his
// pull_power (by Zwift ID, rounded to whole watts) when it is there, else from his text row (by
// name), else none; with both, the JSON wins and a differing text row warns (spec §7.8: matching
// by name fails for two riders with one name). His wkg is pull_wkg as written (> 0, else null):
// only the W/kg figures read it, never watts or the plan code.
export function normalizePlan(json, textRows) {
    const ridersRaw = json && typeof json === 'object' ? json.riders : null;
    if (!ridersRaw || typeof ridersRaw !== 'object' || !Object.keys(ridersRaw).length) {
        throw new PlanError('not-a-plan', 'No riders found in the plan');
    }
    const warnings = [];
    const rows = rowMatcher(Array.isArray(textRows) ? textRows : []);
    const riders = Object.entries(ridersRaw).map(([id, r], idx) => {
        r = r || {};
        const name = displayName(r.name);
        const row = rows.take(normName(name));
        const pullS = num(r.pull_duration);
        if (row && row.pullS !== pullS) {
            warnings.push({code: 'pull-mismatch', id, name});
        }
        const power = planNumber(r.pull_power);
        const watts = power !== null ? Math.round(power) : row ? row.pullWatts : null;
        if (power !== null && row && row.pullWatts !== watts) {
            warnings.push({code: 'watts-mismatch', id, name});
        }
        const pullWkg = planNumber(r.pull_wkg);
        const color = normHex(r.color) || (row && normHex(row.colorHex)) || '#ffffff';
        return {
            id: String(id),
            name,
            order: num(r.order, idx),
            pullS,
            watts,
            wkg: pullWkg !== null && pullWkg > 0 ? pullWkg : null,
            color,
            colorName: row && row.colorName ? row.colorName : colorNameFor(color),
            weight: num(r.weight),
            ftp: num(r.ftp),
            adjustment: num(r.adjustment, 100),
        };
    });
    riders.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const t of rows.rest()) {
        warnings.push({code: 'unmatched-text-row', name: t.name});
    }
    const bench = Object.entries(json.roster && typeof json.roster === 'object' ? json.roster : {})
        .filter(([id]) => !Object.prototype.hasOwnProperty.call(ridersRaw, id))
        .map(([id, r]) => ({id: String(id), name: displayName(r && r.name)}));
    const plan = {
        sig: '',
        team: displayName(json.team && json.team.name),
        targetSpeed: num(json.target_speed),
        minimumFinishers: num(json.minimum_finishers),
        riders,
        bench,
    };
    plan.sig = planSig(plan);
    return {plan, warnings};
}


// The sheet as the server stores and serves it: only what normalizePlan reads, the riders'
// pull_power and pull_wkg included (normalizePlan reads both). A rider's weight, pull_power and
// pull_wkg stay (user, 16 Nov 2026: the mod shows other riders' targets in W/kg, pull_wkg being
// the value on the plan images the captain reads out, and the planner's pull watts are kept);
// height, FTP and the rest of the planner export go. Returns {json, text}; the input is not changed.
// text holds the rows normalizePlan would match to a rider (null when none do).
// Only typed scalars are kept; a value of another type or shape (an array, an object, a huge
// numeric string) is dropped, so a stored sheet's memory is bounded by its counts and bytes.
// Numbers may come as numeric strings (the planner writes target_speed as "42.6"); normalizePlan
// reads both through num(). Colours are kept when normHex reads them.
// Strings are limited by their RAW length (before trimming and entity decoding), so white space
// or zero-padded entities cannot carry more than these: a name may still hold entities such as
// &amp; (4 × the 100 characters a name may show). An over-long value is dropped like a bad type;
// the server refuses an upload with an over-long rider or bench name instead (club.mjs).
export const RAW_NAME_MAX = 400;
export const RAW_TEAM_NAME_MAX = 240;
export const RAW_SHORT_MAX = 32;          // numeric strings, colours, colour names
const isNumber = v => (typeof v === 'number' && Number.isFinite(v)) ||
    (typeof v === 'string' && v.length <= RAW_SHORT_MAX && Number.isFinite(Number(v)));
const isName = v => typeof v === 'string' && v.length <= RAW_NAME_MAX;
const isShort = v => typeof v === 'string' && v.length <= RAW_SHORT_MAX;
const isHex = v => isShort(v) && normHex(v) !== null;
// A rider or bench entry is kept only under a Zwift ID key (the server's ZWIFT_RE).
const ZWIFT_ID_RE = /^\d{1,12}$/;
const RIDER_FIELDS = {name: isName, order: isNumber, pull_duration: isNumber, color: isHex, weight: isNumber, pull_power: isNumber, pull_wkg: isNumber};
const ROSTER_FIELDS = {name: isName};
const TEXT_FIELDS = {name: isName, pullWatts: isNumber, pullS: isNumber, colorName: isShort, colorHex: isHex};

export function stripSheet(json, textRows) {
    const has = (o, k) => o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
    const pick = (o, fields) => {
        const out = {};
        for (const [k, ok] of Object.entries(fields)) {
            if (has(o, k) && ok(o[k])) {
                out[k] = o[k];
            }
        }
        return out;
    };
    const out = {};
    if (json && json.team && typeof json.team.name === 'string' && json.team.name.length <= RAW_TEAM_NAME_MAX) {
        out.team = {name: json.team.name};
    }
    for (const k of ['target_speed', 'minimum_finishers']) {
        if (has(json, k) && isNumber(json[k])) {
            out[k] = json[k];
        }
    }
    const ridersRaw = json && typeof json.riders === 'object' && json.riders ? json.riders : null;
    const rows = rowMatcher(Array.isArray(textRows) ? textRows.filter(t => has(t, 'name') && isName(t.name)) : []);
    const text = [];
    if (ridersRaw) {
        out.riders = {};
        for (const [id, r] of Object.entries(ridersRaw)) {
            if (!ZWIFT_ID_RE.test(id)) {
                continue;
            }
            const kept = pick(r, RIDER_FIELDS);
            out.riders[id] = kept;
            // Matched by the name as stored, the one normalizePlan will see.
            const t = rows.take(normName(displayName(kept.name)));
            if (t) {
                text.push(pick(t, TEXT_FIELDS));
            }
        }
    }
    if (json && json.roster && typeof json.roster === 'object') {
        out.roster = {};
        for (const [id, r] of Object.entries(json.roster)) {
            if (!ZWIFT_ID_RE.test(id)) {
                continue;
            }
            out.roster[id] = pick(r, ROSTER_FIELDS);
        }
    }
    return {json: out, text: text.length ? text : null};
}


export function importFiles(texts) {
    return importSources(texts.map(readSource));
}


// importFiles for files readSource has read already: each JSON is parsed only once. The returned
// `json` is the source's own parsed object.
export function importSources(sources) {
    const kinds = sources.map(kindOf);
    if (kinds.includes('unknown')) {
        throw new PlanError('unreadable', 'A file is neither a planner JSON nor a text export');
    }
    const ji = kinds.indexOf('json');
    if (ji < 0) {
        throw new PlanError('no-json', 'The planner JSON file is required');
    }
    const json = sources[ji].json;
    const ti = kinds.indexOf('text');
    const text = ti >= 0 ? parseTextExport(sources[ti].text) : null;
    const {plan, warnings} = normalizePlan(json, text);
    return {plan, warnings, json, text};
}


// Short code riders can compare by voice to confirm they hold the same plan:
// FNV-1a 32 bit over the UTF-16 code units of the canonical string, low 30 bits as 6 Crockford
// base32 chars.
export function planSig(plan) {
    const canon = plan.riders.slice()
        .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map(r => `${r.id}|${r.order}|${r.pullS}|${r.watts ?? ''}`)
        .join(';');
    let h = 0x811c9dc5;
    for (let i = 0; i < canon.length; i++) {
        h ^= canon.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    let n = h & 0x3fffffff;
    let out = '';
    for (let i = 0; i < 6; i++) {
        out = CROCKFORD[n & 31] + out;
        n >>>= 5;
    }
    return out;
}


export function findMe(plan, athleteId) {
    if (athleteId === null || athleteId === undefined || athleteId === '') {
        return {role: 'none'};
    }
    const id = String(athleteId);
    const i = plan.riders.findIndex(r => r.id === id);
    if (i >= 0) {
        return {role: 'rider', rider: plan.riders[i], position: i + 1};
    }
    if (plan.bench.some(b => b.id === id)) {
        return {role: 'bench'};
    }
    return {role: 'none'};
}
