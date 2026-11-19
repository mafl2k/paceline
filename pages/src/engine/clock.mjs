// Pure logic (no DOM): the rest countdown as the windows show it. The rotation's clock
// (rotationView's toMyPullS) is re-evaluated every second and corrects itself when reality differs
// from the plan: a pull ends early, a rider drops out or comes back. Shown raw, each correction is a
// jump. Expert panel of 18 Nov 2026 (captain, in-race UX, estimation, rider; user's request: the
// clock should run down and the corrections should not be so hard):
// - the number is always the truth or on its way to it, never a value to add a delta to;
// - small corrections (under SMALL_S) are absorbed: the clock runs CATCH_DOWN times as fast while
//   the pull comes sooner, CATCH_UP times as fast while it comes later (no jump, no label);
// - a big correction snaps: at once when the pull comes sooner; when it comes later only once it
//   has held for UP_HOLD_MS (a flip at the front is undone in that time, so the clock errs early,
//   never late); at once when it takes READY back;
// - after a snap the line under the clock says by how much, for LABEL_MS: with the rider when a
//   rider left or came back ('out' / 'back'), else just the amount; corrections within that time
//   add up, and a net under SMALL_S clears it;
// - near the pull (SNAP_BELOW_S or less) the clock follows the truth exactly, and in READY there is
//   no label (but 'readyOff' when READY is taken back);
// - the standing clock (the puller over his time) is followed exactly: its "≥" explains it.
// Time-based: step it at any rate with the time now; the windows render more often than the engine
// steps.
import {WARN_S} from './rotation.mjs';

export const SMALL_S = 10;
export const SYNC_S = 1.5;          // the rotation's clock moves in whole seconds: this close is in step
export const SNAP_BELOW_S = 15;
export const CATCH_DOWN = 2;
export const CATCH_UP = 0.5;
export const UP_HOLD_MS = 3000;
export const LABEL_MS = 5000;
export const CAUSE_MS = 8000;       // a rider who left or came back this recently explains a snap


export function initialClock() {
    return {shownS: null, at: null, pend: null, label: null, fadeAt: null, present: null, changes: []};
}


// One step. trueS: the rotation's time to my pull (null/undefined: no countdown, which resets);
// standing: the rotation's standing clock; present: the plan riders present now (ids, me left out
// or not; for the cause of a snap). Returns the new state: shownS (seconds, not rounded), label
// {kind: 'out' | 'back' | 'sooner' | 'later' | 'readyOff', deltaS, ids, until} or null, fadeAt
// (the time of the last snap, for the window's fade-in).
export function clockStep(st, {now, trueS, standing = false, present = null}) {
    if (!Number.isFinite(trueS)) {
        return initialClock();
    }
    const s = {...(st || initialClock())};
    s.changes = presenceChanges(s, present, now);
    s.present = present ? [...present] : s.present;
    if (s.shownS === null || s.at === null) {
        return {...s, shownS: trueS, at: now, pend: null, label: null};
    }
    const dt = Math.max(0, (now - s.at) / 1000);
    s.at = Math.max(s.at, now);
    if (s.label && now >= s.label.until) {
        s.label = null;
    }
    const adv = s.shownS - dt;          // where the clock runs to by itself
    const diff = trueS - adv;           // > 0: my pull comes later than shown, < 0: sooner
    if (standing || Math.abs(diff) <= SYNC_S) {
        s.shownS = trueS;
        s.pend = null;
    } else if (Math.abs(diff) < SMALL_S) {
        s.pend = null;
        if (trueS <= SNAP_BELOW_S || adv <= SNAP_BELOW_S) {
            s.shownS = trueS;
        } else if (diff < 0) {
            s.shownS = Math.max(trueS, adv - dt * (CATCH_DOWN - 1));
        } else {
            s.shownS = Math.min(trueS, adv + dt * (1 - CATCH_UP));
        }
    } else if (diff < 0) {
        snap(s, {now, trueS, deltaS: diff});
    } else if (adv <= WARN_S) {
        snap(s, {now, trueS, deltaS: diff, readyOff: true});
    } else {
        s.pend = s.pend ?? {since: now};
        if (now - s.pend.since >= UP_HOLD_MS) {
            snap(s, {now, trueS, deltaS: diff});
        } else {
            s.shownS = adv;
        }
    }
    if (s.label && s.label.kind !== 'readyOff' && s.shownS <= WARN_S) {
        s.label = null;
    }
    return s;
}


function snap(s, {now, trueS, deltaS, readyOff = false}) {
    s.shownS = trueS;
    s.pend = null;
    s.fadeAt = now;
    const prev = s.label && now < s.label.until ? s.label : null;
    const total = (prev && prev.kind !== 'readyOff' ? prev.deltaS : 0) + deltaS;
    if (!readyOff && Math.abs(total) < SMALL_S) {
        s.label = null;
        return;
    }
    // The cause: riders who left (my pull sooner) or came back (later) just now.
    const want = total < 0 ? 'out' : 'back';
    const ids = readyOff ? [] : s.changes.filter(c => c.kind === want && now - c.at <= CAUSE_MS).map(c => c.id);
    const kind = readyOff ? 'readyOff' : ids.length ? want : total < 0 ? 'sooner' : 'later';
    s.label = {kind, deltaS: Math.round(total), ids: [...new Set(ids)], until: now + LABEL_MS};
}


// Riders who left the present set or came into it, with when; older than CAUSE_MS are dropped.
function presenceChanges(s, present, now) {
    const kept = (s.changes || []).filter(c => now - c.at <= CAUSE_MS);
    if (!present || !s.present) {
        return kept;
    }
    const before = new Set(s.present), after = new Set(present);
    for (const id of before) {
        if (!after.has(id)) {
            kept.push({id, kind: 'out', at: now});
        }
    }
    for (const id of after) {
        if (!before.has(id)) {
            kept.push({id, kind: 'back', at: now});
        }
    }
    return kept;
}


// The label's amount as the clock writes times: "−25s", "+1:10" (rounded to whole seconds; the
// minus sign is U+2212).
export function deltaText(deltaS) {
    const a = Math.abs(Math.round(deltaS));
    const t = a < 100 ? `${a}s` : `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
    return (deltaS < 0 ? '−' : '+') + t;
}
