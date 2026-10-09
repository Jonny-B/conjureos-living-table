/**
 * The authoring format: one Markdown file per adventure, written by a person,
 * parsed into the typed `Adventure` model (types.ts) and written back out.
 *
 * The file is meant to be read and written by someone who is not a
 * programmer, so the rules are few and strict:
 *
 *  - `# Title`, then `## Section` headings, then `### Sub-section` headings.
 *  - Single-line facts are `- key: value` lines (the leading dash is optional).
 *  - Long prose is a `>` quote (read-aloud text, openings, narration) or plain
 *    paragraphs (the summary).
 *  - A map is a fenced block of exactly 15 lines of exactly 20 characters.
 *  - Conditions are plain words: "the player talks to Marta".
 *  - `<!-- ... -->` comments are ignored, so the author can leave notes.
 *
 * Every error names the line and says what was expected. Parsing never throws.
 * `adventureToMarkdown` is the inverse (for the optional AI author and for
 * round-trip tests): `parse(write(a))` gives back `a` for every adventure the
 * parser can produce. The full guide is adventures/README.md.
 */
import { CELL_HEIGHT, CELL_WIDTH } from "../world";
import type { Adventure, AdventureBeat, AdventureExit, AdventureFeature, AdventureItem, AdventureLocation, AdventureNpc, AdventureObjective, AdventureScene, AdventureSpawn, Chassis, Condition, LegendEntry, StartingKit } from "./types";

export interface MarkdownIssue {
  /** 1-based line in the file. */
  line: number;
  message: string;
}

export interface MarkdownParseResult {
  /** The adventure, or null when there is any error. Warnings never stop it. */
  adventure: Adventure | null;
  errors: MarkdownIssue[];
  warnings: MarkdownIssue[];
}

/** Every phrasing a condition may use. NAME, ID and PREFIX are one word; LOCATION, NPC, ITEM and OBJECTIVE are a name or an id. */
export const CONDITION_PHRASES: readonly string[] = [
  "always",
  "never",
  "the flag NAME is set",
  "the flag NAME is not set",
  "the spawn ID is killed",
  "the creature ID is killed",
  "every spawn starting with PREFIX is killed",
  "the player enters LOCATION",
  "the player talks to NPC",
  "the player has ITEM",
  "the objective OBJECTIVE is done",
  "not CONDITION",
  "CONDITION and CONDITION",
  "CONDITION or CONDITION",
  "( CONDITION )",
];

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const WORD_RE = /^[A-Za-z0-9_-]+$/;

// ---------------------------------------------------------------------------
// Small helpers

/** The id a name turns into when no `id:` line is given: lower case, a leading "the", "a" or "an" dropped, runs of other characters become one underscore. */
export function slugify(text: string): string {
  const base = text.toLowerCase().replace(/^\s*(the|a|an)\s+(?=\S)/, "");
  return base.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function norm(s: string): string {
  let t = s.toLowerCase().replace(/[“”"]/g, "").replace(/\s+/g, " ").trim();
  t = t.replace(/[.,;:!?]+$/, "");
  t = t.replace(/^(the|a|an) (?=\S)/, "");
  return t.trim();
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function lev(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length]!;
}

function didYouMean(word: string, options: string[]): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  for (const o of options) {
    const d = lev(word, o);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best !== undefined && bestD <= Math.max(1, Math.floor(word.length / 3)) ? best : undefined;
}

class Problems {
  errors: MarkdownIssue[] = [];
  warnings: MarkdownIssue[] = [];
  err(line: number, message: string): void {
    this.errors.push({ line, message });
  }
  warn(line: number, message: string): void {
    this.warnings.push({ line, message });
  }
}

/** Something that can be referred to by id or by name. */
interface Cand {
  id: string;
  names: string[];
}

function keysOf(c: Cand): string[] {
  return [norm(c.id), norm(c.id.replace(/[_-]+/g, " ")), ...c.names.map(norm)];
}

function lookup(cands: Cand[], text: string): { id?: string; ambiguous?: string[] } {
  const raw = text.trim();
  const exact = cands.find((c) => c.id === raw);
  if (exact) return { id: exact.id };
  const n = norm(raw);
  if (!n) return {};
  const hits = [...new Set(cands.filter((c) => keysOf(c).includes(n)).map((c) => c.id))];
  if (hits.length === 1) return { id: hits[0]! };
  if (hits.length > 1) return { ambiguous: hits };
  return {};
}

function listCands(cands: Cand[], max = 8): string {
  if (cands.length === 0) return "none are defined";
  const shown = cands.slice(0, max).map((c) => {
    const n = c.names[0];
    return n && norm(n) !== norm(c.id) ? `${n} (${c.id})` : (n ?? c.id);
  });
  return shown.join(", ") + (cands.length > max ? ", and more" : "");
}

// ---------------------------------------------------------------------------
// Conditions

/** The names a condition may point at. */
export interface ConditionContext {
  locations: Cand[];
  npcs: Cand[];
  items: Cand[];
  objectives: Cand[];
}

class CondError extends Error {}

class CondParser {
  i = 0;
  constructor(
    private toks: string[],
    private ctx: ConditionContext,
  ) {}

  private lw(k = 0): string {
    return (this.toks[this.i + k] ?? "").toLowerCase();
  }

  private fail(reason: string): never {
    throw new CondError(reason);
  }

  private expectWords(words: string[], after: string): void {
    for (const w of words) {
      if (this.lw() !== w) this.fail(`expected "${w}" ${after}, but found ${this.toks[this.i] === undefined ? "the end of the condition" : `"${this.toks[this.i]}"`}`);
      this.i++;
    }
  }

  private word(what: string): string {
    const t = this.toks[this.i];
    if (t === undefined || t === "(" || t === ")") return this.fail(`expected ${what} here, but the condition ends`);
    if (!WORD_RE.test(t)) return this.fail(`"${t}" is not ${what}: use letters, digits, - and _ only`);
    this.i++;
    return t;
  }

  private boundary(j: number): boolean {
    const t = (this.toks[j] ?? "").toLowerCase();
    return j >= this.toks.length || t === ")" || t === "and" || t === "or";
  }

  private entity(cands: Cand[], noun: string, follow?: (j: number) => boolean): string {
    const ok = follow ?? ((j: number) => this.boundary(j));
    const start = this.i;
    const max = Math.min(this.toks.length - start, 12);
    for (let len = max; len >= 1; len--) {
      const slice = this.toks.slice(start, start + len);
      if (slice.includes("(") || slice.includes(")")) continue;
      if (!ok(start + len)) continue;
      const r = lookup(cands, slice.join(" "));
      if (r.id) {
        this.i = start + len;
        return r.id;
      }
    }
    const found = this.toks.slice(start, start + 4).join(" ");
    return this.fail(`expected the name or id of ${noun} ${found ? `at "${found}"` : "here, but the condition ends"}. Defined: ${listCands(cands)}`);
  }

  parseAll(): Condition {
    const c = this.expr();
    if (this.i < this.toks.length) this.fail(`unexpected "${this.toks[this.i]}" after the condition was complete (join conditions with "and" or "or")`);
    return c;
  }

  private expr(): Condition {
    const first = this.term();
    const items = [first];
    let op: "and" | "or" | undefined;
    while (this.lw() === "and" || this.lw() === "or") {
      const w = this.lw() as "and" | "or";
      if (op && op !== w) this.fail('"and" and "or" are mixed without parentheses. Wrap one group in ( ) so it is clear which goes first');
      op = w;
      this.i++;
      items.push(this.term());
    }
    if (!op) return first;
    return op === "and" ? { all: items } : { any: items };
  }

  private term(): Condition {
    if (this.lw() === "not") {
      this.i++;
      return { not: this.term() };
    }
    if (this.toks[this.i] === "(") {
      this.i++;
      const e = this.expr();
      if (this.toks[this.i] !== ")") this.fail('expected ")" to close the parenthesis');
      this.i++;
      return e;
    }
    return this.clause();
  }

  private clause(): Condition {
    const w = this.lw();
    if (this.toks[this.i] === undefined) return this.fail("the condition ends too early");
    if (w === "always") {
      this.i++;
      return { always: true };
    }
    if (w === "never") {
      this.i++;
      return { any: [] };
    }
    if (w === "every") {
      this.i++;
      this.expectWords(["spawn", "starting", "with"], 'after "every"');
      const prefix = this.word("a spawn id prefix");
      this.expectWords(["is"], "after the prefix");
      this.killedWord();
      return { killed: `all:${prefix}` };
    }
    if (w === "the" && this.lw(1) === "objective") {
      this.i += 2;
      const id = this.entity(this.ctx.objectives, "an objective", (j) => {
        const a = (this.toks[j] ?? "").toLowerCase();
        const b = (this.toks[j + 1] ?? "").toLowerCase();
        return a === "is" && (b === "done" || b === "complete");
      });
      this.expectWords(["is"], "after the objective");
      if (this.lw() !== "done" && this.lw() !== "complete") this.fail('expected "done" after "is"');
      this.i++;
      return { objective: id };
    }
    if (w === "the" && this.lw(1) === "flag") {
      this.i += 2;
      const name = this.word("a flag name");
      this.expectWords(["is"], "after the flag name");
      let negate = false;
      if (this.lw() === "not") {
        negate = true;
        this.i++;
      }
      this.expectWords(["set"], 'after "is"');
      return negate ? { not: { flag: name } } : { flag: name };
    }
    if (w === "the" && (this.lw(1) === "spawn" || this.lw(1) === "creature")) {
      this.i += 2;
      const id = this.word("a spawn or creature id");
      this.expectWords(["is"], "after the id");
      this.killedWord();
      return { killed: id };
    }
    const k = w === "the" ? 1 : 0;
    const who = this.lw(k);
    if (who === "player" || who === "party") {
      const verb = this.lw(k + 1);
      const verb2 = this.lw(k + 2);
      if (verb === "enters") {
        this.i += k + 2;
        return { entered: this.entity(this.ctx.locations, "a location") };
      }
      if (verb === "has" && verb2 === "entered") {
        this.i += k + 3;
        return { entered: this.entity(this.ctx.locations, "a location") };
      }
      if ((verb === "talks" || verb === "speaks") && verb2 === "to") {
        this.i += k + 3;
        return { talkedTo: this.entity(this.ctx.npcs, "an NPC") };
      }
      if (verb === "has" && (verb2 === "talked" || verb2 === "spoken") && this.lw(k + 3) === "to") {
        this.i += k + 4;
        return { talkedTo: this.entity(this.ctx.npcs, "an NPC") };
      }
      if (verb === "has") {
        this.i += k + 2;
        return { has: this.entity(this.ctx.items, "an item") };
      }
    }
    return this.fail(`I do not recognise the phrase starting at "${this.toks.slice(this.i, this.i + 5).join(" ")}"`);
  }

  private killedWord(): void {
    if (this.lw() !== "killed" && this.lw() !== "dead") this.fail('expected "killed" here');
    this.i++;
  }
}

/** Read one condition written in plain words. Throws an Error whose message says what was wrong. */
export function parseConditionPhrase(text: string, ctx: ConditionContext): Condition {
  let t = text.trim().replace(/[.;]+$/, "").trim();
  t = t.replace(/^when\s+/i, "");
  if (!t) throw new Error("the condition is empty");
  const toks = t.replace(/\(/g, " ( ").replace(/\)/g, " ) ").split(/\s+/).filter(Boolean);
  try {
    return new CondParser(toks, ctx).parseAll();
  } catch (e) {
    if (e instanceof CondError) throw new Error(`I could not read the condition "${t}": ${e.message}. Conditions are written like: ${CONDITION_PHRASES.slice(0, 9).join("; ")}`);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Scanning: lines into blocks

type Tok =
  | { t: "heading"; line: number; level: number; text: string }
  | { t: "fence"; line: number; endLine: number; info: string; rows: { line: number; text: string }[]; closed: boolean }
  | { t: "quote"; line: number; text: string }
  | { t: "bullet"; line: number; endLine: number; text: string }
  | { t: "text"; line: number; endLine: number; text: string }
  | { t: "blank"; line: number };
type Body = Exclude<Tok, { t: "heading" }>;
type FenceTok = Extract<Tok, { t: "fence" }>;

interface Node {
  level: number;
  heading: string;
  line: number;
  items: Body[];
  children: Node[];
}

function scan(text: string, p: Problems): { toks: Tok[]; comments: { line: number; text: string }[] } {
  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  const toks: Tok[] = [];
  const comments: { line: number; text: string }[] = [];
  let fence: { char: string; len: number; tok: FenceTok } | undefined;
  let inComment = false;
  let commentStart = 0;
  let commentBuf = "";

  for (let n = 0; n < lines.length; n++) {
    const lineNo = n + 1;
    const raw = lines[n]!;
    if (fence) {
      const m = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/.exec(raw);
      if (m && m[1]![0] === fence.char && m[1]!.length >= fence.len) {
        fence.tok.closed = true;
        fence.tok.endLine = lineNo;
        fence = undefined;
        continue;
      }
      if (!/^#{1,6}[ \t]+\S/.test(raw)) {
        fence.tok.rows.push({ line: lineNo, text: raw });
        continue;
      }
      // A heading cannot be a map row (rows have no spaces), so the closing fence was forgotten.
      p.err(fence.tok.line, `This code block is not closed before the heading on line ${lineNo}. Add a line with three backticks after the last map row.`);
      fence.tok.endLine = lineNo - 1;
      fence = undefined;
    }

    let out = "";
    let rest = raw;
    for (;;) {
      if (inComment) {
        const end = rest.indexOf("-->");
        if (end < 0) {
          commentBuf += " " + rest;
          rest = "";
          break;
        }
        commentBuf += " " + rest.slice(0, end);
        comments.push({ line: commentStart, text: oneLine(commentBuf) });
        inComment = false;
        rest = rest.slice(end + 3);
        continue;
      }
      const st = rest.indexOf("<!--");
      if (st < 0) {
        out += rest;
        break;
      }
      out += rest.slice(0, st);
      inComment = true;
      commentStart = lineNo;
      commentBuf = "";
      rest = rest.slice(st + 4);
    }
    const s = out;

    if (/^\s*$/.test(s)) {
      toks.push({ t: "blank", line: lineNo });
      continue;
    }
    const fm = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/.exec(s);
    if (fm && !(fm[1]![0] === "`" && fm[2]!.includes("`"))) {
      const tok: FenceTok = { t: "fence", line: lineNo, endLine: lineNo, info: fm[2]!.trim(), rows: [], closed: false };
      toks.push(tok);
      fence = { char: fm[1]![0]!, len: fm[1]!.length, tok };
      continue;
    }
    const hm = /^(#{1,6})[ \t]+(.*\S)[ \t]*$/.exec(s);
    if (hm) {
      toks.push({ t: "heading", line: lineNo, level: hm[1]!.length, text: hm[2]!.trim() });
      continue;
    }
    if (/^[ \t]{0,3}([-*_])([ \t]*\1){2,}[ \t]*$/.test(s)) {
      toks.push({ t: "blank", line: lineNo });
      continue;
    }
    const qm = /^[ \t]{0,3}>[ \t]?(.*)$/.exec(s);
    if (qm) {
      toks.push({ t: "quote", line: lineNo, text: qm[1]!.trim() });
      continue;
    }
    const bm = /^[ \t]{0,3}[-*+](?:[ \t]+(.*?))?[ \t]*$/.exec(s);
    if (bm) {
      toks.push({ t: "bullet", line: lineNo, endLine: lineNo, text: (bm[1] ?? "").trim() });
      continue;
    }
    const prev = toks[toks.length - 1];
    if (/^(?:[ \t]{2,}|\t)\S/.test(s) && prev && (prev.t === "bullet" || prev.t === "text") && prev.endLine === lineNo - 1) {
      prev.text = (prev.text + " " + s.trim()).trim();
      prev.endLine = lineNo;
      continue;
    }
    toks.push({ t: "text", line: lineNo, endLine: lineNo, text: s.trim() });
  }
  if (inComment) p.err(commentStart, "This comment (<!--) is never closed with -->, so everything after it is ignored.");
  if (fence) p.err(fence.tok.line, "This code block is never closed. Add a line with three backticks (```) after the last row.");
  return { toks, comments };
}

function buildTree(toks: Tok[], p: Problems): { preface: Body[]; title?: Node; sections: Node[] } {
  const preface: Body[] = [];
  let title: Node | undefined;
  const sections: Node[] = [];
  let cur2: Node | undefined;
  let cur: Node | undefined;
  for (const t of toks) {
    if (t.t !== "heading") {
      (cur ? cur.items : preface).push(t);
      continue;
    }
    const node: Node = { level: t.level, heading: t.text, line: t.line, items: [], children: [] };
    if (t.level === 1) {
      if (title) p.err(t.line, `There can be only one title (a line starting with a single #). The title is already on line ${title.line}. Section headings start with ##.`);
      else title = node;
      cur = node;
    } else if (t.level === 2) {
      sections.push(node);
      cur2 = node;
      cur = node;
    } else if (t.level === 3) {
      if (!cur2) p.err(t.line, "A ### heading must come after a ## section heading.");
      else cur2.children.push(node);
      cur = node;
    } else {
      p.err(t.line, `Headings go down to three # signs (###). This one has ${t.level}.`);
      cur = node;
    }
  }
  return { preface, title, sections };
}

// ---------------------------------------------------------------------------
// Fields

interface FieldDef {
  key: string;
  aliases?: string[];
  multi?: boolean;
}
interface FV {
  line: number;
  value: string;
}
type FieldMap = Map<string, FV[]>;

const KEY_RE = /^([A-Za-z][A-Za-z' ]*?)\s*:\s*(.*)$/;

function readFields(items: Body[], defs: FieldDef[], where: string, p: Problems, allow: { quote?: boolean } = {}): FieldMap {
  const byName = new Map<string, FieldDef>();
  for (const d of defs) {
    byName.set(d.key, d);
    for (const a of d.aliases ?? []) byName.set(a, d);
  }
  const fm: FieldMap = new Map();
  let quoteReported = false;
  for (const it of items) {
    if (it.t === "fence") {
      p.err(it.line, `A code block is not expected ${where}.`);
      continue;
    }
    if (it.t === "quote") {
      if (!allow.quote && !quoteReported) {
        quoteReported = true;
        p.err(it.line, `A quote (a line starting with >) is not expected ${where}.`);
      }
      continue;
    }
    if (it.t === "blank") continue;
    const m = KEY_RE.exec(it.text);
    if (!m) {
      p.err(
        it.line,
        it.text
          ? `Expected a field written like "- ${defs[0]?.key ?? "key"}: value" ${where}, but this line is plain text: "${it.text.slice(0, 60)}". (Text that is read aloud goes in a quote: start the line with >.)`
          : "This bullet is empty.",
      );
      continue;
    }
    const keyRaw = m[1]!.toLowerCase().replace(/\s+/g, " ").trim();
    const def = byName.get(keyRaw);
    if (!def) {
      const hint = didYouMean(keyRaw, [...byName.keys()]);
      p.err(it.line, `"${keyRaw}" is not a field ${where}.${hint ? ` Did you mean "${hint}"?` : ""} The fields here are: ${defs.map((d) => d.key).join(", ")}.`);
      continue;
    }
    const value = m[2]!.trim();
    if (!value) {
      p.err(it.line, `"${def.key}:" needs a value after the colon.`);
      continue;
    }
    const list = fm.get(def.key) ?? [];
    if (!def.multi && list.length > 0) {
      p.err(it.line, `"${def.key}:" appears twice ${where} (first on line ${list[0]!.line}). It may be given once.`);
      continue;
    }
    list.push({ line: it.line, value });
    fm.set(def.key, list);
  }
  return fm;
}

function one(fm: FieldMap, key: string): FV | undefined {
  return fm.get(key)?.[0];
}
function many(fm: FieldMap, key: string): FV[] {
  return fm.get(key) ?? [];
}

function require1(fm: FieldMap, key: string, line: number, example: string, p: Problems): FV | undefined {
  const v = one(fm, key);
  if (!v) p.err(line, `Expected a "${key}:" line here, for example "- ${key}: ${example}".`);
  return v;
}

function asBool(fv: FV | undefined, p: Problems): boolean | undefined {
  if (!fv) return undefined;
  const v = fv.value.toLowerCase();
  if (v === "yes" || v === "true") return true;
  if (v === "no" || v === "false") return false;
  p.err(fv.line, `Expected yes or no, but found "${fv.value}".`);
  return undefined;
}

function asInt(fv: FV | undefined, p: Problems): number | undefined {
  if (!fv) return undefined;
  if (!/^\d+$/.test(fv.value)) {
    p.err(fv.line, `Expected a whole number, but found "${fv.value}".`);
    return undefined;
  }
  return Number(fv.value);
}

function asId(fv: FV | undefined, p: Problems): string | undefined {
  if (!fv) return undefined;
  if (!ID_RE.test(fv.value)) {
    p.err(fv.line, `An id uses only letters, digits, hyphens and underscores (like cellar_stairs). "${fv.value}" does not.`);
    return undefined;
  }
  return fv.value;
}

function asWord(fv: FV, what: string, p: Problems): string | undefined {
  if (!WORD_RE.test(fv.value)) {
    p.err(fv.line, `${what} uses only letters, digits, hyphens and underscores, with no spaces. "${fv.value}" does not.`);
    return undefined;
  }
  return fv.value;
}

function ref(cands: Cand[], fv: FV, noun: string, p: Problems): string | undefined {
  const r = lookup(cands, fv.value);
  if (r.id) return r.id;
  if (r.ambiguous) {
    p.err(fv.line, `"${fv.value}" fits more than one ${noun}: ${r.ambiguous.join(", ")}. Use the id to be exact.`);
    return undefined;
  }
  p.err(fv.line, `"${fv.value}" is not ${/^[aeiou]|^NPC/i.test(noun) ? "an" : "a"} ${noun} in this file. Defined: ${listCands(cands)}.`);
  return undefined;
}

/** Quote paragraphs (or plain paragraphs) as one string: lines of a paragraph join with a space, paragraphs with a blank line. */
function paragraphs(items: Body[], kind: "quote" | "text"): string {
  const paras: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.length > 0) paras.push(cur.join(" "));
    cur = [];
  };
  for (const it of items) {
    if (it.t === kind) {
      if (it.text === "") flush();
      else cur.push(it.text);
    } else flush();
  }
  flush();
  return paras.join("\n\n");
}

function bulletList(items: Body[], where: string, p: Problems): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (it.t === "blank") continue;
    if (it.t === "bullet") {
      if (it.text) out.push(it.text);
      else p.err(it.line, "This bullet is empty.");
    } else if (it.t === "text") p.err(it.line, `Expected a bullet starting with "-" ${where}, but this line is plain text.`);
    else if (it.t === "quote") p.err(it.line, `A quote is not expected ${where}. Write each entry as a bullet starting with "-".`);
    else p.err(it.line, `A code block is not expected ${where}.`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Names

const CLASS_NAMES: Record<string, Chassis | "default"> = {
  default: "default",
  fighter: "fighter",
  knight: "fighter",
  rogue: "rogue",
  shadow: "rogue",
  wizard: "wizard",
  "fireball person": "wizard",
  "fireball-person": "wizard",
  cleric: "cleric",
  healer: "cleric",
};

const CLASS_ORDER: (Chassis | "default")[] = ["default", "fighter", "rogue", "wizard", "cleric"];

const STATIC_SECTIONS: Record<string, string> = {
  summary: "summary",
  truths: "truths",
  truth: "truths",
  "dm must": "dmMust",
  "the dm must": "dmMust",
  "dm never": "dmNever",
  "the dm never": "dmNever",
  hooks: "hooks",
  hook: "hooks",
  "starting kit": "kit",
  "starting kits": "kit",
};

const PREFIXED = /^(location|npc|item|scene)\s*:\s*(\S.*)$/i;

function deriveId(name: string, explicit: FV | undefined, line: number, p: Problems): string {
  const given = asId(explicit, p);
  if (given) return given;
  const slug = slugify(name);
  if (!slug) {
    p.err(line, `"${name}" cannot be turned into an id (it has no letters or digits). Add a line like "- id: tavern".`);
    return "unnamed";
  }
  return slug;
}

function idFromHeading(text: string, line: number, p: Problems): string {
  if (ID_RE.test(text)) return text;
  const slug = slugify(text);
  if (!slug) {
    p.err(line, `"${text}" cannot be turned into an id. Use letters, digits, hyphens and underscores.`);
    return "unnamed";
  }
  return slug;
}

// ---------------------------------------------------------------------------
// Raw (phase A) shapes

const SCENE_SUBS = "Objective: text, Beat: id, Next, Ending";
const LOC_SUBS = "Map, Legend, Feature: name, Spawn: id, Exit: label";

interface RawLegend {
  char: string;
  line: number;
  tile: string;
  prop?: string;
  start?: boolean;
  feature?: FV;
  spawn?: FV;
  exit?: FV;
}
interface RawFeature {
  node: Node;
  id: string;
  name: string;
  fm: FieldMap;
}
interface RawSpawn {
  node: Node;
  id: string;
  fm: FieldMap;
}
interface RawExit {
  node: Node;
  id: string;
  label: string;
  fm: FieldMap;
}
interface RawLocation {
  node: Node;
  id: string;
  name: string;
  fm: FieldMap;
  map?: { rows: string[]; rowLines: number[] };
  mapNode?: Node;
  legend: RawLegend[];
  legendNode?: Node;
  features: RawFeature[];
  spawns: RawSpawn[];
  exits: RawExit[];
}
interface RawNamed {
  node: Node;
  id: string;
  name: string;
  fm: FieldMap;
}
interface RawObjective {
  node: Node;
  id: string;
  text: string;
  fm: FieldMap;
}
interface RawBeat {
  node: Node;
  id: string;
  fm: FieldMap;
}
interface RawScene {
  node: Node;
  id: string;
  title: string;
  fm: FieldMap;
  objectives: RawObjective[];
  beats: RawBeat[];
  next?: Node;
  ending?: Node;
}

const HEADER_FIELDS: FieldDef[] = [
  { key: "id" },
  { key: "version" },
  { key: "author" },
  { key: "levels", aliases: ["level", "level range"] },
  { key: "tone" },
  { key: "start scene" },
  { key: "start location" },
  { key: "start at" },
];
const LOCATION_FIELDS: FieldDef[] = [{ key: "id" }, { key: "dm notes", aliases: ["dm note", "notes"] }];
const FEATURE_FIELDS: FieldDef[] = [
  { key: "id" },
  { key: "description" },
  { key: "secret" },
  { key: "search dc", aliases: ["dc"] },
  { key: "gives", aliases: ["give"], multi: true },
  { key: "once" },
];
const SPAWN_FIELDS: FieldDef[] = [
  { key: "creature" },
  { key: "count" },
  { key: "hostile" },
  { key: "awake" },
  { key: "npc" },
  { key: "appears when" },
];
const EXIT_FIELDS: FieldDef[] = [
  { key: "id" },
  { key: "to" },
  { key: "arrive at", aliases: ["arrives at"] },
  { key: "open when", aliases: ["requires"] },
  { key: "locked text" },
];
const NPC_FIELDS: FieldDef[] = [
  { key: "id" },
  { key: "role" },
  { key: "personality" },
  { key: "token" },
  { key: "wants" },
  { key: "knows", aliases: ["know"], multi: true },
  { key: "secret", aliases: ["secrets"], multi: true },
  { key: "voice" },
  { key: "location" },
];
const ITEM_FIELDS: FieldDef[] = [{ key: "id" }, { key: "description" }, { key: "quest" }, { key: "usable" }, { key: "use says" }];
const SCENE_FIELDS: FieldDef[] = [{ key: "id" }, { key: "location" }];
const OBJECTIVE_FIELDS: FieldDef[] = [{ key: "id" }, { key: "hidden" }, { key: "done when" }];
const BEAT_FIELDS: FieldDef[] = [
  { key: "when" },
  { key: "sets flag", aliases: ["set flag", "sets flags"], multi: true },
  { key: "gives", aliases: ["give"], multi: true },
  { key: "spawns", aliases: ["spawn"], multi: true },
  { key: "once" },
];
const KIT_FIELDS: FieldDef[] = [{ key: "weapon" }, { key: "armor" }, { key: "potions", aliases: ["potion"] }, { key: "item", aliases: ["items"], multi: true }];
const HOOK_FIELDS: FieldDef[] = [
  { key: "default" },
  { key: "fighter", aliases: ["knight"] },
  { key: "rogue", aliases: ["shadow"] },
  { key: "wizard", aliases: ["fireball person"] },
  { key: "cleric", aliases: ["healer"] },
];

function creatureId(v: string): string {
  const t = v.trim();
  return /\s|[A-Z]/.test(t) ? t.toLowerCase().replace(/\s+/g, "-") : t;
}

// ---------------------------------------------------------------------------
// Parsing

function parseMap(node: Node, p: Problems): RawLocation["map"] {
  const fences = node.items.filter((i): i is FenceTok => i.t === "fence");
  for (const it of node.items) {
    if (it.t !== "fence" && it.t !== "blank") {
      p.err(it.line, `Only the map belongs under ### Map: a fenced block (three backticks) of ${CELL_HEIGHT} lines of ${CELL_WIDTH} characters.`);
      break;
    }
  }
  if (fences.length === 0) {
    p.err(node.line, `Expected a fenced block here: a line of three backticks, ${CELL_HEIGHT} map rows of ${CELL_WIDTH} characters, then three backticks.`);
    return undefined;
  }
  if (fences.length > 1) p.err(fences[1]!.line, "A location has one map. This is a second code block.");
  const f = fences[0]!;
  let ok = true;
  if (f.rows.length !== CELL_HEIGHT) {
    ok = false;
    if (f.rows.length < CELL_HEIGHT) p.err(f.line, `The map has ${f.rows.length} rows but needs exactly ${CELL_HEIGHT}. Add ${CELL_HEIGHT - f.rows.length} more.`);
    else p.err(f.rows[CELL_HEIGHT]!.line, `The map has ${f.rows.length} rows but needs exactly ${CELL_HEIGHT}. Remove row ${CELL_HEIGHT + 1} onward (this line and ${f.rows.length - CELL_HEIGHT - 1} more).`);
  }
  for (const r of f.rows) {
    const text = r.text.replace(/\s+$/, "");
    if (text.length !== r.text.length) {
      ok = false;
      p.err(r.line, `This map row ends with ${r.text.length - text.length} space(s). Remove them: every row is exactly ${CELL_WIDTH} visible characters.`);
      continue;
    }
    if (text.length !== CELL_WIDTH) {
      ok = false;
      const diff = text.length - CELL_WIDTH;
      p.err(r.line, `This map row has ${text.length} characters but needs exactly ${CELL_WIDTH} (${diff < 0 ? `${-diff} too few` : `${diff} too many`}).`);
      continue;
    }
    for (let x = 0; x < text.length; x++) {
      const code = text.charCodeAt(x);
      if (code < 33 || code > 126) {
        ok = false;
        p.err(r.line, code === 32 ? `Column ${x + 1} of this map row is a space. Use a visible character (like . for floor); every character of the map is one square.` : `Column ${x + 1} of this map row is not a plain keyboard character. Use letters, digits and punctuation.`);
        break;
      }
    }
  }
  if (!ok) return undefined;
  return { rows: f.rows.map((r) => r.text), rowLines: f.rows.map((r) => r.line) };
}

const LEGEND_RE = /^`(.)`\s*=\s*(.+)$/;

function parseLegend(node: Node, p: Problems): RawLegend[] {
  const out: RawLegend[] = [];
  const seen = new Map<string, number>();
  for (const it of node.items) {
    if (it.t === "blank") continue;
    if (it.t !== "bullet" && it.t !== "text") {
      p.err(it.line, "Under ### Legend, write one bullet per map character, like: - `#` = wall_stone");
      continue;
    }
    const m = LEGEND_RE.exec(it.text);
    if (!m) {
      p.err(it.line, `Expected a legend line like: - \`#\` = wall_stone (the map character in backticks, an equals sign, then the floor tile). Found "${it.text.slice(0, 50)}".`);
      continue;
    }
    const char = m[1]!;
    const code = char.charCodeAt(0);
    if (char === "`" || code < 33 || code > 126) {
      p.err(it.line, "A legend character must be one visible keyboard character (not a space or a backtick).");
      continue;
    }
    if (seen.has(char)) {
      p.err(it.line, `The character "${char}" is already in the legend (line ${seen.get(char)}).`);
      continue;
    }
    seen.set(char, it.line);
    const parts = m[2]!.split(",").map((s) => s.trim()).filter(Boolean);
    let tile: string | undefined;
    const entry: RawLegend = { char, line: it.line, tile: "" };
    const used = new Set<string>();
    let bad = false;
    parts.forEach((part, idx) => {
      const km = /^(tile|prop|feature|spawn|exit)\s+(.+)$/i.exec(part);
      if (/^start$/i.test(part)) {
        if (used.has("start")) p.err(it.line, `"start" is given twice for "${char}".`);
        used.add("start");
        entry.start = true;
        return;
      }
      if (km) {
        const kind = km[1]!.toLowerCase();
        const value = km[2]!.trim();
        if (used.has(kind)) {
          p.err(it.line, `"${kind}" is given twice for "${char}".`);
          bad = true;
          return;
        }
        used.add(kind);
        if (kind === "tile") tile = value;
        else if (kind === "prop") entry.prop = value;
        else entry[kind as "feature" | "spawn" | "exit"] = { line: it.line, value };
        return;
      }
      if (idx === 0 && WORD_RE.test(part)) {
        tile = part;
        used.add("tile");
        return;
      }
      bad = true;
      p.err(it.line, `Did not understand "${part}" in the legend line for "${char}". After the floor tile, use: prop NAME, feature NAME, spawn NAME, exit NAME, start (separated by commas).`);
    });
    if (bad) continue;
    if (!tile) {
      p.err(it.line, `Expected the floor tile first in the legend line for "${char}", like: - \`${char}\` = floor_stone`);
      continue;
    }
    if (!WORD_RE.test(tile)) {
      p.err(it.line, `"${tile}" is not a tile id. Tile ids look like floor_stone.`);
      continue;
    }
    if (entry.prop !== undefined && !WORD_RE.test(entry.prop)) {
      p.err(it.line, `"${entry.prop}" is not a prop id. Prop ids look like chest.`);
      continue;
    }
    entry.tile = tile;
    out.push(entry);
  }
  return out;
}

export function parseAdventureMarkdown(text: string, opts: { file?: string } = {}): MarkdownParseResult {
  const p = new Problems();
  const { toks } = scan(text, p);
  const { preface, title, sections } = buildTree(toks, p);

  const fail = (): MarkdownParseResult => ({ adventure: null, errors: sortIssues(p.errors), warnings: sortIssues(p.warnings) });

  // ---- title and header ----
  const firstPre = preface.find((i) => i.t !== "blank");
  if (firstPre) p.err(firstPre.line, "Expected the adventure title first, written like: # The Rat Cellar");
  if (!title) {
    if (!firstPre) p.err(1, "Expected the adventure title first, written like: # The Rat Cellar");
    return fail();
  }
  const titleText = title.heading;
  const header = readFields(title.items, HEADER_FIELDS, "in the header under the title", p);

  // ---- classify sections ----
  const slots: Record<string, Node | undefined> = {};
  const locNodes: { node: Node; name: string }[] = [];
  const npcNodes: { node: Node; name: string }[] = [];
  const itemNodes: { node: Node; name: string }[] = [];
  const sceneNodes: { node: Node; name: string }[] = [];

  const SECTION_LIST = "Summary, Truths, DM must, DM never, Hooks, Starting kit, Location: name, NPC: name, Item: name, Scene: name";
  for (const sec of sections) {
    const key = sec.heading.toLowerCase().replace(/\s+/g, " ").replace(/:+$/, "").trim();
    const st = STATIC_SECTIONS[key];
    if (st) {
      if (slots[st]) {
        p.err(sec.line, `The section "${sec.heading}" appears twice (first on line ${slots[st]!.line}). Keep one.`);
        continue;
      }
      slots[st] = sec;
      if (st !== "kit" && sec.children.length > 0) p.err(sec.children[0]!.line, `The section "${sec.heading}" has no ### sub-sections.`);
      continue;
    }
    const pm = PREFIXED.exec(sec.heading);
    if (pm) {
      const entry = { node: sec, name: pm[2]!.trim() };
      const kind = pm[1]!.toLowerCase();
      if (kind === "location") locNodes.push(entry);
      else if (kind === "npc") npcNodes.push(entry);
      else if (kind === "item") itemNodes.push(entry);
      else sceneNodes.push(entry);
      continue;
    }
    const hint = didYouMean(key.replace(/:.*$/, ""), ["summary", "truths", "dm must", "dm never", "hooks", "starting kit", "location", "npc", "item", "scene"]);
    p.err(sec.line, `"${sec.heading}" is not a section I know.${hint ? ` Did you mean "${hint}"? (Locations, NPCs, items and scenes are written "Location: Name".)` : ""} The sections are: ${SECTION_LIST}.`);
  }
  const summaryNode = slots.summary;
  const truthsNode = slots.truths;
  const mustNode = slots.dmMust;
  const neverNode = slots.dmNever;
  const hooksNode = slots.hooks;
  const kitNode = slots.kit;

  // ---- phase A: names ----
  const locations: RawLocation[] = [];
  const npcs: RawNamed[] = [];
  const items: RawNamed[] = [];
  const scenes: RawScene[] = [];
  const dup = (seen: Map<string, number>, id: string, line: number, what: string): void => {
    const first = seen.get(id);
    if (first !== undefined) p.err(line, `Two ${what}s would have the id "${id}" (the other is on line ${first}). Give one an "- id:" line.`);
    else seen.set(id, line);
  };

  const locSeen = new Map<string, number>();
  const spawnSeen = new Map<string, number>();
  for (const { node, name } of locNodes) {
    const fm = readFields(node.items, LOCATION_FIELDS, "for a location", p, { quote: true });
    const id = deriveId(name, one(fm, "id"), node.line, p);
    dup(locSeen, id, node.line, "location");
    const raw: RawLocation = { node, id, name, fm, legend: [], features: [], spawns: [], exits: [] };
    const featSeen = new Map<string, number>();
    const exitSeen = new Map<string, number>();
    for (const ch of node.children) {
      const key = ch.heading.toLowerCase().replace(/\s+/g, " ").replace(/:+$/, "").trim();
      const sub = /^(feature|spawn|exit)\s*:\s*(\S.*)$/i.exec(ch.heading);
      if (key === "map") {
        if (raw.mapNode) p.err(ch.line, `This location already has a map (line ${raw.mapNode.line}).`);
        else {
          raw.mapNode = ch;
          raw.map = parseMap(ch, p);
        }
      } else if (key === "legend") {
        if (raw.legendNode) p.err(ch.line, `This location already has a legend (line ${raw.legendNode.line}).`);
        else {
          raw.legendNode = ch;
          raw.legend = parseLegend(ch, p);
        }
      } else if (sub) {
        const kind = sub[1]!.toLowerCase();
        const label = sub[2]!.trim();
        if (kind === "feature") {
          const f = readFields(ch.items, FEATURE_FIELDS, "for a feature", p);
          const fid = deriveId(label, one(f, "id"), ch.line, p);
          dup(featSeen, fid, ch.line, "feature");
          raw.features.push({ node: ch, id: fid, name: label, fm: f });
        } else if (kind === "spawn") {
          const f = readFields(ch.items, SPAWN_FIELDS, "for a spawn", p);
          const sid = idFromHeading(label, ch.line, p);
          dup(spawnSeen, sid, ch.line, "spawn");
          raw.spawns.push({ node: ch, id: sid, fm: f });
        } else {
          const f = readFields(ch.items, EXIT_FIELDS, "for an exit", p);
          const eid = deriveId(label, one(f, "id"), ch.line, p);
          dup(exitSeen, eid, ch.line, "exit");
          raw.exits.push({ node: ch, id: eid, label, fm: f });
        }
      } else {
        const hint = didYouMean(key.replace(/:.*$/, ""), ["map", "legend", "feature", "spawn", "exit"]);
        p.err(ch.line, `"${ch.heading}" is not a sub-section of a location.${hint ? ` Did you mean "${hint}"?` : ""} Use: ${LOC_SUBS}.`);
      }
    }
    locations.push(raw);
  }

  const npcSeen = new Map<string, number>();
  for (const { node, name } of npcNodes) {
    const fm = readFields(node.items, NPC_FIELDS, "for an NPC", p);
    const id = deriveId(name, one(fm, "id"), node.line, p);
    dup(npcSeen, id, node.line, "NPC");
    if (node.children.length > 0) p.err(node.children[0]!.line, "An NPC has no ### sub-sections.");
    npcs.push({ node, id, name, fm });
  }
  const itemSeen = new Map<string, number>();
  for (const { node, name } of itemNodes) {
    const fm = readFields(node.items, ITEM_FIELDS, "for an item", p);
    const id = deriveId(name, one(fm, "id"), node.line, p);
    dup(itemSeen, id, node.line, "item");
    if (node.children.length > 0) p.err(node.children[0]!.line, "An item has no ### sub-sections.");
    items.push({ node, id, name, fm });
  }
  const sceneSeen = new Map<string, number>();
  const objSeen = new Map<string, number>();
  const beatSeen = new Map<string, number>();
  for (const { node, name } of sceneNodes) {
    const fm = readFields(node.items, SCENE_FIELDS, "for a scene", p, { quote: true });
    const id = deriveId(name, one(fm, "id"), node.line, p);
    dup(sceneSeen, id, node.line, "scene");
    const raw: RawScene = { node, id, title: name, fm, objectives: [], beats: [] };
    for (const ch of node.children) {
      const key = ch.heading.toLowerCase().replace(/\s+/g, " ").replace(/:+$/, "").trim();
      const sub = /^(objective|beat)\s*:\s*(\S.*)$/i.exec(ch.heading);
      if (sub && sub[1]!.toLowerCase() === "objective") {
        const f = readFields(ch.items, OBJECTIVE_FIELDS, "for an objective", p);
        const text1 = sub[2]!.trim();
        const oid = deriveId(text1, one(f, "id"), ch.line, p);
        dup(objSeen, oid, ch.line, "objective");
        raw.objectives.push({ node: ch, id: oid, text: text1, fm: f });
      } else if (sub) {
        const f = readFields(ch.items, BEAT_FIELDS, "for a beat", p, { quote: true });
        const bid = idFromHeading(sub[2]!.trim(), ch.line, p);
        dup(beatSeen, bid, ch.line, "beat");
        raw.beats.push({ node: ch, id: bid, fm: f });
      } else if (key === "next") {
        if (raw.next) p.err(ch.line, `This scene already has a ### Next (line ${raw.next.line}).`);
        else raw.next = ch;
      } else if (key === "ending") {
        if (raw.ending) p.err(ch.line, `This scene already has a ### Ending (line ${raw.ending.line}).`);
        else raw.ending = ch;
      } else {
        const hint = didYouMean(key.replace(/:.*$/, ""), ["objective", "beat", "next", "ending"]);
        p.err(ch.line, `"${ch.heading}" is not a sub-section of a scene.${hint ? ` Did you mean "${hint}"?` : ""} Use: ${SCENE_SUBS}.`);
      }
    }
    scenes.push(raw);
  }

  // ---- registries ----
  const locCands: Cand[] = locations.map((l) => ({ id: l.id, names: [l.name] }));
  const npcCands: Cand[] = npcs.map((n) => ({ id: n.id, names: [n.name] }));
  const itemCands: Cand[] = items.map((i) => ({ id: i.id, names: [i.name] }));
  const sceneCands: Cand[] = scenes.map((s) => ({ id: s.id, names: [s.title] }));
  const objCands: Cand[] = scenes.flatMap((s) => s.objectives.map((o) => ({ id: o.id, names: [o.text] })));
  const spawnCands: Cand[] = locations.flatMap((l) => l.spawns.map((s) => ({ id: s.id, names: [] })));
  const cctx: ConditionContext = { locations: locCands, npcs: npcCands, items: itemCands, objectives: objCands };

  const cond = (fv: FV): Condition | undefined => {
    try {
      return parseConditionPhrase(fv.value, cctx);
    } catch (e) {
      p.err(fv.line, (e as Error).message);
      return undefined;
    }
  };

  // ---- header ----
  const fileSlug = opts.file ? slugify((opts.file.split(/[\\/]/).pop() ?? "").replace(/\.[A-Za-z0-9]+$/, "")) : "";
  const advId = asId(one(header, "id"), p) ?? (slugify(titleText) || fileSlug || "adventure");
  const versionFV = one(header, "version");
  let version = 1;
  if (versionFV) version = asInt(versionFV, p) ?? 1;
  else p.warn(title.line, 'The header has no "- version:" line, so this is version 1. Bump it when saved games should treat the adventure as changed.');
  const authorFV = one(header, "author");
  let author: "owner" | "ai" = "owner";
  if (authorFV) {
    const v = authorFV.value.toLowerCase();
    if (v === "owner" || v === "ai") author = v;
    else p.err(authorFV.line, `The author is "owner" or "ai", not "${authorFV.value}".`);
  } else p.warn(title.line, 'The header has no "- author:" line, so the author is "owner".');
  let levelRange: [number, number] | undefined;
  const levelsFV = one(header, "levels");
  if (levelsFV) {
    const m = /^(\d+)\s*(?:to|-)\s*(\d+)$/i.exec(levelsFV.value) ?? /^(\d+)$/.exec(levelsFV.value);
    if (!m) p.err(levelsFV.line, `Expected levels like "1 to 3" or "2", but found "${levelsFV.value}".`);
    else levelRange = [Number(m[1]), Number(m[2] ?? m[1])];
  }
  const tone = one(header, "tone")?.value;

  // ---- summary, lists, hooks, kits ----
  let summary = "";
  if (!summaryNode) p.err(title.line, "Expected a ## Summary section: a short paragraph saying what the adventure is.");
  else {
    for (const it of summaryNode.items) if (it.t === "bullet" || it.t === "fence") p.err(it.line, "Write the summary as plain sentences, not as a list or a code block.");
    summary = [paragraphs(summaryNode.items, "text"), paragraphs(summaryNode.items, "quote")].filter(Boolean).join("\n\n");
    if (!summary) p.err(summaryNode.line, "The ## Summary section is empty. Write a sentence or two under it.");
  }
  const listOf = (n: Node | undefined, label: string): string[] => {
    if (!n) return [];
    const out = bulletList(n.items, `under ## ${label}`, p);
    if (out.length === 0) p.warn(n.line, `The ## ${label} section has no bullets.`);
    return out;
  };
  const truths = listOf(truthsNode, "Truths");
  const dmMust = listOf(mustNode, "DM must");
  const dmNever = listOf(neverNode, "DM never");

  const hooks: Adventure["hooks"] = {};
  if (hooksNode) {
    const hf = readFields(hooksNode.items, HOOK_FIELDS, "under ## Hooks", p);
    for (const [k, list] of hf) hooks[k as Chassis | "default"] = list[0]!.value;
  }

  const startingKit: Adventure["startingKit"] = {};
  if (kitNode) {
    for (const it of kitNode.items) if (it.t !== "blank") p.err(it.line, "Under ## Starting kit, put each class under its own ### heading (### fighter, ### rogue, ### wizard, ### default).");
    for (const ch of kitNode.children) {
      const cls = CLASS_NAMES[ch.heading.toLowerCase().replace(/\s+/g, " ").trim()];
      if (!cls) {
        p.err(ch.line, `"${ch.heading}" is not a class. Use fighter, rogue, wizard, cleric or default (knight, shadow, fireball person and healer also work).`);
        continue;
      }
      if (startingKit[cls]) {
        p.err(ch.line, `The starting kit for "${cls}" is given twice.`);
        continue;
      }
      const kf = readFields(ch.items, KIT_FIELDS, "in a starting kit", p);
      const armorFV = require1(kf, "armor", ch.line, "none", p);
      let armor: "none" | "class" = "none";
      if (armorFV) {
        const v = armorFV.value.toLowerCase();
        if (v === "none" || v === "class") armor = v;
        else p.err(armorFV.line, `armor is "none" (the hero wears nothing) or "class" (the class's normal armor), not "${armorFV.value}".`);
      }
      const kit: StartingKit = { armor, items: many(kf, "item").map((f) => f.value), potions: asInt(one(kf, "potions"), p) ?? 0 };
      const wn = one(kf, "weapon");
      if (wn) kit.weaponNote = wn.value;
      startingKit[cls] = kit;
    }
  }

  // ---- items ----
  const outItems: AdventureItem[] = items.map((r) => {
    const desc = require1(r.fm, "description", r.node.line, "A rusted iron key.", p);
    const it: AdventureItem = { id: r.id, name: r.name, description: desc?.value ?? "" };
    const q = asBool(one(r.fm, "quest"), p);
    if (q !== undefined) it.quest = q;
    const u = asBool(one(r.fm, "usable"), p);
    if (u !== undefined) it.usable = u;
    const us = one(r.fm, "use says");
    if (us) it.useSay = us.value;
    return it;
  });

  // ---- npcs ----
  const outNpcs: AdventureNpc[] = npcs.map((r) => {
    const role = require1(r.fm, "role", r.node.line, "innkeeper", p);
    const pers = require1(r.fm, "personality", r.node.line, "Brisk and kind.", p);
    const token = require1(r.fm, "token", r.node.line, "token_villager", p);
    const npc: AdventureNpc = {
      id: r.id,
      name: r.name,
      token: token ? (asWord(token, "A token id", p) ?? "") : "",
      role: role?.value ?? "",
      personality: pers?.value ?? "",
      knows: many(r.fm, "knows").map((f) => f.value),
    };
    const wants = one(r.fm, "wants");
    if (wants) npc.wants = wants.value;
    const secrets = many(r.fm, "secret");
    if (secrets.length > 0) npc.secrets = secrets.map((f) => f.value);
    const voice = one(r.fm, "voice");
    if (voice) npc.voice = voice.value;
    const loc = one(r.fm, "location");
    if (loc) {
      const id = ref(locCands, loc, "location", p);
      if (id) npc.location = id;
    }
    return npc;
  });

  // ---- locations ----
  const outLocations: AdventureLocation[] = locations.map((r) => {
    const readAloud = paragraphs(r.node.items, "quote");
    if (!readAloud) p.err(r.node.line, "Expected the read-aloud text here: a quote, with each line starting with >.");
    const loc: AdventureLocation = { id: r.id, name: r.name, readAloud, map: { rows: [], legend: {} }, features: [], spawns: [], exits: [] };
    const notes = one(r.fm, "dm notes");
    if (notes) loc.dmNotes = notes.value;

    if (!r.mapNode) p.err(r.node.line, `This location needs a ### Map section with a fenced block of ${CELL_HEIGHT} rows of ${CELL_WIDTH} characters.`);
    if (!r.legendNode) p.err(r.node.line, "This location needs a ### Legend section saying what each map character is.");
    const featCands: Cand[] = r.features.map((f) => ({ id: f.id, names: [f.name] }));
    const spawnLocal: Cand[] = r.spawns.map((s) => ({ id: s.id, names: [] }));
    const exitCands: Cand[] = r.exits.map((e) => ({ id: e.id, names: [e.label] }));

    const legend: Record<string, LegendEntry> = {};
    for (const le of r.legend) {
      const entry: LegendEntry = { tile: le.tile };
      if (le.prop) entry.prop = le.prop;
      if (le.feature) {
        const id = ref(featCands, le.feature, "feature of this location", p);
        if (id) entry.feature = id;
      }
      if (le.spawn) {
        const id = ref(spawnLocal, le.spawn, "spawn of this location", p);
        if (id) entry.spawn = id;
      }
      if (le.exit) {
        const id = ref(exitCands, le.exit, "exit of this location", p);
        if (id) entry.exit = id;
      }
      if (le.start) entry.start = true;
      legend[le.char] = entry;
    }
    if (r.map) {
      const map = r.map;
      map.rows.forEach((row, y) => {
        const reported = new Set<string>();
        for (let x = 0; x < row.length; x++) {
          const ch = row[x]!;
          if (!legend[ch] && !reported.has(ch)) {
            reported.add(ch);
            p.err(map.rowLines[y]!, `Column ${x + 1} of this map row uses "${ch}", which the ### Legend does not define. Add a line like: - \`${ch}\` = floor_stone`);
          }
        }
      });
      loc.map = { rows: map.rows, legend };
    } else loc.map = { rows: [], legend };

    for (const f of r.features) {
      const desc = require1(f.fm, "description", f.node.line, "A barrel with its side gnawed through.", p);
      const feat: AdventureFeature = { id: f.id, name: f.name, description: desc?.value ?? "" };
      const sec = one(f.fm, "secret");
      if (sec) feat.secret = sec.value;
      const dc = asInt(one(f.fm, "search dc"), p);
      if (dc !== undefined) feat.searchDc = dc;
      const gives = many(f.fm, "gives");
      if (gives.length > 0) feat.gives = gives.map((g) => g.value);
      const once = asBool(one(f.fm, "once"), p);
      if (once !== undefined) feat.once = once;
      loc.features.push(feat);
    }
    for (const s of r.spawns) {
      const cr = require1(s.fm, "creature", s.node.line, "goblin", p);
      const hostile = require1(s.fm, "hostile", s.node.line, "yes", p);
      const awake = require1(s.fm, "awake", s.node.line, "yes", p);
      const spawn: AdventureSpawn = { id: s.id, creature: cr ? creatureId(cr.value) : "", hostile: asBool(hostile, p) ?? false, awake: asBool(awake, p) ?? false };
      const count = asInt(one(s.fm, "count"), p);
      if (count !== undefined) spawn.count = count;
      const npc = one(s.fm, "npc");
      if (npc) {
        const id = ref(npcCands, npc, "NPC", p);
        if (id) spawn.npcId = id;
      }
      const aw = one(s.fm, "appears when");
      if (aw) {
        const c = cond(aw);
        if (c) spawn.appearsWhen = c;
      }
      loc.spawns.push(spawn);
    }
    for (const e of r.exits) {
      const toFV = require1(e.fm, "to", e.node.line, "The Cellar", p);
      const arriveFV = require1(e.fm, "arrive at", e.node.line, "Stairs up", p);
      const toId = toFV ? ref(locCands, toFV, "location", p) : undefined;
      let arriveAt = "";
      if (arriveFV && toId) {
        if (arriveFV.value.toLowerCase() === "start") arriveAt = "start";
        else {
          const target = locations.find((l) => l.id === toId);
          const tc: Cand[] = (target?.exits ?? []).map((x) => ({ id: x.id, names: [x.label] }));
          arriveAt = ref(tc, arriveFV, `exit of ${target?.name ?? toId} (or "start")`, p) ?? "";
        }
      }
      const exit: AdventureExit = { id: e.id, to: toId ?? "", arriveAt, label: e.label };
      const rq = one(e.fm, "open when");
      if (rq) {
        const c = cond(rq);
        if (c) exit.requires = c;
      }
      const lt = one(e.fm, "locked text");
      if (lt) exit.lockedText = lt.value;
      loc.exits.push(exit);
    }
    return loc;
  });

  // ---- scenes ----
  const outScenes: AdventureScene[] = scenes.map((r) => {
    const scene: AdventureScene = { id: r.id, title: r.title, objectives: [], beats: [], next: [] };
    const locFV = one(r.fm, "location");
    if (locFV) {
      const id = ref(locCands, locFV, "location", p);
      if (id) scene.location = id;
    }
    const opening = paragraphs(r.node.items, "quote");
    if (opening) scene.opening = opening;

    for (const o of r.objectives) {
      const dw = require1(o.fm, "done when", o.node.line, "the player talks to Marta", p);
      const doneWhen = dw ? cond(dw) : undefined;
      const obj: AdventureObjective = { id: o.id, text: o.text, doneWhen: doneWhen ?? { always: true } };
      const hid = asBool(one(o.fm, "hidden"), p);
      if (hid !== undefined) obj.hidden = hid;
      scene.objectives.push(obj);
    }
    for (const b of r.beats) {
      const w = require1(b.fm, "when", b.node.line, "the flag rats_cleared is set", p);
      const when = w ? cond(w) : undefined;
      const beat: AdventureBeat = { id: b.id, when: when ?? { always: true } };
      const narrate = paragraphs(b.node.items, "quote");
      if (narrate) beat.narrate = narrate;
      const flags = many(b.fm, "sets flag");
      if (flags.length > 0) beat.setFlags = flags.map((f) => asWord(f, "A flag name", p) ?? "");
      const gives = many(b.fm, "gives");
      if (gives.length > 0) beat.give = gives.map((g) => g.value);
      const sp = many(b.fm, "spawns");
      if (sp.length > 0) beat.spawn = sp.map((s) => ref(spawnCands, s, "spawn", p) ?? "");
      const once = asBool(one(b.fm, "once"), p);
      if (once !== undefined) beat.once = once;
      scene.beats.push(beat);
    }
    if (r.next) {
      for (const it of r.next.items) {
        if (it.t === "blank") continue;
        if (it.t !== "bullet") {
          p.err(it.line, 'Under ### Next, write one bullet per way out, like: - Quiet at last when the flag goblin_gone is set');
          continue;
        }
        const words = it.text.split(/\s+/);
        let done = false;
        for (let j = 1; j < words.length; j++) {
          if (words[j]!.toLowerCase() !== "when") continue;
          const r1 = lookup(sceneCands, words.slice(0, j).join(" "));
          if (!r1.id) continue;
          done = true;
          const condText = words.slice(j + 1).join(" ");
          if (!condText) {
            p.err(it.line, 'Expected a condition after "when", like: when the flag goblin_gone is set');
            break;
          }
          const c = cond({ line: it.line, value: condText });
          if (c) scene.next.push({ scene: r1.id, when: c });
          break;
        }
        if (!done) p.err(it.line, `Expected "<scene> when <condition>" with a scene defined in this file. Scenes: ${listCands(sceneCands)}. Found "${it.text.slice(0, 60)}".`);
      }
    }
    if (r.ending) {
      const ef = readFields(r.ending.items, [{ key: "outcome" }], "under ### Ending", p, { quote: true });
      const oc = require1(ef, "outcome", r.ending.line, "victory", p);
      const text1 = paragraphs(r.ending.items, "quote");
      if (!text1) p.err(r.ending.line, "Expected the ending text here: a quote, with each line starting with >.");
      let outcome: "victory" | "defeat" | "continue" = "continue";
      if (oc) {
        const v = oc.value.toLowerCase();
        if (v === "victory" || v === "defeat" || v === "continue") outcome = v;
        else p.err(oc.line, `The outcome is victory, defeat or continue, not "${oc.value}".`);
      }
      scene.ending = { text: text1, outcome };
    }
    return scene;
  });

  // ---- the start ----
  if (outLocations.length === 0) p.err(title.line, "Expected at least one ## Location: ... section.");
  if (outScenes.length === 0) p.err(title.line, "Expected at least one ## Scene: ... section.");
  let start: Adventure["start"] = { sceneId: "", locationId: "", at: { x: 0, y: 0 } };
  if (outLocations.length > 0 && outScenes.length > 0) {
    let sceneId = outScenes[0]!.id;
    const ssFV = one(header, "start scene");
    if (ssFV) sceneId = ref(sceneCands, ssFV, "scene", p) ?? sceneId;
    const startScene = outScenes.find((s) => s.id === sceneId);
    let locationId = startScene?.location ?? outLocations[0]!.id;
    const slFV = one(header, "start location");
    if (slFV) locationId = ref(locCands, slFV, "location", p) ?? locationId;
    const rawLoc = locations.find((l) => l.id === locationId);
    let at = { x: 0, y: 0 };
    const saFV = one(header, "start at");
    if (saFV) {
      const m = /^(\d+)\s*[, ]\s*(\d+)$/.exec(saFV.value);
      if (!m || Number(m[1]) < 1 || Number(m[2]) < 1) p.err(saFV.line, `Expected "start at:" as a column and a row counted from 1, like "6, 6". Found "${saFV.value}".`);
      else at = { x: Number(m[1]) - 1, y: Number(m[2]) - 1 };
    } else if (rawLoc?.map) {
      const marks: { x: number; y: number }[] = [];
      const legend = outLocations.find((l) => l.id === locationId)?.map.legend ?? {};
      rawLoc.map.rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) if (legend[row[x]!]?.start) marks.push({ x, y });
      });
      if (marks.length === 1) at = marks[0]!;
      else p.err(rawLoc.node.line, `The hero starts in ${rawLoc.name} (the first scene's place), so exactly one legend character there must be marked "start", for example: - \`@\` = floor_stone, start. This map has ${marks.length}.`);
    }
    start = { sceneId, locationId, at };
  }

  if (p.errors.length > 0) return fail();

  const adventure: Adventure = {
    id: advId,
    title: titleText,
    version,
    author,
    summary,
    truths,
    dmMust,
    dmNever,
    hooks,
    startingKit,
    locations: outLocations,
    npcs: outNpcs,
    items: outItems,
    scenes: outScenes,
    start,
  };
  if (levelRange) adventure.levelRange = levelRange;
  if (tone) adventure.tone = tone;
  return { adventure, errors: [], warnings: sortIssues(p.warnings) };
}

function sortIssues(list: MarkdownIssue[]): MarkdownIssue[] {
  return [...list].sort((a, b) => a.line - b.line);
}

/** The author's own notes that ask for a second look: HTML comments starting with ADDED, ADDITION or REVIEW. */
export function markedForReview(text: string): { line: number; text: string }[] {
  const { comments } = scan(text, new Problems());
  return comments.filter((c) => /^(added|addition|review)\b/i.test(c.text));
}

// ---------------------------------------------------------------------------
// Writing

interface NameFns {
  loc: (id: string) => string;
  npc: (id: string) => string;
  item: (id: string) => string;
  obj: (id: string) => string;
  spawnIds: Set<string>;
}

function fmtCondition(c: Condition, names: NameFns): string {
  const compound = (x: Condition): boolean => ("all" in x && x.all.length >= 2) || ("any" in x && x.any.length >= 2);
  const child = (x: Condition): string => (compound(x) ? `(${fmtCondition(x, names)})` : fmtCondition(x, names));
  if ("always" in c) return "always";
  if ("flag" in c) return `the flag ${c.flag} is set`;
  if ("all" in c) return c.all.length === 0 ? "always" : c.all.map(child).join(" and ");
  if ("any" in c) return c.any.length === 0 ? "never" : c.any.map(child).join(" or ");
  if ("not" in c) {
    if ("flag" in c.not) return `the flag ${c.not.flag} is not set`;
    return `not ${child(c.not)}`;
  }
  if ("killed" in c) {
    if (c.killed.startsWith("all:")) return `every spawn starting with ${c.killed.slice(4)} is killed`;
    return `the ${names.spawnIds.has(c.killed) ? "spawn" : "creature"} ${c.killed} is killed`;
  }
  if ("entered" in c) return `the player enters ${names.loc(c.entered)}`;
  if ("talkedTo" in c) return `the player talks to ${names.npc(c.talkedTo)}`;
  if ("has" in c) return `the player has ${names.item(c.has)}`;
  if ("objective" in c) return `the objective ${names.obj(c.objective)} is done`;
  return "always";
}

/**
 * Write an adventure as Markdown in the canonical layout of adventures/TEMPLATE.md.
 * Text is written on single lines (a line break inside a field becomes a space;
 * a blank line inside a quote stays a paragraph break). `parse(write(a))` equals
 * `a` for any adventure the parser can produce.
 */
export function adventureToMarkdown(a: Adventure): string {
  const out: string[] = [];
  const push = (...l: string[]) => void out.push(...l);
  const field = (key: string, value: string | number | boolean | undefined) => {
    if (value === undefined) return;
    const v = typeof value === "boolean" ? (value ? "yes" : "no") : oneLine(String(value));
    push(`- ${key}: ${v}`);
  };
  const quote = (text: string | undefined) => {
    if (!text) return;
    const paras = text.split(/\n\s*\n/).map(oneLine).filter(Boolean);
    paras.forEach((para, i) => {
      if (i > 0) push(">");
      push(`> ${para}`);
    });
    push("");
  };
  const heading = (level: number, text: string) => push(`${"#".repeat(level)} ${oneLine(text)}`, "");
  const endFields = () => {
    if (out[out.length - 1] !== "") push("");
  };

  const locCands: Cand[] = a.locations.map((l) => ({ id: l.id, names: [l.name] }));
  const npcCands: Cand[] = a.npcs.map((n) => ({ id: n.id, names: [n.name] }));
  const itemCands: Cand[] = a.items.map((i) => ({ id: i.id, names: [i.name] }));
  const sceneCands: Cand[] = a.scenes.map((s) => ({ id: s.id, names: [s.title] }));
  const objCands: Cand[] = a.scenes.flatMap((s) => s.objectives.map((o) => ({ id: o.id, names: [o.text] })));
  const ctx: ConditionContext = { locations: locCands, npcs: npcCands, items: itemCands, objectives: objCands };
  const spawnIds = new Set(a.locations.flatMap((l) => l.spawns.map((s) => s.id)));
  const nameOf = (cands: Cand[]) => (id: string) => {
    const n = cands.find((c) => c.id === id)?.names[0];
    return n && lookup(cands, oneLine(n)).id === id ? oneLine(n) : id;
  };
  const cond = (c: Condition): string => {
    const byName = fmtCondition(c, { loc: nameOf(locCands), npc: nameOf(npcCands), item: nameOf(itemCands), obj: nameOf(objCands), spawnIds });
    try {
      if (JSON.stringify(parseConditionPhrase(byName, ctx)) === JSON.stringify(c)) return byName;
    } catch {
      /* fall through to ids */
    }
    return fmtCondition(c, { loc: (i) => i, npc: (i) => i, item: (i) => i, obj: (i) => i, spawnIds });
  };
  const idField = (id: string, name: string) => {
    if (slugify(name) !== id) field("id", id);
  };

  // header
  push(`# ${oneLine(a.title)}`, "");
  idField(a.id, a.title);
  field("version", a.version);
  field("author", a.author);
  if (a.levelRange) field("levels", a.levelRange[0] === a.levelRange[1] ? String(a.levelRange[0]) : `${a.levelRange[0]} to ${a.levelRange[1]}`);
  field("tone", a.tone);
  const firstScene = a.scenes[0];
  if (firstScene && a.start.sceneId !== firstScene.id) field("start scene", nameOf(sceneCands)(a.start.sceneId));
  const startScene = a.scenes.find((s) => s.id === a.start.sceneId);
  const defaultLoc = startScene?.location ?? a.locations[0]?.id;
  if (a.start.locationId !== defaultLoc) field("start location", nameOf(locCands)(a.start.locationId));
  const startLoc = a.locations.find((l) => l.id === a.start.locationId);
  const marks: { x: number; y: number }[] = [];
  if (startLoc) {
    startLoc.map.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (startLoc.map.legend[row[x]!]?.start) marks.push({ x, y });
    });
  }
  if (!(marks.length === 1 && marks[0]!.x === a.start.at.x && marks[0]!.y === a.start.at.y)) field("start at", `${a.start.at.x + 1}, ${a.start.at.y + 1}`);
  endFields();

  heading(2, "Summary");
  for (const para of a.summary.split(/\n\s*\n/).map(oneLine).filter(Boolean)) push(para, "");

  const list = (title: string, entries: string[]) => {
    if (entries.length === 0) return;
    heading(2, title);
    for (const e of entries) push(`- ${oneLine(e)}`);
    push("");
  };
  list("Truths", a.truths);
  list("DM must", a.dmMust);
  list("DM never", a.dmNever);

  const hookKeys = CLASS_ORDER.filter((k) => a.hooks[k] !== undefined);
  if (hookKeys.length > 0) {
    heading(2, "Hooks");
    for (const k of hookKeys) field(k, a.hooks[k]);
    push("");
  }

  const kitKeys = [...CLASS_ORDER.filter((k) => a.startingKit[k] !== undefined), ...Object.keys(a.startingKit).filter((k) => !(CLASS_ORDER as string[]).includes(k))] as (Chassis | "default")[];
  if (kitKeys.length > 0) {
    heading(2, "Starting kit");
    for (const k of kitKeys) {
      const kit = a.startingKit[k]!;
      heading(3, k);
      field("weapon", kit.weaponNote);
      field("armor", kit.armor);
      field("potions", kit.potions);
      for (const i of kit.items) field("item", i);
      push("");
    }
  }

  for (const it of a.items) {
    heading(2, `Item: ${it.name}`);
    idField(it.id, it.name);
    field("description", it.description);
    field("quest", it.quest);
    field("usable", it.usable);
    field("use says", it.useSay);
    endFields();
  }

  for (const n of a.npcs) {
    heading(2, `NPC: ${n.name}`);
    idField(n.id, n.name);
    field("role", n.role);
    field("personality", n.personality);
    field("token", n.token);
    field("wants", n.wants);
    for (const k of n.knows) field("knows", k);
    for (const s of n.secrets ?? []) field("secret", s);
    field("voice", n.voice);
    if (n.location !== undefined) field("location", nameOf(locCands)(n.location));
    endFields();
  }

  for (const l of a.locations) {
    heading(2, `Location: ${l.name}`);
    idField(l.id, l.name);
    field("dm notes", l.dmNotes);
    endFields();
    quote(l.readAloud);
    heading(3, "Map");
    push("```", ...l.map.rows, "```", "");
    heading(3, "Legend");
    for (const [ch, e] of Object.entries(l.map.legend)) {
      const parts = [e.tile];
      if (e.prop !== undefined) parts.push(`prop ${e.prop}`);
      if (e.feature !== undefined) parts.push(`feature ${e.feature}`);
      if (e.spawn !== undefined) parts.push(`spawn ${e.spawn}`);
      if (e.exit !== undefined) parts.push(`exit ${e.exit}`);
      if (e.start) parts.push("start");
      push(`- \`${ch}\` = ${parts.join(", ")}`);
    }
    push("");
    for (const f of l.features) {
      heading(3, `Feature: ${f.name}`);
      idField(f.id, f.name);
      field("description", f.description);
      field("secret", f.secret);
      field("search dc", f.searchDc);
      for (const g of f.gives ?? []) field("gives", g);
      field("once", f.once);
      endFields();
    }
    for (const s of l.spawns) {
      heading(3, `Spawn: ${s.id}`);
      field("creature", s.creature);
      field("count", s.count);
      field("hostile", s.hostile);
      field("awake", s.awake);
      if (s.npcId !== undefined) field("npc", nameOf(npcCands)(s.npcId));
      if (s.appearsWhen) field("appears when", cond(s.appearsWhen));
      endFields();
    }
    for (const e of l.exits) {
      heading(3, `Exit: ${e.label}`);
      idField(e.id, e.label);
      field("to", nameOf(locCands)(e.to));
      const target = a.locations.find((x) => x.id === e.to);
      field("arrive at", e.arriveAt === "start" ? "start" : nameOf((target?.exits ?? []).map((x) => ({ id: x.id, names: [x.label] })))(e.arriveAt));
      if (e.requires) field("open when", cond(e.requires));
      field("locked text", e.lockedText);
      endFields();
    }
  }

  for (const s of a.scenes) {
    heading(2, `Scene: ${s.title}`);
    idField(s.id, s.title);
    if (s.location !== undefined) field("location", nameOf(locCands)(s.location));
    endFields();
    quote(s.opening);
    for (const o of s.objectives) {
      heading(3, `Objective: ${o.text}`);
      idField(o.id, o.text);
      field("hidden", o.hidden);
      field("done when", cond(o.doneWhen));
      endFields();
    }
    for (const b of s.beats) {
      heading(3, `Beat: ${b.id}`);
      field("when", cond(b.when));
      for (const f of b.setFlags ?? []) field("sets flag", f);
      for (const g of b.give ?? []) field("gives", g);
      for (const sp of b.spawn ?? []) field("spawns", sp);
      field("once", b.once);
      endFields();
      quote(b.narrate);
    }
    if (s.next.length > 0) {
      heading(3, "Next");
      for (const n of s.next) {
        const sn = nameOf(sceneCands)(n.scene);
        push(`- ${/\bwhen\b/i.test(sn) ? n.scene : sn} when ${cond(n.when)}`);
      }
      push("");
    }
    if (s.ending) {
      heading(3, "Ending");
      field("outcome", s.ending.outcome);
      endFields();
      quote(s.ending.text);
    }
  }

  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n") + "\n";
}
