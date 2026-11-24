// Composes the picture sheets of the README (docs/images/sheet-<name>.png) from single
// screenshots. Usage: node scripts/sheets.mjs [--port 19701] [name ...]
// Needs a headless Chrome with remote debugging on that port, e.g.
//   chrome --headless=new --remote-debugging-port=19701 --user-data-dir=<scratch dir>
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGES = path.join(ROOT, 'docs', 'images');
const CAPTAIN_WIDTH = 230; // the 390 px phone render, scaled

export const SHEETS = {
    defaults: {width: 720, rows: [[
        {src: 'action-rest.png', title: 'Recovery', caption: ['#2: you pull next']},
        {src: 'action-pull.png', title: 'Your pull', caption: ['target · your power · seconds left', 'bar: green is within 5 % of your target']},
    ]]},
    before: {width: 1000, rows: [[
        {src: 'action-armed.png', title: 'READY', caption: ['last 10 s: come up to your target', 'before the handover']},
        {src: 'rest.png', title: 'Rest window', caption: ['the countdown alone,', 'the Action window then shows your fields']},
        {src: 'action-fields-clock.png', title: 'Recovery with fields', caption: ['right: countdown and your place', '▲ GAP: you lost the wheel, close it']},
    ]]},
    gaps: {width: 1060, rows: [[
        {src: 'action-gap-early.png', title: 'Pull · gap opening', caption: ['▼ 14 m: a gap opens behind you,', 'ease off a little']},
        {src: 'action-gap.png', title: 'Pull · group lost your wheel', caption: ['always red: you are alone in front,', 'ease off until the band is gone']},
        {src: 'action-gap-red.png', title: 'Pull · 4th rider drops', caption: ['red: 3 left, ease off']},
    ], [
        {src: 'action-gap-amber.png', title: 'Pull · one rider drops', caption: ['amber: 5 left, drop acceptable']},
        {src: 'action-gap-green.png', title: 'Pull · gap closing', caption: ['green: they are closing it themselves,', 'not urgent']},
        {src: 'rest-gap.png', title: 'Recovery · you lost the wheel', caption: ['▲ GAP: your own gap, close it']},
    ]]},
    info: {width: 800, rows: [[
        {src: 'info.png', title: 'Info', caption: ['Wheel: whose wheel you follow by the plan', 'Front: who pulls, seconds left']},
        {src: 'info-captain.png', title: 'Info, captain mode', caption: ['amber →: your wheel is gone, follow Dana', 'below the dashed line: dropped riders']},
    ]]},
    signals: {width: 720, rows: [[
        {src: 'signal-wheel.png', title: 'Wheel cue', caption: ['amber: your plan wheel dropped,', 'find this wheel instead']},
        {src: 'signal-correction.png', title: 'Correction', caption: ['ELI, FINN out \u221245s:', 'your pull comes sooner']},
    ], [
        {src: 'signal-standing.png', title: 'Waiting for the change', caption: ['\u226512s: your pull is at least 12 s away,', '+19: the puller is 19 s over his plan']},
        {src: 'signal-climb.png', title: 'Real climb', caption: ['\u25b2: the order broke on the climb,', 'rotation paused until it is back']},
    ]]},
    captain: {width: 840, rows: [[
        {src: 'captain-teams-390-light.png', crop: 844, title: 'Your club', caption: ['next race and your teams', 'at a glance']},
        {src: 'captain-team-390-light.png', crop: 844, title: 'Plans and races', caption: ['LIVE: riders get this plan']},
        {src: 'captain-cockpit-version-390-light.png', crop: 844, title: 'Make live', caption: ['against the live version:', 'who is new, who is out']},
    ]]},
};

const CSS = `html,body{margin:0}
body{background:radial-gradient(120% 140% at 30% 0%,#2b3038 0%,#16181c 70%);font-family:-apple-system,"Helvetica Neue",Arial,sans-serif;color:#e8e8e8}
.row{display:flex;gap:40px;justify-content:center;align-items:flex-start;padding:28px 30px 0}
.row:last-child{padding-bottom:22px}
figure{margin:0;display:flex;flex-direction:column;align-items:center;max-width:340px}
.shot{border-radius:8px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.06)}
.shot img{display:block}
figcaption{margin-top:12px;text-align:center}
figcaption b{display:block;font-size:15px;font-weight:600;letter-spacing:.02em}
figcaption span{display:block;margin-top:3px;font-size:12px;color:#9aa1ab}`;

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const pngSize = f => { const b = fs.readFileSync(path.join(IMAGES, f)); return [b.readUInt32BE(16) / 2, b.readUInt32BE(20) / 2]; };

function tileHtml({src, title, caption, crop}) {
    const [w, h] = pngSize(src);
    let box;
    if (crop) {
        const k = CAPTAIN_WIDTH / w;
        box = `width:${CAPTAIN_WIDTH}px;height:${Math.round(Math.min(crop, h) * k)}px`;
        var img = `<img src="${pathToFileURL(path.join(IMAGES, src)).href}" width="${CAPTAIN_WIDTH}" height="${Math.round(h * k)}">`;
    } else {
        box = `width:${w}px;height:${h}px`;
        img = `<img src="${pathToFileURL(path.join(IMAGES, src)).href}" width="${w}" height="${h}">`;
    }
    return `<figure><div class="shot" style="${box}">${img}</div><figcaption><b>${esc(title)}</b>` +
        `<span>${caption.map(esc).join('<br>')}</span></figcaption></figure>`;
}

export function sheetHtml(name) {
    const {width, rows} = SHEETS[name];
    return `<!doctype html><meta charset="utf-8"><style>${CSS} body{width:${width}px}</style>` +
        rows.map(r => '<div class="row">' + r.map(tileHtml).join('') + '</div>').join('');
}

// Minimal CDP client over Node 22's global WebSocket (flattened sessions).
async function connect(port) {
    const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const ws = new WebSocket(v.webSocketDebuggerUrl);
    await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko; });
    let id = 0;
    const pending = new Map();
    ws.onmessage = ev => {
        const m = JSON.parse(ev.data);
        if (m.id && pending.has(m.id)) {
            const {ok, ko} = pending.get(m.id);
            pending.delete(m.id);
            m.error ? ko(new Error(JSON.stringify(m.error))) : ok(m.result);
        }
    };
    const send = (method, params = {}, sessionId) => new Promise((ok, ko) => {
        const i = ++id;
        pending.set(i, {ok, ko});
        ws.send(JSON.stringify({id: i, method, params, ...(sessionId ? {sessionId} : {})}));
    });
    return {send, close: () => ws.close()};
}

async function render(c, name, out) {
    const {width} = SHEETS[name];
    const file = path.join(os.tmpdir(), `paceline-sheet-${process.pid}-${name}.html`);
    fs.writeFileSync(file, sheetHtml(name));
    const {targetId} = await c.send('Target.createTarget', {url: 'about:blank', width, height: 400, newWindow: true});
    const {sessionId} = await c.send('Target.attachToTarget', {targetId, flatten: true});
    const metrics = height => c.send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 2, mobile: false}, sessionId);
    const evaluate = async expression => (await c.send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}, sessionId)).result.value;
    try {
        await c.send('Page.enable', {}, sessionId);
        await metrics(400);
        await c.send('Page.navigate', {url: pathToFileURL(file).href}, sessionId);
        for (let i = 0; i < 100; i++) { // wait for the images
            if (await evaluate('document.readyState === "complete" && [...document.images].every(i => i.complete && i.naturalWidth)')) { break; }
            await new Promise(r => setTimeout(r, 100));
        }
        const height = await evaluate('Math.ceil(document.body.getBoundingClientRect().height)');
        await metrics(height);
        await new Promise(r => setTimeout(r, 200));
        const shot = await c.send('Page.captureScreenshot', {format: 'png'}, sessionId);
        fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
        console.log(`${path.relative(ROOT, out)}  ${width} x ${height}`);
    } finally {
        await c.send('Target.closeTarget', {targetId});
        fs.rmSync(file, {force: true});
    }
}

async function main(argv) {
    let port = 19701;
    const names = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--port') { port = Number(argv[++i]); } else { names.push(argv[i]); }
    }
    for (const n of names) { if (!SHEETS[n]) { throw new Error(`unknown sheet ${n}`); } }
    const c = await connect(port);
    try {
        for (const n of names.length ? names : Object.keys(SHEETS)) {
            await render(c, n, path.join(IMAGES, `sheet-${n}.png`));
        }
    } finally {
        c.close();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
}
