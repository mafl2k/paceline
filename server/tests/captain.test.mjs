// The captain pages (plan 3b): the team page /manage/team/<slug> (the team cockpit since team cockpit
// spec §8; its list, panel and Store form are cockpit.test.mjs's) with its switcher and sidebar, "N to
// fix", the riders card, the two ⋯ menus, and the team actions answering 303 to it; the team
// settings, the new-team page and the live-confirm page (Task 6), and the team actions answering
// their own pages; the club settings, the rider-code pages and the club actions answering them (Task
// 7); the team picker /manage, its first run, the DST banner and the signed-out page (Task 8).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {planJson, T, CODE_SECRET, rows, liveId, race, setLive} from './helpers.mjs';
import {
    CID, DATE, NOW, ROLLERS, makeClub, secondClub, upload, serve, textOf, count, flashOf, post, followPost, storeOk, VERSION_OF,
    storedClub, intake, storeUpload, storePost, CLUB_FIELD, postUpload, armOf, armHas, element, elements,
} from './manage-helpers.mjs';

// The start times of team `slug`'s races, by date (a special team's races all have one).
const starts = (c, slug) => Object.fromEntries(Object.entries(c.teams[slug].races).map(([date, r]) => [date, r.start]));
import {setRiderCode, uploadSheet, makeLive, ClubError, addEntry} from '../club.mjs';
import {T as COPY} from '../pages.mjs';
import {ic} from '../icons.mjs';
import {APP_CSS} from '../app-css.mjs';
import {menu} from '../ui.mjs';
import {teamView} from '../team-view.mjs';
import {raceStart} from '../select.mjs';

// How many races ahead team `slug` has with no start time (teamView.races).
const teamViewRaces = (club, slug) => teamView(club, slug, {now: T('2026-11-20T10:00:00Z')}).races.filter(r => r.noStart).length;
import {newRiderCode, riderCodeHash, formatRiderCode, randomId} from '../ids.mjs';

const FLASH_CLEARED = '__Host-pl_flash=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
const DST = 'Daylight saving time changed: check your team start times (WTRL/ZRL times may be fixed in UTC).';


// The team page of `slug` after a 200.
async function teamBody(srv, slug, cookie) {
    const res = await srv.get(`/manage/team/${slug}`, cookie);
    const body = await res.text();
    assert.equal(res.status, 200, body);
    return body;
}


// The riders card's rows with a state (after the gate: the rider table's Plan column, team cockpit
// spec §7 amended 22 Nov 2026) as {sev, name, text, time}, in the table's order; text the name, the
// state's words and the check's time (the sign before them is aria-hidden and left out).
// The team page's card (team cockpit spec §5.3b: with nothing picked the nearest race's live version,
// its riders card): its top in #panel and its body in #panel-body, as one string; null without one.
function ridersCardOf(body) {
    const top = element(body, '<div class="cp-top"');
    const card = element(body, '<div class="cp-body"');
    return top === null || card === null ? null : top + card;
}


function riderRows(html) {
    const rows = [...html.matchAll(/<tr><td class="n pt-pos">[\s\S]*?<\/tr>/g)].map(([row]) => [row, /<td class="rstate (\w+)">([\s\S]*?)<\/td>/.exec(row)]);
    return rows.filter(([, cell]) => cell !== null).map(([row, [, sev, inner]]) => {
        const name = textOf(/<span class="pt-nm">([^<]*)<\/span>/.exec(row)[1]);
        const words = textOf(inner.replace(/<span class="rstate-sign" aria-hidden="true">[^<]*<\/span>/, '')).trim();
        return {sev, name, text: `${name} ${words}`, time: /<time>([^<]*)<\/time>/.exec(inner)?.[1] ?? null};
    });
}


test('team page: the planner\'s roster is not listed, before the gate or after it', async t => {
    // Jo is only in the planner's roster (the club's rider pool)
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, bench: ['1009'], at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c, {now: T('2026-11-19T17:55:00Z')});
    for (const at of ['2026-11-19T17:55:00Z', '2026-11-19T18:10:00Z']) {
        srv.clock.now = T(at);
        const body = await teamBody(srv, 'rollers');
        const card = ridersCardOf(body);
        // the live plan in the rider table, before the gate and after it (then with one state per rider)
        const names = [...card.matchAll(/<span class="pt-nm">([^<]*)<\/span>/g)].map(m => m[1]);
        assert.equal(riderRows(card).length, at < '2026-11-19T18:00' ? 0 : 8, at);
        assert.equal(names.length, 8, at);
        assert.ok(!names.includes('Jo'), at);
        assert.ok(!/bench/i.test(textOf(body)), `${at}: ${textOf(body)}`);
        assert.ok(!body.includes('class="riders bench"'), at);
    }
});


test('team page: before the gate', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    race(c.club, 'rollers', DATE).eventId = 4567001;
    const sig = c.club.sheets[live].sig;
    const srv = await serve(t, c, {now: T('2026-11-19T17:55:00Z')});
    const body = await teamBody(srv, 'rollers');
    const text = textOf(body);
    const summary = /<summary>([\s\S]*?)<\/summary>/.exec(body)[1];
    assert.ok(summary.includes('<h1>Rollers</h1>'), summary);
    // the race line says when riders get the plan: no status card repeats it (Task 8c)
    assert.equal(textOf(/<p class="race">([\s\S]*?)<\/p>/.exec(body)[1]).trim(), 'Thu 19 Nov · 19:30 · in 35 min · opens 19:00 · Event 4567001');
    assert.ok(text.includes('Updated 18:55'), text);
    assert.ok(!/class="sevline [a-z]+ big"/.test(body), 'no status card');
    // the riders card before the gate: the live plan in the rider table, in ride order, no rider state
    const card = ridersCardOf(body);
    assert.deepEqual([...card.matchAll(/<td class="n pt-pos">(\d+)<\/td>/g)].map(m => m[1]), ['1', '2', '3', '4', '5', '6', '7', '8']);
    assert.ok(!/class="rstate/.test(body), 'no rider state before the gate');
    // the live version's LIVE tag is in its card's title; the card has no status bar (user, 24 Nov 2026)
    assert.ok(text.includes(`Riders on 'fast' v1 Live Plan code ${sig} 8 riders`), text);
    assert.ok(element(body, '<h2 class="cp-title"').includes('<span class="tag">Live</span>') && !body.includes('<div class="cp-bar"'), element(body, '<h2 class="cp-title"'));
    assert.ok(body.includes('<p class="hint">In ride order. Who has the plan shows from <time>19:00</time>, when riders get it.</p>'));
    assert.ok(text.includes('v1 Live'), text);
    // no Restore
    assert.ok(!body.includes('action="/manage/plan/back"'));
    // the learned event once, in the race line (above) and the race's ⋯; not in the plan's block
    assert.ok(!textOf(withoutMenus(element(body, '<section class="cp-plan live" '))).includes('4567001'), 'not in the plan block');
    assert.ok(textOf(menuOf(body, 'Options for the race on Thu 19 Nov')).includes('Event 4567001, learned from a rider\'s check.'), 'a learned event, not a link');
    assert.ok(!text.includes('(yours)'));
    // Upload a plan: a button in the head under the race line (UI panel wave 3), no fixed bar (Task 8c);
    // no "Plan on ZwiftGopher" without PUBLIC_URL
    assert.match(element(body, '<header class="pagehead">'), /<\/div>\s*<div class="headacts"><a class="btn secondary small" href="\/manage\/upload\?team=rollers"><svg[^>]*>[\s\S]*?<\/svg>Upload a plan<\/a><\/div>\s*<p class="fresh">/);
    assert.ok(!body.includes('uplink'));
    assert.ok(!body.includes('actionbar'));
    assert.match(body, /<body class="teampage cockpit"/);
    assert.ok(body.includes('<noscript><meta http-equiv="refresh" content="30;url=/manage/team/rollers"></noscript>'));
    assert.ok(body.includes('data-refresh="30"'));
    assert.ok(body.includes('data-updated="18:55"'));
    assert.equal(count(body, '<script'), 1);
    // the stale banner, hidden until the script shows it
    assert.ok(body.includes('<p class="stale-banner" role="status" data-stale hidden data-why-offline="· no connection" '
        + 'data-why-signedout="· signed out" data-why-error="· the server did not answer">'), body);
    assert.ok(body.includes('Not updated since <time data-stale-since>18:55</time>'));
    assert.ok(body.includes('<span data-stale-why></span>'));
    assert.ok(body.includes('<a class="btn secondary small" href="/manage/team/rollers" data-reload>Try again</a>'));
    assert.ok(!text.includes('Daylight saving'), 'no DST banner in November');
    // Team settings: a quiet link at the top right (no card), as Club settings on the teams page
    assert.ok(!body.includes('rowlink'), 'no settings card');
    assert.ok(!text.includes('Name, start time, delete team'));
    assert.equal(count(body, 'href="/manage/team/rollers/settings"'), 1);
});


test('team page: Team settings sits in the head row beside the kicker', async t => {
    // a team with a live plan and one without a start time: the same link, before the race line; the
    // team name between them is the title from 1024 px (.desk), the bar's on phones
    const c = makeClub({teams: [['Rollers', '19:30'], ['Cogs', null]]});
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c, {now: T('2026-11-19T17:55:00Z')});
    const gear = ic('settings');
    for (const slug of ['rollers', 'cogs']) {
        const body = await teamBody(srv, slug);
        const head = element(body, '<header class="pagehead">');
        const name = slug === 'rollers' ? 'Rollers' : 'Cogs';
        assert.ok(head.includes(`<div class="teamhead"><p class="kicker">Kettenfett RC</p><h1 class="desk">${name}</h1>`
            + `<a class="btn quiet small" href="/manage/team/${slug}/settings">${gear}Team settings</a></div>`), head);
        // no rhythm line: the race's line says the day and time (user, 23 Nov 2026)
        assert.ok(!head.includes('class="rhythm"'), head);
        // the build's quiet way to the new page went with the switch (team cockpit spec §8)
        assert.equal(body.includes('/cockpit"') || body.includes('New team page (preview)'), false);
        assert.ok(!head.includes('<p class="race">') && body.indexOf('<p class="race">') > body.indexOf(head), 'the race line under the head, in its race');
        assert.ok(!body.includes('rowlink'), 'no settings card');
    }
    // no start time and no plan: a neutral line, no red callout (spec §8, coordinator 21 Nov 2026);
    // the head's Team settings is the way to the start time
    const cogs = await teamBody(srv, 'cogs');
    assert.ok(!cogs.includes('callout err') && cogs.includes('<p class="race"><span>No start time set</span></p>'), cogs);
    // no riders card, no head buttons: the upload link is the empty card's button
    assert.ok(!cogs.includes('class="cp-top"') && !cogs.includes('riders-card'));
    assert.ok(!cogs.includes('col-c') && !cogs.includes('class="headacts"'));
});


test('team page: the gate edge', async t => {
    // 29 Oct 2026, four days after the switch to winter time: 19:30 is 18:30Z, the gate 18:00Z
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-10-29T14:00:00Z'), date: '2026-10-29'});
    const sig = c.club.sheets[live].sig;
    const srv = await serve(t, c, {now: T('2026-10-29T17:59:59.999Z')});
    // Ben has the live plan already: before the gate it shows nowhere
    srv.see('1001', '2026-10-29T17:50:00Z', {sig, mod: '0.3.0', sheet: live, inEvent: false, event: null});
    const before = await teamBody(srv, 'rollers');
    assert.equal(count(ridersCardOf(before), '<td class="n pt-pos">'), 8);
    assert.ok(!before.includes('class="rstate'), 'no state 1 ms before the gate');
    assert.ok(textOf(before).includes('Thu 29 Oct · 19:30 · in 31 min · opens 19:00'), textOf(before));
    assert.ok(textOf(before).includes(`Riders on 'fast' v1 Live Plan code ${sig} 8 riders`));
    assert.ok(textOf(before).includes(DST));

    srv.clock.now = T('2026-10-29T18:00:00Z');
    const after = await teamBody(srv, 'rollers');
    const rows = riderRows(after);
    // the same table, in ride order, with a state per rider
    assert.equal(count(ridersCardOf(after), '<td class="n pt-pos">'), 8);
    assert.deepEqual(rows.map(r => r.sev), ['ok', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral']);
    assert.equal(rows[0].text, 'Ben Has the plan');
    const text = textOf(after);
    assert.ok(text.includes('1 of 8 riders have the plan'), text);
    // after the gate (at its edge): the live row says "Sending", the race line no "open since" (user,
    // 23 Nov 2026; fix round 1 had it in the line)
    assert.ok(text.includes('Thu 29 Oct · 19:30 · in 30 min') && !text.includes('open since'), text);
    assert.ok(element(after, '<li class="cp-row live').includes('<span class="tag sending"'), 'Sending from the gate on');
    assert.ok(text.includes(DST));
    assert.match(after, /<p class="banner warn" role="note">/);
});


test('team page: after the gate, one state per row, riders counted', async t => {
    // added out of order: the rows sort them
    const c = makeClub({teams: [['Cranks', null], ['Sprockets', '19:40'], ['Rollers', '19:30'], ['Axles', '19:40']]});
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z'), pinned: 4567890});
    const sig = c.club.sheets[live].sig;
    const srv = await serve(t, c);
    srv.see('1001', '2026-11-19T18:22:00Z', {sig, mod: '0.3.0', sheet: live, inEvent: true, event: 4567890});
    for (const aid of ['1005', '1006', '1007', '1008']) {
        srv.see(aid, '2026-11-19T17:00:00Z', {sig, mod: '0.3.0', sheet: live, inEvent: false, event: null});
    }
    srv.see('1003', '2026-11-19T16:10:00Z', {sig: 'ABC123', mod: '0.3.0', sheet: live, inEvent: false, event: null});
    srv.see('1004', '2026-11-19T17:00:00Z', {sig: null, mod: '0.2', sheet: null, inEvent: false, event: null});

    const body = await teamBody(srv, 'rollers');
    const text = textOf(body);
    assert.ok(text.includes('5 of 8 riders have the plan'), text);
    assert.match(body, /<span class="count"><strong>5 of 8<\/strong> have the plan<\/span>/);
    const rows = riderRows(body);
    // one row per rider, in ride order (the rider table's; the states no longer sort them)
    assert.deepEqual(rows.map(r => r.name), ['Ben', 'Cleo', 'Dan', 'Eva', 'Finn', 'Gus', 'Hanna', 'Ida']);
    const row = name => rows.find(r => r.name === name);
    assert.deepEqual(row('Ben'), {sev: 'ok', name: 'Ben', text: 'Ben Has the plan · in the event', time: null});
    assert.deepEqual(row('Cleo'), {sev: 'neutral', name: 'Cleo', text: 'Cleo Not seen yet', time: null});
    assert.deepEqual(row('Dan'), {sev: 'warn', name: 'Dan', text: 'Dan Has an older plan (code ABC123) 17:10', time: '17:10'});
    // a 0.2 check (mod "0.2", from before the hard cut) is a plain check: no "old Paceline" mark
    assert.deepEqual(row('Eva'), {sev: 'neutral', name: 'Eva', text: 'Eva Checked 18:00 · not in the event yet', time: null});
    assert.deepEqual(row('Finn'), {sev: 'ok', name: 'Finn', text: 'Finn Has the plan', time: null});
    assert.ok(text.includes('What do these mean?'));
    // the event link is the race's (races spec §4 "Race ⋯", §7): the race line names it and its ⋯ has
    // Remove; the plan's block does not repeat it
    const live1 = element(body, '<section class="cp-plan live" ');
    assert.ok(!textOf(withoutMenus(live1)).includes('4567890'), textOf(live1));
    assert.ok(textOf(/<p class="race">([\s\S]*?)<\/p>/.exec(body)[1]).trim().endsWith(' · Event 4567890'), body);
    const rm = menuOf(body, 'Options for the race on Thu 19 Nov');
    assert.ok(textOf(rm).includes('Event link 4567890 (yours)'), textOf(rm));
    assert.ok(rm.includes('<input type="hidden" name="action" value="unlink">'), rm);
    assert.ok(!body.includes('<details class="more">'));
    assert.ok(!live1.includes('/manage/sheet/unpin'), 'no Remove event link in the plan block');
    // no Undo card any more (plan versions §8)
    assert.ok(!body.includes('undocard'), 'no undo card');
    assert.ok(!body.includes('/manage/undo'));
    assert.ok(!text.includes('Last change'));
    // a team without a start time and without a plan: neutral (spec §8)
    assert.ok(textOf(await teamBody(srv, 'cranks')).includes('No start time set'));
});


test('team page: 2 to fix, a hole and a pin mismatch', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z'), pinned: 4567890});
    upload(c.club, 'sprockets', {riders: ['1001', '1009'], at: T('2026-11-19T16:30:00Z')});
    const sig = c.club.sheets[live].sig;
    const srv = await serve(t, c);
    for (const aid of ['1005', '1006', '1007']) {
        srv.see(aid, '2026-11-19T18:20:00Z', {sig, mod: '0.3.0', sheet: live, inEvent: true, event: 4567891});
    }
    // before S - 2 h: not counted
    srv.see('1008', '2026-11-19T16:20:00Z', {sig, mod: '0.3.0', sheet: live, inEvent: true, event: 4567891});

    const body = await teamBody(srv, 'rollers');
    const callout = element(body, '<section class="callout err"');
    assert.ok(callout, body);
    assert.equal(textOf(/<h2[^>]*>([\s\S]*?)<\/h2>/.exec(callout)[1]).trim(), '2 to fix');
    const notes = elements(callout, '<li class="note');
    assert.equal(notes.length, 2);
    const [pin, hole] = notes;
    assert.ok(pin.startsWith('<li class="note err">'));
    const pinText = textOf(pin);
    assert.ok(pinText.includes('3 riders are in another event and get nothing'), pinText);
    assert.ok(pinText.includes('Finn, Gus and Hanna are in event 4567891. Your event link says 4567890.'), pinText);
    assert.ok(pinText.includes('4567890 (your link): nobody'));
    assert.ok(pinText.includes('4567891: Finn, Gus and Hanna'));
    assert.ok(pin.includes(`<form method="post" action="/manage/sheet/unpin">${CLUB_FIELD}<input type="hidden" name="team" value="rollers"><input type="hidden" name="sheet" value="${live}">`), pin);
    assert.ok(pinText.includes('Remove event link'));
    assert.ok(hole.startsWith('<li class="note warn">'));
    const holeText = textOf(hole);
    assert.ok(holeText.includes('Ben now rides Sprockets'), holeText);
    assert.ok(holeText.includes('Sprockets has Ben in its plan from 17:30; your live plan still lists Ben.'));
    // the hole's upload carries its race (races Task 7: the assign page opens on it)
    assert.match(hole, new RegExp(`<a class="btn secondary small" href="/manage/upload\\?team=rollers&amp;plan=${live}&amp;date=2026-11-19">[\\s\\S]*?Upload without Ben</a>`));
    // the riders in the other event, each in red
    assert.deepEqual(riderRows(body).filter(r => r.sev === 'err').map(r => r.text), [
        'Finn In event 4567891 · gets nothing 19:20', 'Gus In event 4567891 · gets nothing 19:20', 'Hanna In event 4567891 · gets nothing 19:20']);
    // Sprockets has Ben: no hole there
    const sprockets = await teamBody(srv, 'sprockets');
    assert.ok(!sprockets.includes('class="callout'), 'Sprockets has nothing to fix');
    assert.ok(!sprockets.includes('now rides'));
});


test('team page: a check from another team\'s event raises no pin note', async t => {
    // Jo is only in Rollers' roster (the club's rider pool) and rides Sprockets (staggered start, own
    // event link). His check from Sprockets' event resolved to Sprockets' plan: Rollers' page must not
    // call that a mismatch, and shows him nowhere (no row, no "rides Sprockets" warning).
    const c = makeClub();
    const rollers = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, bench: ['1009'], at: T('2026-11-19T14:00:00Z'), pinned: 4567890});
    const sprockets = upload(c.club, 'sprockets', {riders: ['1009', '1010'], at: T('2026-11-19T14:30:00Z'), pinned: 4567899});
    const srv = await serve(t, c, {now: T('2026-11-19T18:40:00Z')});
    srv.see('1009', '2026-11-19T18:35:00Z', {sig: c.club.sheets[sprockets].sig, mod: '0.3.0', sheet: sprockets, inEvent: true, event: 4567899});
    // a real mismatch: a Rollers rider in the wrong event is stored with Rollers' plan
    srv.see('1005', '2026-11-19T18:20:00Z', {sig: c.club.sheets[rollers].sig, mod: '0.3.0', sheet: rollers, inEvent: true, event: 4567891});
    const body = await teamBody(srv, 'rollers');
    const callout = element(body, '<section class="callout err"');
    const pins = elements(callout, '<li class="note err">');
    assert.equal(pins.length, 1, callout);
    assert.ok(textOf(pins[0]).includes('1 rider is in another event and gets nothing'));
    assert.ok(textOf(pins[0]).includes('Finn is in event 4567891.'));
    assert.ok(!callout.includes('4567899'), 'Jo is not in Rollers\' pen');
    assert.equal(riderRows(body).find(r => r.name === 'Jo'), undefined, 'no row for a roster rider');
    assert.ok(!textOf(body).includes('Jo'), textOf(body));
    assert.ok(!body.includes('class="rstate warn"'), 'no warning on Rollers\' page');
    assert.ok(!/bench/i.test(textOf(body)), textOf(body));
    const sp = await teamBody(srv, 'sprockets');
    assert.ok(!sp.includes('<li class="note err">'), 'no pin note on Sprockets');
    assert.equal(riderRows(sp).find(r => r.name === 'Jo').text, 'Jo Has the plan · in the event');
});


test('team page: no plan', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const body = await teamBody(srv, 'sprockets');
    const text = textOf(body);
    // no status card (Task 8c): the empty card says it; the regular race day without a plan is no
    // race (spec §8): no alarm, the switcher neutral, the race line the neutral "Next regular race"
    assert.ok(!/class="sevline [a-z]+ big"/.test(body), body);
    assert.match(body, /<span class="sw-icon neutral">/);
    assert.ok(body.includes('<div class="race cp-race">\n    <div class="racehead nomenu"><p class="race"><span>Next regular race Thu 19 Nov 19:40</span></p></div>'), body);
    assert.ok(!body.includes('id="race-2026-11-19"') && !body.includes('class="sevline err'), body);
    // the card under that line: "this race", the regular one
    assert.ok(text.includes('No plan for this race yet'));
    // the short copy (user, 19 Nov 2026): what riders get, then the button; at 19:25 the gate (19:10)
    // is past, so riders in the event get a plan within a minute, not "from 19:10" (UI panel, 19 Nov)
    assert.ok(text.includes('No plan for this race yet It is past 19:10 , 30 min before the start: riders in the event get a plan within a minute of it going live. Upload a plan'), text);
    assert.ok(body.includes('It is past <time>19:10</time>, 30 min before the start: riders in the event get a plan within a minute of it going live.'));
    assert.ok(!text.includes('Riders get it from'), text);
    assert.match(body, /<a class="btn primary block" href="\/manage\/upload\?team=sprockets">[\s\S]*?Upload a plan<\/a>/);
    assert.ok(!body.includes('class="actionbar"'));
    assert.ok(!body.includes('class="uplink"') && !body.includes('class="headacts"'), 'the empty card has the button');
    assert.match(body, /<body class="teampage cockpit/);
    assert.ok(!body.includes('class="cp-plan'));
    assert.ok(!body.includes('riders-card') && !body.includes('class="cp-top"'));
    // before the gate: from when riders get it
    srv.clock.now = T('2026-11-19T18:09:00Z');
    assert.ok((await teamBody(srv, 'sprockets')).includes('Riders get it from <time>19:10</time>, 30 min before the start.'));
});


test('team page: no start time, the trap', async t => {
    const c = makeClub({teams: [['Rollers', '19:30'], ['Sprockets', '19:30'], ['Pistons', '20:15'], ['Cogs', null]]});
    upload(c.club, 'sprockets', {type: 'A', riders: ['1008', '1001'], at: T('2026-11-19T16:00:00Z')});
    upload(c.club, 'pistons', {type: 'A', riders: ['1009', '1002'], at: T('2026-11-19T17:30:00Z')});
    upload(c.club, 'cogs', {type: 'B', riders: ['1008', '1009'], at: T('2026-11-19T17:00:00Z')});
    const srv = await serve(t, c, {now: T('2026-11-19T17:12:00Z')});
    const body = await teamBody(srv, 'cogs');
    const callout = element(body, '<section class="callout err"');
    assert.equal(textOf(/<h2[^>]*>([\s\S]*?)<\/h2>/.exec(callout)[1]).trim(), 'No start time: riders on this plan get nothing');
    const text = textOf(callout);
    assert.ok(text.includes('Paceline sends a plan only for a start time. Without one, \'Cogs · B\' goes to nobody.'), text);
    assert.ok(text.includes('Ida rides Sprockets for now; once you set a start time, Ida moves here and Sprockets has a hole.'));
    assert.match(callout, /<a class="btn secondary small" href="\/manage\/team\/cogs\/settings">[\s\S]*?Set the start time<\/a>/);
    assert.ok(!body.includes('class="sevline'), 'the callout is the status');
    assert.ok(!textOf(body).includes('to fix'));
    assert.equal(textOf(/<p class="race">([\s\S]*?)<\/p>/.exec(body)[1]).trim(), 'Thu 19 Nov · no start time');
    assert.match(body, /<span class="tag off">Not sent<\/span>/);
    assert.ok(textOf(body).includes('Rider status shows once the team has a start time and the plan opens, 30 min before the start.'));
    assert.equal(count(ridersCardOf(body), '<td class="n pt-pos">'), 2);
    // without a plan: no rider is affected yet, so the neutral line, no callout (spec §8)
    const none = makeClub({teams: [['Cogs', null]]});
    const srv2 = await serve(t, none, {now: T('2026-11-19T17:12:00Z')});
    const empty = await teamBody(srv2, 'cogs', none.cookie);
    const emptyText = textOf(empty);
    assert.ok(!empty.includes('callout err') && !empty.includes('err-text') && empty.includes('<span class="sw-icon neutral">'), empty);
    assert.ok(empty.includes('<p class="race"><span>No start time set</span></p>'), empty);
    assert.ok(emptyText.includes('Riders get it once the team has a start time.'));
});


test('team page: newer, not live', async t => {
    const c = makeClub();
    const v1 = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    version(c.club, 'rollers', v1, ROLLERS.slice(1), '2026-11-19T15:00:00Z');
    const v3 = version(c.club, 'rollers', v1, ROLLERS.slice(2), '2026-11-19T16:00:00Z', {live: false});
    const srv = await serve(t, c);
    const body = await teamBody(srv, 'rollers');
    // the plan's newest version, stored after the live one went live and never live: its row says so
    // (team cockpit spec §5.6), a link alone like every row: no Make live beside it (user, 23 Nov 2026)
    const newer = element(body, `<li class="cp-row" data-sel="v:${v3}">`);
    assert.ok(newer, body);
    assert.ok(textOf(newer).includes('v3 · not live'), textOf(newer));
    assert.match(newer, /^<li class="cp-row" data-sel="v:[^"]+"><a class="cp-link"[^>]*>[^]*?<\/a><\/li>$/);
    assert.equal(newer.includes('<form'), false);
    assert.ok(element(body, '<section class="cp-plan live"').includes(`data-sel="v:${v3}"`), 'in the live plan');
    // its Make live is in its card's action bar (open the row), and it asks first (Task 8c)
    const ask0 = armOf(element(await (await srv.get(`/manage/team/rollers?v=${v3}`, c.cookie)).text(), '<div class="cp-bar"'));
    assert.ok(textOf(ask0).includes('Make live v3 of \'Rollers · fast\' Riders in the event get \'Rollers · fast\' v3 instead of \'Rollers · fast\' v2 within a minute.'), textOf(ask0));
    assert.ok(armHas(ask0, '/manage/live', `<input type="hidden" name="team" value="rollers"><input type="hidden" name="sheet" value="${v3}"><input type="hidden" name="version" value="${VERSION_OF(srv, 'rollers')}">`, 'btn primary small', 'Make live'), ask0);
    assert.equal(count(body, '<section class="cp-plan'), 1, 'v3 is no other plan');
    // Make v3 live: the notice goes
    const made = await followPost(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: v3, confirm: '1'});
    assert.equal(liveId(srv.store.get(CID), 'rollers'), v3);
    assert.ok(!textOf(made.page).includes('stored 17:00, not live'), textOf(made.page));
    assert.ok(textOf(element(made.page, `<li class="cp-row live picked" data-sel="v:${v3}">`)).includes('v3 · 0/6 have it Live'), textOf(element(made.page, `<li class="cp-row live picked" data-sel="v:${v3}">`)));

    // a newer version that lists a rider who now rides Sprockets: the question says so
    const d = makeClub();
    const d1 = upload(d.club, 'rollers', {type: 'fast', riders: ROLLERS.slice(1), at: T('2026-11-19T14:00:00Z')});
    const d2 = version(d.club, 'rollers', d1, ROLLERS, '2026-11-19T16:00:00Z', {live: false});
    upload(d.club, 'sprockets', {riders: ['1001', '1009'], at: T('2026-11-19T16:30:00Z')});
    const srv2 = await serve(t, d);
    const newer2 = element(await teamBody(srv2, 'rollers', d.cookie), `<li class="cp-row" data-sel="v:${d2}">`);
    assert.ok(textOf(newer2).includes('v2 · not live'), textOf(newer2));
    assert.equal(newer2.includes('<form'), false);
    const ask = armOf(element(await (await srv2.get(`/manage/team/rollers?v=${d2}`, d.cookie)).text(), '<div class="cp-bar"'));
    assert.ok(ask, newer2);
    assert.ok(textOf(ask).includes('Make live v2 of \'Rollers · fast\' Riders in the event get \'Rollers · fast\' v2 instead of \'Rollers · fast\' v1 within a minute. \'Rollers · fast\' v2 still lists Ben, who now rides another team. Make it live anyway?'), textOf(ask));
    assert.ok(ask.includes(`<input type="hidden" name="sheet" value="${d2}"><input type="hidden" name="version" value="${VERSION_OF(srv2, 'rollers')}"><button`), ask);
    assert.ok(/<button class="btn primary small" type="submit" name="confirm" value="1" aria-describedby="arm-[^"]+" data-arm-yes>Make live anyway<\/button>/.test(ask), ask);
});


test('hostile names and types are escaped everywhere', async t => {
    const NAME = '"><img src=x onerror=alert(1)>\'';
    const TYPE = '<b>\'"';
    const RAW = /<img|<b>/;
    const clean = (body, where) => {
        assert.doesNotMatch(body, RAW, where);
    };
    const c = makeClub();
    const srv = await serve(t, c);
    const evil = riders => {
        const json = planJson('Rollers fast', riders);
        json.riders['1001'].name = NAME;
        return json;
    };
    const page = async p => (await srv.get(p)).text();
    // the first version, with the type
    const id1 = await intake(srv, c.cookie, {team: 'rollers', json: evil(ROLLERS)});
    const assign1 = await page(`/manage/team/rollers?e=${id1}`);
    clean(assign1, 'the Store form');
    assert.ok(assign1.includes('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;&#39;'), assign1);
    const r1 = await storePost(srv, c.cookie, id1, {
        team: 'rollers', as: 'new', live: 'on', confirm: '1', type: TYPE, date: DATE, base: String(VERSION_OF(srv, 'rollers')), drawn: 'rollers:new', touched: '', event: '',
    });
    assert.equal(r1.status, 303, r1.body);
    clean(r1.body, 'the Store flash');
    assert.ok(r1.body.includes('&lt;b&gt;&#39;&quot;'), r1.body);
    const plan = liveId(srv.store.get(CID), 'rollers');
    assert.equal(srv.store.get(CID).sheets[plan].type, TYPE);
    // a second version without Ben: the lines name him
    const id2 = await intake(srv, c.cookie, {team: 'rollers', forPlan: plan, json: planJson('Rollers fast', ROLLERS.slice(1))});
    const assign2 = await page(`/manage/team/rollers?e=${id2}`);
    clean(assign2, 'the Store form, second version');
    assert.ok(assign2.includes('&lt;b&gt;&#39;&quot;'), assign2);
    assert.ok(assign2.includes('&lt;img'), assign2);
    const r2 = await storePost(srv, c.cookie, id2, {
        team: 'rollers', as: plan, live: 'on', confirm: '1', base: String(VERSION_OF(srv, 'rollers')), drawn: `rollers:${plan}`, touched: '', event: '',
    });
    assert.equal(r2.status, 303, r2.body);
    clean(r2.body, 'the Store flash, second version');
    assert.ok(r2.body.includes('&lt;img'), r2.body);
    for (const p of ['/manage/team/rollers', `/manage/team/rollers?v=${plan}`, '/manage', '/manage/team/rollers/settings']) {
        const body = await page(p);
        clean(body, p);
        assert.equal(body.includes('&lt;b&gt;'), !p.endsWith('/settings'), p);
    }
    for (const p of ['/manage/team/rollers', `/manage/team/rollers?v=${plan}`]) {
        assert.ok((await page(p)).includes('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;&#39;'), p);
    }
    // the discard flash names the riders
    const id3 = await intake(srv, c.cookie, {team: 'rollers', json: evil(['1001', '1002'])});
    // its question (without the script) too
    const asked = await post(srv, c.cookie, `/manage/inbox/${id3}/discard`, {back: '/manage/team/rollers'});
    assert.equal(asked.status, 200);
    clean(asked.body, 'discard question');
    assert.ok(asked.body.includes('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;&#39;'), asked.body);
    const gone = await followPost(srv, c.cookie, `/manage/inbox/${id3}/discard`, {back: '/manage/team/rollers', confirm: '1'});
    assert.equal(gone.flash.text, `Discarded the plan with 2 riders (${NAME}, Cleo).`);
    clean(gone.page, 'discard flash');
});


test('team settings: the delete text counts plans, not versions', async t => {
    const c = makeClub();
    const fast = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    version(c.club, 'rollers', fast, ROLLERS.slice(1), '2026-11-19T15:00:00Z');
    upload(c.club, 'rollers', {type: 'slow', riders: ['1001'], at: T('2026-11-19T14:10:00Z'), live: false});
    const srv = await serve(t, c);
    const body = await pageBody(srv, '/manage/team/rollers/settings');
    assert.equal(Object.keys(srv.store.get(CID).sheets).length, 3);
    assert.ok(textOf(armOf(body, '/manage/team', body.indexOf('class="danger-zone"'))).includes('Deletes Rollers and its 2 plans.'), body);
});


test('team page: switcher and sidebar list every team', async t => {
    const c = makeClub({teams: [['Cranks', null], ['Sprockets', '19:40'], ['Rollers', '19:30'], ['Axles', '19:40']]});
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const body = await teamBody(srv, 'rollers');
    const lists = elements(body, '<ul class="trows">');
    assert.equal(lists.length, 2);
    for (const list of lists) {
        const links = [...list.matchAll(/<a class="trow (ok|neutral|warn|err)" href="\/manage\/team\/([a-z0-9-]+)"( aria-current="page")?>/g)];
        assert.deepEqual(links.map(m => m[2]), ['rollers', 'axles', 'sprockets', 'cranks'], list);
        assert.deepEqual(links.map(m => Boolean(m[3])), [true, false, false, false]);
        // Axles and Sprockets have no plan, Cranks no start time and no plan: neutral (spec §8)
        assert.deepEqual(links.map(m => m[1]), ['neutral', 'neutral', 'neutral', 'neutral']);
    }
    // the team's row in the switcher and the sidebar; no breadcrumb: the sidebar names club and team
    assert.equal(count(body, 'aria-current="page"'), 2);
    assert.equal(count(body, 'class="crumbs'), 0);
    assert.ok(!body.includes('<select'));
    const sw = element(body, '<details class="switch"');
    assert.ok(textOf(sw).includes('Kettenfett RC · Thu 19 Nov'), textOf(sw));
    // the switcher leads to all teams; Club settings is no longer in it (the overview has it)
    assert.match(sw, /<p class="switch-foot"><a href="\/manage">All teams<\/a><\/p>/);
    assert.ok(!sw.includes('/manage/settings') && !sw.includes('Club settings'), sw);
    assert.ok(textOf(sw).includes('Rollers 19:30 · in 5 min 0 of 8 riders have the plan Axles 19:40 · in 15 min Next regular race Thu 19 Nov 19:40'), textOf(sw));
    const side = element(body, '<aside class="side"');
    assert.match(side, /<p class="side-club"><a href="\/manage">[\s\S]*?Kettenfett RC<\/a><\/p>/);
    assert.ok(!side.includes('/manage/settings') && !side.includes('Club settings'), side);
    assert.match(body, /<a class="back" href="\/manage" aria-label="All teams">/);
    // the summary: the team's worst state and its short line
    assert.equal(textOf(/<summary>([\s\S]*?)<\/summary>/.exec(body)[1]).trim(), 'Rollers 0 of 8');
    // a club without a team that races: the head is just the club
    const lone = makeClub({teams: [['Cogs', null]]});
    const srv2 = await serve(t, lone);
    const head = /<p class="switch-head">([^<]*)<\/p>/.exec(await teamBody(srv2, 'cogs', lone.cookie))[1];
    assert.equal(head, 'Kettenfett RC');
});


// The desktop UI audit (18 Nov 2026): every captain page has the same frame, the sidebar beside the
// page (ui.mjs captainPage), the current place marked in it: the overview's club name, the team's row
// on its page and every page below it; nothing on the club settings and the rider code (Club
// settings left the sidebar, 18 Nov 2026: the overview's button leads there). The
// phone's top bar (team switcher, back bar) is the frame's first child, and the stylesheet hides it
// from 1024 px (the breadcrumb takes the back bar's place, UI panel wave 3); the page's own footer
// too, the sidebar has it.
test('captain frame: the sidebar on every captain page, the current place marked', async t => {
    const c = makeClub();
    const v1 = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS.slice(0, 6), at: T('2026-11-19T14:00:00Z')});
    version(c.club, 'rollers', v1, ROLLERS.slice(1, 7), '2026-11-19T15:00:00Z');
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ROLLERS.slice(0, 6), at: T('2026-11-19T15:10:00Z'), live: false});
    const plan = c.club.sheets[v1].plan;
    const srv = await serve(t, c, {env: {CODE_SECRET}});
    const entry = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS.slice(0, 5))});
    const get = async (p, status = 200) => {
        const res = await srv.get(p, c.cookie);
        const body = await res.text();
        assert.equal(res.status, status, `${p}: ${body}`);
        return body;
    };
    const answer = async (p, fields) => {
        const res = await post(srv, c.cookie, p, fields);
        assert.equal(res.status, 200, `${p}: ${res.body}`);
        return res.body;
    };
    const TEAM = '/manage/team/rollers';
    // [what, body, the marked href, the phone's bar: 'switch', 'back' or none]
    const pages = [
        ['overview', await get('/manage'), '/manage', null],
        ['team page', await get(TEAM), TEAM, 'switch'],
        ['team page, a version picked', await get(`${TEAM}?v=${v1}`), TEAM, 'switch'],
        ['team page, a plan not stored yet picked', await get(`${TEAM}?e=${entry}`), TEAM, 'switch'],
        ['team settings', await get(`${TEAM}/settings`), TEAM, 'back'],
        ['upload page', await get('/manage/upload?team=rollers'), TEAM, 'back'],
        ['new team', await get('/manage/new-team'), '/manage', 'back'],
        ['club settings', await get('/manage/settings'), null, 'back'],
        ['team gone', await get('/manage/team/nope', 404), '/manage', 'back'],
        ['entry gone', await get('/manage/inbox/zzzzzz', 404), '/manage', 'back'],
        ['live confirm', await answer('/manage/live', {team: 'rollers', sheet: slow}), TEAM, null],
        ['team page, the Store flash', await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS.slice(0, 4))}, {as: plan, live: 'on'}), TEAM, 'switch'],
        ['rider code', await answer('/manage/code', {action: 'on', confirm: '1'}), null, null],
    ];
    for (const [what, body, here, bar] of pages) {
        assert.equal(count(body, '<div class="app">'), 1, what);
        assert.equal(count(body, '<aside class="side"'), 1, what);
        const side = element(body, '<aside class="side"');
        // the overview and a team page are the place itself (aria-current "page"); a page below one
        // is only there ("location": its breadcrumb's last crumb is the page, review M1)
        const mark = what === 'overview' || what.startsWith('team page') ? 'page' : 'location';
        // the club (its back chevron everywhere but on the overview, where it is the page), the
        // teams in start time order, the footer; no Club settings
        assert.match(side, what === 'overview' ? /<p class="side-club"><a href="\/manage" aria-current="page">Kettenfett RC<\/a><\/p>/
            : here === '/manage' ? /<p class="side-club"><a href="\/manage" aria-current="location"><svg[^>]*>[\s\S]*?<\/svg>Kettenfett RC<\/a><\/p>/
            : /<p class="side-club"><a href="\/manage"><svg[^>]*>[\s\S]*?<\/svg>Kettenfett RC<\/a><\/p>/, what);
        assert.deepEqual([...side.matchAll(/<a class="trow \w+" href="\/manage\/team\/([a-z0-9-]+)"/g)].map(m => m[1]), ['rollers', 'sprockets'], what);
        assert.ok(!side.includes('/manage/settings') && !side.includes('Club settings') && !side.includes('side-foot'), `${what}: ${side}`);
        const foot = element(side, '<footer class="foot">');
        assert.ok(foot.includes('<a href="/privacy">Privacy</a>') && foot.includes(`<form method="post" action="/manage/logout">${CLUB_FIELD}`), `${what}: ${foot}`);
        // one place marked, the right one
        const marked = [...side.matchAll(/<a (?:class="trow \w+" )?href="([^"]+)" aria-current="(page|location)">/g)].map(m => [m[1], m[2]]);
        assert.deepEqual(marked, here === null ? [] : [[here, mark]], what);
        // the frame: the phone's bar first, then the sidebar, then the page
        const frame = body.slice(body.indexOf('<div class="app">'));
        if (bar === 'switch') {
            assert.ok(frame.startsWith('<div class="app">\n<nav class="topbar" aria-label="Teams">'), what);
        } else if (bar === 'back') {
            assert.ok(frame.startsWith('<div class="app">\n<nav class="topbar plain" aria-label="Back">'), what);
        } else {
            assert.ok(frame.startsWith('<div class="app">\n<aside class="side"'), what);
        }
        assert.equal(count(body, '<nav class="topbar'), bar === null ? 0 : 1, what);
        assert.ok(frame.indexOf('<aside class="side"') < frame.indexOf('<main class="page'), what);
    }
    // the first run of a club without teams: the club name marked, no team rows
    const lone = makeClub({teams: []});
    const srv2 = await serve(t, lone);
    const first = await (await srv2.get('/manage', lone.cookie)).text();
    const side = element(first, '<aside class="side"');
    assert.match(first, /<body class="firstrun"/);
    assert.ok(side.includes('<a href="/manage" aria-current="page">') && !side.includes('<a class="trow '), side);
    // the stylesheet: the sidebar only from 1024 px, where the phone's top bar (the team switcher and
    // the back bar alike) and the page's own footer go; a page below the overview has its breadcrumb
    // there instead of the back bar and the kicker (UI panel wave 3; the breadcrumb test)
    const desk = /@media \(min-width:1024px\)\{([\s\S]*?)\n\}/.exec(APP_CSS)[1];
    assert.ok(APP_CSS.includes('\n.side{display:none}\n'), 'no sidebar on phones');
    assert.ok(desk.includes('\n  .app>.topbar,.app>.page>.foot{display:none}\n'), desk);
    assert.ok(desk.includes('\n  .app .crumbs~.pagehead .kicker{display:none}\n'), desk);
    assert.ok(desk.includes('\n  .app{display:grid;grid-template-columns:18.5rem minmax(0,1fr);grid-template-rows:auto 1fr;'), desk);
    assert.ok(desk.includes('.side{display:flex;flex-direction:column;grid-column:1;grid-row:1 / -1;'), desk);
    assert.match(desk, /\n  \.app>\.page\{grid-column:2;grid-row:2;/);
    assert.ok(desk.includes('\n  .side{display:flex;'), desk);
    assert.ok(!APP_CSS.includes('side-foot'), 'no Club settings entry left in the sidebar\'s style');
    assert.ok(APP_CSS.includes('@media (max-width:1023.98px){.desk{display:none!important}}'), 'the desktop title and kickers stay off phones');
});


test('team page: names are escaped', async t => {
    const EVIL = '<img src=x onerror=alert(1)>';
    const ESC = '&lt;img src=x onerror=alert(1)&gt;';
    const c = makeClub({name: EVIL, teams: [[EVIL, '19:30']]});
    const [slug] = c.slugs;
    const json = planJson(EVIL, ROLLERS);
    json.riders['1001'].name = EVIL;
    upload(c.club, slug, {json, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const body = await teamBody(srv, slug);
    assert.ok(!body.includes('<img'), 'no raw tag');
    // club (switcher, sidebar), team (title, rows), label (plan row, its Make live, the riders
    // heading), rider (riders); the "…" menu's two moved to the plan page (Task 8c)
    assert.ok(count(body, ESC) >= 8, String(count(body, ESC)));
    assert.ok(body.includes(`<h1>${ESC}</h1>`));
    assert.ok(ridersCardOf(body).includes(`<span class="pt-nm">${ESC}</span>`));
    // its plan has no type: the page names the team once, the plan's head reads "Plan" (user, 23 Nov 2026)
    assert.ok(body.includes('<span class="label">Plan</span>'));
    assert.ok(body.includes('Riders on &#39;Plan&#39; v1'));
    const live = liveId(srv.store.get(CID), slug);
    const picked = await (await srv.get(`/manage/team/${slug}?v=${live}`)).text();
    assert.ok(!picked.includes('<img'), 'no raw tag with the version picked');
    assert.ok(picked.includes(`Delete &#39;${ESC}&#39;`), picked);
    assert.ok(element(picked, '<div id="panel-body"').includes(`<span class="pt-nm">${ESC}</span>`), picked);
    assert.ok(body.includes(`<p class="switch-head">${ESC} · Thu 19 Nov</p>`));
});


test('team page: unknown team', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    for (const p of ['/manage/team/gone', '/manage/team/__proto__', '/manage/team/constructor', '/manage/team/%E0%A4%A', '/manage/team/']) {
        const res = await srv.get(p);
        assert.equal(res.status, 404, p);
        assert.match(res.headers.get('content-type'), /^text\/html/, p);
        const body = await res.text();
        assert.ok(body.includes('This team no longer exists.'), p);
        assert.ok(body.includes('href="/manage"'), p);
        assert.ok(!body.includes('http-equiv'), p);
    }
    const anon = await srv.get('/manage/team/rollers', null);
    assert.equal(anon.status, 303);
    assert.equal(anon.headers.get('location'), '/');
    // GET only
    const res = await post(srv, c.cookie, '/manage/team/rollers');
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'GET');
});


test('team actions answer 303 to the team page', async t => {
    const c = makeClub();
    const fast = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ['1001', '1002', '1003'], at: T('2026-11-19T14:10:00Z'), live: false});
    upload(c.club, 'sprockets', {riders: ['1001', '1009'], at: T('2026-11-19T16:30:00Z')});
    const srv = await serve(t, c);
    const live = await followPost(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: slow, confirm: '1'});
    // the 303 lands on the panel of the version live now (team cockpit spec §5.3)
    assert.equal(live.location, `/manage/team/rollers?r=${DATE}#panel`);
    assert.deepEqual(live.flash, {kind: 'ok', text: '\'Rollers · slow\' v1 is live for Rollers. Still to do: Rollers'});
    assert.ok(live.page.includes('<h1>Rollers</h1>'));
    // a change of the live plan: its flash (no Undo, user 23 Nov 2026) sits in the panel's slot right
    // above the card of the version (team cockpit spec §5.3b), not at the top of the page
    const head = element(live.page, '<div id="panel"');
    // the card's head first (the title and the sheet's close ×), then the message under it in the same head, with its own ×
    // (user, 24 Nov 2026: below 1180 px it is in the flow under the title, from there it floats over the card)
    assert.match(head, new RegExp(`^<div id="panel" data-kind="version" data-sel="v:${slow}" tabindex="-1"><div class="cp-top"><div class="cp-head"><h2 class="cp-title" id="panel-h">[^]*?<\\/h2><a class="cp-close"[^]*?<\\/a><\\/div><p class="cp-meta">[^]*?<\\/p><div class="cp-note" data-auto-close="6000"><div class="flash ok" role="status"><svg class="i" [^>]*><circle cx="12" cy="12" r="9"\\/><path d="m8 12.5 2.8 2.8L16 9.5"\\/><\\/svg><p>[^]*?<\\/p><\\/div><a class="cp-note-x" href="\\/manage\\/team\\/rollers\\?r=${DATE}" aria-label="Close message" data-note-close>[^]*?<\\/a><\\/div><\\/div><\\/div>$`));
    assert.equal(count(live.page, 'class="flash'), 1, 'one flash, in the panel');
    // the message floats over the card from 1180 px, in a box of its own with a close link to the page's own URL
    // (the page without the one-shot message); the page's data-here is that URL; the card's own close link is another
    assert.ok(live.page.includes(`data-here="/manage/team/rollers?r=${DATE}"`) && head.includes(`<a class="cp-note-x" href="/manage/team/rollers?r=${DATE}"`), head);
    assert.equal(count(live.page, 'data-note-close'), 1);
    // a refusal: its flash in the panel's head too, under the fresh line and before the list
    const refused = await post(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: fast, version: '1', confirm: '1'});
    assert.equal(refused.status, 409, refused.body);
    assert.ok(element(refused.body, '<div id="panel"').includes('class="flash err"'), refused.body);
    assert.ok(refused.body.indexOf('class="flash err"') > refused.body.indexOf('class="fresh"'), refused.body);
    assert.ok(refused.body.indexOf('class="flash err"') < refused.body.indexOf('class="cp-list"'), refused.body);
    // back to 'Rollers · fast': Make live of the plan that was live before
    const back = await followPost(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: fast, confirm: '1'});
    assert.equal(back.location, `/manage/team/rollers?r=${DATE}#panel`);
    assert.equal(liveId(srv.store.get(CID), 'rollers'), fast);

    const del = await followPost(srv, c.cookie, '/manage/sheet/delete', {team: 'rollers', sheet: slow, confirm: '1'});
    assert.equal(del.location, '/manage/team/rollers');
    assert.deepEqual(del.flash, {kind: 'ok', text: 'Deleted \'Rollers · slow\' with its versions.'});
});


// A new version of the plan `as` names (any of its ids), live when `live`: the version id.
function version(club, slug, as, riders, at, {live = true, bench = []} = {}) {
    return uploadSheet(club, {
        slug, json: planJson('Rollers fast', riders, bench), text: null, base: club.teams[slug].version, via: 'file',
        as, live, pinnedEventId: null,
    }, {now: T(at), newId: () => randomId(6)}).id;
}



test('old pages: undo answers 303 out of date (the old Undo, and the Undo of a Make live, gone on 23 Nov 2026)', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const file = storedClub(srv);
    for (const [path, extra] of [['/manage/undo', {}], ['/manage/live/undo', {confirm: '1'}]]) {
        const res = await followPost(srv, c.cookie, path, {team: 'rollers', version: String(VERSION_OF(srv, 'rollers')), ...extra});
        assert.equal(res.location, '/manage/team/rollers', path);
        assert.deepEqual(res.flash, {kind: 'err', text: 'This page was out of date. Nothing was changed.'}, path);
        const gone = await followPost(srv, c.cookie, path, {team: 'gone', version: '1', ...extra});
        assert.equal(gone.location, '/manage', path);
        assert.deepEqual(gone.flash, {kind: 'err', text: 'This page was out of date. Nothing was changed.'}, path);
    }
    assert.equal(storedClub(srv), file);
});


// The plan ids of Rollers.
const plansOfRollers = srv => [...new Set(Object.values(srv.store.get(CID).sheets).filter(s => s.team === 'rollers').map(s => s.plan))];


test('delete confirms say that recorded versions stay', async t => {
    const KEPT = 'Versions used in a ride recording stay with it for analysis';
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    upload(c.club, 'rollers', {type: 'slow', riders: ['1001'], at: T('2026-11-19T14:10:00Z'), live: false});
    const srv = await serve(t, c);
    // Delete plan is in each plan's ⋯, in its block on the team page (races Task 6)
    const team = await teamBody(srv, 'rollers');
    const confirms = plansOfRollers(srv).map(p => armOf(element(team, '<section class="cp-plan', team.indexOf(` id="plan-${p}"`) - 30), '/manage/sheet/delete'));
    assert.equal(confirms.filter(Boolean).length, 2, 'the live plan\'s and the other plan\'s');
    for (const cf of confirms) {
        assert.ok(textOf(cf).includes(KEPT), textOf(cf));
    }
    // a plan just stored: its ⋯ says the same (the Store flash has no Delete, team cockpit spec §4.1)
    const result = await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers spare', ['1009'])}, {as: 'new', live: '', type: 'spare', date: DATE});
    assert.equal(element(result, '<div id="panel"').includes('/manage/sheet/delete'), false);
    const spare = Object.entries(srv.store.get(CID).sheets).find(([, s]) => s.type === 'spare')[0];
    const del = armOf(element(result, `<section class="cp-plan" id="plan-${spare}"`), '/manage/sheet/delete');
    assert.ok(del, result);
    assert.ok(textOf(del).includes(`Deletes the plan with all its versions. This cannot be undone. ${KEPT} (90 days by default).`), textOf(del));
    const settings = await (await srv.get('/manage/team/rollers/settings')).text();
    assert.ok(textOf(armOf(settings, '/manage/team', settings.indexOf('class="danger-zone"'))).includes(KEPT));
    for (const key of ['ts-delete-body', 'ts-delete-body-one', 'ts-delete-body-none', 'tp-delete-live', 'tp-delete-other']) {
        assert.ok(COPY[key].endsWith(`${KEPT} (90 days by default).`), key);
    }
});


test('team action refusals answer the team page', async t => {
    const c = makeClub();
    const fast = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers new', ROLLERS.slice(0, 6))}, {as: 'new', live: 'on', date: DATE});
    const stale = await post(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: fast, version: VERSION_OF(srv, 'rollers') - 1, confirm: '1'});
    assert.equal(stale.status, 409, stale.body);
    assert.deepEqual(flashOf(stale.body), {kind: 'err', text: 'Rollers changed since you opened the page. Nothing was changed.'});
    assert.ok(stale.body.includes('<h1>Rollers</h1>'), 'the team page');
    // inside the refresh window, a refusal never reloads (it would GET the POST's URL)
    assert.ok(!stale.body.includes('http-equiv'));
    assert.ok(!stale.body.includes('data-refresh'));
    const gone = await post(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: 'zzzzzz'});
    assert.equal(gone.status, 400);
    assert.deepEqual(flashOf(gone.body), {kind: 'err', text: 'This team or plan no longer exists. Nothing was changed.'});
    assert.ok(gone.body.includes('<h1>Rollers</h1>'));
    // another team's plan: that team's page
    const other = await post(srv, c.cookie, '/manage/sheet/delete', {team: 'sprockets', sheet: fast});
    assert.equal(other.status, 400);
    assert.ok(other.body.includes('<h1>Sprockets</h1>'));
    // a team that is gone: the team-gone page with the refusal
    for (const fields of [{team: 'gone', sheet: fast}, {team: '__proto__', sheet: fast}, {}]) {
        const res = await post(srv, c.cookie, '/manage/live', fields);
        assert.equal(res.status, 400, JSON.stringify(fields));
        assert.ok(res.body.includes('This team no longer exists.'), res.body);
        assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'This team or plan no longer exists. Nothing was changed.'});
    }
});


test('two tabs: a flash for another page stays', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ROLLERS.slice(0, 7), at: T('2026-11-19T14:10:00Z'), live: false});
    const srv = await serve(t, c);
    const res = await post(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: slow, confirm: '1'});
    assert.equal(res.status, 303, res.body);
    assert.equal(res.headers.get('location'), `/manage/team/rollers?r=${DATE}#panel`);
    const pair = res.headers.getSetCookie()[0].split(';')[0];
    const cookie = `${c.cookie}; ${pair}`;
    const sprockets = await srv.get('/manage/team/sprockets', cookie);
    assert.equal(sprockets.status, 200);
    assert.deepEqual(sprockets.headers.getSetCookie(), [], 'the cookie stays');
    assert.equal(flashOf(await sprockets.text()), null);
    const rollers = await srv.get('/manage/team/rollers', cookie);
    assert.deepEqual(rollers.headers.getSetCookie(), [FLASH_CLEARED]);
    assert.deepEqual(flashOf(await rollers.text()), {kind: 'ok', text: '\'Rollers · slow\' v1 is live for Rollers.'});
    // once
    const again = await srv.get('/manage/team/rollers', cookie);
    assert.equal(flashOf(await again.text()), null);
    // a HEAD takes nothing
    const head = await fetch(srv.base + '/manage/team/rollers', {method: 'HEAD', redirect: 'manual', headers: {cookie}});
    assert.equal(head.status, 200);
});


// The page at `p` after a 200.
async function pageBody(srv, p, cookie) {
    const res = await srv.get(p, cookie);
    const body = await res.text();
    assert.equal(res.status, 200, `${p}: ${body}`);
    return body;
}

// The team page with inbox entry `id` picked (its Store form, the assign page's place since the team
// cockpit), `query` the form's fields as a redraw sends them ('?…' or ''), after a 200.
async function storeFormOf(srv, id, query = '', cookie) {
    const entry = srv.store.get(CID).inbox.find(e => e.id === id);
    assert.ok(entry, id);
    return pageBody(srv, `/manage/team/${entry.team}?e=${id}${query.replace(/^\?/, '&')}`, cookie);
}

// The form that posts `action` to /manage/team (its hidden action field), whole.
function teamForm(body, action) {
    const at = body.indexOf(`<input type="hidden" name="action" value="${action}">`);
    assert.ok(at >= 0, `form ${action}`);
    const start = body.lastIndexOf('<form', at);
    return body.slice(start, body.indexOf('</form>', at) + '</form>'.length);
}


test('team settings page: name, start time, delete; never reloads', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z'), pinned: 4567890});
    upload(c.club, 'rollers', {type: 'slow', riders: ['1001', '1002'], at: T('2026-11-19T14:10:00Z'), live: false});
    upload(c.club, 'sprockets', {riders: ['1009'], at: T('2026-11-19T16:30:00Z')});
    const srv = await serve(t, c);
    // inside the refresh window: the team page reloads itself, its settings never
    assert.ok((await pageBody(srv, '/manage/team/rollers')).includes('http-equiv="refresh"'));
    const body = await pageBody(srv, '/manage/team/rollers/settings');
    const text = textOf(body);
    assert.ok(!body.includes('http-equiv'));
    assert.ok(!body.includes('data-refresh'));
    assert.ok(body.includes('<a class="back" href="/manage/team/rollers">'), 'back to the team page');
    assert.ok(body.includes('<p class="kicker keep">Team settings</p><h1>Rollers</h1>'), body);
    // name
    const rename = teamForm(body, 'rename');
    assert.ok(rename.includes('<input type="hidden" name="team" value="rollers">'), rename);
    assert.ok(rename.includes('name="name" value="Rollers"'), rename);
    // the card's one Save, its main action (UI panel wave 3, one button system)
    assert.ok(rename.includes('<button class="btn primary" type="submit">Save name</button>'), rename);
    assert.ok(text.includes('Riders see it at their next check; plans stay.'));
    // race day and time: the start time in the one card, with the club's zone beside it
    const start = teamForm(body, 'rhythm');
    assert.ok(start.includes('<input type="hidden" name="team" value="rollers">'), start);
    assert.ok(start.includes('<input type="time" name="start" value="19:30">'), start);
    assert.ok(textOf(start).includes('Save race day and time'));
    // the hint under the field: the club's zone, when riders get the plan, a race's own time (user, 22 Nov 2026)
    assert.ok(start.includes('<input type="time" name="start" value="19:30"><span class="hint">In Europe/Berlin. New races start at this time.</span></label>'), start);
    assert.ok(!textOf(start).includes('You can set it later'), textOf(start));
    // no event links: a race's link is in its ⋯ on the team page now (races spec §7)
    assert.ok(!body.includes('id="link-h"') && !body.includes('/manage/sheet/unpin'), body);
    // delete behind an in-page confirm, with the plan count
    const confirm = armOf(body, '/manage/team', body.indexOf('class="danger-zone"'));
    assert.ok(textOf(body).includes('Delete Rollers Delete team…'), 'the danger zone');
    assert.ok(textOf(confirm).includes('Deletes Rollers and its 2 plans. Riders get nothing from it any more. Plans waiting from ZwiftGopher go too. This cannot be undone. Recordings stay until they expire. '
        + 'Versions used in a ride recording stay with it for analysis (90 days by default).'), confirm);
    const del = teamForm(confirm, 'delete');
    assert.ok(del.includes('<input type="hidden" name="team" value="rollers">'), del);
    assert.ok(textOf(del).includes('Delete Rollers'));

    // a team with one plan
    const sp = await pageBody(srv, '/manage/team/sprockets/settings');
    assert.ok(!sp.includes('action="/manage/sheet/unpin"'));
    assert.ok(textOf(sp).includes('Deletes Sprockets and its plan. Riders get nothing'), textOf(sp));
    // a team without plans
    await followPost(srv, c.cookie, '/manage/team', {action: 'add', name: 'Cogs', start: ''});
    const cogs = await pageBody(srv, '/manage/team/cogs/settings');
    assert.ok(cogs.includes('<input type="time" name="start" value="">'));
    assert.ok(textOf(cogs).includes('Deletes Cogs. It has no plans; plans waiting from ZwiftGopher go too. This cannot be undone.'), textOf(cogs));

    // a team that does not exist: the team-gone page
    for (const p of ['/manage/team/gone/settings', '/manage/team/__proto__/settings', '/manage/team//settings', '/manage/team/%E0%A4%A/settings']) {
        const res = await srv.get(p);
        assert.equal(res.status, 404, p);
        assert.ok((await res.text()).includes('This team no longer exists.'), p);
    }
    // GET only; signed out to the start page
    const res = await post(srv, c.cookie, '/manage/team/rollers/settings');
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'GET');
    const anon = await srv.get('/manage/team/rollers/settings', null);
    assert.equal(anon.status, 303);
    assert.equal(anon.headers.get('location'), '/');
});


test('new team page: the form, never reloads', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const body = await pageBody(srv, '/manage/new-team');
    assert.ok(!body.includes('http-equiv'));
    assert.ok(!body.includes('data-refresh'));
    assert.ok(body.includes('<a class="back" href="/manage">'), body);
    assert.ok(body.includes('<h1>Add a team</h1>'));
    const form = teamForm(body, 'add');
    assert.ok(/<input name="name" value="" maxlength="40" required/.test(form), form);
    assert.ok(form.includes('<input type="time" name="start" value="">'), form);
    assert.ok(textOf(form).includes('Team name'));
    assert.ok(textOf(form).includes('Start time In Europe/Berlin. You can set it later, but riders get nothing without one.'), textOf(form));
    assert.ok(textOf(form).includes('Add the team'));
    const res = await post(srv, c.cookie, '/manage/new-team');
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'GET');
});


test('team settings actions answer 303 to their pages', async t => {
    const c = makeClub();
    const fast = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z'), pinned: 4567890});
    const srv = await serve(t, c);
    const team = fields => followPost(srv, c.cookie, '/manage/team', fields);
    let res = await team({action: 'start', team: 'rollers', start: '19:45'});
    assert.equal(res.location, '/manage/team/rollers/settings');
    assert.deepEqual(res.flash, {kind: 'ok', text: 'Start time of Rollers: 19:45. Races already planned keep their time; change one in its ⋯.'});
    assert.ok(res.page.includes('<p class="kicker keep">Team settings</p>'));
    assert.ok(res.page.includes('value="19:45"'));
    res = await team({action: 'rename', team: 'rollers', name: 'Rollers Elite'});
    assert.equal(res.location, '/manage/team/rollers/settings');
    assert.deepEqual(res.flash, {kind: 'ok', text: 'Renamed to Rollers Elite.'});
    // unpin from the settings goes back there, from the team page to the team page
    res = await followPost(srv, c.cookie, '/manage/sheet/unpin', {team: 'rollers', sheet: fast, back: 'team-settings'});
    assert.equal(res.location, '/manage/team/rollers/settings');
    // the rename relabels the stored versions
    assert.deepEqual(res.flash, {kind: 'ok', text: 'Removed the event link of \'Rollers Elite · fast\'.'});
    // no Undo: the link comes back only with a Store; here it is set again directly
    const repin = () => srv.store.change(CID, x => {
        race(x, 'rollers', DATE).pinnedEventId = 4567890;
    });
    repin();
    res = await followPost(srv, c.cookie, '/manage/sheet/unpin', {team: 'rollers', sheet: fast});
    assert.equal(res.location, '/manage/team/rollers');
    // any other back is the team page
    repin();
    res = await followPost(srv, c.cookie, '/manage/sheet/unpin', {team: 'rollers', sheet: fast, back: 'settings'});
    assert.equal(res.location, '/manage/team/rollers');
    res = await team({action: 'add', name: 'Cranks', start: ''});
    assert.equal(res.location, '/manage/team/cranks');
    assert.deepEqual(res.flash, {kind: 'ok', text: 'Added Cranks.'});
    res = await team({action: 'delete', team: 'rollers', confirm: '1'});
    assert.equal(res.location, '/manage');
    assert.deepEqual(res.flash, {kind: 'ok', text: 'Deleted Rollers Elite and its plans.'});
});


test('team settings refusals keep what was typed', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    const team = fields => post(srv, c.cookie, '/manage/team', fields);
    const long = 'x'.repeat(41);
    let res = await team({action: 'rename', team: 'rollers', name: long});
    assert.equal(res.status, 400);
    assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'Use at most 40 characters, without control characters or invisible spaces.'});
    assert.ok(res.body.includes('<p class="kicker keep">Team settings</p><h1>Rollers</h1>'), res.body);
    assert.ok(teamForm(res.body, 'rename').includes(`value="${long}"`));
    // the other form keeps the stored value
    assert.ok(teamForm(res.body, 'rhythm').includes('value="19:30"'));
    assert.ok(!res.body.includes('http-equiv') && !res.body.includes('data-refresh'));
    res = await team({action: 'start', team: 'rollers', start: '25:00'});
    assert.equal(res.status, 400);
    assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'Enter the start time as HH:MM.'});
    assert.ok(teamForm(res.body, 'rhythm').includes('value="25:00"'));
    assert.ok(teamForm(res.body, 'rename').includes('value="Rollers"'));
    assert.equal(srv.store.get(CID).teams.rollers.start, '19:30');
    res = await team({action: 'add', name: 'Bad​name', start: '20:15'});
    assert.equal(res.status, 400);
    assert.equal(flashOf(res.body).kind, 'err');
    assert.ok(res.body.includes('<h1>Add a team</h1>'), res.body);
    assert.ok(teamForm(res.body, 'add').includes('value="Bad​name"'));
    assert.ok(teamForm(res.body, 'add').includes('value="20:15"'));
    // a name with markup comes back escaped
    res = await team({action: 'add', name: '<b>"x"</b>', start: '7pm'});
    assert.equal(res.status, 400);
    assert.ok(teamForm(res.body, 'add').includes('value="&lt;b&gt;&quot;x&quot;&lt;/b&gt;"'), res.body);
    // the 21st delete of a day: on the team's settings
    for (let i = 0; i < 20; i++) {
        const added = await followPost(srv, c.cookie, '/manage/team', {action: 'add', name: 'Temp', start: ''});
        assert.equal((await team({action: 'delete', team: added.location.split('/').pop(), confirm: '1'})).status, 303);
    }
    res = await team({action: 'delete', team: 'rollers', confirm: '1'});
    assert.equal(res.status, 429, res.body);
    assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'Too many team deletions today. Try again tomorrow.'});
    assert.ok(res.body.includes('<p class="kicker keep">Team settings</p><h1>Rollers</h1>'));
    assert.ok(Object.hasOwn(srv.store.get(CID).teams, 'rollers'));
});


test('slugs new and settings', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    for (const name of ['New', 'Settings']) {
        await followPost(srv, c.cookie, '/manage/team', {action: 'add', name, start: '20:00'});
    }
    const teams = srv.store.get(CID).teams;
    assert.equal(teams.new.name, 'New');
    assert.equal(teams.settings.name, 'Settings');
    const h1 = body => /<h1[^>]*>([^<]*)<\/h1>/.exec(body)[1];
    const kicker = body => /<p class="kicker(?: keep)?">([^<]*)<\/p>/.exec(body)?.[1] ?? null;
    let body = await pageBody(srv, '/manage/team/new');
    assert.equal(h1(body), 'New');
    body = await pageBody(srv, '/manage/team/settings');
    assert.equal(h1(body), 'Settings');
    // (a team's settings: the team's name as the title, "Team settings" above it; user, 23 Nov 2026)
    body = await pageBody(srv, '/manage/team/settings/settings');
    assert.equal(h1(body), 'Settings');
    assert.equal(kicker(body), 'Team settings');
    body = await pageBody(srv, '/manage/new-team');
    assert.equal(h1(body), 'Add a team');
    body = await pageBody(srv, '/manage/team/new/settings');
    assert.equal(h1(body), 'New');
    assert.equal(kicker(body), 'Team settings');
    // the club settings next to a team called Settings
    body = await pageBody(srv, '/manage/settings');
    assert.equal(h1(body), 'Club settings');
    assert.ok(body.includes('<form class="stack" method="post" action="/manage/club">'));
    body = await pageBody(srv, '/manage/team/settings/settings');
    assert.equal(h1(body), 'Settings');
    assert.equal(kicker(body), 'Team settings');
});


test('live confirm page', async t => {
    const c = makeClub();
    const fast = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ['1001', '1002', '1003'], at: T('2026-11-19T14:10:00Z'), live: false});
    upload(c.club, 'sprockets', {riders: ['1001', '1009'], at: T('2026-11-19T16:30:00Z')});
    const srv = await serve(t, c);
    const ask = await post(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: slow});
    assert.equal(ask.status, 200, ask.body);
    const text = textOf(ask.body);
    assert.ok(ask.body.includes('<p class="kicker">Kettenfett RC · Rollers</p><h1>Make &#39;Rollers · slow&#39; v1 live?</h1>'), ask.body);
    assert.ok(text.includes('This plan is outdated: riders it lists now ride another team.'), text);
    assert.ok(text.includes('Ben now rides Sprockets'), text);
    // its words are drawn now, so its form carries the team's version now (UI panel, 19 Nov 2026)
    assert.ok(ask.body.includes(`<form method="post" action="/manage/live">${CLUB_FIELD}<input type="hidden" name="team" value="rollers"><input type="hidden" name="sheet" value="${slow}"><input type="hidden" name="version" value="${VERSION_OF(srv, 'rollers')}"><input type="hidden" name="confirm" value="1"><button class="btn primary" type="submit">Make live anyway</button></form>`), ask.body);
    // the way back is the team page with the version picked
    assert.ok(ask.body.includes(`<a class="btn secondary" href="/manage/team/rollers?v=${slow}">`), ask.body);
    assert.ok(text.includes('Back to Rollers'));
    assert.ok(!text.includes('Back to the club page'));
    assert.ok(!ask.body.includes('http-equiv') && !ask.body.includes('data-refresh'));
    assert.equal(liveId(srv.store.get(CID), 'rollers'), fast, 'nothing changed yet');
    // a refused Make live answers on the team page with the version picked (a back=plan of a page from
    // before the team cockpit is ignored)
    const change = srv.store.change;
    srv.store.change = () => {
        throw new ClubError('too-big');
    };
    try {
        const refused = await post(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: slow, back: 'plan', confirm: '1'});
        assert.equal(refused.status, 400, refused.body);
        assert.equal(flashOf(refused.body)?.kind, 'err', refused.body);
        assert.ok(refused.body.includes(`data-here="/manage/team/rollers?v=${slow}"`), 'the team page, the version picked');
        const onTeam = await post(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: slow, confirm: '1'});
        assert.equal(onTeam.status, 400, onTeam.body);
        assert.ok(onTeam.body.includes('<nav class="topbar" aria-label="Teams">'), 'the team page');
    } finally {
        srv.store.change = change;
    }
    assert.equal(liveId(srv.store.get(CID), 'rollers'), fast, 'nothing changed');
});


test('teams: add, rename keeps the slug, start, delete retires the slug', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const team = fields => post(srv, c.cookie, '/manage/team', fields);
    const follow = fields => followPost(srv, c.cookie, '/manage/team', fields);
    const teams = () => srv.store.get(CID).teams;

    // add: a blank start is no start (F8)
    let done = await follow({action: 'add', name: 'Cranks', start: ''});
    assert.deepEqual(done.flash, {kind: 'ok', text: 'Added Cranks.'});
    assert.equal(teams().cranks.start, null);
    assert.equal(done.location, '/manage/team/cranks');
    assert.ok(done.page.includes('<h1>Cranks</h1>'), 'the new team\'s page');
    let res = await team({action: 'add', name: 'Axles', start: '20:15'});
    assert.equal(res.status, 303);
    assert.equal(teams().axles.start, '20:15');
    res = await team({action: 'add', name: '', start: ''});
    assert.equal(res.status, 400);
    assert.equal(flashOf(res.body).kind, 'err');
    res = await team({action: 'add', name: 'Bad start', start: '7pm'});
    assert.equal(res.status, 400);
    assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'Enter the start time as HH:MM.'});
    assert.ok(res.body.includes('<h1>Add a team</h1>'));
    assert.ok(!Object.hasOwn(teams(), 'bad-start'));

    // rename keeps the slug
    done = await follow({action: 'rename', team: 'rollers', name: 'Rollers Elite'});
    assert.deepEqual(done.flash, {kind: 'ok', text: 'Renamed to Rollers Elite.'});
    assert.equal(teams().rollers.name, 'Rollers Elite');
    assert.ok(!Object.hasOwn(teams(), 'rollers-elite'));
    // a bad name: on the team's settings
    res = await team({action: 'rename', team: 'rollers', name: 'x'.repeat(41)});
    assert.equal(res.status, 400);
    assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'Use at most 40 characters, without control characters or invisible spaces.'});
    assert.ok(res.body.includes('<p class="kicker keep">Team settings</p><h1>Rollers Elite</h1>'), res.body);
    assert.equal(teams().rollers.name, 'Rollers Elite');

    // start: set, cleared by a blank field, a bad one refused on the settings
    done = await follow({action: 'start', team: 'rollers', start: '19:45'});
    assert.deepEqual(done.flash, {kind: 'ok', text: 'Start time of Rollers Elite: 19:45. Races already planned keep their time; change one in its ⋯.'});
    assert.equal(teams().rollers.start, '19:45');
    // clearing it with a plan for a race within 7 days asks first (S11, UI panel wave 2), nothing changes
    res = await team({action: 'start', team: 'rollers', start: ''});
    assert.equal(res.status, 200, res.body);
    assert.ok(res.body.includes('<h1>Clear the start time of Rollers Elite?</h1>'), res.body);
    assert.ok(textOf(res.body).includes('Without a start time riders get nothing from Rollers Elite, also for its races in the next 7 days.'), textOf(res.body));
    assert.ok(res.body.includes(`<form method="post" action="/manage/team">${CLUB_FIELD}<input type="hidden" name="action" value="start"><input type="hidden" name="start" value=""><input type="hidden" name="team" value="rollers"><input type="hidden" name="confirm" value="1"><button class="btn danger" type="submit">Clear start time</button></form>`), res.body);
    assert.equal(teams().rollers.start, '19:45');
    done = await follow({action: 'start', team: 'rollers', start: '', confirm: '1'});
    assert.deepEqual(done.flash, {kind: 'ok', text: 'Rollers Elite has no start time now. Races already planned keep their time; change one in its ⋯.'});
    assert.equal(teams().rollers.start, null);
    res = await team({action: 'start', team: 'rollers', start: '25:00'});
    assert.equal(res.status, 400);
    assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'Enter the start time as HH:MM.'});
    assert.ok(res.body.includes('<p class="kicker keep">Team settings</p>'));
    assert.equal(teams().rollers.start, null);

    // the settings offer Delete; delete takes the plans and retires the slug
    const page = await pageBody(srv, '/manage/team/rollers/settings');
    assert.ok(armHas(armOf(page, '/manage/team', page.indexOf('class="danger-zone"')), '/manage/team', '<input type="hidden" name="action" value="delete"><input type="hidden" name="team" value="rollers">', 'btn danger', 'Delete Rollers Elite'), page);
    done = await follow({action: 'delete', team: 'rollers', confirm: '1'});
    assert.deepEqual(done.flash, {kind: 'ok', text: 'Deleted Rollers Elite and its plans.'});
    assert.equal(done.location, '/manage');
    assert.ok(!Object.hasOwn(teams(), 'rollers'));
    assert.ok(!Object.values(srv.store.get(CID).sheets).some(s => s.team === 'rollers'));
    assert.deepEqual(tiles(done.page).map(x => x.href), ['/manage/team/sprockets', '/manage/team/axles', '/manage/team/cranks']);
    assert.equal((await srv.get('/manage/team/rollers/settings')).status, 404);
    assert.ok(srv.store.slugTaken('rollers'));
    await follow({action: 'add', name: 'Rollers', start: '19:30'});
    assert.ok(Object.hasOwn(teams(), 'rollers-2'), JSON.stringify(Object.keys(teams())));
    assert.ok(!Object.hasOwn(teams(), 'rollers'));

    // unknown teams and actions: refused, nothing changed (an unknown slug is not retired)
    const file = storedClub(srv);
    for (const fields of [{action: 'delete', team: 'gone'}, {action: 'delete', team: '__proto__'}, {action: 'rename', team: 'gone', name: 'X'},
        {action: 'start', team: 'gone', start: ''}, {action: 'fly', team: 'sprockets'}, {}]) {
        res = await team(fields);
        assert.equal(res.status, 400, JSON.stringify(fields));
        assert.equal(flashOf(res.body)?.kind, 'err', JSON.stringify(fields));
    }
    // a rename or start time of a team that is gone: the team-gone page
    res = await team({action: 'rename', team: 'gone', name: 'X'});
    assert.ok(res.body.includes('This team no longer exists.'), res.body);
    assert.equal(storedClub(srv), file);
    assert.ok(!srv.store.slugTaken('gone'));
    // the log
    const whats = srv.store.get(CID).log.map(e => e.what);
    for (const w of ['team-add', 'team-rename', 'team-start', 'team-delete']) {
        assert.ok(whats.includes(w), w);
    }
});


test('team deletes: at most 20 a day per club', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    // Spokesmen CC with its own link and team
    const other = secondClub({teams: [['Spokes', '19:30']]});
    srv.store.create(other.club);
    const tombs = () => JSON.stringify(rows(srv.server.db, 'SELECT slug FROM retired_slugs ORDER BY slug'));
    const team = (fields, cookie = c.cookie) => post(srv, cookie, '/manage/team', fields);
    const follow = (fields, cookie = c.cookie) => followPost(srv, cookie, '/manage/team', fields);
    const cycle = async () => {
        const before = new Set(Object.keys(srv.store.get(CID).teams));
        assert.equal((await follow({action: 'add', name: 'Temp', start: ''})).flash.kind, 'ok');
        const slug = Object.keys(srv.store.get(CID).teams).find(s => !before.has(s));
        return {slug, res: await team({action: 'delete', team: slug, confirm: '1'})};
    };
    for (let i = 0; i < 20; i++) {
        const {res} = await cycle();
        assert.equal(res.status, 303, `delete ${i + 1}`);
    }
    const file = tombs();
    const {slug, res} = await cycle();
    assert.equal(res.status, 429, res.body);
    assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'Too many team deletions today. Try again tomorrow.'});
    assert.ok(res.body.includes('<p class="kicker keep">Team settings</p><h1>Temp</h1>'), res.body);
    assert.ok(res.body.includes(`<a class="back" href="/manage/team/${slug}">`), 'the settings of that team');
    assert.ok(Object.hasOwn(srv.store.get(CID).teams, slug), 'the team stays');
    assert.equal(tombs(), file, 'nothing retired');
    // an unknown team does not count, and is still refused as unknown
    assert.equal((await team({action: 'delete', team: 'gone'})).status, 400);
    // another club is not affected
    const spokes = await follow({action: 'delete', team: 'spokes', confirm: '1'}, other.cookie);
    assert.deepEqual(spokes.flash, {kind: 'ok', text: 'Deleted Spokes and its plans.'});
    assert.ok(!Object.hasOwn(srv.store.get('p2m8c4t1v9').teams, 'spokes'));
    // a day later it works again
    srv.clock.now = NOW + 24 * 3600 * 1000;
    assert.deepEqual((await follow({action: 'delete', team: slug, confirm: '1'})).flash, {kind: 'ok', text: 'Deleted Temp and its plans.'});
    assert.ok(srv.store.slugTaken(slug));
});


// ---- the club settings /manage/settings (Task 7) ----

// The section labelled by `id` (e.g. 'who-h'), whole.
const sectionOf = (body, id) => {
    const s = element(body, `<section class="card" aria-labelledby="${id}">`);
    assert.ok(s, id);
    return s;
};

// The form that posts to `action`, whole: the first one, or the one holding `holds`.
function formTo(body, action, holds = '') {
    for (const f of elements(body, `<form method="post" action="${action}"`).concat(elements(body, `<form class="stack" method="post" action="${action}"`),
        elements(body, `<form class="inline-form" method="post" action="${action}"`))) {
        if (f.includes(holds)) {
            return f;
        }
    }
    assert.fail(`form ${action} ${holds}`);
}


test('club settings: sections, masked address, never reloads', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    // inside the refresh window: the team page reloads itself, the club settings never
    assert.ok((await pageBody(srv, '/manage/team/rollers')).includes('http-equiv="refresh"'));
    const body = await pageBody(srv, '/manage/settings');
    const text = textOf(body);
    assert.ok(!body.includes('http-equiv'));
    assert.ok(!body.includes('data-refresh'));
    assert.ok(body.includes('<a class="back" href="/manage">'), 'back to the teams');
    // the way to the hub reads "All teams" on every phone bar (review M4)
    assert.ok(textOf(element(body, '<nav class="topbar plain"')).includes('All teams'));
    // from 1024 px the breadcrumb names the club (UI panel wave 3): no desktop-only kicker any more
    assert.ok(body.includes('<header class="pagehead"><h1>Club settings</h1></header>'), body);
    assert.ok(body.includes('<nav class="crumbs desk" aria-label="Breadcrumb"><ol><li><a href="/manage">Kettenfett RC</a><span class="sep" aria-hidden="true">›</span></li>'
        + '<li><span aria-current="page">Club settings</span></li></ol></nav>'), body);
    // the address, masked
    assert.ok(body.includes('c…@example.org'));
    assert.ok(!body.includes('captain@'));
    assert.ok(body.includes('<span>Club e-mail <strong>c…@example.org</strong></span>'), body);
    // name and zone in one form
    const club = formTo(body, '/manage/club');
    assert.ok(club.includes('name="name" value="Kettenfett RC"'), club);
    assert.match(club, /<select name="tz" required>[\s\S]*<option value="Europe\/Berlin" selected>/);
    assert.ok(textOf(club).includes('Club name'));
    assert.ok(textOf(club).includes('Time zone Start times and the activity list use it.'), textOf(club));
    assert.ok(textOf(club).includes('Save'));
    // sign-in
    const email = formTo(body, '/manage/email');
    assert.ok(email.includes('<input type="email" name="email"'), email);
    assert.ok(textOf(email).includes('New e-mail address'));
    assert.ok(textOf(email).includes('Change e-mail'));
    assert.ok(text.includes('We mail a confirmation to the club\'s address first; then the new address confirms itself.'));
    assert.ok(textOf(formTo(body, '/manage/newlink')).includes('Mail me a new club link'));
    // (one line, the rest in its "More" fold: user, 23 Nov 2026)
    assert.ok(text.includes('For a new phone, or if the link leaked.') && text.includes('Opening it ends the old link, and other phones are signed out.'));
    // remove a rider
    const rider = formTo(body, '/manage/rider/remove');
    assert.match(rider, /<input type="text" name="zwiftId" inputmode="numeric"/);
    assert.ok(textOf(rider).includes('Zwift ID'));
    assert.ok(textOf(rider).includes('Remove'));
    assert.ok(text.includes('For data-protection requests (GDPR): if a rider asks the club to delete their data'));
    // the records band after the club's own settings, Remove a rider after the records (user, 23 Nov
    // 2026), then the danger zone and the footer (the page's: the sidebar has one of its own); no
    // "Who gets your plans" while private clubs are off and the club is open
    const main = element(body, '<main class="page settings" id="main">');
    assert.equal(main.includes('id="who-h"'), false);
    const order = ['action="/manage/club"', 'action="/manage/email"', 'action="/manage/newlink"',
        '<h2 class="band">Records</h2>', 'id="rec-h"', 'id="act-h"', 'action="/manage/rider/remove"', '<section class="danger-zone"', 'action="/manage/delete"', '<footer class="foot">']
        .map(s => main.indexOf(s));
    assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), JSON.stringify(order));
    const danger = element(body, '<section class="danger-zone"');
    assert.ok(textOf(danger).includes('Delete Kettenfett RC'), textOf(danger));
    assert.ok(textOf(danger).includes('Deletes the club with its 2 teams, 1 plan and 0 recordings. Riders get no plans from it any more. '
        + 'We mail a link to c…@example.org first; you delete from there.'), textOf(danger));
    assert.ok(textOf(formTo(danger, '/manage/delete')).includes('Delete club…'));
    assert.ok(body.includes('<a href="/privacy">Privacy</a>'));
    assert.ok(body.includes('action="/manage/logout"'));
    // GET only; signed out to the start page
    const res = await post(srv, c.cookie, '/manage/settings');
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'GET');
    const anon = await srv.get('/manage/settings', null);
    assert.equal(anon.status, 303);
    assert.equal(anon.headers.get('location'), '/');
});


test('club settings: private club states', async t => {
    const c = makeClub();
    const srv = await serve(t, c, {env: {CODE_SECRET}});
    // open
    let who = sectionOf(await pageBody(srv, '/manage/settings'), 'who-h');
    assert.ok(textOf(who).includes('Who gets your plans'));
    assert.ok(who.includes('<p class="sevline neutral">'), who);
    assert.ok(textOf(who).includes('Open: every rider listed in a plan gets your plans in the race; Paceline adds your club by itself.'), textOf(who));
    const on = formTo(who, '/manage/code');
    assert.ok(on.includes('<input type="hidden" name="action" value="on">'), on);
    assert.ok(textOf(on).includes('Make private (creates a rider code)'));
    // S2: it asks first in its place, with the race-day warning, as New rider code does
    assert.ok(armHas(on, '/manage/code', '<input type="hidden" name="action" value="on">', 'btn danger', 'Make private'), on);
    assert.ok(textOf(on).includes('Riders get no plans from Kettenfett RC until they enter the rider code in Paceline. Don\'t do this on a race day.'), textOf(on));
    assert.equal(count(who, 'action="/manage/code"'), 1);
    assert.ok(!/Paceline 0\.2|old API/.test(textOf(who)), textOf(who));

    // private
    const code = newRiderCode();
    srv.store.change(CID, cl => setRiderCode(cl, riderCodeHash(code, CODE_SECRET), T('2026-11-12T13:02:00Z')));
    const setAt = srv.store.get(CID).riderCode.setAt;
    const body = await pageBody(srv, '/manage/settings');
    who = sectionOf(body, 'who-h');
    const text = textOf(who);
    assert.ok(text.includes('Private: riders also need the rider code. They enter it once in Paceline settings under Clubs.'), text);
    assert.ok(text.includes('Code made Thu 12 Nov 14:02.') && text.includes('Lost it? Any rider who entered it sees the code in Paceline under Clubs.'), text);
    assert.ok(!text.includes('Make private'));
    const confirm = armOf(who, '/manage/code');
    assert.ok(confirm, who);
    assert.ok(textOf(confirm).includes('New rider code…'));
    assert.ok(textOf(confirm).includes('Riders with the old code get no plans until they enter the new one. Don\'t do this on a race day.'));
    assert.ok(armHas(confirm, '/manage/code', `<input type="hidden" name="action" value="new"><input type="hidden" name="setAt" value="${setAt}">`, 'btn danger', 'Make a new code'), confirm);
    const off = formTo(who, '/manage/code', 'value="off"');
    assert.ok(textOf(off).includes('Make open'));
    assert.ok(!confirm.includes('value="off"'), 'Make open is outside the confirm');
    assert.ok(!body.includes(code) && !body.includes(formatRiderCode(code)), 'never the code');

    // no compat sentence (hard cut, 17 Nov 2026), even with a leftover OLD_API_CIRCLE naming this club
    for (const env of [{CODE_SECRET, OLD_API_CIRCLE: CID}, {CODE_SECRET, OLD_API: 'compat', OLD_API_CIRCLE: CID}]) {
        const old = await serve(t, c, {env, beforeStart: true});
        const text = textOf(sectionOf(await pageBody(old, '/manage/settings'), 'who-h'));
        assert.ok(text.includes('Who gets your plans'), text);
        assert.ok(!/Paceline 0\.2|old API/.test(text), text);
    }
});


test('club settings: private club without CODE_SECRET', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    // an open club has nothing to change here: no card (user, 23 Nov 2026)
    assert.equal((await pageBody(srv, '/manage/settings')).includes('id="who-h"'), false);
    let who;
    // a club still private from before can be made open (F11)
    srv.store.change(CID, cl => setRiderCode(cl, riderCodeHash(newRiderCode(), CODE_SECRET), NOW));
    who = sectionOf(await pageBody(srv, '/manage/settings'), 'who-h');
    assert.ok(textOf(who).includes('Private clubs are off on this server.'));
    assert.equal(count(who, 'action="/manage/code"'), 1);
    assert.ok(formTo(who, '/manage/code').includes('<input type="hidden" name="action" value="off">'));
    assert.ok(!/<input type="hidden" name="action" value="(new|on)">/.test(who));
    assert.ok(!who.includes('<details class="confirm">'));
});


test('club settings: recordings and activity', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    upload(c.club, 'sprockets', {riders: ['1009'], at: T('2026-11-19T16:30:00Z')});
    c.club.log = [
        {at: '2026-11-12T10:00:00.000Z', what: 'club-deleted'},
        {at: '2026-11-12T10:05:00.000Z', what: 'club-restored'},
        {at: '2026-11-18T09:00:00.000Z', what: 'team-start', team: 'rollers', label: '19:30'},
        {at: '2026-11-19T10:00:00.000Z', what: 'club-rename', label: 'Kettenfett RC'},
        {at: '2026-11-19T11:00:00.000Z', what: 'rider-remove'},
        {at: '2026-11-19T12:00:00.000Z', what: 'future-thing', label: 'x'},
        {at: '2026-11-19T13:00:00.000Z', what: 'link-opened'},
        {at: '2026-11-19T14:00:00.000Z', what: 'upload', team: 'rollers', label: 'Rollers · fast'},
    ];
    const srv = await serve(t, c);
    const empty = sectionOf(await pageBody(srv, '/manage/settings'), 'rec-h');
    assert.ok(textOf(empty).includes('No recordings yet.'), textOf(empty));
    assert.ok(!empty.includes('<ul class="recs">'));

    const session = T('2026-11-12T18:31:00Z');
    const later = T('2026-11-12T18:40:00Z');
    const early = T('2026-11-05T18:40:00Z');
    const put = (slug, name, size) => srv.server.logs.put(CID, slug, name, Buffer.alloc(size));
    put('rollers', `${session}-1002.jsonl.gz`, 3000);
    put('rollers', `${later}-1003.jsonl.gz`, 1024);
    put('sprockets', `${early}-1009.jsonl.gz`, 2000);
    const body = await pageBody(srv, '/manage/settings');
    const rec = sectionOf(body, 'rec-h');
    assert.ok(rec.includes('<div class="card-head"><h3 id="rec-h">Recordings</h3><p class="count">0.0 MB of 300 MB</p></div>'), rec);
    const groups = elements(rec, '<li class="recgroup">');
    assert.deepEqual(groups.map(g => /<p class="nm">([^<]*)<\/p>/.exec(g)[1]), ['Rollers · Thu 12 Nov', 'Sprockets · Thu 5 Nov']);
    const rows = g => [...g.matchAll(/<li><div><p>([^<]*)<\/p><p class="meta">([^<]*)<\/p><\/div>/g)].map(m => [m[1], m[2]]);
    // newest first within a group
    assert.deepEqual(rows(groups[0]), [['Dan', '19:40 · 1 KB'], ['Cleo', '19:31 · 3 KB']]);
    assert.deepEqual(rows(groups[1]), [['Jo', '19:40 · 2 KB']]);
    for (const [slug, file, rider, day] of [['rollers', `${session}-1002.jsonl.gz`, 'Cleo', 'Thu 12 Nov'], ['rollers', `${later}-1003.jsonl.gz`, 'Dan', 'Thu 12 Nov'],
        ['sprockets', `${early}-1009.jsonl.gz`, 'Jo', 'Thu 5 Nov']]) {
        const del = formTo(rec, '/manage/logs/delete', `value="${file}"`);
        assert.ok(del.includes(`<input type="hidden" name="slug" value="${slug}"><input type="hidden" name="file" value="${file}">`), del);
        assert.ok(del.includes(`<span class="sr"> Delete ${rider}, ${day}</span>`), del);
        // it asks first in its place (review I1), in the danger style
        assert.ok(armHas(del, '/manage/logs/delete', `<input type="hidden" name="slug" value="${slug}"><input type="hidden" name="file" value="${file}">`, 'btn danger small', 'Delete recording'), del);
        assert.ok(del.includes('<button class="btn secondary danger-text small" type="submit" data-arm-open>'), del);
        assert.ok(textOf(del).includes(`Deletes the recording of ${rider} from ${day} `), textOf(del));
    }
    // captains don't download recordings (17 Nov 2026): no link into /manage/logs/, no Download text,
    // the one thing under that path is the Delete form
    assert.doesNotMatch(rec, /href="\/manage\/logs\//);
    assert.doesNotMatch(rec, /<a [^>]*>/);
    assert.ok(!/download/i.test(textOf(rec)), textOf(rec));
    assert.equal([...rec.matchAll(/\/manage\/logs\//g)].length, 3);
    assert.equal([...rec.matchAll(/<form method="post" action="\/manage\/logs\/delete" data-arm>/g)].length, 3);
    assert.ok(textOf(rec).includes('Deleted after 90 days.') && textOf(rec).includes("Recordings are kept for the Paceline operator, who analyses the team's rides with them."), textOf(rec));

    // activity: the newest 6, the rest folded
    const act = element(body, '<section class="card" aria-labelledby="act-h">');
    assert.ok(act, body);
    const fold = element(act, '<details');
    assert.ok(fold, act);
    assert.ok(textOf(element(fold, '<summary')).includes('Show all activity'));
    const items = html => [...html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => textOf(m[1]).trim());
    assert.deepEqual(items(act.slice(0, act.indexOf('<details'))), [
        '15:00 Rollers · Upload \'Rollers · fast\'',
        '14:00 Club link opened',
        '13:00 future-thing',
        '12:00 Rider removed',
        '11:00 Club renamed: Kettenfett RC',
        'Wed 18 Nov 10:00 Rollers · Start time 19:30',
    ]);
    assert.deepEqual(items(fold), ['Thu 12 Nov 11:05 Club restored', 'Thu 12 Nov 11:00 Club deleted']);
    assert.ok(act.includes('<li><time>15:00</time><span><span class="team">Rollers</span> · Upload &#39;Rollers · fast&#39;</span></li>'), act);
    // the danger zone counts the recordings
    assert.ok(textOf(element(body, '<section class="danger-zone"')).includes('its 2 teams, 2 plans and 3 recordings.'));

    // a short log: no fold
    srv.store.change(CID, cl => {
        cl.log = cl.log.slice(-6);
    });
    const short = element(await pageBody(srv, '/manage/settings'), '<section class="card" aria-labelledby="act-h">');
    assert.ok(!short.includes('<details'));
    assert.equal(count(short, '<li>'), 6);
    srv.store.change(CID, cl => {
        cl.log = [];
    });
    assert.ok(textOf(element(await pageBody(srv, '/manage/settings'), '<section class="card" aria-labelledby="act-h">')).includes('Nothing yet.'));
});


test('club settings: the recordings hint names LOG_RETENTION_DAYS, and 0 keeps them', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const name = `${T('2026-11-12T18:31:00Z')}-1002.jsonl.gz`;
    for (const [days, hint] of [
        // one line, why they are kept in its "More" fold (user, 23 Nov 2026)
        ['30', 'Deleted after 30 days.'],
        ['0', 'Kept until you delete them.'],
    ]) {
        const srv = await serve(t, c, {env: {LOG_RETENTION_DAYS: days}, beforeStart: true});
        srv.server.logs.put(CID, 'rollers', name, Buffer.alloc(1000));
        const text = textOf(sectionOf(await pageBody(srv, '/manage/settings'), 'rec-h'));
        assert.ok(text.includes(hint), `${days}: ${text}`);
        assert.ok(!text.includes('90 days'), `${days}: ${text}`);
    }
});


test('club settings: names are escaped', async t => {
    const c = makeClub({teams: [['<b>Rollers</b>', '19:30']]});
    c.club.log.push({at: '2026-11-19T14:00:00.000Z', what: 'club-rename', label: '<i>x</i>'});
    const srv = await serve(t, c);
    const body = await pageBody(srv, '/manage/settings');
    assert.ok(!body.includes('<b>') && !body.includes('<i>'));
    assert.ok(body.includes('Team added: &lt;b&gt;Rollers&lt;/b&gt;'), body);
    assert.ok(body.includes('Club renamed: &lt;i&gt;x&lt;/i&gt;'));
});


test('club actions answer 303 to club settings', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c, {env: {CODE_SECRET}});
    const name = `${T('2026-11-12T18:31:00Z')}-1002.jsonl.gz`;
    // a recording as the server stores one (Remove a rider reads it)
    srv.server.logs.put(CID, 'rollers', name, gzipSync('{"kind":"paceline-recording","v":1}\n'));
    const MAIL_OFF = 'No mail was sent: the server cannot send mail right now. Try again later.';
    for (const [p, fields, flash] of [
        ['/manage/club', {name: 'Kettenfett Racing', tz: 'UTC', confirm: '1'}, {kind: 'ok', text: 'Saved.'}],
        ['/manage/rider/remove', {zwiftId: '1001', confirm: '1'}, {kind: 'ok', text: 'Removed from 1 plan.'}],
        ['/manage/logs/delete', {slug: 'rollers', file: name, confirm: '1'}, {kind: 'ok', text: 'Recording deleted.'}],
        ['/manage/newlink', {}, {kind: 'err', text: MAIL_OFF}],
        ['/manage/email', {email: 'new@example.org'}, {kind: 'err', text: MAIL_OFF}],
        ['/manage/delete', {}, {kind: 'err', text: MAIL_OFF}],
    ]) {
        const res = await followPost(srv, c.cookie, p, fields);
        assert.equal(res.location, '/manage/settings', p);
        assert.deepEqual(res.flash, flash, p);
        assert.ok(res.page.includes('<h1>Club settings</h1>'), p);
        assert.ok(!res.page.includes('http-equiv') && !res.page.includes('data-refresh'), p);
    }
    // the flash sits under the heading
    const saved = await followPost(srv, c.cookie, '/manage/club', {name: 'Kettenfett Racing', tz: 'UTC'});
    assert.ok(saved.page.indexOf('class="flash ok"') > saved.page.indexOf('<h1>Club settings</h1>'));
    assert.ok(saved.page.indexOf('class="flash ok"') < saved.page.indexOf('id="club-h"'));

    // on: the code page, a direct answer (once confirmed)
    const on = await post(srv, c.cookie, '/manage/code', {action: 'on', confirm: '1'});
    assert.equal(on.status, 200, on.body);
    assert.equal(count(on.body, 'data-copy='), 1);
    // copying is the page's main action; the way back is navigation, a quiet link (one button system)
    assert.match(on.body, /<button type="button" class="btn primary" data-js data-copy="[^"]+" data-copied="Copied" hidden>Copy the code<\/button>/);
    assert.ok(on.body.includes('href="/manage/settings"'));
    assert.ok(textOf(on.body).includes('Back to club settings'));
    // off: 303 to the club settings
    const off = await followPost(srv, c.cookie, '/manage/code', {action: 'off'});
    assert.equal(off.location, '/manage/settings');
    assert.deepEqual(off.flash, {kind: 'ok', text: 'Kettenfett Racing is open again: riders listed in a plan get its plans without a code.'});
});


test('club action refusals answer club settings', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    srv.store.create(secondClub().club);
    const file = storedClub(srv);
    const refused = (res, status, text) => {
        assert.equal(res.status, status, res.body);
        assert.deepEqual(flashOf(res.body), {kind: 'err', text});
        assert.ok(res.body.includes('<h1>Club settings</h1>'), res.body);
        // inside the refresh window, a refusal never reloads
        assert.ok(!res.body.includes('http-equiv') && !res.body.includes('data-refresh'));
    };
    // a taken name: what was typed stays in the form
    let res = await post(srv, c.cookie, '/manage/club', {name: 'Spokesmen C.C.', tz: 'Europe/Berlin'});
    refused(res, 409, 'This name is taken. Choose another.');
    assert.ok(formTo(res.body, '/manage/club').includes('name="name" value="Spokesmen C.C."'));
    res = await post(srv, c.cookie, '/manage/club', {name: '<b>x</b>yz', tz: 'Mars/Olympus'});
    refused(res, 400, 'Choose a time zone from the list.');
    assert.ok(formTo(res.body, '/manage/club').includes('name="name" value="&lt;b&gt;x&lt;/b&gt;yz"'));
    refused(await post(srv, c.cookie, '/manage/rider/remove', {zwiftId: 'abc'}), 400, 'Enter a Zwift ID: digits only.');
    refused(await post(srv, c.cookie, '/manage/logs/delete', {slug: 'rollers', file: `${T('2026-11-12T18:31:00Z')}-1002.jsonl.gz`}), 400,
        'This recording no longer exists.');
    refused(await post(srv, c.cookie, '/manage/email', {email: 'not an address'}), 400, 'Enter an e-mail address in Latin letters, digits and dots before the @.');
    refused(await post(srv, c.cookie, '/manage/code', {action: 'fly'}), 400, 'This form was not understood. Nothing was changed. Try again from this page.');
    refused(await post(srv, c.cookie, '/manage/code', {action: 'on'}), 409, 'Private clubs are off on this server.');
    // the stored name is shown again once nothing was typed
    assert.ok(formTo(await pageBody(srv, '/manage/settings'), '/manage/club').includes('name="name" value="Kettenfett RC"'));
    assert.equal(storedClub(srv), file);
});


const CODE_RE = /[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}/g;

test('private club: the code is shown once', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c, {env: {CODE_SECRET}});
    // everything the server prints meanwhile
    const printed = [];
    const saved = {};
    for (const k of ['log', 'info', 'warn', 'error', 'debug']) {
        saved[k] = console[k];
        console[k] = (...args) => printed.push(args.map(String).join(' '));
    }
    t.after(() => Object.assign(console, saved));
    const rider = async (code = null) => {
        const res = await fetch(srv.base + '/api/v3/rider/1001?mod=0.3.0', {headers: code ? {'X-Paceline-Codes': code} : {}});
        assert.equal(res.status, 200);
        return (await res.json()).circles.find(x => x.id === CID) ?? null;
    };
    assert.ok(await rider(), 'open: listed by the Zwift ID');

    // Make private without confirm=1 (S2, UI panel wave 2): the question, with the race-day warning;
    // no code made
    const unasked = storedClub(srv);
    const askOn = await post(srv, c.cookie, '/manage/code', {action: 'on'});
    assert.equal(askOn.status, 200, askOn.body);
    assert.ok(askOn.body.includes('<h1>Make Kettenfett RC private?</h1>'), askOn.body);
    assert.ok(textOf(askOn.body).includes('Riders get no plans from Kettenfett RC until they enter the rider code in Paceline. Don\'t do this on a race day.'), textOf(askOn.body));
    assert.ok(askOn.body.includes(`<form method="post" action="/manage/code">${CLUB_FIELD}<input type="hidden" name="action" value="on"><input type="hidden" name="confirm" value="1"><button class="btn danger" type="submit">Make private</button></form>`), askOn.body);
    assert.equal(askOn.body.match(CODE_RE), null);
    assert.equal(storedClub(srv), unasked);

    const on = await post(srv, c.cookie, '/manage/code', {action: 'on', confirm: '1'});
    assert.equal(on.status, 200, on.body);
    // shown once, and in the copy button's data-copy
    const shown = textOf(on.body).match(CODE_RE);
    assert.equal(shown?.length, 1, on.body);
    const code = shown[0];
    assert.equal(/ data-copy="([^"]*)"/.exec(on.body)[1], code);
    assert.equal(on.body.match(CODE_RE).length, 2, 'nowhere else on the page');
    const plain = code.replace('-', '');
    assert.ok(textOf(on.body.replace(/<\/?code>/g, '')).includes(`Rider code for Kettenfett RC: ${code}. Send it to your riders now: it is shown only this once. Riders see it in Paceline under Clubs, so a teammate can pass it on.`), on.body);
    assert.ok(on.body.includes('<p class="kicker">Kettenfett RC</p><h1>Rider code</h1>'), on.body);
    assert.ok(on.body.includes('<a class="btn quiet" href="/manage/settings">'), on.body);
    assert.ok(textOf(on.body).includes('Back to club settings'));
    assert.ok(!on.body.includes('http-equiv') && !on.body.includes('data-refresh'));
    assert.equal(on.headers.get('cache-control'), 'no-store');
    assert.equal(srv.store.get(CID).riderCode.hash, riderCodeHash(plain, CODE_SECRET));

    // nowhere else
    const later = await pageBody(srv, '/manage/settings');
    for (const [where, s] of [['stored club', storedClub(srv)], ['club log', JSON.stringify(srv.store.get(CID).log)], ['console', printed.join('\n')],
        ['GET /manage', await srv.body()], ['GET /manage/settings', later], ['GET /manage/team/rollers', await pageBody(srv, '/manage/team/rollers')]]) {
        assert.ok(!s.includes(code) && !s.includes(plain), where);
    }
    assert.ok(textOf(later).includes('Private: riders also need the rider code.'));

    // the API: with the code, not without
    assert.equal((await rider(code))?.private, true);
    assert.equal(await rider(), null);

    // on again on a private club: back to the club settings, without a flash, unchanged
    const hash = srv.store.get(CID).riderCode.hash;
    const onAgain = await post(srv, c.cookie, '/manage/code', {action: 'on'});
    assert.equal(onAgain.status, 303, onAgain.body);
    assert.equal(onAgain.headers.get('location'), '/manage/settings');
    assert.deepEqual(onAgain.headers.getSetCookie(), []);
    assert.equal(onAgain.body.match(CODE_RE), null);
    assert.equal(srv.store.get(CID).riderCode.hash, hash);

    // a new code: asked first in its place (arm in place, UI panel wave 2)
    const setAt = srv.store.get(CID).riderCode.setAt;
    const ask = armOf(later, '/manage/code');
    assert.ok(textOf(ask).includes('Riders with the old code get no plans until they enter the new one. Don\'t do this on a race day.'), ask);
    assert.ok(armHas(ask, '/manage/code', `<input type="hidden" name="action" value="new"><input type="hidden" name="setAt" value="${setAt}">`, 'btn danger', 'Make a new code'), ask);
    // without confirm=1 (no script): the question on a page of its own, with the code's time; nothing
    // changed (it replaces decision 13's refusal: no destructive action on one press, UI panel wave 2)
    const bare = await post(srv, c.cookie, '/manage/code', {action: 'new', setAt});
    assert.equal(bare.status, 200, bare.body);
    assert.ok(bare.body.includes('<h1>Make a new rider code?</h1>'), bare.body);
    assert.ok(textOf(bare.body).includes('Riders with the old code get no plans until they enter the new one. Don\'t do this on a race day.'), textOf(bare.body));
    assert.ok(bare.body.includes(`<form method="post" action="/manage/code">${CLUB_FIELD}<input type="hidden" name="action" value="new"><input type="hidden" name="setAt" value="${setAt}"><input type="hidden" name="confirm" value="1"><button class="btn danger" type="submit">Make a new code</button></form>`), bare.body);
    assert.equal(bare.body.match(CODE_RE), null);
    assert.equal(srv.store.get(CID).riderCode.hash, hash);
    // of an older code: refused at once, not asked about
    const bareStale = await post(srv, c.cookie, '/manage/code', {action: 'new', setAt: '2026-11-19T18:00:00.000Z'});
    assert.equal(bareStale.status, 409, bareStale.body);
    // a confirm form without the code's time, or of an older code: refused, nothing changed
    for (const stale of [{}, {setAt: '2026-11-19T18:00:00.000Z'}]) {
        const res = await post(srv, c.cookie, '/manage/code', {action: 'new', confirm: '1', ...stale});
        assert.equal(res.status, 409, JSON.stringify(stale));
        assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'The rider code changed since you opened the page. No new code was made.'});
        assert.equal(res.body.match(CODE_RE), null);
        assert.equal(srv.store.get(CID).riderCode.hash, hash);
    }
    srv.clock.now = NOW + 60000;
    const fresh = await post(srv, c.cookie, '/manage/code', {action: 'new', confirm: '1', setAt});
    assert.equal(fresh.status, 200, fresh.body);
    const second = textOf(fresh.body).match(CODE_RE);
    assert.equal(second?.length, 1);
    assert.equal(/ data-copy="([^"]*)"/.exec(fresh.body)[1], second[0]);
    assert.notEqual(second[0], code);
    assert.equal(srv.store.get(CID).riderCode.hash, riderCodeHash(second[0], CODE_SECRET));
    assert.equal(await rider(code), null, 'the old code no longer finds the club');
    assert.equal((await rider(second[0]))?.private, true);
    // the same confirm sent again (a reload of the code page): the code just shown stays
    const resent = await post(srv, c.cookie, '/manage/code', {action: 'new', confirm: '1', setAt});
    assert.equal(resent.status, 409, resent.body);
    assert.equal(resent.body.match(CODE_RE), null);
    assert.equal(srv.store.get(CID).riderCode.hash, riderCodeHash(second[0], CODE_SECRET));

    // open again
    const off = await followPost(srv, c.cookie, '/manage/code', {action: 'off'});
    assert.deepEqual(off.flash, {kind: 'ok', text: 'Kettenfett RC is open again: riders listed in a plan get its plans without a code.'});
    assert.equal(srv.store.get(CID).riderCode, null);
    assert.ok(await rider(), 'listed by the Zwift ID again');
    // new and off on an open club: unchanged
    const file = storedClub(srv);
    for (const action of ['new', 'off']) {
        const res = await post(srv, c.cookie, '/manage/code', {action, confirm: '1'});
        assert.equal(res.status, 303, action);
        assert.equal(res.headers.get('location'), '/manage/settings', action);
        assert.deepEqual(res.headers.getSetCookie(), [], action);
        assert.equal(res.body.match(CODE_RE), null, action);
    }
    const bad = await post(srv, c.cookie, '/manage/code', {action: 'fly'});
    assert.equal(bad.status, 400);
    assert.equal(storedClub(srv), file);

    assert.deepEqual(srv.store.get(CID).log.map(e => e.what).filter(w => w.startsWith('code-')), ['code-on', 'code-new', 'code-off']);
    for (const s of [storedClub(srv), printed.join('\n')]) {
        assert.ok(!s.includes(second[0]) && !s.includes(second[0].replace('-', '')));
    }
});


test('private club without CODE_SECRET: no code, but it can be made open', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    for (const fields of [{action: 'on'}, {action: 'new', confirm: '1'}, {action: 'new'}]) {
        const res = await post(srv, c.cookie, '/manage/code', fields);
        assert.equal(res.status, 409, JSON.stringify(fields));
        assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'Private clubs are off on this server.'});
        assert.equal(res.body.match(CODE_RE), null);
        assert.equal(srv.store.get(CID).riderCode, null);
    }
    // a club made private while the server had a secret
    srv.store.change(CID, cl => setRiderCode(cl, riderCodeHash(newRiderCode(), CODE_SECRET), NOW));
    const on = await post(srv, c.cookie, '/manage/code', {action: 'new', confirm: '1'});
    assert.equal(on.status, 409);
    const off = await followPost(srv, c.cookie, '/manage/code', {action: 'off'});
    assert.equal(off.flash.kind, 'ok');
    assert.equal(srv.store.get(CID).riderCode, null);
});


// ---- the team picker /manage, the first run and the signed-out page (Task 8) ----

// The picker's tiles as {sev, href, name, time, line, lineSev, quiet}; the "Add a team" tile apart.
function tiles(html) {
    const list = element(html, '<ul class="tiles">');
    assert.ok(list, 'the tiles');
    return [...list.matchAll(/<a class="tile edge-(\w+)" href="([^"]*)">([\s\S]*?)<\/a>/g)].map(([, sev, href, inner]) => ({
        sev, href,
        name: textOf(/<span class="tile-name">([^<]*)<\/span>/.exec(inner)[1]),
        time: textOf(/<span class="tile-time">([^<]*)<\/span>/.exec(inner)[1]),
        line: textOf(/<span class="sevline \w+">[\s\S]*?<span>([^<]*)<\/span><\/span>/.exec(inner)[1]),
        lineSev: /<span class="sevline (\w+)">/.exec(inner)[1],
        quiet: textOf(/<span class="tile-quiet">([^<]*)<\/span>/.exec(inner)[1]),
    }));
}


test('picker: one row per team, by start time, worst state', async t => {
    // added out of order: the tiles sort them (by start time, no start time last, then name)
    const c = makeClub({teams: [['Cranks', null], ['Sprockets', '19:40'], ['Rollers', '19:30'], ['Axles', '19:40']]});
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    upload(c.club, 'sprockets', {riders: ['1009'], at: T('2026-11-19T14:05:00Z')});
    const sig = c.club.sheets[live].sig;
    const srv = await serve(t, c);
    for (const aid of ROLLERS) {
        srv.see(aid, '2026-11-19T17:00:00Z', {sig, mod: '0.3.0', sheet: live, inEvent: false, event: null});
    }
    const res = await srv.get('/manage');
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /<body class="teamspage" data-refresh="30" data-updated="19:25">/);
    assert.ok(body.includes('<p class="kicker">Next race · Thu 19 Nov</p>'), body);
    assert.ok(body.includes('<h1>Kettenfett RC</h1>'));
    assert.ok(textOf(element(body, '<p class="fresh">')).includes('Updated 19:25'));
    // the tiles under a "Teams" heading (phones; from 1024 px the sidebar lists the teams, UI panel wave 3)
    assert.ok(body.includes('<section class="hub-teams" aria-labelledby="teams-h">\n    <h2 class="band" id="teams-h">Teams</h2>'), body);
    assert.deepEqual(tiles(body), [
        {sev: 'ok', href: '/manage/team/rollers', name: 'Rollers', time: '19:30 · in 5 min', line: '8 of 8 riders have the plan', lineSev: 'ok', quiet: 'Live: \'Rollers · fast\''},
        {sev: 'neutral', href: '/manage/team/axles', name: 'Axles', time: '19:40 · in 15 min', line: 'Next regular race Thu 19 Nov 19:40', lineSev: 'neutral', quiet: 'No plan yet'},
        {sev: 'neutral', href: '/manage/team/sprockets', name: 'Sprockets', time: '19:40 · in 15 min', line: '0 of 1 rider has the plan', lineSev: 'neutral', quiet: 'Live: \'Sprockets\''},
        {sev: 'neutral', href: '/manage/team/cranks', name: 'Cranks', time: 'No start time', line: 'No start time set', lineSev: 'neutral', quiet: 'Set a start time and upload a plan'},
    ]);
    // Add a team at the end of the page (after the tiles, before the phone's footer), the club
    // settings link, the footer
    assert.ok(!element(body, '<ul class="tiles">').includes('new-team'));
    const main = element(body, '<main class="page wide"');
    assert.match(main, /<\/section>\s*<a class="btn secondary hub-add" href="\/manage\/new-team"><svg[^>]*>[\s\S]*?<\/svg>Add a team<\/a>\s*<footer class="foot">/);
    assert.match(body, /<a class="btn quiet small" href="\/manage\/settings"><svg[^>]*>[\s\S]*?<\/svg>Club settings<\/a>/);
    assert.ok(body.includes('<a href="/privacy">Privacy</a>'));
    assert.ok(body.includes('<form method="post" action="/manage/logout">'));
    assert.equal(count(body, '<script'), 1);
    // no team page forms here
    assert.ok(!body.includes('action="/manage/upload') && !body.includes('action="/manage/team"'));
});


test('picker: no next race, a flash, names escaped', async t => {
    const EVIL = '<img src=x onerror=alert(1)>';
    const ESC = '&lt;img src=x onerror=alert(1)&gt;';
    const c = makeClub({name: EVIL, teams: [[EVIL, null]]});
    const srv = await serve(t, c);
    const body = await srv.body();
    assert.ok(!body.includes('<img'), 'no raw tag');
    assert.ok(body.includes(`<h1>${ESC}</h1>`));
    assert.ok(body.includes(`<span class="tile-name">${ESC}</span>`));
    // no team races: no kicker, and no reload
    assert.ok(!body.includes('Next race'));
    assert.ok(!body.includes('<p class="kicker">'));
    assert.ok(!body.includes('http-equiv') && !body.includes('data-refresh'));
    // a team delete answers the picker with its flash
    const done = await followPost(srv, c.cookie, '/manage/team', {action: 'delete', team: c.slugs[0], confirm: '1'});
    assert.equal(done.location, '/manage');
    assert.deepEqual(done.flash, {kind: 'ok', text: `Deleted ${EVIL} and its plans.`});
});


test('picker: a refusal answers it without a reload', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    // 18:25Z: inside Rollers' refresh window
    const srv = await serve(t, c);
    assert.ok((await srv.body()).includes('data-refresh="30"'));
    const res = await post(srv, c.cookie, '/manage/team', {action: 'delete', team: 'gone'});
    assert.equal(res.status, 400);
    assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'This team or plan no longer exists. Nothing was changed.'});
    assert.ok(res.body.includes('<ul class="tiles">'), 'the picker');
    assert.ok(!res.body.includes('http-equiv') && !res.body.includes('data-refresh'));
});


test('picker: first run', async t => {
    const c = makeClub({teams: []});
    const srv = await serve(t, c);
    const body = await srv.body();
    assert.match(body, /<body class="firstrun">/);
    assert.ok(body.includes('<p class="kicker">Welcome</p><h1>Kettenfett RC</h1>'), body);
    assert.match(body, /<a class="btn quiet small" href="\/manage\/settings">[\s\S]*?Club settings<\/a>/);
    const text = textOf(body);
    assert.ok(text.includes('Three steps to the first race'
        + ' 1 Add a team Its name and its race rhythm: every week on its day at its start time, or on single dates, with date and time on each race.'
        + ' An extra race on another day needs no second team.'
        + ' 2 Upload the team\'s plan Plan on ZwiftGopher and send it here, or upload the planner\'s JSON export.'
        + ' 3 Riders get it in Paceline 30 min before the start, in the Zwift event. Nothing to send around.'), text);
    assert.ok(text.includes('Add your first team'));
    const form = element(body, '<form class="stack" method="post" action="/manage/team">');
    assert.ok(form.includes('<input type="hidden" name="action" value="add">'), form);
    assert.match(form, /<input name="name" maxlength="40" required autocomplete="off" placeholder="e\.g\. Rollers">/);
    assert.match(form, /<input type="time" name="start" value="">/);
    assert.ok(textOf(form).includes('In Europe/Berlin. You can set it later, but riders get nothing without one.'));
    assert.ok(textOf(form).includes('Add the team'));
    assert.ok(body.includes('<a href="/privacy">Privacy</a>') && body.includes('action="/manage/logout"'));
    assert.ok(!body.includes('<ul class="tiles">') && !body.includes('Updated'));
    // never reloads, even when another club's race is near (18:25Z, Spokesmen's Rollers 19:30)
    const other = secondClub({teams: [['Rollers', '19:30']]});
    upload(other.club, 'rollers', {riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    srv.store.create(other.club);
    assert.ok((await srv.get('/manage', other.cookie).then(r => r.text())).includes('http-equiv'), 'the other club reloads');
    const again = await srv.body();
    assert.ok(!again.includes('http-equiv') && !again.includes('data-refresh'));
});


test('picker: adding a team from the first run lands on its page', async t => {
    const c = makeClub({teams: []});
    const srv = await serve(t, c);
    const done = await followPost(srv, c.cookie, '/manage/team', {action: 'add', name: 'Rollers', start: '19:30'});
    assert.equal(done.location, '/manage/team/rollers');
    assert.deepEqual(done.flash, {kind: 'ok', text: 'Added Rollers.'});
    assert.deepEqual(tiles(await srv.body()).map(x => x.href), ['/manage/team/rollers']);
});


test('picker: DST banner and refresh', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const REFRESH = '<noscript><meta http-equiv="refresh" content="30;url=/manage"></noscript>';
    srv.clock.now = T('2026-10-30T12:00:00Z');
    const dst = await srv.body();
    assert.ok(dst.includes(`<p class="banner warn" role="note"><svg`), dst);
    assert.ok(dst.includes(DST));
    srv.clock.now = T('2026-11-19T16:00:00Z');
    assert.ok(!(await srv.body()).includes(DST));
    // Rollers' S is 18:30Z: from S - 90 min to S + 60 min
    for (const [at, on] of [['16:59', false], ['17:00', true], ['19:30', true], ['19:31', false]]) {
        srv.clock.now = T(`2026-11-19T${at}:00Z`);
        const body = await srv.body();
        assert.equal(body.includes(REFRESH), on, at);
        assert.equal(body.includes('data-refresh="30"'), on, at);
    }
});


test('signed out', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    const res = await post(srv, null, '/manage/live', {team: 'rollers', sheet: 'x'});
    assert.equal(res.status, 403);
    assert.match(res.headers.get('content-type'), /^text\/html/);
    assert.ok(res.body.includes('<h1>Signed out</h1>'), res.body);
    assert.ok(textOf(res.body).includes('Your club link no longer works in this browser. Someone opened a new club link, or you logged out, or the club was deleted or restored.'), res.body);
    assert.match(res.body, /<a class="btn primary block" href="\/lost"><svg[^>]*>[\s\S]*?<\/svg>Get a new link by e-mail<\/a>/);
    assert.equal(count(res.body, '<script'), 1);
    const get = await srv.get('/manage', null);
    assert.equal(get.status, 303);
    assert.equal(get.headers.get('location'), '/');
});


test('the upload pages for an unknown team', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    for (const q of ['?team=gone', '?team=__proto__', '']) {
        const res = await srv.get(`/manage/upload${q}`);
        assert.equal(res.status, 404, q);
        const body = await res.text();
        assert.ok(body.includes('This team no longer exists.'), q);
        assert.ok(!body.includes('http-equiv'), q);
    }
});


// Decision 13: the pages that need the script say so without it; the pages that work without it
// (Make live and Back confirm pages, the rider code, gone and signed-out pages) do not.
test('the no-script note only where the page needs the script', async () => {
    const {signedOutPage} = await import('../ui.mjs');
    const {entryGonePage} = await import('../store-form.mjs');
    const {teamGonePage, liveConfirmPage} = await import('../team-page.mjs');
    const {codePage} = await import('../settings-page.mjs');
    const {uploadPage} = await import('../upload-page.mjs');
    const c = makeClub();
    const id = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const NOTE = 'This page needs JavaScript. Make live and every button that asks first still work without it.';
    // what the captain frame draws its sidebar with (manage-page.mjs frameOf)
    const frame = {now: NOW, seen: {}, multi: false};
    const without = {
        signedOutPage: signedOutPage(),
        entryGonePage: entryGonePage(c.club, frame),
        teamGonePage: teamGonePage(c.club, frame),
        codePage: codePage(c.club, 'ABCDE12345', frame),
        liveConfirmPage: liveConfirmPage(c.club, 'rollers', id, {...frame, words: 'Riders get it at once.'}),
    };
    for (const [name, page] of Object.entries(without)) {
        assert.ok(page.includes('<a class="skip" href="#main">'), name);
        assert.ok(!page.includes(NOTE) && !page.includes('class="nojs"'), name);
    }
    assert.equal(count(uploadPage(c.club, 'rollers', {now: NOW}), NOTE), 1, 'the upload page needs it');
});


// The captain pages and mails say plan (the mod says plan too); only the privacy page and /admin keep
// their wording (spec 5.4). Internal names (sheet, sheets, /manage/sheet/*) stay.
test('copy: captain pages and mails say plan', () => {
    // COPY is pages.mjs's table of texts (T in the other test files is a time builder); a guard
    // against a vacuous pass if the table moves or comes up empty.
    assert.ok(Object.keys(COPY).length > 500, `${Object.keys(COPY).length} texts`);
    const hits = Object.entries(COPY).filter(([k, v]) => !/^(privacy|admin)-/.test(k) && /\bsheets?\b/i.test(v));
    assert.deepEqual(hits.map(([k]) => k), []);
    // the captain pages are one team page, a teams page and settings now: no text sends a reader to "the club page"
    const old = Object.entries(COPY).filter(([k, v]) => /\bclub page\b/i.test(v));
    assert.deepEqual(old.map(([k]) => k), []);
});


test('singular counts: "0 of 1 has the plan", "its 1 team, 1 plan and 1 recording"', async t => {
    const c = makeClub({teams: [['Rollers', '19:30']]});
    const live = upload(c.club, 'rollers', {type: 'solo', riders: ['1001'], at: T('2026-11-19T14:00:00Z')});
    const sig = c.club.sheets[live].sig;
    const srv = await serve(t, c);
    // after the gate: the riders card counts one rider
    let body = await teamBody(srv, 'rollers');
    assert.match(body, /<span class="count"><strong>0 of 1<\/strong> has the plan<\/span>/);
    srv.see('1001', '2026-11-19T18:22:00Z', {sig, mod: '0.3.0', sheet: live, inEvent: true, event: null});
    body = await teamBody(srv, 'rollers');
    assert.match(body, /<span class="count"><strong>1 of 1<\/strong> has the plan<\/span>/);
    // the danger zone: one of each; a second version of the plan is still one plan
    srv.store.change(CID, cl => uploadSheet(cl, {
        slug: 'rollers', json: planJson('Rollers solo', ['1001', '1002']), text: null, as: live, live: false,
        base: cl.teams.rollers.version, pinnedEventId: null, via: 'file',
    }, {now: T('2026-11-19T18:23:00Z'), newId: () => 'vv0002'}));
    assert.equal(Object.keys(srv.store.get(CID).sheets).length, 2);
    srv.server.logs.put(CID, 'rollers', `${T('2026-11-12T18:31:00Z')}-1001.jsonl.gz`, Buffer.alloc(1000));
    const danger = textOf(element(await pageBody(srv, '/manage/settings'), '<section class="danger-zone"'));
    assert.ok(danger.includes('Deletes the club with its 1 team, 1 plan and 1 recording. Riders get no plans from it any more.'), danger);
});


test('activity: a cleared start time says so', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    for (const start of ['19:45', '']) {
        const done = await followPost(srv, c.cookie, '/manage/team', {action: 'start', team: 'rollers', start});
        assert.equal(done.flash.kind, 'ok');
    }
    const act = sectionOf(await pageBody(srv, '/manage/settings'), 'act-h');
    const items = [...act.matchAll(/<li><time>[^<]*<\/time><span>([\s\S]*?)<\/span><\/li>/g)].map(m => textOf(m[1]).trim());
    assert.deepEqual(items.slice(0, 2), ['Rollers · Start time cleared', 'Rollers · Start time 19:45']);
});


// Kettenfett RC with Rollers 19:30, Sprockets 19:40 (both weekly) and Cogs 19:30 (special), no plans.
function kindsClub() {
    const c = makeClub({teams: [['Rollers', '19:30'], ['Sprockets', '19:40'], ['Cogs', '19:30']]});
    c.club.teams.cogs.kind = 'special';
    return c;
}


test('picker: other teams fold; a special team unfolds once it has a plan', async t => {
    const c = kindsClub();
    const srv = await serve(t, c);
    const body = await srv.body();
    assert.deepEqual(tiles(body).map(x => x.href), ['/manage/team/rollers', '/manage/team/sprockets']);
    // the fold holds no form input: it does not hold the guarded reload (data-keep-refresh, Task 8c)
    const fold = element(body, '<details class="fold" data-keep-refresh>');
    assert.ok(fold, body);
    assert.ok(fold.startsWith('<details class="fold" data-keep-refresh><summary>Other teams (1)</summary><ul class="tiles">'), fold);
    // no race planned is neutral, said in the status line; a special team has no time line then,
    // even with a start time from its weekly days (the coordinator, 19 Nov 2026)
    assert.deepEqual(tiles(fold).map(x => [x.href, x.time]), [['/manage/team/cogs', '']]);
    assert.ok(fold.includes('<a class="tile edge-neutral" href="/manage/team/cogs">'), fold);
    assert.ok(textOf(fold).includes('No race planned Upload a plan with its date and start time'), textOf(fold));
    assert.ok(!fold.includes('No plan: riders get nothing'));
    // below the main tiles and "Add a team"
    assert.ok(body.indexOf('class="tile add"') < body.indexOf('<details class="fold"'));
    // a Cogs plan for 29 Nov: Cogs joins the main tiles, in teamOrder (19:30 like Rollers, then by name)
    // (a special team's new plan needs its start time too, user 19 Nov 2026)
    const {status, body: stored} = await storeUpload(srv, c.cookie, {team: 'cogs', json: planJson('Cogs', ['1009'])}, {as: 'new', date: '2026-11-29', start: '19:30'});
    assert.equal(status, 303, stored);
    const after = await srv.body();
    assert.deepEqual(tiles(after).map(x => x.href), ['/manage/team/cogs', '/manage/team/rollers', '/manage/team/sprockets']);
    assert.ok(!after.includes('Other teams'));
    assert.ok(!after.includes('<details class="fold"'));
});


test('team settings: race rhythm on the team\'s own day; the club settings have no race day', async t => {
    const c = kindsClub();
    const srv = await serve(t, c);
    const body = await pageBody(srv, '/manage/team/rollers/settings');
    const rhythm = teamForm(body, 'rhythm');
    assert.ok(body.includes('<h2 id="rhythm-h">Race day and time</h2>'), body);
    assert.ok(rhythm.includes('<form class="stack" method="post" action="/manage/team">'), rhythm);
    assert.ok(rhythm.includes('<input type="hidden" name="team" value="rollers">'), rhythm);
    assert.ok(rhythm.includes('<input type="radio" name="kind" value="weekly" checked>'), rhythm);
    assert.ok(rhythm.includes('<input type="radio" name="kind" value="special">'), rhythm);
    assert.ok(rhythm.includes('<strong>Every week</strong></span></label>'), rhythm);
    assert.ok(!textOf(rhythm).includes('Every week on'), textOf(rhythm));
    assert.ok(rhythm.includes('<strong>On single dates</strong><span>Choose the date and time when you store a plan.</span>'), rhythm);
    assert.ok(rhythm.includes('<label class="field">Race day<select name="weekday">'), rhythm);
    assert.ok(!rhythm.includes('weekday-hint') && !textOf(rhythm).includes('club'), rhythm);
    // the team's own day, Thursday here; no option follows a club's day
    const select = element(rhythm, '<select name="weekday">');
    assert.deepEqual([...select.matchAll(/<option value="([^"]*)"( selected)?>([^<]*)<\/option>/g)].map(m => [m[1], !!m[2], textOf(m[3])]), [
        ['1', false, 'Monday'], ['2', false, 'Tuesday'], ['3', false, 'Wednesday'],
        ['4', true, 'Thursday'], ['5', false, 'Friday'], ['6', false, 'Saturday'], ['7', false, 'Sunday'],
    ]);
    assert.ok(!select.includes('value=""'), select);

    // Cogs: special
    const v = VERSION_OF(srv, 'cogs');
    const done = await followPost(srv, c.cookie, '/manage/team', {action: 'kind', team: 'cogs', kind: 'special', weekday: ''});
    assert.equal(done.location, '/manage/team/cogs/settings');
    assert.deepEqual(done.flash, {kind: 'ok', text: 'Cogs: On single dates, chosen when you store a plan.'});
    assert.ok(done.page.includes('<input type="radio" name="kind" value="special" checked>'), done.page);
    assert.equal(VERSION_OF(srv, 'cogs'), v + 1);
    // Sprockets: every Tuesday
    const tue = await followPost(srv, c.cookie, '/manage/team', {action: 'kind', team: 'sprockets', kind: 'weekly', weekday: '2'});
    assert.deepEqual(tue.flash, {kind: 'ok', text: 'Sprockets: Every week on Tuesday.'});
    assert.ok(tue.page.includes('<option value="2" selected>Tuesday</option>'), tue.page);
    assert.equal(srv.store.get(CID).teams.sprockets.weekday, 2);
    assert.ok(teamForm(tue.page, 'rhythm').includes('<input type="radio" name="kind" value="weekly" checked>'));
    // refused: the settings with the text, nothing changed
    for (const [fields, text] of [
        [{kind: 'monthly', weekday: ''}, 'Choose every week or single dates.'],
        [{kind: 'weekly', weekday: '8'}, 'Choose a weekday.'],
        [{kind: 'weekly', weekday: 'Mon'}, 'Choose a weekday.'],
    ]) {
        const bad = await post(srv, c.cookie, '/manage/team', {action: 'kind', team: 'rollers', ...fields});
        assert.equal(bad.status, 400, bad.body);
        assert.deepEqual(flashOf(bad.body), {kind: 'err', text});
        assert.ok(bad.body.includes('<p class="kicker keep">Team settings</p>'));
    }
    assert.equal(srv.store.get(CID).teams.rollers.kind, 'weekly');
    assert.equal(srv.store.get(CID).teams.rollers.weekday, 4);
    // made weekly again without a day posted (a page from before): its own day stays
    await followPost(srv, c.cookie, '/manage/team', {action: 'kind', team: 'sprockets', kind: 'weekly'});
    assert.deepEqual([srv.store.get(CID).teams.sprockets.kind, srv.store.get(CID).teams.sprockets.weekday], ['weekly', 2]);
    await followPost(srv, c.cookie, '/manage/team', {action: 'kind', team: 'cogs', kind: 'weekly', weekday: ''});
    assert.deepEqual([srv.store.get(CID).teams.cogs.kind, srv.store.get(CID).teams.cogs.weekday], ['weekly', 4], 'special had none: Thursday');

    // the club settings: name and zone, no race day
    const settings = await pageBody(srv, '/manage/settings');
    const club = element(settings, '<form class="stack" method="post" action="/manage/club">');
    assert.ok(club.includes('name="name"') && club.includes('name="tz"'), club);
    assert.ok(!settings.includes('name="weekday"'), settings);
    assert.ok(!textOf(club).includes('Race day'), textOf(club));
    assert.equal(Object.hasOwn(srv.store.get(CID), 'weekday'), false);
});


// ---- race day and time: the race rhythm and the start time in one card (user, 22 Nov 2026) ----

test('team settings: race day and time is one card with one form, as Add a team has it', async t => {
    const c = kindsClub();
    upload(c.club, 'rollers', {riders: ROLLERS, at: T('2026-11-19T10:00:00Z')});
    const srv = await serve(t, c);
    for (const slug of ['rollers', 'sprockets']) {
        const body = await pageBody(srv, `/manage/team/${slug}/settings`);
        // the old cards are gone, and so are their forms
        assert.ok(!body.includes('id="start-h"') && !body.includes('id="kind-h"'), body);
        assert.ok(!body.includes('<input type="hidden" name="action" value="start">'), body);
        assert.ok(!body.includes('<input type="hidden" name="action" value="kind">'), body);
        assert.equal(count(body, '<input type="hidden" name="action" value="rhythm">'), 1);
        const card = element(body, '<section class="card" aria-labelledby="rhythm-h">');
        assert.ok(card, body);
        assert.ok(card.includes('<h2 id="rhythm-h">Race day and time</h2>'), card);
        assert.equal(count(card, '<form '), 1, card);
        const form = teamForm(body, 'rhythm');
        assert.ok(form.includes('<input type="hidden" name="team" value="' + slug + '">'), form);
        // the fieldset of Add a team: the weekday and the start time under the weekly choice
        const weekly = element(form, '<div class="stack" data-weekly>');
        assert.ok(weekly.includes('<select name="weekday">'), weekly);
        assert.ok(weekly.includes(`<input type="time" name="start" value="${slug === 'rollers' ? '19:30' : '19:40'}">`), weekly);
        assert.ok(weekly.includes(`<label class="field">Start time<input type="time" name="start" value="${slug === 'rollers' ? '19:30' : '19:40'}"><span class="hint">In Europe/Berlin. New races start at this time.</span></label>`), weekly);
        assert.ok(form.includes('<input type="radio" name="kind" value="weekly" checked>'), form);
        // the hidden legend says what the heading says (Add a team keeps "When does the team race?")
        assert.ok(form.includes('<legend class="sr">Race day and time</legend>'), form);
        assert.equal(count(form, 'name="start"'), 1);
        assert.equal(count(form, '<button class="btn primary" type="submit"'), 1, form);
        assert.ok(textOf(form).includes('Save race day and time'), textOf(form));
        // in the order of the old cards: after the name, before the danger zone
        assert.ok(body.indexOf('id="name-h"') < body.indexOf('id="rhythm-h"') && body.indexOf('id="rhythm-h"') < body.indexOf('class="danger-zone"'));
    }
    // Rollers races within 7 days: emptying its start time asks in place (S11); Sprockets has no plan
    const rollers = await pageBody(srv, '/manage/team/rollers/settings');
    const armed = armOf(rollers, '/manage/team');
    assert.ok(armed.startsWith('<form class="stack" method="post" action="/manage/team" data-arm data-arm-when="empty" data-arm-field="start">'), armed);
    assert.ok(armHas(armed, '/manage/team', '<input type="hidden" name="action" value="rhythm"><input type="hidden" name="team" value="rollers">', 'btn danger', 'Clear start time'), armed);
    assert.ok(textOf(armed).includes('Without a start time riders get nothing from Rollers, also for its races in the next 7 days.'), textOf(armed));
    assert.ok(!(await pageBody(srv, '/manage/team/sprockets/settings')).includes('data-arm-field="start"'));
});


test('team settings: race day and time, weekday and start in one save', async t => {
    const c = kindsClub();
    const srv = await serve(t, c);
    const team = () => srv.store.get(CID).teams.sprockets;
    const v = VERSION_OF(srv, 'sprockets');
    const done = await followPost(srv, c.cookie, '/manage/team', {action: 'rhythm', team: 'sprockets', kind: 'weekly', weekday: '2', start: '20:05'});
    assert.equal(done.location, '/manage/team/sprockets/settings');
    assert.deepEqual(done.flash, {kind: 'ok', text: 'Sprockets: Every week on Tuesday at 20:05.'});
    assert.deepEqual([team().kind, team().weekday, team().start], ['weekly', 2, '20:05']);
    // one change of the club, each part bumps the team once
    assert.equal(VERSION_OF(srv, 'sprockets'), v + 2);
    const form = teamForm(done.page, 'rhythm');
    assert.ok(form.includes('<option value="2" selected>Tuesday</option>') && form.includes('name="start" value="20:05"'), form);
    // only the start: the start's own message; only it is logged
    const start = await followPost(srv, c.cookie, '/manage/team', {action: 'rhythm', team: 'sprockets', kind: 'weekly', weekday: '2', start: '20:10'});
    assert.deepEqual(start.flash, {kind: 'ok', text: 'Start time of Sprockets: 20:10.'});
    assert.equal(VERSION_OF(srv, 'sprockets'), v + 3);
    // only the day: no word about the start
    const day = await followPost(srv, c.cookie, '/manage/team', {action: 'rhythm', team: 'sprockets', kind: 'weekly', weekday: '5', start: '20:10'});
    assert.deepEqual(day.flash, {kind: 'ok', text: 'Sprockets: Every week on Friday.'});
    assert.equal(VERSION_OF(srv, 'sprockets'), v + 4);
    // nothing changed: the rhythm is said, nothing bumped
    const same = await followPost(srv, c.cookie, '/manage/team', {action: 'rhythm', team: 'sprockets', kind: 'weekly', weekday: '5', start: '20:10'});
    assert.deepEqual(same.flash, {kind: 'ok', text: 'Sprockets: Every week on Friday.'});
    assert.equal(VERSION_OF(srv, 'sprockets'), v + 4);
    // a blank weekday (a form without it) is the team's own day
    await followPost(srv, c.cookie, '/manage/team', {action: 'rhythm', team: 'sprockets', kind: 'weekly', weekday: '', start: '20:10'});
    assert.equal(team().weekday, 5);
    // without plans the start is cleared at once
    const cleared = await followPost(srv, c.cookie, '/manage/team', {action: 'rhythm', team: 'sprockets', kind: 'weekly', weekday: '5', start: ''});
    assert.deepEqual(cleared.flash, {kind: 'ok', text: 'Sprockets has no start time now.'});
    assert.equal(team().start, null);
    // the club log: what changed, each once, in order
    const log = srv.store.get(CID).log.filter(e => e.team === 'sprockets' && (e.what === 'team-kind' || e.what === 'team-start')).map(e => [e.what, e.label]);
    assert.deepEqual(log, [['team-kind', 'weekly, Tuesday'], ['team-start', '20:05'], ['team-start', '20:10'], ['team-kind', 'weekly, Friday'], ['team-start', '']]);
});


test('team settings: race day and time, a weekly start emptied with a race within 7 days asks first (S11)', async t => {
    const c = kindsClub();
    upload(c.club, 'rollers', {riders: ROLLERS, at: T('2026-11-19T10:00:00Z')});
    const srv = await serve(t, c);
    const team = () => srv.store.get(CID).teams.rollers;
    const file = storedClub(srv);
    const res = await post(srv, c.cookie, '/manage/team', {action: 'rhythm', team: 'rollers', kind: 'weekly', weekday: '3', start: ''});
    assert.equal(res.status, 200, res.body);
    assert.ok(res.body.includes('<h1>Clear the start time of Rollers?</h1>'), res.body);
    assert.ok(textOf(res.body).includes('Without a start time riders get nothing from Rollers, also for its races in the next 7 days.'), textOf(res.body));
    assert.ok(res.body.includes(`<form method="post" action="/manage/team">${CLUB_FIELD}<input type="hidden" name="action" value="rhythm"><input type="hidden" name="kind" value="weekly"><input type="hidden" name="weekday" value="3"><input type="hidden" name="start" value=""><input type="hidden" name="team" value="rollers"><input type="hidden" name="confirm" value="1"><button class="btn danger" type="submit">Clear start time</button></form>`), res.body);
    // nothing changed
    assert.equal(storedClub(srv), file);
    const done = await followPost(srv, c.cookie, '/manage/team', {action: 'rhythm', team: 'rollers', kind: 'weekly', weekday: '3', start: '', confirm: '1'});
    assert.deepEqual(done.flash, {kind: 'ok', text: 'Rollers: Every week on Wednesday, without a start time. Races already planned keep their time; change one in its ⋯.'});
    assert.deepEqual([team().weekday, team().start], [3, null]);
    // already without a start time nothing is emptied: no question
    const again = await followPost(srv, c.cookie, '/manage/team', {action: 'rhythm', team: 'rollers', kind: 'weekly', weekday: '4', start: ''});
    assert.deepEqual(again.flash, {kind: 'ok', text: 'Rollers: Every week on Thursday.'});
    // and the in-page question is not drawn then (an empty field would ask at every save)
    assert.ok(!again.page.includes('data-arm-field="start"'), again.page);
    // switching to special never asks, even with the start field emptied: the start stays
    await followPost(srv, c.cookie, '/manage/team', {action: 'rhythm', team: 'rollers', kind: 'weekly', weekday: '4', start: '19:30'});
    const special = await followPost(srv, c.cookie, '/manage/team', {action: 'rhythm', team: 'rollers', kind: 'special', weekday: '', start: ''});
    assert.equal(special.flash.text, 'Rollers: On single dates, chosen when you store a plan. Its plans keep their race times; new plans bring their own.');
    assert.deepEqual([team().kind, team().weekday, team().start], ['special', null, '19:30']);
});


test('team settings: race day and time of a special team ignores the posted start; a refusal keeps what was typed', async t => {
    const c = kindsClub();
    upload(c.club, 'rollers', {riders: ROLLERS, at: T('2026-11-19T10:00:00Z')});
    const srv = await serve(t, c);
    const team = slug => srv.store.get(CID).teams[slug];
    // Cogs (special, stored 19:30): the card has special checked, the weekly fields with its stored start
    const cogs = await pageBody(srv, '/manage/team/cogs/settings');
    const form = teamForm(cogs, 'rhythm');
    assert.ok(form.includes('<input type="radio" name="kind" value="special" checked>'), form);
    assert.ok(form.includes('<input type="radio" name="kind" value="weekly">'), form);
    assert.ok(element(form, '<div class="stack" data-weekly>').includes('<input type="time" name="start" value="19:30">'), form);
    assert.ok(!textOf(cogs).includes('A special team\'s races each have their own date and start time.'), textOf(cogs));
    // special: the posted start time is ignored, even one that is no time; the stored one stays
    for (const start of ['20:00', '', '25:00']) {
        const done = await followPost(srv, c.cookie, '/manage/team', {action: 'rhythm', team: 'cogs', kind: 'special', weekday: '4', start});
        assert.deepEqual(done.flash, {kind: 'ok', text: 'Cogs: On single dates, chosen when you store a plan.'}, start);
        assert.deepEqual([team('cogs').kind, team('cogs').weekday, team('cogs').start], ['special', null, '19:30'], start);
    }
    // Rollers made special: the stored start stays; made weekly again with a new one, the flash says
    // its races already planned keep their time (user, 23 Nov 2026)
    await followPost(srv, c.cookie, '/manage/team', {action: 'rhythm', team: 'rollers', kind: 'special', weekday: '4', start: '21:00'});
    assert.equal(team('rollers').start, '19:30');
    const back = await followPost(srv, c.cookie, '/manage/team', {action: 'rhythm', team: 'rollers', kind: 'weekly', weekday: '4', start: '19:50'});
    assert.deepEqual(back.flash, {kind: 'ok', text: 'Rollers: Every week on Thursday at 19:50. Races already planned keep their time; change one in its ⋯.'});
    assert.deepEqual([team('rollers').kind, team('rollers').start], ['weekly', '19:50']);
    // refused: the settings with the text and the form as typed, nothing changed
    const file = storedClub(srv);
    for (const [fields, text, check] of [
        [{kind: 'weekly', weekday: '5', start: '25:00'}, 'Enter the start time as HH:MM.',
            f => f.includes('<option value="5" selected>Friday</option>') && f.includes('name="start" value="25:00"') && f.includes('value="weekly" checked')],
        [{kind: 'monthly', weekday: '2', start: '20:00'}, 'Choose every week or single dates.',
            f => f.includes('<option value="2" selected>Tuesday</option>') && f.includes('name="start" value="20:00"')],
        [{kind: 'weekly', weekday: '8', start: '18:00'}, 'Choose a weekday.', f => f.includes('name="start" value="18:00"')],
        [{kind: 'special', weekday: '9', start: '17:00'}, 'Choose a weekday.', f => f.includes('value="special" checked') && f.includes('name="start" value="17:00"')],
    ]) {
        const bad = await post(srv, c.cookie, '/manage/team', {action: 'rhythm', team: 'rollers', ...fields});
        assert.equal(bad.status, 400, bad.body);
        assert.deepEqual(flashOf(bad.body), {kind: 'err', text});
        assert.ok(bad.body.includes('<p class="kicker keep">Team settings</p>'));
        assert.ok(check(teamForm(bad.body, 'rhythm')), `${text}: ${teamForm(bad.body, 'rhythm')}`);
        // the other form keeps the stored value
        assert.ok(teamForm(bad.body, 'rename').includes('value="Rollers"'));
    }
    assert.equal(storedClub(srv), file);
    // a team that is gone: refused
    const gone = await post(srv, c.cookie, '/manage/team', {action: 'rhythm', team: 'gone', kind: 'weekly', weekday: '4', start: ''});
    assert.equal(gone.status, 400);
    assert.equal(flashOf(gone.body)?.kind, 'err');
    assert.equal(storedClub(srv), file);
});


test('team settings: the old start and kind actions still work (a page open from before)', async t => {
    const c = kindsClub();
    const srv = await serve(t, c);
    const team = () => srv.store.get(CID).teams.sprockets;
    let done = await followPost(srv, c.cookie, '/manage/team', {action: 'start', team: 'sprockets', start: '20:20'});
    assert.deepEqual(done.flash, {kind: 'ok', text: 'Start time of Sprockets: 20:20.'});
    assert.equal(team().start, '20:20');
    // its page now shows the one card with the new start
    assert.ok(teamForm(done.page, 'rhythm').includes('name="start" value="20:20"'), done.page);
    done = await followPost(srv, c.cookie, '/manage/team', {action: 'kind', team: 'sprockets', kind: 'weekly', weekday: '6'});
    assert.deepEqual(done.flash, {kind: 'ok', text: 'Sprockets: Every week on Saturday.'});
    assert.deepEqual([team().weekday, team().start], [6, '20:20']);
    // a refused old start shows its typed value in the one card
    const bad = await post(srv, c.cookie, '/manage/team', {action: 'start', team: 'sprockets', start: '7pm'});
    assert.equal(bad.status, 400);
    assert.ok(teamForm(bad.body, 'rhythm').includes('name="start" value="7pm"'), bad.body);
});


test('team page: a special team without a race', async t => {
    const c = kindsClub();
    const srv = await serve(t, c);
    const body = await teamBody(srv, 'cogs');
    assert.ok(body.includes('<p class="race"><span>No race planned</span></p>'), body);
    // neutral, not the red "No plan: riders get nothing" (Task 8b review): the switcher and its rows
    assert.match(body, /<span class="sw-icon neutral">/);
    assert.ok(body.includes('<a class="trow neutral" href="/manage/team/cogs" aria-current="page">'), body);
    assert.ok(textOf(element(body, '<details class="switch"')).includes('Cogs No race planned'), textOf(element(body, '<details class="switch"')));
    // the empty card asks for the plan with its date; no "from ," without a gate
    assert.ok(textOf(body).includes('No plan for Cogs yet A plan brings its date and start time; riders get it 30 min before the start.'), textOf(body));
    assert.ok(!body.includes('<time></time>'));
    // a weekly team has its day: its regular race, neutral (spec §8)
    assert.ok(textOf(await teamBody(srv, 'rollers')).includes('Next regular race Thu 19 Nov 19:30'));
});


test('Store form: a special team without a plan needs a date', async t => {
    const c = kindsClub();
    const srv = await serve(t, c);
    const id = await intake(srv, c.cookie, {team: 'cogs', json: planJson('Cogs', ['1009'])});
    const body = element(await storeFormOf(srv, id), '<div class="cp-form"');
    assert.ok(/<input type="date" name="date" value="" required>/.test(body), body);
    assert.equal(count(body, 'name="date"'), 1);
    // Store without a date: refused, the entry stays
    const stored = await storePost(srv, c.cookie, id, {team: 'cogs', as: 'new', live: 'on', confirm: '1', base: String(VERSION_OF(srv, 'cogs')), drawn: 'cogs:new', date: '', type: ''});
    assert.equal(stored.status, 400, stored.body);
    assert.deepEqual(flashOf(stored.body), {kind: 'err', text: 'Enter the race date as YYYY-MM-DD.'});
    assert.equal(srv.store.get(CID).inbox.length, 1);
    assert.equal(Object.keys(srv.store.get(CID).sheets).length, 0);
    // a weekly team's date has a default, so it is not required
    const rid = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers', ROLLERS)});
    const rollers = element(await storeFormOf(srv, rid), '<div class="cp-form"');
    assert.ok(rollers.includes('<input type="date" name="date" value="2026-11-19">'), rollers);
    assert.equal(rollers.includes('<details class="card fold">'), false, 'no fold: the form is not folded in the team page');
});


// ---- the team page as a race-day cockpit, the plan page, every Make live confirmed (Task 8c) ----


// The label of a plan's block (its first <span class="label">).
const rowLabel = row => textOf(/<span class="label(?: sr)?">([\s\S]*?)<\/span>/.exec(row)[1]);


test('team page: one block per plan, no … menu, no status card, no fixed upload bar', async t => {
    const c = makeClub();
    const fast = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ROLLERS.slice(0, 6), at: T('2026-11-19T14:10:00Z'), live: false});
    const srv = await serve(t, c);
    const body = await teamBody(srv, 'rollers');
    assert.ok(!body.includes('<details class="more"'), 'no … menu');
    assert.ok(!body.includes('class="actionbar"'), 'no fixed upload bar');
    assert.ok(!body.includes('has-actionbar'));
    assert.ok(!/class="sevline [a-z]+ big"/.test(body), 'no status card');
    assert.ok(!body.includes('What changed'), 'no "What changed" fold');
    assert.match(body, /<body class="teampage cockpit/);
    // the upload link: a button in the head (UI panel wave 3), before the plans, and its copy at the
    // list's top (from 1180 px, user 23 Nov 2026: the head's gives way there); the card's body (the
    // riders) after the list, no third column
    assert.equal(count(body, 'href="/manage/upload?team=rollers"'), 2);
    assert.equal(count(element(body, '<div class="cp-ways"'), 'href="/manage/upload?team=rollers"'), 1);
    assert.ok(body.indexOf('class="headacts"') < body.indexOf('class="cp-list"'));
    assert.ok(body.indexOf('class="cp-body"') > body.indexOf('class="cp-list"'));
    assert.ok(!body.includes('uplink') && !body.includes('col-c'));
    // one block per plan, its version rows each a link to the page with it picked; the live one to
    // its race's live pointer (?r=), so a reload follows live
    const blocks = elements(body, '<section class="cp-plan');
    assert.deepEqual(blocks.map(rowLabel), ['fast', 'slow']);
    assert.ok(blocks[0].includes(`href="/manage/team/rollers?r=${DATE}#panel"`) && !blocks[0].includes(`?v=${fast}#panel`), blocks[0]);
    assert.ok(blocks[1].includes(`href="/manage/team/rollers?v=${slow}#panel"`), blocks[1]);
    // the race line after the gate: no "open since", the live row says "Sending" (user, 23 Nov 2026)
    assert.equal(textOf(/<p class="race">([\s\S]*?)<\/p>/.exec(body)[1]).trim(), 'Thu 19 Nov · 19:30 · in 5 min');
});


test('team page: after a switch only the LIVE mark moves', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ROLLERS.slice(0, 6), at: T('2026-11-19T14:10:00Z'), live: false});
    const srv = await serve(t, c);
    const order = page => [page.indexOf('<span class="label">fast</span>'), page.indexOf('<span class="label">slow</span>')];
    const liveRow = page => elements(page, '<section class="cp-plan').find(r => r.includes('<span class="tag">Live</span>'));
    const before = await teamBody(srv, 'rollers');
    const [f0, s0] = order(before);
    assert.ok(f0 > 0 && f0 < s0, `${f0} ${s0}`);
    assert.equal(rowLabel(liveRow(before)), 'fast');
    const made = await followPost(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: slow, confirm: '1'});
    assert.equal(liveId(srv.store.get(CID), 'rollers'), slow);
    const [f1, s1] = order(made.page);
    assert.ok(f1 > 0 && f1 < s1, `${f1} ${s1}`);
    assert.equal(rowLabel(liveRow(made.page)), 'slow');
    // the live row's mark and the card's title (it stands for the version now live): two, no more
    assert.equal(count(made.page, '<span class="tag">Live</span>'), 2);
    assert.ok(element(made.page, '<h2 class="cp-title"').includes('<span class="tag">Live</span>'), element(made.page, '<h2 class="cp-title"'));
});


test('make live while the gate is open asks first, in its place and without the script', async t => {
    const c = makeClub();
    const fast = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ROLLERS.slice(0, 6), at: T('2026-11-19T14:10:00Z'), live: false});
    const srv = await serve(t, c);
    const body = await pageBody(srv, `/manage/team/rollers?v=${slow}`);
    // 19:25, the gate (19:00) is open: every Make live form asks first in its place (arm in place, UI
    // panel wave 2): its trigger posts without confirm, its strip's button with confirm=1
    const forms = [...body.matchAll(/<form method="post" action="\/manage\/live"[^>]*>[\s\S]*?<\/form>/g)];
    assert.ok(forms.length >= 1, body);
    for (const m of forms) {
        assert.ok(m[0].startsWith('<form method="post" action="/manage/live" data-arm>'), m[0]);
        assert.ok(!m[0].includes('<input type="hidden" name="confirm"'), m[0]);
        assert.ok(/<div class="arm-strip" role="group" aria-label="Confirm: Make live" data-arm-strip hidden><p id="(arm-[^"]+)">[^<]+<\/p><div class="arm-btns"><button class="btn primary small" type="submit" name="confirm" value="1" aria-describedby="\1" data-arm-yes>Make live<\/button><button class="btn secondary" type="button" data-arm-cancel>Cancel<\/button><\/div><\/div><\/form>$/.test(m[0]), m[0]);
    }
    // in the panel of the picked version, which names it in its head
    const ask = armOf(element(body, '<div id="panel-acts"'));
    assert.ok(textOf(ask).includes('Make live v1 of \'Rollers · slow\' Riders in the event get \'Rollers · slow\' v1 instead of \'Rollers · fast\' v1 within a minute.'), textOf(ask));
    assert.ok(textOf(element(body, '<div id="panel"')).includes('\'slow\' v1 · stored'));
    // the trigger comes first, the strip (shipped hidden) after it, in the same form
    assert.ok(ask.indexOf('data-arm-open') < ask.indexOf('data-arm-strip hidden'), ask);
    // a POST without confirm: the question, nothing changed
    const file = storedClub(srv);
    const res = await post(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: slow});
    assert.equal(res.status, 200, res.body);
    assert.ok(res.body.includes('<h1>Make &#39;Rollers · slow&#39; v1 live?</h1>'), res.body);
    assert.ok(textOf(res.body).includes('Riders in the event get \'Rollers · slow\' v1 instead of \'Rollers · fast\' v1 within a minute.'), textOf(res.body));
    assert.ok(res.body.includes(`<input type="hidden" name="sheet" value="${slow}"><input type="hidden" name="version" value="${VERSION_OF(srv, 'rollers')}"><input type="hidden" name="confirm" value="1">`), res.body);
    assert.ok(!res.body.includes('http-equiv'));
    assert.equal(liveId(srv.store.get(CID), 'rollers'), fast);
    assert.equal(storedClub(srv), file);
    // with confirm: done
    const yes = await post(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: slow, confirm: '1'});
    assert.equal(yes.status, 303);
    assert.equal(liveId(srv.store.get(CID), 'rollers'), slow);
});


// The fields of the Make live form for version `sheet` on a page, as the browser would post them
// once confirmed: its hidden fields, and confirm=1 from the strip's button of a form that asks first.
function liveFormOf(body, sheet) {
    const form = [...body.matchAll(/<form method="post" action="\/manage\/live"[^>]*>[\s\S]*?<\/form>/g)].map(m => m[0])
        .find(f => f.includes(`name="sheet" value="${sheet}"`));
    assert.ok(form, `no Make live for ${sheet}`);
    const fields = Object.fromEntries([...form.matchAll(/<input type="hidden" name="([^"]*)" value="([^"]*)">/g)].map(m => [m[1], m[2]]));
    return form.includes('name="confirm" value="1" aria-describedby=') ? {...fields, confirm: '1'} : fields;
}


test('make live: a page drawn before another change is refused, nothing changes', async t => {
    // UI panel, 19 Nov 2026 (audit S7): Make live, Make vN live and the no-script confirm carry the
    // team's version like Restore, so a stale page cannot replace a newer live plan
    const c = makeClub();
    const fast = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const v2 = version(c.club, 'rollers', fast, ROLLERS.slice(1), '2026-11-19T15:00:00Z', {live: false});
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ['1009'], at: T('2026-11-19T14:30:00Z'), live: false});
    const srv = await serve(t, c);
    const ver = String(VERSION_OF(srv, 'rollers'));
    // the panel's Make live of slow, the panel's of the newer v2 (its row has none, user 23 Nov 2026),
    // the no-script question
    const row = liveFormOf(await pageBody(srv, `/manage/team/rollers?v=${slow}`), slow);
    assert.equal(element(await teamBody(srv, 'rollers'), `<li class="cp-row" data-sel="v:${v2}">`).includes('<form'), false);
    const newer = liveFormOf(await pageBody(srv, `/manage/team/rollers?v=${v2}`), v2);
    const asked = await post(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: slow, version: ver});
    assert.equal(asked.status, 200, asked.body);
    const confirmPage = liveFormOf(asked.body, slow);
    for (const fields of [row, newer, confirmPage]) {
        assert.equal(fields.version, ver, JSON.stringify(fields));
    }
    // another captain makes the newer v2 live meanwhile
    await followPost(srv, c.cookie, '/manage/live', {...newer});
    assert.equal(liveId(srv.store.get(CID), 'rollers'), v2);
    const file = storedClub(srv);
    for (const [name, fields] of [
        ['panel', row], ['confirm page', confirmPage], ['panel without confirm', {...row, confirm: undefined}],
    ]) {
        const res = await post(srv, c.cookie, '/manage/live', fields);
        assert.equal(res.status, 409, `${name}: ${res.body}`);
        assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'Rollers changed since you opened the page. Nothing was changed.'}, name);
        assert.ok(res.body.includes('<nav class="topbar" aria-label="Teams">'), `${name}: drawn anew`);
        assert.ok(!res.body.includes('http-equiv'), name);
        assert.equal(storedClub(srv), file, name);
    }
    assert.equal(liveId(srv.store.get(CID), 'rollers'), v2);
    // the page drawn now carries the new version, and works
    const fresh = liveFormOf(await pageBody(srv, `/manage/team/rollers?v=${slow}`), slow);
    assert.equal(fresh.version, String(VERSION_OF(srv, 'rollers')));
    await followPost(srv, c.cookie, '/manage/live', fresh);
    assert.equal(liveId(srv.store.get(CID), 'rollers'), slow);
    // a POST without a version (a page drawn before the check) is not checked
    await followPost(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: v2, confirm: '1'});
    assert.equal(liveId(srv.store.get(CID), 'rollers'), v2);
});


// A version of the plan `as` names, stored with the type `type` (null: none), live or not.
function typedVersion(club, slug, as, riders, at, {type, live}) {
    return uploadSheet(club, {
        slug, json: planJson('Rollers fast', riders), text: null, base: club.teams[slug].version, via: 'file',
        as, live, pinnedEventId: null, type,
    }, {now: T(at), newId: () => randomId(6)}).id;
}


test('make v6 live confirms naming the plan with both versions; a version keeps its plan\'s type', async t => {
    const c = makeClub();
    const v1 = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    for (let i = 2; i <= 5; i++) {
        version(c.club, 'rollers', v1, i % 2 ? ROLLERS : ROLLERS.slice(1), `2026-11-19T14:0${i}:00Z`);
    }
    // a Store as a version sent with another type keeps its plan's (schema 4: one type per plan)
    const v6 = typedVersion(c.club, 'rollers', v1, ROLLERS.slice(2), '2026-11-19T14:10:00Z', {type: 'A', live: false});
    assert.deepEqual([c.club.sheets[v6].type, c.club.sheets[v6].label], ['fast', 'Rollers · fast']);
    const srv = await serve(t, c);
    const body = await teamBody(srv, 'rollers');
    const newer = element(body, `<li class="cp-row" data-sel="v:${v6}">`);
    assert.ok(newer, body);
    assert.equal(newer.includes('<form'), false);                                 // its Make live is in its card
    const ask = armOf(element(await pageBody(srv, `/manage/team/rollers?v=${v6}`), '<div class="cp-bar"'));
    assert.ok(ask, newer);
    assert.ok(textOf(ask).includes('Riders in the event get \'Rollers · fast\' v6 instead of \'Rollers · fast\' v5 within a minute.'), textOf(ask));
    assert.ok(armHas(ask, '/manage/live', `<input type="hidden" name="team" value="rollers"><input type="hidden" name="sheet" value="${v6}"><input type="hidden" name="version" value="${VERSION_OF(srv, 'rollers')}">`, 'btn primary small', 'Make live'), ask);
});


test('unpin and make live from a plan page left open come back to the team page', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ['1001', '1002'], at: T('2026-11-19T14:10:00Z'), live: false, pinned: 4567890});
    const srv = await serve(t, c);
    // back=plan (the plan page, gone with the team cockpit): the team page
    const unpin = await followPost(srv, c.cookie, '/manage/sheet/unpin', {team: 'rollers', sheet: slow, back: 'plan'});
    assert.equal(unpin.location, '/manage/team/rollers');
    assert.deepEqual(unpin.flash, {kind: 'ok', text: 'Removed the event link of \'Rollers · slow\'.'});
    assert.ok(unpin.page.includes('<main class="page wide cockpit"'), 'the team page');
    // the confirm page carries no back, its way back is the team page with the version picked
    const ask = await post(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: slow, back: 'plan'});
    assert.equal(ask.status, 200);
    assert.ok(ask.body.includes(`<input type="hidden" name="version" value="${VERSION_OF(srv, 'rollers')}"><input type="hidden" name="confirm" value="1">`), ask.body);
    assert.equal(ask.body.includes('name="back"'), false);
    assert.ok(ask.body.includes(`href="/manage/team/rollers?v=${slow}"`), ask.body);
    const live = await followPost(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: slow, back: 'plan', confirm: '1'});
    assert.equal(live.location, `/manage/team/rollers?r=${DATE}#panel`);
    assert.equal(liveId(srv.store.get(CID), 'rollers'), slow);
});


test('team page: the newer-version notice only as newerNotLive says', async t => {
    // team cockpit spec §5.6: a version stored before the live one went live (a step back) gets no
    // notice; one stored after it does
    const c = makeClub();
    const v1 = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const v2 = version(c.club, 'rollers', v1, ROLLERS.slice(1), '2026-11-19T14:30:00Z');
    version(c.club, 'rollers', v1, ROLLERS.slice(2), '2026-11-19T15:05:00Z');
    version(c.club, 'rollers', v1, ['1004', '1003', ...ROLLERS.slice(4)], '2026-11-19T15:40:00Z', {live: false});
    const srv = await serve(t, c);
    const noticesOf = async () => elements(await teamBody(srv, 'rollers'), '<li class="cp-row').filter(r => textOf(r).includes(' · not live'));
    assert.deepEqual((await noticesOf()).map(r => textOf(r).trim().split(' · ').slice(0, 2).join(' · ')), ['v4 · not live']);
    // v2 made live after v4 was stored: a step back, no notice
    srv.store.change(CID, cl => makeLive(cl, 'rollers', v2, T('2026-11-19T15:50:00Z')));
    assert.equal(liveId(srv.store.get(CID), 'rollers'), v2);
    assert.deepEqual(await noticesOf(), []);
    // a version stored after that: the notice is back, on that version's row (its link; its Make live
    // is in its card, user 23 Nov 2026)
    const v5 = srv.store.change(CID, cl => version(cl, 'rollers', v1, ROLLERS.slice(3), '2026-11-19T16:00:00Z', {live: false}));
    const [notice] = await noticesOf();
    assert.ok(textOf(notice).includes('v5 · not live'), textOf(notice));
    assert.ok(notice.startsWith(`<li class="cp-row" data-sel="v:${v5}"><a class="cp-link" href="/manage/team/rollers?v=${v5}#panel"`), notice);
    assert.equal(notice.includes('<form'), false);
});


test('team page: stored plans, none live', async t => {
    // fix round 1 (3): not the empty-team card
    const c = makeClub();
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ROLLERS.slice(0, 6), at: T('2026-11-19T14:10:00Z'), live: false});
    const srv = await serve(t, c);
    const body = await teamBody(srv, 'rollers');
    const text = textOf(body);
    assert.ok(text.includes('No plan is live for Rollers Make one of the plans below live, or upload another.'), text);
    assert.ok(!text.includes('No plan for this race yet'));
    assert.ok(body.indexOf('No plan is live for Rollers') < body.indexOf('<section class="cp-plan'), 'above the plans');
    // each version row leads to its panel, where Make live is
    assert.ok(elements(body, '<section class="cp-plan')[0].includes(`href="/manage/team/rollers?v=${slow}#panel"`));
    const panel = element(await pageBody(srv, `/manage/team/rollers?v=${slow}`), '<div id="panel-acts"');
    assert.ok(panel.includes('action="/manage/live"') && panel.includes(`name="sheet" value="${slow}"`), panel);
    // the empty card has no buttons here: the head has Upload a plan
    assert.match(element(body, '<header class="pagehead">'), /<div class="headacts"><a class="btn secondary small" href="\/manage\/upload\?team=rollers">/);
    assert.ok(!element(body, '<section class="card empty"').includes('class="btn'));
    // a team without plans keeps the empty card with its button, and no head buttons
    const sp = await teamBody(srv, 'sprockets');
    assert.ok(textOf(sp).includes('No plan for this race yet'));
    assert.ok(!sp.includes('class="headacts"'));
    assert.match(element(sp, '<section class="card empty"'), /<a class="btn primary block" href="\/manage\/upload\?team=sprockets">/);
});


// ---- special teams: the race rhythm at Add, the start time with each plan (user, 19 Nov 2026) ----

// The race rhythm's fieldset of a page, whole.
const rhythmOf = body => element(body, '<fieldset class="choices" data-rhythm>');


test('new team page: the race rhythm, weekly on Thursday by default, the same choices as the team settings', async t => {
    const c = kindsClub();
    const srv = await serve(t, c);
    const body = await pageBody(srv, '/manage/new-team');
    const form = teamForm(body, 'add');
    const rhythm = rhythmOf(form);
    assert.ok(rhythm, form);
    assert.ok(rhythm.includes('<legend>When does the team race?</legend>'), rhythm);
    assert.ok(rhythm.includes('<input type="radio" name="kind" value="weekly" checked>'), rhythm);
    assert.ok(rhythm.includes('<input type="radio" name="kind" value="special">'), rhythm);
    assert.ok(rhythm.includes('<strong>Every week</strong></span></label>'), rhythm);
    assert.ok(!textOf(rhythm).includes('Every week on'), textOf(rhythm));
    assert.ok(rhythm.includes('<strong>On single dates</strong><span>Choose the date and time when you store a plan.</span>'), rhythm);
    assert.ok(rhythm.includes('<option value="4" selected>Thursday</option>'), rhythm);
    assert.ok(!rhythm.includes('<option value=""'), rhythm);
    assert.equal(count(rhythm, ' selected>'), 1);
    // the start time belongs to the weekly choice: under it, before the special one
    const weekly = element(rhythm, '<div class="stack" data-weekly>');
    assert.ok(weekly.includes('<select name="weekday">'), weekly);
    assert.ok(weekly.includes('<input type="time" name="start" value="">'), weekly);
    assert.ok(textOf(weekly).includes('Start time In Europe/Berlin. You can set it later, but riders get nothing without one.'), textOf(weekly));
    // its hint under the time's box, as the team settings' (user, 23 Nov 2026: no hint between a
    // date or time field's label and its box)
    assert.ok(weekly.includes('<label class="field">Start time<input type="time" name="start" value=""><span class="hint">In Europe/Berlin. You can set it later, but riders get nothing without one.</span></label>'), weekly);
    assert.ok(rhythm.indexOf('value="weekly"') < rhythm.indexOf('data-weekly'));
    assert.ok(rhythm.indexOf('name="start"') < rhythm.indexOf('value="special"'));
    assert.equal(count(form, 'name="start"'), 1);
    // one builder: the team settings' rhythm is the same fieldset, with the team's start time and
    // the card's heading instead of the legend (user, 22 Nov 2026)
    const settings = rhythmOf(await pageBody(srv, '/manage/team/rollers/settings'));
    // (the settings' start hint, under the field, says more: user, 22 Nov 2026)
    const same = rhythm.replace('<legend>When does the team race?</legend>', '<legend class="sr">Race day and time</legend>')
        .replace('<label class="field">Start time<input type="time" name="start" value=""><span class="hint">In Europe/Berlin. You can set it later, but riders get nothing without one.</span>',
            '<label class="field">Start time<input type="time" name="start" value="19:30"><span class="hint">In Europe/Berlin. New races start at this time.</span>');
    assert.notEqual(same, rhythm);
    assert.equal(settings, same);
    // the first run's form is the same too
    const first = await serve(t, makeClub({teams: []}));
    assert.equal(rhythmOf(await first.body()), rhythm);
});


test('add a team: weekly on a day, special without a start time; a refusal keeps what was typed', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    const add = fields => followPost(srv, c.cookie, '/manage/team', {action: 'add', ...fields});
    let res = await add({name: 'Owls', kind: 'weekly', weekday: '3', start: '20:00'});
    assert.equal(res.location, '/manage/team/owls');
    assert.deepEqual(res.flash, {kind: 'ok', text: 'Added Owls.'});
    const team = slug => srv.store.get(CID).teams[slug];
    assert.deepEqual([team('owls').kind, team('owls').weekday, team('owls').start], ['weekly', 3, '20:00']);
    // special: the posted start time is ignored, even one that is no time
    res = await add({name: 'Cogs', kind: 'special', weekday: '', start: '7:3'});
    assert.equal(res.location, '/manage/team/cogs');
    assert.deepEqual([team('cogs').kind, team('cogs').weekday, team('cogs').start], ['special', null, null]);
    // its page: no race planned, neutral, not "No start time"
    assert.ok(res.page.includes('<p class="race"><span>No race planned</span></p>'), res.page);
    assert.ok(!textOf(res.page).includes('No start time'), textOf(res.page));
    // a form without the rhythm (a page from before): weekly on Thursday
    await add({name: 'Wheels', start: '19:45'});
    assert.deepEqual([team('wheels').kind, team('wheels').weekday, team('wheels').start], ['weekly', 4, '19:45']);
    // weekly with a blank day: Thursday too
    await add({name: 'Axles', kind: 'weekly', weekday: '', start: '19:45'});
    assert.deepEqual([team('axles').kind, team('axles').weekday], ['weekly', 4]);
    const teams = Object.keys(srv.store.get(CID).teams).length;
    for (const [fields, text, check] of [
        [{kind: 'monthly', weekday: '2', start: '20:00'}, 'Choose every week or single dates.',
            page => page.includes('value="weekly" checked') && page.includes('<option value="2" selected>Tuesday</option>') && page.includes('name="start" value="20:00"')],
        [{kind: 'special', weekday: '9', start: ''}, 'Choose a weekday.', page => page.includes('value="special" checked')],
        [{kind: 'weekly', weekday: '5', start: '25:00'}, 'Enter the start time as HH:MM.',
            page => page.includes('<option value="5" selected>Friday</option>') && page.includes('name="start" value="25:00"')],
    ]) {
        const bad = await post(srv, c.cookie, '/manage/team', {action: 'add', name: 'Spokes', ...fields});
        assert.equal(bad.status, 400, bad.body);
        assert.deepEqual(flashOf(bad.body), {kind: 'err', text});
        assert.ok(bad.body.includes('<h1>Add a team</h1>'));
        assert.ok(bad.body.includes('value="Spokes"'));
        assert.ok(check(teamForm(bad.body, 'add')), `${text}: ${teamForm(bad.body, 'add')}`);
    }
    assert.equal(Object.keys(srv.store.get(CID).teams).length, teams);
});


test('team settings: a special team\'s card has special checked, its start time under the weekly choice', async t => {
    const c = kindsClub();
    const srv = await serve(t, c);
    const cogs = await pageBody(srv, '/manage/team/cogs/settings');
    assert.ok(!cogs.includes('<input type="hidden" name="action" value="start">'), 'no start time form of its own');
    assert.ok(!cogs.includes('id="start-h"'), 'no start time card');
    // the one start field is the weekly choice's (the script hides it while special is checked)
    const weekly = element(rhythmOf(cogs), '<div class="stack" data-weekly>');
    assert.equal(count(cogs, 'name="start"'), 1);
    assert.ok(weekly.includes('<input type="time" name="start" value="19:30">'), weekly);
    assert.ok(rhythmOf(cogs).includes('<input type="radio" name="kind" value="special" checked>'));
    // made special, Rollers keeps its stored start, drawn in the same place; made weekly again it races at it
    await followPost(srv, c.cookie, '/manage/team', {action: 'kind', team: 'rollers', kind: 'special', weekday: ''});
    const sp = await pageBody(srv, '/manage/team/rollers/settings');
    assert.ok(rhythmOf(sp).includes('<input type="radio" name="kind" value="special" checked>'));
    assert.ok(element(rhythmOf(sp), '<div class="stack" data-weekly>').includes('<input type="time" name="start" value="19:30">'));
    assert.equal(srv.store.get(CID).teams.rollers.start, '19:30');
    await followPost(srv, c.cookie, '/manage/team', {action: 'kind', team: 'rollers', kind: 'weekly', weekday: ''});
    assert.ok(teamForm(await pageBody(srv, '/manage/team/rollers/settings'), 'rhythm').includes('<input type="time" name="start" value="19:30">'));
});


// The warning lines of a Store form (above its action bar; user, 23 Nov 2026: no "What happens"): [class, text].
const whatLines = body => [...(element(element(body, '<div id="panel-body"') ?? '', '<div class="cp-what"') ?? '').matchAll(/<li class="(\w+)">([\s\S]*?)<\/li>/g)]
    .map(m => [m[1], textOf(m[2]).trim()]);


test('assign page: a special team\'s plan needs its date and start time, at the top, and nothing red before they are typed', async t => {
    const c = kindsClub();
    c.club.teams.cogs.start = null;
    const srv = await serve(t, c);
    const id = await intake(srv, c.cookie, {team: 'cogs', json: planJson('Cogs', ['1009'])});
    const page = q => storeFormOf(srv, id, `${q}`);
    const body = await page('');
    // both side by side, both required, both empty; the date the form was drawn for goes with its
    // hidden fields (races Task 7)
    const form = element(body, '<div class="cp-form"');
    const when = element(body, '<div class="as-when">');
    assert.ok(when, body);
    assert.ok(body.includes('<input type="hidden" name="startFor" value="">'), body);
    assert.equal(count(body, 'name="startFor"'), 1);
    assert.ok(when.includes('<input type="date" name="date" value="" required>'), when);
    assert.ok(when.includes('<input type="time" name="start" value="" required>'), when);
    assert.ok(form.indexOf('<div class="as-when">') < form.indexOf('name="event"'));
    // no hint under the pair: the time field looks the same for every team (user, 22 Nov 2026)
    assert.equal(element(body, '<div class="cp-form"').includes('every plan of Cogs for that day'), false, 'the old hint under the pair');
    assert.equal(textOf(element(body, '<div class="cp-form"')).includes('newest upload'), false);
    assert.equal(count(form, 'name="start"'), 1);
    // nothing typed yet: a neutral line, no error (the coordinator, 19 Nov 2026)
    assert.deepEqual(whatLines(body), [['neutral', 'Choose the race date and start time.']]);
    // Make live and Store say what they do (user, 23 Nov 2026: no Make live box; screen readers hear
    // "Store and make live")
    // (Discard · Store · Make live, Make live the rightmost: user, 23 Nov 2026)
    assert.ok(body.includes(`<button class="btn secondary" type="submit" form="store-${id}" data-submit="store">Store</button>`
        + `<button class="btn primary" type="submit" form="store-${id}" name="live" value="on" aria-label="Store and make live" data-submit="live">Make live</button>`), element(body, '<div class="cp-bar"'));
    const q = '?team=cogs&as=new&drawn=cogs:new&live=on&type=&date=2026-11-29';
    assert.deepEqual(whatLines(await page(`${q}&startFor=&start=`)), [['neutral', 'Choose the start time.']]);
    // the time redraws the preview: the preview uses it (the race line above "Store as" went: the date
    // and time fields say it, team cockpit spec §5.3b)
    const filled = await page(`${q}&startFor=2026-11-29&start=20:15`);
    assert.ok(filled.includes('<input type="time" name="start" value="20:15" required>'), filled);
    assert.equal(textOf(element(filled, '<div class="cp-form"')).includes('Race Sun 29 Nov'), false, textOf(filled));
    // with both: no line about what Make live does (user, 23 Nov 2026: no "What happens"); Store alone
    // would leave the race without a plan, a warning
    assert.deepEqual(whatLines(filled), [['warn', 'Store: new plan \'Cogs\', not live. Riders get no plan for this race yet.'],
        ['warn', 'No pull watts in this plan: export it from ZwiftGopher with pull power.']]);
    // a value that is there but no time is an error
    assert.deepEqual(whatLines(await page(`${q}&startFor=2026-11-29&start=25:00`)), [['err', 'Enter the start time as HH:MM.']]);
    // Store without a time: refused, the form refilled, nothing stored
    const fields = {team: 'cogs', as: 'new', live: 'on', base: String(VERSION_OF(srv, 'cogs')), drawn: 'cogs:new', date: '2026-11-29', type: '', startFor: '2026-11-29'};
    const refused = await storePost(srv, c.cookie, id, {...fields, start: ''});
    assert.equal(refused.status, 400, refused.body);
    assert.deepEqual(flashOf(refused.body), {kind: 'err', text: 'Enter the start time as HH:MM.'});
    assert.ok(refused.body.includes('<input type="date" name="date" value="2026-11-29" required>'), refused.body);
    assert.equal(Object.keys(srv.store.get(CID).sheets).length, 0);
    // with a time: stored, the race starts then
    const stored = await storePost(srv, c.cookie, id, {...fields, start: '20:15'});
    assert.equal(stored.status, 303, stored.body);
    assert.ok(textOf(stored.body).includes('\'Cogs\' v1 is live for Sun 29 Nov 20:15.'), textOf(stored.body));
    assert.deepEqual(starts(srv.store.get(CID), 'cogs'), {'2026-11-29': '20:15'});
    // a weekly team: its time prefilled with the team's (user, 22 Nov 2026) and required (user, 23 Nov
    // 2026: a race's start is pinned when it is made, an empty field is no "team's time"); an
    // emptied date is no error
    const rid = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers', ROLLERS)});
    const rollers = await storeFormOf(srv, rid, `?team=rollers&as=new&drawn=rollers:new&date=`);
    const rollersForm = element(rollers, '<div class="cp-form"');
    assert.equal(count(rollersForm, 'name="start"'), 1);
    assert.ok(rollersForm.includes('<input type="time" name="start" value="19:30" required>'), rollersForm);
    assert.deepEqual(whatLines(rollers), [['neutral', 'Choose the race date.']]);
});


test('Store form: a special team\'s race fold is open, also once a race is ahead; with nothing ahead its summary says so', async t => {
    const c = kindsClub();
    c.club.teams.cogs.start = null;
    const srv = await serve(t, c);
    const foldOf = body => element(element(body, '<div class="cp-form"'), '<details class="fold as-race"');
    const summaryOf = body => textOf(element(foldOf(body), '<summary')).trim();
    // nothing ahead: no date to prefill, the captain must give it; the date and time in the open fold,
    // the form's last block
    const id = await intake(srv, c.cookie, {team: 'cogs', json: planJson('Cogs', ['1009'])});
    const body = await storeFormOf(srv, id);
    assert.match(foldOf(body), /^<details class="fold as-race" open>/, body);
    assert.ok(foldOf(body).includes('<input type="date" name="date" value="" required>') && foldOf(body).includes('<input type="time" name="start" value="" required>'));
    assert.equal(summaryOf(body), 'Race: no date yet · Change');
    assert.match(element(body, '<div class="cp-form"'), /<\/details>\s*<\/form>\s*<\/div>$/);
    // a race ahead (Sun 29 Nov 20:15): still open for a special team, its summary the race
    assert.equal((await storePost(srv, c.cookie, id, {
        team: 'cogs', as: 'new', live: 'on', confirm: '1', base: String(VERSION_OF(srv, 'cogs')), drawn: 'cogs:new', date: '2026-11-29', type: '', start: '20:15', startFor: '2026-11-29',
    })).status, 303);
    // (a new plan: a version takes its plan's race and has no fold, user 23 Nov 2026)
    const next = await storeFormOf(srv, await intake(srv, c.cookie, {team: 'cogs', json: planJson('Cogs', ['1009', '1008'])}), '?team=cogs&as=new&drawn=cogs:new');
    assert.match(foldOf(next), /^<details class="fold as-race" open>/, next);
    assert.equal(summaryOf(next), 'Race: Sun 29 Nov · 20:15 · Change');
    // a weekly team's next race: closed
    const rollers = await storeFormOf(srv, await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers', ROLLERS)}), '?team=rollers&as=new&drawn=rollers:new');
    assert.match(foldOf(rollers), /^<details class="fold as-race">/, rollers);
});


test('assign page: the newest new plan for a date sets its race\'s start, a version takes its race as it is; the result names the plans that move', async t => {
    const c = kindsClub();
    c.club.teams.cogs.start = null;
    const srv = await serve(t, c);
    const first = Object.keys(srv.store.get(CID).sheets).length;
    assert.equal(first, 0);
    const id = await intake(srv, c.cookie, {team: 'cogs', json: planJson('Cogs', ['1009'])});
    const base = () => String(VERSION_OF(srv, 'cogs'));
    assert.equal((await storePost(srv, c.cookie, id, {
        team: 'cogs', as: 'new', live: 'on', confirm: '1', base: base(), drawn: 'cogs:new', date: '2026-11-29', type: '', start: '20:15', startFor: '2026-11-29',
    })).status, 303);
    const [plan] = Object.keys(srv.store.get(CID).sheets);
    // a new version takes its plan's race (user, 23 Nov 2026): no date or time field, and a time
    // posted with it (a page from before) moves nothing
    const vid = await intake(srv, c.cookie, {team: 'cogs', json: planJson('Cogs', ['1009', '1008'])});
    const v = await storeFormOf(srv, vid, `?team=cogs&as=${plan}&drawn=cogs:${plan}`);
    assert.ok(!/as-when|name="date"|name="start"/.test(element(v, '<div class="cp-form"')), 'no date or time for a version');
    const v2 = await storePost(srv, c.cookie, vid, {
        team: 'cogs', as: plan, live: 'on', confirm: '1', base: base(), drawn: `cogs:${plan}`, type: '', start: '21:15', startFor: '2026-11-29',
    });
    assert.equal(v2.status, 303, v2.body);
    assert.ok(!textOf(v2.body).includes('now starts at'), textOf(v2.body));
    assert.deepEqual(starts(srv.store.get(CID), 'cogs'), {'2026-11-29': '20:15'});
    // a second plan for 29 Nov: prefilled with the race's time; another one moves the race and names
    // the plan that moves with it; the copy never says to pick another date
    const sid = await intake(srv, c.cookie, {team: 'cogs', json: planJson('Cogs slow', ['1007'])});
    const s2 = await storeFormOf(srv, sid, `?team=cogs&as=new&drawn=cogs:new&date=2026-11-29`);
    assert.ok(s2.includes('<input type="time" name="start" value="20:15" required>'), s2);
    const slow = await storePost(srv, c.cookie, sid, {
        team: 'cogs', as: 'new', live: '', base: base(), drawn: 'cogs:new', date: '2026-11-29', type: 'slow', start: '21:30', startFor: '2026-11-29',
    });
    assert.equal(slow.status, 303, slow.body);
    assert.ok(textOf(slow.body).includes('Race on Sun 29 Nov now starts at 21:30 (was 20:15). \'Cogs\' moves with it.'), textOf(slow.body));
    assert.ok(!textOf(slow.body).includes('another date'));
    assert.equal(race(srv.store.get(CID), 'cogs', '2026-11-29').start, '21:30');
    // the race's ⋯ on the team page changes it (races Task 6)
    assert.ok(menuOf(await pageBody(srv, '/manage/team/cogs'), 'Options for the race on Sun 29 Nov').includes('<input type="time" name="start" value="21:30" required>'), 'the race ⋯');
});


test('team page: a special team\'s race stored by 0.3.0 without any start time, and its way out', async t => {
    const c = kindsClub();
    c.club.teams.cogs.kind = 'weekly';
    const id = upload(c.club, 'cogs', {riders: ['1009'], at: T('2026-11-19T10:00:00Z'), date: '2026-11-29'});
    c.club.teams.cogs.kind = 'special';
    c.club.teams.cogs.start = null;
    // stored by 0.3.0: no time of its own (a Store now pins the team's, user 23 Nov 2026)
    race(c.club, 'cogs', '2026-11-29').start = null;
    const srv = await serve(t, c);
    const body = await teamBody(srv, 'cogs');
    // still red, with the way out: an upload of the race's plan with the time
    const callout = element(body, '<section class="callout err"');
    assert.ok(callout, body);
    assert.ok(textOf(callout).includes('No start time: riders on this plan get nothing'), textOf(callout));
    // its way out: the race's ⋯ (a new version takes its plan's race as it is, user 23 Nov 2026)
    assert.ok(textOf(callout).includes('The race on Sun 29 Nov has none, so its plan goes to nobody: set its start time in the race\'s ⋯.'), textOf(callout));
    const href = /<a class="btn secondary small" href="([^"]*)">/.exec(callout)[1].replace(/&amp;/g, '&');
    assert.equal(href, '/manage/team/cogs#race-2026-11-29');
    assert.ok(textOf(callout).includes('Set the start time'), textOf(callout));
    assert.ok(!callout.includes('/settings') && !callout.includes('/manage/upload'));
    assert.ok(body.includes('id="race-2026-11-29"'), 'the anchor the button goes to');
    assert.ok(!textOf(body).includes('null'), textOf(body));
    // the race's ⋯ sets it
    const res = await followPost(srv, c.cookie, '/manage/race', {team: 'cogs', date: '2026-11-29', version: String(VERSION_OF(srv, 'cogs')),
        action: 'when', to: '2026-11-29', start: '20:00', confirm: '1'});
    assert.equal(race(srv.store.get(CID), 'cogs', '2026-11-29').start, '20:00', JSON.stringify(res.flash));
    const after = await teamBody(srv, 'cogs');
    assert.ok(!after.includes('<section class="callout err"'), after);
    assert.ok(textOf(/<p class="race">([\s\S]*?)<\/p>/.exec(after)[1]).includes('Sun 29 Nov · 20:00'), after);
    // not live: still red, with its day, never "null"
    srv.store.change(CID, cl => {
        race(cl, 'cogs', '2026-11-29').start = null;
        setLive(cl, 'cogs', null);
    });
    const off = await teamBody(srv, 'cogs');
    assert.ok(textOf(off).includes('No start time for Sun 29 Nov'), textOf(off));
    assert.ok(!textOf(off).includes('null'), textOf(off));
});


test('team settings: switching the race rhythm says what happens to the plans\' start', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {riders: ROLLERS, at: T('2026-11-19T10:00:00Z')});
    const srv = await serve(t, c);
    const kind = (k, team = 'rollers') => followPost(srv, c.cookie, '/manage/team', {action: 'kind', team, kind: k, weekday: ''});
    assert.deepEqual((await kind('special')).flash, {kind: 'ok',
        text: 'Rollers: On single dates, chosen when you store a plan. Its plans keep their race times; new plans bring their own.'});
    assert.deepEqual((await kind('weekly')).flash, {kind: 'ok', text: 'Rollers: Every week on Thursday. Races already planned keep their time; change one in its ⋯.'});
    // no change, no word
    assert.deepEqual((await kind('weekly')).flash, {kind: 'ok', text: 'Rollers: Every week on Thursday.'});
    await followPost(srv, c.cookie, '/manage/team', {action: 'start', team: 'rollers', start: '', confirm: '1'});
    await kind('special');
    assert.deepEqual((await kind('weekly')).flash.text, 'Rollers: Every week on Thursday. Races already planned keep their time; change one in its ⋯.');
    // a team without plans: no word about them
    assert.deepEqual((await kind('special', 'sprockets')).flash, {kind: 'ok', text: 'Sprockets: On single dates, chosen when you store a plan.'});
});


test('team settings: special → weekly: every race already planned keeps its time, an old one without a time of its own follows the team\'s (user, 23 Nov 2026)', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {riders: ROLLERS, at: T('2026-11-19T10:00:00Z')});
    upload(c.club, 'rollers', {riders: ROLLERS, at: T('2026-11-19T10:05:00Z'), date: '2026-11-22', live: false});
    race(c.club, 'rollers', '2026-11-22').start = '18:00';
    // a race stored before times were pinned: no time of its own
    race(c.club, 'rollers', '2026-11-19').start = null;
    const srv = await serve(t, c);
    const kind = k => followPost(srv, c.cookie, '/manage/team', {action: 'kind', team: 'rollers', kind: k, weekday: ''});
    await kind('special');
    assert.deepEqual((await kind('weekly')).flash, {kind: 'ok',
        text: 'Rollers: Every week on Thursday. Races already planned keep their time; change one in its ⋯.'});
    const races = () => srv.store.get(CID).teams.rollers.races;
    assert.deepEqual([races()['2026-11-19'].start, races()['2026-11-22'].start], [null, '18:00']);
    // the team's time changed: the Sunday race keeps 18:00; the old Thursday race follows the team's
    await followPost(srv, c.cookie, '/manage/team', {action: 'rhythm', team: 'rollers', kind: 'weekly', weekday: '4', start: '19:50'});
    assert.equal(raceStart(srv.store.get(CID), 'rollers', '2026-11-22'), '18:00');
    assert.equal(raceStart(srv.store.get(CID), 'rollers', '2026-11-19'), '19:50');
    assert.equal(races()['2026-11-22'].start, '18:00');
});


test('assign page: a time drawn for another date never moves that date\'s race; an over time is refused', async t => {
    const c = kindsClub();
    c.club.teams.cogs.start = null;
    const srv = await serve(t, c);
    const base = () => String(VERSION_OF(srv, 'cogs'));
    const store = async (json, fields) => {
        const id = await intake(srv, c.cookie, {team: 'cogs', json});
        return {id, res: await storePost(srv, c.cookie, id, {team: 'cogs', as: 'new', live: '', base: base(), drawn: 'cogs:new', ...fields})};
    };
    assert.equal((await store(planJson('Cogs', ['1009']), {date: '2026-11-21', start: '20:15', startFor: '2026-11-21', type: 'a'})).res.status, 303);
    assert.equal((await store(planJson('Cogs', ['1008']), {date: '2026-11-29', start: '21:15', startFor: '2026-11-29', type: 'b'})).res.status, 303);
    const sheets = Object.keys(srv.store.get(CID).sheets).length;
    // drawn for 21 Nov at 20:15, the date changed to 29 Nov and stored without a redraw: nothing moves
    const {id, res} = await store(planJson('Cogs', ['1007']), {date: '2026-11-29', start: '20:15', startFor: '2026-11-21', type: 'c'});
    assert.equal(res.status, 400, res.body);
    assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'Check the choices: the preview was for another race.'});
    assert.ok(res.body.includes('<input type="date" name="date" value="2026-11-29" required>'), res.body);
    assert.ok(res.body.includes('<input type="time" name="start" value="21:15" required>'), 'redrawn with that race\'s time');
    assert.equal(Object.keys(srv.store.get(CID).sheets).length, sheets);
    assert.deepEqual(starts(srv.store.get(CID), 'cogs'), {'2026-11-21': '20:15', '2026-11-29': '21:15'});
    // posted again from the redrawn page: stored at the race's time
    const again = await storePost(srv, c.cookie, id, {team: 'cogs', as: 'new', live: '', base: base(), drawn: 'cogs:new',
        date: '2026-11-29', start: '21:15', startFor: '2026-11-29', type: 'c'});
    assert.equal(again.status, 303, again.body);
    // a fresh date: redrawn first too (races Task 7: a Store for any race the page was not drawn for
    // stores nothing), its time empty (no race time yet); stored from the redrawn page
    const fresh = await store(planJson('Cogs', ['1006']), {date: '2026-12-06', start: '20:15', startFor: '2026-11-21', type: 'd'});
    assert.equal(fresh.res.status, 400, fresh.res.body);
    assert.deepEqual(flashOf(fresh.res.body), {kind: 'err', text: 'Check the choices: the preview was for another race.'});
    assert.ok(fresh.res.body.includes('<input type="time" name="start" value="" required>'), 'no time drawn for another date');
    assert.equal(Object.values(srv.store.get(CID).sheets).filter(sh => sh.date === '2026-12-06').length, 0);
    assert.equal((await storePost(srv, c.cookie, fresh.id, {team: 'cogs', as: 'new', live: '', base: base(), drawn: 'cogs:new',
        date: '2026-12-06', start: '20:15', startFor: '2026-12-06', type: 'd'})).status, 303);

    // today's race (19 Nov) at 20:15; at 19:25 Berlin a new plan typed 08:15 (an AM/PM slip) is
    // refused, and nothing moves; a version's time (a page from before) is ignored: it takes its
    // plan's race as it is (user, 23 Nov 2026)
    const today = await store(planJson('Cogs', ['1005']), {date: '2026-11-19', start: '20:15', startFor: '2026-11-19', type: 'e'});
    assert.equal(today.res.status, 303);
    const plan = Object.entries(srv.store.get(CID).sheets).find(([, sh]) => sh.date === '2026-11-19')[0];
    const slip = await store(planJson('Cogs', ['1004']), {date: '2026-11-19', start: '08:15', startFor: '2026-11-19', startWas: '20:15', type: 'f'});
    assert.equal(slip.res.status, 400, slip.res.body);
    assert.deepEqual(flashOf(slip.res.body), {kind: 'err', text: 'The race on 2026-11-19 at 08:15 is over: check the start time, or choose a later date.'});
    assert.ok(slip.res.body.includes('<input type="time" name="start" value="08:15" required>'), 'the form refilled');
    const vid = await intake(srv, c.cookie, {team: 'cogs', json: planJson('Cogs', ['1005', '1004'])});
    const version = await storePost(srv, c.cookie, vid, {team: 'cogs', as: plan, live: '', base: base(), drawn: `cogs:${plan}`,
        start: '08:15', startFor: '2026-11-19', type: 'e'});
    assert.equal(version.status, 303, version.body);
    assert.equal(race(srv.store.get(CID), 'cogs', '2026-11-19').start, '20:15');
    assert.equal(Object.values(srv.store.get(CID).sheets).filter(sh => sh.date === '2026-11-19').length, 2);
});


test('assign page: the neutral line asks only for what is missing; other plans moving with the race is a warning', async t => {
    const c = kindsClub();
    c.club.teams.cogs.start = null;
    const srv = await serve(t, c);
    const id = await intake(srv, c.cookie, {team: 'cogs', json: planJson('Cogs', ['1009'])});
    const body = await storeFormOf(srv, id, `?team=cogs&as=new&drawn=cogs:new&live=on&type=&date=&startFor=&start=20:15`);
    assert.ok(body.includes('<input type="time" name="start" value="20:15" required>'), body);
    assert.deepEqual(whatLines(body), [['neutral', 'Choose the race date.']]);
    // a race with two plans: moving it is a warning (the other plan moves too); a race with one plan
    // only, its own: info
    const base = () => String(VERSION_OF(srv, 'cogs'));
    const fields = {team: 'cogs', live: '', base: '', date: '2026-11-29', startFor: '2026-11-29'};
    assert.equal((await storePost(srv, c.cookie, id, {...fields, as: 'new', drawn: 'cogs:new', base: base(), start: '20:15', type: 'fast'})).status, 303);
    const [plan] = Object.keys(srv.store.get(CID).sheets);
    const vid = await intake(srv, c.cookie, {team: 'cogs', json: planJson('Cogs', ['1009', '1008'])});
    // (a version takes its plan's race as it is, user 23 Nov 2026: its posted time moves nothing)
    const own = await storePost(srv, c.cookie, vid, {...fields, as: plan, drawn: `cogs:${plan}`, base: base(), start: '20:45', type: 'fast'});
    assert.equal(own.status, 303, own.body);
    assert.ok(!textOf(own.body).includes('now starts at'), textOf(own.body));
    const sid = await intake(srv, c.cookie, {team: 'cogs', json: planJson('Cogs slow', ['1007'])});
    const slow = await storePost(srv, c.cookie, sid, {...fields, as: 'new', drawn: 'cogs:new', base: base(), start: '21:00', type: 'slow'});
    assert.match(slow.body, /<li class="warn">[^]*?<span>Race on Sun 29 Nov now starts at 21:00 \(was 20:15\)\. &#39;Cogs · fast&#39; moves with it\.<\/span><\/li>/);
});


// ---- navigation (UI panel, 19 Nov 2026: nav-test.md) ----

test('New version from a plan: the team page with the entry picked; Discard goes back to the team page, never a plan page', async t => {
    const c = makeClub();
    const fast = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const plan = srv.store.get(CID).sheets[fast].plan;
    // an upload page opened for a plan (a hole's link; the plan ⋯'s New version, gone 23 Nov 2026, and a
    // link from before the team cockpit with from=plan, as links already handed out): the entry
    // picked on the team page, its Store form preselecting the plan, its Discard back to the team
    for (const q of [`&plan=${plan}`, `&plan=${plan}&from=plan`]) {
        const res = await postUpload(srv, c.cookie, {team: 'rollers', forPlan: plan, json: planJson('Rollers fast', ROLLERS.slice(1))}, {path: `/manage/upload?team=rollers${q}`});
        assert.equal(res.status, 303, await res.text());
        const [, id] = /\?e=([0-9a-z]{6})#panel$/.exec(res.headers.get('location'));
        const body = await storeFormOf(srv, id);
        assert.ok(body.includes(`<input type="radio" name="as" value="${plan}" checked>`), body);
        assert.ok(body.includes('<input type="hidden" name="back" value="/manage/team/rollers"><button class="btn secondary danger-text" type="submit" data-arm-open>'), body);
        const gone = await followPost(srv, c.cookie, `/manage/inbox/${id}/discard`, {back: '/manage/team/rollers', confirm: '1'});
        assert.equal(gone.location, '/manage/team/rollers');
        assert.equal(gone.flash.kind, 'ok');
    }
    // a Discard from a page left open with a plan page or the build's route as its way back: /manage
    for (const back of [`/manage/team/rollers/plan/${plan}`, '/manage/team/rollers/plan/zzzzzz', `/manage/team/sprockets/plan/${plan}`,
        `/manage/team/rollers/plan/${plan}/x`, '/manage/team/rollers/cockpit']) {
        const id = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS)});
        assert.equal((await followPost(srv, c.cookie, `/manage/inbox/${id}/discard`, {back, confirm: '1'})).location, '/manage', back);
    }
});


test('privacy: a signed-in captain has a way back to the teams; the public page has none', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    const mine = await (await srv.get('/privacy')).text();
    assert.ok(mine.includes('<nav class="topbar plain" aria-label="Back">'), mine);
    assert.ok(mine.includes('<a class="back" href="/manage">'), mine);
    assert.ok(textOf(element(mine, '<nav class="topbar plain"')).includes('All teams'));
    assert.ok(mine.includes('<footer class="foot"><a href="/">Paceline</a></footer>'), 'the public footer stays');
    const anon = await (await srv.get('/privacy', null)).text();
    assert.ok(!anon.includes('topbar'), anon);
    assert.ok(!anon.includes('href="/manage"'), anon);
    assert.ok(anon.includes('<footer class="foot"><a href="/">Paceline</a></footer>'));
});


test('an unknown /manage path: a 404 page in the captain frame with the way to the teams', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    for (const p of ['/manage/nothing', '/manage/team/rollers/plans', '/manage/inbox']) {
        const res = await srv.get(p);
        assert.equal(res.status, 404, p);
        assert.match(res.headers.get('content-type'), /^text\/html/, p);
        const body = await res.text();
        assert.ok(body.includes('<h1 id="gone-h">This page does not exist.</h1>'), body);
        assert.ok(body.includes('<a class="btn primary block" href="/manage">All teams</a>'), body);
        assert.ok(body.includes('<aside class="side"'), 'the captain frame');
        assert.ok(body.includes('<a class="back" href="/manage">'), 'the back bar');
    }
    // the gate still comes first: without the club cookie, the start page
    const anon = await srv.get('/manage/nothing', null);
    assert.equal(anon.status, 303);
    assert.equal(anon.headers.get('location'), '/');
});


// ---- the Make live rule and the confirms of destructive actions (UI panel wave 2) ----

// Before the gate: 18:40 in Berlin, Rollers starts 19:30, its gate opens 19:00.
const PRE_GATE = T('2026-11-19T17:40:00Z');

test('make live before the gate acts at once; no Undo: Make live of the version live before takes it back (user, 23 Nov 2026)', async t => {
    const c = makeClub();
    const fast = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ROLLERS.slice(0, 6), at: T('2026-11-19T14:10:00Z'), live: false});
    const srv = await serve(t, c, {now: PRE_GATE});
    // nothing to warn about, the gate not open: a plain button in the panel of the picked version, no strip
    const panel = element(await pageBody(srv, `/manage/team/rollers?v=${slow}`), '<div id="panel-acts"');
    assert.equal(armOf(panel, '/manage/live'), null, panel);
    const ver = VERSION_OF(srv, 'rollers');
    assert.ok(panel.includes(`<form method="post" action="/manage/live">${CLUB_FIELD}<input type="hidden" name="team" value="rollers"><input type="hidden" name="sheet" value="${slow}">`
        + `<input type="hidden" name="version" value="${ver}"><button class="btn primary" type="submit">Make live<span class="sr"> v1 of &#39;Rollers · slow&#39;</span></button></form>`), panel);
    // its POST, without confirm (with the script or without), acts at once and lands on the panel of
    // the version now live
    const made = await followPost(srv, c.cookie, '/manage/live', liveFormOf(panel, slow));
    assert.equal(made.location, `/manage/team/rollers?r=${DATE}#panel`);
    assert.equal(liveId(srv.store.get(CID), 'rollers'), slow);
    assert.deepEqual(made.flash, {kind: 'ok', text: '\'Rollers · slow\' v1 is live for Rollers.'});
    // the flash sits in the panel's head, the page's one flash, with no form in it: no Undo anywhere
    const head = element(made.page, '<div id="panel"');
    assert.ok(head.includes('<div class="flash ok" role="status">'), head);
    assert.equal(element(head, '<div class="flash ok"').includes('<form'), false);
    assert.equal(count(made.page, 'class="flash'), 1);
    assert.equal(/\/manage\/live\/undo|data-row-undo|cp-undo|flash ok undo/.test(made.page), false);
    // the page drawn again (a reload): no flash, the live card's LIVE tag in its title and no bar (user, 24 Nov 2026)
    const again = await teamBody(srv, 'rollers');
    assert.equal(flashOf(again), null);
    assert.equal(again.includes('class="flash'), false);
    assert.ok(textOf(element(again, '<h2 class="cp-title"')).trim().endsWith('Live'), element(again, '<h2 class="cp-title"'));
    assert.equal(again.includes('<div class="cp-bar"'), false);
    assert.equal(again.includes('riders get this'), false);
    assert.equal(/\/manage\/live\/undo/.test(again), false);
    // the way back: the version live before, opened, and its Make live (before the gate: at once)
    const back = liveFormOf(await pageBody(srv, `/manage/team/rollers?v=${fast}`), fast);
    assert.equal(back.confirm, undefined);
    const backed = await followPost(srv, c.cookie, '/manage/live', back);
    assert.equal(backed.location, `/manage/team/rollers?r=${DATE}#panel`);
    assert.deepEqual(backed.flash, {kind: 'ok', text: '\'Rollers · fast\' v1 is live for Rollers.'});
    assert.equal(liveId(srv.store.get(CID), 'rollers'), fast);
    // nothing is kept for an Undo
    assert.equal(Object.hasOwn(srv.store.get(CID).teams.rollers, 'liveBefore'), false);
});


test('make live: a page drawn before the gate still asks once it is open; a warning asks before it', async t => {
    const c = makeClub();
    const fast = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ROLLERS.slice(0, 6), at: T('2026-11-19T14:10:00Z'), live: false});
    const srv = await serve(t, c, {now: T('2026-11-19T17:59:00Z')});
    const drawn = liveFormOf(await pageBody(srv, `/manage/team/rollers?v=${slow}`), slow);
    assert.equal(drawn.confirm, undefined, 'drawn before the gate: a plain button');
    srv.clock.now = T('2026-11-19T18:00:00Z');
    const file = storedClub(srv);
    const res = await post(srv, c.cookie, '/manage/live', drawn);
    assert.equal(res.status, 200, res.body);
    assert.ok(res.body.includes('<h1>Make &#39;Rollers · slow&#39; v1 live?</h1>'), res.body);
    assert.equal(storedClub(srv), file);
    assert.equal(liveId(srv.store.get(CID), 'rollers'), fast);
    // before the gate, a plan that lists a rider who now rides Sprockets asks, in its place and without
    // the script
    const d = makeClub();
    upload(d.club, 'rollers', {type: 'fast', riders: ROLLERS.slice(1), at: T('2026-11-19T14:00:00Z')});
    const old = upload(d.club, 'rollers', {type: 'old', riders: ROLLERS, at: T('2026-11-19T14:10:00Z'), live: false});
    upload(d.club, 'sprockets', {riders: ['1001', '1009'], at: T('2026-11-19T16:30:00Z')});
    const srv2 = await serve(t, d, {now: PRE_GATE});
    const ask = armOf(element(await pageBody(srv2, `/manage/team/rollers?v=${old}`, d.cookie), '<div id="panel-acts"'));
    assert.ok(textOf(ask).includes('\'Rollers · old\' v1 still lists Ben, who now rides another team. Make it live anyway?'), textOf(ask));
    const asked = await post(srv2, d.cookie, '/manage/live', {team: 'rollers', sheet: old, version: String(srv2.store.get(CID).teams.rollers.version)});
    assert.equal(asked.status, 200, asked.body);
    assert.ok(asked.body.includes('This plan is outdated: riders it lists now ride another team.'), asked.body);
});


test('delete plan: asks first without confirm; a page drawn before another change is refused', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ['1001'], at: T('2026-11-19T14:10:00Z'), live: false});
    const srv = await serve(t, c);
    const ver = String(VERSION_OF(srv, 'rollers'));
    let file = storedClub(srv);
    const ask = await post(srv, c.cookie, '/manage/sheet/delete', {team: 'rollers', sheet: slow, version: ver});
    assert.equal(ask.status, 200, ask.body);
    assert.ok(ask.body.includes('<h1>Delete &#39;Rollers · slow&#39;?</h1>'), ask.body);
    assert.ok(textOf(ask.body).includes('Deletes the plan with all its versions. This cannot be undone.'), textOf(ask.body));
    assert.ok(ask.body.includes(`<form method="post" action="/manage/sheet/delete">${CLUB_FIELD}<input type="hidden" name="team" value="rollers"><input type="hidden" name="sheet" value="${slow}"><input type="hidden" name="version" value="${ver}"><input type="hidden" name="confirm" value="1"><button class="btn danger" type="submit">Delete &#39;Rollers · slow&#39;</button></form>`), ask.body);
    assert.ok(ask.body.includes('<a class="btn secondary" href="/manage/team/rollers">'), ask.body);
    assert.equal(storedClub(srv), file);
    // another captain stores a new version of it meanwhile: the old page's Delete is refused (S7)
    await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers slow', ['1001', '1002'])}, {as: slow, live: ''});
    file = storedClub(srv);
    const stale = await post(srv, c.cookie, '/manage/sheet/delete', {team: 'rollers', sheet: slow, version: ver, confirm: '1'});
    assert.equal(stale.status, 409, stale.body);
    assert.deepEqual(flashOf(stale.body), {kind: 'err', text: 'Rollers changed since you opened the page. Nothing was changed.'});
    assert.equal(storedClub(srv), file);
    const ok = await followPost(srv, c.cookie, '/manage/sheet/delete', {team: 'rollers', sheet: slow, version: String(VERSION_OF(srv, 'rollers')), confirm: '1'});
    assert.equal(ok.flash.text, 'Deleted \'Rollers · slow\' with its versions.');
});


test('no destructive action on one press: delete team, New ZwiftGopher link, start time, zone and Remove a rider ask first', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c, {env: {PUBLIC_URL: 'https://paceline.example.org'}});
    const file = storedClub(srv);
    const asks = async (p, fields, h1, words, form) => {
        const res = await post(srv, c.cookie, p, fields);
        assert.equal(res.status, 200, `${p}: ${res.body}`);
        assert.ok(res.body.includes(`<h1>${h1}</h1>`), res.body);
        assert.ok(textOf(res.body).includes(words), textOf(res.body));
        assert.ok(res.body.includes(form), res.body);
        assert.ok(!res.body.includes('http-equiv'));
        assert.equal(storedClub(srv), file, p);
        return res.body;
    };
    await asks('/manage/team', {action: 'delete', team: 'rollers'}, 'Delete Rollers?', 'Deletes Rollers and its plan.',
        `<input type="hidden" name="action" value="delete"><input type="hidden" name="team" value="rollers"><input type="hidden" name="confirm" value="1"><button class="btn danger" type="submit">Delete Rollers</button>`);
    await asks('/manage/team', {action: 'push-link', team: 'rollers'}, 'New ZwiftGopher link for Rollers?', 'Every "Plan on ZwiftGopher" link handed out for Rollers so far stops working',
        `<input type="hidden" name="action" value="push-link"><input type="hidden" name="team" value="rollers"><input type="hidden" name="confirm" value="1"><button class="btn danger" type="submit">Make a new link</button>`);
    await asks('/manage/club', {name: 'Kettenfett RC', tz: 'UTC'}, 'Change the time zone of Kettenfett RC?', 'every race of Kettenfett RC moves',
        `<input type="hidden" name="name" value="Kettenfett RC"><input type="hidden" name="tz" value="UTC"><input type="hidden" name="unit" value="wkg"><input type="hidden" name="confirm" value="1"><button class="btn primary" type="submit">Change time zone</button>`);
    const rider = await asks('/manage/rider/remove', {zwiftId: '1002'}, 'Remove this rider?', 'Removes Cleo (Zwift ID 1002) from every plan, every older version and every recording of Kettenfett RC. This cannot be undone.',
        `<input type="hidden" name="zwiftId" value="1002"><input type="hidden" name="confirm" value="1"><button class="btn danger" type="submit">Remove rider</button>`);
    assert.ok(rider.includes('<a class="btn secondary" href="/manage/settings">'), rider);
    await asks('/manage/rider/remove', {zwiftId: '777'}, 'Remove this rider?', 'Removes Zwift ID 777 from every plan', 'name="zwiftId" value="777"');
    // the settings pages ask in place: the zone and a cleared start time only when a race is within 7 days
    const settings = await pageBody(srv, '/manage/settings');
    assert.ok(armHas(armOf(settings, '/manage/club'), '/manage/club', '', 'btn primary', 'Change time zone'), settings);
    assert.ok(armOf(settings, '/manage/club').startsWith('<form class="stack" method="post" action="/manage/club" data-arm data-arm-when="changed" data-arm-field="tz">'));
    const rm = armOf(settings, '/manage/rider/remove');
    assert.ok(rm.includes('Removes Zwift ID <span data-arm-fill="zwiftId"></span> from every plan'), rm);
    assert.ok(armHas(rm, '/manage/rider/remove', '', 'btn danger', 'Remove rider'), rm);
    const team = await pageBody(srv, '/manage/team/rollers/settings');
    assert.ok(armOf(team, '/manage/team').startsWith('<form class="stack" method="post" action="/manage/team" data-arm data-arm-when="empty" data-arm-field="start">'), team);
    assert.ok(armHas(armOf(team, '/manage/team', team.indexOf('id="push-h"')), '/manage/team', '<input type="hidden" name="action" value="push-link"><input type="hidden" name="team" value="rollers">', 'btn danger small', 'Make a new link'), team);
    // Sprockets has no plan: its start time is cleared at once, and a zone change of a club without
    // races goes at once too
    const sp = await pageBody(srv, '/manage/team/sprockets/settings');
    assert.ok(!sp.includes('data-arm-field="start"'), 'no race within 7 days');
    assert.equal((await followPost(srv, c.cookie, '/manage/team', {action: 'start', team: 'sprockets', start: ''})).flash.text, 'Sprockets has no start time now.');
    srv.clock.now = T('2026-11-29T12:00:00Z');
    assert.ok(!(await pageBody(srv, '/manage/settings')).includes('data-arm-field="tz"'));
    assert.equal((await followPost(srv, c.cookie, '/manage/club', {name: 'Kettenfett RC', tz: 'UTC'})).flash.text, 'Saved.');
});


test('Make live of a plan of another race asks nothing and leaves tonight\'s live plan (races spec §1)', async t => {
    // live is per race: next week's plan made live ends nothing tonight, even with tonight's gate
    // open (NOW 19:25 Berlin), so the no-script POST acts at once
    const c = makeClub();
    const fast = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const next = upload(c.club, 'rollers', {type: 'next', riders: ['1009'], at: T('2026-11-19T14:30:00Z'), live: false, date: '2026-11-26'});
    const srv = await serve(t, c);
    const res = await post(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: next, version: String(VERSION_OF(srv, 'rollers'))});
    assert.equal(res.status, 303, res.body);
    const club = srv.store.get(CID);
    assert.deepEqual([liveId(club, 'rollers', '2026-11-19'), liveId(club, 'rollers', '2026-11-26')], [fast, next]);
    // nothing is kept for an Undo (there is none, user 23 Nov 2026)
    assert.equal(club.teams.rollers.liveBefore, undefined);
});


// ---- wave 2 review fixes ----

test('Make live back to an older version that reopens a hole asks first (review I2)', async t => {
    const c = makeClub();
    const v1 = upload(c.club, 'rollers', {riders: ['1001', '1002', '1003'], at: T('2026-11-19T10:00:00Z')});
    upload(c.club, 'sprockets', {riders: ['1001', '2002', '2003'], at: T('2026-11-19T11:00:00Z')});
    const v2 = version(c.club, 'rollers', v1, ['1002', '1003', '1004'], '2026-11-19T12:00:00Z', {live: false});
    const srv = await serve(t, c, {now: T('2026-11-19T15:00:00Z')});
    await followPost(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: v2, version: String(VERSION_OF(srv, 'rollers'))});
    assert.equal(liveId(srv.store.get(CID), 'rollers'), v2);
    // back to v1, the version live before: its Make live asks, in its card and without the script
    const ask = armOf(element(await pageBody(srv, `/manage/team/rollers?v=${v1}`), '<div class="cp-bar"'), '/manage/live');
    assert.ok(textOf(ask).includes('\'Rollers\' v1 still lists Ben, who now rides another team. Make it live anyway?'), textOf(ask));
    const file = storedClub(srv);
    const asked = await post(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: v1, version: String(VERSION_OF(srv, 'rollers'))});
    assert.equal(asked.status, 200, asked.body);
    assert.ok(textOf(asked.body).includes('\'Rollers\' v1 still lists Ben, who now rides another team. Make it live anyway?'), textOf(asked.body));
    assert.ok(asked.body.includes('This plan is outdated: riders it lists now ride another team.'), asked.body);
    assert.equal(storedClub(srv), file);
    assert.equal(liveId(srv.store.get(CID), 'rollers'), v2);
});


test('a club stored with the old Undo record (team.liveBefore) loads and works; nothing reads or writes it (user, 23 Nov 2026)', async t => {
    const c = makeClub();
    const fast = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ROLLERS.slice(0, 6), at: T('2026-11-19T14:10:00Z'), live: false});
    // as the image before wrote it right after a switch from slow to fast (one minute ago, with the
    // team's version now: an Undo it would still have offered)
    const old = {id: slow, version: c.club.teams.rollers.version, at: new Date(PRE_GATE - 60000).toISOString()};
    c.club.teams.rollers.liveBefore = structuredClone(old);
    const srv = await serve(t, c, {now: PRE_GATE});
    assert.deepEqual(srv.store.get(CID).teams.rollers.liveBefore, old, 'stored and loaded as it was');
    // the team page draws, with no Undo of it
    for (const q of ['', `?v=${fast}`, `?v=${slow}`]) {
        const body = await pageBody(srv, `/manage/team/rollers${q}`);
        assert.ok(body.includes('<main class="page wide cockpit"'), q);
        assert.equal(/\/manage\/live\/undo|data-row-undo|cp-undo|flash ok undo/.test(body), false, q);
    }
    // Make live and Store work; the record stays as it was, unread
    const made = await followPost(srv, c.cookie, '/manage/live', liveFormOf(await pageBody(srv, `/manage/team/rollers?v=${slow}`), slow));
    assert.equal(made.location, `/manage/team/rollers?r=${DATE}#panel`);
    assert.equal(liveId(srv.store.get(CID), 'rollers'), slow);
    await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS.slice(1))}, {as: fast, live: 'on'});
    assert.equal(srv.store.get(CID).sheets[liveId(srv.store.get(CID), 'rollers')].label, 'Rollers · fast');
    assert.deepEqual(srv.store.get(CID).teams.rollers.liveBefore, old);
    // an Undo form of a page drawn before the change: out of date, nothing changes
    const file = storedClub(srv);
    const undo = await followPost(srv, c.cookie, '/manage/live/undo', {team: 'rollers', version: String(VERSION_OF(srv, 'rollers')), confirm: '1'});
    assert.deepEqual(undo.flash, {kind: 'err', text: 'This page was out of date. Nothing was changed.'});
    assert.equal(storedClub(srv), file);
});


test('Store and make live offers no Undo (user, 23 Nov 2026)', async t => {
    const c = makeClub();
    const fast = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c, {now: PRE_GATE});
    const undoOn = html => /\/manage\/live\/undo|data-row-undo|cp-undo|flash ok undo/.test(html);
    // a new version stored and made live: neither the result nor the team page offers Undo
    const result = await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS.slice(1))}, {as: fast, live: 'on'});
    const live = liveId(srv.store.get(CID), 'rollers');
    assert.notEqual(live, fast);
    assert.equal(undoOn(result), false, result);
    assert.equal(undoOn(await pageBody(srv, `/manage/team/rollers?v=${live}`)), false);
    // the same file as a stored version, made live with the box: none either
    await followPost(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: fast, version: String(VERSION_OF(srv, 'rollers'))});
    const again = await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS.slice(1))}, {as: fast, live: 'on'});
    assert.ok(textOf(again).includes('Same as \'Rollers · fast\' v2: nothing new stored, but it is live now'), textOf(again));
    assert.equal(undoOn(again), false);
    assert.equal(Object.hasOwn(srv.store.get(CID).teams.rollers, 'liveBefore'), false);
});


// ---- the club hub /manage (UI panel wave 3) ----

// The hub's lines of the block headed `h2id` ("todo-h", "recv-h") as {sev, team, when, what, acts}:
// `acts` the block's markup of its buttons; [] without the block.
function hubLines(body, h2id) {
    const at = body.indexOf(`aria-labelledby="${h2id}"`);
    if (at < 0) {
        return [];
    }
    const section = element(body, '<section class="card"', body.lastIndexOf('<section class="card"', at));
    return elements(section, '<li class="').filter(li => li.startsWith('<li class="err">') || li.startsWith('<li class="warn">') || li.startsWith('<li class="info">')).map(li => ({
        sev: /^<li class="(\w+)">/.exec(li)[1],
        team: textOf(/<p class="todo-who"><a href="[^"]*">([^<]*)<\/a>/.exec(li)[1]),
        href: /<p class="todo-who"><a href="([^"]*)">/.exec(li)[1],
        when: textOf(/<span class="muted">([^<]*)<\/span>/.exec(li)[1]),
        what: textOf(/<p class="todo-what">([^<]*)<\/p>/.exec(li)[1]),
        acts: element(li, '<div class="todo-acts">'),
    }));
}

// The rows of the race table headed "Racing <day>" as arrays of their cells' text, and the status
// icon's severity last; null without that table.
function raceRows(body, day) {
    const at = body.indexOf(`>Racing ${day}</h2>`);
    if (at < 0) {
        return null;
    }
    const table = element(body, '<table class="ptable racetable"', at);
    return [...element(table, '<tbody>').matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(([, tr]) => [
        ...[...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].slice(0, 4).map(m => textOf(m[1]).trim()),
        /<span class="sevicon (\w+)">/.exec(tr)[1],
    ]);
}


test('hub: what to fix across teams, with the team page\'s words and buttons, by start time then the worst first', async t => {
    const c = makeClub({teams: [['Cranks', null], ['Sprockets', '19:40'], ['Rollers', '19:30'], ['Axles', '19:40'], ['Pistons', '20:15']]});
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z'), pinned: 4567890});
    upload(c.club, 'sprockets', {riders: ['1001', '1009'], at: T('2026-11-19T16:30:00Z')});
    // Pistons: a plan stored for tonight, none live, 50 min before its start
    upload(c.club, 'pistons', {riders: ['1010', '1011'], at: T('2026-11-19T15:00:00Z'), live: false});
    const sig = c.club.sheets[live].sig;
    const srv = await serve(t, c);
    for (const aid of ['1005', '1006', '1007']) {
        srv.see(aid, '2026-11-19T18:20:00Z', {sig, mod: '0.3.0', sheet: live, inEvent: true, event: 4567891});
    }
    const body = await srv.body();
    assert.ok(body.includes('<h2 id="todo-h">To do before the race</h2>'), body);
    const lines = hubLines(body, 'todo-h');
    // Rollers 19:30 (riders in another event, red, before the hole, amber), Pistons 20:15;
    // Sprockets has nothing to fix, nor has Axles without a plan (its regular race day is no race),
    // nor Cranks without a start time and without a plan (a setting, no rider affected: spec §8)
    assert.deepEqual(lines.map(l => [l.sev, l.team, l.when, l.what]), [
        ['err', 'Rollers', '19:30', '3 riders are in another event and get nothing'],
        ['warn', 'Rollers', '19:30', 'Ben now rides Sprockets'],
        ['err', 'Pistons', '20:15', 'No live plan: riders get nothing'],
    ]);
    assert.deepEqual(lines.map(l => l.href), ['/manage/team/rollers', '/manage/team/rollers', '/manage/team/pistons']);
    // each button is the one the team page offers for it, the same form or the same link, naming its
    // team for screen readers and voice control; Remove event link comes back to the hub (review M2, M3)
    const SR = name => `<span class="sr"> (${name})</span>`;
    const rollers = await teamBody(srv, 'rollers');
    const [pin, hole] = elements(element(rollers, '<section class="callout err"'), '<li class="note');
    const unpin = element(pin, '<form method="post" action="/manage/sheet/unpin">');
    assert.ok(unpin.includes(`<input type="hidden" name="sheet" value="${live}">`), unpin);
    const hubUnpin = unpin.replace(`value="${live}">`, `value="${live}"><input type="hidden" name="back" value="hub">`).replace('</button>', `${SR('Rollers')}</button>`);
    assert.equal(lines[0].acts, `<div class="todo-acts">${hubUnpin}</div>`);
    const holeLink = /<a class="btn secondary small" href="[^"]*">[\s\S]*?Upload without Ben<\/a>/.exec(hole)[0];
    assert.ok(holeLink.includes(`href="/manage/upload?team=rollers&amp;plan=${live}&amp;date=2026-11-19"`), holeLink);
    assert.equal(lines[1].acts, `<div class="todo-acts">${holeLink.replace('</a>', `${SR('Rollers')}</a>`)}</div>`);
    // Axles keeps the way to a plan on its team page, in its empty card
    const axles = await teamBody(srv, 'axles');
    assert.match(element(axles, '<section class="card empty"'), /<a class="btn primary block" href="\/manage\/upload\?team=axles">/);
    // no live plan: "Make a plan live" to the team page with the race's one plan picked, whose panel
    // has Make live (team cockpit spec §5.6)
    const pistonsPlan = Object.entries(srv.store.get(CID).sheets).find(([, s]) => s.team === 'pistons')[0];
    assert.equal(lines[2].acts, `<div class="todo-acts"><a class="btn secondary small" href="/manage/team/pistons?v=${pistonsPlan}#panel">Make a plan live<span class="sr"> (Pistons)</span></a></div>`);
    const pistons = await pageBody(srv, `/manage/team/pistons?v=${pistonsPlan}`);
    assert.ok(element(pistons, '<div id="panel-acts"').includes('action="/manage/live"'), 'its panel has Make live');
    // the words are the team page's: its notes' titles
    assert.ok(textOf(rollers).includes('3 riders are in another event and get nothing') && textOf(rollers).includes('Ben now rides Sprockets'));
    // Cranks gets a plan for tonight, its race without a time: the red "No start time" as before,
    // last (no start time), with the team page's Set the start time and its callout's heading
    srv.store.change(CID, cl => {
        upload(cl, 'cranks', {riders: ['1012'], at: T('2026-11-19T17:00:00Z')});
    });
    const withPlan = hubLines(await srv.body(), 'todo-h');
    assert.deepEqual(withPlan.at(-1) && [withPlan.at(-1).sev, withPlan.at(-1).team, withPlan.at(-1).when, withPlan.at(-1).what],
        ['err', 'Cranks', 'Thu 19 Nov', 'No start time: riders on this plan get nothing']);
    const cranks = await teamBody(srv, 'cranks');
    const set = /<a class="btn secondary small" href="\/manage\/team\/cranks\/settings">[\s\S]*?Set the start time<\/a>/.exec(element(cranks, '<section class="callout err"'))[0];
    assert.equal(withPlan.at(-1).acts, `<div class="todo-acts">${set.replace('</a>', `${SR('Cranks')}</a>`)}</div>`);
    assert.ok(textOf(element(cranks, '<section class="callout err"')).includes('No start time: riders on this plan get nothing'));
    // the Remove event link of the hub does what the team page's does, and comes back to the hub
    const done = await followPost(srv, c.cookie, '/manage/sheet/unpin', {team: 'rollers', sheet: live, back: 'hub'});
    assert.equal(done.location, '/manage');
    assert.equal(done.flash.kind, 'ok');
    assert.equal(race(srv.store.get(CID), 'rollers', DATE).pinnedEventId, null);
    // nothing waiting, and things to do: no "Nothing to do" line, no received block
    assert.ok(!body.includes('Nothing to do') && !body.includes('recv-h'), body);
});


test('hub: on a phone Review and store and Discard share a line, Discard at its other end; from 1024 px the pair sits together at the row\'s end (user, 23 Nov 2026)', () => {
    // below 1024 px the row's buttons take its whole width and do not wrap while Discard is not armed
    // (the smoke test measures it at 375 and 390 px); an armed Discard's strip still gets a line
    assert.ok(APP_CSS.includes('@media not all and (min-width:1024px){.todo-acts:has(>.discard){grid-column:1/-1}.todo-acts:has(>.discard:not(.armed)){flex-wrap:nowrap;gap:1rem}}'));
    assert.ok(APP_CSS.includes('.todo-acts>.discard{margin-left:auto}'));
    // from 1024 px: a grid whose last two columns are Review and store and Discard, the small gap
    // between them, right-aligned; an armed Discard's strip on a line of its own under them, its
    // trigger keeping its place (hidden), so Review and store does not move (review M8)
    const desk = /@media \(min-width:1024px\)\{([\s\S]*?)\n\}/.exec(APP_CSS)[1];
    for (const rule of ['.todo-acts:has(>.discard){display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:.5rem}',
        '.todo-acts:has(>.discard)>a{grid-column:2}', '.todo-acts>.discard{grid-column:3;margin-left:0}', '.todo-acts>.discard.armed{display:contents}',
        '.todo-acts>.discard.armed>[data-arm-open]{display:inline-flex;visibility:hidden;grid-column:3;grid-row:1}', '.todo-acts>.discard.armed>[data-arm-strip]{grid-column:1/-1}']) {
        assert.ok(desk.includes(rule), rule);
    }
});


test('team page head from 1024 px: the title with "Updated" raised beside it and Team settings at the line\'s end; Plan on ZwiftGopher and Upload a file side by side at the right (user, 23 Nov 2026)', () => {
    const desk = /@media \(min-width:1024px\)\{([\s\S]*?)\n\}/.exec(APP_CSS)[1];
    // a grid: the title line (the title, Updated, Team settings at its end), the pair right-aligned on
    // a row of its own under it, the stale line (when shown) last, across the whole head
    for (const rule of [
        '.app .cockpit>.pagehead{display:grid;grid-template-columns:minmax(0,auto) auto 1fr auto auto;grid-template-areas:"title fresh . . set" "acts acts acts acts acts" "stale stale stale stale stale";align-items:center;gap:.375rem .5rem}',
        '.app .cockpit>.pagehead h1{grid-area:title}', '.app .cockpit>.pagehead .teamhead>.btn{grid-area:set;margin-left:.75rem}',
        '.app .cockpit>.pagehead>.fresh{grid-area:fresh;align-self:start;margin-top:.125rem;font-size:.8125rem}',
        '.app .cockpit>.pagehead>.headacts{grid-area:acts;justify-self:end;flex-direction:row;align-items:center;gap:.5rem}',
        '.app .cockpit>.pagehead>.stale-banner{grid-area:stale}',
    ]) {
        assert.ok(desk.includes(rule), rule);
    }
    // from 1180 px, where the card has its column, the pair shares the title line: before Team settings
    const wide = /@media \(min-width:1180px\)\{([\s\S]*?)\n\}/.exec(APP_CSS)[1];
    assert.ok(wide.includes('.app .cockpit>.pagehead{grid-template-areas:"title fresh . acts set" "stale stale stale stale stale"}'), wide);
    // the pair as tall as the title, as the head's other buttons (the row does not grow)
    assert.equal(desk.includes('.app .pagehead .headacts.planner>.btn{margin-block:0}'), false);
});


test('hub: the plans waiting from ZwiftGopher, with Review and store and Discard back here', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    upload(c.club, 'sprockets', {riders: ['1009'], at: T('2026-11-19T14:05:00Z')});
    const newId = () => randomId(6);
    const older = addEntry(c.club, {source: 'receive', team: 'sprockets', json: planJson('Sprockets B', ['1009', '1010']), text: null}, {now: T('2026-11-19T18:10:00Z'), newId});
    const newer = addEntry(c.club, {source: 'receive', team: 'sprockets', json: planJson('Sprockets C', ['1009']), text: null}, {now: T('2026-11-19T18:20:00Z'), newId});
    const srv = await serve(t, c);
    const body = await srv.body();
    assert.ok(body.includes('<h2 id="recv-h">New plans from ZwiftGopher</h2>'), body);
    const lines = hubLines(body, 'recv-h');
    assert.deepEqual(lines.map(l => [l.sev, l.team, l.when, l.what]), [
        ['info', 'Sprockets', 'Received 19:20', 'In the planner: Sprockets C · 1 rider'],
        ['info', 'Sprockets', 'Received 19:10', 'In the planner: Sprockets B · 2 riders'],
    ]);
    for (const [line, id] of [[lines[0], newer], [lines[1], older]]) {
        // Review and store: the team page with the entry picked (its Store form); Discard asks first in its place
        assert.ok(line.acts.startsWith(`<div class="todo-acts"><a class="btn primary small" href="/manage/team/sprockets?e=${id}#panel">Review and store<span class="sr"> (Sprockets)</span></a>`), line.acts);
        const form = element(line.acts, '<form class="discard"');
        assert.match(form, /data-arm-open><svg[^>]*>[\s\S]*?<\/svg>Discard<span class="sr"> \(Sprockets\) \d riders? \(/);
        assert.ok(form.includes(`action="/manage/inbox/${id}/discard" data-arm>${CLUB_FIELD}<input type="hidden" name="back" value="/manage">`), form);
        assert.ok(form.includes('<button class="btn secondary danger-text small" type="submit" data-arm-open>'), form);
        assert.ok(form.includes('<button class="btn danger small" type="submit" name="confirm" value="1"'), form);
    }
    // the team page lists it, its row the same link
    assert.ok((await teamBody(srv, 'sprockets')).includes(`<a class="cp-link" href="/manage/team/sprockets?e=${newer}#panel">`));
    // nothing to fix, but plans waiting: no "Nothing to do" line, no to-do block
    assert.ok(!body.includes('Nothing to do') && !body.includes('todo-h'));
    // Discard without the script asks on a page that leads back here; with confirm=1 it lands here
    const ask = await post(srv, c.cookie, `/manage/inbox/${older}/discard`, {back: '/manage'});
    assert.equal(ask.status, 200);
    assert.match(ask.body, /<a class="btn secondary" href="\/manage"><svg[^>]*>[\s\S]*?<\/svg>All teams<\/a>/);
    const done = await followPost(srv, c.cookie, `/manage/inbox/${older}/discard`, {back: '/manage', confirm: '1'});
    assert.equal(done.location, '/manage');
    assert.ok(done.flash.text.startsWith('Discarded'), done.flash.text);
    assert.deepEqual(hubLines(await srv.body(), 'recv-h').map(l => l.when), ['Received 19:20']);
});


test('hub: one table per race day, the next first, up to 7 days ahead', async t => {
    const c = makeClub({teams: [['Rollers', '19:30'], ['Sprockets', '19:40'], ['Gears', '10:00']]});
    // Gears races on Saturdays
    c.club.teams.gears.weekday = 6;
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    upload(c.club, 'gears', {riders: ['1012', '1013'], at: T('2026-11-19T14:00:00Z'), date: '2026-11-21'});
    const srv = await serve(t, c);
    srv.see('1001', '2026-11-19T18:20:00Z', {sig: c.club.sheets[live].sig, mod: '0.3.0', sheet: live, inEvent: true, event: 4567001});
    const body = await srv.body();
    // tonight: the plan open (since 19:00), who has it; Sprockets without a plan is not racing
    // (its regular race day is no race, spec §8)
    assert.deepEqual(raceRows(body, 'Thu 19 Nov'), [
        ['Rollers', '19:30', '\'Rollers · fast\' v1', '1 of 8 have it', 'neutral'],
    ]);
    // Saturday: before the gate, when it opens
    assert.deepEqual(raceRows(body, 'Sat 21 Nov'), [['Gears', '10:00', '\'Gears\' v1', 'opens 09:30', 'neutral']]);
    assert.deepEqual([...body.matchAll(/>Racing ([^<]*)<\/h2>/g)].map(m => m[1]), ['Thu 19 Nov', 'Sat 21 Nov'], 'the next race first');
    // each team a link to its page; the state in words for screen readers; the table's head
    const table = element(body, '<table class="ptable racetable"');
    assert.ok(table.includes('<td><a href="/manage/team/rollers">Rollers</a></td>'), table);
    assert.ok(table.includes('<span class="sr">1 of 8 riders have the plan</span>'), table);
    // on a phone the count alone, under "Riders"; from 1024 px "have it" too
    assert.ok(table.includes('<td>1 of 8<span class="desk"> have it</span></td>'), table);
    assert.ok(table.includes('<thead><tr><th scope="col">Team</th><th scope="col" class="t">Start</th><th scope="col">Live plan</th><th scope="col">Riders</th><th scope="col" class="st"><span class="sr">Status</span></th></tr></thead>'), table);
    // eight days ahead (Friday 13 Nov: tonight's race in 6 days, Saturday's in 8): not Saturday 21
    // Nov; Gears' rhythm day, Sat 14 Nov, has no plan: no race, no table (spec §8)
    srv.clock.now = T('2026-11-13T09:00:00Z');
    const early = await srv.body();
    assert.deepEqual([...early.matchAll(/>Racing ([^<]*)<\/h2>/g)].map(m => m[1]), ['Thu 19 Nov']);
    assert.equal(raceRows(early, 'Sat 14 Nov'), null);
});


test('hub: nothing to do and nothing waiting says so in one line; no race planned', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    upload(c.club, 'sprockets', {riders: ['1009'], at: T('2026-11-19T14:05:00Z')});
    const srv = await serve(t, c);
    const body = await srv.body();
    assert.ok(body.includes('<p class="sevline ok nothing"><svg'), body);
    assert.ok(textOf(element(body, '<p class="sevline ok nothing">')).includes('Nothing to do · next race Thu 19 Nov 19:30'));
    assert.ok(!body.includes('todo-h') && !body.includes('recv-h'));
    assert.ok(raceRows(body, 'Thu 19 Nov') !== null, 'the races still show');
    // a club whose only team has no race: the line says so, no race table
    const lone = makeClub({teams: []});
    lone.club.teams = {};
    const srv2 = await serve(t, lone);
    srv2.store.change(CID, cl => {
        cl.teams.gears = {...structuredClone(srv.store.get(CID).teams.rollers), name: 'Gears', kind: 'special', start: null, races: {}};
    });
    const none = await srv2.body();
    assert.ok(textOf(element(none, '<p class="sevline ok nothing">')).includes('Nothing to do · no race planned'), none);
    assert.ok(!none.includes('racetable') && !none.includes('Next race'));
    // its tile still shows on phones, in "Other teams"
    assert.ok(none.includes('<details class="fold" data-keep-refresh><summary>Other teams (1)</summary>'), none);
});


test('hub: the next race\'s table also when it is more than 7 days away, then that one alone', async t => {
    const c = makeClub({teams: [['Gears', '10:00']]});
    upload(c.club, 'gears', {riders: ['1012', '1013'], at: T('2026-11-12T14:00:00Z'), date: '2026-11-21'});
    // Gears races specials (a weekly team always has a race within 7 days by its rhythm, races spec
    // §4): on Friday 13 Nov its live plan is for Saturday 21 Nov, 8 days ahead, at the team's 10:00
    c.club.teams.gears.kind = 'special';
    const srv = await serve(t, c, {now: T('2026-11-13T09:00:00Z')});
    const body = await srv.body();
    assert.deepEqual([...body.matchAll(/>Racing ([^<]*)<\/h2>/g)].map(m => m[1]), ['Sat 21 Nov'], body);
    assert.deepEqual(raceRows(body, 'Sat 21 Nov'), [['Gears', '10:00', '\'Gears\' v1', 'opens 09:30', 'neutral']]);
});


// ---- the views per race (races spec §4, §4b: "mix") ----

// Friday 20 Nov, 11:00 in Berlin.
const FRI = T('2026-11-20T10:00:00Z');

// Rollers (weekly, Thursday 19:30) gets the races of Thu 19 Nov (over: 'Rollers' and 'Rollers ·
// slow'), Sun 22 Nov at 18:00 with the event link 5123456 (live 'Rollers · fast', and 'Rollers · slow'
// stored after it) and Thu 26 Nov (live 'Rollers'). The version ids by name.
function racesOfRollers(c) {
    const up = (date, type, at) => upload(c.club, 'rollers', {date, type, riders: ROLLERS.slice(0, 6), at: T(at), live: false});
    const ids = {
        old001: up('2026-11-19', null, '2026-11-15T10:00:00Z'),
        old002: up('2026-11-19', 'slow', '2026-11-15T11:00:00Z'),
        sun001: up('2026-11-22', 'fast', '2026-11-18T10:00:00Z'),
        sun002: up('2026-11-22', 'slow', '2026-11-18T11:00:00Z'),
        thu001: up('2026-11-26', null, '2026-11-19T10:00:00Z'),
    };
    Object.assign(race(c.club, 'rollers', '2026-11-22'), {start: '18:00', pinnedEventId: 5123456, live: ids.sun001});
    race(c.club, 'rollers', '2026-11-26').live = ids.thu001;
    return ids;
}


test('team page: every race ahead with its plans, the nearest race open, a later race\'s notes in its box and no fold, over races at the end', async t => {
    const c = makeClub({teams: [['Rollers', '19:30']]});
    const ids = racesOfRollers(c);
    const srv = await serve(t, c, {now: FRI});
    const body = await teamBody(srv, 'rollers');
    const sun = body.indexOf('id="race-2026-11-22"');
    const thu = body.indexOf('id="race-2026-11-26"');
    assert.ok(sun > 0 && sun < thu, `${sun} ${thu}`);
    // the nearest race: its line with the event link, its plans in their fixed order (the first stored
    // first), the live one tagged
    const first = element(body, '<div class="race cp-race" id="race-2026-11-22">');
    const line = textOf(/<p class="race">([\s\S]*?)<\/p>/.exec(first)[1]).trim();
    assert.equal(line, 'Sun 22 Nov · 18:00 · in 2 days · opens 17:30 · Event 5123456');
    const blocks = race => elements(race, '<section class="cp-plan');
    assert.deepEqual(blocks(first).map(r => [rowLabel(r), r.includes('<span class="tag">Live</span>')]), [['fast', true], ['slow', false]]);
    assert.ok(blocks(first)[1].includes(`href="/manage/team/rollers?v=${ids.sun002}#panel"`), 'its version row leads to its panel, where Make live is');
    // the later race: its line and its plans
    const later = element(body, '<div class="race cp-race later" id="race-2026-11-26">');
    assert.ok(textOf(/<p class="race">([\s\S]*?)<\/p>/.exec(later)[1]).trim().startsWith('Thu 26 Nov · 19:30 · in 6 days'), later);
    assert.deepEqual(blocks(later).map(r => [rowLabel(r), r.includes('<span class="tag">Live</span>')]), [['Plan', true]]);
    // the live row: the race's live pointer (?r=, team cockpit spec §5.3b review), not the version
    assert.ok(later.includes('href="/manage/team/rollers?r=2026-11-26#panel"'), later);
    // no fold of the later race (user, 24 Nov 2026): its riders are the card of its live row; no riders table
    // in the list, its notes (none here) and the nearest race's stay under their lines
    assert.equal(/race-more|Live plan and riders|riders-h-2026-11-26|<table/.test(later), false, later);
    assert.equal(count(body, 'race-more'), 0);
    assert.ok(!first.includes('race-more'), 'the nearest race is not folded');
    // the races that are over: folded after the races still to come, each with its plans (read only:
    // forms only in the plans' ⋯, each a fold of its own that holds the reload)
    const over = element(body, '<details class="fold over" id="over" data-keep-refresh>');
    assert.ok(over, body);
    assert.ok(over.startsWith('<details class="fold over" id="over" data-keep-refresh><summary>Over (1)</summary>'), over.slice(0, 120));
    assert.ok(body.indexOf('<details class="fold over" id="over"') > body.indexOf(later) + later.length, 'after every race ahead');
    assert.ok(textOf(over).includes('Thu 19 Nov'), textOf(over));
    for (const id of [ids.old001, ids.old002]) {
        assert.ok(over.includes(`href="/manage/team/rollers?v=${id}#panel"`), over);
    }
    assert.ok(!withoutMenus(over).includes('<form'), 'no form in the over fold but in the ⋯');
    // the head: no rhythm line (the race's line says it, user 23 Nov 2026)
    assert.ok(!element(body, '<header class="pagehead">').includes('class="rhythm"'));
});


test('team page: the help fold "How races work" at the end, after the Over fold; no form in it, so it keeps the reload', async t => {
    const c = makeClub({teams: [['Rollers', '19:30'], ['Cogs', null]]});
    racesOfRollers(c);
    const srv = await serve(t, c, {now: FRI});
    const body = await teamBody(srv, 'rollers');
    const help = element(body, '<details class="help" data-keep-refresh><summary>');
    assert.ok(help, body);
    assert.equal(textOf(/<summary>([\s\S]*?)<\/summary>/.exec(help)[1]).trim(), 'How races work');
    assert.ok(!help.includes('<form'), help);
    assert.equal(textOf(help.replace(/<summary>[\s\S]*?<\/summary>/, '')).trim(), 'A team races in races. Each race has its date, its start time, an event link if you set one,'
        + ' and one live version: what riders get. A plan keeps its versions, up to 20 (at 20 the oldest one that is not live goes), until the race\'s plans are deleted'
        + ' 7 days after its date; pick one to see its riders marked against the live version, and make it live there. Nothing has to be restored: Make live works'
        + ' for any version. A plan from ZwiftGopher or a file waits under "Not stored yet" until you store it.'
        + ' The ⋯ of a race changes its date, time or event link; the ⋯ of a plan renames it or deletes it. A race is over 2 hours after its start;'
        + ' riders get its plan for 2 more hours, and its plans are kept for 7 days after its date, then deleted.');
    // no Restore and no Make live in a ⋯ any more (team cockpit spec §4.1, §5.2)
    assert.ok(!/restore it|makes it live/i.test(help), help);
    // at the end of the page: after the races and the Over fold (which still comes after every race)
    const helpAt = body.indexOf(help);
    const overAt = body.indexOf('<details class="fold over" id="over"');
    assert.ok(overAt > body.indexOf('id="race-2026-11-26"') && helpAt > overAt, `${overAt} ${helpAt}`);
    // the last thing in the list (the panel's body and the riders card follow the list)
    assert.ok(element(body, '<div class="cp-list"').endsWith(`${help}\n  </div>`), element(body, '<div class="cp-list"').slice(-300));
    // a team without any race has it too
    const cogs = await teamBody(srv, 'cogs');
    assert.equal(elements(cogs, '<details class="help" data-keep-refresh><summary>').filter(h => h.includes('How races work')).length, 1);
});


test('club hub: a team is in the table of every day it races, and a to-do item names its race', async t => {
    const c = makeClub();
    racesOfRollers(c);
    // Sprockets races on Thu 26 Nov too; Ben, on Rollers' plan for that day, is on its newer plan:
    // he rides Sprockets, and Rollers has a hole for that race
    upload(c.club, 'sprockets', {riders: ['1001', '1009'], at: T('2026-11-19T12:00:00Z'), date: '2026-11-26'});
    // and a plan for a race on Monday 23 Nov, not live
    const monday = upload(c.club, 'rollers', {type: 'monday', riders: ['1002'], at: T('2026-11-19T13:00:00Z'), date: '2026-11-23', live: false});
    const srv = await serve(t, c, {now: FRI});
    const body = await srv.body();
    assert.deepEqual([...body.matchAll(/>Racing ([^<]*)<\/h2>/g)].map(m => m[1]), ['Sun 22 Nov', 'Mon 23 Nov', 'Thu 26 Nov']);
    assert.deepEqual(raceRows(body, 'Sun 22 Nov'), [['Rollers', '18:00', '\'Rollers · fast\' v1', 'opens 17:30', 'neutral']]);
    // the Monday race has a plan, none live: red at once, 3 days ahead (spec §8)
    assert.deepEqual(raceRows(body, 'Mon 23 Nov'), [['Rollers', '19:30', '–', '–', 'err']]);
    assert.deepEqual(raceRows(body, 'Thu 26 Nov'), [
        ['Rollers', '19:30', '\'Rollers\' v1', 'opens 19:00', 'warn'],
        ['Sprockets', '19:40', '\'Sprockets\' v1', 'opens 19:10', 'neutral'],
    ]);
    // the to-do items name their race: the Monday race's "No live plan" (red at once, spec §8) and
    // the Thursday race's hole, each with its day and time
    assert.deepEqual(hubLines(body, 'todo-h').map(l => [l.sev, l.team, l.when, l.what]), [
        ['err', 'Rollers', 'Mon 23 Nov 19:30', 'No live plan: riders get nothing'],
        ['warn', 'Rollers', 'Thu 26 Nov 19:30', 'Ben now rides Sprockets'],
    ]);
    // the sidebar row and the tile: the nearest race's state
    assert.ok(tiles(body).find(x => x.name === 'Rollers').time.startsWith('Sun 22 Nov 18:00'), JSON.stringify(tiles(body)));
    // on Sunday morning the same: the Monday race's own item, and its button goes to that race's one
    // plan on the team page, not to the nearest race's plans
    srv.clock.now = T('2026-11-22T10:00:00Z');
    const sunday = hubLines(await srv.body(), 'todo-h');
    assert.deepEqual(sunday.map(l => [l.sev, l.team, l.when, l.what]), [
        ['err', 'Rollers', 'Mon 23 Nov 19:30', 'No live plan: riders get nothing'],
        ['warn', 'Rollers', 'Thu 26 Nov 19:30', 'Ben now rides Sprockets'],
    ]);
    assert.ok(sunday[0].acts.includes(`href="/manage/team/rollers?v=${monday}#panel"`), sunday[0].acts);
    assert.ok((await teamBody(srv, 'rollers')).includes('<div class="race cp-race later" id="race-2026-11-23">'));
});


test('hub and team page: the regular race day only preselects; a plan stored but not live is red at once (spec §8)', async t => {
    // Rollers (Thursdays 19:30) and Sprockets (Thursdays 19:40), neither with a plan
    const c = makeClub();
    const srv = await serve(t, c, {now: T('2026-11-20T10:00:00Z')});
    // from the morning after a race to the regular race's S + 2 h (20:30Z): no alarm, no To do, no
    // Racing table; the tiles and the team page say "Next regular race", neutral
    for (const at of ['2026-11-20T10:00:00Z', '2026-11-24T18:30:00Z', '2026-11-26T18:00:00Z', '2026-11-26T18:30:00Z', '2026-11-26T20:30:00Z']) {
        srv.clock.now = T(at);
        const hub = await srv.body();
        assert.ok(!hub.includes('todo-h') && !hub.includes('racetable') && !hub.includes('edge-err') && !hub.includes('trow err'), `${at} ${hub}`);
        assert.deepEqual(tiles(hub).map(x => [x.name, x.sev, x.line, x.quiet]), [
            ['Rollers', 'neutral', 'Next regular race Thu 26 Nov 19:30', 'No plan yet'],
            ['Sprockets', 'neutral', 'Next regular race Thu 26 Nov 19:40', 'No plan yet'],
        ], at);
        const page = await teamBody(srv, 'rollers');
        const main = element(page, '<main class="page wide cockpit"');
        assert.ok(main.includes('<div class="racehead nomenu"><p class="race"><span>Next regular race Thu 26 Nov 19:30</span></p></div>'), `${at} ${main}`);
        assert.match(page, /<span class="sw-icon neutral">/, at);
        assert.ok(!main.includes('sevline err') && !main.includes('callout err') && !main.includes('err-text'), `${at} ${main}`);
        // the upload way stays, in the empty card
        assert.match(element(main, '<section class="card empty"'), /<a class="btn primary block" href="\/manage\/upload\?team=rollers">/, at);
    }
    // the race moved off its rhythm day: a plan for Fri 27 Nov, stored on Saturday, not live:
    // Thursday 26 Nov shows nothing anywhere; Friday is red at once, 6 days ahead, with its "Make a
    // plan live" on the hub
    srv.clock.now = T('2026-11-21T10:00:00Z');
    const friday = srv.store.change(CID, cl => upload(cl, 'rollers', {riders: ROLLERS, at: T('2026-11-21T09:00:00Z'), date: '2026-11-27', live: false}));
    const hub = await srv.body();
    assert.deepEqual([...hub.matchAll(/>Racing ([^<]*)<\/h2>/g)].map(m => m[1]), ['Fri 27 Nov']);
    assert.deepEqual(raceRows(hub, 'Fri 27 Nov'), [['Rollers', '19:30', '–', '–', 'err']]);
    const todo = hubLines(hub, 'todo-h');
    assert.deepEqual(todo.map(l => [l.sev, l.team, l.when, l.what]), [['err', 'Rollers', 'Fri 27 Nov 19:30', 'No live plan: riders get nothing']]);
    assert.equal(todo[0].acts, `<div class="todo-acts"><a class="btn secondary small" href="/manage/team/rollers?v=${friday}#panel">Make a plan live<span class="sr"> (Rollers)</span></a></div>`);
    assert.deepEqual(tiles(hub).find(x => x.name === 'Rollers'), {
        sev: 'err', href: '/manage/team/rollers', name: 'Rollers', time: 'Fri 27 Nov 19:30 · in 6 days',
        line: 'No live plan: riders get nothing', lineSev: 'err', quiet: 'Make one of its plans live',
    });
    const page = await teamBody(srv, 'rollers');
    const main = element(page, '<main class="page wide cockpit"');
    assert.ok(!main.includes('Thu 26 Nov') && !main.includes('race-2026-11-26'), main);
    assert.ok(main.includes('<div class="race cp-race" id="race-2026-11-27">'), main);
    assert.match(page, /<span class="sw-icon err">/);
    // the button's place: the plan's panel, with Make live
    assert.ok(element(await pageBody(srv, `/manage/team/rollers?v=${friday}`), '<div id="panel-acts"').includes('action="/manage/live"'));
});


test('hub: the rows keep their words 12rem wide; one line per thing to do only from 1180 px, its buttons in a column of their own', () => {
    const desk = /@media \(min-width:1024px\)\{([\s\S]*?)\n\}/.exec(APP_CSS)[1];
    const wide = /@media \(min-width:1180px\)\{([\s\S]*?)\n\}/.exec(APP_CSS)[1];
    assert.ok(!/\.todo>li\{grid-template-columns/.test(desk), desk);
    assert.ok(wide.includes('\n  .todo>li{grid-template-columns:1.25rem minmax(7rem,11rem) minmax(12rem,1fr) 21rem;'), wide);
    // an open strip wraps inside the buttons' column: no rule moves the column
    assert.ok(!APP_CSS.includes('.todo-acts:has(form.armed)'));
});


test('hub: from 1024 px no team tiles (the sidebar has them); on phones the tiles under "Teams"', () => {
    const desk = /@media \(min-width:1024px\)\{([\s\S]*?)\n\}/.exec(APP_CSS)[1];
    assert.ok(desk.includes('\n  .hub-teams{display:none}'), desk);
    // nothing hides them below 1024 px
    const phone = APP_CSS.slice(0, APP_CSS.indexOf('@media (min-width:1024px){'));
    assert.ok(!/\.hub-teams[^{]*\{[^}]*display:none/.test(phone));
    assert.ok(!/\.tiles[^{]*\{[^}]*display:none/.test(APP_CSS));
});


test('the plan table\'s styles are its own: .ptable stays as it was for the hub and the privacy page', () => {
    // every rule naming the plan table's classes is scoped to .ptable-plan (or is the caption's)
    const css = APP_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...css.matchAll(/([^{}]*)\{[^{}]*\}/g)].map(m => m[1].trim());
    const own = rules.filter(sel => /\.pt-|\.chg|\.ptable-plan/.test(sel));
    assert.ok(own.length >= 8, own.join('\n'));
    for (const sel of own) {
        for (const part of sel.split(',').map(p => p.trim())) {
            assert.ok(part.startsWith('.ptable-plan') || part === '.pt-cap', part);
        }
    }
    assert.ok(own.includes('.pt-cap'), own.join('\n'));
    // the shared table's five rules, unchanged and in a row
    assert.ok(APP_CSS.includes(`
.ptable{width:100%;border-collapse:collapse;font-size:.9375rem;overflow-wrap:normal}
.ptable th,.ptable td{padding:.5rem .375rem;border-top:1px solid var(--border);text-align:left}
.ptable thead th{border-top:0;color:var(--muted);font-weight:600;font-size:.875rem}
.ptable .n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.ptable .nmcol{font-weight:600}
`));
    assert.equal(rules.filter(sel => /(^|,)\s*\.ptable\b(?!-)/.test(sel)).length, 5, rules.filter(sel => sel.includes('.ptable')).join('\n'));
    // the change colour is the blue info token, never green (live) or red (alarm)
    const chg = own.map(sel => css.slice(css.indexOf(`${sel}{`))).map(r => r.slice(0, r.indexOf('}')));
    assert.ok(chg.some(r => r.includes('var(--info-icon)')), chg.join('\n'));
    assert.ok(!chg.some(r => /--(ok|err|danger|warn)-/.test(r)), chg.join('\n'));
});


// ---- the breadcrumb from 1024 px (UI panel wave 3) ----

// A page's breadcrumb as [{href, label, current}] (href null for the page itself), or null.
function crumbsOf(body) {
    const nav = element(body, '<nav class="crumbs desk" aria-label="Breadcrumb">');
    if (nav === null) {
        return null;
    }
    return elements(nav, '<li>').map(li => {
        const a = /^<li><a href="([^"]*)">([^<]*)<\/a><span class="sep" aria-hidden="true">›<\/span><\/li>$/.exec(li);
        const here = /^<li><span aria-current="page">([^<]*)<\/span><\/li>$/.exec(li);
        assert.ok(a || here, li);
        return a ? {href: textOf(a[1]), label: textOf(a[2]), current: false} : {href: null, label: textOf(here[1]), current: true};
    });
}


test('breadcrumb: every captain page below the overview, each crumb but the last a link, and the phone\'s way back goes to the crumb before the page', async t => {
    const c = makeClub();
    const v1 = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS.slice(0, 6), at: T('2026-11-19T14:00:00Z')});
    version(c.club, 'rollers', v1, ROLLERS.slice(1, 7), '2026-11-19T15:00:00Z');
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ROLLERS.slice(0, 6), at: T('2026-11-19T15:10:00Z'), live: false});
    const plan = c.club.sheets[v1].plan;
    const srv = await serve(t, c, {env: {CODE_SECRET}});
    const entry = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS.slice(0, 5))});
    const discardAsk = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS.slice(0, 3))});
    const get = async (p, status = 200) => {
        const res = await srv.get(p, c.cookie);
        const body = await res.text();
        assert.equal(res.status, status, `${p}: ${body}`);
        return body;
    };
    const answer = async (p, fields) => {
        const res = await post(srv, c.cookie, p, fields);
        assert.equal(res.status, 200, `${p}: ${res.body}`);
        return res.body;
    };
    const TEAM = '/manage/team/rollers';
    const club = {href: '/manage', label: 'Kettenfett RC'};
    const team = {href: TEAM, label: 'Rollers'};
    const settings = {href: '/manage/settings', label: 'Club settings'};
    // [what, body, the crumbs before the page, the page's own crumb, the phone's back label (null: no back bar)]
    const pages = [
        ['team settings', await get(`${TEAM}/settings`), [club, team], 'Team settings', 'Rollers'],
        ['upload page', await get('/manage/upload?team=rollers'), [club, team], 'Upload', 'Rollers'],
        ['upload for a plan', await get(`/manage/upload?team=rollers&plan=${plan}&from=plan`), [club, team], 'Upload', 'Rollers'],
        ['new team', await get('/manage/new-team'), [club], 'Add a team', 'All teams'],
        ['club settings', await get('/manage/settings'), [club], 'Club settings', 'All teams'],
        ['team gone', await get('/manage/team/nope', 404), [club], 'Not found', 'All teams'],
        ['entry gone', await get('/manage/inbox/zzzzzz', 404), [club], 'Not found', 'All teams'],
        ['not found', await get('/manage/nothing-here', 404), [club], 'Not found', 'All teams'],
        ['live confirm', await answer('/manage/live', {team: 'rollers', sheet: slow}), [club, {href: `${TEAM}?v=${slow}`, label: 'Rollers'}], 'Confirm', null],
        ['live confirm from a plan page left open', await answer('/manage/live', {team: 'rollers', sheet: slow, back: 'plan'}),
            [club, {href: `${TEAM}?v=${slow}`, label: 'Rollers'}], 'Confirm', null],
        ['delete confirm', await answer('/manage/sheet/delete', {team: 'rollers', sheet: slow}), [club, team], 'Confirm', null],
        ['discard confirm', await answer(`/manage/inbox/${discardAsk}/discard`, {back: TEAM}), [club, team], 'Confirm', null],
        ['team settings confirm', await answer('/manage/team', {action: 'delete', team: 'rollers'}), [club, team, {href: `${TEAM}/settings`, label: 'Team settings'}], 'Confirm', null],
        ['club settings confirm', await answer('/manage/code', {action: 'on'}), [club, settings], 'Confirm', null],
        ['rider code', await answer('/manage/code', {action: 'on', confirm: '1'}), [club, settings], 'Rider code', null],
    ];
    for (const [what, body, before, own, back] of pages) {
        const crumbs = crumbsOf(body);
        assert.deepEqual(crumbs, [...before.map(x => ({...x, current: false})), {href: null, label: own, current: true}], what);
        assert.equal(count(body, '<nav class="crumbs'), 1, what);
        // at the top of the page, before its head
        const main = element(body, '<main class="page');
        assert.match(main, /^<main class="page[^"]*" id="main"(?: data-tv="\d+" data-here="[^"]*")?>\s*<nav class="crumbs desk"/, what);
        // no kicker for desktops only: the breadcrumb says it there
        assert.ok(!body.includes('class="kicker desk"'), what);
        const bar = element(body, '<nav class="topbar plain" aria-label="Back">');
        if (back === null) {
            assert.equal(bar, null, what);
        } else {
            // the phone's way back is the crumb before the page
            const m = /<a class="back" href="([^"]*)"><svg[^>]*>[\s\S]*?<\/svg>([^<]*)<\/a>/.exec(bar);
            assert.deepEqual([textOf(m[1]), textOf(m[2])], [before.at(-1).href, back], what);
        }
        // a question without the script: its way back is the crumb before the page too
        if (own === 'Confirm') {
            const way = /<a class="btn secondary" href="([^"]*)"><svg/.exec(element(body, '<section class="card stack">'))[1];
            assert.equal(textOf(way), before.at(-1).href, what);
            // the confirm button and its Cancel in one row (beside each other from 1024 px, review M7)
            assert.match(element(body, '<div class="confirm-acts">'), /^<div class="confirm-acts"><form method="post" [\s\S]*?<\/form>\s*<a class="btn secondary" href="[^"]*"><svg[\s\S]*?<\/a><\/div>$/, what);
        }
    }
    // the team page has none (user, 23 Nov 2026): the sidebar names the club and the team, the
    // phone's switch bar leads back
    const flashed = await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS.slice(0, 4))}, {as: plan, live: 'on'});
    for (const [q, body] of [['', await get(TEAM)], [`?v=${slow}`, await get(`${TEAM}?v=${slow}`)], [`?e=${entry}`, await get(`${TEAM}?e=${entry}`)], ['the Store flash', flashed]]) {
        assert.equal(crumbsOf(body), null, q);
        assert.equal(count(body, 'class="crumbs'), 0, q);
    }
    // the overview has none: its kicker names the next race
    const hub = await get('/manage');
    assert.equal(crumbsOf(hub), null);
    assert.equal(count(hub, 'class="crumbs'), 0);
    // the stylesheet: the breadcrumb from 1024 px only, where the kicker under it and the back bar go
    assert.ok(APP_CSS.includes('@media (max-width:1023.98px){.desk{display:none!important}}'));
    const desk = /@media \(min-width:1024px\)\{([\s\S]*?)\n\}/.exec(APP_CSS)[1];
    assert.ok(desk.includes('\n  .app .crumbs~.pagehead .kicker{display:none}\n') && desk.includes('\n  .app>.topbar,.app>.page>.foot{display:none}\n'), desk);
    // a question's Cancel: under its confirm on phones, beside it from 1024 px
    assert.ok(APP_CSS.includes('\n.confirm-acts{display:grid;') && desk.includes('\n  .confirm-acts{display:flex;'), desk);
});


// ---- one button system (UI panel wave 3) ----

// Every button of a page: <button>, and <a> and <summary> styled as one (class "btn …"), as {tag,
// cls, attrs, text, block, strip, foot, form}: `block` the innermost <li>, <section>, <header>,
// <main>, <footer>, <aside>, arm strip or slot of the team page's panel (#panel, #panel-body) around
// it (its id in the page), `strip` inside an arm strip, `foot` inside a footer, `form` the markup of
// the form around it ('' without one).
const VOID_TAGS = new Set(['input', 'br', 'img', 'meta', 'link', 'hr', 'path', 'circle', 'rect']);
function buttonsOf(html) {
    const stack = [];
    const out = [];
    let id = 0;
    const isStrip = el => (el.cls ?? '').split(' ').includes('arm-strip');
    const isSlot = el => el.tag === 'div' && /\bid="panel(?:-body|-acts)?"/.test(el.attrs);
    for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|[^>"])*?)(\/?)>/g)) {
        const [, close, raw, attrs, self] = m;
        const tag = raw.toLowerCase();
        if (close) {
            const at = stack.map(x => x.tag).lastIndexOf(tag);
            if (at >= 0) {
                stack.length = at;
            }
            continue;
        }
        const cls = /\bclass="([^"]*)"/.exec(attrs)?.[1] ?? null;
        const el = {tag, cls, attrs, id: id++, at: m.index};
        if (tag === 'button' || ((tag === 'a' || tag === 'summary') && /(^| )btn( |$)/.test(cls ?? ''))) {
            const block = [...stack].reverse().find(x => ['li', 'section', 'header', 'main', 'footer', 'aside'].includes(x.tag) || isStrip(x) || isSlot(x));
            const form = [...stack].reverse().find(x => x.tag === 'form');
            out.push({tag, cls, attrs, text: textOf(element(html, `<${tag}`, m.index)).trim(), block: block?.id ?? -1,
                acts: block !== undefined && /\bid="panel-acts"/.test(block.attrs),
                strip: stack.some(isStrip), foot: stack.some(x => x.tag === 'footer'), form: form ? element(html, '<form', form.at) : ''});
        }
        if (!self && !VOID_TAGS.has(tag)) {
            stack.push(el);
        }
    }
    return out;
}

const KINDS = ['primary', 'secondary', 'quiet', 'danger'];
// the table of the brief: what each kind may carry besides its size and width
const EXTRA = new Set(['small', 'block', 'danger-text', 'hub-add']);

// The rules for every button of `body` (page `what`): one kind each; danger only as the confirm
// (in an arm strip, or the no-script question's form with confirm=1); red text on an outline only on
// a button that asks first (it opens a strip, or the club's delete, which asks by mail); at most one
// primary per block, the first button of its block, except in the team page's card actions
// (#panel-acts: Discard · Store · Make live, Make live always the rightmost, user 23 Nov 2026), where
// it is the last; a footer's plain buttons are its links.
function checkButtons(what, body) {
    const buttons = buttonsOf(body);
    assert.ok(buttons.length > 0, what);
    const byBlock = new Map();
    for (const b of buttons) {
        const label = `${what}: <${b.tag} class="${b.cls}"> ${b.text}`;
        if (b.cls === null) {
            assert.ok(b.foot && b.tag === 'button', `${label}: a button without a class outside the footer`);
            continue;
        }
        const tokens = b.cls.split(' ');
        assert.equal(tokens[0], 'btn', label);
        const kinds = tokens.filter(x => KINDS.includes(x));
        assert.equal(kinds.length, 1, label);
        assert.ok(tokens.slice(1).every(x => KINDS.includes(x) || EXTRA.has(x)), label);
        const [kind] = kinds;
        if (kind === 'danger') {
            assert.ok((b.strip && b.attrs.includes('data-arm-yes')) || b.form.includes('<input type="hidden" name="confirm" value="1">'), `${label}: danger only as a confirm`);
        }
        if (tokens.includes('danger-text')) {
            assert.equal(kind, 'secondary', label);
            assert.ok(b.attrs.includes('data-arm-open') || b.form.includes('action="/manage/delete"'), `${label}: red text only on a button that asks first`);
        }
        if (!byBlock.has(b.block)) {
            byBlock.set(b.block, []);
        }
        byBlock.get(b.block).push({kind, label, main: kind === 'primary' || (kind === 'danger' && !b.strip), acts: b.acts});
    }
    for (const list of byBlock.values()) {
        const primaries = list.filter(x => x.kind === 'primary');
        assert.ok(primaries.length <= 1, `more than one primary in a block: ${primaries.map(x => x.label).join(' | ')}`);
        const main = list.findIndex(x => x.main);
        if (list.some(x => x.acts)) {
            assert.ok(main === -1 || main === list.length - 1, `the main action last in the card's actions: ${list.map(x => x.label).join(' | ')}`);
        } else {
            assert.ok(main <= 0, `the main action first in its block: ${list.map(x => x.label).join(' | ')}`);
        }
    }
    return buttons;
}


test('one button system: every captain page, in its main states', async t => {
    const c = makeClub({teams: [['Rollers', '19:30'], ['Sprockets', '19:40'], ['Cogs', null]]});
    const v1 = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS.slice(0, 6), at: T('2026-11-19T14:00:00Z'), pinned: 4567890});
    version(c.club, 'rollers', v1, ROLLERS.slice(1, 7), '2026-11-19T15:00:00Z');
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ROLLERS.slice(0, 6), at: T('2026-11-19T15:10:00Z'), live: false});
    upload(c.club, 'sprockets', {riders: ['1001', '1009'], at: T('2026-11-19T16:30:00Z')});
    const newId = () => randomId(6);
    addEntry(c.club, {source: 'receive', team: 'rollers', json: planJson('Rollers B', ['1002', '1003']), text: null}, {now: T('2026-11-19T18:10:00Z'), newId});
    addEntry(c.club, {source: 'receive', team: 'rollers', json: planJson('Rollers C', ['1002']), text: null}, {now: T('2026-11-19T18:20:00Z'), newId});
    const plan = c.club.sheets[v1].plan;
    const liveNow = liveId(c.club, 'rollers');
    const srv = await serve(t, c, {env: {CODE_SECRET, PUBLIC_URL: 'https://paceline.example.org'}});
    const entry = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS.slice(0, 5))});
    const get = async (p, status = 200) => {
        const res = await srv.get(p, c.cookie);
        const body = await res.text();
        assert.equal(res.status, status, `${p}: ${body}`);
        return body;
    };
    const answer = async (p, fields) => {
        const res = await post(srv, c.cookie, p, fields);
        assert.equal(res.status, 200, `${p}: ${res.body}`);
        return res.body;
    };
    const TEAM = '/manage/team/rollers';
    const pages = [
        ['hub', await get('/manage')],
        ['team page', await get(TEAM)],
        ['team page, no start time', await get('/manage/team/cogs')],
        ['team settings', await get(`${TEAM}/settings`)],
        ['team settings, no start time', await get('/manage/team/cogs/settings')],
        ['team page, the live version picked', await get(`${TEAM}?v=${liveNow}`)],
        ['team page, a version not live picked', await get(`${TEAM}?v=${slow}`)],
        ['upload page', await get('/manage/upload?team=rollers')],
        ['team page, a plan not stored yet picked', await get(`${TEAM}?e=${entry}`)],
        ['new team', await get('/manage/new-team')],
        ['club settings, open', await get('/manage/settings')],
        ['team gone', await get('/manage/team/nope', 404)],
        ['entry gone', await get('/manage/inbox/zzzzzz', 404)],
        ['not found', await get('/manage/nothing-here', 404)],
        ['live confirm', await answer('/manage/live', {team: 'rollers', sheet: slow})],
        ['delete confirm', await answer('/manage/sheet/delete', {team: 'rollers', sheet: slow})],
        ['team settings confirm', await answer('/manage/team', {action: 'delete', team: 'cogs'})],
        ['club settings confirm', await answer('/manage/code', {action: 'on'})],
        ['team page, the Store flash, not live', await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS.slice(0, 4))}, {as: plan})],
        ['team page, the Store flash, live', await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS.slice(0, 3))}, {as: plan, live: 'on'})],
        ['rider code', await answer('/manage/code', {action: 'on', confirm: '1'})],
        ['club settings, private', await get('/manage/settings')],
    ];
    // a club without teams: the first run
    const lone = secondClub();
    srv.store.create(lone.club);
    pages.push(['first run', await (await srv.get('/manage', lone.cookie)).text()]);
    assert.ok(pages.at(-1)[1].includes('<body class="firstrun">'));
    for (const [what, body] of pages) {
        checkButtons(what, body);
    }
    // the words: one per action (the audit's label list)
    const all = pages.flatMap(([what, body]) => buttonsOf(body).map(b => ({what, ...b})));
    const texts = new Set(all.map(b => b.text));
    for (const gone of [/^Rename$/, /^Save$/, /^Remove the event link/, /^Discard this plan/, /^Back to your teams$/]) {
        assert.ok(![...texts].some(x => gone.test(x)), `no ${gone} any more`);
    }
    for (const [label, kind] of [['Save name', 'primary'], ['Save race day and time', 'primary'], ['Save club', 'primary'],
        ['Change e-mail', 'primary'], ['Copy the code', 'primary'], ['Review and store', 'primary'],
        ['Team settings', 'quiet'], ['Club settings', 'quiet']]) {
        const found = all.filter(b => b.text === label || b.text.startsWith(`${label} `));
        assert.ok(found.length > 0, label);
        assert.ok(found.every(b => b.cls.split(' ').includes(kind)), `${label}: ${found.map(b => `${b.what} ${b.cls}`).join(' | ')}`);
    }
    // a question's way back is its Cancel, right after the confirm (secondary); leaving a page where
    // nothing waits is navigation (quiet): the rider code's way back (the Store flash has none: it is
    // on the team page)
    const backs = all.filter(b => /^Back to /.test(b.text)).map(b => [b.what, b.text, b.cls]);
    assert.deepEqual(backs.filter(([what]) => / confirm$/.test(what)).map(x => x[2]), Array(4).fill('btn secondary'), JSON.stringify(backs));
    assert.deepEqual(backs.filter(([what]) => !/ confirm$|gone$/.test(what)).map(x => [x[0], x[2]]), [['rider code', 'btn quiet']], JSON.stringify(backs));
    // with a planner link (these pages have PUBLIC_URL; races spec §4): Plan on ZwiftGopher is the
    // primary in the team page's head and the main action of the empty card, the file upload a
    // secondary (bordered) button after it (user, 23 Nov 2026); no "Upload a plan" (without a planner link: captain.test "Plan on ZwiftGopher first")
    const ways = body => buttonsOf(body).filter(b => ['Plan on ZwiftGopher', 'Upload a file', 'Upload a plan'].includes(b.text)).map(b => [b.text, b.cls]);
    // (on the team page twice: the head's, and the copy at the list's top that stands in for it from
    // 1180 px, user 23 Nov 2026; one shows at a time)
    assert.deepEqual([ways(pages[1][1]), ways(pages[2][1])], [
        [['Plan on ZwiftGopher', 'btn primary small'], ['Upload a file', 'btn secondary small'], ['Plan on ZwiftGopher', 'btn primary small'], ['Upload a file', 'btn secondary small']],
        [['Plan on ZwiftGopher', 'btn primary block'], ['Upload a file', 'btn secondary small']],
    ]);
    // Discard and Remove event link read the same on every page ("Discard", no "…": user, 23 Nov 2026;
    // the screen-reader text names the team and riders after it); every Make live reads "Make live"
    assert.ok(all.filter(b => b.text.startsWith('Discard')).every(b => /^Discard( |$)/.test(b.text)), [...texts].join(' | '));
    assert.ok(!texts.has('Discard…') && ![...texts].some(x => /^Make v\d|live…/.test(x)), [...texts].join(' | '));
    // (the link is the race's: its ⋯ on the team page offers Remove, races spec §7; whatever is picked)
    const removes = all.filter(b => b.text.startsWith('Remove event link')).map(b => b.what);
    assert.ok(removes.includes('team page') && removes.every(w => w.startsWith('team page') && !w.includes('no start time')), JSON.stringify(removes));
});


// ---- the two ⋯ menus (races spec §4 "Race ⋯" and "Plan ⋯", §7; races Task 6) ----

// The menus (ui.mjs menu) of `html`, whole.
const menusOf = html => elements(html, '<details class="menu" data-menu');
// The menu of `html` whose summary is labelled `label` (as drawn: escaped), or null.
const menuOf = (html, label) => menusOf(html).find(m => m.includes(`<summary class="btn quiet small" aria-label="${label}">`)) ?? null;
// `html` without its menus.
const withoutMenus = html => menusOf(html).reduce((rest, m) => rest.replace(m, ''), html);


test('race menu: date and time, event link; none on an over race or a date without plans', async t => {
    const c = makeClub({teams: [['Rollers', '19:30'], ['Sprockets', '19:40']]});
    racesOfRollers(c);
    // Sprockets races on Sun 29 Nov only: its rhythm date Thu 26 Nov comes first, without plans
    upload(c.club, 'sprockets', {riders: ['1009'], at: T('2026-11-19T12:00:00Z'), date: '2026-11-29', live: false});
    const srv = await serve(t, c, {now: FRI});
    const body = await teamBody(srv, 'rollers');
    const version = VERSION_OF(srv, 'rollers');
    const sun = element(body, '<div class="race cp-race" id="race-2026-11-22">');
    const rm = menuOf(sun, 'Options for the race on Sun 22 Nov');
    assert.ok(rm, sun);
    assert.ok(rm.startsWith('<details class="menu" data-menu id="menu-race-2026-11-22"><summary class="btn quiet small" aria-label="Options for the race on Sun 22 Nov">'), rm.slice(0, 200));
    assert.equal(count(body, 'aria-label="Options for the race on Sun 22 Nov"'), 1);
    // in the corner of the race line, before the race's plans
    assert.ok(sun.indexOf(rm) < sun.indexOf('<p class="race">') + 400 && sun.indexOf(rm) < sun.indexOf('<section class="cp-plan'), 'beside the race line');
    // date and time: asks first in its place (no script: the server's question)
    const when = armOf(rm, '/manage/race');
    const hid = action => `<input type="hidden" name="action" value="${action}"><input type="hidden" name="team" value="rollers"><input type="hidden" name="date" value="2026-11-22"><input type="hidden" name="version" value="${version}">`;
    assert.ok(armHas(when, '/manage/race', hid('when'), 'btn primary small', 'Move the race'), when);
    assert.ok(when.includes('<input type="date" name="to" value="2026-11-22" required>'), when);
    // the race's own time, prefilled and required; no "Empty: the team's start time" hint (user, 23
    // Nov 2026: a race's start time is pinned, the team's is only the default for new races)
    assert.ok(when.includes('<label class="field">Start time<input type="time" name="start" value="18:00" required></label>'), when);
    assert.equal(/Empty:|team's start time/.test(textOf(when)), false, textOf(when));
    assert.ok(textOf(when).includes('Save date and time…'), textOf(when));
    // one short sentence; the script writes the date as a day (the time's span brings its own space:
    // no stray one without a time, races Task 7)
    assert.ok(when.includes('Moves the race and its plans to <span data-arm-fill="to" data-arm-format="day"></span><span data-arm-fill="start" data-arm-pre=" "></span>.'), when);
    // the event link, with a field to change it and Remove
    assert.ok(textOf(rm).includes('Event link 5123456 (yours): the plans go only to riders in that event.'), textOf(rm));
    const event = /<form method="post" action="\/manage\/race">(?:(?!<\/form>)[\s\S])*name="action" value="event"[\s\S]*?<\/form>/.exec(rm)?.[0];
    assert.ok(event && event.includes(`${CLUB_FIELD}${hid('event')}`), rm);
    assert.ok(/<input [^>]*name="event"[^>]*>/.test(event) && /<input [^>]*maxlength="300"/.test(event) && /<input [^>]*inputmode="url"/.test(event), event);
    assert.ok(textOf(event).includes('Event link') && textOf(event).includes('Save event link'), textOf(event));
    assert.ok(rm.includes(`<form method="post" action="/manage/race">${CLUB_FIELD}${hid('unlink')}<button class="btn secondary small" type="submit">`), rm);
    assert.ok(textOf(rm).includes('Remove event link'), textOf(rm));
    // the event id once: in the race line and the menu, not in the live plan's block
    assert.ok(!textOf(withoutMenus(element(sun, '<section class="cp-plan live" '))).includes('5123456'), 'not in the plan block');
    // a later race: its own menu; no link, so no Remove
    const thu = element(body, '<div class="race cp-race later" id="race-2026-11-26">');
    const thuMenu = menuOf(thu, 'Options for the race on Thu 26 Nov');
    assert.ok(thuMenu, thu);
    assert.ok(textOf(thuMenu).includes('No event link: the plans find the event by the start time.'), textOf(thuMenu));
    assert.ok(!thuMenu.includes('value="unlink"'), thuMenu);
    assert.ok(thuMenu.includes(`<input type="time" name="start" value="${raceStart(srv.store.get(CID), 'rollers', '2026-11-26')}" required>`), 'its time prefilled');
    // the races that are over have no race ⋯; their plans' ⋯ has Delete only (races spec §7)
    const over = element(body, '<details class="fold over" id="over"');
    assert.ok(over && !over.includes('id="menu-race-') && over.includes('id="menu-plan-'), over);
    assert.ok(!over.includes('/manage/plan/rename') && !over.includes('/manage/upload') && over.includes('/manage/sheet/delete'), over);
    // Sprockets' rhythm date without plans (Thu 26 Nov) is no race (spec §8): nothing on the page;
    // its race of Sun 29 Nov is its nearest, with its own menu
    const sp = await teamBody(srv, 'sprockets');
    assert.ok(!sp.includes('race-2026-11-26') && !textOf(sp).includes('Thu 26 Nov'), sp);
    assert.ok(menuOf(element(sp, '<div class="race cp-race" id="race-2026-11-29">'), 'Options for the race on Sun 29 Nov'), sp);
});


// The ways to a plan of a page part: [class, href, text] of each upload or planner link.
const waysOf = html => [...(html ?? '').matchAll(/<a class="([^"]*)" href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)]
    .filter(m => m[2].startsWith('/manage/upload') || m[2].startsWith('https://zwiftgopher.com/'))
    .map(m => [m[1], m[2].startsWith('https://') ? 'zwiftgopher' : m[2].replace(/&amp;/g, '&'), textOf(m[3]).trim()]);


test('team page: Plan on ZwiftGopher first, Upload a file as a secondary button; without a planner link Upload a plan', async t => {
    const c = makeClub({teams: [['Rollers', '19:30'], ['Sprockets', '19:40']]});
    racesOfRollers(c);
    const srv = await serve(t, c, {now: FRI, env: {PUBLIC_URL: 'https://paceline.example.org'}});
    // the head of a team with plans, and the card of a team without
    const head = element(await teamBody(srv, 'rollers'), '<header class="pagehead">');
    assert.deepEqual(waysOf(head), [['btn primary small', 'zwiftgopher', 'Plan on ZwiftGopher'], ['btn secondary small', '/manage/upload?team=rollers', 'Upload a file']]);
    // a block of its own, so the primary is the first button of its block (the button system)
    assert.match(head, /<section class="headacts planner"><a class="btn primary small" href="https:\/\/zwiftgopher\.com\/TTT\/\?paceline=[^"]*" target="_blank" rel="noopener noreferrer" aria-label="Plan on ZwiftGopher \(opens a new tab\)">[\s\S]*?<\/a><a class="btn secondary small" href="\/manage\/upload\?team=rollers">[\s\S]*?<\/a><\/section>/);
    const sp = await teamBody(srv, 'sprockets');
    const card = element(sp, '<section class="card empty"');
    assert.deepEqual(waysOf(card), [['btn primary block', 'zwiftgopher', 'Plan on ZwiftGopher'], ['btn secondary small', '/manage/upload?team=sprockets', 'Upload a file']]);
    assert.ok(!sp.includes('class="headacts'), 'the empty card has them');
    // no "Upload a plan" button with a planner link
    assert.ok(!textOf(head).includes('Upload a plan') && !textOf(card).includes('Upload a plan'));
    // without PUBLIC_URL: Upload a plan as before
    const bare = makeClub({teams: [['Rollers', '19:30'], ['Sprockets', '19:40']]});
    racesOfRollers(bare);
    const none = await serve(t, bare, {now: FRI});
    assert.deepEqual(waysOf(element(await teamBody(none, 'rollers'), '<header class="pagehead">')), [['btn secondary small', '/manage/upload?team=rollers', 'Upload a plan']]);
    assert.deepEqual(waysOf(element(await teamBody(none, 'sprockets'), '<section class="card empty"')), [['btn primary block', '/manage/upload?team=sprockets', 'Upload a plan']]);
    // on a phone the head's pair side by side when it fits, else Upload a file wraps under the planner
    // button (user, 23 Nov 2026)
    assert.ok(APP_CSS.includes('.headacts.planner{flex-wrap:wrap;align-items:center;gap:.5rem}'), 'side by side, wrapping');
    assert.equal(APP_CSS.includes('.headacts.planner{flex-direction:column'), false, 'no longer stacked');
    assert.ok(APP_CSS.includes('.headacts.planner>.btn{flex:none}'), 'each its own height');
    // from 1024 px side by side on the title's row (user, 23 Nov 2026): one row, so the head buttons'
    // negative margin (the row as tall as the title) applies to them too (the CSS test above)
    assert.equal(APP_CSS.includes('.app .pagehead .headacts.planner>.btn{margin-block:0}'), false);
});


test('race menu: no upload link (the race of a new plan is chosen in the Store form); a race line without a ⋯ keeps no room for one', async t => {
    const c = makeClub({teams: [['Rollers', '19:30'], ['Sprockets', '19:40']]});
    racesOfRollers(c);
    upload(c.club, 'sprockets', {riders: ['1009'], at: T('2026-11-19T12:00:00Z'), date: '2026-11-29', live: false});
    const srv = await serve(t, c, {now: FRI});
    const body = await teamBody(srv, 'rollers');
    for (const day of ['2026-11-22', '2026-11-26']) {
        const rm = body.slice(body.indexOf(`id="menu-race-${day}"`)).split('</details>')[0];
        // user, 23 Nov 2026: "Upload a file for this race" went (a new plan's race is chosen in the Store
        // form's race fold; the upload page keeps taking `date=` for links already handed out)
        assert.ok(rm.includes('action="/manage/race"'), rm);
        assert.equal(rm.includes('/manage/upload'), false, rm);
        assert.equal(textOf(rm).includes('Upload a file for this race'), false, textOf(rm));
    }
    // the race lines: with a ⋯ the room for it; Sprockets' race of Sun 29 Nov has one; once its plan
    // is gone, its line is the regular race day's (spec §8), without a ⋯, so no room for one
    assert.ok(body.includes('<div class="racehead"><p class="race">'), body);
    assert.ok(element(await teamBody(srv, 'sprockets'), '<div class="race cp-race" id="race-2026-11-29">').includes('<div class="racehead"><p class="race">'));
    srv.store.change(CID, cl => {
        for (const id of Object.keys(cl.sheets).filter(k => cl.sheets[k].team === 'sprockets')) {
            delete cl.sheets[id];
        }
        delete cl.teams.sprockets.races['2026-11-29'];
    });
    const sp = await teamBody(srv, 'sprockets');
    assert.ok(sp.includes('<div class="race cp-race">\n    <div class="racehead nomenu"><p class="race"><span>Next regular race Thu 26 Nov 19:40</span></p></div>'), sp);
    assert.ok(APP_CSS.includes('.racehead.nomenu{min-height:0;padding-right:0}'), 'no 44 px and no gutter without a ⋯');
});


test('race menu: the date and time strip of a weekly team without any start time leaves no stray space', async t => {
    const c = makeClub({teams: [['Rollers', null]]});
    upload(c.club, 'rollers', {riders: ['1001'], at: T('2026-11-19T12:00:00Z'), date: '2026-11-22', live: false});
    const srv = await serve(t, c, {now: FRI});
    const rm = menuOf(await teamBody(srv, 'rollers'), 'Options for the race on Sun 22 Nov');
    assert.ok(rm, 'the menu');
    // nothing to prefill: the field is empty and not required (user, 23 Nov 2026: required only with
    // a time to keep)
    assert.ok(rm.includes('<input type="time" name="start" value="">'), rm);
    // the time's span brings its own space, so an empty time leaves "… Sun 22 Nov."
    assert.ok(rm.includes('Moves the race and its plans to <span data-arm-fill="to" data-arm-format="day"></span><span data-arm-fill="start" data-arm-pre=" "></span>.'), rm);
});


test('race menu: a special team\'s time is required, a learned event is named', async t => {
    const c = makeClub({teams: [['Rollers', '19:30'], ['Cogs', null]]});
    Object.assign(c.club.teams.cogs, {kind: 'special', weekday: null});
    uploadSheet(c.club, {slug: 'cogs', json: planJson('Cogs', ['1009']), text: null, date: '2026-11-22', start: '17:15', base: c.club.teams.cogs.version,
        via: 'file', type: null, as: 'new', live: true, pinnedEventId: null}, {now: T('2026-11-18T12:00:00Z'), newId: () => randomId(6)});
    Object.assign(race(c.club, 'cogs', '2026-11-22'), {eventId: 5123999, boundAt: '2026-11-19T10:00:00.000Z'});
    const srv = await serve(t, c, {now: FRI});
    const body = await teamBody(srv, 'cogs');
    const rm = menuOf(body, 'Options for the race on Sun 22 Nov');
    assert.ok(rm, body);
    assert.ok(rm.includes('<input type="time" name="start" value="17:15" required>'), rm);
    assert.ok(rm.includes('<span data-arm-fill="start" data-arm-pre=" "></span>'), 'a special race\'s time is never empty: no team time to show');
    assert.ok(!textOf(rm).includes('Empty:'), textOf(rm));
    assert.ok(textOf(rm).includes('Event 5123999, learned from a rider\'s check.'), textOf(rm));
    assert.ok(!rm.includes('value="unlink"'), 'nothing to remove');
});


test('plan menu on the team page: Rename, Delete, no New version; Make live is the panel\'s', async t => {
    const c = makeClub({teams: [['Rollers', '19:30']]});
    const ids = racesOfRollers(c);
    const srv = await serve(t, c, {now: FRI});
    const body = await teamBody(srv, 'rollers');
    const version = VERSION_OF(srv, 'rollers');
    const rowOf = id => elements(body, '<section class="cp-plan').find(r => r.includes(` id="plan-${id}"`));
    for (const [id, label, type, live] of [[ids.sun001, 'Rollers · fast', 'fast', true], [ids.sun002, 'Rollers · slow', 'slow', false], [ids.thu001, 'Rollers', '', true]]) {
        const row = rowOf(id);
        assert.ok(row, id);
        const pm = menuOf(row, `Options for &#39;${label}&#39;`);
        assert.ok(pm, row);
        assert.ok(pm.startsWith(`<details class="menu" data-menu id="menu-plan-${id}">`), pm.slice(0, 80));
        // Rename: the type, on every version
        const rename = /<form [^>]*action="\/manage\/plan\/rename">[\s\S]*?<\/form>/.exec(pm)?.[0];
        assert.ok(rename, pm);
        assert.ok(rename.includes(`${CLUB_FIELD}<input type="hidden" name="team" value="rollers"><input type="hidden" name="plan" value="${id}"><input type="hidden" name="version" value="${version}">`), rename);
        assert.ok(rename.includes(`name="type" value="${type}" maxlength="30"`), rename);
        assert.ok(!rename.includes('name="back"'), 'back to the team page');
        assert.ok(textOf(rename).includes('The plan reads as the team\'s name plus this type, in every version.'), textOf(rename));
        assert.ok(textOf(rename).includes(`Rename '${label}'`), textOf(rename));
        // no New version (user, 23 Nov 2026: a new version comes as a plan from ZwiftGopher or a file,
        // stored from its Store form; the upload page keeps taking `plan=` for links already handed out);
        // Delete asks first in its place
        assert.equal(pm.includes('/manage/upload'), false, pm);
        assert.equal(textOf(pm).includes('New version'), false, textOf(pm));
        const del = armOf(pm, '/manage/sheet/delete');
        assert.ok(armHas(del, '/manage/sheet/delete', `<input type="hidden" name="team" value="rollers"><input type="hidden" name="sheet" value="${id}"><input type="hidden" name="version" value="${version}">`,
            'btn danger small', `Delete &#39;${label}&#39;`), del);
        // no Make live in the menu, nor in the block (no newer version waits): every version's panel has it
        assert.equal(pm.includes('action="/manage/live"'), false, id);
        assert.equal(row.includes('action="/manage/live"'), false, `${id} ${live}`);
    }
    assert.ok(element(await pageBody(srv, `/manage/team/rollers?v=${ids.sun002}`), '<div id="panel-acts"').includes('action="/manage/live"'), 'Make live in the panel');
});


test('team settings: no event links card', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z'), pinned: 4567890});
    const srv = await serve(t, c);
    const body = await pageBody(srv, '/manage/team/rollers/settings');
    assert.ok(!body.includes('id="link-h"'), body);
    assert.ok(!body.includes('/manage/sheet/unpin'), body);
    assert.ok(!textOf(body).includes('Event links'), textOf(body));
});


test('menu: an open one holds the reload, the panel opens in the page flow, its controls 44 px', () => {
    // no data-keep-refresh: a menu holds forms
    const html = menu('Options', ['<p>x</p>'], {key: 'k'});
    assert.ok(html.startsWith('<details class="menu" data-menu id="menu-k"><summary class="btn quiet small" aria-label="Options">'), html);
    assert.ok(!html.includes('data-keep-refresh'), html);
    assert.equal(menu('Options', [], {key: 'k'}), '');
    assert.equal(menu('Options', ['', null], {key: 'k'}), '');
    // the panel is in the flow (it pushes the next rows down, never lies over them); the ⋯ button
    // keeps its corner
    const panel = /\.menu-panel\{([^}]*)\}/.exec(APP_CSS)?.[1] ?? '';
    assert.ok(panel && !/position:(absolute|fixed)/.test(panel) && !/z-index/.test(panel), panel);
    assert.match(APP_CSS, /\.menu>summary\{[^}]*position:absolute;top:0;right:0;min-width:var\(--tap\)/);
    assert.match(APP_CSS, /\.racehead,\.rowtop\{position:relative;min-height:var\(--tap\)/);
});


test('club hub: a weekly team without a start time has one "No start time" item, not one per race', async t => {
    const c = makeClub({teams: [['Rollers', '19:30'], ['Cogs', null]]});
    upload(c.club, 'cogs', {riders: ['1009'], at: T('2026-11-19T12:00:00Z'), date: '2026-11-26'});
    upload(c.club, 'cogs', {type: 'sunday', riders: ['1008'], at: T('2026-11-19T12:10:00Z'), date: '2026-11-29'});
    const srv = await serve(t, c, {now: FRI});
    assert.equal(teamViewRaces(srv.store.get(CID), 'cogs'), 2, 'two races ahead, neither with a time');
    const items = hubLines(await srv.body(), 'todo-h').filter(l => l.team === 'Cogs');
    assert.deepEqual(items.map(l => [l.sev, l.what]), [['err', 'No start time: riders on this plan get nothing']]);
    assert.ok(items[0].acts.includes('href="/manage/team/cogs/settings"'), items[0].acts);
});


test('the Store form asks for a type only for a new plan', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS.slice(0, 7), at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const id = await intake(srv, c.cookie, {team: 'rollers', forPlan: live, json: planJson('Rollers other', ROLLERS)});
    const page = async query => element(await storeFormOf(srv, id, query), '<div class="cp-form"');
    const asPlan = await page(`?team=rollers&as=${live}&drawn=rollers%3A${live}`);
    assert.ok(!asPlan.includes('name="type"') && !asPlan.includes('<datalist'), asPlan);
    assert.ok(!asPlan.includes('name="live"'), 'no Make live box (user, 23 Nov 2026): the bar has Make live');
    const asNew = await page('?team=rollers&as=new&drawn=rollers%3Anew');
    assert.equal(count(asNew, '<input name="type" maxlength="30"'), 1, asNew);
    assert.ok(asNew.includes('<datalist id="types"><option value="fast"></datalist>'), asNew);
});


test('a plan without a type reads "Plan" on the team page: its head, its card, the captions, Store as (user, 23 Nov 2026)', async t => {
    const c = makeClub();
    const plain = upload(c.club, 'rollers', {riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const fast = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS.slice(0, 6), at: T('2026-11-19T14:10:00Z'), live: false});
    const srv = await serve(t, c);
    const body = await teamBody(srv, 'rollers');
    // its head in the list: the visible name, so its ⋯ stands beside a name
    const block = elements(body, '<section class="cp-plan').find(b => b.includes(`?r=${DATE}#panel`));
    assert.ok(block.includes('<h3 class="cp-plan-head" id="plan-h-') && block.includes('"><span class="label">Plan</span></h3>'), block);
    assert.equal(block.includes('Plan without a type'), false);
    // the card: "Riders on 'Plan' v1"; another plan's card is held against "'Plan' v1"
    assert.ok(textOf(element(body, '<div id="panel"')).includes('Riders on \'Plan\' v1'), textOf(element(body, '<div id="panel"')));
    const other = await pageBody(srv, `/manage/team/rollers?v=${fast}`);
    assert.ok(element(other, '<div id="panel"').includes('Against live &#39;Plan&#39; v1'), element(other, '<div id="panel"'));
    // a version of it not live: "'Plan' v1 · stored …"
    srv.store.change(CID, cl => setLive(cl, 'rollers', fast));
    const picked = await pageBody(srv, `/manage/team/rollers?v=${plain}`);
    assert.ok(textOf(element(picked, '<h2 class="cp-title"')).trim().startsWith('\'Plan\' v1 · stored'), textOf(element(picked, '<h2 class="cp-title"')));
    // Store as: "New version of 'Rollers · Plan'"; nothing stored changes (its label stays the team's name)
    const id = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers', ROLLERS)});
    const form = element(await storeFormOf(srv, id), '<div class="cp-form"');
    assert.ok(textOf(form).includes('New version of \'Rollers · Plan\''), textOf(form));
    assert.equal(srv.store.get(CID).sheets[plain].label, 'Rollers');
    assert.equal(srv.store.get(CID).sheets[plain].type ?? null, null);
});


test('a new plan\'s type is prefilled from the plan\'s name, without the team\'s name (user, 23 Nov 2026)', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    const typeOf = async name => {
        const id = await intake(srv, c.cookie, {team: 'rollers', json: planJson(name, ROLLERS)});
        const body = await storeFormOf(srv, id, '?team=rollers&as=new&drawn=rollers:');
        return /<input name="type" maxlength="30" value="([^"]*)"/.exec(body)?.[1] ?? null;
    };
    assert.equal(await typeOf('Rollers slow'), 'slow');
    assert.equal(await typeOf('rollers · Tempo'), 'Tempo');
    assert.equal(await typeOf('Rollers'), '');
});


// The settings pages in the wide frame from 1180 px (user, 23 Nov 2026): the team page's width and
// left edge, their cards flowing into as many columns as fit (CSS columns, the page's order down each
// column, a card never split), the danger zone last at the whole width; phones and 1024–1180 px one
// column as before (the columns' box gives its cards to the page there).
test('club and team settings: the cards flow into columns from 1180 px, the danger zone last; the wide frame', async t => {
    const c = makeClub();
    const srv = await serve(t, c);
    const ids = html => [...html.matchAll(/<section class="(?:card|danger-zone)[^"]*" aria-labelledby="([^"]+)"/g)].map(m => m[1]);
    const club = await pageBody(srv, '/manage/settings');
    assert.match(club, /<main class="page settings" id="main">/);
    const cols = element(club, '<div class="setcols">');
    // (the audit's order, user 23 Nov 2026: no "Who gets your plans" while private clubs are off)
    assert.deepEqual(ids(cols), ['club-h', 'sign-h', 'rec-h', 'act-h', 'rm-h']);
    assert.ok(cols.includes('<h2 class="band">Records</h2>') || /<h2 class="band">[^<]+<\/h2>\s*<section class="card" aria-labelledby="rec-h"/.test(cols), cols.slice(0, 300));
    // the order of the page unchanged; the danger zone after the columns
    assert.deepEqual(ids(club), ['club-h', 'sign-h', 'rec-h', 'act-h', 'rm-h', 'dz']);
    assert.ok(club.indexOf('<section class="danger-zone"') > club.indexOf(cols) + cols.length - 1);
    // the team settings: the name, the race day and time, the ZwiftGopher link when there is one
    const team = await pageBody(srv, '/manage/team/rollers/settings');
    assert.match(team, /<main class="page settings" id="main">/);
    assert.deepEqual(ids(element(team, '<div class="setcols">')), ['name-h', 'rhythm-h']);
    assert.deepEqual(ids(team), ['name-h', 'rhythm-h', 'del-h']);
    const pushed = await serve(t, makeClub(), {env: {PUBLIC_URL: 'https://paceline.example.org'}});
    // the ZwiftGopher link at the end, beside the danger zone (the audit, user 23 Nov 2026)
    const withPush = await pageBody(pushed, '/manage/team/rollers/settings');
    assert.deepEqual([ids(element(withPush, '<div class="setcols">')), ids(element(withPush, '<div class="setend">'))], [['name-h', 'rhythm-h'], ['push-h', 'del-h']]);
    // the stylesheet: one column until 1180 px, then the team page's width and the flow
    assert.ok(APP_CSS.includes('.setcols,.setend{display:contents}'));
    const wide = APP_CSS.slice(APP_CSS.indexOf('@media (min-width:1180px)'));
    for (const rule of ['.app>.page.settings{max-width:67rem}', '.setcols{display:block;columns:24rem;column-gap:1.5rem}',
        '.setcols>*{break-inside:avoid;margin:0 0 1rem}', '.setcols>.band{break-after:avoid;margin-top:0}']) {
        assert.ok(wide.includes(rule), rule);
    }
    assert.ok(APP_CSS.includes('.app>.page.wide{max-width:67rem}'), 'the team page\'s width');
});


test('the settings pages on a computer at the wide pages\' scale: 15 px buttons, labels and card text, inputs as high as the buttons (user, 23 Nov 2026)', () => {
    const at = APP_CSS.indexOf('@media (min-width:1024px)');
    const desk = APP_CSS.slice(at, APP_CSS.indexOf('\n}', at));
    for (const rule of [
        '.page.settings .btn:not(.small){min-height:var(--tap);padding:.5rem .875rem;font-size:.9375rem}',
        '.page.settings :is(.card,.danger-zone,label.field){font-size:.9375rem}',
        '.page.settings input:not([type=checkbox],[type=radio],[type=hidden],[type=file]),.page.settings select{min-height:var(--tap);padding:.5rem .75rem;font-size:.9375rem}',
    ]) {
        assert.ok(desk.includes(rule), rule);
    }
    // phones: none of it (inputs keep 17 px, so iOS does not zoom)
    assert.equal(APP_CSS.slice(0, at).includes('.page.settings'), false);
});


// The settings audit (user, 23 Nov 2026).
test('team settings audit: the team\'s name as the title, "Team settings" above it; one-line hints; the ZwiftGopher link beside the danger zone', async t => {
    const srv = await serve(t, makeClub(), {env: {PUBLIC_URL: 'https://paceline.example.org'}});
    const body = await pageBody(srv, '/manage/team/rollers/settings');
    // 1. the title is the team; the kicker says the page, also from 1024 px (the breadcrumb hides the others)
    assert.ok(body.includes('<header class="pagehead"><p class="kicker keep">Team settings</p><h1>Rollers</h1></header>'), element(body, '<header class="pagehead"'));
    assert.ok(APP_CSS.includes('.app .crumbs~.pagehead .kicker.keep{display:flex}'));
    // 2. the name field has no visible label (the card's heading says it), screen readers hear it
    const nameCard = element(body, '<section class="card" aria-labelledby="name-h"');
    assert.ok(nameCard.includes('<label class="field"><span class="sr">Team name</span><input name="name"'), nameCard);
    // 3. the start time's hint: race times are the race's own
    assert.ok(textOf(element(body, '<section class="card" aria-labelledby="rhythm-h"')).includes('In Europe/Berlin. New races start at this time.'));
    assert.equal(body.includes('a race with a time of its own keeps it'), false);
    // 4. the ZwiftGopher link: its one-line hint, the rest in a closed fold; with the danger zone at the end
    const push = element(body, '<section class="card" aria-labelledby="push-h"');
    assert.ok(push.includes('<p class="hint">Stops all links given out; their plans are refused.</p>'), push);
    assert.match(push, /<details class="fold more"><summary>More<span class="sr"> about the ZwiftGopher link<\/span><\/summary><p class="hint">[^<]+<\/p><\/details>/);
    const end = element(body, '<div class="setend">');
    assert.ok(end && end.indexOf('aria-labelledby="push-h"') < end.indexOf('<section class="danger-zone"'), end);
    assert.equal(element(body, '<div class="setcols">').includes('push-h'), false);
    // 9. every hint of the page fits one line: at most 70 characters
    for (const hint of [...body.matchAll(/<p class="hint">([^<]*)<\/p>/g)].map(m => m[1]).filter(h => !/^<|More/.test(h))) {
        const inFold = new RegExp(`<details class="fold more">[^]*?${hint.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(body);
        assert.ok(inFold || hint.length <= 70, hint);
    }
});


test('club settings audit: common zones first, who gets the plans only when it can change, Remove a rider after the records, one-line hints', async t => {
    const c = makeClub();
    const srv = await serve(t, c);                          // no CODE_SECRET: private clubs are off
    const body = await pageBody(srv, '/manage/settings');
    // 5. the zones: "Common" first, then all; the club's zone selected once, where it first stands
    const sel = element(body, '<select name="tz" required>');
    assert.ok(sel.startsWith('<select name="tz" required><optgroup label="Common"><option value="Europe/London">Europe/London</option>'), sel.slice(0, 200));
    const common = element(sel, '<optgroup label="Common">');
    assert.deepEqual([...common.matchAll(/value="([^"]+)"/g)].map(m => m[1]), ['Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin', 'Europe/Amsterdam',
        'Europe/Madrid', 'Europe/Helsinki', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Australia/Sydney', 'Asia/Tokyo', 'UTC']);
    assert.ok(element(sel, '<optgroup label="All zones">').includes('<option value="Asia/Calcutta">'), 'the full list follows');
    assert.equal(count(sel, ' selected'), 1);
    assert.ok(common.includes('<option value="Europe/Berlin" selected>'), common);
    // 6. private clubs off on this server and the club open: no "Who gets your plans"
    assert.equal(body.includes('id="who-h"'), false);
    // 8. the order: Club, Sign-in, the records, Remove a rider, the danger zone
    const ids = [...body.matchAll(/<section class="(?:card|danger-zone)[^"]*" aria-labelledby="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(ids, ['club-h', 'sign-h', 'rec-h', 'act-h', 'rm-h', 'dz']);
    // 7. Remove a rider: a one-line hint, the whole explanation in a closed fold
    const rider = element(body, '<section class="card" aria-labelledby="rm-h"');
    assert.ok(rider.includes('<p class="hint">For a rider&#39;s deletion request (GDPR).</p><details class="fold more"><summary>More<span class="sr"> about Remove a rider</span></summary>'), rider);
    assert.ok(textOf(element(rider, '<details class="fold more">')).includes('out of every recording of the club'), 'nothing of it dropped');
    // 9. a new club link signs other phones out: said, in its fold
    const sign = element(body, '<section class="card" aria-labelledby="sign-h"');
    assert.ok(sign.includes('<p class="hint">For a new phone, or if the link leaked.</p>'), sign);
    assert.ok(textOf(sign).includes('other phones are signed out'), textOf(sign));
    for (const hint of [...body.matchAll(/<p class="hint">([^<]*)<\/p>/g)].map(m => m[1])) {
        const folded = body.includes(`<details class="fold more"><summary>`) && new RegExp(`<details class="fold more">(?:(?!</details>)[^])*?<p class="hint">${hint.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(body);
        assert.ok(folded || hint.length <= 70, hint);
    }
    // with private clubs on, the card is there, after Club
    const on = await serve(t, makeClub(), {env: {CODE_SECRET}});
    const onBody = await pageBody(on, '/manage/settings');
    assert.deepEqual([...onBody.matchAll(/<section class="(?:card|danger-zone)[^"]*" aria-labelledby="([^"]+)"/g)].map(m => m[1]),
        ['club-h', 'who-h', 'sign-h', 'rec-h', 'act-h', 'rm-h', 'dz']);
    // the fold's summary is a 44 px target
    assert.ok(APP_CSS.includes('.fold.more>summary{min-height:var(--tap);'), 'the More fold');
});
