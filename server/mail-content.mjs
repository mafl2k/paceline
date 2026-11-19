// What the server's mails say (spec §11): subject, the plain text (the source of truth) and an HTML
// version of the same pieces, all from the copy in pages.mjs (T). Every mail is lead, link, note and
// "Not you?", each a paragraph; the HTML part shows the club name as its heading, the link as a
// button and as text to copy, and the note and "Not you?" small below. Inline styles in the captain
// pages' colours (app-css.mjs), no images, fonts or anything else from elsewhere. Links in the HTML
// only go to the server's own PUBLIC_URL; every value is escaped.
import {APP_CSS} from './app-css.mjs';
import {T, esc, t} from './pages.mjs';
import {isAddress} from './mail.mjs';


// mail kind (as the mailer logs it) -> the T key prefix and whether it carries a link. notYou:
// 'own' uses the prefix's -not-you key, 'operator' the operator's contact or the privacy page.
const MAILS = {
    'confirm-club': {key: 'mail-confirm', link: true, notYou: 'own'},
    'new-link': {key: 'mail-newlink', link: true, notYou: null},
    'confirm-email': {key: 'mail-confirm-email', link: true, notYou: 'own'},
    'new-address': {key: 'mail-new-address', link: true, notYou: 'own'},
    'address-changed': {key: 'mail-address-changed', link: false, notYou: 'operator'},
    'confirm-delete': {key: 'mail-confirm-delete', link: true, notYou: 'own'},
};

// The variables that hold a web address of the server; only these become links in the HTML.
const LINK_VARS = new Set(['link', 'lost', 'privacy']);
// Values kept on one line: a masked address must not break after its '…'.
const NOWRAP_VARS = new Set(['masked']);


// The colour tokens of a CSS block: '--bg:#f3f4f7;--text:#15181d' -> {bg: '#f3f4f7', text: '#15181d'}.
function tokens(block) {
    return Object.fromEntries([...block.matchAll(/--([\w-]+):(#[0-9a-fA-F]{3,8})\b/g)].map(m => [m[1], m[2]]));
}

const NEEDED = ['bg', 'surface', 'text', 'muted', 'border', 'accent', 'accent-ink'];

// The captain pages' palette, light and dark, read from the one stylesheet so mail and pages match.
export function paletteOf(css) {
    const light = css.match(/:root\{color-scheme:light dark;([^}]*)\}/)?.[1];
    const dark = css.match(/@media \(prefers-color-scheme:dark\)\{:root\{([^}]*)\}\}/)?.[1];
    const font = light?.match(/--font:([^;}]*)/)?.[1];
    const palette = {light: tokens(light ?? ''), dark: tokens(dark ?? ''), font: font?.replace(/"/g, '\'')};
    for (const name of NEEDED) {
        if (!palette.light[name] || !palette.dark[name]) {
            throw new Error(`app.css has no --${name} for the mails`);
        }
    }
    if (!palette.font) {
        throw new Error('app.css has no --font for the mails');
    }
    return palette;
}

const P = paletteOf(APP_CSS);
const L = P.light;
const FONT = P.font;


// `url` when it is an http(s) address under `publicUrl` (the server's own), written as the URL
// parser writes it; else null.
export function ownLink(url, publicUrl) {
    if (typeof url !== 'string' || typeof publicUrl !== 'string' || !publicUrl) {
        return null;
    }
    try {
        const u = new URL(url);
        const base = new URL(publicUrl);
        const ok = (u.protocol === 'https:' || u.protocol === 'http:') && u.origin === base.origin
            && u.href === url && url.startsWith(`${publicUrl}/`);
        return ok ? url : null;
    } catch {
        return null;
    }
}

const linkStyle = `color:${L.accent};text-decoration:underline;`;

// A T template as HTML: the copy and every value escaped; the server's own addresses as links.
function fill(key, vars, publicUrl) {
    return T[key].split(/(\{\w+\})/).map(part => {
        const name = part.match(/^\{(\w+)\}$/)?.[1];
        if (!name || !Object.hasOwn(vars, name)) {
            return esc(part);
        }
        const value = String(vars[name]);
        const href = LINK_VARS.has(name) ? ownLink(value, publicUrl) : null;
        if (href) {
            return `<a href="${esc(href)}" class="pl-link" style="${linkStyle}">${esc(value)}</a>`;
        }
        return NOWRAP_VARS.has(name) ? `<span style="white-space:nowrap;">${esc(value)}</span>` : esc(value);
    }).join('');
}


// The pieces of mail `kind`: {key, vars} per paragraph and the link (null when there is none).
function piecesOf(kind, vars, cfg) {
    const mail = MAILS[kind];
    if (!mail) {
        throw new Error(`Unknown mail: ${kind}`);
    }
    const piece = (key, v = vars) => (Object.hasOwn(T, key) ? {key, vars: v} : null);
    let notYou = null;
    if (mail.notYou === 'own') {
        notYou = piece(`${mail.key}-not-you`);
    } else if (mail.notYou === 'operator') {
        notYou = cfg.privacyContact
            ? piece('mail-not-you-contact', {contact: cfg.privacyContact})
            : piece('mail-not-you-privacy', {privacy: `${cfg.publicUrl}/privacy`});
    }
    return {
        mail,
        lead: piece(`${mail.key}-lead`),
        link: mail.link ? String(vars.link) : null,
        note: piece(`${mail.key}-note`),
        notYou,
    };
}


// {subject, text, html} of mail `kind` ('confirm-club', 'new-link', 'confirm-email', 'new-address',
// 'address-changed', 'confirm-delete') with `vars` (club, link, lost, email, masked; raw values)
// and cfg {publicUrl, privacyContact}.
export function mailContent(kind, vars, cfg) {
    const p = piecesOf(kind, vars, cfg);
    const subject = t(`${p.mail.key}-subject`, vars);
    const text = [p.lead, p.link, p.note, p.notYou]
        .filter(x => x !== null)
        .map(x => (typeof x === 'string' ? x : t(x.key, x.vars)))
        .join('\n\n') + '\n';
    const html = mailHtml({
        title: subject,
        heading: String(vars.club ?? ''),
        lead: fill(p.lead.key, p.lead.vars, cfg.publicUrl),
        link: p.link === null ? null : ownLink(p.link, cfg.publicUrl),
        linkText: p.link,
        button: p.link === null ? null : t(`${p.mail.key}-button`, vars),
        footer: [p.note, p.notYou].filter(x => x !== null).map(x => fill(x.key, x.vars, cfg.publicUrl)),
    });
    return {subject, text, html};
}


// Sauce-like dark mode for clients that know prefers-color-scheme (Apple Mail, iOS Mail, Outlook
// for Mac); the others keep the light inline colours or darken the mail themselves.
function darkCss() {
    const d = P.dark;
    return `:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme:dark){
.pl-bg{background:${d.bg}!important}
.pl-card{background:${d.surface}!important;border-color:${d.border}!important}
.pl-text{color:${d.text}!important}
.pl-muted{color:${d.muted}!important}
.pl-brand{color:${d.accent}!important}
.pl-link{color:${d.accent}!important}
.pl-btn{background:${d.accent}!important}
.pl-btn-a{background:${d.accent}!important;border-color:${d.accent}!important;color:${d['accent-ink']}!important}
}`;
}

const font = (size, weight = 400, line = 1.5) => `font-family:${FONT};font-size:${size}px;font-weight:${weight};line-height:${line};`;

// One mail as HTML: brand line, a card with the club name, the lead, the button and the link to copy,
// then the footer in small print. `lead` and `footer` (a list of paragraphs) are HTML already;
// `title`, `heading`, `button` and `linkText` are raw text; `link` an already checked href or null
// (then the link is text only and there is no button).
// `copy` labels the text to copy (default: the link's label).
export function mailHtml({title, heading, lead, link, linkText, button, footer, copy = t('mail-copy-link')}) {
    const p = (cls, html, style) => `<p class="${cls}" style="margin:0;${style}">${html}</p>`;
    const rows = [];
    rows.push(`<h1 class="pl-text" style="margin:0 0 12px;${font(22, 700, 1.3)}color:${L.text};">${esc(heading)}</h1>`);
    rows.push(p('pl-text', lead, `${font(16)}color:${L.text};`));
    if (linkText !== null && linkText !== undefined) {
        if (link) {
            rows.push(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;border-collapse:separate;">
<tr><td class="pl-btn" align="center" bgcolor="${L.accent}" style="border-radius:12px;background:${L.accent};mso-padding-alt:14px 24px;">
<a class="pl-btn-a" href="${esc(link)}" target="_blank" style="display:inline-block;padding:14px 24px;border:1px solid ${L.accent};border-radius:12px;background:${L.accent};${font(16, 600, 1.25)}color:${L['accent-ink']};text-decoration:none;">${esc(button)}</a>
</td></tr>
</table>`);
        }
        rows.push(p('pl-muted', esc(copy), `margin-top:24px;${font(14)}color:${L.muted};`));
        const shown = link
            ? `<a href="${esc(link)}" class="pl-link" style="${linkStyle}">${esc(linkText)}</a>`
            : esc(linkText);
        rows.push(p('pl-text', shown, `margin-top:4px;${font(14)}color:${L.text};word-break:break-all;`));
    }
    const foot = (footer ?? []).map((html, i) =>
        p('pl-muted', html, `${i ? 'margin-top:8px;' : ''}${font(13)}color:${L.muted};`)).join('\n');

    return `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(title)}</title>
<style>
${darkCss()}
</style>
</head>
<body class="pl-bg" style="margin:0;padding:0;background:${L.bg};-webkit-text-size-adjust:100%;">
<table role="presentation" class="pl-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${L.bg}" style="background:${L.bg};">
<tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
<tr><td class="pl-brand" style="padding:0 4px 12px;${font(15, 700, 1.2)}letter-spacing:.02em;color:${L.accent};">${esc(t('mail-brand'))}</td></tr>
<tr><td class="pl-card" bgcolor="${L.surface}" style="padding:28px 24px;background:${L.surface};border:1px solid ${L.border};border-radius:12px;">
${rows.join('\n')}
</td></tr>
<tr><td style="padding:16px 4px 0;">
${foot}
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>
`;
}


// ---- the operator's notice of a removal (erasures.mjs) ----

// The operator's address for the notices of removals: OPERATOR_EMAIL, else the first e-mail address
// in PRIVACY_CONTACT (the operator's contact on /privacy, free text such as "Paceline,
// privacy@example.org"); null without either.
export function operatorAddress(cfg) {
    if (cfg.operatorEmail) {
        return cfg.operatorEmail;
    }
    const found = String(cfg.privacyContact ?? '').match(/[^\s<>(),;:"']+@[^\s<>(),;:"']+/g) ?? [];
    return found.map(a => a.replace(/\.$/, '')).find(a => isAddress(a)) ?? null;
}


// {subject, text, html} of the operator's notice of a Remove a rider: the club, the Zwift ID, the time
// and the erasure-list line `line`, to paste into /admin after a full restore. `vars`: club (its
// name), cid, aid, at (ISO), line.
export function operatorRemovalMail(vars, cfg) {
    const v = {...vars, time: vars.at.slice(0, 16).replace('T', ' ')};
    const subject = t('mail-rider-removed-subject', v);
    const text = [t('mail-rider-removed-lead', v), `${t('mail-rider-removed-copy')}\n${v.line}`, t('mail-rider-removed-note', v)].join('\n\n') + '\n';
    const html = mailHtml({
        title: subject,
        heading: String(v.club),
        lead: fill('mail-rider-removed-lead', v, cfg.publicUrl),
        link: null,
        linkText: v.line,
        button: null,
        copy: t('mail-rider-removed-copy'),
        footer: [fill('mail-rider-removed-note', v, cfg.publicUrl)],
    });
    return {subject, text, html};
}
