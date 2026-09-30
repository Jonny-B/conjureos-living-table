/**
 * The Living Table's SRD 5.1 rules engine, barrel export.
 *
 * See DESIGN.md, "The rules engine: real D&D, SRD 5.1": this is the part of
 * the game that decides hit-or-miss, damage, legality, and save success. The
 * AI never rolls; it can only request that these functions do (see
 * DESIGN.md, "The DM turn protocol").
 */
export * from "./dice";
export * from "./abilities";
export * from "./armorClass";
export * from "./combat";
export * from "./magicItems";
export * from "./checks";
export * from "./conditions";
export * from "./maneuvers";
export * from "./initiative";
export * from "./actionEconomy";
export * from "./spells";
export * from "./leveling";
export * from "./attunement";
export * from "./loot";
export * from "./inventory";
