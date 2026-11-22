// Schema step 3 (races, 20 Nov 2026): every club in `clubs` and `trash` converted from the 0.3
// shape to races (club.mjs convertClub), in migrate's transaction, after its backup (db.mjs). Only
// through SQL on the connection it is given: nothing here opens paceline.db through fs.
import {convertClub, MAX_CLUB_BYTES} from './club.mjs';

const PREFIX = 'paceline-server: paceline.db: schema 3 (races):';

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);


// The keys of the club's team and sheet entries that are no object (the conversion skips them and
// leaves them as they are; the store's load reports the club as damaged).
function oddEntries(c) {
    const odd = [];
    for (const [slug, team] of Object.entries(c.teams)) {
        if (!isObject(team)) {
            odd.push(`team ${JSON.stringify(slug)}`);
        }
    }
    for (const [id, sheet] of Object.entries(c.sheets)) {
        if (!isObject(sheet)) {
            odd.push(`sheet ${JSON.stringify(id)}`);
        }
    }
    return odd;
}


// Converts every row of `clubs` and `trash`, in the caller's transaction. A row that is no JSON, or
// not club-shaped, is left alone and `warn`ed (the store's load reports a damaged club as today);
// so is one the conversion throws on. Team and sheet entries that are no object stay as they are
// (warned), the rest of their club is converted. A club over MAX_CLUB_BYTES after the conversion is
// written all the same and warned by id. Returns {clubs, trashed}: the rows rewritten; logs their
// count when there were any.
export function racesStep(sql, {now, log = console.log, warn = console.warn}) {
    const counts = {clubs: 0, trashed: 0};
    for (const [table, key, what] of [['clubs', 'clubs', 'club'], ['trash', 'trashed', 'trashed club']]) {
        const update = sql.prepare(`UPDATE ${table} SET json = ? WHERE cid = ?`);
        for (const {cid, json} of sql.prepare(`SELECT cid, json FROM ${table} ORDER BY cid`).all()) {
            let c;
            try {
                c = JSON.parse(json);
            } catch {
                warn(`${PREFIX} ${table} row ${cid} is not JSON; left as it is`);
                continue;
            }
            if (!isObject(c) || !isObject(c.teams) || !isObject(c.sheets)) {
                warn(`${PREFIX} ${table} row ${cid} is not club-shaped; left as it is`);
                continue;
            }
            const odd = oddEntries(c);
            if (odd.length) {
                warn(`${PREFIX} ${table} row ${cid}: ${odd.join(', ')} not objects; left as they are, the rest converted`);
            }
            let changed;
            try {
                changed = convertClub(c, now);
            } catch (e) {
                warn(`${PREFIX} ${table} row ${cid} could not be converted (${e.message}); left as it is`);
                continue;
            }
            if (!changed) {
                continue;
            }
            const text = JSON.stringify(c);
            const bytes = Buffer.byteLength(text);
            if (bytes > MAX_CLUB_BYTES) {
                warn(`${PREFIX} ${what} ${cid} is ${bytes} bytes after the conversion, over the ${MAX_CLUB_BYTES} limit; stored all the same`);
            }
            update.run(text, cid);
            counts[key]++;
        }
    }
    if (counts.clubs + counts.trashed > 0) {
        log(`${PREFIX} ${counts.clubs} clubs and ${counts.trashed} trashed clubs converted`);
    }
    return counts;
}
