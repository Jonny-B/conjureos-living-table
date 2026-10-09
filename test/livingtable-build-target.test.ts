/**
 * Which build this is (src/buildTarget.ts) and what it decides: the two test rooms show on dev builds only.
 *
 *  - the committed default is "prod", so a publish that skipped the stamping step is still correct for real players;
 *  - testRoomsVisible(target, hostname) is the one decision: prod hides the rooms unless the page is served from this machine;
 *  - the publish workflow stamps the file in the same step that stamps the games-db URL;
 *  - the game host puts the decision in TableEnv.testRooms, and the start screen leaves the rooms out when it is false.
 *
 * Run: npx tsx --test test/livingtable-build-target.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { BUILD_TARGET } from "../src/buildTarget";
import { createGameHost, testRoomsVisible } from "../src/games/livingtable/table/host/gameHost";
import { roomsShown } from "../src/games/livingtable/table/ui/screenHelpers";
import { createMemoryHost } from "../src/games/livingtable/table/hostDefault";
import { createTableSession } from "../src/games/livingtable/table/mountTable";
import { bindAdventures, unbindAdventures } from "../src/games/livingtable/table/adventureCatalog";
import { bindCatalog, unbindCatalog } from "../src/games/livingtable/table/catalog";
import { installAdventureStart } from "../src/games/livingtable/table/flows/adventureStart";
import type { StartScreenOptions } from "../src/games/livingtable/table/ui/overlay";
import type { TableCtx } from "../src/games/livingtable/table/tableCtx";

const read = (rel: string): string => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8").split(String.fromCharCode(13)).join("");

test("the committed build target is prod (an unstamped publish is at worst correct for real players)", () => {
  assert.equal(BUILD_TARGET, "prod");
  assert.match(read("src/buildTarget.ts"), /BUILD_TARGET: "prod" \| "dev" = "prod"/);
});

test("testRoomsVisible: prod hides the rooms, dev shows them, and a page served from this machine always shows them", () => {
  assert.equal(testRoomsVisible("prod", "living-table.conjureos.app"), false);
  assert.equal(testRoomsVisible("prod", ""), false, "no hostname is not a local page");
  assert.equal(testRoomsVisible("dev", "living-table.conjureos.app"), true);
  assert.equal(testRoomsVisible("prod", "localhost"), true, "local development keeps the rooms");
  assert.equal(testRoomsVisible("prod", "127.0.0.1"), true, "the e2e harness keeps the rooms");
  assert.equal(testRoomsVisible("prod", "localhost.evil.example"), false, "only the exact local names count");
  assert.equal(testRoomsVisible("dev", "127.0.0.1"), true);
});

test("the game host hands the decision to the window in TableEnv.testRooms", () => {
  const g = createGameHost({ storage: { store: null } });
  try {
    // Node has no page, so there is no hostname: the committed prod build hides the rooms.
    assert.equal(g.host.env.testRooms, testRoomsVisible(BUILD_TARGET, ""));
    assert.equal(g.host.env.testRooms, false);
  } finally {
    g.dispose();
  }
});

test("roomsShown: only an explicit false hides the rooms (the bench host and the memory host leave it unset)", () => {
  assert.equal(roomsShown({}), true);
  assert.equal(roomsShown({ testRooms: undefined }), true);
  assert.equal(roomsShown({ testRooms: true }), true);
  assert.equal(roomsShown({ testRooms: false }), false);
});

test("the publish workflow stamps src/buildTarget.ts to dev in the step that stamps the games-db URL, and only for the dev project", () => {
  const wf = read(".github/workflows/publish-store.yml");
  const at = wf.indexOf("- name: Stamp games-db backend URL into manifest");
  assert.ok(at > 0, "the stamping step exists");
  const step = wf.slice(at, wf.indexOf("\n      # ", at + 10) > 0 ? wf.indexOf("\n      # ", at + 10) : undefined);
  assert.ok(step.includes("src/buildTarget.ts"), "the same step rewrites the build target");
  assert.match(step, /steps\.target\.outputs\.env/, "it goes by the resolved target");
  assert.match(step, /"dev"/, "it writes dev");
  assert.ok(step.includes("grep"), "it checks the rewrite took");
});

test("the start screen asks the window, not the build: showStart passes no rooms when env.testRooms is false", () => {
  const src = read("src/games/livingtable/table/flows/adventureStart.ts");
  assert.match(src, /roomsShown\(tc\.host\.env\)/);
});

/** Run showStart over a window context with just what it touches, and hand back the options the start screen was given. */
function startOptions(env: { testRooms?: boolean; mainMenu?: boolean }): StartScreenOptions {
  const host = createMemoryHost();
  Object.assign(host.env, env);
  const offs = [bindCatalog(host.art), bindAdventures(host)];
  try {
    const session = createTableSession(host);
    let given: StartScreenOptions | null = null;
    const tc = {
      host,
      session,
      st: () => ({ template: "fantasy" }),
      closeViews() {},
      viewsChanged() {},
      overlay: {
        startScreen: (o: StartScreenOptions) => {
          given = o;
          return { close() {}, setWriting() {}, setProblems() {}, setNote() {} };
        },
      },
      openMainMenu() {},
    } as unknown as TableCtx;
    tc.menuScr = null;
    installAdventureStart(tc);
    tc.showStart();
    return given!;
  } finally {
    for (const off of offs) off();
    unbindAdventures();
    unbindCatalog();
  }
}

test("mount level: showStart lists no test rooms when env.testRooms is false, and both when it is true or unset", () => {
  assert.deepEqual(startOptions({ testRooms: false }).sandboxes, []);
  assert.equal(startOptions({ testRooms: true }).sandboxes.length, 2);
  assert.equal(startOptions({}).sandboxes.length, 2, "an unset flag (the bench host, the memory host) keeps the rooms");
  const rooms = startOptions({ testRooms: true }).sandboxes;
  assert.deepEqual(rooms.map((r) => r.id), ["room:one", "room:two"]);
  assert.ok(rooms.every((r) => r.summary && r.title));
});

test("mount level: the adventure list has a way back to the main menu only where the host has one", () => {
  assert.equal(typeof startOptions({ mainMenu: true }).onMenu, "function");
  assert.equal(startOptions({}).onMenu, undefined, "the bench opens on the list and has no main menu");
});
