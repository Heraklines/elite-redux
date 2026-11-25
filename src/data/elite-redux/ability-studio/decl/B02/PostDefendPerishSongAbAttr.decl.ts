/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 1. "When a contact move hits me, the attacker and I both get the Perish Song countdown" (Perish Body).
//
// Tier B. canApply is now `gate && residual`, in the ORIGINAL clause order:
//   gate      the move makes contact (move.doesFlagEffectApply MAKES_CONTACT)
//   residual  the attacker does not already carry the Perish Song countdown (feasibility)
// No random draw. `apply` (skipped when simulated) adds the PERISH_SONG countdown to the attacker and then to the holder.
import { PostDefendPerishSongAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostDefendPerishSongAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Start a Perish Song countdown when a move touches me",
  summary: params =>
    `When a contact move hits me, the attacker and I both start a Perish Song countdown of ${params.turns}. Example: 4 = the same as the move.`,
  synonyms: [
    "perish body",
    "perish song",
    "doom countdown",
    "faint in three turns",
    "fainting countdown",
    "contact curse",
  ],
  examples: ["Both Pokemon get the fainting countdown when a contact move hits me, like Perish Body"],
  params: [
    {
      id: "turns",
      ctorIndex: 0,
      path: "turns",
      control: "number",
      min: 1,
      max: 10,
      step: 1,
      integer: true,
      label: "Countdown length (4 = the same as the move Perish Song)",
      editable: true,
      gateIndependent: true,
      default: 4,
    },
  ],
  conditions: [{ slot: "gate", ctx: "params", lib: "move.flag", removable: true, editable: true }],
  guards: [],
  feasibility: ["The attacker must not already be counting down to Perish Song"],
  effect: { id: "effect.package", params: ["turns"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "contact and non-contact hit", axes: { foeMove: ["TACKLE", "WATER_GUN"] } }],
  status: "decomposed",
  notes:
    "Tier B, one user (Perish Body) with turns 4, the same value the move Perish Song uses (move.ts:11835). The DO puts the countdown on BOTH Pokemon (attacker first, holder second); no library effect gives a countdown to two targets yet, so it is effect.package (request B02-3). The 'attacker already has it' test is kept as the residual (feasibility): it is a stacking rule, not a design choice players know. Quirk, not changed: the holder is never checked for the countdown, so if the holder already has it, addTag runs for it again.",
});
