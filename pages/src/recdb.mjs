// IndexedDB store for TTT recordings: raw ticks plus one meta row per session.
// Sessions are created by the overlay via saveSessionMeta(); exportSession() gives the JSONL file.
import {toJsonl} from './engine/recording.mjs';
import {REC_MARK_KEY} from './store.mjs';

const DB_NAME = 'paceline-rec';
const TICKS = 'ticks';
const SESSIONS = 'sessions';

let dbPromise = null;


function openDb() {
    if (!dbPromise) {
        let settled = false;
        const p = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                const ticks = db.createObjectStore(TICKS, {autoIncrement: true});
                ticks.createIndex('session', 'session');
                db.createObjectStore(SESSIONS, {keyPath: 'sessionId'});
            };
            req.onsuccess = () => {
                const db = req.result;
                if (settled) {
                    db.close();    // we gave up on this open (blocked); the next call opens again
                    return;
                }
                settled = true;
                // Another page wants to upgrade or delete the database: let it, and reopen on the
                // next call instead of holding everyone up.
                db.onversionchange = () => {
                    db.close();
                    forget(p);
                };
                db.onclose = () => forget(p);    // closed by the browser (e.g. storage cleared)
                resolve(db);
            };
            req.onerror = () => {
                settled = true;
                reject(req.error);
            };
            req.onblocked = () => {
                console.error('Paceline: recording database is blocked by another window');
                settled = true;
                reject(new Error('IndexedDB open blocked'));
            };
        });
        p.catch(() => forget(p));    // allow a retry on the next call
        dbPromise = p;
    }
    return dbPromise;
}


function forget(p) {
    if (dbPromise === p) {
        dbPromise = null;
    }
}


function wrap(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}


function done(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}


export async function addTick(sessionId, tick) {
    const db = await openDb();
    const tx = db.transaction(TICKS, 'readwrite');
    tx.objectStore(TICKS).add({session: sessionId, ...tick});
    return done(tx);
}


export async function saveSessionMeta(sessionId, meta) {
    const db = await openDb();
    const tx = db.transaction(SESSIONS, 'readwrite');
    tx.objectStore(SESSIONS).put({...meta, sessionId});
    return done(tx);
}


// Merges `fields` ({uploadedAt} or {uploadTriedAt, uploadError}) into a session row; a row that is
// gone (deleted meanwhile) stays gone. Then bumps REC_MARK_KEY, so the settings window (another
// window: the storage event) shows the new state within a second (final review, 21 Nov 2026, I-2).
export async function markUpload(sessionId, fields) {
    const db = await openDb();
    const tx = db.transaction(SESSIONS, 'readwrite');
    const store = tx.objectStore(SESSIONS);
    const done_ = done(tx);
    const req = store.get(sessionId);
    req.onsuccess = () => {
        if (req.result) {
            store.put({...req.result, ...fields, sessionId});
        }
    };
    await done_;
    try {
        localStorage.setItem(REC_MARK_KEY, JSON.stringify({sessionId: String(sessionId), at: Date.now()}));
    } catch(e) {
        // No storage: the list catches up on focus.
    }
}


function startOf(row) {
    return Number.isFinite(row.startedAt) ? row.startedAt : Number(row.sessionId);
}


// Newest first.
export async function listSessions() {
    const db = await openDb();
    const tx = db.transaction([SESSIONS, TICKS], 'readonly');
    const rows = await wrap(tx.objectStore(SESSIONS).getAll());
    const index = tx.objectStore(TICKS).index('session');
    const out = await Promise.all(rows.map(async row => {
        const {sessionId, ...meta} = row;
        return {sessionId, meta, ticks: await wrap(index.count(sessionId))};
    }));
    return out.sort((a, b) => startOf({...b.meta, sessionId: b.sessionId}) - startOf({...a.meta, sessionId: a.sessionId}));
}


export async function exportSession(sessionId) {
    const db = await openDb();
    const tx = db.transaction([SESSIONS, TICKS], 'readonly');
    const row = await wrap(tx.objectStore(SESSIONS).get(sessionId));
    const rows = await wrap(tx.objectStore(TICKS).index('session').getAll(sessionId));
    // Index getAll is ordered by index key, then primary key: insertion order within a session.
    const ticks = rows.map(({session, ...tick}) => tick);
    const {sessionId: _id, ...meta} = row || {};
    return toJsonl({sessionId, ...meta}, ticks);
}


export async function deleteSession(sessionId) {
    const db = await openDb();
    const tx = db.transaction([SESSIONS, TICKS], 'readwrite');
    const done_ = done(tx);
    tx.objectStore(SESSIONS).delete(sessionId);
    const index = tx.objectStore(TICKS).index('session');
    const cursorReq = index.openKeyCursor(IDBKeyRange.only(sessionId));
    cursorReq.onsuccess = () => {
        const cur = cursorReq.result;
        if (cur) {
            tx.objectStore(TICKS).delete(cur.primaryKey);
            cur.continue();
        }
    };
    return done_;
}


// Keep the `keep` newest sessions, and drop anything that started more than maxAgeMs ago.
export async function prune({keep = 20, maxAgeMs = 14 * 864e5} = {}) {
    const sessions = await listSessions();
    const now = Date.now();
    const doomed = sessions.filter((s, i) =>
        i >= keep || now - startOf({...s.meta, sessionId: s.sessionId}) > maxAgeMs);
    for (const s of doomed) {
        await deleteSession(s.sessionId);
    }
    return doomed.length;
}
