// Small helpers for the ride report: statistics and formatting. Pure, no imports.

// Median (the lower one of an even count, as the session scripts did), NaN when empty.
export function median(xs) {
    const s = (xs || []).filter(Number.isFinite).sort((a, b) => a - b);
    return s.length ? s[(s.length - 1) >> 1] : NaN;
}


// Quantile p (0..1) by the nearest lower rank, NaN when empty.
export function quantile(xs, p) {
    const s = (xs || []).filter(Number.isFinite).sort((a, b) => a - b);
    return s.length ? s[Math.floor(p * (s.length - 1))] : NaN;
}


export function sum(xs) {
    return (xs || []).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
}


// A number for the report: rounded to `d` decimals, null when not finite (JSON has no NaN).
export function num(x, d = 0) {
    if (!Number.isFinite(x)) {
        return null;
    }
    const f = 10 ** d;
    return Math.round(x * f) / f;
}


// A number as text with a sign: "+3", "-2", "0"; "–" when missing.
export function signed(x, d = 0) {
    if (!Number.isFinite(x)) {
        return '–';
    }
    const v = num(x, d);
    return v > 0 ? `+${v.toFixed(d)}` : v.toFixed(d);
}


// A number as text, "–" when missing.
export function txt(x, d = 0) {
    return Number.isFinite(x) ? num(x, d).toFixed(d) : '–';
}


// Percent of a part, "–" without a whole.
export function pct(part, whole) {
    return whole > 0 ? Math.round(100 * part / whole) : null;
}


// UTC clock time of a timestamp: "18:54:13".
export function clockUtc(ts) {
    return Number.isFinite(ts) ? new Date(ts).toISOString().slice(11, 19) : '–';
}


// Race time relative to t0 (ms): "+17:58", "-0:42", "+1:02:03".
export function raceTime(ts, t0) {
    if (!Number.isFinite(ts) || !Number.isFinite(t0)) {
        return '–';
    }
    let s = Math.round((ts - t0) / 1000);
    const sign = s < 0 ? '-' : '+';
    s = Math.abs(s);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h ? `${sign}${h}:${String(m).padStart(2, '0')}:${sec}` : `${sign}${m}:${sec}`;
}


// Seconds as "1:05" (or "45 s" below a minute).
export function dur(s) {
    if (!Number.isFinite(s)) {
        return '–';
    }
    const r = Math.round(s);
    return r < 60 ? `${r} s` : `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')} min`;
}


// Runs of consecutive items with the same key (key null: no run). Returns [{key, from, to}] with
// indices into xs (inclusive).
export function runs(xs, keyOf) {
    const out = [];
    let cur = null;
    xs.forEach((x, i) => {
        const k = keyOf(x, i);
        if (cur && k === cur.key) {
            cur.to = i;
            return;
        }
        if (cur) {
            out.push(cur);
        }
        cur = k === null || k === undefined ? null : {key: k, from: i, to: i};
    });
    if (cur) {
        out.push(cur);
    }
    return out;
}
