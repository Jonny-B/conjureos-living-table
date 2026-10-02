/**
 * Tests for session/savePoints.ts: the generic, pure save-point store. Add and
 * trim per kind (newest first, never dropping the newest), latest by kind, the
 * serialize/parse round trip, parse's never-throws guarantee against garbage,
 * wrong versions, partial arrays and oversized entries, the Saves list wording
 * at several ages, and the long-rest gate.
 *
 * Run: npx tsx --test test/livingtable-save-points.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SAVES_KEEP,
  SAVE_FORMAT_VERSION,
  SAVE_MAX_BYTES,
  addSave,
  latestSave,
  makeSavePoint,
  parseSaves,
  restBlockedReason,
  saveLabel,
  serializeSaves,
  type SaveKind,
  type SavePoint,
} from "../src/games/livingtable/session/savePoints";
import { createCharacter, type CharacterSheet } from "../src/games/livingtable/characters/creation";

const T0 = new Date("2026-10-02T12:00:00.000Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

function save(kind: SaveKind, n: number, data: unknown = { n }): SavePoint {
  return makeSavePoint(kind, `label ${n}`, data, at(n), `${kind}-${n}`);
}

function sheet(patch: Partial<CharacterSheet> = {}): CharacterSheet {
  return { ...createCharacter({ archetypeId: "knight", name: "Aldric", appearanceAssetId: "sprite-01" }), ...patch };
}

const CALM = { inFight: false, hostileAwake: false, hostileInSight: false };

test("makeSavePoint stamps the version, the ISO time and a unique default id", () => {
  const a = makeSavePoint("rest", "x", { hp: 3 }, T0);
  const b = makeSavePoint("rest", "x", { hp: 3 }, T0);
  assert.equal(a.version, SAVE_FORMAT_VERSION);
  assert.equal(a.savedAt, "2026-10-02T12:00:00.000Z");
  assert.deepEqual(a.data, { hp: 3 });
  assert.notEqual(a.id, b.id);
  assert.equal(makeSavePoint("manual", "x", 1, T0, "fixed").id, "fixed");
});

test("addSave puts the newest first and does not mutate its input", () => {
  const before = [save("rest", 1)];
  const after = addSave(before, save("checkpoint", 2));
  assert.deepEqual(after.map((s) => s.id), ["checkpoint-2", "rest-1"]);
  assert.equal(before.length, 1);
});

test("addSave trims each kind to SAVES_KEEP on its own", () => {
  let list: SavePoint[] = [];
  for (let i = 1; i <= SAVES_KEEP.checkpoint + 2; i++) list = addSave(list, save("checkpoint", i));
  list = addSave(list, save("rest", 100));
  assert.equal(list.filter((s) => s.kind === "checkpoint").length, SAVES_KEEP.checkpoint);
  assert.equal(list.filter((s) => s.kind === "rest").length, 1);
  // The oldest checkpoints fell off, the newest stayed.
  const ids = list.filter((s) => s.kind === "checkpoint").map((s) => s.id);
  assert.deepEqual(ids, [`checkpoint-${SAVES_KEEP.checkpoint + 2}`, `checkpoint-${SAVES_KEEP.checkpoint + 1}`, `checkpoint-${SAVES_KEEP.checkpoint}`]);
});

test("a flood of checkpoints never pushes out the rest saves", () => {
  let list: SavePoint[] = [];
  for (let i = 1; i <= SAVES_KEEP.rest; i++) list = addSave(list, save("rest", i));
  for (let i = 10; i < 40; i++) list = addSave(list, save("checkpoint", i));
  assert.equal(list.filter((s) => s.kind === "rest").length, SAVES_KEEP.rest);
});

test("addSave never drops the newest, and replaces a save with the same id", () => {
  for (const kind of ["rest", "checkpoint", "manual"] as const) {
    const full = Array.from({ length: SAVES_KEEP[kind] }, (_, i) => save(kind, i + 1));
    const next = addSave(full, save(kind, 99));
    assert.equal(next[0].id, `${kind}-99`);
  }
  const list = addSave([save("manual", 1), save("manual", 2)], makeSavePoint("manual", "again", { n: 9 }, at(9), "manual-1"));
  assert.equal(list.length, 2);
  assert.equal(list[0].id, "manual-1");
  assert.equal(list[0].label, "again");
});

test("every keep count is at least 1 (the never-drop-the-newest guarantee rests on it)", () => {
  for (const k of ["rest", "checkpoint", "manual"] as const) assert.ok(SAVES_KEEP[k] >= 1);
});

test("latestSave returns the first match, optionally by kind, and undefined when none", () => {
  const list = [save("checkpoint", 3), save("rest", 2), save("checkpoint", 1)];
  assert.equal(latestSave(list)?.id, "checkpoint-3");
  assert.equal(latestSave(list, ["rest"])?.id, "rest-2");
  assert.equal(latestSave(list, ["rest", "checkpoint"])?.id, "checkpoint-3");
  assert.equal(latestSave(list, ["manual"]), undefined);
  assert.equal(latestSave([]), undefined);
});

test("serialize then parse round-trips, order and payload intact", () => {
  const list = [save("checkpoint", 3, { a: [1, 2], b: "héllo" }), save("rest", 2), save("manual", 1)];
  const back = parseSaves(serializeSaves(list));
  assert.deepEqual(back, list);
});

test("parseSaves never throws on garbage and returns []", () => {
  for (const bad of [undefined, null, "", "not json", "{", "null", "42", '"str"', "{}", '{"a":1}', "[[[["]) {
    assert.deepEqual(parseSaves(bad), [], String(bad));
  }
  assert.deepEqual(parseSaves("[]"), []);
});

test("parseSaves drops entries of another format version", () => {
  const good = save("rest", 1);
  const text = JSON.stringify([{ ...save("rest", 2), version: SAVE_FORMAT_VERSION + 1 }, { ...save("rest", 3), version: undefined }, good]);
  assert.deepEqual(parseSaves(text), [good]);
});

test("parseSaves keeps the good entries of a partly bad array", () => {
  const a = save("rest", 1);
  const c = save("manual", 3);
  const text = JSON.stringify([
    a,
    null,
    7,
    "x",
    [],
    { ...save("rest", 2), kind: "weird" },
    { ...save("rest", 4), id: "" },
    { ...save("rest", 5), label: 5 },
    { ...save("rest", 6), savedAt: "not a date" },
    { id: "no-data", kind: "rest", label: "", savedAt: T0.toISOString(), version: SAVE_FORMAT_VERSION },
    c,
  ]);
  assert.deepEqual(parseSaves(text).map((s) => s.id), ["rest-1", "manual-3"]);
});

test("parseSaves drops repeat ids and trims per kind like addSave", () => {
  const many = Array.from({ length: SAVES_KEEP.checkpoint + 3 }, (_, i) => save("checkpoint", i + 1));
  const back = parseSaves(JSON.stringify([...many, many[0]]));
  assert.equal(back.length, SAVES_KEEP.checkpoint);
  assert.deepEqual(back.map((s) => s.id), many.slice(0, SAVES_KEEP.checkpoint).map((s) => s.id));
});

test("parseSaves refuses an oversized entry and keeps the others", () => {
  const huge = save("rest", 1, { blob: "x".repeat(SAVE_MAX_BYTES + 10) });
  const small = save("checkpoint", 2);
  const back = parseSaves(JSON.stringify([huge, small]));
  assert.deepEqual(back.map((s) => s.id), ["checkpoint-2"]);
  // Just under the budget is accepted.
  const fits = save("rest", 3, { blob: "x".repeat(SAVE_MAX_BYTES - 1000) });
  assert.equal(parseSaves(JSON.stringify([fits])).length, 1);
});

test("parseSaves refuses a store far over the total budget outright", () => {
  assert.deepEqual(parseSaves("[" + "0,".repeat(3_000_000) + "0]"), []);
});

test("parseSaves applies the caller's payload guard per entry", () => {
  const isN = (d: unknown): d is { n: number } => typeof d === "object" && d !== null && typeof (d as { n?: unknown }).n === "number";
  const text = serializeSaves([save("rest", 1, { n: 1 }), save("rest", 2, { nope: true }), save("rest", 3, "str")]);
  const back = parseSaves<{ n: number }>(text, isN);
  assert.deepEqual(back.map((s) => s.id), ["rest-1"]);
  assert.equal(back[0].data.n, 1);
});

test("saveLabel words the age at several distances", () => {
  const s = (kind: SaveKind, label: string, ageSeconds: number) => makeSavePoint(kind, label, 0, at(-ageSeconds), "id");
  assert.equal(saveLabel(s("rest", "", 0), T0), "Long rest, just now");
  assert.equal(saveLabel(s("rest", "", 59), T0), "Long rest, just now");
  assert.equal(saveLabel(s("rest", "", 60), T0), "Long rest, 1 minute ago");
  assert.equal(saveLabel(s("rest", "", 120), T0), "Long rest, 2 minutes ago");
  assert.equal(saveLabel(s("rest", "", 59 * 60 + 59), T0), "Long rest, 59 minutes ago");
  assert.equal(saveLabel(s("rest", "", 3600), T0), "Long rest, 1 hour ago");
  assert.equal(saveLabel(s("rest", "", 5 * 3600), T0), "Long rest, 5 hours ago");
  assert.equal(saveLabel(s("rest", "", 86400), T0), "Long rest, 1 day ago");
  assert.equal(saveLabel(s("rest", "", 3 * 86400), T0), "Long rest, 3 days ago");
  assert.equal(saveLabel(s("rest", "", 60 * 86400), T0), "Long rest, on 2026-08-03");
});

test("saveLabel words each kind and tolerates empty labels, a bad date and a future date", () => {
  const mk = (kind: SaveKind, label: string) => makeSavePoint(kind, label, 0, T0, "id");
  assert.equal(saveLabel(mk("checkpoint", "start of the scene"), T0), "Checkpoint: start of the scene, just now");
  assert.equal(saveLabel(mk("checkpoint", ""), T0), "Checkpoint, just now");
  assert.equal(saveLabel(mk("rest", "Long rest"), T0), "Long rest, just now");
  assert.equal(saveLabel(mk("rest", "the cellar"), T0), "Long rest: the cellar, just now");
  assert.equal(saveLabel(mk("manual", "Before the vault"), T0), "Before the vault, just now");
  assert.equal(saveLabel(mk("manual", "  "), T0), "Saved game, just now");
  assert.equal(saveLabel({ ...mk("rest", ""), savedAt: "garbage" }, T0), "Long rest");
  assert.equal(saveLabel(mk("rest", ""), at(-3600)), "Long rest, just now");
});

test("restBlockedReason passes on a calm room", () => {
  assert.equal(restBlockedReason(sheet(), CALM), null);
});

test("restBlockedReason gives the sheet's own refusals first", () => {
  assert.match(restBlockedReason(sheet({ dead: true }), CALM) ?? "", /nobody left to rest/);
  assert.match(restBlockedReason(sheet({ downed: true }), CALM) ?? "", /dying/);
  assert.match(restBlockedReason(sheet({ longRestUsed: true }), CALM) ?? "", /already slept through this day/);
  // The sheet's reason wins over the table-side ones.
  assert.match(restBlockedReason(sheet({ longRestUsed: true }), { inFight: true, hostileAwake: true, hostileInSight: true }) ?? "", /already slept/);
});

test("restBlockedReason refuses a fight, awake enemies and an enemy in sight", () => {
  assert.match(restBlockedReason(sheet(), { ...CALM, inFight: true }) ?? "", /fight/);
  assert.match(restBlockedReason(sheet(), { ...CALM, hostileAwake: true }) ?? "", /enemies awake and nearby/);
  assert.match(restBlockedReason(sheet(), { ...CALM, hostileInSight: true }) ?? "", /enemy in sight/);
});
