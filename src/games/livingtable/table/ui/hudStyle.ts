/**
 * The HUD's stylesheet and its style id.
 */

export const HUD_STYLE_ID = "lto-hud-style";
export const HUD_CSS = `
.lto-root.lto-hud{position:relative;inset:auto;overflow:visible;pointer-events:auto;z-index:auto;display:flex;flex-direction:column;gap:8px;width:100%}
.lto-hud-panel{display:flex;flex-direction:column;gap:6px;padding:8px 10px}
.lto-hud-lines{display:flex;flex-direction:column;gap:3px}
.lto-hud-bars{display:flex;flex-direction:column;gap:5px;margin-top:2px}
.lto-hud-bar{display:grid;grid-template-columns:minmax(0,auto) minmax(40px,1fr) auto;align-items:center;gap:8px}
.lto-hud-meter{position:relative;height:10px;overflow:hidden}
.lto-hud-meter>i{position:absolute;left:0;top:0;bottom:0;background:var(--hp)}
.lto-hud-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
.lto-hud-btn{appearance:none;font:inherit;color:inherit;margin:0;min-width:0;overflow:hidden;display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:44px;padding:6px 10px;cursor:pointer;text-align:left;touch-action:manipulation}
.lto-hud-btn:disabled{cursor:default;opacity:.42}
.lto-hud-btn:focus-visible{outline:2px solid var(--sb-focus);outline-offset:2px}
.lto-hud-key{opacity:.75}
.lto-hud-pack,.lto-hud-logview,.lto-hud-savesview{display:flex;flex-direction:column;gap:6px;min-width:0}
.lto-hud-pack-list{position:relative;max-height:176px;overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column;gap:7px;padding-right:4px;scrollbar-width:thin}
.lto-hud-sec{display:flex;flex-direction:column;gap:2px;min-width:0}
.lto-hud-row{min-width:0;padding:1px 4px;overflow-wrap:anywhere}
.lto-hud-seclabel,.lto-hud-item{display:block;min-width:0}
.lto-hud-row[data-lt-tip]{cursor:help;border-radius:3px}
.lto-px .lto-hud-row[data-lt-tip]{box-shadow:inset 0 -1px 0 rgb(152 165 216/.28)}
.lto-sb .lto-hud-row[data-lt-tip]{box-shadow:inset 0 -1px 0 rgb(var(--sb-shade)/.18)}
.lto-px .lto-hud-row[data-lt-tip]:hover,.lto-px .lto-hud-row[data-lt-tip]:focus-visible{background:rgb(77 93 166/.3)}
.lto-sb .lto-hud-row[data-lt-tip]:hover,.lto-sb .lto-hud-row[data-lt-tip]:focus-visible{background:rgb(var(--sb-shade)/.1)}
.lto-hud-row[data-lt-tip]:focus-visible{outline:2px solid var(--sb-focus);outline-offset:1px}
.lto-hud-row.is-new{animation:lto-hud-new 1.8s ease-out}
@keyframes lto-hud-new{0%,35%{background:rgb(255 205 70/.55);box-shadow:inset 3px 0 0 #ffc72a}100%{background:rgb(255 205 70/0);box-shadow:inset 3px 0 0 rgb(255 199 42/0)}}
@media (prefers-reduced-motion: reduce){.lto-hud-row.is-new{background:rgb(255 205 70/.28);box-shadow:inset 3px 0 0 #ffc72a}}
.lto-hud-btn[data-new="true"]::after{content:"";flex:none;width:8px;height:8px;border-radius:50%;background:#ffc72a;box-shadow:0 0 0 2px rgb(0 0 0/.5)}
.lto-px .lto-hud-pack-list{scrollbar-color:#4d5da6 #05061a}
.lto-px .lto-hud-seclabel canvas,.lto-px .lto-hud-item canvas{display:block}
.lto-px .lto-hud-btn[data-new="true"]::after{border-radius:0}
.lto-sb .lto-hud-pack-list{scrollbar-color:var(--sb-rule) transparent}
.lto-sb .lto-hud-seclabel{font:700 12px/1.2 var(--lto-serif);letter-spacing:.07em;text-transform:uppercase;color:var(--sb-spk)}
.lto-sb .lto-hud-item{font:14px/1.3 var(--lto-serif);color:var(--sb-ink)}
@keyframes lto-hud-pulse{0%,100%{filter:none}50%{filter:brightness(1.35) drop-shadow(0 0 6px rgb(255 205 70/.9))}}
.lto-hud-btn.is-now:not(:disabled){animation:lto-hud-pulse 1.1s ease-in-out infinite}
.lto-px .lto-hud-meter{background:#0b0d22;box-shadow:0 0 0 2px #05061a}
.lto-px .lto-hud-btn.lto-fr{background:#141a3c}
.lto-px .lto-hud-btn:not(:disabled):hover{--frame:var(--fr-blue)}
.lto-sb .lto-hud-title{font:700 16px/1.2 var(--lto-serif);color:var(--sb-ink);letter-spacing:.02em}
.lto-sb .lto-hud-line{font:14px/1.35 var(--lto-serif);color:var(--sb-muted)}
.lto-sb .lto-hud-name{font:600 14px/1.2 var(--lto-serif);color:var(--sb-ink)}
.lto-sb .lto-hud-num{font:700 14px/1 var(--lto-num);color:var(--sb-ink);font-variant-numeric:tabular-nums}
.lto-sb .lto-hud-meter{height:9px;border-radius:999px;background:var(--sb-paper2);box-shadow:inset 0 0 0 1px var(--sb-rule)}
.lto-sb .lto-hud-btn{border-radius:9px;background:linear-gradient(180deg,var(--sb-paper),var(--sb-paper2));border:1px solid var(--sb-rule);box-shadow:inset 0 0 0 2px var(--sb-paper),inset 0 0 0 3px var(--sb-gold);font:700 15px/1 var(--lto-serif);color:var(--sb-ink)}
.lto-sb .lto-hud-btn.is-now:not(:disabled){box-shadow:0 0 0 3px var(--sb-gold),inset 0 0 0 2px var(--sb-paper),inset 0 0 0 3px var(--sb-gold)}
.lto-sb .lto-hud-key{font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:2px 5px;border:1px solid currentColor;border-radius:4px}
.lto-hud-next{display:flex;flex-direction:column;gap:4px;min-width:0}
.lto-hud-next-label{padding:0 2px}
.lto-sb .lto-hud-next-label{font:700 11px/1.1 var(--lto-serif);letter-spacing:.1em;text-transform:uppercase;color:var(--sb-spk)}
.lto-hud-next-list{display:grid;grid-template-columns:repeat(var(--cols,1),minmax(0,1fr));gap:6px}
.lto-hud-next-list>.lto-hud-btn:last-child:nth-child(odd){grid-column:1/-1}
.lto-hud-opt{justify-content:flex-start;gap:8px;text-align:left;align-items:center}
.lto-hud-opt .lto-hud-key{flex:none}
.lto-hud-opt-label{min-width:0;flex:1 1 auto;overflow-wrap:anywhere}
.lto-hud-opt-label canvas{display:block}
.lto-sb .lto-hud-opt{font:600 14px/1.2 var(--lto-serif);border-color:var(--sb-gold);padding-left:14px;box-shadow:inset 5px 0 0 var(--sb-gold),inset 0 0 0 1px var(--sb-paper),0 0 0 1px rgb(var(--sb-shade)/.3)}
.lto-sb .lto-hud-opt-label{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
.lto-hud-actions>.lto-hud-btn:last-child:nth-child(odd){grid-column:1/-1}
.lto-hud-drawer-btns{display:grid;grid-template-columns:repeat(var(--n,3),minmax(0,1fr));gap:6px}
.lto-hud-drawer-btns[data-cols="2"]>.lto-hud-tab:last-child:nth-child(odd){grid-column:1/-1}
.lto-hud-tab{position:relative;min-height:36px;padding:4px 8px}
.lto-px .lto-hud-tab{padding:4px 6px}
.lto-hud-tab[data-new="true"]::after{position:absolute;top:2px;right:2px;width:7px;height:7px}
.lto-px .lto-hud-tab[data-new="true"]::after{top:0;right:0;width:6px;height:6px}
.lto-sb .lto-hud-btn.is-open{box-shadow:0 0 0 3px var(--sb-gold),inset 0 0 0 2px var(--sb-paper),inset 0 0 0 3px var(--sb-gold)}
.lto-hud-drawer{display:flex;flex-direction:column;gap:6px;padding:8px 10px;min-width:0}
.lto-hud-notices{display:flex;flex-direction:column;gap:4px;align-items:flex-start;min-width:0}
.lto-hud-notice{max-width:100%;min-width:0;padding:2px 10px;overflow-wrap:anywhere}
.lto-px .lto-hud-notice{padding:0 3px}
.lto-px .lto-hud-notice canvas{display:block}
.lto-sb .lto-hud-notice{border-radius:999px;box-shadow:0 0 0 1px rgb(var(--sb-shade)/.4),0 3px 8px rgb(0 0 0/.3),inset 0 0 0 1px var(--sb-gold)}
.lto-hud-logrow{min-width:0;padding:1px 4px;overflow-wrap:anywhere}
.lto-hud-logrow[data-tone="dm"]{padding-left:8px;box-shadow:inset 2px 0 0 #ffc72a}
.lto-hud-save{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:2px 4px}
.lto-hud-save-info{display:flex;flex-direction:column;gap:2px;min-width:0}
.lto-hud-load{min-height:34px;padding:4px 12px;justify-content:center}
.lto-hud-row[data-lt-card]{cursor:pointer}
.lto-hud-exportrow{display:flex;flex-wrap:wrap;gap:6px}
.lto-hud-settingsview{display:flex;flex-direction:column;gap:10px;min-width:0}
.lto-hud-setting{display:flex;flex-direction:column;gap:4px;min-width:0}
.lto-hud-choices{display:flex;flex-wrap:wrap;gap:6px;min-width:0}
.lto-hud-choice{flex:1 1 auto;justify-content:center;min-height:38px;padding:4px 6px;text-align:center}
.lto-px .lto-hud-choice canvas{display:block}
.lto-hud-export{flex:1 1 auto;justify-content:center;min-height:38px;padding:4px 12px;text-align:center}
.lto-px .lto-hud-export canvas{display:block}
.lto-hud-export-status{min-width:0;padding:0 2px}
.lto-px .lto-hud-load canvas{display:block}
.lto-hud-tab canvas,.lto-hud-opt canvas{flex:none}
.lto-hud-pack-list.lto-hud-journal{max-height:300px}
.lto-hud-journalview{display:flex;flex-direction:column;gap:6px;min-width:0}
.lto-hud-obj{display:grid;grid-template-columns:20px minmax(0,1fr);gap:6px;align-items:start;padding:1px 4px;min-width:0}
.lto-hud-obj canvas{display:block}
.lto-hud-box{display:grid;place-items:center;width:18px;height:18px}
.lto-hud-box canvas{display:block}
.lto-sb .lto-hud-box{width:16px;height:16px;margin-top:2px;border:2px solid var(--sb-rule);border-radius:4px;background:var(--sb-paper)}
.lto-sb .lto-hud-box.is-done{background:var(--sb-good);border-color:var(--sb-good)}
.lto-hud-box svg{display:block;width:10px;height:10px;fill:#fff}
.lto-hud-beat{min-width:0;padding:1px 4px;overflow-wrap:anywhere}
.lto-sb .lto-hud-tone-good{color:var(--sb-good)}
.lto-sb .lto-hud-tone-bad{color:var(--sb-bad)}
.lto-sb .lto-hud-tone-dm{color:var(--sb-spk);font-style:italic}
`;

/**
 * The in-game menu (gameMenu.ts): a panel that fills the stage, a row of tabs, and a body that scrolls. Its tokens follow the sheet's two
 * looks (storybook parchment, pixel navy and gold). It is a size container so the layout answers to the room the stage gives it, from a
 * 320 px phone to a wide desktop, not to the page.
 */
export const MENU_STYLE_ID = "lto-menu-style";
export const MENU_CSS = `
.lto-root.lto-gm{--gm-bg:#efe3c4;--gm-panel:#f8f0da;--gm-ink:#2a2016;--gm-muted:#6a5a3f;--gm-edge:#7c5c1e;--gm-accent:#8a5208;--gm-good:#2a6a33;--gm-bad:#a5281c;--gm-soft:#e8d8b0;--gm-focus:#1d63e0;--gm-t1:#2a6a33;--gm-t2:#2a5db0;--gm-t3:#a8700c;
  pointer-events:auto;z-index:45;display:flex;flex-direction:column;overflow:hidden;background:var(--gm-bg);color:var(--gm-ink);text-align:left;container-type:inline-size;container-name:gm;font:14px/1.4 var(--lto-serif)}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .lto-root.lto-gm.lto-sb{--gm-bg:#181526;--gm-panel:#25203a;--gm-ink:#f3e9cf;--gm-muted:#b6ab90;--gm-edge:#c79d45;--gm-accent:#ffd27a;--gm-good:#86e096;--gm-bad:#ff8c7a;--gm-soft:#312b4d;--gm-focus:#8db7ff;--gm-t1:#86e096;--gm-t2:#7fb0ff;--gm-t3:#ffd27a}}
:root[data-theme="dark"] .lto-root.lto-gm.lto-sb{--gm-bg:#181526;--gm-panel:#25203a;--gm-ink:#f3e9cf;--gm-muted:#b6ab90;--gm-edge:#c79d45;--gm-accent:#ffd27a;--gm-good:#86e096;--gm-bad:#ff8c7a;--gm-soft:#312b4d;--gm-focus:#8db7ff;--gm-t1:#86e096;--gm-t2:#7fb0ff;--gm-t3:#ffd27a}
.lto-root.lto-gm.lto-px{--gm-bg:#0a0e2a;--gm-panel:#141a3c;--gm-ink:#f4ecd0;--gm-muted:#98a5d8;--gm-edge:#4d5da6;--gm-accent:#ffc72a;--gm-good:#59dd82;--gm-bad:#ff5a4a;--gm-soft:#1f2858;--gm-focus:#8db7ff;--gm-t1:#59dd82;--gm-t2:#59a8ff;--gm-t3:#ffc72a;
  font:13.5px/1.4 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.lto-gm :focus-visible{outline:2px solid var(--gm-focus);outline-offset:2px}
.lto-gm-head{flex:none;display:flex;align-items:center;gap:8px;padding:8px 6px;background:var(--gm-bg);border-bottom:1px solid var(--gm-edge)}
@container gm (min-width:400px){.lto-gm-head{padding:8px 10px}.lto-gm-tabs{gap:6px!important}}
.lto-px .lto-gm-head{border-bottom-width:2px}
.lto-gm-tabs{flex:1;min-width:0;max-width:900px;margin:0 auto;display:grid;grid-template-columns:repeat(6,minmax(44px,1fr));gap:2px}
.lto-gm-tab{appearance:none;font:inherit;color:inherit;margin:0;min-width:44px;min-height:44px;padding:4px 2px;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;touch-action:manipulation;
  background:var(--gm-soft);border:1px solid var(--gm-edge);border-radius:9px;font-weight:700}
.lto-gm-tab:disabled{opacity:.42;cursor:default}
.lto-gm-tab[aria-selected="true"]{background:var(--gm-panel);box-shadow:0 0 0 2px var(--gm-accent);border-color:var(--gm-accent)}
.lto-px .lto-gm-tab{border-width:2px;border-radius:0;box-shadow:0 0 0 2px #05061a}
.lto-px .lto-gm-tab[aria-selected="true"]{box-shadow:0 0 0 2px #05061a,0 0 0 4px var(--gm-accent)}
.lto-gm-icon{flex:none;width:20px;height:20px;fill:currentColor}
.lto-gm-tab-label{display:none;min-width:0}
.lto-gm-tab-label canvas{display:block}
@container gm (min-width:600px){.lto-gm-tab-label{display:inline}}
.lto-gm-foot{flex:none;padding:8px 10px;border-top:1px solid var(--gm-edge);background:var(--gm-bg)}
.lto-px .lto-gm-foot{border-top-width:2px}
.lto-gm-close{appearance:none;margin:0;width:100%;height:44px;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;font:inherit;font-weight:700;color:inherit;background:var(--gm-soft);border:1px solid var(--gm-edge);border-radius:9px;touch-action:manipulation}
.lto-px .lto-gm-close{border-width:2px;border-radius:0;box-shadow:0 0 0 2px #05061a}
.lto-gm-close svg{width:16px;height:16px;fill:currentColor}
@container gm (min-width:520px){
  .lto-gm-head{padding-right:64px}
  .lto-gm-foot{padding:0;border:0;height:0}
  .lto-gm-close{position:absolute;top:8px;right:10px;width:44px}
  .lto-gm-close-label{display:none}
}
.lto-gm-body{flex:1;min-height:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;padding:10px 12px 16px}
.lto-gm-body>*{max-width:900px;margin-left:auto;margin-right:auto}
.lto-gm-note{padding:14px 4px;color:var(--gm-muted)}
.lto-gm .lto-hud-pack-list{max-height:none;overflow:visible}
.lto-gm .lto-hud-btn{min-height:44px}
.lto-gm .lto-hud-load{min-height:44px;padding:4px 14px}
.lto-gm .lto-hud-choice{min-height:44px;padding:4px 12px}
.lto-gm .lto-hud-export{min-height:44px}
.lto-gm .lto-hud-choices{gap:8px}
.lto-gm .lto-hud-settingsview{gap:14px}
.lto-gm.lto-sb .lto-hud-btn{background:linear-gradient(180deg,var(--gm-panel),var(--gm-soft))}

/* ---- the inventory tab: stats, the paper doll with its slots, the bag ---- */
.lto-inv{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;align-items:start}
.lto-inv-doll{order:1}.lto-inv-stats{order:2}.lto-inv-bag{order:3}.lto-inv-more{order:4}
.lto-inv-sec{min-width:0;background:var(--gm-panel);border:1px solid var(--gm-edge);border-radius:9px;padding:8px}
@container gm (min-width:420px){.lto-inv-sec{padding:9px 11px}}
.lto-px .lto-inv-sec{border-width:2px;border-radius:0;box-shadow:0 0 0 2px #05061a,inset 0 0 0 1px #2c3874}
.lto-inv-h{margin:0 0 8px;font-weight:700;color:var(--gm-accent);font-size:12px;letter-spacing:.09em;text-transform:uppercase;line-height:1.25}
.lto-px .lto-inv-h{text-transform:none;letter-spacing:0;font-size:inherit}
.lto-inv-h canvas{display:block}
@container gm (min-width:480px){
  .lto-inv{grid-template-columns:minmax(170px,.85fr) minmax(0,1.25fr)}
  .lto-inv-stats{order:1;grid-column:1}.lto-inv-doll{order:2;grid-column:2;grid-row:1}.lto-inv-bag{order:3;grid-column:1/-1}.lto-inv-more{order:4;grid-column:1/-1}
}
@container gm (min-width:820px){
  .lto-inv{grid-template-columns:minmax(190px,.8fr) minmax(0,1.2fr) minmax(0,1fr)}
  .lto-inv-bag{grid-column:3;grid-row:1}.lto-inv-more{grid-column:1/-1}
}
.lto-stats{display:flex;flex-direction:column;gap:2px}
.lto-stat{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:8px;align-items:baseline;padding:5px 4px;border-radius:5px;min-height:32px}
.lto-stat-l{color:var(--gm-muted);min-width:0}
.lto-stat-r{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:2px 6px;text-align:right;font-weight:700;font-variant-numeric:lining-nums tabular-nums}
.lto-stat-extra{grid-column:1/-1;text-align:right;color:var(--gm-muted);font-size:12px}
.lto-stat:is(:hover,:focus-visible){background:color-mix(in srgb,var(--gm-edge) 18%,transparent)}
.lto-delta{font-weight:800;padding:0 5px;border-radius:5px}
.lto-delta[data-tone="up"]{color:var(--gm-good);background:color-mix(in srgb,var(--gm-good) 16%,transparent)}
.lto-delta[data-tone="down"]{color:var(--gm-bad);background:color-mix(in srgb,var(--gm-bad) 16%,transparent)}
.lto-delta[data-tone="note"]{color:var(--gm-accent)}
.lto-inv-note{margin-top:8px;min-height:2.6em;color:var(--gm-muted);font-size:13px}
.lto-inv-note[data-tone="bad"]{color:var(--gm-bad)}
.lto-inv-pick{margin-top:8px;display:flex;flex-direction:column;gap:6px}
.lto-inv-pick[hidden]{display:none}
.lto-inv-pick-name{font-weight:700}
.lto-inv-btn{appearance:none;font:inherit;cursor:pointer;min-height:44px;padding:6px 14px;touch-action:manipulation;background:var(--gm-accent);color:var(--gm-bg);border:1px solid var(--gm-accent);border-radius:9px;font-weight:800}
.lto-px .lto-inv-btn{border-radius:0;border-width:2px;color:#1b1300;box-shadow:0 0 0 2px #05061a}
.lto-inv-btn:disabled{opacity:.45;cursor:default}
.lto-doll-grid{display:grid;grid-template-columns:60px minmax(0,1fr) 60px;grid-template-rows:repeat(3,auto) auto;column-gap:8px;row-gap:8px;align-items:center;justify-items:center}
.lto-doll-mid{grid-column:2;grid-row:1/4;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-width:0}
.lto-doll{display:block;image-rendering:pixelated;max-width:100%;height:auto}
.lto-doll-cap{text-align:center;color:var(--gm-muted);font-size:12px;line-height:1.25;max-width:100%;overflow-wrap:anywhere}
.lto-slot-wrap{display:flex;flex-direction:column;align-items:center;gap:2px;width:60px;min-width:0}
.lto-slot-wrap[data-area="bottom"]{grid-column:1/-1;grid-row:4;width:auto;flex-direction:row;gap:10px}
.lto-slot{appearance:none;font:inherit;color:inherit;margin:0;position:relative;width:56px;height:56px;padding:0;display:grid;place-items:center;cursor:pointer;touch-action:manipulation;overflow:hidden;
  background:var(--gm-soft);border:2px solid var(--gm-edge);border-radius:8px;--tier:var(--gm-edge)}
.lto-px .lto-slot{border-radius:0;box-shadow:0 0 0 2px #05061a}
.lto-slot[data-tier="uncommon"],.lto-cell[data-tier="uncommon"]{--tier:var(--gm-t1);border-color:var(--gm-t1)}
.lto-slot[data-tier="rare"],.lto-cell[data-tier="rare"]{--tier:var(--gm-t2);border-color:var(--gm-t2)}
.lto-slot[data-tier="legendary"],.lto-cell[data-tier="legendary"]{--tier:var(--gm-t3);border-color:var(--gm-t3);box-shadow:0 0 8px color-mix(in srgb,var(--gm-t3) 60%,transparent)}
.lto-slot[data-empty="true"]{border-style:dashed;opacity:.85}
.lto-slot[aria-pressed="true"],.lto-cell[aria-pressed="true"]{outline:3px solid var(--gm-accent);outline-offset:1px}
.lto-slot canvas,.lto-cell canvas{display:block;image-rendering:pixelated;pointer-events:none}
.lto-slot-name{font-size:10px;line-height:1.1;padding:2px;text-align:center;overflow-wrap:anywhere;color:var(--gm-ink)}
.lto-pips{position:absolute;right:3px;bottom:1px;font-size:9px;line-height:1;letter-spacing:1px;color:var(--tier);font-weight:800;pointer-events:none}
.lto-slot-cap{font-size:10.5px;line-height:1.15;text-align:center;color:var(--gm-muted);max-width:76px;overflow-wrap:anywhere}
.lto-slot-wrap[data-area="bottom"] .lto-slot-cap{max-width:none;text-align:left;font-size:12px}
.lto-bag-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(44px,56px));justify-content:start;gap:4px;max-width:356px}
.lto-cell{appearance:none;font:inherit;color:inherit;margin:0;position:relative;min-width:44px;aspect-ratio:1;min-height:44px;padding:0;display:grid;place-items:center;overflow:hidden;
  background:var(--gm-soft);border:2px solid var(--gm-edge);border-radius:6px;--tier:var(--gm-edge)}
button.lto-cell{cursor:pointer;touch-action:manipulation}
.lto-px .lto-cell{border-radius:0;box-shadow:0 0 0 1px #05061a}
.lto-cell[data-empty="true"]{border-style:dashed;opacity:.55;background:transparent}
.lto-bag-count{margin-top:6px;color:var(--gm-muted);font-size:12px}
.lto-chips{display:flex;flex-wrap:wrap;gap:6px}
.lto-chip-item{appearance:none;font:inherit;color:inherit;cursor:pointer;min-height:44px;padding:6px 12px;display:inline-flex;align-items:center;gap:6px;touch-action:manipulation;background:var(--gm-soft);border:1px solid var(--gm-edge);border-radius:999px}
.lto-px .lto-chip-item{border-radius:0;border-width:2px;box-shadow:0 0 0 2px #05061a}
.lto-chip-k{color:var(--gm-muted);font-weight:700}
.lto-inv-more-sec+.lto-inv-more-sec{margin-top:10px}
.lto-inv-none{color:var(--gm-muted)}
@media (prefers-reduced-motion: reduce){.lto-gm *{animation:none!important;transition:none!important}}
`;
