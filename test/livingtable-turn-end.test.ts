/**
 * A turn ends by itself when the hero has nothing left to do with it (bug bash item 21): the action is spent, no bonus action
 * could still be used, and there is less than a step of movement. The rule is pure (turnEnd.ts); the setting that turns it
 * off is read where it is applied (flows/fight.ts), and its default is ON.
 *
 * Run: npx tsx --test test/livingtable-turn-end.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { CharacterSheet } from "../src/games/livingtable/characters/creation";
import type { CombatRound, Combatant } from "../src/games/livingtable/menu/combatRound";
import { autoEndTurnOn, noMoveLeft } from "../src/games/livingtable/table/turnEnd";
import type { PlayState } from "../src/games/livingtable/table/state";

type Econ = Combatant["economy"];

function combatant(side: "player" | "hostile", economy: Partial<Econ> = {}): Combatant {
  return { id: side === "player" ? "hero" : "goblin", label: side, side, initiative: 10, speedFt: 30, economy: { action: true, bonusAction: true, reaction: true, movementRemaining: 30, ...economy } };
}

function scene(opts: { economy?: Partial<Econ>; turn?: "player" | "hostile"; chassis?: string; level?: number; hidden?: boolean; down?: boolean; noFight?: boolean }): Pick<PlayState, "round" | "hero" | "heroHidden"> {
  const order = [combatant("player", opts.economy), combatant("hostile")];
  if (opts.turn === "hostile") order.reverse();
  const round: CombatRound = { order, activeIndex: 0, roundNumber: 1 } as CombatRound;
  const hero = { chassis: opts.chassis ?? "fighter", level: opts.level ?? 1, downed: opts.down ?? false, stable: false, dead: false } as unknown as CharacterSheet;
  return { round: opts.noFight ? null : round, hero, heroHidden: opts.hidden ?? false };
}

test("the action is used and no movement is left: the turn is over", () => {
  assert.equal(noMoveLeft(scene({ economy: { action: false, movementRemaining: 0 } })), true);
});

test("movement under one step (5 ft) counts as none; a full step does not", () => {
  assert.equal(noMoveLeft(scene({ economy: { action: false, movementRemaining: 4 } })), true);
  assert.equal(noMoveLeft(scene({ economy: { action: false, movementRemaining: 5 } })), false);
  assert.equal(noMoveLeft(scene({ economy: { action: false, movementRemaining: 30 } })), false);
});

test("the action still ready never ends the turn, however little movement there is (free text is always possible)", () => {
  assert.equal(noMoveLeft(scene({ economy: { action: true, movementRemaining: 0 } })), false);
});

test("a rogue of level 2 with a bonus action ready and not hidden still has a move (Hide)", () => {
  const rogue = { economy: { action: false, movementRemaining: 0 }, chassis: "rogue", level: 2 };
  assert.equal(noMoveLeft(scene(rogue)), false);
  assert.equal(noMoveLeft(scene({ ...rogue, hidden: true })), true, "already hidden: Hide is not available");
  assert.equal(noMoveLeft(scene({ ...rogue, economy: { action: false, movementRemaining: 0, bonusAction: false } })), true, "the bonus action is spent");
  assert.equal(noMoveLeft(scene({ ...rogue, level: 1 })), true, "the trick comes at level 2");
  assert.equal(noMoveLeft(scene({ ...rogue, chassis: "fighter" })), true, "only a rogue has it");
});

test("never when it is not the hero's turn, there is no fight, or the hero is down", () => {
  const spent = { action: false, movementRemaining: 0 };
  assert.equal(noMoveLeft(scene({ economy: spent, turn: "hostile" })), false);
  assert.equal(noMoveLeft(scene({ economy: spent, noFight: true })), false);
  assert.equal(noMoveLeft(scene({ economy: spent, down: true })), false);
});

test("the Settings switch: on by default, off only when it is set to false", () => {
  assert.equal(autoEndTurnOn({}), true, "no saved setting reads as on");
  assert.equal(autoEndTurnOn({ autoEndTurn: undefined }), true);
  assert.equal(autoEndTurnOn({ autoEndTurn: true }), true);
  assert.equal(autoEndTurnOn({ autoEndTurn: false }), false);
});

test("the fight flow asks the rule after the hero acts, only with the setting on, and says it in the dialogue box, not a toast", () => {
  const src = readFileSync(new URL("../src/games/livingtable/table/flows/fight.ts", import.meta.url), "utf8").replace(/\r/g, "");
  const after = /async function afterHeroAction\(\): Promise<void> \{([\s\S]*?)\n  \}\n/.exec(src)?.[1] ?? "";
  assert.match(after, /autoEndTurnOn\(tc\.host\.settings\.get\(\)\)/);
  assert.match(after, /noMoveLeft\(/);
  assert.match(after, /tc\.endTurnFlow\(\)/);
  assert.match(after, /tc\.story\(/);
  assert.doesNotMatch(after, /toast/);
});
