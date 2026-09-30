# The Living Table: design notes

Moved from Conjure Games' DESIGN.md (the "The Living Table (fifth game)" section) when the game got its own repo on 2026-09-30. Headings are one level up; the text is unchanged. Where it says "the fifth game" or refers to the hub's other games, read it as history.

**Current scope (2026-09-30).** The art is moving to Kay Lousberg's free KayKit packs, so only what they can draw is playable: the Fantasy template with the Knight, the Shadow and the wizard. Sci-fi is paused and the Healer is out of play; both remain in the code and in the notes below. `PLAYABLE_TEMPLATES` and `PLAYABLE_ARCHETYPE_IDS` in `characters/templates.ts` are the switch.


**The pitch.** A real AI dungeon master, d20s, ability scores, saves,
initiative, spell slots, the actual rules, on a top-down sprite grid, playable
by someone who has never touched D&D. Two genre templates at launch, Fantasy
and Sci-fi, one engine underneath both. This section supersedes the "Proposed"
draft that predated it (kept in git history): that draft's asset-streaming and
gauntlet-loop thinking survives below; its campaign-arc-only framing and
four-template pitch don't. The brief that actually authorized this build asked
for real tactical rules, not narrative hand-waving, and two templates, not
four. Earlier pitch + competitive gauntlet for context:
https://claude.ai/code/artifact/77d47818-2167-45b7-aea3-f83eca98f9e6

## Thesis-table row

| Game | Why it needs AI | What it costs |
|---|---|---|
| **The Living Table** | The dungeon master's narration, the scenes it builds, and what it remembers about your campaign are all model reasoning; nothing here is a fixed content tree. The dice aren't: hit-or-miss, damage, and saves are the rules engine, never the model. | 1 credit to plan a campaign; 1 credit per new scene the DM builds; 1 credit per message you send it. Combat, movement, and leveling never cost anything. |

Passes the repo's own filter (would someone rather have this than a free
download?) on both counts that matter here: a DM that remembers your specific
campaign and reasons about a specific scene is not a content tree, and a d20
roll against a real AC is a real opponent, not a script. It's also the first
game in this repo big enough to need campaign state that persists and gets
referenced across many turns, rather than one call (or one call per message)
against content that lives entirely in the response, which is why it needs new
`game_*` tables (below) instead of fitting in the existing `game_state` blob.

## The rule that shapes everything else: the AI never runs code at play time

It's a dungeon master, not a programmer. Every effect it has on the world goes
through a small, fixed action vocabulary, validated and applied by the engine,
never eval'd, never interpreted as a program. Concretely, and this matters
because **this app's `ai.complete` bridge has no tool-calling** (`CompleteRequest`
in `bridge/ai.ts` is `system` + `messages` in, text out, nothing else): a DM
turn is the model replying with ONE JSON object matching a fixed schema, run
through `completeJson` exactly like every other generator in this repo. The
object can contain narration text and a short list of **world-actions**,
`assembleCell`, `placeToken`, `moveToken`, `removeToken`, `setDoorState`, and
so on, which the client-side engine validates against the actual board state
(asset exists in the manifest, target tile is walkable, cell is in range) and
applies one at a time, rejecting and dropping any action that fails validation
rather than trusting it blind. This is strictly stronger than tool-calling for
the "never runs code" guarantee: there's no loop where the model's own output
becomes the next prompt's instructions, no way to draft a "clever" action
outside the vocabulary, and the whole turn is one auditable object instead of
an open-ended sequence.

## The coordinate system

Two levels, and the distinction is load-bearing:

- **A cell** is one screen's worth of world: a fixed **20x15 tile grid**
  (matches a classic 4th-gen 320x240 frame at 16px tiles), origin top-left,
  addressed `(x, y)` zero-indexed within the cell.
- **The world** is a grid of cells, addressed `(cx, cy)`. The party occupies
  exactly one cell at a time, **the playspace**. Its eight neighbours
  (`cx +/-1, cy +/-1`) are **offscreen**: they exist as stubs (a biome hint
  inherited from the campaign plan, plus which of their edges must connect to
  an already-built neighbour) until the DM assembles them.

A cell starts **unassembled**, a stub, and becomes **assembled** via one
`assembleCell` action carrying its full layout in one shot: a 20x15 grid of
tile-asset ids, a list of placed props/NPCs with `(x, y)` and facing, and a
list of exits. One call, not a sequence of placements, because that's how a
DM actually thinks about building a room: bulk layout up front, then
fine-grained `placeToken` / `moveToken` / `removeToken` / `setDoorState` for
what changes as the scene is played (a door opens, a goblin advances, an item
drops). Re-entering an already-assembled cell costs nothing and calls no
action at all; the layout is just read back.

**Exits stitch the world together automatically.** An exit is
`{ at: {x,y}, edge: 'N'|'S'|'E'|'W', toCell: {cx,cy} }` on a boundary tile
matching its edge. Assembling a cell with an east exit stakes a "must connect
here" constraint on its east neighbour's west edge; when that neighbour gets
assembled, its own west exit is validated against the stake, and if the DM's
layout doesn't declare one, the engine inserts a matching opening at the
mirrored position rather than leaving a dead end. This is what makes "no
floating props, no tokens in walls, exits that go somewhere" a property the
*engine* guarantees rather than something hoped for from a good prompt:
validation lives in `world/connectivity.ts`, tested directly, not inferred
from vibes.

## The perception API, what "see the playspace" returns

**Both a dense grid and an object list**, not a choice between them, because
they answer different questions a DM actually asks. A single zoom level: the
playspace is 300 tiles, comfortably within what the model needs to reason
about at once, so there's no case for a second zoom level adding complexity
with no payoff.

```
getPlayspace() -> {
  cell: {cx, cy},
  tiles: TileId[20][15],       // dense grid: what's the terrain, is it walkable
  walkable: boolean[20][15],   // derived from the tile manifest, not hand-authored
  props: PlacedProp[],         // sparse, has identity: {id, assetId, x, y, facing}
  tokens: PlacedToken[],       // {id, assetId, x, y, kind: 'pc'|'npc'|'monster', ...}
  exits: Exit[],
}
getOffscreenCells() -> {        // the 3x3's other eight
  [dir in N|NE|E|SE|S|SW|W|NW]: { status: 'unassembled', hint: string }
                               | { status: 'assembled', summary: string }
}
getVisible(tokenId) -> { x, y }[]   // line of sight from one token, for stealth/ranged checks
```

Dense grid for terrain because floor/wall/water is naturally grid-shaped and
cheap at this size; object list for props/tokens/exits because they're sparse
and have identity that persists across turns (the same goblin token moves,
it isn't a new one each turn).

## The manipulation API

`assembleCell` (bulk, offscreen to playspace or building ahead) and
`placeToken` / `moveToken` / `removeToken` / `placeProp` / `setDoorState`
(fine-grained, live-scene mutation), all validated the same way: target must
be in-bounds, target tile must be walkable for a token, the asset id must
exist in the loaded manifest. A rejected action is dropped and reported back
to the DM in its next turn's context ("that tile is a wall, the goblin can't
stand there") rather than silently applied wrong or silently ignored; the
model gets to react to its own mistake in character, which reads as a DM
correcting itself rather than the game breaking.

## The DM turn protocol

Each DM turn is one `completeJson` call whose validated shape is:

```
{ narration: string,
  actions: WorldAction[],       // validated + applied in order, see above
  rollRequests?: RollRequest[], // "the goblin attacks, roll to hit" etc; engine resolves these, not the model
  menuHint?: string[] }         // which command-menu actions make sense right now, for the UI
```

The model **never reports a roll result**; it can only request that the
engine make one (`rollRequests`), and the engine's resolved result comes back
in the *next* turn's context as fact. This is the mechanism behind "the model
never overrides a die roll": there is no field in the schema where a roll
outcome could originate from the model in the first place.

## Working memory: tiers, not `slice(-10)`

Its own subsystem (`memory/workingMemory.ts`), its own tests, because a
summarizer that keeps the wrong things is worse than no summarizer: it
produces a DM that confidently misremembers instead of one that visibly
doesn't know. Three tiers:

1. **Verbatim recent**, full narration + player actions for the last few
   scenes, unmodified. This is what the DM's prompt gets by default.
2. **Condensed**, once verbatim exceeds a scene threshold, the oldest scene
   is compressed to a few sentences by a dedicated summarization pass and
   moved here. Lossy on purpose (colour, minor dialogue), but never the
   source for what must survive, which is tier 3.
3. **Permanent campaign facts**, a small, deduplicated, **structured** list,
   not prose: `{ category: 'npc'|'promise'|'item'|'event'|'thread', key, fact,
   status }`. Extracted by a dedicated pass at condensation time (not
   "whatever the summarizer happened to keep"), append-only, update-in-place
   by `key` (an NPC's disposition can change; the record of having met them
   can't disappear), and **never itself compressed away**. This tier is what
   keeps a scene-2 murder mattering in scene 12: it's a fact record, not a
   sentence that can get paraphrased into nothing.

The DM's prompt is built from tier 3 in full, tier 2 as a compact digest, and
tier 1 verbatim; condensation runs as a byproduct of an already-paid scene
transition (see cost model), never as its own charge.

## The rules engine: real D&D, SRD 5.1

Ability scores plus modifiers, proficiency bonus by level, AC, d20 attack
rolls (with advantage/disadvantage) against it, damage dice, saving throws,
skill checks with proficiency, HP plus hit dice, the SRD condition list,
initiative (d20+DEX, sorted), action economy (action / bonus action /
movement / reaction), and spell slots. This is `rules/`, tested like
software: the engine decides hit-or-miss, damage, legality, and save success;
the AI decides tactics, targeting, and NPC behaviour; it never adjudicates a
mechanical outcome by vibes and never overrides what the engine already
rolled (enforced structurally, see the turn protocol above).

Built on the **SRD 5.1** (CC-BY-4.0). Attribution ships in-app (an "About the
rules" panel, credited per the license) and in the repo. Launch scope covers
what the four launch archetypes per template actually use at levels 1 to 3,
not the full compendium. That's a deliberate, stated cut, not a hidden gap;
see "what's deliberately not here yet" below.

## Characters: templates first, real numbers underneath

Four archetypes per template, same mechanical chassis reskinned, proof that
"same engine, same tactical rules" actually holds:

| Fantasy | Sci-fi | Chassis |
|---|---|---|
| The Knight | The Trooper | Fighter |
| The Shadow | The Infiltrator | Rogue |
| The Healer | The Medic | Cleric |
| The Fireball Person | The Psion | Wizard |

Pick a template, then name it, pick an appearance from the tile set, pick one
or two flavour choices, then play, under two minutes, no point-buy, no
multiclass table. Levelling presents real consequences in plain language
("+2 to hit with a bow", not "+1 proficiency bonus, Archery fighting style")
but the underlying numbers are the real SRD numbers; a player who knows 5e
can open the character sheet and find them, because the simplification is
entirely in presentation.

## Gear, the pack and loot

The contract is `src/games/livingtable/characters/equipmentTypes.ts`
(section 11 for this part); this is the why.

**Six slots.** Weapon, outer and crown are drawn per archetype, one set per
character. Ring, amulet and boots are SRD 5.1 magic-item slots shared per
template. Boots draw on the body (layer 25: over the body's own feet, under a
robe hem or plate at 30) and are drawn per archetype, because the eight bodies
put their feet in four different places and two have none showing. Ring and
amulet never draw: at 16x24 a ring is one pixel. The sheet stores
`{slot, tier}` per role and never a number, same as the first three.

**SRD names only.** Ring of Evasion, Ring of Protection, Ring of Regeneration,
Periapt of Wound Closure, Stone of Good Luck, Boots of Elvenkind, Boots of
Speed, plus plain boots so everyone starts shod; the sci-fi template reskins
the names over identical mechanics. Each carries one effect, from its own SRD
text, landing in a number the engine already computes (AC, a save, a check,
speed, a rest). Two rungs are empty on purpose: SRD 5.1 has no footwear above
rare and no neck item above rare this engine can apply, and an invented item
breaks the SRD-only rule while a decorative one breaks the copy rule.

**Attunement is the real cap of three.** Wearing an item that needs it is
attuning to it; a fourth is refused at the screen with the SRD's own remedy
(take one off). The SRD's short rest of focus becomes the rule that gear
changes only when a rest could be taken: nothing hostile in the room, and on
your feet. Plus-N weapons and armour need none; the legendary weapon (its
Flame Tongue rider) and the saving-throw headgear (Cloak of Protection shape)
do.

**The pack cannot fill.** Loot never grants an item you already own, so a
character can own at most 16 distinct magic items, and the pack holds 18 (six
columns by three, one row more than the reference's twelve for exactly this
reason). No overflow flow, no forced drop, no lost find. Common pieces are
never pack items: taking off a magic piece puts your own common one back.
Potions stay the Item verb's list, and the old flavour inventory stays what
the DM narrates over.

**Loot is a die, not a gift.** A won fight (your blow drops the last hostile)
and a successful search of a chest or crate roll d100 on one fixed table (40%
nothing, 35% uncommon, 20% rare, 5% legendary), then a die across the pieces
at that rank you do not yet own. Both dice are shown like any other roll. At
most two rolls per area, which is what keeps a paid DM turn that restocks a
room from being a loot tap. The DM is told what turned up, in one fact line,
so it can narrate the find; it has no field that can grant, choose, name or
price gear, and a prop whose `grantsItem` names a magic item is rejected. A
kill the DM resolves on its own turn earns no loot, exactly as it earns no
milestone.

**The screen** is the owner's reference in this game's pixel vocabulary: a
framed panel, the real composited sprite at an integer scale on a pixel
pedestal, three slots down each side, the pack beneath, Cancel and Ok so a
change is staged before it commits. Rarity is a word, a pip count and a rim
light before it is a colour. It completes issue #15: the rarity chip and
glossary entry come back, and the old tier picker is replaced by this screen
rather than restored beside it.

**Free forever.** Equipping, attuning, looking and looting cost nothing and
call no model.

Deliberately not here: dropping or trading gear, a second ring, a legendary
amulet or boots, loot from a kill the DM resolves, and the SRD's
attuned-but-carried state (here, only worn items are attuned).

## Command menu: what needs the model, what doesn't

Move / Attack / Talk / Search / Item, plus free text as the escape hatch.

- **Move**: pure engine (pathfind within the known playspace). Only crosses
  into the DM when it targets an unassembled cell (`assembleCell`, 1 credit).
- **Attack**: the roll is pure engine, always, free. What the *target* does
  in response (flee, retaliate, call for help) is the DM's call on its next turn.
- **Search**: pure engine, a Perception/Investigation check against a DC set
  when the cell was assembled, revealing pre-authored flavour text on the
  prop it was checked against. No AI call; search spam must not be a way to
  farm credits out of the player, and it doesn't need one to feel fair.
- **Item**: pure engine (apply a known item's effect).
- **Talk** / **free text**: always the DM, always 1 credit; this is the
  thing free text exists to pay for.

## Cost model

Extends the repo's existing rule (credits buy "more" and "mine", never
"finish what you started"):

- **Plan a campaign**, 1 credit, once per campaign. Not free like the daily:
  a campaign is personal, not a shared-globally puzzle, so there's no "first
  player of the day" to amortise it across.
- **A new scene the DM builds** (`assembleCell` on a stub), 1 credit.
  Re-entering an already-built cell is free, forever.
- **A message you send the DM** (Talk / free text), 1 credit, same shape as
  the Vault: you're paying for the thing you're there to do.
- **Combat, movement, search, items, levelling**: free, always. The tactical
  layer is what makes this not read as a toll booth wearing a dice icon.
- **Never charge for losing.** A character going down doesn't cost anything
  and doesn't end the campaign; SRD death saves apply.

## Assets: a code-defined library, not painted files

Every asset the DM can place already exists before play starts; it never
generates art mid-session. Given "16x16/32x32, tight indexed palette, chunky
readable sprites" as the actual target, and no image-generation tool
available in this build, the honest and *better* way to hit that target is
the way a lot of real NES-era work was made: **tiles and tokens are
pixel-index bitmaps defined in code** (`scripts/assets/fantasy.ts` and
`scifi.ts`, a shared palette per template plus a `number[16][16]` per
sprite, rendered via `scripts/assets/png.mjs` for the gauntlet's own visual
review), not PNGs painted by a generator and then graded for how close they
got. This is what the visual critic track actually judges: legibility,
palette discipline, and silhouette distinctness against real reference
games, not "did an image model approximate pixel art."

This still satisfies the project constraint that the library must not ship
in the bundle, and lives OUTSIDE `src/` entirely on the client side
(`scripts/`, not bundled) for exactly that reason. Where it actually lives
at runtime: not a table. Developer-authored, iteration-tuned content that no
player ever writes belongs in the games-db Edge Function's own code, same
call as the Vault's level definitions in that same file (retuning a sprite
is a redeploy, not a migration) -- see `LIVING_TABLE_TEMPLATES` in
`games-db/index.ts`, generated from the two files above via
`scripts/assets/build-seed-code.mjs` and pasted in by hand when they change.
The client fetches a template's manifest once via `ltAssetManifest` and
caches it (IndexedDB, LRU-evictable). At launch scale, a few dozen tiles and
tokens at roughly 100 to 300 bytes each, that's tens of KB, not the "stream
per finished scene" pipeline the earlier draft sketched for a large,
Storage-hosted PNG library. That per-scene streaming path is the right one
if the library grows into the hundreds of painted assets; worth revisiting
then, not before, noted here so the simplification reads as deliberate.

## Backend (ConjureOS repo, migration `116_living_table.sql`)

Additive, same `game_*` namespace, RLS-on-zero-policy like every other table
in 115 (service-role `games-db` only): `game_campaigns` (one per
player-campaign, template, title, private arc outline), `game_characters`
(stats, inventory, spell slots, conditions, the real sheet), `game_cells`
(assembled layouts, keyed by campaign plus `cx,cy`), `game_memory_facts`
(tier 3, structured), `game_memory_log` (tiers 1 to 2). The asset manifest is
deliberately NOT a table here; see "Assets" above for where it actually lives
and why.

## What's deliberately not here (yet)

- **The full SRD spell compendium.** Launch covers what the four archetypes
  use at levels 1 to 3; more spells are additive content, not an architecture
  change.
- **More than a handful of monster statblocks.** Same shape of gap.
- **A painted (non-code-defined) art pipeline.** Revisit if/when the library
  outgrows what pixel-index bitmaps can comfortably cover.
- **Multiplayer parties.** V1 is one player plus DM-controlled companions and
  NPCs, matching how the other three games are single-player-vs-AI.
- **Fae and Noir templates.** The earlier draft's four-template pitch is cut
  to the two the brief actually asked for; the engine is built genre-agnostic
  enough that a third template is new content, not new architecture.

