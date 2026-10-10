/**
 * The bench's dice tray: real polyhedral dice that tumble across a felt tray
 * and settle on a result the engine already decided. "The engine decides, the
 * tray only animates it honestly": nothing here ever picks a number. A roll is
 * handed the result of every die and the tray turns each die so the face
 * showing that number is the one facing you.
 *
 * Everything that matters is pure and runs in plain Node (the unit test proves
 * it): the polyhedra, the face numbering, the resting orientations, the
 * software renderer and the throw plan. Only the tray and the skin picker touch
 * the DOM, and only inside functions: the bench registry is bundled and imported
 * in Node for validation before it reaches a browser, so nothing here may touch
 * document, window or a canvas at import time.
 *
 *   dice      d4 tetrahedron, d6 cube, d8 octahedron, d10 pentagonal
 *             trapezohedron, d12 dodecahedron, d20 icosahedron. Generated, not
 *             drawn: vertices on a unit sphere, faces found from the face
 *             normals, every die convex (the test checks it).
 *   numbers   One numeral per face, pixelFont.ts glyphs, upright at rest. d6 to
 *             d20 put opposite faces at sides + 1 (a d6 shows 1 opposite 6).
 *             d4: ONE numeral per face, at its centre (a flat-faced d4, not the
 *             corner-numbered kind), and the result is the face turned to you.
 *             d10: the tenth face reads "10", not "0", so the number on the
 *             die is the number in the log. A 6 or a 9 on a die that has both
 *             is underlined so it cannot be read upside down.
 *   render    Low resolution (a 24 to 56 px sprite), flat shaded per face from a
 *             light at the upper left in 3 or 4 tones of the skin's ramp, a 1 px
 *             dark outline round the silhouette and a lighter-than-outline line
 *             along every edge between two faces. No gradients and no smoothing.
 *             Numerals are bitmap glyphs rotated in 90 degree steps to the
 *             face's projected up direction (never a free rotation, so they stay
 *             crisp), in EVERY state (waiting, tumbling, settled, the skin
 *             picker). Drawn on faces turned to you enough to read, and only
 *             where they fit inside the face: the 5 by 7 pixelFont glyph first,
 *             then a compact 3 by 5 digit set when the face is too small for it
 *             (a d12 or d20 at the tray's smallest size), so a small die keeps
 *             its numbers. The front face always carries its number.
 *   scaling   The whole tray (felt, rim, dice, text) is composed on ONE low
 *             resolution canvas at 1:1 and then drawn up to the screen at a whole
 *             number of device pixels per tray pixel (pickScale: about 2 CSS px
 *             each) with smoothing off, the same rule pixelFont.ts follows, so the
 *             dice and the type are the same grain.
 *   skins     Data (DiceSkin): a ramp, an edge colour, a numeral colour, a finish
 *             and an optional deterministic speckle or marble. Add one to the
 *             DICE_SKINS array (or registerDiceSkin it at runtime) and it works.
 *   the roll  planRoll() builds a throw from a seed: the die's position is a
 *             straight run FOLDED at the tray walls (so it bounces, and lands on
 *             its slot exactly), its spin decays to nothing, it hops and settles.
 *             About 1.2 s, deterministic for a seed, and under reduced motion the
 *             dice just appear settled.
 *
 * Contract with the Play lane: createDiceTray(host, skinId) puts a tray inside
 * host (a box the orchestrator places beside the board, or under it on a phone);
 * the tray fills the host's width up to 360 px and is 160 to 200 px tall, and it
 * lays itself out again when the host resizes or first appears. Four dice at most
 * (any more are dropped). Every promise it hands back resolves, so nothing a
 * caller awaits can hang: roll() when the dice rest (at once under reduced
 * motion, in a hidden host, or after skip()); awaitRoll() on the player's tap or
 * Space or Enter, and also when a roll(), clear() or destroy() makes the wait
 * moot, so check your own state after an await, as with Overlay.banner. While
 * waiting the tray is a role=button with a tab stop named by the prompt; the
 * result is announced through a polite live region. Hooks for tests: the root
 * carries data-ltd-root, data-state (empty, waiting, rolling, settled), data-skin,
 * data-dice ("d20=18,d8=5") and data-text (the label and detail, or the prompt
 * while waiting), because the pixels are canvas.
 *
 * Foe looks: a roll may carry skin (a skin id), tray (a TrayLook id) and who (a
 * caption such as "The goblin rolls") for THAT throw only. The tray repaints in
 * that look (a 150 ms crossfade, instant under reduced motion), keeps it until the
 * next roll, and a roll, awaitRoll, setSkin or clear without them goes back to the
 * player's own skin and PLAYER_TRAY_ID. The root also carries data-tray and
 * data-who. Which look a creature gets is foeDice.ts; the foe skins live in
 * FOE_DICE_SKINS (never DICE_SKINS, never in the shop) and the trays in TRAY_LOOKS.
 * renderTrayPreview / composeTrayStill draw a small still of any look for other views.
 */
import { CELL_H, LINE_GAP, deviceScale, paintBitmap, pixelText, rasterize, textWidth, wrapWidth, type PixelBitmap, type PixelColor } from "./pixelFont";

// ---- the public contract ----------------------------------------------------

export type DieKind = "d4" | "d6" | "d8" | "d10" | "d12" | "d20";
/** matte is flat; gloss adds a 1 px highlight along the lit side of the brightest face; metal adds a sharp diagonal highlight band across the lit faces. */
export type DiceFinish = "matte" | "gloss" | "metal";

/** A deterministic pattern painted onto the die's body: it sticks to the die as it turns. */
export interface DicePattern {
  kind: "speckle" | "marble";
  /** Speck or vein colour, "#rrggbb". */
  color: string;
  /** speckle: the share of the surface that is speckled (0.05 is sparse). marble: how wide the veins are (0.08 is thin). */
  amount: number;
  seed?: number;
}

export interface DiceSkin {
  id: string;
  name: string;
  /** Display only: no purchase is wired. 0 means free. */
  priceCredits: number;
  /** Three or four body colours, "#rrggbb", lightest first. The lit faces take the first. */
  ramp: readonly string[];
  /** Outline and edge colour, darker than the darkest ramp step. */
  edge: string;
  numeral: string;
  /** A 1 px halo round every numeral, or null for none. */
  numeralOutline: string | null;
  finish: DiceFinish;
  /** Highlight colour for gloss and metal. Defaults to a pale lift of the lightest ramp step. */
  shine?: string;
  pattern?: DicePattern;
}

export interface RollRequest {
  dice: readonly { kind: DieKind; result: number }[];
  /** The sum, for example "18 + 4 = 22 vs 15". */
  label?: string;
  /** The verdict, for example "HIT". */
  detail?: string;
  tone?: "good" | "bad" | "plain";
  /** Optional: fixes the throw so a screenshot or a test can repeat it. Omit for a fresh throw each time. */
  seed?: number;
  /** A skin id (the shop's list or the foe list) for THIS throw only: the dice take that skin, and the next throw without one goes back to the player's own. */
  skin?: string;
  /** A TrayLook id (TRAY_LOOKS) for THIS throw only: the tray is repainted in that look and keeps it until the next roll, which without one goes back to the player's own (PLAYER_TRAY_ID). */
  tray?: string;
  /** Whose roll this is, a short caption such as "The goblin rolls": a small plaque on the rim in the look's own accent colour, until the next roll. */
  who?: string;
}

export interface DiceTray {
  /** Show the dice waiting (a gentle idle wobble) with a prompt like "Tap to roll", and resolve when the player taps or clicks the tray or presses Space or Enter while it has focus. */
  awaitRoll(prompt: string, preview: readonly DieKind[]): Promise<void>;
  /** Throw these dice and settle each on its result; resolves when they rest. Then shows label (for example "18 + 4 = 22 vs 15") and detail ("HIT") under them until the next roll. */
  roll(req: RollRequest): Promise<void>;
  /** Sets the PLAYER's own skin (the shop's list only). If a foe's look is showing, the tray goes back to the player's look at once, so the shop always shows what it picked. */
  setSkin(id: string): void;
  /** The player's own skin, whatever look the current throw is in. */
  skin(): DiceSkin;
  /** The tray look showing now: the player's (PLAYER_TRAY_ID) or the foe's for this throw. */
  look(): TrayLook;
  /** Skip any running animation to its end state at once (the player pressed Space during the monster's turn). */
  skip(): void;
  clear(): void;
  destroy(): void;
}

export interface DiceTrayOptions {
  /** Base seed for throws that do not carry their own: each later throw is derived from it, so the same seed repeats the same run of throws. Default: random. */
  seed?: number;
  /** The clock in ms the animation reads. Default performance.now. A test passes its own to freeze a frame. */
  now?: () => number;
}

// ---- the skins --------------------------------------------------------------
//
// Data, so a new roller skin (or a sold one) is one more entry and no code. A
// ramp runs lightest to darkest; the lit faces take the first step, the front
// face of a resting die usually the second. Colours are picked to read on the
// dark green felt and to sit beside the game's palette (cream, gold, ember,
// steel, sky): bone is the palette's CREAM and EARTH_DARK, steel its STEEL ramp.

const SKINS: DiceSkin[] = [
  {
    id: "bone",
    name: "Bone",
    priceCredits: 0,
    ramp: ["#f6eed4", "#e4d7ae", "#c8b88a", "#9f8d62"],
    edge: "#3a2414",
    numeral: "#3a2010",
    numeralOutline: null,
    finish: "matte",
    pattern: { kind: "speckle", color: "#b4a474", amount: 0.035, seed: 3 },
  },
  {
    id: "obsidian",
    name: "Obsidian",
    priceCredits: 150,
    ramp: ["#5a5a78", "#3c3c58", "#262638", "#161622"],
    edge: "#06060c",
    numeral: "#ffd34c",
    numeralOutline: null,
    finish: "gloss",
    shine: "#c4c4ff",
  },
  {
    id: "ruby",
    name: "Blood Ruby",
    priceCredits: 200,
    ramp: ["#ff8a78", "#e8453f", "#b02030", "#701028"],
    edge: "#2a0610",
    numeral: "#fff0d0",
    numeralOutline: "#5a0a1c",
    finish: "gloss",
    shine: "#ffd8d0",
  },
  {
    id: "emerald",
    name: "Emerald",
    priceCredits: 250,
    ramp: ["#b4f8d4", "#5ee0a4", "#25b078", "#127458"],
    edge: "#032a1e",
    numeral: "#f4fff4",
    numeralOutline: "#06382a",
    finish: "gloss",
    shine: "#ffffff",
  },
  {
    id: "arcane",
    name: "Arcane",
    priceCredits: 300,
    ramp: ["#c9a8ff", "#9a6cf0", "#6a44c0", "#3e2686"],
    edge: "#160a38",
    numeral: "#f6f0ff",
    numeralOutline: "#1c0e48",
    finish: "gloss",
    shine: "#efe4ff",
    pattern: { kind: "speckle", color: "#c4f6ff", amount: 0.07, seed: 11 },
  },
  {
    id: "steel",
    name: "Steel",
    priceCredits: 350,
    ramp: ["#dce8ff", "#a8c0e8", "#748ebc", "#3f5584"],
    edge: "#141c36",
    numeral: "#10183a",
    numeralOutline: null,
    finish: "metal",
    shine: "#ffffff",
  },
  {
    id: "gilded",
    name: "Gilded",
    priceCredits: 400,
    ramp: ["#ffeea0", "#f2c64a", "#c88c28", "#8a5a18"],
    edge: "#3a2008",
    numeral: "#4a2a0a",
    numeralOutline: null,
    finish: "metal",
    shine: "#fffbe0",
  },
  {
    id: "magma",
    name: "Magma",
    priceCredits: 450,
    ramp: ["#7a6664", "#54464a", "#382e34", "#201a20"],
    edge: "#0c0809",
    numeral: "#ffd070",
    numeralOutline: "#3a0c04",
    finish: "gloss",
    shine: "#ffc690",
    pattern: { kind: "marble", color: "#ff6a2c", amount: 0.13, seed: 5 },
  },
];

export const DICE_SKINS: readonly DiceSkin[] = SKINS;

const HEX = /^#[0-9a-f]{6}$/i;

/** Everything wrong with a skin, as sentences; empty when it is fit to ship. Used by registerDiceSkin and the unit test. */
export function skinProblems(skin: DiceSkin): string[] {
  const out: string[] = [];
  if (!/^[a-z][a-z0-9-]*$/.test(skin.id)) out.push("id must be lowercase letters, digits and hyphens");
  if (!skin.name.trim()) out.push("name is empty");
  if (!Number.isInteger(skin.priceCredits) || skin.priceCredits < 0) out.push("priceCredits must be a whole number, 0 or more");
  if (skin.ramp.length < 3 || skin.ramp.length > 4) out.push("ramp must have 3 or 4 colours");
  for (const c of [...skin.ramp, skin.edge, skin.numeral, skin.numeralOutline ?? skin.edge, skin.shine ?? skin.edge, skin.pattern?.color ?? skin.edge]) {
    if (!HEX.test(c)) out.push(`${c} is not a #rrggbb colour`);
  }
  if (!["matte", "gloss", "metal"].includes(skin.finish)) out.push("finish must be matte, gloss or metal");
  if (skin.pattern && !(skin.pattern.amount > 0 && skin.pattern.amount < 1)) out.push("pattern.amount must be between 0 and 1");
  return out;
}

/** Add a skin at runtime (a sold skin fetched later). Refuses a bad or duplicate skin by returning false. */
export function registerDiceSkin(skin: DiceSkin): boolean {
  if (skinProblems(skin).length > 0 || SKINS.some((s) => s.id === skin.id)) return false;
  SKINS.push(skin);
  return true;
}

function findSkin(id: string | undefined): DiceSkin | undefined {
  return id === undefined ? undefined : SKINS.find((s) => s.id === id);
}

// ---- colour helpers ---------------------------------------------------------

type RGB = readonly [number, number, number];

function hexRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}

/** WCAG relative luminance, for the skin tests. */
export function luminance(hex: string): number {
  const [r, g, b] = hexRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

interface Prepared {
  ramp: RGB[];
  edge: RGB;
  /** The line between two faces: the edge colour lifted a little toward the darkest body step, so it reads as a crease and not a second outline. */
  crease: RGB;
  numeral: RGB;
  numeralOutline: RGB | null;
  shine: RGB;
  finish: DiceFinish;
  pattern: { kind: "speckle" | "marble"; color: RGB; amount: number; seed: number } | null;
}

const prepared = new WeakMap<DiceSkin, Prepared>();

function prepare(skin: DiceSkin): Prepared {
  let p = prepared.get(skin);
  if (p) return p;
  const ramp = skin.ramp.map(hexRgb);
  const edge = hexRgb(skin.edge);
  p = {
    ramp,
    edge,
    crease: mix(edge, ramp[ramp.length - 1] as RGB, 0.4),
    numeral: hexRgb(skin.numeral),
    numeralOutline: skin.numeralOutline ? hexRgb(skin.numeralOutline) : null,
    shine: skin.shine ? hexRgb(skin.shine) : mix(ramp[0] as RGB, [255, 255, 255], 0.6),
    finish: skin.finish,
    pattern: skin.pattern ? { kind: skin.pattern.kind, color: hexRgb(skin.pattern.color), amount: skin.pattern.amount, seed: skin.pattern.seed ?? 1 } : null,
  };
  prepared.set(skin, p);
  return p;
}

// ---- vectors, matrices, noise -----------------------------------------------

export type Vec3 = readonly [number, number, number];
/** Row-major 3x3 rotation. Applied to a model-space vector it gives a view-space one: x right, y UP, z toward the viewer. */
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => mul(a, 1 / (len(a) || 1));

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function matVec(m: Mat3, v: Vec3): Vec3 {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}

export function matMul(a: Mat3, b: Mat3): Mat3 {
  const out: number[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) out.push((a[r * 3] as number) * (b[c] as number) + (a[r * 3 + 1] as number) * (b[3 + c] as number) + (a[r * 3 + 2] as number) * (b[6 + c] as number));
  }
  return out as unknown as Mat3;
}

export function transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/** Rotation by `angle` radians about a UNIT axis. */
export function rotAxis(axis: Vec3, angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  const [x, y, z] = axis;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}

const rotX = (a: number): Mat3 => rotAxis([1, 0, 0], a);
const rotY = (a: number): Mat3 => rotAxis([0, 1, 0], a);
const rotZ = (a: number): Mat3 => rotAxis([0, 0, 1], a);
const DEG = Math.PI / 180;

/** A small deterministic generator (mulberry32): the same seed always throws the same throw. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1) ^ Math.imul(seed | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

const LATTICE = 32;
let lattice: Float32Array | null = null;

/** Smooth value noise in 0..1 on a 3D lattice (a table of 32 cubed hashed values, wrapping): the marble's raw material, written flat (no closures) so it is cheap enough to run for every pixel of every die every frame. */
function noise3(x: number, y: number, z: number, seed: number): number {
  if (!lattice) {
    lattice = new Float32Array(LATTICE ** 3);
    for (let i = 0; i < lattice.length; i++) lattice[i] = hash3(i & 31, (i >> 5) & 31, i >> 10, 4242);
  }
  const tab = lattice;
  const fxf = Math.floor(x);
  const fyf = Math.floor(y);
  const fzf = Math.floor(z);
  const fx = smooth(x - fxf);
  const fy = smooth(y - fyf);
  const fz = smooth(z - fzf);
  const xi = (fxf + seed * 7) & 31;
  const yi = (fyf + seed * 13) & 31;
  const zi = (fzf + seed * 29) & 31;
  const x0 = xi;
  const x1 = (xi + 1) & 31;
  const y0 = yi << 5;
  const y1 = ((yi + 1) & 31) << 5;
  const z0 = zi << 10;
  const z1 = ((zi + 1) & 31) << 10;
  const a = tab[x0 + y0 + z0] as number;
  const b = tab[x1 + y0 + z0] as number;
  const c = tab[x0 + y1 + z0] as number;
  const d = tab[x1 + y1 + z0] as number;
  const e = tab[x0 + y0 + z1] as number;
  const f = tab[x1 + y0 + z1] as number;
  const g = tab[x0 + y1 + z1] as number;
  const h = tab[x1 + y1 + z1] as number;
  const ab = a + (b - a) * fx;
  const cd = c + (d - c) * fx;
  const ef = e + (f - e) * fx;
  const gh = g + (h - g) * fx;
  const lo = ab + (cd - ab) * fy;
  const hi = ef + (gh - ef) * fy;
  return lo + (hi - lo) * fz;
}

// ---- the polyhedra ----------------------------------------------------------

export const DIE_KINDS: readonly DieKind[] = ["d4", "d6", "d8", "d10", "d12", "d20"];
export const DIE_SIDES: Readonly<Record<DieKind, number>> = { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20 };

export interface DieFace {
  /** Vertex indices, counter-clockwise seen from outside. */
  readonly verts: readonly number[];
  readonly normal: Vec3;
  readonly centre: Vec3;
  /** A unit vector in the face's plane: the way "up" points for the numeral. A triangle, pentagon or kite points at its first vertex, a square at the middle of an edge. */
  readonly up: Vec3;
  /** The number on this face, 1 to sides. */
  readonly number: number;
}

export interface DieEdge {
  readonly a: number;
  readonly b: number;
  /** The two faces that meet along it. */
  readonly faces: readonly [number, number];
}

export interface DieGeometry {
  readonly kind: DieKind;
  readonly sides: number;
  /** On the unit sphere (the farthest is exactly 1). */
  readonly vertices: readonly Vec3[];
  readonly faces: readonly DieFace[];
  readonly edges: readonly DieEdge[];
}

const PHI = (1 + Math.sqrt(5)) / 2;

function signs3(): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [1, -1]) for (const y of [1, -1]) for (const z of [1, -1]) out.push([x, y, z]);
  return out;
}

/** The vertices of the regular solids, and the directions their faces point (found from them, never typed in). */
function platonic(kind: "d4" | "d6" | "d8" | "d12" | "d20"): { vertices: Vec3[]; normals: Vec3[] } {
  const cube = signs3();
  const icosa: Vec3[] = [];
  for (const a of [1, -1]) for (const b of [1, -1]) icosa.push([0, a, b * PHI], [a, b * PHI, 0], [b * PHI, 0, a]);
  // The dodecahedron is the icosahedron's dual: its vertices are the directions of the icosahedron's face centres, so the two always line up. A face is three vertices that are all one edge (2) apart.
  const dodeca: Vec3[] = [];
  for (let i = 0; i < icosa.length; i++) {
    for (let j = i + 1; j < icosa.length; j++) {
      for (let k = j + 1; k < icosa.length; k++) {
        const [a, b, c] = [icosa[i] as Vec3, icosa[j] as Vec3, icosa[k] as Vec3];
        if ([sub(a, b), sub(b, c), sub(a, c)].every((d) => Math.abs(len(d) - 2) < 1e-6)) dodeca.push(norm(add(add(a, b), c)));
      }
    }
  }
  switch (kind) {
    case "d4": {
      const vertices: Vec3[] = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
      return { vertices, normals: vertices.map((v) => mul(v, -1)) };
    }
    case "d6":
      return { vertices: cube, normals: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] };
    case "d8":
      return { vertices: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], normals: cube };
    case "d12":
      return { vertices: dodeca, normals: icosa };
    default:
      return { vertices: icosa, normals: dodeca };
  }
}

/** The vertices that lie on the plane of `normal`, in counter-clockwise order seen from outside, starting from the first one found. */
function faceFromNormal(vs: readonly Vec3[], normal: Vec3): number[] {
  const n = norm(normal);
  let best = -Infinity;
  for (const v of vs) best = Math.max(best, dot(v, n));
  const picked: number[] = [];
  vs.forEach((v, i) => {
    if (dot(v, n) > best - 1e-6) picked.push(i);
  });
  const pts = picked.map((i) => vs[i] as Vec3);
  const c = mul(pts.reduce((s, p) => add(s, p), [0, 0, 0] as Vec3), 1 / pts.length);
  const ref = norm(sub(vs[picked[0] as number] as Vec3, c));
  const angle = (i: number): number => {
    const d = sub(vs[i] as Vec3, c);
    return (Math.atan2(dot(cross(ref, d), n), dot(ref, d)) + 2 * Math.PI) % (2 * Math.PI);
  };
  return picked.sort((a, b) => angle(a) - angle(b));
}

/**
 * The pentagonal trapezohedron: two apexes on the axis and a ring of ten
 * vertices zigzagging above and below the equator, ten kite faces. The kites are
 * flat only when the ring sits at height tan(18 degrees) squared of the apex
 * height (derived in the unit test); the ring radius is free, 0.86 gives a die
 * a die a little taller than it is wide. The axis is y, so a settled d10 stands on a point.
 */
function trapezohedron(): { vertices: Vec3[]; faces: number[][] } {
  const r = 0.86;
  const h = Math.tan(18 * DEG) ** 2;
  const vertices: Vec3[] = [[0, 1, 0], [0, -1, 0]];
  for (let k = 0; k < 10; k++) vertices.push([r * Math.cos(36 * DEG * k), k % 2 === 0 ? h : -h, r * Math.sin(36 * DEG * k)]);
  const ring = (k: number): number => 2 + (((k % 10) + 10) % 10);
  const faces: number[][] = [];
  for (let i = 0; i < 5; i++) faces.push([0, ring(2 * i), ring(2 * i + 1), ring(2 * i + 2)]);
  for (let i = 0; i < 5; i++) faces.push([1, ring(2 * i + 1), ring(2 * i + 2), ring(2 * i + 3)]);
  return { vertices, faces };
}

const geometryCache = new Map<DieKind, DieGeometry>();

/** The die's solid, built once. Pure. */
export function geometry(kind: DieKind): DieGeometry {
  const hit = geometryCache.get(kind);
  if (hit) return hit;
  let vs: Vec3[];
  let loops: number[][];
  if (kind === "d10") {
    const t = trapezohedron();
    vs = t.vertices;
    loops = t.faces;
  } else {
    const p = platonic(kind);
    const far = Math.max(...p.vertices.map(len));
    vs = p.vertices.map((v) => mul(v, 1 / far));
    loops = p.normals.map((n) => faceFromNormal(vs, n));
  }
  const far = Math.max(...vs.map(len));
  vs = vs.map((v) => mul(v, 1 / far));

  // Orient each loop outward and measure it.
  const shells = loops.map((loop) => {
    const pts = loop.map((i) => vs[i] as Vec3);
    const centre = mul(pts.reduce((s, p) => add(s, p), [0, 0, 0] as Vec3), 1 / pts.length);
    let normal = norm(cross(sub(pts[1] as Vec3, pts[0] as Vec3), sub(pts[2] as Vec3, pts[0] as Vec3)));
    let verts = loop;
    if (dot(normal, centre) < 0) {
      normal = mul(normal, -1);
      verts = [loop[0] as number, ...loop.slice(1).reverse()];
    }
    const first = vs[verts[0] as number] as Vec3;
    const second = vs[verts[1] as number] as Vec3;
    const towards = verts.length === 4 && kind === "d6" ? mul(add(first, second), 0.5) : first;
    return { verts, normal, centre, up: norm(sub(towards, centre)) };
  });

  // Numbers: a d4 numbers its faces in order; every other die pairs each face with the one opposite and gives the pair n and sides + 1 - n.
  const sides = DIE_SIDES[kind];
  const numbers = new Array<number>(shells.length).fill(0);
  if (kind === "d4") shells.forEach((_, i) => (numbers[i] = i + 1));
  else {
    let next = 1;
    shells.forEach((s, i) => {
      if (numbers[i]) return;
      let opp = -1;
      let bestDot = Infinity;
      shells.forEach((o, j) => {
        const d = dot(s.normal, o.normal);
        if (j !== i && d < bestDot) {
          bestDot = d;
          opp = j;
        }
      });
      numbers[i] = next;
      numbers[opp] = sides + 1 - next;
      next++;
    });
  }

  const faces: DieFace[] = shells.map((s, i) => ({ verts: s.verts, normal: s.normal, centre: s.centre, up: s.up, number: numbers[i] as number }));
  const seen = new Map<string, { a: number; b: number; faces: number[] }>();
  faces.forEach((f, fi) => {
    f.verts.forEach((a, k) => {
      const b = f.verts[(k + 1) % f.verts.length] as number;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const e = seen.get(key) ?? { a: Math.min(a, b), b: Math.max(a, b), faces: [] };
      e.faces.push(fi);
      seen.set(key, e);
    });
  });
  const edges: DieEdge[] = [...seen.values()].map((e) => ({ a: e.a, b: e.b, faces: [e.faces[0] as number, e.faces[1] as number] }));
  const g: DieGeometry = { kind, sides, vertices: vs, faces, edges };
  geometryCache.set(kind, g);
  return g;
}

/** Which face (an index into geometry(kind).faces) carries this number. Out of range results are clamped. */
export function faceIndexOf(kind: DieKind, result: number): number {
  const g = geometry(kind);
  const want = Math.min(g.sides, Math.max(1, Math.round(result)));
  return g.faces.findIndex((f) => f.number === want);
}

// ---- resting orientations ---------------------------------------------------

/**
 * How each die is seen when it comes to rest: the result face turned to the
 * viewer, then the whole die tipped a little so you also see its top and right
 * side (a die seen dead face-on is a flat polygon). pitch tips the top toward
 * you, a negative yaw shows the right-hand side. The tip is kept below half the
 * angle to the nearest neighbouring face (20.9 degrees on a d20) so the result
 * face is always the one most facing you; the unit test checks every result of
 * every die. fit is how much of the sprite's radius the die fills, chosen so the
 * six look like dice of one set (a d20 fills its sprite, a d4 needs scaling up);
 * dx and dy shift the die so its silhouette is centred (the unit test checks that
 * every die clears the sprite's edge).
 */
const VIEW: Readonly<Record<DieKind, { pitch: number; yaw: number; fit: number; dx: number; dy: number }>> = {
  d4: { pitch: 30, yaw: -20, fit: 1.2, dx: 3, dy: 0 },
  d6: { pitch: 24, yaw: -26, fit: 1.1, dx: 0, dy: 0 },
  d8: { pitch: 19, yaw: -18, fit: 1.1, dx: 0, dy: 0 },
  d10: { pitch: 14, yaw: -12, fit: 1.14, dx: 0, dy: 0 },
  d12: { pitch: 18, yaw: -16, fit: 1.02, dx: 0, dy: 0 },
  d20: { pitch: 11, yaw: -9, fit: 1.02, dx: 0, dy: 0 },
};

const tiltCache = new Map<DieKind, Mat3>();

function tilt(kind: DieKind): Mat3 {
  let m = tiltCache.get(kind);
  if (!m) {
    m = matMul(rotX(VIEW[kind].pitch * DEG), rotY(VIEW[kind].yaw * DEG));
    tiltCache.set(kind, m);
  }
  return m;
}

/** The rotation that turns a face to face the viewer with its numeral upright. */
export function alignFace(kind: DieKind, faceIndex: number): Mat3 {
  const f = geometry(kind).faces[faceIndex] as DieFace;
  const right = cross(f.up, f.normal);
  return [right[0], right[1], right[2], f.up[0], f.up[1], f.up[2], f.normal[0], f.normal[1], f.normal[2]];
}

/** The view rotation of a die at rest showing `result`. */
export function restOrientation(kind: DieKind, result: number): Mat3 {
  return matMul(tilt(kind), alignFace(kind, faceIndexOf(kind, result)));
}

/** The face most turned to the viewer under a rotation, with how far ahead of the runner-up it is (0 means a tie). */
export function frontFace(kind: DieKind, rot: Mat3): { index: number; facing: number; margin: number } {
  const g = geometry(kind);
  let best = -1;
  let bestZ = -Infinity;
  let second = -Infinity;
  g.faces.forEach((f, i) => {
    const z = matVec(rot, f.normal)[2];
    if (z > bestZ) {
      second = bestZ;
      bestZ = z;
      best = i;
    } else if (z > second) second = z;
  });
  return { index: best, facing: bestZ, margin: bestZ - second };
}

// ---- the software renderer --------------------------------------------------

/** Where the light comes from, in view space (y up): the upper left, in front. */
const LIGHT: Vec3 = norm([-0.5, 0.62, 0.6]);
/** A face turned less than this toward the viewer carries no numeral: it is too foreshortened to read. */
const NUMERAL_MIN_FACING = 0.5;
const MARGIN = 2;

export interface DieFaceView {
  readonly index: number;
  readonly number: number;
  /** The face normal's component toward the viewer: 1 is square on, 0 is edge on, negative is turned away. */
  readonly facing: number;
  /** Whether its numeral was drawn. */
  readonly shown: boolean;
}

export interface DieSprite {
  readonly size: number;
  /** size by size RGBA, straight alpha: every pixel is opaque or clear. */
  readonly data: Uint8ClampedArray<ArrayBuffer>;
  /** The faces turned toward the viewer, nearest first. */
  readonly faces: readonly DieFaceView[];
}

export interface RenderOptions {
  /** true (the default) draws a numeral on every face that fits one, false none, "front" only the face nearest the viewer. */
  numerals?: boolean | "front";
}

// -- numerals: pixelFont glyphs, rotated in quarter turns --

interface NumeralBitmap {
  w: number;
  h: number;
  /** 1 where the numeral's ink is. */
  ink: Uint8Array;
  /** 1 where the 1 px halo is. */
  rim: Uint8Array;
}

const numeralCache = new Map<string, NumeralBitmap>();

function rotateQuarter(src: Uint8Array, w: number, h: number): Uint8Array {
  // 90 degrees clockwise: the new image is h wide and w tall.
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[x * h + (h - 1 - y)] = src[y * w + x] as number;
  return out;
}

/**
 * The compact digit set: 3 columns by 5 rows, for a face too small to hold the
 * 5 by 7 pixelFont glyph (a d20 or a d12 at the tray's smallest size). A small
 * die shows these rather than drop its numbers or clip the big glyph.
 */
const COMPACT_DIGITS: Readonly<Record<string, readonly string[]>> = {
  "0": ["###", "#.#", "#.#", "#.#", "###"],
  "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["###", "..#", "###", "#..", "###"],
  "3": ["###", "..#", "###", "..#", "###"],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "5": ["###", "#..", "###", "..#", "###"],
  "6": ["###", "#..", "###", "#.#", "###"],
  "7": ["###", "..#", ".#.", ".#.", ".#."],
  "8": ["###", "#.#", "###", "#.#", "###"],
  "9": ["###", "#.#", "###", "..#", "###"],
};
const COMPACT_ROWS = 5;

/** The ink of a compact numeral: rows of 1 and 0, digits one column apart. */
function compactInk(text: string): { rows: Uint8Array[]; w: number } {
  const rows = Array.from({ length: COMPACT_ROWS }, () => [] as number[]);
  [...text].forEach((ch, i) => {
    const g = COMPACT_DIGITS[ch] ?? COMPACT_DIGITS["0"] as readonly string[];
    for (let y = 0; y < COMPACT_ROWS; y++) {
      if (i > 0) (rows[y] as number[]).push(0);
      for (const c of g[y] as string) (rows[y] as number[]).push(c === "#" ? 1 : 0);
    }
  });
  return { rows: rows.map((r) => Uint8Array.from(r)), w: (rows[0] as number[]).length };
}

/** The numeral as ink and halo planes, turned `steps` quarter turns clockwise. Underlined when it could be read upside down. `compact` is the 3 by 5 set. */
function numeralBitmap(text: string, underline: boolean, steps: number, compact = false): NumeralBitmap {
  const key = `${text}|${underline ? 1 : 0}|${steps}|${compact ? "c" : "f"}`;
  const hit = numeralCache.get(key);
  if (hit) return hit;
  const bmp: PixelBitmap | null = compact ? null : rasterize(text);
  const small = compact ? compactInk(text) : null;
  const capRows = compact ? COMPACT_ROWS : 7;
  const inkW = small ? small.w : (bmp as PixelBitmap).textW;
  const inkH = underline ? capRows + 2 : capRows;
  const w = inkW + 2;
  const h = inkH + 2;
  let ink: Uint8Array = new Uint8Array(w * h);
  for (let y = 0; y < capRows; y++) {
    for (let x = 0; x < inkW; x++) {
      const on = small ? (small.rows[y] as Uint8Array)[x] : (bmp as PixelBitmap).ink[((bmp as PixelBitmap).top + y) * (bmp as PixelBitmap).w + (bmp as PixelBitmap).left + x];
      if (on) ink[(y + 1) * w + x + 1] = 1;
    }
  }
  if (underline) for (let x = 0; x < inkW; x++) ink[(capRows + 2) * w + x + 1] = 1;
  let rim: Uint8Array = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (ink[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (ink[(y + dy) * w + x + dx] && y + dy >= 0 && y + dy < h && x + dx >= 0 && x + dx < w) rim[y * w + x] = 1;
        }
      }
    }
  }
  let cw = w;
  let ch = h;
  for (let s = 0; s < ((steps % 4) + 4) % 4; s++) {
    ink = rotateQuarter(ink, cw, ch);
    rim = rotateQuarter(rim, cw, ch);
    [cw, ch] = [ch, cw];
  }
  const out = { w: cw, h: ch, ink, rim };
  numeralCache.set(key, out);
  return out;
}

/** True when a face with both a 6 and a 9 on the die needs its 6 or 9 underlined. */
function needsUnderline(sides: number, value: number): boolean {
  return sides >= 9 && (value === 6 || value === 9);
}

// -- pixels --

function toneIndex(lambert: number, tones: number): number {
  const cuts = tones === 4 ? [0.8, 0.5, 0.22] : [0.74, 0.36];
  for (let i = 0; i < cuts.length; i++) if (lambert >= (cuts[i] as number)) return i;
  return tones - 1;
}

/** The pixels of a straight edge: one per row (or column, for a flat edge), the pixel the edge passes through at that row's centre. */
function lineCells(x0: number, y0: number, x1: number, y1: number, put: (x: number, y: number) => void): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (Math.abs(dy) >= Math.abs(dx)) {
    if (dy !== 0) {
      for (let y = Math.ceil(Math.min(y0, y1) - 0.5); y + 0.5 <= Math.max(y0, y1); y++) put(Math.floor(x0 + ((y + 0.5 - y0) / dy) * dx), y);
    }
  } else {
    for (let x = Math.ceil(Math.min(x0, x1) - 0.5); x + 0.5 <= Math.max(x0, x1); x++) put(x, Math.floor(y0 + ((x + 0.5 - x0) / dx) * dy));
  }
  put(Math.floor(x0), Math.floor(y0));
  put(Math.floor(x1), Math.floor(y1));
}

/**
 * Draw one die as a sprite. Pure: no canvas, so the unit test and the harness
 * both run it. The steps, in order: project the vertices; keep the faces turned
 * toward the viewer (a convex solid's front faces never overlap, so no depth
 * buffer); fill a face-id buffer by pixel centres; colour each face from the
 * ramp by how it faces the light; paint the skin's pattern, which is a texture
 * in the die's own space so it turns with it; draw the creases between visible
 * faces; ring the silhouette; add the finish's highlights; stamp the numerals.
 */
export function renderDie(kind: DieKind, rot: Mat3, skin: DiceSkin, size: number, opts: RenderOptions = {}): DieSprite {
  const g = geometry(kind);
  const sk = prepare(skin);
  const half = size / 2;
  const radius = (half - MARGIN) * VIEW[kind].fit;
  const data = new Uint8ClampedArray(size * size * 4);
  const ids = new Int16Array(size * size).fill(-1);

  // Project. Screen y grows downward; view y grows up.
  const proj = g.vertices.map((v) => {
    const w = matVec(rot, v);
    return [half + VIEW[kind].dx + w[0] * radius, half + VIEW[kind].dy - w[1] * radius, w[2] * radius] as const;
  });
  const normals = g.faces.map((f) => matVec(rot, f.normal));
  const visible: number[] = [];
  g.faces.forEach((_, i) => {
    if ((normals[i] as Vec3)[2] > 0.01) visible.push(i);
  });

  // Fill the face-id buffer by pixel centres. The test is "inside all edges" with a hair of slack, so two faces that share an edge leave no gap between them.
  for (const fi of visible) {
    const poly = (g.faces[fi] as DieFace).verts.map((vi) => proj[vi] as readonly [number, number, number]);
    let x0 = size;
    let y0 = size;
    let x1 = 0;
    let y1 = 0;
    for (const p of poly) {
      x0 = Math.min(x0, Math.floor(p[0]));
      y0 = Math.min(y0, Math.floor(p[1]));
      x1 = Math.max(x1, Math.ceil(p[0]));
      y1 = Math.max(y1, Math.ceil(p[1]));
    }
    for (let y = Math.max(0, y0); y <= Math.min(size - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(size - 1, x1); x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        let pos = 0;
        let neg = 0;
        for (let k = 0; k < poly.length; k++) {
          const a = poly[k] as readonly [number, number, number];
          const b = poly[(k + 1) % poly.length] as readonly [number, number, number];
          const c = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
          if (c > 1e-9) pos++;
          else if (c < -1e-9) neg++;
        }
        if (pos === 0 || neg === 0) ids[y * size + x] = fi;
      }
    }
  }

  // Tones per face.
  const tones = sk.ramp.length;
  const lambert = new Map<number, number>();
  const tone = new Map<number, number>();
  for (const fi of visible) {
    const l = Math.max(0, dot(normals[fi] as Vec3, LIGHT));
    lambert.set(fi, l);
    tone.set(fi, toneIndex(l, tones));
  }

  const put = (i: number, c: RGB): void => {
    data[i * 4] = c[0];
    data[i * 4 + 1] = c[1];
    data[i * 4 + 2] = c[2];
    data[i * 4 + 3] = 255;
  };

  // Body, with the pattern. The pattern is sampled where the pixel's ray meets the face, then mapped back into the die's own space.
  const inv = transpose(rot);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fi = ids[y * size + x] as number;
      if (fi < 0) continue;
      const t = tone.get(fi) as number;
      let c = sk.ramp[t] as RGB;
      if (sk.pattern) {
        const n = normals[fi] as Vec3;
        const f = g.faces[fi] as DieFace;
        const v0 = proj[f.verts[0] as number] as readonly [number, number, number];
        const vx = x + 0.5 - half - VIEW[kind].dx;
        const vy = half + VIEW[kind].dy - (y + 0.5);
        const vz = v0[2] + (n[0] * (v0[0] - half - VIEW[kind].dx - vx) + n[1] * (half + VIEW[kind].dy - v0[1] - vy)) / n[2];
        const m = matVec(inv, [vx / radius, vy / radius, vz / radius]);
        const p = sk.pattern;
        const shade = (t / (tones - 1)) * 0.45;
        if (p.kind === "speckle") {
          const cell = radius / 1.7;
          if (hash3(Math.floor(m[0] * cell), Math.floor(m[1] * cell), Math.floor(m[2] * cell), p.seed) < p.amount) c = mix(p.color, c, shade);
        } else {
          const warp = noise3(m[0] * 1.7, m[1] * 1.7, m[2] * 1.7, p.seed) * 0.6 + noise3(m[0] * 3.4, m[1] * 3.4, m[2] * 3.4, p.seed + 7) * 0.25;
          const w = Math.sin((m[0] * 2.1 + m[1] * 1.3 + m[2] * 0.8 + warp * 3.1) * Math.PI);
          if (Math.abs(w) < p.amount) c = mix(p.color, c, shade);
        }
      }
      put(y * size + x, c);
    }
  }

  // Creases between two visible faces, on the pixels the edge passes through. A crease pixel touching the outside is left alone, so the silhouette stays one pixel thick. `line` marks the pixels the finish must not paint over: creases now, numerals next.
  const line = new Uint8Array(size * size);
  const isVisible = new Set(visible);
  for (const e of g.edges) {
    const [fa, fb] = e.faces;
    if (!isVisible.has(fa) || !isVisible.has(fb)) continue;
    const a = proj[e.a] as readonly [number, number, number];
    const b = proj[e.b] as readonly [number, number, number];
    lineCells(a[0], a[1], b[0], b[1], (x, y) => {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      const id = ids[y * size + x] as number;
      if (id !== fa && id !== fb) return;
      const i = y * size + x;
      if (x === 0 || y === 0 || x === size - 1 || y === size - 1 || ids[i - 1] === -1 || ids[i + 1] === -1 || ids[i - size] === -1 || ids[i + size] === -1) return;
      put(y * size + x, sk.crease);
      line[y * size + x] = 1;
    });
  }

  // Numerals: nearest face first, so the front one is always drawn even when it has to be clipped.
  const order = [...visible].sort((a, b) => (normals[b] as Vec3)[2] - (normals[a] as Vec3)[2]);
  const views: DieFaceView[] = [];
  order.forEach((fi, rank) => {
    const n = normals[fi] as Vec3;
    let shown = false;
    if (opts.numerals !== false && (rank === 0 || (opts.numerals !== "front" && n[2] >= NUMERAL_MIN_FACING))) shown = stampNumeral(fi, rank === 0);
    views.push({ index: fi, number: (g.faces[fi] as DieFace).number, facing: n[2], shown });
  });

  // Finish: highlights on the lit side of the brightest face (gloss) or a sharp diagonal band over the lit faces (metal).
  if (sk.finish !== "matte" && visible.length > 0) {
    let hot = visible[0] as number;
    for (const fi of visible) if ((lambert.get(fi) as number) > (lambert.get(hot) as number)) hot = fi;
    if (sk.finish === "gloss") {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = y * size + x;
          if (ids[i] !== hot || line[i]) continue;
          const left = x === 0 ? -1 : (ids[i - 1] as number);
          const up = y === 0 ? -1 : (ids[i - size] as number);
          if (left !== hot || up !== hot) put(i, sk.shine);
        }
      }
    } else if (size >= 40) {
      const centre = Math.round(size * 0.95);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = y * size + x;
          const fi = ids[i] as number;
          if (fi < 0 || line[i] || (tone.get(fi) as number) > 1) continue;
          const d = x + y - centre;
          if (d === 0 || d === 1) put(i, sk.shine);
          else if (d === -2) put(i, mix(sk.ramp[tone.get(fi) as number] as RGB, sk.shine, 0.5));
        }
      }
    }
  }

  // The silhouette ring: a clear pixel with a filled neighbour above, below, left or right.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (ids[i] !== -1) continue;
      if ((x > 0 && (ids[i - 1] as number) >= 0) || (x < size - 1 && (ids[i + 1] as number) >= 0) || (y > 0 && (ids[i - size] as number) >= 0) || (y < size - 1 && (ids[i + size] as number) >= 0)) put(i, sk.edge);
    }
  }

  return { size, data, faces: views };

  function stampNumeral(fi: number, mustShow: boolean): boolean {
    const f = g.faces[fi] as DieFace;
    // The face's centre: the centroid of its projected polygon (a kite's sits low, where it is wide).
    const poly = f.verts.map((vi) => proj[vi] as readonly [number, number, number]);
    let area = 0;
    let cx = 0;
    let cy = 0;
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k] as readonly [number, number, number];
      const b = poly[(k + 1) % poly.length] as readonly [number, number, number];
      const cr = a[0] * b[1] - b[0] * a[1];
      area += cr;
      cx += (a[0] + b[0]) * cr;
      cy += (a[1] + b[1]) * cr;
    }
    if (Math.abs(area) < 1e-6) return false;
    cx /= 3 * area;
    cy /= 3 * area;
    // Which way the numeral's top points on screen, to the nearest quarter turn clockwise from straight up.
    const up = matVec(rot, f.up);
    const steps = (Math.round(Math.atan2(up[0], up[1]) / (Math.PI / 2)) + 4) % 4;
    const under = needsUnderline(g.sides, f.number);
    // Slide it a little to the spot where the least of it falls off the face. A neighbour's numeral is drawn only if it sits wholly inside its face with a pixel of air all round; the front one is always drawn, as well placed as it can be.
    const clear = (px: number, py: number): boolean => {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size || ids[ny * size + nx] !== fi || line[ny * size + nx]) return false;
        }
      }
      return true;
    };
    const fit = (bmp: NumeralBitmap): { cost: number; bx: number; by: number } => {
      let bestCost = Infinity;
      let bx = 0;
      let by = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const ox = Math.round(cx - bmp.w / 2) + dx;
          const oy = Math.round(cy - bmp.h / 2) + dy;
          let cost = 0;
          for (let y = 0; y < bmp.h; y++) {
            for (let x = 0; x < bmp.w; x++) {
              const k = y * bmp.w + x;
              if (!bmp.ink[k] && !bmp.rim[k]) continue;
              const px = ox + x;
              const py = oy + y;
              const inside = px >= 0 && py >= 0 && px < size && py < size && ids[py * size + px] === fi && !line[py * size + px];
              if (!inside) cost += bmp.ink[k] ? 4 : sk.numeralOutline ? 1 : 0;
              else if (bmp.ink[k] && !clear(px, py)) cost += mustShow ? 0.5 : 4;
            }
          }
          cost += (Math.abs(dx) + Math.abs(dy)) * 0.01;
          if (cost < bestCost) {
            bestCost = cost;
            bx = ox;
            by = oy;
          }
        }
      }
      return { cost: bestCost, bx, by };
    };
    // The full glyph if it fits with air all round; else the compact one if that does; else (the front face only) whichever sits worst-off least.
    const big = numeralBitmap(String(f.number), under, steps);
    const small = numeralBitmap(String(f.number), under, steps, true);
    const bigFit = fit(big);
    let bmp = big;
    let { cost: bestCost, bx, by } = bigFit;
    if (bestCost >= 0.5) {
      const smallFit = fit(small);
      if (smallFit.cost < bestCost) {
        bmp = small;
        ({ cost: bestCost, bx, by } = smallFit);
      }
    }
    if (bestCost >= 0.5 && !mustShow) return false;
    for (let y = 0; y < bmp.h; y++) {
      for (let x = 0; x < bmp.w; x++) {
        const k = y * bmp.w + x;
        const px = bx + x;
        const py = by + y;
        if (px < 0 || py < 0 || px >= size || py >= size || ids[py * size + px] !== fi) continue;
        if (bmp.ink[k]) put(py * size + px, sk.numeral);
        else if (bmp.rim[k] && sk.numeralOutline) put(py * size + px, sk.numeralOutline);
        else continue;
        line[py * size + px] = 1;
      }
    }
    return true;
  }
}

// ---- the throw --------------------------------------------------------------
//
// A throw is a pure function of a seed. Position runs straight from a start to
// an UNFOLDED target and is then folded back into the tray by reflecting it off
// the walls (a triangle wave), which is exactly a ball bouncing; the unfolded
// target is picked so the fold of it is the die's resting slot, so the die ends
// on the slot to the pixel with no blending. Spin is two turns about two
// different axes, both decaying to nothing at the end, laid over the resting
// orientation: so the last frame IS the resting orientation, exactly. The hop
// is a few bounces of decaying height.

export const ROLL_MS = 1200;
/** Each die after the first is thrown this much later, so a handful of dice do not move as one. */
const STAGGER_MS = 60;

export interface RollLayout {
  /** The box a die's centre may travel in, in tray pixels. */
  bounds: { x0: number; y0: number; x1: number; y1: number };
  /** Where each die rests. */
  slots: readonly { x: number; y: number }[];
  /** The tallest a die may hop, in tray pixels. */
  hop: number;
}

interface AxisRun {
  lo: number;
  hi: number;
  from: number;
  /** The unfolded target: folding it gives the slot. */
  to: number;
}

export interface DieMotion {
  readonly kind: DieKind;
  readonly result: number;
  readonly rest: Mat3;
  readonly slot: { readonly x: number; readonly y: number };
  readonly delay: number;
  readonly xs: AxisRun;
  readonly ys: AxisRun;
  readonly spinA: { readonly axis: Vec3; readonly angle: number };
  readonly spinB: { readonly axis: Vec3; readonly angle: number };
  readonly hopAmp: number;
  readonly hopCount: number;
  /** Thrown in from the corner (true) or picked up from where it was waiting (false). */
  readonly fromEdge: boolean;
  /** How a die picked up from where it waited is turned until its throw begins: as it sat waiting, not yet showing the result. */
  readonly idleRot: Mat3 | null;
}

export interface RollPlan {
  readonly duration: number;
  readonly dice: readonly DieMotion[];
}

export interface DieState {
  x: number;
  y: number;
  /** Height above the felt, in tray pixels. */
  z: number;
  rot: Mat3;
  visible: boolean;
  done: boolean;
}

/** Reflect an unfolded coordinate into [lo, hi]: a triangle wave, so a die bounces off the walls. */
export function fold(u: number, lo: number, hi: number): number {
  const w = hi - lo;
  if (w <= 0) return lo;
  let m = (u - lo) % (2 * w);
  if (m < 0) m += 2 * w;
  return lo + (m <= w ? m : 2 * w - m);
}

function axisRun(lo: number, hi: number, from: number, slot: number, dir: number, minTravel: number): AxisRun {
  const w = hi - lo;
  if (w < 1) return { lo, hi, from: slot, to: slot };
  // Every unfolded coordinate that folds to the slot is slot + 2wj or the mirror of it; take the nearest one that is at least minTravel away in the direction of the throw.
  let to = slot + 2 * w * dir * 3;
  let best = Infinity;
  for (let j = -8; j <= 8; j++) {
    for (const c of [slot + 2 * w * j, 2 * lo - slot + 2 * w * j]) {
      const travel = dir * (c - from);
      if (travel >= minTravel && travel < best) {
        best = travel;
        to = c;
      }
    }
  }
  return { lo, hi, from, to };
}

function unitVector(rand: () => number): Vec3 {
  const z = rand() * 2 - 1;
  const a = rand() * 2 * Math.PI;
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(a), r * Math.sin(a), z];
}

/**
 * Plan a throw. `from` is where each die was waiting, when it was (a die with no
 * entry is thrown in from the lower right corner). Pure and deterministic.
 */
export function planRoll(
  dice: readonly { kind: DieKind; result: number }[],
  layout: RollLayout,
  seed: number,
  from?: readonly ({ x: number; y: number; rot?: Mat3 } | undefined)[] | null,
): RollPlan {
  const rand = rng(seed);
  const { x0, y0, x1, y1 } = layout.bounds;
  const w = x1 - x0;
  const h = y1 - y0;
  const motions = dice.map((d, i): DieMotion => {
    const slot = layout.slots[i] ?? { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    const start = from?.[i];
    const fromEdge = !start;
    const sx = start ? start.x : x1 - rand() * 0.12 * w;
    const sy = start ? start.y : y1 - rand() * 0.25 * h;
    const dirX = fromEdge ? -1 : rand() < 0.5 ? -1 : 1;
    const dirY = rand() < 0.5 ? -1 : 1;
    const xs = axisRun(x0, x1, sx, slot.x, dirX, w * (0.9 + rand() * 0.8));
    const ys = axisRun(y0, y1, sy, slot.y, dirY, h * (1.2 + rand() * 1.0));
    const sign = () => (rand() < 0.5 ? -1 : 1);
    const spinA = { axis: unitVector(rand), angle: sign() * (1.5 + rand()) * 2 * Math.PI };
    const spinB = { axis: unitVector(rand), angle: sign() * (0.7 + rand() * 0.8) * 2 * Math.PI };
    return {
      kind: d.kind,
      result: Math.min(DIE_SIDES[d.kind], Math.max(1, Math.round(d.result))),
      rest: restOrientation(d.kind, d.result),
      slot,
      delay: i * STAGGER_MS,
      xs,
      ys,
      spinA,
      spinB,
      hopAmp: layout.hop * (0.7 + rand() * 0.5),
      hopCount: 2 + Math.floor(rand() * 2),
      fromEdge,
      idleRot: start?.rot ?? null,
    };
  });
  return { duration: ROLL_MS, dice: motions };
}

/** Where one die is, how high and how it is turned, `t` ms into the roll. */
export function motionAt(m: DieMotion, t: number): DieState {
  const span = ROLL_MS - m.delay;
  const p = (t - m.delay) / span;
  if (p >= 1) return { x: m.slot.x, y: m.slot.y, z: 0, rot: m.rest, visible: true, done: true };
  // Before its turn a thrown-in die is not there yet, and one picked up from where it waited keeps sitting as it was: neither shows the result early.
  if (p <= 0) return { x: fold(m.xs.from, m.xs.lo, m.xs.hi), y: fold(m.ys.from, m.ys.lo, m.ys.hi), z: 0, rot: m.idleRot ?? m.rest, visible: !m.fromEdge, done: false };
  const e = 1 - (1 - p) * (1 - p);
  const x = fold(m.xs.from + (m.xs.to - m.xs.from) * e, m.xs.lo, m.xs.hi);
  const y = fold(m.ys.from + (m.ys.to - m.ys.from) * e, m.ys.lo, m.ys.hi);
  const spin = (1 - p) ** 2.5;
  const rot = matMul(matMul(rotAxis(m.spinA.axis, m.spinA.angle * spin), rotAxis(m.spinB.axis, m.spinB.angle * spin)), m.rest);
  const launch = m.fromEdge ? 1 : Math.min(1, p / 0.1);
  const z = m.hopAmp * Math.abs(Math.cos(Math.PI * m.hopCount * p)) * (1 - p) ** 1.5 * launch;
  return { x, y, z, rot, visible: true, done: false };
}

/** The most the idle wobble can turn a die, in degrees about any one axis combined: kept under every die's headroom (see the unit test) so a wobbling die never starts showing another face. */
export const WOBBLE_MAX_DEG = 6;

/** The gentle idle wobble of a die that is waiting to be thrown: a few degrees about each axis, so it never stops being the face it shows. */
export function wobbleAt(rest: Mat3, t: number, phase: number): { rot: Mat3; bob: number } {
  const rot = matMul(matMul(matMul(rotX(0.03 * Math.sin(t / 520 + phase)), rotY(0.045 * Math.sin(t / 700 + phase * 1.7))), rotZ(0.03 * Math.sin(t / 610 + phase * 2.3))), rest);
  return { rot, bob: Math.round(1.2 * Math.sin(t / 380 + phase)) };
}

// ---- the tray: DOM helpers --------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The device pixel ratio now, read each time so a zoom or a move to another screen is honoured. */
function deviceRatio(): number {
  return typeof window !== "undefined" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
}

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// ---- styles -----------------------------------------------------------------

const STYLE_ID = "ltd-style";

const CSS = `
.ltd-root,.ltd-shop{--ltd-focus:var(--bn-focus,#1d63e0)}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .ltd-root,:root:not([data-theme="light"]) .ltd-shop{--ltd-focus:#7fb0ff}}
:root[data-theme="dark"] .ltd-root,:root[data-theme="dark"] .ltd-shop{--ltd-focus:#7fb0ff}
.ltd-root{display:block;position:relative;width:100%;max-width:360px;margin:0 auto;line-height:0;-webkit-tap-highlight-color:transparent;touch-action:manipulation;user-select:none;-webkit-user-select:none;border-radius:4px}
.ltd-root,.ltd-root *,.ltd-shop,.ltd-shop *{box-sizing:border-box}
.ltd-root canvas{display:block;margin:0 auto;image-rendering:pixelated}
.ltd-root[data-state="waiting"]{cursor:pointer}
.ltd-root:focus-visible,.ltd-card:focus-visible{outline:2px solid var(--ltd-focus);outline-offset:3px}
.ltd-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

/* ---- the skin picker: one navy pixel window, the same fixed skin in light and dark ---- */
.ltd-shop{position:relative;display:flex;flex-direction:column;gap:8px;width:100%;padding:2px;line-height:0;color:#f4ecd0;background:#141a3c;border:10px solid #05061a;border-image:var(--ltd-win) 5 fill/10px/0 stretch;image-rendering:pixelated}
.ltd-shop canvas{display:block;image-rendering:pixelated}
.ltd-shop-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:8px}
.ltd-card{position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0;padding:0 0 2px;font:inherit;color:inherit;cursor:pointer;background:#141a3c;border:10px solid #05061a;border-image:var(--ltd-win) 5 fill/10px/0 stretch;image-rendering:pixelated;-webkit-tap-highlight-color:transparent}
.ltd-card[aria-pressed="true"]{border-image-source:var(--ltd-gold)}
.ltd-card:hover{filter:brightness(1.15)}
.ltd-card .ltd-row{display:flex;justify-content:center;align-items:center;min-height:14px}
.ltd-card .ltd-row:first-child{min-height:14px}

@media (prefers-reduced-motion: reduce){.ltd-root *,.ltd-shop *{animation:none!important;transition:none!important}}
`;

function injectStyle(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

// ---- the tray: looks, and the pure painters ---------------------------------
//
// A TrayLook is data: a rim (palette, texture, corner pieces, studs), a felt
// (palette, texture, piping) and optional motion (a shimmer, drifting embers, a
// pulsing glow). The painters are pure: paintTray fills an ImageData-like buffer
// with the still tray (the browser caches it per size and look), and
// paintTrayEffects lays the motion over a copy of it each frame. The player's own
// look (wood rim, green felt) is painted exactly as it always was, pixel for
// pixel (the unit test pins it by hash); the foe looks are a ladder of six tiers
// plus bone (undead) and scale (dragon) variants, built in one place below.
//
// Painted once per size into a background canvas at tray resolution: a rounded
// rectangle rim lit from the upper left like the dice, a dark lip inside it, and
// felt that darkens toward the rim.

const RIM = 5;
const CORNER = 3;

export type TrayTexture = "wood" | "planks" | "iron" | "stone" | "oak" | "gold" | "scales" | "bone" | "black";
export type FeltTexture = "felt" | "sack" | "leather" | "slate" | "velvet";
/** The little piece stamped on each of the tray's four corners. */
export type CornerKind = "none" | "iron" | "silver" | "gems" | "claws" | "skulls" | "coins";

export interface TrayPalette {
  light: string;
  body: string;
  deep: string;
  dark: string;
  /** The dark line just inside the rim, where the rim meets the felt. */
  lip: string;
  /** The 1 px outline round the whole tray. */
  outline: string;
}

export type TrayEffect =
  /** A faint diagonal sheen sliding slowly across the felt. */
  | { kind: "shimmer"; color: string; strength: number }
  /** Specks that rise from the bottom of the felt, cooling as they go. */
  | { kind: "embers"; color: string; count: number }
  /** The glowing cracks in the rim brighten and dim in a slow wave. */
  | { kind: "pulse"; color: string }
  /** The inner lip of the rim breathes a coloured light. */
  | { kind: "glow"; color: string; strength: number };

export interface TrayLook {
  id: string;
  name: string;
  rim: {
    palette: TrayPalette;
    /** Seeded flecks: a hash below `dark` paints a dark fleck, above `light` a light one. */
    grain: { seed: number; dark: number; light: number };
    texture: TrayTexture;
    /** The metal of the iron bands, silver caps, gold or ember cracks. */
    metal?: { light: string; body: string; deep: string };
    corners: CornerKind;
    /** Colours of the corner gems, used in turn. */
    gems?: readonly string[];
    /** Pips (or bars) set into the straight runs of the rim, every `every` pixels. */
    studs?: { color: string; every: number; shape: "pip" | "bar" };
  };
  felt: {
    dark: string;
    base: string;
    light: string;
    /** The first rows against the rim. */
    rimShade: string;
    texture: FeltTexture;
    /** A fine line set a little way in from the rim. */
    piping?: { color: string; dashed: boolean };
  };
  /** The look's own colour: the "who" tag is lettered in it. */
  accent: string;
  /** Motion. None means the tray is still, and the browser draws it from its cache. */
  effects: readonly TrayEffect[];
}

/** An ImageData-like target: what the painters write into. A real ImageData fits, and so does a plain object in a unit test. */
export interface PixelBuffer {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

const WOOD = { light: "#d6a86e", body: "#b07a46", deep: "#8a5a30", dark: "#6c401e", lip: "#2a160a", outline: "#1a0e06" };
const FELT = { dark: "#173f29", base: "#1b4a30", light: "#205335", rimShade: "#112f1f" };

export const PLAYER_TRAY_ID = "player";

const PLAYER_LOOK: TrayLook = {
  id: PLAYER_TRAY_ID,
  name: "Wood and green felt",
  rim: { palette: WOOD, grain: { seed: 77, dark: 0.04, light: 0.97 }, texture: "wood", corners: "none" },
  felt: { ...FELT, texture: "felt" },
  accent: "#e8c872",
  effects: [],
};

// ---- the foe ladder: the looks ------------------------------------------------

export type FoeTier = 0 | 1 | 2 | 3 | 4 | 5;
export type FoeAccent = "undead" | "dragon";
export type DragonColour = "red" | "green" | "blue" | "black" | "white";
export const FOE_TIERS: readonly FoeTier[] = [0, 1, 2, 3, 4, 5];
export const DRAGON_COLOURS: readonly DragonColour[] = ["red", "green", "blue", "black", "white"];

function foeId(kind: "die" | "tray", tier: FoeTier, accent?: FoeAccent, colour?: DragonColour): string {
  return ["foe", kind, accent, accent === "dragon" ? colour : undefined, `t${tier}`].filter(Boolean).join("-");
}

/** The id of the foe die skin for a tier, with an optional accent (and a dragon's colour). */
export function foeSkinId(tier: FoeTier, accent?: FoeAccent, colour?: DragonColour): string {
  return foeId("die", tier, accent, colour);
}

/** The id of the foe tray look for a tier, with an optional accent (and a dragon's colour). */
export function foeTrayId(tier: FoeTier, accent?: FoeAccent, colour?: DragonColour): string {
  return foeId("tray", tier, accent, colour);
}

function hexMix(a: string, b: string, t: number): string {
  const c = mix(hexRgb(a), hexRgb(b), t);
  return `#${[c[0], c[1], c[2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Name of the thing a tier's tray is, for the look's display name. */
const TIER_NOUN: readonly string[] = ["crate lid", "box", "stone bowl", "tray", "tray", "brazier tray"];

const FOE_TRAY_TIERS: readonly Omit<TrayLook, "id">[] = [
  // tier 0: a battered crate lid with scuffed sackcloth.
  {
    name: "Battered crate lid",
    rim: { palette: { light: "#a39478", body: "#857757", deep: "#675b42", dark: "#4b4230", lip: "#241d14", outline: "#15110b" }, grain: { seed: 31, dark: 0.07, light: 0.95 }, texture: "planks", corners: "none" },
    felt: { dark: "#4a3d2a", base: "#5e4e36", light: "#74623f", rimShade: "#32291c", texture: "sack" },
    accent: "#d8c9a0",
    effects: [],
  },
  // tier 1: an iron-banded box, riveted, lined with dark leather.
  {
    name: "Iron-bound box",
    rim: {
      palette: { light: "#6f5238", body: "#533b28", deep: "#3b2a1c", dark: "#271b12", lip: "#150e08", outline: "#0a0705" },
      grain: { seed: 41, dark: 0.05, light: 0.97 },
      texture: "iron",
      metal: { light: "#b4bcc8", body: "#7a8392", deep: "#4a515e" },
      corners: "iron",
    },
    felt: { dark: "#2a1b14", base: "#38251a", light: "#4a3324", rimShade: "#1c110c", texture: "leather", piping: { color: "#7a5a3c", dashed: true } },
    accent: "#c4cede",
    effects: [],
  },
  // tier 2: a carved stone rim and slate-blue felt.
  {
    name: "Carved stone bowl",
    rim: { palette: { light: "#c4c9d2", body: "#979eab", deep: "#707886", dark: "#4d5460", lip: "#1f232b", outline: "#101318" }, grain: { seed: 53, dark: 0.07, light: 0.94 }, texture: "stone", corners: "none" },
    felt: { dark: "#1e2b46", base: "#283c5e", light: "#344b72", rimShade: "#131c32", texture: "slate" },
    accent: "#9cc4ff",
    effects: [],
  },
  // tier 3: a dark oak rim with silver corner caps and crimson velvet.
  {
    name: "Oak and silver tray",
    rim: {
      palette: { light: "#b8743e", body: "#8c4a26", deep: "#66331a", dark: "#46210f", lip: "#1f0f08", outline: "#120804" },
      grain: { seed: 63, dark: 0.04, light: 0.97 },
      texture: "oak",
      metal: { light: "#f4f6fc", body: "#bfc6d8", deep: "#7f88a0" },
      corners: "silver",
      studs: { color: "#e4e8f4", every: 24, shape: "pip" },
    },
    felt: { dark: "#4a0a16", base: "#6e1224", light: "#92203a", rimShade: "#2e060e", texture: "velvet", piping: { color: "#b8bccc", dashed: false } },
    accent: "#e8ecf8",
    effects: [],
  },
  // tier 4: a gold filigree rim with a gem on each corner, royal purple velvet with a faint shimmer.
  {
    name: "Gilded filigree tray",
    rim: {
      palette: { light: "#fff0a0", body: "#e4b83c", deep: "#aa7a1a", dark: "#6e4a0c", lip: "#2e1c06", outline: "#1a0e02" },
      grain: { seed: 71, dark: 0.03, light: 0.985 },
      texture: "gold",
      metal: { light: "#fff6c0", body: "#f2cc50", deep: "#b88a20" },
      corners: "gems",
      gems: ["#e8284c", "#3a82f0"],
    },
    felt: { dark: "#2c1050", base: "#44187c", light: "#5c2c9c", rimShade: "#1c0a34", texture: "velvet", piping: { color: "#c8a448", dashed: false } },
    accent: "#ffd96a",
    effects: [{ kind: "shimmer", color: "#dcbcff", strength: 0.17 }],
  },
  // tier 5: a black iron rim with ember cracks and bone claws, black velvet with drifting embers.
  {
    name: "Dragon-bone and ember tray",
    rim: {
      palette: { light: "#6a6074", body: "#453e52", deep: "#2e293a", dark: "#1a1622", lip: "#07050a", outline: "#030205" },
      grain: { seed: 83, dark: 0.04, light: 0.98 },
      texture: "black",
      metal: { light: "#ffa240", body: "#9a3412", deep: "#4a1408" },
      corners: "claws",
      studs: { color: "#eadfc2", every: 20, shape: "bar" },
    },
    felt: { dark: "#06050a", base: "#0f0c16", light: "#1c1628", rimShade: "#030205", texture: "velvet", piping: { color: "#8a2c10", dashed: false } },
    accent: "#ff9a3c",
    effects: [
      { kind: "pulse", color: "#ff8a2c" },
      { kind: "embers", color: "#ff7a24", count: 16 },
    ],
  },
];

const BONE_RIM: TrayPalette = { light: "#f6efd6", body: "#dccfae", deep: "#ab9f7c", dark: "#7a6f54", lip: "#2a2618", outline: "#14120a" };
const BONE_METAL = { light: "#fbf6e0", body: "#e0d4b4", deep: "#a89c78" };
const HOARD_METAL = { light: "#fff3a6", body: "#eab932", deep: "#a87a18" };

const DRAGON_RIMS: Readonly<Record<DragonColour, { palette: TrayPalette; accent: string; felt: string }>> = {
  red: { palette: { light: "#e8785e", body: "#b4302a", deep: "#7c1c1a", dark: "#4a0f11", lip: "#1e0508", outline: "#120304" }, accent: "#ff8a6a", felt: "#7a1810" },
  green: { palette: { light: "#86cc5c", body: "#418f2e", deep: "#28621f", dark: "#16380f", lip: "#08180a", outline: "#040c05" }, accent: "#9ae070", felt: "#1e5a1a" },
  blue: { palette: { light: "#7cb4f2", body: "#3c6ec2", deep: "#264c8c", dark: "#162c58", lip: "#08122a", outline: "#040816" }, accent: "#8cc4ff", felt: "#1a3a80" },
  black: { palette: { light: "#74747f", body: "#4a4a55", deep: "#32323c", dark: "#1c1c24", lip: "#08080c", outline: "#030304" }, accent: "#b4b4c8", felt: "#1a1a22" },
  white: { palette: { light: "#f4fbff", body: "#c8dce8", deep: "#96b2c4", dark: "#688296", lip: "#26323c", outline: "#121a20" }, accent: "#e0f4ff", felt: "#5a7890" },
};

const WHOLE_DRAGON_NAMES: Readonly<Record<DragonColour, string>> = { red: "Red", green: "Green", blue: "Blue", black: "Black", white: "White" };

function buildTrayLooks(): TrayLook[] {
  const out: TrayLook[] = [PLAYER_LOOK];
  for (const tier of FOE_TIERS) {
    const base = FOE_TRAY_TIERS[tier] as Omit<TrayLook, "id">;
    out.push({ ...base, id: foeTrayId(tier) });
  }
  const noun = (tier: FoeTier): string => TIER_NOUN[tier] as string;
  for (const tier of FOE_TIERS) {
    const base = FOE_TRAY_TIERS[tier] as Omit<TrayLook, "id">;
    // Undead: a bone or ossuary rim; skull corners from tier 3; a sickly green glow from tier 2.
    const glow = tier >= 2;
    const felt = glow ? { ...base.felt, dark: hexMix(base.felt.dark, "#1a3a16", 0.3), base: hexMix(base.felt.base, "#26481e", 0.28), light: hexMix(base.felt.light, "#3a6228", 0.28) } : base.felt;
    out.push({
      id: foeTrayId(tier, "undead"),
      name: `Ossuary ${noun(tier)}`,
      rim: {
        palette: BONE_RIM,
        grain: { seed: 91 + tier, dark: 0.05, light: 0.97 },
        texture: "bone",
        metal: BONE_METAL,
        corners: tier >= 3 ? "skulls" : "none",
        ...(tier >= 4 ? { studs: { color: "#c8e87c", every: 22, shape: "pip" as const } } : {}),
      },
      felt,
      accent: glow ? "#b4ea6c" : "#e0d4b4",
      effects: [...(glow ? [{ kind: "glow" as const, color: "#9be15a", strength: 0.26 + tier * 0.05 }] : []), ...base.effects],
    });
  }
  // Dragons: a scaled rim and hoard gold. With no colour in the id the rim keeps its tier's own palette.
  for (const colour of [undefined, ...DRAGON_COLOURS] as (DragonColour | undefined)[]) {
    for (const tier of FOE_TIERS) {
      const base = FOE_TRAY_TIERS[tier] as Omit<TrayLook, "id">;
      const tint = colour ? DRAGON_RIMS[colour] : null;
      const lead = colour ? `${WHOLE_DRAGON_NAMES[colour]}-scaled` : "Scaled";
      out.push({
        id: foeTrayId(tier, "dragon", colour),
        name: `${lead} ${noun(tier)}`,
        rim: {
          palette: tint ? tint.palette : base.rim.palette,
          grain: { seed: 101 + tier, dark: 0.04, light: 0.97 },
          texture: "scales",
          metal: HOARD_METAL,
          corners: tier >= 2 ? "coins" : "none",
          studs: { color: "#f6cc48", every: 16, shape: "pip" },
        },
        felt: tint ? { ...base.felt, dark: hexMix(base.felt.dark, tint.felt, 0.22), base: hexMix(base.felt.base, tint.felt, 0.3), light: hexMix(base.felt.light, tint.felt, 0.3) } : base.felt,
        accent: tint ? tint.accent : "#ffd24a",
        effects: base.effects,
      });
    }
  }
  return out;
}

export const TRAY_LOOKS: readonly TrayLook[] = buildTrayLooks();

const TRAY_BY_ID: ReadonlyMap<string, TrayLook> = new Map(TRAY_LOOKS.map((l) => [l.id, l]));

/** The tray look with this id (the player's or a foe's), or undefined. */
export function trayLookById(id: string | undefined): TrayLook | undefined {
  return id === undefined ? undefined : TRAY_BY_ID.get(id);
}

/** Everything wrong with a tray look, as sentences; empty when it is fit to use. */
export function trayLookProblems(look: TrayLook): string[] {
  const out: string[] = [];
  if (!/^[a-z][a-z0-9-]*$/.test(look.id)) out.push("id must be lowercase letters, digits and hyphens");
  if (!look.name.trim()) out.push("name is empty");
  const colours = [
    ...Object.values(look.rim.palette),
    ...Object.values(look.rim.metal ?? {}),
    ...(look.rim.gems ?? []),
    look.rim.studs?.color ?? look.rim.palette.dark,
    look.felt.dark,
    look.felt.base,
    look.felt.light,
    look.felt.rimShade,
    look.felt.piping?.color ?? look.felt.dark,
    look.accent,
    ...look.effects.map((e) => e.color),
  ];
  for (const c of colours) if (!HEX.test(c)) out.push(`${c} is not a #rrggbb colour`);
  const r = look.rim;
  if (["iron", "silver", "gems", "claws", "skulls", "coins"].includes(r.corners) && !r.metal) out.push("corner pieces need a rim.metal palette");
  if (["iron", "gold", "scales", "bone", "black"].includes(r.texture) && !r.metal) out.push(`the ${r.texture} rim texture needs a rim.metal palette`);
  if (r.corners === "gems" && !(r.gems && r.gems.length > 0)) out.push("gem corners need rim.gems");
  if (r.studs && !(Number.isInteger(r.studs.every) && r.studs.every >= 6)) out.push("studs.every must be a whole number, 6 or more");
  return out;
}

// ---- the foe skins ----------------------------------------------------------
//
// The dice a monster rolls. They are NOT in DICE_SKINS: they are never in the
// shop, never sold and never equippable by the player; a roll asks for one by id
// (RollRequest.skin) and the tray looks it up here. Six tiers, each clearly
// richer than the last, plus bone-white undead and hoard-gold dragon variants.
// Every one keeps a legible numeral on every face (the unit test checks the
// contrast of the numeral against every body colour, with its halo counted).

type FoeSkinBase = Omit<DiceSkin, "id" | "priceCredits">;

const FOE_DIE_TIERS: readonly FoeSkinBase[] = [
  // 0: cheap wood, chipped and dull, flecks of pale wood showing where the paint has gone.
  {
    name: "Worn wooden dice",
    ramp: ["#d2b78a", "#bb9d6e", "#9a7e52", "#85693f"],
    edge: "#2a1a0c",
    numeral: "#22140a",
    numeralOutline: null,
    finish: "matte",
    pattern: { kind: "speckle", color: "#ecdcb4", amount: 0.09, seed: 7 },
  },
  // 1: dark iron, a plain finish.
  {
    name: "Iron dice",
    ramp: ["#7a808a", "#585e68", "#3c414a", "#262a31"],
    edge: "#07080b",
    numeral: "#f2e6c4",
    numeralOutline: "#12141a",
    finish: "matte",
  },
  // 2: bronze with a metal sheen.
  {
    name: "Bronze dice",
    ramp: ["#f6d49c", "#dcaa66", "#b8844a", "#8a5e30"],
    edge: "#2a1608",
    numeral: "#241204",
    numeralOutline: null,
    finish: "metal",
    shine: "#fff0cc",
  },
  // 3: polished silver.
  {
    name: "Silver dice",
    ramp: ["#f8f9fc", "#d2d5de", "#a4a8b6", "#737888"],
    edge: "#1a1c26",
    numeral: "#10142c",
    numeralOutline: null,
    finish: "metal",
    shine: "#ffffff",
  },
  // 4: ivory shot through with gold veins, high gloss.
  {
    name: "Gold-veined dice",
    ramp: ["#fffaf0", "#f2e8d0", "#dccfa8", "#b8a878"],
    edge: "#3a2a10",
    numeral: "#2c1458",
    numeralOutline: null,
    finish: "gloss",
    shine: "#ffffff",
    pattern: { kind: "marble", color: "#e0a820", amount: 0.09, seed: 13 },
  },
  // 5: obsidian with glowing ember veins.
  {
    name: "Ember-vein obsidian dice",
    ramp: ["#52485e", "#342c40", "#201a2a", "#120e1a"],
    edge: "#050308",
    numeral: "#ffe6a0",
    numeralOutline: "#2a0a02",
    finish: "gloss",
    shine: "#d8c8ff",
    pattern: { kind: "marble", color: "#ff8a26", amount: 0.11, seed: 17 },
  },
];

/** The finish a tier's dice take: plain at the bottom, sheen in the middle, gloss at the top. */
const TIER_FINISH: readonly DiceFinish[] = ["matte", "matte", "metal", "metal", "gloss", "gloss"];

function undeadSkin(tier: FoeTier): FoeSkinBase {
  const bone = ["#fdfaf0", "#ece6d2", "#cdc4a8", "#a49b80"] as const;
  const veins = ["#9ad060", "#9ad060", "#9ad060", "#aadc64", "#b8e468", "#c8f070"] as const;
  const amount = [0, 0, 0.06, 0.09, 0.11, 0.13] as const;
  return {
    name: tier >= 2 ? "Grave-bone dice, green-veined" : "Grave-bone dice",
    ramp: tier >= 5 ? ["#e2e6cc", "#bcc6a6", "#92a082", "#687860"] : tier >= 4 ? ["#fff8e0", "#f0e2b8", "#d4c088", "#a8935a"] : bone,
    edge: "#1c2010",
    numeral: tier >= 5 ? "#10180a" : "#1a2210",
    numeralOutline: null,
    finish: tier >= 3 ? "gloss" : "matte",
    shine: "#f0ffdc",
    pattern: tier >= 2 ? { kind: "marble", color: veins[tier] as string, amount: amount[tier] as number, seed: 23 + tier } : { kind: "speckle", color: "#c4b890", amount: 0.03 + 0.01 * (1 - tier), seed: 19 },
  };
}

const DRAGON_DICE: Readonly<Record<DragonColour | "hoard", { ramp: readonly string[]; edge: string; numeral: string; outline: string | null; vein: string }>> = {
  red: { ramp: ["#ff9c84", "#e04a34", "#a62a1e", "#6a1812"], edge: "#2a0806", numeral: "#fff2d8", outline: "#3a0a08", vein: "#ffd84a" },
  green: { ramp: ["#b4ec7c", "#62c03c", "#3a8c28", "#22581a"], edge: "#08240a", numeral: "#f8ffe4", outline: "#0c3010", vein: "#ffd84a" },
  blue: { ramp: ["#a8dcff", "#58a0e8", "#3468b8", "#1e407c"], edge: "#081a38", numeral: "#f4faff", outline: "#0a2048", vein: "#ffd84a" },
  black: { ramp: ["#7a7a88", "#52525e", "#34343e", "#1c1c24"], edge: "#050508", numeral: "#f2e8c8", outline: "#0a0a10", vein: "#ffd84a" },
  white: { ramp: ["#fafdff", "#d8e8f2", "#abc6d8", "#7c9ab0"], edge: "#1a2a38", numeral: "#0e2234", outline: null, vein: "#e8b020" },
  hoard: { ramp: ["#fad070", "#e09a30", "#b06a1c", "#744012"], edge: "#2e1804", numeral: "#fff4d0", outline: "#3a1c04", vein: "#fff6c0" },
};

function dragonSkin(tier: FoeTier, colour: DragonColour | undefined): FoeSkinBase {
  const t = DRAGON_DICE[colour ?? "hoard"];
  const lead = colour ? `${colour[0]?.toUpperCase()}${colour.slice(1)} dragon-scale dice` : "Dragon-scale dice";
  return {
    name: lead,
    ramp: t.ramp,
    edge: t.edge,
    numeral: t.numeral,
    numeralOutline: t.outline,
    finish: TIER_FINISH[tier] as DiceFinish,
    shine: "#fff4d8",
    pattern: { kind: "marble", color: t.vein, amount: 0.05 + 0.012 * tier, seed: 31 + tier },
  };
}

function buildFoeSkins(): DiceSkin[] {
  const out: DiceSkin[] = [];
  const add = (id: string, s: FoeSkinBase): void => {
    out.push({ ...s, id, priceCredits: 0 });
  };
  for (const tier of FOE_TIERS) add(foeSkinId(tier), FOE_DIE_TIERS[tier] as FoeSkinBase);
  for (const tier of FOE_TIERS) add(foeSkinId(tier, "undead"), undeadSkin(tier));
  for (const colour of [undefined, ...DRAGON_COLOURS] as (DragonColour | undefined)[]) for (const tier of FOE_TIERS) add(foeSkinId(tier, "dragon", colour), dragonSkin(tier, colour));
  return out;
}

/** The dice monsters roll, separate from DICE_SKINS: never in the shop, never sold. Ask for one by id with RollRequest.skin. */
export const FOE_DICE_SKINS: readonly DiceSkin[] = buildFoeSkins();

const FOE_SKIN_BY_ID: ReadonlyMap<string, DiceSkin> = new Map(FOE_DICE_SKINS.map((s) => [s.id, s]));

/** A skin by id, from the shop's list or the foe list. */
export function skinById(id: string): DiceSkin | undefined {
  return findSkin(id) ?? FOE_SKIN_BY_ID.get(id);
}

// ---- the painters (pure) ----------------------------------------------------

const distCache = new Map<string, Uint16Array>();

/** For each pixel of a w by h tray: 0 outside the rounded rectangle, 1 on its outline, 2 and up for each step inward. */
function distanceMap(w: number, h: number): Uint16Array {
  const key = `${w}x${h}`;
  const hit = distCache.get(key);
  if (hit) return hit;
  const inside = (x: number, y: number): boolean => {
    const ax = Math.min(x, w - 1 - x);
    const ay = Math.min(y, h - 1 - y);
    return ax >= CORNER || ay >= CORNER || (CORNER - ax - 0.5) ** 2 + (CORNER - ay - 0.5) ** 2 <= CORNER * CORNER;
  };
  // Distance, in steps, from the nearest pixel outside the rounded rectangle.
  const d = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = inside(x, y) ? 9999 : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      d[i] = Math.min(d[i] as number, x === 0 ? 1 : (d[i - 1] as number) + 1, y === 0 ? 1 : (d[i - w] as number) + 1);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      d[i] = Math.min(d[i] as number, x === w - 1 ? 1 : (d[i + 1] as number) + 1, y === h - 1 ? 1 : (d[i + w] as number) + 1);
    }
  }
  if (distCache.size > 12) distCache.clear();
  distCache.set(key, d);
  return d;
}

const rgbMemo = new Map<string, RGB>();
function rgbOf(hex: string): RGB {
  let c = rgbMemo.get(hex);
  if (!c) {
    c = hexRgb(hex);
    rgbMemo.set(hex, c);
  }
  return c;
}

/** Filigree: one 8 by 3 tile, a wave of engraved lines with a highlight pip in each hollow. */
const FILIGREE: readonly string[] = [".##..+..", "#..#..##", ".+..##.."];

/** The corner pieces, 5 by 5, drawn on the top left and mirrored onto the other three. . keeps the rim underneath. */
const CORNER_ART: Readonly<Record<Exclude<CornerKind, "none">, readonly string[]>> = {
  iron: ["kkkkk", "kmmMd", "kmMMd", "kMMMd", "kdddd"],
  silver: ["kkkkk", "kmmmM", "kmMMd", "kmMdd", "kMddd"],
  gems: ["kmmMk", "mgggd", "mghgd", "mgggd", "kMddk"],
  claws: ["kBBBk", "BBtBb", "BtTtb", "BBtBb", "kbbbk"],
  skulls: [".mmm.", "mmmmM", "mkMkM", "MMmMd", ".dkd."],
  coins: ["kkkkk", "kmmMk", "kmDMk", "kMMdk", "kkkkk"],
};

interface RimGeom {
  vertical: boolean;
  corner: boolean;
  along: number;
}

function rimGeom(x: number, y: number, w: number, h: number): RimGeom {
  const ax = Math.min(x, w - 1 - x);
  const ay = Math.min(y, h - 1 - y);
  const vertical = ax < ay;
  return { vertical, corner: ax < RIM && ay < RIM, along: vertical ? y : x };
}

/** Where the glowing cracks of a black rim are: the same rule the painter and the pulse effect both use. */
function isCrack(x: number, y: number): boolean {
  return hash3(x, y, 2, 91) < 0.07;
}

/**
 * Paint the still tray (rim and felt, no motion) into `buf`: the whole buffer is
 * the tray, opaque inside the rounded rectangle and clear outside it. Pure and
 * deterministic. For the player's look the output is, byte for byte, what the
 * tray has always drawn.
 */
export function paintTray(buf: PixelBuffer, look: TrayLook): void {
  const { width: w, height: h, data } = buf;
  const d = distanceMap(w, h);
  const P = look.rim.palette;
  const pal = { light: rgbOf(P.light), body: rgbOf(P.body), deep: rgbOf(P.deep), dark: rgbOf(P.dark), lip: rgbOf(P.lip), outline: rgbOf(P.outline) };
  const ramp: readonly RGB[] = [pal.light, pal.body, pal.deep, pal.dark];
  const M = look.rim.metal ? { light: rgbOf(look.rim.metal.light), body: rgbOf(look.rim.metal.body), deep: rgbOf(look.rim.metal.deep) } : null;
  const F = { dark: rgbOf(look.felt.dark), base: rgbOf(look.felt.base), light: rgbOf(look.felt.light), rimShade: rgbOf(look.felt.rimShade) };
  const tex = look.rim.texture;
  const gr = look.rim.grain;
  const studs = look.rim.studs ?? null;
  const studRgb = studs ? rgbOf(studs.color) : null;

  const put = (i: number, c: RGB): void => {
    data[i * 4] = c[0];
    data[i * 4 + 1] = c[1];
    data[i * 4 + 2] = c[2];
    data[i * 4 + 3] = 255;
  };

  const rimColor = (x: number, y: number, dist: number, lit: boolean, grain: number): RGB => {
    const across = dist - 2;
    const g = rimGeom(x, y, w, h);
    const stepIdx = dist === 2 ? (lit ? 0 : 1) : dist === 3 ? (lit ? 1 : 2) : lit ? 2 : 3;
    let c: RGB = ramp[stepIdx] as RGB;
    if (grain < gr.dark) c = pal.dark;
    else if (grain > gr.light) c = pal.light;
    if (g.corner) return c;
    const { along, vertical } = g;
    switch (tex) {
      case "planks": {
        const m = along % 19;
        if (m === 0) c = pal.dark;
        else if (m === 3 && across === 1) c = pal.light;
        if (dist === 2 && hash3(x, y, 2, 5) < 0.08) c = pal.dark;
        break;
      }
      case "iron": {
        const m = along % 30;
        if (M && m < 4) {
          c = across === 0 ? M.light : across === 1 ? M.body : M.deep;
          if (m === 0 || m === 3) c = across === 0 ? M.body : M.deep;
          if (across === 1 && m === 1) c = M.light;
          else if (across === 1 && m === 2) c = M.deep;
        }
        break;
      }
      case "stone": {
        const phase = (along + (across === 1 ? 7 : 0)) % 14;
        if (phase === 0) c = pal.dark;
        else if (phase === 1 && across !== 2) c = pal.light;
        break;
      }
      case "oak": {
        if (hash3(Math.floor(along / 6) + (vertical ? 100 : 0), across, 3, 21) < 0.34) c = ramp[Math.min(3, stepIdx + 1)] as RGB;
        if (dist === 2 && lit) c = pal.light;
        break;
      }
      case "gold": {
        const ch = (FILIGREE[across] as string)[along % 8];
        if (ch === "#") c = pal.deep;
        else if (ch === "+") c = pal.light;
        break;
      }
      case "scales": {
        const u = (along + across * 2) % 4;
        if (u === 0) c = ramp[Math.min(3, stepIdx + 1)] as RGB;
        else if (u === 2 && across === 0) c = pal.light;
        break;
      }
      case "bone": {
        const m = along % 7;
        if (m === 0) c = pal.deep;
        else if (m === 1 && across === 0) c = pal.light;
        else if (m === 6) c = ramp[Math.min(3, stepIdx + 1)] as RGB;
        break;
      }
      case "black": {
        if (M && isCrack(x, y)) c = M.body;
        break;
      }
      default:
        break;
    }
    if (studs && studRgb) {
      const m = along % studs.every;
      if (studs.shape === "pip") {
        if (across === 1 && m === 0) c = studRgb;
        else if (across === 1 && m === 1) c = pal.dark;
      } else if (m === 0) c = across === 0 ? rgbOf(hexMix(studs.color, "#ffffff", 0.35)) : studRgb;
      else if (m === 1) c = pal.dark;
    }
    return c;
  };

  const feltColor = (x: number, y: number, into: number, grain: number): RGB => {
    const edge = into < 2;
    if (edge) return grain < 0.55 ? F.rimShade : F.dark;
    switch (look.felt.texture) {
      case "felt": {
        const n = noise3(x / 6, y / 6, 0, 3) * 0.6 + grain * 0.4;
        return n < 0.26 ? F.dark : n > 0.8 ? F.light : F.base;
      }
      case "sack": {
        const t = (x % 3 === 0 ? 1 : 0) + (y % 3 === 0 ? 1 : 0);
        const stain = noise3(x / 7, y / 7, 4, 6);
        if (stain < 0.24) return F.dark;
        if (t === 2) return F.dark;
        if (t === 0 && grain > 0.6) return F.light;
        return F.base;
      }
      case "leather": {
        const n = noise3(x / 3.2, y / 3.2, 1, 5);
        if (grain < 0.025) return F.dark;
        return n < 0.3 ? F.dark : n > 0.74 ? F.light : F.base;
      }
      case "slate": {
        const n = noise3(x / 5, y / 3, 2, 9);
        if (y % 8 === 3 && grain < 0.7) return F.dark;
        return n < 0.28 ? F.dark : n > 0.78 ? F.light : F.base;
      }
      default: {
        // velvet: a soft vignette and a sparse diagonal nap.
        const v = Math.max(Math.abs((x + 0.5) / w - 0.5), Math.abs((y + 0.5) / h - 0.5)) * 2;
        if (v > 0.9) return F.dark;
        if (v > 0.78 && grain < 0.5) return F.dark;
        if (((x - y) % 6 + 6) % 6 === 0 && grain < 0.5) return F.light;
        if (grain > 0.985) return F.light;
        return F.base;
      }
    }
  };

  const piping = look.felt.piping ?? null;
  const pipingRgb = piping ? rgbOf(piping.color) : null;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const dist = d[i] as number;
      if (dist === 0) {
        data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = data[i * 4 + 3] = 0;
        continue;
      }
      const lit = Math.min(x, y) <= Math.min(w - 1 - x, h - 1 - y);
      const grain = hash3(x, y, 1, gr.seed);
      if (dist === 1) put(i, pal.outline);
      else if (dist < RIM) put(i, rimColor(x, y, dist, lit, grain));
      else if (dist === RIM) put(i, pal.lip);
      else {
        const into = dist - RIM - 1;
        if (pipingRgb && piping && into === 2 && (!piping.dashed || (x + y) % 4 < 2)) put(i, pipingRgb);
        else put(i, feltColor(x, y, into, grain));
      }
    }
  }

  // Corner pieces, stamped on last so they sit over the rim and the lip.
  if (look.rim.corners !== "none" && M) {
    const art = CORNER_ART[look.rim.corners];
    const gems = look.rim.gems ?? [];
    for (let k = 0; k < 4; k++) {
      const flipX = k % 2 === 1;
      const flipY = k >= 2;
      const gem = rgbOf(gems.length ? (gems[k % gems.length] as string) : "#ffffff");
      const glint = mix(gem, [255, 255, 255], 0.6);
      for (let ay = 0; ay < 5; ay++) {
        for (let ax = 0; ax < 5; ax++) {
          const ch = (art[ay] as string)[ax];
          if (!ch || ch === ".") continue;
          const x = flipX ? w - 1 - ax : ax;
          const y = flipY ? h - 1 - ay : ay;
          const i = y * w + x;
          if (x < 0 || y < 0 || x >= w || y >= h || (d[i] as number) === 0) continue;
          const c: RGB | null =
            ch === "k" ? pal.outline : ch === "m" ? M.light : ch === "M" ? M.body : ch === "d" ? M.deep : ch === "g" ? gem : ch === "h" ? glint : ch === "B" ? rgbOf("#eadfc2") : ch === "b" ? rgbOf("#b8a888") : ch === "t" ? rgbOf("#ff9a3c") : ch === "T" ? rgbOf("#ffe08a") : null;
          if (c) put(i, c);
        }
      }
    }
  }
}

function blend(data: Uint8ClampedArray, i: number, c: RGB, a: number): void {
  if (a <= 0) return;
  const k = Math.min(1, a);
  data[i * 4] = Math.round((data[i * 4] as number) + (c[0] - (data[i * 4] as number)) * k);
  data[i * 4 + 1] = Math.round((data[i * 4 + 1] as number) + (c[1] - (data[i * 4 + 1] as number)) * k);
  data[i * 4 + 2] = Math.round((data[i * 4 + 2] as number) + (c[2] - (data[i * 4 + 2] as number)) * k);
}

/**
 * Lay the look's motion over a tray already painted into `buf` (a copy of the
 * cached still, each frame). `tMs` is the clock. `still` draws one fixed frame
 * with no motion: what reduced motion gets, and what a contact sheet shows.
 * Only the pixels the effect touches change, and never an outside pixel.
 */
export function paintTrayEffects(buf: PixelBuffer, look: TrayLook, tMs: number, still: boolean): void {
  if (look.effects.length === 0) return;
  const { width: w, height: h, data } = buf;
  const d = distanceMap(w, h);
  const t = still ? 2200 : tMs;
  const slow = (period: number, phase = 0): number => (1 + Math.sin(t / period + phase)) / 2;
  for (const fx of look.effects) {
    const col = rgbOf(fx.color);
    if (fx.kind === "glow") {
      const a = fx.strength * (0.45 + 0.55 * slow(1100));
      for (let i = 0; i < w * h; i++) {
        const dist = d[i] as number;
        if (dist === RIM) blend(data, i, col, a);
        else if (dist === RIM + 1) blend(data, i, col, a * 0.5);
        else if (dist === 3 || dist === 2) {
          // The notches of the bone take a little of it too.
          const x = i % w;
          const y = Math.floor(i / w);
          const g = rimGeom(x, y, w, h);
          if (!g.corner && g.along % 7 === 0) blend(data, i, col, a * 0.7);
        }
      }
    } else if (fx.kind === "pulse") {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const dist = d[i] as number;
          if (dist < 2 || dist > RIM) continue;
          const g = rimGeom(x, y, w, h);
          if (dist < RIM && (g.corner || !isCrack(x, y))) continue;
          const phase = still ? 0.5 : (1 + Math.sin(t / 900 + g.along * 0.12 + (g.vertical ? 1.7 : 0))) / 2;
          blend(data, i, col, dist === RIM ? 0.12 + 0.2 * phase : 0.3 + 0.65 * phase);
        }
      }
    } else if (fx.kind === "shimmer") {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if ((d[i] as number) <= RIM) continue;
          const s = (((x * 3 + y * 2 - (still ? 330 : Math.floor(t * 0.03))) % 280) + 280) % 280;
          if (s < 12) blend(data, i, col, fx.strength * (1 - Math.abs(s - 5.5) / 6.5));
        }
      }
    } else {
      const x0 = RIM + 1;
      const y0 = RIM + 1;
      const fw = Math.max(1, w - 2 * (RIM + 1));
      const fh = Math.max(1, h - 2 * (RIM + 1));
      for (let k = 0; k < fx.count; k++) {
        const rate = 0.005 + 0.006 * hash3(k, 1, 0, 555);
        const climb = still ? hash3(k, 2, 0, 555) * fh : (t * rate + hash3(k, 2, 0, 555) * fh) % fh;
        const life = climb / fh;
        const px = Math.round(x0 + hash3(k, 0, 0, 555) * fw + Math.sin(t / 700 + k * 1.9) * (still ? 0 : 1.6));
        const py = Math.round(y0 + fh - 1 - climb);
        if (px < x0 || px >= x0 + fw || py < y0 || py >= y0 + fh) continue;
        const heat = mix(col, [80, 20, 10], life);
        const a = Math.max(0, 1 - life * 1.05) * 0.95;
        blend(data, py * w + px, heat, a);
        if (k % 3 === 0 && py + 1 < y0 + fh) blend(data, (py + 1) * w + px, heat, a * 0.5);
      }
    }
  }
}

/** Whether the look moves (and so needs repainting every frame). */
export function trayHasMotion(look: TrayLook): boolean {
  return look.effects.length > 0;
}

// ---- the "who" tag ----------------------------------------------------------

export interface WhoTag {
  readonly w: number;
  readonly h: number;
  /** RGBA, straight alpha. */
  readonly data: Uint8ClampedArray;
}

/**
 * A small plaque set into the top of the tray, lettered in the look's own accent
 * colour: whose roll it is ("The goblin rolls"). Pure. The text is cut to fit
 * `maxW` tray pixels.
 */
export function renderWhoTag(text: string, look: TrayLook, maxW: number): WhoTag {
  const line = fitLine(text, Math.max(12, maxW - 8), "bold");
  const accent = rgbOf(look.accent);
  const bmp = rasterize(line, { weight: "bold", color: [hexMix(look.accent, "#ffffff", 0.55), look.accent], outline: look.rim.palette.outline });
  const w = bmp.w + 6;
  const h = bmp.h + 4;
  const data = new Uint8ClampedArray(w * h * 4);
  const edge = rgbOf(look.rim.palette.outline);
  const body = rgbOf(look.rim.palette.dark);
  const trim = mix(rgbOf(look.rim.palette.body), accent, 0.35);
  const set = (x: number, y: number, c: RGB): void => {
    const i = (y * w + x) * 4;
    data[i] = c[0];
    data[i + 1] = c[1];
    data[i + 2] = c[2];
    data[i + 3] = 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const corner = (x === 0 || x === w - 1) && (y === 0 || y === h - 1);
      if (corner) continue;
      const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      set(x, y, border ? edge : y === 1 || x === 1 || x === w - 2 || y === h - 2 ? trim : body);
    }
  }
  const inkAt = (x: number, y: number): void => {
    const k = y * bmp.w + x;
    const v = bmp.ink[k] as number;
    if (v) set(x + 3, y + 2, rgbOf(bmp.fills[v - 1] as string));
    else if (bmp.outline[k]) set(x + 3, y + 2, edge);
  };
  for (let y = 0; y < bmp.h; y++) for (let x = 0; x < bmp.w; x++) inkAt(x, y);
  return { w, h, data };
}

/** Where a tag sits in a tray `w` wide: centred, flush with the top edge. */
export function whoTagOrigin(tagW: number, trayW: number): { x: number; y: number } {
  return { x: Math.round((trayW - tagW) / 2), y: 0 };
}

// ---- the tray ---------------------------------------------------------------

type Tone = "good" | "bad" | "plain";

const TEXT_INK = "#f4ecd0";
const TEXT_GOLD: PixelColor = ["#fff3ad", "#ffc72a"];
const TEXT_GOOD: PixelColor = ["#c2ffd2", "#59dd82"];
const TEXT_BAD: PixelColor = ["#ffb0a4", "#ff5a4a"];
const TEXT_OUTLINE = "#06140c";
/** Rows reserved under the dice for the two lines of text: the label, then the verdict. */
const TEXT_BAND = 2 * CELL_H + LINE_GAP + 4;
const TRAY_MAX_W = 360;
const TRAY_MIN_H = 160;
const TRAY_MAX_H = 200;
/** The biggest sprite for 1, 2, 3 and 4 dice. */
const SPRITE_CAP: readonly number[] = [56, 56, 50, 44, 38];
/** The smallest a die sprite is ever drawn, in tray pixels: four dice across the narrowest tray. */
export const MIN_DIE_SIZE = 24;

interface Layout {
  /** Device pixels per tray pixel. */
  kDev: number;
  /** Tray size in tray pixels. */
  w: number;
  h: number;
  /** The felt, in tray pixels (x1 and y1 exclusive). */
  felt: { x0: number; y0: number; x1: number; y1: number };
  bandTop: number;
}

interface LiveDie {
  kind: DieKind;
  result: number;
  rest: Mat3;
  x: number;
  y: number;
  z: number;
  rot: Mat3;
  visible: boolean;
}

type Mode = "empty" | "waiting" | "rolling" | "settled";
interface Caption {
  label: string;
  detail: string;
  tone: Tone;
}

/** The narrowest the tray may be drawn, in tray pixels: below this the dice get too small for their numerals to fit. */
const MIN_TRAY_W = 140;

/**
 * Device pixels per tray pixel: a whole number, so a tray pixel is never smeared
 * across device pixels, chosen so a tray pixel is as near 2 CSS pixels as
 * possible while the tray stays at least MIN_TRAY_W pixels wide. At a device pixel
 * ratio of 1 that is 2, at 1.5 it is 3, at 2 it is 4, and at 1.25 it is 2 (1.6
 * CSS pixels: 3 would be 2.4 and leave the tray too few pixels for its dice).
 */
export function pickScale(cssWidth: number, dpr: number): number {
  const ratio = dpr > 0 ? dpr : 1;
  let best = 1;
  let bestScore = Infinity;
  for (let k = 1; k <= 12; k++) {
    const css = k / ratio;
    if (Math.floor(cssWidth / css) < MIN_TRAY_W) continue;
    const score = Math.abs(css - 2);
    if (score < bestScore - 1e-9) {
      best = k;
      bestScore = score;
    }
  }
  return best;
}

/**
 * The scale the tray's waiting prompt is drawn at: 2 (twice the size, legible on a phone) when the prompt's bitmap, doubled, fits the
 * felt's width on one line and the text band's height; else 1.
 */
export function promptScale(bitmapW: number, bitmapH: number, maxW: number, bandH: number): 1 | 2 {
  return bitmapW * 2 <= maxW && bitmapH * 2 <= bandH ? 2 : 1;
}

/** Cut a line of text down to fit, with "..." where it was cut. */
function fitLine(text: string, maxW: number, weight: "regular" | "bold" = "regular"): string {
  if (textWidth(text, weight) <= maxW) return text;
  let s = text;
  while (s.length > 1 && textWidth(`${s}...`, weight) > maxW) s = s.slice(0, -1);
  return `${s.trimEnd()}...`;
}

/** How long a change of tray look takes to fade, in ms. */
const FADE_MS = 150;
/** A look that moves is repainted about this often while it sits still, in ms: its motion is slow. */
const MOTION_FRAME_MS = 60;

function sentence(list: readonly { kind: DieKind; result: number }[], cap: Caption | null, who: string | null = null): string {
  return [who, list.map((d) => `${d.kind} ${d.result}`).join(", "), cap?.label, cap?.detail].filter(Boolean).join(". ");
}

export function createDiceTray(host: HTMLElement, skinId?: string, opts: DiceTrayOptions = {}): DiceTray {
  injectStyle();
  const clock = opts.now ?? (() => performance.now());
  const seedBase = opts.seed ?? Math.floor(Math.random() * 0x7fffffff);
  let throws = 0;
  /** The player's own skin: what setSkin sets and skin() returns. */
  let playerSkin: DiceSkin = findSkin(skinId) ?? (SKINS[0] as DiceSkin);
  /** The skin the dice wear NOW: the player's, or a foe's for the current throw. */
  let skin: DiceSkin = playerSkin;
  /** The tray look NOW: the player's, or a foe's for the current throw. */
  let trayLook: TrayLook = PLAYER_LOOK;
  let whoText: string | null = null;
  let destroyed = false;

  let mode: Mode = "empty";
  let dice: LiveDie[] = [];
  let spriteSize = 40;
  let rests: RollLayout = { bounds: { x0: 0, y0: 0, x1: 1, y1: 1 }, slots: [], hop: 0 };
  let caption: Caption | null = null;
  let prompt: string | null = null;
  let waitResolve: (() => void) | null = null;
  let tapped = false;
  let roll: { plan: RollPlan; start: number; pending: Caption; resolve: () => void; watchdog: number } | null = null;
  let raf = 0;
  let layout: Layout | null = null;
  /** The painted tray for each look seen at this size: the still pixels, and the canvas made from them. */
  const bgs = new Map<string, { canvas: HTMLCanvasElement; data: Uint8ClampedArray }>();
  /** Scratch for a look that moves: a copy of its still, with this frame's motion laid over it. */
  let motion: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; img: ImageData } | null = null;
  /** The "who" plaques already cut for this size, by look and text. */
  const tags = new Map<string, HTMLCanvasElement>();
  /** The last frame of the look we just left, fading out over the new one. */
  let fade: { from: HTMLCanvasElement; start: number } | null = null;
  let lastMotionPaint = -1e9;
  let low: HTMLCanvasElement | null = null;
  let lowCtx: CanvasRenderingContext2D | null = null;
  let sprite: HTMLCanvasElement | null = null;
  let spriteCtx: CanvasRenderingContext2D | null = null;
  let lastWidth = -1;

  // ---- scaffolding
  const root = el("div", "ltd-root");
  root.dataset.ltdRoot = "";
  root.dataset.state = mode;
  root.dataset.skin = skin.id;
  root.dataset.tray = trayLook.id;
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Dice tray");
  const canvas = el("canvas");
  canvas.dataset.ltdCanvas = "";
  canvas.setAttribute("aria-hidden", "true");
  const live = el("div", "ltd-sr");
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  live.dataset.ltdLive = "";
  root.append(canvas, live);
  host.append(root);
  const ctx = canvas.getContext("2d");

  // ---- layout
  function measure(): void {
    const cssW = Math.floor(root.clientWidth || root.getBoundingClientRect().width);
    if (cssW < 80 || !ctx) {
      layout = null;
      return;
    }
    const dpr = deviceRatio();
    const kDev = pickScale(cssW, dpr);
    const css = kDev / dpr;
    const w = Math.floor(cssW / css);
    const cssH = Math.min(TRAY_MAX_H, Math.max(TRAY_MIN_H, Math.round(Math.min(cssW, TRAY_MAX_W) * 0.6)));
    const h = Math.floor(cssH / css);
    layout = { kDev, w, h, felt: { x0: RIM + 1, y0: RIM + 1, x1: w - RIM - 1, y1: h - RIM - 1 }, bandTop: h - RIM - 1 - TEXT_BAND };
    canvas.width = w * kDev;
    canvas.height = h * kDev;
    canvas.style.width = `${(w * kDev) / dpr}px`;
    canvas.style.height = `${(h * kDev) / dpr}px`;
    low = el("canvas");
    low.width = w;
    low.height = h;
    lowCtx = low.getContext("2d");
    bgs.clear();
    tags.clear();
    motion = null;
    fade = null;
    lastWidth = cssW;
  }

  /** The still tray for a look at the current size, painted once and kept. */
  function bgFor(look: TrayLook): { canvas: HTMLCanvasElement; data: Uint8ClampedArray } | null {
    const hit = bgs.get(look.id);
    if (hit) return hit;
    const L = layout;
    if (!L) return null;
    const canvas = el("canvas");
    canvas.width = L.w;
    canvas.height = L.h;
    const bctx = canvas.getContext("2d");
    if (!bctx) return null;
    const img = bctx.createImageData(L.w, L.h);
    paintTray(img, look);
    bctx.putImageData(img, 0, 0);
    const made = { canvas, data: img.data };
    bgs.set(look.id, made);
    return made;
  }

  /** Draw the tray under the dice: from the cache, or, for a look that moves, a copy with this frame's motion laid over it. */
  function drawTray(c: CanvasRenderingContext2D, now: number, still: boolean): void {
    const L = layout as Layout;
    const entry = bgFor(trayLook);
    if (!entry) return;
    if (!trayHasMotion(trayLook)) {
      c.drawImage(entry.canvas, 0, 0);
      return;
    }
    if (!motion) {
      const canvas = el("canvas");
      canvas.width = L.w;
      canvas.height = L.h;
      const mctx = canvas.getContext("2d");
      if (!mctx) {
        c.drawImage(entry.canvas, 0, 0);
        return;
      }
      motion = { canvas, ctx: mctx, img: mctx.createImageData(L.w, L.h) };
    }
    motion.img.data.set(entry.data);
    paintTrayEffects(motion.img, trayLook, now, still);
    motion.ctx.putImageData(motion.img, 0, 0);
    c.drawImage(motion.canvas, 0, 0);
  }

  /** The "who" plaque for the current look and text, cut once per size. */
  function drawWho(c: CanvasRenderingContext2D): void {
    if (!whoText || !layout) return;
    const L = layout;
    const key = `${trayLook.id}|${whoText}`;
    let tagCanvas = tags.get(key);
    if (!tagCanvas) {
      const t = renderWhoTag(whoText, trayLook, L.w - 2 * (RIM + 4));
      tagCanvas = el("canvas");
      tagCanvas.width = t.w;
      tagCanvas.height = t.h;
      tagCanvas.getContext("2d")?.putImageData(new ImageData(t.data as Uint8ClampedArray<ArrayBuffer>, t.w, t.h), 0, 0);
      if (tags.size > 12) tags.clear();
      tags.set(key, tagCanvas);
    }
    const o = whoTagOrigin(tagCanvas.width, L.w);
    c.drawImage(tagCanvas, o.x, o.y);
  }

  /** Put the tray in a look for this throw. A different tray look fades in over about 150 ms (instantly under reduced motion, or when `animate` is false). */
  function applyLook(nextSkin: DiceSkin, nextLook: TrayLook, who: string | null, animate: boolean): void {
    if (nextLook !== trayLook && animate && layout && low && !reducedMotion()) {
      const snap = el("canvas");
      snap.width = low.width;
      snap.height = low.height;
      snap.getContext("2d")?.drawImage(low, 0, 0);
      fade = { from: snap, start: clock() };
    }
    skin = nextSkin;
    trayLook = nextLook;
    whoText = who && who.trim() ? who.trim() : null;
  }

  /** Back to the player's own skin and tray, with no plaque. */
  function usePlayerLook(animate: boolean): void {
    applyLook(playerSkin, PLAYER_LOOK, null, animate);
  }

  /** Where n dice rest and how far they may roam, for the current layout. */
  function place(n: number): { size: number; rests: RollLayout } {
    const L = layout as Layout;
    const innerW = L.felt.x1 - L.felt.x0;
    const zoneTop = L.felt.y0 + 2;
    const zoneH = L.bandTop - zoneTop;
    const gap = 4;
    const count = Math.max(1, n);
    const size = Math.max(MIN_DIE_SIZE, Math.min(SPRITE_CAP[Math.min(4, count)] as number, Math.floor((innerW - gap * (count + 1)) / count), zoneH - 2));
    const hop = Math.min(10, Math.round(size * 0.2));
    const total = count * size + (count - 1) * gap;
    const x0 = L.felt.x0 + size / 2 + 1;
    const x1 = L.felt.x1 - size / 2 - 1;
    const y0 = L.felt.y0 + size / 2 + hop;
    const y1 = Math.max(y0, L.felt.y1 - size / 2 - 3);
    const cy = Math.min(y1, Math.max(y0, Math.round(zoneTop + zoneH / 2)));
    const left = (L.felt.x0 + L.felt.x1) / 2 - total / 2 + size / 2;
    const slots = Array.from({ length: n }, (_, i) => ({ x: Math.round(Math.min(x1, Math.max(x0, left + i * (size + gap)))), y: cy }));
    return { size, rests: { bounds: { x0, y0, x1, y1 }, slots, hop } };
  }

  function setMode(next: Mode): void {
    mode = next;
    root.dataset.state = next;
    if (next === "waiting" && !tapped) {
      root.setAttribute("role", "button");
      root.tabIndex = 0;
      root.setAttribute("aria-label", prompt ?? "Tap to roll");
    } else {
      root.setAttribute("role", "group");
      root.tabIndex = 0;
      root.setAttribute("aria-label", "Dice tray");
    }
  }

  function syncData(): void {
    root.dataset.skin = skin.id;
    root.dataset.tray = trayLook.id;
    root.dataset.who = whoText ?? "";
    root.dataset.dice = dice.map((d) => `${d.kind}=${d.result}`).join(",");
    root.dataset.text = caption ? [caption.label, caption.detail].filter(Boolean).join(" | ") : prompt && mode === "waiting" ? prompt : "";
  }

  function setDice(list: readonly { kind: DieKind; result: number }[]): void {
    const made = layout ? place(list.length) : null;
    if (made) {
      spriteSize = made.size;
      rests = made.rests;
    }
    dice = list.map((d, i) => {
      const rest = restOrientation(d.kind, d.result);
      const s = rests.slots[i] ?? { x: 0, y: 0 };
      return { kind: d.kind, result: d.result, rest, x: s.x, y: s.y, z: 0, rot: rest, visible: true };
    });
  }

  // ---- drawing
  const textCache = new Map<string, PixelBitmap>();
  function textBitmap(s: string, bold: boolean, color: PixelColor): PixelBitmap {
    const key = `${s}|${bold ? 1 : 0}|${Array.isArray(color) ? color.join(",") : color}`;
    let b = textCache.get(key);
    if (!b) {
      b = rasterize(s, { weight: bold ? "bold" : "regular", color, outline: TEXT_OUTLINE });
      if (textCache.size > 80) textCache.clear();
      textCache.set(key, b);
    }
    return b;
  }

  function shadow(c: CanvasRenderingContext2D, x: number, y: number, size: number, z: number): void {
    const rx = Math.max(3, Math.round(size * 0.3 - z * 0.12));
    const ry = Math.max(2, Math.round(size * 0.1));
    const cy = Math.round(y + size * 0.34);
    c.fillStyle = "rgba(4, 16, 9, 0.5)";
    for (let dy = -ry; dy <= ry; dy++) {
      const half = Math.round(rx * Math.sqrt(1 - (dy / (ry + 0.5)) ** 2));
      if (z > 2) {
        // Up in the air the shadow is a loose dither, not a solid patch.
        for (let dx = -half; dx <= half; dx++) if ((dx + dy) % 2 === 0) c.fillRect(Math.round(x) + dx, cy + dy, 1, 1);
      } else c.fillRect(Math.round(x) - half, cy + dy, half * 2 + 1, 1);
    }
  }

  function paint(now: number): void {
    if (!layout || !ctx || !low || !lowCtx) return;
    const L = layout;
    const c = lowCtx;
    const still = reducedMotion();
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, L.w, L.h);
    drawTray(c, now, still);
    drawWho(c);
    const size = spriteSize;
    if (!sprite || sprite.width !== size) {
      sprite = el("canvas");
      sprite.width = sprite.height = size;
      spriteCtx = sprite.getContext("2d");
    }
    const shown = dice.filter((d) => d.visible).sort((a, b) => a.y - b.y);
    for (const d of shown) shadow(c, d.x, d.y, size, d.z);
    const waiting = mode === "waiting";
    for (const d of shown) {
      let rot = d.rot;
      let bob = 0;
      if (waiting && !still) {
        const w = wobbleAt(d.rest, now, dice.indexOf(d) * 1.3);
        rot = w.rot;
        bob = w.bob;
      }
      if (!spriteCtx) continue;
      // Numerals in every state: waiting, tumbling and settled. The wobble is under every die's headroom, so the front face never changes.
      const s = renderDie(d.kind, rot, skin, size);
      spriteCtx.putImageData(new ImageData(s.data, size, size), 0, 0);
      c.drawImage(sprite, Math.round(d.x - size / 2), Math.round(d.y - d.z - size / 2 + bob));
    }
    const maxW = L.felt.x1 - L.felt.x0 - 6;
    const centred = (bmp: PixelBitmap, y: number): void => paintBitmap(c, bmp, 1, Math.round((L.w - bmp.w) / 2), Math.round(y));
    if (mode === "settled" && caption) {
      const tone: PixelColor = caption.tone === "good" ? TEXT_GOOD : caption.tone === "bad" ? TEXT_BAD : TEXT_GOLD;
      if (caption.label) centred(textBitmap(fitLine(caption.label, maxW), false, TEXT_INK), L.bandTop + 2);
      if (caption.detail) centred(textBitmap(fitLine(caption.detail, maxW), true, tone), L.bandTop + 2 + CELL_H + LINE_GAP);
    } else if (waiting && prompt && (still || tapped || now % 1300 < 1000)) {
      const whole = textBitmap(prompt, true, TEXT_GOLD);
      if (promptScale(whole.w, whole.h, maxW, TEXT_BAND) === 2) {
        paintBitmap(c, whole, 2, Math.round((L.w - whole.w * 2) / 2), Math.round(L.bandTop + (TEXT_BAND - whole.h * 2) / 2));
      } else centred(textBitmap(fitLine(prompt, maxW), true, TEXT_GOLD), L.bandTop + (TEXT_BAND - CELL_H) / 2);
    }
    // The look we just left fades out over the new one: about 150 ms, and never under reduced motion.
    if (fade) {
      const p = (now - fade.start) / FADE_MS;
      if (p >= 1 || still) fade = null;
      else {
        c.globalAlpha = 1 - p;
        c.drawImage(fade.from, 0, 0);
        c.globalAlpha = 1;
      }
    }
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(low, 0, 0, L.w * L.kDev, L.h * L.kDev);
  }

  function schedule(): void {
    if (raf || destroyed || typeof requestAnimationFrame !== "function") return;
    raf = requestAnimationFrame(tick);
  }

  function tick(): void {
    raf = 0;
    if (destroyed) return;
    const now = clock();
    if (roll) {
      const t = now - roll.start;
      dice.forEach((d, i) => {
        const s = motionAt(roll?.plan.dice[i] as DieMotion, t);
        d.x = s.x;
        d.y = s.y;
        d.z = s.z;
        d.rot = s.rot;
        d.visible = s.visible;
      });
      paint(now);
      if (t >= (roll?.plan.duration ?? 0)) finishRoll();
      else schedule();
    } else if (mode === "waiting") {
      paint(now);
      if (!reducedMotion()) schedule();
    } else if ((mode === "settled" || mode === "empty") && !reducedMotion() && (trayHasMotion(trayLook) || fade)) {
      // A settled tray in a look that moves (embers, a shimmer, a glow) keeps breathing: repainted at a slow rate, and not at all when the page is hidden (the browser stops the frames).
      if (now - lastMotionPaint >= MOTION_FRAME_MS || fade) {
        lastMotionPaint = now;
        paint(now);
      }
      schedule();
    }
  }

  /** Put every die on its slot at rest. */
  function settle(): void {
    dice.forEach((d, i) => {
      const s = rests.slots[i] ?? { x: d.x, y: d.y };
      d.x = s.x;
      d.y = s.y;
      d.z = 0;
      d.rot = d.rest;
      d.visible = true;
    });
  }

  function finishRoll(): void {
    const r = roll;
    if (!r) return;
    roll = null;
    clearTimeout(r.watchdog);
    settle();
    caption = r.pending;
    setMode("settled");
    syncData();
    live.textContent = sentence(dice, caption, whoText);
    paint(clock());
    if (trayHasMotion(trayLook) && !reducedMotion()) schedule();
    r.resolve();
  }

  function endWait(): void {
    const w = waitResolve;
    waitResolve = null;
    if (w) w();
  }

  // ---- the player's tap: a click, or Space or Enter while the tray has focus
  function trigger(): void {
    if (mode !== "waiting" || tapped || !waitResolve) return;
    tapped = true;
    setMode("waiting");
    endWait();
  }
  root.addEventListener("click", trigger);
  root.addEventListener("keydown", (e) => {
    if ((e.key === " " || e.key === "Enter") && mode === "waiting" && !tapped) {
      e.preventDefault();
      trigger();
    }
  });

  // ---- size changes
  let ro: ResizeObserver | null = null;
  /** The animation frame a relayout waits for, or 0. */
  let roFrame = 0;
  function relayout(): void {
    if (destroyed) return;
    if (roll) finishRoll();
    measure();
    if (layout && dice.length) setDice(dice.map((d) => ({ kind: d.kind, result: d.result })));
    paint(clock());
    if (mode === "waiting") schedule();
  }
  if (typeof ResizeObserver === "function") {
    // The relayout rewrites the canvas size, which changes the very box this observes. Doing that inside the callback makes the browser
    // raise "ResizeObserver loop completed with undelivered notifications" as a window error (the shell paints it as a red banner), so
    // the work waits for the next frame, and only runs when the width really changed.
    ro = new ResizeObserver(() => {
      if (roFrame || destroyed || typeof requestAnimationFrame !== "function") return;
      roFrame = requestAnimationFrame(() => {
        roFrame = 0;
        if (!destroyed && Math.floor(root.clientWidth) !== lastWidth) relayout();
      });
    });
    ro.observe(root);
  }
  measure();
  paint(clock());

  // ---- the public tray
  return {
    awaitRoll(promptText: string, preview: readonly DieKind[]): Promise<void> {
      if (destroyed) return Promise.resolve();
      if (roll) finishRoll();
      endWait();
      if (!layout) measure();
      usePlayerLook(true);
      tapped = false;
      prompt = promptText;
      caption = null;
      setDice(preview.slice(0, 4).map((kind) => ({ kind, result: DIE_SIDES[kind] })));
      setMode("waiting");
      syncData();
      live.textContent = promptText;
      paint(clock());
      schedule();
      return new Promise<void>((resolve) => {
        waitResolve = resolve;
      });
    },

    roll(req: RollRequest): Promise<void> {
      if (destroyed) return Promise.resolve();
      if (roll) finishRoll();
      const waitedAt = mode === "waiting" ? dice.map((d) => ({ x: d.x, y: d.y, rot: d.rest })) : null;
      endWait();
      if (!layout) measure();
      // This throw's look: the foe's skin and tray when it asks for them (an unknown id is ignored), the player's own otherwise.
      applyLook((req.skin !== undefined ? skinById(req.skin) : undefined) ?? playerSkin, (req.tray !== undefined ? trayLookById(req.tray) : undefined) ?? PLAYER_LOOK, req.who ?? null, true);
      tapped = false;
      prompt = null;
      caption = null;
      const list = req.dice.slice(0, 4).map((d) => ({ kind: d.kind, result: Math.min(DIE_SIDES[d.kind], Math.max(1, Math.round(d.result))) }));
      const pending: Caption = { label: req.label ?? "", detail: req.detail ?? "", tone: req.tone ?? "plain" };
      setDice(list);
      if (!layout || list.length === 0 || reducedMotion()) {
        caption = pending;
        setMode("settled");
        syncData();
        live.textContent = sentence(list, caption, whoText);
        paint(clock());
        return Promise.resolve();
      }
      const plan = planRoll(list, rests, req.seed ?? seedBase + 0x9e3779b1 * ++throws, waitedAt);
      setMode("rolling");
      syncData();
      live.textContent = "";
      return new Promise<void>((resolve) => {
        roll = { plan, start: clock(), pending, resolve, watchdog: window.setTimeout(finishRoll, ROLL_MS + 400) };
        tick();
      });
    },

    setSkin(id: string): void {
      const next = findSkin(id);
      if (destroyed || !next) return;
      if (next === playerSkin && trayLook === PLAYER_LOOK) return;
      playerSkin = next;
      usePlayerLook(false);
      syncData();
      paint(clock());
    },

    skin(): DiceSkin {
      return playerSkin;
    },

    look(): TrayLook {
      return trayLook;
    },

    skip(): void {
      if (!destroyed && roll) finishRoll();
    },

    clear(): void {
      if (destroyed) return;
      if (roll) finishRoll();
      endWait();
      tapped = false;
      prompt = null;
      caption = null;
      dice = [];
      usePlayerLook(false);
      setMode("empty");
      syncData();
      live.textContent = "";
      paint(clock());
    },

    destroy(): void {
      if (destroyed) return;
      if (roll) finishRoll();
      endWait();
      destroyed = true;
      if (raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
      if (roFrame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(roFrame);
      roFrame = 0;
      ro?.disconnect();
      root.remove();
    },
  };
}

// ---- a still of a tray, for other views --------------------------------------
//
// A small picture of a look with settled dice in it, composed at tray resolution
// by the same painters the live tray uses (so the Bestiary, a shop shelf or the
// contact sheet shows exactly what the tray will). Pure down to the pixels; only
// renderTrayPreview touches the DOM.

export interface TrayStillOptions {
  /** The tray's size in tray pixels. Default 96 by 60 (at least 48 by 36). */
  width?: number;
  height?: number;
  /** A "who" plaque, as the live tray draws it. */
  who?: string;
  /** The clock for a look that moves. Omit for one fixed frame with no motion. */
  t?: number;
}

/** The tray in a look, with these dice settled on their results, as RGBA pixels. Pure. Unknown ids fall back to the player's tray and the first shop skin. */
export function composeTrayDice(lookId: string, skinId: string, diceList: readonly { kind: DieKind; result: number }[], opts: TrayStillOptions = {}): PixelBuffer {
  const w = Math.max(48, Math.floor(opts.width ?? 96));
  const h = Math.max(36, Math.floor(opts.height ?? 60));
  const look = trayLookById(lookId) ?? PLAYER_LOOK;
  const skin = skinById(skinId) ?? (SKINS[0] as DiceSkin);
  const buf: PixelBuffer = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  const data = buf.data;
  paintTray(buf, look);
  paintTrayEffects(buf, look, opts.t ?? 0, opts.t === undefined);
  const who = opts.who && opts.who.trim() ? opts.who.trim() : null;
  let tagH = 0;
  if (who) {
    const tag = renderWhoTag(who, look, w - 2 * (RIM + 4));
    const o = whoTagOrigin(tag.w, w);
    tagH = tag.h;
    for (let y = 0; y < tag.h; y++) {
      for (let x = 0; x < tag.w; x++) {
        const k = (y * tag.w + x) * 4;
        if (tag.data[k + 3] === 0) continue;
        const i = ((o.y + y) * w + o.x + x) * 4;
        data[i] = tag.data[k] as number;
        data[i + 1] = tag.data[k + 1] as number;
        data[i + 2] = tag.data[k + 2] as number;
        data[i + 3] = 255;
      }
    }
  }
  const list = diceList.slice(0, 4);
  const n = list.length;
  if (n === 0) return buf;
  const innerW = w - 2 * (RIM + 1);
  const innerH = h - 2 * (RIM + 1);
  const gap = 4;
  const room = Math.max(16, innerH - 4 - (tagH > 0 ? Math.max(0, tagH - RIM - 1) : 0));
  const size = Math.max(16, Math.min(SPRITE_CAP[Math.min(4, n)] as number, Math.floor((innerW - gap * (n + 1)) / n), room));
  const total = n * size + (n - 1) * gap;
  const cy = Math.round(h / 2 + (tagH > 0 ? Math.max(0, tagH - RIM - 1) / 2 : 0));
  list.forEach((d, i) => {
    const kind = d.kind;
    const result = Math.min(DIE_SIDES[kind], Math.max(1, Math.round(d.result)));
    const cx = Math.round(w / 2 - total / 2 + size / 2 + i * (size + gap));
    // The soft shadow under the die, as the live tray draws it (a die at rest: solid).
    const rx = Math.max(3, Math.round(size * 0.3));
    const ry = Math.max(2, Math.round(size * 0.1));
    const sy = Math.round(cy + size * 0.34);
    for (let dy = -ry; dy <= ry; dy++) {
      const half = Math.round(rx * Math.sqrt(1 - (dy / (ry + 0.5)) ** 2));
      for (let dx = -half; dx <= half; dx++) {
        const px = cx + dx;
        const py = sy + dy;
        if (px >= 0 && py >= 0 && px < w && py < h && data[(py * w + px) * 4 + 3] === 255) blend(data, py * w + px, [4, 16, 9], 0.5);
      }
    }
    const sprite = renderDie(kind, restOrientation(kind, result), skin, size);
    const ox = Math.round(cx - size / 2);
    const oy = Math.round(cy - size / 2);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const k = (y * size + x) * 4;
        if (sprite.data[k + 3] === 0) continue;
        const px = ox + x;
        const py = oy + y;
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        const j = (py * w + px) * 4;
        data[j] = sprite.data[k] as number;
        data[j + 1] = sprite.data[k + 1] as number;
        data[j + 2] = sprite.data[k + 2] as number;
        data[j + 3] = 255;
      }
    }
  });
  return buf;
}

/** One settled die in a tray look, as RGBA pixels. Pure; see composeTrayDice for several dice. */
export function composeTrayStill(lookId: string, skinId: string, kind: DieKind, result: number, opts: TrayStillOptions = {}): PixelBuffer {
  return composeTrayDice(lookId, skinId, [{ kind, result }], opts);
}

/**
 * A small still of a tray look with one settled die in it, as a canvas: for the
 * Bestiary, a shop shelf, anywhere a view wants to show what a foe's dice and tray
 * look like. The canvas is exactly `width` by `height` pixels (default 96 by 60);
 * pass `scale` (a whole number) to draw it up crisp, which multiplies both. Browser only.
 */
export function renderTrayPreview(lookId: string, skinId: string, kind: DieKind, result: number, opts: { width?: number; height?: number; scale?: number; who?: string } = {}): HTMLCanvasElement {
  const buf = composeTrayStill(lookId, skinId, kind, result, { width: opts.width, height: opts.height, who: opts.who });
  const k = Math.max(1, Math.floor(opts.scale ?? 1));
  const src = document.createElement("canvas");
  src.width = buf.width;
  src.height = buf.height;
  src.getContext("2d")?.putImageData(new ImageData(buf.data as Uint8ClampedArray<ArrayBuffer>, buf.width, buf.height), 0, 0);
  if (k === 1) {
    src.setAttribute("aria-hidden", "true");
    return src;
  }
  const out = document.createElement("canvas");
  out.width = buf.width * k;
  out.height = buf.height * k;
  const o = out.getContext("2d");
  if (o) {
    o.imageSmoothingEnabled = false;
    o.drawImage(src, 0, 0, out.width, out.height);
  }
  out.setAttribute("aria-hidden", "true");
  return out;
}

// ---- the skin picker --------------------------------------------------------

const FRAME_CORNER = ["..ooo", ".oLLL", "oLMMM", "oLMFF", "oLMFF"];
const FRAME_SLICE = 5;
const FRAME_PX = 16;
const FRAMES: Record<"win" | "gold", { o: string; L: string; M: string; F: string }> = {
  win: { o: "#05061a", L: "#e6dcb4", M: "#4d5da6", F: "#141a3c" },
  gold: { o: "#1a0f00", L: "#ffe27a", M: "#b8801a", F: "#221a3a" },
};

/** A nine-slice pixel window as a CSS url(), cut at 5 px: the corner is the art, the edges and middle repeat its last row and column. */
function frameUrl(key: "win" | "gold"): string | null {
  try {
    const pal = FRAMES[key];
    const c = document.createElement("canvas");
    c.width = c.height = FRAME_PX;
    const cx = c.getContext("2d");
    if (!cx) return null;
    for (let y = 0; y < FRAME_PX; y++) {
      for (let x = 0; x < FRAME_PX; x++) {
        const px = x < FRAME_SLICE ? x : x >= FRAME_PX - FRAME_SLICE ? FRAME_PX - 1 - x : FRAME_SLICE - 1;
        const py = y < FRAME_SLICE ? y : y >= FRAME_PX - FRAME_SLICE ? FRAME_PX - 1 - y : FRAME_SLICE - 1;
        const code = (FRAME_CORNER[py] ?? "")[px];
        if (!code || code === ".") continue;
        cx.fillStyle = pal[code as "o" | "L" | "M" | "F"];
        cx.fillRect(x, y, 1, 1);
      }
    }
    return `url(${c.toDataURL("image/png")})`;
  } catch {
    return null;
  }
}

/** A sprite as a canvas drawn up at a whole number of device pixels per sprite pixel, so it stays crisp. */
export function spriteCanvas(s: DieSprite, scale: number): HTMLCanvasElement {
  const dpr = deviceRatio();
  const kDev = deviceScale(scale, dpr);
  const src = document.createElement("canvas");
  src.width = src.height = s.size;
  src.getContext("2d")?.putImageData(new ImageData(s.data, s.size, s.size), 0, 0);
  const out = document.createElement("canvas");
  out.width = out.height = s.size * kDev;
  out.style.width = out.style.height = `${(s.size * kDev) / dpr}px`;
  const o = out.getContext("2d");
  if (o) {
    o.imageSmoothingEnabled = false;
    o.drawImage(src, 0, 0, s.size * kDev, s.size * kDev);
  }
  out.setAttribute("aria-hidden", "true");
  return out;
}

const SHOP_INK = "#f4ecd0";
const SHOP_MUTED = "#98a5d8";
const SHOP_GOLD: PixelColor = ["#fff3ad", "#ffc72a"];
const SHOP_GOOD: PixelColor = ["#c2ffd2", "#59dd82"];
const SHOP_DARK = "#05061a";
const SHOP_NOTE = "These are previews. Pick one to try it on the tray.";
/** The shelf d20 is drawn this big (sprite pixels) so its "20" has room inside its face. */
const PREVIEW_SIZE = 48;

/**
 * A shop shelf of every skin: a small d20 showing a natural 20, the name, and
 * "Owned" or the price in credits. Picking an owned skin equips it on the tray;
 * picking an unowned one equips it as a labelled "Try" preview and calls onTry.
 * Nothing is bought here: no purchase is wired, and the panel says so.
 */
export function createSkinPicker(host: HTMLElement, tray: DiceTray, opts: { owned: readonly string[]; onTry?: (id: string) => void }): { destroy(): void } {
  injectStyle();
  const owned = new Set(opts.owned);
  const root = el("div", "ltd-shop");
  root.dataset.ltdShop = "";
  const win = frameUrl("win");
  const gold = frameUrl("gold");
  if (win) root.style.setProperty("--ltd-win", win);
  if (gold) root.style.setProperty("--ltd-gold", gold);
  const title = pixelText("DICE SKINS", { scale: 2, color: SHOP_GOLD, outline: SHOP_DARK });
  title.setAttribute("aria-hidden", "true");
  title.style.margin = "4px 4px 0";
  const heading = el("div", "ltd-sr", "Dice skins");
  heading.setAttribute("role", "heading");
  heading.setAttribute("aria-level", "2");
  const grid = el("div", "ltd-shop-grid");
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", "Dice skins");
  const noteHost = el("div");
  noteHost.style.margin = "0 4px 4px";
  const noteText = el("div", "ltd-sr", SHOP_NOTE);
  root.append(title, heading, grid, noteHost, noteText);
  host.append(root);

  const cards = new Map<string, HTMLButtonElement>();
  let destroyed = false;

  function build(skin: DiceSkin): HTMLButtonElement {
    const isOwned = owned.has(skin.id);
    const card = el("button", "ltd-card");
    card.type = "button";
    card.dataset.skin = skin.id;
    const badgeRow = el("span", "ltd-row");
    badgeRow.dataset.ltdBadge = "";
    const art = el("span", "ltd-art");
    art.style.lineHeight = "0";
    art.append(spriteCanvas(renderDie("d20", restOrientation("d20", 20), skin, PREVIEW_SIZE), 2));
    const nameRow = el("span", "ltd-row");
    nameRow.append(pixelText(skin.name, { scale: 2, color: SHOP_INK, outline: SHOP_DARK }));
    const priceRow = el("span", "ltd-row");
    const price = isOwned ? "Owned" : "Preview";
    priceRow.append(pixelText(price, { scale: 2, color: isOwned ? SHOP_GOOD : SHOP_GOLD, outline: SHOP_DARK }));
    card.append(badgeRow, art, nameRow, priceRow);
    for (const c of card.querySelectorAll("canvas")) c.setAttribute("aria-hidden", "true");
    card.addEventListener("click", () => {
      if (destroyed) return;
      tray.setSkin(skin.id);
      if (!isOwned) opts.onTry?.(skin.id);
      refresh();
    });
    return card;
  }

  function refresh(): void {
    const current = tray.skin().id;
    for (const skin of DICE_SKINS) {
      const card = cards.get(skin.id);
      if (!card) continue;
      const on = skin.id === current;
      const isOwned = owned.has(skin.id);
      card.setAttribute("aria-pressed", String(on));
      card.setAttribute("aria-label", `${skin.name}, ${isOwned ? "owned" : "preview"}${on ? (isOwned ? ", in use" : ", trying it") : ""}`);
      const badge = card.querySelector<HTMLElement>("[data-ltd-badge]");
      if (!badge) continue;
      badge.replaceChildren();
      badge.dataset.badge = on ? (isOwned ? "use" : "try") : "";
      if (on) {
        const tag = pixelText(isOwned ? "IN USE" : "TRY IT", { scale: 2, color: isOwned ? SHOP_GOOD : SHOP_GOLD, outline: SHOP_DARK });
        tag.setAttribute("aria-hidden", "true");
        badge.append(tag);
      }
    }
  }

  /** The note wraps at the panel's width, redrawn when that changes. */
  let noteWidth = -1;
  function layoutNote(): void {
    const avail = Math.floor(root.clientWidth - 48);
    if (avail < 40 || avail === noteWidth) return;
    noteWidth = avail;
    const note = pixelText(SHOP_NOTE, { scale: 2, color: SHOP_MUTED, outline: SHOP_DARK, maxWidth: wrapWidth(avail, 2, deviceRatio()) });
    note.setAttribute("aria-hidden", "true");
    noteHost.replaceChildren(note);
  }

  for (const skin of DICE_SKINS) {
    const card = build(skin);
    cards.set(skin.id, card);
    grid.append(card);
  }
  refresh();
  layoutNote();
  let ro: ResizeObserver | null = null;
  let noteFrame = 0;
  if (typeof ResizeObserver === "function") {
    // Deferred a frame for the same reason as the tray's: redrawing the note changes the box being observed.
    ro = new ResizeObserver(() => {
      if (noteFrame || destroyed || typeof requestAnimationFrame !== "function") return;
      noteFrame = requestAnimationFrame(() => {
        noteFrame = 0;
        if (!destroyed) layoutNote();
      });
    });
    ro.observe(root);
  }

  return {
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      if (noteFrame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(noteFrame);
      noteFrame = 0;
      ro?.disconnect();
      root.remove();
    },
  };
}
