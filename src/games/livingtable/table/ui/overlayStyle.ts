/**
 * The overlay's stylesheet (both text treatments) and its injector.
 */
import { SERIF, SERIF_NUM } from "./overlayTheme";

// ---- styles -----------------------------------------------------------------

const STYLE_ID = "lto-style";

const CSS = `
.lto-root{--lto-serif:${SERIF};--lto-num:${SERIF_NUM};
  --sb-paper:#f6edd6;--sb-paper2:#e8d8b0;--sb-ink:#2a2016;--sb-muted:#6a5a3f;--sb-rule:#7c5c1e;--sb-gold:#cf9f3b;--sb-shade:46 28 8;
  --sb-good:#2a6a33;--sb-bad:#a5281c;--sb-spk:#8a5208;--sb-badge:#251b30;--sb-badge-ink:#ffd86b;--sb-focus:var(--bn-focus,#1d63e0);
  --sb-hero:#2a5db0;--sb-hero-deep:#1d3f7a;--sb-enemy:#a5281c;--sb-enemy-deep:#7a1c14;
  position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:40;--fs:2;--lto-lines:3}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .lto-root{
  --sb-paper:#25203a;--sb-paper2:#181526;--sb-ink:#f3e9cf;--sb-muted:#b6ab90;--sb-rule:#c79d45;--sb-gold:#e6bf5e;--sb-shade:0 0 0;
  --sb-good:#86e096;--sb-bad:#ff8c7a;--sb-spk:#ffd27a;--sb-badge:#0f0c18;--sb-hero:#7fb0ff;--sb-enemy:#ff8c7a}}
:root[data-theme="dark"] .lto-root{
  --sb-paper:#25203a;--sb-paper2:#181526;--sb-ink:#f3e9cf;--sb-muted:#b6ab90;--sb-rule:#c79d45;--sb-gold:#e6bf5e;--sb-shade:0 0 0;
  --sb-good:#86e096;--sb-bad:#ff8c7a;--sb-spk:#ffd27a;--sb-badge:#0f0c18;--sb-hero:#7fb0ff;--sb-enemy:#ff8c7a}
.lto-root[data-size="s"]{--fs:1;--lto-lines:2}
.lto-root *,.lto-root *::before,.lto-root *::after{box-sizing:border-box}
.lto-root [hidden]{display:none!important}
.lto-layer{position:absolute;inset:0;pointer-events:none}
.lto-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.lto-top{position:absolute;left:50%;translate:-50% 0;width:min(calc(100% - 16px),max(var(--lto-board-w,100%),440px));top:8px;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none}
/* a phone on its side: the board is small and the room is wide, so the turn strip takes the whole width (one row, not a column beside a thumbnail board) */
@media (max-height:500px){.lto-top{width:calc(100% - 16px)}}
.lto-bottom{position:absolute;left:50%;translate:-50% 0;width:min(calc(100% - 16px),var(--lto-board-w,100%));bottom:8px;display:flex;flex-direction:column;align-items:center;pointer-events:none}
.lto-banners{display:flex;flex-direction:column;align-items:center;width:100%;pointer-events:none}
.lto-float{position:absolute;transform:translate(-50%,-100%);pointer-events:none;white-space:nowrap;will-change:transform,opacity}
.lto-float-in{transform-origin:50% 100%}
.lto-num{display:block;overflow:visible;filter:drop-shadow(0 3px 5px rgb(0 0 0/.6))}
.lto-num text{font-family:var(--lto-num);font-weight:800;stroke-linejoin:round}
.lto-plate-pos{position:absolute;pointer-events:none;max-width:calc(100% - 16px);transition:top .16s ease-out}

/* ---- pixel: the nine-slice windows ---- */
.lto-fr{--frame:var(--fr-win);border:calc(5px*var(--fs)) solid #05061a;border-image:var(--frame) 5 fill/calc(5px*var(--fs))/0 stretch;image-rendering:pixelated;background:#141a3c;color:#f4ecd0}
.lto-fr.fr-gold{--frame:var(--fr-gold)}.lto-fr.fr-red{--frame:var(--fr-red)}.lto-fr.fr-blue{--frame:var(--fr-blue)}
.lto-fr.fs1{border-width:5px;border-image-width:5px}
.lto-px canvas{image-rendering:pixelated}
.lto-px .lto-init{position:relative;display:flex;flex-wrap:wrap;justify-content:center;align-items:flex-start;gap:16px 4px;max-width:100%;pointer-events:auto;padding:4px 4px 12px}
.lto-px .lto-chip{display:flex;align-items:center;gap:6px;padding:0 3px;flex:none;position:relative}
.lto-px .lto-chip.is-active{transform:translateY(1px)}
.lto-px .lto-chip[data-side].is-active{box-shadow:0 0 0 2px #ffe27a,0 0 0 4px #1a0f00}
.lto-px .lto-chip .lto-caret{position:absolute;left:50%;bottom:-17px;transform:translateX(-50%)}
.lto-px .lto-round{flex:none;padding:0 3px;display:flex;align-items:center}
.lto-px .lto-roll{padding:2px 4px;display:flex;flex-direction:column;align-items:center;gap:5px}
.lto-px .lto-math{display:flex;align-items:flex-end;gap:12px}
.lto-px .lto-math.is-tight{gap:6px}
.lto-px .lto-math.is-wrap{flex-wrap:wrap;justify-content:center;row-gap:6px}
.lto-px .lto-cell{display:flex;flex-direction:column;align-items:center;gap:5px}
.lto-px .lto-op{padding-bottom:6px}
.lto-px .lto-srcs{display:flex;flex-direction:column;align-items:center;gap:2px}
.lto-px .lto-tail{position:absolute;transform:translateX(-50%)}
.lto-px .lto-banner{padding:2px 8px}

/* ---- storybook: parchment and ink, a rulebook ---- */
.lto-sb{font-family:var(--lto-serif);color:var(--sb-ink)}
.lto-sb .lto-plate{background:linear-gradient(180deg,var(--sb-paper),var(--sb-paper2));color:var(--sb-ink);border-radius:9px;border:1px solid var(--sb-rule);
  box-shadow:0 0 0 1px rgb(var(--sb-shade)/.55),0 6px 16px rgb(0 0 0/.45),inset 0 0 0 2px var(--sb-paper),inset 0 0 0 3px var(--sb-gold)}
.lto-sb .lto-t2{font-weight:700;letter-spacing:.05em;text-transform:uppercase;paint-order:stroke fill;-webkit-text-stroke:.6px rgb(0 0 0/.7);text-shadow:0 1px 0 rgb(0 0 0/.5),0 2px 4px rgb(var(--sb-shade)/.7)}
.lto-sb .lto-init{position:relative;display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:14px 6px;max-width:100%;pointer-events:auto;padding:2px 2px 12px}
.lto-sb .lto-round,.lto-sb .lto-chip,.lto-sb .lto-verdict{font-family:var(--lto-num)}
.lto-sb .lto-round{flex:none;padding:4px 10px;border-radius:999px;background:var(--sb-badge);color:var(--sb-badge-ink);font-size:11px;border:1px solid var(--sb-gold);box-shadow:0 2px 6px rgb(0 0 0/.4)}
.lto-sb .lto-chip{position:relative;flex:none;display:flex;align-items:center;gap:7px;padding:3px 4px 3px 11px;border-radius:999px;font-size:13px;font-weight:700;letter-spacing:.02em}
.lto-sb .lto-chip.is-active{transform:scale(1.08);box-shadow:0 0 0 1px rgb(var(--sb-shade)/.55),0 0 0 3px var(--sb-gold),0 6px 14px rgb(0 0 0/.5),inset 0 0 0 2px var(--sb-paper),inset 0 0 0 3px var(--sb-gold)}
.lto-sb .lto-chip[data-side="hero"]{--side:var(--sb-hero);--side-deep:var(--sb-hero-deep)}
.lto-sb .lto-chip[data-side="enemy"]{--side:var(--sb-enemy);--side-deep:var(--sb-enemy-deep)}
.lto-sb .lto-chip[data-side]{color:var(--side);border-color:var(--side);box-shadow:0 0 0 1px rgb(var(--sb-shade)/.55),0 6px 16px rgb(0 0 0/.45),inset 0 0 0 2px var(--sb-paper),inset 0 0 0 3px var(--side)}
.lto-sb .lto-chip[data-side] .lto-badge{background:var(--side-deep)}
.lto-sb .lto-chip[data-side].is-active{box-shadow:0 0 0 1px rgb(var(--sb-shade)/.55),0 0 0 3px var(--sb-gold),0 6px 14px rgb(0 0 0/.5),inset 0 0 0 2px var(--sb-paper),inset 0 0 0 3px var(--side)}
.lto-sb .lto-chip.is-active::after{content:"";position:absolute;left:50%;bottom:-9px;width:9px;height:9px;transform:translateX(-50%) rotate(45deg);background:var(--sb-gold);border:1px solid rgb(var(--sb-shade)/.7);border-top:0;border-left:0}
.lto-sb .lto-badge{min-width:26px;height:26px;padding:0 5px;border-radius:999px;display:grid;place-items:center;background:var(--sb-badge);color:var(--sb-badge-ink);font:800 15px/1 var(--lto-num);
  paint-order:stroke fill;-webkit-text-stroke:.6px rgb(0 0 0/.7);text-shadow:0 1px 0 rgb(0 0 0/.5),0 2px 4px rgb(0 0 0/.5);font-variant-numeric:lining-nums tabular-nums}
.lto-sb .lto-roll{padding:9px 14px 10px;display:flex;flex-direction:column;align-items:center;gap:6px;max-width:100%}
.lto-sb .lto-plate.is-crit{box-shadow:0 0 0 1px rgb(var(--sb-shade)/.55),0 0 22px rgb(255 200 70/.6),0 6px 16px rgb(0 0 0/.45),inset 0 0 0 2px var(--sb-paper),inset 0 0 0 3px #f0b52c}
.lto-sb .lto-cap{font-size:12px;font-style:italic;color:var(--sb-muted)}
.lto-sb .lto-math{display:flex;align-items:flex-end;gap:10px}
.lto-sb .lto-cell{display:flex;flex-direction:column;align-items:center;gap:1px}
.lto-sb .lto-cell b{font:800 30px/1 var(--lto-num);font-variant-numeric:lining-nums;text-shadow:0 1px 0 rgb(255 255 255/.5)}
.lto-sb .lto-cell.strong b{color:var(--sb-spk)}
.lto-sb .lto-cell i{font-size:11px;color:var(--sb-muted)}
.lto-sb .lto-op{font:700 18px/1 var(--lto-serif);color:var(--sb-muted);padding-bottom:13px}
.lto-sb .lto-srcs{display:flex;flex-wrap:wrap;justify-content:center;gap:2px 12px;font-size:12px;color:var(--sb-muted)}
.lto-sb .lto-verdict{padding:3px 14px 4px;border-radius:999px;font-size:13px;color:#fff}
.lto-sb .lto-verdict.hit{background:linear-gradient(#4cb862,#2a7a3a)}.lto-sb .lto-verdict.miss{background:linear-gradient(#c65a4c,#8a2a20)}.lto-sb .lto-verdict.crit{background:linear-gradient(#f5c64c,#b8790f)}
.lto-sb .lto-tail{position:absolute;width:13px;height:13px;transform:translateX(-50%) rotate(45deg);background:var(--sb-paper2);border:1px solid var(--sb-rule)}
.lto-sb .lto-tail.down{bottom:-7px;border-top:0;border-left:0}.lto-sb .lto-tail.up{top:-7px;border-bottom:0;border-right:0;background:var(--sb-paper)}
.lto-sb .lto-banner{position:relative;width:auto;padding:4px 36px 5px;display:flex;justify-content:center;
  background:linear-gradient(90deg,transparent 0,rgb(12 8 22/.8) 14%,rgb(12 8 22/.88) 50%,rgb(12 8 22/.8) 86%,transparent 100%)}
.lto-sb .lto-banner::before,.lto-sb .lto-banner::after{content:"";position:absolute;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#d9ae4a 20%,#ffe9a0 50%,#d9ae4a 80%,transparent)}
.lto-sb .lto-banner::before{top:0}.lto-sb .lto-banner::after{bottom:0}

/* ---- the ending's framed text box ---- */
.lto-narr-box{min-width:0}
.lto-narr-body{overflow-y:auto;overflow-x:hidden;overflow-wrap:anywhere;scrollbar-width:thin;scrollbar-gutter:stable}
@keyframes lto-narr-dot{0%,75%,100%{opacity:.3;transform:translateY(0)}35%{opacity:1;transform:translateY(-3px)}}
.lto-px .lto-narr-box{padding:0 2px}
.lto-px .lto-narr-body{max-height:calc(var(--nl)*var(--lto-nrow,20px));scrollbar-color:#b8801a #05061a}
.lto-sb .lto-narr-box{padding:14px 16px 10px 18px;border-radius:10px;border-left:4px solid var(--sb-gold)}
.lto-sb .lto-narr-body{max-height:calc(var(--nl)*1.45em);font:italic 15.5px/1.45 var(--lto-serif);color:var(--sb-ink);white-space:pre-wrap;scrollbar-color:var(--sb-rule) transparent}

/* ---- the dialogue box: the one place story text is drawn. A speaker tag in the corner, the framed text, a marker when more waits ---- */
.lto-dlg{--dl:3;display:flex;flex-direction:column;width:min(760px,100%);min-width:0;pointer-events:auto;cursor:pointer;touch-action:manipulation;transform-origin:50% 100%}
.lto-dlg:focus-visible{outline:2px solid var(--sb-focus);outline-offset:2px}
.lto-dlg-tag{position:relative;z-index:1;align-self:flex-start;margin-left:12px;width:max-content;max-width:calc(100% - 24px);overflow:hidden}
.lto-dlg-box{position:relative;min-width:0}
.lto-dlg-body{min-width:0;overflow:hidden}
.lto-dlg-more{position:absolute;pointer-events:none}
.lto-dlg-dots{display:flex;align-items:center;gap:6px}
.lto-dlg-dots i{display:block;width:6px;height:6px;background:currentColor;animation:lto-narr-dot 1.1s ease-in-out infinite}
.lto-dlg-dots i:nth-child(2){animation-delay:.18s}.lto-dlg-dots i:nth-child(3){animation-delay:.36s}
.lto-px .lto-dlg-tag{margin-bottom:calc(-5px*var(--fs))}
.lto-px .lto-dlg-box{padding:0 22px 0 2px}
.lto-px .lto-dlg-body canvas{display:block}
.lto-px .lto-dlg-dots{height:20px;color:#ffc72a}
.lto-px .lto-dlg-more{right:2px;bottom:1px}
.lto-px .lto-dlg-more canvas{display:block}
.lto-sb .lto-dlg-tag{margin-bottom:-11px;padding:4px 11px;border-radius:999px;background:var(--sb-badge);color:var(--sb-badge-ink);border:1px solid var(--sb-gold);
  font:700 11px/1.1 var(--lto-num);letter-spacing:.1em;text-transform:uppercase;white-space:nowrap;text-overflow:ellipsis;box-shadow:0 2px 6px rgb(0 0 0/.4)}
.lto-sb .lto-dlg-box{padding:14px 30px 10px 18px;border-radius:10px;border-left:4px solid var(--sb-gold)}
.lto-sb .lto-dlg-body{font:15.5px/1.45 var(--lto-serif);color:var(--sb-ink)}
.lto-sb .lto-dlg-body[data-tone="good"]{color:var(--sb-good)}.lto-sb .lto-dlg-body[data-tone="bad"]{color:var(--sb-bad)}
.lto-sb .lto-dlg-line{display:block;white-space:pre;height:1.45em;overflow:hidden}
.lto-sb .lto-dlg-dots{height:1.45em;color:var(--sb-spk)}
.lto-sb .lto-dlg-dots i{border-radius:50%}
.lto-sb .lto-dlg-more{right:11px;bottom:9px;width:0;height:0;border:6px solid transparent;border-top:9px solid var(--sb-spk);border-bottom:0;animation:lto-dlg-bob 1s ease-in-out infinite}
@keyframes lto-dlg-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(3px)}}
.lto-px .lto-dlg-more{animation:lto-dlg-bob 1s ease-in-out infinite}

/* ---- the DM box while it waits on the DM: the dots, and Cancel beside them ---- */
.lto-dlg-wait{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}
.lto-dlg-cancel{flex:none;min-height:30px;padding:2px 10px}
.lto-root[data-size="s"] .lto-dlg-cancel{min-height:44px}
.lto-px .lto-dlg-cancel.lto-fr{padding:0 2px}
@media (pointer: coarse){.lto-dlg-cancel{min-height:44px}}
/* the story screen covers the board: the DM box is out of sight (and out of reach) until it is read through */
.lto-root[data-story] .lto-bottom{visibility:hidden}

/* ---- the story screen: story the player did not ask for, in the middle of the board, on a scrim of its own ---- */
.lto-story{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:12px;pointer-events:auto;cursor:pointer;touch-action:manipulation;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
.lto-px .lto-story{background:rgb(5 6 26/.86)}
.lto-sb .lto-story{background:radial-gradient(ellipse at 50% 42%,rgb(var(--sb-shade)/.55),rgb(var(--sb-shade)/.92))}
.lto-story-panel{position:relative;display:flex;flex-direction:column;align-items:center;gap:12px;width:var(--sw,560px);max-width:100%;max-height:100%;min-width:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;text-align:center;outline:0;scrollbar-width:thin}
.lto-sb .lto-story-panel[data-more="down"],.lto-sb .lto-story-panel[data-more="both"]{box-shadow:inset 0 -14px 10px -10px rgb(var(--sb-shade)/.5)}
.lto-px .lto-story-panel[data-more="down"],.lto-px .lto-story-panel[data-more="both"]{box-shadow:inset 0 -10px 8px -8px rgb(130 148 230/.5)}
.lto-story-panel:focus-visible{outline:2px solid var(--sb-focus);outline-offset:3px}
.lto-story-panel>*{min-width:0;max-width:100%}
.lto-px .lto-story-panel{padding:6px 18px 12px}
.lto-sb .lto-story-panel{padding:22px 26px 16px;border-radius:14px;background:linear-gradient(180deg,var(--sb-paper),var(--sb-paper2));border:1px solid var(--sb-rule);
  box-shadow:0 0 0 1px rgb(var(--sb-shade)/.6),0 18px 44px rgb(0 0 0/.6),inset 0 0 0 3px var(--sb-paper),inset 0 0 0 4px var(--sb-gold),inset 0 0 28px rgb(var(--sb-shade)/.16)}
.lto-sb .lto-story-panel::before,.lto-sb .lto-story-panel::after{content:"";width:46%;height:2px;flex:none;background:linear-gradient(90deg,transparent,var(--sb-gold),transparent);opacity:.9}
.lto-sb .lto-story-panel::before{order:-2}
.lto-story-panel .lto-ribbon{flex:none;width:100%}
.lto-sb .lto-story-spk{font:700 12px/1.2 var(--lto-serif);letter-spacing:.14em;text-transform:uppercase;color:var(--sb-spk)}
.lto-story-body{display:flex;flex-direction:column;align-items:center;width:100%;min-width:0}
.lto-story-line{display:flex;justify-content:center;width:100%;min-width:0;height:var(--srow,26px)}
.lto-story-ink{display:block}
.lto-story-ink canvas{display:block}
.lto-sb .lto-story-line{white-space:pre;font:italic var(--sfs,17px)/var(--srow,26px) var(--lto-serif);color:var(--sb-ink)}
.lto-story-rest{visibility:hidden}
.lto-story-foot{display:flex;align-items:center;justify-content:center;gap:8px;min-height:20px;flex:none}
.lto-story-foot canvas{display:block}
.lto-sb .lto-story-hint-words{font:700 11.5px/1 var(--lto-serif);letter-spacing:.1em;text-transform:uppercase;color:var(--sb-muted)}
.lto-sb .lto-story-more{width:0;height:0;border:6px solid transparent;border-top:9px solid var(--sb-spk);border-bottom:0;animation:lto-dlg-bob 1s ease-in-out infinite}
.lto-story-caret{animation:lto-dlg-bob 1s ease-in-out infinite}

/* ---- buttons, the context menu and the loot window (they take the pointer) ---- */
.lto-btn{appearance:none;font:inherit;color:inherit;margin:0;min-width:0;min-height:36px;padding:4px 12px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;touch-action:manipulation;pointer-events:auto}
.lto-btn:disabled{opacity:.45;cursor:default}
.lto-btn:focus-visible{outline:2px solid var(--sb-focus);outline-offset:2px}
.lto-btn canvas{display:block}
.lto-px .lto-btn.lto-fr{background:#141a3c}
.lto-px .lto-btn:not(:disabled):hover{--frame:var(--fr-blue)}
.lto-sb .lto-btn{border-radius:9px;background:linear-gradient(180deg,var(--sb-paper),var(--sb-paper2));border:1px solid var(--sb-rule);box-shadow:inset 0 0 0 2px var(--sb-paper),inset 0 0 0 3px var(--sb-gold);font:700 14px/1 var(--lto-serif);color:var(--sb-ink)}
.lto-sb .lto-btn.is-pri{box-shadow:0 0 0 2px var(--sb-gold),inset 0 0 0 2px var(--sb-paper),inset 0 0 0 3px var(--sb-gold)}
.lto-root[data-size="s"] .lto-btn{min-height:44px}
@media (pointer: coarse){.lto-btn{min-height:44px}}
.lto-loot-host{position:absolute;left:0;right:0;top:0;display:flex;justify-content:center;pointer-events:none}
.lto-loot{display:flex;flex-direction:column;gap:6px;width:min(340px,calc(100% - 16px));min-height:0;padding:6px 8px;pointer-events:auto;margin-top:8px}
.lto-loot-title{padding:0 2px}
.lto-sb .lto-loot-title{font:700 12px/1.2 var(--lto-serif);letter-spacing:.07em;text-transform:uppercase;color:var(--sb-spk)}
.lto-loot-list{display:flex;flex-direction:column;gap:3px;min-height:0;padding:3px;margin:-3px;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;overscroll-behavior:contain}
.lto-px .lto-loot-list{scrollbar-color:#4d5da6 #05061a}
.lto-sb .lto-loot-list{scrollbar-color:var(--sb-rule) transparent}
.lto-loot-row{flex:none;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:1px 2px;min-width:0}
.lto-loot-name{min-width:0;overflow-wrap:anywhere;padding:2px 2px;cursor:help;border-radius:3px}
.lto-loot-name:focus-visible{outline:2px solid var(--sb-focus);outline-offset:1px}
.lto-sb .lto-loot-name{font:15px/1.3 var(--lto-serif);color:var(--sb-ink)}
.lto-px .lto-loot-name[data-lt-tip]{box-shadow:inset 0 -1px 0 rgb(152 165 216/.28)}
.lto-sb .lto-loot-name[data-lt-tip]{box-shadow:inset 0 -1px 0 rgb(var(--sb-shade)/.18)}
.lto-loot-take{min-height:32px;padding:2px 10px}
.lto-root[data-size="s"] .lto-loot-take{min-height:44px}
@media (pointer: coarse){.lto-loot-take{min-height:44px}}
.lto-loot-empty{padding:4px 2px}
.lto-sb .lto-loot-empty{font:italic 14px/1.3 var(--lto-serif);color:var(--sb-muted)}
.lto-loot-foot{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end}
.lto-root[data-size="s"] .lto-loot-foot{display:grid;grid-template-columns:1fr 1fr}
.lto-menu-layer{position:absolute;inset:0;pointer-events:none}
.lto-cm{position:absolute;display:flex;flex-direction:column;gap:1px;pointer-events:auto;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;padding:3px;scrollbar-width:thin;touch-action:manipulation}
.lto-px .lto-cm.lto-fr{padding:3px}
.lto-cm-title{padding:3px 8px 4px}
.lto-sb .lto-cm-title{font:700 11px/1.2 var(--lto-serif);letter-spacing:.1em;text-transform:uppercase;color:var(--sb-spk)}
.lto-cm-row{flex:none;display:grid;grid-template-columns:18px minmax(0,1fr);gap:8px;align-items:start;min-width:0;min-height:34px;padding:6px 8px;cursor:pointer;outline:0}
.lto-root[data-size="s"] .lto-cm-row{min-height:44px}
@media (pointer: coarse){.lto-cm-row{min-height:44px}}
.lto-cm-mark{display:grid;place-items:center;width:18px;height:18px}
.lto-cm-mark svg{display:block;width:14px;height:14px;fill:#ffc72a;stroke:#3b1f00;stroke-width:28px;paint-order:stroke fill;stroke-linejoin:round}
.lto-sb .lto-cm-mark svg{fill:#d99a1c}
.lto-cm-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.lto-cm-label canvas,.lto-cm-why canvas,.lto-cm-reason canvas{display:block}
.lto-cm-row[aria-disabled="true"]{cursor:default}
.lto-cm-row[aria-disabled="true"] .lto-cm-label{opacity:.55}
.lto-px .lto-cm-row:focus,.lto-px .lto-cm-row.is-hot{background:rgb(77 93 166/.5);box-shadow:inset 0 0 0 2px #ffc72a}
.lto-sb .lto-cm-row{border-radius:6px}
.lto-sb .lto-cm-row:focus,.lto-sb .lto-cm-row.is-hot{background:rgb(var(--sb-shade)/.14);box-shadow:inset 0 0 0 2px var(--sb-gold)}
.lto-sb .lto-cm-label{font:700 15px/1.25 var(--lto-serif);color:var(--sb-ink);overflow-wrap:anywhere}

/* ---- the adventure screens: start, hero, ending (they cover the whole board and take the pointer) ---- */
.lto-scr-layer{position:absolute;inset:0;pointer-events:none}
.lto-scr{position:absolute;inset:0;pointer-events:auto;display:flex;flex-direction:column;animation:lto-scr-in .22s ease-out}
@keyframes lto-scr-in{from{opacity:0}to{opacity:1}}
.lto-px .lto-scr{background:rgb(5 6 26/.94);color:#f4ecd0}
.lto-sb .lto-scr{background:rgb(var(--sb-shade)/.92)}
.lto-scr-scroll{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow-y:auto;overflow-x:hidden;padding:14px 12px 18px;overscroll-behavior:contain;scrollbar-width:thin}
.lto-px .lto-scr-scroll{scrollbar-color:#4d5da6 #05061a}
.lto-sb .lto-scr-scroll{scrollbar-color:var(--sb-rule) transparent}
.lto-scr-body{margin:auto;width:min(720px,100%);display:flex;flex-direction:column;gap:14px;min-width:0}
.lto-scr-title{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0;text-align:center}
.lto-scr-title .lto-num{margin:-4px 0}
.lto-scr-sec{padding:0 2px;min-width:0}
.lto-sb .lto-scr-sec{font:700 12px/1.2 var(--lto-serif);letter-spacing:.12em;text-transform:uppercase;color:#ffd86b;text-shadow:0 1px 2px rgb(0 0 0/.6)}
.lto-sb .lto-scr-sub{font:italic 15px/1.35 var(--lto-serif);color:#eadfc2;text-shadow:0 1px 2px rgb(0 0 0/.6)}
.lto-st{min-width:0;overflow-wrap:anywhere}
.lto-st.is-center{display:flex;justify-content:center;text-align:center}
.lto-st canvas{display:block}
.lto-card-list{display:flex;flex-direction:column;gap:10px;min-width:0}
.lto-card-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;min-width:0}
.lto-root[data-size="s"] .lto-card-grid{grid-template-columns:minmax(0,1fr)}
.lto-card{appearance:none;font:inherit;color:inherit;text-align:left;margin:0;width:100%;min-width:0;display:flex;flex-direction:column;align-items:stretch;gap:6px;padding:9px 11px;cursor:pointer;touch-action:manipulation;pointer-events:auto;position:relative}
.lto-card>*{min-width:0}
.lto-card[aria-disabled="true"]{cursor:default}
.lto-card:focus-visible{outline:2px solid var(--sb-focus);outline-offset:2px}
.lto-px .lto-card:focus-visible{outline-color:#ffc72a}
.lto-px .lto-card.lto-fr{padding:6px 8px}
.lto-px .lto-card.lto-fr.is-compact{padding:2px 4px}
.lto-px .lto-card:not([aria-disabled="true"]):hover{--frame:var(--fr-blue)}
.lto-sb .lto-card.is-compact{padding:7px 10px}
.lto-sb .lto-card:not([aria-disabled="true"]):hover{box-shadow:0 0 0 2px var(--sb-gold),0 4px 12px rgb(0 0 0/.35),inset 0 0 0 2px var(--sb-paper),inset 0 0 0 3px var(--sb-gold)}
.lto-sb .lto-card.is-bad{border-color:var(--sb-bad)}
.lto-sb .lto-card-title{font:700 18px/1.2 var(--lto-serif);color:var(--sb-ink)}
.lto-sb .lto-card.is-compact .lto-card-title{font-size:15px}
.lto-sb .lto-card-text{font:14.5px/1.4 var(--lto-serif);color:var(--sb-ink)}
.lto-sb .lto-card-quiet{font:13px/1.35 var(--lto-serif);color:var(--sb-muted)}
.lto-sb .lto-card-hook{font:italic 14.5px/1.4 var(--lto-serif);color:var(--sb-ink)}
.lto-sb .lto-card-bad{font:13.5px/1.35 var(--lto-serif);color:var(--sb-bad)}
.lto-sb .lto-card-badhead{font:700 13px/1.3 var(--lto-serif);color:var(--sb-bad)}
.lto-sb .lto-card-ask{font:700 14.5px/1.3 var(--lto-serif);color:var(--sb-spk)}
.lto-sb .lto-card.is-bad .lto-card-title{color:var(--sb-muted)}
.lto-card[data-ltoai]{gap:8px}
.lto-card-meta{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px 10px}
.lto-pill{display:inline-flex;align-items:center;padding:2px 9px;flex:none}
.lto-sb .lto-pill{border-radius:999px;font:700 11px/1.2 var(--lto-num);letter-spacing:.06em;text-transform:uppercase;background:var(--sb-badge);color:var(--sb-badge-ink);border:1px solid var(--sb-gold)}
.lto-sb .lto-pill[data-tone="ai"]{background:var(--sb-hero-deep);color:#e6f1ff;border-color:var(--sb-hero)}
.lto-px .lto-pill{padding:2px 5px;background:#2a2150;border:2px solid #05061a;box-shadow:inset 0 0 0 1px #8a6a1e}
.lto-px .lto-pill[data-tone="ai"]{background:#12306a;box-shadow:inset 0 0 0 1px #4a8fd8}
.lto-pill canvas{display:block}
.lto-play{display:inline-flex;align-items:center;gap:6px;margin-left:auto;flex:none}
.lto-sb .lto-play{font:700 13px/1 var(--lto-serif);letter-spacing:.06em;text-transform:uppercase;color:var(--sb-spk)}
.lto-sb .lto-play::after{content:"";width:0;height:0;border:5px solid transparent;border-left:8px solid currentColor;border-right:0}
.lto-play canvas{display:block}
.lto-sb .lto-card[data-ltoai]{border-style:dashed}
.lto-scr-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;min-width:0}
.lto-scr-actions.is-start{justify-content:flex-start}
.lto-root[data-size="s"] .lto-scr-actions{flex-direction:column;align-items:stretch}
.lto-root[data-size="s"] .lto-scr-actions.is-start{align-items:flex-start}
.lto-scr-actions .lto-btn{min-width:120px}
.lto-ta{appearance:none;display:block;width:100%;min-width:0;min-height:96px;margin:0;padding:8px 10px;resize:vertical;pointer-events:auto;font:16px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:inherit}
.lto-ta:disabled{opacity:.6;resize:none}
.lto-ta:focus-visible{outline:2px solid var(--sb-focus);outline-offset:2px}
.lto-px .lto-ta{color:#f4ecd0;background:#141a3c}
.lto-px .lto-ta.lto-fr{padding:2px 4px}
.lto-px .lto-ta::placeholder{color:#98a5d8;opacity:1}
.lto-px .lto-ta:focus-visible{outline-color:#ffc72a}
.lto-sb .lto-ta{font-family:var(--lto-serif);color:var(--sb-ink);background:var(--sb-paper);border:1px solid var(--sb-rule);border-radius:9px;box-shadow:inset 0 1px 3px rgb(var(--sb-shade)/.25)}
.lto-sb .lto-ta::placeholder{color:var(--sb-muted);opacity:1}
.lto-wprog{display:flex;align-items:center;gap:8px;min-width:0}
.lto-wdots{display:flex;align-items:center;gap:5px;flex:none;color:#ffc72a}
.lto-sb .lto-wdots{color:var(--sb-spk)}
.lto-wdots i{display:block;width:6px;height:6px;background:currentColor;animation:lto-narr-dot 1.1s ease-in-out infinite}
.lto-sb .lto-wdots i{border-radius:50%}
.lto-wdots i:nth-child(2){animation-delay:.18s}.lto-wdots i:nth-child(3){animation-delay:.36s}
.lto-wprog .lto-st{flex:1 1 auto}
.lto-card[data-ltoai]:focus{outline:none}
.lto-scr[data-busy="true"] .lto-card[data-lto-adventure],.lto-scr[data-busy="true"] .lto-card[data-lto-room]{opacity:.5}
.lto-endbox{display:flex;flex-direction:column;gap:10px;min-width:0}
.lto-px .lto-endbox .lto-narr-body,.lto-sb .lto-endbox .lto-narr-body{max-height:none;overflow:visible}
.lto-endbox .lto-narr-box{width:100%}
.lto-sb .lto-endbox .lto-narr-body{font-size:16.5px}
.lto-ribbon{width:100%;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0;text-align:center}
.lto-px .lto-ribbon{padding:4px 8px}
.lto-sb .lto-ribbon .lto-num{margin:-3px 0}
.lto-root[data-size="s"] .lto-loc{--nl:4}

@media (prefers-reduced-motion: reduce){.lto-root *{animation:none!important;transition:none!important}}
`;

export function injectStyle(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
