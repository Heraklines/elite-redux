# Elite Redux v0.0.5.1

A follow-up to the big 0.05 World Map update: one new event goes live, two new
party-screen tools, and a long list of combat and quality-of-life fixes.
Baseline: everything since the last live release (about 50 commits).

---

## New

### Giratina's Bargain (the Abyss)

Deep in the Abyss, Giratina now appears instead of a shop. Every offer is a deal
with one of the Seven Sins: accept a powerful boon (a permanent stat surge, a
relic, and other rewards) and pay its price. You can read the offer, open Check
Team to weigh it against your party, and back out of any choice you do not like.
This event was previously test-only; it is now live for everyone.

### Fusion Preview for DNA Splicers

Splicing two Pokemon is no longer a blind guess. When you use DNA Splicers and
pick the first Pokemon, a live preview panel appears on the party screen and
updates as you move the cursor over each other party member: the fused sprite,
the fused base stats, and all four abilities (the base mon keeps slots 1 and 3,
the absorbed mon gives slots 2 and 4). Press R (or the on-screen Switch button)
to flip which mon is the base so you can compare both orders, and A (or Fuse)
commits the combination you are actually looking at. There are on-screen Fuse and
Switch buttons for touch players.

### Redesigned level-up Move Learn screen

When a Pokemon levels up and learns new moves, the move screen is rebuilt:

- Both the Learnable and Current move columns now scroll inside the panel, so a
  long list of new moves no longer overflows off the edge. This is future-proofed
  for Pokemon that carry more than four moves.
- A small panel on the left shows the learning Pokemon's party icon and its six
  base stats, so you can see what you are working with at a glance.

### Reward shop: scrolling item descriptions

Long item descriptions in the reward screen no longer get cut off. Focusing an
item with a long description now shows the full text in a box that gently scrolls
so the clipped tail becomes readable, while short descriptions stay static.

### Egg gacha: Options submenu

The egg gacha's Auto Restock and Discard Eggs controls are merged into a single
Options submenu to declutter the screen, and a freeze when opening it is fixed.

---

## Balance and mechanics

- **Dynamax Cannon** now deals double damage to Mega-evolved foes, matching its
  intended behavior.
- **Steel Roller** can be used even when no terrain is active (the terrain
  requirement was incorrectly blocking it).
- **Decorate** crit-boost timing is corrected, and moves with a "can't be used
  next turn" clause no longer lock you out of acting.
- **Wild encounters:** the gate on wild legendaries is tightened to the proper
  BST curve, and wild Pokemon that roll in under-leveled now de-evolve to a stage
  that fits, so you stop seeing fully evolved mons at impossible early levels.

---

## Bug fixes

- **Save safety:** fixed a case where loading could drop local session slots and
  lose run progress. Your in-progress runs are preserved on load.
- New Elite Redux held items (elemental gems, terrain seeds, reactive items) now
  persist correctly across a reload instead of vanishing.
- Reactive items now show the holding Pokemon's icon in the item bar, so you can
  tell whose item is whose.
- Resynced 81 ability ids and restored **As One** (Calyrex riders) so it works
  again.
- **Mimikyu (Apex) and Rayquaza** fusion Disguise now actually breaks and works.
- **Ability Capsule** is now repeatable on the same Pokemon, so you can keep
  rerolling toward its hidden ability.
- Priority abilities no longer hand out a blanket priority boost, fixing random
  cases of being outsped when you should have moved first.
- A granted ability (for example from Clowning Around) now sticks when the
  Pokemon Mega-evolves or Gigantamaxes.
- A LOCKED Battle Bond innate no longer fires (no phantom form change or boost).
- Fusion ability slot ownership is preserved correctly after fusing.
- **Rare Candy** no longer shows +0 stat gains when you buy and use two or more
  in a row.
- Youngster-mode innates now correctly display as UNLOCKED on the summary screen.
- The biome full heal now happens only on the every-10-waves rest, not every time
  you leave a biome on the World Map.
- **Cursed Idol:** clearer relic text, and the Giratina sprite no longer flickers.
- Reworded the Youngster mode description.
