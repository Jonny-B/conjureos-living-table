/**
 * The table window's own stylesheet.
 *
 * Everything the window draws that the other table modules (overlay, dice,
 * sheet, tip) do not style themselves: the arena (board beside the HUD and dice
 * tray), the scrolling viewport, the board with its fog and marks canvases laid
 * over the canvas, the note text and the little buttons.
 *
 * Moved out of the asset bench's panel stylesheet and rewritten so it can live
 * in the game page:
 *
 *   - Every selector starts with `.ltt-root`, the class mountTable puts on the
 *     window's root element. The injected `<style>` is unlayered, so it outranks
 *     the game's layered sheets; the prefix is what keeps it from touching
 *     anything outside the window.
 *   - The board canvas class is `.ltt-canvas` (it was `.lt-canvas`, which the
 *     game's own styles.css also defines for its flat board). The other bench
 *     class names stay as they were (lt-arena, lt-game, lt-viewport, lt-board,
 *     lt-reset, lt-start, ...) so the bench's scripts keep finding them, and
 *     none of them is defined by styles.css as the window uses it.
 *   - The colours are the `--bn-*` tokens (the bench's own names, so the bench's
 *     light and dark themes reach the window unchanged). The root also defines a
 *     complete set as `--ltt-*` and every use reads `var(--bn-x, var(--ltt-x))`:
 *     a page that supplies `--bn-*` (the bench) wins, and a page that does not
 *     (the game) gets the root's own light or dark set. A token defined on the
 *     root under the `--bn-` names would instead have overridden the bench's
 *     theme for the whole window, because a declaration on an element always
 *     beats the value it would inherit.
 *
 * Import-pure: nothing here touches the page until `injectTableStyle` is called.
 */

/** The class mountTable puts on the window's root element; every rule below is scoped under it. */
export const TABLE_ROOT_CLASS = "ltt-root";
/** The class of the board canvas. */
export const BOARD_CANVAS_CLASS = "ltt-canvas";
/** The id of the injected `<style>` element, so it is added once however many windows mount. */
export const TABLE_STYLE_ID = "ltt-style";

/** The tokens the window reads, with the light and the dark value of each (the bench's palette). */
const TOKENS: readonly { name: string; light: string; dark: string }[] = [
  { name: "bg", light: "#f6f4ef", dark: "#131319" },
  { name: "panel", light: "#ffffff", dark: "#1b1b23" },
  { name: "panel-alt", light: "#efece4", dark: "#22222c" },
  { name: "line", light: "#ddd7c9", dark: "#31313d" },
  { name: "text", light: "#1d1b16", dark: "#eceaf5" },
  { name: "muted", light: "#6c6656", dark: "#9c98ad" },
  { name: "accent", light: "#6d4fe0", dark: "#a48af9" },
  { name: "focus", light: "#1d63e0", dark: "#8ab4ff" },
];

const R = `.${TABLE_ROOT_CLASS}`;

/** A colour token as the rules read it: the page's `--bn-*` if it has one, else the root's own `--ltt-*`. */
const t = (name: string): string => `var(--bn-${name},var(--ltt-${name}))`;

const tokenBlock = (pick: "light" | "dark"): string => TOKENS.map((k) => `--ltt-${k.name}:${k[pick]};`).join("");

/**
 * The layout of the window on the game's own page (the root carries data-fit, set by mountTable when it sits in the page's .lt-app; the bench's panel does not
 * get it and keeps the fixed box). The root fills the page's window; the arena fills the root; the stage takes what the tray column leaves and the board is sized
 * by stageFit.ts from the stage's measured box (its inline width and height), so nothing here caps it. At 720 px and narrower the tray column stacks under the
 * stage and the page scrolls; the dice tray rises over the stage as a layer above the DM's dock band.
 */
function fitCss(): string {
  // The max-height block at the end is for a phone on its side: every pixel of height is the board's, so the gutters shrink and the DM's dock band
  // is painted only while the box is up (the board gives way for it then; at that height a jump is the lesser evil).
  return `
${R}[data-fit]{display:flex;flex-direction:column;height:100%;min-height:0;padding:6px}
${R}[data-fit] .lt-arena{flex:1 1 0;min-height:0;margin:0;flex-wrap:nowrap;align-items:stretch;gap:12px}
${R}[data-fit] .lt-stage-wrap{flex:1 1 0;min-width:0;min-height:0!important;width:auto;max-width:none;display:flex;align-items:center;justify-content:center}
${R}[data-fit] .lt-viewport{flex:none;max-width:none;max-height:none;overflow:hidden}
${R}[data-fit] .lt-board{width:100%;height:100%}
${R}[data-fit] .lt-board>canvas{width:100%!important;height:100%!important}
${R}[data-fit] .lt-tray-col{flex:0 0 clamp(320px,calc(16vw / var(--lt-zoom,1)),440px);width:clamp(320px,calc(16vw / var(--lt-zoom,1)),440px);min-height:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain}
${R}[data-fit] .lt-tray-col[data-more=down]{-webkit-mask-image:linear-gradient(#000 calc(100% - 28px),transparent);mask-image:linear-gradient(#000 calc(100% - 28px),transparent)}
${R}[data-fit] .lt-tray-col[data-more=up]{-webkit-mask-image:linear-gradient(transparent,#000 28px);mask-image:linear-gradient(transparent,#000 28px)}
${R}[data-fit] .lt-tray-col[data-more=both]{-webkit-mask-image:linear-gradient(transparent,#000 28px,#000 calc(100% - 28px),transparent);mask-image:linear-gradient(transparent,#000 28px,#000 calc(100% - 28px),transparent)}
${R}[data-fit] .lt-stage-wrap>.lt-dice-host.lt-dice-over{position:absolute;left:50%;bottom:calc(var(--lto-dock,0px) + 8px);width:min(360px,calc(100% - 16px));transform:translateX(-50%);z-index:30;pointer-events:auto}
${R}[data-fit] .lt-stage-wrap>.lt-dice-host.lt-dice-over.lt-dice-quiet{visibility:hidden;pointer-events:none}
@media (max-width:720px){
${R} .lt-arena[data-menu-open] .lt-tray-col{display:none}
${R}[data-fit]{height:auto;min-height:100%;padding:2px}
${R}[data-fit] .lt-arena{flex:1 0 auto;flex-direction:column;gap:8px}
${R}[data-fit] .lt-game{padding:3px}
${R}[data-fit] .lt-stage-wrap{flex:none;width:100%;padding-bottom:0}
${R}[data-fit] .lt-stage-wrap:has(.lto-dlg:not([hidden])){padding-bottom:var(--lto-dock,0px)}
${R}[data-fit] .lt-stage-wrap>.lt-dice-host.lt-dice-over{bottom:8px}
${R}[data-fit] .lt-stage-wrap:has(.lto-dlg:not([hidden]))>.lt-dice-host.lt-dice-over{bottom:calc(var(--lto-dock,0px) + 8px)}
${R}[data-fit] .lt-tray-col{flex:1 0 auto;width:100%;overflow:visible}
}
@media (max-height:500px){
${R}[data-fit]{padding:2px}
${R}[data-fit] .lt-arena{gap:6px}
${R}[data-fit] .lt-game{padding:3px}
${R}[data-fit] .lt-stage-wrap{padding-bottom:0}
${R}[data-fit] .lt-stage-wrap:has(.lto-dlg:not([hidden])){padding-bottom:var(--lto-dock,0px)}
${R}[data-fit] .lt-stage-wrap>.lt-dice-host.lt-dice-over{bottom:8px}
${R}[data-fit] .lt-stage-wrap:has(.lto-dlg:not([hidden]))>.lt-dice-host.lt-dice-over{bottom:calc(var(--lto-dock,0px) + 8px)}
}`;
}

/** The whole stylesheet as text (for tests, or a host that wants to inline it). */
export function tableStyleCss(): string {
  return `
${R}{${tokenBlock("light")}font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:${t("text")};user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
${R} input,${R} textarea,${R} select,${R} [contenteditable],${R} [data-lt-copy]{user-select:text;-webkit-user-select:text;-webkit-touch-callout:default}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) ${R}{${tokenBlock("dark")}}}
:root[data-theme="dark"] ${R}{${tokenBlock("dark")}}
${R},${R} *,${R} *::before,${R} *::after{box-sizing:border-box}
${R} *:focus-visible{outline:2px solid ${t("focus")};outline-offset:2px;border-radius:4px}
${R} .lt-note{color:${t("muted")};font-size:12.5px;max-width:74ch}
${R} .lt-howto{margin:0 0 6px}
${R} .lt-arena{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;margin:4px 0 8px}
${R} .lt-game{padding:10px;border-radius:12px;background:#0c0e1d;box-shadow:inset 0 0 0 1px rgb(255 255 255/.06),0 6px 18px rgb(0 0 0/.25)}
${R} .lt-game .lt-viewport{border-color:#262a47}
${R} .lt-reset{font:inherit;font-size:12.5px;padding:6px 10px;border:1px solid ${t("line")};border-radius:8px;background:${t("panel")};color:${t("text")};cursor:pointer}
${R} .lt-stage-wrap{position:relative;width:fit-content;max-width:100%;padding-bottom:var(--lto-dock,0px);padding-top:var(--lto-top-band,0px);box-sizing:border-box}
${R} .lt-tray-col{flex:0 0 320px;width:320px;min-width:0;max-width:100%;display:flex;flex-direction:column;gap:8px}
${R} .lt-tray-col>*{max-width:100%}
${R} .lt-dice-shop>summary{cursor:pointer;font-size:12.5px;color:${t("muted")}}
@media (min-width:721px){${R} .lt-stage-wrap{max-width:calc(100% - 344px)}}
@media (max-width:720px){${R} .lt-tray-col{flex:1 1 100%;width:auto}}
${R} .lt-viewport{overflow:auto;max-width:100%;border:1px solid ${t("line")};border-radius:8px;background:${t("panel-alt")};touch-action:manipulation}
${R}:not([data-fit]) .lt-viewport{max-height:min(66vh,620px)}
${R} .lt-board{position:relative;width:max-content}
${R} .lt-arena[data-screens] .lt-tray-col{display:none}
${R} .${BOARD_CANVAS_CLASS}{image-rendering:pixelated;display:block}
${R} .lt-marks{position:absolute;left:0;top:0;pointer-events:none;image-rendering:pixelated}
${R} .lt-shroud{position:absolute;left:0;top:0;pointer-events:none;image-rendering:pixelated}
${R} .lt-item-icon{image-rendering:pixelated;display:block;background:${t("panel-alt")};border-radius:6px}
@media (max-width:720px){${R}:not([data-fit]) .lt-viewport{max-height:52vh}}
${fitCss()}
`;
}

/** Add the stylesheet to the page, once. Safe to call from every mount, and a no-op where there is no document. */
export function injectTableStyle(doc: Document | undefined = typeof document === "undefined" ? undefined : document): void {
  if (!doc || doc.getElementById(TABLE_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = TABLE_STYLE_ID;
  style.textContent = tableStyleCss();
  doc.head.appendChild(style);
}
