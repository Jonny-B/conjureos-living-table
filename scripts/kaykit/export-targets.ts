/**
 * Writes .cache/kaykit/library/targets.json: every fantasy sprite the game
 * uses (scripts/assets/fantasy.ts SPRITES), with its kind, name, walkability
 * and 16 px dimensions, so the KayKit conversion makers know exactly which ids
 * to produce and check-part.mjs can hold them to it.
 *
 * Also records the edge-tile semantics (which of a tile's sides or corners
 * show the "under" material) straight from the game's own tables, so a
 * converted edge set means the same thing the autotiler expects.
 *
 * Owner decisions, 2026-09-30: sci-fi is paused (not exported) and the Healer
 * is out of play (its token and gear are marked outOfPlay: skip them).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { PALETTE, SPRITES } from "../assets/fantasy";

interface Target {
  assetId: string;
  kind: "tile" | "prop" | "token";
  name: string;
  walkable: boolean;
  w16: number;
  h16: number;
  group: string;
  outOfPlay?: boolean;
  edge?: { prefix: string; suffix: string };
}

const EDGE_SUFFIXES = ["n", "e", "s", "w", "ne", "nw", "se", "sw", "ns", "ew", "nes", "wne", "swn", "esw", "nesw", "inw", "ine", "isw", "ise"];

function groupOf(id: string, kind: string): string {
  if (id.startsWith("gear_")) return /_(ring|amulet)_/.test(id) ? "icon" : "gear";
  if (kind === "token") return "token";
  if (kind === "prop") return "prop";
  const suffix = EDGE_SUFFIXES.find((s) => id.endsWith(`_${s}`) && /_edge_/.test(id));
  if (suffix) return "edge";
  if (id.startsWith("wall_")) return "wall";
  return "ground";
}

const targets: Target[] = (SPRITES as unknown as { assetId: string; kind: Target["kind"]; name: string; walkable: boolean; pixels: number[][] }[]).map((s) => {
  const t: Target = {
    assetId: s.assetId,
    kind: s.kind,
    name: s.name,
    walkable: s.walkable,
    w16: s.pixels[0]!.length,
    h16: s.pixels.length,
    group: groupOf(s.assetId, s.kind),
  };
  if (/healer/.test(s.assetId)) t.outOfPlay = true;
  if (t.group === "edge") {
    const suffix = EDGE_SUFFIXES.find((x) => s.assetId.endsWith(`_${x}`))!;
    t.edge = { prefix: s.assetId.slice(0, s.assetId.length - suffix.length), suffix };
  }
  return t;
});

mkdirSync(".cache/kaykit/library/parts", { recursive: true });
writeFileSync(".cache/kaykit/library/targets.json", JSON.stringify({ palette: PALETTE, usable: 48, targets }, null, 1));
const count = (g: string) => targets.filter((t) => t.group === g).length;
console.log(
  `wrote .cache/kaykit/library/targets.json: ${targets.length} ids ` +
    `(ground ${count("ground")}, wall ${count("wall")}, edge ${count("edge")}, prop ${count("prop")}, token ${count("token")}, gear ${count("gear")}, icon ${count("icon")}; ` +
    `${targets.filter((t) => t.outOfPlay).length} out of play)`,
);
