/**
 * Renders WorkingMemoryState into the single string that goes into the DM's
 * system prompt (DESIGN.md, "The DM's prompt is built from tier 3 in full,
 * tier 2 as a compact digest, and tier 1 verbatim"). Fixed section order,
 * least to most detailed: permanent facts first because they're what must
 * never be missed, then condensed history for background colour, then the
 * verbatim recent scenes the DM is actually continuing from.
 *
 * Returns a plain string, not a structured object, on purpose -- dm/
 * concatenates this with the rest of the system prompt, and a plain string
 * is the only shape that composes with string concatenation without every
 * caller having to know this module's internal section format.
 */
import type { FactMention, MemoryFact, MemoryFactCategory, WorkingMemoryState } from "./types";
import { coerceMentions } from "./workingMemory";

/**
 * Category order is fixed rather than "whatever order facts were inserted
 * in," so the DM's context reads the same shape every turn regardless of
 * which facts happened to be extracted first -- npc and promise lead
 * because they're what the DM most often needs to check before speaking in
 * character or offering a reward.
 */
const CATEGORY_ORDER: MemoryFactCategory[] = ["npc", "promise", "item", "event", "thread"];

const CATEGORY_LABEL: Record<MemoryFactCategory, string> = {
  npc: "NPCs",
  promise: "Promises",
  item: "Items",
  event: "Events",
  thread: "Threads",
};

/**
 * The one instruction that makes this section mean something. Without it the
 * DM was handed a list under the heading PERMANENT CAMPAIGN FACTS with no
 * statement of what it was supposed to do about them, in a prompt that
 * polices dice rolls in three separate paragraphs. Written in that same
 * register deliberately: a flat rule, the consequence spelled out, no hedge.
 */
const FACT_RULE =
  "These campaign facts are established and binding. You may reveal new information about them; you may never " +
  "contradict one. If a fact says an NPC is dead, that NPC does not appear, speak, or trade.";

/**
 * How many facts get their supporting evidence printed. Every fact ALWAYS
 * gets its key, category and status line -- that's the part DESIGN.md calls
 * permanent and it is never bounded away. What's bounded is the quoted
 * evidence underneath, given to the most recently touched facts, because
 * that's where the DM needs the detail (an NPC it is about to have speak)
 * and because printing every fact's evidence is what made tier 3 54 percent
 * of a fourteen-scene prompt and still growing.
 */
const FACTS_WITH_EVIDENCE = 8;

/**
 * How many fact HEADLINES the block prints. This is the bound tier 3 did not
 * have, and the distinction it rests on is worth stating exactly, because
 * DESIGN.md is explicit that tier 3 is "append-only... never itself
 * compressed away" and nothing here contradicts that: the fact STORE is
 * still permanent and nothing is ever evicted from it (workingMemory.ts's
 * upsertFact only ever adds or merges). What is bounded is how many of those
 * facts are printed into one prompt, which is the thing that actually costs
 * tokens.
 *
 * It needed a bound because it was the fastest growing part of the block and
 * the only part with no ceiling at all. A critic measured a sixty scene
 * campaign with a cast growing the way a real one's does and the DM emitting
 * a fact a turn as the prompt asks: scene 14, 21 facts, tier 3 at 51 percent
 * of the block; scene 30, 53 facts, 62 percent; scene 60, 113 facts, 73
 * percent. Dead linear at 136 chars a scene, in the tier that never shrinks.
 *
 * The bound is PER CATEGORY, not one global number, because the categories
 * are not interchangeable and one of them floods. Nearly every named thing
 * the heuristic sees resolves to an npc, so a single global cap would let a
 * long cast list crowd out the Promises section entirely, and a forgotten
 * promise is the failure this tier exists to prevent. A per-category bound
 * guarantees the section's SHAPE is the same at scene 60 as at scene 6.
 *
 * WHAT GETS THE SLOTS within a category, in order: a fact the model itself
 * authored (it paid a credit to say that, and it is the only extraction here
 * that actually knows), then a fact whose status says something HAPPENED to
 * it (dead, stolen, outstanding: see workingMemory.ts's statusRank), then
 * the most recently mentioned. What loses is a neutral, heuristic-guessed
 * "noted" on a name nobody has touched in forty scenes. Anything cut is
 * COUNTED in the block rather than silently dropped, so the DM reads its
 * list as partial rather than as exhaustive.
 */
const MAX_HEADLINES_PER_CATEGORY: Record<MemoryFactCategory, number> = {
  npc: 12,
  promise: 8,
  item: 8,
  event: 6,
  thread: 6,
};

/** Status words that mean something happened. Kept in step with workingMemory.ts's statusRank, which is the merge-policy half of the same idea. */
const STATEFUL_STATUS =
  /\b(dead|destroyed|resolved|kept|broken|betrayed|outstanding|taken|stolen|missing|wounded|hostile|unsolved|open)\b/i;

/** The newest scene this fact has evidence from, used to decide which facts are worth spending evidence lines on. */
function factRecency(f: MemoryFact): number {
  const mentions = coerceMentions(f.fact.mentions);
  if (!mentions || mentions.length === 0) return -1;
  return Math.max(...mentions.map((m) => m.sceneSeq));
}

/** Ranked highest-first: model-authored, then status-bearing, then most recent. See MAX_HEADLINES_PER_CATEGORY. */
function factPriority(f: MemoryFact): number {
  return (f.fact.statusSource === "model" ? 4 : 0) + (STATEFUL_STATUS.test(f.status) ? 2 : 0);
}

/**
 * One fact rendered as a headline: key, status, then any non-evidence fields
 * as compact key:value pairs. `statusSource` is bookkeeping this module
 * writes for itself (workingMemory.ts's provenance stamp), not something the
 * DM should be reading back as if it were part of the fact.
 */
function renderFactHeadline(f: MemoryFact): string {
  const fields = Object.entries(f.fact)
    .filter(([k]) => k !== "mentions" && k !== "statusSource")
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(", ");
  return `- ${f.key} [${f.status}]${fields ? ` -- ${fields}` : ""}`;
}

/** Evidence lines under a headline, each stamped with the scene it came from so the DM can read supersession off the page. */
function renderMentions(mentions: FactMention[]): string[] {
  return mentions.map((m) => (m.sceneSeq >= 0 ? `    (scene ${m.sceneSeq}) ${m.text}` : `    ${m.text}`));
}

function renderFacts(facts: MemoryFact[]): string {
  if (facts.length === 0) return "PERMANENT CAMPAIGN FACTS: none yet.";

  // Which facts get a headline at all (see MAX_HEADLINES_PER_CATEGORY),
  // chosen per category by priority. Order WITHIN a category stays insertion
  // order, so the cap changes which facts are shown and never the shape of
  // the section.
  const shownByCategory = new Map<MemoryFactCategory, MemoryFact[]>();
  let omitted = 0;
  for (const category of CATEGORY_ORDER) {
    const inCategory = facts.filter((f) => f.category === category);
    const cap = MAX_HEADLINES_PER_CATEGORY[category];
    if (inCategory.length <= cap) {
      shownByCategory.set(category, inCategory);
      continue;
    }
    const keep = new Set(
      [...inCategory]
        .sort((a, b) => factPriority(b) - factPriority(a) || factRecency(b) - factRecency(a))
        .slice(0, cap),
    );
    shownByCategory.set(category, inCategory.filter((f) => keep.has(f)));
    omitted += inCategory.length - cap;
  }

  const withEvidence = new Set(
    [...shownByCategory.values()]
      .flat()
      .sort((a, b) => factRecency(b) - factRecency(a))
      .slice(0, FACTS_WITH_EVIDENCE)
      .map((f) => f.key),
  );

  const lines = [FACT_RULE, "PERMANENT CAMPAIGN FACTS:"];
  for (const category of CATEGORY_ORDER) {
    const inCategory = shownByCategory.get(category) ?? [];
    if (inCategory.length === 0) continue;
    lines.push(`${CATEGORY_LABEL[category]}:`);
    for (const f of inCategory) {
      lines.push(renderFactHeadline(f));
      const mentions = withEvidence.has(f.key) ? coerceMentions(f.fact.mentions) : null;
      if (mentions && mentions.length > 0) lines.push(...renderMentions(mentions));
    }
  }
  // Stated rather than silent: the DM is told its view of the record is
  // partial, so an older fact it cannot see reads as "ask, don't assume"
  // instead of as "that never happened."
  if (omitted > 0) {
    lines.push(
      `(${omitted} older campaign fact${omitted === 1 ? "" : "s"} are on record but not listed here. They are still true; ` +
        `do not assert the opposite of something just because it is missing from this list.)`,
    );
  }
  return lines.join("\n");
}

/**
 * Build the DM's memory context block: permanent facts in full, then the
 * condensed digests in log order, then the verbatim recent scenes in log
 * order. Empty sections are omitted rather than printed as headers with
 * nothing under them -- a brand-new campaign's context shouldn't read as
 * three empty lists before play has even produced anything to remember.
 *
 * The block's size is bounded, and that is a property of this subsystem
 * rather than a hope: tier 1 by needsCondensation, tier 2 by
 * MAX_CONDENSED_ENTRIES, tier 3 by MAX_HEADLINES_PER_CATEGORY, and tier 3's evidence
 * by MAX_MENTIONS_PER_FACT and FACTS_WITH_EVIDENCE above.
 * test/livingtable-memory.test.ts runs sixty scenes of real prose through it
 * with the DM emitting a fact a turn, and asserts that the ceiling is
 * reached and then HELD (scene 60 within a few hundred chars of scene 30),
 * rather than asserting a growth rate under some constant, which a linear
 * block passes just as happily as a bounded one.
 *
 * The bound is on what this function PRINTS, never on what tier 3 holds:
 * DESIGN.md's "append-only... never itself compressed away" is a promise
 * about the record, and the record still keeps everything (see
 * MAX_HEADLINES_PER_CATEGORY for how the printed subset is chosen and why the DM is
 * told when its view is partial).
 */
export function buildDmContextBlock(state: WorkingMemoryState): string {
  const sections: string[] = [renderFacts(state.facts)];

  const condensed = state.log.filter((e) => e.tier === "condensed");
  if (condensed.length > 0) {
    sections.push(["CONDENSED HISTORY:", ...condensed.map((e) => `- (scene ${e.sceneSeq}) ${e.content}`)].join("\n"));
  }

  const verbatim = state.log.filter((e) => e.tier === "verbatim");
  if (verbatim.length > 0) {
    sections.push(
      ["RECENT SCENES, IN FULL:", ...verbatim.map((e) => `-- scene ${e.sceneSeq} --\n${e.content}`)].join("\n\n"),
    );
  }

  return sections.join("\n\n");
}
