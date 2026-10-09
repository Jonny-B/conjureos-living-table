/**
 * Check adventure files.
 *
 *   npx -y tsx scripts/adventures/check.ts                 check every adventures/*.md (README.md is skipped)
 *   npx -y tsx scripts/adventures/check.ts path/to/a.md    check just these files
 *   npx -y tsx scripts/adventures/check.ts --ids           print the tile, prop, token and creature ids
 *   npx -y tsx scripts/adventures/check.ts --write-ids     rewrite the id lists inside adventures/README.md
 *
 * For each file this parses the Markdown (errors carry the line number), then
 * validates the typed adventure against the game's real asset ids from
 * scripts/assets/fantasy.ts and the bestiary. Exit code 1 if any file has an
 * error. Warnings never fail a file, but read them.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SPRITES } from "../assets/fantasy";
import { BESTIARY } from "../../src/games/livingtable/rules/bestiary";
import { markedForReview, parseAdventureMarkdown } from "../../src/games/livingtable/adventures/markdown";
import { validateAdventure } from "../../src/games/livingtable/adventures/validate";
import type { AdventureAssets } from "../../src/games/livingtable/adventures/types";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const DIR = join(ROOT, "adventures");
const README = join(DIR, "README.md");
const BEGIN = "<!-- BEGIN GENERATED IDS (npx -y tsx scripts/adventures/check.ts --write-ids) -->";
const END = "<!-- END GENERATED IDS -->";

export function gameAssets(): AdventureAssets {
  const tiles = SPRITES.filter((s) => s.kind === "tile");
  const props = SPRITES.filter((s) => s.kind === "prop");
  const tokens = SPRITES.filter((s) => s.kind === "token");
  return {
    tiles: tiles.map((s) => s.assetId),
    props: props.map((s) => s.assetId),
    tokens: tokens.map((s) => s.assetId),
    walkableTiles: tiles.filter((s) => s.walkable).map((s) => s.assetId),
    blockingProps: props.filter((s) => !s.walkable).map((s) => s.assetId),
  };
}

/** The id lists as Markdown, built from SPRITES and the bestiary. */
export function idsMarkdown(): string {
  const tiles = SPRITES.filter((s) => s.kind === "tile");
  const props = SPRITES.filter((s) => s.kind === "prop");
  const tokens = SPRITES.filter((s) => s.kind === "token");
  const joiner = (ids: string[]) => ids.map((i) => `\`${i}\``).join(", ");

  const isTransition = (id: string) => /_edge_|_join_/.test(id);
  const floors = tiles.filter((s) => !isTransition(s.assetId));
  const walk = floors.filter((s) => s.walkable).map((s) => s.assetId);
  const solid = floors.filter((s) => !s.walkable).map((s) => s.assetId);
  const transitions = tiles.filter((s) => isTransition(s.assetId));
  const families = new Map<string, number>();
  for (const t of transitions) {
    const fam = t.assetId.replace(/_(edge|join)_.*$/, "_$1");
    families.set(fam, (families.get(fam) ?? 0) + 1);
  }

  const propsWalk = props.filter((s) => s.walkable).map((s) => s.assetId);
  const propsBlock = props.filter((s) => !s.walkable).map((s) => s.assetId);
  const people = tokens.filter((s) => !s.assetId.startsWith("gear_")).map((s) => s.assetId);
  const gear = tokens.filter((s) => s.assetId.startsWith("gear_"));

  const lines: string[] = [];
  lines.push(`Generated from \`scripts/assets/fantasy.ts\` (${tiles.length} tiles, ${props.length} props, ${tokens.length} tokens) and the bestiary (${BESTIARY.length} creatures).`, "");
  lines.push("### Floor tiles", "");
  lines.push(`Walkable (a hero, an exit or a creature can stand here): ${joiner(walk)}`, "");
  lines.push(`Not walkable (walls, water, canopy, cliff faces; use them for the edges of rooms): ${joiner(solid)}`, "");
  lines.push(
    `The game also has ${transitions.length} edge and join tiles (${[...families].map(([f, n]) => `\`${f}_*\` x${n}`).join(", ")}). The renderer picks those to soften borders between materials, so an author normally never types one. They are valid tile ids if you want one.`,
    "",
  );
  lines.push("### Props", "");
  lines.push(`Walkable (decoration you can stand on): ${joiner(propsWalk)}`, "");
  lines.push(`Blocking (take up their square): ${joiner(propsBlock)}`, "");
  lines.push("### Tokens (the picture for an NPC, or for a creature that has no bestiary entry)", "");
  lines.push(joiner(people), "");
  lines.push(`Also present, but never for a character: ${gear.length} \`gear_*\` pictures that are worn equipment. The checker rejects them as a token or creature.`, "");
  lines.push("### Creatures (what `creature:` in a spawn accepts)", "");
  const drawn = new Set(tokens.map((s) => s.assetId));
  const pictureOf = (b: (typeof BESTIARY)[number]) => b.tokenAssetId ?? `token_${b.id.replace(/-/g, "_")}`;
  const ready = BESTIARY.filter((b) => drawn.has(pictureOf(b)));
  lines.push(
    "A bestiary id, or a `token_*` id. Names with spaces and capitals (such as `Giant Rat`) are turned into the id (`giant-rat`) for you. A creature whose picture is not drawn yet fails the check, with a message saying which token it looks for.",
    "",
    `**Ready to use now (${ready.length}): ${ready.map((b) => `\`${b.id}\``).join(", ")}.**`,
    "",
  );
  lines.push("| id | name | CR | picture | drawn |", "|---|---|---|---|---|");
  for (const b of BESTIARY) lines.push(`| \`${b.id}\` | ${b.name} | ${b.cr} | \`${pictureOf(b)}\` | ${drawn.has(pictureOf(b)) ? "yes" : "not yet"} |`);
  lines.push("");
  return lines.join("\n");
}

function spliceIds(readme: string): string | undefined {
  const a = readme.indexOf("<!-- BEGIN GENERATED IDS");
  const b = readme.indexOf(END);
  if (a < 0 || b < 0 || b < a) return undefined;
  return readme.slice(0, a) + BEGIN + "\n\n" + idsMarkdown() + "\n" + readme.slice(b);
}

function checkFile(file: string, assets: AdventureAssets): { errors: number; warnings: number } {
  const rel = relative(process.cwd(), file) || file;
  const text = readFileSync(file, "utf8");
  const parsed = parseAdventureMarkdown(text, { file });
  let errors = 0;
  let warnings = 0;
  console.log(`\n${rel}`);
  for (const e of parsed.errors) {
    errors++;
    console.log(`  error   line ${e.line}: ${e.message}`);
  }
  for (const w of parsed.warnings) {
    warnings++;
    console.log(`  warning line ${w.line}: ${w.message}`);
  }
  if (parsed.adventure) {
    const v = validateAdventure(parsed.adventure, assets);
    for (const e of v.errors) {
      errors++;
      console.log(`  error   ${e.path}: ${e.message}`);
    }
    for (const w of v.warnings) {
      warnings++;
      console.log(`  warning ${w.path}: ${w.message}`);
    }
  }
  const review = markedForReview(text);
  for (const r of review) console.log(`  review  line ${r.line}: ${r.text}`);
  const a = parsed.adventure;
  const summary = a ? `"${a.title}", ${a.locations.length} location(s), ${a.scenes.length} scene(s), ${a.npcs.length} NPC(s)` : "could not be read";
  console.log(`  ${errors === 0 ? "OK" : "FAILED"}: ${summary}; ${errors} error(s), ${warnings} warning(s), ${review.length} marked for review`);
  return { errors, warnings };
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes("--ids")) {
    console.log(idsMarkdown());
    return;
  }
  if (args.includes("--write-ids")) {
    const next = spliceIds(readFileSync(README, "utf8"));
    if (next === undefined) {
      console.error(`${README} has no "${BEGIN}" ... "${END}" markers to fill.`);
      process.exit(1);
    }
    writeFileSync(README, next);
    console.log(`Rewrote the id lists in ${relative(process.cwd(), README)}.`);
    return;
  }
  let files = args.filter((a) => !a.startsWith("--")).map((a) => resolve(a));
  if (files.length === 0) {
    files = existsSync(DIR)
      ? readdirSync(DIR)
          .filter((f) => f.toLowerCase().endsWith(".md") && f.toLowerCase() !== "readme.md")
          .sort()
          .map((f) => join(DIR, f))
      : [];
  }
  if (files.length === 0) {
    console.error("No adventure files found. Put .md files in adventures/ or pass paths.");
    process.exit(1);
  }
  const assets = gameAssets();
  let bad = 0;
  for (const f of files) {
    if (!existsSync(f)) {
      console.log(`\n${basename(f)}\n  error   file not found`);
      bad++;
      continue;
    }
    if (checkFile(f, assets).errors > 0) bad++;
  }
  console.log(`\n${files.length} file(s) checked, ${bad} with errors.`);
  if (bad > 0) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
