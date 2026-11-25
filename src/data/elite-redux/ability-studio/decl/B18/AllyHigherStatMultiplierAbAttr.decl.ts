/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B18 chunk 3, Tier B calc-modifier. "While the game works out one of my ALLY's stats, IF it is the ally's highest of the listed
// stats, DO multiply it by <multiplier>."
//
// Source: ability-upgrades/attrs/requested-combat-riders.ts, a subclass of AllyStatMultiplierAbAttr (constructor `(candidates,
// multiplier)`, it passes `candidates[0]`, the multiplier and the default `ignorable` true to the parent; canApply is overridden without
// super, so the parent's `ignorable` is not read and abilities being ignored ALWAYS switches it off). Dispatched from
// Pokemon.getEffectiveStat (and the accuracy calculation) for every ally of the Pokemon whose stat is calculated: the HOLDER of this
// ability is the ally, `target` is the Pokemon that receives the boost.
//   canApply, in the ORIGINAL clause order (now guards && gate, every clause a pure read, no draw):
//     guard   abilities are being ignored (Mold Breaker style), or Accuracy or Evasion, or not one of the listed stats
//                                                                                    -> safety rule + WHICH stats the boost may touch
//     gate    stat === the listed stat with the highest `target.getStat(stat, false)` (strict `>`, a tie goes to the first listed)
//                                                                                    -> condition WITHOUT a library atom yet (request R-B18-23)
//   apply     inherited `statVal.value *= multiplier`. No random draw, no state, `simulated` is not read.
// Same shape as HigherStatMultiplierAbAttr, but the stat that is compared belongs to the receiving ally (`target`), not to the holder.
// NOT PART OF THIS CLASS: Flower Gift gives each attr an attr-level "in sun" condition (see HigherStatMultiplierAbAttr, request R-B18-27).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { AllyHigherStatMultiplierAbAttr } from "#data/elite-redux/ability-upgrades/attrs/requested-combat-riders";
import { STAT_SET_OPTIONS, statSetCodec } from "./b18-chunk3-codecs";

export default defineDecl(AllyHigherStatMultiplierAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.stat-value",
  label: "Multiply the best of my ally's chosen stats",
  summary: params =>
    `While my ally's stats are worked out, the ally's highest of ${params.candidates} is multiplied by ${params.multiplier}, if the conditions hold. Example: x1.5 to the ally's better attack in sun.`,
  synonyms: [
    "flower gift for allies",
    "ally best stat boost",
    "boost my partner's strongest stat",
    "partner offense up",
    "partner defense up",
    "team stat boost",
  ],
  examples: [
    "Multiply my ally's higher attacking stat by 1.5 in sun, like Flower Gift",
    "Multiply my ally's higher defensive stat by 1.5 in sun",
  ],
  params: [
    {
      id: "candidates",
      ctorIndex: 0,
      path: "candidates",
      control: "select",
      label: "Which of my ally's stats to compare (the highest of them is multiplied)",
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
    "Switched off when the attacker ignores my ability (Mold Breaker style)",
    "Only the listed stats can be multiplied, never Accuracy or Evasion",
    "The highest stat is picked by the ally's real stat value right now, before stat stages; when two are equal the one listed first wins",
  ],
  effect: { id: "effect.multiply-stat", params: ["candidates", "multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "my ally's stats in sun and in clear weather", axes: { weather: ["SUNNY", "NONE"] } }],
  status: "decomposed",
  notes:
    "legacy-closure-pending-request: the gate (the receiving ally's highest of the listed stats) has no library atom (request R-B18-23, 'who' of the compared Pokemon must be selectable: me or my ally), so its binding is bindLegacyClosure and the 2 attrs are counted undecomposed; the guard part and the effect are typed settings. Users (2 attrs, Flower Gift 122): attr 5 compares Attack and Sp. Atk, attr 6 compares Defense and Sp. Def, both x1.5, both with the attr-level 'in sun' condition (request R-B18-27). Class change (pure move of the old canApply into guards and gate, same clause order). The WHEN calc.stat-value lists AllyStatMultiplierAbAttr as an extra dispatch key; its frame holds the ally as holder and has no slot for the receiving Pokemon (`target`), which is why the gate cannot be an atom yet (request R-B18-23). B18/chunk3.test.ts drives the real class through the real ally dispatch against an independent oracle. Oddities, not fixed: (a) the class never reads the parent's `ignorable` flag, abilities being ignored always switches it off; (b) the highest stat is read with getStat(stat, false) of the receiving ally (no stages, items or abilities); (c) with both allies holding Flower Gift, both boosts multiply.",
});
