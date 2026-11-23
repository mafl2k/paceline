// Run with: node --test tests/plan.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as P from '../pages/src/engine/plan.mjs';

const json = readFileSync(new URL('./fixtures/rollers.json', import.meta.url), 'utf8');
const txt = readFileSync(new URL('./fixtures/rollers.txt', import.meta.url), 'utf8');


test('detectFileKind', () => {
    assert.equal(P.detectFileKind(json), 'json');
    assert.equal(P.detectFileKind(txt), 'text');
    assert.equal(P.detectFileKind('hello'), 'unknown');
});

test('parseTextExport reads the planner text export', () => {
    const rows = P.parseTextExport(txt);
    assert.equal(rows.length, 6);
    assert.deepEqual(rows[3], {name: 'Dario Brandl [KFR]', pullWatts: 266, pullS: 60, colorName: 'Black', colorHex: '#000000'});
});

test('parseTextExport handles comma, pipe and no header', () => {
    const comma = 'Edda Voss,319,15,Red,#CC0000\n';
    assert.equal(P.parseTextExport(comma)[0].pullWatts, 319);
    assert.equal(P.parseTextExport('RiderName|PullWatts|PullDurationSeconds|KitColorName|KitColorHex\nA|1|2|Red|#CC0000')[0].colorHex, '#CC0000');
});

test('normalizePlan merges JSON and text export', () => {
    const {plan, warnings} = P.normalizePlan(JSON.parse(json), P.parseTextExport(txt));
    assert.deepEqual(warnings, []);
    assert.equal(plan.team, 'Rollers');
    assert.equal(plan.targetSpeed, 42.6);
    assert.deepEqual(plan.riders.map(r => r.id), ['5100005', '5100004', '5100003', '5100002', '5100001', '51006']);
    assert.deepEqual(plan.riders.map(r => r.watts), [286, 338, 238, 266, 319, 309]);
    assert.equal(plan.riders[0].color, '#ffffff');
    assert.equal(plan.riders[5].colorName, 'Lime');
    assert.equal(plan.riders[2].name, `Kim S ${String.fromCodePoint(9733)} [KFR]`);
    assert.deepEqual(plan.bench, [{id: '510007', name: 'Greta Wendt-Pohl (Kettenfett RC)'}]);
});

test('without text export: no watts, colour words from the table', () => {
    const {plan} = P.normalizePlan(JSON.parse(json), null);
    assert.ok(plan.riders.every(r => r.watts === null));
    assert.deepEqual(plan.riders.map(r => r.colorName), ['White', 'Blue', 'Yellow', 'Black', 'Red', 'Green']);
});

test('pull duration mismatch and unknown names warn', () => {
    const rows = P.parseTextExport(txt);
    rows[1].pullS = 90;
    rows.push({name: 'Nobody', pullWatts: 1, pullS: 1, colorName: 'Red', colorHex: '#CC0000'});
    const {plan, warnings} = P.normalizePlan(JSON.parse(json), rows);
    assert.deepEqual(warnings.map(w => w.code).sort(), ['pull-mismatch', 'unmatched-text-row']);
    assert.equal(plan.riders[1].pullS, 60);   // JSON wins
});

test('importFiles needs the JSON', () => {
    assert.throws(() => P.importFiles([txt]), e => e.code === 'no-json');
    assert.throws(() => P.importFiles(['{"x":1}']), e => e.code === 'not-a-plan');
    assert.throws(() => P.importFiles([json, 'hello']), e => e.code === 'unreadable');
    assert.equal(P.importFiles([txt, json]).plan.riders[3].watts, 266);  // order of files irrelevant
});

test('planSig is stable, short and sensitive to watts', () => {
    const a = P.importFiles([json, txt]).plan.sig;
    assert.match(a, /^[0-9A-HJKMNP-TV-Z]{6}$/);
    const shuffled = JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(json)).reverse()));
    assert.equal(P.importFiles([shuffled, txt]).plan.sig, a);
    assert.notEqual(P.importFiles([json]).plan.sig, a);
    assert.notEqual(P.importFiles([json, txt.replace('\t266\t', '\t267\t')]).plan.sig, a);
});

test('findMe', () => {
    const {plan} = P.importFiles([json, txt]);
    assert.deepEqual(P.findMe(plan, 5100002).position, 4);
    assert.equal(P.findMe(plan, '5100002').rider.name, 'Dario Brandl [KFR]');
    assert.equal(P.findMe(plan, '510007').role, 'bench');
    assert.equal(P.findMe(plan, 1).role, 'none');
    assert.equal(P.findMe(plan, null).role, 'none');
});

test('stripSheet keeps what the mod reads and nothing else', () => {
    const r = P.importFiles([json, txt]);
    const s = P.stripSheet(r.json, r.text);
    assert.doesNotMatch(JSON.stringify(s), /"(height|ftp|wkg300|power_profile|adjustment|cat|training_level|zr|sIndex|alt_name|intensity|efficiency)"/);
    assert.deepEqual(Object.keys(s.json.riders['5100002']).sort(), ['color', 'name', 'order', 'pull_duration', 'weight']);
    assert.deepEqual(s.json.roster['510007'], {name: r.json.roster['510007'].name});
    const view = p => p.riders.map(x => [x.id, x.name, x.order, x.pullS, x.watts, x.color, x.colorName]);
    const b = P.normalizePlan(s.json, s.text).plan;
    assert.equal(b.sig, '5FWHC3');
    assert.deepEqual(view(b), view(r.plan));
    assert.ok(b.riders.every(x => x.ftp === 0));
    assert.deepEqual(b.riders.map(x => x.weight), r.plan.riders.map(x => x.weight));
    assert.equal(b.riders.find(x => x.id === '5100002').weight, 64.2);
    assert.deepEqual(r.json, JSON.parse(json));   // input untouched
    const extra = P.parseTextExport(txt + '\nNobody Here\t300\t60\tRed\t#CC0000\n');
    assert.equal(extra.length, 7);
    assert.equal(P.stripSheet(r.json, extra).text.length, 6);
    assert.equal(P.stripSheet(r.json, null).text, null);
    assert.equal(P.stripSheet(r.json, [{name: 'Nobody Here', pullWatts: 1, pullS: 1, colorName: 'Red', colorHex: '#CC0000'}]).text, null);
    // The planner's per-rider pull watts and its W/kg version both stay.
    const withPull = JSON.parse(json);
    Object.assign(withPull.riders['5100002'], {pull_power: 340, pull_wkg: 5.3});
    const t = P.stripSheet(withPull, r.text);
    assert.equal(t.json.riders['5100002'].pull_power, 340);
    assert.equal(t.json.riders['5100002'].pull_wkg, 5.3);
});

test('stripSheet keeps a planner export as it is', () => {
    const r = P.importFiles([json, txt]);
    const s = P.stripSheet(r.json, r.text);
    assert.equal(s.json.target_speed, r.json.target_speed);   // the planner's "42.6", a string
    assert.equal(s.json.minimum_finishers, r.json.minimum_finishers);
    assert.deepEqual(s.json.team, {name: r.json.team.name});
    for (const [id, x] of Object.entries(r.json.riders)) {
        assert.deepEqual(s.json.riders[id], {name: x.name, order: x.order, pull_duration: x.pull_duration, color: x.color, weight: x.weight});
    }
    for (const [id, x] of Object.entries(r.json.roster)) {
        assert.deepEqual(s.json.roster[id], {name: x.name});
    }
    const byName = rows => [...rows].sort((a, b) => (a.name < b.name ? -1 : 1));
    assert.deepEqual(byName(s.text), byName(r.text));
});

test('stripSheet drops values of the wrong type or shape', () => {
    const big = Array.from({length: 1000}, () => ({}));
    const j = {
        team: {name: {x: big}},
        target_speed: big,
        minimum_finishers: {n: big},
        riders: {
            '1001': {name: 'Ben', order: 1, pull_duration: 60, color: '#ff0000', weight: 70, pull_power: 300, pull_wkg: 4.3},
            '1002': {name: big, order: big, pull_duration: {n: 1}, color: ['#ff0000'], weight: big, pull_power: {n: 1}, pull_wkg: {n: 1}},
            '1003': {name: 'Cleo', order: '2', pull_duration: '30', color: 'red', weight: '72.5', pull_power: '280', pull_wkg: '3.9'},
            '1004': {name: 'Dan', order: '1'.repeat(33), pull_duration: Infinity, color: {hex: '#ff0000'}, weight: '1'.repeat(33), pull_power: Infinity, pull_wkg: '5'.repeat(33)},
            '1005': [big],
            '1006': null,
        },
        roster: {'1007': {name: big}, '1008': {name: 'Eva'}, '1009': 'Finn'},
    };
    const rows = [
        null, 'Ben', [big], {name: big, pullWatts: 1, pullS: 1},
        {name: 'Ben', pullWatts: 300, pullS: 60, colorName: 'Red', colorHex: '#FF0000'},
        {name: 'Cleo', pullWatts: big, pullS: {n: 30}, colorName: big, colorHex: '#nothex'},
        {name: 'Dan', pullWatts: '250', pullS: NaN, colorName: 'Blue', colorHex: ['#0000FF']},
    ];
    const s = P.stripSheet(j, rows);
    assert.deepEqual(s, {
        json: {
            riders: {
                '1001': {name: 'Ben', order: 1, pull_duration: 60, color: '#ff0000', weight: 70, pull_power: 300, pull_wkg: 4.3},
                '1002': {},
                '1003': {name: 'Cleo', order: '2', pull_duration: '30', weight: '72.5', pull_power: '280', pull_wkg: '3.9'},
                '1004': {name: 'Dan'},
                '1005': {},
                '1006': {},
            },
            roster: {'1007': {}, '1008': {name: 'Eva'}, '1009': {}},
        },
        text: [
            {name: 'Ben', pullWatts: 300, pullS: 60, colorName: 'Red', colorHex: '#FF0000'},
            {name: 'Cleo'},
            {name: 'Dan', pullWatts: '250', colorName: 'Blue'},
        ],
    });
    // What is left reads as a plan, with the fallbacks normalizePlan uses for missing fields.
    assert.deepEqual(P.stripSheet({riders: {'1': {name: 'Ben', pull_wkg: [big]}}}, null).json.riders['1'], {name: 'Ben'});
    const plan = P.normalizePlan(s.json, s.text).plan;
    assert.equal(plan.targetSpeed, 0);
    assert.equal(plan.team, '');
    assert.deepEqual(plan.riders.find(x => x.id === '1001').color, '#ff0000');
});

test('stripSheet limits raw string lengths, padding included', () => {
    const name400 = 'Ben' + ' '.repeat(397);
    const j = {
        team: {name: 'T' + ' '.repeat(240)},
        riders: {
            '1001': {name: name400, order: 1, pull_duration: 60, color: '#ff0000'},
            '1002': {name: 'Cleo' + ' '.repeat(397), order: 2, pull_duration: 60, color: ' '.repeat(26) + '#00ff00'},
            '1003': {name: '&#' + '0'.repeat(400) + '68;', order: 3, pull_duration: 60, color: '#0000ff'},
        },
        roster: {'1004': {name: 'Dan' + ' '.repeat(398)}, '1005': {name: 'Eva'}},
    };
    const rows = [
        {name: name400, pullWatts: 300, pullS: 60, colorName: 'R'.repeat(32), colorHex: ' '.repeat(25) + '#FF0000'},
        {name: 'Cleo', pullWatts: 300, pullS: 60, colorName: 'R'.repeat(33), colorHex: ' '.repeat(26) + '#00FF00'},
        {name: 'Dan' + ' '.repeat(398), pullWatts: 300, pullS: 60},
    ];
    const s = P.stripSheet(j, rows);
    assert.equal(s.json.team, undefined);
    assert.equal(P.stripSheet({...j, team: {name: 'T'.repeat(240)}}, rows).json.team.name, 'T'.repeat(240));
    assert.deepEqual(s.json.riders, {
        '1001': {name: name400, order: 1, pull_duration: 60, color: '#ff0000'},
        '1002': {order: 2, pull_duration: 60},
        '1003': {order: 3, pull_duration: 60, color: '#0000ff'},
    });
    assert.deepEqual(s.json.roster, {'1004': {}, '1005': {name: 'Eva'}});
    assert.deepEqual(s.text, [{name: name400, pullWatts: 300, pullS: 60, colorName: 'R'.repeat(32), colorHex: ' '.repeat(25) + '#FF0000'}]);
});

test('stripSheet keeps riders and bench only under Zwift ID keys', () => {
    const j = {
        riders: {
            '1001': {name: 'Ben', order: 1, pull_duration: 60},
            'ben': {name: 'Cleo', order: 2, pull_duration: 60},
            '1234567890123': {name: 'Dan', order: 3, pull_duration: 60},
            '123456789012': {name: 'Eva', order: 4, pull_duration: 60},
            '-1': {name: 'Finn', order: 5, pull_duration: 60},
        },
        roster: {'1006': {name: 'Gus'}, ['x'.repeat(60000)]: {name: 'Hanna'}, '1007a': {name: 'Ida'}},
    };
    const rows = [{name: 'Cleo', pullWatts: 1, pullS: 60}, {name: 'Eva', pullWatts: 2, pullS: 60}];
    const s = P.stripSheet(j, rows);
    assert.deepEqual(Object.keys(s.json.riders), ['1001', '123456789012']);
    assert.deepEqual(Object.keys(s.json.roster), ['1006']);
    assert.deepEqual(s.text, [{name: 'Eva', pullWatts: 2, pullS: 60}]);
});

test('stripSheet keeps team, target speed, minimum finishers, bench and text colours', () => {
    const j = JSON.parse(json);
    j.minimum_finishers = 4;
    delete j.riders['5100002'].color;   // colour must come from the text row
    const rows = P.parseTextExport(txt);
    const a = P.normalizePlan(j, rows).plan;
    const s = P.stripSheet(j, rows);
    const b = P.normalizePlan(s.json, s.text).plan;
    assert.equal(b.team, 'Rollers');
    assert.equal(b.targetSpeed, 42.6);
    assert.equal(b.minimumFinishers, 4);
    assert.deepEqual(b.bench, [{id: '510007', name: 'Greta Wendt-Pohl (Kettenfett RC)'}]);
    assert.equal(b.riders.find(x => x.id === '5100002').color, '#000000');
    // everything but the two fields stripSheet drops on purpose
    const dropped = x => ({...x, riders: x.riders.map(r => ({...r, ftp: 0, adjustment: 100}))});
    assert.deepEqual(b, dropped(a));
    assert.ok(s.text.every(t => /^#[0-9A-Fa-f]{6}$/.test(t.colorHex)));
});


test('text rows: each taken once, in file order, by the normalized name', () => {
    const json = {team: {name: 'T'}, riders: {
        11: {name: 'Ben', order: 1, pull_duration: 60}, 12: {name: ' ben ', order: 2, pull_duration: 60},
        13: {name: 'Dan &amp; Co', order: 3, pull_duration: 60},
    }};
    const row = (name, pullWatts) => ({name, pullWatts, pullS: 60, colorName: 'Red', colorHex: '#ff0000'});
    const rows = [row('BEN', 301), row('Zed', 1), row('Ben', 302), row('Dan & Co', 303), row('ben', 304)];
    const {plan, warnings} = P.normalizePlan(json, rows);
    assert.deepEqual(plan.riders.map(r => r.watts), [301, 302, 303]);
    assert.deepEqual(warnings, [{code: 'unmatched-text-row', name: 'Zed'}, {code: 'unmatched-text-row', name: 'ben'}]);
    assert.deepEqual(P.stripSheet(json, rows).text.map(t => t.pullWatts), [301, 302, 303]);
});


test('text rows: matching is linear (a server reads uploads)', () => {
    // 10 000 riders and 10 000 rows took about 11 s with a scan per rider
    const n = 10000;
    const riders = {};
    const rows = [];
    for (let i = 0; i < n; i++) {
        riders[String(100000 + i)] = {name: `Rider ${i}`, order: i, pull_duration: 60};
        rows.push({name: `Other ${i}`, pullWatts: 1, pullS: 60, colorName: 'Red', colorHex: '#ff0000'});
    }
    const t0 = performance.now();
    const {warnings} = P.normalizePlan({riders}, rows);
    P.stripSheet({riders}, rows);
    assert.equal(warnings.length, n);
    assert.ok(performance.now() - t0 < 2000, `${Math.round(performance.now() - t0)} ms`);
});


// ---------- pull_power and pull_wkg from the JSON (spec §7.8) ----------

// A copy of the Rollers JSON with `field` set per rider from a map of Zwift ID → value.
function withField(src, field, values) {
    const j = JSON.parse(src);
    for (const [id, v] of Object.entries(values)) {
        j.riders[id][field] = v;
    }
    return j;
}
const withPower = (src, watts) => withField(src, 'pull_power', watts);
const withWkg = (src, wkg) => withField(src, 'pull_wkg', wkg);
// The text export's watts by Zwift ID (matched by name, as normalizePlan does).
const textWatts = (() => {
    const rows = P.parseTextExport(txt);
    const out = {};
    for (const [id, r] of Object.entries(JSON.parse(json).riders)) {
        out[id] = rows.find(t => P.normName(t.name) === P.normName(r.name)).pullWatts;
    }
    return out;
})();

test('pull_power: the JSON gives the watts by Zwift ID', () => {
    assert.equal(Object.keys(textWatts).length, 6);
    const alone = P.normalizePlan(withPower(json, textWatts), null);
    assert.deepEqual(alone.plan.riders.map(r => r.watts), [286, 338, 238, 266, 319, 309]);
    assert.equal(alone.plan.sig, '5FWHC3');
    assert.deepEqual(alone.warnings, []);
    const both = P.normalizePlan(withPower(json, textWatts), P.parseTextExport(txt));
    assert.equal(both.plan.sig, '5FWHC3');
    assert.ok(!both.warnings.some(w => w.code === 'watts-mismatch'));
    assert.deepEqual(both.warnings, []);
});

test('pull_power: whole watts', () => {
    const {plan} = P.normalizePlan(withPower(json, {5100005: 286.4, 5100004: '338'}), null);
    assert.equal(plan.riders[0].watts, 286);
    assert.equal(plan.riders[1].watts, 338);
    assert.equal(P.normalizePlan(withPower(json, {5100005: 285.5}), null).plan.riders[0].watts, 286);
});

test('pull_power: the JSON wins over a differing text row', () => {
    const {plan, warnings} = P.normalizePlan(withPower(json, {...textWatts, 5100002: 271}), P.parseTextExport(txt));
    assert.equal(plan.riders[3].id, '5100002');
    assert.equal(plan.riders[3].watts, 271);
    assert.deepEqual(warnings, [{code: 'watts-mismatch', id: '5100002', name: 'Dario Brandl [KFR]'}]);
    assert.notEqual(plan.sig, '5FWHC3');
});

test('pull_power: blank or bad values fall back to the text', () => {
    for (const bad of ['', '   ', null, 'abc', {}]) {
        const {plan, warnings} = P.normalizePlan(withPower(json, {5100004: bad}), P.parseTextExport(txt));
        assert.equal(plan.riders[1].watts, 338, JSON.stringify(bad));
        assert.deepEqual(warnings, [], JSON.stringify(bad));
        assert.equal(plan.sig, '5FWHC3', JSON.stringify(bad));
        assert.equal(P.normalizePlan(withPower(json, {5100004: bad}), null).plan.riders[1].watts, null, JSON.stringify(bad));
    }
    // an over-long numeric string counts as bad (stripSheet would drop it)
    const long = '3'.repeat(P.RAW_SHORT_MAX + 1);
    assert.equal(P.normalizePlan(withPower(json, {5100004: long}), P.parseTextExport(txt)).plan.riders[1].watts, 338);
});

test('pull_power: two riders with one name', () => {
    const j = {team: {name: 'T'}, riders: {
        1001: {name: 'Ben', order: 1, pull_duration: 60, pull_power: 300},
        1003: {name: 'Ben', order: 2, pull_duration: 60, pull_power: 280},
    }};
    const row = (name, pullWatts) => ({name, pullWatts, pullS: 60, colorName: 'Red', colorHex: '#ff0000'});
    const {plan, warnings} = P.normalizePlan(j, [row('Ben', 280), row('Ben', 300)]);
    assert.deepEqual(plan.riders.map(r => [r.id, r.watts]), [['1001', 300], ['1003', 280]]);
    assert.deepEqual(warnings, [{code: 'watts-mismatch', id: '1001', name: 'Ben'}, {code: 'watts-mismatch', id: '1003', name: 'Ben'}]);
});

test('pull_wkg: read per rider, the plan code unchanged', () => {
    const {plan, warnings} = P.normalizePlan(withWkg(json, {5100004: 4.2, 5100002: '4.5'}), P.parseTextExport(txt));
    assert.deepEqual(plan.riders.map(r => r.id), ['5100005', '5100004', '5100003', '5100002', '5100001', '51006']);
    assert.deepEqual(plan.riders.map(r => r.wkg), [null, 4.2, null, 4.5, null, null]);
    assert.equal(plan.sig, '5FWHC3');
    assert.deepEqual(warnings, []);
    assert.ok(P.normalizePlan(JSON.parse(json), P.parseTextExport(txt)).plan.riders.every(r => r.wkg === null));
});

test('pull_wkg: bad values give none', () => {
    for (const bad of ['', '   ', null, 'abc', {}, 0, '0', -4.2]) {
        const {plan, warnings} = P.normalizePlan(withWkg(json, {5100004: bad}), P.parseTextExport(txt));
        assert.equal(plan.riders[1].wkg, null, JSON.stringify(bad));
        assert.deepEqual(warnings, [], JSON.stringify(bad));
        assert.equal(plan.riders[1].watts, 338, JSON.stringify(bad));
    }
});

test('pull_wkg: kept as written', () => {
    assert.equal(P.normalizePlan(withWkg(json, {5100004: 4.25}), P.parseTextExport(txt)).plan.riders[1].wkg, 4.25);
});

test('pull_wkg: alone sets no target', () => {
    const all = Object.fromEntries(Object.keys(JSON.parse(json).riders).map(id => [id, 4.1]));
    const {plan} = P.normalizePlan(withWkg(json, all), null);
    assert.ok(plan.riders.every(r => r.watts === null));
    assert.ok(plan.riders.every(r => r.wkg === 4.1));
});

test('pull_wkg: survives stripSheet', () => {
    const j = withWkg(json, {5100004: 4.2, 5100002: '4.5'});
    const rows = P.parseTextExport(txt);
    const s = P.stripSheet(j, rows);
    assert.deepEqual(P.normalizePlan(s.json, s.text).plan.riders.map(r => r.wkg), P.normalizePlan(j, rows).plan.riders.map(r => r.wkg));
    assert.deepEqual(P.normalizePlan(s.json, s.text).plan.riders.map(r => r.wkg), [null, 4.2, null, 4.5, null, null]);
});
