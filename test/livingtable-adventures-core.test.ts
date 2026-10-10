/**
 * Tests for the adventure core (src/games/livingtable/adventures/): the typed
 * model, validation, progress through an adventure, the gospel brief, and the
 * map-to-layout step. A small fixture adventure (a tavern and its cellar, an
 * innkeeper, a pack of rats, a goblin) drives all of it.
 *
 * Run: npx -y tsx --test test/livingtable-adventures-core.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adventureBrief,
  allowedDmSteps,
  applyEvent,
  evaluate,
  exitDestination,
  locationLayout,
  settleProgress,
  startProgress,
  validateAdventure,
  type Adventure,
  type AdventureAssets,
  type AdventureEvent,
  type AdventureProgress,
  type Condition,
} from "../src/games/livingtable/adventures";
import { CELL_HEIGHT, CELL_WIDTH, emptyWorld, getCell, setCell, validateLayout, type AssetManifest } from "../src/games/livingtable/world";

// ---------------------------------------------------------------------------
// Fixture

function walledRows(): string[] {
  return Array.from({ length: CELL_HEIGHT }, (_, y) => (y === 0 || y === CELL_HEIGHT - 1 ? "#".repeat(CELL_WIDTH) : "#" + ".".repeat(CELL_WIDTH - 2) + "#"));
}

function put(rows: string[], x: number, y: number, ch: string): void {
  const r = rows[y]!;
  rows[y] = r.slice(0, x) + ch + r.slice(x + 1);
}

function fixture(): Adventure {
  const tavern = walledRows();
  put(tavern, 5, 5, "@");
  put(tavern, 8, 5, "I");
  put(tavern, 10, CELL_HEIGHT - 1, "D");
  const cellar = walledRows();
  put(cellar, 10, 0, "U");
  put(cellar, 8, 7, "r");
  put(cellar, 14, 10, "g");
  put(cellar, 3, 3, "b");
  return {
    id: "test_cellar",
    title: "The Test Cellar",
    version: 1,
    author: "owner",
    summary: "Rats in a tavern cellar, and what leads them.",
    levelRange: [1, 2],
    tone: "Warm and a little comic.",
    truths: ["The tavern is called the Gilded Pony.", "The rats are led by a goblin."],
    dmMust: ["Let the player discover the tunnel by looking."],
    dmNever: ["Never let the goblin talk in the common tongue."],
    hooks: { default: "You are a village apprentice looking for extra work.", fighter: "You are known in the village for your brawn." },
    startingKit: { default: { armor: "none", items: [], potions: 0 }, rogue: { armor: "none", weaponNote: "a plain dagger", items: [], potions: 0 } },
    locations: [
      {
        id: "tavern",
        name: "The Gilded Pony",
        readAloud: "A low room smelling of woodsmoke.",
        dmNotes: "The cellar trapdoor is behind the bar.",
        map: {
          rows: tavern,
          legend: {
            "#": { tile: "wall_stone" },
            ".": { tile: "floor_stone" },
            "@": { tile: "floor_stone", start: true },
            I: { tile: "floor_stone", spawn: "innkeeper_spawn" },
            D: { tile: "floor_stone", exit: "cellar_stairs" },
          },
        },
        features: [],
        spawns: [{ id: "innkeeper_spawn", creature: "token_villager", hostile: false, awake: true, npcId: "innkeeper" }],
        exits: [{ id: "cellar_stairs", to: "cellar", arriveAt: "stairs_up", label: "Trapdoor down" }],
      },
      {
        id: "cellar",
        name: "The Cellar",
        readAloud: "Damp stone and the sound of scratching.",
        map: {
          rows: cellar,
          legend: {
            "#": { tile: "wall_stone" },
            ".": { tile: "floor_stone" },
            U: { tile: "floor_stone", exit: "stairs_up" },
            r: { tile: "floor_stone", spawn: "rat" },
            g: { tile: "floor_stone", spawn: "goblin" },
            b: { tile: "floor_stone", prop: "chest", feature: "barrel" },
          },
        },
        features: [
          {
            id: "barrel",
            name: "A split barrel",
            description: "A barrel with its side gnawed through.",
            secret: "A rusted key lies in the dregs.",
            searchDc: 12,
            gives: ["old_key"],
            once: true,
          },
        ],
        spawns: [
          { id: "rat", creature: "giant-rat", count: 3, hostile: true, awake: true },
          { id: "goblin", creature: "goblin", hostile: true, awake: true },
        ],
        exits: [{ id: "stairs_up", to: "tavern", arriveAt: "cellar_stairs", label: "Stairs up" }],
      },
    ],
    npcs: [
      {
        id: "innkeeper",
        name: "Marta",
        token: "token_villager",
        role: "innkeeper",
        personality: "Brisk and kind.",
        wants: "The rats gone before market day.",
        knows: ["The scratching started a week ago."],
        secrets: ["She heard digging at night."],
        voice: "Quick, motherly.",
        location: "tavern",
      },
    ],
    items: [{ id: "old_key", name: "Old key", description: "A rusted iron key.", quest: true }],
    scenes: [
      {
        id: "s1",
        title: "Rats in the cellar",
        location: "tavern",
        opening: "Marta wrings her apron.",
        objectives: [
          { id: "talk", text: "Speak with Marta.", doneWhen: { talkedTo: "innkeeper" } },
          { id: "rats", text: "Clear the rats.", doneWhen: { killed: "all:rat" } },
          { id: "tunnel", text: "Find where they come from.", hidden: true, doneWhen: { flag: "tunnel_seen" } },
        ],
        beats: [
          { id: "b_quiet", when: { killed: "rat" }, narrate: "The scratching stops.", setFlags: ["cellar_quiet"], spawn: ["goblin"] },
          { id: "b_hint", when: { flag: "cellar_quiet" }, narrate: "Something shuffles behind the wall." },
        ],
        next: [{ scene: "s2", when: { killed: "goblin" } }],
      },
      {
        id: "s2",
        title: "Done",
        opening: "The cellar is quiet at last.",
        objectives: [],
        beats: [],
        next: [],
        ending: { text: "Marta presses coins into your hand.", outcome: "victory" },
      },
    ],
    start: { sceneId: "s1", locationId: "tavern", at: { x: 5, y: 5 } },
  };
}

const ASSETS: AdventureAssets = {
  tiles: ["floor_stone", "wall_stone"],
  props: ["chest"],
  tokens: ["token_villager", "token_goblin", "token_rat", "token_giant_rat"],
  walkableTiles: ["floor_stone"],
  blockingProps: ["chest"],
};

const MANIFEST: AssetManifest = {
  tiles: { floor_stone: { walkable: true }, wall_stone: { walkable: false } },
  tokens: { token_villager: {}, token_goblin: {}, token_rat: {}, token_giant_rat: {} },
  props: { chest: { blocks: true } },
};

function play(a: Adventure, p: AdventureProgress, ...events: AdventureEvent[]): AdventureProgress {
  for (const e of events) p = applyEvent(a, p, e).progress;
  return p;
}

function bad(mutate: (a: Adventure) => void, assets: AdventureAssets | undefined = ASSETS) {
  const a = fixture();
  mutate(a);
  return validateAdventure(a, assets);
}

function hasIssue(issues: { path: string; message: string }[], pathPrefix: string, messagePart?: RegExp): boolean {
  return issues.some((i) => i.path.startsWith(pathPrefix) && (messagePart === undefined || messagePart.test(i.message)));
}

// ---------------------------------------------------------------------------
// Validation

test("the fixture adventure validates with no errors and no warnings", () => {
  const { errors, warnings } = validateAdventure(fixture(), ASSETS);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test("validation without the asset lists still checks everything else", () => {
  const { errors } = validateAdventure(fixture());
  assert.deepEqual(errors, []);
});

test("validation: map shape errors carry the row path", () => {
  assert.ok(hasIssue(bad((a) => a.locations[0]!.map.rows.pop()).errors, "locations.tavern.map.rows", /exactly 15 rows/));
  assert.ok(hasIssue(bad((a) => (a.locations[0]!.map.rows[3] = "#.....#")).errors, "locations.tavern.map.rows[3]", /exactly 20 characters/));
});

test("validation: a legend character the map uses but the legend lacks", () => {
  const r = bad((a) => put(a.locations[1]!.map.rows, 4, 4, "?"));
  assert.ok(hasIssue(r.errors, "locations.cellar.map.rows[4]", /"\?".*legend does not define/));
});

test("validation: a legend character that is never used is a warning", () => {
  const r = bad((a) => (a.locations[1]!.map.legend["~"] = { tile: "floor_stone" }));
  assert.ok(hasIssue(r.warnings, 'locations.cellar.map.legend["~"]', /never used/));
  assert.deepEqual(r.errors, []);
});

test("validation: exactly one start, and it must match start.at and be walkable", () => {
  const two = bad((a) => put(a.locations[0]!.map.rows, 6, 6, "@"));
  assert.ok(hasIssue(two.errors, "locations.tavern.map", /at most one|exactly one/));

  const none = bad((a) => put(a.locations[0]!.map.rows, 5, 5, "."));
  assert.ok(hasIssue(none.errors, "locations.tavern.map", /exactly one start/));

  const moved = bad((a) => (a.start.at = { x: 6, y: 5 }));
  assert.ok(hasIssue(moved.errors, "start.at", /marks/));

  const wall = bad((a) => (a.locations[0]!.map.legend["@"]!.tile = "wall_stone"));
  assert.ok(hasIssue(wall.errors, "locations.tavern.map", /not somewhere a hero can stand/));
  assert.ok(hasIssue(wall.errors, "start.at", /not walkable/));
});

test("validation: references to things that do not exist", () => {
  assert.ok(hasIssue(bad((a) => (a.locations[0]!.exits[0]!.to = "nowhere")).errors, "locations.tavern.exits.cellar_stairs.to", /not a location/));
  assert.ok(hasIssue(bad((a) => (a.locations[0]!.exits[0]!.arriveAt = "missing_exit")).errors, "locations.tavern.exits.cellar_stairs.arriveAt", /not an exit/));
  assert.ok(hasIssue(bad((a) => (a.locations[0]!.exits[0]!.arriveAt = "start")).errors, "locations.tavern.exits.cellar_stairs.arriveAt", /no start square/));
  assert.ok(hasIssue(bad((a) => (a.scenes[0]!.next[0]!.scene = "ghost")).errors, "scenes.s1.next[0].scene", /not a scene/));
  assert.ok(hasIssue(bad((a) => (a.start.sceneId = "ghost")).errors, "start.sceneId", /not a scene/));
  assert.ok(hasIssue(bad((a) => (a.start.locationId = "ghost")).errors, "start.locationId", /not a location/));
  assert.ok(hasIssue(bad((a) => (a.scenes[0]!.location = "ghost")).errors, "scenes.s1.location", /not a location/));
  assert.ok(hasIssue(bad((a) => (a.locations[0]!.spawns[0]!.npcId = "ghost")).errors, "locations.tavern.spawns.innkeeper_spawn.npcId", /not an NPC/));
  assert.ok(hasIssue(bad((a) => (a.npcs[0]!.location = "ghost")).errors, "npcs.innkeeper.location", /not a location/));
  assert.ok(hasIssue(bad((a) => (a.locations[0]!.map.legend.I!.spawn = "ghost")).errors, 'locations.tavern.map.legend["I"].spawn', /not a spawn/));
  assert.ok(hasIssue(bad((a) => (a.locations[1]!.map.legend.b!.feature = "ghost")).errors, 'locations.cellar.map.legend["b"].feature', /not a feature/));
  assert.ok(hasIssue(bad((a) => (a.locations[1]!.map.legend.U!.exit = "ghost")).errors, 'locations.cellar.map.legend["U"].exit', /not an exit/));
  assert.ok(hasIssue(bad((a) => a.scenes[0]!.beats[0]!.spawn!.push("ghost")).errors, "scenes.s1.beats.b_quiet.spawn", /not a spawn/));
});

test("validation: conditions that name things that do not exist", () => {
  const cond = (c: Condition) => bad((a) => (a.scenes[0]!.objectives[0]!.doneWhen = c)).errors;
  assert.ok(hasIssue(cond({ objective: "ghost" }), "scenes.s1.objectives.talk.doneWhen", /not an objective/));
  assert.ok(hasIssue(cond({ has: "ghost" }), "scenes.s1.objectives.talk.doneWhen", /not an item/));
  assert.ok(hasIssue(cond({ talkedTo: "ghost" }), "scenes.s1.objectives.talk.doneWhen", /not an NPC/));
  assert.ok(hasIssue(cond({ entered: "ghost" }), "scenes.s1.objectives.talk.doneWhen", /not a location/));
  assert.ok(hasIssue(cond({ killed: "ghost" }), "scenes.s1.objectives.talk.doneWhen", /not a spawn or creature/));
  assert.ok(hasIssue(cond({ killed: "all:zzz" }), "scenes.s1.objectives.talk.doneWhen", /No spawn id starts with/));
  assert.ok(hasIssue(cond({ all: [{ not: { has: "ghost" } }] }), "scenes.s1.objectives.talk.doneWhen.all[0].not", /not an item/));
  assert.ok(hasIssue(cond({ flag: "a", has: "old_key" } as unknown as Condition), "scenes.s1.objectives.talk.doneWhen", /exactly one/));
});

test("validation: creatures and assets", () => {
  assert.ok(hasIssue(bad((a) => (a.locations[1]!.spawns[0]!.creature = "dragonfly-queen")).errors, "locations.cellar.spawns.rat.creature", /not a creature the game knows/));
  assert.ok(hasIssue(bad((a) => (a.locations[1]!.spawns[0]!.creature = "gear_knight_weapon_base")).errors, "locations.cellar.spawns.rat.creature", /equipment|not a creature/));
  // A known creature with no picture in the given token list.
  assert.ok(hasIssue(bad((a) => (a.locations[1]!.spawns[0]!.creature = "wolf")).errors, "locations.cellar.spawns.rat.creature", /no picture/));
  assert.ok(hasIssue(bad((a) => (a.locations[0]!.map.legend["."]!.tile = "floor_lava")).errors, 'locations.tavern.map.legend["."].tile', /no floor tile/));
  assert.ok(hasIssue(bad((a) => (a.locations[1]!.map.legend.b!.prop = "barrelx")).errors, 'locations.cellar.map.legend["b"].prop', /no prop/));
  assert.ok(hasIssue(bad((a) => (a.npcs[0]!.token = "token_nobody")).errors, "npcs.innkeeper.token", /no token picture/));
  // The caller's own creature list replaces the built-in bestiary.
  const only = validateAdventure(fixture(), ASSETS, ["token_villager", "goblin"]);
  assert.ok(hasIssue(only.errors, "locations.cellar.spawns.rat.creature", /not a creature the game knows/));
});

test("validation: exits and spawns must be on walkable squares and placed", () => {
  assert.ok(hasIssue(bad((a) => (a.locations[0]!.map.legend.D!.tile = "wall_stone")).errors, "locations.tavern.exits.cellar_stairs", /not somewhere anyone can stand/));
  assert.ok(hasIssue(bad((a) => put(a.locations[1]!.map.rows, 8, 7, ".")).errors, "locations.cellar.spawns.rat", /never placed/));
  assert.ok(hasIssue(bad((a) => put(a.locations[0]!.map.rows, 10, CELL_HEIGHT - 1, "#")).errors, "locations.tavern.exits.cellar_stairs", /never placed/));
  // A group with no floor to spread onto.
  const crowded = bad((a) => {
    a.locations[1]!.map.rows = a.locations[1]!.map.rows.map((r) => r.replace(/\./g, "#"));
    put(a.locations[1]!.map.rows, 10, 1, "."); // keep one floor square beside the exit
    a.locations[1]!.spawns[0]!.count = 6;
  });
  assert.ok(hasIssue(crowded.errors, "locations.cellar.spawns.rat", /no free floor/));
});

test("validation: duplicate ids, empty text and bad numbers", () => {
  assert.ok(hasIssue(bad((a) => (a.scenes[1]!.id = "s1")).errors, "scenes[1].id", /share the id/));
  assert.ok(hasIssue(bad((a) => (a.scenes[0]!.objectives[1]!.id = "talk")).errors, "scenes.s1.objectives.talk", /share the id/));
  assert.ok(hasIssue(bad((a) => (a.locations[1]!.spawns[1]!.id = "rat")).errors, "locations.cellar.spawns.rat", /used twice/));
  assert.ok(hasIssue(bad((a) => (a.locations[1]!.features[0]!.searchDc = 40)).errors, "locations.cellar.features.barrel.searchDc", /1 to 30/));
  assert.ok(hasIssue(bad((a) => (a.locations[1]!.spawns[0]!.count = 0)).errors, "locations.cellar.spawns.rat.count", /whole number/));
  assert.ok(hasIssue(bad((a) => (a.title = "  ")).errors, "title", /needs a title/));
  assert.ok(hasIssue(bad((a) => (a.version = 0)).errors, "version", /whole number/));
  assert.ok(hasIssue(bad((a) => (a.levelRange = [3, 1])).errors, "levelRange", /lowest first/));
  assert.ok(hasIssue(bad((a) => ((a.hooks as Record<string, string>).paladin = "x")).errors, "hooks.paladin", /not a class/));
  assert.ok(hasIssue(bad((a) => (a.startingKit.default!.potions = -1)).errors, "startingKit.default.potions", /whole number/));
  assert.ok(hasIssue(bad((a) => (a.scenes[1]!.ending!.outcome = "win" as never)).errors, "scenes.s2.ending.outcome", /victory/));
});

test("validation warnings: unreachable scenes and locations, dead ends, unread flags, unobtainable quest items", () => {
  const unreachableScene = bad((a) => a.scenes.push({ id: "s9", title: "Orphan", objectives: [], beats: [], next: [], ending: { text: "x", outcome: "defeat" } }));
  assert.ok(hasIssue(unreachableScene.warnings, "scenes.s9", /No path of scene transitions/));

  const deadEnd = bad((a) => delete a.scenes[1]!.ending);
  assert.ok(hasIssue(deadEnd.warnings, "scenes.s2", /no ending and no way out/));
  assert.ok(hasIssue(deadEnd.warnings, "scenes", /can never be finished/));

  const orphanPlace = bad((a) => {
    a.locations[1]!.exits = [];
    a.locations[0]!.exits = [];
    put(a.locations[0]!.map.rows, 10, CELL_HEIGHT - 1, "#");
    delete a.locations[0]!.map.legend.D;
  });
  assert.ok(hasIssue(orphanPlace.warnings, "locations.cellar", /No chain of exits/));

  const unread = bad((a) => a.scenes[0]!.beats[0]!.setFlags!.push("typo_flag"));
  assert.ok(hasIssue(unread.warnings, "flags.typo_flag", /no condition ever checks/));

  const noKey = bad((a) => (a.locations[1]!.features[0]!.gives = []));
  assert.ok(hasIssue(noKey.warnings, "items.old_key", /ever hands it over/));

  const manyGives = bad((a) => a.locations[1]!.features[0]!.gives!.push("a coin"));
  assert.ok(hasIssue(manyGives.warnings, "locations.cellar.features.barrel.gives", /one item per feature/));
});

// ---------------------------------------------------------------------------
// Conditions and progress

test("startProgress counts the start location as entered", () => {
  const a = fixture();
  const p = startProgress(a);
  assert.equal(p.sceneId, "s1");
  assert.equal(p.locationId, "tavern");
  assert.deepEqual(p.entered, ["tavern"]);
  assert.deepEqual(p.killed, []);
  assert.deepEqual(p.flags, {});
});

test("evaluate: every condition form", () => {
  const a = fixture();
  let p = startProgress(a);
  const yes = (c: Condition) => assert.equal(evaluate(a, p, c), true, JSON.stringify(c));
  const no = (c: Condition) => assert.equal(evaluate(a, p, c), false, JSON.stringify(c));
  yes({ always: true });
  yes({ entered: "tavern" });
  no({ entered: "cellar" });
  no({ flag: "x" });
  yes({ not: { flag: "x" } });
  no({ all: [{ always: true }, { flag: "x" }] });
  yes({ any: [{ flag: "x" }, { always: true }] });
  yes({ all: [] });
  no({ any: [] });

  p = play(a, p, { type: "enter", location: "cellar" }, { type: "talk", npc: "innkeeper" }, { type: "flag", flag: "x" }, { type: "gain", item: "old_key" });
  yes({ entered: "cellar" });
  yes({ talkedTo: "innkeeper" });
  yes({ flag: "x" });
  yes({ has: "old_key" });
  yes({ objective: "talk" });

  p = play(a, p, { type: "kill", spawn: "rat" });
  no({ killed: "rat" }); // a group of three: one is not all
  no({ killed: "all:rat" });
  yes({ killed: "rat_1" });
  p = play(a, p, { type: "kill", spawn: "rat" }, { type: "kill", spawn: "rat" });
  yes({ killed: "rat" });
  yes({ killed: "all:rat" });
  no({ killed: "goblin" });
});

test("progress runs through enter, talk, kill, flag, dm steps to the ending", () => {
  const a = fixture();
  let p = startProgress(a);

  let r = applyEvent(a, p, { type: "talk", npc: "innkeeper" });
  assert.deepEqual(r.completed.map((o) => o.id), ["talk"]);
  p = r.progress;

  r = applyEvent(a, p, { type: "enter", location: "cellar" });
  assert.equal(r.progress.locationId, "cellar");
  assert.deepEqual(r.progress.entered, ["tavern", "cellar"]);
  p = r.progress;

  // The goblin is not in the cellar until the beat brings it.
  assert.equal(p.spawned.includes("goblin"), false);

  // The first rat's death fires the beat (killed: "rat" is not yet true: the group is three).
  r = applyEvent(a, p, { type: "kill", spawn: "rat" });
  assert.deepEqual(r.fired, []);
  r = applyEvent(a, r.progress, { type: "kill", spawn: "rat" });
  r = applyEvent(a, r.progress, { type: "kill", spawn: "rat" });
  assert.deepEqual(r.fired.map((b) => b.id), ["b_quiet", "b_hint"]);
  assert.deepEqual(r.completed.map((o) => o.id), ["rats"]);
  assert.equal(r.progress.flags.cellar_quiet, true);
  assert.deepEqual(r.progress.spawned, ["goblin"]);
  p = r.progress;

  // The DM may declare the hidden objective, which the adventure allows.
  r = applyEvent(a, p, { type: "dm", step: { kind: "objective", id: "tunnel" } });
  assert.equal(r.refused, undefined);
  assert.deepEqual(r.completed.map((o) => o.id), ["tunnel"]);
  assert.equal(r.progress.flags.tunnel_seen, true);
  p = r.progress;
  assert.equal(p.sceneId, "s1");

  // Killing the goblin moves the story and ends it.
  r = applyEvent(a, p, { type: "kill", spawn: "goblin" });
  assert.deepEqual(r.sceneChanged, { from: "s1", to: "s2", opening: "The cellar is quiet at last." });
  assert.deepEqual(r.ended, { text: "Marta presses coins into your hand.", outcome: "victory" });
  assert.equal(r.progress.ended, "victory");
  p = r.progress;

  // After the end nothing more is accepted.
  r = applyEvent(a, p, { type: "enter", location: "tavern" });
  assert.match(r.refused ?? "", /over/);
  assert.equal(r.progress, p);
  assert.deepEqual(allowedDmSteps(a, p), []);
});

test("applyEvent never mutates the progress it is given", () => {
  const a = fixture();
  const p = startProgress(a);
  const frozen = JSON.stringify(p);
  applyEvent(a, p, { type: "kill", spawn: "rat" });
  applyEvent(a, p, { type: "talk", npc: "innkeeper" });
  assert.equal(JSON.stringify(p), frozen);
});

test("a dm step the adventure does not allow is refused, and nothing changes", () => {
  const a = fixture();
  const p = startProgress(a);
  const refuse = (step: Parameters<typeof applyEvent>[2] & { type: "dm" }, re: RegExp) => {
    const r = applyEvent(a, p, step);
    assert.match(r.refused ?? "", re, JSON.stringify(step));
    assert.equal(r.progress, p);
    assert.deepEqual(r.fired, []);
  };
  // A scene the current scene does not link to.
  refuse({ type: "dm", step: { kind: "scene", id: "s9" } }, /cannot go to "s9"/);
  // A linked scene whose way in is a kill, not a proposal.
  refuse({ type: "dm", step: { kind: "scene", id: "s2" } }, /only when goblin is dead/);
  // An objective the engine finishes by itself.
  refuse({ type: "dm", step: { kind: "objective", id: "rats" } }, /finished by the story itself/);
  // An objective that is not in this scene.
  refuse({ type: "dm", step: { kind: "objective", id: "ghost" } }, /not an objective of the current scene/);
  // A flag no condition here names, and one a beat sets for itself.
  refuse({ type: "dm", step: { kind: "flag", flag: "bogus" } }, /does not let the story declare/);
  refuse({ type: "dm", step: { kind: "flag", flag: "cellar_quiet" } }, /does not let the story declare/);
});

test("allowedDmSteps lists exactly what the DM may propose", () => {
  const a = fixture();
  let p = startProgress(a);
  assert.deepEqual(allowedDmSteps(a, p), [{ kind: "objective", id: "tunnel" }]);
  p = play(a, p, { type: "dm", step: { kind: "objective", id: "tunnel" } });
  assert.deepEqual(allowedDmSteps(a, p), []);
});

test("a flag in a scene transition lets the DM move the story, only along a link", () => {
  const a = fixture();
  a.scenes[0]!.next.push({ scene: "s2", when: { flag: "talked_it_out" } });
  const p = startProgress(a);
  assert.deepEqual(allowedDmSteps(a, p), [{ kind: "objective", id: "tunnel" }, { kind: "scene", id: "s2" }]);
  const r = applyEvent(a, p, { type: "dm", step: { kind: "scene", id: "s2" } });
  assert.equal(r.refused, undefined);
  assert.equal(r.progress.sceneId, "s2");
  assert.equal(r.progress.ended, "victory");
});

test("beats fire once by default; once:false fires on every event while the condition holds", () => {
  const a = fixture();
  a.scenes[0]!.beats.push({ id: "b_always_once", when: { always: true }, narrate: "Once." });
  a.scenes[0]!.beats.push({ id: "b_always_repeat", when: { always: true }, narrate: "Again.", once: false });
  let p = startProgress(a);
  let r = settleProgress(a, p);
  assert.deepEqual(r.fired.map((b) => b.id).sort(), ["b_always_once", "b_always_repeat"]);
  p = r.progress;
  assert.ok(p.beatsFired.includes("b_always_once"));
  assert.equal(p.beatsFired.includes("b_always_repeat"), false);
  r = applyEvent(a, p, { type: "talk", npc: "innkeeper" });
  assert.deepEqual(r.fired.map((b) => b.id), ["b_always_repeat"]);
  // The kill beat from the fixture also fires only once across repeated deaths.
  p = play(a, r.progress, { type: "kill", spawn: "rat" }, { type: "kill", spawn: "rat" }, { type: "kill", spawn: "rat" });
  assert.equal(p.beatsFired.filter((id) => id === "b_quiet").length, 1);
  r = applyEvent(a, p, { type: "kill", spawn: "rat_1" });
  assert.equal(r.fired.some((b) => b.id === "b_quiet"), false);
});

test("a beat can hand over items", () => {
  const a = fixture();
  a.scenes[0]!.beats.push({ id: "b_gift", when: { talkedTo: "innkeeper" }, give: ["Old key"] });
  const r = applyEvent(a, startProgress(a), { type: "talk", npc: "innkeeper" });
  assert.deepEqual(r.progress.has, ["old_key"]);
});

test("events naming things the adventure does not have are refused in plain words", () => {
  const a = fixture();
  const p = startProgress(a);
  assert.match(applyEvent(a, p, { type: "enter", location: "moon" }).refused ?? "", /no place called "moon"/);
  assert.match(applyEvent(a, p, { type: "kill", spawn: "dragon" }).refused ?? "", /no creature called "dragon"/);
  assert.match(applyEvent(a, p, { type: "talk", npc: "ghost" }).refused ?? "", /no one called "ghost"/);
  // An item the adventure does not know is ordinary loot: accepted, no story state.
  const r = applyEvent(a, p, { type: "gain", item: "a bent spoon" });
  assert.equal(r.refused, undefined);
  assert.deepEqual(r.progress.has, []);
});

test("losing an item takes it out of the progress record", () => {
  const a = fixture();
  let p = play(a, startProgress(a), { type: "gain", item: "old_key" });
  assert.deepEqual(p.has, ["old_key"]);
  p = play(a, p, { type: "lose", item: "Old key" });
  assert.deepEqual(p.has, []);
});

test("a story that loops on itself stops instead of hanging", () => {
  const a = fixture();
  a.scenes[1]!.next = [{ scene: "s1", when: { always: true } }];
  delete a.scenes[1]!.ending;
  a.scenes[0]!.next = [{ scene: "s2", when: { always: true } }];
  const r = settleProgress(a, startProgress(a));
  assert.ok(r.progress.sceneId === "s1" || r.progress.sceneId === "s2");
});

// ---------------------------------------------------------------------------
// The gospel brief

test("the brief carries the truths, the lists, the rules, the secrets and the allowed steps", () => {
  const a = fixture();
  let p = startProgress(a);
  let brief = adventureBrief(a, p, { chassis: "fighter" });
  for (const t of a.truths) assert.ok(brief.includes(t), t);
  assert.ok(brief.includes(a.dmMust[0]!));
  assert.ok(brief.includes(a.dmNever[0]!));
  assert.ok(brief.includes("This adventure is gospel: follow it. Improvise texture, never facts. Move the story only with the progress steps listed."));
  assert.ok(brief.includes("known in the village for your brawn"), "class hook for a fighter");
  assert.ok(!brief.includes("village apprentice looking for extra work"), "the default hook is not used when the class has one");
  assert.ok(brief.includes("Current scene: Rats in the cellar"));
  assert.ok(brief.includes("(hidden from the player)"));
  assert.ok(brief.includes("Where the party is: The Gilded Pony"));
  assert.ok(brief.includes("Marta"));
  assert.ok(brief.includes("DM ONLY secret (will not volunteer): She heard digging at night."));
  assert.ok(brief.includes('finish objective "tunnel"'), "the allowed step is listed");
  assert.ok(!brief.includes("move on to scene"), "a step the adventure does not allow now is not offered");

  // Another class falls back to the default hook.
  assert.ok(adventureBrief(a, p, { chassis: "wizard" }).includes("village apprentice looking for extra work"));

  // In the cellar the barrel's secret is there, marked DM ONLY, and the dead are counted out.
  p = play(a, p, { type: "enter", location: "cellar" }, { type: "kill", spawn: "rat" });
  brief = adventureBrief(a, p, { chassis: "fighter" });
  assert.ok(brief.includes("DM ONLY secret (found on a search, DC 12): A rusted key lies in the dregs."));
  assert.ok(brief.includes("2 giant rats (hostile, awake)"));
  assert.ok(brief.includes("Stairs up"));
  assert.ok(!brief.includes("goblin (hostile"), "the goblin has not been brought in yet");
});

test("the brief fits maxChars at every size and keeps the essentials as long as it can", () => {
  const a = fixture();
  const p = play(a, startProgress(a), { type: "enter", location: "cellar" }, { type: "talk", npc: "innkeeper" });
  const full = adventureBrief(a, p, { chassis: "rogue" });
  assert.ok(full.length > 1100, `fixture brief should be sizeable, was ${full.length}`);
  let last = Infinity;
  for (const max of [full.length + 10, 1300, 1000, 800, 700, 500, 350, 250, 120, 40]) {
    const text = adventureBrief(a, p, { chassis: "rogue", maxChars: max });
    assert.ok(text.length <= max, `max ${max} got ${text.length}`);
    assert.ok(text.length <= Math.max(last, full.length));
    last = text.length;
  }
  const mid = adventureBrief(a, p, { chassis: "rogue", maxChars: 700 });
  assert.ok(mid.includes("gospel"));
  assert.ok(mid.includes(a.truths[0]!));
  assert.ok(mid.includes(a.dmNever[0]!));
  assert.equal(adventureBrief(a, p, { chassis: "rogue", maxChars: full.length }), full);
});

test("the brief says so when the adventure is over or no step is open", () => {
  const a = fixture();
  const done = play(a, startProgress(a), { type: "enter", location: "cellar" }, { type: "kill", spawn: "goblin" });
  assert.equal(done.ended, "victory");
  assert.match(adventureBrief(a, done), /ended in victory/);
  const open = play(a, startProgress(a), { type: "dm", step: { kind: "objective", id: "tunnel" } });
  assert.match(adventureBrief(a, open), /No progress step is open right now/);
});

// ---------------------------------------------------------------------------
// Map to layout

test("locationLayout builds a valid 20x15 engine layout with tokens, props and exits", () => {
  const a = fixture();
  const { layout, spawnsAt, exitsAt, featuresAt } = locationLayout(a, "cellar", { walkable: (t) => t === "floor_stone", blocking: (p) => p === "chest" });
  assert.equal(layout.tiles.length, CELL_HEIGHT);
  assert.ok(layout.tiles.every((row) => row.length === CELL_WIDTH));
  assert.equal(layout.tiles[0]![0], "wall_stone");
  assert.equal(layout.tiles[7]![8], "floor_stone");

  // Three rats, one marked square and two spread to free neighbours, none sharing a square.
  const rats = layout.tokens.filter((t) => t.assetId === "token_giant_rat");
  assert.deepEqual(rats.map((t) => t.id), ["rat_1", "rat_2", "rat_3"]);
  assert.ok(rats.every((t) => t.kind === "monster"));
  assert.deepEqual({ x: rats[0]!.x, y: rats[0]!.y }, { x: 8, y: 7 });
  assert.equal(new Set(rats.map((t) => `${t.x},${t.y}`)).size, 3);
  assert.equal(spawnsAt.rat!.length, 3);
  // The goblin is gated behind a beat and absent at the start.
  assert.equal(layout.tokens.some((t) => t.assetId === "token_goblin"), false);

  // The barrel carries its search details onto the prop.
  const barrel = layout.props.find((p) => p.id === "barrel")!;
  assert.deepEqual({ x: barrel.x, y: barrel.y, assetId: barrel.assetId }, { x: 3, y: 3, assetId: "chest" });
  assert.equal(barrel.label, "A split barrel");
  assert.equal(barrel.dc, 12);
  assert.equal(barrel.onFound, "A rusted key lies in the dregs.");
  assert.equal(barrel.grantsItem, "Old key");
  assert.deepEqual(featuresAt.barrel, { x: 3, y: 3 });

  // The stairs are on the north edge, so they are a real engine exit to the cell above.
  assert.deepEqual(exitsAt.stairs_up, { x: 10, y: 0 });
  assert.deepEqual(layout.exits, [{ at: { x: 10, y: 0 }, edge: "N", toCell: { cx: 0, cy: -1 } }]);

  // The engine itself accepts the layout.
  const v = validateLayout(layout, MANIFEST, { cx: 0, cy: 0 });
  assert.deepEqual(v, { ok: true });
  const world = setCell(emptyWorld(), { cx: 0, cy: 0 }, layout);
  assert.equal(getCell(world, { cx: 0, cy: 0 }), layout);
});

test("locationLayout follows the progress: beat spawns appear, the dead stay dead, shut exits stay shut", () => {
  const a = fixture();
  const opts = { walkable: (t: string) => t === "floor_stone", blocking: (p: string) => p === "chest" };
  let p = play(a, startProgress(a), { type: "enter", location: "cellar" }, { type: "kill", spawn: "rat" }, { type: "kill", spawn: "rat" }, { type: "kill", spawn: "rat" });
  let layout = locationLayout(a, "cellar", { ...opts, progress: p }).layout;
  assert.deepEqual(layout.tokens.map((t) => t.id), ["goblin"]);
  assert.equal(layout.tokens[0]!.assetId, "token_goblin");
  assert.deepEqual(validateLayout(layout, MANIFEST, { cx: 0, cy: 0 }), { ok: true });

  // One rat dead out of three: the two living keep their own tokens.
  p = play(a, startProgress(a), { type: "kill", spawn: "rat_2" });
  layout = locationLayout(a, "cellar", { ...opts, progress: p }).layout;
  assert.deepEqual(layout.tokens.map((t) => t.id), ["rat_1", "rat_3"]);

  // A shut exit is not an open edge exit: the room is sealed on purpose.
  const gated = fixture();
  gated.locations[0]!.exits[0]!.requires = { has: "old_key" };
  gated.locations[0]!.exits[0]!.lockedText = "The trapdoor is locked.";
  const shut = locationLayout(gated, "tavern", opts);
  assert.deepEqual(shut.layout.exits, []);
  assert.equal(shut.layout.sealed, true);
  assert.deepEqual(shut.exitsAt.cellar_stairs, { x: 10, y: CELL_HEIGHT - 1 });
  const opened = locationLayout(gated, "tavern", { ...opts, progress: play(gated, startProgress(gated), { type: "gain", item: "old_key" }) });
  assert.deepEqual(opened.layout.exits, [{ at: { x: 10, y: CELL_HEIGHT - 1 }, edge: "S", toCell: { cx: 0, cy: 1 } }]);
  assert.equal(opened.layout.sealed, undefined);
});

test("locationLayout marks the start and places an NPC as an npc token", () => {
  const a = fixture();
  const r = locationLayout(a, "tavern", { walkable: (t) => t === "floor_stone" });
  assert.deepEqual(r.start, { x: 5, y: 5 });
  assert.deepEqual(r.layout.tokens, [{ id: "innkeeper_spawn", assetId: "token_villager", x: 8, y: 5, kind: "npc" }]);
});

test("locationLayout puts boundary exits next to the right neighbour cell", () => {
  const a = fixture();
  const r = locationLayout(a, "cellar", { cell: { cx: 4, cy: 2 } });
  assert.deepEqual(r.layout.exits[0]!.toCell, { cx: 4, cy: 1 });
});

test("exitDestination says where an exit leaves the party", () => {
  const a = fixture();
  assert.deepEqual(exitDestination(a, "tavern", "cellar_stairs"), { locationId: "cellar", at: { x: 10, y: 0 } });
  assert.deepEqual(exitDestination(a, "cellar", "stairs_up"), { locationId: "tavern", at: { x: 10, y: CELL_HEIGHT - 1 } });
  assert.equal(exitDestination(a, "tavern", "nope"), undefined);
  a.locations[1]!.exits[0]!.arriveAt = "start";
  a.locations[0]!.map.legend["@"]!.start = true;
  assert.deepEqual(exitDestination(a, "cellar", "stairs_up"), { locationId: "tavern", at: { x: 5, y: 5 } });
});

test("locationLayout refuses a broken map in plain words", () => {
  const a = fixture();
  a.locations[1]!.map.rows.pop();
  assert.throws(() => locationLayout(a, "cellar"), /exactly 15 rows of 20 characters/);
  assert.throws(() => locationLayout(fixture(), "moon"), /no location "moon"/);
  const b = fixture();
  put(b.locations[1]!.map.rows, 4, 4, "?");
  assert.throws(() => locationLayout(b, "cellar"), /legend does not define/);
});
