/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 4. "While the game works out one stat of my ally, multiply it" (Victory Star's share for the partner).
//
// Source: src/data/abilities/ab-attrs.ts AllyStatMultiplierAbAttr. Dispatched from src/field/pokemon.ts:
//   - getEffectiveStat: `applyAbAttrs("AllyStatMultiplierAbAttr", { pokemon: ally, target: this, stat, statVal, simulated,
//     move, ignoreAbility })` for the ally of the Pokemon whose stat is being read;
//   - getAccuracyMultiplier: the attacker's ally for Accuracy and the target's ally for Evasion.
// So the attr's holder (`pokemon`) is the ABILITY OWNER (the ally) and `target` is the Pokemon whose stat is changed.
// canApply: `stat === this.stat && !(ignoreAbility && this.ignorable)`. Two clauses, no closure:
//   - `stat === this.stat`             the stat param itself, not a condition;
//   - `!(ignoreAbility && ignorable)`  the Mold Breaker rule. `ignorable` is constructor argument 2, so it is a setting
//     ("can an ability-ignoring move switch it off"), not a hidden rule. Victory Star passes false: it always works.
// apply: `statVal.value *= this.multiplier`. No random draw, no state, nothing that reads `simulated`.
import { AllyStatMultiplierAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { STAT_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { Stat } from "#enums/stat";

export default defineDecl(AllyStatMultiplierAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.stat-value",
  label: "Multiply one stat, accuracy or evasion of my ally",
  summary: params =>
    `Whenever the game uses my ally's ${params.stat}, it is multiplied by ${params.multiplier}. Example: 1.2 = 20% higher. Only works in a double battle.`,
  synonyms: [
    "victory star",
    "ally accuracy boost",
    "partner stat boost",
    "help my partner",
    "team accuracy",
    "ally speed up",
    "ally attack up",
  ],
  examples: ["Raise my partner's accuracy by 20%, like Victory Star", "Double my ally's Speed"],
  params: [
    {
      id: "stat",
      ctorIndex: 0,
      path: "stat",
      control: "select",
      label: "Which stat of my ally (Attack, Defense, Sp. Atk, Sp. Def, Speed, Accuracy or Evasion)",
      editable: true,
      default: "ACC",
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
      label: "Stat multiplier (1.2 = 20% higher, 0.5 = half)",
      editable: true,
      default: 1.2,
    },
    {
      id: "canBeIgnored",
      ctorIndex: 2,
      path: "ignorable",
      control: "boolean",
      label: "Mold Breaker style moves and abilities can switch it off",
      editable: true,
      default: true,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [],
  effect: { id: "effect.multiply-stat", params: ["stat", "multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "the partner is hit and attacks",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  l2StaticReason:
    "The class is dispatched for the ALLY of the Pokemon whose stat is read, so the singles scenario of calc.stat-value never evaluates it; test/tests/elite-redux/decomp/B02/stat-and-status.test.ts proves the original and the rebuilt Victory Star in a real double battle instead.",
  status: "decomposed",
  notes:
    "Tier A, nothing to bind (no closure). One user: Victory Star (attr 1, Accuracy x1.2, ignorable false); its attr 0 is a StatMultiplierAbAttr (the owner's own share). The `ignorable` constructor argument is exposed as the setting `canBeIgnored`; the engine passes `ignoreAbility = move.hasFlag(IGNORE_ABILITIES) || ignoreAllyAbility` (pokemon.ts getEffectiveStat) or `hasAbilityWithAttr(MoveAbilityBypassAbAttr) || move.hasFlag(IGNORE_ABILITIES)` (getAccuracyMultiplier). The frame's holder is the ability owner and the stat that changes belongs to `target` (the owner's ally), which the library's multiply-a-stat block cannot name yet: it is read at the same trigger (calc.stat-value) as the owner's own stat, and the class decides by dispatch that it is the ally's. The class never reads `simulated`.",
});
