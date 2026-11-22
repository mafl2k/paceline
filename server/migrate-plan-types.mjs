// Schema step 4 (plan types, 21 Nov 2026): in every club in `clubs` and `trash`, every version of a
// plan takes the type of the plan's highest version, and its label (plans.mjs planTypes), in
// migrate's transaction, after its backup (db.mjs). Only through SQL on the connection it is given:
// nothing here opens paceline.db through fs.
import {planTypes} from './plans.mjs';
import {MAX_CLUB_BYTES} from './club.mjs';

const PREFIX = 'paceline-server: paceline.db: schema 4 (plan types):';

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);


// Gives every plan of every row of `clubs` and `trash` one type, in the caller's transaction, as
// migrate-races.mjs racesStep converts them. A row that is no JSON, or not club-shaped, is left alone
// and `warn`ed (the store's load reports a damaged club as today); only a row that changes is
// written. A club over MAX_CLUB_BYTES afterwards is written all the same and warned by id. Returns
// {clubs, trashed}: the rows rewritten; logs their count when there were any.
export function planTypesStep(sql, {now, log = console.log, warn = console.warn}) {
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
            if (!planTypes(c)) {
                continue;
            }
            const text = JSON.stringify(c);
            const bytes = Buffer.byteLength(text);
            if (bytes > MAX_CLUB_BYTES) {
                warn(`${PREFIX} ${what} ${cid} is ${bytes} bytes after the step, over the ${MAX_CLUB_BYTES} limit; stored all the same`);
            }
            update.run(text, cid);
            counts[key]++;
        }
    }
    if (counts.clubs + counts.trashed > 0) {
        log(`${PREFIX} ${counts.clubs} clubs and ${counts.trashed} trashed clubs changed`);
    }
    return counts;
}
