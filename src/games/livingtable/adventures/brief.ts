/**
 * The gospel block: what the dungeon master is told about the adventure it is
 * running. It goes into the DM prompt as rules the model cannot override.
 *
 * It carries the adventure's truths, its must and never lists, the class hook
 * for this hero, the current scene and place, the secrets (marked DM ONLY),
 * the NPCs here with what they know and what they hide, and the exact list of
 * progress steps the DM may propose now. Everything is plain text built from
 * the typed model and the progress record; nothing here rolls or decides.
 */
import { beastById } from "../rules/bestiary";
import { adventureKeepsTime, allowedDmSteps, conditionMentionsDay, describeCondition, describeDmStep, evaluate } from "./progress";
import { spawnIsPresent } from "./validate";
import { dayOf, heroHook, itemOf, locationOf, sceneOf, spawnInstanceIds, worldOf, type Adventure, type AdventureProgress, type Chassis } from "./types";

export interface AdventureBriefOptions {
  /** The hero's class, to pick the hook that addresses them. */
  chassis?: Chassis;
  /** Upper bound on the text length. The brief gets less detailed to fit, dropping the least essential parts first. The truths, the must and never lists, the rules and the allowed steps are kept as long as there is room for them at all. */
  maxChars?: number;
}

/** The rule block. Always present. */
export const GOSPEL_RULES = [
  "This adventure is gospel: follow it. Improvise texture, never facts. Move the story only with the progress steps listed.",
  "Lines marked DM ONLY are for you. Never reveal them unless the party finds them out in play.",
];

function pretty(id: string): string {
  return id.replace(/[_-]+/g, " ");
}

function creatureName(creature: string): string {
  return beastById(creature)?.name.toLowerCase() ?? pretty(creature.replace(/^token_/, ""));
}

interface Section {
  /** Lower drops first when the text must shrink past the detail levels. */
  keep: number;
  render: (level: number) => string[];
}

const MAX_LEVEL = 3;

/**
 * The gospel block for the DM prompt. See the module comment. `maxChars`
 * undefined means no limit.
 */
export function adventureBrief(a: Adventure, p: AdventureProgress, opts: AdventureBriefOptions = {}): string {
  const scene = sceneOf(a, p.sceneId);
  const loc = locationOf(a, p.locationId);
  const hook = heroHook(a, opts.chassis);
  const steps = allowedDmSteps(a, p);

  const aliveCount = (spawn: { id: string; count?: number }) => spawnInstanceIds(spawn).filter((id) => !p.killed.includes(id)).length;
  const presentHere = loc ? loc.spawns.filter((s) => spawnIsPresent(a, p, s) && aliveCount(s) > 0) : [];
  const npcIdsHere = new Set<string>();
  for (const s of presentHere) if (s.npcId) npcIdsHere.add(s.npcId);
  for (const n of a.npcs) if (n.location !== undefined && n.location === p.locationId) npcIdsHere.add(n.id);
  const npcsHere = a.npcs.filter((n) => npcIdsHere.has(n.id));

  const sections: Section[] = [];

  sections.push({
    keep: 100,
    render: (level) => {
      const lines = [`ADVENTURE (${a.author === "ai" ? "AI-written" : "written by the owner"}, gospel): ${a.title}`];
      if (level <= 1 && a.summary) lines.push(a.summary);
      if (level === 0 && a.tone) lines.push(`Tone: ${a.tone}`);
      return lines;
    },
  });

  sections.push({ keep: 100, render: () => [...GOSPEL_RULES] });

  sections.push({
    keep: 95,
    render: () => (a.truths.length > 0 ? ["Truths (never contradict these):", ...a.truths.map((t) => `- ${t}`)] : []),
  });
  sections.push({ keep: 94, render: () => (a.dmMust.length > 0 ? ["You must:", ...a.dmMust.map((t) => `- ${t}`)] : []) });
  sections.push({ keep: 94, render: () => (a.dmNever.length > 0 ? ["You must never:", ...a.dmNever.map((t) => `- ${t}`)] : []) });

  sections.push({
    keep: 90,
    render: () =>
      steps.length > 0
        ? ["Progress steps you may propose now (the engine accepts only these):", ...steps.map((s) => `- ${describeDmStep(a, s)}`)]
        : [
            p.ended
              ? `The adventure has ended in ${p.ended}. Propose no progress steps.`
              : "No progress step is open right now. The story moves by what the party does; propose none.",
          ],
  });

  if (hook) sections.push({ keep: 80, render: () => [`How the story addresses this hero: ${hook}`] });

  // The world clock: what day it is, and what the world will do next if
  // nobody stops it. The engine fires these beats; the DM's job is to let
  // the party feel them coming (a rumour, a cold wind off the ridge), never
  // to announce or fire one.
  const world = worldOf(a);
  const usesDays = adventureKeepsTime(a);
  if (usesDays || world.beats.length > 0 || world.next.length > 0) {
    sections.push({
      keep: 86,
      render: (level) => {
        const lines = usesDays ? [`It is day ${dayOf(p)} of the adventure. A day passes each time the hero sleeps.`] : [];
        const coming = world.beats.filter((b) => !p.beatsFired.includes(b.id) && (level <= 1 || conditionMentionsDay(b.when)));
        if (coming.length > 0) {
          lines.push("DM ONLY, what the world does next unless the party stops it (the engine makes these happen; foreshadow them, never announce them):");
          for (const b of coming) {
            const what = b.narrate ?? (b.setFlags?.length ? `the story marks ${b.setFlags.join(", ")}` : b.id);
            lines.push(`- once ${describeCondition(a, b.when)}: ${level <= 1 ? what : b.id}`);
          }
        }
        return lines;
      },
    });
  }

  if (scene) {
    sections.push({
      keep: 85,
      render: (level) => {
        const lines = [`Current scene: ${scene.title}`];
        for (const o of scene.objectives) {
          const done = p.objectivesDone.includes(o.id);
          if (done && level >= MAX_LEVEL) continue;
          lines.push(`- [${done ? "done" : "open"}] ${o.text}${o.hidden ? " (hidden from the player)" : ""}`);
        }
        return lines;
      },
    });
  }

  if (loc) {
    sections.push({
      keep: 70,
      render: (level) => {
        const lines = [`Where the party is: ${loc.name}`];
        if (level === 0 && loc.readAloud) lines.push(`Read-aloud on arrival: ${loc.readAloud}`);
        if (level <= 1 && loc.dmNotes) lines.push(`DM ONLY notes: ${loc.dmNotes}`);
        return lines;
      },
    });

    sections.push({
      keep: 60,
      render: (level) => {
        if (loc.exits.length === 0) return [];
        const lines = ["Ways out of here:"];
        for (const e of loc.exits) {
          const open = !e.requires || evaluate(a, p, e.requires);
          const to = locationOf(a, e.to)?.name ?? e.to;
          const state = open ? "open" : level <= 1 && e.lockedText ? `shut: ${e.lockedText}` : "shut";
          lines.push(`- ${e.label} (to ${to}, ${state})`);
        }
        return lines;
      },
    });

    sections.push({
      keep: 75,
      render: (level) => {
        const feats = loc.features.filter((f) => level <= 1 || f.secret !== undefined || (f.gives?.length ?? 0) > 0);
        if (feats.length === 0) return [];
        const lines = ["Things here:"];
        for (const f of feats) {
          let line = `- ${f.name}`;
          if (level <= 1 && f.description) line += `: ${f.description}`;
          if (f.secret) line += ` DM ONLY secret${f.searchDc !== undefined ? ` (found on a search, DC ${f.searchDc})` : ""}: ${f.secret}`;
          if (level <= 2 && f.gives && f.gives.length > 0) line += ` Gives: ${f.gives.map((g) => itemOf(a, g)?.name ?? g).join(", ")}.`;
          lines.push(line);
        }
        return lines;
      },
    });

    sections.push({
      keep: 50,
      render: (level) => {
        if (level >= MAX_LEVEL || presentHere.length === 0) return [];
        const lines = ["Creatures here:"];
        for (const s of presentHere) {
          const n = aliveCount(s);
          lines.push(`- ${n} ${creatureName(s.creature)}${n === 1 ? "" : "s"} (${s.hostile ? "hostile" : "not hostile"}, ${s.awake ? "awake" : "unaware"})`);
        }
        return lines;
      },
    });
  }

  if (npcsHere.length > 0) {
    sections.push({
      keep: 88,
      render: (level) => {
        const lines = ["People here:"];
        for (const n of npcsHere) {
          if (level >= MAX_LEVEL) {
            lines.push(`- ${n.name} (${n.role})`);
            for (const s of n.secrets ?? []) lines.push(`  DM ONLY secret: ${s}`);
            continue;
          }
          lines.push(`- ${n.name}, ${n.role}.${level <= 2 ? ` Personality: ${n.personality}.` : ""}`);
          if (level === 0 && n.wants) lines.push(`  Wants: ${n.wants}`);
          if (level === 0 && n.voice) lines.push(`  Voice: ${n.voice}`);
          if (n.knows.length > 0) lines.push(`  Will tell the party: ${n.knows.join(" / ")}`);
          for (const s of n.secrets ?? []) lines.push(`  DM ONLY secret (will not volunteer): ${s}`);
        }
        return lines;
      },
    });
  }

  sections.push({
    keep: 40,
    render: (level) => {
      if (level >= 2) return [];
      const bits: string[] = [];
      const places = p.entered.map((id) => locationOf(a, id)?.name ?? id);
      if (places.length > 0) bits.push(`been to ${places.join(", ")}`);
      if (p.killed.length > 0) bits.push(`killed ${p.killed.length} creature${p.killed.length === 1 ? "" : "s"}`);
      const talked = p.talkedTo.map((id) => a.npcs.find((n) => n.id === id)?.name ?? id);
      if (talked.length > 0) bits.push(`spoken with ${talked.join(", ")}`);
      const held = p.has.map((id) => itemOf(a, id)?.name ?? id);
      if (held.length > 0) bits.push(`holds ${held.join(", ")}`);
      const flags = Object.keys(p.flags);
      if (flags.length > 0) bits.push(`declared ${flags.join(", ")}`);
      return bits.length > 0 ? [`So far the party has ${bits.join("; ")}.`] : [];
    },
  });

  const build = (level: number, dropBelow: number): string => {
    const blocks: string[] = [];
    for (const s of sections) {
      if (s.keep < dropBelow) continue;
      const lines = s.render(level);
      if (lines.length > 0) blocks.push(lines.join("\n"));
    }
    return blocks.join("\n\n");
  };

  const max = opts.maxChars;
  if (max === undefined) return build(0, 0);

  for (let level = 0; level <= MAX_LEVEL; level++) {
    const text = build(level, 0);
    if (text.length <= max) return text;
  }
  // Even the barest level is too long: drop whole sections, least essential first.
  const keeps = [...new Set(sections.map((s) => s.keep))].sort((x, y) => x - y);
  for (const k of keeps) {
    const text = build(MAX_LEVEL, k + 1);
    if (text.length <= max) return text;
  }
  // Last resort: only the essentials fit nothing; cut hard so the caller's limit holds.
  return build(MAX_LEVEL, 100).slice(0, Math.max(0, max));
}
