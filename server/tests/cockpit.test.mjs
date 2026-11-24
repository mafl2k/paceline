// The team page /manage/team/<slug>, the team cockpit (team cockpit spec §5.1-§5.3, §6, §8): the
// frame kept, the list at the left, the panel at the right, the fragment of the two slots, Make
// live from the panel (no Undo anywhere, user 23 Nov 2026), every other form of the page coming back
// to it, and the switch: the old URLs lead to it, Restore and Undo answer out of date. Made-up names only (helpers.mjs).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {T, CODE_SECRET, planJson} from './helpers.mjs';
import {
    serve, textOf, count, flashOf, post, followPost, armOf, CLUB_FIELD, VERSION_OF, CID, element, elements, sheetsOf, postUpload, storedClub,
    makeClub, upload, ROLLERS, intake,
} from './manage-helpers.mjs';
import {uploadSheet, makeLive, setRace, storeEntry} from '../club.mjs';
import {storeAsk} from '../store-form.mjs';
import {storeInput} from '../manage-cockpit.mjs';
import {cockpitClub, NOW, DATE, plan} from './cockpit-fixture.mjs';
import {APP_CSS} from '../app-css.mjs';
import {cockpitView, selectionOf} from '../cockpit-view.mjs';
import {tableModel, tableBase} from '../plan-table.mjs';

const PATH = '/manage/team/rollers';
const BEFORE = T('2026-11-19T12:00:00Z');            // Thu 19 Nov 13:00 in Berlin: Rollers' gate (19:00) is closed
const OVER = T('2026-11-19T20:30:00Z') + 1;          // S 18:30Z + 2 h: the race is over

const slots = html => element(html, '<div id="panel"') + element(html, '<div id="panel-body"') + element(html, '<div id="panel-acts"');
// the card's action bar (#panel-acts, user 23 Nov 2026), else its status bar at the card body's end
// the card's title (user, 24 Nov 2026: the live version's LIVE tag is in it, no "LIVE · riders get this" bar)
const titleOf = html => element(html, '<h2 class="cp-title"') ?? '';
const barOf = html => element(element(html, '<div id="panel-acts"') ?? '', '<div class="cp-bar"') ?? element(html, '<div class="cp-bar"');
// anything of an Undo on a page: its form, a row's, the bar's, the flash's (user, 23 Nov 2026: none)
const undoAny = html => /\/manage\/live\/undo|data-row-undo|cp-row-undo|cp-undo|class="flash ok undo"|>Undo</.test(html ?? '');
// the warning lines right above the card's action bar (user, 23 Nov 2026: no "What happens"), as
// [sev, text], in order
const warnsOf = html => [...(element(html ?? '', '<div class="cp-what"') ?? '').matchAll(/<li class="([a-z]+)">[^]*?<span>([^]*?)<\/span><\/li>/g)].map(m => [m[1], textOf(m[2]).trim()]);
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
    // no breadcrumb and no rhythm line: the sidebar and the race's line say them (user, 23 Nov 2026)
    assert.ok(!body.includes('class="crumbs') && !body.includes('class="rhythm"'));
    for (const kept of ['Team settings', 'Upload a file', 'How races work', 'id="race-2026-11-19"']) {
        assert.ok(body.includes(kept), kept);
    }
    const rows = [...body.matchAll(/<li class="cp-row[^"]*" data-sel="([^"]+)"><a class="cp-link" href="([^"]+)"/g)].map(m => [m[1], m[2]]);
    assert.deepEqual(rows, [
        ['e:c00007', `${PATH}?e=c00007#panel`], ['e:c00006', `${PATH}?e=c00006#panel`], ['e:c00008', `${PATH}?e=c00008#panel`],
        ['v:c00005', `${PATH}?r=2026-11-19#panel`], ['v:c00004', `${PATH}?v=c00004#panel`], ['v:c00001', `${PATH}?v=c00001#panel`],
        ['v:c00002', `${PATH}?v=c00002#panel`],
    ]);
    const text = textOf(body);
    for (const said of ['Not stored yet', 'Received 19:12 · \'Rollers slow\' · 4 riders', 'Uploaded 19:05 · \'Rollers\' · 5 riders',
        'v3 · 0/6 have it Live', 'v2 · Hanna in, Ben out', '1 older', 'v1 · Eva out · 2 targets',
        '0 of 6 have the plan']) {
        assert.ok(text.includes(said), said);
    }
    // nothing picked: the card is the nearest race's live version, as riders get it, with no close link (no sheet is open)
    assert.match(body, /<div id="panel" data-kind="version" data-sel="v:c00005" tabindex="-1">/);
    assert.equal(element(body, '<div id="panel"').includes('cp-close'), false);
    assert.ok(textOf(element(body, '<div id="panel"')).includes('Riders on \'fast\' v3'));
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
    // no Undo of the last Make live (18:14, two minutes ago): not in the card, not on a row
    assert.equal(undoAny(body), false);
    // every row of the list is its link alone: no Make live, no Undo beside it, so every row has the
    // same shape (user, 23 Nov 2026)
    const lis = elements(element(body, '<div class="cp-list"'), '<li class="cp-row');
    assert.equal(lis.length, 7);
    for (const li of lis) {
        assert.match(li, /^<li class="cp-row[^"]*" data-sel="[^"]+"><a class="cp-link"[^>]*>[^]*?<\/a><\/li>$/, li);
    }
    // the plan blocks: the live one tagged, each with its ⋯ (no Make live in it), in the race's order
    assert.deepEqual([...body.matchAll(/<section class="cp-plan[^"]*" id="(plan-[^"]+)"/g)].map(m => m[1]), ['plan-c00001', 'plan-c00002']);
    const fast = element(body, '<section class="cp-plan live" id="plan-c00001"');
    // the LIVE tag at the end of the live version's row, none on the plan's head (user, 23 Nov 2026)
    assert.ok(textOf(fast).includes('fast') && !/<h3[^>]*>[^]*?class="tag"[^]*?<\/h3>/.test(fast), fast);
    // (the gate open: the race's phase beside it, user 23 Nov 2026)
    assert.match(fast, /<span class="cp-what">v3 · 0\/6 have it<\/span> <span class="tag">Live<\/span><span class="tag sending" [^>]*><span aria-hidden="true">Sending<\/span><span class="sr">Riders get this plan now<\/span><\/span><svg/);
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
    // with its day always (user, 23 Nov 2026)
    assert.ok(textOf(head).includes('\'fast\' v2 · stored Thu 19 Nov 18:55'), textOf(head));
    assert.match(head, /<a class="cp-close" href="\/manage\/team\/rollers#race-2026-11-19"/);
    // when it was live: under its table, the list's row leaves it out (user, 23 Nov 2026)
    assert.ok(element(body, '<div id="panel-body"').includes('<div class="cp-what"><p class="hint cp-history">Was live Thu 19 Nov 18:57</p>'));
    assert.ok(!textOf(element(body, '<li class="cp-row picked" data-sel="v:c00004">')).includes('was live'));
    assert.equal(count(body, 'class="cp-close"'), 1);
    assert.equal(undoAny(body), false);
    const pb = element(body, '<div id="panel-body"');
    // the card's line under the title: the plan code and the caption of the table against live
    assert.ok(head.includes('<span class="cp-cap" title="Against live v3">Against live v3</span>'), head);
    assert.match(metaOf(head), /^Plan code [0-9A-Z]{6} Against live v3$/);
    assert.equal(pb.includes('pt-cap'), false);
    // right above the action bar only what warns (user, 23 Nov 2026: no "What happens", no routine
    // sentence; Make live's own question says when riders get it): the rider it moves, the team it
    // leaves with a hole
    assert.deepEqual(warnsOf(pb), [['info', 'Hanna moves from Sprockets to Rollers.'], ['warn', 'Still to do: Sprockets.']]);
    assert.equal(/What happens|Riders in the event get|Make it live anyway/.test(textOf(element(pb, '<div class="cp-what"'))), false, element(pb, '<div class="cp-what"'));
    assert.equal(pb.includes('cp-words'), false);
    const arm = armOf(barOf(body), '/manage/live');                              // the gate is open: it asks in its place
    for (const f of [CLUB_FIELD, 'name="team" value="rollers"', 'name="sheet" value="c00004"', 'name="version" value="7"']) {
        assert.ok(arm.includes(f), f);
    }
    assert.equal(arm.includes('<input type="hidden" name="confirm"'), false);    // never a preset confirm
    // the card's one action: primary, it asks first; it reads "Make live", the version for screen
    // readers only (user, 23 Nov 2026)
    assert.match(arm, /<button class="btn primary" type="submit" data-arm-open>Make live<span class="sr"> v2 of &#39;Rollers · fast&#39;<\/span><\/button>/);
    // its question keeps the whole sentence
    assert.ok(textOf(arm).includes('Riders in the event get \'Rollers · fast\' v2 instead of \'Rollers · fast\' v3 within a minute. Hanna moves from Sprockets to Rollers. Still to do: Sprockets. Make it live anyway?'), textOf(arm));
    assert.match(body, /<li class="cp-row picked" data-sel="v:c00004"><a class="cp-link" href="[^"]+" aria-current="true"/);
    assert.equal(count(body, 'aria-current="true"'), 1);
    // its list and its race block are marked for the phone's sheet (Task 10)
    assert.match(body, /<ul class="cp-rows sel-rows"><li class="cp-row live" data-sel="v:c00005">/);
    assert.match(body, /<div class="race cp-race sel-race" id="race-2026-11-19">/);
    // after the gate too the picked card replaces the live one: no riders card, no states under it; the
    // live row says the count instead (spec §5.3b)
    assert.equal(/id="riders"|riders-card|rstates|have the plan/.test(element(body, '<div class="cp">')), false);
    assert.ok(textOf(element(body, '<li class="cp-row live" data-sel="v:c00005">')).includes('v3 · 0/6 have it Live'));
    assert.match(body, /content="30;url=\/manage\/team\/rollers\?v=c00004"/);
    // the live version's own card says since when it is live
    assert.ok(textOf(element(await page(''), '<div id="panel-body"')).includes('Live since Thu 19 Nov 19:14'));   // the reload keeps the selection
});


test('the live version: as riders get it (no old lines), also right after its switch; its LIVE tag in the card title and no status bar, no Undo', async t => {
    await start(t);
    for (const q of ['?v=c00005', '']) {                                         // picked, and opened with nothing picked: the same card
        const body = await page(q);
        const head = element(body, '<div id="panel"');
        const pb = element(body, '<div id="panel-body"');
        // v3 went live at 18:14 (two minutes ago): no old line, no dropped line, no NEW
        assert.equal(/pt-old|pt-dropped|pt-mark|pt-cap/.test(pb), false, q);
        assert.deepEqual([...pb.matchAll(/<span class="pt-nm">([^<]+)<\/span>/g)].map(m => m[1]), ['Ben', 'Cleo', 'Dan', 'Eva', 'Finn', 'Gus'], q);
        assert.ok(textOf(head).includes('Riders on \'fast\' v3'), q);
        assert.match(metaOf(head), /^Plan code [0-9A-Z]{6} 0 of 6 have the plan$/, q);
        // the LIVE tag in the title, no status bar and no form (no Undo, user 23 Nov 2026; no bar, 24 Nov 2026)
        assert.equal(titleOf(body).includes('<span class="tag">Live</span>'), true, q);
        assert.equal(textOf(titleOf(body)).trim(), 'Riders on \'fast\' v3 Live', q);
        assert.equal(pb.includes('cp-bar') || pb.includes('riders get this'), false, q);
        assert.equal(pb.includes('<form'), false, q);
        assert.equal(undoAny(body), false, q);
        assert.equal(body.includes('action="/manage/live"'), false, q);
        assert.match(body, /<li class="cp-row live picked" data-sel="v:c00005">/);
    }

    srv.clock.now = NOW + 10 * 60000;                                            // 18:26: the same card
    const later = await page('?v=c00005');
    const pb2 = element(later, '<div id="panel-body"');
    assert.equal(/pt-old|pt-dropped|pt-mark/.test(pb2), false);
    assert.equal(textOf(titleOf(later)).trim(), 'Riders on \'fast\' v3 Live');
    assert.equal(pb2.includes('cp-bar'), false);
    assert.equal(pb2.includes('<form'), false);
    assert.equal(undoAny(later), false);
});


test('nothing to warn about: the card ends with its table, then the action bar (user, 23 Nov 2026: no "What happens")', async t => {
    const made = cockpitClub();
    // a new version of the live plan with the same riders, other targets: it moves nobody, leaves no hole
    const v4 = uploadSheet(made.club, {slug: 'rollers', json: plan('Rollers fast', ['1001', '1002', '1003', '1004', '1005', '1006'].map(id => [id, 45, {pull_power: 310}])),
        text: null, date: DATE, base: made.club.teams.rollers.version, via: 'file', as: 'c00001', live: false}, {now: T('2026-11-19T18:15:00Z'), newId: made.newId}).id;
    ids = made.ids;
    cookie = made.cookie;
    srv = await serve(t, made, {now: BEFORE, env: {CODE_SECRET, PUBLIC_URL: 'https://paceline.example.org'}});
    const vb = await page(`?v=${v4}`);
    const pb = element(vb, '<div id="panel-body"');
    assert.deepEqual(warnsOf(pb), []);
    // the card body ends with its table (the empty warnings slot takes no room); then the action bar,
    // in #panel-acts (user, 23 Nov 2026)
    assert.ok(pb.endsWith('</table><div class="cp-what"></div></div></div>'), pb);
    // its Make live acts at once (before the gate, nothing to warn about)
    assert.match(barOf(vb), /<form method="post" action="\/manage\/live">/);
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
    assert.ok(element(body, '<div id="panel"').includes('<span class="cp-cap" title="Against live v3">Against live v3</span>'));
    assert.ok(pb.includes('<table class="ptable ptable-plan">'));
    assert.ok(textOf(element(pb, '<div class="cp-what"')).includes('This race is over: nothing can be changed.'));
    assert.equal(textOf(barOf(pb)).trim(), 'Read only');                        // the action bar: read only
    assert.equal(pb.includes('<form'), false);
    assert.equal(element(body, '<div id="panel"').includes('<form'), false);
    // without a selection the fold stays closed
    assert.match(await page(''), /<details class="fold over" id="over" data-keep-refresh><summary>/);
});


test('a picked version replaces the live card, before the gate and after it; the live row counts after the gate only', async t => {
    await start(t, BEFORE);
    const none = await page('');
    assert.match(none, /<body class="teampage cockpit"/);
    // nothing picked: the live version's card, the plan as riders get it, its riders counted, the hint
    const head = element(none, '<div id="panel"');
    const card = element(none, '<div id="panel-body"');
    assert.ok(textOf(head).includes('Riders on \'fast\' v3'));
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
    assert.ok(textOf(element(after, '<li class="cp-row live" data-sel="v:c00005">')).includes('v3 · 0/6 have it Live'));
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
    assert.ok(textOf(element(at, '<div id="panel"')).includes('Riders on \'fast\' v3'));
    assert.match(element(at, '<div id="panel"'), /<a class="cp-close" href="\/manage\/team\/rollers#race-2026-11-19"/);   // the sheet's ✕
    assert.match(at, /<li class="cp-row live picked" data-sel="v:c00005"><a class="cp-link" href="\/manage\/team\/rollers\?r=2026-11-19#panel" aria-current="true"/);
    assert.match(at, /<ul class="cp-rows sel-rows"><li class="cp-row live picked" data-sel="v:c00005">/);
    assert.equal(at.includes('action="/manage/live"'), false);
    // another captain makes v2 live: the same URL now draws v2, the live one, with nothing to make live
    const made = await post(srv, cookie, '/manage/live', {team: 'rollers', sheet: 'c00004', version: VERSION_OF(srv, 'rollers'), confirm: '1'});
    assert.equal(made.status, 303);
    const again = await page('?r=2026-11-19');
    assert.match(again, /<div id="panel" data-kind="version" data-sel="v:c00004" tabindex="-1">/);
    assert.ok(textOf(element(again, '<div id="panel"')).includes('Riders on \'fast\' v2'), textOf(element(again, '<div id="panel"')));
    assert.equal(again.includes('action="/manage/live"'), false);                  // no Make live button anywhere
    assert.equal(textOf(titleOf(again)).trim(), 'Riders on \'fast\' v2 Live');
    assert.equal(again.includes('<div class="cp-bar"'), false);
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
    assert.ok(textOf(element(moved, '<div id="panel"')).includes('Riders on \'fast\' v2'));
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
        assert.ok(textOf(element(body, '<div class="cp-body') ?? '').trim() !== '', `${p}${q}: the card says something`);
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


test('no Undo anywhere (user, 23 Nov 2026): not after a switch, not in a later race, not after a Store; an Undo form of an old page answers out of date', async t => {
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
    // nothing of it a minute after the switch: on the bare page (Thursday's card, Sunday's live row),
    // on Sunday's card (?r=, ?v=), in any fragment
    const tv = VERSION_OF(srv, 'rollers');
    for (const q of ['', `?r=${sun}`, `?v=${s2}`, `?v=${s1}`]) {
        const b = await page(q);
        assert.equal(undoAny(b), false, q);
        assert.equal(element(b, `<li class="cp-row live${q === `?r=${sun}` || q === `?v=${s2}` ? ' picked' : ''}" data-sel="v:${s2}">`).includes('<form'), false, q);
        assert.equal(undoAny(await (await srv.get(`${PATH}${q}${q ? '&' : '?'}panel=1&tv=${tv}`, cookie)).text()), false, q);
    }
    // Make live: its flash says what it did, with no form in it
    const landed = await followPost(srv, cookie, '/manage/live', {team: 'rollers', sheet: s1, version: VERSION_OF(srv, 'rollers'), confirm: '1'});
    assert.equal(landed.location, `/manage/team/rollers?r=${sun}#panel`);
    assert.equal(landed.flash.kind, 'ok');
    assert.match(element(landed.page, '<div id="panel"'), /<div class="flash ok" role="status"><svg[^]*?<\/svg><p>[^<]*<\/p><\/div>/);
    assert.equal(undoAny(landed.page), false);
    // the way back is Make live of the version live before, in its card's action bar
    const way = barOf(await page(`?v=${s2}`));
    assert.ok(way.includes('action="/manage/live"') && way.includes(`name="sheet" value="${s2}"`), way);
    // Store and make live: no Undo in its result either
    const stored = await followPost(srv, cookie, '/manage/inbox/c00006', storeFields({live: 'on', confirm: '1'}));
    assert.equal(stored.location, '/manage/team/rollers?r=2026-11-19#panel');
    assert.equal(undoAny(stored.page), false);
    // an Undo form of a page drawn before Undo went: out of date, nothing changes
    const live = JSON.stringify(srv.store.get(CID).teams.rollers.races);
    const old = await followPost(srv, cookie, '/manage/live/undo', {team: 'rollers', version: VERSION_OF(srv, 'rollers'), confirm: '1'});
    assert.equal(old.location, '/manage/team/rollers');
    assert.deepEqual(old.flash, {kind: 'err', text: 'This page was out of date. Nothing was changed.'});
    assert.equal(JSON.stringify(srv.store.get(CID).teams.rollers.races), live);
    assert.equal(undoAny(old.page), false);
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
    assert.match(e, /<body class="teampage cockpit has-sel"/);
    assert.ok(textOf(element(e, '<div id="panel"')).includes('Received 19:10 · \'Rollers fast\' · 6 riders'));
    assert.ok(element(e, '<div id="panel"').includes('<span class="cp-cap" title="Against live v3">Against live v3</span>'));   // the form preselects 'Rollers · fast' (Task 8)
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
    // the fragments with forms have them: Make live (v2); the live version's none (no Undo)
    assert.ok((await (await srv.get(`${PATH}?v=c00004&panel=1&tv=${tv}`, cookie)).text()).includes('action="/manage/live"'));
    assert.equal((await (await srv.get(`${PATH}?v=c00005&panel=1&tv=${tv}`, cookie)).text()).includes('<form'), false);
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
    assert.equal(undoAny(got.page), false);                                     // no Undo, in the flash or the bar
    // the new live version as riders get it: no old lines against the version live before (spec §5.3b)
    assert.equal(/pt-old|pt-dropped|pt-mark|live before/.test(element(got.page, '<div class="cp">')), false);
    assert.equal(textOf(titleOf(got.page)).trim(), 'Riders on \'slow\' v1 Live');
    assert.equal(got.page.includes('<div class="cp-bar"'), false);
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

    // back to the version live before (no Undo, user 23 Nov 2026): its Make live in its card, which
    // asks after the gate, and confirmed lands on 'Rollers · slow' v1, live again
    const back = armOf(barOf(await page('?v=c00002')), '/manage/live');
    assert.ok(back && back.includes('name="sheet" value="c00002"'), back);
    const again = await followPost(srv, cookie, '/manage/live', {team: 'rollers', sheet: 'c00002', version: VERSION_OF(srv, 'rollers'), confirm: '1'});
    assert.equal(again.location, '/manage/team/rollers?r=2026-11-19#panel');
    assert.match(again.flash.text, /^'Rollers · slow' v1 is live for Rollers\./);
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

// the Store form of entry `id` in the card's body, under the rider table (user, 23 Nov 2026: never in
// its row in the list), or null
const pickOf = (body, id) => {
    const slot = element(element(body, '<div id="panel-body"') ?? '', '<div class="cp-form"');
    return slot !== null && slot.includes(`<form id="store-${id}" `) ? slot : null;
};
const asRadios = html => [...html.matchAll(/<input type="radio" name="as" value="([^"]+)"( checked)?>/g)].map(m => [m[1], Boolean(m[2])]);
const raceRadios = html => [...html.matchAll(/<input type="radio" name="race" value="([^"]+)"( checked)?>/g)].map(m => [m[1], Boolean(m[2])]);
const capOf = body => /<span class="cp-cap" title="[^"]*">([^<]*)<\/span>/.exec(element(body, '<div id="panel"'))?.[1].replace(/&#39;/g, '\'') ?? null;
const holds = body => !/<body [^>]*data-refresh=/.test(body) && !body.includes('http-equiv="refresh"');
// the Store form's race fold (user, 22 Nov 2026), whether it is drawn open, and its summary as text
const foldOf = html => element(html, '<details class="fold as-race"');
const foldOpen = html => /^<details class="fold as-race" open>/.test(foldOf(html) ?? '');
const summaryOf = html => textOf(element(foldOf(html) ?? '', '<summary') ?? '').trim();
const storeFields = (extra = {}) => ({team: 'rollers', as: 'c00001', drawn: 'rollers:c00001', base: VERSION_OF(srv, 'rollers'), startFor: DATE, startWas: '19:30', ...extra});


test('a plan not stored yet: the form in the card under the table, open; its row a plain picked row; the type only for a new plan; Make live and Store in the bar', async t => {
    await start(t);
    const body = await page('?e=c00006');                                        // pushed as 'Rollers fast'
    assert.match(body, /<body class="teampage cockpit has-sel"/);
    const pick = pickOf(body, 'c00006');
    assert.ok(pick, 'the form in the card');
    assert.equal(count(body, '<form id="store-'), 1);
    // the list never moves (user, 23 Nov 2026): the picked row is a link alone, as a picked version's,
    // and the list holds no field of the form
    assert.match(body, /<li class="cp-row picked" data-sel="e:c00006"><a class="cp-link" href="\/manage\/team\/rollers\?e=c00006#panel" aria-current="true"><span class="cp-what">[^<]*<\/span><svg[^]*?<\/svg><\/a><\/li>/);
    assert.equal(/data-assign|store-c00006|name="as"|name="live"|name="drawn"/.test(element(body, '<div class="cp-list"')), false);
    assert.equal(body.includes('cp-pick'), false);
    // (data-arm: in the race window Make live of a new version of the live plan asks first, below)
    assert.match(pick, /<form id="store-c00006" method="post" action="\/manage\/inbox\/c00006" data-assign data-hold-reload data-arm>/);
    assert.deepEqual(asRadios(pick), [['c00001', true], ['c00002', false], ['new', false]]);    // the planner's name preselects 'Rollers · fast'
    assert.ok(textOf(pick).includes('Store as') && textOf(pick).includes('New version of \'Rollers · fast\''));
    assert.equal(/name="type"/.test(pick), false);
    assert.equal(/name="live"/.test(pick), false);                               // no Make live box (user, 23 Nov 2026): the bar has Make live
    // a new version takes its plan's race (user, 23 Nov 2026): no race fold, no race date, start time or
    // event link, no field of a race guard; "Other team" is the form's one fold
    assert.equal(foldOf(pick), null, pick);
    assert.equal(/name="(date|start|event|race|startFor|startWas|raceOpen)"/.test(pick), false, pick);
    assert.ok(element(pick, '<details class="fold"').includes('name="team"'));
    assert.equal(count(pick, '<details'), 1);
    assert.match(element(pick, '<form id="store-c00006"'), /<\/fieldset>\s*<\/form>$/);   // "Store as" is the form's last block
    assert.equal(/riders \(|What changed|class="as-title"/.test(pick), false);    // no card with the riders' names, no text fold
    // nothing the card or the list says already (spec §5.3b): no race line, no line naming the page's
    // own team, no "What happens" (the card's slot above its bar says it)
    assert.equal(/Race Thu 19 Nov|What happens|Store: v4|Make live/.test(textOf(pick)), false, textOf(pick));
    assert.equal(pick.includes('class="as-row"'), false);
    for (const f of ['name="drawn" value="rollers:c00001"', `name="base" value="${VERSION_OF(srv, 'rollers')}"`, CLUB_FIELD]) {
        assert.ok(element(pick, '<form id="store-c00006"').includes(f), f);
    }
    const pb = element(body, '<div id="panel-body"');
    assert.ok(element(body, '<div id="panel"').includes('<span class="cp-cap" title="Against live v3">Against live v3</span>'));
    // above the action bar only what warns (user, 23 Nov 2026: no "What happens", no routine line
    // about what Make live or Store does): the rider Make live moves, the team it leaves with a hole
    const what = element(pb, '<div class="cp-what"');
    assert.equal(/What happens|Make live:|Store:/.test(textOf(what)), false, what);
    assert.deepEqual(warnsOf(pb), [['info', 'Hanna moves from Sprockets to Rollers.'], ['warn', 'Still to do: Sprockets']]);
    // the action bar (#panel-acts, user 23 Nov 2026): Discard, Store (quiet), Make live (primary, the
    // rightmost, "Store and make live" for screen readers); then Make live's strip, hidden
    const bar = barOf(body);
    const discard = armOf(bar, '/manage/inbox/c00006/discard');
    assert.ok(discard.includes('name="back" value="/manage/team/rollers"'), discard);
    assert.ok(bar.startsWith('<div class="cp-bar"><div class="as-discard">'), bar.slice(0, 80));
    assert.ok(bar.includes('</div><button class="btn secondary" type="submit" form="store-c00006" data-submit="store">Store</button>'
        + '<button class="btn primary" type="submit" form="store-c00006" name="live" value="on" aria-label="Store and make live" data-arm-open data-submit="live">Make live</button>'), bar);
    assert.equal(count(bar, '<button class="btn primary'), 2, 'Make live and the strip\'s confirm');
    // the card's order: the rider table, the form's fields, the warnings; the bar after the card body
    assert.ok(pb.startsWith('<div id="panel-body"><div class="cp-body has-acts"><table class="ptable'), pb.slice(0, 120));
    assert.ok(pb.indexOf('</table>') < pb.indexOf('<div class="cp-form">') && pb.indexOf('<div class="cp-form">') < pb.indexOf('<div class="cp-what"'), pb);
    assert.equal(pb.includes('<div class="cp-bar"'), false, pb);
    assert.equal(body.includes('http-equiv="refresh"'), false);                  // an open Store form: the page does not reload itself

    // "New plan" chosen: the type, with its datalist and hint
    const fresh = pickOf(await page('?e=c00006&as=new&drawn=rollers:new&startFor=2026-11-19'), 'c00006');
    assert.deepEqual(asRadios(fresh), [['c00001', false], ['c00002', false], ['new', true]]);
    assert.match(fresh, /<input name="type" maxlength="30" value="" list="types" autocomplete="off">/);
    assert.match(fresh, /<datalist id="types"><option value="fast"><option value="slow"><\/datalist>/);
    // the race fold, a new plan's only (user, 23 Nov 2026): the form's last block, closed for a weekly
    // team's next race, its summary naming the race (user, 22 Nov 2026); in it the race date,
    // prefilled with the team's next race, the start time and the event link
    const fold = foldOf(fresh);
    assert.ok(fold, fresh);
    assert.equal(foldOpen(fresh), false, fold);
    assert.equal(summaryOf(fresh), 'Race: Thu 19 Nov · 19:30 · Change');
    assert.match(element(fresh, '<div class="as-when"'), /^<div class="as-when">\s*<label class="field">Race date<input type="date" name="date" value="2026-11-19"><span class="hint">Another date makes a new race<\/span><\/label>\s*<label class="field">Start time<input type="time" name="start"/);
    assert.ok(fold.includes('name="event"'));
    assert.match(element(fresh, '<form id="store-c00006"'), /<\/details>\s*<\/form>$/);
    for (const f of [`name="startFor" value="${DATE}"`, 'name="startWas" value="19:30"', 'name="raceOpen" value=""']) {
        assert.ok(fresh.includes(f), f);
    }
    // the type after "Store as", so choosing "New plan" moves no field above it; then the race fold, last
    assert.ok(fresh.indexOf('name="as"') < fresh.indexOf('name="type"')
        && fresh.indexOf('name="type"') < fresh.indexOf('<details class="fold as-race"') && fresh.indexOf('name="type"') < fresh.indexOf('name="event"'));
    const freshPage = await page('?e=c00006&as=new&drawn=rollers:new&startFor=2026-11-19');
    assert.equal(/Store: new plan/.test(textOf(element(freshPage, '<div class="cp-what"'))), false);   // Rollers keeps its live plan: nothing to warn about Store

    // the upload for 'Rollers · fast': the same bar as a pushed plan's (no box, no other default)
    const up = await page('?e=c00008');
    assert.deepEqual(asRadios(pickOf(up, 'c00008')), [['c00001', true], ['c00002', false], ['new', false]]);
    assert.equal(/name="live"/.test(pickOf(up, 'c00008')), false);
    assert.ok(barOf(up).includes('<button class="btn secondary" type="submit" form="store-c00008" data-submit="store">Store</button>'
        + '<button class="btn primary" type="submit" form="store-c00008" name="live" value="on" aria-label="Store and make live" data-arm-open data-submit="live">Make live</button>'), barOf(up));
});


// The question of a Store form's Make live (user, 23 Nov 2026): its strip in the bar, or null.
const stripOf = html => element(barOf(html) ?? '', '<div class="arm-strip" role="group" aria-label="Confirm: Make live anyway"');

test('Store stores only; Make live stores and makes live, at once before the gate (user, 23 Nov 2026)', async t => {
    await start(t, BEFORE);
    for (const q of ['?e=c00006', '?e=c00007', '?e=c00008']) {
        const body = await page(q);
        assert.equal(stripOf(body), null, q);                                    // before the gate nothing asks
        assert.equal(/<form id="store-[^"]+"[^>]* data-arm[ >]/.test(body), false, q);
        assert.match(barOf(body), /data-submit="store">Store<\/button><button class="btn primary" type="submit" form="store-c0000\d" name="live" value="on" aria-label="Store and make live" data-submit="live">Make live<\/button><\/div>$/, q);
    }
    // Store (no live sent): stored, not live; riders keep v3
    const stored = await followPost(srv, cookie, '/manage/inbox/c00006', storeFields());
    const v4 = sheetsOf(srv, 'rollers').find(([, x]) => x.n === 4 && x.plan === 'c00001')[0];
    assert.equal(stored.location, `/manage/team/rollers?v=${v4}#panel`);
    assert.equal(liveOf(), 'c00005');
    // Make live (live=on): stored and live at once, on the race's live pointer
    const made = await followPost(srv, cookie, '/manage/inbox/c00007', storeFields({as: 'c00002', drawn: 'rollers:c00002', live: 'on'}));
    const v2 = sheetsOf(srv, 'rollers').find(([, x]) => x.n === 2 && x.plan === 'c00002')[0];
    assert.equal(made.location, '/manage/team/rollers?r=2026-11-19#panel');
    assert.equal(liveOf(), v2);
});


test('Make live of a plan not stored yet asks first only in the race window with another plan live; without the script on the server\'s page (user, 23 Nov 2026)', async t => {
    await start(t);                                                              // 19:16, the gate open; 'Rollers · fast' v3 live
    const body = await page('?e=c00007');                                        // 'Rollers slow': a new version of 'Rollers · slow'
    const strip = stripOf(body);
    assert.ok(strip, barOf(body));
    assert.ok(strip.startsWith('<div class="arm-strip" role="group" aria-label="Confirm: Make live anyway" data-arm-strip data-for="store-c00007" hidden><p id="arm-store-c00007">'
        + 'Riders in the event get &#39;Rollers · slow&#39; v2 instead of &#39;Rollers · fast&#39; v3 within a minute. Make it live anyway?</p>'), strip);
    assert.match(strip, /<button class="btn primary small" type="submit" form="store-c00007" name="confirm" value="1" aria-describedby="arm-store-c00007" data-arm-yes>Make live anyway<\/button><button class="btn secondary" type="button" data-arm-cancel>Cancel<\/button>/);
    assert.match(body, /<form id="store-c00007" [^>]*data-hold-reload data-arm>/);
    // without the script the Make live button posts live=on alone: the server asks, nothing changes
    const fields = storeFields({as: 'c00002', drawn: 'rollers:c00002'});
    const file = storedClub(srv);
    const asked = await post(srv, cookie, '/manage/inbox/c00007', {...fields, live: 'on'});
    assert.equal(asked.status, 200, asked.body);
    assert.ok(asked.body.includes('<h1>Make &#39;Rollers · slow&#39; v2 live?</h1>'), asked.body);
    assert.ok(textOf(asked.body).includes('Riders in the event get \'Rollers · slow\' v2 instead of \'Rollers · fast\' v3 within a minute. Make it live anyway?'));
    assert.match(asked.body, /<a class="btn secondary" href="\/manage\/team\/rollers\?e=c00007">/);
    assert.equal(storedClub(srv), file);
    const again = element(asked.body, '<form method="post" action="/manage/inbox/c00007"');
    const posted = postedFields(again);
    assert.deepEqual([posted.live, posted.confirm, posted.as, posted.drawn, posted.startFor], ['on', '1', 'c00002', 'rollers:c00002', DATE]);
    delete posted.club;
    const yes = await followPost(srv, cookie, '/manage/inbox/c00007', posted);
    assert.equal(yes.location, '/manage/team/rollers?r=2026-11-19#panel');
    assert.equal(srv.store.get(CID).sheets[liveOf()].label, 'Rollers · slow');
    // with the script the strip's confirm sends confirm=1 (and no live): it is Make live, confirmed
    const strip8 = stripOf(await page('?e=c00008'));                             // the upload for 'Rollers · fast'
    assert.ok(strip8 && strip8.includes('instead of &#39;Rollers · slow&#39; v2'), strip8);
    const confirmed = await followPost(srv, cookie, '/manage/inbox/c00008', storeFields({confirm: '1'}));
    assert.equal(confirmed.location, '/manage/team/rollers?r=2026-11-19#panel');
    assert.equal(srv.store.get(CID).sheets[liveOf()].label, 'Rollers · fast');
    // Store in the race window asks nothing
    const only = await followPost(srv, cookie, '/manage/inbox/c00006', storeFields({as: 'c00002', drawn: 'rollers:c00002'}));
    assert.match(only.location, /^\/manage\/team\/rollers\?v=[^#]+#panel$/);
    assert.equal(srv.store.get(CID).sheets[liveOf()].label, 'Rollers · fast');
});


test('storeAsk: Make live of a Store asks only in the race window while another version is live there (user, 23 Nov 2026)', () => {
    const made = cockpitClub();
    // the Store of entry c00007 as a new version of 'Rollers · slow', made live, on a copy of `club` at `now`
    const ask = (club, now) => {
        const after = structuredClone(club);
        const input = storeInput({team: 'rollers', as: 'c00002', live: true, date: DATE, start: '', type: '', event: ''}, club.teams.rollers.version);
        return storeAsk(club, after, storeEntry(after, 'c00007', input, {now, newId: made.newId}), now);
    };
    // 19:16, the gate open, 'Rollers · fast' v3 live: the version card's words
    assert.deepEqual(ask(made.club, NOW), {words: 'Riders in the event get \'Rollers · slow\' v2 instead of \'Rollers · fast\' v3 within a minute. Make it live anyway?'});
    // before the gate: at once
    assert.equal(ask(made.club, BEFORE), null);
    // nothing live in the race: at once
    const none = structuredClone(made.club);
    none.teams.rollers.races[DATE].live = null;
    assert.equal(ask(none, NOW), null);
});


test('Make live of a plan not stored yet asks nothing while nothing is live in the race (user, 23 Nov 2026)', async t => {
    await start(t);
    srv.store.change(CID, c => {
        c.teams.rollers.races[DATE].live = null;
    });
    const body = await page('?e=c00006');
    assert.equal(stripOf(body), null);
    assert.match(barOf(body), /data-submit="store">Store<\/button><button class="btn primary" type="submit" form="store-c00006" name="live" value="on" aria-label="Store and make live" data-submit="live">Make live<\/button><\/div>$/);
    // Store alone would leave the race without a plan: a warning above the bar
    assert.deepEqual(warnsOf(body).at(-1), ['warn', 'Store: v4 of \'Rollers · fast\', not live. Riders get no plan for this race yet.']);
    const made = await followPost(srv, cookie, '/manage/inbox/c00006', storeFields({live: 'on'}));
    assert.equal(made.location, '/manage/team/rollers?r=2026-11-19#panel');
    assert.equal(srv.store.get(CID).sheets[liveOf()].n, 4);
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
    assert.ok(foldOf(pick).includes('<input type="date" name="date" value="2026-11-19">') && foldOf(pick).includes('<input type="time" name="start" value="19:30" required>'));
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
    assert.equal(srv.store.get(CID).teams.rollers.races['2026-11-19'].start, '19:30');    // the team's time, pinned as the race's own (user, 23 Nov 2026)

    // the event in the summary: the link posted when it parses, else the race's pinned or learned one
    const linked = await page('?e=c00007&as=new&drawn=rollers:new&startFor=2026-11-19&event=https%3A%2F%2Fwww.zwift.com%2Fevents%2Fview%2F5123456');
    assert.equal(summaryOf(pickOf(linked, 'c00007')), 'Race: Thu 19 Nov · 19:30 · Event 5123456 · Change');
    srv.store.change(CID, c => {
        c.teams.rollers.races['2026-11-19'].eventId = 4123456;
    });
    const fresh7 = '?e=c00007&team=rollers&as=new&drawn=rollers:new&startFor=2026-11-19';
    assert.equal(summaryOf(pickOf(await page(fresh7), 'c00007')), 'Race: Thu 19 Nov · 19:30 · Event 4123456 · Change');
    // a time typed that moves the race: Store clears the learned event (uploadSheet), so it is not named
    const kept = '?e=c00007&team=rollers&as=new&drawn=rollers:new&startFor=2026-11-19&startWas=19:30';
    assert.equal(summaryOf(pickOf(await page(`${kept}&start=20:00`), 'c00007')), 'Race: Thu 19 Nov · 20:00 · Change');
    // the time emptied (a page from before, or no browser check): Store keeps the race's, and the
    // summary says that one; the field is required, as it was prefilled (user, 23 Nov 2026)
    const blank = pickOf(await page(`${kept}&start=`), 'c00007');
    assert.ok(blank.includes('<input type="time" name="start" value="" required>'), blank);
    assert.equal(summaryOf(blank), 'Race: Thu 19 Nov · 19:30 · Event 4123456 · Change');
    srv.store.change(CID, c => {
        c.teams.rollers.races['2026-11-19'].pinnedEventId = 5654321;
    });
    const pinned = pickOf(await page(fresh7), 'c00007');
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
    const fellBack = pickOf(await page(`?e=${over}&team=rollers&as=new&drawn=rollers:new`), over);
    assert.equal(summaryOf(fellBack), 'Race: Thu 19 Nov · 19:30 · Change');
    assert.equal(foldOpen(fellBack), true, foldOf(fellBack));
    // the form's race is another than the next one (a date picked in the fold, then redrawn)
    assert.equal(foldOpen(pickOf(await page('?e=c00006&as=new&drawn=rollers:new&startFor=2026-11-19&date=2026-11-26'), 'c00006')), true);
    // the captain opened it: a redraw (the panel fragment, with the form's fields) draws it open again
    const tv = VERSION_OF(srv, 'rollers');
    const q = '?e=c00006&team=rollers&as=new&drawn=rollers:new&startFor=2026-11-19&startWas=19:30&start=19:30';
    const kept = await srv.get(`${PATH}${q}&raceOpen=1&panel=1&tv=${tv}`, cookie);
    assert.equal(kept.status, 200);
    assert.equal(foldOpen(element(await kept.text(), '<div class="cp-form"')), true, 'kept open across the redraw');
    assert.equal(foldOpen(element(await (await srv.get(`${PATH}${q}&raceOpen=&panel=1&tv=${tv}`, cookie)).text(), '<div class="cp-form"')), false);
    // a dry run that says something about the time: open (the start time is in the fold)
    assert.equal(foldOpen(pickOf(await page(`${q.replace('start=19:30', 'start=25:00')}`), 'c00006')), true);
    // the refusals and redraws of a Store that concern the race date, the start time or the link: open
    // (a new plan's: a version takes its plan's race, user 23 Nov 2026)
    const refused = async (fields, text) => {
        const r = await post(srv, cookie, '/manage/inbox/c00006', storeFields({as: 'new', drawn: 'rollers:new', type: 'late', ...fields}));
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


test('a new version takes its plan\'s race: a date, start time or event link posted with it is ignored (user, 23 Nov 2026)', async t => {
    await start(t);
    const race = () => JSON.stringify(srv.store.get(CID).teams.rollers.races[DATE]);
    const was = race();
    // as a page from before might post them: another date, a time that is no time, a link that is none
    const r = await followPost(srv, cookie, '/manage/inbox/c00006', storeFields({date: '2026-11-26', start: '25:00', event: 'x', startWas: '18:00'}));
    const [id, s] = sheetsOf(srv, 'rollers').find(([, x]) => x.n === 4);
    assert.equal(r.location, `/manage/team/rollers?v=${id}#panel`);
    assert.deepEqual([s.plan, s.date], ['c00001', DATE]);
    assert.equal(race(), was.replace(/"live":"[^"]*"/, `"live":"c00005"`));
    assert.equal(srv.store.get(CID).teams.rollers.races['2026-11-26'], undefined);
});


test('Store answers the page with the new version picked and what the result page said', async t => {
    await start(t);
    const r = await followPost(srv, cookie, '/manage/inbox/c00006', storeFields());
    const id = sheetsOf(srv, 'rollers').find(([, s]) => s.n === 4)[0];
    assert.equal(r.location, `/manage/team/rollers?v=${id}#panel`);
    assert.deepEqual(r.flash, {kind: 'ok', text: 'Stored as v4 of \'Rollers · fast\', not live. Riders keep \'Rollers · fast\' v3.'});
    assert.ok(element(r.page, '<div id="panel"').includes('class="flash ok"'));
    const pb = element(r.page, '<div id="panel-acts"');
    assert.match(pb, /<button class="btn primary" type="submit" data-arm-open>Make live<span class="sr"> v4 of &#39;Rollers · fast&#39;<\/span>/);   // primary; in the race window it asks first
    assert.ok(textOf(r.page).includes('v4 · not live'));                               // the notice in its row
    assert.match(r.page, new RegExp(`<li class="cp-row picked" data-sel="v:${id}">`));
    assert.equal(srv.store.get(CID).inbox.some(e => e.id === 'c00006'), false);
    assert.equal(liveOf(), 'c00005');
    // no "Wrong file?": no Restore, no Delete plan
    assert.equal(/Wrong file|Restore|\/manage\/plan\/back|\/manage\/sheet\/delete/.test(element(r.page, '<div id="panel"')), false);
    // on every draw, not only right after Store: still secondary
    assert.match(element(await page(`?v=${id}`), '<div id="panel-acts"'), /<button class="btn primary" type="submit" data-arm-open>Make live<span class="sr"> v4 of &#39;Rollers · fast&#39;<\/span>/);
});


test('Store and make live: the result, the table as riders get it, no Undo; what it changes for other teams', async t => {
    await start(t);
    const r = await followPost(srv, cookie, '/manage/inbox/c00006', storeFields({live: 'on', confirm: '1'}));
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
    // the new live version as riders get it: no old lines against v3 (spec §5.3b); no Undo
    assert.equal(/pt-old|pt-dropped|pt-mark|live before/.test(element(r.page, '<div id="panel-body"')), false);
    assert.equal(textOf(titleOf(r.page)).trim().endsWith(' Live'), true, titleOf(r.page));
    assert.equal(r.page.includes('<div class="cp-bar"') || r.page.includes('riders get this'), false);
    assert.equal(undoAny(r.page), false);
    assert.equal(/Wrong file|Restore|\/manage\/sheet\/delete/.test(head), false);
});


// The note of a page that holds its reload (Ruling I2 (b)): in #panel-acts, its last child (under
// the card at every width, user 23 Nov 2026), [text, Refresh's href]; null without one.
const holdNote = body => {
    const pb = element(body, '<div id="panel-acts"');
    const note = pb === null ? null : element(pb, '<p class="cp-hold">');
    if (note === null) {
        return null;
    }
    assert.ok(pb.endsWith(`${note}</div>`), 'the last thing in #panel-acts');
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
    // the message floats over the card from 1180 px (user, 24 Nov 2026): the flash and its result in one box with
    // a close link to the page's own URL; a clean one goes by itself after 6 s
    const note = element(r.page, '<div class="cp-note"');
    assert.ok(note.startsWith('<div class="cp-note" data-auto-close="6000"><div class="flash ') && note.includes('<div class="result">'), note.slice(0, 120));
    assert.match(note, new RegExp(`<a class="cp-note-x" href="/manage/team/rollers\\?v=${id}" aria-label="Close message" data-note-close><svg class="i cp-x"[^>]*>[^]*?</svg></a></div>$`));
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
    assert.match(pickOf(open, 'c00007'), /<form id="store-c00007"[^>]* data-hold-reload[ >]/);
    assert.deepEqual(holdNote(open), ['Not updating while the Store form is open · Refresh', '/manage/team/rollers?e=c00007']);
    assert.ok(open.indexOf('<div class="cp-bar">') < open.indexOf('<p class="cp-hold">'));          // under the card, outside it
    // the fragment carries the hold state and the note too
    const frag = await (await srv.get(`${PATH}?e=c00007&panel=1&tv=${VERSION_OF(srv, 'rollers')}`, cookie)).text();
    assert.match(frag, / data-hold-reload[ >]/);
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
    const r = await followPost(srv, cookie, '/manage/inbox/c00006', storeFields({live: 'on', confirm: '1'}));
    assert.equal(r.location, '/manage/team/rollers?r=2026-11-19#panel');         // live now: the race's live pointer
    const id = liveOf();
    assert.ok(element(r.page, '<div class="result"').startsWith('<div class="result" data-hold-reload>'));
    // a result that holds the reload stays until it is closed: no auto-close, its links inside the box
    assert.ok(element(r.page, '<div class="cp-note"').startsWith('<div class="cp-note"><div class="flash '), element(r.page, '<div class="cp-note"').slice(0, 80));
    assert.ok(element(r.page, '<div class="cp-note"').includes('Upload for Sprockets</a>'));
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
    assert.ok(element(red.page, '<div class="cp-note"').startsWith('<div class="cp-note"><div class="flash err" role="status">'), 'a red message stays until closed');
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


test('a received plan with two races ahead: "Store as" lists every race\'s plans with their days; the table follows the chosen plan\'s race, or a new plan\'s race radio', async t => {       // [Review Focus 5]
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
    // "Store as": the plans of every race ahead, nearest race first, each naming its day (controller
    // ruling 23 Nov 2026); a version has no race radio (it takes its plan's race)
    const choices = [...pickOf(near, 'c00007').matchAll(/<input type="radio" name="as" value="([^"]+)"[^>]*><span><strong>[^<]*<\/strong>(?:<span>([^<]*)<\/span>)?/g)]
        .map(m => [m[1], (m[2] ?? '').split(' · ')[0]]);
    assert.deepEqual(choices.map(([, day]) => day), ['Thu 19 Nov', 'Thu 19 Nov', 'Sun 22 Nov', 'Thu 26 Nov', '']);
    assert.equal(choices.at(-1)[0], 'new');
    assert.deepEqual(raceRadios(pickOf(near, 'c00007')), []);
    assert.match(capOf(near), /^Against live 'fast' v3/);
    // a plan of a later race chosen: the table is against that race's live version
    const sunPlan = choices[2][0];
    const sunV = await page(`?e=c00007&team=rollers&as=${sunPlan}&drawn=rollers:${sunPlan}`);
    // (the same plan's live version: named by its number alone)
    assert.match(capOf(sunV), /^(Against live v1|Same riders, order, pulls and targets as live v1)$/, capOf(sunV));

    // New plan: the race radios, in its race fold
    const q = '?e=c00007&as=new&drawn=rollers:new&startFor=2026-11-19';
    assert.deepEqual(raceRadios(pickOf(await page(q), 'c00007')), [['2026-11-19', true], ['2026-11-22', false], ['2026-11-26', false]]);
    assert.ok(foldOf(pickOf(await page(q), 'c00007')).includes('name="race"'));
    const sun = await page(`${q}&race=2026-11-22`);
    assert.deepEqual(raceRadios(pickOf(sun, 'c00007')), [['2026-11-19', false], ['2026-11-22', true], ['2026-11-26', false]]);
    assert.match(capOf(sun), /^Against live 'sunday' v1/);
    assert.equal(/v3/.test(capOf(sun)), false);

    const later = await page(`${q}&race=2026-11-26`);
    assert.deepEqual(raceRadios(pickOf(later, 'c00007')), [['2026-11-19', false], ['2026-11-22', false], ['2026-11-26', true]]);
    assert.equal(capOf(later), 'Nothing live for Thu 26 Nov yet: nothing to compare');
    // never a word about v3 of the 19th in the card but its form (the table holds riders only; the
    // form's "Store as" names the plans)
    const laterBody = element(later, '<div id="panel-body"');
    assert.equal(/v3|Rollers · fast/.test(textOf(laterBody.replace(element(laterBody, '<div class="cp-form"'), ''))), false);
    assert.ok(textOf(element(later, '<div class="cp-what"')).includes('Riders get no plan for this race yet.'));
    // stored there, not live: the flash is red (nothing live in that race), and Make live is primary on every draw
    const r = await followPost(srv, cookie, '/manage/inbox/c00007', {team: 'rollers', as: 'new', type: 'tue', drawn: 'rollers:new', race: '2026-11-26',
        startFor: '2026-11-26', startWas: '19:30', base: VERSION_OF(srv, 'rollers')});
    assert.deepEqual(r.flash, {kind: 'err', text: 'Stored as v1 of \'Rollers · tue\'. Not live: riders get nothing until you press Make live.'});
    const id = /\?v=([^#]+)#panel$/.exec(r.location)[1];
    assert.equal(srv.store.get(CID).sheets[id].date, '2026-11-26');
    for (const b of [r.page, await page(`?v=${id}`)]) {
        assert.match(element(b, '<div id="panel-acts"'), /<button class="btn primary" type="submit"[^>]*>Make live<span class="sr"> v1 of &#39;Rollers · tue&#39;<\/span>/);
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
        assert.ok(pickOf(r.body, 'c00006'), 'the form, in the card');
        assert.ok(holds(r.body), 'a refusal does not reload itself');
        assert.equal(stored(), n);
        assert.ok(waiting());
        return r.body;
    };
    // drawn for 'Rollers · slow', sent with 'Rollers · fast': redrawn for 'Rollers · fast', with its preview
    const plan2 = await refused(storeFields({drawn: 'rollers:c00002'}), 'Check the choices: the preview was for another team or plan.');
    assert.deepEqual(asRadios(pickOf(plan2, 'c00006')).find(([, on]) => on), ['c00001', true]);
    assert.ok(pickOf(plan2, 'c00006').includes('name="drawn" value="rollers:c00001"'));
    assert.deepEqual(warnsOf(plan2), [['info', 'Hanna moves from Sprockets to Rollers.'], ['warn', 'Still to do: Sprockets']]);   // its preview
    // a new plan for another race than the page was drawn for
    const race = await refused(storeFields({as: 'new', drawn: 'rollers:new', type: 'late', date: '2026-11-26'}), 'Check the choices: the preview was for another race.');
    assert.match(pickOf(race, 'c00006'), /<input type="date" name="date" value="2026-11-26"/);
    // an event link that does not parse: the form as sent
    // (a new plan's: a version takes its plan's race and its link, user 23 Nov 2026)
    const event = await refused(storeFields({as: 'new', drawn: 'rollers:new', type: 'late', event: 'x'}), 'This is not a Zwift or ZwiftPower event link.');
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


test('the ways in: Upload a file and an upload page opened for a plan (a hole\'s link, links already handed out) land on ?e=', async t => {
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


// The sheet (spec §5.5) is a page mode of the body's classes: below 1180 px the stylesheet shows the
// panel alone, for a version and for a plan not stored yet (user, 23 Nov 2026: the Store form is in
// the card, so the entry's sheet is the version's); the markup still names the picked row's path (the
// script moves the same classes in a swap: client.test.mjs).
const openTags = (html, cls) => [...html.matchAll(new RegExp(`<(?:div|ul|li|section)\\b[^>]*class="(?:[^"]* )?${cls}(?: [^"]*)?"[^>]*>`, 'g'))].map(m => m[0]);

test('the sheet\'s path is marked in the list: sel-race, sel-rows and picked; the Store form is in the card, never in the row', async t => {
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
        // a plan not stored yet sits in the box of those, before its race's box (user, 24 Nov 2026)
        assert.ok(race[0].startsWith(kind === 'e' ? '<section class="cp-pending' : '<div class="race cp-race') && rows[0].startsWith('<ul class="cp-rows') && row[0].startsWith('<li class="cp-row'), q);
        assert.ok(row[0].includes(`data-sel="${kind}:${q.slice(3)}"`), `${q}: ${row[0]}`);
        // the picked row is its link alone, for a version and for a plan not stored yet
        assert.match(picked, /^<li [^>]*><a class="cp-link"[^>]*>[^]*?<\/a><\/li>$/, q);
        if (kind === 'e') {
            // the Store form is in the card's body, the only one
            assert.ok(element(body, '<div id="panel-body"').includes('<div class="cp-form"><form id="store-c00006" '), q);
            assert.equal(count(body, '<div class="cp-form"'), 1);
        } else {
            assert.equal(count(body, '<div class="cp-form"'), 0);
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
        '.cp-head{flex-wrap:nowrap;align-items:flex-start}', '.cp-title{flex:1}', '.cp-close{margin-left:auto}',
        'body.cockpit.has-sel .pagehead>:not(.stale-banner),\n  body.cockpit.has-sel .cp-list{display:none}', 'body.cockpit.has-sel #panel{position:sticky',
        'body.cockpit.has-sel :is(.cp-top,.cp-body,#panel-acts>.cp-bar){background:none;border:0',
    ]) {
        assert.ok(block.includes(rule), rule);
        assert.equal(APP_CSS.indexOf(rule), APP_CSS.indexOf(rule, at), `${rule}: only inside the block`);
    }
    // the entry's sheet is the version's (user, 23 Nov 2026): no rule keeps a part of the list for it
    assert.equal(/sel-e|cp-pick/.test(APP_CSS), false);
    // no Make live box any more (user, 23 Nov 2026); Make live's strip takes the action bar's place
    assert.equal(APP_CSS.includes('.cp-form form>label:not(.field)'), false);
    assert.ok(APP_CSS.includes('.cp-bar.armed>:not(.arm-strip){display:none}'));
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


test('a later race: its notes (a pin note with its form) stand in its box under its line; no fold, no riders table in the list (user, 24 Nov 2026)', async t => {   // [M9]
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
    const laterBox = async () => element(await page(''), '<div class="race cp-race later"');
    const plain = await laterBox();
    assert.ok(plain, 'the later race\'s box');
    // no fold and no riders card: its riders are the card of its live row
    assert.equal(/race-more|Live plan and riders|riders-card|riders-h|<table|plancode/.test(plain), false, plain);
    assert.ok(plain.includes('href="/manage/team/rollers?r=2026-11-20#panel"'), 'its live row opens its riders in the card');
    assert.equal(plain.includes('action="/manage/sheet/unpin"'), false);
    srv.see('1002', '2026-11-19T23:05:00Z', {sig: codeOf(later), mod: '0.3.0', sheet: later, inEvent: true, event: 4567891});
    const withNote = await laterBox();
    // the note and its form: under the race's line, before its plans
    const at = s => withNote.indexOf(s);
    assert.ok(at('<p class="race">') >= 0 && at('<p class="race">') < at('action="/manage/sheet/unpin"') && at('action="/manage/sheet/unpin"') < at('<section class="cp-plan'), withNote);
    assert.equal(/race-more|<details class="fold/.test(withNote.replace(/<details class="fold cp-older"[^]*?<\/details>/g, '')), false, withNote);
});


test('the phone: the card follows the nearest race, before the later races, Over and the help, its message under the head; desktop keeps its columns', () => {   // [M1]
    const at = APP_CSS.indexOf('@media (max-width:1179.98px){');
    const block = APP_CSS.slice(at, APP_CSS.indexOf('@media (prefers-reduced-motion', at));
    // without a selection the list's blocks and the panel's parts are the grid's own items, in this
    // order: the flash (order 0), the nearest race, the card's top and body, the rest; the live row
    // looks live, not picked (no sheet is open)
    for (const rule of [
        'body.cockpit:not(.has-sel) :is(.cp-list,#panel){display:contents}',
        'body.cockpit:not(.has-sel) .cp-list>*{order:3;min-width:0}',
        // (the nearest race: the list's first block, or the first after the ways' copy, user 23 Nov 2026)
        'body.cockpit:not(.has-sel) .cp-list>:is(.cp-race:first-child,.cp-ways+.cp-race,.cp-pending:first-child,.cp-ways+.cp-pending,.cp-pending:first-child+.cp-race,.cp-ways+.cp-pending+.cp-race){order:1}',
        'body.cockpit:not(.has-sel) :is(#panel>.cp-top,#panel-body,#panel-acts){order:2}',
        'body.cockpit:not(.has-sel) :is(#panel-body,#panel-acts){margin-top:-1.25rem}',
        'body.cockpit:not(.has-sel) .cp-row.picked>.cp-link{background:none;box-shadow:inset 3px 0 0 var(--ok-icon)}',
    ]) {
        assert.ok(block.includes(rule), rule);
        assert.equal(APP_CSS.indexOf(rule), APP_CSS.indexOf(rule, at), `${rule}: only below 1180 px`);
    }
    // from 1180 px the list is one item at the left, as before
    assert.ok(APP_CSS.includes('.cp>.cp-list{grid-column:1;grid-row:1 / -1}'));
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
    // the upload page opened for a plan (a hole's link, a link already handed out): no plan crumb, the
    // way back is the team page
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
        assert.ok(textOf(head).includes('Riders on \'fast\' v3'), q);
        assert.equal(metaOf(head), `Plan code ${live} 2 of 6 have the plan`);
        assert.ok(card.includes('<details class="help" data-keep-refresh><summary>'), card);
        assert.equal(card.includes('Who has the plan shows from'), false);
        // right after its switch too: the plan as riders get it, a state on each row in ride order, no old line
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

    // ten minutes later: the same
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


test('a later race without a live plan keeps its one status line, no notes, no fold (user, 24 Nov 2026)', async t => {
    const made = cockpitClub();
    const c = made.club;
    c.teams.rollers.races[DATE].start = '22:30';
    uploadSheet(c, {slug: 'rollers', json: plan('Rollers spare', [['1001', 60, {pull_power: 300}]]), text: null,
        date: '2026-11-21', start: '00:30', base: c.teams.rollers.version, via: 'file', type: 'spare', as: 'new', live: false},
    {now: T('2026-11-19T10:00:00Z'), newId: made.newId});
    ids = made.ids;
    cookie = made.cookie;
    srv = await serve(t, made, {now: T('2026-11-19T22:50:00Z')});
    const box = element(await page(''), '<div class="race cp-race later"');
    assert.ok(box, 'the later race\'s box');
    assert.match(box, /<p class="sevline [a-z]+ race-status">|class="sevline[^"]*race-status/, box);
    assert.equal(/race-more|riders-card|<table|<details class="fold race-more"/.test(box), false, box);
});


test('a later race\'s riders: the card of its live row (?r=), the same rider table, with the Plan column once its gate is open (no fold in the list)', async t => {
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
    const card = async () => await page('?r=2026-11-20');
    const closed = await card();
    assert.equal(/race-more|Live plan and riders/.test(closed), false);
    const closedBody = element(closed, '<div id="panel-body"');
    assert.equal(count(closedBody, '<table class="ptable ptable-plan">'), 1, closedBody);
    assert.equal(/rstate|>Plan<|<ul class="riders/.test(closedBody), false, closedBody);
    assert.deepEqual(tableLines(closedBody).map(l => [l.pos, l.name, l.state]), [['1', 'Ben', null], ['2', 'Cleo', null]]);
    assert.ok(closedBody.includes('<td class="n pt-pull">45 s @ 4.0</td>'), closedBody);
    assert.equal(metaOf(closed), `Plan code ${codeOf(later)} 2 riders`);
    assert.ok(closedBody.includes('<p class="hint">In ride order. Who has the plan shows from <time>Fri 20 Nov 00:00</time>, when riders get it.</p>'), closedBody);

    srv.see('1002', '2026-11-19T23:05:00Z', {sig: codeOf(later), mod: '0.3.0', sheet: later, inEvent: true, event: 4567891});
    srv.clock.now = T('2026-11-19T23:10:00Z');                      // 00:10: its gate is open (see() puts the clock back first)
    const open = await card();
    const openBody = element(open, '<div id="panel-body"');
    assert.ok(openBody.includes('<th class="rstate">Plan</th>'), openBody);
    assert.match(metaOf(open), new RegExp(`^Plan code ${codeOf(later)} 0 of 2 have the plan$`));
    assert.deepEqual(tableLines(openBody).map(l => [l.pos, l.name, l.state]), [
        ['1', 'Ben', '– Not seen yet'], ['2', 'Cleo', '⚠︎ In event 4567891 · gets nothing 00:05']]);
    assert.equal(/<ul class="riders|class="rider /.test(openBody), false);
    sameRiders(srv.store.get(CID), 'rollers', srv.clock.now);
});


test('Store and make live: the plan code once, in the flash; the head\'s code line again on the next draw', async t => {
    await start(t);
    const r = await followPost(srv, cookie, '/manage/inbox/c00006', storeFields({live: 'on', confirm: '1'}));
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

// #panel takes the focus after a swap (screen readers land on the new card); it is no control, so it
// draws no focus ring: Safari drew the 3 px :focus-visible ring around the card's top after a click
test('cockpit: #panel draws no focus ring when the swap focuses it', () => {
    assert.ok(APP_CSS.includes('#panel:focus{outline:none}'));
});


// The card's actions (user, 23 Nov 2026: one action row under the title): a slot of their own,
// #panel-acts, right after #panel-body; from 1180 px its bar stands in the row under the title above
// the card's column (the ways to a plan at the row's left, above the list), below that at the card's
// bottom. Discard · Store · Make live, Make live always the rightmost.
const actsOf = html => element(html, '<div id="panel-acts"');

test('the card\'s actions: a slot of their own after #panel-body, Discard · Store · Make live; the live version status is the LIVE tag in its title (user, 24 Nov 2026)', async t => {
    await start(t);
    // a plan not stored yet: Discard, Store, Make live, in this order, outside #panel-body
    const entry = await page('?e=c00006');
    const acts = actsOf(entry);
    assert.ok(acts, 'the slot');
    assert.ok(entry.indexOf(element(entry, '<div id="panel-body"')) + element(entry, '<div id="panel-body"').length <= entry.indexOf('<div id="panel-acts"'), 'right after #panel-body');
    const pb = element(entry, '<div id="panel-body"');
    assert.equal(pb.includes('<div class="cp-bar"'), false, 'no bar in the card body');
    assert.ok(pb.startsWith('<div id="panel-body"><div class="cp-body has-acts">'), pb.slice(0, 80));
    const bar = element(acts, '<div class="cp-bar"');
    const at = s => bar.indexOf(s);
    assert.ok(at('/manage/inbox/c00006/discard') > 0 && at('/manage/inbox/c00006/discard') < at('data-submit="store"') && at('data-submit="store"') < at('data-submit="live"'), bar);
    assert.ok(bar.startsWith('<div class="cp-bar"><div class="as-discard">'), bar.slice(0, 80));
    // the buttons still post the Store form, which stays in #panel-body
    assert.ok(bar.includes('form="store-c00006" data-submit="store"') && pb.includes('<form id="store-c00006"'), bar);
    // a version not live: Make live alone
    const version = actsOf(await page('?v=c00004'));
    assert.match(version, /^<div id="panel-acts"><div class="cp-bar"><form method="post" action="\/manage\/live"[ >]/);
    assert.equal(count(version, 'data-arm-open>Make live'), 1, version);
    assert.equal(element(await page('?v=c00004'), '<div id="panel-body"').includes('cp-bar'), false);
    // the live version, nothing picked: no actions and no status bar; its LIVE tag is in its title
    const live = await page('');
    assert.equal(actsOf(live), '<div id="panel-acts"></div>');
    assert.equal(element(live, '<div id="panel-body"').includes('cp-bar'), false, element(live, '<div id="panel-body"'));
    assert.ok(titleOf(live).includes('<span class="tag">Live</span>'), titleOf(live));
    assert.ok(element(live, '<div id="panel-body"').startsWith('<div id="panel-body"><div class="cp-body">'));
    // the fragment: the three slots, in this order
    const frag = await (await srv.get(`${PATH}?e=c00006&panel=1&tv=${VERSION_OF(srv, 'rollers')}`, cookie)).text();
    assert.ok(frag.indexOf('<div id="panel"') < frag.indexOf('<div id="panel-body"') && frag.indexOf('<div id="panel-body"') < frag.indexOf('<div id="panel-acts"'), frag.slice(0, 200));
    assert.ok(actsOf(frag).includes('data-submit="live"'));
});


test('the card\'s actions: a race that is over reads "Read only" in the card, no actions (user, 23 Nov 2026)', async t => {
    await start(t, OVER);
    const body = await page('?v=c00004');
    assert.equal(actsOf(body), '<div id="panel-acts"></div>');
    assert.equal(textOf(element(element(body, '<div id="panel-body"'), '<div class="cp-bar"')).trim(), 'Read only');
});


test('the card\'s message stands under its head, in the same .cp-top, with its own close for every width (user, 24 Nov 2026)', async t => {
    await start(t);
    // a clean Store result: head (title with the sheet's close, meta line), then the message with its ×
    const r = await followPost(srv, cookie, '/manage/inbox/c00006', storeFields());
    const panel = element(r.page, '<div id="panel"');
    const at = s => panel.indexOf(s);
    assert.ok(at('<div class="cp-top">') >= 0 && at('<h2 class="cp-title"') > at('<div class="cp-top">') && at('<a class="cp-close"') > at('<h2 class="cp-title"')
        && at('<p class="cp-meta">') > at('<a class="cp-close"') && at('<div class="cp-note"') > at('<p class="cp-meta">') && at('data-note-close') > at('<div class="cp-note"'), panel);
    // the note is inside the head (one block), not a sibling of it
    assert.ok(element(panel, '<div class="cp-top">').includes('<div class="cp-note"'), panel);
    assert.equal(count(panel, 'data-note-close'), 1);
    // a page without a message has no note and no ×
    const calm = await page('?v=c00004');
    assert.equal(calm.includes('cp-note'), false);
});


test('the card\'s title: a version not live has no LIVE tag, the live one has it, a race that is over keeps "Read only" (user, 24 Nov 2026)', async t => {
    await start(t);
    // v2 is not live: no tag in its title, Make live in its actions
    const old = await page('?v=c00004');
    assert.match(textOf(titleOf(old)).trim(), /^'fast' v2 · stored Thu 19 Nov 18:55$/);
    assert.equal(/class="tag/.test(titleOf(old)), false, titleOf(old));
    assert.equal(/Live|Not sent/.test(textOf(titleOf(old))), false, titleOf(old));
    // v3 is live: the tag, once, in the title
    assert.equal(count(titleOf(await page('?v=c00005')), 'class="tag'), 1);
    // after the race: every card reads "Read only", the live version's too; none has a tag in its title
    srv.clock.now = OVER;
    for (const q of ['?v=c00004', '?v=c00005']) {
        const body = await page(q);
        assert.equal(/class="tag/.test(titleOf(body)), false, `${q}: ${titleOf(body)}`);
        assert.equal(textOf(element(element(body, '<div id="panel-body"'), '<div class="cp-bar"')).trim(), 'Read only', q);
    }
});


test('the action row from 1180 px: the ways to a plan above the list, the card\'s bar above the card; the row\'s height kept (user, 23 Nov 2026)', async t => {
    await start(t);
    const body = await page('');
    // the ways to a plan: in the head (below 1180 px) and at the list's top (from 1180 px), the same links
    const head = element(body, '<section class="headacts planner"');
    assert.ok(head, 'the head\'s ways');
    const list = element(body, '<div class="cp-list"');
    assert.ok(/^<div class="cp-list"[^>]*>\s*<div class="cp-ways"><section class="headacts planner">/.test(list), list.slice(0, 200));
    assert.equal(element(list, '<section class="headacts planner"'), head);
    // the stylesheet: from 1180 px the list over every row, the bar in the first row of the card's
    // column at its right end, at least a button high with or without one; the head's ways and the
    // list's copy each where they belong
    const wide = APP_CSS.slice(APP_CSS.indexOf('@media (min-width:1180px)'));
    for (const rule of [
        '.cp{grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-rows:minmax(calc(var(--btn) + .75rem),auto) auto auto auto 1fr;gap:0 1.5rem}',
        '.cp>.cp-list{grid-column:1;grid-row:1 / -1}',
        '.cp>#panel-acts{display:contents}',
        '.cp>#panel-acts>.cp-bar{grid-column:2;grid-row:1;align-self:start;justify-content:flex-end',
        '.cp>#panel{grid-row:2}',
        '.cp>#panel-body{grid-row:3}',
        '.cp>#panel-acts>.cp-hold{grid-column:2;grid-row:4}',
        '.app .cockpit>.pagehead>.headacts{display:none}',
    ]) {
        assert.ok(wide.includes(rule), rule);
    }
    // a question of the bar's actions (user, 24 Nov 2026) floats under the buttons over the card's top from
    // 1180 px: the bar its positioning box, the buttons stay, nothing moves; below 1180 px it takes the
    // bar's place as before
    for (const rule of [
        '.cp>#panel-acts>.cp-bar form[data-arm].armed{flex-basis:auto;width:auto}',
        '.cp>#panel-acts>.cp-bar form[data-arm].armed>[data-arm-open]{display:inline-flex}',
        '.cp>#panel-acts>.cp-bar form.discard.armed{order:0;padding-right:.75rem}',
        '.cp>#panel-acts>.cp-bar .arm-strip{position:absolute;z-index:5;top:calc(100% + .375rem);right:0;flex-basis:auto;width:26rem;max-width:100%;background:var(--surface);box-shadow:var(--shadow-pop)}',
    ]) {
        assert.ok(wide.includes(rule), rule);
    }
    assert.ok(APP_CSS.includes('#panel-acts>.cp-bar{position:relative;'), 'the bar is the strip\'s positioning box');
    // the one-shot message floats over the card's top from 1180 px (user, 24 Nov 2026): the card's panel its
    // positioning box, the box absolute on the card's width, under an open question (z-index 4 < 5); below
    // 1180 px it flows under the card's head, with its own × at its top right
    for (const rule of [
        '.cp>#panel{position:relative}',
        '.cp>#panel .cp-note{position:absolute;z-index:4;top:-.375rem;left:0;right:0;',
        '.cp>#panel .cp-note-x{top:.5rem;right:.5rem}',
    ]) {
        assert.ok(wide.includes(rule), rule);
    }
    // the base rules (every width): the box in the flow, its × shown at its top right, the flash clear of it
    const base = APP_CSS.slice(0, APP_CSS.indexOf('@media (min-width:1180px){'));
    for (const rule of ['.cp-note{position:relative;margin-top:.625rem}', '.cp-note>.flash{padding-right:calc(var(--tap) + .25rem)}',
        '.cp-note-x{display:inline-flex;position:absolute;top:0;right:0;']) {
        assert.ok(base.includes(rule), rule);
    }
    assert.equal(APP_CSS.includes('.cp-note-x{display:none}'), false, 'the × shows at every width');
    assert.ok(APP_CSS.includes('@media not all and (min-width:1180px){.cp-bar.armed>:not(.arm-strip){display:none}}'), 'the buttons give the strip their place only below 1180 px');
    assert.ok(APP_CSS.includes('.cp-ways{display:none}'), 'the copy hidden below 1180 px');
    assert.ok(wide.includes('.cp-ways{display:block'), 'shown from 1180 px');
});


// The race's phase on the live version's row (user, 23 Nov 2026): "Sending" (blue) from the gate
// until the start, "Started" (amber) from the start until the race is over, next to its LIVE tag;
// the race line then drops "open since …" and "started". In the Over fold the LIVE tag is grey.
const raceText = html => textOf(/<p class="race">([\s\S]*?)<\/p>/.exec(element(html, '<div class="race cp-race') ?? '')?.[1] ?? '').replace(/\s+/g, ' ').trim();
const liveRow = html => element(html, '<li class="cp-row live');

test('the live row says the race\'s phase: Sending from the gate, Started from the start; the race line drops it (user, 23 Nov 2026)', async t => {
    await start(t, BEFORE);
    // before the gate: the line says when it opens, the row LIVE alone
    let body = await page('');
    assert.equal(raceText(body), 'Thu 19 Nov · 19:30 · in 6 h 30 min · opens 19:00');
    assert.equal(/tag (sending|started)/.test(liveRow(body)), false, liveRow(body));
    // the gate open (19:16): "Sending" next to LIVE, its words for screen readers; no "open since"
    srv.clock.now = NOW;
    body = await page('');
    assert.equal(raceText(body), 'Thu 19 Nov · 19:30 · in 14 min');
    assert.ok(liveRow(body).includes('<span class="tag">Live</span><span class="tag sending" title="Riders get this plan now"><span aria-hidden="true">Sending</span><span class="sr">Riders get this plan now</span></span>'), liveRow(body));
    // started (19:40): "Started"; the line drops "started"
    srv.clock.now = T('2026-11-19T18:40:00Z');
    body = await page('');
    assert.equal(raceText(body), 'Thu 19 Nov · 19:30');
    assert.ok(liveRow(body).includes('<span class="tag started" title="The race has started"><span aria-hidden="true">Started</span><span class="sr">The race has started</span></span>'), liveRow(body));
    assert.equal(liveRow(body).includes('tag sending'), false);
    // the stylesheet: Sending in the accent's colours, Started in amber, a grey LIVE for a race that is over
    for (const rule of ['.tag.sending{background:var(--accent-soft);color:var(--accent-soft-fg);border-color:var(--accent)}',
        '.tag.started{background:var(--warn-bg);color:var(--warn-fg);border-color:var(--warn-bd)}',
        '.tag.was{background:var(--neutral-bg);color:var(--muted);border-color:var(--neutral-bd)}']) {
        assert.ok(APP_CSS.includes(rule), rule);
    }
});


test('a race that is over: its live version\'s LIVE tag is grey, "Was live for this race" for screen readers; no phase (user, 23 Nov 2026)', async t => {
    await start(t, OVER);
    const over = element(await page(''), '<details class="fold over"');
    const row = element(over, '<li class="cp-row live');
    assert.ok(row, over);
    assert.ok(row.includes('<span class="tag was" title="Was live for this race"><span aria-hidden="true">Live</span><span class="sr">Was live for this race</span></span>'), row);
    assert.equal(/tag (sending|started)/.test(over), false);
});


test('without a start time the live row says "Not sent", no phase', async t => {
    const c = makeClub({teams: [['Rollers', null]]});
    upload(c.club, 'rollers', {riders: ROLLERS.slice(0, 3), at: T('2026-11-19T10:00:00Z')});
    const s = await serve(t, c, {now: NOW});
    const body = await (await s.get('/manage/team/rollers', c.cookie)).text();
    const row = liveRow(body);
    assert.ok(row.includes('<span class="tag off">Not sent</span>'), row);
    assert.equal(/tag (sending|started)/.test(row), false, row);
});
