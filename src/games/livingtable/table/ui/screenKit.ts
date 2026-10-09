/**
 * What the full-board adventure screens are built from: text blocks, title ribbons, buttons, and the modal screen shell.
 */
import { cssScale, fitScale, textWidth, wrapWidth, type PixelColor, type PixelWeight } from "./pixelFont";
import { cardNavIndex } from "./tip";
import type { BannerKind } from "./overlayTypes";
import { el, deviceRatio, serifWidth } from "./domKit";
import { numeral } from "./numerals";
import { FACES, PX, BANNER_FRAME } from "./overlayTheme";
import { titleLines } from "./screenHelpers";
import type { OverlayCtx } from "./overlayCtx";

  export interface TextSpec {
    /** The storybook class (it carries the font) and, with it, the hook the tests read. */
    cls: string;
    scale?: number;
    weight?: PixelWeight;
    color?: PixelColor;
    /** Ink with a dark outline (text that sits on the scrim, not on a card). */
    outline?: boolean;
    center?: boolean;
    /** Width the pixel text is NOT to use, in CSS px (a sibling beside it). */
    slack?: number;
  }

  export interface Scr {
    kind: string;
    node: HTMLElement;
    scroll: HTMLElement;
    body: HTMLElement;
    closed: boolean;
    /** Draw it again (a resize, a style switch, a state change), keeping the scroll and the focus. */
    rebuild: () => void;
    /** What Escape does. */
    onEscape?: () => void;
  }

export function installScreenKit(oc: OverlayCtx): void {
  // ---- the adventure screens: start, hero, ending, and the arrival cards

  /** The width a text block has, in CSS px, for pixel wrapping: its own box when it is laid out, else the board less a margin. */
  const roomOf = (node: HTMLElement, slack = 0): number => Math.max(40, (node.clientWidth || (oc.root.clientWidth || oc.width) - 48) - slack);

  /** A block of words in the current treatment: a canvas wrapped to the block's width in pixel (with the words kept for screen readers), plain text in storybook. */
  function stext(parent: HTMLElement, words: string, spec: TextSpec): HTMLElement {
    const d = el("div", `lto-st ${spec.cls}${spec.center ? " is-center" : ""}`);
    d.dataset.text = words;
    parent.append(d);
    if (oc.isPixel()) {
      const scale = spec.scale ?? 2;
      const ratio = deviceRatio();
      const margin = spec.outline ? 3 * cssScale(scale, ratio) : 2;
      d.append(
        oc.srText(words),
        oc.px(words, {
          scale,
          weight: spec.weight ?? "regular",
          color: spec.color ?? PX.ink,
          outline: spec.outline ? PX.dark : null,
          shadow: spec.outline ? PX.shade : null,
          maxWidth: wrapWidth(roomOf(d, (spec.slack ?? 0) + margin), scale, ratio),
          align: spec.center ? "center" : "left",
        }),
      );
    } else {
      d.textContent = words;
    }
    return d;
  }

  /** The width of an SVG numeral for `text` at `size` with the banner's letter spacing, frame included (see numeralGeometry). */
  const numeralWidth = (text: string, size: number, spacing: number): number =>
    Math.ceil(serifWidth(text, size) + Math.max(0, text.length - 1) * spacing * size + Math.max(3, Math.round(size * 0.3)) * 2 + 4);

  /**
   * A big title inside `node`, in the current treatment, on one line when it fits and on two when it does not: pixel text at a scale
   * between 2 and `pxMax`, wrapped; storybook numerals between 16 px and `sbMax`.
   */
  function titleInto(node: HTMLElement, text: string, kind: BannerKind, o: { avail: number; pxMax: number; sbMax: number }): void {
    const label = text.toUpperCase();
    const face = FACES[kind];
    const ratio = deviceRatio();
    if (oc.isPixel()) {
      const scale = fitScale(textWidth(label, "bold") + 6, o.avail, 2, o.pxMax, ratio);
      node.append(
        oc.srText(text),
        oc.px(label, {
          scale,
          weight: "bold",
          color: [face.top, face.mid],
          outline: face.outline,
          outlinePx: 2,
          shadow: PX.shade,
          shadowDx: 2,
          shadowDy: 2,
          maxWidth: wrapWidth(o.avail - 6 * cssScale(scale, ratio), scale, ratio),
          align: "center",
        }),
      );
      return;
    }
    const spacing = 0.08;
    const fitsAt = (lines: string[], size: number) => lines.every((l) => numeralWidth(l, size, spacing) <= o.avail);
    let lines = [label];
    let size = o.sbMax;
    while (size > 20 && !fitsAt(lines, size)) size -= 2;
    if (!fitsAt(lines, size)) {
      lines = titleLines(label, false);
      size = o.sbMax;
      while (size > 16 && !fitsAt(lines, size)) size -= 2;
    }
    node.append(oc.srText(text));
    for (const line of lines) node.append(numeral(oc.uid, kind, line, size, spacing));
  }

  /** A framed title strip (the banner's look, kept in the page rather than flashed): pixel frame or storybook ribbon. */
  function ribbon(parent: HTMLElement, text: string, kind: BannerKind, o: { pxMax: number; sbMax: number }): HTMLElement {
    const node = el("div", "lto-banner lto-ribbon");
    node.dataset.ltoRibbon = "";
    node.dataset.kind = kind;
    node.dataset.text = text;
    parent.append(node);
    if (oc.isPixel()) oc.frame(node, BANNER_FRAME[kind]);
    titleInto(node, text, kind, { avail: Math.max(100, roomOf(node, oc.isPixel() ? 16 : 72)), ...o });
    return node;
  }

  /** A button for the screens: the loot window's look, with a key for keeping the focus across a redraw. */
  function sbtn(parent: HTMLElement, label: string, key: string, pri = false): HTMLButtonElement {
    const b = el("button", `lto-btn${pri ? " is-pri" : ""}`);
    b.type = "button";
    b.dataset.scrKey = key;
    b.dataset.scrNav = "";
    b.setAttribute("aria-label", label);
    if (oc.isPixel()) {
      b.classList.add("lto-fr", "fs1", pri ? "fr-gold" : "fr-win");
      // A long label (Back to the start screen) wraps on a phone instead of running past the button's edge.
      b.append(oc.px(label, { scale: 2, weight: "bold", color: pri ? PX.gold : PX.ink, outline: PX.dark, maxWidth: wrapWidth(Math.max(100, (oc.root.clientWidth || oc.width) - 96), 2, deviceRatio()) }));
    } else {
      b.append(el("span", undefined, label));
    }
    parent.append(b);
    return b;
  }

  /** A section heading on the scrim. */
  function sectionHead(parent: HTMLElement, words: string): void {
    const d = stext(parent, words, { cls: "lto-scr-sec", scale: 2, weight: "bold", color: PX.gold, outline: true });
    d.setAttribute("role", "heading");
    d.setAttribute("aria-level", "2");
  }

  /** A small tag: the author badge. */
  function pill(parent: HTMLElement, words: string, tone: "plain" | "ai"): void {
    const p = el("span", "lto-pill");
    p.dataset.tone = tone;
    p.dataset.text = words;
    if (oc.isPixel()) p.append(oc.srText(words), oc.px(words.toUpperCase(), { scale: 1, weight: "bold", color: tone === "ai" ? ["#e6f1ff", "#8fc4ff"] : PX.gold }));
    else p.textContent = words;
    parent.append(p);
  }
  const screens = new Set<Scr>();
  const closers = new WeakMap<Scr, () => void>();
  const screensLayer = el("div", "lto-scr-layer");

  function focusableIn(node: HTMLElement): HTMLElement[] {
    return Array.from(node.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), [tabindex="0"]')).filter((n) => n.getClientRects().length > 0);
  }

  function closeScreen(s: Scr): void {
    if (s.closed) return;
    closers.get(s)?.();
  }
  function rebuildScreens(): void {
    for (const s of screens) s.rebuild();
  }

  /** A full-board screen: modal (its keys are its own, Tab stays inside, the arrows move between cards). A new screen replaces the ones up. */
  function mountScreen(kind: string, label: string, draw: (s: Scr) => void): Scr {
    for (const old of Array.from(screens)) closeScreen(old);
    const node = el("div", "lto-scr");
    node.dataset.ltoScreen = kind;
    node.setAttribute("role", "dialog");
    node.setAttribute("aria-modal", "true");
    node.setAttribute("aria-label", label);
    const scroll = el("div", "lto-scr-scroll");
    const body = el("div", "lto-scr-body");
    scroll.append(body);
    node.append(scroll);
    const prevFocus = document.activeElement;
    const s: Scr = { kind, node, scroll, body, closed: false, rebuild: () => {} };
    s.rebuild = () => {
      if (s.closed || oc.destroyed) return;
      const at = document.activeElement as HTMLElement | null;
      const key = at && node.contains(at) ? (at.dataset.scrKey ?? null) : null;
      const caret = at instanceof HTMLTextAreaElement && node.contains(at) ? [at.selectionStart, at.selectionEnd] : null;
      const was = scroll.scrollTop;
      body.replaceChildren();
      draw(s);
      scroll.scrollTop = was;
      if (key !== null) {
        const again = Array.from(node.querySelectorAll<HTMLElement>("[data-scr-key]")).find((n) => n.dataset.scrKey === key);
        if (again) {
          again.focus({ preventScroll: true });
          if (caret && again instanceof HTMLTextAreaElement) again.setSelectionRange(caret[0] ?? 0, caret[1] ?? 0);
        }
      }
    };
    // The board and the game must not act on what is done here.
    for (const type of ["keyup", "keypress", "pointerdown", "mousedown", "click", "dblclick", "contextmenu"]) node.addEventListener(type, (e) => e.stopPropagation());
    node.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        s.onEscape?.();
        return;
      }
      if (e.key === "Tab") {
        const list = focusableIn(node);
        if (list.length === 0) {
          e.preventDefault();
          return;
        }
        const i = list.indexOf(document.activeElement as HTMLElement);
        const first = list[0] as HTMLElement;
        const last = list[list.length - 1] as HTMLElement;
        if (i < 0 || (e.shiftKey && i === 0) || (!e.shiftKey && i === list.length - 1)) {
          e.preventDefault();
          (e.shiftKey && i >= 0 ? last : first).focus();
        }
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && t.dataset.scrNav !== undefined && ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) && !e.altKey && !e.ctrlKey && !e.metaKey) {
        const navs = Array.from(node.querySelectorAll<HTMLElement>("[data-scr-nav]:not(:disabled)")).filter((n) => n.getClientRects().length > 0);
        const next = navs[cardNavIndex(navs.length, navs.indexOf(t), e.key)];
        if (next) {
          e.preventDefault();
          next.focus({ preventScroll: true });
          next.scrollIntoView({ block: "nearest" });
        }
      }
    });
    closers.set(s, () => {
      const had = node.contains(document.activeElement);
      s.closed = true;
      screens.delete(s);
      node.remove();
      if ((had || document.activeElement === document.body) && prevFocus instanceof HTMLElement && prevFocus.isConnected) prevFocus.focus({ preventScroll: true });
    });
    screens.add(s);
    screensLayer.append(node);
    s.rebuild();
    return s;
  }

  /** The title block of a screen: the big title, and under it a quiet line. */
  function titleBlock(parent: HTMLElement, title: string, sub: string): void {
    const t = el("div", "lto-scr-title");
    t.dataset.ltoTitle = title;
    parent.append(t);
    const big = el("div", "lto-ribbon");
    t.append(big);
    titleInto(big, title, "victory", { avail: Math.max(100, roomOf(t, 8)), pxMax: oc.tier === "s" ? 3 : 4, sbMax: oc.tier === "s" ? 32 : 42 });
    stext(t, sub, { cls: "lto-scr-sub", scale: 2, color: PX.muted, center: true, outline: true });
  }

  // What the other modules call or read.
  oc.roomOf = roomOf;
  oc.stext = stext;
  oc.ribbon = ribbon;
  oc.sbtn = sbtn;
  oc.sectionHead = sectionHead;
  oc.pill = pill;
  oc.screens = screens;
  oc.screensLayer = screensLayer;
  oc.closeScreen = closeScreen;
  oc.rebuildScreens = rebuildScreens;
  oc.mountScreen = mountScreen;
  oc.titleBlock = titleBlock;
}
