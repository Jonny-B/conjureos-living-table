/**
 * The optional AI adventure writer.
 *
 * Adventures are normally written by the owner. This module lets a person ask
 * the AI to write one instead, only when they choose to, because a whole
 * adventure is long and takes minutes (see AI_ADVENTURE_COST_NOTE).
 *
 * It is transport-agnostic: the caller passes a `complete` function (the app's
 * AI bridge, a test double, anything that turns a prompt into text). The
 * writer asks for ONE adventure in the exact Markdown format the owner uses,
 * reads the answer with the same parser, checks it with the same validator
 * (against the game's real picture ids and creatures), and when there are
 * problems it sends them back, plainly and with line numbers, for a repair,
 * up to `maxRepairs` times. Whatever comes out is marked author "ai".
 *
 * Nothing here touches the network, the renderer or the DM.
 */
import { CELL_HEIGHT, CELL_WIDTH } from "../world";
import { CONDITION_PHRASES, parseAdventureMarkdown } from "./markdown";
import { validateAdventure } from "./validate";
import type { Adventure, AdventureAssets } from "./types";

/** What the person asked for. Only `premise` is required. */
export interface AdventureRequest {
  /** The idea, in the person's own words: "a haunted lighthouse and a missing keeper". */
  premise: string;
  /** The mood, e.g. "spooky but kind". */
  tone?: string;
  /** "short" is about two rooms and two or three scenes; "medium" about three or four rooms and four or five scenes. Default "short". */
  length?: "short" | "medium";
  /** The hero level the adventure is tuned for (1 to 20). Default 1. */
  level?: number;
  /** Things the story must contain, one per entry ("a talking cat", "a locked door that needs a key"). */
  mustInclude?: string[];
}

/** What the writer is allowed to use, plus the format example. */
export interface AdventureWriterContext {
  /** The picture ids that exist. Gear pictures and edge or join tiles are summarised, not listed. */
  assets: AdventureAssets;
  /** The creature ids a spawn may name (bestiary ids or token ids). */
  creatures: string[];
  /** The text of adventures/TEMPLATE.md, shown to the model as the exact format. */
  template: string;
  /** Optional extra guidance, for example the text of adventures/README.md. */
  guide?: string;
}

/** What `complete` accepts: a plain prompt, or a short conversation. */
export type CompleteInput = string | { role: "user" | "assistant"; content: string }[];

export type WriteAdventureResult =
  | { ok: true; adventure: Adventure; markdown: string; repairs: number; warnings: string[] }
  | { ok: false; errors: string[]; markdown?: string };

/**
 * Plain words for the button that starts the AI writer. Neutral on purpose: no
 * price, no number and no mention of credits (the platform's credit display
 * says what AI use costs; the game never does).
 */
export const AI_ADVENTURE_COST_NOTE =
  "Having the AI write an adventure takes a few minutes, because a whole adventure is long and may need a couple of rewrites to pass the checks. " +
  "Adventures written by hand load straight away. Only press this if you want a new one made for you.";

const DEFAULT_REPAIRS = 2;
/** The most problems listed back to the model in one repair request. */
const MAX_LISTED_PROBLEMS = 40;

const LENGTHS: Record<"short" | "medium", string> = {
  short: "SHORT: 2 locations, 2 or 3 scenes, 1 or 2 NPCs, 2 or 3 objectives in all. About 15 minutes of play.",
  medium: "MEDIUM: 3 or 4 locations, 4 or 5 scenes, 2 to 4 NPCs, 4 to 6 objectives in all. About 45 minutes of play.",
};

function clampLevel(level: number | undefined): number {
  const n = Number.isFinite(level) ? Math.floor(level as number) : 1;
  return Math.min(20, Math.max(1, n));
}

function idList(ids: string[]): string {
  return ids.map((i) => `\`${i}\``).join(", ");
}

/**
 * The prompt that asks for ONE adventure in the exact Markdown format.
 * Pure: the same inputs give the same text.
 */
export function buildAdventurePrompt(req: AdventureRequest, ctx: AdventureWriterContext): string {
  const premise = req.premise.trim();
  const length = req.length === "medium" ? "medium" : "short";
  const level = clampLevel(req.level);
  const must = (req.mustInclude ?? []).map((m) => m.trim()).filter(Boolean);

  const isGear = (id: string) => id.startsWith("gear_");
  const isTransition = (id: string) => /_edge_|_join_/.test(id);
  const tiles = ctx.assets.tiles.filter((t) => !isTransition(t));
  const transitionCount = ctx.assets.tiles.length - tiles.length;
  const tokens = ctx.assets.tokens.filter((t) => !isGear(t));
  const walkable = ctx.assets.walkableTiles ? new Set(ctx.assets.walkableTiles) : undefined;
  const blocking = ctx.assets.blockingProps ? new Set(ctx.assets.blockingProps) : undefined;

  const out: string[] = [];
  const add = (...lines: string[]) => void out.push(...lines);

  add(
    "You are writing ONE complete adventure for a tabletop-style fantasy game, as a single Markdown file in an exact, strict format.",
    "A program will read your file with a strict parser and check every id, map and condition, so follow the format exactly. The game then runs FROM your file: what you write is gospel for the game's dungeon master (DM). The DM only improvises texture and dialogue; it never changes the facts, places or paths you define.",
    "",
    "## The request",
    "",
    "<premise>",
    premise,
    "</premise>",
    "",
    `- Length: ${LENGTHS[length]}`,
    `- Hero level: ${level}. Write "- levels: ${level} to ${level}" in the header (or a wider range if the story really supports it).`,
  );
  if (req.tone && req.tone.trim()) add(`- Tone: ${req.tone.trim()}`);
  if (must.length) {
    add("- The story must include:");
    for (const m of must) add(`  - ${m}`);
  }

  add(
    "",
    "## Rules",
    "",
    "Output:",
    '- Reply with the adventure file and NOTHING else: no greeting, no explanation, no code fence around the whole file. The first line is the title, written `# The Title`. Stop after the last section.',
    "- Write `- author: ai` and `- version: 1` in the header under the title.",
    "- Fill in EVERY section the template has: Summary, Truths (at least 3), DM must, DM never, Hooks (default, fighter, rogue and wizard), Starting kit (fighter, rogue and wizard, each with `armor` and `potions`), at least one Item, at least one NPC, Locations (each with read-aloud text, Map, Legend, at least one Feature, Spawns where creatures stand, and Exits), and Scenes (each with an opening, Objectives, Beats where useful, and Next or Ending).",
    `- Every map is a fenced block of exactly ${CELL_HEIGHT} lines of exactly ${CELL_WIDTH} characters. No spaces, no tabs, no backticks inside a map. Every character used must appear in that location's Legend.`,
    "- Use ONLY the picture ids, props, tiles and creatures listed below. Do not invent an id. A creature or character that is not in the lists cannot appear.",
    "- Do not write `ADDED` or `REVIEW` comments. Write plain hyphens, never long dashes.",
    "",
    "Honesty about numbers (the game uses SRD 5.1 rules only, and it applies the numbers itself):",
    "- Never invent a creature's statistics, attack bonus, damage or hit points in your text. A creature's real numbers come from the game's bestiary by its id; your text may only describe how it looks and acts.",
    "- Search DCs use the SRD scale from 1 to 30 (easy 10, medium 15, hard 20, very hard 25). Never promise an effect the game does not apply: no bonuses, curses, auras or special powers in item or feature text unless the item is only a story object.",
    "- Armor: `armor: none` means the hero wears no armor, so unarmored AC is 10 plus the DEX modifier. `armor: class` gives the class's normal armor. A starting-kit weapon line is words only (for example `a plain dagger`); never write damage dice in it.",
    "- Tune the danger to the hero level and the length. Do not stack more hostile creatures than a hero of that level can survive.",
    "",
    "Mistakes the checker rejects or warns about (avoid them):",
    "- The start location's Legend must have exactly one `start` square, and the first scene must be set in that location. A creature must never stand on the start square.",
    "- A Feature needs a `prop` on its map square so it can be seen and searched; give each feature at most one `gives` item. An exit, a feature, a creature and the start square must stand on walkable floor, not under a blocking prop.",
    "- An exit on the outer edge of a map (first or last row, first or last column) is a doorway; put a walkable prop such as `door_open` on it. Every exit's `to` must be a location you define, and `arrive at` must be an exit in that location or `start`.",
    "- Every `hostile` and `awake` is required on every Spawn. A spawn named by a Beat's `spawns` is absent until that beat fires.",
    "- A quest Item must be handed over by something (a feature's `gives` or a Beat's `gives`).",
    "- Things the engine can see (a kill, entering a place, talking to an NPC, holding an item) are tracked by the engine. Only a judgment call (for example 'the guard is persuaded') may be a flag the DM declares: write it as a flag that no Beat sets. The DM may tick an Objective or move to another Scene only when your condition for it is nothing but one such flag, so gate fights, keys and locked doors with kills, items and exits, not with flags.",
    "- Every scene needs a way out (`Next`) or an `Ending`. The adventure needs at least one scene whose Ending outcome is `victory`. Every location must be reachable from the start.",
    "- Conditions use ONLY these exact phrasings (join with and, or, not and parentheses; mixing and with or needs parentheses):",
  );
  for (const phrase of CONDITION_PHRASES) add(`  - ${phrase}`);

  add("", "## What you may use", "");
  add(`Floor and wall tiles (${tiles.length}): ${idList(tiles)}`);
  if (walkable) {
    add(`  Not walkable (use for walls, water and room edges): ${idList(tiles.filter((t) => !walkable.has(t)))}`);
  }
  if (transitionCount > 0) {
    add(`  The game also has ${transitionCount} edge and join tiles (names containing _edge_ or _join_). The renderer places them for you, so do not use them.`);
  }
  add("", `Props (${ctx.assets.props.length}): ${idList(ctx.assets.props)}`);
  if (blocking) {
    add(`  Props that block their square (never put one on a start square, an exit, a creature or a feature you want reachable unless the feature itself is the prop): ${idList(ctx.assets.props.filter((p) => blocking.has(p)))}`);
  }
  add("", `Character pictures for an NPC \`token:\` (${tokens.length}): ${idList(tokens)}`);
  add("", `Creatures a Spawn \`creature:\` may name (${ctx.creatures.length}): ${idList(ctx.creatures)}`);

  if (ctx.guide && ctx.guide.trim()) {
    add("", "## The authoring guide", "", "<guide>", ctx.guide.trim(), "</guide>");
  }

  add(
    "",
    "## The exact format, shown by a complete working example",
    "",
    "Copy its STRUCTURE, headings, field names, legend syntax and condition phrasings exactly. Do NOT copy its story, names or maps: write a new adventure from the premise above.",
    "",
    "<template>",
    ctx.template.trim(),
    "</template>",
    "",
    "Now write the adventure file for the premise. Begin with the `# Title` line.",
  );

  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Cleaning what the model sends back

/** Drops a wrapping code fence and any chatter before the title, so line numbers refer to what is parsed. */
function cleanReply(raw: string): string {
  let lines = raw.replace(/\r\n/g, "\n").split("\n");
  const firstTitle = lines.findIndex((l) => /^#\s+\S/.test(l));
  if (firstTitle > 0) lines = lines.slice(firstTitle);
  // A fence that wraps the whole answer leaves an odd number of fence lines.
  const fenceCount = lines.filter((l) => /^\s*`{3,}/.test(l)).length;
  if (fenceCount % 2 === 1) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i] ?? "";
      if (line.trim() === "") continue;
      if (/^\s*`{3,}\s*$/.test(line)) lines.splice(i, 1);
      break;
    }
  }
  while (lines.length && (lines[lines.length - 1] ?? "").trim() === "") lines.pop();
  return lines.join("\n");
}

/** Makes the header say `- author: ai`, whatever the model wrote. */
function forceAuthorAi(markdown: string): string {
  const lines = markdown.split("\n");
  const title = lines.findIndex((l) => /^#\s+\S/.test(l));
  if (title < 0) return markdown;
  let end = lines.findIndex((l, i) => i > title && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  for (let i = title + 1; i < end; i++) {
    if (/^\s*-?\s*author\s*:/i.test(lines[i] ?? "")) {
      lines[i] = "- author: ai";
      return lines.join("\n");
    }
  }
  lines.splice(title + 1, 0, "", "- author: ai");
  return lines.join("\n");
}

function repairRequest(problems: string[]): string {
  const listed = problems.slice(0, MAX_LISTED_PROBLEMS);
  const more = problems.length - listed.length;
  return [
    "The adventure file was read and checked, and it has problems. Fix every one of them and send the WHOLE corrected file again (not only the changed parts), in the same format.",
    "Line numbers refer to the file you just sent. A path such as locations.cellar.spawns.rat points at the thing by its id. Do not change anything that was not a problem, and keep using only the listed ids and creatures.",
    "Reply with the adventure file and nothing else, starting with the `# Title` line.",
    "",
    "Problems:",
    ...listed.map((p) => `- ${p}`),
    ...(more > 0 ? [`- ...and ${more} more like these. Fix them all.`] : []),
  ].join("\n");
}

function check(markdown: string, ctx: AdventureWriterContext): { adventure?: Adventure; problems: string[]; warnings: string[] } {
  const parsed = parseAdventureMarkdown(markdown);
  const warnings = parsed.warnings.map((w) => `line ${w.line}: ${w.message}`);
  if (!parsed.adventure) {
    return { problems: parsed.errors.map((e) => `line ${e.line}: ${e.message}`), warnings };
  }
  const result = validateAdventure(parsed.adventure, ctx.assets, ctx.creatures);
  warnings.push(...result.warnings.map((w) => `${w.path}: ${w.message}`));
  if (result.errors.length) {
    return { problems: result.errors.map((e) => `${e.path}: ${e.message}`), warnings };
  }
  return { adventure: { ...parsed.adventure, author: "ai" }, problems: [], warnings };
}

/**
 * Ask the AI to write an adventure, check it, and repair it until it passes
 * or the repairs run out. Never throws: a failure to reach the writer comes
 * back as `{ ok: false }` with a plain-words error.
 */
export async function writeAdventure(
  complete: (input: CompleteInput) => Promise<string>,
  req: AdventureRequest,
  ctx: AdventureWriterContext,
  opts: { maxRepairs?: number; onProgress?: (stage: string) => void } = {},
): Promise<WriteAdventureResult> {
  const progress = (stage: string) => {
    try {
      opts.onProgress?.(stage);
    } catch {
      // A progress listener must never break the writer.
    }
  };
  if (!req.premise || !req.premise.trim()) {
    return { ok: false, errors: ["Tell the writer what the adventure is about first: the premise is empty."] };
  }
  const maxRepairs = Number.isFinite(opts.maxRepairs) ? Math.max(0, Math.floor(opts.maxRepairs as number)) : DEFAULT_REPAIRS;

  const prompt = buildAdventurePrompt(req, ctx);
  let markdown: string | undefined;
  let input: CompleteInput = prompt;
  let repairs = 0;

  for (;;) {
    progress(repairs === 0 ? "Writing the adventure" : `Rewriting the adventure to fix problems (repair ${repairs} of ${maxRepairs})`);
    let reply: string;
    try {
      reply = await complete(input);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      return { ok: false, errors: [`The writer could not finish: ${why}`], ...(markdown ? { markdown } : {}) };
    }
    markdown = forceAuthorAi(cleanReply(typeof reply === "string" ? reply : ""));

    progress("Checking the adventure");
    const checked = markdown.trim() ? check(markdown, ctx) : { problems: ["The reply was empty. Send the whole adventure file."], warnings: [] as string[] };
    if (checked.adventure) {
      progress("Done");
      return { ok: true, adventure: checked.adventure, markdown, repairs, warnings: checked.warnings };
    }
    if (repairs >= maxRepairs) {
      progress("The adventure did not pass the checks");
      return { ok: false, errors: checked.problems, markdown };
    }
    repairs += 1;
    input = [
      { role: "user", content: prompt },
      { role: "assistant", content: markdown },
      { role: "user", content: repairRequest(checked.problems) },
    ];
  }
}
