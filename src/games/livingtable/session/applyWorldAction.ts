/**
 * Dispatch one DM-issued WorldAction (dm/turnSchema.ts) to the matching
 * world/manipulation.ts function, and report back which cell coordinates
 * actually changed so the caller knows what to persist via ltCellAssemble.
 * This is the piece of "applying a DM turn" that isn't already covered by
 * `validateDmTurn` (shape + provenance) or manipulation.ts itself (board
 * semantics): picking the right function per action type and turning its
 * result into one consistent shape the caller can loop over.
 *
 * `moveToken` needs a TurnEconomy per manipulation.ts's own signature
 * (DESIGN.md lists movement as one of the four action-economy resources
 * "enforced structurally"). A DM turn is narration-and-actions, not a
 * scheduled combat round with its own initiative tracker, and this
 * integration pass does not build one; a DM-narrated reposition ("the
 * goblin steps back") is given a fresh, generous economy on every call
 * (`GENEROUS_ECONOMY` below) rather than being checked against a real
 * per-round movement budget. This is a deliberate, stated simplification,
 * not a bypass of the rule for player-initiated movement, which the play
 * screen's own local Move handling gives a real per-click economy instead
 * (see LivingTable.tsx). The one token that budget does NOT extend to is the
 * player's own, which a DM turn may not move at all: see `refusePlayerMove`
 * below for what that closed and why it is a refusal rather than a smaller
 * budget.
 */
import { resetTurnEconomy } from "../rules/actionEconomy";
import {
  assembleCell,
  placeProp,
  placeToken,
  removeToken,
  moveToken,
  setDoorState,
  getCell,
  type World,
} from "../world/index";
import { monsterCurrentHp } from "./combat";
import type { AssetManifest } from "../world/cell";
import type { CellCoord } from "../world/coordinates";
import type { MoveTokenAction, RemoveTokenAction, WorldAction } from "../dm/turnSchema";

export interface ApplyActionResult {
  world: World;
  /** Present iff the action was rejected; the caller carries this forward into the next DM turn's context (see session/dmContext.ts's buildRejectionMessage). */
  error?: string;
  /** Cell coordinates whose stored layout actually changed and need re-persisting via ltCellAssemble. Empty on rejection. */
  touchedCells: CellCoord[];
}

/** A movement budget generous enough that no DM-narrated single-step reposition is ever blocked by it (see this file's header for why this isn't a real per-round budget). */
const GENEROUS_ECONOMY = () => resetTurnEconomy(9_999);

/**
 * The player's own token is not the DM's to move.
 *
 * The gap this closes: `GENEROUS_ECONOMY` is documented above as a deliberate
 * simplification for shuffling NPCs around a scene, and it applied to the
 * player character too -- 9,999 ft. of movement for any token the DM named,
 * theirs included. An adversary read the board straight off the DM's own
 * prompt ("kind=pc at (2,2)", a skeleton at (18,13)) and issued a single
 * moveToken on the pc token with reason "staging" and no roll cited: the
 * player was dragged sixteen tiles across the room to stand beside the
 * skeleton, no note, no rejection. On its own that is a nuisance. Next to the
 * reach gate in dm/turnSchema.ts it is a supported way around it, because a
 * creature that cannot legally swing from six tiles away can simply have the
 * player brought to it and swing legally next turn.
 *
 * Refused outright rather than held to a real budget, because the budget that
 * would make it safe is the player's own remaining movement for the round,
 * and that lives on the character sheet -- which this module has no access to
 * and should not grow a dependency on for one guard. The cost is that forced
 * movement (a shove, a rope, a collapsing floor) is narration and a roll
 * rather than a token move for now: the DM describes the pull and the player
 * takes the step, which is what happens at a real table anyway. NPC and
 * monster repositioning is untouched; that is what the generous budget is for.
 *
 * The pc token is identified from the WORLD, not from a caller-supplied id, so
 * there is no wiring for a call site to forget: `kind` is set when the token
 * is placed and dm/turnSchema.ts's validatePlacedToken already holds it to the
 * closed set of four.
 */
function refusePlayerMove(world: World, action: MoveTokenAction): string | undefined {
  const token = getCell(world, { cx: action.cx, cy: action.cy })?.tokens.find((t) => t.id === action.tokenId);
  if (token?.kind !== "pc") return undefined;
  return (
    `"${action.tokenId}" is the player's own character token, and the player moves it themselves -- a DM turn may not ` +
    `reposition it, for any reason. Narrate the shove, the pull or the thing that would make them step, request a roll ` +
    `if something is forcing them, and let them take the step. Move the creatures around them instead.`
  );
}

/**
 * A creature the engine still holds hit points for is not the DM's to delete.
 *
 * The gap this closes: `dm/turnSchema.ts`'s citation gate proves a "combat"
 * removeToken cites a real, unspent, decisive roll about this token, and that
 * is the strongest thing a shape-only validator can prove -- its own header
 * says so, naming "a hostility/HP model this shape-only validator deliberately
 * doesn't have access to" as what closing the rest would need. This module has
 * that model: it holds the World, and `currentHp` lives on the token. So the
 * residual case turnSchema documented is checkable here and nowhere else: a
 * single genuine HIT (an attack for 3 damage on a 20 HP creature) is a
 * decisive roll, so it satisfies every citation rule, and it was enough to
 * remove that creature from the board outright. One hit, full health, gone.
 *
 * It is also now redundant as a way to kill: `resolveDmRollRequests` applies
 * the damage and takes the token off the board ITSELF the moment it drops, so
 * a creature the DM can still see on the board is by construction a creature
 * the engine did not kill.
 *
 * What this deliberately does NOT do is forbid a wounded creature leaving the
 * fight. It costs one turn, the same shape every other refusal in this engine
 * takes: move it toward the door this turn citing the roll, remove it next
 * turn as "staging", by which point the roll is no longer in that turn's
 * resolved-rolls context. The error says so, because this file's sibling
 * messages all commit to naming the fix rather than just the refusal.
 */
function refuseRemovingHealthyToken(world: World, action: RemoveTokenAction): string | undefined {
  if (action.reason !== "combat") return undefined;
  const token = getCell(world, { cx: action.cx, cy: action.cy })?.tokens.find((t) => t.id === action.tokenId);
  if (!token) return undefined; // no such token: let removeToken itself report that, it says it better
  const hp = monsterCurrentHp(token);
  if (hp <= 0) return undefined;
  return (
    `"${action.tokenId}" is still standing on ${hp} hit point${hp === 1 ? "" : "s"}, so a "combat" removeToken cannot be ` +
    `what happened to it. The engine applies every hit's damage itself and takes a creature off the board the moment it ` +
    `drops to 0, so anything you can still see on the board survived. If it is fleeing rather than dying, move it toward ` +
    `an exit this turn citing that roll, and remove it next turn as reason "staging". If you meant it to die, request ` +
    `another attack roll against it and let the damage decide.`
  );
}

export function applyWorldAction(world: World, action: WorldAction, manifest: AssetManifest): ApplyActionResult {
  switch (action.type) {
    case "assembleCell": {
      const result = assembleCell(world, action.cx, action.cy, action.layout, manifest);
      if (!result.ok) return { world, error: result.errors.join("; "), touchedCells: [] };
      // assembleCell can silently patch an already-assembled neighbour's
      // stored layout in place (a return exit inserted to redeem a stake) --
      // see manipulation.ts's own header for why. Report every exit's
      // target that now exists in the result as touched too, alongside the
      // newly assembled cell itself, so the caller re-persists both.
      const touchedCells: CellCoord[] = [{ cx: action.cx, cy: action.cy }];
      for (const exit of action.layout.exits) {
        if (getCell(result.world, exit.toCell)) touchedCells.push(exit.toCell);
      }
      return { world: result.world, touchedCells };
    }
    case "placeToken": {
      const result = placeToken(world, action.cx, action.cy, action.token, manifest);
      return result.ok
        ? { world: result.world, touchedCells: [{ cx: action.cx, cy: action.cy }] }
        : { world, error: result.error, touchedCells: [] };
    }
    case "moveToken": {
      const refusal = refusePlayerMove(world, action);
      if (refusal) return { world, error: refusal, touchedCells: [] };
      const result = moveToken(world, action.cx, action.cy, action.tokenId, action.to, manifest, GENEROUS_ECONOMY());
      return result.ok
        ? { world: result.world, touchedCells: [{ cx: action.cx, cy: action.cy }] }
        : { world, error: result.error, touchedCells: [] };
    }
    case "removeToken": {
      const healthy = refuseRemovingHealthyToken(world, action);
      if (healthy) return { world, error: healthy, touchedCells: [] };
      const result = removeToken(world, action.cx, action.cy, action.tokenId);
      return result.ok
        ? { world: result.world, touchedCells: [{ cx: action.cx, cy: action.cy }] }
        : { world, error: result.error, touchedCells: [] };
    }
    case "placeProp": {
      const result = placeProp(world, action.cx, action.cy, action.prop, manifest);
      return result.ok
        ? { world: result.world, touchedCells: [{ cx: action.cx, cy: action.cy }] }
        : { world, error: result.error, touchedCells: [] };
    }
    case "setDoorState": {
      const result = setDoorState(world, action.cx, action.cy, action.propId, action.assetId, manifest);
      return result.ok
        ? { world: result.world, touchedCells: [{ cx: action.cx, cy: action.cy }] }
        : { world, error: result.error, touchedCells: [] };
    }
  }
}

/**
 * Apply a whole turn's actions in order, exactly as DESIGN.md's manipulation
 * API describes: each one validated and applied one at a time, a rejection
 * dropped (not applied) but collected rather than silently swallowed. Every
 * touched cell across the whole batch is deduplicated by coordinate so the
 * caller persists each changed cell once, even if two actions in the same
 * turn touched it.
 */
export function applyWorldActions(
  world: World,
  actions: WorldAction[],
  manifest: AssetManifest,
): { world: World; rejections: string[]; touchedCells: CellCoord[] } {
  let current = world;
  const rejections: string[] = [];
  const touchedKeys = new Set<string>();
  const touchedCells: CellCoord[] = [];

  for (const action of actions) {
    const result = applyWorldAction(current, action, manifest);
    current = result.world;
    if (result.error) rejections.push(result.error);
    for (const cell of result.touchedCells) {
      const key = `${cell.cx},${cell.cy}`;
      if (!touchedKeys.has(key)) {
        touchedKeys.add(key);
        touchedCells.push(cell);
      }
    }
  }

  return { world: current, rejections, touchedCells };
}
