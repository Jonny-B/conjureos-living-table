/**
 * The campaign-arc generator: one `completeJson` call that plans a whole
 * campaign before the first scene is ever played (DESIGN.md's "1 credit to
 * plan a campaign"), mirroring coldcase/generate.ts's shape (a system
 * prompt this module owns, a validator that never lets a malformed plan
 * reach the board, one retry via completeJson's own built-in repair pass).
 *
 * The arc outline is a PLAN the DM steers by (dm/promptBuilder.ts embeds it
 * verbatim as "your private plan for this campaign... never read it aloud"),
 * not a script the DM reads aloud or a fixed content tree, so it stays
 * short: a throughline, a handful of named beats, at least one named NPC,
 * and a small region sketch.
 *
 * The region sketch is the newest of those and the one with a specific job.
 * `world/perception.ts`'s `getOffscreenCells` has always taken a `hints` map
 * and nobody ever had anything to pass it, because the outline carried no
 * geography at all -- so every neighbour in every DM prompt rendered as "not
 * built yet, unexplored" and a fog crossing read as the DM inventing a room
 * on the spot rather than revealing one it had already committed to. Planning
 * it here costs nothing extra: it rides the campaign-planning credit that is
 * already being spent, one call, no change to the cost model.
 */
import { asArray, asRecord, asString, completeJson, THINKING_HEADROOM_TOKENS } from "../../bridge/ai";
import type { ArcOutline, RegionHint } from "./types";
import type { TemplateGenre } from "./characters/templates";

/**
 * How far from the origin a planned cell may sit. The party starts at (0,0)
 * and reaches new cells one step at a time, so a hint for (12,9) is a hint
 * nobody will ever see; 3 in each axis is a 7x7 region, comfortably more
 * ground than a launch-scope campaign covers.
 */
const REGION_RADIUS = 3;
/** Enough distinct cells to hint a neighbourhood; below this the sketch isn't doing its job. */
const MIN_REGION_CELLS = 4;
/** Anything past this is dropped rather than rejected -- extra planning is harmless, it just never gets read. */
const MAX_REGION_CELLS = 8;

const TEMPLATE_BRIEF: Record<TemplateGenre, string> = {
  fantasy:
    "A fantasy campaign: swords, spells, dungeons, and a wider world of kingdoms, ruins, and old grudges. " +
    "SRD 5.1 played straight underneath the fiction.",
  scifi:
    "A sci-fi campaign: starships, psionics, ray weapons, and a wider setting of stations, frontiers, and " +
    "corporate or factional pressure. The same SRD 5.1 ruleset reskinned, not a different game underneath.",
};

const SYSTEM = `LIVINGTABLE_ARC_GENERATOR

You plan the throughline for one ongoing tabletop campaign that a dungeon master (a separate AI, running turn by turn) will steer by for many sessions. You do NOT write any scene, any dialogue, or any stat block here; you write the PLAN the DM privately consults, never reads aloud, and never treats as a script to follow rigidly rather than a shape to improvise around.

WHAT A GOOD ARC OUTLINE CONTAINS:
- A throughline: one or two sentences naming the campaign's actual spine, the thing that gives every session a reason to matter (a threat, a mystery, a goal, a countdown). Specific and concrete, never generic ("evil must be stopped" is not a throughline).
- 4 to 6 named beats, in rough order: what actually happens as the campaign progresses, as PACING GUIDANCE for the DM to reach toward, not a fixed script to force the player through regardless of what they actually do. Each beat is one sentence.
- At least one named NPC (more is fine): a name, and a one-line role in the throughline. An NPC without a name is not usable, a DM improvising dialogue needs something to call them.
- A region sketch: 5 to 8 cells of the map, with one line each on what is there. This is the campaign's GEOGRAPHY, and the DM reads it when the player walks off the edge of the current room and it has to build the next one. The world is a grid of cells; the party starts at (0,0) and each step moves them one cell. NORTH IS cy-1, SOUTH IS cy+1, WEST IS cx-1, EAST IS cx+1 (screen convention: north is up). Include (0,0) itself, the room the campaign opens in, and cluster the rest around it; every cx and cy must be a whole number between -${REGION_RADIUS} and ${REGION_RADIUS}. Tie the places to the beats, so walking somewhere new reveals something you already planned instead of something invented on the spot: "the marsh causeway; the half-sunken shrine is visible from here" is a usable hint, "an unexplored area" is not.
- Everything should fit the genre: ${TEMPLATE_BRIEF.fantasy} versus ${TEMPLATE_BRIEF.scifi} should read as genuinely different campaigns, not the same plan with the nouns swapped.

Reply with ONLY this JSON, no prose, no markdown fence:
{"title":"a short evocative campaign title","throughline":"1-2 sentences","beats":["beat 1","beat 2","..."],"npcs":[{"name":"","role":"one line"}],"regionSketch":[{"cx":0,"cy":0,"hint":"what is in the opening room's cell"},{"cx":1,"cy":0,"hint":"what is one cell east"}]}`;

export interface GeneratedCampaign {
  title: string;
  arcOutline: ArcOutline;
}

/**
 * The region sketch, validated the way everything else generated here is:
 * shape-checked, range-checked, and rejected with a message the model's one
 * `completeJson` retry can actually act on. Duplicated coordinates keep the
 * first entry (two names for one cell is a slip, not a failure), and a sketch
 * longer than MAX_REGION_CELLS is trimmed rather than rejected, because extra
 * planning costs nothing and simply never gets read.
 */
function validateRegionSketch(value: unknown): RegionHint[] {
  const raw = asArray(value, "regionSketch");
  const seen = new Set<string>();
  const sketch: RegionHint[] = [];

  raw.forEach((entry, i) => {
    const rec = asRecord(entry, `regionSketch[${i}]`);
    const cx = rec.cx;
    const cy = rec.cy;
    if (!Number.isInteger(cx) || !Number.isInteger(cy)) {
      throw new Error(`regionSketch[${i}] needs whole-number cx and cy (the cell's coordinates), got ${JSON.stringify(cx)},${JSON.stringify(cy)}`);
    }
    if (Math.abs(cx as number) > REGION_RADIUS || Math.abs(cy as number) > REGION_RADIUS) {
      throw new Error(
        `regionSketch[${i}] is at (${cx},${cy}), too far from the starting cell (0,0) to ever be walked to. ` +
          `Keep every cx and cy between -${REGION_RADIUS} and ${REGION_RADIUS}.`,
      );
    }
    const key = `${cx},${cy}`;
    if (seen.has(key)) return; // two names for one cell: keep the first, drop the repeat
    seen.add(key);
    sketch.push({ cx: cx as number, cy: cy as number, hint: asString(rec.hint, `regionSketch[${i}].hint`, 200) });
  });

  if (sketch.length < MIN_REGION_CELLS) {
    throw new Error(
      `regionSketch has ${sketch.length} distinct cells, which is not enough to hint a neighbourhood. ` +
        `Give 5 to ${MAX_REGION_CELLS} different cells around (0,0), one line each on what is there.`,
    );
  }
  return sketch.slice(0, MAX_REGION_CELLS);
}

/** Exported for its tests: the whole point of a generator owning its validator is that the validator is checkable without spending a credit. */
export function validateGeneratedCampaign(value: unknown): GeneratedCampaign {
  return validate(value);
}

function validate(value: unknown): GeneratedCampaign {
  const root = asRecord(value, "campaign arc");
  const title = asString(root.title, "title", 100);
  const throughline = asString(root.throughline, "throughline", 500);

  const rawBeats = asArray(root.beats, "beats");
  if (rawBeats.length < 3) throw new Error("beats must contain at least 3 entries");
  const beats = rawBeats.map((b, i) => asString(b, `beats[${i}]`, 300));

  const rawNpcs = asArray(root.npcs, "npcs");
  if (rawNpcs.length < 1) throw new Error("npcs must name at least one NPC");
  const npcs = rawNpcs.map((n, i) => {
    const rec = asRecord(n, `npcs[${i}]`);
    return { name: asString(rec.name, `npcs[${i}].name`, 60), role: asString(rec.role, `npcs[${i}].role`, 200) };
  });

  const regionSketch = validateRegionSketch(root.regionSketch);

  return { title, arcOutline: { throughline, beats, npcs, regionSketch } };
}

/** One AI call, tier "capable" to match this app's other structured-content generators (coldcase/generate.ts's generateCase). `theme` is an optional player-supplied steer, entirely optional since a campaign doesn't need one the way a themed daily puzzle does. */
export async function generateCampaignArc(template: TemplateGenre, theme?: string): Promise<GeneratedCampaign> {
  const ask = theme?.trim()
    ? `Plan a ${template} campaign about: ${theme.trim()}.`
    : `Plan a fresh ${template} campaign. Surprise me with the setting, not just the plot shape.`;

  return completeJson<GeneratedCampaign>(
    {
      system: SYSTEM,
      messages: [{ role: "user", content: ask }],
      // Raised from 1200 when the region sketch joined the reply: 5 to 8 more
      // short lines, plus the headroom completeJson's repair retry needs to
      // resend the whole object.
      maxTokens: THINKING_HEADROOM_TOKENS,
      tier: "capable",
      temperature: 1,
    },
    validate,
  );
}
