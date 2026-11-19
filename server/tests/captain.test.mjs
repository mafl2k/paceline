// The captain pages (plan 3b): the team page /manage/team/<slug> (Task 5) with its switcher and
// sidebar, status, "N to fix", the live plan and its "…" menu, riders and bench, the other plans,
// and the team actions answering 303 to it; the versions page and Back to vN (plan versions Task 4);
// the team settings, the new-team page and the
// live-confirm page (Task 6), and the team actions answering their own pages; the club settings, the
// rider-code pages and the club actions answering them (Task 7); the team picker /manage, its first
// run, the DST banner and the signed-out page (Task 8).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {planJson, T, CODE_SECRET, rows} from './helpers.mjs';
import {
    CID, DATE, NOW, ROLLERS, makeClub, secondClub, upload, serve, textOf, count, flashOf, post, followPost, storeOk, VERSION_OF,
    storedClub, intake, storeUpload, CLUB_FIELD,
} from './manage-helpers.mjs';
import {setRiderCode, uploadSheet, MAX_VERSIONS, ClubError} from '../club.mjs';
import {T as COPY} from '../pages.mjs';
import {ic} from '../icons.mjs';
import {APP_CSS} from '../app-css.mjs';
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


// The whole element that starts at the first match of `open` (e.g. '<details class="more">'),
// nested elements of the same tag included; null without one.
function element(html, open, from = 0) {
    const start = html.indexOf(open, from);
    if (start < 0) {
        return null;
    }
    const tag = /^<([a-z0-9]+)/.exec(open)[1];
    const re = new RegExp(`<${tag}[\\s>]|</${tag}>`, 'g');
    re.lastIndex = start + 1;
    let depth = 1;
    for (let m = re.exec(html); m; m = re.exec(html)) {
        depth += m[0].startsWith('</') ? -1 : 1;
        if (depth === 0) {
            return html.slice(start, m.index + m[0].length);
        }
    }
    return null;
}

// Every element that starts with `open`.
function elements(html, open) {
    const out = [];
    for (let at = html.indexOf(open); at >= 0; at = html.indexOf(open, at + 1)) {
        out.push(element(html, open, at));
    }
    return out;
}


// The rider rows as {sev, name, text, time}: sev 'plan' before the gate.
function riderRows(html) {
    return [...html.matchAll(/<li class="rider (\w+)">([\s\S]*?)<\/li>/g)].map(([, sev, inner]) => ({
        sev, name: textOf(/<span class="nm">([^<]*)<\/span>/.exec(inner)[1]),
        text: textOf(inner).trim(), time: /<time>([^<]*)<\/time>/.exec(inner)?.[1] ?? null,
    }));
}


test('team page: the planner\'s roster is not listed, before the gate or after it', async t => {
    // Jo is only in the planner's roster (the club's rider pool)
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, bench: ['1009'], at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c, {now: T('2026-11-19T17:55:00Z')});
    for (const at of ['2026-11-19T17:55:00Z', '2026-11-19T18:10:00Z']) {
        srv.clock.now = T(at);
        const body = await teamBody(srv, 'rollers');
        const card = element(body, '<section class="card riders-card"');
        assert.equal(riderRows(card).length, 8, at);
        assert.ok(!riderRows(card).some(r => r.name === 'Jo'), at);
        assert.ok(!/bench/i.test(textOf(body)), `${at}: ${textOf(body)}`);
        assert.ok(!body.includes('class="riders bench"'), at);
    }
});


test('team page: before the gate', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    c.club.sheets[live].eventId = 4567001;
    const sig = c.club.sheets[live].sig;
    const srv = await serve(t, c, {now: T('2026-11-19T17:55:00Z')});
    const body = await teamBody(srv, 'rollers');
    const text = textOf(body);
    const summary = /<summary>([\s\S]*?)<\/summary>/.exec(body)[1];
    assert.ok(summary.includes('<h1>Rollers</h1>'), summary);
    // the race line says when riders get the plan: no status card repeats it (Task 8c)
    assert.equal(textOf(/<p class="race">([\s\S]*?)<\/p>/.exec(body)[1]).trim(), 'Thu 19 Nov · 19:30 · in 35 min · opens 19:00');
    assert.ok(text.includes('Updated 18:55'), text);
    assert.ok(!/class="sevline [a-z]+ big"/.test(body), 'no status card');
    assert.equal(count(body, '<li class="rider plan">'), 8);
    assert.ok(!/class="rider (ok|warn|err|neutral)/.test(body), 'no rider state before the gate');
    assert.deepEqual(riderRows(body).map(r => r.text.split(' ')[0]), ['1', '2', '3', '4', '5', '6', '7', '8']);
    assert.ok(text.includes('Riders on \'Rollers · fast\' 8 riders'), text);
    assert.ok(body.includes('<p class="hint">In ride order. Who has the plan shows from <time>19:00</time>, when riders get it.</p>'));
    assert.ok(text.includes(`Plan code ${sig}`));
    assert.ok(text.includes('Live Rollers · fast v1 · 15:00'), text);
    // a first version: no change line, no Back
    assert.ok(!body.includes('action="/manage/plan/back"'));
    assert.ok(!text.includes('What changed'));
    assert.ok(text.includes(`Plan code ${sig} 8 riders Event 4567001`), 'a learned event, not a link');
    assert.ok(!text.includes('(yours)'));
    // Upload a plan: a plain link, no fixed bar (Task 8c)
    assert.match(body, /<a class="uplink" href="\/manage\/upload\?team=rollers">[\s\S]*?Upload a plan<\/a>/);
    assert.ok(!body.includes('actionbar'));
    assert.match(body, /<body class="teampage"/);
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
        assert.ok(head.indexOf('class="teamhead"') < head.indexOf('<p class="race">'), 'above the race line');
        assert.ok(!body.includes('rowlink'), 'no settings card');
    }
    // no start time: the callout has its own way to the settings
    const cogs = await teamBody(srv, 'cogs');
    const callout = element(cogs, '<section class="callout err"');
    assert.match(callout, /<a class="btn secondary small" href="\/manage\/team\/cogs\/settings">[\s\S]*?Set the start time<\/a>/);
    // nothing else in the right-hand columns: the upload link is the empty card's button
    assert.ok(cogs.includes('<div class="col-b"></div>'));
    assert.ok(cogs.includes('<div class="col-c"></div>'));
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
    assert.equal(count(before, '<li class="rider plan">'), 8);
    assert.ok(!before.includes('class="rider ok'), 'no state 1 ms before the gate');
    assert.ok(textOf(before).includes('Thu 29 Oct · 19:30 · in 31 min · opens 19:00'), textOf(before));
    assert.ok(textOf(before).includes('Riders on \'Rollers · fast\' 8 riders'));
    assert.ok(textOf(before).includes(DST));

    srv.clock.now = T('2026-10-29T18:00:00Z');
    const after = await teamBody(srv, 'rollers');
    const rows = riderRows(after);
    assert.equal(count(after, '<li class="rider plan">'), 0);
    assert.deepEqual(rows.map(r => r.sev), ['neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'neutral', 'ok']);
    assert.equal(rows.at(-1).text, 'Ben Has the plan');
    const text = textOf(after);
    assert.ok(text.includes('1 of 8 riders have the plan'), text);
    // after the gate: open since (fix round 1)
    assert.ok(text.includes('Thu 29 Oct · 19:30 · in 30 min · open since 19:00'), text);
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
    assert.match(body, /<p class="count"><strong>5 of 8<\/strong> have the plan<\/p>/);
    const rows = riderRows(body);
    // one row per rider, worst first, then ride order
    assert.deepEqual(rows.map(r => r.name), ['Dan', 'Cleo', 'Eva', 'Ben', 'Finn', 'Gus', 'Hanna', 'Ida']);
    const row = name => rows.find(r => r.name === name);
    assert.deepEqual(row('Ben'), {sev: 'ok', name: 'Ben', text: 'Ben Has the plan · in the event', time: null});
    assert.deepEqual(row('Cleo'), {sev: 'neutral', name: 'Cleo', text: 'Cleo Not seen yet', time: null});
    assert.deepEqual(row('Dan'), {sev: 'warn', name: 'Dan', text: 'Dan Has an older plan (code ABC123) 17:10', time: '17:10'});
    // a 0.2 check (mod "0.2", from before the hard cut) is a plain check: no "old Paceline" mark
    assert.deepEqual(row('Eva'), {sev: 'neutral', name: 'Eva', text: 'Eva Checked 18:00 · not in the event yet', time: null});
    assert.deepEqual(row('Finn'), {sev: 'ok', name: 'Finn', text: 'Finn Has the plan', time: null});
    assert.ok(text.includes('What do these mean?'));
    // the live row: the event link; its unpin form is on the plan page now (Task 8c)
    const live1 = element(body, '<li class="planrow live">');
    assert.ok(textOf(live1).includes('Event link 4567890 (yours)'), textOf(live1));
    assert.ok(!body.includes('<details class="more">'));
    const plan = await (await srv.get(`/manage/team/rollers/plan/${live}`)).text();
    const unpin = /<form method="post" action="\/manage\/sheet\/unpin">[\s\S]*?<\/form>/.exec(plan)[0];
    assert.ok(unpin.includes(`<input type="hidden" name="team" value="rollers"><input type="hidden" name="sheet" value="${live}"><input type="hidden" name="back" value="plan">`), unpin);
    assert.ok(textOf(unpin).includes('Remove event link (4567890)'));
    // no Undo card any more (plan versions §8)
    assert.ok(!body.includes('undocard'), 'no undo card');
    assert.ok(!body.includes('/manage/undo'));
    assert.ok(!text.includes('Last change'));
    // a team without a start time
    assert.ok(textOf(await teamBody(srv, 'cranks')).includes('No start time and no plan'));
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
    assert.match(hole, new RegExp(`<a class="btn secondary small" href="/manage/upload\\?team=rollers&amp;plan=${live}">[\\s\\S]*?Upload without Ben</a>`));
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
    assert.ok(!body.includes('class="rider warn"'), 'no warning on Rollers\' page');
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
    // no status card (Task 8c): the empty card says it; the switcher keeps the red line
    assert.ok(!/class="sevline [a-z]+ big"/.test(body), body);
    assert.match(body, /<span class="sw-icon err">/);
    assert.ok(text.includes('No plan for Sprockets yet'));
    assert.ok(text.includes('Export the team\'s plan from the planner (JSON, which has the pull watts as pull power; else add the text export for them) and upload it here.'), text);
    assert.ok(body.includes('Riders get it from <time>19:10</time>, 30 min before the start.'));
    assert.match(body, /<a class="btn primary block" href="\/manage\/upload\?team=sprockets">[\s\S]*?Upload a plan<\/a>/);
    assert.ok(!body.includes('class="actionbar"'));
    assert.ok(!body.includes('class="uplink"'), 'the empty card has the button');
    assert.match(body, /<body class="teampage"/);
    assert.ok(!body.includes('class="card plans-card"'));
    assert.ok(!body.includes('riders-card'));
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
    assert.ok(textOf(body).includes('Riders get nothing: no start time'));
    assert.ok(textOf(body).includes('Rider status shows once the team has a start time and the plan opens, 30 min before the start.'));
    assert.equal(count(body, '<li class="rider plan">'), 2);
    // without a plan either
    const none = makeClub({teams: [['Cogs', null]]});
    const srv2 = await serve(t, none, {now: T('2026-11-19T17:12:00Z')});
    const empty = await teamBody(srv2, 'cogs', none.cookie);
    const emptyText = textOf(empty);
    assert.ok(emptyText.includes('No start time and no plan Paceline sends a plan only for a start time. Without one, no plan goes out.'), emptyText);
    assert.ok(emptyText.includes('Riders get it once the team has a start time.'));
});


test('team page: plan rows of this race only; raced plans are not listed', async t => {
    // ported from Task 8's "other plans" test (Task 8c): one row per plan in a fixed order, no "…" menu
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z'), pinned: 4567890});
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ['1001', '1002', '1003'], at: T('2026-11-19T14:10:00Z'), live: false});
    const slow2 = version(c.club, 'rollers', slow, ['1001', '1002', '1003', '1004'], '2026-11-19T14:15:00Z', {live: false});
    const spare = upload(c.club, 'rollers', {type: 'spare', riders: ['1004'], at: T('2026-11-19T14:20:00Z'), live: false});
    const raced = upload(c.club, 'rollers', {type: 'last week', riders: ROLLERS, at: T('2026-11-12T10:00:00Z'), live: false, date: '2026-11-12'});
    upload(c.club, 'sprockets', {riders: ['1001', '1009'], at: T('2026-11-19T16:30:00Z')});
    const srv = await serve(t, c);
    const body = await teamBody(srv, 'rollers');
    const plans = element(body, '<section class="card plans-card"');
    assert.ok(plans, body);
    assert.ok(textOf(plans).startsWith(' Plans for Thu 19 Nov 3 '), textOf(plans));
    const rows = planRows(plans);
    // the first stored first, not the newest
    assert.deepEqual(rows.map(rowLabel), ['Rollers · fast', 'Rollers · slow', 'Rollers · spare']);
    const [, slowRow, spareRow] = rows;
    // raced: not listed anywhere on the page
    assert.ok(!body.includes('Rollers · last week'), 'last week\'s plan is not listed');
    assert.ok(!textOf(body).includes('Raced. Kept for the record.'));
    assert.ok(!body.includes(`value="${raced}"`));
    assert.ok(!body.includes('<details class="more">'), 'no "…" menu');

    // each plan by its newest version: label and version link to the plan page
    const headOf = row => textOf(/<h3 class="l1">([\s\S]*?)<\/h3>/.exec(row)[1]).trim();
    assert.equal(headOf(slowRow), 'Rollers · slow v2 · 15:15');
    assert.ok(slowRow.includes(`<a class="planlink" href="/manage/team/rollers/plan/${slow}">`), slowRow);
    assert.ok(textOf(slowRow).includes('Outdated: Ben now rides Sprockets'));
    assert.equal(textOf(/<p class="meta">([\s\S]*?)<\/p>/.exec(slowRow)[1]), '4 riders: Ben, Cleo, Dan …');
    const ask = element(slowRow, '<details class="confirm inline">');
    assert.ok(ask, slowRow);
    assert.ok(textOf(ask).includes('Riders get \'Rollers · slow\' v2 at once instead of \'Rollers · fast\' v1. \'Rollers · slow\' still lists Ben, who now rides another team. Make it live anyway?'), textOf(ask));
    assert.ok(ask.includes(`<form method="post" action="/manage/live">${CLUB_FIELD}<input type="hidden" name="team" value="rollers"><input type="hidden" name="sheet" value="${slow2}"><input type="hidden" name="confirm" value="1"><button class="btn primary small" type="submit">Make live anyway</button></form>`), ask);
    // not outdated: it still asks, with a plain Make live
    assert.equal(headOf(spareRow), 'Rollers · spare v1 · 15:20');
    assert.ok(!spareRow.includes('Outdated'));
    assert.equal(textOf(/<p class="meta">([\s\S]*?)<\/p>/.exec(spareRow)[1]), '1 rider: Eva');
    assert.ok(spareRow.includes(`<form method="post" action="/manage/live">${CLUB_FIELD}<input type="hidden" name="team" value="rollers"><input type="hidden" name="sheet" value="${spare}"><input type="hidden" name="confirm" value="1"><button class="btn primary small" type="submit">Make live</button></form>`), spareRow);
    // the hole note's upload link leaves the plan out: the race has three
    const holeNote = element(body, '<li class="note warn">');
    assert.ok(holeNote, body);
    assert.ok(holeNote.includes('<a class="btn secondary small" href="/manage/upload?team=rollers">'), holeNote);
    assert.ok(!holeNote.includes('&amp;plan='), holeNote);

    // a plan for another race: the heading says no day, the row says its race
    const d = makeClub();
    upload(d.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const next = upload(d.club, 'rollers', {type: 'next', riders: ['1009'], at: T('2026-11-19T14:30:00Z'), live: false, date: '2026-11-26'});
    const srv2 = await serve(t, d);
    const nextBody = await teamBody(srv2, 'rollers', d.cookie);
    const other = element(nextBody, '<section class="card plans-card"');
    assert.ok(textOf(other).startsWith(' Plans 2 '), textOf(other));
    assert.equal(headOf(planRows(other)[1]), 'Rollers · next Race Thu 26 Nov · v1 · 15:30');
    assert.equal(headOf(planRows(other)[0]), 'Live Rollers · fast v1 · 15:00');
    assert.ok(nextBody.includes(`href="/manage/team/rollers/plan/${next}"`));
});


// The live row of a team page.
const liveCard = body => element(body, '<li class="planrow live">');


test('team page: the live row shows the version, what changed and Back', async t => {
    const c = makeClub();
    const v1 = upload(c.club, 'rollers', {type: 'fast', riders: ['1001', ...ROLLERS.slice(2)], at: T('2026-11-19T14:00:00Z')});
    version(c.club, 'rollers', v1, ROLLERS.slice(1), '2026-11-19T15:00:00Z');
    const srv = await serve(t, c);
    const body = await teamBody(srv, 'rollers');
    const card = liveCard(body);
    assert.ok(card, body);
    const text = textOf(card);
    assert.ok(text.includes('Live Rollers · fast v2 · 16:00'), text);
    assert.ok(text.includes('Cleo in, Ben out'), text);
    const ver = VERSION_OF(srv, 'rollers');
    // Back of the live plan always asks first, in the page (Task 8c)
    const confirm = element(card, '<details class="confirm inline">');
    assert.ok(confirm, card);
    assert.ok(textOf(confirm).includes('Back to v1 · live at once… Riders get v1 at once instead of v2.'), textOf(confirm));
    assert.ok(confirm.includes(`<form method="post" action="/manage/plan/back">${CLUB_FIELD}<input type="hidden" name="team" value="rollers"><input type="hidden" name="plan" value="${v1}">`
        + `<input type="hidden" name="n" value="1"><input type="hidden" name="version" value="${ver}"><input type="hidden" name="confirm" value="1"><button class="btn primary small" type="submit">Back to v1</button></form>`), confirm);
    assert.ok(!card.includes('name="back"'), 'Back from the team page comes back here');
    // no "What changed" fold, no "…" menu, no fixed bar: those are on the plan page
    assert.ok(!card.includes('<details class="fold">'), card);
    assert.ok(!textOf(body).includes('What changed'));
    assert.ok(!body.includes('actionbar'));
    assert.ok(!textOf(body).includes('Upload a new plan'));
    assert.ok(!text.includes('Versions (2)'), text);

    // Back: v3 is live at once, and the row offers Back to v2
    const back = await followPost(srv, c.cookie, '/manage/plan/back', {team: 'rollers', plan: v1, n: '1', version: String(ver), confirm: '1'});
    assert.equal(back.location, '/manage/team/rollers');
    assert.deepEqual(back.flash, {kind: 'ok', text: 'Back to v1: \'Rollers · fast\' v3 is live (was v2).'});
    const after = textOf(liveCard(back.page));
    // the copy reads as made at the Back (19:25), like the versions page; uploadedAt stays v1's
    assert.ok(after.includes('Live Rollers · fast v3 · 19:25'), after);
    const club = srv.store.get(CID);
    assert.equal(club.sheets[club.teams.rollers.live].uploadedAt, club.sheets[v1].uploadedAt);
    const vp = await (await srv.get(`/manage/team/rollers/plan/${v1}`)).text();
    assert.ok(metaOf(versionRows(vp)[0]).startsWith('v3 · 19:25 · LIVE · back to v1'), metaOf(versionRows(vp)[0]));
    assert.ok(after.includes('Back to v1: Ben in, Cleo out'), after);
    assert.ok(after.includes('Back to v2 · live at once'), after);

    // a Back that leaves a hole says so too
    const d = makeClub();
    const d1 = upload(d.club, 'rollers', {type: 'fast', riders: ['1001', ...ROLLERS.slice(2)], at: T('2026-11-19T14:00:00Z')});
    version(d.club, 'rollers', d1, ROLLERS.slice(1), '2026-11-19T15:00:00Z');
    upload(d.club, 'sprockets', {riders: ['1001', '1009'], at: T('2026-11-19T16:30:00Z')});
    const srv2 = await serve(t, d);
    const card2 = liveCard(await teamBody(srv2, 'rollers', d.cookie));
    const confirm2 = element(card2, '<details class="confirm inline">');
    assert.ok(confirm2, card2);
    assert.ok(textOf(confirm2).includes('Back to v1 · live at once… Riders get v1 at once instead of v2. v1 lists Ben, who now rides Sprockets. Rollers then rides without him. Back to v1 anyway?'), textOf(confirm2));
    assert.ok(confirm2.includes(`<input type="hidden" name="n" value="1"><input type="hidden" name="version" value="${VERSION_OF(srv2, 'rollers')}"><input type="hidden" name="confirm" value="1"><button class="btn primary small" type="submit">Back to v1 anyway</button>`), confirm2);
    assert.equal(count(card2, 'action="/manage/plan/back"'), 1);
});


test('team page: newer, not live', async t => {
    const c = makeClub();
    const v1 = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    version(c.club, 'rollers', v1, ROLLERS.slice(1), '2026-11-19T15:00:00Z');
    const v3 = version(c.club, 'rollers', v1, ROLLERS.slice(2), '2026-11-19T16:00:00Z', {live: false});
    const srv = await serve(t, c);
    const body = await teamBody(srv, 'rollers');
    assert.ok(textOf(liveCard(body)).includes('Live Rollers · fast v2 · 16:00'));
    const newer = element(body, '<div class="newer">');
    assert.ok(newer, body);
    assert.ok(liveCard(body).includes('<div class="newer">'), 'in the live row');
    assert.ok(textOf(newer).includes('v3 · 17:00 is newer, not live'), textOf(newer));
    // it asks first (Task 8c)
    const ask0 = element(newer, '<details class="confirm inline">');
    assert.ok(textOf(ask0).includes('Make v3 live… Riders get \'Rollers · fast\' v3 at once instead of \'Rollers · fast\' v2.'), textOf(ask0));
    assert.ok(ask0.includes(`<form method="post" action="/manage/live">${CLUB_FIELD}<input type="hidden" name="team" value="rollers"><input type="hidden" name="sheet" value="${v3}"><input type="hidden" name="confirm" value="1"><button class="btn primary small" type="submit">Make live</button></form>`), ask0);
    assert.equal(planRows(body).length, 1, 'v3 is no other plan');
    // Make v3 live: the line goes
    const made = await followPost(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: v3, confirm: '1'});
    assert.equal(srv.store.get(CID).teams.rollers.live, v3);
    assert.ok(!made.page.includes('is newer, not live'));
    assert.ok(textOf(liveCard(made.page)).includes('Live Rollers · fast v3 · 17:00'));

    // a newer version that lists a rider who now rides Sprockets: the question says so
    const d = makeClub();
    const d1 = upload(d.club, 'rollers', {type: 'fast', riders: ROLLERS.slice(1), at: T('2026-11-19T14:00:00Z')});
    const d2 = version(d.club, 'rollers', d1, ROLLERS, '2026-11-19T16:00:00Z', {live: false});
    upload(d.club, 'sprockets', {riders: ['1001', '1009'], at: T('2026-11-19T16:30:00Z')});
    const srv2 = await serve(t, d);
    const newer2 = element(await teamBody(srv2, 'rollers', d.cookie), '<div class="newer">');
    assert.ok(textOf(newer2).includes('v2 · 17:00 is newer, not live'), textOf(newer2));
    const ask = element(newer2, '<details class="confirm inline">');
    assert.ok(ask, newer2);
    assert.ok(textOf(ask).includes('Make v2 live… Riders get \'Rollers · fast\' v2 at once instead of \'Rollers · fast\' v1. \'Rollers · fast\' still lists Ben, who now rides another team. Make it live anyway?'), textOf(ask));
    assert.ok(ask.includes(`<input type="hidden" name="sheet" value="${d2}"><input type="hidden" name="confirm" value="1"><button class="btn primary small" type="submit">Make live anyway</button>`), ask);
});


test('an upload left on the assign page shows nowhere', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    upload(c.club, 'sprockets', {riders: ['1001', '1009'], at: T('2026-11-19T16:30:00Z')});
    const srv = await serve(t, c);
    const pages = ['/manage', '/manage/team/rollers', '/manage/team/sprockets'];
    const before = [];
    for (const p of pages) {
        before.push(await pageBody(srv, p));
    }
    assert.ok(textOf(before[1]).includes('1 to fix'), 'Ben now rides Sprockets');
    const ids = [
        await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS.slice(1))}),
        await intake(srv, c.cookie, {team: 'sprockets', json: planJson('Sprockets', ['1009'])}),
    ];
    assert.equal(srv.store.get(CID).inbox.length, 2);
    for (const [i, p] of pages.entries()) {
        const after = await pageBody(srv, p);
        assert.ok(!after.includes('/manage/inbox/'), p);
        for (const id of ids) {
            assert.ok(!after.includes(id), p);
        }
        // the status lines and "N to fix" are those of before: the page is the same
        assert.equal(after, before[i], p);
    }
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
    const assign1 = await page(`/manage/inbox/${id1}`);
    clean(assign1, 'assign page');
    assert.ok(assign1.includes('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;&#39;'), assign1);
    const r1 = await post(srv, c.cookie, `/manage/inbox/${id1}`, {
        team: 'rollers', as: 'new', live: 'on', type: TYPE, date: DATE, base: String(VERSION_OF(srv, 'rollers')), drawn: 'rollers:new', touched: '', event: '',
    });
    assert.equal(r1.status, 200, r1.body);
    clean(r1.body, 'result page');
    assert.ok(r1.body.includes('&lt;b&gt;&#39;&quot;'), r1.body);
    const plan = srv.store.get(CID).teams.rollers.live;
    assert.equal(srv.store.get(CID).sheets[plan].type, TYPE);
    // a second version without Ben: the lines name him
    const id2 = await intake(srv, c.cookie, {team: 'rollers', forPlan: plan, json: planJson('Rollers fast', ROLLERS.slice(1))});
    const assign2 = await page(`/manage/inbox/${id2}`);
    clean(assign2, 'assign page, second version');
    assert.ok(assign2.includes('&lt;b&gt;&#39;&quot;'), assign2);
    assert.ok(assign2.includes('&lt;img'), assign2);
    const r2 = await post(srv, c.cookie, `/manage/inbox/${id2}`, {
        team: 'rollers', as: plan, live: 'on', base: String(VERSION_OF(srv, 'rollers')), drawn: `rollers:${plan}`, touched: '', event: '',
    });
    assert.equal(r2.status, 200, r2.body);
    clean(r2.body, 'result page, second version');
    assert.ok(r2.body.includes('&lt;img'), r2.body);
    for (const p of ['/manage/team/rollers', `/manage/team/rollers/plan/${plan}`, '/manage', '/manage/team/rollers/settings']) {
        const body = await page(p);
        clean(body, p);
        assert.equal(body.includes('&lt;b&gt;'), !p.endsWith('/settings'), p);
    }
    for (const p of ['/manage/team/rollers', `/manage/team/rollers/plan/${plan}`]) {
        assert.ok((await page(p)).includes('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;&#39;'), p);
    }
    // the discard flash names the riders
    const id3 = await intake(srv, c.cookie, {team: 'rollers', json: evil(['1001', '1002'])});
    const gone = await followPost(srv, c.cookie, `/manage/inbox/${id3}/discard`, {back: '/manage/team/rollers'});
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
    assert.ok(textOf(element(body, '<details class="confirm">')).includes('Deletes Rollers and its 2 plans.'), body);
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
        assert.deepEqual(links.map(m => m[1]), ['neutral', 'err', 'err', 'err']);
    }
    assert.equal(count(body, 'aria-current="page"'), 2);
    assert.ok(!body.includes('<select'));
    const sw = element(body, '<details class="switch"');
    assert.ok(textOf(sw).includes('Kettenfett RC · Thu 19 Nov'), textOf(sw));
    // the switcher leads to all teams; Club settings is no longer in it (the overview has it)
    assert.match(sw, /<p class="switch-foot"><a href="\/manage">All teams<\/a><\/p>/);
    assert.ok(!sw.includes('/manage/settings') && !sw.includes('Club settings'), sw);
    assert.ok(textOf(sw).includes('Rollers 19:30 · in 5 min 0 of 8 riders have the plan Axles 19:40 · in 15 min No plan: riders get nothing'), textOf(sw));
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
// from 1024 px; the page's own footer too, the sidebar has it.
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
        ['team settings', await get(`${TEAM}/settings`), TEAM, 'back'],
        ['plan page', await get(`${TEAM}/plan/${plan}`), TEAM, 'back'],
        ['upload page', await get('/manage/upload?team=rollers'), TEAM, 'back'],
        ['assign page', await get(`/manage/inbox/${entry}`), TEAM, 'back'],
        ['new team', await get('/manage/new-team'), '/manage', 'back'],
        ['club settings', await get('/manage/settings'), null, 'back'],
        ['team gone', await get('/manage/team/nope', 404), '/manage', 'back'],
        ['plan gone', await get(`${TEAM}/plan/zzzzzz`, 404), TEAM, 'back'],
        ['entry gone', await get('/manage/inbox/zzzzzz', 404), '/manage', 'back'],
        ['live confirm', await answer('/manage/live', {team: 'rollers', sheet: slow}), TEAM, null],
        ['back confirm', await answer('/manage/plan/back', {team: 'rollers', plan, n: '1', version: String(VERSION_OF(srv, 'rollers'))}), TEAM, null],
        ['upload result', await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers fast', ROLLERS.slice(0, 4))}, {as: plan, live: 'on'}), TEAM, 'back'],
        ['rider code', await answer('/manage/code', {action: 'on'}), null, null],
    ];
    for (const [what, body, here, bar] of pages) {
        assert.equal(count(body, '<div class="app">'), 1, what);
        assert.equal(count(body, '<aside class="side"'), 1, what);
        const side = element(body, '<aside class="side"');
        // the club (its back chevron everywhere but on the overview, where it is the place), the
        // teams in start time order, the footer; no Club settings
        assert.match(side, here === '/manage' ? /<p class="side-club"><a href="\/manage" aria-current="page">Kettenfett RC<\/a><\/p>/
            : /<p class="side-club"><a href="\/manage"><svg[^>]*>[\s\S]*?<\/svg>Kettenfett RC<\/a><\/p>/, what);
        assert.deepEqual([...side.matchAll(/<a class="trow \w+" href="\/manage\/team\/([a-z0-9-]+)"/g)].map(m => m[1]), ['rollers', 'sprockets'], what);
        assert.ok(!side.includes('/manage/settings') && !side.includes('Club settings') && !side.includes('side-foot'), `${what}: ${side}`);
        const foot = element(side, '<footer class="foot">');
        assert.ok(foot.includes('<a href="/privacy">Privacy</a>') && foot.includes(`<form method="post" action="/manage/logout">${CLUB_FIELD}`), `${what}: ${foot}`);
        // one place marked, the right one
        const marked = [...side.matchAll(/<a (?:class="trow \w+" )?href="([^"]+)" aria-current="page">/g)].map(m => m[1]);
        assert.deepEqual(marked, here === null ? [] : [here], what);
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
    // the stylesheet: the sidebar only from 1024 px, where the team switcher and the page's own footer
    // go; a back bar stays, as a link line in the page's column above the page, without the club name
    const desk = /@media \(min-width:1024px\)\{([\s\S]*?)\n\}/.exec(APP_CSS)[1];
    assert.ok(APP_CSS.includes('\n.side{display:none}\n'), 'no sidebar on phones');
    assert.ok(desk.includes('\n  .app>.topbar:not(.plain),.app>.page>.foot{display:none}\n'), desk);
    assert.ok(!/\.app>\.topbar(?:\.plain)?[,{][^}]*display:none/.test(desk.replace('.app>.topbar:not(.plain),', '')), 'nothing else hides the back bar');
    assert.ok(desk.includes('\n  .app{display:grid;grid-template-columns:18.5rem minmax(0,1fr);grid-template-rows:auto 1fr;'), desk);
    assert.ok(desk.includes('.side{display:flex;flex-direction:column;grid-column:1;grid-row:1 / -1;'), desk);
    assert.match(desk, /\n  \.app>\.topbar\.plain\{grid-column:2;grid-row:1;position:static;background:none;[^}]*border:0;/);
    assert.ok(desk.includes('\n  .app>.topbar.plain .topbar-club{display:none}\n'), desk);
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
    assert.ok(body.includes(`<span class="nm">${ESC}</span>`));
    assert.ok(body.includes(`<span class="label">${ESC}</span>`));
    assert.ok(body.includes(`Riders on &#39;${ESC}&#39;`));
    const live = srv.store.get(CID).teams[slug].live;
    const plan = await (await srv.get(`/manage/team/${slug}/plan/${live}`)).text();
    assert.ok(!plan.includes('<img'), 'no raw tag on the plan page');
    assert.ok(plan.includes(`Delete &#39;${ESC}&#39;`), plan);
    assert.ok(plan.includes(`<td class="nmcol">${ESC}</td>`), plan);
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
    assert.equal(live.location, '/manage/team/rollers');
    assert.deepEqual(live.flash, {kind: 'ok', text: '\'Rollers · slow\' is live for Rollers. Still to do: Rollers'});
    assert.ok(live.page.includes('<h1>Rollers</h1>'));
    // the flash sits under the fresh line and before the plans (no status card since Task 8c)
    assert.ok(live.page.indexOf('class="flash ok"') > live.page.indexOf('class="fresh"'));
    assert.ok(live.page.indexOf('class="flash ok"') < live.page.indexOf('class="cols"'));
    assert.match(live.page, /<div class="flash ok" role="status"><svg class="i" [^>]*><circle cx="12" cy="12" r="9"\/><path d="m8 12.5 2.8 2.8L16 9.5"\/><\/svg><p>/);
    // back to 'Rollers · fast': Make live of the plan that was live before
    const back = await followPost(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: fast, confirm: '1'});
    assert.equal(back.location, '/manage/team/rollers');
    assert.equal(srv.store.get(CID).teams.rollers.live, fast);

    const del = await followPost(srv, c.cookie, '/manage/sheet/delete', {team: 'rollers', sheet: slow});
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

// The version rows of a versions page.
const versionRows = body => elements(body, '<li class="version">');
const metaOf = row => textOf(/<p class="meta">([\s\S]*?)<\/p>/.exec(row)[1]).trim();


test('versions page: newest first, what changed, Back on all but the newest; a used-up plan has none', async t => {
    const c = makeClub();
    const v1 = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const v2 = version(c.club, 'rollers', v1, ROLLERS.slice(1), '2026-11-19T15:00:00Z');
    const v3 = version(c.club, 'rollers', v1, ['1003', '1002', ...ROLLERS.slice(3)], '2026-11-19T16:00:00Z');
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ['1009'], at: T('2026-11-19T14:30:00Z'), live: false});
    version(c.club, 'rollers', slow, ['1009', '1008'], '2026-11-19T14:40:00Z', {live: false});
    const srv = await serve(t, c);
    const sig = id => srv.store.get(CID).sheets[id].sig;
    const res = await srv.get(`/manage/team/rollers/plan/${v1}`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(!body.includes('http-equiv'), 'it never reloads itself');
    assert.ok(!body.includes('data-refresh'));
    assert.ok(body.includes('<a class="back" href="/manage/team/rollers">'), 'back to the team page');
    assert.match(body, /<h1>Rollers · fast · Thu 19 Nov 19:30<\/h1>/);
    const rows = versionRows(body);
    assert.deepEqual(rows.map(metaOf), [
        `v3 · 17:00 · LIVE · code ${sig(v3)}`,
        `v2 · 16:00 · code ${sig(v2)}`,
        `v1 · 15:00 · first version · code ${sig(v1)}`,
    ]);
    assert.ok(body.indexOf('v3 · 17:00 · LIVE') < body.indexOf('v2 · 16:00'));
    // one summary line and one fold of all lines per version (and Back's confirm, Task 8c)
    for (const row of rows) {
        assert.equal(count(row, '<p class="vsum">'), 1, row);
        assert.equal(count(row, '<details class="fold">'), 1, row);
        assert.ok(row.includes('<details class="fold"><summary>details</summary><ul>'), row);
    }
    const sum = row => textOf(/<p class="vsum">([\s\S]*?)<\/p>/.exec(row)[1]).trim();
    assert.deepEqual(rows.map(sum), ['new order', 'Ben out', 'First version']);
    assert.ok(textOf(rows[0]).includes('New order: Dan, Cleo, Eva, Finn, Gus, Hanna, Ida'), textOf(rows[0]));
    // Back on v2 and v1, not on the newest; the live plan's goes live at once and always asks first
    // (Task 8c)
    assert.equal(count(body, 'action="/manage/plan/back"'), 2);
    const version3 = srv.store.get(CID).teams.rollers.version;
    for (const [row, n] of [[rows[1], 2], [rows[2], 1]]) {
        const ask = element(row, '<details class="confirm inline">');
        assert.ok(ask, row);
        assert.ok(textOf(ask).includes(`Back to v${n} · goes live at once… Riders get v${n} at once instead of v3.`), textOf(ask));
        assert.ok(ask.includes(`<form method="post" action="/manage/plan/back">${CLUB_FIELD}<input type="hidden" name="team" value="rollers"><input type="hidden" name="plan" value="${v1}">`
            + `<input type="hidden" name="n" value="${n}"><input type="hidden" name="version" value="${version3}"><input type="hidden" name="back" value="versions">`
            + `<input type="hidden" name="confirm" value="1"><button class="btn primary small" type="submit">Back to v${n}</button></form>`), ask);
    }
    assert.ok(!rows[0].includes('action="/manage/plan/back"'));
    assert.ok(!body.includes('name="n" value="3"'));
    assert.ok(textOf(body).includes('Back to v2 · goes live at once'));

    // a plan that is not live: Back to v1, stored
    const other = await (await srv.get(`/manage/team/rollers/plan/${slow}`)).text();
    assert.equal(count(other, 'action="/manage/plan/back"'), 1);
    assert.ok(other.includes('<button class="btn secondary small" type="submit">Back to v1</button>'), other);
    assert.ok(!textOf(other).includes('goes live'));
    assert.ok(!textOf(other).includes('LIVE'));

    // used up: the list without buttons
    srv.clock.now = T('2026-11-26T12:00:00Z');
    const used = await srv.get(`/manage/team/rollers/plan/${v1}`);
    assert.equal(used.status, 200);
    const usedBody = await used.text();
    assert.equal(versionRows(usedBody).length, 3);
    assert.equal(count(usedBody, '<form method="post" action="/manage/plan/back"'), 0);
    assert.equal(count(usedBody, 'Back to v'), 0);
});


test('versions page: a plan whose v1 is gone', async t => {
    const c = makeClub();
    const v1 = upload(c.club, 'rollers', {type: 'fast', riders: ['1001'], at: T('2026-11-19T10:00:00Z')});
    for (let i = 2; i <= 21; i++) {
        version(c.club, 'rollers', v1, ['1001', String(1000 + i)], `2026-11-19T10:${String(i).padStart(2, '0')}:00Z`);
    }
    assert.equal(Object.hasOwn(c.club.sheets, v1), false, 'the 21st version dropped v1');
    const srv = await serve(t, c);
    const res = await srv.get(`/manage/team/rollers/plan/${v1}`);
    assert.equal(res.status, 200);
    const body = await res.text();
    const ns = versionRows(body).map(row => Number(/^v(\d+) /.exec(metaOf(row))[1]));
    assert.deepEqual(ns, Array.from({length: 20}, (_, i) => 21 - i));
    assert.ok(metaOf(versionRows(body).at(-1)).includes('first version'));
    assert.equal(count(body, 'action="/manage/plan/back"'), 19);
    assert.ok(body.includes(`<input type="hidden" name="plan" value="${v1}">`));

    // a plan or team that does not exist; GET only
    for (const p of ['/manage/team/rollers/plan/zzzzzz', '/manage/team/rollers/plan/__proto__', '/manage/team/rollers/plan/', '/manage/team/rollers/plan/%E0%A4%A']) {
        const gone = await srv.get(p);
        assert.equal(gone.status, 404, p);
        const text = await gone.text();
        assert.ok(text.includes('This plan no longer exists.'), p);
        assert.ok(text.includes('href="/manage/team/rollers"'), p);
    }
    const sprockets = await srv.get(`/manage/team/sprockets/plan/${v1}`);
    assert.equal(sprockets.status, 404);
    assert.ok((await sprockets.text()).includes('This plan no longer exists.'), 'another team\'s plan');
    for (const p of [`/manage/team/gone/plan/${v1}`, `/manage/team/__proto__/plan/${v1}`]) {
        const gone = await srv.get(p);
        assert.equal(gone.status, 404, p);
        assert.ok((await gone.text()).includes('This team no longer exists.'), p);
    }
    const posted = await post(srv, c.cookie, `/manage/team/rollers/plan/${v1}`);
    assert.equal(posted.status, 405);
    assert.equal(posted.headers.get('allow'), 'GET');
    const anon = await srv.get(`/manage/team/rollers/plan/${v1}`, null);
    assert.equal(anon.status, 303);
    assert.equal(anon.headers.get('location'), '/');
});


test('back: asks first when it leaves a hole; a stale version is refused', async t => {
    const c = makeClub();
    const v1 = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    version(c.club, 'rollers', v1, ROLLERS.slice(1), '2026-11-19T15:00:00Z');
    upload(c.club, 'sprockets', {riders: ['1001', '1009'], at: T('2026-11-19T16:30:00Z')});
    const srv = await serve(t, c);
    const file = storedClub(srv);
    const version0 = VERSION_OF(srv, 'rollers');
    const fields = {team: 'rollers', plan: v1, n: '1', version: String(version0)};
    // without confirm: the question, nothing changed
    const ask = await post(srv, c.cookie, '/manage/plan/back', fields);
    assert.equal(ask.status, 200, ask.body);
    assert.ok(ask.body.includes('<h1>Back to v1 of &#39;Rollers · fast&#39;?</h1>'), ask.body);
    assert.ok(textOf(ask.body).includes('v1 lists Ben, who now rides Sprockets. Rollers then rides without him. Back to v1 anyway?'), textOf(ask.body));
    assert.ok(ask.body.includes(`<form method="post" action="/manage/plan/back">${CLUB_FIELD}<input type="hidden" name="team" value="rollers"><input type="hidden" name="plan" value="${v1}">`
        + `<input type="hidden" name="n" value="1"><input type="hidden" name="version" value="${version0}"><input type="hidden" name="confirm" value="1">`), ask.body);
    assert.ok(textOf(ask.body).includes('Back to v1 anyway'));
    assert.ok(ask.body.includes('href="/manage/team/rollers"'));
    assert.ok(!ask.body.includes('http-equiv'));
    // the link back names the place it goes to: the team, or with back=versions the plan (F4)
    const link = body => /<a class="btn secondary" href="([^"]*)"><svg[^>]*>[\s\S]*?<\/svg>([^<]*)<\/a>/.exec(body).slice(1);
    assert.deepEqual(link(ask.body), ['/manage/team/rollers', 'Back to Rollers']);
    const fromPlan = await post(srv, c.cookie, '/manage/plan/back', {...fields, back: 'versions'});
    assert.equal(fromPlan.status, 200, fromPlan.body);
    assert.deepEqual(link(fromPlan.body), [`/manage/team/rollers/plan/${srv.store.get(CID).sheets[v1].plan}`, 'Back to Rollers · fast']);
    assert.equal(storedClub(srv), file);
    // with confirm: done, live at once, the hole said
    const done = await followPost(srv, c.cookie, '/manage/plan/back', {...fields, confirm: '1'});
    assert.equal(done.location, '/manage/team/rollers');
    assert.deepEqual(done.flash, {kind: 'ok', text: 'Back to v1: \'Rollers · fast\' v3 is live (was v2). Still to do: Rollers'});
    const after = srv.store.get(CID);
    const v3 = after.teams.rollers.live;
    assert.equal(after.sheets[v3].n, 3);
    assert.equal(after.sheets[v3].copyOf, 1);
    assert.equal(after.sheets[v3].sig, after.sheets[v1].sig);
    // the same POST again, with the old version: refused, nothing changed
    const changed = storedClub(srv);
    const stale = await post(srv, c.cookie, '/manage/plan/back', {...fields, confirm: '1'});
    assert.equal(stale.status, 409, stale.body);
    assert.deepEqual(flashOf(stale.body), {kind: 'err', text: 'Rollers changed since you opened the page. Nothing was changed.'});
    assert.ok(!stale.body.includes('http-equiv'));
    assert.equal(storedClub(srv), changed);
    // the newest n or one that is not stored
    for (const n of ['3', '9', 'x']) {
        const res = await post(srv, c.cookie, '/manage/plan/back', {...fields, n, version: String(VERSION_OF(srv, 'rollers')), confirm: '1'});
        assert.equal(res.status, 400, n);
        assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'This team or plan no longer exists. Reload the page.'});
    }
    assert.equal(storedClub(srv), changed);

    // from the versions page: Back asks in the page (the plan is live); v1 has none while the live v3
    // has its plan code (final review: it would store the same plan again); back=versions goes back there
    const page = await (await srv.get(`/manage/team/rollers/plan/${v1}`)).text();
    const rows = versionRows(page);
    const row = n => rows.find(r => metaOf(r).startsWith(`v${n} `));
    assert.ok(!row(1).includes('action="/manage/plan/back"'), row(1));
    assert.ok(textOf(element(row(2), '<details class="confirm inline">')).includes('Riders get v2 at once instead of v3.'), row(2));
    assert.ok(!textOf(row(2)).includes('anyway'), 'no hole, no "anyway"');
    const back = await followPost(srv, c.cookie, '/manage/plan/back', {team: 'rollers', plan: v1, n: '2', version: String(VERSION_OF(srv, 'rollers')), back: 'versions', confirm: '1'});
    assert.equal(back.location, `/manage/team/rollers/plan/${v1}`);
    assert.deepEqual(back.flash, {kind: 'ok', text: 'Back to v2: \'Rollers · fast\' v4 is live (was v3).'});
    assert.equal(metaOf(versionRows(back.page)[0]).startsWith('v4 · '), true);
    // v4 has v2's plan code: now v1 has Back again, asking in the page with the hole
    const row4 = n => versionRows(back.page).find(r => metaOf(r).startsWith(`v${n} `));
    const confirm = element(row4(1), '<details class="confirm inline">');
    assert.ok(confirm, row4(1));
    assert.ok(textOf(confirm).includes('Back to v1 · goes live at once… Riders get v1 at once instead of v4. v1 lists Ben, who now rides Sprockets. Rollers then rides without him. Back to v1 anyway?'), textOf(confirm));
    assert.ok(confirm.includes('<input type="hidden" name="back" value="versions"><input type="hidden" name="confirm" value="1">'), confirm);
    assert.ok(!row4(2).includes('action="/manage/plan/back"'), 'v2 has the live plan code');
    // a used-up plan
    srv.clock.now = T('2026-11-20T12:00:00Z');
    const used = await post(srv, c.cookie, '/manage/plan/back', {...fields, version: String(VERSION_OF(srv, 'rollers')), confirm: '1'});
    assert.equal(used.status, 400);
    assert.match(flashOf(used.body).text, /was for a race that is over/);
});


test('back: the flash names the version the cap drops to make room', async t => {
    // final review (Task 4 minor): with MAX_VERSIONS versions, Back drops the lowest that is not live
    const c = makeClub();
    const v1 = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    for (let i = 2; i <= MAX_VERSIONS; i++) {
        version(c.club, 'rollers', v1, i % 2 ? ROLLERS : ROLLERS.slice(1), `2026-11-19T15:${String(i).padStart(2, '0')}:00Z`);
    }
    const srv = await serve(t, c);
    const res = await followPost(srv, c.cookie, '/manage/plan/back', {team: 'rollers', plan: v1, n: '2', version: String(VERSION_OF(srv, 'rollers')), confirm: '1'});
    assert.equal(res.location, '/manage/team/rollers');
    assert.deepEqual(res.flash, {kind: 'ok', text: `Back to v2: 'Rollers · fast' v${MAX_VERSIONS + 1} is live (was v${MAX_VERSIONS}). v1 of 'Rollers · fast' goes to make room.`});
    assert.equal(Object.hasOwn(srv.store.get(CID).sheets, v1), false);
    // still at the cap: the next Back drops v2
    const again = await followPost(srv, c.cookie, '/manage/plan/back', {team: 'rollers', plan: v1, n: '3', version: String(VERSION_OF(srv, 'rollers')), confirm: '1'});
    assert.ok(again.flash.text.endsWith(`(was v${MAX_VERSIONS + 1}). v2 of 'Rollers · fast' goes to make room.`), again.flash.text);
});


test('old pages: undo answers 303 out of date', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    const file = storedClub(srv);
    const res = await followPost(srv, c.cookie, '/manage/undo', {team: 'rollers', version: String(VERSION_OF(srv, 'rollers'))});
    assert.equal(res.location, '/manage/team/rollers');
    assert.deepEqual(res.flash, {kind: 'err', text: 'This page was out of date. Nothing was changed.'});
    const gone = await followPost(srv, c.cookie, '/manage/undo', {team: 'gone', version: '1'});
    assert.equal(gone.location, '/manage');
    assert.deepEqual(gone.flash, {kind: 'err', text: 'This page was out of date. Nothing was changed.'});
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
    // Delete plan is on each plan page (Task 8c), not on the team page
    assert.equal(count(await teamBody(srv, 'rollers'), '<details class="confirm">'), 0);
    const confirms = [];
    for (const p of plansOfRollers(srv)) {
        confirms.push(...elements(await (await srv.get(`/manage/team/rollers/plan/${p}`)).text(), '<details class="confirm">'));
    }
    assert.equal(confirms.length, 2, 'the live plan\'s and the other plan\'s');
    for (const cf of confirms) {
        assert.ok(textOf(cf).includes(KEPT), textOf(cf));
    }
    const result = await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers spare', ['1009'])}, {as: 'new', live: '', type: 'spare', date: DATE});
    const del = element(result, '<details class="confirm">');
    assert.ok(del, result);
    assert.ok(textOf(del).includes(`Deletes 'Rollers · spare' with all its versions. This cannot be undone. ${KEPT} (90 days by default).`), textOf(del));
    const settings = await (await srv.get('/manage/team/rollers/settings')).text();
    assert.ok(textOf(element(settings, '<details class="confirm">')).includes(KEPT));
    for (const key of ['ts-delete-body', 'ts-delete-body-one', 'ts-delete-body-none', 'tp-delete-live', 'tp-delete-other', 'result-delete-confirm', 'result-delete-confirm-live']) {
        assert.ok(COPY[key].endsWith(`${KEPT} (90 days by default).`), key);
    }
});


test('team action refusals answer the team page', async t => {
    const c = makeClub();
    const fast = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const srv = await serve(t, c);
    await storeOk(srv, c.cookie, {team: 'rollers', json: planJson('Rollers new', ROLLERS.slice(0, 6))}, {as: 'new', live: 'on', date: DATE});
    const stale = await post(srv, c.cookie, '/manage/plan/back', {team: 'rollers', plan: fast, n: '1', version: VERSION_OF(srv, 'rollers') - 1});
    assert.equal(stale.status, 409, stale.body);
    assert.deepEqual(flashOf(stale.body), {kind: 'err', text: 'Rollers changed since you opened the page. Nothing was changed.'});
    assert.ok(stale.body.includes('<h1>Rollers</h1>'), 'the team page');
    // inside the refresh window, a refusal never reloads (it would GET the POST's URL)
    assert.ok(!stale.body.includes('http-equiv'));
    assert.ok(!stale.body.includes('data-refresh'));
    const gone = await post(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: 'zzzzzz'});
    assert.equal(gone.status, 400);
    assert.deepEqual(flashOf(gone.body), {kind: 'err', text: 'This team or plan no longer exists. Reload the page.'});
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
        assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'This team or plan no longer exists. Reload the page.'});
    }
});


test('two tabs: a flash for another page stays', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ROLLERS.slice(0, 7), at: T('2026-11-19T14:10:00Z'), live: false});
    const srv = await serve(t, c);
    const res = await post(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: slow, confirm: '1'});
    assert.equal(res.status, 303, res.body);
    assert.equal(res.headers.get('location'), '/manage/team/rollers');
    const pair = res.headers.getSetCookie()[0].split(';')[0];
    const cookie = `${c.cookie}; ${pair}`;
    const sprockets = await srv.get('/manage/team/sprockets', cookie);
    assert.equal(sprockets.status, 200);
    assert.deepEqual(sprockets.headers.getSetCookie(), [], 'the cookie stays');
    assert.equal(flashOf(await sprockets.text()), null);
    const rollers = await srv.get('/manage/team/rollers', cookie);
    assert.deepEqual(rollers.headers.getSetCookie(), [FLASH_CLEARED]);
    assert.deepEqual(flashOf(await rollers.text()), {kind: 'ok', text: '\'Rollers · slow\' is live for Rollers.'});
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

// The form that posts `action` to /manage/team (its hidden action field), whole.
function teamForm(body, action) {
    const at = body.indexOf(`<input type="hidden" name="action" value="${action}">`);
    assert.ok(at >= 0, `form ${action}`);
    const start = body.lastIndexOf('<form', at);
    return body.slice(start, body.indexOf('</form>', at) + '</form>'.length);
}


test('team settings page: name, start time, event links, delete; never reloads', async t => {
    const c = makeClub();
    const fast = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z'), pinned: 4567890});
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
    assert.ok(body.includes('<p class="kicker">Rollers</p><h1>Team settings</h1>'), body);
    // name
    const rename = teamForm(body, 'rename');
    assert.ok(rename.includes('<input type="hidden" name="team" value="rollers">'), rename);
    assert.ok(rename.includes('name="name" value="Rollers"'), rename);
    assert.ok(textOf(rename).includes('Rename'));
    assert.ok(text.includes('Riders see the new name at their next check. The team keeps its plans.'));
    // start time
    const start = teamForm(body, 'start');
    assert.ok(start.includes('<input type="hidden" name="team" value="rollers">'), start);
    assert.ok(start.includes('<input type="time" name="start" value="19:30">'), start);
    assert.ok(textOf(start).includes('Save start time'));
    assert.ok(text.includes('In Europe/Berlin, for every race of Rollers. Riders get the plan 30 min before it. Empty means no start time: riders get nothing.'));
    // event links: the pinned plan only, with Remove back to these settings
    const links = element(body, '<section class="card" aria-labelledby="link-h">');
    assert.ok(textOf(links).includes('Event links Rollers · fast Live Zwift event 4567890'), textOf(links));
    assert.ok(links.includes('<p class="meta">Zwift event <span class="num">4567890</span>, from your link</p>'), links);
    assert.ok(!links.includes('Rollers · slow'));
    assert.equal(count(links, '<form method="post" action="/manage/sheet/unpin">'), 1);
    assert.ok(links.includes(`<input type="hidden" name="team" value="rollers"><input type="hidden" name="sheet" value="${fast}"><input type="hidden" name="back" value="team-settings">`), links);
    assert.ok(textOf(links).includes('Remove the event link of \'Rollers · fast\''));
    assert.ok(textOf(links).includes('A plan with a link goes only to riders in that event. Without one it finds its event by the start time. To add a link again, upload a new version with it.'));
    // delete behind an in-page confirm, with the plan count
    const confirm = element(body, '<details class="confirm">');
    assert.ok(textOf(body).includes('Delete Rollers Delete team…'), 'the danger zone');
    assert.ok(textOf(confirm).includes('Deletes Rollers and its 2 plans. Riders get nothing from it any more. This cannot be undone. Recordings stay until they expire. '
        + 'Versions used in a ride recording stay with it for analysis (90 days by default).'), confirm);
    const del = teamForm(confirm, 'delete');
    assert.ok(del.includes('<input type="hidden" name="team" value="rollers">'), del);
    assert.ok(textOf(del).includes('Delete Rollers'));

    // a team without links, with one plan
    const sp = await pageBody(srv, '/manage/team/sprockets/settings');
    assert.ok(textOf(sp).includes('No plan of Sprockets has an event link. Plans find their event by the start time. To add a link, upload the plan again with it.'));
    assert.ok(!sp.includes('action="/manage/sheet/unpin"'));
    assert.ok(textOf(sp).includes('Deletes Sprockets and its plan. Riders get nothing'), textOf(sp));
    // a team without plans
    await followPost(srv, c.cookie, '/manage/team', {action: 'add', name: 'Cogs', start: ''});
    const cogs = await pageBody(srv, '/manage/team/cogs/settings');
    assert.ok(cogs.includes('<input type="time" name="start" value="">'));
    assert.ok(textOf(cogs).includes('Deletes Cogs. It has no plans. This cannot be undone.'), textOf(cogs));

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
    assert.deepEqual(res.flash, {kind: 'ok', text: 'Start time of Rollers: 19:45.'});
    assert.ok(res.page.includes('<h1>Team settings</h1>'));
    assert.ok(res.page.includes('value="19:45"'));
    res = await team({action: 'rename', team: 'rollers', name: 'Rollers Elite'});
    assert.equal(res.location, '/manage/team/rollers/settings');
    assert.deepEqual(res.flash, {kind: 'ok', text: 'Renamed to Rollers Elite.'});
    // unpin from the settings goes back there, from the team page to the team page
    res = await followPost(srv, c.cookie, '/manage/sheet/unpin', {team: 'rollers', sheet: fast, back: 'team-settings'});
    assert.equal(res.location, '/manage/team/rollers/settings');
    // the rename relabels the stored versions
    assert.deepEqual(res.flash, {kind: 'ok', text: 'Removed the event link of \'Rollers Elite · fast\'.'});
    // no Undo: the link comes back only with a new version; here it is set again directly
    const repin = () => srv.store.change(CID, x => {
        x.sheets[fast].pinnedEventId = 4567890;
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
    res = await team({action: 'delete', team: 'rollers'});
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
    assert.ok(res.body.includes('<p class="kicker">Rollers</p><h1>Team settings</h1>'), res.body);
    assert.ok(teamForm(res.body, 'rename').includes(`value="${long}"`));
    // the other form keeps the stored value
    assert.ok(teamForm(res.body, 'start').includes('value="19:30"'));
    assert.ok(!res.body.includes('http-equiv') && !res.body.includes('data-refresh'));
    res = await team({action: 'start', team: 'rollers', start: '25:00'});
    assert.equal(res.status, 400);
    assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'Enter the start time as HH:MM.'});
    assert.ok(teamForm(res.body, 'start').includes('value="25:00"'));
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
        assert.equal((await team({action: 'delete', team: added.location.split('/').pop()})).status, 303);
    }
    res = await team({action: 'delete', team: 'rollers'});
    assert.equal(res.status, 429, res.body);
    assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'Too many team deletions today. Try again tomorrow.'});
    assert.ok(res.body.includes('<p class="kicker">Rollers</p><h1>Team settings</h1>'));
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
    const kicker = body => /<p class="kicker">([^<]*)<\/p>/.exec(body)?.[1] ?? null;
    let body = await pageBody(srv, '/manage/team/new');
    assert.equal(h1(body), 'New');
    body = await pageBody(srv, '/manage/team/settings');
    assert.equal(h1(body), 'Settings');
    body = await pageBody(srv, '/manage/team/settings/settings');
    assert.equal(h1(body), 'Team settings');
    assert.equal(kicker(body), 'Settings');
    body = await pageBody(srv, '/manage/new-team');
    assert.equal(h1(body), 'Add a team');
    body = await pageBody(srv, '/manage/team/new/settings');
    assert.equal(h1(body), 'Team settings');
    assert.equal(kicker(body), 'New');
    // the club settings next to a team called Settings
    body = await pageBody(srv, '/manage/settings');
    assert.equal(h1(body), 'Club settings');
    assert.ok(body.includes('<form class="stack" method="post" action="/manage/club">'));
    body = await pageBody(srv, '/manage/team/settings/settings');
    assert.equal(h1(body), 'Team settings');
    assert.equal(kicker(body), 'Settings');
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
    assert.ok(ask.body.includes('<p class="kicker">Kettenfett RC · Rollers</p><h1>Make &#39;Rollers · slow&#39; live?</h1>'), ask.body);
    assert.ok(text.includes('This plan is outdated: riders it lists now ride another team.'), text);
    assert.ok(text.includes('Ben now rides Sprockets'), text);
    assert.ok(ask.body.includes(`<form method="post" action="/manage/live">${CLUB_FIELD}<input type="hidden" name="team" value="rollers"><input type="hidden" name="sheet" value="${slow}"><input type="hidden" name="confirm" value="1"><button class="btn primary" type="submit">Make live anyway</button></form>`), ask.body);
    assert.ok(ask.body.includes('href="/manage/team/rollers"'));
    assert.ok(text.includes('Back to Rollers'));
    assert.ok(!text.includes('Back to the club page'));
    assert.ok(!ask.body.includes('http-equiv') && !ask.body.includes('data-refresh'));
    assert.equal(srv.store.get(CID).teams.rollers.live, fast, 'nothing changed yet');
    // a refused Make live answers on the page it was asked from: the plan page with back=plan
    const change = srv.store.change;
    srv.store.change = () => {
        throw new ClubError('too-big');
    };
    try {
        const plan = srv.store.get(CID).sheets[slow].plan;
        const refused = await post(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: slow, back: 'plan', confirm: '1'});
        assert.equal(refused.status, 400, refused.body);
        assert.equal(flashOf(refused.body)?.kind, 'err', refused.body);
        assert.match(refused.body, /<h1>Rollers · slow · [^<]+<\/h1>/, 'the plan page');
        assert.ok(refused.body.includes(`/manage/upload?team=rollers&amp;plan=${plan}&amp;`), 'its New version');
        const onTeam = await post(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: slow, confirm: '1'});
        assert.equal(onTeam.status, 400, onTeam.body);
        assert.ok(onTeam.body.includes('<nav class="topbar" aria-label="Teams">'), 'the team page');
    } finally {
        srv.store.change = change;
    }
    assert.equal(srv.store.get(CID).teams.rollers.live, fast, 'nothing changed');
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
    assert.ok(res.body.includes('<p class="kicker">Rollers Elite</p><h1>Team settings</h1>'), res.body);
    assert.equal(teams().rollers.name, 'Rollers Elite');

    // start: set, cleared by a blank field, a bad one refused on the settings
    done = await follow({action: 'start', team: 'rollers', start: '19:45'});
    assert.deepEqual(done.flash, {kind: 'ok', text: 'Start time of Rollers Elite: 19:45.'});
    assert.equal(teams().rollers.start, '19:45');
    done = await follow({action: 'start', team: 'rollers', start: ''});
    assert.deepEqual(done.flash, {kind: 'ok', text: 'Rollers Elite has no start time now.'});
    assert.equal(teams().rollers.start, null);
    res = await team({action: 'start', team: 'rollers', start: '25:00'});
    assert.equal(res.status, 400);
    assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'Enter the start time as HH:MM.'});
    assert.ok(res.body.includes('<h1>Team settings</h1>'));
    assert.equal(teams().rollers.start, null);

    // the settings offer Delete; delete takes the plans and retires the slug
    const page = await pageBody(srv, '/manage/team/rollers/settings');
    assert.ok(element(page, '<details class="confirm">').includes(`<form method="post" action="/manage/team">${CLUB_FIELD}<input type="hidden" name="action" value="delete"><input type="hidden" name="team" value="rollers"><button class="btn danger" type="submit">`), page);
    done = await follow({action: 'delete', team: 'rollers'});
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
        return {slug, res: await team({action: 'delete', team: slug})};
    };
    for (let i = 0; i < 20; i++) {
        const {res} = await cycle();
        assert.equal(res.status, 303, `delete ${i + 1}`);
    }
    const file = tombs();
    const {slug, res} = await cycle();
    assert.equal(res.status, 429, res.body);
    assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'Too many team deletions today. Try again tomorrow.'});
    assert.ok(res.body.includes('<p class="kicker">Temp</p><h1>Team settings</h1>'), res.body);
    assert.ok(res.body.includes(`<a class="back" href="/manage/team/${slug}">`), 'the settings of that team');
    assert.ok(Object.hasOwn(srv.store.get(CID).teams, slug), 'the team stays');
    assert.equal(tombs(), file, 'nothing retired');
    // an unknown team does not count, and is still refused as unknown
    assert.equal((await team({action: 'delete', team: 'gone'})).status, 400);
    // another club is not affected
    const spokes = await follow({action: 'delete', team: 'spokes'}, other.cookie);
    assert.deepEqual(spokes.flash, {kind: 'ok', text: 'Deleted Spokes and its plans.'});
    assert.ok(!Object.hasOwn(srv.store.get('p2m8c4t1v9').teams, 'spokes'));
    // a day later it works again
    srv.clock.now = NOW + 24 * 3600 * 1000;
    assert.deepEqual((await follow({action: 'delete', team: slug})).flash, {kind: 'ok', text: 'Deleted Temp and its plans.'});
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
    assert.ok(textOf(element(body, '<nav class="topbar plain"')).includes('Teams'));
    assert.ok(body.includes('<header class="pagehead"><p class="kicker desk">Kettenfett RC</p><h1>Club settings</h1></header>'), body);
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
    assert.ok(text.includes('For a new phone, or if the link leaked. Opening it ends the old link, and other phones are signed out.'));
    // remove a rider
    const rider = formTo(body, '/manage/rider/remove');
    assert.match(rider, /<input type="text" name="zwiftId" inputmode="numeric"/);
    assert.ok(textOf(rider).includes('Zwift ID'));
    assert.ok(textOf(rider).includes('Remove'));
    assert.ok(text.includes('For data-protection requests (GDPR): if a rider asks the club to delete their data'));
    // the records band after the club's own settings, then the danger zone and the footer (the page's:
    // the sidebar has one of its own)
    const main = element(body, '<main class="page" id="main">');
    const order = ['action="/manage/club"', 'id="who-h"', 'action="/manage/email"', 'action="/manage/newlink"', 'action="/manage/rider/remove"',
        '<h2 class="band">Records</h2>', 'id="rec-h"', 'id="act-h"', '<section class="danger-zone"', 'action="/manage/delete"', '<footer class="foot">']
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
    assert.ok(text.includes('Code made Thu 12 Nov 14:02. Lost it? Any rider who entered it sees the code in Paceline under Clubs.'), text);
    assert.ok(!text.includes('Make private'));
    const confirm = element(who, '<details class="confirm">');
    assert.ok(confirm, who);
    assert.ok(textOf(confirm).includes('New rider code…'));
    assert.ok(textOf(confirm).includes('Riders with the old code get no plans until they enter the new one. Don\'t do this on a race day.'));
    const fresh = formTo(confirm, '/manage/code');
    assert.ok(fresh.includes(`<input type="hidden" name="action" value="new"><input type="hidden" name="confirm" value="1"><input type="hidden" name="setAt" value="${setAt}">`), fresh);
    assert.ok(textOf(fresh).includes('Make a new code'));
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
    let who = sectionOf(await pageBody(srv, '/manage/settings'), 'who-h');
    assert.ok(textOf(who).includes('Private clubs are off on this server.'));
    assert.ok(!who.includes('action="/manage/code"'), 'no form');
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
        assert.ok(del.includes(`<span class="sr">Delete ${rider}, ${day}</span>`), del);
    }
    // captains don't download recordings (17 Nov 2026): no link into /manage/logs/, no Download text,
    // the one thing under that path is the Delete form
    assert.doesNotMatch(rec, /href="\/manage\/logs\//);
    assert.doesNotMatch(rec, /<a [^>]*>/);
    assert.ok(!/download/i.test(textOf(rec)), textOf(rec));
    assert.equal([...rec.matchAll(/\/manage\/logs\//g)].length, 3);
    assert.equal([...rec.matchAll(/<form method="post" action="\/manage\/logs\/delete">/g)].length, 3);
    assert.ok(textOf(rec).includes("Recordings are kept for the Paceline operator, who analyses the team's rides with them; they are deleted after 90 days."), textOf(rec));

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
        ['30', "Recordings are kept for the Paceline operator, who analyses the team's rides with them; they are deleted after 30 days."],
        ['0', "Recordings are kept for the Paceline operator, who analyses the team's rides with them, until you delete them."],
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
        ['/manage/club', {name: 'Kettenfett Racing', tz: 'UTC'}, {kind: 'ok', text: 'Saved.'}],
        ['/manage/rider/remove', {zwiftId: '1001'}, {kind: 'ok', text: 'Removed from 1 plan.'}],
        ['/manage/logs/delete', {slug: 'rollers', file: name}, {kind: 'ok', text: 'Recording deleted.'}],
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

    // on: the code page, a direct answer
    const on = await post(srv, c.cookie, '/manage/code', {action: 'on'});
    assert.equal(on.status, 200, on.body);
    assert.equal(count(on.body, 'data-copy='), 1);
    assert.match(on.body, /<button type="button" class="btn secondary" data-js data-copy="[^"]+" data-copied="Copied" hidden>Copy the code<\/button>/);
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
    refused(await post(srv, c.cookie, '/manage/code', {action: 'fly'}), 400, 'This form was not understood. Reload the page and try again.');
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

    const on = await post(srv, c.cookie, '/manage/code', {action: 'on'});
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
    assert.ok(on.body.includes('<a class="btn secondary" href="/manage/settings">'), on.body);
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

    // a new code: asked first, in the page only (decision 13: no confirm page of its own)
    const setAt = srv.store.get(CID).riderCode.setAt;
    const ask = element(later, '<details class="confirm">');
    assert.ok(textOf(ask).includes('Riders with the old code get no plans until they enter the new one. Don\'t do this on a race day.'), ask);
    assert.ok(ask.includes(`<form method="post" action="/manage/code">${CLUB_FIELD}<input type="hidden" name="action" value="new"><input type="hidden" name="confirm" value="1"><input type="hidden" name="setAt" value="${setAt}"><button class="btn secondary" type="submit">Make a new code</button></form>`), ask);
    // without confirm=1: a form not understood, nothing changed
    const bare = await post(srv, c.cookie, '/manage/code', {action: 'new'});
    assert.equal(bare.status, 400, bare.body);
    assert.deepEqual(flashOf(bare.body), {kind: 'err', text: 'This form was not understood. Reload the page and try again.'});
    assert.ok(bare.body.includes('<h1>Club settings</h1>'), bare.body);
    assert.ok(!bare.body.includes('New rider code?'), bare.body);
    assert.equal(bare.body.match(CODE_RE), null);
    assert.equal(srv.store.get(CID).riderCode.hash, hash);
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
    assert.ok(body.includes('<h2 class="sr">Your teams</h2>'));
    assert.deepEqual(tiles(body), [
        {sev: 'ok', href: '/manage/team/rollers', name: 'Rollers', time: '19:30 · in 5 min', line: '8 of 8 riders have the plan', lineSev: 'ok', quiet: 'Live: \'Rollers · fast\''},
        {sev: 'err', href: '/manage/team/axles', name: 'Axles', time: '19:40 · in 15 min', line: 'No plan: riders get nothing', lineSev: 'err', quiet: 'Upload a plan to fix this'},
        {sev: 'neutral', href: '/manage/team/sprockets', name: 'Sprockets', time: '19:40 · in 15 min', line: '0 of 1 rider has the plan', lineSev: 'neutral', quiet: 'Live: \'Sprockets\''},
        {sev: 'err', href: '/manage/team/cranks', name: 'Cranks', time: 'No start time', line: 'No start time and no plan', lineSev: 'err', quiet: 'Set a start time and upload a plan'},
    ]);
    // the add tile last, the club settings link, the footer
    assert.match(element(body, '<ul class="tiles">'), /<li><a class="tile add" href="\/manage\/new-team"><svg[^>]*>[\s\S]*?<\/svg>Add a team<\/a><\/li>\s*<\/ul>$/);
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
    const done = await followPost(srv, c.cookie, '/manage/team', {action: 'delete', team: c.slugs[0]});
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
    assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'This team or plan no longer exists. Reload the page.'});
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
        + ' 1 Add a team Its name and its race rhythm: every week at its start time, or special, with date and time on each plan.'
        + ' A ZRL team and a WTRL team are two teams.'
        + ' 2 Upload the team\'s plan The planner\'s JSON export, which has the pull watts as pull power; else add the text export for them.'
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
    const {entryGonePage} = await import('../assign-page.mjs');
    const {teamGonePage, liveConfirmPage} = await import('../team-page.mjs');
    const {planGonePage, backConfirmPage} = await import('../versions-page.mjs');
    const {codePage} = await import('../settings-page.mjs');
    const {uploadPage} = await import('../upload-page.mjs');
    const c = makeClub();
    const id = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const plan = c.club.sheets[id].plan;
    const NOTE = 'This page needs JavaScript. Make live still works without it.';
    // what the captain frame draws its sidebar with (manage-page.mjs frameOf)
    const frame = {now: NOW, seen: {}, multi: false};
    const without = {
        signedOutPage: signedOutPage(),
        entryGonePage: entryGonePage(c.club, frame),
        teamGonePage: teamGonePage(c.club, frame),
        planGonePage: planGonePage(c.club, 'rollers', frame),
        codePage: codePage(c.club, 'ABCDE12345', frame),
        liveConfirmPage: liveConfirmPage(c.club, 'rollers', id, {...frame, words: 'Riders get it at once.'}),
        backConfirmPage: backConfirmPage(c.club, 'rollers', {...frame, plan, n: 1, version: c.club.teams.rollers.version, words: 'Riders get v1 at once.'}),
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
    assert.match(body, /<p class="count"><strong>0 of 1<\/strong> has the plan<\/p>/);
    srv.see('1001', '2026-11-19T18:22:00Z', {sig, mod: '0.3.0', sheet: live, inEvent: true, event: null});
    body = await teamBody(srv, 'rollers');
    assert.match(body, /<p class="count"><strong>1 of 1<\/strong> has the plan<\/p>/);
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
    assert.equal(status, 200, stored);
    const after = await srv.body();
    assert.deepEqual(tiles(after).map(x => x.href), ['/manage/team/cogs', '/manage/team/rollers', '/manage/team/sprockets']);
    assert.ok(!after.includes('Other teams'));
    assert.ok(!after.includes('<details class="fold"'));
});


test('team settings: race rhythm, and the club\'s race day', async t => {
    const c = kindsClub();
    const srv = await serve(t, c);
    const body = await pageBody(srv, '/manage/team/rollers/settings');
    const rhythm = teamForm(body, 'kind');
    assert.ok(body.includes('<h2 id="kind-h">Race rhythm</h2>'), body);
    assert.ok(rhythm.includes('<form class="stack" method="post" action="/manage/team">'), rhythm);
    assert.ok(rhythm.includes('<input type="hidden" name="team" value="rollers">'), rhythm);
    assert.ok(rhythm.includes('<input type="radio" name="kind" value="weekly" checked>'), rhythm);
    assert.ok(rhythm.includes('<input type="radio" name="kind" value="special">'), rhythm);
    assert.ok(textOf(rhythm).includes('Every week on Thursday'), textOf(rhythm));
    assert.ok(textOf(rhythm).includes('Special: date and start time come with each plan'));
    assert.ok(rhythm.includes('<label class="field">Race day<select name="weekday" aria-describedby="weekday-hint">'), rhythm);
    assert.ok(rhythm.includes('<p class="hint" id="weekday-hint">Follows the club&#39;s race day in <a href="/manage/settings">Club settings</a>. '
        + 'Pick a day to fix it for this team only.</p>'), rhythm);
    const select = element(rhythm, '<select name="weekday" aria-describedby="weekday-hint">');
    assert.deepEqual([...select.matchAll(/<option value="([^"]*)"( selected)?>([^<]*)<\/option>/g)].map(m => [m[1], !!m[2], textOf(m[3])]), [
        ['', true, 'Same as the club (Thursday)'], ['1', false, 'Monday'], ['2', false, 'Tuesday'], ['3', false, 'Wednesday'],
        ['4', false, 'Thursday'], ['5', false, 'Friday'], ['6', false, 'Saturday'], ['7', false, 'Sunday'],
    ]);

    // Cogs: special
    const v = VERSION_OF(srv, 'cogs');
    const done = await followPost(srv, c.cookie, '/manage/team', {action: 'kind', team: 'cogs', kind: 'special', weekday: ''});
    assert.equal(done.location, '/manage/team/cogs/settings');
    assert.deepEqual(done.flash, {kind: 'ok', text: 'Cogs: Special: date and start time come with each plan.'});
    assert.ok(done.page.includes('<input type="radio" name="kind" value="special" checked>'), done.page);
    assert.equal(VERSION_OF(srv, 'cogs'), v + 1);
    // Sprockets: every Tuesday
    const tue = await followPost(srv, c.cookie, '/manage/team', {action: 'kind', team: 'sprockets', kind: 'weekly', weekday: '2'});
    assert.deepEqual(tue.flash, {kind: 'ok', text: 'Sprockets: Every week on Tuesday.'});
    assert.ok(tue.page.includes('<option value="2" selected>Tuesday</option>'), tue.page);
    assert.equal(srv.store.get(CID).teams.sprockets.weekday, 2);
    assert.ok(textOf(teamForm(tue.page, 'kind')).includes('Every week on Tuesday'));
    // refused: the settings with the text, nothing changed
    for (const [fields, text] of [
        [{kind: 'monthly', weekday: ''}, 'Choose weekly or special.'],
        [{kind: 'weekly', weekday: '8'}, 'Choose a weekday.'],
        [{kind: 'weekly', weekday: 'Mon'}, 'Choose a weekday.'],
    ]) {
        const bad = await post(srv, c.cookie, '/manage/team', {action: 'kind', team: 'rollers', ...fields});
        assert.equal(bad.status, 400, bad.body);
        assert.deepEqual(flashOf(bad.body), {kind: 'err', text});
        assert.ok(bad.body.includes('<h1>Team settings</h1>'));
    }
    assert.equal(srv.store.get(CID).teams.rollers.kind, 'weekly');

    // the club's race day: in the club form, beside name and zone
    const settings = await pageBody(srv, '/manage/settings');
    const club = element(settings, '<form class="stack" method="post" action="/manage/club">');
    assert.ok(textOf(club).includes('Race day of weekly teams'), textOf(club));
    assert.ok(club.includes('<option value="4" selected>Thursday</option>'), club);
    const days = element(club, '<select name="weekday">');
    assert.deepEqual([...days.matchAll(/<option value="([^"]*)"( selected)?>([^<]*)<\/option>/g)].map(m => m[3]),
        ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
    const saved = await followPost(srv, c.cookie, '/manage/club', {name: 'Kettenfett RC', tz: 'Europe/Berlin', weekday: '2'});
    assert.deepEqual(saved.flash, {kind: 'ok', text: 'Saved.'});
    assert.equal(srv.store.get(CID).weekday, 2);
    assert.ok(element(saved.page, '<form class="stack" method="post" action="/manage/club">').includes('<option value="2" selected>Tuesday</option>'));
    assert.ok(saved.page.includes('Race day Tuesday'), 'the activity');
    // Rollers' default date: the next Tuesday
    const id = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers', ROLLERS)});
    const assign = await pageBody(srv, `/manage/inbox/${id}`);
    assert.ok(assign.includes('<input type="date" name="date" value="2026-11-24">'), assign);
    // a club form without weekday (a page from before) keeps it; a bad one is refused
    await followPost(srv, c.cookie, '/manage/club', {name: 'Kettenfett RC', tz: 'Europe/Berlin'});
    assert.equal(srv.store.get(CID).weekday, 2);
    const bad = await post(srv, c.cookie, '/manage/club', {name: 'Kettenfett RC', tz: 'Europe/Berlin', weekday: '0'});
    assert.equal(bad.status, 400);
    assert.deepEqual(flashOf(bad.body), {kind: 'err', text: 'Choose a weekday.'});
    assert.equal(srv.store.get(CID).weekday, 2);
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
    assert.ok(textOf(body).includes('and upload it here with its date and start time. Riders get it 30 min before the start.'), textOf(body));
    assert.ok(!body.includes('<time></time>'));
    // a weekly team has its day
    assert.ok(textOf(await teamBody(srv, 'rollers')).includes('Thu 19 Nov · 19:30'));
});


test('assign page: a special team without a plan needs a date', async t => {
    const c = kindsClub();
    const srv = await serve(t, c);
    const id = await intake(srv, c.cookie, {team: 'cogs', json: planJson('Cogs', ['1009'])});
    const body = await pageBody(srv, `/manage/inbox/${id}`);
    const field = /<input type="date" name="date" value="" required>/.exec(body);
    assert.ok(field, body);
    // the date is not in the fold, so its summary names only the event link (Task 8b review)
    const more = body.indexOf('<details class="card fold"><summary>More: event link</summary>');
    assert.ok(more > 0, body);
    assert.ok(!body.includes(COPY['as-more']));
    assert.ok(field.index < more, 'the date sits above the More fold');
    assert.equal(count(body, 'name="date"'), 1);
    // Store without a date: refused, the entry stays
    const stored = await post(srv, c.cookie, `/manage/inbox/${id}`, {team: 'cogs', as: 'new', live: 'on', base: String(VERSION_OF(srv, 'cogs')), drawn: 'cogs:new', date: '', type: ''});
    assert.equal(stored.status, 400, stored.body);
    assert.deepEqual(flashOf(stored.body), {kind: 'err', text: 'Enter the race date as YYYY-MM-DD.'});
    assert.equal(srv.store.get(CID).inbox.length, 1);
    assert.equal(Object.keys(srv.store.get(CID).sheets).length, 0);
    // a weekly team's date stays in the fold
    const rid = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers', ROLLERS)});
    const rollers = await pageBody(srv, `/manage/inbox/${rid}`);
    const at = rollers.indexOf('<input type="date" name="date" value="2026-11-19">');
    assert.ok(at > rollers.indexOf('<summary>More: race date, event link</summary>'), rollers);
    assert.ok(rollers.indexOf('<summary>More: race date, event link</summary>') > 0);
});


// ---- the team page as a race-day cockpit, the plan page, every Make live confirmed (Task 8c) ----


// The plan rows of a team page, in page order.
const planRows = body => elements(body, '<li class="planrow');
const rowLabel = row => textOf(/<span class="label">([\s\S]*?)<\/span>/.exec(row)[1]);


test('team page: one row per plan, no … menu, no status card, no fixed upload bar', async t => {
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
    assert.match(body, /<body class="teampage"/);
    // the upload link: plain, after the plans (and the riders); the only thing in the third column
    assert.match(body, /<a class="uplink" href="\/manage\/upload\?team=rollers">[\s\S]*?Upload a plan<\/a>/);
    assert.ok(body.indexOf('class="uplink"') > body.indexOf('class="card riders-card"'));
    assert.ok(body.indexOf('class="card riders-card"') > body.indexOf('class="card plans-card"'));
    assert.match(body, /<div class="col-c"><a class="uplink" [^>]*>[\s\S]*?<\/a><\/div>/);
    // one row per plan, each linking to its plan page
    const rows = planRows(body);
    assert.deepEqual(rows.map(rowLabel), ['Rollers · fast', 'Rollers · slow']);
    for (const [row, id] of [[rows[0], fast], [rows[1], slow]]) {
        assert.ok(row.includes(`href="/manage/team/rollers/plan/${id}"`), row);
    }
    assert.ok(textOf(element(body, '<section class="card plans-card"')).startsWith(' Plans for Thu 19 Nov 2 '), body);
    // the race line with the opening time: after the gate, open since
    assert.equal(textOf(/<p class="race">([\s\S]*?)<\/p>/.exec(body)[1]).trim(), 'Thu 19 Nov · 19:30 · in 5 min · open since 19:00');
});


test('team page: riders stay under the plans', async t => {
    const c = makeClub();
    const live = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    upload(c.club, 'rollers', {type: 'slow', riders: ROLLERS.slice(0, 6), at: T('2026-11-19T14:10:00Z'), live: false});
    const srv = await serve(t, c, {now: T('2026-11-19T17:55:00Z')});
    const before = await teamBody(srv, 'rollers');
    const plans = before.indexOf('Plans for Thu 19 Nov');
    const riders = before.indexOf('Riders on &#39;Rollers · fast&#39;');
    assert.ok(plans > 0 && riders > plans, `${plans} ${riders}`);
    assert.deepEqual(riderRows(before).find(r => r.name === 'Cleo'), {sev: 'plan', name: 'Cleo', text: '2 Cleo Pull 60 s', time: null});
    // after the gate: each rider's state, as before
    srv.clock.now = NOW;
    srv.see('1002', '2026-11-19T18:20:00Z', {sig: c.club.sheets[live].sig, mod: '0.3.0', sheet: live, inEvent: false, event: null});
    srv.clock.now = NOW;
    const after = await teamBody(srv, 'rollers');
    assert.ok(after.indexOf('Riders on &#39;Rollers · fast&#39;') > after.indexOf('Plans for Thu 19 Nov'));
    assert.deepEqual(riderRows(after).find(r => r.name === 'Cleo'), {sev: 'ok', name: 'Cleo', text: 'Cleo Has the plan', time: null});
    assert.ok(textOf(after).includes('1 of 8 riders have the plan'), textOf(after));
});


test('team page: after a switch only the LIVE mark moves', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ROLLERS.slice(0, 6), at: T('2026-11-19T14:10:00Z'), live: false});
    const srv = await serve(t, c);
    const order = page => [page.indexOf('<span class="label">Rollers · fast</span>'), page.indexOf('<span class="label">Rollers · slow</span>')];
    const liveRow = page => planRows(page).find(r => r.includes('<span class="tag">Live</span>'));
    const before = await teamBody(srv, 'rollers');
    const [f0, s0] = order(before);
    assert.ok(f0 > 0 && f0 < s0, `${f0} ${s0}`);
    assert.equal(rowLabel(liveRow(before)), 'Rollers · fast');
    const made = await followPost(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: slow, confirm: '1'});
    assert.equal(srv.store.get(CID).teams.rollers.live, slow);
    const [f1, s1] = order(made.page);
    assert.ok(f1 > 0 && f1 < s1, `${f1} ${s1}`);
    assert.equal(rowLabel(liveRow(made.page)), 'Rollers · slow');
    assert.equal(count(made.page, '<span class="tag">Live</span>'), 1);
});


test('make live always confirms', async t => {
    const c = makeClub();
    const fast = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ROLLERS.slice(0, 6), at: T('2026-11-19T14:10:00Z'), live: false});
    const srv = await serve(t, c);
    const body = await teamBody(srv, 'rollers');
    // every Make live form sits in an in-page confirm and carries confirm=1
    const forms = [...body.matchAll(/<form method="post" action="\/manage\/live">[\s\S]*?<\/form>/g)];
    assert.ok(forms.length >= 1, body);
    for (const m of forms) {
        const open = body.lastIndexOf('<details', m.index);
        assert.ok(body.startsWith('<details class="confirm', open), body.slice(open, m.index));
        assert.ok(!body.slice(open, m.index).includes('</details>'), 'inside that confirm');
        assert.ok(m[0].includes('<input type="hidden" name="confirm" value="1">'), m[0]);
    }
    const ask = element(planRows(body)[1], '<details class="confirm inline">');
    assert.ok(textOf(ask).includes('Make live… \'Rollers · slow\' Riders get \'Rollers · slow\' v1 at once instead of \'Rollers · fast\' v1.'), textOf(ask));
    assert.ok(ask.includes('<span class="sr"> &#39;Rollers · slow&#39;</span></summary>'), 'the label for screen readers');
    // the button sits below the summary, in the page
    assert.ok(ask.indexOf('</summary>') < ask.indexOf('<form'), ask);
    // a POST without confirm: the question, nothing changed
    const file = storedClub(srv);
    const res = await post(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: slow});
    assert.equal(res.status, 200, res.body);
    assert.ok(res.body.includes('<h1>Make &#39;Rollers · slow&#39; live?</h1>'), res.body);
    assert.ok(textOf(res.body).includes('Riders get \'Rollers · slow\' v1 at once instead of \'Rollers · fast\' v1.'), textOf(res.body));
    assert.ok(res.body.includes(`<input type="hidden" name="sheet" value="${slow}"><input type="hidden" name="confirm" value="1">`), res.body);
    assert.ok(!res.body.includes('http-equiv'));
    assert.equal(srv.store.get(CID).teams.rollers.live, fast);
    assert.equal(storedClub(srv), file);
    // with confirm: done
    const yes = await post(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: slow, confirm: '1'});
    assert.equal(yes.status, 303);
    assert.equal(srv.store.get(CID).teams.rollers.live, slow);
});


// A version of the plan `as` names with the type `type` (null keeps none), live or not.
function typedVersion(club, slug, as, riders, at, {type, live}) {
    return uploadSheet(club, {
        slug, json: planJson('Rollers fast', riders), text: null, base: club.teams[slug].version, via: 'file',
        as, live, pinnedEventId: null, type,
    }, {now: T(at), newId: () => randomId(6)}).id;
}


test('make v6 live confirms with the newer version\'s own label', async t => {
    const c = makeClub();
    const v1 = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    for (let i = 2; i <= 5; i++) {
        version(c.club, 'rollers', v1, i % 2 ? ROLLERS : ROLLERS.slice(1), `2026-11-19T14:0${i}:00Z`);
    }
    const v6 = typedVersion(c.club, 'rollers', v1, ROLLERS.slice(2), '2026-11-19T14:10:00Z', {type: 'A', live: false});
    assert.equal(c.club.sheets[v6].label, 'Rollers · A');
    const srv = await serve(t, c);
    const body = await teamBody(srv, 'rollers');
    const newer = element(body, '<div class="newer">');
    assert.ok(newer, body);
    const ask = element(newer, '<details class="confirm inline">');
    assert.ok(ask, newer);
    assert.ok(textOf(ask).includes('Riders get \'Rollers · A\' v6 at once instead of \'Rollers · fast\' v5.'), textOf(ask));
    assert.ok(ask.includes(`<input type="hidden" name="sheet" value="${v6}"><input type="hidden" name="confirm" value="1">`), ask);
});


test('back of the live plan always confirms; of another plan it does not', async t => {
    const c = makeClub();
    const v1 = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    version(c.club, 'rollers', v1, ROLLERS.slice(1), '2026-11-19T15:00:00Z');
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ['1009'], at: T('2026-11-19T14:30:00Z'), live: false});
    version(c.club, 'rollers', slow, ['1009', '1010'], '2026-11-19T14:40:00Z', {live: false});
    const srv = await serve(t, c);
    // the live row's Back: an in-page confirm with the effect in words
    const row = planRows(await teamBody(srv, 'rollers'))[0];
    const confirm = element(row, '<details class="confirm inline">');
    assert.ok(confirm, row);
    assert.ok(textOf(confirm).includes('Back to v1 · live at once… Riders get v1 at once instead of v2.'), textOf(confirm));
    assert.ok(confirm.includes('<input type="hidden" name="confirm" value="1">'), confirm);
    // without confirm: the confirm page, nothing changed
    const file = storedClub(srv);
    const fields = {team: 'rollers', plan: v1, n: '1', version: String(VERSION_OF(srv, 'rollers'))};
    const ask = await post(srv, c.cookie, '/manage/plan/back', fields);
    assert.equal(ask.status, 200, ask.body);
    assert.ok(textOf(ask.body).includes('Riders get v1 at once instead of v2.'), textOf(ask.body));
    assert.ok(ask.body.includes('<input type="hidden" name="confirm" value="1">'));
    assert.equal(storedClub(srv), file);
    // with confirm: done, and the flash names the version that was live
    const done = await followPost(srv, c.cookie, '/manage/plan/back', {...fields, confirm: '1'});
    assert.equal(done.location, '/manage/team/rollers');
    assert.deepEqual(done.flash, {kind: 'ok', text: 'Back to v1: \'Rollers · fast\' v3 is live (was v2).'});
    // a plan that is not live: no question, stored at once
    const other = await post(srv, c.cookie, '/manage/plan/back', {team: 'rollers', plan: slow, n: '1', version: String(VERSION_OF(srv, 'rollers'))});
    assert.equal(other.status, 303, other.body);
    const sheets = srv.store.get(CID).sheets;
    assert.ok(Object.values(sheets).some(s => s.plan === slow && s.n === 3 && s.copyOf === 1));
});


test('back with a newer version between offers that one', async t => {
    const c = makeClub();
    const v1 = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    for (let i = 2; i <= 5; i++) {
        version(c.club, 'rollers', v1, i % 2 ? ROLLERS : ROLLERS.slice(1), `2026-11-19T14:0${i}:00Z`);
    }
    version(c.club, 'rollers', v1, ROLLERS.slice(2), '2026-11-19T14:10:00Z', {live: false});
    const srv = await serve(t, c);
    const done = await followPost(srv, c.cookie, '/manage/plan/back', {team: 'rollers', plan: v1, n: '4', version: String(VERSION_OF(srv, 'rollers')), confirm: '1'});
    assert.deepEqual(done.flash, {kind: 'ok', text: 'Back to v4: \'Rollers · fast\' v7 is live (was v5).'});
    const club = srv.store.get(CID);
    assert.equal(club.sheets[club.teams.rollers.live].n, 7);
    const row = planRows(done.page)[0];
    assert.ok(textOf(row).includes('Back to v6 · live at once'), textOf(row));
    assert.ok(row.includes('<input type="hidden" name="n" value="6">'), row);
});


test('plan page has the former menu items', async t => {
    const c = makeClub();
    const fast = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, bench: ['1009'], at: T('2026-11-19T14:00:00Z'), pinned: 4567890});
    const fast2 = version(c.club, 'rollers', fast, ['1002', '1001', ...ROLLERS.slice(2)], '2026-11-19T15:00:00Z', {bench: ['1009']});
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ['1001', '1002', '1003'], at: T('2026-11-19T14:10:00Z'), live: false});
    upload(c.club, 'sprockets', {riders: ['1001', '1010'], at: T('2026-11-19T16:30:00Z')});
    const srv = await serve(t, c);
    const body = await pageBody(srv, `/manage/team/rollers/plan/${fast}`);
    const text = textOf(body);
    assert.ok(!body.includes('http-equiv'), 'it never reloads');
    assert.ok(!body.includes('data-refresh'));
    // the head: LIVE, open since the gate (riders get it from 19:00 before it), no Make live
    assert.ok(text.includes('LIVE · open since 19:00'), text);
    assert.ok(!body.includes('action="/manage/live"'));
    // the rider order of the newest version, then the versions, then the former menu items
    assert.ok(text.includes('Riders in v2'), text);
    const table = element(body, '<table class="ptable">');
    assert.deepEqual([...table.matchAll(/<td class="nmcol">([^<]*)<\/td>/g)].map(m => m[1]), ['Cleo', 'Ben', 'Dan', 'Eva', 'Finn', 'Gus', 'Hanna', 'Ida']);
    assert.ok(!text.includes('Jo'), 'the planner\'s roster is not shown');
    assert.ok(!/bench/i.test(text), text);
    assert.ok(body.includes(`<a class="rowlink" href="/manage/upload?team=rollers&amp;plan=${fast}&amp;from=plan">`), body);
    assert.ok(text.includes('New version'));
    assert.ok(text.includes('Race date: Thu 19 Nov'));
    const order = ['Riders in v2', '<li class="version">', 'New version', 'Race date: Thu 19 Nov'].map(s => body.indexOf(s));
    assert.deepEqual([...order].sort((a, b) => a - b), order, String(order));
    // the event link: Remove comes back here
    const unpin = /<form method="post" action="\/manage\/sheet\/unpin">[\s\S]*?<\/form>/.exec(body)?.[0];
    assert.ok(unpin, body);
    assert.ok(unpin.includes('<input type="hidden" name="back" value="plan">'), unpin);
    assert.ok(textOf(unpin).includes('Remove event link (4567890)'), textOf(unpin));
    // Delete plan behind its confirm, back to the team page
    const del = element(body, '<details class="confirm">');
    assert.ok(del, body);
    assert.ok(textOf(del).includes('Delete plan…'));
    assert.ok(textOf(del).includes('Deletes the plan with all its versions. Riders get nothing from Rollers until you make another plan live. This cannot be undone. '
        + 'Versions used in a ride recording stay with it for analysis (90 days by default).'), textOf(del));
    assert.ok(del.includes(`<form method="post" action="/manage/sheet/delete">${CLUB_FIELD}<input type="hidden" name="team" value="rollers"><input type="hidden" name="sheet" value="${fast2}">`), del);
    assert.ok(!del.includes('name="back"'));
    // the versions with Back (in a confirm: the plan is live) and a fold per version
    assert.equal(versionRows(body).length, 2);
    for (const row of versionRows(body)) {
        assert.equal(count(row, '<details class="fold">'), 1, row);
    }
    assert.ok(element(versionRows(body)[1], '<details class="confirm inline">'), versionRows(body)[1]);

    // a plan that is not live: Not live, its marks, Make live with back=plan; Delete without the live warning
    const other = await pageBody(srv, `/manage/team/rollers/plan/${slow}`);
    const otherText = textOf(other);
    assert.ok(otherText.includes('Not live'), otherText);
    assert.ok(otherText.includes('Outdated: Ben now rides Sprockets'), otherText);
    assert.ok(!other.includes('action="/manage/sheet/unpin"'), 'no link, no Remove');
    const make = element(other, '<details class="confirm inline">');
    assert.ok(make, other);
    assert.ok(textOf(make).includes('Riders get \'Rollers · slow\' v1 at once instead of \'Rollers · fast\' v2.'), textOf(make));
    assert.ok(make.includes(`<input type="hidden" name="sheet" value="${slow}"><input type="hidden" name="back" value="plan"><input type="hidden" name="confirm" value="1">`), make);
    assert.ok(textOf(element(other, '<details class="confirm">')).includes('Deletes the plan with all its versions. This cannot be undone.'));
    assert.ok(otherText.includes('Riders in v1'));

    // used up: the lists without buttons
    srv.clock.now = T('2026-11-26T12:00:00Z');
    const used = await pageBody(srv, `/manage/team/rollers/plan/${slow}`);
    for (const form of ['/manage/live', '/manage/sheet/unpin', '/manage/sheet/delete', '/manage/plan/back']) {
        assert.ok(!used.includes(`action="${form}"`), form);
    }
    assert.ok(!used.includes('/manage/upload?'), 'no New version');
});


test('unpin and make live from the plan page come back to it', async t => {
    const c = makeClub();
    upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ['1001', '1002'], at: T('2026-11-19T14:10:00Z'), live: false, pinned: 4567890});
    const srv = await serve(t, c);
    const unpin = await followPost(srv, c.cookie, '/manage/sheet/unpin', {team: 'rollers', sheet: slow, back: 'plan'});
    assert.equal(unpin.location, `/manage/team/rollers/plan/${slow}`);
    assert.deepEqual(unpin.flash, {kind: 'ok', text: 'Removed the event link of \'Rollers · slow\'.'});
    assert.ok(unpin.page.includes('<li class="version">'), 'the plan page');
    // the confirm page keeps the way back
    const ask = await post(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: slow, back: 'plan'});
    assert.equal(ask.status, 200);
    assert.ok(ask.body.includes('<input type="hidden" name="back" value="plan"><input type="hidden" name="confirm" value="1">'), ask.body);
    assert.ok(ask.body.includes(`href="/manage/team/rollers/plan/${slow}"`), ask.body);
    const live = await followPost(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: slow, back: 'plan', confirm: '1'});
    assert.equal(live.location, `/manage/team/rollers/plan/${slow}`);
    assert.equal(srv.store.get(CID).teams.rollers.live, slow);
    assert.ok(textOf(live.page).includes('LIVE · open since 19:00'));
    srv.clock.now = T('2026-11-19T17:30:00Z');
    assert.ok(textOf(await pageBody(srv, `/manage/team/rollers/plan/${slow}`)).includes('LIVE · riders get it from 19:00'), 'before the gate');
});


test('team settings: the event-link list matches its count', async t => {
    const c = makeClub();
    const v1 = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    const v2 = uploadSheet(c.club, {
        slug: 'rollers', json: planJson('Rollers fast', ROLLERS.slice(1)), text: null, base: c.club.teams.rollers.version, via: 'file',
        as: v1, live: false, pinnedEventId: 4567890,
    }, {now: T('2026-11-19T15:00:00Z'), newId: () => randomId(6)}).id;
    const srv = await serve(t, c);
    assert.equal(srv.store.get(CID).sheets[v1].pinnedEventId, null);
    const body = await pageBody(srv, '/manage/team/rollers/settings');
    const links = element(body, '<section class="card" aria-labelledby="link-h">');
    assert.equal(count(links, '<form method="post" action="/manage/sheet/unpin">'), 1, links);
    assert.ok(textOf(links).includes('Rollers · fast'), textOf(links));
    assert.ok(textOf(links).includes('Zwift event 4567890'), textOf(links));
    // Remove clears the link on every version
    const form = /<form method="post" action="\/manage\/sheet\/unpin">([\s\S]*?)<\/form>/.exec(links)[1];
    const sheet = /name="sheet" value="([a-z0-9]+)"/.exec(form)[1];
    await followPost(srv, c.cookie, '/manage/sheet/unpin', {team: 'rollers', sheet, back: 'team-settings'});
    const sheets = srv.store.get(CID).sheets;
    assert.equal(sheets[v1].pinnedEventId, null);
    assert.equal(sheets[v2].pinnedEventId, null);
    assert.ok(textOf(await pageBody(srv, '/manage/team/rollers/settings')).includes('No plan of Rollers has an event link.'));
    // a link on a plan that is raced: not in the list, not in the count
    srv.store.change(CID, x => {
        x.sheets[v1].pinnedEventId = 4567001;
    });
    srv.clock.now = T('2026-11-26T12:00:00Z');
    assert.ok(textOf(await pageBody(srv, '/manage/team/rollers/settings')).includes('No plan of Rollers has an event link.'));
});


test('plan page: a live plan whose newest version is not live', async t => {
    // fix round 1 (I-1, I-2): the head names the live version, the newer one has Make v4 live, the
    // riders say they are v4's, and the live version has no Back (it would only copy itself)
    const c = makeClub();
    const v1 = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    version(c.club, 'rollers', v1, ROLLERS.slice(1), '2026-11-19T14:30:00Z');
    const v3 = version(c.club, 'rollers', v1, ROLLERS.slice(2), '2026-11-19T15:05:00Z');
    const v4 = version(c.club, 'rollers', v1, ['1004', '1003', ...ROLLERS.slice(4)], '2026-11-19T15:40:00Z', {live: false});
    const srv = await serve(t, c);
    const path = `/manage/team/rollers/plan/${v1}`;
    const body = await pageBody(srv, path);
    const head = element(body, '<section class="card planhead stack">');
    assert.ok(textOf(head).includes('LIVE v3 · open since 19:00'), textOf(head));
    const newer = element(head, '<div class="newer">');
    assert.ok(newer, head);
    assert.ok(textOf(newer).includes('v4 · 16:40 is newer, not live'), textOf(newer));
    const ask = element(newer, '<details class="confirm inline">');
    assert.ok(textOf(ask).includes('Make v4 live… Riders get \'Rollers · fast\' v4 at once instead of \'Rollers · fast\' v3.'), textOf(ask));
    assert.ok(ask.includes(`<form method="post" action="/manage/live">${CLUB_FIELD}<input type="hidden" name="team" value="rollers"><input type="hidden" name="sheet" value="${v4}">`
        + '<input type="hidden" name="back" value="plan"><input type="hidden" name="confirm" value="1">'), ask);
    // the riders: v4's order, marked as not live
    assert.ok(textOf(body).includes('Riders in v4 · not live'), textOf(body));
    const names = [...element(body, '<table class="ptable">').matchAll(/<td class="nmcol">([^<]*)<\/td>/g)].map(m => m[1]);
    assert.deepEqual(names.slice(0, 2), ['Eva', 'Dan']);
    // Back on v2 and v1 only: not on the newest (v4), not on the live one (v3)
    const rows = versionRows(body);
    const row = n => rows.find(r => metaOf(r).startsWith(`v${n} `));
    assert.ok(!row(3).includes('action="/manage/plan/back"'), row(3));
    assert.ok(!row(4).includes('action="/manage/plan/back"'));
    assert.ok(row(2).includes('action="/manage/plan/back"'));
    assert.ok(row(1).includes('action="/manage/plan/back"'));
    assert.ok(!body.includes('name="n" value="3"'));
    assert.ok(!textOf(body).includes('Back to v3'), 'no Back to the live version');
    // before the gate: riders get it from 19:00
    srv.clock.now = T('2026-11-19T17:30:00Z');
    assert.ok(textOf(await pageBody(srv, path)).includes('LIVE v3 · riders get it from 19:00'));
    srv.clock.now = NOW;
    // Make v4 live from here: back to this page; the head drops the n, the strip goes, v3 gets Back
    const made = await followPost(srv, c.cookie, '/manage/live', {team: 'rollers', sheet: v4, back: 'plan', confirm: '1'});
    assert.equal(made.location, `/manage/team/rollers/plan/${v1}`);
    const after = made.page;
    assert.ok(textOf(after).includes('LIVE · open since 19:00'), textOf(after));
    assert.ok(!after.includes('<div class="newer">'));
    assert.ok(textOf(after).includes('Riders in v4 '), textOf(after));
    assert.ok(!textOf(after).includes('not live'));
    assert.ok(after.includes('name="n" value="3"'), 'v3 is no longer live: Back to it');
    assert.equal(srv.store.get(CID).teams.rollers.live, v4);
    assert.notEqual(v3, v4);
});


test('plan page: no Back to a version with the plan code riders have (the newest, for a plan not live)', async t => {
    // final review (Task 11 minor): v3 live with v1's plan code; Back to v1 would store an identical v4
    const c = makeClub();
    const v1 = upload(c.club, 'rollers', {type: 'fast', riders: ROLLERS, at: T('2026-11-19T14:00:00Z')});
    version(c.club, 'rollers', v1, ROLLERS.slice(1), '2026-11-19T14:30:00Z');
    const v3 = version(c.club, 'rollers', v1, ROLLERS, '2026-11-19T15:05:00Z');
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ['1009'], at: T('2026-11-19T14:10:00Z'), live: false});
    version(c.club, 'rollers', slow, ['1009', '1008'], '2026-11-19T14:20:00Z', {live: false});
    const s3 = version(c.club, 'rollers', slow, ['1009'], '2026-11-19T14:40:00Z', {live: false});
    const srv = await serve(t, c);
    const club = srv.store.get(CID);
    assert.equal(club.teams.rollers.live, v3);
    assert.equal(club.sheets[v3].sig, club.sheets[v1].sig, 'v3 has v1\'s plan code');
    const rows = versionRows(await pageBody(srv, `/manage/team/rollers/plan/${v1}`));
    const row = n => rows.find(r => metaOf(r).startsWith(`v${n} `));
    assert.ok(!row(1).includes('action="/manage/plan/back"'), row(1));
    assert.ok(row(2).includes('action="/manage/plan/back"'), row(2));
    assert.ok(!row(3).includes('action="/manage/plan/back"'));
    // a plan that is not live: the newest version's plan code
    assert.equal(club.sheets[s3].sig, club.sheets[slow].sig);
    const off = versionRows(await pageBody(srv, `/manage/team/rollers/plan/${slow}`));
    const offRow = n => off.find(r => metaOf(r).startsWith(`v${n} `));
    assert.ok(!offRow(1).includes('action="/manage/plan/back"'), offRow(1));
    assert.ok(offRow(2).includes('action="/manage/plan/back"'), offRow(2));
});


test('team page: stored plans, none live', async t => {
    // fix round 1 (3): not the empty-team card
    const c = makeClub();
    const slow = upload(c.club, 'rollers', {type: 'slow', riders: ROLLERS.slice(0, 6), at: T('2026-11-19T14:10:00Z'), live: false});
    const srv = await serve(t, c);
    const body = await teamBody(srv, 'rollers');
    const text = textOf(body);
    assert.ok(text.includes('No plan is live for Rollers Make one of the plans below live, or upload another.'), text);
    assert.ok(!text.includes('No plan for Rollers yet'));
    assert.ok(body.indexOf('No plan is live for Rollers') < body.indexOf('class="card plans-card"'), 'above the plans');
    assert.ok(planRows(body)[0].includes(`<input type="hidden" name="sheet" value="${slow}">`));
    assert.match(body, /<a class="uplink" href="\/manage\/upload\?team=rollers">/);
    // a team without plans keeps the empty card with its button
    const sp = await teamBody(srv, 'sprockets');
    assert.ok(textOf(sp).includes('No plan for Sprockets yet'));
    assert.ok(!sp.includes('class="uplink"'));
});


// ---- special teams: the race rhythm at Add, the start time with each plan (user, 19 Nov 2026) ----

// The race rhythm's fieldset of a page, whole.
const rhythmOf = body => element(body, '<fieldset class="choices" data-rhythm>');


test('new team page: the race rhythm, weekly on the club\'s day by default, the same choices as the team settings', async t => {
    const c = kindsClub();
    const srv = await serve(t, c);
    const body = await pageBody(srv, '/manage/new-team');
    const form = teamForm(body, 'add');
    const rhythm = rhythmOf(form);
    assert.ok(rhythm, form);
    assert.ok(rhythm.includes('<legend>Race rhythm</legend>'), rhythm);
    assert.ok(rhythm.includes('<input type="radio" name="kind" value="weekly" checked>'), rhythm);
    assert.ok(rhythm.includes('<input type="radio" name="kind" value="special">'), rhythm);
    assert.ok(textOf(rhythm).includes('Every week on Thursday'));
    assert.ok(textOf(rhythm).includes('Special: date and start time come with each plan'));
    assert.ok(rhythm.includes('<option value="" selected>Same as the club (Thursday)</option>'), rhythm);
    // the start time belongs to the weekly choice: under it, before the special one
    const weekly = element(rhythm, '<div class="stack" data-weekly>');
    assert.ok(weekly.includes('<select name="weekday" aria-describedby="weekday-hint">'), weekly);
    assert.ok(weekly.includes('<input type="time" name="start" value="">'), weekly);
    assert.ok(textOf(weekly).includes('Start time In Europe/Berlin. You can set it later, but riders get nothing without one.'), textOf(weekly));
    assert.ok(rhythm.indexOf('value="weekly"') < rhythm.indexOf('data-weekly'));
    assert.ok(rhythm.indexOf('name="start"') < rhythm.indexOf('value="special"'));
    assert.equal(count(form, 'name="start"'), 1);
    // one builder: the team settings' rhythm is the same fieldset, without the start time and with
    // the card's heading instead of the legend
    const settings = rhythmOf(await pageBody(srv, '/manage/team/rollers/settings'));
    const same = rhythm.replace('<legend>', '<legend class="sr">').replace(/\n\s*<label class="field">Start time[\s\S]*?<\/label>/, '');
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
    // a form without the rhythm (a page from before): weekly on the club's day
    await add({name: 'Wheels', start: '19:45'});
    assert.deepEqual([team('wheels').kind, team('wheels').weekday, team('wheels').start], ['weekly', null, '19:45']);
    const teams = Object.keys(srv.store.get(CID).teams).length;
    for (const [fields, text, check] of [
        [{kind: 'monthly', weekday: '2', start: '20:00'}, 'Choose weekly or special.',
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


test('team settings: a special team has no start time card, a line instead', async t => {
    const c = kindsClub();
    const srv = await serve(t, c);
    const cogs = await pageBody(srv, '/manage/team/cogs/settings');
    assert.ok(!cogs.includes('<input type="hidden" name="action" value="start">'), 'no start time form');
    assert.ok(!cogs.includes('name="start"'));
    const card = element(cogs, '<section class="card" aria-labelledby="start-h">');
    assert.equal(textOf(card).trim(), 'Start time A special team gets its date and start time with each plan.');
    // in the start time's place: after the name, before the race rhythm
    assert.ok(cogs.indexOf('id="name-h"') < cogs.indexOf('id="start-h"') && cogs.indexOf('id="start-h"') < cogs.indexOf('id="kind-h"'));
    // made special, Rollers loses its card and keeps its stored start; made weekly again it has it back
    await followPost(srv, c.cookie, '/manage/team', {action: 'kind', team: 'rollers', kind: 'special', weekday: ''});
    const sp = await pageBody(srv, '/manage/team/rollers/settings');
    assert.ok(!sp.includes('name="start"'));
    assert.equal(srv.store.get(CID).teams.rollers.start, '19:30');
    await followPost(srv, c.cookie, '/manage/team', {action: 'kind', team: 'rollers', kind: 'weekly', weekday: ''});
    assert.ok(teamForm(await pageBody(srv, '/manage/team/rollers/settings'), 'start').includes('<input type="time" name="start" value="19:30">'));
});


// "What happens" of an assign page as its lines: [class, text].
const whatLines = body => [...element(body, '<section class="card" aria-labelledby="wh-h">').matchAll(/<li class="(\w+)">([\s\S]*?)<\/li>/g)]
    .map(m => [m[1], textOf(m[2]).trim()]);


test('assign page: a special team\'s plan needs its date and start time, at the top, and nothing red before they are typed', async t => {
    const c = kindsClub();
    c.club.teams.cogs.start = null;
    const srv = await serve(t, c);
    const id = await intake(srv, c.cookie, {team: 'cogs', json: planJson('Cogs', ['1009'])});
    const page = q => pageBody(srv, `/manage/inbox/${id}${q}`);
    const body = await page('');
    // both above the More fold, both required, both empty
    const when = element(body, '<div class="as-when">');
    assert.ok(when, body);
    assert.ok(when.includes('<input type="hidden" name="startFor" value="">'), when);
    assert.ok(when.includes('<input type="date" name="date" value="" required>'), when);
    assert.ok(when.includes('<input type="time" name="start" value="" required>'), when);
    assert.ok(body.indexOf('<div class="as-when">') < body.indexOf('<summary>More: event link</summary>'));
    assert.ok(textOf(body).includes('In Europe/Berlin. It is the race\'s: every plan of Cogs for that day starts then, and the newest upload sets it.'));
    assert.equal(count(body, 'name="start"'), 1);
    // nothing typed yet: a neutral line, no error (the coordinator, 19 Nov 2026)
    assert.deepEqual(whatLines(body), [['neutral', 'Choose the race date and start time.']]);
    // the Store button still says what it does
    assert.equal(textOf(element(body, '<button class="btn primary block" type="submit" data-submit>')).trim(), 'Store and make live');
    const q = '?team=cogs&as=new&drawn=cogs:new&live=on&type=&date=2026-11-29';
    assert.deepEqual(whatLines(await page(`${q}&startFor=&start=`)), [['neutral', 'Choose the start time.']]);
    // the time redraws the preview: the race line and the preview use it
    const filled = await page(`${q}&startFor=2026-11-29&start=20:15`);
    assert.ok(filled.includes('<input type="time" name="start" value="20:15" required>'), filled);
    assert.ok(textOf(filled).includes('Race Sun 29 Nov 20:15'), textOf(filled));
    assert.deepEqual(whatLines(filled)[0], ['ok', 'New plan \'Cogs\', live for Sun 29 Nov 20:15. Riders get it from Sun 29 Nov 19:45.']);
    // a value that is there but no time is an error
    assert.deepEqual(whatLines(await page(`${q}&startFor=2026-11-29&start=25:00`)), [['err', 'Enter the start time as HH:MM.']]);
    // Store without a time: refused, the form refilled, nothing stored
    const fields = {team: 'cogs', as: 'new', live: 'on', base: String(VERSION_OF(srv, 'cogs')), drawn: 'cogs:new', date: '2026-11-29', type: '', startFor: '2026-11-29'};
    const refused = await post(srv, c.cookie, `/manage/inbox/${id}`, {...fields, start: ''});
    assert.equal(refused.status, 400, refused.body);
    assert.deepEqual(flashOf(refused.body), {kind: 'err', text: 'Enter the start time as HH:MM.'});
    assert.ok(refused.body.includes('<input type="date" name="date" value="2026-11-29" required>'), refused.body);
    assert.equal(Object.keys(srv.store.get(CID).sheets).length, 0);
    // with a time: stored, the race starts then
    const stored = await post(srv, c.cookie, `/manage/inbox/${id}`, {...fields, start: '20:15'});
    assert.equal(stored.status, 200, stored.body);
    assert.ok(textOf(stored.body).includes('\'Cogs\' v1 is live for Sun 29 Nov 20:15.'), textOf(stored.body));
    assert.deepEqual(srv.store.get(CID).teams.cogs.raceStarts, {'2026-11-29': '20:15'});
    // a weekly team: no time field, and an emptied date is no error either
    const rid = await intake(srv, c.cookie, {team: 'rollers', json: planJson('Rollers', ROLLERS)});
    const rollers = await pageBody(srv, `/manage/inbox/${rid}?team=rollers&as=new&drawn=rollers:new&date=`);
    assert.ok(!rollers.includes('name="start"'));
    assert.deepEqual(whatLines(rollers), [['neutral', 'Choose the race date.']]);
});


test('assign page: the newest upload for a date sets its race\'s start; the result names the plans that move', async t => {
    const c = kindsClub();
    c.club.teams.cogs.start = null;
    const srv = await serve(t, c);
    const first = Object.keys(srv.store.get(CID).sheets).length;
    assert.equal(first, 0);
    const id = await intake(srv, c.cookie, {team: 'cogs', json: planJson('Cogs', ['1009'])});
    const base = () => String(VERSION_OF(srv, 'cogs'));
    assert.equal((await post(srv, c.cookie, `/manage/inbox/${id}`, {
        team: 'cogs', as: 'new', live: 'on', base: base(), drawn: 'cogs:new', date: '2026-11-29', type: '', start: '20:15', startFor: '2026-11-29',
    })).status, 200);
    const [plan] = Object.keys(srv.store.get(CID).sheets);
    // a new version: the plan's date fixed, the race's time at the top and editable
    const vid = await intake(srv, c.cookie, {team: 'cogs', json: planJson('Cogs', ['1009', '1008'])});
    const v = await pageBody(srv, `/manage/inbox/${vid}?team=cogs&as=${plan}&drawn=cogs:${plan}`);
    const when = element(v, '<div class="as-when">');
    assert.ok(textOf(when).includes('Race date Sun 29 Nov (the plan\'s date)'), textOf(when));
    assert.ok(when.includes('<input type="time" name="start" value="20:15" required>'), when);
    assert.ok(!v.includes('name="date"'), 'no date field for a version');
    // the mistyped time corrected: the preview says it, the race moves
    const moved = await pageBody(srv, `/manage/inbox/${vid}?team=cogs&as=${plan}&drawn=cogs:${plan}&startFor=2026-11-29&start=21:15`);
    assert.ok(whatLines(moved).some(([, text]) => text === 'Race on Sun 29 Nov now starts at 21:15 (was 20:15).'), JSON.stringify(whatLines(moved)));
    const v2 = await post(srv, c.cookie, `/manage/inbox/${vid}`, {
        team: 'cogs', as: plan, live: 'on', base: base(), drawn: `cogs:${plan}`, type: '', start: '21:15', startFor: '2026-11-29',
    });
    assert.equal(v2.status, 200, v2.body);
    assert.ok(textOf(v2.body).includes('Race on Sun 29 Nov now starts at 21:15 (was 20:15).'), textOf(v2.body));
    assert.deepEqual(srv.store.get(CID).teams.cogs.raceStarts, {'2026-11-29': '21:15'});
    // a second plan for 29 Nov: prefilled with the race's time; another one moves the race and names
    // the plan that moves with it; the copy never says to pick another date
    const sid = await intake(srv, c.cookie, {team: 'cogs', json: planJson('Cogs slow', ['1007'])});
    const s2 = await pageBody(srv, `/manage/inbox/${sid}?team=cogs&as=new&drawn=cogs:new&date=2026-11-29`);
    assert.ok(s2.includes('<input type="time" name="start" value="21:15" required>'), s2);
    const slow = await post(srv, c.cookie, `/manage/inbox/${sid}`, {
        team: 'cogs', as: 'new', live: '', base: base(), drawn: 'cogs:new', date: '2026-11-29', type: 'slow', start: '21:30', startFor: '2026-11-29',
    });
    assert.equal(slow.status, 200, slow.body);
    assert.ok(textOf(slow.body).includes('Race on Sun 29 Nov now starts at 21:30 (was 21:15). \'Cogs\' moves with it.'), textOf(slow.body));
    assert.ok(!textOf(slow.body).includes('another date'));
    assert.equal(srv.store.get(CID).teams.cogs.raceStarts['2026-11-29'], '21:30');
    // the plan page's head line has the race time; its hint says how the time is set
    const pp = await pageBody(srv, `/manage/team/cogs/plan/${plan}`);
    assert.ok(pp.includes('<h1>Cogs · Sun 29 Nov 21:30</h1>'), pp);
    assert.ok(textOf(pp).includes('the newest upload for that day sets the start time of every plan of that day'), textOf(pp));
});


test('team page: a special team\'s race stored by 0.3.0 without any start time, and its way out', async t => {
    const c = kindsClub();
    c.club.teams.cogs.kind = 'weekly';
    const id = upload(c.club, 'cogs', {riders: ['1009'], at: T('2026-11-19T10:00:00Z'), date: '2026-11-29'});
    c.club.teams.cogs.kind = 'special';
    c.club.teams.cogs.start = null;
    const srv = await serve(t, c);
    const body = await teamBody(srv, 'cogs');
    // still red, with the way out: an upload of the race's plan with the time
    const callout = element(body, '<section class="callout err"');
    assert.ok(callout, body);
    assert.ok(textOf(callout).includes('No start time: riders on this plan get nothing'), textOf(callout));
    assert.ok(textOf(callout).includes('The race on Sun 29 Nov has none, so its plan goes to nobody: upload a new version of it with the start time.'), textOf(callout));
    const href = /<a class="btn secondary small" href="([^"]*)">/.exec(callout)[1].replace(/&amp;/g, '&');
    assert.equal(href, `/manage/upload?team=cogs&plan=${id}`);
    assert.ok(!callout.includes('/settings'));
    assert.ok(!textOf(body).includes('null'), textOf(body));
    // that upload: a version (no type needed), the time empty; Store with a time sets it
    const vid = await intake(srv, c.cookie, {team: 'cogs', forPlan: id, json: planJson('Cogs', ['1009', '1008'])});
    const assign = await pageBody(srv, `/manage/inbox/${vid}`);
    assert.ok(assign.includes(`<input type="radio" name="as" value="${id}" checked>`), assign);
    assert.ok(assign.includes('<input type="time" name="start" value="" required>'), assign);
    const res = await post(srv, c.cookie, `/manage/inbox/${vid}`, {
        team: 'cogs', as: id, live: 'on', base: String(VERSION_OF(srv, 'cogs')), drawn: `cogs:${id}`, type: '', start: '20:00', startFor: '2026-11-29',
    });
    assert.equal(res.status, 200, res.body);
    assert.ok(textOf(res.body).includes('Race on Sun 29 Nov now starts at 20:00.'), textOf(res.body));
    const after = await teamBody(srv, 'cogs');
    assert.ok(!after.includes('<section class="callout err"'), after);
    assert.ok(textOf(/<p class="race">([\s\S]*?)<\/p>/.exec(after)[1]).includes('Sun 29 Nov · 20:00'), after);
    // not live: still red, with its day, never "null"
    srv.store.change(CID, cl => {
        delete cl.teams.cogs.raceStarts;
        cl.teams.cogs.live = null;
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
        text: 'Rollers: Special: date and start time come with each plan. Its plans keep their race times; new plans bring their own.'});
    assert.deepEqual((await kind('weekly')).flash, {kind: 'ok', text: 'Rollers: Every week on Thursday. Its plans now start at 19:30, the team\'s start time.'});
    // no change, no word
    assert.deepEqual((await kind('weekly')).flash, {kind: 'ok', text: 'Rollers: Every week on Thursday.'});
    await followPost(srv, c.cookie, '/manage/team', {action: 'start', team: 'rollers', start: ''});
    await kind('special');
    assert.deepEqual((await kind('weekly')).flash.text, 'Rollers: Every week on Thursday. It has no start time yet: its plans go to nobody until you set one.');
    // a team without plans: no word about them
    assert.deepEqual((await kind('special', 'sprockets')).flash, {kind: 'ok', text: 'Sprockets: Special: date and start time come with each plan.'});
});


test('assign page: a time drawn for another date never moves that date\'s race; an over time is refused', async t => {
    const c = kindsClub();
    c.club.teams.cogs.start = null;
    const srv = await serve(t, c);
    const base = () => String(VERSION_OF(srv, 'cogs'));
    const store = async (json, fields) => {
        const id = await intake(srv, c.cookie, {team: 'cogs', json});
        return {id, res: await post(srv, c.cookie, `/manage/inbox/${id}`, {team: 'cogs', as: 'new', live: '', base: base(), drawn: 'cogs:new', ...fields})};
    };
    assert.equal((await store(planJson('Cogs', ['1009']), {date: '2026-11-21', start: '20:15', startFor: '2026-11-21', type: 'a'})).res.status, 200);
    assert.equal((await store(planJson('Cogs', ['1008']), {date: '2026-11-29', start: '21:15', startFor: '2026-11-29', type: 'b'})).res.status, 200);
    const sheets = Object.keys(srv.store.get(CID).sheets).length;
    // drawn for 21 Nov at 20:15, the date changed to 29 Nov and stored without a redraw: nothing moves
    const {id, res} = await store(planJson('Cogs', ['1007']), {date: '2026-11-29', start: '20:15', startFor: '2026-11-21', type: 'c'});
    assert.equal(res.status, 400, res.body);
    assert.deepEqual(flashOf(res.body), {kind: 'err', text: 'Check the choices: the start time was for another date.'});
    assert.ok(res.body.includes('<input type="date" name="date" value="2026-11-29" required>'), res.body);
    assert.ok(res.body.includes('<input type="time" name="start" value="21:15" required>'), 'redrawn with that race\'s time');
    assert.equal(Object.keys(srv.store.get(CID).sheets).length, sheets);
    assert.deepEqual(srv.store.get(CID).teams.cogs.raceStarts, {'2026-11-21': '20:15', '2026-11-29': '21:15'});
    // posted again from the redrawn page: stored at the race's time
    const again = await post(srv, c.cookie, `/manage/inbox/${id}`, {team: 'cogs', as: 'new', live: '', base: base(), drawn: 'cogs:new',
        date: '2026-11-29', start: '21:15', startFor: '2026-11-29', type: 'c'});
    assert.equal(again.status, 200, again.body);
    // a fresh date has no race time to protect: a time drawn for another date is fine there
    assert.equal((await store(planJson('Cogs', ['1006']), {date: '2026-12-06', start: '20:15', startFor: '2026-11-21', type: 'd'})).res.status, 200);

    // today's race (19 Nov) at 20:15; at 19:25 Berlin a version typed 08:15 (an AM/PM slip) is refused,
    // also with the same content, and nothing moves
    const today = await store(planJson('Cogs', ['1005']), {date: '2026-11-19', start: '20:15', startFor: '2026-11-19', type: 'e'});
    assert.equal(today.res.status, 200);
    const plan = Object.entries(srv.store.get(CID).sheets).find(([, sh]) => sh.date === '2026-11-19')[0];
    for (const riders of [['1005', '1004'], ['1005']]) {
        const vid = await intake(srv, c.cookie, {team: 'cogs', json: planJson('Cogs', riders)});
        const over = await post(srv, c.cookie, `/manage/inbox/${vid}`, {team: 'cogs', as: plan, live: '', base: base(), drawn: `cogs:${plan}`,
            start: '08:15', startFor: '2026-11-19', type: 'e'});
        assert.equal(over.status, 400, over.body);
        assert.deepEqual(flashOf(over.body), {kind: 'err', text: 'The race on 2026-11-19 at 08:15 is over: check the start time, or choose a later date.'});
        assert.ok(over.body.includes('<input type="time" name="start" value="08:15" required>'), 'the form refilled');
    }
    assert.equal(srv.store.get(CID).teams.cogs.raceStarts['2026-11-19'], '20:15');
    assert.equal(Object.values(srv.store.get(CID).sheets).filter(sh => sh.date === '2026-11-19').length, 1);
});


test('assign page: the neutral line asks only for what is missing; other plans moving with the race is a warning', async t => {
    const c = kindsClub();
    c.club.teams.cogs.start = null;
    const srv = await serve(t, c);
    const id = await intake(srv, c.cookie, {team: 'cogs', json: planJson('Cogs', ['1009'])});
    const body = await pageBody(srv, `/manage/inbox/${id}?team=cogs&as=new&drawn=cogs:new&live=on&type=&date=&startFor=&start=20:15`);
    assert.ok(body.includes('<input type="time" name="start" value="20:15" required>'), body);
    assert.deepEqual(whatLines(body), [['neutral', 'Choose the race date.']]);
    // a race with two plans: moving it is a warning (the other plan moves too); a race with one plan
    // only, its own: info
    const base = () => String(VERSION_OF(srv, 'cogs'));
    const fields = {team: 'cogs', live: '', base: '', date: '2026-11-29', startFor: '2026-11-29'};
    assert.equal((await post(srv, c.cookie, `/manage/inbox/${id}`, {...fields, as: 'new', drawn: 'cogs:new', base: base(), start: '20:15', type: 'fast'})).status, 200);
    const [plan] = Object.keys(srv.store.get(CID).sheets);
    const vid = await intake(srv, c.cookie, {team: 'cogs', json: planJson('Cogs', ['1009', '1008'])});
    const own = await post(srv, c.cookie, `/manage/inbox/${vid}`, {...fields, as: plan, drawn: `cogs:${plan}`, base: base(), start: '20:45', type: 'fast'});
    assert.match(own.body, /<li class="info">[^]*?<span>Race on Sun 29 Nov now starts at 20:45 \(was 20:15\)\.<\/span><\/li>/);
    const sid = await intake(srv, c.cookie, {team: 'cogs', json: planJson('Cogs slow', ['1007'])});
    const slow = await post(srv, c.cookie, `/manage/inbox/${sid}`, {...fields, as: 'new', drawn: 'cogs:new', base: base(), start: '21:00', type: 'slow'});
    assert.match(slow.body, /<li class="warn">[^]*?<span>Race on Sun 29 Nov now starts at 21:00 \(was 20:45\)\. &#39;Cogs · fast&#39; moves with it\.<\/span><\/li>/);
});
