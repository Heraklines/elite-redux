/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { wholePercentCodec } from "#data/elite-redux/ability-studio/decl/B09/chunk4-codecs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { ScavengerLootAbAttr } from "#data/elite-redux/archetypes/lifesteal";

// B09 chunk 4. "Sometimes I take one of the item the Pokemon I knock out was holding" (Scavenger, Bandit).
//
// Source: src/data/elite-redux/archetypes/lifesteal.ts, class ScavengerLootAbAttr (extends PostKnockOutAbAttr, ab-attrs.ts:2625).
// Dispatched by FaintPhase to EVERY Pokemon on the field when anything faints (`applyAbAttrs("PostKnockOutAbAttr", { pokemon: p,
// victim })`, faint-phase.ts:268). Clauses of the old canApply, in order:
//   0. `this.lootItem = undefined` (forget the last pick; kept in canApply, before everything)
//   1. `super.canApply(params)` (always true) `&& !params.simulated`                                     -> guards()  (a simulated call never rolls)
//   2. `!pokemon.isFainted()`                                                                            -> guards()  guard `not-fainted`
//   3. `koLandedByDirectHit(params)` (the victim's latest received attack came from this holder)          -> guards()  (bundled safety rule)
//   4. RANDOM DRAW 1: `pokemon.randBattleSeedInt(100) >= Math.round(lootChance * 100)` -> false             -> gate (IF)  rng.chance
//   5. the victim's transferable held items (`PokemonHeldItemModifier`, `isTransferable`); none -> false      -> residual
//   6. RANDOM DRAW 2: `this.lootItem = items[pokemon.randBattleSeedInt(items.length)]`                       -> residual
//   7. `globalScene.canTransferHeldItemModifier(lootItem, pokemon)`                                        -> residual (feasibility)
// apply: with no pick or when simulated, forget the pick and stop; otherwise `tryTransferHeldItemModifier(lootItem, pokemon, false)` and,
// when it moved, queue the "stole an item" message; forget the pick.
// Constructor: ({ chance }), one options object; throws unless chance is in (0, 1].
// Tier B (random draw in canApply, like Static): guards = 1-3, gate = 4, residual = 5-7. The roll (draw 1) happens BEFORE the
// item check, so it is drawn even when the victim holds nothing; the library chance atom sits at that same position.
export default defineDecl(ScavengerLootAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.on-ko",
  label: "Sometimes take an item from a Pokemon I knock out",
  summary: params =>
    `After my attack knocks out a Pokemon, there is a ${params.chance}% chance I take one of its held items, if I can carry it. Example: 50 = like Scavenger.`,
  synonyms: [
    "scavenger",
    "bandit",
    "loot",
    "steal an item on ko",
    "take the held item",
    "pick up the item of a fainted foe",
    "item thief",
  ],
  examples: [
    "50% chance to take a held item from a foe I knock out, like Scavenger",
    "Always take the item of a foe I knock out",
  ],
  params: [
    {
      id: "chance",
      ctorIndex: 0,
      ctorOption: "chance",
      path: "lootChance",
      control: "slider",
      label: "Chance (%)",
      editable: true,
      integer: true,
      min: 1,
      max: 100,
      step: 1,
      default: 50,
      codec: wholePercentCodec,
    },
  ],
  gateParams: [{ param: "chance", block: "rng.chance", field: "pct" }],
  conditions: [
    // The gate is the single atom rng.chance (draw 1).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: ["not-fainted"],
  feasibility: [
    "Only the Pokemon whose direct hit landed the knock-out can loot; a knock-out from weather, poison or hazards credits nobody",
    "The foe must hold an item that can be moved, and I must be able to carry it",
    "Only one item is taken, picked at random among the ones that can be moved",
  ],
  effect: { id: "effect.steal-item", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "canApply",
    rngOrder: [
      "canApply gate: the loot roll randBattleSeedInt(100), drawn even when the foe holds nothing",
      "canApply residual: which item randBattleSeedInt(count), only when the foe holds at least one movable item",
    ],
    state: "none",
    simulated: "respects",
  },
  probes: [
    {
      name: "I knock the foe out at full HP and below full HP (the loot does not read my HP; this also moves the random seed state)",
      axes: { hp: ["max", "max-1"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B. 2 attrs, both chance 0.5: Scavenger (5083 attr 1) and Bandit (5702 attr 1); each also has a LifestealOnKoAbAttr at attr 0. Gate binding for both: rng.chance pct 50, the single clause the class rolled. Per-instance state: `lootItem` is set in canApply and consumed (and cleared) in apply; buildAttr makes a fresh instance so nothing is shared. The chance param is a whole percent because the class rounds `chance * 100` for the comparison and the library atom takes a whole percent (the codec refuses a fraction that is not a whole percent). Differences between the original and the library atom, recorded and not fixed: (a) at 100% the atom skips the draw (`pct >= 100`) whereas the class still draws one number, so a staff rule at 100% would shift the random sequence by one draw per knock-out; no user is at 100%; (b) the atom answers true for a simulated call, but the guards stop a simulated call before the gate. Engine coupling: none outside the class. Oddity, not fixed: the roll is drawn before the item check, so a knock-out of an item-less foe still consumes a random number.",
});
