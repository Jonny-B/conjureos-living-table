/**
 * Rebuild a local World from whatever cells the client has fetched
 * individually via ltCellGet: games-db has no bulk "list every cell for
 * this campaign" action, only a per-coordinate read (see
 * bridge/gamesApi.ts's ltCellGet), so LivingTable.tsx loads the party's
 * current cell plus its 8 neighbours on every cell change (loadCellsAround)
 * and this turns that flat list into a real World, including
 * world/connectivity.ts's stake bookkeeping, which is nowhere persisted
 * server-side (there is no column for it).
 *
 * SCOPE, STATED PLAINLY: a stake is only reconstructed when its ORIGIN cell
 * is among the ones passed in here. Because commandMenu.ts's resolveMove
 * only ever offers a DM route for one of the CURRENT cell's 8 neighbours
 * (assembleCell can't target anywhere else in this app's actual play loop),
 * and the loaded neighbourhood is rebuilt every time the party's current
 * cell changes, this covers every stake the real play loop can ever need to
 * redeem. The one narrow gap: a cell assembled long ago, off the party's
 * current 3x3, that staked an exit onto a cell inside today's neighbourhood
 * without ever being reloaded this session, won't be present to redeem
 * against. Closing that fully needs either a bulk cell-list backend action
 * or server-persisted stakes, both out of scope for this integration pass;
 * named here rather than left as a silent gap, the way this repo's own
 * DESIGN.md names its own cuts.
 */
import { emptyWorld, setCell, getCell, type World } from "../world/perception";
import { addStake, stakeFor } from "../world/connectivity";
import type { CellCoord } from "../world/coordinates";
import type { CellLayout } from "../world/cell";

export interface LoadedCell {
  cx: number;
  cy: number;
  layout: CellLayout;
}

export function buildWorldFromCells(cells: LoadedCell[]): World {
  let world = emptyWorld();
  for (const cell of cells) {
    world = setCell(world, { cx: cell.cx, cy: cell.cy }, cell.layout);
  }
  for (const cell of cells) {
    const here: CellCoord = { cx: cell.cx, cy: cell.cy };
    for (const exit of cell.layout.exits) {
      if (getCell(world, exit.toCell)) continue; // the target is already loaded/assembled, nothing owed
      const { targetCell, stake } = stakeFor(here, exit);
      world = { ...world, stakes: addStake(world.stakes, targetCell, stake) };
    }
  }
  return world;
}
