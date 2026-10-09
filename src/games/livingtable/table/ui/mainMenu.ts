/**
 * The main menu: the first thing a player sees after the splash, and the one door to everything outside the game in front of them.
 *
 *   Continue            back to the game in front of them, or the newest save when there is no game open
 *   New game            the adventure list
 *   Load                the Saves tab
 *   Settings            the Settings tab
 *   Licence and credits the text that has to travel with the game
 *
 * It is a modal of its own (a dialog over the board that owns the keys, keeps Tab inside it, and stops the board from acting on what
 * is done here), with its own small style sheet, so it does not depend on the overlay's screens. Every target is at least 44 px tall,
 * and it fits from 320 px wide to a full screen. It decides nothing: the buttons call the options, flows/mainMenu.ts acts on them.
 *
 * Import-pure: nothing touches the page until openMainMenu is called.
 */
import type { TextStyle } from "../host";

export type MenuAct = "continue" | "new" | "load" | "settings" | "credits";

export interface MainMenuButton {
  id: MenuAct;
  label: string;
  /** A quiet line under the label; empty for none. */
  hint: string;
  disabled: boolean;
}

/** One paragraph of the licence text; with an address, the address is a link. */
export interface CreditLine {
  text: string;
  href?: string;
}

export interface MainMenuOptions {
  style: TextStyle;
  /** Whether Continue can do anything (a game is open, or there is a save to go back to). */
  canContinue: boolean;
  /** The quiet line under Continue: where it leads. */
  continueHint: string;
  credits: readonly CreditLine[];
  onContinue(): void;
  onNew(): void;
  onLoad(): void;
  onSettings(): void;
  /** Escape on the main page (Escape on the credits page goes back to the main page first). Absent: Escape does nothing there. */
  onEscape?(): void;
}

export interface MainMenu {
  node: HTMLElement;
  /** Which page is showing. */
  page(): "main" | "credits";
  showCredits(): void;
  showMain(): void;
  close(): void;
}

/** The buttons, in order. Pure. */
export function mainMenuButtons(o: { canContinue: boolean; continueHint: string }): MainMenuButton[] {
  return [
    { id: "continue", label: "Continue", hint: o.canContinue ? o.continueHint : "No game to go back to yet", disabled: !o.canContinue },
    { id: "new", label: "New game", hint: "Pick an adventure", disabled: false },
    { id: "load", label: "Load", hint: "Go back to a saved game", disabled: false },
    { id: "settings", label: "Settings", hint: "", disabled: false },
    { id: "credits", label: "Licence and credits", hint: "", disabled: false },
  ];
}

/** Which button the arrow keys land on: the next (or previous) enabled one, wrapping; Home and End go to the first and last. Pure. */
export function menuNavIndex(enabled: readonly boolean[], from: number, key: string): number {
  const n = enabled.length;
  const ok = (i: number): boolean => enabled[i] === true;
  const first = enabled.findIndex((e) => e);
  if (first < 0) return -1;
  if (key === "Home") return first;
  if (key === "End") {
    for (let i = n - 1; i >= 0; i--) if (ok(i)) return i;
    return first;
  }
  const step = key === "ArrowUp" || key === "ArrowLeft" ? -1 : 1;
  let i = from;
  for (let k = 0; k < n; k++) {
    i = (i + step + n) % n;
    if (ok(i)) return i;
  }
  return from;
}

const STYLE_ID = "ltm-style";

const CSS = `
.ltm{position:absolute;inset:0;z-index:40;display:flex;overflow-x:hidden;overflow-y:auto;box-sizing:border-box;padding:16px 12px;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;touch-action:manipulation;animation:ltm-in .2s ease-out}
@keyframes ltm-in{from{opacity:0}to{opacity:1}}
.ltm[data-style="pixel"]{background:rgb(5 6 26/.97);color:#f4ecd0;font-family:ui-monospace,"Cascadia Mono",Consolas,Menlo,monospace}
.ltm[data-style="storybook"]{background:rgb(33 22 14/.96);color:#f2e6c9;font-family:Georgia,"Iowan Old Style","Times New Roman",serif}
.ltm-card{margin:auto;width:min(440px,100%);min-width:0;display:flex;flex-direction:column;gap:10px}
.ltm-title{margin:0 0 4px;text-align:center;font-weight:800;line-height:1.15;font-size:clamp(22px,8vw,36px);overflow-wrap:anywhere;color:#ffc72a;text-shadow:0 3px 0 #05061a,0 0 14px rgb(255 199 42/.25)}
.ltm[data-style="pixel"] .ltm-title{text-transform:uppercase;letter-spacing:.06em}
.ltm-sub{margin:0 0 10px;text-align:center;font-size:clamp(13px,3.6vw,15px);color:#98a5d8;overflow-wrap:anywhere}
.ltm[data-style="storybook"] .ltm-sub{color:#d9c79b;font-style:italic}
.ltm-btn{appearance:none;font:inherit;color:inherit;margin:0;width:100%;min-width:0;min-height:52px;padding:8px 14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;cursor:pointer;text-align:center;box-sizing:border-box}
.ltm-btn:disabled{opacity:.45;cursor:default}
.ltm-btn:focus-visible{outline:3px solid #ffc72a;outline-offset:2px}
.ltm-label{font-weight:800;font-size:clamp(15px,4.4vw,18px);line-height:1.2;overflow-wrap:anywhere}
.ltm[data-style="pixel"] .ltm-label{text-transform:uppercase;letter-spacing:.05em}
.ltm-hint{font-size:clamp(12px,3.3vw,13.5px);line-height:1.3;color:#98a5d8;overflow-wrap:anywhere}
.ltm[data-style="storybook"] .ltm-hint{color:#d9c79b}
.ltm[data-style="pixel"] .ltm-btn{background:#141a3c;border:3px solid #05061a;box-shadow:inset 0 0 0 2px #4d5da6,0 3px 0 #05061a}
.ltm[data-style="pixel"] .ltm-btn.is-pri{box-shadow:inset 0 0 0 2px #ffc72a,0 3px 0 #05061a}
.ltm[data-style="pixel"] .ltm-btn:not(:disabled):hover{background:#1f2860}
.ltm[data-style="storybook"] .ltm-btn{border-radius:10px;background:linear-gradient(180deg,#f6ecd2,#e6d5aa);color:#3a2616;border:1px solid #8a6a3a;box-shadow:inset 0 0 0 2px #f6ecd2,inset 0 0 0 3px #c99a3a}
.ltm[data-style="storybook"] .ltm-btn .ltm-hint{color:#6b5233}
.ltm[data-style="storybook"] .ltm-btn:not(:disabled):hover{box-shadow:0 0 0 2px #c99a3a,inset 0 0 0 2px #f6ecd2,inset 0 0 0 3px #c99a3a}
.ltm-credits{font-weight:400;display:flex;flex-direction:column;gap:8px;font-size:clamp(13px,3.6vw,15px);line-height:1.45;text-align:left;user-select:text;-webkit-user-select:text}
.ltm-credits p{margin:0;overflow-wrap:anywhere}
.ltm-credits a{color:#8fc4ff}
.ltm[data-style="storybook"] .ltm-credits a{color:#ffd86b}
.ltm-head{margin:0 0 4px;text-align:center;font-weight:800;font-size:clamp(18px,5.4vw,24px);color:#ffc72a;overflow-wrap:anywhere}
.ltm[data-style="pixel"] .ltm-head{text-transform:uppercase;letter-spacing:.05em}
.ltm-foot{position:sticky;bottom:-16px;z-index:2;margin:0 -12px -16px;padding:8px 12px 16px}
.ltm[data-style="pixel"] .ltm-foot{background:#05061a}
.ltm[data-style="storybook"] .ltm-foot{background:#21160e}
.ltm{--cover:#05061a;--shade:rgb(150 166 240/.45)}
.ltm[data-style="storybook"]{--cover:#21160e;--shade:rgb(255 214 120/.38)}
.ltm[data-style]{background-image:linear-gradient(var(--cover) 30%,transparent),linear-gradient(transparent,var(--cover) 70%),radial-gradient(farthest-side at 50% 0,var(--shade),transparent),radial-gradient(farthest-side at 50% 100%,var(--shade),transparent);background-position:top,bottom,top,bottom;background-size:100% 26px,100% 26px,100% 10px,100% 10px;background-repeat:no-repeat;background-attachment:local,local,scroll,scroll}
@media (prefers-reduced-motion:reduce){.ltm{animation:none}}
`;

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement("style");
  st.id = STYLE_ID;
  st.textContent = CSS;
  document.head.appendChild(st);
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** Put the main menu over `host` (the stage). Returns the handle; closing it gives the focus back to where it was. */
export function openMainMenu(host: HTMLElement, opts: MainMenuOptions): MainMenu {
  ensureStyle();
  const root = node("div", "ltm");
  root.dataset.style = opts.style;
  root.dataset.ltmMenu = "main";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Main menu");
  const prevFocus = document.activeElement;
  let closed = false;
  let page: "main" | "credits" = "main";

  const buttons = (): HTMLButtonElement[] => Array.from(root.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")).filter((b) => b.getClientRects().length > 0);

  function drawMain(): void {
    page = "main";
    root.dataset.ltmMenu = "main";
    root.setAttribute("aria-label", "Main menu");
    root.replaceChildren();
    const card = node("div", "ltm-card");
    root.append(card);
    card.append(node("h2", "ltm-title", "The Living Table"), node("p", "ltm-sub", "An AI dungeon master runs your story. The dice are real."));
    const acts: Record<MenuAct, () => void> = {
      continue: () => opts.onContinue(),
      new: () => opts.onNew(),
      load: () => opts.onLoad(),
      settings: () => opts.onSettings(),
      credits: () => showCredits(),
    };
    for (const b of mainMenuButtons({ canContinue: opts.canContinue, continueHint: opts.continueHint })) {
      const btn = node("button", `ltm-btn${b.id === "continue" || (b.id === "new" && !opts.canContinue) ? " is-pri" : ""}`);
      btn.type = "button";
      btn.dataset.ltmAct = b.id;
      btn.disabled = b.disabled;
      btn.setAttribute("aria-label", b.hint ? `${b.label}. ${b.hint}` : b.label);
      btn.append(node("span", "ltm-label", b.label));
      if (b.hint) btn.append(node("span", "ltm-hint", b.hint));
      btn.addEventListener("click", () => {
        if (!closed && !btn.disabled) acts[b.id]();
      });
      card.append(btn);
    }
  }

  function drawCredits(): void {
    page = "credits";
    root.dataset.ltmMenu = "credits";
    root.setAttribute("aria-label", "Licence and credits");
    root.replaceChildren();
    const card = node("div", "ltm-card");
    root.append(card);
    card.append(node("h2", "ltm-head", "Licence and credits"));
    const body = node("div", "ltm-credits");
    body.dataset.ltmCredits = "";
    for (const line of opts.credits) {
      const p = node("p", undefined, line.text);
      if (line.href) {
        p.append(" ");
        const a = node("a", undefined, line.href);
        a.href = line.href;
        a.target = "_blank";
        a.rel = "noreferrer noopener";
        p.append(a);
      }
      body.append(p);
    }
    card.append(body);
    // Back is on a footer that sticks to the bottom of the page, so a long licence text never pushes it under the fold.
    const foot = node("div", "ltm-foot");
    const back = node("button", "ltm-btn is-pri");
    back.type = "button";
    back.dataset.ltmAct = "back";
    back.append(node("span", "ltm-label", "Back"));
    back.addEventListener("click", () => showMain());
    foot.append(back);
    card.append(foot);
  }

  function focusFirst(preferred?: string): void {
    const list = buttons();
    const want = preferred ? list.find((b) => b.dataset.ltmAct === preferred) : undefined;
    (want ?? list.find((b) => b.classList.contains("is-pri")) ?? list[0])?.focus({ preventScroll: true });
  }

  function showCredits(): void {
    if (closed) return;
    drawCredits();
    focusFirst("back");
    root.scrollTop = 0;
  }
  function showMain(): void {
    if (closed) return;
    drawMain();
    focusFirst("credits");
  }

  // The board and the game must not act on what is done here.
  for (const type of ["keyup", "keypress", "pointerdown", "mousedown", "click", "dblclick", "contextmenu", "wheel"]) root.addEventListener(type, (e) => e.stopPropagation());
  root.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      if (page === "credits") showMain();
      else opts.onEscape?.();
      return;
    }
    const list = buttons();
    if (e.key === "Tab") {
      if (list.length === 0) {
        e.preventDefault();
        return;
      }
      const i = list.indexOf(document.activeElement as HTMLButtonElement);
      if (i < 0 || (e.shiftKey && i === 0) || (!e.shiftKey && i === list.length - 1)) {
        e.preventDefault();
        (e.shiftKey && i >= 0 ? list[list.length - 1]! : list[0]!).focus();
      }
      return;
    }
    if (page === "main" && ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const all = Array.from(root.querySelectorAll<HTMLButtonElement>("button.ltm-btn"));
      const at = all.indexOf(document.activeElement as HTMLButtonElement);
      const to = menuNavIndex(all.map((b) => !b.disabled), at < 0 ? 0 : at, e.key);
      if (to >= 0 && all[to]) {
        e.preventDefault();
        all[to]!.focus({ preventScroll: true });
      }
    }
  });

  drawMain();
  host.append(root);
  focusFirst();

  return {
    node: root,
    page: () => page,
    showCredits,
    showMain,
    close() {
      if (closed) return;
      const had = root.contains(document.activeElement);
      closed = true;
      root.remove();
      if ((had || document.activeElement === document.body) && prevFocus instanceof HTMLElement && prevFocus.isConnected) prevFocus.focus({ preventScroll: true });
    },
  };
}
