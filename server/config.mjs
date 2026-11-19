// The server's configuration from the environment (spec §11). An empty value counts as unset and
// gets the default; a value that is set but wrong stops the start with a message naming the
// variable. modeLine() is the start log: the modes, never a user name or a password.
import {MOD_RE} from './ids.mjs';
import {isZone} from './time.mjs';
import {isAddress, addressOf} from './mail.mjs';

const MB = 1024 * 1024;
// Active clubs (spec §11: 50, user decision 15 Nov 2026). The load test loads this many.
export const MAX_CIRCLES_DEFAULT = 50;


export function readConfig(env) {
    const get = name => {
        const v = env[name];
        return v === undefined || v === null || v === '' ? null : String(v);
    };
    const fail = (name, what) => {
        throw new Error(`${name} is not ${what}: ${get(name)}`);
    };
    // a keyword; surrounding whitespace is ignored, so "notice " is notice
    const oneOf = (name, values, dflt) => {
        const v = get(name)?.trim() || dflt;
        return values.includes(v) ? v : fail(name, values.join(' or '));
    };
    // whole numbers from `min` up
    const int = (name, dflt, min = 0, max = Number.MAX_SAFE_INTEGER) => {
        const v = get(name);
        if (v === null) {
            return dflt;
        }
        const n = /^\s*\d+\s*$/.test(v) ? Number(v) : NaN;
        return n >= min && n <= max ? n : fail(name, `a whole number from ${min}`);
    };
    // megabytes (decimals allowed) as bytes
    const mb = (name, dflt) => {
        const v = get(name);
        const n = v === null ? dflt : Number(v);
        return Number.isFinite(n) && n > 0 ? Math.floor(n * MB) : fail(name, 'a size in MB above 0');
    };
    // both or neither
    const pair = (u, p) => {
        const user = get(u), pass = get(p);
        if ((user === null) !== (pass === null)) {
            throw new Error(`${u} and ${p} must be set together`);
        }
        return user === null ? null : Object.freeze({user, pass});
    };
    // The operator login: ADMIN_*, else UPLOAD_* (the v1 captain login: the start line says so).
    // The placeholder from .env.example is refused (the message names the variable, never the
    // value). {login, fallback}.
    const operator = () => {
        for (const [u, p] of [['ADMIN_USER', 'ADMIN_PASS'], ['UPLOAD_USER', 'UPLOAD_PASS']]) {
            const login = pair(u, p);
            if (login) {
                if (login.pass.startsWith('change-me')) {
                    throw new Error(`${p} is still the placeholder from .env.example, choose your own`);
                }
                return {login, fallback: u === 'UPLOAD_USER'};
            }
        }
        return {login: null, fallback: false};
    };
    const op = operator();

    const host = get('PACELINE_HOST');
    let publicUrl = get('PUBLIC_URL') ?? (host === null ? null : `https://${host}`);
    let publicHost = null;
    if (publicUrl !== null) {
        let u;
        try {
            u = new URL(publicUrl);
        } catch (e) {
            u = null;
        }
        if (!u || !['http:', 'https:'].includes(u.protocol) || !u.hostname) {
            throw new Error(`PUBLIC_URL is not a web address: ${publicUrl}`);
        }
        publicUrl = u.href.replace(/\/+$/, '');
        publicHost = u.hostname;
    }

    const tz = get('PACELINE_TZ') ?? 'Europe/Berlin';
    if (!isZone(tz)) {
        fail('PACELINE_TZ', 'a time zone');
    }
    const modMinVersion = get('MOD_MIN_VERSION');
    if (modMinVersion !== null && !MOD_RE.test(modMinVersion)) {
        fail('MOD_MIN_VERSION', 'a mod version like 0.3.0');
    }

    let smtp = null;
    const smtpHost = get('SMTP_HOST');
    if (smtpHost !== null) {
        const secure = oneOf('SMTP_SECURE', ['starttls', 'tls'], 'starttls');
        const login = pair('SMTP_USER', 'SMTP_PASS');
        smtp = Object.freeze({
            host: smtpHost,
            port: int('SMTP_PORT', secure === 'tls' ? 465 : 587, 1, 65535),
            secure,
            user: login?.user ?? null,
            pass: login?.pass ?? null,
        });
    }

    // Surrounding white space (a trailing CR or tab from an env file) goes; a control character
    // left inside would make every mail's From header fail (mail.mjs headerValue), so it stops the
    // start instead.
    const mailFrom = get('MAIL_FROM')?.trim() || null;
    if (mailFrom !== null && !isAddress(addressOf(mailFrom))) {
        fail('MAIL_FROM', 'an address');
    }
    if (mailFrom !== null && /\p{Cc}/u.test(mailFrom)) {
        throw new Error('MAIL_FROM has control characters: use one line of plain text');
    }

    // Where the operator's notice of every Remove a rider goes (erasures.mjs): a plain address.
    // Unset: the first address in PRIVACY_CONTACT (mail-content.mjs operatorAddress).
    const operatorEmail = get('OPERATOR_EMAIL')?.trim() || null;
    if (operatorEmail !== null && !isAddress(operatorEmail)) {
        fail('OPERATOR_EMAIL', 'an address');
    }

    // Key of the rider-code hashes. Unset: private clubs are off. Never logged; the
    // message names the variable only. Changing it ends every club's code.
    const codeSecret = get('CODE_SECRET');
    if (codeSecret !== null && codeSecret.length < 32) {
        throw new Error('CODE_SECRET is too short: it needs at least 32 characters');
    }

    // Free text for /privacy ("Where data is processed"): trimmed, at most 500 characters, no
    // control characters. The page escapes it. The message does not repeat the value.
    const privacyWhere = get('PRIVACY_WHERE')?.trim() || null;
    if (privacyWhere !== null && privacyWhere.length > 500) {
        throw new Error('PRIVACY_WHERE is too long: it takes at most 500 characters');
    }
    if (privacyWhere !== null && /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(privacyWhere)) {
        throw new Error('PRIVACY_WHERE has control characters: use plain text on one line');
    }

    return Object.freeze({
        dataDir: get('DATA_DIR') ?? '/data',
        port: int('PORT', 8080, 0, 65535),
        publicUrl,
        publicHost,
        tz,
        maxCircles: int('MAX_CIRCLES', MAX_CIRCLES_DEFAULT, 1),
        logMaxFile: mb('LOG_MAX_FILE_MB', 20),
        logMaxTotal: mb('LOG_MAX_TOTAL_MB', 2000),
        logMaxCircle: mb('LOG_MAX_CIRCLE_MB', 300),
        logRetentionDays: int('LOG_RETENTION_DAYS', 90),
        backupRetentionMonths: int('BACKUP_RETENTION_MONTHS', 6, 1),
        modMinVersion,
        modNotice: get('MOD_NOTICE') ?? 'Please update Paceline to {min} or newer.',
        smtp,
        mailFrom,
        mailMaxPerDay: int('MAIL_MAX_PER_DAY', 200),
        registration: oneOf('REGISTRATION', ['open', 'closed'], 'open'),
        privacyContact: get('PRIVACY_CONTACT'),
        operatorEmail,
        privacyWhere,
        admin: op.login,
        adminFallback: op.fallback,
        trustedProxyHops: int('TRUSTED_PROXY_HOPS', 1),
        codeSecret,
    });
}


// Mail is on only with all three: SMTP_HOST, MAIL_FROM and PUBLIC_URL (links in the mails).
// Without it no mailer is built and registration is closed.
export function mailOn(cfg) {
    return Boolean(cfg.smtp && cfg.mailFrom && cfg.publicUrl);
}


export function modeLine(cfg) {
    let mail = 'off';
    if (cfg.smtp) {
        mail = !cfg.mailFrom ? 'off (MAIL_FROM unset)' : !cfg.publicUrl ? 'off (PUBLIC_URL unset)'
            : `on (${cfg.smtp.host}:${cfg.smtp.port} ${cfg.smtp.secure})`;
    }
    return [
        `mail: ${mail}`,
        `admin: ${!cfg.admin ? 'off' : cfg.adminFallback ? 'on (UPLOAD_* fallback — set ADMIN_*)' : 'on'}`,
        `registration: ${mailOn(cfg) ? cfg.registration : 'off (no mail)'}`,
        `private clubs: ${cfg.codeSecret ? 'on' : 'off (no CODE_SECRET)'}`,
        `privacy contact: ${cfg.privacyContact ? 'set' : 'unset'}`,
    ].join('; ');
}
