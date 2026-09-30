/**
 * One slot box's or bag cell's pixel icon: a thin React wrapper around the
 * render lane's `render/gearIcon.ts::renderGearIcon`, the same useRef +
 * useEffect + getContext("2d") shape DollCanvas.tsx and the board use.
 *
 * The icon is CROPPED from the very overlay the doll and the board draw (same
 * pixels, same recolour, same rim light), or for a ring or amulet its own
 * 16x16 icon, or for an empty ring or amulet slot its silhouette. A sprite
 * the manifest does not carry draws nothing and `renderGearIcon` returns
 * false; then `fallback` (the item's name as text) is what shows. That is the
 * state for any v2 sprite until games-db serves the v2 art, and it is also
 * the server-render state (effects never run there), so the screen reads as
 * finished either way and a test sees the item's name in the markup.
 *
 * Backing store equals CSS size and devicePixelRatio is NOT multiplied in,
 * the rule the board's displayScale and the doll already follow.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { GearIconSource } from "../characters/equipmentTypes";
import type { RenderManifest } from "../render/canvasRenderer";
import { renderGearIcon } from "../render/gearIcon";

export interface GearIconCanvasProps {
  source: GearIconSource | null;
  manifest: RenderManifest;
  /** The square's side, in CSS pixels. */
  cellPx: number;
  /** What shows when there is no sprite to draw: the item's name, as text. */
  fallback: ReactNode;
}

/** A stable identity for an icon source, so a re-render that rebuilds an equal source object does not repaint. */
function sourceKey(source: GearIconSource | null): string {
  if (!source) return "";
  if (source.kind === "silhouette") return `silhouette:${source.spriteId}`;
  return `${source.kind}:${source.spriteId}:${source.glowBands}:${source.remap ? JSON.stringify(source.remap) : "-"}`;
}

export function GearIconCanvas({ source, manifest, cellPx, fallback }: GearIconCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  const key = sourceKey(source);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !source) {
      setDrawn(false);
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setDrawn(renderGearIcon(ctx, source, manifest, cellPx));
    // `source` is tracked through `key`: an equal source rebuilt on every
    // render must not repaint, and a changed one always does.
  }, [key, manifest, cellPx]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="lt-gear-icon"
        width={cellPx}
        height={cellPx}
        style={{ width: cellPx, height: cellPx, display: drawn ? "block" : "none" }}
        aria-hidden="true"
      />
      {!drawn && fallback}
    </>
  );
}
