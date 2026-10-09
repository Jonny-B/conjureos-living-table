/**
 * The context menu's own style rules, kept here so the menu owns how big its small lines are drawn.
 *
 * The rules name the root and its text style together (`.lto-root.lto-sb` is one element), so they win on specificity whatever the order.
 */

export const CM_STYLE_ID = "lto-cm-style";

export const CM_CSS = `
.lto-root.lto-sb .lto-cm-label{font:700 15px/1.25 var(--lto-serif)}
.lto-root.lto-sb .lto-cm-why,.lto-root.lto-sb .lto-cm-reason,.lto-root.lto-sb .lto-cm-note{font:700 14.5px/1.3 var(--lto-serif);overflow-wrap:anywhere}
.lto-root.lto-sb .lto-cm-why{font-style:normal;color:var(--sb-muted)}
.lto-root.lto-sb .lto-cm-reason{color:var(--sb-bad)}
.lto-root.lto-sb .lto-cm-note{color:var(--sb-gold)}
.lto-cm-why canvas,.lto-cm-reason canvas,.lto-cm-note canvas{display:block}
@media (pointer: coarse){.lto-root .lto-cm-row{min-height:44px}}
.lto-root[data-size="s"] .lto-cm-row{min-height:44px}
.lto-cm-ask{grid-template-columns:minmax(60%,1fr) auto;gap:6px;align-items:center;cursor:default}
.lto-cm[data-narrow="true"] .lto-cm-ask{grid-template-columns:minmax(0,1fr)}
.lto-cm-ask .lto-cm-ask-reason{grid-column:1 / -1}
.lto-cm-input{appearance:none;display:block;margin:0;width:100%;min-width:0;min-height:44px;padding:6px 10px;font:16px/1.25 ui-sans-serif,system-ui,sans-serif;color:inherit;border:1px solid transparent;border-radius:4px}
.lto-cm-input:disabled{opacity:.55}
.lto-cm-input:focus-visible,.lto-cm-send:focus-visible{outline:2px solid var(--sb-focus,#ffc72a);outline-offset:2px}
.lto-cm-send{min-height:44px;min-width:60px;padding:4px 12px}
.lto-px .lto-cm-input{color:#f4ecd0;background:#141a3c;border:2px solid #4d5da6;border-radius:0}
.lto-px .lto-cm-input::placeholder{color:#98a5d8;opacity:1}
.lto-px .lto-cm-send{background:#141a3c;border:2px solid #4d5da6;border-radius:0}
.lto-sb .lto-cm-input{background:rgb(var(--sb-shade)/.08);border-color:var(--sb-rule);color:var(--sb-ink)}
.lto-sb .lto-cm-send{background:rgb(var(--sb-shade)/.12);border:1px solid var(--sb-rule);border-radius:6px;font:700 15px/1.2 var(--lto-serif);color:var(--sb-ink)}
/* a scroller with more past an edge shows a shade there (data-more is kept by trackMore in menuHelpers.ts) */
.lto-cm::before,.lto-cm::after,.lto-story-panel::before{pointer-events:none}
.lto-cm[data-more]::before,.lto-cm[data-more]::after{content:"";flex:none;position:sticky;display:block;height:14px;z-index:2;opacity:0}
.lto-cm[data-more]::before{top:0;margin-bottom:-14px;order:-1;background:linear-gradient(var(--cue,rgb(0 0 0/.5)),transparent)}
.lto-cm[data-more]::after{bottom:0;margin-top:-14px;background:linear-gradient(transparent,var(--cue,rgb(0 0 0/.5)))}
.lto-cm[data-more="down"]::after,.lto-cm[data-more="both"]::after,.lto-cm[data-more="up"]::before,.lto-cm[data-more="both"]::before{opacity:1}
.lto-px .lto-cm{--cue:rgb(130 148 230/.55)}
.lto-sb .lto-cm{--cue:rgb(var(--sb-shade)/.4)}
.lto-px .lto-cm-ask:focus-within,.lto-sb .lto-cm-ask:focus-within{background:none;box-shadow:none}
`;

/** Add the rules to the page once. */
export function injectMenuStyle(): void {
  if (typeof document === "undefined" || document.getElementById(CM_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = CM_STYLE_ID;
  style.textContent = CM_CSS;
  document.head.appendChild(style);
}
