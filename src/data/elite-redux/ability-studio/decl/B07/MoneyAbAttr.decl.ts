/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 chunk 3 / event effect, Tier C (one-piece effect, nothing to bind). See ../PRECEDENTS.md.
//
// "After the battle ends, IF I won, add a bonus to the money that is picked up". The engine asks it from battle-end-phase.ts for every
// Pokemon allowed in battle: `applyAbAttrs("PostBattleAbAttr", { pokemon, victory })`. Clauses, in the ORIGINAL order (ab-attrs.ts, MoneyAbAttr):
//   canApply  1. `!simulated`   feasibility (a preview never pays out).
//             2. `victory`      CONDITION in spirit (the battle was won). No library atom reads the victory flag, so it is written as
//                               a plain "also requires" line and requested (R-B07-10); the same gap B06 reported for Pickup (R-B06-19).
//   apply     `currentBattle.moneyScattered += getWaveMoneyAmount(0.2)`: a fixed 20% of this wave's money value (ER money streak included)
//             goes into the pile that `pickUpScatteredMoney` later multiplies (Amulet Coin, Happy Hour, battle end multiplier) and pays out.
// There is no random draw, no per-instance state and no constructor argument except the inherited `showAbility`.
import { MoneyAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(MoneyAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.after-battle",
  label: "Earn bonus prize money after a win",
  summary: () =>
    "After I win a battle, a bonus of 20% of this wave's usual prize money is added to the money picked up. Example: Honey Gather.",
  synonyms: ["honey gather", "pay day", "extra money", "prize money", "bonus gold", "earn coins", "money after battle"],
  examples: ["Earn some extra prize money after every battle I win, like Honey Gather"],
  params: [],
  noParamsReason:
    "All or nothing: the 20% of the wave's prize is written into the class and there is no constructor argument to change it. The only constructor argument is showAbility, which is never exposed (fixed to true).",
  conditions: [],
  guards: [],
  feasibility: [
    "Only after the battle was won",
    "Does nothing in a simulated preview",
    "The bonus joins the money picked up after the battle, so Amulet Coin and Happy Hour still multiply it",
  ],
  // No library effect says "earn bonus money"; request R-B07-9 (effect.earn-money).
  effect: { id: "effect.package", params: [] },
  fixedCtorArgs: { 0: true },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "the end of a won battle and the end of a lost one", axes: {} }],
  l2StaticReason:
    "The WHEN event.after-battle is not reached by any scenario template of the shared battle twin (the decomp-l2-reach fixture lists it as unreached), so the engine site is driven directly in test/tests/elite-redux/decomp/B07/flag-sites-3.test.ts: dispatch PostBattleAbAttr with victory true, false and simulated, for the original, the rebuilt attr and a control.",
  status: "decomposed",
  notes:
    "Tier C, one-piece effect. User (live dump): Honey Gather (118, attr 0), showAbility true; the ability is also marked unsuppressable. No closure, so no binding. Every Pokemon allowed in battle is asked at the end of a battle, so two Honey Gather holders in the party each add the bonus. The victory flag is the only clause staff would call a condition; it needs the atom of R-B07-10. The same sum is added by Pay Day's move effect in move.ts (`moneyScattered += getWaveMoneyAmount(0.2)`), which is a move effect and not this class.",
});
