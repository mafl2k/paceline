// The rider table (team cockpit spec §7): one component for a version, or an inbox entry, marked
// against its race's live version. Columns #, Rider, "Pull @ W/kg" (or "Pull @ W", the club's
// targetUnit); the riders card after the gate adds Plan, each rider's state (amended 22 Nov 2026). A
// changed rider's row is followed by an old line, the complete row as it is in the base; a dropped
// rider shows only as a crossed old line, all of them at the end; a new one has NEW. The marks compare the
// values as shown (after conversion and rounding). Pure: it reads the club and the sheets it is given,
// and the clock is passed in. The model is plain text; planTable escapes it.
import {esc, t} from './pages.mjs';
import {th} from './ui.mjs';
import {diffVersions, diffSummary, positive, rawRider} from './diff.mjs';
import {datePicks} from './select.mjs';
import {raceOf} from './races.mjs';
import {dateDay} from './team-view.mjs';
import {isDate} from './time.mjs';
import {normalizePlan} from '../pages/src/engine/plan.mjs';

const unitOf = club => (club?.targetUnit === 'watts' ? 'watts' : 'wkg');


// The rider's pull target in the club's unit (club.targetUnit: 'wkg', the default, or 'watts'):
// {v: '4.2', unit, own: false}, the number alone (W/kg with one decimal, watts whole). W/kg is the
// plan's pull_wkg, else its watts (pull_power, else the text export's) over the rider's weight;
// watts the other way round. Without a weight the plan's own target stays, with own: true and its
// unit. Null without any target. `rider` is a normalizePlan rider of `sheet`.
export function targetIn(club, sheet, rider) {
    const raw = rawRider(sheet, rider);
    const wkg = positive(raw?.pull_wkg) ? Number(raw.pull_wkg) : null;
    const watts = positive(raw?.pull_power) ? Number(raw.pull_power) : positive(rider.watts) ? Number(rider.watts) : null;
    const kg = positive(rider.weight) ? Number(rider.weight) : null;
    const asWkg = v => ({v: v.toFixed(1), unit: 'wkg'});
    const asWatts = v => ({v: String(Math.round(v)), unit: 'watts'});
    if (unitOf(club) === 'watts') {
        if (watts !== null) {
            return {...asWatts(watts), own: false};
        }
        if (wkg !== null) {
            return kg !== null ? {...asWatts(wkg * kg), own: false} : {...asWkg(wkg), own: true};
        }
        return null;
    }
    if (wkg !== null) {
        return {...asWkg(wkg), own: false};
    }
    if (watts !== null) {
        return kg !== null ? {...asWkg(watts / kg), own: false} : {...asWatts(watts), own: true};
    }
    return null;
}


// The target as the table shows it: '4.2' in the club's unit, '300 W' / '4.2 W/kg' when it kept its
// own unit; null without one. The list's row summaries compare it too (cockpit-view.mjs).
export function shownTarget(club, sheet, rider) {
    const tg = targetIn(club, sheet, rider);
    if (tg === null) {
        return null;
    }
    if (!tg.own) {
        return tg.v;
    }
    return tg.unit === 'watts' ? t('tv-watts', {w: tg.v}) : t('tv-wkg', {v: tg.v});
}

const pullText = ({s, v}) => (v === null ? t('pt-pull-only', {s}) : t('pt-pull', {s, v}));

const storedSheet = (club, id) => (typeof id === 'string' && Object.hasOwn(club.sheets, id) ? club.sheets[id] : null);


// The live version of team `slug`'s race on `date`: {kind: 'live', id}, or {kind: 'none', id: null}.
export function raceBase(club, slug, date) {
    const id = raceOf(club, slug, date)?.live;
    return storedSheet(club, id) !== null ? {kind: 'live', id} : {kind: 'none', id: null};
}


// What version `id` of team `slug` is marked against: its race's live version ('live'); the live
// version itself against nothing ('self': the plan as riders get it, no old lines, also within the
// Undo window after a switch, team cockpit spec §5.3b); 'none' without a live version (or without
// version `id`).
export function tableBase(club, slug, id) {
    const sheet = storedSheet(club, id);
    if (sheet === null) {
        return {kind: 'none', id: null};
    }
    const base = raceBase(club, slug, sheet.date);
    return base.kind === 'live' && base.id === id ? {kind: 'self', id} : base;
}


// normalizePlan's riders of a sheet, or null when it cannot be read.
function ridersOf(sheet) {
    try {
        return normalizePlan(sheet.json, sheet.text).plan.riders;
    } catch {
        return null;
    }
}


// The table's model of `sheet` ({json, text, team, date, plan}: a stored version, or an entry with
// the team, date and plan the form has chosen; plan null: a new plan) against `base` (tableBase or
// raceBase): {state, caption, unit, lines}. `state` 'broken' (the sheet cannot be read: no lines),
// 'live' (the base is the sheet itself), 'none' (nothing live), 'unreadable' (the base cannot be
// read): in these the rows carry no mark; else 'diff', or 'same' when no line has a mark (decided
// from the shown values, not the plan code: the code ignores W/kg). The caption's summary counts
// the targets as shown too (diffVersions' targetOf), so it says what the table marks.
// Lines, in display order: {kind: 'row', pos, id, name, isNew, pull, parts: {s, v}, changed: {pull,
// target}}, with an old line {kind: 'old', pos, id, name, pull, dropped: false} right after the row
// of a rider whose rank among the riders in both versions, shown seconds or shown target changed
// (pos: their number in the base); the dropped riders {kind: 'old', …, dropped: true, rides} after
// the last row, all of them in their base order (user, 22 Nov 2026), each with `rides` the name of
// the team their pick that day (datePicks) rides for when that is another team. `pull` is the cell's text ('60 s @ 4.2', '60 s'); `parts` its seconds and target.
export function tableModel(club, sheet, base, {now}) {
    const unit = unitOf(club);
    const after = ridersOf(sheet);
    if (after === null) {
        return {state: 'broken', caption: t('pt-broken'), unit, lines: []};
    }
    const cell = (sh, r) => {
        const parts = {s: String(r.pullS), v: shownTarget(club, sh, r)};
        return {parts, pull: pullText(parts)};
    };
    const row = (r, i, isNew = false, changed = {pull: false, target: false}) => {
        const {parts, pull} = cell(sheet, r);
        return {kind: 'row', pos: i + 1, id: r.id, name: r.name, isNew, pull, parts, changed};
    };
    const plain = state => caption => ({state, caption, unit, lines: after.map((r, i) => row(r, i))});

    if (base.kind === 'self') {
        return plain('live')(t('pt-live'));
    }
    const older = storedSheet(club, base.id);
    if (older === null) {
        return plain('none')(isDate(sheet.date) ? t('pt-none', {day: dateDay(sheet.date, club.tz)}) : t('pt-none-any'));
    }
    const samePlan = older.plan === sheet.plan;
    const before = ridersOf(older);
    if (before === null) {
        return plain('unreadable')(samePlan ? t('pt-unreadable', {n: older.n}) : t('pt-unreadable-plan', {label: older.label, n: older.n}));
    }

    const oldIds = new Set(before.map(r => r.id));
    const newIds = new Set(after.map(r => r.id));
    const oldPos = new Map(before.map((r, i) => [r.id, i]));
    const rank = list => new Map(list.map((r, i) => [r.id, i]));
    const newRank = rank(after.filter(r => oldIds.has(r.id)));
    const oldRank = rank(before.filter(r => newIds.has(r.id)));
    const oldLine = (r, dropped) => {
        const {pull} = cell(older, r);
        return {kind: 'old', pos: oldPos.get(r.id) + 1, id: r.id, name: r.name, pull, dropped};
    };

    // the dropped riders, all at the end of the table in their base order (user, 22 Nov 2026: in a new
    // order "before the next rider still here" put them between two riders of the plan)
    const picks = datePicks(club, sheet.date, now);
    const ridesFor = id => {
        const pick = picks.get(id);
        return pick && pick.slug !== sheet.team && Object.hasOwn(club.teams, pick.slug) ? club.teams[pick.slug].name : null;
    };
    const atEnd = before.filter(r => !newIds.has(r.id)).map(r => ({...oldLine(r, true), rides: ridesFor(r.id)}));

    const lines = [];
    let marked = atEnd.length > 0;
    after.forEach((r, i) => {
        if (!oldIds.has(r.id)) {
            lines.push(row(r, i, true));
            marked = true;
            return;
        }
        const o = before[oldPos.get(r.id)];
        const is = cell(sheet, r).parts;
        const was = cell(older, o).parts;
        const changed = {pull: is.s !== was.s, target: is.v !== was.v};
        lines.push(row(r, i, false, changed));
        if (changed.pull || changed.target || newRank.get(r.id) !== oldRank.get(r.id)) {
            lines.push(oldLine(o, false));
            marked = true;
        }
    });
    lines.push(...atEnd);

    const baseText = samePlan ? t('pt-base', {n: older.n}) : t('pt-base-plan', {label: older.label, n: older.n});
    const targetOf = (sh, r) => shownTarget(club, sh, r);
    const caption = marked
        ? `${t('pt-against', {base: baseText})} · ${diffSummary(diffVersions(club, older, sheet, now, {targetOf}))}`
        : t('pt-same', {base: baseText});
    return {state: marked ? 'diff' : 'same', caption, unit, lines};
}


const chg = (html, on) => (on ? `<span class="pt-chg">${html}</span>` : html);


// The sign before a rider's state in the Plan column (teamView's RiderState kind; spec §7, amended
// 22 Nov 2026), so the state is never colour alone: ✓ the rider has the live plan; ⚠ something to act
// on, they would ride without it (an older plan, version or another plan of the race; riding another
// team now; in another event than the race's link); – waiting, nothing wrong yet (not seen, checked
// and not in the event yet, in the event with the plan coming at the next check). ⚠ with the text
// presentation selector, so no phone draws it as a coloured emoji.
export const STATE_SIGN = {
    has: '✓', 'has-in-event': '✓',
    'old-code': '⚠\uFE0E', 'other-team': '⚠\uFE0E', 'other-event': '⚠\uFE0E',
    none: '–', checked: '–', 'in-event': '–',
};


// The Plan cell of a row: the sign (hidden from screen readers: the words say it), the state's words
// and the time of the rider's last check; an empty cell for an old or a dropped line, and for a row
// without a state (none can occur: the states and the rows both come from the live version,
// cockpit.test.mjs sameRiders).
function stateCell(state) {
    if (!state) {
        return '<td class="rstate"></td>';
    }
    const time = state.time ? ` <time>${esc(state.time)}</time>` : '';
    return `<td class="rstate ${esc(state.sev)}"><span class="rstate-sign" aria-hidden="true">${esc(STATE_SIGN[state.kind] ?? '–')}</span> `
        + `<span class="rstate-text">${esc(state.text)}</span>${time}</td>`;
}


// One line of the table: a row (NEW beside the name, a changed value in the change colour), an old
// line (dimmed, "before:" for screen readers) or a dropped one (crossed out, "dropped:", → team).
// `states` (planTable's) adds the Plan cell.
function lineHtml(l, states) {
    const who = inner => `<td class="nmcol"><span class="pt-who">${inner}</span></td>`;
    const nm = `<span class="pt-nm">${esc(l.name)}</span>`;
    const plan = states === null ? '' : stateCell(l.kind === 'row' ? states.get(l.id) : null);
    if (l.kind === 'row') {
        const s = chg(esc(l.parts.s), l.changed.pull);
        const pull = l.parts.v === null ? th('pt-pull-only', {s}) : th('pt-pull', {s, v: chg(esc(l.parts.v), l.changed.target)});
        const mark = l.isNew ? ` <span class="pt-mark">${esc(t('pt-new'))}</span>` : '';
        return `<tr><td class="n pt-pos">${esc(l.pos)}</td>${who(nm + mark)}<td class="n pt-pull">${pull}</td>${plan}</tr>`;
    }
    if (!l.dropped) {
        return `<tr class="pt-old"><td class="n pt-pos">${esc(l.pos)}</td>${who(`<span class="vh">${esc(t('pt-sr-before'))}</span> ${nm}`)}`
            + `<td class="n pt-pull">${esc(l.pull)}</td>${plan}</tr>`;
    }
    const rides = l.rides === null ? '' : ` <span class="pt-rides">${esc(t('pt-rides', {team: l.rides}))}</span>`;
    return `<tr class="pt-old pt-dropped"><td class="n pt-pos"><s>${esc(l.pos)}</s></td>`
        + who(`<span class="vh">${esc(t('pt-sr-dropped'))}</span> <span class="pt-nm"><s>${esc(l.name)}</s></span>${rides}`)
        + `<td class="n pt-pull"><s>${esc(l.pull)}</s></td>${plan}</tr>`;
}


// The caption and the table of a tableModel; a sheet that cannot be read has the caption alone.
// `states` (a Map of rider id to teamView's RiderState: the riders card after the gate) adds the Plan
// column; without it the table has its three. `caption` false leaves the caption out (the cockpit's
// card says it in its head, cockpit-panel.mjs); a sheet that cannot be read then draws nothing.
export function planTable(model, {states = null, caption = true} = {}) {
    const cap = caption ? `<p class="pt-cap">${esc(model.caption)}</p>` : '';
    if (model.state === 'broken') {
        return cap;
    }
    const plan = states === null ? '' : `<th class="rstate">${esc(t('pt-col-plan'))}</th>`;
    const head = `<thead><tr><th class="n pt-pos">${esc(t('result-col-pos'))}</th><th>${esc(t('result-col-rider'))}</th>`
        + `<th class="n pt-pull">${esc(t(model.unit === 'watts' ? 'pt-col-pull-w' : 'pt-col-pull-wkg'))}</th>${plan}</tr></thead>`;
    const cls = states === null ? 'ptable ptable-plan' : 'ptable ptable-plan rstates';
    return `${cap ? `${cap}\n` : ''}<table class="${cls}">${head}<tbody>\n${model.lines.map(l => lineHtml(l, states)).join('\n')}\n</tbody></table>`;
}
