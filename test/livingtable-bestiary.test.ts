/**
 * Tests for the Bestiary (src/games/livingtable/rules/bestiary.ts).
 *
 * The data is hand-authored SRD 5.1 numbers, so these tests check it is
 * internally consistent (HP against hit dice, XP against CR, damage
 * averages against dice, passive Perception against skills) and that the
 * creatures the game fights with (the goblin, the skeleton, the rat and the
 * giant rat) agree exactly with MONSTER_STATBLOCKS in session/combat.ts.
 *
 * Run: npx tsx --test test/livingtable-bestiary.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BESTIARY, CR_ORDER, XP_BY_CR, abilityMod, beastById } from "../src/games/livingtable/rules/bestiary";
import type { Beast } from "../src/games/livingtable/rules/bestiary";
import { MONSTER_STATBLOCKS } from "../src/games/livingtable/session/combat";

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;

/** Rounded-down average of "NdS", "NdS+M", "NdS-M" or a flat "N". */
function average(dice: string): number {
  const flat = /^(\d+)$/.exec(dice);
  if (flat) return Number(flat[1]);
  const m = /^(\d+)d(\d+)([+-]\d+)?$/.exec(dice);
  assert.ok(m, `unparseable dice: ${dice}`);
  const n = Number(m[1]);
  const sides = Number(m[2]);
  const mod = m[3] ? Number(m[3]) : 0;
  return Math.floor((n * (sides + 1)) / 2 + mod);
}

/** Every string anywhere inside a value, for the dash check. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) {
    out.push(k);
    strings(v, out);
  }
  return out;
}

test("the bestiary has at least 36 creatures with unique ids", () => {
  assert.ok(BESTIARY.length >= 36, `only ${BESTIARY.length} creatures`);
  const ids = BESTIARY.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate id");
  const names = BESTIARY.map((b) => b.name);
  assert.equal(new Set(names).size, names.length, "duplicate name");
});

test("the bestiary is sorted by CR then name, and every CR is known", () => {
  for (const b of BESTIARY) assert.ok(CR_ORDER.includes(b.cr), `${b.id}: unknown CR ${b.cr}`);
  for (let i = 1; i < BESTIARY.length; i++) {
    const a = BESTIARY[i - 1];
    const b = BESTIARY[i];
    const ca = CR_ORDER.indexOf(a.cr);
    const cb = CR_ORDER.indexOf(b.cr);
    assert.ok(ca < cb || (ca === cb && a.name < b.name), `${a.id} must sort before ${b.id}`);
  }
});

test("CR_ORDER ascends and XP_BY_CR covers every entry in it", () => {
  const num = (cr: string) => (cr.includes("/") ? Number(cr.split("/")[0]) / Number(cr.split("/")[1]) : Number(cr));
  for (let i = 1; i < CR_ORDER.length; i++) assert.ok(num(CR_ORDER[i - 1]) < num(CR_ORDER[i]));
  for (const cr of CR_ORDER) assert.ok(typeof XP_BY_CR[cr] === "number", `no XP for CR ${cr}`);
  assert.equal(XP_BY_CR["1/4"], 50);
  assert.equal(XP_BY_CR["8"], 3900);
});

test("abilityMod follows the SRD table", () => {
  assert.equal(abilityMod(10), 0);
  assert.equal(abilityMod(11), 0);
  assert.equal(abilityMod(9), -1);
  assert.equal(abilityMod(8), -1);
  assert.equal(abilityMod(1), -5);
  assert.equal(abilityMod(2), -4);
  assert.equal(abilityMod(20), 5);
  assert.equal(abilityMod(21), 5);
});

test("every ability score is a whole number from 1 to 30 with a derivable modifier", () => {
  for (const b of BESTIARY) {
    for (const k of ABILITIES) {
      const score = b.scores[k];
      assert.ok(Number.isInteger(score) && score >= 1 && score <= 30, `${b.id} ${k}=${score}`);
      assert.equal(abilityMod(score), Math.floor((score - 10) / 2));
    }
  }
});

test("hit points equal the floor of the hit dice average", () => {
  for (const b of BESTIARY) {
    assert.equal(b.hp, average(b.hpDice), `${b.id}: hp ${b.hp} vs ${b.hpDice}`);
  }
});

test("xp matches the CR table", () => {
  for (const b of BESTIARY) assert.equal(b.xp, XP_BY_CR[b.cr], `${b.id}: xp ${b.xp} at CR ${b.cr}`);
});

test("passive Perception is 10 plus the Perception skill, or the Wisdom modifier", () => {
  for (const b of BESTIARY) {
    const bonus = b.skills?.Perception ?? abilityMod(b.scores.wis);
    assert.equal(b.passivePerception, 10 + bonus, `${b.id}: passive ${b.passivePerception}`);
  }
});

test("each attack's damage average equals the dice average", () => {
  for (const b of BESTIARY) {
    for (const atk of b.attacks) {
      for (const d of atk.damage) {
        assert.equal(d.average, average(d.dice), `${b.id} ${atk.name}: ${d.dice} averages ${average(d.dice)}, listed ${d.average}`);
        assert.ok(d.type.length > 0);
      }
    }
  }
});

test("attacks are well formed", () => {
  for (const b of BESTIARY) {
    assert.ok(b.attacks.length > 0, `${b.id} has no attacks`);
    for (const atk of b.attacks) {
      assert.ok(atk.damage.length > 0, `${b.id} ${atk.name} lists no damage`);
      if (atk.kind === "melee") assert.ok(atk.reachFt && atk.reachFt >= 5, `${b.id} ${atk.name} needs a reach`);
      if (atk.kind === "ranged") assert.ok(atk.rangeFt && atk.rangeFt[0] < atk.rangeFt[1], `${b.id} ${atk.name} needs a range`);
      if (atk.kind === "melee or ranged") assert.ok(atk.reachFt && atk.rangeFt, `${b.id} ${atk.name} needs reach and range`);
    }
  }
});

test("every entry has the descriptive fields filled in", () => {
  for (const b of BESTIARY) {
    assert.ok(b.description.length > 40, `${b.id} description`);
    assert.ok(b.habitat.length > 8, `${b.id} habitat`);
    assert.ok(b.tactics.length > 20, `${b.id} tactics`);
    assert.ok(b.tags.length > 0, `${b.id} tags`);
    assert.ok(b.ac >= 5 && b.ac <= 25, `${b.id} AC`);
    assert.ok(b.speed.walk >= 0);
    for (const f of [...b.traits, ...(b.specials ?? []), ...(b.reactions ?? [])]) {
      assert.ok(f.name.length > 0 && f.text.length > 0, `${b.id} feature`);
    }
  }
});

test("beastById finds an entry and returns undefined for a stranger", () => {
  assert.equal(beastById("goblin")?.name, "Goblin");
  assert.equal(beastById("troll")?.cr, "5");
  assert.equal(beastById("beholder"), undefined);
  for (const b of BESTIARY) assert.equal(beastById(b.id), b);
});

test("the staple creatures are all present", () => {
  for (const id of [
    "rat", "giant-rat", "stirge", "kobold", "goblin", "skeleton", "zombie", "wolf", "giant-spider", "bandit", "cultist",
    "orc", "hobgoblin", "gnoll", "bugbear", "lizardfolk", "ghoul", "harpy", "dire-wolf", "brown-bear", "black-bear",
    "giant-bat", "ogre", "owlbear", "gelatinous-cube", "mimic", "rust-monster", "gargoyle", "ettercap", "wight", "specter",
    "werewolf", "minotaur", "basilisk", "manticore", "red-dragon-wyrmling", "wraith", "troll", "hill-giant", "young-green-dragon",
  ]) assert.ok(beastById(id), `missing ${id}`);
});

function matchesStatblock(beast: Beast, assetId: string): void {
  const sb = MONSTER_STATBLOCKS[assetId];
  assert.ok(sb, `no MONSTER_STATBLOCKS entry for ${assetId}`);
  assert.equal(beast.tokenAssetId, assetId);
  assert.equal(beast.name, sb.name);
  assert.equal(beast.ac, sb.armorClass);
  assert.equal(beast.hp, sb.maxHp);
  const first = beast.attacks[0];
  assert.equal(first.toHit, sb.attackBonus);
  assert.equal(first.damage.length, 1);
  assert.equal(first.damage[0].dice, sb.damageNotation);
  for (const k of ABILITIES) assert.equal(abilityMod(beast.scores[k]), sb.abilityModifiers[k], `${beast.id} ${k} modifier`);
}

test("the goblin matches MONSTER_STATBLOCKS.token_goblin exactly", () => {
  const goblin = beastById("goblin");
  assert.ok(goblin);
  matchesStatblock(goblin, "token_goblin");
});

test("the skeleton matches MONSTER_STATBLOCKS.token_skeleton exactly", () => {
  const skeleton = beastById("skeleton");
  assert.ok(skeleton);
  matchesStatblock(skeleton, "token_skeleton");
});

test("the rat matches MONSTER_STATBLOCKS.token_rat exactly", () => {
  const rat = beastById("rat");
  assert.ok(rat);
  matchesStatblock(rat, "token_rat");
});

test("the giant rat matches MONSTER_STATBLOCKS.token_giant_rat exactly", () => {
  const giant = beastById("giant-rat");
  assert.ok(giant);
  matchesStatblock(giant, "token_giant_rat");
});

test("only the goblin, skeleton, rat and giant rat claim a token", () => {
  const withTokens = BESTIARY.filter((b) => b.tokenAssetId).map((b) => b.id).sort();
  assert.deepEqual(withTokens, ["giant-rat", "goblin", "rat", "skeleton"]);
});

test("no em dash, en dash or minus sign characters anywhere in the data", () => {
  // Built from char codes so this file itself carries none of them.
  const banned = new Set([0x2013, 0x2014, 0x2212].map((c) => String.fromCharCode(c)));
  for (const s of strings(BESTIARY)) {
    for (const ch of s) assert.ok(!banned.has(ch), `dash in: ${s.slice(0, 60)}`);
  }
});

// ── SRD 5.1 cross-check ────────────────────────────────────────────────
//
// SRD below was parsed straight from the SRD 5.1 PDF text (Monsters section),
// independently of bestiary.ts, so a number mistyped or recalled wrongly in
// the data shows up here. Keys: ac, hp, hd (hit dice), sp (speeds), sc (STR to
// CHA), sv (saves), sk (skills), se (senses without passive Perception), pp,
// lg (languages, "--" for none), cr, xp, atk (attack-roll actions: n name,
// k kind, h to hit, r reach, g [normal, long] range, t target, d [dice, type]).
// Giant spider and ettercap Web are attack rolls in the SRD but live in
// `specials` in the data (see WEB_IN_SPECIALS), so they are not listed here.

interface SrdAttack { n: string; k: string; h: number; r?: number; g?: number[]; t: string; d: string[][] }
interface SrdEntry {
  id: string; ac: number; hp: number; hd: string; sp: Record<string, number>; sc: number[];
  sv?: Record<string, number>; sk?: Record<string, number>; se: string; pp: number; lg: string;
  cr: string; xp: number; atk: SrdAttack[];
}

const SRD: SrdEntry[] = [
  {id:"rat",ac:10,hp:1,hd:"1d4-1",sp:{walk:20},sc:[2,11,9,2,10,4],se:"darkvision 30 ft.",pp:10,lg:"--",cr:"0",xp:10,atk:[{n:"bite",k:"melee",h:0,r:5,t:"one target",d:[["1","piercing"]]}]},
  {id:"giant-rat",ac:12,hp:7,hd:"2d6",sp:{walk:30},sc:[7,15,11,2,10,4],se:"darkvision 60 ft.",pp:10,lg:"--",cr:"1/8",xp:25,atk:[{n:"bite",k:"melee",h:4,r:5,t:"one target",d:[["1d4+2","piercing"]]}]},
  {id:"kobold",ac:12,hp:5,hd:"2d6-2",sp:{walk:30},sc:[7,15,9,8,7,8],se:"darkvision 60 ft.",pp:8,lg:"Common, Draconic",cr:"1/8",xp:25,atk:[{n:"dagger",k:"melee",h:4,r:5,t:"one target",d:[["1d4+2","piercing"]]},{n:"sling",k:"ranged",h:4,g:[30,120],t:"one target",d:[["1d4+2","bludgeoning"]]}]},
  {id:"bandit",ac:12,hp:11,hd:"2d8+2",sp:{walk:30},sc:[11,12,12,10,10,10],se:"",pp:10,lg:"any one language (usually Common)",cr:"1/8",xp:25,atk:[{n:"scimitar",k:"melee",h:3,r:5,t:"one target",d:[["1d6+1","slashing"]]},{n:"light crossbow",k:"ranged",h:3,g:[80,320],t:"one target",d:[["1d8+1","piercing"]]}]},
  {id:"cultist",ac:12,hp:9,hd:"2d8",sp:{walk:30},sc:[11,12,10,10,11,10],sk:{"Deception":2,"Religion":2},se:"",pp:10,lg:"any one language (usually Common)",cr:"1/8",xp:25,atk:[{n:"scimitar",k:"melee",h:3,r:5,t:"one creature",d:[["1d6+1","slashing"]]}]},
  {id:"stirge",ac:14,hp:2,hd:"1d4",sp:{walk:10,fly:40},sc:[4,16,11,2,8,6],se:"darkvision 60 ft.",pp:9,lg:"--",cr:"1/8",xp:25,atk:[{n:"blood drain",k:"melee",h:5,r:5,t:"one creature",d:[["1d4+3","piercing"]]}]},
  {id:"goblin",ac:15,hp:7,hd:"2d6",sp:{walk:30},sc:[8,14,10,10,8,8],sk:{"Stealth":6},se:"darkvision 60 ft.",pp:9,lg:"Common, Goblin",cr:"1/4",xp:50,atk:[{n:"scimitar",k:"melee",h:4,r:5,t:"one target",d:[["1d6+2","slashing"]]},{n:"shortbow",k:"ranged",h:4,g:[80,320],t:"one target",d:[["1d6+2","piercing"]]}]},
  {id:"skeleton",ac:13,hp:13,hd:"2d8+4",sp:{walk:30},sc:[10,14,15,6,8,5],se:"darkvision 60 ft.",pp:9,lg:"understands all languages it knew in life but can't speak",cr:"1/4",xp:50,atk:[{n:"shortsword",k:"melee",h:4,r:5,t:"one target",d:[["1d6+2","piercing"]]},{n:"shortbow",k:"ranged",h:4,g:[80,320],t:"one target",d:[["1d6+2","piercing"]]}]},
  {id:"zombie",ac:8,hp:22,hd:"3d8+9",sp:{walk:20},sc:[13,6,16,3,6,5],sv:{wis:0},se:"darkvision 60 ft.",pp:8,lg:"understands the languages it knew in life but can't speak",cr:"1/4",xp:50,atk:[{n:"slam",k:"melee",h:3,r:5,t:"one target",d:[["1d6+1","bludgeoning"]]}]},
  {id:"wolf",ac:13,hp:11,hd:"2d8+2",sp:{walk:40},sc:[12,15,12,3,12,6],sk:{"Perception":3,"Stealth":4},se:"",pp:13,lg:"--",cr:"1/4",xp:50,atk:[{n:"bite",k:"melee",h:4,r:5,t:"one target",d:[["2d4+2","piercing"]]}]},
  {id:"giant-bat",ac:13,hp:22,hd:"4d10",sp:{walk:10,fly:60},sc:[15,16,11,2,12,6],se:"blindsight 60 ft.",pp:11,lg:"--",cr:"1/4",xp:50,atk:[{n:"bite",k:"melee",h:4,r:5,t:"one creature",d:[["1d6+2","piercing"]]}]},
  {id:"orc",ac:13,hp:15,hd:"2d8+6",sp:{walk:30},sc:[16,12,16,7,11,10],sk:{"Intimidation":2},se:"darkvision 60 ft.",pp:10,lg:"Common, Orc",cr:"1/2",xp:100,atk:[{n:"greataxe",k:"melee",h:5,r:5,t:"one target",d:[["1d12+3","slashing"]]},{n:"javelin",k:"melee or ranged",h:5,r:5,g:[30,120],t:"one target",d:[["1d6+3","piercing"]]}]},
  {id:"hobgoblin",ac:18,hp:11,hd:"2d8+2",sp:{walk:30},sc:[13,12,12,10,10,9],se:"darkvision 60 ft.",pp:10,lg:"Common, Goblin",cr:"1/2",xp:100,atk:[{n:"longsword",k:"melee",h:3,r:5,t:"one target",d:[["1d8+1","slashing"]]},{n:"longbow",k:"ranged",h:3,g:[150,600],t:"one target",d:[["1d8+1","piercing"]]}]},
  {id:"gnoll",ac:15,hp:22,hd:"5d8",sp:{walk:30},sc:[14,12,11,6,10,7],se:"darkvision 60 ft.",pp:10,lg:"Gnoll",cr:"1/2",xp:100,atk:[{n:"bite",k:"melee",h:4,r:5,t:"one creature",d:[["1d4+2","piercing"]]},{n:"spear",k:"melee or ranged",h:4,r:5,g:[20,60],t:"one target",d:[["1d6+2","piercing"]]},{n:"longbow",k:"ranged",h:3,g:[150,600],t:"one target",d:[["1d8+1","piercing"]]}]},
  {id:"lizardfolk",ac:15,hp:22,hd:"4d8+4",sp:{walk:30,swim:30},sc:[15,10,13,7,12,7],sk:{"Perception":3,"Stealth":4,"Survival":5},se:"",pp:13,lg:"Draconic",cr:"1/2",xp:100,atk:[{n:"bite",k:"melee",h:4,r:5,t:"one target",d:[["1d6+2","piercing"]]},{n:"heavy club",k:"melee",h:4,r:5,t:"one target",d:[["1d6+2","bludgeoning"]]},{n:"javelin",k:"melee or ranged",h:4,r:5,g:[30,120],t:"one target",d:[["1d6+2","piercing"]]},{n:"spiked shield",k:"melee",h:4,r:5,t:"one target",d:[["1d6+2","piercing"]]}]},
  {id:"black-bear",ac:11,hp:19,hd:"3d8+6",sp:{walk:40,climb:30},sc:[15,10,14,2,12,7],sk:{"Perception":3},se:"",pp:13,lg:"--",cr:"1/2",xp:100,atk:[{n:"bite",k:"melee",h:3,r:5,t:"one target",d:[["1d6+2","piercing"]]},{n:"claws",k:"melee",h:3,r:5,t:"one target",d:[["2d4+2","slashing"]]}]},
  {id:"rust-monster",ac:14,hp:27,hd:"5d8+5",sp:{walk:40},sc:[13,12,13,2,13,6],se:"darkvision 60 ft.",pp:11,lg:"--",cr:"1/2",xp:100,atk:[{n:"bite",k:"melee",h:3,r:5,t:"one target",d:[["1d8+1","piercing"]]}]},
  {id:"dire-wolf",ac:14,hp:37,hd:"5d10+10",sp:{walk:50},sc:[17,15,15,3,12,7],sk:{"Perception":3,"Stealth":4},se:"",pp:13,lg:"--",cr:"1",xp:200,atk:[{n:"bite",k:"melee",h:5,r:5,t:"one target",d:[["2d6+3","piercing"]]}]},
  {id:"brown-bear",ac:11,hp:34,hd:"4d10+12",sp:{walk:40,climb:30},sc:[19,10,16,2,13,7],sk:{"Perception":3},se:"",pp:13,lg:"--",cr:"1",xp:200,atk:[{n:"bite",k:"melee",h:5,r:5,t:"one target",d:[["1d8+4","piercing"]]},{n:"claws",k:"melee",h:5,r:5,t:"one target",d:[["2d6+4","slashing"]]}]},
  {id:"bugbear",ac:16,hp:27,hd:"5d8+5",sp:{walk:30},sc:[15,14,13,8,11,9],sk:{"Stealth":6,"Survival":2},se:"darkvision 60 ft.",pp:10,lg:"Common, Goblin",cr:"1",xp:200,atk:[{n:"morningstar",k:"melee",h:4,r:5,t:"one target",d:[["2d8+2","piercing"]]},{n:"javelin",k:"melee or ranged",h:4,r:5,g:[30,120],t:"one target",d:[["2d6+2","piercing"]]}]},
  {id:"ghoul",ac:12,hp:22,hd:"5d8",sp:{walk:30},sc:[13,15,10,7,10,6],se:"darkvision 60 ft.",pp:10,lg:"Common",cr:"1",xp:200,atk:[{n:"bite",k:"melee",h:2,r:5,t:"one creature",d:[["2d6+2","piercing"]]},{n:"claws",k:"melee",h:4,r:5,t:"one target",d:[["2d4+2","slashing"]]}]},
  {id:"giant-spider",ac:14,hp:26,hd:"4d10+4",sp:{walk:30,climb:30},sc:[14,16,12,2,11,4],sk:{"Stealth":7},se:"blindsight 10 ft., darkvision 60 ft.",pp:10,lg:"--",cr:"1",xp:200,atk:[{n:"bite",k:"melee",h:5,r:5,t:"one creature",d:[["1d8+3","piercing"]]}]},
  {id:"harpy",ac:11,hp:38,hd:"7d8+7",sp:{walk:20,fly:40},sc:[12,13,12,7,10,13],se:"",pp:10,lg:"Common",cr:"1",xp:200,atk:[{n:"claws",k:"melee",h:3,r:5,t:"one target",d:[["2d4+1","slashing"]]},{n:"club",k:"melee",h:3,r:5,t:"one target",d:[["1d4+1","bludgeoning"]]}]},
  {id:"specter",ac:12,hp:22,hd:"5d8",sp:{walk:0,fly:50},sc:[1,14,11,10,10,11],se:"darkvision 60 ft.",pp:10,lg:"understands all languages it knew in life but can't speak",cr:"1",xp:200,atk:[{n:"life drain",k:"melee",h:4,r:5,t:"one creature",d:[["3d6","necrotic"]]}]},
  {id:"ogre",ac:11,hp:59,hd:"7d10+21",sp:{walk:40},sc:[19,8,16,5,7,7],se:"darkvision 60 ft.",pp:8,lg:"Common, Giant",cr:"2",xp:450,atk:[{n:"greatclub",k:"melee",h:6,r:5,t:"one target",d:[["2d8+4","bludgeoning"]]},{n:"javelin",k:"melee or ranged",h:6,r:5,g:[30,120],t:"one target",d:[["2d6+4","piercing"]]}]},
  {id:"gelatinous-cube",ac:6,hp:84,hd:"8d10+40",sp:{walk:15},sc:[14,3,20,1,6,1],se:"blindsight 60 ft. (blind beyond this radius)",pp:8,lg:"--",cr:"2",xp:450,atk:[{n:"pseudopod",k:"melee",h:4,r:5,t:"one creature",d:[["3d6","acid"]]}]},
  {id:"mimic",ac:12,hp:58,hd:"9d8+18",sp:{walk:15},sc:[17,12,15,5,13,8],sk:{"Stealth":5},se:"darkvision 60 ft.",pp:11,lg:"--",cr:"2",xp:450,atk:[{n:"pseudopod",k:"melee",h:5,r:5,t:"one target",d:[["1d8+3","bludgeoning"]]},{n:"bite",k:"melee",h:5,r:5,t:"one target",d:[["1d8+3","piercing"],["1d8","acid"]]}]},
  {id:"gargoyle",ac:15,hp:52,hd:"7d8+21",sp:{walk:30,fly:60},sc:[15,11,16,6,11,7],se:"darkvision 60 ft.",pp:10,lg:"Terran",cr:"2",xp:450,atk:[{n:"bite",k:"melee",h:4,r:5,t:"one target",d:[["1d6+2","piercing"]]},{n:"claws",k:"melee",h:4,r:5,t:"one target",d:[["1d6+2","slashing"]]}]},
  {id:"ettercap",ac:13,hp:44,hd:"8d8+8",sp:{walk:30,climb:30},sc:[14,15,13,7,12,8],sk:{"Perception":3,"Stealth":4,"Survival":3},se:"darkvision 60 ft.",pp:13,lg:"--",cr:"2",xp:450,atk:[{n:"bite",k:"melee",h:4,r:5,t:"one creature",d:[["1d8+2","piercing"],["1d8","poison"]]},{n:"claws",k:"melee",h:4,r:5,t:"one target",d:[["2d4+2","slashing"]]}]},
  {id:"owlbear",ac:13,hp:59,hd:"7d10+21",sp:{walk:40},sc:[20,12,17,3,12,7],sk:{"Perception":3},se:"darkvision 60 ft.",pp:13,lg:"--",cr:"3",xp:700,atk:[{n:"beak",k:"melee",h:7,r:5,t:"one creature",d:[["1d10+5","piercing"]]},{n:"claws",k:"melee",h:7,r:5,t:"one target",d:[["2d8+5","slashing"]]}]},
  {id:"wight",ac:14,hp:45,hd:"6d8+18",sp:{walk:30},sc:[15,14,16,10,13,15],sk:{"Perception":3,"Stealth":4},se:"darkvision 60 ft.",pp:13,lg:"the languages it knew in life",cr:"3",xp:700,atk:[{n:"life drain",k:"melee",h:4,r:5,t:"one creature",d:[["1d6+2","necrotic"]]},{n:"longsword",k:"melee",h:4,r:5,t:"one target",d:[["1d8+2","slashing"]]},{n:"longbow",k:"ranged",h:4,g:[150,600],t:"one target",d:[["1d8+2","piercing"]]}]},
  {id:"werewolf",ac:11,hp:58,hd:"9d8+18",sp:{walk:30},sc:[15,13,14,10,11,10],sk:{"Perception":4,"Stealth":3},se:"",pp:14,lg:"Common (can't speak in wolf form)",cr:"3",xp:700,atk:[{n:"bite (wolf or hybrid form only)",k:"melee",h:4,r:5,t:"one target",d:[["1d8+2","piercing"]]},{n:"claws (hybrid form only)",k:"melee",h:4,r:5,t:"one creature",d:[["2d4+2","slashing"]]},{n:"spear (humanoid form only)",k:"melee or ranged",h:4,r:5,g:[20,60],t:"one creature",d:[["1d6+2","piercing"]]}]},
  {id:"minotaur",ac:14,hp:76,hd:"9d10+27",sp:{walk:40},sc:[18,11,16,6,16,9],sk:{"Perception":7},se:"darkvision 60 ft.",pp:17,lg:"Abyssal",cr:"3",xp:700,atk:[{n:"greataxe",k:"melee",h:6,r:5,t:"one target",d:[["2d12+4","slashing"]]},{n:"gore",k:"melee",h:6,r:5,t:"one target",d:[["2d8+4","piercing"]]}]},
  {id:"basilisk",ac:15,hp:52,hd:"8d8+16",sp:{walk:20},sc:[16,8,15,2,8,7],se:"darkvision 60 ft.",pp:9,lg:"--",cr:"3",xp:700,atk:[{n:"bite",k:"melee",h:5,r:5,t:"one target",d:[["2d6+3","piercing"],["2d6","poison"]]}]},
  {id:"manticore",ac:14,hp:68,hd:"8d10+24",sp:{walk:30,fly:50},sc:[17,16,17,7,12,8],se:"darkvision 60 ft.",pp:11,lg:"Common",cr:"3",xp:700,atk:[{n:"bite",k:"melee",h:5,r:5,t:"one target",d:[["1d8+3","piercing"]]},{n:"claw",k:"melee",h:5,r:5,t:"one target",d:[["1d6+3","slashing"]]},{n:"tail spike",k:"ranged",h:5,g:[100,200],t:"one target",d:[["1d8+3","piercing"]]}]},
  {id:"red-dragon-wyrmling",ac:17,hp:75,hd:"10d8+30",sp:{walk:30,climb:30,fly:60},sc:[19,10,17,12,11,15],sv:{dex:2,con:5,wis:2,cha:4},sk:{"Perception":4,"Stealth":2},se:"blindsight 10 ft., darkvision 60 ft.",pp:14,lg:"Draconic",cr:"4",xp:1100,atk:[{n:"bite",k:"melee",h:6,r:5,t:"one target",d:[["1d10+4","piercing"],["1d6","fire"]]}]},
  {id:"wraith",ac:13,hp:67,hd:"9d8+27",sp:{walk:0,fly:60},sc:[6,16,16,12,14,15],se:"darkvision 60 ft.",pp:12,lg:"the languages it knew in life",cr:"5",xp:1800,atk:[{n:"life drain",k:"melee",h:6,r:5,t:"one creature",d:[["4d8+3","necrotic"]]}]},
  {id:"troll",ac:15,hp:84,hd:"8d10+40",sp:{walk:30},sc:[18,13,20,7,9,7],sk:{"Perception":2},se:"darkvision 60 ft.",pp:12,lg:"Giant",cr:"5",xp:1800,atk:[{n:"bite",k:"melee",h:7,r:5,t:"one target",d:[["1d6+4","piercing"]]},{n:"claw",k:"melee",h:7,r:5,t:"one target",d:[["2d6+4","slashing"]]}]},
  {id:"hill-giant",ac:13,hp:105,hd:"10d12+40",sp:{walk:40},sc:[21,8,19,5,9,6],sk:{"Perception":2},se:"",pp:12,lg:"Giant",cr:"5",xp:1800,atk:[{n:"greatclub",k:"melee",h:8,r:10,t:"one target",d:[["3d8+5","bludgeoning"]]},{n:"rock",k:"ranged",h:8,g:[60,240],t:"one target",d:[["3d10+5","bludgeoning"]]}]},
  {id:"young-green-dragon",ac:18,hp:136,hd:"16d10+48",sp:{walk:40,fly:80,swim:40},sc:[19,12,17,16,13,15],sv:{dex:4,con:6,wis:4,cha:5},sk:{"Deception":5,"Perception":7,"Stealth":4},se:"blindsight 30 ft., darkvision 120 ft.",pp:17,lg:"Common, Draconic",cr:"8",xp:3900,atk:[{n:"bite",k:"melee",h:7,r:10,t:"one target",d:[["2d10+4","piercing"],["2d6","poison"]]},{n:"claw",k:"melee",h:7,r:5,t:"one target",d:[["2d6+4","slashing"]]}]},
];

/** Non-attack-roll names the SRD lists as traits, per creature (hand-read from the same pages). */
const SRD_TRAITS: Record<string, string[]> = {
  "rat": ["Keen Smell"],
  "giant-rat": ["Keen Smell", "Pack Tactics"],
  "kobold": ["Sunlight Sensitivity", "Pack Tactics"],
  "bandit": [],
  "cultist": ["Dark Devotion"],
  "stirge": [],
  "goblin": ["Nimble Escape"],
  "skeleton": [],
  "zombie": ["Undead Fortitude"],
  "wolf": ["Keen Hearing and Smell", "Pack Tactics"],
  "giant-bat": ["Echolocation", "Keen Hearing"],
  "orc": ["Aggressive"],
  "hobgoblin": ["Martial Advantage"],
  "gnoll": ["Rampage"],
  "lizardfolk": ["Hold Breath"],
  "black-bear": ["Keen Smell"],
  "rust-monster": ["Iron Scent", "Rust Metal"],
  "dire-wolf": ["Keen Hearing and Smell", "Pack Tactics"],
  "brown-bear": ["Keen Smell"],
  "bugbear": ["Brute", "Surprise Attack"],
  "ghoul": [],
  "giant-spider": ["Spider Climb", "Web Sense", "Web Walker"],
  "harpy": [],
  "specter": ["Incorporeal Movement", "Sunlight Sensitivity"],
  "ogre": [],
  "gelatinous-cube": ["Ooze Cube", "Transparent"],
  "mimic": ["Shapechanger", "Adhesive", "False Appearance", "Grappler"],
  "gargoyle": ["False Appearance"],
  "ettercap": ["Spider Climb", "Web Sense", "Web Walker"],
  "owlbear": ["Keen Sight and Smell"],
  "wight": ["Sunlight Sensitivity"],
  "werewolf": ["Shapechanger", "Keen Hearing and Smell"],
  "minotaur": ["Charge", "Labyrinthine Recall", "Reckless"],
  "basilisk": ["Petrifying Gaze"],
  "manticore": ["Tail Spike Regrowth"],
  "red-dragon-wyrmling": [],
  "wraith": ["Incorporeal Movement", "Sunlight Sensitivity"],
  "troll": ["Keen Smell", "Regeneration"],
  "hill-giant": [],
  "young-green-dragon": ["Amphibious"],
};

/** Special actions that are not attack rolls (or are kept apart from `attacks`), per creature. */
const SRD_SPECIALS: Record<string, string[]> = {
  "rust-monster": ["Antennae"],
  "giant-spider": ["Web"],
  "harpy": ["Luring Song"],
  "gelatinous-cube": ["Engulf"],
  "ettercap": ["Web"],
  "wraith": ["Create Specter"],
  "red-dragon-wyrmling": ["Fire Breath"],
  "young-green-dragon": ["Poison Breath"],
};

type BpsKind = "plain" | "silvered" | "adamantine";
interface SrdDefences {
  vuln?: string[]; res?: string[]; resBps?: BpsKind; imm?: string[]; immBps?: BpsKind; cond?: string[];
}
/** Damage vulnerabilities, resistances, immunities and condition immunities, per creature. */
const SRD_DEFENCES: Record<string, SrdDefences> = {
  "skeleton": { vuln: ["bludgeoning"], imm: ["poison"], cond: ["exhaustion", "poisoned"] },
  "zombie": { imm: ["poison"], cond: ["poisoned"] },
  "ghoul": { imm: ["poison"], cond: ["charmed", "exhaustion", "poisoned"] },
  "specter": {
    res: ["acid", "cold", "fire", "lightning", "thunder"], resBps: "plain", imm: ["necrotic", "poison"],
    cond: ["charmed", "exhaustion", "grappled", "paralyzed", "petrified", "poisoned", "prone", "restrained", "unconscious"],
  },
  "gelatinous-cube": { cond: ["blinded", "charmed", "deafened", "exhaustion", "frightened", "prone"] },
  "mimic": { imm: ["acid"], cond: ["prone"] },
  "gargoyle": { resBps: "adamantine", imm: ["poison"], cond: ["exhaustion", "petrified", "poisoned"] },
  "wight": { res: ["necrotic"], resBps: "silvered", imm: ["poison"], cond: ["exhaustion", "poisoned"] },
  "werewolf": { immBps: "silvered" },
  "red-dragon-wyrmling": { imm: ["fire"] },
  "wraith": {
    res: ["acid", "cold", "fire", "lightning", "thunder"], resBps: "silvered", imm: ["necrotic", "poison"],
    cond: ["charmed", "exhaustion", "grappled", "paralyzed", "petrified", "poisoned", "prone", "restrained"],
  },
  "young-green-dragon": { imm: ["poison"], cond: ["poisoned"] },
};

const WEB_IN_SPECIALS = new Set(["giant-spider", "ettercap"]);

function srdLanguages(s: string): string {
  const t = s.toLowerCase().replace(/can't/g, "cannot").replace(/\ball /g, "").replace(/\bthe /g, "");
  return t === "--" ? "none" : t;
}

function bpsKind(entry: string): BpsKind {
  return /silvered/.test(entry) ? "silvered" : /adamantine/.test(entry) ? "adamantine" : "plain";
}

/** Fail with every mismatch at once, so one run shows the whole list of errors. */
function expectNone(problems: string[]): void {
  assert.equal(problems.length, 0, `\n${problems.join("\n")}`);
}

test("every SRD golden entry has a bestiary creature and the reverse", () => {
  assert.deepEqual(SRD.map((s) => s.id).sort(), BESTIARY.map((b) => b.id).sort());
});

test("core statblock numbers match the SRD: AC, HP, speeds, scores, saves, skills, senses, languages, CR, XP", () => {
  const problems: string[] = [];
  for (const s of SRD) {
    const b = beastById(s.id);
    assert.ok(b, s.id);
    const bad = (field: string, mine: unknown, srd: unknown) => {
      if (JSON.stringify(mine) !== JSON.stringify(srd)) problems.push(`${s.id} ${field}: data ${JSON.stringify(mine)}, SRD ${JSON.stringify(srd)}`);
    };
    bad("ac", b.ac, s.ac);
    bad("hp", b.hp, s.hp);
    bad("hpDice", b.hpDice, s.hd);
    bad("speed", { walk: b.speed.walk, fly: b.speed.fly ?? 0, swim: b.speed.swim ?? 0, climb: b.speed.climb ?? 0, burrow: b.speed.burrow ?? 0 },
      { walk: s.sp.walk, fly: s.sp.fly ?? 0, swim: s.sp.swim ?? 0, climb: s.sp.climb ?? 0, burrow: s.sp.burrow ?? 0 });
    bad("scores", ABILITIES.map((k) => b.scores[k]), s.sc);
    bad("saves", b.saves ?? {}, s.sv ?? {});
    bad("skills", b.skills ?? {}, s.sk ?? {});
    bad("senses", b.senses, s.se || "none special");
    bad("passivePerception", b.passivePerception, s.pp);
    bad("languages", srdLanguages(b.languages), srdLanguages(s.lg));
    bad("cr", b.cr, s.cr);
    bad("xp", b.xp, s.xp);
  }
  expectNone(problems);
});

test("each creature lists exactly the SRD's attack rolls, with SRD to-hit, reach, range, target, dice and damage types", () => {
  const problems: string[] = [];
  for (const s of SRD) {
    const b = beastById(s.id);
    assert.ok(b, s.id);
    const mineNames = b.attacks.map((a) => a.name.toLowerCase()).sort();
    const srdNames = s.atk.map((a) => a.n).sort();
    if (JSON.stringify(mineNames) !== JSON.stringify(srdNames)) {
      problems.push(`${s.id} attack set: data ${JSON.stringify(mineNames)}, SRD ${JSON.stringify(srdNames)}`);
    }
    for (const sa of s.atk) {
      const a = b.attacks.find((x) => x.name.toLowerCase() === sa.n);
      if (!a) continue;
      const bad = (field: string, mine: unknown, srd: unknown) => {
        if (JSON.stringify(mine) !== JSON.stringify(srd)) problems.push(`${s.id} ${sa.n} ${field}: data ${JSON.stringify(mine)}, SRD ${JSON.stringify(srd)}`);
      };
      bad("kind", a.kind, sa.k);
      bad("toHit", a.toHit, sa.h);
      bad("reachFt", a.reachFt ?? null, sa.r ?? null);
      bad("rangeFt", a.rangeFt ?? null, sa.g ?? null);
      bad("target", a.target, sa.t);
      // Extra entries beyond the SRD's attack-roll damage are allowed only when
      // the text says they are a saving throw (the giant spider's poison).
      const mineDamage = a.damage.map((d) => [d.dice.replace(/ /g, ""), d.type]);
      const savedExtra = mineDamage.length > sa.d.length && /saving throw/.test(a.extra ?? "");
      bad("damage", savedExtra ? mineDamage.slice(0, sa.d.length) : mineDamage, sa.d);
    }
  }
  expectNone(problems);
});

test("the SRD web attack of the giant spider and ettercap is kept in specials with its SRD to-hit and range", () => {
  const spider = beastById("giant-spider");
  const ettercap = beastById("ettercap");
  assert.ok(spider && ettercap);
  const web = (b: Beast) => (b.specials ?? []).find((f) => f.name.startsWith("Web"));
  assert.match(web(spider)?.text ?? "", /\+5 to hit, range 30\/60 ft\.[\s\S]*DC 12 Strength/);
  assert.match(web(ettercap)?.text ?? "", /\+4 to hit, range 30\/60 ft\.[\s\S]*DC 11 Strength/);
  assert.ok(!spider.attacks.some((a) => a.name === "Web") && !ettercap.attacks.some((a) => a.name === "Web"));
  assert.deepEqual([...WEB_IN_SPECIALS].sort(), ["ettercap", "giant-spider"]);
});

test("traits and special actions are exactly the SRD's, so nothing is invented or left out", () => {
  const problems: string[] = [];
  const clean = (name: string) => name.replace(/ \(.*\)$/, "");
  for (const b of BESTIARY) {
    const traits = b.traits.map((t) => clean(t.name)).sort();
    const want = [...(SRD_TRAITS[b.id] ?? [])].sort();
    if (JSON.stringify(traits) !== JSON.stringify(want)) problems.push(`${b.id} traits: data ${JSON.stringify(traits)}, SRD ${JSON.stringify(want)}`);
    const specials = (b.specials ?? []).map((t) => clean(t.name)).sort();
    const wantSp = [...(SRD_SPECIALS[b.id] ?? [])].sort();
    if (JSON.stringify(specials) !== JSON.stringify(wantSp)) problems.push(`${b.id} specials: data ${JSON.stringify(specials)}, SRD ${JSON.stringify(wantSp)}`);
  }
  expectNone(problems);
});

test("damage vulnerabilities, resistances, immunities and condition immunities match the SRD", () => {
  const problems: string[] = [];
  for (const b of BESTIARY) {
    const want = SRD_DEFENCES[b.id] ?? {};
    const split = (list: string[] | undefined) => {
      const all = list ?? [];
      return { plain: all.filter((e) => !/nonmagical/.test(e)).sort(), bps: all.filter((e) => /nonmagical/.test(e)).map(bpsKind) };
    };
    const res = split(b.resistances);
    const imm = split(b.immunities);
    const check = (field: string, mine: unknown, srd: unknown) => {
      if (JSON.stringify(mine) !== JSON.stringify(srd)) problems.push(`${b.id} ${field}: data ${JSON.stringify(mine)}, SRD ${JSON.stringify(srd)}`);
    };
    check("vulnerabilities", [...(b.vulnerabilities ?? [])].sort(), [...(want.vuln ?? [])].sort());
    check("resistances", res.plain, [...(want.res ?? [])].sort());
    check("resistances (nonmagical weapons)", res.bps, want.resBps ? [want.resBps] : []);
    check("immunities", imm.plain, [...(want.imm ?? [])].sort());
    check("immunities (nonmagical weapons)", imm.bps, want.immBps ? [want.immBps] : []);
    check("conditionImmunities", [...(b.conditionImmunities ?? [])].sort(), [...(want.cond ?? [])].sort());
  }
  expectNone(problems);
});

test("every 'N (dice)' figure written in a feature's text is the rounded-down average of its dice", () => {
  const problems: string[] = [];
  for (const b of BESTIARY) {
    const texts = [...b.traits, ...(b.specials ?? []), ...(b.reactions ?? [])].map((f) => f.text);
    for (const a of b.attacks) if (a.extra) texts.push(a.extra);
    if (b.multiattack) texts.push(b.multiattack);
    for (const t of texts) {
      for (const m of t.matchAll(/(\d+) \((\d+d\d+(?: [+-] \d+)?)\)/g)) {
        const dice = m[2].replace(/ /g, "");
        if (Number(m[1]) !== average(dice)) problems.push(`${b.id}: "${m[0]}" averages ${average(dice)}`);
      }
    }
  }
  expectNone(problems);
});

test("text that carries a rule number or clause keeps the SRD's (gelatinous cube, wight, harpy, hobgoblin, werewolf)", () => {
  const text = (id: string, name: string) => {
    const b = beastById(id);
    assert.ok(b, id);
    const f = [...b.traits, ...(b.specials ?? [])].find((x) => x.name === name);
    const a = b.attacks.find((x) => x.name === name);
    return f?.text ?? a?.extra ?? "";
  };
  // Engulf: the engulfing hit deals 10 (3d6) acid on entry, then 21 (6d6) each cube turn.
  assert.match(text("gelatinous-cube", "Engulf"), /10 \(3d6\) acid damage and is engulfed/);
  assert.match(text("gelatinous-cube", "Engulf"), /21 \(6d6\) acid damage at the start of each of the cube's turns/);
  // Wight: the SRD caps the zombies it can control at twelve.
  assert.match(text("wight", "Life Drain"), /no more than twelve zombies/);
  // Harpy: the SRD ends the song if she is incapacitated.
  assert.match(text("harpy", "Luring Song"), /song ends if the harpy is incapacitated/i);
  // Two-handed damage on a versatile weapon.
  assert.match(text("hobgoblin", "Longsword"), /6 \(1d10 \+ 1\) slashing damage if used with two hands/);
  assert.match(text("wight", "Longsword"), /7 \(1d10 \+ 2\) slashing damage if used with two hands/);
  // Werewolf multiattack keeps the SRD's own words and says plainly what it leaves to the DM.
  const were = beastById("werewolf");
  assert.ok(were?.multiattack);
  assert.match(were.multiattack, /Humanoid or Hybrid Form Only/i);
  assert.match(were.multiattack, /one with its bite and one with its claws or spear/);
  assert.match(were.multiattack, /DM rules/);
});

test("description and tactics never claim a mechanic the numbers do not have", () => {
  // Words that imply a rule the SRD statblock does not contain.
  const banned: [RegExp, string][] = [
    [/\bfearless\b/i, "advantage on a save is not immunity"],
    [/\bflank/i, "SRD 5.1 has no flanking rule"],
    [/\buseless\b/i, "resistance halves damage, it does not nullify it"],
    [/\bnearly immune\b/i, "resistance is not immunity"],
    [/\bbarely scratch/i, "resistance halves damage, it does not nullify it"],
  ];
  const problems: string[] = [];
  for (const b of BESTIARY) {
    for (const [re, why] of banned) {
      if (re.test(b.description) || re.test(b.tactics)) problems.push(`${b.id}: ${re} (${why})`);
    }
  }
  // Creatures that only RESIST nonmagical weapons must not read as immune to them.
  for (const b of BESTIARY) {
    if (!(b.resistances ?? []).some((r) => /nonmagical/.test(r))) continue;
    for (const re of [/\bneeds? (magic|silvered|magical)/i, /\bto hurt\b/i, /\bcan hurt\b/i, /\bcannot be hurt\b/i, /\bonly (magic|silvered|magical)/i]) {
      if (re.test(b.description) || re.test(b.tactics)) problems.push(`${b.id}: ${re} reads as immunity but it only resists`);
    }
  }
  // Specific claims found wrong against the SRD numbers.
  const specific: [string, RegExp, string][] = [
    ["giant-bat", /shriek/i, "no shriek in the SRD statblock"],
    ["giant-bat", /\blights?\b/i, "light does nothing to blindsight; only deafness does"],
    ["gelatinous-cube", /hard to hit/i, "AC 6 is easy to hit"],
    ["gelatinous-cube", /fire, cold/i, "the SRD cube has no vulnerabilities"],
    ["giant-spider", /stings/i, "the spider has no fire vulnerability, only its webbing does"],
    ["wight", /behind its ranks/i, "Life Drain is a melee attack, reach 5 ft."],
    ["harpy", /plugged ears/i, "the SRD says 'can hear', so only a deaf creature is clear"],
    ["specter", /drains their strength/i, "Life Drain reduces hit point maximum"],
    ["manticore", /\bhovers\b/i, "the manticore has no hover"],
    ["basilisk", /spider climb/i, "no Spider Climb in the SRD basilisk"],
  ];
  for (const [id, re, why] of specific) {
    const b = beastById(id);
    assert.ok(b, id);
    const all = [b.description, b.tactics, ...b.traits.map((t) => t.name + " " + t.text)].join(" ");
    if (re.test(all)) problems.push(`${id}: ${re} (${why})`);
  }
  expectNone(problems);
});
