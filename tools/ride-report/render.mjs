// report.md from the analysis result: numbers first, one section per check, each with a one-line
// verdict. Times are race times from the roll-off (+mm:ss); the overview gives the UTC clock.
import {clockUtc, raceTime, txt, signed, dur} from './util.mjs';

const bool = x => (x ? 'ja' : '–');
const v = x => (x === null || x === undefined ? '–' : String(x));

function table(head, rows) {
    if (!rows.length) {
        return '_keine_\n';
    }
    const esc = c => v(c).replace(/\|/g, '\\|');
    return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`,
            ...rows.map(r => `| ${r.map(esc).join(' | ')} |`)].join('\n') + '\n';
}

function section(n, title, check, body) {
    const out = [`## ${n}. ${title}`, '', `**Ergebnis:** ${check.verdict}`, ''];
    if (check.skipped) {
        out.push(`_${check.skipped}_`, '');
        return out.join('\n');
    }
    out.push(body(), '');
    return out.join('\n');
}


export function renderMarkdown(r) {
    const o = r.overview;
    const t0 = o.rollOff.at;
    const T = ts => raceTime(ts, t0);
    const parts = [];
    const day = Number.isFinite(o.startedAt) ? ` ${new Date(o.startedAt).toISOString().slice(0, 10)}` : '';
    parts.push(`# Fahrtbericht ${v(o.team)} – ${clockUtc(o.startedAt)} UTC${day}`, '');
    parts.push(`Datei: \`${v(r.file)}\` · Bericht v${r.reportVersion} · Zeiten: Rennzeit ab dem Rollout (+mm:ss)`, '');

    parts.push(section(1, 'Überblick', o, () => {
        const L = [];
        L.push(table(['', ''], [
            ['Team', o.team],
            ['Event', o.event ? `${o.event.name} (${o.event.type}, ${txt(o.event.endDistanceM / 1000, 2)} km, ${o.event.laps} Runde(n))` : 'nicht aufgezeichnet'],
            ['Mod-Version', o.version],
            ...(o.analysisPlan ? [['Ausgewertet mit', `Plan ${o.analysisPlan.sig} für jede Sekunde (--plan-all)` +
                (o.analysisPlan.otherLive.length ? `; live lief: ${o.analysisPlan.otherLive.map(p => `${p.sig} ${T(p.from)} bis ${T(p.to)}`).join(', ')}` +
                    ` (${o.analysisPlan.otherLiveTicks} s)` : '; live lief derselbe Plan')]] : []),
            ['Rollout', `${clockUtc(o.rollOff.at)} UTC (${o.rollOff.source === 'engine' ? 'Startlogik der Engine' : o.rollOff.source})`],
            ['Ziellinie', o.finish.endM ? `${txt(o.finish.endM / 1000, 3)} km (${o.finish.source === 'event' ? 'Event' : 'geschätzt aus dem Zielmodus'}), erreicht ${o.finish.at ? `${T(o.finish.at)} (${clockUtc(o.finish.at)} UTC)` : 'nicht'}` : 'unbekannt'],
            ['Dauer', `Aufzeichnung ${dur(o.recordingS)}, Rennen ${dur(o.raceS)}, ${o.ticks} Ticks${o.badLines ? `, ${o.badLines} kaputte Zeilen` : ''}`],
            ['Datenlücken > 3 s', `${o.holes.count} (${o.holes.inRace} im Rennen), zusammen ${o.holes.totalS} s` +
                (o.holes.longest.length ? `; längste: ${o.holes.longest.map(h => `${T(h.from)} ${h.s} s${h.inRace ? '' : ' (vor/nach dem Rennen)'}`).join(', ')}` : '')],
        ]));
        L.push('', o.analysisPlan ? `**Plancodes, wie sie live liefen** (ausgewertet wird mit ${o.analysisPlan.sig}):` : '**Plancodes:**', '');
        L.push(table(['Plan', 'von', 'bis', 'Ticks', 'Fahrer', 'Plan bekannt'],
                     o.plans.map(p => [p.sig, T(p.from), T(p.to), p.ticks, p.riders, p.known ? 'ja' : 'NEIN (--plan)'])));
        L.push('', '**Fahrer aufgezeichnet vs. Plan:**', '');
        L.push(table(['Plan', 'Fahrer', 'aufgezeichnet', 'fehlen', 'gekürzter Upload'],
                     o.riders.map(x => [x.sig, x.total, x.recorded.join(', '), x.missing.join(', ') || '–', x.stripped ? 'ja: nur die Fahrer des Kopfzeilen-Plans sind drin' : '–'])));
        if (o.lacking.length) {
            L.push('', '**Fehlt in dieser Aufzeichnung:**', '', ...o.lacking.map(x => `- ${x.field}: ${x.why}`));
        }
        if (o.notes.length) {
            L.push('', '**Hinweise:**', '', ...o.notes.map(x => `- ${x}`));
        }
        return L.join('\n');
    }));

    const g = r.pulls;
    parts.push(section(2, 'Wer war wirklich vorne (Ground Truth)', g, () => {
        const L = [];
        L.push(`Regel: Planfahrer (oder ich) mit Daten ≤ ${g.rules.freshMs / 1000} s alt, Windschatten ≤ ${g.rules.draftW} W, ` +
               `> ${g.rules.minKmh} km/h, ein anderer Planfahrer höchstens ${g.rules.groupM} m entfernt, am weitesten vorne; Züge ≥ ${g.rules.minPullS} s, Lücken ≤ ${g.rules.bridgeS} s überbrückt, ` +
               `derselbe Fahrer innerhalb ${g.rules.mergeS} s zusammengefasst. Hin und Her an der Spitze (zwei Fahrer wechseln sich ` +
               `mindestens dreimal ab, einer davon kürzer als ${g.rules.swapFrac * 100} % seines Plans): die Abschnitte eines Fahrers zählen ` +
               `als ein Zug (ihre Summe). Vorne nicht sichtbar: ${g.unseenTicks} von ${g.raceTicks} s` +
               (g.noPlanTicks ? `, ohne Plan: ${g.noPlanTicks} s` : '') + '.', '');
        L.push('**Je Fahrer: Zuglänge minus Plan (s), erster Zug des Rennens nicht mitgezählt, Hin und Her als ein Zug:**', '');
        L.push(table(['Fahrer', 'Züge', 'Plan s', 'Median', '1. Drittel', '2. Drittel', '3. Drittel', 'min', 'max'],
                     g.riders.map(x => [x.who, x.pulls, x.planS, signed(x.medianOverS), signed(x.thirds[0]), signed(x.thirds[1]),
                                        signed(x.thirds[2]), signed(x.min), signed(x.max)])));
        const o2 = g.order;
        L.push('', `**Reihenfolge:** ${o2.next} Wechsel zum nächsten im Plan, ${o2.skipUnseen} über nicht aufgezeichnete Fahrer hinweg, ` +
               `${o2.back} zurück an den vorigen, ${o2.skip} übersprungen, ${o2.other} sonst.`);
        if (o2.changes.length) {
            L.push('', table(['Zeit', 'Art', 'von', 'an', 'übersprungen'],
                             o2.changes.map(c => [T(c.at), {back: 'zurück', skip: 'übersprungen', other: 'sonst'}[c.kind] ?? c.kind,
                                                  c.from, c.to, c.skipped.join(', ') || '–'])));
        }
        if (g.finishSprint?.length) {
            L.push('', `**Im Zielsprint begonnen** (Zielmodus; in den Prüfungen 2–4 nicht gezählt): ` +
                   g.finishSprint.map(p => `${T(p.start)} ${p.who} ${p.s} s`).join(', ') + '.');
        }
        if (g.swaps?.length) {
            L.push('', '**Hin und Her an der Spitze** (je Fahrer als ein Zug gezählt):', '');
            L.push(table(['Start', 'Abschnitte', 'Fahrer: Summe s (Plan s, Abschnitte)'],
                         g.swaps.map(x => [T(x.at), x.stints, x.riders.map(r => `${r.who} ${r.s} (${v(r.planS)}, ${r.stints}×)`).join(', ')])));
        }
        L.push('', '**Züge** (Abschnitte an der Spitze; ↔n: Teil des n. Hin und Her):', '');
        L.push(table(['Start', 'Fahrer', 'Länge s', 'Plan s', '±', 'Plan'],
                     g.pulls.map(p => [T(p.start), p.who + (p.first ? ' (erster)' : '') + (p.swap ? ` ↔${p.swap}` : ''), p.s, v(p.planS),
                                       signed(p.overS), p.sig])));
        return L.join('\n');
    }));

    const p = r.puller;
    parts.push(section(3, 'Zieher-Erkennung', p, () => {
        const L = [];
        const ex = p.excluded;
        L.push(`Beurteilt: ${p.judgedTicks} s mit sichtbarem Zieher. Nicht beurteilt: Startsperre ${ex.lock} s, Zielmodus ${ex.finish} s, ` +
               `Pause ${ex.pause} s, allein ${ex.alone} s, langsam ${ex.slow} s, ohne det ${ex.nodet} s, ohne Plan ${ex.noplan} s; vorne unsichtbar ${p.live.unseenTicks} s ` +
               `(davon nannte die Engine ${p.live.unseenNamedUnrecorded} s einen Fahrer ohne Daten; in der ganzen Aufzeichnung ${p.live.unrecordedPullerTicks} s).`, '');
        L.push(table(['', 'live (det.puller)', 'heutige Engine (Replay)'], [
            ['Zieher richtig', `${v(p.live.agreePct)} %`, `${v(p.replay.agreePct)} %`],
            ['Sekunden falscher Zieher', p.live.wrongS, p.replay.wrongS],
            ['Hänger > 10 s', p.live.locks.length, p.replay.locks.length],
        ]));
        L.push('', `**Verzug beim Wechsel (live; ab da, wo die Engine ihn endgültig nannte):** Median ${v(p.live.lagMedianS)} s, p90 ${v(p.live.lagP90S)} s über ${p.live.changes - p.live.unseenChanges - p.live.missedChanges} Wechsel; ` +
               `${p.live.missedChanges} nie erkannt, ${p.live.unseenChanges} nicht messbar (unsichtbarer Fahrer dazwischen). Negativ = früher als die Wahrheit.`, '');
        L.push(table(['Zeit', 'an', 'Verzug s'], p.live.lags.map(l => [T(l.at), l.to, l.unseen ? 'n. messbar' : v(l.lagS)])));
        L.push('', '**Hänger (live):**', '');
        L.push(table(['Zeit', 'Dauer s', 'km', 'Engine', 'vorne war', 'nach Pause'],
                     p.live.locks.map(x => [T(x.from), x.s, txt(x.km, 2), x.puller, x.front, bool(x.afterPause)])));
        if (p.replay.locks.length) {
            L.push('', '**Hänger (heutige Engine im Replay):**', '');
            L.push(table(['Zeit', 'Dauer s', 'km', 'Engine', 'vorne war', 'nach Pause'],
                         p.replay.locks.map(x => [T(x.from), x.s, txt(x.km, 2), x.puller, x.front, bool(x.afterPause)])));
        }
        L.push('', '**Anstiegs-/Abfahrtspausen:**', '');
        L.push(table(['Zeit', 'Art', 'Dauer s', 'km', 'Zieher davor', 'danach', 'vorne danach', 'richtig nach s', 'Hänger danach s'],
                     p.pauses.map(x => [T(x.from), x.kind, x.s, txt(x.km, 2), x.pullerBefore, x.pullerAfter, x.truthAfter,
                                        v(x.rightAfterS), v(x.lockAfterS)])));
        const ch = p.chaos;
        const ended = {order: '3 Wechsel in Planfolge', plan: 'neuer Plan', finish: 'Zielmodus', end: 'bis zum Ende'};
        L.push('', '**Chaos-Phasen** (die Reihenfolge an der Spitze folgt nicht dem Plan: Countdown still, das Info-Fenster zeigt ' +
               'den echten Zieher; diese Sekunden sind oben wie normales Fahren beurteilt' +
               (ch.liveRecorded ? '' : '; live: nicht aufgezeichnet, die Version hatte kein det.order') + '):', '');
        L.push(table(['Quelle', 'von', 'bis', 'Dauer s', 'Ende'],
                     [...ch.live.map(x => ['live', x]), ...ch.replay.map(x => ['Replay', x])]
                         .map(([src, x]) => [src, T(x.from), T(x.to), x.s, ended[x.endedBy] ?? x.endedBy])));
        if (ch.live.length || ch.replay.length) {
            const J = ch.judged;
            L.push('', 'In Chaos beurteilt: ' + (ch.liveRecorded ? `live ${J.live.s} s (${v(J.live.agreePct)} % richtig), ` : '') +
                   `heutige Engine ${J.replay.s} s (${v(J.replay.agreePct)} % richtig).`);
        }
        L.push('', '**Replay-Treue** (Replay = live; Front < 99 % bei gleichem Plan: der Aufzeichnung fehlen Fahrer, die live da waren):', '');
        L.push(table(['Plan live', 'Ticks', 'Zieher gleich', 'Front gleich', 'Grund'],
                     p.replay.fidelity.map(f => [f.sig, f.ticks, `${v(f.pullerPct)} %`, `${v(f.frontPct)} %`,
                                                 f.otherPlan ? 'anderer Plan im Replay (--plan-all)' : f.frontPct < 99 ? 'Fahrer ohne Daten' : '–'])));
        return L.join('\n');
    }));

    const c = r.countdown;
    parts.push(section(4, 'Countdown bis zu meinem Zug (Erholung)', c, () => {
        const L = [];
        L.push(`**Sprünge ≥ 3 s pro Schritt:** ${c.jumps.n} (${c.jumps.down} runter, ${c.jumps.up} hoch; ${c.jumps.atChange} beim Zieherwechsel).`, '');
        L.push(table(['Zeit', 'Uhr von → auf', 'Sprung s', 'Zieherwechsel'],
                     c.jumps.list.map(j => [T(j.at), `${j.fromS} → ${j.toS}`, signed(j.errS), bool(j.change)])));
        L.push('', `**Erholungsphasen** (mein Zugende → mein nächster Zugstart; Plan = Züge der anderen + 10 s je Fahrer (Plan bis 40 s, darüber 5 s) außer dem direkt vor mir, ` +
               `nach der festen Regel bis 0.3.4-beta.4 (seit beta.5 zählt die Engine die gelernte Wechselzeit des Teams), ohne Fahrer > 100 m weg; Uhr = Anzeige 3 s nach Zugende):`, '');
        L.push(table(['Zugende', 'tatsächlich s', 'Plan s', 'Uhr s', 'Züge dazwischen: tatsächlich (Plan)', 'Rest (Wechsel, Unsichtbare) s'],
                     c.recovery.map(x => [T(x.end), x.effS, `${v(x.planS)} (${v(x.sig)}${x.gone.length ? `, ohne ${x.gone.join(', ')}` : ''})`,
                                          x.clockS ?? `(${v(x.clockKind)})`,
                                          x.between.map(b => `${b.who} ${b.s} (${v(b.planS)})`).join(', ') || '–', x.unseenS])));
        L.push('', `**Vor meinen Zügen:** Vorhersagefehler der Uhr (+ = Uhr sagte später), READY-Vorlauf, "Zug"-Anzeige gegen den echten Start.`, '');
        L.push(table(['Zugstart', ...c.errorAt.map(e => `−${e.look} s`), 'READY vorher s', '"Zug" ab s (Beginn der Anzeige, die beim Start lief)'],
                     c.before.map(b => [T(b.start), ...b.errs.map(e => (typeof e === 'number' ? signed(e) : `(${v(e)})`)),
                                        v(b.readyLeadS), signed(b.pullShownS)])));
        L.push('', `Mediane: ${c.errorAt.map(e => `−${e.look} s: ${signed(e.medianS)} (n ${e.n})`).join(' · ')}; READY ${v(c.readyLeadMedianS)} s vorher; ` +
               `"Zug" ${signed(c.pullShownMedianS)} s gegen den echten Start; |Fehler| Median ${v(c.absErrorMedianS)} s.`);
        // Against T0 (user, 21 Nov 2026: the countdown's 0 is when the rider before me eases off).
        const t0 = c.t0;
        const t0Line = x => `${x.errorAt.map(e => `−${e.look} s: ${signed(e.medianS)} (n ${e.n})`).join(' · ')}; ` +
            `vorzeichenbehaftet Median ${signed(x.signedMedianS)} s; |Fehler| Median ${v(x.absErrorMedianS)} s; ` +
            `zu spät (> 3 s bei −10 s) ${x.late10Pct === null ? '–' : `${x.late10Pct} %`}; READY ${v(x.readyLeadMedianS)} s vor T0 (${x.n} ${x.n === 1 ? 'Zug' : 'Züge'}).`;
        L.push('', `**Gegen T0** (0 = der Fahrer vor mir lässt nach, 85-%-Regel; Züge ab 5 min, ohne meinen ersten): ${t0Line(t0)}`);
        L.push('', t0.shadow ? `Schatten (feste Zuschläge bis 0.3.4-beta.4, det.cdOld): ${t0Line(t0.shadow)}`
                             : 'Schatten: entfällt (keine det.cdOld in der Aufzeichnung).');
        const z = c.chaos;
        L.push('', `**Chaos (still statt Countdown):** live zeigten die Fenster ${z.liveS} s "≠" (keine Fehler); die heutige Engine wäre ` +
               `im Replay ${z.replayS} s still. Mit diesen Sekunden still: Sprünge ${c.jumps.n} → ${z.replay.jumps}, ` +
               `|Fehler| Median ${v(c.absErrorMedianS)} → ${v(z.replay.absErrorMedianS)} s; ` +
               `Mediane ${z.replay.errorAt.map(e => `−${e.look} s: ${signed(e.medianS)} (n ${e.n})`).join(' · ')}.`);
        return L.join('\n');
    }));

    const G = r.gaps;
    parts.push(section(5, 'Lücken', G, () => {
        const L = [];
        L.push(`Echte Lücke: geglättet ≥ ${G.rules.onM} m (am Berg ${G.rules.hillOnM} m) ≥ ${G.rules.realMinS} s. ` +
               `Warnungen = frühe Stufe an. Wichtig: roh ≥ ${G.rules.onM} m (Berg ${G.rules.hillOnM} m) in ${G.rules.importantS} s danach; stabil: ±1 m in den 5 s davor.` +
               (G.real.invalidMine ? ` ${G.real.invalidMine} meiner Lücken nicht gezählt (mein Hinterrad hatte keine Daten).` : '') +
               (G.real.drafted.length ? ` ${G.real.drafted.length} scheinbare Lücken nicht gezählt, weil der Fahrer dahinter im vollen Windschatten blieb ` +
                   `(Median ≥ 50 W: ein Fahrer ohne Daten oder außerhalb des Plans dazwischen): ${G.real.drafted.map(e => `${T(e.at)} ${e.who} ${e.maxM} m, ${e.draftW} W`).join('; ')}.` : '') +
               (G.caveat ? ` Achtung: ${G.caveat}.` : ''), '');
        const row = (name, x) => (x ? [name, x.n, `${x.detected}/${G.real.n}`, x.missed, signed(x.afterRaw8.medianS),
                                       `${signed(x.afterRaw8.minS)}…${signed(x.afterRaw8.maxS)}`, txt(x.gapAtWarningM, 1), x.falseAlarms,
                                       x.important, x.unimportant, x.stable] : [name, 'nicht aufgezeichnet', '', '', '', '', '', '', '', '', '']);
        L.push(table(['Warnungen', 'Anzahl', 'echte gewarnt', 'verpasst', 'nach 8 m roh (Median s)', 'min…max', 'Lücke bei Warnung m',
                      'Fehlalarme', 'wichtig', 'unwichtig', 'davon stabil'],
                     [row('angezeigt (det.gap)', G.shown), row('heutige Engine (Replay)', G.replay)]));
        const U = G.withoutDraftFilter;
        L.push('', `Ohne den Windschatten-Filter (zum Vergleich mit früheren Auswertungen): ${U.real} echte Lücken, ` +
               `${U.warnings} Warnungen im Replay, ${U.detected} gewarnt, ${U.falseAlarms} Fehlalarme, ${signed(U.afterRaw8MedianS)} s nach 8 m roh.`);
        L.push('', '**Echte Lücken:**', '');
        L.push(table(['Zeit', 'Fahrer', 'Dauer s', 'max m', 'Windschatten W', 'Berg', 'kritisch', 'angezeigt nach 8 m s', 'Replay nach 8 m s'],
                     G.real.list.map(e => [T(e.at), e.who, e.s, e.maxM, v(e.draftW), bool(e.hill), bool(e.critical), signed(e.afterRaw8Shown), signed(e.afterRaw8Replay)])));
        L.push('', '**Lücken, die wieder zugingen** (ab 5 m, Spitze ≥ 6 m, zu = unter 4 m; wer schloss: Δv hinten vs. vorne):', '');
        L.push(table(['Spitze', 'Ausreißer', 'zu', 'Dauer bis zu (Median s)', 'Fahrer hinten schneller', 'vorne langsamer', 'Δv hinten km/h', 'Δv vorne km/h'],
                     G.closing.map(x => [x.peak, x.n, x.closed, v(x.closeMedianS), x.byRiderBehind, x.byFrontSlower, signed(x.dvBehindKmh, 1), signed(x.dvAheadKmh, 1)])));
        L.push('', '**Abriss-Zähler je Fahrer:**', '');
        L.push(table(['Fahrer', 'echte Lücken', 'Replay früh', 'Replay voll', 'angezeigt'],
                     G.perRider.map(x => [x.who, x.real, x.replayEarly, x.replayFull, v(x.shown)])));
        L.push('', '**Letzte 500 m** (stumm, wie gewollt; hier nur gelistet, mit der heutigen Engine):', '');
        L.push(G.finishZone === null ? '_Ziellinie unbekannt_\n' :
            table(['Zeit', 'Fahrer', 'Stufe', 'Lücke m', 'Windschatten W', 'kritisch', 'Zähler davor', 'm vor der Linie'],
                  G.finishZone.map(x => [T(x.at), x.who, x.level, x.g, v(x.draftW), bool(x.critical), x.before, x.toLineM])));
        return L.join('\n');
    }));

    const f = r.finish;
    parts.push(section(6, 'Ziel', f, () => {
        const L = [];
        L.push(table(['Zielmodus an', 'm zur Linie', 'aus', 'm nach der Linie'],
                     f.modes.map(m => [T(m.on), v(m.onToLineM), m.off ? T(m.off) : 'bis Ende', v(m.offToLineM)])));
        if (f.afterLine) {
            const a = f.afterLine;
            L.push('', `Nach der Linie: ${a.ticks} s aufgezeichnet, davon ${a.finishOffTicks} s ohne Zielmodus; Engine aktiv bis ${a.engineActiveS} s nach der Linie, ` +
                   `${a.pullerChanges} Zieherwechsel, ${a.gapWarningTicks} s Lückenwarnung${a.gapMaxM !== null ? ` (bis ${a.gapMaxM} m)` : ''}; ` +
                   `Anzeige: ${Object.entries(a.views).map(([k, n]) => `${k} ${n} s`).join(', ')}.`);
        }
        L.push('', `Aufzeichnungsende: ${T(f.recordingEnd.at)}${f.recordingEnd.afterLineS !== null ? `, ${f.recordingEnd.afterLineS} s und ${v(f.recordingEnd.pastLineM)} m nach der Linie` : ''}.`);
        return L.join('\n');
    }));

    const u = r.upload;
    parts.push(section(7, 'Upload-Prüfung (stripForUpload)', u, () =>
        `Fahrer mit Zeilen: ${u.ridersRecorded}, nach dem Kürzen: ${u.ridersKept}; Zeilen ${u.rows} → ${u.keptRows}. ` +
        `Verlorene Planfahrer: ${u.lostPlanRiders.join(', ') || 'keine'}; andere Fahrer weg: ${u.lostOthers}.` +
        (u.absentPlanRiders.length ? ` Schon in dieser Datei ohne Zeilen (Fahrer späterer Pläne): ${u.absentPlanRiders.join(', ')}.` : '')));
    const w = r.views;
    parts.push(section(8, 'Countdown aus jeder Fahrersicht (Simulation)', w, () => {
        const L = [];
        L.push(`Jeder Planfahrer mit mindestens ${w.rules.minPulls} Zügen als "ich", auf den Zügen aus Prüfung 2 (Hin und Her als ein Zug), ` +
               `jede Sekunde neu gerechnet: keine Zieher-Erkennung, keine Pausen, anwesend sind die Fahrer, die zwischen meinen letzten ` +
               `beiden Zügen vorne waren. Gewertet ab ${T(w.evalFrom)}` +
               (w.lateRiders.length ? ` (${w.lateRiders.join(', ')} erst ab da aufgezeichnet)` : ` (${w.rules.startSkipS / 60} min nach dem Rollout)`) +
               `, der erste Zug des Rennens nicht. Fehler = vorhergesagter minus echter Start (+ = Uhr sagte später), Median je Blickpunkt; ` +
               `|Fehler| = Median der Beträge über −${w.rules.errLooks.join('/−')} s; zu spät = 10 s vorher sagte die Uhr mehr als ${w.rules.lateS} s später; ` +
               `kleine Sprünge = Schritte ${w.rules.smallJump[0]}…${w.rules.smallJump[1]} s gegen die verstrichene Zeit. ` +
               `Chaos: in den ${w.rules.chaosS} s, in denen die heutige Engine im Replay still ist (Reihenfolge ≠ Plan), hat keine ` +
               'Sicht einen Wert, für beide Modelle.', '');
        L.push(...w.models.map(m => `- **${m.key}**: ${m.label}`), '');
        const rows = [];
        for (const x of w.riders) {
            w.models.forEach((m, j) => {
                const y = x[m.key];
                rows.push([j ? '' : x.who, j ? '' : `${x.pulls} (${y.pulls})`, m.key, ...y.errorAt.map(e => signed(e.medianS)),
                           v(y.absErrorMedianS), `${y.late}/${y.n10}`, y.smallJumps, y.jumps]);
            });
        }
        w.models.forEach((m, j) => {
            const t = w.total[m.key];
            rows.push([j ? '' : '**alle**', j ? '' : `(${t.pulls})`, m.key, '', '', '', '', '',
                       `${v(t.absErrorMedianS)} (alle Werte ${v(t.absErrorAllMedianS)})`, `${t.late}/${t.n10}`, t.smallJumps, t.jumps]);
        });
        L.push(table(['Fahrer', 'Züge (gewertet)', 'Modell', ...w.rules.looks.map(l => `−${l} s`), '|Fehler| s', 'zu spät', 'kleine Sprünge', 'Sprünge ≥ 3 s'], rows));
        L.push('', 'Summe: |Fehler| = Median der Fahrer-Mediane (bei gerader Zahl Mittel der beiden mittleren), in Klammern über alle Werte.');
        return L.join('\n');
    }));
    return parts.join('\n');
}
