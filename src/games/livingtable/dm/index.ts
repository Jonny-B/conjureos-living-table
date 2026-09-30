/**
 * The Living Table's DM turn protocol, barrel export (DESIGN.md, "The DM
 * turn protocol"): the wire schema and its validator, the system-prompt
 * builder, and the one `completeJson` call site that ties them together.
 */
export * from "./turnSchema";
export * from "./promptBuilder";
export * from "./dmTurn";
