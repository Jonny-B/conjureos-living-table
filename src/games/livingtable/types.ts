/**
 * Local shared shapes for the Living Table screen (LivingTable.tsx and its
 * session/ helpers). Kept inside src/games/livingtable/ on purpose rather
 * than the app-wide src/types.ts: this integration pass was scoped to leave
 * that file untouched, and nothing here needs to be known outside this
 * game's own folder.
 */
import type { TemplateGenre } from "./characters/templates";

/**
 * What the campaign-arc generator (campaignGenerator.ts) validates a
 * completeJson reply into, and what `game_campaigns.arc_outline` stores. A
 * throughline (the one-sentence spine), a handful of named beats (what
 * actually happens, in order, as pacing guidance, not a script), and at
 * least one named NPC per DESIGN.md's "at least one named NPC per
 * template's genre" requirement.
 */
export interface ArcOutline {
  throughline: string;
  beats: string[];
  npcs: { name: string; role: string }[];
  /**
   * A handful of cells around the origin with a one-line sense of what is
   * there, tied to the beats: the campaign's GEOGRAPHY, which the outline
   * carried none of until now.
   *
   * This is what makes a fog crossing read as revealing something the DM had
   * already committed to instead of inventing on the spot. world/perception's
   * `getOffscreenCells` takes a `hints` map and nobody ever had anything to
   * pass it, so every neighbour in every prompt rendered as "not built yet --
   * unexplored". Optional on the type because a campaign row generated before
   * this existed has none, and a missing sketch has to degrade to the old
   * generic hint rather than break the campaign.
   */
  regionSketch?: RegionHint[];
}

/** One planned cell: where it is, and one line on what is there. */
export interface RegionHint {
  cx: number;
  cy: number;
  hint: string;
}

/**
 * The sketch keyed the way `getOffscreenCells(world, cx, cy, hints)` wants
 * it (world/coordinates.ts's `cellKey`, "cx,cy"), so threading a campaign's
 * geography into a DM prompt is one call at each site rather than a reshaping
 * loop copied twice.
 */
export function regionHints(outline: ArcOutline): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of outline.regionSketch ?? []) out[`${entry.cx},${entry.cy}`] = entry.hint;
  return out;
}

/**
 * Defensive parse of a stored `regionSketch`, matching how LivingTable.tsx
 * already coerces the rest of a persisted arc outline: this is data this app
 * itself wrote, so it only guards against a legacy row (no sketch at all) or
 * a malformed one, never an adversarial shape. A malformed entry is dropped
 * rather than throwing, because a bad hint must never be able to make an
 * existing campaign unopenable.
 */
export function coerceRegionSketch(v: unknown): RegionHint[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((entry) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .filter((entry) => Number.isInteger(entry.cx) && Number.isInteger(entry.cy) && typeof entry.hint === "string")
    .map((entry) => ({ cx: entry.cx as number, cy: entry.cy as number, hint: entry.hint as string }));
}

/** One row from ltCampaignList, template-typed rather than the wire's bare string. */
export interface CampaignSummary {
  id: string;
  template: TemplateGenre;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/** ltCampaignGet's campaign row, arcOutline parsed into the real shape rather than left as `unknown`. */
export interface CampaignDetail {
  id: string;
  template: TemplateGenre;
  title: string;
  arcOutline: ArcOutline;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Where the party currently stands. DESIGN.md doesn't specify persisting
 * this across sessions explicitly, so this integration pass stores it
 * inside the player character's own `stats` blob (see LivingTable.tsx's
 * header comment for the reasoning), updated via ltCharacterUpdate whenever
 * it changes, rather than as a new column or a separate table.
 */
export interface Position {
  cx: number;
  cy: number;
}
