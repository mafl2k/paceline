// The one stylesheet, served as /static/app.css (static.mjs): the captain pages (prototype v2,
// spec §5.4) and the public pages (publicPage in ui.mjs); under .plain, the admin pages (page() in
// pages.mjs).
export const APP_CSS = String.raw`/* Paceline captain pages, prototype v2. One cached file (served as /static/app.css), no inline CSS.
   Tokens, base, components, page layouts, desktop. */
:root{color-scheme:light dark;
--bg:#f3f4f7;--surface:#fff;--surface-2:#eef0f4;--text:#15181d;--muted:#545c68;--border:#dfe3e8;--control:#7b8492;
--accent:#1b5fc1;--accent-hover:#174fa1;--accent-ink:#fff;--accent-soft:#e8f0fc;--accent-soft-fg:#174a94;
--danger:#b42318;--danger-text:#b42318;--danger-soft:#fdf1f0;--danger-bd:#e7b4ae;
--ok-bg:#e6f5ec;--ok-fg:#14632f;--ok-bd:#a7d7b6;--ok-icon:#1f7a3d;
--warn-bg:#fff4d6;--warn-fg:#6b4400;--warn-bd:#e9c366;--warn-icon:#946000;
--err-bg:#fdeceb;--err-fg:#9b1c1c;--err-bd:#f0aca7;--err-icon:#c0261b;
--neutral-bg:#eceef2;--neutral-fg:#454d59;--neutral-bd:#d3d8df;--neutral-icon:#6a7380;
--info-icon:#1b5fc1;
--bar-bg:rgb(243 244 247/.9);
--shadow:0 1px 2px rgb(16 24 40/.05),0 1px 4px rgb(16 24 40/.05);
--shadow-pop:0 8px 28px rgb(16 24 40/.18);
--r1:8px;--r2:12px;--r3:16px;--tap:2.75rem;--btn:3rem;
--font:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
--mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root{
--bg:#0e1116;--surface:#171b21;--surface-2:#1f242c;--text:#e8ebef;--muted:#a3acb9;--border:#2a3038;--control:#6c7686;
--accent:#7fb0ff;--accent-hover:#9cc2ff;--accent-ink:#0b1526;--accent-soft:#18294a;--accent-soft-fg:#bcd5ff;
--danger:#c4322a;--danger-text:#ff9b93;--danger-soft:#24130f;--danger-bd:#6e2a26;
--ok-bg:#10261a;--ok-fg:#8fe0a8;--ok-bd:#2a6340;--ok-icon:#6fd690;
--warn-bg:#2a2008;--warn-fg:#f5cf6e;--warn-bd:#6f5618;--warn-icon:#f0c04f;
--err-bg:#2e1514;--err-fg:#ffaba4;--err-bd:#74302b;--err-icon:#ff8a80;
--neutral-bg:#252b33;--neutral-fg:#c3cad4;--neutral-bd:#3a424d;--neutral-icon:#9aa3af;
--info-icon:#7fb0ff;
--bar-bg:rgb(14 17 22/.9);
--shadow:none;--shadow-pop:0 8px 28px rgb(0 0 0/.55)}}

*,*::before,*::after{box-sizing:border-box}
/* fixed bars must never cover the focused element (WCAG 2.4.11) */
html{-webkit-text-size-adjust:100%;text-size-adjust:100%;scroll-padding:4.5rem 0 calc(6rem + env(safe-area-inset-bottom))}
body{margin:0;min-height:100vh;font:1.0625rem/1.5 var(--font);color:var(--text);background:var(--bg);overflow-wrap:anywhere;-webkit-font-smoothing:antialiased}
h1,h2,h3,p,ul,ol,dl,dd,figure,fieldset{margin:0}
ul,ol{padding:0;list-style:none}
a{color:var(--accent);text-underline-offset:.18em}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px;border-radius:4px}
[hidden]{display:none!important}
.i{width:1.25rem;height:1.25rem;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;vertical-align:-.25em}
.i.big{width:2.5rem;height:2.5rem;stroke-width:1.6;color:var(--muted)}
.sr,.vh{position:absolute!important;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
/* the shadow only when shown: off screen it would still fall onto the top of a page without a top bar */
.skip{position:absolute;left:.5rem;top:-4rem;z-index:50;padding:.75rem 1rem;background:var(--surface);border-radius:var(--r2)}
.skip:focus{top:.5rem;box-shadow:var(--shadow-pop)}
.muted{color:var(--muted)}
.err-text{color:var(--err-fg);font-weight:600}
.num,time{font-variant-numeric:tabular-nums}
code{font-family:var(--mono);font-size:.9em;font-weight:650;letter-spacing:.05em;white-space:nowrap;padding:.05em .4em;border-radius:6px;background:var(--surface-2);border:1px solid var(--border)}
.hint{font-size:.9375rem;color:var(--muted);line-height:1.45}
.sub{font-weight:400;font-size:.9375rem;color:var(--muted)}
.tag{display:inline-block;font-size:.75rem;font-weight:750;letter-spacing:.06em;text-transform:uppercase;padding:.1rem .45rem;border-radius:6px;background:var(--ok-bg);color:var(--ok-fg);border:1px solid var(--ok-bd);vertical-align:.15em}

/* buttons, one system (UI panel wave 3): primary (filled) at most one per block, the main action,
   first; secondary (outline) the further actions; quiet (a text link) navigation and side things;
   secondary.danger-text the button that asks before something goes; danger (filled red) only as the
   confirm of that question. Cancel right beside the confirm. */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;min-height:var(--btn);padding:.625rem 1.125rem;border-radius:var(--r2);border:1px solid transparent;font:inherit;font-size:1rem;font-weight:600;line-height:1.25;text-align:center;text-decoration:none;cursor:pointer;-webkit-tap-highlight-color:transparent}
.btn.primary{background:var(--accent);color:var(--accent-ink);box-shadow:var(--shadow)}
.btn.primary:hover{background:var(--accent-hover)}
.btn.secondary{background:var(--surface);color:var(--text);border-color:var(--control)}
.btn.secondary:hover{background:var(--surface-2)}
.btn.danger{background:var(--danger);color:#fff;border-color:var(--danger)}
.btn.danger:hover{filter:brightness(.92)}
/* one danger style (UI panel wave 2): the confirm of a destructive action is .btn.danger, the button
   that asks for it .btn.secondary.danger-text */
.btn.secondary.danger-text{color:var(--danger-text)}
.btn.secondary.danger-text:hover{background:var(--danger-soft)}
.btn.quiet{background:transparent;color:var(--accent);padding-inline:.5rem;justify-self:start}
.btn.small{min-height:var(--tap);padding:.5rem .875rem;font-size:.9375rem}
.btn.block{display:flex;width:100%}
.btnrow{display:flex;flex-wrap:wrap;gap:.5rem;align-items:flex-start}
.btnrow>form{display:contents}

/* status line: icon + words + colour; the worst state sets all three */
.sevline{display:flex;align-items:flex-start;gap:.5rem;font-weight:600;line-height:1.35}
.sevline .i{margin-top:.05rem}
.sevline.ok .i{color:var(--ok-icon)}.sevline.ok{color:var(--ok-fg)}
.sevline.warn .i{color:var(--warn-icon)}.sevline.warn{color:var(--warn-fg)}
.sevline.err .i{color:var(--err-icon)}.sevline.err{color:var(--err-fg)}
.sevline.neutral .i{color:var(--neutral-icon)}.sevline.neutral{color:var(--text)}
.sevline.big{font-size:1.125rem;padding:.75rem .875rem;border-radius:var(--r2);border:1px solid;background:var(--surface)}
.sevline.big.ok{background:var(--ok-bg);border-color:var(--ok-bd)}
.sevline.big.neutral{border-color:var(--border)}
.sevline.big.warn{background:var(--warn-bg);border-color:var(--warn-bd)}
.sevline.big.err{background:var(--err-bg);border-color:var(--err-bd)}

/* cards */
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r3);padding:1.125rem 1rem;box-shadow:var(--shadow);min-width:0}
.card>*+*{margin-top:.875rem}
.card-head{display:flex;align-items:baseline;justify-content:space-between;gap:.25rem .75rem;flex-wrap:wrap}
.card h2,.card h3{font-size:1.125rem;line-height:1.3;font-weight:700}
/* a card that holds the page's h1 (the public pages, publicPage in ui.mjs) */
.card>h1{font-size:1.5rem;line-height:1.2;font-weight:750;letter-spacing:-.01em}
.kicker{display:flex;align-items:center;gap:.4rem;font-size:.8125rem!important;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.count{font-size:.9375rem;color:var(--muted)}
.count strong{color:var(--text)}
.stack>*+*{margin-top:1rem}

/* notes ("2 to fix"): red = riders get nothing, amber = check */
.callout{border-radius:var(--r3);border:1px solid;padding:1rem}
.callout.warn{background:var(--warn-bg);border-color:var(--warn-bd);color:var(--warn-fg)}
.callout.err{background:var(--err-bg);border-color:var(--err-bd);color:var(--err-fg)}
.callout>h2{display:flex;align-items:center;gap:.5rem;font-size:1.0625rem;font-weight:750}
.callout.warn>h2 .i{color:var(--warn-icon)}.callout.err>h2 .i{color:var(--err-icon)}
/* plans received from ZwiftGopher: neutral blue, news rather than a problem */
.callout.info{background:var(--accent-soft);border-color:var(--accent);color:var(--accent-soft-fg)}
.callout.info>h2 .i{color:var(--info-icon)}
.note.info{border-left-color:var(--info-icon)}.note.info .note-title .i{color:var(--info-icon)}
.newplans{display:inline-block;font-size:.8125rem;font-weight:700;line-height:1.3;padding:.05rem .45rem;border-radius:999px;background:var(--accent-soft);color:var(--accent-soft-fg);border:1px solid var(--accent);white-space:nowrap;vertical-align:.1em}
.callout ol{margin-top:.75rem;display:grid;gap:.75rem}
.note{display:grid;gap:.625rem;padding:.875rem;border-radius:var(--r2);background:var(--surface);color:var(--text);border:1px solid var(--border);border-left:4px solid}
.note.err{border-left-color:var(--err-icon)}.note.warn{border-left-color:var(--warn-icon)}
.note-title{display:flex;gap:.5rem;align-items:flex-start;line-height:1.35}
.note.err .note-title .i{color:var(--err-icon)}.note.warn .note-title .i{color:var(--warn-icon)}
.note .btn{justify-self:start}
.evcount{display:grid;gap:.125rem;font-size:.9375rem;padding:.5rem .75rem;border-radius:var(--r1);background:var(--surface-2)}

/* the live tag of a plan without a start time */
.tag.off{background:var(--err-bg);color:var(--err-fg);border-color:var(--err-bd)}
/* the race's phase beside the live row's Live (user, 23 Nov 2026): Sending in the accent's colours,
   Started in amber; a race that is over: its Live grey */
.tag.sending{background:var(--accent-soft);color:var(--accent-soft-fg);border-color:var(--accent)}
.tag.started{background:var(--warn-bg);color:var(--warn-fg);border-color:var(--warn-bd)}
.tag.was{background:var(--neutral-bg);color:var(--muted);border-color:var(--neutral-bd)}

/* folds open inline, never as a popover or a fixed bar */
details>summary{list-style:none;cursor:pointer}
details>summary::-webkit-details-marker{display:none}
/* arm in place (UI panel wave 2): the action's press turns its form, in the same place, into a strip
   with the words, the confirm button and Cancel; it takes the row's whole width */
form[data-arm].armed{flex-basis:100%;width:100%}
form[data-arm].armed>[data-arm-open]{display:none}
.arm-strip{display:grid;gap:.625rem;flex-basis:100%;width:100%;padding:.75rem .875rem;border-radius:var(--r2);background:var(--surface-2);border:1px solid var(--control);font-size:.9375rem;color:var(--text);font-weight:400;text-align:left}
.arm-btns{display:flex;flex-wrap:wrap;gap:.5rem}
@media (max-width:1023px){.arm-btns>.btn{flex:1 1 100%}}
/* a plan block a Rename lands on (#plan-<id>): below the sticky top bar on phones */
[id^="plan-"]{scroll-margin-top:5rem}

.help>summary{display:inline-flex;align-items:center;gap:.375rem;min-height:var(--tap);color:var(--accent);font-weight:600;font-size:.9375rem}
.help .i{width:1.125rem;height:1.125rem}

/* the outdated marks of a Make live question */
.outdated{display:flex;gap:.375rem;align-items:flex-start;font-size:.9375rem;color:var(--warn-fg);font-weight:600}
.outdated .i{color:var(--warn-icon);width:1.125rem;height:1.125rem;margin-top:.1rem}

.uplink{display:inline-flex;align-items:center;gap:.5rem;min-height:var(--tap);font-weight:600;color:var(--accent);justify-self:start}
/* the ⋯ menus (races spec §4): a quiet ⋯ button in the corner of a race's line and of a plan block's
   first line; its panel opens in the page flow under that line, the whole
   width of it, and pushes what follows down: it never lies over the next row's buttons (at every
   width). The button keeps its corner, open or closed; every control in the panel is 44 px high at
   least */
.racehead,.rowtop{position:relative;min-height:var(--tap);padding-right:calc(var(--tap) + .5rem)}
/* a race line without a ⋯ (a rhythm date without plans) keeps no room for one */
.racehead.nomenu{min-height:0;padding-right:0}
.menu{display:block}
.menu>summary{position:absolute;top:0;right:0;min-width:var(--tap);padding-inline:.5rem;color:var(--muted)}
.menu[open]>summary{background:var(--surface-2);color:var(--text)}
.menu-panel{margin:.5rem calc(-1 * (var(--tap) + .5rem)) 0 0;display:grid;gap:.75rem;padding:.875rem;background:var(--surface);border:1px solid var(--border);border-radius:var(--r2);box-shadow:var(--shadow);font-size:1rem;font-weight:400;line-height:1.45;text-align:left}
.menu-panel>*+*{padding-top:.75rem;border-top:1px solid var(--border)}
.menu-panel form,.menu-sec{display:grid;gap:.5rem}
.menu-panel .btn{justify-self:start}
.menu-head{font-weight:700}
.menu-link{display:flex;align-items:center;gap:.625rem;min-height:var(--tap);color:var(--text);text-decoration:none;font-weight:600}

.empty{display:grid;gap:.75rem;justify-items:start;text-align:left}
.empty h2,.empty h1{font-size:1.25rem}

/* banners */
.banner,.flash{display:flex;gap:.625rem;align-items:flex-start;padding:.75rem .875rem;border-radius:var(--r2);border:1px solid}
.banner.warn{background:var(--warn-bg);border-color:var(--warn-bd);color:var(--warn-fg)}
.banner .i{color:var(--warn-icon);margin-top:.1rem}
.banner.info{background:var(--neutral-bg);border-color:var(--neutral-bd);color:var(--neutral-fg)}
.banner.info .i{color:var(--neutral-icon)}
/* the note without the script (ui.mjs appPage): the page's side padding and width */
.nojs{max-width:44rem;margin:0 auto;padding:.75rem max(1rem,env(safe-area-inset-right)) 0 max(1rem,env(safe-area-inset-left))}
.flash.ok{background:var(--ok-bg);border-color:var(--ok-bd);color:var(--ok-fg)}
.flash.ok .i{color:var(--ok-icon);margin-top:.1rem}
.flash.err{background:var(--err-bg);border-color:var(--err-bd);color:var(--err-fg)}

/* freshness: a quiet "Updated 19:12"; client.js shows the stale line when a reload fails */
.fresh{font-size:.875rem;color:var(--muted);display:flex;align-items:center;gap:.5rem}
.fresh .dot{width:.5rem;height:.5rem;border-radius:50%;background:var(--ok-icon);display:inline-block}
.fresh.is-stale .dot{background:var(--neutral-icon)}
.stale-banner{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem .625rem;padding:.625rem .75rem;border-radius:var(--r2);background:var(--neutral-bg);border:1px solid var(--neutral-bd);color:var(--neutral-fg);font-size:.9375rem}
.stale-banner>span{flex:1 1 12rem}
.stale-banner .i{color:var(--neutral-icon)}

/* forms */
label.field{display:grid;gap:.375rem;font-weight:600;font-size:1rem;min-width:0}
label.field .hint{font-weight:400}
input:not([type=checkbox],[type=radio],[type=hidden],[type=file]),select,textarea{width:100%;min-height:var(--btn);padding:.625rem .75rem;font:inherit;font-size:1.0625rem;font-weight:400;color:var(--text);background:var(--surface);border:1px solid var(--control);border-radius:var(--r1)}
input[type=file]{font:inherit;font-size:.9375rem;max-width:100%;min-height:var(--tap)}
input[type=file]::file-selector-button{font:inherit;font-weight:600;min-height:var(--tap);padding:.5rem .875rem;margin-right:.75rem;border-radius:var(--r2);border:1px solid var(--control);background:var(--surface);color:var(--text)}
input::placeholder{color:var(--muted);opacity:1}
input[type=time]{max-width:10rem}
input[type=date]{max-width:13rem}
.inline-form{display:flex;flex-wrap:wrap;align-items:end;gap:.5rem}
.inline-form>label{flex:1 1 12rem}
.inline-form>.btn{flex:none}
/* the Store form's race date and start time side by side, their boxes on one line (each hint under
   its box) */
.as-when{display:flex;flex-wrap:wrap;align-items:flex-start;gap:.75rem}
.as-when>label{flex:1 1 12rem}
/* a new version's date: its plan's, read only, in the same box */
input[type=date][readonly]{background:var(--surface-2);color:var(--muted)}
input[type=radio],input[type=checkbox]{width:1.25rem;height:1.25rem;margin:.15rem 0 0;flex:none;accent-color:var(--accent)}
.choice{display:flex;gap:.75rem;align-items:flex-start;padding:.75rem .875rem;border:1px solid var(--border);border-radius:var(--r2);background:var(--surface);cursor:pointer;min-height:var(--btn)}
.choice:has(:checked){border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent);background:var(--accent-soft)}
.choice strong{display:block;font-weight:600}
.choice span span{font-size:.9375rem;color:var(--muted)}
.choices{display:grid;gap:.5rem;border:0;padding:0;min-width:0}
.choices legend{font-weight:600;margin-bottom:.5rem;padding:0}
.fold>summary{display:flex;align-items:center;flex-wrap:wrap;gap:0 .625rem;min-height:var(--btn);font-weight:700;padding-right:2rem;position:relative}
.fold>summary .sub{flex-basis:100%;font-size:.875rem}
.fold>summary::after{content:"";position:absolute;right:.25rem;top:50%;width:.6rem;height:.6rem;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:translateY(-70%) rotate(45deg)}
.fold[open]>summary::after{transform:translateY(-30%) rotate(225deg)}
.fold[open]>summary{margin-bottom:.75rem}
/* the rest of a hint (user, 23 Nov 2026): a small "More" under the hint, a 44 px target */
.fold.more>summary{min-height:var(--tap);font-weight:600;font-size:.9375rem;color:var(--accent);padding-right:1.5rem;width:max-content;max-width:100%}
.fold.more[open]>summary{margin-bottom:.25rem}
.card.fold{padding-block:.5rem}
.card.fold[open]{padding-bottom:1.125rem}
/* the Store form's race fold, its last block (user, 22 Nov 2026): the summary names the race, its
   "Change" in the link colour; open, the date and time and the event link spaced as the form's fields */
.as-race>summary{font-weight:600}
.as-race .as-change{color:var(--accent)}
.as-race-body{display:grid;gap:1rem;min-width:0}
.filepick{display:grid;gap:.5rem;justify-items:start}
.fname{display:flex;align-items:center;gap:.5rem;font-weight:600;flex-wrap:wrap}
.fname .i{color:var(--muted)}

/* the warning lines above a card's action bar, the Store flash's lines */
.pv-list{display:grid;gap:.5rem}
.pv-list li{display:flex;flex-wrap:wrap;gap:.25rem .625rem;align-items:flex-start;line-height:1.4}
.pv-list li>span{flex:1 1 0;min-width:0}
.pv-list .i{margin-top:.1rem}
.pv-list .ok .i{color:var(--ok-icon)}.pv-list .info .i{color:var(--info-icon)}
.pv-list .warn .i{color:var(--warn-icon)}.pv-list .warn{color:var(--warn-fg)}
.pv-list .err .i{color:var(--err-icon)}.pv-list .err{color:var(--err-fg)}
.pv-list .neutral .i{color:var(--neutral-icon)}

.ptable{width:100%;border-collapse:collapse;font-size:.9375rem;overflow-wrap:normal}
.ptable th,.ptable td{padding:.5rem .375rem;border-top:1px solid var(--border);text-align:left}
.ptable thead th{border-top:0;color:var(--muted);font-weight:600;font-size:.875rem}
.ptable .n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.ptable .nmcol{font-weight:600}

/* the rider table (team cockpit spec §7): #, Rider, Pull @ unit; its own rules, .ptable stays shared.
   Old lines are dimmed and smaller, a dropped one crossed out; the one change colour is the blue info
   token (green is live, red alarm); a long name ends in an ellipsis; fits 390 px */
.pt-cap{margin:0 0 .5rem;font-size:.9375rem;color:var(--muted)}
.ptable-plan{table-layout:fixed}
.ptable-plan .pt-pos{width:2.5rem}
.ptable-plan .pt-pull{width:8.75rem}
.ptable-plan .pt-who{display:flex;align-items:baseline;gap:.375rem;min-width:0}
.ptable-plan .pt-nm{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ptable-plan .pt-mark{flex:none;font-size:.75rem;font-weight:700;letter-spacing:.04em;color:var(--info-icon)}
.ptable-plan .pt-rides{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:400}
.ptable-plan .pt-chg{color:var(--info-icon);font-weight:700}
.ptable-plan .pt-old td{font-size:.8125rem;color:var(--muted)}
.ptable-plan .pt-old .nmcol{font-weight:400}
.ptable-plan .pt-old:not(.pt-dropped) td{border-top:0;padding-top:0}
/* the riders card after the gate (amended 22 Nov 2026): the rider table's Plan column, each rider's
   state after its sign (✓ ⚠ –: never colour alone) in the colours of the old state list, scoped to
   the riders card and the cockpit's card (a rider's state is no change mark: the change colour stays the blue one). In a
   card narrower than 32rem (a phone, and the right column from 1180 px, at most ~30rem: four columns
   would cut the names) the state is a line under the rider's row, so pull @ target keeps its column
   and long words wrap; an old or a dropped line has no state there */
:is(.riders-card,.cp-body){container-type:inline-size}
.ptable-plan.rstates .pt-pull{width:6.75rem}
:is(.riders-card,.cp-body) th.rstate{width:44%}
:is(.riders-card,.cp-body) .rstates td{vertical-align:top}
:is(.riders-card,.cp-body) td.rstate{font-size:.875rem;line-height:1.35;color:var(--muted);overflow-wrap:anywhere;padding-left:calc(.375rem + 1.25em);text-indent:-1.25em}
:is(.riders-card,.cp-body) .rstate-sign{display:inline-block;min-width:1.25em;text-indent:0;font-weight:700}
:is(.riders-card,.cp-body) td.rstate time{white-space:nowrap;color:var(--muted);font-weight:400}
:is(.riders-card,.cp-body) td.rstate.ok .rstate-sign{color:var(--ok-icon)}
:is(.riders-card,.cp-body) td.rstate.warn{color:var(--warn-fg);font-weight:600}:is(.riders-card,.cp-body) td.rstate.warn .rstate-sign{color:var(--warn-icon)}
:is(.riders-card,.cp-body) td.rstate.err{color:var(--err-fg);font-weight:600}:is(.riders-card,.cp-body) td.rstate.err .rstate-sign{color:var(--err-icon)}
:is(.riders-card,.cp-body) td.rstate.neutral .rstate-sign{color:var(--neutral-icon)}
@container (max-width:31.99rem){
  :is(.riders-card,.cp-body) .rstates,:is(.riders-card,.cp-body) .rstates thead,:is(.riders-card,.cp-body) .rstates tbody{display:block}
  :is(.riders-card,.cp-body) .rstates tr{display:grid;grid-template-columns:2.5rem minmax(0,1fr) 8.75rem}
  .ptable-plan.rstates .pt-pull{width:auto}
  :is(.riders-card,.cp-body) th.rstate,:is(.riders-card,.cp-body) td.rstate:empty{display:none}
  :is(.riders-card,.cp-body) td.rstate{grid-column:2 / -1;border-top:0;padding-top:0}
}

/* top bar (phones): back + team title switcher */
.topbar{position:sticky;top:0;z-index:10;background:var(--bar-bg);-webkit-backdrop-filter:blur(14px) saturate(1.5);backdrop-filter:blur(14px) saturate(1.5);border-bottom:1px solid var(--border);padding-top:env(safe-area-inset-top)}
.topbar-row{display:flex;align-items:center;gap:.25rem;min-height:3.5rem;padding:.375rem max(.75rem,env(safe-area-inset-right)) .375rem max(.5rem,env(safe-area-inset-left));max-width:44rem;margin:0 auto}
.back{display:inline-flex;align-items:center;gap:.125rem;min-height:var(--tap);min-width:var(--tap);padding:0 .5rem 0 .25rem;border-radius:var(--r2);font-weight:600;color:var(--accent);text-decoration:none;flex:none}
.topbar-club{margin-left:auto;min-width:0;padding:0 .25rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.875rem;font-weight:600;color:var(--muted)}
.back .i{width:1.375rem;height:1.375rem}
.topbar-title{font-weight:700}
.switch{flex:1;min-width:0}
.switch>summary{display:flex;align-items:center;gap:.5rem;min-height:var(--tap);padding:.25rem .5rem;border-radius:var(--r2)}
.switch>summary:hover,.switch[open]>summary{background:var(--surface-2)}
.switch h1{font-size:1.375rem;line-height:1.2;font-weight:750;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.sw-icon{display:grid;place-items:center}
.sw-icon.ok{color:var(--ok-icon)}.sw-icon.warn{color:var(--warn-icon)}.sw-icon.err{color:var(--err-icon)}.sw-icon.neutral{color:var(--neutral-icon)}
.sw-short{font-size:.875rem;color:var(--muted);white-space:nowrap;margin-left:auto}
.switch .chev{color:var(--muted);transition:transform .15s}
.switch[open] .chev{transform:rotate(180deg)}
.switch-panel{position:absolute;left:0;right:0;top:100%;background:var(--surface);border-bottom:1px solid var(--border);box-shadow:var(--shadow-pop);padding:.5rem max(.75rem,env(safe-area-inset-right)) .75rem max(.75rem,env(safe-area-inset-left));max-height:calc(100vh - 5rem);overflow-y:auto;overscroll-behavior:contain}
.switch-panel>*{max-width:42rem;margin-inline:auto}
.switch-head{font-size:.8125rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:.25rem .5rem .375rem}
.switch-foot{display:flex;gap:1rem;justify-content:space-between;padding:.5rem .5rem 0;border-top:1px solid var(--border);margin-top:.375rem}
.switch-foot a{display:inline-flex;align-items:center;min-height:var(--tap);font-weight:600}

/* team rows: switcher panel and desktop sidebar */
.trows{display:grid;gap:.125rem}
.trow{display:grid;grid-template-columns:1.25rem minmax(0,1fr);column-gap:.625rem;align-items:start;padding:.625rem .5rem;border-radius:var(--r2);color:var(--text);text-decoration:none}
.trow:hover{background:var(--surface-2)}
.trow .i{margin-top:.15rem}
.trow.ok .i{color:var(--ok-icon)}.trow.warn .i{color:var(--warn-icon)}.trow.err .i{color:var(--err-icon)}.trow.neutral .i{color:var(--neutral-icon)}
.trow-name{font-weight:700}
/* the time line ("Thu 19 Nov 01:30 · in 6 h 19 min") under the name: beside it, it left the name
   a few pixels in the 240 px sidebar, and the name broke after every letter */
.trow-time{grid-column:2;font-size:.875rem;color:var(--muted)}
.trow-main{grid-column:2/-1;font-size:.875rem;line-height:1.35;color:var(--muted)}
.trow.warn .trow-main{color:var(--warn-fg);font-weight:600}.trow.err .trow-main{color:var(--err-fg);font-weight:600}
.trow[aria-current=page]{background:var(--accent-soft);box-shadow:inset 3px 0 0 var(--accent)}
/* the sidebar of every captain page (ui.mjs captainPage): from 1024 px only */
.side{display:none}

/* page */
.page{display:grid;gap:1rem;align-content:start;padding:1rem max(1rem,env(safe-area-inset-right)) 2rem max(1rem,env(safe-area-inset-left));max-width:44rem;margin:0 auto}
/* the start page's banner: as wide as the card under it (user, 23 Nov 2026) */
.home-logo{display:block;width:100%;height:auto;margin:.5rem 0 0;border-radius:var(--r3);box-shadow:var(--shadow)}
.page.narrow{max-width:28rem;padding-top:3rem}
.pagehead{display:grid;gap:.375rem}
.pagehead h1{font-size:1.875rem;line-height:1.15;font-weight:750;letter-spacing:-.01em}
.pagehead .kicker{margin-bottom:-.125rem}
p.race{display:flex;flex-wrap:wrap;align-items:baseline;gap:.25rem .5rem;font-size:1.125rem;font-weight:650}
p.race .in{font-weight:500;color:var(--muted)}
/* the team page's races (races spec §4b): the team's rhythm in the head, then each race ahead (its
   line, its plans), a later race's notes and its live row (its riders: the card), the races that are over at the end */
div.race{display:grid;gap:.75rem;align-content:start;min-width:0;scroll-margin-top:5rem}
div.race.later{padding-top:.5rem;border-top:1px solid var(--border)}
/* the team page's list (user, 24 Nov 2026): the plans not stored yet and each race ahead in a box of
   their own */
.cp-list>:is(div.cp-race,.cp-pending){background:var(--surface);border:1px solid var(--border);border-radius:var(--r3);padding:.875rem 1rem 1rem}
.cp-list>div.cp-race.later{padding-top:.875rem}
/* the team cockpit (team cockpit spec §5, §5.3b): its slots #panel (the flash and the card's top),
   .cp-list and #panel-body (the card's body) in one grid, stacked below 1180 px; an empty slot takes
   no room. The card is one framed box in every state (.cp-top over .cp-body): its head, the rider
   table, the "what happens" slot and the action bar at its bottom */
.cp{display:grid;gap:1rem;align-content:start;min-width:0}
.cp>*{min-width:0}
#panel:empty,#panel-body:empty,#panel-acts:empty,.cp-what:empty,.cp-bar:empty{display:none}
#panel,#panel-body,.cp-plan{scroll-margin-top:5rem}
/* the swap focuses #panel for screen readers; it is no control, so no ring (Safari drew one on a click) */
#panel:focus{outline:none}
.cp-top,.cp-body{background:var(--surface);border:1px solid var(--border);min-width:0}
.cp-top{border-bottom:0;border-radius:var(--r3) var(--r3) 0 0;padding:1rem 1.25rem .25rem}
/* (no shadow: a shadow on either half would draw a seam where they meet) */
.cp-body{border-top:0;border-radius:0 0 var(--r3) var(--r3);padding:.5rem 1.25rem 1rem}
.cp-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.25rem 1rem;min-height:1.875rem}
.cp-title{min-width:0;font-size:1.125rem;font-weight:750;line-height:1.3;overflow-wrap:anywhere}
.cp-close{display:inline-flex;align-items:center;justify-content:center;gap:.25rem;min-height:var(--tap);min-width:var(--tap);padding-inline:.5rem;margin-right:-.5rem;border-radius:var(--r2);color:var(--accent);font-weight:600;text-decoration:none}
.cp-close:hover{background:var(--surface-2)}
/* the card's line under its title: the plan code, then the table's caption or the riders' count, in
   a block of two lines whatever they hold (a third is cut, its words kept for screen readers and in
   the caption's title), so the table starts at the same height in every state (spec §5.3b) */
.cp-meta{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;height:2.8em;line-height:1.4;margin-top:.25rem;font-size:.9375rem;color:var(--muted)}
.cp-meta .plancode{margin:0 .75rem 0 0}
.cp-meta .plancode code{line-height:1.2}
.cp-meta .count{font-size:inherit}
/* the Store form in the card, under the rider table (user, 23 Nov 2026): its fields spaced */
.cp-form{margin-top:1rem;min-width:0}
.cp-form form{display:grid;gap:1rem}
/* the one-shot message in its box (.cp-note), at the end of the card's head (.cp-top: under the title, the
   sheet's ×, the plan code line; user, 24 Nov 2026): in the flow below 1180 px with its own ×, no auto-close
   there; from 1180 px it floats over the card's top (below) */
.cp-note{position:relative;margin-top:.625rem}
.cp-note>:is(.flash,.result){margin:0 0 .5rem}
.cp-note>.result:empty{display:none}
.cp-note>.flash{padding-right:calc(var(--tap) + .25rem)}
.cp-note-x{display:inline-flex;position:absolute;top:0;right:0;align-items:center;justify-content:center;min-width:var(--tap);min-height:var(--tap);border-radius:var(--r2);color:inherit}
.cp-note-x:hover{background:var(--surface-2)}
/* (the card's slot only: a list row's text has the class too and stays centred in its row) */
.cp-body>.cp-what{margin-top:.75rem}
/* the opened version's "Live since …" / "Was live …" under its table, apart from what happens */
.cp-history{margin:0 0 .5rem}
/* the action bar: the same place and height in every state; an action asking first opens its strip
   over the bar's whole width. A status ("LIVE · riders get this", "Read only") at the card body's
   end; the card's actions in #panel-acts (user, 23 Nov 2026): Discard · Store · Make live at the
   bar's right end, Make live the rightmost, Discard 24 px or more from Store (the gap and its own
   padding); an armed Discard's strip on a line of its own under them. Below 1180 px the bar is the
   card's bottom (the card body then open at its foot, .has-acts), from 1180 px it stands in the row
   under the title (below) */
.cp-bar{display:flex;flex-wrap:wrap;align-items:center;gap:.75rem;min-height:var(--btn);margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border)}
.cp-bar>.as-discard{display:contents}
#panel-acts>.cp-bar{justify-content:flex-end}
.cp-bar form.discard:not(.armed){padding-right:.75rem}
.cp-bar form.discard.armed{order:1}
.cp-body.has-acts{border-bottom:0;border-radius:0}
#panel-acts>.cp-bar{position:relative;margin-top:0;padding:1rem 1.25rem;border:1px solid var(--border);border-top:0;border-radius:0 0 var(--r3) var(--r3);background:var(--surface)}
#panel-acts>.cp-bar::before{content:"";position:absolute;top:0;left:1.25rem;right:1.25rem;border-top:1px solid var(--border)}
/* the ways to a plan at the list's top: from 1180 px only (the head has them below that) */
.cp-ways{display:none}
/* the Store form's Make live asking first (user, 23 Nov 2026): its strip takes the bar's place (below
   1180 px; from there the strip floats under the buttons, which stay, user 24 Nov 2026) */
@media not all and (min-width:1180px){.cp-bar.armed>:not(.arm-strip){display:none}}
.cp-status{display:flex;align-items:center;gap:.5rem;min-height:var(--btn);margin:0;font-weight:650}
.cp-status.ok{color:var(--ok-fg)}.cp-status.ok .i{color:var(--ok-icon)}
.cp-status.neutral{color:var(--muted)}.cp-status.neutral .i{color:var(--neutral-icon)}
.cp-over{display:flex;align-items:flex-start;gap:.375rem;color:var(--muted);font-weight:600}
.cp-over .i{flex:none;width:1.125rem;height:1.125rem;margin-top:.1rem}
.cp-gone{color:var(--muted);font-weight:600}
/* a version's plan code (a later race's riders card, the cockpit card's line) */
.plancode{margin-top:.25rem;color:var(--text);font-weight:600}
.plancode code{background:var(--accent-soft);color:var(--accent-soft-fg);border-color:transparent;margin-left:.15rem}
/* the page holds its reload (an open Store form, a Store result to keep): said under the card */
.cp-hold{margin-top:.75rem;color:var(--muted);font-size:.9375rem}
.cp-refresh{display:inline-flex;align-items:center;min-height:var(--tap);font-weight:600}
.cp-list{display:grid;gap:1.25rem;align-content:start}
.cp-sub{font-size:.75rem;font-weight:750;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
/* the box of the plans not stored yet: its heading as a race's line (user, 24 Nov 2026) */
.cp-pending>.cp-sub{min-height:var(--tap);font-size:1.125rem;font-weight:650;letter-spacing:0;text-transform:none;color:var(--text)}
.cp-pending,.cp-plan{display:grid;gap:.125rem;min-width:0}
.cp-plan-head{display:flex;align-items:baseline;flex-wrap:wrap;gap:0 .375rem;min-height:var(--tap);padding-block:.375rem;font-size:1.0625rem}
.cp-plan-head .label{font-weight:750}
.cp-plan-head .tag{align-self:center}
.cp-rows{display:grid}
.cp-row{display:flex;flex-wrap:wrap;align-items:center;gap:.25rem .5rem}
.cp-link{flex:1 1 14rem;display:flex;align-items:center;gap:.5rem;min-width:0;min-height:var(--tap);padding:.375rem .5rem;border-radius:var(--r2);color:var(--text);text-decoration:none}
.cp-link:hover{background:var(--surface-2)}
.cp-what{min-width:0;font-size:.9375rem;overflow-wrap:anywhere}
.cp-link .chev{flex:none;margin-left:auto;color:var(--muted)}
/* the live row's LIVE tag at its end, before the chevron, centred on the row (user, 23 Nov 2026) */
.cp-link>.tag{flex:none;margin-left:auto;align-self:center;vertical-align:0;line-height:1.25}
.cp-link>.tag+.chev{margin-left:0}
.cp-link>.tag+.tag{margin-left:0}
.cp-row.live>.cp-link{box-shadow:inset 3px 0 0 var(--ok-icon)}
.cp-row.live .cp-what{font-weight:650}
.cp-row.picked>.cp-link{background:var(--accent-soft);box-shadow:inset 3px 0 0 var(--accent)}
.cp-older>summary{min-height:var(--tap);padding-left:.5rem;font-size:.9375rem;font-weight:600;color:var(--muted)}
.cp-older[open]>summary{margin-bottom:0}
#over .cp-race{padding-top:.75rem}
#over .cp-race+.cp-race{border-top:1px solid var(--border)}
/* the team page's kicker row with Team settings at its right, as on the teams page (.clubhead); the
   negative margins keep the 44 px link from making the row taller than the kicker (phones; from
   1024 px the page head below) */
.teamhead{display:flex;align-items:center;justify-content:space-between;gap:.75rem;margin-bottom:-.125rem}
.teamhead .kicker{margin:0;min-width:0}
.teamhead .btn{flex:none;margin-block:-.75rem}
/* the team page's way to a plan under the race line (UI panel wave 3): "Upload a plan" at full
   width on phones, as wide as its words from 1024 px; with a planner link (races spec §4) "Plan on
   ZwiftGopher" and "Upload a file" side by side when they fit, else the upload under it (user, 23 Nov
   2026) */
.headacts{display:flex;gap:.5rem}
.headacts>.btn{flex:1 1 0;min-width:0}
.headacts.planner{flex-wrap:wrap;align-items:center;gap:.5rem}
.headacts.planner>.btn{flex:none}
/* on a phone the planner button takes the line's rest, so wrapped it stands at full width as before */
@media not all and (min-width:1024px){.headacts.planner>.btn.primary{flex:1 1 auto}}
/* the breadcrumb (ui.mjs placeNav): from 1024 px only, where it replaces the back bar and the kicker */
.crumbs ol{display:flex;flex-wrap:wrap;align-items:center;gap:0 .375rem;font-size:.9375rem;font-weight:600;color:var(--muted)}
.crumbs li{display:inline-flex;align-items:center;gap:.375rem;min-width:0}
.crumbs a{display:inline-flex;align-items:center;min-height:2rem;color:var(--accent);text-decoration:none}
.crumbs a:hover{text-decoration:underline}
.crumbs [aria-current]{color:var(--text)}
.crumbs .sep{color:var(--muted);font-weight:400}

.foot{display:flex;flex-wrap:wrap;justify-content:center;gap:0 .25rem;padding-top:.5rem;font-size:.9375rem}
.foot a,.foot button{display:inline-flex;align-items:center;gap:.375rem;min-height:var(--tap);padding:0 .625rem;color:var(--muted);background:none;border:0;font:inherit;font-size:.9375rem;text-decoration:underline;text-decoration-color:var(--border);text-underline-offset:.25em;cursor:pointer}
.foot form{display:contents}
.foot-clubs{flex:0 0 100%;display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:0 .25rem;padding-bottom:.25rem;margin-bottom:.25rem;border-bottom:1px solid var(--border)}
.foot-label{flex:0 0 100%;text-align:center;font-size:.8125rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:0}

/* teams page */
.clubhead{display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem;padding-top:.5rem}
.clubhead h1{font-size:1.875rem;line-height:1.15;font-weight:750;letter-spacing:-.01em}
.clubhead .btn{flex:none}
.tiles{display:grid;gap:.75rem}
.tile{display:grid;gap:.5rem;padding:.875rem 1rem 1rem;background:var(--surface);border:1px solid var(--border);border-left:5px solid var(--border);border-radius:var(--r3);box-shadow:var(--shadow);color:var(--text);text-decoration:none}
a.tile:hover{border-color:var(--control)}
.tile.edge-ok{border-left-color:var(--ok-icon)}.tile.edge-warn{border-left-color:var(--warn-icon)}.tile.edge-err{border-left-color:var(--err-icon)}.tile.edge-neutral{border-left-color:var(--neutral-bd)}
.tile-top{display:flex;align-items:baseline;gap:.25rem .75rem;flex-wrap:wrap;position:relative;padding-right:1.75rem}
.tile-name{font-size:1.3125rem;font-weight:750;line-height:1.2}
.tile-time{font-weight:500;color:var(--muted)}
.tile-top .chev{position:absolute;right:0;top:.1rem;color:var(--muted);width:1.5rem;height:1.5rem}
.tile .sevline{font-size:1rem}
.tile-quiet{font-size:.9375rem;color:var(--muted);padding-left:1.75rem}
.hub-add{justify-self:start}
/* the club hub (UI panel wave 3): what to fix across teams, the plans waiting, one table per race day */
.todo{display:grid}
.todo>li{display:grid;grid-template-columns:1.25rem minmax(0,1fr);column-gap:.625rem;row-gap:.375rem;align-items:start;padding:.75rem 0;border-top:1px solid var(--border)}
.todo>li:first-child{border-top:0;padding-top:.25rem}
.todo>li>.i{margin-top:.15rem}
.todo>li.err>.i{color:var(--err-icon)}.todo>li.warn>.i{color:var(--warn-icon)}.todo>li.info>.i{color:var(--info-icon)}
.todo-who{display:flex;flex-wrap:wrap;align-items:baseline;gap:0 .5rem}
.todo-who a,.racetable td a{display:inline-flex;align-items:center;min-height:var(--tap);min-width:var(--tap);font-weight:700;color:var(--text)}
.todo-who .muted{font-size:.9375rem}
.todo-what{grid-column:2;font-weight:600}
.todo>li.err .todo-what{color:var(--err-fg)}.todo>li.warn .todo-what{color:var(--warn-fg)}
.todo-acts{grid-column:2;display:flex;flex-wrap:wrap;align-items:center;gap:.5rem}
.todo-acts>form:not(.discard){display:contents}
.confirm-acts{display:grid;gap:.875rem;justify-items:start}
.todo-acts>.discard{margin-left:auto}
.todo-acts:has(>.discard){gap:1.5rem}
.todo-acts>.discard.armed{margin-left:0}
/* a plan waiting (the hub, user 23 Nov 2026): Review and store and Discard on one line on a phone
   too, Discard at its other end; below 1024 px the line takes the row's whole width (under the icon
   as well), so both fit at 375 px; an armed Discard's strip still takes a line of its own (from
   1024 px the pair sits together at the row's end: the min-width:1024px block) */
@media not all and (min-width:1024px){.todo-acts:has(>.discard){grid-column:1/-1}.todo-acts:has(>.discard:not(.armed)){flex-wrap:nowrap;gap:1rem}}
/* the columns as wide as their words; a word longer than its share breaks rather than widen the page */
.racetable{overflow-wrap:anywhere}
.racetable td{overflow-wrap:break-word}
.racetable th{overflow-wrap:normal}
.racetable .st{width:2.25rem;text-align:center}
.sevicon{display:inline-grid;place-items:center}
.sevicon.ok{color:var(--ok-icon)}.sevicon.warn{color:var(--warn-icon)}.sevicon.err{color:var(--err-icon)}.sevicon.neutral{color:var(--neutral-icon)}

/* first run */
.onboard h2{font-size:1.25rem}
.steps{display:grid;gap:.875rem;counter-reset:s}
.steps li{display:grid;grid-template-columns:2rem 1fr;gap:.75rem;align-items:start}
.steps li>span:last-child{display:grid}
.stepnum{display:grid;place-items:center;width:2rem;height:2rem;border-radius:50%;background:var(--surface-2);font-weight:750;color:var(--muted)}
.steps .now .stepnum{background:var(--accent);color:var(--accent-ink)}

/* team and club settings pages: bands, rows, recordings, danger zone */
.band{font-size:.8125rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:1rem .25rem 0;border-top:1px solid var(--border);margin-top:.5rem}
.rows>li{display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:.625rem 0;border-top:1px solid var(--border)}
.rows>li:first-child{border-top:0}
.rows .nm{font-weight:600}
.rows .meta{font-size:.9375rem;color:var(--muted)}
.rowbtns{display:flex;gap:.375rem;flex:none}
/* a row's strip (a recording's Delete) takes the row's whole width, under the row */
.rows>li:has(form.armed){flex-wrap:wrap}
.rowbtns:has(form.armed){flex:1 1 100%}
.rowbtns .btn{min-width:var(--tap);padding-inline:.625rem}
.recs{display:grid;gap:.75rem}
.recgroup>.nm{font-weight:700;font-size:.9375rem;color:var(--muted);padding-bottom:.25rem}
.log li{display:grid;grid-template-columns:auto 1fr;gap:.75rem;padding:.5rem 0;border-top:1px solid var(--border);font-size:.9375rem}
.log li:first-child{border-top:0}
.log time{color:var(--muted);white-space:nowrap;min-width:3rem}
.log .team{font-weight:600}
.value{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
.value .i{color:var(--muted)}
/* the settings pages' columns of cards (user, 23 Nov 2026): from 1180 px only; below that the boxes
   give their cards to the page, which keeps its one column (.setend: the team's ZwiftGopher link and
   the danger zone at the end) */
.setcols,.setend{display:contents}
.danger-zone{border:1px solid var(--danger-bd);background:var(--danger-soft);border-radius:var(--r3);padding:1.125rem 1rem;display:grid;gap:.75rem;justify-items:start}
.danger-zone h2{display:flex;align-items:center;gap:.5rem;font-size:1.125rem;color:var(--danger-text)}
.danger-zone>form.armed{justify-self:stretch}

/* what shows from 1024 px only: the team page's title in the page, the breadcrumb */
@media (max-width:1023.98px){.desk{display:none!important}}

/* desktop: every captain page in one frame (ui.mjs captainPage): the sidebar with the club, the
   team rows and the footer (the other clubs, Privacy, Log out); beside it the page, left-aligned,
   with one head (kicker, then the title with the page's action right beside it) at the same place
   on every page. The
   phone's top bar (team switcher or back bar) and the page's own footer give way to the sidebar; a
   page below the overview says where it is in its breadcrumb line instead of the back bar and the
   kicker (UI panel wave 3).
   Forms are one column of 46rem; the team page and the overview are 62rem wide, two columns. */
@media (min-width:1024px){
  .app{display:grid;grid-template-columns:18.5rem minmax(0,1fr);grid-template-rows:auto 1fr;min-height:100vh}
  .side{display:flex;flex-direction:column;grid-column:1;grid-row:1 / -1;position:sticky;top:0;align-self:start;height:100vh;overflow-y:auto;background:var(--surface);border-right:1px solid var(--border);padding:1.25rem .75rem}
  .side-club a{display:flex;align-items:center;gap:.25rem;min-height:var(--tap);padding:0 .5rem;border-radius:var(--r2);font-weight:750;font-size:1.125rem;color:var(--text);text-decoration:none}
  .side-club{margin-bottom:.75rem}
  .side-club a:hover{background:var(--surface-2)}
  .side-club a[aria-current=page]{background:var(--accent-soft);box-shadow:inset 3px 0 0 var(--accent);color:var(--text)}
  .side .foot{flex-direction:column;align-items:stretch;margin-top:auto;padding-top:1rem}
  .side .foot a,.side .foot button{padding:0 .5rem}
  .side .foot-clubs{flex:none;flex-flow:column nowrap;align-items:stretch;justify-content:flex-start}
  .side .foot-clubs button{justify-content:flex-start}
  .side .foot-label{flex:none;text-align:left;padding:0 .5rem}
  .app>.topbar,.app>.page>.foot{display:none}
  .app>.page{grid-column:2;grid-row:2;width:100%;max-width:51rem;margin:0;padding:2rem 2.5rem 3rem}
  /* the breadcrumb where the kicker was, the same height, so the title stays where it is */
  .app .crumbs{min-height:1.25rem;margin:-.375rem 0 -.625rem}
  .app .crumbs~.pagehead .kicker{display:none}
  /* a kicker that names the page, not the club (Team settings over the team's name, user 23 Nov 2026) */
  .app .crumbs~.pagehead .kicker.keep{display:flex}
  /* the team page has no breadcrumb: the sidebar names the club and the team (user, 23 Nov 2026) */
  .app .cockpit>.pagehead .kicker{display:none}
  .headacts>.btn{flex:none}
  .headacts.planner{align-items:flex-start}
  /* a plan waiting (the hub, user 23 Nov 2026): Review and store and Discard side by side, the small
     gap between them, at the row's end; an armed Discard's strip goes on a line of its own under
     them while its trigger keeps its place (hidden), so Review and store does not move (review M8) */
  .todo-acts:has(>.discard){display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:.5rem}
  .todo-acts:has(>.discard)>a{grid-column:2}
  .todo-acts>.discard{grid-column:3;margin-left:0}
  .todo-acts>.discard.armed{display:contents}
  .todo-acts>.discard.armed>[data-arm-open]{display:inline-flex;visibility:hidden;grid-column:3;grid-row:1}
  .todo-acts>.discard.armed>[data-arm-strip]{grid-column:1/-1}
  /* the team page's head (user, 23 Nov 2026): the title line holds the title, "Updated 19:16" small and
     raised beside it, and Team settings at its end; Plan on ZwiftGopher and Upload a file side by side,
     right-aligned on a row of their own under it (from 1180 px on the title line: below); the stale
     line, when shown, under all of it at the head's whole width */
  .app .cockpit>.pagehead{display:grid;grid-template-columns:minmax(0,auto) auto 1fr auto auto;grid-template-areas:"title fresh . . set" "acts acts acts acts acts" "stale stale stale stale stale";align-items:center;gap:.375rem .5rem}
  .app .cockpit>.pagehead h1{grid-area:title}
  .app .cockpit>.pagehead .teamhead>.btn{grid-area:set;margin-left:.75rem}
  .app .cockpit>.pagehead>.fresh{grid-area:fresh;align-self:start;margin-top:.125rem;font-size:.8125rem}
  .app .cockpit>.pagehead>.headacts{grid-area:acts;justify-self:end;flex-direction:row;align-items:center;gap:.5rem}
  .app .cockpit>.pagehead>.stale-banner{grid-area:stale}
  /* a question's Cancel beside its confirm button */
  .confirm-acts{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem}
  /* the hub: the team tiles give way to the sidebar */
  .hub-teams{display:none}
  .app>.page.wide{max-width:67rem}
  /* the settings pages at the wide pages' scale (user, 23 Nov 2026: "they seem bigger"): buttons as
     the hub's and the team page's (.btn.small: 15 px, 44 px high), labels and card text 15 px, inputs
     15 px and as high as the buttons beside them; hints and headings as they are. Phones keep
     theirs (inputs 17 px, so iOS does not zoom) */
  .page.settings .btn:not(.small){min-height:var(--tap);padding:.5rem .875rem;font-size:.9375rem}
  .page.settings :is(.card,.danger-zone,label.field){font-size:.9375rem}
  .page.settings input:not([type=checkbox],[type=radio],[type=hidden],[type=file]),.page.settings select{min-height:var(--tap);padding:.5rem .75rem;font-size:.9375rem}
  .nojs{max-width:51rem;margin:0 0 0 18.5rem;padding:.75rem 2.5rem 0}
  /* the head: kicker, then the title and the action beside it; the inner boxes give their items to it */
  .app :is(.pagehead,.clubhead){display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-start;gap:.375rem 1.25rem;padding:0;margin:0}
  .app :is(.clubhead>div,.teamhead){display:contents}
  .app :is(.pagehead,.clubhead)>*,.app :is(.pagehead,.clubhead) .kicker{flex:0 0 100%}
  .app :is(.pagehead,.clubhead) h1{flex:0 1 auto;min-width:0;font-size:2rem;line-height:1.15;font-weight:750;letter-spacing:-.01em}
  .app .kicker{min-height:1.25rem;margin:0}
  /* the action as tall as the title, so the title sits where it does on a page without one */
  .app :is(.pagehead,.clubhead) .btn{flex:none;margin-block:calc((2.3rem - var(--tap)) / 2)}
  .page.wide{max-width:62rem;padding:2rem 2.5rem 3rem}
}
@media (min-width:1180px){
  /* the team page's head: Plan on ZwiftGopher and Upload a file on the title line, before Team
     settings, above the card's column, so the list starts as high as the page's head (user, 23 Nov 2026) */
  .app .cockpit>.pagehead{grid-template-areas:"title fresh . acts set" "stale stale stale stale stale"}
  /* the hub: one line per thing to do, where the words keep 12rem; the buttons in a column of their
     own width, so an open strip wraps under them and moves nothing (below this, stacked as on phones) */
  .todo>li{grid-template-columns:1.25rem minmax(7rem,11rem) minmax(12rem,1fr) 21rem;align-items:start}
  /* top-aligned (an open strip grows the row downwards only), each part centred on the 44 px buttons */
  .todo>li>.i{margin-top:.75rem}
  .todo-what{grid-column:3;margin-top:.55rem}
  .todo-acts{grid-column:4}
  /* the cockpit: the list at the left over all rows, the card at the right (the flash and the card's
     top, then its body, no gap between them); the last row takes what the list is taller, so the
     right column's rows keep their own heights. No close link: the live version is a click on its
     row (spec §5.3b). The race line on one line (A7: "Thu 19 Nov · 19:30 · started · open since
     19:00" beside its ⋯) */
  .cp{grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-rows:minmax(calc(var(--btn) + .75rem),auto) auto auto auto 1fr;gap:0 1.5rem}
  .cp>.cp-list{grid-column:1;grid-row:1 / -1}
  /* the settings pages in the wide frame (user, 23 Nov 2026): the team page's width and left edge,
     their cards flowing into as many columns as fit (24rem or more each: two in the frame's width),
     in the page's order down each column, a card never split, a band kept with the card under it;
     the danger zone last at the whole width */
  .app>.page.settings{max-width:67rem}
  .setcols{display:block;columns:24rem;column-gap:1.5rem}
  .setcols>*{break-inside:avoid;margin:0 0 1rem}
  .setcols>.band{break-after:avoid;margin-top:0}
  .setend{display:grid;grid-template-columns:repeat(auto-fit,minmax(20rem,1fr));gap:1rem 1.5rem;align-items:start}
  .cp>:not(.cp-list){grid-column:2}
  /* one action row under the title (user, 23 Nov 2026): the ways to a plan at its left, at the list's
     top (the head's give way), the card's actions at its right end above the card, its right edge on
     the card's; the row keeps its height without any action. #panel-acts gives its parts to the grid:
     the bar to that row, the hold note under the card. A question of the bar's actions (Make live,
     Discard) opens as a panel floating under the buttons over the card's top, its right edge on the
     card's: nothing moves, the buttons stay where the mouse is (user, 24 Nov 2026). The card ends
     with its body, framed */
  .cp>#panel{grid-row:2}
  .cp>#panel-body{grid-row:3}
  .cp>#panel-acts{display:contents}
  .cp>#panel-acts>.cp-bar{grid-column:2;grid-row:1;align-self:start;justify-content:flex-end;margin:0 0 .75rem;padding:0;border:0;border-radius:0;background:none}
  .cp>#panel-acts>.cp-bar::before{display:none}
  .cp>#panel-acts>.cp-bar form[data-arm].armed{flex-basis:auto;width:auto}
  .cp>#panel-acts>.cp-bar form[data-arm].armed>[data-arm-open]{display:inline-flex}
  .cp>#panel-acts>.cp-bar form.discard.armed{order:0;padding-right:.75rem}
  /* the one-shot message ("is live", a Store result) floats over the card's top, right under the action
     row, on the card's width, below an open question (z-index 5), with a close ×: the card, the list and
     the row do not move (user, 24 Nov 2026) */
  .cp>#panel{position:relative}
  .cp>#panel .cp-note{position:absolute;z-index:4;top:-.375rem;left:0;right:0;margin:0;display:grid;gap:.5rem;padding:.5rem;background:var(--surface);border:1px solid var(--border);border-radius:var(--r3);box-shadow:var(--shadow-pop)}
  .cp>#panel .cp-note>:is(.flash,.result){margin:0}
  .cp>#panel .cp-note>.result{padding:0 .5rem .25rem}
  .cp>#panel .cp-note-x{top:.5rem;right:.5rem}
  .cp>#panel-acts>.cp-bar .arm-strip{position:absolute;z-index:5;top:calc(100% + .375rem);right:0;flex-basis:auto;width:26rem;max-width:100%;background:var(--surface);box-shadow:var(--shadow-pop)}
  .cp>#panel-acts>.cp-bar .arm-btns{justify-content:flex-end}
  /* the row's buttons as small as the ways to a plan beside them (user, 24 Nov 2026: one size on the line) */
  .cp>#panel-acts>.cp-bar{min-height:var(--tap)}
  .cp>#panel-acts>.cp-bar>.btn,.cp>#panel-acts>.cp-bar form>[data-arm-open]{min-height:var(--tap);padding:.5rem .875rem;font-size:.9375rem}
  .cp>#panel-acts>.cp-hold{grid-column:2;grid-row:4}
  .cp-body.has-acts{border-bottom:1px solid var(--border);border-radius:0 0 var(--r3) var(--r3)}
  /* as high as the action row over the card (less the list's gap), so the list's first box and the
     card start on one line (user, 24 Nov 2026) */
  .cp-ways{display:block;height:calc(var(--btn) + .75rem);margin-bottom:-1.25rem}
  .cp-ways>.headacts{flex-direction:row;align-items:center;gap:.5rem}
  .app .cockpit>.pagehead>.headacts{display:none}
  .cp-close{display:none}
  .cp-list p.race,.cp-list .cp-pending>.cp-sub{font-size:1rem}
}
/* the cockpit on phones and narrow windows (team cockpit spec §5.5): the list is the page; with a
   selection the panel is a sheet, a page mode of the body's classes (no overlay, no :has()), so it
   works without the script and the script's swap flips it (and keeps the list's scroll place). The
   sheet is the panel alone, for a version and for a plan not stored yet with its Store form (the
   list gives all of it way) */
@media (max-width:1179.98px){
  body.cockpit.has-sel .topbar,body.cockpit.has-sel main>:not(.cp,.pagehead,.banner),body.cockpit.has-sel .pagehead>:not(.stale-banner),
  body.cockpit.has-sel .cp-list{display:none}
  /* the head's stale line and the DST banner stay (the Store sheet has time fields); a title of two
     lines keeps the close link at its right, never under it */
  .cp-head{flex-wrap:nowrap;align-items:flex-start}
  .cp-title{flex:1}
  .cp-close{margin-left:auto}
  body.cockpit.has-sel .cp{display:flex;flex-direction:column}
  body.cockpit.has-sel #panel{position:sticky;top:0;z-index:5;max-height:45vh;overflow-y:auto;padding-block:.25rem;background:var(--bg);border-bottom:1px solid var(--border)}
  /* the sheet is the page: its card has no frame (its action bar neither, the line above it kept) */
  body.cockpit.has-sel :is(.cp-top,.cp-body,#panel-acts>.cp-bar){background:none;border:0;border-radius:0;box-shadow:none;padding-inline:0}
  body.cockpit.has-sel #panel-acts>.cp-bar::before{left:0;right:0}
  body.cockpit.has-sel #panel-acts{margin-top:-1rem}
  /* a head that holds a Store result (many lines, the ways to the teams still to do) flows with the
     page instead of scrolling inside its 45vh (M3) */
  body.cockpit.has-sel #panel[data-result]{position:static;max-height:none;overflow:visible}
  /* the Store bar (Make live, Store, Discard) on one line down to 360 px (user, 23 Nov 2026) */
  .cp-bar .btn{padding-inline:.875rem}
  /* nothing picked: the list's blocks and the panel's parts are the grid's own items (the list's box
     goes, its region name stays), so the card (its head with the message under it; the nearest race's live
     version, its riders) follows the nearest race, before the later races, Over and the help (M1);
     its row is marked as live, not as picked: no sheet is open. From 1180 px the list is one item in
     the left column */
  body.cockpit:not(.has-sel) .cp{gap:1.25rem}
  body.cockpit:not(.has-sel) :is(.cp-list,#panel){display:contents}
  body.cockpit:not(.has-sel) .cp-list>*{order:3;min-width:0}
  body.cockpit:not(.has-sel) .cp-list>:is(.cp-race:first-child,.cp-ways+.cp-race,.cp-pending:first-child,.cp-ways+.cp-pending,.cp-pending:first-child+.cp-race,.cp-ways+.cp-pending+.cp-race){order:1}
  body.cockpit:not(.has-sel) :is(#panel>.cp-top,#panel-body,#panel-acts){order:2}
  body.cockpit:not(.has-sel) :is(#panel-body,#panel-acts){margin-top:-1.25rem}
  body.cockpit:not(.has-sel) .cp-row.picked>.cp-link{background:none;box-shadow:inset 3px 0 0 var(--ok-icon)}
  body.cockpit:not(.has-sel) .cp-row.picked>.cp-link:hover{background:var(--surface-2)}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}

/* plain pages */
/* the admin pages (page() in pages.mjs): their old rules under body.plain,
   in the tokens' colours; the reverts come first so the base reset doesn't flatten them */
.plain :is(h1,h2,h3,h4,p,ul,ol,form){margin:revert}
.plain :is(ul,ol){padding-left:1.5rem;list-style:revert}
.plain :is(button,input:not([type=checkbox],[type=radio]),select){min-height:var(--tap)}
.plain{overflow-wrap:normal}
.plain details>summary{list-style:revert}.plain details>summary::-webkit-details-marker{display:revert}
body.plain{font:16px/1.4 system-ui,sans-serif;max-width:46rem;margin:1.5rem auto;padding:0 1rem;color:var(--text);background:var(--bg)}
.plain h1{font-size:1.5rem}.plain h2{font-size:1.15rem;margin-top:2rem}.plain h3{font-size:1rem;margin:1.2rem 0 .4rem}
.plain form.up{display:grid;gap:.8rem;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:1rem}
.plain label{display:grid;gap:.25rem;font-weight:600}.plain label span{font-weight:400;color:var(--muted);font-size:.9rem}
.plain input[type=text],.plain input[type=email],.plain select{font:inherit;padding:.4rem}
.plain label.check{display:flex;gap:.5rem;align-items:baseline;font-weight:400}
.plain button{font:inherit;padding:.5rem 1rem;cursor:pointer}
.plain table{border-collapse:collapse;width:100%;background:var(--surface)}.plain th,.plain td{border:1px solid var(--border);padding:.3rem .6rem;text-align:left}
.plain td.n,.plain th.n{text-align:right}
.plain .err{background:var(--err-bg);border:1px solid var(--err-bd);padding:.7rem 1rem;border-radius:6px}
.plain .ok{background:var(--ok-bg);border:1px solid var(--ok-bd);padding:.7rem 1rem;border-radius:6px}
.plain .warn{background:var(--warn-bg);border:1px solid var(--warn-bd);padding:.5rem 1rem;border-radius:6px}
.plain .amber{background:var(--warn-bg);color:var(--warn-fg);padding:0 .3em;border-radius:3px}
.plain code{font-size:1.1em;letter-spacing:.08em}
.plain form.del{margin:0}
.plain section.card{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:.2rem 1rem 1rem;margin:1rem 0}
.plain h4{font-size:.95rem;margin:.8rem 0 .3rem}
.plain section.card form,.plain section.club form{margin:.4rem 0}
.plain section.card label,.plain section.club label{display:inline-grid;font-weight:400;margin-right:.5rem}
.plain li form,.plain td form,.plain p form{display:inline}
.plain p.status{font-weight:600}
.plain details{margin:.6rem 0}.plain summary{cursor:pointer}
.plain form.upload{display:grid;gap:.6rem;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:1rem}
.plain form.upload textarea{font:inherit;font-size:.85rem;width:100%;box-sizing:border-box}
.plain fieldset{border:1px solid var(--border);border-radius:4px;margin:0}
`;
