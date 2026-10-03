/**
 * The adventures the start screen offers: the owner's adventures/*.md (shipped as
 * text in adventures/data.ts, written by gen-adventures.mjs, README.md left out)
 * and the ones the AI wrote and the host kept. Each is read by the game's own
 * parseAdventureMarkdown and checked by validateAdventure against the pictures and
 * creatures the game really has (the same lists scripts/adventures/check.ts uses).
 * A file with problems is listed on the start screen with them and cannot be
 * started. The adventure is gospel: the window runs from it and progress.ts decides
 * every step.
 *
 * Moved out of the asset bench's registry as it was. Three things changed. The
 * picture ids come from the bound catalog (catalog.ts adventureAssets) rather than
 * the bench's own sprite arrays. The shipped files and the AI adventures come from
 * the host (`adventures.files()`, `storage.aiAdventures`) rather than an import and
 * localStorage. And the list is not a page-wide singleton: it belongs to whichever
 * host is bound with bindAdventures (mountTable does it, a host-less test does it
 * itself), is read once per binding, and is read again when the art changes.
 *
 * Bind the catalog (bindCatalog(host.art)) first or as well: checking an adventure
 * asks it which pictures exist.
 */
import { bodySpriteId, type ArchetypeId } from "../characters/equipmentTypes";
import { createCharacter, creationChoicesFor, type CharacterSheet, type StartingKit as CreationKit } from "../characters/creation";
import { getArchetype } from "../characters/templates";
import { BESTIARY } from "../rules/bestiary";
import { markedForReview, parseAdventureMarkdown } from "../adventures/markdown";
import { startingKitFor, type Adventure, type StartingKit as AdventureKit } from "../adventures/types";
import { validateAdventure } from "../adventures/validate";
import { adventureAssets } from "./catalog";
import type { TableHost } from "./host";
import { ARCHETYPE_LABEL } from "./state";
import type { StartAdventure } from "./ui/overlay";

/** What the adventure list needs from a host. */
export type AdventureHost = Pick<TableHost, "art" | "adventures" | "storage">;

/** One adventure the start screen offers: a file (or an AI-written adventure the host kept), read and checked. */
export interface BenchAdventure {
  /** The adventure's own id; "file:<name>" for a file too broken to have one. */
  id: string;
  /** The file under adventures/, or "ai" for one the AI wrote. */
  file: string;
  /** What the start screen calls it. */
  title: string;
  summary: string;
  author: "owner" | "ai";
  /** The whole Markdown the adventure was read from (LF endings): the debug export carries it, so a run can be reproduced. */
  source: string;
  /** The checked adventure; null when there is any problem. */
  adventure: Adventure | null;
  /** Everything wrong with it, in plain words with a line or a path. Empty when it can be started. */
  problems: string[];
  warnings: string[];
  /** How many items the file marks for review ("ADDED:" and "REVIEW:" comments): the card says "Draft: N items marked for review". */
  draftMarks: number;
}

/** How the start screen names the template file: it is the owner's copy-me example, not a story to play for real. */
export const TEMPLATE_FILE = "TEMPLATE.md";

// ---- binding to a host ---------------------------------------------------------------

let source: AdventureHost | null = null;
/** Identifies the current binding, so a stale unbind of a replaced binding does nothing. */
let binding: object | null = null;
let unsubscribe: (() => void) | null = null;
let adventureList: BenchAdventure[] | null = null;

/**
 * Bind the adventure list to a host: its shipped files, its stored AI adventures and its art (the list is read again when the art changes,
 * and is not remembered while the art is still loading, because what an adventure is checked against is the art's catalog). Replaces any
 * earlier binding. Returns an unbind function that clears the binding only if it is still the current one.
 */
export function bindAdventures(host: AdventureHost): () => void {
  unsubscribe?.();
  const mine = {};
  binding = mine;
  source = host;
  adventureList = null;
  unsubscribe = host.art.onChange(() => {
    if (binding === mine) adventureList = null;
  });
  return () => {
    if (binding === mine) unbindAdventures();
  };
}

/** Whether a host is bound. */
export function adventuresBound(): boolean {
  return source !== null;
}

/** Drop any binding and the list. */
export function unbindAdventures(): void {
  unsubscribe?.();
  unsubscribe = null;
  binding = null;
  source = null;
  adventureList = null;
}

function bound(): AdventureHost {
  if (!source) throw new Error("The table's adventures are not bound to a host. Call bindAdventures(host) first.");
  return source;
}

/** Drop the list so it is read and checked again on the next ask (the shipped files changed). */
export function refreshAdventures(): void {
  adventureList = null;
}

// ---- reading and checking ------------------------------------------------------------

/** A title for a file that did not parse: its first "# " line, else its name. */
export function looseTitle(text: string, file: string): string {
  const m = /^#\s+(.+?)\s*$/m.exec(text);
  return m?.[1] ?? file;
}

/** A summary for a file that did not parse: the words under its "## Summary" heading, comments left out. */
export function looseSummary(text: string): string {
  const at = text.search(/^##\s+Summary\s*$/m);
  if (at < 0) return "";
  const rest = text.slice(at).split("\n").slice(1);
  const lines: string[] = [];
  for (const line of rest) {
    if (/^##\s/.test(line)) break;
    lines.push(line);
  }
  return lines.join(" ").replace(/<!--[\s\S]*?-->/g, " ").replace(/\s+/g, " ").trim();
}

/** Read and check one adventure text. Never throws: whatever goes wrong is a problem on the entry. Needs the catalog bound. */
export function checkAdventureText(file: string, text: string): BenchAdventure {
  const problems: string[] = [];
  const warnings: string[] = [];
  let adventure: Adventure | null = null;
  try {
    const parsed = parseAdventureMarkdown(text, { file });
    for (const e of parsed.errors) problems.push(`Line ${e.line}: ${e.message}`);
    for (const w of parsed.warnings) warnings.push(`Line ${w.line}: ${w.message}`);
    adventure = parsed.adventure;
  } catch (e) {
    problems.push(`The file could not be read: ${e instanceof Error ? e.message : "unknown error"}`);
  }
  if (adventure) {
    try {
      const v = validateAdventure(adventure, adventureAssets(), BESTIARY.map((b) => b.id));
      for (const e of v.errors) problems.push(`${e.path}: ${e.message}`);
      for (const w of v.warnings) warnings.push(`${w.path}: ${w.message}`);
    } catch (e) {
      problems.push(`The adventure could not be checked: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }
  let draftMarks = 0;
  try {
    draftMarks = markedForReview(text).length;
  } catch {
    draftMarks = 0;
  }
  const ok = adventure !== null && problems.length === 0;
  const title = adventure?.title ?? looseTitle(text, file);
  return {
    id: adventure?.id ?? `file:${file}`,
    file,
    title: file === TEMPLATE_FILE ? `Template adventure (${title})` : title,
    summary: adventure?.summary ?? looseSummary(text),
    author: adventure?.author ?? "owner",
    source: text,
    adventure: ok ? adventure : null,
    problems,
    warnings,
    draftMarks,
  };
}

/** AI-written adventures the host kept: their Markdown texts, read again and checked on every load. Never throws. */
export function readAiAdventureTexts(): string[] {
  try {
    const list: unknown = bound().storage.aiAdventures.read();
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function writeAiAdventureTexts(texts: readonly string[]): void {
  try {
    bound().storage.aiAdventures.write([...texts]);
  } catch {
    // Storage can be blocked or full: the adventure still plays this visit.
  }
}

/** Every adventure the host knows, the owner's files first (the template last), then what the AI wrote and the host kept. Read once per binding (and again after the art changes). */
export function benchAdventures(): BenchAdventure[] {
  if (adventureList) return adventureList;
  const host = bound();
  const files = [...host.adventures.files()].sort((a, b) => Number(a.file === TEMPLATE_FILE) - Number(b.file === TEMPLATE_FILE) || a.file.localeCompare(b.file));
  const list = files.map((f) => checkAdventureText(f.file, f.text));
  for (const text of readAiAdventureTexts()) list.push(checkAdventureText("ai", text));
  // Two adventures cannot share an id (a save names one): the later one is listed, with the problem, and cannot be started.
  const seen = new Map<string, string>();
  for (const e of list) {
    if (!e.adventure) continue;
    const first = seen.get(e.id);
    if (first !== undefined) {
      e.problems.push(`The id "${e.id}" is already used by ${first}. Give this adventure its own id.`);
      e.adventure = null;
    } else {
      seen.set(e.id, e.file);
    }
  }
  // A list made while the art is still loading was checked against half a library: do not keep it.
  if (host.art.ready()) adventureList = list;
  return list;
}

/** The checked adventure with this id, or undefined (a file with problems is not one). */
export function adventureById(id: string): Adventure | undefined {
  return benchAdventures().find((e) => e.adventure?.id === id)?.adventure ?? undefined;
}

/**
 * Add an adventure the AI wrote (its Markdown) to the list and keep it with the host, so it is playable now and after a reload. Returns
 * the entry; one with problems is returned but not kept and cannot be started.
 */
export function registerAiAdventure(markdown: string): BenchAdventure {
  const entry = checkAdventureText("ai", markdown);
  const list = benchAdventures();
  if (entry.adventure && list.some((e) => e.adventure?.id === entry.id)) {
    entry.problems.push(`The id "${entry.id}" is already used by another adventure.`);
    entry.adventure = null;
  }
  list.push(entry);
  if (entry.adventure) writeAiAdventureTexts([...readAiAdventureTexts(), markdown]);
  return entry;
}

/** The start screen's cards for the list. */
export function startCardsFor(list: readonly BenchAdventure[]): StartAdventure[] {
  return list.map((e) => ({
    id: e.id,
    title: e.title,
    summary: e.summary,
    author: e.author,
    ...(e.draftMarks > 0 ? { draftMarks: e.draftMarks } : {}),
    ...(e.problems.length > 0 ? { problems: e.problems } : {}),
  }));
}

// ---- the hero an adventure starts with ----------------------------------------------

/** The starting kit as a phrase for the hero screen's "You start with ...": "a plain sword, no armor and no potions." The numbers come from the class; this says what the adventure decided. */
export function kitWords(kit: AdventureKit | undefined): string {
  if (!kit) return "the class's usual gear.";
  const parts: string[] = [];
  if (kit.weaponNote) parts.push(kit.weaponNote.replace(/[.\s]+$/, ""));
  parts.push(kit.armor === "none" ? "no armor" : "the class's armor");
  for (const item of kit.items) parts.push(item);
  parts.push(kit.potions > 0 ? `${kit.potions} healing potion${kit.potions === 1 ? "" : "s"}` : "no potions");
  return `${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0]}.`;
}

/** What createCharacter takes for an adventure's kit (the same four fields). */
export function creationKitFor(kit: AdventureKit): CreationKit {
  return { armor: kit.armor, items: [...kit.items], potions: kit.potions, ...(kit.weaponNote ? { weaponNote: kit.weaponNote } : {}) };
}

/** The adventure's kit for this archetype's class. */
export const kitForArchetype = (a: Adventure, archetypeId: string): AdventureKit | undefined => startingKitFor(a, getArchetype(archetypeId).chassis);

/**
 * What the creator starts a class's draft with under an adventure's kit: the class's own defaults, except that a choice the kit rules out
 * (a fighter's Defense with no armor to wear) starts on the first one it does allow, so Begin is not refused before the player has chosen anything.
 */
export function creatorStartFor(a: Adventure, archetypeId: string): { archetypeId: string; startingKit?: CreationKit; choices?: Record<string, string> } {
  const kit = kitForArchetype(a, archetypeId);
  if (!kit) return { archetypeId };
  const startingKit = creationKitFor(kit);
  const choices: Record<string, string> = {};
  for (const c of creationChoicesFor(archetypeId, undefined, startingKit)) if (c.options[0]) choices[c.id] = c.options[0].id;
  return { archetypeId, startingKit, ...(Object.keys(choices).length > 0 ? { choices } : {}) };
}

/** A ready-made hero of this archetype with the adventure's starting kit for its class (no armor, one plain weapon, in the first adventure). */
export function adventureHero(a: Adventure, archetypeId: ArchetypeId): CharacterSheet {
  const kit = kitForArchetype(a, archetypeId);
  return createCharacter({ archetypeId, name: ARCHETYPE_LABEL[archetypeId], appearanceAssetId: bodySpriteId(archetypeId), ...(kit ? { startingKit: creationKitFor(kit) } : {}) });
}

/** A hero from the creator, built again with the kit of the class it ended up as (the creator started from the first class's kit). Falls back to the creator's own sheet when the kit cannot be applied. */
export function adventureHeroFromCreator(a: Adventure, made: CharacterSheet, input: Parameters<typeof createCharacter>[0]): CharacterSheet {
  const kit = kitForArchetype(a, made.archetypeId);
  try {
    return createCharacter({ ...input, ...(kit ? { startingKit: creationKitFor(kit) } : { startingKit: undefined }) });
  } catch {
    return made;
  }
}
