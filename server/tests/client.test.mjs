// Run with: node --test server/tests/client.test.mjs
// The client script's pure helpers (server/client.mjs, served as /static/app.js): when the guarded
// reload may run, what its HEAD check's answer means, which changes redraw the assign page, the
// touched fields it sends and the state it restores. Its DOM part is checked by
// server/tests/smoke-captain.mjs (headless Chrome), a required check before every push.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {shouldReload, holdsReload, restoredInput, reloadDecision, timeoutSignal, redrawOn, dateRedraw, startRedraw, touchedList, restoreState} from '../client.mjs';


test('shouldReload: only when nothing holds the page', () => {
    const calm = {hidden: false, focused: false, openDetails: false, dirty: false};
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


test('redrawOn: team, plan, live, date and start time, never the type or the link', () => {
    for (const name of ['team', 'as', 'live', 'date', 'start']) {
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


test('touchedList: type and live only', () => {
    assert.equal(touchedList(new Set(['live', 'type', 'x'])), 'live,type');
    assert.equal(touchedList(new Set(['type', 'live'])), 'live,type', 'sorted');
    assert.equal(touchedList(new Set(['type'])), 'type');
    assert.equal(touchedList(new Set(['as', 'date', 'team', ''])), '');
    assert.equal(touchedList(new Set()), '');
});


test('restoreState: only for the same path', () => {
    const saved = {path: '/manage/inbox/ab12cd', y: 640, focus: 'as'};
    assert.deepEqual(restoreState(saved, '/manage/inbox/ab12cd'), {y: 640, focus: 'as'});
    assert.equal(restoreState(saved, '/manage/inbox/zz99zz'), null, 'another page');
    assert.equal(restoreState(null, '/manage/inbox/ab12cd'), null, 'nothing stored');
    // the redraw's own URL only: a Store refused at the POST's URL (no query) keeps its top and flash
    const redraw = {path: '/manage/inbox/ab12cd?team=rollers&as=new', y: 640, focus: 'as'};
    assert.deepEqual(restoreState(redraw, '/manage/inbox/ab12cd?team=rollers&as=new'), {y: 640, focus: 'as'});
    assert.equal(restoreState(redraw, '/manage/inbox/ab12cd'), null, 'the refused Store');
    // a damaged entry: the page opens at its top, no field focused
    assert.equal(restoreState('x', '/manage/inbox/ab12cd'), null);
    assert.deepEqual(restoreState({path: '/manage/inbox/ab12cd', y: 'far', focus: 7}, '/manage/inbox/ab12cd'), {y: 0, focus: null});
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
