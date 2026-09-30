/**
 * Turn `ltCampaignGet`'s flat `log` rows back into a WorkingMemoryState.log
 * (memory/types.ts's LogEntry[]): one entry per scene, tier "verbatim" or
 * "condensed".
 *
 * The real `ltMemoryAppend` handler only ever INSERTs into `game_memory_log`
 * (see the ConjureOS repo's games-db/index.ts): there is no update or
 * delete action for it. When condensation replaces a scene's tier
 * client-side (memory/workingMemory.ts's condenseOldest swaps a "verbatim"
 * LogEntry for a "condensed" one at the same sceneSeq), persisting that as
 * a second `ltMemoryAppend` call leaves BOTH rows sitting in the table
 * forever, since there is no action to remove the old one. On the next
 * load, `ltCampaignGet` hands back both rows for that sceneSeq, which
 * memory/types.ts's model (one LogEntry per sceneSeq) was never built to
 * expect.
 *
 * This is the honest client-side fix given the actual action set (not a
 * backend change this pass is scoped to make): dedupe by sceneSeq, and
 * whenever a scene has both tiers on record, trust "condensed" over
 * "verbatim" (condensation is monotonic, once a scene has been condensed it
 * should always be read that way, even though the superseded verbatim row
 * is still physically in the table).
 */
import type { LtMemoryLogRow } from "../../../bridge/gamesApi";
import type { LogEntry } from "../memory/types";
import { MAX_CONDENSED_ENTRIES } from "../memory/workingMemory";

export function dedupeLog(rows: LtMemoryLogRow[]): LogEntry[] {
  const bySceneSeq = new Map<number, LogEntry>();
  for (const row of rows) {
    const existing = bySceneSeq.get(row.sceneSeq);
    if (!existing || existing.tier === "verbatim") {
      bySceneSeq.set(row.sceneSeq, { sceneSeq: row.sceneSeq, tier: row.tier, content: row.content });
    }
  }
  const ordered = [...bySceneSeq.values()].sort((a, b) => a.sceneSeq - b.sceneSeq);

  // Tier 2's cap has to be enforced on the way IN as well as during play.
  // `ltMemoryAppend` is insert-only (see above), so every digest a campaign
  // has ever produced is still in `game_memory_log`; without this, reloading
  // a long campaign hands back thirty digests and re-inflates the DM's
  // context block past the ceiling the memory module just spent three bounds
  // establishing. Dropping them is safe for the same reason the in-play fold
  // is (memory/workingMemory.ts's foldExcessCondensed): tier 2 is lossy by
  // design, and what had to survive those scenes was extracted into tier 3
  // and persisted separately as facts.
  const condensed = ordered.filter((e) => e.tier === "condensed");
  if (condensed.length <= MAX_CONDENSED_ENTRIES) return ordered;
  const keep = new Set(condensed.slice(-MAX_CONDENSED_ENTRIES).map((e) => e.sceneSeq));
  return ordered.filter((e) => e.tier !== "condensed" || keep.has(e.sceneSeq));
}
