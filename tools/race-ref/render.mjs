// reference.md from the reference and the rider figures: German, in the style of the ride report
// (numbers first, one section per topic, times as race time from the earliest roll-off, +mm:ss).
// Riders are plan positions #k; names appear only when the caller passes them (--names).
import {raceTime, signed, txt, dur} from '../ride-report/util.mjs';

const v = x => (x === null || x === undefined ? '–' : String(x));
const KIND_DE = {first: 'erster Zug', next: 'nächster', skip: 'übersprungen', same: 'gleicher', back: 'zurück'};
const CTX_DE = {start: 'Start', flat: 'Flach', climb: 'Anstieg', end: 'Ende'};
const STATE_DE = {gone: 'abgehängt', back: 'wieder dabei'};
const IN_ORDER = ['next', 'skip', 'same'];


function table(head, rows) {
    if (!rows.length) {
        return '_keine_\n';
    }
    const esc = c => v(c).replace(/\|/g, '\\|');
    return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`,
            ...rows.map(r => `| ${r.map(esc).join(' | ')} |`)].join('\n') + '\n';
}

const at = s => raceTime(s * 1000, 0);
const percent = (part, whole) => (whole > 0 ? `${Math.round(1000 * part / whole) / 10} %` : '–');
const count = (xs, f) => xs.filter(f).length;


// The reference as Markdown. ref: buildReference's result (or its JSON), figures: riderFigures,
// names: optional {names} with the plan's names by position (index 0 unused); without it riders
// are shown as #k only. Returns the text.
export function renderMarkdown(ref, figures, {names = null} = {}) {
    const who = k => (names?.[k] ? `#${k} ${names[k]}` : `#${k}`);
    const turns = ref.turns;
    const changes = turns.filter(t => t.kind !== 'first');
    const parts = [];
    parts.push('# Rennreferenz', '',
               `${ref.selfPos.length} Aufzeichnung(en), ${ref.n} Fahrer im Plan, Rennen ${dur(ref.raceS)} · Zeiten: Rennzeit ab dem frühesten Rollout (+mm:ss) · ` +
               'Fahrer als Planposition #k (Reihenfolge des zuletzt bekannten Plans)', '');

    // 1. Überblick
    const known = count(ref.front, x => x > 0);
    const split = count(ref.front, x => x === -1);
    const unknown = ref.N - known - split;
    parts.push('## 1. Überblick', '');
    parts.push(table(['', ''], [
        ['Aufzeichnungen', `${ref.selfPos.length}, aufgenommen von ${ref.selfPos.map(k => (k ? who(k) : 'keinem Planfahrer')).join(', ')}`],
        ['Abdeckung', `Spitze bekannt in ${percent(known, ref.N)} der Sekunden (${known} von ${ref.N} s), unbekannt ${unknown} s, ` +
            `uneinig ${split} s`],
        ['Übereinstimmung', ref.agreement === null ? '– (nur eine Aufzeichnung, nichts zu vergleichen)' :
            `${percent(ref.agreement, 1)} der Sekunden mit zwei Stimmen`],
        ['Züge', `${turns.length} (${ref.interjections.length} Störer verworfen)`],
        ['Anstiege', ref.hills.length ? `${ref.hills.length} Fenster, zusammen ${dur(ref.hills.reduce((a, h) => a + h.end - h.start + 1, 0))}` : 'keine'],
    ]));

    // 2. Wechsel
    parts.push('## 2. Wechsel', '');
    parts.push('Regel: Wechsel gegen die Reihe der Fahrer in der Gruppe (ohne die Übersprungenen, bis sie ziehen). Nächster, übersprungen und ' +
               'gleicher Fahrer sind in Ordnung, zurück an den vorigen (nur ab drei Fahrern) ist außer Ordnung.', '');
    const kinds = Object.fromEntries(Object.keys(KIND_DE).map(k => [k, count(changes, t => t.kind === k)]));
    const inN = count(changes, t => IN_ORDER.includes(t.kind));
    parts.push(`**Reihenfolge:** ${changes.length} Wechsel (ohne den ersten Zug), davon in Ordnung ${inN} ` +
               `(nächster ${kinds.next}, übersprungen ${kinds.skip}, gleicher ${kinds.same}), außer Ordnung ${kinds.back} (zurück).`, '');
    parts.push('**Wechsel nach Kontext** (Kontext in der Sekunde, in der der Wechsel beginnt):', '');
    parts.push(table(['Kontext', 'Sekunden', 'Wechsel', 'in Ordnung', 'außer Ordnung'],
                     Object.keys(CTX_DE).map(c => {
                         const here = changes.filter(t => ref.ctx[t.start] === c);
                         return [CTX_DE[c], count(ref.ctx, x => x === c), here.length, count(here, t => IN_ORDER.includes(t.kind)),
                                 count(here, t => t.kind === 'back')];
                     })));
    const after = changes.filter(t => ref.afterClimb[t.start] === 1);
    parts.push(`**Nach dem Anstieg** (bis zum zweiten Wechsel in Ordnung danach): ${count(ref.afterClimb, x => x === 1)} s, ` +
               `${after.length} Wechsel, davon außer Ordnung ${count(after, t => t.kind === 'back')}.`, '');
    const backs = changes.filter(t => t.kind === 'back');
    parts.push('**Wechsel außer Ordnung:**', '');
    parts.push(table(['Zeit', 'von', 'an', 'Kontext', 'Ursache'],
                     backs.map(t => [at(t.start), who(t.from), who(t.who), CTX_DE[ref.ctx[t.start]],
                                     ref.marks.find(m => m.type === 'back' && m.at === t.start)?.cause === 'traffic' ? 'Verkehr' : 'Team'])));
    const sat = changes.filter(t => t.kind === 'skip');
    if (sat.length) {
        parts.push('**Übersprungen** (die Übergangenen setzen aus, bis sie ziehen):', '');
        parts.push(table(['Zeit', 'von', 'an', 'übergangen'], sat.map(t => [at(t.start), who(t.from), who(t.who), t.skipped.map(who).join(', ')])));
    }

    // 3. Störer
    parts.push('## 3. Störer', '');
    parts.push('Ein Zug unter 20 s ist ein Störer, wenn er (a) zwischen zwei Zügen liegt, von denen der spätere der nächste in der ' +
               'Reihe nach dem früheren ist, er selbst aber nicht, oder (b) mitten im Zug eines Fahrers liegt (derselbe Fahrer davor ' +
               'und danach). Er wird verworfen, der Zug davor läuft weiter (in (b) werden die beiden Teile verbunden).', '');
    const watts = (w, plan) => (w === null || w === undefined ? '–' : plan > 0 ? `${Math.round(w)} W (${Math.round(100 * w / plan)} %)` : `${Math.round(w)} W`);
    parts.push('Leistung: Median über die Sekunden des Störers, in Watt und in Prozent des Plans; „Zug“ ist der Fahrer, dessen Zug weiterläuft.', '');
    parts.push(table(['Zeit', 'Fahrer', 'Länge s', 'zwischen', 'Leistung Störer', 'Leistung Zug', 'Ursache'],
                     ref.interjections.map(x => [at(x.at), who(x.who), x.s, `${who(x.between[0])} → ${who(x.between[1])}`,
                                                 watts(x.w, x.wPlan), watts(x.ownerW, x.ownerPlanW),
                                                 ref.marks.find(m => m.type === 'interjection' && m.at === x.at)?.cause === 'traffic' ? 'Verkehr' : 'Team'])));

    // 4. Abgehängt
    parts.push('## 4. Abgehängt', '');
    parts.push('Abgehängt nach 30 s außerhalb der größten Gruppe (Lücken ≤ 30 m), wieder dabei nach 30 s darin; der Zeitpunkt ist der Beginn der Phase. ' +
               'Ein Fahrer ohne Daten ist von Sekunde 0 an abgehängt.', '');
    parts.push(table(['Fahrer', 'Zeit', 'Zustand'], ref.drops.map(d => [who(d.who), at(d.at), STATE_DE[d.state] ?? d.state])));
    const gone = figures.filter(f => f.goneAt !== null);
    if (gone.length) {
        parts.push(`**Endgültig weg** (zuletzt abgehängt, danach nicht wieder dabei): ${gone.map(f => `${who(f.k)} ab ${at(f.goneAt)}`).join(', ')}.`, '');
    }

    // 5. Verkehr
    parts.push('## 5. Verkehr', '');
    parts.push('Jeder Wechsel außer Ordnung, jeder Störer und jede Unordnung (zusammenhängende Sekunden mit Wechselart zurück) ist Team oder ' +
               'Verkehr: Verkehr, wenn in den 30 s davor jemand außerhalb des Teams vor der Spitze oder in der Reihe war.', '');
    const kindsOfMark = [['back', 'Wechsel zurück'], ['interjection', 'Störer'], ['disorder', 'Unordnung']];
    parts.push(table(['Art', 'Team', 'Verkehr'],
                     kindsOfMark.map(([t, label]) => [label, count(ref.marks, m => m.type === t && m.cause === 'team'),
                                                      count(ref.marks, m => m.type === t && m.cause === 'traffic')])));
    const ahead = count(ref.traffic, x => x.ahead === true);
    const inLine = count(ref.traffic, x => x.inLine === true);
    const blind = count(ref.traffic, x => x.ahead === null && x.inLine === null);
    parts.push(`**Sekunden mit Verkehr:** vor der Spitze ${ahead} s, in der Reihe ${inLine} s; nichts bekannt ${blind} s ` +
               '(ältere Aufzeichnungen haben kein Verkehrsfeld: dort steht der Windschatten des vordersten Teamfahrers für „jemand davor“, ' +
               'in der Reihe ist unbekannt).', '');

    // 6. Fahrer
    parts.push('## 6. Fahrer', '');
    parts.push('Züge nach Planposition. Median minus Plan nur für Züge, die auf dem Flachen beginnen; Leistung als Verhältnis zur Plan-Leistung ' +
               '(gleich dem W/kg-Verhältnis), ab 5 s im Zug; Lücken aus den Fahrtberichten, zusammengefasst (Anzahl, längste, größte).', '');
    parts.push(table(['Fahrer', 'Züge', 'davon flach', 'Median s', 'Median − Plan flach s', 'Leistung gg. Plan', 'in der Gruppe',
                      'endgültig weg', 'übersprungen', 'Störer', 'Lücken'],
                     figures.map(f => [who(f.k), f.turns, f.flatTurns, txt(f.medS), signed(f.medOverPlanFlatS),
                                       f.medWkgVsPlan === null ? '–' : `${Math.round(100 * f.medWkgVsPlan)} %`,
                                       percent(f.groupShare, 1), f.goneAt === null ? '–' : at(f.goneAt), f.satOut,
                                       f.interjections, f.gaps.length ? `${f.gaps.length}× (${Math.max(...f.gaps.map(g => g.s))} s, ${Math.round(Math.max(...f.gaps.map(g => g.m)))} m)` : '–'])));
    return parts.join('\n');
}
