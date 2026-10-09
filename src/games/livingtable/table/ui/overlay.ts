/**
 * The table's on-screen text layer: banners, floating damage numbers, roll
 * plates, the dialogue box, the initiative strip and the story screen, drawn as DOM over
 * the Play canvas. "The canvas paints sprites, DOM paints type": the game's own
 * rule (the LivingTable.tsx readout comment), so this layer never touches the
 * board's pixels.
 *
 * Two treatments, switchable live with setStyle, that share one semantic palette
 * (red damage, gold crits, green healing, grey misses):
 *
 *   pixel      a chunky bitmap font (pixelFont.ts) drawn onto canvases at
 *              integer scales, in nine-slice pixel windows. No web font.
 *   storybook  system serif stacks only (Georgia, Palatino Linotype, Book
 *              Antiqua), with the ConjureOS core.css treatments replicated in
 *              this file's own CSS because the bench loads none of it: .cg-t2
 *              (a hairline stroke, a hard lip and a soft shadow on small labels)
 *              and .cg-num (SVG text with paint-order stroke-then-fill, a dark
 *              stroke, a hard-stop two-tone face and a drop shadow, for numerals
 *              and titles).
 *
 * It reads on any floor art because nothing is bare text: titles sit on a dark
 * ribbon, plates are opaque, and the floating numbers carry a dark outline and a
 * shadow. Storybook plates follow the page theme (parchment in light, ink in
 * dark) with the same selector contract the bench uses; pixel windows are one
 * fixed navy-and-cream skin in both.
 *
 * Contract with the Play lane (coordinates are CSS px from the HOST's top-left
 * corner; the host should be a non-scrolling box that frames the board, because
 * the layer is absolutely positioned inside it). Hooks for tests: every element
 * carries data-lto-* attributes, the root carries data-busy (the number of
 * animations in flight, 0 when idle), and the visible text is also in data-text
 * because pixel text is canvas.
 *
 * Layout rules that are easy to break: floats landing on one spot stack by the
 * ink really stacked there (not by their own heights); a roll plate over a point
 * starts clear of an ordinary damage number and steps up out of the way of taller
 * ones, so a verdict is never printed under a number (on a host too short for both
 * the number wins); and pixel text is laid out at the CSS size it is really drawn
 * at (cssScale in pixelFont.ts), which is not the nominal scale at a fractional
 * device pixel ratio such as 1.25, 1.75 or 2.75.
 *
 * Nothing here touches the DOM at import time (the bench registry is imported in
 * Node for validation). It imports the game's engine for types only.
 */

export type { ItemCardAction, ItemCardContent, TipContent } from "./tip";

// The public API lives in the modules below; everything importers have always read from here is re-exported unchanged.
export type {
  TextStyle,
  OverlayPoint,
  BannerKind,
  FloatKind,
  DialogueTone,
  DialogueLine,
  StoryOptions,
  TextSpeed,
  InitiativeSide,
  InitiativeEntry,
  PlateReadout,
  NarrationHandle,
  ContextMenuEntry,
  LootWindowItem,
  LootWindowOptions,
  LootWindow,
  StartAdventure,
  StartRoom,
  StartWriting,
  StartScreenOptions,
  StartScreen,
  StartHeroHook,
  StartHeroOptions,
  StartHero,
  EndingOutcome,
  EndingCardOptions,
  EndingCard,
  Overlay,
} from "./overlayTypes";
export { FLOAT_BASE_PX, FLOAT_GAP_PX } from "./overlayTheme";
export { floatStackIndex, floatStackTop, floatLift, sizeTier, verdictWords, stripHoldMs, dialogueBoxPx, storyPerPage } from "./overlayMath";
export { createStoryFlow } from "./story";
export type { StoryFlow, StoryFlowOptions, StoryCurrent } from "./story";
export type { RecentFloat } from "./overlayMath";
export {
  TEXT_SPEEDS,
  TEXT_SPEED_CPS,
  DEFAULT_TEXT_SPEED,
  textSpeedOf,
  typedChars,
  dialogueLines,
  wrapWords,
  paginateLines,
  dialoguePages,
  sameStory,
  createDialogueQueue,
} from "./dialogueQueue";
export type { DialogueInput, DialogueView, DialoguePress, DialogueQueueOptions, DialogueQueue } from "./dialogueQueue";
export {
  newPackItems,
  packItemText,
  drawerColumns,
  SETTING_CHOICES,
  settingValue,
  journalObjectives,
  journalProgress,
  journalRecent,
  DRAWER_TABS,
  toggleDrawerTab,
  usableDrawerTab,
  HUD_OPTIONS_MAX,
  OPTION_LABEL_MAX,
  OPTION_SHORT_MAX,
  LOG_RENDER_MAX,
  NOTICE_MS,
  NOTICE_OUT_MS,
  NOTICE_MAX,
  clipOptionLabel,
  optionsLayout,
  wrapClamp,
  logWindow,
  noticeOverflow,
} from "./hudHelpers";
export type { JournalObjective, OptionChoice } from "./hudHelpers";
export { MENU_MAX_WIDTH, MENU_MARGIN, MENU_GRACE_MS, LOOT_EMPTY_MS, menuWidth, menuPlacement, menuEntryName, menuEntries } from "./menuHelpers";
export type { MenuPlacement } from "./menuHelpers";
export {
  PREMISE_MAX,
  CARD_SUMMARY_MAX,
  HOOK_MAX,
  PROBLEMS_SHOWN,
  LOCATION_BASE_MS,
  LOCATION_MAX_MS,
  JOURNAL_RECENT_MAX,
  cardBadge,
  startCards,
  startRooms,
  excerpt,
  problemLines,
  premiseReady,
  nextWriteStage,
  writingLine,
  endingKicker,
  endingBannerKind,
  endingChoices,
  locationHoldMs,
  titleLines,
} from "./screenHelpers";
export type { StartCard, WriteStage, WriteEvent } from "./screenHelpers";
export { createOverlay } from "./createOverlay";
export type { HudAction, HudBar, PackSection, PackItem, HudOption, LogTone, HudLogLine, HudSave, HudJournal, HudState, HudSettings, DrawerTab, Hud } from "./hudTypes";
export { createHud } from "./createHud";
export { overlayDemo } from "./overlayDemo";
export type { OverlayDemoOptions } from "./overlayDemo";
