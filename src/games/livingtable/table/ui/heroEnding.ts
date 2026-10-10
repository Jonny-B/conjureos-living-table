/**
 * The hero screen (make your own or start right away) and the ending card.
 */
import { wrapWidth } from "./pixelFont";
import type { StartHeroOptions, StartHero, EndingCardOptions, EndingCard } from "./overlayTypes";
import { el, svgEl, deviceRatio } from "./domKit";
import { PX } from "./overlayTheme";
import { excerpt, tidy, HOOK_MAX, endingKicker, endingBannerKind, endingChoices } from "./screenHelpers";
import type { OverlayCtx } from "./overlayCtx";
import type { HeroPreview } from "./heroPreview";

const HERO_STYLE_ID = "lto-hero-style";
const ABILITY_LABELS: ReadonlySet<string> = new Set(["STR", "DEX", "CON", "INT", "WIS", "CHA"]);

const HERO_CSS = `
.lto-hero{display:flex;flex-direction:column;gap:6px;min-width:0}
.lto-hero-strip{position:relative;display:flex;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;scrollbar-width:none;overscroll-behavior-x:contain;min-width:0;-webkit-overflow-scrolling:touch}
.lto-hero-strip::-webkit-scrollbar{display:none}
.lto-hero-slide{flex:0 0 100%;min-width:0;scroll-snap-align:center;scroll-snap-stop:always;padding:2px 4px 6px;display:flex}
.lto-hero-card{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px 10px 14px;text-align:center;position:relative;cursor:default}
.lto-px .lto-hero-card.lto-fr{padding:8px 8px 10px}
.lto-hero-card>*{min-width:0;max-width:100%}
.lto-hero-card .lto-st{width:100%}
.lto-hero-card .lto-st.is-center{justify-content:center}
.lto-hero-doll{--dh:clamp(72px,16vh,128px);display:flex;align-items:center;justify-content:center;width:var(--dh);height:var(--dh);flex:none}
.lto-hero-doll canvas{display:block;width:var(--dh);height:var(--dh);image-rendering:pixelated;image-rendering:crisp-edges}
.lto-root:not([data-size="s"]) .lto-hero-doll{--dh:clamp(88px,26vh,256px)}
.lto-root[data-size="s"] .lto-hero-card{gap:6px}
.lto-hero-doll.is-plus svg{width:72px;height:72px;fill:currentColor;opacity:.85}
.lto-px .lto-hero-doll.is-plus{color:#ffc72a}
.lto-sb .lto-hero-doll.is-plus{color:var(--sb-gold)}
.lto-hero-stats{display:flex;flex-direction:column;gap:6px;width:100%;margin:0;padding:0;text-align:center}
.lto-hero-stats[hidden]{display:none}
.lto-hero-group{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px;margin:0;padding:0}
.lto-hero-group.is-vitals{grid-template-columns:repeat(4,minmax(0,1fr))}
.lto-root[data-size="s"] .lto-hero-group{grid-template-columns:repeat(3,minmax(0,1fr))}
.lto-root[data-size="s"] .lto-hero-group.is-vitals{grid-template-columns:repeat(2,minmax(0,1fr))}
.lto-hero-stat{display:flex;flex-direction:column;align-items:center;gap:2px;padding:4px 2px;min-width:0}
.lto-sb .lto-hero-stat{border:1px solid var(--sb-rule);border-radius:7px;background:rgb(var(--sb-shade)/.06)}
.lto-px .lto-hero-stat{border:2px solid #2c3874;background:#0a0e2a}
.lto-sb .lto-hero-lbl{font:700 11px/1.2 var(--lto-serif);letter-spacing:.1em;text-transform:uppercase;color:var(--sb-muted)}
.lto-sb .lto-hero-val{font:700 16px/1.2 var(--lto-serif);color:var(--sb-ink)}
.lto-sb .lto-hero-desc{font:italic 15px/1.4 var(--lto-serif);color:var(--sb-ink)}
.lto-hero-play{width:100%;display:flex;flex-wrap:wrap;justify-content:center;gap:8px}
.lto-hero-play .lto-btn{flex:1 1 150px;min-width:0;max-width:260px;min-height:44px}
/* the strip snaps slide by slide: scrolling a control into view (nearest) must aim past the slide's middle, or the snap sends the strip back */
.lto-hero-toggle{min-height:44px;scroll-margin-inline:45vw}
.lto-hero-nav{position:sticky;bottom:calc(-1*var(--scr-pb,18px));z-index:2;display:flex;align-items:center;justify-content:center;gap:0;min-width:0;border-top:1px solid #2c3874}
.lto-px .lto-hero-nav{background:#0a0e2a}
.lto-sb .lto-hero-nav{background:var(--sb-paper2);border-top-color:var(--sb-rule)}
.lto-sb .lto-hero-dot{color:var(--sb-ink)}
.lto-hero-arrow{width:44px;height:44px;min-width:44px;min-height:44px;padding:0}
.lto-px .lto-hero-arrow.lto-fr{padding:0}
.lto-hero-arrow svg{width:20px;height:20px;fill:currentColor;display:block}
.lto-hero-dots{display:flex;align-items:center;justify-content:center;min-width:0}
.lto-hero-dot{appearance:none;background:none;border:0;padding:0;margin:0;flex:none;width:44px;height:44px;display:flex;align-items:center;justify-content:center;cursor:pointer;touch-action:manipulation;color:#f4ecd0}
.lto-hero-dot:focus-visible{outline:2px solid var(--sb-focus);outline-offset:-2px}
.lto-hero-dot i{display:block;width:10px;height:10px;background:currentColor;opacity:.4}
.lto-sb .lto-hero-dot i{border-radius:50%}
.lto-hero-dot[aria-current="true"] i{opacity:1;background:#ffc72a}
.lto-sb .lto-hero-dot[aria-current="true"] i{background:#ffd86b}
@media (prefers-reduced-motion: reduce){.lto-hero-strip{scroll-behavior:auto}}
`;

function injectHeroStyle(): void {
  if (typeof document === "undefined" || document.getElementById(HERO_STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = HERO_STYLE_ID;
  s.textContent = HERO_CSS;
  document.head.appendChild(s);
}

// Font Awesome solid chevrons and plus, as inline paths.
const CHEVRON_LEFT = "M41.4 233.4c-12.5 12.5-12.5 32.8 0 45.3l160 160c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L109.3 256 246.6 118.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-160 160z";
const CHEVRON_RIGHT = "M278.6 233.4c12.5 12.5 12.5 32.8 0 45.3l-160 160c-12.5 12.5-32.8 12.5-45.3 0s-12.5-32.8 0-45.3L210.7 256 73.4 118.6c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l160 160z";
const PLUS = "M256 80c0-17.7-14.3-32-32-32s-32 14.3-32 32V224H48c-17.7 0-32 14.3-32 32s14.3 32 32 32H192V432c0 17.7 14.3 32 32 32s32-14.3 32-32V288H400c17.7 0 32-14.3 32-32s-14.3-32-32-32H256V80z";

function icon(path: string, box: string): SVGSVGElement {
  const svg = svgEl("svg", { viewBox: box, "aria-hidden": "true", focusable: "false" });
  svg.append(svgEl("path", { d: path }));
  return svg;
}

export function installHeroEnding(oc: OverlayCtx): void {
  // ---- the hero screen

  /** The hero choice: a strip with one slide per class (picture, words, default stats, Play) and a last slide for the character maker. */
  function startHero(hopts: StartHeroOptions): StartHero {
    const dead: StartHero = { close() {} };
    if (oc.destroyed) return dead;
    injectHeroStyle();
    const hooks = hopts.hooks.filter((h) => h.chassis && tidy(h.label));
    /** One slide per class, then "Make your own hero". */
    const slideCount = hooks.length + 1;
    /** The slide the screen is on, kept across redraws (a resize or a style switch draws the screen again). */
    let active = 0;
    /** Which classes have their default stats open. */
    const statsOpen = new Set<string>();
    const previews = new Map<string, HeroPreview | null>();
    const previewOf = (chassis: string): HeroPreview | null => {
      if (!previews.has(chassis)) {
        let p: HeroPreview | null = null;
        try {
          p = hopts.preview?.(chassis) ?? null;
        } catch {
          p = null;
        }
        previews.set(chassis, p);
      }
      return previews.get(chassis) ?? null;
    };
    let strip: HTMLElement | null = null;
    let dots: HTMLButtonElement[] = [];
    let prevBtn: HTMLButtonElement | null = null;
    let nextBtn: HTMLButtonElement | null = null;
    let wired = false;
    let settle = 0;
    let lockUntil = 0;
    let watcher: ResizeObserver | null = null;

    /** Where slide `i` starts inside the strip (measured, so a scrollbar appearing beside the strip cannot leave it between two slides). */
    const slideLeft = (i: number): number => (strip?.children[i] as HTMLElement | undefined)?.offsetLeft ?? 0;

    const slideName = (i: number): string => (i < hooks.length ? tidy(hooks[i]!.label) : "Make your own hero");

    /** Mark the dots and the arrows for slide `i`. */
    function paint(i: number): void {
      dots.forEach((d, n) => {
        if (n === i) d.setAttribute("aria-current", "true");
        else d.removeAttribute("aria-current");
      });
      if (prevBtn) prevBtn.disabled = i <= 0;
      if (nextBtn) nextBtn.disabled = i >= slideCount - 1;
    }

    function setActive(i: number, say: boolean): void {
      const next = Math.max(0, Math.min(slideCount - 1, i));
      if (next === active) {
        paint(active);
        return;
      }
      active = next;
      paint(active);
      if (say) oc.announce(`${slideName(active)}, ${active + 1} of ${slideCount}`);
    }

    /** Scroll to slide `i`. The strip's scroll event then agrees with it. */
    function go(i: number, focusPlay = false): void {
      const next = Math.max(0, Math.min(slideCount - 1, i));
      setActive(next, true);
      if (strip) {
        const left = slideLeft(next);
        if (oc.reduced()) strip.scrollLeft = left;
        else {
          // The strip passes through the slides in between; its scroll events must not pull the dots back while it travels.
          lockUntil = performance.now() + 450;
          strip.scrollTo({ left, behavior: "smooth" });
        }
      }
      if (focusPlay) {
        const slide = strip?.children[next] as HTMLElement | undefined;
        slide?.querySelector<HTMLElement>("[data-lto-quick], [data-lto-create]")?.focus({ preventScroll: true });
      }
    }

    const s = oc.mountScreen("hero", `${hopts.adventureTitle}: choose your hero`, (sc) => {
      const body = sc.body;
      const back = el("div", "lto-scr-actions is-start");
      body.append(back);
      const b = oc.sbtn(back, "Back", "back");
      b.dataset.ltoBack = "";
      b.addEventListener("click", () => hopts.onBack());
      oc.titleBlock(body, tidy(hopts.adventureTitle) || "A new adventure", "Who will you be?");

      const wrap = el("div", "lto-hero");
      wrap.dataset.ltoHero = "";
      body.append(wrap);
      const st = el("div", "lto-hero-strip");
      st.dataset.ltoHooks = "";
      st.setAttribute("role", "group");
      st.setAttribute("aria-roledescription", "carousel");
      st.setAttribute("aria-label", "Heroes. Swipe, or use the arrow keys.");
      wrap.append(st);
      strip = st;

      const card = (slide: HTMLElement): HTMLElement => {
        const c = el("div", "lto-hero-card");
        slide.append(c);
        if (oc.isPixel()) oc.frame(c, "win", true);
        else c.classList.add("lto-plate");
        return c;
      };

      hooks.forEach((h, i) => {
        const label = tidy(h.label);
        const slide = el("div", "lto-hero-slide");
        slide.dataset.ltoSlide = h.chassis;
        slide.setAttribute("role", "group");
        slide.setAttribute("aria-roledescription", "slide");
        slide.setAttribute("aria-label", `${label}, ${i + 1} of ${slideCount}`);
        st.append(slide);
        const c = card(slide);
        oc.stext(c, label, { cls: "lto-card-title", scale: 3, weight: "bold", color: PX.gold, center: true });
        const pv = previewOf(h.chassis);
        if (pv?.canvas) {
          // The box is fixed by .lto-hero-doll; the canvas in it is the hand-made doll or, once the cast has loaded, the KayKit figure (data-art says which).
          const doll = el("div", "lto-hero-doll");
          doll.dataset.ltoDoll = h.chassis;
          doll.setAttribute("role", "img");
          doll.setAttribute("aria-label", `${label} in their basic gear`);
          pv.canvas.setAttribute("aria-hidden", "true");
          doll.append(pv.canvas);
          c.append(doll);
        }
        if (tidy(h.hook)) oc.stext(c, excerpt(h.hook, HOOK_MAX), { cls: "lto-card-hook lto-hero-desc", scale: 2, color: PX.ink, center: true });
        const kit = tidy(h.kit).replace(/^you start with\s+/i, "");
        if (kit) oc.stext(c, `You start with ${kit}`, { cls: "lto-card-quiet", scale: 2, color: PX.muted, center: true }).dataset.ltoKit = "";

        const play = el("div", "lto-hero-play");
        c.append(play);
        if (pv && pv.stats.length > 0) {
          const open = statsOpen.has(h.chassis);
          const toggle = oc.sbtn(play, "Default stats", `stats:${h.chassis}`);
          toggle.classList.add("lto-hero-toggle");
          toggle.dataset.ltoStatsToggle = h.chassis;
          toggle.setAttribute("aria-expanded", String(open));
          const panel = el("dl", "lto-hero-stats");
          panel.dataset.ltoStats = h.chassis;
          panel.id = `${oc.uid}-stats-${h.chassis}`;
          panel.hidden = !open;
          toggle.setAttribute("aria-controls", panel.id);
          // The six abilities in one block, then AC, HP, to hit and damage in another.
          const abilities = el("div", "lto-hero-group");
          const vitals = el("div", "lto-hero-group is-vitals");
          panel.append(abilities, vitals);
          for (const stat of pv.stats) {
            const cell = el("div", "lto-hero-stat");
            cell.dataset.ltoStat = stat.label;
            const dt = el("dt");
            const dd = el("dd");
            dd.style.margin = "0";
            oc.stext(dt, stat.label, { cls: "lto-hero-lbl", scale: 2, color: PX.muted, center: true });
            oc.stext(dd, stat.value, { cls: "lto-hero-val", scale: 2, weight: "bold", color: PX.ink, center: true });
            cell.append(dt, dd);
            (ABILITY_LABELS.has(stat.label) ? abilities : vitals).append(cell);
          }
          c.append(panel);
          toggle.addEventListener("click", () => {
            const now = panel.hidden;
            panel.hidden = !now;
            toggle.setAttribute("aria-expanded", String(now));
            if (now) statsOpen.add(h.chassis);
            else statsOpen.delete(h.chassis);
            // The panel's pixel text was laid out for a hidden box (no width): draw the screen again so it is cut to the real one.
            if (now && oc.isPixel()) sc.rebuild();
          });
        }

        const pb = oc.sbtn(play, `Play as the ${label}`, `quick:${h.chassis}`, true);
        pb.dataset.ltoQuick = h.chassis;
        pb.setAttribute("aria-label", `Play as the ${label}. ${tidy(h.hook)}${kit ? ` You start with ${kit}.` : ""}`);
        pb.addEventListener("click", () => hopts.onQuick(h.chassis));
      });

      // The last slide: the character maker.
      const mine = el("div", "lto-hero-slide");
      mine.dataset.ltoSlide = "create";
      mine.setAttribute("role", "group");
      mine.setAttribute("aria-roledescription", "slide");
      mine.setAttribute("aria-label", `Make your own hero, ${slideCount} of ${slideCount}`);
      st.append(mine);
      const mc = card(mine);
      oc.stext(mc, "Make your own hero", { cls: "lto-card-title", scale: 3, weight: "bold", color: PX.gold, center: true });
      const plus = el("div", "lto-hero-doll is-plus");
      plus.append(icon(PLUS, "0 0 448 512"));
      mc.append(plus);
      oc.stext(mc, "Give your hero a name, then start from a class or a blank sheet. You can change every number.", { cls: "lto-card-hook lto-hero-desc", scale: 2, color: PX.ink, center: true });
      const mplay = el("div", "lto-hero-play");
      mc.append(mplay);
      const mb = oc.sbtn(mplay, "Open the character maker", "create", true);
      mb.dataset.ltoCreate = "";
      mb.setAttribute("aria-label", "Make your own hero. Open the character maker.");
      mb.addEventListener("click", () => hopts.onCreate());

      // The arrows and the dots.
      const nav = el("div", "lto-hero-nav");
      wrap.append(nav);
      const arrow = (dir: -1 | 1): HTMLButtonElement => {
        const ab = el("button", "lto-btn lto-hero-arrow");
        ab.type = "button";
        ab.dataset.scrKey = dir < 0 ? "hero-prev" : "hero-next";
        ab.dataset.ltoHeroArrow = dir < 0 ? "prev" : "next";
        ab.setAttribute("aria-label", dir < 0 ? "Previous hero" : "Next hero");
        if (oc.isPixel()) oc.frame(ab, "win", true);
        ab.append(icon(dir < 0 ? CHEVRON_LEFT : CHEVRON_RIGHT, "0 0 320 512"));
        ab.addEventListener("click", () => go(active + dir));
        return ab;
      };
      prevBtn = arrow(-1);
      nextBtn = arrow(1);
      const dotRow = el("div", "lto-hero-dots");
      dots = [];
      for (let i = 0; i < slideCount; i++) {
        const d = el("button", "lto-hero-dot");
        d.type = "button";
        d.tabIndex = -1;
        d.dataset.ltoHeroDot = String(i);
        d.setAttribute("aria-label", `Show ${slideName(i)}`);
        d.append(el("i"));
        d.addEventListener("click", () => go(i));
        dots.push(d);
        dotRow.append(d);
      }
      nav.append(prevBtn, dotRow, nextBtn);

      // A swipe or a drag settles on a slide: the dots follow the strip.
      st.addEventListener("scroll", () => {
        if (settle) cancelAnimationFrame(settle);
        settle = requestAnimationFrame(() => {
          settle = 0;
          if (performance.now() < lockUntil) return;
          if (strip && strip.clientWidth > 0) setActive(Math.round(strip.scrollLeft / strip.clientWidth), true);
        });
      });
      paint(active);
      st.scrollLeft = slideLeft(active);
      // A change of width (a scrollbar, the window, a turn of the phone) keeps the same slide in view.
      watcher?.disconnect();
      if (typeof ResizeObserver !== "undefined") {
        watcher = new ResizeObserver(() => {
          if (sc.closed) watcher?.disconnect();
          else if (strip && performance.now() > lockUntil) strip.scrollLeft = slideLeft(active);
        });
        watcher.observe(st);
      }

      // Left and Right change the slide wherever the focus is on this screen (the screen's own arrow keys would move between cards).
      if (!wired) {
        wired = true;
        body.addEventListener("keydown", (e) => {
          if ((e.key !== "ArrowLeft" && e.key !== "ArrowRight") || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
          const t = e.target;
          if (t instanceof HTMLElement && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
          e.preventDefault();
          e.stopPropagation();
          go(active + (e.key === "ArrowRight" ? 1 : -1), true);
        });
      }
    });
    s.onEscape = () => hopts.onBack();
    // The pictures follow the art while the screen is up (the cast can land under it); when it goes they let go of that.
    s.onClose(() => {
      for (const p of previews.values()) p?.picture?.dispose();
    });
    queueMicrotask(() => {
      if (!s.closed) s.node.querySelector<HTMLElement>("[data-lto-quick], [data-lto-create]")?.focus({ preventScroll: true });
    });
    return { close: () => oc.closeScreen(s) };
  }

  // ---- the ending

  function endingCard(eopts: EndingCardOptions): EndingCard {
    const dead: EndingCard = { close() {} };
    if (oc.destroyed) return dead;
    const outcome = eopts.outcome;
    const title = tidy(eopts.title) || endingKicker(outcome);
    const s = oc.mountScreen("ending", `${endingKicker(outcome)}: ${title}`, (sc) => {
      sc.node.dataset.outcome = outcome;
      const body = sc.body;
      const box = el("div", "lto-endbox");
      box.dataset.ltoEnding = outcome;
      body.append(box);
      oc.stext(box, endingKicker(outcome), { cls: "lto-scr-sec", scale: 2, weight: "bold", color: outcome === "defeat" ? PX.bad : PX.gold, outline: true, center: true });
      oc.ribbon(box, title, endingBannerKind(outcome), { pxMax: oc.tier === "s" ? 3 : 4, sbMax: oc.tier === "s" ? 28 : 36 });
      const text = (eopts.text ?? "").trim();
      if (text) {
        const tb = el("div", "lto-narr-box");
        tb.dataset.ltoEndingText = "";
        box.append(tb);
        if (oc.isPixel()) oc.frame(tb, outcome === "defeat" ? "red" : outcome === "continue" ? "blue" : "gold", oc.tier === "s");
        else tb.classList.add("lto-plate");
        const tbody = el("div", "lto-narr-body");
        tb.append(tbody);
        if (oc.isPixel()) tbody.append(oc.srText(text), oc.px(text, { scale: 2, color: PX.ink, shadow: PX.shade, maxWidth: wrapWidth(oc.roomOf(tbody, 8), 2, deviceRatio()) }));
        else tbody.textContent = text;
      }
      const row = el("div", "lto-scr-actions");
      box.append(row);
      for (const c of endingChoices(!!eopts.onContinue)) {
        if (c === "continue") {
          const b = oc.sbtn(row, "Continue", "continue", true);
          b.dataset.ltoContinue = "";
          b.addEventListener("click", () => eopts.onContinue?.());
        } else {
          const b = oc.sbtn(row, "Back to the start screen", "menu", !eopts.onContinue);
          b.dataset.ltoMenuBack = "";
          b.addEventListener("click", () => eopts.onMenu());
        }
      }
    });
    s.onEscape = () => eopts.onContinue?.();
    oc.announce(`${endingKicker(outcome)}: ${title}. ${eopts.text ?? ""}`);
    queueMicrotask(() => {
      if (!s.closed) s.node.querySelector<HTMLElement>("[data-lto-continue], [data-lto-menu-back]")?.focus({ preventScroll: true });
    });
    return { close: () => oc.closeScreen(s) };
  }

  // What the other modules call or read.
  oc.startHero = startHero;
  oc.endingCard = endingCard;
}
