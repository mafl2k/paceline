// The team cockpit's panel (team cockpit spec §5.3, §5.3b, §6): the markup of the page's slots for
// what the panel shows (cockpitView's `panel`), one card in every state: #panel holds the flash (or
// the Store result) and the card's top (.cp-top: the title with the phone's close link, then one line
// with the plan code and the table's caption or the riders' count), #panel-body the card's body
// (.cp-body: the rider table, a received plan's Store form under it (user, 23 Nov 2026: in the card,
// never in its row, so the list never moves), the slot of its warnings (and hints), and a status at
// its end: "LIVE · riders get this", "Read only"), #panel-acts the card's actions (user, 23 Nov 2026:
// one action row under the title from 1180 px, the card's bottom below that): Discard · Store · Make
// live, or Make live alone, Make live always the rightmost. No Undo (user, 23 Nov 2026: a wrong
// switch is undone by Make live of the version live before). The same function
// draws them into the whole page and into the
// fragment the script swaps in (cockpit-page.mjs), so there is no second drawing. Pure: it reads the
// club and the view it is given, and the clock is passed in. Every value goes through esc().
import {esc, t} from './pages.mjs';
import {ic} from './icons.mjs';
import {liveQuestion, atLabel, quote, dateDay} from './team-view.mjs';
import {makeLiveHtml} from './team-page.mjs';
import {th} from './ui.mjs';
import {tableModel, planTable, raceBase} from './plan-table.mjs';
import {entryOf} from './club.mjs';
import {planOfId, versionName} from './plans.mjs';
import {isDate, localLabel} from './time.mjs';
import {storeForm, flashHtml, warnLines} from './store-form.mjs';


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


// The card's body: the rider table (markup), a received plan's Store form (`form`, markup: its fields
// in .cp-form, under the table), the slot of its warnings, then its status (`status`: "LIVE · riders
// get this", "Read only", markup) in a bar at its end, or none when the card has actions (`acts`:
// they stand in #panel-acts, .has-acts: below 1180 px the card's bottom is theirs).
const bodyHtml = (table, what, status, form = '', acts = '') => `<div class="cp-body${acts === '' ? '' : ' has-acts'}">${table}${form === '' ? '' : `<div class="cp-form">${form}</div>`}`
    + `<div class="cp-what">${what}</div>${acts === '' ? `<div class="cp-bar">${status}</div>` : ''}</div>`;


// A status in the action bar ("LIVE · riders get this", "Read only"), with its icon.
const statusHtml = (cls, icon, text) => `<p class="cp-status ${esc(cls)}">${ic(icon)}<span>${esc(text)}</span></p>`;


// A pending entry's line, as its row in the list says it: "Received 19:12 · 'Rollers slow' · 4 riders"
// (an upload "Uploaded 19:05 · …"; without a planner's name the name is left out).
export function pendingLine(p) {
    const when = p.source === 'receive' ? t('tp-received-at', {at: p.at}) : t('cp-uploaded-at', {at: p.at});
    const riders = p.riders === 1 ? t('tp-riders-one') : t('tp-riders-n', {n: p.riders});
    return p.name === null ? t('cp-pending-row-no-name', {when, riders}) : t('cp-pending-row', {when, name: quote(p.name), riders});
}


// What of Make live of version `id` warns (liveQuestion's warnings, as lines right above the action
// bar; user, 23 Nov 2026: no "What happens", the rest of its words is Make live's own question) and its
// button (the action bar): "Make live" (the version for screen readers, user 23 Nov 2026), asking in
// its place when the rule says so, else at once; always the primary button, as the Store form's Make live (user, 23 Nov 2026: the
// card's one action; a switch that matters asks first in its place). {what, bar}.
function liveAction(club, slug, id, s, now) {
    const {warnings} = liveQuestion(club, slug, id, now);
    const cls = 'btn primary';
    return {
        what: warnLines(warnings),
        // "Make live", the version for screen readers (user, 23 Nov 2026)
        bar: makeLiveHtml(club, slug, id, {now, button: t('tp-confirm-live'), plain: t('tp-confirm-live'), sr: t('tp-make-live-sr', {n: s.n, label: s.label}), cls, key: 'panel'}),
    };
}


// The live version's count (its race view `rv`, raceView): before the gate the riders ("6 riders"),
// after it "4 of 6 have the plan", and the Plan column's states; the warnings slot says from
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


// The slots of `view` (cockpitView) as markup: {kind, sel, head, body, acts}, kind the panel's
// data-kind ('version', 'entry', 'gone', 'none', or '' with no card: every slot is then '' but the
// flash), `acts` the card's actions (the bar's buttons, '' for none: the live version, a race that is
// over, nothing to act on), `sel` the data-sel of the row the card shows ('' for none). `path` is the page's
// own path (cockpitPath), `flash` the one-shot flash shown above the card (a Store flash with its
// result: resultBlock). A version: its title ("Riders on 'Rollers · fast' v3" for its race's live
// version while the race is ahead, else "'Rollers · fast' v2 · stored 18:55"), its plan code (once:
// a flash that names it stands for it) and the caption of its table against its race's live version
// (the live version: none, the plan as riders get it; its count instead, and after the gate its
// riders' states); what Make live would do and the button, or "LIVE · riders get this", or for a
// race that is over "Read only".
// A received plan picked needs its Store form's `choices` (assignChoices', or a refused Store's) and
// `preview` (manage-cockpit.mjs entryDraw): its title is the row's line; the body its table against
// the live version of the race the form has chosen (team cockpit spec §5.3: never the nearest race's;
// no team or date chosen: nothing to compare), the form's fields under it, its warning lines (when any), then Store
// and Discard. Nothing live in the nearest race: "Nothing live for Thu 19 Nov yet".
export function panelParts(club, view, {now, path, flash = null, choices = null, preview = null}) {
    const {panel, slug} = view;
    const anchor = raceAnchor(view, view.lists[0]?.date ?? null);
    if (panel.kind === 'version') {
        const s = club.sheets[panel.id];
        const at = Date.parse(s.at);
        const live = panel.isLive && !panel.over && panel.rv !== null;
        const name = versionName(s.type, s.n);
        const title = esc(live ? t('cp-head-live', {name})
            // with its day always (user, 23 Nov 2026: the card stands for the version, "stored 18:55" alone
            // does not say which day)
            : t('cp-head-version', {name, at: Number.isFinite(at) ? localLabel(at, club.tz) : '–'}));
        // the code once: a flash that names it (Store and make live, "… Plan code RE5CFQ.") stands for it
        const named = typeof flash?.text === 'string' && Boolean(s.sig) && flash.text.includes(t('cp-code', {sig: s.sig}));
        const model = tableModel(club, s, panel.base, {now});
        const lp = live ? liveParts(panel.rv) : null;
        const cap = live ? `<span class="count">${lp.count}</span>` : `<span class="cp-cap" title="${esc(model.caption)}">${esc(model.caption)}</span>`;
        // nothing picked: no sheet is open, so no close link (on a phone the card follows the list)
        const close = panel.dflt ? '' : closeLink(path, raceAnchor(view, panel.date));
        const head = topHtml(flashHtml(flash), title, close, [named ? '' : codeSpan(s.sig), cap]);
        const table = planTable(model, {states: lp?.states ?? null, caption: false});
        let what;
        let status = '';
        let acts = '';
        if (panel.over) {
            what = `<p class="cp-over">${ic('info')}<span>${esc(t('cp-over'))}</span></p>`;
            status = statusHtml('neutral', 'info', t('cp-read-only'));
        } else if (panel.isLive) {
            what = lp?.what ?? '';
            status = statusHtml('ok', 'checkCircle', t('pt-live'));
        } else {
            ({what, bar: acts} = liveAction(club, slug, panel.id, s, now));
        }
        // when it went live, under the table of the opened version (user, 23 Nov 2026: the list's rows
        // leave it out): "Live since 19:14" on the live one, "Was live 18:57" on one that was
        const liveMs = s.liveAt == null ? NaN : Date.parse(s.liveAt);
        const history = Number.isFinite(liveMs)
            ? `<p class="hint cp-history">${esc(t(live ? 'cp-history-live' : 'cp-history-was', {at: localLabel(liveMs, club.tz)}))}</p>` : '';
        return {kind: 'version', sel: `v:${panel.id}`, head, body: bodyHtml(table, history + what, status, '', acts), acts};
    }
    if (panel.kind === 'entry') {
        const e = entryOf(club, panel.id, now);
        const p = view.lists.flatMap(l => l.pending).find(x => x.id === panel.id);
        const form = storeForm(club, e, {choices, preview, now, back: path});
        const {team, date, as} = choices;
        const plan = team !== null && typeof as === 'string' && as !== 'new' ? planOfId(club, team, as)?.id ?? null : null;
        const base = team !== null && isDate(date) ? raceBase(club, team, date) : {kind: 'none', id: null};
        const model = tableModel(club, {json: e.json, text: e.text, team, date, plan}, base, {now});
        const head = topHtml(flashHtml(flash), esc(pendingLine(p)), closeLink(path, anchor), [`<span class="cp-cap" title="${esc(model.caption)}">${esc(model.caption)}</span>`]);
        return {kind: 'entry', sel: `e:${e.id}`, head, body: bodyHtml(planTable(model, {caption: false}), form.what, '', form.form, form.actions), acts: form.actions};
    }
    if (panel.kind === 'gone') {
        const head = topHtml(flashHtml(flash), '', closeLink(path, anchor));
        return {kind: 'gone', sel: '', head, body: bodyHtml('', `<p class="cp-gone">${esc(t(panel.what === 'version' ? 'cp-gone-version' : 'club-entry-gone'))}</p>`, ''), acts: ''};
    }
    if (panel.kind === 'none') {
        const head = topHtml(flashHtml(flash), esc(t('cp-none-live', {day: dateDay(panel.date, club.tz)})), panel.close ? closeLink(path, raceAnchor(view, panel.date)) : '');
        return {kind: 'none', sel: '', head, body: bodyHtml('', '', `<p class="cp-status neutral"><span>${esc(t('cp-none-pick'))}</span></p>`), acts: ''};
    }
    return {kind: '', sel: '', head: flashHtml(flash), body: '', acts: ''};
}
