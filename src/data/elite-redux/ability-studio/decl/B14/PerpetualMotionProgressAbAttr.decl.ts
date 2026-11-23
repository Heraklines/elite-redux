/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14. Tier B, one of the five attrs of Perpetual Motion (the other three, the trigger, the end-of-turn launcher and the
// resolver, belong to B17). Together they are a small state machine over two fields of `pokemon.summonData`:
//   erPerpetualMotionPending  a free Rollout has been launched and has not resolved yet
//   erPerpetualMotionStreak   how many free Rollouts in a row landed
//
// canApply is now `gate` only, in the original clause order:
//   gate  1. the move deals damage            (the inherited PostAttackAbAttr.canApply: attackCondition, which is the
//                                              default `move.category !== STATUS` for this user; atom move.damaging)
//         2. the move is this ability's own scripted free follow-up  (a ScriptedMoveMarkerAttr with key "perpetual-motion")
// There are no guards and no residual. Nothing random, nothing simulated here: `apply` returns early when simulated.
//
// apply (the effect), in order:
//   - simulated: nothing
//   - the hit did not hurt (not EFFECTIVE, SUPER_EFFECTIVE, NOT_VERY_EFFECTIVE or ONE_HIT_KO): pending = false, streak = 0
//   - not pending: nothing
//   - otherwise: pending = false, streak += 1
//
// The gate binding is LEGACY: clause 2 has no atom yet (`move.scripted-marker` is requested in requests/B14.md). The
// effect is a package: it is a counter step on state that three other attrs of the same ability read and write, and the
// library has no counter effect (requested). The trigger and the IF are separate blocks.
import { PerpetualMotionProgressAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PerpetualMotionProgressAbAttr, {
  tier: "B",
  kind: "package",
  when: "event.after-my-hit",
  label: "Count free follow-up hits that land in a row",
  summary: () =>
    "After my free follow-up move, I count one more hit in a row if it hurt the target, or reset the count to zero if it did not.",
  synonyms: ["hit streak", "combo counter", "in a row", "consecutive hits", "streak", "perpetual motion"],
  examples: ["Count each free Rollout that lands in a row so the next one hits harder"],
  params: [],
  noParamsReason:
    "Deliberately no setting: the marker name of the follow-up move is the shared key that ties this attr to the follow-up move and to four other attrs of the same ability (three of them in B17), so changing it here alone would break the ability; the condition (the gate) is the editable slot. The count step is always one and the count itself is a battle value, not a setting.",
  conditions: [
    // Gate = [move.damaging, move.scripted-marker{key: "perpetual-motion"}], in that order. Not removable: without
    // the marker test every hit of every move would reset the streak, which breaks the ability.
    { slot: "gate", ctx: "params", removable: false, editable: true },
  ],
  guards: [],
  feasibility: [
    "Only counts a follow-up that is still waiting for its result (the streak is armed); a hit that did not hurt the target resets the streak",
    "Does nothing while the game is only previewing a hit",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "entry", simulated: "respects" },
  probes: [{ name: "the holder attacks", axes: {} }],
  l2StaticReason:
    "The gate binding is a legacy closure (no atom for the scripted-move marker yet), so the twin has no rebuilt attr to compare; the Tier B split is proven by test/tests/elite-redux/decomp/B14/gate-split.test.ts instead.",
  status: "decomposed",
  notes:
    "Package, reason: the effect is one step of a counter state machine (pending flag and streak) shared with PerpetualMotionTriggerAbAttr, PerpetualMotionPostTurnAbAttr, PerpetualMotionResolutionAbAttr (B17) and PerpetualMotionPowerAbAttr; the library has no counter effect (requested). Users (1): Perpetual Motion (6022) attr 3 of 5. Gate is legacy-closure pending the request move.scripted-marker. Oddities, not fixed: the inherited attackCondition (`move.category !== STATUS`, constructor argument 0) is not exposed as its own slot; for this user it is always the default, and the gate re-states it as move.damaging. The streak is stored on summonData, so it resets when the Pokemon leaves the field.",
});
