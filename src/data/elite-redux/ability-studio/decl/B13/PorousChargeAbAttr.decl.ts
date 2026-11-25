/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Porous, part 3 of 4 (Tier B, package effect). "When a foe's hit damages me, store one charge (up to 3)."
//
// Source: abilities/newcomer-signature-mechanics.ts, PorousChargeAbAttr (PostDefendAbAttr; the cap is a trailing constructor argument added in the review fix, default 3).
//   canApply, one expression, now the gate (clause order kept):
//     1. damage > 0                                         \  no library atom for any of the three:
//     2. hitResult < HitResult.NO_EFFECT                     |  legacy-closure + requests `hit.dealt-damage`,
//     3. POROUS[holder].lastMoveRecord !== the foe's last     |  `hit.not-blocked`, `time.new-move-of-foe`
//        move record (so a multi-hit move counts once)        /
//   apply (no `simulated` check at all):
//     1. POROUS[holder].lastMoveRecord = the foe's last move record
//     2. POROUS[holder].stacks = min(3, stacks + 1)
//     3. message "... Porous body stored the impact!"
// No RNG. The counter is spent by PorousPowerAbAttr and cleared by PorousResetAbAttr.
import { PorousChargeAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PorousChargeAbAttr, {
  tier: "B",
  kind: "package",
  when: "event.after-hit",
  label: "Store a charge when a foe's hit damages me",
  summary: params =>
    `When a foe's move damages me, I store 1 charge, up to ${params.maxCharges}. A multi-hit move counts once. My next Ground move spends the stored charges for extra power.`,
  synonyms: ["store power", "absorb impact", "charge up when hit", "stack on damage", "counter on hit", "porous"],
  examples: ["Gain 1 stored charge each time a foe's attack damages me, up to 3"],
  params: [
    {
      id: "maxCharges",
      ctorIndex: 0,
      path: "maxCharges",
      control: "number",
      label: "Most charges I can store",
      editable: true,
      gateIndependent: true,
      default: 3,
      min: 1,
      max: 10,
      step: 1,
      integer: true,
    },
  ],
  conditions: [
    // The whole canApply expression. Legacy closure until the librarian adds the three atoms (see bindings.ts).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [],
  effect: { id: "effect.package", params: ["maxCharges"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "ignores" },
  probes: [
    {
      // A damaging hit at full and at 1 HP-ish values decides "damage > 0"; foe moves of different kinds.
      name: "damaging hits of different kinds",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "PACKAGE for the EFFECT only; the trigger (after I am hit) and the gate are separate. Justified: the effect adds 1 to a private per-Pokemon counter capped at 3 and records which foe move was counted, both read and spent by a different attr (PorousPowerAbAttr). The library has no 'charge counter' memory block (requested in requests/B13.md as `effect.store-charge` / `time.charges`), and `effect.arm-effect` has no stack count or cap, so the effect cannot be split without re-implementing the counter. Review fix: the cap (default 3) is now a constructor argument and a param; the once-per-foe-move memory stays inside the package. Users: Porous (5974, attr 2). ODDITY (not fixed): apply has no `simulated` check, so a simulated PostDefend call would add a charge and queue the message; the L1/L2 harness never simulates PostDefend. The ability text says 'direct hit', but canApply tests only damage > 0 and a landed hit.",
});
