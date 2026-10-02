/**
 * The two books on the bench's table: the RULES tab (the rulebook, rules/rulebook.ts)
 * and the BESTIARY tab (the creature book, rules/bestiary.ts). Both are full width
 * reading tabs, built from the src data modules, so what they say is what the engine
 * and the DM are told.
 *
 * The pure helpers (formatModifier, filterBeasts, formatAttack, splitHighlight,
 * filterRuleSections and friends) touch no DOM and are unit tested in Node
 * (test/livingtable-bench-books.test.ts); the two mount functions build the DOM and
 * are covered by a browser check. Nothing here touches the DOM at import time: the
 * bench registry is imported in Node for validation before it reaches a browser. No
 * sprites and no animation yet, by decision. This file must never be imported by src/.
 *
 * HONESTY (the game's own rule, equipmentTypes.ts rule 7): the Bestiary tab says on
 * its face that the engine applies only the combat numbers of creatures on the board
 * (the goblin and the skeleton, via MONSTER_STATBLOCKS); every other trait and action
 * is "The DM rules on this".
 */
import { RULEBOOK, type RuleBlock, type RuleSection } from "../../src/games/livingtable/rules/rulebook";
import { BESTIARY, CR_ORDER, abilityMod, type Beast, type BeastAttack, type CreatureSize } from "../../src/games/livingtable/rules/bestiary";
import { SRD_ATTRIBUTION } from "../../src/games/livingtable/menu/labels";
import { attachTip, type TipContent } from "./tip";

// ===========================================================================
// Pure helpers (no DOM)
// ===========================================================================

/** A modifier with its sign: +2, +0, -1 (a plain hyphen, never a dash character). */
export function formatModifier(n: number): string {
  return n >= 0 ? `+${n}` : `-${Math.abs(n)}`;
}

/** The creature's type with any subtype dropped: "humanoid (goblinoid)" is "humanoid". */
export function baseType(type: string): string {
  return type.split("(")[0]!.trim();
}

const SIZE_ORDER: readonly CreatureSize[] = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"];

/** The challenge ratings present, easiest first (rules/bestiary.ts CR_ORDER). */
export function crOptions(beasts: readonly Beast[]): string[] {
  const have = new Set(beasts.map((b) => b.cr));
  return CR_ORDER.filter((cr) => have.has(cr));
}

/** The base creature types present, alphabetical. */
export function typeOptions(beasts: readonly Beast[]): string[] {
  return [...new Set(beasts.map((b) => baseType(b.type)))].sort();
}

/** The sizes present, smallest first. */
export function sizeOptions(beasts: readonly Beast[]): CreatureSize[] {
  const have = new Set(beasts.map((b) => b.size));
  return SIZE_ORDER.filter((s) => have.has(s));
}

export interface BeastQuery {
  /** Every word must appear in the creature's name, type, description, habitat or tags (case blind). */
  text?: string;
  cr?: string | "all";
  /** A base type, as typeOptions lists them ("humanoid" matches "humanoid (goblinoid)"). */
  type?: string | "all";
  size?: string | "all";
  /** One tag, as written in the data ("undead", "dungeon"). */
  tag?: string;
}

function beastHaystack(b: Beast): string {
  return [b.name, b.type, b.size, b.description, b.habitat, ...b.tags].join(" ").toLowerCase();
}

/** The creatures that pass every filter given, in the order given. An empty or "all" filter passes everything. */
export function filterBeasts(beasts: readonly Beast[], q: BeastQuery = {}): Beast[] {
  const words = (q.text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const tag = q.tag?.trim().toLowerCase();
  return beasts.filter((b) => {
    if (q.cr && q.cr !== "all" && b.cr !== q.cr) return false;
    if (q.type && q.type !== "all" && baseType(b.type) !== q.type) return false;
    if (q.size && q.size !== "all" && b.size !== q.size) return false;
    if (tag && !b.tags.some((t) => t.toLowerCase() === tag)) return false;
    if (words.length > 0) {
      const hay = beastHaystack(b);
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

/** "40 creatures", "1 creature", or "3 of 40 creatures" while a filter is on. */
export function formatCount(shown: number, total: number): string {
  const noun = (n: number): string => (n === 1 ? "creature" : "creatures");
  return shown === total ? `${total} ${noun(total)}` : `${shown} of ${total} ${noun(total)}`;
}

/** "1d6+2" becomes "1d6 + 2" (a flat "1" stays "1"). */
export function formatDice(dice: string): string {
  return dice.replace(/([+-])(\d+)$/, " $1 $2");
}

/** "5 (1d6 + 2) slashing damage plus 7 (2d6) poison damage". A flat entry is "1 piercing damage". */
export function formatDamage(damage: BeastAttack["damage"]): string {
  return damage
    .map((d) => (/d/.test(d.dice) ? `${d.average} (${formatDice(d.dice)}) ${d.type} damage` : `${d.average} ${d.type} damage`))
    .join(" plus ");
}

/** Everything after the attack's name: "Melee attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage." */
export function formatAttackBody(a: BeastAttack): string {
  const kind = a.kind === "melee" ? "Melee attack" : a.kind === "ranged" ? "Ranged attack" : "Melee or ranged attack";
  const reach = a.reachFt !== undefined ? `reach ${a.reachFt} ft.` : null;
  const range = a.rangeFt ? `range ${a.rangeFt[0]}/${a.rangeFt[1]} ft.` : null;
  const where = reach && range ? `${reach} or ${range}` : (reach ?? range ?? "");
  const head = `${kind}: ${formatModifier(a.toHit)} to hit${where ? `, ${where}` : ""}, ${a.target}.`;
  const hit = `Hit: ${formatDamage(a.damage)}.`;
  return a.extra ? `${head} ${hit} ${a.extra}` : `${head} ${hit}`;
}

/** The whole attack line, name first: "Scimitar. Melee attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage." */
export function formatAttack(a: BeastAttack): string {
  return `${a.name}. ${formatAttackBody(a)}`;
}

/** "30 ft., fly 60 ft. (hover), swim 40 ft." */
export function formatSpeed(speed: Beast["speed"]): string {
  const parts = [`${speed.walk} ft.`];
  if (speed.burrow) parts.push(`burrow ${speed.burrow} ft.`);
  if (speed.climb) parts.push(`climb ${speed.climb} ft.`);
  if (speed.fly) parts.push(`fly ${speed.fly} ft.${speed.hover ? " (hover)" : ""}`);
  if (speed.swim) parts.push(`swim ${speed.swim} ft.`);
  return parts.join(", ");
}

const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"] as const;

/** The six scores for the stat block: label, score and signed modifier. */
export function abilityRows(scores: Beast["scores"]): { key: string; label: string; score: number; mod: string }[] {
  return ABILITY_KEYS.map((k) => ({ key: k, label: k.toUpperCase(), score: scores[k], mod: formatModifier(abilityMod(scores[k])) }));
}

/** "Dex +4, Wis +2" for saving throws; null when there are none. */
export function formatSaves(saves: Beast["saves"]): string | null {
  if (!saves) return null;
  const parts = ABILITY_KEYS.filter((k) => saves[k] !== undefined).map((k) => `${k[0]!.toUpperCase()}${k.slice(1)} ${formatModifier(saves[k]!)}`);
  return parts.length ? parts.join(", ") : null;
}

/** "Perception +3, Stealth +6"; null when there are none. */
export function formatSkills(skills: Beast["skills"]): string | null {
  if (!skills) return null;
  const parts = Object.entries(skills).map(([name, mod]) => `${name} ${formatModifier(mod)}`);
  return parts.length ? parts.join(", ") : null;
}

/** "darkvision 60 ft., passive Perception 9". The data's "none special" is dropped, leaving just the passive score. */
export function formatSenses(b: Pick<Beast, "senses" | "passivePerception">): string {
  const senses = b.senses.trim();
  const passive = `passive Perception ${b.passivePerception}`;
  return senses === "" || senses.toLowerCase() === "none special" ? passive : `${senses}, ${passive}`;
}

/** "1/4 (50 XP)", "8 (3,900 XP)". */
export function formatCr(b: Pick<Beast, "cr" | "xp">): string {
  return `${b.cr} (${b.xp.toLocaleString("en-US")} XP)`;
}

/** "7 (2d6)". */
export function formatHp(b: Pick<Beast, "hp" | "hpDice">): string {
  return `${b.hp} (${formatDice(b.hpDice)})`;
}

/** "15 (leather armor, shield)", or just "8". */
export function formatAc(b: Pick<Beast, "ac" | "acNote">): string {
  return b.acNote ? `${b.ac} (${b.acNote})` : String(b.ac);
}

/** The line under the name: "Small humanoid (goblinoid), neutral evil". */
export function formatSubtitle(b: Pick<Beast, "size" | "type" | "alignment">): string {
  return `${b.size} ${b.type}, ${b.alignment}`;
}

/** The sentence at the foot of a stat block that says what the engine does with it. Honest by construction. */
export function engineNote(b: Pick<Beast, "tokenAssetId">): string {
  return b.tokenAssetId
    ? "On the board: the game applies this creature's armor class, hit points, attack bonus, damage and ability modifiers. The DM rules on every trait and special action."
    : "Reference only: this creature has no token on the board yet. The DM rules on every number and trait here.";
}

// ---- the small glossary behind the hover help -------------------------------

/** One plain sentence or two for each term a new player trips on. Footers keep the honesty rule: what the game applies and what the DM rules on. */
export const BOOK_TERMS: Readonly<Record<string, TipContent>> = {
  ac: {
    title: "AC (Armor Class)",
    lines: ["The number an attack roll has to meet or beat to hit this creature. The higher it is, the harder it is to hit."],
    footer: "The game applies this to creatures on the board.",
  },
  hp: {
    title: "HP (hit points)",
    lines: ["How much damage the creature can take. Damage takes hit points away, and at 0 a creature is defeated. The dice in brackets are what the average is made from."],
    footer: "The game applies this to creatures on the board.",
  },
  cr: {
    title: "CR (challenge rating)",
    lines: ["A rough measure of how dangerous the creature is. 0 and the fractions 1/8, 1/4 and 1/2 are weaker than 1, and bigger numbers are deadlier."],
    footer: "The DM rules on this.",
  },
  xp: {
    title: "XP (experience points)",
    lines: ["What beating the creature is worth in the standard rules. The Living Table levels you up by milestones instead, so here it only tells you how tough the creature is meant to be."],
    footer: "The DM rules on this.",
  },
  "passive perception": {
    title: "Passive Perception",
    lines: ["What the creature notices without trying: 10 plus its Perception bonus. To slip past it unseen you generally have to beat this number."],
    footer: "The DM rules on this.",
  },
  "to hit": {
    title: "To hit",
    lines: ["The bonus the creature adds to its d20 attack roll. If the total meets or beats your Armor Class, the attack hits."],
    footer: "The game applies this to creatures on the board.",
  },
  "saving throw": {
    title: "Saving throw",
    lines: ["A d20 roll, plus a modifier, to resist something that is happening to you. Meet or beat the DC and you resist it."],
    footer: "The DM rules on this for creatures. Your own saves are applied by the game.",
  },
  dc: {
    title: "DC (Difficulty Class)",
    lines: ["The number a check or a saving throw has to meet or beat. A tie succeeds."],
  },
  darkvision: {
    title: "Darkvision",
    lines: ["Sees in the dark out to that range, as if it were dim light, but only in shades of grey."],
    footer: "The DM rules on this.",
  },
  blindsight: {
    title: "Blindsight",
    lines: ["Senses what is around it out to that range without needing to see, so darkness and invisibility do not hide you from it."],
    footer: "The DM rules on this.",
  },
  truesight: {
    title: "Truesight",
    lines: ["Sees in the dark, sees invisible things and sees through illusions out to that range."],
    footer: "The DM rules on this.",
  },
  tremorsense: {
    title: "Tremorsense",
    lines: ["Feels anything that is touching the same ground, out to that range, even in the dark."],
    footer: "The DM rules on this.",
  },
  vulnerabilities: {
    title: "Damage vulnerabilities",
    lines: ["Damage of these kinds is doubled against this creature."],
    footer: "The DM rules on this.",
  },
  resistances: {
    title: "Damage resistances",
    lines: ["Damage of these kinds is halved against this creature."],
    footer: "The DM rules on this.",
  },
  immunities: {
    title: "Damage immunities",
    lines: ["Damage of these kinds does nothing to this creature."],
    footer: "The DM rules on this.",
  },
  "condition immunities": {
    title: "Condition immunities",
    lines: ["The creature cannot be given these conditions (for example poisoned or frightened)."],
    footer: "The DM rules on this.",
  },
};

export interface TextSegment {
  text: string;
  /** The BOOK_TERMS key this stretch of text is, when it is one. */
  term?: string;
}

const TERM_PATTERN = /\b(saving throws?|to hit|passive Perception|DC|darkvision|blindsight|truesight|tremorsense)\b/g;

function termKey(matched: string): string {
  const k = matched.toLowerCase();
  return k === "saving throws" ? "saving throw" : k;
}

/**
 * Splits a line of stat block text into plain stretches and the terms that have hover help, so a trait reading
 * "must succeed on a DC 11 Constitution saving throw" shows DC and saving throw as tipped. Only the first
 * use of each term in the line is marked, so a long trait is not a wall of underlines.
 */
export function findTerms(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  const seen = new Set<string>();
  let last = 0;
  for (const m of text.matchAll(TERM_PATTERN)) {
    const key = termKey(m[0]);
    if (seen.has(key)) continue;
    seen.add(key);
    const at = m.index!;
    if (at > last) out.push({ text: text.slice(last, at) });
    out.push({ text: m[0], term: key });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text }];
}

// ---- rules: search and highlight -------------------------------------------

/** One block's words as plain text, for searching. */
export function ruleBlockText(block: RuleBlock): string {
  switch (block.kind) {
    case "p":
    case "example":
    case "note":
      return block.text;
    case "list":
      return block.items.join(" ");
    case "table":
      return [block.head.join(" "), ...block.rows.map((r) => r.join(" "))].join(" ");
  }
}

/** The words typed into a search box: lower cased, split on spaces, empties dropped. */
export function queryWords(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function sectionHaystack(s: RuleSection): string {
  return [s.title, s.summary, ...s.blocks.map(ruleBlockText)].join(" ").toLowerCase();
}

/** The sections whose title, summary or body contains every word of the query (all of them for an empty query), in book order. */
export function filterRuleSections(sections: readonly RuleSection[], query: string): RuleSection[] {
  const words = queryWords(query);
  if (words.length === 0) return [...sections];
  return sections.filter((s) => {
    const hay = sectionHaystack(s);
    return words.every((w) => hay.includes(w));
  });
}

export interface HighlightSegment {
  text: string;
  hit: boolean;
}

/** `text` cut into stretches, the ones matching a word of the query marked as hits. Joining the stretches gives `text` back. */
export function splitHighlight(text: string, query: string): HighlightSegment[] {
  const words = queryWords(query);
  if (words.length === 0 || text === "") return [{ text, hit: false }];
  const pattern = new RegExp(
    words
      .sort((a, b) => b.length - a.length)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|"),
    "gi",
  );
  const out: HighlightSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    if (m[0] === "") continue;
    const at = m.index!;
    if (at > last) out.push({ text: text.slice(last, at), hit: false });
    out.push({ text: m[0], hit: true });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out.length ? out : [{ text, hit: false }];
}

/** "12 sections", "1 section", or "3 of 12 sections" while a search is on. */
export function formatSectionCount(shown: number, total: number): string {
  const noun = (n: number): string => (n === 1 ? "section" : "sections");
  return shown === total ? `${total} ${noun(total)}` : `${shown} of ${total} ${noun(total)}`;
}

/** The SRD attribution as the lines the footer prints, all of it: creator, copyright, license with its URL, the modified notice and the disclaimer. */
export function attributionLines(): string[] {
  return [
    SRD_ATTRIBUTION.creator,
    SRD_ATTRIBUTION.copyright,
    `${SRD_ATTRIBUTION.license} ${SRD_ATTRIBUTION.licenseUrl}`,
    SRD_ATTRIBUTION.modified,
    SRD_ATTRIBUTION.disclaimer,
  ];
}

// ===========================================================================
// DOM
// ===========================================================================

type Attrs = Record<string, string>;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string, attrs?: Attrs): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/** Text into `parent`, the stretches that match the query wrapped in <mark>. */
function appendHighlighted(parent: HTMLElement, text: string, query: string): void {
  for (const seg of splitHighlight(text, query)) {
    if (seg.hit) parent.appendChild(h("mark", "bk-mark", seg.text));
    else parent.appendChild(document.createTextNode(seg.text));
  }
}

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function injectBooksStyle(): void {
  if (document.getElementById("lt-books-style")) return;
  const style = document.createElement("style");
  style.id = "lt-books-style";
  style.textContent = `
#bench-root .bk{--bk-measure:72ch}
#bench-root .bk-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
#bench-root .bk-bar input.bn-search{flex:1 1 220px}
#bench-root .bk-count{font-size:12.5px;color:var(--bn-muted);white-space:nowrap}
#bench-root .bk-lead{margin:0 0 12px;max-width:var(--bk-measure);color:var(--bn-muted);font-size:13px}
#bench-root .bk-mark{background:color-mix(in srgb,var(--bn-accent) 28%,transparent);color:inherit;border-radius:3px;padding:0 1px}
#bench-root .bk-term{border-bottom:1px dotted var(--bn-muted);cursor:help}
#bench-root .bk-term:focus-visible{border-radius:2px}
#bench-root .bk-link{font:inherit;background:none;border:0;padding:0;color:var(--bn-accent);cursor:pointer;text-decoration:underline;text-underline-offset:2px;text-align:left}
#bench-root .bk-link:hover{filter:brightness(1.15)}
#bench-root .bk-empty{color:var(--bn-muted);padding:20px 4px;font-size:13px}
#bench-root .bk-attrib{margin-top:22px;padding-top:14px;border-top:1px solid var(--bn-line);color:var(--bn-muted);font-size:12px}
#bench-root .bk-attrib h3{font-size:12px;margin:0 0 6px;text-transform:uppercase;letter-spacing:.06em}
#bench-root .bk-attrib p{margin:0 0 6px;max-width:var(--bk-measure);overflow-wrap:anywhere}
#bench-root .bk-attrib a{color:var(--bn-accent)}

/* Rules */
#bench-root .bk-rules{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;align-items:start}
@media (min-width:860px){#bench-root .bk-rules{grid-template-columns:260px minmax(0,1fr);gap:22px}}
#bench-root .bk-toc{background:var(--bn-panel);border:1px solid var(--bn-line);border-radius:10px;padding:8px 10px}
@media (min-width:860px){#bench-root .bk-toc{position:sticky;top:10px;max-height:calc(100vh - 20px);overflow:auto}}
#bench-root .bk-toc>summary{cursor:pointer;font-weight:600;font-size:13px;padding:4px 0;list-style:none}
#bench-root .bk-toc>summary::-webkit-details-marker{display:none}
#bench-root .bk-toc>summary::after{content:" (tap to open)";font-weight:400;color:var(--bn-muted);font-size:12px}
#bench-root .bk-toc[open]>summary::after{content:""}
@media (min-width:860px){#bench-root .bk-toc>summary{display:none}}
#bench-root .bk-toc ol{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:2px}
#bench-root .bk-toc li button{display:block;width:100%;text-align:left;font:inherit;background:transparent;border:0;border-radius:7px;padding:6px 8px;cursor:pointer;color:var(--bn-text)}
#bench-root .bk-toc li button:hover,#bench-root .bk-toc li button.on{background:var(--bn-panel-alt)}
#bench-root .bk-toc-title{display:block;font-size:13px;font-weight:600}
#bench-root .bk-toc-sum{display:block;font-size:11.5px;color:var(--bn-muted);line-height:1.35;margin-top:1px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
#bench-root .bk-sections{display:flex;flex-direction:column;gap:14px;min-width:0}
#bench-root .bk-section{background:var(--bn-panel);border:1px solid var(--bn-line);border-radius:12px;padding:16px 18px;scroll-margin-top:10px;min-width:0}
#bench-root .bk-section:focus{outline:none}
#bench-root .bk-section.bk-flash{animation:bk-flash 1.2s ease-out}
@keyframes bk-flash{from{box-shadow:0 0 0 3px var(--bn-accent)}to{box-shadow:0 0 0 3px transparent}}
@media (prefers-reduced-motion:reduce){#bench-root .bk-section.bk-flash{animation:none;border-color:var(--bn-accent)}}
#bench-root .bk-section h2{font-size:18px;margin:0 0 4px;letter-spacing:-.01em}
#bench-root .bk-sum{margin:0 0 10px;color:var(--bn-muted);font-size:13.5px;max-width:var(--bk-measure)}
#bench-root .bk-section p,#bench-root .bk-section ul{max-width:var(--bk-measure)}
#bench-root .bk-section p{margin:0 0 10px}
#bench-root .bk-section ul{margin:0 0 10px;padding-left:20px}
#bench-root .bk-section li{margin:0 0 4px}
#bench-root .bk-table-wrap{overflow-x:auto;width:fit-content;max-width:100%;margin:0 0 12px;border:1px solid var(--bn-line);border-radius:8px}
#bench-root .bk-table-wrap table{border-collapse:collapse;font-size:12.5px}
#bench-root .bk-table-wrap th{text-align:left;background:var(--bn-panel-alt);font-weight:600;white-space:nowrap}
#bench-root .bk-table-wrap th,#bench-root .bk-table-wrap td{padding:6px 10px;border-bottom:1px solid var(--bn-line);vertical-align:top}
#bench-root .bk-table-wrap tr:last-child td{border-bottom:0}
#bench-root .bk-table-wrap td{min-width:6ch}
#bench-root .bk-callout{max-width:var(--bk-measure);margin:0 0 12px;padding:9px 12px;border-radius:8px;border:1px solid var(--bn-line);border-left-width:4px;font-size:13px}
#bench-root .bk-callout-label{display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:2px;color:var(--bn-muted)}
#bench-root .bk-example{background:var(--bn-panel-alt);border-left-color:var(--bn-accent);border-style:dashed dashed dashed solid}
#bench-root .bk-example .bk-callout-label{color:var(--bn-accent)}
#bench-root .bk-note{background:var(--bn-code-bg);border-left-color:var(--bn-muted)}
#bench-root .bk-see{margin:6px 0 0;font-size:12.5px;color:var(--bn-muted);display:flex;gap:6px 12px;flex-wrap:wrap;align-items:baseline}

@media (max-width:520px){#bench-root .bk-filters input.bn-search,#bench-root .bk-bar input.bn-search{flex-basis:100%}}

/* Bestiary */
#bench-root .bk-filters{display:flex;align-items:center;gap:8px 10px;flex-wrap:wrap;margin-bottom:8px}
#bench-root .bk-filters input.bn-search{flex:1 1 200px}
#bench-root .bk-key{margin:0 0 12px;font-size:12px;color:var(--bn-muted);display:flex;gap:4px 14px;flex-wrap:wrap}
#bench-root .bk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,250px),1fr));gap:10px;align-items:start}
#bench-root .bk-entry{background:var(--bn-panel);border:1px solid var(--bn-line);border-radius:10px;min-width:0}
#bench-root .bk-entry[hidden]{display:none}
#bench-root .bk-entry.open{grid-column:1/-1;border-color:var(--bn-accent)}
#bench-root .bk-entry-head{font:inherit;color:var(--bn-text);background:transparent;border:0;width:100%;text-align:left;cursor:pointer;
  display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 8px;padding:10px 12px;border-radius:10px}
#bench-root .bk-entry-head:hover{background:var(--bn-panel-alt)}
#bench-root .bk-entry-name{font-weight:700;font-size:14.5px;overflow-wrap:anywhere}
#bench-root .bk-cr{font-size:12px;font-weight:600;background:var(--bn-panel-alt);border:1px solid var(--bn-line);border-radius:999px;padding:1px 8px;white-space:nowrap;align-self:start}
#bench-root .bk-entry.open .bk-cr{background:var(--bn-accent);color:var(--bn-accent-ink);border-color:var(--bn-accent)}
#bench-root .bk-entry-sub{grid-column:1/-1;font-size:12px;color:var(--bn-muted);font-style:italic;overflow-wrap:anywhere}
#bench-root .bk-entry-nums{grid-column:1/-1;font-size:12.5px;display:flex;gap:4px 12px;flex-wrap:wrap;align-items:center}
#bench-root .bk-entry-nums b{font-weight:600}
#bench-root .bk-badge{font-size:11px;font-weight:600;border-radius:999px;padding:1px 8px;background:color-mix(in srgb,var(--bn-accent) 18%,transparent);color:var(--bn-text);border:1px solid var(--bn-accent)}
#bench-root .bk-body{display:grid;grid-template-columns:minmax(0,1fr);grid-template-areas:"prose" "stat";gap:14px;padding:4px 14px 16px}
@media (min-width:860px){#bench-root .bk-body{grid-template-columns:minmax(0,520px) minmax(0,1fr);grid-template-areas:"stat prose";gap:22px}}
#bench-root .bk-prose{grid-area:prose;font-size:13.5px;max-width:var(--bk-measure)}
#bench-root .bk-prose h4{margin:12px 0 2px;font-size:11.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--bn-muted)}
#bench-root .bk-prose h4:first-child{margin-top:0}
#bench-root .bk-prose p{margin:0}
#bench-root .bk-fights{margin-top:12px;padding:9px 12px;border:1px solid var(--bn-line);border-left:4px solid var(--bn-danger);border-radius:8px;background:var(--bn-panel-alt)}
#bench-root .bk-fights h4{margin:0 0 2px}
#bench-root .bk-engine{margin:12px 0 0;font-size:12.5px;color:var(--bn-muted)}
#bench-root .bk-sb{grid-area:stat;background:var(--bn-bg);border:1px solid var(--bn-line);border-top:4px solid var(--bn-accent);border-bottom:4px solid var(--bn-accent);border-radius:4px;padding:12px 14px;font-size:13.5px;min-width:0}
#bench-root .bk-sb h3{margin:0;font-size:20px;letter-spacing:-.01em;color:var(--bn-accent);font-variant:small-caps;overflow-wrap:anywhere}
#bench-root .bk-sb-sub{margin:0 0 6px;font-style:italic;color:var(--bn-muted);font-size:12.5px}
#bench-root .bk-rule{height:2px;margin:8px 0;border:0;background:linear-gradient(90deg,var(--bn-accent),transparent)}
#bench-root .bk-prop{margin:2px 0;overflow-wrap:anywhere}
#bench-root .bk-prop>b{color:var(--bn-accent);font-weight:700}
#bench-root .bk-abil{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:4px;text-align:center;margin:0}
#bench-root .bk-abil>div{min-width:0}
#bench-root .bk-abil dt{font-size:11px;font-weight:700;color:var(--bn-accent);letter-spacing:.05em}
#bench-root .bk-abil dd{margin:0;font-size:12.5px;font-variant-numeric:tabular-nums}
@media (max-width:420px){#bench-root .bk-abil{grid-template-columns:repeat(3,minmax(0,1fr));row-gap:8px}}
#bench-root .bk-sb h5{margin:12px 0 6px;font-size:15px;font-weight:600;font-variant:small-caps;color:var(--bn-accent);border-bottom:1px solid var(--bn-accent);padding-bottom:2px}
#bench-root .bk-feat{margin:0 0 7px;overflow-wrap:anywhere}
#bench-root .bk-feat>em{font-weight:700}
`;
  document.head.appendChild(style);
}

/** The SRD footer both tabs share: every line of SRD_ATTRIBUTION, the license URL as a link. */
function buildAttribution(): HTMLElement {
  const foot = h("footer", "bk-attrib");
  foot.appendChild(h("h3", undefined, "Source and license"));
  for (const line of attributionLines()) {
    const p = h("p");
    const at = line.indexOf(SRD_ATTRIBUTION.licenseUrl);
    if (at >= 0) {
      p.appendChild(document.createTextNode(line.slice(0, at)));
      p.appendChild(h("a", undefined, SRD_ATTRIBUTION.licenseUrl, { href: SRD_ATTRIBUTION.licenseUrl, target: "_blank", rel: "noopener noreferrer" }));
      p.appendChild(document.createTextNode(line.slice(at + SRD_ATTRIBUTION.licenseUrl.length)));
    } else {
      p.textContent = line;
    }
    foot.appendChild(p);
  }
  return foot;
}

/** A word with hover help, a dotted underline and a focus stop. The detach function goes into `tips`. */
function termSpan(label: string, key: string, tips: (() => void)[]): HTMLElement {
  const content = BOOK_TERMS[key];
  const s = h("span", "bk-term", label);
  if (content) tips.push(attachTip(s, content));
  return s;
}

/** Text into `parent` with the confusing terms in it given hover help. */
function appendAnnotated(parent: HTMLElement, text: string, tips: (() => void)[]): void {
  for (const seg of findTerms(text)) {
    if (seg.term) parent.appendChild(termSpan(seg.text, seg.term, tips));
    else parent.appendChild(document.createTextNode(seg.text));
  }
}

// ---- the Rules tab -----------------------------------------------------------

export function mountRulesPanel(el: HTMLElement, _api: unknown): () => void {
  injectBooksStyle();
  el.innerHTML = "";
  const root = h("div", "bk");
  el.appendChild(root);

  const total = RULEBOOK.length;
  let query = "";

  const bar = h("div", "bk-bar");
  const search = h("input", "bn-search", undefined, { type: "search", placeholder: "Search the rules, e.g. death", "aria-label": "Search the rules" });
  const count = h("span", "bk-count");
  bar.append(search, count);
  root.append(bar, h("p", "bk-lead", "How The Living Table is played, in plain words. Every number here is read from the game's own engine. Where the engine does not apply something, the book says so."));

  const layout = h("div", "bk-rules");
  const toc = h("details", "bk-toc");
  const tocSummary = h("summary", undefined, "Contents");
  const tocList = h("ol");
  toc.append(tocSummary, tocList);
  const sectionsEl = h("div", "bk-sections");
  layout.append(toc, sectionsEl);
  root.append(layout, buildAttribution());

  // The contents list is always open on a wide page and folded on a phone.
  const wide = typeof matchMedia === "function" ? matchMedia("(min-width: 860px)") : null;
  const syncToc = (): void => {
    if (wide) toc.open = wide.matches;
  };
  syncToc();
  wide?.addEventListener("change", syncToc);

  let tocButtons = new Map<string, HTMLButtonElement>();

  function renderBlock(parent: HTMLElement, block: RuleBlock): void {
    switch (block.kind) {
      case "p": {
        const p = h("p");
        appendHighlighted(p, block.text, query);
        parent.appendChild(p);
        break;
      }
      case "list": {
        const ul = h("ul");
        for (const item of block.items) {
          const li = h("li");
          appendHighlighted(li, item, query);
          ul.appendChild(li);
        }
        parent.appendChild(ul);
        break;
      }
      case "table": {
        const wrap = h("div", "bk-table-wrap");
        wrap.tabIndex = 0;
        wrap.setAttribute("role", "region");
        wrap.setAttribute("aria-label", `Table: ${block.head.join(", ")}`);
        const table = h("table");
        const thead = h("thead");
        const hr = h("tr");
        for (const c of block.head) hr.appendChild(h("th", undefined, c, { scope: "col" }));
        thead.appendChild(hr);
        const tbody = h("tbody");
        for (const row of block.rows) {
          const tr = h("tr");
          for (const c of row) {
            const td = h("td");
            appendHighlighted(td, c, query);
            tr.appendChild(td);
          }
          tbody.appendChild(tr);
        }
        table.append(thead, tbody);
        wrap.appendChild(table);
        parent.appendChild(wrap);
        break;
      }
      case "example":
      case "note": {
        const box = h("div", `bk-callout ${block.kind === "example" ? "bk-example" : "bk-note"}`);
        box.appendChild(h("span", "bk-callout-label", block.kind === "example" ? "Example" : "Note"));
        const body = h("span");
        appendHighlighted(body, block.text, query);
        box.appendChild(body);
        parent.appendChild(box);
        break;
      }
    }
  }

  function render(): void {
    const shown = filterRuleSections(RULEBOOK, query);
    count.textContent = formatSectionCount(shown.length, total);
    tocList.innerHTML = "";
    sectionsEl.innerHTML = "";
    tocButtons = new Map();
    if (shown.length === 0) {
      const none = h("p", "bk-empty");
      none.textContent = `No section mentions "${query.trim()}". Try one word, such as "rest" or "armor".`;
      sectionsEl.appendChild(none);
    }
    for (const s of shown) {
      const li = h("li");
      const btn = h("button", undefined, undefined, { type: "button" });
      const title = h("span", "bk-toc-title");
      appendHighlighted(title, s.title, query);
      const sum = h("span", "bk-toc-sum", s.summary);
      btn.append(title, sum);
      btn.onclick = () => jump(s.id);
      tocButtons.set(s.id, btn);
      li.appendChild(btn);
      tocList.appendChild(li);

      const sec = h("section", "bk-section", undefined, { id: `bk-rule-${s.id}`, tabindex: "-1", "aria-labelledby": `bk-rule-${s.id}-h` });
      const head = h("h2", undefined, undefined, { id: `bk-rule-${s.id}-h` });
      appendHighlighted(head, s.title, query);
      sec.appendChild(head);
      const sumP = h("p", "bk-sum");
      appendHighlighted(sumP, s.summary, query);
      sec.appendChild(sumP);
      for (const block of s.blocks) renderBlock(sec, block);
      if (s.seeAlso?.length) {
        const see = h("p", "bk-see", "See also:");
        for (const id of s.seeAlso) {
          const target = RULEBOOK.find((r) => r.id === id);
          if (!target) continue;
          const link = h("button", "bk-link", target.title, { type: "button" });
          link.onclick = () => jump(id);
          see.appendChild(link);
        }
        sec.appendChild(see);
      }
      sectionsEl.appendChild(sec);
    }
  }

  function jump(id: string): void {
    if (query !== "" && !filterRuleSections(RULEBOOK, query).some((s) => s.id === id)) {
      query = "";
      search.value = "";
      render();
    }
    const sec = document.getElementById(`bk-rule-${id}`);
    if (!sec) return;
    sec.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    sec.focus({ preventScroll: true });
    sec.classList.remove("bk-flash");
    void sec.offsetWidth;
    sec.classList.add("bk-flash");
    for (const [sid, b] of tocButtons) b.classList.toggle("on", sid === id);
  }

  search.addEventListener("input", () => {
    query = search.value;
    render();
  });
  render();

  return () => {
    wide?.removeEventListener("change", syncToc);
    el.innerHTML = "";
  };
}

// ---- the Bestiary tab --------------------------------------------------------

function selectOf(label: string, options: readonly string[], allLabel: string, onChange: (v: string) => void): HTMLElement {
  const wrap = h("label", "bn-field", `${label} `);
  const sel = h("select", "bn-select", undefined, { "aria-label": label });
  sel.appendChild(new Option(allLabel, "all"));
  for (const o of options) sel.appendChild(new Option(o, o));
  sel.onchange = () => onChange(sel.value);
  wrap.appendChild(sel);
  return wrap;
}

function prop(label: string, value: string, tips: (() => void)[], labelTerm?: string, annotate = false): HTMLElement {
  const p = h("p", "bk-prop");
  const b = h("b");
  if (labelTerm) b.appendChild(termSpan(label, labelTerm, tips));
  else b.textContent = label;
  p.append(b, document.createTextNode(" "));
  if (annotate) appendAnnotated(p, value, tips);
  else p.appendChild(document.createTextNode(value));
  return p;
}

function featureP(name: string, text: string, tips: (() => void)[]): HTMLElement {
  const p = h("p", "bk-feat");
  p.appendChild(h("em", undefined, `${name}. `));
  appendAnnotated(p, text, tips);
  return p;
}

/** The whole stat block of one creature: the classic entry layout in the bench's own look. */
function buildStatBlock(b: Beast, tips: (() => void)[]): HTMLElement {
  const sb = h("div", "bk-sb");
  sb.appendChild(h("h3", undefined, b.name));
  sb.appendChild(h("p", "bk-sb-sub", formatSubtitle(b)));
  sb.appendChild(h("hr", "bk-rule"));
  sb.appendChild(prop("Armor Class", formatAc(b), tips, "ac"));
  sb.appendChild(prop("Hit Points", formatHp(b), tips, "hp"));
  sb.appendChild(prop("Speed", formatSpeed(b.speed), tips));
  sb.appendChild(h("hr", "bk-rule"));

  const abil = h("dl", "bk-abil");
  for (const row of abilityRows(b.scores)) {
    const cell = h("div");
    cell.append(h("dt", undefined, row.label), h("dd", undefined, `${row.score} (${row.mod})`));
    abil.appendChild(cell);
  }
  sb.appendChild(abil);
  sb.appendChild(h("hr", "bk-rule"));

  const saves = formatSaves(b.saves);
  if (saves) sb.appendChild(prop("Saving Throws", saves, tips, "saving throw"));
  const skills = formatSkills(b.skills);
  if (skills) sb.appendChild(prop("Skills", skills, tips));
  if (b.vulnerabilities?.length) sb.appendChild(prop("Damage Vulnerabilities", b.vulnerabilities.join(", "), tips, "vulnerabilities"));
  if (b.resistances?.length) sb.appendChild(prop("Damage Resistances", b.resistances.join(", "), tips, "resistances"));
  if (b.immunities?.length) sb.appendChild(prop("Damage Immunities", b.immunities.join(", "), tips, "immunities"));
  if (b.conditionImmunities?.length) sb.appendChild(prop("Condition Immunities", b.conditionImmunities.join(", "), tips, "condition immunities"));

  sb.appendChild(prop("Senses", formatSenses(b), tips, undefined, true));
  sb.appendChild(prop("Languages", b.languages, tips));

  const cr = h("p", "bk-prop");
  cr.appendChild(h("b", undefined, "Challenge"));
  cr.appendChild(document.createTextNode(" "));
  cr.appendChild(termSpan(b.cr, "cr", tips));
  cr.appendChild(document.createTextNode(" ("));
  cr.appendChild(termSpan(`${b.xp.toLocaleString("en-US")} XP`, "xp", tips));
  cr.appendChild(document.createTextNode(")"));
  sb.appendChild(cr);

  if (b.traits.length) {
    sb.appendChild(h("hr", "bk-rule"));
    for (const t of b.traits) sb.appendChild(featureP(t.name, t.text, tips));
  }

  const hasActions = b.multiattack || b.attacks.length || b.specials?.length;
  if (hasActions) {
    sb.appendChild(h("h5", undefined, "Actions"));
    if (b.multiattack) sb.appendChild(featureP("Multiattack", b.multiattack, tips));
    for (const a of b.attacks) {
      const p = h("p", "bk-feat");
      p.appendChild(h("em", undefined, `${a.name}. `));
      appendAnnotated(p, formatAttackBody(a), tips);
      sb.appendChild(p);
    }
    for (const s of b.specials ?? []) sb.appendChild(featureP(s.name, s.text, tips));
  }
  if (b.reactions?.length) {
    sb.appendChild(h("h5", undefined, "Reactions"));
    for (const r of b.reactions) sb.appendChild(featureP(r.name, r.text, tips));
  }
  return sb;
}

function buildEntryBody(b: Beast, tips: (() => void)[]): HTMLElement {
  const body = h("div", "bk-body");
  const prose = h("div", "bk-prose");
  prose.appendChild(h("h4", undefined, "What it is"));
  prose.appendChild(h("p", undefined, b.description));
  prose.appendChild(h("h4", undefined, "Where you find it"));
  prose.appendChild(h("p", undefined, b.habitat));
  const fights = h("div", "bk-fights");
  fights.appendChild(h("h4", undefined, "How it fights"));
  fights.appendChild(h("p", undefined, b.tactics));
  prose.appendChild(fights);
  prose.appendChild(h("p", "bk-engine", engineNote(b)));
  body.append(buildStatBlock(b, tips), prose);
  return body;
}

export function mountBestiaryPanel(el: HTMLElement, _api: unknown): () => void {
  injectBooksStyle();
  el.innerHTML = "";
  const root = h("div", "bk");
  el.appendChild(root);
  const tips: (() => void)[] = [];

  const q: Required<Pick<BeastQuery, "text" | "cr" | "type" | "size">> = { text: "", cr: "all", type: "all", size: "all" };
  const total = BESTIARY.length;

  const filters = h("div", "bk-filters");
  const search = h("input", "bn-search", undefined, { type: "search", placeholder: "Search, e.g. undead or cave", "aria-label": "Search the bestiary" });
  const crSel = selectOf("CR", crOptions(BESTIARY), "Any", (v) => ((q.cr = v), apply()));
  const typeSel = selectOf("Type", typeOptions(BESTIARY), "Any", (v) => ((q.type = v), apply()));
  const sizeSel = selectOf("Size", sizeOptions(BESTIARY), "Any", (v) => ((q.size = v), apply()));
  const count = h("span", "bk-count");
  count.setAttribute("aria-live", "polite");
  const clear = h("button", "bn-btn", "Clear filters", { type: "button" });
  filters.append(search, crSel, typeSel, sizeSel, count, clear);

  const key = h("p", "bk-key");
  key.appendChild(h("span", undefined, "Hover or tap a word for what it means:"));
  for (const [label, term] of [["AC", "ac"], ["HP", "hp"], ["CR", "cr"], ["XP", "xp"], ["passive Perception", "passive perception"], ["to hit", "to hit"], ["saving throw", "saving throw"], ["DC", "dc"]] as const) {
    key.appendChild(termSpan(label, term, tips));
  }

  root.append(
    filters,
    h("p", "bk-lead", "The generic fantasy creatures, with their standard numbers and our own descriptions. Tap a creature to open its stat block. These are reference entries: the game applies the combat numbers only for the creatures marked On the board, and the DM rules on everything else. No pictures yet."),
    key,
  );

  const grid = h("div", "bk-grid");
  const empty = h("p", "bk-empty", "No creature matches. Clear a filter or try another word.");
  empty.hidden = true;
  root.append(grid, empty, buildAttribution());

  const entries = new Map<string, { beast: Beast; article: HTMLElement; head: HTMLButtonElement; body: HTMLElement | null }>();
  for (const b of BESTIARY) {
    const article = h("article", "bk-entry", undefined, { "data-beast": b.id });
    const head = h("button", "bk-entry-head", undefined, { type: "button", "aria-expanded": "false" });
    head.append(h("span", "bk-entry-name", b.name), h("span", "bk-cr", `CR ${b.cr}`), h("span", "bk-entry-sub", `${b.size} ${b.type}`));
    const nums = h("span", "bk-entry-nums");
    const ac = h("span");
    ac.append(h("b", undefined, "AC "), document.createTextNode(String(b.ac)));
    const hp = h("span");
    hp.append(h("b", undefined, "HP "), document.createTextNode(String(b.hp)));
    nums.append(ac, hp);
    if (b.tokenAssetId) nums.appendChild(h("span", "bk-badge", "On the board"));
    head.appendChild(nums);
    const entry = { beast: b, article, head, body: null as HTMLElement | null };
    head.onclick = () => {
      const open = !article.classList.contains("open");
      if (open && !entry.body) {
        entry.body = buildEntryBody(b, tips);
        entry.body.id = `bk-body-${b.id}`;
        head.setAttribute("aria-controls", entry.body.id);
        article.appendChild(entry.body);
      }
      article.classList.toggle("open", open);
      head.setAttribute("aria-expanded", String(open));
      if (entry.body) entry.body.hidden = !open;
    };
    article.appendChild(head);
    grid.appendChild(article);
    entries.set(b.id, entry);
  }

  function apply(): void {
    const keep = new Set(filterBeasts(BESTIARY, q).map((b) => b.id));
    for (const [id, e] of entries) e.article.hidden = !keep.has(id);
    count.textContent = formatCount(keep.size, total);
    empty.hidden = keep.size > 0;
    clear.hidden = q.text === "" && q.cr === "all" && q.type === "all" && q.size === "all";
  }

  search.addEventListener("input", () => {
    q.text = search.value;
    apply();
  });
  clear.onclick = () => {
    q.text = "";
    q.cr = q.type = q.size = "all";
    search.value = "";
    for (const sel of filters.querySelectorAll("select")) sel.value = "all";
    apply();
  };
  apply();

  return () => {
    for (const detach of tips) detach();
    el.innerHTML = "";
  };
}
