/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 4. "When my attack lands, sometimes give the foe a status" (Toxic Chain, Komodo).
//
// Source: src/data/abilities/ab-attrs.ts PostAttackApplyStatusEffectAbAttr, a PostAttackAbAttr dispatched from
// MoveEffectPhase.applyMoveEffects (move-effect-phase.ts:1121) after every hit with `{ pokemon: user, opponent: target, move,
// hitResult, damage, useMode }` (never simulated). Tier B. canApply is now guards && gate && residual:
//
//   original clause                                                        now
//   1 super.canApply: attackCondition (move.category !== STATUS)           gate    (condition: the move deals damage)
//   2 simulated || (                                                       -       (a simulated call skips 3 to 6)
//   3   !opponent.hasAbilityWithAttr("IgnoreMoveEffectsAbAttr")            guards  (safety rule: Shield Dust style)
//   4   && pokemon !== opponent                                            guards  (safety rule: not myself)
//   5   && (!contactRequired || move.doesFlagEffectApply(MAKES_CONTACT))   gate    (condition, only when contactRequired)
//   6   && pokemon.randBattleSeedInt(100) < chance )                       gate    RANDOM DRAW 1 (the chance roll)
//   7 effect = effects.length === 1 ? effects[0] : effects[randBattleSeedInt(n)]   residual RANDOM DRAW 2 (several statuses only)
//   8 return simulated || opponent.canSetStatus(effect, true, false, pokemon)       residual (feasibility)
//   apply: draws AGAIN to pick its own status (several statuses only), then opponent.trySetStatus(effect, pokemon).
//
// Clauses 3 and 4 moved in front of clause 1. All three are pure (no draw, no side effect) and a failing one returns false
// either way, so the result and the random draws are identical; they are guards because dropping them is a bug, not a design.
// The base class takes `contactRequired` as constructor argument 0. Both users pass false, so the block fixes it to false and the
// contact test is an IF staff can add (the move has the "makes contact" property); the sibling declaration for the contact
// class binds it as part of its gate.
import { PostAttackApplyStatusEffectAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumListCodec, enumOptions } from "#data/elite-redux/ability-studio/param-codecs";
import { StatusEffect } from "#enums/status-effect";

export default defineDecl(PostAttackApplyStatusEffectAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Sometimes give the foe a status when my attack lands",
  summary: params =>
    `After my damaging move hits, ${params.chance}% chance to give the foe ${params.statuses}. With several statuses one is picked at random. Foes that block extra effects are not affected.`,
  synonyms: [
    "toxic chain",
    "komodo",
    "poison chance on hit",
    "status on attack",
    "inflict status when I hit",
    "burn chance",
    "paralyze chance",
    "offensive status",
  ],
  examples: ["30% chance to badly poison the foe when my attack lands, like Toxic Chain"],
  params: [
    {
      id: "chance",
      ctorIndex: 1,
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
    {
      id: "statuses",
      ctorIndex: 2,
      path: "effects",
      control: "text",
      label: "Statuses (comma separated; one is picked at random when there are several)",
      editable: true,
      gateIndependent: true,
      default: "POISON",
      options: enumOptions(StatusEffect),
      codec: enumListCodec(StatusEffect, "status"),
      spread: true,
    },
  ],
  // Constructor argument 0 (the contact test) is fixed to "no contact needed" for this block; see the header.
  fixedCtorArgs: { 0: false },
  gateParams: [{ param: "chance", block: "rng.chance", field: "pct" }],
  conditions: [
    // The gate is the group [move.damaging, rng.chance pct], in that order (a contact IF goes between them).
    { slot: "gate", ctx: "params", lib: "move.damaging", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The foe must not have an ability that blocks the extra effects of moves (like Shield Dust)",
    "The foe must not be myself",
    "The foe must be able to receive the status (it is not immune and nothing blocks it)",
  ],
  effect: { id: "effect.inflict-status", params: ["statuses"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "both",
    rngOrder: [
      "canApply gate: the chance roll, only after the damaging-move test (and the contact test when required) passed",
      "canApply residual: pick a status (only with several statuses)",
      "apply: pick the status that is applied (only with several statuses; independent of the second pick)",
    ],
    state: "none",
    simulated: "respects",
  },
  probes: [
    {
      name: "the foe is hit by a damaging move",
      axes: { foeMove: ["TACKLE", "WATER_GUN"], status: ["NONE", "BURN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B. Two users with the same signature (30%, one status, no contact needed): Toxic Chain (302, attr 0, TOXIC) and Komodo (5552, attr 3, POISON). Both have the default attack condition (the move is not a status move), which is the `attackCondition` field of the base class, not a constructor argument, so there is no closure to bind: the gate bindings are [the move deals damage, 30% chance]. The sibling PostAttackContactApplyStatusEffectAbAttr (10 users) inherits canApply and has its own declaration. RNG: draw 1 (chance) happens in the gate, draws 2 and 3 only with several statuses (no user has several; the rebuild keeps the order, proved in test/tests/elite-redux/decomp/B02/stat-and-status.test.ts). SIMULATED: the class returns true for clauses 3 to 6 when simulated and draws the status pick before `simulated ||`; the rebuilt gate evaluates every atom, even for a simulated call. The only dispatch (move-effect-phase.ts:1121) is never simulated, so no engine path sees the difference. QUIRK, not changed: `rng.chance` with 100 skips the draw (the class always draws), no user passes 100. The status the residual checks (`canSetStatus`) and the one `apply` applies are two independent draws when there are several statuses.",
});
