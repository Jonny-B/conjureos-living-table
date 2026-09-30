/**
 * Tier transitions for working memory (DESIGN.md, "Working memory: tiers,
 * not `slice(-10)`"). Everything here is a pure function over
 * WorkingMemoryState -- state is threaded functionally throughout, like
 * world/, so a caller can always diff before/after or hand an old state to
 * a retry without it having been mutated out from under them.
 *
 * The summarization pass (`summarize` in condenseOldest) is INJECTED, never
 * called directly from here. This module has no import of bridge/ai and
 * never will: it has to stay testable with a fake summarizer, because a
 * condensation pass that silently drops the wrong thing is worse than no
 * condensation at all, and that's only provable with a deterministic test.
 *
 * This module also owns the subsystem's SIZE CEILING, which it did not used
 * to. A gauntlet critic measured the DM's memory block over a real fourteen
 * scene campaign and got 763, 1593, 2400, ... 13331 chars: dead linear at
 * about 1018 chars a scene, projecting 100k by scene 100, because only tier
 * 1 was ever capped. Tiers 2 and 3 grew forever, and tier 3 -- the tier
 * DESIGN.md calls permanent -- was already 54 percent of the block by scene
 * 14. Condensation was therefore costing the player tokens rather than
 * saving them. The three bounds that fix it, and what each one refuses to
 * drop, are: MAX_CONDENSED_ENTRIES (tier 2 digests past the cap fold into a
 * single rolling tier 3 fact and leave the block; tier 2 is lossy by design
 * and what had to survive was extracted into tier 3 at condensation time),
 * MAX_MENTIONS_PER_FACT (a fact keeps its newest few pieces of evidence, and
 * ALWAYS its key, category and status, which is the part that must never be
 * lost), and the caller-side tier 1 bound that verbatimSceneSeqs exposes.
 * Tier 3's own bound is on what contextBuilder PRINTS, not on what this
 * module stores: nothing is ever evicted here, which is what DESIGN.md's
 * "append-only... never itself compressed away" actually promises.
 *
 * Two things below are load-bearing beyond that and worth finding fast:
 * normalizeKey, which is what makes the model's own key shape and the
 * heuristic's key shape the SAME record instead of two contradictory ones;
 * and the provenance stamp in upsertFact, which is what stops the heuristic
 * restating a fact the model paid a credit to author.
 */
import type { DmSuppliedFact, FactMention, LogEntry, MemoryFact, MemoryFactCategory, WorkingMemoryState } from "./types";

/** Below this many verbatim entries, nothing has to condense yet. Small on purpose -- see needsCondensation. */
const DEFAULT_VERBATIM_THRESHOLD = 4;

/**
 * How many condensed digests tier 2 may hold before the oldest start folding
 * into tier 3 and dropping out of the DM's block. Six is roughly a session's
 * worth of background beyond the verbatim window: enough that the DM can see
 * how the last stretch of play went, small enough that tier 2 is a fixed
 * cost rather than a growing one.
 */
export const MAX_CONDENSED_ENTRIES = 6;

/** The newest N pieces of evidence a single fact keeps. Its key, category and status are never bounded away, only its supporting quotes. */
export const MAX_MENTIONS_PER_FACT = 3;

/** The rolling tier 3 fact that tier 2 overflow folds into, so a dropped digest leaves a trace instead of vanishing silently. */
export const EARLIER_SCENES_FACT_KEY = "earlier scenes";

/** Empty state to start a fresh campaign from. */
export function emptyWorkingMemory(): WorkingMemoryState {
  return { log: [], facts: [] };
}

/** Normalize one DM-supplied fact into tier 3's shape: a bare sentence becomes `{ summary }` rather than being rejected. */
function normalizeSuppliedFact(supplied: DmSuppliedFact): MemoryFact {
  return {
    category: supplied.category,
    key: supplied.key,
    fact: typeof supplied.fact === "string" ? { summary: supplied.fact } : supplied.fact,
    status: supplied.status,
  };
}

/**
 * The DM turn's own `memoryFacts` array in tier 3's shape, for a caller that
 * needs to persist them the moment they arrive rather than waiting for
 * condensation (see addSceneNarration). Exported because the persistence call
 * site is outside this module and must POST exactly what addSceneNarration
 * just folded in, not the raw looser DmSuppliedFact shape.
 */
export function normalizeSuppliedFacts(supplied: DmSuppliedFact[]): MemoryFact[] {
  return supplied.map(normalizeSuppliedFact);
}

/**
 * Append one scene's narration as a fresh verbatim entry. Always appended at
 * the end of `log`, so log stays oldest-first regardless of tier -- that
 * ordering is what lets condenseOldest find "the oldest verbatim entry" by
 * just scanning from the front, and what lets contextBuilder read tier 2
 * before tier 1 without a separate sort.
 *
 * `suppliedFacts` is the DM turn's own `memoryFacts` array for this scene,
 * if it sent one. It goes into tier 3 IMMEDIATELY, and is also parked on the
 * entry so condensation can re-apply it over whatever the heuristic later
 * infers for the same scene: the model knows which NPC it just killed and
 * this repo's word-frequency heuristic is only guessing.
 *
 * Landing it immediately is the fix for a real loss window. Parking it on
 * the entry used to be the ONLY copy, and an entry's facts are consumed when
 * that scene becomes the oldest verbatim one, four scenes later at the
 * default threshold. Meanwhile the persistence call only sends `content`, so
 * a reload rebuilt the LogEntry with no suppliedFacts at all: an adversary
 * measured scene 3 carrying ["alderic-voss"] before a reload and `undefined`
 * after it. A player who closed the tab within four scenes of a murder
 * permanently lost the DM's own record of it, and the credit they paid for
 * that turn had bought exactly that record.
 */
export function addSceneNarration(
  state: WorkingMemoryState,
  sceneSeq: number,
  text: string,
  suppliedFacts?: DmSuppliedFact[],
): WorkingMemoryState {
  const entry: LogEntry = { sceneSeq, tier: "verbatim", content: text };
  if (!suppliedFacts || suppliedFacts.length === 0) return { ...state, log: [...state.log, entry] };

  const normalized = normalizeSuppliedFacts(suppliedFacts);
  entry.suppliedFacts = normalized;
  const facts = normalized.reduce((acc, fact) => upsertFact(acc, fact, true), state.facts);
  return { log: [...state.log, entry], facts };
}

/**
 * True once verbatim entries outnumber the threshold. Strictly "exceeds",
 * not "reaches" -- a campaign sitting exactly at the threshold is still
 * fully within budget, condensation only has to fire once there's one too
 * many. Default is deliberately small (4) so the DM's context stays a
 * handful of full scenes, not a growing transcript; a game-facing caller can
 * pass a larger threshold if scenes run short.
 */
export function needsCondensation(state: WorkingMemoryState, threshold = DEFAULT_VERBATIM_THRESHOLD): boolean {
  const verbatimCount = state.log.filter((e) => e.tier === "verbatim").length;
  return verbatimCount > threshold;
}

/**
 * Which scenes are still tier 1, oldest first. This is the contract the
 * caller needs to stop double-paying for its own memory: LivingTable.tsx
 * sends the whole raw chat transcript as `messages` AND the memory block as
 * part of the system prompt, so at scene 14 scenes 1 to 10 were in the
 * prompt twice (once in full as a transcript message, once as a condensed
 * digest) and their key sentences a third time inside fact evidence. Only
 * the scenes still listed here need to be sent raw; everything older is
 * already represented by tiers 2 and 3.
 */
export function verbatimSceneSeqs(state: WorkingMemoryState): number[] {
  return state.log.filter((e) => e.tier === "verbatim").map((e) => e.sceneSeq);
}

/** The oldest scene still held verbatim, or null when nothing is. A caller can drop every transcript message from before it. */
export function oldestVerbatimSceneSeq(state: WorkingMemoryState): number | null {
  const seqs = verbatimSceneSeqs(state);
  return seqs.length > 0 ? seqs[0]! : null;
}

// ── fact identity, merging and bounds ────────────────────────────────────

/**
 * How specific a category is. When two extractions disagree about what an
 * entity IS (the heuristic classifies from whatever cues happen to be in a
 * given scene's prose, so the same name can read as an "event" in one scene
 * and an "npc" in the next), the more specific label wins rather than the
 * later one. Without this the same person accumulates one record per
 * category the heuristic ever guessed, which is exactly the "a DM reads 15
 * entities where the campaign has about 8" failure a critic measured.
 */
const CATEGORY_SPECIFICITY: Record<MemoryFactCategory, number> = { event: 0, thread: 1, item: 2, npc: 3, promise: 4 };

/**
 * Status words that describe a state something cannot casually come back
 * from, and status words that describe an active-but-not-final state. This
 * is a merge policy, not a vocabulary the summarizer has to obey: an unknown
 * status just ranks 0 and behaves exactly the way every status behaved
 * before this existed (last writer wins).
 *
 * Why it has to exist at all: statuses are derived per scene, so a scene
 * that kills the tollkeeper writes "dead" and the very next scene that
 * mentions him in passing used to overwrite that with a neutral "noted",
 * and the one thing a DM most needs to know (do not have this man speak)
 * was gone one scene after it was learned.
 */
const TERMINAL_STATUS_WORDS = ["dead", "destroyed", "resolved", "kept", "broken", "betrayed"];
const ACTIVE_STATUS_WORDS = ["outstanding", "taken", "stolen", "missing", "wounded", "hostile", "unsolved", "open"];

function statusRank(status: string): number {
  const lower = status.toLowerCase();
  if (TERMINAL_STATUS_WORDS.some((w) => new RegExp(`\\b${w}\\b`).test(lower))) return 2;
  if (ACTIVE_STATUS_WORDS.some((w) => new RegExp(`\\b${w}\\b`).test(lower))) return 1;
  return 0;
}

/**
 * Read `fact.mentions` as FactMention[], tolerating the older bare-string
 * shape that may still be sitting in `game_memory_facts` rows written before
 * mentions carried provenance. An unknown scene is recorded as -1 rather
 * than guessed, so nothing pretends to know where an old quote came from.
 */
export function coerceMentions(value: unknown): FactMention[] | null {
  if (!Array.isArray(value)) return null;
  const out: FactMention[] = [];
  for (const item of value) {
    if (typeof item === "string") out.push({ sceneSeq: -1, text: item });
    else if (item && typeof item === "object" && typeof (item as FactMention).text === "string") {
      const m = item as FactMention;
      out.push({ sceneSeq: typeof m.sceneSeq === "number" ? m.sceneSeq : -1, text: m.text });
    } else return null;
  }
  return out;
}

/** Union two evidence lists by (scene, text), oldest first, then keep only the newest few. */
function mergeMentions(prior: FactMention[], incoming: FactMention[]): FactMention[] {
  const byIdentity = new Map<string, FactMention>();
  for (const m of [...prior, ...incoming]) byIdentity.set(`${m.sceneSeq}\u0000${m.text}`, m);
  return [...byIdentity.values()].sort((a, b) => a.sceneSeq - b.sceneSeq).slice(-MAX_MENTIONS_PER_FACT);
}

/**
 * Merge one fact's content into another's on a key collision, rather than
 * blindly replacing it. A gauntlet critic reproduced the exact "DM forgets a
 * murder" failure mode with ordinary prose: two later scenes both mentioned
 * "Voss" for unrelated reasons, and the second condensation cycle silently
 * discarded the first's evidence.
 *
 * Evidence accumulates rather than overwrites, and is bounded to the newest
 * MAX_MENTIONS_PER_FACT so accumulation can't become the new unbounded
 * growth: at scene 14 a critic measured single facts carrying 500-plus char
 * mention arrays that were re-POSTed in full on every condensation. Any
 * other fact shape (a category whose extraction doesn't use `mentions`)
 * still gets a plain overwrite, which is the same behaviour this function
 * always had, stated as a real fallback rather than papered over.
 */
function mergeFactContent(prior: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const priorMentions = coerceMentions(prior.mentions);
  const incomingMentions = coerceMentions(incoming.mentions);
  if (priorMentions && incomingMentions) return { ...incoming, mentions: mergeMentions(priorMentions, incomingMentions) };
  // Incoming carries no evidence of its own (a DM-supplied fact, typically):
  // keep what the earlier extraction found rather than blanking it.
  if (priorMentions && !incomingMentions) return { ...incoming, mentions: priorMentions };
  if (incomingMentions) return { ...incoming, mentions: incomingMentions.slice(-MAX_MENTIONS_PER_FACT) };
  return incoming;
}

/**
 * Reduce a key to its identity: casefolded, slug punctuation turned back
 * into spaces, whitespace collapsed. This is the fix for the single worst
 * defect this subsystem has had, and it is worth stating plainly because the
 * whole DM-typed-fact path rested on it.
 *
 * dm/promptBuilder.ts instructs the model to emit `"key":"a-stable-slug"`
 * and its own worked examples are `maren-new-moon` and `harrow`. The
 * heuristic, meanwhile, invents the capitalised phrase it found in the prose
 * ("Alderic Voss"). Matching raw strings, those two can NEVER be the same
 * record: an adversary ran one murder scene three ways and got two separate
 * tier 3 entries every time except when the model happened to guess the
 * exact capitalisation the heuristic had invented. The DM was then handed
 * "- Alderic Voss [dead (heuristic)]" and "- alderic-voss [dead, murdered
 * before first light]" three lines apart, under a heading telling it these
 * facts are binding and must never be contradicted.
 *
 * So identity is normalised before anything is compared. `alderic-voss`,
 * `Alderic_Voss` and `Alderic Voss` are one key; `voss` still needs the
 * alias rule below, because it is a genuinely different (shorter) name.
 */
function normalizeKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * A key that reads as a plain name phrase ("Alderic Voss", "alderic-voss"),
 * the only shape the alias rule below is willing to guess about. Tested on
 * the NORMALIZED key, so a slug qualifies: refusing to consider anything
 * with a hyphen was what made the model's own prescribed key shape
 * unreachable by the alias rule as well as by exact match.
 */
function isPlainNameKey(normalized: string): boolean {
  return /^[a-z]+(?: [a-z]+)*$/.test(normalized);
}

/** True when `shortKey`'s words are a strict trailing slice of `longKey`'s ("voss" of "alderic voss"). Both already normalized. */
function isNameSuffixOf(shortKey: string, longKey: string): boolean {
  const short = shortKey.split(" ");
  const long = longKey.split(" ");
  if (short.length >= long.length) return false;
  return short.every((word, i) => word === long[long.length - short.length + i]);
}

/**
 * Two categories that could plausibly be the same entity seen from two
 * angles. The heuristic classifies from whatever cues one scene's prose
 * happened to carry, so npc, item, thread and event are all guesses at the
 * same question ("what is this named thing") and all mutually confusable:
 * an adversary's finished Items list read "Voss", "Sella", "Tideglass
 * Compass", two of which are people and one of which is a murder victim
 * simultaneously filed as loot the party was carrying. Keeping them
 * incompatible did not prevent that misfiling, it only made it PERMANENT,
 * because the item record could then never merge with the npc one.
 * CATEGORY_SPECIFICITY decides which label survives the merge.
 *
 * "promise" is the exception and stays on its own: its keys are structurally
 * distinct ("promise: Perrin & Sella"), so it never needs this, and letting
 * it merge would let an NPC named Sella swallow a vow made to her.
 */
function categoriesCompatible(a: MemoryFactCategory, b: MemoryFactCategory): boolean {
  if (a === b) return true;
  return a !== "promise" && b !== "promise";
}

/**
 * The people a promise key names: "promise: Perrin & Sella" -> ["perrin",
 * "sella"], the shape the heuristic writes.
 *
 * A DM-typed promise is keyed as a slug instead (promptBuilder.ts's own
 * worked example is `maren-new-moon`), so its subject has to be recovered
 * from the words in it. Only words that are ALREADY a name on record in tier
 * 3 count: "maren" is a person the campaign knows about, "new" and "moon"
 * are not, and matching on a word like "new" would fold two unrelated vows
 * into one record and print the second as a contradiction of the first.
 */
function promiseSubjects(key: string, facts: MemoryFact[]): string[] {
  const prefixed = /^promise:\s*(.+)$/i.exec(key.trim());
  if (prefixed) {
    return prefixed[1]!
      .split("&")
      .map((s) => normalizeKey(s))
      .filter((s) => s.length > 0);
  }
  const known = new Set(facts.filter((f) => f.category !== "promise").map((f) => normalizeKey(f.key)));
  return normalizeKey(key)
    .split(" ")
    .filter((word) => known.has(word));
}

/**
 * Find the existing fact `incoming` should update, by key. Identity is the
 * KEY, not (category, key), which is what DESIGN.md actually says
 * ("append-only, update-in-place by `key`") and what stops one person from
 * being filed twice because two scenes' prose gave the classifier different
 * cues.
 *
 * Three passes, narrowing:
 *
 * 1. Normalized exact match (see normalizeKey). This is what lets a
 *    DM-typed slug land on the heuristic's record at all.
 * 2. The alias rule, and it is a guess, stated as one: real prose names
 *    someone in full once and then uses the surname ("Alderic Voss" in scene
 *    1, "Voss" in scene 12), which used to produce two separate people in
 *    tier 3 with byte-identical evidence. Only plain name phrases qualify,
 *    only a strict word-suffix counts, and the categories have to be
 *    compatible. AMBIGUITY IS A REASON NOT TO MERGE: if the short name is a
 *    suffix of more than one established key, this declines. With `Bran
 *    Vetch` and `Sella Vetch` both on record, a scene that says "you find
 *    Vetch face down at the bottom of the mill steps" used to fold into
 *    whichever one was inserted first and answer a question the DM was
 *    deliberately holding open. Declining leaves a third, separate record,
 *    which reads as "somebody called Vetch died" -- exactly what is known.
 * 3. Promises match on their named SUBJECTS intersecting, so a vow made in
 *    scene 1 and discharged in scene 6 updates in place instead of standing
 *    beside itself as a second, contradictory record, and so a DM-typed
 *    `maren-new-moon` finds the heuristic's `promise: Maren`. Same ambiguity
 *    rule. Its documented limit: two separate vows to the same person
 *    collapse into one record whose evidence carries both quotes. That is
 *    the right way round, because the alternative was tier 3 printing "you
 *    owe her this" and "you have already done it" side by side under a rule
 *    that says the DM may never contradict either.
 */
function findFactIndex(facts: MemoryFact[], incoming: MemoryFact): number {
  const incomingKey = normalizeKey(incoming.key);
  const exact = facts.findIndex((f) => normalizeKey(f.key) === incomingKey);
  if (exact !== -1) return exact;

  /** Exactly one candidate is a merge; none or several is not. */
  const onlyMatch = (predicate: (f: MemoryFact) => boolean): number => {
    const matches: number[] = [];
    facts.forEach((f, i) => {
      if (predicate(f)) matches.push(i);
    });
    return matches.length === 1 ? matches[0]! : -1;
  };

  if (incoming.category === "promise") {
    const subjects = promiseSubjects(incoming.key, facts);
    if (subjects.length === 0) return -1;
    return onlyMatch(
      (f) => f.category === "promise" && promiseSubjects(f.key, facts).some((s) => subjects.includes(s)),
    );
  }

  if (!isPlainNameKey(incomingKey)) return -1;
  return onlyMatch((f) => {
    const key = normalizeKey(f.key);
    return (
      isPlainNameKey(key) &&
      categoriesCompatible(f.category, incoming.category) &&
      (isNameSuffixOf(key, incomingKey) || isNameSuffixOf(incomingKey, key))
    );
  });
}

/**
 * Which of two keys for the same record the DM should actually be shown.
 * The fuller name first ("Alderic Voss" over "Voss"), then the human-readable
 * form over the model's slug ("Alderic Voss" over "alderic-voss"), then the
 * capitalised form over the flat one ("Harrow" over "harrow"). None of this
 * changes identity -- normalizeKey already decided these are one record --
 * it only decides which spelling gets printed in the prompt.
 */
function preferredKey(prior: string, incoming: string): string {
  const words = (k: string): number => normalizeKey(k).split(" ").length;
  if (words(incoming) !== words(prior)) return words(incoming) > words(prior) ? incoming : prior;

  const isSlug = (k: string): boolean => /[-_]/.test(k);
  if (isSlug(incoming) !== isSlug(prior)) return isSlug(prior) ? incoming : prior;

  const capitalised = (k: string): boolean => /[A-Z]/.test(k);
  if (capitalised(incoming) !== capitalised(prior)) return capitalised(incoming) ? incoming : prior;

  return incoming.length > prior.length ? incoming : prior;
}

/**
 * Provenance, stored INSIDE the fact bag rather than beside it so it
 * survives the round trip through `ltFactUpsert` (which persists category,
 * key, `fact` and status, and nothing else) and comes back on reload. See
 * upsertFact for what it buys.
 */
const STATUS_SOURCE_FIELD = "statusSource";

/** True when this fact's CURRENT status was written by the model itself, not guessed by the heuristic. */
function holdsModelStatus(fact: MemoryFact): boolean {
  return fact.fact[STATUS_SOURCE_FIELD] === "model";
}

/**
 * Upsert one extracted fact into a fact list by key: update in place if that
 * identity already exists, append if it's new. Never removes an entry --
 * this is the mechanism behind DESIGN.md's "append-only, update-in-place by
 * key... never itself compressed away": an NPC's disposition can change, but
 * the record of having met them can't disappear, so the only two things this
 * function ever does are "add" and "merge the fields," never "delete."
 *
 * What wins on a merge, and why:
 *   - the LONGER key ("Alderic Voss" over "Voss"), because the fuller name
 *     is the more useful thing for the DM to read back;
 *   - the more SPECIFIC category (see CATEGORY_SPECIFICITY);
 *   - the higher-ranked STATUS (see statusRank), so a passing mention in a
 *     later scene cannot quietly resurrect a dead NPC;
 *   - accumulated, bounded evidence (see mergeFactContent).
 *
 * `supplied` flips all of those: a fact the DM itself stated for this scene
 * gets its category and status honoured exactly as written, downgrades
 * included, because unlike the heuristic it actually knows. Its evidence
 * still merges with whatever the heuristic found.
 *
 * And it does so DURABLY. `supplied` used to force the status only at the
 * moment the supplied fact was folded in; on every later condensation the
 * heuristic competed on statusRank alone and a terminal word won. An
 * adversary had the DM state {key:"Bran Vetch", status:"alive, running the
 * mill"} in scene 2 and read "dead (heuristic)" off the same record by scene
 * 14: the player paid a credit for the model to author that fact and an
 * unsupervised string matcher replaced it with the opposite. So a
 * model-authored status is stamped (STATUS_SOURCE_FIELD) and the heuristic
 * may never restate it afterwards, at any rank, at any later cycle. It may
 * still APPEND evidence, which is the part it is actually good at.
 */
function upsertFact(facts: MemoryFact[], incoming: MemoryFact, supplied = false): MemoryFact[] {
  const stamp = (f: MemoryFact): MemoryFact => ({ ...f, fact: { ...f.fact, [STATUS_SOURCE_FIELD]: "model" } });

  const idx = findFactIndex(facts, incoming);
  if (idx === -1) return [...facts, supplied ? stamp(incoming) : incoming];

  const next = [...facts];
  const prior = next[idx]!;
  const modelStatus = holdsModelStatus(prior);
  const key = preferredKey(prior.key, incoming.key);
  const category = supplied
    ? incoming.category
    : modelStatus || CATEGORY_SPECIFICITY[incoming.category] <= CATEGORY_SPECIFICITY[prior.category]
      ? prior.category
      : incoming.category;

  // A status is derived alongside a category ("dead" for an npc, "taken by
  // the party" for an item), so when the incoming classification LOSES, its
  // status loses with it rather than being pasted onto a record that is now
  // filed as something else. Without this, a scene whose prose read an
  // established NPC as a generic event downgraded her status from "known" to
  // "noted" while correctly keeping her category, and a woman misread as an
  // object arrived at an npc record still wearing "taken by the party".
  //
  // The one place a LOWER-ranked incoming status still wins is when the
  // category actually changed and the status it is replacing was not
  // terminal: "taken by the party" was derived for a classification that has
  // just been overruled, so carrying it onto the new one prints a person as
  // loot. A terminal status (rank 2, a death) is never dropped this way,
  // which is the case the rank rule exists for in the first place.
  const categoryChanged = category !== prior.category;
  const takeIncomingStatus =
    supplied ||
    (!modelStatus &&
      category === incoming.category &&
      (statusRank(incoming.status) >= statusRank(prior.status) || (categoryChanged && statusRank(prior.status) < 2)));
  const status = takeIncomingStatus ? incoming.status : prior.status;

  const fact = mergeFactContent(prior.fact, incoming.fact);
  // mergeFactContent builds from `incoming`, so the stamp has to be re-applied
  // whenever the surviving status is a model-authored one.
  if (supplied || (modelStatus && !takeIncomingStatus)) fact[STATUS_SOURCE_FIELD] = "model";
  else delete fact[STATUS_SOURCE_FIELD];

  next[idx] = { category, key, fact, status };
  return next;
}

/**
 * Shallow deep-equal on plain JSON-shaped values (what MemoryFact.fact
 * holds). Good enough here because facts are always the loose bag described
 * in types.ts, never containing functions, dates, or cycles.
 */
function factContentEquals(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Detect keys where `incoming` differs in content from `before`, same key
 * identity, different `fact`. Since upsertFact/mergeFactContent above now
 * MERGE rather than overwrite whenever the fact shape supports it, a
 * reported collision here no longer means data was just destroyed the way it
 * did before that fix -- most of the time it means two scenes legitimately
 * mentioned the same name and their evidence just got combined. It is still
 * worth surfacing: for any fact shape mergeFactContent can't merge, this IS
 * the old destructive case, and even for the mergeable case a caller may
 * want to know a name is accumulating multiple, possibly unrelated, mentions
 * under one key (a real limit of a heuristic that can't tell two same-named
 * NPCs apart).
 *
 * A caller (the condensation call site) can use this to log or surface a
 * collision rather than have it pass through invisibly, which is the whole
 * point: upsertFact still trusts its key, but nothing upstream has to.
 */
export function detectFactCollisions(
  before: MemoryFact[],
  incoming: MemoryFact[],
): Array<{ category: MemoryFact["category"]; key: string }> {
  const collisions: Array<{ category: MemoryFact["category"]; key: string }> = [];
  for (const fact of incoming) {
    // Matched on key alone, the same identity upsertFact uses (normalized
    // the same way, so a DM slug and the heuristic's phrase key are one
    // identity here too). Matching on (category, key) used to hide the most
    // interesting collision of all: the same name coming back classified as
    // something else.
    const prior = before.find((f) => normalizeKey(f.key) === normalizeKey(fact.key));
    if (prior && !factContentEquals(prior.fact, fact.fact)) {
      collisions.push({ category: fact.category, key: fact.key });
    }
  }
  return collisions;
}

/** Facts in `after` that are new or whose serialized content changed, so a caller can persist a delta instead of the whole accumulated list. */
function factsChangedBetween(before: MemoryFact[], after: MemoryFact[]): MemoryFact[] {
  const beforeByKey = new Map(before.map((f) => [normalizeKey(f.key), JSON.stringify(f)]));
  return after.filter((f) => beforeByKey.get(normalizeKey(f.key)) !== JSON.stringify(f));
}

/**
 * Enforce MAX_CONDENSED_ENTRIES: any digest older than the cap leaves the
 * log and is folded into one rolling tier 3 fact instead. Nothing about this
 * contradicts "tier 3 is never compressed away" -- what leaves here is tier
 * 2, which DESIGN.md already calls lossy on purpose and explicitly not the
 * source for what must survive. The structured facts that condensation
 * extracted from these same scenes stay in tier 3 forever, keyed and
 * status-bearing; this fold just keeps a bounded prose trace of the era so
 * the DM isn't left with a hard edge where the campaign appears to begin.
 */
function foldExcessCondensed(log: LogEntry[], facts: MemoryFact[]): { log: LogEntry[]; facts: MemoryFact[] } {
  const condensed = log.filter((e) => e.tier === "condensed");
  const excess = condensed.length - MAX_CONDENSED_ENTRIES;
  if (excess <= 0) return { log, facts };

  const dropped = condensed.slice(0, excess);
  const droppedIds = new Set(dropped.map((e) => e.sceneSeq));
  const nextLog = log.filter((e) => !(e.tier === "condensed" && droppedIds.has(e.sceneSeq)));

  const era: MemoryFact = {
    category: "event",
    key: EARLIER_SCENES_FACT_KEY,
    fact: { mentions: dropped.map((e) => ({ sceneSeq: e.sceneSeq, text: e.content.slice(0, 200) })) },
    status: "earlier campaign, condensed further (heuristic)",
  };
  return { log: nextLog, facts: upsertFact(facts, era) };
}

/** What condenseOldest hands back: the new state, plus the two signals a caller needs to persist and to log. */
export interface CondensationResult extends WorkingMemoryState {
  collisions?: Array<{ category: MemoryFact["category"]; key: string }>;
  /**
   * Only the facts this cycle actually added or changed. The call site
   * persists one request per fact, and used to iterate the ENTIRE
   * accumulated list every condensation (15 requests at scene 14, growing
   * linearly, each carrying an ever growing evidence array), so this is the
   * difference between a delta and a full re-upload on every scene.
   */
  changedFacts: MemoryFact[];
}

/**
 * Condense the oldest verbatim entry: replace it with a "condensed" entry
 * carrying `summarize`'s digest, and upsert every fact it extracted into
 * tier 3. Only the single oldest verbatim entry is touched -- every other
 * entry (older condensed entries, newer verbatim ones) passes through
 * unchanged, which is what makes repeated condensation cycles safe to run
 * one at a time rather than needing to reprocess the whole log each time.
 *
 * `summarize` receives the scene's sequence number as well as its text so
 * the evidence it attaches can say which scene it came from; a summarizer
 * that ignores the second argument still typechecks and still works.
 *
 * No-op (returns state unchanged) if there is no verbatim entry left to
 * condense, so a caller can call this in a loop without first checking
 * emptiness on every iteration.
 *
 * Order matters at the end: heuristic facts fold in first, then any facts
 * the DM's own turn supplied for this scene, so the model's typed record
 * wins over the heuristic's guess for the same key. Re-applying them here is
 * belt and braces now that addSceneNarration lands them immediately: the
 * merge is idempotent, and this is what puts the model's status back on top
 * if the heuristic reached the same key first from this scene's prose.
 */
export function condenseOldest(
  state: WorkingMemoryState,
  summarize: (text: string, sceneSeq: number) => { digest: string; extractedFacts: MemoryFact[] },
): CondensationResult {
  const idx = state.log.findIndex((e) => e.tier === "verbatim");
  if (idx === -1) return { log: state.log, facts: state.facts, changedFacts: [] };

  const oldest = state.log[idx]!;
  const { digest, extractedFacts } = summarize(oldest.content, oldest.sceneSeq);

  const condensed: LogEntry = { sceneSeq: oldest.sceneSeq, tier: "condensed", content: digest };
  const log = [...state.log];
  log[idx] = condensed;

  const collisions = detectFactCollisions(state.facts, extractedFacts);

  // Never `state.facts = ...facts` in one shot -- fold sequentially so two
  // facts in the same extraction batch sharing a key still collapse to one
  // entry instead of the second silently shadowing the first only in the
  // caller's head.
  let facts = extractedFacts.reduce((acc, fact) => upsertFact(acc, fact), state.facts);
  for (const supplied of oldest.suppliedFacts ?? []) facts = upsertFact(facts, supplied, true);

  const folded = foldExcessCondensed(log, facts);
  const changedFacts = factsChangedBetween(state.facts, folded.facts);

  const result: CondensationResult = { log: folded.log, facts: folded.facts, changedFacts };
  return collisions.length > 0 ? { ...result, collisions } : result;
}
