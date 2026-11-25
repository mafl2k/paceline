// CHANGES.md: the release notes. Builders add a line per user-visible change under
// "## Unreleased" ("### Mod" or "### Server"); the promote job renames that section to
// "## <version> (<YYYY-MM-DD>)" (release below) and starts a new empty one. The GitHub and GitLab
// releases and the Sauce mod store read a version's lines through notesFor / notesText.
//
// The format is line based:
//   ## Unreleased           a section; its heading is exactly this
//   ## 0.3.4 (2026-11-23)   a released section: "## <version> (<date>)"
//   ### Mod / ### Server    the two parts of a section
//   - a change              one bullet per change; an indented line continues the bullet
//
// CLI: node scripts/changes.mjs notes <version>   prints that version's notes text, or nothing
// (exit 0) when CHANGES.md or the version's section is missing.
//      node scripts/changes.mjs unreleased        prints the Unreleased lines as notes text (a
// beta's notes: everything since the last release), or nothing.
import {readFileSync, realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lines = text => String(text).split(/\r?\n/);

// The body lines of the section whose heading matches `headingRe`, or null.
function sectionLines(text, headingRe) {
    const all = lines(text);
    const start = all.findIndex(l => headingRe.test(l));
    if (start < 0) {
        return null;
    }
    let end = all.findIndex((l, i) => i > start && /^## /.test(l));
    if (end < 0) {
        end = all.length;
    }
    return all.slice(start + 1, end);
}

function parts(body) {
    const out = {mod: [], server: []};
    let into = null;
    let last = null;
    for (const line of body) {
        const head = /^### +(.*?)\s*$/.exec(line);
        if (head) {
            const key = head[1].toLowerCase();
            into = Object.hasOwn(out, key) ? out[key] : null;
            last = null;
            continue;
        }
        const bullet = /^- +(.*?)\s*$/.exec(line);
        if (bullet && into) {
            into.push(bullet[1]);
            last = into.length - 1;
        } else if (/^\s+\S/.test(line) && into && last !== null) {
            into[last] += ' ' + line.trim();
        } else {
            last = null;
        }
    }
    return out;
}

export function unreleased(text) {
    const body = sectionLines(text, /^## Unreleased\s*$/);
    return body ? parts(body) : {mod: [], server: []};
}

export function notesFor(text, version) {
    const body = sectionLines(text, new RegExp(`^## ${escapeRe(String(version))} \\(.*\\)\\s*$`));
    return body ? parts(body) : null;
}

// "## Unreleased" becomes "## <version> (<date>)", a fresh empty Unreleased goes above it.
// Text without an Unreleased section comes back unchanged.
export function release(text, {version, date}) {
    const all = lines(text);
    const at = all.findIndex(l => /^## Unreleased\s*$/.test(l));
    if (at < 0) {
        return text;
    }
    all.splice(at, 1, '## Unreleased', '', '### Mod', '', '### Server', '', `## ${version} (${date})`);
    return all.join('\n');
}

export function notesText({mod, server}) {
    const block = (title, items) => items.length ? `${title}:\n${items.map(i => `- ${i}`).join('\n')}` : null;
    return [block('Mod', mod), block('Server', server)].filter(Boolean).join('\n\n');
}

// Case-insensitive match against a deny regex (the JS flavour of PUBLIC_DENY_REGEX). An empty or
// missing source never matches. A source that is no regex throws, it is not taken for "clean";
// the error never carries the source (the deny list is private and a job log is not): not in the
// message and not as a cause.
export function denied(text, regexSource) {
    if (!regexSource) {
        return false;
    }
    let re;
    try {
        re = new RegExp(regexSource, 'i');
    } catch {
        throw new Error('the deny regex does not compile');
    }
    return re.test(String(text));
}

// True when this file is the program that node was started with, also when it was started through
// a symlink (argv[1] is the link's path, import.meta.url the real file).
function isMain() {
    try {
        return Boolean(process.argv[1]) &&
            realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
    } catch {
        return false;
    }
}

if (isMain()) {
    const [cmd, version] = process.argv.slice(2);
    if (!(cmd === 'notes' && version) && !(cmd === 'unreleased' && !version)) {
        console.error('usage: node scripts/changes.mjs notes <version> | unreleased');
        process.exit(2);
    }
    let doc = '';
    try {
        doc = readFileSync(fileURLToPath(new URL('../CHANGES.md', import.meta.url)), 'utf8');
    } catch (e) {
        if (e.code !== 'ENOENT') {
            throw e;
        }
    }
    const notes = cmd === 'unreleased' ? unreleased(doc) : notesFor(doc, version);
    const body = notes ? notesText(notes) : '';
    if (body) {
        console.log(body);
    }
}
