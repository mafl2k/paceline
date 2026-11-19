// Paceline captain pages: the one first-party script, served as /static/app.js (static.mjs). The
// captain pages need it (plan versions spec decision 13): the assign page redraws itself when a
// choice changes, confirms are in-page, and the team pages reload themselves. Only Make live (also "Make vN live" and Back of the live plan) works without it, as a
// plain POST and the server's confirm page. It writes text only through textContent and builds
// elements with createElement; every text comes from the server's page or a data-* attribute.
// Without a DOM (node --test) importing it gives the pure helpers and does nothing else.


// May the guarded reload run now? Not while the tab is hidden, a field has focus (input, select,
// textarea), a <details> holds it (holdsReload) or a form was changed (spec §5.4 "Script").
export function shouldReload({hidden, focused, openDetails, dirty}) {
    return !hidden && !focused && !openDetails && !dirty;
}


// Does one of these <details> hold the reload? An open one does, unless it is marked
// data-keep-refresh: a fold that holds no form input (the picker's "Other teams", the riders' help)
// would otherwise freeze the page for as long as it is left open.
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
// box and the race date. Never the type or the event link: typing is never cut off. The date waits
// (dateRedraw): typed digit by digit it changes at every digit.
const REDRAW = new Set(['team', 'as', 'live', 'date']);

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
    confirms();
    copyButtons();
    assignRedraw();
}


// ---- guarded reload (the <noscript> meta refresh's stand-in) ----
// Every data-refresh seconds, when shouldReload allows it, a HEAD of this page first: if it
// answers, reload; else (no answer within 10 s counts as offline) show "Not updated since …" and
// try again after the interval. While the page is busy, look again every 5 s.
const HEAD_TIMEOUT_MS = 10000;

function guardedReload() {
    const body = document.body;
    const every = Number(body.dataset.refresh) * 1000;
    let dirty = false;
    document.addEventListener('input', e => {
        if (e.target instanceof Element && e.target.closest('form')) {
            dirty = true;
        }
    });
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


// ---- in-page confirms: one open at a time, its button focused ----
// The focus move must not turn a held key into a click: an Enter that opened the confirm repeats on
// its (often destructive) button, so repeated key presses there do nothing.
function confirms() {
    document.addEventListener('keydown', e => {
        if (e.repeat && e.target instanceof Element && e.target.matches('details.confirm [type=submit]')) {
            e.preventDefault();
        }
    }, true);
    // toggle does not bubble: listen in the capture phase
    document.addEventListener('toggle', e => {
        const d = e.target;
        if (!(d instanceof HTMLDetailsElement) || !d.classList.contains('confirm') || !d.open) {
            return;
        }
        for (const other of document.querySelectorAll('details.confirm[open]')) {
            if (other !== d) {
                other.open = false;
            }
        }
        d.querySelector('[type=submit]')?.focus();
    }, true);
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


// ---- the assign page: a change of team, plan, live box or date redraws it ----
// A GET of the page with the form's fields (the server draws the preview; no button), on `change`
// only: typing in the type or the event link never redraws. The date redraws when it is left, or a
// second after the last digit, once it is a complete date other than the drawn one (dateRedraw):
// never in the middle of typing it. The type and the live box the captain touched go along in
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
    const drawnDate = form.querySelector('input[name=date]')?.value ?? null;
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
    const dateSoon = el => {
        clearTimeout(timer);
        if (dateRedraw(el.value, drawnDate)) {
            timer = setTimeout(() => go('date'), DATE_WAIT_MS);
        }
    };
    form.addEventListener('input', e => {
        touch(e);
        if (e.target?.name === 'date') {
            dateSoon(e.target);
        }
    });
    form.addEventListener('change', e => {
        touch(e);
        const name = e.target?.name;
        if (name === 'date') {
            dateSoon(e.target);
        } else if (redrawOn(name)) {
            go(name);
        }
    });
    // leaving the date: at once, focusing where the captain went (a radio's own change follows)
    form.addEventListener('focusout', e => {
        if (e.target?.name !== 'date') {
            return;
        }
        // to Store or Discard: the POST takes the date along (or the entry goes)
        if (e.relatedTarget instanceof Element && e.relatedTarget.matches('[type=submit]')) {
            clearTimeout(timer);
            return;
        }
        if (dateRedraw(e.target.value, drawnDate)) {
            go(e.relatedTarget?.name || 'date');
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
