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
//   1-2. the pages load without a CSP violation or an exception and run the script; at 390 px
//        nothing is wider than the screen and every control is at least 44 px;
//   1b.  the public pages (the start page without the club cookie, register, lost link, privacy, a
//        bad link) load the same way, without a script; with the cookie / goes to /manage;
//   1c.  two clubs in the cookie (Spokesmen CC as well): the overview's footer (390) and the
//        sidebar's (1280) offer Spokesmen CC, "Log out of Kettenfett RC" and "Log out of all clubs";
//        the button switches to that club, whose footer offers Kettenfett RC, which switches back;
//        Log out of the open club lands on the other club's overview;
//   1d.  the team page's "Plan on ZwiftGopher" (in its head beside "Upload a plan", side by side at
//        full width at 390 as "ZwiftGopher"; in an empty team's card the second button) opens the
//        planner in a new tab with the team's token, and the upload page has none; two plans pushed
//        with it (POST /api/v3/push) are listed on the team page, newest first, and counted in the
//        switcher and the sidebar; the club hub lists Cogs to fix and the two plans waiting, with
//        the team tiles at 390 only; with --shots
//        captain-team-{empty,plans}-{390,1280}-light.png (Cogs, Rollers before the pushes),
//        captain-team-received-{390,1280}-light.png, captain-team-received-390-dark.png,
//        captain-teams-received-390-light.png and captain-hub-{390,1280}-light.png (full page);
//   3.   the upload page shows the text export as a plain field and stays when the file is chosen
//        (no auto-Continue); Continue goes on to the assign page, which shows the
//        moves and what is still to do, has no "Update preview" button, and redraws itself when
//        the plan radio or the live box changes, keeping the scroll position, the focused field
//        and a typed type; the race date typed digit by digit redraws it once, a second after the
//        last digit and never midway, or at once when the captain leaves the field; Store makes
//        v2 live; at 1280 a page below the hub has one breadcrumb line above its head instead of
//        the back bar and the kicker, its crumb before the page where the phone's bar goes (the
//        upload page opened with from=plan goes back to the plan), the hub has none;
//   3b.  the reshuffle of spec §10: "Upload for Sprockets" carries the plan; no holes are left;
//   3c.  Restore of the live plan asks in its place (arm in place, UI panel wave 2: the gate is open)
//        and posts confirm=1; the flash; Restore v2 next;
//   3e.  a refused Store ("Pick a plan.", pressed right after typing a date: no redraw races it,
//        the page stays at its top with the flash) keeps the typed type through the next redraw;
//        Discard, at least 24 px below Store, asks first in its place;
//   4.   the guarded reload waits while a row's Make live strip is open;
//   5.   the stale line when offline;
//   3d.  Make live on a row and "Make v2 live" ask in their place first (the strip where the button
//        was, the row's whole width at 390, the confirm button focused and described by the words),
//        post confirm=1, and change team.live only when pressed;
//   6.   Make live without the script: a second tab with script execution disabled posts Make
//        live (the strip stays hidden), gets the server's confirm page, and confirms; team.live
//        changes only then;
//   7.   Delete plan on the plan page asks in its place first, its confirm in the danger style.
//   9.   arm in place by keyboard and mouse: Enter opens a strip, Esc and Cancel close it (the focus
//        back on the trigger), a press of the confirm button within 450 ms of arming is ignored,
//        one strip at a time, the Remove strip follows the Zwift ID edited after
//        arming, a double click on a confirm button posts once (Discard is 24 px from Review and
//        store, checked in 1d); before the gate a plain Make live goes at once and its flash's Undo
//        takes it back; with --shots the open strips of the team, plan, team settings and club
//        settings pages at 390 and 1280 (captain-<page>-armed-<w>-light.png), the assign page's
//        Discard (captain-assign-armed-{390,1280}-light.png) and the Undo flash
//        (captain-team-undo-{390,1280}-light.png: after Make live the page lands on the live row, its
//        Undo in that row, in view below the top bar; Undo says "Undone" there).
//   10.  the hub with nothing to do and nothing waiting (Spokesmen CC with one team and its live
//        plan) says so in one line; with --shots captain-hub-empty-{390,1280}-light.png;
//   8.   (with --shots) a special team's assign page: date and time above the fold, a neutral line
//        while they are empty, the date and then the time redraw the preview, Store sets the race's
//        start, a version with another time says the race moves; Add a team hides the weekly
//        fields while special is checked.
// Each check prints `ok …` or `FAIL …`; any FAIL exits 1. With --shots it saves
// captain-teams-390-{light,dark}.png, captain-team-390-{light,dark}.png (the first screen),
// captain-team-settings-390-{light,dark}.png, captain-team-cogs-390-light.png (Cogs, no start
// time), captain-assign-390-light.png (the assign page right after the upload) and
// captain-plan-390-light.png (a plan page), a special team's assign page empty, filled and moving
// its race's start (captain-assign-special-{empty,filled,move}-{390,1280}-light.png), its settings
// (captain-team-settings-special-{390,1280}-light.png) and Add a team with special checked
// (captain-new-team-special-390-light.png), and every captain page at 1280 (full page, so the
// desktop frames can be laid side by side) and those not named yet at 390, and the team page with its
// switcher open, captain-team-switch-390-light.png:
// captain-<page>-{390,1280}-light.png for teams (1280 only), team (1280 only), team-cogs (1280
// only), team-settings (1280 only), club-settings, new-team, upload, upload-from-plan (New version
// on the plan page), assign (1280 only), result
// (the answer to Store), plan (1280 only), team-gone, plan-gone, entry-gone, not-found (an unknown
// /manage path), privacy (signed in: its back bar), live-confirm and
// back-confirm and delete-confirm (the no-script questions) and code (the new rider code, shot last: it makes the
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
import {startServer, fakeMailer, planJson, T, CODE_SECRET} from './helpers.mjs';
import {CID, makeClub, secondClub, upload} from './manage-helpers.mjs';
import {uploadSheet, addTeam, addEntry, discardEntry, deleteTeam} from '../club.mjs';
import {randomId} from '../ids.mjs';

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
const rollersLive = upload(c.club, 'rollers', {riders: ['1001', '1002', '1003', '1004', '1005', '1006'], at: T('2026-11-18T20:00:00Z')});
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
for (const aid of ['1001', '1002', '1003', '1004']) {
    see(aid, '2026-11-19T18:05:00Z', {sig: rSig, mod: '0.3.0', sheet: rollersLive, inEvent: true, event: 4567001});
}
see('1005', '2026-11-19T16:30:00Z', {sig: 'ABC123', mod: '0.3.0', sheet: rollersLive, inEvent: false, event: null});
see('1007', '2026-11-19T18:08:00Z', {sig: c.club.sheets[sprocketsLive].sig, mod: '0.3.0', sheet: sprocketsLive, inEvent: true, event: 4567002});
const base = srv.base;
const token = c.cookie.slice(c.cookie.indexOf('=') + 1);
const club = () => srv.store.get(CID);
const liveOf = slug => club().teams[slug].live;
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
const fit = `JSON.stringify((() => {
  const small = [];
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  for (const el of document.querySelectorAll('a,button,summary,input:not([type=hidden]),select,label.choice')) {
    // .prose: links inside a sentence of running text (WCAG 2.5.8 inline exception)
    if (el.closest('.sr,.vh,.skip') || el.matches('.prose a') || !vis(el)) continue;
    const r = el.matches('input[type=radio],input[type=checkbox]') ? el.closest('label').getBoundingClientRect() : el.getBoundingClientRect();
    if (r.height < 43.5 || r.width < 43.5) small.push((el.textContent.trim() || el.name || el.tagName).slice(0, 28) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  }
  return {sw: document.documentElement.scrollWidth, iw: innerWidth, small};
})())`;
async function clean(p) {
    const js = await tab.evaluate('document.documentElement.classList.contains("js")');
    const csp = await tab.evaluate('window.__csp');
    report(js && !csp.length && !tab.logs.length, `${p} loads clean and runs the script`,
        [js ? '' : 'no html.js', ...csp.map(v => `CSP ${v}`), ...tab.logs].filter(Boolean).join('; '));
    const f = JSON.parse(await tab.evaluate(fit));
    report(f.sw <= f.iw, `${p} fits 390 px`, `scrollWidth ${f.sw}, innerWidth ${f.iw}`);
    report(!f.small.length, `${p} tap targets >= 44 px`, f.small.join(' | '));
}

// Arm in place (UI panel wave 2): an action that asks first, its form found by `pick` (a predicate on
// the form[data-arm], in the page). The mouse at the middle of a rect {x, y, width, height}.
const ARM = pick => `[...document.querySelectorAll('form[data-arm]')].find(${pick})`;
async function clickAt(r, on = tab) {
    for (const type of ['mousePressed', 'mouseReleased']) {
        await on.send('Input.dispatchMouseEvent', {type, x: r.x + r.width / 2, y: r.y + r.height / 2, button: 'left', clickCount: 1});
    }
}
// the rect of the element `sel` (an expression in the page), scrolled into view first (`center`) or not
const rectOf = async (sel, center = true) => JSON.parse(await tab.evaluate(`JSON.stringify((() => { const el = ${sel};
  ${center ? 'el.scrollIntoView({block: "center"});' : ''} const r = el.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height, pageY: r.y + scrollY}; })())`));
const strip = pick => `JSON.stringify((() => {
  const f = ${ARM(pick)}, st = f.querySelector('[data-arm-strip]'), yes = f.querySelector('[data-arm-yes]');
  const words = document.getElementById(yes.getAttribute('aria-describedby'));
  const s = st.getBoundingClientRect(), b = yes.getBoundingClientRect();
  return {open: !st.hidden && f.classList.contains('armed'), top: s.top + scrollY, inView: b.height > 0 && b.bottom <= innerHeight && b.top >= 0,
    focused: document.activeElement === yes, described: Boolean(words) && st.contains(words) && words.textContent.trim().length > 0,
    group: st.getAttribute('role') === 'group' && (st.getAttribute('aria-label') ?? '').startsWith('Confirm: '),
    triggerGone: f.querySelector('[data-arm-open]').getClientRects().length === 0,
    others: document.querySelectorAll('form[data-arm].armed').length - (f.classList.contains('armed') ? 1 : 0),
    button: yes.textContent.trim(), width: Math.round(s.width), row: Math.round(f.parentElement.getBoundingClientRect().width)};
})())`;
// press the trigger with the mouse and wait past the 450 ms guard: the strip's state ({open, inPlace
// (it opened where the trigger was), inView, focused, described, group, triggerGone, others, button})
async function openConfirm(pick, {wait = 500} = {}) {
    const t = await rectOf(`${ARM(pick)}.querySelector('[data-arm-open]')`);
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
    const r = await rectOf(`${ARM(pick)}.querySelector('[data-arm-yes]')`, false);
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

try {
    // ---- 1 and 2: the pages load clean, run the script, fit 390 px ----
    for (const p of ['/manage', '/manage/team/rollers', '/manage/team/cogs', '/manage/settings', '/manage/upload?team=rollers',
        `/manage/team/rollers/plan/${fastPlan}`]) {
        tab.logs.length = 0;
        await open(p);
        await clean(p);
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
            && link.target === '_blank' && link.rel === 'noopener noreferrer', 'the team page links to ZwiftGopher in a new tab, in its head beside Upload a plan', JSON.stringify(link));
        // the head's two buttons (UI panel wave 3): side by side at full width on a phone ("ZwiftGopher"),
        // under the race line; from 1024 px as wide as their words, "Plan on ZwiftGopher"
        const headActs = `JSON.stringify((() => {
          const row = document.querySelector('header .headacts'), [a, b] = row.querySelectorAll('a.btn'), race = document.querySelector('header .race');
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(), rr = row.getBoundingClientRect();
          return {side: Math.abs(ra.top - rb.top) < 1, full: Math.round(rb.right - ra.left) === Math.round(rr.width), under: ra.top >= race.getBoundingClientRect().bottom,
            words: b.innerText.trim(), name: b.getAttribute('aria-label'), wide: Math.round(ra.width), height: Math.round(ra.height)};
        })())`;
        const phoneHead = JSON.parse(await tab.evaluate(headActs));
        report(phoneHead.side && phoneHead.full && phoneHead.under && phoneHead.words === 'ZwiftGopher' && phoneHead.name === 'Plan on ZwiftGopher (opens a new tab)',
            'at 390 Upload a plan and ZwiftGopher sit side by side at full width under the race line', JSON.stringify(phoneHead));
        await open('/manage/team/rollers', {w: 1280});
        const deskHead = JSON.parse(await tab.evaluate(headActs));
        report(deskHead.side && !deskHead.full && deskHead.under && deskHead.words === 'Plan on ZwiftGopher', 'at 1280 the two buttons are as wide as their words, "Plan on ZwiftGopher"', JSON.stringify(deskHead));
        report(await tab.evaluate('document.querySelectorAll(".uplinks, .uplink").length === 0'), 'no links under the plans any more');
        await open('/manage/team/rollers');
        await open('/manage/team/cogs');
        const empty = JSON.parse(await tab.evaluate(planner('.card.empty')));
        await open('/manage/upload?team=rollers');
        const onUpload = await tab.evaluate('document.querySelectorAll(\'a[href^="https://zwiftgopher.com/"]\').length');
        report(empty !== null && empty.href.includes('?paceline=') && onUpload === 0, 'an empty team\'s card has it as its second button; the upload page has none',
            JSON.stringify({empty, onUpload}));
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
        const rows = JSON.parse(await tab.evaluate('JSON.stringify([...document.querySelectorAll(".callout.info .note p:nth-of-type(2)")].map(p => p.textContent))'));
        const marks = await tab.evaluate('[...document.querySelectorAll(".newplans")].filter(x => x.textContent === "2 new plans").length');
        report(String(statuses) === '201,201' && rows.join('|') === 'In the planner: Rollers slow · 4 riders|In the planner: Rollers fast · 6 riders' && marks === 2,
            'two pushed plans: listed newest first, counted in the switcher and sidebar', JSON.stringify({statuses, rows, marks}));
        // P2 (review M4): at 390 Discard sits at least 24 px from Review and store
        const apart = JSON.parse(await tab.evaluate(`JSON.stringify([...document.querySelectorAll('.callout.info .note-acts')].map(n => {
          const a = n.querySelector('a.btn').getBoundingClientRect(), b = n.querySelector('.discard [data-arm-open]').getBoundingClientRect();
          return b.top >= a.bottom ? Math.round(b.top - a.bottom) : Math.round(b.left - a.right); }))`));
        report(apart.length === 2 && apart.every(g => g >= 24), 'Discard at least 24 px from Review and store at 390', JSON.stringify(apart));
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
        // the club hub (UI panel wave 3): what to fix (Cogs has no start time) and the two plans waiting,
        // with Review and store and Discard; from 1024 px no team tiles (the sidebar has them)
        const hub = `JSON.stringify((() => {
          const lines = id => [...(document.getElementById(id)?.closest('section').querySelectorAll('.todo > li') ?? [])].map(li => li.innerText.replace(/\\s+/g, ' ').trim());
          const tiles = document.querySelector('.hub-teams');
          return {todo: lines('todo-h'), recv: lines('recv-h'), races: [...document.querySelectorAll('.racetable')].length, tiles: tiles.getClientRects().length > 0,
            add: document.querySelector('a.hub-add').getClientRects().length > 0};
        })())`;
        for (const w of [390, 1280]) {
            await open('/manage', {w});
            const h = JSON.parse(await tab.evaluate(hub));
            report(h.todo.length === 1 && h.todo[0].startsWith('Cogs') && h.todo[0].includes('No start time and no plan') && h.recv.length === 2
                && h.recv.every(x => x.startsWith('Rollers Sent') && x.includes('Review and store')) && h.races === 1 && h.tiles === (w === 390) && h.add,
            `at ${w} the hub: Cogs to fix, two plans waiting, tonight's race; team tiles ${w === 390 ? 'under them' : 'only in the sidebar'}`, JSON.stringify(h));
            if (w === 390) {
                tab.logs.length = 0;
                await clean('/manage (hub with plans waiting)');
            }
            if (shotsDir) {
                await shootNow(`captain-hub-${w}-light.png`, w);
            }
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
        });
    }

    // ---- 3: upload, assign (redraws by itself), store ----
    tab.logs.length = 0;
    await open(`/manage/upload?team=rollers&plan=${rollersLive}`);
    tab.posts.length = 0;
    const textField = await tab.evaluate(`(() => { const i = document.querySelector('input[name=text]');
      return Boolean(i) && !i.closest('details') && i.getClientRects().length > 0; })()`);
    report(textField, 'the text export is a plain visible field, in no fold');
    // setting the files fires input and change, as a real choice does
    const stayed = await chooseAndContinue(rollersFile);
    report(stayed, 'choosing the file stays on the upload page (no auto-Continue)');
    const assignAt = await pathOf();
    report(/^\/manage\/inbox\/[0-9a-z]{6}$/.test(assignAt), 'Continue goes on to the assign page', assignAt);
    report(tab.posts.filter(x => x.url.startsWith('/manage/upload')).length === 1, 'one upload sent', JSON.stringify(tab.posts.map(x => x.url)));
    // "What happens": its lines, without the heading
    const what = () => tab.evaluate('document.querySelector("#wh-h")?.closest("section").querySelector(".pv-list").innerText ?? ""');
    let wh = await what();
    report(wh.includes('moves from') && wh.includes('Still to do'), 'What happens shows the moves and what is still to do', JSON.stringify(wh));
    await clean(assignAt);
    // the summary line and its "What changed" fold never overlap (UI panel, 19 Nov 2026: "Jo out"
    // ran into "What changed" at 390): the fold sits below the text, at every width, open or not
    const overlaps = [];
    for (const w of [320, 390, 600, 1024, 1280]) {
        await tab.send('Emulation.setDeviceMetricsOverride', {width: w, height: 844, deviceScaleFactor: 2, mobile: w < 600});
        await sleep(150);
        for (const open of [false, true]) {
            const r = await tab.evaluate(`(() => {
              const fold = document.querySelector('#wh-h')?.closest('section').querySelector('.pv-list li > details.fold');
              if (!fold) return null;
              fold.open = ${open};
              const text = fold.parentElement.querySelector(':scope > span').getBoundingClientRect();
              const sum = fold.querySelector('summary').getBoundingClientRect();
              return {textBottom: text.bottom, foldTop: fold.getBoundingClientRect().top, sumLeft: sum.left, textLeft: text.left};
            })()`);
            if (r === null || r.foldTop < r.textBottom - 0.5 || Math.abs(r.sumLeft - r.textLeft) > 1) {
                overlaps.push({w, open, ...r});
            }
        }
    }
    await tab.evaluate('document.querySelector("#wh-h").closest("section").querySelector(".pv-list li > details.fold").open = false');
    await tab.send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 2, mobile: true});
    await sleep(150);
    report(overlaps.length === 0, 'What happens: "What changed" sits below its line, aligned with the text, from 320 to 1280 px', JSON.stringify(overlaps));
    const noButton = await tab.evaluate('!document.querySelector("[data-redraw], [formmethod]") && !document.body.innerText.includes("Update preview")');
    report(noButton, 'the assign page has no "Update preview" button');
    if (shotsDir) {
        await shootNow('captain-assign-390-light.png');
        await shootNow('captain-assign-1280-light.png', 1280);
    }
    const checkedAs = () => tab.evaluate('document.querySelector("input[name=as]:checked")?.value ?? null');
    report(await checkedAs() === fastPlan, 'the plan the upload came from is preselected', await checkedAs());

    // the captain types a type, scrolls, picks "New plan": the page redraws itself
    await tab.evaluate('document.querySelector("input[name=type]").focus()');
    await tab.send('Input.insertText', {text: 'fast'});
    const state = `JSON.stringify({y: Math.round(scrollY), type: document.querySelector('input[name=type]').value,
      live: document.querySelector('input[name=live]').checked, as: document.querySelector('input[name=as]:checked')?.value ?? null,
      focus: document.activeElement?.name ?? null, focusValue: document.activeElement?.value ?? null, touched: document.querySelector('input[name=touched]').value,
      url: location.pathname + location.search, n: performance.getEntriesByType('navigation')[0]?.type})`;
    report(JSON.parse(await tab.evaluate(state)).touched === 'type', 'typing the type marks it touched');
    const scrollTo = async () => {
        await tab.evaluate('window.scrollTo(0, Math.min(260, document.documentElement.scrollHeight - innerHeight))');
        await sleep(100);
        return tab.evaluate('Math.round(scrollY)');
    };
    let y = await scrollTo();
    let redrawn = await follow('document.querySelector("input[name=as][value=new]").click()');
    let s = JSON.parse(await tab.evaluate(state));
    report(redrawn && s.url.startsWith(`${assignAt}?`) && s.as === 'new', 'picking another plan redraws the page (a GET of itself)', s.url);
    report(y > 0 && Math.abs(s.y - y) <= 2, 'the redraw keeps the scroll position', `${y} → ${s.y}`);
    report(s.focus === 'as' && s.focusValue === 'new', 'the redraw focuses the changed field', `${s.focus}=${s.focusValue}`);
    report(s.type === 'fast', 'the redraw keeps the typed type', JSON.stringify(s.type));
    report(s.live === false, 'a new plan next to the live plan: the box goes back to off');
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
    const dateNow = () => tab.evaluate('document.querySelector("input[name=date]")?.value ?? null');
    await tab.evaluate(`(() => { const d = document.querySelector('input[name=date]'); window.__changes = 0;
      d.addEventListener('change', () => window.__changes++); d.closest('details').open = true; d.scrollIntoView({block: 'center'}); d.focus(); })()`);
    const drawnDate = await dateNow();
    let navs = tab.navs.count;
    let dateLoaded = tab.once('Page.loadEventFired', 4000);
    await typeDate('2026', '11', '20');
    const midway = {changes: await tab.evaluate('window.__changes'), navs: tab.navs.count - navs, value: await dateNow()};
    report(midway.navs === 0 && midway.value === '2026-11-20', 'typing the date digit by digit does not redraw midway', JSON.stringify({drawnDate, ...midway}));
    await dateLoaded;
    await sleep(1500);
    s = JSON.parse(await tab.evaluate(state));
    report(tab.navs.count - navs === 1 && /[?&]date=2026-11-20(&|$)/.test(s.url) && await dateNow() === '2026-11-20',
        'a second after the last digit the page redraws once with that date', `${tab.navs.count - navs} redraws, ${midway.changes} changes, ${s.url}`);
    report(s.focus === 'date' && await tab.evaluate('document.querySelector("input[name=date]").closest("details").open'), 'the date keeps its focus, its fold open');
    // typed and left at once (a tap on the event link): the redraw comes on leaving, not a second later
    navs = tab.navs.count;
    dateLoaded = tab.once('Page.loadEventFired', 4000);
    await typeDate('2026', '11', '19');
    const ev = JSON.parse(await tab.evaluate('(() => { const e = document.querySelector("input[name=event]"); e.scrollIntoView({block: "center"}); return JSON.stringify(e.getBoundingClientRect()); })()'));
    const leftAt = Date.now();
    for (const type of ['mousePressed', 'mouseReleased']) {
        await tab.send('Input.dispatchMouseEvent', {type, x: ev.x + 10, y: ev.y + ev.height / 2, button: 'left', clickCount: 1});
    }
    await dateLoaded;
    const took = Date.now() - leftAt;
    await sleep(1500);
    s = JSON.parse(await tab.evaluate(state));
    report(tab.navs.count - navs === 1 && took < 900 && /[?&]date=2026-11-19(&|$)/.test(s.url) && s.focus === 'event',
        'leaving the date redraws at once, once, and focuses where the captain went', `${tab.navs.count - navs} redraws in ${took} ms, focus ${s.focus}`);

    // the live box
    y = await scrollTo();
    redrawn = await follow('document.querySelector("input[name=live]").click()');
    s = JSON.parse(await tab.evaluate(state));
    report(redrawn && s.live === true && s.type === 'fast' && /[?&]touched=live%2Ctype(&|$)/.test(s.url), 'ticking the live box redraws the page and keeps it ticked',
        JSON.stringify(s));
    report(Math.abs(s.y - y) <= 2 && s.focus === 'live', 'the scroll position and the focus stay', `${y} → ${s.y}, ${s.focus}`);

    // back to the live plan: the box and the type the captain touched stay
    redrawn = await follow(`document.querySelector("input[name=as][value='${fastPlan}']").click()`);
    s = JSON.parse(await tab.evaluate(state));
    report(redrawn && s.as === fastPlan && s.live === true && s.type === 'fast', 'another plan choice keeps the touched box and type', JSON.stringify(s));
    wh = await what();
    report(wh.startsWith('v2 of \'Rollers · fast\', live') && wh.includes('moves from') && wh.includes('Still to do'), 'What happens follows the choice', JSON.stringify(wh));
    report(!tab.logs.length && !(await tab.evaluate('window.__csp')).length, 'redraws without errors', tab.logs.join('; '));

    const before = liveOf('rollers');
    await follow('document.querySelector("[data-submit]").click()');
    let text = await pageText();
    report(text.includes('v2 is live'), 'Store: "v2 is live"', JSON.stringify(text.slice(0, 200)));
    if (shotsDir) {
        await shootNow('captain-result-390-light.png');
        await shootNow('captain-result-1280-light.png', 1280);
    }
    report(liveOf('rollers') !== before && club().sheets[liveOf('rollers')].plan === fastPlan && club().sheets[liveOf('rollers')].type === 'fast',
        'Rollers\' live plan is v2 of \'Rollers · fast\'');

    // ---- 3b: the reshuffle (spec §10): Upload for Sprockets, with its plan ----
    const href = await tab.evaluate('[...document.querySelectorAll("a")].find(a => a.textContent.includes("Upload for Sprockets"))?.getAttribute("href") ?? ""');
    report(href === `/manage/upload?team=sprockets&plan=${sprocketsLive}`, '"Upload for Sprockets" carries its live plan', href);
    await follow(`location.href = ${JSON.stringify(href)}`);
    await chooseAndContinue(sprocketsFile);
    wh = await what();
    report(/^\/manage\/inbox\//.test(await pathOf()) && wh.startsWith('v2 of \'Sprockets\', live') && !wh.includes('Still to do'),
        'Sprockets: a new version of its live plan, no holes', JSON.stringify(wh));
    await follow('document.querySelector("[data-submit]").click()');
    text = await pageText();
    report(text.includes('v2 is live') && !text.includes('Still to do'), 'Sprockets stored, nothing still to do', JSON.stringify(text.slice(0, 200)));
    for (const slug of ['sprockets', 'rollers']) {
        await open(`/manage/team/${slug}`);
        text = await pageText();
        const notes = await tab.evaluate('[...document.querySelectorAll(".note")].map(n => n.innerText).join(" | ")');
        report(!text.includes('Still to do') && !text.includes('Upload without') && notes === '', `/manage/team/${slug} shows no hole`, notes);
    }

    // ---- 3c: Restore of the live plan asks in its place (the gate is open); then it offers the way back ----
    await open('/manage/team/rollers');
    const back1 = 'f => f.querySelector("[data-arm-open]").textContent.startsWith("Restore v1")';
    let cf = await openConfirm(back1);
    report(cf.open && cf.inPlace && cf.focused && cf.described && cf.group && cf.triggerGone && cf.others === 0,
        'Restore v1: the strip opens in its place, its confirm button focused and described by the words', JSON.stringify(cf));
    let liveNow = liveOf('rollers');
    report(liveNow === newestOf(fastPlan)[0], 'opening it changes nothing');
    let pressed = await pressConfirm(back1);
    report(pressed.post?.url === '/manage/plan/back' && /(^|&)confirm=1(&|$)/.test(pressed.post.body), 'Back posts confirm=1', JSON.stringify(pressed.post));
    let fl = await flash();
    report(fl.startsWith('Restored v1:'), 'the flash says "Restored v1:"', JSON.stringify(fl));
    report(club().sheets[liveOf('rollers')].n === 3, 'v3 (the copy of v1) is live');
    report(await tab.evaluate('[...document.querySelectorAll(".planrow.live [data-arm-open]")].some(s => s.textContent.startsWith("Restore v2"))'),
        'the live row then offers "Restore v2"');

    // ---- 3e: a refused Store keeps what the captain touched; Store does not race the date ----
    await open('/manage/upload?team=rollers');
    await chooseAndContinue(tempoFile);
    const tempoAt = await pathOf();
    report(/^\/manage\/inbox\//.test(tempoAt) && await checkedAs() === null, 'two plans in the race: no plan preselected', `${tempoAt} ${await checkedAs()}`);
    await tab.evaluate('document.querySelector("input[name=type]").focus()');
    await tab.send('Input.insertText', {text: 'tempo'});
    // a new date typed, then Store pressed at once: the POST goes, no redraw
    await tab.evaluate(`(() => { const d = document.querySelector('input[name=date]'); d.closest('details').open = true; d.scrollIntoView({block: 'center'}); d.focus(); })()`);
    await typeDate('2026', '11', '20');
    const store = JSON.parse(await tab.evaluate('(() => { const b = document.querySelector("[data-submit]"); b.scrollIntoView({block: "center"}); return JSON.stringify(b.getBoundingClientRect()); })()'));
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
    report(refusedFlash === 'Pick a plan.' && s.url === tempoAt && tab.navs.count - navs === 1 && tab.posts.length === 1,
        'Store right after typing a date: one POST, no redraw, refused "Pick a plan."', `${tab.navs.count - navs} pages, ${tab.posts.length} posts, ${s.url}, ${JSON.stringify(refusedFlash)}`);
    report(s.y === 0 && await tab.evaluate('document.querySelector(".flash").getBoundingClientRect().top >= 0'), 'the refused page stays at its top, the flash in view', `y ${s.y}`);
    report(s.touched === 'type' && s.type === 'tempo', 'the refused page carries the touched type', JSON.stringify({touched: s.touched, type: s.type}));
    redrawn = await follow('document.querySelector("input[name=as][value=new]").click()');
    s = JSON.parse(await tab.evaluate(state));
    report(redrawn && s.as === 'new' && s.type === 'tempo' && s.touched === 'type', 'the next redraw keeps the typed type', JSON.stringify(s));
    const entry = tempoAt.split('/').at(-1);
    // Discard: on a line of its own, set apart from Store; it asks first in its place
    const gap = await tab.evaluate(`(() => { const a = document.querySelector('[data-submit]').getBoundingClientRect();
      const b = document.querySelector('form.discard [data-arm-open]').getBoundingClientRect(); return b.top - a.bottom; })()`);
    report(gap >= 24, 'Discard sits at least 24 px below Store', `${gap} px`);
    const discard = 'f => f.matches(".discard")';
    cf = await openConfirm(discard);
    report(cf.open && cf.focused && cf.button === 'Discard plan' && club().inbox.some(e => e.id === entry), 'Discard asks first; nothing discarded yet', JSON.stringify(cf));
    if (shotsDir) {
        await shootView('captain-assign-armed-390-light.png');
    }
    await pressConfirm(discard);
    report((await flash()).startsWith('Discarded') && !club().inbox.some(e => e.id === entry), 'Discard', await flash());

    // ---- the way back (UI panel wave 3): at 1280 one breadcrumb line above the page's head instead of
    // the back bar and the kicker, its crumb before the page where the phone's bar goes; the team
    // page's switcher stays hidden; at 390 the bar as before and no breadcrumb ----
    const way = `JSON.stringify((() => {
      const shown = el => Boolean(el) && el.getClientRects().length > 0;
      const a = document.querySelector('.app>.topbar .back'), club = document.querySelector('.app>.topbar .topbar-club'), h = document.querySelector('main h1');
      const nav = document.querySelector('nav.crumbs'), links = nav ? [...nav.querySelectorAll('a')] : [];
      const kicker = [...document.querySelectorAll('main .pagehead .kicker')].some(shown);
      return {bar: shown(a) ? a.getAttribute('href') : null, club: club ? shown(club) : null, crumbs: shown(nav) ? [...nav.querySelectorAll('li')].map(li => li.querySelector('a, [aria-current]').textContent).join(' › ') : null,
        parent: links.length ? links.at(-1).getAttribute('href') : null, current: nav?.querySelector('[aria-current=page]')?.textContent ?? null,
        above: shown(nav) && h ? nav.getBoundingClientRect().bottom <= h.getBoundingClientRect().top : null, kicker};
    })())`;
    for (const [p, href, crumbs] of [[`/manage/upload?team=rollers&plan=${fastPlan}&from=plan`, `/manage/team/rollers/plan/${fastPlan}`, 'Kettenfett RC › Rollers › Rollers · fast › Upload'],
        ['/manage/upload?team=rollers', '/manage/team/rollers', 'Kettenfett RC › Rollers › Upload'],
        [`/manage/team/rollers/plan/${fastPlan}`, '/manage/team/rollers', 'Kettenfett RC › Rollers › Rollers · fast'],
        ['/manage/team/rollers/settings', '/manage/team/rollers', 'Kettenfett RC › Rollers › Team settings'], ['/manage/new-team', '/manage', 'Kettenfett RC › Add a team'],
        ['/manage/settings', '/manage', 'Kettenfett RC › Club settings'], ['/manage/team/rollers', '/manage', 'Kettenfett RC › Rollers']]) {
        await open(p, {w: 1280});
        const wb = JSON.parse(await tab.evaluate(way));
        report(wb.bar === null && wb.crumbs === crumbs && wb.parent === href && wb.above === true && !wb.kicker,
            `at 1280 ${p}: the breadcrumb "${crumbs}" above its head, no back bar, no kicker`, JSON.stringify(wb));
        await open(p);
        const ph = JSON.parse(await tab.evaluate(way));
        // (the team page's bar is its switcher, whose back link goes to the hub)
        report(ph.crumbs === null && ph.bar === href, `at 390 ${p}: the bar goes where the crumb before the page goes, no breadcrumb`, JSON.stringify(ph));
    }
    await open('/manage', {w: 1280});
    report(JSON.parse(await tab.evaluate(way)).crumbs === null, 'at 1280 the hub has no breadcrumb');
    await open(`/manage/upload?team=rollers&plan=${fastPlan}&from=plan`);
    const phone = JSON.parse(await tab.evaluate(way));
    report(phone.bar === `/manage/team/rollers/plan/${fastPlan}` && phone.club === true, 'at 390 the bar goes back to the plan and names the club', JSON.stringify(phone));

    // ---- shots for a look next to the prototype's ----
    if (shotsDir) {
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
        for (const scheme of ['light', 'dark']) {
            await shoot(`captain-teams-390-${scheme}.png`, '/manage', 390, scheme, false);
            await shoot(`captain-team-390-${scheme}.png`, '/manage/team/rollers', 390, scheme, false);
            await shoot(`captain-team-settings-390-${scheme}.png`, '/manage/team/rollers/settings', 390, scheme, true);
        }
        await shoot('captain-team-cogs-390-light.png', '/manage/team/cogs', 390, 'light', true);
        // the team page with its switcher open (phones: the teams, All teams)
        await open('/manage/team/rollers');
        await tab.evaluate('document.querySelector("details.switch").open = true');
        await shootNow('captain-team-switch-390-light.png');
        await shoot('captain-plan-390-light.png', `/manage/team/rollers/plan/${fastPlan}`, 390, 'light', true);
        // a special team (user, 19 Nov 2026): its settings without a start time, and the assign page of
        // its plans with date and start time at the top: empty (a neutral line, nothing red), filled
        // (the time redraws the preview), and a version that moves the race's start; the team goes
        // again after the shots
        const gears = srv.store.change(CID, cl => addTeam(cl, {name: 'Gears', kind: 'special', weekday: null},
            {slugTaken: s2 => srv.store.slugTaken(s2), now: NOW}));
        const gearsEntry = (riders = ['1008', '1009']) => srv.store.change(CID, cl => addEntry(cl, {source: 'upload', team: gears, json: planJson('Gears', riders), text: null},
            {now: NOW, newId: () => randomId(6)}));
        const what = `JSON.stringify([...document.querySelectorAll('section[aria-labelledby=wh-h] li')].map(li => [li.className, li.innerText.trim()]))`;
        // set a field as typed and left: the page redraws itself (or not, then null after 3 s)
        const setField = async (name, value) => {
            const loaded = tab.once('Page.loadEventFired', 3000);
            await tab.evaluate(`(() => { const f = document.querySelector('input[name=${name}]'); f.focus(); f.value = '${value}';
              f.dispatchEvent(new Event('input', {bubbles: true})); f.dispatchEvent(new Event('change', {bubbles: true})); })()`);
            const got = await loaded;
            await sleep(300);
            return got;
        };
        const first = gearsEntry();
        await open(`/manage/inbox/${first}`);
        const when = JSON.parse(await tab.evaluate(`JSON.stringify((() => {
          const d = document.querySelector('.as-when input[name=date]'), s = document.querySelector('.as-when input[name=start]');
          const fold = document.querySelector('details.card.fold');
          return {date: !!d && d.required, start: !!s && s.required, above: !!s && !!fold && s.getBoundingClientRect().bottom < fold.getBoundingClientRect().top};
        })())`));
        report(when.date && when.start && when.above, 'a special team\'s assign page asks for date and start time above the fold', JSON.stringify(when));
        const empty = JSON.parse(await tab.evaluate(what));
        report(empty.length === 1 && empty[0][0] === 'neutral' && empty[0][1] === 'Choose the race date and start time.',
            'empty date and time: a neutral line, nothing red', JSON.stringify(empty));
        for (const w of [390, 1280]) {
            await shoot(`captain-assign-special-empty-${w}-light.png`, `/manage/inbox/${first}`, w, 'light', true);
        }
        await open(`/manage/inbox/${first}`);
        const byDate = await setField('date', '2026-11-29');
        const afterDate = JSON.parse(await tab.evaluate(what));
        const byTime = await setField('start', '20:15');
        const filled = JSON.parse(await tab.evaluate(what));
        const race = await tab.evaluate('document.querySelector(".as-row:not(:has(.kicker))")?.innerText ?? ""');
        report(byDate !== null && afterDate[0]?.[1] === 'Choose the start time.' && byTime !== null
            && filled.some(([, text]) => text.startsWith('New plan \'Gears\', live for Sun 29 Nov 20:15.')) && race.includes('Sun 29 Nov 20:15'),
            'the date and then the time redraw the preview, which uses the time', JSON.stringify({afterDate, filled, race}));
        const filledAt = await tab.evaluate('location.pathname + location.search');
        for (const w of [390, 1280]) {
            await shoot(`captain-assign-special-filled-${w}-light.png`, filledAt, w, 'light', true);
        }
        await open(filledAt);
        await follow('document.querySelector("[data-submit]").click()');
        const gearsPlan = Object.values(club().sheets).find(sh => sh.team === gears)?.plan;
        report(club().teams[gears].raceStarts?.['2026-11-29'] === '20:15' && gearsPlan, 'Store sets the race\'s start', JSON.stringify(club().teams[gears].raceStarts));
        // a new version with another time: the race moves, the preview says so
        const second = gearsEntry(['1008']);
        await open(`/manage/inbox/${second}?team=${gears}&as=${gearsPlan}&drawn=${gears}:${gearsPlan}&live=on`);
        await setField('start', '21:15');
        const moved = JSON.parse(await tab.evaluate(what));
        report(moved.some(([, text]) => text === 'Race on Sun 29 Nov now starts at 21:15 (was 20:15).'), 'a version with another time: the preview says the race moves', JSON.stringify(moved));
        const movedAt = await tab.evaluate('location.pathname + location.search');
        for (const w of [390, 1280]) {
            await shoot(`captain-assign-special-move-${w}-light.png`, movedAt, w, 'light', true);
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
            ['upload', '/manage/upload?team=rollers', 390], ['upload-from-plan', `/manage/upload?team=rollers&plan=${fastPlan}&from=plan`, 390],
            ['plan', `/manage/team/rollers/plan/${fastPlan}`],
            ['team-gone', '/manage/team/nope', 390], ['plan-gone', '/manage/team/rollers/plan/zzzzzz', 390], ['entry-gone', '/manage/inbox/zzzzzz', 390],
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
    tab.logs.length = 0;
    await open('/manage/team/rollers');
    const slowRow = 'f => f.closest(".planrow") && !f.closest(".planrow.live") && f.getAttribute("action") === "/manage/live"';
    await tab.evaluate('window.__mark = 1');
    cf = await openConfirm(slowRow);
    report(cf.open, 'the row\'s Make live strip is open', JSON.stringify(cf));
    // the focus on a button holds nothing: only the open strip does
    await sleep(35000);
    report(await tab.evaluate('window.__mark') === 1, 'no reload while a row\'s Make live strip is open');
    await key('Escape', 'Escape', 27);
    await tab.evaluate('document.activeElement.blur()');
    await sleep(35000);
    report(await tab.evaluate('typeof window.__mark') === 'undefined', 'reload once it is closed');
    report(!tab.logs.length, 'reload without errors', tab.logs.join('; '));

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

    // ---- 3d: Make live on a row asks first (the gate is open); so does "Make v2 live" ----
    await open('/manage/team/rollers');
    liveNow = liveOf('rollers');
    cf = await openConfirm(slowRow);
    report(cf.open && cf.inPlace && cf.inView && cf.focused && cf.described, 'Make live on a row: the strip opens in its place', JSON.stringify(cf));
    report(cf.width === cf.row, 'at 390 the strip takes the row\'s whole width', `${cf.width} of ${cf.row}`);
    await sleep(500);
    report(liveOf('rollers') === liveNow, 'team.live unchanged until the button is pressed');
    pressed = await pressConfirm(slowRow);
    report(pressed.post?.url === '/manage/live' && /(^|&)confirm=1(&|$)/.test(pressed.post.body), 'Make live posts confirm=1', JSON.stringify(pressed.post));
    report(liveOf('rollers') === rollersSlow, '\'Rollers · slow\' is live', await flash());

    // a newer version of the live plan that is not live: "Make v2 live"
    srv.store.change(CID, cl => uploadSheet(cl, {
        slug: 'rollers', json: planJson('Rollers slow', ['1002', '1003', '1004', '1005', '1006']), text: null, as: slowPlan, live: false,
        base: cl.teams.rollers.version, pinnedEventId: null, via: 'file',
    }, {now: NOW, newId: () => randomId(6)}));
    const [slowV2] = newestOf(slowPlan);
    await open('/manage/team/rollers');
    const newer = 'f => f.querySelector("[data-arm-open]").textContent.startsWith("Make v2 live")';
    cf = await openConfirm(newer);
    report(cf.open && cf.inPlace && cf.focused, '"Make v2 live": the strip opens in its place', JSON.stringify(cf));
    report(liveOf('rollers') === rollersSlow, 'team.live unchanged until the button is pressed');
    pressed = await pressConfirm(newer);
    report(pressed.post?.url === '/manage/live' && /(^|&)confirm=1(&|$)/.test(pressed.post.body), '"Make v2 live" posts confirm=1', JSON.stringify(pressed.post));
    report(liveOf('rollers') === slowV2, 'v2 of \'Rollers · slow\' is live', await flash());

    // ---- 6: Make live without the script: the server's confirm page ----
    const plain = await chrome.newTab();
    await plain.send('Emulation.setScriptExecutionDisabled', {value: true});
    await open('/manage/team/rollers', {on: plain});
    const [fastNewest] = newestOf(fastPlan);
    const info = JSON.parse(await plain.evaluate(`JSON.stringify({js: document.documentElement.classList.contains('js'),
      noteShown: [...document.querySelectorAll('p.banner.warn')].some(p => p.textContent === 'This page needs JavaScript. Make live and every button that asks first still work without it.' && p.getBoundingClientRect().height > 0)})`));
    report(!info.js && info.noteShown, 'without the script: no html.js, and the page says it needs JavaScript', JSON.stringify(info));
    // the row's Make live: without the script its strip stays hidden and the button posts without
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
    const rowForm = `form[action="/manage/live"]:has(input[name=sheet][value="${fastNewest}"])`;
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
    report(plain.posts.at(-1)?.url === '/manage/live' && !/confirm=/.test(plain.posts.at(-1).body) && text.includes('Make \'Rollers · fast\' live?'),
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

    // ---- 7: Delete plan on the plan page asks in the page first ----
    tab.logs.length = 0;
    await open(`/manage/team/rollers/plan/${slowPlan}`);
    const del = 'f => f.getAttribute("action") === "/manage/sheet/delete"';
    cf = await openConfirm(del);
    report(cf.open && cf.inPlace && cf.focused && cf.button.startsWith('Delete'), 'Delete plan: the strip opens in its place', JSON.stringify(cf));
    report(await tab.evaluate(`getComputedStyle(${ARM(del)}.querySelector('[data-arm-yes]')).backgroundColor !== getComputedStyle(${ARM(del)}.querySelector('[data-arm-cancel]')).backgroundColor`),
        'its confirm button has the danger style');
    report(Object.values(club().sheets).some(x => x.plan === slowPlan), 'nothing deleted until the button is pressed');
    pressed = await pressConfirm(del);
    report(pressed.post?.url === '/manage/sheet/delete' && await pathOf() === '/manage/team/rollers'
        && !Object.values(club().sheets).some(x => x.plan === slowPlan), 'Delete plan deletes it and goes back to the team page', `${JSON.stringify(pressed.post)} ${await flash()}`);
    report(!tab.logs.length && !(await tab.evaluate('window.__csp')).length, 'confirms without errors', tab.logs.join('; '));

    // ---- 9: arm in place, by keyboard and touch: Esc, the 450 ms guard, one strip at a time; a
    // switch before the gate goes at once and Undo takes it back; shots of the strips ----
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
    await open('/manage/team/rollers');
    const rowOf = label => `f => f.getAttribute("action") === "/manage/live" && f.closest(".planrow")?.querySelector(".label")?.textContent === "${label}"`;
    const spareRow = rowOf('Rollers · spare');
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
    // one strip at a time
    cf = await openConfirm(rowOf('Rollers · easy'));
    st = JSON.parse(await tab.evaluate(strip(spareRow)));
    report(cf.open && cf.others === 0 && !st.open, 'opening another strip closes the first', JSON.stringify({cf, st}));
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
            await open('/manage/team/rollers', {w});
            await openConfirm(spareRow);
            await shootView(`captain-team-armed-${w}-light.png`);
            await open(`/manage/team/rollers/plan/${fastPlan}`, {w});
            await openConfirm(del);
            await shootView(`captain-plan-armed-${w}-light.png`);
            await open('/manage/team/rollers/settings', {w});
            await openConfirm('f => f.closest(".danger-zone")');
            await shootView(`captain-team-settings-armed-${w}-light.png`);
            await open('/manage/settings', {w});
            await tab.evaluate('(() => { const i = document.querySelector("input[name=zwiftId]"); i.value = "1003"; })()');
            await openConfirm('f => f.getAttribute("action") === "/manage/rider/remove"');
            report((await tab.evaluate('document.querySelector("[data-arm-fill=zwiftId]").textContent')) === '1003', `at ${w} Remove a rider names the Zwift ID typed`);
            await shootView(`captain-club-settings-armed-${w}-light.png`);
            if (w === 1280) {
                let entryId = null;
                srv.store.change(CID, cl => {
                    entryId = addEntry(cl, {source: 'upload', team: 'rollers', json: planJson('Rollers tempo', ['1001', '1002', '1003']), text: null}, {now: NOW, newId: () => randomId(6)});
                });
                await open(`/manage/inbox/${entryId}`, {w});
                await openConfirm('f => f.matches(".discard")');
                await shootView('captain-assign-armed-1280-light.png');
            }
        }
        await open('/manage/team/rollers');
    }
    // a double click on the strip's confirm button, past the 450 ms guard: one POST (review M1)
    const easyRow = rowOf('Rollers · easy');
    await open('/manage/team/rollers');
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
    // before the gate (18:40), a switch with nothing to warn about goes at once, with Undo: Axles,
    // 19:30, two plans of riders no other team lists
    let axles = null;
    srv.store.change(CID, cl => {
        axles = addTeam(cl, {name: 'Axles', start: '19:30'}, {slugTaken: s2 => srv.store.slugTaken(s2), now: NOW});
        for (const [type, live] of [['a', true], ['b', false]]) {
            uploadSheet(cl, {slug: axles, json: planJson(`Axles ${type}`, ['2001', '2002', '2003']), text: null, date: '2026-11-19', as: 'new', type, live,
                base: cl.teams[axles].version, pinnedEventId: null, via: 'file'}, {now: NOW, newId: () => randomId(6)});
        }
    });
    clock.now = T('2026-11-19T17:40:00Z');
    await open(`/manage/team/${axles}`);
    const plainRow = 'document.querySelector(".planrow:not(.live) form[action=\'/manage/live\']:not([data-arm]) [type=submit]")';
    const hasPlain = await tab.evaluate(`${plainRow} !== null`);
    report(hasPlain, 'before the gate a row\'s Make live is a plain button');
    // where the live row and its Undo are once the page has come back (#plan-<id>): in the viewport,
    // below the sticky top bar (user, 19 Nov 2026: Undo where the action was)
    const placed = `JSON.stringify((() => {
      const row = document.querySelector('.planrow.live'), line = row?.querySelector('.flash');
      const bar = [...document.querySelectorAll('.topbar')].find(b => b.getClientRects().length && getComputedStyle(b).position === 'sticky');
      const r = (line ?? row).getBoundingClientRect();
      return {hash: location.hash, id: row?.id ?? null, undo: Boolean(line?.querySelector('form[action="/manage/live/undo"]')), text: line?.querySelector('p')?.textContent ?? '',
        top: Math.round(r.top), bottom: Math.round(r.bottom), ih: innerHeight, bar: bar ? Math.round(bar.getBoundingClientRect().bottom) : 0,
        topFlash: [...document.querySelectorAll('.flash')].some(f => !f.closest('.planrow'))};
    })())`;
    for (const w of hasPlain ? [390, 1280] : []) {
        await open(`/manage/team/${axles}`, {w});
        const was = liveOf(axles);
        tab.posts.length = 0;
        await tab.evaluate('scrollTo(0, document.documentElement.scrollHeight)');
        await follow(`${plainRow}.click()`);
        let at = JSON.parse(await tab.evaluate(placed));
        report(liveOf(axles) !== was && !/confirm=/.test(tab.posts.at(-1)?.body ?? 'confirm=') && at.undo && !at.topFlash && at.hash === `#${at.id}`,
            `at ${w} it goes live at once and lands on the live row, its Undo in that row, no top flash`, JSON.stringify(at));
        report(at.top >= at.bar && at.bottom <= at.ih, `at ${w} the live row's Undo is in view, below the top bar`, JSON.stringify(at));
        if (shotsDir) {
            await shootView(`captain-team-undo-${w}-light.png`);
        }
        await follow('document.querySelector(".planrow.live .flash.undo form [type=submit]").click()');
        at = JSON.parse(await tab.evaluate(placed));
        report(liveOf(axles) === was && at.text.startsWith('Undone:') && !at.undo && !at.topFlash && at.top >= at.bar && at.bottom <= at.ih,
            `at ${w} Undo makes the version before live again, said in its row`, JSON.stringify(at));
    }
    clock.now = NOW;
    srv.store.change(CID, cl => deleteTeam(cl, axles, NOW));
    report(!tab.logs.length && !(await tab.evaluate('window.__csp')).length, 'arm in place without errors', tab.logs.join('; '));

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
            ['back-confirm', '/manage/plan/back', {team: 'rollers', plan: fastPlan, n: '2', version: String(club().teams.rollers.version)}],
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
