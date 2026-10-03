/**
 * Tests for the optional AI adventure writer (src/games/livingtable/adventures/generate.ts),
 * driven by a fake `complete`: a valid answer passes, an invalid answer is
 * repaired, a failure after the repairs reports the errors, the prompt carries
 * the template, the id lists and the premise, and the author is always "ai".
 *
 * Run: npx -y tsx --test test/livingtable-adventures-generate.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AI_ADVENTURE_COST_NOTE,
  buildAdventurePrompt,
  writeAdventure,
  type AdventureRequest,
  type AdventureWriterContext,
  type CompleteInput,
} from "../src/games/livingtable/adventures/generate";
import { CONDITION_PHRASES } from "../src/games/livingtable/adventures/markdown";
import { gameAssets } from "../scripts/adventures/check";
import { BESTIARY } from "../src/games/livingtable/rules/bestiary";

const TEMPLATE = readFileSync(new URL("../adventures/TEMPLATE.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** The two long dash characters, built from code points so this file never contains them. */
const LONG_DASHES = new RegExp(`[${String.fromCharCode(0x2014)}${String.fromCharCode(0x2013)}]`);

const assets = gameAssets();
const creatures = ["rat", "giant-rat", "goblin", "skeleton"];
const ctx: AdventureWriterContext = { assets, creatures, template: TEMPLATE };
const req: AdventureRequest = { premise: "A haunted lighthouse and a missing keeper.", tone: "Spooky but kind.", length: "short", level: 1, mustInclude: ["a talking cat"] };

/** A fake writer that answers from a list, remembering every input it was given. */
function fake(answers: (string | Error)[]) {
  const inputs: CompleteInput[] = [];
  const complete = async (input: CompleteInput): Promise<string> => {
    inputs.push(input);
    const next = answers[Math.min(inputs.length - 1, answers.length - 1)];
    if (next instanceof Error) throw next;
    return next;
  };
  return { complete, inputs };
}

const lastUser = (input: CompleteInput): string => (typeof input === "string" ? input : input[input.length - 1].content);

test("the template is a valid answer, and the author comes out as ai", async () => {
  assert.match(TEMPLATE, /- author: owner/);
  const f = fake([TEMPLATE]);
  const stages: string[] = [];
  const r = await writeAdventure(f.complete, req, ctx, { onProgress: (s) => stages.push(s) });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.adventure.author, "ai");
  assert.match(r.markdown, /^- author: ai$/m);
  assert.doesNotMatch(r.markdown, /author: owner/);
  assert.equal(r.repairs, 0);
  assert.equal(f.inputs.length, 1);
  assert.equal(typeof f.inputs[0], "string");
  assert.equal(stages[0], "Writing the adventure");
  assert.equal(stages[stages.length - 1], "Done");
});

test("a missing author line is added, and a reply wrapped in a code fence with chatter is cleaned", async () => {
  const noAuthor = TEMPLATE.replace("- author: owner\n", "");
  assert.doesNotMatch(noAuthor, /author:/);
  const wrapped = "Sure, here is your adventure:\n\n````markdown\n" + noAuthor + "\n````\n";
  const r = await writeAdventure(fake([wrapped]).complete, req, ctx);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.adventure.author, "ai");
  assert.ok(r.markdown.startsWith("# The Cupboard Goblin"));
  assert.ok(!r.markdown.includes("````"));
});

test("an invalid answer is sent back with its problems and repaired", async () => {
  const broken = TEMPLATE.replace("- creature: goblin", "- creature: dragonling");
  assert.notEqual(broken, TEMPLATE);
  const f = fake([broken, TEMPLATE]);
  const stages: string[] = [];
  const r = await writeAdventure(f.complete, req, ctx, { onProgress: (s) => stages.push(s) });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.repairs, 1);
  assert.equal(f.inputs.length, 2);
  // The repair is a short conversation: the prompt, the file that failed, the problems.
  const second = f.inputs[1];
  assert.ok(Array.isArray(second));
  if (!Array.isArray(second)) return;
  assert.deepEqual(second.map((m) => m.role), ["user", "assistant", "user"]);
  assert.equal(second[0].content, buildAdventurePrompt(req, ctx));
  assert.match(second[1].content, /dragonling/);
  assert.match(second[2].content, /dragonling/);
  assert.match(second[2].content, /WHOLE corrected file/);
  assert.ok(stages.some((s) => /repair 1 of 2/.test(s)));
});

test("a reply the parser cannot read is repaired too, with line numbers", async () => {
  const unreadable = TEMPLATE.replace("## Summary", "## Sumary");
  const f = fake([unreadable, TEMPLATE]);
  const r = await writeAdventure(f.complete, req, ctx);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.repairs, 1);
  assert.match(lastUser(f.inputs[1]), /line \d+:/);
});

test("it fails after the repairs run out and reports the errors and the last file", async () => {
  const broken = TEMPLATE.replace("- creature: goblin", "- creature: dragonling");
  const f = fake([broken]);
  const r = await writeAdventure(f.complete, req, ctx);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(f.inputs.length, 3, "one write and the default two repairs");
  assert.ok(r.errors.length > 0);
  assert.ok(r.errors.some((e) => /dragonling/.test(e)));
  assert.ok(r.markdown && /dragonling/.test(r.markdown));
});

test("maxRepairs is honoured, including zero", async () => {
  const broken = TEMPLATE.replace("- creature: goblin", "- creature: dragonling");
  const none = fake([broken]);
  const r0 = await writeAdventure(none.complete, req, ctx, { maxRepairs: 0 });
  assert.equal(r0.ok, false);
  assert.equal(none.inputs.length, 1);

  const five = fake([broken]);
  const r5 = await writeAdventure(five.complete, req, ctx, { maxRepairs: 5 });
  assert.equal(r5.ok, false);
  assert.equal(five.inputs.length, 6);
});

test("an empty premise is refused without calling the writer; an empty or thrown reply is reported", async () => {
  const f = fake([TEMPLATE]);
  const r = await writeAdventure(f.complete, { premise: "   " }, ctx);
  assert.equal(r.ok, false);
  assert.equal(f.inputs.length, 0);

  const empty = await writeAdventure(fake([""]).complete, req, ctx, { maxRepairs: 0 });
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.match(empty.errors[0], /empty/);

  const thrown = await writeAdventure(fake([new Error("network down")]).complete, req, ctx);
  assert.equal(thrown.ok, false);
  if (!thrown.ok) assert.match(thrown.errors[0], /network down/);
});

test("the prompt carries the premise, the request, the template, the id lists and the rules", () => {
  const p = buildAdventurePrompt(req, ctx);
  assert.ok(p.includes("A haunted lighthouse and a missing keeper."));
  assert.ok(p.includes("Spooky but kind."));
  assert.ok(p.includes("a talking cat"));
  assert.ok(p.includes(TEMPLATE.trim()), "the whole template text is in the prompt");
  assert.ok(p.includes("author: ai"));
  assert.ok(p.includes("exactly 15 lines of exactly 20 characters"));
  assert.match(p, /SRD 5\.1/);
  assert.match(p, /SHORT: 2 locations/);
  assert.match(p, /Hero level: 1/);
  for (const id of ["floor_stone", "wall_stone", "door_open", "rat_hole", "token_goblin", "token_giant_rat"]) assert.ok(p.includes(`\`${id}\``), id);
  for (const c of creatures) assert.ok(p.includes(`\`${c}\``), c);
  for (const phrase of CONDITION_PHRASES) assert.ok(p.includes(phrase), phrase);
  // Worn gear pictures and edge or join tiles are summarised, not listed.
  assert.ok(!/`gear_/.test(p));
  assert.ok(!/`floor_grass_edge_/.test(p));
  assert.match(p, /edge and join tiles/);
  // Walkability is spelled out when the assets say which tiles walk.
  assert.match(p, /Not walkable/);
  assert.doesNotMatch(p, LONG_DASHES);
});

test("the prompt follows the request: medium length, clamped level, optional guide, no tone line when none", () => {
  const medium = buildAdventurePrompt({ premise: "A fair on the green.", length: "medium", level: 99 }, { ...ctx, guide: "GUIDE TEXT HERE" });
  assert.match(medium, /MEDIUM: 3 or 4 locations/);
  assert.match(medium, /Hero level: 20/);
  assert.ok(medium.includes("GUIDE TEXT HERE"));
  assert.doesNotMatch(medium, /- Tone:/);
  assert.doesNotMatch(medium, /The story must include/);
  const plain = buildAdventurePrompt({ premise: "x" }, ctx);
  assert.match(plain, /SHORT: 2 locations/);
  assert.doesNotMatch(plain, /<guide>/);
  assert.equal(buildAdventurePrompt(req, ctx), buildAdventurePrompt(req, ctx), "pure");
});

test("the fixture creature list is made of real bestiary creatures", () => {
  const ids = new Set(BESTIARY.map((c) => c.id));
  for (const c of creatures) assert.ok(ids.has(c), c);
});

test("the cost note says what it costs in plain words and uses no long dashes", () => {
  assert.match(AI_ADVENTURE_COST_NOTE, /few minutes/);
  assert.match(AI_ADVENTURE_COST_NOTE, /lot of your Claude usage/);
  assert.match(AI_ADVENTURE_COST_NOTE, /cost nothing/);
  assert.doesNotMatch(AI_ADVENTURE_COST_NOTE, LONG_DASHES);
});
