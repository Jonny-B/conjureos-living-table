/**
 * The non-AI condensation summarizer this integration pass injects into
 * memory/workingMemory.ts's `condenseOldest`. DESIGN.md's cost model is
 * explicit that condensation "runs as a byproduct of an already-paid scene
 * transition... never as its own charge"; the honest way to keep that
 * TRIVIALLY true, rather than merely true by omission, is to never make a
 * second AI call for it at all.
 *
 * It is a plain heuristic, not a second model, and it is the FALLBACK now
 * rather than the only path: a DM turn may supply its own typed
 * `memoryFacts`, and those win per key, permanently (workingMemory.ts stamps
 * a model-authored status and never lets anything below restate it).
 * Everything here is what happens when the model didn't bother, which is
 * most turns.
 *
 * Two rounds of gauntlet criticism shaped what's here, and both were found
 * with ordinary DM prose (six to nine sentences a scene, the beat stated
 * mid-paragraph), not adversarial input:
 *
 * 1. The DIGEST used to seed its four-sentence budget with sentence 0 and
 *    the last sentence before any importance test ran, so half the budget
 *    went to position. Measured over fourteen real scenes the last sentence
 *    was kept 14 times out of 14 regardless of content: one scene kept a
 *    heron leaving a snag and dropped the mark that linked two locations,
 *    another kept "nobody has slept properly in three days" and dropped a
 *    missing boat, a broken bell and a board nailed across a murdered man's
 *    door. The anchors are gone. Every sentence is ranked and the budget
 *    goes to the top scorers; sentence 0 only survives when nothing else
 *    scores at all.
 * 2. The FACTS used to be a bag of untyped proper nouns: category hardcoded
 *    to "event", status hardcoded to a constant, keyed per capitalized WORD
 *    (so "Alderic" and "Voss" were two different people with byte-identical
 *    evidence), and evidence attached only where the noun literally
 *    appeared, so a theft written as "You take it." produced no fact at all.
 *    Now: phrases not words, an inferred category, a status that carries
 *    state, and evidence attached by adjacency (the naming sentence plus the
 *    next couple, because that is where the consequence lands).
 *
 * A third round found that both of those fixes had left the same POSITIONAL
 * and ADJACENCY weaknesses one function over in the classifier, where they
 * do more damage, because a status is what the DM reads as binding:
 *
 * 3. classify() ran on the CLIPPED evidence, so a theft stated past 240
 *    characters into a scene was invisible and the same event recorded as
 *    "noted" or "taken by the party" purely by character offset. It reads
 *    the unclipped window now; clipping applies only to what is written out.
 * 4. The death cue matched anywhere in the two-sentence adjacency window, so
 *    somebody else dying near a name killed the name, permanently, because
 *    "dead" is terminal and can never be outranked. It now has to be in the
 *    same clause as the name and on the right side of it.
 * 5. The person test ran AFTER the thing tests and on a narrower scope than
 *    they did, so people were filed as items by two independent routes and,
 *    because an item and an npc could not merge, filed there forever.
 *
 * It is still a heuristic and still cannot tell "Kira" from "Tuesday" by
 * meaning. What it no longer does is lie about what it knows: an inferred
 * category and status are marked "(heuristic)" in the status string, which
 * is what a DM-supplied fact overwrites when one arrives, and what a
 * DM-supplied fact can no longer be overwritten BY.
 */
import type { MemoryFact, MemoryFactCategory } from "../memory/types";

const SENTENCE_SPLIT = /(?<=[.!?])\s+/;
const PROPER_NOUN_WORD = /^[A-Z][a-z]{2,}$/;

/**
 * Common words that are capitalized at the start of a sentence often enough
 * that treating them as a name would just be noise, not signal, even after
 * corroboration (an adverb like "Then" or "Finally" can easily open two
 * different sentences in one scene without meaning anything). Deliberately
 * a stopword filter for the obvious false positives, not an attempt at real
 * named-entity recognition.
 */
const STOPWORDS = new Set([
  "You", "Your", "The", "This", "That", "These", "Those", "They", "Their",
  "He", "She", "It", "We", "Our", "I",
  "Finally", "Suddenly", "Quietly", "Slowly", "Carefully", "Eventually",
  "Then", "Now", "Later", "Meanwhile", "Afterward", "Soon",
  "Overhead", "Inside", "Outside", "Above", "Below", "Beyond", "Nearby",
  "Perhaps", "Still", "Yet", "Even", "Also", "Instead", "Somewhere",
  "Nothing", "Something", "Everyone", "Someone", "Nobody", "Anybody",
  "Everything", "Anything", "Sometime", "Under", "Where", "When", "Two",
  "Three", "Four", "Five", "One", "Both", "Another", "Each", "Every",
  // The common stems an "n't" contraction reduces to (normalizeWord strips
  // "n't" as a unit, e.g. "Didn't" -> "Did") -- real words, not fragments,
  // but still not names, so they need to be here rather than leaking
  // through as fabricated facts.
  "Did", "Was", "Were", "Is", "Are", "Has", "Have", "Should", "Would",
  "Could", "Does",
]);

/**
 * Words (lowercased, matched as a whole word) whose presence marks a
 * sentence as carrying an EVENT rather than incidental colour: someone died,
 * something was taken or given, a promise was made or broken.
 */
const EVENT_SIGNAL_WORDS = new Set([
  "kill", "kills", "killed", "die", "dies", "died", "dead", "death",
  "steal", "steals", "stole", "stolen", "theft",
  "promise", "promises", "promised", "vow", "vows", "vowed",
  "swear", "swears", "swore", "sworn", "oath",
  "betray", "betrays", "betrayed", "betrayal",
  "attack", "attacks", "attacked",
  "flee", "flees", "fled",
  "threaten", "threatens", "threatened",
  "discover", "discovers", "discovered",
  "reveal", "reveals", "revealed",
  "destroy", "destroys", "destroyed",
  "rescue", "rescues", "rescued", "save", "saves", "saved",
  "agree", "agrees", "agreed", "refuse", "refuses", "refused",
  "give", "gives", "gave", "given",
  "take", "takes", "took", "taken",
  "break", "breaks", "broke", "broken",
]);

/**
 * The second half of the digest scorer, and the fix for the specific
 * complaint that "a plot beat written in plain common nouns (a door, a mark,
 * a missing boat) is invisible." These are verbs and participles of PHYSICAL
 * STATE CHANGE, which is a principled category rather than a list of words
 * that happened to appear in one campaign: something is now locked that
 * wasn't, cut that wasn't, gone that was there. A DM writing colour ("a
 * heron stands in the shallows") reaches for none of them; a DM writing a
 * beat reaches for one almost every time, even with no proper noun in sight.
 */
const STATE_CHANGE_CUE =
  /\b(missing|gone|vanished|locked|unlocked|opens?|opened|shut|sealed|barred|nailed|empty|emptied|broken|burned|cut|carved|scratched|scraped|marked|drawn|hidden|buried|torn|blocked|dragged|tied|untied|lashed|fits?|lifts?|warns?|warned|demands?|offers?|offered|owes?|paid|unpaid|dead|died|killed|stolen|taken)\b/i;
// Plain verbs of MOTION are deliberately absent from that list ("turns",
// "leaves", "arrives", "returns"). They read as state change but in DM prose
// they are almost always colour: a pool turns slowly, a heron leaves a snag,
// the light is going by the time you decide which way to turn. Including
// them handed three of a four-sentence budget to scenery in a measured
// scene and pushed out the mark that linked two locations.

/** Handling verbs: something changed hands or was carried off. Deliberately narrow, and deliberately excludes "give", which in practice attaches to speech far more often than to objects. */
const HANDLING_CUE =
  /\b(takes?|took|taken|carry|carries|carried|carrying|holds?|held|pockets?|pocketed|lifts?|lifted|steals?|stole|stolen|wears?|wore|worn|sells?|sold|buys?|bought)\b/i;

/**
 * Someone died. Split in two by GRAMMATICAL ROLE, because "is there a death
 * word near this name" was never the question.
 *
 * This used to be one regex tested against the whole adjacency window, so
 * somebody ELSE dying two sentences away killed the name. An adversary's
 * scene said "You show it to Bran Vetch, and he will not stand under it. He
 * says he has seen the same cutting twice before... and once on his father's
 * door the week his father died." Bran Vetch is the miller. His FATHER died.
 * The record read `[npc] Bran Vetch -- dead (heuristic)` from then on, and
 * because "dead" is terminal (workingMemory.ts's TERMINAL_STATUS_WORDS) it
 * could never be outranked afterwards. The DM was handed that line directly
 * underneath "If a fact says an NPC is dead, that NPC does not appear,
 * speak, or trade", in the same payload as a verbatim later scene where Bran
 * Vetch stands at the back with his hat in his hands.
 *
 * An irreversible wrong answer is strictly worse than a reversible one, so
 * the cue now has to be in the same CLAUSE as the name, on the right side of
 * it: intransitive death takes its subject before it ("Alderic Voss is dead",
 * "Voss died"), a transitive killing takes its victim after it ("the man
 * killed Alderic Voss"). Clause, not sentence, because "you show it to Bran
 * Vetch, and he says his father died" is one sentence and two subjects.
 */
const DEATH_SUBJECT_CUE = /\b(dead|dies|died|die|slain|corpse)\b/i;
const DEATH_VICTIM_CUE = /\b(kills?|killed|murders?|murdered)\b/i;

/** Where one clause ends and the next subject begins. Deliberately coarse: this is about not straddling two subjects, not about parsing English. */
const CLAUSE_SPLIT = /[,;:]|\s+\b(?:and|but|while|because|though|although|which|who)\b\s+/i;

/**
 * Speech verbs and person nouns: the cues that mark a name as a person
 * rather than a place or an object. Checked over the entity's whole evidence
 * window, the same width the handling cue is checked over, and see classify
 * for why that symmetry is the point.
 */
const PERSON_CUE =
  /\b(says?|said|saying|asks?|asked|asking|tells?|told|telling|warns?|warned|replies|replied|answers?|answered|whispers?|shouts?|calls?|called|names?|named|meets?|greets?|offers?|refuses?|agrees?|man|men|woman|women|girl|boy|brother|sister|mother|father|son|daughter|wife|husband|guard|captain|keeper|priest|verger|miller|innkeeper|courier|smith|widow|child|children)\b/i;

/**
 * An unresolved question hanging over the campaign: a mark nobody can read,
 * a rumour, a sign that keeps turning up.
 *
 * Stated honestly: this branch is close to unreachable in practice, and
 * deliberately so rather than by accident. It is the last test in classify,
 * so it only ever sees a corroborated PROPER NOUN that survived the title,
 * death, article, person and handling tests, while open threads are normally
 * described in common nouns (a mark, a rumour, a sign) that this classifier
 * cannot see at all. Keying it off the cue phrase instead would mean
 * inventing a permanent campaign fact out of "the same" or "somebody",
 * which is a worse failure than a missing thread in a tier the prompt calls
 * binding. Threads therefore come from the DM's own typed `memoryFacts` in
 * practice, which is what the model is actually good at, and this branch
 * only catches the case where a thread genuinely has a name.
 */
const THREAD_CUE = /\b(mark|marks|symbol|sign|signs|rumou?rs?|riddle|mystery|same|why|whoever|somebody|someone)\b/i;

/** A commitment was made. "word" is deliberately absent: "word spreads through the docks" is not a promise. */
const PROMISE_CUE = /\b(promises?|promised|vows?|vowed|swears?|swore|sworn|oath|owes?|bargain|deal)\b/i;
const PROMISE_KEPT_CUE = /\b(kept|keeps|fulfilled|honou?red|delivered|repaid)\b/i;
const PROMISE_BROKEN_CUE = /\b(broke|broken|betrayed|abandoned|failed)\b/i;

/**
 * Words that mark the following capitalized run as a thing rather than a
 * person: nobody says "the Sella".
 *
 * The possessive pronouns are deliberately NOT here any more. They used to
 * be, and ordinary English ("everybody calls her Sella Vetch", "his brother
 * Perrin") therefore filed people as objects: an adversary's finished Items
 * list read "Voss", "Sella", "Tideglass Compass", two people and a thing,
 * one of them a murder victim simultaneously recorded as loot the party was
 * carrying. A possessive in front of a capitalised name is at least as often
 * a person as an object, so it is no signal at all.
 */
const DETERMINERS = new Set(["the", "a", "an", "this", "that", "these", "those", "its"]);

/** The exception to that rule: a title takes a determiner and is still a person. "the Widow Marne" is not an object. */
const PERSON_TITLES = new Set([
  "Widow", "Lady", "Lord", "Sister", "Brother", "Mother", "Father", "Captain",
  "Sergeant", "Doctor", "Master", "Mistress", "Old", "Young", "Baron", "Abbot",
]);

/** Digest budget. Four sentences of a seven-to-nine sentence scene is a real condensation; the change is that all four now go to signal rather than two going to position. */
const MAX_DIGEST_SENTENCES = 4;

/** How many sentences after the one naming an entity count as its evidence. See `evidenceRuns`. */
const ADJACENCY_LOOKAHEAD = 2;

/** One piece of evidence is capped here so a long run of sentences about one entity can't become an unbounded quote. workingMemory.ts caps how MANY a fact keeps. */
const MAX_MENTION_CHARS = 240;

/** Cut at the cap, but on a word boundary, so a quote ends "...and the man is" rather than "...and the man is int". */
function clipMention(text: string): string {
  if (text.length <= MAX_MENTION_CHARS) return text;
  const cut = text.slice(0, MAX_MENTION_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > MAX_MENTION_CHARS - 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}...`;
}

/** At most this many promise facts out of one scene, so a scene of heavy negotiation can't flood tier 3. */
const MAX_PROMISES_PER_SCENE = 2;

/**
 * A proper-noun candidate word, stripped of a possessive suffix (so "Ilsa's"
 * yields "Ilsa", not "Ilsas") and any other non-letter characters.
 *
 * A regression a session-quality gauntlet critic found: only stripping a
 * possessive `'s` left every OTHER contraction's suffix in place, so
 * "I'll"/"I've" survived the character-class strip as "Ill"/"Ive" -- both
 * pass PROPER_NOUN_WORD and neither is in STOPWORDS, so they were extracted
 * as fake permanent facts. `n't` is stripped as its own unit FIRST, not by
 * the general suffix strip: "didn't" isn't "did" + "'t", it's "did" + "n't",
 * and stripping only the apostrophe-t would leave "Didn", a fragment that's
 * arguably worse (it isn't even a real word, so it can't be
 * stopword-filtered by name).
 */
function normalizeWord(raw: string): string {
  const withoutNt = raw.replace(/n['’]t$/i, "");
  return withoutNt.replace(/['’](s|ll|ve|re|d|m)$/i, "").replace(/[^A-Za-z]/g, "");
}

function hasEventSignal(sentence: string): boolean {
  const words = sentence.toLowerCase().match(/[a-z]+/g) ?? [];
  return words.some((w) => EVENT_SIGNAL_WORDS.has(w));
}

/** One occurrence of one candidate name phrase, with the context needed to classify it later. */
interface PhraseHit {
  phrase: string;
  sentenceIdx: number;
  /** True when the phrase opened its sentence, where ordinary English capitalizes regardless of whether a word is a name. */
  initial: boolean;
  /** The lowercased word immediately before the phrase, "" at a sentence start. "the" here is what tells an object from a person. */
  precededBy: string;
}

/**
 * Find every run of consecutive capitalized non-stopword words, as a PHRASE
 * rather than a word. This is the fix for tier 3 holding "Alderic" and
 * "Voss" as two separate people, and "Tideglass" and "Compass" as two
 * separate objects, each pair carrying byte-identical evidence: roughly a
 * quarter of a measured fourteen-scene fact tier was the same sentences
 * stored twice under half a name.
 *
 * A run breaks on any word that isn't a candidate AND on trailing
 * punctuation, because "You promise Sella, Perrin will be home" must not
 * become one person called "Sella Perrin".
 */
function scanPhrases(sentences: string[]): PhraseHit[] {
  const hits: PhraseHit[] = [];
  sentences.forEach((sentence, sentenceIdx) => {
    const words = sentence.trim().split(/\s+/);
    let run: string[] = [];
    let runStart = -1;

    const flush = (): void => {
      if (run.length === 0) return;
      hits.push({
        phrase: run.join(" "),
        sentenceIdx,
        initial: runStart === 0,
        precededBy: runStart > 0 ? normalizeWord(words[runStart - 1] ?? "").toLowerCase() : "",
      });
      run = [];
      runStart = -1;
    };

    for (let i = 0; i < words.length; i++) {
      const raw = words[i] ?? "";
      const word = normalizeWord(raw);
      if (!PROPER_NOUN_WORD.test(word) || STOPWORDS.has(word)) {
        flush();
        continue;
      }
      if (run.length === 0) runStart = i;
      run.push(word);
      // A comma, a full stop or a closing quote ends the phrase even if the
      // next word is also capitalized.
      if (/[,;:.!?"”')]$/.test(raw)) flush();
    }
    flush();
  });
  return hits;
}

/**
 * Which phrases are real enough to keep, corroborated across the WHOLE scene
 * rather than judged sentence by sentence. Ordinary English capitalizes a
 * sentence's first word regardless of whether it's a name ("Dust hangs in
 * the air"), so a phrase seen only ever at index 0 of one sentence is
 * exactly as likely to be an ordinary noun as a name. Two things ARE signal,
 * and either is enough: it turns up at a NON-initial position somewhere
 * (grammar had no reason to capitalize it there unless it's a proper noun),
 * or it opens more than one sentence in the scene (a one-off could be
 * coincidence; a recurring subject is a real signal).
 *
 * The second pass folds a bare surname into the full name when the scene
 * used both ("Alderic Voss" then "Voss"), so one person leaves one scene as
 * one entity. workingMemory.ts does the same fold ACROSS scenes.
 */
function corroboratedPhrases(hits: PhraseHit[]): { phrases: string[]; canonicalOf: Map<string, string> } {
  const midSentence = new Set<string>();
  const initialCounts = new Map<string, number>();
  for (const hit of hits) {
    if (hit.initial) initialCounts.set(hit.phrase, (initialCounts.get(hit.phrase) ?? 0) + 1);
    else midSentence.add(hit.phrase);
  }

  const corroborated = new Set<string>(midSentence);
  for (const [phrase, count] of initialCounts) if (count >= 2) corroborated.add(phrase);

  const all = [...corroborated];
  const canonicalOf = new Map<string, string>();
  for (const phrase of all) {
    const longer =
      phrase.includes(" ") ? undefined : all.find((other) => other !== phrase && other.split(" ").slice(-1)[0] === phrase);
    canonicalOf.set(phrase, longer ?? phrase);
  }

  return { phrases: [...new Set(all.map((p) => canonicalOf.get(p)!))], canonicalOf };
}

/**
 * Group an entity's sentence indices into contiguous runs, each extended by
 * ADJACENCY_LOOKAHEAD sentences. This is the whole of fix (e): evidence used
 * to attach only where the entity's own words literally appeared, so a
 * theft written as "You take it." attached to nothing and the permanent tier
 * never learned an object was stolen. The consequence of naming something is
 * almost always in the next sentence or the one after, so that is the window.
 */
function evidenceRuns(indices: number[], sentenceCount: number): number[][] {
  const covered = new Set<number>();
  for (const idx of indices) {
    for (let i = idx; i <= Math.min(idx + ADJACENCY_LOOKAHEAD, sentenceCount - 1); i++) covered.add(i);
  }
  const ordered = [...covered].sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const idx of ordered) {
    const last = runs[runs.length - 1];
    if (last && idx === last[last.length - 1]! + 1) last.push(idx);
    else runs.push([idx]);
  }
  return runs;
}

/**
 * Where a name occurs in a clause: the index of the full phrase, or failing
 * that of its final word, since real prose names someone in full once and
 * then uses the surname ("Alderic Voss" ... "Voss falls dead") and
 * corroboration has already folded those into one phrase.
 */
function nameIndexIn(clause: string, phrase: string): number {
  const full = clause.indexOf(phrase);
  if (full !== -1) return full;
  const surname = phrase.split(" ").slice(-1)[0]!;
  const match = new RegExp(`\\b${surname}\\b`).exec(clause);
  return match ? match.index : -1;
}

/**
 * True only when this scene says THIS name died, rather than that a death
 * word appeared somewhere near it. The cue and the name have to share a
 * clause, and the name has to be on the grammatically right side of the cue
 * (see DEATH_SUBJECT_CUE / DEATH_VICTIM_CUE). `sentences` here is only the
 * sentences that actually name the entity, never its wider evidence window.
 */
function deathIsAboutThisName(phrase: string, namingSentences: string[]): boolean {
  for (const sentence of namingSentences) {
    for (const clause of sentence.split(CLAUSE_SPLIT)) {
      if (!clause) continue;
      const at = nameIndexIn(clause, phrase);
      if (at === -1) continue;
      const subject = DEATH_SUBJECT_CUE.exec(clause);
      if (subject && subject.index > at) return true;
      const victim = DEATH_VICTIM_CUE.exec(clause);
      if (victim && victim.index < at) return true;
    }
  }
  return false;
}

/**
 * Classify one entity from the sentences that name it (person-ness, and
 * whether it died) and from its wider evidence window (what happened to it).
 *
 * Order is the whole of this function and it is ordered by how much a wrong
 * answer costs. A title in the name is near-certain evidence of a person; an
 * explicit article is near-certain evidence of a thing; after that the
 * PERSON test runs BEFORE the thing test, in both scopes, because filing a
 * person as an object is the failure that cannot recover (categories that
 * disagree used to block the merge entirely, so "[item] Voss -- taken by the
 * party" sat permanently beside "[npc] Alderic Voss -- dead").
 *
 * The asymmetry that produced it: person-ness was tested only on the naming
 * sentences while handling was tested on the whole window, so a scene where
 * somebody hands the party a bundle read the woman doing the handing as the
 * thing handed over. Both are tested on both scopes now, person first.
 *
 * The cost of that symmetry, stated rather than hidden: a PLACE named in a
 * scene where anybody speaks now files as an npc rather than as a generic
 * event ("[npc] Harrow Mill [known (heuristic)]"). That is the same
 * adjacency weakness in the other direction and this classifier has no way
 * to tell a mill from a miller. It is accepted because the two errors are
 * not the same size: a place listed as a person is noise the DM can ignore,
 * while a person listed as loot the party is carrying is a record that
 * contradicts the campaign, and it used to be unreachable forever because
 * an item and an npc could not merge.
 */
function classify(
  phrase: string,
  hits: PhraseHit[],
  namingSentences: string[],
  windowText: string,
): { category: MemoryFactCategory; status: string } {
  const namingText = namingSentences.join(" ");
  const titled = PERSON_TITLES.has(phrase.split(" ")[0]!);
  const died = deathIsAboutThisName(phrase, namingSentences);

  if (titled) return { category: "npc", status: died ? "dead (heuristic)" : "known (heuristic)" };
  if (died) return { category: "npc", status: "dead (heuristic)" };

  if (hits.some((h) => DETERMINERS.has(h.precededBy))) {
    // "the Tideglass Compass" is a thing. Nobody says "the Sella", and the
    // one construction that does put an article in front of a person is a
    // title, which PERSON_TITLES has already held back above.
    return { category: "item", status: HANDLING_CUE.test(windowText) ? "taken by the party (heuristic)" : "noted (heuristic)" };
  }
  if (PERSON_CUE.test(namingText) || PERSON_CUE.test(windowText)) return { category: "npc", status: "known (heuristic)" };
  if (HANDLING_CUE.test(windowText)) return { category: "item", status: "taken by the party (heuristic)" };
  if (THREAD_CUE.test(namingText)) return { category: "thread", status: "open (heuristic)" };
  return { category: "event", status: "noted (heuristic)" };
}

/**
 * Rank every sentence by how much campaign signal it carries. No positional
 * anchors: a sentence earns its slot or it doesn't. Quoted speech gets a
 * point because a DM putting words in someone's mouth is usually doing
 * something that matters, and that test costs one character class rather
 * than another word list.
 */
function scoreSentence(sentence: string, namesEntity: boolean): number {
  let score = 0;
  if (hasEventSignal(sentence)) score += 3;
  if (STATE_CHANGE_CUE.test(sentence)) score += 2;
  if (namesEntity) score += 2;
  if (/["“”]/.test(sentence)) score += 1;
  return score;
}

export function heuristicSummarize(text: string, sceneSeq = 0): { digest: string; extractedFacts: MemoryFact[] } {
  const trimmed = text.trim();
  if (!trimmed) return { digest: "(an uneventful scene)", extractedFacts: [] };

  const sentences = trimmed.split(SENTENCE_SPLIT).filter((s) => s.trim().length > 0);
  if (sentences.length === 0) return { digest: trimmed, extractedFacts: [] };

  const hits = scanPhrases(sentences);
  const { phrases, canonicalOf } = corroboratedPhrases(hits);

  // A phrase's hits, after canonicalization: "Voss" folded into "Alderic
  // Voss" has to bring its own occurrences with it, or the full name loses
  // half its evidence to a name that no longer exists. Uncorroborated hits
  // aren't in canonicalOf at all and drop out here.
  const hitsFor = new Map<string, PhraseHit[]>(phrases.map((p) => [p, []]));
  for (const hit of hits) {
    const canonical = canonicalOf.get(hit.phrase);
    if (canonical) hitsFor.get(canonical)!.push(hit);
  }
  const sentencesNamingEntity = new Set<number>();
  for (const list of hitsFor.values()) for (const hit of list) sentencesNamingEntity.add(hit.sentenceIdx);

  // ── the digest ─────────────────────────────────────────────────────────
  const scored = sentences.map((s, i) => ({ i, score: scoreSentence(s, sentencesNamingEntity.has(i)) }));
  const kept = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, MAX_DIGEST_SENTENCES)
    .map((s) => s.i)
    .sort((a, b) => a - b);
  // Nothing in the scene carried any signal at all: keep the opening line so
  // the digest still says where the party was, rather than nothing.
  const digestIdx = kept.length > 0 ? kept : [0];
  const digest = digestIdx.map((i) => sentences[i]!.trim()).join(" ... ");

  // ── entity facts ───────────────────────────────────────────────────────
  const extractedFacts: MemoryFact[] = [];
  for (const phrase of phrases) {
    const phraseHits = hitsFor.get(phrase) ?? [];
    const indices = [...new Set(phraseHits.map((h) => h.sentenceIdx))].sort((a, b) => a - b);
    const runs = evidenceRuns(indices, sentences.length);
    const runTexts = runs.map((run) => run.map((i) => sentences[i]!.trim()).join(" "));
    const mentions = runTexts.map((text) => ({ sceneSeq, text: clipMention(text) }));

    // classify() gets the UNCLIPPED window, and clipping happens only on the
    // way into `mentions`, which is where it belongs: MAX_MENTION_CHARS is a
    // bound on how much quoted evidence a fact carries, not a bound on how
    // much of the scene the classifier is allowed to read. It used to be
    // both, so a state change stated late in a scene was invisible: an
    // adversary ran a theft scene and got "noted (heuristic)", moved the
    // same taking sentence to the front of the same scene and got "taken by
    // the party (heuristic)". Identical event, opposite permanent record,
    // decided purely by character offset. This file's own header documents
    // killing exactly this positional bias in the digest scorer and left an
    // identical one one function over.
    const namingSentences = indices.map((i) => sentences[i]!);
    const windowText = runTexts.join(" ");
    const { category, status } = classify(phrase, phraseHits, namingSentences, windowText);
    extractedFacts.push({ category, key: phrase, fact: { mentions }, status });
  }

  // ── promises ───────────────────────────────────────────────────────────
  // Kept as their OWN records rather than folded into whichever NPC happened
  // to be named nearby: a critic watched a sworn vow reach scene 14 as one
  // quoted sentence attached to "event/Perrin" with the same status string
  // as the weather, its stated deadline connected to nothing. A promise is
  // the kind of thing a DM has to check before offering a reward, so it gets
  // its own key, its own category and a status that says whether it's still
  // owed. The "promise: " prefix keeps that key out of the way of the NPC of
  // the same name (see workingMemory.ts's alias rule).
  //
  // The KEY is what makes a promise updatable, so it is only ever the people
  // it concerns, never a slice of the sentence. It used to fall back to the
  // first 48 characters of the promise sentence when no name was corroborated
  // in it, which produces a key no later scene can ever match: an adversary
  // made a vow in scene 1 and discharged it in scene 6 in ordinary prose, and
  // tier 3 ended up holding BOTH "promise: Perrin & Sella -- outstanding" and
  // "promise: The promise you made her at that gate nine days -- kept", under
  // the rule that says these facts are binding and may never be contradicted.
  //
  // So the subject search widens (the promise sentence, then its adjacency
  // window) and then STOPS: a promise this heuristic cannot name a subject
  // for gets no permanent record at all. That is a real loss of recall,
  // stated rather than hidden, and it is the right trade, because the record
  // it was producing instead was one the DM could only read as a second,
  // contradictory vow. workingMemory.ts's findFactIndex does the matching
  // half, folding "promise: Sella" into "promise: Perrin & Sella".
  let promiseCount = 0;
  for (let i = 0; i < sentences.length && promiseCount < MAX_PROMISES_PER_SCENE; i++) {
    const sentence = sentences[i]!;
    if (!PROMISE_CUE.test(sentence)) continue;
    const run = evidenceRuns([i], sentences.length)[0] ?? [i];
    const inSentence = phrases.filter((p) => (hitsFor.get(p) ?? []).some((h) => h.sentenceIdx === i)).sort();
    const named =
      inSentence.length > 0
        ? inSentence
        : phrases.filter((p) => (hitsFor.get(p) ?? []).some((h) => run.includes(h.sentenceIdx))).sort();
    if (named.length === 0) continue;
    const windowText = clipMention(run.map((j) => sentences[j]!.trim()).join(" "));
    // Whether a promise has been discharged is read off the promise sentence
    // itself, not the adjacency window: the window is evidence, and an
    // unrelated "the verger kept one key" two sentences later must not mark
    // a live vow as settled.
    const status = PROMISE_KEPT_CUE.test(sentence)
      ? "kept (heuristic)"
      : PROMISE_BROKEN_CUE.test(sentence)
        ? "broken (heuristic)"
        : "outstanding (heuristic)";
    extractedFacts.push({
      category: "promise",
      key: `promise: ${named.join(" & ")}`,
      fact: { mentions: [{ sceneSeq, text: windowText }] },
      status,
    });
    promiseCount++;
  }

  return { digest, extractedFacts };
}
