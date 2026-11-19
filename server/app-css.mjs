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

/* buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;min-height:var(--btn);padding:.625rem 1.125rem;border-radius:var(--r2);border:1px solid transparent;font:inherit;font-size:1rem;font-weight:600;line-height:1.25;text-align:center;text-decoration:none;cursor:pointer;-webkit-tap-highlight-color:transparent}
.btn.primary{background:var(--accent);color:var(--accent-ink);box-shadow:var(--shadow)}
.btn.primary:hover{background:var(--accent-hover)}
.btn.secondary{background:var(--surface);color:var(--text);border-color:var(--control)}
.btn.secondary:hover{background:var(--surface-2)}
.btn.danger{background:var(--surface);color:var(--danger-text);border-color:var(--danger-text)}
.btn.danger:hover{background:var(--danger-soft)}
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
.note-acts{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem}
.newplans{display:inline-block;font-size:.8125rem;font-weight:700;line-height:1.3;padding:.05rem .45rem;border-radius:999px;background:var(--accent-soft);color:var(--accent-soft-fg);border:1px solid var(--accent);white-space:nowrap;vertical-align:.1em}
.callout ol{margin-top:.75rem;display:grid;gap:.75rem}
.note{display:grid;gap:.625rem;padding:.875rem;border-radius:var(--r2);background:var(--surface);color:var(--text);border:1px solid var(--border);border-left:4px solid}
.note.err{border-left-color:var(--err-icon)}.note.warn{border-left-color:var(--warn-icon)}
.note-title{display:flex;gap:.5rem;align-items:flex-start;line-height:1.35}
.note.err .note-title .i{color:var(--err-icon)}.note.warn .note-title .i{color:var(--warn-icon)}
.note .btn{justify-self:start}
.evcount{display:grid;gap:.125rem;font-size:.9375rem;padding:.5rem .75rem;border-radius:var(--r1);background:var(--surface-2)}

/* plan rows (team page): one per plan, the live one marked by tag and accent bar */
.tag.off{background:var(--err-bg);color:var(--err-fg);border-color:var(--err-bd)}
.rider.plan{min-height:2.75rem}
.planinfo{min-width:0}
.planrow{display:grid;gap:.375rem}
.planrow.live{padding-left:.75rem;margin-left:-.25rem;box-shadow:inset 3px 0 0 var(--ok-icon)}
.planrow .l1{font-size:1.0625rem;font-weight:600;line-height:1.35}
.planlink{display:flex;align-items:baseline;flex-wrap:wrap;gap:0 .375rem;min-height:var(--tap);padding-block:.375rem;color:var(--text);text-decoration:none}
.planlink .label{font-weight:750;font-size:1.125rem}
.planlink .muted{font-weight:400;font-size:.9375rem}
.planlink .chev{margin-left:auto;align-self:center;color:var(--muted)}
.planlink .tag{align-self:center}
.planrow .l2{display:flex;flex-wrap:wrap;gap:.125rem 1rem;font-size:.9375rem;color:var(--muted)}
.planrow .l3{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem 1rem;margin-top:.375rem;padding-top:.625rem;border-top:1px solid var(--border)}
.planrow .l4{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.5rem 1rem}
.planrow .vsum{flex:1 1 10rem;font-weight:600}
.planrow .confirm[open]{flex-basis:100%}
.newer{margin-top:.25rem;display:flex;flex-wrap:wrap;align-items:center;gap:.5rem 1rem;padding:.625rem .875rem;border-radius:var(--r2);background:var(--surface-2);border:1px solid var(--border);font-size:.9375rem}
.newer>p{display:flex;gap:.5rem;align-items:center;flex:1 1 12rem;font-weight:600}
.newer>p .i{color:var(--muted);width:1.125rem;height:1.125rem;flex:none}
.plancode{color:var(--text);font-weight:600}
.plancode code{background:var(--accent-soft);color:var(--accent-soft-fg);border-color:transparent;margin-left:.15rem}

/* in-page confirms and folds: they open inline, never as a popover or a fixed bar */
details>summary{list-style:none;cursor:pointer}
details>summary::-webkit-details-marker{display:none}
.menu-info{display:grid;font-size:.9375rem}
.menu-info span{color:var(--muted)}
.confirm-body{display:grid;gap:.625rem;padding:.75rem .625rem .5rem;font-size:.9375rem}
.confirm-body .btn{justify-self:start}
.confirm.inline>summary{display:inline-flex}
.confirm[open]>summary.btn{background:var(--surface-2)}

/* riders */
.riders{display:grid}
.rider{display:grid;grid-template-columns:1.5rem minmax(0,1fr) auto;align-items:center;column-gap:.625rem;min-height:3.25rem;padding:.5rem 0;border-top:1px solid var(--border)}
.riders>li:first-child{border-top:0}
.rider .i{width:1.375rem;height:1.375rem}
.rider .who{display:grid;min-width:0}
.rider .nm{font-weight:600;line-height:1.3}
.rider .what{font-size:.9375rem;line-height:1.35}
.rider>time{font-size:.9375rem;color:var(--muted);white-space:nowrap}
.rider.ok .i{color:var(--ok-icon)}.rider.ok .what{color:var(--muted)}
.rider.warn .i{color:var(--warn-icon)}.rider.warn .what{color:var(--warn-fg);font-weight:600}
.rider.err .i{color:var(--err-icon)}.rider.err .what{color:var(--err-fg);font-weight:600}
.rider.neutral .i{color:var(--neutral-icon)}.rider.neutral .what{color:var(--muted)}
.rider.plan .pos{font-weight:700;color:var(--muted);text-align:center;font-variant-numeric:tabular-nums}
.rider.plan .what{color:var(--muted)}
.help>summary{display:inline-flex;align-items:center;gap:.375rem;min-height:var(--tap);color:var(--accent);font-weight:600;font-size:.9375rem}
.help .i{width:1.125rem;height:1.125rem}

/* plans */
.plans>li{position:relative;padding:.75rem 0;border-top:1px solid var(--border)}
.plans>li:first-child{border-top:0;padding-top:.25rem}
.plans>li.live{padding-block:.75rem}
.plans>li.live:first-child{padding-top:.25rem}
.plans .nm{font-weight:650}
.plans .meta{font-size:.9375rem;color:var(--muted)}
.plans .planinfo{display:grid;gap:.375rem;justify-items:start}
.outdated{display:flex;gap:.375rem;align-items:flex-start;font-size:.9375rem;color:var(--warn-fg);font-weight:600}
.outdated .i{color:var(--warn-icon);width:1.125rem;height:1.125rem;margin-top:.1rem}
.undocard .btn{justify-self:start}
.undocard form{margin-top:.75rem}
.undocard p+form,.undocard form+p{margin-top:.75rem}

.rowlink{display:flex;align-items:center;gap:.75rem;text-decoration:none;color:var(--text);padding-block:.75rem}
.rowlink>span{display:grid;flex:1}
.rowlink .chev{color:var(--muted)}
.uplink{display:inline-flex;align-items:center;gap:.5rem;min-height:var(--tap);font-weight:600;color:var(--accent);justify-self:start}
.pp-state{font-weight:650}
.pp-state.live{color:var(--ok-fg)}
.plan-actions .rowlink{padding-block:.25rem;min-height:2.75rem}
.plan-actions .btn{justify-self:start}

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
.as-when{display:flex;flex-wrap:wrap;gap:.75rem}
.as-when>label,.as-when>.as-fixed{flex:1 1 12rem}
.as-fixed{display:grid;gap:.375rem;align-content:start;margin:0}
.as-fixed span{min-height:var(--btn);display:flex;align-items:center}
#weekday-hint a{display:inline-block;padding:.8125rem 0;margin:-.8125rem 0}
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
.card.fold{padding-block:.5rem}
.card.fold[open]{padding-bottom:1.125rem}
.filepick{display:grid;gap:.5rem;justify-items:start}
.fname{display:flex;align-items:center;gap:.5rem;font-weight:600;flex-wrap:wrap}
.fname .i{color:var(--muted)}

/* the assign page's "What happens", the result page's lines */
.pv-list{display:grid;gap:.5rem}
.pv-list li{display:flex;gap:.625rem;align-items:flex-start;line-height:1.4}
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
.page.narrow{max-width:28rem;padding-top:3rem}
.pagehead{display:grid;gap:.375rem}
.pagehead h1{font-size:1.875rem;line-height:1.15;font-weight:750;letter-spacing:-.01em}
.pagehead .kicker{margin-bottom:-.125rem}
.race{display:flex;flex-wrap:wrap;align-items:baseline;gap:.25rem .5rem;font-size:1.125rem;font-weight:650}
.race .in{font-weight:500;color:var(--muted)}
.cols,.col-a,.col-b,.col-c{display:grid;gap:1rem;align-content:start;min-width:0}
.col-a:empty,.col-b:empty,.col-c:empty{display:none}
/* the team page's kicker row with Team settings at its right, as on the teams page (.clubhead); the
   negative margins keep the 44 px link from making the row taller than the kicker (phones; from
   1024 px the page head below) */
.teamhead{display:flex;align-items:center;justify-content:space-between;gap:.75rem;margin-bottom:-.125rem}
.teamhead .kicker{margin:0;min-width:0}
.teamhead .btn{flex:none;margin-block:-.75rem}

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
.tile.add{display:flex;align-items:center;justify-content:center;gap:.5rem;min-height:3.5rem;box-shadow:none;background:transparent;border:1.5px dashed var(--control);font-weight:700;color:var(--accent)}

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
.rowbtns .btn{min-width:var(--tap);padding-inline:.625rem}
.recs{display:grid;gap:.75rem}
.recgroup>.nm{font-weight:700;font-size:.9375rem;color:var(--muted);padding-bottom:.25rem}
.log li{display:grid;grid-template-columns:auto 1fr;gap:.75rem;padding:.5rem 0;border-top:1px solid var(--border);font-size:.9375rem}
.log li:first-child{border-top:0}
.log time{color:var(--muted);white-space:nowrap;min-width:3rem}
.log .team{font-weight:600}
.value{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
.value .i{color:var(--muted)}
.danger-zone{border:1px solid var(--danger-bd);background:var(--danger-soft);border-radius:var(--r3);padding:1.125rem 1rem;display:grid;gap:.75rem;justify-items:start}
.danger-zone h2{display:flex;align-items:center;gap:.5rem;font-size:1.125rem;color:var(--danger-text)}
.danger-zone .confirm-body{padding-inline:0}

/* what shows from 1024 px only: the team page's title in the page, a kicker where the phone's top
   bar names the club or team */
@media (max-width:1023.98px){.desk{display:none!important}}

/* desktop: every captain page in one frame (ui.mjs captainPage): the sidebar with the club, the
   team rows and the footer (the other clubs, Privacy, Log out); beside it the page, left-aligned,
   with one head (kicker, then the title with the page's action right beside it) at the same place
   on every page. The
   phone's team switcher and the page's own footer give way to the sidebar; a back bar stays, as a
   slim link line above the head in the page's column (row 1; without one the row collapses).
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
  .app>.topbar:not(.plain),.app>.page>.foot{display:none}
  /* the back bar: no bar, no club name (the sidebar names it), the link where the head begins */
  .app>.topbar.plain{grid-column:2;grid-row:1;position:static;background:none;-webkit-backdrop-filter:none;backdrop-filter:none;border:0;padding:1.25rem 0 0}
  .app>.topbar.plain .topbar-row{max-width:51rem;min-height:0;margin:0;padding:0 2.5rem}
  .app>.topbar.plain .topbar-club{display:none}
  .app>.topbar.plain .back{min-height:2rem;margin-left:-.375rem}
  .app>.page{grid-column:2;grid-row:2;width:100%;max-width:51rem;margin:0;padding:2rem 2.5rem 3rem}
  .app>.topbar.plain~.page{padding-top:.75rem}
  .app>.page.wide{max-width:67rem}
  .nojs{max-width:51rem;margin:0 0 0 18.5rem;padding:.75rem 2.5rem 0}
  /* the head: kicker, then the title and the action beside it; the inner boxes give their items to it */
  .app :is(.pagehead,.clubhead){display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-start;gap:.375rem 1.25rem;padding:0;margin:0}
  .app :is(.clubhead>div,.teamhead){display:contents}
  .app :is(.pagehead,.clubhead)>*,.app :is(.pagehead,.clubhead) .kicker{flex:0 0 100%}
  .app :is(.pagehead,.clubhead) h1{flex:0 1 auto;min-width:0;font-size:2rem;line-height:1.15;font-weight:750;letter-spacing:-.01em}
  .app .kicker{min-height:1.25rem;margin:0}
  /* the action as tall as the title, so the title sits where it does on a page without one */
  .app :is(.pagehead,.clubhead) .btn{flex:none;margin-block:calc((2.3rem - var(--tap)) / 2)}
  .tiles{grid-template-columns:repeat(2,minmax(0,1fr))}
  .page.wide{max-width:62rem;padding:2rem 2.5rem 3rem}
}
@media (min-width:1180px){
  .teampage .cols{grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-areas:"a b" "c b";grid-template-rows:auto 1fr;column-gap:1.25rem}
  .teampage .col-a{grid-area:a}.teampage .col-b{grid-area:b}.teampage .col-c{grid-area:c}
  /* without the riders (no live plan) one column, no empty one beside it */
  .teampage .cols:has(>.col-b:empty){grid-template-columns:minmax(0,46rem);grid-template-areas:"a" "c";grid-template-rows:auto}
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
