/**
 * Every player-facing string the play screen builds out of engine data.
 *
 * This module exists because of one concrete bug class: the play screen used
 * to interpolate engine identifiers straight into copy the player reads. The
 * dice log printed "monster-0-0 attacks lt-character-2: d20 5 +3 = 8 vs AC
 * 16: MISS", where "lt-character-2" is a token id (a games-db UUID in
 * production) belonging to a character whose name the player typed themselves.
 * A token id is a database key, never a noun. `tokenLabel` below is the single
 * place that turns one into something a person can read, and every roll line
 * in this game is built from the functions here rather than from a template
 * literal at the call site, so there is exactly one place that can regress and
 * exactly one place a test has to watch.
 *
 * It lives beside the command menu because that is this game's player-facing
 * layer: `commandMenu.ts` decides which verb costs a credit, this file decides
 * what the player is told about what happened. Both are pure, both are unit
 * tested without a canvas or a DOM.
 *
 * Related rule, kept here so it stays true: an unfinished feature is never
 * apologised for in JSX. If a row can't say something true, it isn't rendered.
 */
import type { AbilityScores } from "../rules/abilities";
import { TIER_WORD, type BonusSource, type LootRoll } from "../characters/equipmentTypes";
import type { CellCoord, Edge } from "../world/coordinates";
import { FEET_PER_TILE } from "./combatRound";

// ── one name for the dungeon master, and one honest pitch ────────────────
//
// Two cold readers, independently and at stated confident confidence, read
// "A real dungeon master, real dice, a world that remembers your campaign"
// as advertising a live human being, and both then hunted for the other
// players. One judge: "I assumed for a moment that this was a game where a
// person runs the story for you live and I got briefly excited about that...
// I'd feel slightly sold to."
//
// Compounding it, one entity carried three names: the compass said "the DM",
// the level screen said "the table builds it", the loading screen said "The
// table is setting the scene", and the death panel said "Leave the table".
// Both judges read "the table" as other human players sitting at one.
//
// So: ONE name, spelled out on first use, used in every string this game
// renders, and "real" moved off the dungeon master and onto the two things
// that genuinely are real, the dice and the SRD rules underneath them. These
// live here rather than inline in the screen because this module is the
// single place a test can read every player-facing string from.

/** What the entity is called, everywhere, on every screen. Never "the table": that is the name of the GAME, not of the thing running it. */
export const DM_NAME = "the dungeon master";

/** The campaign-list subtitle, and the game's whole claim in one line. */
export const GAME_TAGLINE = "Real dice and the real SRD 5.1 tabletop rules, run by a dungeon master (the DM) that remembers your campaign.";

/**
 * The New campaign card. Two jobs: previewing the flow's TOTAL price instead
 * of wearing a badge of its own (a card badge plus a button badge on the next
 * screen made one judge count three charges and start counting instead of
 * playing), and naming the half of the game that never costs anything, since
 * that is the half the pricing taught both readers to skip.
 *
 * "Throughline" and "beats" are gone from here on purpose: both judges named
 * them as the most jargony words in the whole product, and neither is even a
 * D&D word, so they were the two nouns the game never explained.
 */
export const NEW_CAMPAIGN_BLURB =
  "Two credits to get playing: one for the DM to plan the story, one for it to build and open your first scene. A written campaign needs no planning, so it takes one. Everything after that, moving and fighting and searching, is free.";

/** The heading over the written campaigns on the new-campaign screen (campaign/library.ts). */
export const WRITTEN_CAMPAIGNS_HEADING = "Or start a written campaign";

/** The busy line while a written campaign is being opened. No planning happens, so it must not say it does. */
export const WRITTEN_CAMPAIGN_BUSY_LABEL = "Opening the campaign...";

/** The sub-line under the planning spinner. Same no-jargon rule as the blurb above. */
export const CAMPAIGN_PLANNING_SUB = "A story, the places it runs through, and someone worth meeting.";

/** The character-creation spinner. It used to say "Rolling up your character...", which made a cold reader brace for a stat block they had not chosen and start planning a reroll. Scores are a fixed standard array per archetype; nothing is randomised here. */
export const CREATION_BUSY_LABEL = "Building your character...";

/**
 * What one credit actually buys, in the player's own terms.
 *
 * The shared CostBadge's hover read "Uses 1 AI call from your credits", which
 * a judge correctly called a phrase from behind the curtain: "It tells me
 * what the company is being billed for, not what I'm getting." Every paid
 * surface in this game now carries one of these instead, on the button, next
 * to the badge that already shows the price.
 */
export const CREDIT_BUYS = {
  planCampaign:
    "1 credit, once per campaign: the DM writes the story you are walking into, the places it runs through, and the people worth meeting.",
  beginScene: "1 credit: the DM builds the room you are standing in and starts the story.",
  buildRoom:
    "1 credit: the DM builds the room on the other side of this wall. Walking back into a room it has already built is free, forever.",
  talk: "1 credit: the DM reads what you typed and the world answers.",
  startWritten:
    "No credit to start: this story is already written, its places and its people waiting. Opening your first scene is 1 credit.",
} as const;

/**
 * The counterweight, on screen, once. Both cold readers derived the identical
 * degenerate strategy from the badges alone ("stand in one room, hit things,
 * camp, hit things, camp") because nothing anywhere said which verbs were
 * free. DESIGN.md prices all of these at nothing forever; the screen had
 * simply never mentioned it.
 */
export const FREE_FOREVER_LINE =
  "Moving, fighting, casting, searching, using items, resting and levelling up never cost a credit.";

// ── naming things ────────────────────────────────────────────────────────

/** What `tokenLabel` needs to turn an id into a noun: who the player is, and what else is standing in the room. */
export interface TokenNamer {
  /** The player character's own token id (the games-db character row id). */
  playerTokenId: string;
  /** The name the player typed at creation. */
  playerName: string;
  tokens: readonly { id: string; assetId: string }[];
}

/**
 * The display noun buried in an asset id: "token_goblin" -> "goblin",
 * "prop_wooden_chest" -> "wooden chest". Asset ids are authored in
 * scripts/assets/{fantasy,scifi}.ts as `<kind>_<snake_case_noun>`, so the noun
 * really is recoverable; a malformed id degrades to a generic word rather than
 * leaking the raw id into the sentence.
 */
export function assetNoun(assetId: string): string {
  const base = assetId
    .replace(/^(token|prop|tile|floor|wall)_/, "")
    .replace(/_/g, " ")
    .trim();
  return base.length > 0 ? base : "figure";
}

/**
 * The one function allowed to turn a token id into player-facing text. The
 * player's own token resolves to the name they chose; anything else resolves
 * to its sprite's noun with an article ("the goblin"); an id for something no
 * longer on the board resolves to a phrase, never to the id itself.
 */
export function tokenLabel(id: string, namer: TokenNamer): string {
  if (id === namer.playerTokenId) return namer.playerName;
  const token = namer.tokens.find((t) => t.id === id);
  if (token) return `the ${assetNoun(token.assetId)}`;
  return "something out of sight";
}

/** What to call a prop: the label the DM authored at assembly time when there is one, else the noun buried in its sprite id. */
export function propLabel(prop: { assetId: string; label?: string }): string {
  const authored = prop.label?.trim();
  return authored && authored.length > 0 ? authored : assetNoun(prop.assetId);
}

/**
 * `propLabel`, with exactly one leading "the": every "the <prop>" sentence in
 * this game (search lines, container loot captions) wants a definite noun
 * phrase, and `propLabel` cannot promise it does not already have one. A
 * DM-authored label is free-text and often already reads "the water-swollen
 * chest"; `assetNoun`'s fallback ("chest") never does. Prefixing "the "
 * unconditionally doubled it for every authored label that already carried
 * one ("the the water-swollen chest"), in the search dice line, the
 * Perception caption, the found/not-found story lines, and the loot
 * readout's caption. This is the one function every one of those call sites
 * should use instead of building "the ${propLabel(prop)}" by hand.
 */
export function theProp(prop: { assetId: string; label?: string }): string {
  const label = propLabel(prop);
  return /^the\s/i.test(label) ? label : `the ${label}`;
}

/**
 * Rewrite an engine rejection into something a person can read.
 *
 * Every mutator under world/ returns a plain string error written for the DM's
 * next-turn context, and those strings quote token ids and cell coordinates on
 * purpose, because the DM is the audience. When one of them reaches the
 * player's own note banner instead (a Move that hits a wall, a step that costs
 * more movement than is left), those ids and coordinates are exactly the
 * developer text this module exists to keep off the screen. Substituting the
 * same labels the rest of the UI uses is enough: it needs no new error type
 * under world/ and it cannot go stale, because it reads the live token list.
 */
export function humanizeEngineError(error: string, namer: TokenNamer): string {
  let out = error;
  const ids: { id: string; label: string }[] = [
    { id: namer.playerTokenId, label: namer.playerName },
    ...namer.tokens.filter((t) => t.id !== namer.playerTokenId).map((t) => ({ id: t.id, label: `the ${assetNoun(t.assetId)}` })),
  ];
  for (const { id, label } of ids) {
    if (!id) continue;
    out = out.split(`"${id}"`).join(label).split(id).join(label);
  }
  return out.replace(/cell \(-?\d+,-?\d+\)/g, "this room");
}

/** Capitalise the first letter only, so "the goblin" opens a sentence as "The goblin" without touching a proper name that is already capitalised. */
export function sentenceCase(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${n}`;
}

// ── where a bonus came from ──────────────────────────────────────────────

/**
 * Turn a set of contributions into the breakdown a roll line prints, or
 * refuse.
 *
 * "rolled 9, +5 = 14, needed 13 to hit" leaves the +5 an unexplained lump,
 * and a newcomer's first roll contains three numbers nobody has defined for
 * them. Naming the parts fixes that, and introduces a worse failure if it is
 * done carelessly: a breakdown that does not add up to the modifier that was
 * actually rolled is the readout drifting from the engine, which is the same
 * defect class as a decorative armour class. So the sum is checked HERE
 * rather than trusted at each call site, and a mismatch prints today's line
 * unchanged rather than a confident wrong explanation.
 *
 * Two other rules, both about not adding noise:
 *   - a part worth 0 contributed nothing and is dropped, so a common piece of
 *     gear never appears in a line as "+0 Longsword";
 *   - a single remaining part is not an explanation of itself, so
 *     "(+5 Strength and training)" next to "+5" is suppressed.
 */
export function bonusSources(parts: readonly BonusSource[], modifier: number): readonly BonusSource[] | undefined {
  const kept = parts.filter((p) => p.amount !== 0);
  if (kept.length < 2) return undefined;
  const sum = kept.reduce((n, p) => n + p.amount, 0);
  return sum === modifier ? kept : undefined;
}

/** " (+3 Dexterity and training, +2 Keen Longsword)", or nothing at all, which is what keeps every line without sources byte-identical to the one this game already printed. */
function sourceBreakdown(sources?: readonly BonusSource[]): string {
  if (!sources || sources.length === 0) return "";
  return ` (${sources.map((s) => `${signed(s.amount)} ${s.label}`).join(", ")})`;
}

export const ABILITY_NAME: Record<keyof AbilityScores, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

// ── roll lines ───────────────────────────────────────────────────────────

export interface AttackLineInput {
  /** Already through tokenLabel: a name or a noun phrase, never an id. */
  attacker: string;
  target: string;
  roll: number;
  modifier: number;
  total: number;
  targetAC: number;
  hit: boolean;
  critical: boolean;
  fumble: boolean;
  damage?: number;
  targetDown?: boolean;
  /**
   * The target's hit points AFTER this hit, when the engine knows them.
   * Optional because it only exists for a creature with a statblock: a hit on
   * the player is reported through characters/health.ts's own note instead.
   * Omitted entirely rather than shown as a guess, so a line without it reads
   * exactly as it did before monster HP was tracked at all.
   */
  targetHpLeft?: number;
  /**
   * Where the modifier came from, already resolved into words. Optional, and
   * only ever built by `bonusSources`, which refuses a set that does not sum
   * to `modifier`.
   */
  sources?: readonly BonusSource[];
}

/**
 * One attack, in a sentence. The whole formula stays on screen (DESIGN.md's
 * "the dice have to be visible, not summarized away into prose") but the
 * numbers are labelled in words rather than left as bare arithmetic, because
 * the first roll a newcomer ever sees contains three numbers and a newcomer
 * has been told what none of them mean.
 *
 * A natural 20 and a natural 1 are called out by name. The engine already
 * computes `critical`/`fumble` and already reports both to the DM
 * (dm/promptBuilder.ts) -- before this function they were the one thing the
 * game knew and never told the player, which is the biggest single beat in
 * the genre going unmarked.
 */
export function attackLine(a: AttackLineInput): string {
  const opener = `${sentenceCase(a.attacker)} swings at ${a.target}`;
  const math = `rolled ${a.roll}, ${signed(a.modifier)} = ${a.total}${sourceBreakdown(a.sources)}, needed ${a.targetAC} to hit`;
  let verdict: string;
  if (a.critical) verdict = "NATURAL 20, CRITICAL HIT";
  else if (a.fumble) verdict = "NATURAL 1, an automatic miss";
  else verdict = a.hit ? "HIT" : "MISS";

  let tail = "";
  if (a.hit && a.damage !== undefined) {
    if (a.targetDown) tail = ` ${a.damage} damage, and ${a.target} goes down.`;
    else if (a.targetHpLeft !== undefined) tail = ` ${a.damage} damage, ${a.target} has ${hitPoints(a.targetHpLeft)} left.`;
    else tail = ` ${a.damage} damage.`;
  }
  return `${opener}: ${math}. ${verdict}.${tail}`;
}

/** "1 hit point", "7 hit points". A cold reader caught "the goblin has 1 hit points left" on the play screen, and an unpluralised noun in the one line that says how close a fight is to ending reads as a bug in the maths. */
export function hitPoints(n: number): string {
  return `${n} hit point${n === 1 ? "" : "s"}`;
}

/**
 * Movement in both units at once.
 *
 * The round pill stated movement in feet on a board made of tiles and never
 * gave the conversion. One judge: "feet are not tiles. I don't know how many
 * feet a step costs, so I don't know how many steps I get." The other guessed
 * 5 feet per tile and was right, but had to derive it. Both units, always.
 */
export function stepsAndFeet(feet: number): string {
  const steps = Math.floor(feet / FEET_PER_TILE);
  return `${feet} feet of movement left, which is ${steps} step${steps === 1 ? "" : "s"}`;
}

export interface CheckLineInput {
  /** Already through tokenLabel. */
  roller: string;
  /** What was being resisted or attempted, in plain words ("Dexterity save", "Perception"). */
  what: string;
  roll: number;
  modifier: number;
  total: number;
  dc: number;
  success: boolean;
  /**
   * What the roll actually DID, appended after the verdict.
   *
   * Both blind judges flagged the same hole: "Bram, Dexterity save: rolled 9,
   * +1 = 10, needed 13. FAIL." tells a player they failed and never tells
   * them what happened. One of them: "Failed at what? Did I take damage? That
   * line is a result with no event attached." Optional because a skill check
   * whose consequence is the narration's job (a Perception check on a chest)
   * genuinely has no number to append, and inventing one would be worse.
   */
  effect?: string;
  /** Same shape and same guarantee as `AttackLineInput.sources`: built by `bonusSources`, or absent. */
  sources?: readonly BonusSource[];
  /**
   * Contract v2: the NAME of the worn, attuned-or-attunement-free item
   * granting advantage on this check (session/combat.ts's
   * `checkAdvantageFor`, rules lane), or absent when nothing did. Named
   * rather than a bare "with advantage" so a player who never noticed the
   * boots can still connect the line to the item -- the same reasoning
   * `sources` already applies to a plain modifier.
   */
  advantageFrom?: string;
}

/** One saving throw or skill check, same shape and same labelling rules as `attackLine`. */
export function checkLine(c: CheckLineInput): string {
  const rolled = c.advantageFrom ? `rolled ${c.roll} with advantage from ${c.advantageFrom}` : `rolled ${c.roll}`;
  const math = `${rolled}, ${signed(c.modifier)} = ${c.total}${sourceBreakdown(c.sources)}, needed ${c.dc}`;
  const verdict = c.success ? "SUCCESS" : "FAIL";
  const effect = c.effect?.trim();
  return `${sentenceCase(c.roller)}, ${c.what}: ${math}. ${verdict}${effect ? `: ${effect}` : ""}.`;
}

/** The plain-words name of a saving throw ("Dexterity save"), for `checkLine`'s `what`. */
export function saveName(ability: keyof AbilityScores): string {
  return `${ABILITY_NAME[ability]} save`;
}

// ── loot: shown like any other die ───────────────────────────────────────

/**
 * The dice-log line for one engine-rolled loot check (equipmentTypes.ts,
 * section 11.6, "THE WORDS" -- printed verbatim, every case). `itemName` is
 * `gearItemName` of `roll.item`, or null when there is none. The five words
 * on the past-the-cap case are `LOOT_CAP_LINE` itself, printed with no dice
 * at all, because none were rolled -- that case never calls this function.
 */
export function lootLine(roll: LootRoll, itemName: string | null): string {
  if (roll.tier === null) return `Loot: d100 = ${roll.tierRoll}, nothing of value.`;
  const tierWord = TIER_WORD[roll.tier].toLowerCase();
  if (roll.item && itemName) {
    return roll.slotDie >= 2 && roll.slotRoll !== null
      ? `Loot: d100 = ${roll.tierRoll}, ${tierWord}. d${roll.slotDie} = ${roll.slotRoll}: ${itemName}, into your pack.`
      : `Loot: d100 = ${roll.tierRoll}, ${tierWord}: ${itemName}, into your pack.`;
  }
  return `Loot: d100 = ${roll.tierRoll}, ${tierWord}, but you already have every ${tierWord} piece there is.`;
}

// ── where you are ────────────────────────────────────────────────────────

const NUMBER_WORD = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

function rooms(n: number): string {
  const word = NUMBER_WORD[n] ?? String(n);
  return `${word} room${n === 1 ? "" : "s"}`;
}

/**
 * Where the party is, named rather than addressed. The header used to read
 * "cell (0,0)", which is the engine's own coordinate system printed at the
 * player: correct, and meaningless to anyone who hasn't read world/
 * coordinates.ts. Cells carry no authored name (the DM assembles them, it
 * doesn't title them), so the honest name is the one thing the engine really
 * does know: how far this room is from where the campaign started.
 */
export function placeName(cell: CellCoord, origin: CellCoord = { cx: 0, cy: 0 }): string {
  const dx = cell.cx - origin.cx;
  const dy = cell.cy - origin.cy;
  if (dx === 0 && dy === 0) return "where it all began";

  const parts: string[] = [];
  if (dy !== 0) parts.push(`${rooms(Math.abs(dy))} ${dy < 0 ? "north" : "south"}`);
  if (dx !== 0) parts.push(`${rooms(Math.abs(dx))} ${dx < 0 ? "west" : "east"}`);
  return `${parts.join(" and ")} of where you began`;
}

export const DIRECTION_WORD: Record<Edge, string> = {
  N: "north",
  S: "south",
  E: "east",
  W: "west",
};

/** What the compass strip knows about one neighbouring cell, in engine terms, before this module turns it into fiction. */
export interface NeighbourView {
  built: boolean;
  /** True when a built neighbour still has someone other than the player standing in it. */
  occupied: boolean;
  /** The campaign's own biome hint for an unbuilt cell, when the arc outline has one. */
  hint?: string;
}

/**
 * One compass entry. This used to print world/perception.ts's `summary`
 * verbatim ("assembled cell, 1 token, 1 prop"), which is a line written for
 * the DM's prompt, and the literal word "unexplored" four times otherwise.
 * Both are true; neither is something a person reads.
 */
export function neighbourLine(dir: Edge, view: NeighbourView): string {
  const where = sentenceCase(DIRECTION_WORD[dir]);
  if (view.built) {
    return view.occupied
      ? `${where}: a room you have been through, and something is still moving in it`
      : `${where}: a room you have been through`;
  }
  const hint = view.hint?.trim();
  if (hint && hint.toLowerCase() !== "unexplored") return `${where}: ${hint}`;
  return `${where}: unexplored, the DM will build it`;
}

/**
 * The Move button's own words. The repo rule is that every paid action wears
 * its price before the click; the CostBadge does that, but a bare price glyph
 * on one of four identical arrows reads as "north is special" rather than
 * "you are standing at the edge of what has been built", so the reason goes
 * in words too, on hover and on tap.
 */
export function moveButtonTitle(dir: Edge, crossesIntoFog: boolean): string {
  const where = DIRECTION_WORD[dir];
  return crossesIntoFog
    ? `Step ${where}, into a room nobody has built yet. ${CREDIT_BUYS.buildRoom}`
    : `Step ${where}. One step is 5 feet. Free.`;
}

// ── the glossary, and the SRD credit that has to ship with it ────────────

export interface GlossaryEntry {
  term: string;
  /** One sentence. Short enough for a tap-to-explain popover on a phone. */
  short: string;
}

/**
 * Keyed to the exact words the UI puts on screen, not to a general D&D
 * vocabulary: every term here appears somewhere a player can see it, and
 * every number the play screen shows has an entry. Before this list the whole
 * game contained four explanatory strings, all of them `title` attributes on
 * a panel that defaulted to hidden and that a touch device cannot hover.
 */
export const GLOSSARY: GlossaryEntry[] = [
  { term: "d20", short: "A twenty-sided die. Almost everything uncertain in this game is decided by rolling one and adding a bonus." },
  { term: "modifier", short: "The bonus (or penalty) added to a roll, coming from your ability scores and your training." },
  { term: "AC", short: "Armor Class: how hard you are to hit. An attacker rolls a d20, adds their bonus, and has to match or beat it." },
  { term: "DC", short: "Difficulty Class: the number a check or a saving throw has to reach to succeed." },
  { term: "saving throw", short: "A roll to avoid or resist something happening to you, rather than to make something happen." },
  { term: "proficiency", short: "How much your training adds. It applies to the things you are trained in, and it grows as you level up." },
  { term: "hit points", short: "How much damage you can take before you go down. They do not come back on their own; rest, healing, or an item brings them back." },
  { term: "initiative", short: "Who acts first in a fight. Everyone rolls a d20 and adds their Dexterity modifier, highest goes first." },
  { term: "spell slot", short: "One casting of a levelled spell. You get a fixed number, they are spent as you cast, and a long rest gives them back." },
  { term: "death save", short: "At 0 hit points you roll a d20 each turn: 10 or more is a success, three successes stabilise you, three failures do not." },
  { term: "natural 20", short: "The d20 itself came up 20. An attack always hits and deals extra damage, no matter the target's AC." },
  { term: "natural 1", short: "The d20 itself came up 1. An attack always misses, no matter how large the bonus." },
  // The four words a cold reader could not look up, and the one conversion
  // nothing on screen ever gave. A judge who found the rest of this list
  // genuinely good put it exactly: "the problem is the words that don't have
  // one, and those are the words attached to my actual decisions."
  { term: "hit die", short: "One die you can spend on a short rest to get hit points back. You have one per level, and a night's camp gives them all back." },
  { term: "cantrip", short: "A spell you can cast as often as you like. It costs no spell slot, and it is the one spell a caster never runs out of." },
  { term: "superiority dice", short: "A Battle Master's pool of four d8s. Spend one on a hit for extra damage and a chance to knock the target flat or disarm it; any rest gives them all back." },
  { term: "credit", short: "What one message to the dungeon master, or one new room it builds, costs. Fighting, moving, searching, resting and levelling up cost none." },
  { term: "movement", short: "How far you can go on your turn, in feet. One tile on this board is one step and costs 5 feet, so 30 feet is 6 steps." },
  // ── "rarity" IS BACK (issue #15) ─────────────────────────────────────
  //
  // It taught a four-rank ladder nothing in the build could climb, so it was
  // pulled the day `equippableTiers` could only ever answer with the tier
  // already worn. Loot (the engine's own roll at a won fight or a searched
  // container) is the engine-owned grant that was missing; `equippableTiers`
  // can now answer with more than one tier the moment a player has actually
  // found something, so the word is back on screen (the gear rows, and the
  // inventory screen's own rarity chip) and belongs here again.
  {
    term: "rarity",
    short:
      "How strong a piece of gear is, in four ranks shown as a word and a pip count (none, one, two, three), never colour alone. On a weapon, armour or headgear piece, common adds nothing at all, uncommon adds +1, rare +2, and legendary +3, with an extra damage effect on a legendary weapon. A ring, amulet or pair of boots does what its own description says instead, and the plain boots you start in do nothing.",
  },
  {
    term: "attunement",
    short:
      "Some magic items only work while you are attuned to them, which here just means wearing them. You can be attuned to three at once; wearing a fourth is refused until you take one of the first three off.",
  },
];

export function explain(term: string): string | undefined {
  return GLOSSARY.find((g) => g.term.toLowerCase() === term.toLowerCase())?.short;
}

/**
 * The SRD 5.1 credit, carrying all six things CC BY 4.0 actually requires:
 * the creator, the copyright notice, the licence notice, the disclaimer
 * notice, a link to the licence text, and an indication that the material was
 * modified. Kept as data rather than as JSX so the same words can be rendered
 * in the About panel, checked by a test, and copied into the repo's own
 * NOTICE file without three chances to drift apart.
 */
export const SRD_ATTRIBUTION = {
  creator: "This game includes material from the System Reference Document 5.1 by Wizards of the Coast LLC.",
  copyright: "System Reference Document 5.1 Copyright 2016, Wizards of the Coast, Inc.",
  license: "The SRD 5.1 material is licensed under the Creative Commons Attribution 4.0 International License.",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  modified:
    "The material has been modified: the rules here are simplified, rewritten in plain language, and scoped to character levels 1 to 3.",
  disclaimer:
    "The SRD 5.1 material is provided as-is and without warranty of any kind. The Living Table is an independent game, not affiliated with, endorsed by, or sponsored by Wizards of the Coast.",
} as const;
