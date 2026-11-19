/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 1. "Sometimes disable the move an attacker just used when it touches me" (Cursed Body).
//
// Tier B with a random draw. The whole rule is the gate, in the ORIGINAL clause order:
//   1. the attacker is not already disabled: attacker.getTag(DISABLED) == null
//   2. the move makes contact: move.doesFlagEffectApply MAKES_CONTACT
//   3. the chance roll: chance === -1 || holder.randBattleSeedInt(100) < chance      <- the ONLY random draw
// The draw sits last, so a non-contact hit or an already disabled attacker draws nothing. There is no residual and
// `apply` (skipped when simulated) draws nothing: it adds the DISABLED countdown (4 turns, source = the holder) to the
// attacker, and the tag itself disables the attacker's last non-virtual move.
import { PostDefendMoveDisableAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostDefendMoveDisableAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Sometimes disable the move of an attacker that touches me",
  summary: params =>
    `${params.chance}% chance that an attacker that makes contact cannot use the move it last used for a few turns. Example: 30 = 3 times in 10.`,
  synonyms: ["cursed body", "disable on contact", "lock a move", "seal the last move", "move lock", "contact disable"],
  examples: ["30% chance to disable the move of an attacker that makes contact, like Cursed Body"],
  params: [
    {
      id: "chance",
      ctorIndex: 0,
      path: "chance",
      control: "slider",
      min: 1,
      max: 100,
      step: 1,
      integer: true,
      label: "Chance (%)",
      editable: true,
      default: 30,
    },
  ],
  gateParams: [{ param: "chance", block: "rng.chance", field: "pct" }],
  conditions: [
    // The gate is the group [not tag.has other DISABLED, move.flag MAKES_CONTACT, rng.chance], in that order.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["The attacker must have used a move before (there has to be a move to disable)"],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "canApply",
    rngOrder: [
      "canApply gate: the chance roll, only after the not-disabled and contact checks passed (skipped when the chance is -1)",
    ],
    state: "none",
    simulated: "ignores",
  },
  probes: [
    {
      // A contact and a non-contact hit: the chance roll must only be drawn for the contact one.
      name: "contact and non-contact hit",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B with RNG in canApply (same shape as the precedent PostDefendContactApplyStatusEffectAbAttr, but with one draw and no prepare). One user, Cursed Body (130) at 30%. The class ignores `simulated` in canApply (it draws even for a simulated call, whereas the library atom rng.chance answers true without a draw when simulated); no engine path calls PostDefend attrs simulated today. chance -1 (always, no roll) is a sentinel no user passes; the slider starts at 1. Feasibility is not in the class: the DisabledTag's onAdd silently does nothing when the attacker has no last move or its last move was Struggle, but addTag still adds the tag (existing behaviour, not changed). The DO (add the DISABLED countdown with the holder as source) has no library effect that takes a turn count yet: effect.package, request B02-6. `apply` passes moveId 0 to addTag, which the tag ignores.",
});
