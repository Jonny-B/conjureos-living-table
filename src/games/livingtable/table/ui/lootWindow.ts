/**
 * The loot window: the things on a body or a pile, with Take and Take all.
 */
import { textWidth, wrapWidth } from "./pixelFont";
import { attachTip } from "./tip";
import type { LootWindowOptions, LootWindowItem, LootWindow } from "./overlayTypes";
import { el, deviceRatio } from "./domKit";
import { PX } from "./overlayTheme";
import { LOOT_EMPTY_MS } from "./menuHelpers";
import type { OverlayCtx } from "./overlayCtx";

  // ---- loot window

  export interface LootState {
    opts: LootWindowOptions;
    items: LootWindowItem[];
    node: HTMLElement;
    tipOff: Array<() => void>;
    emptyTimer: number;
    /** The first draw puts the focus on a Take button; later ones only keep it where it was. */
    drawn: boolean;
  }

export function installLootWindow(oc: OverlayCtx): void {
  oc.loot = null;
  const lootHost = el("div", "lto-loot-host");

  function layoutLoot(): void {
    if (!oc.loot) return;
    lootHost.style.top = `${oc.safeTop()}px`;
    const list = oc.loot.node.querySelector<HTMLElement>(".lto-loot-list");
    if (!list) return;
    // The list takes what the panel leaves of the board (its own title and buttons are measured, not guessed) and scrolls past that.
    list.style.maxHeight = "";
    const chrome = oc.loot.node.offsetHeight - list.offsetHeight;
    list.style.maxHeight = `${Math.max(80, oc.root.clientHeight - oc.safeTop() - oc.bottom.offsetHeight - 16 - chrome)}px`;
  }

  function renderLoot(l: LootState): void {
    const pixel = oc.isPixel();
    const n = l.node;
    const was = document.activeElement as HTMLElement | null;
    const focusKey = was && n.contains(was) ? (was.dataset.lootTake ?? (was.dataset.lootAll !== undefined ? "@all" : was.dataset.lootClose !== undefined ? "@close" : null)) : null;
    for (const off of l.tipOff) off();
    l.tipOff = [];
    n.className = "lto-loot";
    if (pixel) oc.frame(n, "win", true);
    else n.classList.add("lto-plate");
    const ratio = deviceRatio();
    const W = Math.min(340, (oc.root.clientWidth || oc.width) - 16);
    const takeW = pixel ? Math.ceil(textWidth("Take", "bold") * 2) + 34 : 64;
    const room = Math.max(40, W - (pixel ? 10 : 2) - 16 - 8 - takeW);
    const empty = l.items.length === 0;
    n.dataset.empty = String(empty);
    n.dataset.count = String(l.items.length);
    const btn = (label: string, cls: string, pri = false): HTMLButtonElement => {
      const b = el("button", `lto-btn ${cls}${pri ? " is-pri" : ""}`);
      b.type = "button";
      b.setAttribute("aria-label", label);
      if (pixel) {
        b.classList.add("lto-fr", "fs1", pri ? "fr-gold" : "fr-win");
        b.append(oc.px(label, { scale: 2, weight: "bold", color: pri ? PX.gold : PX.ink, outline: PX.dark }));
      } else {
        b.append(el("span", undefined, label));
      }
      return b;
    };
    const head = el("div", "lto-loot-title");
    head.setAttribute("role", "heading");
    head.setAttribute("aria-level", "2");
    if (pixel) head.append(oc.px(l.opts.title, { scale: 2, weight: "bold", color: PX.gold, outline: PX.dark, maxWidth: wrapWidth(W - 30, 2, ratio) }), oc.srText(l.opts.title));
    else head.textContent = l.opts.title;
    n.setAttribute("aria-label", l.opts.title);
    const list = el("div", "lto-loot-list");
    list.setAttribute("role", "list");
    if (empty) {
      const e = el("div", "lto-loot-empty");
      e.setAttribute("role", "status");
      if (pixel) e.append(oc.px("Nothing left.", { scale: 2, color: PX.muted, outline: PX.dark }), oc.srText("Nothing left."));
      else e.textContent = "Nothing left.";
      list.append(e);
    }
    for (const it of l.items) {
      const row = el("div", "lto-loot-row");
      row.setAttribute("role", "listitem");
      row.dataset.ltoLootItem = it.key;
      row.dataset.text = it.name;
      const name = el("div", "lto-loot-name");
      if (pixel) name.append(oc.px(it.name, { scale: 2, color: PX.ink, outline: PX.dark, maxWidth: wrapWidth(room, 2, ratio) }), oc.srText(it.name));
      else name.textContent = it.name;
      if (it.tip) l.tipOff.push(attachTip(name, it.tip, { boundary: oc.host.closest<HTMLElement>(".lt-game") ?? oc.host, style: () => (oc.isPixel() ? "pixel" : "storybook") }));
      const take = btn("Take", "lto-loot-take");
      take.dataset.lootTake = it.key;
      take.setAttribute("aria-label", `Take ${it.name}`);
      take.addEventListener("click", () => l.opts.onTake(it.key));
      row.append(name, take);
      list.append(row);
    }
    const foot = el("div", "lto-loot-foot");
    if (!empty) {
      const all = btn("Take all", "lto-loot-all", true);
      all.dataset.lootAll = "";
      all.addEventListener("click", () => l.opts.onTake("all"));
      foot.append(all);
    }
    const close = btn("Close", "lto-loot-close");
    close.dataset.lootClose = "";
    close.addEventListener("click", () => closeLoot(l, true));
    foot.append(close);
    n.replaceChildren(head, list, foot);
    layoutLoot();
    // Focus: where it was, else (first draw) the first Take button.
    let target: HTMLElement | null = null;
    if (focusKey !== null) {
      target = focusKey === "@all" ? n.querySelector("[data-loot-all]") : focusKey === "@close" ? n.querySelector("[data-loot-close]") : (Array.from(n.querySelectorAll<HTMLElement>("[data-loot-take]")).find((b) => b.dataset.lootTake === focusKey) ?? null);
      target ??= n.querySelector<HTMLElement>("[data-loot-take]") ?? n.querySelector<HTMLElement>("[data-loot-all]") ?? n.querySelector<HTMLElement>("[data-loot-close]");
    } else if (!l.drawn) {
      target = n.querySelector<HTMLElement>("[data-loot-take]") ?? n.querySelector<HTMLElement>("[data-loot-close]");
    }
    l.drawn = true;
    target?.focus({ preventScroll: true });
  }

  function closeLoot(l: LootState, notify: boolean): void {
    if (oc.loot !== l) return;
    oc.loot = null;
    window.clearTimeout(l.emptyTimer);
    for (const off of l.tipOff) off();
    l.tipOff = [];
    l.node.remove();
    if (notify) l.opts.onClose();
  }

  function setLootItems(l: LootState, items: readonly LootWindowItem[]): void {
    if (oc.loot !== l) return;
    l.items = items.map((i) => ({ ...i }));
    window.clearTimeout(l.emptyTimer);
    if (l.items.length === 0) l.emptyTimer = window.setTimeout(() => closeLoot(l, true), LOOT_EMPTY_MS);
    renderLoot(l);
  }

  function lootWindow(lopts: LootWindowOptions): LootWindow {
    const dead: LootWindow = { update() {}, close() {} };
    if (oc.destroyed) return dead;
    if (oc.loot) closeLoot(oc.loot, false);
    const node = el("div");
    node.dataset.ltoLoot = "";
    node.setAttribute("role", "dialog");
    node.addEventListener("keydown", (e) => {
      // Typing in the window is the window's own: the game behind it never sees it (Tab and Enter still work on the buttons).
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        if (oc.loot === l) closeLoot(l, true);
      }
    });
    for (const type of ["keyup", "keypress", "pointerdown", "mousedown", "click", "dblclick", "contextmenu"]) node.addEventListener(type, (e) => e.stopPropagation());
    const l: LootState = { opts: lopts, items: [], node, tipOff: [], emptyTimer: 0, drawn: false };
    oc.loot = l;
    lootHost.append(node);
    setLootItems(l, lopts.items);
    return {
      update: (items) => setLootItems(l, items),
      close: () => closeLoot(l, false),
    };
  }

  // What the other modules call or read.
  oc.lootHost = lootHost;
  oc.layoutLoot = layoutLoot;
  oc.renderLoot = renderLoot;
  oc.closeLoot = closeLoot;
  oc.lootWindow = lootWindow;
}
