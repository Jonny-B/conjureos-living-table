/**
 * Tests for the adventure authoring format (src/games/livingtable/adventures/markdown.ts):
 * the template parses and validates, the writer and the parser are inverses,
 * the plain-word condition phrasings parse strictly, and every kind of mistake
 * is reported on the right line with a message that says what was expected.
 *
 * Run: npx -y tsx --test test/livingtable-adventures-markdown.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CONDITION_PHRASES,
  adventureToMarkdown,
  markedForReview,
  parseAdventureMarkdown,
  parseConditionPhrase,
  slugify,
  type ConditionContext,
  type MarkdownIssue,
} from "../src/games/livingtable/adventures/markdown";
import { validateAdventure } from "../src/games/livingtable/adventures/validate";
import type { Adventure, Condition } from "../src/games/livingtable/adventures/types";
import { gameAssets } from "../scripts/adventures/check";
import { CELL_HEIGHT, CELL_WIDTH } from "../src/games/livingtable/world";

const TEMPLATE = readFileSync(new URL("../adventures/TEMPLATE.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");

// ---------------------------------------------------------------------------
// Helpers

/** Replace the one line that equals `exact` (or delete it when `replacement` is null). Returns the new text and the 1-based line it was on. */
function edit(text: string, exact: string, replacement: string | null, nth = 0): { text: string; line: number } {
  const lines = text.split("\n");
  let seen = -1;
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === exact && ++seen === nth) {
      idx = i;
      break;
    }
  }
  assert.ok(idx >= 0, `the template has no line "${exact}"`);
  if (replacement === null) lines.splice(idx, 1);
  else lines[idx] = replacement;
  return { text: lines.join("\n"), line: idx + 1 };
}

function lineOf(text: string, exact: string, nth = 0): number {
  const lines = text.split("\n");
  let seen = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i] === exact && ++seen === nth) return i + 1;
  throw new Error(`no line "${exact}"`);
}

function hasIssue(issues: MarkdownIssue[], line: number, re: RegExp): boolean {
  return issues.some((i) => i.line === line && re.test(i.message));
}

function show(issues: MarkdownIssue[]): string {
  return issues.map((i) => `line ${i.line}: ${i.message}`).join("\n");
}

function expectError(text: string, line: number, re: RegExp): void {
  const r = parseAdventureMarkdown(text);
  assert.equal(r.adventure, null, "a file with an error gives no adventure");
  assert.ok(hasIssue(r.errors, line, re), `expected an error matching ${re} on line ${line}, got:\n${show(r.errors)}`);
}

function parseOk(text: string): Adventure {
  const r = parseAdventureMarkdown(text);
  assert.deepEqual(r.errors, [], show(r.errors));
  assert.ok(r.adventure);
  return r.adventure!;
}

// ---------------------------------------------------------------------------
// The template

test("TEMPLATE.md parses with no errors and no warnings", () => {
  const r = parseAdventureMarkdown(TEMPLATE, { file: "TEMPLATE.md" });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.ok(r.adventure);
  assert.equal(r.adventure!.id, "cupboard_goblin");
  assert.equal(r.adventure!.author, "owner");
});

test("TEMPLATE.md validates against the game's real tiles, props, tokens and bestiary", () => {
  const a = parseOk(TEMPLATE);
  const v = validateAdventure(a, gameAssets());
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.warnings, []);
});

test("the template says what it must: no armor, a plain weapon per class, no potions", () => {
  const a = parseOk(TEMPLATE);
  for (const k of ["fighter", "rogue", "wizard"] as const) {
    assert.equal(a.startingKit[k]?.armor, "none");
    assert.equal(a.startingKit[k]?.potions, 0);
    assert.match(a.startingKit[k]?.weaponNote ?? "", /^a plain /);
  }
});

test("the template's comments are ignored and the review markers are found", () => {
  assert.deepEqual(markedForReview(TEMPLATE), []);
  const marked = TEMPLATE.replace("## Summary", "<!-- ADDED: this whole section is a guess -->\n## Summary");
  assert.equal(markedForReview(marked).length, 1);
  assert.match(markedForReview(marked)[0]!.text, /^ADDED/);
  assert.deepEqual(parseAdventureMarkdown(marked).errors, []);
  // A comment may span lines and hide a whole block.
  const hidden = TEMPLATE.replace("## DM never", "<!--\n## Nonsense heading\n- a bullet\n-->\n## DM never");
  assert.deepEqual(parseAdventureMarkdown(hidden).errors, []);
});

// ---------------------------------------------------------------------------
// Round trips

test("round trip: parse, write, parse gives the same adventure, and writing is stable", () => {
  const a = parseOk(TEMPLATE);
  const md = adventureToMarkdown(a);
  const again = parseAdventureMarkdown(md);
  assert.deepEqual(again.errors, []);
  assert.deepEqual(again.adventure, a);
  assert.equal(adventureToMarkdown(again.adventure!), md);
  assert.deepEqual(validateAdventure(again.adventure!, gameAssets()).errors, []);
});

function walledRows(): string[] {
  return Array.from({ length: CELL_HEIGHT }, (_, y) => (y === 0 || y === CELL_HEIGHT - 1 ? "#".repeat(CELL_WIDTH) : "#" + ".".repeat(CELL_WIDTH - 2) + "#"));
}
function put(rows: string[], x: number, y: number, ch: string): void {
  const r = rows[y]!;
  rows[y] = r.slice(0, x) + ch + r.slice(x + 1);
}

/** An adventure that uses every part of the model, with awkward names and every kind of condition. */
function rich(): Adventure {
  const tavern = walledRows();
  put(tavern, 5, 5, "@");
  put(tavern, 8, 5, "I");
  put(tavern, 10, CELL_HEIGHT - 1, "D");
  put(tavern, 12, 4, "|");
  put(tavern, 13, 4, "=");
  put(tavern, 14, 4, "1");
  const cellar = walledRows();
  put(cellar, 10, 0, "U");
  put(cellar, 8, 7, "r");
  put(cellar, 14, 10, "g");
  put(cellar, 3, 3, "b");
  put(cellar, 6, 6, "$");
  return {
    id: "rich_one",
    title: "The Rich Adventure",
    version: 3,
    author: "ai",
    summary: "First paragraph of the summary.\n\nSecond paragraph, after a blank line.",
    levelRange: [2, 4],
    tone: "Warm, with teeth: not too grim.",
    truths: ["The tavern is called the Gilded Pony.", "Rats come from a tunnel."],
    dmMust: ["Keep the goblin silent."],
    dmNever: ["Never let Marta leave the tavern."],
    hooks: { default: "You are an apprentice.", fighter: "You are known for brawn.", rogue: "You are known for quick hands.", wizard: "You have a talent for sparks.", cleric: "You tend the sick." },
    startingKit: {
      default: { armor: "none", items: [], potions: 0 },
      fighter: { armor: "none", weaponNote: "a plain sword", items: ["Bread heel", "old_key"], potions: 0 },
      cleric: { armor: "class", items: [], potions: 2 },
    },
    locations: [
      {
        id: "tavern",
        name: "The Gilded Pony",
        readAloud: "A low room smelling of woodsmoke.\n\nA fire pops in the grate.",
        dmNotes: "The trapdoor is behind the bar.",
        map: {
          rows: tavern,
          legend: {
            "#": { tile: "wall_stone" },
            ".": { tile: "floor_stone" },
            "@": { tile: "floor_stone", start: true },
            I: { tile: "floor_stone", spawn: "innkeeper_spawn" },
            D: { tile: "floor_stone", prop: "door_open", exit: "cellar_stairs" },
            "|": { tile: "floor_stone", prop: "torch" },
            "=": { tile: "floor_dirt" },
            "1": { tile: "floor_sand" },
          },
        },
        features: [],
        spawns: [{ id: "innkeeper_spawn", creature: "token_villager", hostile: false, awake: true, npcId: "innkeeper" }],
        exits: [{ id: "cellar_stairs", to: "cellar", arriveAt: "stairs_up", label: "Trapdoor down" }],
      },
      {
        id: "cellar",
        name: "The Cellar (lower)",
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
            $: { tile: "floor_stone", prop: "chest_open", feature: "strongbox" },
          },
        },
        features: [
          { id: "barrel", name: "A split barrel", description: "A barrel with its side gnawed through.", secret: "A rusted key lies in the dregs.", searchDc: 12, gives: ["old_key"], once: true },
          { id: "strongbox", name: "Strongbox", description: "Bolted to the floor.", once: false },
        ],
        spawns: [
          { id: "rat", creature: "giant-rat", count: 3, hostile: true, awake: true },
          { id: "goblin", creature: "goblin", hostile: true, awake: false, appearsWhen: { any: [{ flag: "tunnel_seen" }, { entered: "cellar" }] } },
        ],
        exits: [{ id: "stairs_up", to: "tavern", arriveAt: "cellar_stairs", label: "Stairs up", requires: { not: { flag: "sealed" } }, lockedText: "Something has sealed the stairs." }],
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
        knows: ["The scratching started a week ago.", "The cellar door sticks."],
        secrets: ["She heard digging at night.", "She owes the goblin nothing."],
        voice: "Quick, motherly.",
        location: "tavern",
      },
    ],
    items: [
      { id: "old_key", name: "Old key", description: "A rusted iron key.", quest: true, usable: true, useSay: "The lock gives with a groan." },
      { id: "salt", name: "Salt and Pepper", description: "A pair of shakers.", quest: false, usable: false },
      { id: "key_brass", name: "Key (brass)", description: "Small and bright." },
    ],
    scenes: [
      {
        id: "s1",
        title: "Rats in the cellar and the goblin",
        location: "tavern",
        opening: "Marta wrings her apron.\n\n\"Please,\" she says.",
        objectives: [
          { id: "talk", text: "Speak with Marta.", doneWhen: { talkedTo: "innkeeper" } },
          { id: "rats", text: "Clear the rats.", doneWhen: { killed: "all:rat" } },
          { id: "tunnel", text: "Find where they come from.", hidden: true, doneWhen: { flag: "tunnel_seen" } },
          { id: "prep", text: "Get ready.", hidden: false, doneWhen: { all: [{ objective: "talk" }, { any: [{ has: "old_key" }, { has: "key_brass" }] }, { not: { has: "salt" } }] } },
        ],
        beats: [
          { id: "b_quiet", when: { killed: "rat" }, narrate: "The scratching stops.", setFlags: ["cellar_quiet", "second_flag"], spawn: ["goblin"], give: ["a handful of coins", "old_key"] },
          { id: "b_hint", when: { flag: "cellar_quiet" }, narrate: "Something shuffles behind the wall.", once: false },
          { id: "b_silent", when: { all: [{ entered: "cellar" }, { killed: "rat_2" }, { talkedTo: "innkeeper" }] }, setFlags: ["tunnel_seen"], once: true },
        ],
        next: [
          { scene: "s2", when: { killed: "goblin" } },
          { scene: "s3", when: { any: [{ flag: "fled" }, { all: [{ flag: "a" }, { flag: "b" }] }] } },
        ],
      },
      {
        id: "s2",
        title: "When the rats leave",
        opening: "The cellar is quiet at last.",
        objectives: [],
        beats: [],
        next: [{ scene: "s1", when: { always: true } }],
        ending: { text: "Marta presses coins into your hand.", outcome: "continue" },
      },
      { id: "s3", title: "Run away", objectives: [], beats: [], next: [], ending: { text: "You flee, and the village forgets your name.", outcome: "defeat" } },
    ],
    start: { sceneId: "s1", locationId: "tavern", at: { x: 5, y: 5 } },
  };
}

test("round trip: a model that uses everything survives write then parse unchanged", () => {
  const a = rich();
  const md = adventureToMarkdown(a);
  const r = parseAdventureMarkdown(md);
  assert.deepEqual(r.errors, [], `${show(r.errors)}\n---\n${md}`);
  assert.deepEqual(r.adventure, a);
  assert.equal(adventureToMarkdown(r.adventure!), md);
});

test("round trip: a start square that differs from the marked one is written and read back", () => {
  const a = rich();
  a.start = { sceneId: "s1", locationId: "tavern", at: { x: 6, y: 5 } };
  const md = adventureToMarkdown(a);
  assert.match(md, /- start at: 7, 6/);
  assert.deepEqual(parseOk(md).start, a.start);
  const b = rich();
  b.start = { sceneId: "s3", locationId: "cellar", at: { x: 10, y: 0 } };
  const md2 = adventureToMarkdown(b);
  assert.match(md2, /- start scene: Run away/);
  assert.match(md2, /- start location: /);
  assert.deepEqual(parseOk(md2).start, b.start);
});

test("round trip: names that cannot be told apart fall back to ids in conditions", () => {
  const a = rich();
  a.items.push({ id: "other", name: "Old key", description: "A second key with the same name." });
  a.scenes[0]!.objectives[3]!.doneWhen = { all: [{ has: "old_key" }, { has: "other" }, { has: "key_brass" }] };
  const md = adventureToMarkdown(a);
  const parsed = parseOk(md);
  assert.deepEqual(parsed.scenes[0]!.objectives[3]!.doneWhen, a.scenes[0]!.objectives[3]!.doneWhen);
});

test("the writer collapses stray line breaks inside single-line text and keeps paragraph breaks", () => {
  const a = rich();
  a.truths = ["one\nline broken"];
  a.locations[0]!.readAloud = "para one\nstill para one\n\npara two";
  const back = parseOk(adventureToMarkdown(a));
  assert.deepEqual(back.truths, ["one line broken"]);
  assert.equal(back.locations[0]!.readAloud, "para one still para one\n\npara two");
});

test("slugify turns a name into the id used when no id line is given", () => {
  assert.equal(slugify("The Rat Cellar"), "rat_cellar");
  assert.equal(slugify("Marta"), "marta");
  assert.equal(slugify("Door to the storeroom"), "door_to_the_storeroom");
  assert.equal(slugify("Hobb's Shop"), "hobb_s_shop");
  assert.equal(slugify("A"), "a");
  assert.equal(slugify("!!!"), "");
});

// ---------------------------------------------------------------------------
// Conditions

const CTX: ConditionContext = {
  locations: [{ id: "tunnel", names: ["The Tunnel"] }, { id: "tavern", names: ["The Gilded Pony"] }],
  npcs: [{ id: "marta", names: ["Marta"] }],
  items: [{ id: "brass_key", names: ["Brass key"] }, { id: "salt", names: ["Salt and Pepper"] }, { id: "pepper", names: ["Pepper"] }],
  objectives: [{ id: "find_way", names: ["Find the way in"] }],
};
const cond = (s: string): Condition => parseConditionPhrase(s, CTX);

test("conditions: every documented phrasing parses to the right condition", () => {
  assert.deepEqual(cond("always"), { always: true });
  assert.deepEqual(cond("when always"), { always: true });
  assert.deepEqual(cond("never"), { any: [] });
  assert.deepEqual(cond("when the flag rats_cleared is set"), { flag: "rats_cleared" });
  assert.deepEqual(cond("the flag rats_cleared is not set"), { not: { flag: "rats_cleared" } });
  assert.deepEqual(cond("when every spawn starting with rat is killed"), { killed: "all:rat" });
  assert.deepEqual(cond("every spawn starting with rat is dead"), { killed: "all:rat" });
  assert.deepEqual(cond("the spawn goblin is killed"), { killed: "goblin" });
  assert.deepEqual(cond("the creature rat_2 is killed"), { killed: "rat_2" });
  assert.deepEqual(cond("when the player enters the tunnel"), { entered: "tunnel" });
  assert.deepEqual(cond("the player enters The Tunnel"), { entered: "tunnel" });
  assert.deepEqual(cond("the player has entered tunnel"), { entered: "tunnel" });
  assert.deepEqual(cond("the party enters the tunnel"), { entered: "tunnel" });
  assert.deepEqual(cond("when the player talks to Marta"), { talkedTo: "marta" });
  assert.deepEqual(cond("the player has talked to marta"), { talkedTo: "marta" });
  assert.deepEqual(cond("the player speaks to Marta"), { talkedTo: "marta" });
  assert.deepEqual(cond("when the player has the brass key"), { has: "brass_key" });
  assert.deepEqual(cond("the player has brass_key"), { has: "brass_key" });
  assert.deepEqual(cond("the objective find_way is done"), { objective: "find_way" });
  assert.deepEqual(cond("the objective Find the way in is complete"), { objective: "find_way" });
});

test("conditions: and, or, not and parentheses", () => {
  assert.deepEqual(cond("the flag a is set and the player has the brass key"), { all: [{ flag: "a" }, { has: "brass_key" }] });
  assert.deepEqual(cond("the flag a is set or the flag b is set or the flag c is set"), { any: [{ flag: "a" }, { flag: "b" }, { flag: "c" }] });
  assert.deepEqual(cond("not the player has the brass key"), { not: { has: "brass_key" } });
  assert.deepEqual(cond("not (the flag a is set or the flag b is set)"), { not: { any: [{ flag: "a" }, { flag: "b" }] } });
  assert.deepEqual(cond("(the flag a is set or the flag b is set) and the player enters the tunnel"), {
    all: [{ any: [{ flag: "a" }, { flag: "b" }] }, { entered: "tunnel" }],
  });
  assert.deepEqual(cond("the flag a is set and (the flag b is set and the flag c is set)"), { all: [{ flag: "a" }, { all: [{ flag: "b" }, { flag: "c" }] }] });
  assert.deepEqual(cond("(the flag a is set)"), { flag: "a" });
});

test("conditions: a name that contains 'and' is matched whole, longest first", () => {
  assert.deepEqual(cond("the player has Salt and Pepper"), { has: "salt" });
  assert.deepEqual(cond("the player has Salt and Pepper and the flag a is set"), { all: [{ has: "salt" }, { flag: "a" }] });
  assert.deepEqual(cond("the player has Pepper and the flag a is set"), { all: [{ has: "pepper" }, { flag: "a" }] });
});

test("conditions: a trailing full stop and any capitalisation are fine", () => {
  assert.deepEqual(cond("THE PLAYER TALKS TO MARTA."), { talkedTo: "marta" });
  assert.deepEqual(cond("  when   the flag x is set ;"), { flag: "x" });
});

test("conditions: mistakes throw a message that says what was expected", () => {
  assert.throws(() => cond("the flag a is set and the flag b is set or the flag c is set"), /mixed without parentheses/);
  assert.throws(() => cond("the player talks to Bob"), /name or id of an NPC.*Defined: Marta/);
  assert.throws(() => cond("the player has the sword"), /name or id of an item.*Brass key/);
  assert.throws(() => cond("the player enters the swamp"), /name or id of a location.*The Tunnel/);
  assert.throws(() => cond("the player chats with Marta"), /do not recognise the phrase starting at "the player chats with Marta"/);
  assert.throws(() => cond("the flag a"), /expected "is"/);
  assert.throws(() => cond("the flag a is set the flag b is set"), /unexpected "the"/);
  assert.throws(() => cond("(the flag a is set"), /expected "\)"/);
  assert.throws(() => cond("every spawn starting with is killed"), /not a spawn id prefix|expected/);
  assert.throws(() => cond(""), /condition is empty/);
  assert.throws(() => cond("the flag a is set and"), /ends too early/);
  assert.throws(() => cond("the flag two words is set"), /expected "is"/);
});

test("conditions: the documented list of phrasings is exported", () => {
  assert.ok(CONDITION_PHRASES.includes("the player talks to NPC"));
  assert.ok(CONDITION_PHRASES.includes("every spawn starting with PREFIX is killed"));
});

test("conditions: every kind round-trips through the writer, by name when it can", () => {
  const a = rich();
  const kinds: Condition[] = [
    { always: true },
    { any: [] },
    { flag: "x" },
    { not: { flag: "x" } },
    { killed: "goblin" },
    { killed: "rat_3" },
    { killed: "all:ra" },
    { entered: "cellar" },
    { talkedTo: "innkeeper" },
    { has: "salt" },
    { has: "key_brass" },
    { objective: "talk" },
    { not: { all: [{ flag: "a" }, { flag: "b" }] } },
    { all: [{ flag: "a" }, { any: [{ flag: "b" }, { not: { has: "salt" } }] }] },
  ];
  a.scenes[0]!.beats = kinds.map((c, i) => ({ id: `kb_${i}`, when: c, setFlags: [`kf_${i}`] }));
  const md = adventureToMarkdown(a);
  const back = parseOk(md);
  assert.deepEqual(back.scenes[0]!.beats.map((b) => b.when), kinds);
  assert.match(md, /the player talks to Marta/);
  assert.match(md, /the player has Salt and Pepper/);
});

// ---------------------------------------------------------------------------
// Error cases: each one reports the right line

test("error: the title must come first", () => {
  const e = edit(TEMPLATE, "# The Cupboard Goblin", "The Cupboard Goblin");
  expectError(e.text, e.line, /Expected the adventure title first/);
  expectError("", 1, /Expected the adventure title first/);
  expectError("## Summary\n\nHi.\n", 1, /Expected the adventure title first|title/);
});

test("error: a second title", () => {
  const e = edit(TEMPLATE, "## Summary", "# Another Title\n\n## Summary");
  expectError(e.text, e.line, /only one title/);
});

test("error: an unknown section, with a suggestion", () => {
  const e = edit(TEMPLATE, "## Truths", "## Truth Table");
  expectError(e.text, e.line, /not a section I know/);
  const f = edit(TEMPLATE, "## DM must", "## DM mustt");
  expectError(f.text, f.line, /Did you mean "dm must"/);
});

test("error: a duplicated section and a deep heading", () => {
  const dupe = edit(TEMPLATE, "## DM never", "## DM must\n\n- again\n\n## DM never");
  expectError(dupe.text, lineOf(dupe.text, "## DM must", 1), /appears twice \(first on line \d+\)/);
  const deep = edit(TEMPLATE, "## Truths", "#### too deep\n## Truths");
  expectError(deep.text, deep.line, /go down to three/);
});

test("error: an unknown field gets a did-you-mean and the list of real fields", () => {
  const e = edit(TEMPLATE, "- role: shopkeeper", "- roll: shopkeeper");
  expectError(e.text, e.line, /"roll" is not a field for an NPC\. Did you mean "role"\?.*fields here are: id, role/);
});

test("error: a missing required field is reported on the heading", () => {
  const e = edit(TEMPLATE, "- token: token_villager", null);
  expectError(e.text, lineOf(e.text, "## NPC: Hobb"), /Expected a "token:" line here/);
  const f = edit(TEMPLATE, "- armor: none", null);
  expectError(f.text, lineOf(f.text, "### fighter"), /Expected a "armor:" line/);
  const g = edit(TEMPLATE, "- done when: the player talks to Hobb", null);
  expectError(g.text, lineOf(g.text, "### Objective: Talk to Hobb"), /"done when:"/);
  const h = edit(TEMPLATE, "- creature: goblin", null);
  expectError(h.text, lineOf(h.text, "### Spawn: goblin"), /"creature:"/);
});

test("error: a field with no value, a repeated field, plain text where a field belongs", () => {
  const empty = edit(TEMPLATE, "- role: shopkeeper", "- role:");
  expectError(empty.text, empty.line, /"role:" needs a value/);
  const twice = edit(TEMPLATE, "- role: shopkeeper", "- role: shopkeeper\n- role: baker");
  expectError(twice.text, twice.line + 1, /"role:" appears twice .*first on line \d+/);
  const plain = edit(TEMPLATE, "- role: shopkeeper", "- role: shopkeeper\nHe has a big nose.");
  expectError(plain.text, plain.line + 1, /plain text/);
});

test("error: yes or no, whole numbers, ids, levels, author", () => {
  const b = edit(TEMPLATE, "- hostile: yes", "- hostile: maybe");
  expectError(b.text, b.line, /Expected yes or no, but found "maybe"/);
  const n = edit(TEMPLATE, "- search dc: 10", "- search dc: ten");
  expectError(n.text, n.line, /Expected a whole number, but found "ten"/);
  const v = edit(TEMPLATE, "- version: 1", "- version: one");
  expectError(v.text, v.line, /whole number/);
  const l = edit(TEMPLATE, "- levels: 1 to 1", "- levels: low");
  expectError(l.text, l.line, /Expected levels like "1 to 3"/);
  const au = edit(TEMPLATE, "- author: owner", "- author: bob");
  expectError(au.text, au.line, /"owner" or "ai"/);
  const id = edit(TEMPLATE, "- id: shop", "- id: the shop");
  expectError(id.text, id.line, /An id uses only letters/);
  const outcome = edit(TEMPLATE, "- outcome: victory", "- outcome: win");
  expectError(outcome.text, outcome.line, /victory, defeat or continue/);
  const armor = edit(TEMPLATE, "- armor: none", "- armor: heavy");
  expectError(armor.text, armor.line, /"none".*"class"/);
});

test("error: references to things that do not exist name the line and list what does", () => {
  const to = edit(TEMPLATE, "- to: The Storeroom", "- to: The Cellar");
  expectError(to.text, to.line, /"The Cellar" is not a location in this file\. Defined: .*Hobb's Shop/);
  const arrive = edit(TEMPLATE, "- arrive at: Door to the shop", "- arrive at: Back stairs");
  expectError(arrive.text, arrive.line, /not an exit of The Storeroom/);
  const where = edit(TEMPLATE, "- location: Hobb's Shop", "- location: The Moon", 0);
  expectError(where.text, where.line, /"The Moon" is not a location/);
  const npc = edit(TEMPLATE, "- npc: Hobb", "- npc: Bob");
  expectError(npc.text, npc.line, /"Bob" is not an NPC in this file\. Defined: Hobb/);
  const legend = edit(TEMPLATE, "- `H` = floor_stone, spawn hobb", "- `H` = floor_stone, spawn nobody");
  expectError(legend.text, legend.line, /"nobody" is not a spawn of this location/);
  const feat = edit(TEMPLATE, "- `c` = floor_stone, prop chest, feature counter_drawer", "- `c` = floor_stone, prop chest, feature drawerr");
  expectError(feat.text, feat.line, /"drawerr" is not a feature of this location/);
  const next = edit(TEMPLATE, "- Quiet at last when the flag goblin_gone is set", "- Nowhere when the flag goblin_gone is set");
  expectError(next.text, next.line, /Expected "<scene> when <condition>" with a scene defined in this file\. Scenes: .*quiet/);
  const flagless = edit(TEMPLATE, "- Quiet at last when the flag goblin_gone is set", "- Quiet at last when");
  expectError(flagless.text, flagless.line, /Expected a condition after "when"/);
  const sceneLoc = edit(TEMPLATE, "- location: Hobb's Shop", "- location: Nowhere", 1);
  expectError(sceneLoc.text, sceneLoc.line, /"Nowhere" is not a location/);
  const spawnRef = edit(TEMPLATE, "- sets flag: goblin_gone", "- sets flag: goblin_gone\n- spawns: dragon");
  expectError(spawnRef.text, spawnRef.line + 1, /"dragon" is not a spawn in this file/);
});

test("error: a condition that cannot be read is reported on its own line", () => {
  const e = edit(TEMPLATE, "- done when: the player talks to Hobb", "- done when: the player chats with Hobb");
  expectError(e.text, e.line, /could not read the condition "the player chats with Hobb"/);
  const f = edit(TEMPLATE, "- done when: the player talks to Hobb", "- done when: the player talks to Bob");
  expectError(f.text, f.line, /name or id of an NPC.*Defined: Hobb/);
  const g = edit(TEMPLATE, "- when: the player enters The Storeroom", "- when: the player enters the cave");
  expectError(g.text, g.line, /name or id of a location/);
  const h = edit(TEMPLATE, "- open when: the player has the brass key", "- open when: the player has the sword");
  expectError(h.text, h.line, /name or id of an item.*Brass key/);
  const i = edit(TEMPLATE, "- done when: the player talks to Hobb", "- done when: the flag a is set and the flag b is set or the flag c is set");
  expectError(i.text, i.line, /mixed without parentheses/);
  const j = edit(TEMPLATE, "- Quiet at last when the flag goblin_gone is set", "- Quiet at last when the flag goblin_gone");
  expectError(j.text, j.line, /expected "is"|expected "set"|the end of the condition/);
});

test("error: duplicate ids", () => {
  const e = edit(TEMPLATE, "- id: storeroom", "- id: shop");
  expectError(e.text, lineOf(e.text, "## Location: The Storeroom"), /Two locations would have the id "shop" \(the other is on line \d+\)/);
  const s = edit(TEMPLATE, "### Spawn: goblin", "### Spawn: hobb");
  expectError(s.text, s.line, /Two spawns would have the id "hobb"/);
  const o = edit(TEMPLATE, "- id: key", "- id: talk");
  expectError(o.text, lineOf(o.text, "### Objective: Find a way into the storeroom"), /Two objectives would have the id "talk"/);
});

test("error: a heading that is not a sub-section", () => {
  const e = edit(TEMPLATE, "### Legend", "### Legends and such", 0);
  expectError(e.text, e.line, /not a sub-section of a location/);
  const s = edit(TEMPLATE, "### Next", "### Nxt");
  expectError(s.text, s.line, /not a sub-section of a scene\. Did you mean "next"/);
  const k = edit(TEMPLATE, "### wizard", "### paladin");
  expectError(k.text, k.line, /"paladin" is not a class/);
  const n = edit(TEMPLATE, "- knows: A spare key lives somewhere near the till.", "- knows: A spare key lives somewhere near the till.\n\n### Notes");
  expectError(n.text, lineOf(n.text, "### Notes"), /An NPC has no ### sub-sections/);
});

test("error: read-aloud text is required and must be a quote", () => {
  const e = edit(TEMPLATE, "> Cold air and the smell of old flour. Something small shifts in the dark between the crates.", null);
  expectError(e.text, lineOf(e.text, "## Location: The Storeroom"), /Expected the read-aloud text here/);
  const f = edit(TEMPLATE, "> Cold air and the smell of old flour. Something small shifts in the dark between the crates.", "Cold air and the smell of old flour.");
  expectError(f.text, f.line, /plain text.*read aloud goes in a quote/);
  const g = edit(TEMPLATE, "> Hobb pumps your hand until you worry it will come off.", "> Hobb pumps your hand.\n> Twice.");
  assert.deepEqual(parseAdventureMarkdown(g.text).errors, []);
});

test("error: a missing summary and a missing scene or location", () => {
  const e = edit(TEMPLATE, "## Summary", "## Overview");
  expectError(e.text, e.line, /not a section I know/);
  const noSummary = TEMPLATE.replace(/## Summary\n\n.*\n\n/, "");
  expectError(noSummary, 1, /Expected a ## Summary section/);
  const noScene = TEMPLATE.split("## Scene: Hobb's trouble")[0]!;
  expectError(noScene, 1, /at least one ## Scene/);
});

// ---------------------------------------------------------------------------
// Maps and legends

const SHOP_ROW = "#.....H....c.......#";

test("map: a row that is too short, too long, or has a space names its own line", () => {
  const short = edit(TEMPLATE, SHOP_ROW, "#.....H....c......#");
  expectError(short.text, short.line, /has 19 characters but needs exactly 20 \(1 too few\)/);
  const wide = edit(TEMPLATE, SHOP_ROW, "#.....H....c........#");
  expectError(wide.text, wide.line, /has 21 characters but needs exactly 20 \(1 too many\)/);
  const space = edit(TEMPLATE, SHOP_ROW, "#.....H.. .c.......#");
  expectError(space.text, space.line, /Column 10 of this map row is a space/);
  const trailing = edit(TEMPLATE, SHOP_ROW, SHOP_ROW + "  ");
  expectError(trailing.text, trailing.line, /ends with 2 space\(s\)/);
  const unicode = edit(TEMPLATE, SHOP_ROW, "#.....H....c......é#");
  expectError(unicode.text, unicode.line, /not a plain keyboard character/);
});

test("map: too many rows and too few rows", () => {
  const extra = edit(TEMPLATE, SHOP_ROW, SHOP_ROW + "\n#..................#");
  const lastRowLine = lineOf(extra.text, "#########D##########");
  expectError(extra.text, lastRowLine, /has 16 rows but needs exactly 15\. Remove row 16 onward/);
  const fewer = edit(TEMPLATE, SHOP_ROW, null);
  expectError(fewer.text, lineOf(fewer.text, "```", 0), /has 14 rows but needs exactly 15\. Add 1 more/);
  const two = edit(edit(TEMPLATE, SHOP_ROW, null).text, "#....@.............#", null);
  expectError(two.text, lineOf(two.text, "```", 0), /has 13 rows but needs exactly 15\. Add 2 more/);
  const none = edit(TEMPLATE, "### Map", "### Map\n\nNo map yet.", 0);
  expectError(none.text, lineOf(none.text, "No map yet."), /Only the map belongs under ### Map/);
});

test("map: size errors use the engine's real dimensions", () => {
  assert.equal(CELL_WIDTH, 20);
  assert.equal(CELL_HEIGHT, 15);
  assert.equal(SHOP_ROW.length, CELL_WIDTH);
});

test("map: a forgotten closing fence is found before the next heading, and there is one map per location", () => {
  const FENCE = "```";
  const noClose = TEMPLATE.replace(`#########D##########\n${FENCE}\n`, "#########D##########\n");
  assert.notEqual(noClose, TEMPLATE);
  const r = parseAdventureMarkdown(noClose);
  assert.equal(r.adventure, null);
  assert.ok(hasIssue(r.errors, lineOf(noClose, FENCE, 0), /not closed before the heading on line \d+/), show(r.errors));
  const atEnd = `${TEMPLATE}\n${FENCE}\n#####\n`;
  assert.ok(parseAdventureMarkdown(atEnd).errors.some((e) => /never closed/.test(e.message)));
  const second = edit(TEMPLATE, "### Legend", `${FENCE}\n#\n${FENCE}\n\n### Legend`, 0);
  expectError(second.text, lineOf(second.text, FENCE, 2), /second code block/);
});

test("map: a character the legend does not define is reported on the row", () => {
  const e = edit(TEMPLATE, SHOP_ROW, "#.....H..?.c.......#");
  expectError(e.text, e.line, /Column 10 of this map row uses "\?", which the ### Legend does not define/);
});

test("legend: bad lines are explained", () => {
  const noTick = edit(TEMPLATE, "- `#` = wall_stone", "- # = wall_stone", 0);
  expectError(noTick.text, noTick.line, /Expected a legend line like/);
  const dup = edit(TEMPLATE, "- `.` = floor_stone", "- `#` = floor_stone", 0);
  expectError(dup.text, dup.line, /already in the legend \(line \d+\)/);
  const nothing = edit(TEMPLATE, "- `t` = floor_stone, prop torch", "- `t` = prop torch");
  expectError(nothing.text, nothing.line, /Did not understand "prop torch"|Expected the floor tile first/);
  const junk = edit(TEMPLATE, "- `t` = floor_stone, prop torch", "- `t` = floor_stone, shiny");
  expectError(junk.text, junk.line, /Did not understand "shiny"/);
  const twice = edit(TEMPLATE, "- `t` = floor_stone, prop torch", "- `t` = floor_stone, prop torch, prop chest");
  expectError(twice.text, twice.line, /"prop" is given twice/);
  const space = edit(TEMPLATE, "- `t` = floor_stone, prop torch", "- ` ` = floor_stone");
  expectError(space.text, space.line, /one visible keyboard character/);
});

test("legend: tile and prop ids and 'start' are read in any order", () => {
  const swapped = edit(TEMPLATE, "- `c` = floor_stone, prop chest, feature counter_drawer", "- `c` = tile floor_stone, feature Counter drawer, prop chest");
  const a = parseOk(swapped.text);
  assert.deepEqual(a.locations[0]!.map.legend.c, { tile: "floor_stone", prop: "chest", feature: "counter_drawer" });
  const start = edit(TEMPLATE, "- `@` = floor_stone, start", "- `@` = floor_stone, START");
  assert.equal(parseOk(start.text).locations[0]!.map.legend["@"]!.start, true);
});

test("start: the hero's start square must be marked once, or given", () => {
  const none = edit(TEMPLATE, "- `@` = floor_stone, start", "- `@` = floor_stone");
  expectError(none.text, lineOf(none.text, "## Location: Hobb's Shop"), /exactly one legend character there must be marked "start".*has 0/);
  const given = edit(none.text, "- levels: 1 to 1", "- levels: 1 to 1\n- start at: 6, 12");
  assert.deepEqual(parseOk(given.text).start.at, { x: 5, y: 11 });
  const bad = edit(TEMPLATE, "- levels: 1 to 1", "- levels: 1 to 1\n- start at: 0, 3");
  expectError(bad.text, lineOf(bad.text, "- start at: 0, 3"), /column and a row counted from 1/);
  const second = edit(TEMPLATE, "- `H` = floor_stone, spawn hobb", "- `H` = floor_stone, start, spawn hobb");
  expectError(second.text, lineOf(second.text, "## Location: Hobb's Shop"), /has 2/);
});

// ---------------------------------------------------------------------------
// What the parser fills in, and its gentler complaints

test("parsing: ids come from names unless an id line says otherwise", () => {
  const a = parseOk(TEMPLATE);
  assert.deepEqual(a.locations.map((l) => l.id), ["shop", "storeroom"]);
  assert.deepEqual(a.npcs.map((n) => n.id), ["hobb"]);
  assert.deepEqual(a.items.map((i) => i.id), ["brass_key"]);
  assert.deepEqual(a.scenes.map((s) => s.id), ["trouble", "quiet"]);
  assert.deepEqual(a.scenes[0]!.beats.map((b) => b.id), ["into_storeroom", "goblin_down"]);
  assert.deepEqual(a.scenes[0]!.objectives.map((o) => o.id), ["talk", "key", "goblin_dealt"]);
  assert.equal(a.locations[0]!.exits[0]!.id, "storeroom_door");
  assert.equal(a.locations[1]!.features[0]!.id, "packing_table");
});

test("parsing: references work by name or by id, in any case, and the start is derived", () => {
  const a = parseOk(TEMPLATE);
  assert.equal(a.npcs[0]!.location, "shop");
  assert.deepEqual(a.locations[0]!.exits[0]!.requires, { has: "brass_key" });
  assert.equal(a.locations[0]!.exits[0]!.to, "storeroom");
  assert.equal(a.locations[0]!.exits[0]!.arriveAt, "shop_door");
  assert.equal(a.locations[0]!.spawns[0]!.npcId, "hobb");
  assert.deepEqual(a.start, { sceneId: "trouble", locationId: "shop", at: { x: 5, y: 11 } });
  assert.equal(a.scenes[0]!.next[0]!.scene, "quiet");
  assert.deepEqual(a.scenes[0]!.next[0]!.when, { flag: "goblin_gone" });
  const byId = edit(TEMPLATE, "- location: Hobb's Shop", "- location: SHOP", 0);
  assert.equal(parseOk(byId.text).npcs[0]!.location, "shop");
});

test("parsing: the dash before a field is optional, fields may wrap, and * and + also bullet", () => {
  const loose = TEMPLATE.replace("- role: shopkeeper", "role: shopkeeper").replace("- voice: Quick and apologetic.", "* voice: Quick and\n    apologetic.");
  const a = parseOk(loose);
  assert.equal(a.npcs[0]!.role, "shopkeeper");
  assert.equal(a.npcs[0]!.voice, "Quick and apologetic.");
});

test("parsing: a spawn's creature written as a name becomes an id", () => {
  const e = edit(TEMPLATE, "- creature: goblin", "- creature: Giant Rat");
  assert.equal(parseOk(e.text).locations[1]!.spawns[0]!.creature, "giant-rat");
});

test("parsing: warnings do not stop the adventure", () => {
  const noVersion = edit(TEMPLATE, "- version: 1", null);
  const r = parseAdventureMarkdown(noVersion.text);
  assert.ok(r.adventure);
  assert.equal(r.adventure!.version, 1);
  assert.ok(r.warnings.some((w) => /no "- version:" line/.test(w.message)));
  const empty = TEMPLATE.replace("- The shop belongs to Hobb, a nervous shopkeeper.\n- The storeroom door is locked, and the only spare key is hidden in the counter drawer.\n- There is exactly one goblin in the storeroom, and it is alone.\n", "");
  const r2 = parseAdventureMarkdown(empty);
  assert.ok(r2.warnings.some((w) => /Truths section has no bullets/.test(w.message)));
});

test("parsing: errors come back in line order, all at once", () => {
  let t = edit(TEMPLATE, "- hostile: yes", "- hostile: maybe").text;
  t = edit(t, "- role: shopkeeper", "- roll: shopkeeper").text;
  const r = parseAdventureMarkdown(t);
  assert.equal(r.adventure, null);
  assert.ok(r.errors.length >= 2);
  const lines = r.errors.map((e) => e.line);
  assert.deepEqual(lines, [...lines].sort((x, y) => x - y));
});

test("parsing: Windows line endings and a byte-order mark are fine", () => {
  const crlf = "﻿" + TEMPLATE.replace(/\n/g, "\r\n");
  assert.deepEqual(parseAdventureMarkdown(crlf).errors, []);
  assert.deepEqual(parseAdventureMarkdown(crlf).adventure, parseOk(TEMPLATE));
});

test("parsing: the id falls back to the file name when the title has no letters", () => {
  const t = TEMPLATE.replace("# The Cupboard Goblin", "# !!!");
  assert.equal(parseAdventureMarkdown(t, { file: "adventures/rat-cellar.md" }).adventure!.id, "rat_cellar");
});

test("an adventure the AI wrote in this format is read the same way", () => {
  const t = TEMPLATE.replace("- author: owner", "- author: ai");
  assert.equal(parseOk(t).author, "ai");
});

test("robustness: deleting or truncating any line never throws, and an adventure appears exactly when there is no error", () => {
  const lines = TEMPLATE.split("\n");
  const check = (text: string): void => {
    const r = parseAdventureMarkdown(text);
    assert.equal(r.adventure === null, r.errors.length > 0);
    for (const e of r.errors) {
      assert.ok(Number.isInteger(e.line) && e.line >= 1, `bad line number ${e.line}`);
      assert.ok(e.message.length > 0);
    }
  };
  for (let i = 0; i < lines.length; i++) {
    check([...lines.slice(0, i), ...lines.slice(i + 1)].join("\n"));
    check(lines.slice(0, i).join("\n"));
  }
  for (const junk of ["", "\n\n", "# T", "# T\n## Summary\n", "```", "<!--", "- - -", "\u0000\u0001", "#".repeat(400), "# T\n## Location: X\n### Map\n```\n" + "x\n".repeat(40)]) check(junk);
});
