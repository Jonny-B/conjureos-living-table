# The Cupboard Goblin

<!--
  THIS FILE IS THE TEMPLATE. Copy it to a new name (for example adventures/my-adventure.md),
  change everything, then check it with:   npx -y tsx scripts/adventures/check.ts
  Text between "less-than, exclamation, dash, dash" and "dash, dash, greater-than" is a comment:
  the game never sees it, so leave yourself notes. A comment that starts with ADDED or REVIEW
  is listed by the checker as something to look at again.
  Every section is explained in adventures/README.md.
-->

- version: 1
- author: owner
- levels: 1 to 1
- tone: Warm village comedy, with one small real danger.

## Summary

A nervous shopkeeper has a goblin in his storeroom and a lost key. You are a young apprentice who wants more than your father's workshop, and you take the job.

## Truths

<!-- Facts the DM may never contradict. One per bullet. -->

- The shop belongs to Hobb, a nervous shopkeeper.
- The storeroom door is locked, and the only spare key is hidden in the counter drawer.
- There is exactly one goblin in the storeroom, and it is alone.

## DM must

- Let the hero find the spare key by searching the counter drawer.
- Describe the goblin as small, green and more frightened than brave.

## DM never

- Never hand over the key without a search.
- Never add a second goblin or any other creature to the storeroom.
- Never let the goblin speak.

## Hooks

<!-- How the story addresses each class. "default" is used for any class not listed. -->

- default: You are a young apprentice who wants more than your father's workshop, so you take odd jobs on the side.
- fighter: You are known in the village for your strong back and steady hands, so Hobb asks you first.
- rogue: You are known for quick fingers and a quiet step, so Hobb whispers his problem to you.
- wizard: You are known for a small talent with sparks, so Hobb hopes you can make light of it.

## Starting kit

<!-- armor: none means the hero wears nothing. Potions are a plain count. -->

### fighter

- weapon: a plain sword
- armor: none
- potions: 0

### rogue

- weapon: a plain dagger
- armor: none
- potions: 0

### wizard

- weapon: a plain staff
- armor: none
- potions: 0

## Item: Brass key

- description: A small brass key, warm from the drawer it was hidden in.
- quest: yes

## NPC: Hobb

- role: shopkeeper
- personality: Nervous and polite. Wrings his hands when he talks.
- token: token_villager
- wants: The thing in his storeroom gone before his customers hear about it.
- knows: The storeroom door is kept locked.
- knows: Something small has been scratching and giggling in there for two nights.
- knows: A spare key lives somewhere near the till.
- secret: He lost the real key weeks ago and is too embarrassed to say so.
- voice: Quick and apologetic.
- location: Hobb's Shop

## Location: Hobb's Shop

- id: shop
- dm notes: The only way on is the back door to the storeroom, and it is locked.

> A cramped shop of shelves and sacks, lit by two guttering torches. Hobb hovers behind a counter that has seen better years.

### Map

```
####################
#..................#
#..t...........t...#
#..................#
#.....H....c.......#
#..................#
#..................#
#..................#
#..................#
#..................#
#..................#
#....@.............#
#..................#
#..................#
#########D##########
```

### Legend

- `#` = wall_stone
- `.` = floor_stone
- `t` = floor_stone, prop torch
- `@` = floor_stone, start
- `H` = floor_stone, spawn hobb
- `c` = floor_stone, prop chest, feature counter_drawer
- `D` = floor_stone, prop door_open, exit storeroom_door

### Feature: Counter drawer

- id: counter_drawer
- description: A shallow drawer under the counter, stuck fast.
- secret: A brass key is taped to the underside of the till.
- search dc: 10
- gives: Brass key
- once: yes

### Spawn: hobb

- creature: token_villager
- hostile: no
- awake: yes
- npc: Hobb

### Exit: Door to the storeroom

- id: storeroom_door
- to: The Storeroom
- arrive at: Door to the shop
- open when: the player has the brass key
- locked text: The storeroom door is locked tight. Hobb said something about a spare key near the till.

## Location: The Storeroom

- id: storeroom

> Cold air and the smell of old flour. Something small shifts in the dark between the crates.

### Map

```
#########U##########
#..................#
#..s...............#
#..................#
#..................#
#..................#
#..................#
#..................#
#.........g........#
#..................#
#..................#
#..................#
#..................#
#..................#
####################
```

### Legend

- `#` = wall_stone
- `.` = floor_stone
- `s` = floor_stone, prop table_w, feature packing_table
- `g` = floor_stone, spawn goblin
- `U` = floor_stone, prop door_open, exit shop_door

### Feature: Packing table

- id: packing_table
- description: A packing table, gnawed at the corners and dusted with flour.

### Spawn: goblin

- creature: goblin
- hostile: yes
- awake: yes

### Exit: Door to the shop

- id: shop_door
- to: Hobb's Shop
- arrive at: Door to the storeroom

## Scene: Hobb's trouble

- id: trouble
- location: Hobb's Shop

> Hobb catches your sleeve the moment you step in. "Please," he whispers. "Something is in my storeroom."

### Objective: Talk to Hobb

- id: talk
- done when: the player talks to Hobb

### Objective: Find a way into the storeroom

- id: key
- done when: the player has the brass key

### Objective: Deal with whatever is in the storeroom

- id: goblin_dealt
- done when: the spawn goblin is killed

### Beat: into_storeroom

- when: the player enters The Storeroom

> Something small and green freezes between two crates, then bares its teeth.

### Beat: goblin_down

- when: the spawn goblin is killed
- sets flag: goblin_gone

> The scratching stops. For the first time in two nights, the shop is quiet.

### Next

- Quiet at last when the flag goblin_gone is set

## Scene: Quiet at last

- id: quiet
- location: Hobb's Shop

> Hobb pumps your hand until you worry it will come off.

### Ending

- outcome: victory

> Hobb presses a few coins into your palm and promises to tell everyone who did the job. It is a small start, but it is yours.
