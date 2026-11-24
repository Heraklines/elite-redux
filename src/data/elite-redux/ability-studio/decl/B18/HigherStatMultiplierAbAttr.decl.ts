/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B18 chunk 3, Tier B calc-modifier. "While the game works out one of my stats, IF it is my highest of the listed stats, DO multiply
// it by <multiplier>."
//
// Source: ability-upgrades/attrs/requested-combat-riders.ts, a subclass of StatMultiplierAbAttr (constructor `(candidates, multiplier)`,
// it passes `candidates[0]` and the multiplier to the parent; the parent's own stat test is NOT called, canApply is overridden without
// super). Dispatched while a stat is calculated (Pokemon.getEffectiveStat, once per stat per calculation).
//   canApply, in the ORIGINAL clause order (now guards && gate, every clause a pure read, no draw):
//     guard   stat is not Accuracy or Evasion, and is one of the listed stats      -> WHICH stats the boost may touch (the list is a setting)
//     gate    stat === the listed stat with the highest `holder.getStat(stat, false)` (strict `>`, a tie goes to the first listed)
//                                                                                    -> condition WITHOUT a library atom yet (request R-B18-23)
//   apply     inherited `statVal.value *= multiplier`. No random draw, no state, `simulated` is not read.
// The gate ("this stat is my highest of the listed ones") is a real, swappable condition, so it is split out of the effect with the
// gate/residual convention. It has no library atom, so its binding is a legacy-closure (counted as undecomposed) until request
// R-B18-23 exists; the effect is the library's multiply-stat with the listed stats and the multiplier as typed settings.
//
// NOT PART OF THIS CLASS: Flower Gift (122) gives every attr of this class an attr-level condition, "the weather is Sun or Extremely
// harsh sunlight and not suppressed" (`AbAttr.addCondition`, not a constructor argument). `recomposeAttr` copies it onto a rebuild, so
// behaviour is identical, but staff cannot see or edit it as a block yet (request R-B18-27).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { HigherStatMultiplierAbAttr } from "#data/elite-redux/ability-upgrades/attrs/requested-combat-riders";
import { STAT_SET_OPTIONS, statSetCodec } from "./b18-chunk3-codecs";

export default defineDecl(HigherStatMultiplierAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.stat-value",
  label: "Multiply the best of my chosen stats",
  summary: params =>
    `While my stats are worked out, the highest of ${params.candidates} is multiplied by ${params.multiplier}, if the conditions hold. Example: x1.5 to my better attacking stat in sun.`,
  synonyms: [
    "flower gift",
    "best attacking stat boost",
    "highest stat boost",
    "boost my strongest stat",
    "better offense up",
    "better defense up",
  ],
  examples: [
    "Multiply my higher attacking stat by 1.5 in sun, like Flower Gift",
    "Multiply my higher defensive stat by 1.5 in sun",
  ],
  params: [
    {
      id: "candidates",
      ctorIndex: 0,
      path: "candidates",
      control: "select",
      label: "Which stats to compare (the highest of them is multiplied)",
      editable: true,
      // Read by the legacy gate (the class's own highest-stat loop) and by the effect; no gate binding repeats it yet.
      gateIndependent: true,
      default: "Attack, Sp. Atk",
      options: STAT_SET_OPTIONS,
      codec: statSetCodec,
    },
    {
      id: "multiplier",
      ctorIndex: 1,
      path: "multiplier",
      control: "number",
      min: 0.1,
      max: 4,
      step: 0.05,
      label: "Multiplier (1.5 = half as much again, 2 = double)",
      editable: true,
      gateIndependent: true,
      default: 1.5,
    },
  ],
  conditions: [{ slot: "gate", ctx: "params", removable: true, editable: true }],
  guards: [],
  feasibility: [
    "Only the listed stats can be multiplied, never Accuracy or Evasion",
    "The highest stat is picked by the real stat value right now, before stat stages; when two are equal the one listed first wins (Attack before Sp. Atk)",
  ],
  effect: { id: "effect.multiply-stat", params: ["candidates", "multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "my stats in sun and in clear weather", axes: { weather: ["SUNNY", "NONE"] } }],
  status: "decomposed",
  notes:
    "legacy-closure-pending-request: the gate (highest of the listed stats) has no library atom (request R-B18-23: condition 'the stat being worked out is my highest of {stats}', formula in the header), so its binding is bindLegacyClosure and the 2 attrs are counted undecomposed; the guard part and the effect are typed settings. Users (2 attrs, Flower Gift 122): attr 3 compares Attack and Sp. Atk, attr 4 compares Defense and Sp. Def, both x1.5, both with the attr-level 'in sun' condition (see header, request R-B18-27: the atom field.weather answers for one weather and does not test suppression, `!arena.weather?.isEffectSuppressed() && [SUNNY, HARSH_SUN].includes(weatherType)` needs a list-and-suppression atom). The user abilities were patched by the vanilla rebalance (init-elite-redux-vanilla-rebalance.ts patchFlowerGift), which removes the vanilla StatMultiplierAbAttr and AllyStatMultiplierAbAttr first. Class change (pure move of the old canApply into guards and gate, same clause order). Because the gate is legacy, B18/chunk3.test.ts drives the real class (stat order, ties, Accuracy and Evasion, every listed stat) against an independent oracle. Oddities, not fixed: the highest stat is read with getStat(stat, false) (in-battle stats without stages, items or abilities), so a Choice Scarf or a stat stage never changes which stat is the highest; a tie goes to the first listed stat.",
});
