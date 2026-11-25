/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 5. Tier A calc-modifier. "While the game works out one of my stats, if any terrain is on the field, multiply it"
// (Surges Up: Speed x2 under any terrain).
//
// Source: fakemon-pitch-raichu.ts RaichuAllTerrainSurgeSurferAbAttr (extends StatMultiplierAbAttr, dispatched as StatMultiplierAbAttr
// from Pokemon.getEffectiveStat and the accuracy code). It has no code of its own: the constructor only handed the parent
//   stat = Stat.SPD, multiplier = 2, condition = () => isAnyTerrainActive()
// and the parent does the work:
//   canApply  `stat === this.stat && (!this.condition || this.condition(pokemon, null, move))`
//               clause 1  the stat being read is the one this attr multiplies      what the block IS about (feasibility, not editable)
//               clause 2  the constructor closure: `currentTerrain() !== NONE`      the condition, ctor:2
//   apply     `statVal.value *= this.multiplier`
// Nothing is random, nothing is remembered, nothing reads `simulated`.
// Class edit (a pure move of code): the three values are now constructor arguments with the old values as defaults, so
// `builder.attr(RaichuAllTerrainSurgeSurferAbAttr)` and `new RaichuAllTerrainSurgeSurferAbAttr()` build the same attr as before.
import { RaichuAllTerrainSurgeSurferAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-raichu";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { STAT_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { Stat } from "#enums/stat";

export default defineDecl(RaichuAllTerrainSurgeSurferAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.stat-value",
  label: "Multiply one of my stats (Surges Up style)",
  summary: params =>
    `While any terrain is on the field, my ${params.stat} is multiplied by ${params.multiplier}. Example: Speed x2 in any terrain, so I outrun foes.`,
  synonyms: [
    "surges up",
    "surge surfer",
    "speed in any terrain",
    "terrain speed boost",
    "double speed in terrain",
    "swift swim style",
    "stat boost under terrain",
  ],
  examples: ["Double my Speed while any terrain is on the field, like Surges Up"],
  params: [
    {
      id: "stat",
      ctorIndex: 0,
      path: "stat",
      control: "select",
      label: "Which stat (Attack, Defense, Sp. Atk, Sp. Def, Speed, Accuracy or Evasion)",
      editable: true,
      default: "SPD",
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
      label: "Stat multiplier (2 = double, 0.5 = half)",
      editable: true,
      default: 2,
    },
  ],
  conditions: [
    // ctor:2 = `() => isAnyTerrainActive()` = the terrain is not None. Bound in bindings.ts to not(field.terrain NONE).
    { slot: "ctor:2", ctx: "attack", lib: "field.terrain", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["Only the chosen stat is multiplied; every other stat is left alone"],
  effect: { id: "effect.multiply-stat", params: ["stat", "multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // The grid runs every terrain state; a Physical and a Special foe move cover the move the engine hands over.
      name: "Speed is worked out under no terrain and under a terrain",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier A, fully decomposed. Users (1): Surges Up (6061) attr 2 (after PostSummonTerrainChangeAbAttr ELECTRIC and PostBiomeChangeTerrainChangeAbAttr ELECTRIC, both other batches); its condition closure is bound to not(field.terrain NONE), the same value as `(globalScene?.arena?.terrainType ?? NONE) !== NONE` (the library atom reads arena.terrainType, and NONE is a choice of the atom). The stat match (clause 1 of the parent canApply) is the thing the block is about, listed as feasibility and not editable. The closure ignores the Pokemon and the move, so ctx attack is only the engine signature. Sibling RaichuTerrainStatMultiplierAbAttr (one chosen terrain, Tier B) and the partner class are separate declarations. The ability-level conditions of Surges Up are none. No oddity found: the ability also sets Electric Terrain on entry and on a biome change, so in practice the closure is almost always true while the holder is out.",
});
