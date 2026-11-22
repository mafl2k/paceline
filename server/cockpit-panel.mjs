// The team cockpit's panel (team cockpit spec §5.3, §5.3b, §6): the markup of the page's three slots
// for what the panel shows (cockpitView's `panel`), one card in every state: #panel holds the flash
// (or the Store result) and the card's top (.cp-top: the title with the phone's close link, then one
// line with the plan code and the table's caption or the riders' count), .cp-pick a received plan's
// Store form (drawn inside its picked row), #panel-body the card's body (.cp-body: the rider table,
// the "what happens" slot and the action bar at the bottom: "LIVE · riders get this", Make vN live,
// Store and Discard, or "Read only"). The same function draws them into the whole page and into the
// fragment the script swaps in (cockpit-page.mjs), so there is no second drawing. Pure: it reads the
// club and the view it is given, and the clock is passed in. Every value goes through esc().
import {esc, t} from './pages.mjs';
import {ic} from './icons.mjs';
import {liveQuestion, atLabel, quote, dateDay} from './team-view.mjs';
import {makeLiveHtml, undoBlock} from './team-page.mjs';
import {th} from './ui.mjs';
import {tableModel, planTable, raceBase} from './plan-table.mjs';
import {entryOf} from './club.mjs';
import {planOfId} from './plans.mjs';
import {isDate} from './time.mjs';
import {storeForm, flashHtml} from './store-form.mjs';


// The anchor of the race block of `date` in the list ('#race-<date>'), '' when the list has no block
// with that id (a team without a race ahead: its regular race day has none).
export function raceAnchor(view, date) {
    const blocks = [...view.lists.filter(l => l.date !== null && !(l === view.lists[0] && view.regular)), ...view.overLists];
    return blocks.some(l => l.date === date) ? `#race-${date}` : '';
}


// The one close link of the panel, the phone's sheet ✕ (below 1180 px; the stylesheet hides it
// from 1180 px, where the live version is a click on its row, spec §5.3b): the page without a
// selection, at the race of the selection; its name for screen readers says it closes the panel.
function closeLink(path, anchor) {
    return `<a class="cp-close" href="${esc(path + anchor)}">${ic('close', 'cp-x')}<span class="sr">${esc(t('cp-close'))}</span></a>`;
}


// "Plan code RE5CFQ" of a version (its `sig`) in the card's line; '' without one.
const codeSpan = sig => (sig ? `<span class="plancode">${th('cp-code', {sig: `<code>${esc(sig)}</code>`})}</span>` : '');


// The card's top: the title (markup) with `close`, then one line of `meta` parts (markup, the empty
// ones left out; none: no line). The flash stands above it, outside the card (`flash`). No title: the
// close link alone.
function topHtml(flash, title, close, meta = []) {
    const parts = meta.filter(Boolean);
    const line = parts.length ? `<p class="cp-meta">${parts.join('')}</p>` : '';
    const h = title === '' ? '' : `<h2 class="cp-title" id="panel-h">${title}</h2>`;
    return `${flash}<div class="cp-top"><div class="cp-head">${h}${close}</div>${line}</div>`;
}


// The card's body: the rider table (markup), the "what happens" slot and the action bar, each slot
// drawn also when empty, so the bar stands at the card's bottom in every state.
const bodyHtml = (table, what, bar) => `<div class="cp-body">${table}<div class="cp-what">${what}</div><div class="cp-bar">${bar}</div></div>`;


// A status in the action bar ("LIVE · riders get this", "Read only"), with its icon.
const statusHtml = (cls, icon, text) => `<p class="cp-status ${esc(cls)}">${ic(icon)}<span>${esc(text)}</span></p>`;


// A pending entry's line, as its row in the list says it: "Sent 19:12 · 'Rollers slow' · 4 riders"
// (an upload "Uploaded 19:05 · …"; without a planner's name the name is left out).
export function pendingLine(p) {
    const when = p.source === 'receive' ? t('tp-received-at', {at: p.at}) : t('cp-uploaded-at', {at: p.at});
    const riders = p.riders === 1 ? t('tp-riders-one') : t('tp-riders-n', {n: p.riders});
    return p.name === null ? t('cp-pending-row-no-name', {when, riders}) : t('cp-pending-row', {when, name: quote(p.name), riders});
}


// What Make live of version `id` would do (liveQuestion's words: the "what happens" slot) and its
// button (the action bar): "Make v2 live…" asking in its place when the rule says so, else "Make v2
// live" at once; primary only when the race has no live version, else secondary on every draw (spec
// §5.4, the safety review: a reload never turns it primary). {what, bar}.
function liveAction(club, slug, id, s, now) {
    const {words} = liveQuestion(club, slug, id, now);
    const cls = raceBase(club, slug, s.date).kind === 'live' ? 'btn secondary' : 'btn primary';
    return {
        what: `<p class="cp-words">${esc(words)}</p>`,
        bar: makeLiveHtml(club, slug, id, {now, button: t('tp-make-newer-live', {n: s.n}), plain: t('tp-make-newer-live-now', {n: s.n}), sr: false, cls, key: 'panel'}),
    };
}


// The live version's count (its race view `rv`, raceView): before the gate the riders ("6 riders"),
// after it "4 of 6 have the plan", and the Plan column's states; the "what happens" slot says from
// when the states show, or what they mean (a help fold without a form: it keeps the reload).
// {count, states, what}.
function liveParts(rv) {
    const n = rv.count;
    if (rv.open) {
        const has = `<strong>${esc(t('tp-has-count', {has: rv.has, n}))}</strong>`;
        return {
            count: th(n === 1 ? 'tp-has-one' : 'tp-has', {count: has}),
            states: new Map(rv.riders.map(r => [r.id, r.state])),
            what: `<details class="help" data-keep-refresh><summary>${ic('info')}${esc(t('tp-help'))}</summary><p class="hint">${esc(t('tp-help-text'))}</p></details>`,
        };
    }
    const what = rv.live.sent ? `<p class="hint">${th('tp-plan-hint', {at: `<time>${esc(rv.opens)}</time>`})}</p>`
        : `<p class="hint">${esc(t(rv.special ? 'tp-no-start-hint-special' : 'tp-no-start-hint'))}</p>`;
    return {count: esc(n === 1 ? t('tp-riders-one') : t('tp-riders-n', {n})), states: null, what};
}


// The three slots of `view` (cockpitView) as markup: {kind, sel, head, row, body}, kind the panel's
// data-kind ('version', 'entry', 'gone', 'none', or '' with no card: all three slots are then ''
// but the flash), `sel` the data-sel of the row the card shows ('' for none). `path` is the page's
// own path (cockpitPath), `flash` the one-shot flash shown above the card (a Store flash with its
// result: resultBlock). A version: its title ("Riders on 'Rollers · fast' v3" for its race's live
// version while the race is ahead, else "'Rollers · fast' v2 · stored 18:55"), its plan code (once:
// a flash that names it stands for it) and the caption of its table against its race's live version
// (the live version: none, the plan as riders get it; its count instead, and after the gate its
// riders' states); what Make live would do and the button, or "LIVE · riders get this", or for a
// race that is over "Read only". The live version within the Undo window of the switch that made it
// live has Undo: in the flash of that switch, else in its action bar.
// A received plan picked needs its Store form's `choices` (assignChoices', or a refused Store's) and
// `preview` (manage-cockpit.mjs entryDraw): its title is the row's line, `row` the .cp-pick slot with
// the form, its table against the live version of the race the form has chosen (team cockpit spec
// §5.3: never the nearest race's; no team or date chosen: nothing to compare), What happens, then
// Store and Discard. Nothing live in the nearest race: "Nothing live for Thu 19 Nov yet".
export function panelParts(club, view, {now, path, flash = null, choices = null, preview = null}) {
    const {panel, slug} = view;
    const anchor = raceAnchor(view, view.lists[0]?.date ?? null);
    if (panel.kind === 'version') {
        const s = club.sheets[panel.id];
        const at = Date.parse(s.at);
        const live = panel.isLive && !panel.over && panel.rv !== null;
        const title = esc(live ? t('cp-head-live', {label: s.label, n: s.n})
            : t('cp-head-version', {label: s.label, n: s.n, at: Number.isFinite(at) ? atLabel(at, now, club.tz) : '–'}));
        // the Undo of the switch that made it live: inside the one-shot flash of that switch ("v3 … is
        // live." with Undo), else in the action bar beside "LIVE · riders get this", so no line above
        // the card moves it while Undo is offered (spec §5.3b)
        const undo = panel.undo ? undoBlock(club, slug, now) : null;
        const undoInFlash = undo !== null && flash?.kind === 'ok' && flash.undo === true;
        // the code once: a flash that names it (Store and make live, "… Plan code RE5CFQ.") stands for it
        const named = typeof flash?.text === 'string' && Boolean(s.sig) && flash.text.includes(t('cp-code', {sig: s.sig}));
        const model = tableModel(club, s, panel.base, {now});
        const lp = live ? liveParts(panel.rv) : null;
        const cap = live ? `<span class="count">${lp.count}</span>` : `<span class="cp-cap" title="${esc(model.caption)}">${esc(model.caption)}</span>`;
        // nothing picked: no sheet is open, so no close link (on a phone the card follows the list)
        const close = panel.dflt ? '' : closeLink(path, raceAnchor(view, panel.date));
        const head = topHtml(flashHtml(flash, undoInFlash ? undo : null), title, close, [named ? '' : codeSpan(s.sig), cap]);
        const table = planTable(model, {states: lp?.states ?? null, caption: false});
        let what;
        let bar;
        if (panel.over) {
            what = `<p class="cp-over">${ic('info')}<span>${esc(t('cp-over'))}</span></p>`;
            bar = statusHtml('neutral', 'info', t('cp-read-only'));
        } else if (panel.isLive) {
            what = lp?.what ?? '';
            bar = statusHtml('ok', 'checkCircle', t('pt-live')) + (undo === null || undoInFlash ? '' : `<div class="cp-undo">${undo.form}</div>`);
        } else {
            ({what, bar} = liveAction(club, slug, panel.id, s, now));
        }
        return {kind: 'version', sel: `v:${panel.id}`, head, row: '', body: bodyHtml(table, what, bar)};
    }
    if (panel.kind === 'entry') {
        const e = entryOf(club, panel.id, now);
        const p = view.lists.flatMap(l => l.pending).find(x => x.id === panel.id);
        const form = storeForm(club, e, {choices, preview, now, back: path});
        const row = `<div class="cp-pick" data-for="e:${esc(e.id)}">${form.row}</div>`;
        const {team, date, as} = choices;
        const plan = team !== null && typeof as === 'string' && as !== 'new' ? planOfId(club, team, as)?.id ?? null : null;
        const base = team !== null && isDate(date) ? raceBase(club, team, date) : {kind: 'none', id: null};
        const model = tableModel(club, {json: e.json, text: e.text, team, date, plan}, base, {now});
        const head = topHtml(flashHtml(flash), esc(pendingLine(p)), closeLink(path, anchor), [`<span class="cp-cap" title="${esc(model.caption)}">${esc(model.caption)}</span>`]);
        return {kind: 'entry', sel: `e:${e.id}`, head, row, body: bodyHtml(planTable(model, {caption: false}), form.what, form.actions)};
    }
    if (panel.kind === 'gone') {
        const head = topHtml(flashHtml(flash), '', closeLink(path, anchor));
        return {kind: 'gone', sel: '', head, row: '', body: bodyHtml('', `<p class="cp-gone">${esc(t(panel.what === 'version' ? 'cp-gone-version' : 'club-entry-gone'))}</p>`, '')};
    }
    if (panel.kind === 'none') {
        const head = topHtml(flashHtml(flash), esc(t('cp-none-live', {day: dateDay(panel.date, club.tz)})), panel.close ? closeLink(path, raceAnchor(view, panel.date)) : '');
        return {kind: 'none', sel: '', head, row: '', body: bodyHtml('', '', `<p class="cp-status neutral"><span>${esc(t('cp-none-pick'))}</span></p>`)};
    }
    return {kind: '', sel: '', head: flashHtml(flash), row: '', body: ''};
}
