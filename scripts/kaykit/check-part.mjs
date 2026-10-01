/**
 * Validates one KayKit library part (.cache/kaykit/library/parts/*.json)
 * against the game's targets (.cache/kaykit/library/targets.json, written by
 * export-targets.ts). Exit code 1 on any rule broken; prints coverage either
 * way.
 *
 *   node scripts/kaykit/check-part.mjs .cache/kaykit/library/parts/props-32.json
 *
 * THE PART FORMAT:
 * {
 *   "maker": "props", "size": 16 | 32, "style": "lit" | "painted" | "bands" | ...,
 *   "sprites": [ { "assetId", "kind", "name", "walkable", "pixels": number[][] } ],
 *   "gaps": [ { "assetId", "reason" } ]      // ids this maker owns but could not convert
 * }
 * Rules: every assetId is a known target and not out of play; kind, name and
 * walkable equal the target's; dimensions are the target's 16 px dimensions
 * times size/16; every pixel is -1 (transparent) or a palette index 0..47;
 * tiles have no transparent pixels; props, tokens and icons are not fully
 * transparent; no id appears twice.
 *
 * WALL PROFILE RULES (render/wallProfiles.ts; k = size / 16, every band below is
 * in 16 px units times k):
 *   1. A part that carries any `wall_join` id (the joins and the jamb overlay)
 *      must carry all 16 base joins plus the jambs: the renderer draws the set
 *      all or nothing, so a partial set would never draw.
 *   2. wall_stone_jambs_ns: rows [3k, 13k) fully transparent (the gap shows the
 *      room's floor); rows [0, 2k) and [14k, 16k) opaque in columns [k, 15k)
 *      (the strip runs up to the gap on both sides).
 *   3. door_closed_ns: columns [0, k) and [15k, 16k) transparent in rows
 *      [4k, 12k) (the leaf stays inside its own tile); columns [7k, 9k) opaque
 *      in rows [3k, 13k) (the bar spans the gap from jamb to jamb).
 *   4. door_open_ns: the same two outer column bands transparent; columns
 *      [7k, 9k) transparent in rows [3k, 8k) (the passage is clear).
 */
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/kaykit/check-part.mjs <part.json>");
  process.exit(2);
}
const { targets, usable } = JSON.parse(readFileSync(".cache/kaykit/library/targets.json", "utf8"));
const byId = new Map(targets.map((t) => [t.assetId, t]));
/** First (x, y) in the band that fails `ok`, or null. Bands are [x0, x1) by [y0, y1). */
function firstBad(px, x0, x1, y0, y1, ok) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (!ok(px?.[y]?.[x])) return [x, y];
  return null;
}
const part = JSON.parse(readFileSync(file, "utf8"));
const problems = [];
const seen = new Set();
const k = part.size / 16;
if (![16, 32].includes(part.size)) problems.push(`size must be 16 or 32, got ${part.size}`);

/** Rules 2 to 4: the shape bands of the jamb overlay and the two side-on door leaves. */
function checkWallProfile(s, t) {
  const px = s.pixels;
  const bad = (what, x0, x1, y0, y1, ok) => {
    const at = firstBad(px, x0, x1, y0, y1, ok);
    if (at) problems.push(`${s.assetId}: ${what} (first at x ${at[0]}, y ${at[1]})`);
  };
  const clearV = (v) => v === -1;
  const solidV = (v) => v !== -1 && v !== undefined;
  if (t.jambs) {
    bad("rows [3k, 13k) must be fully transparent", 0, 16 * k, 3 * k, 13 * k, clearV);
    bad("rows [0, 2k) must be opaque in columns [k, 15k)", k, 15 * k, 0, 2 * k, solidV);
    bad("rows [14k, 16k) must be opaque in columns [k, 15k)", k, 15 * k, 14 * k, 16 * k, solidV);
  }
  if (t.sideOnOf !== undefined) {
    bad("columns [0, k) must be transparent in rows [4k, 12k) (the leaf leaves its tile)", 0, k, 4 * k, 12 * k, clearV);
    bad("columns [15k, 16k) must be transparent in rows [4k, 12k) (the leaf leaves its tile)", 15 * k, 16 * k, 4 * k, 12 * k, clearV);
    // an open leaf is the walkable one: the gap beside it is clear, where a closed leaf's bar fills it
    if (t.walkable) bad("columns [7k, 9k) must be transparent in rows [3k, 8k) (the passage is clear)", 7 * k, 9 * k, 3 * k, 8 * k, clearV);
    else bad("columns [7k, 9k) must be opaque in rows [3k, 13k) (the bar spans the gap)", 7 * k, 9 * k, 3 * k, 13 * k, solidV);
  }
}
for (const s of part.sprites ?? []) {
  const t = byId.get(s.assetId);
  if (!t) { problems.push(`${s.assetId}: not a fantasy target id`); continue; }
  if (t.outOfPlay) problems.push(`${s.assetId}: out of play, do not produce it`);
  if (seen.has(s.assetId)) problems.push(`${s.assetId}: produced twice`);
  seen.add(s.assetId);
  if (s.kind !== t.kind) problems.push(`${s.assetId}: kind ${s.kind}, target ${t.kind}`);
  if (s.walkable !== t.walkable) problems.push(`${s.assetId}: walkable ${s.walkable}, target ${t.walkable}`);
  const h = s.pixels?.length ?? 0;
  const w = s.pixels?.[0]?.length ?? 0;
  if (w !== t.w16 * k || h !== t.h16 * k) problems.push(`${s.assetId}: ${w}x${h}, target ${t.w16 * k}x${t.h16 * k}`);
  let opaque = 0;
  let clear = 0;
  for (const row of s.pixels ?? []) {
    if (row.length !== w) { problems.push(`${s.assetId}: ragged rows`); break; }
    for (const v of row) {
      if (v === -1) clear++;
      else if (Number.isInteger(v) && v >= 0 && v < usable) opaque++;
      else { problems.push(`${s.assetId}: pixel value ${v} (allowed -1 or 0..${usable - 1})`); break; }
    }
  }
  checkWallProfile(s, t);
  if (t.kind === "tile" && clear > 0) problems.push(`${s.assetId}: a tile has ${clear} transparent pixels`);
  if (t.kind !== "tile" && opaque === 0) problems.push(`${s.assetId}: fully transparent`);
}
// Rule 1: a part with any wall_join id carries the whole base set and the jambs.
if ([...seen].some((id) => byId.get(id)?.group === "wall_join")) {
  const required = targets.filter((t) => t.group === "wall_join" && (t.jambs || t.join?.variant === "a"));
  const lacking = required.filter((t) => !seen.has(t.assetId)).map((t) => t.assetId);
  if (lacking.length) problems.push(`wall_join: a partial set is never drawn, missing ${lacking.length} of ${required.length} required ids (${lacking.slice(0, 4).join(", ")}${lacking.length > 4 ? ", ..." : ""})`);
}
for (const g of part.gaps ?? []) {
  if (!byId.has(g.assetId)) problems.push(`gap ${g.assetId}: not a fantasy target id`);
  if (seen.has(g.assetId)) problems.push(`gap ${g.assetId}: also produced`);
}
const inPlay = targets.filter((t) => !t.outOfPlay).length;
console.log(`${file}: ${seen.size} sprites, ${(part.gaps ?? []).length} gaps (of ${inPlay} in-play fantasy ids overall), ${problems.length} problem(s)`);
for (const p of problems.slice(0, 40)) console.log(`  - ${p}`);
if (problems.length > 40) console.log(`  ... and ${problems.length - 40} more`);
process.exit(problems.length ? 1 : 0);
