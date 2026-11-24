// Settings window: the plan server and its Clubs table, import the planner files, choose the pull
// target unit, show who you are in the plan, list recordings.
// Plain DOM; rider names come from files and club names from the plan server, so they only ever go
// in through textContent.
import {importFiles, findMe, PlanError} from './engine/plan.mjs';
import {addPlan, fileEntry, activeEntry, fileActive, endFilePlan} from './engine/library.mjs';
import {serverBase, checkUrl, checkHeaders} from './engine/planserver.mjs';
import {settingsCheckResult, setJoined, joinedIds, sameJoined, sameCodes, normalizeCode, formatCode,
        codesToSend, addByCode, MAX_CODES} from './engine/clubs.mjs';
import {readClubs, writeClubs, onClubsChange, initClubs as initSharedClubs} from './clubs.mjs';
import {VERSION} from './version.mjs';
import {emptyPending, mergePending, markImported} from './engine/pending.mjs';
import {recordingFileName, recListKey} from './engine/recording.mjs';
import {serverConfigChange, logUploadChange, logUploadSinceFix, demoChange, demoOn} from './engine/prefs.mjs';
import {sessionTarget, autoUploadState} from './engine/logupload.mjs';
import {readLibrary, writeLibrary, activePlan, initFlush, onLibraryChange, readPrefs, writePrefs,
        onPrefsChange, liveSessionId, REC_STATE_KEY, LEASE_KEY, REC_MARK_KEY} from './store.mjs';
import {listSessions, exportSession, deleteSession} from './recdb.mjs';
import {uploadSession} from './logupload.mjs';
import {loadCommon, selfAthleteId, selfWeight} from './sauce.mjs';
import {S, fmt} from './strings.mjs';
import {youText} from './youline.mjs';
import {fieldKind} from './engine/display.mjs';

const $ = sel => document.querySelector(sel);
const ERROR_KEYS = {'no-json': 'noJson', 'not-a-plan': 'notAPlan', 'unreadable': 'unreadable'};
const SELF_POLL_MS = 3000;
const LIVE_POLL_MS = 5000;
const UPLOAD_ERROR_KEYS = {offline: 'upErrOffline', forbidden: 'upErrForbidden', notfound: 'upErrNotfound',
                           exists: 'upErrExists', refused: 'upErrRefused', toolarge: 'upErrToolarge',
                           full: 'upErrFull', http: 'upErrHttp', local: 'upErrLocal'};
const FETCH_TIMEOUT_MS = 15000;   // a plan server request that takes longer counts as not reachable
const MAX_RECHECKS = 3;           // answers that ask for another check at once, in a row
// What a pasted code may carry besides what normalizeCode ignores (server/api.mjs readCodes): any
// white space (tab, NBSP) and the Unicode dashes.
const CODE_JUNK_RE = /[\s\u2010-\u2015\u2212]/g;

let Common = null;
let clubsReady = false;          // the shared Clubs copy is merged (or Sauce didn't answer in time)
let selfId = null;
let liveWeight = null;            // my weight from Sauce (kg), for W/kg; the plan weight is the fallback
let shown = null;                 // {plan, warnings} currently on screen
// Files read so far, so the JSON and the text export can be dropped one after the other.
let pending = emptyPending();
let recToken = 0;
let listKey = null;               // identity of the recordings list on screen
let livePoll = null;
let shownLogUpload = null;        // the upload choice (and its tick time) the recordings list was last asked for
const uploadingIds = new Set();   // sessions with an Upload button press under way
// This window's settings check (spec §7.1): it never activates a plan, so what it found stays here.
let checkQueue = Promise.resolve();
let queuedPlain = null;           // a plain check that waits in the queue (ticks share it)
let openingDone = false;          // the check when the window opens has run
let checkError = null;            // {kind, at} of the last settings check that failed, or null
let nextPlan = null;              // {label, startAt}: what the joined clubs have waiting
let several = false;              // several clubs list the rider and none was joined
let shownServerOn = null;         // the server on/off the file box was last set for
let planServerOn = null;          // the server on/off the shown plan was last read for
let shownClubs = null;            // identity of the Clubs rows on screen
let adding = false;               // an "Add club by code" under way


// ---------- static copy ----------

function applyStrings() {
    document.title = S.title;
    for (const el of document.querySelectorAll('[data-s]')) {
        el.textContent = S[el.dataset.s];
    }
    for (const el of document.querySelectorAll('[data-s-title]')) {
        el.title = S[el.dataset.sTitle];
    }
    for (const el of document.querySelectorAll('[data-s-placeholder]')) {
        el.placeholder = S[el.dataset.sPlaceholder];
    }
    const head = $('#pl-riders-head');
    for (const k of ['thPos', 'thName', 'thColor', 'thPull', 'thWatts']) {
        const th = document.createElement('th');
        th.textContent = S[k];
        head.append(th);
    }
}


// ---------- plan ----------

function showMessage(text) {
    const el = $('#pl-msg');
    el.textContent = text || '';
    el.hidden = !text;
}


function warningText(w) {
    if (w.code === 'pull-mismatch') {
        return fmt('pullMismatch', {name: w.name});
    }
    if (w.code === 'watts-mismatch') {
        return fmt('wattsMismatch', {name: w.name});
    }
    if (w.code === 'unmatched-text-row') {
        return fmt('unmatched', {name: w.name});
    }
    return null;
}


function td(text, cls) {
    const c = document.createElement('td');
    c.textContent = text;
    if (cls) {
        c.className = cls;
    }
    return c;
}


function renderPlan() {
    const has = !!shown;
    $('#pl-result').hidden = !has;
    $('#pl-noplan').textContent = has ? '' : S.noPlan;
    if (!has) {
        return;
    }
    const {plan, warnings} = shown;
    $('#pl-team').textContent = fmt('team', {team: plan.team});
    $('#pl-code').textContent = plan.sig;
    $('#pl-code-note').textContent = fmt('planCode', {sig: plan.sig});
    const me = selfId === null ? {role: 'none'} : findMe(plan, selfId);
    renderYou();

    const notes = warnings.map(warningText).filter(Boolean);
    if (plan.riders.every(r => r.watts === null)) {
        notes.push(S.noWatts);
    }
    const ul = $('#pl-warnings');
    ul.replaceChildren(...notes.map(t => {
        const li = document.createElement('li');
        li.textContent = t;
        return li;
    }));

    const body = $('#pl-riders tbody');
    body.replaceChildren(...plan.riders.map((r, i) => {
        const tr = document.createElement('tr');
        if (me.role === 'rider' && me.rider === r) {
            tr.className = 'pl-me';
        }
        const sw = document.createElement('td');
        const chip = document.createElement('span');
        chip.className = 'pl-swatch';
        chip.style.background = r.color;
        const word = document.createElement('span');
        word.textContent = r.colorName;
        sw.append(chip, word);
        tr.append(td(i + 1, 'pl-num'), td(r.name, 'pl-name'), sw,
                  td(r.pullS, 'pl-num'), td(r.watts === null ? S.noWattsCell : r.watts, 'pl-num'));
        return tr;
    }));
}


// The you-line, with the target in the chosen unit (like the Info window).
function renderYou() {
    if (!shown) {
        return;
    }
    const {plan} = shown;
    const me = selfId === null ? {role: 'none'} : findMe(plan, selfId);
    const you = $('#pl-you');
    you.textContent = youText(plan, selfId, {weight: liveWeight, unit: readPrefs().targetUnit});
    you.classList.toggle('pl-you-in', me.role === 'rider');
}


function renderFromLibrary() {
    shown = activePlan();
    renderPlan();
    renderServer(readPrefs());
}


// Merge the new texts into the pending files and import. Nothing is written unless it works.
function importTexts(texts) {
    const merged = mergePending(pending, texts);
    if (merged.error) {
        showMessage(S[ERROR_KEYS[merged.error]]);
        return false;
    }
    const cand = merged.pending;
    let res;
    try {
        res = importFiles([cand.json, cand.text].filter(Boolean));
    } catch(e) {
        if (!(e instanceof PlanError)) {
            console.error('Paceline: import failed', e);
            showMessage(S.unreadable);
            return false;
        }
        if (e.code === 'no-json') {
            pending = cand;    // a text export alone: wait for the JSON
        }
        showMessage(S[ERROR_KEYS[e.code]] || S.unreadable);
        return e.code === 'no-json';
    }
    const {plan, warnings} = res;
    pending = markImported(cand);
    writeLibrary(addPlan(readLibrary(), fileEntry({sig: plan.sig, json: cand.json, text: cand.text, now: Date.now()})));
    const saved = activePlan();
    shown = {plan, warnings};
    renderPlan();
    renderServer(readPrefs());    // the file mark
    showMessage(saved && saved.plan.sig === plan.sig ? '' : S.saveFailed);
    return true;
}


async function importFileList(files) {
    const list = Array.from(files || []);
    if (!list.length) {
        return;
    }
    let texts;
    try {
        texts = await Promise.all(list.map(f => f.text()));
    } catch(e) {
        console.error('Paceline: reading file failed', e);
        showMessage(S.unreadable);
        return;
    }
    importTexts(texts);
}


function initImport() {
    const drop = $('#pl-plan');
    let depth = 0;
    const hasFiles = ev => ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes('Files');
    drop.addEventListener('dragenter', ev => {
        if (hasFiles(ev)) {
            depth++;
            drop.classList.add('dragging');
        }
    });
    drop.addEventListener('dragleave', () => {
        depth = Math.max(0, depth - 1);
        if (!depth) {
            drop.classList.remove('dragging');
        }
    });
    drop.addEventListener('drop', ev => {
        depth = 0;
        drop.classList.remove('dragging');
        if (hasFiles(ev)) {
            importFileList(ev.dataTransfer.files);
        }
    });
    // A file dropped beside the zone would make the browser navigate away from this page.
    for (const type of ['dragover', 'drop']) {
        document.addEventListener(type, ev => {
            if (hasFiles(ev)) {
                ev.preventDefault();
            }
        });
    }

    const input = $('#pl-file');
    input.addEventListener('change', async () => {
        await importFileList(input.files);
        input.value = '';    // allow picking the same file again
    });

    $('#pl-paste-go').addEventListener('click', () => {
        const box = $('#pl-paste-text');
        const t = box.value;
        if (!t.trim()) {
            return;
        }
        if (importTexts([t])) {
            box.value = '';
        }
    });
}


// ---------- preferences ----------

function renderPrefs(prefs) {
    for (const r of document.querySelectorAll('input[name="pl-unit"]')) {
        r.checked = r.value === prefs.targetUnit;
    }
    $('#pl-show-next').checked = prefs.showNext;
    // The rotation table during the ride is part of captain mode: only with it on.
    $('#pl-show-rotation').checked = prefs.showRotation;
    $('#pl-show-rotation').disabled = !prefs.showNext;
    $('#pl-ttt-only').checked = prefs.tttOnly;
    $('#pl-rec-no-plan').checked = prefs.recordWithoutPlan;
    $('#pl-rec-no-plan').disabled = !prefs.tttOnly;
    if (prefs.serverOn !== planServerOn) {
        // An ended file plan counts only with the plan server off (store.mjs activePlan).
        planServerOn = prefs.serverOn;
        shown = activePlan({serverOn: prefs.serverOn});
        renderPlan();
    }
    renderServer(prefs);
    renderClubs();
    openingCheck();
    renderDemo(prefs);
    renderYou();
    const upload = JSON.stringify([prefs.logUpload, prefs.logUploadSince, prefs.serverOn]);
    if (upload !== shownLogUpload) {
        shownLogUpload = upload;
        renderRecordings();    // status words and Upload buttons come and go with the choice
    }
}


function renderDemo(p) {
    const on = demoOn(p, Date.now());
    setText($('#pl-demo-btn'), on ? S.demoStop : S.demoStart);
    setText($('#pl-demo-status'), on ? fmt('demoRunning', {time: hhmm(p.demoUntil)}) : S.demoHelp);
}


function hhmm(ms) {
    return new Date(ms).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}


// "12 Nov", and "Thu 19 Nov 19:30" (local time), as the spec writes them.
function dayMonth(ms) {
    return new Date(ms).toLocaleDateString('en-GB', {day: 'numeric', month: 'short'});
}


function weekdayTime(ms) {
    return `${new Date(ms).toLocaleDateString('en-GB', {weekday: 'short', day: 'numeric', month: 'short'})} ${hhmm(ms)}`;
}


function errorText(kind, at) {
    const time = at === null ? '' : hhmm(at);
    switch (kind) {
    case 'offline': return fmt('serverErrOffline', {time});
    case 'notfound': return S.serverErrNotFound;
    case 'http': return fmt('serverErrHttp', {time});
    case 'invalid': return fmt('serverErrInvalid', {time});
    case 'badurl': return S.serverErrBadUrl;
    default: return '';
    }
}


// The status line (spec §7.6): the server plan as the polling overlay window left it in the
// preferences ("Rollers fast · RE5CFQ · Kettenfett RC · checked 19:02"), or "Plan opens …" while a
// body-less record waits and no server plan is active; the notice after it.
function statusText(p) {
    if (!p.serverOn) {
        return S.serverOff;
    }
    let text;
    if (activeEntry(readLibrary())?.source !== 'server' && Number.isFinite(p.serverOpensAt)) {
        text = fmt('opensLine', {time: hhmm(p.serverOpensAt), label: p.serverOpensLabel ?? ''});
    } else if (p.serverSig) {
        const at = p.serverCheckedAt ?? p.serverOkAt;
        text = fmt('serverStatus', {label: p.serverLabel ?? S.noWattsCell, sig: p.serverSig,
                                    club: p.serverClub ?? S.noWattsCell, time: at === null ? S.noWattsCell : hhmm(at)});
        if (p.serverFits !== null) {
            text = [text, fmt('serverFits', {n: p.serverFits})].join(S.joiner);
        }
    } else {
        text = p.serverError ? '' : S.serverWaiting;
    }
    return [text, p.serverNotice].filter(Boolean).join(S.joiner);
}


function renderServer(p) {
    $('#pl-server-on').checked = p.serverOn;
    $('#pl-log-upload').checked = p.logUpload;
    // Uploads go to the plan server: without it the overlay sends nothing, so an unticked box can't
    // be ticked. A ticked one stays clickable: unticking withdraws the consent at any time (review
    // I-1, 23 Nov 2026).
    $('#pl-log-upload').disabled = !p.serverOn && !p.logUpload;
    setText($('#pl-upload-why'), p.serverOn ? S.logUploadWhy : p.logUpload ? S.logUploadPaused : S.logUploadNeedsServer);
    // Never overwrite what the rider is typing.
    const urlEl = $('#pl-server-url');
    if (document.activeElement !== urlEl) {
        urlEl.value = p.serverUrl;
    }
    setText($('#pl-server-status'), statusText(p));
    // This window's own failed check, unless the overlay has checked since; else the overlay's last
    // in-event check.
    const own = checkError && !(p.serverCheckedAt > checkError.at);
    const errText = !p.serverOn ? '' : own ? errorText(checkError.kind, checkError.at) :
        errorText(p.serverError, p.serverCheckedAt);
    setText($('#pl-server-err'), errText);
    setText($('#pl-server-next'), p.serverOn && nextPlan ? fmt('serverNext', {
        label: String(nextPlan.label ?? ''), when: weekdayTime(Date.parse(nextPlan.startAt))}) : '');
    $('#pl-file-mark').hidden = !(p.serverOn && fileActive(readLibrary(), {now: Date.now(), serverOn: p.serverOn}));
    // With a server the files are the exception: collapsed. Without one the drop zone is open, as
    // before, and can't be closed. Only a change of on/off moves it, never a re-render.
    if (p.serverOn !== shownServerOn) {
        shownServerOn = p.serverOn;
        const box = $('#pl-file-box');
        box.open = !p.serverOn;
        box.classList.toggle('pl-files-only', !p.serverOn);
    }
}


function saveServer() {
    const changes = serverConfigChange(readPrefs(), {
        serverOn: $('#pl-server-on').checked,
        serverUrl: $('#pl-server-url').value,
    });
    if (changes) {
        // Another server (or on again) starts over, like a freshly opened window.
        openingDone = false;
        checkError = null;
        nextPlan = null;
        several = false;
    }
    renderPrefs(changes ? writePrefs(changes) : readPrefs());
    if (changes) {
        initSharedClubs(Common, clubsBase());    // the shared copy follows the new server
    }
}


// ---------- clubs and the settings check ----------

function clubsBase() {
    return serverBase(readPrefs().serverUrl);
}


// A club's code line under its name (private, or a code that no longer works or is needed).
function clubNote(r) {
    if (r.codeState === 'ok' && r.code !== null) {
        return fmt('clubPrivate', {code: formatCode(r.code)});
    } else if (r.codeState === 'bad') {
        return S.clubCodeBad;
    } else if (r.codeState === 'needed') {
        return S.clubCodeNeeded;
    }
    return '';
}


// The "Your teams" cell: the teams whose plan has you among its riders; "lists you" when only the
// bench has you, or from a server that doesn't name teams; else a dim dash.
function clubTeams(r) {
    if (r.teams?.length) {
        return r.teams.join(', ');
    }
    return r.lists ? S.clubListsYou : S.clubNoTeam;
}


function onTick(id, joined) {
    const base = clubsBase();
    writeClubs(setJoined(readClubs(base), id, joined, Date.now(), 'rider'));
    renderClubs();
    settingsCheck();
}


function renderClubs() {
    const p = readPrefs();
    $('#pl-clubs').hidden = !p.serverOn;
    const {clubs} = readClubs(serverBase(p.serverUrl));
    const ul = $('#pl-clubs-list');
    const key = JSON.stringify(clubs.map(r => [r.id, r.name, r.joined, r.joinedAt, clubNote(r), clubTeams(r)]));
    if (key !== shownClubs) {
        shownClubs = key;
        ul.replaceChildren(...clubs.map(r => {
            const tr = document.createElement('tr');
            tr.className = 'pl-club';
            const club = document.createElement('td');
            const label = document.createElement('label');
            label.className = 'pl-check';
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.checked = r.joined;
            box.addEventListener('change', () => onTick(r.id, box.checked));
            const name = document.createElement('span');
            name.className = 'pl-club-name';
            name.textContent = r.name;
            label.append(box, name);
            const note = document.createElement('div');
            note.className = 'pl-note pl-club-note';
            note.textContent = clubNote(r);
            club.append(label, note);
            const teams = document.createElement('td');
            teams.className = 'pl-club-teams';
            teams.textContent = clubTeams(r);
            teams.classList.toggle('pl-none', !r.teams?.length);
            const since = document.createElement('td');
            since.className = 'pl-club-since';
            since.textContent = r.joined && Number.isFinite(r.joinedAt) ? dayMonth(r.joinedAt) : '';
            tr.append(club, teams, since);
            return tr;
        }));
    }
    $('#pl-clubs-table').hidden = clubs.length === 0;
    const empty = $('#pl-clubs-empty');
    empty.hidden = clubs.length > 0;
    setText(empty, selfId === null ? S.clubsEmptyNoId : fmt('clubsEmpty', {id: selfId}));
    $('#pl-clubs-several').hidden = !(several && clubs.length > 0 && !clubs.some(r => r.joined));
}


// The codes a check carries: the table's (codesToSend) plus `extra`, at most MAX_CODES. When the
// table already fills them, the extra code takes the last place, which is an unticked club's
// whenever there is one.
function codesWith(codes, extra) {
    if (extra === null || codes.includes(extra)) {
        return codes;
    }
    return [...codes.slice(0, MAX_CODES - 1), extra];
}


// The settings check (spec §7.1): without start and event, and its answer never activates a plan.
// It fills the Clubs table (auto-join included) and shows what is waiting. Checks run one after
// the other; ticks made while one waits share it. Resolves to {answer, base} on a 200 answer, else
// {status} (429), {error} or {skipped}.
export function settingsCheck({extraCode = null} = {}) {
    return enqueue(extraCode, 0);
}


function enqueue(extraCode, depth) {
    if (extraCode === null && queuedPlain) {
        return queuedPlain;
    }
    const run = checkQueue.then(() => {
        if (extraCode === null) {
            queuedPlain = null;
        }
        return runCheck(extraCode, depth);
    });
    checkQueue = run.catch(e => console.error('Paceline: settings check failed', e));
    if (extraCode === null) {
        queuedPlain = run;
    }
    return run;
}


function setCheckError(kind) {
    checkError = kind ? {kind, at: Date.now()} : null;
    renderServer(readPrefs());
}


async function runCheck(extraCode, depth) {
    const p = readPrefs();
    if (!p.serverOn || selfId === null) {
        return {skipped: true};
    }
    const base = serverBase(p.serverUrl);
    if (!base) {
        setCheckError('badurl');
        return {error: 'badurl'};
    }
    const clubs = readClubs(base);
    const codes = codesWith(codesToSend(clubs), extraCode);
    // The active plan's code goes along as in the overlay (spec §7.1 "Sent"), so the club's "has the
    // plan" stays true for a rider who opens settings.
    const sig = activePlan()?.plan.sig ?? null;
    const url = checkUrl({url: p.serverUrl, selfId, mod: VERSION, joined: joinedIds(clubs), sig});
    if (!url) {
        return {skipped: true};
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    let res = null;
    let answer = null;
    let error = null;
    try {
        res = await fetch(url, {cache: 'no-store', headers: checkHeaders(codes), signal: ctl.signal});
        if (res.status === 200) {
            answer = await res.json();
        }
    } catch(e) {
        error = res && !ctl.signal.aborted ? 'invalid' : 'offline';
    } finally {
        clearTimeout(timer);
    }
    // The rider changed the server or switched it off meanwhile: the answer no longer counts.
    const cur = readPrefs();
    if (cur.serverUrl !== p.serverUrl || !cur.serverOn) {
        return {skipped: true};
    }
    if (!error && res.status === 429 && extraCode !== null) {
        return {status: 429};    // "Add club by code" says it
    }
    if (!error && res.status !== 200) {
        error = 'http';
    }
    if (!error && (!answer || typeof answer !== 'object' || Array.isArray(answer))) {
        error = 'invalid';
    }
    if (error) {
        setCheckError(error);
        return {error};
    }
    checkError = null;
    // Into a fresh read (spec §7.2 "Lost update"). When the ticks or codes changed while it ran,
    // what it says is waiting belongs to the old ticks: keep the clubs part and ask again.
    const fresh = readClubs(base);
    const lost = !sameJoined(fresh, clubs) || !sameCodes(fresh, clubs);
    const out = settingsCheckResult(fresh, answer, {now: Date.now(), sentCodes: codes});
    if (JSON.stringify(out.clubs) !== JSON.stringify(fresh)) {
        writeClubs(out.clubs);
    }
    several = out.several;
    if (!lost) {
        nextPlan = out.next;
    }
    renderServer(readPrefs());
    renderClubs();
    if ((lost || out.recheck) && depth < MAX_RECHECKS) {
        enqueue(null, depth + 1);
    }
    return {answer, base};
}


// Opening the window checks once, as soon as the Zwift ID is known and the server is on and usable.
function openingCheck() {
    const p = readPrefs();
    if (!clubsReady || openingDone || selfId === null || !p.serverOn || !serverBase(p.serverUrl)) {
        return;
    }
    openingDone = true;
    settingsCheck();
}


function codeMessage(text) {
    setText($('#pl-club-code-msg'), text);
}


// "Add club by code" (spec §7.2): a settings check carrying the code; the club is added (ticked)
// only when the answer echoes it. Nothing is stored for a code that didn't work.
async function addClubByCode() {
    const field = $('#pl-club-code');
    const code = normalizeCode(field.value.replace(CODE_JUNK_RE, ''));
    if (code === null) {
        codeMessage(S.clubCodeMalformed);
        return;
    }
    if (adding) {
        return;
    }
    adding = true;
    $('#pl-club-code-add').disabled = true;
    codeMessage('');
    try {
        const r = await settingsCheck({extraCode: code});
        if (r.status === 429) {
            codeMessage(S.clubCodeBusy);
        } else if (r.answer) {
            const {state, added} = addByCode(readClubs(r.base), r.answer, code, Date.now());
            if (added) {
                writeClubs(state);
                codeMessage(fmt('clubCodeAdded', {club: added.name}));
                field.value = '';
                renderClubs();
                settingsCheck();
            } else {
                codeMessage(S.clubCodeUnknown);
            }
        } else if (r.skipped && selfId === null) {
            codeMessage(S.noSelf);
        }
    } finally {
        adding = false;
        $('#pl-club-code-add').disabled = false;
    }
}


function initClubs() {
    $('#pl-club-code-add').addEventListener('click', addClubByCode);
    $('#pl-club-code').addEventListener('keydown', ev => {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            addClubByCode();
        }
    });
    $('#pl-file-remove').addEventListener('click', () => {
        writeLibrary(endFilePlan(readLibrary(), Date.now()));
        renderFromLibrary();
    });
    onClubsChange(renderClubs);
    renderClubs();
}


function initPrefs() {
    const fix = logUploadSinceFix(readPrefs(), Date.now());
    renderPrefs(fix ? writePrefs(fix) : readPrefs());
    for (const r of document.querySelectorAll('input[name="pl-unit"]')) {
        r.addEventListener('change', () => {
            if (r.checked) {
                renderPrefs(writePrefs({targetUnit: r.value, targetUnitSet: true}));
            }
        });
    }
    // Text fields save on Enter or when they lose focus.
    for (const sel of ['#pl-server-on', '#pl-server-url']) {
        $(sel).addEventListener('change', saveServer);
    }
    $('#pl-log-upload').addEventListener('change', () => {
        renderPrefs(writePrefs(logUploadChange($('#pl-log-upload').checked, Date.now())));
    });
    $('#pl-show-next').addEventListener('change', () => {
        renderPrefs(writePrefs({showNext: $('#pl-show-next').checked}));
    });
    $('#pl-show-rotation').addEventListener('change', () => {
        renderPrefs(writePrefs({showRotation: $('#pl-show-rotation').checked}));
    });
    $('#pl-ttt-only').addEventListener('change', () => {
        renderPrefs(writePrefs({tttOnly: $('#pl-ttt-only').checked}));
    });
    $('#pl-rec-no-plan').addEventListener('change', () => {
        renderPrefs(writePrefs({recordWithoutPlan: $('#pl-rec-no-plan').checked}));
    });
    $('#pl-demo-btn').addEventListener('click', () => {
        const now = Date.now();
        renderPrefs(writePrefs(demoChange(!demoOn(readPrefs(), now), now)));
    });
    setInterval(() => renderDemo(readPrefs()), 1000);    // the demo ends by itself
    onPrefsChange(renderPrefs);
}


// ---------- self ----------

async function refreshSelf() {
    const id = await selfAthleteId(Common);
    const w = id === null ? null : await selfWeight(Common);
    if (id !== selfId || (w !== null && w !== liveWeight)) {
        selfId = id;
        liveWeight = w ?? liveWeight;
        renderPlan();
        renderClubs();
        openingCheck();
    }
    return id;
}


function initSelf() {
    if (!Common) {
        // Plain-browser preview only: ?athlete=<Zwift ID> stands in for Zwift (like ?demo).
        const id = new URLSearchParams(location.search).get('athlete');
        selfId = id !== null && /^\d{1,12}$/.test(id) ? id : null;
        renderPlan();
        renderClubs();
        openingCheck();
        return;
    }
    refreshSelf();
    // Zwift may not be connected yet when this window opens: keep asking until we know who we are.
    const timer = setInterval(async () => {
        if (await refreshSelf() !== null) {
            clearInterval(timer);
        }
    }, SELF_POLL_MS);
}


// ---------- recordings ----------

export function formatDuration(totalS) {
    const s = Math.max(0, Math.round(totalS));
    const p = n => String(n).padStart(2, '0');
    const h = Math.floor(s / 3600);
    const m = Math.floor(s % 3600 / 60);
    return h ? `${h}:${p(m)}:${p(s % 60)}` : `${m}:${p(s % 60)}`;
}


function startedAtOf(s) {
    const t = s.meta && s.meta.startedAt;
    if (Number.isFinite(t)) {
        return t;
    }
    const n = Number(s.sessionId);
    return Number.isFinite(n) ? n : Date.now();
}


function recError(text) {
    const el = $('#pl-rec-err');
    el.textContent = text || '';
    el.hidden = !text;
}


function button(label, act, id, disabled) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.dataset.act = act;
    b.dataset.id = id;
    b.disabled = !!disabled;
    return b;
}


function setText(el, text) {
    if (el.textContent !== text) {
        el.textContent = text;
    }
}


function uploadErrorText(kind) {
    return S[UPLOAD_ERROR_KEYS[kind]] || S.upErrHttp;
}


const isUploaded = s => Number.isFinite(s.meta && s.meta.uploadedAt);


// "uploaded", or "waiting for upload" (the overlay sends it) or "not sent automatically" (only
// the Upload button does), plus the last attempt's error.
function uploadStatusText(s) {
    const p = readPrefs();
    const state = autoUploadState(s, {now: Date.now(), since: p.logUploadSince, serverOn: p.serverOn});
    if (state === 'uploaded') {
        return S.recUploaded;
    }
    const word = state === 'manual' ? S.recNotAuto : S.recWaiting;
    const err = s.meta && s.meta.uploadError;
    return err ? [word, uploadErrorText(err)].join(S.joiner) : word;
}


// Fills (or refreshes) the texts of one recording row; never touches the buttons.
function updateRow(li, s) {
    if (!li) {
        return;
    }
    li.sessionRow = s;
    setText(li.querySelector('.pl-recwhen'), new Date(startedAtOf(s)).toLocaleString());
    const sig = s.meta && s.meta.planSig;
    setText(li.querySelector('.pl-recsub'),
            [formatDuration(s.ticks), sig ? fmt('recRow', {sig}) : S.recUnknownPlan].join(S.joiner));
    const up = li.querySelector('.pl-recup');
    if (up) {
        setText(up, uploadStatusText(s));
    }
}


// The recordings list's key (recListKey) of the state the list was last rendered for (W7).
let renderedRecKey = null;


// The key of the recording state now: the state, and the live session (its lease).
function recKeyNow() {
    let state = null;
    try {
        state = JSON.parse(localStorage.getItem(REC_STATE_KEY));
    } catch(e) {
        // No readable state: as no recording.
    }
    return recListKey(state, liveSessionId());
}


async function renderRecordings() {
    const token = ++recToken;
    let sessions;
    try {
        sessions = await listSessions();
    } catch(e) {
        console.error('Paceline: listing recordings failed', e);
        if (token === recToken) {
            recError(S.recLoadFailed);
        }
        return;
    }
    if (token !== recToken) {
        return;    // a newer render is under way
    }
    recError('');
    renderedRecKey = recKeyNow();
    const live = liveSessionId();
    const upload = readPrefs().logUpload;
    const ul = $('#pl-rec-list');
    // Rebuild only when the set of sessions or the live session changed. Otherwise update the
    // texts in place, so the buttons are not replaced under the cursor (a click on a freshly
    // replaced button, or the first click that merely focuses the window, would be lost).
    // The upload choice and each row's uploaded flag decide which status line and buttons a row has.
    const key = JSON.stringify([sessions.map(s => String(s.sessionId)), live === null ? null : String(live), upload,
                                upload ? sessions.map(isUploaded) : null]);
    if (key === listKey) {
        sessions.forEach((s, i) => updateRow(ul.children[i], s));
    } else {
        listKey = key;
        if (!sessions.length) {
            const li = document.createElement('li');
            li.className = 'pl-note';
            li.textContent = S.recEmpty;
            ul.replaceChildren(li);
        } else {
            ul.replaceChildren(...sessions.map(s => {
                const isLive = live !== null && String(live) === String(s.sessionId);
                const li = document.createElement('li');
                li.className = 'pl-recrow';
                const info = document.createElement('div');
                info.className = 'pl-recinfo';
                const when = document.createElement('div');
                when.className = 'pl-recwhen';
                const sub = document.createElement('div');
                sub.className = 'pl-recsub';
                info.append(when, sub);
                if (upload && !isLive) {
                    const up = document.createElement('div');
                    up.className = 'pl-recsub pl-recup';
                    info.append(up);
                }
                if (isLive) {
                    const mark = document.createElement('div');
                    mark.className = 'pl-reclive';
                    mark.textContent = S.recLive;
                    info.append(mark);
                }
                const actions = document.createElement('div');
                actions.className = 'pl-recactions';
                if (upload && !isLive && !isUploaded(s)) {
                    actions.append(button(S.recUpload, 'upload', s.sessionId, uploadingIds.has(String(s.sessionId))));
                }
                actions.append(button(S.recExport, 'export', s.sessionId, false),
                               button(S.recDelete, 'delete', s.sessionId, isLive));
                li.append(info, actions);
                updateRow(li, s);
                return li;
            }));
        }
    }
    // While a recording runs its tick count grows and the lease can lapse: keep the list fresh.
    if (live !== null && !livePoll) {
        livePoll = setInterval(renderRecordings, LIVE_POLL_MS);
    } else if (live === null && livePoll) {
        clearInterval(livePoll);
        livePoll = null;
    }
}


function download(name, text) {
    const blob = new Blob([text], {type: 'application/x-ndjson'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}


async function onRecordingAction(ev) {
    const btn = ev.target.closest('button[data-act]');
    if (!btn || btn.disabled) {
        return;
    }
    const row = btn.closest('li').sessionRow;
    if (!row) {
        return;
    }
    recError('');
    try {
        if (btn.dataset.act === 'export') {
            const text = await exportSession(row.sessionId);
            download(recordingFileName({
                team: row.meta.team,
                selfName: row.meta.selfName,
                startedAt: startedAtOf(row),
            }), text);
        } else if (btn.dataset.act === 'delete') {
            if (liveSessionId() !== null && String(liveSessionId()) === String(row.sessionId)) {
                return renderRecordings();
            }
            if (!confirm(S.recConfirmDelete)) {
                return;
            }
            await deleteSession(row.sessionId);
            await renderRecordings();
        } else if (btn.dataset.act === 'upload') {
            await uploadRow(btn, row);
        }
    } catch(e) {
        console.error('Paceline: recording action failed', e);
        recError(btn.dataset.act === 'export' ? S.recExportFailed :
            btn.dataset.act === 'upload' ? fmt('recUploadFailed', {error: S.upErrLocal}) : S.recDeleteFailed);
    }
}


// The Upload button: sends this recording now, whatever the overlay's sweep is doing.
async function uploadRow(btn, row) {
    const id = String(row.sessionId);
    if (uploadingIds.has(id) || (liveSessionId() !== null && String(liveSessionId()) === id)) {
        return;
    }
    const p = readPrefs();
    // no club to send it to: slug and circle stay undefined, and uploadSession answers 'badurl'
    const target = sessionTarget(row.meta);
    const opts = {url: p.serverUrl, slug: target?.slug, circle: target?.circle,
                  athleteId: row.meta.selfId ?? selfId, now: Date.now()};
    uploadingIds.add(id);
    btn.disabled = true;
    let res;
    try {
        res = await uploadSession(row.sessionId, opts);
    } finally {
        uploadingIds.delete(id);
        btn.disabled = false;
    }
    await renderRecordings();    // clears the error line, so the outcome goes in after it
    if (!res.ok) {
        if (res.cause) {
            console.error('Paceline: preparing the upload failed', res.cause);
        }
        recError(res.error === 'badurl' ? S.recUploadNoTarget :
            fmt('recUploadFailed', {error: uploadErrorText(res.error)}));
    }
}


// ---------- boot ----------

export async function settingsMain() {
    applyStrings();
    // Opened from the Action or Rest window (?for=action|rest): its own part has no captain option
    // (that one only changes the Info window); the countdown switch is the Action window's. Without
    // ?for (plain-browser preview) it is the Info part.
    const forWin = new URLSearchParams(location.search).get('for');
    const forAction = forWin === 'action', forRest = forWin === 'rest';
    document.documentElement.classList.toggle('pl-for-action', forAction);
    document.documentElement.classList.toggle('pl-for-rest', forRest);
    setText($('#pl-this-head'), forAction ? S.thisWindowAction : forRest ? S.thisWindowRest : S.thisWindowInfo);
    Common = await loadCommon();
    initFlush(Common);
    if (Common) {
        Common.initInteractionListeners();
        // The Action window's options have their defaults in the HTML (midSmall checked, the slots
        // off / power / off): the form keeps them while a key is unset. Only an earlier power choice
        // (Power now, Power W, Power W/kg; one Power field since 0.3.6) is stored as 'power' first,
        // so its select shows it (the Action window reads both, display.mjs fieldKind).
        for (const k of ['recLeft', 'recMid', 'recRight']) {
            const v = Common.settingsStore?.get(k);
            if (v !== 'power' && fieldKind(v) === 'power') {
                Common.settingsStore.set(k, 'power');
            }
        }
        await Common.initSettingsForm('#pl-appearance-form')();
    }
    $('#pl-done').addEventListener('click', () => window.close());
    initImport();
    initClubs();
    // The table shared by all window profiles first: no opening check before it is merged.
    initSharedClubs(Common, serverBase(readPrefs().serverUrl)).then(() => {
        clubsReady = true;
        openingCheck();
    });
    initPrefs();
    $('#pl-rec-list').addEventListener('click', onRecordingAction);

    renderFromLibrary();
    onLibraryChange(renderFromLibrary);
    initSelf();

    renderRecordings();
    addEventListener('storage', ev => {
        // Each heartbeat rewrites these keys (lastSeenAt): re-read the recordings only when what the
        // list shows changed (audit fixes, 20 Nov 2026, W7: probe s4-settings). Focus always re-reads.
        // An upload's result (another window's markUpload, REC_MARK_KEY) always: it is in IndexedDB
        // only (final review, 21 Nov 2026, I-2: the row stayed "waiting for upload" until focus).
        if (ev.key === REC_MARK_KEY ||
            ((ev.key === REC_STATE_KEY || ev.key === LEASE_KEY) && recKeyNow() !== renderedRecKey)) {
            renderRecordings();
        }
    });
    addEventListener('focus', renderRecordings);
}
