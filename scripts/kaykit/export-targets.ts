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
 * Wall profiles (render/wallProfiles.ts). The 23 render-only ids (the 16 joins
 * and 4 run variants, the jamb overlay, the two side-on door leaves) are
 * exported with the joins' meaning read from the game's own tables
 * (WALL_JOIN_BY_MASK, WALL_JOIN_VARIANT_SUFFIXES, WALL_PROFILE_RULES), so the
 * makers draw the shape the mask pass asks for and cannot drift from it:
 *   - group "wall_join" for every `wall_stone_join_*` tile AND for the jamb
 *     overlay (a prop by kind, a wall by trade: the ground makers draw it from
 *     their own joins, so the props maker must not be asked for it);
 *   - the two leaves stay group "prop" (lib_props draws them);
 *   - `join` { mask, sides, faced, variant } on a join: the 4-bit mask (N=1 E=2
 *     S=4 W=8), the joined sides in n, e, s, w order ("" for the pillar), whether
 *     it shows a front face (south not joined), and the look ("a" the base,
 *     "b" and "c" the run variants);
 *   - `jambs: true` on the overlay, `sideOnOf` on a leaf (the stored door it
 *     replaces), `renderOnly: true` on all 23.
 *
 * targets.json is written atomically (a temp file, then a rename) because other
 * tools read it while this runs.
 *
 * Owner decisions, 2026-09-30: sci-fi is paused (not exported) and the Healer
 * is out of play (its token and gear are marked outOfPlay: skip them).
 */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { PALETTE, SPRITES } from "../assets/fantasy";
import {
  RENDER_ONLY_ASSET_IDS,
  WALL_JOIN_BY_MASK,
  WALL_JOIN_VARIANT_SUFFIXES,
  WALL_PROFILE_RULES,
  WALL_S,
} from "../../src/games/livingtable/render/wallProfiles";

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
  join?: { mask: number; sides: string; faced: boolean; variant: "a" | "b" | "c" };
  jambs?: true;
  sideOnOf?: string;
  renderOnly?: true;
}

const EDGE_SUFFIXES = ["n", "e", "s", "w", "ne", "nw", "se", "sw", "ns", "ew", "nes", "wne", "swn", "esw", "nesw", "inw", "ine", "isw", "ise"];

/** Every wall-profile id the rules name: the join meaning by id, the jamb ids, and each leaf's stored door. */
const JOIN_OF = new Map<string, { mask: number; variant: "a" | "b" | "c" }>();
const JAMB_IDS = new Set<string>();
const LEAF_OF = new Map<string, string>();
for (const rule of WALL_PROFILE_RULES) {
  WALL_JOIN_BY_MASK.forEach((join, mask) => {
    JOIN_OF.set(rule.prefix + join, { mask, variant: "a" });
    (WALL_JOIN_VARIANT_SUFFIXES[join] ?? []).forEach((suffix, i) => JOIN_OF.set(rule.prefix + join + suffix, { mask, variant: i === 0 ? "b" : "c" }));
  });
  JAMB_IDS.add(rule.jambs);
  for (const [stored, leaf] of Object.entries(rule.doors)) LEAF_OF.set(leaf, stored);
}

function groupOf(id: string, kind: string): string {
  // The jamb overlay is kind prop but belongs to the wall set, so this comes before the kind checks.
  if (JOIN_OF.has(id) || JAMB_IDS.has(id)) return "wall_join";
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
  const join = JOIN_OF.get(s.assetId);
  if (join) {
    const sides = WALL_JOIN_BY_MASK[join.mask]!;
    t.join = { mask: join.mask, sides: sides === "none" ? "" : sides, faced: (join.mask & WALL_S) === 0, variant: join.variant };
  }
  if (JAMB_IDS.has(s.assetId)) t.jambs = true;
  const stored = LEAF_OF.get(s.assetId);
  if (stored !== undefined) t.sideOnOf = stored;
  if (RENDER_ONLY_ASSET_IDS.has(s.assetId)) t.renderOnly = true;
  return t;
});

const missing = [...RENDER_ONLY_ASSET_IDS].filter((id) => !targets.some((t) => t.assetId === id));
if (missing.length > 0) throw new Error(`export-targets: render-only ids with no fantasy sprite: ${missing.join(", ")}`);

mkdirSync(".cache/kaykit/library/parts", { recursive: true });
const OUT = ".cache/kaykit/library/targets.json";
const TMP = `${OUT}.${process.pid}.tmp`;
writeFileSync(TMP, JSON.stringify({ palette: PALETTE, usable: 48, targets }, null, 1));
renameSync(TMP, OUT);
const count = (g: string) => targets.filter((t) => t.group === g).length;
console.log(
  `wrote ${OUT}: ${targets.length} ids ` +
    `(ground ${count("ground")}, wall ${count("wall")}, wall_join ${count("wall_join")}, edge ${count("edge")}, prop ${count("prop")}, token ${count("token")}, gear ${count("gear")}, icon ${count("icon")}; ` +
    `${targets.filter((t) => t.outOfPlay).length} out of play)`,
);
