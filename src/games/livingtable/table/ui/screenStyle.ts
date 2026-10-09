/**
 * The adventure screens' extra rules (the start screen, the hero choice, the ending): scroll cues, and a wider body on a wide board.
 *
 * It is injected by installScreenKit AFTER overlayStyle's sheet, so these rules win over the `.lto-scr` ones at equal weight, and every one
 * is under `.lto-scr` or `.lto-root`, so nothing leaks out to the page.
 */

export const SCREEN_STYLE_ID = "lto-screen-style";

export const SCREEN_CSS = `
/* the screen is a size container: its rules answer to the room the board gives it, not to the page */
.lto-scr{container-type:inline-size;container-name:scr}

/* scroll shadows (Lea Verou's): a shade shows at an edge while content continues past it, and goes when the scroll reaches that end.
   The covers are the screen's own colour (translucent, so the board shows through as it does everywhere else on the screen). */
.lto-px .lto-scr-scroll{--cover:rgb(5 6 26/.94);--shade:rgb(150 166 240/.45)}
.lto-sb .lto-scr-scroll{--cover:rgb(var(--sb-shade)/.92);--shade:rgb(255 214 120/.38)}
.lto-scr-scroll{background:linear-gradient(var(--cover) 30%,transparent) top/100% 26px no-repeat local,linear-gradient(transparent,var(--cover) 70%) bottom/100% 26px no-repeat local,radial-gradient(farthest-side at 50% 0,var(--shade),transparent) top/100% 10px no-repeat scroll,radial-gradient(farthest-side at 50% 100%,var(--shade),transparent) bottom/100% 10px no-repeat scroll}

/* the hero choice's pager sticks to the bottom: bringing a control into view leaves it clear of the pager */
.lto-scr[data-lto-screen="hero"] .lto-scr-scroll{scroll-padding-bottom:56px}

/* a phone's screens keep their blocks close */
.lto-root[data-size="s"] .lto-scr-body{gap:8px}
.lto-scr-scroll{--scr-pb:18px}
.lto-root[data-size="s"] .lto-scr-scroll{--scr-pb:12px;padding:10px 10px 12px}

/* a wide board: the body is wider (the adventure list is two columns, an auto-fill grid so the width of a card never depends on how many are drawn yet, and "Something new" is on screen without scrolling) */
@container scr (min-width:900px){
  .lto-scr-body{width:min(1040px,100%)}
  .lto-card-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:10px;align-items:start}
}
`;

/** Add the sheet to the page once (a no-op where there is no document). */
export function injectScreenStyle(): void {
  if (typeof document === "undefined" || document.getElementById(SCREEN_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = SCREEN_STYLE_ID;
  style.textContent = SCREEN_CSS;
  document.head.appendChild(style);
}
