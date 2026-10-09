/**
 * SVG numerals (the .cg-num treatment): the gradient defs, the glyph geometry and the numeral builder.
 */
import { svgEl, serifWidth } from "./domKit";
import type { Face } from "./overlayTheme";
import { FACES, NUMERAL_CAP } from "./overlayTheme";
import type { FloatKind, BannerKind } from "./overlayTypes";

// ---- SVG numerals: the .cg-num treatment -----------------------------------

export function buildDefs(uid: string): SVGSVGElement {
  const svg = svgEl("svg", { width: 0, height: 0, "aria-hidden": "true", focusable: "false" });
  svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  const defs = svgEl("defs");
  for (const [key, f] of Object.entries(FACES) as [string, Face][]) {
    const g = svgEl("linearGradient", { id: `lto${uid}-${key}`, x1: 0, y1: 0, x2: 0, y2: 1 });
    // The hard pair at .46 and .47 is on purpose: a one-percent value cliff
    // mid-glyph is what makes the numeral read as moulded metal, not a gradient.
    for (const [offset, color] of [[0, f.top], [0.46, f.mid], [0.47, f.deep], [1, f.mid]] as const) {
      g.append(svgEl("stop", { offset, "stop-color": color }));
    }
    defs.append(g);
  }
  svg.append(defs);
  return svg;
}

/**
 * The box of an SVG numeral at a font size, and where its inked glyphs sit in it:
 * `padTop` and `padBottom` are the empty margins above the capitals' top edge and
 * below the baseline, the outline's half stroke included.
 */
export function numeralGeometry(px: number, textW: number): { stroke: number; w: number; h: number; baseline: number; padTop: number; padBottom: number } {
  const stroke = Math.max(3, Math.round(px * 0.3));
  const w = Math.ceil(textW + stroke * 2 + 4);
  const h = Math.ceil(px * 1.22 + stroke * 2);
  const baseline = stroke + px * 0.92;
  return {
    stroke,
    w,
    h,
    baseline,
    padTop: Math.max(0, baseline - px * NUMERAL_CAP - stroke / 2),
    padBottom: Math.max(0, h - baseline - stroke / 2),
  };
}

/**
 * Display text as an SVG numeral: paint-order stroke-then-fill so the dark
 * outline sits behind the face instead of eating it (the reason .cg-num is SVG
 * text and not -webkit-text-stroke on HTML), a hard-stop gradient face, and a
 * drop shadow from the .lto-num class.
 */
export function numeral(uid: string, key: FloatKind | BannerKind, text: string, px: number, spacing = 0): SVGSVGElement {
  const f = FACES[key];
  const textW = serifWidth(text, px) + Math.max(0, text.length - 1) * spacing * px;
  const { stroke, w, h, baseline } = numeralGeometry(px, textW);
  const svg = svgEl("svg", { class: "lto-num", width: w, height: h, viewBox: `0 0 ${w} ${h}`, "aria-hidden": "true", focusable: "false" });
  const t = svgEl("text", {
    x: w / 2,
    y: baseline,
    "text-anchor": "middle",
    "font-size": px,
    fill: `url(#lto${uid}-${key})`,
    stroke: f.outline,
    "stroke-width": stroke,
    "paint-order": "stroke fill",
    "stroke-linejoin": "round",
  });
  if (spacing) t.setAttribute("letter-spacing", String(spacing * px));
  t.textContent = text;
  svg.append(t);
  return svg;
}
