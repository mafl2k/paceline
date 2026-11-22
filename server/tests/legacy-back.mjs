// club.mjs backTo as 0.4.0-beta.1 ran it (eb9c820), frozen: the oracle of the Restore and Make live equivalence test. Never edit.
import {SHEET_RE, isSlug} from '../ids.mjs';
import {raceOver} from '../select.mjs';
import {raceOf} from '../races.mjs';
import {planOfId, planLabel, rememberType, freeVersionId} from '../plans.mjs';
import {ClubError, addLog, MAX_VERSIONS, isShare} from '../club.mjs';

const iso = ms => new Date(ms).toISOString();


function teamOf(club, slug) {
    if (!isSlug(slug) || !Object.hasOwn(club.teams, slug)) {
        throw new ClubError('not-found');
    }
    return club.teams[slug];
}


function bump(team, now) {
    team.version++;
    team.changedAt = iso(now);
}


// Bumps the team's version and logs the change `what` with `label`.
function changed(club, slug, team, now, what, label) {
    bump(team, now);
    addLog(club, {at: iso(now), what, team: slug, label});
}


// The cap of versions per plan for a new version of `plan` (labelled `label`): with MAX_VERSIONS
// stored, the lowest version that is not live goes. {dropped, dropIds}.
function versionCap(plan, label) {
    if (plan.versions.length < MAX_VERSIONS) {
        return {dropped: null, dropIds: []};
    }
    const [vid, v] = plan.versions.find(([i]) => i !== plan.live);
    return {dropped: {kind: 'version', n: v.n, label}, dropIds: [vid]};
}


// What Undo of a change of a race's live plan needs (UI panel wave 2, team-view.mjs undoOffer), kept
// on the team after the change bumped its version: team.liveBefore = {id, version, at}, the version
// that was live in that race before and the team's version right after the change (one record per
// team: Undo reads the race of `id`). Any later change of the team bumps its version, so Undo is
// offered only while nothing changed since. Nothing (and an older record goes) when the race had no
// live version before, it is gone, or `undo` is false. Additive: a club stored without it loads
// unchanged.
function rememberLive(club, team, race, prev, undo, now) {
    if (undo && race !== null && typeof prev === 'string' && prev !== race.live && Object.hasOwn(club.sheets, prev)) {
        team.liveBefore = {id: prev, version: team.version, at: iso(now)};
    } else {
        delete team.liveBefore;
    }
}


// Restore vN ("Back to vN" in plan versions §8): a new version of plan `plan` (any of its ids)
// with version `n`'s JSON, text and sig, `via: 'back'`, `copyOf: n`, `at` now and vN's upload time (O4). The type stays
// the plan's current one; the race keeps its start time and event link. It goes live at once when the
// plan is live (its race's live plan: the team's other races keep theirs), and counts against
// MAX_VERSIONS. `version` is the team's version the page was drawn with. Checks, in this order: the
// version (`changed`), the plan (`not-found`), a plan of a race that is over (`plan-used`, races spec
// §2), and `n`: a stored version that is not the newest (`not-found`). Returns {id, planId, n, from,
// live, dropped}.
export function backTo(club, slug, {plan, n, version}, {now, newId}) {
    const team = teamOf(club, slug);
    if (Number(version) !== team.version) {
        throw new ClubError('changed');
    }
    const p = typeof plan === 'string' && SHEET_RE.test(plan) ? planOfId(club, slug, plan) : null;
    if (p === null) {
        throw new ClubError('not-found');
    }
    if (raceOver(club, slug, p.date, now)) {
        throw new ClubError('plan-used', {label: p.label});
    }
    const from = Number(n);
    const entry = p.versions.find(([, v]) => v.n === from);
    if (!entry || from === p.newest[1].n) {
        throw new ClubError('not-found');
    }
    const old = entry[1];
    const type = p.type;
    const label = planLabel(team.name, type);
    const {dropped, dropIds} = versionCap(p, label);
    const id = freeVersionId(club, newId);
    const k = p.newest[1].n + 1;
    // read vN before the cap may drop it
    const json = structuredClone(old.json);
    const text = structuredClone(old.text ?? null);
    for (const vid of dropIds) {
        delete club.sheets[vid];
    }
    club.sheets[id] = {
        team: slug, label, date: p.date, sig: old.sig, json, text,
        uploadedAt: old.uploadedAt, via: 'back',
        plan: p.id, n: k, at: iso(now), copyOf: from, jsonName: old.jsonName ?? null, type, recSig: old.sig,
        ...(isShare(old.zgShare) ? {zgShare: old.zgShare} : {}),
    };
    const race = raceOf(club, slug, p.date);
    const prev = race?.live ?? null;
    if (p.live !== null && race !== null) {
        race.live = id;
    }
    rememberType(team, type);
    changed(club, slug, team, now, 'back', `${label} v${from} → v${k}`);
    rememberLive(club, team, race, prev, p.live !== null, now);
    return {id, planId: p.id, n: k, from, live: race?.live === id, dropped};
}
