// Client addresses and in-memory rate limits (spec §8). Pure apart from node:net.
import net from 'node:net';


// The X-Forwarded-For entry `hops` from the end (the one the outermost trusted proxy added), else
// the socket address. With hops 0 no proxy is trusted and the header counts for nothing.
export function clientIp(req, hops) {
    const xff = req.headers['x-forwarded-for'];
    if (hops >= 1 && typeof xff === 'string') {
        const entries = xff.split(',');
        if (entries.length >= hops) {
            return entries[entries.length - hops].trim();
        }
    }
    return req.socket?.remoteAddress;
}


// Private, loopback, shared (CGNAT) and link-local ranges; IPv4-mapped IPv6 addresses
// (::ffff:a.b.c.d) are checked against the IPv4 rules by BlockList itself.
const notPublic = new net.BlockList();
for (const [addr, prefix] of [['127.0.0.0', 8], ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16],
    ['169.254.0.0', 16], ['100.64.0.0', 10]]) {
    notPublic.addSubnet(addr, prefix, 'ipv4');
}
for (const [addr, prefix] of [['::1', 128], ['fc00::', 7], ['fe80::', 10]]) {
    notPublic.addSubnet(addr, prefix, 'ipv6');
}


export function isPublicIp(ip) {
    const family = typeof ip === 'string' ? net.isIP(ip) : 0;
    if (family === 0) {
        return false;
    }
    return !notPublic.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}


// Sliding windows per key, e.g. [{ms: 3600000, max: 5}, {ms: 86400000, max: 20}]. A key's hits
// older than the longest window are dropped whenever the key is touched, and sweep(now) drops every
// key with no hit inside the longest window (the server runs it every 10 minutes, so no key outlives
// it by more). Past `maxKeys` keys the least recently counted one goes.
export function makeLimiter(windows, {maxKeys = 10000} = {}) {
    const longest = Math.max(...windows.map(w => w.ms));
    const hits = new Map();   // key -> [ms, ...], oldest first

    function fresh(key, now) {
        const list = hits.get(key);
        if (!list) {
            return [];
        }
        const keep = list.filter(t => now - t < longest);
        if (keep.length) {
            hits.set(key, keep);
        } else {
            hits.delete(key);
        }
        return keep;
    }

    function add(key, now) {
        const list = fresh(key, now);
        list.push(now);
        hits.delete(key);
        hits.set(key, list);
        if (hits.size > maxKeys) {
            hits.delete(hits.keys().next().value);
        }
    }

    function count(key, now, ms) {
        return fresh(key, now).filter(t => now - t < ms).length;
    }

    function allow(key, now) {
        if (windows.some(w => count(key, now, w.ms) >= w.max)) {
            return false;
        }
        add(key, now);
        return true;
    }

    // The keys dropped.
    function sweep(now) {
        let n = 0;
        for (const [key, list] of hits) {
            if (!(now - list[list.length - 1] < longest)) {
                hits.delete(key);
                n++;
            }
        }
        return n;
    }

    return {allow, add, count, sweep, size: () => hits.size};
}


// Sheet uploads in flight on the server: at most one per club and this many in all (manage.mjs).
export const SHEET_UPLOADS_MAX = 8;


// Slots held while something is in flight: one per key, `total` in all. take(key) is 'ok' (the
// slot is yours until release), 'busy' (the key holds one) or 'full' (the total is reached). A
// key that holds a slot is told 'busy' even at the total. release of a key without a slot does
// nothing.
export function makeSlots(total) {
    const held = new Set();

    function take(key) {
        if (held.has(key)) {
            return 'busy';
        }
        if (held.size >= total) {
            return 'full';
        }
        held.add(key);
        return 'ok';
    }

    return {take, release: key => void held.delete(key), busy: key => held.has(key), size: () => held.size};
}
