/**
 * Short-lived feedback on the board: floating numbers and banners.
 */
import { fitScale, textWidth } from "./pixelFont";
import type { FloatKind, OverlayPoint, BannerKind } from "./overlayTypes";
import { el, deviceRatio, serifWidth, clamp } from "./domKit";
import { numeral, numeralGeometry } from "./numerals";
import {
  FACES,
  PX,
  FLOAT_BASE_PX,
  FLOAT_RISE_PX,
  FLOAT_STACK_MS,
  FLOAT_MS,
  FLOAT_FADE_MS,
  BANNER_FRAME,
  BANNER_REDUCED_MS,
  BANNER_MS,
} from "./overlayTheme";
import { floatStackIndex, floatStackTop, floatLift } from "./overlayMath";
import type { OverlayCtx } from "./overlayCtx";

  /** The ink of a float that is up, in host px, with its rise included: what a plate has to stay out of. */
  export interface FloatInk {
    left: number;
    right: number;
    top: number;
    bottom: number;
  }

export function installFeedback(oc: OverlayCtx): void {
  // ---- floats

  /**
   * A float's node, its box height and the empty margins inside the box above and
   * below its inked glyphs, which is what stacking and the plates clear: the box of
   * a storybook numeral carries the outline's room and a descender's, a pixel
   * canvas is all ink.
   */
  function floatNode(text: string, kind: FloatKind): { node: HTMLElement; h: number; padTop: number; padBottom: number } {
    const node = el("div", "lto-float");
    node.dataset.ltoFloat = "";
    node.dataset.kind = kind;
    node.dataset.text = text;
    node.setAttribute("aria-hidden", "true");
    const inner = el("div", "lto-float-in");
    const face = FACES[kind];
    let h: number;
    let padTop = 0;
    let padBottom = 0;
    if (oc.isPixel()) {
      const small = oc.tier === "s";
      const scale = kind === "crit" ? (small ? 4 : 5) : kind === "miss" || kind === "info" ? (small ? 2 : 3) : small ? 3 : 4;
      const canvas = oc.px(text, { scale, weight: "bold", color: [face.mid, face.deep], outline: face.outline, outlinePx: 1, shadow: PX.shade });
      inner.append(canvas);
      h = parseFloat(canvas.style.height);
    } else {
      const size = { damage: 36, crit: 52, heal: 36, miss: 26, down: 40, info: 26 }[kind] * (oc.tier === "s" ? 0.86 : 1);
      inner.append(numeral(oc.uid, kind, text, size));
      ({ h, padTop, padBottom } = numeralGeometry(size, serifWidth(text, size)));
    }
    node.append(inner);
    return { node, h, padTop, padBottom };
  }
  const liveFloats = new Set<FloatInk>();

  /** How high above its anchor an ordinary damage number reaches at its highest, rise included: where a plate on the same point starts out of its way. */
  function damageReach(): number {
    const { h, padTop } = floatNode("-00", "damage");
    return FLOAT_BASE_PX + h - padTop + FLOAT_RISE_PX;
  }

  function float(at: OverlayPoint, text: string, kind: FloatKind): void {
    if (oc.destroyed) return;
    const now = performance.now();
    oc.recent = oc.recent.filter((r) => now - r.t < FLOAT_STACK_MS);
    const rung = floatStackIndex(oc.recent, at, now);
    const stackTop = floatStackTop(oc.recent, at, now);

    const { node, padTop, padBottom } = floatNode(text, kind);
    node.dataset.rung = String(rung);
    oc.floatsLayer.appendChild(node);
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const rootW = oc.root.clientWidth || oc.width;
    const x = clamp(at.x, w / 2 + 2, Math.max(w / 2 + 2, rootW - w / 2 - 2));
    // The node is lifted by its own height, so `top` is its bottom edge. A float landing on others stands its
    // glyphs clear of the highest of theirs; one on its own stands on the anchor.
    const bottom = Math.max(h + FLOAT_RISE_PX + 2, at.y - FLOAT_BASE_PX - floatLift(stackTop, padBottom));
    node.style.left = `${x}px`;
    node.style.top = `${bottom}px`;
    oc.recent.push({ x: at.x, y: at.y, t: now, n: rung, top: at.y - bottom + h - padTop });
    const ink: FloatInk = { left: x - w / 2, right: x + w / 2, top: bottom - h + padTop - FLOAT_RISE_PX, bottom: bottom - padBottom };
    liveFloats.add(ink);
    for (const plate of oc.livePlates) oc.stepPlateUp(plate, ink);

    const base = "translate(-50%, -100%)";
    const still = oc.reduced();
    const fadeAt = (FLOAT_MS - FLOAT_FADE_MS) / FLOAT_MS;
    const frames: Keyframe[] = still
      ? [{ opacity: 1 }, { opacity: 1, offset: fadeAt }, { opacity: 0 }]
      : [
          { transform: `${base} translateY(0)`, opacity: 1, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" },
          { transform: `${base} translateY(${-FLOAT_RISE_PX * 0.85}px)`, opacity: 1, offset: fadeAt },
          { transform: `${base} translateY(${-FLOAT_RISE_PX}px)`, opacity: 0 },
        ];
    const mine = oc.epoch;
    oc.setBusy(1, mine);
    const inner = node.firstElementChild as HTMLElement | null;
    if (inner && !still) {
      const pop = kind === "crit" || kind === "down";
      void oc.play(
        inner,
        pop
          ? [{ transform: "scale(0.45)", opacity: 0 }, { transform: "scale(1.28)", opacity: 1, offset: 0.5 }, { transform: "scale(1)", opacity: 1 }]
          : [{ transform: "scale(0.75)", opacity: 0.2 }, { transform: "scale(1)", opacity: 1 }],
        pop ? 260 : 130,
        "ease-out",
      );
    }
    void oc.play(node, frames, FLOAT_MS).then(() => {
      node.remove();
      liveFloats.delete(ink);
      oc.setBusy(-1, mine);
    });
  }

  // ---- banners

  function bannerNode(text: string, kind: BannerKind): HTMLElement {
    const node = el("div", "lto-banner");
    node.dataset.ltoBanner = "";
    node.dataset.kind = kind;
    node.dataset.text = text;
    node.setAttribute("aria-hidden", "true");
    const face = FACES[kind];
    const avail = Math.max(120, (oc.root.clientWidth || oc.width) - (oc.isPixel() ? 56 : 40));
    if (oc.isPixel()) {
      // A slim title in the top band (the board keeps clear of it): the small frame and the second size of type.
      oc.frame(node, BANNER_FRAME[kind], true);
      const label = text.toUpperCase();
      // A title strip, not a poster: the owner found full-width banners blocked the board. Twice the font, in a band of its own at the top.
      const scale = fitScale(textWidth(label, "bold") + 6, Math.min(avail - 24, 420), 2, 2, deviceRatio());
      node.append(
        oc.px(label, { scale, weight: "bold", color: [face.top, face.mid], outline: face.outline, outlinePx: 2, shadow: PX.shade, shadowDx: 2, shadowDy: 2 }),
      );
    } else {
      const label = text.toUpperCase();
      let size = clamp(Math.floor((oc.root.clientWidth || oc.width) * 0.03), 16, 24);
      const spacing = 0.08;
      const fits = (s: number) => serifWidth(label, s) + (label.length - 1) * spacing * s + s * 0.6 <= avail;
      while (size > 16 && !fits(size)) size -= 2;
      node.append(numeral(oc.uid, kind, label, size, spacing));
    }
    return node;
  }

  let bannerChain: Promise<void> = Promise.resolve();
  function banner(text: string, kind: BannerKind): Promise<void> {
    if (oc.destroyed) return Promise.resolve();
    const mine = oc.epoch;
    const run = bannerChain.then(async () => {
      if (oc.destroyed || mine !== oc.epoch) return;
      oc.announce(text);
      const node = bannerNode(text, kind);
      oc.bannersUp += 1;
      oc.updateBands();
      oc.bannersLayer.appendChild(node);
      oc.setBusy(1, mine);
      const still = oc.reduced();
      if (still) {
        await oc.play(node, [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.72 }, { opacity: 0 }], BANNER_REDUCED_MS);
      } else {
        await oc.play(
          node,
          [
            { opacity: 0, transform: "scale(0.9)", easing: "ease-out" },
            { opacity: 1, transform: "scale(1.03)", offset: 0.17 },
            { opacity: 1, transform: "scale(1)", offset: 0.27 },
            { opacity: 1, transform: "scale(1)", offset: 0.8 },
            { opacity: 0, transform: "scale(1.05)" },
          ],
          BANNER_MS,
        );
      }
      node.remove();
      oc.bannersUp = Math.max(0, oc.bannersUp - 1);
      oc.updateBands();
      oc.setBusy(-1, mine);
    });
    bannerChain = run.catch(() => {});
    return run;
  }

  /**
   * The height one banner takes in the current style and size, measured on a copy: the slot the top band keeps open for banners while a
   * fight is on, so the board does not move as each banner comes and goes.
   */
  let slotKey = "";
  let slotPx = 0;
  function bannerSlotPx(): number {
    const key = `${oc.style}|${oc.tier}|${deviceRatio()}|${oc.root.clientWidth}`;
    if (key === slotKey && slotPx > 0) return slotPx;
    const node = bannerNode("INITIATIVE", "initiative");
    node.style.visibility = "hidden";
    oc.bannersLayer.appendChild(node);
    // The pop of a banner scales it up a little at its peak.
    const h = Math.ceil(node.offsetHeight * 1.06);
    node.remove();
    if (h <= 0) return slotPx;
    slotKey = key;
    slotPx = h;
    return slotPx;
  }

  // What the other modules call or read.
  oc.liveFloats = liveFloats;
  oc.damageReach = damageReach;
  oc.float = float;
  oc.banner = banner;
  oc.bannerSlotPx = bannerSlotPx;
}
