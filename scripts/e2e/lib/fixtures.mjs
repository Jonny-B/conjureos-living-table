// Canned model replies for the table's DM. The shape is the DM's own reply (table/dmCore.ts validateDmReply):
// { narration, cost, effects, options }. Kept here, not imported, so a change to the game's mock cannot silently
// change what a spec asserts.

/** One DM answer: narration only, no effects, two suggested next moves. */
export function dmReply({ narration = "The cellar air is cold and smells of old ale. Nothing stirs.", options } = {}) {
  return {
    narration,
    cost: "free",
    effects: [],
    options: options ?? [
      { label: "Look around", say: "I look around the room." },
      { label: "Wait", say: "I wait and listen." },
    ],
  };
}

/** A DM answer long enough to need several pages in the dialogue box. */
export const LONG_NARRATION =
  "You lean over the rim of the old well and the cold breath of it fills your lungs. Far below, a thin line of water catches the lantern light, and something beside it moves: a pale, many-jointed shape the size of a dog, tapping its way along the wet stone. It stops. It has heard you. For a long moment nothing in the whole cellar breathes, and then, very softly, the scratching starts again, only this time it is climbing.";

/** The script every table spec needs: any DM ask gets `reply` (a function of the call is allowed). */
export function dmScript(reply = dmReply()) {
  return [
    {
      match: (call) => !/You are writing ONE complete adventure/.test(call.messages[0]?.content ?? ""),
      reply: (call, n) => JSON.stringify(typeof reply === "function" ? reply(call, n) : reply),
    },
  ];
}
