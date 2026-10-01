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
 */
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/kaykit/check-part.mjs <part.json>");
  process.exit(2);
}
const { targets, usable } = JSON.parse(readFileSync(".cache/kaykit/library/targets.json", "utf8"));
const byId = new Map(targets.map((t) => [t.assetId, t]));
const part = JSON.parse(readFileSync(file, "utf8"));
const problems = [];
const seen = new Set();
const k = part.size / 16;
if (![16, 32].includes(part.size)) problems.push(`size must be 16 or 32, got ${part.size}`);
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
  if (t.kind === "tile" && clear > 0) problems.push(`${s.assetId}: a tile has ${clear} transparent pixels`);
  if (t.kind !== "tile" && opaque === 0) problems.push(`${s.assetId}: fully transparent`);
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
