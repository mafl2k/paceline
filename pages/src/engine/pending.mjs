// Pure logic (no DOM, no Sauce imports): the planner files read so far, so the JSON and the text
// export can arrive one after the other, in either order, or together.
// Pending is {json, text, used}; used = the pair was already imported together as a complete plan.
import {detectFileKind} from './plan.mjs';


export function emptyPending() {
    return {json: null, text: null, used: false};
}


// Merges newly read file texts into the pending files. Returns {pending, error}; error is
// 'unreadable' when a text is neither JSON nor a text export (then pending is returned unchanged).
// A completed pair is never half-reused: a lone new text drops the old JSON, a lone new JSON
// drops the old text, so a different plan's files are not mixed (that would give a wrong plan code).
export function mergePending(pending, texts) {
    const cand = {...pending};
    let sawJson = false;
    let sawText = false;
    for (const t of texts) {
        const kind = detectFileKind(t);
        if (kind === 'json') {
            cand.json = t;
            sawJson = true;
        } else if (kind === 'text') {
            cand.text = t;
            sawText = true;
        } else {
            return {pending, error: 'unreadable'};
        }
    }
    if (pending.used) {
        if (sawJson && !sawText) {
            cand.text = null;
        } else if (sawText && !sawJson) {
            cand.json = null;
        }
    }
    cand.used = false;
    return {pending: cand, error: null};
}


// Call after the merged files imported successfully.
export function markImported(pending) {
    return {...pending, used: pending.json !== null && pending.text !== null};
}
