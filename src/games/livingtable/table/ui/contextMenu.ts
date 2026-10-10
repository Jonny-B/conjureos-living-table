/**
 * The context menu: draws a click's actions, places them on the board, handles keys and picks.
 */
import { wrapWidth, type PixelColor } from "./pixelFont";
import { cardNavIndex } from "./tip";
import type { OverlayPoint, ContextMenuEntry } from "./overlayTypes";
import { el, deviceRatio, svgEl } from "./domKit";
import { PX } from "./overlayTheme";
import { MENU_MARGIN, menuPlacement, menuWidth, menuEntryName, MENU_GRACE_MS, MENU_NARROW_PX, menuEntries, trackMore, boardRoomAboveKeyboard, type MenuRect } from "./menuHelpers";
import { injectMenuStyle } from "./contextMenuStyle";
import type { OverlayCtx } from "./overlayCtx";

  export interface MenuState {
    at: OverlayPoint;
    entries: ContextMenuEntry[];
    onPick: (id: string) => void;
    title?: string;
    /** A rectangle of the board the menu keeps off if it can (the hero's square). */
    avoid?: MenuRect;
    /** Keeps data-more on the menu while it scrolls (a phone: the rows do not all fit). */
    more?: { update: () => void; off: () => void };
    node: HTMLElement;
    rows: HTMLElement[];
    focus: number;
    openedAt: number;
    prevFocus: Element | null;
    off: () => void;
    /** What was typed in the text line, kept across a redraw (the window resizing under an open menu). */
    draft?: string;
  }

/** True on a phone or tablet: a finger, so no field takes the keyboard until it is tapped. */
function coarsePointer(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

export function installContextMenu(oc: OverlayCtx): void {
  // ---- context menu

  /** The star of a "good" entry: Font Awesome's solid star outline, drawn inline so there is no icon font. */
  const STAR_PATH =
    "M316.9 18C311.6 7 300.4 0 288.1 0s-23.4 7-28.8 18L195 150.3 51.4 171.5c-12 1.8-22 10.2-25.7 21.7s-.7 24.2 7.9 32.7L137.8 329 113.2 474.7c-2 12 3 24.2 12.9 31.3s23 8 33.8 2.3l128.3-68.5 128.3 68.5c10.8 5.7 23.9 4.9 33.8-2.3s14.9-19.3 12.9-31.3L438.5 329 542.7 225.9c8.6-8.5 11.7-21.2 7.9-32.7s-13.8-19.9-25.7-21.7L381.2 150.3 316.9 18z";
  oc.menu = null;
  const menuLayer = el("div", "lto-menu-layer");
  injectMenuStyle();

  function starMark(): SVGSVGElement {
    const svg = svgEl("svg", { viewBox: "0 0 576 512", "aria-hidden": "true", focusable: "false" });
    svg.append(svgEl("path", { d: STAR_PATH }));
    return svg;
  }

  const askInput = (m: MenuState): HTMLInputElement | null => m.node.querySelector<HTMLInputElement>("input[data-lto-cm-input]");
  const isAskRow = (m: MenuState, i: number): boolean => m.entries[i]?.kind === "text";

  /** Focus a line. The text line takes the keyboard only when the player reached it (an arrow key, a tap), never as the first thing on a touch screen. */
  function setMenuFocus(m: MenuState, i: number, reached = true): void {
    if (i < 0 || i >= m.rows.length) return;
    if (isAskRow(m, i)) {
      const input = askInput(m);
      if (!input || input.disabled) return;
      if (!reached && coarsePointer()) return;
      m.focus = i;
      input.focus({ preventScroll: true });
      return;
    }
    m.focus = i;
    m.rows[i]?.focus({ preventScroll: true });
  }

  /** The board's room for the menu: its own size, less whatever a soft keyboard covers of it. */
  function boardRoom(): { width: number; height: number } {
    const width = oc.root.clientWidth || oc.width;
    const height = oc.root.clientHeight;
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return { width, height };
    const bottom = oc.root.getBoundingClientRect().bottom;
    return { width, height: boardRoomAboveKeyboard(height, bottom, vv.offsetTop + vv.height) };
  }

  function placeMenu(m: MenuState): void {
    const n = m.node;
    const board = boardRoom();
    n.style.visibility = "hidden";
    n.style.left = "0px";
    n.style.top = "0px";
    n.style.maxHeight = `${Math.max(0, board.height - MENU_MARGIN * 2)}px`;
    const p = menuPlacement(m.at, { width: n.offsetWidth, height: n.offsetHeight }, board, MENU_MARGIN, m.avoid);
    n.style.left = `${Math.round(p.left)}px`;
    n.style.top = `${Math.round(p.top)}px`;
    n.style.maxHeight = `${p.maxHeight}px`;
    m.more?.update();
    n.dataset.flipX = String(p.flipX);
    n.dataset.flipY = String(p.flipY);
    n.style.visibility = "";
  }

  /** Send what is in the text line: the menu closes and the words go to whoever asked for the line. */
  function submitText(m: MenuState, i: number): void {
    if (oc.menu !== m) return;
    const e = m.entries[i];
    const input = askInput(m);
    if (!e || !input || !e.enabled) return;
    const words = input.value.replace(/\s+/g, " ").trim();
    if (!words) return;
    const send = e.onSubmit;
    closeMenu(false);
    send?.(words);
  }

  /** Draw the menu's rows for the current style and width, keeping the focused row. */
  function renderMenu(m: MenuState): void {
    const pixel = oc.isPixel();
    const n = m.node;
    // A redraw keeps what the player was typing, and whether the field had the keyboard.
    const before = askInput(m);
    if (before) m.draft = before.value;
    const hadKeyboard = !!before && document.activeElement === before;
    n.className = "lto-cm";
    if (pixel) oc.frame(n, "win", true);
    else n.classList.add("lto-plate");
    const W = menuWidth(oc.root.clientWidth || oc.width);
    n.style.width = `${W}px`;
    // Under 300 px the Send button goes under the text line, so the line keeps the whole width.
    n.dataset.narrow = String(W < MENU_NARROW_PX);
    const room = Math.max(40, W - (pixel ? 10 : 2) - 6 - 16 - 26);
    const ratio = deviceRatio();
    const kids: HTMLElement[] = [];
    if (m.title) {
      const t = el("div", "lto-cm-title");
      t.setAttribute("aria-hidden", "true");
      if (pixel) t.append(oc.px(m.title, { scale: 2, weight: "bold", color: PX.gold, outline: PX.dark, maxWidth: wrapWidth(W - 30, 2, ratio) }));
      else t.textContent = m.title;
      kids.push(t);
    }
    m.rows = [];
    m.entries.forEach((e, i) => {
      const line = (cls: string, words: string, color: PixelColor, bold = false, wide = room): HTMLElement => {
        const d = el("div", cls);
        // The small lines are drawn at the label's size: a reader should never have to squint at the reason for a line.
        if (pixel) d.append(oc.px(words, { scale: 2, weight: bold ? "bold" : "regular", color, outline: PX.dark, maxWidth: wrapWidth(wide, 2, ratio) }));
        else d.textContent = words;
        return d;
      };
      if (e.kind === "text") {
        const row = el("div", "lto-cm-row lto-cm-ask");
        row.setAttribute("role", "group");
        row.setAttribute("aria-label", e.label);
        row.dataset.ltoMenuItem = e.id;
        row.dataset.ltoCmAsk = "";
        row.dataset.enabled = String(e.enabled);
        const input = document.createElement("input");
        input.type = "text";
        input.className = "lto-cm-input";
        input.dataset.ltoCmInput = "";
        // The field is narrow: what it shows empty is the short hint, and the screen reader keeps the whole words.
        input.placeholder = e.hint ?? e.placeholder ?? e.label;
        input.setAttribute("aria-label", e.placeholder ? `${e.label}: ${e.placeholder}` : e.label);
        input.autocomplete = "off";
        input.maxLength = 300;
        input.enterKeyHint = "send";
        input.setAttribute("autocapitalize", "sentences");
        input.disabled = !e.enabled;
        if (m.draft) input.value = m.draft;
        const send = document.createElement("button");
        send.type = "button";
        send.className = "lto-btn lto-cm-send";
        send.dataset.ltoCmSend = "";
        send.setAttribute("aria-label", "Send");
        send.disabled = !e.enabled;
        if (pixel) send.append(oc.px("Send", { scale: 2, weight: "bold", color: PX.ink, outline: PX.dark }));
        else send.textContent = "Send";
        send.addEventListener("click", (ev) => {
          ev.stopPropagation();
          submitText(m, i);
        });
        row.append(input, send);
        if (!e.enabled && e.reason) {
          const why = line("lto-cm-reason lto-cm-ask-reason", e.reason, "#ff8c7a");
          row.append(why);
        }
        m.rows.push(row);
        kids.push(row);
        return;
      }
      const row = el("div", "lto-cm-row");
      row.setAttribute("role", "menuitem");
      row.tabIndex = -1;
      row.dataset.ltoMenuItem = e.id;
      row.dataset.enabled = String(e.enabled);
      row.dataset.good = String(!!e.good);
      row.dataset.text = e.label;
      if (!e.enabled) row.setAttribute("aria-disabled", "true");
      row.setAttribute("aria-label", menuEntryName(e));
      const mark = el("span", "lto-cm-mark");
      mark.setAttribute("aria-hidden", "true");
      if (e.good) mark.append(starMark());
      const text = el("div", "lto-cm-text");
      text.setAttribute("aria-hidden", "true");
      text.append(line("lto-cm-label", e.label, e.good ? PX.gold : PX.ink, e.good));
      if (e.why) text.append(line("lto-cm-why", e.why, PX.muted));
      if (e.note) text.append(line("lto-cm-note", e.note, PX.gold));
      if (!e.enabled && e.reason) text.append(line("lto-cm-reason", e.reason, "#ff8c7a"));
      row.append(mark, text);
      row.addEventListener("pointerenter", (ev) => {
        // The mouse drifting over a line must not take the keyboard from the text line while someone types in it.
        if (ev.pointerType === "mouse" && !(document.activeElement instanceof HTMLInputElement && n.contains(document.activeElement))) setMenuFocus(m, i, false);
      });
      row.addEventListener("click", (ev) => {
        ev.stopPropagation();
        pickMenu(m, i, "pointer");
      });
      m.rows.push(row);
      kids.push(row);
    });
    n.replaceChildren(...kids);
    placeMenu(m);
    if (hadKeyboard && askInput(m)) askInput(m)!.focus({ preventScroll: true });
    else setMenuFocus(m, m.focus, false);
  }

  function closeMenu(refocus: boolean): void {
    const m = oc.menu;
    if (!m) return;
    oc.menu = null;
    m.off();
    m.more?.off();
    m.node.remove();
    if (refocus && m.prevFocus instanceof HTMLElement && m.prevFocus.isConnected) m.prevFocus.focus({ preventScroll: true });
  }

  function pickMenu(m: MenuState, i: number, via: "pointer" | "key"): void {
    if (oc.menu !== m) return;
    const e = m.entries[i];
    if (!e) return;
    if (e.kind === "text") return setMenuFocus(m, i);
    if (via === "pointer" && performance.now() - m.openedAt < MENU_GRACE_MS) return;
    if (!e.enabled) {
      if (e.reason) oc.announce(`${e.label}: ${e.reason}`);
      return;
    }
    const pick = m.onPick;
    closeMenu(via === "key");
    pick(e.id);
  }

  function contextMenu(at: OverlayPoint, entries: readonly ContextMenuEntry[], onPick: (id: string) => void, mopts: { title?: string; avoid?: MenuRect } = {}): () => void {
    if (oc.destroyed) return () => {};
    closeMenu(false);
    const list = menuEntries(entries);
    if (list.length === 0) return () => {};
    const node = el("div");
    node.dataset.ltoMenu = "";
    node.setAttribute("role", "menu");
    node.setAttribute("aria-label", mopts.title ?? "Actions");
    const m: MenuState = { at: { x: at.x, y: at.y }, entries: list, onPick, title: mopts.title, avoid: mopts.avoid, node, rows: [], focus: 0, openedAt: performance.now(), prevFocus: document.activeElement, off: () => {} };
    // The board and the page must not act on what is done in the menu.
    for (const type of ["pointerdown", "mousedown", "click", "dblclick", "contextmenu", "wheel"]) {
      node.addEventListener(type, (ev) => {
        ev.stopPropagation();
        // The text line keeps the browser's own right-click menu (paste); every other line has none.
        if (type === "contextmenu" && !(ev.target instanceof HTMLInputElement)) ev.preventDefault();
      });
    }
    const onDown = (ev: PointerEvent): void => {
      const t = ev.target as Node | null;
      if (t && node.contains(t)) return;
      closeMenu(false);
      // The click that dismisses it is not also a walk or an attack on the board underneath.
      if (ev.button === 0 && t && oc.host.contains(t)) {
        const eat = (c: MouseEvent): void => {
          c.stopPropagation();
          c.preventDefault();
        };
        document.addEventListener("click", eat, { capture: true, once: true });
        window.setTimeout(() => document.removeEventListener("click", eat, true), 600);
      }
    };
    const askAt = (): number => list.findIndex((e) => e.kind === "text");
    const onKey = (ev: KeyboardEvent): void => {
      const target = ev.target instanceof HTMLElement ? ev.target : null;
      const inAsk = !!target && node.contains(target) && !!target.closest("[data-lto-cm-ask]");
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        closeMenu(true);
      } else if (inAsk) {
        // The text line is typed in: Space is a space, Tab walks to Send, Home and End move the caret. Enter sends. The arrows leave it for the other lines.
        if (ev.key === "Enter" && target instanceof HTMLInputElement && !ev.isComposing) {
          ev.preventDefault();
          ev.stopPropagation();
          submitText(m, askAt());
        } else if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && target instanceof HTMLInputElement) {
          ev.preventDefault();
          ev.stopPropagation();
          setMenuFocus(m, cardNavIndex(m.rows.length, askAt(), ev.key));
        }
      } else if (ev.key === "ArrowDown" || ev.key === "ArrowUp" || ev.key === "Home" || ev.key === "End") {
        ev.preventDefault();
        ev.stopPropagation();
        setMenuFocus(m, cardNavIndex(m.rows.length, m.focus, ev.key));
      } else if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        ev.stopPropagation();
        pickMenu(m, m.focus, "key");
      } else if (ev.key === "Tab") {
        closeMenu(false);
      }
    };
    // A soft keyboard shrinks what can be seen: the menu moves up out from under it.
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    const onViewport = (): void => {
      if (oc.menu === m) placeMenu(m);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    vv?.addEventListener("resize", onViewport);
    vv?.addEventListener("scroll", onViewport);
    m.off = () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      vv?.removeEventListener("resize", onViewport);
      vv?.removeEventListener("scroll", onViewport);
    };
    oc.menu = m;
    m.more = trackMore(node);
    menuLayer.append(node);
    renderMenu(m);
    return () => {
      if (oc.menu === m) closeMenu(false);
    };
  }

  // What the other modules call or read.
  oc.menuLayer = menuLayer;
  oc.renderMenu = renderMenu;
  oc.closeMenu = closeMenu;
  oc.contextMenu = contextMenu;
}
