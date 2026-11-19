// Run with: node --test server/tests/mailer.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readConfig} from '../config.mjs';
import {MailError} from '../mail.mjs';
import {makeMailer} from '../mailer.mjs';

const START = Date.parse('2026-11-19T18:30:05Z');
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const config = (over = {}) => readConfig({
    DATA_DIR: '/tmp/paceline-mailer-test', SMTP_HOST: 'smtp.example.org',
    MAIL_FROM: 'Paceline <paceline@example.org>', PUBLIC_URL: 'https://ttt-beta.example.org', ...over,
});

const settle = async () => {
    for (let i = 0; i < 10; i++) {
        await new Promise(r => setImmediate(r));
    }
};

// A transport that records its calls and answers from `script` (one entry per call; the last one
// repeats): a number is the accepted reply code, a function is called and may throw or return a Promise.
function fakeTransport(script = [250]) {
    const calls = [];
    const transport = (smtp, envelope, options) => {
        calls.push({smtp, envelope, options});
        const step = script[Math.min(calls.length - 1, script.length - 1)];
        if (typeof step === 'function') {
            return step();
        }
        return Promise.resolve({code: step});
    };
    return {transport, calls};
}

// schedule records [fn, ms]; the test fires the functions itself.
function fakeSchedule() {
    const scheduled = [];
    const schedule = (fn, ms) => {
        scheduled.push([fn, ms]);
        return scheduled.length;
    };
    return {schedule, scheduled, delays: () => scheduled.map(([, ms]) => ms)};
}

function setup({script, env, clock = {now: START}} = {}) {
    const t = fakeTransport(script);
    const s = fakeSchedule();
    const mailer = makeMailer({cfg: config(env), now: () => clock.now, transport: t.transport, schedule: s.schedule});
    return {mailer, clock, ...t, ...s};
}

const mail = (over = {}) => ({
    kind: 'new-link', to: 'captain@example.org', subject: 'Paceline: new link for Kettenfett RC',
    text: 'Hello.\nOpening it ends the old link.\n', budget: 'other', ...over,
});

const reply = code => () => Promise.reject(new MailError('reply', code));


test('queued mail is sent with a built message', async () => {
    const {mailer, calls} = setup();
    assert.equal(mailer.send(mail()), true);
    await settle();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].envelope.to, 'captain@example.org');
    assert.equal(calls[0].envelope.from, 'paceline@example.org');
    assert.match(calls[0].envelope.data, /^Subject: Paceline: new link for Kettenfett RC\r$/m);
    assert.match(calls[0].envelope.data, /^From: Paceline <paceline@example\.org>\r$/m);
    assert.match(calls[0].envelope.data, /@ttt-beta\.example\.org>\r$/m);   // Message-ID host
    assert.equal(calls[0].options.ehlo, 'ttt-beta.example.org');
    assert.equal(calls[0].smtp.host, 'smtp.example.org');
    assert.deepEqual(mailer.results(), [{at: START, kind: 'new-link', code: 250}]);
    mailer.close();
});


test('send does not wait for the transport', async () => {
    const {mailer, calls} = setup({script: [() => new Promise(() => {})]});
    assert.equal(mailer.send(mail()), true);
    assert.equal(mailer.send(mail({to: 'cleo@example.org'})), true);
    await settle();
    assert.equal(calls.length, 1, 'one mail at a time: the second waits for the first');
    assert.deepEqual(mailer.results(), []);
    mailer.close();
});


test('mails go out one at a time, in order', async () => {
    let release;
    const {mailer, calls} = setup({script: [
        () => new Promise(r => { release = () => r({code: 250}); }),
        250,
    ]});
    mailer.send(mail({kind: 'a', to: 'ben@example.org'}));
    mailer.send(mail({kind: 'b', to: 'cleo@example.org'}));
    await settle();
    assert.deepEqual(calls.map(c => c.envelope.to), ['ben@example.org']);
    release();
    await settle();
    assert.deepEqual(calls.map(c => c.envelope.to), ['ben@example.org', 'cleo@example.org']);
    assert.deepEqual(mailer.results().map(r => r.kind), ['b', 'a'], 'newest first');
    mailer.close();
});


test('retries: 4xx and network twice, 5xx never', async () => {
    for (const [error, code] of [[new MailError('reply', 451), 451], [new MailError('network'), 'network'],
        [new MailError('timeout'), 'timeout']]) {
        const {mailer, calls, scheduled, delays} = setup({script: [() => Promise.reject(error)]});
        assert.equal(mailer.send(mail()), true);
        await settle();
        assert.equal(calls.length, 1);
        assert.deepEqual(delays(), [60000]);
        scheduled[0][0]();
        await settle();
        assert.equal(calls.length, 2);
        assert.deepEqual(delays(), [60000, 300000]);
        scheduled[1][0]();
        await settle();
        assert.equal(calls.length, 3);
        assert.deepEqual(delays(), [60000, 300000], 'given up after the third failure');
        assert.deepEqual(mailer.results().map(r => r.code), [code, code, code], String(code));
        mailer.close();
    }
    // a retry that goes through ends the story
    const {mailer, calls, scheduled} = setup({script: [reply(451), 250]});
    mailer.send(mail());
    await settle();
    scheduled[0][0]();
    await settle();
    assert.equal(calls.length, 2);
    assert.equal(scheduled.length, 1);
    assert.deepEqual(mailer.results().map(r => r.code), [250, 451]);
    mailer.close();
});


test('a 5xx reply is final', async () => {
    const {mailer, calls, scheduled} = setup({script: [reply(550)]});
    assert.equal(mailer.send(mail()), true);
    await settle();
    assert.equal(calls.length, 1);
    assert.equal(scheduled.length, 0);
    assert.deepEqual(mailer.results(), [{at: START, kind: 'new-link', code: 550}]);
    // reply without a code (AUTH not offered) is not a 5xx: it is retried
    const b = setup({script: [reply(null)]});
    b.mailer.send(mail());
    await settle();
    assert.deepEqual(b.delays(), [60000]);
    assert.equal(b.mailer.results()[0].code, 'reply');
    mailer.close();
    b.mailer.close();
});


test('a waiting retry does not hold up the next mail', async () => {
    const {mailer, calls, scheduled} = setup({script: [reply(451), 250]});
    mailer.send(mail({to: 'ben@example.org'}));
    mailer.send(mail({to: 'cleo@example.org'}));
    await settle();
    assert.deepEqual(calls.map(c => c.envelope.to), ['ben@example.org', 'cleo@example.org']);
    assert.equal(scheduled.length, 1);
    mailer.close();
});


test('budgets', () => {
    const a = setup();
    for (let i = 0; i < 50; i++) {
        assert.equal(a.mailer.send(mail({budget: 'new', to: `rider${i}@example.org`})), true, `mail ${i}`);
    }
    assert.equal(a.mailer.send(mail({budget: 'new', to: 'rider50@example.org'})), false, 'the 51st');
    assert.equal(a.mailer.send(mail({budget: 'other', to: 'rider50@example.org'})), true, 'other is counted apart');
    a.clock.now += DAY;
    assert.equal(a.mailer.send(mail({budget: 'new', to: 'rider51@example.org'})), true, 'a day later');
    a.mailer.close();

    const b = setup({env: {MAIL_MAX_PER_DAY: '3'}});
    for (let i = 0; i < 3; i++) {
        assert.equal(b.mailer.send(mail({to: `rider${i}@example.org`})), true);
    }
    assert.equal(b.mailer.send(mail({to: 'rider3@example.org'})), false, 'the 4th other');
    assert.equal(b.mailer.send(mail({to: 'rider4@example.org', budget: 'new'})), true, 'new still works');
    b.mailer.close();

    const c = setup({env: {MAIL_MAX_PER_DAY: '0'}});
    assert.equal(c.mailer.send(mail()), false, '0 means no other mail');
    assert.equal(c.mailer.send(mail({budget: 'new'})), true);
    c.mailer.close();
});


test('per address: 3 an hour, 10 a day, any letter case', () => {
    const {mailer, clock} = setup();
    assert.equal(mailer.send(mail({to: 'captain@example.org'})), true);
    assert.equal(mailer.send(mail({to: 'Captain@Example.org'})), true);
    assert.equal(mailer.send(mail({to: 'CAPTAIN@example.org'})), true);
    assert.equal(mailer.send(mail({to: 'captain@example.org'})), false, 'the 4th within the hour');
    assert.equal(mailer.send(mail({to: 'cleo@example.org'})), true, 'another address');
    // 10 a day: 3 so far, three more in each of the next two hours (9), the 10th fits, the 11th does not
    for (let h = 1; h <= 3; h++) {
        clock.now = START + h * HOUR + 1;
        const n = h < 3 ? 3 : 1;   // 3 + 3 + 3 + 1 = 10
        for (let i = 0; i < n; i++) {
            assert.equal(mailer.send(mail()), true, `hour ${h} mail ${i}`);
        }
    }
    clock.now = START + 4 * HOUR;
    assert.equal(mailer.send(mail()), false, 'the 11th within the day');
    clock.now = START + DAY + 1;
    assert.equal(mailer.send(mail()), true, 'the next day');
    mailer.close();
});


test('sweep drops counters past their windows', () => {
    const {mailer, clock} = setup();
    assert.equal(mailer.send(mail()), true);
    assert.equal(mailer.send(mail({to: 'second@example.org', budget: 'new'})), true);
    assert.equal(mailer.sweep(), 0, 'inside the day');
    clock.now = START + DAY;
    // two addresses, the 'other' and the 'new' budget
    assert.equal(mailer.sweep(), 4);
    assert.equal(mailer.sweep(), 0);
    mailer.close();
});


test('a refused mail uses up no limit', () => {
    const {mailer} = setup({env: {MAIL_MAX_PER_DAY: '1'}});
    assert.equal(mailer.send(mail({to: 'ben@example.org'})), true);
    // refused by the budget: must not count against cleo's address
    for (let i = 0; i < 5; i++) {
        assert.equal(mailer.send(mail({to: 'cleo@example.org'})), false);
    }
    assert.equal(mailer.send(mail({to: 'cleo@example.org', budget: 'new'})), true);
    assert.equal(mailer.send(mail({to: 'cleo@example.org', budget: 'new'})), true);
    assert.equal(mailer.send(mail({to: 'cleo@example.org', budget: 'new'})), true, 'still has all 3 of its hour');
    // refused by the address limit: must not count against the budget
    const b = setup({env: {MAIL_MAX_PER_DAY: '4'}});
    for (let i = 0; i < 3; i++) {
        b.mailer.send(mail({to: 'dan@example.org'}));
    }
    for (let i = 0; i < 5; i++) {
        assert.equal(b.mailer.send(mail({to: 'dan@example.org'})), false);
    }
    assert.equal(b.mailer.send(mail({to: 'eva@example.org'})), true, 'the 4th of the budget');
    assert.equal(b.mailer.send(mail({to: 'finn@example.org'})), false, 'the 5th');
    mailer.close();
    b.mailer.close();
});


test('bad input is refused without queueing', async () => {
    const {mailer, calls} = setup();
    for (const to of ['', 'no-at-sign', 'a b@example.org', 'a@b', 'ben@example.org\r\nBcc: x@example.org', null,
        undefined, 42, 'bénédict@example.org']) {
        assert.equal(mailer.send(mail({to})), false, String(to));
    }
    assert.equal(mailer.send(mail({budget: 'bogus'})), false);
    assert.equal(mailer.send(mail({budget: 'toString'})), false);
    assert.equal(mailer.send(mail({budget: undefined})), false);
    // a header with a line break cannot be built: refused, recorded, no limit used
    assert.equal(mailer.send(mail({subject: 'Hi\r\nBcc: x@example.org'})), false);
    assert.deepEqual(mailer.results(), [{at: START, kind: 'new-link', code: 'header'}]);
    await settle();
    assert.equal(calls.length, 0);
    for (let i = 0; i < 3; i++) {
        assert.equal(mailer.send(mail()), true, 'the address is untouched');
    }
    mailer.close();
});


test('a throwing transport never escapes', async () => {
    const seen = [];
    const onError = e => seen.push(e);
    process.on('unhandledRejection', onError);
    process.on('uncaughtException', onError);
    try {
        const sync = setup({script: [() => { throw new TypeError('boom'); }]});
        assert.equal(sync.mailer.send(mail()), true);
        const str = setup({script: [() => Promise.reject('refused')]});
        assert.equal(str.mailer.send(mail()), true);
        const undef = setup({script: [() => Promise.reject(undefined)]});
        assert.equal(undef.mailer.send(mail()), true);
        const nothing = setup({script: [() => undefined]});
        assert.equal(nothing.mailer.send(mail()), true);
        await settle();
        for (const x of [sync, str, undef]) {
            assert.deepEqual(x.mailer.results(), [{at: START, kind: 'new-link', code: 'error'}]);
            assert.deepEqual(x.delays(), [60000], 'retried like any other failure');
            x.mailer.close();
        }
        assert.deepEqual(nothing.mailer.results(), [{at: START, kind: 'new-link', code: 'error'}]);
        nothing.mailer.close();
        // the worker is not stuck behind a throw
        const next = setup({script: [() => { throw new TypeError('boom'); }, 250]});
        next.mailer.send(mail({to: 'ben@example.org'}));
        next.mailer.send(mail({to: 'cleo@example.org'}));
        await settle();
        assert.equal(next.calls.length, 2);
        assert.deepEqual(next.mailer.results().map(r => r.code), [250, 'error']);
        next.mailer.close();
        // bookkeeping that throws (the clock) neither escapes nor leaves the worker stuck
        let broken = false;
        const t2 = fakeTransport([250]);
        const clockBreaks = makeMailer({cfg: config(), now: () => {
            if (broken) {
                throw new Error('clock');
            }
            return START;
        }, transport: t2.transport, schedule: fakeSchedule().schedule});
        assert.equal(clockBreaks.send(mail({to: 'ben@example.org'})), true);
        broken = true;
        await settle();
        broken = false;
        clockBreaks.send(mail({to: 'cleo@example.org'}));
        await settle();
        assert.equal(t2.calls.length, 2, 'the worker carried on');
        clockBreaks.close();
        // a scheduler that throws drops the mail, recorded, and nothing escapes
        const t = fakeTransport([reply(451)]);
        const bad = makeMailer({cfg: config(), now: () => START, transport: t.transport,
            schedule: () => { throw new Error('no timers'); }});
        assert.equal(bad.send(mail()), true);
        await settle();
        assert.deepEqual(bad.results(), [{at: START, kind: 'new-link', code: 451}]);
        bad.close();
    } finally {
        process.off('unhandledRejection', onError);
        process.off('uncaughtException', onError);
    }
    assert.deepEqual(seen, []);
});


test('results keep the newest 20, and hold no address or text', async () => {
    const clock = {now: START};
    const {mailer} = setup({clock, env: {MAIL_MAX_PER_DAY: '1000'}});
    for (let i = 0; i < 25; i++) {
        clock.now = START + i;
        mailer.send(mail({kind: `k${i}`, to: `rider${i}@example.org`, text: `secret text ${i}`}));
        await settle();
    }
    const results = mailer.results();
    assert.equal(results.length, 20);
    assert.deepEqual(results[0], {at: START + 24, kind: 'k24', code: 250});
    assert.equal(results[19].kind, 'k5');
    assert.ok(!/example\.org|secret/.test(JSON.stringify(results)));
    // the list is a copy
    results[0].code = 'changed';
    results.pop();
    assert.equal(mailer.results()[0].code, 250);
    assert.equal(mailer.results().length, 20);
    mailer.close();
});


test('close clears waiting retries and stops the worker', async () => {
    const clock = {now: START};
    const t = fakeTransport([reply(451)]);
    const real = [];
    const mailer = makeMailer({cfg: config(), now: () => clock.now, transport: t.transport,
        schedule: (fn, ms) => {
            const h = setTimeout(fn, 20);
            real.push([h, ms]);
            return h;
        }});
    mailer.send(mail());
    await settle();
    assert.equal(t.calls.length, 1);
    mailer.send(mail({to: 'cleo@example.org'}));
    mailer.close();
    await new Promise(r => setTimeout(r, 80));
    assert.equal(t.calls.length, 1, 'the retry timer was cleared, the queued mail dropped');
    assert.equal(mailer.send(mail({to: 'dan@example.org'})), false, 'closed: nothing is queued');
    // a retry function that fires after close does nothing
    const s = setup({script: [reply(451)]});
    s.mailer.send(mail());
    await settle();
    s.mailer.close();
    s.scheduled[0][0]();
    await settle();
    assert.equal(s.calls.length, 1);
});


test('the default schedule: unref\'d timers, cleared on close', async () => {
    const t = fakeTransport([reply(451)]);
    const mailer = makeMailer({cfg: config(), now: () => START, transport: t.transport});
    const made = [];
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...a) => {
        const h = realSetTimeout(fn, ms, ...a);
        made.push({h, ms});
        return h;
    };
    try {
        mailer.send(mail());
        await settle();
    } finally {
        globalThis.setTimeout = realSetTimeout;
    }
    assert.equal(t.calls.length, 1);
    const retry = made.filter(m => m.ms === 60000);
    assert.equal(retry.length, 1, 'one retry timer, 60 s');
    assert.equal(retry[0].h.hasRef(), false, 'it does not keep the process alive');
    mailer.close();
    assert.equal(retry[0].h._destroyed, true, 'close cleared it');
});
