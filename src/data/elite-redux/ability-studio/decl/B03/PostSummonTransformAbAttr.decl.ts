/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B03 chunk 4. Tier C package (the core effect only), event-effect on entry, one random draw in canApply, no argument.
//
//   canApply   `targets = user.getOpponents().filter(opp => user.canTransformInto(opp))`; none -> false.
//              Otherwise `mon = targets[user.randBattleSeedInt(targets.length)]` (ONE draw, only when there is more than
//              one eligible foe: a range of 1 or less draws nothing), remembers `this.targetIndex`. It draws even in a
//              simulated call.
//   apply      unshifts a `PokemonTransformPhase(my index, that foe's index, true)`; it does not look at `simulated`
//   `canTransformInto(target)` is false when either of us is already transformed, either of us hides behind an illusion,
//   the foe has a Substitute, or either of us is a fusion.
//
// Not a gain-time ability: the constructor passes `activateOnGain = false`, so it fires on entry only.
// Everything in canApply is feasibility (what Transform cannot do) plus the random pick, which belongs to the effect
// ("transform into a random foe"). There is no condition staff may swap. The WHEN stays a separate block and extra IFs can
// only be ANDed on top (Tier C). Why one piece: the pick (with its RNG draw) and the transform live in two methods that
// share `targetIndex`, and no library effect transforms a Pokemon into another.
import { PostSummonTransformAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostSummonTransformAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.on-entry",
  label: "Transform into a random foe when I enter (like Imposter)",
  summary: () =>
    "When I enter the battle, I transform into a random foe that can be copied: its looks, stats, moves, ability and types. Example: against two foes, one of them is picked at random.",
  synonyms: ["imposter", "ditto", "copy the foe", "become the opponent", "transform on entry", "clone foe"],
  examples: ["Transform into a random opposing Pokemon when I enter, like Imposter"],
  params: [],
  noParamsReason:
    "The class takes no arguments: the foe is always picked at random among the foes Transform can copy. There is no number, stat, type or status for staff to set.",
  conditions: [],
  guards: [],
  feasibility: [
    "At least one foe must be copiable: neither of us may be transformed already, neither of us may hide behind an illusion, the foe may not have a Substitute, and neither of us may be a fusion",
    "It only works when I enter the battle, not when I gain the ability in the middle of a battle",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: false },
  flags: {
    rng: "canApply",
    rngOrder: [
      "canApply: pick one of the copiable foes with the battle random numbers (a draw only when there are two or more copiable foes; also drawn in a simulated call)",
    ],
    state: "entry",
    simulated: "ignores",
  },
  probes: [{ name: "entry against the default foe", axes: {} }],
  status: "decomposed",
  notes:
    "Package, justified above: Tier C, 1 attr of 1 ability, no closure: Imposter (150 attr 0). Library gaps (requests/B03.md): `effect.transform-into-foe` (transform into a foe, choice: random copiable foe), the guard `can-transform-into-foe` (the five Transform restrictions, non-removable: removing it would crash the transform phase on a fusion or an illusion) and, for the pick, the choice param. Quirks recorded, not fixed: (1) `apply` ignores `simulated`, so a simulated entry would still queue the transform phase; (2) `canApply` draws its random number even in a simulated call; (3) `getOpponents()` is asked without an `isActive` filter, while `canTransformInto` does not check that the foe is alive; (4) the field `targetIndex` is written by `canApply` and read by `apply`, so two `canApply` calls before one `apply` would use the last pick (fine while dispatch is sequential). Behaviour is proven by test/tests/elite-redux/decomp/B03/chunk4.test.ts.",
});
