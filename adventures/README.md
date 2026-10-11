# Writing adventures for The Living Table

An adventure is one Markdown file in this folder. You write it in plain words; the game reads it, checks it, and runs from it. The AI dungeon master (the DM) does not make the story up: it follows yours. Your file is **gospel**: facts you write down are true, rules you write down are obeyed, and the story only moves along the paths you drew.

This guide explains every part of the format. If you would rather learn by copying, open [`TEMPLATE.md`](TEMPLATE.md): it is a complete, working two-room adventure.

## Quick start

1. Copy `TEMPLATE.md` to a new name, for example `adventures/the-rat-cellar.md`.
2. Change everything: title, summary, truths, places, people, scenes.
3. Check it: `npx -y tsx scripts/adventures/check.ts` (see [Checking a file](#checking-a-file)).
4. Fix what it reports, one line at a time, and check again. Every error names the line and says what it expected.

## What "gospel" means for the DM

The DM is handed your adventure as rules it cannot override:

- **Truths** are facts. The DM never contradicts them.
- **DM must** and **DM never** are orders. The DM follows them.
- **Secrets** (an NPC's `secret:` lines, a feature's `secret:`, a location's `dm notes:`) go to the DM marked "DM ONLY". It never reveals them unless the party finds them out in play.
- The DM gets the **current scene**, where the party is, the NPCs there with what they know and what they hide, and the hook for the hero's class.
- The DM still **improvises texture**: how a room smells, how Marta speaks, what a rat looks like, small details. It does not invent facts that your file settles.
- The DM **moves the story only along transitions you defined**. When it wants to advance something it proposes a progress step, and the engine checks that step against your file and refuses anything the file does not allow. Concretely:
  - Things the engine can see for itself (a kill, entering a place, talking to an NPC, holding an item, a beat firing) are tracked by the engine. The DM cannot declare them done.
  - A **judgment call** ("Marta has been persuaded") is a flag the DM may declare, and only a flag. The DM may declare a flag only when it is named in a condition of the current scene or the current location, no beat sets it, and it is not already set.
  - The DM may mark an objective done, or move to another scene, only when your file's condition for it is nothing but one such flag (for example `done when: the flag marta_persuaded is set`). A kill, a locked door or any other condition cannot be skipped.

So write facts and hard gates as ordinary conditions, and write a judgment call as a flag that no beat sets.

## The shape of a file

````markdown
# The Title

- version: 1
- author: owner

## Summary

A paragraph or two.

## Truths
- A fact the DM never contradicts.

## DM must
## DM never
## Hooks
## Starting kit

## Item: Brass key
## NPC: Hobb
## Location: Hobb's Shop
### Map
### Legend
### Feature: Counter drawer
### Spawn: goblin
### Exit: Door to the storeroom

## Scene: Hobb's trouble
### Objective: Talk to Hobb
### Beat: goblin_down
### Next
### Ending

## World
### Beat: lantern_finished
### Next
````

- `# Title` is the adventure's name. There is exactly one, and it comes first.
- `## Section` headings start the big parts. Order does not matter, except that locations and scenes are kept in the order you write them, and **the first scene is where the story starts**.
- `### Sub-section` headings belong to the `##` section above them.
- Headings go no deeper than `###`.

## The rules of the format

| You write | It means |
|---|---|
| `- key: value` | A fact, on one line. The leading `- ` is optional, but it makes the file look right when previewed. |
| A long value | Keep it on one line, or wrap it onto the next line indented by at least two spaces. |
| `> text` | Text read aloud to the player (a place, a scene opening, a beat, an ending). A blank `>` line starts a new paragraph. |
| `- text` under Truths, DM must, DM never | One entry per bullet. |
| a fenced block | A map. See [Maps](#maps-and-the-legend). |
| `<!-- anything -->` | A comment. The game never sees it. It may span lines. |
| `yes` / `no` | For true or false fields (`true` and `false` also work). |
| a name or an id | Wherever one thing points at another (a scene at a location, an exit at a room), write its name as you wrote it in its heading, or its id. Capitals and a leading "the" do not matter. |

Two more habits:

- **Names and ids.** Every item, NPC, location, scene, feature, exit and objective has a name (its heading) and an id. If you give no `- id:` line, the id is made from the name: lower case, a leading "the" dropped, anything that is not a letter or digit becomes `_` (so "Door to the storeroom" becomes `door_to_the_storeroom`). Give an `- id:` line when you want a shorter one. Spawns and beats have no name: their heading **is** their id (`### Spawn: goblin`, `### Beat: goblin_down`); a heading with spaces in it is turned into an id the same way a name is. Ids use only letters, digits, `-` and `_`.
- **Marking things for review.** A comment that begins with `ADDED` or `REVIEW` is listed by the checker every time you run it, so you can see what is still a guess: `<!-- ADDED: the tunnel's length is my idea -->`.

## Section by section

### Header (under the title)

| Field | Required | Meaning |
|---|---|---|
| `id` | no | The adventure's id. Default: made from the title. |
| `version` | yes | A whole number. Raise it when a saved game should treat the adventure as changed. (Missing, it is 1 and the checker warns.) |
| `author` | yes | `owner`, or `ai` for an adventure the optional AI writer produced. (Missing, it is `owner` and the checker warns.) |
| `levels` | no | `1 to 3`, `1-3` or `2`. |
| `tone` | no | A sentence about the mood. The DM is told it. |
| `start scene`, `start location`, `start at` | no | Normally leave these out. The start is the first scene, in that scene's location, on the one map square whose legend entry says `start`. Override only to start somewhere else. `start at` is a column and a row counted from 1, like `6, 12`. |

### Summary

Plain sentences. What the adventure is, in a paragraph or two. Required.

### Truths, DM must, DM never

One bullet each. Keep each to one idea. Truths pin facts down ("There is exactly one goblin, and it is alone."). DM must and DM never are instructions to the DM ("Never let the goblin speak."). Write them as you would brief a person running the table.

### Hooks

How the story addresses each class: `- default:`, `- fighter:`, `- rogue:`, `- wizard:`, `- cleric:`. A hero gets the line for their class, or `default` if their class has none. The launch heroes map as Knight is `fighter`, Rogue is `rogue`, Wizard is `wizard`, Healer is `cleric` (`knight`, `shadow`, `mage`, `fireball person` and `healer` also work as keys).

### Starting kit

One `### class` block per class (`fighter`, `rogue`, `wizard`, `cleric`, or `default`).

| Field | Required | Meaning |
|---|---|---|
| `armor` | yes | `none`: the hero wears nothing (unarmored AC is SRD 5.1: 10 plus the DEX modifier). `class`: the class's normal armor. |
| `potions` | no | A plain number of healing potions. Default 0. |
| `weapon` | no | Words only, such as `a plain dagger`. The weapon's real numbers come from the class, never from this line. |
| `item` | no | An extra carried item, by id or plain name. Repeat the line for several. |

Give every class you expect a block, or a `default`. The checker warns if a launch class would get nothing.

### Item: Name

| Field | Required | Meaning |
|---|---|---|
| `description` | yes | What it is. |
| `quest` | no | `yes` for a story item the adventure turns on. The checker warns if nothing ever hands a quest item over. |
| `usable`, `use says` | no | `usable: yes` with `use says:` for what is said when it is used. |

Items you hand out (`gives:`, `item:`) may also be plain names that are not listed here (a handful of coins): those are ordinary loot, and the story does not track them.

### NPC: Name

| Field | Required | Meaning |
|---|---|---|
| `role` | yes | Who they are, in a word or two. |
| `personality` | yes | How they act. |
| `token` | yes | The picture that stands for them on the map (see the id lists below). |
| `wants` | no | What they are after. |
| `knows` | no | What they will tell the party when asked. One line per fact; repeat the line. |
| `secret` | no | What they will not volunteer. DM only. Repeat the line. |
| `voice` | no | How they sound. |
| `location` | no | A location they are normally found in. An NPC must be placed either here or by a spawn that names them (`npc:`), or the checker warns. |

### Location: Name

Directly under the heading:

- the **read-aloud text**: a `>` quote, read to the party when they first arrive (required);
- `id`, and `dm notes` (DM only), both optional.

Then these sub-sections:

- `### Map`: the 15-line grid. Required.
- `### Legend`: what each map character means. Required.
- `### Feature: Name`: something worth looking at or searching.
- `### Spawn: id`: a creature or a person standing in the room.
- `### Exit: Label`: a way to another location.

**Feature** fields: `description` (required, safe to show the player), `secret` (what a successful search finds; DM only until found), `search dc` (1 to 30, the SRD scale: easy is 10, medium 15, hard 20), `gives` (an item handed over when the secret is found), `once`. Put the feature's square on the map with a `prop` so there is something to search. A search hands over one item per feature, so list one `gives`.

**Spawn** fields: `creature` (required; a bestiary id like `giant-rat`, or a `token_*` picture id; see the lists below), `hostile` and `awake` (both required: `awake: no` means asleep or unaware), `count` (default 1; the first creature stands on the marked square and the rest spread to free neighbours; you may also mark several squares), `npc` (links the creature to an NPC entry), `appears when` (a condition; the creature is only there while it holds).

**Exit** fields: `to` (required, a location), `arrive at` (required: an exit in that location, by label or id, or `start` for its start square), `open when` (a condition; until it holds the way is shut), `locked text` (what the party finds while it is shut; give one whenever you give `open when`). An exit on the outer edge of the map is a doorway to the next room; one inside the room (a stair, a hatch) is a spot the party uses. A shut edge exit is not opened at all until its condition holds.

### Scene: Title

A scene is a chapter. Directly under the heading: `id` and `location` (where it is set), and the **opening** as a `>` quote, read when the scene begins.

- `### Objective: Text`: a goal. `done when` (required, a condition), `hidden: yes` for one the DM knows but the player is not shown. The engine ticks an objective when its condition holds.
- `### Beat: id`: something that happens by itself. `when` (required, a condition); a `>` quote of narration; `sets flag` (repeat for several), `gives` (items), `spawns` (spawn ids that now appear), `once`. A beat fires once by default; `once: no` fires every time the story moves while its condition holds. **A spawn named by any beat is absent until that beat fires.**
- `### Next`: the only ways out of the scene, one bullet each, `- Scene title when <condition>`. The first one whose condition holds is taken.
- `### Ending`: `outcome` is `victory`, `defeat` or `continue`, plus a `>` quote of the ending text. A scene with an ending that is `victory` or `defeat` finishes the adventure. A scene with no ending and no `Next` is a dead end, and the checker warns.

### World

What happens whatever scene the story is in: the villain's plan going ahead while the party is busy, a rumour that reaches the village, the night the dead walk. Optional, and at most one.

- `### Beat: id`: exactly like a scene's beat, but checked in every scene. Beat ids are shared with the scenes', so each is unique across the file.
- `### Next`: ways out that can be taken from any scene, checked before the scene's own. Use one to end the story when a clock runs out, wherever the party is: `- Too late when the flag king_woken is set`.

A world beat is how an adventure keeps time. Give it a day (`- when: it is day 5 or later`) and it happens on that day unless something the party did first stops it (`- when: it is day 5 or later and the flag silver_cut_off is not set`). The DM is told the day and what is coming, marked DM ONLY, so it can let the party feel it approach; the engine makes it happen, and the DM never can. Once an adventure looks at the day anywhere, the player's Journal shows it.

## Conditions

Wherever a condition is wanted (`done when`, `when`, `open when`, `appears when`, and after `when` in a `### Next` bullet) write it in plain words, using exactly these phrasings. Case does not matter, a leading `when` is allowed, and a trailing full stop is ignored.

| Write | True when |
|---|---|
| `always` | always |
| `never` | never (rarely useful) |
| `the flag rats_cleared is set` | the story has declared that flag |
| `the flag rats_cleared is not set` | it has not |
| `the spawn goblin is killed` | the spawn is dead (for a group, every creature in it is dead) |
| `the creature rat_2 is killed` | that one creature is dead (a group `rat` of 3 is `rat_1`, `rat_2`, `rat_3`) |
| `every spawn starting with rat is killed` | every creature of every spawn whose id starts with `rat` is dead |
| `the player enters the tunnel` | the party has been to that location |
| `the player talks to Marta` | the party has spoken with that NPC |
| `the player has the brass key` | the party holds that item now |
| `the objective talk is done` | that objective is done (by id or by its text) |
| `it is day 3 or later` | the adventure has reached that day. It starts on day 1 and a day passes each time the hero sleeps (a long rest). `not it is day 3 or later` means before day 3 |

`dead` works in place of `killed`, `has entered` for `enters`, `has talked to` and `speaks to` for `talks to`, `the party` for `the player`, `complete` for `done`.

Join conditions with **and**, **or**, **not**, and parentheses:

```
the player has the brass key and the flag door_oiled is set
(the flag marta_persuaded is set or the player has the brass key) and the player enters the tunnel
not the player has the brass key
```

Mixing `and` with `or` needs parentheses so it is clear which goes first. Without them the checker refuses the line. A name may contain the word "and" (an item called "Salt and Pepper" works); the longest matching name wins.

Names in a condition (a location, NPC, item or objective) must be ones this file defines. A misspelling is an error that lists what you do have.

## Maps and the legend

A map is a fenced block (three backticks) of **exactly 15 lines of exactly 20 characters**. Each character is one square of the room. Nothing but the map goes under `### Map`.

````markdown
### Map

```
####################
#..................#
...
#########D##########
```

### Legend

- `#` = wall_stone
- `.` = floor_stone
- `@` = floor_stone, start
- `t` = floor_stone, prop torch
- `H` = floor_stone, spawn hobb
- `c` = floor_stone, prop chest, feature counter_drawer
- `D` = floor_stone, prop door_open, exit storeroom_door
````

Rules:

- Use visible keyboard characters only. **No spaces** (use `.` for empty floor), no tabs, no backtick. A row too short, too long, or with a space is reported on its own line with the count.
- Every character you use must be in the legend. The checker tells you the row and column of one that is not.
- A legend line is `` - `X` = tile`` then, after commas, any of `prop NAME`, `feature NAME`, `spawn NAME`, `exit NAME`, `start`. The **tile** comes first and is required: it is the floor painted on that square.
- A `feature`, `spawn` or `exit` refers to one defined in the same location, by id (or by name).
- `start` marks the square the hero starts on (or arrives on when an exit says `arrive at: start`). The start location needs exactly one. Other locations need one only if an exit arrives at `start`.
- The edge of a room is normally `wall_stone`. An exit on the outer edge of the map (row 1, row 15, column 1 or column 20) becomes a doorway; put its tile where the wall would be and give it a walkable prop such as `door_open`.
- Exits, spawns, features and the start square must be on **walkable** tiles, and not under a prop that blocks. The checker tells you when one is not, and warns about anything the party cannot walk to.
- A creature's square must not be the start square.

## Checking a file

```
npx -y tsx scripts/adventures/check.ts                    every adventures/*.md (README.md is skipped)
npx -y tsx scripts/adventures/check.ts adventures/x.md    one file
npx -y tsx scripts/adventures/check.ts --ids              print the id lists below
npx -y tsx scripts/adventures/check.ts --write-ids        refresh the id lists in this README
```

For each file the checker first **reads** it (errors say `line N:` and what was expected), then, if it read cleanly, **validates** the adventure against the game's real picture ids and creatures (errors and warnings point at the thing by path, such as `locations.cellar.spawns.rat`). It also lists every `ADDED` or `REVIEW` comment so you can see what is still a guess.

- An **error** stops the adventure from running. The command exits with an error code.
- A **warning** does not stop it, but read it: it usually means a typo (a flag set but never checked), a dead end, or something unreachable.

A good adventure has no errors and no warnings. `TEMPLATE.md` has none.

## Writing out an adventure

The same format is the one the game writes. An adventure the optional AI author produces is expected in this format with `author: ai`, and it goes through exactly the same reading and checking as yours (the AI writer is off by default, and it costs real money to run, so the game warns before it starts). The code that reads a file is `src/games/livingtable/adventures/markdown.ts`: `parseAdventureMarkdown(text)` and its inverse `adventureToMarkdown(adventure)`. A file the parser can read, written back and read again, gives the same adventure. Text is stored on single lines, so a line break inside a field becomes a space when a file is written.

## The ids you can use

Everything in this section is generated. Do not edit it by hand: run `npx -y tsx scripts/adventures/check.ts --write-ids` to refresh it whenever pictures or creatures are added.

<!-- BEGIN GENERATED IDS (npx -y tsx scripts/adventures/check.ts --write-ids) -->

Generated from `scripts/assets/fantasy.ts` (259 tiles, 59 props, 62 tokens) and the bestiary (40 creatures).

### Floor tiles

Walkable (a hero, an exit or a creature can stand here): `floor_grass`, `floor_grass_b`, `floor_grass_c`, `floor_grass_d`, `floor_grass_pale`, `floor_grass_pale_b`, `floor_grass_pale_c`, `floor_grass_pale_d`, `floor_dirt`, `floor_dirt_b`, `floor_dirt_c`, `floor_dirt_d`, `floor_sand`, `floor_sand_b`, `floor_sand_c`, `floor_sand_d`, `floor_stone`, `floor_stone_b`, `floor_stone_c`, `floor_stone_d`, `cliff_top`, `cliff_top_b`, `cliff_top_c`, `cliff_top_d`, `floor_grass_tufted`, `floor_grass_flowers`, `floor_stone_cracked`, `floor_stone_drain`, `floor_wood`, `floor_wood_b`

Not walkable (walls, water, canopy, cliff faces; use them for the edges of rooms): `water`, `water_b`, `water_c`, `water_d`, `forest_canopy`, `forest_canopy_b`, `forest_canopy_c`, `forest_canopy_d`, `cliff_face`, `cliff_face_b`, `cliff_face_c`, `cliff_face_d`, `wall_stone`, `wall_stone_b`, `wall_stone_c`, `wall_stone_top`, `wall_stone_base`, `wall_earth`, `wall_earth_b`

The game also has 210 edge and join tiles (`wall_stone_join_*` x20, `floor_grass_edge_*` x57, `floor_stone_edge_*` x38, `water_edge_*` x57, `cliff_edge_*` x19, `floor_grass_pale_edge_*` x19). The renderer picks those to soften borders between materials, so an author normally never types one. They are valid tile ids if you want one.

### Props

Walkable (decoration you can stand on): `door_open`, `door_open_ns`, `torch`, `torch_left`, `torch_right`, `cottage_door`, `arch_passage`, `stair_up_w`, `stair_up_e`, `stool`, `chair`, `rug`, `stairs_down`, `ladder_up`, `rat_hole`, `tunnel_mouth`, `sack`, `cobweb`

Blocking (take up their square): `door_closed`, `wall_stone_jambs_ns`, `door_closed_ns`, `tree`, `tree_left`, `tree_right`, `chest`, `chest_open`, `cottage_nw`, `cottage_n`, `cottage_ne`, `cottage_w`, `cottage_e`, `cottage_sw`, `cottage_s`, `cottage_se`, `arch_jamb_w`, `arch_jamb_e`, `pillar_top`, `pillar_base`, `table_w`, `table_e`, `bed_head`, `bed_foot`, `fence_w`, `fence_mid`, `fence_e`, `well_nw`, `well_ne`, `well_sw`, `well_se`, `barrel`, `crate`, `crate_stack`, `bar_counter_w`, `bar_counter_mid`, `bar_counter_e`, `workbench`, `anvil`, `hearth`, `shelf`

### Tokens (the picture for an NPC, or for a creature that has no bestiary entry)

`token_knight`, `token_shadow`, `token_healer`, `token_fireball_person`, `token_goblin`, `token_skeleton`, `token_villager`, `token_robed_figure`, `token_guard`, `token_rat`, `token_giant_rat`

Also present, but never for a character: 51 `gear_*` pictures that are worn equipment. The checker rejects them as a token or creature.

### Creatures (what `creature:` in a spawn accepts)

A bestiary id, or a `token_*` id. Names with spaces and capitals (such as `Giant Rat`) are turned into the id (`giant-rat`) for you. A creature whose picture is not drawn yet fails the check, with a message saying which token it looks for.

**Ready to use now (4): `rat`, `giant-rat`, `goblin`, `skeleton`.**

| id | name | CR | picture | drawn |
|---|---|---|---|---|
| `rat` | Rat | 0 | `token_rat` | yes |
| `bandit` | Bandit | 1/8 | `token_bandit` | not yet |
| `cultist` | Cultist | 1/8 | `token_cultist` | not yet |
| `giant-rat` | Giant Rat | 1/8 | `token_giant_rat` | yes |
| `kobold` | Kobold | 1/8 | `token_kobold` | not yet |
| `stirge` | Stirge | 1/8 | `token_stirge` | not yet |
| `giant-bat` | Giant Bat | 1/4 | `token_giant_bat` | not yet |
| `goblin` | Goblin | 1/4 | `token_goblin` | yes |
| `skeleton` | Skeleton | 1/4 | `token_skeleton` | yes |
| `wolf` | Wolf | 1/4 | `token_wolf` | not yet |
| `zombie` | Zombie | 1/4 | `token_zombie` | not yet |
| `black-bear` | Black Bear | 1/2 | `token_black_bear` | not yet |
| `gnoll` | Gnoll | 1/2 | `token_gnoll` | not yet |
| `hobgoblin` | Hobgoblin | 1/2 | `token_hobgoblin` | not yet |
| `lizardfolk` | Lizardfolk | 1/2 | `token_lizardfolk` | not yet |
| `orc` | Orc | 1/2 | `token_orc` | not yet |
| `rust-monster` | Rust Monster | 1/2 | `token_rust_monster` | not yet |
| `brown-bear` | Brown Bear | 1 | `token_brown_bear` | not yet |
| `bugbear` | Bugbear | 1 | `token_bugbear` | not yet |
| `dire-wolf` | Dire Wolf | 1 | `token_dire_wolf` | not yet |
| `ghoul` | Ghoul | 1 | `token_ghoul` | not yet |
| `giant-spider` | Giant Spider | 1 | `token_giant_spider` | not yet |
| `harpy` | Harpy | 1 | `token_harpy` | not yet |
| `specter` | Specter | 1 | `token_specter` | not yet |
| `ettercap` | Ettercap | 2 | `token_ettercap` | not yet |
| `gargoyle` | Gargoyle | 2 | `token_gargoyle` | not yet |
| `gelatinous-cube` | Gelatinous Cube | 2 | `token_gelatinous_cube` | not yet |
| `mimic` | Mimic | 2 | `token_mimic` | not yet |
| `ogre` | Ogre | 2 | `token_ogre` | not yet |
| `basilisk` | Basilisk | 3 | `token_basilisk` | not yet |
| `manticore` | Manticore | 3 | `token_manticore` | not yet |
| `minotaur` | Minotaur | 3 | `token_minotaur` | not yet |
| `owlbear` | Owlbear | 3 | `token_owlbear` | not yet |
| `werewolf` | Werewolf | 3 | `token_werewolf` | not yet |
| `wight` | Wight | 3 | `token_wight` | not yet |
| `red-dragon-wyrmling` | Red Dragon Wyrmling | 4 | `token_red_dragon_wyrmling` | not yet |
| `hill-giant` | Hill Giant | 5 | `token_hill_giant` | not yet |
| `troll` | Troll | 5 | `token_troll` | not yet |
| `wraith` | Wraith | 5 | `token_wraith` | not yet |
| `young-green-dragon` | Young Green Dragon | 8 | `token_young_green_dragon` | not yet |

<!-- END GENERATED IDS -->
