/**
 * The table window's cast engine takes its data from the host (bindCastSource),
 * never from the page. Run: npx tsx --test test/livingtable-table-ui-cast.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { bindCastSource, castData, type CastData, type CastSource } from "../src/games/livingtable/table/ui/cast";
import type { TableHost } from "../src/games/livingtable/table/host";
import { createMemoryHost } from "../src/games/livingtable/table/hostDefault";

function fakeCast(label = "a"): CastData {
  return {
    palette: [[0, 0, 0]],
    cameraPitchDeg: 30,
    styles: [{ style: label, label, description: "", characters: [], gear: [], layerOrder: { down: [], right: [], up: [], left: [] } }],
  };
}

test("nothing is bound: no cast, and no page element is read", () => {
  bindCastSource(null);
  assert.equal(castData(), null);
});

test("a bound source supplies the cast and a found cast is read once", () => {
  let calls = 0;
  const data = fakeCast();
  const unbind = bindCastSource(() => (calls++, data));
  assert.equal(castData(), data);
  assert.equal(castData(), data);
  assert.equal(calls, 1);
  unbind();
  assert.equal(castData(), null);
});

test("no cast yet is asked for again, so one that arrives late is picked up", () => {
  let ready: CastData | null = null;
  let calls = 0;
  const unbind = bindCastSource(() => (calls++, ready));
  assert.equal(castData(), null);
  assert.equal(castData(), null);
  assert.equal(calls, 2);
  ready = fakeCast("late");
  assert.equal(castData()?.styles[0]?.style, "late");
  unbind();
});

test("a rebind clears the cache; a stale unbind does not unbind its successor", () => {
  const first = bindCastSource(() => fakeCast("one"));
  assert.equal(castData()?.styles[0]?.style, "one");
  const second = bindCastSource(() => fakeCast("two"));
  assert.equal(castData()?.styles[0]?.style, "two");
  first();
  assert.equal(castData()?.styles[0]?.style, "two");
  second();
  assert.equal(castData(), null);
});

test("a throwing or empty source means no cast, never an exception", () => {
  const unbind = bindCastSource(() => {
    throw new Error("host broke");
  });
  assert.equal(castData(), null);
  unbind();
  const empty = bindCastSource(() => ({ ...fakeCast(), styles: [] }));
  assert.equal(castData(), null);
  empty();
});

test("the host's art.cast() result feeds the cast engine as it is (types and behaviour)", () => {
  const host: TableHost = createMemoryHost();
  const source: CastSource = () => host.art.cast()?.data ?? null;
  const unbind = bindCastSource(source);
  assert.equal(castData(), host.art.cast()?.data ?? null);
  unbind();
});
