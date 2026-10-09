/**
 * The turn-order strip, and the band the board keeps clear above it while a fight is on.
 */
import type { InitiativeEntry } from "./overlayTypes";
import { el, FRAMES, spriteCanvas, CARET_DOWN } from "./domKit";
import { PX, TOP_PAD_PX, TOP_GAP_PX } from "./overlayTheme";
import type { OverlayCtx } from "./overlayCtx";

/**
 * A chip's label cut to `max` characters: a trailing number is kept ("Giant Rat 2" at 6 is "Gi. 2", never "Giant."), since the number is
 * what tells two of a kind apart. Whole when it fits.
 */
export function chipLabel(label: string, max: number): string {
  if (label.length <= max) return label;
  const num = /\s+\d+$/.exec(label);
  if (num && num.index >= 2) {
    const tail = num[0];
    const head = label.slice(0, num.index).trimEnd();
    const room = max - tail.length - 1;
    if (room >= 2) return `${head.slice(0, room).trimEnd()}.${tail}`;
  }
  return `${label.slice(0, max - 1).trimEnd()}.`;
}

/** The longest chip label at a size tier: a phone's board is about 270 px wide, so its chips are short (a fight of a hero and three foes is one or two rows). */
export function chipMax(tier: "s" | "m" | "l", pixel: boolean): number {
  if (tier === "s") return pixel ? 6 : 8;
  return pixel ? 10 : 14;
}

export function installInitiative(oc: OverlayCtx): void {
  // ---- initiative strip

  const clip = chipLabel;

  /**
   * Publish --lto-top-band (px) on the host: the room the turn strip and the slot for a banner take at the top, so the board keeps clear
   * of them and text never covers the hero. It is 0 when no fight is on (and no banner is up), and the same size all through a fight.
   */
  function updateBands(): void {
    if (oc.destroyed) return;
    const active = (oc.initState.entries.length > 0 || oc.bannersUp > 0) && oc.root.clientHeight > 0;
    oc.bannersLayer.style.minHeight = active ? `${oc.bannerSlotPx()}px` : "";
    const px = active ? Math.ceil(oc.top.offsetHeight) + TOP_PAD_PX + TOP_GAP_PX : 0;
    oc.host.style.setProperty("--lto-top-band", `${px}px`);
  }

  function renderInitiative(): void {
    const { entries, activeId, round } = oc.initState;
    oc.initEl.replaceChildren();
    oc.initEl.hidden = entries.length === 0;
    if (entries.length === 0) {
      updateBands();
      oc.layoutLoot();
      return;
    }
    const tab = el("div", "lto-round");
    tab.dataset.ltoRound = String(round);
    if (oc.isPixel()) {
      oc.frame(tab, "win", true);
      tab.append(oc.px(`ROUND ${round}`, { scale: 2, color: PX.gold, shadow: PX.shade }));
    } else {
      tab.classList.add("lto-t2");
      tab.textContent = `Round ${round}`;
    }
    oc.initEl.append(tab);
    for (const e of entries) {
      const active = e.id === activeId;
      const chip = el("div", `lto-chip${active ? " is-active" : ""}`);
      chip.dataset.ltoChip = "";
      chip.dataset.id = e.id;
      chip.dataset.active = String(active);
      chip.dataset.total = String(e.total);
      chip.dataset.text = `${e.label} ${e.total}`;
      if (e.side) chip.dataset.side = e.side;
      chip.append(oc.srText(`${e.label}${e.side ? `, ${e.side}` : ""}, initiative ${e.total}${active ? ", taking a turn" : ""}`));
      if (oc.isPixel()) {
        // A side colours the frame (blue hero, red enemy) and the active chip is marked by its ring and caret instead of a gold frame.
        oc.frame(chip, e.side === "hero" ? "blue" : e.side === "enemy" ? "red" : active ? "gold" : "win", true);
        chip.append(
          oc.px(clip(e.label, chipMax(oc.tier, true)), { scale: 2, color: active ? PX.gold : PX.ink, shadow: PX.shade }),
          oc.px(String(e.total), { scale: 2, weight: "bold", color: active ? PX.gold : PX.muted, shadow: PX.shade }),
        );
        if (active) {
          const caret = spriteCanvas(CARET_DOWN, { o: PX.dark, C: FRAMES.gold.L }, 2);
          caret.classList.add("lto-caret");
          chip.append(caret);
        }
      } else {
        chip.classList.add("lto-plate");
        chip.append(el("span", undefined, clip(e.label, chipMax(oc.tier, false))), el("span", "lto-badge", String(e.total)));
        for (const child of Array.from(chip.children)) if (!child.classList.contains("lto-sr")) child.setAttribute("aria-hidden", "true");
      }
      oc.initEl.append(chip);
    }
    // The strip wraps (never scrolls sideways), so the Round tab and every chip, the hero's own included, are always in view.
    updateBands();
    oc.layoutLoot();
  }

  function initiative(entries: readonly InitiativeEntry[], activeId: string | null, round: number): void {
    if (oc.destroyed) return;
    oc.initState = { entries: entries.map((e) => ({ ...e })), activeId, round };
    renderInitiative();
  }

  // What the other modules call or read.
  oc.renderInitiative = renderInitiative;
  oc.updateBands = updateBands;
  oc.initiative = initiative;
}
