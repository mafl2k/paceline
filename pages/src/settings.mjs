// Settings window: import the planner files, choose the pull target unit and the plan server,
// show who you are in the plan, list recordings.
// Plain DOM; rider names come from files, so they only ever go in through textContent.
import {importFiles, findMe, PlanError} from './engine/plan.mjs';
import {addPlan} from './engine/library.mjs';
import {emptyPending, mergePending, markImported} from './engine/pending.mjs';
import {recordingFileName} from './engine/recording.mjs';
import {serverConfigChange, logUploadChange, logUploadSinceFix, demoChange, demoOn} from './engine/prefs.mjs';
import {sessionSlug, autoUploadState} from './engine/logupload.mjs';
import {readLibrary, writeLibrary, activePlan, initFlush, onLibraryChange, readPrefs, writePrefs,
        onPrefsChange, liveSessionId, REC_STATE_KEY, LEASE_KEY} from './store.mjs';
import {listSessions, exportSession, deleteSession} from './recdb.mjs';
import {uploadSession} from './logupload.mjs';
import {loadCommon, selfAthleteId, selfWeight} from './sauce.mjs';
import {S, fmt} from './strings.mjs';
import {youText} from './youline.mjs';

const $ = sel => document.querySelector(sel);
const ERROR_KEYS = {'no-json': 'noJson', 'not-a-plan': 'notAPlan', 'unreadable': 'unreadable'};
const SELF_POLL_MS = 3000;
const LIVE_POLL_MS = 5000;
const UPLOAD_ERROR_KEYS = {offline: 'upErrOffline', notfound: 'upErrNotfound', toolarge: 'upErrToolarge',
                           full: 'upErrFull', http: 'upErrHttp', local: 'upErrLocal'};

let Common = null;
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
    writeLibrary(addPlan(readLibrary(), {sig: plan.sig, json: cand.json, text: cand.text, loadedAt: Date.now()}));
    const saved = activePlan();
    shown = {plan, warnings};
    renderPlan();
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
    $('#pl-rest-in-action').checked = prefs.restInAction;
    $('#pl-ttt-only').checked = prefs.tttOnly;
    $('#pl-rec-no-plan').checked = prefs.recordWithoutPlan;
    $('#pl-rec-no-plan').disabled = !prefs.tttOnly;
    renderServer(prefs);
    renderDemo(prefs);
    renderYou();
    const upload = JSON.stringify([prefs.logUpload, prefs.logUploadSince]);
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


// The plan server's status as the polling overlay window left it in the preferences.
function serverErrorText(p) {
    const time = p.serverCheckedAt === null ? '' : hhmm(p.serverCheckedAt);
    switch (p.serverError) {
    case 'offline': return fmt('serverErrOffline', {time});
    case 'notfound': return p.serverTeam ? fmt('serverErrNotFoundTeam', {time, team: p.serverTeam}) :
        fmt('serverErrNotFoundMe', {time});
    case 'http': return fmt('serverErrHttp', {time});
    case 'invalid': return fmt('serverErrInvalid', {time});
    case 'badurl': return S.serverErrBadUrl;
    default: return '';
    }
}


function renderServer(p) {
    $('#pl-server-on').checked = p.serverOn;
    $('#pl-log-upload').checked = p.logUpload;
    // Never overwrite what the rider is typing.
    for (const [sel, value] of [['#pl-server-team', p.serverTeam], ['#pl-server-url', p.serverUrl]]) {
        const el = $(sel);
        if (document.activeElement !== el) {
            el.value = value;
        }
    }
    let status = S.serverOff;
    if (p.serverOn) {
        status = p.serverSig ?
            fmt('serverStatus', {team: p.serverTeamName || S.serverNoTeam, sig: p.serverSig, time: hhmm(p.serverOkAt ?? Date.now())}) :
            p.serverError ? '' : S.serverWaiting;
    }
    const st = $('#pl-server-status');
    st.textContent = status;
    st.hidden = !status;
    const err = $('#pl-server-err');
    const errText = p.serverOn ? serverErrorText(p) : '';
    err.textContent = errText;
    err.hidden = !errText;
}


function saveServer() {
    const changes = serverConfigChange(readPrefs(), {
        serverOn: $('#pl-server-on').checked,
        serverUrl: $('#pl-server-url').value,
        serverTeam: $('#pl-server-team').value,
    });
    renderPrefs(changes ? writePrefs(changes) : readPrefs());
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
    for (const sel of ['#pl-server-on', '#pl-server-team', '#pl-server-url']) {
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
    $('#pl-rest-in-action').addEventListener('change', () => {
        renderPrefs(writePrefs({restInAction: $('#pl-rest-in-action').checked}));
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
    }
    return id;
}


function initSelf() {
    if (!Common) {
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
    const opts = {url: p.serverUrl, slug: sessionSlug(row.meta, p, shown ? shown.plan : null),
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
        await Common.initSettingsForm('#pl-appearance-form')();
    }
    $('#pl-done').addEventListener('click', () => window.close());
    initImport();
    initPrefs();
    $('#pl-rec-list').addEventListener('click', onRecordingAction);

    renderFromLibrary();
    onLibraryChange(renderFromLibrary);
    initSelf();

    renderRecordings();
    addEventListener('storage', ev => {
        if (ev.key === REC_STATE_KEY || ev.key === LEASE_KEY) {
            renderRecordings();
        }
    });
    addEventListener('focus', renderRecordings);
}
