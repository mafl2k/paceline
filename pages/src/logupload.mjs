// Browser side of the recording upload (see engine/logupload.mjs): read one session from
// IndexedDB, cut it down with stripForUpload (no heart rate, cadence, plan weight/FTP or
// outsiders), gzip it and POST it to the plan server, then note the outcome on the session row. Used by the overlay's sweep and by the Upload button in settings.
import {logUploadUrl, uploadError, stripForUpload} from './engine/logupload.mjs';
import {exportSession, markUpload} from './recdb.mjs';
import {VERSION} from './version.mjs';

export const UPLOAD_TIMEOUT_MS = 60000;


async function gzip(text) {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Response(stream).blob();
}


// {ok: true} or {ok: false, error}. error is an uploadError kind ('offline', 'forbidden',
// 'notfound', 'exists', 'refused', 'toolarge', 'full', 'http'), 'local' when the recording could
// not be read or packed here (then `cause` holds the exception), or 'badurl' when the URL cannot be built (nothing is noted on the
// row then: it is a settings problem, or no club to send it to, not this recording's). slug and
// circle: the recording's target (sessionTarget). Sends this build's VERSION as `mod`. Throws only
// when the row cannot be updated.
export async function uploadSession(sessionId, {url, slug, circle, athleteId, now = Date.now()}) {
    const target = logUploadUrl({url, slug, circle, sessionId, athleteId, mod: VERSION});
    if (!target) {
        return {ok: false, error: 'badurl'};
    }
    let body;
    try {
        body = await gzip(stripForUpload(await exportSession(sessionId)));
    } catch(e) {
        await markUpload(sessionId, {uploadTriedAt: now, uploadError: 'local'});
        return {ok: false, error: 'local', cause: e};
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), UPLOAD_TIMEOUT_MS);
    let status = null;
    try {
        const res = await fetch(target, {
            method: 'POST',
            headers: {'Content-Type': 'application/gzip'},
            body,
            signal: ctl.signal,
        });
        status = res.status;
    } catch(e) {
        status = null;    // no answer or timed out: not reachable
    } finally {
        clearTimeout(timer);
    }
    const error = uploadError(status);
    if (error === null) {
        await markUpload(sessionId, {uploadedAt: now});
        return {ok: true};
    }
    await markUpload(sessionId, {uploadTriedAt: now, uploadError: error});
    return {ok: false, error};
}
