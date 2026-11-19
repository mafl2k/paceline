// Paceline captain pages: the one first-party script, served as /static/app.js (static.mjs). The
// captain pages need it (plan versions spec decision 13): the assign page redraws itself when a
// choice changes, the team pages reload themselves, and an action that asks first does so in its
// place (arm in place, UI panel wave 2). Every such action also works without it, as a plain POST
// the server answers with its confirm page. It writes text only through textContent and builds
// elements with createElement; every text comes from the server's page or a data-* attribute.
// Without a DOM (node --test) importing it gives the pure helpers and does nothing else.


// May the guarded reload run now? Not while the tab is hidden, a field has focus (input, select,
// textarea), a <details> holds it (holdsReload), a form was changed (spec §5.4 "Script") or an
// action's confirm strip is open (`armed`, UI panel wave 2: its words would be gone).
export function shouldReload({hidden, focused, openDetails, dirty, armed = false}) {
    return !hidden && !focused && !openDetails && !dirty && !armed;
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
// (`sent`) and waits for its answer posts no second time ('block': a double click on Make live,
// Undo or a strip's confirm button must not end on "Nothing was changed" after the change was made);
// one the page stopped (arming a strip, the 450 ms guard: `prevented`) is no post ('ignore'); any
// other posts once ('send'). A GET (the assign page's redraw goes another way) is never held.
export function submitDecision({method, sent, prevented}) {
    if (String(method).toLowerCase() !== 'post' || prevented) {
        return 'ignore';
    }
    return sent ? 'block' : 'send';
}


// Does the trigger's press open the strip, or post at once? A form with data-arm-when asks only while
// its field (`field`: {value, drawn}, the value it was drawn with; null when there is none) is
// 'empty' (a start time cleared) or 'changed' (another zone); any other form always asks.
export function armNeeded(when, field) {
    if (!when) {
        return true;
    }
    if (field === null || field === undefined) {
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


// The assign page's fields whose change redraws the page (spec §6.10): the team, the plan, the live
// box, the race date and a special team's start time. Never the type or the event link: typing is
// never cut off. The date and the time wait (dateRedraw, startRedraw): typed digit by digit they
// change at every digit.
const REDRAW = new Set(['team', 'as', 'live', 'date', 'start']);

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


// Does the start time redraw the page? Only a complete time 'HH:MM' (00:00-23:59) that differs from
// the one the page was drawn with; asked as for the date.
export function startRedraw(value, drawn) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value ?? '') && value !== drawn;
}


// The hidden `touched` field: the fields the captain changed by hand among the type and the live
// box, sorted and comma-joined. A redraw for another team or plan keeps them (Ruling 6).
const TOUCHABLE = ['live', 'type'];

export function touchedList(set) {
    return TOUCHABLE.filter(name => set.has(name)).join(',');
}


// Where a redraw left the page: `saved` is the {path, y, focus} the script stored before it went,
// `path` the redraw's own URL (path and query), used only on exactly that page (one use: the caller
// drops it). A Store answered at the POST's URL (a refusal, its flash on top) has no query, so a
// redraw that a Store overtook never scrolls it. {y, focus} or null.
export function restoreState(saved, path) {
    if (saved === null || typeof saved !== 'object' || saved.path !== path) {
        return null;
    }
    return {
        y: Number.isFinite(saved.y) && saved.y > 0 ? saved.y : 0,
        focus: typeof saved.focus === 'string' && saved.focus !== '' ? saved.focus : null,
    };
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


if (typeof document !== 'undefined') {
    document.documentElement.classList.add('js');

    // Script-only controls ship hidden; reveal them.
    for (const el of document.querySelectorAll('[data-js][hidden]')) {
        el.hidden = false;
    }

    guardedReload();
    switcher();
    arms();
    submitOnce();
    copyButtons();
    assignRedraw();
    rhythmChoice();
}


// ---- guarded reload (the <noscript> meta refresh's stand-in) ----
// Every data-refresh seconds, when shouldReload allows it, a HEAD of this page first: if it
// answers, reload; else (no answer within 10 s counts as offline) show "Not updated since …" and
// try again after the interval. While the page is busy, look again every 5 s.
const HEAD_TIMEOUT_MS = 10000;

function guardedReload() {
    const body = document.body;
    const every = Number(body.dataset.refresh) * 1000;
    // a value the browser put back after Back counts as typed
    let dirty = restoredInput(document.querySelectorAll('form input, form textarea'));
    // 'change' too: a chosen file or a picked option counts as a changed form. And a
    // click on a file input: Safari and Firefox on macOS don't focus it while the chooser is open, so
    // without this a reload could cancel a choice still being made.
    for (const type of ['input', 'change']) {
        document.addEventListener(type, e => {
            if (e.target instanceof Element && e.target.closest('form')) {
                dirty = true;
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
    async function tick() {
        const active = document.activeElement;
        const ok = shouldReload({
            hidden: document.hidden,
            focused: Boolean(active && active.matches('input, select, textarea')),
            openDetails: holdsReload(document.querySelectorAll('details')),
            dirty,
            armed: document.querySelector('form[data-arm].armed') !== null,
        });
        if (!ok) {
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


// ---- arm in place (UI panel wave 2): an action that asks first turns, in its place, into a strip ----
// The trigger's press (data-arm-open, or Enter in a field of its form) opens the form's strip (what
// it does, the confirm button and Cancel) instead of posting, when armNeeded says so; the confirm
// button posts with confirm=1. One strip open at a time; no timeout; Esc and Cancel close it and
// give the focus back to the trigger. The focus goes to the confirm button, whose description is the
// words; presses of it within ARM_GUARD_MS of opening, and a held key's repeats, are ignored. A
// span data-arm-fill="<field>" in the words shows that field's value (the Zwift ID typed).
function arms() {
    let open = null;
    const strip = f => f.querySelector('[data-arm-strip]');
    const close = focus => {
        if (open === null) {
            return;
        }
        const f = open.form;
        open = null;
        f.classList.remove('armed');
        strip(f).hidden = true;
        if (focus) {
            f.querySelector('[data-arm-open]')?.focus();
        }
    };
    const fill = f => {
        for (const span of f.querySelectorAll('[data-arm-fill]')) {
            span.textContent = f.elements.namedItem(span.dataset.armFill)?.value?.trim() ?? '';
        }
    };
    const arm = f => {
        if (open?.form !== f) {
            close(false);
        }
        fill(f);
        f.classList.add('armed');
        strip(f).hidden = false;
        open = {form: f, at: performance.now()};
        const yes = f.querySelector('[data-arm-yes]');
        yes?.focus({preventScroll: true});
        yes?.scrollIntoView({block: 'nearest'});
    };
    const fieldOf = f => {
        const el = f.elements.namedItem(f.dataset.armField ?? '');
        if (!el || !('value' in el)) {
            return null;
        }
        const drawn = el instanceof HTMLSelectElement ? ([...el.options].find(o => o.defaultSelected)?.value ?? el.options[0]?.value ?? '') : el.defaultValue;
        return {value: el.value, drawn};
    };
    // the capture phase: before the assign page's own submit listener
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
            const buttons = [...f.querySelectorAll('button[type=submit], button:not([type])')];
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
        for (const b of document.querySelectorAll('form button[disabled]')) {
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


// ---- the assign page: a change of team, plan, live box, date or start time redraws it ----
// A GET of the page with the form's fields (the server draws the preview; no button), on `change`
// only: typing in the type or the event link never redraws. The date and the start time redraw when
// they are left, or a second after the last digit, once complete and other than the drawn value
// (dateRedraw, startRedraw): never in the middle of typing them. The type and the live box the captain touched go along in
// `touched`, also those touched before an earlier redraw or a refused Store (the server draws what it
// received into the field; a redraw also has them in its query), so a redraw never resets them. Before it goes, the scroll position and the field to focus are kept in
// sessionStorage for this page; the redrawn page scrolls back and focuses that field, opening the
// fold it sits in (restoreState, one use, only on the redraw's own URL). A second trigger before the
// page has gone (leaving the date by a click on a radio) goes again with the form as it is then: the
// last one wins. Leaving the date for Store or Discard redraws nothing: the POST goes instead. The key
// and the wait are locals: this runs while the module is still evaluated, before a later
// module-level const is set.
function assignRedraw() {
    const REDRAW_KEY = 'paceline:redraw';
    const DATE_WAIT_MS = 1000;
    const form = document.querySelector('form[data-assign]');
    const out = form?.querySelector('input[name=touched]');
    if (!out) {
        return;
    }
    const touched = new Set([
        ...(new URLSearchParams(location.search).get('touched') ?? '').split(','),
        ...out.value.split(','),
    ]);
    const write = () => {
        out.value = touchedList(touched);
    };
    write();
    const touch = e => {
        const name = e.target?.name;
        if (name === 'type' || name === 'live') {
            touched.add(name);
            write();
        }
    };
    // the fields that wait for a complete value: whether it redraws, against the drawn one
    const waiting = {
        date: {ok: dateRedraw, drawn: form.querySelector('input[name=date]')?.value ?? null},
        start: {ok: startRedraw, drawn: form.querySelector('input[name=start]')?.value ?? null},
    };
    const waits = el => (el?.name === 'date' || el?.name === 'start') && el.type !== 'hidden';
    let timer = null;
    const go = focus => {
        clearTimeout(timer);
        // `as` and `team` are radios; FormData sends only the checked one, and no live box when off
        const to = new URL(form.getAttribute('action') + '?' + new URLSearchParams(new FormData(form)), location.href);
        try {
            sessionStorage.setItem(REDRAW_KEY, JSON.stringify({path: to.pathname + to.search, y: scrollY, focus}));
        } catch {
            // no storage (a private window): the page redraws at its top
        }
        location.replace(to.href);
    };
    const due = el => waiting[el.name].ok(el.value, waiting[el.name].drawn);
    const soon = el => {
        clearTimeout(timer);
        if (due(el)) {
            timer = setTimeout(() => go(el.name), DATE_WAIT_MS);
        }
    };
    form.addEventListener('input', e => {
        touch(e);
        if (waits(e.target)) {
            soon(e.target);
        }
    });
    form.addEventListener('change', e => {
        touch(e);
        const name = e.target?.name;
        if (waits(e.target)) {
            soon(e.target);
        } else if (redrawOn(name)) {
            go(name);
        }
    });
    // leaving the date or the time: at once, focusing where the captain went (a radio's own change
    // follows)
    form.addEventListener('focusout', e => {
        if (!waits(e.target)) {
            return;
        }
        // to Store or Discard: the POST takes the field along (or the entry goes)
        if (e.relatedTarget instanceof Element && e.relatedTarget.matches('[type=submit]')) {
            clearTimeout(timer);
            return;
        }
        if (due(e.target)) {
            go(e.relatedTarget?.name || e.target.name);
        }
    });
    // a Store or Discard while the date's second runs: no redraw after it
    document.addEventListener('submit', () => clearTimeout(timer));

    let saved = null;
    try {
        saved = JSON.parse(sessionStorage.getItem(REDRAW_KEY) ?? 'null');
        sessionStorage.removeItem(REDRAW_KEY);
    } catch {
        saved = null;
    }
    const back = restoreState(saved, location.pathname + location.search);
    if (back === null) {
        return;
    }
    scrollTo(0, back.y);
    if (back.focus !== null) {
        const fields = [...form.querySelectorAll('input, select, textarea')].filter(el => el.name === back.focus);
        const el = fields.find(f => f.checked) ?? fields[0];
        const fold = el?.closest('details');
        if (fold && !fold.open) {
            fold.open = true;
        }
        el?.focus({preventScroll: true});
    }
}
