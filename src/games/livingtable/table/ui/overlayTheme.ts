/**
 * The overlay's timings, its colours and faces, the pixel palette and the serif stacks.
 */
import type { FloatKind, BannerKind } from "./overlayTypes";

// ---- timing (ms) ------------------------------------------------------------

export const BANNER_MS = 900;
export const BANNER_REDUCED_MS = 500;
export const FLOAT_MS = 900;
export const FLOAT_FADE_MS = 300;
export const FLOAT_RISE_PX = 16;
export const FLOAT_STACK_MS = 300;
/** A float's bottom edge stands this far above its anchor. */
export const FLOAT_BASE_PX = 4;
/** Clear air kept between the inked glyphs of floats stacked on one spot, and between a float and a plate. */
export const FLOAT_GAP_PX = 6;
/** The least a roll plate stands over its point, where there is no room to clear a damage number. */
export const PLATE_CLEAR_MIN_PX = 54;
/** How far a roll plate's pointer sticks out below it: the storybook diamond and the pixel caret. */
export const PLATE_TAIL_PX = 10;
export const PLATE_TAIL_PIXEL_PX = 13;
/** The share of a numeral's font size its capitals and figures rise above the baseline (a little generous, for the fonts that stand in). */
export const NUMERAL_CAP = 0.72;
export const PLATE_IN_MS = 170;
export const PLATE_HOLD_MS = 2000;
export const PLATE_HOLD_QUEUED_MS = 1100;
export const PLATE_OUT_MS = 220;
/** The dialogue box: the last entry waits about 3.5 s plus 40 ms a character (capped at 9 s) once it is all printed, then fades. */
export const STRIP_BASE_MS = 3500;
export const STRIP_PER_CHAR_MS = 40;
export const STRIP_MAX_MS = 9000;
/** Under reduced motion nothing animates, so the reading time is longer (it still clears). */
export const STRIP_REDUCED_FACTOR = 1.5;
export const STRIP_REDUCED_MAX_MS = 13500;
export const DIALOGUE_IN_MS = 170;
export const DIALOGUE_OUT_MS = 260;
/** The story screen fades in over this long. */
export const STORY_IN_MS = 220;
/** Standoff space kept clear of the board for text that is not story: the DM box below it, the turn strip above it. */
export const DOCK_BOTTOM_PX = 8;
export const DOCK_GAP_PX = 8;
export const TOP_PAD_PX = 8;
export const TOP_GAP_PX = 6;
/** The speaker tag in the dialogue box's corner is cut with a dot past this many characters. */
export const NARRATION_TAG_MAX = 16;

// ---- palettes ---------------------------------------------------------------

/** A numeral's face: light top, a mid tone at the cliff, a deep tone below it. */
export interface Face {
  top: string;
  mid: string;
  deep: string;
  outline: string;
}

export const FACES: Record<FloatKind | BannerKind, Face> = {
  damage: { top: "#ffb3a5", mid: "#ff5646", deep: "#d4302a", outline: "#2b0a0a" },
  crit: { top: "#fff4ae", mid: "#ffd34c", deep: "#e0891a", outline: "#3b1f00" },
  heal: { top: "#c8ffd6", mid: "#5be486", deep: "#1f9a49", outline: "#06260f" },
  miss: { top: "#f5f6fa", mid: "#c5c8d6", deep: "#868a9d", outline: "#15161f" },
  down: { top: "#ffffff", mid: "#fff1f1", deep: "#ff9c9c", outline: "#8f1024" },
  info: { top: "#e0f3ff", mid: "#84c9ff", deep: "#3a8de2", outline: "#08162f" },
  turn: { top: "#fff4ae", mid: "#ffd34c", deep: "#e0891a", outline: "#3b1f00" },
  enemy: { top: "#ffa293", mid: "#ff4e3f", deep: "#bd1f19", outline: "#2b0a0a" },
  initiative: { top: "#e8f6ff", mid: "#8fd0ff", deep: "#3f8fe0", outline: "#08162f" },
  victory: { top: "#fffbd0", mid: "#ffe061", deep: "#e8941a", outline: "#3b1f00" },
  defeat: { top: "#ff8f8f", mid: "#d93a48", deep: "#7c1020", outline: "#1f0409" },
};

export type FrameKey = "win" | "gold" | "red" | "blue";
export const BANNER_FRAME: Record<BannerKind, FrameKey> = { turn: "gold", enemy: "red", initiative: "blue", victory: "gold", defeat: "red" };

export const PX = {
  ink: "#f4ecd0",
  muted: "#98a5d8",
  gold: ["#fff3ad", "#ffc72a"] as const,
  good: ["#c2ffd2", "#59dd82"] as const,
  bad: ["#ffb0a4", "#ff5a4a"] as const,
  dark: "#05061a",
  shade: "rgba(5, 6, 26, 0.6)",
};

export const SERIF = 'Georgia, "Palatino Linotype", "Book Antiqua", Palatino, serif';
// Georgia's figures are old-style (a 4 sinks below the line), which reads oddly
// on a damage number, so numerals prefer the serifs whose figures are lining.
export const SERIF_NUM = '"Palatino Linotype", "Book Antiqua", Palatino, "Times New Roman", Georgia, serif';
