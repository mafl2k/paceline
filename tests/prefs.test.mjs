// Run with: node --test tests/prefs.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Pr from '../pages/src/engine/prefs.mjs';


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
    assert.equal(d.serverUrl, 'https://ttt.mafl.net');
    assert.equal(d.serverTeam, '');
    assert.equal(d.serverEtag, null);
    assert.equal(d.serverCheckedAt, null);
    const p = Pr.normalizePrefs({serverOn: false, serverUrl: ' http://localhost:8790 ', serverTeam: '  TTT   Rollers ',
                                 serverEtag: '"S91T6D-1"', serverTeamName: 'Rollers', serverSig: 'S91T6D',
                                 serverOkAt: 5, serverError: 'offline', serverCheckedAt: 6});
    assert.deepEqual(p, {targetUnit: 'Wkg', targetUnitSet: false, serverOn: false, serverUrl: 'http://localhost:8790', serverTeam: 'TTT Rollers',
                         serverEtag: '"S91T6D-1"', serverTeamName: 'Rollers', serverSig: 'S91T6D', serverOkAt: 5,
                         serverError: 'offline', serverCheckedAt: 6, logUpload: false, logUploadSince: null,
                         demoUntil: null, showNext: false, restInAction: true, showRotation: false, tttOnly: true,
                         recordWithoutPlan: false});
    const bad = Pr.normalizePrefs({serverOn: 'yes', serverUrl: '  ', serverTeam: 3, serverEtag: 7, serverError: 'boom',
                                   serverOkAt: 'x'});
    assert.equal(bad.serverOn, true);
    assert.equal(bad.serverUrl, 'https://ttt.mafl.net');
    assert.equal(bad.serverTeam, '');
    assert.equal(bad.serverEtag, null);
    assert.equal(bad.serverError, null);
    assert.equal(bad.serverOkAt, null);
});

test('serverConfigChange: a new team or server starts over, no change gives null', () => {
    const cur = Pr.normalizePrefs({serverTeam: 'Rollers', serverEtag: '"A"', serverSig: 'S91T6D',
                                   serverTeamName: 'Rollers', serverOkAt: 5, serverCheckedAt: 6});
    assert.equal(Pr.serverConfigChange(cur, {serverTeam: ' Rollers ', serverUrl: 'https://ttt.mafl.net',
                                             serverOn: true}), null);
    const ch = Pr.serverConfigChange(cur, {serverTeam: 'Others'});
    assert.deepEqual(ch, {serverOn: true, serverUrl: 'https://ttt.mafl.net', serverTeam: 'Others', serverEtag: null,
                          serverTeamName: null, serverSig: null, serverOkAt: null, serverError: null,
                          serverCheckedAt: null});
    assert.equal(Pr.serverConfigChange(cur, {serverOn: false}).serverOn, false);
    assert.equal(Pr.serverConfigChange(cur, {serverUrl: ''}), null);    // empty means the default
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
    assert.equal(Object.hasOwn(Pr.serverConfigChange(cur, {serverTeam: 'Others'}), 'logUpload'), false);
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
    assert.equal(Object.hasOwn(Pr.serverConfigChange(cur, {serverTeam: 'Others'}), 'logUploadSince'), false);
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


test('normalizePrefs: restInAction (countdown in the Action window) is on by default, booleans kept', () => {
    assert.equal(Pr.defaultPrefs().restInAction, true);
    assert.equal(Pr.normalizePrefs({restInAction: false}).restInAction, false);
    assert.equal(Pr.normalizePrefs({restInAction: 'no'}).restInAction, true);
});


test('normalizePrefs: showNext (captain line) is off by default, booleans kept', () => {
    assert.equal(Pr.defaultPrefs().showNext, false);
    assert.equal(Pr.normalizePrefs({showNext: true}).showNext, true);
    assert.equal(Pr.normalizePrefs({showNext: 'yes'}).showNext, false);
});
