/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06, Tier C event-effect with a one-piece effect. See ../PRECEDENTS.md.
//
// "At the end of every turn, raise one random stat by 2 stages and lower a different random stat by 1" (Moody). The class has
// no `canApply` (always true: the ability pops up every turn even when nothing can change), no constructor argument and no
// closure. Clauses of `apply`, in order (a simulated call returns first):
//   1. `canRaise` = every stat of EFFECTIVE_STATS (Attack, Defense, Sp. Atk, Sp. Def, Speed) whose stage is below +6;
//      `canLower` = every one above -6.
//   2. if `canRaise` is not empty: RNG draw 1 `randBattleSeedInt(canRaise.length)` picks the raised stat, that stat leaves
//      `canLower`, and a StatStageChangePhase of +raise (default 2) is queued.
//   3. if `canLower` is not empty: RNG draw 2 `randBattleSeedInt(canLower.length)` picks the lowered stat and a phase of -lower (default 1)
//      is queued. (Accuracy and Evasion are never touched: EFFECTIVE_STATS has only the five battle stats.)
import { MoodyAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(MoodyAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.end-of-turn",
  label: "Raise one random stat and lower another each turn",
  summary: params =>
    `At the end of every turn, one random stat goes up by ${params.raise} stages and a different random stat goes down by ${params.lower}. Stats already at +6 or -6 are skipped.`,
  synonyms: [
    "mood swings",
    "random stat change",
    "stat roulette",
    "random boost and drop",
    "unpredictable stats",
    "random stat each turn",
  ],
  examples: ["Each turn one random stat rises by 2 and another falls by 1, like a moody Pokemon"],
  params: [
    {
      id: "raise",
      ctorIndex: 0,
      path: "raise",
      control: "number",
      min: 1,
      max: 6,
      step: 1,
      label: "Stages the raised stat goes up by",
      editable: true,
      default: 2,
    },
    {
      id: "lower",
      ctorIndex: 1,
      path: "lower",
      control: "number",
      min: 1,
      max: 6,
      step: 1,
      label: "Stages the lowered stat goes down by",
      editable: true,
      default: 1,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "A stat at +6 cannot be raised and a stat at -6 cannot be lowered; if none can be raised only the drop happens, and the other way round",
    "The lowered stat is never the one that was just raised",
    "Does nothing in a simulated preview",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "apply",
    rngOrder: [
      "apply: randBattleSeedInt picks the raised stat (only when some stat can be raised)",
      "apply: randBattleSeedInt picks the lowered stat among the rest (only when some stat can be lowered)",
    ],
    state: "none",
    simulated: "respects",
  },
  probes: [
    {
      name: "a stat at its +6 or -6 limit",
      axes: { stage: ["ATK:+6", "ATK:-6", "SPD:+6", "SPD:-6"] },
    },
  ],
  status: "decomposed",
  notes:
    "PACKAGE for the effect only. Why it cannot be split with today's blocks: effect.stat-stage raises or lowers ONE named stat by a fixed amount, while Moody chooses its stats at random, removes capped stats from the choices and removes the raised stat from the lowering choices, with the two random draws in a fixed order that the battle's seeded stream depends on. Re-creating it from two stat-stage blocks would change the random draws. The trigger is separate and Moody has no condition. Request R-B06-2 asks for a stat choice 'a random stat' on effect.stat-stage (with 'not the one just raised'), so the package can retire. The two amounts are now constructor settings (raise = 2, lower = 1, defaults identical to the old literals, so every existing user is unchanged). The pool of stats (the five battle stats, never Accuracy or Evasion) stays fixed inside the package: it is the definition of the random choice, not a setting. Only user: Moody (141, attr 0). Oddity, not fixed: with every stat at +6 and -6 impossible no change happens but the ability popup still shows, because canApply is always true. Also: `apply` is guarded twice for `simulated` (an early return, then an `if (!simulated)` that is always true).",
});
