// Paceline captain pages: the one first-party script, served as /static/app.js (static.mjs). The
// captain pages need it (plan versions spec decision 13): the Store form redraws itself when a
// choice changes, the team pages reload themselves, the team page swaps its panel in place (team
// cockpit spec §6) and an action that asks first does so in its place (arm in place, UI panel wave
// 2). Every such action also works without it, as a plain link or a plain POST the server answers
// with its page. It writes text only through textContent and builds elements with createElement;
// every text comes from the server's page or a data-* attribute.
// It inserts HTML the server sent, parsed, and never builds any: the cockpit's panel comes as the
// server drew it (the fragment), parsed with DOMParser, and goes in as nodes.
// Without a DOM (node --test) importing it gives the pure helpers and does nothing else.


// May the guarded reload run now? Not while the tab is hidden, a field has focus (input, select,
// textarea), a <details> holds it (holdsReload), a form was changed (spec §5.4 "Script") or an
// action's confirm strip is open (`armed`, UI panel wave 2: its words would be gone), nor while the
// page says so (`holding`: [data-hold-reload] on the page, an open Store form or a Store result in
// the cockpit, team cockpit spec §5.4; read at every tick, so a swap to a version releases it).
export function shouldReload({hidden, focused, openDetails, dirty, armed = false, holding = false}) {
    return !hidden && !focused && !openDetails && !dirty && !armed && !holding;
}


// The URL of the cockpit's panel fragment (shapes: GET <page>?<selection>&panel=1&tv=<data-tv>) for
// a row link, the close link or a redraw of the Store form (the page's URL with the form's fields):
// the href's path and query, with panel=1 and tv set once, no hash.
export function panelUrl(href, tv) {
    const u = new URL(href, 'http://localhost');
    u.searchParams.delete('panel');
    u.searchParams.delete('tv');
    u.searchParams.append('panel', '1');
    u.searchParams.append('tv', String(tv));
    return u.pathname + u.search;
}


// What the script does with a fragment's answer: an answer to an older pick (`asked` below `latest`,
// the counter of the fetches) is dropped, whatever it is; a 200 is swapped in; anything else (409:
// the page is stale; 404: the team is gone; 429; 0: a redirect to sign-in or no answer) loads the
// whole URL, and the server draws it.
export function swapDecision({asked, latest, status}) {
    if (asked !== latest) {
        return 'drop';
    }
    return status === 200 ? 'swap' : 'load';
}


// The selection of a URL's query `search` (shapes: ?v= wins over ?e=, ?e= over ?r=, a race's live
// pointer; an empty value is none).
const selOf = search => {
    const q = new URLSearchParams(search);
    const v = q.get('v') ?? '';
    const e = q.get('e') ?? '';
    const r = q.get('r') ?? '';
    return v !== '' ? {kind: 'v', id: v} : e !== '' ? {kind: 'e', id: e} : r !== '' ? {kind: 'r', id: r} : null;
};

// The body's classes for the selection of `search`: has-sel with anything picked (a version, a race's
// live pointer or a plan not stored yet: each is the same sheet on a phone, user 23 Nov 2026).
export function selClasses(search) {
    return {hasSel: selOf(search) !== null};
}

// The body's classes after a swap: {'has-sel'}, true or false, for the URL's query `search`, as the
// server draws them.
export function bodyClasses(search) {
    return {'has-sel': selClasses(search).hasSel};
}

// Where the address bar should be for a cockpit drawn at `pathname`: `here` (main's data-here, the
// cockpit's URL for what the page drew) when the page answers a POST at another URL (a refused Store
// at /manage/inbox/<id>, a refused Make live), else null. Without it a redraw, a Back to this entry
// or a reload would ask the POST's URL (the old Store a plan page).
export function cockpitHome(pathname, here) {
    if (typeof here !== 'string' || here === '') {
        return null;
    }
    return new URL(here, 'http://localhost').pathname === pathname ? null : here;
}


// A Back or Forward (popstate) at `state` {latest, shown} to the selection `key`: {latest, fetch}.
// Every one counts as a new pick (latest + 1), so an answer still on its way for an earlier step is
// dropped (Review Focus 3), also when this one fetches nothing because its selection is shown
// already (`fetch` false: a hash-only step, or Forward back to what is shown while Back's answer
// is still out).
export function popStep({latest, shown}, key) {
    return {latest: latest + 1, fetch: key !== shown};
}

// Where a swap leaves the page's scroll on a phone (below 1180 px, where a selection is a sheet and
// the list is gone): 'enter' (into a sheet: remember the list's place, show the sheet from its top,
// its first lines not under the sticky head), 'leave' (back to the list: restore the place), 'move'
// (from one selection to another: the sheet's top), or null (wide, or the same selection drawn
// again: the Store form's redraw keeps its place).
export function sheetScroll({narrow, wasSel, isSel, sameKey}) {
    if (!narrow) {
        return null;
    }
    if (!wasSel && isSel) {
        return 'enter';
    }
    if (wasSel && !isSel) {
        return 'leave';
    }
    return isSel && !sameKey ? 'move' : null;
}

// Where the focus goes after a click's swap: to #panel, which holds what is picked now; after the
// close link (`closing`) to the link of the row that was picked (`was`, its data-sel), as the emptied
// #panel is not shown (M6); #panel when nothing was picked. {to: 'panel'} or {to: 'row', key}.
export function focusAfter({closing, was}) {
    return closing && was !== null ? {to: 'row', key: was} : {to: 'panel'};
}

// The data-sel of the row a swap marks as picked: the one the swapped-in #panel names (its
// `dataset`: data-sel, the row its card shows: the selection's, or with nothing picked the nearest
// race's live version, team cockpit spec §5.3b), or null for none ('': a gone selection, no card).
export function pickedRow(dataset) {
    return typeof dataset?.sel === 'string' && dataset.sel !== '' ? dataset.sel : null;
}

// What a swap marks (shapes): {row, sheet}. `row` the data-sel of the row to mark as picked
// (pickedRow of the swapped-in #panel's `dataset`); `sheet` whether the URL's query `search` picks it
// (a phone's sheet: its path, sel-rows and sel-race, is marked too; the live row picked with nothing
// selected is marked alone).
export function swapMarks(dataset, search) {
    return {row: pickedRow(dataset), sheet: selKey(search) !== null};
}

// The key of the URL's query `search` ('v:<id>', 'e:<id>', 'r:<date>'), or null.
export function selKey(search) {
    const s = selOf(search);
    return s === null ? null : `${s.kind}:${s.id}`;
}


// The submit buttons of `form` that submitOnce disables: every <button> of form.elements that
// submits, also one outside the form that belongs to it by form="<its id>" (the cockpit's Store
// button stands in the card's action bar, outside its form, beside Discard's own form).
export function submitButtons(form) {
    return [...form.elements].filter(el => el.localName === 'button' && el.type === 'submit');
}


// Presses of a strip's confirm button this soon after the strip opened are ignored (UI panel wave 2):
// a double-click or double-tap on the action never confirms it.
export const ARM_GUARD_MS = 450;

// Does a press of the confirm button at `now` count, the strip opened at `armedAt` (ms, the same
// clock)? Not within ARM_GUARD_MS; always when no strip opened (null).
export function armPress(armedAt, now) {
    return armedAt === null || armedAt === undefined || now - armedAt >= ARM_GUARD_MS;
}


// What a submit of a POST form does (review M1, UI panel wave 2): a form that has posted already
// (`sent`) and waits for its answer posts no second time ('block': a double click on Make live or a
// strip's confirm button must not end on "Nothing was changed" after the change was made);
// one the page stopped (arming a strip, the 450 ms guard: `prevented`) is no post ('ignore'); any
// other posts once ('send'). A GET (the Store form's redraw goes another way) is never held.
export function submitDecision({method, sent, prevented}) {
    if (String(method).toLowerCase() !== 'post' || prevented) {
        return 'ignore';
    }
    return sent ? 'block' : 'send';
}


// Does a submit by `submitter` (null: none, as a form.submit() sends) go through a form's strip? Only
// its trigger's (data-arm-open, also Enter in a field, which presses the form's first button) and
// none: another submit button of the form posts as it is (the Store form's Store beside its Make
// live, user 23 Nov 2026). `submitter` is anything with matches(selector), or null.
export function armsOn(submitter) {
    return submitter === null || submitter.matches('[data-arm-open]');
}


// Does the trigger's press open the strip, or post at once? A form with data-arm-when asks only while
// its field (`field`: {value, drawn, hidden}, the value it was drawn with; null when there is none)
// is 'empty' (a start time cleared) or 'changed' (another zone); any other form always asks. A
// hidden field (inside a [hidden] box: the weekly start time while special is checked, which the
// server ignores) asks nothing.
export function armNeeded(when, field) {
    if (!when) {
        return true;
    }
    if (field === null || field === undefined || field.hidden === true) {
        return false;
    }
    if (when === 'empty') {
        return String(field.value ?? '').trim() === '';
    }
    if (when === 'changed') {
        return field.value !== field.drawn;
    }
    return true;
}


// Does one of these <details> hold the reload? An open one does, unless it is marked
// data-keep-refresh: a fold that holds no form input (the picker's "Other teams", the riders' help)
// would otherwise freeze the page for as long as it is left open.
// A field of a form whose value the browser put back (Back, a restored tab): holds the reload like a
// typed one. Text fields and text areas only; their defaultValue is what the page was drawn with.
export function restoredInput(fields) {
    for (const f of fields) {
        if ((f.type === 'textarea' || f.type === 'text' || f.type === 'search') && f.value !== f.defaultValue) {
            return true;
        }
    }
    return false;
}


// Does a field typed in hold the reload? `dirty` is a typed field outside every ⋯ menu (it holds for
// good, as before); `typedMenus` the ⋯ menus (details[data-menu]) with a field typed in, which hold
// only while they are open: a ⋯ closed without saving lets the page reload again.
export function typedHolds(dirty, typedMenus) {
    if (dirty) {
        return true;
    }
    for (const m of typedMenus) {
        if (m.open) {
            return true;
        }
    }
    return false;
}


// The text a strip's span data-arm-fill shows for its field's `value` (trimmed): with `format` 'day'
// a 'YYYY-MM-DD' as the pages write a day ('Sun 22 Nov', time.mjs localDay's format); an empty value
// is `empty` (a weekly race's empty time: the team's start time), else ''. `pre` goes before any text,
// never before nothing (the space before a time that may be empty: no "Sun 22 Nov .").
const DAY_FORMAT = typeof Intl === 'undefined' ? null : new Intl.DateTimeFormat('en-GB', {weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC'});
export function fillText(value, {format = null, empty = '', pre = ''} = {}) {
    const text = dayText(String(value ?? '').trim(), format) || (empty ?? '');
    return text === '' ? '' : `${pre ?? ''}${text}`;
}

// The trimmed value `v` as fillText shows it: a day with `format` 'day', else as it is.
function dayText(v, format) {
    if (v === '') {
        return '';
    }
    if (format === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(v) && DAY_FORMAT !== null) {
        const ms = Date.parse(`${v}T12:00:00Z`);
        if (Number.isFinite(ms)) {
            const p = Object.fromEntries(DAY_FORMAT.formatToParts(ms).map(x => [x.type, x.value]));
            return `${p.weekday} ${p.day} ${p.month}`;
        }
    }
    return v;
}


export function holdsReload(details) {
    for (const d of details) {
        if (d.open && !('keepRefresh' in d.dataset)) {
            return true;
        }
    }
    return false;
}


// What the HEAD check's answer means: `answer` is {ok, status, type} of the response, or null when
// the fetch threw. A page that answers (or is gone, 404) reloads; a redirect (to sign-in, seen as
// 'opaqueredirect' with redirect: 'manual') means signed out; anything else is a server error.
export function reloadDecision(answer) {
    if (answer === null) {
        return {action: 'stale', why: 'offline'};
    }
    if (answer.ok || answer.status === 404) {
        return {action: 'reload'};
    }
    return {action: 'stale', why: answer.type === 'opaqueredirect' ? 'signedout' : 'error'};
}


// The Store form's fields whose change redraws it (spec §6.10): the team, the plan, the race (its
// radio, races Task 7), the race date and the start time (no Make live box any more: Make live and
// Store are the action bar's buttons, user 23 Nov 2026). Never the type or the event link: typing is
// never cut off. The date and the time wait (dateRedraw, startRedraw): typed digit by digit they
// change at every digit.
const REDRAW = new Set(['team', 'as', 'race', 'date', 'start']);

export function redrawOn(name) {
    return REDRAW.has(name);
}


// Does the race date redraw the page? Only a complete, real date (a four-digit year: typed digit by
// digit the year reads 0002, 0020, 0202 first) that differs from the one the page was drawn with.
// The script asks once the field is left, or after a second without typing.
export function dateRedraw(value, drawn) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
    if (m === null || Number(m[1]) < 1000 || value === drawn) {
        return false;
    }
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}


// Does a `change` of the race date redraw the page at once? Only when it came from the calendar
// (team cockpit spec §5.3b: the date field opens it on a click), not from digits typed in the field
// (`typed`: a key was pressed in it since it was drawn or last redrawn): a typed date waits as
// dateRedraw says, until the field is left or a second after the last digit, so a half-typed day
// (19 typed as 1, then 9) never redraws.
export function dateChangeRedraw({typed, value, drawn}) {
    return !typed && dateRedraw(value, drawn);
}


// Does the start time redraw the page? Only a complete time 'HH:MM' (00:00-23:59) that differs from
// the one the page was drawn with; asked as for the date.
export function startRedraw(value, drawn) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value ?? '') && value !== drawn;
}


// Does the event link redraw the page? Once the field is left (never while typing: a link is pasted
// or typed in one go), when it differs from the one the page was drawn with, trimmed: a warning
// line then says what the link does to the race before Store (review M4).
export function eventRedraw(value, drawn) {
    return String(value ?? '').trim() !== String(drawn ?? '').trim();
}


// The hidden `raceOpen` field of the Store form: '1' while its race fold is open, else ''. A redraw
// sends it, and the server draws the fold open again (store-form.mjs), so a redraw never snaps shut
// the fold the captain opened.
export function foldField(open) {
    return open ? '1' : '';
}


// Does a redraw close the race fold it draws? Only when it was sent with the fold open (`sent`) and
// the captain closed it while the redraw ran (`openNow` false: a click on its summary leaves a field
// of it first, which sends the redraw): the fold stays as the captain left it, not reopened once.
export function keepShut(sent, openNow) {
    return sent && openNow === false;
}


// The hidden `touched` field: 'type' when the captain changed the type by hand, else ''. A redraw
// for another team or plan keeps it (Ruling 6).
const TOUCHABLE = ['type'];

export function touchedList(set) {
    return TOUCHABLE.filter(name => set.has(name)).join(',');
}


// A signal that aborts after `ms`: AbortSignal.timeout where the browser has it, else (iOS 15
// Safari) an AbortController aborted by a timer; without AbortController none (no deadline). `g` is
// the global object, a stand-in in the tests.
export function timeoutSignal(ms, g = globalThis) {
    if (typeof g.AbortSignal?.timeout === 'function') {
        return g.AbortSignal.timeout(ms);
    }
    if (typeof g.AbortController !== 'function') {
        return undefined;
    }
    const c = new g.AbortController();
    g.setTimeout(() => c.abort(), ms);
    return c.signal;
}


// The AbortController of the Store form bindAssign bound last (its listeners go with the form a swap
// replaces); declared before the start, which binds the first.
let boundAssign = null;

if (typeof document !== 'undefined') {
    document.documentElement.classList.add('js');

    reveal(document);

    guardedReload();
    switcher();
    // before arms(): its Esc listener runs first, so an Esc that closes an open strip in a menu leaves
    // the menu open
    menus();
    arms();
    submitOnce();
    copyButtons();
    panel();
    rhythmChoice();
}


// Script-only controls ship hidden; reveal them (in the page, and in a panel swapped in).
function reveal(root) {
    for (const el of root.querySelectorAll('[data-js][hidden]')) {
        el.hidden = false;
    }
}


// ---- guarded reload (the <noscript> meta refresh's stand-in) ----
// Every data-refresh seconds, when shouldReload allows it, a HEAD of this page first: if it
// answers, reload; else (no answer within 10 s counts as offline) show "Not updated since …" and
// try again after the interval. While the page is busy, look again every 5 s.
const HEAD_TIMEOUT_MS = 10000;

function guardedReload() {
    const body = document.body;
    const every = Number(body.dataset.refresh) * 1000;
    // a value the browser put back after Back counts as typed; a field in a ⋯ menu holds only while
    // its menu is open (typedHolds)
    // a field in the cockpit's swapped slots (#panel, #panel-body: the Store form) holds only while
    // it is on the page: a swap to a version or to nothing releases it (Ruling F5)
    const menuOf = el => el.closest('details[data-menu]');
    const inSlot = el => el.closest('#panel, #panel-body, #panel-acts') !== null;
    const typedMenus = new Set();
    const typedSlots = new Set();
    const fields = [...document.querySelectorAll('form input, form textarea')];
    let dirty = restoredInput(fields.filter(f => menuOf(f) === null && !inSlot(f)));
    for (const f of fields) {
        if (menuOf(f) !== null && restoredInput([f])) {
            typedMenus.add(menuOf(f));
        } else if (menuOf(f) === null && inSlot(f) && restoredInput([f])) {
            typedSlots.add(f);
        }
    }
    const typed = el => {
        const m = menuOf(el);
        if (m !== null) {
            typedMenus.add(m);
        } else if (inSlot(el)) {
            typedSlots.add(el);
        } else {
            dirty = true;
        }
    };
    const slotTyped = () => [...typedSlots].some(f => f.isConnected);
    // 'change' too: a chosen file or a picked option counts as a changed form. And a
    // click on a file input: Safari and Firefox on macOS don't focus it while the chooser is open, so
    // without this a reload could cancel a choice still being made.
    for (const type of ['input', 'change']) {
        document.addEventListener(type, e => {
            if (e.target instanceof Element && e.target.closest('form')) {
                typed(e.target);
            }
        });
    }
    document.addEventListener('click', e => {
        if (e.target instanceof Element && e.target.closest('form input[type="file"], form label:has(input[type="file"])')) {
            dirty = true;
        }
    }, true);
    for (const a of document.querySelectorAll('[data-reload]')) {
        a.addEventListener('click', e => {
            e.preventDefault();
            location.reload();
        });
    }
    if (!(every > 0)) {
        return;
    }
    const WHY = {offline: 'whyOffline', signedout: 'whySignedout', error: 'whyError'};
    function showStale(why) {
        const line = document.querySelector('[data-stale]');
        if (!line) {
            return;
        }
        const since = line.querySelector('[data-stale-since]');
        if (since) {
            since.textContent = body.dataset.updated || '';
        }
        const reason = line.querySelector('[data-stale-why]');
        if (reason) {
            reason.textContent = line.dataset[WHY[why]] || '';
        }
        line.hidden = false;
        document.querySelector('.fresh')?.classList.add('is-stale');
    }
    // asked before the HEAD and again once it answered (a field focused or a Store form swapped in
    // meanwhile holds it)
    const free = () => {
        const active = document.activeElement;
        return shouldReload({
            hidden: document.hidden,
            focused: Boolean(active && active.matches('input, select, textarea')),
            openDetails: holdsReload(document.querySelectorAll('details')),
            dirty: typedHolds(dirty || slotTyped(), typedMenus),
            armed: document.querySelector('form[data-arm].armed') !== null,
            holding: document.querySelector('[data-hold-reload]') !== null,
        });
    };
    async function tick() {
        if (!free()) {
            setTimeout(tick, 5000);
            return;
        }
        let answer = null;
        try {
            const r = await fetch(location.href, {
                method: 'HEAD', redirect: 'manual', cache: 'no-store', credentials: 'same-origin', signal: timeoutSignal(HEAD_TIMEOUT_MS),
            });
            answer = {ok: r.ok, status: r.status, type: r.type};
        } catch {
            answer = null;
        }
        const decision = reloadDecision(answer);
        if (decision.action === 'reload') {
            if (!free()) {
                setTimeout(tick, 5000);
                return;
            }
            location.reload();
            return;
        }
        showStale(decision.why);
        setTimeout(tick, every);
    }
    setTimeout(tick, every);
}


// ---- team switcher: close on an outside click and on Esc ----
// At 1024 px and wider the list is always shown beside the page, so its summary leaves the tab order.
function switcher() {
    const sw = document.querySelector('details.switch[data-switch]');
    const summary = sw?.querySelector('summary');
    if (!summary) {
        return;
    }
    document.addEventListener('click', e => {
        if (sw.open && !sw.contains(e.target)) {
            sw.open = false;
        }
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && sw.open) {
            sw.open = false;
            summary.focus();
        }
    });
    const wide = matchMedia('(min-width: 1024px)');
    const tabStop = () => {
        if (wide.matches) {
            summary.setAttribute('tabindex', '-1');
        } else {
            summary.removeAttribute('tabindex');
        }
    };
    tabStop();
    wide.addEventListener('change', tabStop);
}


// ---- the ⋯ menus (races spec §4): one open at a time; Esc and a click outside close it ----
// Opening a menu closes the others (as the team switcher's panel). Esc closes the open one and gives
// the focus back to its summary, unless a strip is open in it (arms() closes that first); a click
// outside it closes it. Without the script each is a plain <details>.
function menus() {
    const all = () => document.querySelectorAll('details[data-menu]');
    for (const m of all()) {
        m.addEventListener('toggle', () => {
            if (m.open) {
                for (const other of all()) {
                    if (other !== m && other.open) {
                        other.open = false;
                    }
                }
            }
        });
    }
    document.addEventListener('click', e => {
        for (const m of all()) {
            if (m.open && !(e.target instanceof Node && m.contains(e.target))) {
                m.open = false;
            }
        }
    });
    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') {
            return;
        }
        for (const m of all()) {
            if (m.open && m.querySelector('form[data-arm].armed') === null) {
                m.open = false;
                m.querySelector('summary')?.focus();
            }
        }
    }, true);
}


// ---- arm in place (UI panel wave 2): an action that asks first turns, in its place, into a strip ----
// The trigger's press (data-arm-open, or Enter in a field of its form) opens the form's strip (what
// it does, the confirm button and Cancel) instead of posting, when armNeeded says so; the confirm
// button posts with confirm=1. One strip open at a time; no timeout; Esc and Cancel close it and
// give the focus back to the trigger. The focus goes to the confirm button, whose description is the
// words; presses of it within ARM_GUARD_MS of opening, and a held key's repeats, are ignored. A
// span data-arm-fill="<field>" in the words shows that field's value (the Zwift ID typed; fillText:
// data-arm-format="day" writes a date as a day, data-arm-empty is the text for an empty field,
// data-arm-pre goes before any text). A
// <details> closed around the open strip (a ⋯ menu closed by a click outside, a fold) closes the
// strip too, so no hidden strip holds the page's reload. The Store form's Make live (user, 23 Nov
// 2026) is the same with its parts outside the form: the trigger and the confirm button belong to it
// by form="<its id>", the strip names it by data-for and stands in the action bar, which is marked
// armed while it is open (the bar's buttons give it their place); only the trigger arms, the
// form's other submit button (Store) posts as it is.
function arms() {
    let open = null;
    // a part of form `f`: inside it, or outside it and its own (form="<id>", data-for="<id>")
    const part = (f, sel) => f.querySelector(sel)
        ?? [...document.querySelectorAll(sel)].find(el => el.form === f || (f.id !== '' && el.dataset.for === f.id)) ?? null;
    const strip = f => part(f, '[data-arm-strip]');
    // the strip's place when it stands outside its form: its parent (the action bar)
    const host = f => {
        const s = strip(f);
        return s !== null && !f.contains(s) ? s.parentElement : null;
    };
    const close = focus => {
        if (open === null) {
            return;
        }
        const f = open.form;
        open = null;
        f.classList.remove('armed');
        host(f)?.classList.remove('armed');
        strip(f).hidden = true;
        if (focus) {
            part(f, '[data-arm-open]')?.focus();
        }
    };
    const fill = f => {
        for (const span of f.querySelectorAll('[data-arm-fill]')) {
            span.textContent = fillText(f.elements.namedItem(span.dataset.armFill)?.value,
                {format: span.dataset.armFormat ?? null, empty: span.dataset.armEmpty ?? '', pre: span.dataset.armPre ?? ''});
        }
    };
    const arm = f => {
        if (open?.form !== f) {
            close(false);
        }
        fill(f);
        f.classList.add('armed');
        host(f)?.classList.add('armed');
        strip(f).hidden = false;
        open = {form: f, at: performance.now()};
        const yes = part(f, '[data-arm-yes]');
        yes?.focus({preventScroll: true});
        yes?.scrollIntoView({block: 'nearest'});
    };
    const fieldOf = f => {
        const el = f.elements.namedItem(f.dataset.armField ?? '');
        if (!el || !('value' in el)) {
            return null;
        }
        const drawn = el instanceof HTMLSelectElement ? ([...el.options].find(o => o.defaultSelected)?.value ?? el.options[0]?.value ?? '') : el.defaultValue;
        return {value: el.value, drawn, hidden: el.closest('[hidden]') !== null};
    };
    // the capture phase: before the Store form's own submit listener
    document.addEventListener('submit', e => {
        const f = e.target;
        if (!(f instanceof HTMLFormElement) || !f.matches('[data-arm]')) {
            return;
        }
        if (e.submitter?.matches('[data-arm-yes]')) {
            if (!armPress(open?.form === f ? open.at : null, performance.now())) {
                e.preventDefault();
            }
            return;
        }
        // another submit button of the form (the Store form's Store) posts without asking
        if (!armsOn(e.submitter ?? null)) {
            return;
        }
        if (armNeeded(f.dataset.armWhen, f.dataset.armWhen ? fieldOf(f) : null)) {
            e.preventDefault();
            arm(f);
        }
    }, true);
    document.addEventListener('click', e => {
        if (e.target instanceof Element && e.target.closest('[data-arm-cancel]')) {
            close(true);
        }
    });
    // toggle does not bubble: the capture phase sees every <details>
    document.addEventListener('toggle', e => {
        if (open !== null && e.target instanceof HTMLDetailsElement && !e.target.open && e.target.contains(open.form)) {
            close(false);
        }
    }, true);
    // a field of the open strip's form edited after arming: the words follow it (review M3)
    document.addEventListener('input', e => {
        if (open !== null && e.target instanceof Element && open.form.contains(e.target)) {
            fill(open.form);
        }
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && open !== null) {
            close(true);
        }
        if (e.repeat && e.target instanceof Element && e.target.matches('[data-arm-yes]')) {
            e.preventDefault();
        }
    }, true);
}


// ---- a POST form posts once (submitDecision): its submit buttons are disabled until the page
// answers (after the submit, so the pressed button's confirm=1 still goes along); a page shown again
// from the back-forward cache takes them back ----
const RETRY_MS = 10000;

function submitOnce() {
    let sent = new WeakSet();
    document.addEventListener('submit', e => {
        const f = e.target;
        if (!(f instanceof HTMLFormElement)) {
            return;
        }
        const d = submitDecision({method: f.getAttribute('method') ?? 'get', sent: sent.has(f), prevented: e.defaultPrevented});
        if (d === 'block') {
            e.preventDefault();
        } else if (d === 'send') {
            sent.add(f);
            const buttons = submitButtons(f);
            setTimeout(() => {
                for (const b of buttons) {
                    b.disabled = true;
                }
            }, 0);
            // still here after RETRY_MS (the captain stopped a slow POST: Esc or the browser's Stop):
            // the buttons come back, so he can try again (a retry is safe: version checks, "gone")
            setTimeout(() => {
                sent.delete(f);
                for (const b of buttons) {
                    b.disabled = false;
                }
            }, RETRY_MS);
        }
    });
    // every showing of the page (also Firefox keeping the disabled state across a reload, and the
    // back-forward cache) starts with its buttons usable: the server never draws a disabled button
    addEventListener('pageshow', () => {
        sent = new WeakSet();
        for (const b of document.querySelectorAll('button[disabled]')) {
            b.disabled = false;
        }
    });
}


// ---- copy buttons: data-copy to the clipboard, data-copied on the button for 2 s ----
function copyButtons() {
    for (const b of document.querySelectorAll('[data-copy]')) {
        const label = b.textContent;
        let timer = null;
        b.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(b.dataset.copy);
            } catch {
                return;
            }
            b.textContent = b.dataset.copied || label;
            clearTimeout(timer);
            timer = setTimeout(() => {
                b.textContent = label;
            }, 2000);
        });
    }
}


// ---- the race rhythm (Add a team, team settings): the weekly fields only with weekly checked ----
// Without the script they simply show (a special team ignores them).
function rhythmChoice() {
    for (const set of document.querySelectorAll('fieldset[data-rhythm]')) {
        const weekly = set.querySelector('[data-weekly]');
        if (!weekly) {
            continue;
        }
        const sync = () => {
            weekly.hidden = set.querySelector('input[name=kind][value=special]')?.checked === true;
        };
        set.addEventListener('change', sync);
        sync();
    }
}


// ---- the team cockpit's panel in place (team cockpit spec §6) ----
// Only on a page with main[data-tv] (the cockpit). A plain left click on a row (a.cp-link) or on the
// close link (a.cp-close) fetches the fragment of the two slots for the link's URL (panelUrl, with
// the page's data-tv) instead of loading the page; its answer (swapDecision) is swapped in, dropped
// when a later pick or redraw asked since, or, for anything but a 200 or a thrown fetch, the whole
// URL is loaded. A swap puts in #panel, #panel-body and #panel-acts (the card's actions, user 23 Nov
// 2026) as the server drew them (a received plan's Store form is in #panel-body, its buttons in
// #panel-acts: the list never changes), moves the pick's marks (picked,
// aria-current, sel-rows, sel-race) to the row the swapped #panel names (data-sel: the selection's,
// or with nothing picked the nearest race's live version, team cockpit spec §5.3b) and the body's
// has-sel to the new selection (bodyClasses), pushes the link's URL without its hash (so the guarded reload keeps the selection),
// binds the Store form and moves the focus to #panel (after the close link to the row that was
// picked: focusAfter). Back and Forward (popstate) swap the same way
// for the URL they land on, without a push. The Store form's redraw is the same fetch, for the page's
// URL with the form's fields (bindAssign). A cockpit that answers a POST at another URL (a refused
// Store) first puts its own URL (main's data-here, cockpitHome) in the address bar. The state is
// local: this runs while the module is still evaluated.
function panel() {
    const main = document.querySelector('main[data-tv]');
    if (main === null) {
        return;
    }
    // a page answering a POST names the cockpit URL of what it drew: that goes in the address bar
    const home = cockpitHome(location.pathname, main.dataset.here);
    if (home !== null) {
        history.replaceState(null, '', home);
    }
    let latest = 0;
    let shown = selKey(location.search);
    let listY = null;            // the list's scroll while a sheet is open (phones)
    let scrolled = false;        // the last swap set the scroll itself: the focus must not move it again
    const rows = () => [...document.querySelectorAll('.cp-row[data-sel]')];
    // `sheet`: the URL picked it (the phone's sheet: sel-rows, sel-race mark its path); the live row
    // picked with nothing selected is marked alone
    const mark = (key, sheet) => {
        for (const el of document.querySelectorAll('.cp-row.picked')) {
            el.classList.remove('picked');
        }
        for (const el of document.querySelectorAll('a.cp-link[aria-current]')) {
            el.removeAttribute('aria-current');
        }
        for (const cls of ['sel-rows', 'sel-race']) {
            for (const el of document.querySelectorAll(`.${cls}`)) {
                el.classList.remove(cls);
            }
        }
        const row = key === null ? undefined : rows().find(r => r.dataset.sel === key);
        if (row === undefined) {
            return;
        }
        row.classList.add('picked');
        row.querySelector(':scope > a.cp-link')?.setAttribute('aria-current', 'true');
        if (sheet) {
            row.closest('ul.cp-rows')?.classList.add('sel-rows');
            row.closest('.cp-race')?.classList.add('sel-race');
        }
        // the races that are over: their fold is open while it holds the pick, as the server draws it
        const over = row.closest('details.over');
        if (over && !over.open) {
            over.open = true;
        }
    };
    // the answer `text` for the URL `to` in place; false, with nothing changed, when it lacks a slot
    // (then the page loads)
    const swap = (text, to) => {
        const y = scrollY;            // first of all: the slots going in move the page (scroll anchoring), the hidden list clamps it
        const doc = new DOMParser().parseFromString(text, 'text/html');
        const head = doc.getElementById('panel');
        const body = doc.getElementById('panel-body');
        const acts = doc.getElementById('panel-acts');
        const oldHead = document.getElementById('panel');
        const oldBody = document.getElementById('panel-body');
        const oldActs = document.getElementById('panel-acts');
        if (!head || !body || !acts || !oldHead || !oldBody || !oldActs) {
            return false;
        }
        // the form going out takes its listeners along first: its focused field, removed, must not
        // leave it (focusout) and send a second redraw of what this one draws
        boundAssign?.abort();
        boundAssign = null;
        oldHead.replaceWith(head);
        oldBody.replaceWith(body);
        oldActs.replaceWith(acts);
        for (const el of [head, body, acts]) {
            reveal(el);
        }
        const url = new URL(to, location.href);
        const key = selKey(url.search);
        const wasSel = document.body.classList.contains('has-sel');
        const marks = swapMarks(head.dataset, url.search);
        mark(marks.row, marks.sheet);
        for (const [cls, on] of Object.entries(bodyClasses(url.search))) {
            document.body.classList.toggle(cls, on);
        }
        const step = sheetScroll({narrow: matchMedia('(max-width:1179.98px)').matches, wasSel, isSel: document.body.classList.contains('has-sel'), sameKey: key === shown});
        scrolled = step !== null;
        if (step === 'enter') {
            listY = y;
        }
        if (step === 'leave' && listY !== null) {
            scrollTo(0, listY);
            listY = null;
        } else if (step !== null) {
            scrollTo(0, 0);
        }
        shown = key;
        bindAssign(body.querySelector('form[data-assign]'), redraw);
        return true;
    };
    // fetch the fragment for `to` (a URL of this page) and act on the answer; `load` goes to the
    // whole page (assign or replace); `before` runs right before a swap, `done` after it
    const fetchSwap = async (to, {load, before = null, done}) => {
        const asked = ++latest;
        let status = 0;
        let text = '';
        try {
            const r = await fetch(panelUrl(to, main.dataset.tv), {credentials: 'same-origin', cache: 'no-store', redirect: 'manual'});
            status = r.status;
            if (status === 200) {
                text = await r.text();
            }
        } catch {
            status = 0;
        }
        const d = swapDecision({asked, latest, status});
        if (d === 'drop') {
            return;
        }
        before?.();
        if (d === 'load' || !swap(text, to)) {
            load(to);
            return;
        }
        done?.();
    };
    // the Store form's redraw (bindAssign): `to` the page's URL with the form's fields; the focus goes
    // back to the field named `focus`. The race fold the captain closed while the redraw ran (a click
    // on its summary that left a field of it, which sent the redraw with raceOpen=1) stays closed, the
    // focus on its summary (keepShut)
    function redraw(to, focus) {
        const sent = new URL(to, location.href).searchParams.get('raceOpen') === '1';
        let shut = false;
        fetchSwap(to, {load: u => location.replace(u), before: () => {
            shut = keepShut(sent, document.querySelector('#panel-body form[data-assign] details.as-race')?.open ?? null);
        }, done: () => {
            const form = document.querySelector('#panel-body form[data-assign]');
            const fold = form?.querySelector('details.as-race') ?? null;
            if (shut && fold !== null) {
                fold.open = false;
                const field = form.querySelector('input[name=raceOpen]');
                if (field) {
                    field.value = foldField(false);
                }
                fold.querySelector('summary')?.focus({preventScroll: true});
            } else if (form) {
                focusField(form, focus);
            }
        }});
    }
    document.addEventListener('click', e => {
        const plain = e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
        if (e.defaultPrevented || !plain || !(e.target instanceof Element)) {
            return;
        }
        const a = e.target.closest('a.cp-link, a.cp-close');
        if (!a || !main.contains(a)) {
            return;
        }
        e.preventDefault();
        const url = new URL(a.href, location.href);
        url.hash = '';
        // the row picked now (a race's live pointer, ?r=, names no row by its key)
        const was = document.querySelector('.cp-row.picked')?.dataset.sel ?? shown;
        fetchSwap(a.href, {load: u => location.assign(u), done: () => {
            // the row picked already: no second history entry
            if (url.pathname + url.search !== location.pathname + location.search) {
                history.pushState(null, '', url.pathname + url.search);
            }
            const f = focusAfter({closing: a.matches('a.cp-close'), was});
            const row = f.to === 'row' ? rows().find(r => r.dataset.sel === f.key)?.querySelector(':scope > a.cp-link') ?? null : null;
            (row !== null && row.getClientRects().length > 0 ? row : document.getElementById('panel'))?.focus({preventScroll: scrolled});
        }});
    });
    addEventListener('popstate', () => {
        const step = popStep({latest, shown}, selKey(location.search));
        latest = step.latest;
        if (!step.fetch) {
            return;
        }
        fetchSwap(location.href, {load: u => location.replace(u), done: null});
    });
    bindAssign(document.querySelector('form[data-assign]'), redraw);
}


// The field named `name` of `form` gets the focus (the checked one of a radio group), the fold it
// sits in opened first.
function focusField(form, name) {
    if (name === null || name === undefined) {
        return;
    }
    const fields = [...form.querySelectorAll('input, select, textarea')].filter(el => el.name === name);
    const el = fields.find(f => f.checked) ?? fields[0];
    const fold = el?.closest('details');
    if (fold && !fold.open) {
        fold.open = true;
    }
    el?.focus({preventScroll: true});
}


// ---- the Store form (the team page's): a change of team, race, plan, live box, date, start time
// or event link redraws it ----
// The server draws the form again with its fields (the preview; no button), on `change` only:
// typing in the type or the event link never redraws. A date picked in the calendar (a click on the
// field opens it) redraws on its `change` at once (dateChangeRedraw). `redraw(to, focus)` fetches the panel for the
// page's URL with the form's fields and swaps it in (panel()). The
// date and the start time redraw when they are left, or a second after the last digit, once
// complete and other than the drawn value (dateRedraw, startRedraw): never in the middle of typing
// them. The event link redraws once it is left with another link than the drawn one (eventRedraw).
// The type and the live box the captain touched go along in `touched`, also those touched before an
// earlier redraw or a refused Store (the server draws what it received into the field; a redraw
// also has them in its query), so a redraw never resets them. The race fold (the date, the time and
// the link) opened or closed sets the hidden `raceOpen` (foldField), so a redraw keeps it open. The
// swap focuses the field the captain went to (its fold opened first). A second trigger before the redraw is done
// (leaving the date by a click on a radio) goes again with the form as it is then: the last one
// wins. Leaving the date, the time or the link for Store or Discard redraws nothing: the POST goes
// instead. Bound again to each form a swap puts in; the listeners of the form before go with it.
// The wait is a local: this runs while the module is still evaluated, before a later module-level
// const is set; the bound form's AbortController (boundAssign) is declared above the start.
function bindAssign(form, redraw) {
    const DATE_WAIT_MS = 1000;
    boundAssign?.abort();
    boundAssign = null;
    const out = form?.querySelector('input[name=touched]');
    if (!out) {
        return;
    }
    const bound = new AbortController();
    boundAssign = bound;
    const {signal} = bound;
    const touched = new Set([
        ...(new URLSearchParams(location.search).get('touched') ?? '').split(','),
        ...out.value.split(','),
    ]);
    const write = () => {
        out.value = touchedList(touched);
    };
    write();
    const touch = e => {
        if (e.target?.name === 'type') {
            touched.add('type');
            write();
        }
    };
    // the fields that wait for a complete value: whether it redraws, against the drawn one
    const waiting = {
        date: {ok: dateRedraw, drawn: form.querySelector('input[name=date]')?.value ?? null},
        start: {ok: startRedraw, drawn: form.querySelector('input[name=start]')?.value ?? null},
        event: {ok: eventRedraw, drawn: form.querySelector('input[name=event]')?.value ?? null},
    };
    // the date and the time redraw a second after typing too; the event link only once left
    const waits = el => (el?.name === 'date' || el?.name === 'start') && el.type !== 'hidden';
    // a key pressed in the date since the form was drawn: its change is typing, not the calendar
    let typed = false;
    const leaves = el => waits(el) || el?.name === 'event';
    let timer = null;
    signal.addEventListener('abort', () => clearTimeout(timer));
    // `as` and `team` are radios; FormData sends only the checked one, and no live box when off: the
    // page's URL (its selection) with the form's fields in place of any it had.
    const target = () => {
        const fields = new URLSearchParams(new FormData(form));
        const to = new URL(location.href);
        to.hash = '';
        for (const k of new Set(fields.keys())) {
            to.searchParams.delete(k);
        }
        for (const [k, v] of fields) {
            to.searchParams.append(k, v);
        }
        return to;
    };
    const go = focus => {
        clearTimeout(timer);
        const to = target();
        redraw(to.pathname + to.search, focus);
    };
    const due = el => waiting[el.name].ok(el.value, waiting[el.name].drawn);
    const soon = el => {
        clearTimeout(timer);
        if (due(el)) {
            timer = setTimeout(() => go(el.name), DATE_WAIT_MS);
        }
    };
    form.addEventListener('keydown', e => {
        if (e.target?.name === 'date') {
            typed = true;
        }
        // Enter in a field stores (Store), never makes live: the form's first button by tree order is
        // Make live (user, 23 Nov 2026), which a field's Enter would otherwise press
        if (e.key === 'Enter' && !e.isComposing && e.target instanceof HTMLInputElement && !['submit', 'button', 'reset'].includes(e.target.type)) {
            const store = [...form.elements].find(b => b.matches('button[data-submit="store"]'));
            if (store) {
                e.preventDefault();
                form.requestSubmit(store);
            }
        }
    }, {signal});
    // the race fold opened or closed: its hidden raceOpen follows, so a redraw draws it as the
    // captain left it (toggle does not bubble: the capture phase sees it)
    const raceOpen = form.querySelector('input[name=raceOpen]');
    form.addEventListener('toggle', e => {
        if (raceOpen && e.target instanceof HTMLDetailsElement && e.target.matches('details.as-race')) {
            raceOpen.value = foldField(e.target.open);
        }
    }, {signal, capture: true});
    // a required field left empty in the closed fold (a special team's date or time): the browser
    // cannot show its message there, so the fold opens (invalid does not bubble either)
    form.addEventListener('invalid', e => {
        const fold = e.target instanceof Element ? e.target.closest('details') : null;
        if (fold && !fold.open) {
            fold.open = true;
        }
    }, {signal, capture: true});
    // a click anywhere in the date opens its calendar where the browser can (spec §5.3b); without
    // it, or without the script, it is a plain date field
    form.addEventListener('click', e => {
        const el = e.target;
        if (el instanceof HTMLInputElement && el.type === 'date' && el.name === 'date' && !el.readOnly && typeof el.showPicker === 'function') {
            try {
                el.showPicker();
            } catch {
                // not allowed here (no user activation, a cross-origin frame): the field as it is
            }
        }
    }, {signal});
    form.addEventListener('input', e => {
        touch(e);
        if (waits(e.target) && (e.target.name !== 'date' || typed)) {
            soon(e.target);
        }
    }, {signal});
    form.addEventListener('change', e => {
        touch(e);
        const name = e.target?.name;
        if (name === 'date' && dateChangeRedraw({typed, value: e.target.value, drawn: waiting.date.drawn})) {
            go(name);
        } else if (waits(e.target)) {
            soon(e.target);
        } else if (redrawOn(name)) {
            go(name);
        }
    }, {signal});
    // leaving the date, the time or the event link: at once, focusing where the captain went (a
    // radio's own change follows)
    form.addEventListener('focusout', e => {
        if (!leaves(e.target)) {
            return;
        }
        // to Store or Discard: the POST takes the field along (or the entry goes); a date for another
        // race than the page's is refused there and the page drawn for it (manage-inbox.mjs)
        if (e.relatedTarget instanceof Element && e.relatedTarget.matches('[type=submit]')) {
            clearTimeout(timer);
            return;
        }
        if (due(e.target)) {
            go(e.relatedTarget?.name || e.target.name);
        }
    }, {signal});
    // a Store or Discard while the date's second runs: no redraw after it
    document.addEventListener('submit', () => clearTimeout(timer), {signal});
}
