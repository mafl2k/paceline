// The team page /manage/team/<slug>, the team cockpit (team cockpit spec §5.1-§5.3, §6, §8): the
// frame kept, the list at the left, the panel at the right, the fragment of the three slots, Make
// live and Undo from the panel, every other form of the page coming back to it, and the switch: the
// old URLs lead to it, Restore answers out of date. Made-up names only (helpers.mjs).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {T, CODE_SECRET, planJson} from './helpers.mjs';
import {
    serve, textOf, count, flashOf, post, followPost, undoOf, armOf, CLUB_FIELD, VERSION_OF, CID, element, elements, sheetsOf, postUpload, storedClub,
    makeClub, upload, ROLLERS, intake,
} from './manage-helpers.mjs';
import {uploadSheet, makeLive, setRace} from '../club.mjs';
import {cockpitClub, NOW, DATE, plan} from './cockpit-fixture.mjs';
import {APP_CSS} from '../app-css.mjs';
import {cockpitView, selectionOf} from '../cockpit-view.mjs';
import {tableModel, tableBase} from '../plan-table.mjs';

const PATH = '/manage/team/rollers';
const BEFORE = T('2026-11-19T12:00:00Z');            // Thu 19 Nov 13:00 in Berlin: Rollers' gate (19:00) is closed
const OVER = T('2026-11-19T20:30:00Z') + 1;          // S 18:30Z + 2 h: the race is over

const slots = html => element(html, '<div id="panel"') + (element(html, '<div class="cp-pick"') ?? '') + element(html, '<div id="panel-body"');
// the card's action bar, and the Undo form in it (spec §5.3b), or null
const barOf = html => element(html, '<div class="cp-bar"');
const barUndo = html => /<div class="cp-undo">(<form method="post" action="\/manage\/live\/undo">[^]*?<\/form>)<\/div>/.exec(html ?? '')?.[1] ?? null;
// the card's line under its title (the plan code, the caption or the count), as text
const metaOf = html => textOf(element(html, '<p class="cp-meta"') ?? '').replace(/\s+/g, ' ').trim();

let srv;
let cookie;
let ids;

async function start(t, now = NOW) {
    const made = cockpitClub();
    ids = made.ids;
    cookie = made.cookie;
    srv = await serve(t, made, {now, env: {CODE_SECRET, PUBLIC_URL: 'https://paceline.example.org'}});
}

// The body of GET PATH + q after a 200.
async function page(q, p = PATH) {
    const res = await srv.get(`${p}${q}`, cookie);
    const body = await res.text();
    assert.equal(res.status, 200, body);
    return body;
}

const liveOf = (slug = 'rollers') => srv.store.get(CID).teams[slug].races['2026-11-19'].live;


test('the page: the frame kept, the list at the left; nothing picked opens the live version (its row marked, its card drawn)', async t => {
    await start(t);
    const body = await page('');
    assert.match(body, /<main class="page wide cockpit" id="main" data-tv="7" data-here="\/manage\/team\/rollers">/);
    assert.match(body, /<body class="teampage cockpit"/);
    for (const kept of ['Weekly · Thursday 19:30', 'Team settings', 'Upload a file instead', 'How races work', 'id="race-2026-11-19"']) {
        assert.ok(body.includes(kept), kept);
    }
    const rows = [...body.matchAll(/<li class="cp-row[^"]*" data-sel="([^"]+)"><a class="cp-link" href="([^"]+)"/g)].map(m => [m[1], m[2]]);
    assert.deepEqual(rows, [
        ['e:c00007', `${PATH}?e=c00007#panel`], ['e:c00006', `${PATH}?e=c00006#panel`], ['e:c00008', `${PATH}?e=c00008#panel`],
        ['v:c00005', `${PATH}?r=2026-11-19#panel`], ['v:c00004', `${PATH}?v=c00004#panel`], ['v:c00001', `${PATH}?v=c00001#panel`],
        ['v:c00002', `${PATH}?v=c00002#panel`],
    ]);
    const text = textOf(body);
    for (const said of ['Not stored yet', 'Sent 19:12 · \'Rollers slow\' · 4 riders', 'Uploaded 19:05 · \'Rollers\' · 5 riders',
        'v3 19:12 · live since 19:14', 'v2 18:55 · was live 18:57 · Hanna in, Ben out', '1 older', 'v1 Wed 18 Nov 21:02 · Eva out · 2 targets',
        '0 of 6 have the plan']) {
        assert.ok(text.includes(said), said);
    }
    // nothing picked: the card is the nearest race's live version, as riders get it, with no close link (no sheet is open)
    assert.match(body, /<div id="panel" data-kind="version" data-sel="v:c00005" tabindex="-1">/);
    assert.equal(element(body, '<div id="panel"').includes('cp-close'), false);
    assert.ok(textOf(element(body, '<div id="panel"')).includes('Riders on \'Rollers · fast\' v3'));
    assert.match(element(body, '<details class="fold cp-older"'), /^<details class="fold cp-older" data-keep-refresh>/);
    assert.equal(body.includes('new plans from ZwiftGopher'), false);            // the blue box went into the list
    assert.equal(/<div class="newer">|\/manage\/plan\/back|\/team\/rollers\/plan\//.test(body), false);   // no Restore, no way to a plan page
    assert.match(body, /<noscript><meta http-equiv="refresh" content="30;url=\/manage\/team\/rollers"><\/noscript>/);

    // the slots in their order in the document, the list between the panel's head and its body
    const at = s => body.indexOf(s);
    assert.ok(at('<div class="cp">') < at('<div id="panel"'), 'cp');
    assert.ok(at('<div id="panel"') < at('<div class="cp-list"'), 'panel, list');
    assert.ok(at('<div class="cp-list"') < at('<div id="panel-body"'), 'list, body');
    assert.equal(body.includes('id="riders"'), false);                          // no second card: the panel's card is the riders card
    // Undo of the last Make live (18:14, two minutes ago) in the live card's action bar, no line above the card
    assert.ok(barUndo(barOf(body)), 'Undo in the bar');
    assert.equal(undoOf(element(body, '<div id="panel"')), null);
    // the plan blocks: the live one tagged, each with its ⋯ (no Make live in it), in the race's order
    assert.deepEqual([...body.matchAll(/<section class="cp-plan[^"]*" id="(plan-[^"]+)"/g)].map(m => m[1]), ['plan-c00001', 'plan-c00002']);
    const fast = element(body, '<section class="cp-plan live" id="plan-c00001"');
    assert.ok(textOf(fast).includes('Live Rollers · fast'));
    assert.equal(fast.includes('action="/manage/live"'), false);
    assert.ok(element(fast, '<details class="menu"').includes('/manage/plan/rename'));
    // the page is the team page: no form says where it came from, no upload link carries a `from`
    assert.equal(body.includes('name="from"'), false);
    const uploads = [...body.matchAll(/href="(\/manage\/upload\?[^"]*)"/g)].map(m => m[1]);
    assert.ok(uploads.length > 0);
    for (const href of uploads) {
        assert.equal(href.includes('from='), false, href);
    }
    // the list: the live row is the one picked, with aria-current
    assert.match(body, /<li class="cp-row live picked" data-sel="v:c00005"><a class="cp-link" href="\/manage\/team\/rollers\?r=2026-11-19#panel" aria-current="true"/);
    assert.equal(count(body, 'aria-current="true"'), 1);
    assert.equal(count(body, ' picked"'), 1);
});


test('a version picked: its head, the table against live, what Make live would do, Make live asking first', async t => {
    await start(t);
    const body = await page('?v=c00004');                                        // 'Rollers · fast' v2
    assert.match(body, /<body class="teampage cockpit has-sel"/);
    const head = element(body, '<div id="panel"');
    assert.ok(head.startsWith('<div id="panel" data-kind="version" data-sel="v:c00004" tabindex="-1">'));
    assert.ok(textOf(head).includes('\'Rollers · fast\' v2 · stored 18:55'));
    assert.match(head, /<a class="cp-close" href="\/manage\/team\/rollers#race-2026-11-19"/);
    assert.equal(count(body, 'class="cp-close"'), 1);
    assert.equal(undoOf(head), null);                                             // Undo belongs to the live version's panel
    const pb = element(body, '<div id="panel-body"');
    // the card's line under the title: the plan code and the caption of the table against live
    assert.ok(head.includes('<span class="cp-cap" title="Against live v3 · Hanna in, Ben out">Against live v3 · Hanna in, Ben out</span>'), head);
    assert.match(metaOf(head), /^Plan code [0-9A-Z]{6} Against live v3 · Hanna in, Ben out$/);
    assert.equal(pb.includes('pt-cap'), false);
    // what Make live would do, in the slot right above the action bar; Make live in the bar
    assert.ok(textOf(element(pb, '<div class="cp-what"')).includes('Hanna moves from Sprockets to Rollers. Still to do: Sprockets. Make it live anyway?'));
    const arm = armOf(barOf(pb), '/manage/live');                                // the gate is open: it asks in its place
    for (const f of [CLUB_FIELD, 'name="team" value="rollers"', 'name="sheet" value="c00004"', 'name="version" value="7"']) {
        assert.ok(arm.includes(f), f);
    }
    assert.equal(arm.includes('<input type="hidden" name="confirm"'), false);    // never a preset confirm
    assert.match(arm, /<button class="btn secondary" type="submit" data-arm-open>Make v2 live…/);   // the race has a live version
    assert.match(body, /<li class="cp-row picked" data-sel="v:c00004"><a class="cp-link" href="[^"]+" aria-current="true"/);
    assert.equal(count(body, 'aria-current="true"'), 1);
    // its list and its race block are marked for the phone's sheet (Task 10)
    assert.match(body, /<ul class="cp-rows sel-rows"><li class="cp-row live" data-sel="v:c00005">/);
    assert.match(body, /<div class="race cp-race sel-race" id="race-2026-11-19">/);
    // after the gate too the picked card replaces the live one: no riders card, no states under it; the
    // live row says the count instead (spec §5.3b)
    assert.equal(/id="riders"|riders-card|rstates|have the plan/.test(element(body, '<div class="cp">')), false);
    assert.ok(textOf(element(body, '<li class="cp-row live" data-sel="v:c00005">')).includes('v3 19:12 · live since 19:14 · 0/6 have it'));
    assert.match(body, /content="30;url=\/manage\/team\/rollers\?v=c00004"/);   // the reload keeps the selection
});


test('the live version: as riders get it (no old lines), also within the Undo window; its bar "LIVE · riders get this" with Undo, then alone', async t => {
    await start(t);
    for (const q of ['?v=c00005', '']) {                                         // picked, and opened with nothing picked: the same card
        const body = await page(q);
        const head = element(body, '<div id="panel"');
        const pb = element(body, '<div id="panel-body"');
        // v3 went live at 18:14 (two minutes ago, Undo offered): no old line, no dropped line, no NEW
        assert.equal(/pt-old|pt-dropped|pt-mark|pt-cap/.test(pb), false, q);
        assert.deepEqual([...pb.matchAll(/<span class="pt-nm">([^<]+)<\/span>/g)].map(m => m[1]), ['Ben', 'Cleo', 'Dan', 'Eva', 'Finn', 'Gus'], q);
        assert.ok(textOf(head).includes('Riders on \'Rollers · fast\' v3'), q);
        assert.match(metaOf(head), /^Plan code [0-9A-Z]{6} 0 of 6 have the plan$/, q);
        // the bar: the status and Undo (no line above the card while Undo is offered)
        const bar = barOf(pb);
        assert.ok(textOf(bar).includes('LIVE · riders get this'), q);
        const undo = barUndo(bar);
        assert.ok(undo, q);
        assert.equal(undo.includes('name="from"'), false);
        assert.ok(undo.includes(CLUB_FIELD));
        assert.equal(undoOf(head), null, q);
        assert.equal(body.includes('action="/manage/live"'), false, q);
        assert.match(body, /<li class="cp-row live picked" data-sel="v:c00005">/);
    }

    srv.clock.now = NOW + 10 * 60000;                                            // 18:26: the Undo window (18:14 + 10 min) has closed
    const later = await page('?v=c00005');
    const pb2 = element(later, '<div id="panel-body"');
    assert.equal(/pt-old|pt-dropped|pt-mark/.test(pb2), false);
    assert.ok(textOf(barOf(pb2)).includes('LIVE · riders get this'));
    assert.equal(pb2.includes('<form'), false);
    assert.equal(undoOf(later), null);
    assert.equal(barUndo(later), null);
});


test('a race that is over: its versions under Over, the panel read only', async t => {
    await start(t, OVER);
    const body = await page('?v=c00004');
    const over = element(body, '<details class="fold over"');
    assert.ok(over.startsWith('<details class="fold over" id="over" data-keep-refresh open>'), over.slice(0, 80));
    assert.match(over, /<li class="cp-row picked" data-sel="v:c00004"><a class="cp-link" href="\/manage\/team\/rollers\?v=c00004#panel" aria-current="true"/);
    assert.ok(over.includes('id="race-2026-11-19"'));
    assert.equal(over.includes('action="/manage/live"'), false);                 // no Make live, no Rename in an over race
    assert.equal(over.includes('/manage/plan/rename'), false);
    assert.ok(over.includes('action="/manage/sheet/delete"'));                    // its plans' ⋯: Delete only
    const pb = element(body, '<div id="panel-body"');
    assert.ok(element(body, '<div id="panel"').includes('<span class="cp-cap" title="Against live v3 · Hanna in, Ben out">Against live v3 · Hanna in, Ben out</span>'));
    assert.ok(pb.includes('<table class="ptable ptable-plan">'));
    assert.ok(textOf(element(pb, '<div class="cp-what"')).includes('This race is over: nothing can be changed.'));
    assert.equal(textOf(barOf(pb)).trim(), 'Read only');                        // the action bar: read only
    assert.equal(pb.includes('<form'), false);
    assert.equal(element(body, '<div id="panel"').includes('<form'), false);
    // without a selection the fold stays closed
    assert.match(await page(''), /<details class="fold over" id="over" data-keep-refresh><summary>/);
});


test('a race that is over offers no Undo, also with nothing picked', async t => {
    await start(t, OVER - 60000);
    const v = VERSION_OF(srv, 'rollers');
    const made = await post(srv, cookie, '/manage/live', {team: 'rollers', sheet: 'c00004', version: v, confirm: '1'});
    assert.equal(made.status, 303);
    assert.ok(barUndo(await page('')), 'a minute before the race is over: Undo in the live card\'s bar');
    srv.clock.now = OVER;                                                         // within the 10 min of Undo, but the race is over
    for (const q of ['', '?v=c00004']) {
        const body = await page(q);
        assert.equal(element(body, '<div id="panel"').includes('/manage/live/undo'), false, q);
        assert.equal(body.includes('/manage/live/undo'), false, q);
    }
    const tv = VERSION_OF(srv, 'rollers');
    assert.equal((await (await srv.get(`${PATH}?panel=1&tv=${tv}`, cookie)).text()).includes('/manage/live/undo'), false);
});


test('a picked version replaces the live card, before the gate and after it; the live row counts after the gate only', async t => {
    await start(t, BEFORE);
    const none = await page('');
    assert.match(none, /<body class="teampage cockpit"/);
    // nothing picked: the live version's card, the plan as riders get it, its riders counted, the hint
    const head = element(none, '<div id="panel"');
    const card = element(none, '<div id="panel-body"');
    assert.ok(textOf(head).includes('Riders on \'Rollers · fast\' v3'));
    assert.match(metaOf(head), /^Plan code [0-9A-Z]{6} 6 riders$/);
    assert.ok(card.includes('<table class="ptable ptable-plan">'));
    assert.equal(textOf(card).includes('have the plan'), false);                 // not the states: the plan
    assert.ok(textOf(element(card, '<div class="cp-what"')).includes('Who has the plan shows from 19:00'));
    for (const name of ['Ben', 'Cleo', 'Dan', 'Eva', 'Finn', 'Gus']) {
        assert.ok(card.includes(`<span class="pt-nm">${name}</span>`), name);
    }
    // before the gate the live row has no count
    assert.equal(textOf(element(none, '<li class="cp-row live picked" data-sel="v:c00005">')).includes('have it'), false);

    // #panel names the row its card shows, in the page and in the fragment (the script marks it)
    assert.match(none, /<div id="panel" data-kind="version" data-sel="v:c00005" tabindex="-1">/);
    const fragAt = async q => (await srv.get(`${PATH}${q}&panel=1&tv=${VERSION_OF(srv, 'rollers')}`, cookie)).text();
    assert.ok((await fragAt('?v=c00004')).startsWith('<div id="panel" data-kind="version" data-sel="v:c00004" tabindex="-1">'));

    const picked = await page('?v=c00004');
    assert.match(picked, /<body class="teampage cockpit has-sel"/);
    // one card: the picked version's; nothing of the live card stays in the document
    assert.equal(/id="riders"|riders-card|Riders on/.test(element(picked, '<div class="cp">')), false);
    assert.equal(/#riders|\.riders-card\{display/.test(APP_CSS), false);
    // after the gate the same selection still has one card, without the states; the live row counts
    srv.clock.now = NOW;
    const after = await page('?v=c00004');
    assert.match(after, /<body class="teampage cockpit has-sel"/);
    assert.ok(element(after, '<div id="panel"').startsWith('<div id="panel" data-kind="version" data-sel="v:c00004" tabindex="-1">'));
    assert.ok((await fragAt('?v=c00004')).startsWith('<div id="panel" data-kind="version" data-sel="v:c00004" tabindex="-1">'));
    assert.ok((await fragAt('?x=')).startsWith('<div id="panel" data-kind="version" data-sel="v:c00005" tabindex="-1">'));
    assert.equal(/id="riders"|riders-card|rstates|have the plan/.test(element(after, '<div class="cp">')), false);
    assert.ok(textOf(element(after, '<li class="cp-row live" data-sel="v:c00005">')).includes('v3 19:12 · live since 19:14 · 0/6 have it'));
    // and opened with nothing picked, the live card counts "0 of 6 have the plan", the same count
    assert.match(metaOf(element(await page(''), '<div id="panel"')), /0 of 6 have the plan$/);
});


test('nothing live in the nearest race, nothing picked: the card says so and the bar asks to pick a version (spec §5.3b)', async t => {
    await start(t);
    srv.store.change(CID, cl => {
        cl.teams.rollers.races[DATE].live = null;
    });
    const body = await page('');
    assert.match(body, /<div id="panel" data-kind="none" data-sel="" tabindex="-1">/);
    assert.equal(textOf(element(body, '<h2 class="cp-title"')).trim(), 'Nothing live for Thu 19 Nov yet');
    assert.equal(textOf(barOf(body)).trim(), 'Pick a version to see it and make it live.');
    assert.equal(/<table|cp-close/.test(element(body, '<div class="cp-body"') + element(body, '<div id="panel"')), false);
    assert.equal(count(body, ' picked"'), 0);                                    // no row picked
    assert.equal(body.includes('aria-current="true"'), false);
});


test('the live row links to its race\'s live pointer (?r=): a reload after another switch draws the new live version, never pins one', async t => {
    await start(t);
    const at = await page('?r=2026-11-19');
    assert.match(at, /<body class="teampage cockpit has-sel"/);                   // a selection: a phone's sheet
    assert.match(at, /data-here="\/manage\/team\/rollers\?r=2026-11-19"/);
    assert.match(at, /content="30;url=\/manage\/team\/rollers\?r=2026-11-19"/);  // the reload keeps the pointer
    assert.match(at, /<div id="panel" data-kind="version" data-sel="v:c00005" tabindex="-1">/);
    assert.ok(textOf(element(at, '<div id="panel"')).includes('Riders on \'Rollers · fast\' v3'));
    assert.match(element(at, '<div id="panel"'), /<a class="cp-close" href="\/manage\/team\/rollers#race-2026-11-19"/);   // the sheet's ✕
    assert.match(at, /<li class="cp-row live picked" data-sel="v:c00005"><a class="cp-link" href="\/manage\/team\/rollers\?r=2026-11-19#panel" aria-current="true"/);
    assert.match(at, /<ul class="cp-rows sel-rows"><li class="cp-row live picked" data-sel="v:c00005">/);
    assert.equal(at.includes('action="/manage/live"'), false);
    // another captain makes v2 live: the same URL now draws v2, the live one, with nothing to make live
    const made = await post(srv, cookie, '/manage/live', {team: 'rollers', sheet: 'c00004', version: VERSION_OF(srv, 'rollers'), confirm: '1'});
    assert.equal(made.status, 303);
    const again = await page('?r=2026-11-19');
    assert.match(again, /<div id="panel" data-kind="version" data-sel="v:c00004" tabindex="-1">/);
    assert.ok(textOf(element(again, '<div id="panel"')).includes('Riders on \'Rollers · fast\' v2'), textOf(element(again, '<div id="panel"')));
    assert.equal(again.includes('action="/manage/live"'), false);                  // no Make live button anywhere
    assert.ok(textOf(barOf(again)).includes('LIVE · riders get this'));
    assert.match(again, /<li class="cp-row live picked" data-sel="v:c00004"><a class="cp-link" href="\/manage\/team\/rollers\?r=2026-11-19#panel"/);
    // the fragment is the page's own slots
    const frag = await (await srv.get(`${PATH}?r=2026-11-19&panel=1&tv=${VERSION_OF(srv, 'rollers')}`, cookie)).text();
    assert.equal(frag, slots(again));
    // the race moved by another captain (race ⋯ When, to Fri 20 Nov): the old ?r= is no race any more;
    // it answers like the bare page (the nearest race's live version, as a selection: a phone's sheet
    // with ✕), never "This version no longer exists", and its fragment (the script's reload of the
    // slots) is the page's own
    srv.store.change(CID, cl => setRace(cl, 'rollers', DATE, {to: '2026-11-20', start: '19:30'}, NOW));
    const moved = await page('?r=2026-11-19');
    assert.equal(textOf(moved).includes('no longer exists'), false);
    assert.match(moved, /<div id="panel" data-kind="version" data-sel="v:c00004" tabindex="-1">/);
    assert.ok(textOf(element(moved, '<div id="panel"')).includes('Riders on \'Rollers · fast\' v2'));
    assert.match(moved, /data-here="\/manage\/team\/rollers"/);                 // the page's own URL: the bare one
    assert.equal(moved.includes('action="/manage/live"'), false);
    const movedFrag = await srv.get(`${PATH}?r=2026-11-19&panel=1&tv=${VERSION_OF(srv, 'rollers')}`, cookie);
    assert.equal(movedFrag.status, 200);
    assert.equal(await movedFrag.text(), slots(moved));
    // a race with nothing live: its card says so, with the sheet's ✕; a value that is no date: gone
    srv.store.change(CID, cl => {
        cl.teams.rollers.races['2026-11-20'].live = null;
    });
    const none = await page('?r=2026-11-20');
    assert.match(none, /<div id="panel" data-kind="none" data-sel="" tabindex="-1">/);
    assert.equal(textOf(element(none, '<h2 class="cp-title"')).trim(), 'Nothing live for Fri 20 Nov yet');
    assert.ok(element(none, '<div id="panel"').includes('class="cp-close"'));
    assert.match(await page('?r=x'), /<div id="panel" data-kind="gone" data-sel="" tabindex="-1">/);
});


test('a ?r= of a race that is gone, with no race to fall back to (a special team): the gone card with its ✕, never an empty sheet', async t => {
    const env = {CODE_SECRET, PUBLIC_URL: 'https://paceline.example.org'};
    // a sheet (the body's has-sel: below 1180 px the list is hidden) always holds a card with the
    // close link, in the page and in the fragment the script swaps in: `q` of team page `p`
    const closable = async (q, p = PATH) => {
        const body = await page(q, p);
        assert.match(body, /<body class="teampage cockpit has-sel[ "]/, `${p}${q}`);
        const panel = element(body, '<div id="panel"');
        assert.ok(panel.includes('<div class="cp-top"><div class="cp-head">'), `${p}${q}: a card's head`);
        assert.ok(textOf(element(body, '<div class="cp-body"') ?? '').trim() !== '', `${p}${q}: the card says something`);
        assert.equal(count(panel, '<a class="cp-close" href="'), 1, `${p}${q}: its ✕`);
        const frag = await srv.get(`${p}${q}&panel=1&tv=${VERSION_OF(srv, p.split('/').pop())}`, cookie);
        assert.equal(frag.status, 200, `${p}${q}`);
        assert.equal(await frag.text(), slots(body), `${p}${q}: the fragment is the page's own slots`);
        return body;
    };
    const SELS = ['?r=2026-11-12', '?r=2026-11-19', '?r=2026-11-26', '?r=x', '?v=zzzzzz', '?v=c00005', '?e=zzzzzz', '?e=c00006'];

    // Cogs, a special team (no regular race day) without any race: an old ?r= has nothing to fall back to
    const made = makeClub({teams: [['Rollers', '19:30'], ['Cogs', '19:30']]});
    made.club.teams.cogs.kind = 'special';
    cookie = made.cookie;
    srv = await serve(t, made, {now: NOW, env});
    const COGS = '/manage/team/cogs';
    assert.deepEqual(selectionOf(made.club, 'cogs', new URLSearchParams('r=2026-11-12'), NOW), {kind: 'gone', what: 'version'});
    // the view never pairs a race selection with no card, whoever made the selection
    assert.deepEqual(cockpitView(made.club, 'cogs', {now: NOW, sel: {kind: 'race', date: null}}).panel, {kind: 'gone', what: 'version'});
    const old = await closable('?r=2026-11-12', COGS);
    assert.match(old, /<div id="panel" data-kind="gone" data-sel="" tabindex="-1">/);
    assert.match(element(old, '<div id="panel"'), /<a class="cp-close" href="\/manage\/team\/cogs">/);     // the ✕ leads to the bare page
    assert.ok(textOf(element(old, '<div id="panel-body"')).includes('This version no longer exists.'));
    assert.match(old, /<main class="page wide cockpit" id="main" data-tv="\d+" data-here="\/manage\/team\/cogs">/);   // the page's own URL: the bare one
    assert.equal(old.includes('?r='), false);                                    // nothing asks the old date again
    // the bare page is no sheet: its list says there is no plan, and no card is drawn
    const bare = await page('', COGS);
    assert.match(bare, /<body class="teampage cockpit"/);
    assert.match(bare, /<div id="panel" data-kind="" data-sel="" tabindex="-1"><\/div>/);
    for (const q of SELS) {
        await closable(q, COGS);
        await closable(q);                                                       // Rollers, weekly, without a plan: its regular day
    }
    assert.match(await closable('?r=2026-11-12'), /<div id="panel" data-kind="none" data-sel="" tabindex="-1">/);   // "Nothing live for Thu 19 Nov yet"

    // Rollers made special, its only race over: nothing ahead and no regular day, so the same holds;
    // the race that is over keeps its own ?r= (its live version, read only)
    const fix = cockpitClub();
    fix.club.teams.rollers.kind = 'special';
    ids = fix.ids;
    cookie = fix.cookie;
    srv = await serve(t, fix, {now: OVER, env});
    const late = await closable('?r=2026-11-12');
    assert.match(late, /<div id="panel" data-kind="gone" data-sel="" tabindex="-1">/);
    assert.match(element(late, '<div id="panel"'), /<a class="cp-close" href="\/manage\/team\/rollers">/);
    assert.match(late, /data-here="\/manage\/team\/rollers"/);
    assert.match(late, /<noscript><meta http-equiv="refresh" content="60;url=\/manage\/team\/rollers"><\/noscript>/);   // the reload asks the bare page
    const kept = await closable('?r=2026-11-19');
    assert.match(kept, /<div id="panel" data-kind="version" data-sel="v:c00005" tabindex="-1">/);
    assert.ok(textOf(barOf(kept)).includes('Read only'));
    for (const q of SELS) {
        await closable(q);
    }

    // a weekly team always has a race to fall back to (its regular day): every selection is closable there too
    await start(t);
    for (const q of SELS) {
        await closable(q);
    }
});


test('the Undo of a switch in a later race: on that race\'s live row while the card shows another, never twice, never late or for a race that is over', async t => {
    const made = cockpitClub();
    const c = made.club;
    const sun = '2026-11-22';
    const add = (riders, at, live, as = 'new') => uploadSheet(c, {slug: 'rollers', json: plan('Rollers sunday', riders.map(id => [id, 60, {pull_power: 300}])), text: null,
        date: sun, start: '18:00', base: c.teams.rollers.version, via: 'file', type: 'sunday', as, live}, {now: T(at), newId: made.newId}).id;
    const s1 = add(['1001', '1002'], '2026-11-19T10:00:00Z', true);
    const s2 = add(['1001', '1003'], '2026-11-19T10:01:00Z', false, c.sheets[s1].plan);
    makeLive(c, 'rollers', s2, NOW - 60000);                                      // the team's last switch: Sunday's, a minute ago
    ids = made.ids;
    cookie = made.cookie;
    srv = await serve(t, made, {now: NOW, env: {CODE_SECRET, PUBLIC_URL: 'https://paceline.example.org'}});
    // the Undo forms a page shows (a row's hidden one, [hidden]{display:none!important}, does not)
    const undos = html => count(html, 'action="/manage/live/undo"') - count(html, '<div class="cp-row-undo" data-row-undo hidden>');
    // the bare page: the card is Thursday's live version, without Undo; Sunday's live row has it, a plain form
    const bare = await page('');
    assert.equal(undos(bare), 1, 'once on the page');
    assert.equal(barUndo(bare), null);
    const row = element(bare, `<li class="cp-row live" data-sel="v:${s2}">`);
    assert.ok(row, 'Sunday\'s live row');
    const form = element(row, '<div class="cp-row-undo" data-row-undo>');      // shown
    assert.ok(form.includes('<form method="post" action="/manage/live/undo">') && form.includes(CLUB_FIELD) && form.includes('name="team" value="rollers"')
        && form.includes(`name="version" value="${VERSION_OF(srv, 'rollers')}"`), form);
    // its race's card (a click on that row, ?r=, or the version): Undo in the card; the row's is drawn
    // too, hidden, so a swap that takes the card's away (another row, the sheet's ✕) can show it
    for (const q of [`?r=${sun}`, `?v=${s2}`]) {
        const b = await page(q);
        assert.equal(undos(b), 1, q);
        assert.ok(barUndo(b), q);
        assert.ok(element(b, `<li class="cp-row live picked" data-sel="v:${s2}">`).includes('<div class="cp-row-undo" data-row-undo hidden><form method="post" action="/manage/live/undo">'), q);
    }
    // landed there after the switch (the flash with Undo): the row's is drawn, hidden
    const landed = await followPost(srv, cookie, '/manage/live', {team: 'rollers', sheet: s1, version: VERSION_OF(srv, 'rollers'), confirm: '1'});
    assert.equal(landed.location, `/manage/team/rollers?r=${sun}#panel`);
    assert.ok(undoOf(element(landed.page, '<div id="panel"')), 'Undo in the flash');
    assert.equal(undos(landed.page), 1);
    assert.ok(element(landed.page, `<li class="cp-row live picked" data-sel="v:${s1}">`).includes('data-row-undo hidden'));
    // the fragment a swap to Thursday's row brings draws no Undo: the row's is the one the script shows
    const thuFrag = await (await srv.get(`${PATH}?r=${DATE}&panel=1&tv=${VERSION_OF(srv, 'rollers')}`, cookie)).text();
    assert.equal(thuFrag.includes('/manage/live/undo'), false);
    // back to the state before: s2 made live again (from s1), its Undo offered, for the checks below
    await post(srv, cookie, '/manage/live', {team: 'rollers', sheet: s2, version: VERSION_OF(srv, 'rollers'), confirm: '1'});
    assert.equal(srv.store.get(CID).teams.rollers.races[sun].live, s2);
    // another version picked: on the row again
    assert.ok(element(await page('?v=c00004'), `<li class="cp-row live" data-sel="v:${s2}">`).includes('data-row-undo'));
    // the row's form works without the script: a plain POST, as the card's
    const undone = await followPost(srv, cookie, '/manage/live/undo', {team: 'rollers', version: VERSION_OF(srv, 'rollers'), confirm: '1'});
    assert.equal(undone.location, `/manage/team/rollers?r=2026-11-22#panel`);
    assert.equal(srv.store.get(CID).teams.rollers.races[sun].live, s1);
    assert.equal(undos(await page('')), 0, 'no Undo of the Undo');
    // the 10 minutes over: none
    await post(srv, cookie, '/manage/live', {team: 'rollers', sheet: s2, version: VERSION_OF(srv, 'rollers'), confirm: '1'});
    assert.equal(undos(await page('')), 1);
    srv.clock.now = NOW + 10 * 60000 + 1;
    assert.equal(undos(await page('')), 0, 'late');
});


test('a selection that is gone, and one of another team', async t => {
    await start(t);
    const gone = await page('?v=zzzzzz');
    assert.match(gone, /<div id="panel" data-kind="gone" data-sel="" tabindex="-1">/);
    assert.ok(textOf(element(gone, '<div id="panel-body"')).includes('This version no longer exists.'));
    assert.match(element(gone, '<div id="panel"'), /<a class="cp-close" href="\/manage\/team\/rollers#race-2026-11-19"/);
    const entry = await page('?e=zzzzzz');
    assert.ok(textOf(element(entry, '<div id="panel-body"')).includes('This plan is stored or no longer here.'));
    assert.match(element(entry, '<div id="panel"'), /<a class="cp-close" href="\/manage\/team\/rollers#race-2026-11-19"/);
    const res = await srv.get('/manage/team/sprockets?e=c00006', cookie);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/manage/team/rollers?e=c00006');
    // a team that is not there
    assert.equal((await srv.get('/manage/team/nobody', cookie)).status, 404);
    // a received plan picked: its head and the table against the live version of the race its Store form has chosen
    const e = await page('?e=c00006');
    assert.match(e, /<body class="teampage cockpit has-sel sel-e"/);
    assert.ok(textOf(element(e, '<div id="panel"')).includes('Sent 19:10 · \'Rollers fast\' · 6 riders'));
    assert.ok(element(e, '<div id="panel"').includes('<span class="cp-cap" title="Against live v3 · Hanna in, Ben out">Against live v3 · Hanna in, Ben out</span>'));   // the form preselects 'Rollers · fast' (Task 8)
    assert.match(e, /<li class="cp-row picked" data-sel="e:c00006"><a class="cp-link" href="[^"]+" aria-current="true"/);
});


test('the fragment is the page\'s own three slots, byte for byte, club field included', async t => {       // [Review Focus 2]
    await start(t);
    const tv = VERSION_OF(srv, 'rollers');
    for (const q of ['', '?v=c00004', '?v=c00005', '?v=c00002', '?e=c00006', '?v=zzzzzz']) {
        const frag = await srv.get(`${PATH}${q}${q ? '&' : '?'}panel=1&tv=${tv}`, cookie);
        assert.equal(frag.status, 200, q);
        const text = await frag.text();
        assert.equal(text, slots(await page(q)), q);
        assert.equal(count(text, '<form '), count(text, CLUB_FIELD), q);
        // every form carries the team's version: as `version`, or as `base` (Store); Discard needs none
        assert.equal(count(text, '<form '), count(text, `name="version" value="${tv}"`) + count(text, `name="base" value="${tv}"`) + count(text, '/discard" data-arm>'), q);
        assert.equal(text.includes('name="from"'), false, q);
        assert.equal(text.includes('<html'), false);
        assert.equal(text.includes('id="riders"'), false);
    }
    // the fragments with forms have them: Make live (v2), Undo (v3)
    assert.ok((await (await srv.get(`${PATH}?v=c00004&panel=1&tv=${tv}`, cookie)).text()).includes('action="/manage/live"'));
    assert.ok((await (await srv.get(`${PATH}?v=c00005&panel=1&tv=${tv}`, cookie)).text()).includes('action="/manage/live/undo"'));
    assert.equal((await srv.get(`${PATH}?v=c00004&panel=1&tv=${tv - 1}`, cookie)).status, 409);     // a stale page: the script loads the whole page
    assert.equal((await srv.get(`${PATH}?v=c00004&panel=1`, cookie)).status, 409);
    assert.equal((await srv.get(`/manage/team/sprockets?e=c00006&panel=1&tv=${VERSION_OF(srv, 'sprockets')}`, cookie)).status, 409);
});


test('the fragment never takes a flash: the next page does', async t => {
    await start(t);
    const res = await post(srv, cookie, '/manage/plan/rename', {team: 'rollers', plan: ids.slow, type: 'easy', version: VERSION_OF(srv, 'rollers')});
    assert.equal(res.status, 303);
    const pair = res.headers.getSetCookie().map(c => c.split(';')[0]).find(c => c.startsWith('__Host-pl_flash='));
    const both = `${cookie}; ${pair}`;
    const frag = await srv.get(`${PATH}?panel=1&tv=${VERSION_OF(srv, 'rollers')}`, both);
    assert.equal(frag.status, 200);
    assert.equal(frag.headers.getSetCookie().length, 0);
    assert.equal(flashOf(await frag.text()), null);
    const full = await srv.get(PATH, both);
    assert.deepEqual(flashOf(await full.text()), {kind: 'ok', text: 'Renamed to \'Rollers · easy\'.'});
});


test('Make live from the panel: it acts or asks as the rule says, and lands on the race\'s live pointer (?r=); a refusal keeps the version picked', async t => {
    await start(t, BEFORE);
    // before the gate: 'Rollers · slow' v1 acts at once
    const got = await followPost(srv, cookie, '/manage/live', {team: 'rollers', sheet: 'c00002', version: VERSION_OF(srv, 'rollers')});
    assert.equal(got.location, '/manage/team/rollers?r=2026-11-19#panel');      // the race's live pointer: a reload follows live
    assert.deepEqual(got.flash, {kind: 'ok', text: '\'Rollers · slow\' v1 is live for Rollers.'});
    assert.equal(liveOf(), 'c00002');
    const head = element(got.page, '<div id="panel"');
    assert.ok(undoOf(head), head);                                               // Undo in the flash of the switch, not again in the bar
    assert.equal(barUndo(got.page), null);
    // the new live version as riders get it: no old lines against the version live before (spec §5.3b)
    assert.equal(/pt-old|pt-dropped|pt-mark|live before/.test(element(got.page, '<div class="cp">')), false);
    assert.ok(textOf(barOf(got.page)).includes('LIVE · riders get this'));
    assert.match(got.page, /<li class="cp-row live picked" data-sel="v:c00002">/);

    // after the gate (the clock at 19:16): 'Rollers · fast' v2 asks first
    srv.clock.now = NOW;
    const version = VERSION_OF(srv, 'rollers');
    const ask = await post(srv, cookie, '/manage/live', {team: 'rollers', sheet: 'c00004', version});
    assert.equal(ask.status, 200);
    assert.ok(ask.body.includes('<h1>Make &#39;Rollers · fast&#39; v2 live?</h1>'), ask.body);
    const form = element(ask.body, '<form method="post" action="/manage/live"');
    for (const f of [CLUB_FIELD, 'name="confirm" value="1"', 'name="sheet" value="c00004"']) {
        assert.ok(form.includes(f), f);
    }
    assert.match(ask.body, /<a class="btn secondary" href="\/manage\/team\/rollers\?v=c00004">/);
    assert.equal(liveOf(), 'c00002');
    const yes = await followPost(srv, cookie, '/manage/live', {team: 'rollers', sheet: 'c00004', version, confirm: '1'});
    assert.equal(yes.location, '/manage/team/rollers?r=2026-11-19#panel');
    assert.equal(liveOf(), 'c00004');

    // a stale version: 409, the new page with v2 still picked and why
    const stale = await post(srv, cookie, '/manage/live', {team: 'rollers', sheet: 'c00004', version, confirm: '1'});
    assert.equal(stale.status, 409);
    assert.match(stale.body, /<li class="cp-row live picked" data-sel="v:c00004">/);
    assert.deepEqual(flashOf(stale.body), {kind: 'err', text: 'Rollers changed since you opened the page. Nothing was changed.'});
    assert.ok(element(stale.body, '<div id="panel"').includes('class="flash err"'));
    assert.equal(stale.body.includes('<meta http-equiv="refresh"'), false);       // a refusal's page does not reload itself

    // an Undo from a stale page: 409, the version live now still picked (as a stale Make live)
    const staleUndo = await post(srv, cookie, '/manage/live/undo', {team: 'rollers', version: VERSION_OF(srv, 'rollers') - 1, confirm: '1'});
    assert.equal(staleUndo.status, 409);
    assert.match(staleUndo.body, /<li class="cp-row live picked" data-sel="v:c00004">/);
    assert.deepEqual(flashOf(staleUndo.body), {kind: 'err', text: 'Rollers changed since you opened the page. Nothing was changed.'});

    // Undo (offered for the Make live of v2): it asks after the gate, and confirmed lands on 'Rollers · slow' v1, live again
    const undoFields = {team: 'rollers', version: VERSION_OF(srv, 'rollers')};
    const undoAsk = await post(srv, cookie, '/manage/live/undo', undoFields);
    assert.equal(undoAsk.status, 200);
    assert.ok(element(undoAsk.body, '<form method="post" action="/manage/live/undo"').includes('name="confirm" value="1"'));
    const undone = await followPost(srv, cookie, '/manage/live/undo', {...undoFields, confirm: '1'});
    assert.equal(undone.location, '/manage/team/rollers?r=2026-11-19#panel');
    assert.match(undone.flash.text, /^Undone: v1 of 'Rollers · slow' is live again for Rollers\./);
    assert.equal(liveOf(), 'c00002');

    // a form of a page from before the switch (from=cockpit, back=plan) answers the same
    const old = await post(srv, cookie, '/manage/live', {team: 'rollers', sheet: 'c00004', version: VERSION_OF(srv, 'rollers'), confirm: '1', from: 'cockpit', back: 'plan'});
    assert.equal(old.headers.get('location'), '/manage/team/rollers?r=2026-11-19#panel');
});


test('every other form of the page comes back to it', async t => {
    await start(t);
    const version = () => VERSION_OF(srv, 'rollers');
    const rename = await post(srv, cookie, '/manage/plan/rename', {team: 'rollers', plan: ids.slow, type: 'easy', version: version()});
    assert.equal(rename.status, 303);
    assert.equal(rename.headers.get('location'), '/manage/team/rollers#plan-c00002');
    const event = await post(srv, cookie, '/manage/race', {team: 'rollers', date: '2026-11-19', version: version(), action: 'event',
        event: 'https://zwift.com/events/view/5123456'});
    assert.equal(event.status, 303);
    assert.equal(event.headers.get('location'), '/manage/team/rollers#race-2026-11-19');
    const del = await post(srv, cookie, '/manage/sheet/delete', {team: 'rollers', sheet: ids.slow, version: version()});
    assert.equal(del.status, 200);
    const form = element(del.body, '<form method="post" action="/manage/sheet/delete"');
    assert.equal(form.includes('name="from"'), false, form);
    assert.ok(form.includes('name="confirm" value="1"'));
    assert.match(del.body, /<a class="btn secondary" href="\/manage\/team\/rollers">/);
    const gone = await post(srv, cookie, '/manage/sheet/delete', {team: 'rollers', sheet: ids.slow, version: version(), confirm: '1'});
    assert.equal(gone.headers.get('location'), '/manage/team/rollers');
    // a refusal (a stale page) is the cockpit too
    const stale = await post(srv, cookie, '/manage/plan/rename', {team: 'rollers', plan: ids.fast, type: 'x', version: version() - 1});
    assert.equal(stale.status, 409);
    assert.match(stale.body, /<main class="page wide cockpit"/);
    // a back=plan of a page from before the switch is ignored: the team page too
    const plain = await post(srv, cookie, '/manage/plan/rename', {team: 'rollers', plan: ids.fast, type: 'quick', version: version(), back: 'plan'});
    assert.equal(plain.headers.get('location'), '/manage/team/rollers#plan-c00001');
    // every form of the page carries the club
    const body = await page('?v=c00004');
    const main = element(body, '<main');
    assert.equal(count(main, '<form '), count(main, CLUB_FIELD));
    assert.ok(elements(main, '<form ').length > 5);
});


// ---- Store in the page (Task 8: team cockpit spec §5.4, §8 "the flash model") ----

const pickOf = (body, id) => element(body, `<div class="cp-pick" data-for="e:${id}"`);
const asRadios = html => [...html.matchAll(/<input type="radio" name="as" value="([^"]+)"( checked)?>/g)].map(m => [m[1], Boolean(m[2])]);
const raceRadios = html => [...html.matchAll(/<input type="radio" name="race" value="([^"]+)"( checked)?>/g)].map(m => [m[1], Boolean(m[2])]);
const capOf = body => /<span class="cp-cap" title="[^"]*">([^<]*)<\/span>/.exec(element(body, '<div id="panel"'))?.[1].replace(/&#39;/g, '\'') ?? null;
const holds = body => !/<body [^>]*data-refresh=/.test(body) && !body.includes('http-equiv="refresh"');
// the Store form's race fold (user, 22 Nov 2026), whether it is drawn open, and its summary as text
const foldOf = html => element(html, '<details class="fold as-race"');
const foldOpen = html => /^<details class="fold as-race" open>/.test(foldOf(html) ?? '');
const summaryOf = html => textOf(element(foldOf(html) ?? '', '<summary') ?? '').trim();
const storeFields = (extra = {}) => ({team: 'rollers', as: 'c00001', drawn: 'rollers:c00001', base: VERSION_OF(srv, 'rollers'), startFor: DATE, startWas: '19:30', ...extra});


test('a plan not stored yet: the form in its row, open; the type only for a new plan; the box as today', async t => {
    await start(t);
    const body = await page('?e=c00006');                                        // pushed as 'Rollers fast'
    assert.match(body, /<body class="teampage cockpit has-sel sel-e"/);
    const pick = element(body, '<div class="cp-pick" data-for="e:c00006"');
    assert.ok(pick, 'the .cp-pick slot');
    assert.ok(body.indexOf('data-sel="e:c00006"') < body.indexOf('<div class="cp-pick"') && body.indexOf('<div class="cp-pick"') < body.indexOf('data-sel="v:c00005"'));
    assert.match(pick, /<form id="store-c00006" method="post" action="\/manage\/inbox\/c00006" data-assign data-hold-reload>/);
    assert.deepEqual(asRadios(pick), [['c00001', true], ['c00002', false], ['new', false]]);    // the planner's name preselects 'Rollers · fast'
    assert.ok(textOf(pick).includes('Store as') && textOf(pick).includes('New version of \'Rollers · fast\''));
    assert.equal(/name="type"/.test(pick), false);
    assert.equal(/<input type="checkbox" name="live" value="on" checked>/.test(pick), false);    // a pushed plan is never live before the captain ticks it
    // the race date, the start time and the event link: in the race fold, the form's last block,
    // closed for a weekly team's next race; its summary names the race (user, 22 Nov 2026)
    const fold = foldOf(pick);
    assert.ok(fold, pick);
    assert.equal(foldOpen(pick), false, fold);
    for (const f of ['<input type="date" value="2026-11-19" readonly>', 'name="start"', 'name="event"']) {
        assert.ok(fold.includes(f), f);
    }
    assert.equal(summaryOf(pick), 'Race: Thu 19 Nov · 19:30 · Change');
    assert.ok(element(pick, '<details class="fold"').includes('name="team"'));    // "Other team" is the other fold
    assert.equal(count(pick, '<details'), 2);
    assert.match(element(pick, '<form id="store-c00006"'), /<\/details>\s*<\/form>$/);   // the fold is the form's last block
    assert.ok(pick.indexOf('name="as"') < pick.indexOf('name="live"') && pick.indexOf('name="live"') < pick.indexOf('<details class="fold as-race"'));
    assert.equal(/riders \(|What changed|class="as-title"/.test(pick), false);    // no card with the riders' names, no text fold
    // nothing the card or the list says already (spec §5.3b): no race line but the race fold's summary,
    // no line naming the page's own team, no "What happens" (the card's slot above its bar says it)
    assert.equal(/Race Thu 19 Nov|What happens|Stored as v4/.test(textOf(pick)), false, textOf(pick));
    assert.equal(pick.includes('class="as-row"'), false);
    // the race date: a new version's fixed date (its plan's), read only, posting nothing, in the date's
    // own place beside the start time
    const when = element(pick, '<div class="as-when"');
    assert.match(when, /^<div class="as-when">\s*<label class="field">Race date<input type="date" value="2026-11-19" readonly><span class="hint">The plan&#39;s date<\/span><\/label>\s*<label class="field">Start time<input type="time" name="start"/);
    assert.equal(/name="date"/.test(pick), false);
    for (const f of ['name="drawn" value="rollers:c00001"', `name="base" value="${VERSION_OF(srv, 'rollers')}"`, `name="startFor" value="${DATE}"`, 'name="startWas" value="19:30"',
        CLUB_FIELD]) {
        assert.ok(element(pick, '<form id="store-c00006"').includes(f), f);
    }
    const pb = element(body, '<div id="panel-body"');
    assert.ok(element(body, '<div id="panel"').includes('<span class="cp-cap" title="Against live v3 · Hanna in, Ben out">Against live v3 · Hanna in, Ben out</span>'));
    // What happens in the card's slot, then the action bar: Store and Discard on one line, Discard at its other end
    const what = element(pb, '<div class="cp-what"');
    assert.ok(textOf(what).includes('What happens') && textOf(what).includes('Stored as v4 of \'Rollers · fast\', not live. Riders keep \'Rollers · fast\' v3.'), what);
    const bar = barOf(pb);
    assert.match(bar, /^<div class="cp-bar"><button class="btn primary" type="submit" form="store-c00006" data-submit>Store<\/button>/);
    const discard = armOf(bar, '/manage/inbox/c00006/discard');
    assert.ok(discard.includes('name="back" value="/manage/team/rollers"'), discard);
    assert.ok(bar.indexOf('form="store-c00006"') < bar.indexOf('/manage/inbox/c00006/discard'));   // Discard after Store, at the bar's other end
    assert.ok(pb.indexOf('<table') < pb.indexOf('<div class="cp-what"') && pb.indexOf('<div class="cp-what"') < pb.indexOf('<div class="cp-bar"'));
    assert.equal(body.includes('http-equiv="refresh"'), false);                  // an open Store form: the page does not reload itself

    // "New plan" chosen: the type, with its datalist and hint
    const fresh = pickOf(await page('?e=c00006&as=new&drawn=rollers:new&startFor=2026-11-19'), 'c00006');
    assert.deepEqual(asRadios(fresh), [['c00001', false], ['c00002', false], ['new', true]]);
    assert.match(fresh, /<input name="type" maxlength="30" value="" list="types" autocomplete="off">/);
    assert.match(fresh, /<datalist id="types"><option value="fast"><option value="slow"><\/datalist>/);
    // the date in the same place, now a field of its own, prefilled with the team's next race
    assert.match(element(fresh, '<div class="as-when"'), /^<div class="as-when">\s*<label class="field">Race date<input type="date" name="date" value="2026-11-19"><span class="hint">Another date makes a new race<\/span><\/label>\s*<label class="field">Start time<input type="time" name="start"/);
    // the type after the box, so choosing "New plan" moves no field above it; then the race fold, last
    assert.ok(fresh.indexOf('name="as"') < fresh.indexOf('name="live"') && fresh.indexOf('name="live"') < fresh.indexOf('name="type"')
        && fresh.indexOf('name="type"') < fresh.indexOf('<details class="fold as-race"') && fresh.indexOf('name="type"') < fresh.indexOf('name="event"'));
    assert.equal(foldOpen(fresh), false);
    const freshPage = await page('?e=c00006&as=new&drawn=rollers:new&startFor=2026-11-19');
    assert.ok(textOf(element(freshPage, '<div class="cp-what"')).includes('New plan \'Rollers\', not live.'));

    // the upload for 'Rollers · fast': the box is checked, the button reads 'Store and make live'
    const up = await page('?e=c00008');
    assert.deepEqual(asRadios(pickOf(up, 'c00008')), [['c00001', true], ['c00002', false], ['new', false]]);
    assert.match(pickOf(up, 'c00008'), /<input type="checkbox" name="live" value="on" checked>/);
    assert.match(element(up, '<div id="panel-body"'), /<button class="btn primary" type="submit" form="store-c00008" data-submit>Store and make live<\/button>/);
});


// The Store form's fields as the browser posts them without the script (the race fold closed or
// not): every named input with its value, a radio or a box only when checked.
function postedFields(form) {
    const fields = {};
    for (const m of form.matchAll(/<input ([^>]*)>/g)) {
        const attr = k => new RegExp(`(?:^| )${k}="([^"]*)"`).exec(m[1])?.[1] ?? null;
        const name = attr('name');
        if (name === null || (['radio', 'checkbox'].includes(attr('type')) && !/(?:^| )checked(?: |$)/.test(m[1]))) {
            continue;
        }
        fields[name] = (attr('value') ?? '').replace(/&#39;/g, '\'').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    }
    return fields;
}


test('the race fold: closed for the next race, the values posted all the same; its summary names the race and its event', async t => {
    await start(t);
    // a new plan: the date a field of its own, prefilled with the next race, in the closed fold
    const body = await page('?e=c00006&as=new&drawn=rollers:new&startFor=2026-11-19');
    const pick = pickOf(body, 'c00006');
    assert.equal(foldOpen(pick), false, foldOf(pick));
    assert.ok(foldOf(pick).includes('<input type="date" name="date" value="2026-11-19">') && foldOf(pick).includes('<input type="time" name="start" value="19:30">'));
    assert.ok(pick.includes('<input type="hidden" name="raceOpen" value="">'), pick);
    assert.equal(summaryOf(pick), 'Race: Thu 19 Nov · 19:30 · Change');
    // Store without the script, the fold left closed: the inputs in it go along (a <details> hides,
    // it does not drop them), and the plan is stored for that race at that time
    const fields = postedFields(element(pick, '<form id="store-c00006"'));
    assert.deepEqual([fields.date, fields.start, fields.event, fields.as], ['2026-11-19', '19:30', '', 'new']);
    const r = await post(srv, cookie, '/manage/inbox/c00006', fields);
    assert.equal(r.status, 303, r.body);
    const stored = sheetsOf(srv, 'rollers').map(([, sh]) => sh).find(sh => sh.label === 'Rollers' && sh.n === 1);
    assert.ok(stored, JSON.stringify(sheetsOf(srv, 'rollers').map(([, sh]) => sh.label)));
    assert.equal(stored.date, '2026-11-19');
    assert.equal(srv.store.get(CID).teams.rollers.races['2026-11-19'].start, null);    // the team's own time: the race stays on its rhythm

    // the event in the summary: the link posted when it parses, else the race's pinned or learned one
    const linked = await page('?e=c00007&as=new&drawn=rollers:new&startFor=2026-11-19&event=https%3A%2F%2Fwww.zwift.com%2Fevents%2Fview%2F5123456');
    assert.equal(summaryOf(pickOf(linked, 'c00007')), 'Race: Thu 19 Nov · 19:30 · Event 5123456 · Change');
    srv.store.change(CID, c => {
        c.teams.rollers.races['2026-11-19'].eventId = 4123456;
    });
    assert.equal(summaryOf(pickOf(await page('?e=c00007'), 'c00007')), 'Race: Thu 19 Nov · 19:30 · Event 4123456 · Change');
    // a time typed that moves the race: Store clears the learned event (uploadSheet), so it is not named
    const kept = '?e=c00007&team=rollers&as=new&drawn=rollers:new&startFor=2026-11-19&startWas=19:30';
    assert.equal(summaryOf(pickOf(await page(`${kept}&start=20:00`), 'c00007')), 'Race: Thu 19 Nov · 20:00 · Change');
    // the time emptied: Store keeps the race's, and the summary says that one
    const blank = pickOf(await page(`${kept}&start=`), 'c00007');
    assert.ok(blank.includes('<input type="time" name="start" value="">'), blank);
    assert.equal(summaryOf(blank), 'Race: Thu 19 Nov · 19:30 · Event 4123456 · Change');
    srv.store.change(CID, c => {
        c.teams.rollers.races['2026-11-19'].pinnedEventId = 5654321;
    });
    const pinned = pickOf(await page('?e=c00007'), 'c00007');
    assert.equal(summaryOf(pinned), 'Race: Thu 19 Nov · 19:30 · Event 5654321 · Change');
    assert.equal(foldOpen(pinned), false);
});


test('the race fold opens when the captain has to look: another date, a refusal about the race, a dry run about it, or opened before a redraw', async t => {
    await start(t);
    // the plan named another date than the team's next race (the upload page opened for a later race)
    const id = await intake(srv, cookie, {team: 'rollers', forDate: '2026-11-26', json: planJson('Rollers', ['1001', '1002', '1003'])});
    const named = pickOf(await page(`?e=${id}`), id);
    assert.equal(foldOpen(named), true, foldOf(named));
    assert.ok(named.includes('<input type="hidden" name="raceOpen" value="1">'));
    assert.equal(summaryOf(named), 'Race: Thu 26 Nov · 19:30 · Change');
    // the plan named a race that is over (Wed 18 Nov): the form falls back to the next race, but opens
    const over = await intake(srv, cookie, {team: 'rollers', forDate: '2026-11-18', json: planJson('Rollers', ['1001', '1002'])});
    const fellBack = pickOf(await page(`?e=${over}`), over);
    assert.equal(summaryOf(fellBack), 'Race: Thu 19 Nov · 19:30 · Change');
    assert.equal(foldOpen(fellBack), true, foldOf(fellBack));
    // the form's race is another than the next one (a date picked in the fold, then redrawn)
    assert.equal(foldOpen(pickOf(await page('?e=c00006&as=new&drawn=rollers:new&startFor=2026-11-19&date=2026-11-26'), 'c00006')), true);
    // the captain opened it: a redraw (the panel fragment, with the form's fields) draws it open again
    const tv = VERSION_OF(srv, 'rollers');
    const q = '?e=c00006&team=rollers&as=c00001&drawn=rollers:c00001&startFor=2026-11-19&startWas=19:30&start=19:30';
    const kept = await srv.get(`${PATH}${q}&raceOpen=1&panel=1&tv=${tv}`, cookie);
    assert.equal(kept.status, 200);
    assert.equal(foldOpen(element(await kept.text(), '<div class="cp-pick"')), true, 'kept open across the redraw');
    assert.equal(foldOpen(element(await (await srv.get(`${PATH}${q}&raceOpen=&panel=1&tv=${tv}`, cookie)).text(), '<div class="cp-pick"')), false);
    // a dry run that says something about the time: open (the start time is in the fold)
    assert.equal(foldOpen(pickOf(await page(`${q.replace('start=19:30', 'start=25:00')}`), 'c00006')), true);
    // the refusals and redraws of a Store that concern the race date, the start time or the link: open
    const refused = async (fields, text) => {
        const r = await post(srv, cookie, '/manage/inbox/c00006', storeFields(fields));
        assert.equal(r.status, 400, r.body);
        assert.deepEqual(flashOf(r.body), {kind: 'err', text});
        return foldOpen(pickOf(r.body, 'c00006'));
    };
    assert.equal(await refused({start: '25:00'}, 'Enter the start time as HH:MM.'), true);
    assert.equal(await refused({event: 'x'}, 'This is not a Zwift or ZwiftPower event link.'), true);
    assert.equal(await refused({as: 'new', drawn: 'rollers:new', type: 'late', date: '2026-11-26'}, 'Check the choices: the preview was for another race.'), true);
    assert.equal(await refused({startWas: '19:00'}, 'Check the choices: the race\'s start time was changed meanwhile.'), true);
    // drawn for 26 Nov, the next race (19 Nov) typed back: redrawn for the next race, open by the flag alone
    assert.equal(await refused({as: 'new', drawn: 'rollers:new', type: 'late', startFor: '2026-11-26', startWas: '19:30', date: '2026-11-19'},
        'Check the choices: the preview was for another race.'), true);
    // a time that is over for the next race (17:00 Berlin = 16:00Z, over from 18:00Z): open by its code alone
    assert.equal(await refused({start: '17:00'}, 'The race on 2026-11-19 at 17:00 is over: check the start time, or choose a later date.'), true);
    // the plan changed without a redraw and a date typed: the redraw is for the default race, so it
    // opens to show the typed date went; without a typed date it stays closed (below)
    assert.equal(await refused({as: 'new', drawn: 'rollers:c00001', type: 'late', date: '2026-11-26'}, 'Check the choices: the preview was for another team or plan.'), true);
    srv.store.change(CID, c => {
        c.teams.rollers.races['2026-11-19'].start = '17:00';           // 17:00 Berlin = 16:00Z, over from 18:00Z: over at NOW (18:16Z)
    });
    assert.equal(await refused({as: 'new', drawn: 'rollers:new', type: 'late', date: '2026-11-19', startWas: '17:00', start: ''},
        'The race on 2026-11-19 is over: choose a later date.'), true);
    srv.store.change(CID, c => {
        c.teams.rollers.races['2026-11-19'].start = null;
    });
    // one that does not: the plan choice changed without a redraw (the race stays as it was)
    assert.equal(await refused({drawn: 'rollers:c00002'}, 'Check the choices: the preview was for another team or plan.'), false);
});


test('Store answers the page with the new version picked and what the result page said', async t => {
    await start(t);
    const r = await followPost(srv, cookie, '/manage/inbox/c00006', storeFields());
    const id = sheetsOf(srv, 'rollers').find(([, s]) => s.n === 4)[0];
    assert.equal(r.location, `/manage/team/rollers?v=${id}#panel`);
    assert.deepEqual(r.flash, {kind: 'ok', text: 'Stored as v4 of \'Rollers · fast\', not live. Riders keep \'Rollers · fast\' v3.'});
    assert.ok(element(r.page, '<div id="panel"').includes('class="flash ok"'));
    const pb = element(r.page, '<div id="panel-body"');
    assert.match(pb, /<button class="btn secondary" type="submit" data-arm-open>Make v4 live…/);   // secondary: a pushed plan never goes live by a stray click
    assert.ok(textOf(r.page).includes('v4 stored 19:16, not live'));                               // the notice in its row
    assert.match(r.page, new RegExp(`<li class="cp-row picked" data-sel="v:${id}">`));
    assert.equal(srv.store.get(CID).inbox.some(e => e.id === 'c00006'), false);
    assert.equal(liveOf(), 'c00005');
    // no "Wrong file?": no Restore, no Delete plan
    assert.equal(/Wrong file|Restore|\/manage\/plan\/back|\/manage\/sheet\/delete/.test(element(r.page, '<div id="panel"')), false);
    // on every draw, not only right after Store: still secondary
    assert.match(element(await page(`?v=${id}`), '<div id="panel-body"'), /<button class="btn secondary" type="submit" data-arm-open>Make v4 live…/);
});


test('Store and make live: the result, the table as riders get it, Undo; what it changes for other teams', async t => {
    await start(t);
    const r = await followPost(srv, cookie, '/manage/inbox/c00006', storeFields({live: 'on'}));
    const [id, s] = sheetsOf(srv, 'rollers').find(([, x]) => x.n === 4);
    assert.equal(r.location, `/manage/team/rollers?r=2026-11-19#panel`);
    assert.equal(liveOf(), id);
    assert.deepEqual(r.flash, {kind: 'ok', text: `'Rollers · fast' v4 is live for Thu 19 Nov 19:30. Plan code ${s.sig}.`});
    const head = element(r.page, '<div id="panel"');
    const result = element(head, '<div class="result"');
    assert.ok(result, head);
    const lines = [...result.matchAll(/<li class="([a-z]+)">[^]*?<span>([^]*?)<\/span><\/li>/g)].map(m => [m[1], textOf(m[2]).trim()]);
    for (const said of ['Riders in the event get it within a minute.', 'Hanna moves from Sprockets to Rollers.', 'Still to do: Sprockets.']) {
        assert.ok(lines.some(([, x]) => x === said), `${said} in ${JSON.stringify(lines)}`);
    }
    // in the result page's order: when riders get it, then the moves, then the holes
    const at = x => lines.findIndex(([, y]) => y === x);
    assert.ok(at('Riders in the event get it within a minute.') < at('Hanna moves from Sprockets to Rollers.'));
    assert.ok(at('Hanna moves from Sprockets to Rollers.') < at('Still to do: Sprockets.'));
    assert.match(result, /<a [^>]*href="\/manage\/upload\?team=sprockets&amp;plan=c00003&amp;date=2026-11-19">Upload for Sprockets<\/a>/);
    // the new live version as riders get it: no old lines against v3 (spec §5.3b); Undo in the flash
    assert.equal(/pt-old|pt-dropped|pt-mark|live before/.test(element(r.page, '<div id="panel-body"')), false);
    assert.ok(textOf(barOf(r.page)).includes('LIVE · riders get this'));
    assert.ok(undoOf(r.page), 'Undo');
    assert.equal(barUndo(r.page), null);
    assert.equal(undoOf(head).form.includes('name="from"'), false);
    assert.equal(/Wrong file|Restore|\/manage\/sheet\/delete/.test(head), false);
});


// The note of a page that holds its reload (Ruling I2 (b)): in #panel-body, its last child (under
// the card), [text, Refresh's href]; null without one.
const holdNote = body => {
    const pb = element(body, '<div id="panel-body"');
    const note = pb === null ? null : element(pb, '<p class="cp-hold">');
    if (note === null) {
        return null;
    }
    assert.ok(pb.endsWith(`${note}</div>`), 'the last thing in #panel-body');
    return [textOf(note).trim(), /<a class="cp-refresh" href="([^"]+)">/.exec(note)?.[1] ?? null];
};


test('a Store result holds the reload only while it has something to keep; an open Store form holds it; the page says so', async t => {   // [Review Focus 4, Ruling I2]
    await start(t);
    // a clean result (stored, not live, nothing for anyone to do): it lets the reload go, with the
    // script and without it, so the riders card counts again; the next reload drops the result
    const r = await followPost(srv, cookie, '/manage/inbox/c00006', storeFields());
    const id = /\?v=([^#]+)#panel$/.exec(r.location)[1];
    assert.ok(element(r.page, '<div class="result"').startsWith('<div class="result">'), element(r.page, '<div class="result"'));
    assert.equal(r.page.includes('data-hold-reload'), false);
    assert.match(r.page, /<body class="[^"]*" data-refresh="30"/);
    assert.match(r.page, new RegExp(`<noscript><meta http-equiv="refresh" content="30;url=/manage/team/rollers\\?v=${id}"></noscript>`));
    assert.equal(holdNote(r.page), null);
    assert.match(r.page, new RegExp(`<div id="panel" data-kind="version" data-sel="v:${id}" tabindex="-1" data-result>`));   // a result in the head: it flows on a phone (M3)
    const again = await page(`?v=${id}`);
    assert.equal(element(again, '<div class="result"'), null);
    assert.match(again, /<noscript><meta http-equiv="refresh" content="30;url=\/manage\/team\/rollers\?v=[^"]+"><\/noscript>/);
    assert.match(again, /<body class="[^"]*" data-refresh="30"/);
    assert.equal(holdNote(again), null);

    // an open Store form: the script holds the reload while the form is in the slots and lets it go
    // after a swap to a version or to nothing (Ruling F5), so the page keeps its interval; no meta
    // refresh, which nothing could hold. The page says so under the card, with Refresh a plain link
    // to the page as it is
    const open = await page('?e=c00007');                                        // c00006 is stored now: the other one
    assert.match(open, /<body class="[^"]*" data-refresh="30"/);
    assert.equal(open.includes('http-equiv="refresh"'), false);
    assert.match(pickOf(open, 'c00007'), /<form id="store-c00007"[^>]* data-hold-reload>/);
    assert.deepEqual(holdNote(open), ['Not updating while the Store form is open · Refresh', '/manage/team/rollers?e=c00007']);
    assert.ok(open.indexOf('<div class="cp-bar">') < open.indexOf('<p class="cp-hold">'));          // under the card, outside it
    // the fragment carries the hold state and the note too
    const frag = await (await srv.get(`${PATH}?e=c00007&panel=1&tv=${VERSION_OF(srv, 'rollers')}`, cookie)).text();
    assert.ok(frag.includes(' data-hold-reload>'));
    assert.deepEqual(holdNote(frag), ['Not updating while the Store form is open · Refresh', '/manage/team/rollers?e=c00007']);
    const none = await (await srv.get(`${PATH}?v=c00004&panel=1&tv=${VERSION_OF(srv, 'rollers')}`, cookie)).text();
    assert.equal(none.includes('data-hold-reload'), false);
    assert.equal(holdNote(none), null);
    // a version picked, or nothing: the reload stays, and nothing says otherwise
    for (const q of ['', '?v=c00004']) {
        const b = await page(q);
        assert.match(b, /<body class="[^"]*" data-refresh="30"/, q);
        assert.ok(b.includes('http-equiv="refresh"'), q);
        assert.equal(b.includes('data-hold-reload'), false, q);
        assert.equal(b.includes('cp-hold'), false, q);
    }
});


test('a Store result with a team still to do, or red, holds the reload and says so; its head flows on a phone', async t => {   // [Ruling I2]
    await start(t);
    // Store and make live: Hanna moves from Sprockets, Sprockets is still to do (a way to its upload)
    const r = await followPost(srv, cookie, '/manage/inbox/c00006', storeFields({live: 'on'}));
    assert.equal(r.location, '/manage/team/rollers?r=2026-11-19#panel');         // live now: the race's live pointer
    const id = liveOf();
    assert.ok(element(r.page, '<div class="result"').startsWith('<div class="result" data-hold-reload>'));
    assert.match(r.page, /<body class="[^"]*" data-refresh="30"/);              // the script holds it while the result is shown
    assert.equal(r.page.includes('http-equiv="refresh"'), false);               // without it nothing can hold a meta refresh: none
    assert.deepEqual(holdNote(r.page), ['Not updating while this result is shown · Refresh', `/manage/team/rollers?r=2026-11-19`]);
    assert.ok(r.page.indexOf('<div class="cp-bar">') < r.page.indexOf('<p class="cp-hold">'));
    // #panel says it holds a result: below 1180 px such a head flows with the page (no inner scroll)
    assert.match(r.page, new RegExp(`<div id="panel" data-kind="version" data-sel="v:${id}" tabindex="-1" data-result>`));
    // Refresh: the page without the one-shot flash, which reloads again
    const again = await page(`?v=${id}`);
    assert.equal(element(again, '<div class="result"'), null);
    assert.equal(holdNote(again), null);
    assert.ok(again.includes('http-equiv="refresh"'));

    // a red result (stored, not live, into a race with nothing live) holds it as well
    const red = await followPost(srv, cookie, '/manage/inbox/c00007', {team: 'rollers', as: 'new', type: 'tue', drawn: 'rollers:new', date: '2026-11-26',
        startFor: '2026-11-26', startWas: '19:30', base: VERSION_OF(srv, 'rollers')});
    assert.equal(red.flash.kind, 'err', JSON.stringify(red.flash));
    assert.ok(element(red.page, '<div class="result"').startsWith('<div class="result" data-hold-reload>'));
    assert.equal(red.page.includes('http-equiv="refresh"'), false);
    assert.equal(holdNote(red.page)?.[0], 'Not updating while this result is shown · Refresh');
});


test('a page that does not reload says nothing about holding it', async t => {                    // [Ruling I2]
    await start(t, BEFORE);                                                       // 13:00: no race around
    srv.store.change(CID, cl => {
        cl.inbox = cl.inbox.filter(e => e.source !== 'receive');                  // nothing from ZwiftGopher waits: no 60 s reload
    });
    const body = await page('?e=c00008');                                         // the upload's Store form, open
    assert.equal(/<body [^>]*data-refresh=/.test(body), false);
    assert.match(pickOf(body, 'c00008'), / data-hold-reload>/);
    assert.equal(holdNote(body), null);
});


test('a received plan with two races ahead: the table follows the race radio', async t => {       // [Review Focus 5]
    const made = cockpitClub();
    const c = made.club;
    const rows = riders => plan('Rollers sunday', riders.map(id => [id, 60, {pull_power: 300}]));
    uploadSheet(c, {slug: 'rollers', json: rows(['1001', '1002']), text: null, date: '2026-11-22', start: '18:00', base: c.teams.rollers.version,
        via: 'file', type: 'sunday', as: 'new', live: true}, {now: T('2026-11-19T10:00:00Z'), newId: made.newId});
    uploadSheet(c, {slug: 'rollers', json: plan('Rollers later', [['1003', 60, {pull_power: 300}]]), text: null, date: '2026-11-26', base: c.teams.rollers.version,
        via: 'file', type: 'later', as: 'new', live: false}, {now: T('2026-11-19T10:01:00Z'), newId: made.newId});
    assert.equal(c.teams.rollers.races['2026-11-22'].live !== undefined && c.teams.rollers.races['2026-11-22'].live !== null, true);
    assert.equal(c.teams.rollers.races['2026-11-26'].live ?? null, null);
    ids = made.ids;
    cookie = made.cookie;
    srv = await serve(t, made, {now: NOW, env: {CODE_SECRET, PUBLIC_URL: 'https://paceline.example.org'}});

    const near = await page('?e=c00007');                                         // the planner's name preselects 'Rollers · slow'
    assert.deepEqual(asRadios(pickOf(near, 'c00007')).find(([, on]) => on), ['c00002', true]);
    assert.deepEqual(raceRadios(pickOf(near, 'c00007')), [['2026-11-19', true], ['2026-11-22', false], ['2026-11-26', false]]);
    assert.match(capOf(near), /^Against live 'Rollers · fast' v3/);

    const q = '?e=c00007&as=new&drawn=rollers:new&startFor=2026-11-19';
    const sun = await page(`${q}&race=2026-11-22`);
    assert.deepEqual(raceRadios(pickOf(sun, 'c00007')), [['2026-11-19', false], ['2026-11-22', true], ['2026-11-26', false]]);
    assert.match(capOf(sun), /^Against live 'Rollers · sunday' v1/);
    assert.equal(/v3/.test(capOf(sun)), false);

    const later = await page(`${q}&race=2026-11-26`);
    assert.deepEqual(raceRadios(pickOf(later, 'c00007')), [['2026-11-19', false], ['2026-11-22', false], ['2026-11-26', true]]);
    assert.equal(capOf(later), 'Nothing live for Thu 26 Nov yet: nothing to compare');
    assert.equal(/v3|Rollers · fast/.test(textOf(element(later, '<div id="panel-body"'))), false);   // never a word about v3 of the 19th (the table holds riders only)
    assert.ok(textOf(element(later, '<div class="cp-what"')).includes('Riders get no plan for this race yet.'));
    // stored there, not live: the flash is red (nothing live in that race), and Make live is primary on every draw
    const r = await followPost(srv, cookie, '/manage/inbox/c00007', {team: 'rollers', as: 'new', type: 'tue', drawn: 'rollers:new', race: '2026-11-26',
        startFor: '2026-11-26', startWas: '19:30', base: VERSION_OF(srv, 'rollers')});
    assert.deepEqual(r.flash, {kind: 'err', text: 'Stored as v1 of \'Rollers · tue\'. Not live: riders get nothing until you press Make live.'});
    const id = /\?v=([^#]+)#panel$/.exec(r.location)[1];
    assert.equal(srv.store.get(CID).sheets[id].date, '2026-11-26');
    for (const b of [r.page, await page(`?v=${id}`)]) {
        assert.match(element(b, '<div id="panel-body"'), /<button class="btn primary" type="submit"[^>]*>Make v1 live/);
    }
});


test('refusals keep the form: a choice the page was not drawn for, a bad event link, an entry that is gone; a Store for another team', async t => {
    await start(t);
    const stored = () => Object.keys(srv.store.get(CID).sheets).length;
    const n = stored();
    const waiting = () => srv.store.get(CID).inbox.some(e => e.id === 'c00006');
    const refused = async (fields, text) => {
        const r = await post(srv, cookie, '/manage/inbox/c00006', fields);
        assert.equal(r.status, 400, r.body);
        assert.deepEqual(flashOf(r.body), {kind: 'err', text});
        assert.ok(element(r.body, '<div id="panel"').includes('class="flash err"'));
        assert.match(r.body, /<main class="page wide cockpit"/);
        // answered at the POST's URL, the page names its own: the script asks the cockpit from there
        assert.match(r.body, /<main class="page wide cockpit" id="main" data-tv="\d+" data-here="\/manage\/team\/rollers\?e=c00006">/);
        assert.match(r.body, /<li class="cp-row picked" data-sel="e:c00006">/);
        assert.ok(pickOf(r.body, 'c00006'), 'the form, in its row');
        assert.ok(holds(r.body), 'a refusal does not reload itself');
        assert.equal(stored(), n);
        assert.ok(waiting());
        return r.body;
    };
    // drawn for 'Rollers · slow', sent with 'Rollers · fast': redrawn for 'Rollers · fast', with its preview
    const plan2 = await refused(storeFields({drawn: 'rollers:c00002'}), 'Check the choices: the preview was for another team or plan.');
    assert.deepEqual(asRadios(pickOf(plan2, 'c00006')).find(([, on]) => on), ['c00001', true]);
    assert.ok(pickOf(plan2, 'c00006').includes('name="drawn" value="rollers:c00001"'));
    assert.ok(textOf(element(plan2, '<div class="cp-what"')).includes('Stored as v4 of \'Rollers · fast\', not live.'));
    // a new plan for another race than the page was drawn for
    const race = await refused(storeFields({as: 'new', drawn: 'rollers:new', type: 'late', date: '2026-11-26'}), 'Check the choices: the preview was for another race.');
    assert.match(pickOf(race, 'c00006'), /<input type="date" name="date" value="2026-11-26"/);
    // an event link that does not parse: the form as sent
    const event = await refused(storeFields({event: 'x'}), 'This is not a Zwift or ZwiftPower event link.');
    assert.match(pickOf(event, 'c00006'), /name="event" maxlength="300" inputmode="url" autocomplete="off" value="x">/);
    // the entry discarded meanwhile
    const gone = await post(srv, cookie, '/manage/inbox/c00006/discard', {back: PATH, confirm: '1'});
    assert.equal(gone.status, 303);
    assert.equal(gone.headers.get('location'), PATH);
    const late = await post(srv, cookie, '/manage/inbox/c00006', storeFields());
    assert.equal(late.status, 400);
    assert.match(late.body, /<div id="panel" data-kind="gone" data-sel="" tabindex="-1">/);
    assert.match(late.body, / data-here="\/manage\/team\/rollers">/);               // a selection that is gone: nothing picked
    assert.ok(textOf(element(late.body, '<div id="panel-body"')).includes('This plan is stored or no longer here.'));
    assert.equal(stored(), n);
    // a Store for another team answers with that team's cockpit
    const other = await post(srv, cookie, '/manage/inbox/c00007', {
        team: 'sprockets', as: 'new', type: 'late', drawn: 'sprockets:new', base: VERSION_OF(srv, 'sprockets'), startFor: DATE, startWas: '19:40',
    });
    assert.equal(other.status, 303, other.body);
    assert.ok(other.headers.get('location').startsWith('/manage/team/sprockets?v='), other.headers.get('location'));
    const sid = /\?v=([^#]+)#panel$/.exec(other.headers.get('location'))[1];
    assert.equal(srv.store.get(CID).sheets[sid].team, 'sprockets');
    assert.equal(srv.store.get(CID).sheets[sid].label, 'Sprockets · late');
});


test('the ways in: Upload a file instead and a plan\'s New version land on ?e=', async t => {
    await start(t);
    const json = plan('Rollers', [['1001', 60, {pull_power: 300}], ['1002', 60, {pull_power: 300}]]);
    const res = await postUpload(srv, cookie, {team: 'rollers', forPlan: 'c00002', json}, {path: '/manage/upload?team=rollers&plan=c00002'});
    assert.equal(res.status, 303, await res.text());
    const m = /^\/manage\/team\/rollers\?e=([0-9a-hjkmnp-tv-z]{6})#panel$/.exec(res.headers.get('location'));
    assert.ok(m, res.headers.get('location'));
    const body = await page(`?e=${m[1]}`);
    assert.deepEqual(asRadios(pickOf(body, m[1])).find(([, on]) => on), ['c00002', true]);
    // an upload page from before the switch (from=cockpit or from=plan in its action): the same
    for (const from of ['cockpit', 'plan']) {
        const old = await postUpload(srv, cookie, {team: 'rollers', forPlan: 'c00002', json}, {path: `/manage/upload?team=rollers&plan=c00002&from=${from}`});
        assert.equal(old.status, 303);
        assert.match(old.headers.get('location'), /^\/manage\/team\/rollers\?e=[0-9a-hjkmnp-tv-z]{6}#panel$/, from);
    }
    // the upload page: its action keeps no `from`, its way back is the team page
    const up = await (await srv.get('/manage/upload?team=rollers&plan=c00002&from=cockpit', cookie)).text();
    assert.match(up, /<form class="stack" method="post" action="\/manage\/upload\?team=rollers&amp;plan=c00002"/);
    assert.ok(element(up, '<nav class="crumbs').includes('href="/manage/team/rollers"'));
});


// The sheet (spec §5.5) is a page mode of the body's classes: below 1180 px the stylesheet shows only
// the picked row's path of the list, so the markup must name that path (the script moves the same
// classes in a swap: client.test.mjs) and the stylesheet must hide everything else by it.
const openTags = (html, cls) => [...html.matchAll(new RegExp(`<(?:div|ul|li|section)\\b[^>]*class="(?:[^"]* )?${cls}(?: [^"]*)?"[^>]*>`, 'g'))].map(m => m[0]);

test('the sheet\'s path is marked in the list: sel-race, sel-rows and picked, the Store form a child of the picked row', async t => {
    await start(t);
    // a received plan; a version in a plan's rows; a version in the fold of older ones
    for (const [q, kind] of [['?e=c00006', 'e'], ['?v=c00004', 'v'], ['?v=c00001', 'v']]) {
        const body = await page(q);
        const [race, rows, row] = ['sel-race', 'sel-rows', 'picked'].map(cls => openTags(body, cls));
        assert.deepEqual([race.length, rows.length, row.length], [1, 1, 1], `${q}: one of each ${JSON.stringify({race, rows, row})}`);
        // nested in that order, as one chain
        const inRace = element(body, race[0]);
        const inRows = element(inRace, rows[0]);
        const picked = element(inRows, row[0]);
        assert.ok(inRace && inRows && picked, q);
        assert.ok(inRace.length > inRows.length && inRows.length > picked.length, q);
        assert.ok(race[0].startsWith('<div class="race cp-race') && rows[0].startsWith('<ul class="cp-rows') && row[0].startsWith('<li class="cp-row'), q);
        assert.ok(row[0].includes(`data-sel="${kind}:${q.slice(3)}"`), `${q}: ${row[0]}`);
        if (kind === 'e') {
            // the Store form's slot is a child of the picked row, after its link, and the only one
            assert.match(picked, /^<li [^>]*><a class="cp-link"[^]*?<\/a><div class="cp-pick" data-for="e:c00006">/);
            assert.equal(count(body, '<div class="cp-pick"'), 1);
        } else {
            assert.equal(picked.includes('cp-pick'), false, q);
            assert.equal(count(body, '<div class="cp-pick"'), 0);
        }
    }
    // nothing picked: the nearest race's live row is the picked one (its card is drawn, spec §5.3b);
    // no sheet opens (no has-sel, no sheet's path), so a phone shows the list with the card after the race
    const none = await page('');
    assert.match(none, /<body class="teampage cockpit"/);
    assert.deepEqual(openTags(none, 'sel-race'), []);
    assert.deepEqual(openTags(none, 'sel-rows'), []);
    const row = openTags(none, 'picked');
    assert.equal(row.length, 1);
    assert.ok(row[0].includes('data-sel="v:c00005"'), row[0]);
    // a selection that is gone marks nothing either
    const gone = await page('?v=zzzzzz');
    for (const cls of ['sel-race', 'sel-rows', 'picked']) {
        assert.deepEqual(openTags(gone, cls), [], cls);
    }
});

test('the stylesheet: below 1180 px a selection shows only the sheet, and the close link is a ✕', () => {
    const at = APP_CSS.indexOf('@media (max-width:1179.98px){');
    assert.ok(at > 0);
    let depth = 0;
    let end = at;
    for (let i = APP_CSS.indexOf('{', at); i < APP_CSS.length; i++) {
        depth += APP_CSS[i] === '{' ? 1 : APP_CSS[i] === '}' ? -1 : 0;
        if (depth === 0) {
            end = i;
            break;
        }
    }
    const block = APP_CSS.slice(at, end);
    assert.equal(block.includes(':has('), false);
    // every rule the sheet is made of, in the block and nowhere above 1180 px
    for (const rule of [
        'body.cockpit.has-sel .topbar', 'body.cockpit.has-sel main>:not(.cp,.pagehead,.banner)', 'body.cockpit.has-sel .pagehead>:not(.stale-banner)',
        '.cp-head{flex-wrap:nowrap;align-items:flex-start}', '.cp-title{flex:1}', '.cp-close{margin-left:auto}', 'body.cockpit.has-sel:not(.sel-e) .cp-list',
        'body.cockpit.has-sel .cp-list>:not(.sel-race)', 'body.cockpit.sel-e .sel-race>:not(.cp-pending)',
        'body.cockpit.sel-e .sel-race>.cp-pending>:not(.sel-rows)', 'body.cockpit.sel-e .sel-rows>:not(.picked)',
        'body.cockpit.sel-e .sel-rows>.picked>:not(.cp-pick){display:none}', 'body.cockpit.has-sel #panel{position:sticky',
        'body.cockpit.has-sel :is(.cp-top,.cp-body){background:none;border:0',
    ]) {
        assert.ok(block.includes(rule), rule);
        assert.equal(APP_CSS.indexOf(rule), APP_CSS.indexOf(rule, at), `${rule}: only inside the block`);
    }
    // the Store form's Make live box: a bare label, 44 px high on its own line (the smoke's 44 px rule)
    assert.ok(APP_CSS.includes('.cp-pick form>label:not(.field){display:flex;align-items:center;gap:.625rem;min-height:var(--tap)}'));
    // the close link (the ✕) only below 1180 px: from 1180 px the live version is a click on its row
    const wide = APP_CSS.slice(APP_CSS.indexOf('@media (min-width:1180px){'));
    assert.ok(wide.slice(0, wide.indexOf('\n}')).includes('.cp-close{display:none}'));
    assert.equal(/cp-back|cp-lbl/.test(APP_CSS), false);
    assert.equal(/#riders/.test(APP_CSS), false);
});

test('the close link is the phone sheet\'s ✕ only: no "‹ Riders", named Close; none on the card opened with nothing picked', async t => {
    await start(t);
    for (const q of ['?v=c00004', '?v=c00005', '?e=c00006']) {
        const body = await page(q);
        const link = element(element(body, '<div id="panel"'), '<a class="cp-close"');
        assert.match(link, /^<a class="cp-close" href="\/manage\/team\/rollers#race-2026-11-19"><svg class="i cp-x"[^]*<\/svg><span class="sr">Close<\/span><\/a>$/, q);
        assert.equal(count(body, 'class="cp-close"'), 1, q);
        assert.equal(/cp-back|cp-lbl|>Riders</.test(body), false, q);
    }
    assert.equal((await page('')).includes('cp-close'), false);
});


test('the sheet keeps the stale line and the DST banner: the first in the head, the second a child of main, as the stylesheet keys them', async t => {
    await start(t);
    // the clocks changed on Sun 25 Oct: within 14 days of it the banner is drawn
    srv.clock.now = T('2026-10-27T10:00:00Z');
    const body = await page('?e=c00006');
    const main = element(body, '<main');
    const head = element(main, '<header class="pagehead"');
    const banner = '<p class="banner warn" role="note">';
    assert.ok(main.includes(banner), 'the DST banner is drawn');
    assert.equal(head.includes(banner), false, 'not inside the head the sheet hides');
    assert.ok(main.indexOf(banner) > main.indexOf('</header>') && main.indexOf(banner) < main.indexOf('<div class="cp">'));
    // the stale line is a direct child of the head (hidden until the script shows it)
    assert.match(head, /\n\s*<p class="stale-banner" role="status" data-stale hidden /);
    // nothing else in the head carries either class, so `.pagehead>:not(.stale-banner)` hides the rest
    assert.equal(count(head, 'stale-banner'), 1);
});


// ---- the final review's fixes ----

const codeOf = id => srv.store.get(CID).sheets[id].sig;

test('the plan code: the live version\'s in its card, before and after the gate; a picked version\'s in its card\'s line', async t => {   // [Ruling I1]
    await start(t);
    const live = codeOf('c00005');
    const code = sig => `<span class="plancode">Plan code <code>${sig}</code></span>`;
    // after the gate, nothing picked: the live card, its code beside the count
    const after = element(await page(''), '<div id="panel"');
    assert.ok(after.includes(code(live)), after);
    assert.equal(metaOf(after), `Plan code ${live} 0 of 6 have the plan`);
    // a version picked: its own code under the title, and no live card beside it
    const v2 = await page('?v=c00004');
    const head = element(v2, '<div id="panel"');
    assert.ok(head.includes(code(codeOf('c00004'))), head);
    assert.ok(head.indexOf('<h2 class="cp-title"') < head.indexOf('<span class="plancode">'));
    assert.equal(v2.includes(`<code>${live}</code>`), false);
    assert.notEqual(codeOf('c00004'), live);
    // the fragment draws the same head
    const frag = await (await srv.get(`${PATH}?v=c00004&panel=1&tv=${VERSION_OF(srv, 'rollers')}`, cookie)).text();
    assert.ok(element(frag, '<div id="panel"').includes(code(codeOf('c00004'))));
    // the live version picked: its code as well
    assert.ok(element(await page('?v=c00005'), '<div id="panel"').includes(code(live)));
    // a plan not stored yet has no code yet
    assert.equal(element(await page('?e=c00006'), '<div id="panel"').includes('plancode'), false);
    // before the gate: the live plan in the rider table, its code beside the riders' count
    srv.clock.now = BEFORE;
    const before = element(await page(''), '<div id="panel"');
    assert.equal(metaOf(before), `Plan code ${live} 6 riders`);
});


test('a later race\'s fold keeps the reload while it holds no form, and holds it with one (a pin note\'s Remove event link)', async t => {   // [M9]
    const made = cockpitClub();
    const c = made.club;
    // the nearest race starts 22:30, a later one at 00:30 the next day (Fri 20 Nov) with an event link;
    // at 00:10, the later race's gate open and the nearest still to race, a rider of the later race's
    // live plan is in another event: its note has a form
    c.teams.rollers.races[DATE].start = '22:30';
    const later = uploadSheet(c, {slug: 'rollers', json: plan('Rollers late', [['1001', 60, {pull_power: 300}], ['1002', 60, {pull_power: 300}]]), text: null,
        date: '2026-11-20', start: '00:30', base: c.teams.rollers.version, via: 'file', type: 'late', as: 'new', live: true, pinnedEventId: 4567890},
    {now: T('2026-11-19T10:00:00Z'), newId: made.newId}).id;
    ids = made.ids;
    cookie = made.cookie;
    srv = await serve(t, made, {now: T('2026-11-19T23:10:00Z'), env: {CODE_SECRET, PUBLIC_URL: 'https://paceline.example.org'}});
    const fold = async () => element(await page(''), '<details class="fold race-more"');
    const plainFold = await fold();
    assert.ok(plainFold, 'the later race is folded');
    assert.ok(plainFold.startsWith('<details class="fold race-more" data-keep-refresh><summary>'), plainFold.slice(0, 80));
    assert.ok(plainFold.includes('<h2 id="riders-h-2026-11-20">'));
    assert.ok(plainFold.includes(`<p class="plancode">Plan code <code>${codeOf(later)}</code></p>`), 'the later race\'s riders card has its code');
    srv.see('1002', '2026-11-19T23:05:00Z', {sig: codeOf(later), mod: '0.3.0', sheet: later, inEvent: true, event: 4567891});
    const formFold = await fold();
    assert.ok(formFold.includes('action="/manage/sheet/unpin"'), formFold);
    assert.ok(formFold.startsWith('<details class="fold race-more"><summary>'), formFold.slice(0, 80));
});


test('the phone: the card follows the nearest race, before the later races, Over and the help, the flash on top; desktop keeps its columns', () => {   // [M1]
    const at = APP_CSS.indexOf('@media (max-width:1179.98px){');
    const block = APP_CSS.slice(at, APP_CSS.indexOf('@media (prefers-reduced-motion', at));
    // without a selection the list's blocks and the panel's parts are the grid's own items, in this
    // order: the flash (order 0), the nearest race, the card's top and body, the rest; the live row
    // looks live, not picked (no sheet is open)
    for (const rule of [
        'body.cockpit:not(.has-sel) :is(.cp-list,#panel){display:contents}',
        'body.cockpit:not(.has-sel) .cp-list>*{order:3;min-width:0}',
        'body.cockpit:not(.has-sel) .cp-list>.cp-race:first-child{order:1}',
        'body.cockpit:not(.has-sel) :is(#panel>.cp-top,#panel-body){order:2}',
        'body.cockpit:not(.has-sel) #panel-body{margin-top:-1.25rem}',
        'body.cockpit:not(.has-sel) .cp-row.picked>.cp-link{background:none;box-shadow:inset 3px 0 0 var(--ok-icon)}',
    ]) {
        assert.ok(block.includes(rule), rule);
        assert.equal(APP_CSS.indexOf(rule), APP_CSS.indexOf(rule, at), `${rule}: only below 1180 px`);
    }
    // from 1180 px the list is one item at the left, as before
    assert.ok(APP_CSS.includes('.cp>.cp-list{grid-column:1;grid-row:1 / span 3}'));
});


test('the phone: a head that holds a Store result flows with the page instead of scrolling inside 45vh', () => {   // [M3]
    const at = APP_CSS.indexOf('@media (max-width:1179.98px){');
    const block = APP_CSS.slice(at, APP_CSS.indexOf('@media (prefers-reduced-motion', at));
    assert.ok(block.includes('body.cockpit.has-sel #panel[data-result]{position:static;max-height:none;overflow:visible}'), block);
    assert.ok(block.indexOf('body.cockpit.has-sel #panel{position:sticky') < block.indexOf('body.cockpit.has-sel #panel[data-result]'));
});


test('the team page says what works without the script; other pages keep their note', async t => {   // [M11]
    await start(t);
    const NOTE = 'Without JavaScript every row you pick loads the whole page, and after a change in the Store form its first Store shows what happens: press Store again. Make live and every button that asks first work as well.';
    const body = await page('');
    assert.equal(count(body, NOTE), 1);
    assert.equal(body.includes('This page needs JavaScript.'), false);
    const up = await (await srv.get('/manage/upload?team=rollers', cookie)).text();
    assert.ok(up.includes('This page needs JavaScript.'));
});


// ---- the switch (team cockpit spec §4.1, §8) ----

test('the old URLs lead to the team page', async t => {
    await start(t);
    const loc = async p => {
        const r = await srv.get(p);
        return [r.status, r.headers.get('location')];
    };
    assert.deepEqual(await loc('/manage/team/rollers/plan/c00001'), [303, '/manage/team/rollers?v=c00005#panel']);     // the plan's live version
    assert.deepEqual(await loc('/manage/team/rollers/plan/c00004'), [303, '/manage/team/rollers?v=c00005#panel']);     // by any id of the plan
    assert.deepEqual(await loc('/manage/team/rollers/plan/c00002'), [303, '/manage/team/rollers?v=c00002#panel']);     // not live: its newest
    assert.deepEqual(await loc('/manage/team/rollers/plan/zzzzzz'), [303, '/manage/team/rollers']);                    // a plan that is gone
    assert.equal((await srv.get('/manage/team/nobody/plan/c00001')).status, 404);                                      // the team-gone page, as today
    assert.deepEqual(await loc('/manage/inbox/c00006'), [303, '/manage/team/rollers?e=c00006#panel']);
    assert.equal((await srv.get('/manage/inbox/zzzzzz')).status, 404);                                                 // the entry-gone page, as today
    assert.equal((await srv.get('/manage/team/rollers/cockpit')).status, 404);                                         // the build's route is gone
    assert.match(await (await srv.get('/manage/team/rollers')).text(), /<main class="page wide cockpit" id="main"/);
    // a plan whose newest version is not live while another of its versions is: the live one
    srv.store.change(CID, c => uploadSheet(c, {slug: 'rollers', json: plan('Rollers fast', [['1001', 60]]), text: null, date: DATE,
        base: c.teams.rollers.version, via: 'file', as: 'c00001', live: false}, {now: NOW, newId: () => 'c00099'}));
    assert.deepEqual(await loc('/manage/team/rollers/plan/c00099'), [303, '/manage/team/rollers?v=c00005#panel']);
    // an entry of no team of the club answers as a gone one (ruling F12)
    srv.store.change(CID, c => {
        c.inbox.find(e => e.id === 'c00008').team = null;
    });
    assert.equal((await srv.get('/manage/inbox/c00008')).status, 404);
});


test('a Restore posted from a page drawn before the switch changes nothing and says the page was out of date', async t => {
    await start(t);
    const before = storedClub(srv);
    const r = await followPost(srv, cookie, '/manage/plan/back', {team: 'rollers', plan: 'c00001', n: '1', version: VERSION_OF(srv, 'rollers'), confirm: '1'});
    assert.equal(r.location, '/manage/team/rollers');
    assert.deepEqual(r.flash, {kind: 'err', text: 'This page was out of date. Nothing was changed.'});
    assert.equal(storedClub(srv), before);
    // without confirm (its question's no-script path) the same, and a team that is gone goes to the teams
    const ask = await followPost(srv, cookie, '/manage/plan/back', {team: 'rollers', plan: 'c00001', n: '1', version: VERSION_OF(srv, 'rollers')});
    assert.deepEqual([ask.location, ask.flash.text], ['/manage/team/rollers', 'This page was out of date. Nothing was changed.']);
    const gone = await followPost(srv, cookie, '/manage/plan/back', {team: 'nobody', plan: 'c00001', n: '1', version: '1', confirm: '1'});
    assert.equal(gone.location, '/manage');
    assert.equal(storedClub(srv), before);
});


test('a Store from an assign page left open answers the team page', async t => {
    await start(t);
    const had = new Set(Object.keys(srv.store.get(CID).sheets));
    // the assign page's form had no `from` (and the old page had a riders fold, no data-hold-reload)
    const res = await post(srv, cookie, '/manage/inbox/c00006', storeFields());
    assert.equal(res.status, 303, res.body);
    const made = Object.keys(srv.store.get(CID).sheets).filter(id => !had.has(id));
    assert.equal(made.length, 1);
    assert.equal(res.headers.get('location'), `/manage/team/rollers?v=${made[0]}#panel`);
    // a refusal is the team page with the entry picked, its form as posted
    const refused = await post(srv, cookie, '/manage/inbox/c00007', {team: 'rollers', drawn: 'rollers:', base: VERSION_OF(srv, 'rollers')});
    assert.equal(refused.status, 400);
    assert.match(refused.body, /<main class="page wide cockpit" id="main" data-tv="\d+" data-here="\/manage\/team\/rollers\?e=c00007">/);
    assert.deepEqual(flashOf(element(refused.body, '<div id="panel"')), {kind: 'err', text: 'Pick a plan.'});
});


test('the hub and the upload page point at the team page', async t => {
    await start(t);
    const hub = await (await srv.get('/manage')).text();
    assert.ok(hub.includes('<a class="btn primary small" href="/manage/team/rollers?e=c00007#panel">Review and store'), hub);
    assert.ok(hub.includes('<a class="btn primary small" href="/manage/team/rollers?e=c00006#panel">Review and store'), hub);
    assert.equal(/href="\/manage\/inbox\//.test(hub), false);                                // no link to the old Store page (Discard still posts there)
    // the upload page for a plan's New version: no plan crumb, the way back is the team page
    const up = await (await srv.get('/manage/upload?team=rollers&plan=c00001')).text();
    const crumbs = element(up, '<nav class="crumbs');
    assert.deepEqual([...crumbs.matchAll(/href="([^"]+)"/g)].map(m => m[1]), ['/manage', '/manage/team/rollers']);
    assert.equal(textOf(crumbs).includes('Rollers · fast'), false);
    const json = plan('Rollers', [['1001', 60], ['1002', 60]]);
    const sent = await postUpload(srv, cookie, {team: 'rollers', forPlan: 'c00001', json}, {path: '/manage/upload?team=rollers&plan=c00001'});
    assert.equal(sent.status, 303);
    const entry = srv.store.get(CID).inbox.at(-1);
    assert.equal(sent.headers.get('location'), `/manage/team/rollers?e=${entry.id}#panel`);

    // "Make a plan live" of a race without a live plan: its one plan picked, else the race's block
    const kf = makeClub();
    const one = upload(kf.club, 'rollers', {type: 'fast', riders: ROLLERS.slice(0, 4), at: T('2026-11-19T14:00:00Z'), live: false});
    upload(kf.club, 'sprockets', {type: 'A', riders: ['1005'], at: T('2026-11-19T14:05:00Z'), live: false});
    upload(kf.club, 'sprockets', {type: 'B', riders: ['1006'], at: T('2026-11-19T14:06:00Z'), live: false});
    const s2 = await serve(t, kf, {now: NOW});
    const page = await (await s2.get('/manage')).text();
    assert.ok(page.includes(`<a class="btn secondary small" href="/manage/team/rollers?v=${one}#panel">Make a plan live<span class="sr"> (Rollers)</span></a>`), page);
    assert.ok(page.includes('<a class="btn secondary small" href="/manage/team/sprockets#race-2026-11-19">Make a plan live<span class="sr"> (Sprockets)</span></a>'), page);
    // both land where they say: the panel of the version, the race's block
    assert.match(await (await s2.get(`/manage/team/rollers?v=${one}`)).text(), /<div id="panel" data-kind="version"/);
    assert.match(await (await s2.get('/manage/team/sprockets')).text(), /<div class="race cp-race[^"]*" id="race-2026-11-19">/);
});


// ---- Task 14: the riders card is the rider table, with each rider's state after the gate ----

// The lines of the first rider table in `html`: {cls, pos, name, state}, state the text of its Plan
// cell (sign, words, the check's time), '' for an empty one, null without the column.
function tableLines(html) {
    const body = html.slice(html.indexOf('<tbody>') + 7, html.indexOf('</tbody>'));
    return body.split('\n').filter(l => l.startsWith('<tr')).map(l => {
        const cell = /<td class="rstate[^"]*">([^]*?)<\/td>/.exec(l);
        return {cls: /^<tr(?: class="([^"]*)")?>/.exec(l)[1] ?? '', pos: textOf(/<td class="n pt-pos">([^]*?)<\/td>/.exec(l)[1]).trim(),
            name: textOf(/<span class="pt-nm">([^]*?)<\/span>/.exec(l)[1]).trim(), state: cell === null ? null : textOf(cell[1]).trim()};
    });
}

// Every rider of the view (and of each race's view) is a row of that race's live version's table,
// and every row one of its riders: both come from the live version.
function sameRiders(c, slug, now) {
    const view = cockpitView(c, slug, {now, sel: {kind: 'none'}});
    for (const v of [view, ...view.races]) {
        if (v.live) {
            const rows = tableModel(c, c.sheets[v.live.id], tableBase(c, slug, v.live.id), {now}).lines.filter(l => l.kind === 'row').map(l => l.id);
            assert.deepEqual(v.riders.map(r => r.id).sort(), rows.sort(), v.date);
        }
    }
}


test('the live card after the gate: one rider table with a Plan column, a state per rider; the count and the live code in its line', async t => {
    await start(t);
    const live = codeOf('c00005');
    const seen = (aid, at, sig, inEvent = false) => srv.see(aid, at, {sig, mod: '0.3.0', sheet: 'c00005', inEvent, event: null});
    seen('1001', '2026-11-19T18:15:00Z', live, true);            // Ben: in the event with the live plan
    seen('1002', '2026-11-19T18:10:00Z', live);                  // Cleo has it
    seen('1003', '2026-11-19T18:05:00Z', codeOf('c00004'));      // Dan holds v2
    seen('1004', '2026-11-19T18:06:00Z', codeOf('c00002'));      // Eva holds 'Rollers · slow' v1
    for (const q of ['', '?v=c00005']) {                                         // opened with nothing picked, and picked: the same card
        const body = await page(q);
        const head = element(body, '<div id="panel"');
        const card = element(body, '<div class="cp-body"');
        // one table, no list of states beside it
        assert.equal(count(card, '<table'), 1, q);
        assert.equal(/<ul class="riders|class="rider /.test(card), false, card);
        assert.ok(card.includes('<th class="n pt-pull">Pull @ W/kg</th><th class="rstate">Plan</th></tr></thead>'), card);
        // the head: the label and version, the live version's plan code and the count; the help fold, no "shows from" hint
        assert.ok(head.includes('<span class="count"><strong>2 of 6</strong> have the plan</span>'), head);
        assert.ok(textOf(head).includes('Riders on \'Rollers · fast\' v3'), q);
        assert.equal(metaOf(head), `Plan code ${live} 2 of 6 have the plan`);
        assert.ok(card.includes('<details class="help" data-keep-refresh><summary>'), card);
        assert.equal(card.includes('Who has the plan shows from'), false);
        // in the Undo window too: the plan as riders get it, a state on each row in ride order, no old line
        assert.deepEqual(tableLines(card), [
            {cls: '', pos: '1', name: 'Ben', state: '✓ Has the plan · in the event'},
            {cls: '', pos: '2', name: 'Cleo', state: '✓ Has the plan'},
            {cls: '', pos: '3', name: 'Dan', state: '⚠︎ Has v2, not the live v3 19:05'},
            {cls: '', pos: '4', name: 'Eva', state: '⚠︎ Has \'Rollers · slow\' v1, not the live one 19:06'},
            {cls: '', pos: '5', name: 'Finn', state: '– Not seen yet'},
            {cls: '', pos: '6', name: 'Gus', state: '– Not seen yet'},
        ], q);
    }
    sameRiders(srv.store.get(CID), 'rollers', NOW);

    // the Undo window over: the same
    srv.clock.now = NOW + 10 * 60000;
    const later = element(await page(''), '<div class="cp-body"');
    assert.deepEqual(tableLines(later).map(l => [l.cls, l.name, l.state.split(' ')[0]]),
        [['', 'Ben', '✓'], ['', 'Cleo', '✓'], ['', 'Dan', '⚠︎'], ['', 'Eva', '⚠︎'], ['', 'Finn', '–'], ['', 'Gus', '–']]);

    // before the gate: the same table without the Plan column, the riders counted, the hint
    srv.clock.now = BEFORE;
    const page0 = await page('');
    const before = element(page0, '<div class="cp-body"');
    assert.equal(/rstate|>Plan</.test(before), false, before);
    assert.ok(tableLines(before).every(l => l.state === null));
    assert.equal(metaOf(element(page0, '<div id="panel"')), `Plan code ${live} 6 riders`);
    assert.ok(before.includes('<p class="hint">In ride order. Who has the plan shows from <time>19:00</time>, when riders get it.</p>'), before);
});


test('a later race\'s fold: the same rider table, with the Plan column once its gate is open', async t => {
    const made = cockpitClub();
    const c = made.club;
    // the nearest race at 22:30, a later one at 00:30 the next day (Fri 20 Nov) with an event link
    c.teams.rollers.races[DATE].start = '22:30';
    const later = uploadSheet(c, {slug: 'rollers', json: plan('Rollers late', [['1001', 60, {pull_power: 300}], ['1002', 45, {pull_power: 280}]]), text: null,
        date: '2026-11-20', start: '00:30', base: c.teams.rollers.version, via: 'file', type: 'late', as: 'new', live: true, pinnedEventId: 4567890},
    {now: T('2026-11-19T10:00:00Z'), newId: made.newId}).id;
    ids = made.ids;
    cookie = made.cookie;
    srv = await serve(t, made, {now: T('2026-11-19T22:50:00Z')});     // 23:50: the later race's gate (00:00) is closed
    const fold = async () => element(await page(''), '<details class="fold race-more"');
    const closed = await fold();
    assert.equal(count(closed, '<table class="ptable ptable-plan">'), 1, closed);
    assert.equal(/rstate|>Plan<|<ul class="riders/.test(closed), false, closed);
    assert.deepEqual(tableLines(closed).map(l => [l.pos, l.name, l.state]), [['1', 'Ben', null], ['2', 'Cleo', null]]);
    assert.ok(closed.includes('<td class="n pt-pull">45 s @ 4.0</td>'), closed);
    assert.ok(closed.includes('<p class="count">2 riders</p>'), closed);
    assert.ok(closed.includes('<p class="hint">In ride order. Who has the plan shows from <time>Fri 20 Nov 00:00</time>, when riders get it.</p>'), closed);

    srv.see('1002', '2026-11-19T23:05:00Z', {sig: codeOf(later), mod: '0.3.0', sheet: later, inEvent: true, event: 4567891});
    srv.clock.now = T('2026-11-19T23:10:00Z');                      // 00:10: its gate is open (see() puts the clock back first)
    const open = await fold();
    assert.ok(open.includes('<h2 id="riders-h-2026-11-20">'), open);
    assert.ok(open.includes('<th class="rstate">Plan</th>'), open);
    assert.ok(open.includes('<p class="count"><strong>0 of 2</strong> have the plan</p>'), open);
    assert.ok(open.includes(`<p class="plancode">Plan code <code>${codeOf(later)}</code></p>`), open);
    assert.deepEqual(tableLines(open).map(l => [l.pos, l.name, l.state]), [
        ['1', 'Ben', '– Not seen yet'], ['2', 'Cleo', '⚠︎ In event 4567891 · gets nothing 00:05']]);
    assert.equal(/<ul class="riders|class="rider /.test(open), false);
    sameRiders(srv.store.get(CID), 'rollers', srv.clock.now);
});


test('Store and make live: the plan code once, in the flash; the head\'s code line again on the next draw', async t => {
    await start(t);
    const r = await followPost(srv, cookie, '/manage/inbox/c00006', storeFields({live: 'on'}));
    const [id, s] = sheetsOf(srv, 'rollers').find(([, x]) => x.n === 4);
    const head = element(r.page, '<div id="panel"');
    assert.ok(textOf(head).includes(`is live for Thu 19 Nov 19:30. Plan code ${s.sig}.`), textOf(head));
    assert.equal(count(head, s.sig), 1, head);
    assert.equal(head.includes('class="plancode"'), false, head);
    // drawn again without the flash: the code under the title
    assert.ok(element(await page(`?v=${id}`), '<div id="panel"').includes(`<span class="plancode">Plan code <code>${s.sig}</code></span>`));
    // a Store that is not live names no code in its flash: the head keeps the line
    const r2 = await followPost(srv, cookie, '/manage/inbox/c00007', {...storeFields(), as: 'c00002', drawn: 'rollers:c00002'});
    const [, s2] = sheetsOf(srv, 'rollers').find(([, x]) => x.plan === 'c00002' && x.n === 2);
    assert.ok(element(r2.page, '<div id="panel"').includes(`<span class="plancode">Plan code <code>${s2.sig}</code></span>`), element(r2.page, '<div id="panel"'));
});
