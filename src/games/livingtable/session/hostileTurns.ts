/**
 * The other side's turns: one monster's whole turn, and the loop that runs
 * every hostile turn between now and the player's next one.
 *
 * These used to live in LivingTable.tsx, which is the screen, and which pulls
 * React and the games-db bridge into anything that imports it. They are pure
 * (no model call, no canvas, no state), so they moved here, and LivingTable.tsx
 * re-exports them under the names it always had so every import and test
 * written against the screen still resolves. A bench, a test or a second
 * screen can now run a fight's hostile half without a React tree.
 *
 * WHAT CHANGED WITH THE MOVE, and nothing else did:
 * - A monster walks the pathfinder's route (world/pathing.ts), one square at
 *   a time through `moveToken`, instead of stepping by `Math.sign` toward the
 *   player and stopping at the first refusal. A goblin behind a wall with a
 *   gap in it now goes round through the gap; it used to stand at the wall
 *   until the fight ended.
 * - A monster spends the round's real hostile economy at its own speed. It
 *   built a fresh 30 ft. economy of its own and `runHostileTurns` never passed
 *   `speedFt`, so the economy the round tracks for each hostile was decorative.
 *   The round now hands each monster its own combatant's economy, takes the
 *   spent one back, and a monster that has already used its action does not
 *   swing a second time.
 * - Every event comes back (`CombatEvent[]`), in order, beside the lines, story
 *   and readout. `runHostileTurns` used to keep only the LAST readout, so with
 *   two monsters only the second swing's plate ever showed.
 */
import type { CharacterSheet } from "../characters/creation";
import { applyDamage } from "../characters/health";
import {
  activeCombatant,
  endTurn as endCombatTurn,
  FEET_PER_TILE,
  MELEE_REACH_FT,
  tileDistanceFeet,
  withActiveEconomy,
  type CombatRound,
} from "../menu/combatRound";
import { attackLine, tokenLabel, type TokenNamer } from "../menu/labels";
import { attackResultToReadout } from "../render/rollReadoutAdapter";
import { resetTurnEconomy, spendAction, type TurnEconomy } from "../rules/actionEconomy";
import { resolveAttack, resolveDamage } from "../rules/combat";
import type { ResolvedRoll } from "../dm/turnSchema";
import { DEFAULT_SPEED_FT, effectiveArmorClass, monsterDamageNotationFor, statblockFor } from "./combat";
import {
  DEFAULT_MELEE_REACH_TILES,
  approachTile,
  fieldCostFt,
  getCell,
  movementField,
  pathTo,
  tileDistance,
  walkPath,
  type AssetManifest,
  type CellCoord,
  type CellLayout,
  type MovementField,
  type TileCoord,
  type World,
} from "../world/index";
import { attackEvents, type CombatEvent, type DiceLogEntry, type ReadoutView } from "./combatEvents";

export type { CombatEvent, DiceLogEntry, ReadoutView } from "./combatEvents";

/**
 * What one monster's turn came to. `lines`, `story`, `resolved` and `readout`
 * are what the screen has always printed; `path` and `events` are the same walk
 * and swing told as data (`path` is the squares entered, empty when it did not
 * move); `economy` is the one it had left, for the caller that is tracking it
 * round to round.
 */
export interface MonsterTurnOutcome {
  world: World;
  sheet: CharacterSheet;
  lines: DiceLogEntry[];
  story: string[];
  resolved: ResolvedRoll[];
  readout: ReadoutView | null;
  moved: boolean;
  path: TileCoord[];
  events: CombatEvent[];
  economy: TurnEconomy;
}

/**
 * Whether `a` is a better square to head for than `b` when `target` cannot be
 * reached: nearer the target in the game's own measure (Chebyshev tiles, the
 * distance every reach check, attack and movement cost in this engine uses),
 * then cheaper to walk to, then nearer in a straight line so a monster picks the
 * side that faces the target before a corner.
 *
 * The straight-line distance used to come first. It does not agree with the
 * game's tiles (a square 3 tiles off on the diagonal is 18 away in squares and a
 * square 4 tiles off along a row is 16), so a monster could rank a square that is
 * farther by the game's reckoning as the nearer one and finish its turn farther
 * from the hero than it started (4 of 1430 unreachable-hero turns in the
 * checker's fuzz). It also sent a monster the long way round a wall to a square
 * no nearer, in tiles, than one it could step to.
 */
function betterGoal(field: MovementField, a: TileCoord, b: TileCoord, target: TileCoord): boolean {
  const byTiles = tileDistance(a, target) - tileDistance(b, target);
  if (byTiles !== 0) return byTiles < 0;
  const byCost = fieldCostFt(field, a)! - fieldCostFt(field, b)!;
  if (byCost !== 0) return byCost < 0;
  return (a.x - target.x) ** 2 + (a.y - target.y) ** 2 < (b.x - target.x) ** 2 + (b.y - target.y) ** 2;
}

/**
 * The squares a monster walks this turn to get at `target`, for as far as the
 * floor lets it: along the route to the cheapest square next to the target when
 * there is one, or toward the nearest square it CAN reach when there is none
 * (the target is behind a closed door, or every square around it is taken).
 * Planned with no budget so the route is the real shortest one, then cut to the
 * `steps` squares this turn's movement pays for.
 *
 * The fallback is what keeps a goblin queueing at a door instead of standing
 * where it started. It never leaves a monster FARTHER from the target than it
 * began, in the game's own tiles: the start square is itself a candidate and
 * wins whenever nothing reachable is nearer, and a route that has to lead away
 * from the target before it comes back (round a wall) is walked only as far as
 * the last square that is no farther than the start, so a turn cannot end part
 * way out. When the way round is longer than that the monster holds its ground
 * rather than backing off. A route to a target that CAN be reached is walked
 * as far as the movement goes: it is the true shortest way there, and may
 * wander away by the straight-line measure for a while.
 */
function approachPlan(layout: CellLayout, manifest: AssetManifest, monsterId: string, from: TileCoord, target: TileCoord, steps: number): TileCoord[] {
  const field = movementField(layout, manifest, monsterId, from, Infinity);
  const goal = approachTile(field, target, DEFAULT_MELEE_REACH_TILES);
  if (goal) return (pathTo(field, goal) ?? []).slice(0, steps);

  // `field.reached` is nearest-cost first and the comparison is strict, so a
  // tie on every key goes to the square that was found first.
  let best = field.from;
  for (const tile of field.reached) {
    if (betterGoal(field, tile, best, target)) best = tile;
  }
  const walk = (pathTo(field, best) ?? []).slice(0, steps);
  const began = tileDistance(from, target);
  let keep = walk.length;
  while (keep > 0 && tileDistance(walk[keep - 1]!, target) > began) keep--;
  return walk.slice(0, keep);
}

/**
 * One monster's whole turn, resolved locally and for free.
 *
 * DESIGN.md prices combat at nothing, forever, which means a fight must never
 * need a paid message to get a response out of the other side. Before this
 * function, monsters simply never acted: `rollInitiative` had no callers, and
 * the only way to make a goblin do anything was to spend a credit on Talk,
 * which quietly pushed the player toward the paid surface just to make a
 * fight feel like a fight.
 *
 * The monster closes if it has to and swings if it can, in that order, which
 * is the SRD's own move-then-act turn. Exported so its behaviour is testable
 * against a fixture world without a canvas or a React tree.
 */
export function resolveMonsterTurn(args: {
  world: World;
  cell: CellCoord;
  manifest: AssetManifest;
  monsterId: string;
  playerTokenId: string;
  sheet: CharacterSheet;
  namer: TokenNamer;
  /** The monster's speed in feet, used when no `economy` is passed. Defaults to the engine's 30. */
  speedFt?: number;
  /** The economy the round holds for this monster this turn. Omitted, the monster gets a fresh one at `speedFt`. */
  economy?: TurnEconomy;
  rng?: () => number;
}): MonsterTurnOutcome {
  const rng = args.rng ?? Math.random;
  let economy = args.economy ?? resetTurnEconomy(args.speedFt ?? DEFAULT_SPEED_FT);
  const empty: MonsterTurnOutcome = {
    world: args.world,
    sheet: args.sheet,
    lines: [],
    story: [],
    resolved: [],
    readout: null,
    moved: false,
    path: [],
    events: [],
    economy,
  };

  const layout = getCell(args.world, args.cell);
  if (!layout) return empty;
  const monster = layout.tokens.find((t) => t.id === args.monsterId);
  const player = layout.tokens.find((t) => t.id === args.playerTokenId);
  if (!monster || !player) return empty;
  if (args.sheet.dead) return empty;

  let world = args.world;
  const start: TileCoord = { x: monster.x, y: monster.y };
  let at = start;
  const path: TileCoord[] = [];
  const lines: DiceLogEntry[] = [];
  const story: string[] = [];
  const events: CombatEvent[] = [];

  // Close the distance along the pathfinder's route, one square per
  // `moveToken` call (see walkPath for why never more), as far as the
  // movement left this turn pays for. Every intermediate square is validated
  // for walkability instead of teleporting through a wall to a legal landing
  // square, and the route goes round an obstacle instead of into it.
  if (tileDistanceFeet(at, player) > MELEE_REACH_FT) {
    const affordable = Math.floor(economy.movementRemaining / FEET_PER_TILE);
    const route = approachPlan(layout, args.manifest, args.monsterId, at, player, affordable);
    const walked = walkPath(world, args.monsterId, route, args.cell, args.manifest, economy);
    world = walked.world;
    economy = walked.economy;
    path.push(...walked.steps);
    if (walked.steps.length > 0) at = walked.steps[walked.steps.length - 1]!;
  }
  const moved = path.length > 0;
  if (moved) events.push({ kind: "move", tokenId: args.monsterId, from: start, path: [...path] });

  const label = tokenLabel(args.monsterId, args.namer);
  if (tileDistanceFeet(at, player) > MELEE_REACH_FT || !economy.action) {
    if (moved) story.push(`${label} closes in.`);
    return { world, sheet: args.sheet, lines, story, resolved: [], readout: null, moved, path, events, economy };
  }
  economy = spendAction(economy, "action");

  const block = statblockFor(monster.assetId);
  // Through `effectiveArmorClass`, not `sheet.armorClass`: a shield that adds
  // a point the player can read on their own sheet and that the monster's d20
  // never has to beat is a decorative number, which is the exact defect class
  // `defenderACForRollRequest` exists to end.
  const playerAC = effectiveArmorClass(args.sheet);
  const result = resolveAttack({ attackerBonus: block.attackBonus, targetAC: playerAC, rng });
  const readout: ReadoutView = {
    ...attackResultToReadout(result, block.attackBonus, playerAC),
    critical: result.critical,
    fumble: result.fumble,
    caption: `${label} attacks ${args.namer.playerName}`,
  };

  let sheet = args.sheet;
  let damage: number | undefined;
  let hpLost = 0;
  let down = false;
  if (result.hit) {
    const rolled = resolveDamage(monsterDamageNotationFor(monster.assetId), rng, result.critical);
    damage = rolled.total;
    const outcome = applyDamage(sheet, rolled.total, result.critical);
    // What actually came off, which is not `damage`: a hero already at 0 takes
    // a failed death save instead, and a blow past the last point takes only
    // the points that were left.
    hpLost = sheet.currentHp - outcome.sheet.currentHp;
    sheet = outcome.sheet;
    down = outcome.wentDown === true;
    story.push(outcome.note);
  }

  const line = attackLine({
    attacker: label,
    target: args.namer.playerName,
    roll: result.roll,
    modifier: block.attackBonus,
    total: result.total,
    targetAC: playerAC,
    hit: result.hit,
    critical: result.critical,
    fumble: result.fumble,
    damage,
  });
  // The dice log colours `hit` green, meaning "this went the player's way".
  // A monster MISSING is the good outcome here, hence the inversion.
  lines.push({ text: line, hit: !result.hit });
  story.unshift(line);
  events.push(...attackEvents({ by: args.monsterId, against: args.playerTokenId, result, readout, damage, hpLost, down }));

  return {
    world,
    sheet,
    lines,
    story,
    resolved: [{ id: `local-${args.monsterId}-${Date.now()}`, kind: "attack", by: args.monsterId, against: args.playerTokenId, ...result }],
    readout,
    moved,
    path,
    events,
    economy,
  };
}

/**
 * Resolve every hostile turn between now and the player's next one.
 *
 * Winning initiative used to be strictly WORSE than losing it: with the rolls
 * forced so a skeleton went first, the round pill read "the skeleton is
 * acting", the skeleton never swung, and the only enabled control was End
 * turn, which then burned the monster's turn rather than the player's.
 * Nothing resolved a hostile turn on entry to combat, and the loop that does
 * resolve them lived inside the End turn handler where only a click could
 * reach it. Extracted here so combat start and every turn change can run the
 * same path, and so a test can drive it without a React tree.
 *
 * The guard is belt and braces: dropCombatant already keeps the order finite,
 * and a runaway loop would freeze the tab rather than mis-resolve a fight.
 *
 * `events` is every `CombatEvent` of the stretch, in order: a `turnStart` for
 * each hostile as it begins, that turn's `move` / `attack` / `damage` / `miss`
 * / `down` events, and a closing `turnStart` for the player when the loop hands
 * the turn back (so a screen can say "your turn" off the same list). A call
 * that finds the player already acting does nothing and returns no events.
 * `readout` is still the LAST roll's plate for the callers that show one; the
 * events carry every roll.
 */
export function runHostileTurns(args: {
  round: CombatRound;
  world: World;
  cell: CellCoord;
  manifest: AssetManifest;
  playerTokenId: string;
  sheet: CharacterSheet;
  namer: TokenNamer;
  rng?: () => number;
}): {
  round: CombatRound;
  world: World;
  sheet: CharacterSheet;
  dice: DiceLogEntry[];
  story: string[];
  resolved: ResolvedRoll[];
  readout: ReadoutView | null;
  events: CombatEvent[];
} {
  let round = args.round;
  let world = args.world;
  let sheet = args.sheet;
  const dice: DiceLogEntry[] = [];
  const story: string[] = [];
  const resolved: ResolvedRoll[] = [];
  const events: CombatEvent[] = [];
  let readout: ReadoutView | null = null;

  let guard = 0;
  while (round.order.length > 0 && activeCombatant(round)?.side === "hostile" && guard++ < 24) {
    const monster = activeCombatant(round)!;
    events.push({ kind: "turnStart", combatantId: monster.id, round: round.roundNumber });
    const outcome = resolveMonsterTurn({
      world,
      cell: args.cell,
      manifest: args.manifest,
      monsterId: monster.id,
      playerTokenId: args.playerTokenId,
      sheet,
      namer: args.namer,
      speedFt: monster.speedFt,
      economy: monster.economy,
      rng: args.rng,
    });
    world = outcome.world;
    sheet = outcome.sheet;
    dice.push(...outcome.lines);
    story.push(...outcome.story);
    resolved.push(...outcome.resolved);
    events.push(...outcome.events);
    if (outcome.readout) readout = outcome.readout;
    round = endCombatTurn(withActiveEconomy(round, outcome.economy));
  }

  // Handing the turn back is an event too, but only when this call actually
  // ran a hostile turn: finding the player already acting is a no-op.
  const next = activeCombatant(round);
  if (events.length > 0 && next && next.side === "player") {
    events.push({ kind: "turnStart", combatantId: next.id, round: round.roundNumber });
  }

  return { round, world, sheet, dice, story, resolved, readout, events };
}
