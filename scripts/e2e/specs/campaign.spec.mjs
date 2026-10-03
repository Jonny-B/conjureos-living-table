// The campaign flow of the game as it ships today: list, create a campaign
// (the arc call), create a character, begin the scene (the first DM turn),
// take steps. Every AI call is scripted and counted: a price shown on a button
// must match the calls the click spends.
import { campaignScript } from "../lib/fixtures.mjs";

const ARC = /LIVINGTABLE_ARC_GENERATOR/;
const DM = /LIVINGTABLE_DM/;

export const specs = [
  {
    name: "campaign list opens empty, with a New campaign card and no AI call",
    async run({ newGame, assert }) {
      const g = await newGame({ script: campaignScript() });
      const d = g.driver;
      assert.equal(await d.title(), "The Living Table");
      assert.deepEqual(await d.campaigns(), []);
      assert.equal(await g.page.locator(".lt-new-card").count(), 1);
      assert.equal(g.platform.calls.length, 0, "opening the list must not call the model");
    },
  },

  {
    name: "New campaign shows its price before the click, then spends exactly one arc call",
    async run({ newGame, assert }) {
      const g = await newGame({ script: campaignScript() });
      const d = g.driver;
      await d.openNewCampaign();
      const note = await d.planPriceNote();
      assert.match(note, /1 credit/i, `price line under the button: ${note}`);
      assert.equal(g.platform.calls.length, 0, "nothing is spent before the click");
      const spent = await d.createCampaign({ theme: "a drowned lighthouse" });
      assert.equal(spent, 1);
      const [call] = g.platform.calls;
      assert.match(call.system, ARC);
      assert.equal(call.tier, "capable");
      assert.equal(call.maxTokens, 8000);
      assert.ok(call.messages.at(-1).content.includes("a drowned lighthouse"), "the theme reaches the prompt");
      assert.ok(call.messages.at(-1).content.toLowerCase().includes("fantasy"), "the genre reaches the prompt");
      assert.deepEqual(await d.archetypes(), ["The Knight", "The Shadow", "The Fireball Person"]);
      assert.equal(await d.title(), "Who are you?");
    },
  },

  {
    name: "an arc call that fails shows the error, spends nothing more, and offers a retry",
    async run({ newGame, assert }) {
      const g = await newGame({
        script: [{ match: ARC, reply: { error: { message: "The model is overloaded.", code: "overloaded" } } }],
      });
      const d = g.driver;
      await d.openNewCampaign();
      await g.page.getByRole("button", { name: /Plan this campaign/ }).click();
      await g.page.locator(".flash").waitFor();
      assert.match(await g.page.locator(".flash").textContent(), /overloaded/i);
      // completeJson retries a bad reply once, but a thrown provider error is not a bad reply.
      assert.equal(g.platform.calls.length, 1);
      assert.equal(await g.page.getByRole("button", { name: /Plan this campaign/ }).count(), 1, "the form is back so the player can try again");
      g.consoleErrors.length = 0; // the failed call is logged by the browser; this spec expects it
    },
  },

  {
    name: "a character is free: Begin makes no AI call and offers Begin the scene with its price",
    async run({ newGame, assert }) {
      const g = await newGame({ script: campaignScript() });
      const d = g.driver;
      await d.createCampaign();
      const before = g.platform.calls.length;
      await d.createCharacter({ name: "Tess", archetype: "The Knight" });
      assert.equal(g.platform.calls.length, before, "creating a character spends nothing");
      const s = await d.beginSceneScreen();
      assert.match(s.button, /Begin the scene/);
      assert.match(s.price, /1 credit/i);
      assert.match(s.free, /never cost a credit/i);
    },
  },

  {
    name: "Begin the scene spends one DM call and puts the hero on the board",
    async run({ newGame, assert }) {
      const g = await newGame({ script: campaignScript() });
      const d = g.driver;
      await d.createCampaign();
      await d.createCharacter({ name: "Tess", archetype: "The Knight" });
      const before = g.platform.calls.length;
      await d.beginScene();
      assert.equal(g.platform.calls.length - before, 1);
      const call = g.platform.calls.at(-1);
      assert.match(call.system, DM);
      assert.equal(call.tier, "capable");
      assert.equal(call.maxTokens, 8000);
      assert.match(call.system, /has not been assembled yet/);
      const hud = await d.hud();
      assert.equal(hud.title, "The Salt-Blighted Coast");
      assert.match(hud.subtitle, /^Tess, The Knight/);
      assert.equal(hud.hp, "HP 12/12");
      assert.ok((await d.story()).some((t) => /salt-scarred stone/.test(t)), "the DM's narration is in the story");
      assert.equal((await g.page.locator("canvas.lt-canvas").boundingBox()).width > 200, true);
    },
  },

  {
    name: "a step inside the room is free and moves the hero",
    async run({ newGame, assert }) {
      const g = await newGame({ script: campaignScript() });
      const d = g.driver;
      await d.createCampaign();
      await d.createCharacterAndBegin({ name: "Tess" });
      const calls = g.platform.calls.length;
      const still = await d.boardHash();
      await g.page.waitForTimeout(400);
      assert.equal(await d.boardHash(), still, "an idle board does not change by itself");
      assert.equal(await d.movePaid("E"), false, "a step inside the room wears no price");
      await d.step("E");
      assert.notEqual(await d.boardHash(), still, "the board redrew with the hero one tile east");
      await d.step("W");
      assert.equal(await d.boardHash(), still, "and back again puts it back exactly");
      assert.equal(g.platform.calls.length, calls, "walking inside a room never calls the model");
    },
  },

  {
    name: "stepping through a gap builds the next room: priced on the button, one DM call",
    async run({ newGame, assert }) {
      const g = await newGame({ script: campaignScript() });
      const d = g.driver;
      await d.createCampaign();
      await d.createCharacterAndBegin({ name: "Tess" });
      const calls = g.platform.calls.length;
      const placeBefore = (await d.hud()).subtitle;
      // The east gap is on the room's middle row; the hero starts in the middle.
      let guard = 0;
      while (!(await d.movePaid("E"))) {
        await d.step("E");
        if (++guard > 20) throw new Error("never reached the east edge");
      }
      assert.equal(g.platform.calls.length, calls, "the approach was free");
      await d.move("E").click();
      await g.page.waitForFunction(() => !document.querySelector(".thinking"), null, { timeout: 15000 });
      await g.platform.waitForCalls(calls + 1);
      assert.equal(g.platform.calls.length, calls + 1, "the crossing spends exactly one call");
      const call = g.platform.calls.at(-1);
      assert.match(call.system, DM);
      assert.match(call.messages.at(-1).content, /party moves E into the unexplored/);
      assert.match(call.system, /Current playspace: cell \(0,0\)/);
      await g.page.waitForFunction((prev) => document.querySelector("header.game-head .game-head-text p")?.textContent !== prev, placeBefore, { timeout: 15000 });
      assert.equal(await d.movePaid("W"), false, "the way back is already built, so it is free");
    },
  },

  {
    name: "Back returns to the list and the campaign is there, opening it resumes at the board",
    async run({ newGame, assert }) {
      const g = await newGame({ script: campaignScript() });
      const d = g.driver;
      await d.createCampaign();
      await d.createCharacterAndBegin({ name: "Tess" });
      await d.back();
      await d.openList();
      const list = await d.campaigns();
      assert.equal(list.length, 1);
      assert.equal(list[0].title, "The Salt-Blighted Coast");
      assert.equal(list[0].genre, "Fantasy");
      const calls = g.platform.calls.length;
      await g.page.locator(".lt-campaign-card:not(.lt-new-card)").click();
      await g.page.locator("canvas.lt-canvas").waitFor();
      assert.equal(g.platform.calls.length, calls, "resuming a campaign never calls the model");
      assert.match((await d.hud()).subtitle, /^Tess, The Knight/);
    },
  },

  {
    name: "a free-text Talk spends one DM call and shows the answer in the story",
    async run({ newGame, assert }) {
      const g = await newGame({ script: campaignScript() });
      const d = g.driver;
      await d.createCampaign();
      await d.createCharacterAndBegin({ name: "Tess" });
      const calls = g.platform.calls.length;
      await d.talk("Hello there");
      await g.platform.waitForCalls(calls + 1);
      await g.page.waitForFunction(() => /You say your piece/.test(document.querySelector(".lt-narration")?.textContent ?? ""), null, { timeout: 15000 });
      assert.equal(g.platform.calls.length, calls + 1);
      assert.match(g.platform.calls.at(-1).messages.at(-1).content, /Hello there/);
    },
  },

  {
    name: "a parked first turn shows the DM busy line and keeps the board down until the reply lands",
    async run({ newGame, assert }) {
      const base = campaignScript();
      const g = await newGame({ script: [] });
      const d = g.driver;
      // The DM entry parks every call until released; the arc entry answers at once.
      g.platform.script([base[0], { ...base[1], hold: true }]);
      await d.createCampaign();
      await d.createCharacter({ name: "Tess" });
      await g.page.getByRole("button", { name: /Begin the scene/ }).click();
      await g.platform.waitForCalls(2);
      await g.page.getByText("The dungeon master is setting the scene").waitFor({ timeout: 5000 });
      assert.equal(await g.page.locator(".lt-play-layout").count(), 0, "the board is not up while the first turn is parked");
      g.platform.release();
      await g.page.locator(".lt-play-layout").waitFor({ timeout: 15000 });
      assert.equal(g.platform.calls.length, 2);
    },
  },

  {
    name: "the phone layout (390 wide) has no sideways scroll on the list or the board",
    async run({ newGame, assert }) {
      const g = await newGame({ script: campaignScript(), viewport: { width: 390, height: 844 } });
      const d = g.driver;
      const overflow = () => g.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await d.openList();
      assert.ok((await overflow()) <= 1, "list overflows sideways");
      await d.createCampaign();
      await d.createCharacterAndBegin({ name: "Tess" });
      assert.ok((await overflow()) <= 1, `board overflows sideways by ${await overflow()}px`);
    },
  },
];
