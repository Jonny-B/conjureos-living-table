/**
 * Tests for the foe dice ladder (scripts/asset-bench/foeDice.ts) and the way the
 * bench's dice tray wears a foe's look for one throw (scripts/asset-bench/dice.ts):
 * which tier a challenge rating gets, that every bestiary creature (and the sci-fi
 * tokens) maps to a skin and a tray that exist, the undead and dragon accents, that
 * foe skins keep a legible numeral on every face of every die, and that a roll with
 * a tray and skin repaints the tray for that throw only and the next roll without
 * them goes back to the player's own. The tray tests run the real createDiceTray
 * against a tiny fake DOM (the module touches the DOM only inside functions), so
 * the revert is checked through the tray's own data-* hooks.
 *
 * Run: npx tsx --test test/livingtable-bench-foe-dice.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { BESTIARY, beastById } from "../src/games/livingtable/rules/bestiary";
import {
  DICE_SKINS,
  DIE_KINDS,
  DIE_SIDES,
  DRAGON_COLOURS,
  FOE_DICE_SKINS,
  PLAYER_TRAY_ID,
  TRAY_LOOKS,
  contrastRatio,
  createDiceTray,
  foeSkinId,
  foeTrayId,
  renderDie,
  renderTrayPreview,
  restOrientation,
  skinById,
  trayLookById,
  type DiceSkin,
} from "../scripts/asset-bench/dice";
import { FOE_TIER_WORDS, foeDiceFor, foeDiceForToken, tierForCr, type FoeTier } from "../scripts/asset-bench/foeDice";

const beast = (id: string) => beastById(id) as NonNullable<ReturnType<typeof beastById>>;
const skin = (id: string) => skinById(id) as DiceSkin;
/** True when the text holds an em dash or an en dash (built from char codes so this file never types one). */
const hasDash = (s: string): boolean => s.includes(String.fromCharCode(0x2014)) || s.includes(String.fromCharCode(0x2013));

// ---- the ladder ------------------------------------------------------------

test("tierForCr: six tiers by challenge rating, fractions and zero included", () => {
  const want: [string, FoeTier][] = [
    ["0", 0], ["1/8", 0],
    ["1/4", 1], ["1/2", 1],
    ["1", 2], ["2", 2],
    ["3", 3], ["4", 3],
    ["5", 4], ["6", 4], ["7", 4],
    ["8", 5], ["9", 5], ["10", 5], ["17", 5], ["30", 5],
  ];
  for (const [cr, tier] of want) assert.equal(tierForCr(cr), tier, `CR ${cr}`);
  // Every challenge rating in the SRD tables lands on one of the six, and never goes down as the rating goes up.
  const order = ["0", "1/8", "1/4", "1/2", ...Array.from({ length: 30 }, (_, i) => String(i + 1))];
  for (const cr of order) assert.ok([0, 1, 2, 3, 4, 5].includes(tierForCr(cr)), cr);
  for (let i = 1; i < order.length; i++) assert.ok(tierForCr(order[i] as string) >= tierForCr(order[i - 1] as string), order[i]);
  // Junk is a mid-low tier rather than a throw.
  for (const junk of ["", "abc", "1/0", "-3", "1/", "two"]) assert.equal(tierForCr(junk), 1, JSON.stringify(junk));
  // Whitespace around a fraction is tolerated.
  assert.equal(tierForCr(" 1 / 2 "), 1);
});

test("FOE_TIER_WORDS: one plain line per tier, no dashes, naming the CR range", () => {
  assert.equal(FOE_TIER_WORDS.length, 6);
  for (const [i, line] of FOE_TIER_WORDS.entries()) {
    assert.ok(line.startsWith(`Tier ${i} `), line);
    assert.equal(hasDash(line), false, "no em or en dash");
    assert.ok(line.length > 40 && line.length < 200, line);
  }
});

test("every bestiary creature maps to a skin and a tray that exist, at its own tier", () => {
  assert.ok(BESTIARY.length >= 40);
  const shop = new Set(DICE_SKINS.map((s) => s.id));
  for (const b of BESTIARY) {
    const look = foeDiceFor(b);
    assert.equal(look.tier, tierForCr(b.cr), b.id);
    assert.ok(skinById(look.skinId), `${b.id}: skin ${look.skinId}`);
    assert.ok(trayLookById(look.trayId), `${b.id}: tray ${look.trayId}`);
    assert.equal(shop.has(look.skinId), false, `${b.id}: a foe never rolls a shop skin`);
    assert.ok(look.name.includes(", "), look.name);
    assert.equal(hasDash(look.name), false);
    assert.ok(FOE_DICE_SKINS.some((s) => s.id === look.skinId), look.skinId);
  }
});

test("the goblin is tier 1, and the named examples land where the owner expects", () => {
  const goblin = foeDiceFor(beast("goblin"));
  assert.equal(goblin.tier, 1);
  assert.equal(goblin.accent, undefined);
  assert.equal(goblin.skinId, foeSkinId(1));
  assert.equal(goblin.trayId, foeTrayId(1));
  assert.equal(goblin.name, "Iron-bound box, iron dice");
  assert.equal(foeDiceFor(beast("rat")).tier, 0);
  assert.equal(foeDiceFor(beast("ogre")).tier, 2);
  assert.equal(foeDiceFor(beast("owlbear")).tier, 3);
  assert.equal(foeDiceFor(beast("troll")).tier, 4);
  assert.equal(foeDiceFor(beast("young-green-dragon")).tier, 5);
});

test("undead and dragon accents layer on the tier", () => {
  for (const b of BESTIARY) {
    const look = foeDiceFor(b);
    const undead = b.type.startsWith("undead");
    const dragon = b.type.startsWith("dragon");
    assert.equal(look.accent, undead ? "undead" : dragon ? "dragon" : undefined, b.id);
  }
  const skeleton = foeDiceFor(beast("skeleton"));
  assert.equal(skeleton.accent, "undead");
  assert.equal(skeleton.skinId, foeSkinId(1, "undead"));
  assert.equal(skeleton.trayId, foeTrayId(1, "undead"));
  assert.notEqual(skeleton.skinId, foeDiceFor(beast("goblin")).skinId, "same tier, but its own die");
  // Bone-white die: the lightest body step is near white, not iron.
  assert.ok(contrastRatio(skin(skeleton.skinId).ramp[0] as string, "#ffffff") < 1.2, "bone-white");
  // A sickly green glow on the rim from tier 2 up, none below.
  const glows = (id: string) => (trayLookById(id)?.effects ?? []).some((e) => e.kind === "glow");
  assert.equal(glows(foeTrayId(0, "undead")), false);
  assert.equal(glows(foeTrayId(1, "undead")), false);
  for (const t of [2, 3, 4, 5] as const) assert.equal(glows(foeTrayId(t, "undead")), true, `tier ${t}`);
  assert.equal(foeDiceFor(beast("wraith")).tier, 4);
  assert.equal(trayLookById(foeDiceFor(beast("wraith")).trayId)?.rim.texture, "bone");
  assert.equal(trayLookById(foeDiceFor(beast("wight")).trayId)?.rim.corners, "skulls");

  const red = foeDiceFor(beast("red-dragon-wyrmling"));
  const green = foeDiceFor(beast("young-green-dragon"));
  assert.equal(red.accent, "dragon");
  assert.equal(green.accent, "dragon");
  assert.equal(red.skinId, foeSkinId(3, "dragon", "red"));
  assert.equal(green.skinId, foeSkinId(5, "dragon", "green"));
  assert.equal(red.trayId, foeTrayId(3, "dragon", "red"));
  assert.notEqual(red.skinId, green.skinId);
  // Scaled rim and hoard gold; tinted by the dragon's colour.
  const redTray = trayLookById(red.trayId);
  assert.equal(redTray?.rim.texture, "scales");
  assert.equal(redTray?.rim.metal?.body, "#eab932");
  assert.ok(redTray && redTray.rim.palette.body !== trayLookById(foeTrayId(3, "dragon", "green"))?.rim.palette.body, "red and green rims differ");
  // A dragon with no colour in its id keeps the plain dragon look.
  const plain = foeDiceFor({ ...beast("young-green-dragon"), id: "ancient-dragon" });
  assert.equal(plain.skinId, foeSkinId(5, "dragon"));
  assert.ok(skinById(plain.skinId) && trayLookById(plain.trayId));
  // Every colour has a full ladder of skins and trays.
  for (const c of DRAGON_COLOURS) for (const t of [0, 1, 2, 3, 4, 5] as const) assert.ok(skinById(foeSkinId(t, "dragon", c)) && trayLookById(foeTrayId(t, "dragon", c)), `${c} ${t}`);
});

test("foeDiceForToken: bestiary tokens by their creature, sci-fi tokens by their SRD CR, the rest tier 1", () => {
  assert.equal(foeDiceForToken("token_goblin").tier, 1);
  assert.equal(foeDiceForToken("token_goblin").skinId, foeDiceFor(beast("goblin")).skinId);
  const skel = foeDiceForToken("token_skeleton");
  assert.equal(skel.tier, 1);
  assert.equal(skel.accent, "undead");
  // A Raider is the SRD Bandit (CR 1/8): tier 0. A Combat Drone is the Flying Sword (CR 1/4): tier 1.
  assert.equal(foeDiceForToken("token_raider").tier, 0);
  assert.equal(foeDiceForToken("token_drone").tier, 1);
  assert.equal(foeDiceForToken("token_raider").skinId, foeSkinId(0));
  assert.equal(foeDiceForToken("token_drone").accent, undefined);
  for (const unknown of ["token_villager", "token_knight", "", "who_knows"]) {
    const look = foeDiceForToken(unknown);
    assert.equal(look.tier, 1, unknown);
    assert.ok(skinById(look.skinId) && trayLookById(look.trayId));
  }
});

test("the ladder climbs: finishes never go down, the tray gains motion at the top, and no two tiers share a die or a felt", () => {
  const rank = { matte: 0, metal: 1, gloss: 2 } as const;
  let last = -1;
  for (const t of [0, 1, 2, 3, 4, 5] as const) {
    const s = skin(foeSkinId(t));
    assert.ok(rank[s.finish] >= last, `tier ${t} finish`);
    last = rank[s.finish];
    if (t > 0) {
      assert.notEqual(s.ramp[1], skin(foeSkinId((t - 1) as FoeTier)).ramp[1], `tier ${t} die differs from the one below`);
      assert.notEqual(trayLookById(foeTrayId(t))?.felt.base, trayLookById(foeTrayId((t - 1) as FoeTier))?.felt.base, `tier ${t} felt differs`);
    }
  }
  assert.equal(skin(foeSkinId(0)).finish, "matte");
  assert.equal(skin(foeSkinId(5)).finish, "gloss");
  // Tiers 0 to 3 are still; 4 shimmers; 5 pulses and drifts embers.
  for (const t of [0, 1, 2, 3] as const) assert.equal(trayLookById(foeTrayId(t))?.effects.length, 0, `tier ${t}`);
  assert.deepEqual(trayLookById(foeTrayId(4))?.effects.map((e) => e.kind), ["shimmer"]);
  assert.deepEqual(trayLookById(foeTrayId(5))?.effects.map((e) => e.kind).sort(), ["embers", "pulse"]);
  // Tier 4 is vein-marbled, tier 5 ember-veined.
  assert.equal(skin(foeSkinId(4)).pattern?.kind, "marble");
  assert.equal(skin(foeSkinId(5)).pattern?.kind, "marble");
  // The player's own tray is not one of the foe's.
  assert.equal(TRAY_LOOKS.filter((l) => l.id === PLAYER_TRAY_ID).length, 1);
});

// ---- numerals --------------------------------------------------------------

/**
 * A numeral is legible on a body colour when it contrasts with it by at least 3:1
 * (WCAG 1.4.11, non-text contrast: a numeral is a graphic), or, when the skin gives
 * it a 1 px halo, when the numeral contrasts with the halo by at least 4.5:1 (the
 * halo then isolates the glyph from whatever body it sits on). The body colours that
 * count are every ramp step (the lightest and the darkest bound them all) and the
 * pattern colour (a marble vein or a speckle can sit beside a numeral).
 */
function legible(s: DiceSkin): { ok: boolean; why: string } {
  const bodies = [...s.ramp, ...(s.pattern ? [s.pattern.color] : [])];
  const worst = Math.min(...bodies.map((b) => contrastRatio(s.numeral, b)));
  if (worst >= 3) return { ok: true, why: `numeral ${worst.toFixed(2)}:1 on every body colour` };
  const halo = s.numeralOutline ? contrastRatio(s.numeral, s.numeralOutline) : 0;
  return { ok: halo >= 4.5, why: `worst body ${worst.toFixed(2)}:1, halo ${halo.toFixed(2)}:1` };
}

test("every foe skin keeps a legible numeral: contrast against the lightest and darkest body, with the halo counted", () => {
  for (const s of FOE_DICE_SKINS) {
    const light = contrastRatio(s.numeral, s.ramp[0] as string);
    const dark = contrastRatio(s.numeral, s.ramp[s.ramp.length - 1] as string);
    const res = legible(s);
    assert.ok(res.ok, `${s.id}: ${res.why} (lightest ${light.toFixed(2)}, darkest ${dark.toFixed(2)})`);
    // The numeral never matches a body colour outright, with or without a halo.
    for (const b of s.ramp) assert.notEqual(b.toLowerCase(), s.numeral.toLowerCase(), `${s.id}: numeral equals a body step`);
    if (s.numeralOutline) assert.ok(contrastRatio(s.numeral, s.numeralOutline) >= 4.5, `${s.id}: halo against numeral`);
  }
});

test("every foe skin shows its numeral on the front face of every die, rendered (not just in data)", () => {
  for (const s of FOE_DICE_SKINS) {
    const n = parseInt(s.numeral.slice(1), 16);
    for (const kind of DIE_KINDS) {
      for (const result of [1, DIE_SIDES[kind]]) {
        const sprite = renderDie(kind, restOrientation(kind, result), s, 48);
        assert.equal(sprite.faces[0]?.number, result, `${s.id} ${kind}`);
        assert.equal(sprite.faces[0]?.shown, true, `${s.id} ${kind} ${result}: the front face carries its number`);
        let ink = 0;
        for (let i = 0; i < 48 * 48; i++) if (sprite.data[i * 4] === ((n >> 16) & 255) && sprite.data[i * 4 + 1] === ((n >> 8) & 255) && sprite.data[i * 4 + 2] === (n & 255) && sprite.data[i * 4 + 3] === 255) ink++;
        assert.ok(ink >= 5, `${s.id} ${kind} ${result}: ${ink} numeral pixels`);
      }
    }
  }
});

// ---- the tray wears a foe's look for one throw -------------------------------

class FakeEl {
  children: unknown[] = [];
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  attrs: Record<string, string> = {};
  className = "";
  textContent = "";
  width = 0;
  height = 0;
  tabIndex = -1;
  clientWidth = 360;
  constructor(public tag: string) {}
  append(...n: unknown[]): void {
    this.children.push(...n);
  }
  remove(): void {}
  addEventListener(): void {}
  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
  }
  getBoundingClientRect(): { width: number } {
    return { width: this.clientWidth };
  }
  getContext(): unknown {
    return makeCtx();
  }
}

function makeCtx(): unknown {
  const store: Record<string, unknown> = {
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  };
  return new Proxy(store, {
    get: (t, k: string) => (k in t ? t[k] : () => undefined),
    set: (t, k: string, v) => {
      t[k] = v;
      return true;
    },
  });
}

class FakeImageData {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}

/** Install the fake DOM, run `fn`, and put the globals back. `reduced` makes matchMedia report prefers-reduced-motion. */
async function withFakeDom(reduced: boolean, fn: (host: FakeEl) => Promise<void> | void): Promise<void> {
  const g = globalThis as Record<string, unknown>;
  const keep = ["document", "window", "ImageData", "matchMedia"].map((k) => [k, g[k], k in g] as const);
  g.document = { createElement: (tag: string) => new FakeEl(tag), getElementById: () => null, head: { appendChild: () => undefined } };
  g.window = { devicePixelRatio: 1, setTimeout: (f: () => void, ms: number) => setTimeout(f, ms) };
  g.ImageData = FakeImageData;
  g.matchMedia = () => ({ matches: reduced });
  try {
    await fn(new FakeEl("div"));
  } finally {
    for (const [k, v, had] of keep) {
      if (had) g[k] = v;
      else delete g[k];
    }
  }
}

function rootOf(host: FakeEl): FakeEl {
  return host.children[0] as FakeEl;
}

const D20 = [{ kind: "d20" as const, result: 17 }];

test("a roll with a tray and a skin shows them for that throw; the next roll without them goes back to the player's own", async () => {
  await withFakeDom(true, async (host) => {
    const tray = createDiceTray(host as unknown as HTMLElement, "ruby");
    const root = rootOf(host);
    assert.equal(root.dataset.tray, PLAYER_TRAY_ID);
    assert.equal(root.dataset.skin, "ruby");
    const goblin = foeDiceFor(beast("goblin"));

    await tray.roll({ dice: D20, label: "17 + 4 = 21 vs 15", detail: "HIT", tone: "bad", skin: goblin.skinId, tray: goblin.trayId, who: "The goblin rolls" });
    assert.equal(root.dataset.tray, goblin.trayId);
    assert.equal(root.dataset.skin, goblin.skinId);
    assert.equal(root.dataset.who, "The goblin rolls");
    assert.equal(root.dataset.state, "settled");
    assert.equal(tray.look().id, goblin.trayId);
    assert.equal(tray.skin().id, "ruby", "skin() is the player's own, whatever this throw wears");
    assert.match(root.dataset.text ?? "", /HIT/);

    // The look stays until the next roll.
    assert.equal(root.dataset.tray, goblin.trayId);

    await tray.roll({ dice: D20, label: "mine" });
    assert.equal(root.dataset.tray, PLAYER_TRAY_ID);
    assert.equal(root.dataset.skin, "ruby");
    assert.equal(root.dataset.who, "");
    assert.equal(tray.look().id, PLAYER_TRAY_ID);

    // Tray without skin, and skin without tray, each change only what they name.
    await tray.roll({ dice: D20, tray: foeTrayId(3) });
    assert.equal(root.dataset.tray, foeTrayId(3));
    assert.equal(root.dataset.skin, "ruby");
    await tray.roll({ dice: D20, skin: foeSkinId(5) });
    assert.equal(root.dataset.tray, PLAYER_TRAY_ID);
    assert.equal(root.dataset.skin, foeSkinId(5));
    // A shop skin may be asked for by id too.
    await tray.roll({ dice: D20, skin: "emerald" });
    assert.equal(root.dataset.skin, "emerald");
    assert.equal(tray.skin().id, "ruby");
    // Ids it does not know are ignored: the player's own look.
    await tray.roll({ dice: D20, skin: "no-such-skin", tray: "no-such-tray", who: "   " });
    assert.equal(root.dataset.tray, PLAYER_TRAY_ID);
    assert.equal(root.dataset.skin, "ruby");
    assert.equal(root.dataset.who, "");
    tray.destroy();
  });
});

test("awaitRoll, setSkin and clear all bring the player's own tray back", async () => {
  await withFakeDom(true, async (host) => {
    const tray = createDiceTray(host as unknown as HTMLElement, "bone");
    const root = rootOf(host);
    const foe = foeDiceFor(beast("young-green-dragon"));
    const throwFoe = () => tray.roll({ dice: D20, skin: foe.skinId, tray: foe.trayId, who: "The dragon rolls" });

    await throwFoe();
    assert.equal(root.dataset.tray, foe.trayId);
    void tray.awaitRoll("Tap to roll", ["d20"]);
    assert.equal(root.dataset.tray, PLAYER_TRAY_ID, "waiting for the player's tap is the player's tray");
    assert.equal(root.dataset.skin, "bone");
    assert.equal(root.dataset.who, "");
    await tray.roll({ dice: D20 });

    await throwFoe();
    tray.setSkin("obsidian");
    assert.equal(tray.skin().id, "obsidian");
    assert.equal(root.dataset.tray, PLAYER_TRAY_ID, "picking a skin in the shop shows it on the player's tray at once");
    assert.equal(root.dataset.skin, "obsidian");
    // The shop cannot equip a foe skin.
    tray.setSkin(foe.skinId);
    assert.equal(tray.skin().id, "obsidian");

    await throwFoe();
    tray.clear();
    assert.equal(root.dataset.tray, PLAYER_TRAY_ID);
    assert.equal(root.dataset.state, "empty");
    tray.destroy();
  });
});

test("a throw with motion (not reduced) takes the look at once and keeps it after skip(); the next throw reverts", async () => {
  await withFakeDom(false, async (host) => {
    let clock = 0;
    const tray = createDiceTray(host as unknown as HTMLElement, "bone", { seed: 5, now: () => clock });
    const root = rootOf(host);
    const foe = foeDiceFor(beast("troll"));
    const p = tray.roll({ dice: D20, label: "x", skin: foe.skinId, tray: foe.trayId, who: "The troll rolls" });
    assert.equal(root.dataset.state, "rolling");
    assert.equal(root.dataset.tray, foe.trayId);
    assert.equal(root.dataset.skin, foe.skinId);
    tray.skip();
    await p;
    assert.equal(root.dataset.state, "settled");
    assert.equal(root.dataset.tray, foe.trayId);
    clock += 50;
    const q = tray.roll({ dice: D20 });
    assert.equal(root.dataset.tray, PLAYER_TRAY_ID);
    assert.equal(root.dataset.skin, "bone");
    tray.skip();
    await q;
    tray.destroy();
  });
});

test("renderTrayPreview returns a canvas of the asked size (and a whole-number multiple with scale)", async () => {
  await withFakeDom(false, () => {
    const c = renderTrayPreview(foeTrayId(2), foeSkinId(2), "d20", 20) as unknown as FakeEl;
    assert.equal(c.width, 96);
    assert.equal(c.height, 60);
    const wide = renderTrayPreview(foeTrayId(5), foeSkinId(5), "d6", 6, { width: 120, height: 70 }) as unknown as FakeEl;
    assert.equal(wide.width, 120);
    assert.equal(wide.height, 70);
    const scaled = renderTrayPreview(foeTrayId(4), foeSkinId(4), "d8", 8, { width: 100, height: 64, scale: 3 }) as unknown as FakeEl;
    assert.equal(scaled.width, 300);
    assert.equal(scaled.height, 192);
    assert.equal(scaled.attrs["aria-hidden"], "true");
  });
});

test("the modules touch no DOM at import time (this file imported both with no document in scope)", () => {
  assert.equal(typeof createDiceTray, "function");
  assert.equal(typeof foeDiceFor, "function");
  assert.equal(typeof (globalThis as Record<string, unknown>).document, "undefined");
});
