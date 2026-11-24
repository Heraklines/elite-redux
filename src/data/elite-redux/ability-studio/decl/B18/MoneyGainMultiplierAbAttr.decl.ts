/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Good as Gold (Tier C, marker). "While this Pokemon is on the field when a battle ends, the prize money is multiplied".
//
// Source: ability-upgrades/attrs/meta-markers.ts (constructor: multiplier > 0; `erMetaKind` "money-gain-multiplier").
// Nothing is dispatched. BattleEndPhase calls `snapshotBattleMoneyGainMultiplier()` (phases/battle-end-phase.ts:236), which
// multiplies `getMultiplier()` of every attr of every NON-FAINTED Pokemon on the player's active field (`activePlayerField`) whose
// `getCondition()` is null or true, and stores the product on the battle; MoneyRewardPhase then multiplies the money by that
// stored value (`getCapturedBattleMoneyGainMultiplier`, phases/money-reward-phase.ts:38). A reward outside a battle end gets x1.
import { MoneyGainMultiplierAbAttr } from "#data/elite-redux/ability-upgrades/attrs/meta-markers";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(MoneyGainMultiplierAbAttr, {
  tier: "C",
  kind: "while-active",
  when: "while.active",
  label: "Earn more (or less) prize money after battles",
  summary: params =>
    `If I am on the field when a battle ends, the prize money is multiplied by ${params.multiplier}. Example: 1.2 means 20% more money.`,
  synonyms: ["good as gold", "more money", "prize money boost", "pay day", "gold", "cash bonus", "amulet coin"],
  examples: ["Win 20% more prize money when I am out at the end of the fight, like Good as Gold"],
  params: [
    {
      id: "multiplier",
      ctorIndex: 0,
      path: "multiplier",
      control: "number",
      min: 0.1,
      max: 5,
      step: 0.05,
      label: "Prize money multiplier (1.2 = 20% more)",
      editable: true,
      gateIndependent: true,
      default: 1.2,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "I must be on the player's field and not fainted when the battle ends",
    "The bonuses of every Pokemon on the field multiply together",
  ],
  effect: { id: "effect.package", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [{ name: "a plain battle with the marker on the holder", axes: {} }],
  l2StaticReason:
    "The marker is never dispatched; the battle-end phase reads it by name (snapshotBattleMoneyGainMultiplier), which the quiet-turn scenarios never reach. B18/meta-markers.test.ts calls the live reader with the holder on the field, fainted and with a staff-added condition.",
  status: "decomposed",
  notes:
    "PACKAGE (marker), justified: no behaviour in the class (base no-ops, showAbility false); a number the battle-end phase asks for by name. The library has no effect that scales prize money, so the effect is the package and the request is R-B18-7 (effect 'Multiply prize money'). An attr-level condition ANDed by staff is honoured by the reader (getCondition), so `if` is true. The product is captured at battle end (erBattleEndMoneyMultiplier), so a Pokemon that faints or leaves afterwards still counts. Users: Good as Gold (283, attr 1), x1.2.",
});
