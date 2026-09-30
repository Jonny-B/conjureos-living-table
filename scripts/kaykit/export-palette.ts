/**
 * Writes the fantasy template's 52-entry PALETTE (scripts/assets/fantasy.ts)
 * to .cache/kaykit/palette-fantasy.json, so the Blender side (which cannot
 * import TypeScript) quantises KayKit renders into exactly the colours the
 * game already uses. Entries 48-51 are the reserved enchantment glow band;
 * the renderer never picks them.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { PALETTE } from "../assets/fantasy";

mkdirSync(".cache/kaykit", { recursive: true });
writeFileSync(".cache/kaykit/palette-fantasy.json", JSON.stringify({ palette: PALETTE, usable: 48 }));
console.log(`wrote .cache/kaykit/palette-fantasy.json (${PALETTE.length} colours, 48 usable)`);
