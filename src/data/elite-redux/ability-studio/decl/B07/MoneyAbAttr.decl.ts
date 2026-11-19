/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 chunk 3 / event effect, Tier B (the "battle was won" gate lives in canApply). See ../PRECEDENTS.md.
//
// "After the battle ends, IF I won, add a bonus to the money that is picked up". The engine asks it from battle-end-phase.ts for every
// Pokemon allowed in battle: `applyAbAttrs("PostBattleAbAttr", { pokemon, victory })`. canApply is now `guards && gate` in the ORIGINAL
// clause order (`!simulated && victory`, no residual, no random draw):
//   1. guards  `!simulated`   feasibility (a preview never pays out).
//   2. gate    `victory`      the CONDITION "the battle was won" (staff may move, replace or remove it). No library atom reads the
//                             victory flag yet, so the gate is bound as a legacy closure and requested as atom battle.won (R-B07-10,
//                             the same gap B06 reported for Pickup, R-B06-19); the binding swaps to the atom once it exists.
//   apply     `currentBattle.moneyScattered += getWaveMoneyAmount(bonusFraction)`: the bonus share of this wave's money value (ER money
//             streak included, 20% for Honey Gather) goes into the pile that `pickUpScatteredMoney` later multiplies (Amulet Coin, Happy
//             Hour, battle end multiplier) and pays out. The share is the constructor argument `bonusFraction` (default 0.2), a setting.
// The class edit is the pure Tier B move of code plus that constructor argument; the default keeps every shipped ability as it was.
import { MoneyAbAttr } from "#abilities/ab-attrs";
import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";

/** The class stores a fraction of the wave's money (0.2); staff read a percent (20). */
const percentOfWaveMoneyCodec: ParamCodec = {
  toCtor: value => Number((Number(value) / 100).toPrecision(12)),
  fromInstance: raw => (typeof raw === "number" ? Number((raw * 100).toPrecision(12)) : undefined),
};

export default defineDecl(MoneyAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-battle",
  label: "Earn bonus prize money after a win",
  summary: params =>
    `After I win a battle, a bonus of ${params.bonus}% of this wave's usual prize money is added to the money picked up. Example: Honey Gather.`,
  synonyms: ["honey gather", "pay day", "extra money", "prize money", "bonus gold", "earn coins", "money after battle"],
  examples: ["Earn some extra prize money after every battle I win, like Honey Gather"],
  params: [
    {
      id: "bonus",
      ctorIndex: 0,
      path: "bonusFraction",
      control: "number",
      label: "Bonus prize money (% of this wave's usual prize money)",
      editable: true,
      gateIndependent: true,
      default: 20,
      min: 0,
      max: 500,
      step: 1,
      codec: percentOfWaveMoneyCodec,
    },
  ],
  conditions: [{ slot: "gate", ctx: "params", removable: true, editable: true }],
  guards: [],
  feasibility: [
    "Does nothing in a simulated preview",
    "The bonus joins the money picked up after the battle, so Amulet Coin and Happy Hour still multiply it",
  ],
  // No library effect says "earn bonus money"; request R-B07-9 (effect.earn-money).
  effect: { id: "effect.package", params: ["bonus"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "the end of a won battle and the end of a lost one", axes: {} }],
  l2StaticReason:
    "The WHEN event.after-battle is not reached by any scenario template of the shared battle twin (the decomp-l2-reach fixture lists it as unreached), so the engine site is driven directly in test/tests/elite-redux/decomp/B07/flag-sites-3.test.ts: dispatch PostBattleAbAttr with victory true, false and simulated, for the original, the rebuilt attr and a control.",
  status: "decomposed",
  notes:
    "Tier B (review fix): the victory clause is split out as the gate, bound as a legacy closure until atom battle.won exists, and the 20% is the editable setting `bonus` (constructor argument, default 0.2). User (live dump): Honey Gather (118, attr 0), showAbility true (fixed to true in the constructor); the ability is also marked unsuppressable. Every Pokemon allowed in battle is asked at the end of a battle, so two Honey Gather holders in the party each add the bonus. The same sum is added by Pay Day's move effect in move.ts (`moneyScattered += getWaveMoneyAmount(0.2)`), which is a move effect and not this class.",
});
