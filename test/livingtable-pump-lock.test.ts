/**
 * Bug bash 13, item 4: the world is locked while a story screen (or any screen over the board) is up. A walk that was already running
 * (a right-click Attack or Look closer on a far square) must not keep stepping behind it, and must not fire its arrival (the dice tray
 * and the DM turn) under it. The frame pump holds while something is open, and a story opening drops the walk for good.
 *
 * Run: npx tsx --test test/livingtable-pump-lock.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { bindBenchDefaults } from "../scripts/asset-bench/benchHost";
import { installAttack } from "../src/games/livingtable/table/flows/attack";
import type { TableCtx } from "../src/games/livingtable/table/tableCtx";
import { newPlay } from "../src/games/livingtable/table/state";

interface Rig {
  tc: TableCtx;
  steps: number;
  arrived: number;
  setOverlay: (open: boolean) => void;
  storyChange: (open: boolean) => void;
}

/** Just enough of the table for the pump: a hero standing still, a walk of two squares queued, and an arrival waiting. */
function rig(): Rig {
  let open = false;
  let handler: ((o: boolean) => void) | null = null;
  const r = { steps: 0, arrived: 0 } as Rig;
  bindBenchDefaults();
  const state = newPlay("fantasy", "knight" as never, "floor_stone" as never);
  state.heroAt = { x: 13, y: 10 };
  state.creatures = [];
  state.explored.fill(1);
  const tc = {
    st: () => state,
    busy: false,
    lootWin: null,
    lootTarget: null,
    walkQueue: [{ x: 14, y: 10 }, { x: 15, y: 10 }],
    onArrive: async () => {
      r.arrived++;
    },
    drawMarks: () => {},
    renderHud: () => {},
    flushAdventure: () => {},
    closeLoot: () => {},
    refreshAll: () => {},
    clearOptions: () => {},
    refuse: () => {},
    stage: { invalidate: () => {} },
    stepAnim: () => {
      r.steps++;
    },
    overlayOpen: () => open,
    overlay: {
      onStoryChange: (fn: ((o: boolean) => void) | null) => {
        handler = fn;
      },
    },
  } as unknown as TableCtx;
  installAttack(tc);
  r.tc = tc;
  r.setOverlay = (o) => {
    open = o;
  };
  r.storyChange = (o) => handler?.(o);
  return r;
}

test("pump holds the walk and its arrival while a screen is over the board", () => {
  const r = rig();
  r.setOverlay(true);
  for (let i = 0; i < 5; i++) r.tc.pump(1000 + i * 500);
  assert.equal(r.steps, 0, "the hero does not step behind the screen");
  assert.equal(r.tc.walkQueue.length, 2, "the walk waits where it was");
  assert.ok(r.tc.onArrive, "the arrival is still waiting, not fired");
  assert.equal(r.arrived, 0, "nothing runs under the screen");
});

test("a story opening drops the walk and its arrival for good", () => {
  const r = rig();
  r.setOverlay(true);
  r.storyChange(true);
  assert.equal(r.tc.walkQueue.length, 0, "the queued squares are gone");
  assert.equal(r.tc.onArrive, null, "the arrival will not fire when the story closes");
  r.setOverlay(false);
  r.storyChange(false);
  for (let i = 0; i < 5; i++) r.tc.pump(1000 + i * 500);
  assert.equal(r.steps, 0, "the hero stays put after the story is read");
  assert.equal(r.arrived, 0);
});

test("a story closing leaves a new walk alone", () => {
  const r = rig();
  r.storyChange(false);
  assert.equal(r.tc.walkQueue.length, 2, "closing a story clears nothing");
  assert.ok(r.tc.onArrive);
});

test("with nothing open the walk still steps and arrives", () => {
  const r = rig();
  for (let i = 0; i < 6; i++) r.tc.pump(1000 + i * 500);
  assert.equal(r.tc.walkQueue.length, 0, "both squares were taken");
  assert.equal(r.arrived, 1, "the arrival ran once");
});
