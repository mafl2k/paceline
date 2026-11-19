// Run with: node --test tests/prefs.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Pr from '../pages/src/engine/prefs.mjs';
import {DEFAULT_SERVER_URL} from '../pages/src/engine/planserver.mjs';


test('normalizePrefs: target unit W/kg by default; a stored unit counts once the rider picked it', () => {
    assert.equal(Pr.normalizePrefs(null).targetUnit, 'Wkg');
    assert.equal(Pr.normalizePrefs('x').targetUnit, 'Wkg');
    assert.equal(Pr.normalizePrefs({}).targetUnit, 'Wkg');
    // Stored before 0.2.17 without the flag: the old default 'W', not a choice.
    assert.equal(Pr.normalizePrefs({targetUnit: 'W'}).targetUnit, 'Wkg');
    assert.equal(Pr.normalizePrefs({targetUnit: 'W', targetUnitSet: true}).targetUnit, 'W');
    assert.equal(Pr.normalizePrefs({targetUnit: 'W', targetUnitSet: true}).targetUnitSet, true);
    assert.equal(Pr.normalizePrefs({targetUnit: 'Wkg', targetUnitSet: true}).targetUnit, 'Wkg');
    assert.equal(Pr.normalizePrefs({targetUnit: 'kW', targetUnitSet: true}).targetUnit, 'Wkg');
    assert.equal(Pr.normalizePrefs({targetUnit: 'kW', targetUnitSet: true}).targetUnitSet, false);
    assert.equal(Pr.normalizePrefs({targetUnit: 'Wkg', junk: 1}).junk, undefined);
});

test('normalizePrefs: plan server defaults and status', () => {
    const d = Pr.normalizePrefs(null);
    assert.equal(d.serverOn, true);
    assert.equal(d.serverUrl, DEFAULT_SERVER_URL);
    assert.equal(d.serverUrlSet, false);
    assert.equal(d.serverEtag, null);
    assert.equal(d.serverCheckedAt, null);
    const p = Pr.normalizePrefs({serverOn: false, serverUrl: ' http://localhost:8790 ', serverUrlSet: true,
                                 serverEtag: '"S91T6D-1"', serverSig: 'S91T6D', serverLabel: 'Rollers fast',
                                 serverClub: 'Kettenfett RC', serverNotice: 'Update Paceline', serverFits: 2,
                                 serverOpensAt: 1763578800000, serverOpensLabel: 'Rollers fast',
                                 serverOkAt: 5, serverError: 'offline', serverCheckedAt: 6});
    assert.deepEqual(p, {targetUnit: 'Wkg', targetUnitSet: false, serverOn: false, serverUrl: 'http://localhost:8790',
                         serverUrlSet: true, serverEtag: '"S91T6D-1"', serverSig: 'S91T6D', serverLabel: 'Rollers fast',
                         serverClub: 'Kettenfett RC', serverNotice: 'Update Paceline', serverFits: 2,
                         serverOpensAt: 1763578800000, serverOpensLabel: 'Rollers fast', serverOkAt: 5,
                         serverError: 'offline', serverCheckedAt: 6, logUpload: false, logUploadSince: null,
                         demoUntil: null, showNext: false, showRotation: false, tttOnly: true,
                         recordWithoutPlan: false});
    const bad = Pr.normalizePrefs({serverOn: 'yes', serverUrl: '  ', serverUrlSet: true, serverEtag: 7,
                                   serverError: 'boom', serverOkAt: 'x'});
    assert.equal(bad.serverOn, true);
    assert.equal(bad.serverUrl, DEFAULT_SERVER_URL);
    assert.equal(bad.serverUrlSet, false);
    assert.equal(bad.serverEtag, null);
    assert.equal(bad.serverError, null);
    assert.equal(bad.serverOkAt, null);
});

test('serverUrlSet: only a typed URL is kept', () => {
    // Without the flag (0.2 stored the URL without it) the default applies, whatever the URL.
    for (const url of ['https://ttt.mafl.net', 'https://ttt.mafl.net/', 'https://other.example.org']) {
        const old = Pr.normalizePrefs({serverUrl: url});
        assert.equal(old.serverUrl, DEFAULT_SERVER_URL, url);
        assert.equal(old.serverUrlSet, false, url);
        assert.equal(Pr.normalizePrefs({serverUrl: url, serverUrlSet: 'yes'}).serverUrlSet, false, url);
    }
    const old = Pr.normalizePrefs({serverUrl: 'https://ttt.mafl.net'});
    const typed = Pr.normalizePrefs({serverUrl: 'https://other.example.org', serverUrlSet: true});
    assert.equal(typed.serverUrl, 'https://other.example.org');
    assert.equal(typed.serverUrlSet, true);
    // The flag says no: the default.
    const unset = Pr.normalizePrefs({serverUrl: 'https://x.example.org', serverUrlSet: false});
    assert.equal(unset.serverUrl, DEFAULT_SERVER_URL);
    assert.equal(unset.serverUrlSet, false);
    // The flag says yes: kept, even for the release URL.
    const set = Pr.normalizePrefs({serverUrl: 'https://x.example.org', serverUrlSet: true});
    assert.equal(set.serverUrl, 'https://x.example.org');
    assert.equal(set.serverUrlSet, true);
    // A store round trip keeps the decision.
    const again = Pr.normalizePrefs(JSON.parse(JSON.stringify(old)));
    assert.equal(again.serverUrl, DEFAULT_SERVER_URL);
    assert.equal(again.serverUrlSet, false);
    assert.equal(Pr.normalizePrefs(JSON.parse(JSON.stringify(typed))).serverUrl, 'https://other.example.org');
});

test('serverConfigChange: a typed URL sets the flag, the default or empty clears it', () => {
    const cur = Pr.normalizePrefs({serverEtag: '"A"', serverSig: 'S91T6D', serverLabel: 'Rollers fast',
                                   serverClub: 'Kettenfett RC', serverNotice: 'n', serverFits: 2, serverOpensAt: 7,
                                   serverOpensLabel: 'Rollers fast', serverOkAt: 5, serverCheckedAt: 6});
    assert.equal(Pr.serverConfigChange(cur, {serverUrl: DEFAULT_SERVER_URL, serverOn: true}), null);
    assert.equal(Pr.serverConfigChange(cur, {serverUrl: `  ${DEFAULT_SERVER_URL}/ `, serverOn: true}), null);
    assert.equal(Pr.serverConfigChange(cur, {serverUrl: ''}), null);    // empty means the default
    const ch = Pr.serverConfigChange(cur, {serverUrl: ' https://other.example.org ', serverOn: true});
    assert.deepEqual(ch, {serverOn: true, serverUrl: 'https://other.example.org', serverUrlSet: true,
                          serverEtag: null, serverSig: null, serverLabel: null, serverClub: null, serverNotice: null,
                          serverFits: null, serverOpensAt: null, serverOpensLabel: null, serverOkAt: null,
                          serverError: null, serverCheckedAt: null});
    const typed = Pr.normalizePrefs({...cur, ...ch});
    assert.equal(Pr.serverConfigChange(typed, {serverUrl: 'https://other.example.org'}), null);
    // Back to the default, by typing it or by emptying the field: the flag goes.
    for (const url of [DEFAULT_SERVER_URL, '  ']) {
        const back = Pr.serverConfigChange(typed, {serverUrl: url});
        assert.equal(back.serverUrl, DEFAULT_SERVER_URL, url);
        assert.equal(back.serverUrlSet, false, url);
    }
    assert.equal(Pr.serverConfigChange(cur, {serverOn: false}).serverOn, false);
    assert.equal(Pr.serverConfigChange(cur, {serverOn: false}).serverUrlSet, false);
    // Switching off keeps a typed URL.
    assert.equal(Pr.serverConfigChange(typed, {serverOn: false}).serverUrl, 'https://other.example.org');
    assert.equal(Pr.serverConfigChange(typed, {serverOn: false}).serverUrlSet, true);
});

test('serverTeam is gone', () => {
    assert.equal('serverTeam' in Pr.normalizePrefs({serverTeam: 'x'}), false);
    assert.equal('serverTeamName' in Pr.normalizePrefs({serverTeamName: 'x'}), false);
    assert.equal('serverTeam' in Pr.defaultPrefs(), false);
    assert.equal('serverTeamName' in Pr.defaultPrefs(), false);
});

test('normalizePrefs: the new status fields', () => {
    const d = Pr.defaultPrefs();
    for (const k of ['serverNotice', 'serverLabel', 'serverClub', 'serverOpensLabel', 'serverFits', 'serverOpensAt']) {
        assert.equal(d[k], null, k);
    }
    for (const k of ['serverNotice', 'serverLabel', 'serverClub', 'serverOpensLabel']) {
        assert.equal(Pr.normalizePrefs({[k]: 'Rollers fast'})[k], 'Rollers fast', k);
        for (const v of [3, null, {}, [], true, '']) {
            assert.equal(Pr.normalizePrefs({[k]: v})[k], null, `${k} ${JSON.stringify(v)}`);
        }
    }
    for (const k of ['serverFits', 'serverOpensAt']) {
        assert.equal(Pr.normalizePrefs({[k]: 2})[k], 2, k);
        for (const v of ['2', NaN, Infinity, null, {}, []]) {
            assert.equal(Pr.normalizePrefs({[k]: v})[k], null, `${k} ${String(v)}`);
        }
    }
});

test('normalizePrefs: recording upload is off by default, true kept, non-booleans ignored', () => {
    assert.equal(Pr.normalizePrefs(null).logUpload, false);
    assert.equal(Pr.normalizePrefs({}).logUpload, false);
    assert.equal(Pr.normalizePrefs({logUpload: true}).logUpload, true);
    assert.equal(Pr.normalizePrefs({logUpload: false}).logUpload, false);
    for (const v of ['true', 1, null, {}, []]) {
        assert.equal(Pr.normalizePrefs({logUpload: v}).logUpload, false, JSON.stringify(v));
    }
    // a server change keeps the choice
    const cur = Pr.normalizePrefs({logUpload: true});
    assert.equal(Object.hasOwn(Pr.serverConfigChange(cur, {serverUrl: 'https://other.example.org'}), 'logUpload'), false);
});

test('normalizePrefs: logUploadSince is a time while upload is on, null otherwise', () => {
    assert.equal(Pr.normalizePrefs(null).logUploadSince, null);
    assert.equal(Pr.normalizePrefs({logUpload: true}).logUploadSince, null);
    assert.equal(Pr.normalizePrefs({logUpload: true, logUploadSince: 1731400000000}).logUploadSince, 1731400000000);
    assert.equal(Pr.normalizePrefs({logUpload: false, logUploadSince: 1731400000000}).logUploadSince, null);
    assert.equal(Pr.normalizePrefs({logUploadSince: 1731400000000}).logUploadSince, null);
    for (const v of ['1731400000000', NaN, Infinity, null, {}, []]) {
        assert.equal(Pr.normalizePrefs({logUpload: true, logUploadSince: v}).logUploadSince, null, String(v));
    }
    // a server change keeps it
    const cur = Pr.normalizePrefs({logUpload: true, logUploadSince: 5});
    assert.equal(Object.hasOwn(Pr.serverConfigChange(cur, {serverUrl: 'https://other.example.org'}), 'logUploadSince'), false);
});

test('logUploadChange: ticking keeps the time, unticking clears it', () => {
    assert.deepEqual(Pr.logUploadChange(true, 1731400000000), {logUpload: true, logUploadSince: 1731400000000});
    assert.deepEqual(Pr.logUploadChange(false, 1731400000000), {logUpload: false, logUploadSince: null});
    const on = Pr.normalizePrefs({...Pr.defaultPrefs(), ...Pr.logUploadChange(true, 7)});
    assert.equal(on.logUpload, true);
    assert.equal(on.logUploadSince, 7);
    const off = Pr.normalizePrefs({...on, ...Pr.logUploadChange(false, 8)});
    assert.equal(off.logUpload, false);
    assert.equal(off.logUploadSince, null);
});

test('logUploadSinceFix: a box ticked under 0.2.1 counts from now', () => {
    assert.deepEqual(Pr.logUploadSinceFix(Pr.normalizePrefs({logUpload: true}), 9), {logUploadSince: 9});
    assert.equal(Pr.logUploadSinceFix(Pr.normalizePrefs({logUpload: true, logUploadSince: 5}), 9), null);
    assert.equal(Pr.logUploadSinceFix(Pr.normalizePrefs({logUpload: false}), 9), null);
});


test('normalizePrefs: demoUntil is a time or null', () => {
    assert.equal(Pr.defaultPrefs().demoUntil, null);
    assert.equal(Pr.normalizePrefs({demoUntil: 1234}).demoUntil, 1234);
    assert.equal(Pr.normalizePrefs({demoUntil: 'soon'}).demoUntil, null);
    assert.equal(Pr.normalizePrefs({demoUntil: NaN}).demoUntil, null);
});


test('demoChange and demoOn: the demo runs DEMO_MS from the click, stop ends it', () => {
    assert.equal(Pr.DEMO_MS, 10 * 60 * 1000);
    const on = Pr.normalizePrefs(Pr.demoChange(true, 1000));
    assert.equal(on.demoUntil, 1000 + Pr.DEMO_MS);
    assert.equal(Pr.demoOn(on, 1000), true);
    assert.equal(Pr.demoOn(on, 1000 + Pr.DEMO_MS - 1), true);
    assert.equal(Pr.demoOn(on, 1000 + Pr.DEMO_MS), false);
    assert.equal(Pr.demoOn(Pr.normalizePrefs(Pr.demoChange(false, 1000)), 1000), false);
    assert.equal(Pr.demoOn(Pr.defaultPrefs(), 1000), false);
    // A clock set back must not leave the demo on for hours.
    assert.equal(Pr.demoOn({demoUntil: 1000 + Pr.DEMO_MS + 1}, 1000), false);
});


test('normalizePrefs: no restInAction pref (the Rest window decides); an old stored value is dropped', () => {
    assert.equal('restInAction' in Pr.defaultPrefs(), false);
    assert.equal('restInAction' in Pr.normalizePrefs({restInAction: false}), false);
    assert.equal('restInAction' in Pr.normalizePrefs({restInAction: true}), false);
});


test('normalizePrefs: showNext (captain line) is off by default, booleans kept', () => {
    assert.equal(Pr.defaultPrefs().showNext, false);
    assert.equal(Pr.normalizePrefs({showNext: true}).showNext, true);
    assert.equal(Pr.normalizePrefs({showNext: 'yes'}).showNext, false);
});
