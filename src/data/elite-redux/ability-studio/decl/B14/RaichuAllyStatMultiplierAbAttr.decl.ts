/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 4. Tier B calc-modifier. "While the game works out one stat of my partner, if the chosen terrain is on the field and it
// is a multi battle, multiply it by 1.5, or by 2 when the partner is magnetised" (Demodulator: Attack and Defense; Modulator:
// Sp. Atk and Sp. Def).
//
// Source: fakemon-pitch-raichu.ts RaichuAllyStatMultiplierAbAttr (extends AllyStatMultiplierAbAttr(stat, 1.5, false), dispatched as
// AllyStatMultiplierAbAttr for the ALLY of the Pokemon whose stat is read: the frame's holder is the ability owner and `target` is the
// Pokemon whose stat changes). canApply, original clause order, now `guards && gate && residual`:
//   guard    1. super.canApply(params)  = stat === this.stat && !(ignoreAbility && ignorable); `ignorable` is false here, so this is just the stat match
//   gate     2. currentTerrain() === this.terrain   -> library field.terrain (arena.terrainType)
//   residual 3. (currentBattle?.getBattlerCount() ?? 1) > 1   "more than one Pokemon per side"
// Clause 3 is a real condition ("only in a multi battle"), but the library atom party.doubles reads `currentBattle.double`, which is
// only TRUE for exactly two per side (playerCapacity === 2), while this test is true for three per side too (see the comment on
// Battle.double in battle.ts). Not the same predicate, so it stays in the class as feasibility and an atom is requested (R-B14-4.4).
// apply: `statVal.value *= partnerHasRaichuBoostCondition(target) ? 2 : 1.5`. The 1.5 and the 2 were literals; they are now constructor
// arguments 2 and 3 (defaults unchanged). partnerHasRaichuBoostCondition is "the partner floats because of Magnet Rise, was a target
// of Magnetic Flux this battle, or has the Plus or Minus pairing". No random draw, no memory written, nothing reads `simulated`.
import { RaichuAllyStatMultiplierAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-raichu";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { STAT_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { TerrainType } from "#data/terrain";
import { Stat } from "#enums/stat";

/** NONE ("no terrain") is not a terrain a player would ask for, so it is left out of the choices. */
const TERRAIN_CHOICES = ["MISTY", "ELECTRIC", "GRASSY", "PSYCHIC", "TOXIC"] as const;

export default defineDecl(RaichuAllyStatMultiplierAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.stat-value",
  label: "Boost my partner's stat in a terrain (more if magnetized)",
  summary: params =>
    `In a double battle during ${params.terrain} Terrain, my partner's ${params.stat} is x${params.normalMultiplier}, or x${params.boostedMultiplier} if it is magnetized (Magnet Rise, Magnetic Flux, Plus or Minus).`,
  synonyms: [
    "demodulator partner boost",
    "modulator partner boost",
    "help my partner in a terrain",
    "ally stat boost in terrain",
    "partner attack up",
    "team terrain boost",
    "doubles ally boost",
    "magnet rise ally",
  ],
  examples: [
    "In Electric Terrain my partner's Attack is 50% higher, or doubled if it is floating from Magnet Rise",
    "Raise my ally's Sp. Def in Electric Terrain, like Modulator",
  ],
  params: [
    {
      id: "stat",
      ctorIndex: 0,
      path: "stat",
      control: "select",
      label: "Which stat of my partner (Attack, Defense, Sp. Atk, Sp. Def, Speed, Accuracy or Evasion)",
      editable: true,
      default: "ATK",
      options: STAT_OPTIONS,
      codec: enumCodec(Stat, "stat"),
      gateIndependent: true,
    },
    {
      id: "terrain",
      ctorIndex: 1,
      path: "terrain",
      control: "select",
      label: "Which terrain has to be active",
      editable: true,
      default: "ELECTRIC",
      options: TERRAIN_CHOICES,
      codec: enumCodec(TerrainType, "terrain"),
    },
    {
      id: "normalMultiplier",
      ctorIndex: 2,
      path: "normalMultiplier",
      control: "number",
      min: 0.1,
      max: 4,
      step: 0.05,
      label: "Multiplier for my partner (1.5 = 50% higher)",
      editable: true,
      default: 1.5,
      gateIndependent: true,
    },
    {
      id: "boostedMultiplier",
      ctorIndex: 3,
      path: "boostedMultiplier",
      control: "number",
      min: 0.1,
      max: 4,
      step: 0.05,
      label: "Multiplier when my partner is magnetized (2 = double)",
      editable: true,
      default: 2,
      gateIndependent: true,
    },
  ],
  conditions: [
    // Gate = [field.terrain { terrain }] (bindings.ts); the terrain is repeated from the live `terrain` param (gateParams).
    { slot: "gate", ctx: "params", lib: "field.terrain", removable: true, editable: true },
  ],
  gateParams: [{ param: "terrain", block: "field.terrain", field: "terrain" }],
  guards: [],
  feasibility: [
    "Only the chosen stat of my partner is multiplied",
    "Only in a battle with more than one Pokemon per side (a single battle does nothing)",
    "A partner counts as magnetized when it floats from Magnet Rise, was hit by Magnetic Flux this battle, or has the Plus or Minus pairing",
  ],
  effect: { id: "effect.package", params: ["stat", "normalMultiplier", "boostedMultiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "the partner is hit and attacks, under no terrain and under a terrain",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  l2StaticReason:
    "The class is dispatched for the ALLY of the Pokemon whose stat is read, so the singles scenario of calc.stat-value never evaluates it (it also does nothing in a single battle); test/tests/elite-redux/decomp/B14/chunk4.test.ts proves the original and the rebuilt Demodulator in a real double battle instead.",
  status: "decomposed",
  notes:
    "Tier B. Users (4): Demodulator (6059) attrs 2 (Attack) and 3 (Defense), Modulator (6060) attrs 2 (Sp. Atk) and 3 (Sp. Def); all in Electric Terrain, 1.5 and 2. Package (effect only), reason: the effect picks BETWEEN two numbers by a property of the partner (magnetized or not), and the library has no multiply-a-stat block that targets the partner (B02 asked for a `target` setting on effect.multiply-stat, request B02-42 area, for Victory Star) nor an atom for 'my partner is magnetized' (R-B14-4.5), so the choice of the two numbers cannot be split into a condition plus a block yet; the two numbers are typed params. The terrain test is the gate (field.terrain). The multi-battle test is the residual (feasibility) because party.doubles is not the same predicate (R-B14-4.4). The inherited ignorable flag (false) is a constructor literal passed to the parent and is not a param: the partner boost always works, like Victory Star. Class edit (pure move of code, defaults unchanged): `terrain` public, `normalMultiplier` and `boostedMultiplier` new constructor arguments 2 and 3, `canApply` is `gatedCanApply`, the old inline expression is split into guards (super.canApply), gate and residual in the same order. Oddities, not fixed: partnerHasRaichuBoostCondition also refreshes the module-level Magnetic Flux memory (resetBattleLocalState) every time it is asked, a preview included; the Plus and Minus pairings are read through engine queries.",
});
