/**
 * Shapes for the Living Table's tiered working memory (DESIGN.md, "Working
 * memory: tiers, not `slice(-10)`"). Three tiers, one state object:
 *
 *   1. verbatim recent  -- LogEntry with tier "verbatim"
 *   2. condensed         -- LogEntry with tier "condensed"
 *   3. permanent facts   -- MemoryFact[], never itself compressed away
 *
 * Tiers 1 and 2 share LogEntry's shape because the DM's context is built by
 * reading state.log in order regardless of tier (see contextBuilder.ts); the
 * tier tag is what tells the builder which section a given entry belongs in
 * and what condenseOldest is allowed to touch.
 */

export type MemoryFactCategory = "npc" | "promise" | "item" | "event" | "thread";

/**
 * One piece of evidence behind a fact, tagged with the scene it came from.
 * The scene number is the whole point: a gauntlet critic drove a real
 * campaign through this subsystem and found a tollkeeper's fact ending up
 * with "Voss always put the price up when the water came up" (a habitual
 * present-tense line from scene 4) sitting in the same undifferentiated
 * bullet as "Voss is dead before he goes down" (scene 8), with nothing to
 * say which one supersedes the other. Mentions used to be bare strings
 * unioned into a set, so provenance was destroyed at merge time. With the
 * scene attached, contextBuilder can print "(scene 8)" next to the death
 * and the DM can read the order for itself.
 */
export interface FactMention {
  sceneSeq: number;
  text: string;
}

/**
 * One durable, structured campaign fact. `key` is the identity a fact is
 * upserted by (see workingMemory.ts's condenseOldest): a fact about the same
 * NPC or promise updates its `fact`/`status` in place rather than duplicating,
 * because "an NPC's disposition can change; the record of having met them
 * can't disappear" (DESIGN.md). `fact` is deliberately a loose bag rather
 * than a fixed schema per category -- a promise and an NPC don't carry the
 * same fields, and the extraction pass (the injected `summarize` function)
 * is the thing that decides what belongs in it.
 *
 * By convention `fact.mentions` is a `FactMention[]`: workingMemory.ts's
 * merge path knows that key specifically, and bounds it to the newest few
 * so a fact's evidence cannot grow forever. `key` and `status` are the parts
 * that are never dropped by any bound in this subsystem.
 */
export interface MemoryFact {
  category: MemoryFactCategory;
  key: string;
  fact: Record<string, unknown>;
  status: string;
}

/**
 * A fact the DM's own turn supplied (`memoryFacts` on the DM turn schema),
 * as opposed to one this repo's heuristic summarizer inferred. Deliberately
 * looser than MemoryFact on one field: a model asked for "a fact" will
 * sometimes hand back a sentence rather than an object, and normalizing that
 * into `{ summary }` at the boundary is cheaper than a validator rejecting
 * an otherwise perfectly good fact. Everything else is the same shape, so a
 * supplied fact drops straight into tier 3 once normalized.
 */
export interface DmSuppliedFact {
  category: MemoryFactCategory;
  key: string;
  fact: Record<string, unknown> | string;
  status: string;
}

/**
 * One scene's worth of narration, at whichever tier it currently lives in.
 * `sceneSeq` is the scene it originated from, kept even after condensation so
 * the DM's context (and any debugging) can still say "this is what happened
 * in scene 4" rather than losing the ordering once the text is compressed.
 */
export interface LogEntry {
  sceneSeq: number;
  tier: "verbatim" | "condensed";
  content: string;
  /**
   * Facts the DM's own turn stated for THIS scene. A MERGE HINT, not the
   * only copy: addSceneNarration upserts them into tier 3 the moment they
   * arrive, and keeps them here so that when this scene finally condenses
   * they can be re-applied over whatever the heuristic inferred from the
   * same prose (workingMemory.ts's condenseOldest).
   *
   * They are held on the entry rather than handed to condenseOldest directly
   * because condensation runs on the OLDEST verbatim scene, several scenes
   * behind the turn that produced these: passing them in at call time would
   * file scene 14's facts under scene 10's condensation. Being the only copy
   * was the bug, not being held here: an entry's facts are consumed four
   * scenes late at the default threshold, and the persistence call sends
   * `content` only, so a reload inside that window rebuilt the entry with no
   * suppliedFacts at all and the record the player's credit bought was gone.
   */
  suppliedFacts?: MemoryFact[];
}

/**
 * The whole of working memory. `log` holds tiers 1 and 2 together, oldest
 * first, so "the oldest verbatim entry" (what condenseOldest acts on) is
 * just the first entry in log with tier "verbatim". `facts` is tier 3, flat
 * and unordered by design -- contextBuilder groups it by category for
 * presentation, but nothing here depends on facts being in any particular
 * order.
 */
export interface WorkingMemoryState {
  log: LogEntry[];
  facts: MemoryFact[];
}
