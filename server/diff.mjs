// The difference between two versions of a plan (plan versions spec §7): lines for the versions
// page, and a one-line summary for the lists. Pure: it reads the club and the versions it is given,
// and the clock is passed in. Plain text: the pages escape it.
import {t, andList} from './pages.mjs';
import {datePicks} from './select.mjs';
import {normalizePlan, RAW_SHORT_MAX} from '../pages/src/engine/plan.mjs';


// A positive number or numeric string as stripSheet keeps it.
const positive = v => ((typeof v === 'number' && Number.isFinite(v))
    || (typeof v === 'string' && v.length <= RAW_SHORT_MAX && Number.isFinite(Number(v)))) && Number(v) > 0;


// The rider's pull target: the plan's pull_wkg ("4.2 W/kg", one decimal as the mod shows it), else
// its pull_power, else the text export's watts; null without any. `rider` is a normalizePlan rider.
export function pullTarget(sheet, rider) {
    const list = sheet?.json?.riders;
    const raw = list && typeof list === 'object' && Object.hasOwn(list, rider.id) ? list[rider.id] : null;
    if (positive(raw?.pull_wkg)) {
        return t('tv-wkg', {v: Number(raw.pull_wkg).toFixed(1)});
    }
    if (positive(raw?.pull_power)) {
        return t('tv-watts', {w: Math.round(Number(raw.pull_power))});
    }
    if (rider.watts != null) {
        return t('tv-watts', {w: rider.watts});
    }
    return null;
}


// 1 -> '1st', 2 -> '2nd', 11 -> '11th', 21 -> '21st'.
export function ordinal(n) {
    const last2 = n % 100;
    const suffix = last2 >= 11 && last2 <= 13 ? 'th' : ({1: 'st', 2: 'nd', 3: 'rd'}[n % 10] ?? 'th');
    return `${n}${suffix}`;
}


const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const line = (kind, text, names = []) => ({kind, text, names});

// '4.2 W/kg' -> ['4.2', 'W/kg']; the unit is the part after the last space.
function splitTarget(s) {
    const i = s.lastIndexOf(' ');
    return [s.slice(0, i), s.slice(i + 1)];
}

function targetItem(name, a, b) {
    if (a !== null && b !== null) {
        const [va, ua] = splitTarget(a);
        const [vb, ub] = splitTarget(b);
        if (ua === ub) {
            return t('df-target-unit', {name, from: va, to: vb, unit: ua});
        }
    }
    return t('df-target', {name, from: a ?? t('df-dash'), to: b ?? t('df-dash')});
}


// The lines that tell what `newer` changed against `older` (null for a plan's first version), in the
// order of the spec: first, in, out, order, pulls, targets, type, the event link (a version stored
// only for a new link is no "Same as", Ruling 4), then other or same. The planner's roster (the
// club's rider pool) has no line: a rider from it into the ride order is plainly in, a rider who
// leaves the ride order for it plainly out.
// Positions are 1-based in the new ride order; a rider's name comes from the newer version, or from
// the older one when he left. `names` holds the riders a line names.
export function diffVersions(club, older, newer, now, {newPlan = false} = {}) {
    if (older === null) {
        return [line('first', t(newPlan ? 'df-first-new' : 'df-first'))];
    }
    const before = normalizePlan(older.json, older.text).plan;
    const after = normalizePlan(newer.json, newer.text).plan;
    const oldIds = new Set(before.riders.map(r => r.id));
    const newIds = new Set(after.riders.map(r => r.id));
    const oldRider = new Map(before.riders.map(r => [r.id, r]));
    const lines = [];

    const ins = [];
    const inNames = [];
    after.riders.forEach((r, i) => {
        if (oldIds.has(r.id)) {
            return;
        }
        ins.push(t('df-in', {name: r.name, ord: ordinal(i + 1)}));
        inNames.push(r.name);
    });
    if (ins.length) {
        lines.push(line('in', ins.join('; '), inNames));
    }

    const outs = [];
    const outNames = [];
    const picks = datePicks(club, newer.date, now);
    for (const r of before.riders) {
        if (newIds.has(r.id)) {
            continue;
        }
        const pick = picks.get(r.id);
        const other = pick && pick.slug !== newer.team && Object.hasOwn(club.teams, pick.slug)
            ? club.teams[pick.slug].name : null;
        outs.push(other === null ? t('df-out', {name: r.name}) : t('df-out-rides', {name: r.name, team: other}));
        outNames.push(r.name);
    }
    if (outs.length) {
        lines.push(line('out', outs.join('; '), outNames));
    }

    const both = after.riders.filter(r => oldIds.has(r.id));
    const oldOrder = before.riders.filter(r => newIds.has(r.id)).map(r => r.id);
    if (both.some((r, i) => r.id !== oldOrder[i])) {
        const names = after.riders.map(r => r.name);
        lines.push(line('order', t('df-order', {names: names.join(', ')}), names));
    }

    const pulls = both.filter(r => r.pullS !== oldRider.get(r.id).pullS);
    if (pulls.length) {
        const items = pulls.map(r => t('df-pull', {name: r.name, from: oldRider.get(r.id).pullS, to: r.pullS}));
        lines.push(line('pulls', t('df-pulls', {items: items.join(', ')}), pulls.map(r => r.name)));
    }

    const targets = [];
    const targetNames = [];
    for (const r of both) {
        const a = pullTarget(older, oldRider.get(r.id));
        const b = pullTarget(newer, r);
        if (a !== b) {
            targets.push(targetItem(r.name, a, b));
            targetNames.push(r.name);
        }
    }
    if (targets.length) {
        lines.push(line('targets', t('df-targets', {items: targets.join('; ')}), targetNames));
    }

    const typeOld = older.type ?? null;
    const typeNew = newer.type ?? null;
    if (typeOld !== typeNew) {
        lines.push(line('type', t('df-type', {
            from: typeOld ?? t('df-none'), to: typeNew ?? t('df-none'),
        })));
    }

    const linkOld = older.pinnedEventId ?? null;
    const linkNew = newer.pinnedEventId ?? null;
    if (linkOld !== linkNew) {
        lines.push(line('event', t(linkOld === null ? 'df-event-added' : linkNew === null ? 'df-event-removed' : 'df-event-changed')));
    }

    if (!lines.length) {
        const identical = same(older.json, newer.json) && same(older.text, newer.text);
        lines.push(identical ? line('same', t('df-same', {n: older.n})) : line('other', t('df-other')));
    }
    return lines;
}


// 'Cleo in', 'Cleo and Eva in', '3 riders in': at most two names are listed.
const who = names => (names.length <= 2 ? andList(names) : t('df-sum-riders', {n: names.length}));

// Who came and went in the lines, "Cleo in, Ben out", or null when nobody did.
export function diffPeople(lines) {
    const get = kind => lines.find(l => l.kind === kind) ?? null;
    const people = [];
    const inL = get('in');
    const outL = get('out');
    if (inL) {
        people.push(t('df-sum-in', {who: who(inL.names)}));
    }
    if (outL) {
        people.push(t('df-sum-out', {who: who(outL.names)}));
    }
    return people.length ? people.join(', ') : null;
}


// The one-line version of the lines: who came and went, then what else changed; with none of these,
// the first line's text. With `n` (the version's own number) it starts with "v3: ", for a restored
// version "v3 (restored v1): "; with only `copyOf` "Restored v1: ".
export function diffSummary(lines, {copyOf = null, n = null} = {}) {
    const get = kind => lines.find(l => l.kind === kind) ?? null;
    const parts = [];
    const people = diffPeople(lines);
    if (people !== null) {
        parts.push(people);
    }
    if (get('order')) {
        parts.push(t('df-sum-order'));
    }
    const pulls = get('pulls');
    if (pulls) {
        parts.push(pulls.names.length === 1 ? t('df-sum-pull') : t('df-sum-pulls', {n: pulls.names.length}));
    }
    const targets = get('targets');
    if (targets) {
        parts.push(targets.names.length === 1 ? t('df-sum-target') : t('df-sum-targets', {n: targets.names.length}));
    }
    const text = parts.length ? parts.join(' · ') : (lines[0]?.text ?? '');
    if (n !== null) {
        return copyOf === null ? t('df-sum-v', {k: n, text}) : t('df-sum-v-back', {k: n, n: copyOf, text});
    }
    return copyOf === null ? text : t('df-sum-back', {n: copyOf, text});
}
