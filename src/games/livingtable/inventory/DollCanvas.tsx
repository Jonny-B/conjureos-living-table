/**
 * The doll's canvas: a thin React wrapper around the render lane's own
 * `render/doll.ts::renderDoll`, the same `useRef` + `useEffect` +
 * `getContext("2d")` shape LivingTable.tsx already uses for the board (see
 * its own `canvasRef`). `useEffect` never runs under `renderToStaticMarkup`
 * (no DOM, no ref), so this component is SSR-safe by the same property the
 * board's canvas already relies on: the markup renders an empty `<canvas>`
 * and nothing throws.
 *
 * Scale is a controlled prop, defaulting to the pinned phone-width worked
 * example (INVENTORY_LAYOUT: 206 CSS px of doll column -> scale 6 -> a 192px
 * canvas), and re-measured against the wrapping element's own width on
 * mount and on resize, clamped to [DOLL_MIN_SCALE, DOLL_MAX_SCALE] -- the
 * exact formula equipmentTypes.ts pins for the doll. No devicePixelRatio,
 * the same rule the board's own `displayScale` already follows.
 */
import { useEffect, useRef, useState } from "react";
import { DOLL_CANVAS_SIZE, DOLL_MAX_SCALE, DOLL_MIN_SCALE, type TokenRenderPlan } from "../characters/equipmentTypes";
import { renderDoll } from "../render/doll";
import type { RenderManifest } from "../render/canvasRenderer";

export interface DollCanvasProps {
  plan: TokenRenderPlan | null;
  manifest: RenderManifest;
  /** Initial / SSR scale, before any live measurement. */
  initialScale?: number;
}

export function DollCanvas({ plan, manifest, initialScale = 6 }: DollCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(initialScale);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const avail = wrap.clientWidth;
      if (avail <= 0) return;
      const next = Math.min(DOLL_MAX_SCALE, Math.max(DOLL_MIN_SCALE, Math.floor(avail / DOLL_CANVAS_SIZE)));
      setScale(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    // renderDoll paints only opaque pixels, so a staged Unequip (a legendary
    // blade back to the plain one) would otherwise leave the old blade's
    // pixels standing under the new one. Start every redraw from clear.
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    renderDoll(ctx, plan, manifest, scale);
  }, [plan, manifest, scale]);

  const px = DOLL_CANVAS_SIZE * scale;
  return (
    <div className="lt-inventory-doll-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} className="lt-inventory-doll" width={px} height={px} style={{ width: px, height: px }} />
    </div>
  );
}
