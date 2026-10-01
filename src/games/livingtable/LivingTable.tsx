/**
 * The Living Table -- the screen that wires all eight already-built
 * subsystems (rules, world, characters, memory, dm, menu, render, assets)
 * into one playable AI dungeon master (DESIGN.md, "The Living Table").
 *
 * Structural precedent: Vault.tsx (a multi-screen game with its own
 * AI-paid conversational loop). Same shape here: a top-level component
 * switching between sub-screens, GameHeader/Busy/ErrorNote/CostBadge/Panel
 * from components/Bits.tsx, an onExit prop.
 *
 * Four screens:
 *   1. Campaign list / new campaign (this file's `LivingTable` + `NewCampaignScreen`)
 *   2. Character creation (`CreateCharacterScreen`)
 *   3. The play screen (`PlayScreen` loads state, `PlaySession` runs the loop)
 *
 * PERSISTED POSITION, stated once here: DESIGN.md doesn't say where "the
 * party's current cell" should live across sessions. This integration pass
 * stores it inside the player character's own `stats` blob (see
 * session/characterState.ts), updated via ltCharacterUpdate whenever it
 * changes -- a character's stat block and its map position share the same
 * lifecycle and the same write path, so one call covers both.
 *
 * WORLD LOADING, stated once here too: games-db has no bulk "list every
 * cell in this campaign" action, only `ltCellGet` by exact (cx,cy). The
 * play screen therefore loads the party's current cell plus its 8
 * neighbours whenever the current cell changes (`ensureNeighborhoodLoaded`)
 * and rebuilds a local `World` from everything it has ever loaded this
 * session (session/worldLoader.ts's `buildWorldFromCells`), which also
 * reconstructs world/connectivity.ts's stake bookkeeping -- see that
 * module's own header for the one narrow case this doesn't cover.
 *
 * TWO SEPARATE LOGS, because conflating them cost the player their own
 * story: `story` is what the player reads and is never touched again once
 * written, while `workingMemory` is the model's context and is condensed as
 * it ages (memory/workingMemory.ts). The panel used to render working
 * memory directly, so four turns after reading an opening paragraph the
 * player watched it collapse into "first sentence ... last sentence" with a
 * "condensed" pill on it, permanently, with no way back. Compression of the
 * model's context must not be paid for out of the player's readable story.
 * The player's OWN messages are in `story` too, rendered with the same
 * `bubble ${role}` pattern Vault.tsx and ColdCase.tsx use; before this they
 * were passed to the model and rendered nowhere, so the thing you paid a
 * credit to say was invisible.
 *
 * WHAT IS DELIBERATELY NOT HERE YET, stated in the file header rather than
 * apologised for in JSX (an unfinished feature is either shipped or its row
 * is simply absent; the screen never explains itself to the player in
 * developer voice):
 *   - Active SRD conditions on the character sheet. rules/conditions.ts has
 *     the list and its plain-language descriptions; CharacterSheet carries
 *     no `conditions` field for anything to toggle, so the sheet shows no
 *     Conditions row at all rather than a row that says "none tracked yet".
 *   - Battle Master's superiority dice. The level-3 Fighter choice is real on
 *     both sides now (Champion widens the crit range to 19 through
 *     rules/combat.ts's `criticalOn`, via session/combat.ts's
 *     `criticalOnFor`), but a maneuver pool is new mechanical surface rather
 *     than a parameter, so that half stays descriptive.
 *   - Player turns in the persisted log. `game_memory_log` stores DM
 *     narration only, so a reload replays the DM's side of the story and not
 *     the player's lines from previous sessions.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as api from "../../bridge/gamesApi";
import type { ChatMessage } from "../../bridge/ai";
import { Busy, CostBadge, ErrorNote, GameHeader, Panel } from "../../components/Bits";

import { PLAYABLE_TEMPLATES, playableArchetypes, type TemplateGenre } from "./characters/templates";
// `EquipmentTier` and `SlotRole` were imported for the hidden tier picker's
// props alone (issue #15); every other reference on this screen goes through
// menu/equipment.ts's own view types. They come back with the picker.
import { createCharacter, creationChoicesFor, normalizeSheet, type CharacterSheet } from "./characters/creation";
import {
  addMilestone,
  applyLevelUpChoice,
  canLevelUp,
  levelUpChoices,
  milestonesRemaining,
  MILESTONES_PER_LEVEL,
  type LevelUpOutcome,
} from "./characters/leveling";
import {
  applyDamage,
  applyDeathSave,
  applyHealing,
  longRest,
  longRestBlockedReason,
  newAdventuringDay,
  potionHealing,
  shortRest,
  shortRestBlockedReason,
  DEATH_SAVE_DC,
} from "./characters/health";
import { generateCampaignArc } from "./campaignGenerator";
import { loadManifest, type LoadedManifest } from "./assets/manifestCache";
import { coerceRegionSketch, regionHints, type ArcOutline, type CampaignDetail, type CampaignSummary } from "./types";
import {
  activeConditionsFor,
  characterStateFromStats,
  restoreSuperiorityDice,
  spendSuperiorityDie,
  statsFromCharacterState,
  superiorityDiceFor,
  type CharacterState,
} from "./session/characterState";
import { buildWorldFromCells, type LoadedCell } from "./session/worldLoader";
import { applyWorldActions } from "./session/applyWorldAction";
import { buildDmCharacterView, buildRejectionMessage, describeMoveIntoFog, BEGIN_CAMPAIGN_MESSAGE } from "./session/dmContext";
import { heuristicSummarize } from "./session/memoryHeuristics";
import { dedupeLog } from "./session/memoryLoad";
import {
  attackBonusSourcesFor,
  saveBonusSourcesFor,
  checkAdvantageFor,
  checkBonusSourcesFor,
  effectiveArmorClass,
  effectiveSpeedFt,
  evasionRescue,
  speedBeforeBootsFt,
  legendaryRiderDamageFor,
  attackerBonusFor,
  weaponDamageNotationFor,
  modifierForRollRequest,
  defenderACForRollRequest,
  dcForRollRequest,
  skillModifierFor,
  monsterArmorClassFor,
  monsterDamageNotationFor,
  monsterCurrentHp,
  damageMonster,
  criticalOnFor,
  maneuverSaveDCFor,
  maneuverTargetSaveModifier,
  maneuversFor,
  statblockFor,
  superiorityDiceMaxFor,
  weaponFor,
  DEFAULT_SPEED_FT,
  SEARCH_DC,
} from "./session/combat";

import {
  ALL_DIRECTIONS,
  CELL_HEIGHT,
  CELL_WIDTH,
  DEFAULT_MELEE_REACH_TILES,
  DEFAULT_RANGED_REACH_TILES,
  assembleCell,
  combatGeometryFrom,
  edgeCoord,
  getCell,
  getOffscreenCells,
  getPlayspace,
  markPropSearched,
  moveToken,
  neighbourCell,
  oppositeEdge,
  placeToken,
  removeToken,
  setTokenHp,
  tileFreeFor,
  type CellCoord,
  type Edge,
  type OffscreenCells,
  type Playspace,
  type World,
} from "./world/index";
import type { AssetManifest, CellLayout, PlacedToken } from "./world/cell";
import { resolveMenuAction, normalizeMenuHint, menuHintSentence, type CommandVerb } from "./menu/commandMenu";
// itemNameAt, equipItem and equippableTiers are still NOT imported here:
// they were the tier PICKER's ingredients, and the picker itself is not one
// of issue #15's restored surfaces -- it is REPLACED by the inventory
// screen (the one staged surface that changes gear now), never restored
// beside it. RARITY_WORD IS back: the rarity chip on the sheet's six gear
// rows reads it directly.
import {
  RARITY_WORD,
  armorDisplayLabel,
  renderPlanFor,
  renderPlansFor,
  packItems,
  startingGearNames,
  equipmentAcBonus,
  gearView,
} from "./menu/equipment";
import {
  ABILITY_NAME,
  bonusSources,
  CAMPAIGN_PLANNING_SUB,
  CREATION_BUSY_LABEL,
  CREDIT_BUYS,
  FREE_FOREVER_LINE,
  GAME_TAGLINE,
  GLOSSARY,
  NEW_CAMPAIGN_BLURB,
  SRD_ATTRIBUTION,
  attackLine,
  checkLine,
  explain,
  hitPoints,
  humanizeEngineError,
  lootLine,
  moveButtonTitle,
  neighbourLine,
  placeName,
  propLabel,
  saveName,
  stepsAndFeet,
  theProp,
  tokenLabel,
  type TokenNamer,
} from "./menu/labels";
import {
  activeCombatant,
  attackBlockedReason,
  dmActionBlockedReason,
  dropCombatant,
  endTurn as endCombatTurn,
  isPlayersTurn,
  spendActiveAction,
  spendCombatantAction,
  startCombat,
  tileDistanceFeet,
  withActiveEconomy,
  type CombatRound,
} from "./menu/combatRound";
import {
  attackCaption,
  attackWeaponName,
  castBlockedReason,
  castableSpells,
  spellNeedsTarget,
  spellAttackBonus,
  spellRangeFt,
  spellSaveDc,
  spendSlotFor,
  type CastableSpell,
} from "./menu/casting";
import { resolveAttack, resolveDamage, resolveManeuver, resolveSavingThrow, resolveSkillCheck, resetTurnEconomy, rollDice } from "./rules/index";
import { getManeuver, SUPERIORITY_DIE_SIDES, type ManeuverId } from "./rules/maneuvers";
import type { AbilityScores } from "./rules/abilities";
import { requestDmTurn } from "./dm/dmTurn";
import type { DmPromptArgs } from "./dm/promptBuilder";
import { findMagicGearNameIn, type DmTurn, type ResolvedRoll, type RollRequest } from "./dm/turnSchema";
import {
  LOOT_CAP_LINE,
  gearItemName,
  isContainerProp,
  isMagicGearName,
  type ArchetypeId,
  type BonusSource,
  type GearRole,
  type LoadoutDraft,
  type LootReadout,
  type LootSource,
} from "./characters/equipmentTypes";
import { accessoryStatus } from "./characters/equipment";
import { commitLoadout, draftFromSheet, stageEquip, stageUnequip } from "./rules/inventory";
import { gearChangeBlockedReason } from "./rules/attunement";
import { lootDmNote, lootFor } from "./rules/loot";
import { buildInventoryView, type InventorySelection } from "./inventory/inventoryView";
import { InventoryScreen } from "./inventory/InventoryScreen";
import { buildDmContextBlock } from "./memory/contextBuilder";
import { addSceneNarration, condenseOldest, needsCondensation, normalizeSuppliedFacts, verbatimSceneSeqs } from "./memory/workingMemory";
import type { WorkingMemoryState } from "./memory/types";
import { renderCell, SPRITE_SIZE } from "./render/canvasRenderer";
import { attackResultToReadout, checkResultToReadout, lootRollToReadout } from "./render/rollReadoutAdapter";
import { runHostileTurns } from "./session/hostileTurns";
import type { DiceLogEntry, ReadoutView } from "./session/combatEvents";

interface Props {
  onExit: () => void;
}

type Screen =
  | { kind: "campaigns" }
  | { kind: "newCampaign" }
  | { kind: "createCharacter"; campaign: CampaignDetail }
  | { kind: "play"; campaign: CampaignDetail; characterId: string };

/**
 * The canvas is drawn at an INTEGER multiple of the sprites' own 16px grid,
 * and displayed at exactly that many CSS pixels, because anything else
 * deletes pixels.
 *
 * What used to happen: the backing store was a fixed 640x480 and the CSS was
 * `width: 100%; max-width: 640px`, so inside the play layout's 2fr column the
 * canvas actually painted into about 536 CSS pixels. Nearest-neighbour
 * scaling (which `image-rendering: pixelated` asks for, correctly, for pixel
 * art) then kept 536 of 640 columns and 402 of 480 rows and simply dropped
 * the rest: 104 columns and 78 rows gone, and WHICH ones changed with the
 * window width. Every 1px feature in the sprite library -- a visor slit, an
 * eye, a strap, every mortar joint -- had roughly a one-in-six chance of
 * being deleted at the size the game actually displays, which is why rounds
 * of careful sub-2px art fixes could never land.
 *
 * `displayScale` picks the largest whole number of screen pixels per source
 * pixel that fits the measured container. The canvas is then sized in both
 * attributes and CSS to exactly `320k x 240k`, and the leftover width is
 * letterboxed (the canvas is simply centred) rather than fractionally
 * squeezed. devicePixelRatio is deliberately NOT multiplied in: the backing
 * store stays 1:1 with CSS pixels and `image-rendering: pixelated` handles
 * the device's own upscale, which keeps the sprite grid crisp on a phone.
 */
export function displayScale(containerWidth: number): number {
  const nativeWidth = CELL_WIDTH * SPRITE_SIZE; // 320
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return 1;
  return Math.max(1, Math.floor(containerWidth / nativeWidth));
}

/**
 * A write that retries, and tells the player when it has finally given up.
 *
 * Every write in the play session used to be `void api.x(...).catch(() => {})`
 * with a comment saying the local session state was still correct either way.
 * That comment had it backwards: local state being correct is precisely the
 * problem, because the server's copy is then wrong and the divergence only
 * surfaces on the next reload, which is exactly when the persisted state is
 * the only continuity the DM has. A dropped character write silently restores
 * hit points the player already lost; a dropped cell write silently
 * resurrects a killed monster; a dropped memory write silently erases a scene
 * from the campaign this game's whole pitch is built on remembering.
 *
 * `schedule` is injectable so the retry behaviour is testable without waiting
 * on real timers.
 */
export interface WriteQueue {
  submit(label: string, run: () => Promise<unknown>): void;
}

export function createWriteQueue(
  report: (message: string | null) => void,
  options: { attempts?: number; backoffMs?: number; schedule?: (fn: () => void, ms: number) => void } = {},
): WriteQueue {
  const attempts = options.attempts ?? 3;
  const backoffMs = options.backoffMs ?? 500;
  const schedule = options.schedule ?? ((fn, ms) => void setTimeout(fn, ms));
  let announcedFailure = false;

  return {
    submit(label, run) {
      let tries = 0;
      const attempt = (): void => {
        void run().then(
          () => {
            if (announcedFailure) {
              announcedFailure = false;
              report(null);
            }
          },
          () => {
            tries += 1;
            if (tries < attempts) {
              schedule(attempt, backoffMs * tries);
              return;
            }
            announcedFailure = true;
            report(
              `Your ${label} is not saving right now. The game on this device is fine, but the saved copy is behind, so a reload could lose it. Check your connection.`,
            );
          },
        );
      };
      attempt();
    },
  };
}

/** One line of the story the player actually reads. `engine` is the dice speaking, which is neither the DM's voice nor the player's. */
export interface StoryEntry {
  role: "user" | "assistant" | "engine";
  text: string;
}

/**
 * Seed the readable story from what games-db persisted.
 *
 * `session/memoryLoad.ts`'s `dedupeLog` prefers the CONDENSED row for a scene
 * that has both, which is right for the model's context and wrong for the
 * player's story: the full text is still on record as tier "verbatim", so
 * preferring it here costs nothing and means a reload replays what was
 * originally written rather than its digest.
 */
export interface StoredScene {
  sceneSeq: number;
  tier: string;
  content: string;
}

export function storyFromMemoryLog(log: readonly StoredScene[]): StoryEntry[] {
  const bySeq = new Map<number, StoredScene>();
  for (const entry of log) {
    const existing = bySeq.get(entry.sceneSeq);
    if (!existing || (existing.tier === "condensed" && entry.tier === "verbatim")) bySeq.set(entry.sceneSeq, entry);
  }
  return [...bySeq.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, entry]) => ({ role: "assistant" as const, text: entry.content }));
}

/** Defensive parse of ltCampaignGet's `arcOutline: unknown`: it is literally what this app generated and sent via ltCampaignCreate (see campaignGenerator.ts), so this only guards against a malformed/legacy row, never a real adversarial shape. */
function coerceArcOutline(v: unknown): ArcOutline {
  const rec = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const beats = Array.isArray(rec.beats) ? rec.beats.filter((b): b is string => typeof b === "string") : [];
  const npcsRaw = Array.isArray(rec.npcs) ? rec.npcs : [];
  const npcs = npcsRaw
    .map((n) => (n && typeof n === "object" ? (n as Record<string, unknown>) : null))
    .filter((n): n is Record<string, unknown> => n !== null)
    .map((n) => ({ name: typeof n.name === "string" ? n.name : "", role: typeof n.role === "string" ? n.role : "" }));
  // `regionSketch` is the campaign's own geography (types.ts): a handful of
  // planned cells with one line each on what is there. Carrying it through
  // here is what lets an unbuilt neighbour read as something the DM already
  // committed to rather than the literal word "unexplored" four times.
  return {
    throughline: typeof rec.throughline === "string" ? rec.throughline : "",
    beats,
    npcs,
    regionSketch: coerceRegionSketch(rec.regionSketch),
  };
}

function renderArcOutline(outline: ArcOutline): string {
  const npcs = outline.npcs.map((n) => `${n.name} (${n.role})`).join("; ") || "none named yet";
  const beats = outline.beats.map((b, i) => `${i + 1}. ${b}`).join("\n");
  return `Throughline: ${outline.throughline}\nBeats:\n${beats}\nKey NPCs: ${npcs}`;
}

// ── top-level screen switch ─────────────────────────────────────────────

export function LivingTable({ onExit }: Props) {
  const [screen, setScreen] = useState<Screen>({ kind: "campaigns" });
  const [error, setError] = useState<string | null>(null);

  const openCampaign = useCallback(async (id: string) => {
    setError(null);
    try {
      const res = await api.ltCampaignGet(id);
      const detail: CampaignDetail = {
        id: res.campaign.id,
        template: res.campaign.template,
        title: res.campaign.title,
        status: res.campaign.status,
        createdAt: res.campaign.createdAt,
        updatedAt: res.campaign.updatedAt,
        arcOutline: coerceArcOutline(res.campaign.arcOutline),
      };
      const playerCharacter = res.characters.find((c) => c.kind === "player");
      setScreen(
        playerCharacter
          ? { kind: "play", campaign: detail, characterId: playerCharacter.id }
          : { kind: "createCharacter", campaign: detail },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  if (error) return <ErrorNote message={error} onBack={onExit} />;

  if (screen.kind === "campaigns") {
    return (
      <CampaignListScreen
        onExit={onExit}
        onOpen={(id) => void openCampaign(id)}
        onNew={() => setScreen({ kind: "newCampaign" })}
      />
    );
  }
  if (screen.kind === "newCampaign") {
    return (
      <NewCampaignScreen onExit={() => setScreen({ kind: "campaigns" })} onCreated={(id) => void openCampaign(id)} />
    );
  }
  if (screen.kind === "createCharacter") {
    return (
      <CreateCharacterScreen
        campaign={screen.campaign}
        onExit={() => setScreen({ kind: "campaigns" })}
        onCreated={(characterId) => setScreen({ kind: "play", campaign: screen.campaign, characterId })}
      />
    );
  }
  return (
    <PlayScreen
      campaign={screen.campaign}
      characterId={screen.characterId}
      onExit={() => setScreen({ kind: "campaigns" })}
      onNewCharacter={() => setScreen({ kind: "createCharacter", campaign: screen.campaign })}
    />
  );
}

// ── the rules reference: attribution, and the vocabulary a newcomer needs ─

/**
 * The "About the rules" panel DESIGN.md promises ships in-app ("an 'About the
 * rules' panel, credited per the license") and that did not exist anywhere.
 *
 * It carries two things a newcomer and a licence both need. CC BY 4.0 requires
 * six specific elements (creator, copyright notice, licence notice, disclaimer
 * notice, a link to the licence, and an indication of modification), and this
 * game is built on SRD 5.1 under exactly that licence; before this panel,
 * grepping the whole of src/ for "SRD" found one hit inside a code comment.
 * The same panel is also the only place the game explains its own vocabulary:
 * the first roll a newcomer ever sees contains three numbers, and none of
 * them was defined anywhere in the product.
 */
export function AboutRulesPanel({ onClose }: { onClose?: () => void }) {
  return (
    <Panel>
      <h3 className="cui-subheading">About the rules</h3>
      {/* This used to say "real Dungeons & Dragons 5th edition rules", three
          paragraphs above "not affiliated with, endorsed by, or sponsored by
          Wizards of the Coast". CC BY 4.0 licenses the SRD text's copyright,
          not the D&D trademark, which is why every other string in this block
          says "System Reference Document 5.1" -- and the two sentences plainly
          contradicted each other for anybody reading top to bottom. */}
      <p className="cui-muted">
        The dice, the numbers and the outcomes in this game are the real SRD 5.1 tabletop rules, resolved by this app
        rather than by the dungeon master. The dungeon master decides what happens in the story; it never decides
        whether you hit.
      </p>

      <h4 className="cui-subheading lt-about-heading">The words on screen</h4>
      <dl className="lt-glossary">
        {GLOSSARY.map((entry) => (
          <div key={entry.term} className="lt-glossary-row">
            <dt>{entry.term}</dt>
            <dd className="cui-muted">{entry.short}</dd>
          </div>
        ))}
      </dl>

      <h4 className="cui-subheading lt-about-heading">Credit and licence</h4>
      <p className="cui-muted lt-srd-notice">{SRD_ATTRIBUTION.creator}</p>
      <p className="cui-muted lt-srd-notice">{SRD_ATTRIBUTION.copyright}</p>
      <p className="cui-muted lt-srd-notice">
        {SRD_ATTRIBUTION.license}{" "}
        <a href={SRD_ATTRIBUTION.licenseUrl} target="_blank" rel="noreferrer noopener">
          {SRD_ATTRIBUTION.licenseUrl}
        </a>
      </p>
      <p className="cui-muted lt-srd-notice">{SRD_ATTRIBUTION.modified}</p>
      <p className="cui-muted lt-srd-notice">{SRD_ATTRIBUTION.disclaimer}</p>

      {onClose && (
        <button type="button" className="cui-button cui-button--ghost" onClick={onClose}>
          Close
        </button>
      )}
    </Panel>
  );
}

/**
 * A number on screen, with its one-sentence explanation one tap away.
 *
 * The four explanations this game had were all HTML `title` attributes, which
 * a touch device cannot reach at all, on a panel that defaulted to hidden.
 * ConjureOS serves this app from a mobile host, so "hover to learn what AC
 * means" is the same as not explaining it. This is a real button with a real
 * popover, so it works identically with a mouse and a thumb; `title` stays on
 * it as well, for the desktop reader who does hover.
 */
function Explain({ term, children }: { term: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const text = explain(term);
  if (!text) return <>{children}</>;
  return (
    <span className="lt-explainable">
      <button
        type="button"
        className="lt-explain"
        title={text}
        aria-expanded={open}
        aria-label={`${term}: what does this mean?`}
        onClick={() => setOpen((o) => !o)}
      >
        {children}
        <span className="lt-explain-mark" aria-hidden>
          ?
        </span>
      </button>
      {open && (
        <span className="lt-popover" role="note">
          {text}
        </span>
      )}
    </span>
  );
}

// ── campaign list ────────────────────────────────────────────────────────

function CampaignListScreen({
  onExit,
  onOpen,
  onNew,
}: {
  onExit: () => void;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAbout, setShowAbout] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.ltCampaignList();
        if (!cancelled) setCampaigns(res.campaigns);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ErrorNote message={error} onBack={onExit} />;
  if (!campaigns) return <Busy label="Gathering your campaigns..." />;

  return (
    <div className="screen livingtable">
      <GameHeader
        title="The Living Table"
        subtitle={GAME_TAGLINE}
        onExit={onExit}
      />
      <div className="lt-campaign-grid">
        {campaigns.map((c) => (
          <button key={c.id} type="button" className="cui-card cui-card--interactive lt-campaign-card" onClick={() => onOpen(c.id)}>
            <strong>{c.title}</strong>
            <span className="cui-pill cui-pill--plain">{c.template === "fantasy" ? "Fantasy" : "Sci-fi"}</span>
            <span className="cui-muted">{c.status}</span>
          </button>
        ))}
        {/* No CostBadge here on purpose. Opening this card charges nothing --
            it navigates to a screen whose own button wears the price -- and a
            badge on the card PLUS a badge on that button made one judge count
            three charges to reach the first sentence of story and start
            counting instead of playing. The flow's real total goes in words
            instead, which is the thing a badge could not say. */}
        <button type="button" className="cui-card cui-card--interactive lt-campaign-card lt-new-card" onClick={onNew}>
          <strong>New campaign</strong>
          <span className="cui-muted">{NEW_CAMPAIGN_BLURB}</span>
        </button>
      </div>
      <button type="button" className="cui-button cui-button--ghost lt-about-link" onClick={() => setShowAbout((s) => !s)}>
        {showAbout ? "Hide the rules" : "New to this? About the rules"}
      </button>
      {showAbout && <AboutRulesPanel onClose={() => setShowAbout(false)} />}
    </div>
  );
}

// ── new campaign ─────────────────────────────────────────────────────────

function NewCampaignScreen({ onExit, onCreated }: { onExit: () => void; onCreated: (id: string) => void }) {
  const [template, setTemplate] = useState<TemplateGenre>("fantasy");
  const [theme, setTheme] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const made = await generateCampaignArc(template, theme.trim() || undefined);
      const res = await api.ltCampaignCreate(template, made.title, made.arcOutline);
      onCreated(res.campaign.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  if (busy) {
    return <Busy label="Planning the campaign..." sub={CAMPAIGN_PLANNING_SUB} />;
  }

  return (
    <div className="screen livingtable">
      <GameHeader title="New campaign" onExit={onExit} />
      {error && <p className="flash">{error}</p>}
      <div className="lt-template-row">
        <button
          type="button"
          className={`cui-card cui-card--interactive lt-template-card${template === "fantasy" ? " active" : ""}`}
          onClick={() => setTemplate("fantasy")}
        >
          <strong>Fantasy</strong>
          {/* The old blurb promised "someone who will absolutely learn Fireball
              eventually", which this build's level-3 ceiling forbids: Fireball
              needs a 3rd-level slot and a full caster gets one at character
              level 5. Promising a spell the game structurally cannot reach is
              worse than not mentioning it.

              SAME STANDARD, SECOND CATCH (issue #16). "A knight, a shadow, a
              healer, and a wizard" is a PARTY ROSTER, and this build hands the
              player exactly one character: createCharacter is called once, and
              the sheet, the HP bar and the player's token are all singular.
              Companions are not a thing the player recruits or controls. So
              the list is a CHOICE now, joined by "or" rather than "and",
              which is what the next screen actually offers. The
              archetype blurbs underneath were fixed for this same defect
              already, and "no archetype blurb sells a party this game never
              shows" is the test that has guarded them since. */}
          <p className="cui-muted">
            Swords, spells, dungeons. You play one of three: a knight, a shadow, or a wizard whose fire starts as a
            single bolt and grows from there.
          </p>
        </button>
        {/* Sci-fi is paused (templates.ts PLAYABLE_TEMPLATES), so its card is
            not offered; the template itself still loads. */}
        {PLAYABLE_TEMPLATES.includes("scifi") && (
          <button
            type="button"
            className={`cui-card cui-card--interactive lt-template-card${template === "scifi" ? " active" : ""}`}
            onClick={() => setTemplate("scifi")}
          >
            <strong>Sci-fi</strong>
            <p className="cui-muted">
              Starships, psionics, ray weapons. You play one of four: a trooper, an infiltrator, a medic, or a mind that
              bends other minds.
            </p>
          </button>
        )}
      </div>
      <input
        className="cui-input"
        placeholder="Optional: what should this campaign be about?"
        value={theme}
        maxLength={160}
        onChange={(e) => setTheme(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void generate();
        }}
      />
      <button
        type="button"
        className="cui-button cui-button--primary"
        onClick={() => void generate()}
        title={CREDIT_BUYS.planCampaign}
      >
        Plan this campaign <CostBadge n={1} />
      </button>
      <p className="cui-muted lt-price-note">{CREDIT_BUYS.planCampaign}</p>
    </div>
  );
}

// ── character creation ──────────────────────────────────────────────────

/**
 * Every launch archetype's default appearance is its own matching token
 * sprite in the manifest (scripts/assets/{fantasy,scifi}.ts's own naming
 * convention: `token_<archetypeId with "-" replaced by "_">`). At launch
 * scale there is exactly one sprite per archetype, so "pick an appearance
 * from the tile set" (DESIGN.md) resolves to confirming that one look
 * rather than choosing among several -- a real multi-skin picker is future
 * content once more than one sprite per archetype exists, not an
 * architecture gap this pass should invent a fake choice to paper over.
 */
function defaultAppearanceAssetId(archetypeId: string): string {
  return `token_${archetypeId.replace(/-/g, "_")}`;
}

function CreateCharacterScreen({
  campaign,
  onExit,
  onCreated,
}: {
  campaign: CampaignDetail;
  onExit: () => void;
  onCreated: (characterId: string) => void;
}) {
  // Only what can be started today (templates.ts PLAYABLE_ARCHETYPE_IDS): the Healer is out of play.
  const archetypes = useMemo(() => playableArchetypes(campaign.template), [campaign.template]);
  const [archetypeId, setArchetypeId] = useState(archetypes[0]?.id ?? "");
  const [name, setName] = useState("");
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const archetype = archetypes.find((a) => a.id === archetypeId) ?? archetypes[0];
  const creationChoices = useMemo(() => (archetype ? creationChoicesFor(archetype.id) : []), [archetype]);

  if (!archetype) return <ErrorNote message="This template has no archetypes defined." onBack={onExit} />;

  const create = async () => {
    if (!name.trim()) {
      setError("Give them a name first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sheet = createCharacter({
        archetypeId: archetype.id,
        name: name.trim(),
        appearanceAssetId: defaultAppearanceAssetId(archetype.id),
        choices,
      });
      const state: CharacterState = { sheet, position: { cx: 0, cy: 0 } };
      const res = await api.ltCharacterCreate({
        campaignId: campaign.id,
        name: sheet.name,
        archetype: sheet.archetypeId,
        kind: "player",
        appearance: { assetId: sheet.appearanceAssetId },
        stats: statsFromCharacterState(state),
      });
      onCreated(res.character.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  // "Rolling up your character..." made a cold reader think the game was
  // randomising their stats behind the loading screen: "I braced for a stat
  // block I didn't choose and started thinking about whether I could reroll
  // it." Nothing here is random; createCharacter is a pure function over a
  // fixed standard array per archetype.
  if (busy) return <Busy label={CREATION_BUSY_LABEL} />;

  return (
    <div className="screen livingtable">
      <GameHeader title="Who are you?" subtitle={campaign.title} onExit={onExit} />
      {error && <p className="flash">{error}</p>}
      <div className="lt-archetype-row">
        {archetypes.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`cui-card cui-card--interactive lt-archetype-card${a.id === archetype.id ? " active" : ""}`}
            aria-pressed={a.id === archetype.id}
            onClick={() => {
              setArchetypeId(a.id);
              setChoices({});
            }}
          >
            <strong>{a.displayName}</strong>
            <p className="cui-muted">{a.kitDescription}</p>
            {/* The three drawn slots, named at the moment the player is
                choosing between eight of them. All common, so the line
                promises nothing mechanical and none is implied. */}
            <p className="cui-muted lt-archetype-gear">Carries: {startingGearNames(a.id).join(", ")}</p>
          </button>
        ))}
      </div>
      <input
        className="cui-input"
        placeholder="Their name"
        value={name}
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
      />
      {creationChoices.map((choice) => (
        <div key={choice.id} className="lt-choice">
          <p className="cui-muted">{choice.prompt}</p>
          <div className="lt-choice-options">
            {choice.options.map((opt, i) => {
              const picked = choices[choice.id] ? choices[choice.id] === opt.id : i === 0;
              return (
                <button
                  key={opt.id}
                  type="button"
                  // `lt-choice-picked` alone lost to @conjureos/ui's own
                  // `.cui-ui .cui-pill` border rule on specificity, so all
                  // three pills rendered byte-identical computed styles
                  // before and after a click: the choice looked broken
                  // because nothing visibly changed. See styles.css, where
                  // the picked rule now out-specifies the library's.
                  className={`cui-pill cui-pill--plain lt-choice-option${picked ? " lt-choice-picked" : ""}`}
                  aria-pressed={picked}
                  onClick={() => setChoices((c) => ({ ...c, [choice.id]: opt.id }))}
                >
                  {opt.label}: {opt.plain}
                  {/* An option the engine does not apply yet says so here
                      rather than reading like the ones it does. Nothing sets
                      this today (all three fighting styles are wired), and
                      that is the point: the day one is added ahead of its
                      rules, the pill cannot quietly claim it is live. */}
                  {opt.notYet && <span className="lt-choice-notyet">{opt.notYet}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <button type="button" className="cui-button cui-button--primary" disabled={!name.trim()} onClick={() => void create()}>
        Begin
      </button>
    </div>
  );
}

// ── play: loading shell ─────────────────────────────────────────────────

export interface PlayInitialState {
  character: CharacterState;
  manifest: LoadedManifest;
  cells: LoadedCell[];
  workingMemory: WorkingMemoryState;
  story: StoryEntry[];
  sceneSeq: number;
}

async function loadCellsAround(campaignId: string, center: CellCoord): Promise<LoadedCell[]> {
  const coords: CellCoord[] = [center, ...ALL_DIRECTIONS.map((dir) => neighbourCell(center, dir))];
  const results = await Promise.all(coords.map((c) => api.ltCellGet(campaignId, c.cx, c.cy)));
  const cells: LoadedCell[] = [];
  results.forEach((res, i) => {
    if (res.cell) cells.push({ cx: coords[i]!.cx, cy: coords[i]!.cy, layout: res.cell.layout as CellLayout });
  });
  return cells;
}

function PlayScreen({
  campaign,
  characterId,
  onExit,
  onNewCharacter,
}: {
  campaign: CampaignDetail;
  characterId: string;
  onExit: () => void;
  onNewCharacter: () => void;
}) {
  const [initial, setInitial] = useState<PlayInitialState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [campaignRes, manifest] = await Promise.all([api.ltCampaignGet(campaign.id), loadManifest(campaign.template)]);
        const row = campaignRes.characters.find((c) => c.id === characterId);
        if (!row) throw new Error("That character could not be found in this campaign.");
        const loaded = characterStateFromStats(row.stats);
        // A campaign started before death saves, hit dice or milestones
        // existed comes back missing those fields; normalizeSheet fills them
        // rather than letting a tracker render against undefined.
        const character: CharacterState = { ...loaded, sheet: normalizeSheet(loaded.sheet) };
        const cells = await loadCellsAround(campaign.id, character.position);
        const workingMemory: WorkingMemoryState = {
          log: dedupeLog(campaignRes.log),
          facts: campaignRes.facts.map((f) => ({ category: f.category, key: f.key, fact: f.fact, status: f.status })),
        };
        const story = storyFromMemoryLog(campaignRes.log);
        const sceneSeq = workingMemory.log.reduce((max, e) => Math.max(max, e.sceneSeq), -1) + 1;
        if (!cancelled) setInitial({ character, manifest, cells, workingMemory, story, sceneSeq });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaign.id, campaign.template, characterId]);

  if (error) return <ErrorNote message={error} onBack={onExit} />;
  if (!initial) return <Busy label="Opening your campaign..." />;

  return (
    <PlaySession campaign={campaign} characterId={characterId} initial={initial} onExit={onExit} onNewCharacter={onNewCharacter} />
  );
}

// ── play: the running session ───────────────────────────────────────────

// The other side's turns, and the two view types they hand back, live in
// session/ now: they are pure, and a bench or a test can run them without this
// screen's React tree. Re-exported under the names this file has always had so
// every import written against it still resolves.
export { resolveMonsterTurn, runHostileTurns } from "./session/hostileTurns";
export type { MonsterTurnOutcome } from "./session/hostileTurns";
export type { DiceLogEntry, ReadoutView } from "./session/combatEvents";

/**
 * The five-second popup over the board: the whole d20 formula, in words, on
 * the thing a player is actually looking at.
 *
 * It renders the BREAKDOWN as well as the lump. `RollReadout.sources` has
 * carried "+3 Dexterity and training, +2 Keen Longsword" since the bonus
 * sources landed, `attackResultToReadout` copies it through, and both call
 * sites compute it once and hand the same array to this overlay and to the
 * dice log, precisely "so the overlay never shows an unexplained lump beside a
 * dice log that names every part of it" -- and then nothing here ever read the
 * field, so the overlay showed exactly that lump. A newcomer's first roll
 * contains three numbers nobody has defined for them, and the popup is where
 * they see them.
 *
 * `bonusSources` guarantees the parts sum to `modifier` and refuses the whole
 * breakdown otherwise, so this component may print them without checking:
 * there is no arrangement in which the parts on screen disagree with the
 * bonus above them.
 *
 * Its own component (rather than JSX inline in the play screen) so a test can
 * render it with a readout and read what a player would see, which is the only
 * way this regression was ever going to be caught.
 */
export function RollReadoutOverlay({ readout }: { readout: ReadoutView }) {
  return (
    <div className="lt-readout" role="status">
      <span className="lt-readout-caption">{readout.caption}</span>
      <span className="lt-readout-math">
        <span className="lt-readout-part">
          <b>{readout.roll}</b> your roll
        </span>
        <span className="lt-readout-part">
          <b>
            {readout.modifier >= 0 ? "+" : ""}
            {readout.modifier}
          </b>{" "}
          your bonus
        </span>
        <span className="lt-readout-part">
          <b>{readout.total}</b> total
        </span>
        <span className="lt-readout-part">
          <b>{readout.target}</b> you needed
        </span>
      </span>
      {readout.sources && readout.sources.length > 0 && (
        <span className="lt-readout-sources">
          {readout.sources.map((source, i) => (
            <span key={i} className="lt-readout-source">
              {source.amount >= 0 ? "+" : ""}
              {source.amount} {source.label}
            </span>
          ))}
        </span>
      )}
      <span className={`lt-readout-verdict${readout.hit ? " hit" : " miss"}${readout.critical ? " crit" : ""}`}>
        {/* NATURAL 1 used to print alone here while its sibling read
            "NATURAL 20, CRITICAL HIT". A cold reader: "I assumed it
            was bad, because 1 is a small number, but I genuinely
            paused, because in plenty of games rolling a 1 means you
            came first." Only the side log said "an automatic miss";
            the five-second popup, the thing a player is actually
            looking at, did not. */}
        {readout.critical
          ? "NATURAL 20, CRITICAL HIT"
          : readout.fumble
            ? "NATURAL 1, AUTOMATIC MISS"
            : readout.hit
              ? "HIT"
              : "MISS"}
      </span>
    </div>
  );
}

/**
 * The loot popup: same `.lt-readout` family as a roll, beside it in the same
 * DOM overlay (equipmentTypes.ts, "WHERE THE DICE READOUT NAMES THE
 * SOURCE"). Built from `render/rollReadoutAdapter.ts`'s `lootRollToReadout`,
 * the render lane's one path from a `LootRoll` to a `LootReadout`.
 */
export function LootReadoutOverlay({ readout }: { readout: LootReadout }) {
  return (
    <div className="lt-readout lt-loot-readout" role="status">
      <span className="lt-readout-caption">{readout.caption}</span>
      <span className="lt-readout-math">
        <span className="lt-readout-part">
          <b>{readout.tierRoll}</b> d100
        </span>
        <span className="lt-readout-part">
          <b>{readout.tierWord}</b> rank
        </span>
        {readout.slotRoll !== null && (
          <span className="lt-readout-part">
            <b>{readout.slotRoll}</b> d{readout.slotDie}
          </span>
        )}
      </span>
      <span className={`lt-readout-verdict${readout.tierWord !== "Nothing" && readout.verdict !== "Nothing new" ? " hit" : ""}`}>
        {readout.verdict}
      </span>
    </div>
  );
}

const STEP_DELTA: Record<Edge, { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 },
  S: { dx: 0, dy: 1 },
  E: { dx: 1, dy: 0 },
  W: { dx: -1, dy: 0 },
};

function entryPointFor(dir: Edge, from: { x: number; y: number }): { x: number; y: number } {
  const along = dir === "N" || dir === "S" ? from.x : from.y;
  return edgeCoord(oppositeEdge(dir), along);
}

/**
 * The story line a SUCCESSFUL search tells. A cell assembled before
 * validatePlacedProp learned to reject a magic item named inside `onFound`
 * can still say "You find the Boots of Speed." The engine's loot roll is the
 * only thing that decides what turns up, so a line naming a magic item is
 * swapped for the same neutral sentence a prop with no onFound gets, rather
 * than told as if it were true. multiWordOnly for the same reason
 * turnSchema.ts uses it on this field: it is free prose, not a name field.
 */
export function searchFoundLine(onFound: string | undefined, the: string): string {
  if (onFound && !findMagicGearNameIn(onFound, { multiWordOnly: true })) return onFound;
  return `Something about ${the} looks disturbed.`;
}

/**
 * What a successful search may pocket from a prop's `grantsItem`, or null.
 * Defence in depth (equipmentTypes.ts section 11.7, rule 3): a magic gear name
 * in `grantsItem` is rejected at the source by validatePlacedProp (dm lane),
 * but a cell assembled before that rule landed can still carry one. A magic
 * name is silently DROPPED rather than pocketed, never turned into typed gear:
 * only a LootRoll ever writes `bag`. The exact match alone is dodged by any
 * wrapped variant ("a Ring of Protection", "Dawnbreaker."), so this also runs
 * the containment match validatePlacedProp uses on this field (the full name
 * list, since grantsItem is a name, not prose).
 */
export function pocketableGrant(grantsItem: string | undefined): string | null {
  if (!grantsItem) return null;
  if (isMagicGearName(grantsItem) || findMagicGearNameIn(grantsItem)) return null;
  return grantsItem;
}

/**
 * Where the party's token goes when it appears in a cell nobody placed it in.
 *
 * This used to be a scan from (0,0) that took the first walkable tile it
 * found, which on a typical room layout (row 0 all wall except a doorway) put
 * the player IN the north doorway, on the cell boundary, outside the room and
 * several tiles from whatever the narration said was in front of them. It also
 * meant exactly one of the four Move arrows crossed into fog, so exactly one
 * arrow wore a price badge with nothing on screen explaining why.
 *
 * Preferring the walkable tile closest to the centre puts the party in the
 * room, which is both where a DM would place them and where all four
 * directions read the same way.
 */
export function centralWalkableTile(layout: CellLayout, manifest: AssetManifest): { x: number; y: number } | null {
  const cx = (CELL_WIDTH - 1) / 2;
  const cy = (CELL_HEIGHT - 1) / 2;
  let best: { x: number; y: number } | null = null;
  let bestScore = Infinity;
  const occupied = new Set(layout.tokens.map((t) => `${t.x},${t.y}`));
  for (let y = 0; y < CELL_HEIGHT; y++) {
    for (let x = 0; x < CELL_WIDTH; x++) {
      const id = layout.tiles[y]?.[x];
      if (!id || !manifest.tiles[id]?.walkable) continue;
      if (occupied.has(`${x},${y}`)) continue;
      const score = Math.abs(x - cx) + Math.abs(y - cy);
      if (score < bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
}

/**
 * The free tile closest to `near`, or null when the room has none.
 *
 * Exists because a doorway is exactly the tile most likely to be taken. The
 * world engine now refuses to place a token on an occupied square or one
 * holding a blocking prop, which is correct SRD behaviour, but it means one
 * monster (or one closed door) parked on the mirrored entry tile refuses the
 * whole crossing. That turns a new rule into a soft-locked doorway, which is
 * a bad way to learn it. Falling back to the nearest legal tile keeps the
 * rule ("you cannot stand where something already is") while letting the
 * party through, and `tileFreeFor` is the same predicate placeToken itself
 * checks, so a tile this picks is never one placeToken then rejects.
 *
 * Proximity to the doorway rather than to the room's centre on purpose:
 * stepping through a door should put you just inside it.
 */
export function nearestFreeTile(
  layout: CellLayout,
  manifest: AssetManifest,
  near: { x: number; y: number },
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestScore = Infinity;
  for (let y = 0; y < CELL_HEIGHT; y++) {
    for (let x = 0; x < CELL_WIDTH; x++) {
      if (!tileFreeFor(layout, manifest, x, y)) continue;
      const score = Math.abs(x - near.x) + Math.abs(y - near.y);
      if (score < bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
}

/**
 * A plain room the ENGINE builds when a paid DM turn failed to build the one
 * the player walked into.
 *
 * The failure is real and reproducible: pressing a Move arrow that wore a
 * price badge spent a credit, appended a room paragraph to the story, and
 * left the party in the same cell with a note telling them to try again. Three
 * presses, three credits, three identical paragraphs, no room. The prompt-side
 * cause belongs to the DM lane; the recovery belongs here, and it must not be
 * "spend another credit", because this repo's cost model says outright that
 * credits never buy "finish what you started."
 *
 * So the engine finishes it. This is the same principle world/connectivity.ts
 * already applies when a DM's layout forgets its return exit: the engine
 * guarantees the structure and lets the model own the fiction. The room is
 * deliberately plain -- a walled box with a doorway back the way you came --
 * and the DM is told, as an engine note, that it now has to describe a room it
 * did not build.
 */
export function fallbackRoomLayout(
  manifest: AssetManifest,
  from: CellCoord,
  dir: Edge,
  standingAt: { x: number; y: number },
): CellLayout | null {
  const tileIds = Object.keys(manifest.tiles);
  const floor = tileIds.find((id) => manifest.tiles[id]?.walkable === true);
  const wall = tileIds.find((id) => manifest.tiles[id]?.walkable === false);
  if (!floor || !wall) return null;

  const tiles: string[][] = Array.from({ length: CELL_HEIGHT }, (_, y) =>
    Array.from({ length: CELL_WIDTH }, (_, x) =>
      x === 0 || y === 0 || x === CELL_WIDTH - 1 || y === CELL_HEIGHT - 1 ? wall : floor,
    ),
  );

  // The doorway back sits directly opposite the tile the party is standing on,
  // which means the exit this layout stakes onto the cell they came FROM lands
  // exactly on that same tile -- necessarily walkable, since somebody is
  // standing on it. That is what keeps assembleCell's neighbour patch valid.
  const back = entryPointFor(dir, standingAt);
  tiles[back.y]![back.x] = floor;

  return {
    tiles,
    props: [],
    tokens: [],
    exits: [{ at: back, edge: oppositeEdge(dir), toCell: from }],
  };
}

/**
 * Where a player's attack bonus came from, in words, for the roll line.
 *
 * The +5 in "rolled 9, +5 = 14" was an unexplained lump, and a newcomer's
 * first roll contains three numbers nobody has defined for them. These are
 * its parts. `bonusSources` drops the ones worth 0 (a common piece of gear
 * contributed nothing and must not be listed) and refuses the whole
 * breakdown unless it sums to the modifier that was actually rolled, so a
 * readout can never claim a bonus the engine did not roll.
 *
 * One function for both call sites, because the local Attack button and a
 * DM-requested attack resolve the same modifier and must not describe it two
 * different ways.
 */
function attackReadoutSources(sheet: CharacterSheet, modifier: number): readonly BonusSource[] | undefined {
  return bonusSources(attackBonusSourcesFor(sheet), modifier);
}

/**
 * The same, for a saving throw the PLAYER rolls. A monster's save modifier
 * comes out of a statblock in one piece, so there are no parts to name.
 */
function saveReadoutSources(sheet: CharacterSheet, ability: keyof AbilityScores, modifier: number): readonly BonusSource[] | undefined {
  return bonusSources(saveBonusSourcesFor(sheet, ability), modifier);
}

/**
 * The same, for a skill check the PLAYER rolls (contract v2: a worn Stone of
 * Good Luck adds to every check, so a check modifier can now have two parts).
 * `bonusSources` drops a single-part breakdown, so a check with no gear in it
 * prints the byte-identical line it always did.
 */
function checkReadoutSources(sheet: CharacterSheet, skill: string, modifier: number): readonly BonusSource[] | undefined {
  return bonusSources(checkBonusSourcesFor(sheet, skill), modifier);
}

/**
 * Resolve one DM turn's `rollRequests`, against the same board and the same
 * combat round the local buttons act on.
 *
 * Extracted out of `sendToDm` and made pure for two reasons, both of which
 * were live defects rather than tidiness.
 *
 * ONE, a hit on a monster did nothing. `if (result.hit && targetIsPlayer)`
 * was the only damage branch, so a DM-requested attack that rolled a natural
 * 20 against a 13 HP skeleton logged "needed 13 to hit" and left the Attack
 * button still reading "(13 hit points left)". The engine held hit points for
 * that creature and never consulted them, and the next turn could then cite
 * that same roll id in a `removeToken` reason "combat" and delete a creature
 * at full health. Two blind table judges caught the same defect class in a
 * session log without seeing any code: "The narrative remembered the fire;
 * the math did not." Damage is now symmetric: whoever gets hit takes it.
 *
 * TWO, this path acted outside the round entirely. It never read or wrote
 * `round`, so one Talk carrying a DM-requested attack by the player gave them
 * a second action in a round the pill already showed as spent, and a hostile
 * could swing while the pill read "Your turn, action ready". One economy per
 * combatant per round, shared by both paths, is the rule; `dmActionBlockedReason`
 * is the same two checks the Attack button already refuses the player with,
 * said to the model instead.
 */
export interface DmRollOutcome {
  world: World;
  sheet: CharacterSheet;
  round: CombatRound | null;
  resolved: ResolvedRoll[];
  dice: DiceLogEntry[];
  story: StoryEntry[];
  readout: ReadoutView | null;
  /** Requests the engine refused, in words, to hand back to the DM as its own next-turn context. */
  refusals: string[];
}

export function resolveDmRollRequests(args: {
  requests: readonly RollRequest[];
  world: World;
  cell: CellCoord;
  playerTokenId: string;
  sheet: CharacterSheet;
  round: CombatRound | null;
  namer: TokenNamer;
  rng?: () => number;
}): DmRollOutcome {
  const rng = args.rng ?? Math.random;
  const label = (id: string) => tokenLabel(id, args.namer);
  const { cx, cy } = args.cell;

  let world = args.world;
  let sheet = args.sheet;
  let round = args.round;
  const resolved: ResolvedRoll[] = [];
  const dice: DiceLogEntry[] = [];
  const story: StoryEntry[] = [];
  const refusals: string[] = [];
  let readout: ReadoutView | null = null;

  const tokenAsset = (id: string): string | null => getCell(world, args.cell)?.tokens.find((t) => t.id === id)?.assetId ?? null;

  for (const request of args.requests) {
    const isPlayer = request.by === args.playerTokenId;
    const modifier = modifierForRollRequest(request, isPlayer ? sheet : null, tokenAsset(request.by));

    if (request.kind === "attack") {
      const blocked = dmActionBlockedReason(round, request.by, label(request.by));
      if (blocked) {
        refusals.push(`that attack was not rolled: ${blocked}. Wait for that combatant's own turn.`);
        continue;
      }
      if (round) round = spendCombatantAction(round, request.by) ?? round;

      const targetIsPlayer = request.against === args.playerTokenId;
      const targetAC = defenderACForRollRequest(request, targetIsPlayer ? sheet : null, tokenAsset(request.against));
      // The player's own crit range, when they are the one swinging. A
      // monster rolls on the SRD default; nothing in the launch statblocks
      // widens it.
      const result = resolveAttack({ attackerBonus: modifier, targetAC, criticalOn: isPlayer ? criticalOnFor(sheet) : undefined, rng });
      resolved.push({ id: request.id, kind: "attack", by: request.by, against: request.against, ...result });

      let damage: number | undefined;
      let targetDown = false;
      let targetHpLeft: number | undefined;
      if (result.hit) {
        // The attacker's own damage die, whichever side of the table they are
        // on: the player's weapon when the DM asked THEM to swing, the
        // creature's statblock otherwise.
        const notation = isPlayer ? weaponDamageNotationFor(sheet) : monsterDamageNotationFor(tokenAsset(request.by));
        damage = resolveDamage(notation, rng, result.critical).total;
        // A legendary weapon's rider (contract v2), on the SAME path the
        // local Attack button already rolls it on (handleAttack, above):
        // without this, a DM-requested swing (any Talk turn the model reads
        // as an attack) skipped Dawnbreaker's extra radiant die entirely,
        // so the same sword did different damage depending on which button
        // triggered the hit.
        if (isPlayer) {
          const rider = legendaryRiderDamageFor(sheet, rng, result.critical);
          if (rider) {
            damage += rider.roll.total;
            const riderLine = `${rider.source}: ${rider.roll.total} ${rider.damageType} damage (${rider.roll.notation})`;
            dice.push({ text: riderLine, hit: true });
            story.push({ role: "engine", text: riderLine });
          }
        }

        if (targetIsPlayer) {
          const outcome = applyDamage(sheet, damage, result.critical);
          sheet = outcome.sheet;
          story.push({ role: "engine", text: outcome.note });
        } else {
          const target = getCell(world, args.cell)?.tokens.find((t) => t.id === request.against);
          if (target) {
            const hurt = damageMonster(target, damage);
            targetDown = hurt.down;
            targetHpLeft = hurt.currentHp;
            if (hurt.down) {
              // The ENGINE takes it off the board when it drops, which is
              // what makes a later removeToken reason "combat" redundant
              // rather than load-bearing.
              const removed = removeToken(world, cx, cy, request.against);
              if (removed.ok) world = removed.world;
              if (round) round = dropCombatant(round, request.against);
            } else {
              const wounded = setTokenHp(world, cx, cy, request.against, hurt.currentHp);
              if (wounded.ok) world = wounded.world;
            }
          }
        }
      }

      // Computed once and given to BOTH the printed line and the floating
      // readout, so the overlay never shows an unexplained lump beside a dice
      // log that names every part of it.
      const attackSources = isPlayer ? attackReadoutSources(sheet, modifier) : undefined;
      dice.push({
        text: attackLine({
          // The same breakdown the local Attack button prints, from the same
          // helper, so one modifier is never described two ways.
          sources: attackSources,
          attacker: label(request.by),
          target: label(request.against),
          roll: result.roll,
          modifier,
          total: result.total,
          targetAC,
          hit: result.hit,
          critical: result.critical,
          fumble: result.fumble,
          damage,
          targetDown,
          // A hit on the player is reported through health.ts's own note
          // above, so the line does not double up on hit points.
          targetHpLeft: targetIsPlayer ? undefined : targetHpLeft,
        }),
        hit: result.hit,
      });
      readout = {
        ...attackResultToReadout(result, modifier, targetAC, attackSources),
        critical: result.critical,
        fumble: result.fumble,
        caption: `${label(request.by)} attacks ${label(request.against)}`,
      };
    } else if (request.kind === "save") {
      const dc = dcForRollRequest(request);
      // `rolled` is the die as it landed; `result` is the OUTCOME, which a
      // worn, attuned Ring of Evasion can turn from a failed Dexterity save
      // into a success by spending one charge (contract v2). The outcome is
      // what the DM is told and what gates `damageOnFailure` below, so a
      // rescued save skips the damage too: SRD 5.1's evasion means the hazard
      // did not land, not "it landed for zero". The dice line keeps the die.
      const rolled = resolveSavingThrow({ modifier, dc, rng });
      let result = rolled;
      let evasionNote: string | null = null;
      let rescuedBy: string | null = null;
      if (isPlayer) {
        const rescue = evasionRescue(sheet, request.ability, rolled);
        if (rescue) {
          rescuedBy = accessoryStatus(sheet, "ring").name;
          sheet = rescue.sheet;
          result = rescue.result;
          evasionNote = rescue.note;
        }
      }
      resolved.push({ id: request.id, kind: "save", by: request.by, ...result });

      // A failed save now costs what the DM said it costs. `damage` is dice,
      // bounded and validated in dm/turnSchema.ts; the engine rolls them, the
      // model never supplies a total. Applied to whoever rolled, on the same
      // two paths an attack's damage takes, so a hazard hurts a monster and
      // the player identically. Absent damage means the consequence is the
      // narration's, which is right for a save against being tripped.
      let saveDamage: number | undefined;
      let saveTargetDown = false;
      let saveHpLeft: number | undefined;
      if (!result.success && request.damageOnFailure) {
        saveDamage = resolveDamage(request.damageOnFailure, rng).total;
        if (isPlayer) {
          const outcome = applyDamage(sheet, saveDamage, false);
          sheet = outcome.sheet;
          story.push({ role: "engine", text: outcome.note });
        } else {
          const victim = getCell(world, args.cell)?.tokens.find((t) => t.id === request.by);
          if (victim) {
            const hurt = damageMonster(victim, saveDamage);
            saveTargetDown = hurt.down;
            saveHpLeft = hurt.currentHp;
            if (hurt.down) {
              const removed = removeToken(world, cx, cy, request.by);
              if (removed.ok) world = removed.world;
              if (round) round = dropCombatant(round, request.by);
            } else {
              const wounded = setTokenHp(world, cx, cy, request.by, hurt.currentHp);
              if (wounded.ok) world = wounded.world;
            }
          }
        }
      }

      const saveSources = isPlayer ? saveReadoutSources(sheet, request.ability, modifier) : undefined;
      dice.push({
        text: checkLine({
          roller: label(request.by),
          what: saveName(request.ability),
          roll: rolled.roll,
          modifier,
          total: rolled.total,
          dc,
          // The die as it landed: a rescued save still prints FAIL here, and
          // the ring's own line follows it (pinned: "a second line after the
          // failed save's own line").
          success: rolled.success,
          sources: saveSources,
          // What the save was against, and now what failing it cost. Through
          // humanizeEngineError because `reason` is model text and could name
          // a token by its id. A hit on the player is reported through
          // health.ts's own note above, so the line does not double up on hit
          // points there.
          effect: rolled.success || evasionNote
            ? undefined
            : saveDamage === undefined
              ? humanizeEngineError(request.reason, args.namer)
              : `${humanizeEngineError(request.reason, args.namer)}, ${saveDamage} damage${
                  saveTargetDown ? `, and ${label(request.by)} is down` : !isPlayer && saveHpLeft !== undefined ? `, ${hitPoints(saveHpLeft)} left` : ""
                }`,
        }),
        hit: rolled.success,
      });
      // Pinned as a SECOND line after the save's own, never folded into it:
      // the save line is the die as it actually landed (a failure), and the
      // rescue is a separate, named event on top of it.
      if (evasionNote) dice.push({ text: evasionNote, hit: true });
      readout = {
        ...checkResultToReadout(result, modifier, dc, saveSources),
        caption: `${label(request.by)}, ${saveName(request.ability)}${rescuedBy ? `, turned by ${rescuedBy}` : ""}`,
      };
    } else {
      const dc = dcForRollRequest(request);
      // Contract v2: Boots of Elvenkind grant advantage on the matching
      // skill. Named in the line (`advantageFrom`) rather than a bare "with
      // advantage", the same reasoning `sources` already gets: a player who
      // never noticed the boots can still connect the line to the item.
      const advantageFrom = isPlayer ? checkAdvantageFor(sheet, request.skill) : null;
      const result = resolveSkillCheck({ modifier, dc, advantage: Boolean(advantageFrom), rng });
      resolved.push({ id: request.id, kind: "check", by: request.by, ...result });
      const checkSources = isPlayer ? checkReadoutSources(sheet, request.skill, modifier) : undefined;
      dice.push({
        text: checkLine({
          roller: label(request.by),
          what: request.skill,
          roll: result.roll,
          modifier,
          total: result.total,
          dc,
          success: result.success,
          sources: checkSources,
          advantageFrom: advantageFrom ?? undefined,
        }),
        hit: result.success,
      });
      readout = { ...checkResultToReadout(result, modifier, dc, checkSources), caption: `${label(request.by)}, ${request.skill}` };
    }
  }

  return { world, sheet, round, resolved, dice, story, readout, refusals };
}

/** Exported so a test can render the whole play surface and assert over the strings it actually produces (see test/livingtable-integration.test.ts). */
export function PlaySession({
  campaign,
  characterId,
  initial,
  onExit,
  onNewCharacter,
}: {
  campaign: CampaignDetail;
  characterId: string;
  initial: PlayInitialState;
  onExit: () => void;
  /** Start over with a new character in this same campaign. Free, and the only way out of a dead character that keeps the world and the DM's memory. */
  onNewCharacter: () => void;
}) {
  const manifest = initial.manifest;

  const [character, setCharacter] = useState<CharacterState>(initial.character);
  const [currentCell, setCurrentCell] = useState<CellCoord>(initial.character.position);
  const [levelUpPreview, setLevelUpPreview] = useState<LevelUpOutcome | null>(null);
  const [levelUpPick, setLevelUpPick] = useState<string | null>(null);
  const [knownCells, setKnownCells] = useState<Record<string, LoadedCell>>(() => {
    const map: Record<string, LoadedCell> = {};
    for (const c of initial.cells) map[`${c.cx},${c.cy}`] = c;
    return map;
  });
  const knownCellsRef = useRef(knownCells);
  useEffect(() => {
    knownCellsRef.current = knownCells;
  }, [knownCells]);

  const [workingMemory, setWorkingMemory] = useState<WorkingMemoryState>(initial.workingMemory);
  const [story, setStory] = useState<StoryEntry[]>(initial.story);
  const [sceneSeq, setSceneSeq] = useState(initial.sceneSeq);
  const [transcript, setTranscript] = useState<ChatMessage[]>([]);
  const [pendingRejections, setPendingRejections] = useState<string[]>([]);
  const [pendingResolvedRolls, setPendingResolvedRolls] = useState<ResolvedRoll[]>([]);
  const [pendingEngineNotes, setPendingEngineNotes] = useState<string[]>([]);
  // Monster hit points are NOT React state any more: they live on the token
  // itself (world/cell.ts's `currentHp`), which means they persist through
  // ltCellAssemble like every other cell mutation, survive a reload, and show
  // up in the playspace the DM reads. The record that used to sit here reset
  // every session and was invisible to the model.
  const [round, setRound] = useState<CombatRound | null>(null);
  const [menuHint, setMenuHint] = useState<CommandVerb[]>([]);

  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [saveTrouble, setSaveTrouble] = useState<string | null>(null);
  const [diceLog, setDiceLog] = useState<DiceLogEntry[]>([]);
  const [readout, setReadout] = useState<ReadoutView | null>(null);
  // A brand-new character's sheet is open by default: the tooltips explaining
  // HP, AC and the ability grid live on it, and a newcomer whose first session
  // starts with the panel collapsed never sees a single one of them.
  const [showSheet, setShowSheet] = useState(initial.story.length === 0);
  const [showAbout, setShowAbout] = useState(false);
  // The inventory screen's own staged draft (equipmentTypes.ts's
  // LoadoutDraft): null while closed, a snapshot of the sheet's gear while
  // open. Equip/Unequip only ever touch this; the board keeps drawing the
  // committed sheet until Ok.
  const [inventoryDraft, setInventoryDraft] = useState<LoadoutDraft | null>(null);
  const [inventorySelection, setInventorySelection] = useState<InventorySelection>(null);
  const [lootReadout, setLootReadout] = useState<LootReadout | null>(null);

  const world = useMemo(() => buildWorldFromCells(Object.values(knownCells)), [knownCells]);
  const sheet = character.sheet;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const playspace: Playspace | undefined = useMemo(
    () => getPlayspace(world, currentCell.cx, currentCell.cy, manifest.world),
    [world, currentCell, manifest.world],
  );
  const hints = useMemo(() => regionHints(campaign.arcOutline), [campaign.arcOutline]);
  const offscreen: OffscreenCells | undefined = useMemo(
    () => getOffscreenCells(world, currentCell.cx, currentCell.cy, hints),
    [world, currentCell, hints],
  );

  const namer: TokenNamer = useMemo(
    () => ({ playerTokenId: characterId, playerName: sheet.name, tokens: playspace?.tokens ?? [] }),
    [characterId, sheet.name, playspace],
  );
  const label = useCallback((id: string) => tokenLabel(id, namer), [namer]);

  // ── canvas sizing: an integer number of screen pixels per source pixel ──
  const [stageWidth, setStageWidth] = useState(0);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStageWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const scale = displayScale(stageWidth);
  const renderScale = SPRITE_SIZE * scale;
  const canvasWidth = CELL_WIDTH * renderScale;
  const canvasHeight = CELL_HEIGHT * renderScale;

  // The gear the player's own token is drawn wearing. Built from the character
  // sheet, never from the board: `PlacedToken` carries no equipment, because
  // anything on a token is persisted to `game_cells` and shown to the dungeon
  // master, and this is the one thing the model must never be able to reach.
  const tokenPlans = useMemo(() => renderPlansFor(characterId, sheet), [characterId, sheet]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const layout = getCell(world, currentCell);
    // The dice readout is a DOM overlay now, not painted into the backing
    // store: antialiased 14px text dragged through a nearest-neighbour
    // downscale was the least legible element on the least forgiving surface,
    // and it was the only alpha in an otherwise strictly indexed-colour
    // library. The canvas paints sprites; the DOM paints type.
    // The fifth argument seeds render/tileVariants.ts's per-coordinate scatter.
    // Without it every cell in the world gets the identical variant pattern, so a
    // corridor of same-material rooms repeats one field pixel for pixel and reads
    // as wallpaper rather than as ground. CellLayout does not carry its own
    // address, so the seed is mixed here, where the cell coordinate is in scope.
    // The multipliers are arbitrary odd constants; any stable per-cell integer works.
    const variantSeed = currentCell.cx * 73856093 + currentCell.cy * 19349663;
    if (layout) renderCell(ctx, layout, manifest.render, renderScale, variantSeed, tokenPlans);
  }, [world, currentCell, manifest.render, renderScale, tokenPlans]);

  useEffect(() => {
    if (!readout) return;
    const t = setTimeout(() => setReadout(null), 5000);
    return () => clearTimeout(t);
  }, [readout]);

  // The loot popup lives exactly as long as a roll's: it is shown like any
  // other die, and a find that never cleared would sit over the board forever.
  useEffect(() => {
    if (!lootReadout) return;
    const t = setTimeout(() => setLootReadout(null), 5000);
    return () => clearTimeout(t);
  }, [lootReadout]);

  // ── persistence: retried, and honest when it finally fails ─────────────

  const writes = useRef<WriteQueue | null>(null);
  if (!writes.current) writes.current = createWriteQueue(setSaveTrouble);
  const queue = writes.current;

  const persistCharacter = useCallback(
    (next: CharacterState) => {
      queue.submit("character", () => api.ltCharacterUpdate({ characterId, stats: statsFromCharacterState(next) }));
    },
    [characterId, queue],
  );

  const updateCharacter = useCallback(
    (next: CharacterState) => {
      setCharacter(next);
      persistCharacter(next);
    },
    [persistCharacter],
  );

  const updateSheet = useCallback(
    (nextSheet: CharacterSheet) => updateCharacter({ ...character, sheet: nextSheet }),
    [character, updateCharacter],
  );

  // ── gear ───────────────────────────────────────────────────────────────
  //
  // The tier picker's old feeds (`equipGear` through `equipItem`, and
  // `gearOptions`) are gone for good (issue #15): the inventory screen below
  // (openInventory, the staging handlers and handleInventoryOk) is the one
  // place gear changes, staged, and it commits through `commitLoadout`, which
  // only ever moves owned items. What has not changed: putting something on
  // is free and instant, no credit, no model call, no action spent, which is
  // why nothing on the gear rows or the inventory screen wears a CostBadge.

  // ── the two logs ───────────────────────────────────────────────────────

  const pushStory = useCallback((entries: StoryEntry[]) => {
    if (entries.length === 0) return;
    setStory((s) => [...s, ...entries]);
  }, []);

  const pushDice = useCallback((entries: DiceLogEntry[]) => {
    if (entries.length === 0) return;
    setDiceLog((log) => [...[...entries].reverse(), ...log].slice(0, 12));
  }, []);

  /**
   * Hand the engine's own account of a local action to the next DM turn.
   *
   * Every free action the player took used to be invisible to the DM: Attack,
   * Search and Item wrote to the dice log and to ephemeral state and nowhere
   * else, so after killing a goblin the DM's next prompt showed only that a
   * token had gone missing, with no record of who did it, how, or at what
   * cost. It could not react to a fight the player had just won, could not
   * notice they were at 2 hit points, and could not have the surviving goblin
   * flee because its friend died. These are local state only: no AI call, no
   * credit, no change to the cost model.
   */
  const noteToDm = useCallback((line: string) => {
    setPendingEngineNotes((notes) => [...notes, line]);
  }, []);

  const recordRolls = useCallback((rolls: ResolvedRoll[]) => {
    if (rolls.length === 0) return;
    setPendingResolvedRolls((prev) => [...prev, ...rolls]);
  }, []);

  // ── levelling ──────────────────────────────────────────────────────────

  const levelUpAvailable = canLevelUp(sheet, LAUNCH_MAX_LEVEL);

  /**
   * Record a milestone toward the next level, and say so when one is earned.
   *
   * The Level up button used to be permanently available, gated on nothing:
   * three presses in ten seconds took a character from level 1 to the cap
   * without leaving the first room. Now it appears only when the campaign has
   * actually produced something -- a fight won, a scene the DM built -- and
   * the moment it becomes available is announced in the story rather than
   * left for the player to notice a button changing state.
   */
  const earnMilestone = useCallback(
    (sheetNow: CharacterSheet, why: string): CharacterSheet => {
      // A fight won or a room built is also what turns the in-fiction day
      // over, which is what lets the party make camp again (health.ts's
      // longRestUsed). One rule, learned once: something has to happen
      // between one night's sleep and the next.
      const rested = newAdventuringDay(sheetNow);
      if (rested.level >= LAUNCH_MAX_LEVEL) return rested;
      const next = addMilestone(rested);
      const remaining = milestonesRemaining(next);
      pushStory([
        {
          role: "engine",
          text:
            remaining === 0
              ? `${why} That is enough to level up. Open your character sheet when you are ready.`
              : `${why} ${remaining} more like that and you will level up.`,
        },
      ]);
      return next;
    },
    [pushStory],
  );

  /**
   * Loot: wired at the two trigger sites the contract pins (the fight-won
   * site above, and handleSearch's success branch below). `lootFor`
   * (rules/loot.ts) rolls it; this just shows the die and the find the same
   * way every other roll in this game is shown, and tells the DM the one
   * fact it is allowed to narrate. `baseSheet` is passed in rather than read
   * off `sheet` so a milestone earned in the same breath (the fight-won
   * site) is not silently overwritten.
   */
  const applyLoot = useCallback(
    (baseSheet: CharacterSheet, source: LootSource, sourceLabel: string): CharacterSheet => {
      const result = lootFor(baseSheet, { source, cx: currentCell.cx, cy: currentCell.cy });
      if (!result.roll) {
        pushDice([{ text: LOOT_CAP_LINE, hit: false }]);
        return baseSheet;
      }
      const itemName = result.roll.item
        ? gearItemName(baseSheet.archetypeId as ArchetypeId, result.roll.item.slot, result.roll.item.tier)
        : null;
      pushDice([{ text: lootLine(result.roll, itemName), hit: Boolean(result.roll.item) }]);
      if (itemName) pushStory([{ role: "engine", text: `You find ${itemName}. It is in your pack.` }]);
      noteToDm(lootDmNote(result.roll, itemName, sourceLabel));
      setLootReadout(lootRollToReadout(result.roll, itemName, `${baseSheet.name}, loot from ${sourceLabel}`));
      return result.sheet;
    },
    [currentCell, pushDice, pushStory, noteToDm],
  );

  const beginLevelUp = useCallback(() => {
    setLevelUpPick(null);
    setLevelUpPreview(levelUpChoices(sheet, sheet.level + 1));
  }, [sheet]);

  const confirmLevelUp = useCallback(() => {
    if (!levelUpPreview) return;
    if (levelUpPreview.choice && !levelUpPick) return;
    const next = applyLevelUpChoice(levelUpPreview, levelUpPick);
    updateSheet(next);
    setLevelUpPreview(null);
    setLevelUpPick(null);
    pushStory([{ role: "engine", text: `You are level ${next.level} now. ${levelUpPreview.changes.map((c) => c.plain).join(" ")}` }]);
    noteToDm(`the player levelled up to level ${next.level}. Mark it in the fiction.`);
  }, [levelUpPreview, levelUpPick, updateSheet, pushStory, noteToDm]);

  const cancelLevelUp = useCallback(() => {
    setLevelUpPreview(null);
    setLevelUpPick(null);
  }, []);

  // ── the inventory screen: staged, free, no model call ───────────────────
  const openInventory = useCallback(
    (role?: GearRole) => {
      setInventoryDraft(draftFromSheet(sheet));
      setInventorySelection(role ? { kind: "slot", role } : null);
    },
    [sheet],
  );
  const closeInventory = useCallback(() => {
    setInventoryDraft(null);
    setInventorySelection(null);
  }, []);
  const handleSelectSlot = useCallback((role: GearRole) => {
    setInventorySelection((cur) => (cur && cur.kind === "slot" && cur.role === role ? null : { kind: "slot", role }));
  }, []);
  const handleSelectBagCell = useCallback((index: number) => {
    setInventorySelection((cur) => (cur && cur.kind === "bag" && cur.index === index ? null : { kind: "bag", index }));
  }, []);

  /** Merge world-mutation results back into knownCells (which `world` is derived from) and persist every touched cell. Every local action AND every applied DM turn goes through this single path. */
  const commitWorldChange = useCallback(
    (nextWorld: World, touched: CellCoord[]) => {
      setKnownCells((prev) => {
        const next = { ...prev };
        for (const coord of touched) {
          const layout = getCell(nextWorld, coord);
          const key = `${coord.cx},${coord.cy}`;
          if (layout) next[key] = { cx: coord.cx, cy: coord.cy, layout };
        }
        return next;
      });
      for (const coord of touched) {
        const layout = getCell(nextWorld, coord);
        if (layout) queue.submit("map", () => api.ltCellAssemble(campaign.id, coord.cx, coord.cy, layout));
      }
    },
    [campaign.id, queue],
  );

  const ensureNeighborhoodLoaded = useCallback(
    async (center: CellCoord) => {
      const coords: CellCoord[] = [center, ...ALL_DIRECTIONS.map((dir) => neighbourCell(center, dir))];
      const missing = coords.filter((c) => !(`${c.cx},${c.cy}` in knownCellsRef.current));
      if (missing.length === 0) return;
      const results = await Promise.all(missing.map((c) => api.ltCellGet(campaign.id, c.cx, c.cy)));
      setKnownCells((prev) => {
        const next = { ...prev };
        results.forEach((res, i) => {
          if (res.cell) {
            const c = missing[i]!;
            next[`${c.cx},${c.cy}`] = { cx: c.cx, cy: c.cy, layout: res.cell.layout as CellLayout };
          }
        });
        return next;
      });
    },
    [campaign.id],
  );

  /** Ensure the player's own token is present in `cell` -- a no-op if it already is, otherwise placed on the most central free walkable tile. Handles the campaign's very first assembled cell, where the DM's assembleCell layout is about props/NPCs, never the party's own token. */
  const ensurePlayerTokenPresent = useCallback(
    (w: World, cell: CellCoord): World => {
      const layout = getCell(w, cell);
      if (!layout || layout.tokens.some((t) => t.id === characterId)) return w;
      const spot = centralWalkableTile(layout, manifest.world) ?? { x: 10, y: 7 };
      const result = placeToken(w, cell.cx, cell.cy, { id: characterId, assetId: sheet.appearanceAssetId, x: spot.x, y: spot.y, kind: "pc" }, manifest.world);
      if (!result.ok) return w;
      commitWorldChange(result.world, [cell]);
      return result.world;
    },
    [characterId, sheet.appearanceAssetId, manifest.world, commitWorldChange],
  );

  // ── the DM turn call: Talk / free text / Move-into-fog ─────────────────

  const sendToDm = useCallback(
    async (playerMessage: string, options: { showInStory?: boolean } = {}): Promise<{ world: World; turn: DmTurn } | null> => {
      if (busy) return null;
      setBusy(true);
      setNote(null);
      if (options.showInStory !== false) pushStory([{ role: "user", text: playerMessage }]);
      try {
        // `space` is undefined exactly on the campaign's very first turn --
        // the starting cell doesn't exist until the DM's own first
        // assembleCell call creates it, so requiring one here (as an
        // earlier version of this function did, throwing "hasn't been built
        // yet") made a fresh campaign structurally unable to ever begin. A
        // gauntlet critic caught this by actually simulating a new campaign
        // end to end. promptBuilder.ts's DmPromptArgs.playspace accepts
        // undefined for exactly this case now.
        const space = getPlayspace(world, currentCell.cx, currentCell.cy, manifest.world);

        const args: DmPromptArgs = {
          template: campaign.template,
          campaignTitle: campaign.title,
          arcOutline: renderArcOutline(campaign.arcOutline),
          memoryContextBlock: buildDmContextBlock(workingMemory),
          playspace: space,
          currentCell: { cx: currentCell.cx, cy: currentCell.cy },
          offscreenCells: getOffscreenCells(world, currentCell.cx, currentCell.cy, hints),
          availableAssetIds: manifest.availableAssetIds,
          resolvedRolls: pendingResolvedRolls,
          // Who the player actually is. Without this the only line about them
          // that ever reached the model was their token's uuid, so a prompt
          // ordering "narration addressed to the player" handed the model
          // nobody to address, and no HP or AC to pitch danger at.
          // Conditions are derived, not stored twice: activeConditionsFor
          // expands the stored set and adds what the sheet's own vitals imply
          // (downed or stable -> unconscious -> prone + incapacitated). Without
          // this argument the prompt read "Active conditions: (none)" forever,
          // however badly hurt the player actually was.
          character: buildDmCharacterView(sheet, characterId, activeConditionsFor(character)),
        };

        const rejectionMsg = buildRejectionMessage(pendingRejections);
        // Everything the player did for free since the last paid turn, handed
        // over as established fact in the same synthetic-message shape
        // session/dmContext.ts already uses for rejections.
        const engineNote: ChatMessage | null =
          pendingEngineNotes.length > 0
            ? {
                role: "user",
                content:
                  "[ENGINE NOTE, not from the player: these already happened and the engine resolved them. Treat them as fact.]\n" +
                  pendingEngineNotes.map((n) => `- ${n}`).join("\n"),
              }
            : null;

        // Only the scenes working memory still holds VERBATIM need to be sent
        // as raw messages: everything older is already in the memory block,
        // as a condensed digest and as permanent facts. Without this the
        // prompt carried scenes 1 to 10 twice at scene 14 (a full transcript
        // message AND a digest) plus their key sentences a third time inside
        // fact evidence, so condensation was costing the player tokens
        // instead of saving them. Three messages per scene is the allowance:
        // one player turn, one DM turn, and at most one engine or rejection
        // note.
        const tier1Budget = Math.max(1, verbatimSceneSeqs(workingMemory).length) * 3;
        const nextMessages: ChatMessage[] = [
          ...transcript.slice(-tier1Budget),
          ...(rejectionMsg ? [rejectionMsg] : []),
          ...(engineNote ? [engineNote] : []),
          { role: "user", content: playerMessage },
        ];

        const turn = await requestDmTurn(args, nextMessages);

        const applied = applyWorldActions(world, turn.actions, manifest.world);
        let nextWorld = applied.world;
        nextWorld = ensurePlayerTokenPresent(nextWorld, currentCell);
        commitWorldChange(nextWorld, applied.touchedCells);

        setTranscript([...nextMessages, { role: "assistant", content: turn.narration }]);
        setPendingRejections(applied.rejections);
        setPendingEngineNotes([]);
        setMenuHint(normalizeMenuHint(turn.menuHint));
        pushStory([{ role: "assistant", text: turn.narration }]);

        // A scene the DM actually built is one of the two things that earns a
        // level (see earnMilestone); re-entering a built cell is not.
        const builtNew = applied.touchedCells.some((c) => !getCell(world, c) && getCell(nextWorld, c));

        // Resolve this turn's rollRequests right now: the engine looks up
        // its own modifier AND the defender's own AC per DESIGN.md's turn
        // protocol, never the model. It also applies the damage on BOTH sides
        // of the table and spends the acting combatant's action out of the
        // live round -- see resolveDmRollRequests for what used to happen
        // instead.
        const rolls = resolveDmRollRequests({
          requests: turn.rollRequests ?? [],
          world: nextWorld,
          cell: currentCell,
          playerTokenId: characterId,
          sheet,
          round,
          namer,
        });
        let workingSheet = rolls.sheet;
        if (rolls.world !== nextWorld) {
          nextWorld = rolls.world;
          commitWorldChange(nextWorld, [currentCell]);
        }
        setRound(rolls.round);

        pushDice(rolls.dice);
        pushStory(rolls.story);
        if (rolls.readout) setReadout(rolls.readout);
        setPendingResolvedRolls(rolls.resolved);
        // A refused roll is reported back to the DM in its next turn's
        // context, exactly the way a rejected world-action already is: the
        // model gets to react to its own mistake in character rather than
        // having the turn silently half-applied.
        for (const refusal of rolls.refusals) noteToDm(refusal);

        if (builtNew) workingSheet = earnMilestone(workingSheet, "You have somewhere new to be.");
        if (workingSheet !== sheet) updateCharacter({ ...character, sheet: workingSheet });

        // Working memory: append this scene verbatim, persist it, then
        // condense the oldest scene once the tier threshold is exceeded.
        // Condensation only ever touches the MODEL's context; `story` above
        // keeps the player's copy untouched forever.
        queue.submit("story", () => api.ltMemoryAppend(campaign.id, "verbatim", sceneSeq, turn.narration));
        // `turn.memoryFacts` is the DM's own typed record of what must survive
        // this campaign, riding the turn that was already paid for. It is
        // parked on the scene and wins over the heuristic per key when that
        // scene condenses; a turn that omits it falls back to the heuristic
        // exactly as before.
        let mem = addSceneNarration(workingMemory, sceneSeq, turn.narration, turn.memoryFacts);
        // The DM's own typed record is in tier 3 the moment it arrives
        // (addSceneNarration), so persist it on the same turn. Waiting for
        // condensation meant a reload within four scenes lost the fact the
        // player's credit had just bought: ltMemoryAppend carries content
        // only, and the rebuilt log has no suppliedFacts field to restore.
        // Additive and idempotent against the changedFacts loop below, which
        // upserts on the same campaign/category/key.
        for (const fact of normalizeSuppliedFacts(turn.memoryFacts ?? [])) {
          queue.submit("campaign notes", () =>
            api.ltFactUpsert({ campaignId: campaign.id, category: fact.category, key: fact.key, fact: fact.fact, status: fact.status }),
          );
        }
        if (needsCondensation(mem)) {
          // Non-AI condensation, deliberately (see memoryHeuristics.ts's
          // header): a real extraction pass is real future work, not
          // something this integration pass should bundle into the DM
          // turn's own paid JSON response, which would break DESIGN.md's
          // "condensation... never as its own charge" the moment it needed
          // a second model call to do its job.
          //
          // condenseOldest only ever touches the SINGLE oldest verbatim
          // entry, so its sceneSeq (captured before the call) is exactly
          // the one entry whose tier just flipped; a plain "find the first
          // condensed entry" would keep re-persisting an already-condensed
          // scene from an earlier cycle instead of the one that just changed.
          const oldest = mem.log.find((e) => e.tier === "verbatim");
          const result = condenseOldest(mem, heuristicSummarize);
          mem = { log: result.log, facts: result.facts };
          const condensedEntry = oldest ? result.log.find((e) => e.sceneSeq === oldest.sceneSeq && e.tier === "condensed") : undefined;
          if (condensedEntry) {
            queue.submit("story", () => api.ltMemoryAppend(campaign.id, "condensed", condensedEntry.sceneSeq, condensedEntry.content));
          }
          // Only what this cycle actually added or changed. Iterating the whole
          // accumulated list fired one ltFactUpsert per fact on every
          // condensation (15 at scene 14, growing linearly, each carrying an
          // ever larger evidence array) to re-write rows that had not moved.
          for (const fact of result.changedFacts) {
            queue.submit("campaign notes", () =>
              api.ltFactUpsert({ campaignId: campaign.id, category: fact.category, key: fact.key, fact: fact.fact, status: fact.status }),
            );
          }
          if (result.collisions?.length) {
            // A heuristic key collision is a real signal worth knowing
            // about while iterating on the summarizer, but not something
            // to interrupt the player over -- see memoryHeuristics.ts.
            console.warn("livingtable: heuristic condensation key collision", result.collisions);
          }
        }
        setWorkingMemory(mem);
        setSceneSeq((s) => s + 1);

        return { world: nextWorld, turn };
      } catch (e) {
        setNote(e instanceof Error ? e.message : "The dungeon master didn't answer.");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [
      busy,
      world,
      currentCell,
      manifest,
      campaign,
      workingMemory,
      pendingResolvedRolls,
      pendingRejections,
      pendingEngineNotes,
      transcript,
      characterId,
      sheet,
      character,
      updateCharacter,
      commitWorldChange,
      ensurePlayerTokenPresent,
      sceneSeq,
      hints,
      namer,
      round,
      noteToDm,
      pushStory,
      pushDice,
      queue,
      earnMilestone,
    ],
  );

  // ── bootstrap: the very first cell hasn't been assembled yet ───────────

  const needsBootstrap = !getCell(world, currentCell);

  const beginCampaign = useCallback(async () => {
    const outcome = await sendToDm(BEGIN_CAMPAIGN_MESSAGE, { showInStory: false });
    if (!outcome) return;
    if (!getCell(outcome.world, currentCell)) {
      setNote("The dungeon master set the scene but hasn't laid out the room yet. Say something to it and it will.");
    }
  }, [sendToDm, currentCell]);

  // ── the combat round ───────────────────────────────────────────────────

  const hostileTokens = useMemo(() => (playspace?.tokens ?? []).filter((t) => t.kind === "monster"), [playspace]);

  // `gearChangeBlockedReason` (rules/attunement.ts) is the SRD short-rest
  // gate: gear changes only when one could be taken as far as the room is
  // concerned. Derived from the live sheet and `hostileTokens`, never stored,
  // so it cannot go stale the instant a monster is placed mid-session. The
  // screen renders read-only off it AND every staging handler below refuses
  // off it, so a hostile arriving while the screen is open still blocks Ok.
  const inventoryBlockedReason = useMemo(
    () =>
      gearChangeBlockedReason(
        { name: sheet.name, downed: sheet.downed, stable: sheet.stable, dead: sheet.dead },
        hostileTokens.length > 0,
      ),
    [sheet.name, sheet.downed, sheet.stable, sheet.dead, hostileTokens],
  );
  const handleInventoryEquip = useCallback(() => {
    if (inventoryBlockedReason || !inventoryDraft || inventorySelection?.kind !== "bag") return;
    const outcome = stageEquip(sheet.archetypeId, inventoryDraft, inventorySelection.index);
    if (outcome.ok) {
      setInventoryDraft(outcome.draft);
      setInventorySelection(null);
    }
  }, [inventoryBlockedReason, inventoryDraft, inventorySelection, sheet.archetypeId]);
  const handleInventoryUnequip = useCallback(() => {
    if (inventoryBlockedReason || !inventoryDraft || inventorySelection?.kind !== "slot") return;
    const outcome = stageUnequip(sheet.archetypeId, inventoryDraft, inventorySelection.role);
    if (outcome.ok) {
      setInventoryDraft(outcome.draft);
      setInventorySelection(null);
    }
  }, [inventoryBlockedReason, inventoryDraft, inventorySelection, sheet.archetypeId]);
  const handleInventoryOk = useCallback(() => {
    if (!inventoryDraft) return;
    // Ok writes only while a rest could be taken; otherwise it discards,
    // exactly like Cancel. Writes ONLY equipment and bag, onto the CURRENT
    // sheet, through the existing write queue (updateSheet).
    if (!inventoryBlockedReason) {
      const committed = commitLoadout(sheet, inventoryDraft);
      if (committed !== sheet) updateSheet(committed);
    }
    closeInventory();
  }, [inventoryBlockedReason, inventoryDraft, sheet, updateSheet, closeInventory]);
  const playerToken = useMemo(() => playspace?.tokens.find((t) => t.id === characterId), [playspace, characterId]);
  /**
   * How far the player's own attack reaches, and what it can see. The reach
   * comes from the weapon the engine says is in hand rather than from a flat
   * melee constant, so an Archery pick can actually take the shot its +2
   * applies to. The line of sight is the same Bresenham walk the DM-turn
   * validator checks a monster's shot against (world/reach.ts), so the greyed
   * -out button and the model's rejection agree on what a wall blocks instead
   * of holding two subtly different notions of it.
   */
  const playerReachTiles = useMemo(() => (weaponFor(sheet).ranged ? DEFAULT_RANGED_REACH_TILES : DEFAULT_MELEE_REACH_TILES), [sheet]);
  const playerSightGeometry = useMemo(
    () => (playspace && playerReachTiles > DEFAULT_MELEE_REACH_TILES ? combatGeometryFrom(playspace) : undefined),
    [playspace, playerReachTiles],
  );
  const canSeeToken = useCallback(
    (tokenId: string): boolean | undefined => playerSightGeometry?.visibleTokens?.[characterId]?.includes(tokenId),
    [playerSightGeometry, characterId],
  );
  /**
   * The hostile the Cast row aims at by default. It used to be
   * `hostileTokens[0]`, which was harmless while nothing checked distance and
   * is not now that spells have real ranges: aiming at whichever monster
   * happened to be first in the layout would grey out a spell that had a
   * legal target standing next to the caster.
   */
  const nearestHostile = useMemo(() => {
    if (!playerToken || hostileTokens.length === 0) return undefined;
    return [...hostileTokens].sort((a, b) => tileDistanceFeet(playerToken, a) - tileDistanceFeet(playerToken, b))[0];
  }, [hostileTokens, playerToken]);
  const myTurn = round === null || isPlayersTurn(round);
  const active = round ? activeCombatant(round) : undefined;

  /**
   * A fight starts by itself when something hostile is standing in the room,
   * and ends by itself when nothing is. Initiative is real (d20 + DEX,
   * sorted), which is what DESIGN.md lists as a pillar and what nothing in
   * src/ was calling.
   */
  useEffect(() => {
    if (hostileTokens.length > 0 && !round && playerToken && !sheet.dead) {
      const started = startCombat({
        player: { id: characterId, label: sheet.name, dexModifier: sheet.modifiers.dex, speedFt: effectiveSpeedFt(sheet) },
        hostiles: hostileTokens.map((t) => ({ id: t.id, label: tokenLabel(t.id, namer), speedFt: DEFAULT_SPEED_FT })),
      });
      setRound(started);
      pushStory([
        {
          role: "engine",
          text: `Everyone rolls initiative. Order: ${started.order.map((c) => c.label).join(", then ")}.`,
        },
      ]);
    }
    if (hostileTokens.length === 0 && round) setRound(null);
  }, [hostileTokens, round, playerToken, characterId, sheet.name, sheet.modifiers.dex, sheet.dead, namer, pushStory]);

  // ── local action: Move ──────────────────────────────────────────────────

  /**
   * Whether pressing `dir` right now would step out of the current cell into
   * an unassembled neighbour, the one case Move actually costs a credit
   * (handleStep below). Mirrors that function's own in-bounds check exactly,
   * so this can never disagree with what a click is about to do. The button
   * needs this BEFORE the click, not just handleStep having it during the
   * click: "every paid action wears its price before it's clicked" is a hard
   * rule in this repo, and a directional Move button is still one paid
   * action once you're standing at the edge of an unexplored room, even
   * though the exact same button is free everywhere else in the cell.
   */
  const crossesIntoFog = useCallback(
    (dir: Edge): boolean => {
      if (!playerToken) return false;
      const { dx, dy } = STEP_DELTA[dir];
      const rawTo = { x: playerToken.x + dx, y: playerToken.y + dy };
      if (rawTo.x >= 0 && rawTo.x < CELL_WIDTH && rawTo.y >= 0 && rawTo.y < CELL_HEIGHT) return false;
      // Asks the SAME router the click handler asks, so the price badge and
      // the button can never disagree. Reading the neighbour's status
      // directly (as this did) put a credit badge on an arrow pointed at a
      // solid wall run, which resolveMove now refuses for free: a badge on
      // something that will never be charged is the CostBadge rule failing
      // in the other direction.
      const route = resolveMenuAction({ kind: "move", destination: { withinCell: false, direction: dir } }, { world, cell: currentCell });
      return route.kind === "dm";
    },
    [playerToken, world, currentCell],
  );

  const handleStep = useCallback(
    async (dir: Edge) => {
      if (busy || !playspace) return;
      setNote(null);
      if (sheet.dead) return;
      if (sheet.downed || sheet.stable) {
        setNote("You are on the floor. You are not going anywhere until you are back up.");
        return;
      }
      const token = playerToken;
      if (!token) {
        setNote("Your character isn't standing in this room yet.");
        return;
      }
      if (round && !isPlayersTurn(round)) {
        setNote("It is not your turn yet.");
        return;
      }
      const { dx, dy } = STEP_DELTA[dir];
      const rawTo = { x: token.x + dx, y: token.y + dy };

      if (rawTo.x >= 0 && rawTo.x < CELL_WIDTH && rawTo.y >= 0 && rawTo.y < CELL_HEIGHT) {
        const route = resolveMenuAction({ kind: "move", destination: { withinCell: true, to: rawTo } }, { world, cell: currentCell });
        if (route.kind !== "local") return; // structurally unreachable for a withinCell move, kept for fidelity to the routing table
        // In a fight, movement comes out of the PERSISTENT economy this
        // combatant has left this round; out of a fight there is no round and
        // no per-turn budget, which is also how the SRD works -- walking
        // around a room you are not fighting in is not a turn.
        // `effectiveSpeedFt`, not the flat default: SRD 5.1 costs a character 10
        // feet for heavy armour they lack the Strength for, and a rule nothing
        // reads is not a rule.
        const economy = round && active ? active.economy : resetTurnEconomy(effectiveSpeedFt(sheet));
        const result = moveToken(world, currentCell.cx, currentCell.cy, characterId, rawTo, manifest.world, economy);
        if (!result.ok) {
          setNote(humanizeEngineError(result.error, namer));
          return;
        }
        commitWorldChange(result.world, [currentCell]);
        if (round) setRound(withActiveEconomy(round, result.economy));
        return;
      }

      const route = resolveMenuAction({ kind: "move", destination: { withinCell: false, direction: dir } }, { world, cell: currentCell });
      // A wall run on this boundary is a refusal, never a purchase: walking
      // at a wall must not open a paid DM turn to build what is behind it.
      if (route.kind === "blocked") {
        setNote(`${route.reason.charAt(0).toUpperCase()}${route.reason.slice(1)}.`);
        return;
      }
      const target = neighbourCell(currentCell, dir);

      const walkInto = (w: World, entry: { x: number; y: number }): boolean => {
        let next = w;
        const afterRemove = removeToken(next, currentCell.cx, currentCell.cy, characterId);
        if (afterRemove.ok) next = afterRemove.world;
        const place = (at: { x: number; y: number }) =>
          placeToken(next, target.cx, target.cy, { id: characterId, assetId: sheet.appearanceAssetId, x: at.x, y: at.y, kind: "pc" }, manifest.world);

        let afterPlace = place(entry);
        if (!afterPlace.ok) {
          // The doorway itself is taken (a monster standing in it, a closed
          // door on the tile). Step to the nearest free square instead of
          // refusing the crossing outright -- see nearestFreeTile's header.
          const arrivalLayout = getCell(next, target);
          const spare = arrivalLayout ? nearestFreeTile(arrivalLayout, manifest.world, entry) : null;
          if (spare) afterPlace = place(spare);
        }
        if (!afterPlace.ok) {
          setNote(`You step through, but there is nowhere to stand: ${humanizeEngineError(afterPlace.error, namer)}`);
          return false;
        }
        commitWorldChange(afterPlace.world, [currentCell, target]);
        setCurrentCell(target);
        setRound(null);
        updateCharacter({ ...character, position: target });
        void ensureNeighborhoodLoaded(target);
        return true;
      };

      if (route.kind === "local") {
        walkInto(world, entryPointFor(dir, token));
        return;
      }

      // Unassembled neighbour: the DM has to build it first (1 credit).
      const outcome = await sendToDm(describeMoveIntoFog(dir), { showInStory: false });
      if (!outcome) return;
      const entry = entryPointFor(dir, token);
      let w = outcome.world;

      if (!getCell(w, target)) {
        // The paid turn narrated but did not build the room the player walked
        // into. The engine finishes the job rather than charging again; see
        // fallbackRoomLayout's own comment for why that is the right call
        // under this repo's cost model.
        const layout = fallbackRoomLayout(manifest.world, currentCell, dir, token);
        const assembled = layout ? assembleCell(w, target.cx, target.cy, layout, manifest.world) : null;
        if (!assembled || !assembled.ok) {
          setNote("The way through is blocked for now. Tell the DM where you are trying to go.");
          return;
        }
        w = assembled.world;
        commitWorldChange(w, [target, currentCell]);
        noteToDm(
          `the player walked ${dir} into cell (${target.cx},${target.cy}) but your turn did not assemble it, so the engine laid down a plain room there. Describe what is actually in it on your next turn, and place anything that belongs.`,
        );
        pushStory([{ role: "engine", text: "The way opens into a bare stretch of room the DM has not described yet." }]);
      }

      walkInto(w, entry);
    },
    [
      busy,
      playspace,
      playerToken,
      world,
      currentCell,
      manifest,
      characterId,
      sheet,
      character,
      round,
      active,
      namer,
      updateCharacter,
      commitWorldChange,
      ensureNeighborhoodLoaded,
      sendToDm,
      noteToDm,
      pushStory,
    ],
  );

  // ── local action: Attack ────────────────────────────────────────────────

  /**
   * What this character's Attack row actually swings, by name.
   *
   * It used to be `cantripNameFor(sheet) ?? "your weapon"`, which was right
   * for a Wizard (a 1d10 attack roll off INT genuinely IS Fire Bolt) and
   * wrong twice over for a Cleric: Sacred Flame is a Dexterity save for 1d8
   * radiant in the Cast row and a 1d6+STR mace swing in the Attack row, so
   * one name sat on two buttons with two different resolutions. And the
   * fallback put the second person into a third-person sentence: "Bram
   * attacks the goblin with your weapon". menu/casting.ts owns both answers
   * now, and reads the weapon's noun off the same table that picks its
   * damage die, so the label and the dice cannot disagree.
   */
  const attackName = attackWeaponName(sheet);

  /** The Battle Master's shipped maneuvers, empty for everyone else, so nobody sees a row of disabled buttons for a choice they did not make. */
  const maneuvers = useMemo(() => maneuversFor(sheet), [sheet]);
  const superiorityDice = superiorityDiceFor(character);
  const superiorityDiceMax = superiorityDiceMaxFor(sheet);

  const handleAttack = useCallback(
    (targetTokenId: string, maneuverId?: ManeuverId) => {
      if (busy) return;
      const route = resolveMenuAction({ kind: "attack" }, { world, cell: currentCell });
      if (route.kind !== "local") return; // attack is always local per commandMenu.ts
      const target = playspace?.tokens.find((t) => t.id === targetTokenId);
      if (!target || !playerToken) return;

      const blocked = attackBlockedReason({
        round,
        attackerAt: playerToken,
        targetAt: target,
        downed: sheet.downed || sheet.stable || sheet.dead,
        reachTiles: playerReachTiles,
        hasLineOfSight: canSeeToken(targetTokenId),
      });
      if (blocked) {
        setNote(blocked);
        return;
      }
      setNote(null);

      const spentRound = round ? spendActiveAction(round) : null;
      if (round && !spentRound) return;

      const bonus = attackerBonusFor(sheet);
      const attackSources = attackReadoutSources(sheet, bonus);
      const targetAC = monsterArmorClassFor(target.assetId);
      const result = resolveAttack({ attackerBonus: bonus, targetAC, criticalOn: criticalOnFor(sheet) });
      const targetLabel = label(targetTokenId);

      let damage: number | undefined;
      let down = false;
      let hpLeft: number | undefined;
      let nextSheet = sheet;
      let fightWon = false;
      // The maneuver spends its die only on a HIT, per SRD 5.1 ("when you hit
      // a creature with a weapon attack"), so the pool is not drained by a
      // miss and the button's own gate is not the only thing protecting it.
      let nextState = character;
      if (result.hit) {
        const dmg = resolveDamage(weaponDamageNotationFor(sheet), Math.random, result.critical);
        damage = dmg.total;
        // A legendary weapon's rider: extra damage of a named type, rolled as
        // its own dice so a critical doubles the right ones. Rolled by the
        // engine off the frozen slot table, never supplied by anything; a
        // non-legendary weapon returns null and nothing is added.
        const rider = legendaryRiderDamageFor(sheet, Math.random, result.critical);
        if (rider) {
          damage += rider.roll.total;
          const riderLine = `${rider.source}: ${rider.roll.total} ${rider.damageType} damage (${rider.roll.notation})`;
          pushDice([{ text: riderLine, hit: true }]);
          pushStory([{ role: "engine", text: riderLine }]);
        }
        if (maneuverId) {
          const spent = spendSuperiorityDie(character);
          if (spent) {
            nextState = spent;
            const maneuver = resolveManeuver({
              maneuver: maneuverId,
              targetSaveModifier: maneuverTargetSaveModifier(getManeuver(maneuverId), target.assetId),
              saveDC: maneuverSaveDCFor(sheet),
            });
            damage += maneuver.bonusDamage;
            pushDice([{ text: maneuver.note, hit: maneuver.landed }]);
            pushStory([{ role: "engine", text: maneuver.note }]);
            // The board holds no per-token conditions, so a landed trip is a
            // fact the DM is told rather than a flag on the sprite. The engine
            // still decided it; the DM only narrates it.
            noteToDm(
              `the player used the ${maneuverId} maneuver on ${targetTokenId}: ${maneuver.landed ? `it failed the DC ${maneuver.saveDC} Strength save and ${maneuverId === "trip" ? "is prone" : "is disarmed"}` : `it made the DC ${maneuver.saveDC} Strength save and shrugged it off`}.`,
            );
          }
        }
        const hurt = damageMonster(target, damage);
        hpLeft = hurt.currentHp;
        down = hurt.down;
        if (down) {
          const removed = removeToken(world, currentCell.cx, currentCell.cy, targetTokenId);
          if (removed.ok) commitWorldChange(removed.world, [currentCell]);
          if (round) setRound(dropCombatant(spentRound ?? round, targetTokenId));
          if (hostileTokens.length <= 1) {
            nextSheet = earnMilestone(sheet, "That fight is over.");
            // The loot roll itself waits until the killing blow's own line is
            // in the log (below), so the dice read in the order they landed.
            fightWon = true;
          }
        } else {
          // Write the damage back onto the token so it survives a reload and
          // shows up in the DM's own view of the board.
          const wounded = setTokenHp(world, currentCell.cx, currentCell.cy, targetTokenId, hurt.currentHp);
          if (wounded.ok) commitWorldChange(wounded.world, [currentCell]);
        }
      }
      if (spentRound && !down) setRound(spentRound);

      const line = attackLine({
        attacker: sheet.name,
        target: targetLabel,
        roll: result.roll,
        modifier: bonus,
        total: result.total,
        targetAC,
        hit: result.hit,
        critical: result.critical,
        fumble: result.fumble,
        damage,
        targetDown: down,
        targetHpLeft: hpLeft,
        sources: attackSources,
      });
      pushDice([{ text: line, hit: result.hit }]);
      pushStory([{ role: "engine", text: down ? `You cut down ${targetLabel}.` : line }]);
      setReadout({
        ...attackResultToReadout(result, bonus, targetAC, attackSources),
        critical: result.critical,
        fumble: result.fumble,
        caption: attackCaption(sheet, targetLabel),
      });
      recordRolls([{ id: `local-attack-${Date.now()}`, kind: "attack", by: characterId, against: targetTokenId, ...result }]);
      noteToDm(
        `the player attacked ${targetTokenId}: d20 ${result.roll}${bonus >= 0 ? "+" : ""}${bonus}=${result.total} vs AC ${targetAC}, ` +
          `${result.hit ? `hit for ${damage}` : "missed"}${
            down ? `, ${targetTokenId} is down and off the board` : hpLeft !== undefined ? `, ${targetTokenId} is on ${hpLeft} hit points` : ""
          }. ` +
          `The player is on ${nextSheet.currentHp}/${nextSheet.maxHp} hit points.`,
      );
      // Loot for a fight won by the player's own blow (contract v2, LOOT:
      // "fight"), rolled after the attack's own line and note so the log and
      // the DM both hear the kill first and the find second.
      if (fightWon) nextSheet = applyLoot(nextSheet, "fight", "the fight");
      // One write for both halves: a maneuver spends a superiority die (which
      // lives on CharacterState, not the sheet) and a won fight earns a
      // milestone (which lives on the sheet), and they can happen in the same
      // swing.
      if (nextState !== character || nextSheet !== sheet) updateCharacter({ ...nextState, sheet: nextSheet });
    },
    [
      busy,
      world,
      currentCell,
      playspace,
      playerToken,
      sheet,
      character,
      round,
      hostileTokens,
      label,
      characterId,
      commitWorldChange,
      pushDice,
      pushStory,
      recordRolls,
      noteToDm,
      earnMilestone,
      applyLoot,
      updateSheet,
      updateCharacter,
      playerReachTiles,
      canSeeToken,
    ],
  );

  // ── local action: Cast ──────────────────────────────────────────────────

  const spells = useMemo(() => castableSpells(sheet), [sheet]);

  /**
   * Take hit points off a monster token, removing it from the board (and from
   * the initiative order) when it drops. Shared by every damaging spell so
   * "the goblin died" has one implementation rather than one per effect kind.
   *
   * Takes and returns a World rather than committing one itself, for two
   * reasons that both used to be bugs. Monster HP now lives ON the token
   * (world/cell.ts's `currentHp`), so it persists across a reload and appears
   * in the playspace the DM is shown, instead of in a React record that reset
   * every session and that the DM was never told about, which is why a wounded
   * monster could never be made to flee. And a caller that damages the same
   * target twice in one handler (Magic Missile's three darts, an Eldritch
   * Blast's second beam) has to see the first hit's result before the second
   * lands; reading component state here meant every shot in the loop read the
   * same starting HP and only the last one counted.
   */
  const applyMonsterDamage = useCallback(
    (w: World, target: PlacedToken, amount: number): { world: World; down: boolean } => {
      if (amount <= 0) return { world: w, down: false };
      // The LIVE token out of `w`, not the render-time snapshot in `target`:
      // an earlier call in this same handler may already have wounded it.
      const live = getCell(w, currentCell)?.tokens.find((t) => t.id === target.id) ?? target;
      const { currentHp, down } = damageMonster(live, amount);
      if (down) {
        setRound((r) => (r ? dropCombatant(r, target.id) : r));
        const removed = removeToken(w, currentCell.cx, currentCell.cy, target.id);
        return { world: removed.ok ? removed.world : w, down: true };
      }
      const hurt = setTokenHp(w, currentCell.cx, currentCell.cy, target.id, currentHp);
      return { world: hurt.ok ? hurt.world : w, down: false };
    },
    [currentCell],
  );

  const handleCast = useCallback(
    (entry: CastableSpell, targetTokenId: string | null) => {
      if (busy || !entry.available || !entry.effect) return;
      const route = resolveMenuAction({ kind: "cast" }, { world, cell: currentCell });
      if (route.kind !== "local") return;
      if (sheet.downed || sheet.stable || sheet.dead) {
        setNote("You are on the floor. No spells until you are back up.");
        return;
      }
      const target = targetTokenId ? playspace?.tokens.find((t) => t.id === targetTokenId) : undefined;
      // The same geometry check the Attack row runs, and the same one the DM
      // turn is held to. This handler used to check busy, downed, whose turn
      // it is, the action economy and the spell slot, and never once ask how
      // far away the target was, so a 15-foot cone resolved at 85 feet.
      const castBlocked = castBlockedReason({
        round,
        entry,
        casterAt: playerToken,
        targetAt: target,
        downed: sheet.downed || sheet.stable || sheet.dead,
      });
      if (castBlocked) {
        setNote(castBlocked);
        return;
      }
      const spentRound = round ? spendActiveAction(round) : null;
      if (round && !spentRound) {
        setNote("You have already taken your action this turn. End your turn to get it back.");
        return;
      }
      setNote(null);

      const spentSlots = spendSlotFor(sheet.spellSlots, entry.spell.level);
      if (spentSlots === null) {
        setNote(`No level ${entry.spell.level} slots left. A long rest gives them back.`);
        return;
      }
      let nextSheet: CharacterSheet = spentSlots === "cantrip" ? sheet : { ...sheet, spellSlots: spentSlots };
      const effect = entry.effect;
      const targetLabel = target ? label(target.id) : null;
      const dice: DiceLogEntry[] = [];
      const told: StoryEntry[] = [];
      const rolls: ResolvedRoll[] = [];
      let lastReadout: ReadoutView | null = null;
      // One running world for the whole cast, committed once at the end: a
      // multi-dart spell damages the same token several times and each shot
      // has to see the one before it.
      let w = world;

      if (effect.kind === "heal") {
        const healed = rollDice(`${effect.dice}+${Math.max(0, spellAttackBonus(sheet) - sheet.proficiencyBonus)}`).total;
        const outcome = applyHealing(nextSheet, healed);
        nextSheet = outcome.sheet;
        dice.push({ text: `${entry.spell.name}: ${healed} hit points back.`, hit: true });
        told.push({ role: "engine", text: outcome.note });
      } else if (effect.kind === "utility") {
        told.push({ role: "engine", text: `${entry.spell.name}. ${effect.note}` });
        dice.push({ text: `${entry.spell.name} cast.`, hit: true });
      } else if (!target || !targetLabel) {
        setNote(`${entry.spell.name} needs something to aim at.`);
        return;
      } else if (effect.kind === "autohit") {
        const dmg = rollDice(effect.damage);
        w = applyMonsterDamage(w, target, dmg.total).world;
        dice.push({ text: `${entry.spell.name} strikes ${targetLabel} automatically: ${dmg.total} ${effect.damageType} damage.`, hit: true });
        told.push({ role: "engine", text: `${entry.spell.name} finds ${targetLabel} without a roll.` });
        noteToDm(`the player cast ${entry.spell.name} on ${target.id} for ${dmg.total} ${effect.damageType} damage (no roll, it always hits).`);
      } else if (effect.kind === "save") {
        const dc = spellSaveDc(sheet);
        const modifier = statblockFor(target.assetId).abilityModifiers[effect.ability];
        const result = resolveSavingThrow({ modifier, dc });
        const dmg = rollDice(effect.damage);
        const dealt = result.success ? (effect.halfOnSave ? Math.floor(dmg.total / 2) : 0) : dmg.total;
        w = applyMonsterDamage(w, target, dealt).world;
        dice.push({
          text: checkLine({
            roller: targetLabel,
            what: saveName(effect.ability),
            roll: result.roll,
            modifier,
            total: result.total,
            dc,
            success: result.success,
            // What the roll DID, not just what it rolled. Both judges flagged
            // a save line that reported arithmetic and no consequence.
            effect: dealt > 0 ? `${dealt} ${effect.damageType} damage` : "no damage",
          }),
          hit: !result.success,
        });
        told.push({ role: "engine", text: `${entry.spell.name} catches ${targetLabel} for ${dealt} ${effect.damageType} damage.` });
        rolls.push({ id: `local-save-${Date.now()}`, kind: "save", by: target.id, ...result });
        lastReadout = { ...checkResultToReadout(result, modifier, dc), caption: `${targetLabel}, ${saveName(effect.ability)} against ${entry.spell.name}` };
        noteToDm(`the player cast ${entry.spell.name} on ${target.id}: DC ${dc} ${effect.ability.toUpperCase()} save, ${result.success ? "saved" : "failed"}, ${dealt} damage.`);
      } else {
        const bonus = spellAttackBonus(sheet);
        const targetAC = monsterArmorClassFor(target.assetId);
        const shots = effect.attacks ?? 1;
        let targetDown = false;
        for (let i = 0; i < shots; i++) {
          // Stop once it drops. A multi-dart spell used to fire every shot
          // regardless, which was invisible while each shot read the same
          // stale hit points and would now read as shooting a corpse twice.
          if (targetDown) break;
          const result = resolveAttack({ attackerBonus: bonus, targetAC, criticalOn: criticalOnFor(sheet) });
          let dealt: number | undefined;
          if (result.hit) {
            const dmg = resolveDamage(effect.damage, Math.random, result.critical);
            dealt = dmg.total;
            const hurt = applyMonsterDamage(w, target, dmg.total);
            w = hurt.world;
            targetDown = hurt.down;
          }
          dice.push({
            text: attackLine({
              attacker: sheet.name,
              target: targetLabel,
              roll: result.roll,
              modifier: bonus,
              total: result.total,
              targetAC,
              hit: result.hit,
              critical: result.critical,
              fumble: result.fumble,
              damage: dealt,
            }),
            hit: result.hit,
          });
          rolls.push({ id: `local-cast-${Date.now()}-${i}`, kind: "attack", by: characterId, against: target.id, ...result });
          lastReadout = {
            ...attackResultToReadout(result, bonus, targetAC),
            critical: result.critical,
            fumble: result.fumble,
            caption: `${sheet.name} casts ${entry.spell.name} at ${targetLabel}`,
          };
          noteToDm(`the player cast ${entry.spell.name} at ${target.id}: ${result.hit ? `hit for ${dealt}` : "missed"}.`);
        }
        told.push({ role: "engine", text: `You cast ${entry.spell.name} at ${targetLabel}.` });
      }

      if (spentSlots !== "cantrip") {
        told.push({ role: "engine", text: `One level ${entry.spell.level} slot spent.` });
      }
      if (w !== world) commitWorldChange(w, [currentCell]);
      pushDice(dice);
      pushStory(told);
      recordRolls(rolls);
      if (lastReadout) setReadout(lastReadout);
      if (spentRound) setRound(spentRound);
      updateSheet(nextSheet);
    },
    [
      busy,
      world,
      currentCell,
      playspace,
      playerToken,
      sheet,
      round,
      label,
      characterId,
      applyMonsterDamage,
      commitWorldChange,
      pushDice,
      pushStory,
      recordRolls,
      noteToDm,
      updateSheet,
    ],
  );

  // ── local action: end the turn, and let the other side act ─────────────

  /**
   * Hand a resolved stretch of hostile turns to the screen: the board, the
   * sheet, the logs and the round, all at once. Shared by End turn and by the
   * start of a fight, because a hostile that wins initiative has to take its
   * turn without the player having to press a button labelled "End turn"
   * while it is not their turn.
   */
  const applyHostileTurns = useCallback(
    (from: CombatRound, startingWorld: World, startingSheet: CharacterSheet) => {
      const outcome = runHostileTurns({
        round: from,
        world: startingWorld,
        cell: currentCell,
        manifest: manifest.world,
        playerTokenId: characterId,
        sheet: startingSheet,
        namer,
      });
      if (outcome.world !== startingWorld) commitWorldChange(outcome.world, [currentCell]);
      pushDice(outcome.dice);
      pushStory(outcome.story.map((text) => ({ role: "engine" as const, text })));
      recordRolls(outcome.resolved);
      if (outcome.readout) setReadout(outcome.readout);
      setRound(outcome.round);
      if (outcome.sheet !== startingSheet) {
        updateSheet(outcome.sheet);
        noteToDm(
          `the monsters took their turns. The player is on ${outcome.sheet.currentHp}/${outcome.sheet.maxHp} hit points` +
            `${outcome.sheet.dead ? " and has died" : outcome.sheet.downed ? " and is unconscious, making death saves" : ""}.`,
        );
      }
    },
    [currentCell, manifest.world, characterId, namer, commitWorldChange, pushDice, pushStory, recordRolls, updateSheet, noteToDm],
  );

  /**
   * Whenever the combatant holding the turn is hostile, resolve turns until
   * the player has it back.
   *
   * This is what makes winning initiative better than losing it. Nothing
   * resolved a hostile turn on entry to combat, so a skeleton that rolled
   * higher simply stood there: the round pill read "the skeleton is acting",
   * every player control was correctly disabled, and the only enabled button
   * was End turn. It also covers the turn AFTER a death save, which hands the
   * turn on the same way. Terminates by construction: runHostileTurns only
   * returns with the player active or the order empty, and both make this
   * return early on the next pass.
   */
  useEffect(() => {
    if (!round || busy || sheet.dead) return;
    if (isPlayersTurn(round)) return;
    applyHostileTurns(round, world, sheet);
  }, [round, busy, world, sheet, applyHostileTurns]);

  const handleEndTurn = useCallback(() => {
    if (!round || busy) return;
    // End turn used to end whoever was ACTIVE, not the player. With a hostile
    // acting and no path resolving its turn, the player's own End turn button
    // silently burned the monster's turn instead of theirs.
    if (!isPlayersTurn(round)) return;
    setNote(null);
    applyHostileTurns(endCombatTurn(round), world, sheet);
  }, [round, busy, world, sheet, applyHostileTurns]);

  // ── local action: death saves ───────────────────────────────────────────

  const handleDeathSave = useCallback(() => {
    if (busy || !sheet.downed) return;
    const result = resolveSavingThrow({ modifier: 0, dc: DEATH_SAVE_DC });
    const outcome = applyDeathSave(sheet, result);
    updateSheet(outcome.sheet);
    pushDice([{ text: `Death save: rolled ${result.roll}, needed ${DEATH_SAVE_DC}. ${outcome.note}`, hit: result.success }]);
    pushStory([{ role: "engine", text: outcome.note }]);
    setReadout({
      ...checkResultToReadout(result, 0, DEATH_SAVE_DC),
      critical: result.roll === 20,
      fumble: result.roll === 1,
      caption: `${sheet.name}, death save`,
    });
    noteToDm(`the player rolled a death save: ${outcome.note}`);
    if (round) setRound(endCombatTurn(round));
  }, [busy, sheet, round, updateSheet, pushDice, pushStory, noteToDm]);

  // ── local action: Search ────────────────────────────────────────────────

  const handleSearch = useCallback(
    (propId: string) => {
      if (busy || !playspace) return;
      const prop = playspace.props.find((p) => p.id === propId);
      if (!prop) return;
      setNote(null);
      // `theProp`, not `` `the ${propLabel(prop)}` ``: a DM-authored label can
      // already start with "the" ("the water-swollen chest"), and building
      // the article by hand here doubled it in every sentence below.
      const the = theProp(prop);
      if (prop.searched) {
        pushDice([{ text: `You have already been through ${the}.`, hit: true }]);
        return;
      }
      const modifier = skillModifierFor(sheet, "Perception");
      const dc = prop.dc ?? SEARCH_DC;
      const result = resolveSkillCheck({ modifier, dc });
      const searchSources = checkReadoutSources(sheet, "Perception", modifier);
      setReadout({ ...checkResultToReadout(result, modifier, dc, searchSources), caption: `${sheet.name}, Perception on ${the}` });
      const line = checkLine({
        roller: sheet.name,
        what: `searching ${the}`,
        roll: result.roll,
        modifier,
        total: result.total,
        dc,
        success: result.success,
        sources: searchSources,
      });
      pushDice([{ text: line, hit: result.success }]);
      // A failed Perception check means the player did not find it, not that
      // there is nothing there (SRD 5.1; the prop stays searchable below).
      // "You find nothing" said the second, wrong thing, and a container's
      // loot roll (below) only ever fires on a SUCCESS, so the sentence was
      // telling the player to walk past a chest that could still hold
      // something.
      // searchFoundLine drops an onFound that names a magic item (a cell
      // assembled before validatePlacedProp rejected one there).
      const found = result.success ? searchFoundLine(prop.onFound, the) : `You don't turn up anything in ${the}. You can search it again.`;
      pushStory([{ role: "engine", text: found }]);
      noteToDm(`the player searched ${the} (DC ${dc}) and ${result.success ? "found something" : "found nothing"}.`);
      if (result.success) {
        let nextSheet = sheet;
        // Defence in depth (equipmentTypes.ts section 11.7, rule 3): see
        // pocketableGrant. A magic gear name, bare or wrapped in prose, is
        // silently DROPPED here rather than pocketed: only a LootRoll ever
        // writes `bag`.
        const pocketed = pocketableGrant(prop.grantsItem);
        if (pocketed) {
          nextSheet = { ...nextSheet, inventory: [...nextSheet.inventory, pocketed] };
          pushStory([{ role: "engine", text: `You pocket the ${pocketed}.` }]);
        }
        // Record the success on the prop itself so a cleared cache says so
        // rather than re-rolling the same DC forever. Only on a success: a
        // failed check under SRD 5.1 means you did not find it, not that
        // there is nothing there, so the prop stays searchable.
        const marked = markPropSearched(world, currentCell.cx, currentCell.cy, propId);
        if (marked.ok) commitWorldChange(marked.world, [currentCell]);
        // Loot: a searched CONTAINER (chest, crate), on this same success,
        // once per container by construction (a searched prop cannot be
        // searched again). One `updateSheet` at the end of the branch, not
        // one per step, so a grant and a find in the same search cannot
        // clobber each other through two reads of the same stale `sheet`.
        if (isContainerProp(sheet.template, prop.assetId)) {
          nextSheet = applyLoot(nextSheet, "container", the);
        }
        if (nextSheet !== sheet) updateSheet(nextSheet);
      }
    },
    [busy, playspace, sheet, world, currentCell, pushDice, pushStory, noteToDm, updateSheet, commitWorldChange, applyLoot],
  );

  // ── local action: Item ──────────────────────────────────────────────────

  const handleUseItem = useCallback(
    (name: string) => {
      if (busy) return;
      // Not while unconscious. SRD 5.1 has no "drink your own potion at 0 hit
      // points" move, and allowing it here would put back the exact bypass
      // that let a character at 0 HP heal 3 and walk on without a single
      // death save ever being rolled.
      if (sheet.downed || sheet.stable || sheet.dead) {
        setNote("You cannot use anything while you are on the floor. Roll your death saves.");
        return;
      }
      const index = sheet.consumables.findIndex((c) => c.name === name && c.uses > 0);
      if (index === -1) return;
      setNote(null);
      const item = sheet.consumables[index]!;
      const consumables = sheet.consumables.map((c, i) => (i === index ? { ...c, uses: c.uses - 1 } : c));
      const healed = potionHealing();
      const outcome = applyHealing({ ...sheet, consumables }, healed);
      updateSheet(outcome.sheet);
      pushDice([{ text: `${item.name}: ${healed} hit points back (${outcome.sheet.currentHp}/${outcome.sheet.maxHp}).`, hit: true }]);
      pushStory([{ role: "engine", text: outcome.note }]);
      noteToDm(`the player used a ${item.name} and is now on ${outcome.sheet.currentHp}/${outcome.sheet.maxHp} hit points.`);
    },
    [busy, sheet, updateSheet, pushDice, pushStory, noteToDm],
  );

  // ── local action: Rest ──────────────────────────────────────────────────

  const restBlockedByFight = hostileTokens.length > 0 ? "Not with something still in the room." : null;

  const handleRest = useCallback(
    (kind: "short" | "long") => {
      if (busy) return;
      if (restBlockedByFight) {
        setNote(restBlockedByFight);
        return;
      }
      const route = resolveMenuAction({ kind: "rest" }, { world, cell: currentCell });
      if (route.kind !== "local") return;
      const outcome = kind === "short" ? shortRest(sheet) : longRest(sheet);
      if (outcome.sheet === sheet) {
        setNote(outcome.note);
        return;
      }
      setNote(null);
      // SRD 5.1: "You regain all of your expended superiority dice when you
      // finish a short or long rest." Both rests, no half-recovery case.
      updateCharacter({ ...restoreSuperiorityDice(character), sheet: outcome.sheet });
      pushDice([{ text: outcome.note, hit: true }]);
      pushStory([{ role: "engine", text: outcome.note }]);
      noteToDm(
        kind === "long"
          ? `the player made camp and slept the night through in this room, and is now on ${outcome.sheet.currentHp}/${outcome.sheet.maxHp} hit points. A night has passed here: decide whether anything found them while they slept.`
          : `the player caught their breath and is now on ${outcome.sheet.currentHp}/${outcome.sheet.maxHp} hit points. An hour passed.`,
      );
    },
    [busy, restBlockedByFight, world, currentCell, sheet, character, updateCharacter, pushDice, pushStory, noteToDm],
  );

  // ── local action: Talk / free text ──────────────────────────────────────

  const handleTalk = useCallback(async () => {
    const text = draft.trim() || "I look around and see what's here.";
    setDraft("");
    await sendToDm(text);
  }, [draft, sendToDm]);

  // ── render ───────────────────────────────────────────────────────────

  if (needsBootstrap) {
    return (
      <div className="screen livingtable">
        <GameHeader title={campaign.title} subtitle="The story hasn't started yet." onExit={onExit} />
        {note && <p className="flash">{note}</p>}
        {busy ? (
          <Busy label="The dungeon master is setting the scene..." />
        ) : (
          <>
            <button
              type="button"
              className="cui-button cui-button--primary"
              onClick={() => void beginCampaign()}
              title={CREDIT_BUYS.beginScene}
            >
              Begin the scene <CostBadge n={1} />
            </button>
            <p className="cui-muted lt-price-note">{CREDIT_BUYS.beginScene}</p>
            <p className="cui-muted lt-free-note">{FREE_FOREVER_LINE}</p>
          </>
        )}
      </div>
    );
  }

  const suggestion = menuHintSentence(menuHint);
  const verbClass = (verb: CommandVerb) => (menuHint.includes(verb) ? " lt-verb-suggested" : menuHint.length > 0 ? " lt-verb-quiet" : "");

  // The inventory screen's own view, built fresh from the staged draft every
  // render (see menu/labels.ts's `gearView`, the same "derive, never store"
  // split). The doll draws the STAGED loadout, not the committed sheet, so an
  // Equip shows on the figure before Ok: `renderPlanFor` only ever reads
  // `.archetypeId`, `.template` and `.equipment`, so handing it a throwaway
  // sheet carrying the draft's equipment is enough, with no new plumbing.
  const inventoryView = inventoryDraft
    ? buildInventoryView({
        archetypeId: sheet.archetypeId as ArchetypeId,
        template: sheet.template,
        sheet,
        draft: inventoryDraft,
        selection: inventorySelection,
        blockedReason: inventoryBlockedReason,
        usable: sheet.consumables,
        carrying: packItems(sheet),
        // Before the boots: the Boots of Speed sentence names the speed they double.
        baseSpeedFt: speedBeforeBootsFt(sheet),
      })
    : null;
  const dollPlan = inventoryDraft ? renderPlanFor({ ...sheet, equipment: inventoryDraft.equipment }) : null;

  return (
    <div className="screen livingtable">
      <GameHeader
        title={campaign.title}
        subtitle={`${sheet.name}, ${sheet.displayName} · ${placeName(currentCell)}`}
        badge={`HP ${sheet.currentHp}/${sheet.maxHp}`}
        onExit={onExit}
      />
      {saveTrouble && <p className="flash lt-save-trouble">{saveTrouble}</p>}

      <div className="lt-play-layout">
        <div className="lt-stage" ref={stageRef}>
          <div className="lt-canvas-wrap">
            <canvas
              ref={canvasRef}
              width={canvasWidth}
              height={canvasHeight}
              style={{ width: `${canvasWidth}px`, height: `${canvasHeight}px` }}
              className="lt-canvas"
            />
            {(readout || lootReadout) && (
              <div className="lt-readout-stack">
                {readout && <RollReadoutOverlay readout={readout} />}
                {lootReadout && <LootReadoutOverlay readout={lootReadout} />}
              </div>
            )}
          </div>

          {offscreen && (
            <div className="lt-offscreen-hints cui-muted">
              {(["N", "E", "S", "W"] as const).map((dir) => {
                const neighbour = getCell(world, neighbourCell(currentCell, dir));
                const stub = offscreen[dir];
                return (
                  <span key={dir}>
                    {neighbourLine(dir, {
                      built: Boolean(neighbour),
                      occupied: Boolean(neighbour?.tokens.some((t) => t.id !== characterId)),
                      hint: stub.status === "unassembled" ? stub.hint : undefined,
                    })}
                  </span>
                );
              })}
            </div>
          )}

          {round && (
            <div className="lt-round">
              <span className="cui-pill cui-pill--plain">Round {round.roundNumber}</span>
              <span className="cui-muted">
                {myTurn ? "Your turn." : `${active?.label ?? "Someone else"} is acting.`}
                {myTurn && active ? ` ${stepsAndFeet(active.economy.movementRemaining)}, ${active.economy.action ? "action ready" : "action spent"}.` : ""}
              </span>
              <button
                type="button"
                className="cui-button cui-button--secondary"
                onClick={handleEndTurn}
                disabled={busy || !myTurn}
                title={myTurn ? "Finish your turn and let the other side act." : `${active?.label ?? "Someone else"} is acting. Their turn is not yours to end.`}
              >
                End turn
              </button>
            </div>
          )}

          {/* Dying used to be a dead end with a live billing surface: the
              only control was "Leave the table" (which reads as a quit button,
              and which reloaded the same dead character on the way back), the
              Talk button stayed enabled and chargeable, and the sentence that
              told you your character had died also mentioned your wallet --
              "it made me think about my wallet at the exact moment it wanted
              me to feel something." The campaign, its world and its memory all
              survive a death, so rolling a new character into it is the honest
              offer, and it costs nothing. */}
          {sheet.dead && (
            <Panel>
              <h3 className="cui-subheading">{sheet.name} is gone.</h3>
              <p className="cui-muted">
                Three failed death saves. The campaign is still here: the rooms you built, what the DM remembers, all of
                it. Somebody else can walk into it.
              </p>
              <div className="cui-stack-h">
                <button type="button" className="cui-button cui-button--primary" onClick={onNewCharacter}>
                  Roll a new character into this campaign
                </button>
                <button type="button" className="cui-button cui-button--ghost" onClick={onExit}>
                  Back to your campaigns
                </button>
              </div>
              <p className="cui-muted lt-price-note">Neither of those costs a credit. Dying is never charged for.</p>
            </Panel>
          )}

          {sheet.downed && !sheet.dead && (
            <Panel>
              <h3 className="cui-subheading">You are down.</h3>
              <p className="cui-muted">
                At 0 hit points you roll a <Explain term="death save">death save</Explain> on each of your turns.
                Successes {sheet.deathSaves.successes} of 3, failures {sheet.deathSaves.failures} of 3.
              </p>
              <button type="button" className="cui-button cui-button--primary" onClick={handleDeathSave} disabled={busy}>
                Roll a death save
              </button>
            </Panel>
          )}

          <div className="lt-menu">
            {suggestion && <p className="cui-muted lt-suggestion">{suggestion}</p>}

            <div className={`lt-menu-move${verbClass("Move")}`}>
              <MoveButton dir="N" paid={crossesIntoFog("N")} disabled={busy || !myTurn || sheet.downed || sheet.stable || sheet.dead} onStep={handleStep} />
              <div className="lt-menu-move-row">
                <MoveButton dir="W" paid={crossesIntoFog("W")} disabled={busy || !myTurn || sheet.downed || sheet.stable || sheet.dead} onStep={handleStep} />
                <MoveButton dir="E" paid={crossesIntoFog("E")} disabled={busy || !myTurn || sheet.downed || sheet.stable || sheet.dead} onStep={handleStep} />
              </div>
              <MoveButton dir="S" paid={crossesIntoFog("S")} disabled={busy || !myTurn || sheet.downed || sheet.stable || sheet.dead} onStep={handleStep} />
            </div>

            <div className={`lt-target-group${verbClass("Attack")}`}>
              <span className="cui-muted">Attack with {attackName}:</span>
              {hostileTokens.length === 0 && <span className="cui-muted">nothing here</span>}
              {hostileTokens.map((t) => {
                const blocked = attackBlockedReason({
                  round,
                  attackerAt: playerToken,
                  targetAt: t,
                  downed: sheet.downed || sheet.stable || sheet.dead,
                  reachTiles: playerReachTiles,
                  hasLineOfSight: canSeeToken(t.id),
                });
                return (
                  <button
                    key={t.id}
                    type="button"
                    className="cui-button cui-button--ghost"
                    onClick={() => handleAttack(t.id)}
                    disabled={busy || blocked !== null}
                    title={blocked ?? `Swing at ${label(t.id)} (${hitPoints(monsterCurrentHp(t))} left). Free, always.`}
                  >
                    {label(t.id)}
                  </button>
                );
              })}
            </div>

            {/* The Battle Master's half of the level-3 branch, on screen at
                last. Both cold readers reasoned that this option must come
                with combat buttons, went looking on the play screen, found
                nothing, and picked it anyway. rules/maneuvers.ts holds the
                rule; this is the button. It rides the Attack row's own path
                (SRD: a maneuver triggers "when you hit with a weapon attack"),
                so there is one attack resolver, not two. */}
            {maneuvers.length > 0 && (
              <div className={`lt-target-group${verbClass("Attack")}`}>
                <span className="cui-muted">
                  Maneuver ({superiorityDice} of {superiorityDiceMax} d{SUPERIORITY_DIE_SIDES} left):
                </span>
                {hostileTokens.length === 0 && <span className="cui-muted">nothing here</span>}
                {hostileTokens.length > 0 &&
                  maneuvers.map((maneuver) => {
                    const t = nearestHostile;
                    const blocked =
                      superiorityDice <= 0
                        ? "No superiority dice left. Any rest gives them all back."
                        : t
                          ? attackBlockedReason({
                              round,
                              attackerAt: playerToken,
                              targetAt: t,
                              downed: sheet.downed || sheet.stable || sheet.dead,
                              reachTiles: playerReachTiles,
                              hasLineOfSight: canSeeToken(t.id),
                            })
                          : "Nothing here to aim at.";
                    return (
                      <button
                        key={maneuver.id}
                        type="button"
                        className="cui-button cui-button--ghost"
                        disabled={busy || blocked !== null}
                        title={blocked ?? `${maneuver.plain} Spends one superiority die. Free, always.`}
                        onClick={() => t && handleAttack(t.id, maneuver.id)}
                      >
                        {maneuver.label}
                      </button>
                    );
                  })}
              </div>
            )}

            {spells.length > 0 && (
              <div className={`lt-target-group${verbClass("Cast")}`}>
                <span className="cui-muted">Cast:</span>
                {spells.map((entry) => {
                  const needsTarget = entry.effect ? spellNeedsTarget(entry.effect) : false;
                  // Aim at the nearest hostile rather than the first one in
                  // the list: a spell with a real range now refuses a target
                  // it cannot reach, so picking an arbitrary one would grey
                  // out a button that had a legal target standing next to it.
                  const target = needsTarget ? nearestHostile : undefined;
                  const blocked = castBlockedReason({
                    round,
                    entry,
                    casterAt: playerToken,
                    targetAt: target,
                    downed: sheet.downed || sheet.stable || sheet.dead,
                  });
                  return (
                    <button
                      key={entry.spell.name}
                      type="button"
                      className="cui-button cui-button--ghost"
                      disabled={busy || blocked !== null}
                      title={blocked ?? `${entry.spell.description} Reaches ${spellRangeFt(entry.spell.name)} feet. ${entry.spell.level === 0 ? "A cantrip: no slot spent." : `Spends one level ${entry.spell.level} slot.`}`}
                      onClick={() => handleCast(entry, target?.id ?? null)}
                    >
                      {entry.spell.name}
                    </button>
                  );
                })}
              </div>
            )}

            <div className={`lt-target-group${verbClass("Search")}`}>
              <span className="cui-muted">Search:</span>
              {(playspace?.props.length ?? 0) === 0 && <span className="cui-muted">nothing to search</span>}
              {playspace?.props.map((p) => (
                <button key={p.id} type="button" className="cui-button cui-button--ghost" onClick={() => handleSearch(p.id)} disabled={busy || sheet.downed || sheet.stable || sheet.dead}>
                  {propLabel(p)}
                </button>
              ))}
            </div>

            <div className={`lt-target-group${verbClass("Item")}`}>
              <span className="cui-muted">Item:</span>
              {sheet.consumables.filter((c) => c.uses > 0).length === 0 && <span className="cui-muted">nothing left to use</span>}
              {sheet.consumables
                .filter((c) => c.uses > 0)
                .map((item) => (
                  <button
                    key={item.name}
                    type="button"
                    className="cui-button cui-button--ghost"
                    onClick={() => handleUseItem(item.name)}
                    disabled={busy || sheet.downed || sheet.stable || sheet.dead}
                    title={item.description}
                  >
                    {item.name} ({item.uses})
                  </button>
                ))}
            </div>

            <div className={`lt-target-group${verbClass("Rest")}`}>
              <span className="cui-muted">Rest:</span>
              <button
                type="button"
                className="cui-button cui-button--ghost"
                onClick={() => handleRest("short")}
                disabled={busy || restBlockedByFight !== null || shortRestBlockedReason(sheet) !== null}
                title={restBlockedByFight ?? shortRestBlockedReason(sheet) ?? `Spend one hit die (${sheet.hitDiceRemaining} left) to get some health back. No credits, and you can do it as often as you have hit dice for.`}
              >
                Catch your breath
              </button>
              <button
                type="button"
                className="cui-button cui-button--ghost"
                onClick={() => handleRest("long")}
                disabled={busy || restBlockedByFight !== null || longRestBlockedReason(sheet) !== null}
                title={restBlockedByFight ?? longRestBlockedReason(sheet) ?? "Sleep the night through: full health, every hit die and spell slot back. No credits, but only once per day, and the day turns over when you win a fight or get somewhere new."}
              >
                Make camp
              </button>
            </div>

            {/* Both cold readers derived the identical degenerate strategy
                from the badges alone -- "stand in one room, hit things, camp,
                hit things, camp" -- because nothing anywhere told them which
                verbs were free. Every one of those verbs is free forever
                (DESIGN.md's cost model); the screen had just never said so. */}
            <p className="cui-muted lt-free-note">{FREE_FOREVER_LINE}</p>

            {note && <p className="flash">{note}</p>}
            <div className="composer">
              <textarea
                className="cui-input"
                rows={2}
                value={draft}
                placeholder="Talk to someone, ask a question, try anything..."
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleTalk();
                  }
                }}
                disabled={busy}
              />
              <div className="composer-bar">
                <button type="button" className="cui-button cui-button--ghost" onClick={() => setShowSheet((s) => !s)}>
                  {showSheet ? "Hide sheet" : "Character sheet"}
                </button>
                {/* Free, always: no CostBadge here or anywhere in the screen it opens. */}
                <button type="button" className="cui-button cui-button--ghost" onClick={() => openInventory()}>
                  Inventory
                </button>
                <button type="button" className="cui-button cui-button--ghost" onClick={() => setShowAbout((s) => !s)}>
                  {showAbout ? "Hide the rules" : "About the rules"}
                </button>
                <span className="spacer" />
                <button
                  type="button"
                  className={`cui-button cui-button--primary${verbClass("Talk")}`}
                  onClick={() => void handleTalk()}
                  // A dead character must not be able to spend a credit. The
                  // death panel offers a free way to carry on instead.
                  disabled={busy || sheet.dead}
                  title={CREDIT_BUYS.talk}
                >
                  Talk <CostBadge n={1} />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="lt-side">
          {showSheet && (
            <CharacterSheetPanel
              sheet={sheet}
              superiorityDice={superiorityDice}
              superiorityDiceMax={superiorityDiceMax}
              preview={levelUpPreview}
              pick={levelUpPick}
              levelUpAvailable={levelUpAvailable}
              onPick={setLevelUpPick}
              onBeginLevelUp={beginLevelUp}
              onConfirmLevelUp={confirmLevelUp}
              onCancelLevelUp={cancelLevelUp}
              onOpenInventory={openInventory}
            />
          )}
          {showAbout && <AboutRulesPanel onClose={() => setShowAbout(false)} />}
          <Panel>
            <h3 className="cui-subheading">Story so far</h3>
            <div className="chat lt-narration">
              {story.length === 0 && <p className="cui-muted chat-empty">Nothing has happened yet.</p>}
              {story.map((entry, i) => (
                <div key={i} className={`bubble ${entry.role}`}>
                  {entry.text}
                </div>
              ))}
              {busy && (
                <div className="bubble assistant thinking">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </div>
              )}
            </div>
          </Panel>
          <Panel>
            <h3 className="cui-subheading">Dice</h3>
            {diceLog.length === 0 && <p className="cui-muted">No rolls yet.</p>}
            {diceLog.map((d, i) => (
              <p key={i} className={`lt-dice-entry${d.hit ? " hit" : " miss"}`}>
                {d.text}
              </p>
            ))}
          </Panel>
        </div>
      </div>

      {inventoryView && (
        <InventoryScreen
          view={inventoryView}
          dollPlan={dollPlan}
          manifest={manifest.render}
          onSelectSlot={handleSelectSlot}
          onSelectBagCell={handleSelectBagCell}
          onDeselect={() => setInventorySelection(null)}
          onEquip={handleInventoryEquip}
          onUnequip={handleInventoryUnequip}
          onCancel={closeInventory}
          onOk={handleInventoryOk}
        />
      )}
    </div>
  );
}

/** One d-pad arrow. Its price badge is the repo rule; the sentence next to it is why the badge is there, which a bare glyph on one of four identical arrows never explained. */
function MoveButton({
  dir,
  paid,
  disabled,
  onStep,
}: {
  dir: Edge;
  paid: boolean;
  disabled: boolean;
  onStep: (dir: Edge) => void | Promise<void>;
}) {
  const title = moveButtonTitle(dir, paid);
  return (
    <button
      type="button"
      className="cui-button cui-button--secondary"
      onClick={() => void onStep(dir)}
      disabled={disabled}
      title={title}
      aria-label={title}
    >
      {dir} {paid && <CostBadge n={1} />}
    </button>
  );
}

// ── character sheet panel ───────────────────────────────────────────────

const ABILITY_ORDER: (keyof AbilityScores)[] = ["str", "dex", "con", "int", "wis", "cha"];

/** rules/spells.ts's spellSlotsForLevel throws past level 3 ("only covers character levels 1-3 at launch"); leveling has to respect the same ceiling rather than crash a caster's level-up. */
const LAUNCH_MAX_LEVEL = 3;

/**
 * The character sheet. Every number on it is tappable for a one-sentence
 * explanation (see `Explain`), because DESIGN.md's whole point about this
 * panel is that the real numbers stay inspectable, and a number nobody has
 * defined is not inspectable, it is decoration.
 */
/**
 * One gear row's body: a button that opens the inventory screen on that slot
 * when the panel has a door to it, plain text when it does not (a harness, a
 * preview). Spans inside, never a div or a p, because a button may only hold
 * phrasing content.
 */
function GearRowBody({
  role,
  onOpenInventory,
  children,
}: {
  role: GearRole;
  onOpenInventory?: (role?: GearRole) => void;
  children: ReactNode;
}) {
  if (!onOpenInventory) return <span className="lt-gear-row-button">{children}</span>;
  return (
    <button type="button" className="lt-gear-row-button" onClick={() => onOpenInventory(role)}>
      {children}
    </button>
  );
}

export function CharacterSheetPanel({
  sheet,
  superiorityDice,
  superiorityDiceMax,
  preview,
  pick,
  levelUpAvailable,
  onPick,
  onBeginLevelUp,
  onConfirmLevelUp,
  onCancelLevelUp,
  onOpenInventory,
}: {
  sheet: CharacterSheet;
  /** The Battle Master's pool lives on CharacterState, not the sheet, so it arrives as its own two numbers. Zero and zero for everyone else, and the row simply is not rendered. */
  superiorityDice: number;
  superiorityDiceMax: number;
  preview: LevelUpOutcome | null;
  pick: string | null;
  levelUpAvailable: boolean;
  onPick: (optionId: string) => void;
  onBeginLevelUp: () => void;
  onConfirmLevelUp: () => void;
  onCancelLevelUp: () => void;
  /**
   * NO `gearOptions` AND NO `onEquip` HERE (issue #15's restore list, but not
   * this one). Those fed the old tier PICKER, which is REPLACED rather than
   * restored: the inventory screen is now the one staged surface that
   * changes gear, so a second, unstaged writer on this panel would be two
   * equip models for one sheet. This is that screen's one door in: opens it,
   * with `role` pre-selected when a specific row was tapped. Equipping is
   * and stays FREE: no credit, no model call, no CostBadge anywhere here.
   */
  onOpenInventory?: (role?: GearRole) => void;
}) {
  const gear = gearView(sheet);
  const acFromGear = equipmentAcBonus(sheet);
  return (
    <Panel>
      <h3 className="cui-subheading">{sheet.name}</h3>
      <p className="cui-muted">
        {sheet.displayName} · Level {sheet.level} · <Explain term="proficiency">Proficiency +{sheet.proficiencyBonus}</Explain>
      </p>
      <div className="lt-sheet-vitals">
        <Explain term="hit points">
          HP {sheet.currentHp}/{sheet.maxHp}
        </Explain>
        {/* The armour is named by the GEAR TABLE where the gear table has it
            (armorDisplayLabel), so this parenthesis and the gear row below
            call one object one thing. The Knight used to read "AC 16 (chain
            mail)" here, "Plate Harness" in the row, and "Chain mail" again in
            the Carrying line: one suit of armour, three names, and only one of
            them the object the rarity ladder acts on. */}
        <Explain term="AC">
          AC {effectiveArmorClass(sheet)} ({armorDisplayLabel(sheet)}
          {acFromGear > 0 ? `, +${acFromGear} from gear` : ""})
        </Explain>
      </div>
      {sheet.appliedEffects.length > 0 && (
        <ul className="lt-applied-effects">
          {sheet.appliedEffects.map((effect, i) => (
            <li key={i} title={effect.technical}>
              {effect.plain}
            </li>
          ))}
        </ul>
      )}
      <div className="lt-sheet-abilities">
        {ABILITY_ORDER.map((a) => (
          <div
            key={a}
            className="lt-ability"
            title={`${ABILITY_NAME[a]}: the raw score is 1-20, average is 10. The number in parentheses is the modifier, the one that actually gets added to your rolls.`}
          >
            <span className="lt-ability-name">{a.toUpperCase()}</span>
            <span>
              {sheet.abilities[a]} ({sheet.modifiers[a] >= 0 ? "+" : ""}
              {sheet.modifiers[a]})
            </span>
          </div>
        ))}
      </div>
      {sheet.skills.length > 0 && (
        <p className="cui-muted">
          <Explain term="modifier">Skills</Explain>:{" "}
          {sheet.skills.map((s) => `${s.skill} ${s.bonus >= 0 ? "+" : ""}${s.bonus}${s.expertise ? " (expertise)" : ""}`).join(", ")}
        </p>
      )}
      {sheet.spellSlots && (
        <p className="cui-muted">
          <Explain term="spell slot">Spell slots</Explain>:{" "}
          {Object.entries(sheet.spellSlots)
            .map(([lvl, s]) => `level ${lvl}, ${s.max - s.used} of ${s.max} left`)
            .join("; ")}
        </p>
      )}
      <p className="cui-muted">
        <Explain term="hit die">Hit dice</Explain>: {sheet.hitDiceRemaining} of {sheet.level} (d{sheet.hitDieSides} each)
      </p>
      {superiorityDiceMax > 0 && (
        <p className="cui-muted">
          <Explain term="superiority dice">Superiority dice</Explain>: {superiorityDice} of {superiorityDiceMax} (d
          {SUPERIORITY_DIE_SIDES} each)
        </p>
      )}
      {gear && (
        <div className="lt-gear">
          <div className="lt-gear-heading-line">
            <h4 className="lt-gear-heading">Worn and carried</h4>
            <span className="lt-gear-attuned">{gear.attunedCounter}</span>
          </div>
          {/*
           * THE RARITY CHIP IS BACK (issue #15). It was pulled because
           * `equippableTiers` could only ever answer with the tier already
           * worn: showing a rank nobody could reach was worse than not
           * showing ranks at all. Loot (menu/equipment.ts's `equippableTiers`
           * comment has the full story) is the engine-owned grant that was
           * missing, so a piece found in the world now genuinely can be a
           * different tier from the one a character started in, and the
           * word, the pips and the rim-light cue this chip carries are true
           * again. Six rows now, GEAR_ROLES order: the three v1 slots
           * (`gear.slots`) plus ring, amulet and boots (`gear.accessorySlots`,
           * contract v2). A tap opens the inventory screen with that row
           * pre-selected -- the one staged surface that changes gear, not a
           * second writer beside it.
           */}
          <ul className="lt-gear-list">
            {gear.slots.map((slot) => (
              <li key={slot.role} className="lt-gear-row">
                <GearRowBody role={slot.role} onOpenInventory={onOpenInventory}>
                  <span className="lt-gear-line">
                    <span className="lt-gear-name">{slot.itemName}</span>
                    {slot.tier !== "common" && <span className={`lt-rarity lt-rarity--${slot.tier}`}>{RARITY_WORD[slot.tier]}</span>}
                    <span className="lt-gear-slot">{slot.slotLabel}</span>
                  </span>
                  <span className="lt-gear-effect" title={slot.technical}>
                    {slot.plain}
                  </span>
                </GearRowBody>
              </li>
            ))}
            {gear.accessorySlots.map((slot) => (
              <li key={slot.role} className="lt-gear-row">
                <GearRowBody role={slot.role} onOpenInventory={onOpenInventory}>
                  <span className="lt-gear-line">
                    <span className="lt-gear-name">{slot.itemName ?? `No ${slot.slotWord.toLowerCase()}`}</span>
                    {slot.tier && slot.tier !== "common" && <span className={`lt-rarity lt-rarity--${slot.tier}`}>{RARITY_WORD[slot.tier]}</span>}
                    <span className="lt-gear-slot">{slot.slotWord}</span>
                  </span>
                  <span className="lt-gear-effect">{slot.plain}</span>
                </GearRowBody>
              </li>
            ))}
          </ul>
          <p className="cui-muted lt-gear-totals">
            {gear.totalsLine}
            {gear.capNote ? ` ${gear.capNote}` : ""}
            {gear.saveCapNote ? ` ${gear.saveCapNote}` : ""}
          </p>
          {onOpenInventory && (
            <button type="button" className="cui-button cui-button--ghost lt-gear-open-inventory" onClick={() => onOpenInventory()}>
              Open inventory
            </button>
          )}
        </div>
      )}
      {/* The PACK, not the loadout: `packItems` drops the entries the three
          gear rows and the AC line above have already named, so the shield is
          not "Kite Shield" here and "Shield" there. Nothing is hidden from the
          dungeon master, which still sees the whole inventory. */}
      <p className="cui-muted">Carrying: {packItems(sheet).join(", ") || "nothing"}</p>
      {sheet.consumables.length > 0 && (
        <p className="cui-muted">
          Usable: {sheet.consumables.map((c) => `${c.name} x${c.uses}`).join(", ")}
        </p>
      )}

      {preview ? (
        <div className="lt-levelup-preview cui-card">
          <h4 className="cui-subheading">Level {preview.character.level}</h4>
          <ul className="lt-levelup-changes">
            {preview.changes.map((c, i) => (
              <li key={i}>{c.plain}</li>
            ))}
          </ul>
          {preview.choice && (
            <div className="lt-levelup-choice">
              <p className="cui-muted">{preview.choice.prompt}</p>
              <div className="lt-choice-options">
                {preview.choice.options.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`cui-card cui-card--interactive lt-levelup-option${pick === opt.id ? " lt-choice-picked" : ""}`}
                    aria-pressed={pick === opt.id}
                    onClick={() => onPick(opt.id)}
                  >
                    <strong>{opt.label}</strong>
                    <span className="cui-muted">{opt.plain}</span>
                    {opt.notYet && <span className="lt-choice-notyet">{opt.notYet}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="cui-stack-h">
            <button type="button" className="cui-button cui-button--ghost" onClick={onCancelLevelUp}>
              Not yet
            </button>
            <button
              type="button"
              className="cui-button cui-button--primary"
              disabled={Boolean(preview.choice) && !pick}
              onClick={onConfirmLevelUp}
            >
              {preview.choice && !pick ? "Pick one first" : "Level up"}
            </button>
          </div>
        </div>
      ) : sheet.level >= LAUNCH_MAX_LEVEL ? (
        <p className="cui-muted">Level {LAUNCH_MAX_LEVEL} is as far as this build's rules go for now.</p>
      ) : levelUpAvailable ? (
        <button type="button" className="cui-button cui-button--secondary" onClick={onBeginLevelUp}>
          Level up
        </button>
      ) : (
        <p className="cui-muted">
          Next level after {MILESTONES_PER_LEVEL - sheet.milestones} more of: a fight won, or a room the DM builds for you.
        </p>
      )}
    </Panel>
  );
}
