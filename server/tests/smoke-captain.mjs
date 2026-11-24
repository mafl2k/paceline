// Smoke test of the captain pages and their script (server/client.mjs) in headless Chrome, over CDP
// with Node 22's global WebSocket (no puppeteer). Not part of `npm run test:server`, but a required
// check before every push (plan versions spec decision 13: the captain pages run on the script).
// Without Chrome it cannot pass. Run it as
//     node server/tests/smoke-captain.mjs [--shots <dir>] [--data <dir>]
// (CHROME=<path to the Chrome binary> overrides the macOS default.)
// (--data puts the server's DATA_DIR and the fixtures in a new folder inside <dir>; by default they
// go to the system's temp folder, as Chrome's profile always does: Chrome cannot start with a long
// TMPDIR.) It starts a local
// server on 127.0.0.1 on a fixed clock (2026-11-19 18:12Z: Rollers' gate has passed, the team pages
// reload themselves) with made-up Kettenfett RC: Rollers 19:30 with its live plan "Rollers" and a
// second plan "Rollers · slow", Sprockets 19:30 with its live plan "Sprockets", Cogs without a start
// time. It signs Chrome in with the club cookie and checks:
//   1-2. the pages load without a CSP violation or an exception and run the script (the team page
//        also with a version picked); at 390 px nothing is wider than the screen and every control
//        is at least 44 px; so with the race's and a plan's ⋯ open on the team page, the panel
//        inside the screen; opening one ⋯ closes the other, Esc and a click outside close it;
//   1b.  the public pages (the start page without the club cookie, register, lost link, privacy, a
//        bad link) load the same way, without a script; with the cookie / goes to /manage;
//   1c.  two clubs in the cookie (Spokesmen CC as well): the overview's footer (390) and the
//        sidebar's (1280) offer Spokesmen CC, "Log out of Kettenfett RC" and "Log out of all clubs";
//        the button switches to that club, whose footer offers Kettenfett RC, which switches back;
//        Log out of the open club lands on the other club's overview;
//   1d.  the team page's "Plan on ZwiftGopher" (the primary button in its head, at full width at 390,
//        the bordered "Upload a file" under it; from 1024 px the title line holds the title, "Updated"
//        small and raised beside it and Team settings at its end, the pair side by side at the right,
//        under that line, from 1180 px on it before Team settings; in an empty team's card the main
//        button) opens the
//        planner in a new tab with the team's token, and the upload page has none; two plans pushed
//        with it (POST /api/v3/push) are listed on the team page under "Not stored yet", newest
//        first, and counted in the switcher and the sidebar (their Discard, 24 px from Store, is in
//        each one's card: 12d); the club hub lists Cogs to fix (given a plan without a start
//        time; without one it is neutral, spec §8) and the two plans waiting, with
//        the team tiles at 390 only; with --shots
//        captain-team-{empty,plans}-{390,1280}-light.png (Cogs, Rollers before the pushes),
//        captain-team-received-{390,1280}-light.png, captain-team-received-390-dark.png,
//        captain-teams-received-390-light.png and captain-hub-{390,1280}-light.png (full page);
//   3.   the upload page takes the JSON only (no text export field) and stays when the file is chosen
//        (no auto-Continue); Continue goes on to the team page with the plan picked (?e=<id>#panel),
//        whose Store form shows the moves and what is still to do, has no "Update preview" button,
//        and redraws in place (one panel request, no page load) when the plan radio changes, keeping
//        the scroll position, the focused field and a typed type (a new version has no type field: it
//        keeps its plan's type); it has no Make live box: its action bar has Make live (primary,
//        "Store and make live" for screen readers) and Store (quiet; user, 23 Nov 2026), and What
//        happens says what Make live does, then what Store alone does; the race date, the start time
//        and the event link are in a closed fold, the form's last block, its summary naming the race
//        ("Race: Thu 19 Nov · 19:30 · Change"), and a click on the summary opens it; a redraw keeps it
//        open (raceOpen, also for the next race again); a version has no race fold (it takes its
//        plan's race, user 23 Nov 2026); the race date typed digit
//        by digit redraws it once, a second after the last digit and never midway, or at once when
//        the captain leaves the field (only warning lines in the card, above its action bar: no "What
//        happens", user 23 Nov 2026); in the race
//        window with 'Rollers' live, Make live asks first in its place (the strip in the action bar,
//        its confirm focused and described) and its confirm (confirm=1) lands on the race's live
//        pointer (?r=), v2 live; at 1280 a
//        page below the hub has one breadcrumb line above its head instead of the back bar and the
//        kicker, its crumb before the page where the phone's bar goes (an upload page opened for a plan, as a hole's link or a link of the former New version
//        goes back to the team), the hub has none; (dropped with the assign page: its "What changed"
//        fold, the rider table shows what changed, 12h; the redraw as a GET of the page, 12h)
//   3b.  the reshuffle of spec §10: "Upload for Sprockets" in the Store flash carries the plan and its
//        race; no holes are left;
//   3e.  a refused Store (pressed right after typing a date in the race fold opened first: no redraw
//        races it; the form was drawn for another race, so it is drawn for that date, its race fold
//        open, the flash in view, the team page's URL in the address bar) keeps the typed type through the next redraw; a date as from the calendar
//        (its change, no key) redraws at once, and a click in the date field opens the calendar
//        (showPicker); an event link pasted and left redraws the form, its warnings naming the
//        race's new link; the race fold closed right after editing the link stays closed through
//        the redraw that leaving it sent; Store with a required field empty in the closed fold opens
//        it and posts nothing; Discard, on Store's line at least 24 px right of it, asks first in its place;
//   4.   the guarded reload waits while a strip is open (the panel's Make live, outside any ⋯);
//        a ⋯ closed by a click outside holds nothing: the page reloads after one with an armed
//        strip (a plan's Delete) and after one with a typed field; the date and time strip writes
//        the day and time;
//   5.   the stale line when offline;
//   3d.  Make live in the panel asks in its place first (the strip where the button was, the panel's
//        whole width at 390, the confirm button focused and described by the words), posts confirm=1,
//        and changes team.live only when pressed; every row of the list is its link alone (the newer
//        version's "v2 · not live" without a Make live beside it, user 23 Nov 2026), and that
//        version's card's Make live (it reads "Make live", the version for screen readers) asks and
//        posts the same way;
//   6.   Make live without the script: a second tab with script execution disabled opens the page
//        with a version picked, posts the panel's Make live (the strip stays hidden), gets the
//        server's confirm page, and confirms; team.live changes only then;
//   7.   Delete plan in the plan's ⋯ on the team page asks in its place first, its confirm in the
//        danger style.
//   7b.  the team settings' race day and time (user, 22 Nov 2026): one card with one form (the
//        weekday and the start time under the weekly choice); the weekly fields hide while special
//        is checked; an emptied weekly start time asks in place (S11), with special checked the
//        hidden start time asks nothing and Save posts at once.
//   9.   arm in place by keyboard and mouse (the panel's Make live, at 1280): Enter opens a strip,
//        Esc and Cancel close it (the focus back on the trigger), a press of the confirm button
//        within 450 ms of arming is ignored, one strip at a time (a plan ⋯'s Delete closes the
//        panel's), the Remove strip follows the Zwift ID edited after arming, a double click on a
//        confirm button posts once; before the gate the panel's plain Make live goes at once, the
//        page lands on the panel with its flash in view below the top bar and nothing of an Undo
//        (user, 23 Nov 2026), and Make live of the version live before takes it back; with --shots
//        the open strips of the team, team settings and club settings pages at 390 and 1280
//        (captain-<page>-armed-<w>-light.png) and the flash of the switch
//        (captain-team-switch-{390,1280}-light.png).
//   10.  the hub with nothing to do and nothing waiting (Spokesmen CC with one team and its live
//        plan) says so in one line; with --shots captain-hub-empty-{390,1280}-light.png;
//   11.  races (races spec §4, §7): Rollers gets a second race, Sun 22 Nov 18:00 with the event link
//        5123456 ('Rollers · sunday' live, 'Rollers · sunday B'), Sprockets a race of Wed 18 Nov
//        that is over (one plan, stored before it); all of it goes again at the end:
//   11a. the Rollers page shows #race-2026-11-19 and #race-2026-11-22, the later race without a fold
//        closed; at 390 px it fits and its controls are 44 px, also with the race's ⋯ and a plan's
//        ⋯ open;
//   11b. the race ⋯ closes on Esc (the focus back on its button) and on a click outside; while it
//        is open the guarded reload waits;
//   11c. "Save date and time…" in the Sunday race's ⋯ asks in its place, its words the date and
//        time typed (Sun 29 Nov 18:30); the confirm posts confirm=1, the page lands on
//        #race-2026-11-29 with the flash, and the store has the race there with both plans, its
//        live plan and its link;
//   11d. without the script (a second tab, as in 6) the same POST gets the server's question page,
//        and confirming there moves the race back;
//   11e. a plan ⋯'s Rename changes the block's label; the panel's Make live acts at once (the race's
//        gate is closed, nothing warns), and Thu 19 Nov keeps its own live plan; no Undo of it
//        anywhere: not on Sunday's live row, not in Sunday's card (a click on that row, ?r=), not
//        after a swap away (Thursday's row at 1280, the sheet's ✕ at 390), and no row holds a form;
//   11f. Sprockets' race of Wed 18 Nov is under "Over", without a race ⋯, its plan's ⋯ offers Delete
//        only and its version's panel is read only;
//   11g. the Store form of a plan pushed for Rollers, as a new plan, has the race radios first in its race fold (after the plans), the
//        nearest checked, its race fold closed; choosing the other race redraws it once, in place,
//        the fold then open, its summary "Race: Sun 22 Nov · 18:00 · Event 5123456 · Change";
//   11h. while that form (drawn with the Sunday race at 18:00) is open, a second tab moves the race
//        to 17:00; Store then stores nothing and redraws the form with 17:00 (final review I-2);
//   11i. that plan stored not live for a new race (Wed 25 Nov): the Store flash's red line "Not
//        live: riders get nothing" with Make live under it (spec §8);
//        with --shots captain-team-races-{390,1280}-light.png, captain-race-menu-390-light.png and
//        captain-plan-menu-390-light.png.
//   12.  the team page, the team cockpit (team cockpit spec §5, §8):
//   12a. /manage/team/rollers and …?v=<a version not live> load clean at 390 and 1280; at
//        1280 (there the breadcrumb aside from the 44 px rule, as on every 1280 page) one card, its
//        left edge right of .cp-list's right edge (two columns); after the gate and before it (the
//        clock at 17:40Z) a picked version's card replaces the live one (no second card, no states),
//        the live row saying "N/M have it" after the gate only; nothing picked, the live version's
//        card; at 390 with nothing picked that card follows the nearest race, before the rest of the
//        list, no sheet and no close link; after the gate it is the rider table with each rider's
//        state (a rider of the live version in the event with an older code: a long state): at 390 a
//        line under each rider's row, pull @ target in its column, the long one wrapping, no sideways
//        scroll; at 900 the fourth column (that rider's check is put back as it was right after).
//        Its fixture, made at the group's start and gone again at its end: Rollers' live plan gets a
//        second version stored not live, and a plan is pushed for Rollers;
//   12b. at 1280 a click on a version row swaps the panel in place (no page loads, one request with
//        panel=1): the URL ends ?v=<id>, #panel-body holds the rider table's caption, the row is
//        picked with aria-current; two rows clicked within 50 ms end on the second one, the URL, the
//        picked row and #panel's title naming the same version;
//   12c. before the gate Back draws the live version's card again (its row picked), Forward the
//        version; neither loads a page; at 1280 no close link shows: a click on the live row draws its
//        card at ?r=<race date> (the race's live pointer), the focus on #panel;
//   12k. after the team's version changed behind the page's back, a click on a row loads the whole
//        page (the fragment answers 409) with that row picked;
//   12r. a refused Store (a bad event link, answered at /manage/inbox/<id>) puts the cockpit's URL
//        in the address bar, and the form's next redraw asks the cockpit's panel, never /manage/inbox,
//        and draws the form in the card again, the entry's row its link alone;
//   12i. with a version picked the guarded reload loads the page again after one interval (35 s),
//        the URL still ?v=<id>; with the pushed plan picked (the Store form open in the card, its
//        Store button one of the form's elements) nothing loads in 35 s, and a click on the live row releases the
//        hold; a page loaded with ?e= has data-refresh and no meta refresh, and after a swap to a
//        version it reloads within 35 s;
//   12d. at 390 (with the script) a tap on a version row changes no page and the document shows only
//        the sheet: #panel and #panel-body (the top bar, the page's head and .cp-list have no
//        height); the close link is at least 44 x 44 px, a ✕ without words, and, tapped, brings the
//        list back (the live row marked) without a page load, the focus on the row that was picked; a
//        tap on a plan not stored yet opens the same sheet (the list gone, user 23 Nov 2026): from the
//        top the close link, the table, the Store form's first field, for "New plan" its race fold
//        (the form's last block; a version has none), its warnings (when any), Store, and Discard on Store's
//        line 24 px or more from it; nothing wider than the screen, every control 44 px, also with
//        the race fold open;
//   12e. the same without the script (a second tab as in 6): a tap on a version row loads
//        ?v=<id> and shows the same sheet, the close link is a plain link to the page without a
//        selection, a tap on the plan not stored yet loads ?e=<id> with its sheet, fit holds for both;
//   12p. phones, the sheet in use (375 x 560, the list scrolled): a tap on the plan not stored yet
//        opens the Store sheet with its first form line below the sticky head, as the tap left the
//        page; the close link and Back (history.back) bring the list back at its scroll place with
//        the tapped row in view, also from a version; a version stored on an earlier day (a title
//        of two lines at 390, 375 and 360 px) and the plan not stored yet keep the close link at the
//        right of the title, at the top; the stale line shows in the sheet while the rest of the
//        page's head does not.
//   12j. at 1280 after the gate, a version picked: its card alone in the right column, without
//        states; the live row says "n/N have it", the live card's "n of N have the plan" (N the live
//        version's riders);
//   12s. layout stability at 1280 (team cockpit spec §5.3b): the card's left, top and width, its table
//        header's distance from its top and its action bar's from its bottom are the same (within
//        1 px) for the live version, a version, a received plan and a version whose caption takes two
//        lines (another plan of the race); the race head is one line; the list keeps its height and
//        every row its place whatever is picked (the Store form is in the card, user 23 Nov 2026);
//        opening the Store form's race fold (in the card) moves neither the card's top nor the list;
//   12f. Make live from the panel with a version picked in place (the script, no page load): it asks
//        in its place (the confirm button focused, described by the words), the live version
//        unchanged; the confirm posts confirm=1 with the club, version and sheet fields (no from), the
//        page lands on ?r=<race>#panel (the race's live pointer) with the flash "… is live for Rollers." in the panel and
//        no Undo, the version live, not refused as out of date;
//   12g. the same without the script (a second tab): the button posts, the answer is the server's
//        confirm page (the live version unchanged), and confirming there lands on ?r=<race>#panel with
//        the version live;
//   12h. a plan not stored yet picked at 1280: the Store form in the card in the right column, under
//        the rider table and above its warnings; choosing another plan radio sends one panel request, loads no page, and the form is drawn for it; Store lands on ?v=<new id> with the result on the page, the version
//        in the store and the entry gone, its Make live the primary button; nothing reloads in 35 s
//        while the result (with a warning: the plan has no pull watts) is on the page, which says so
//        under the card with Refresh (44 px), and Refresh loads it again without the result,
//        nothing holding the reload;
//   12n. a received plan stored without the script (a second tab): a plan chosen by hand is not
//        redrawn there, so the first Store is refused (the page drawn with the choice), the second
//        lands on ?v=<new id> with the result, the version stored, the entry gone;
//        the group puts the live version back and removes the versions it stored; with --shots
//        captain-cockpit-{390,1280}-light.png, captain-cockpit-390-dark.png,
//        captain-cockpit-version-{390,1280}-light.png, captain-cockpit-store-{390,1280}-light.png,
//        captain-cockpit-live-armed-390-light.png (the strip open at 390) and
//        captain-cockpit-result-1280-light.png (the Store result).
//   8.   (with --shots) a special team's Store form: date and time side by side, a neutral line while
//        they are empty, the date and then the time redraw the preview, Make live (at once: nothing
//        is live in that race) sets the race's start,
//        a version has no date or time field (it takes its plan's race); Add a team hides the weekly fields while
//        special is checked.
// Each check prints `ok …` or `FAIL …`; any FAIL exits 1. With --shots it saves
// captain-teams-390-{light,dark}.png, captain-team-390-{light,dark}.png (the first screen, taken
// before the run changes anything: Rollers' live plan is the mod's demo plan),
// captain-team-settings-390-{light,dark}.png, captain-team-cogs-390-light.png (Cogs, no start
// time), a special team's settings (captain-team-settings-special-{390,1280}-light.png) and Add a
// team with special checked (captain-new-team-special-390-light.png), and every captain page at
// 1280 (full page, so the desktop frames can be laid side by side) and those not named yet at 390,
// and the team page with its switcher open, captain-team-switch-390-light.png:
// captain-<page>-{390,1280}-light.png for teams (1280 only), team (1280 only), team-cogs (1280
// only), team-settings (1280 only), club-settings, new-team, upload, team-gone, entry-gone,
// not-found (an unknown /manage path), privacy (signed in: its back bar), live-confirm and
// delete-confirm (the no-script questions) and code (the new rider code, shot last: it makes the
// club private); the overview of a browser with two clubs (the footer's club switch),
// captain-teams-two-{390,1280}-light.png (full page); and of the public pages
// public-home-{390-light,390-dark,1280-light}.png (without the club cookie: with it / goes to
// /manage) and public-register-….png (full page).
//
// The club cookie is `__Host-pl_club` (Secure). The script first checks whether Chrome sends a
// Secure cookie to http://127.0.0.1 (a potentially trustworthy origin); only if it does not, it
// starts Chrome again with --unsafely-treat-insecure-origin-as-secure=<base> and says so. Checked
// 17 Nov 2026 with Chrome on macOS: Chrome sends it, the flag is not needed.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startServer, fakeMailer, planJson, T, CODE_SECRET, RIDERS} from './helpers.mjs';
import {sampleJson, samplePlan} from '../../pages/src/engine/demoplan.mjs';
import {CID, makeClub, secondClub, upload} from './manage-helpers.mjs';
import {uploadSheet, makeLive, addTeam, addEntry, discardEntry, deleteTeam, deleteSheet, receiveEntry, setRace, setRaceEvent} from '../club.mjs';
import {randomId} from '../ids.mjs';
import {racesOf} from '../races.mjs';

// The riders of the mod's demo (pages/src/engine/demoplan.mjs), so the README's pictures of the mod and
// of the plan server show the same team (user, 24 Nov 2026). Only in this run: the unit tests keep
// their short names, and no check here reads a name.
Object.assign(RIDERS, {
    '1001': 'Alma Keller', '1002': 'Ben Richter', '1003': 'Cleo Maier', '1004': 'Dana Lorenz',
    '1005': 'Eli Sommer', '1006': 'Finn Weber', '1007': 'Gina Hoff', '1008': 'Hugo Brandt', '1009': 'Ida Wolf',
});

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const NOW = T('2026-11-19T18:12:00Z');
const shotsAt = process.argv.indexOf('--shots');
const shotsDir = shotsAt > 0 ? path.resolve(process.argv[shotsAt + 1] || '.') : null;
const dataAt = process.argv.indexOf('--data');
const dataRoot = dataAt > 0 ? path.resolve(process.argv[dataAt + 1] || '.') : os.tmpdir();
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const report = (good, what, detail = '') => {
    if (!good) {
        failed++;
    }
    console.log(`${good ? 'ok' : 'FAIL'} ${what}${detail ? ` (${detail})` : ''}`);
};

if (!fs.existsSync(CHROME)) {
    console.log(`FAIL Chrome not found at ${CHROME}: the smoke test cannot run`);
    process.exit(1);
}

// ---- the club: three teams; Rollers with two plans of its race, Sprockets with one; riders seen ----
const c = makeClub({teams: [['Rollers', '19:30'], ['Sprockets', '19:30'], ['Cogs', null]]});
// Rollers' live plan is the mod's demo plan (its pulls and watts, without its bench), so the plan
// server's pictures show the plan code of the mod's demo pictures (user, 24 Nov 2026)
const rollersLive = upload(c.club, 'rollers', {type: 'fast', json: {...sampleJson(), team: {name: 'Rollers fast'}, roster: {}}, at: T('2026-11-18T20:00:00Z')});
const rollersSlow = upload(c.club, 'rollers', {type: 'slow', riders: ['1001', '1002', '1003', '1004', '1005', '1006'], at: T('2026-11-18T20:02:00Z'), live: false});
const sprocketsLive = upload(c.club, 'sprockets', {riders: ['1007', '1008', '1009'], at: T('2026-11-18T20:05:00Z')});
const fastPlan = c.club.sheets[rollersLive].plan;
const slowPlan = c.club.sheets[rollersSlow].plan;
const clock = {now: NOW};
// startServer makes its DATA_DIR in os.tmpdir(), which reads TMPDIR
fs.mkdirSync(dataRoot, {recursive: true});
const tmpdir = process.env.TMPDIR;
process.env.TMPDIR = dataRoot;
// with a mailer and a PUBLIC_URL, so registration is open (the register page shows its form); with
// a CODE_SECRET, so a club can be made private (the rider code page)
const srv = await startServer({clock, mailer: fakeMailer(), env: {PUBLIC_URL: 'https://paceline.example.org', SMTP_HOST: 'smtp.example.org',
    MAIL_FROM: 'Paceline <paceline@example.org>', CODE_SECRET}});
if (tmpdir === undefined) {
    delete process.env.TMPDIR;
} else {
    process.env.TMPDIR = tmpdir;
}
console.log(`note: the server's data is in ${srv.dataDir}`);
srv.store.create(c.club);
// a second club of the same browser (1c): no teams
const c2 = secondClub();
srv.store.create(c2.club);
const token2 = c2.cookie.slice(c2.cookie.indexOf('=') + 1);
const see = (aid, at, entry) => {
    clock.now = T(at);
    srv.store.see(CID, aid, entry);
    clock.now = NOW;
};
const rSig = c.club.sheets[rollersLive].sig;
report(rSig === samplePlan().sig, 'Rollers\' live plan has the plan code of the mod\'s demo plan', `${rSig} / ${samplePlan().sig}`);
for (const aid of ['1001', '1002', '1003', '1004']) {
    see(aid, '2026-11-19T18:05:00Z', {sig: rSig, mod: '0.3.0', sheet: rollersLive, inEvent: true, event: 4567001});
}
see('1005', '2026-11-19T16:30:00Z', {sig: 'ABC123', mod: '0.3.0', sheet: rollersLive, inEvent: false, event: null});
see('1007', '2026-11-19T18:08:00Z', {sig: c.club.sheets[sprocketsLive].sig, mod: '0.3.0', sheet: sprocketsLive, inEvent: true, event: 4567002});
const base = srv.base;
const token = c.cookie.slice(c.cookie.indexOf('=') + 1);
const club = () => srv.store.get(CID);
// the live id of the team's earliest race that has one (every race here has its own; these teams
// race once in this test), else null
const liveOf = slug => racesOf(club(), slug).map(([, r]) => r.live).find(id => id !== null) ?? null;
// the newest stored version of a plan: [id, version]
const newestOf = plan => Object.entries(club().sheets).filter(([, s]) => s.plan === plan).sort(([, a], [, b]) => b.n - a.n)[0];

// the made-up uploads of the reshuffle (spec §10): Rollers takes Hanna from Sprockets and drops Ben;
// Sprockets takes Ben
const tmp = fs.mkdtempSync(path.join(dataRoot, 'paceline-smoke-'));
const rollersFile = path.join(tmp, 'rollers-v2.json');
fs.writeFileSync(rollersFile, JSON.stringify(planJson('Rollers', ['1002', '1003', '1004', '1005', '1007'], ['1006'])));
// a plan whose planner name matches no plan: with two plans in the race nothing is preselected
const tempoFile = path.join(tmp, 'rollers-tempo.json');
fs.writeFileSync(tempoFile, JSON.stringify(planJson('Rollers tempo', ['1002', '1003', '1004'])));
const sprocketsFile = path.join(tmp, 'sprockets-v2.json');
fs.writeFileSync(sprocketsFile, JSON.stringify(planJson('Sprockets', ['1001', '1008', '1009'])));


// ---- Chrome over CDP ----
// One tab: its CDP commands, events, the page's log and exceptions, and the POSTs it sent.
async function connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
        ws.onopen = res;
        ws.onerror = rej;
    });
    let id = 0;
    const pending = new Map();
    const waiters = [];
    const logs = [];
    const posts = [];
    const navs = {count: 0};
    ws.onmessage = ev => {
        const m = JSON.parse(ev.data);
        if (m.id && pending.has(m.id)) {
            pending.get(m.id)(m);
            pending.delete(m.id);
            return;
        }
        if (m.method === 'Runtime.exceptionThrown') {
            logs.push(`exception: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`.slice(0, 300));
        } else if (m.method === 'Log.entryAdded') {
            const e = m.params.entry;
            if (!/favicon\.ico/.test(e.url || '') && !/favicon\.ico/.test(e.text)) {
                logs.push(`${e.level} ${e.source}: ${e.text} ${e.url || ''}`.slice(0, 300));
            }
        } else if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) {
            navs.count++;
        } else if (m.method === 'Network.requestWillBeSent' && m.params.request.method === 'POST') {
            posts.push({url: m.params.request.url.slice(base.length), body: m.params.request.postData ?? ''});
        }
        for (const w of waiters.splice(0)) {
            if (w.method === m.method) {
                w.resolve(m);
            } else {
                waiters.push(w);
            }
        }
    };
    const send = (method, params = {}) => new Promise(res => {
        const i = ++id;
        pending.set(i, res);
        ws.send(JSON.stringify({id: i, method, params}));
    });
    const once = (method, ms = 10000) => new Promise(resolve => {
        const w = {method, resolve};
        waiters.push(w);
        setTimeout(() => resolve(null), ms);
    });
    const evaluate = async expr => {
        const r = await send('Runtime.evaluate', {expression: expr, returnByValue: true, awaitPromise: true});
        if (r.result?.exceptionDetails) {
            throw new Error(`evaluate: ${r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text}`);
        }
        return r.result?.result?.value;
    };
    for (const d of ['Page', 'Runtime', 'Log', 'Network', 'DOM']) {
        await send(`${d}.enable`);
    }
    // CSP violations as the page sees them (a CDP script is not bound by the page's CSP)
    await send('Page.addScriptToEvaluateOnNewDocument', {source:
        'window.__csp = []; document.addEventListener("securitypolicyviolation", e => window.__csp.push(e.violatedDirective + " " + e.blockedURI));'});
    return {send, once, evaluate, logs, posts, navs, close: () => ws.close()};
}

const profiles = [];
async function launch(extra = []) {
    const port = 9390 + Math.floor(Math.random() * 500);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'paceline-chrome-'));
    profiles.push(profile);
    const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
        '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', ...extra, 'about:blank'], {stdio: 'ignore'});
    let tab = null;
    for (let i = 0; i < 80 && !tab; i++) {
        try {
            const pg = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page');
            if (pg) {
                tab = await connect(pg.webSocketDebuggerUrl);
            }
        } catch {
            tab = null;
            await sleep(250);
        }
    }
    if (!tab) {
        proc.kill();
        throw new Error('Chrome did not open its debugging port');
    }
    const set = await tab.send('Network.setCookie', {name: '__Host-pl_club', value: token, url: base, secure: true, path: '/', httpOnly: true, sameSite: 'Lax'});
    // a second tab of the same browser (it shares the cookie)
    const newTab = async () => connect((await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {method: 'PUT'})).json()).webSocketDebuggerUrl);
    const close = async () => {
        tab.close();
        proc.kill();
        await sleep(400);
    };
    return {tab, newTab, close, cookieSet: !set.error};
}

let chrome = await launch();
let tab = chrome.tab;
async function open(p, {w = 390, h = 844, scheme = 'light', on = tab} = {}) {
    await on.send('Emulation.setDeviceMetricsOverride', {width: w, height: h, deviceScaleFactor: 2, mobile: w < 600});
    await on.send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-color-scheme', value: scheme}]});
    const loaded = on.once('Page.loadEventFired');
    await on.send('Page.navigate', {url: base + p});
    await loaded;
    await sleep(250);
}
// a full-page shot of the page as it is (no reload: also the answer to a POST) at width `w`, then
// back to 390 x 844
async function shootNow(name, w = 390) {
    await tab.send('Emulation.setDeviceMetricsOverride', {width: w, height: 844, deviceScaleFactor: 2, mobile: w < 600});
    await sleep(300);
    const h = await tab.evaluate('Math.ceil(document.documentElement.scrollHeight)');
    await tab.send('Emulation.setDeviceMetricsOverride', {width: w, height: h, deviceScaleFactor: Math.min(2, 7990 / h), mobile: w < 600});
    await sleep(300);
    const r = await tab.send('Page.captureScreenshot', {format: 'png'});
    fs.mkdirSync(shotsDir, {recursive: true});
    fs.writeFileSync(path.join(shotsDir, name), Buffer.from(r.result.data, 'base64'));
    console.log(`wrote ${path.join(shotsDir, name)} ${w}x${h}`);
    await tab.send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 2, mobile: true});
    await sleep(300);
}
// a shot of the viewport as it is (an open strip in view), at the current width
async function shootView(name) {
    const r = await tab.send('Page.captureScreenshot', {format: 'png'});
    fs.mkdirSync(shotsDir, {recursive: true});
    fs.writeFileSync(path.join(shotsDir, name), Buffer.from(r.result.data, 'base64'));
    console.log(`wrote ${path.join(shotsDir, name)}`);
}
// run `action` (an expression in the page) and wait for the page it leads to
async function follow(action, on = tab) {
    const loaded = on.once('Page.loadEventFired');
    await on.evaluate(action);
    const got = await loaded;
    await sleep(250);
    return got !== null;
}
// the upload page: choose the file (the page stays: no auto-Continue), then press Continue; true
// when choosing the file left the page where it was
async function chooseAndContinue(file) {
    const doc = await tab.send('DOM.getDocument');
    const q = await tab.send('DOM.querySelector', {nodeId: doc.result.root.nodeId, selector: 'input[name=json]'});
    const at = await pathOf();
    const navs0 = tab.navs.count;
    await tab.send('DOM.setFileInputFiles', {nodeId: q.result.nodeId, files: [file]});
    await sleep(600);
    const stayed = tab.navs.count === navs0 && await pathOf() === at;
    await follow('document.querySelector("form[data-upload] button[type=submit]").click()');
    return stayed;
}
const signedIn = () => tab.evaluate('document.querySelector(\'a[href="/manage/team/rollers"]\') !== null');
const pageText = (on = tab) => on.evaluate('document.body.innerText');
const pathOf = async (on = tab) => (await on.evaluate('location.pathname + location.search'));
// the club cookie off and on again (the start page without and with a club)
const signOut = () => tab.send('Network.deleteCookies', {name: '__Host-pl_club', url: base});
const signIn = (value = token) => tab.send('Network.setCookie', {name: '__Host-pl_club', value, url: base, secure: true, path: '/', httpOnly: true, sameSite: 'Lax'});
// both clubs, Kettenfett RC the active one (the cookie's tokens joined by '.', as the server sets it)
const signInTwo = () => signIn(`${token}.${token2}`);

await open('/manage');
if (!chrome.cookieSet || !await signedIn()) {
    console.log(`note: Chrome did not send the Secure cookie to ${base}; again with --unsafely-treat-insecure-origin-as-secure`);
    await chrome.close();
    chrome = await launch([`--unsafely-treat-insecure-origin-as-secure=${base}`]);
    tab = chrome.tab;
    await open('/manage');
}
report(await signedIn(), 'signed in with the __Host- cookie');

// The order of a date field's parts follows the system's locale (not --lang, not
// Emulation.setLocaleOverride): typed 01, 02, 2030 in a scratch tab it reads 1 Feb or 2 Jan.
const dayFirst = await (async () => {
    const scratch = await chrome.newTab();
    const loaded = scratch.once('Page.loadEventFired');
    await scratch.send('Page.navigate', {url: 'data:text/html,<input type=date id=f>'});
    await loaded;
    await scratch.evaluate('f.focus()');
    for (const d of '01022030') {
        const key = {key: d, code: `Digit${d}`, windowsVirtualKeyCode: 48 + Number(d)};
        await scratch.send('Input.dispatchKeyEvent', {type: 'keyDown', text: d, ...key});
        await scratch.send('Input.dispatchKeyEvent', {type: 'keyUp', ...key});
    }
    const value = await scratch.evaluate('f.value');
    await scratch.send('Page.close');
    scratch.close();
    return value === '2030-02-01';
})();
await tab.send('Page.bringToFront');

// the page here runs its script, loads clean, fits 390 px, and its controls are 44 px
const fitOf = (skip = '') => `JSON.stringify((() => {
  const small = [];
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  for (const el of document.querySelectorAll('a,button,summary,input:not([type=hidden]),select,label.choice')) {
    // .prose: links inside a sentence of running text (WCAG 2.5.8 inline exception)
    if (el.closest('.sr,.vh,.skip${skip}') || el.matches('.prose a') || !vis(el)) continue;
    const r = el.matches('input[type=radio],input[type=checkbox]') ? el.closest('label').getBoundingClientRect() : el.getBoundingClientRect();
    if (r.height < 43.5 || r.width < 43.5) small.push((el.textContent.trim() || el.name || el.tagName).slice(0, 28) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  }
  return {sw: document.documentElement.scrollWidth, iw: innerWidth, small};
})())`;
const fit = fitOf();
// `wide` (a check at 1280, the cockpit's): the breadcrumb, the desktop frame's own line on every
// captain page (32 px, a pointer's), is left out of the 44 px rule; the width check is the window's
async function clean(p, {wide = false} = {}) {
    const js = await tab.evaluate('document.documentElement.classList.contains("js")');
    const csp = await tab.evaluate('window.__csp');
    report(js && !csp.length && !tab.logs.length, `${p} loads clean and runs the script`,
        [js ? '' : 'no html.js', ...csp.map(v => `CSP ${v}`), ...tab.logs].filter(Boolean).join('; '));
    const f = JSON.parse(await tab.evaluate(wide ? fitOf(',nav.crumbs') : fit));
    report(f.sw <= f.iw, `${p} fits ${wide ? 'the window' : '390 px'}`, `scrollWidth ${f.sw}, innerWidth ${f.iw}`);
    report(!f.small.length, `${p} tap targets >= 44 px${wide ? ' (the breadcrumb aside)' : ''}`, f.small.join(' | '));
}

// Arm in place (UI panel wave 2): an action that asks first, its form found by `pick` (a predicate on
// the form[data-arm], in the page). The mouse at the middle of a rect {x, y, width, height}.
const ARM = pick => `[...document.querySelectorAll('form[data-arm]')].find(${pick})`;
// a part of the armed form `f` (an expression in the page): inside it, or outside it and its own
// (the Store form's Make live, its confirm and its strip in the action bar: form="<id>", data-for="<id>")
const PART = (f, sel) => `(${f}.querySelector('${sel}') ?? [...document.querySelectorAll('${sel}')].find(e => e.form === ${f} || (${f}.id !== '' && e.dataset.for === ${f}.id)))`;
async function clickAt(r, on = tab) {
    for (const type of ['mousePressed', 'mouseReleased']) {
        await on.send('Input.dispatchMouseEvent', {type, x: r.x + r.width / 2, y: r.y + r.height / 2, button: 'left', clickCount: 1});
    }
}
// the rect of the element `sel` (an expression in the page), scrolled into view first (`center`) or not
const rectOf = async (sel, center = true) => JSON.parse(await tab.evaluate(`JSON.stringify((() => { const el = ${sel};
  ${center ? 'el.scrollIntoView({block: "center"});' : ''} const r = el.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height, pageY: r.y + scrollY}; })())`));
const strip = pick => `JSON.stringify((() => {
  const f = ${ARM(pick)}, st = ${PART('f', '[data-arm-strip]')}, yes = ${PART('f', '[data-arm-yes]')};
  const words = document.getElementById(yes.getAttribute('aria-describedby'));
  const s = st.getBoundingClientRect(), b = yes.getBoundingClientRect();
  return {open: !st.hidden && f.classList.contains('armed'), top: s.top + scrollY, inView: b.height > 0 && b.bottom <= innerHeight && b.top >= 0,
    focused: document.activeElement === yes, described: Boolean(words) && st.contains(words) && words.textContent.trim().length > 0,
    group: st.getAttribute('role') === 'group' && (st.getAttribute('aria-label') ?? '').startsWith('Confirm: '),
    triggerGone: ${PART('f', '[data-arm-open]')}.getClientRects().length === 0,
    others: document.querySelectorAll('form[data-arm].armed').length - (f.classList.contains('armed') ? 1 : 0),
    button: yes.textContent.trim(), width: Math.round(s.width),
    row: (box => Math.round(box.clientWidth - parseFloat(getComputedStyle(box).paddingLeft) - parseFloat(getComputedStyle(box).paddingRight)))(f.contains(st) ? f.parentElement : st.parentElement)};
})())`;
// open the ⋯ menu (races spec §4) that holds the form `pick` with the mouse on its summary; nothing
// when the form is in none, or its menu is open already
async function openMenuOf(pick) {
    if (await tab.evaluate(`Boolean(${ARM(pick)}?.closest('details[data-menu]:not([open])'))`)) {
        await clickAt(await rectOf(`${ARM(pick)}.closest('details[data-menu]').querySelector('summary')`));
        await sleep(150);
    }
}
// press the trigger with the mouse (its ⋯ opened first, openMenuOf) and wait past the 450 ms guard:
// the strip's state ({open, inPlace (it opened where the trigger was), inView, focused, described,
// group, triggerGone, others, button})
async function openConfirm(pick, {wait = 500} = {}) {
    await openMenuOf(pick);
    const t = await rectOf(PART(ARM(pick), '[data-arm-open]'));
    await clickAt(t);
    await sleep(wait);
    const st = JSON.parse(await tab.evaluate(strip(pick)));
    // in the page, not the viewport: the confirm button may scroll into view
    return {...st, inPlace: Math.abs(st.top - t.pageY) < 90};
}
// press the open strip's confirm button with the mouse: the POST it sent (url, body) and whether a
// page followed
async function pressConfirm(pick) {
    tab.posts.length = 0;
    const r = await rectOf(PART(ARM(pick), '[data-arm-yes]'), false);
    const loaded = tab.once('Page.loadEventFired', 4000);
    await clickAt(r);
    const got = await loaded;
    await sleep(250);
    return {loaded: got !== null, post: tab.posts.at(-1) ?? null};
}
const key = async (k, code, vk, text = undefined) => {
    for (const type of ['keyDown', 'keyUp']) {
        await tab.send('Input.dispatchKeyEvent', {type, key: k, code, windowsVirtualKeyCode: vk, ...(type === 'keyDown' && text ? {text} : {})});
    }
};
const flash = () => tab.evaluate('document.querySelector(".flash p")?.textContent ?? ""');
// a public page: loads clean without a script, fits 390 px, its controls are 44 px; `status` the
// page's own answer (a bad link's 404 is logged by Chrome)
async function cleanPublic(p, status = 200) {
    const scripts = await tab.evaluate('document.scripts.length');
    const csp = await tab.evaluate('window.__csp');
    const logs = tab.logs.filter(l => !(status === 404 && l.includes('status of 404') && l.includes(base + p)));
    report(scripts === 0 && !csp.length && !logs.length, `${p} loads clean without a script`,
        [scripts ? `${scripts} script(s)` : '', ...csp.map(v => `CSP ${v}`), ...logs].filter(Boolean).join('; '));
    const f = JSON.parse(await tab.evaluate(fit));
    report(f.sw <= f.iw, `${p} fits 390 px`, `scrollWidth ${f.sw}, innerWidth ${f.iw}`);
    report(!f.small.length, `${p} tap targets >= 44 px`, f.small.join(' | '));
}

// A screenshot of page p at width w into shotsDir (full: the whole page)
const shoot = async (name, p, w, scheme, full) => {
    await open(p, {w, scheme});
    let h = 844;
    if (full) {
        h = await tab.evaluate('Math.ceil(document.documentElement.scrollHeight)');
        await tab.send('Emulation.setDeviceMetricsOverride', {width: w, height: h, deviceScaleFactor: Math.min(2, 7990 / h), mobile: w < 600});
        await sleep(300);
    }
    const r = await tab.send('Page.captureScreenshot', {format: 'png'});
    fs.writeFileSync(path.join(shotsDir, name), Buffer.from(r.result.data, 'base64'));
    console.log(`wrote ${path.join(shotsDir, name)} ${w}x${h}`);
};


try {
    // ---- the first screens, before anything changes: Rollers' live plan is still v1, the mod's
    // demo plan, so its plan code is the one on the mod's pictures (user, 24 Nov 2026) ----
    if (shotsDir) {
        for (const scheme of ['light', 'dark']) {
            await shoot(`captain-teams-390-${scheme}.png`, '/manage', 390, scheme, false);
            await shoot(`captain-team-390-${scheme}.png`, '/manage/team/rollers', 390, scheme, false);
            await shoot(`captain-team-settings-390-${scheme}.png`, '/manage/team/rollers/settings', 390, scheme, true);
        }
    }

    // ---- 1 and 2: the pages load clean, run the script, fit 390 px ----
    for (const p of ['/manage', '/manage/team/rollers', '/manage/team/cogs', '/manage/settings', '/manage/upload?team=rollers',
        `/manage/team/rollers?v=${rollersSlow}`]) {
        tab.logs.length = 0;
        await open(p);
        await clean(p);
    }

    // ---- 1-2: the ⋯ menus at 390 (races spec §4): open, each control 44 px, the panel inside the
    // screen; one open at a time (the lower one first: an open panel covers what is under it); Esc
    // and a click outside close it ----
    const panelIn = `JSON.stringify([...document.querySelectorAll('details[data-menu][open] .menu-panel')].map(p => { const r = p.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; }))`;
    const openMenus = 'JSON.stringify([...document.querySelectorAll("details[data-menu][open]")].map(d => d.id))';
    const summaryOf = id => `document.getElementById(${JSON.stringify(id)}).querySelector('summary')`;
    for (const [p, ids] of [['/manage/team/rollers', [`menu-plan-${slowPlan}`, 'menu-race-2026-11-19']]]) {
        tab.logs.length = 0;
        await open(p);
        for (const id of ids) {
            await clickAt(await rectOf(summaryOf(id)));
            await sleep(150);
            report(JSON.parse(await tab.evaluate(openMenus)).join() === id, `${p}: ${id} opens, the other ⋯ closes`, await tab.evaluate(openMenus));
            const f = JSON.parse(await tab.evaluate(fit));
            const [[left, right] = [-1, -1]] = JSON.parse(await tab.evaluate(panelIn));
            report(f.sw <= f.iw && left >= 0 && right <= f.iw, `${p}: ${id}'s panel inside 390 px`, `left ${left}, right ${right}, scrollWidth ${f.sw}`);
            report(!f.small.length, `${p}: ${id}'s controls >= 44 px`, f.small.join(' | '));
            // no upload link in either ⋯ (user, 23 Nov 2026: no New version, no "Upload a file for this race")
            report(await tab.evaluate(`!document.getElementById(${JSON.stringify(id)}).querySelector('a[href*="/manage/upload"]')`), `${p}: ${id} has no upload link`);
        }
        const last = ids.at(-1);
        await key('Escape', 'Escape', 27);
        await sleep(100);
        report(JSON.parse(await tab.evaluate(openMenus)).length === 0 && await tab.evaluate(`document.activeElement === ${summaryOf(last)}`), `${p}: Esc closes the ⋯, the focus back on it`);
        await clickAt(await rectOf(summaryOf(last)));
        await sleep(150);
        await clickAt({x: 5, y: 400, width: 1, height: 1});
        await sleep(150);
        report(JSON.parse(await tab.evaluate(openMenus)).length === 0, `${p}: a click outside closes the ⋯`);
        report(!tab.logs.length, `${p}: the ⋯ without errors`, tab.logs.join('; '));
    }
    // the panels open in the page flow: with a ⋯ open, the next ⋯ button is not covered (the hit
    // test at its centre is the button), at both widths
    for (const w of [390, 1280]) {
        await open('/manage/team/rollers', {w});
        const ids = JSON.parse(await tab.evaluate('JSON.stringify([...document.querySelectorAll("details[data-menu]")].map(d => d.id))'));
        const covered = [];
        for (let i = 0; i + 1 < ids.length; i++) {
            await clickAt(await rectOf(summaryOf(ids[i])));
            await sleep(150);
            const r = await rectOf(summaryOf(ids[i + 1]));
            const hit = await tab.evaluate(`(() => { const e = document.elementFromPoint(${r.x + r.width / 2}, ${r.y + r.height / 2}); return Boolean(e) && ${summaryOf(ids[i + 1])}.contains(e); })()`);
            if (!hit || !await tab.evaluate(`document.getElementById(${JSON.stringify(ids[i])}).open`)) {
                covered.push(`${ids[i]} → ${ids[i + 1]}`);
            }
            await key('Escape', 'Escape', 27);
            await sleep(100);
        }
        report(ids.length >= 3 && !covered.length, `at ${w} an open ⋯ never covers the next ⋯ button (${ids.length} menus)`, covered.join(' | '));
    }

    // ---- 1b: the public pages ----
    for (const p of ['/register', '/lost', '/privacy', '/m/AAAAAAAAAAAAAAAAAAAAAA']) {
        tab.logs.length = 0;
        await open(p);
        await cleanPublic(p, p.startsWith('/m/') ? 404 : 200);
        if (p === '/register') {
            report(await tab.evaluate('document.querySelector("form[action=\'/register\'] input[name=riders]") !== null'), 'registration is open: the form');
        }
    }
    // with the club cookie / goes to the club's overview
    await open('/');
    report(await pathOf() === '/manage' && await signedIn(), 'with the cookie / opens the club', await pathOf());
    await signOut();
    tab.logs.length = 0;
    await open('/');
    await cleanPublic('/ (no cookie)');
    report(await pathOf() === '/' && (await pageText()).includes('Register a club') && !(await pageText()).includes('Open '),
        'the start page without the cookie: Register a club, no club', await pathOf());
    await signIn();
    await open('/manage');
    report(await signedIn(), 'signed in again');

    // ---- 1c: two clubs in one browser ----
    // the texts of the visible footer's links and buttons
    const footItems = `JSON.stringify([...document.querySelectorAll('footer.foot')].filter(f => f.getClientRects().length)
      .flatMap(f => [...f.querySelectorAll('a, button')].map(b => b.textContent.trim())))`;
    const visibleSwitch = 'document.querySelectorAll("footer.foot")].filter(f => f.getClientRects().length)[0].querySelector("form[action=\'/switch\'] [type=submit]")';
    await signInTwo();
    tab.logs.length = 0;
    await open('/');
    report(await pathOf() === '/manage' && await signedIn(), 'two clubs: / opens the active one, Kettenfett RC', await pathOf());
    await clean('/manage (two clubs)');
    const want = JSON.stringify(['Spokesmen CC', 'Privacy', 'Log out of Kettenfett RC', 'Log out of all clubs']);
    let items = await tab.evaluate(footItems);
    report(items === want, 'at 390 the overview\'s footer: the other club, Privacy, Log out of the club, of all', items);
    await open('/manage', {w: 1280});
    items = await tab.evaluate(footItems);
    report(items === want && await tab.evaluate('document.querySelector("aside.side footer.foot").getClientRects().length > 0'),
        'at 1280 the sidebar\'s footer has the same', items);
    await open('/manage/team/rollers', {w: 1280});
    items = await tab.evaluate(footItems);
    report(items === want, 'at 1280 the team page\'s sidebar too', items);
    await open('/manage');
    tab.posts.length = 0;
    await follow(`[...${visibleSwitch}.click()`);
    const switched = await tab.evaluate('document.querySelector("h1")?.textContent ?? ""');
    report(tab.posts.at(-1)?.url === '/switch' && await pathOf() === '/manage' && switched === 'Spokesmen CC',
        'the footer\'s button switches to Spokesmen CC', `${JSON.stringify(tab.posts.at(-1))} ${await pathOf()} ${switched}`);
    tab.logs.length = 0;
    await clean('/manage (Spokesmen CC)');
    items = await tab.evaluate(footItems);
    report(items === JSON.stringify(['Kettenfett RC', 'Privacy', 'Log out of Spokesmen CC', 'Log out of all clubs']), 'Spokesmen CC\'s footer offers Kettenfett RC', items);
    await follow(`[...${visibleSwitch}.click()`);
    report(await pathOf() === '/manage' && await signedIn(), 'switched back to Kettenfett RC', await pathOf());
    // Log out of the open club: / and on to the other club's overview
    await follow('[...document.querySelectorAll("footer.foot")].filter(f => f.getClientRects().length)[0].querySelector("form[action=\'/manage/logout\'] [type=submit]").click()');
    const after = await tab.evaluate('document.querySelector("h1")?.textContent ?? ""');
    report(await pathOf() === '/manage' && after === 'Spokesmen CC', 'Log out of Kettenfett RC lands on Spokesmen CC\'s overview', `${await pathOf()} ${after}`);
    await signIn();
    await open('/manage');
    report(await signedIn(), 'one club again');

    // ---- 1d: the ZwiftGopher push: the team page's link; two plans pushed with it are listed on the
    // team page (newest first) and counted in the rows; they are discarded again afterwards ----
    {
        const planner = sel => `JSON.stringify((a => a && {href: a.href, target: a.target, rel: a.rel})(document.querySelector('${sel} a[href^="https://zwiftgopher.com/"]')))`;
        await open('/manage/team/rollers');
        const link = JSON.parse(await tab.evaluate(planner('header .headacts')));
        report(link !== null && link.href.startsWith('https://zwiftgopher.com/TTT/?paceline=') && link.href.endsWith('&plhost=paceline.example.org')
            && link.target === '_blank' && link.rel === 'noopener noreferrer', 'the team page links to ZwiftGopher in a new tab, in its head', JSON.stringify(link));
        // the head's ways to a plan (races spec §4): "Plan on ZwiftGopher" the primary button and
        // "Upload a file" a secondary (bordered) one (user, 23 Nov 2026); on a phone side by side under
        // the title when they fit, else the primary at full width and Upload a file under it (user, 23
        // Nov 2026; no rhythm line: each race's line is in its own block below the head); from 1024 px
        // the title line holds the title, "Updated" small and raised beside it and Team settings at its
        // end, and the pair stands side by side, right-aligned under the title line below 1180 px; from
        // 1180 px the head's pair gives way to its copy at the list's top, left in the row under the
        // title line (user, 23 Nov 2026: one action row)
        const headActs = `JSON.stringify((() => {
          const row = document.querySelector('header .headacts'), [a, b] = row.querySelectorAll('a.btn'), race = document.querySelector('header .teamhead');
          const head = document.querySelector('header.pagehead').getBoundingClientRect(), h1 = document.querySelector('header.pagehead h1').getBoundingClientRect();
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(), rr = row.getBoundingClientRect();
          return {primary: a.matches('.btn.primary'), secondary: b.matches('.btn.secondary') && b.getAttribute('href') === '/manage/upload?team=rollers',
            below: rb.top >= ra.bottom - 0.5, left: Math.abs(rb.left - ra.left) < 1, full: Math.round(ra.width) === Math.round(rr.width),
            under: ra.top >= race.getBoundingClientRect().bottom, beside: Math.abs(rb.top - ra.top) < 1 && rb.left > ra.right && rb.left - ra.right <= 12,
            end: Math.round(head.right - rb.right), titleRow: Math.abs((ra.top + ra.bottom) / 2 - (h1.top + h1.bottom) / 2) <= 4,
            set: (st => ({end: Math.round(head.right - st.right), row: Math.abs((st.top + st.bottom) / 2 - (h1.top + h1.bottom) / 2) <= 4, after: st.left >= rb.right}))(race.querySelector('.btn').getBoundingClientRect()),
            fresh: (f => ({beside: f.left > h1.right && f.left - h1.right <= 16, raised: f.top >= h1.top - 2 && f.bottom < (h1.top + h1.bottom) / 2 + 4, size: parseFloat(getComputedStyle(document.querySelector('header .fresh')).fontSize)}))(document.querySelector('header .fresh').getBoundingClientRect()),
            words: a.innerText.trim(), name: a.getAttribute('aria-label'), upload: b.innerText.trim(),
            heights: [Math.round(ra.height), Math.round(rb.height)]};
        })())`;
        const phoneHead = JSON.parse(await tab.evaluate(headActs));
        report(phoneHead.primary && phoneHead.secondary && phoneHead.under && phoneHead.words === 'Plan on ZwiftGopher'
            && phoneHead.name === 'Plan on ZwiftGopher (opens a new tab)' && phoneHead.upload === 'Upload a file' && phoneHead.heights.every(h => h >= 44)
            && (phoneHead.beside || (phoneHead.below && phoneHead.left && phoneHead.full)),
            `at 390 Plan on ZwiftGopher and the bordered Upload a file under the title, ${phoneHead.beside ? 'side by side' : 'too wide for one line: the primary at full width, Upload a file under it'}`, JSON.stringify(phoneHead));
        await open('/manage/team/rollers', {w: 1024});
        const deskHead = JSON.parse(await tab.evaluate(headActs));
        report(deskHead.primary && deskHead.secondary && deskHead.beside && !deskHead.full && deskHead.words === 'Plan on ZwiftGopher' && deskHead.heights.every(h => h >= 44)
            && deskHead.set.row && Math.abs(deskHead.set.end) <= 1 && deskHead.fresh.beside && deskHead.fresh.raised && deskHead.fresh.size < 14
            && !deskHead.titleRow && Math.abs(deskHead.end) <= 1,
            'at 1024 the title line: the title, Updated small and raised beside it, Team settings at its end; Plan on ZwiftGopher and Upload a file side by side right-aligned under it', JSON.stringify(deskHead));
        await open('/manage/team/rollers', {w: 1280});
        const wideHead = JSON.parse(await tab.evaluate(`JSON.stringify((() => {
          const h1 = document.querySelector('header.pagehead h1').getBoundingClientRect(), head = document.querySelector('header.pagehead').getBoundingClientRect();
          const st = document.querySelector('header .teamhead .btn').getBoundingClientRect(), f = document.querySelector('header .fresh').getBoundingClientRect();
          const ways = document.querySelector('.cp-ways .headacts'), [a, b] = ways ? ways.querySelectorAll('a.btn') : [], ra = a?.getBoundingClientRect(), rb = b?.getBoundingClientRect();
          return {headWays: document.querySelector('header .headacts').getBoundingClientRect().height,
            set: {end: Math.round(head.right - st.right), row: Math.abs((st.top + st.bottom) / 2 - (h1.top + h1.bottom) / 2) <= 4},
            fresh: {beside: f.left > h1.right && f.left - h1.right <= 16, raised: f.top >= h1.top - 2 && f.bottom < (h1.top + h1.bottom) / 2 + 4},
            ways: ra ? {primary: a.matches('.btn.primary'), upload: b.innerText.trim(), left: Math.round(ra.left - h1.left), under: ra.top >= h1.bottom, beside: Math.abs(rb.top - ra.top) < 1 && rb.left > ra.right && rb.left - ra.right <= 12,
              heights: [Math.round(ra.height), Math.round(rb.height)]} : null};
        })())`));
        report(wideHead.headWays === 0 && wideHead.set.row && Math.abs(wideHead.set.end) <= 1 && wideHead.fresh.beside && wideHead.fresh.raised
            && wideHead.ways?.primary && wideHead.ways.upload === 'Upload a file' && Math.abs(wideHead.ways.left) <= 1 && wideHead.ways.under && wideHead.ways.beside && wideHead.ways.heights.every(h => h >= 44),
            'at 1280 the title line: the title, Updated small and raised beside it, Team settings at its end; under it at the left Plan on ZwiftGopher and Upload a file side by side (the head\'s pair hidden)', JSON.stringify(wideHead));
        // the stale line (what the script shows when the page cannot be refreshed) stays readable: a
        // line of its own under the head's rows, as wide as the head
        const staleAt = JSON.parse(await tab.evaluate(`JSON.stringify((() => {
          const s = document.querySelector('header [data-stale]'), head = document.querySelector('header.pagehead').getBoundingClientRect();
          s.hidden = false;
          const r = s.getBoundingClientRect(), rows = [...document.querySelectorAll('header h1, header .headacts, header .teamhead .btn')].map(e => e.getBoundingClientRect().bottom);
          const out = {shown: r.height > 0, width: Math.round(r.width) === Math.round(head.width), under: r.top >= Math.max(...rows) - 0.5, text: s.innerText.length > 0};
          s.hidden = true;
          return out;
        })())`));
        report(staleAt.shown && staleAt.width && staleAt.under && staleAt.text, 'at 1280 the stale line is a line of its own under the head, as wide as it', JSON.stringify(staleAt));
        report(await tab.evaluate('document.querySelectorAll(".uplinks, .uplink").length === 0'), 'no links under the plans any more');
        await open('/manage/team/rollers');
        await open('/manage/team/cogs');
        const empty = JSON.parse(await tab.evaluate(planner('.card.empty')));
        const emptyWays = await tab.evaluate('[...document.querySelectorAll(".card.empty a.btn")].map(a => `${a.className}: ${a.innerText.trim()}`).join(" | ")');
        await open('/manage/upload?team=rollers');
        const onUpload = await tab.evaluate('document.querySelectorAll(\'a[href^="https://zwiftgopher.com/"]\').length');
        report(empty !== null && empty.href.includes('?paceline=') && onUpload === 0
            && emptyWays === 'btn primary block: Plan on ZwiftGopher | btn secondary small: Upload a file',
        'an empty team\'s card has it as its main button, Upload a file after it; the upload page has none', JSON.stringify({empty, emptyWays, onUpload}));
        if (shotsDir) {
            for (const w of [390, 1280]) {
                await open('/manage/team/cogs', {w});
                await shootNow(`captain-team-empty-${w}-light.png`, w);
                await open('/manage/team/rollers', {w});
                await shootNow(`captain-team-plans-${w}-light.png`, w);
            }
        }
        const token = new URL(link.href).searchParams.get('paceline');
        const statuses = [];
        for (const [name, riders] of [['Rollers fast', ['1001', '1002', '1003', '1004', '1005', '1006']], ['Rollers slow', ['1001', '1002', '1003', '1004']]]) {
            const res = await fetch(`${base}/api/v3/push?paceline=${token}`, {method: 'POST',
                headers: {'content-type': 'application/json', origin: 'https://zwiftgopher.com'}, body: JSON.stringify(planJson(name, riders))});
            statuses.push(res.status);
        }
        tab.logs.length = 0;
        await open('/manage/team/rollers');
        await clean('/manage/team/rollers (2 received plans)');
        // under "Not stored yet" in the list (team cockpit spec §5.2; their Discard is in each one's
        // Store form, 24 px below Store: 12d)
        const rows = JSON.parse(await tab.evaluate('JSON.stringify([...document.querySelectorAll(".cp-pending .cp-row .cp-what")].map(p => p.textContent))'));
        const marks = await tab.evaluate('[...document.querySelectorAll(".newplans")].filter(x => x.textContent === "2 new plans").length');
        report(String(statuses) === '201,201' && rows.join('|') === 'Received 19:12 · \'Rollers slow\' · 4 riders|Received 19:12 · \'Rollers fast\' · 6 riders' && marks === 2,
            'two pushed plans: listed newest first, counted in the switcher and sidebar', JSON.stringify({statuses, rows, marks}));
        if (shotsDir) {
            for (const w of [390, 1280]) {
                await open('/manage/team/rollers', {w});
                await shootNow(`captain-team-received-${w}-light.png`, w);
            }
            await open('/manage/team/rollers', {scheme: 'dark'});
            await shootNow('captain-team-received-390-dark.png');
            await open('/manage');
            await shootNow('captain-teams-received-390-light.png');
        }
        // the club hub (UI panel wave 3): what to fix and the two plans waiting, with Review and store
        // and Discard; from 1024 px no team tiles (the sidebar has them). Cogs (no start time) gets a
        // plan, not live, for this: without one a missing start time is neutral (spec §8); with it the
        // red "No start time" is to fix. The plan goes again below.
        const cogsPlan = srv.store.change(CID, cl => upload(cl, 'cogs', {riders: ['1010'], at: T('2026-11-19T17:00:00Z'), live: false}));
        const hub = `JSON.stringify((() => {
          const lines = id => [...(document.getElementById(id)?.closest('section').querySelectorAll('.todo > li') ?? [])].map(li => li.innerText.replace(/\\s+/g, ' ').trim());
          const tiles = document.querySelector('.hub-teams');
          return {todo: lines('todo-h'), recv: lines('recv-h'), races: [...document.querySelectorAll('.racetable')].length, tiles: tiles.getClientRects().length > 0,
            add: document.querySelector('a.hub-add').getClientRects().length > 0};
        })())`;
        for (const w of [390, 1280]) {
            await open('/manage', {w});
            const h = JSON.parse(await tab.evaluate(hub));
            report(h.todo.length === 1 && h.todo[0].startsWith('Cogs') && h.todo[0].includes('No start time and no live plan') && h.recv.length === 2
                && h.recv.every(x => x.startsWith('Rollers Received') && x.includes('Review and store')) && h.races === 1 && h.tiles === (w === 390) && h.add,
            `at ${w} the hub: Cogs to fix, two plans waiting, tonight's race; team tiles ${w === 390 ? 'under them' : 'only in the sidebar'}`, JSON.stringify(h));
            if (w === 390) {
                tab.logs.length = 0;
                await clean('/manage (hub with plans waiting)');
            }
            if (shotsDir) {
                await shootNow(`captain-hub-${w}-light.png`, w);
            }
        }
        // a plan waiting on a phone (user, 23 Nov 2026): Review and store and Discard on one line, the
        // same height (44 px), Discard at the row's other end, nothing wider than the screen
        const pair = `JSON.stringify([...document.querySelectorAll('#recv-h ~ .todo > li')].map(li => {
          const a = li.querySelector('.todo-acts > a').getBoundingClientRect(), d = li.querySelector('.todo-acts > .discard [data-arm-open]').getBoundingClientRect();
          const row = li.getBoundingClientRect();
          return {top: Math.round(d.top - a.top), h: [Math.round(a.height), Math.round(d.height)], gap: Math.round(d.left - a.right), end: Math.round(row.right - d.right),
            sw: document.documentElement.scrollWidth, iw: innerWidth};
        }))`;
        for (const w of [375, 390]) {
            await open('/manage', {w});
            const rows = JSON.parse(await tab.evaluate(pair));
            report(rows.length === 2 && rows.every(r => r.top === 0 && r.h[0] === r.h[1] && r.h[0] >= 44 && r.gap >= 16 && Math.abs(r.end) <= 1 && r.sw <= r.iw),
                `at ${w} a plan waiting: Review and store and Discard on one line, the same height, Discard at the other end`, JSON.stringify(rows));
        }
        // review I1: from 1024 px the rows' words keep at least 12rem (192 px), the race table's cells
        // one line each; review M8: opening a row's Discard moves neither Review and store nor the words
        const widths = `JSON.stringify((() => {
          const w = sel => [...document.querySelectorAll(sel)].map(el => Math.round(el.getBoundingClientRect().width));
          const lines = el => { const r = document.createRange(); r.selectNodeContents(el); return new Set([...r.getClientRects()].map(x => Math.round(x.top))).size; };
          return {todo: w('#todo-h ~ .todo .todo-what'), recv: w('#recv-h ~ .todo .todo-what'),
            tall: [...document.querySelectorAll('.racetable td:not(:first-child):not(.st)')].filter(td => lines(td) > 1).map(td => td.innerText)};
        })())`;
        const reviewAt = `JSON.stringify((() => { const li = document.querySelector('#recv-h ~ .todo > li');
          const r = li.querySelector('a.btn.primary').getBoundingClientRect(), t = li.querySelector('.todo-what').getBoundingClientRect();
          return [Math.round(r.left), Math.round(r.top + scrollY), Math.round(t.left), Math.round(t.top + scrollY), Math.round(t.width)]; })())`;
        for (const w of [1024, 1100, 1180, 1280]) {
            await open('/manage', {w});
            const ws = JSON.parse(await tab.evaluate(widths));
            report(ws.todo.length === 1 && ws.recv.length === 2 && [...ws.todo, ...ws.recv].every(x => x >= 192) && ws.tall.length === 0,
                `at ${w} the hub's words are at least 12rem wide, the race table's cells one line`, JSON.stringify(ws));
            // the pair together at the row's end (user, 23 Nov 2026): the small gap, Discard at the end
            const together = JSON.parse(await tab.evaluate(pair));
            report(together.length === 2 && together.every(r => r.top === 0 && r.gap > 0 && r.gap <= 12 && Math.abs(r.end) <= 1 && r.sw <= r.iw),
                `at ${w} a plan waiting: Review and store and Discard side by side at the row's end`, JSON.stringify(together));
            const before = await tab.evaluate(reviewAt);
            await openConfirm('f => f.matches(".discard") && f.closest("#recv-h ~ .todo")');
            const after = await tab.evaluate(reviewAt);
            report(before === after, `at ${w} opening a hub row's Discard moves neither Review and store nor the words`, `${before} -> ${after}`);
            await key('Escape', 'Escape', 27);
        }
        srv.store.change(CID, cl => {
            for (const e of cl.inbox.filter(x => x.source === 'receive')) {
                discardEntry(cl, e.id, NOW);
            }
            deleteSheet(cl, 'cogs', cogsPlan, NOW);
        });
        report(!Object.values(club().sheets).some(x => x.team === 'cogs'), 'Cogs has no plan again');
    }

    // ---- 3: upload, the Store form in the team page (it redraws in place), store ----
    tab.logs.length = 0;
    await open(`/manage/upload?team=rollers&plan=${rollersLive}`);
    tab.posts.length = 0;
    const fileFields = await tab.evaluate('[...document.querySelectorAll("form[data-upload] input[type=file]")].map(i => i.name).join(",")');
    report(fileFields === 'json' && await tab.evaluate('!document.querySelector("[name=text]")'), 'the upload page takes the JSON only: no text export field', fileFields);
    // setting the files fires input and change, as a real choice does
    const stayed = await chooseAndContinue(rollersFile);
    report(stayed, 'choosing the file stays on the upload page (no auto-Continue)');
    const assignAt = await pathOf();
    report(/^\/manage\/team\/rollers\?e=[0-9a-z]{6}$/.test(assignAt) && await tab.evaluate('location.hash') === '#panel',
        'Continue goes on to the team page with the plan picked (its Store form)', assignAt);
    report(tab.posts.filter(x => x.url.startsWith('/manage/upload')).length === 1, 'one upload sent', JSON.stringify(tab.posts.map(x => x.url)));
    // the Store form (the plan ⋯ and the race ⋯ have fields of the same names: every field is the form's)
    const F = '.cp-form form[data-assign]';
    // the warning lines above the card's action bar (user, 23 Nov 2026: no "What happens" heading)
    // (in the card, above its action bar: team cockpit spec §5.3b)
    const what = () => tab.evaluate('document.querySelector("#panel-body .cp-what .pv-list")?.innerText ?? ""');
    let wh = await what();
    report(wh.includes('moves from') && wh.includes('Still to do') && !/What happens|Make live:|Store:/.test(wh), 'the warnings above the bar show the moves and what is still to do, no routine line', JSON.stringify(wh));
    await clean(assignAt);
    // (the "What changed" fold under the former What happens went with the assign page: the rider table shows
    // what changed, 12h)
    const noButton = await tab.evaluate('!document.querySelector("[data-redraw], [formmethod]") && !document.body.innerText.includes("Update preview")');
    report(noButton, 'the Store form has no "Update preview" button');
    const checkedAs = () => tab.evaluate(`document.querySelector("${F} input[name=as]:checked")?.value ?? null`);
    report(await checkedAs() === fastPlan, 'the plan the upload came from is preselected', await checkedAs());

    // a new version has no type field (it keeps its plan's type); the captain scrolls, picks "New
    // plan": the form redraws in place (the panel's fragment, no page load), now with the type field,
    // and he types a type
    report(await tab.evaluate(`!document.querySelector("${F} input[name=type]") && !document.querySelector("${F} datalist")`), 'a new version of a plan asks for no type');
    const state = `JSON.stringify({y: Math.round(scrollY), type: document.querySelector('${F} input[name=type]')?.value ?? null,
      box: Boolean(document.querySelector('${F} input[name=live]')), as: document.querySelector('${F} input[name=as]:checked')?.value ?? null,
      focus: document.activeElement?.name ?? null, focusValue: document.activeElement?.value ?? null, touched: document.querySelector('${F} input[name=touched]').value,
      url: location.pathname + location.search})`;
    const scrollTo = async () => {
        await tab.evaluate('window.scrollTo(0, Math.min(260, document.documentElement.scrollHeight - innerHeight))');
        await sleep(100);
        return tab.evaluate('Math.round(scrollY)');
    };
    // the panel requests (the redraws) of the page so far, and the last one's URL
    const panels = () => tab.evaluate('performance.getEntriesByType("resource").filter(r => /[?&]panel=1(&|$)/.test(r.name)).length');
    const lastPanel = () => tab.evaluate('performance.getEntriesByType("resource").filter(r => /[?&]panel=1(&|$)/.test(r.name)).at(-1)?.name ?? ""');
    // run `action` (in the page) and wait for the redraw it sends (up to 4 s): {asked, loads, ms}
    const inPlace = async action => {
        const n0 = await panels();
        const navs0 = tab.navs.count;
        const t0 = Date.now();
        await tab.evaluate(action);
        for (let i = 0; i < 40 && await panels() === n0; i++) {
            await sleep(100);
        }
        const ms = Date.now() - t0;
        await sleep(400);
        return {asked: await panels() - n0, loads: tab.navs.count - navs0, ms};
    };
    // where a field stands on the screen: a redraw from a version to "New plan" moves nothing above it
    // (team cockpit spec §5.3b: the race date in one place, the same box and hint line)
    const onScreen = sel => tab.evaluate(`Math.round(document.querySelector('${sel}').getBoundingClientRect().top)`);
    let y = await scrollTo();
    let at0 = await onScreen(`${F} input[name=as][value=new]`);
    let redrawn = await inPlace(`document.querySelector("${F} input[name=as][value=new]").click()`);
    let s = JSON.parse(await tab.evaluate(state));
    let at1 = await onScreen(`${F} input[name=as][value=new]`);
    report(redrawn.asked === 1 && redrawn.loads === 0 && s.url === assignAt && s.as === 'new', 'picking another plan redraws the form in place (one panel request, no page load)',
        JSON.stringify({...redrawn, url: s.url}));
    report(y > 0 && Math.abs(s.y - y) <= 2, 'the redraw keeps the scroll position', `${y} → ${s.y}`);
    report(Math.abs(at1 - at0) <= 2, 'the redraw moves nothing above the field: it stays where it was on the screen (the type comes below it, the race fold last)', `${at0} → ${at1}`);
    report(s.focus === 'as' && s.focusValue === 'new', 'the redraw focuses the changed field', `${s.focus}=${s.focusValue}`);
    report(s.type === '', 'a new plan asks for a type', JSON.stringify(s.type));
    await tab.evaluate(`document.querySelector("${F} input[name=type]").focus()`);
    await tab.send('Input.insertText', {text: 'fast'});
    report(JSON.parse(await tab.evaluate(state)).touched === 'type', 'typing the type marks it touched');
    report(await tab.evaluate('!document.querySelector("[data-redraw], [formmethod]")'), 'still no "Update preview" button');

    // the race date typed digit by digit (in the field's order): no redraw while typing, one after it
    const typeDate = (y, m, d) => typeDigits(dayFirst ? `${d}${m}${y}` : `${m}${d}${y}`);
    const typeDigits = async digits => {
        for (const d of digits) {
            const key = {key: d, code: `Digit${d}`, windowsVirtualKeyCode: 48 + Number(d), nativeVirtualKeyCode: 48 + Number(d)};
            await tab.send('Input.dispatchKeyEvent', {type: 'keyDown', text: d, ...key});
            await tab.send('Input.dispatchKeyEvent', {type: 'keyUp', ...key});
            await sleep(120);
        }
    };
    const dateNow = () => tab.evaluate(`document.querySelector("${F} input[name=date]")?.value ?? null`);
    // the race date, the start time and the event link are in the race fold (user, 22 Nov 2026): the
    // form's last block, closed for the team's next race, its summary naming the race; a click on the
    // summary opens it and sets the hidden raceOpen the redraws send
    const raceFold = `${F} details.as-race`;
    const foldState = () => tab.evaluate(`JSON.stringify((() => { const d = document.querySelector('${raceFold}');
      return d === null ? null : {open: d.open, last: d.parentElement.lastElementChild === d, summary: d.querySelector('summary').innerText.trim(),
        field: document.querySelector('${F} input[name=raceOpen]')?.value ?? null}; })())`).then(JSON.parse);
    const openFold = async () => {
        await clickAt(await rectOf(`document.querySelector('${raceFold} > summary')`));
        await sleep(200);
        return foldState();
    };
    let fs0 = await foldState();
    report(fs0?.open === false && fs0.last && fs0.summary === 'Race: Thu 19 Nov · 19:30 · Change' && fs0.field === '',
        '3: the race date and time are in a closed fold, the Store form\'s last block, its summary naming the race', JSON.stringify(fs0));
    fs0 = await openFold();
    report(fs0?.open === true && fs0.field === '1', '3: a click on the fold\'s summary opens it (raceOpen=1)', JSON.stringify(fs0));
    await tab.evaluate(`(() => { const d = document.querySelector('${F} input[name=date]'); d.scrollIntoView({block: 'center'}); d.focus(); })()`);
    const drawnDate = await dateNow();
    let asked0 = await panels();
    let navs = tab.navs.count;
    await typeDate('2026', '11', '20');
    const midway = {asked: await panels() - asked0, navs: tab.navs.count - navs, value: await dateNow()};
    report(midway.asked === 0 && midway.navs === 0 && midway.value === '2026-11-20', 'typing the date digit by digit does not redraw midway', JSON.stringify({drawnDate, ...midway}));
    await sleep(2000);
    s = JSON.parse(await tab.evaluate(state));
    report(await panels() - asked0 === 1 && tab.navs.count === navs && /[?&]date=2026-11-20(&|$)/.test(await lastPanel()) && await dateNow() === '2026-11-20',
        'a second after the last digit the form redraws once with that date, in place', `${await panels() - asked0} redraws, ${await lastPanel()}`);
    report(s.focus === 'date', 'the date keeps its focus', JSON.stringify(s.focus));
    // typed and left at once (a tap on the event link): the redraw comes on leaving, not a second later
    asked0 = await panels();
    await typeDate('2026', '11', '19');
    const ev = JSON.parse(await tab.evaluate(`(() => { const e = document.querySelector("${F} input[name=event]"); e.scrollIntoView({block: "center"}); return JSON.stringify(e.getBoundingClientRect()); })()`));
    const leftAt = Date.now();
    for (const type of ['mousePressed', 'mouseReleased']) {
        await tab.send('Input.dispatchMouseEvent', {type, x: ev.x + 10, y: ev.y + ev.height / 2, button: 'left', clickCount: 1});
    }
    for (let i = 0; i < 40 && await panels() === asked0; i++) {
        await sleep(50);
    }
    const took = Date.now() - leftAt;
    await sleep(1500);
    s = JSON.parse(await tab.evaluate(state));
    report(await panels() - asked0 === 1 && took < 900 && /[?&]date=2026-11-19(&|$)/.test(await lastPanel()) && s.focus === 'event',
        'leaving the date redraws at once, once, and focuses where the captain went', `${await panels() - asked0} redraws in ${took} ms, focus ${s.focus}`);
    // the next race again: only raceOpen keeps the fold open across that redraw
    fs0 = await foldState();
    report(fs0?.open === true && fs0.field === '1' && /[?&]raceOpen=1(&|$)/.test(await lastPanel()), '3: a redraw keeps the race fold the captain opened open', JSON.stringify(fs0));

    // no Make live box (user, 23 Nov 2026): the action bar (#panel-acts) has Store (secondary, bordered
    // in both themes) and Make live (primary, the rightmost, "Store and make live" for screen readers)
    const bar3 = JSON.parse(await tab.evaluate(`JSON.stringify([...document.querySelectorAll('#panel-acts .cp-bar > button')]
      .map(b => [b.textContent.trim(), b.className, b.getAttribute('aria-label'), b.getAttribute('form') === document.querySelector('${F}').id]))`));
    report(!s.box && JSON.stringify(bar3) === JSON.stringify([['Store', 'btn secondary', null, true], ['Make live', 'btn primary', 'Store and make live', true]]),
        '3: no Make live box; the action bar has Store and Make live (the rightmost), both posting the form', JSON.stringify({box: s.box, bar3}));
    // back to the live plan: the type field goes (a version keeps its plan's), and so does the race
    // fold: a version takes its plan's race (user, 23 Nov 2026)
    redrawn = await inPlace(`document.querySelector("${F} input[name=as][value='${fastPlan}']").click()`);
    s = JSON.parse(await tab.evaluate(state));
    report(redrawn.asked === 1 && s.as === fastPlan && s.type === null && !s.box, 'another plan choice redraws the form; a version has no type field', JSON.stringify(s));
    report(await foldState() === null && await tab.evaluate(`!document.querySelector('${F} :is(input[name=date], input[name=start], input[name=event], input[name=startWas])')`),
        '3: a version has no race fold: no date, start time or event link', JSON.stringify(await foldState()));
    wh = await what();
    report(wh.includes('moves from') && wh.includes('Still to do') && !/Make live:|Store:/.test(wh),
        'the warnings follow the choice: only what warns, no line about what Make live or Store does', JSON.stringify(wh));
    report(!tab.logs.length && !(await tab.evaluate('window.__csp')).length, 'redraws without errors', tab.logs.join('; '));

    // Make live in the race window (the gate passed, 'Rollers' live): it asks first, in the action bar
    // (user, 23 Nov 2026), and its confirm stores and makes live
    const before = liveOf('rollers');
    const storeForm = 'f => f.matches("form[data-assign]")';
    const asks3 = await openConfirm(storeForm);
    report(asks3.open && asks3.inPlace && asks3.focused && asks3.described && asks3.triggerGone && asks3.button === 'Make live anyway' && liveOf('rollers') === before,
        '3: Make live asks first in its place (the strip in the action bar, the confirm focused and described); nothing changes yet', JSON.stringify(asks3));
    const made3 = await pressConfirm(storeForm);
    report(made3.loaded && /^\/manage\/inbox\//.test(made3.post?.url ?? '') && /(^|&)confirm=1(&|$)/.test(made3.post.body), '3: its confirm posts the Store form with confirm=1', JSON.stringify(made3.post));
    let text = await pageText();
    report(text.includes('v2 is live') && await pathOf() === '/manage/team/rollers?r=2026-11-19', 'Store and make live: the team page at the race\'s live pointer (the new version), "v2 is live"',
        `${await pathOf()} ${JSON.stringify(text.slice(0, 200))}`);
    report(liveOf('rollers') !== before && club().sheets[liveOf('rollers')].plan === fastPlan && club().sheets[liveOf('rollers')].type === 'fast',
        'Rollers\' live plan is v2 of \'Rollers · fast\'');

    // ---- 3b: the reshuffle (spec §10): Upload for Sprockets, with its plan ----
    const href = await tab.evaluate('[...document.querySelectorAll("#panel .result a")].find(a => a.textContent.includes("Upload for Sprockets"))?.getAttribute("href") ?? ""');
    report(href === `/manage/upload?team=sprockets&plan=${sprocketsLive}&date=2026-11-19`, '"Upload for Sprockets" carries its live plan and its race', href);
    await follow(`location.href = ${JSON.stringify(href)}`);
    await chooseAndContinue(sprocketsFile);
    wh = await what();
    report(/^\/manage\/team\/sprockets\?e=/.test(await pathOf()) && !/Make live:|Store:/.test(wh) && !wh.includes('Still to do'),
        'Sprockets: a new version of its live plan, no holes', JSON.stringify(wh));
    await openConfirm(storeForm);
    await pressConfirm(storeForm);
    text = await tab.evaluate('document.getElementById("panel").innerText');
    report(text.includes('v2 is live') && !text.includes('Still to do'), 'Sprockets stored (Make live, confirmed in its strip), nothing still to do', JSON.stringify(text.slice(0, 200)));
    for (const slug of ['sprockets', 'rollers']) {
        await open(`/manage/team/${slug}`);
        text = await pageText();
        const notes = await tab.evaluate('[...document.querySelectorAll(".note")].map(n => n.innerText).join(" | ")');
        report(!text.includes('Still to do') && !text.includes('Upload without') && notes === '', `/manage/team/${slug} shows no hole`, notes);
    }
    let cf;
    let liveNow;
    let pressed;
    let fl;

    // ---- 3e: a refused Store keeps what the captain touched; Store does not race the date ----
    await open('/manage/upload?team=rollers');
    await chooseAndContinue(tempoFile);
    const tempoAt = await pathOf();
    report(/^\/manage\/team\/rollers\?e=/.test(tempoAt) && await checkedAs() === null, 'two plans in the race: no plan preselected', `${tempoAt} ${await checkedAs()}`);
    // no plan chosen yet: no type field (a version has none); "New plan" brings it
    report(await tab.evaluate(`!document.querySelector("${F} input[name=type]")`), 'no plan chosen: no type field yet');
    redrawn = await inPlace(`document.querySelector("${F} input[name=as][value=new]").click()`);
    report(redrawn.asked === 1 && await tab.evaluate(`!!document.querySelector("${F} input[name=type]")`), 'New plan: the type field appears');
    // the type prefilled from the file's name, "Rollers tempo" without the team's name (user, 23 Nov 2026)
    const prefilled = await tab.evaluate(`document.querySelector("${F} input[name=type]").value`);
    report(prefilled === 'tempo', 'New plan: its type prefilled from the plan\'s name ("Rollers tempo" gives "tempo")', JSON.stringify(prefilled));
    // typed over (selected first): the captain's own type
    await tab.evaluate(`(() => { const i = document.querySelector("${F} input[name=type]"); i.focus(); i.select(); })()`);
    await tab.send('Input.insertText', {text: 'tempo'});
    // a new date typed, then Store pressed at once: the POST goes, no redraw (the race fold opened first)
    fs0 = await foldState();
    report(fs0?.open === false, '3e: the fresh form\'s race fold is closed', JSON.stringify(fs0));
    report((await openFold())?.open === true, '3e: its summary opens it');
    await tab.evaluate(`(() => { const d = document.querySelector('${F} input[name=date]'); d.scrollIntoView({block: 'center'}); d.focus(); })()`);
    await typeDate('2026', '11', '20');
    const store = JSON.parse(await tab.evaluate('(() => { const b = document.querySelector("[data-submit=store]"); b.scrollIntoView({block: "center"}); return JSON.stringify(b.getBoundingClientRect()); })()'));
    navs = tab.navs.count;
    tab.posts.length = 0;
    const refusedAt = tab.once('Page.loadEventFired', 4000);
    for (const type of ['mousePressed', 'mouseReleased']) {
        await tab.send('Input.dispatchMouseEvent', {type, x: store.x + store.width / 2, y: store.y + store.height / 2, button: 'left', clickCount: 1});
    }
    await refusedAt;
    await sleep(1500);
    s = JSON.parse(await tab.evaluate(state));
    const refusedFlash = await flash();
    // (the form was drawn for 19 Nov: a Store for another race stores nothing and draws the form for
    // the date typed, races Task 7; the page answers the POST and puts its own URL in the address bar)
    report(refusedFlash === 'Check the choices: the preview was for another race.' && s.url === tempoAt && tab.navs.count - navs === 1 && tab.posts.length === 1
        && await dateNow() === '2026-11-20' && await tab.evaluate(`document.querySelector("${F} input[name=startFor]").value`) === '2026-11-20',
    'Store right after typing a date: one POST, no redraw, refused and drawn for that date', `${tab.navs.count - navs} pages, ${tab.posts.length} posts, ${s.url}, ${JSON.stringify(refusedFlash)}`);
    report(await tab.evaluate('document.querySelector("#panel .flash").getBoundingClientRect().top >= 0'), 'the refused page has the flash in view', `y ${s.y}`);
    report(s.touched === 'type' && s.type === 'tempo', 'the refused page carries the touched type', JSON.stringify({touched: s.touched, type: s.type}));
    report((await foldState())?.open === true, '3e: the refused page (another race) draws the race fold open');
    // (drawn for 20 Nov, which has no plan: a new plan is preselected, its type field there)
    // back to the race with plans (19 Nov): the redraw keeps the typed type
    redrawn = await inPlace(`(() => { const d = document.querySelector("${F} input[name=date]"); d.value = "2026-11-19"; d.dispatchEvent(new Event("change", {bubbles: true})); })()`);
    s = JSON.parse(await tab.evaluate(state));
    report(redrawn.asked === 1 && redrawn.loads === 0 && s.as === 'new' && s.type === 'tempo' && s.touched === 'type' && /[?&]date=2026-11-19(&|$)/.test(await lastPanel()),
        'the redraw for the race with plans keeps the typed type', JSON.stringify(s));
    // that date came as from the calendar (its change, no key pressed): it redrew at once, not a second
    // later (team cockpit spec §5.3b); a click anywhere in the field opens the calendar (showPicker,
    // counted here: headless Chrome draws no picker)
    report(redrawn.ms < 900, 'a date picked in the calendar redraws on its change at once', `${redrawn.ms} ms`);
    const picker = JSON.parse(await tab.evaluate(`(() => { window.__pickers = 0; HTMLInputElement.prototype.showPicker = function () { window.__pickers++; };
      const d = document.querySelector('${F} input[name=date]'); d.scrollIntoView({block: 'center'}); const r = d.getBoundingClientRect();
      return JSON.stringify({x: r.x + r.width * 0.3, y: r.y, width: 1, height: r.height}); })()`));
    await clickAt(picker);
    await sleep(200);
    report(await tab.evaluate('window.__pickers') === 1, 'a click in the race date field opens its calendar (showPicker)', String(await tab.evaluate('window.__pickers')));
    await key('Escape', 'Escape', 27);
    // the event link pasted and left (a tap on the type): the form redraws once, and a warning line says
    // what the link does to the race before Store (review M4)
    await tab.evaluate(`(() => { const e = document.querySelector('${F} input[name=event]'); e.scrollIntoView({block: 'center'}); e.focus(); })()`);
    await tab.send('Input.insertText', {text: 'https://www.zwift.com/events/view/5123456'});
    redrawn = await inPlace(`document.querySelector("${F} input[name=type]").focus()`);
    s = JSON.parse(await tab.evaluate(state));
    wh = await what();
    report(redrawn.asked === 1 && redrawn.loads === 0 && /[?&]event=https%3A%2F%2Fwww\.zwift\.com%2Fevents%2Fview%2F5123456(&|$)/.test(await lastPanel()) && s.focus === 'type'
        && wh.includes('now has event link 5123456'), 'leaving the event link redraws once; a warning line names the race\'s new link', JSON.stringify({focus: s.focus, wh}));
    report(s.as === 'new' && s.type === 'tempo' && s.touched === 'type', 'the redraw keeps the typed type', JSON.stringify(s));
    // the race fold closed right after editing its link: the click on its summary leaves the link first,
    // which sends the redraw with the fold still open; the fold stays closed, the focus on its summary
    await tab.evaluate(`(() => { const e = document.querySelector('${F} input[name=event]'); e.scrollIntoView({block: 'center'}); e.focus(); e.select(); })()`);
    await tab.send('Input.insertText', {text: 'https://www.zwift.com/events/view/5123457'});
    asked0 = await panels();
    await clickAt(await rectOf(`document.querySelector('${raceFold} > summary')`));
    for (let i = 0; i < 40 && await panels() === asked0; i++) {
        await sleep(100);
    }
    await sleep(500);
    fs0 = await foldState();
    const onSummary = await tab.evaluate(`document.activeElement === document.querySelector('${raceFold} > summary')`);
    report(await panels() - asked0 === 1 && fs0?.open === false && fs0.field === '' && onSummary && /[?&]event=[^&]*5123457(&|$)/.test(await lastPanel()),
        '3e: the race fold closed right after editing its link stays closed through the redraw leaving the link sent', JSON.stringify({...fs0, onSummary, asked: await panels() - asked0}));
    // Store with a required field left empty in the closed fold (as a special team's): the fold opens
    // to show the browser's message, nothing is posted
    navs = tab.navs.count;
    tab.posts.length = 0;
    await tab.evaluate(`(() => { const t = document.querySelector('${F} input[name=start]'); t.required = true; t.value = ''; })()`);
    await clickAt(await rectOf('document.querySelector("[data-submit=store]")'));
    await sleep(400);
    fs0 = await foldState();
    report(fs0?.open === true && tab.posts.length === 0 && tab.navs.count === navs, '3e: Store with a required field empty in the closed race fold opens the fold and posts nothing',
        JSON.stringify({...fs0, posts: tab.posts.length, navs: tab.navs.count - navs}));
    await tab.evaluate(`(() => { const t = document.querySelector('${F} input[name=start]'); t.required = false; t.value = '19:30'; })()`);
    const entry = new URLSearchParams(tempoAt.split('?')[1]).get('e');
    // Discard: on Store's line in the card's action bar, before Store (Discard · Store · Make live: user,
    // 23 Nov 2026), 24 px or more from it; it asks first in its place
    const gap = JSON.parse(await tab.evaluate(`(() => { const a = document.querySelector('[data-submit=store]').getBoundingClientRect();
      const b = document.querySelector('.cp-bar form.discard [data-arm-open]').getBoundingClientRect(); return JSON.stringify({dx: Math.round(a.left - b.right), dy: Math.round(b.top - a.top)}); })()`));
    report(gap.dx >= 24 && Math.abs(gap.dy) <= 2, 'Discard sits on Store\'s line, at least 24 px left of it', JSON.stringify(gap));
    const discard = 'f => f.matches(".discard")';
    cf = await openConfirm(discard);
    report(cf.open && cf.focused && cf.button === 'Discard plan' && club().inbox.some(e => e.id === entry), 'Discard asks first; nothing discarded yet', JSON.stringify(cf));
    await pressConfirm(discard);
    report((await flash()).startsWith('Discarded') && !club().inbox.some(e => e.id === entry), 'Discard', await flash());

    // ---- the way back (UI panel wave 3): at 1280 one breadcrumb line above the page's head instead of
    // the back bar and the kicker, its crumb before the page where the phone's bar goes; the team
    // page's switcher stays hidden; at 390 the bar as before and no breadcrumb ----
    const way = `JSON.stringify((() => {
      const shown = el => Boolean(el) && el.getClientRects().length > 0;
      const a = document.querySelector('.app>.topbar .back'), club = document.querySelector('.app>.topbar .topbar-club'), h = document.querySelector('main h1');
      const nav = document.querySelector('nav.crumbs'), links = nav ? [...nav.querySelectorAll('a')] : [];
      // (a kicker that names the page, not the club, stays: "Team settings" over the team's name,
      // user 23 Nov 2026)
      const kicker = [...document.querySelectorAll('main .pagehead .kicker:not(.keep)')].some(shown);
      const keep = [...document.querySelectorAll('main .pagehead .kicker.keep')].filter(shown).map(k => k.textContent.trim()).join() || null;
      return {bar: shown(a) ? a.getAttribute('href') : null, club: club ? shown(club) : null, crumbs: shown(nav) ? [...nav.querySelectorAll('li')].map(li => li.querySelector('a, [aria-current]').textContent).join(' › ') : null,
        parent: links.length ? links.at(-1).getAttribute('href') : null, current: nav?.querySelector('[aria-current=page]')?.textContent ?? null, keep, title: h?.textContent ?? null,
        above: shown(nav) && h ? nav.getBoundingClientRect().bottom <= h.getBoundingClientRect().top : null, kicker};
    })())`;
    for (const [p, href, crumbs] of [[`/manage/upload?team=rollers&plan=${fastPlan}`, '/manage/team/rollers', 'Kettenfett RC › Rollers › Upload'],
        ['/manage/upload?team=rollers', '/manage/team/rollers', 'Kettenfett RC › Rollers › Upload'],
        ['/manage/team/rollers/settings', '/manage/team/rollers', 'Kettenfett RC › Rollers › Team settings'], ['/manage/new-team', '/manage', 'Kettenfett RC › Add a team'],
        ['/manage/settings', '/manage', 'Kettenfett RC › Club settings']]) {
        await open(p, {w: 1280});
        const wb = JSON.parse(await tab.evaluate(way));
        const teamSet = p.endsWith('/settings') && p.startsWith('/manage/team/');
        report(wb.bar === null && wb.crumbs === crumbs && wb.parent === href && wb.above === true && !wb.kicker
            && (teamSet ? wb.keep === 'Team settings' && wb.title === 'Rollers' : wb.keep === null),
            `at 1280 ${p}: the breadcrumb "${crumbs}" above its head, no back bar, no kicker of the club${teamSet ? '; "Team settings" over the team\'s name' : ''}`, JSON.stringify(wb));
        await open(p);
        const ph = JSON.parse(await tab.evaluate(way));
        // (the team page's bar is its switcher, whose back link goes to the hub)
        report(ph.crumbs === null && ph.bar === href, `at 390 ${p}: the bar goes where the crumb before the page goes, no breadcrumb`, JSON.stringify(ph));
    }
    // the settings pages in the wide frame (user, 23 Nov 2026): at 1280 the team page's left edge and
    // width, their cards flowing into columns (two in the frame), none split, the danger zone last at
    // the whole width; at the wide pages' scale (15 px buttons as high as the hub's, inputs as high as
    // the button beside them, every control 44 px); at 1100 and 390 one column as before, the inputs
    // 17 px on a phone (iOS does not zoom)
    const frameOf = `JSON.stringify((() => { const m = document.querySelector('main').getBoundingClientRect(); return {l: Math.round(m.left), w: Math.round(m.width)}; })())`;
    await open('/manage/team/rollers', {w: 1280});
    const teamFrame = JSON.parse(await tab.evaluate(frameOf));
    const settingsGeo = `JSON.stringify((() => {
      const m = document.querySelector('main').getBoundingClientRect(), cards = [...document.querySelectorAll('.setcols > section')].map(c => c.getBoundingClientRect());
      const dz = document.querySelector('.danger-zone').getBoundingClientRect(), cols = document.querySelector('.setcols').getBoundingClientRect();
      const lefts = [...new Set(cards.map(r => Math.round(r.left)))].sort((a, b) => a - b);
      const btn = document.querySelector('.setcols .btn.primary'), bs = btn ? getComputedStyle(btn) : null;
      const pair = document.querySelector('.setcols .inline-form'), pin = pair?.querySelector('input:not([type=hidden])'), pbtn = pair?.querySelector('.btn');
      const lab = document.querySelector('.setcols label.field');
      return {main: {l: Math.round(m.left), w: Math.round(m.width)}, columns: lefts.length, lefts, overlap: cards.some((a, i) => cards.some((b, j) => i !== j && a.left === b.left && a.top < b.bottom - 1 && b.top < a.bottom - 1)),
        split: [...document.querySelectorAll('.setcols > section')].some(c => c.getClientRects().length > 1),
        // the danger zone last: at the whole width, or with the team's ZwiftGopher link beside it (.setend)
        dzFull: dz.top >= Math.max(...cards.map(r => r.bottom)) - 1 && (Math.abs(dz.width - cols.width) <= 1
          || (() => { const e = document.querySelector('.setend'); if (!e) return false; const er = e.getBoundingClientRect(), k = [...e.children].map(x => x.getBoundingClientRect());
            return Math.abs(er.width - cols.width) <= 1 && k.length === 2 && Math.abs(k[0].top - k[1].top) <= 1 && k[1].left > k[0].right; })()),
        btn: bs ? {size: bs.fontSize, h: Math.round(btn.getBoundingClientRect().height)} : null,
        pair: pin && pbtn ? {inH: Math.round(pin.getBoundingClientRect().height), btnH: Math.round(pbtn.getBoundingClientRect().height), inSize: getComputedStyle(pin).fontSize} : null,
        label: lab ? getComputedStyle(lab).fontSize : null, sw: document.documentElement.scrollWidth, iw: innerWidth,
        // the cards' controls (the breadcrumb keeps its desktop links, as on every page)
        small: [...document.querySelectorAll('.setcols :is(.btn, input:not([type=hidden],[type=checkbox],[type=radio]), select), .danger-zone .btn')]
          .filter(e => e.getClientRects().length && e.getBoundingClientRect().height < 44).map(e => (e.textContent.trim() || e.name) + ' ' + Math.round(e.getBoundingClientRect().height))};
    })())`;
    for (const p of ['/manage/settings', '/manage/team/rollers/settings']) {
        await open(p, {w: 1280});
        const g = JSON.parse(await tab.evaluate(settingsGeo));
        report(g.main.l === teamFrame.l && g.main.w === teamFrame.w && g.columns === 2 && !g.overlap && !g.split && g.dzFull && g.sw <= g.iw,
            `at 1280 ${p}: the team page's frame, its cards in two columns, none split, the danger zone last at the whole width`, JSON.stringify({teamFrame, g}));
        report(g.btn?.size === '15px' && g.btn.h >= 44 && g.label === '15px' && (g.pair === null || (g.pair.inH === g.pair.btnH && g.pair.inSize === '15px')),
            `at 1280 ${p}: 15 px buttons 44 px high, 15 px labels, an input as high as the button beside it`, JSON.stringify({btn: g.btn, label: g.label, pair: g.pair}));
        report(!g.small.length, `at 1280 ${p}: every control of its cards 44 px or more`, g.small.join(' | '));
        await open(p, {w: 1100});
        const n = JSON.parse(await tab.evaluate(settingsGeo));
        report(n.columns === 1 && n.btn?.size === '15px', `at 1100 ${p}: one column, as before`, JSON.stringify({columns: n.columns, lefts: n.lefts}));
        await open(p, {w: 390});
        const ph = JSON.parse(await tab.evaluate(settingsGeo));
        const f = JSON.parse(await tab.evaluate(fit));
        report(ph.columns === 1 && (ph.pair === null || ph.pair.inSize === '17px') && ph.btn?.size === '16px' && f.sw <= f.iw && !f.small.length,
            `at 390 ${p}: one column, the phone's sizes (17 px inputs, 16 px buttons)`, JSON.stringify({columns: ph.columns, btn: ph.btn, pair: ph.pair}));
    }
    await open('/manage', {w: 1280});
    report(JSON.parse(await tab.evaluate(way)).crumbs === null, 'at 1280 the hub has no breadcrumb');
    // the team page has none either (user, 23 Nov 2026): the sidebar names the club and the team, and
    // no kicker repeats the club over the title; at 390 its switcher's back link goes to the hub
    await open('/manage/team/rollers', {w: 1280});
    const teamWide = JSON.parse(await tab.evaluate(way));
    report(teamWide.crumbs === null && teamWide.bar === null && !teamWide.kicker, 'at 1280 the team page: no breadcrumb, no back bar, no kicker', JSON.stringify(teamWide));
    await open('/manage/team/rollers');
    report(JSON.parse(await tab.evaluate(way)).bar === '/manage', 'at 390 the team page goes back to the hub', await tab.evaluate(way));
    await open(`/manage/upload?team=rollers&plan=${fastPlan}&from=plan`);
    const phone = JSON.parse(await tab.evaluate(way));
    report(phone.bar === '/manage/team/rollers' && phone.club === true, 'at 390 an upload page opened for a plan (also with a `from` of before) goes back to the team and names the club', JSON.stringify(phone));

    // ---- shots for a look next to the prototype's ----
    if (shotsDir) {
        await shoot('captain-team-cogs-390-light.png', '/manage/team/cogs', 390, 'light', true);
        // the team page with its switcher open (phones: the teams, All teams)
        await open('/manage/team/rollers');
        await tab.evaluate('document.querySelector("details.switch").open = true');
        await shootNow('captain-team-switch-390-light.png');
        // a special team (user, 19 Nov 2026): its settings (special checked, the weekly fields hidden), and the Store form of
        // its plans with date and start time at the top: empty (a neutral line, nothing red), filled
        // (the time redraws the preview), and a version that moves the race's start; the team goes
        // again after the shots
        const gears = srv.store.change(CID, cl => addTeam(cl, {name: 'Gears', kind: 'special', weekday: null},
            {slugTaken: s2 => srv.store.slugTaken(s2), now: NOW}));
        const gearsEntry = (riders = ['1008', '1009']) => srv.store.change(CID, cl => addEntry(cl, {source: 'upload', team: gears, json: planJson('Gears', riders), text: null},
            {now: NOW, newId: () => randomId(6)}));
        const what = `JSON.stringify([...document.querySelectorAll('#panel-body .cp-what li')].map(li => [li.className, li.innerText.trim()]))`;
        // set a field of the Store form as typed and left: the form redraws in place (the panel's
        // fragment; or not, then null after 3 s)
        const panelsNow = () => tab.evaluate('performance.getEntriesByType("resource").filter(r => /[?&]panel=1(&|$)/.test(r.name)).length');
        const setField = async (name, value) => {
            const n0 = await panelsNow();
            await tab.evaluate(`(() => { const f = document.querySelector('.cp-form input[name=${name}]'); f.focus(); f.value = '${value}';
              f.dispatchEvent(new Event('input', {bubbles: true})); f.dispatchEvent(new Event('change', {bubbles: true})); })()`);
            for (let i = 0; i < 30 && await panelsNow() === n0; i++) {
                await sleep(100);
            }
            await sleep(400);
            return await panelsNow() > n0 ? true : null;
        };
        const first = gearsEntry();
        await open(`/manage/team/${gears}?e=${first}`);
        const when = JSON.parse(await tab.evaluate(`JSON.stringify((() => {
          const d = document.querySelector('.cp-form .as-when input[name=date]'), s = document.querySelector('.cp-form .as-when input[name=start]');
          return {date: !!d && d.required, start: !!s && s.required};
        })())`));
        report(when.date && when.start, 'a special team\'s Store form asks for date and start time, side by side', JSON.stringify(when));
        const empty = JSON.parse(await tab.evaluate(what));
        report(empty.length === 1 && empty[0][0] === 'neutral' && empty[0][1] === 'Choose the race date and start time.',
            'empty date and time: a neutral line, nothing red', JSON.stringify(empty));
        const byDate = await setField('date', '2026-11-29');
        const afterDate = JSON.parse(await tab.evaluate(what));
        const byTime = await setField('start', '20:15');
        const filled = JSON.parse(await tab.evaluate(what));
        // (no race line: the date and the time are in their fields, team cockpit spec §5.3b)
        const race = await tab.evaluate('JSON.stringify([document.querySelector(".cp-form input[name=date]")?.value, document.querySelector(".cp-form input[name=start]")?.value, Boolean(document.querySelector(".cp-form .as-row"))])');
        report(byDate !== null && afterDate[0]?.[1] === 'Choose the start time.' && byTime !== null
            && !filled.some(([sev]) => sev === 'neutral') && filled.some(([, text]) => text.startsWith('Store: new plan \'Gears\', not live.')) && race === '["2026-11-29","20:15",false]',
            'the date and then the time redraw the preview, which uses the time', JSON.stringify({afterDate, filled, race}));
        // Make live (nothing live in the race: at once, user 23 Nov 2026)
        await follow('document.querySelector("[data-submit=live]").click()');
        const gearsPlan = Object.values(club().sheets).find(sh => sh.team === gears)?.plan;
        report(club().teams[gears].races?.['2026-11-29']?.start === '20:15' && gearsPlan, 'Store sets the race\'s start', JSON.stringify(club().teams[gears].races));
        // a new version takes its plan's race as it is (user, 23 Nov 2026): no date or time field
        const second = gearsEntry(['1008']);
        await open(`/manage/team/${gears}?e=${second}&team=${gears}&as=${gearsPlan}&drawn=${gears}:${gearsPlan}`);
        report(await tab.evaluate(`!document.querySelector('.cp-form :is(input[name=start], input[name=date], details.as-race)')`), 'a version of a special team\'s plan has no date or time field');
        for (const w of [390, 1280]) {
            await shoot(`captain-team-settings-special-${w}-light.png`, `/manage/team/${gears}/settings`, w, 'light', true);
        }
        // the race rhythm: the weekly fields hide while special is checked (the script)
        await open('/manage/new-team');
        const hide = async () => JSON.parse(await tab.evaluate('JSON.stringify(document.querySelector("[data-weekly]").hidden)'));
        const shown = await hide();
        await tab.evaluate('document.querySelector("input[name=kind][value=special]").click()');
        const gone = await hide();
        await shootNow('captain-new-team-special-390-light.png');
        await tab.evaluate('document.querySelector("input[name=kind][value=weekly]").click()');
        report(shown === false && gone === true && await hide() === false, 'Add a team: the weekly fields hide while special is checked', `${shown} ${gone}`);
        srv.store.change(CID, cl => {
            discardEntry(cl, second, NOW);
            deleteTeam(cl, gears, NOW);
        });
        // every captain page reached by a GET at 1280, those without a shot above at 390 as well (a
        // gone page answers 404)
        const pages = [['teams', '/manage'], ['team', '/manage/team/rollers'], ['team-cogs', '/manage/team/cogs'],
            ['team-settings', '/manage/team/rollers/settings'], ['club-settings', '/manage/settings', 390], ['new-team', '/manage/new-team', 390],
            ['upload', '/manage/upload?team=rollers', 390],
            ['team-gone', '/manage/team/nope', 390], ['entry-gone', '/manage/inbox/zzzzzz', 390],
            ['not-found', '/manage/nothing', 390], ['privacy', '/privacy', 390]];
        for (const [name, p, also] of pages) {
            await shoot(`captain-${name}-1280-light.png`, p, 1280, 'light', true);
            if (also) {
                await shoot(`captain-${name}-${also}-light.png`, p, also, 'light', true);
            }
        }
        const publicShots = async (name, p) => {
            for (const scheme of ['light', 'dark']) {
                await shoot(`public-${name}-390-${scheme}.png`, p, 390, scheme, name === 'register');
            }
            await shoot(`public-${name}-1280-light.png`, p, 1280, 'light', name === 'register');
        };
        // two clubs: the footer's club switch
        await signInTwo();
        await shoot('captain-teams-two-390-light.png', '/manage', 390, 'light', true);
        await shoot('captain-teams-two-1280-light.png', '/manage', 1280, 'light', true);
        await publicShots('register', '/register');
        await signOut();
        await publicShots('home', '/');
        await signIn();
        await open('/manage');
        report(await signedIn(), 'signed in again after the shots');
    }

    // ---- the hub with nothing to do and nothing waiting (UI panel wave 3): Spokesmen CC gets a team
    // with its live plan for tonight; one line says so, tonight's race still shows ----
    {
        const spokes = c2.club.id;
        srv.store.change(spokes, cl => {
            const slug = addTeam(cl, {name: 'Pedals', start: '20:00'}, {slugTaken: s2 => srv.store.slugTaken(s2), now: NOW});
            upload(cl, slug, {riders: ['2001', '2002', '2003'], at: T('2026-11-19T15:00:00Z')});
        });
        await signIn(`${token2}.${token}`);
        for (const w of [390, 1280]) {
            tab.logs.length = 0;
            await open('/manage', {w});
            const h = JSON.parse(await tab.evaluate(`JSON.stringify({line: document.querySelector('.sevline.nothing')?.innerText.trim() ?? null,
              blocks: document.querySelectorAll('#todo-h, #recv-h').length, races: document.querySelectorAll('.racetable').length, h1: document.querySelector('h1').textContent})`));
            report(h.h1 === 'Spokesmen CC' && h.line === 'Nothing to do · next race Thu 19 Nov 20:00' && h.blocks === 0 && h.races === 1,
                `at ${w} a hub with nothing to do says so in one line`, JSON.stringify(h));
            if (w === 390) {
                await clean('/manage (nothing to do)');
            }
            if (shotsDir) {
                await shootNow(`captain-hub-empty-${w}-light.png`, w);
            }
        }
        await signIn();
        await open('/manage');
        report(await signedIn() && await tab.evaluate('document.querySelector("h1").textContent') === 'Kettenfett RC', 'Kettenfett RC again');
    }

    // ---- 4: the guarded reload waits while a strip is open ----
    // the panel's Make live of 'Rollers · slow' (the gate is open: it asks): a strip outside any ⋯
    // (an open ⋯ holds the reload by itself)
    tab.logs.length = 0;
    const slowPanel = 'f => f.closest("#panel-acts") && f.getAttribute("action") === "/manage/live"';
    await open(`/manage/team/rollers?v=${rollersSlow}`);
    await tab.evaluate('window.__mark = 1');
    cf = await openConfirm(slowPanel);
    report(cf.open && await tab.evaluate(`!${ARM(slowPanel)}.closest('details')`), 'the panel\'s Make live strip is open', JSON.stringify(cf));
    // the focus on a button holds nothing: only the open strip does
    await sleep(35000);
    report(await tab.evaluate('window.__mark') === 1, 'no reload while the panel\'s Make live strip is open');
    await key('Escape', 'Escape', 27);
    await tab.evaluate('document.activeElement.blur()');
    await sleep(35000);
    report(await tab.evaluate('typeof window.__mark') === 'undefined', 'reload once it is closed');
    report(!tab.logs.length, 'reload without errors', tab.logs.join('; '));
    // a ⋯ closed by a click outside never holds the reload: not with a strip armed in it (the strip
    // closes with it), nor with a field typed in it and not saved
    const outside = async () => {
        await clickAt({x: 5, y: 400, width: 1, height: 1});
        await sleep(150);
    };
    // (a strip in a ⋯: the slow plan's Delete)
    const slowMenu = `f => f.closest("#menu-plan-${slowPlan}") && f.getAttribute("action") === "/manage/sheet/delete"`;
    await open('/manage/team/rollers');
    await tab.evaluate('window.__mark = 1');
    cf = await openConfirm(slowMenu);
    await outside();
    report(cf.open && await tab.evaluate('document.querySelector("details[data-menu][open]") === null && document.querySelector("form[data-arm].armed") === null'),
        'a click outside closes the ⋯ and the strip armed in it', JSON.stringify(cf));
    await sleep(35000);
    report(await tab.evaluate('typeof window.__mark') === 'undefined', 'the page reloads after a ⋯ with an armed strip was closed');
    await tab.evaluate('window.__mark = 1');
    const raceSummary = 'document.getElementById("menu-race-2026-11-19").querySelector("summary")';
    await clickAt(await rectOf(raceSummary));
    await sleep(150);
    await clickAt(await rectOf('document.querySelector("#menu-race-2026-11-19 input[name=event]")'));
    await tab.send('Input.insertText', {text: 'https://www.zwift.com/events/view/51'});
    await sleep(100);
    await outside();
    report(await tab.evaluate('document.querySelector("details[data-menu][open]") === null && document.activeElement?.name !== "event"'), 'a click outside closes the ⋯ with a typed field');
    await sleep(35000);
    report(await tab.evaluate('typeof window.__mark') === 'undefined', 'the page reloads after a ⋯ with a typed field was closed');
    // the strip of "Save date and time…" writes the day and the time (the team's for an empty field)
    const when = 'f => f.getAttribute("action") === "/manage/race" && f.querySelector("input[name=action][value=when]")';
    cf = await openConfirm(when);
    const words = await tab.evaluate(`document.getElementById(${ARM(when)}.querySelector('[data-arm-yes]').getAttribute('aria-describedby')).textContent`);
    report(cf.open && words === 'Moves the race and its plans to Thu 19 Nov 19:30.', 'the date and time strip writes the day and the team\'s time', JSON.stringify(words));
    await key('Escape', 'Escape', 27);
    await key('Escape', 'Escape', 27);
    report(!tab.logs.length, 'the ⋯ checks without errors', tab.logs.join('; '));

    // ---- 5: the stale line when offline ----
    await open('/manage/team/rollers');
    await tab.send('Network.emulateNetworkConditions', {offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1});
    await sleep(35000);
    const stale = JSON.parse(await tab.evaluate(`JSON.stringify((() => {
      const s = document.querySelector('[data-stale]');
      return {shown: !s.hidden && s.offsetHeight > 0, text: s.innerText, dim: document.querySelector('.fresh').classList.contains('is-stale')};
    })())`));
    await tab.send('Network.emulateNetworkConditions', {offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1});
    report(stale.shown && stale.text.includes('Not updated since 19:12 · no connection'), 'stale line when offline', JSON.stringify(stale.text));
    report(stale.dim, 'the Updated line is marked stale');

    // ---- 3d: Make live in the panel asks first (the gate is open); so does the newer version's card's Make live (its row has none) ----
    await open(`/manage/team/rollers?v=${rollersSlow}`);
    liveNow = liveOf('rollers');
    cf = await openConfirm(slowPanel);
    report(cf.open && cf.inPlace && cf.inView && cf.focused && cf.described, 'Make live in the panel: the strip opens in its place', JSON.stringify(cf));
    report(cf.width === cf.row, 'at 390 the strip takes the whole width of the panel', `${cf.width} of ${cf.row}`);
    await sleep(500);
    report(liveOf('rollers') === liveNow, 'team.live unchanged until the button is pressed');
    pressed = await pressConfirm(slowPanel);
    report(pressed.post?.url === '/manage/live' && /(^|&)confirm=1(&|$)/.test(pressed.post.body), 'Make live posts confirm=1', JSON.stringify(pressed.post));
    report(liveOf('rollers') === rollersSlow, '\'Rollers · slow\' is live', await flash());

    // a newer version of the live plan that is not live: its row says "v2 · not live", a link alone
    // like every row (user, 23 Nov 2026); its Make live (the version for screen readers) is in its card's action bar
    srv.store.change(CID, cl => uploadSheet(cl, {
        slug: 'rollers', json: planJson('Rollers slow', ['1002', '1003', '1004', '1005', '1006']), text: null, as: slowPlan, live: false,
        base: cl.teams.rollers.version, pinnedEventId: null, via: 'file',
    }, {now: NOW, newId: () => randomId(6)}));
    const [slowV2] = newestOf(slowPlan);
    await open('/manage/team/rollers');
    const rowsBare = JSON.parse(await tab.evaluate(`JSON.stringify((() => {
      const rows = [...document.querySelectorAll('.cp-list .cp-row')];
      const notice = document.querySelector('.cp-row[data-sel="v:${slowV2}"]');
      return {rows: rows.length, withForm: rows.filter(r => r.querySelector('form, button')).length, notice: notice?.innerText.trim() ?? null,
        kids: notice ? [...notice.children].map(e => e.localName).join() : null};
    })())`));
    report(rowsBare.rows > 3 && rowsBare.withForm === 0 && /^v2 · not live/.test(rowsBare.notice ?? '') && rowsBare.kids === 'a',
        'every row is its link alone: the newer version\'s "v2 · not live" without a Make live beside it', JSON.stringify(rowsBare));
    await open(`/manage/team/rollers?v=${slowV2}`);
    const newer = 'f => f.closest(".cp-bar") && f.querySelector("[data-arm-open]").textContent === "Make live v2 of \'Rollers · slow\'"';
    cf = await openConfirm(newer);
    report(cf.open && cf.inPlace && cf.focused, 'v2\'s Make live in its card: the strip opens in its place', JSON.stringify(cf));
    report(liveOf('rollers') === rollersSlow, 'team.live unchanged until the button is pressed');
    pressed = await pressConfirm(newer);
    report(pressed.post?.url === '/manage/live' && /(^|&)confirm=1(&|$)/.test(pressed.post.body), 'v2\'s Make live posts confirm=1', JSON.stringify(pressed.post));
    report(liveOf('rollers') === slowV2, 'v2 of \'Rollers · slow\' is live', await flash());

    // ---- 6: Make live without the script: the server's confirm page ----
    const plain = await chrome.newTab();
    await plain.send('Emulation.setScriptExecutionDisabled', {value: true});
    const [fastNewest, {n: fastNewestN}] = newestOf(fastPlan);
    await open(`/manage/team/rollers?v=${fastNewest}`, {on: plain});
    const info = JSON.parse(await plain.evaluate(`JSON.stringify({js: document.documentElement.classList.contains('js'),
      noteShown: [...document.querySelectorAll('p.banner.warn')].some(p => p.textContent === 'Without JavaScript every row you pick loads the whole page, and after a change in the Store form its first Store shows what happens: press Store again. Make live and every button that asks first work as well.' && p.getBoundingClientRect().height > 0)})`));
    report(!info.js && info.noteShown, 'without the script: no html.js, and the team page says what works without it', JSON.stringify(info));
    // the panel's Make live: without the script its strip stays hidden and the button posts without
    // confirm, as any POST without it: the server asks on a page of its own
    const pdoc = await plain.send('DOM.getDocument', {depth: -1});
    const nodeOf = async selector => (await plain.send('DOM.querySelector', {nodeId: pdoc.result.root.nodeId, selector})).result?.nodeId ?? 0;
    const tap = async nodeId => {
        await plain.send('DOM.scrollIntoViewIfNeeded', {nodeId});
        const got = await plain.send('DOM.getBoxModel', {nodeId});
        if (!got.result) {
            throw new Error(`no box for node ${nodeId}: ${JSON.stringify(got.error)}`);
        }
        const box = got.result.model.content;
        const x = (box[0] + box[2]) / 2;
        const yy = (box[1] + box[5]) / 2;
        for (const type of ['mousePressed', 'mouseReleased']) {
            await plain.send('Input.dispatchMouseEvent', {type, x, y: yy, button: 'left', clickCount: 1});
        }
    };
    const rowForm = `#panel-acts form[action="/manage/live"]:has(input[name=sheet][value="${fastNewest}"])`;
    report(await plain.evaluate(`document.querySelector(${JSON.stringify(rowForm)}) !== null && document.getElementById('panel-body').getClientRects().length > 0`),
        'without the script the page with the version picked has its Make live in the panel');
    const rowButton = await nodeOf(`${rowForm} [data-arm-open]`);
    if (!rowButton) {
        throw new Error(`no Make live for ${fastNewest}: ${await plain.evaluate('JSON.stringify([...document.querySelectorAll("form[action=\'/manage/live\'] input[name=sheet]")].map(i => i.value))')}`);
    }
    report(await plain.evaluate(`document.querySelector(${JSON.stringify(`${rowForm} [data-arm-strip]`)}).getClientRects().length === 0`), 'without the script the strip stays hidden');
    plain.posts.length = 0;
    let loaded = plain.once('Page.loadEventFired');
    await tap(rowButton);
    await loaded;
    await sleep(250);
    text = await pageText(plain);
    report(plain.posts.at(-1)?.url === '/manage/live' && !/confirm=/.test(plain.posts.at(-1).body) && text.includes(`Make 'Rollers · fast' v${fastNewestN} live?`),
        'a Make live POST without confirm gets the server\'s confirm page', JSON.stringify(text.slice(0, 200)));
    report(liveOf('rollers') === slowV2, 'team.live unchanged on the confirm page');
    const cdoc = await plain.send('DOM.getDocument', {depth: -1});
    const confirmButton = (await plain.send('DOM.querySelector', {nodeId: cdoc.result.root.nodeId, selector: 'form[action="/manage/live"] [type=submit]'})).result.nodeId;
    loaded = plain.once('Page.loadEventFired');
    await plain.send('DOM.scrollIntoViewIfNeeded', {nodeId: confirmButton});
    const cbox = (await plain.send('DOM.getBoxModel', {nodeId: confirmButton})).result.model.content;
    for (const type of ['mousePressed', 'mouseReleased']) {
        await plain.send('Input.dispatchMouseEvent', {type, x: (cbox[0] + cbox[2]) / 2, y: (cbox[1] + cbox[5]) / 2, button: 'left', clickCount: 1});
    }
    await loaded;
    await sleep(250);
    report(/(^|&)confirm=1(&|$)/.test(plain.posts.at(-1)?.body ?? '') && liveOf('rollers') === fastNewest,
        'confirming there makes it live, without the script', `${JSON.stringify(plain.posts.at(-1))} ${JSON.stringify((await pageText(plain)).slice(0, 120))}`);
    plain.close();

    // ---- 7: Delete plan in the plan's ⋯ on the team page asks in its place first ----
    tab.logs.length = 0;
    await open('/manage/team/rollers');
    const del = slowMenu;
    cf = await openConfirm(del);
    report(cf.open && cf.inPlace && cf.focused && cf.button.startsWith('Delete'), 'Delete plan: the strip opens in its place', JSON.stringify(cf));
    report(await tab.evaluate(`getComputedStyle(${ARM(del)}.querySelector('[data-arm-yes]')).backgroundColor !== getComputedStyle(${ARM(del)}.querySelector('[data-arm-cancel]')).backgroundColor`),
        'its confirm button has the danger style');
    report(Object.values(club().sheets).some(x => x.plan === slowPlan), 'nothing deleted until the button is pressed');
    pressed = await pressConfirm(del);
    report(pressed.post?.url === '/manage/sheet/delete' && await pathOf() === '/manage/team/rollers'
        && !Object.values(club().sheets).some(x => x.plan === slowPlan), 'Delete plan deletes it and goes back to the team page', `${JSON.stringify(pressed.post)} ${await flash()}`);
    report(!tab.logs.length && !(await tab.evaluate('window.__csp')).length, 'confirms without errors', tab.logs.join('; '));

    // ---- 7b: the team settings' race day and time (user, 22 Nov 2026): one card, one form; the
    // weekly fields hide while special is checked; an emptied weekly start time asks in place (S11,
    // Rollers races tonight), with special checked the hidden field asks nothing ----
    tab.logs.length = 0;
    await open('/manage/team/rollers/settings');
    const RHYTHM = 'f => f.querySelector("input[name=action][value=rhythm]")';
    const card = JSON.parse(await tab.evaluate(`JSON.stringify((() => {
      const forms = [...document.querySelectorAll('form')].filter(f => f.querySelector('input[name=action][value=rhythm], input[name=action][value=start], input[name=action][value=kind]'));
      const f = forms[0], weekly = f?.querySelector('[data-weekly]');
      return {forms: forms.length, cards: document.querySelectorAll('#rhythm-h').length, old: document.querySelectorAll('#start-h, #kind-h').length,
        heading: document.getElementById('rhythm-h')?.textContent ?? null, start: weekly?.querySelector('input[name=start]')?.value ?? null,
        day: weekly?.querySelector('select[name=weekday]')?.value ?? null, shown: weekly ? !weekly.hidden : null, armed: f?.matches('[data-arm]') ?? null};
    })())`));
    report(card.forms === 1 && card.cards === 1 && card.old === 0 && card.heading === 'Race day and time' && card.start === '19:30' && card.day === '4'
        && card.shown && card.armed, 'team settings: race day and time is one card with one form, weekday and start under weekly', JSON.stringify(card));
    const weeklyShown = () => tab.evaluate(`!${ARM(RHYTHM)}.querySelector('[data-weekly]').hidden`);
    await clickAt(await rectOf(`${ARM(RHYTHM)}.querySelector('input[name=kind][value=special]').closest('label')`));
    const hiddenAtSpecial = !(await weeklyShown());
    await clickAt(await rectOf(`${ARM(RHYTHM)}.querySelector('input[name=kind][value=weekly]').closest('label')`));
    report(hiddenAtSpecial && await weeklyShown(), 'the weekly fields hide while special is checked, and come back');
    // weekly, the start emptied: Save asks in place, nothing is posted
    await tab.evaluate(`(() => { const i = ${ARM(RHYTHM)}.querySelector('input[name=start]'); i.value = ''; i.dispatchEvent(new Event('input', {bubbles: true})); })()`);
    tab.posts.length = 0;
    cf = await openConfirm(RHYTHM);
    report(cf.open && cf.focused && cf.button === 'Clear start time' && tab.posts.length === 0 && club().teams.rollers.start === '19:30',
        'an emptied weekly start time asks in place first (S11)', JSON.stringify({cf, posts: tab.posts.length}));
    await key('Escape', 'Escape', 27);
    // special checked, the start still empty: Save posts at once (held here by the page, so nothing changes)
    await clickAt(await rectOf(`${ARM(RHYTHM)}.querySelector('input[name=kind][value=special]').closest('label')`));
    await tab.evaluate(`(() => { window.__rhythmPost = false; document.addEventListener('submit', e => { window.__rhythmPost = true; e.preventDefault(); }); })()`);
    await clickAt(await rectOf(`${ARM(RHYTHM)}.querySelector('[data-arm-open]')`));
    await sleep(500);
    const special = JSON.parse(await tab.evaluate(`JSON.stringify({posted: window.__rhythmPost, open: !${ARM(RHYTHM)}.querySelector('[data-arm-strip]').hidden})`));
    report(special.posted && !special.open, 'with special checked the hidden start time asks nothing: Save posts at once', JSON.stringify(special));
    report(!tab.logs.length && !(await tab.evaluate('window.__csp')).length, 'race day and time without errors', tab.logs.join('; '));
    await open('/manage/team/rollers');

    // ---- 9: arm in place, by keyboard and touch: Esc, the 450 ms guard, one strip at a time; a
    // switch before the gate goes at once and Make live of the version before takes it back (no
    // Undo); shots of the strips ----
    tab.logs.length = 0;
    // two more plans of tonight's race with the live plan's riders (no move, no mark: before the gate
    // they go at once)
    const liveRiders = Object.keys(club().sheets[liveOf('rollers')].json.riders);
    for (const type of ['spare', 'easy']) {
        srv.store.change(CID, cl => uploadSheet(cl, {
            slug: 'rollers', json: planJson(`Rollers ${type}`, liveRiders), text: null, date: '2026-11-19', as: 'new', type, live: false,
            base: cl.teams.rollers.version, pinnedEventId: null, via: 'file',
        }, {now: NOW, newId: () => randomId(6)}));
    }
    // the panel's Make live of a version picked (at 1280, where the list with its ⋯ stands beside it)
    const idOfType = type => Object.entries(club().sheets).find(([, sh]) => sh.team === 'rollers' && sh.type === type)[0];
    const spareId = idOfType('spare');
    const easyId = idOfType('easy');
    const spareRow = slowPanel;
    const easyMenu = `f => f.closest("#menu-plan-${club().sheets[easyId].plan}") && f.getAttribute("action") === "/manage/sheet/delete"`;
    await open(`/manage/team/rollers?v=${spareId}`, {w: 1280});
    // the keyboard: Enter on the trigger arms it, Esc closes it and gives the focus back
    await tab.evaluate(`${ARM(spareRow)}.querySelector('[data-arm-open]').focus()`);
    await key('Enter', 'Enter', 13, '\r');
    await sleep(500);
    let st = JSON.parse(await tab.evaluate(strip(spareRow)));
    report(st.open && st.focused && st.described && st.group, 'Enter on Make live opens its strip, the confirm button focused', JSON.stringify(st));
    await key('Escape', 'Escape', 27);
    await sleep(200);
    st = JSON.parse(await tab.evaluate(strip(spareRow)));
    report(!st.open && await tab.evaluate(`document.activeElement === ${ARM(spareRow)}.querySelector('[data-arm-open]')`), 'Esc closes it, the focus back on Make live', JSON.stringify(st));
    // Cancel closes it too
    cf = await openConfirm(spareRow);
    await clickAt(await rectOf(`${ARM(spareRow)}.querySelector('[data-arm-cancel]')`, false));
    await sleep(200);
    report(cf.open && !JSON.parse(await tab.evaluate(strip(spareRow))).open, 'Cancel closes it');
    // a double tap: the second press lands on the confirm button within 450 ms and is ignored
    tab.posts.length = 0;
    const liveBefore = liveOf('rollers');
    await clickAt(await rectOf(`${ARM(spareRow)}.querySelector('[data-arm-open]')`));
    await clickAt(await rectOf(`${ARM(spareRow)}.querySelector('[data-arm-yes]')`, false));
    await sleep(600);
    st = JSON.parse(await tab.evaluate(strip(spareRow)));
    report(st.open && tab.posts.length === 0 && liveOf('rollers') === liveBefore, 'a press of the confirm button within 450 ms of arming is ignored', `${tab.posts.length} posts ${JSON.stringify(st)}`);
    // one strip at a time: the Delete in another plan's ⋯ closes the panel's
    cf = await openConfirm(easyMenu);
    st = JSON.parse(await tab.evaluate(strip(spareRow)));
    report(cf.open && cf.others === 0 && !st.open, 'opening another strip closes the first', JSON.stringify({cf, st}));
    await key('Escape', 'Escape', 27);
    await key('Escape', 'Escape', 27);
    // Remove a rider: the strip's words follow the field when it is edited after arming (review M3)
    await open('/manage/settings');
    await tab.evaluate('(() => { const i = document.querySelector("input[name=zwiftId]"); i.value = "1003"; })()');
    await openConfirm('f => f.getAttribute("action") === "/manage/rider/remove"');
    await tab.evaluate('(() => { const i = document.querySelector("input[name=zwiftId]"); i.focus(); i.setSelectionRange(4, 4); })()');
    await tab.send('Input.insertText', {text: '4'});
    await sleep(200);
    report(await tab.evaluate('document.querySelector("[data-arm-fill=zwiftId]").textContent') === '10034', 'the Remove strip names the Zwift ID as edited after arming',
        await tab.evaluate('document.querySelector("[data-arm-fill=zwiftId]").textContent'));
    await key('Escape', 'Escape', 27);
    await open('/manage/team/rollers');
    // shots of open strips at 390 and 1280
    if (shotsDir) {
        for (const w of [390, 1280]) {
            await open(`/manage/team/rollers?v=${spareId}`, {w});
            await openConfirm(spareRow);
            await shootView(`captain-team-armed-${w}-light.png`);
            await open('/manage/team/rollers/settings', {w});
            await openConfirm('f => f.closest(".danger-zone")');
            await shootView(`captain-team-settings-armed-${w}-light.png`);
            await open('/manage/settings', {w});
            await tab.evaluate('(() => { const i = document.querySelector("input[name=zwiftId]"); i.value = "1003"; })()');
            await openConfirm('f => f.getAttribute("action") === "/manage/rider/remove"');
            report((await tab.evaluate('document.querySelector("[data-arm-fill=zwiftId]").textContent')) === '1003', `at ${w} Remove a rider names the Zwift ID typed`);
            await shootView(`captain-club-settings-armed-${w}-light.png`);
        }
        await open('/manage/team/rollers');
    }
    // a double click on the strip's confirm button, past the 450 ms guard: one POST (review M1)
    const easyRow = slowPanel;
    await open(`/manage/team/rollers?v=${easyId}`);
    await openConfirm(easyRow);
    tab.posts.length = 0;
    const yesAt = await rectOf(`${ARM(easyRow)}.querySelector('[data-arm-yes]')`, false);
    const answered = tab.once('Page.loadEventFired', 4000);
    await clickAt(yesAt);
    await clickAt(yesAt);
    await answered;
    await sleep(500);
    report(tab.posts.filter(x => x.url === '/manage/live').length === 1 && !(await flash()).includes('Nothing was changed'), 'a double click on the confirm button posts once',
        `${JSON.stringify(tab.posts)} ${await flash()}`);
    // before the gate (18:40), a switch with nothing to warn about goes at once (no Undo, user 23 Nov
    // 2026): Axles, 19:30, two plans of riders no other team lists
    let axles = null;
    srv.store.change(CID, cl => {
        axles = addTeam(cl, {name: 'Axles', start: '19:30'}, {slugTaken: s2 => srv.store.slugTaken(s2), now: NOW});
        for (const [type, live] of [['a', true], ['b', false]]) {
            uploadSheet(cl, {slug: axles, json: planJson(`Axles ${type}`, ['2001', '2002', '2003']), text: null, date: '2026-11-19', as: 'new', type, live,
                base: cl.teams[axles].version, pinnedEventId: null, via: 'file'}, {now: NOW, newId: () => randomId(6)});
        }
    });
    clock.now = T('2026-11-19T17:40:00Z');
    const axlesB = Object.entries(club().sheets).find(([, sh]) => sh.team === axles && sh.type === 'b')[0];
    const axlesA = Object.entries(club().sheets).find(([, sh]) => sh.team === axles && sh.type === 'a')[0];
    await open(`/manage/team/${axles}?v=${axlesB}`);
    const plainRow = 'document.querySelector("#panel-acts form[action=\'/manage/live\']:not([data-arm]) [type=submit]")';
    const hasPlain = await tab.evaluate(`${plainRow} !== null`);
    report(hasPlain, 'before the gate the panel\'s Make live is a plain button');
    // where the panel and its flash are once the page has come back (#panel): in the viewport, below
    // the sticky top bar; nothing of an Undo on the page
    const placed = `JSON.stringify((() => {
      const row = document.getElementById('panel'), line = row?.querySelector('.flash');
      const bar = [...document.querySelectorAll('.topbar')].find(b => b.getClientRects().length && getComputedStyle(b).position === 'sticky');
      const r = (line ?? row).getBoundingClientRect();
      return {hash: location.hash, id: row?.id ?? null, text: line?.querySelector('p')?.textContent ?? '', form: Boolean(line?.querySelector('form')),
        undo: Boolean(document.querySelector('form[action="/manage/live/undo"], [data-row-undo], .cp-undo, .flash.undo')),
        top: Math.round(r.top), bottom: Math.round(r.bottom), ih: innerHeight, bar: bar ? Math.round(bar.getBoundingClientRect().bottom) : 0,
        topFlash: [...document.querySelectorAll('.flash')].some(f => !f.closest('#panel'))};
    })())`;
    for (const w of hasPlain ? [390, 1280] : []) {
        await open(`/manage/team/${axles}?v=${axlesB}`, {w});
        const was = liveOf(axles);
        tab.posts.length = 0;
        await tab.evaluate('scrollTo(0, document.documentElement.scrollHeight)');
        await follow(`${plainRow}.click()`);
        let at = JSON.parse(await tab.evaluate(placed));
        report(liveOf(axles) !== was && !/confirm=/.test(tab.posts.at(-1)?.body ?? 'confirm=') && at.text.endsWith('is live for Axles.') && !at.form && !at.undo
            && !at.topFlash && at.hash === `#${at.id}`,
            `at ${w} it goes live at once and lands on the panel, its flash there without an Undo, no other flash`, JSON.stringify(at));
        report(at.top >= at.bar && at.bottom <= at.ih, `at ${w} the panel's flash is in view, below the top bar`, JSON.stringify(at));
        if (shotsDir) {
            await shootView(`captain-team-switch-${w}-light.png`);
        }
        // the way back: the version live before, opened, and its own Make live (before the gate: at once)
        await open(`/manage/team/${axles}?v=${axlesA}`, {w});
        await follow(`${plainRow}.click()`);
        at = JSON.parse(await tab.evaluate(placed));
        report(liveOf(axles) === was && at.text === '\'Axles · a\' v1 is live for Axles.' && !at.form && !at.undo && !at.topFlash && at.top >= at.bar && at.bottom <= at.ih,
            `at ${w} Make live of the version before makes it live again, said in its panel`, JSON.stringify(at));
    }
    clock.now = NOW;
    srv.store.change(CID, cl => deleteTeam(cl, axles, NOW));
    report(!tab.logs.length && !(await tab.evaluate('window.__csp')).length, 'arm in place without errors', tab.logs.join('; '));

    // ---- 11: races (races spec §4, §7): Rollers' second race on Sun 22 Nov 18:00 (event link 5123456;
    // 'Rollers · sunday' live, 'Rollers · sunday B'), Sprockets' race of Wed 18 Nov (over, one plan,
    // stored before it); all of it goes again at the end ----
    {
        const sun = '2026-11-22';
        const sunRiders = ['1001', '1002', '1003', '1004', '1005', '1006'];
        let sunLive = null;
        let sunB = null;
        let sprOld = null;
        srv.store.change(CID, cl => {
            for (const [type, live] of [['sunday', true], ['sunday B', false]]) {
                const id = uploadSheet(cl, {slug: 'rollers', json: planJson(`Rollers ${type}`, sunRiders), text: null, date: sun, as: 'new', type, live,
                    base: cl.teams.rollers.version, pinnedEventId: null, via: 'file'}, {now: NOW, newId: () => randomId(6)}).id;
                if (live) {
                    sunLive = id;
                } else {
                    sunB = id;
                }
            }
            setRace(cl, 'rollers', sun, {to: sun, start: '18:00'}, NOW);
            setRaceEvent(cl, 'rollers', sun, 5123456, NOW);
            // (an over race takes no new plan: stored the day before it)
            sprOld = upload(cl, 'sprockets', {riders: ['1007', '1008', '1009'], at: T('2026-11-17T20:00:00Z'), date: '2026-11-18'});
        });
        const sunLivePlan = club().sheets[sunLive].plan;
        const sunBPlan = club().sheets[sunB].plan;
        const sprOldPlan = club().sheets[sprOld].plan;
        const raceOfRollers = date => club().teams.rollers.races[date] ?? null;
        report(raceOfRollers(sun)?.live === sunLive && raceOfRollers(sun)?.start === '18:00' && raceOfRollers(sun)?.pinnedEventId === 5123456
            && club().teams.sprockets.races['2026-11-18']?.live === sprOld, '11: the fixture: Rollers races Thu 19 and Sun 22 Nov, Sprockets raced Wed 18 Nov',
        JSON.stringify({rollers: club().teams.rollers.races, sprockets: club().teams.sprockets.races}));

        // 11a: both races on the Rollers page, the later one without a fold (user, 24 Nov 2026); at 390 it fits and its
        // controls are 44 px, also with the later race's ⋯ and a plan ⋯ open
        tab.logs.length = 0;
        await open('/manage/team/rollers');
        await clean('/manage/team/rollers (two races)');
        const races = JSON.parse(await tab.evaluate(`JSON.stringify({ids: [...document.querySelectorAll('main .race[id^="race-"]')].map(r => r.id),
          fold: document.querySelector('details.fold.race-more') !== null, table: document.querySelector('#race-${sun} table') !== null,
          row: document.querySelector('#race-${sun} .cp-row.live > a.cp-link')?.getAttribute('href') ?? null})`));
        report(races.ids.join() === `race-2026-11-19,race-${sun}` && races.fold === false && races.table === false && /\?r=\d{4}-\d\d-\d\d#panel$/.test(races.row ?? ''), '11a: the team page shows #race-2026-11-19 and #race-2026-11-22, no fold and no riders table in the later race, its live row opens its card (?r=)',
            JSON.stringify(races));
        // (panelIn, summaryOf and openMenus: the ⋯ checks of 1-2)
        for (const id of [`menu-race-${sun}`, `menu-plan-${sunBPlan}`]) {
            await clickAt(await rectOf(summaryOf(id)));
            await sleep(150);
            const f = JSON.parse(await tab.evaluate(fit));
            const [[left, right] = [-1, -1]] = JSON.parse(await tab.evaluate(panelIn));
            report(JSON.parse(await tab.evaluate(openMenus)).join() === id && f.sw <= f.iw && left >= 0 && right <= f.iw && !f.small.length,
                `11a: with ${id} open the page fits 390 px and its controls are 44 px`, `left ${left}, right ${right}, scrollWidth ${f.sw}; ${f.small.join(' | ')}`);
            if (shotsDir) {
                // the open ⋯ in view, its button near the top
                await tab.evaluate(`window.scrollBy(0, ${summaryOf(id)}.getBoundingClientRect().top - 140)`);
                await sleep(200);
                await shootView(id.startsWith('menu-race') ? 'captain-race-menu-390-light.png' : 'captain-plan-menu-390-light.png');
            }
            await key('Escape', 'Escape', 27);
            await sleep(100);
        }
        if (shotsDir) {
            for (const w of [390, 1280]) {
                await open('/manage/team/rollers', {w});
                await shootNow(`captain-team-races-${w}-light.png`, w);
            }
        }

        // 11b: the race ⋯ opens, closes on Esc (the focus back on its button) and on a click outside;
        // while it is open the guarded reload waits
        await open('/manage/team/rollers');
        const raceMenu = `menu-race-${sun}`;
        await clickAt(await rectOf(summaryOf(raceMenu)));
        await sleep(150);
        const opened = await tab.evaluate(openMenus);
        await key('Escape', 'Escape', 27);
        await sleep(100);
        report(opened === JSON.stringify([raceMenu]) && await tab.evaluate(openMenus) === '[]' && await tab.evaluate(`document.activeElement === ${summaryOf(raceMenu)}`),
            '11b: the race ⋯ opens; Esc closes it, the focus back on its button', opened);
        await clickAt(await rectOf(summaryOf(raceMenu)));
        await sleep(150);
        await clickAt({x: 5, y: 400, width: 1, height: 1});
        await sleep(150);
        report(await tab.evaluate(openMenus) === '[]', '11b: a click outside closes the race ⋯');
        await clickAt(await rectOf(summaryOf(raceMenu)));
        await sleep(150);
        await tab.evaluate('document.activeElement.blur(); window.__mark = 1');
        await sleep(35000);
        report(await tab.evaluate('window.__mark') === 1 && await tab.evaluate(openMenus) === JSON.stringify([raceMenu]), '11b: no reload while the race ⋯ is open');
        await key('Escape', 'Escape', 27);
        await sleep(100);

        // 11c: "Save date and time…" in the Sunday race's ⋯ asks in its place, its words the date and
        // time typed; the confirm posts confirm=1 and the page lands on the race at its new date
        const whenOf = date => `f => f.getAttribute("action") === "/manage/race" && f.querySelector("input[name=action][value=when]") && f.querySelector("input[name=date]").value === "${date}"`;
        const typeIn = (pick, values) => tab.evaluate(`(() => { const f = ${ARM(pick)};
          for (const [name, value] of ${JSON.stringify(Object.entries(values))}) { const i = f.querySelector('input[name=' + name + ']'); i.value = value;
            i.dispatchEvent(new Event('input', {bubbles: true})); i.dispatchEvent(new Event('change', {bubbles: true})); } })()`);
        await open('/manage/team/rollers');
        await openMenuOf(whenOf(sun));
        await typeIn(whenOf(sun), {to: '2026-11-29', start: '18:30'});
        tab.posts.length = 0;
        cf = await openConfirm(whenOf(sun));
        const moveWords = await tab.evaluate(`document.getElementById(${ARM(whenOf(sun))}.querySelector('[data-arm-yes]').getAttribute('aria-describedby')).textContent`);
        report(cf.open && cf.inPlace && cf.focused && cf.button === 'Move the race' && moveWords === 'Moves the race and its plans to Sun 29 Nov 18:30.' && tab.posts.length === 0,
            '11c: Save date and time asks in its place with the date and time typed', JSON.stringify({cf, moveWords}));
        report(raceOfRollers(sun) !== null && raceOfRollers('2026-11-29') === null, '11c: nothing moved until the button is pressed');
        pressed = await pressConfirm(whenOf(sun));
        const landed = JSON.parse(await tab.evaluate('JSON.stringify({hash: location.hash, path: location.pathname, there: Boolean(document.getElementById("race-2026-11-29"))})'));
        const plansOn = date => Object.values(club().sheets).filter(x => x.team === 'rollers' && x.date === date).map(x => x.plan).sort().join();
        report(pressed.post?.url === '/manage/race' && /(^|&)confirm=1(&|$)/.test(pressed.post.body) && landed.hash === '#race-2026-11-29' && landed.path === '/manage/team/rollers'
            && landed.there && (await flash()).startsWith('Race moved to Sun 29 Nov 18:30.'), '11c: the confirm posts confirm=1, the page lands on #race-2026-11-29 with the flash',
        `${JSON.stringify(pressed.post)} ${JSON.stringify(landed)} ${JSON.stringify(await flash())}`);
        const moved = raceOfRollers('2026-11-29');
        report(raceOfRollers(sun) === null && moved?.start === '18:30' && moved?.live === sunLive && moved?.pinnedEventId === 5123456
            && plansOn('2026-11-29') === [sunLivePlan, sunBPlan].sort().join(), '11c: the store has the race on Sun 29 Nov at 18:30 with both plans, its live plan and its link',
        JSON.stringify(moved));

        // 11d: without the script the same POST gets the server's question page; confirming there
        // moves the race back
        const plainRace = await chrome.newTab();
        await plainRace.send('Emulation.setScriptExecutionDisabled', {value: true});
        await open('/manage/team/rollers', {on: plainRace});
        const rdoc = await plainRace.send('DOM.getDocument', {depth: -1});
        const nodeIn = async (doc, selector) => (await plainRace.send('DOM.querySelector', {nodeId: doc.result.root.nodeId, selector})).result?.nodeId ?? 0;
        const tapIn = async nodeId => {
            await plainRace.send('DOM.scrollIntoViewIfNeeded', {nodeId});
            const box = (await plainRace.send('DOM.getBoxModel', {nodeId})).result.model.content;
            for (const type of ['mousePressed', 'mouseReleased']) {
                await plainRace.send('Input.dispatchMouseEvent', {type, x: (box[0] + box[2]) / 2, y: (box[1] + box[5]) / 2, button: 'left', clickCount: 1});
            }
        };
        await tapIn(await nodeIn(rdoc, '#menu-race-2026-11-29 > summary'));
        await sleep(200);
        const whenForm = 'form[action="/manage/race"]:has(input[name=action][value=when]):has(input[name=date][value="2026-11-29"])';
        await plainRace.evaluate(`(() => { const f = document.querySelector(${JSON.stringify(whenForm)}); f.querySelector('input[name=to]').value = '${sun}';
          f.querySelector('input[name=start]').value = '18:00'; })()`);
        plainRace.posts.length = 0;
        let pageAt = plainRace.once('Page.loadEventFired');
        await tapIn(await nodeIn(rdoc, `${whenForm} [data-arm-open]`));
        await pageAt;
        await sleep(250);
        const asked = await pageText(plainRace);
        report(plainRace.posts.at(-1)?.url === '/manage/race' && !/confirm=/.test(plainRace.posts.at(-1).body) && asked.includes('Move this race?')
            && raceOfRollers('2026-11-29') !== null, '11d: without the script the POST gets the server\'s question page; nothing moved yet', JSON.stringify(asked.slice(0, 240)));
        const qdoc = await plainRace.send('DOM.getDocument', {depth: -1});
        pageAt = plainRace.once('Page.loadEventFired');
        await tapIn(await nodeIn(qdoc, 'form[action="/manage/race"] [type=submit]'));
        await pageAt;
        await sleep(250);
        const back = raceOfRollers(sun);
        report(/(^|&)confirm=1(&|$)/.test(plainRace.posts.at(-1)?.body ?? '') && raceOfRollers('2026-11-29') === null && back?.start === '18:00' && back?.live === sunLive
            && plansOn(sun) === [sunLivePlan, sunBPlan].sort().join(), '11d: confirming there moves the race back to Sun 22 Nov 18:00, without the script',
        `${JSON.stringify(plainRace.posts.at(-1))} ${JSON.stringify(back)}`);
        plainRace.close();

        // 11e: a plan ⋯'s Rename changes its block's label; its Make live in the panel acts at once
        // here, as the Make live rule says (the race's gate is closed and nothing warns), and the other
        // race keeps its own live plan
        await open('/manage/team/rollers');
        await clickAt(await rectOf(summaryOf(`menu-plan-${sunBPlan}`)));
        await sleep(150);
        await tab.evaluate(`(() => { const i = document.querySelector('#menu-plan-${sunBPlan} form[action="/manage/plan/rename"] input[name=type]'); i.focus(); i.select(); })()`);
        await tab.send('Input.insertText', {text: 'sunday C'});
        await follow(`document.querySelector('#menu-plan-${sunBPlan} form[action="/manage/plan/rename"] [type=submit]').click()`);
        const renamed = await tab.evaluate(`document.querySelector('#plan-${sunBPlan} .label')?.textContent ?? ''`);
        report(renamed === 'sunday C' && club().sheets[sunB].type === 'sunday C' && (await flash()) === 'Renamed to \'Rollers · sunday C\'.',
            '11e: Rename in the plan\'s ⋯ changes the row\'s label', `${JSON.stringify(renamed)} ${JSON.stringify(await flash())}`);
        const liveThu = raceOfRollers('2026-11-19').live;
        const sunMake = '#panel-acts form[action="/manage/live"]';
        await open(`/manage/team/rollers?v=${sunB}`);
        const asks = await tab.evaluate(`document.querySelector('${sunMake}')?.hasAttribute('data-arm') ?? null`);
        tab.posts.length = 0;
        await follow(`document.querySelector('${sunMake} [type=submit]').click()`);
        report(asks === false && tab.posts.at(-1)?.url === '/manage/live' && raceOfRollers(sun).live === sunB && raceOfRollers('2026-11-19').live === liveThu,
            '11e: its Make live acts at once (gate closed, nothing to warn); Sun 22 Nov gets it, Thu 19 Nov keeps its own live plan',
        JSON.stringify({asks, post: tab.posts.at(-1), sun: raceOfRollers(sun).live, thu: raceOfRollers('2026-11-19').live}));
        // no Undo of that switch (user, 23 Nov 2026): not on Sunday's live row on the bare page, not in
        // Sunday's card swapped in by a click on that row, not after a swap away (Thursday's row at
        // 1280, the sheet's ✕ at 390); no row of the list holds a form
        const undoAt = `JSON.stringify({undo: document.querySelectorAll('form[action="/manage/live/undo"], [data-row-undo], .cp-undo, .flash.undo').length,
          rowForms: document.querySelectorAll('.cp-list .cp-row form').length, url: location.pathname + location.search})`;
        await open('/manage/team/rollers', {w: 1280});
        const bare11 = JSON.parse(await tab.evaluate(undoAt));
        await tab.evaluate(`document.querySelector('.cp-row[data-sel="v:${sunB}"] > a.cp-link').click()`);
        await sleep(1200);
        const inCard = JSON.parse(await tab.evaluate(undoAt));
        await tab.evaluate(`document.querySelector('.cp-row[data-sel="v:${liveThu}"] > a.cp-link').click()`);
        await sleep(1200);
        const away = JSON.parse(await tab.evaluate(undoAt));
        await open(`/manage/team/rollers?r=${sun}`, {w: 390});
        const landedAt = JSON.parse(await tab.evaluate(undoAt));
        await tab.evaluate('document.querySelector("#panel a.cp-close").click()');
        await sleep(1200);
        const awayPhone = JSON.parse(await tab.evaluate(undoAt));
        report([bare11, inCard, away, landedAt, awayPhone].every(x => x.undo === 0 && x.rowForms === 0) && inCard.url === `/manage/team/rollers?r=${sun}`,
            '11e: no Undo of the later race\'s switch, on its row, in its card or after a swap away; no row holds a form', JSON.stringify({bare11, inCard, away, landedAt, awayPhone}));

        // 11f: Sprockets' race of Wed 18 Nov is under Over, without a race ⋯; its plan's ⋯ offers Delete
        // only, its version's panel is read only
        tab.logs.length = 0;
        await open('/manage/team/sprockets');
        const over = JSON.parse(await tab.evaluate(`JSON.stringify({text: document.getElementById('over')?.innerText.replace(/\\s+/g, ' ').trim() ?? null,
          raceMenu: Boolean(document.getElementById('menu-race-2026-11-18')), planMenu: Boolean(document.querySelector('#over #menu-plan-${sprOldPlan}')),
          link: Boolean(document.querySelector('#over a[href="/manage/team/sprockets?r=2026-11-18#panel"]'))})`));
        report(over.text === 'Over (1)' && !over.raceMenu && over.planMenu && over.link, '11f: Wed 18 Nov is under Over, without a race ⋯', JSON.stringify(over));
        await tab.evaluate('document.getElementById("over").open = true');
        report((await tab.evaluate('document.getElementById("over").innerText')).includes('Wed 18 Nov'), '11f: the Over fold names the race and its plan');
        const offers = JSON.parse(await tab.evaluate(`JSON.stringify({forms: [...document.querySelectorAll('#over details[data-menu] form')].map(f => f.getAttribute('action')),
          links: [...document.querySelectorAll('#over details[data-menu] a')].map(a => a.textContent.trim())})`));
        report(offers.forms.join() === '/manage/sheet/delete' && offers.links.length === 0, '11f: the plan ⋯ of an over race offers Delete only', JSON.stringify(offers));
        await open(`/manage/team/sprockets?v=${sprOld}`);
        const readOnly = await tab.evaluate('!document.querySelector("#panel-acts form[action=\'/manage/live\']") && Boolean(document.querySelector("#panel-body .cp-over"))');
        report(readOnly, '11f: its version\'s panel is read only');
        await clean(`/manage/team/sprockets?v=${sprOld} (over)`);

        // 11g: the Store form of a plan pushed for Rollers, as a new plan (a version takes its plan's race,
        // user 23 Nov 2026): the race radios first in its race fold, after the plans, the nearest
        // checked; choosing the other race redraws it once, in place
        const pushed = srv.store.change(CID, cl => receiveEntry(cl, {team: 'rollers', via: 'zwiftgopher', json: planJson('Rollers', ['1001', '1002', '1003']), text: null},
            {now: NOW, newId: () => randomId(6)}));
        tab.logs.length = 0;
        await open(`/manage/team/rollers?e=${pushed}&team=rollers&as=new&drawn=rollers:new`);
        const radios = `JSON.stringify((() => {
          const rs = [...document.querySelectorAll('${F} input[name=race]')], plans = document.querySelector('${F} input[name=as]')?.closest('fieldset');
          const set = rs[0]?.closest('fieldset');
          return {values: rs.map(r => r.value), checked: rs.filter(r => r.checked).map(r => r.value), startFor: document.querySelector('${F} input[name=startFor]')?.value ?? null,
            inFold: Boolean(set && plans) && set.closest('details.as-race') !== null && Boolean(plans.compareDocumentPosition(set) & Node.DOCUMENT_POSITION_FOLLOWING),
            legend: set?.querySelector('legend')?.textContent ?? null,
            // the start time is prefilled (the race's own, else the team's), with no hint under it (user, 22 Nov 2026)
            time: document.querySelector('${F} input[name=start]')?.value ?? null, timeHint: Boolean(document.querySelector('${F} input[name=start]')?.closest('label')?.querySelector('.hint'))};
        })())`;
        const choice = JSON.parse(await tab.evaluate(radios));
        report(choice.values.join() === `2026-11-19,${sun}` && choice.checked.join() === '2026-11-19' && choice.inFold && choice.legend === 'Race' && choice.startFor === '2026-11-19'
            && choice.time === '19:30' && choice.timeHint === false,
            '11g: a pushed plan\'s Store form, as a new plan, has the race radios in its race fold after the plans, the nearest checked', JSON.stringify(choice));
        fs0 = await foldState();
        report(fs0?.open === false && fs0.last && fs0.summary.startsWith('Race: Thu 19 Nov · 19:30') && fs0.summary.endsWith(' · Change'),
            '11g: the nearest race checked: the race fold closed, its summary naming that race', JSON.stringify(fs0));
        await clean(`/manage/team/rollers?e=${pushed} (race choice)`);
        redrawn = await inPlace(`document.querySelector('${F} input[name=race][value="${sun}"]').click()`);
        const after = JSON.parse(await tab.evaluate(radios));
        report(redrawn.asked === 1 && redrawn.loads === 0 && /[?&]race=2026-11-22(&|$)/.test(await lastPanel()) && after.checked.join() === sun && after.startFor === sun
            && after.time === '18:00' && after.timeHint === false,
            '11g: choosing the other race redraws the form once, in place, drawn for that race, with that race\'s time prefilled', `${JSON.stringify(redrawn)}, ${await lastPanel()}, ${JSON.stringify(after)}`);
        fs0 = await foldState();
        report(fs0?.open === true && fs0.summary === 'Race: Sun 22 Nov · 18:00 · Event 5123456 · Change',
            '11g: another race than the next one: the race fold drawn open, its summary naming that race and its event', JSON.stringify(fs0));
        report(!tab.logs.length && !(await tab.evaluate('window.__csp')).length, '11: the races checks without errors', tab.logs.join('; '));

        // 11h: a second tab moves the Sunday race to 17:00 while this Store form, drawn at 18:00, is
        // open; its Store then stores nothing and redraws with 17:00 (final review I-2)
        const drawnWith = JSON.parse(await tab.evaluate(`JSON.stringify({start: document.querySelector('${F} input[name=start]')?.value ?? null,
          was: document.querySelector('${F} input[name=startWas]')?.value ?? null})`));
        const second = await chrome.newTab();
        await open('/manage/team/rollers', {on: second});
        await follow(`(() => { const f = document.createElement('form'); f.method = 'post'; f.action = '/manage/race';
          for (const [k, v] of Object.entries(${JSON.stringify({club: CID, team: 'rollers', date: sun, version: String(club().teams.rollers.version),
        action: 'when', to: sun, start: '17:00', confirm: '1'})})) {
            const i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = v; f.append(i);
          }
          document.body.append(f); f.submit(); })()`, second);
        const movedFlash = await second.evaluate('document.querySelector(".flash p")?.textContent ?? ""');
        second.close();
        const entries = club().inbox.length;
        tab.posts.length = 0;
        await follow('document.querySelector("[data-submit=store]").click()');
        const redrawnStart = JSON.parse(await tab.evaluate(`JSON.stringify({start: document.querySelector('${F} input[name=start]')?.value ?? null,
          was: document.querySelector('${F} input[name=startWas]')?.value ?? null})`));
        const staleFlash = await flash();
        report(drawnWith.start === '18:00' && drawnWith.was === '18:00' && movedFlash === 'Race moved to Sun 22 Nov 17:00.' && tab.posts.length === 1
            && staleFlash === 'Check the choices: the race\'s start time was changed meanwhile.' && raceOfRollers(sun)?.start === '17:00'
            && club().inbox.length === entries && redrawnStart.start === '17:00' && redrawnStart.was === '17:00',
        '11h: Store from a page drawn before another tab moved the race stores nothing and redraws with the race\'s time now',
        JSON.stringify({drawnWith, movedFlash, staleFlash, posts: tab.posts.length, start: raceOfRollers(sun)?.start, redrawnStart}));

        // 11i: the same pushed plan stored, not live (its Store), for a new race on Wed 25 Nov:
        // the Store flash says so in red at once, 6 days ahead, with Make live under it (spec §8)
        const wed = '2026-11-25';
        await open(`/manage/team/rollers?e=${pushed}&team=rollers&as=new&drawn=rollers:new&date=${wed}`);
        const box = await tab.evaluate(`document.querySelector("${F} input[name=live]")?.checked ?? null`);
        await follow('document.querySelector("[data-submit=store]").click()');
        const wedPlan = Object.entries(club().sheets).find(([, x]) => x.team === 'rollers' && x.date === wed)?.[0] ?? null;
        const notLive = JSON.parse(await tab.evaluate(`JSON.stringify((() => {
          const line = document.querySelector('#panel .flash.err p'), make = document.querySelector('#panel-acts form[action="/manage/live"]');
          return {line: line?.innerText.trim() ?? null, make: make?.querySelector('[type=submit]')?.textContent.trim() ?? null,
            after: Boolean(line && make && (line.compareDocumentPosition(make) & Node.DOCUMENT_POSITION_FOLLOWING)),
            sheet: make?.querySelector('input[name=sheet]')?.value ?? null};
        })())`));
        report(box === null && wedPlan !== null && raceOfRollers(wed)?.live === null && notLive.line === 'Stored as v1 of \'Rollers\'. Not live: riders get nothing until you press Make live.'
            && notLive.make === 'Make live v1 of \'Rollers\'' && notLive.after && notLive.sheet === wedPlan,
        '11i: a Store that is not live has the red line "Not live: riders get nothing" with Make live under it', JSON.stringify({box, wedPlan, race: raceOfRollers(wed), notLive}));

        // the fixture goes again
        srv.store.change(CID, cl => {
            if (cl.inbox.some(e => e.id === pushed)) {
                discardEntry(cl, pushed, NOW);
            }
            for (const id of [sunLive, sunB]) {
                deleteSheet(cl, 'rollers', id, NOW);
            }
            if (wedPlan !== null) {
                deleteSheet(cl, 'rollers', wedPlan, NOW);
            }
            deleteSheet(cl, 'sprockets', sprOld, NOW);
        });
        report(raceOfRollers(sun) === null && raceOfRollers(wed) === null && !club().teams.sprockets.races['2026-11-18'], '11: the races of the fixture are gone again');
    }

    // ---- 12: the team cockpit on its own route (team cockpit spec §5, §8) ----
    {
        const cp = '/manage/team/rollers';
        tab.logs.length = 0;                     // 11h's refused Store (a 400 it expects) stays out of these
        // the group's fixture: a second version of Rollers' live plan, stored not live, and a plan
        // pushed for Rollers; both go again at the group's end
        const livePlan = club().sheets[liveOf('rollers')].plan;
        const extra = srv.store.change(CID, cl => uploadSheet(cl, {
            slug: 'rollers', json: planJson('Rollers', ['1001', '1002', '1003', '1004', '1005']), text: null, as: livePlan, live: false,
            base: cl.teams.rollers.version, pinnedEventId: null, via: 'file',
        }, {now: NOW, newId: () => randomId(6)}).id);
        const pushedCp = srv.store.change(CID, cl => receiveEntry(cl, {team: 'rollers', via: 'zwiftgopher', json: planJson('Rollers', ['1001', '1002', '1003']), text: null},
            {now: NOW, newId: () => randomId(6)}));
        report(club().sheets[extra]?.plan === livePlan && liveOf('rollers') !== extra && club().inbox.some(e => e.id === pushedCp),
            '12: the fixture: a version of the live plan not live, a plan pushed for Rollers', JSON.stringify({extra, pushedCp}));
        const picked = Object.entries(club().sheets).find(([id, x]) => x.team === 'rollers' && x.date === '2026-11-19' && id !== liveOf('rollers'))?.[0];
        report(typeof picked === 'string', '12: Rollers has a version that is not live to pick', String(picked));
        const layout = `JSON.stringify((() => {
          const box = s => {
            const el = document.querySelector(s);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return {l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), shown: el.getClientRects().length > 0};
          };
          // the card (team cockpit spec §5.3b): its top in #panel, its body in #panel-body; its title,
          // the rider states in it, the list's live row
          const title = document.querySelector('#panel .cp-title')?.textContent ?? '';
          const liveRow = document.querySelector('.cp-row.live > a.cp-link')?.textContent.trim() ?? '';
          return {list: box('.cp-list'), top: box('#panel .cp-top'), card: box('.cp-body'), cls: document.body.className, title,
            states: document.querySelectorAll('.cp-body .rstates').length, cards: document.querySelectorAll('.cp-top, #riders').length, liveRow};
        })())`;
        for (const p of [cp, `${cp}?v=${picked}`]) {
            for (const w of [390, 1280]) {
                await open(p, {w});
                await clean(`12a: ${p} at ${w}`, {wide: w === 1280});
                if (w === 1280) {
                    const at = JSON.parse(await tab.evaluate(layout));
                    report(Boolean(at.top?.shown && at.card?.shown && at.list && at.top.l > at.list.r && at.card.l === at.top.l && at.cards === 1),
                        `12a: ${p} at 1280: one card, right of .cp-list`, JSON.stringify(at));
                }
            }
        }
        // the phone, nothing picked: the card (the nearest race's live version, its riders) right after
        // the nearest race, before the rest of the list (the later races, Over, "How races work"), as on
        // the old team page (M1); no sheet is open
        await open(cp, {w: 390});
        const phoneOrder = JSON.parse(await tab.evaluate(`JSON.stringify((() => {
          const top = el => Math.round(el.getBoundingClientRect().top), bottom = el => Math.round(el.getBoundingClientRect().bottom);
          const kids = [...document.querySelectorAll('.cp-list > *')].filter(e => e.getBoundingClientRect().height > 0);
          const cardTop = document.querySelector('#panel .cp-top'), card = document.querySelector('.cp-body');
          // the nearest race with the box of its plans not stored yet before it (user, 24 Nov 2026): both come before the card
          const at = kids.findIndex(e => e.classList.contains('cp-race')), first = kids[at];
          return {first: first ? {cls: first.className, b: bottom(first), lead: at} : null, rest: kids.slice(at + 1).map(e => ({cls: e.className, t: top(e)})),
            card: cardTop && card && card.getClientRects().length ? {t: top(cardTop), b: bottom(card), gap: top(card) - bottom(cardTop)} : null,
            title: document.querySelector('#panel .cp-title')?.textContent ?? '', sheet: document.body.classList.contains('has-sel'),
            close: Boolean(document.querySelector('#panel a.cp-close'))};
        })())`));
        report(phoneOrder.first !== null && /\bcp-race\b/.test(phoneOrder.first.cls) && phoneOrder.card !== null && phoneOrder.card.t >= phoneOrder.first.b && phoneOrder.card.gap === 0
            && phoneOrder.rest.length > 0 && phoneOrder.rest.every(r => r.t >= phoneOrder.card.b) && phoneOrder.title.startsWith('Riders on') && !phoneOrder.sheet && !phoneOrder.close,
        '12a: at 390, nothing picked, the live card follows the nearest race, before the rest of the list, no sheet', JSON.stringify(phoneOrder));
        // the riders card after the gate is the rider table with each rider's state (Task 14): at 390
        // the state is a line under the rider's row, so pull @ target keeps its column, a long state
        // wraps, nothing is wider than the screen; in a wide card (900, the card at the page's width)
        // it is the fourth column, Plan, beside the pull
        const liveNow = liveOf('rollers');
        const longOne = Object.keys(club().sheets[liveNow].json.riders).at(-1);
        const longWas = srv.store.seenOf(CID)[longOne] ?? null;          // put back at the end of these checks
        see(longOne, '2026-11-19T18:10:00Z', {sig: 'ABC123', mod: '0.3.0', sheet: liveNow, inEvent: true, event: null});
        const planCol = `JSON.stringify((() => {
          const card = document.querySelector('.cp-body');
          const px = v => Math.round(v);
          const rows = [...card.querySelectorAll('table.rstates tbody tr:not(.pt-old)')].map(tr => {
            const pull = tr.querySelector('.pt-pull').getBoundingClientRect(), st = tr.querySelector('.rstate'), s = st.getBoundingClientRect();
            return {pullT: px(pull.top), pullR: px(pull.right), pullB: px(pull.bottom), stT: px(s.top), stL: px(s.left), stR: px(s.right),
              lines: Math.round(s.height / parseFloat(getComputedStyle(st).lineHeight)), sign: st.querySelector('.rstate-sign')?.getAttribute('aria-hidden'), text: st.textContent};
          });
          const head = card.querySelector('thead .pt-pull').getBoundingClientRect();
          return {rows, headR: px(head.right), plan: card.querySelector('thead th.rstate')?.getClientRects().length ?? null,
            sw: document.documentElement.scrollWidth, iw: innerWidth, cardR: px(card.getBoundingClientRect().right)};
        })())`;
        await open(cp, {w: 390});
        await clean('12a: the live card with a long state at 390');
        const narrow = JSON.parse(await tab.evaluate(planCol));
        const longRow = narrow.rows.find(r => r.text.includes('plan comes at the next check'));
        report(narrow.rows.length === Object.keys(club().sheets[liveNow].json.riders).length && narrow.plan === 0
            && narrow.rows.every(r => r.stT >= r.pullB - 1 && r.pullR === narrow.headR && r.stR <= narrow.cardR && r.sign === 'true')
            && longRow?.lines >= 2 && narrow.sw <= narrow.iw,
        '12a: at 390 after the gate each rider\'s state is a line under the row, pull @ target keeps its column, a long state wraps, no sideways scroll', JSON.stringify(narrow));
        await open(cp, {w: 900, h: 1000});
        const wide = JSON.parse(await tab.evaluate(planCol));
        report(wide.rows.length === narrow.rows.length && wide.plan === 1 && wide.rows.every(r => r.stT === r.pullT && r.stL >= r.pullR && r.pullR === wide.headR) && wide.sw <= wide.iw,
            '12a: at 900 the state is the fourth column, Plan, beside pull @ target', JSON.stringify(wide));
        // the rider's check as it was before (the group's fixture goes again)
        if (longWas === null) {
            srv.store.forget(CID, longOne);
        } else {
            see(longOne, longWas.at, longWas);
        }
        report(JSON.stringify(srv.store.seenOf(CID)[longOne] ?? null) === JSON.stringify(longWas), '12a: the long state\'s check is back as it was', JSON.stringify({longOne, longWas}));
        await open(`${cp}?v=${picked}`, {w: 1280});
        // the last page: the version picked at 1280, after the gate (the clock's 18:12Z): its card alone,
        // no riders card under it, no states; the list's live row says the count (spec §5.3b)
        const after = JSON.parse(await tab.evaluate(layout));
        report(/\bhas-sel\b/.test(after.cls) && Boolean(after.top?.shown && after.card?.shown) && after.cards === 1 && after.states === 0
            && !after.title.startsWith('Riders on') && / have it Live(SendingRiders get this plan now|StartedThe race has started)$/.test(after.liveRow), '12a: after the gate the picked version\'s card replaces the live one; the live row counts, its phase beside Live (user, 23 Nov 2026)', JSON.stringify(after));
        clock.now = T('2026-11-19T17:40:00Z');
        await open(`${cp}?v=${picked}`, {w: 1280});
        const before = JSON.parse(await tab.evaluate(layout));
        report(Boolean(before.card?.shown) && before.cards === 1 && !before.title.startsWith('Riders on') && !before.liveRow.includes('have it'),
            '12a: before the gate the picked version\'s card replaces the live one; no count in the live row', JSON.stringify(before));
        await open(cp, {w: 1280});
        const none = JSON.parse(await tab.evaluate(layout));
        report(Boolean(none.top?.shown && none.list && none.top.l > none.list.r) && none.title.startsWith('Riders on') && none.cards === 1,
            '12a: before the gate, nothing picked, the live version\'s card shows', JSON.stringify(none));
        clock.now = NOW;

        // the page as the script left it: the URL, the picked rows, the panel, the requests with panel=1
        const state = `JSON.stringify((() => {
          const picked = [...document.querySelectorAll('.cp-row.picked')].map(r => r.dataset.sel);
          const current = [...document.querySelectorAll('a.cp-link[aria-current]')].map(a => a.closest('.cp-row')?.dataset.sel ?? null);
          const title = document.querySelector('#panel .cp-title')?.textContent ?? '';
          return {url: location.pathname + location.search, picked, current, kind: document.getElementById('panel')?.dataset.kind ?? null,
            title, cap: Boolean(document.querySelector('#panel .cp-cap')), riders: title.startsWith('Riders on'),
            panels: performance.getEntriesByType('resource').filter(r => /[?&]panel=1(&|$)/.test(r.name)).length,
            cls: document.body.className, focus: document.activeElement?.id ?? null, hidden: document.hidden,
            focusRow: document.activeElement?.matches('a.cp-link') ? document.activeElement.closest('.cp-row')?.dataset.sel ?? null : null};
        })())`;
        const st = async () => JSON.parse(await tab.evaluate(state));
        // The tabs 6, 11d and 11h opened are still there and can come to the front again: this one in
        // front after every load, or it is hidden (its timers throttled, its reload never due); the
        // checks that need it assert !hidden
        const front = async () => {
            await tab.send('Page.bringToFront');
            await sleep(200);
        };
        const rowLink = sel => `document.querySelector('.cp-row[data-sel="${sel}"] > a.cp-link')`;
        // the team page names a version by its plan's type alone (user, 23 Nov 2026)
        const titleOf = id => `${club().sheets[id].type == null ? '' : `'${club().sheets[id].type}' `}v${club().sheets[id].n} `;

        // 12b: a version row swaps the panel in place; two rows within 50 ms end on the second
        await open(cp, {w: 1280});
        await front();
        let navs = tab.navs.count;
        await tab.evaluate(`${rowLink(`v:${extra}`)}.click()`);
        await sleep(1200);
        let s1 = await st();
        report(tab.navs.count === navs && s1.url === `${cp}?v=${extra}` && s1.cap && s1.picked.join() === `v:${extra}` && s1.current.join() === `v:${extra}`
            && s1.panels === 1 && s1.kind === 'version' && s1.title.startsWith(titleOf(extra)) && /\bhas-sel\b/.test(s1.cls) && !/\bsel-e\b/.test(s1.cls)
            && s1.focus === 'panel',
        '12b: a click on a version row swaps the panel in place (no page load, one panel request), the URL ?v=, the row picked', JSON.stringify({navs: tab.navs.count - navs, ...s1}));
        // the live version first, then another one of the race (neither the one picked already)
        const other = liveOf('rollers');
        const second = Object.entries(club().sheets).find(([id, x]) => x.team === 'rollers' && x.date === '2026-11-19' && id !== other && id !== extra)?.[0];
        await tab.evaluate(`(() => { ${rowLink(`v:${other}`)}.click(); setTimeout(() => ${rowLink(`v:${second}`)}.click(), 20); })()`);
        await sleep(1500);
        s1 = await st();
        const v = new URLSearchParams(s1.url.slice(s1.url.indexOf('?'))).get('v');
        report(!s1.hidden && tab.navs.count === navs && typeof second === 'string' && v === second && s1.picked.join() === `v:${v}` && s1.current.join() === `v:${v}` && s1.title.startsWith(titleOf(v)),
            '12b: two rows clicked within 50 ms: the URL, the picked row and the panel\'s title name the second one', JSON.stringify({navs: tab.navs.count - navs, v, ...s1}));

        // 12c: Back and Forward swap in place; before the gate Back draws the live card again
        clock.now = T('2026-11-19T17:40:00Z');
        await open(cp, {w: 1280});
        await front();
        navs = tab.navs.count;
        await tab.evaluate(`${rowLink(`v:${extra}`)}.click()`);
        await sleep(1200);
        const picked1 = await st();
        await tab.evaluate('history.back()');
        await sleep(1200);
        const backed = await st();
        await tab.evaluate('history.forward()');
        await sleep(1200);
        const forth = await st();
        clock.now = NOW;
        const liveNow12 = liveOf('rollers');
        report(picked1.url === `${cp}?v=${extra}` && !picked1.riders && backed.url === cp && backed.kind === 'version' && backed.riders
            && backed.picked.join() === `v:${liveNow12}` && backed.current.join() === `v:${liveNow12}` && !/\bhas-sel\b/.test(backed.cls) && tab.navs.count === navs,
        '12c: Back draws the live version\'s card again, its row picked, without a page load', JSON.stringify({navs: tab.navs.count - navs, picked1, backed}));
        report(forth.url === `${cp}?v=${extra}` && forth.cap && forth.kind === 'version' && forth.picked.join() === `v:${extra}` && !forth.riders
            && /\bhas-sel\b/.test(forth.cls) && tab.navs.count === navs,
        '12c: Forward draws the version again, without a page load', JSON.stringify({navs: tab.navs.count - navs, forth}));
        // back to live on a desktop is a click on the live row (no "‹ Riders", spec §5.3b): its URL the
        // race's live pointer (?r=<date>, never a version), its card, the focus on #panel
        const hasClose = await tab.evaluate('(() => { const c = document.querySelector("#panel a.cp-close"); return Boolean(c && c.getClientRects().length); })()');
        await tab.evaluate(`${rowLink(`v:${liveNow12}`)}.click()`);
        await sleep(1200);
        const gated = await st();
        report(gated.url === `${cp}?r=2026-11-19` && gated.riders && gated.picked.join() === `v:${liveNow12}` && /\bhas-sel\b/.test(gated.cls)
            && tab.navs.count === navs, '12c: a click on the live row draws its card at ?r=<race>, without a page load',
        JSON.stringify({navs: tab.navs.count - navs, gated}));
        report(!hasClose && gated.focus === 'panel', '12c: at 1280 no close link shows; after the live row\'s swap the focus is on #panel', JSON.stringify({hasClose, focus: gated.focus}));

        // 12k: the team changed behind the page's back: the fragment answers 409, the page loads whole
        await open(cp, {w: 1280});
        await front();
        navs = tab.navs.count;
        srv.store.change(CID, cl => {
            cl.teams.rollers.version++;
        });
        const loaded = tab.once('Page.loadEventFired');
        await tab.evaluate(`${rowLink(`v:${extra}`)}.click()`);
        const got = await loaded;
        await sleep(250);
        const whole = await st();
        report(got !== null && tab.navs.count === navs + 1 && whole.url === `${cp}?v=${extra}` && whole.picked.join() === `v:${extra}` && whole.kind === 'version',
            '12k: a click on a stale page loads the whole page with that row picked', JSON.stringify({navs: tab.navs.count - navs, whole}));
        // the 409 it expects stays out of the last check
        for (let i = tab.logs.length - 1; i >= 0; i--) {
            if (/status of 409/.test(tab.logs[i])) {
                tab.logs.splice(i, 1);
            }
        }

        // 12r: a refused Store (an event link that does not parse) answers at /manage/inbox/<id> with
        // the cockpit; the address bar gets the cockpit's URL, and a redraw of the form asks the
        // cockpit's panel, never /manage/inbox (the old Store a plan page); a new plan's (a version has
        // no event link, user 23 Nov 2026)
        await open(`${cp}?e=${pushedCp}&team=rollers&as=new&drawn=rollers:new&type=tempo`, {w: 1280});
        await front();
        await tab.evaluate(`document.querySelector('.cp-form input[name=event]').value = 'not a link'`);
        const refusedLoad = await follow(`document.querySelector('button[form="store-${pushedCp}"][data-submit=store]').click()`);
        const atRefusal = JSON.parse(await tab.evaluate(`JSON.stringify({url: location.pathname + location.search,
          flash: document.querySelector('#panel .flash.err')?.textContent.trim() ?? null, form: Boolean(document.getElementById('store-${pushedCp}'))})`));
        navs = tab.navs.count;
        const versionR = await tab.evaluate(`document.querySelector('.cp-form input[name=as]:not([value=new])').value`);
        await tab.evaluate(`document.querySelector('.cp-form input[name=as]:not([value=new])').click()`);
        await sleep(1500);
        const redrawnR = JSON.parse(await tab.evaluate(`JSON.stringify({url: location.pathname + location.search,
          inbox: performance.getEntriesByType('resource').filter(r => r.name.includes('/manage/inbox')).map(r => r.name),
          panels: performance.getEntriesByType('resource').filter(r => /[?&]panel=1(&|$)/.test(r.name) && r.name.includes('${cp}?')).length,
          checked: document.querySelector('.cp-form input[name=as]:checked')?.value ?? null,
          inCard: Boolean(document.querySelector('#panel-body > .cp-body > .cp-form > form[data-assign]')),
          rowAlone: [...(document.querySelector('.cp-row[data-sel="e:${pushedCp}"]')?.children ?? [])].map(e => e.localName).join()})`));
        report(refusedLoad && atRefusal.url === `${cp}?e=${pushedCp}` && atRefusal.flash !== null && atRefusal.form && tab.navs.count === navs
            && redrawnR.inbox.length === 0 && redrawnR.panels === 1 && redrawnR.checked === versionR && redrawnR.inCard && redrawnR.rowAlone === 'a' && redrawnR.url === `${cp}?e=${pushedCp}`,
        '12r: after a refused Store the address bar is the cockpit\'s, and a redraw asks its panel, never /manage/inbox', JSON.stringify({navs: tab.navs.count - navs, atRefusal, redrawnR}));
        // the 400 it expects stays out of the last check
        for (let i = tab.logs.length - 1; i >= 0; i--) {
            if (/status of 400/.test(tab.logs[i])) {
                tab.logs.splice(i, 1);
            }
        }

        // 12i: the guarded reload keeps the selection; an open Store form holds it, its close releases it.
        await open(cp, {w: 1280});
        await front();
        await tab.evaluate(`${rowLink(`v:${extra}`)}.click()`);
        await sleep(1000);
        navs = tab.navs.count;
        await sleep(35000);
        const reloaded = await st();
        report(!reloaded.hidden && tab.navs.count === navs + 1 && reloaded.url === `${cp}?v=${extra}` && reloaded.picked.join() === `v:${extra}`,
            '12i: with a version picked the page reloads after one interval and keeps ?v=', JSON.stringify({navs: tab.navs.count - navs, reloaded}));
        await open(cp, {w: 1280});
        await front();
        navs = tab.navs.count;
        await tab.evaluate(`${rowLink(`e:${pushedCp}`)}.click()`);
        await sleep(1500);
        const form = JSON.parse(await tab.evaluate(`JSON.stringify((() => {
          const f = document.getElementById('store-${pushedCp}'), b = document.querySelector('button[form="store-${pushedCp}"][data-submit=store]');
          return {inCard: Boolean(f && f.closest('#panel-body .cp-form') && !f.closest('.cp-list')), hold: Boolean(f?.matches('[data-hold-reload]')),
            owns: Boolean(f && b && !f.contains(b) && [...f.elements].includes(b))};
        })())`));
        const held0 = await st();
        await sleep(35000);
        const held = await st();
        report(!held0.hidden && !held.hidden && form.inCard && form.hold && form.owns && held0.url === `${cp}?e=${pushedCp}` && /\bhas-sel\b/.test(held0.cls) && held0.focus === 'panel'
            && tab.navs.count === navs && held.url === held0.url,
        '12i: with the Store form open (swapped in, in the card) nothing loads in 35 s', JSON.stringify({navs: tab.navs.count - navs, form, held}));
        // a click on the live row (a swap to the live version's card) releases the hold
        await tab.evaluate(`${rowLink(`v:${liveOf('rollers')}`)}.click()`);
        await sleep(1000);
        const closed = await st();
        navs = tab.navs.count;
        await sleep(7000);
        report(!closed.hidden && closed.url === `${cp}?r=2026-11-19` && closed.kind === 'version' && closed.riders && !/\bsel-e\b/.test(closed.cls) && tab.navs.count === navs + 1,
            '12i: a swap to the live row releases the hold: the page reloads within one look', JSON.stringify({navs: tab.navs.count - navs, closed}));

        // a page loaded with the Store form open (the hub's "Review and store") keeps its interval
        // (data-refresh, no meta refresh); a swap to a version lets the reload go
        await open(`${cp}?e=${pushedCp}`, {w: 1280});
        await front();
        const drawn = JSON.parse(await tab.evaluate(`JSON.stringify({refresh: document.body.dataset.refresh ?? null,
          meta: [...document.querySelectorAll('noscript')].some(n => n.textContent.includes('http-equiv'))})`));
        await tab.evaluate(`${rowLink(`v:${extra}`)}.click()`);
        await sleep(1000);
        const swapped = await st();
        navs = tab.navs.count;
        await sleep(35000);
        const resumed = await st();
        report(drawn.refresh === '30' && !drawn.meta && swapped.url === `${cp}?v=${extra}` && swapped.kind === 'version' && !resumed.hidden
            && tab.navs.count === navs + 1 && resumed.url === `${cp}?v=${extra}` && resumed.picked.join() === `v:${extra}`,
        '12i: loaded with ?e=, then a version picked: the page reloads within 35 s and keeps ?v=', JSON.stringify({drawn, navs: tab.navs.count - navs, swapped: swapped.url, resumed}));

        // 12d: the panel as a sheet at 390 (spec §5.5), with the script; a tap is the mouse at the
        // element's centre (rectOf scrolls it in), the page from its top before every measure
        const sheetJs = `JSON.stringify((() => {
          const el = s => document.querySelector(s);
          const shown = s => { const e = el(s); return e !== null && e.getBoundingClientRect().height > 0; };
          const kids = s => [...(el(s)?.children ?? [])].filter(e => e.getBoundingClientRect().height > 0).map(e => e.id || e.className.split(' ')[0] || e.tagName.toLowerCase());
          const top = s => { const e = typeof s === 'string' ? el(s) : s; if (!e) return null; const r = e.getBoundingClientRect(); return r.height > 0 ? Math.round(r.top + scrollY) : null; };
          const bottom = s => { const e = el(s); if (!e) return null; const r = e.getBoundingClientRect(); return r.height > 0 ? Math.round(r.bottom + scrollY) : null; };
          const c = el('#panel a.cp-close'), cr = c?.getBoundingClientRect();
          // the list shows when one of its blocks does: on a phone without a selection its own box goes
          // (display:contents, M1), its races and folds stay
          const listShown = [...(el('.cp-list')?.children ?? [])].some(e => e.getBoundingClientRect().height > 0);
          return {cls: document.body.className, url: location.pathname + location.search, topbar: shown('.topbar'), head: shown('.pagehead'), list: listShown,
            mainKids: kids('main'), cpKids: kids('.cp'),
            scrolled: Math.round(scrollY), closeVp: cr ? Math.round(cr.top) : null,
            close: cr ? {w: Math.round(cr.width), h: Math.round(cr.height), href: c.getAttribute('href')} : null,
            closeTop: top('#panel a.cp-close'), field: top([...document.querySelectorAll('#panel-body .cp-form form :is(input:not([type=hidden]),select,textarea)')].find(e => e.getBoundingClientRect().height > 0) ?? null),
            what: top('#panel-body .cp-what li'), table: top('#panel-body table'), store: top('#panel-acts [data-submit=store]'),
            fold: top('#panel-body .cp-form details.as-race > summary'), foldLast: el('#panel-body .cp-form form')?.lastElementChild?.matches('details.as-race') ?? null,
            storeL: el('#panel-acts [data-submit=store]') ? Math.round(el('#panel-acts [data-submit=store]').getBoundingClientRect().left) : null,
            discard: top('#panel-acts .cp-bar form.discard [data-arm-open]'),
            discardR: el('#panel-acts .cp-bar form.discard [data-arm-open]') ? Math.round(el('#panel-acts .cp-bar form.discard [data-arm-open]').getBoundingClientRect().right) : null,
            picked: [...document.querySelectorAll('.cp-row.picked')].map(r => r.dataset.sel)};
        })())`;
        const sheetOf = async (on = tab) => JSON.parse(await on.evaluate(sheetJs));
        const fitOn = async (on = tab) => JSON.parse(await on.evaluate(fit));
        // (#panel-acts, the card's actions, shows when the card has any: user, 23 Nov 2026)
        const onlySheet = d => !d.topbar && !d.head && !d.list && d.mainKids.join() === 'cp' && ['panel,panel-body', 'panel,panel-body,panel-acts'].includes(d.cpKids.join()) && d.close !== null;
        // a received plan's sheet in this order from the top (team cockpit spec §5.3b: its warnings, when
        // any, in the card's slot above its action bar; user, 23 Nov 2026: the form in the card under the
        // table): the close link, the table, the form's first field, for a new plan its race fold (the
        // form's last block: user, 22 Nov 2026; a version has none: it takes its plan's race, 23 Nov),
        // the warnings (when any), Store; Discard on Store's line before it, 24 px or more from it (Discard ·
        // Store · Make live: user, 23 Nov 2026)
        const storeOrder = d => [d.closeTop, d.table, d.field, ...(d.fold === null ? [] : [d.fold]), ...(d.what === null ? [] : [d.what]), d.store];
        const storeSheet = d => storeOrder(d).every(v => v !== null) && storeOrder(d).every((v, i, a) => i === 0 || v > a[i - 1]) && (d.fold === null || d.foldLast === true)
            && d.discard !== null && Math.abs(d.discard - d.store) <= 2 && d.storeL - d.discardR >= 24;
        const bigClose = d => d.close !== null && d.close.w >= 44 && d.close.h >= 44;
        const tapOn = async (sel, on = tab) => {
            const r = JSON.parse(await on.evaluate(`JSON.stringify((() => { const el = ${sel}; el.scrollIntoView({block: 'center'}); const r = el.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; })())`));
            await clickAt(r, on);
        };
        await open(cp, {w: 390});
        await front();
        navs = tab.navs.count;
        const list0 = await sheetOf();
        await tapOn(rowLink(`v:${extra}`));
        await sleep(1200);
        await tab.evaluate('scrollTo(0, 0)');
        const vs = await sheetOf();
        report(!(await st()).hidden && tab.navs.count === navs && vs.url === `${cp}?v=${extra}` && /\bhas-sel\b/.test(vs.cls) && list0.list && list0.mainKids.length > 1 && onlySheet(vs) && vs.closeTop !== null && vs.closeTop < 60,
            '12d: at 390 a tap on a version row opens the sheet in place: only #panel and #panel-body show, the close link at the top', JSON.stringify({navs: tab.navs.count - navs, list0, vs}));
        report(bigClose(vs) && (await tab.evaluate('document.querySelector("#panel a.cp-close .cp-x").getBoundingClientRect().width')) > 0
            && (await tab.evaluate('!document.querySelector("#panel a.cp-close .cp-lbl, #panel a.cp-close .cp-back")')), '12d: the close link is at least 44 x 44 px and shows the ✕, no words', JSON.stringify(vs.close));
        let f = await fitOn();
        report(f.sw <= f.iw && f.small.length === 0, '12d: the version\'s sheet fits 390 px, every control 44 px', JSON.stringify(f));
        navs = tab.navs.count;
        await tapOn('document.querySelector("#panel a.cp-close")');
        await sleep(1200);
        const back = await sheetOf();
        const backSt = await st();
        report(!backSt.hidden && tab.navs.count === navs && back.url === cp && back.list && back.head && !/\bhas-sel\b/.test(back.cls) && back.picked.join() === `v:${liveOf('rollers')}` && back.close === null,
            '12d: the close link brings the list (and the live card after its race) back without a page load', JSON.stringify({navs: tab.navs.count - navs, back}));
        report(backSt.focusRow === `v:${extra}`, '12d: after the close link the focus is on the row that was picked', JSON.stringify({focus: backSt.focus, focusRow: backSt.focusRow}));
        // a plan not stored yet: the same sheet as a version's (the list gone), the table, the Store
        // form, its warnings (when any), Store and Discard, in this order
        await tapOn(rowLink(`e:${pushedCp}`));
        await sleep(1500);
        await tab.evaluate('scrollTo(0, 0)');
        const es = await sheetOf();
        report(!(await st()).hidden && tab.navs.count === navs && es.url === `${cp}?e=${pushedCp}` && /\bhas-sel\b/.test(es.cls) && onlySheet(es)
            && es.picked.join() === `e:${pushedCp}` && storeSheet(es) && bigClose(es),
            '12d: a plan not stored yet: the sheet alone as a version\'s, close link, the table, the Store form\'s first field, its warnings, Store from the top, Discard on Store\'s line 24 px from it', JSON.stringify({navs: tab.navs.count - navs, order: storeOrder(es), es}));
        f = await fitOn();
        report(f.sw <= f.iw && f.small.length === 0, '12d: the Store sheet fits 390 px, every control 44 px', JSON.stringify(f));
        // New plan: its race fold, the form's last block, before its warnings
        await tapOn('document.querySelector("#panel-body .cp-form input[name=as][value=new]")');
        await sleep(1500);
        await tab.evaluate('scrollTo(0, 0)');
        const esNew = await sheetOf();
        report(esNew.fold !== null && storeSheet(esNew), '12d: New plan: its race fold after the form\'s fields, before its warnings, Store and Discard as before', JSON.stringify({order: storeOrder(esNew), esNew}));
        await tapOn('document.querySelector("#panel-body .cp-form details.as-race > summary")');
        await sleep(300);
        f = await fitOn();
        report(await tab.evaluate('document.querySelector("#panel-body .cp-form details.as-race").open') && f.sw <= f.iw && f.small.length === 0,
            '12d: the race fold open, the Store sheet still fits 390 px, every control 44 px', JSON.stringify(f));
        await tab.evaluate('scrollTo(0, 0)');
        navs = tab.navs.count;
        await tapOn('document.querySelector("#panel a.cp-close")');
        await sleep(1200);
        const back2 = await sheetOf();
        report(!(await st()).hidden && tab.navs.count === navs && back2.url === cp && back2.list && back2.head && back2.picked.join() === `v:${liveOf('rollers')}` && !/\bhas-sel\b/.test(back2.cls),
            '12d: the close link of the Store sheet brings the list back without a page load', JSON.stringify({navs: tab.navs.count - navs, back2}));

        // 12e: the same without the script (a second tab, as in 6): every row and the close link load
        {
            const plain12 = await chrome.newTab();
            await plain12.send('Emulation.setScriptExecutionDisabled', {value: true});
            await open(cp, {w: 390, on: plain12});
            const loadAfterTap = async sel => {
                const loaded = plain12.once('Page.loadEventFired');
                await tapOn(sel, plain12);
                const got = await loaded;
                await sleep(300);
                return got !== null;
            };
            const rowOf = sel => `document.querySelector('.cp-row[data-sel="${sel}"] > a.cp-link')`;
            const nojs = await plain12.evaluate('!document.documentElement.classList.contains("js")');
            const loadedV = await loadAfterTap(rowOf(`v:${extra}`));
            await plain12.evaluate('scrollTo(0, 0)');
            const pv = await sheetOf(plain12);
            report(nojs && loadedV && pv.url === `${cp}?v=${extra}` && onlySheet(pv) && pv.closeTop !== null && pv.closeTop < pv.table && bigClose(pv) && pv.picked.join() === `v:${extra}`
                && pv.close.href.startsWith(cp) && !pv.close.href.includes('?'),
            '12e: without the script a tap on a version row loads ?v=<id> and shows the same sheet; the close link is a plain link without a selection', JSON.stringify({nojs, loadedV, pv}));
            f = await fitOn(plain12);
            report(f.sw <= f.iw && f.small.length === 0, '12e: the version\'s sheet fits 390 px, every control 44 px', JSON.stringify(f));
            const loadedBack = await loadAfterTap('document.querySelector("#panel a.cp-close")');
            const pb = await sheetOf(plain12);
            report(loadedBack && pb.url === cp && pb.list && pb.head && pb.picked.join() === `v:${liveOf('rollers')}`, '12e: the close link loads the page without the selection, the list back', JSON.stringify({loadedBack, pb}));
            const loadedE = await loadAfterTap(rowOf(`e:${pushedCp}`));
            await plain12.evaluate('scrollTo(0, 0)');
            const pe = await sheetOf(plain12);
            report(loadedE && pe.url === `${cp}?e=${pushedCp}` && onlySheet(pe) && pe.picked.join() === `e:${pushedCp}` && storeSheet(pe) && bigClose(pe),
            '12e: without the script a tap on the plan not stored yet loads ?e=<id>: the same Store sheet', JSON.stringify({loadedE, order: storeOrder(pe), pe}));
            f = await fitOn(plain12);
            report(f.sw <= f.iw && f.small.length === 0, '12e: the Store sheet fits 390 px, every control 44 px', JSON.stringify(f));
            report(!plain12.logs.length, '12e: the second tab ran without errors', plain12.logs.join('; '));
            await plain12.send('Page.close');
            plain12.close();
            await tab.send('Page.bringToFront');
        }

        // 12p: the sheet in use on a short phone screen (the reviewer's cases)
        const place = sel => `JSON.stringify((() => {
          const row = ${sel}.closest('.cp-row'), r = row.getBoundingClientRect(), p = document.getElementById('panel').getBoundingClientRect();
          const kid = [...document.querySelectorAll('#panel-body > *')].find(e => e.getBoundingClientRect().height > 0);
          return {y: Math.round(scrollY), rowIn: r.height > 0 && r.top >= 0 && r.bottom <= innerHeight, rowTop: Math.round(r.top), panelBottom: Math.round(p.bottom),
            kidTop: kid ? Math.round(kid.getBoundingClientRect().top) : null, panelH: Math.round(p.height), url: location.pathname + location.search};
        })())`;
        const placeOf = async sel => JSON.parse(await tab.evaluate(place(sel)));
        await open(cp, {w: 375, h: 560});
        await front();
        for (const [what, sel, back] of [['the plan not stored yet', `e:${pushedCp}`, 'close'], ['a version', `v:${extra}`, 'close'], ['the plan not stored yet', `e:${pushedCp}`, 'history'], ['a version', `v:${extra}`, 'history']]) {
            navs = tab.navs.count;
            await tab.evaluate(`scrollBy(0, ${rowLink(sel)}.getBoundingClientRect().top - 60)`);       // the row near the top: the page scrolled well down
            await sleep(100);
            const list = await placeOf(rowLink(sel));
            await clickAt(await rectOf(rowLink(sel), false));
            await sleep(1500);
            const opened = await placeOf(rowLink(sel));
            report(!(await st()).hidden && tab.navs.count === navs && list.y > 100 && opened.url === `${cp}?${sel[0]}=${sel.slice(2)}` && opened.kidTop !== null && opened.kidTop >= opened.panelBottom,
                `12p: ${what} tapped with the list scrolled: the sheet's first line is below the sticky head, no page load`, JSON.stringify({list, opened}));
            navs = tab.navs.count;
            if (back === 'close') {
                await clickAt(await rectOf('document.querySelector("#panel a.cp-close")', false));
            } else {
                await tab.evaluate('history.back()');
            }
            await sleep(1500);
            const after = await placeOf(rowLink(sel));
            report(!(await st()).hidden && tab.navs.count === navs && after.url === cp && Math.abs(after.y - list.y) <= 2 && after.rowIn,
                `12p: ${what}: ${back === 'close' ? 'the close link' : 'Back'} brings the list back at its scroll place, the row in view`, JSON.stringify({list, after}));
        }
        // a version stored the day before: the longest title (two lines); the close link right of it at the top
        const oldV = srv.store.change(CID, cl => uploadSheet(cl, {
            slug: 'rollers', json: planJson('Rollers', ['1001', '1002', '1003', '1004']), text: null, as: livePlan, live: false,
            base: cl.teams.rollers.version, pinnedEventId: null, via: 'file',
        }, {now: NOW - 30 * 3600e3, newId: () => randomId(6)}).id);
        const headJs = `JSON.stringify((() => {
          const c = document.querySelector('#panel a.cp-close').getBoundingClientRect(), t = document.querySelector('#panel .cp-title').getBoundingClientRect();
          return {title: document.querySelector('#panel .cp-title').textContent, closeL: Math.round(c.left), closeT: Math.round(c.top), closeR: Math.round(c.right), titleR: Math.round(t.right), titleT: Math.round(t.top), titleH: Math.round(t.height), iw: innerWidth};
        })())`;
        for (const w of [390, 375, 360]) {
            for (const q of [`v=${oldV}`, `e=${pushedCp}`]) {
                await open(`${cp}?${q}`, {w});
                await front();
                const h = JSON.parse(await tab.evaluate(headJs));
                report(!(await st()).hidden && h.closeL >= h.titleR - 1 && Math.abs(h.closeT - h.titleT) <= 12 && h.closeR <= h.iw,
                    `12p: at ${w} the close link is at the right of the title (${q.startsWith('v') ? 'a version of the day before' : 'the plan not stored yet'}), at the top`, JSON.stringify(h));
            }
        }
        // the stale line shows in the sheet, the rest of the page's head does not
        await open(`${cp}?e=${pushedCp}`, {w: 390});
        await front();
        const stale12 = JSON.parse(await tab.evaluate(`JSON.stringify((() => {
          const s = document.querySelector('.pagehead [data-stale]');
          s.hidden = false;                      // what the script does when the page cannot be refreshed
          const h = e => e.getBoundingClientRect().height > 0;
          return {stale: h(s), others: [...document.querySelector('.pagehead').children].filter(e => e !== s && h(e)).map(e => e.className || e.tagName), head: h(document.querySelector('.pagehead'))};
        })())`));
        report(stale12.stale && stale12.others.length === 0, '12p: the stale line shows in the sheet, the rest of the page\'s head stays hidden', JSON.stringify(stale12));
        srv.store.change(CID, cl => { delete cl.sheets[oldV]; });
        report(!club().sheets[oldV], '12p: the fixture version is gone again');

        // The rest of the group changes the team's live version and stores versions: the live version
        // it started with is put back at the end. `liveFirst` is the version live now.
        const liveFirst = liveOf('rollers');
        const scratchIds = [];                   // versions these checks stored: deleted again below
        const hasField = (post, name, value) => new RegExp(`(^|&)${name}=${value}(&|$)`).test(post?.body ?? '');
        const panelForm = 'f => f.closest("#panel-acts") !== null';
        const landed = on => on.evaluate('location.pathname + location.search + location.hash');

        // 12j: after the gate, a version picked: its card alone in the right column; the count the live
        // card gives ("N of M have the plan") stays in sight as the live row's "N/M have it"
        await open(`${cp}?v=${extra}`, {w: 1280});
        await front();
        const lay = JSON.parse(await tab.evaluate(layout));
        // the live version's riders (the earlier groups leave 'Rollers · easy' live, the riders of v2 of 'Rollers · fast')
        const ridersLive = Object.keys(club().sheets[liveOf('rollers')].json.riders).length;
        await open(cp, {w: 1280});
        const liveCount = await tab.evaluate('document.querySelector("#panel .cp-meta .count")?.textContent ?? ""');
        const [, has, of] = /^(\d+) of (\d+) ha/.exec(liveCount) ?? [];
        report(!(await st()).hidden && /\bhas-sel\b/.test(lay.cls) && Boolean(lay.top?.shown && lay.card?.shown && lay.list) && lay.cards === 1
            && lay.top.l > lay.list.r && lay.states === 0 && Number(of) === ridersLive && new RegExp(` · ${has}/${of} have it Live(SendingRiders get this plan now|StartedThe race has started)$`).test(lay.liveRow),
        `12j: at 1280 after the gate, with a version picked, its card alone in the right column; the live row says "${has}/${of} have it", the live card's count`, JSON.stringify({lay, liveCount}));
        // the phase tag beside Live in another colour than Live's green, uppercase as Live (user, 23 Nov 2026)
        const tags12 = JSON.parse(await tab.evaluate(`JSON.stringify((() => {
          const [live, phase] = document.querySelectorAll('.cp-row.live > a.cp-link > .tag');
          const st = e => e ? (s => ({bg: s.backgroundColor, up: s.textTransform, shown: e.getBoundingClientRect().width > 0}))(getComputedStyle(e)) : null;
          return {live: st(live), phase: st(phase), cls: phase?.className ?? null, race: document.querySelector('.cp-race p.race > span')?.textContent ?? ''};
        })())`));
        report(tags12.phase?.shown && tags12.phase.bg !== tags12.live.bg && tags12.phase.up === 'uppercase' && /^tag (sending|started)$/.test(tags12.cls) && !/open since|started/.test(tags12.race),
            '12j: the live row\'s phase tag (Sending or Started) beside Live in its own colour; the race line says neither', JSON.stringify(tags12));

        // 12s: layout stability (team cockpit spec §5.3b): at 1280 the card stands in the same place with
        // the same width for the live version, a version and a received plan; its actions in the row under
        // the title (user, 23 Nov 2026: one action row), right-aligned on the card's right edge, above the
        // card, on the line of the ways to a plan at the list's top (the head's hidden), the row as high
        // with or without them; the race head is one line; the list never moves (user, 23 Nov 2026: the
        // Store form is in the card): its height and every row's top the same whatever is picked
        const cardGeo = `JSON.stringify((() => {
          const top = document.querySelector('#panel .cp-top').getBoundingClientRect(), body = document.querySelector('.cp-body').getBoundingClientRect();
          const barEl = document.querySelector('#panel-acts .cp-bar'), bar = barEl?.getBoundingClientRect() ?? null, head = document.querySelector('.cp-race p.race > span');
          const ways = document.querySelector('.cp-ways')?.getBoundingClientRect() ?? null, list = document.querySelector('.cp-list').getBoundingClientRect();
          const headWays = document.querySelector('.pagehead .headacts');
          const thead = document.querySelector('.cp-body thead').getBoundingClientRect(), meta = document.querySelector('#panel .cp-meta');
          const lh = parseFloat(getComputedStyle(meta).lineHeight);
          return {l: top.left, t: top.top + scrollY, w: top.width, bw: body.width, theadToTop: thead.top - top.top, metaText: meta.textContent.trim(), metaLines: meta.querySelector('.cp-cap, .count')?.getClientRects().length ?? 0,
            bar: bar === null ? null : {r: Math.round(bar.right), cardR: Math.round(top.right), b: Math.round(bar.bottom + scrollY), t: Math.round(bar.top + scrollY), buttons: [...barEl.querySelectorAll(':scope > button, :scope > form > button, :scope > .as-discard button[data-arm-open]')].filter(b => b.getBoundingClientRect().height > 0).map(b => [...b.childNodes].filter(n => !n.classList?.contains('sr')).map(n => n.textContent).join('').trim())},
            ways: ways === null || ways.height === 0 ? null : {l: Math.round(ways.left), t: Math.round(ways.top + scrollY), listL: Math.round(list.left)},
            headWays: headWays === null ? null : headWays.getBoundingClientRect().height,
            rowBtns: [...document.querySelectorAll('.cp-ways .headacts .btn, #panel-acts > .cp-bar > .btn, #panel-acts > .cp-bar form > [data-arm-open]')]
              .filter(b => b.getClientRects().length > 0).map(b => [Math.round(b.getBoundingClientRect().height), getComputedStyle(b).fontSize, Math.round(b.getBoundingClientRect().top + scrollY)].join(' ')),
            box: Math.round(document.querySelector('.cp-list>:is(.cp-pending,div.cp-race)').getBoundingClientRect().top + scrollY),
            heads: [...document.querySelectorAll('.cp-list>.cp-pending>.cp-sub, .cp-list>div.cp-race>.racehead')].map(e => { const c = getComputedStyle(e.matches('.racehead') ? e.querySelector('p.race') : e);
              return [c.fontSize, c.fontWeight, c.textTransform, Math.round(e.getBoundingClientRect().height)].join(' '); }),
            raceLines: head ? head.getClientRects().length : null, race: head?.textContent ?? null, kind: document.getElementById('panel').dataset.kind,
            // the list's content (its box spans the card's grid rows and stretches with the card)
            listH: (() => { const l = document.querySelector('.cp-list'), k = [...l.children].filter(e => e.getBoundingClientRect().height > 0).at(-1);
              return k ? Math.round(k.getBoundingClientRect().bottom - l.getBoundingClientRect().top) : null; })(),
            rows: [...document.querySelectorAll('.cp-list .cp-row')].map(r => Math.round(r.getBoundingClientRect().top + scrollY)).join()};
        })())`;
        // a version of another plan of the race: its caption ("Against live 'easy' v1", or the longer
        // "Same riders, order, pulls and targets as live 'easy' v1") sits beside the plan code; the
        // two-line block keeps its table where the others have theirs, however many lines it takes
        const livePlan12 = club().sheets[liveOf('rollers')].plan;
        const otherPlanV = Object.entries(club().sheets).find(([, x]) => x.team === 'rollers' && x.date === '2026-11-19' && x.plan !== livePlan12)?.[0];
        const geos = [];
        for (const q of ['', `?v=${extra}`, `?e=${pushedCp}`, `?v=${otherPlanV}`]) {
            await open(`${cp}${q}`, {w: 1280});
            await front();
            geos.push(JSON.parse(await tab.evaluate(cardGeo)));
        }
        const same = k => geos.every(g => Math.abs(g[k] - geos[0][k]) <= 1);
        report(geos.map(g => g.kind).join() === 'version,version,entry,version' && same('l') && same('t') && same('w') && same('bw') && same('theadToTop')
            && geos[3].metaLines >= 1,
            '12s: at 1280 the card has the same left, top and width for the live version, a version, a received plan and a version of another plan (the action row as high with or without actions), its table header the same distance from its top', JSON.stringify(geos));
        const rowOk = g => g.bar !== null && Math.abs(g.bar.r - g.bar.cardR) <= 1 && g.bar.b <= g.t && g.ways !== null && Math.abs(g.ways.t - g.bar.t) <= 2 && Math.abs(g.ways.l - g.ways.listL) <= 1;
        report(geos[0].bar === null && geos[0].ways !== null && geos.every(g => g.headWays === 0)
            && rowOk(geos[1]) && geos[1].bar.buttons.join() === 'Make live' && rowOk(geos[2]) && geos[2].bar.buttons.join() === 'Discard,Store,Make live',
            '12s: at 1280 one action row under the title: the ways to a plan at its left above the list (the head\'s hidden), the card\'s actions at its right on the card\'s right edge (Make live alone, or Discard · Store · Make live), none for the live version', JSON.stringify(geos.map(g => [g.kind, g.bar, g.ways, g.headWays])));
        // the list in boxes (user, 24 Nov 2026): the plans not stored yet, then each race; the first box
        // starts on the card's line, the boxes' headings alike
        report(geos.every(g => Math.abs(g.box - g.t) <= 1 && g.heads.length >= 2 && new Set(g.heads).size === 1),
            '12s: at 1280 the list\'s first box starts on the card\'s line; Not stored yet is headed like a race', JSON.stringify(geos.map(g => [g.kind, g.box, g.t, g.heads])));
        // one size on the action row (user, 24 Nov 2026): the card's actions as the ways to a plan
        report(geos.every(g => g.rowBtns.length >= 2 && new Set(g.rowBtns).size === 1) && geos.some(g => g.rowBtns.length >= 5) && geos.filter(g => g.bar?.buttons.join() === 'Make live').every(g => g.rowBtns.length === 3),
            '12s: at 1280 every button on the action row has one height, one text size and one top', JSON.stringify(geos.map(g => [g.kind, g.rowBtns])));
        report(geos.every(g => g.raceLines === 1), '12s: at 1280 the race head is one line', JSON.stringify(geos.map(g => [g.race, g.raceLines])));
        report(same('listH') && geos.every(g => g.rows === geos[0].rows),
            '12s: at 1280 the list keeps its height and every row its place, whatever is picked (a received plan too)', JSON.stringify(geos.map(g => [g.kind, g.listH, g.rows])));
        // the Store form's race fold (in the card, above its warnings) opened at 1280 moves neither the
        // card's top, nor the list, nor the action row above the card (user, 22 and 23 Nov 2026); a new
        // plan's (a version has none)
        await open(`${cp}?e=${pushedCp}&team=rollers&as=new&drawn=rollers:new`, {w: 1280});
        await front();
        const barAt = `JSON.stringify((() => { const b = document.querySelector('#panel-acts .cp-bar').getBoundingClientRect(), t = document.querySelector('#panel .cp-top').getBoundingClientRect();
          return {bar: Math.round(b.top + scrollY), barL: Math.round(b.left), barH: Math.round(b.height), top: Math.round(t.top + scrollY), w: Math.round(t.width),
            listH: (() => { const l = document.querySelector('.cp-list'), k = [...l.children].filter(e => e.getBoundingClientRect().height > 0).at(-1);
              return k ? Math.round(k.getBoundingClientRect().bottom - l.getBoundingClientRect().top) : null; })(),
            open: document.querySelector('#panel-body .cp-form details.as-race')?.open ?? null}; })())`;
        const shut = JSON.parse(await tab.evaluate(barAt));
        await clickAt(await rectOf('document.querySelector("#panel-body .cp-form details.as-race > summary")'));
        await sleep(200);
        const opened = JSON.parse(await tab.evaluate(barAt));
        report(shut.open === false && opened.open === true && ['bar', 'barL', 'barH', 'top', 'w', 'listH'].every(k => opened[k] === shut[k]),
            '12s: at 1280 opening the Store form\'s race fold moves neither the card\'s top, nor the list, nor the action row', JSON.stringify({shut, opened}));
        // below 1180 px the actions stay at the card's bottom, in the same order (user, 23 Nov 2026): at 1100
        // the Store sheet's bar under the card body, Discard · Store · Make live from the left
        await open(`${cp}?e=${pushedCp}`, {w: 1100});
        await front();
        const narrowBar = JSON.parse(await tab.evaluate(`JSON.stringify((() => {
          const body = document.querySelector('.cp-body').getBoundingClientRect(), bar = document.querySelector('#panel-acts .cp-bar').getBoundingClientRect();
          const xs = ['form.discard [data-arm-open]', '[data-submit=store]', '[data-submit=live]'].map(q => document.querySelector('#panel-acts .cp-bar ' + q)?.getBoundingClientRect() ?? null);
          return {barT: Math.round(bar.top), bodyB: Math.round(body.bottom), xs: xs.map(r => r === null ? null : [Math.round(r.left), Math.round(r.top)])};
        })())`));
        report(narrowBar.barT >= narrowBar.bodyB - 1 && narrowBar.xs.every(x => x !== null) && narrowBar.xs[0][0] < narrowBar.xs[1][0] && narrowBar.xs[1][0] < narrowBar.xs[2][0]
            && narrowBar.xs.every(x => Math.abs(x[1] - narrowBar.xs[0][1]) <= 2),
            '12s: at 1100 the actions stand at the card\'s bottom, Discard · Store · Make live on one line', JSON.stringify(narrowBar));
        // the card's actions asking first at 1280 (the race window): the question floats under the action
        // row's buttons over the card's top and moves nothing, neither the card, nor the list, nor the row;
        // the buttons stay where they are (user, 24 Nov 2026): Make live of a version, the Store form's Make
        // live (another plan is live) and Discard
        const askAt = `JSON.stringify((() => { const t = document.querySelector('#panel .cp-top').getBoundingClientRect(), bar = document.querySelector('#panel-acts .cp-bar').getBoundingClientRect();
          const s = [...document.querySelectorAll('#panel-acts [data-arm-strip]')].find(e => !e.hidden), sr = s ? s.getBoundingClientRect() : null, yes = s?.querySelector('[data-arm-yes]')?.getBoundingClientRect() ?? null;
          const btns = [...document.querySelectorAll('#panel-acts .cp-bar > button, #panel-acts .cp-bar > form > button, #panel-acts .cp-bar .as-discard [data-arm-open]')].map(b => b.getBoundingClientRect()).filter(r => r.height > 0);
          return {top: Math.round(t.top + scrollY), barT: Math.round(bar.top + scrollY), barH: Math.round(bar.height), cardR: Math.round(t.right), nBtns: btns.length, xs: btns.map(r => Math.round(r.left) + '-' + Math.round(r.right)).join(), btnB: Math.round(Math.max(...btns.map(r => r.bottom)) + scrollY),
            strip: sr === null ? null : {t: Math.round(sr.top + scrollY), b: Math.round(sr.bottom + scrollY), r: Math.round(sr.right), abs: getComputedStyle(s).position},
            yes: yes === null ? null : {seen: yes.top >= 0 && yes.bottom <= innerHeight && yes.width > 0},
            rows: [...document.querySelectorAll('.cp-list .cp-row')].map(r => Math.round(r.getBoundingClientRect().top + scrollY)).join()}; })())`;
        const askPosts = tab.posts.length;
        for (const [what, url, trigger] of [
            ['Make live of a version', `${cp}?v=${extra}`, '#panel-acts form[data-arm] [data-arm-open]'],
            ['the Store form\'s Make live', `${cp}?e=${pushedCp}&team=rollers&as=new&drawn=rollers:new`, '#panel-acts [data-submit=live]'],
            ['Discard', `${cp}?e=${pushedCp}&team=rollers&as=new&drawn=rollers:new`, '#panel-acts form.discard [data-arm-open]'],
        ]) {
            await open(url, {w: 1280});
            await front();
            const calm = JSON.parse(await tab.evaluate(askAt));
            await tab.evaluate(`document.querySelector(${JSON.stringify(trigger)}).click()`);
            await sleep(300);
            const asked = JSON.parse(await tab.evaluate(askAt));
            if (what === 'Discard' && shotsDir) {
                await shootView('captain-cockpit-armed-1280-light.png');
            }
            await tab.evaluate(`[...document.querySelectorAll('#panel-acts [data-arm-strip]')].find(e => !e.hidden)?.querySelector('[data-arm-cancel]')?.click()`);
            await sleep(200);
            const closed = JSON.parse(await tab.evaluate(askAt));
            report(calm.strip === null && asked.strip !== null && asked.strip.abs === 'absolute' && asked.top === calm.top && asked.rows === calm.rows && asked.barH === calm.barH && asked.barT === calm.barT
                && asked.nBtns === calm.nBtns && asked.strip.t >= asked.btnB && asked.strip.t - asked.btnB <= 16 && Math.abs(asked.strip.r - asked.cardR) <= 1 && asked.yes?.seen === true
                && asked.xs === calm.xs && closed.xs === calm.xs && closed.strip === null && closed.top === calm.top && closed.nBtns === calm.nBtns && tab.posts.length === askPosts,
            `12s: at 1280 ${what} asking first opens its question under its button over the card's top: card, list and action row stay, the buttons stay where they are (left and right edges), Cancel closes it`, JSON.stringify({calm, asked, closed, posts: tab.posts.length - askPosts}));
        }
        // a phone's head: Plan on ZwiftGopher and Upload a file side by side when they fit (user, 23 Nov 2026)
        await open(cp, {w: 390});
        await front();
        const headPair = JSON.parse(await tab.evaluate(`JSON.stringify((() => {
          const box = document.querySelector('.pagehead .headacts'), bs = [...box.querySelectorAll(':scope > .btn')].map(b => b.getBoundingClientRect());
          return {w: Math.round(box.getBoundingClientRect().width), ws: bs.map(r => Math.round(r.width)), tops: bs.map(r => Math.round(r.top))};
        })())`));
        const pairFits = headPair.ws.reduce((a, b) => a + b, 0) + 8 <= headPair.w;
        report(headPair.ws.length === 2 && (pairFits ? headPair.tops[0] === headPair.tops[1] : headPair.tops[1] > headPair.tops[0]),
            `12s: at 390 the head's headPair ${pairFits ? 'side by side' : 'wraps: Upload a file under the planner button'}`, JSON.stringify({headPair, pairFits}));

        if (shotsDir) {
            // the cockpit's shots: the page, a version, the Store form (390 is the sheet), the strip armed
            for (const w of [390, 1280]) {
                await open(cp, {w});
                await front();
                await shootNow(`captain-cockpit-${w}-light.png`, w);
            }
            await open(cp, {w: 390, scheme: 'dark'});
            await front();
            await shootNow('captain-cockpit-390-dark.png');
            for (const [name, q] of [['version', `v=${extra}`], ['store', `e=${pushedCp}`]]) {
                for (const w of [390, 1280]) {
                    await open(`${cp}?${q}`, {w});
                    await front();
                    await shootNow(`captain-cockpit-${name}-${w}-light.png`, w);
                }
            }
            await open(`${cp}?v=${extra}`, {w: 390});
            await front();
            const armed = await openConfirm(panelForm);
            report(armed.open, '12: the cockpit\'s Make live strip is open for its shot', JSON.stringify(armed));
            await shootView('captain-cockpit-live-armed-390-light.png');
        }

        // the card's one-shot message at 1280 (user, 24 Nov 2026): it floats over the card's top, right under
        // the action row, on the card's width, with a close ×; the card, the list and the row do not move
        const noteGeo = `JSON.stringify((() => {
          const top = document.querySelector('#panel .cp-top').getBoundingClientRect(), n = document.querySelector('#panel .cp-note'), r = n ? n.getBoundingClientRect() : null;
          const ways = document.querySelector('.cp-ways')?.getBoundingClientRect() ?? null, x = n?.querySelector('a[data-note-close]')?.getBoundingClientRect() ?? null;
          return {top: Math.round(top.top + scrollY), l: Math.round(top.left), r: Math.round(top.right), rowB: ways ? Math.round(ways.bottom + scrollY) : null,
            rows: [...document.querySelectorAll('.cp-list .cp-row')].map(e => Math.round(e.getBoundingClientRect().top + scrollY)).join(),
            note: r === null ? null : {t: Math.round(r.top + scrollY), l: Math.round(r.left), r: Math.round(r.right), pos: getComputedStyle(n).position, auto: n.dataset.autoClose ?? null,
              seen: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight, x: x === null ? null : [Math.round(x.width), Math.round(x.height)]},
            focus: document.activeElement?.id ?? '', hold: document.querySelector('[data-hold-reload]') !== null, holdNote: document.querySelector('.cp-hold') !== null,
            label: n?.querySelector('a[data-note-close]')?.getAttribute('aria-label') ?? null, text: n?.querySelector('.flash')?.textContent.trim().slice(0, 80) ?? null, at: location.pathname + location.search};
        })())`;
        const noteOk = g => g.note !== null && g.note.pos === 'absolute' && g.note.seen && Math.abs(g.note.l - g.l) <= 1 && Math.abs(g.note.r - g.r) <= 1
            && g.rowB !== null && Math.abs(g.note.t - g.rowB) <= 16 && g.note.x !== null && g.note.x[0] >= 44 && g.note.x[1] >= 44 && g.label === 'Close message';

        // 12f: Make live from the panel, a version picked in place (the script, no page load): it asks in
        // the button's place, nothing changes until confirmed, the page lands on the version with the
        // flash in the panel (no Undo), and the form the fragment brought is not refused as out of date
        // (Review Focus 2: its version and club fields are the page's; it posts no from)
        await open(cp, {w: 1280});
        await front();
        navs = tab.navs.count;
        await tab.evaluate(`${rowLink(`v:${extra}`)}.click()`);
        await sleep(1200);
        const tvNow = String(club().teams.rollers.version);
        const picked12f = await st();
        const ask = await openConfirm(panelForm);
        report(!picked12f.hidden && tab.navs.count === navs && picked12f.url === `${cp}?v=${extra}` && picked12f.panels === 1 && ask.open && ask.inPlace && ask.inView && ask.focused && ask.described
            && liveOf('rollers') === liveFirst,
        '12f: a version picked in place: Make live in the panel asks in its place (the confirm button focused, described by the words), the live version unchanged', JSON.stringify({navs: tab.navs.count - navs, picked12f, ask}));
        const made = await pressConfirm(panelForm);
        const at12f = await landed(tab);
        const flash12f = await flash();
        const undo12f = await tab.evaluate('Boolean(document.querySelector("form[action=\\"/manage/live/undo\\"], [data-row-undo], .cp-undo, .flash.undo, #panel .flash form"))');
        report(made.loaded && made.post?.url === '/manage/live' && hasField(made.post, 'confirm', '1') && hasField(made.post, 'version', tvNow) && hasField(made.post, 'sheet', extra)
            && !/(^|&)from=/.test(made.post.body) && /(^|&)club=\w/.test(made.post.body),
        '12f: the confirm posts confirm=1 with the club, version and sheet fields of the fragment, no from', JSON.stringify(made.post));
        report(at12f === `${cp}?r=2026-11-19#panel` && flash12f.includes(` is live for Rollers.`) && flash12f.startsWith(`'${club().sheets[extra].label}' v${club().sheets[extra].n} is live`)
            && !flash12f.includes('changed since you opened') && !undo12f && liveOf('rollers') === extra,
        '12f: the page lands on ?r=<race>#panel (the version now live) with the flash "… is live for Rollers." in the panel, no Undo, the version live, not refused as out of date', JSON.stringify({at12f, flash12f, undo12f, live: liveOf('rollers')}));
        report(!tab.logs.length && !(await tab.evaluate('window.__csp')).length, '12f: no errors on the cockpit after Make live', tab.logs.join('; '));
        // the green message (clean): floating over the card, a close ×, going by itself after 6 s; the
        // card, the list and the row where they are without it (the same page loaded without the flash)
        const green = JSON.parse(await tab.evaluate(noteGeo));
        if (shotsDir) {
            await shootView('captain-cockpit-note-live-1280-light.png');
        }
        await sleep(6700);
        const greenGone = JSON.parse(await tab.evaluate(noteGeo));
        await open(`${cp}?r=2026-11-19`, {w: 1280});
        await front();
        const greenCalm = JSON.parse(await tab.evaluate(noteGeo));
        report(noteOk(green) && green.note.auto === '6000' && greenGone.note === null && Math.abs(green.top - greenCalm.top) <= 1 && Math.abs(greenGone.top - greenCalm.top) <= 1
            && green.rows === greenCalm.rows && greenCalm.note === null,
        '12f: at 1280 the green message floats over the card (absolute, the card\'s width, right under the action row, a 44 px × named Close message), moves neither the card nor the list, and goes by itself after 6 s', JSON.stringify({green, greenGone, greenCalm}));

        // 12g: the same without the script (a second tab): the button posts, the server asks on a page of
        // its own (nothing changes), confirming there lands on the cockpit with the first version live again
        const plainG = await chrome.newTab();
        await plainG.send('Emulation.setScriptExecutionDisabled', {value: true});
        await open(`${cp}?v=${liveFirst}`, {w: 390, on: plainG});
        const noJsG = await plainG.evaluate('!document.documentElement.classList.contains("js")');
        const stripHidden = await plainG.evaluate('document.querySelector("#panel-acts [data-arm-strip]")?.getClientRects().length === 0');
        plainG.posts.length = 0;
        let loadedG = plainG.once('Page.loadEventFired');
        await tapOn('document.querySelector("#panel-acts form[action=\\"/manage/live\\"] [data-arm-open]")', plainG);
        await loadedG;
        await sleep(250);
        const askedG = await pageText(plainG);
        const firstG = plainG.posts.at(-1) ?? null;
        report(noJsG && stripHidden && firstG?.url === '/manage/live' && !/confirm=/.test(firstG.body) && askedG.includes(`Make '${club().sheets[liveFirst].label}' v${club().sheets[liveFirst].n} live?`) && liveOf('rollers') === extra,
            '12g: without the script the panel\'s Make live posts, the answer is the server\'s confirm page, the live version unchanged', JSON.stringify({noJsG, stripHidden, firstG, asked: askedG.slice(0, 160)}));
        loadedG = plainG.once('Page.loadEventFired');
        await tapOn('document.querySelector("form[action=\\"/manage/live\\"] [type=submit]")', plainG);
        await loadedG;
        await sleep(250);
        const confirmedG = plainG.posts.at(-1) ?? null;
        const atG = await landed(plainG);
        const flashG = await plainG.evaluate('document.querySelector(".flash p")?.textContent ?? ""');
        report(hasField(confirmedG, 'confirm', '1') && !/(^|&)from=/.test(confirmedG?.body ?? '') && atG === `${cp}?r=2026-11-19#panel` && flashG.includes(' is live for Rollers.') && liveOf('rollers') === liveFirst,
            '12g: confirming there lands on ?r=<race> with the version live, without the script', JSON.stringify({confirmedG, atG, flashG, live: liveOf('rollers')}));
        report(!plainG.logs.length, '12g: the second tab ran without errors', plainG.logs.join('; '));
        await plainG.send('Page.close');
        plainG.close();
        await tab.send('Page.bringToFront');

        // 12g-phone: below 1180 px the card's message stands under the card's head, in the flow, with its own ×
        // (user, 24 Nov 2026): the sheet's title and its close × stay at the sheet's top, the message under
        // them, no auto-close (still there after 7 s, also at 1100); the × removes it, nothing above it moves,
        // the focus is on the card. A Make live of the other version at 390, put back afterwards.
        await open(`${cp}?v=${extra}`, {w: 390});
        await front();
        const askedP = await openConfirm(panelForm);
        const madeP = await pressConfirm(panelForm);
        const phoneGeo = `JSON.stringify((() => {
          const r = q => { const e = document.querySelector(q); if (!e) { return null; } const b = e.getBoundingClientRect(); return {t: Math.round(b.top + scrollY), b: Math.round(b.bottom + scrollY), l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height)}; };
          const n = document.querySelector('#panel .cp-note');
          return {title: r('#panel .cp-title'), close: r('#panel .cp-close'), meta: r('#panel .cp-meta'), note: r('#panel .cp-note'), x: r('#panel .cp-note a[data-note-close]'),
            pos: n ? getComputedStyle(n).position : null, label: n?.querySelector('a[data-note-close]')?.getAttribute('aria-label') ?? null, auto: n?.dataset.autoClose ?? null,
            focus: document.activeElement?.id ?? '', sel: document.body.classList.contains('has-sel'), iw: innerWidth, text: n?.querySelector('.flash')?.textContent.trim().slice(0, 60) ?? null};
        })())`;
        const phoneOk = g => g.title !== null && g.close !== null && g.note !== null && g.x !== null && g.pos === 'relative' && g.label === 'Close message'
            && g.note.t >= (g.meta ?? g.title).b - 1 && g.title.t < g.note.t && g.close.t < g.note.t && g.x.w >= 44 && g.x.h >= 44 && g.x.r <= g.note.r + 1 && g.x.t >= g.note.t - 1 && g.note.r <= g.iw;
        const p390 = JSON.parse(await tab.evaluate(phoneGeo));
        if (shotsDir) {
            await shootView('captain-cockpit-note-390-light.png');
        }
        await sleep(7000);
        const p390Later = JSON.parse(await tab.evaluate(phoneGeo));
        await tab.send('Emulation.setDeviceMetricsOverride', {width: 1100, height: 844, deviceScaleFactor: 2, mobile: false});
        await sleep(400);
        const p1100 = JSON.parse(await tab.evaluate(phoneGeo));
        await tab.send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 2, mobile: true});
        await sleep(400);
        const navsP = tab.navs.count;
        await clickAt(await rectOf(`document.querySelector('#panel .cp-note a[data-note-close]')`, false));
        await sleep(400);
        const p390Closed = JSON.parse(await tab.evaluate(phoneGeo));
        report(askedP.open && madeP.loaded && p390.sel && phoneOk(p390) && p390.auto === '6000' && p390Later.note !== null && Math.abs(p390Later.title.t - p390.title.t) <= 1
            && p1100.note !== null && phoneOk(p1100) && p390Closed.note === null && tab.navs.count === navsP && p390Closed.focus === 'panel'
            && Math.abs(p390Closed.title.t - p390.title.t) <= 1 && Math.abs(p390Closed.close.t - p390.close.t) <= 1,
        '12g: at 390 and 1100 the message after Make live stands under the card\'s head (title and sheet ×) in the flow with its own 44 px ×; it is still there after 7 s; the × removes it, the title and sheet × stay, the focus is on the card', JSON.stringify({p390, p390Later: p390Later.note, p1100, p390Closed}));
        srv.store.change(CID, cl => { makeLive(cl, 'rollers', liveFirst, NOW, {}); });
        report(liveOf('rollers') === liveFirst, '12g: the live version is put back after the phone message check', liveOf('rollers'));

        // 12h: a plan not stored yet picked at 1280: the form in the card in the right column, under
        // the table (user, 23 Nov 2026), above its warnings (when any); another plan chosen redraws in place (one panel request); Store lands on the new
        // version with the result, the entry gone, its Make live primary; nothing reloads while the
        // result is on the page (Review Focus 4)
        await open(cp, {w: 1280});
        await front();
        await tab.evaluate(`${rowLink(`e:${pushedCp}`)}.click()`);
        await sleep(1500);
        const geo = JSON.parse(await tab.evaluate(`JSON.stringify((() => {
          const box = s => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? {l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom)} : null; };
          const plans = [...document.querySelectorAll('.cp-form input[name=as]')].map(i => ({value: i.value, checked: i.checked, label: i.closest('label')?.innerText.trim() ?? ''}));
          return {form: box('#store-${pushedCp}'), list: box('.cp-list'), table: box('#panel-body table'), card: box('#panel-body .cp-body'), what: box('#panel-body .cp-what:not(:empty)'),
            iw: innerWidth, plans,
            box: Boolean(document.querySelector('.cp-form input[name=live]'))};
        })())`));
        const inside = (a, b) => a !== null && b !== null && a.l >= b.l && a.r <= b.r && a.t >= b.t && a.b <= b.b;
        report(inside(geo.form, geo.card) && geo.form.l >= geo.list.r && geo.table !== null && geo.table.l >= geo.list.r && geo.table.r <= geo.iw
            && geo.form.t >= geo.table.b && (geo.what === null || geo.what.t >= geo.form.b),
            '12h: a plan not stored yet at 1280: the Store form in the card in the right column, under the rider table, above its warnings', JSON.stringify(geo));
        const otherPlan = geo.plans.find(p => !p.checked && p.value !== 'new');
        const otherLabel = otherPlan ? Object.values(club().sheets).find(x => x.plan === otherPlan.value)?.label ?? null : null;
        navs = tab.navs.count;
        const panels0 = (await st()).panels;
        if (otherPlan) {
            await tab.evaluate(`document.querySelector('.cp-form input[name=as][value="${otherPlan.value}"]').click()`);
        }
        await sleep(1500);
        const redrawn = await st();
        const drawnFor = await tab.evaluate(`document.querySelector('#store-${pushedCp} input[name=drawn]')?.value ?? ''`);
        report(otherPlan !== undefined && otherLabel !== null && tab.navs.count === navs && redrawn.panels === panels0 + 1 && redrawn.url === `${cp}?e=${pushedCp}` && drawnFor === `rollers:${otherPlan.value}`,
            '12h: choosing another plan sends one panel request, loads no page, and the form is drawn for that plan', JSON.stringify({otherPlan, otherLabel, panels: redrawn.panels - panels0, navs: tab.navs.count - navs, drawnFor}));
        const stored = await follow(`document.querySelector('button[form="store-${pushedCp}"][data-submit=store]').click()`);
        await front();
        const at12h = await landed(tab);
        const newId = new URL(at12h, base).searchParams.get('v');
        if (newId) {
            scratchIds.push(newId);
        }
        const res = JSON.parse(await tab.evaluate(`JSON.stringify((() => {
          const f = document.querySelector('#panel-acts form[action="/manage/live"]'), b = f?.querySelector('button');
          return {result: Boolean(document.querySelector('#panel .result')), hold: Boolean(document.querySelector('[data-hold-reload]')), kind: document.getElementById('panel')?.dataset.kind ?? null,
            make: b ? {cls: b.className, text: b.textContent.trim()} : null, hidden: document.hidden};
        })())`));
        report(stored && typeof newId === 'string' && at12h === `${cp}?v=${newId}#panel` && res.result && res.kind === 'version' && Boolean(club().sheets[newId]) && !club().inbox.some(x => x.id === pushedCp),
            '12h: Store loads ?v=<new id> with the result on the page, the version stored and the received plan gone', JSON.stringify({at12h, res, inStore: Boolean(club().sheets[newId]), entry: club().inbox.some(x => x.id === pushedCp)}));
        const heldNote = JSON.parse(await tab.evaluate(noteGeo));
        report(res.hold && noteOk(heldNote) && heldNote.note.auto === null,
            '12h: at 1280 a Store result that holds the reload floats over the card as well (absolute, the card\'s width, a × named Close message) and does not go by itself', JSON.stringify(heldNote));
        report(res.make !== null && /\bprimary\b/.test(res.make.cls) && !/\bsecondary\b/.test(res.make.cls) && /^Make live v\d+ of '/.test(res.make.text),
            '12h: the stored version\'s Make live is the primary button', JSON.stringify(res.make));
        navs = tab.navs.count;
        await sleep(35000);
        const held12h = await st();
        report(!held12h.hidden && res.result && res.hold && tab.navs.count === navs && held12h.url === `${cp}?v=${newId}`,
            '12h: while the Store result with a warning is on the page nothing reloads in 35 s', JSON.stringify({navs: tab.navs.count - navs, held12h, hold: res.hold}));
        const note12h = JSON.parse(await tab.evaluate(`JSON.stringify((() => {
          const n = document.querySelector('#panel-acts > p.cp-hold:last-child'), a = n?.querySelector('a.cp-refresh'), c = document.querySelector('.cp-body');
          return {text: n?.innerText.trim() ?? null, href: a?.getAttribute('href') ?? null, h: a ? Math.round(a.getBoundingClientRect().height) : 0,
            under: Boolean(n && c && n.getBoundingClientRect().top >= c.getBoundingClientRect().bottom), shown: Boolean(n && n.getClientRects().length)};
        })())`));
        report(note12h.shown && note12h.text === 'Not updating while this result is shown · Refresh' && note12h.href === `${cp}?v=${newId}` && note12h.h >= 44 && note12h.under,
            '12h: the page says it is not updating, under the card, with Refresh (a 44 px link)', JSON.stringify(note12h));
        const heldLater = JSON.parse(await tab.evaluate(noteGeo));
        report(heldLater.note !== null && heldLater.note.seen && Math.abs(heldLater.top - heldNote.top) <= 1 && heldLater.rows === heldNote.rows,
            '12h: after 35 s the result is still there, the card where it was', JSON.stringify({heldNote, heldLater}));
        if (shotsDir) {
            await shootNow('captain-cockpit-result-1280-light.png', 1280);
        }
        const refreshed = await follow('document.querySelector("#panel-acts a.cp-refresh").click()');
        await front();
        const after12h = JSON.parse(await tab.evaluate(`JSON.stringify({url: location.pathname + location.search, result: Boolean(document.querySelector('#panel .result')),
          hold: Boolean(document.querySelector('[data-hold-reload]')), note: Boolean(document.querySelector('.cp-hold')), refresh: document.body.dataset.refresh ?? null})`));
        report(refreshed && after12h.url === `${cp}?v=${newId}` && !after12h.result && !after12h.hold && !after12h.note && after12h.refresh === '30',
            '12h: Refresh loads the page again without the result: nothing holds the reload any more', JSON.stringify({refreshed, after12h}));

        // 12h-close: a Store result's ×: the message goes (no reload), the card, the list and the row stay,
        // the focus is on the card and what the result held is released (the hold and its note)
        const pushedClose = srv.store.change(CID, cl => receiveEntry(cl, {team: 'rollers', via: 'zwiftgopher', json: planJson('Rollers', ['1001', '1002']), text: null},
            {now: NOW, newId: () => randomId(6)}));
        await open(`${cp}?e=${pushedClose}`, {w: 1280});
        await front();
        // a plan chosen (the form redraws in place), as 12h does, then Store
        await tab.evaluate(`document.querySelector('.cp-form input[name=as]:not([value=new])')?.click()`);
        await sleep(1500);
        const storedClose = await follow(`document.querySelector('button[form="store-${pushedClose}"][data-submit=store]').click()`);
        await front();
        const newClose = new URL(await landed(tab), base).searchParams.get('v');
        if (newClose) {
            scratchIds.push(newClose);
        }
        const beforeClose = JSON.parse(await tab.evaluate(noteGeo));
        const navsClose = tab.navs.count;
        if (beforeClose.note !== null) {
            await clickAt(await rectOf(`document.querySelector('#panel .cp-note a[data-note-close]')`, false));
            await sleep(400);
        }
        const afterClose = JSON.parse(await tab.evaluate(noteGeo));
        report(storedClose && Boolean(newClose) && noteOk(beforeClose) && afterClose.note === null && tab.navs.count === navsClose && afterClose.focus === 'panel'
            && Math.abs(afterClose.top - beforeClose.top) <= 1 && afterClose.rows === beforeClose.rows && !afterClose.hold && !afterClose.holdNote,
        '12h: the result\'s × removes the message without a reload and moves nothing; the focus is on the card and the reload hold is released', JSON.stringify({beforeClose, afterClose, navs: tab.navs.count - navsClose}));

        // 12n: a received plan stored without the script (a second tab, Ruling F9): the form's Store
        // button posts, the page lands on the new version with the result
        const pushedPlain = srv.store.change(CID, cl => receiveEntry(cl, {team: 'rollers', via: 'zwiftgopher', json: planJson('Rollers', ['1001', '1002']), text: null},
            {now: NOW, newId: () => randomId(6)}));
        const plainN = await chrome.newTab();
        await plainN.send('Emulation.setScriptExecutionDisabled', {value: true});
        await open(`${cp}?e=${pushedPlain}`, {w: 390, on: plainN});
        const noJsN = await plainN.evaluate('!document.documentElement.classList.contains("js")');
        const formN = await plainN.evaluate(`Boolean(document.getElementById('store-${pushedPlain}')) && Boolean(document.querySelector('button[form="store-${pushedPlain}"]'))`);
        // A plan chosen by hand is not redrawn without the script: the first Store is refused for the
        // preview of another plan (the page answers at the POST's URL, the form drawn with the choice),
        // the second one stores. A plan the form preselects is stored by the first press.
        await tapOn('document.querySelector(".cp-form input[name=as]:not([value=new])").closest("label")', plainN);
        const chosenN = await plainN.evaluate('document.querySelector(".cp-form input[name=as]:checked")?.value ?? null');
        let pressesN = 0;
        let postN = null;
        let atN = '';
        const refusals = [];
        while (pressesN < 2 && !atN.startsWith(cp)) {
            plainN.posts.length = 0;
            const loadedN = plainN.once('Page.loadEventFired');
            await tapOn(`document.querySelector('button[form="store-${pushedPlain}"][data-submit=store]')`, plainN);
            await loadedN;
            await sleep(250);
            pressesN++;
            postN = plainN.posts.at(-1) ?? null;
            atN = await landed(plainN);
            if (!atN.startsWith(cp)) {
                refusals.push(await plainN.evaluate('document.querySelector("#panel .flash")?.textContent.trim() ?? ""'));
            }
        }
        const newN = new URL(atN, base).searchParams.get('v');
        if (newN) {
            scratchIds.push(newN);
        }
        const resN = await plainN.evaluate('Boolean(document.querySelector("#panel .result"))');
        report(noJsN && formN && chosenN !== null && pressesN <= 2 && postN?.url === `/manage/inbox/${pushedPlain}` && !/(^|&)from=/.test(postN?.body ?? '') && typeof newN === 'string' && atN === `${cp}?v=${newN}#panel` && resN
            && Boolean(club().sheets[newN]) && !club().inbox.some(x => x.id === pushedPlain),
        '12n: without the script a received plan stored from its sheet: the page lands on ?v=<new id> with the result, the version stored, the entry gone', JSON.stringify({noJsN, formN, chosenN, pressesN, refusals, postN, atN, resN, inStore: Boolean(club().sheets[newN])}));
        // the refusal of the first Store is the 400 these logs expect
        const logsN = plainN.logs.filter(l => !(refusals.length > 0 && /status of 400/.test(l)));
        report(!logsN.length, '12n: the second tab ran without errors', logsN.join('; '));
        await plainN.send('Page.close');
        plainN.close();
        await tab.send('Page.bringToFront');

        // the fixture of these checks goes: the first live version is live again, the stored versions go
        // (each alone: deleteSheet takes a version's whole plan)
        srv.store.change(CID, cl => {
            if (liveOf('rollers') !== liveFirst) {
                makeLive(cl, 'rollers', liveFirst, NOW, {});
            }
            for (const id of scratchIds) {
                if (id !== liveFirst) {
                    delete cl.sheets[id];        // the version alone: deleteSheet would take its whole plan
                }
            }
            if (cl.inbox.some(x => x.id === pushedPlain)) {
                discardEntry(cl, pushedPlain, NOW);
            }
        });
        report(liveOf('rollers') === liveFirst && scratchIds.every(id => !club().sheets[id]), '12: the live version is back and the versions these checks stored are gone', JSON.stringify({live: liveOf('rollers'), liveFirst, scratchIds}));

        report(!tab.logs.length && !(await tab.evaluate('window.__csp')).length, '12: the cockpit checks without errors', tab.logs.join('; '));
        // the fixture goes again
        srv.store.change(CID, cl => {
            delete cl.sheets[extra];
            if (cl.inbox.some(e => e.id === pushedCp)) {
                discardEntry(cl, pushedCp, NOW);
            }
        });
        report(!club().sheets[extra] && !club().inbox.some(e => e.id === pushedCp), '12: the fixture is gone again');
    }

    // ---- shots of the pages that answer a POST: the no-script questions, the new rider code (last:
    // it makes the club private) ----
    if (shotsDir) {
        const postPage = async (action, fields) => {
            await open('/manage/team/rollers', {w: 1280});
            await follow(`(() => { const f = document.createElement('form'); f.method = 'post'; f.action = ${JSON.stringify(action)};
              for (const [k, v] of Object.entries(${JSON.stringify({club: CID, ...fields})})) {
                const i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = v; f.append(i);
              }
              document.body.append(f); f.submit(); })()`);
        };
        const notLive = Object.entries(club().sheets).find(([id, x]) => x.team === 'rollers' && id !== liveOf('rollers'))?.[0];
        for (const [name, action, fields] of [['live-confirm', '/manage/live', {team: 'rollers', sheet: notLive}],
            ['delete-confirm', '/manage/sheet/delete', {team: 'rollers', sheet: notLive}],
            ['code', '/manage/code', {action: 'on', confirm: '1'}]]) {
            await postPage(action, fields);
            await shootNow(`captain-${name}-1280-light.png`, 1280);
            await shootNow(`captain-${name}-390-light.png`);
        }
    }
} catch (e) {
    report(false, 'smoke run', e.stack);
} finally {
    await chrome.close();
    await srv.stop();
    for (const dir of [tmp, ...profiles]) {
        fs.rmSync(dir, {recursive: true, force: true, maxRetries: 5});
    }
}
console.log(failed ? `${failed} check(s) failed` : 'all checks ok');
process.exit(failed ? 1 : 0);
