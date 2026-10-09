/**
 * Tests for the context action catalog (session/contextActions.ts).
 *
 * The claim under test is "the menu reflects YOUR character": the same goblin
 * gives a Knight, a Shadow (rogue) and a Fireball Person (wizard) different
 * menus, class and skill gated actions are omitted rather than greyed, an
 * action you could try but cannot right now is disabled with a plain reason,
 * and no string ever states a number the engine does not apply.
 *
 * Run: npx -y tsx --test test/livingtable-context-actions.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCharacter, type CharacterSheet } from "../src/games/livingtable/characters/creation";
import { askPlaceholder, walkAdjust } from "../src/games/livingtable/table/flows/menuFlow";
import { talkAsk } from "../src/games/livingtable/table/flows/adventureWorld";
import { MENU_MAX_WIDTH, boardRoomAboveKeyboard, menuEntryName, menuWidth } from "../src/games/livingtable/table/ui/menuHelpers";
import {
  CONTEXT_ACTION_IDS,
  GOOD_BONUS,
  TALK_RANGE_TILES,
  contextActionsFor,
  type ContextAction,
  type ContextSituation,
  type ContextTarget,
} from "../src/games/livingtable/session/contextActions";

function hero(archetypeId: string, choices?: Record<string, string>): CharacterSheet {
  return createCharacter({ archetypeId, name: "Bram", appearanceAssetId: "sprite-01", ...(choices ? { choices } : {}) });
}

const knight = () => hero("knight");
const shadow = () => hero("shadow");
const wizard = () => hero("fireball-person");

function calm(sheet: CharacterSheet, over: Partial<ContextSituation> = {}): ContextSituation {
  return {
    sheet,
    inFight: false,
    heroTurn: false,
    actionReady: true,
    bonusReady: true,
    movementFt: 30,
    heroHidden: false,
    heroDown: false,
    ...over,
  };
}

function fight(sheet: CharacterSheet, over: Partial<ContextSituation> = {}): ContextSituation {
  return calm(sheet, { inFight: true, heroTurn: true, ...over });
}

function goblin(over: Partial<NonNullable<ContextTarget["creature"]>> = {}, at = 1): ContextTarget {
  return {
    kind: "creature",
    id: "gob-1",
    name: "the goblin",
    distanceTiles: at,
    inSight: true,
    creature: {
      hostile: true,
      awake: true,
      awareOfHero: true,
      type: "humanoid (goblinoid)",
      size: "Small",
      down: false,
      humanoid: true,
      passivePerception: 9,
      ...over,
    },
  };
}

const ids = (list: ContextAction[]): string[] => list.map((a) => a.id);
const find = (list: ContextAction[], id: string): ContextAction | undefined => list.find((a) => a.id === id);

function lockedDoor(at = 1): ContextTarget {
  return { kind: "door", name: "the oak door", distanceTiles: at, inSight: true, door: { open: false, locked: true, lockDc: 15 } };
}

function body(over: Partial<NonNullable<ContextTarget["body"]>> = {}, at = 1): ContextTarget {
  return { kind: "body", name: "the goblin's body", distanceTiles: at, inSight: true, body: { looted: false, harvested: false, beast: false, harvestable: false, ...over } };
}

test("Look closer is always first, always enabled, resolved by the DM, on every target kind", () => {
  const kinds: ContextTarget[] = [
    { kind: "self", name: "yourself", distanceTiles: 0, inSight: true },
    goblin(),
    body(),
    lockedDoor(),
    { kind: "chest", name: "the chest", distanceTiles: 1, inSight: true },
    { kind: "prop", name: "the altar", distanceTiles: 1, inSight: true },
    { kind: "floor", name: "that square", distanceTiles: 3, inSight: true },
  ];
  for (const sheet of [knight(), shadow(), wizard()]) {
    for (const target of kinds) {
      // Worst case: in a fight, off turn, and down. Look closer survives all of it.
      const list = contextActionsFor(target, fight(sheet, { heroTurn: false, heroDown: true }));
      assert.equal(list[0]?.id, "look");
      assert.equal(list[0]?.enabled, true);
      assert.equal(list[0]?.resolver, "dm");
      assert.equal(list[0]?.cost, "free");
    }
  }
});

test("a Knight, a Shadow and a Fireball Person get different menus on the same awake goblin", () => {
  const k = ids(contextActionsFor(goblin(), fight(knight())));
  const s = ids(contextActionsFor(goblin(), fight(shadow())));
  const w = ids(contextActionsFor(goblin(), fight(wizard())));
  assert.notDeepEqual(k, s);
  assert.notDeepEqual(k, w);
  assert.notDeepEqual(s, w);
  // Only the wizard casts; only the rogue can pick a pocket (Sleight of Hand); everyone can kick and shove.
  assert.ok(w.includes("cast") && !k.includes("cast") && !s.includes("cast"));
  assert.ok(s.includes("pickpocket") && !k.includes("pickpocket") && !w.includes("pickpocket"));
  for (const menu of [k, s, w]) assert.ok(menu.includes("kick") && menu.includes("shove"));
});

test("Pickpocket only for a rogue or someone trained in Sleight of Hand", () => {
  const unaware = goblin({ awareOfHero: false });
  assert.ok(!ids(contextActionsFor(unaware, calm(knight()))).includes("pickpocket"));
  assert.ok(!ids(contextActionsFor(unaware, calm(wizard()))).includes("pickpocket"));
  const rogueMenu = contextActionsFor(unaware, calm(shadow()));
  const pick = find(rogueMenu, "pickpocket");
  assert.ok(pick);
  assert.equal(pick.enabled, true);
  assert.equal(pick.resolver, "engine");
  assert.equal(pick.skill, "Sleight of Hand");
  assert.equal(pick.needsAdjacent, true);
  assert.match(pick.why, /^Rogue, Sleight of Hand \+\d+, trained/);
  assert.equal(pick.say, "I try to pick the goblin's pocket.");

  // A Knight who trained Sleight of Hand gets it without being a rogue.
  const trainedKnight = createCharacter({ archetypeId: "knight", name: "Bram", appearanceAssetId: "sprite-01" });
  const withSoh: CharacterSheet = {
    ...trainedKnight,
    skills: [...trainedKnight.skills, { skill: "Sleight of Hand", ability: "dex", bonus: trainedKnight.modifiers.dex + trainedKnight.proficiencyBonus, expertise: false }],
  };
  const kp = find(contextActionsFor(unaware, calm(withSoh)), "pickpocket");
  assert.ok(kp);
  assert.match(kp.why, /^Sleight of Hand \+\d+, trained/);
  assert.ok(!kp.why.startsWith("Rogue"));

  // A beast has no pockets.
  assert.ok(!ids(contextActionsFor(goblin({ awareOfHero: false, humanoid: false, type: "beast" }), calm(shadow()))).includes("pickpocket"));
});

test("Pickpocket is shown disabled, with a reason, while the target is watching you", () => {
  const watching = find(contextActionsFor(goblin({ awareOfHero: true }), calm(shadow())), "pickpocket");
  assert.ok(watching);
  assert.equal(watching.enabled, false);
  assert.match(watching.reason ?? "", /watching you/);
  // A sleeping target is fair game.
  const asleep = find(contextActionsFor(goblin({ awake: false, awareOfHero: false }), calm(shadow())), "pickpocket");
  assert.equal(asleep?.enabled, true);
});

test("Pick the lock only for the rogue; a locked door offers Force the door to everyone", () => {
  for (const sheet of [knight(), wizard()]) {
    const menu = ids(contextActionsFor(lockedDoor(), calm(sheet)));
    assert.ok(menu.includes("force-door"));
    assert.ok(!menu.includes("pick-lock"));
    assert.ok(menu.includes("listen"));
  }
  const rogueMenu = contextActionsFor(lockedDoor(), calm(shadow()));
  assert.ok(ids(rogueMenu).includes("force-door"));
  const pick = find(rogueMenu, "pick-lock");
  assert.ok(pick);
  assert.equal(pick.enabled, true);
  assert.equal(pick.resolver, "engine");
  assert.equal(pick.ability, "dex");
  assert.equal(typeof pick.bonus, "number");
  assert.match(pick.why, /^Rogue, thieves' tools [+-]\d+$/);
});

test("a rogue with no thieves' tools sees Pick the lock disabled, saying why", () => {
  const sheet = { ...shadow(), inventory: ["Shortsword"] };
  const pick = find(contextActionsFor(lockedDoor(), calm(sheet)), "pick-lock");
  assert.ok(pick);
  assert.equal(pick.enabled, false);
  assert.match(pick.reason ?? "", /thieves' tools/);
});

test("an open or unlocked door offers no lock actions", () => {
  const open: ContextTarget = { kind: "door", name: "the door", distanceTiles: 1, inSight: true, door: { open: true, locked: false } };
  assert.deepEqual(ids(contextActionsFor(open, calm(shadow()))), ["look"]);
  const unlocked: ContextTarget = { kind: "door", name: "the door", distanceTiles: 1, inSight: true, door: { open: false, locked: false } };
  const menu = ids(contextActionsFor(unlocked, calm(shadow())));
  assert.deepEqual(menu, ["look", "open", "listen"]);
});

test("expertise marks an action good, and the why line says so", () => {
  const sheet = hero("shadow", { expertiseSkill: "Stealth" });
  const hide = find(contextActionsFor({ kind: "self", name: "yourself", distanceTiles: 0, inSight: true }, calm(sheet)), "hide");
  assert.ok(hide);
  assert.equal(hide.good, true);
  assert.match(hide.why, /Stealth \+\d+, expertise/);
  const stealth = sheet.skills.find((s) => s.skill === "Stealth")!;
  assert.equal(hide.bonus, stealth.bonus);

  // The same rogue with expertise elsewhere is only trained in Stealth: not good by expertise.
  const other = hero("shadow", { expertiseSkill: "Deception" });
  const hide2 = find(contextActionsFor({ kind: "self", name: "yourself", distanceTiles: 0, inSight: true }, calm(other)), "hide");
  assert.match(hide2!.why, /Stealth \+\d+, trained/);
  assert.equal(hide2!.good === true, hide2!.bonus! >= GOOD_BONUS);
});

test("a high bonus without expertise also marks good; an untrained low one does not", () => {
  const base = knight();
  const strong: CharacterSheet = {
    ...base,
    skills: base.skills.map((s) => (s.skill === "Athletics" ? { ...s, bonus: GOOD_BONUS } : s)),
  };
  const shove = find(contextActionsFor(goblin(), fight(strong)), "shove");
  assert.equal(shove?.good, true);
  const weak = find(contextActionsFor(goblin(), fight(wizard())), "shove");
  assert.equal(weak?.good, undefined);
  assert.match(weak!.why ?? "", /^Athletics [+-]\d+/);
  assert.doesNotMatch(weak!.why ?? "", /Anyone/);
});

test("in a fight off turn, every action but Look closer is disabled with a plain reason", () => {
  const list = contextActionsFor(goblin(), fight(knight(), { heroTurn: false }));
  assert.equal(list[0]?.id, "look");
  for (const a of list.slice(1)) {
    assert.equal(a.enabled, false, a.id);
    assert.equal(a.reason, "Not your turn.");
  }
});

test("action, bonus action and movement spent show their own reasons", () => {
  const noAction = contextActionsFor(goblin(), fight(knight(), { actionReady: false }));
  assert.equal(find(noAction, "kick")?.reason, "You have already used your action this turn.");
  // Free things stay available with the action spent.
  assert.equal(find(noAction, "talk")?.enabled, true);

  const lvl2 = { ...shadow(), level: 2 };
  const self: ContextTarget = { kind: "self", name: "yourself", distanceTiles: 0, inSight: true };
  const noBonus = contextActionsFor(self, fight(lvl2, { bonusReady: false }));
  assert.equal(find(noBonus, "hide")?.reason, "You have already used your bonus action this turn.");

  const noMove = contextActionsFor({ kind: "floor", name: "that square", distanceTiles: 4, inSight: true }, fight(knight(), { movementFt: 0 }));
  assert.equal(find(noMove, "sneak")?.reason, "You have no movement left this turn.");
});

test("a downed hero can only look", () => {
  const list = contextActionsFor(goblin(), calm(knight(), { heroDown: true }));
  for (const a of list.slice(1)) {
    assert.equal(a.enabled, false);
    assert.match(a.reason ?? "", /You are down/);
  }
});

test("Loot appears only on an unlooted body, and is enabled only next to it", () => {
  const near = find(contextActionsFor(body(), calm(knight())), "loot");
  assert.ok(near);
  assert.equal(near.enabled, true);
  assert.equal(near.resolver, "engine");
  assert.equal(near.needsAdjacent, true);

  const far = find(contextActionsFor(body({}, 4), calm(knight())), "loot");
  assert.ok(far);
  assert.equal(far.enabled, false);
  assert.match(far.reason ?? "", /Too far away: 20 feet/);

  assert.ok(!ids(contextActionsFor(body({ looted: true }), calm(knight()))).includes("loot"));
  // Not on a living creature, a door or a chest.
  assert.ok(!ids(contextActionsFor(goblin(), calm(knight()))).includes("loot"));
  assert.ok(!ids(contextActionsFor(lockedDoor(), calm(knight()))).includes("loot"));
});

test("Harvest is for a beast body not yet harvested, and never in a fight", () => {
  const beast = body({ beast: true, harvestable: true });
  const calmMenu = find(contextActionsFor(beast, calm(knight())), "harvest");
  assert.ok(calmMenu);
  assert.equal(calmMenu.skill, "Survival");
  assert.equal(calmMenu.enabled, true);
  assert.ok(!ids(contextActionsFor(body({ beast: false }), calm(knight()))).includes("harvest"));
  assert.ok(!ids(contextActionsFor(body({ beast: true, harvestable: true, harvested: true }), calm(knight()))).includes("harvest"));
  // A beast with nothing to take (the game has no part for it) gets no Harvest line at all.
  assert.ok(!ids(contextActionsFor(body({ beast: true, harvestable: false }), calm(knight()))).includes("harvest"));
  const inFight = find(contextActionsFor(beast, fight(knight())), "harvest");
  assert.equal(inFight?.enabled, false);
  assert.match(inFight?.reason ?? "", /Finish the fight first/);
});

test("Kick is an unarmed strike with the real numbers: STR plus proficiency to hit, 1 plus STR damage", () => {
  const sheet = knight();
  const kick = find(contextActionsFor(goblin(), fight(sheet)), "kick");
  assert.ok(kick);
  assert.equal(kick.resolver, "engine");
  assert.equal(kick.cost, "action");
  assert.equal(kick.bonus, sheet.modifiers.str + sheet.proficiencyBonus);
  const dmg = Math.max(0, 1 + sheet.modifiers.str);
  assert.ok(kick.why.includes(`${dmg} bludgeoning damage`));
  assert.equal(kick.enabled, true);
  // Too far: disabled with the distance.
  const far = find(contextActionsFor(goblin({}, 3), fight(sheet)), "kick");
  assert.equal(far?.enabled, false);
  assert.match(far?.reason ?? "", /15 feet/);
  // Never offered against a friendly.
  assert.ok(!ids(contextActionsFor(goblin({ hostile: false }), calm(sheet))).includes("kick"));
});

test("Shove and Grapple refuse a target more than one size larger, saying so", () => {
  const ogre = goblin({ size: "Huge", type: "giant" });
  const small = goblin({ size: "Medium" });
  const sheet = knight();
  assert.equal(find(contextActionsFor(small, fight(sheet)), "shove")?.enabled, true);
  const huge = find(contextActionsFor(ogre, fight(sheet)), "shove");
  assert.equal(huge?.enabled, false);
  assert.match(huge?.reason ?? "", /too big to shove: Huge/);
  assert.equal(find(contextActionsFor(ogre, fight(sheet)), "grapple")?.enabled, false);
  // A Large creature is exactly one size up from a Medium hero: allowed.
  assert.equal(find(contextActionsFor(goblin({ size: "Large" }), fight(sheet)), "shove")?.enabled, true);
});

test("Grapple is DM-resolved because the board cannot hold a grappled monster, and says so in plain words", () => {
  const g = find(contextActionsFor(goblin(), fight(knight())), "grapple");
  assert.equal(g?.resolver, "dm");
  assert.match(g?.why ?? "", /The DM decides what a grab does/);
  assert.doesNotMatch(g?.why ?? "", /board|track/i);
});

test("Hide: a rogue at level 2 hides as a bonus action; level 1 and everyone else use the action", () => {
  const self: ContextTarget = { kind: "self", name: "yourself", distanceTiles: 0, inSight: true };
  assert.equal(find(contextActionsFor(self, calm(shadow())), "hide")?.cost, "action");
  const lvl2 = find(contextActionsFor(self, calm({ ...shadow(), level: 2 })), "hide");
  assert.equal(lvl2?.cost, "bonus");
  assert.match(lvl2?.why ?? "", /^Rogue trick, Stealth [+-]\d+/);
  assert.doesNotMatch(lvl2?.why ?? "", /Cunning|bonus action|passive/i);
  assert.equal(find(contextActionsFor(self, calm({ ...knight(), level: 5 })), "hide")?.cost, "action");
});

test("Hide is refused against a creature looking right at you, and when already hidden", () => {
  const seen = find(contextActionsFor(goblin({ awareOfHero: true }), fight(shadow())), "hide");
  assert.equal(seen?.enabled, false);
  assert.match(seen?.reason ?? "", /looking right at you/);
  const unseen = find(contextActionsFor(goblin({ awareOfHero: false }), fight(shadow())), "hide");
  assert.equal(unseen?.enabled, true);
  const hidden = find(contextActionsFor({ kind: "self", name: "yourself", distanceTiles: 0, inSight: true }, calm(shadow(), { heroHidden: true })), "hide");
  assert.equal(hidden?.enabled, false);
  assert.equal(hidden?.reason, "You are already hidden.");
});

test("Sneak up needs an unaware creature that is not already next to you", () => {
  assert.ok(!ids(contextActionsFor(goblin({ awareOfHero: true }, 4), calm(knight()))).includes("sneak-up"));
  assert.ok(!ids(contextActionsFor(goblin({ awareOfHero: false }, 1), calm(knight()))).includes("sneak-up"));
  const su = find(contextActionsFor(goblin({ awareOfHero: false }, 4), calm(knight())), "sneak-up");
  assert.ok(su);
  assert.equal(su.cost, "move");
  assert.equal(su.resolver, "engine");
});

test("the wizard casts, the cleric casts, and a spent caster is told why not", () => {
  const w = find(contextActionsFor(goblin(), fight(wizard())), "cast");
  assert.ok(w);
  assert.equal(w.enabled, true);
  assert.equal(w.resolver, "engine");
  assert.equal(w.cost, "action");
  assert.equal(w.ability, "int");
  assert.ok(!ids(contextActionsFor(goblin(), fight(knight()))).includes("cast"));
  assert.ok(!ids(contextActionsFor(goblin(), fight(shadow()))).includes("cast"));
  // A caster can also aim at themselves (a heal).
  assert.ok(ids(contextActionsFor({ kind: "self", name: "yourself", distanceTiles: 0, inSight: true }, calm(wizard()))).includes("cast"));
  // Cannot see the target: disabled.
  const blind = find(contextActionsFor({ ...goblin(), inSight: false }, fight(wizard())), "cast");
  assert.equal(blind?.enabled, false);
  assert.equal(blind?.reason, "You cannot see it from here.");
});

test("Stabilize is for a down creature, open to anyone, and is the only thing offered besides Look closer", () => {
  const dying = goblin({ down: true, hostile: false });
  for (const sheet of [knight(), shadow(), wizard()]) {
    const list = contextActionsFor(dying, calm(sheet));
    assert.deepEqual(ids(list), ["look", "stabilize"]);
    const st = list[1]!;
    assert.equal(st.skill, "Medicine");
    assert.match(st.why, /Medicine [+-]\d+/);
    assert.match(st.why, /DC 10/);
  }
  // Trained medics are marked as such.
  const medic = hero("medic");
  assert.match(find(contextActionsFor(dying, calm(medic)), "stabilize")!.why, /Medicine \+\d+, trained/);
});

test("social actions need an awake creature that can talk, within 30 feet and in sight", () => {
  const sheet = knight();
  const near = ids(contextActionsFor(goblin(), calm(sheet)));
  for (const id of ["talk", "parley", "bluff", "threaten", "read-intent"]) assert.ok(near.includes(id), id);

  // Asleep: nothing to talk to or read.
  const asleep = ids(contextActionsFor(goblin({ awake: false, awareOfHero: false }), calm(sheet)));
  for (const id of ["talk", "parley", "bluff", "threaten", "read-intent"]) assert.ok(!asleep.includes(id), id);

  // A wolf cannot be bargained with but can be read, and calmed only by the trained.
  const wolf = goblin({ type: "beast", humanoid: false, size: "Medium" });
  const wolfMenu = ids(contextActionsFor(wolf, calm(sheet)));
  assert.ok(!wolfMenu.includes("talk") && !wolfMenu.includes("parley") && wolfMenu.includes("read-intent"));
  assert.ok(!wolfMenu.includes("calm-beast"));

  // Out of earshot.
  const far = find(contextActionsFor(goblin({}, TALK_RANGE_TILES + 2), calm(sheet)), "talk");
  assert.equal(far?.enabled, false);
  assert.match(far?.reason ?? "", /Too far away to talk/);
  // Out of sight.
  const unseen = find(contextActionsFor({ ...goblin(), inSight: false }, calm(sheet)), "parley");
  assert.equal(unseen?.reason, "You cannot see it from here.");
});

test("Calm the beast needs Animal Handling training", () => {
  const wolf = goblin({ type: "beast", humanoid: false, size: "Medium" });
  const base = knight();
  const trained: CharacterSheet = {
    ...base,
    skills: [...base.skills, { skill: "Animal Handling", ability: "wis", bonus: base.modifiers.wis + base.proficiencyBonus, expertise: false }],
  };
  const calmed = find(contextActionsFor(wolf, calm(trained)), "calm-beast");
  assert.ok(calmed);
  assert.equal(calmed.resolver, "dm");
  assert.equal(calmed.skill, "Animal Handling");
  assert.ok(!ids(contextActionsFor(wolf, calm(wizard()))).includes("calm-beast"));
});

test("Recall lore uses the skill that matches the target's type, trained only", () => {
  const base = knight();
  const withSkill = (skill: string): CharacterSheet => ({
    ...base,
    skills: [...base.skills, { skill, ability: "int", bonus: base.modifiers.int + base.proficiencyBonus, expertise: false }],
  });
  // Humanoid: History.
  assert.equal(find(contextActionsFor(goblin(), calm(withSkill("History"))), "recall-lore")?.skill, "History");
  assert.ok(!ids(contextActionsFor(goblin(), calm(withSkill("Religion")))).includes("recall-lore"));
  // Undead: Religion.
  const zombie = goblin({ type: "undead", humanoid: false });
  assert.equal(find(contextActionsFor(zombie, calm(withSkill("Religion"))), "recall-lore")?.skill, "Religion");
  assert.ok(!ids(contextActionsFor(zombie, calm(withSkill("History")))).includes("recall-lore"));
  // Construct: Arcana. The wizard is trained in it.
  const golem = goblin({ type: "construct", humanoid: false });
  assert.equal(find(contextActionsFor(golem, calm(wizard())), "recall-lore")?.skill, "Arcana");
  // Beast: Nature. Dragon: History. Untrained by default.
  assert.equal(find(contextActionsFor(goblin({ type: "beast", humanoid: false }), calm(withSkill("Nature"))), "recall-lore")?.skill, "Nature");
  assert.equal(find(contextActionsFor(goblin({ type: "dragon", humanoid: false }), calm(withSkill("History"))), "recall-lore")?.skill, "History");
  assert.ok(!ids(contextActionsFor(goblin(), calm(knight()))).includes("recall-lore"));
});

test("Read the runes: a wizard or an Arcana-trained hero, on a prop, never in a fight", () => {
  const altar: ContextTarget = { kind: "prop", name: "the altar", distanceTiles: 1, inSight: true };
  assert.ok(ids(contextActionsFor(altar, calm(wizard()))).includes("read-runes"));
  assert.ok(!ids(contextActionsFor(altar, calm(knight()))).includes("read-runes"));
  assert.ok(!ids(contextActionsFor(altar, calm(shadow()))).includes("read-runes"));
  const inFight = find(contextActionsFor(altar, fight(wizard())), "read-runes");
  assert.equal(inFight?.enabled, false);
  assert.match(inFight?.reason ?? "", /Finish the fight first/);
});

test("Search picks the better of Investigation and Perception, and refuses a second pass", () => {
  const chest: ContextTarget = { kind: "chest", name: "the chest", distanceTiles: 1, inSight: true };
  const sheet = wizard(); // trained Investigation
  const s = find(contextActionsFor(chest, calm(sheet)), "search");
  assert.ok(s);
  assert.equal(s.skill, "Investigation");
  assert.equal(s.enabled, true);
  const again = find(contextActionsFor({ ...chest, searched: true }, calm(sheet)), "search");
  assert.equal(again?.enabled, false);
  assert.match(again?.reason ?? "", /already searched/);
  // A floor square is searched from beside it, like anything else (the menu walks the hero there).
  const floor = find(contextActionsFor({ kind: "floor", name: "that square", distanceTiles: 5, inSight: true }, calm(sheet)), "search");
  assert.equal(floor?.enabled, false);
  assert.equal(floor?.farBy, 4);
  const adjacentFloor = find(contextActionsFor({ kind: "floor", name: "that square", distanceTiles: 1, inSight: true }, calm(sheet)), "search");
  assert.equal(adjacentFloor?.enabled, true);
  const farChest = find(contextActionsFor({ ...chest, distanceTiles: 4 }, calm(sheet)), "search");
  assert.equal(farChest?.enabled, false);
});

test("Track needs Survival training and a floor target", () => {
  const floor: ContextTarget = { kind: "floor", name: "that square", distanceTiles: 2, inSight: true };
  assert.ok(!ids(contextActionsFor(floor, calm(knight()))).includes("track"));
  assert.ok(ids(contextActionsFor(floor, calm(hero("trooper")))).includes("track") === false);
  const base = knight();
  const ranger: CharacterSheet = { ...base, skills: [...base.skills, { skill: "Survival", ability: "wis", bonus: 3, expertise: false }] };
  assert.ok(ids(contextActionsFor(floor, calm(ranger))).includes("track"));
});

test("Listen at the door is engine-resolved Perception on a closed door, next to it", () => {
  const closed: ContextTarget = { kind: "door", name: "the door", distanceTiles: 3, inSight: true, door: { open: false, locked: false } };
  const l = find(contextActionsFor(closed, calm(knight())), "listen");
  assert.ok(l);
  assert.equal(l.resolver, "engine");
  assert.equal(l.skill, "Perception");
  assert.equal(l.enabled, false);
  assert.match(l.reason ?? "", /Too far away/);
});

test("menu order: the fight first against a hostile, the quiet verbs against a calm creature", () => {
  const fightMenu = ids(contextActionsFor(goblin(), fight(wizard())));
  assert.equal(fightMenu[1], "attack");
  assert.equal(fightMenu[2], "cast");
  assert.ok(fightMenu.indexOf("kick") < fightMenu.indexOf("talk"));
  const friend = ids(contextActionsFor(goblin({ hostile: false }), calm(shadow())));
  assert.equal(friend[1], "talk");
  // Enabled actions come before disabled ones.
  const mixed = contextActionsFor(goblin({}, 3), fight(knight()));
  const firstDisabled = mixed.findIndex((a) => !a.enabled);
  assert.ok(firstDisabled > 0);
  assert.ok(mixed.slice(firstDisabled).every((a) => !a.enabled));
});

test("every action has the full shape: known id, a say, a why, and a reason exactly when disabled", () => {
  const targets: ContextTarget[] = [
    { kind: "self", name: "yourself", distanceTiles: 0, inSight: true },
    goblin(),
    goblin({ down: true }),
    goblin({ awake: false, awareOfHero: false }, 4),
    goblin({ type: "beast", humanoid: false, size: "Large" }, 2),
    body({ beast: true, harvestable: true }, 3),
    lockedDoor(2),
    { kind: "door", name: "the door", distanceTiles: 1, inSight: true, door: { open: false, locked: false } },
    { kind: "chest", name: "the chest", distanceTiles: 1, inSight: true, openable: true },
    { kind: "prop", name: "the altar", distanceTiles: 1, inSight: false },
    { kind: "floor", name: "that square", distanceTiles: 3, inSight: true },
  ];
  const sheets = ["knight", "shadow", "fireball-person", "healer", "medic"].map((a) => hero(a));
  const situations = (s: CharacterSheet): ContextSituation[] => [
    calm(s),
    fight(s),
    fight(s, { heroTurn: false }),
    fight(s, { actionReady: false, bonusReady: false, movementFt: 0 }),
    calm(s, { heroDown: true }),
    calm(s, { heroHidden: true }),
    calm(s, { potions: 2 }),
  ];
  const seen = new Set<string>();
  for (const sheet of sheets) {
    for (const target of targets) {
      for (const sit of situations(sheet)) {
        for (const a of contextActionsFor(target, sit)) {
          seen.add(a.id);
          assert.ok(CONTEXT_ACTION_IDS.includes(a.id), `unknown id ${a.id}`);
          assert.ok(a.label.length > 0 && a.say.length > 0, a.id);
          assert.ok(a.why === undefined || a.why.length > 0, a.id);
          assert.ok(a.resolver === "engine" || a.resolver === "dm");
          assert.ok(["free", "object", "action", "bonus", "move"].includes(a.cost));
          assert.equal(a.enabled, a.reason === undefined, `${a.id} reason/enabled mismatch`);
          if (a.bonus !== undefined) assert.ok(Number.isInteger(a.bonus), a.id);
        }
      }
    }
  }
  // The catalog is all reachable: every id some target and character can produce.
  for (const id of CONTEXT_ACTION_IDS) {
    if (["calm-beast", "recall-lore", "track"].includes(id)) continue; // need extra training; covered above
    assert.ok(seen.has(id), `no scenario produced ${id}`);
  }
});

test("no em dash or en dash in anything a menu can say, even from a hostile name", () => {
  const bad = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
  const dashed = String.fromCharCode(0x2014);
  const targets: ContextTarget[] = [
    { ...goblin(), name: `the goblin ${dashed} chief` },
    { ...body(), name: `the body ${dashed} warm` },
    { ...lockedDoor(), name: `the door ${dashed} oak` },
    { kind: "prop", name: `the altar ${dashed} old`, distanceTiles: 1, inSight: true },
  ];
  for (const sheet of [knight(), shadow(), wizard()]) {
    for (const target of targets) {
      for (const sit of [calm(sheet), fight(sheet), fight(sheet, { heroTurn: false })]) {
        for (const a of contextActionsFor(target, sit)) {
          for (const text of [a.label, a.why ?? "", a.say, a.reason ?? ""]) assert.ok(!bad.test(text), `${a.id}: ${text}`);
        }
      }
    }
  }
});

test("a menu never states an effect it does not apply: DM actions carry no damage or movement claim", () => {
  const list = contextActionsFor(goblin(), fight(knight()));
  for (const a of list.filter((x) => x.resolver === "dm")) {
    assert.ok(!/damage|push|prone|knock/i.test(a.why), `${a.id}: ${a.why}`);
  }
});

// ── the owner's bug bash: the small grey lines, walking up, attack, open, potion ──

function everyAction(): Array<{ a: ContextAction; target: ContextTarget }> {
  const targets: ContextTarget[] = [
    { kind: "self", name: "yourself", distanceTiles: 0, inSight: true },
    goblin(),
    goblin({ awake: false, awareOfHero: false }, 4),
    goblin({ hostile: false }),
    goblin({ down: true }),
    goblin({ type: "beast", humanoid: false, size: "Large" }, 2),
    body({ beast: true, harvestable: true }, 3),
    lockedDoor(2),
    { kind: "door", name: "the door", distanceTiles: 1, inSight: true, door: { open: false, locked: false } },
    { kind: "chest", name: "the chest", distanceTiles: 4, inSight: true, openable: true },
    { kind: "prop", name: "the altar", distanceTiles: 2, inSight: true },
    { kind: "floor", name: "that square", distanceTiles: 3, inSight: true },
  ];
  const out: Array<{ a: ContextAction; target: ContextTarget }> = [];
  for (const sheet of ["knight", "shadow", "fireball-person", "healer", "medic"].map((a) => hero(a))) {
    for (const target of targets) {
      for (const sit of [calm(sheet, { potions: 1 }), fight(sheet), fight(sheet, { heroTurn: false }), calm({ ...sheet, level: 2 })]) {
        for (const a of contextActionsFor(target, sit)) out.push({ a, target });
      }
    }
  }
  return out;
}

test("no line of any menu says 'Anyone can ...', 'passive Perception', 'Cunning Action' or talks about the board", () => {
  for (const { a } of everyAction()) {
    for (const text of [a.why ?? "", a.reason ?? ""]) {
      assert.doesNotMatch(text, /Anyone can/, `${a.id}: ${text}`);
      assert.doesNotMatch(text, /passive Perception/i, `${a.id}: ${text}`);
      assert.doesNotMatch(text, /Cunning Action/, `${a.id}: ${text}`);
      assert.doesNotMatch(text, /does not track|the board|the bench/i, `${a.id}: ${text}`);
    }
  }
});

test("a rolled action's line is its plain number: it starts with its skill name, or with its class tag then the skill name", () => {
  let rolled = 0;
  for (const { a } of everyAction()) {
    if (!a.skill) continue;
    rolled += 1;
    const skill = a.skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(a.why ?? "", new RegExp(`^((Rogue|Wizard)( trick)?, )?${skill} [+-]\\d+`, "i"), `${a.id}: ${a.why}`);
    assert.ok(a.bonus !== undefined, a.id);
  }
  assert.ok(rolled > 40, "the scan really covered rolled actions");
});

test("Look closer, Talk and Loot say nothing under their label (no line at all)", () => {
  const sheet = knight();
  assert.equal(find(contextActionsFor(goblin(), calm(sheet)), "look")?.why, undefined);
  assert.equal(find(contextActionsFor(goblin({ hostile: false }), calm(sheet)), "talk")?.why, undefined);
  assert.equal(find(contextActionsFor(body(), calm(sheet)), "loot")?.why, undefined);
  assert.equal(find(contextActionsFor({ kind: "floor", name: "that square", distanceTiles: 3, inSight: true }, calm(sheet)), "look")?.why, undefined);
});

test("Search and Hide read as bare numbers; Hide against a creature says 'its Perception'", () => {
  const sheet = knight();
  const floor: ContextTarget = { kind: "floor", name: "that square", distanceTiles: 1, inSight: true };
  const menu = contextActionsFor(floor, calm(sheet));
  assert.match(find(menu, "search")?.why ?? "", /^(Perception|Investigation) [+-]\d+/);
  assert.match(find(menu, "hide")?.why ?? "", /^Stealth [+-]\d+/);
  assert.match(find(menu, "sneak")?.why ?? "", /^Stealth [+-]\d+/);
  const hideFrom = find(contextActionsFor(goblin({ awareOfHero: false }), calm(sheet)), "hide");
  assert.match(hideFrom?.why ?? "", /^Stealth [+-]\d+ against its Perception$/);
});

test("farBy: set when distance is the only thing in the way, with the same words as before", () => {
  const sheet = knight();
  const far = find(contextActionsFor(body({}, 4), calm(sheet)), "loot");
  assert.equal(far?.enabled, false);
  assert.equal(far?.farBy, 3, "four tiles away is three tiles beyond reach");
  assert.match(far?.reason ?? "", /Too far away: 20 feet/);
  const near = find(contextActionsFor(body({}, 1), calm(sheet)), "loot");
  assert.equal(near?.farBy, undefined);
  // Talk: beyond 30 feet is farBy tiles past the talking range.
  const farTalk = find(contextActionsFor(goblin({ hostile: false }, TALK_RANGE_TILES + 2), calm(sheet)), "talk");
  assert.equal(farTalk?.farBy, 2);
  // Not in sight: walking up would not help, so no farBy.
  const unseen = find(contextActionsFor({ ...goblin({ hostile: false }, TALK_RANGE_TILES + 2), inSight: false }, calm(sheet)), "talk");
  assert.equal(unseen?.enabled, false);
  assert.equal(unseen?.farBy, undefined);
  // Something else is in the way too (it is watching you): no farBy.
  const watched = find(contextActionsFor(goblin({ awareOfHero: true }, 3), calm(shadow())), "pickpocket");
  assert.equal(watched?.enabled, false);
  assert.equal(watched?.farBy, undefined);
  // Off turn or the action spent: that reason wins and there is no farBy either.
  assert.equal(find(contextActionsFor(body({}, 4), fight(sheet, { heroTurn: false })), "loot")?.farBy, undefined);
  assert.equal(find(contextActionsFor(goblin({}, 3), fight(sheet, { actionReady: false })), "kick")?.farBy, undefined);
});

test("Look closer at a thing further than reach carries farBy and stays enabled; people, yourself and open floor never do", () => {
  const sheet = knight();
  const bed: ContextTarget = { kind: "prop", name: "the bed", distanceTiles: 5, inSight: true };
  const look = contextActionsFor(bed, calm(sheet))[0]!;
  assert.equal(look.id, "look");
  assert.equal(look.enabled, true);
  assert.equal(look.farBy, 4);
  assert.equal(contextActionsFor({ ...bed, distanceTiles: 1 }, calm(sheet))[0]!.farBy, undefined);
  for (const kind of ["body", "door", "chest"] as const) {
    const t: ContextTarget = { ...bed, kind, name: "it", ...(kind === "door" ? { door: { open: false, locked: false } } : {}), ...(kind === "body" ? { body: { looted: false, harvested: false, beast: false, harvestable: false } } : {}) };
    assert.equal(contextActionsFor(t, calm(sheet))[0]!.farBy, 4, kind);
  }
  assert.equal(contextActionsFor(goblin({}, 5), calm(sheet))[0]!.farBy, undefined, "a creature is looked at from where you stand");
  assert.equal(contextActionsFor({ kind: "floor", name: "that square", distanceTiles: 5, inSight: true }, calm(sheet))[0]!.farBy, undefined);
  assert.equal(contextActionsFor({ kind: "self", name: "yourself", distanceTiles: 0, inSight: true }, calm(sheet))[0]!.farBy, undefined);
});

test("Attack is a line against a hostile creature, with the weapon's real numbers, first in a fight", () => {
  const sheet = knight();
  const list = contextActionsFor(goblin(), fight(sheet));
  const attack = find(list, "attack");
  assert.ok(attack);
  assert.equal(attack.resolver, "engine");
  assert.equal(attack.cost, "action");
  assert.equal(attack.enabled, true);
  assert.equal(list[1]?.id, "attack", "right after Look closer");
  assert.match(attack.why ?? "", /^Longsword \+\d+, 1d8\+\d+$/);
  assert.equal(attack.bonus, sheet.modifiers.str + sheet.proficiencyBonus);
  assert.equal(attack.say, "I attack the goblin.");
  // Not against a friend, a sleeper counts as a target, and the spent action disables it with the usual reason.
  assert.ok(!ids(contextActionsFor(goblin({ hostile: false }), calm(sheet))).includes("attack"));
  assert.ok(ids(contextActionsFor(goblin({ awake: false, awareOfHero: false }), calm(sheet))).includes("attack"));
  assert.equal(find(contextActionsFor(goblin(), fight(sheet, { actionReady: false })), "attack")?.reason, "You have already used your action this turn.");
  // A creature that is down is helped, not attacked.
  assert.ok(!ids(contextActionsFor(goblin({ down: true }), calm(sheet))).includes("attack"));
});

test("Open: a shut door, or a scene's own chest; locked says so; an open door or a searchable feature has none", () => {
  const sheet = knight();
  const unlocked: ContextTarget = { kind: "door", name: "the front door", distanceTiles: 1, inSight: true, door: { open: false, locked: false } };
  const open = find(contextActionsFor(unlocked, calm(sheet)), "open");
  assert.ok(open);
  assert.equal(open.enabled, true);
  assert.equal(open.resolver, "engine");
  assert.equal(open.why, undefined);
  assert.equal(open.say, "I open the front door.");
  const locked = find(contextActionsFor(lockedDoor(), calm(sheet)), "open");
  assert.equal(locked?.enabled, false);
  assert.equal(locked?.reason, "It is locked.");
  const farDoor = find(contextActionsFor({ ...unlocked, distanceTiles: 4 }, calm(sheet)), "open");
  assert.equal(farDoor?.farBy, 3);
  const farLocked = find(contextActionsFor(lockedDoor(4), calm(sheet)), "open");
  assert.equal(farLocked?.farBy, undefined, "the lock is in the way as well as the distance");
  assert.ok(!ids(contextActionsFor({ ...unlocked, door: { open: true, locked: false } }, calm(sheet))).includes("open"));
  const chest: ContextTarget = { kind: "chest", name: "the chest", distanceTiles: 1, inSight: true, openable: true };
  assert.ok(ids(contextActionsFor(chest, calm(sheet))).includes("open"));
  assert.ok(!ids(contextActionsFor({ ...chest, openable: false }, calm(sheet))).includes("open"));
  assert.ok(!ids(contextActionsFor({ ...chest, searched: true }, calm(sheet))).includes("open"));
});

test("Drink a potion is on your own menu only while you carry one, and says what it heals", () => {
  const self: ContextTarget = { kind: "self", name: "yourself", distanceTiles: 0, inSight: true };
  const sheet = { ...knight(), currentHp: 3 };
  assert.ok(!ids(contextActionsFor(self, calm(sheet))).includes("drink-potion"));
  assert.ok(!ids(contextActionsFor(self, calm(sheet, { potions: 0 }))).includes("drink-potion"));
  const drink = find(contextActionsFor(self, calm(sheet, { potions: 2 })), "drink-potion");
  assert.ok(drink);
  assert.equal(drink.enabled, true);
  assert.equal(drink.cost, "action");
  assert.equal(drink.why, "Heals 2d4+2, you have 2");
  // At full health it is shown, and says why not.
  const full = find(contextActionsFor(self, calm(knight(), { potions: 1 })), "drink-potion");
  assert.equal(full?.enabled, false);
  assert.match(full?.reason ?? "", /full health/);
  // In a fight it costs the action.
  assert.equal(find(contextActionsFor(self, fight(sheet, { potions: 1, actionReady: false })), "drink-potion")?.reason, "You have already used your action this turn.");
});

// ── the menu's own seams: walking up first, the text line, the talk ask, the sizes ──

test("walkAdjust: a far action that can be reached is on offer and names the walk; one that cannot stays grey with a plain reason", () => {
  const far = find(contextActionsFor(body({}, 4), calm(knight())), "loot")!;
  assert.equal(far.enabled, false);
  const reachable = walkAdjust(far, { reachable: true, feet: 15 }, false);
  assert.equal(reachable.enabled, true);
  assert.equal(reachable.reason, undefined, "no reason on an enabled line");
  assert.equal(reachable.note, "Walks 15 ft first");
  assert.equal(reachable.walkFt, 15);
  // Already beside it (a big prop with a near corner): on offer, nothing to say.
  const beside = walkAdjust(far, { reachable: true, feet: 0 }, false);
  assert.equal(beside.enabled, true);
  assert.equal(beside.note, undefined);
  assert.equal(beside.walkFt, undefined);
  // Not reachable: this turn in a fight, from here out of one.
  assert.equal(walkAdjust(far, { reachable: false, feet: 0 }, true).reason, "You cannot reach it this turn.");
  assert.equal(walkAdjust(far, { reachable: false, feet: 0 }, false).reason, "You cannot get next to it from here.");
  assert.equal(walkAdjust(far, { reachable: false, feet: 0 }, true).enabled, false);
  // Look closer is enabled to begin with: out of reach, it goes grey rather than silently doing nothing.
  const look = contextActionsFor({ kind: "prop", name: "the bed", distanceTiles: 5, inSight: true }, calm(knight()))[0]!;
  assert.equal(walkAdjust(look, { reachable: false, feet: 0 }, true).enabled, false);
  assert.equal(walkAdjust(look, { reachable: true, feet: 20 }, true).note, "Walks 20 ft first");
  // An action with no farBy is returned untouched.
  const near = find(contextActionsFor(body({}, 1), calm(knight())), "loot")!;
  assert.equal(walkAdjust(near, { reachable: false, feet: 0 }, true), near);
});

test("askPlaceholder: says who it is for, and 'Do something here' on open floor", () => {
  const goblinTarget = goblin();
  assert.equal(askPlaceholder(goblinTarget), "Say something to the goblin");
  assert.equal(askPlaceholder(goblinTarget, "Tobin Hale"), "Say something to Tobin Hale");
  assert.equal(askPlaceholder({ kind: "floor", name: "the floor wood", distanceTiles: 3, inSight: true }), "Do something here");
  assert.equal(askPlaceholder({ kind: "self", name: "yourself", distanceTiles: 0, inSight: true }), "Do something");
  assert.equal(askPlaceholder({ kind: "prop", name: "the barrel", distanceTiles: 3, inSight: true }), "Do something with the barrel");
});

test("talkAsk: the first thing said is 'I talk to <name>.' with the person's id riding in the ask, and nothing waits for a Do it", () => {
  const ask = talkAsk("Tobin Hale", { id: "tobin", name: "Tobin Hale" }, { x: 4, y: 5 });
  assert.equal(ask.kind, "freehand");
  assert.equal((ask as { text: string }).text, "I talk to Tobin Hale.");
  assert.deepEqual((ask as { npc?: unknown }).npc, { id: "tobin", name: "Tobin Hale" });
  assert.deepEqual((ask as { at?: unknown }).at, { x: 4, y: 5 });
  assert.equal((ask as { what?: string }).what, "Tobin Hale");
  const stranger = talkAsk("the goblin");
  assert.equal((stranger as { text: string }).text, "I talk to the goblin.");
  assert.equal("npc" in stranger, false);
  // The talk starts by itself: the flow has no ask box to fill and no tc.talkTarget to set.
  const src = readFileSync(new URL("../src/games/livingtable/table/flows/adventureWorld.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /prefillAsk|talkTarget\s*=/);
  assert.match(src, /tc\.runDm\(talkAsk\(/);
});

test("the menu is wide enough for its small lines, a line can carry a walking note, and a soft keyboard takes room from the board", () => {
  assert.equal(MENU_MAX_WIDTH, 320);
  assert.equal(menuWidth(1000), 320);
  assert.equal(menuWidth(320), 304, "on a 320 px phone it keeps 8 px either side");
  assert.equal(menuEntryName({ label: "Look closer", note: "Walks 15 ft first", enabled: true }), "Look closer, Walks 15 ft first");
  // 500 px board whose bottom sits at 700 in a window whose visible part ends at 450 (a keyboard over the lower part): 250 px are covered.
  assert.equal(boardRoomAboveKeyboard(500, 700, 450), 250);
  assert.equal(boardRoomAboveKeyboard(500, 700, 900), 500, "no keyboard, no loss");
  assert.equal(boardRoomAboveKeyboard(100, 700, 450), 0, "never negative");
});

test("no source of the menu's flows says 'bench', 'stub', 'games-db', 'Cast menu', or 'does not track' to a player", () => {
  const files = ["menuFlow", "loot", "maneuvers", "adventureWorld"].map((f) => `src/games/livingtable/table/flows/${f}.ts`);
  files.push("src/games/livingtable/rules/corpses.ts", "src/games/livingtable/session/contextActions.ts");
  for (const rel of files) {
    const src = readFileSync(new URL(`../${rel}`, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\s\/\/ .*$/gm, "");
    // Quoted strings and template text only: a developer's comment may say what it likes.
    const strings = [...src.matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2] ?? "");
    for (const text of strings) {
      if (text.length < 8 || !/\s/.test(text)) continue;
      assert.doesNotMatch(text, /\bbench\b|\bstub\b|games-db|Cast menu|does not track/i, `${rel}: ${text}`);
    }
  }
});

test("an adjust hook changes each line before the list is put in order", () => {
  const sheet = knight();
  const floor = (distanceTiles: number): ContextTarget => ({ kind: "floor", name: "that square", distanceTiles, inSight: true });
  // Far away, Search is greyed by distance and sinks below Hide and Sneak.
  assert.deepEqual(ids(contextActionsFor(floor(4), calm(sheet))), ["look", "hide", "sneak", "search"]);
  // The table makes it reachable by walking: it is now an enabled line and ranks as one, first of the quiet verbs.
  const walkable = contextActionsFor(floor(4), calm(sheet), (a) => {
    if (a.farBy === undefined) return a;
    const { reason: _gone, ...rest } = a;
    return { ...rest, enabled: true };
  });
  assert.deepEqual(ids(walkable), ["look", "search", "hide", "sneak"]);
  assert.ok(walkable.every((a) => a.enabled));
  // The other way: a line the table greys sinks to the bottom.
  const greyed = contextActionsFor(floor(1), calm(sheet), (a) => (a.id === "search" ? { ...a, enabled: false, reason: "Not now." } : a));
  assert.deepEqual(ids(greyed), ["look", "hide", "sneak", "search"]);
  // Without a hook nothing changes.
  assert.deepEqual(contextActionsFor(floor(4), calm(sheet)), contextActionsFor(floor(4), calm(sheet), (a) => a));
});
