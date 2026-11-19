/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01 chunk 2, Tier A calc-modifier with TWO consequences (an immunity, then a stat change), shown as two branches.
//
// "While the game checks whether a move can hit me, IF <condition>, I am immune to <type> moves and a stat of mine
// changes." `canApply` is inherited from TypeImmunityAbAttr (four feasibility clauses). The only swappable condition is
// the optional constructor closure (slot ctor:3, `condition`), which no live user passes. `apply` runs in this order:
//   1. `super.apply`: `typeMultiplier.value = 0`                                   = effect "block it"
//   2. `cancelled.value = true` (hides the "no effect" message), ALWAYS, even when simulated
//   3. unless `simulated`: unshift a StatStageChangePhase on the holder (`selfTarget` true) for the stat and the stages
//                                                                                  = effect "change a stat"
// The stat and the stage count are plain constructor arguments (ctor 1 and 2), so they are real, typed settings.
import { TypeImmunityStatStageChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { STAT_OPTIONS, TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";

export default defineDecl(TypeImmunityStatStageChangeAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-immunity",
  label: "Absorb a type of move and raise a stat instead",
  summary: params =>
    `Moves of the ${params.type} type do nothing, and this Pokemon's ${params.stat} changes by ${params.stages} stages instead. Example: 1 raises it by one stage, like Motor Drive.`,
  synonyms: [
    "absorb and boost",
    "motor drive",
    "well-baked body",
    "justified",
    "immune and raise a stat",
    "stat boost from a type",
    "lightning rod",
    "sap sipper",
  ],
  examples: ["Immune to Electric moves and raise Speed by one stage when hit by one, like Motor Drive"],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      path: "immuneType",
      control: "select",
      label: "Immune to this type",
      editable: true,
      default: "ELECTRIC",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
    {
      id: "stat",
      ctorIndex: 1,
      path: "stat",
      control: "select",
      label: "Which stat changes",
      editable: true,
      default: "SPD",
      options: STAT_OPTIONS,
      codec: enumCodec(Stat, "stat"),
    },
    {
      id: "stages",
      ctorIndex: 2,
      path: "stages",
      control: "number",
      label: "Number of stages (1 to 6, negative lowers)",
      editable: true,
      default: 1,
      min: -6,
      max: 6,
      step: 1,
      integer: true,
    },
  ],
  conditions: [
    // Optional AbAttrCondition `(pokemon) => boolean`; the field is null for every live user.
    { slot: "ctor:3", ctx: "holder", path: "condition", removable: true, editable: true, optional: true },
  ],
  guards: [],
  feasibility: [
    "Moves that hit every Pokemon or a whole side (Spikes, Rain Dance) are never blocked",
    "A Pokemon never blocks its own move",
    "The stat only changes when the move is really used (not when the game only previews it)",
    "A stat that is already at its limit does not move further",
  ],
  branches: [
    {
      label: "Block the move",
      conditions: [],
      effect: { id: "effect.immune-to-type", params: ["type"] },
    },
    {
      label: "Change my stat",
      conditions: [],
      effect: { id: "effect.stat-stage", params: ["stat", "stages"] },
    },
  ],
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a move of each absorbed type and a neutral move",
      axes: { foeMove: ["THUNDER_SHOCK", "DARK_PULSE", "EMBER", "TACKLE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Users (4 attrs): Motor Drive (78, Electric, Speed +1), Justified (154, Dark, Attack +1; the ER vanilla rebalance replaces the vanilla Justified attr with this one), Well-Baked Body (273, Fire, Defense +2), Glycolysis (5970 attr 1, Fire, Defense +2). No user passes the closure, so nothing is bound. Library note: the stat change is a StatStageChangePhase on the holder with selfTarget true, which the existing effect.stat-stage (target = me) describes; the library effect may not apply the Simple/Contrary/Mist style modifiers exactly like the phase does, the class keeps the phase. `cancelled` is set even for simulated calls (unlike the stat change), kept as it was. Subclasses TypeAbsorbStatBoostAbAttr and TypeAbsorbHighestAttackStatBoostAbAttr (ER archetype immunity-with-absorb) override apply and belong to another batch.",
});
