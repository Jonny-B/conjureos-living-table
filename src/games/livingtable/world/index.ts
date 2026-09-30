/**
 * The Living Table's coordinate/perception/manipulation engine (DESIGN.md,
 * "The Living Table"). This is what guarantees "no floating props, no tokens
 * in walls, exits that lead somewhere" as an engine property, not a hope from
 * a good prompt: every mutation is validated against the actual board state
 * before it's applied, and a rejected one is dropped and reported back rather
 * than silently applied wrong.
 */
export * from "./coordinates";
export * from "./cell";
export * from "./connectivity";
export * from "./perception";
export * from "./manipulation";
export * from "./reach";
