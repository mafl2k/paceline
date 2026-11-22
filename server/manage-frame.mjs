// What the captain frame (ui.mjs captainPage) of club `cid` draws its sidebar with, for every
// captain page, and the text of a ClubError: a leaf of the /manage modules (manage-page.mjs
// re-exports both), so the team cockpit's routes (manage-cockpit.mjs), which manage-page.mjs draws
// refusals with, need no import of it.
import {t, T} from './pages.mjs';


// The clock, the riders seen (the team rows' states) and `others`: the other clubs this browser's
// cookie opens ({id, name}, in its order; ctx.others from handleManage holds their ids), each a switch
// in the footer, which then also has "Log out of <club>" and "Log out of all clubs". A club gone since
// the gate looked is left out.
export function frameOf(ctx, cid) {
    const others = (ctx.others ?? []).map(id => ctx.store.get(id)).filter(Boolean).map(c => ({id: c.id, name: c.name}));
    return {now: ctx.now, seen: ctx.store.seenOf(cid), others};
}


// The page text of a ClubError (T['club-' + code] with its vars).
export function clubErrorText(e) {
    const key = `club-${e.code}`;
    return Object.hasOwn(T, key) ? t(key, e.vars) : String(e.code);
}
