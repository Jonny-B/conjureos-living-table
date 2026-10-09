/**
 * Tests for rollReadoutAdapter.ts: the honest path from a real engine result
 * (rules/combat.ts's AttackResult, rules/checks.ts's CheckResult) to
 * canvasRenderer.ts's RollReadout HUD shape. Exists because a prior review
 * found renderRollReadout had no real caller and no test proving either
 * engine result could actually be fed into it.
 *
 * Run: npx tsx --test test/livingtable-render.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAttack } from "../src/games/livingtable/rules/combat";
import { resolveSkillCheck } from "../src/games/livingtable/rules/checks";
import { attackResultToReadout, checkResultToReadout, lootRollToReadout } from "../src/games/livingtable/render/rollReadoutAdapter";
import type { LootRoll } from "../src/games/livingtable/characters/equipmentTypes";
import {
  applyDisplayTiles,
  applyTerrainEdges,
  edgeSideMask,
  edgeVariantCandidates,
  edgeVariantFor,
  EDGE_SUFFIX_BY_MASK,
  TERRAIN_EDGE_RULES,
  type TerrainEdgeRule,
} from "../src/games/livingtable/render/terrainEdges";
import {
  applyTileVariants,
  tileVariantHash,
  variantAt,
  VARIANT_SETS,
  type VariantSet,
} from "../src/games/livingtable/render/tileVariants";
import { SPRITES as FANTASY_SPRITES } from "../scripts/assets/fantasy";
import { SPRITES as SCIFI_SPRITES } from "../scripts/assets/scifi";

// A fixed rng makes rollD20 deterministic: rollD20 reads Math.floor(rng() * 20) + 1,
// so rng() = 0.5 always lands on a roll of 11 (no advantage/disadvantage in play here).
const fixedRoll11 = () => 0.5;

test("attackResultToReadout carries a real AttackResult's numbers into the readout, hit case", () => {
  const result = resolveAttack({ attackerBonus: 5, targetAC: 15, rng: fixedRoll11 });
  assert.equal(result.roll, 11);
  assert.equal(result.total, 16); // 11 + 5
  assert.equal(result.hit, true); // 16 >= 15

  const readout = attackResultToReadout(result, 5, 15);
  assert.deepEqual(readout, { roll: 11, modifier: 5, total: 16, target: 15, hit: true });
});

test("attackResultToReadout carries a real AttackResult's numbers into the readout, miss case", () => {
  const result = resolveAttack({ attackerBonus: 1, targetAC: 20, rng: fixedRoll11 });
  assert.equal(result.roll, 11);
  assert.equal(result.total, 12); // 11 + 1
  assert.equal(result.hit, false); // 12 < 20

  const readout = attackResultToReadout(result, 1, 20);
  assert.deepEqual(readout, { roll: 11, modifier: 1, total: 12, target: 20, hit: false });
});

test("checkResultToReadout maps a real CheckResult's success onto the readout's hit field, success case", () => {
  const result = resolveSkillCheck({ modifier: 4, dc: 10, rng: fixedRoll11 });
  assert.equal(result.roll, 11);
  assert.equal(result.total, 15); // 11 + 4
  assert.equal(result.success, true); // 15 >= 10

  const readout = checkResultToReadout(result, 4, 10);
  assert.deepEqual(readout, { roll: 11, modifier: 4, total: 15, target: 10, hit: true });
});

test("checkResultToReadout maps a real CheckResult's success onto the readout's hit field, failure case", () => {
  const result = resolveSkillCheck({ modifier: 0, dc: 18, rng: fixedRoll11 });
  assert.equal(result.roll, 11);
  assert.equal(result.total, 11); // 11 + 0
  assert.equal(result.success, false); // 11 < 18

  const readout = checkResultToReadout(result, 0, 18);
  assert.deepEqual(readout, { roll: 11, modifier: 0, total: 11, target: 18, hit: false });
});

// ── contract v2: lootRollToReadout ──────────────────────────────────────────
//
// The loot popup beside RollReadout in the same DOM overlay. Same adapter
// shape as the two above: LootRoll is engine output with no player-facing
// words on it, and the caller (who already resolved the item's name through
// gearItemName, THE one namer) supplies them back. The three cases below are
// the three shapes LOOT: THE WORDS pins in characters/equipmentTypes.ts.

test("lootRollToReadout: the nothing band prints 'Nothing of value' and no item", () => {
  const roll: LootRoll = { source: "fight", tierRoll: 23, tier: null, eligible: [], slotDie: 0, slotRoll: null, item: null };
  const readout = lootRollToReadout(roll, null, "Aria, loot from the fight");
  assert.deepEqual(readout, {
    kind: "loot",
    caption: "Aria, loot from the fight",
    tierRoll: 23,
    tierWord: "Nothing",
    slotDie: 0,
    slotRoll: null,
    verdict: "Nothing of value",
  });
});

test("lootRollToReadout: a real find carries the tier word, both dice and the item's own name", () => {
  // The contract's own worked example: rng [0.87, 0.5] on a fresh character
  // rolls d100 = 88 (rare), then d6 = 4 across six eligible roles -> ring ->
  // Ring of Protection.
  const roll: LootRoll = {
    source: "container",
    tierRoll: 88,
    tier: "rare",
    eligible: ["weapon", "outer", "crown", "ring", "amulet", "boots"],
    slotDie: 6,
    slotRoll: 4,
    item: { slot: "ring", tier: "rare" },
  };
  const readout = lootRollToReadout(roll, "Ring of Protection", "Aria, loot from the chest");
  assert.deepEqual(readout, {
    kind: "loot",
    caption: "Aria, loot from the chest",
    tierRoll: 88,
    tierWord: "Rare",
    slotDie: 6,
    slotRoll: 4,
    verdict: "Ring of Protection",
  });
});

test("lootRollToReadout: a tier hit with nothing left to find prints 'Nothing new', never the tier alone", () => {
  const roll: LootRoll = { source: "fight", tierRoll: 96, tier: "legendary", eligible: [], slotDie: 0, slotRoll: null, item: null };
  const readout = lootRollToReadout(roll, null, "Aria, loot from the fight");
  assert.equal(readout.tierWord, "Legendary");
  assert.equal(readout.verdict, "Nothing new");
});

test("lootRollToReadout: exactly one eligible role rolls no second die, and the readout carries slotDie 0", () => {
  const roll: LootRoll = {
    source: "container",
    tierRoll: 99,
    tier: "legendary",
    eligible: ["weapon"],
    slotDie: 0,
    slotRoll: null,
    item: { slot: "weapon", tier: "legendary" },
  };
  const readout = lootRollToReadout(roll, "Dawnbreaker", "Aria, loot from the chest");
  assert.equal(readout.slotDie, 0);
  assert.equal(readout.slotRoll, null);
  assert.equal(readout.verdict, "Dawnbreaker");
});

// ── terrain autotiling ────────────────────────────────────────────────────
//
// The half of the transition-tile fix that lives in code. Three blind art
// judges each named hard-cut terrain rectangles as the thing separating this
// exhibit from shipped work; scripts/assets/fantasy.ts draws the eight
// dithered variants per material pair, and terrainEdges.ts is what decides
// which one a given tile gets from its neighbours. These tests pin the two
// things that make it safe to run on every frame: it picks the geometrically
// correct variant, and it never touches the stored layout, because `walkable`
// and every validated world action still read the id the DM actually placed.

/** The real shipped manifest's membership test, so these run against real asset ids rather than a fixture that could drift from them. */
const fantasyHasAsset = (assetId: string) => FANTASY_SPRITES.some((s) => s.assetId === assetId);

/** The same, for the sci-fi template, whose two floor pairs now have drawn transitions too. */
const scifiHasAsset = (assetId: string) => SCIFI_SPRITES.some((s) => s.assetId === assetId);

/** A stone floor with a rectangular grass patch cut into it: rows y0..y1, columns x0..x1. */
function stoneWithGrassPatch(x0: number, x1: number, y0: number, y1: number, width = 5, height = 5): string[][] {
  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => (x >= x0 && x <= x1 && y >= y0 && y <= y1 ? "floor_grass" : "floor_stone")),
  );
}

test("edgeVariantFor maps one side to a straight edge and two adjacent sides to a corner", () => {
  assert.equal(edgeVariantFor(["n"]), "n");
  assert.equal(edgeVariantFor(["e"]), "e");
  assert.equal(edgeVariantFor(["n", "w"]), "nw");
  assert.equal(edgeVariantFor(["e", "s"]), "se");
});

test("edgeVariantFor names all sixteen orthogonal cases, not just the six with a hand-drawn tile", () => {
  // The old version returned undefined for ten of the sixteen, so a one-tile
  // isthmus, every three-sided peninsula and a one-tile island all fell back
  // to the hard cut this whole file exists to remove.
  assert.equal(edgeVariantFor(["n", "s"]), "ns"); // isthmus, under material north and south
  assert.equal(edgeVariantFor(["e", "w"]), "ew");
  assert.equal(edgeVariantFor(["n", "e", "s"]), "nes"); // peninsula, open only west
  assert.equal(edgeVariantFor(["e", "s", "w"]), "esw");
  assert.equal(edgeVariantFor(["s", "w", "n"]), "swn");
  assert.equal(edgeVariantFor(["w", "n", "e"]), "wne");
  assert.equal(edgeVariantFor(["n", "e", "s", "w"]), "nesw"); // a one-tile island

  // The empty set is the only case with no suffix, and it is the one the
  // inner-corner pass picks up instead.
  assert.equal(edgeVariantFor([]), undefined);
});

test("a grass patch cut into a stone floor gets its eight boundary tiles by neighbour", () => {
  // The exact case a judge described: "the grass and water patches are
  // razor-edged rectangles dropped on stone". A 3x3 patch has four corners,
  // four straight edges and one interior tile, and each has to land on the
  // right one of the eight sprites.
  //
  // The fixture is 7x7 rather than 5x5 now. On a 5x5 every surrounding cell
  // touches the patch either orthogonally or diagonally, so once the art lane
  // authored floor_stone_edge_grass_'s four inner corners there was no cell
  // left in the grid that a correct autotiler leaves alone, and the last
  // assertion below was checking that a notch went undrawn.
  const drawn = applyTerrainEdges(stoneWithGrassPatch(1, 3, 1, 3, 7, 7), fantasyHasAsset);

  assert.equal(drawn[1]![1], "floor_grass_edge_nw");
  assert.equal(drawn[1]![2], "floor_grass_edge_n");
  assert.equal(drawn[1]![3], "floor_grass_edge_ne");
  assert.equal(drawn[2]![1], "floor_grass_edge_w");
  assert.equal(drawn[2]![2], "floor_grass", "the patch's interior must stay the plain tile");
  assert.equal(drawn[2]![3], "floor_grass_edge_e");
  assert.equal(drawn[3]![1], "floor_grass_edge_sw");
  assert.equal(drawn[3]![2], "floor_grass_edge_s");
  assert.equal(drawn[3]![3], "floor_grass_edge_se");

  assert.equal(drawn[5]![5], "floor_stone", "stone two cells clear of the patch is not a boundary and must not change");
  // But stone diagonally off the patch's corner IS a boundary: it sits in the
  // notch, and the notch is the case the whole inner-corner pass exists for.
  assert.equal(drawn[0]![0], "floor_stone_edge_grass_ise", "grass on the south-east diagonal only");
});

test("a grass decal on the boundary picks an edge variant too", () => {
  // Decals are scattered at roughly one tile in ten, so without this one
  // boundary tile in ten keeps the hard cut and reads as a chip out of the
  // edge. floor_grass_tufted is the same material as floor_grass.
  const tiles = stoneWithGrassPatch(1, 3, 1, 3);
  tiles[1]![2] = "floor_grass_tufted";
  assert.equal(applyTerrainEdges(tiles, fantasyHasAsset)[1]![2], "floor_grass_edge_n");
});

test("water autotiles against stone AND against grass, preferring whichever boundary it can treat more of", () => {
  // Water meeting GRASS used to match no rule at all, which is why an outdoor
  // pond rendered as a bare blue rectangle. It was wired first to the eight
  // hand-placed shore_* tiles, which drew their bank as a dead-straight line
  // at a fixed column; the art lane's water_edge_grass_ set replaced them with
  // a full nineteen whose banks wander, and the shore tiles are retired.
  const tiles = [
    ["floor_stone", "floor_stone", "floor_stone"],
    ["floor_stone", "water", "water"],
    ["floor_grass", "floor_grass", "floor_grass"],
  ];
  const drawn = applyTerrainEdges(tiles, fantasyHasAsset);

  // Two boundaries meet on this cell and only one tile can be drawn, so the
  // candidate that treats TWO sides wins over the one that treats one.
  assert.equal(drawn[1]![1], "water_edge_nw", "stone above and to the west is two sides, grass below is one");
  // Here both candidates treat one side, so the rule order decides, and the
  // shoreline is the boundary the judges named as the loud failure.
  assert.equal(drawn[1]![2], "water_edge_grass_s", "grass below, drawn with the shoreline bank");
});

test("applyTerrainEdges never mutates the stored layout", () => {
  // Load-bearing: the substitution is display-only, so walkability, pathing
  // and every validated world action keep reading the id the DM placed. If
  // this ever mutated, the model's view of the board and the engine's would
  // drift apart.
  const tiles = stoneWithGrassPatch(1, 3, 1, 3);
  const before = JSON.stringify(tiles);
  applyTerrainEdges(tiles, fantasyHasAsset);
  assert.equal(JSON.stringify(tiles), before);
});

test("a manifest without the transition tiles degrades to the plain tile, not to a hole", () => {
  const drawn = applyTerrainEdges(stoneWithGrassPatch(1, 3, 1, 3), (id) => !id.includes("_edge_") && fantasyHasAsset(id));
  assert.equal(drawn[1]![1], "floor_grass");
  assert.equal(drawn[1]![2], "floor_grass");
});

// ── per-coordinate tile variants ──────────────────────────────────────────
//
// The other half of "our panels are 81 percent duplicate tiles and shipped
// 16-bit screens are far from it". Every authored variant of a base material
// (tufted grass, cracked flagstone, scuffed deckplate) was an id the DM had to
// CHOOSE to place, and it overwhelmingly placed one, so the variants never
// reached the screen at all. These tests pin the three properties that make
// scattering them at draw time safe: the choice is stable per coordinate, a
// variant the manifest lacks is skipped rather than drawn as a hole, and the
// stored layout is never touched.

/** A 20x15 field of one base id, the shape a real cell's floor actually is. */
function uniformField(id: string): string[][] {
  return Array.from({ length: 15 }, () => Array.from({ length: 20 }, () => id));
}

/** Share of a grid held by its single most common id, as a percentage. */
function topShare(tiles: readonly (readonly string[])[]): number {
  const counts = new Map<string, number>();
  let total = 0;
  for (const row of tiles) {
    for (const id of row) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
      total++;
    }
  }
  return (Math.max(...counts.values()) / total) * 100;
}

function distinctIds(tiles: readonly (readonly string[])[]): Set<string> {
  return new Set(tiles.flatMap((row) => [...row]));
}

/** Four registered variants of one base, the DONE-WHEN case. */
const FOUR: readonly VariantSet[] = [{ base: "t", variants: ["t", "t_a", "t_b", "t_c"] }];
const FOUR_PRESENT = (id: string) => ["t", "t_a", "t_b", "t_c"].includes(id);

test("a uniform field of one base id draws all four of its registered variants", () => {
  // Before this pass existed, this grid rendered as 300 copies of one sprite:
  // 100 percent duplicate. The target is at most 30 percent for the most
  // common variant.
  const drawn = applyTileVariants(uniformField("t"), FOUR_PRESENT, 0, FOUR);

  assert.deepEqual([...distinctIds(drawn)].sort(), ["t", "t_a", "t_b", "t_c"]);
  assert.ok(topShare(drawn) <= 30, `most common variant took ${topShare(drawn).toFixed(0)}% of the field, want 30% or less`);
});

test("a cell picks the same variant on every call, and an edit elsewhere does not reshuffle it", () => {
  // Load-bearing: an unstable choice makes the floor shimmer as the player
  // walks, and no two screenshots of the same room ever match. The choice is a
  // pure function of the coordinate, so it survives a re-render and it
  // survives the DM repainting an unrelated cell.
  const field = uniformField("t");
  const first = applyTileVariants(field, FOUR_PRESENT, 0, FOUR);
  const second = applyTileVariants(field, FOUR_PRESENT, 0, FOUR);
  assert.deepEqual(second, first);

  const edited = uniformField("t");
  edited[14]![19] = "something_else";
  const after = applyTileVariants(edited, FOUR_PRESENT, 0, FOUR);
  for (let y = 0; y < 14; y++) {
    assert.deepEqual(after[y], first[y], `row ${y} moved because a far corner changed`);
  }
});

test("applyTileVariants never mutates the stored layout", () => {
  // Same contract as the edge pass, for the same reason: `walkable`, pathing
  // and every validated world action read the id the DM placed, so a display
  // substitution that wrote back would drift the model's board from the
  // engine's.
  const field = uniformField("t");
  const before = JSON.stringify(field);
  applyTileVariants(field, FOUR_PRESENT, 0, FOUR);
  assert.equal(JSON.stringify(field), before);
});

test("a variant the manifest does not carry is skipped, never drawn as a hole", () => {
  // The whole reason VARIANT_SETS can name tiles the art lane is still drawing.
  const onlyBase = applyTileVariants(uniformField("t"), (id) => id === "t", 0, FOUR);
  assert.deepEqual([...distinctIds(onlyBase)], ["t"]);

  const twoOfFour = applyTileVariants(uniformField("t"), (id) => id === "t" || id === "t_b", 0, FOUR);
  assert.deepEqual([...distinctIds(twoOfFour)].sort(), ["t", "t_b"]);
});

test("a base with no registered variant at all keeps the id the DM placed", () => {
  const drawn = applyTileVariants(uniformField("t"), () => false, 0, FOUR);
  assert.deepEqual([...distinctIds(drawn)], ["t"]);
});

test("two cells of the same map get different fields from their seeds", () => {
  // Otherwise a corridor of identical rooms repeats one field pixel for pixel
  // and the scatter reads as wallpaper rather than as ground.
  const a = applyTileVariants(uniformField("t"), FOUR_PRESENT, 0, FOUR);
  const b = applyTileVariants(uniformField("t"), FOUR_PRESENT, 1, FOUR);
  assert.notDeepEqual(b, a);
  assert.ok(topShare(b) <= 30, "a seeded field is still evenly scattered");
});

test("tileVariantHash is stable, and spreads a 20x15 grid evenly over four buckets", () => {
  assert.equal(tileVariantHash(3, 4, 0), tileVariantHash(3, 4, 0));
  assert.notEqual(tileVariantHash(3, 4, 0), tileVariantHash(4, 3, 0));
  assert.notEqual(tileVariantHash(3, 4, 0), tileVariantHash(3, 4, 1));

  const buckets = [0, 0, 0, 0];
  for (let y = 0; y < 15; y++) {
    for (let x = 0; x < 20; x++) buckets[tileVariantHash(x, y, 0) % 4]!++;
  }
  for (const n of buckets) assert.ok(n >= 60 && n <= 90, `bucket held ${n} of 300, want a roughly even 75`);
});

test("listing a variant more than once weights it, which is how an accent stays rare", () => {
  // Rendered and looked at: `floor_grass_flowers` is four bright white clumps,
  // and one cell in three of it renders as static rather than as a meadow.
  // Repeating the field tiles is the weighting mechanism, and it needs no
  // special case in the picker.
  const weighted: readonly VariantSet[] = [
    { base: "t", variants: ["t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "t", "accent"] },
  ];
  const drawn = applyTileVariants(uniformField("t"), () => true, 0, weighted);
  const accents = drawn.flat().filter((id) => id === "accent").length;
  assert.ok(accents > 0 && accents < 60, `accent landed on ${accents} of 300 cells, want roughly 25`);
});

test("the shipped fantasy grass roster actually scatters, measured against the real manifest", () => {
  // The end-to-end number the orders are about: a real floor, real asset ids,
  // real membership test.
  const drawn = applyTileVariants(uniformField("floor_grass"), fantasyHasAsset, 0, VARIANT_SETS);
  assert.ok(distinctIds(drawn).size >= 3, "the shipped roster has three grass tiles and all three must appear");
  assert.ok(topShare(drawn) < 60, `most common grass tile took ${topShare(drawn).toFixed(0)}%, was 100% before this pass`);
});

test("the single-cell accessor and the grid pass agree, cell for cell", () => {
  // Two callers of one choice; if they ever disagreed, a caller asking "what
  // is drawn at (3,4)" would get a different answer from what is on screen.
  const drawn = applyTileVariants(uniformField("t"), FOUR_PRESENT, 3, FOUR);
  for (let y = 0; y < 15; y++) {
    for (let x = 0; x < 20; x++) {
      assert.equal(drawn[y]![x], variantAt(FOUR[0]!, x, y, FOUR_PRESENT, 3));
    }
  }
  assert.equal(variantAt(FOUR[0]!, 0, 0, () => false), undefined, "no variant present is no answer, not a crash");
});

test("every VARIANT_SETS entry lists its own base, so a set can never erase the id the DM placed", () => {
  for (const set of VARIANT_SETS) {
    assert.ok(set.variants.includes(set.base), `${set.base} is not among its own variants`);
  }
});

test("no VARIANT_SETS base is an edge id, so the variant pass can never eat an autotiled boundary", () => {
  // The guard the run order depends on. If a boundary tile were ever a variant
  // base, the pass would substitute a carefully chosen transition back into a
  // plain field tile.
  const prefixes = TERRAIN_EDGE_RULES.flatMap((r) =>
    [r.prefix, r.underPrefix].filter((p): p is string => p !== undefined),
  );
  for (const set of VARIANT_SETS) {
    for (const id of [set.base, ...set.variants]) {
      for (const prefix of prefixes) {
        assert.ok(!id.startsWith(prefix), `${id} collides with the edge prefix ${prefix}`);
      }
    }
  }
});

// ── the two passes together ───────────────────────────────────────────────

test("applyDisplayTiles scatters the interior and still autotiles the boundary", () => {
  // Order is a correctness property here: the variant picker runs first, so
  // the edge pass gets to overwrite its choices on boundary cells rather than
  // the other way round.
  const tiles = stoneWithGrassPatch(1, 3, 1, 3, 20, 15);
  const drawn = applyDisplayTiles(tiles, fantasyHasAsset);

  assert.equal(drawn[1]![1], "floor_grass_edge_nw", "a boundary cell must keep its transition, not a field variant");
  assert.equal(drawn[1]![2], "floor_grass_edge_n");
  assert.ok(distinctIds(drawn).size > 8, "the stone field around the patch must be scattered, not one repeated tile");
});

test("applyDisplayTiles never mutates the stored layout either", () => {
  const tiles = stoneWithGrassPatch(1, 3, 1, 3, 20, 15);
  const before = JSON.stringify(tiles);
  applyDisplayTiles(tiles, fantasyHasAsset);
  assert.equal(JSON.stringify(tiles), before);
});

// ── the completed autotiler ───────────────────────────────────────────────

/** A grid of `under`, with `over` painted onto the listed coordinates. */
function patch(over: string, under: string, cells: readonly (readonly [number, number])[], w = 7, h = 7): string[][] {
  const t = Array.from({ length: h }, () => Array.from({ length: w }, () => under));
  for (const [x, y] of cells) t[y]![x] = over;
  return t;
}

/** A manifest carrying every one of a prefix's 16 orthogonal cases plus its 4 inner corners. */
function fullSet(...prefixes: string[]) {
  const suffixes = [...EDGE_SUFFIX_BY_MASK.filter((s): s is string => s !== undefined), "inw", "ine", "isw", "ise"];
  const ids = new Set(prefixes.flatMap((p) => suffixes.map((s) => p + s)));
  return (id: string) => ids.has(id) || fantasyHasAsset(id);
}

/**
 * A manifest carrying ONLY the listed prefixes, and only their original eight
 * suffixes: four straights and four outer corners.
 *
 * The shipped roster used to be this by accident, which is what several tests
 * below leaned on to exercise the degradation ladder and the one-sided
 * boundary. The art lane now ships all nineteen suffixes for all ten fantasy
 * pairs, so an incomplete set has to be constructed on purpose. Doing that
 * keeps the property under test (a manifest poorer than the picker degrades
 * rather than breaks) instead of retiring it along with the art.
 */
function eightOf(...prefixes: string[]) {
  const ids = new Set(prefixes.flatMap((p) => ["n", "e", "s", "w", "ne", "nw", "se", "sw"].map((sfx) => p + sfx)));
  return (id: string) => ids.has(id) || (!id.includes("_edge_") && fantasyHasAsset(id));
}

test("EDGE_SUFFIX_BY_MASK covers all sixteen cases and names each one exactly once", () => {
  assert.equal(EDGE_SUFFIX_BY_MASK.length, 16);
  assert.equal(EDGE_SUFFIX_BY_MASK[0], undefined, "an interior cell has no boundary");
  const named = EDGE_SUFFIX_BY_MASK.slice(1);
  assert.equal(named.filter((s) => s !== undefined).length, 15, "every non-empty shape needs a name");
  assert.equal(new Set(named).size, 15, "two shapes must never share a sprite name");
});

test("edgeSideMask agrees with the suffix table in both directions", () => {
  const bits = ["n", "e", "s", "w"] as const;
  for (let mask = 1; mask < 16; mask++) {
    const sides = bits.filter((_, i) => mask & (1 << i));
    assert.equal(edgeSideMask(sides), mask);
    assert.equal(edgeVariantFor(sides), EDGE_SUFFIX_BY_MASK[mask]);
  }
});

test("a plateau's four sides resolve, and so do the four inner corners of the ground around it", () => {
  // A 3x3 stone plateau standing in grass. The grass cells ringing its sides
  // get straights, and the four grass cells diagonally off its corners get
  // INNER corners: they have no orthogonal stone neighbour at all, which is
  // exactly the case the old file computed nothing for.
  const tiles = patch("floor_stone", "floor_grass", [
    [2, 2], [3, 2], [4, 2],
    [2, 3], [3, 3], [4, 3],
    [2, 4], [3, 4], [4, 4],
  ]);
  const drawn = applyTerrainEdges(tiles, fullSet("floor_grass_edge_"));

  assert.equal(drawn[1]![3], "floor_grass_edge_s", "grass above the plateau, stone to its south");
  assert.equal(drawn[5]![3], "floor_grass_edge_n");
  assert.equal(drawn[3]![1], "floor_grass_edge_e");
  assert.equal(drawn[3]![5], "floor_grass_edge_w");

  assert.equal(drawn[1]![1], "floor_grass_edge_ise", "stone only on the south-east diagonal is an inner corner");
  assert.equal(drawn[1]![5], "floor_grass_edge_isw");
  assert.equal(drawn[5]![1], "floor_grass_edge_ine");
  assert.equal(drawn[5]![5], "floor_grass_edge_inw");

  assert.equal(drawn[0]![0], "floor_grass", "grass two cells away is not a boundary");
});

test("a one-tile-wide isthmus gets the opposite-sides tile instead of a hard cut", () => {
  // Water running out of a pond in a single-cell channel: under material on
  // both banks and none at the ends. The old file returned undefined here.
  const tiles = patch("water", "floor_grass", [[3, 1], [3, 2], [3, 3]]);
  assert.equal(applyTerrainEdges(tiles, fullSet("water_edge_grass_"))[2]![3], "water_edge_grass_ew");

  const across = patch("water", "floor_grass", [[1, 3], [2, 3], [3, 3]]);
  assert.equal(applyTerrainEdges(across, fullSet("water_edge_grass_"))[3]![2], "water_edge_grass_ns");
});

test("a one-tile island gets the four-sided tile, and a peninsula gets the three-sided one", () => {
  const island = patch("water", "floor_grass", [[3, 3]]);
  assert.equal(applyTerrainEdges(island, fullSet("water_edge_grass_"))[3]![3], "water_edge_grass_nesw");

  // A stub sticking south out of a bank: grass east, west and south of it.
  const peninsula = patch("water", "floor_grass", [[3, 2], [3, 3]]);
  assert.equal(applyTerrainEdges(peninsula, fullSet("water_edge_grass_"))[3]![3], "water_edge_grass_esw");
});

test("an L-shaped patch resolves every case along it, including the notch inside its crook", () => {
  // One shape that contains four of the cases the old file had no answer for:
  // a one-cell-wide arm is an isthmus, its tip is a three-sided peninsula, and
  // the stone diagonally outside the crook is an inner corner.
  const tiles = patch("floor_grass", "floor_stone", [
    [1, 1], [2, 1], [3, 1],
    [1, 2],
    [1, 3],
  ]);
  const drawn = applyTerrainEdges(tiles, fullSet("floor_grass_edge_", "floor_stone_edge_grass_"));

  assert.equal(drawn[1]![1], "floor_grass_edge_nw", "the elbow, stone above and to the west");
  assert.equal(drawn[1]![2], "floor_grass_edge_ns", "the arm is one cell wide: stone above AND below");
  assert.equal(drawn[1]![3], "floor_grass_edge_nes", "the arm's tip, open only to the west");
  assert.equal(drawn[2]![1], "floor_grass_edge_ew", "the leg is one cell wide too");
  assert.equal(drawn[3]![1], "floor_grass_edge_esw", "the leg's tip, open only to the north");

  assert.equal(drawn[2]![2], "floor_stone_edge_grass_nw", "the stone in the crook has grass above and west");
  assert.equal(drawn[2]![4], "floor_stone_edge_grass_inw", "stone touching grass on one diagonal only is the notch");
});

test("an inner corner is only reached when there is no orthogonal boundary at all", () => {
  const tiles = patch("floor_stone", "floor_grass", [[2, 2], [3, 4]]);
  const drawn = applyTerrainEdges(tiles, fullSet("floor_grass_edge_"));

  // (3,3) touches stone orthogonally to the south AND diagonally to the
  // north-west. The orthogonal read wins: a cell on an edge is never in a
  // notch, and drawing the notch there would put the boundary on the wrong
  // side of the tile.
  assert.equal(drawn[3]![3], "floor_grass_edge_s");

  // (1,1) touches stone on the south-east diagonal and nowhere else.
  assert.equal(drawn[1]![1], "floor_grass_edge_ise");
});

test("a cell in a saddle, with two diagonals and no orthogonal, still draws one of them", () => {
  // No single tile wraps inward around two corners at once, so the first in
  // n-w, n-e, s-w, s-e order is drawn: one correct notch reads better than a
  // bare rectangle with two.
  const tiles = patch("floor_stone", "floor_grass", [[2, 2], [2, 4]]);
  assert.equal(applyTerrainEdges(tiles, fullSet("floor_grass_edge_"))[3]![3], "floor_grass_edge_inw");
});

test("a shape with no exact tile degrades to the closest simpler one, never to a hard cut", () => {
  // The ladder that lets the sixteen-case system run against a manifest
  // carrying only the original eight. A one-tile island has no "nesw" sprite
  // in the shipped fantasy set, and drawing two of its four boundaries beats
  // drawing none.
  assert.deepEqual(edgeVariantCandidates(edgeSideMask(["n", "e", "s", "w"])).slice(0, 5), [
    "nesw", "nes", "wne", "swn", "esw",
  ]);
  assert.deepEqual(edgeVariantCandidates(edgeSideMask(["n", "e"])), ["ne", "n", "e"]);

  // Measured against a manifest carrying only the original eight suffixes.
  // The shipped fantasy roster used to BE that manifest, which is what this
  // assertion used to read against; it now ships all nineteen, so a one-tile
  // island gets its exact tile and the ladder has to be shown against a
  // deliberately poorer set instead. Both halves are asserted, because "the
  // exact tile when it exists" and "the best subset when it does not" are two
  // different promises.
  const island = patch("floor_grass", "floor_stone", [[3, 3]]);
  assert.equal(applyTerrainEdges(island, fantasyHasAsset)[3]![3], "floor_grass_edge_nesw", "the exact tile, now that it ships");
  assert.equal(applyTerrainEdges(island, eightOf("floor_grass_edge_"))[3]![3], "floor_grass_edge_ne", "two of four boundaries beats none");
});

test("both sides of a boundary are treated once both materials have an authored edge set", () => {
  // Symmetric evaluation. Only the `over` cell used to be examined, so grass
  // softening into stone left the stone side a bare rectangle, and a judge
  // said so: "one rectangle literally stops against another".
  const tiles = patch("floor_grass", "floor_stone", [
    [1, 1], [2, 1], [3, 1],
    [1, 2], [2, 2], [3, 2],
  ]);

  const drawn = applyTerrainEdges(tiles, fullSet("floor_grass_edge_", "floor_stone_edge_grass_"));
  assert.equal(drawn[2]![2], "floor_grass_edge_s", "the grass side softens downward into stone");
  assert.equal(drawn[3]![2], "floor_stone_edge_grass_n", "and the stone side softens upward into grass");

  // Without the under material's set the behaviour is exactly what it was.
  // fullSet used to give that for free, because floor_stone_edge_grass_ was
  // art nobody had drawn; all nineteen of it ship now, so the narrower
  // manifest is spelled out rather than assumed.
  const noStoneSet = (id: string) => !id.startsWith("floor_stone_edge_grass_") && fullSet("floor_grass_edge_")(id);
  const oneSided = applyTerrainEdges(tiles, noStoneSet);
  assert.equal(oneSided[3]![2], "floor_stone", "an unauthored under side keeps its plain tile");
});

test("a cell on two boundaries draws the one it can treat more of, in either direction", () => {
  // There is no tile for "stone to the west, grass to the north", so a choice
  // has to be made, and treating three sides beats treating one whichever rule
  // is listed first. Here the shoreline is the bigger boundary; in the
  // water-against-stone test above the stone corner was, and it won there.
  const tiles = [
    ["floor_grass", "floor_grass", "floor_grass"],
    ["floor_stone", "water", "floor_grass"],
    ["floor_stone", "floor_grass", "floor_grass"],
  ];
  // Grass on three sides is "nes", and the shipped water_edge_grass_ set now
  // carries it, so the three-sided boundary is drawn outright. Against the
  // eight-tile manifest this pair used to have, the same cell still resolves,
  // one rung down the ladder: never a hard cut either way.
  assert.equal(applyTerrainEdges(tiles, fantasyHasAsset)[1]![1], "water_edge_grass_nes");
  assert.equal(applyTerrainEdges(tiles, eightOf("water_edge_grass_"))[1]![1], "water_edge_grass_ne");
});

test("TERRAIN_EDGE_RULES carries the pairs an outdoor scene actually contains", () => {
  const pairs = TERRAIN_EDGE_RULES.map((r) => `${r.over[0]} over ${r.underAny ? "anything" : r.under[0]}`);
  assert.ok(TERRAIN_EDGE_RULES.length >= 4, "two rules covered neither water/grass nor anything but stone");
  assert.ok(pairs.includes("water over floor_grass"), "the pair every outdoor pond is made of");
  assert.ok(pairs.includes("floor_grass over floor_dirt"));
  assert.ok(pairs.includes("floor_grass over floor_sand"));
  // The cliff is spelled cliff_face: the art lane ships the shaded face and
  // the lit cap as two ids, and the rule covers both halves of the one
  // material. There was never a bare `cliff` sprite for the old name to hit.
  assert.ok(pairs.includes("cliff_face over anything"));
  // Pale grass over ordinary grass: the deliberately soft boundary.
  assert.ok(pairs.includes("floor_grass_pale over floor_grass"));
});

test("both sci-fi material pairs have a rule, now that both have a drawn set", () => {
  // This file used to record the decision that sci-fi needed no edge rules,
  // on the grounds that the hazard field's framing was fixed inside the tile.
  // That solved the framing half. The boundary half is what three judges named
  // ("the dot-grid floor patch is a rectangle that simply stops"), and the art
  // lane has now drawn nineteen variants for each pair, so the picker has to
  // ask for them.
  const prefixes = TERRAIN_EDGE_RULES.map((r) => r.prefix);
  assert.ok(prefixes.includes("deckplate_grating_edge_"), "a grating opening in the deck");
  assert.ok(prefixes.includes("deckplate_hazard_edge_"), "a hazard field painted on the deck");

  // And they resolve against the REAL sci-fi manifest, not a fixture.
  const patchTiles = patch("floor_grating", "floor_deckplate", [
    [2, 2], [3, 2], [4, 2],
    [2, 3], [3, 3], [4, 3],
  ]);
  const drawn = applyTerrainEdges(patchTiles, scifiHasAsset);
  assert.equal(drawn[2]![2], "deckplate_grating_edge_nw");
  assert.equal(drawn[2]![3], "deckplate_grating_edge_n");
  assert.equal(drawn[3]![4], "deckplate_grating_edge_se");
  assert.equal(drawn[1]![1], "floor_deckplate", "the deck has no transition of its own facing back, so it keeps its tile");

  const hazard = patch("hazard_vent", "floor_deckplate", [[3, 3]]);
  assert.equal(applyTerrainEdges(hazard, scifiHasAsset)[3]![3], "deckplate_hazard_edge_nesw", "a one-tile hazard patch is banked on all four sides");
});

test("a light pool counts as deckplate at a boundary", () => {
  // floor_deckplate_lit is not in the deck's VARIANT_SETS entry (a lamp pool
  // is placed, not scattered), so it would be invisible to the edge rules
  // unless the rule listed it. A grating opening that happens to fall under a
  // light has to soften into it rather than cut a rectangle out of the one
  // bright patch on the deck.
  const tiles = patch("floor_grating", "floor_deckplate", [[3, 3]]);
  tiles[2]![3] = "floor_deckplate_lit";
  assert.equal(applyTerrainEdges(tiles, scifiHasAsset)[3]![3], "deckplate_grating_edge_nesw");
});

test("a cliff softens into whatever is beside it, but never off the edge of the screen", () => {
  // `underAny`: a cliff's boundary is against its surroundings, not against
  // one named material. Out of bounds still counts as NOT the other material,
  // because the next cell over is a separate screen that may not be assembled.
  const tiles = patch("cliff_face", "floor_dirt", [[3, 3]]);
  assert.equal(applyTerrainEdges(tiles, fullSet("cliff_edge_"))[3]![3], "cliff_edge_nesw");

  const corner = patch("cliff_face", "floor_dirt", [[0, 0]]);
  assert.equal(applyTerrainEdges(corner, fullSet("cliff_edge_"))[0]![0], "cliff_edge_se", "no boundary off-screen");
});

test("water meeting grass autotiles a whole pond, which nothing placed before", () => {
  // The measured failure: an outdoor pond matched no rule, so it rendered as a
  // blue rectangle while the tiles drawn for exactly this boundary sat unused
  // because only the DM could place them.
  //
  // The set used to be the eight hand-placed shore_* tiles. They are retired:
  // shore_e drew water in columns 0 to 8, foam at 9 and grass from 11,
  // identical on every row, so a pond wearing them read as a rectangle with a
  // rim rather than as a shoreline. water_edge_grass_ goes through the art
  // lane's bite machinery, so its bank wanders, and it covers all nineteen
  // shapes rather than eight.
  const pond = patch("water", "floor_grass", [
    [2, 2], [3, 2], [4, 2],
    [2, 3], [3, 3], [4, 3],
    [2, 4], [3, 4], [4, 4],
  ]);
  const drawn = applyTerrainEdges(pond, fantasyHasAsset);
  assert.equal(drawn[2]![2], "water_edge_grass_nw");
  assert.equal(drawn[2]![3], "water_edge_grass_n");
  assert.equal(drawn[3]![4], "water_edge_grass_e");
  assert.equal(drawn[4]![4], "water_edge_grass_se");
  assert.equal(drawn[3]![3], "water", "the pond's interior stays open water");

  // And the grass ringing the pond gets ITS notches, which is the half that
  // makes a shoreline read as a shoreline rather than as a rimmed rectangle.
  assert.equal(drawn[1]![1], "floor_grass", "grass has no authored set facing water, so it keeps its tile");

  // Nothing in the shipped library answers to shore_ any more.
  assert.equal(drawn.flat().filter((id) => id.startsWith("shore_")).length, 0);
  assert.equal(FANTASY_SPRITES.filter((sp) => sp.assetId.startsWith("shore_")).length, 0, "the eight shore_* tiles are retired");
});

test("a newer authored set is preferred over a shipped fallback for the same pair", () => {
  // Two rules for one pair is how a replacement set lands without a flag day:
  // whichever the manifest carries is what gets drawn, so the art and the
  // picker can land in either order.
  //
  // The live example used to be water/grass, drawn first by the eight
  // hand-placed shore_* tiles and then by the art lane's water_edge_grass_.
  // That migration is finished and shore_* is deleted, so the mechanism is
  // exercised here on a synthetic pair rather than pinned to art that is gone.
  const rules: readonly TerrainEdgeRule[] = [
    { over: ["water"], under: ["floor_grass"], prefix: "new_set_" },
    { over: ["water"], under: ["floor_grass"], prefix: "old_set_" },
  ];
  const pond = patch("water", "floor_grass", [[3, 3], [3, 4]]);
  const both = (id: string) => id.startsWith("new_set_") || id.startsWith("old_set_");
  assert.equal(applyTerrainEdges(pond, both, rules)[3]![3], "new_set_wne", "the preferred set wins when it is present");

  const onlyOld = (id: string) => id.startsWith("old_set_");
  assert.equal(applyTerrainEdges(pond, onlyOld, rules)[3]![3], "old_set_wne", "and the fallback covers it when it is not");

  // A fallback carrying fewer shapes still answers, one rung down the ladder,
  // which is what made the shore_* migration safe in both directions.
  const oldEight = (id: string) => id.startsWith("old_set_") && !/_(nes|wne|swn|esw|nesw|ns|ew|inw|ine|isw|ise)$/.test(id);
  assert.equal(applyTerrainEdges(pond, oldEight, rules)[3]![3], "old_set_ne");
});

test("a rule whose tiles are entirely missing changes nothing at all", () => {
  // The stale-manifest guarantee: naming a set the art lane is still drawing,
  // or that an older seeded template predates, has to be free.
  //
  // grass-over-sand used to be the live example, because that set did not
  // exist. All ten fantasy pairs ship all nineteen suffixes now, so the case
  // is made with a rule whose prefix nothing carries, which is exactly the
  // shape of a manifest older than the art.
  const unshipped: readonly TerrainEdgeRule[] = [
    { over: ["floor_grass"], under: ["floor_sand"], prefix: "floor_grass_edge_marsh_" },
  ];
  const tiles = patch("floor_grass", "floor_sand", [[3, 3]]);
  assert.equal(applyTerrainEdges(tiles, fantasyHasAsset, unshipped)[3]![3], "floor_grass");

  // And an OLD manifest, carrying the materials but none of the transitions,
  // draws exactly what it drew before any of this existed.
  const noTransitions = (id: string) => !id.includes("_edge_") && fantasyHasAsset(id);
  const pond = patch("water", "floor_grass", [[3, 3]]);
  assert.equal(applyTerrainEdges(pond, noTransitions)[3]![3], "water");
});

test("the rules and the variant sets do not disagree about what a material is", () => {
  // A material listed in an edge rule must cover the same ids the variant
  // picker can produce for it, or one boundary tile in four keeps the hard cut
  // once the art lane's extra field tiles land.
  const ruleIds = new Set(TERRAIN_EDGE_RULES.flatMap((r) => [...r.over, ...r.under]));
  for (const set of VARIANT_SETS) {
    if (!ruleIds.has(set.base)) continue;
    for (const variant of set.variants) {
      assert.ok(ruleIds.has(variant), `${variant} is drawable for ${set.base} but no edge rule knows it is that material`);
    }
  }
});

test("a TerrainEdgeRule that names anything as its under material has no reverse direction", () => {
  // `underAny` and `underPrefix` cannot both mean something: "anything" has no
  // edge set of its own to face back with.
  for (const rule of TERRAIN_EDGE_RULES as readonly TerrainEdgeRule[]) {
    if (rule.underAny) assert.equal(rule.underPrefix, undefined, `${rule.prefix} claims both`);
  }
});

// ── layered, taller tokens ────────────────────────────────────────────────
//
// The measured problem, from a veteran 16-bit console artist comparing our
// work against real Final Fantasy art at matched scale: "Every token is
// exactly 16x16 and snapped to the grid. FF field sprites are roughly 16x24
// and stand at sub-tile offsets. A judge who knows the era sorts on this
// before looking at any craft."
//
// So a token is now as tall as its own pixel grid says it is, it stands with
// its feet on its tile and overhangs upward, and it is composited from a body
// plus up to three worn equipment layers. These tests pin the properties that
// make that safe to run every frame: the anchor is byte-identical for the
// hundreds of shipped 16x16 sprites, the overhang clips at the top of the
// canvas rather than relying on the canvas to swallow it, the layers land in
// the contract's z-order, and no palette remap can dissolve a silhouette.

import {
  firstVisibleSpriteRow,
  renderCell,
  spritePixelSize,
  tileOrigin,
  tokenDrawOrder,
  tokenOrigin,
  type RenderManifest,
} from "../src/games/livingtable/render/canvasRenderer";
import { spriteDimensions, TRANSPARENT } from "../src/games/livingtable/render/spritePixels";
import { compositeToken, remappedIndex } from "../src/games/livingtable/render/equipmentCompositor";
import { renderDoll, pedestalBands, PEDESTAL_INDEX_OUTER, PEDESTAL_INDEX_INNER } from "../src/games/livingtable/render/doll";
import { iconPlacement, renderGearIcon } from "../src/games/livingtable/render/gearIcon";
import {
  ARCHETYPE_IDS,
  bodySpriteId,
  DOLL_CANVAS_SIZE,
  DOLL_TOKEN_ORIGIN,
  EQUIPMENT_TIERS,
  equipmentSpriteId,
  GEAR_ICON_MAX_SCALE,
  GLOW_BANDS_BY_TIER,
  GLOW_INDEX_A,
  GLOW_INDEX_B,
  GLOW_MARGIN,
  GLOW_PULSES_BY_TIER,
  LAYER_BEHIND,
  LAYER_BODY,
  LAYER_FEET,
  LAYER_OVERBODY,
  LAYER_WEAPON,
  PEDESTAL,
  PROTECTED_PALETTE_INDICES,
  RECOLOUR_BY_TIER,
  SLOT_ROLES,
  SLOTS_BY_ARCHETYPE,
  TEMPLATE_OF_ARCHETYPE,
  tierArtVariant,
  TOKEN_HEIGHT,
  TOKEN_OVERHANG,
  TOKEN_WIDTH,
  type EquipmentLayer,
  type GearIconSource,
  type TokenRenderPlan,
} from "../src/games/livingtable/characters/equipmentTypes";
import { propVariantAt, PROP_VARIANT_SETS } from "../src/games/livingtable/render/tileVariants";
import type { CellLayout } from "../src/games/livingtable/world/cell";

/** One recorded fillRect. The renderer only ever sets fillStyle and calls fillRect, so this is the whole canvas surface it touches. */
interface RecordedFill {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

/**
 * A fake 2D context that records what was painted, in order.
 *
 * node has no real canvas, which is why canvasRenderer keeps its layout math
 * in ctx-free pure functions. But painter's ORDER and the top-of-canvas clip
 * are properties of the draw loop itself rather than of the math, so they need
 * a context to be tested at all, and a recorder is the honest minimum.
 */
function recordingCtx(): { ctx: CanvasRenderingContext2D; fills: RecordedFill[] } {
  const fills: RecordedFill[] = [];
  const fake = {
    fillStyle: "",
    fillRect(x: number, y: number, width: number, height: number) {
      fills.push({ x, y, width, height, color: fake.fillStyle });
    },
  };
  return { ctx: fake as unknown as CanvasRenderingContext2D, fills };
}

/** A pixel grid of one repeated index. */
function solid(index: number, width = 16, height = TOKEN_HEIGHT): number[][] {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => index));
}

/** A transparent grid with one opaque pixel, for reading a glow ring's shape off a known centre. */
function dot(index: number, at: { x: number; y: number }, width = 16, height = TOKEN_HEIGHT): number[][] {
  const grid = Array.from({ length: height }, () => Array.from({ length: width }, () => TRANSPARENT));
  grid[at.y]![at.x] = index;
  return grid;
}

/** A palette long enough to carry the four reserved glow entries, so a colour lookup never silently drops a pixel. */
const PALETTE_52 = Array.from({ length: 52 }, (_, i) => `#${i.toString(16).padStart(6, "0")}`);

function manifestWith(tokens: Record<string, number[][]>, props: Record<string, number[][]> = {}): RenderManifest {
  return {
    palette: PALETTE_52,
    tiles: {},
    props: Object.fromEntries(Object.entries(props).map(([id, pixels]) => [id, { pixels }])),
    tokens: Object.fromEntries(Object.entries(tokens).map(([id, pixels]) => [id, { pixels }])),
  };
}

function layoutWith(tokens: CellLayout["tokens"], props: CellLayout["props"] = []): CellLayout {
  return { tiles: [], props, tokens, exits: [] };
}

const lookupFrom = (manifest: RenderManifest) => (id: string) => manifest.tokens[id]?.pixels;

test("the pixel grid is the only authority on a sprite's dimensions", () => {
  // No new dimension field anywhere: a field that can disagree with the art is
  // a field that eventually will.
  assert.deepEqual(spriteDimensions(solid(1, 16, 16)), { width: 16, height: 16 });
  assert.deepEqual(spriteDimensions(solid(1, 16, 24)), { width: 16, height: 24 });
  assert.deepEqual(spriteDimensions([]), { width: 0, height: 0 });
});

test("a 16-tall sprite under the new anchor lands on exactly the pixels tileOrigin produces today", () => {
  // The equality the whole geometry change rests on: hundreds of shipped 16x16
  // tiles, props and monster tokens must draw byte-identically.
  for (const scale of [16, 32, 48]) {
    for (const tile of [{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 19, y: 14 }]) {
      assert.deepEqual(tokenOrigin(tile, 16, scale), tileOrigin(tile, scale), `height 16 moved at scale ${scale}`);
    }
  }
});

test("a taller token stands on its own tile and overhangs upward, never downward", () => {
  // Feet flush with the bottom of the tile: originY = (tile.y + 1) * scale - height * px.
  assert.deepEqual(tokenOrigin({ x: 2, y: 3 }, 24, 16), { x: 32, y: 40 });
  assert.deepEqual(tokenOrigin({ x: 2, y: 3 }, 24, 32), { x: 64, y: 80 });

  // The bottom row sits on the tile's own bottom edge at every scale and height.
  for (const scale of [16, 32]) {
    for (const height of [16, 20, 24]) {
      const origin = tokenOrigin({ x: 1, y: 5 }, height, scale);
      assert.equal(origin.y + height * spritePixelSize(scale), (5 + 1) * scale, `height ${height} at scale ${scale}`);
    }
  }
});

test("a 24-tall token on tile row 0 skips exactly its 8 overhanging source rows", () => {
  // The clip has to be arithmetic rather than "let the canvas swallow it", or
  // it is untestable under node and nobody ever finds out it regressed.
  assert.equal(TOKEN_OVERHANG, 8);
  assert.equal(firstVisibleSpriteRow(tokenOrigin({ x: 5, y: 0 }, 24, 16).y, 16), 8);
  assert.equal(firstVisibleSpriteRow(tokenOrigin({ x: 5, y: 0 }, 24, 32).y, 32), 8);
  assert.equal(firstVisibleSpriteRow(tokenOrigin({ x: 5, y: 1 }, 24, 16).y, 16), 0, "row 1 has a tile above to hang into");
  assert.equal(firstVisibleSpriteRow(tokenOrigin({ x: 5, y: 0 }, 16, 16).y, 16), 0, "a 16-tall token never overhangs");
});

test("renderCell paints nothing above the top of the canvas", () => {
  const manifest = manifestWith({ tall: solid(3, 16, 24) });
  const { ctx, fills } = recordingCtx();
  renderCell(ctx, layoutWith([{ id: "a", assetId: "tall", x: 4, y: 0, kind: "pc" }]), manifest, 16);

  assert.ok(fills.length > 0, "the token must still draw");
  for (const fill of fills) assert.ok(fill.y >= 0, `painted at y ${fill.y}, above the canvas`);
  assert.equal(fills.length, 16 * 16, "the 8 clipped rows are skipped, the 16 on-screen rows are drawn");
});

test("tokens paint in ascending y, stably, so a nearer token overlaps the one behind it", () => {
  // Harmless when nothing overlapped; a visible flicker now that a 24-tall
  // token reaches into the tile above it.
  const ordered = tokenDrawOrder([
    { id: "far", y: 2 },
    { id: "near", y: 7 },
    { id: "mid", y: 4 },
    { id: "far-too", y: 2 },
  ]);
  assert.deepEqual(ordered.map((t) => t.id), ["far", "far-too", "mid", "near"], "ties keep array order");

  const manifest = manifestWith({ a: solid(1, 16, 16), b: solid(2, 16, 16) });
  const { ctx, fills } = recordingCtx();
  renderCell(
    ctx,
    layoutWith([
      { id: "lower", assetId: "a", x: 0, y: 5, kind: "pc" },
      { id: "upper", assetId: "b", x: 0, y: 1, kind: "monster" },
    ]),
    manifest,
    16,
  );
  assert.equal(fills[0]!.color, PALETTE_52[2], "the token higher on screen is painted first");
});

// ── the equipment compositor ──────────────────────────────────────────────

const SHADOW_PLAN: TokenRenderPlan = {
  bodySpriteId: "token_shadow",
  layers: [
    { spriteId: "gear_shadow_outer_base", layer: 10, remap: null, glowBands: 0, glowPulses: false },
    { spriteId: "gear_shadow_weapon_base", layer: 40, remap: null, glowBands: 0, glowPulses: false },
    { spriteId: "gear_shadow_crown_base", layer: 50, remap: null, glowBands: 0, glowPulses: false },
  ],
};

const SHADOW_MANIFEST = manifestWith({
  token_shadow: solid(2),
  gear_shadow_outer_base: solid(3),
  gear_shadow_weapon_base: solid(4),
  gear_shadow_crown_base: solid(5),
});

test("a token composites with the body in the middle: cloak behind, weapon and hood in front", () => {
  // The z-order is DATA on the slot, never derived from role or list position,
  // which is what lets the Rogue's cloak sit behind her at 10 while the
  // Knight's shield sits in front of him at 35 though both are the outer role.
  const draws = compositeToken(SHADOW_PLAN, lookupFrom(SHADOW_MANIFEST));
  assert.deepEqual(draws.map((d) => d.pixels[0]![0]), [3, 2, 4, 5], "cloak, body, blade, hood");
  assert.equal(draws[1]!.remap, null, "the body is always drawn as authored");
});

test("a missing gear sprite skips its layer and draws everything else", () => {
  // A manifest gap has to read as a missing hat during play, never as a
  // crashed renderer, exactly as a missing tile id already skips a tile.
  const gapped = manifestWith({
    token_shadow: solid(2),
    gear_shadow_outer_base: solid(3),
    gear_shadow_crown_base: solid(5),
  });
  const draws = compositeToken(SHADOW_PLAN, lookupFrom(gapped));
  assert.deepEqual(draws.map((d) => d.pixels[0]![0]), [3, 2, 5]);

  assert.deepEqual(compositeToken(SHADOW_PLAN, () => undefined), [], "no body, nothing to draw");
});

test("a layer is drawn at the body's own origin, and a shorter one keeps its feet on the ground", () => {
  const mixed = manifestWith({ token_shadow: solid(2, 16, 24), gear_shadow_crown_base: solid(5, 16, 16) });
  const plan: TokenRenderPlan = { bodySpriteId: "token_shadow", layers: [SHADOW_PLAN.layers[2]!] };
  const draws = compositeToken(plan, lookupFrom(mixed));
  const hood = draws.find((d) => d.pixels[0]![0] === 5)!;
  assert.equal(hood.offsetX, 0);
  assert.equal(hood.offsetY, 8, "a 16-tall layer on a 24-tall body aligns at the feet, not at the head");
});

test("a palette remap recolours a gear layer and never the body", () => {
  const plan: TokenRenderPlan = {
    bodySpriteId: "token_shadow",
    layers: [{ ...SHADOW_PLAN.layers[0]!, remap: { 3: 31 } }],
  };
  const draws = compositeToken(plan, lookupFrom(SHADOW_MANIFEST));
  assert.deepEqual(draws.map((d) => d.remap), [{ 3: 31 }, null]);

  // And it reaches the canvas: the cloak paints palette[31], the body paints palette[2].
  const { ctx, fills } = recordingCtx();
  renderCell(
    ctx,
    layoutWith([{ id: "t", assetId: "token_shadow", x: 0, y: 5, kind: "pc" }]),
    SHADOW_MANIFEST,
    16,
    0,
    { t: plan },
  );
  assert.equal(fills[0]!.color, PALETTE_52[31], "the cloak is recoloured");
  assert.equal(fills[16 * 24]!.color, PALETTE_52[2], "the body is not");
});

test("a remap can never dissolve a silhouette, whichever end of it names a protected index", () => {
  // Enforced in the compositor as well as in a test over the shipped tables,
  // so even a hand-edited table cannot erase an outline in a running game.
  assert.deepEqual([...PROTECTED_PALETTE_INDICES], [0, 48, 49, 50, 51]);

  for (const protectedIndex of PROTECTED_PALETTE_INDICES) {
    assert.equal(remappedIndex(protectedIndex, { [protectedIndex]: 7 }), protectedIndex, "protected as a key");
    assert.equal(remappedIndex(8, { 8: protectedIndex }), 8, "protected as a value");
  }

  assert.equal(remappedIndex(TRANSPARENT, { 8: 31 }), TRANSPARENT, "transparency is never remapped");
  assert.equal(remappedIndex(7, { 8: 31 }), 7, "an index with no entry passes through unchanged");
  assert.equal(remappedIndex(8, { 8: 31 }), 31);
  assert.equal(remappedIndex(8, null), 8);
});

// ── the enchantment rim light ─────────────────────────────────────────────
//
// There is no alpha in an indexed-colour pipeline drawn as opaque rects, so
// what ships is what the era actually did: a rim light in reserved palette
// entries, drawn under everything, plus a two-frame palette cycle.
//
// IT USED TO BE A CLOSED RING, AND THAT WAS THE DEFECT A REVIEW MEASURED.
// Both bands were dilated from the whole silhouette of every glowing layer,
// including a cloak worn BEHIND the body, so a legendary Mage
// painted 175 ring pixels round a 139 pixel body and a rare Rogue 164 round
// 74: an unbroken hard-edged saturated oval, larger than the character, which
// at phone scale read as a gold letter O with a dark smear inside it. A closed
// halo round a walking figure is the "this unit is selected" cursor of the
// era, not an enchantment. The tests below pin the two rules that keep it a
// rim: only gear in FRONT of the body lights at all, and only the band pixels
// on the lit side of a shape survive.

/** Count of each palette index in a grid, transparency excluded. */
function indexCounts(pixels: readonly (readonly number[])[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const row of pixels) {
    for (const index of row) {
      if (index === TRANSPARENT) continue;
      counts.set(index, (counts.get(index) ?? 0) + 1);
    }
  }
  return counts;
}

/** Every non-transparent coordinate, for comparing one frame's mask against another's. */
function opaqueKeys(pixels: readonly (readonly number[])[]): Set<string> {
  const keys = new Set<string>();
  pixels.forEach((row, y) => row.forEach((index, x) => index !== TRANSPARENT && keys.add(x + "," + y)));
  return keys;
}

function glowPlan(glowBands: 0 | 1 | 2, glowPulses = false, layer: EquipmentLayer = LAYER_WEAPON): TokenRenderPlan {
  return {
    bodySpriteId: "token_shadow",
    layers: [{ spriteId: "gear_shadow_outer_base", layer, remap: null, glowBands, glowPulses }],
  };
}

const GLOW_MANIFEST = manifestWith({ token_shadow: solid(2), gear_shadow_outer_base: dot(3, { x: 8, y: 12 }) });

/** A filled rectangle inside an otherwise transparent token grid, for reading a rim's shape off four known edges. */
function block(index: number, left: number, top: number, width: number, height: number): number[][] {
  const grid = Array.from({ length: TOKEN_HEIGHT }, () => Array.from({ length: TOKEN_WIDTH }, () => TRANSPARENT));
  for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) grid[y]![x] = index;
  return grid;
}

test("gear worn behind the body never lights, because a rim grown from a body-sized silhouette is a selection cursor", () => {
  // The Rogue's cloak and the Psion's barrier field are full-figure shapes at
  // LAYER_BEHIND. Dilating one of those produced the closed oval round the
  // whole character that a review sorted on before looking at any craft.
  const behind = compositeToken(glowPlan(2, false, LAYER_BEHIND), lookupFrom(GLOW_MANIFEST));
  assert.equal(behind.length, 2, "a lit cloak at layer 10 draws itself and the body, and no ring at all");
  for (const draw of behind) assert.equal(draw.pixels[0]!.length, TOKEN_WIDTH, "no oversized draw means nothing was rastered");

  // The same piece held in the main hand, or worn over the torso, still lights.
  for (const layer of [LAYER_OVERBODY, LAYER_WEAPON] as const) {
    const front = compositeToken(glowPlan(2, false, layer), lookupFrom(GLOW_MANIFEST));
    assert.equal(front.length, 3, "layer " + layer + " should light");
    assert.equal(front[0]!.pixels[0]!.length, TOKEN_WIDTH + 2 * GLOW_MARGIN);
  }
});

test("a lit pixel throws light up and to the left, not all eight ways round itself", () => {
  // Common does not glow at all, which is exactly what makes an enchanted
  // piece read as enchanted.
  assert.equal(compositeToken(glowPlan(0), lookupFrom(GLOW_MANIFEST)).length, 2, "body and blade only");

  const one = compositeToken(glowPlan(1), lookupFrom(GLOW_MANIFEST));
  assert.equal(one.length, 3);
  const ring = one[0]!;
  assert.equal(ring.offsetX, -GLOW_MARGIN, "the rim is rastered on a grid inset on all four sides");
  assert.equal(ring.offsetY, -GLOW_MARGIN);
  assert.equal(ring.pixels.length, TOKEN_HEIGHT + 2 * GLOW_MARGIN);
  assert.equal(ring.pixels[0]!.length, TOKEN_WIDTH + 2 * GLOW_MARGIN);
  assert.deepEqual([...indexCounts(ring.pixels)], [[GLOW_INDEX_A[0], 2]], "two rim pixels, where a closed ring had eight");

  // The lone lit pixel is at sprite (8, 12); glow coordinates are sprite
  // coordinates shifted by GLOW_MARGIN.
  assert.equal(ring.pixels[12 + GLOW_MARGIN]![7 + GLOW_MARGIN], GLOW_INDEX_A[0], "lit from the left");
  assert.equal(ring.pixels[11 + GLOW_MARGIN]![8 + GLOW_MARGIN], GLOW_INDEX_A[0], "lit from above");
  assert.equal(ring.pixels[13 + GLOW_MARGIN]![8 + GLOW_MARGIN], TRANSPARENT, "dark below");
  assert.equal(ring.pixels[12 + GLOW_MARGIN]![9 + GLOW_MARGIN], TRANSPARENT, "dark to the right");

  const two = compositeToken(glowPlan(2), lookupFrom(GLOW_MANIFEST))[0]!;
  const counts = indexCounts(two.pixels);
  assert.equal(counts.get(GLOW_INDEX_A[0]), 2, "band 1 is the lit side at Chebyshev distance 1");
  assert.equal(counts.get(GLOW_INDEX_A[1]), 6, "band 2 runs parallel to it, where a closed ring had sixteen");
});

test("the rim lights the top and the left of a piece and leaves its bottom and its right dark", () => {
  // The property that stops the light enclosing the figure, stated on a shape
  // with four unambiguous edges: a 4x4 block at sprite x 4..7, y 10..13.
  const manifest = manifestWith({ token_shadow: solid(2), gear: block(3, 4, 10, 4, 4) });
  const plan: TokenRenderPlan = {
    bodySpriteId: "token_shadow",
    layers: [{ spriteId: "gear", layer: LAYER_WEAPON, remap: null, glowBands: 2, glowPulses: false }],
  };
  const ring = compositeToken(plan, lookupFrom(manifest))[0]!;
  const at = (x: number, y: number) => ring.pixels[y + GLOW_MARGIN]![x + GLOW_MARGIN];

  assert.equal(at(5, 9), GLOW_INDEX_A[0], "band 1 along the top face");
  assert.equal(at(3, 11), GLOW_INDEX_A[0], "band 1 along the left face");
  assert.equal(at(5, 8), GLOW_INDEX_A[1], "band 2 parallel above it");
  assert.equal(at(2, 11), GLOW_INDEX_A[1], "band 2 parallel to its left");

  for (let x = 4; x <= 7; x++) {
    assert.equal(at(x, 14), TRANSPARENT, "light under the block at column " + x);
    assert.equal(at(x, 15), TRANSPARENT, "light two under the block at column " + x);
  }
  for (let y = 10; y <= 13; y++) {
    assert.equal(at(8, y), TRANSPARENT, "light right of the block at row " + y);
    assert.equal(at(9, y), TRANSPARENT, "light two right of the block at row " + y);
  }

  // And structurally, for any art at all: the light comes from the upper left,
  // so the far side of the raster is unreachable. A band-2 pixel can just get
  // into the second-to-last row under a shape that runs to the sprite's own
  // bottom edge, but the outermost row and the outermost column cannot be lit
  // by any sprite, which is only true while the rim stays open.
  const h = ring.pixels.length;
  const w = ring.pixels[0]!.length;
  for (const grid of [ring.pixels, compositeToken(glowPlan(2), lookupFrom(GLOW_MANIFEST))[0]!.pixels]) {
    for (let y = 0; y < h; y++) {
      assert.equal(grid[y]![w - 1], TRANSPARENT, "the last column is lit at row " + y);
    }
    for (let x = 0; x < w; x++) {
      assert.equal(grid[h - 1]![x], TRANSPARENT, "the last row is lit at column " + x);
    }
  }
});

test("the enchantment never out-paints the character wearing it, measured on the shipped art", () => {
  // The bound the review asked for, against every archetype at every tier
  // rather than against a fixture: visible glow in the finished composite may
  // never exceed 40 percent of the body sprite's own opaque pixels. Before the
  // rim landed this ran from 90 to 178 percent, which is a halo with a
  // character inside it rather than a character with a lit sword.
  const art = new Map([...FANTASY_SPRITES, ...SCIFI_SPRITES].map((s) => [s.assetId, s.pixels]));
  const lookup = (id: string) => art.get(id);
  const gh = TOKEN_HEIGHT + 2 * GLOW_MARGIN;
  const gw = TOKEN_WIDTH + 2 * GLOW_MARGIN;

  for (const archetypeId of ARCHETYPE_IDS) {
    const template = TEMPLATE_OF_ARCHETYPE[archetypeId];
    const body = art.get(bodySpriteId(archetypeId))!;
    const bodyOpaque = body.flat().filter((index) => index >= 0).length;

    for (const tier of EQUIPMENT_TIERS) {
      const plan: TokenRenderPlan = {
        bodySpriteId: bodySpriteId(archetypeId),
        layers: SLOT_ROLES.map((role) => ({
          spriteId: equipmentSpriteId(archetypeId, role, tierArtVariant(tier)),
          layer: SLOTS_BY_ARCHETYPE[archetypeId][role].layer,
          remap: RECOLOUR_BY_TIER[template][tier],
          glowBands: GLOW_BANDS_BY_TIER[tier],
          glowPulses: GLOW_PULSES_BY_TIER[tier],
        })).sort((a, b) => a.layer - b.layer),
      };

      // Paint every draw in order onto one grid, recording which draw owns each
      // final pixel. That is what a player sees: the rim is drawn first and
      // most of it is covered by the figure standing on it.
      const owner = Array.from({ length: gh }, () => new Array<number>(gw).fill(-1));
      const draws = compositeToken(plan, lookup);
      draws.forEach((draw, i) => {
        draw.pixels.forEach((row, sy) =>
          row.forEach((index, sx) => {
            if (remappedIndex(index, draw.remap) < 0) return;
            const y = sy + draw.offsetY + GLOW_MARGIN;
            const x = sx + draw.offsetX + GLOW_MARGIN;
            if (y < 0 || y >= gh || x < 0 || x >= gw) return;
            owner[y]![x] = i;
          }),
        );
      });

      const ringIndex = draws.findIndex((d) => d.offsetX === -GLOW_MARGIN);
      const visible = ringIndex < 0 ? 0 : owner.flat().filter((i) => i === ringIndex).length;

      // The light comes from the upper left on every one of them, so the far
      // row and the far column of the raster are unreachable. A closed ring
      // filled both.
      if (ringIndex >= 0) {
        const rim = draws[ringIndex]!.pixels;
        const where = archetypeId + " " + tier;
        for (const row of rim) assert.equal(row[gw - 1], TRANSPARENT, where + " lights the last column");
        for (const index of rim[gh - 1]!) assert.equal(index, TRANSPARENT, where + " lights the last row");
      }

      assert.ok(
        visible <= bodyOpaque * 0.4,
        archetypeId + " " + tier + ": " + visible + " visible glow pixels against a " + bodyOpaque + " pixel body",
      );
      if (tier === "common") assert.equal(visible, 0, "common does not glow, which is what makes uncommon read as magic");
    }
  }
});

test("the rim draws under everything, so nothing has to be subtracted against the body", () => {
  const draws = compositeToken(glowPlan(2), lookupFrom(GLOW_MANIFEST));
  assert.equal(draws[0]!.pixels[0]!.length, TOKEN_WIDTH + 2 * GLOW_MARGIN, "the rim is first, and it is the only oversized draw");
  assert.deepEqual(draws.slice(1).map((d) => d.pixels[0]![0]), [2, TRANSPARENT], "body then blade, both over the rim");
});

test("the pulse reverses the rim's own gradient rather than blinking the whole ring dim", () => {
  // The FRAMES are in scope, the loop is not: the compositor takes frame 0 or
  // 1 and picks a pair of indices. Nobody has to own an animation loop to ship.
  //
  // What it must NOT do is drop both bands to a dimmer pair at once. That is
  // one flat ring changing colour, and in a still frame, which is what this
  // canvas draws, it is indistinguishable from no animation at all. Swapping
  // the two band indices moves the bright one outward and the dim one inward:
  // a two-pixel gradient reversing, which is what a 16-bit palette cycle was.
  const bright = compositeToken(glowPlan(2, true), lookupFrom(GLOW_MANIFEST), 0)[0]!;
  const cycled = compositeToken(glowPlan(2, true), lookupFrom(GLOW_MANIFEST), 1)[0]!;

  assert.deepEqual(opaqueKeys(bright.pixels), opaqueKeys(cycled.pixels), "the mask is fixed; only the palette moves");

  const b = indexCounts(bright.pixels);
  const c = indexCounts(cycled.pixels);
  assert.equal(b.get(GLOW_INDEX_A[0]), 2, "frame 0 puts the near index on band 1");
  assert.equal(b.get(GLOW_INDEX_A[1]), 6);
  assert.equal(c.get(GLOW_INDEX_A[1]), 2, "frame 1 swaps them, so the gradient runs the other way");
  assert.equal(c.get(GLOW_INDEX_A[0]), 6);

  for (const index of GLOW_INDEX_B) {
    assert.equal(c.get(index), undefined, "frame 1 blinked the whole rim to the dim index " + index);
  }

  const steady = compositeToken(glowPlan(2, false), lookupFrom(GLOW_MANIFEST), 1)[0]!;
  assert.deepEqual([...indexCounts(steady.pixels)], [...b], "a rare piece does not cycle, whatever the frame");
});

test("two lit layers union band by band, and band 1 wins where they overlap", () => {
  // Set one pixel up and to the right of the other, so band 1 of the higher
  // one lands on band 2 of the lower one. The index nearest the metal has to
  // win or the rim reads as a hole punched in itself.
  const manifest = manifestWith({
    token_shadow: solid(2),
    a: dot(3, { x: 4, y: 12 }),
    b: dot(4, { x: 5, y: 11 }),
  });
  const plan: TokenRenderPlan = {
    bodySpriteId: "token_shadow",
    layers: [
      { spriteId: "a", layer: LAYER_OVERBODY, remap: null, glowBands: 2, glowPulses: false },
      { spriteId: "b", layer: LAYER_WEAPON, remap: null, glowBands: 2, glowPulses: false },
    ],
  };
  const ring = compositeToken(plan, lookupFrom(manifest))[0]!;
  // Glow-grid coordinates are sprite coordinates shifted by GLOW_MARGIN.
  assert.equal(ring.pixels[10 + GLOW_MARGIN]![5 + GLOW_MARGIN], GLOW_INDEX_A[0], "band 1 of b beats band 2 of a");
  assert.equal(ring.pixels[13 + GLOW_MARGIN]![2 + GLOW_MARGIN], GLOW_INDEX_A[1], "band 2 of a, out of b's reach");
});

test("a rim reaches into the tile above and is clipped at the top of the canvas, never painted off it", () => {
  // The light comes from the upper left, so the rim leaves the sprite's box
  // upward and leftward. Upward is the direction that can run off the canvas,
  // and the clip is arithmetic rather than something the canvas swallows.
  const manifest = manifestWith({ token_shadow: solid(2), gear: dot(3, { x: 8, y: 0 }) });
  const plan: TokenRenderPlan = {
    bodySpriteId: "token_shadow",
    layers: [{ spriteId: "gear", layer: LAYER_WEAPON, remap: null, glowBands: 2, glowPulses: false }],
  };
  const { ctx, fills } = recordingCtx();
  renderCell(ctx, layoutWith([{ id: "t", assetId: "token_shadow", x: 3, y: 2, kind: "pc" }]), manifest, 16, 0, { t: plan });
  for (const fill of fills) assert.ok(fill.y >= 0, "glow painted at y " + fill.y);
  assert.ok(fills.some((f) => f.color === PALETTE_52[GLOW_INDEX_A[0]]), "some of the rim is on screen");

  // On the top row the rim's own overhang is clipped along with the token's.
  const clipped = recordingCtx();
  renderCell(clipped.ctx, layoutWith([{ id: "t", assetId: "token_shadow", x: 3, y: 0, kind: "pc" }]), manifest, 16, 0, { t: plan });
  for (const fill of clipped.fills) assert.ok(fill.y >= 0, "glow painted at y " + fill.y + " on the top row");
});


test("a token whose plan disagrees with its own assetId draws body-only from the token", () => {
  // The layout is what the DM and the persisted cell agree on; a plan is built
  // from the character sheet, which the model never touches. When they
  // disagree the token wins, because it is the thing that was validated.
  const { ctx, fills } = recordingCtx();
  renderCell(
    ctx,
    layoutWith([{ id: "t", assetId: "token_shadow", x: 0, y: 5, kind: "pc" }]),
    SHADOW_MANIFEST,
    16,
    0,
    { t: { ...SHADOW_PLAN, bodySpriteId: "token_knight" } },
  );
  assert.equal(new Set(fills.map((f) => f.color)).size, 1, "one sprite, one colour: no gear was drawn");
  assert.equal(fills[0]!.color, PALETTE_52[2]);
});

test("a token with no plan at all draws exactly what it drew before equipment existed", () => {
  const { ctx, fills } = recordingCtx();
  renderCell(ctx, layoutWith([{ id: "t", assetId: "token_shadow", x: 2, y: 5, kind: "pc" }]), SHADOW_MANIFEST, 16);
  assert.equal(fills.length, 16 * 24);
  assert.equal(new Set(fills.map((f) => f.color)).size, 1);
});

// ── contract v2: the boots layer's z-order ─────────────────────────────────
//
// LAYER_FEET (25) is the one value contract v2 adds to EquipmentLayer. Its
// whole correctness story is where it lands relative to the body and to
// LAYER_OVERBODY: above the body (25 >= LAYER_BODY, so a boots overlay
// replaces the body's own drawn feet rather than being painted under them),
// below LAYER_OVERBODY (30, so a robe hem or a plate skirt falls over the
// boot tops). equipmentCompositor.ts needed no code change for this at all:
// it already sorts every layer by its own `layer` integer and splits strictly
// on `layer >= LAYER_BODY`, so a fifth z-order band drops straight into the
// existing ascending sort. This test is what proves that claim rather than
// just asserting it.

test("boots (LAYER_FEET) sort above the body and below the overbody layer, with no code change needed to place it", () => {
  assert.equal(LAYER_FEET, 25, "the one new EquipmentLayer value contract v2 adds");
  assert.ok(LAYER_FEET > LAYER_BODY && LAYER_FEET < LAYER_OVERBODY, "strictly between the body and the overbody band");

  const manifest = manifestWith({
    token_knight: solid(1),
    cloak: solid(2), // LAYER_BEHIND, 10
    boots: solid(3), // LAYER_FEET, 25
    plate: solid(4), // LAYER_OVERBODY, 30
    sword: solid(5), // LAYER_WEAPON, 40
  });
  const plan: TokenRenderPlan = {
    bodySpriteId: "token_knight",
    layers: [
      // Listed out of order on purpose: the sort is what puts them right, not
      // the order they were built in.
      { spriteId: "sword", layer: LAYER_WEAPON, remap: null, glowBands: 0, glowPulses: false },
      { spriteId: "boots", layer: LAYER_FEET, remap: null, glowBands: 0, glowPulses: false },
      { spriteId: "cloak", layer: LAYER_BEHIND, remap: null, glowBands: 0, glowPulses: false },
      { spriteId: "plate", layer: LAYER_OVERBODY, remap: null, glowBands: 0, glowPulses: false },
    ],
  };
  const draws = compositeToken(plan, lookupFrom(manifest));
  assert.deepEqual(
    draws.map((d) => d.pixels[0]![0]),
    [2, 1, 3, 4, 5],
    "cloak behind, then the body, then boots, plate and sword ascending in front",
  );
});

test("boots also catch the enchantment rim, because LAYER_FEET is >= LAYER_BODY like every other front-worn piece", () => {
  const manifest = manifestWith({ token_knight: solid(1), boots: solid(3) });
  const plan: TokenRenderPlan = {
    bodySpriteId: "token_knight",
    layers: [{ spriteId: "boots", layer: LAYER_FEET, remap: null, glowBands: 2, glowPulses: false }],
  };
  const draws = compositeToken(plan, lookupFrom(manifest));
  // Three draws (glow ring, body, boots), not two: a glow ring is only ever
  // produced for a layer at or in front of the body (equipmentCompositor.ts's
  // own `layer.layer >= LAYER_BODY` filter), so its presence here is the
  // signal that LAYER_FEET landed on the "front" side of that filter.
  assert.equal(draws.length, 3, "glow ring, body, boots -- the same three-draw shape a front-worn v1 piece produces");
  // One column left of the solid boots block's own left edge, on a row inside
  // it: its right neighbour is occupied, so the "upper-left light source"
  // rule (see equipmentCompositor.ts's lowerRightRim) lights it.
  assert.equal(draws[0]!.pixels[GLOW_MARGIN + 5]![GLOW_MARGIN - 1], GLOW_INDEX_A[0], "the rim actually lit a real pixel, not an all-transparent grid");
});

// ── contract v2: the doll ───────────────────────────────────────────────────
//
// render/doll.ts rasterises the STAGED token onto a pixel pedestal for the
// inventory screen: the pedestal is procedural (a raster ellipse, code, not a
// shipped sprite -- see doll.ts's own header for why), drawn first so the
// pedestalBands() drives BOTH this test and the paint loop, so there is
// exactly one place the ellipse math lives.

test("pedestalBands matches the pinned formula: rows 25..30, columns 4..27, a two-pixel ring with a transparent interior", () => {
  assert.deepEqual(PEDESTAL, { cx: 16, cy: 28, rx: 12, ry: 3 });
  const { band1, band2 } = pedestalBands();
  assert.equal(band1.length, DOLL_CANVAS_SIZE);
  assert.equal(band1[0]!.length, DOLL_CANVAS_SIZE);

  const inside = (mask: boolean[][], y: number, x: number) => mask[y]?.[x] === true;
  let minY = 999, maxY = -999, minX = 999, maxX = -999;
  for (let y = 0; y < DOLL_CANVAS_SIZE; y++) {
    for (let x = 0; x < DOLL_CANVAS_SIZE; x++) {
      if (inside(band1, y, x) || inside(band2, y, x)) {
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }
  }
  assert.deepEqual({ minY, maxY, minX, maxX }, { minY: 25, maxY: 30, minX: 4, maxX: 27 });

  // No pixel is ever in both bands, and the pedestal's own centre stays
  // transparent (a ring, not a filled disc).
  for (let y = 0; y < DOLL_CANVAS_SIZE; y++) {
    for (let x = 0; x < DOLL_CANVAS_SIZE; x++) {
      assert.ok(!(inside(band1, y, x) && inside(band2, y, x)), `(${x},${y}) in both bands`);
    }
  }
  assert.equal(band1[27]![16], false, "the centre row is interior, not band 1");
  assert.equal(band2[27]![16], false, "the centre row is interior, not band 2 either");
});

test("renderDoll paints the pedestal alone when there is nothing to wear yet", () => {
  const manifest = manifestWith({});
  const { ctx, fills } = recordingCtx();
  renderDoll(ctx, null, manifest, 6);

  const { band1, band2 } = pedestalBands();
  const band1Count = band1.flat().filter(Boolean).length;
  const band2Count = band2.flat().filter(Boolean).length;
  assert.equal(fills.length, band1Count + band2Count);
  assert.ok(fills.every((f) => f.width === 6 && f.height === 6), "every cell paints at the given scale");
  assert.ok(fills.some((f) => f.color === PALETTE_52[PEDESTAL_INDEX_OUTER]));
  assert.ok(fills.some((f) => f.color === PALETTE_52[PEDESTAL_INDEX_INNER]));
});

// Close-out finding (major, render lane): the pedestal used to be painted
// from GLOW_INDEX_A, the exact entries a worn item's own enchantment ring
// uses, so a rare or legendary piece's rim ran straight into the pedestal as
// one gold shape and the doll could not tell rare from legendary. The fix
// paints the pedestal from a template-neutral structural ramp instead
// (index 24..27, shared by fantasy.ts and scifi.ts) and never from the
// reserved glow band.
test("the pedestal never borrows the enchantment ring's own palette entries, at any tier", () => {
  const manifest = manifestWith({ token_knight: solid(2, 16, 24) });
  for (const tier of EQUIPMENT_TIERS) {
    const remap = RECOLOUR_BY_TIER.fantasy[tier];
    const plan: TokenRenderPlan = {
      bodySpriteId: "token_knight",
      layers: [{ spriteId: "gear_knight_weapon_base", layer: LAYER_WEAPON, remap, glowBands: GLOW_BANDS_BY_TIER[tier], glowPulses: GLOW_PULSES_BY_TIER[tier] }],
    };
    const manifestWithWeapon = manifestWith({ token_knight: solid(2, 16, 24), gear_knight_weapon_base: solid(8, 5, 16) });
    const { ctx, fills } = recordingCtx();
    renderDoll(ctx, plan, manifestWithWeapon, 6);
    const { band1, band2 } = pedestalBands();
    const pedestalCount = band1.flat().filter(Boolean).length + band2.flat().filter(Boolean).length;
    for (const fill of fills.slice(0, pedestalCount)) {
      assert.notEqual(fill.color, PALETTE_52[GLOW_INDEX_A[0]], `${tier}: pedestal cell painted the bright glow's band-1 colour`);
      assert.notEqual(fill.color, PALETTE_52[GLOW_INDEX_A[1]], `${tier}: pedestal cell painted the bright glow's band-2 colour`);
      assert.notEqual(fill.color, PALETTE_52[GLOW_INDEX_B[0]], `${tier}: pedestal cell painted the dim glow's band-1 colour`);
      assert.notEqual(fill.color, PALETTE_52[GLOW_INDEX_B[1]], `${tier}: pedestal cell painted the dim glow's band-2 colour`);
    }
  }
});

// The compositor's own pulse mechanism (equipmentTypes.ts's "FRAMES are in
// scope, the LOOP is not") was unreachable from the doll: renderDoll always
// called compositeToken with a hardcoded 0. `frame` now threads through, so
// a caller that later flips it can make a legendary glow ring pulse on the
// doll the same way it already can on the board; the pedestal's own colour
// is untouched by it (it never pulses, per the pinned pedestal formula).
test("renderDoll forwards its frame argument to the token's own glow, leaving the pedestal untouched", () => {
  const manifest = manifestWith({ token_knight: solid(2, 16, 24), gear_knight_weapon_legendary: solid(8, 5, 16) });
  const plan: TokenRenderPlan = {
    bodySpriteId: "token_knight",
    layers: [{ spriteId: "gear_knight_weapon_legendary", layer: LAYER_WEAPON, remap: null, glowBands: 2, glowPulses: true }],
  };
  const { ctx: ctxA, fills: fillsA } = recordingCtx();
  renderDoll(ctxA, plan, manifest, 6); // frame omitted -> 0
  const { ctx: ctxB, fills: fillsB } = recordingCtx();
  renderDoll(ctxB, plan, manifest, 6, 1);

  const { band1, band2 } = pedestalBands();
  const pedestalCount = band1.flat().filter(Boolean).length + band2.flat().filter(Boolean).length;
  assert.deepEqual(fillsA.slice(0, pedestalCount), fillsB.slice(0, pedestalCount), "the pedestal itself does not change with frame");

  // The pulse swaps which of GLOW_INDEX_A's two entries band 1 vs band 2
  // gets (equipmentCompositor.ts's own `cycled` pair), so the SET of colours
  // used is the same at both frames; what must differ is which pixel gets
  // which one. Comparing the full ordered fill list catches that.
  const tokenFillsA = fillsA.slice(pedestalCount);
  const tokenFillsB = fillsB.slice(pedestalCount);
  assert.ok(tokenFillsA.length > 0, "frame 0 still drew the token and its glow ring");
  assert.equal(tokenFillsA.length, tokenFillsB.length, "flipping frame draws the same number of pixels");
  assert.notDeepEqual(tokenFillsA, tokenFillsB, "flipping frame changed at least one glow pixel's colour");
});

test("renderDoll draws the pedestal alone when the plan's own body sprite is missing, never a crash", () => {
  const manifest = manifestWith({}); // no "token_knight" in this manifest
  const plan: TokenRenderPlan = { bodySpriteId: "token_knight", layers: [] };
  const { ctx, fills } = recordingCtx();
  renderDoll(ctx, plan, manifest, 6);

  const { band1, band2 } = pedestalBands();
  assert.equal(fills.length, band1.flat().filter(Boolean).length + band2.flat().filter(Boolean).length, "pedestal only, no crash");
});

test("renderDoll draws the pedestal first, then the staged token at DOLL_TOKEN_ORIGIN, at the given scale", () => {
  const { ctx, fills } = recordingCtx();
  const scale = 6;
  renderDoll(ctx, SHADOW_PLAN, SHADOW_MANIFEST, scale);

  const { band1, band2 } = pedestalBands();
  const pedestalCount = band1.flat().filter(Boolean).length + band2.flat().filter(Boolean).length;
  // The pedestal is painted first; the compositor's own body/cloak/weapon/hood
  // draws follow it, each with the pedestal's cell size.
  assert.ok(fills.length > pedestalCount, "the token drew something too");
  for (const fill of fills.slice(0, pedestalCount)) {
    assert.ok(fill.color === PALETTE_52[PEDESTAL_INDEX_OUTER] || fill.color === PALETTE_52[PEDESTAL_INDEX_INNER], "pedestal cells come first");
  }
  const tokenFills = fills.slice(pedestalCount);
  assert.ok(tokenFills.some((f) => f.color === PALETTE_52[2]), "the body itself painted");
  // The body's own top-left source pixel (0,0) lands at DOLL_TOKEN_ORIGIN, scaled.
  const bodyTopLeft = tokenFills.find((f) => f.color === PALETTE_52[2]);
  assert.equal(bodyTopLeft!.x, DOLL_TOKEN_ORIGIN.x * scale);
  assert.equal(bodyTopLeft!.y, DOLL_TOKEN_ORIGIN.y * scale);
  assert.equal(bodyTopLeft!.width, scale);
});

// ── contract v2: gear icons ─────────────────────────────────────────────────
//
// The bag and the slot boxes show a CROP of the very overlay the doll and the
// board already draw (weapon/outer/crown/boots), or a small dedicated icon
// (ring/amulet/the two empty-slot silhouettes) -- never a second drawing. The
// crop, scale and centring are pure (`iconPlacement`); `renderGearIcon` wires
// that placement, an optional palette remap and an optional rim light (the
// very same `glowRaster` compositeToken uses) onto a canvas.

test("iconPlacement crops to the sprite's own opaque bounding box, outline pixels included, and centres it", () => {
  // A 3x3 opaque block at (5,5)..(7,7) inside a 16x16 icon sprite.
  const pixels = Array.from({ length: 16 }, (_, y) =>
    Array.from({ length: 16 }, (_, x) => (x >= 5 && x <= 7 && y >= 5 && y <= 7 ? 5 : TRANSPARENT)),
  );
  const placement = iconPlacement(pixels, 0, 52);
  assert.deepEqual({ cropX: placement.cropX, cropY: placement.cropY, cropW: placement.cropW, cropH: placement.cropH }, {
    cropX: 5,
    cropY: 5,
    cropW: 3,
    cropH: 3,
  });
  assert.equal(placement.scale, GEAR_ICON_MAX_SCALE, "52 / 3 clamps to the max scale, 4");
  assert.equal(placement.offsetX, Math.floor((52 - 3 * 4) / 2));
  assert.equal(placement.offsetY, placement.offsetX, "square crop, square centring");
});

test("iconPlacement grows the crop by glowBands on every side, not by the fixed GLOW_MARGIN", () => {
  const pixels = Array.from({ length: 16 }, (_, y) =>
    Array.from({ length: 16 }, (_, x) => (x === 8 && y === 8 ? 5 : TRANSPARENT)),
  );
  const at1 = iconPlacement(pixels, 1, 52);
  assert.deepEqual({ cropX: at1.cropX, cropY: at1.cropY, cropW: at1.cropW, cropH: at1.cropH }, { cropX: 7, cropY: 7, cropW: 3, cropH: 3 });

  const at2 = iconPlacement(pixels, 2, 52);
  assert.deepEqual({ cropX: at2.cropX, cropY: at2.cropY, cropW: at2.cropW, cropH: at2.cropH }, { cropX: 6, cropY: 6, cropW: 5, cropH: 5 });
});

// Close-out finding (major, render lane): growing the crop by glowBands used
// to also choose the SCALE, so an identically-shaped item scaled smaller the
// more glow bands its tier drew -- a rare or legendary piece read as a thin
// sliver next to the same item at common or uncommon. Scale must come from
// the item's own opaque bounding box; only placement (the offset, so the rim
// still has somewhere to land) may grow with glowBands.
test("iconPlacement gives an identically-shaped item the same scale at every tier: the glow rim must not shrink the item inside it", () => {
  const shape = Array.from({ length: 24 }, (_, y) =>
    Array.from({ length: 16 }, (_, x) => (x >= 4 && x <= 10 && y >= 3 && y <= 21 ? 5 : TRANSPARENT)),
  );
  const cellPx = 44;
  const scales = Object.fromEntries(EQUIPMENT_TIERS.map((tier) => [tier, iconPlacement(shape, GLOW_BANDS_BY_TIER[tier], cellPx).scale]));
  assert.equal(scales.uncommon, scales.common, "uncommon's one-band rim must not shrink it below common");
  assert.equal(scales.rare, scales.common, "rare's two-band rim must not shrink it below common");
  assert.equal(scales.legendary, scales.common, "legendary's two-band rim must not shrink it below common");
});

test("iconPlacement, run against the shipped Knight weapon art: base, rare and legendary all scale alike, not half at rare/legendary", () => {
  const byId = Object.fromEntries(FANTASY_SPRITES.map((s) => [s.assetId, s]));
  const cellPx = 44;
  const scaleFor = (id: string, tier: "common" | "uncommon" | "rare" | "legendary") =>
    iconPlacement(byId[id]!.pixels, GLOW_BANDS_BY_TIER[tier], cellPx).scale;
  const common = scaleFor("gear_knight_weapon_base", "common");
  assert.equal(scaleFor("gear_knight_weapon_base", "uncommon"), common, "uncommon Longsword");
  assert.equal(scaleFor("gear_knight_weapon_rare", "rare"), common, "rare Sword of the Vigil");
  assert.equal(scaleFor("gear_knight_weapon_legendary", "legendary"), common, "legendary Dawnbreaker");
});

test("iconPlacement's scale never exceeds GEAR_ICON_MAX_SCALE and never drops below 1", () => {
  const big = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => 5)); // whole 16x16 opaque
  assert.equal(iconPlacement(big, 0, 400).scale, GEAR_ICON_MAX_SCALE, "a huge box still clamps at 4");
  assert.equal(iconPlacement(big, 0, 4).scale, 1, "a box smaller than the crop still gets a whole pixel, not 0");
});

test("iconPlacement falls back to the full sprite when nothing is opaque, rather than dividing by zero", () => {
  const empty = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => TRANSPARENT));
  const placement = iconPlacement(empty, 0, 52);
  assert.deepEqual({ cropX: placement.cropX, cropY: placement.cropY, cropW: placement.cropW, cropH: placement.cropH }, {
    cropX: 0,
    cropY: 0,
    cropW: 16,
    cropH: 16,
  });
});

test("renderGearIcon returns false and draws nothing when the manifest does not carry the sprite", () => {
  const manifest = manifestWith({});
  const { ctx, fills } = recordingCtx();
  const source: GearIconSource = { kind: "icon", spriteId: "gear_fantasy_ring_base", remap: null, glowBands: 0 };
  assert.equal(renderGearIcon(ctx, source, manifest, 52), false);
  assert.equal(fills.length, 0);
});

test("renderGearIcon paints the icon's own remapped pixel, cropped and centred", () => {
  // "base" is the right id for an uncommon piece: common and uncommon SHARE
  // one drawing and differ only by the remap, so there is no "_uncommon" id.
  const pixels = dot(5, { x: 8, y: 8 }, 16, 16);
  const manifest = manifestWith({ gear_fantasy_ring_base: pixels });
  const { ctx, fills } = recordingCtx();
  const source: GearIconSource = { kind: "icon", spriteId: "gear_fantasy_ring_base", remap: { 5: 31 }, glowBands: 0 };
  assert.equal(renderGearIcon(ctx, source, manifest, 52), true);
  assert.equal(fills.length, 1, "one opaque pixel, one fill, no glow at glowBands 0");
  assert.equal(fills[0]!.color, PALETTE_52[31], "the remap reached the icon");

  const placement = iconPlacement(pixels, 0, 52);
  assert.equal(fills[0]!.x, placement.offsetX);
  assert.equal(fills[0]!.y, placement.offsetY);
  assert.equal(fills[0]!.width, placement.scale);
});

test("renderGearIcon draws a silhouette with no remap and no glow, even if the source carried none to apply", () => {
  const pixels = dot(9, { x: 8, y: 8 }, 16, 16);
  const manifest = manifestWith({ gear_fantasy_ring_empty: pixels });
  const { ctx, fills } = recordingCtx();
  const source: GearIconSource = { kind: "silhouette", spriteId: "gear_fantasy_ring_empty" };
  assert.equal(renderGearIcon(ctx, source, manifest, 52), true);
  assert.equal(fills.length, 1);
  assert.equal(fills[0]!.color, PALETTE_52[9], "drawn as authored: a silhouette is never remapped");
});

test("renderGearIcon paints a rim light under the sprite when glowBands > 0, exactly as the board would draw it", () => {
  const pixels = dot(5, { x: 8, y: 8 }, 16, 16);
  const manifest = manifestWith({ gear_fantasy_ring_legendary: pixels });
  const { ctx, fills } = recordingCtx();
  const source: GearIconSource = { kind: "icon", spriteId: "gear_fantasy_ring_legendary", remap: null, glowBands: 2 };
  assert.equal(renderGearIcon(ctx, source, manifest, 52), true);
  assert.ok(fills.length > 1, "a glow ring painted in addition to the one opaque pixel");

  const spriteColorIndex = 5;
  const firstSpriteFill = fills.findIndex((f) => f.color === PALETTE_52[spriteColorIndex]);
  const glowFillIndexes = fills
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.color === PALETTE_52[GLOW_INDEX_A[0]] || f.color === PALETTE_52[GLOW_INDEX_A[1]])
    .map(({ i }) => i);
  assert.ok(glowFillIndexes.length > 0, "some rim pixels were painted");
  assert.ok(glowFillIndexes.every((i) => i < firstSpriteFill), "the rim is painted UNDER the sprite: before it, not after");
});

test("a common-tier icon (glowBands 0) never paints a rim, matching GLOW_BANDS_BY_TIER.common", () => {
  assert.equal(GLOW_BANDS_BY_TIER.common, 0);
  const pixels = dot(5, { x: 8, y: 8 }, 16, 16);
  const manifest = manifestWith({ gear_knight_boots_base: pixels });
  const { ctx, fills } = recordingCtx();
  const source: GearIconSource = { kind: "overlay", spriteId: "gear_knight_boots_base", remap: null, glowBands: 0 };
  renderGearIcon(ctx, source, manifest, 52);
  assert.equal(fills.length, 1, "no rim, just the one opaque pixel");
});

// ── per-coordinate prop variants ──────────────────────────────────────────
//
// The variant pass reached tiles only, so a wood of six trees rendered as six
// copies of one sprite in one panel: the same 81-percent-duplicate defect the
// tile pass was written to fix, on the objects the eye actually tracks.

test("a stand of trees does not render as one sprite repeated", () => {
  const at = (x: number, y: number) => propVariantAt("tree", x, y, fantasyHasAsset);
  const drawn = new Set([at(2, 3), at(5, 3), at(8, 4), at(11, 6), at(14, 2), at(17, 9)]);
  assert.ok(drawn.size >= 2, `six trees drew ${drawn.size} distinct sprites`);
  for (const id of drawn) assert.ok(fantasyHasAsset(id), `${id} is not in the shipped manifest`);
});

test("a prop picks the same variant on every call, from its own coordinate", () => {
  assert.equal(propVariantAt("tree", 4, 6, fantasyHasAsset), propVariantAt("tree", 4, 6, fantasyHasAsset));
  const seeds = new Set([0, 1, 2, 3, 4, 5].map((s) => propVariantAt("tree", 4, 6, fantasyHasAsset, s)));
  assert.ok(seeds.size > 1, "two cells of the same map must not repeat one wood pixel for pixel");
});

test("a prop with no registered variant, or none the manifest carries, draws the id the DM placed", () => {
  assert.equal(propVariantAt("chest", 3, 3, fantasyHasAsset), "chest");
  assert.equal(propVariantAt("tree", 3, 3, (id) => id === "tree"), "tree");
  assert.equal(propVariantAt("tree", 3, 3, () => false), "tree", "an empty roster is still a prop to draw");
});

test("every prop variant set lists its own base and never changes what a prop IS", () => {
  // A prop's walkability is a validated world property. A display substitution
  // that swapped a walkable torch for an unwalkable one would drift the
  // engine's board from the model's, which is the one thing these passes may
  // never do.
  const walkableOf = new Map([...FANTASY_SPRITES, ...SCIFI_SPRITES].map((s) => [s.assetId, s.walkable]));
  for (const set of PROP_VARIANT_SETS) {
    assert.ok(set.variants.includes(set.base), `${set.base} is not among its own variants`);
    for (const variant of set.variants) {
      assert.equal(walkableOf.get(variant), walkableOf.get(set.base), `${variant} is not as walkable as ${set.base}`);
    }
  }
});

test("renderCell scatters props without touching the stored layout", () => {
  const manifest = manifestWith({}, { tree: solid(1, 16, 16), tree_left: solid(2, 16, 16), tree_right: solid(6, 16, 16) });
  const props: CellLayout["props"] = [
    { id: "p1", assetId: "tree", x: 2, y: 3 },
    { id: "p2", assetId: "tree", x: 5, y: 3 },
    { id: "p3", assetId: "tree", x: 8, y: 4 },
    { id: "p4", assetId: "tree", x: 11, y: 6 },
  ];
  const before = JSON.stringify(props);
  const { ctx, fills } = recordingCtx();
  renderCell(ctx, layoutWith([], props), manifest, 16);
  assert.equal(JSON.stringify(props), before, "the substitution is display only");
  assert.ok(new Set(fills.map((f) => f.color)).size >= 2, "four trees drew one colour, so the pass never ran");
});

// ── the terrain pairs an outdoor scene actually contains ──────────────────

test("every fantasy material pair that can abut has a rule, in both directions", () => {
  // A pair with no rule falls back to a hard axis-aligned cut, which is the
  // single thing three blind judges named. Listing a pair whose art is not
  // drawn yet is free: every substitution is gated by the manifest's own
  // membership test, so an unshipped rule costs nothing and starts working the
  // moment the tiles land.
  const pair = (over: string, under: string) =>
    TERRAIN_EDGE_RULES.some((r) => r.over.includes(over) && r.under.includes(under));
  const symmetric = (a: string, b: string) =>
    TERRAIN_EDGE_RULES.some(
      (r) =>
        r.underPrefix !== undefined &&
        ((r.over.includes(a) && r.under.includes(b)) || (r.over.includes(b) && r.under.includes(a))),
    );

  for (const [over, under] of [
    ["water", "floor_grass"],
    ["water", "floor_sand"],
    ["water", "floor_stone"],
    ["water", "floor_dirt"],
    ["floor_grass", "floor_stone"],
    ["floor_grass", "floor_dirt"],
    ["floor_grass", "floor_sand"],
    ["floor_dirt", "floor_stone"],
    ["floor_sand", "floor_stone"],
    ["floor_dirt", "floor_sand"],
    ["floor_grass_pale", "floor_grass"],
    ["floor_grass_pale", "floor_dirt"],
    ["floor_grass_pale", "floor_stone"],
  ] as const) {
    assert.ok(pair(over, under), `${over} beside ${under} matches no rule`);
  }

  // Every pair of two drawn materials is evaluated from both sides. Pale grass
  // over grass is the deliberate exception: it is one plant in a drier patch,
  // a value shift with no bank, so a second transition facing back would only
  // blur it twice.
  for (const [a, b] of [
    ["water", "floor_grass"],
    ["water", "floor_sand"],
    ["water", "floor_dirt"],
    ["floor_grass", "floor_dirt"],
    ["floor_grass", "floor_sand"],
    ["floor_dirt", "floor_stone"],
    ["floor_sand", "floor_stone"],
  ] as const) {
    assert.ok(symmetric(a, b), `${a} and ${b} soften only from one side`);
  }
});

test("a newly named pair resolves from both sides once its art lands, and costs nothing before", () => {
  // Grass over dirt had no reverse direction, so a lawn softening into a dirt
  // yard left the dirt side a bare rectangle: "one rectangle literally stops
  // against another", in a judge's words.
  const tiles = patch("floor_grass", "floor_dirt", [
    [1, 1], [2, 1], [3, 1],
    [1, 2], [2, 2], [3, 2],
  ]);

  const both = fullSet("floor_grass_edge_dirt_", "floor_dirt_edge_grass_");
  const drawn = applyTerrainEdges(tiles, both);
  assert.equal(drawn[2]![2], "floor_grass_edge_dirt_s", "the grass side softens downward into dirt");
  assert.equal(drawn[3]![2], "floor_dirt_edge_grass_n", "and the dirt side softens upward into grass");

  // With none of the transition art the grid is exactly what it was before the
  // rule existed.
  const noTransitions = (id: string) => !id.includes("_edge_") && fantasyHasAsset(id);
  assert.deepEqual(applyTerrainEdges(tiles, noTransitions), tiles);
});
