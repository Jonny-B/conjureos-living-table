/**
 * The authoring check for a written campaign: every problem a module has, as
 * a list, so a writer fixes them all in one pass. Run over every module in
 * the library by test/livingtable-campaign.test.ts, which makes it the gate a
 * new campaign has to clear before it ships.
 *
 * The checks that earn their keep are the ones a playtest would never catch:
 * a condition naming a flag nothing can set is a door that never opens, an
 * NPC keeping a secret id that does not exist keeps nothing, and a second
 * location claiming a cell another already holds makes the DM's hint for that
 * cell depend on array order. None of those errors anywhere at run time; the
 * campaign just quietly stops working past that point.
 */
import type { CampaignModule, Condition } from "./types";
import { ATTITUDES, DIFFICULTIES, ENCOUNTER_TYPES, VISIBILITIES } from "./types";

const ID_PATTERN = /^[a-z0-9_]{1,60}$/;
const DASHES = /[\u2013\u2014]/;

export function validateCampaignModule(module: CampaignModule): string[] {
  const problems: string[] = [];
  const say = (p: string) => problems.push(p);

  // ── ids: well formed and unique across the whole module ──
  const seen = new Map<string, string>();
  const claim = (id: string, what: string) => {
    if (!ID_PATTERN.test(id)) say(`${what} id "${id}" must be lowercase letters, digits and underscores, at most 60 characters`);
    const prior = seen.get(id);
    if (prior) say(`id "${id}" is used twice: by ${prior} and by ${what}`);
    else seen.set(id, what);
  };

  claim(module.id, "the module");
  for (const t of module.truths) claim(t.id, `truth "${t.id}"`);
  for (const n of module.npcs) claim(n.id, `npc "${n.id}"`);
  for (const f of module.factions) claim(f.id, `faction "${f.id}"`);
  for (const l of module.locations) claim(l.id, `location "${l.id}"`);
  for (const s of module.villain.clock) claim(s.id, `clock step "${s.id}"`);
  for (const e of module.endings) claim(e.id, `ending "${e.id}"`);
  const encounterIds = new Set<string>();
  for (const act of module.acts) {
    claim(act.id, `act "${act.id}"`);
    for (const b of act.beats) claim(b.id, `beat "${b.id}"`);
    for (const arc of act.arcs) {
      claim(arc.id, `arc "${arc.id}"`);
      for (const c of arc.clues) claim(c.id, `clue "${c.id}"`);
      for (const o of arc.outcomes) claim(o.id, `outcome "${o.id}"`);
      for (const s of arc.scenes) claim(s.id, `scene "${s.id}"`);
      for (const e of arc.encounters) {
        claim(e.id, `encounter "${e.id}"`);
        encounterIds.add(e.id);
      }
    }
  }

  // ── references ──
  const truths = new Set(module.truths.map((t) => t.id));
  const npcs = new Set(module.npcs.map((n) => n.id));
  const factions = new Set(module.factions.map((f) => f.id));
  const locations = new Set(module.locations.map((l) => l.id));
  const ref = (ids: readonly string[] | undefined, valid: Set<string>, kind: string, where: string) => {
    for (const id of ids ?? []) if (!valid.has(id)) say(`${where} names ${kind} "${id}", which does not exist`);
  };

  if (!npcs.has(module.villain.npc)) say(`the villain names npc "${module.villain.npc}", which does not exist`);
  if (!locations.has(module.start.location)) say(`start names location "${module.start.location}", which does not exist`);
  else {
    const start = module.locations.find((l) => l.id === module.start.location)!;
    if (!start.cells.some((c) => c.cx === 0 && c.cy === 0)) say(`the start location "${start.id}" must include cell (0,0), where every campaign opens`);
  }

  for (const f of module.factions) {
    if (f.leader) ref([f.leader], npcs, "npc", `faction "${f.id}" leader`);
    ref(f.allies, factions, "faction", `faction "${f.id}" allies`);
    ref(f.enemies, factions, "faction", `faction "${f.id}" enemies`);
    if (!ATTITUDES.includes(f.attitude)) say(`faction "${f.id}" has attitude "${f.attitude}", not one of ${ATTITUDES.join(", ")}`);
  }
  for (const n of module.npcs) {
    ref(n.secrets, truths, "truth", `npc "${n.id}" secrets`);
    if (n.faction) ref([n.faction], factions, "faction", `npc "${n.id}"`);
    if (n.location) ref([n.location], locations, "location", `npc "${n.id}"`);
    if (!ATTITUDES.includes(n.attitude)) say(`npc "${n.id}" has attitude "${n.attitude}", not one of ${ATTITUDES.join(", ")}`);
  }

  const cellOwner = new Map<string, string>();
  for (const l of module.locations) {
    if (l.cells.length === 0) say(`location "${l.id}" covers no cells, so the DM can never be standing in it`);
    for (const c of l.cells) {
      if (!Number.isInteger(c.cx) || !Number.isInteger(c.cy)) say(`location "${l.id}" has a cell at non-whole coordinates (${c.cx},${c.cy})`);
      const key = `${c.cx},${c.cy}`;
      const prior = cellOwner.get(key);
      if (prior) say(`cell (${key}) is claimed by both "${prior}" and "${l.id}"`);
      else cellOwner.set(key, l.id);
    }
    ref(l.npcs, npcs, "npc", `location "${l.id}"`);
    ref(l.secrets, truths, "truth", `location "${l.id}" secrets`);
    ref(l.encounters, encounterIds, "encounter", `location "${l.id}"`);
    ref(l.connected, locations, "location", `location "${l.id}" connected`);
  }

  for (const t of module.truths) {
    if (!VISIBILITIES.includes(t.visibility)) say(`truth "${t.id}" has visibility "${t.visibility}"`);
    if (t.visibility !== "known" && !(t.learnedVia?.length)) say(`truth "${t.id}" is ${t.visibility} with no learnedVia, so there is no way for it ever to come out`);
  }

  module.acts.forEach((act, i) => {
    ref(act.locations, locations, "location", `act "${act.id}"`);
    ref(act.npcs, npcs, "npc", `act "${act.id}"`);
    const last = i === module.acts.length - 1;
    if (!last && !act.advanceWhen) say(`act "${act.id}" has no advanceWhen, so the campaign can never leave it`);
    if (last && act.advanceWhen) say(`act "${act.id}" is the last act and has an advanceWhen with nowhere to go; an ending is what closes a campaign`);
    if (act.arcs.length === 0) say(`act "${act.id}" has no arcs`);
    for (const arc of act.arcs) {
      ref(arc.npcs, npcs, "npc", `arc "${arc.id}"`);
      ref(arc.locations, locations, "location", `arc "${arc.id}"`);
      if (arc.outcomes.length === 0) say(`arc "${arc.id}" has no outcomes, so it can never be resolved`);
      for (const c of arc.clues) ref(c.pointsTo, truths, "truth", `clue "${c.id}"`);
      for (const o of arc.outcomes) {
        for (const a of o.attitudes ?? []) {
          if (!npcs.has(a.id) && !factions.has(a.id)) say(`outcome "${o.id}" shifts the attitude of "${a.id}", which is neither an npc nor a faction`);
          if (!ATTITUDES.includes(a.attitude)) say(`outcome "${o.id}" sets attitude "${a.attitude}"`);
        }
      }
      for (const s of arc.scenes) {
        ref([s.location], locations, "location", `scene "${s.id}"`);
        ref(s.npcsPresent, npcs, "npc", `scene "${s.id}"`);
        if (s.combat) ref([s.combat], encounterIds, "encounter", `scene "${s.id}" combat`);
        for (const c of s.checks) if (c.dc < 5 || c.dc > 30) say(`scene "${s.id}" has a ${c.skill} check at DC ${c.dc}; the SRD scale is 5 to 30`);
      }
      for (const e of arc.encounters) {
        ref([e.location], locations, "location", `encounter "${e.id}"`);
        if (!ENCOUNTER_TYPES.includes(e.type)) say(`encounter "${e.id}" has type "${e.type}"`);
        if (!DIFFICULTIES.includes(e.difficulty)) say(`encounter "${e.id}" has difficulty "${e.difficulty}"`);
      }
    }
  });
  if (module.endings.length === 0) say("the module has no endings, so the campaign can never close");

  // ── flags: every condition names something that can actually happen ──
  const producible = new Set<string>(seen.keys());
  for (const act of module.acts) producible.add(`act:${act.id}`);
  for (const n of module.npcs) producible.add(`dead:${n.id}`);
  for (const s of module.villain.clock) producible.add(`prevented:${s.id}`);
  for (const e of module.endings) producible.add(`ending:${e.id}`);
  const addSets = (sets: readonly string[] | undefined) => sets?.forEach((f) => producible.add(f));
  module.truths.forEach((t) => addSets(t.sets));
  module.villain.clock.forEach((s) => addSets(s.sets));
  for (const act of module.acts) {
    act.beats.forEach((b) => addSets(b.sets));
    for (const arc of act.arcs) {
      arc.clues.forEach((c) => addSets(c.sets));
      arc.outcomes.forEach((o) => addSets(o.sets));
    }
  }
  const checkCondition = (cond: Condition | undefined, where: string) => {
    if (!cond) return;
    for (const f of [...(cond.allOf ?? []), ...(cond.anyOf ?? []), ...(cond.noneOf ?? [])]) {
      if (!producible.has(f)) say(`${where} waits on flag "${f}", which nothing in this campaign can ever set`);
    }
    if (cond.afterScene !== undefined && (!Number.isInteger(cond.afterScene) || cond.afterScene < 0)) say(`${where} has afterScene ${cond.afterScene}`);
  };
  module.truths.forEach((t) => checkCondition(t.revealWhen, `truth "${t.id}" revealWhen`));
  module.villain.clock.forEach((s) => {
    checkCondition(s.when, `clock step "${s.id}" when`);
    checkCondition(s.preventedBy, `clock step "${s.id}" preventedBy`);
  });
  module.endings.forEach((e) => checkCondition(e.when, `ending "${e.id}"`));
  for (const act of module.acts) {
    checkCondition(act.advanceWhen, `act "${act.id}" advanceWhen`);
    act.beats.forEach((b) => checkCondition(b.notBefore, `beat "${b.id}" notBefore`));
    act.arcs.forEach((a) => checkCondition(a.opensWhen, `arc "${a.id}" opensWhen`));
  }

  // ── copy: this repo writes no em or en dashes, and the DM reads every word of this ──
  const walk = (v: unknown, path: string) => {
    if (typeof v === "string") {
      if (DASHES.test(v)) say(`${path} contains an em or en dash; use a comma, colon or full stop`);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(module, module.id);

  return problems;
}
