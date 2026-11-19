// Dates, wall-clock times and time zones. Pure: the clock is always passed in.

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const formatters = new Map();


export function isDate(s) {
    if (typeof s !== 'string' || !DATE_RE.test(s)) {
        return false;
    }
    const [y, m, d] = s.split('-').map(Number);
    if (y < 2000 || y > 2099) {
        return false;
    }
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}


// Any id the runtime knows, including current IANA ids that Intl.supportedValuesOf leaves out
// (Asia/Kolkata, Europe/Kyiv, Etc/UTC, UTC). The guard keeps odd strings away from Intl.
export function isZone(tz) {
    if (typeof tz !== 'string' || tz.length > 64 || !/^[A-Za-z0-9_+\-\/]+$/.test(tz)) {
        return false;
    }
    try {
        new Intl.DateTimeFormat('en-US', {timeZone: tz});
        return true;
    } catch {
        return false;
    }
}


function formatter(tz, key, options) {
    const id = `${key}|${tz}`;
    let f = formatters.get(id);
    if (!f) {
        f = new Intl.DateTimeFormat(options.locale, {...options.fields, timeZone: tz});
        formatters.set(id, f);
    }
    return f;
}


function parts(ms, tz, key, options) {
    const out = {};
    for (const p of formatter(tz, key, options).formatToParts(ms)) {
        out[p.type] = p.value;
    }
    return out;
}


// Minutes east of UTC at the instant `ms`.
export function offsetMin(ms, tz) {
    const p = parts(ms, tz, 'off', {locale: 'en-US', fields: {timeZoneName: 'longOffset'}});
    // Seconds appear for local mean time before the zone's first standard offset (e.g. 1850).
    const m = /^GMT(?:([+\-\u2212])(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(p.timeZoneName);
    if (!m) {
        throw new Error(`no UTC offset for ${tz}`);
    }
    if (!m[1]) {
        return 0;
    }
    const min = Number(m[2]) * 60 + Number(m[3]) + Number(m[4] ?? 0) / 60;
    return m[1] === '+' ? min : -min;
}


// The instant (ms) at which the wall clock in `tz` shows `date` `hhmm`. In a spring-forward gap
// (a wall-clock time that never happens) this gives a real instant about an hour off the
// requested time, never a throw. Which side depends on the zone: Europe/Berlin 02:30 gives 03:30,
// America/New_York 02:30 gives 01:30.
export function zonedToUtc(date, hhmm, tz) {
    const [y, mo, d] = date.split('-').map(Number);
    const [h, mi] = hhmm.split(':').map(Number);
    const guess = Date.UTC(y, mo - 1, d, h, mi);
    const offGuess = offsetMin(guess, tz);
    let utc = guess - offGuess * 60000;
    const off = offsetMin(utc, tz);
    if (off !== offGuess) {
        utc = guess - off * 60000;
    }
    return utc;
}


const DATE_PARTS = {locale: 'en-US', fields: {year: 'numeric', month: '2-digit', day: '2-digit'}};
const TIME_PARTS = {locale: 'en-US', fields: {hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}};
const DAY_PARTS = {locale: 'en-GB', fields: {weekday: 'short', day: 'numeric', month: 'short'}};
const LABEL_PARTS = {
    locale: 'en-GB',
    fields: {weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'},
};


export function localDate(ms, tz) {
    const p = parts(ms, tz, 'date', DATE_PARTS);
    return `${p.year}-${p.month}-${p.day}`;
}


export function localHHMM(ms, tz) {
    const p = parts(ms, tz, 'time', TIME_PARTS);
    return `${p.hour}:${p.minute}`;
}


export function localLabel(ms, tz) {
    const p = parts(ms, tz, 'label', LABEL_PARTS);
    return `${p.weekday} ${p.day} ${p.month} ${p.hour}:${p.minute}`;
}


// 'Thu 19 Nov': the local day of `ms`, as localLabel writes it without the time.
export function localDay(ms, tz) {
    const p = parts(ms, tz, 'day', DAY_PARTS);
    return `${p.weekday} ${p.day} ${p.month}`;
}


export function addDays(date, n) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}


export function dstChangedRecently(tz, now, days = 14) {
    return offsetMin(now, tz) !== offsetMin(now - days * 864e5, tz);
}
