/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PRECEDENT: RNG inside canApply (Tier B). See ../PRECEDENTS.md.
//
// Read the class before touching it: it draws random numbers in `canApply` AND in `apply`.
//
//   canApply (the original clause order, now guards && prepare && gate && residual):
//     prepare   draw 1, only with several statuses: which status `canSetStatus` will be asked about
//     gate      the move makes contact  &&  the attacker has no status  &&  draw 2 (the chance roll, skipped when the
//               chance is -1)             <- the chance roll sits AFTER the cheap checks and short-circuits
//     residual  attacker.canSetStatus(thatStatus)
//   apply       draw 3, only with several statuses: picks the status that is really applied. It is an independent
//               draw, so with several statuses the status that lands may differ from the one canApply checked.
//
// The library gate keeps `rng.chance` at the position of draw 2, after `move.flag` and `status.has`. A rebuilt
// attr therefore draws the same numbers in the same order, which is what L2's rngCalls comparison proves.
import { PostDefendContactApplyStatusEffectAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumListCodec, enumOptions } from "#data/elite-redux/ability-studio/param-codecs";
import { StatusEffect } from "#enums/status-effect";

export default defineDecl(PostDefendContactApplyStatusEffectAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Sometimes give the attacker a status when it touches me",
  summary: params => `${params.chance}% chance to give a contact attacker ${params.statuses}`,
  synonyms: ["static", "flame body", "poison point", "contact status", "touch me and suffer", "paralyze on contact"],
  examples: ["30% chance to paralyze attackers that make contact"],
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
      // Names such as POISON,PARALYSIS,SLEEP. The class takes them as rest arguments.
      options: enumOptions(StatusEffect),
      codec: enumListCodec(StatusEffect, "status"),
      spread: true,
    },
  ],
  gateParams: [{ param: "chance", block: "rng.chance", field: "pct" }],
  conditions: [
    // The gate is the group [move.flag MAKES_CONTACT, status.has other NONE, rng.chance pct], in that order.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["The attacker must be able to receive the status (it is not immune and nothing blocks it)"],
  effect: { id: "effect.inflict-status", params: ["statuses"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "both",
    rngOrder: [
      "canApply prepare: pick a status (only with several statuses)",
      "canApply gate: the chance roll, only after the contact and no-status checks passed",
      "apply: pick the status that is applied (only with several statuses; independent of the first pick)",
    ],
    state: "none",
    simulated: "ignores",
  },
  probes: [
    {
      // A contact move and a non-contact move: the chance roll must only be drawn for the contact one.
      name: "contact and non-contact hit",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "verified",
  notes:
    "Precedent for RNG in canApply. The class ignores `simulated`: it draws and rolls even for simulated calls, whereas the library atom rng.chance answers true without a draw when simulated. No engine path calls PostDefend attrs simulated today, and the L1/L2 harness never does, so the two agree on every tested path; a future simulated caller would see the difference (record it, do not fix it here). EffectSporeAbAttr extends this class, overrides canApply and calls super.canApply: it needs its own declaration. `chance` -1 (always, no roll) is a sentinel no user passes; the slider starts at 1.",
});
