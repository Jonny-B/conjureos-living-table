/**
 * What the table window's flows share that needs no window: the score-read pause, the signed and die helpers, the goblin's barks and the AI writer's note.
 */
import type { TileId } from "../../world/cell";
import type { DieKind } from "../ui/dice";

/** How long a rolled ability score stays on the tray before the next one is thrown, in the creator. */
export const SCORE_READ_MS = 700;
export const signedNum = (n: number): string => (n >= 0 ? `+ ${n}` : `- ${-n}`);
export const dieOf = (sides: number): DieKind => `d${sides}` as DieKind;

/** Things the goblin says, bench-only flavour (the game's DM has narration only). */
export const GOBLIN_BARKS = {
  wake: ["Shinies! Give us the shinies!", "Intruder! Mine, mine, all mine!", "Hee hee. Fresh meat."],
  hurt: ["Ow! Nasty!", "Yaaagh!", "Not the face!"],
  dodge: ["Hah! Too slow!", "Missed me!"],
  miss: ["Grr! Hold still!"],
  thief: ["Hey! Thief!"],
} as const;
/** Said above the AI writer's premise box. No price, no number, no credits: the platform's credit icon says what AI use costs. */
export const AI_WRITER_NOTE = "Writing a whole adventure is a long AI job and takes a few minutes. Only press this if you want a new one made for you.";
export const bark = (list: readonly string[]): string => list[Math.floor(Math.random() * list.length)]!;
/** Which creatures talk: the goblin has barks; a skeleton or a rat does not, and the board stays quiet for them. */
export const barksFor = (token: TileId): typeof GOBLIN_BARKS | null => (token === "token_goblin" ? GOBLIN_BARKS : null);
