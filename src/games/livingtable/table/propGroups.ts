/**
 * Props that are one thing drawn in several squares.
 *
 * The art draws a well, a cottage, a fence or a bar counter as a set of parts (well_nw, well_ne, well_sw, well_se),
 * and the map places each part on its own square. To a player (and to the DM) it is ONE thing: pointing at any
 * part is pointing at the well. This module finds the set a square belongs to, so a click, a name and a feature
 * all agree whichever part was meant.
 *
 * A group is the props that touch each other (4 neighbours) and share a name once the part word is taken off the
 * end. A prop whose name has no part word (a barrel, a stool) is never grouped, so two barrels side by side stay two.
 *
 * Pure: data in, answer out. Import-pure.
 */
import type { XY } from "./state";

/** The words the art ends a part's name with. */
const PARTS = ["nw", "ne", "sw", "se", "n", "s", "e", "w", "head", "foot", "mid", "top", "base"] as const;
const PART_END = new RegExp(`^(.+)_(${PARTS.join("|")})$`);

/** What a placed prop needs to be grouped. */
export interface GroupableProp {
  assetId: string;
  x: number;
  y: number;
}

/** "well_nw" is the well; "barrel" is the barrel; null for a name with no part word (it stands alone). */
export function groupNameOf(assetId: string): string | null {
  return PART_END.exec(assetId)?.[1] ?? null;
}

/**
 * The props that make up the thing standing on `at`: that prop and every prop touching it (side by side, up and down)
 * with the same group name. Empty when no prop stands there. A prop with no part word is a group of one.
 */
export function propGroupAt<T extends GroupableProp>(props: readonly T[], at: XY): T[] {
  const here = props.find((q) => q.x === at.x && q.y === at.y);
  if (!here) return [];
  const name = groupNameOf(here.assetId);
  if (name === null) return [here];
  const group: T[] = [here];
  for (let i = 0; i < group.length; i++) {
    const from = group[i]!;
    for (const q of props) {
      if (group.includes(q) || groupNameOf(q.assetId) !== name) continue;
      if (Math.abs(q.x - from.x) + Math.abs(q.y - from.y) === 1) group.push(q);
    }
  }
  return group;
}

/** The squares of the thing standing on `at`: every part's square, or just `at` when nothing is placed there. */
export function footprintAt(props: readonly GroupableProp[], at: XY): XY[] {
  const group = propGroupAt(props, at);
  return group.length > 0 ? group.map((q) => ({ x: q.x, y: q.y })) : [{ x: at.x, y: at.y }];
}

/** What a group is called in words ("the well"): its name with the part word off, underscores as spaces. A lone prop is called by its own name. */
export function groupWords(assetId: string): string {
  return (groupNameOf(assetId) ?? assetId).replace(/_/g, " ");
}
