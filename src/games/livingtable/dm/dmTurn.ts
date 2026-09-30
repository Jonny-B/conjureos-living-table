/**
 * requestDmTurn: the one call site that actually talks to the model for a
 * DM turn. Mirrors `coldcase/generate.ts`'s `generateCase()` shape --
 * build a system prompt, hand it and the message history to `completeJson`
 * with the schema's validator, let `completeJson`'s built-in one retry
 * handle a malformed first reply, and throw if even the retry doesn't
 * validate rather than let a broken turn reach the board.
 */
import { completeJson, type ChatMessage, THINKING_HEADROOM_TOKENS } from "../../../bridge/ai";
import { combatGeometryFrom } from "../world/reach";
import { buildDmSystemPrompt, type DmPromptArgs } from "./promptBuilder";
import { validateDmTurn, type DmTurn } from "./turnSchema";

/**
 * `priorMessages` is the campaign's running transcript -- narration and
 * player actions, alternating assistant/user -- and must end with the
 * player's latest message (their free-text line, or a synthesized one for a
 * command-menu action like "Move north"), the same contract Vault's `send`
 * and Cold Case's interrogation follow. `args` is rebuilt by the caller from
 * the campaign's CURRENT state before every call (see promptBuilder.ts's
 * header) -- the system prompt is never reused turn to turn, only the
 * message list accumulates.
 *
 * `tier: "capable"` because a DM turn has to reason about spatial layout and
 * stay inside a closed action vocabulary under one shot with no
 * tool-calling to lean on -- the same bar Cold Case's case generator sets
 * for itself, not the cheap tier Vault's quick back-and-forth uses.
 * `temperature` is lower than Cold Case's case-writing pass (1) because a DM
 * turn is closer to "follow the rules exactly" than "invent something
 * novel" -- some narrative variety still matters, but a wildly creative
 * reply is far more likely to wander outside the schema and burn the one
 * retry `completeJson` gives it.
 */
export async function requestDmTurn(args: DmPromptArgs, priorMessages: ChatMessage[]): Promise<DmTurn> {
  // Same discipline as `resolvedRolls`, one field over: the geometry that
  // prints each token's distance and reach into the prompt is the SAME object
  // validateDmTurn checks an attack's reach against, so what the model is
  // shown and what the validator enforces cannot drift apart. Derived from
  // the playspace when the caller supplies none, because a reach rule that
  // only applies when someone remembers to wire it up is not a rule.
  const geometry = args.combatGeometry ?? (args.playspace ? combatGeometryFrom(args.playspace) : undefined);
  const withGeometry: DmPromptArgs = geometry ? { ...args, combatGeometry: geometry } : args;

  // The exact rolls `args.resolvedRolls` puts in front of the model (via
  // buildDmSystemPrompt's RESOLVED ROLLS block, id/by/against/hit-or-success
  // and all) are the exact rolls validateDmTurn will check a "combat"
  // resolvedRollId citation against -- the same list, in the same call, so
  // what the model is told it may cite and what actually validates can
  // never drift apart.
  return completeJson<DmTurn>(
    {
      system: buildDmSystemPrompt(withGeometry),
      messages: priorMessages,
      maxTokens: THINKING_HEADROOM_TOKENS,
      tier: "capable",
      temperature: 0.7,
    },
    (value) => validateDmTurn(value, { resolvedRolls: args.resolvedRolls, geometry }),
  );
}
