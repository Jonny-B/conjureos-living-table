// Canned model replies for the campaign flow. Shapes are copied from the dev
// mock in src/bridge/ai.ts (mockArcOutline, mockDmTurn), which the game's own
// validators accept; asset ids are the launch roster's (scripts/assets/fantasy.ts).
// Kept here, not imported, so a future change to that mock cannot silently
// change what a spec asserts.

/** What generateCampaignArc asks for: system prompt contains LIVINGTABLE_ARC_GENERATOR. */
export function arcOutline(genre = "fantasy") {
  if (genre === "scifi") {
    return {
      title: "Signal from the Drift",
      throughline: "A derelict station keeps broadcasting a distress call it has no business still sending.",
      beats: [
        "The crew boards the station and meets its one surviving officer, half out of her mind.",
        "A locked section holds the reason the station went dark in the first place.",
        "Something that was never meant to wake up does.",
        "The crew decides what, if anything, to bring back with them.",
      ],
      npcs: [{ name: "Chief Vey", role: "the station's last living officer" }],
      regionSketch: [
        { cx: 0, cy: 0, hint: "the docking spine, emergency lighting only" },
        { cx: 1, cy: 0, hint: "crew quarters, every door manually jammed open from the inside" },
        { cx: 0, cy: -1, hint: "hydroponics, still running, still watering nothing" },
        { cx: -1, cy: 0, hint: "the medbay Chief Vey has barricaded herself into" },
        { cx: 0, cy: 1, hint: "the reactor gallery, where the distress beacon is wired in" },
        { cx: 1, cy: -1, hint: "a sealed lab section the station's own manifest does not list" },
      ],
    };
  }
  return {
    title: "The Salt-Blighted Coast",
    throughline: "A creeping blight is poisoning the coastline, and something old beneath the marsh is stirring.",
    beats: [
      "The party arrives in a village and meets a local who has already lost someone to the blight.",
      "A clue leads to a dangerous, half-sunken shrine out in the marsh.",
      "A confrontation reveals who, or what, is actually behind the blight.",
      "The party has to decide what to do with what they've found.",
    ],
    npcs: [{ name: "Maren Hollowell", role: "the herbalist who first raised the alarm" }],
    regionSketch: [
      { cx: 0, cy: 0, hint: "Fenwick village, half its boats hauled up and rotting" },
      { cx: 1, cy: 0, hint: "the marsh causeway; the half-sunken shrine is visible from here" },
      { cx: 0, cy: -1, hint: "the salt flats, white, cracked and far too quiet" },
      { cx: -1, cy: 0, hint: "the drowned orchard, its trees standing in brackish water" },
      { cx: 0, cy: 1, hint: "the tideline, and whatever this week's tide left on it" },
      { cx: 1, cy: -1, hint: "an old sea-wall, breached, with something nesting in the breach" },
    ],
  };
}

/**
 * A DM turn that builds cell (cx, cy): a 20 x 15 walled room with a gap in the
 * middle of each edge and one chest. quiet: true leaves out the goblin, so the
 * hero can walk about without a fight starting.
 */
export function assembleCellTurn({ cx = 0, cy = 0, quiet = true, narration } = {}) {
  const width = 20;
  const height = 15;
  const gaps = { N: { x: 10, y: 0 }, S: { x: 10, y: height - 1 }, E: { x: width - 1, y: 7 }, W: { x: 0, y: 7 } };
  const isGap = (x, y) => Object.values(gaps).some((g) => g.x === x && g.y === y);
  const tiles = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      const border = x === 0 || x === width - 1 || y === 0 || y === height - 1;
      return border && !isGap(x, y) ? "wall_stone" : "floor_grass";
    }),
  );
  const layout = {
    tiles,
    props: [
      {
        id: `prop-${cx}-${cy}`,
        assetId: "chest",
        x: 15,
        y: 3,
        label: "the water-swollen chest",
        dc: 12,
        onFound: "Under the ruined cloth: a bone whistle, still dry, and a fistful of old coin.",
      },
    ],
    tokens: quiet ? [] : [{ id: `monster-${cx}-${cy}`, assetId: "token_goblin", x: 5, y: 11, kind: "monster" }],
    exits: [
      { at: gaps.N, edge: "N", toCell: { cx, cy: cy - 1 } },
      { at: gaps.S, edge: "S", toCell: { cx, cy: cy + 1 } },
      { at: gaps.E, edge: "E", toCell: { cx: cx + 1, cy } },
      { at: gaps.W, edge: "W", toCell: { cx: cx - 1, cy } },
    ],
  };
  return {
    narration: narration ?? "The way opens onto a low hall of salt-scarred stone. Something in the far corner is worth a closer look.",
    actions: [{ type: "assembleCell", cx, cy, layout }],
  };
}

/** A plain talk turn: narration, no actions, no rolls. */
export function narrationTurn(text = "You say your piece. The quiet afterward has a weight to it.") {
  return { narration: text, actions: [], menuHint: ["Talk", "Move", "Search"] };
}

/**
 * The script the campaign flow needs: the arc call, then every DM turn builds
 * the cell the prompt says is missing. A fog crossing builds the neighbour in
 * the direction stepped (the same rule as the dev mock).
 */
export function campaignScript({ quiet = true } = {}) {
  const dirs = { N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1] };
  return [
    { match: /LIVINGTABLE_ARC_GENERATOR/, reply: () => JSON.stringify(arcOutline("fantasy")) },
    {
      match: /LIVINGTABLE_DM/,
      reply: (call) => {
        const sys = call.system;
        const last = call.messages[call.messages.length - 1]?.content ?? "";
        const cur = sys.match(/Current playspace: cell \((-?\d+),(-?\d+)\)/) ?? sys.match(/cell \((-?\d+),(-?\d+)\) has not been assembled/);
        const cx0 = cur ? Number(cur[1]) : 0;
        const cy0 = cur ? Number(cur[2]) : 0;
        const fog = last.match(/party moves (N|NE|E|SE|S|SW|W|NW) into the unexplored/);
        const opening = /has not been assembled yet/.test(sys);
        if (!fog && !opening) return JSON.stringify(narrationTurn());
        const d = fog ? dirs[fog[1]] : [0, 0];
        return JSON.stringify(assembleCellTurn({ cx: cx0 + d[0], cy: cy0 + d[1], quiet }));
      },
    },
  ];
}
