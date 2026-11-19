// The mail queue (spec §8, §11): mail never makes an answer wait, never crashes the process and is
// rate-limited per address and per day. send() only queues; one worker sends one mail at a time.
// Nothing here logs or keeps an address or message text: results are {at, kind, code} only.
import {MailError, isAddress, addressOf, buildMessage, sendMail} from './mail.mjs';
import {makeLimiter} from './limits.mjs';

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
// Mails to one address (lower-cased): 3 per hour, 10 per day.
const ADDRESS_WINDOWS = [{ms: HOUR_MS, max: 3}, {ms: DAY_MS, max: 10}];
// Registration confirmations ('new') have a budget of their own, so a flood of sign-ups cannot use
// up the mail that gets a captain back into their club (and the other way round).
export const NEW_PER_DAY = 50;
// Waits before the 2nd and 3rd attempt; after the 3rd failure the mail is dropped.
export const RETRY_MS = [60000, 300000];
const KEEP_RESULTS = 20;
const BUDGET_KEY = 'all';


// `transport` is sendMail's signature; `schedule(fn, ms)` returns a handle clearTimeout accepts and
// must not keep the process alive.
export function makeMailer({cfg, now, transport = sendMail, schedule = (fn, ms) => setTimeout(fn, ms).unref()}) {
    const perAddress = makeLimiter(ADDRESS_WINDOWS);
    // budget -> {max per day, limiter of one key}
    const budgets = {
        new: {max: NEW_PER_DAY, hits: makeLimiter([{ms: DAY_MS, max: NEW_PER_DAY}])},
        other: {max: cfg.mailMaxPerDay, hits: makeLimiter([{ms: DAY_MS, max: cfg.mailMaxPerDay}])},
    };
    const from = addressOf(cfg.mailFrom);
    const queue = [];        // jobs waiting for the worker
    const waiting = new Set();   // timers of retries
    const log = [];          // newest first
    let busy = false;
    let closed = false;

    function record(kind, code) {
        log.unshift({at: now(), kind, code});
        log.length = Math.min(log.length, KEEP_RESULTS);
    }

    // The reply code or the error kind; anything that is not a MailError is just 'error'.
    function codeOf(e) {
        return e instanceof MailError ? e.code ?? e.kind : 'error';
    }

    function retryLater(job, delay) {
        let timer;
        const fire = () => {
            waiting.delete(timer);
            if (!closed) {
                queue.push(job);
                pump();
            }
        };
        try {
            timer = schedule(fire, delay);
            waiting.add(timer);
        } catch (e) {
            // no way to wait: the mail is dropped
        }
    }

    function failed(job, e) {
        record(job.kind, codeOf(e));
        const permanent = e instanceof MailError && e.kind === 'reply' && e.code !== null && e.code >= 500;
        if (!permanent && !closed && job.attempt <= RETRY_MS.length) {
            retryLater(job, RETRY_MS[job.attempt - 1]);
        }
    }

    // One attempt; resolves whatever happens.
    async function attempt(job) {
        job.attempt++;
        try {
            const r = await transport(cfg.smtp, {from, to: job.to, data: job.data}, {ehlo: cfg.publicHost});
            record(job.kind, r?.code ?? 'error');
        } catch (e) {
            failed(job, e);
        }
    }

    function pump() {
        if (busy || closed || queue.length === 0) {
            return;
        }
        busy = true;
        const job = queue.shift();
        // A throw in the bookkeeping must not leave the worker stuck or reject unhandled.
        attempt(job).catch(() => {}).finally(() => {
            busy = false;
            pump();
        });
    }

    // `html`: an HTML version of `text` (mail-content.mjs), sent as multipart/alternative.
    function send({kind, to, subject, text, html = null, budget}) {
        if (closed || !isAddress(to) || !Object.hasOwn(budgets, budget)) {
            return false;
        }
        let data;
        try {
            data = buildMessage({from: cfg.mailFrom, to, subject, text, html, now: now(), host: cfg.publicHost});
        } catch (e) {
            record(kind, codeOf(e));
            return false;
        }
        const t = now();
        const key = to.toLowerCase();
        // Check every limit first and count only when all pass (a refused mail uses nothing up).
        const allowed = ADDRESS_WINDOWS.every(w => perAddress.count(key, t, w.ms) < w.max)
            && budgets[budget].hits.count(BUDGET_KEY, t, DAY_MS) < budgets[budget].max;
        if (!allowed) {
            return false;
        }
        perAddress.add(key, t);
        budgets[budget].hits.add(BUDGET_KEY, t);
        queue.push({kind, to, data, attempt: 0});
        queueMicrotask(pump);
        return true;
    }

    function close() {
        closed = true;
        queue.length = 0;
        for (const timer of waiting) {
            clearTimeout(timer);
        }
        waiting.clear();
    }

    // Drops limit counters past their windows (addresses kept in memory at most a day); the keys dropped.
    function sweep() {
        const t = now();
        return perAddress.sweep(t) + budgets.new.hits.sweep(t) + budgets.other.hits.sweep(t);
    }

    return {send, results: () => log.map(r => ({...r})), close, sweep};
}
