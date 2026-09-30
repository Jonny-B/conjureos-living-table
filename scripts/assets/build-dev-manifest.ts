/**
 * build-dev-manifest.ts: write the REAL sprite library to `.devserve/` so
 * `conj-pack dev` serves it and the local game looks like the shipped game.
 *
 * Why this exists. Outside ConjureOS there is no games-db to answer
 * `ltAssetManifest`, so src/bridge/gamesApi.ts answers it from MOCK_LT_ASSETS,
 * which is a four-colour placeholder: every tile a flat fill, every token a
 * dot. That is fine for proving the DM protocol and the rules engine, and
 * useless for looking at the art, so a local play-through looked nothing like
 * the sprites the art lanes were actually authoring.
 *
 * Why it is safe. `.devserve` is esbuild's servedir for the dev server AND it
 * is in build-bundle.mjs's STRIP set, so this file is reachable at
 * `/livingtable-assets.json` while developing and cannot reach the published
 * bundle even by accident. That keeps DESIGN.md's rule intact: the asset
 * library never ships inside the app. Production still streams it from
 * games-db, and gamesApi.ts falls back to the placeholder whenever this file
 * is absent, which is every context except a local dev server.
 *
 * Run: npx tsx scripts/assets/build-dev-manifest.ts   (npm run dev does it)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PALETTE as FANTASY_PALETTE, SPRITES as FANTASY_SPRITES } from "./fantasy";
import { PALETTE as SCIFI_PALETTE, SPRITES as SCIFI_SPRITES } from "./scifi";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = join(ROOT, ".devserve");
const OUT = join(OUT_DIR, "livingtable-assets.json");

/**
 * The wire shape games-db returns, so the dev path and the production path
 * hand gamesApi.ts the same object and no consumer can tell them apart. Note
 * `size` stays the sprite's WIDTH and tile footprint; height is `pixels.length`
 * and nothing carries a second dimension field, per the equipment contract.
 */
function wire(sprites: readonly { assetId: string; kind: string; name: string; size: number; walkable: boolean; pixels: number[][] }[]) {
  return sprites.map((s) => ({
    assetId: s.assetId,
    kind: s.kind,
    name: s.name,
    size: s.size,
    walkable: s.walkable,
    pixels: s.pixels,
  }));
}

const payload = {
  fantasy: { palette: FANTASY_PALETTE, assets: wire(FANTASY_SPRITES) },
  scifi: { palette: SCIFI_PALETTE, assets: wire(SCIFI_SPRITES) },
};

mkdirSync(OUT_DIR, { recursive: true });
const json = JSON.stringify(payload);
writeFileSync(OUT, json, "utf8");

const kb = (json.length / 1024).toFixed(0);
console.log(
  `[dev-manifest] wrote .devserve/livingtable-assets.json (${kb} KB): ` +
    `fantasy ${payload.fantasy.assets.length} sprites / ${payload.fantasy.palette.length} colours, ` +
    `scifi ${payload.scifi.assets.length} sprites / ${payload.scifi.palette.length} colours`,
);
