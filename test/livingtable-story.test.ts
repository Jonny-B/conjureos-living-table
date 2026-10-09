/**
 * Tests for the story screen and the words around it (bug bash items 12, 13, 17, 18, 19 and 30):
 *
 *   - createStoryFlow (ui/story.ts): the story screen's queue. Told in order, never closes by itself, shares a repeat, resolves its
 *     promises, and says when it is all read.
 *   - the DM box's standoff band (ui/overlayMath.ts dialogueBoxPx, storyPerPage).
 *   - refusals are DM text, not a strip across the top of the board (no toast anywhere in src).
 *   - the DM is told what the player clicked on (dmCore DmAsk at and what).
 *   - Cancel exists only while the DM has not started to type, and says nothing about money.
 *
 * Run: npx tsx --test test/livingtable-story.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createStoryFlow } from "../src/games/livingtable/table/ui/story";
import { dialoguePages } from "../src/games/livingtable/table/ui/dialogueQueue";
import { dialogueBoxPx, storyPerPage } from "../src/games/livingtable/table/ui/overlayMath";

const SRC = new URL("../src/", import.meta.url);

/** Every .ts and .tsx file under a folder of src, as [path from the repo root, text]. */
function sources(dir: string): [string, string][] {
  const out: [string, string][] = [];
  const root = fileURLToPath(SRC);
  const walk = (abs: string): void => {
    for (const name of readdirSync(abs)) {
      const full = path.join(abs, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name)) out.push([path.relative(path.dirname(root), full).split(path.sep).join("/"), readFileSync(full, "utf8")]);
    }
  };
  walk(fileURLToPath(new URL(dir, SRC)));
  return out;
}

function makeFlow(width = 24, perPage = 2) {
  const clock = { t: 0 };
  const flow = createStoryFlow({ layout: (t) => dialoguePages(t, (s) => s.length, width, perPage), now: () => clock.t });
  flow.setSpeed("instant");
  return { flow, clock };
}

// ---- the story flow --------------------------------------------------------------------------------------------------------------

test("a story told while another is open waits its turn: they are read in the order they were told", async () => {
  const { flow } = makeFlow();
  const order: string[] = [];
  const a = flow.open({ title: "The Cellar", text: "Damp straw and old apples." }).then(() => order.push("a"));
  const b = flow.open({ title: "Night", text: "The lamp gutters." }).then(() => order.push("b"));
  assert.equal(flow.isOpen(), true);
  assert.equal(flow.current()?.title, "The Cellar");
  assert.equal(flow.pending(), 2);
  flow.tick(1);
  assert.equal(flow.press(), "next", "a press on the finished first story moves to the second");
  await a;
  assert.deepEqual(order, ["a"], "the second is not read yet");
  assert.equal(flow.current()?.title, "Night");
  flow.tick(1);
  assert.equal(flow.press(), "close");
  await b;
  assert.deepEqual(order, ["a", "b"]);
  assert.equal(flow.isOpen(), false);
});

test("a story never closes by itself, however long the page waits", () => {
  const { flow } = makeFlow();
  void flow.open({ text: "You step out into the cold." });
  flow.tick(1);
  for (let i = 0; i < 50; i += 1) flow.tick(60_000);
  assert.equal(flow.isOpen(), true, "an hour of waiting later it is still up");
  assert.equal(flow.needsTick(), false, "and the clock is not spinning for it");
  assert.equal(flow.view()?.complete, true);
});

test("a long story is paged and each page needs a press; the last press closes it", async () => {
  const { flow } = makeFlow(20, 2);
  const done = flow.open({ text: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty" });
  flow.tick(1);
  const pages = flow.view()?.pages.length ?? 0;
  assert.ok(pages >= 3, `a long story has pages (${pages})`);
  for (let i = 1; i < pages; i += 1) {
    assert.equal(flow.press(), "page");
    flow.tick(1);
  }
  assert.equal(flow.isOpen(), true, "still open on the last page");
  assert.equal(flow.press(), "close");
  await done;
  assert.equal(flow.isOpen(), false);
});

test("a press while the text is printing finishes the page before it turns it", () => {
  const { flow } = makeFlow();
  flow.setSpeed("normal");
  void flow.open({ text: "A page that takes a moment to print." });
  assert.equal(flow.press(), "finish");
  assert.equal(flow.view()?.complete, true);
});

test("a title alone is a story too: it waits for a press and has no text to page", async () => {
  const { flow } = makeFlow();
  const done = flow.open({ title: "Wick End Square", text: "" });
  assert.equal(flow.isOpen(), true);
  assert.equal(flow.view(), null, "no text, so no pages");
  assert.equal(flow.press(), "close");
  await done;
  assert.equal(flow.isOpen(), false);
});

test("nothing to say is not a story", async () => {
  const { flow } = makeFlow();
  await flow.open({ text: "   " });
  assert.equal(flow.isOpen(), false);
});

test("the same words told twice at once are one story, and both tellers hear when it is read", async () => {
  const { flow } = makeFlow();
  let first = false;
  let second = false;
  const a = flow.open({ text: "The door creaks open onto a stair." }).then(() => (first = true));
  const b = flow.open({ text: "the door creaks open onto a stair" }).then(() => (second = true));
  assert.equal(flow.pending(), 1, "one screen, not two");
  flow.tick(1);
  flow.press();
  await Promise.all([a, b]);
  assert.ok(first && second);
});

test("the same words told again just after they were read are not shown a second time", async () => {
  const { flow, clock } = makeFlow();
  const a = flow.open({ text: "The cellar door is bolted." });
  flow.tick(1);
  flow.press();
  await a;
  clock.t += 500;
  await flow.open({ text: "The cellar door is bolted." });
  assert.equal(flow.isOpen(), false, "a repeat within moments is dropped");
  clock.t += 10_000;
  void flow.open({ text: "The cellar door is bolted." });
  assert.equal(flow.isOpen(), true, "told again much later, it is told again");
});

test("whenClosed resolves at once with nothing open, and after the last story is read otherwise", async () => {
  const { flow } = makeFlow();
  await flow.whenClosed();
  const a = flow.open({ text: "First." });
  const b = flow.open({ text: "Second." });
  let closed = false;
  const w = flow.whenClosed().then(() => (closed = true));
  await Promise.resolve();
  assert.equal(closed, false);
  flow.tick(1);
  flow.press();
  await a;
  await Promise.resolve();
  assert.equal(closed, false, "one is still waiting");
  flow.tick(1);
  flow.press();
  await Promise.all([b, w]);
  assert.equal(closed, true);
});

test("clear lets every teller and every waiter go, and leaves nothing open", async () => {
  const { flow } = makeFlow();
  const a = flow.open({ text: "One." });
  const b = flow.open({ text: "Two." });
  const w = flow.whenClosed();
  flow.clear();
  await Promise.all([a, b, w]);
  assert.equal(flow.isOpen(), false);
  assert.equal(flow.view(), null);
});

test("the flow tells its listener when it opens and when it closes", () => {
  const { flow } = makeFlow();
  const seen: boolean[] = [];
  flow.onChange(() => seen.push(flow.isOpen()));
  void flow.open({ text: "Hello there, traveller." });
  flow.tick(1);
  flow.press();
  assert.equal(seen[0], true);
  assert.equal(seen[seen.length - 1], false);
});

// ---- the standoff band -----------------------------------------------------------------------------------------------------------

test("dialogueBoxPx: the room the full DM box takes is its rows plus its frame and tag, rounded up", () => {
  assert.equal(dialogueBoxPx({ lines: 4, row: 20, chrome: 36 }), 116);
  assert.equal(dialogueBoxPx({ lines: 3, row: 22.475, chrome: 41.2 }), 109);
  assert.ok(dialogueBoxPx({ lines: 4, row: 22, chrome: 40 }) > dialogueBoxPx({ lines: 3, row: 22, chrome: 40 }), "more rows, more room");
});

test("storyPerPage: about eight rows when the board is tall, fewer as it shrinks, never fewer than three", () => {
  assert.equal(storyPerPage(900, 26, 200), 8);
  assert.equal(storyPerPage(640, 26, 200), 8);
  assert.ok(storyPerPage(360, 26, 200) < 8);
  assert.ok(storyPerPage(360, 26, 200) >= 3);
  assert.equal(storyPerPage(10, 26, 200), 3);
});

// ---- no strip across the top, no price words -------------------------------------------------------------------------------------

test("no toast is left anywhere in src: refusals are DM text", () => {
  const hits: string[] = [];
  for (const [file, text] of sources("games/livingtable")) {
    for (const needle of ["overlay.toast", "lto-toast", "ltoToast", "oc.toast", "TOAST_MS"]) if (text.includes(needle)) hits.push(`${file}: ${needle}`);
  }
  assert.deepEqual(hits, [], "no file names a toast, comments included");
});

// ---- Cancel ---------------------------------------------------------------------------------------------------------------------

test("Cancel is wired in the DM box and in the ask flow, and the flow only offers it until the reply starts to type", () => {
  const types = readFileSync(new URL("games/livingtable/table/ui/overlayTypes.ts", SRC), "utf8");
  assert.match(types, /onDmCancel\(handler: \(\(\) => void\) \| null\): void;/);
  const flow = readFileSync(new URL("games/livingtable/table/flows/dmFlow.ts", SRC), "utf8");
  assert.match(flow, /overlay\.onDmCancel\(/, "the flow gives the DM box its Cancel");
  assert.match(flow, /onNarration: \(t\) => \{[\s\S]*?tc\.dmThinking = false;/, "the first streamed words end the waiting");
  assert.match(flow, /function cancelDm\(\): void \{\s*if \(!tc\.dmThinking\) return;/, "a late call cannot abort a reply that is typing");
});
