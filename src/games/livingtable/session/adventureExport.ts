/**
 * Adventure export: turn a play session into one debugging bundle.
 *
 * The game menu's "Export adventure (debug)" collects everything a developer
 * needs to replay what happened (the character, the scene, the DM's whole
 * conversation, every dice roll, the saves, the settings) into an
 * `AdventureBundle`, and this module turns that bundle into files and one zip.
 * Pure: no DOM, no storage, no clock read except the optional `now` argument.
 * The caller does the download.
 *
 * JSON-SAFETY CONTRACT. The bundle must be JSON-safe. Anything binary (a
 * Uint8Array of explored squares, say) should arrive already encoded by the
 * caller (base64 or a plain number array). As a safety net, every file written
 * here first passes the data through `toJsonSafe`, which converts stray typed
 * arrays (to `{ "$base64": "..." }`), Maps (to `{ "$map": [[k, v], ...] }`),
 * Sets (to arrays), BigInts (to strings), functions (dropped) and cycles (to
 * the text "[circular]") so an unexpected value can never make the export throw
 * and lose the whole session.
 *
 * PRIVACY. The DM transcript holds the whole prompt sent to the model,
 * including the world's secrets. The README says so. It is the owner's own
 * game, exported for debugging, so nothing is redacted.
 */
import { zipStore } from "./zip";

export const ADVENTURE_FORMAT = "living-table-adventure" as const;
export const ADVENTURE_VERSION = 1;

/** One round trip to the DM: what was asked, what came back, what the engine did with it. */
export interface DmExchange {
  /** ISO timestamp of when the request started. */
  at: string;
  /** The structured ask (what the player did and the context kind), any shape. */
  ask: unknown;
  /** The full text sent to the model. */
  input: string;
  /** Every raw answer the model returned, in order (more than one when it was retried). */
  rawAnswers: string[];
  /** Parse or validation errors, in order. */
  errors: string[];
  outcome: "ok" | "invalid" | "error" | "cancelled";
  /** A short code for the outcome (an error code, a refusal reason). */
  code?: string;
  /** Effects the engine applied, in plain words. */
  applied?: string[];
  /** Effects the engine refused, with the reason. */
  refused?: string[];
  /** Round trip time in milliseconds. */
  ms?: number;
}

/** One dice roll the table made. */
export interface RollRecord {
  at: string;
  who: string;
  label: string;
  dice: { kind: string; result: number }[];
  modifier?: number;
  total?: number;
  target?: number;
  verdict?: string;
}

export interface AdventureBundle {
  format: "living-table-adventure";
  version: number;
  exportedAt: string;
  build: { app: string; bench?: string; userAgent?: string };
  settings: Record<string, unknown>;
  character: unknown;
  scene: unknown;
  state: unknown;
  saves: unknown[];
  log: { text: string; tone?: string }[];
  dm: DmExchange[];
  rolls: RollRecord[];
  notes?: string;
}

// ---- JSON safety ----

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += BASE64[a >> 2]! + BASE64[((a & 3) << 4) | (b >> 4)]!;
    out += i + 1 < bytes.length ? BASE64[((b & 15) << 2) | (c >> 6)]! : "=";
    out += i + 2 < bytes.length ? BASE64[c & 63]! : "=";
  }
  return out;
}

const MAX_DEPTH = 64;

/**
 * Return a copy of `value` that JSON.stringify can always write. See the
 * module comment for the conversions. Plain data passes through unchanged.
 */
export function toJsonSafe(value: unknown): unknown {
  return walk(value, [], 0);
}

function walk(value: unknown, ancestors: object[], depth: number): unknown {
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      return Number.isFinite(value) ? value : String(value);
    case "bigint":
      return value.toString();
    case "undefined":
    case "function":
    case "symbol":
      return undefined;
  }
  if (value === null) return null;
  const obj = value as object;
  if (ancestors.includes(obj)) return "[circular]";
  if (depth >= MAX_DEPTH) return "[too deep]";
  if (obj instanceof Date) return Number.isNaN(obj.getTime()) ? null : obj.toISOString();
  if (obj instanceof Uint8Array) return { $base64: base64(obj) };
  if (ArrayBuffer.isView(obj)) {
    const view = obj as unknown as ArrayLike<number | bigint>;
    return Array.from(view, (n) => (typeof n === "bigint" ? n.toString() : n));
  }
  const next = [...ancestors, obj];
  if (obj instanceof Map) {
    return { $map: [...obj.entries()].map(([k, v]) => [walk(k, next, depth + 1), walk(v, next, depth + 1)]) };
  }
  if (obj instanceof Set) return [...obj].map((v) => walk(v, next, depth + 1) ?? null);
  if (Array.isArray(obj)) return obj.map((v) => walk(v, next, depth + 1) ?? null);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    const v = walk((obj as Record<string, unknown>)[key], next, depth + 1);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

function pretty(value: unknown): string {
  return JSON.stringify(toJsonSafe(value) ?? null, null, 2);
}

// ---- small helpers ----

function arr<T>(v: T[] | undefined | null): T[] {
  return Array.isArray(v) ? v : [];
}

/** A code fence long enough that nothing inside the text can close it early. */
function fence(text: string, lang = ""): string {
  let longest = 0;
  for (const m of text.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  const ticks = "`".repeat(Math.max(3, longest + 1));
  return `${ticks}${lang}\n${text}\n${ticks}`;
}

function csvCell(value: unknown): string {
  const s = value === undefined || value === null ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

// ---- files ----

function transcript(bundle: AdventureBundle): string {
  const dm = arr(bundle.dm);
  const lines: string[] = [];
  lines.push("# DM transcript", "");
  lines.push(`Exported ${bundle.exportedAt}. ${dm.length} exchange${dm.length === 1 ? "" : "s"}, oldest first.`);
  lines.push("Each exchange shows the ask, the full input sent to the model, every raw answer, errors, and what the engine applied or refused.");
  lines.push("");
  dm.forEach((x, i) => {
    lines.push(`## Exchange ${i + 1} of ${dm.length}: ${x.outcome}${x.code ? " (" + x.code + ")" : ""}`, "");
    lines.push(`- Started: ${x.at}`);
    if (typeof x.ms === "number") lines.push(`- Took: ${x.ms} ms`);
    lines.push("", "### Ask", "");
    lines.push(typeof x.ask === "string" ? fence(x.ask) : fence(pretty(x.ask), "json"));
    lines.push("", "### Input sent", "", fence(String(x.input ?? "")));
    const answers = arr(x.rawAnswers);
    lines.push("", `### Raw answers (${answers.length})`, "");
    if (answers.length === 0) lines.push("None.");
    answers.forEach((a, j) => {
      lines.push(`Answer ${j + 1} of ${answers.length}:`, "", fence(String(a)), "");
    });
    const errors = arr(x.errors);
    lines.push(`### Errors (${errors.length})`, "");
    if (errors.length === 0) lines.push("None.");
    errors.forEach((e, j) => lines.push(`${j + 1}. ${e}`));
    const applied = arr(x.applied);
    lines.push("", `### Applied by the engine (${applied.length})`, "");
    if (applied.length === 0) lines.push("None.");
    applied.forEach((e) => lines.push(`- ${e}`));
    const refused = arr(x.refused);
    lines.push("", `### Refused by the engine (${refused.length})`, "");
    if (refused.length === 0) lines.push("None.");
    refused.forEach((e) => lines.push(`- ${e}`));
    lines.push("");
  });
  if (dm.length === 0) lines.push("No exchanges were recorded.", "");
  return lines.join("\n");
}

function logText(bundle: AdventureBundle): string {
  const lines = arr(bundle.log).map((l) => (l.tone ? `[${l.tone}] ${l.text}` : String(l.text)));
  return lines.join("\n") + (lines.length ? "\n" : "");
}

const CSV_HEADER = ["at", "who", "label", "dice", "modifier", "total", "target", "verdict"];

function rollsCsv(bundle: AdventureBundle): string {
  const rows = arr(bundle.rolls).map((r) => [
    r.at,
    r.who,
    r.label,
    arr(r.dice)
      .map((d) => `${d.kind}:${d.result}`)
      .join(" "),
    r.modifier,
    r.total,
    r.target,
    r.verdict,
  ]);
  return [CSV_HEADER, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function readme(bundle: AdventureBundle): string {
  const b = bundle.build ?? { app: "unknown" };
  const lines = [
    "LIVING TABLE ADVENTURE EXPORT",
    "",
    `Exported: ${bundle.exportedAt}`,
    `Format: ${bundle.format} version ${bundle.version}`,
    `App build: ${b.app}`,
  ];
  if (b.bench) lines.push(`Bench build: ${b.bench}`);
  if (b.userAgent) lines.push(`Browser: ${b.userAgent}`);
  lines.push(
    "",
    `Contents: ${arr(bundle.log).length} log lines, ${arr(bundle.dm).length} DM exchanges, ${arr(bundle.rolls).length} dice rolls, ${arr(bundle.saves).length} saves.`,
    "",
    "FILES",
    "",
    "adventure.json        Everything, machine readable: settings, character, scene, state,",
    "                      saves, log, DM exchanges and rolls. Start here for a bug report.",
    "dm-transcript.md      Every DM exchange in order: the ask, the full input sent, every raw",
    "                      answer, errors, what the engine applied and refused, and timings.",
    "log.txt               The adventure log as the player saw it, one line per entry, with the",
    "                      tone in brackets when there is one.",
    "character-sheet.json  The character sheet on its own.",
    "saves.json            The save points on their own.",
    "rolls.csv             Every dice roll: time, who, what for, dice, modifier, total, target,",
    "                      verdict.",
    "README.txt            This file.",
    "",
    "HOW TO SHARE IT FOR DEBUGGING",
    "",
    "Attach the whole zip to the bug report or send it to the developer, and say what you",
    "expected to happen and what happened instead. The exchange number in",
    "dm-transcript.md is the quickest way to point at the moment it went wrong.",
    "",
    "WARNING: PRIVATE",
    "",
    "This export contains the whole prompt sent to the DM, including the world's secrets:",
    "hidden rooms, traps, who is lying, and anything the player has not discovered yet.",
    "Do not open dm-transcript.md or adventure.json if you want to keep playing this",
    "adventure unspoiled, and share the zip only with people you trust with the spoilers.",
  );
  if (bundle.notes) lines.push("", "NOTES FROM THE EXPORTER", "", bundle.notes);
  return lines.join("\n") + "\n";
}

/**
 * The files of the export, in the order they appear in the zip. All text.
 * Missing or malformed list fields on the bundle are treated as empty.
 */
export function adventureFiles(bundle: AdventureBundle): { name: string; data: string }[] {
  return [
    { name: "adventure.json", data: pretty(bundle) },
    { name: "dm-transcript.md", data: transcript(bundle) },
    { name: "log.txt", data: logText(bundle) },
    { name: "character-sheet.json", data: pretty(bundle.character) },
    { name: "saves.json", data: pretty(arr(bundle.saves)) },
    { name: "rolls.csv", data: rollsCsv(bundle) },
    { name: "README.txt", data: readme(bundle) },
  ];
}

/** `living-table-adventure-YYYY-MM-DD-HHMM.zip`, in the player's local time. */
export function adventureFilename(now: Date): string {
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `living-table-adventure-${stamp}.zip`;
}

/**
 * The finished download: a store-only zip of `adventureFiles(bundle)` and its
 * filename. `now` (default: the current time) names the file and stamps the
 * entries; pass it in tests.
 */
export function adventureZip(bundle: AdventureBundle, now: Date = new Date()): { filename: string; bytes: Uint8Array } {
  const files = adventureFiles(bundle).map((f) => ({ name: f.name, data: f.data, modified: now }));
  return { filename: adventureFilename(now), bytes: zipStore(files) };
}
