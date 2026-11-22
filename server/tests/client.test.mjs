// Run with: node --test server/tests/client.test.mjs
// The client script's pure helpers (server/client.mjs, served as /static/app.js): when the guarded
// reload may run, what its HEAD check's answer means, which changes redraw the Store form, the
// touched fields it sends and the team page's panel swap (its URL, which answer it keeps, the body's
// classes, the sheet's scroll). Its DOM part is checked by server/tests/smoke-captain.mjs (headless
// Chrome), a required check before every push.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    shouldReload, holdsReload, restoredInput, reloadDecision, timeoutSignal, redrawOn, dateRedraw, startRedraw, eventRedraw, touchedList,
    armPress, armNeeded, ARM_GUARD_MS, submitDecision, typedHolds, fillText, panelUrl, swapDecision, selClasses, selKey, submitButtons, bodyClasses, cockpitHome, popStep, sheetScroll, focusAfter,
    dateChangeRedraw, pickedRow, swapMarks, foldField, keepShut,
} from '../client.mjs';


test('typedHolds: a field typed outside the ⋯ menus holds for good, one in a ⋯ only while it is open', () => {
    assert.equal(typedHolds(false, new Set()), false);
    assert.equal(typedHolds(true, new Set()), true);
    const menu = {open: true};
    const typed = new Set([menu]);
    assert.equal(typedHolds(false, typed), true);
    // closed without saving: the page reloads again; opened again: it holds again
    menu.open = false;
    assert.equal(typedHolds(false, typed), false);
    menu.open = true;
    assert.equal(typedHolds(false, typed), true);
});


test('fillText: a date as the pages write a day, an empty field as the text it stands for', () => {
    assert.equal(fillText('2026-11-22', {format: 'day'}), 'Sun 22 Nov');
    assert.equal(fillText(' 2026-11-19 ', {format: 'day'}), 'Thu 19 Nov');
    assert.equal(fillText('18:00'), '18:00');
    assert.equal(fillText('', {empty: '19:30'}), '19:30');
    assert.equal(fillText('  ', {empty: '19:30'}), '19:30');
    assert.equal(fillText(undefined), '');
    // anything else as typed
    assert.equal(fillText('2026-13-40', {format: 'day'}), '2026-13-40');
    assert.equal(fillText('1003'), '1003');
    // `pre` goes before a value, never before nothing (a weekly race's time without a team time)
    assert.equal(fillText('18:00', {pre: ' '}), ' 18:00');
    assert.equal(fillText('', {pre: ' '}), '');
    assert.equal(fillText('', {pre: ' ', empty: '19:30'}), ' 19:30');
});


test('shouldReload: only when nothing holds the page', () => {
    // an open confirm strip holds it too (UI panel wave 2)
    const calm = {hidden: false, focused: false, openDetails: false, dirty: false, armed: false};
    assert.equal(shouldReload(calm), true);
    for (const flag of Object.keys(calm)) {
        assert.equal(shouldReload({...calm, [flag]: true}), false, flag);
    }
});


test('holdsReload: an open <details> holds the reload, unless it is marked data-keep-refresh', () => {
    const fold = (open, keep = false) => ({open, dataset: keep ? {keepRefresh: ''} : {}});
    assert.equal(holdsReload([]), false);
    assert.equal(holdsReload([fold(false), fold(false, true)]), false);
    assert.equal(holdsReload([fold(true)]), true, 'an open confirm');
    assert.equal(holdsReload([fold(true, true)]), false, 'an open fold without form inputs');
    assert.equal(holdsReload([fold(true, true), fold(true)]), true);
    // the script asks the page with exactly this
    const src = fs.readFileSync(new URL('../client.mjs', import.meta.url), 'utf8');
    assert.ok(src.includes("openDetails: holdsReload(document.querySelectorAll('details'))"), 'tick uses holdsReload');
});


test('holdsReload works without Object.hasOwn (Safari before 15.4)', () => {
    // final review M-4: a throw here stops tick() for good, and the team page no longer refreshes
    const fold = (open, keep = false) => ({open, dataset: keep ? {keepRefresh: ''} : {}});
    const hasOwn = Object.hasOwn;
    delete Object.hasOwn;
    try {
        assert.equal(holdsReload([fold(true, true)]), false);
        assert.equal(holdsReload([fold(true)]), true);
    } finally {
        Object.hasOwn = hasOwn;
    }
    // none of the script needs it
    assert.ok(!fs.readFileSync(new URL('../client.mjs', import.meta.url), 'utf8').includes('Object.hasOwn'));
});


test('reloadDecision: reload, or why the page is stale', () => {
    assert.deepEqual(reloadDecision({ok: true, status: 200, type: 'basic'}), {action: 'reload'});
    assert.deepEqual(reloadDecision({ok: false, status: 404, type: 'basic'}), {action: 'reload'});
    assert.deepEqual(reloadDecision({ok: false, status: 0, type: 'opaqueredirect'}), {action: 'stale', why: 'signedout'});
    assert.deepEqual(reloadDecision({ok: false, status: 503, type: 'basic'}), {action: 'stale', why: 'error'});
    assert.deepEqual(reloadDecision(null), {action: 'stale', why: 'offline'});
});


test('timeoutSignal: AbortSignal.timeout where it exists, else an AbortController aborted by a timer', () => {
    // a modern browser: its own AbortSignal.timeout
    const own = {};
    const asked = [];
    const modern = {AbortSignal: {timeout: ms => (asked.push(ms), own)}, AbortController, setTimeout: () => assert.fail('no timer')};
    assert.equal(timeoutSignal(10000, modern), own);
    assert.deepEqual(asked, [10000]);
    // iOS 15 Safari: AbortSignal without timeout(); the signal aborts when the timer fires
    const timers = [];
    const old = {AbortSignal: {}, AbortController, setTimeout: (fn, ms) => timers.push([fn, ms])};
    const signal = timeoutSignal(10000, old);
    assert.equal(signal.aborted, false);
    assert.deepEqual(timers.map(([, ms]) => ms), [10000]);
    timers[0][0]();
    assert.equal(signal.aborted, true);
    // no AbortController at all: no signal, the fetch runs without a deadline
    assert.equal(timeoutSignal(10000, {setTimeout: () => assert.fail('no timer')}), undefined);
});


test('redrawOn: team, plan, live, race, date and start time, never the type or the link', () => {
    // the race radio (races Task 7) redraws as the plan radio does
    assert.equal(redrawOn('race'), true);
    for (const name of ['team', 'as', 'live', 'race', 'date', 'start']) {
        assert.equal(redrawOn(name), true, name);
    }
    // typing is never cut off; the event link and the hidden fields wait for Store
    for (const name of ['type', 'event', 'drawn', 'base', 'touched', 'startFor', '', undefined]) {
        assert.equal(redrawOn(name), false, String(name));
    }
});


test('dateRedraw: a complete date other than the drawn one, never one typed halfway', () => {
    assert.equal(dateRedraw('2026-11-20', '2026-11-19'), true);
    assert.equal(dateRedraw('2026-11-19', '2026-11-19'), false, 'the date the page was drawn with');
    assert.equal(dateRedraw('2026-11-20', null), true, 'drawn without a date (a special team)');
    // the year typed digit by digit: 0002, 0020, 0202, then 2026
    for (const half of ['0002-11-20', '0020-11-20', '0202-11-20']) {
        assert.equal(dateRedraw(half, '2026-11-19'), false, half);
    }
    for (const bad of ['', null, undefined, '2026-02-30', '2026-13-01', '2026-11-2', 'x']) {
        assert.equal(dateRedraw(bad, '2026-11-19'), false, String(bad));
    }
});


test('dateChangeRedraw: a date picked in the calendar redraws on its change at once; typed digits wait (spec §5.3b)', () => {
    // the calendar (a click on the field opens it): no key pressed, a complete other date
    assert.equal(dateChangeRedraw({typed: false, value: '2026-11-26', drawn: '2026-11-19'}), true);
    assert.equal(dateChangeRedraw({typed: false, value: '2026-11-19', drawn: '2026-11-19'}), false, 'the drawn date again');
    assert.equal(dateChangeRedraw({typed: false, value: '', drawn: '2026-11-19'}), false, 'cleared');
    // typed digit by digit, the field changes at every digit (19 typed: 01, then 19): never at once
    for (const value of ['2026-11-01', '2026-11-19', '0002-11-19', '2026-11-26']) {
        assert.equal(dateChangeRedraw({typed: true, value, drawn: '2026-11-20'}), false, value);
    }
});


test('pickedRow: a swap marks the row the fragment\'s #panel names, the live one with nothing picked (spec §5.3b)', () => {
    assert.equal(pickedRow({kind: 'version', sel: 'v:c00005'}), 'v:c00005');      // nothing picked: the live version's row
    assert.equal(pickedRow({kind: 'entry', sel: 'e:c00006'}), 'e:c00006');
    assert.equal(pickedRow({kind: 'gone', sel: ''}), null);
    assert.equal(pickedRow({kind: ''}), null);
});


test('swapMarks: the row the fragment names; the sheet\'s path only for a selection in the URL; a row\'s Undo only while the card offers none', () => {
    // nothing picked (the bare URL): the live row, alone (no sheet); a later race's Undo on its row
    assert.deepEqual(swapMarks({sel: 'v:c00005'}, '', false), {row: 'v:c00005', sheet: false, rowUndo: true});
    // a race's live pointer: the same row, now a sheet's (a phone opens it)
    assert.deepEqual(swapMarks({sel: 'v:c00005'}, '?r=2026-11-19', false), {row: 'v:c00005', sheet: true, rowUndo: true});
    // the card of the version the switch made live offers Undo: the row's goes
    assert.deepEqual(swapMarks({sel: 'v:c00009'}, '?v=c00009', true), {row: 'v:c00009', sheet: true, rowUndo: false});
    assert.deepEqual(swapMarks({sel: ''}, '?v=zzzzzz', false), {row: null, sheet: true, rowUndo: true});
});


test('eventRedraw: a link other than the drawn one, once the field is left (review M4)', () => {
    assert.equal(eventRedraw('https://www.zwift.com/events/view/5123456', ''), true);
    assert.equal(eventRedraw(' https://x ', 'https://x'), false, 'the drawn one, trimmed');
    assert.equal(eventRedraw('', 'https://x'), true, 'a link removed');
    assert.equal(eventRedraw('', ''), false);
    assert.equal(eventRedraw(undefined, null), false);
});


test('touchedList: type and live only', () => {
    assert.equal(touchedList(new Set(['live', 'type', 'x'])), 'live,type');
    assert.equal(touchedList(new Set(['type', 'live'])), 'live,type', 'sorted');
    assert.equal(touchedList(new Set(['type'])), 'type');
    assert.equal(touchedList(new Set(['as', 'date', 'team', ''])), '');
    assert.equal(touchedList(new Set()), '');
});


test('client.mjs never writes HTML', () => {
    const src = fs.readFileSync(new URL('../client.mjs', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/);
});


test('client.mjs: the old upload preview is gone', () => {
    // the assign page holds the preview now (plan versions spec §6.10)
    const src = fs.readFileSync(new URL('../client.mjs', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /data-preview|\/manage\/upload\/preview|resetOnSubmit|previewNodes/);
});


test('startRedraw: a complete time other than the drawn one', () => {
    assert.equal(startRedraw('20:15', ''), true);
    assert.equal(startRedraw('20:15', null), true);
    assert.equal(startRedraw('21:15', '20:15'), true);
    assert.equal(startRedraw('20:15', '20:15'), false, 'the drawn one');
    // typed digit by digit, or cleared: never midway
    for (const value of ['', '2', '20:', '20:1', '24:00', '20:60', '7:30', null, undefined]) {
        assert.equal(startRedraw(value, ''), false, String(value));
    }
});


test('restoredInput: a text field or text area the browser filled again holds the reload; others not', () => {
    assert.equal(restoredInput([]), false);
    assert.equal(restoredInput([{type: 'textarea', value: '', defaultValue: ''}]), false);
    assert.equal(restoredInput([{type: 'textarea', value: '{"riders":{}}', defaultValue: ''}]), true);
    assert.equal(restoredInput([{type: 'text', value: 'fast', defaultValue: ''}]), true);
    assert.equal(restoredInput([{type: 'text', value: 'Rollers', defaultValue: 'Rollers'}]), false);
    assert.equal(restoredInput([{type: 'hidden', value: 'x', defaultValue: ''}]), false);
    assert.equal(restoredInput([{type: 'file', value: 'C:\\fakepath\\a.json', defaultValue: ''}]), false);
});


test('the guarded reload: a click on a file input holds it (Safari and Firefox do not focus it)', () => {
    const src = fs.readFileSync(new URL('../client.mjs', import.meta.url), 'utf8');
    assert.match(src, /addEventListener\('click', e => \{\n\s+if \(e\.target instanceof Element && e\.target\.closest\('form input\[type="file"\]/);
    assert.match(src, /let dirty = restoredInput\(/);
});


test('arm in place: presses of the confirm button within 450 ms of arming are ignored', () => {
    assert.equal(ARM_GUARD_MS, 450);
    assert.equal(armPress(1000, 1000), false, 'the same press');
    assert.equal(armPress(1000, 1449), false, 'a double-click or double-tap');
    assert.equal(armPress(1000, 1450), true);
    assert.equal(armPress(1000, 9000), true, 'no timeout: still armed much later');
    assert.equal(armPress(null, 5), true, 'no strip opened');
    // the script asks with exactly this, on the strip's own clock
    const src = fs.readFileSync(new URL('../client.mjs', import.meta.url), 'utf8');
    assert.ok(src.includes('if (!armPress(open?.form === f ? open.at : null, performance.now())) {'), 'submit uses armPress');
    assert.ok(src.includes("if (e.key === 'Escape' && open !== null) {"), 'Esc closes the strip');
});


test('arm in place: a form with data-arm-when asks only while its field is empty or changed', () => {
    assert.equal(armNeeded(undefined, null), true, 'no condition: always');
    assert.equal(armNeeded('', null), true);
    assert.equal(armNeeded('empty', {value: '', drawn: '19:30'}), true, 'a start time cleared');
    assert.equal(armNeeded('empty', {value: '  ', drawn: '19:30'}), true);
    assert.equal(armNeeded('empty', {value: '19:45', drawn: '19:30'}), false);
    assert.equal(armNeeded('changed', {value: 'UTC', drawn: 'Europe/Berlin'}), true, 'another zone');
    assert.equal(armNeeded('changed', {value: 'Europe/Berlin', drawn: 'Europe/Berlin'}), false);
    assert.equal(armNeeded('empty', null), false, 'no such field: the server decides');
    // a hidden field asks nothing: the weekly start time while special is checked (race day and
    // time, user 22 Nov 2026), which the server ignores
    assert.equal(armNeeded('empty', {value: '', drawn: '19:30', hidden: true}), false, 'a hidden start time');
    assert.equal(armNeeded('empty', {value: '', drawn: '19:30', hidden: false}), true);
    assert.equal(armNeeded('changed', {value: 'UTC', drawn: 'Europe/Berlin', hidden: true}), false);
    // the page passes the field's hidden state (fieldOf: inside a [hidden] box)
    const src = fs.readFileSync(new URL('../client.mjs', import.meta.url), 'utf8');
    assert.ok(src.includes("return {value: el.value, drawn, hidden: el.closest('[hidden]') !== null};"), 'fieldOf passes hidden');
});


test('a POST form posts once until the page answers (review M1)', () => {
    assert.equal(submitDecision({method: 'post', sent: false, prevented: false}), 'send');
    assert.equal(submitDecision({method: 'POST', sent: true, prevented: false}), 'block', 'a double click');
    assert.equal(submitDecision({method: 'post', sent: false, prevented: true}), 'ignore', 'a strip armed instead, or the 450 ms guard');
    assert.equal(submitDecision({method: 'post', sent: true, prevented: true}), 'ignore');
    assert.equal(submitDecision({method: 'get', sent: true, prevented: false}), 'ignore', 'a GET is never held');
    const src = fs.readFileSync(new URL('../client.mjs', import.meta.url), 'utf8');
    assert.ok(src.includes("const d = submitDecision({method: f.getAttribute('method') ?? 'get', sent: sent.has(f), prevented: e.defaultPrevented});"), 'submitOnce uses it');
    // the buttons go disabled after the submit, so the pressed button's confirm=1 still goes along
    assert.ok(/const buttons = submitButtons\(f\);\s+setTimeout\(\(\) => \{\s+for \(const b of buttons\) \{\s+b\.disabled = true;/.test(src));
    // a stopped POST (Esc, the browser's Stop) gives the buttons back after RETRY_MS, and every pageshow does
    assert.match(src, /const RETRY_MS = 10000;/);
    assert.match(src, /setTimeout\(\(\) => \{\s+sent\.delete\(f\);\s+for \(const b of buttons\) \{\s+b\.disabled = false;/);
    assert.match(src, /addEventListener\('pageshow', \(\) => \{\s+sent = new WeakSet\(\);/);
});


test('submitButtons: every submit button of the form, also one outside it with form="<its id>"', () => {
    // form.elements lists the buttons a form owns, inside it or (form="store-<id>", the cockpit's
    // Store) outside it; a type="button" (Cancel) and an <input> are not disabled
    const inside = {localName: 'button', type: 'submit'};
    const outside = {localName: 'button', type: 'submit', form: 'store-c00006'};
    const cancel = {localName: 'button', type: 'button'};
    const field = {localName: 'input', type: 'submit'};
    assert.deepEqual(submitButtons({elements: [inside, cancel, field, outside]}), [inside, outside]);
    assert.deepEqual(submitButtons({elements: []}), []);
    const src = fs.readFileSync(new URL('../client.mjs', import.meta.url), 'utf8');
    // a page shown again takes back every disabled button, the ones outside a form too
    assert.match(src, /for \(const b of document\.querySelectorAll\('button\[disabled\]'\)\) \{\s+b\.disabled = false;/);
});


test('shouldReload: held while the page says so', () => {                         // [Review Focus 4]
    const free = {hidden: false, focused: false, openDetails: false, dirty: false, armed: false};
    assert.equal(shouldReload(free), true);
    assert.equal(shouldReload({...free, holding: true}), false);
    // the script asks with the page's own flag, read again at every tick (a swap may have taken it away)
    const src = fs.readFileSync(new URL('../client.mjs', import.meta.url), 'utf8');
    assert.ok(src.includes("holding: document.querySelector('[data-hold-reload]') !== null,"), 'guardedReload reads [data-hold-reload]');
});


test('panelUrl: the row\'s own URL, asked for the panel only', () => {
    assert.equal(panelUrl('https://paceline.example.org/manage/team/rollers?v=c00004#panel', '7'), '/manage/team/rollers?v=c00004&panel=1&tv=7');
    assert.equal(panelUrl('/manage/team/rollers#race-2026-11-19', '7'), '/manage/team/rollers?panel=1&tv=7');
    // a redraw of the Store form: the page's URL with the form's fields; asked again, never twice
    assert.equal(panelUrl('/manage/team/rollers?e=c00006&team=rollers&as=new&panel=1&tv=3', 7),
        '/manage/team/rollers?e=c00006&team=rollers&as=new&panel=1&tv=7');
});


test('swapDecision: an answer to an older pick is dropped; anything but a 200 loads the whole page', () => {      // [Review Focus 3]
    assert.equal(swapDecision({asked: 2, latest: 3, status: 200}), 'drop');
    assert.equal(swapDecision({asked: 3, latest: 3, status: 200}), 'swap');
    for (const status of [409, 429, 404, 500, 0]) {
        assert.equal(swapDecision({asked: 3, latest: 3, status}), 'load', String(status));
    }
    assert.equal(swapDecision({asked: 2, latest: 3, status: 409}), 'drop');
});


test('selClasses: the body\'s classes follow the URL', () => {
    assert.deepEqual([selClasses('?v=c00004'), selClasses('?e=c00006'), selClasses(''), selClasses('?v=')],
        [{hasSel: true, entry: false}, {hasSel: true, entry: true}, {hasSel: false, entry: false}, {hasSel: false, entry: false}]);
    // `v` wins over `e` (shapes), as on the server
    assert.deepEqual(selClasses('?v=c00004&e=c00006'), {hasSel: true, entry: false});
    assert.deepEqual(selClasses('?e=&v='), {hasSel: false, entry: false});
});


test('a race\'s live pointer ?r=<date> is a selection: a sheet on a phone, its own key', () => {
    assert.deepEqual(selClasses('?r=2026-11-19'), {hasSel: true, entry: false});
    assert.equal(selKey('?r=2026-11-19'), 'r:2026-11-19');
    assert.equal(selKey('?v=c00004&r=2026-11-19'), 'v:c00004');           // ?v= wins
    assert.equal(selKey('?r='), null);
});


test('selKey: the data-sel of the row a URL picks', () => {
    assert.equal(selKey('?v=c00004'), 'v:c00004');
    assert.equal(selKey('?e=c00006'), 'e:c00006');
    assert.equal(selKey('?e=c00006&v=c00004'), 'v:c00004', 'v wins');
    assert.equal(selKey('?v=&e=c00006'), 'e:c00006', 'an empty v is none');
    assert.equal(selKey(''), null);
    assert.equal(selKey('?panel=1'), null);
});


test('the panel swaps only what the server sent, parsed', () => {
    const src = fs.readFileSync(new URL('../client.mjs', import.meta.url), 'utf8');
    assert.ok(src.includes("new DOMParser().parseFromString(text, 'text/html')"), 'the answer is parsed with DOMParser');
    assert.ok(src.includes("{credentials: 'same-origin', cache: 'no-store', redirect: 'manual'}"), 'the fetch');
    // the first text says so
    assert.match(src.slice(0, 1200), /inserts HTML the server sent, parsed, and never builds any/);
});


test('bodyClasses: every swap sets has-sel and sel-e from the URL and the swapped #panel', () => {
    assert.deepEqual(bodyClasses('?v=c00004', {kind: 'version'}), {'has-sel': true, 'sel-e': false});
    assert.deepEqual(bodyClasses('?e=c00006', {kind: 'entry'}), {'has-sel': true, 'sel-e': true});
    // a received plan that is gone draws as 'gone': no sel-e, as on the server
    assert.deepEqual(bodyClasses('?e=c00009', {kind: 'gone'}), {'has-sel': true, 'sel-e': false});
    // nothing picked: the live card, no sheet
    assert.deepEqual(bodyClasses('', {kind: 'version'}), {'has-sel': false, 'sel-e': false});
    const src = fs.readFileSync(new URL('../client.mjs', import.meta.url), 'utf8');
    assert.match(src, /for \(const \[cls, on\] of Object\.entries\(bodyClasses\(url\.search, head\.dataset\)\)\) \{\s+document\.body\.classList\.toggle\(cls, on\);/);
});


test('cockpitHome: a cockpit drawn at another URL (a refused Store at /manage/inbox/<id>) goes to its own', () => {
    // the page answered the POST: the address bar gets the cockpit's URL for what it drew
    assert.equal(cockpitHome('/manage/inbox/c00006', '/manage/team/rollers?e=c00006'), '/manage/team/rollers?e=c00006');
    assert.equal(cockpitHome('/manage/live', '/manage/team/rollers?v=c00004'), '/manage/team/rollers?v=c00004');
    // on the cockpit's own path the URL stays (a whole page loaded for a redraw keeps its fields)
    assert.equal(cockpitHome('/manage/team/rollers', '/manage/team/rollers?e=c00006'), null);
    assert.equal(cockpitHome('/manage/inbox/c00006', undefined), null, 'no data-here: nothing to do');
    assert.equal(cockpitHome('/manage/inbox/c00006', ''), null);
    const src = fs.readFileSync(new URL('../client.mjs', import.meta.url), 'utf8');
    assert.match(src, /const home = cockpitHome\(location\.pathname, main\.dataset\.here\);\s+if \(home !== null\) \{\s+history\.replaceState\(null, '', home\);/);
});


test('popStep: every Back or Forward outdates an answer on its way, also one that fetches nothing', () => {     // [Review Focus 3]
    // at ?v=A; Back to nothing picked asks (fetch 1); Forward to ?v=A within its round trip asks
    // nothing (A is shown) but the answer to the Back is dropped: nothing picked never lands under ?v=A
    let state = {latest: 1, shown: 'v:A'};
    const back = popStep(state, null);
    assert.deepEqual(back, {latest: 2, fetch: true});
    state = {...state, latest: back.latest};
    const asked = state.latest + 1;                                              // fetchSwap's own ++latest
    state.latest = asked;
    const forward = popStep(state, 'v:A');
    assert.deepEqual(forward, {latest: asked + 1, fetch: false});
    assert.equal(swapDecision({asked, latest: forward.latest, status: 200}), 'drop');
    // a hash-only step on the same selection: nothing fetched, any answer on its way dropped
    assert.deepEqual(popStep({latest: 5, shown: 'e:B'}, 'e:B'), {latest: 6, fetch: false});
    const src = fs.readFileSync(new URL('../client.mjs', import.meta.url), 'utf8');
    assert.match(src, /addEventListener\('popstate', \(\) => \{\s+const step = popStep\(\{latest, shown\}, selKey\(location\.search\)\);\s+latest = step\.latest;\s+if \(!step\.fetch\) \{\s+return;/);
});


test('the guarded reload asks shouldReload again once the HEAD has answered', () => {
    // a field focused or a Store form swapped in while the HEAD was on its way: no reload then
    const src = fs.readFileSync(new URL('../client.mjs', import.meta.url), 'utf8');
    assert.match(src, /if \(decision\.action === 'reload'\) \{\s+if \(!free\(\)\) \{\s+setTimeout\(tick, 5000\);\s+return;\s+\}\s+location\.reload\(\);/);
});


test('focusAfter: a row\'s swap focuses #panel; the close link the row that was picked, not the emptied #panel (M6)', () => {
    assert.deepEqual(focusAfter({closing: false, was: null}), {to: 'panel'});
    assert.deepEqual(focusAfter({closing: false, was: 'v:c00004'}), {to: 'panel'});
    assert.deepEqual(focusAfter({closing: true, was: 'v:c00004'}), {to: 'row', key: 'v:c00004'});
    assert.deepEqual(focusAfter({closing: true, was: 'e:c00006'}), {to: 'row', key: 'e:c00006'});
    // nothing was picked (a close link on a page drawn without a selection): #panel
    assert.deepEqual(focusAfter({closing: true, was: null}), {to: 'panel'});
});


test('sheetScroll: a phone remembers the list\'s place into a sheet and restores it out; wide and a redraw do not scroll', () => {
    const at = (narrow, wasSel, isSel, sameKey) => sheetScroll({narrow, wasSel, isSel, sameKey});
    assert.equal(at(true, false, true, false), 'enter');
    assert.equal(at(true, true, false, false), 'leave');
    assert.equal(at(true, true, true, false), 'move');         // Back or Forward from one pick to another
    assert.equal(at(true, true, true, true), null);            // the Store form's redraw: the same selection
    assert.equal(at(true, false, false, true), null);
    for (const [w, i, k] of [[false, true, false], [true, false, false], [false, false, true]]) {
        assert.equal(at(false, w, i, k), null);                // wide: the panel is a column, nothing scrolls
    }
});


test('foldField: the Store form\'s hidden raceOpen follows its race fold, so a redraw keeps it open', () => {
    assert.equal(foldField(true), '1');
    assert.equal(foldField(false), '');
    // the form listens to the fold's toggle in the capture phase (toggle does not bubble) and writes it
    const src = fs.readFileSync(new URL('../client.mjs', import.meta.url), 'utf8');
    const bind = src.slice(src.indexOf('function bindAssign('));
    assert.match(bind, /form\.addEventListener\('toggle', [^]*?details\.as-race[^]*?raceOpen\.value = foldField\(e\.target\.open\)[^]*?\{signal, capture: true\}\)/);
});


test('keepShut: a redraw sent with the race fold open, which the captain closed meanwhile, draws it closed', () => {
    assert.equal(keepShut(true, false), true);
    // still open, sent closed, or no fold on the page: as the server draws it
    assert.equal(keepShut(true, true), false);
    assert.equal(keepShut(false, false), false);
    assert.equal(keepShut(true, null), false);
});
