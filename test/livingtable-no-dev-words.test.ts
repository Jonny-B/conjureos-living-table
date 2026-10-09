/**
 * The words a developer uses must not reach a player (bug bash item 23: a refusal read "the bench has no beast yet").
 *
 * Every .ts file of the game's table, session, menu, rules and inventory folders (the table's host adapters are under table/) is read with
 * its comments taken out. The words "bench" and "stub" may not appear in what is left, and no string may mention the games database, "in
 * this build" or "not switched on yet". Comments are the developers' own notes and are free to say what they like.
 *
 * rules/rulebook.ts is left out: the rulebook is an explanation of the game and names the asset bench where it explains the bench.
 *
 * Run: npx tsx --test test/livingtable-no-dev-words.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = fileURLToPath(new URL("../src/games/livingtable/", import.meta.url));
const FOLDERS = ["table", "session", "menu", "rules", "inventory"];
const SKIP = new Set(["rules/rulebook.ts"]);

function filesIn(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesIn(full));
    else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

/** The text with every comment blanked out (newlines kept, so line numbers still count), and the text of every string literal with its line. */
function readSource(file: string): { code: string; strings: { line: number; text: string }[] } {
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const ranges: [number, number][] = [];
  const strings: { line: number; text: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const lit = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
    if (lit) strings.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: (node as ts.StringLiteral).text });
    if (node.getChildCount(sf) === 0) {
      for (const r of ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []) ranges.push([r.pos, r.end]);
      for (const r of ts.getTrailingCommentRanges(text, node.getEnd()) ?? []) ranges.push([r.pos, r.end]);
    }
    for (const child of node.getChildren(sf)) visit(child);
  };
  visit(sf);
  let code = text;
  for (const [a, b] of ranges) code = code.slice(0, a) + code.slice(a, b).replace(/[^\n]/g, " ") + code.slice(b);
  return { code, strings };
}

const files = FOLDERS.flatMap((f) => filesIn(path.join(ROOT, f))).filter((f) => !SKIP.has(path.relative(ROOT, f).split(path.sep).join("/")));

test("the scan finds the game's source, with comments out and strings in", () => {
  assert.ok(files.length > 40, `found ${files.length} files`);
  const sample = readSource(path.join(ROOT, "table/flows/act.ts"));
  assert.ok(sample.strings.length > 0);
  assert.equal(sample.code.includes("/**"), false, "the comments are blanked out");
});

test("no source line says bench or stub outside a comment", () => {
  const hits: string[] = [];
  for (const file of files) {
    const { code } = readSource(file);
    code.split("\n").forEach((line, i) => {
      const m = /\b(bench|stub)\b/i.exec(line);
      if (m) hits.push(`${path.relative(ROOT, file).split(path.sep).join("/")}:${i + 1}: ${line.trim().slice(0, 110)}`);
    });
  }
  assert.deepEqual(hits, [], `a player could be shown these:\n${hits.join("\n")}`);
});

test("no string mentions the games database, 'in this build' or 'not switched on yet'", () => {
  const hits: string[] = [];
  for (const file of files) {
    for (const s of readSource(file).strings) {
      const m = /games-db|in this build|not switched on yet/i.exec(s.text);
      if (m) hits.push(`${path.relative(ROOT, file).split(path.sep).join("/")}:${s.line}: ${s.text.slice(0, 110)}`);
    }
  }
  assert.deepEqual(hits, [], `a player could be shown these:\n${hits.join("\n")}`);
});

test("the refusals and the DM's failure lines in the files of this lane use the game's own words", () => {
  for (const f of ["table/flows/act.ts", "table/flows/dmFlow.ts", "table/flows/dmReply.ts"]) {
    const { strings } = readSource(path.join(ROOT, f));
    // The one line that says "engine" goes to the DM's own memory, not to the player.
    for (const s of strings.filter((x) => !x.text.startsWith("[The engine refused"))) assert.doesNotMatch(s.text, /\b(bench|stub|engine|games-db)\b/i, `${f}:${s.line} says "${s.text.slice(0, 80)}"`);
  }
});
