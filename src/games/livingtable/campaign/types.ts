/**
 * The written-campaign format: what a hand-authored campaign IS, as data the
 * dungeon master runs rather than a story it recites.
 *
 *   Campaign -> Acts -> Arcs -> Scenes -> Encounters, plus State.
 *
 * The rule the whole shape follows: a campaign is written as facts,
 * objectives, situations and possible outcomes, never as a sequence of
 * events. "The mayor has secretly made a deal with the goblins" is a TRUTH;
 * the players finding out is a BEAT that can happen through several routes;
 * what they do about it is one of several OUTCOMES, each of which sets flags
 * the rest of the campaign reads. Nothing in here says what the player will
 * do, only what is true, what can happen, and how the world reacts.
 *
 * Ids are the contract between a module and every saved campaign that runs
 * it. Once a module has been played, an id never changes and is never reused
 * (the same rule as a migration number): saved story state is a list of ids,
 * and an id that moves silently drops the progress filed under it. Text can
 * change freely.
 *
 * Flags. Conditions read one flat set of flag strings, and almost every
 * entity puts its own id into that set when it happens: an outcome reached,
 * a beat done, a clue found, a truth learned, a villain clock step fired.
 * The engine adds the rest itself: `act:<actId>` when an act begins,
 * `dead:<npcId>` when someone dies, `prevented:<stepId>` when the player stops
 * a step of the villain's plan for good, and `ending:<endingId>` when the
 * campaign reaches an ending. `sets` on an entity adds extra named
 * flags on top, for the cases where several routes should open the same door
 * ("evidence_against_mayor" from the letters OR from a goblin's testimony).
 * validate.ts rejects any condition that names a flag nothing can ever set,
 * because a typo there is a gate that never opens and nobody would notice.
 */
import type { TemplateGenre } from "../characters/templates";

export type Id = string;

/**
 * Who may know a truth. KNOWN: the player can reasonably know it from the
 * start, and the DM may say it freely. DISCOVERABLE: true, and learned only
 * through play, by one of the routes listed. SECRET: true, and the DM must not
 * reveal it, hint it as narration or let it slip, until its `revealWhen` holds.
 */
export type Visibility = "known" | "discoverable" | "secret";
export const VISIBILITIES: readonly Visibility[] = ["known", "discoverable", "secret"];

/** One scale for how an NPC or a faction feels about the player, worst to best. */
export type Attitude = "hostile" | "unfriendly" | "wary" | "neutral" | "friendly" | "allied";
export const ATTITUDES: readonly Attitude[] = ["hostile", "unfriendly", "wary", "neutral", "friendly", "allied"];

/**
 * A gate the engine evaluates against story state. Every part that is present
 * must hold; an empty condition always holds. Scenes are DM turns, the same
 * count working memory already keeps, so `afterScene` is how a campaign says
 * "this much play has happened".
 */
export interface Condition {
  allOf?: Id[];
  anyOf?: Id[];
  noneOf?: Id[];
  afterScene?: number;
}

/** Something true about this world, and who may know it. */
export interface Truth {
  id: Id;
  text: string;
  visibility: Visibility;
  /** How the player can come to learn it. Required for discoverable and secret truths: a truth with no route can never come out. */
  learnedVia?: string[];
  /** The DM may only reveal it once this holds. The engine refuses a report of it being learned before then. */
  revealWhen?: Condition;
  sets?: Id[];
}

export interface Premise {
  title: string;
  tone: string;
  setting: string;
  centralConflict: string;
  /** Why the player cares, in one or two sentences. Shown on the campaign's card, so it is written to the player. */
  hook: string;
  /** What the campaign is ultimately about, as a question. */
  bigQuestion: string;
  endState: { success: string; failure: string };
}

/**
 * One step of what the villain does if nobody stops them. The clock is what
 * makes the world move while the player is busy elsewhere: the engine fires a
 * step when its `when` holds, and a step whose `preventedBy` holds first never
 * fires at all.
 */
export interface ClockStep {
  id: Id;
  when: Condition;
  event: string;
  preventedBy?: Condition;
  sets?: Id[];
}

export interface Villain {
  /** The NPC entry the DM roleplays them from. */
  npc: Id;
  goal: string;
  motivation: string;
  plan: string;
  resources: string[];
  allies: string[];
  weakness: string;
  limitations: string[];
  status: string;
  clock: ClockStep[];
}

export interface Faction {
  id: Id;
  name: string;
  goal: string;
  /** An NPC id. */
  leader?: Id;
  resources: string[];
  /** Faction ids. */
  allies: Id[];
  enemies: Id[];
  attitude: Attitude;
  wantsFromPlayer: string;
  ifIgnored: string;
}

/**
 * Enough for the DM to play someone consistently. `currentGoal` is the field
 * that matters most: a DM does not need a thousand lines of dialogue, it needs
 * to know what this person wants right now.
 */
export interface Npc {
  id: Id;
  name: string;
  role: string;
  description: string;
  personality: string;
  motivation: string;
  fears: string;
  values: string;
  /** Truth ids this person keeps. They come out of this person's mouth, under pressure, or not at all. */
  secrets: Id[];
  knowledge: string[];
  relationships: string[];
  attitude: Attitude;
  speech: string;
  currentGoal: string;
  faction?: Id;
  /** A location id: where they are usually found. The one place this is written; a location's "usually here" is read off it. */
  location?: Id;
  /** The token asset id the DM should stand them on the board with, when the roster has a fitting one. */
  token?: string;
}

/** One map cell a location occupies, with the one line the DM reads before it builds that cell. A single-cell location can leave `hint` out and its description is used. */
export interface LocationCell {
  cx: number;
  cy: number;
  hint?: string;
}

export interface Location {
  id: Id;
  name: string;
  /**
   * The cells it covers. The world is a grid of cells, one room or clearing
   * each (20 by 15 tiles); the campaign opens at (0,0) and north is cy-1. A
   * village is several cells, a cellar is one.
   */
  cells: LocationCell[];
  description: string;
  atmosphere: string;
  /** What is there, including what can be handled. Who is usually here comes from each NPC's `location`, and what can be fought or talked through here from each encounter's. */
  features: string[];
  /** Truth ids that can be learned here. */
  secrets: Id[];
  /** Location ids. */
  connected: Id[];
  threats: string[];
  discoverable: string[];
}

/** Something the player can find that points at a truth. Finding it is reported by id; it never decides anything by itself. */
export interface Clue {
  id: Id;
  text: string;
  /** Where it is or who has it. */
  source: string;
  /** Truth ids it is evidence for. */
  pointsTo: Id[];
  sets?: Id[];
}

/** One way an arc can end. Several can be reached; the arc counts as resolved once any one is. */
export interface Outcome {
  id: Id;
  text: string;
  sets?: Id[];
  /** How people feel about the player once this happens. Applied by the engine, not left for the DM to remember. */
  attitudes?: { id: Id; attitude: Attitude }[];
}

export type EncounterType = "combat" | "social" | "exploration" | "puzzle" | "travel";
export const ENCOUNTER_TYPES: readonly EncounterType[] = ["combat", "social", "exploration", "puzzle", "travel"];
export type Difficulty = "easy" | "medium" | "hard" | "deadly";
export const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard", "deadly"];

/**
 * A structured situation, of which combat is only one type. Difficulty is
 * pitched for one character between levels 1 and 3, which is the whole of
 * this build's range. Rewards are story rewards (access, help, a person's
 * trust, an ordinary item): treasure is rolled by the engine and never named
 * here.
 */
export interface Encounter {
  id: Id;
  name: string;
  type: EncounterType;
  difficulty: Difficulty;
  location: Id;
  participants: string[];
  environment: string;
  objective: string;
  special: string[];
  enemyBehavior?: string;
  npcBehavior?: string;
  triggers: string[];
  success: string;
  failure: string;
  alternatives: string[];
  rewards: string[];
}

/** A DC the scene is pitched at. A hint for the DM's roll request; the engine resolves it. */
export interface SceneCheck {
  skill: string;
  dc: number;
  reveals: string;
}

/** What is happening right now, somewhere. It describes the problem and never prescribes the player's solution. */
export interface Scene {
  id: Id;
  name: string;
  location: Id;
  situation: string;
  npcsPresent: Id[];
  whatTheyWant: string;
  playerKnows: string;
  hidden: string;
  interactions: string[];
  checks: SceneCheck[];
  /** An encounter id, when this scene can turn into a fight. */
  combat?: Id;
  escalation: string;
  outcomes: string[];
}

/** A problem that can be solved. */
export interface Arc {
  id: Id;
  name: string;
  purpose: string;
  startingState: string;
  objective: string;
  conflict: string;
  npcs: Id[];
  locations: Id[];
  clues: Clue[];
  approaches: string[];
  outcomes: Outcome[];
  rewards: string[];
  failure: string;
  worldChanges: string[];
  scenes: Scene[];
  encounters: Encounter[];
  /** When the arc becomes available within its act. Absent means as soon as the act begins. */
  opensWhen?: Condition;
}

/** Something that needs to happen eventually. The DM decides how, from what the player is actually doing. */
export interface Beat {
  id: Id;
  text: string;
  required: string;
  canHappenThrough: string[];
  notBefore?: Condition;
  result: string;
  sets?: Id[];
}

/** An act's cast and places are its arcs' `npcs` and `locations`, so they are written once, on the arcs. */
export interface Act {
  id: Id;
  title: string;
  goal: string;
  conflict: string;
  revelation: string;
  arcs: Arc[];
  beats: Beat[];
  /** The engine moves to the next act once this holds. Absent on the last act. */
  advanceWhen?: Condition;
  /** What the DM is told, as an engine note, on the turn this act begins. */
  transition: string;
}

export interface Ending {
  id: Id;
  title: string;
  when: Condition;
  /** What the DM is told to play out once this is reached. */
  text: string;
}

export interface CampaignModule {
  id: Id;
  /** Bump when the text changes in a way worth knowing about. Never a reason to change an id. */
  version: number;
  template: TemplateGenre;
  premise: Premise;
  start: { location: Id; situation: string };
  truths: Truth[];
  villain: Villain;
  factions: Faction[];
  npcs: Npc[];
  locations: Location[];
  acts: Act[];
  /** Checked in order; the first whose condition holds is the one reached. */
  endings: Ending[];
  /** Running advice for the DM: pacing, tone, what not to do. */
  dmNotes: string[];
}

// ── state ───────────────────────────────────────────────────────────────

/**
 * The world state of one running campaign: only what play has CHANGED, by id.
 * Everything else is read off the module. Quest state is derived (an arc is
 * resolved once any of its outcomes is in `outcomes`), the villain's progress
 * is `clock`, reputation is `attitudes`, and the current location comes from
 * where the character is standing. Inventory and hit points are the rules
 * engine's, on the character sheet, and never here.
 */
export interface StoryState {
  moduleId: Id;
  act: Id;
  flags: Id[];
  beats: Id[];
  outcomes: Id[];
  clues: Id[];
  learned: Id[];
  /** Overrides of the module's starting attitudes, by NPC or faction id. */
  attitudes: Record<Id, Attitude>;
  dead: Id[];
  /** Villain clock steps that have fired. */
  clock: Id[];
  /** Villain clock steps that were stopped before they could fire. */
  prevented: Id[];
  ending?: Id;
}

/** What the DM reports on a turn, by id. The engine checks every id against the module and the state before keeping any of it. */
export interface StoryUpdate {
  beats?: Id[];
  clues?: Id[];
  learned?: Id[];
  outcomes?: Id[];
  attitudes?: { id: Id; attitude: Attitude }[];
  dead?: Id[];
}
