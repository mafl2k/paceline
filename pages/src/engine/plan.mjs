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


export function detectFileKind(text) {
    if (parseJsonObject(text)) {
        return 'json';
    }
    return lines(text).some(l => dataRowFields(l)) ? 'text' : 'unknown';
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


function normHex(h) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(h ?? '').trim());
    return m ? '#' + m[1].toLowerCase() : null;
}


export function normalizePlan(json, textRows) {
    const ridersRaw = json && typeof json === 'object' ? json.riders : null;
    if (!ridersRaw || typeof ridersRaw !== 'object' || !Object.keys(ridersRaw).length) {
        throw new PlanError('not-a-plan', 'No riders found in the plan');
    }
    const warnings = [];
    const unused = Array.isArray(textRows) ? textRows.slice() : [];
    const riders = Object.entries(ridersRaw).map(([id, r], idx) => {
        r = r || {};
        const name = displayName(r.name);
        const key = normName(name);
        const at = unused.findIndex(t => normName(t.name) === key);
        const row = at >= 0 ? unused.splice(at, 1)[0] : null;
        const pullS = num(r.pull_duration);
        if (row && row.pullS !== pullS) {
            warnings.push({code: 'pull-mismatch', id, name});
        }
        const color = normHex(r.color) || (row && normHex(row.colorHex)) || '#ffffff';
        return {
            id: String(id),
            name,
            order: num(r.order, idx),
            pullS,
            watts: row ? row.pullWatts : null,
            color,
            colorName: row && row.colorName ? row.colorName : colorNameFor(color),
            weight: num(r.weight),
            ftp: num(r.ftp),
            adjustment: num(r.adjustment, 100),
        };
    });
    riders.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const t of unused) {
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


export function importFiles(texts) {
    const kinds = texts.map(detectFileKind);
    if (kinds.includes('unknown')) {
        throw new PlanError('unreadable', 'A file is neither a planner JSON nor a text export');
    }
    const ji = kinds.indexOf('json');
    if (ji < 0) {
        throw new PlanError('no-json', 'The planner JSON file is required');
    }
    const json = JSON.parse(texts[ji]);
    const ti = kinds.indexOf('text');
    const text = ti >= 0 ? parseTextExport(texts[ti]) : null;
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
