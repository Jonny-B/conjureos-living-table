/**
 * Adventure export: the store-only ZIP writer and the debug bundle files.
 *
 * Run: npx tsx --test test/livingtable-adventure-export.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { crc32, zipStore } from "../src/games/livingtable/session/zip";
import {
  adventureFiles,
  adventureFilename,
  adventureZip,
  toJsonSafe,
  ADVENTURE_FORMAT,
  ADVENTURE_VERSION,
  type AdventureBundle,
  type DmExchange,
} from "../src/games/livingtable/session/adventureExport";

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

// ---- a reader for our own zips ----

interface ReadEntry {
  name: string;
  data: Uint8Array;
  crc: number;
  flags: number;
  method: number;
  dosTime: number;
  dosDate: number;
}

function readZip(bytes: Uint8Array): ReadEntry[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  assert.equal(v.getUint32(eocd, true), 0x06054b50, "end record signature");
  const count = v.getUint16(eocd + 10, true);
  assert.equal(v.getUint16(eocd + 8, true), count);
  const cdSize = v.getUint32(eocd + 12, true);
  const cdStart = v.getUint32(eocd + 16, true);
  assert.equal(cdStart + cdSize, eocd, "central directory ends where the end record begins");
  const dec = new TextDecoder("utf-8", { fatal: true });
  const out: ReadEntry[] = [];
  let p = cdStart;
  for (let i = 0; i < count; i++) {
    assert.equal(v.getUint32(p, true), 0x02014b50, "central record signature");
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const dosTime = v.getUint16(p + 12, true);
    const dosDate = v.getUint16(p + 14, true);
    const crc = v.getUint32(p + 16, true);
    const csize = v.getUint32(p + 20, true);
    const usize = v.getUint32(p + 24, true);
    const nlen = v.getUint16(p + 28, true);
    const xlen = v.getUint16(p + 30, true);
    const clen = v.getUint16(p + 32, true);
    const off = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    assert.equal(csize, usize);
    // local header agrees with the central record
    assert.equal(v.getUint32(off, true), 0x04034b50, "local header signature");
    assert.equal(v.getUint32(off + 14, true), crc);
    assert.equal(v.getUint32(off + 18, true), csize);
    const lnlen = v.getUint16(off + 26, true);
    const lxlen = v.getUint16(off + 28, true);
    assert.equal(lnlen, nlen);
    const start = off + 30 + lnlen + lxlen;
    const data = bytes.slice(start, start + usize);
    assert.equal(crc32(data), crc, "crc matches contents for " + name);
    out.push({ name, data, crc, flags, method, dosTime, dosDate });
    p += 46 + nlen + xlen + clen;
  }
  assert.equal(p, eocd);
  return out;
}

const text = (e: ReadEntry) => new TextDecoder().decode(e.data);

// ---- zip.ts ----

test("crc32 matches the well known check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test("zipStore round trips text and binary files in order", () => {
  const bin = new Uint8Array(1000);
  for (let i = 0; i < bin.length; i++) bin[i] = (i * 31) & 0xff;
  const when = new Date(Date.UTC(2026, 9, 2, 14, 30, 44));
  const zip = zipStore([
    { name: "a.txt", data: "hello world", modified: when },
    { name: "dir/b.bin", data: bin },
    { name: "empty.txt", data: "" },
    { name: "café ☃.txt", data: "unicode name" },
  ]);
  const entries = readZip(zip);
  assert.deepEqual(
    entries.map((e) => e.name),
    ["a.txt", "dir/b.bin", "empty.txt", "café ☃.txt"],
  );
  assert.equal(text(entries[0]!), "hello world");
  assert.deepEqual([...entries[1]!.data], [...bin]);
  assert.equal(entries[2]!.data.length, 0);
  assert.equal(text(entries[3]!), "unicode name");
  for (const e of entries) {
    assert.equal(e.method, 0, "stored");
    assert.equal(e.flags & 0x0800, 0x0800, "UTF-8 name flag");
  }
  // DOS stamp of the first file: 2026-10-02 14:30:44 (seconds stored in halves)
  assert.equal(entries[0]!.dosDate, ((2026 - 1980) << 9) | (10 << 5) | 2);
  assert.equal(entries[0]!.dosTime, (14 << 11) | (30 << 5) | 22);
  // no stamp given: the DOS epoch, never the clock
  assert.equal(entries[1]!.dosDate, (1 << 5) | 1);
});

test("zipStore of nothing is a valid empty archive", () => {
  const zip = zipStore([]);
  assert.equal(zip.length, 22);
  assert.deepEqual(readZip(zip), []);
});

test("zipStore normalises names and refuses unsafe ones", () => {
  const zip = zipStore([{ name: "\\x\\y.txt", data: "1" }, { name: "/top.txt", data: "2" }]);
  assert.deepEqual(
    readZip(zip).map((e) => e.name),
    ["x/y.txt", "top.txt"],
  );
  assert.throws(() => zipStore([{ name: "../evil.txt", data: "x" }]));
  assert.throws(() => zipStore([{ name: "", data: "x" }]));
});

test("zipStore output opens in a system unzip when one is available", (t) => {
  const probe = spawnSync("unzip", ["-v"], { encoding: "utf8" });
  if (probe.error || probe.status === null) {
    t.skip("no system unzip on this machine");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "lt-zip-"));
  try {
    const file = join(dir, "t.zip");
    writeFileSync(file, zipStore([{ name: "one.txt", data: "first" }, { name: "sub/two.txt", data: "second\n".repeat(100) }]));
    const run = spawnSync("unzip", ["-t", file], { encoding: "utf8" });
    assert.equal(run.status, 0, (run.stdout ?? "") + (run.stderr ?? ""));
    assert.match(run.stdout, /No errors detected/);
    const cat = spawnSync("unzip", ["-p", file, "one.txt"], { encoding: "utf8" });
    assert.equal(cat.stdout, "first");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- adventureExport.ts ----

function exchange(i: number, over: Partial<DmExchange> = {}): DmExchange {
  return {
    at: `2026-10-02T14:${String(i % 60).padStart(2, "0")}:00.000Z`,
    ask: { kind: "player-action", text: `I try thing number ${i}` },
    input: `FULL INPUT ${i}\nline two of input ${i}`,
    rawAnswers: [`RAW A ${i}`, `RAW B ${i}`],
    errors: i % 3 === 0 ? [`bad json ${i}`] : [],
    outcome: i % 3 === 0 ? "invalid" : "ok",
    applied: [`applied effect ${i}`],
    refused: i % 5 === 0 ? [`refused effect ${i}`] : [],
    ms: 100 + i,
    ...over,
  };
}

function bundle(over: Partial<AdventureBundle> = {}): AdventureBundle {
  return {
    format: ADVENTURE_FORMAT,
    version: ADVENTURE_VERSION,
    exportedAt: "2026-10-02T15:00:00.000Z",
    build: { app: "0.1.2", detail: "build-7", userAgent: "TestAgent/1.0" },
    settings: { music: false, difficulty: "normal" },
    character: { name: "Mira", class: "rogue", level: 3 },
    scene: { id: "goblin-cave", width: 12, height: 9 },
    state: { turn: 4, creatures: [{ id: "g1", hp: 7 }] },
    saves: [{ id: "s1", kind: "manual" }],
    log: [
      { text: "You enter the cave." },
      { text: "The goblin snarls.", tone: "danger" },
    ],
    dm: [exchange(1), exchange(2), exchange(3)],
    rolls: [{ at: "2026-10-02T14:01:00.000Z", who: "Mira", label: "Kick", dice: [{ kind: "d20", result: 14 }], modifier: 3, total: 17, target: 12, verdict: "success" }],
    ...over,
  };
}

test("adventureFiles lists every file with the documented names, in order", () => {
  const files = adventureFiles(bundle());
  assert.deepEqual(
    files.map((f) => f.name),
    ["adventure.json", "dm-transcript.md", "log.txt", "character-sheet.json", "saves.json", "rolls.csv", "README.txt"],
  );
  for (const f of files) assert.equal(typeof f.data, "string");
});

test("adventure.json is the whole bundle; sheet and saves files match", () => {
  const b = bundle();
  const f = Object.fromEntries(adventureFiles(b).map((x) => [x.name, x.data]));
  assert.deepEqual(JSON.parse(f["adventure.json"]!), b);
  assert.match(f["adventure.json"]!, /\n {2}"format"/, "pretty printed");
  assert.deepEqual(JSON.parse(f["character-sheet.json"]!), b.character);
  assert.deepEqual(JSON.parse(f["saves.json"]!), b.saves);
});

test("log.txt has one line per entry with the tone in brackets", () => {
  const f = Object.fromEntries(adventureFiles(bundle()).map((x) => [x.name, x.data]));
  assert.equal(f["log.txt"], "You enter the cave.\n[danger] The goblin snarls.\n");
});

test("dm-transcript.md has every exchange input and raw answer, in order", () => {
  const dm = Array.from({ length: 8 }, (_, i) => exchange(i + 1));
  const f = Object.fromEntries(adventureFiles(bundle({ dm })).map((x) => [x.name, x.data]));
  const t = f["dm-transcript.md"]!;
  let last = -1;
  for (const x of dm) {
    for (const needle of [x.input, ...x.rawAnswers, ...(x.errors ?? []), ...(x.applied ?? []), ...(x.refused ?? []), `${x.ms} ms`]) {
      const at = t.indexOf(needle, last < 0 ? 0 : last);
      assert.ok(at >= 0, "missing or out of order: " + needle);
    }
    const header = t.indexOf(`## Exchange ${dm.indexOf(x) + 1} of 8`);
    assert.ok(header > last, "exchange headers ascend");
    last = header;
  }
  // the structured ask is shown as JSON
  assert.match(t, /"text": "I try thing number 4"/);
  // outcome and code are in the heading
  assert.match(adventureFiles(bundle({ dm: [exchange(1, { outcome: "error", code: "http_500" })] }))[1]!.data, /## Exchange 1 of 1: error \(http_500\)/);
});

test("a transcript fence cannot be closed early by backticks in the text", () => {
  const nasty = "before\n```\ninjected heading\n```\nafter";
  const t = adventureFiles(bundle({ dm: [exchange(1, { input: nasty })] }))[1]!.data;
  const open = t.indexOf("````");
  assert.ok(open >= 0, "uses a longer fence");
  assert.ok(t.includes(nasty));
});

test("an empty bundle still exports every file", () => {
  const files = adventureFiles(bundle({ dm: [], log: [], rolls: [], saves: [] }));
  assert.equal(files.length, 7);
  const f = Object.fromEntries(files.map((x) => [x.name, x.data]));
  assert.equal(f["log.txt"], "");
  assert.match(f["dm-transcript.md"]!, /No exchanges were recorded/);
  assert.equal(f["rolls.csv"], "at,who,label,dice,modifier,total,target,verdict\r\n");
  // a caller that sends garbage for the lists does not crash the export
  const bad = bundle({ dm: undefined as unknown as DmExchange[], log: null as unknown as [], rolls: 3 as unknown as [], saves: {} as unknown as [] });
  assert.equal(adventureFiles(bad).length, 7);
});

test("rolls.csv quotes commas, quotes and newlines", () => {
  const b = bundle({
    rolls: [
      { at: "t1", who: 'Mira "the Quick"', label: "Pick the lock, again", dice: [{ kind: "d20", result: 9 }, { kind: "d4", result: 2 }], modifier: -1, total: 10, target: 15, verdict: "fail\nnext line" },
      { at: "t2", who: "Goblin", label: "plain", dice: [] },
    ],
  });
  const csv = adventureFiles(b).find((f) => f.name === "rolls.csv")!.data;
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "at,who,label,dice,modifier,total,target,verdict");
  assert.equal(lines[1], 't1,"Mira ""the Quick""","Pick the lock, again",d20:9 d4:2,-1,10,15,"fail\nnext line"');
  assert.equal(lines[2], "t2,Goblin,plain,,,,,");
  assert.equal(lines[3], "");
});

test("README names the files, the build, sharing, and warns about secrets", () => {
  const r = adventureFiles(bundle()).find((f) => f.name === "README.txt")!.data;
  for (const name of ["adventure.json", "dm-transcript.md", "log.txt", "character-sheet.json", "saves.json", "rolls.csv", "README.txt"]) {
    assert.ok(r.includes(name), name);
  }
  assert.match(r, /App build: 0\.1\.2/);
  assert.match(r, /Game build: build-7/);
  assert.doesNotMatch(r, /Bench build/);
  assert.match(r, /HOW TO SHARE/);
  assert.match(r, /world's secrets/);
  assert.match(r, /3 DM exchanges/);
});

test("adventureFilename uses local time as YYYY-MM-DD-HHMM", () => {
  assert.equal(adventureFilename(new Date(2026, 9, 2, 7, 5)), "living-table-adventure-2026-10-02-0705.zip");
  assert.equal(adventureFilename(new Date(2027, 0, 31, 23, 59)), "living-table-adventure-2027-01-31-2359.zip");
});

test("adventureZip is a valid zip of exactly adventureFiles", () => {
  const b = bundle();
  const now = new Date(2026, 9, 2, 15, 0);
  const z = adventureZip(b, now);
  assert.equal(z.filename, "living-table-adventure-2026-10-02-1500.zip");
  const entries = readZip(z.bytes);
  const files = adventureFiles(b);
  assert.deepEqual(
    entries.map((e) => e.name),
    files.map((f) => f.name),
  );
  entries.forEach((e, i) => assert.equal(text(e), files[i]!.data));
});

test("adventureZip with no clock argument still names a zip", () => {
  assert.match(adventureZip(bundle()).filename, /^living-table-adventure-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/);
});

test("toJsonSafe converts typed arrays, maps, sets, bigints and cycles", () => {
  const cyc: Record<string, unknown> = { name: "loop" };
  cyc.self = cyc;
  const shared = { n: 1 };
  const safe = toJsonSafe({
    bytes: new Uint8Array([1, 2, 3, 4]),
    ints: new Int16Array([5, -6]),
    map: new Map<string, unknown>([["a", 1], ["b", new Set([1, 2])]]),
    big: 10n,
    fn: () => 1,
    nan: Number.NaN,
    cyc,
    twice: [shared, shared],
    when: new Date("2026-10-02T00:00:00.000Z"),
  }) as Record<string, unknown>;
  assert.deepEqual(safe.bytes, { $base64: "AQIDBA==" });
  assert.deepEqual(safe.ints, [5, -6]);
  assert.deepEqual(safe.map, { $map: [["a", 1], ["b", [1, 2]]] });
  assert.equal(safe.big, "10");
  assert.equal("fn" in safe, false);
  assert.equal(safe.nan, "NaN");
  assert.deepEqual(safe.cyc, { name: "loop", self: "[circular]" });
  assert.deepEqual(safe.twice, [{ n: 1 }, { n: 1 }], "a repeated reference is not a cycle");
  assert.equal(safe.when, "2026-10-02T00:00:00.000Z");
  JSON.stringify(safe);
});

test("a bundle holding a Map, a typed array and a cycle still exports", () => {
  const cyc: Record<string, unknown> = {};
  cyc.me = cyc;
  const b = bundle({ state: { explored: new Uint8Array([255, 0, 7]), seen: new Map([[1, "x"]]), cyc } });
  const f = Object.fromEntries(adventureFiles(b).map((x) => [x.name, x.data]));
  const parsed = JSON.parse(f["adventure.json"]!);
  assert.deepEqual(parsed.state.explored, { $base64: "/wAH" });
  assert.deepEqual(parsed.state.seen, { $map: [[1, "x"]] });
  assert.deepEqual(parsed.state.cyc, { me: "[circular]" });
});

test("a large bundle (500 log lines, 50 exchanges) exports quickly and completely", () => {
  const log = Array.from({ length: 500 }, (_, i) => ({ text: `log line ${i}`, tone: i % 2 ? "info" : undefined }));
  const big = "x".repeat(20000);
  const dm = Array.from({ length: 50 }, (_, i) => exchange(i + 1, { input: `INPUT ${i + 1} ${big}` }));
  const b = bundle({ log, dm });
  const t0 = Date.now();
  const z = adventureZip(b, new Date(2026, 9, 2, 15, 0));
  const ms = Date.now() - t0;
  assert.ok(ms < 3000, `took ${ms} ms`);
  const entries = readZip(z.bytes);
  const files = Object.fromEntries(entries.map((e) => [e.name, text(e)]));
  assert.equal(files["log.txt"]!.split("\n").length, 501);
  assert.ok(files["dm-transcript.md"]!.includes("## Exchange 50 of 50"));
  assert.equal(JSON.parse(files["adventure.json"]!).dm.length, 50);
});

test("no dash characters in the text this module writes", () => {
  for (const f of adventureFiles(bundle())) {
    assert.ok(!f.data.includes(EM), f.name + " has an em dash");
    assert.ok(!f.data.includes(EN), f.name + " has an en dash");
  }
  const empty = adventureFiles(bundle({ dm: [], log: [], rolls: [], saves: [] }));
  for (const f of empty) {
    assert.ok(!f.data.includes(EM) && !f.data.includes(EN), f.name);
  }
  for (const src of ["zip.ts", "adventureExport.ts"]) {
    const code = readFileSync(new URL("../src/games/livingtable/session/" + src, import.meta.url), "utf8");
    assert.ok(!code.includes(EM) && !code.includes(EN), src + " source has a dash character");
  }
});
