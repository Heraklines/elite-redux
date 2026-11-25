/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 4. Tier B calc-modifier. "While the game works out one of my stats, if the chosen terrain is on the field,
// multiply it" (Demodulator: Attack and Defense x1.5 in Electric Terrain; Modulator: Sp. Atk and Sp. Def x1.5).
//
// Source: fakemon-pitch-raichu.ts RaichuTerrainStatMultiplierAbAttr (extends StatMultiplierAbAttr, dispatched as
// StatMultiplierAbAttr from Pokemon.getEffectiveStat and the accuracy code). The original was the inherited
//   canApply = stat === this.stat && (!this.condition || this.condition(pokemon, null, move))
// with `condition = () => currentTerrain() === terrain` handed to the parent by the constructor. Now `guards && gate`, original order:
//   guard  1. stat === this.stat                 the stat being read is the one this attr multiplies (what the block IS about)
//   gate   2. currentTerrain() === this.terrain  `globalScene?.arena?.terrainType ?? NONE` equals the library atom field.terrain
//                                                (arena.terrainType) for every terrain staff can pick (NONE is not offered)
// apply (inherited): `statVal.value *= this.multiplier`. Nothing is random, nothing is remembered, nothing reads `simulated`.
// The terrain was only inside the closure; it is now a public field (`terrain`) so a live instance can be read back, and the
// parent still gets the same closure, so the inherited condition (`getCondition`, the dispatch) is unchanged.
import { RaichuTerrainStatMultiplierAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-raichu";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { STAT_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { TerrainType } from "#data/terrain";
import { Stat } from "#enums/stat";

/** NONE ("no terrain") is not a terrain a player would ask for, so it is left out of the choices. */
const TERRAIN_CHOICES = ["MISTY", "ELECTRIC", "GRASSY", "PSYCHIC", "TOXIC"] as const;

export default defineDecl(RaichuTerrainStatMultiplierAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.stat-value",
  label: "Multiply one of my stats while a terrain is active",
  summary: params =>
    `While ${params.terrain} Terrain is active, my ${params.stat} is multiplied by ${params.multiplier}. Example: 1.5 = 50% higher, 0.5 = half.`,
  synonyms: [
    "demodulator",
    "modulator",
    "terrain stat boost",
    "electric terrain attack boost",
    "grassy terrain defense",
    "stat boost in terrain",
    "terrain attack up",
    "surge surfer",
  ],
  examples: [
    "Raise my Attack by 50% in Electric Terrain, like Demodulator",
    "Raise my Sp. Def by 50% in Electric Terrain, like Modulator",
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
      // Only the guard (the stat the block is about) and the effect read it; the gate never repeats it.
      gateIndependent: true,
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
      gateIndependent: true,
    },
    {
      id: "terrain",
      ctorIndex: 2,
      path: "terrain",
      control: "select",
      label: "Which terrain has to be active",
      editable: true,
      default: "ELECTRIC",
      options: TERRAIN_CHOICES,
      codec: enumCodec(TerrainType, "terrain"),
    },
  ],
  conditions: [
    // Gate = [field.terrain { terrain }] (bindings.ts). The terrain is repeated from the live `terrain` param (gateParams).
    { slot: "gate", ctx: "params", lib: "field.terrain", removable: true, editable: true },
  ],
  gateParams: [{ param: "terrain", block: "field.terrain", field: "terrain" }],
  guards: [],
  feasibility: ["Only the chosen stat is multiplied; every other stat is left alone"],
  effect: { id: "effect.multiply-stat", params: ["stat", "multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // The grid already runs every terrain state; a Physical and a Special foe move cover the stat the engine asks for.
      name: "a damaging move under no terrain and under a terrain",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B (the terrain used to live only inside a closure that the constructor built, so it could not be swapped). Users (4): Demodulator (6059) attrs 0 (Attack) and 1 (Defense), Modulator (6060) attrs 0 (Sp. Atk) and 1 (Sp. Def); all x1.5 in Electric Terrain, all four gates bound to field.terrain ELECTRIC. Clause classification, original order: (1) the stat match is the thing the block is about, kept as the guard `guards`, not editable; (2) the terrain test is the condition. `currentTerrain()` is `globalScene?.arena?.terrainType ?? NONE` and the atom reads `globalScene.arena.terrainType`: the same value whenever a scene exists, and NONE is not a choice. The effect is the library multiply-a-stat (the same `statVal.value *= multiplier` as the parent). The class never reads `simulated`. Class edit: `terrain` is now a public field and `canApply` is `gatedCanApply` (a pure move of code; the parent still receives the same closure). Sibling RaichuAllyStatMultiplierAbAttr (partner side) and RaichuAllTerrainSurgeSurferAbAttr (any terrain, Speed x2, a plain StatMultiplierAbAttr subclass with a closure) are separate classes. The ability-level conditions of these abilities are none. Library request R-B02-39 (engine-parameter builder of calc.stat-value) is mirrored in harness/world.ts.",
});
