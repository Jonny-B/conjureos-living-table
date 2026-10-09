/**
 * Roll plates: the maths of a roll shown over its point, with the d20 tumble.
 */
import { fitScale, textWidth, wrapWidth, type PixelColor } from "./pixelFont";
import type { OverlayPoint, PlateReadout } from "./overlayTypes";
import { el, FRAMES, deviceRatio, clamp, signed, spriteCanvas, CARET_DOWN } from "./domKit";
import { PX, FLOAT_GAP_PX, PLATE_TAIL_PIXEL_PX, PLATE_TAIL_PX, PLATE_CLEAR_MIN_PX, PLATE_IN_MS, PLATE_HOLD_QUEUED_MS, PLATE_HOLD_MS, PLATE_OUT_MS } from "./overlayTheme";
import { verdictWords } from "./overlayMath";
import type { OverlayCtx } from "./overlayCtx";
import type { FloatInk } from "./feedback";

  /**
   * A plate that is up. `above` plates stand over their point with a pointer `tail` px long hanging off the bottom;
   * `top` is where it is heading (its style), which is not what it measures while it is still sliding there.
   */
  export interface LivePlate {
    pos: HTMLElement;
    above: boolean;
    tail: number;
    top: number;
  }

export function installPlates(oc: OverlayCtx): void {
  // ---- roll plates

  function cellsOf(r: PlateReadout): { n: string; l: string; strong?: boolean }[] {
    return [
      { n: String(r.roll), l: "your roll" },
      { n: signed(r.modifier), l: "your bonus" },
      { n: String(r.total), l: "total", strong: true },
      { n: String(r.target), l: "you needed" },
    ];
  }

  function sourcesOf(r: PlateReadout): string[] {
    return (r.sources ?? []).map((s) => `${signed(s.amount)} ${s.label}`);
  }

  function verdictClass(r: PlateReadout): "crit" | "hit" | "miss" {
    return r.critical ? "crit" : r.hit ? "hit" : "miss";
  }

  /**
   * Builds a plate; returns it plus a hook that sets the d20 face (for the tumble). The last two are the pixel
   * style's fitting steps for a narrow host: `numScale`, the scale of the four big numbers, and `squeeze`, 1 to
   * close up the gaps in the maths row and 2 to let it wrap onto a second row.
   */
  function plateNode(r: PlateReadout, avail: number, numScale: number, squeeze: number): { node: HTMLElement; setRoll: (n: number) => void } {
    const node = el("div", "lto-plate lto-roll");
    node.dataset.ltoPlate = "";
    node.dataset.hit = String(r.hit);
    node.dataset.roll = String(r.roll);
    node.dataset.text = `${r.roll} ${signed(r.modifier)} = ${r.total} vs ${r.target}: ${verdictWords(r)}`;
    node.setAttribute("aria-hidden", "true");
    const cells = cellsOf(r);
    const srcs = sourcesOf(r);
    const verdict = verdictWords(r);
    const vClass = verdictClass(r);
    let renderRoll: (n: number) => void = () => {};

    if (oc.isPixel()) {
      const ratio = deviceRatio();
      oc.frame(node, r.critical ? "gold" : "win");
      if (r.caption) node.append(oc.px(r.caption, { scale: 1, color: PX.muted, maxWidth: wrapWidth(avail - 40, 1, ratio) }));
      const math = el("div", "lto-math");
      if (squeeze > 0) math.classList.add("is-tight");
      if (squeeze > 1) math.classList.add("is-wrap");
      // Numerals big, the game's own words under them at 1x, so the numbers carry the plate.
      cells.forEach((c, i) => {
        if (i === 2 || i === 3) {
          const op = el("div", "lto-op");
          op.append(oc.px(i === 2 ? "=" : "vs", { scale: 2, color: PX.muted, shadow: PX.shade }));
          math.append(op);
        }
        const cell = el("div", "lto-cell");
        const numColor: PixelColor = c.strong ? PX.gold : PX.ink;
        const numHolder = el("div");
        const draw = (text: string) => numHolder.replaceChildren(oc.px(text, { scale: numScale, weight: "bold", color: numColor, outline: PX.dark, shadow: PX.shade }));
        draw(c.n);
        if (i === 0) renderRoll = (n) => draw(String(n));
        cell.append(numHolder, oc.px(c.l, { scale: 1, color: PX.muted, shadow: PX.shade }));
        math.append(cell);
      });
      node.append(math);
      if (srcs.length) {
        const wrap = el("div", "lto-srcs");
        for (const s of srcs) wrap.append(oc.px(s, { scale: 1, color: PX.muted, maxWidth: Math.max(30, wrapWidth(avail - 40, 1, ratio)) }));
        node.append(wrap);
      }
      const vColor: PixelColor = vClass === "hit" ? PX.good : vClass === "crit" ? PX.gold : PX.bad;
      const vFont = textWidth(verdict, "bold") + 4;
      const vMax = verdict.length > 6 ? 2 : 3;
      node.append(oc.px(verdict, { scale: fitScale(vFont, avail - 40, 1, vMax, ratio), weight: "bold", color: vColor, outline: PX.dark, shadow: PX.shade }));
    } else {
      if (r.critical) node.classList.add("is-crit");
      if (r.caption) node.append(el("div", "lto-cap", r.caption));
      const math = el("div", "lto-math");
      cells.forEach((c, i) => {
        if (i === 2 || i === 3) math.append(el("div", "lto-op", i === 2 ? "=" : "vs"));
        const cell = el("div", c.strong ? "lto-cell strong" : "lto-cell");
        const b = el("b", undefined, c.n);
        if (i === 0) {
          renderRoll = (n) => {
            b.textContent = String(n);
          };
        }
        cell.append(b, el("i", undefined, c.l));
        math.append(cell);
      });
      node.append(math);
      if (srcs.length) {
        const wrap = el("div", "lto-srcs");
        for (const s of srcs) wrap.append(el("span", undefined, s));
        node.append(wrap);
      }
      node.append(el("div", `lto-verdict lto-t2 ${vClass}`, verdict));
    }
    return { node, setRoll: renderRoll };
  }

  let plateChain: Promise<void> = Promise.resolve();
  oc.platesWaiting = 0;
  const livePlates = new Set<LivePlate>();

  /** The lowest a plate may stand: under the turn-order strip when it is showing. */
  const safeTop = (): number => (oc.initEl.hidden && oc.cardsHost.hidden ? 8 : oc.top.offsetHeight + 12);

  /**
   * Lift a plate that stands over its point clear of a float's ink: a taller float
   * than the plate made room for, or a stack climbing past it. A plate never prints
   * under a number, so the verdict is never hidden; where there is no room left
   * above it stays under the strip and the number wins, because floats are the
   * upper layer.
   */
  function stepPlateUp(plate: LivePlate, f: FloatInk): void {
    if (!plate.above) return;
    const { offsetLeft: left, offsetWidth: w, offsetHeight: h } = plate.pos;
    const bottom = plate.top + h + plate.tail;
    if (f.right <= left || f.left >= left + w) return;
    if (f.bottom <= plate.top || f.top >= bottom + FLOAT_GAP_PX) return;
    const next = Math.max(safeTop(), f.top - FLOAT_GAP_PX - plate.tail - h);
    if (next < plate.top) {
      plate.top = next;
      plate.pos.style.top = `${next}px`;
    }
  }

  async function showPlate(at: OverlayPoint, readout: PlateReadout, mine: number): Promise<void> {
    // A plate queued before a clear() was already forgotten by it, so only this epoch's plates are counted down.
    if (mine === oc.epoch) oc.platesWaiting--;
    const alive = () => !oc.destroyed && mine === oc.epoch;
    if (!alive()) return;
    const rootW = oc.root.clientWidth || oc.width;
    const pos = el("div", "lto-plate-pos");
    oc.platesLayer.appendChild(pos);
    const bigScale = oc.tier === "s" ? 3 : 4;
    // Pixel plates are canvases, which cannot wrap, so on a narrow host (or at a ratio that rounds the text up) close up
    // the maths row, then let it wrap, then step the big numbers down, until the plate holds all of its content.
    const fits: [number, number][] = [[bigScale, 1], [bigScale, 2]];
    for (let scale = bigScale - 1; scale >= 1; scale--) fits.push([scale, 2]);
    let built = plateNode(readout, rootW - 24, bigScale, 0);
    pos.append(built.node);
    for (const [numScale, squeeze] of fits) {
      if (!oc.isPixel() || pos.scrollWidth <= pos.clientWidth + 1) break;
      built = plateNode(readout, rootW - 24, numScale, squeeze);
      pos.replaceChildren(built.node);
    }
    const { setRoll } = built;
    oc.setBusy(1, mine);

    // Above the point if there is room under the strip, else below it; never under the dialogue box if it can be helped.
    // Above, it starts clear of an ordinary damage number rising off the same point (stepPlateUp lifts it further for a taller one).
    const w = pos.offsetWidth;
    const h = pos.offsetHeight;
    const rootH = oc.root.clientHeight;
    const tailPx = oc.isPixel() ? PLATE_TAIL_PIXEL_PX : PLATE_TAIL_PX;
    const strip = safeTop();
    const safeBottom = oc.dlg.hidden ? rootH - 8 : rootH - oc.bottom.offsetHeight - 16;
    const left = clamp(at.x - w / 2, 8, Math.max(8, rootW - w - 8));
    let above = true;
    let y = at.y - oc.damageReach() - FLOAT_GAP_PX - tailPx - h;
    if (y < strip) y = at.y - PLATE_CLEAR_MIN_PX - h; // a small host: stand closer rather than flip
    if (y < strip) {
      above = false;
      y = at.y + 40;
    }
    y = clamp(y, strip, Math.max(strip, safeBottom - h));
    pos.style.left = `${left}px`;
    pos.style.top = `${y}px`;
    const plate: LivePlate = { pos, above, tail: tailPx, top: y };
    livePlates.add(plate);
    for (const f of oc.liveFloats) stepPlateUp(plate, f);

    const tailX = clamp(at.x - left, 18, Math.max(18, w - 18));
    if (oc.isPixel()) {
      const tail = spriteCanvas(CARET_DOWN, { o: PX.dark, C: FRAMES.win.L }, 2);
      tail.classList.add("lto-tail");
      tail.style.left = `${tailX}px`;
      if (above) tail.style.bottom = "-13px";
      else {
        tail.style.top = "-13px";
        tail.style.transform = "translateX(-50%) scaleY(-1)";
      }
      pos.append(tail);
    } else {
      const tail = el("div", `lto-tail ${above ? "down" : "up"}`);
      tail.style.left = `${tailX}px`;
      pos.append(tail);
    }

    const still = oc.reduced();
    if (still) {
      await oc.play(pos, [{ opacity: 0 }, { opacity: 1 }], 120);
    } else {
      await oc.play(
        pos,
        [{ opacity: 0, transform: "translateY(6px) scale(0.92)" }, { opacity: 1, transform: "translateY(0) scale(1.03)", offset: 0.7 }, { opacity: 1, transform: "translateY(0) scale(1)" }],
        PLATE_IN_MS,
        "ease-out",
      );
      // The d20 tumbles through a few faces and settles. Deterministic, not random.
      for (let i = 0; i < 3 && alive(); i++) {
        setRoll(((readout.roll * 7 + i * 5 + 3) % 20) + 1);
        await oc.wait(60);
      }
      setRoll(readout.roll);
    }
    if (alive()) await oc.wait(oc.platesWaiting > 0 ? PLATE_HOLD_QUEUED_MS : PLATE_HOLD_MS);
    if (alive()) await oc.play(pos, [{ opacity: 1 }, { opacity: 0 }], still ? 120 : PLATE_OUT_MS);
    pos.remove();
    livePlates.delete(plate);
    oc.setBusy(-1, mine);
  }

  function rollPlate(at: OverlayPoint, readout: PlateReadout): void {
    if (oc.destroyed) return;
    const mine = oc.epoch;
    oc.platesWaiting++;
    plateChain = plateChain.then(() => showPlate(at, readout, mine)).catch(() => {});
  }

  // What the other modules call or read.
  oc.livePlates = livePlates;
  oc.safeTop = safeTop;
  oc.stepPlateUp = stepPlateUp;
  oc.rollPlate = rollPlate;
}
