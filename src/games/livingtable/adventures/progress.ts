/**
 * Where a game stands in an adventure, and how it moves.
 *
 * The progress record is plain JSON. `applyEvent` is the ONLY thing that
 * changes it: the game reports what happened (the party entered a place, a
 * creature died, someone was spoken to) and the engine re-evaluates the
 * adventure's objectives, beats and scene transitions until nothing more
 * changes. The dungeon master never edits progress; it can only PROPOSE a
 * `DmProgressStep`, and the engine accepts one only when the adventure allows
 * it right now (see `allowedDmSteps`). That is what makes the adventure gospel
 * rather than a suggestion: no proposal can skip a kill, walk past a locked
 * door or jump to a scene the story does not link to.
 */
import {
  allSpawns,
  itemOf,
  locationOf,
  sceneOf,
  spawnInstanceIds,
  type Adventure,
  type AdventureBeat,
  type AdventureEvent,
  type AdventureObjective,
  type AdventureProgress,
  type AdventureScene,
  type Condition,
  type DmProgressStep,
} from "./types";

/** What one event did. */
export interface AdventureStepResult {
  progress: AdventureProgress;
  /** Beats that fired during this event. */
  fired: AdventureBeat[];
  /** Objectives that became done during this event. */
  completed: AdventureObjective[];
  /** Set when the story moved to another scene. `from` is where it started, `to` where it settled, `opening` the new scene's read-aloud. */
  sceneChanged?: { from: string; to: string; opening?: string };
  /** Set when a DM proposal (or an event naming something the adventure does not have) was turned down, in plain words. */
  refused?: string;
  /** Set when the story reached a scene that has an ending. */
  ended?: AdventureScene["ending"];
}

/** The most passes the settle loop makes before giving up. A real adventure settles in a handful; this only stops a story that loops on itself. */
const SETTLE_LIMIT = 200;

/** A fresh record for a new game of this adventure. The hero starts in the start location, which counts as entered. */
export function startProgress(a: Adventure): AdventureProgress {
  return {
    adventureId: a.id,
    version: a.version,
    sceneId: a.start.sceneId,
    locationId: a.start.locationId,
    flags: {},
    objectivesDone: [],
    beatsFired: [],
    killed: [],
    entered: [a.start.locationId],
    talkedTo: [],
    has: [],
    spawned: [],
  };
}

function cloneProgress(p: AdventureProgress): AdventureProgress {
  return {
    ...p,
    flags: { ...p.flags },
    objectivesDone: [...p.objectivesDone],
    beatsFired: [...p.beatsFired],
    killed: [...p.killed],
    entered: [...p.entered],
    talkedTo: [...p.talkedTo],
    has: [...p.has],
    spawned: [...(p.spawned ?? [])],
  };
}

function pushOnce(list: string[], v: string): boolean {
  if (list.includes(v)) return false;
  list.push(v);
  return true;
}

// ---------------------------------------------------------------------------
// Conditions

/** Whether this condition holds for this progress. Reads state, never changes it. A malformed condition is simply false. */
export function evaluate(a: Adventure, p: AdventureProgress, c: Condition): boolean {
  if (!c || typeof c !== "object") return false;
  if ("always" in c) return c.always === true;
  if ("flag" in c) return p.flags[c.flag] === true;
  if ("all" in c) return Array.isArray(c.all) && c.all.every((x) => evaluate(a, p, x));
  if ("any" in c) return Array.isArray(c.any) && c.any.some((x) => evaluate(a, p, x));
  if ("not" in c) return !evaluate(a, p, c.not);
  if ("killed" in c) return killedHolds(a, p, c.killed);
  if ("entered" in c) return p.entered.includes(c.entered);
  if ("talkedTo" in c) return p.talkedTo.includes(c.talkedTo);
  if ("has" in c) return p.has.includes(c.has);
  if ("objective" in c) return p.objectivesDone.includes(c.objective);
  return false;
}

function killedHolds(a: Adventure, p: AdventureProgress, ref: string): boolean {
  if (ref.startsWith("all:")) {
    const prefix = ref.slice(4);
    const ids = allSpawns(a)
      .filter((s) => s.spawn.id.startsWith(prefix))
      .flatMap((s) => spawnInstanceIds(s.spawn));
    return ids.length > 0 && ids.every((id) => p.killed.includes(id));
  }
  const spawn = allSpawns(a).find((s) => s.spawn.id === ref);
  if (spawn) return spawnInstanceIds(spawn.spawn).every((id) => p.killed.includes(id));
  return p.killed.includes(ref);
}

/** Every flag a condition names, any depth. */
export function conditionFlags(c: Condition | undefined, out: string[] = []): string[] {
  if (!c || typeof c !== "object") return out;
  if ("flag" in c) out.push(c.flag);
  else if ("all" in c && Array.isArray(c.all)) for (const x of c.all) conditionFlags(x, out);
  else if ("any" in c && Array.isArray(c.any)) for (const x of c.any) conditionFlags(x, out);
  else if ("not" in c) conditionFlags(c.not, out);
  return out;
}

function pretty(id: string): string {
  return id.replace(/[_-]+/g, " ");
}

/** A condition in plain words, for refusals and for the DM brief. */
export function describeCondition(a: Adventure, c: Condition): string {
  if (!c || typeof c !== "object") return "something the adventure does not define";
  if ("always" in c) return "always";
  if ("flag" in c) return `the story declares "${c.flag}"`;
  if ("all" in c) return c.all.length === 0 ? "always" : c.all.map((x) => describeCondition(a, x)).join(" and ");
  if ("any" in c) return c.any.length === 0 ? "never" : `(${c.any.map((x) => describeCondition(a, x)).join(" or ")})`;
  if ("not" in c) return `not (${describeCondition(a, c.not)})`;
  if ("killed" in c) {
    if (c.killed.startsWith("all:")) return `every ${pretty(c.killed.slice(4))} creature is dead`;
    return `${pretty(c.killed)} is dead`;
  }
  if ("entered" in c) return `the party has been to ${locationOf(a, c.entered)?.name ?? c.entered}`;
  if ("talkedTo" in c) return `the party has spoken with ${a.npcs.find((n) => n.id === c.talkedTo)?.name ?? c.talkedTo}`;
  if ("has" in c) return `the party holds ${itemOf(a, c.has)?.name ?? c.has}`;
  if ("objective" in c) {
    for (const s of a.scenes) {
      const o = s.objectives.find((x) => x.id === c.objective);
      if (o) return `the objective "${o.text}" is done`;
    }
    return `the objective "${c.objective}" is done`;
  }
  return "something the adventure does not define";
}

// ---------------------------------------------------------------------------
// What the DM may propose

/** Flags set by some beat. Those are the adventure's own machinery, so the DM may not declare them. */
function beatFlags(a: Adventure): Set<string> {
  const out = new Set<string>();
  for (const s of a.scenes) for (const b of s.beats) for (const f of b.setFlags ?? []) out.add(f);
  return out;
}

/**
 * The flags the DM may declare right now: flags named in a condition of the
 * current scene (open objectives, unfired beats, the ways out) or of the
 * current location (exits, spawns), that no beat sets for itself and that are
 * not already set. These are the story's judgment calls ("the innkeeper has
 * been persuaded"), the only facts the DM is trusted to decide.
 */
export function dmSettableFlags(a: Adventure, p: AdventureProgress): string[] {
  if (p.ended) return [];
  const scene = sceneOf(a, p.sceneId);
  const loc = locationOf(a, p.locationId);
  const seen: string[] = [];
  if (scene) {
    for (const o of scene.objectives) if (!p.objectivesDone.includes(o.id)) conditionFlags(o.doneWhen, seen);
    for (const b of scene.beats) if (b.once === false || !p.beatsFired.includes(b.id)) conditionFlags(b.when, seen);
    for (const n of scene.next) conditionFlags(n.when, seen);
  }
  if (loc) {
    for (const e of loc.exits) conditionFlags(e.requires, seen);
    for (const s of loc.spawns) conditionFlags(s.appearsWhen, seen);
  }
  const own = beatFlags(a);
  const out: string[] = [];
  for (const f of seen) if (!own.has(f) && p.flags[f] !== true && !out.includes(f)) out.push(f);
  return out;
}

/** A bare `{ flag }` condition's flag, or undefined for anything else. */
function soleFlag(c: Condition): string | undefined {
  return c && typeof c === "object" && "flag" in c ? c.flag : undefined;
}

/**
 * Everything the DM may propose right now, and nothing else:
 *  - an objective of the current scene that finishes on a flag the DM may declare,
 *  - a scene the current scene links to whose way in is such a flag,
 *  - any other flag the DM may declare (see `dmSettableFlags`).
 * Objectives and scenes that finish by kills, entering places, holding items
 * or talking to someone never appear: the engine sees those happen itself.
 */
export function allowedDmSteps(a: Adventure, p: AdventureProgress): DmProgressStep[] {
  if (p.ended) return [];
  const scene = sceneOf(a, p.sceneId);
  const settable = new Set(dmSettableFlags(a, p));
  const steps: DmProgressStep[] = [];
  const covered = new Set<string>();
  if (scene) {
    for (const o of scene.objectives) {
      if (p.objectivesDone.includes(o.id)) continue;
      const f = soleFlag(o.doneWhen);
      if (f && settable.has(f)) {
        steps.push({ kind: "objective", id: o.id });
        covered.add(f);
      }
    }
    for (const n of scene.next) {
      const f = soleFlag(n.when);
      if (f && settable.has(f) && !steps.some((s) => s.kind === "scene" && s.id === n.scene)) {
        steps.push({ kind: "scene", id: n.scene });
        covered.add(f);
      }
    }
  }
  for (const f of settable) if (!covered.has(f)) steps.push({ kind: "flag", flag: f });
  return steps;
}

/** One proposal in plain words, for the brief. */
export function describeDmStep(a: Adventure, step: DmProgressStep): string {
  if (step.kind === "flag") return `declare "${step.flag}" (the story's own flag, set only when it has truly happened in play)`;
  if (step.kind === "objective") {
    for (const s of a.scenes) {
      const o = s.objectives.find((x) => x.id === step.id);
      if (o) return `finish objective "${o.id}": ${o.text}`;
    }
    return `finish objective "${step.id}"`;
  }
  const sc = sceneOf(a, step.id);
  return `move on to scene "${step.id}"${sc ? `: ${sc.title}` : ""}`;
}

// ---------------------------------------------------------------------------
// Events

/** Which creature id a kill event means: an exact creature id, or the next living one of a group named by its spawn id. */
function resolveKill(a: Adventure, p: AdventureProgress, ref: string): string | undefined {
  const spawns = allSpawns(a);
  for (const s of spawns) if (spawnInstanceIds(s.spawn).includes(ref)) return ref;
  const group = spawns.find((s) => s.spawn.id === ref);
  if (!group) return undefined;
  const ids = spawnInstanceIds(group.spawn);
  return ids.find((id) => !p.killed.includes(id)) ?? ids[ids.length - 1];
}

function applyBeat(a: Adventure, p: AdventureProgress, b: AdventureBeat): void {
  for (const f of b.setFlags ?? []) p.flags[f] = true;
  for (const g of b.give ?? []) {
    const item = itemOf(a, g);
    if (item) pushOnce(p.has, item.id);
  }
  for (const s of b.spawn ?? []) pushOnce(p.spawned, s);
}

/**
 * Re-evaluate the adventure against this progress until nothing more changes:
 * objectives that are now done, beats that now fire, scene transitions that
 * now hold. Runs after every event; also callable on its own (for the very
 * first scene, whose objectives and beats can already hold at the start).
 */
export function settleProgress(a: Adventure, start: AdventureProgress): AdventureStepResult {
  const p = cloneProgress(start);
  const fired: AdventureBeat[] = [];
  const completed: AdventureObjective[] = [];
  const firedNow = new Set<string>();
  let sceneChanged: AdventureStepResult["sceneChanged"];
  let ended: AdventureScene["ending"];

  for (let pass = 0; pass < SETTLE_LIMIT; pass++) {
    if (p.ended) break;
    const scene = sceneOf(a, p.sceneId);
    if (!scene) break;
    let changed = false;

    for (const o of scene.objectives) {
      if (p.objectivesDone.includes(o.id)) continue;
      if (evaluate(a, p, o.doneWhen)) {
        p.objectivesDone.push(o.id);
        completed.push(o);
        changed = true;
      }
    }

    for (const b of scene.beats) {
      const once = b.once !== false;
      if (once ? p.beatsFired.includes(b.id) : firedNow.has(b.id)) continue;
      if (!evaluate(a, p, b.when)) continue;
      if (once) p.beatsFired.push(b.id);
      firedNow.add(b.id);
      applyBeat(a, p, b);
      fired.push(b);
      changed = true;
    }

    for (const n of scene.next) {
      if (!evaluate(a, p, n.when)) continue;
      const target = sceneOf(a, n.scene);
      if (!target) continue;
      const from = sceneChanged ? sceneChanged.from : scene.id;
      p.sceneId = target.id;
      sceneChanged = { from, to: target.id, opening: target.opening };
      if (target.ending) {
        ended = target.ending;
        if (target.ending.outcome === "victory" || target.ending.outcome === "defeat") p.ended = target.ending.outcome;
      }
      changed = true;
      break;
    }

    if (!changed) break;
  }

  const result: AdventureStepResult = { progress: p, fired, completed };
  if (sceneChanged && sceneChanged.from !== sceneChanged.to) result.sceneChanged = sceneChanged;
  if (ended) result.ended = ended;
  return result;
}

function unchanged(p: AdventureProgress, refused: string): AdventureStepResult {
  return { progress: p, fired: [], completed: [], refused };
}

/** Turn one DM proposal into a flag to set, or a refusal in plain words. */
function judgeDmStep(a: Adventure, p: AdventureProgress, step: DmProgressStep): { setFlag?: string; refused?: string } {
  const settable = new Set(dmSettableFlags(a, p));
  const scene = sceneOf(a, p.sceneId);

  if (step.kind === "flag") {
    if (p.flags[step.flag] === true) return {};
    if (settable.has(step.flag)) return { setFlag: step.flag };
    return { refused: `The adventure does not let the story declare "${step.flag}" right now.` };
  }

  if (step.kind === "objective") {
    const o = scene?.objectives.find((x) => x.id === step.id);
    if (!o) return { refused: `"${step.id}" is not an objective of the current scene${scene ? ` (${scene.title})` : ""}.` };
    if (p.objectivesDone.includes(o.id)) return {};
    if (evaluate(a, p, o.doneWhen)) return {};
    const f = soleFlag(o.doneWhen);
    if (f && settable.has(f)) return { setFlag: f };
    return { refused: `"${o.text}" is finished by the story itself, when ${describeCondition(a, o.doneWhen)}. It cannot be declared done.` };
  }

  const links = scene?.next.filter((n) => n.scene === step.id) ?? [];
  if (links.length === 0) {
    const options = (scene?.next ?? []).map((n) => `"${n.scene}"`).join(", ");
    return { refused: `The story cannot go to "${step.id}" from here${options ? `; this scene leads only to ${options}` : "; this scene leads nowhere else"}.` };
  }
  if (links.some((n) => evaluate(a, p, n.when))) return {};
  for (const n of links) {
    const f = soleFlag(n.when);
    if (f && settable.has(f)) return { setFlag: f };
  }
  return { refused: `The story reaches "${step.id}" only when ${describeCondition(a, links[0]!.when)}. It cannot be declared.` };
}

/**
 * Apply one event and settle. Never mutates the progress it is given. A
 * refusal returns the progress unchanged with `refused` in plain words.
 */
export function applyEvent(a: Adventure, progress: AdventureProgress, e: AdventureEvent): AdventureStepResult {
  if (progress.ended) return unchanged(progress, "The adventure is over.");
  const p = cloneProgress(progress);

  switch (e.type) {
    case "enter": {
      if (!locationOf(a, e.location)) return unchanged(progress, `There is no place called "${e.location}" in this adventure.`);
      p.locationId = e.location;
      pushOnce(p.entered, e.location);
      break;
    }
    case "kill": {
      const id = resolveKill(a, p, e.spawn);
      if (!id) return unchanged(progress, `There is no creature called "${e.spawn}" in this adventure.`);
      pushOnce(p.killed, id);
      break;
    }
    case "talk": {
      if (!a.npcs.some((n) => n.id === e.npc)) return unchanged(progress, `There is no one called "${e.npc}" in this adventure.`);
      pushOnce(p.talkedTo, e.npc);
      break;
    }
    case "gain": {
      // An item the adventure does not know (a coin, a stick) is ordinary loot, not story state: nothing to record.
      const item = itemOf(a, e.item);
      if (item) pushOnce(p.has, item.id);
      break;
    }
    case "lose": {
      const item = itemOf(a, e.item);
      if (item) p.has = p.has.filter((i) => i !== item.id);
      break;
    }
    case "flag": {
      p.flags[e.flag] = true;
      break;
    }
    case "dm": {
      const verdict = judgeDmStep(a, p, e.step);
      if (verdict.refused) return unchanged(progress, verdict.refused);
      if (verdict.setFlag) p.flags[verdict.setFlag] = true;
      break;
    }
  }

  return settleProgress(a, p);
}
