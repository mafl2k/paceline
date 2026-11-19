// Plan helpers (plan versions spec §3, §4): a plan is the versions of one club.sheets record
// family that share `sheet.plan`. Pure: no files, no clock (it is always passed in), no network.
import {SHEET_RE} from './ids.mjs';
import {localDate} from './time.mjs';
import {plannedStart, usedUp} from './select.mjs';

export const SHARED_SHARE = 0.6;          // teamHint: this share of the upload's riders
const TYPES_MAX = 10;                     // team.types keeps this many suggestions


// Used up: 4 h after S. A team without a start time has no S; its sheets count as used up once
// their date has passed in the club's zone.
export function isUsed(club, sheet, now) {
    const S = plannedStart(club, sheet);
    return S !== null ? usedUp(S, now) : sheet.date < localDate(now, club.tz);
}


const atMs = sheet => Date.parse(sheet.at) || 0;


// The plans of team `slug`, one per distinct `sheet.plan`, in no particular order.
export function plansOf(club, slug) {
    const team = Object.hasOwn(club.teams, slug) ? club.teams[slug] : null;
    const byPlan = new Map();
    for (const entry of Object.entries(club.sheets)) {
        const [, sheet] = entry;
        if (sheet.team !== slug) {
            continue;
        }
        if (!byPlan.has(sheet.plan)) {
            byPlan.set(sheet.plan, []);
        }
        byPlan.get(sheet.plan).push(entry);
    }
    const plans = [];
    for (const [id, versions] of byPlan) {
        versions.sort(([, a], [, b]) => a.n - b.n);
        const newest = versions[versions.length - 1];
        const live = team && typeof team.live === 'string' && versions.some(([vid]) => vid === team.live)
            ? team.live : null;
        plans.push({
            id, team: slug, date: newest[1].date, type: newest[1].type ?? null, label: newest[1].label,
            versions, newest, live,
        });
    }
    return plans;
}


// How a plan reads: the team's name, plus " · type" when it has one.
export function planLabel(teamName, type) {
    return type === null ? teamName : `${teamName} · ${type}`;
}


// Types are told apart by this key: trimmed, spaces collapsed, lower case; empty for none.
export function typeKey(type) {
    return String(type ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}


// Puts `type` first in the team's suggestions (most recent first, distinct by typeKey, at most 10).
export function rememberType(team, type) {
    if (type === null) {
        return;
    }
    const key = typeKey(type);
    const rest = (Array.isArray(team.types) ? team.types : [])
        .filter(t => typeof t === 'string' && typeKey(t) !== key);
    team.types = [type, ...rest].slice(0, TYPES_MAX);
}


// The assign page's type suggestions.
export function teamTypes(club, slug) {
    const team = Object.hasOwn(club.teams, slug) ? club.teams[slug] : null;
    return team && Array.isArray(team.types) && team.types.every(t => typeof t === 'string') ? team.types : [];
}


// The plans of the team whose newest version is not used up: the live plan first, then the
// newest first.
export function racePlans(club, slug, now) {
    return plansOf(club, slug)
        .filter(p => !isUsed(club, p.newest[1], now))
        .sort((a, b) => (b.live !== null) - (a.live !== null) || atMs(b.newest[1]) - atMs(a.newest[1]));
}


// The plan of team `slug` whose id is `id`, or that holds a version with that id.
export function planOfId(club, slug, id) {
    return plansOf(club, slug).find(p => p.id === id || p.versions.some(([vid]) => vid === id)) ?? null;
}


// Within the plan of version `id`: the stored version with the highest n below its own.
export function previousVersion(club, id) {
    if (!Object.hasOwn(club.sheets, id)) {
        return null;
    }
    const own = club.sheets[id];
    let best = null;
    for (const entry of Object.entries(club.sheets)) {
        const [, s] = entry;
        if (s.team === own.team && s.plan === own.plan && s.n < own.n && (best === null || s.n > best[1].n)) {
            best = entry;
        }
    }
    return best;
}


// The planner names of the plan's versions. Labels and types do not count (decision 10).
export function planNames(plan) {
    const names = new Set();
    for (const [, s] of plan.versions) {
        if (s.jsonName !== null && s.jsonName !== undefined) {
            names.add(s.jsonName);
        }
    }
    return names;
}


// How many of the version's riders (not the bench) are in `riderIds`.
export function ridersShared(sheet, riderIds) {
    const ids = Object.keys(sheet.json.riders ?? {});
    const set = new Set(riderIds);
    return {shared: ids.filter(id => set.has(id)).length, total: ids.length};
}


// A new version id: never a version id, never a plan id.
export function freeVersionId(club, newId) {
    const plans = new Set(Object.values(club.sheets).map(s => s.plan));
    for (let i = 0; i < 20; i++) {
        const id = newId();
        if (SHEET_RE.test(id) && !Object.hasOwn(club.sheets, id) && !plans.has(id)) {
            return id;
        }
    }
    throw new Error('no free version id');
}
