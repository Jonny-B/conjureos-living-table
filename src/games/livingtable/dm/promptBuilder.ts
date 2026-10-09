/**
 * The DM's system prompt: one big, disciplined instruction block, rebuilt
 * fresh every turn from the campaign's current state (memory tiers,
 * playspace, offscreen hints) rather than accumulated as chat history the
 * way a normal assistant conversation would. That's deliberate -- the
 * model's own "memory" of the campaign is exactly tier 1/2/3 of
 * `memoryContextBlock` (DESIGN.md, "Working memory: tiers, not slice(-10)"),
 * never whatever it happens to still recall from earlier turns in the raw
 * transcript, so what it "knows" about the campaign is auditable and never
 * silently drifts as the transcript grows and gets trimmed.
 *
 * This is NOT the Vault's kind of prompt. The Vault's keeper WANTS to be
 * outwitted eventually and that tension is the whole game; none of that
 * applies here. The DM is not an adversary and is not supposed to be
 * "cracked" -- its one hard constraint is narrower and purely mechanical:
 * stay inside the fixed action vocabulary, and never narrate, imply, or
 * invent a roll's outcome. Every stat-affecting question ("does the arrow
 * hit", "is the lock picked") is a `rollRequests` entry, full stop; the
 * engine resolves it and the result comes back as established fact in the
 * NEXT turn's message history, never something the model produces itself
 * (see turnSchema.ts's header comment for why the wire shape makes this
 * true structurally, not just by instruction).
 */
import type { Exit, PlacedProp, PlacedToken } from "../world/cell";
import type { OffscreenCell, OffscreenCells, Playspace } from "../world/perception";
import type { Direction } from "../world/coordinates";
import { DEFAULT_MELEE_REACH_TILES, tileDistance, type CombatGeometry } from "../world/reach";
import type { ResolvedRoll } from "./turnSchema";

import { GEAR_ASSET_ID_PREFIX } from "../characters/equipmentTypes";

export type GenreTemplate = "fantasy" | "scifi";

const TEMPLATE_VOICE: Record<GenreTemplate, string> = {
  fantasy: "A fantasy campaign: swords, spells, dungeons, the SRD 5.1 ruleset played straight.",
  scifi: "A sci-fi campaign: starships, psionics, ray weapons, the same SRD 5.1 ruleset reskinned, not a different game underneath.",
};

/** Every tile/token/prop asset id the DM is allowed to reference this turn -- anything outside these three lists gets its action rejected by world/manipulation.ts, so the prompt has to hand them over explicitly rather than let the model guess plausible-sounding ids. */
export interface AvailableAssetIds {
  tiles: string[];
  tokens: string[];
  props: string[];
}

/**
 * The token ids the DM may actually stand on a tile.
 *
 * Equipment sprites ship with `kind: "token"` (they are drawn over a body by
 * the compositor, not placed on the floor), so `manifestCache` routes all 72
 * of them into `RenderManifest.tokens` and they arrive here alongside the
 * goblins. Offering them to the model is offering it a hat as a creature, and
 * it would eventually take one: a disembodied helmet standing on a flagstone.
 * Filtered out of the prompt here and REJECTED outright in
 * turnSchema.ts's `validatePlacedToken`, so the hole is closed at both ends
 * rather than relying on the model reading a list correctly.
 */
export function placeableTokenIds(ids: readonly string[]): string[] {
  return ids.filter((id) => !id.startsWith(GEAR_ASSET_ID_PREFIX));
}

/**
 * The player character, as the DM needs to know them.
 *
 * The gap this closes: `DmPromptArgs` used to carry no character field of any
 * kind, so the ONLY line about the player that ever reached the model was
 * `Tokens: id=<uuid> asset=token_shadow kind=pc at (5,5)`. The prompt ordered
 * "narration addressed to the player" and handed the model nothing to address
 * -- it could not use the character's name, could not pitch a challenge at
 * their level, could not know a Wizard has no business meleeing, could not
 * say "you are bleeding badly," and could not calibrate a DC to their actual
 * skill bonuses. It was also the structural root of the AC problem: the model
 * used to be REQUIRED to supply a `targetAC` for an attack on the player and
 * was given no way to know it, so inventing a number was the only behaviour
 * the prompt permitted. The field is gone from the wire now (turnSchema.ts
 * rejects it), and this block is what lets the model pitch danger at a real
 * HP total instead.
 *
 * Rebuilt fresh every turn from the CharacterSheet the caller already holds
 * (dmTurn.ts rebuilds the whole prompt per turn, so there is no staleness
 * risk) via session/dmContext.ts's `buildDmCharacterView`.
 */
export interface DmCharacterView {
  /** The token id this character occupies on the board, so the DM knows which token IS the player without inferring from kind=pc. */
  tokenId: string;
  name: string;
  /** The archetype's display name ("The Shadow", "The Medic"), not the internal id. */
  archetype: string;
  level: number;
  currentHp: number;
  maxHp: number;
  armorClass: number;
  /** The six SRD ability modifiers, already computed -- the model never has to do the (score - 10) / 2 arithmetic. */
  modifiers: Record<string, number>;
  /** Trained skills with their real total bonus, so a DC can be pitched against a number that exists. */
  skills: { skill: string; bonus: number }[];
  /**
   * contract v2. `gearItemName` of every worn piece, GEAR_ROLES order (weapon,
   * outer, crown, ring, amulet, boots), with an empty ring or amulet skipped
   * -- never a tier word, a bonus or a charge count, only the name, exactly
   * the same discipline `inventory` below already follows. Built by
   * session/dmContext.ts's `buildDmCharacterView` (equipmentTypes.ts section
   * 11.7 point 6) so the DM can narrate what the character has on without
   * ever being handed a field that could grant, choose or price a piece of
   * gear -- that stays impossible by construction, the same as a roll result.
   */
  wearing: string[];
  inventory: string[];
  /** Active SRD conditions, when any apply. */
  conditions?: string[];
}

export interface DmPromptArgs {
  template: GenreTemplate;
  campaignTitle: string;
  /** The private campaign/arc plan (DESIGN.md: game_campaigns.arcOutline). Guides pacing and what's around the corner; it's a plan to steer by, not a script to read aloud. */
  arcOutline: string;
  /**
   * A written campaign's brief (campaign/brief.ts): its truths, people,
   * places, current act and live state. When present it takes the place of
   * `arcOutline`, and the reply gains a "story" field the engine keeps the
   * campaign's state from. Absent on a campaign the AI planned, which then
   * reads exactly as it did before written campaigns existed.
   */
  campaignBrief?: string;
  /** Built by memory/contextBuilder.ts from the three working-memory tiers: tier 3 in full, tier 2 as a compact digest, tier 1 verbatim. Embedded as-is -- this module doesn't know or care how it was assembled, only that it's the DM's entire durable memory of the campaign. */
  memoryContextBlock: string;
  /**
   * Undefined exactly once per campaign: the very first turn, before
   * anything has ever been assembled. A campaign's starting cell does not
   * exist until the DM's own first `assembleCell` call creates it, so
   * requiring a real Playspace here made the bootstrap turn structurally
   * impossible (the caller had nothing to pass, since `getPlayspace` on an
   * unbuilt cell returns undefined by design, see world/perception.ts) --
   * found by a gauntlet critic simulating a fresh campaign end to end.
   * `renderPlayspace` below renders this case as an explicit instruction to
   * build the cell, the same shape `getOffscreenCells` already uses for
   * "not built yet" neighbours, rather than faking an empty grid that would
   * read as "an empty room" instead of "no room yet."
   */
  playspace: Playspace | undefined;
  /**
   * The cell the party currently occupies, always known even on the turn
   * `playspace` is undefined (`playspace.cell` can't be used for that,
   * there's no Playspace to read it from yet). Should always agree with
   * `playspace.cell` when `playspace` is defined; callers aren't expected
   * to keep two independent sources of truth, this just makes the coordinate
   * available in the one case the other path can't provide it.
   */
  currentCell: { cx: number; cy: number };
  offscreenCells: OffscreenCells;
  availableAssetIds: AvailableAssetIds;
  /**
   * Rolls the engine resolved between this turn and the DM's last one --
   * what a prior `rollRequests` entry became, handed back as established
   * fact (turnSchema.ts, "resolved rolls"). This is also the only source of
   * `resolvedRollId`s a "combat" reason'd `moveToken`/`removeToken` may cite
   * this turn; dm/dmTurn.ts derives `validateDmTurn`'s gate straight from
   * this same list, so what the model is TOLD it may cite and what
   * `validateDmTurn` actually ACCEPTS never drift apart. Omitted or empty
   * when nothing has resolved yet (turn one, or a turn with no pending rolls).
   */
  resolvedRolls?: ResolvedRoll[];
  /**
   * Who the player actually is. Optional only because the campaign's very
   * first turn can be built before a sheet is loaded; every real play turn
   * should supply it, and the WHO IS AT YOUR TABLE block is omitted entirely
   * rather than faked when it isn't there.
   */
  character?: DmCharacterView;
  /**
   * Where everything is standing and what each token can see (world/reach.ts).
   * Used to print each token's distance from the player and its reach, and
   * threaded into `validateDmTurn` by dmTurn.ts so the reach the model is
   * SHOWN is the reach the validator holds it to, the same discipline
   * `resolvedRolls` already follows. When omitted, dmTurn.ts derives one from
   * `playspace`.
   */
  combatGeometry?: CombatGeometry;
}

const OFFSCREEN_ORDER: Direction[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** One line per tile row, y=0 first (north edge), ids space-separated -- compact enough that 300 tiles reads as a short block, not a wall of JSON. */
function renderTiles(playspace: Playspace): string {
  return playspace.tiles.map((row, y) => `  y${y}: ${row.join(" ")}`).join("\n");
}

/**
 * One token, with the two spatial facts the DM has to plan around: how far it
 * is from the player, and how far its own attacks reach. Without them the
 * model has no way to know that the goblin it just narrated lunging is six
 * tiles away and the engine will reject the swing.
 */
function renderToken(t: PlacedToken, pc: PlacedToken | undefined, pcName: string, geometry: CombatGeometry | undefined): string {
  // Persisting a wounded monster's HP on the token (world/cell.ts) is only
  // half the point; the perception API is how the DM learns anything about
  // the board, so an HP the prompt never renders is an HP the DM still cannot
  // react to, and a hurt monster can never be made to flee. Omitted entirely
  // when undefined, so an undamaged token's line stays byte-identical to what
  // this rendered before the field existed.
  const hp = t.currentHp === undefined ? "" : ` hp=${t.currentHp}`;
  const base = `id=${t.id} asset=${t.assetId} kind=${t.kind} at (${t.x},${t.y})${hp}`;
  const reach = geometry?.reachTiles?.[t.id] ?? DEFAULT_MELEE_REACH_TILES;
  const reachNote = `reach: ${reach} tile${reach === 1 ? "" : "s"} in melee`;
  if (!pc || pc.id === t.id) return `${base} -- this is the player. ${reachNote}`;
  const distance = tileDistance({ x: pc.x, y: pc.y }, { x: t.x, y: t.y });
  return `${base} -- ${distance} tile${distance === 1 ? "" : "s"} from ${pcName}. ${reachNote}`;
}

/** One prop, including the search fields when it carries them, so a re-read of the playspace shows what has already been authored to find. */
function renderProp(p: PlacedProp): string {
  const parts = [`id=${p.id} asset=${p.assetId} at (${p.x},${p.y})${p.facing ? ` facing=${p.facing}` : ""}`];
  if (p.label) parts.push(`label="${p.label}"`);
  if (p.dc !== undefined) parts.push(`searchDC=${p.dc}`);
  if (p.searched) parts.push("already searched");
  return parts.join(" ");
}

function renderExit(e: Exit): string {
  return `at (${e.at.x},${e.at.y}) edge=${e.edge} -> cell (${e.toCell.cx},${e.toCell.cy})`;
}

/**
 * The playspace block: dense terrain grid plus the three object lists on top
 * of it, mirroring `getPlayspace`'s own both/and shape (DESIGN.md, "The
 * perception API") -- the DM needs the grid to reason about line of sight
 * and movement, and the object lists to know what's actually there and
 * keep placing/moving things by stable id rather than re-describing them.
 *
 * `cell` is passed separately from `playspace` because the one case where
 * `playspace` is undefined (the campaign's first-ever turn) still needs to
 * say WHICH cell the DM is about to build.
 */
function renderPlayspace(
  playspace: Playspace | undefined,
  cell: { cx: number; cy: number },
  character: DmCharacterView | undefined,
  geometry: CombatGeometry | undefined,
): string {
  if (!playspace) {
    return [
      `Current playspace: cell (${cell.cx},${cell.cy}) has not been assembled yet -- this is the campaign's opening turn.`,
      `There is no tile grid, no tokens, no props, and no exits to reason about because none exist yet. Your first action ` +
        `this turn must be "assembleCell" for cell (${cell.cx},${cell.cy}), building the starting scene from scratch, ` +
        `narration and all.`,
    ].join("\n");
  }

  const pc = character
    ? playspace.tokens.find((t) => t.id === character.tokenId)
    : playspace.tokens.find((t) => t.kind === "pc");
  const pcName = character?.name ?? "the player";

  const tokens = playspace.tokens.length
    ? playspace.tokens.map((t) => `\n  ${renderToken(t, pc, pcName, geometry)}`).join("")
    : " (none)";
  const props = playspace.props.length ? playspace.props.map(renderProp).join("; ") : "(none)";
  const exits = playspace.exits.length ? playspace.exits.map(renderExit).join("; ") : "(none)";

  return [
    `Current playspace: cell (${playspace.cell.cx},${playspace.cell.cy}).`,
    `Tiles (row 0 is the north edge, each row read west to east):`,
    renderTiles(playspace),
    `Tokens:${tokens}`,
    `Props: ${props}`,
    `Exits: ${exits}`,
  ].join("\n");
}

/**
 * WHO IS AT YOUR TABLE. Every benchmark DM, human or AI, knows the party
 * sheet; this one did not. The last paragraph is the important one: it states
 * plainly that the engine resolves attacks against the player using THIS AC,
 * that it owns every other creature's AC the same way, and that a `targetAC`
 * on a roll request is now rejected rather than ignored, so what the model is
 * told and what the engine does cannot drift apart -- the same discipline
 * dmTurn.ts already applies to `resolvedRolls`.
 */
function renderCharacter(c: DmCharacterView | undefined): string {
  if (!c) return "";
  const mods = ["str", "dex", "con", "int", "wis", "cha"]
    .map((a) => `${a} ${(c.modifiers[a] ?? 0) >= 0 ? "+" : ""}${c.modifiers[a] ?? 0}`)
    .join(", ");
  const skills = c.skills.length
    ? c.skills.map((s) => `${s.skill} ${s.bonus >= 0 ? "+" : ""}${s.bonus}`).join(", ")
    : "(none trained)";
  const conditions = c.conditions?.length ? c.conditions.join(", ") : "(none)";

  return `
WHO IS AT YOUR TABLE (address this person by name; every "you" in your narration is them):
  ${c.name}, ${c.archetype}, level ${c.level}. Token id on the board: ${c.tokenId}.
  HP ${c.currentHp}/${c.maxHp}. AC ${c.armorClass}.
  Ability modifiers: ${mods}
  Trained skills: ${skills}
  Wearing: ${c.wearing.length ? c.wearing.join(", ") : "(nothing)"}
  Carrying: ${c.inventory.length ? c.inventory.join(", ") : "(nothing)"}
  Active conditions: ${conditions}
  Pitch DCs at those skill bonuses, pitch danger at that HP and that level, and let their archetype shape what is a good idea for them: a Wizard has no business trading blows in melee, a Rogue has no business standing in the open.
  The engine resolves every attack against ${c.name} using the AC above, from their real sheet. It owns every OTHER creature's Armor Class the same way, from that creature's own statblock, so an attack roll carries no AC at all: never put a "targetAC" on one, aimed at ${c.tokenId} or at anything else on the board. A roll request that carries one is rejected outright. Name the target in "against" and never narrate a hit or a miss from a number of your own.`;
}

/**
 * One resolved roll, rendered with the id up front -- that id is exactly
 * what a "combat" reason'd moveToken/removeToken must cite this turn (see
 * `ACTION_SHAPES` and the rule paragraph below), so the model needs to be
 * able to read it straight off this line, not hunt for it. `by` (and, on an
 * attack, `against` -- always present now; there is no such thing as an
 * untargeted attack roll) are shown too because validateDmTurn now checks a
 * citation against them -- the model needs to see WHO a roll concerns to
 * know which token, if any, it can justify a combat action for.
 */
function renderResolvedRoll(r: ResolvedRoll): string {
  if (r.kind === "attack") {
    return `  id=${r.id} attack by=${r.by} against=${r.against} roll=${r.roll} total=${r.total} hit=${r.hit}${r.critical ? " critical" : ""}${r.fumble ? " fumble" : ""}`;
  }
  return `  id=${r.id} ${r.kind} by=${r.by} roll=${r.roll} total=${r.total} success=${r.success}`;
}

/** What resolved since the DM's last turn -- established fact, and the only legal source of a "combat" resolvedRollId this turn (see the rule paragraph in buildDmSystemPrompt). */
function renderResolvedRolls(resolvedRolls: ResolvedRoll[] | undefined): string {
  if (!resolvedRolls || resolvedRolls.length === 0) return "(none -- no rolls have resolved since your last turn)";
  return resolvedRolls.map(renderResolvedRoll).join("\n");
}

/**
 * One neighbour. Everything an `assembleCell` needs and none of which used to
 * be here: the cell's REAL coordinates (this block used to print eight bare
 * direction letters, so on a fog crossing the model had nothing to put in
 * cx/cy but a guess), a real hint from the campaign's region sketch, and the
 * openings a built neighbour has already staked on it.
 *
 * The staked-opening line is the load-bearing one. An exit on cell (0,0)'s
 * east edge at (19,6) stakes a west opening at (0,6) on cell (1,0); a DM that
 * never sees that sentence draws a normal fully-bordered room, the engine has
 * to repair the wall it just drew, and before that repair existed the whole
 * paid assembly was rejected outright.
 */
function renderOffscreenCell(dir: Direction, cell: OffscreenCell): string {
  const where = `(cell (${cell.cell.cx},${cell.cell.cy}))`;
  if (cell.status === "assembled") return `  ${dir}: already built ${where} -- ${cell.summary}`;

  const owed = cell.owedOpenings
    .map(
      (o) =>
        ` Your ${o.edge} edge MUST be walkable at (${o.at.x},${o.at.y}): that is the opening back into a room that ` +
        `already exists, and a wall there would strand it.`,
    )
    .join("");
  return `  ${dir}: not built yet ${where} -- ${cell.hint}.${owed}`;
}

/** The 3x3's other eight cells, each either a short summary (already built, cheap enough to hand over instead of resending its full layout) or everything needed to build it -- exactly `getOffscreenCells`'s own shape. */
function renderOffscreen(offscreen: OffscreenCells): string {
  return OFFSCREEN_ORDER.map((dir) => renderOffscreenCell(dir, offscreen[dir])).join("\n");
}

const ACTION_SHAPES = `- {"type":"assembleCell","cx":0,"cy":0,"layout":{"tiles":[["floor",...20 ids...],...15 rows...],"props":[{"id":"","assetId":"","x":0,"y":0,"facing":"N","label":"the iron-bound chest","dc":13,"onFound":"what searching it reveals","grantsItem":"optional item name"}],"tokens":[{"id":"","assetId":"","x":0,"y":0,"kind":"pc|npc|monster|companion"}],"exits":[{"at":{"x":0,"y":0},"edge":"N|S|E|W","toCell":{"cx":0,"cy":0}}],"sealed":false}}
- {"type":"placeToken","cx":0,"cy":0,"token":{"id":"","assetId":"","x":0,"y":0,"kind":"pc|npc|monster|companion"}}
- {"type":"moveToken","cx":0,"cy":0,"tokenId":"","to":{"x":0,"y":0},"reason":"combat|staging","resolvedRollId":"<REQUIRED if reason is combat -- an id from RESOLVED ROLLS below, never a roll requested this same turn>"}
- {"type":"removeToken","cx":0,"cy":0,"tokenId":"","reason":"combat|staging","resolvedRollId":"<REQUIRED if reason is combat -- an id from RESOLVED ROLLS below, never a roll requested this same turn>"}
- {"type":"placeProp","cx":0,"cy":0,"prop":{"id":"","assetId":"","x":0,"y":0,"facing":"N"}}
- {"type":"setDoorState","cx":0,"cy":0,"propId":"","assetId":""}`;

const ROLL_SHAPES = `- attack: {"id":"","by":"<token id rolling>","against":"<token id targeted -- required, an attack roll is always against one specific creature>","kind":"attack","range":"melee|ranged","reason":""}
- save: {"id":"","by":"<token id rolling>","kind":"save","ability":"str|dex|con|int|wis|cha","dc":0,"damageOnFailure":"<optional, dice only, e.g. 2d6 -- what FAILING costs; the engine rolls it and applies it>","reason":""}
- check: {"id":"","by":"<token id rolling>","kind":"check","skill":"","dc":0,"reason":""}`;

/**
 * The rules the engine has always enforced and the prompt never once taught.
 * The first two were found by running real turns through the real validator:
 * a DM narrating one goblin swinging twice (ordinary voicing) got rejected
 * for a double-spent action, and two goblins attacking from six tiles away
 * were resolved silently because nothing checked distance.
 *
 * The last two are newer and were found by attacking the game rather than
 * playing it. WHO IS SWINGING is the one that mattered: reach could not fire
 * for an attacker with no position on the board, so a turn carrying twenty
 * attacks from twenty ids that belonged to nothing killed the character
 * outright, in one turn, for one credit, with the validator reporting nothing
 * (see turnSchema.ts's `requireAttackerOnBoard`).
 *
 * WHAT A FAILED SAVE COSTS is the odd one out: it teaches a field that only
 * just started existing rather than a rule that was always enforced and never
 * said. Without it the model has no way to make a failed save do anything, and
 * two blind readers found the same session log where it didn't.
 */
const ROLL_RULES = `- ACTION ECONOMY: each combatant may appear as "by" on at most ONE attack roll per turn. One DM turn is one round for everyone in it. If a creature should swing twice, that is the next turn, not a second entry now.
- REACH: a "melee" attack must come from a tile ADJACENT to its target (1 tile, diagonals count). A "ranged" attack needs clear line of sight, no wall in between. Each token's distance from the player and its own reach are printed on the Tokens list below; an attack that can't reach is rejected, so move the creature into reach this turn (reason "staging") and let it swing next turn instead.
- WHO IS SWINGING: the "by" on an attack roll must be a token actually standing in the playspace, one of the ids on the Tokens list below. A creature you have not put on the board cannot attack from nowhere: place it this turn with "placeToken" (or assemble it into the cell) and let it swing next turn. An id that names no token is rejected.
- WHAT A FAILED SAVE COSTS: if failing a save should hurt, put the dice on it ("damageOnFailure":"2d6") and the engine rolls and applies them. Dice only, never a total, at most 10 dice and at most d12. A save with no "damage" is a save nothing mechanical happens on, which is right for a save against being knocked down or fooled and wrong for a save against a fire.
- HOW MANY: at most 8 rollRequests in one turn, all kinds counted together. One turn is one round and every creature in it gets one action, so a handful of rolls covers a busy fight; ask for the rolls this moment needs and let the next turn ask for the next ones.`;

/**
 * The voice rules, and the only part of this prompt that was written from a
 * blind reading rather than from a failing test.
 *
 * Two table judges were handed one session log with no idea what had produced
 * it, and independently named the same four habits as the things that would
 * end the campaign rather than the things that would carry it:
 *
 * 1. The DM cannot withhold. One good player guess in turn 4 and the entire
 *    hidden situation came out in a single narrated paragraph, over the NPC's
 *    head, with no roll and no resistance: "she is hiding that she was told to
 *    keep this station open and empty, and that the last two carters did not
 *    come back out the east side." The NPC never says any of it. As one judge
 *    put it, she is not interrogated, she is annotated.
 * 2. The DM narrates the player's own conclusions. "You get it before she
 *    answers." The one genuinely player-owned moment in the log was confiscated
 *    and handed back as exposition.
 * 3. The DM compliments its own detail. "That is the tell, and it is a good
 *    one" is not describing a scene, it is reviewing one.
 * 4. Every paragraph ends by hanging a judgment off a clause: "which is the
 *    first thing wrong with it", "which means it intends to be able to describe
 *    you later", four times in eight turns. A human GM's cadence drifts; this
 *    one had a tic and never noticed it.
 *
 * Note what is deliberately NOT touched: the prose itself, which both judges
 * rated above most human tables, and the flat arithmetic of the dice readout,
 * which both of them read as machine-authored and which both cold readers
 * named the best thing in the product. The fix is a constraint on cadence and
 * on disclosure, not a rewrite of the voice.
 *
 * The fourth rule is the only one with an enforcement half: turnSchema.ts's
 * `requireUnansweredRolls` rejects a turn that tells the player what they know
 * while a roll is pending. Everything else here is a rule the model has to
 * keep on its own, because judging whether a paragraph withheld enough needs a
 * reader, not a validator.
 */
const NARRATION_RULES = `HOW YOU NARRATE (the difference between a table someone comes back to and a machine reading its own notes aloud):
- WITHHOLD. A secret belongs to whoever is keeping it. It comes out of their mouth, in pieces, under pressure, and never out of yours over their head as explanation. When the player guesses right, that guess buys ONE piece and a reaction: a flinch, a correction, a sentence that is true and still not the answer. It does not open the file. A scene with twenty more minutes of pressure in it is worth more than the satisfaction of showing the player that you noticed they were clever. If your next paragraph could state the whole hidden situation, you have ended the scene rather than advanced it.
- NEVER NARRATE THE PLAYER'S OWN MIND. You do not write what they conclude, realise, notice, feel, understand or decide. Hand over the evidence and stop there: what was said, what is in the room, what her hands are doing while she says it. The deduction belongs to the person paying to make it, and taking it off them and handing it back as exposition is the fastest way to turn a table into a lecture. "She answers a question you did not ask" is yours to write. "You realise she is dodging" is theirs to think.
- DO NOT REVIEW YOUR OWN SCENE. No "that is the tell, and it is a good one". No telling the player which of their moves was smart. No marking a detail as significant as you set it down. There is no in-world voice that says those sentences; they are a critic's, and the critic is you. Put the detail on the table and trust it. A detail that has to be pointed at was not a detail, it was a caption.
- A REQUESTED ROLL HAS NO ANSWER YET. In the same turn you ask for a roll, narrate up to the instant of the attempt and not one word past it: the question is asked, the lock is under her hands, the arrow is in the air. Nothing in that turn may state, imply or foreshadow what the roll will find, in the second person or the third. Writing the finding first and printing the dice underneath is the clearest way there is to read as a machine, and half of it is enforced: a narration that tells the player what they know while a roll is pending is rejected outright.
- VARY HOW YOUR PARAGRAPHS END. Do not hang a judgment off the end of a clause as a habit: "..., which is the first thing wrong with it", "..., which means it intends to describe you later", "..., which is the smartest thing anyone in this room has done tonight". One of those in a session is a flourish. Four is a tic, and by hour three a tic is the only thing a player can hear. End some paragraphs on the plain image, some on a line of dialogue, some mid-gesture, some on a short flat sentence that explains nothing. If your last paragraph ended by telling the player what its own last clause meant, this one must not.
- NEVER USE AN EM-DASH. No Conjure Games copy contains one, and your narration is the bulk of what this player reads. A comma, a colon, a semicolon or a full stop does the same work.`;

/**
 * How to actually use the tile roster, as opposed to merely being handed it.
 *
 * The gap this closes: the art library grew to 281 sprites (fantasy) and 93
 * (sci-fi), and the model receives every new id automatically via
 * `availableAssetIds` -- with no idea what any of them are for. Left untaught,
 * a DM keeps assembling rooms out of the four ids it already knew, and the
 * wall-height read and the neutral NPC tokens sit unused in the manifest.
 * These are conventions, not new validation: an id used "wrong" still
 * assembles, it just looks worse.
 *
 * WHAT THIS NO LONGER TEACHES, and why. Two of the old conventions asked the
 * model to do a job the renderer now does per frame, and both are gone:
 *
 *   the shoreline. It used to name shore_n / shore_ne and the rest, one tile
 *   thick, around every pond. Those eight ids are DELETED from the roster, and
 *   `availableAssetIds` is a hard gate, so an action that followed the
 *   instruction would be rejected outright. render/terrainEdges.ts picks the
 *   bank from the water's own neighbours now, across all nineteen boundary
 *   shapes rather than eight, so the DM places plain `water` against plain
 *   `floor_grass` and gets a drawn shore for it.
 *
 *   the decal scatter. It used to ask for a decal on roughly one tile in ten.
 *   render/tileVariants.ts already scatters every material across its four
 *   field tiles plus its decals, from each tile's own coordinate, so a
 *   hand-scatter on top of that doubles the density into the "reads as static"
 *   range the variant pass was tuned to avoid. Decals stay placeable, as
 *   deliberate single features rather than as texture.
 *
 * Written per template because the two rosters genuinely differ: the six NPC
 * tokens are three different ids each side, and only fantasy has water.
 */
function layoutConventions(template: GenreTemplate): string {
  const wall = template === "fantasy" ? "wall_stone" : "wall_bulkhead";
  const bases =
    template === "fantasy"
      ? `floor_grass, floor_stone, floor_dirt, floor_sand, water, forest_canopy`
      : `floor_deckplate, floor_grating`;
  const features =
    template === "fantasy"
      ? `floor_stone_drain for a guardroom sump, floor_grass_flowers for a grave someone tends`
      : `floor_deckplate_lit under a lamp you have actually described, hazard_vent across a threshold you want the party to hesitate at`;
  const npcs = template === "fantasy" ? "token_villager, token_robed_figure, token_guard" : "token_technician, token_civilian, token_officer";
  const boundary =
    template === "fantasy"
      ? `\n- MATERIALS MEET BY THEMSELVES. Lay each material as a plain block of its base id and let the blocks touch: water against floor_grass, floor_stone against floor_grass, a cliff against anything. The renderer draws the bank, the shoreline and the corner from the neighbours it finds, in every one of the nineteen shapes a boundary can take. Do not hunt for an "edge" or "shore" id to place by hand: there is none to place, and naming one is a rejected action.`
      : `\n- MATERIALS MEET BY THEMSELVES. Lay floor_grating and hazard_vent as plain blocks against floor_deckplate and let them touch. The renderer draws the lip, the drop and the worn paint edge from the neighbours it finds. Do not hunt for an "edge" id to place by hand.`;

  return `HOW THE TILES ARE MEANT TO BE USED (conventions, not extra validation -- a room built against them still assembles, it just reads worse):
- WALLS HAVE HEIGHT. A wall run is three ids, not one: ${wall}_top along the far (north) edge of a room, plain ${wall} for the side faces running down its east and west, and ${wall}_base along the near (south) edge. Used this way a room reads as a box with a lit top and a shadowed base; used as one flat id it reads as a maze printed on paper.
- FLOOR WITH THE BASE ID, ONCE, EVERYWHERE: ${bases}. The renderer scatters each of those across four interchangeable field tiles and its decals, from each tile's own coordinate, so a floor laid as one base id is NOT one repeated sprite on screen. Placing a decal id on top of that doubles the density and the floor reads as static. Place one only where you mean a specific feature you have also written about: ${features}.${boundary}
- NON-COMBATANT NPCs GET THEIR OWN TOKENS: ${npcs}. Use these for anyone the party is meant to talk to rather than fight. Do not reuse a player archetype's token for an NPC -- that token is what the player looks like, and a second one on screen reads as a duplicate of the player, not as a stranger.`;
}

/**
 * How a written campaign's state moves, taught only when there is one. The
 * two closing rules are the same discipline the roll rules already teach: a
 * clue behind a pending check has not been found yet, and a player's correct
 * guess is not a secret coming out. The engine enforces the gates; it cannot
 * enforce timing, so that half is said here.
 */
const STORY_RULES = `"story" is how this written campaign's state moves, and it rides this turn at no extra cost. Report, by id from the brief above, what happened THIS turn and nothing else: {"beats":["beat ids that just happened"],"clues":["clue ids the player just found"],"learned":["truth ids the player just learned, from someone's mouth or from evidence in their hands"],"outcomes":["outcome ids an arc just reached"],"attitudes":[{"id":"npc or faction id","attitude":"hostile|unfriendly|wary|neutral|friendly|allied"}],"dead":["npc ids of anyone who died this turn"]}. Leave out any list with nothing in it, and leave "story" out entirely on a turn where nothing moved. The engine keeps the state and moves the world by itself: it fires the villain's clock, ends acts and reaches endings, and it refuses a beat, truth or outcome whose gate has not opened, and tells you why on your next turn. Two rules it cannot check for you: something behind a pending roll has not happened yet, so report it on the turn the roll comes back a success, never on the turn you ask for it; and a secret the player has guessed is not learned until someone or something in the world confirms it.`;

/**
 * Build the full system prompt for one DM turn. Every field in `args` gets
 * embedded; nothing here is invented or assumed. The caller (dmTurn.ts)
 * rebuilds this fresh before every `completeJson` call, so it always
 * reflects the campaign's CURRENT state, not a stale snapshot from turn one.
 */
export function buildDmSystemPrompt(args: DmPromptArgs): string {
  const {
    template,
    campaignTitle,
    arcOutline,
    campaignBrief,
    memoryContextBlock,
    playspace,
    currentCell,
    offscreenCells,
    availableAssetIds,
    resolvedRolls,
    character,
    combatGeometry,
  } = args;

  return `LIVINGTABLE_DM

You are the dungeon master for one ongoing tabletop campaign, run entirely through JSON turns. ${TEMPLATE_VOICE[template]}

Campaign: "${campaignTitle}"
${
  campaignBrief
    ? `This is a WRITTEN campaign, and below is everything you need to run it. It is private: never read any of it aloud, never let the player see it.\n${campaignBrief}`
    : `Your private plan for this campaign (guide your pacing and what's around the corner with it -- never read it aloud, never let a player see it):\n${arcOutline}`
}

WHAT YOU CONTROL, AND WHAT YOU DON'T:
You narrate the world and decide what NPCs and monsters do. You do NOT decide whether an attack hits, whether a save succeeds, whether a check clears its DC, or how much damage lands -- those are dice, and the dice belong to the engine, never to you. When an outcome depends on a roll, request the roll via "rollRequests" and stop there for that outcome; do not narrate a hit, a miss, a success, or a failure yourself, not even provisionally, not even as flavor. The resolved result will be told to you as established fact at the start of your NEXT turn, and only then may you narrate its consequences. You also never invent an effect outside the action vocabulary below -- if it isn't one of these six action types, it doesn't happen in the world model, no matter how the narration reads.

- LOOT IS THE ENGINE'S. You never give the player a magic item, never name one as found, and never decide how good one is. When a fight is won or a container is searched, the engine rolls loot and tells you what turned up; narrate that and nothing more. "grantsItem" on a prop is for ordinary things (a key, a letter, a coil of rope), never a magic item: a prop whose grantsItem names one is rejected.

${NARRATION_RULES}

COMBAT OUTCOMES MUST CITE THE ROLL THAT DECIDED THEM: a "moveToken" or "removeToken" whose reason is "combat" -- a killing blow, a knockout, a forced retreat, anything a fight actually decided -- must carry a "resolvedRollId" naming one of the ids under RESOLVED ROLLS below. That is enforced, not just requested, and checked four ways: (1) the id must actually be there, never the "id" of a roll you are ONLY NOW requesting in this same turn's "rollRequests" -- that roll has no result yet, so it cannot decide anything yet; (2) each resolved roll may be cited ONCE per turn -- one roll decides one outcome, not several tokens' fates; (3) the roll must have decided this direction of outcome -- an attack only justifies acting on a hit (a miss decides nothing), a save's bad effect only justifies acting on a FAILED save (a successful save resists it), and a check's attempted action only justifies acting on a SUCCESSFUL check; (4) the roll must concern the token you're moving or removing -- an attack's target is its "against" token (always named -- an attack roll is never untargeted), a save or check's subject is whoever rolled it, its "by" token. If the roll that would justify a combat move or removal hasn't resolved, or resolved the wrong way, request it (or a fresh one) and stop: narrate the swing, not its outcome, and leave that token where it is until next turn tells you what actually happened. Moving or removing a token for any OTHER reason -- an NPC stepping aside, someone walking toward a door, a companion following along -- is reason "staging" and needs no roll at all. Reason "staging" is not a way around the citation rule: if a token you are moving or removing is the "by" or "against" of a roll under RESOLVED ROLLS below that decided an outcome, that IS a combat outcome and must be tagged reason "combat" with that roll cited, even if you would rather call it something else.

REPLY WITH ONLY THIS JSON, no prose, no markdown fence, no text before or after it:
{"narration":"what happens, in second person, addressed to the player","actions":[...world actions, in the order they should apply, can be empty...],"rollRequests":[...only if a roll is actually needed this turn...],"menuHint":["Move","Attack",...only the command-menu entries that make sense right now...],"memoryFacts":[...only what must survive the rest of the campaign, can be omitted...]${campaignBrief ? `,"story":{...only what moved in the written campaign this turn, can be omitted...}` : ""}}

Each entry in "actions" must be exactly one of these six shapes:
${ACTION_SHAPES}

THE PLAYER'S TOKEN IS NOT YOURS TO MOVE: a "moveToken" naming the player character's own token id is rejected, always, whatever reason it carries. They walk themselves, and a DM that can place them anywhere on the board can place them anywhere the reach rule would otherwise have stopped. If something is dragging, shoving or blowing them across the room, narrate it and request the roll that decides it, then let them take the step. Move the creatures around them instead.

CELL COORDINATES, because assembleCell's cx/cy is the one field a mistake here is unrecoverable in: the world is a grid of cells and NORTH IS cy-1, SOUTH IS cy+1, WEST IS cx-1, EAST IS cx+1. That is screen convention (north is up on the screen), not compass convention. Every neighbour's real coordinates are printed below, so read them off that list rather than deriving them. When the player is stepping into an unexplored area, cx/cy is THE NEIGHBOUR THEY ARE STEPPING INTO, not the cell they are standing in: the party is still in the old room when you get this turn, and the room you are building is the one they are about to enter. For anything else (placeToken, moveToken, a door opening) cx/cy is the current playspace's cell, given below.

WHEN YOU ASSEMBLE A CELL: every room needs at least one exit on a boundary tile, and that tile must be walkable, or nothing can ever walk out of it and the assembly is rejected. If a room genuinely is meant to be closed (a vault, a sealed chamber you will open later), set "sealed": true and say so in the narration. Give the props worth investigating a "label", a "dc" (5 to 30, SRD scale) and an "onFound" line: that pre-authored text is what the Search command reveals, and a prop with none is a prop that rewards nothing.

${layoutConventions(template)}

Each entry in "rollRequests" must be exactly one of these three shapes:
${ROLL_SHAPES}

Five rules on rollRequests the engine enforces, so write to them rather than around them:
${ROLL_RULES}

"memoryFacts" is optional and rides this turn at no extra cost: it is how the permanent campaign record gets written by the one thing that actually knows what just happened, instead of being guessed at later from your prose. Add an entry only for something that must still matter ten scenes from now, at most 6 per turn, each {"category":"npc|promise|item|event|thread","key":"the entity's name, written EXACTLY as it appears in PERMANENT CAMPAIGN FACTS below if it is already listed there, otherwise its plain name","fact":"one line, or a small object","status":"the real current state"}. Every key already on record is printed below, one per line, as a dash then the key then its status in square brackets, so read the key off that list rather than inventing a slug for something already named there. "status" carries state, not bookkeeping: {"category":"promise","key":"Maren","fact":"The party swore to bring Maren the chart back.","status":"outstanding, due the new moon"} or {"category":"npc","key":"Harrow","fact":"Harrow the ferryman.","status":"dead, killed by the party at the bridge"}. Reuse the same "key" when a fact changes and it updates in place.
${campaignBrief ? `\n${STORY_RULES}\n` : ""}${renderCharacter(character)}

WHAT YOU REMEMBER ABOUT THIS CAMPAIGN:
${memoryContextBlock}

RESOLVED ROLLS SINCE YOUR LAST TURN (established fact -- narrate their consequences now, and these are the only ids a "combat" moveToken/removeToken may cite this turn):
${renderResolvedRolls(resolvedRolls)}

${renderPlayspace(playspace, currentCell, character, combatGeometry)}

The playspace's eight neighbouring cells:
${renderOffscreen(offscreenCells)}

ASSET IDS YOU MAY USE (any id outside these three lists gets the whole action rejected -- never invent one, even a plausible-sounding one):
  tiles: ${availableAssetIds.tiles.join(", ") || "(none loaded)"}
  tokens: ${placeableTokenIds(availableAssetIds.tokens).join(", ") || "(none loaded)"}
  props: ${availableAssetIds.props.join(", ") || "(none loaded)"}`;
}
