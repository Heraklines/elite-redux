/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 4. "When my contact attack lands, sometimes give the foe a status" (Poison Touch, Flame Body, White Noise ...).
//
// Source: src/data/abilities/ab-attrs.ts PostAttackContactApplyStatusEffectAbAttr, a subclass of
// PostAttackApplyStatusEffectAbAttr whose constructor is `(chance, ...effects)` and calls `super(true, chance, ...effects)`.
// canApply, guards, gate, residual and apply are INHERITED unchanged (see PostAttackApplyStatusEffectAbAttr.decl.ts for the
// clause table): the gate is [the move deals damage, the move makes contact, chance roll] in that order, with the contact test
// `move.doesFlagEffectApply({ flag: MAKES_CONTACT, user: pokemon, target: opponent })` (so a contact-ignoring ability or a
// Substitute counts), and the chance roll is random draw 1. Dispatched from move-effect-phase.ts:1121 after every hit, never
// simulated.
import { PostAttackContactApplyStatusEffectAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumListCodec, enumOptions } from "#data/elite-redux/ability-studio/param-codecs";
import { StatusEffect } from "#enums/status-effect";

export default defineDecl(PostAttackContactApplyStatusEffectAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Sometimes give the foe a status when my contact attack lands",
  summary: params =>
    `After my damaging contact move hits, ${params.chance}% chance to give the foe ${params.statuses}. With several statuses one is picked at random. Foes that block extra effects are not affected.`,
  synonyms: [
    "poison touch",
    "flame body offense",
    "venom crown",
    "toxic touch",
    "status on contact attack",
    "inflict status when I touch",
    "burn chance on contact",
    "paralyze chance on contact",
    "my contact moves poison",
  ],
  examples: ["30% chance to poison the foe when my contact move hits, like Poison Touch"],
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
    {
      id: "statuses",
      ctorIndex: 1,
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
  gateParams: [{ param: "chance", block: "rng.chance", field: "pct" }],
  conditions: [
    // The gate is the group [move.damaging, move.flag MAKES_CONTACT, rng.chance pct], in that order.
    { slot: "gate", ctx: "params", removable: true, editable: true },
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
      "canApply gate: the chance roll, only after the damaging-move and contact tests passed",
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
    "Tier B, inherits the split of PostAttackApplyStatusEffectAbAttr (class edit in ab-attrs.ts). 10 users, all with 30% and one status: Static (9, attr 2, PARALYSIS), Poison Point (38, attr 1), Flame Body (49, attr 2, BURN), Poison Touch (143, attr 0), White Noise (5358, attr 2, PARALYSIS), Venom Crown (5479, attr 1), Blight Scale (5480, attr 2), Poison Quills (5541, attr 2), Toxic Shell (5667, attr 3), Smoldering Wood (5733, attr 4, BURN). The inventory lists the Static id by the name key `static.name`. Every gate is [damaging move, contact, 30% chance]; the attack condition is the base class default (not a constructor argument), so there is no closure to bind. The three random draws and the simulated handling are described in the base declaration; the only dispatch is never simulated. QUIRK, not changed: `rng.chance` with 100 skips the draw (the class always draws); no user passes 100. SUSPECTED BUG, not fixed: with several statuses, the one `canSetStatus` checks and the one `apply` applies are two independent draws, so the status that lands may not be the one that was checked.",
});
