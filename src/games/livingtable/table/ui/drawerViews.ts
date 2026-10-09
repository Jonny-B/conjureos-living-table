/**
 * The drawer's Pack view (the asset bench's). Settings, Journal, Log and Saves are shared with the in-game menu and live in menuViews.ts.
 */
import { attachItemCard, attachTip } from "./tip";
import type { PackSection } from "./hudTypes";
import { el } from "./domKit";
import { packItemText } from "./hudHelpers";
import type { HudCtx } from "./hudCtx";

export function installDrawerViews(hc: HudCtx): void {
  /** The pack list: a heading per section, its items under it, scrolling inside when long. Items in `freshNow` get a brief highlight. */
  function packView(sections: readonly PackSection[], prevScroll: number): HTMLElement {
    const fresh = hc.freshNow;
    hc.freshNow = new Set();
    const wrap = el("div", "lto-hud-pack");
    wrap.dataset.hudPackView = "";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Pack");
    const list = el("div", "lto-hud-pack-list lto-hud-list");
    list.dataset.tab = "pack";
    let firstFresh: HTMLElement | null = null;
    for (const sec of sections) {
      const box = el("div", "lto-hud-sec");
      box.dataset.section = sec.label;
      const head = el("div", "lto-hud-row");
      head.append(hc.text(sec.label, "seclabel", 18));
      box.append(head);
      if (sec.items.length === 0) {
        const none = el("div", "lto-hud-row");
        none.append(hc.text("Nothing", "line", 18));
        box.append(none);
      }
      for (const it of sec.items) {
        const item = packItemText(it);
        const row = el("div", "lto-hud-row");
        row.dataset.item = item;
        if (fresh.has(item)) {
          row.classList.add("is-new");
          row.dataset.new = "true";
          firstFresh ??= row;
        }
        row.append(hc.text(item, "item", 18));
        // An item card (hover facts, a click pins the buttons), or plain hover help: on the row, in the HUD's own style, kept inside the game window.
        if (typeof it !== "string" && it.card) {
          const key = it.key ?? item;
          row.dataset.itemKey = key;
          hc.tipOff.push(attachItemCard(row, it.card, (actionId) => hc.opts.onItemAction?.(key, actionId), { boundary: hc.tipBoundary(), style: () => (hc.isPixel() ? "pixel" : "storybook") }));
        } else if (typeof it !== "string" && it.tip) {
          hc.tipOff.push(attachTip(row, it.tip, { boundary: hc.tipBoundary(), style: () => (hc.isPixel() ? "pixel" : "storybook") }));
        }
        box.append(row);
      }
      list.append(box);
    }
    wrap.append(list);
    if (firstFresh) {
      // Show what just arrived, by scrolling the list itself and never the page. It is measured once the panel is in the page.
      const row: HTMLElement = firstFresh;
      queueMicrotask(() => {
        const bottom = row.offsetTop + row.offsetHeight;
        if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
      });
    }
    queueMicrotask(() => {
      if (!firstFresh) list.scrollTop = prevScroll;
    });
    return wrap;
  }

  // What the other modules call or read.
  hc.packView = packView;
}
