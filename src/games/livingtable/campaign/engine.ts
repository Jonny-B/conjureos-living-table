/**
 * The story-state engine for written campaigns: the part of the
 * Truth -> Situation -> Player Action -> Resolution -> State Change loop that
 * belongs to code.
 *
 * The DM decides what happens at the table and reports it by id (a beat
 * happened, a clue was found, an arc reached an outcome). This module decides
 * whether that report is allowed (does the id exist, has its gate opened, has
 * its act begun), keeps the state, and moves the world on by itself: the
 * villain's clock fires on schedule unless the player has stopped it, an act
 * ends once its condition holds, and an ending is reached once its condition
 * does. None of it is a roll, a hit point or a treasure, so none of it
 * crosses the rules engine's line; it is bookkeeping the DM would otherwise
 * have to keep in its head, and a model keeping state in its head is the
 * thing this game was built not to rely on.
 *
 * Everything here is pure. The call site owns persistence and hands the
 * returned notes to the DM's next turn as engine notes.
 */
import type { ArcOutline } from "../types";
import type {
  Act,
  Arc,
  Attitude,
  Beat,
  CampaignModule,
  ClockStep,
  Clue,
  Condition,
  Id,
  Location,
  Outcome,
  StoryState,
  StoryUpdate,
  Truth,
} from "./types";
import { ATTITUDES } from "./types";

// ── lookups ─────────────────────────────────────────────────────────────

interface Indexed<T> {
  item: T;
  /** The act it belongs to, by position, for the "has its act begun" gate. -1 for module-level entities. */
  act: number;
  arc?: Arc;
}

export interface ModuleIndex {
  truths: Map<Id, Truth>;
  npcs: Map<Id, CampaignModule["npcs"][number]>;
  factions: Map<Id, CampaignModule["factions"][number]>;
  locations: Map<Id, Location>;
  arcs: Map<Id, Indexed<Arc>>;
  beats: Map<Id, Indexed<Beat>>;
  outcomes: Map<Id, Indexed<Outcome>>;
  clues: Map<Id, Indexed<Clue>>;
  clock: Map<Id, ClockStep>;
  acts: Map<Id, number>;
}

const indexCache = new WeakMap<CampaignModule, ModuleIndex>();

export function indexModule(module: CampaignModule): ModuleIndex {
  const cached = indexCache.get(module);
  if (cached) return cached;
  const idx: ModuleIndex = {
    truths: new Map(module.truths.map((t) => [t.id, t])),
    npcs: new Map(module.npcs.map((n) => [n.id, n])),
    factions: new Map(module.factions.map((f) => [f.id, f])),
    locations: new Map(module.locations.map((l) => [l.id, l])),
    arcs: new Map(),
    beats: new Map(),
    outcomes: new Map(),
    clues: new Map(),
    clock: new Map(module.villain.clock.map((s) => [s.id, s])),
    acts: new Map(module.acts.map((a, i) => [a.id, i])),
  };
  module.acts.forEach((act, actPos) => {
    for (const beat of act.beats) idx.beats.set(beat.id, { item: beat, act: actPos });
    for (const arc of act.arcs) {
      idx.arcs.set(arc.id, { item: arc, act: actPos });
      for (const outcome of arc.outcomes) idx.outcomes.set(outcome.id, { item: outcome, act: actPos, arc });
      for (const clue of arc.clues) idx.clues.set(clue.id, { item: clue, act: actPos, arc });
    }
  });
  indexCache.set(module, idx);
  return idx;
}

export function currentAct(module: CampaignModule, state: StoryState): Act {
  const pos = indexModule(module).acts.get(state.act) ?? 0;
  return module.acts[pos]!;
}

function actPosition(module: CampaignModule, state: StoryState): number {
  return indexModule(module).acts.get(state.act) ?? 0;
}

/** The written location whose cells include this one, if the campaign wrote one there. */
export function locationAt(module: CampaignModule, cx: number, cy: number): Location | undefined {
  return module.locations.find((l) => l.cells.some((c) => c.cx === cx && c.cy === cy));
}

// ── conditions ──────────────────────────────────────────────────────────

export function conditionHolds(cond: Condition | undefined, flags: ReadonlySet<Id>, scene: number): boolean {
  if (!cond) return true;
  if (cond.allOf && !cond.allOf.every((f) => flags.has(f))) return false;
  if (cond.anyOf && cond.anyOf.length > 0 && !cond.anyOf.some((f) => flags.has(f))) return false;
  if (cond.noneOf && cond.noneOf.some((f) => flags.has(f))) return false;
  if (cond.afterScene !== undefined && scene < cond.afterScene) return false;
  return true;
}

/** A condition in words, with what already holds marked, so the DM and a rejection note read the same gate the same way. */
export function describeCondition(cond: Condition | undefined, flags: ReadonlySet<Id>, scene: number): string {
  if (!cond) return "nothing";
  const parts: string[] = [];
  const mark = (f: Id) => `${f} (${flags.has(f) ? "done" : "not yet"})`;
  if (cond.allOf?.length) parts.push(`all of: ${cond.allOf.map(mark).join(", ")}`);
  if (cond.anyOf?.length) parts.push(`any of: ${cond.anyOf.map(mark).join(", ")}`);
  if (cond.noneOf?.length) parts.push(`none of: ${cond.noneOf.map((f) => `${f} (${flags.has(f) ? "SET" : "not set"})`).join(", ")}`);
  if (cond.afterScene !== undefined) parts.push(`scene ${cond.afterScene} or later (it is scene ${scene})`);
  return parts.length ? parts.join("; ") : "nothing";
}

// ── state lifecycle ─────────────────────────────────────────────────────

function uniq(ids: Iterable<Id>): Id[] {
  return [...new Set(ids)];
}

/** Known truths are known from the first scene, so a condition naming one holds from the start. */
export function initialStoryState(module: CampaignModule): StoryState {
  const first = module.acts[0]!;
  const known = module.truths.filter((t) => t.visibility === "known");
  return {
    moduleId: module.id,
    act: first.id,
    flags: uniq([`act:${first.id}`, ...known.flatMap((t) => [t.id, ...(t.sets ?? [])])]),
    beats: [],
    outcomes: [],
    clues: [],
    learned: [],
    attitudes: {},
    dead: [],
    clock: [],
    prevented: [],
  };
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

/**
 * Defensive parse of a saved state. It is this app's own prior write, so this
 * guards against an older module (an id that no longer exists is dropped, a
 * vanished act falls back to the first) rather than an adversarial shape. A
 * state saved for a different module, or none at all, starts fresh.
 */
export function coerceStoryState(module: CampaignModule, raw: unknown): StoryState {
  const fresh = initialStoryState(module);
  if (!raw || typeof raw !== "object") return fresh;
  const rec = raw as Record<string, unknown>;
  if (rec.moduleId !== module.id) return fresh;
  const idx = indexModule(module);
  const keep = (v: unknown, valid: { has(id: Id): boolean }) => uniq(strings(v).filter((id) => valid.has(id)));

  const attitudes: Record<Id, Attitude> = {};
  if (rec.attitudes && typeof rec.attitudes === "object") {
    for (const [id, att] of Object.entries(rec.attitudes as Record<string, unknown>)) {
      if ((idx.npcs.has(id) || idx.factions.has(id)) && ATTITUDES.includes(att as Attitude)) attitudes[id] = att as Attitude;
    }
  }
  const act = typeof rec.act === "string" && idx.acts.has(rec.act) ? rec.act : fresh.act;
  const ending = typeof rec.ending === "string" && module.endings.some((e) => e.id === rec.ending) ? rec.ending : undefined;

  return {
    moduleId: module.id,
    act,
    flags: uniq([...fresh.flags, ...strings(rec.flags)]),
    beats: keep(rec.beats, idx.beats),
    outcomes: keep(rec.outcomes, idx.outcomes),
    clues: keep(rec.clues, idx.clues),
    learned: keep(rec.learned, idx.truths),
    attitudes,
    dead: keep(rec.dead, idx.npcs),
    clock: keep(rec.clock, idx.clock),
    prevented: keep(rec.prevented, idx.clock),
    ...(ending ? { ending } : {}),
  };
}

/** What someone feels about the player now: play's override if there is one, otherwise what the module started them at. */
export function attitudeOf(module: CampaignModule, state: StoryState, id: Id): Attitude | undefined {
  const idx = indexModule(module);
  return state.attitudes[id] ?? idx.npcs.get(id)?.attitude ?? idx.factions.get(id)?.attitude;
}

export function arcOpen(module: CampaignModule, state: StoryState, arcId: Id, scene: number): boolean {
  const entry = indexModule(module).arcs.get(arcId);
  if (!entry || entry.act > actPosition(module, state)) return false;
  return conditionHolds(entry.item.opensWhen, new Set(state.flags), scene);
}

export function arcResolved(state: StoryState, arc: Arc): boolean {
  return arc.outcomes.some((o) => state.outcomes.includes(o.id));
}

// ── applying a turn ─────────────────────────────────────────────────────

export interface StoryStep {
  state: StoryState;
  /**
   * Lines for the DM's next turn: what the engine did with the report, what
   * moved on its own, and anything it refused and why. Each one starts
   * "STORY" so it reads apart from the combat and loot notes beside it.
   */
  notes: string[];
}

/** A mutable working copy, so one turn's checks see the flags its own earlier entries set. */
class Draft {
  flags: Set<Id>;
  constructor(public s: StoryState) {
    this.flags = new Set(s.flags);
  }
  add(list: "beats" | "outcomes" | "clues" | "learned" | "dead" | "clock" | "prevented", id: Id, sets: readonly Id[] = []) {
    if (!this.s[list].includes(id)) this.s[list] = [...this.s[list], id];
    const own = list === "dead" ? `dead:${id}` : list === "prevented" ? `prevented:${id}` : id;
    for (const f of [own, ...sets]) this.flags.add(f);
  }
  done(): StoryState {
    return { ...this.s, flags: [...this.flags] };
  }
}

function unknownId(kind: string, id: Id): string {
  return `STORY: "${id}" is not a ${kind} id in this campaign, so nothing was recorded for it. Report only ids printed in the campaign brief.`;
}

/**
 * Apply what the DM reported this turn, then let the world move. `scene` is
 * the scene the report belongs to (the DM turn just played).
 */
export function stepStory(module: CampaignModule, state: StoryState, update: StoryUpdate | undefined, scene: number): StoryStep {
  if (state.ending) return { state, notes: [] };
  const idx = indexModule(module);
  const draft = new Draft({ ...state, attitudes: { ...state.attitudes } });
  const notes: string[] = [];
  const nowAct = () => actPosition(module, draft.s);
  const notBegun = (kind: string, id: Id, actPos: number) =>
    `STORY: ${kind} "${id}" belongs to ${module.acts[actPos]?.title ?? "a later act"}, which has not begun, so it was not recorded.`;

  // Every reported entry is either kept, refused outright (no such id, or its
  // act has not begun), or waiting on a gate. Gated entries are retried until
  // nothing more opens, so one turn's report can be listed in any order: a
  // beat that needs an outcome reported in the same turn still lands.
  type Pending = { kind: "learned" | "beats" | "outcomes"; id: Id; gate: Condition | undefined; apply: () => void; refusal: () => string };
  const gated: Pending[] = [];

  for (const id of uniq(update?.clues ?? [])) {
    const entry = idx.clues.get(id);
    if (!entry) notes.push(unknownId("clue", id));
    else if (entry.act > nowAct()) notes.push(notBegun("clue", id, entry.act));
    else draft.add("clues", id, entry.item.sets);
  }

  for (const id of uniq(update?.learned ?? [])) {
    const truth = idx.truths.get(id);
    if (!truth) notes.push(unknownId("truth", id));
    else if (truth.visibility !== "known") {
      gated.push({
        kind: "learned",
        id,
        gate: truth.revealWhen,
        apply: () => draft.add("learned", id, truth.sets),
        refusal: () =>
          `STORY: truth "${id}" cannot come out yet (it needs ${describeCondition(truth.revealWhen, draft.flags, scene)}), so the player has NOT learned it. ` +
          `Whatever was just said or found stops short of it; keep the rest of it hidden.`,
      });
    }
  }

  for (const id of uniq(update?.beats ?? [])) {
    const entry = idx.beats.get(id);
    if (!entry) notes.push(unknownId("beat", id));
    else if (entry.act > nowAct()) notes.push(notBegun("beat", id, entry.act));
    else {
      gated.push({
        kind: "beats",
        id,
        gate: entry.item.notBefore,
        apply: () => draft.add("beats", id, entry.item.sets),
        refusal: () =>
          `STORY: beat "${id}" cannot happen yet (it needs ${describeCondition(entry.item.notBefore, draft.flags, scene)}), so it was not recorded. ` +
          `Keep it in play and report it once it has really happened.`,
      });
    }
  }

  for (const id of uniq(update?.outcomes ?? [])) {
    const entry = idx.outcomes.get(id);
    if (!entry) notes.push(unknownId("outcome", id));
    else if (entry.act > nowAct()) notes.push(notBegun("outcome", id, entry.act));
    else {
      gated.push({
        kind: "outcomes",
        id,
        gate: entry.arc!.opensWhen,
        apply: () => {
          draft.add("outcomes", id, entry.item.sets);
          for (const shift of entry.item.attitudes ?? []) draft.s.attitudes[shift.id] = shift.attitude;
        },
        refusal: () => `STORY: outcome "${id}" belongs to the arc "${entry.arc!.name}", which is not open yet, so it was not recorded.`,
      });
    }
  }

  let waiting = gated;
  for (let opened = true; opened && waiting.length > 0; ) {
    opened = false;
    const still: Pending[] = [];
    for (const p of waiting) {
      if (conditionHolds(p.gate, draft.flags, scene)) {
        p.apply();
        opened = true;
      } else still.push(p);
    }
    waiting = still;
  }
  for (const p of waiting) notes.push(p.refusal());

  for (const shift of update?.attitudes ?? []) {
    if (!idx.npcs.has(shift.id) && !idx.factions.has(shift.id)) notes.push(unknownId("person or faction", shift.id));
    else draft.s.attitudes[shift.id] = shift.attitude;
  }

  for (const id of uniq(update?.dead ?? [])) {
    if (!idx.npcs.has(id)) notes.push(unknownId("person", id));
    else draft.add("dead", id);
  }

  notes.push(...settle(module, draft, scene));
  return { state: draft.done(), notes };
}

/**
 * Let the world move until nothing more changes: villain clock steps fire or
 * are stopped, acts end, an ending is reached. A loop, because one change can
 * open the next (a clock step's flag can end an act).
 */
function settle(module: CampaignModule, draft: Draft, scene: number): string[] {
  const notes: string[] = [];
  for (let guard = 0; guard < 32; guard++) {
    let moved = false;

    for (const step of module.villain.clock) {
      if (draft.s.clock.includes(step.id) || draft.s.prevented.includes(step.id)) continue;
      if (step.preventedBy && conditionHolds(step.preventedBy, draft.flags, scene)) {
        draft.add("prevented", step.id);
        notes.push(`STORY: one step of the villain's plan has been stopped for good and will never happen: ${step.event}`);
        moved = true;
      } else if (conditionHolds(step.when, draft.flags, scene)) {
        draft.add("clock", step.id, step.sets);
        notes.push(
          `STORY, OFFSCREEN: this has now happened in the world, whether or not the player saw it: ${step.event} ` +
            `Let them meet its consequences when they plausibly would, not as an announcement.`,
        );
        moved = true;
      }
    }

    const pos = indexModule(module).acts.get(draft.s.act) ?? 0;
    const act = module.acts[pos]!;
    const next = module.acts[pos + 1];
    if (next && act.advanceWhen && conditionHolds(act.advanceWhen, draft.flags, scene)) {
      draft.s.act = next.id;
      draft.flags.add(`act:${next.id}`);
      notes.push(`STORY: ${next.title} begins. ${next.transition}`);
      moved = true;
    }

    const ending = module.endings.find((e) => conditionHolds(e.when, draft.flags, scene));
    if (ending) {
      draft.s.ending = ending.id;
      draft.flags.add(`ending:${ending.id}`);
      notes.push(`STORY: the campaign has reached its ending, "${ending.title}". ${ending.text}`);
      break;
    }
    if (!moved) break;
  }
  return notes;
}

// ── what the rest of the app reads off a module ─────────────────────────

/** The campaign's geography keyed the way `getOffscreenCells` takes it, so an unbuilt neighbour reads as a place the campaign already wrote. */
export function moduleRegionHints(module: CampaignModule): Record<string, string> {
  const out: Record<string, string> = {};
  for (const loc of module.locations) {
    for (const cell of loc.cells) out[`${cell.cx},${cell.cy}`] = `${loc.name}: ${cell.hint}`;
  }
  return out;
}

/**
 * What `game_campaigns.arc_outline` stores for a written campaign: a pointer
 * to the module (the module itself ships in the app, and its ids are
 * permanent), plus the same throughline, NPC list and region sketch an
 * AI-planned campaign carries, so a campaign whose module is ever missing
 * still opens and still has a plan to steer by.
 */
export function arcOutlineFor(module: CampaignModule): ArcOutline {
  return {
    throughline: module.premise.centralConflict,
    beats: module.acts.map((a) => `${a.title}: ${a.goal}`),
    npcs: module.npcs.map((n) => ({ name: n.name, role: n.role })),
    regionSketch: module.locations.flatMap((l) => l.cells.map((c) => ({ cx: c.cx, cy: c.cy, hint: `${l.name}: ${c.hint}` }))),
    module: { id: module.id, version: module.version },
  };
}

/**
 * The story state a character should open with: their own, or, for a new
 * character rolled into a campaign after a death, the most recently saved
 * one among the campaign's other characters. Story state is campaign state
 * kept on a character (session/characterState.ts says why), so without this
 * a death would rewind the whole story to the first scene.
 */
export function inheritStory(
  characterId: string,
  characters: readonly { id: string; stats: unknown; updatedAt: string }[],
): unknown {
  const storyOf = (stats: unknown) =>
    stats && typeof stats === "object" ? (stats as Record<string, unknown>).story : undefined;
  const own = characters.find((c) => c.id === characterId);
  const ownStory = storyOf(own?.stats);
  if (ownStory && typeof ownStory === "object") return ownStory;
  const latest = characters
    .filter((c) => c.id !== characterId && storyOf(c.stats) && typeof storyOf(c.stats) === "object")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return latest ? storyOf(latest.stats) : undefined;
}
