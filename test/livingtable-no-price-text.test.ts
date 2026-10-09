/**
 * The game never names a price (bug bash items 13 and 30). The platform's own credit display says what AI use costs; nothing the game
 * says may mention credits, a price, a charge or a refund, and Cancel (taking back a question to the DM) says nothing about money.
 *
 * Every string literal in src (comments are the developers' notes and are not read) is scanned. The DM's own prompts (table/dmCore.ts)
 * are not the player's words, but they are scanned too, because a model that is told about credits will mention them.
 *
 * Run: npx tsx --test test/livingtable-no-price-text.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

function filesIn(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesIn(full));
    else if (/\.tsx?$/.test(name) && !name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

/** The text of every string literal in a file, with its line. */
function literals(file: string): { line: number; text: string }[] {
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: { line: number; text: string }[] = [];
  const visit = (node: ts.Node): void => {
    const lit = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
    if (lit) out.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: (node as ts.StringLiteral).text });
    else if (ts.isJsxText(node)) out.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: node.text });
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Credits, prices and refunds, in words a player could read. A credit that is an attribution ("Licence and credits", a class name) is not money. */
const MONEY = /(?<![-\w])(?<!licence and )credits?\b|\bpric(e|es|ed|ing)\b|\brefund(s|ed)?\b/i;
/** The rulebook uses "prices" for what the DM never does to an item; only credits and refunds are money there. */
const RULEBOOK_MONEY = /(?<![-\w])(?<!licence and )credits?\b|\brefund(s|ed)?\b/i;
/** Adventure files are the story's own words ("the whole price Marta promised"): a price in the fiction is not the platform's. */
const STORY_FILES = new Set(["games/livingtable/table/adventures/data.ts"]);

const files = filesIn(SRC);

function scan(skip: (rel: string) => boolean, money: RegExp = MONEY): string[] {
  const hits: string[] = [];
  for (const file of files) {
    const rel = path.relative(SRC, file).split(path.sep).join("/");
    if (skip(rel) || STORY_FILES.has(rel)) continue;
    for (const s of literals(file)) if (s.text !== "credits" && money.test(s.text)) hits.push(rel + ":" + s.line + ": " + s.text.replace(/\s+/g, " ").slice(0, 110));
  }
  return hits;
}

test("the scan reads the game's source", () => {
  assert.ok(files.length > 100, `found ${files.length} files`);
  assert.ok(literals(path.join(SRC, "games/livingtable/menu/labels.ts")).length > 20);
});

test("no string in the game names a credit, a price or a refund (the rulebook is checked on its own below)", () => {
  const hits = scan((rel) => rel === "games/livingtable/rules/rulebook.ts");
  assert.deepEqual(hits, [], `these would show a player money words:\n${hits.join("\n")}`);
});

test("the rulebook the player can open names no credit, price or refund", () => {
  const hits = scan((rel) => rel !== "games/livingtable/rules/rulebook.ts", RULEBOOK_MONEY);
  assert.deepEqual(hits, [], `the rulebook still talks about money:\n${hits.join("\n")}`);
});

test("Cancel says Cancel and nothing about money, and a cancel is not paid back", () => {
  const dialogue = readFileSync(path.join(SRC, "games/livingtable/table/ui/dialogue.ts"), "utf8").replace(/\r\n/g, "\n");
  const button = /function cancelButton\(\)[\s\S]*?\n  }\n/.exec(dialogue)?.[0] ?? "";
  assert.ok(button.length > 200, "the Cancel button is built in the DM box");
  assert.match(button, /"Cancel"/);
  assert.doesNotMatch(button, MONEY);
  const flow = readFileSync(path.join(SRC, "games/livingtable/table/flows/dmFlow.ts"), "utf8").replace(/\r\n/g, "\n");
  const cancel = /function cancelDm\(\)[\s\S]*?\n  }\n/.exec(flow)?.[0] ?? "";
  assert.ok(cancel.length > 50);
  assert.doesNotMatch(cancel.replace(/\/\*[\s\S]*?\*\//g, ""), /refund|credit|price/i, "the cancel is never paid back in code or words");
});
