/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 4. "While the game works out one of my stats, multiply it" (Huge Power, Guts, Swift Swim, Compound Eyes ...).
//
// Source: src/data/abilities/ab-attrs.ts StatMultiplierAbAttr. Dispatched from three places in src/field/pokemon.ts:
//   - getEffectiveStat (`applyAbAttrs("StatMultiplierAbAttr", { pokemon: this, stat, statVal, simulated, move })`), skipped
//     while an attacker's ability-ignoring effect is on, unless the attacker carries PreserveBaseStatAbilitiesAbAttr;
//   - getAccuracyMultiplier, once for the attacker's Accuracy (`stat: Stat.ACC`) and once for the defender's Evasion
//     (`stat: Stat.EVA`, `pokemon: target`).
// canApply: `stat === this.stat && (!this.condition || this.condition(pokemon, null, move))`. Two clauses:
//   - `stat === this.stat`   the stat param itself: it is what the block IS about, not a condition;
//   - `this.condition(...)`   the optional constructor closure (argument 2, a PokemonAttackCondition). Only 7 attrs have
//     one; it is the only IF the class owns. Slot ctor:2, optional, one binding per user in bindings.ts.
// apply: `statVal.value *= this.multiplier`. No random draw, no state, nothing that reads `simulated`.
//
// The conditions of the weather, status and terrain abilities (Swift Swim, Guts, Quick Feet, Grass Pelt ...) do NOT live
// in this class. They come from two other places the rebuild carries over untouched (see the notes): the attr-level
// condition (`AbAttr.addCondition`, set by `.conditionalAttr(...)`) and the ability-level conditions (`.condition(...)`).
import { StatMultiplierAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { STAT_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { Stat } from "#enums/stat";

export default defineDecl(StatMultiplierAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.stat-value",
  label: "Multiply one of my stats, accuracy or evasion",
  summary: params =>
    `Whenever the game uses my ${params.stat}, it is multiplied by ${params.multiplier}. Example: 1.5 = 50% higher, 0.5 = half. Works for accuracy and evasion too.`,
  synonyms: [
    "huge power",
    "pure power",
    "swift swim",
    "chlorophyll",
    "compound eyes",
    "guts",
    "stat boost",
    "attack up",
    "speed up",
    "defense up",
    "double attack",
    "lower speed",
  ],
  examples: [
    "Double my Attack, like Huge Power",
    "Raise my Speed by 50% in the rain, like Swift Swim",
    "Raise my accuracy by 30%, like Compound Eyes",
  ],
  params: [
    {
      id: "stat",
      ctorIndex: 0,
      path: "stat",
      control: "select",
      label: "Which stat (Attack, Defense, Sp. Atk, Sp. Def, Speed, Accuracy or Evasion)",
      editable: true,
      default: "ATK",
      options: STAT_OPTIONS,
      codec: enumCodec(Stat, "stat"),
    },
    {
      id: "multiplier",
      ctorIndex: 1,
      path: "multiplier",
      control: "number",
      min: 0.1,
      max: 4,
      step: 0.05,
      label: "Stat multiplier (1.5 = 50% higher, 0.5 = half)",
      editable: true,
      default: 1.5,
    },
  ],
  conditions: [
    // The closure of the 7 attrs that have one. No single atom: each binding names its own (see bindings.ts).
    { slot: "ctor:2", ctx: "attack", path: "condition", optional: true, removable: true, editable: true },
  ],
  guards: [],
  feasibility: [],
  effect: { id: "effect.multiply-stat", params: ["stat", "multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // The boundary of the status-gated closures (Determination, Rage Point) and of the weather-gated abilities.
      name: "no status and a status",
      axes: { status: ["NONE", "BURN", "PARALYSIS"], foeMove: ["TACKLE", "WATER_GUN"] },
    },
    { name: "the weather the speed abilities react to", axes: { weather: ["NONE", "RAIN", "SUNNY", "SANDSTORM", "SNOW"] } },
  ],
  status: "decomposed",
  notes:
    "Tier A. 62 attrs (Quick Feet, Rage Point, Rainbow Fish and Radiant Jewel have two each). The class itself has ONE closure, ctor:2, optional. 55 attrs have none and need no binding; the 7 that have one are bound by hand: Hustle (the move deals damage), Plasma Lamp (Fire or Electric move, the printed move type), Determination (any status or frostbite), Rage Point twice (any status) map to library atoms; Propeller Tail (rain AND the weather object is not suppressed, request B02-35) and Jungle Fever (the raw terrain object, request B02-36) stay legacy-closure. NOT PART OF THE CLASS, SO NOT IN ITS DECLARATION: 19 attrs gate themselves with an attr-level condition (`.conditionalAttr(...)`, i.e. AbAttr.addCondition, field `extraCondition`: Guts, Marvel Scale, Quick Feet x2, Grass Pelt, Surge Surfer, Orichalcum Pulse, Hadron Engine, Big Leaves, Seaborne, Way of Swiftness, Breakwater, Glacial Ghost, Atlantic Ruler, Biofilm, Ice Picks, Flower Necklace, Rainbow Fish x2) and 5 abilities have an ability-level condition (`.condition(...)`: Swift Swim, Chlorophyll, Sand Rush, Slush Rush and Sand Veil, all the weather test with the Reap and Sow rule). recomposeAttr copies the attr-level condition onto the rebuild as it is and the blueprint carries the ability-level one, so behaviour is identical, but staff cannot see or edit those conditions as blocks yet (request B02-38). 31 attrs have no condition anywhere. Archetype classes that extend this one (FirstTurnStatMultiplier, WeatherStatMultiplier, HpScalingStatMultiplier, SelfHighestStatMultiplier ...) and ErDefeatistStatMultiplierAbAttr (init-elite-redux-vanilla-rebalance.ts:2592, which replaces the Defeatist instance) are separate classes, not users of this declaration. Quirks, not changed: the class is also read for Accuracy and Evasion in Pokemon.getAccuracyMultiplier (the defender's Evasion is read with `pokemon: target`), and the damage-side getEffectiveStat passes `allMoves[MoveId.NONE]` when there is no move, so a closure that reads the move sees that move there. The class never reads `simulated`.",
});
