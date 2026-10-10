# Writing a campaign for The Living Table

Copy everything below the line into a new file, fill it in, and hand it to
Claude to turn into `src/games/livingtable/campaign/modules/<id>.ts`. The
fields map one to one onto `CampaignModule` in
`src/games/livingtable/campaign/types.ts`. `modules/blackstone.ts` is a
finished example of every field.

## Write each fact once

The DM is sent the brief every turn, so a fact written in three places is
paid for three times. Each thing has one home: who is where lives on the
person, what happens where lives on the scene or encounter, and how a truth
comes out lives on the truth (plus the clues that point at it). The brief
shows each place, person and scene in full only when the player is there.

## The one rule

Write the campaign as **facts, situations and possible outcomes**, never as a
story. Not "the heroes discover the mayor is working with the goblins", but:

- TRUTH: the mayor made a deal with the goblins (secret)
- BEAT: the player discovers the mayor is involved, through any of: the
  letters, a goblin's testimony, the mayor confessing
- OUTCOMES: the mayor is exposed / confesses / is covered for / is ignored

The DM runs that. It cannot run a script, because the player will burn the
mayor's house down instead.

## Rules the engine holds you to

- **Ids** are lowercase, digits and underscores, unique across the whole
  campaign, and **permanent once anyone has played it**: saved games are
  lists of ids. Change the text whenever you like; never change an id.
- **Flags.** Conditions read a flat set of flags. Everything puts its own id
  in that set when it happens (a beat done, a clue found, a truth learned, an
  outcome reached, a clock step fired). The engine adds `act:<actId>` when an
  act starts, `dead:<npcId>` when someone dies, `prevented:<stepId>` when the
  player stops a clock step, and `ending:<endingId>`. Use `sets` to add your
  own named flag, when several routes should open the same door
  (`evidence_against_mayor`). A condition naming a flag nothing can set fails
  the build.
- **A condition** is any of `allOf: [flags]`, `anyOf: [flags]`,
  `noneOf: [flags]`, `afterScene: N`. All the parts you write must hold.
- **Scenes are DM turns**: every message to the DM and every new room it
  builds is one. A typical campaign runs 40 to 60. Space the villain's clock
  to match.
- **One character, levels 1 to 3.** Two goblins or two skeletons is a hard
  fight at level 1. Fantasy has real numbers for goblins and skeletons; sci-fi
  for raiders and combat drones. Anything else fights as a generic hostile.
- **NPC tokens** must exist in the genre's roster. Fantasy: `token_villager`,
  `token_robed_figure`, `token_guard`, `token_goblin`, `token_skeleton`.
  Sci-fi: `token_technician`, `token_civilian`, `token_officer`,
  `token_raider`, `token_drone`.
- **Rewards are story rewards**: access, help, trust, an ordinary item. The
  engine rolls all treasure and the DM never names a magic item.
- **Losing never ends a campaign.** Write each fight's failure as "if the
  player goes down and lives, ...". The death saves are the dice's.
- **No em dashes or en dashes**, anywhere. The build checks.
- **The map** is a grid of cells, one room or clearing each (20 by 15 tiles).
  The campaign opens at cell (0,0). North is cy-1, south cy+1, west cx-1,
  east cx+1. A village is several cells; a cellar is one.

---

## 1. Premise

```text
ID:                 (lowercase_with_underscores, permanent)
GENRE:              fantasy | scifi
TITLE:
TONE:
SETTING:            (only what the campaign needs)
CENTRAL CONFLICT:
HOOK:               (one or two sentences TO the player; shown on the campaign's card)
THE BIG QUESTION:   (what the campaign is ultimately about, as a question)
IF THEY SUCCEED:
IF THEY FAIL:
OPENING SCENE:      (location id, and what is happening when the player walks in)
```

## 2. Truths

What is true in this world. Each one is known, discoverable or secret.

```text
- id:
  visibility:   known | discoverable | secret
  text:
  learned via:  (discoverable and secret: every route by which it can come out)
  reveal when:  (secret: a condition; the engine refuses it coming out before then)
  sets:         (optional extra flags)
```

## 3. The villain

```text
NPC:          (the npc id the DM plays them from)
GOAL:
MOTIVATION:
PLAN:
RESOURCES:
ALLIES:
WEAKNESS:
LIMITATIONS:
STATUS NOW:

CLOCK (what happens if the player does nothing):
- id:
  when:          (condition, usually afterScene: N)
  event:         (what happens in the world)
  prevented by:  (condition; if it holds first, the step never fires)
  sets:
```

## 4. Factions

```text
- id:
  name:
  leader:              (npc id)
  goal:
  resources:
  allies / enemies:    (faction ids)
  attitude to player:  hostile | unfriendly | wary | neutral | friendly | allied
  wants from player:
  if ignored:
```

## 5. People

What does this person want RIGHT NOW? That field matters most.

```text
- id:
  name:
  role:
  description:
  personality:
  motivation:
  fears:
  values:
  secrets:             (truth ids they keep)
  knowledge:
  relationships:
  attitude to player:
  speech style:
  current goal:
  faction:             (faction id)
  usually found at:    (location id; the only place this is written, so a place's "usually here" comes from it)
  token:               (roster token id)
```

## 6. Places

```text
- id:
  name:
  cells:               (cx,cy; one place, one cell: the description doubles as the map hint.
                        Several cells: one line each on what is there)
  description:
  atmosphere:
  features:            (what is there, including what can be handled)
  secrets:             (truth ids that can be learned here)
  connected to:        (location ids)
  threats:
  discoverable:

Who is usually here comes from each person's "usually found at", and what
can happen here from each scene and encounter's location. Write those once,
there.
```

## 7. Acts (3 to 5)

```text
ACT id:
  title:
  goal:
  main conflict:
  revelation:          (what it builds to)
  (an act's people and places are its arcs' people and locations: list them on the arcs)
  advance when:        (condition; leave empty on the last act)
  transition:          (what the DM is told when this act begins)

  BEATS (things that must happen eventually; the DM chooses how):
  - id:
    text:
    required:
    can happen through:
    not before:        (condition)
    result:
    sets:

  ARCS (2 to 5 per act; each one is a problem that can be solved):
  - id:
    name:
    purpose:
    starting state:
    player objective:
    conflict:
    people:            (npc ids)
    locations:         (location ids)
    opens when:        (optional condition)
    approaches:
    rewards:
    failure:
    world changes:

    CLUES:
    - id:
      text:
      source:          (where, or who has it)
      points to:       (truth ids)
      sets:

    OUTCOMES (several can happen; the arc is resolved once any one does):
    - id:
      text:
      sets:
      attitudes:       (npc or faction id: new attitude)

    SCENES (describe the problem, never prescribe the solution):
    - id:
      name:
      location:
      initial situation:
      people present:
      what they want:
      what the player knows:
      what is hidden:
      available interactions:
      checks:          (skill, DC 5 to 30, what it reveals)
      can turn into:   (encounter id)
      escalation:
      outcomes:

    ENCOUNTERS:
    - id:
      name:
      type:            combat | social | exploration | puzzle | travel
      difficulty:      easy | medium | hard | deadly (for one character, levels 1 to 3)
      location:
      participants:
      environment:
      objective:
      special conditions:
      enemy behaviour:
      npc behaviour:
      triggers:
      success:
      failure:         (if the player goes down and lives, ...)
      alternative resolutions:
      rewards:
```

## 8. Endings

Checked in order; the first whose condition holds is the one reached. Put
the most specific first.

```text
- id:
  title:
  when:                (condition)
  text:                (what the DM plays out)
```

## 9. Notes for the DM

Pacing, tone, what never to do. One line each.

```text
-
```
