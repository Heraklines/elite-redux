/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { MetallosisPoisonAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
// B17 / Metallosis (its other half, the 1.5x critical damage, is CritDamageMultiplierAbAttr, another batch).
// Read by hand: fakemon-pitch-mechanics.ts `MetallosisPoisonAbAttr`, its base PostAttackAbAttr (ab-attrs.ts:2196).
//
// canApply, clause by clause. Original order: attackCondition, damage > 0, critical, canSetStatus. The split is
// `guards && gate && residual`; moving `damage > 0` in front of the attackCondition is safe because both are pure reads.
//   1. guard        damage > 0: the hit really dealt damage                                    -> `guards`
//   2. condition    the move deals damage: PostAttackAbAttr's default attackCondition,
//                   `move.category !== STATUS`                                                 -> `gate`, atom move.damaging
//   3. condition    the target took a critical hit: `opponent.turnData.attacksReceived[0]?.critical`
//                   ([0] is the newest record: move-effect-phase.ts:989 unshifts)               -> `gate`, NO ATOM (request R5)
//   4. feasibility  opponent.canSetStatus(status, true, false, holder)                         -> `residual`
//   apply: opponent.trySetStatus(status, holder), unless simulated. No random draw.
// Clauses 2 and 3 are one gate slot, so a missing atom for clause 3 makes the whole gate a legacy-closure
// (legacy-closure-pending-request), even though clause 2 alone maps to move.damaging.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { StatusEffect } from "#enums/status-effect";

export default defineDecl(MetallosisPoisonAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Give the target a status",
  summary: params =>
    `After my attack hits, the target gets this status if it can take it: ${params.status}. As built, only after a critical hit.`,
  synonyms: [
    "metallosis",
    "poison on crit",
    "crit status",
    "critical hit poison",
    "status on critical hit",
    "inflict status",
  ],
  examples: ["Poison the target after landing a critical hit", "Burn the target after a critical hit"],
  params: [
    {
      id: "status",
      ctorIndex: 0,
      path: "status",
      control: "select",
      label: "Status to give the target",
      editable: true,
      gateIndependent: true,
      default: "POISON",
      options: ["POISON", "TOXIC", "PARALYSIS", "SLEEP", "FREEZE", "BURN"],
      codec: enumCodec(StatusEffect, "status"),
    },
  ],
  conditions: [
    // The gate: all[move.damaging, <critical hit received>]. The second part has no atom (request R5).
    {
      slot: "gate",
      ctx: "params",
      lib: "move.damaging plus request R5: the hit was a critical hit",
      removable: true,
      editable: true,
    },
  ],
  guards: [],
  feasibility: [
    "The hit must have dealt at least 1 damage",
    "The target must be able to receive the status (it is not immune and nothing blocks it)",
  ],
  effect: { id: "effect.inflict-status", params: ["status"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // A normal hit (no critical, nothing happens) at two target HPs; criticals are driven by the L1 grid.
      name: "ordinary hit on a healthy and a weakened target",
      axes: { foeHp: ["max", "50%"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B. The status is a typed select (the six real statuses; the class would also accept NONE or FAINT, which make no sense as a 'give status' setting, so they are not offered). The gate is legacy-closure-pending-request R5 ('the hit was a critical hit': opponent.turnData.attacksReceived[0]?.critical); until it exists the attr cannot be rebuilt from the library. The `damage > 0` guard has no registry id (request R6), so it is written as feasibility. The inherited attackCondition (the move deals damage) maps to move.damaging, but it shares the gate slot with the critical-hit test. Users: Metallosis (6049, attr 1) only; its attr 0 is CritDamageMultiplierAbAttr. No game bug found. Oddity: clause order moved (damage > 0 before the damaging-move test), both pure reads, no behaviour change.",
});
