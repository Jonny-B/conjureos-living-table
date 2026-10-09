/**
 * The campaign brief: a written campaign plus its live state, rendered into
 * the block the DM reads at the top of every turn.
 *
 * It replaces the four-line plan an AI-planned campaign carries, and it is
 * written to be RUN rather than recited. Every truth says who may know it and
 * whether its gate has opened; every person says what they want right now;
 * the villain's clock says what has already happened offscreen and what
 * happens next if nobody stops it; and only the current act is expanded,
 * because the arcs of an act that has not begun are not in play and a DM
 * shown them will start steering toward them.
 *
 * Detail follows the player. The location they are standing in is printed in
 * full along with its scenes and encounters; everything elsewhere is one line.
 * That keeps the brief to a size worth sending every turn without the DM ever
 * losing sight of what exists beyond the room.
 */
import {
  arcOpen,
  arcResolved,
  attitudeOf,
  conditionHolds,
  currentAct,
  describeCondition,
  indexModule,
  locationAt,
} from "./engine";
import type { Arc, CampaignModule, Condition, Encounter, Location, Npc, Scene, StoryState, Truth } from "./types";

export interface BriefContext {
  /** The scene this turn will be (the DM turn about to be played). */
  scene: number;
  cx: number;
  cy: number;
}

const list = (items: readonly string[]) => (items.length ? items.join("; ") : "(none)");

/** Only what a condition is still waiting on, which is all a clock step needs to say. */
function describeOutstanding(cond: Condition, flags: ReadonlySet<string>, scene: number): string {
  const parts: string[] = [];
  const missing = (cond.allOf ?? []).filter((f) => !flags.has(f));
  if (missing.length) parts.push(`${missing.join(", ")} ${missing.length === 1 ? "has" : "have"} happened`);
  if (cond.anyOf?.length && !cond.anyOf.some((f) => flags.has(f))) parts.push(`one of ${cond.anyOf.join(", ")} has happened`);
  if (cond.afterScene !== undefined && scene < cond.afterScene) parts.push(`it is scene ${cond.afterScene} (now ${scene})`);
  return parts.length ? parts.join(" and ") : "any moment now";
}

function cellsOf(loc: Location): string {
  return loc.cells.map((c) => `(${c.cx},${c.cy})`).join(" ");
}

function renderTruth(t: Truth, state: StoryState, flags: Set<string>, scene: number): string {
  const via = t.learnedVia?.length ? ` Routes: ${list(t.learnedVia)}.` : "";
  if (t.visibility === "known") return `  [${t.id}] ${t.text}`;
  if (state.learned.includes(t.id)) return `  [${t.id}] ${t.text} (THE PLAYER HAS LEARNED THIS)`;
  if (t.visibility === "discoverable") return `  [${t.id}] ${t.text}${via} (not learned yet)`;
  // A closed secret is printed so the DM stays consistent with it, but
  // without its routes: there is nothing to steer toward until it opens.
  if (!conditionHolds(t.revealWhen, flags, scene)) return `  [${t.id}] ${t.text} (gate CLOSED: it cannot come out yet, however the player pushes)`;
  return `  [${t.id}] ${t.text}${via} (gate OPEN: it may come out now, through a route)`;
}

function renderNpc(module: CampaignModule, state: StoryState, n: Npc): string {
  const dead = state.dead.includes(n.id) ? " DEAD." : "";
  return [
    `  [${n.id}] ${n.name}, ${n.role}.${dead} ${n.description}`,
    `    Personality: ${n.personality} Speaks: ${n.speech}`,
    `    Wants right now: ${n.currentGoal} Underneath: ${n.motivation} Fears: ${n.fears} Values: ${n.values}`,
    `    Toward the player: ${attitudeOf(module, state, n.id)}. Knows: ${list(n.knowledge)}.`,
    `    Keeps (out of their own mouth, in pieces, under pressure, or not at all): ${list(n.secrets)}. Relationships: ${list(n.relationships)}.` +
      (n.token ? ` Board token: ${n.token}.` : ""),
  ].join("\n");
}

/** One line: enough to keep someone consistent when they are not in front of the player. */
function renderNpcBrief(module: CampaignModule, state: StoryState, n: Npc): string {
  const dead = state.dead.includes(n.id) ? " DEAD." : "";
  return `  [${n.id}] ${n.name}, ${n.role}.${dead} Wants right now: ${n.currentGoal} Toward the player: ${attitudeOf(module, state, n.id)}. Keeps: ${list(n.secrets)}.`;
}

function renderScene(s: Scene, full: boolean, module: CampaignModule): string {
  const where = indexModule(module).locations.get(s.location)?.name ?? s.location;
  if (!full) return `    scene [${s.id}] ${s.name}, at ${where}: ${s.situation}`;
  const checks = s.checks.map((c) => `${c.skill} DC ${c.dc} reveals ${c.reveals}`);
  return [
    `    scene [${s.id}] ${s.name}, at ${where}: ${s.situation}`,
    `      Present: ${list(s.npcsPresent)}. What they want: ${s.whatTheyWant}`,
    `      The player knows: ${s.playerKnows} Hidden: ${s.hidden}`,
    `      Can be done here: ${list(s.interactions)}. Checks it is pitched at: ${list(checks)}.${s.combat ? ` Can turn into encounter ${s.combat}.` : ""}`,
    `      If it drags or goes badly: ${s.escalation} Ways it can end: ${list(s.outcomes)}.`,
  ].join("\n");
}

function renderEncounter(e: Encounter, full: boolean): string {
  const head = `    encounter [${e.id}] ${e.name} (${e.type}, ${e.difficulty}): ${e.objective}`;
  if (!full) return head;
  return [
    head,
    `      Who: ${list(e.participants)}. Ground: ${e.environment} Special: ${list(e.special)}.`,
    (e.enemyBehavior ? `      Enemies: ${e.enemyBehavior}` : "") + (e.npcBehavior ? ` Others: ${e.npcBehavior}` : ""),
    `      Starts when: ${list(e.triggers)}. Success: ${e.success} Failure: ${e.failure}`,
    `      Other ways through: ${list(e.alternatives)}. What it earns: ${list(e.rewards)}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function renderArc(module: CampaignModule, state: StoryState, arc: Arc, ctx: BriefContext, here: Location | undefined): string {
  const flags = new Set(state.flags);
  if (!arcOpen(module, state, arc.id, ctx.scene)) {
    return `  [${arc.id}] ${arc.name}: NOT OPEN YET (needs ${describeCondition(arc.opensWhen, flags, ctx.scene)}). ${arc.purpose}`;
  }
  const reached = arc.outcomes.filter((o) => state.outcomes.includes(o.id));
  if (arcResolved(state, arc)) {
    const rest = arc.outcomes.filter((o) => !state.outcomes.includes(o.id)).map((o) => `[${o.id}] ${o.text}`);
    return `  [${arc.id}] ${arc.name}: RESOLVED. Reached: ${reached.map((o) => `[${o.id}] ${o.text}`).join("; ")}. Still reachable if play goes there: ${list(rest)}.`;
  }
  const clues = arc.clues.map((c) => `[${c.id}] ${c.text} (at: ${c.source}) ${state.clues.includes(c.id) ? "FOUND" : "not found"}`);
  const outcomes = arc.outcomes.map((o) => `[${o.id}] ${o.text}`);
  const isHere = (locId: string) => here?.id === locId;
  if (!here || !arc.locations.includes(here.id)) {
    const elsewhere = [...arc.scenes.map((s) => `${s.id} (${s.name})`), ...arc.encounters.map((e) => `${e.id} (${e.name})`)];
    return [
      `  [${arc.id}] ${arc.name}: OPEN, played out elsewhere (${list(arc.locations)}). Objective: ${arc.objective}`,
      `    Clues: ${list(arc.clues.map((c) => `[${c.id}] ${state.clues.includes(c.id) ? "FOUND" : "not found"}, at ${c.source}`))}.`,
      `    Outcomes: ${list(outcomes)}. Its scenes and encounters, in full when the player is there: ${list(elsewhere)}.`,
    ].join("\n");
  }
  return [
    `  [${arc.id}] ${arc.name}: OPEN. ${arc.purpose}`,
    `    Starting state: ${arc.startingState}`,
    `    The player's objective: ${arc.objective} What stands in the way: ${arc.conflict}`,
    `    Approaches that work (or one nobody wrote, if it is sound): ${list(arc.approaches)}.`,
    `    Clues: ${list(clues)}.`,
    `    Outcomes (report the id the turn one happens): ${list(outcomes)}.`,
    `    If the player fails or walks away: ${arc.failure} What it can earn: ${list(arc.rewards)}. How the world changes: ${list(arc.worldChanges)}.`,
    ...arc.scenes.map((s) => renderScene(s, isHere(s.location), module)),
    ...arc.encounters.map((e) => renderEncounter(e, isHere(e.location))),
  ].join("\n");
}

function renderHere(module: CampaignModule, here: Location | undefined, ctx: BriefContext): string {
  if (!here) {
    return `  YOU ARE HERE: cell (${ctx.cx},${ctx.cy}), which this campaign has not written. Improvise it, consistent with everything above, and keep it modest: the written places are where the story lives.`;
  }
  const people = here.npcs.map((id) => indexModule(module).npcs.get(id)?.name ?? id);
  return [
    `  YOU ARE HERE: [${here.id}] ${here.name}, cells ${cellsOf(here)}. ${here.description}`,
    `    Atmosphere: ${here.atmosphere}`,
    `    Features: ${list(here.features)}. Things to interact with: ${list(here.interactables)}.`,
    `    Usually here: ${list(people)}. Threats: ${list(here.threats)}. To be found here: ${list(here.discoverable)}.`,
    `    Truths that can be learned here: ${list(here.secrets)}. Leads to: ${list(here.connected)}.`,
  ].join("\n");
}

export function renderCampaignBrief(module: CampaignModule, state: StoryState, ctx: BriefContext): string {
  const idx = indexModule(module);
  const flags = new Set(state.flags);
  const act = currentAct(module, state);
  const actPos = module.acts.indexOf(act);
  const here = locationAt(module, ctx.cx, ctx.cy);
  const p = module.premise;
  const v = module.villain;
  const villainNpc = idx.npcs.get(v.npc);

  // People in full: whoever is usually where the player is standing, and
  // anyone in a scene written there. This act's other people get one line
  // each, enough to stay consistent offstage; everyone else, a name.
  const focus = new Set<string>(here?.npcs ?? []);
  for (const arc of act.arcs) for (const s of arc.scenes) if (s.location === here?.id) s.npcsPresent.forEach((id) => focus.add(id));
  const focused = module.npcs.filter((n) => focus.has(n.id));
  const cast = module.npcs.filter((n) => !focus.has(n.id) && (act.npcs.includes(n.id) || n.id === v.npc));
  const others = module.npcs.filter((n) => !focus.has(n.id) && !cast.includes(n));

  const fired = v.clock.filter((s) => state.clock.includes(s.id));
  const pending = v.clock.filter((s) => !state.clock.includes(s.id) && !state.prevented.includes(s.id));
  const stopped = v.clock.filter((s) => state.prevented.includes(s.id));

  const truthsBy = (vis: Truth["visibility"]) => module.truths.filter((t) => t.visibility === vis).map((t) => renderTruth(t, state, flags, ctx.scene));

  const beats = act.beats.map((b) => {
    const status = state.beats.includes(b.id)
      ? "DONE"
      : conditionHolds(b.notBefore, flags, ctx.scene)
        ? "READY"
        : `NOT YET (needs ${describeCondition(b.notBefore, flags, ctx.scene)})`;
    return `  [${b.id}] ${b.text}: ${status}. Required: ${b.required} Can happen through: ${list(b.canHappenThrough)}. Then: ${b.result}`;
  });

  const ending = state.ending ? module.endings.find((e) => e.id === state.ending) : undefined;
  const lastAct = actPos === module.acts.length - 1;

  return [
    `HOW A WRITTEN CAMPAIGN WORKS: what follows is what is TRUE in this world, what CAN happen, and where the story is MEANT to go. You run it; you never recite it, and none of it is ever read aloud. The player may do anything, including things nothing below expects. When they do, decide what follows from the truths, from what each person wants right now, and from how each faction reacts. The truths never change because the player went another way: only what the player knows, and what the world does about it, changes. Describe problems, never prescribe solutions.`,
    ending ? `\nTHE CAMPAIGN HAS REACHED ITS ENDING: "${ending.title}". ${ending.text} Play it out. Afterwards the world goes on, and the player may keep walking around in it.` : "",
    `\nPREMISE: "${p.title}". Tone: ${p.tone}`,
    `  Setting: ${p.setting}`,
    `  Central conflict: ${p.centralConflict}`,
    `  The question underneath it all: ${p.bigQuestion}`,
    `  If the player succeeds: ${p.endState.success} If they fail: ${p.endState.failure}`,
    // The opening is only worth its words on the turn it is played.
    ...(ctx.scene === 0 ? [`  THE OPENING SCENE (this turn: build it and play it): ${module.start.situation}`] : []),
    `\nWHAT IS TRUE`,
    ` Known to the player already (say freely):`,
    ...truthsBy("known"),
    ` Discoverable (true; the player learns it only through play, by one of its routes):`,
    ...truthsBy("discoverable"),
    ` Secret (true; never state it, never hint it as narration, never let it slip over someone's head; it comes out only through a route, and only once its gate is open):`,
    ...truthsBy("secret"),
    `\nTHE VILLAIN: ${villainNpc?.name ?? v.npc}.${state.dead.includes(v.npc) ? " DEAD." : ""} Goal: ${v.goal}`,
    `  Motivation: ${v.motivation} Plan: ${v.plan}`,
    `  Resources: ${list(v.resources)}. Allies: ${list(v.allies)}. Weakness: ${v.weakness} Limits: ${list(v.limitations)}.`,
    `  Status: ${v.status}`,
    `  What the plan has already done: ${fired.length ? fired.map((s) => `[${s.id}] ${s.event}`).join(" ") : "nothing yet"}`,
    `  What happens next if nobody stops it (the engine fires these on schedule; you never do):`,
    // A step still waiting on another step is one line: it is not the next
    // thing to foreshadow, and its text will be printed in full once it is.
    ...(pending.length
      ? pending.map((s) =>
          (s.when.allOf ?? []).every((f) => flags.has(f))
            ? `    [${s.id}] ${s.event} Happens once: ${describeOutstanding(s.when, flags, ctx.scene)}.` +
              (s.preventedBy ? ` Stopped for good if, first: ${describeCondition(s.preventedBy, flags, ctx.scene)}.` : "")
            : `    [${s.id}] later, once ${describeOutstanding(s.when, flags, ctx.scene)}.`,
        )
      : ["    (nothing left)"]),
    ...(stopped.length ? [`  Stopped by the player, for good: ${stopped.map((s) => `[${s.id}] ${s.event}`).join(" ")}`] : []),
    `\nFACTIONS`,
    ...module.factions.map((f) => {
      const leader = f.leader ? idx.npcs.get(f.leader)?.name ?? f.leader : "nobody";
      return `  [${f.id}] ${f.name}, led by ${leader}. Goal: ${f.goal} Toward the player: ${attitudeOf(module, state, f.id)}. Wants from the player: ${f.wantsFromPlayer} If ignored: ${f.ifIgnored} Enemies: ${list(f.enemies)}.`;
    }),
    `\nPEOPLE (play each one as written; what they want right now is what drives them)`,
    ...focused.map((n) => renderNpc(module, state, n)),
    ...cast.map((n) => renderNpcBrief(module, state, n)),
    ...(others.length ? [`  Elsewhere for now: ${others.map((n) => `[${n.id}] ${n.name}, ${n.role}${state.dead.includes(n.id) ? " (DEAD)" : ""}`).join("; ")}`] : []),
    `\nPLACES (cell coordinates; north is cy-1)`,
    renderHere(module, here, ctx),
    ...module.locations.filter((l) => l !== here).map((l) => `  [${l.id}] ${l.name} at ${cellsOf(l)}: ${l.description}`),
    `\nACT ${actPos + 1} OF ${module.acts.length}: ${act.title}`,
    `  Goal: ${act.goal} Conflict: ${act.conflict}`,
    `  What it builds to: ${act.revelation}`,
    ` ARCS (problems the player can solve, in any order, by any means):`,
    ...act.arcs.map((arc) => renderArc(module, state, arc, ctx, here)),
    ` BEATS (these must happen eventually; you choose how and when, from what the player is actually doing, never by forcing it):`,
    ...beats,
    lastAct
      ? ` ENDINGS (the engine decides which one is reached): ${module.endings.map((e) => `[${e.id}] ${e.title}, once ${describeCondition(e.when, flags, ctx.scene)}`).join(". ")}.`
      : ` WHAT ENDS THIS ACT (the engine moves it on; you never announce it): ${describeCondition(act.advanceWhen, flags, ctx.scene)}.`,
    ...(actPos > 0 ? [` EARLIER ACTS, done: ${module.acts.slice(0, actPos).map((a) => a.title).join("; ")}.`] : []),
    ...(lastAct ? [] : [` LATER ACTS, not in play yet: ${module.acts.slice(actPos + 1).map((a) => a.title).join("; ")}.`]),
    `\nWORLD STATE: scene ${ctx.scene}. Flags set: ${list(state.flags)}.`,
    `\nRUNNING NOTES FOR THIS CAMPAIGN:`,
    ...module.dmNotes.map((n) => `- ${n}`),
  ]
    .filter((line) => line !== "")
    .join("\n");
}
