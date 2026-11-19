/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PRECEDENT: Tier B (gate inside canApply), spec 3.3. See ../PRECEDENTS.md. This is the "switch out below
// 35% HP" golden recipe (Wimp Out and Emergency Exit, but with `hpRatio` 0.35 and no new code).
//
// canApply is now `guards && prepare && gate && residual`, in the original clause order:
//   1. guards (locked "Safety rule" lines, never toggles): not-own-hp-cost-move, not-already-forced-out,
//      sheer-force-negates, after-final-hit
//   2. prepare: the multi-hit rewrite of the damage (stays in the frame builder, it is not a condition)
//   3. gate: hp.crossed-below { holder, ratio: hpRatio, rounding: exact }  <- the part staff may replace
//   4. residual: a switch must be possible against EVERY opponent (feasibility, stays in the class)
// The class ignores `simulated` today (a TODO in apply), so the declaration records simulated: "ignores".
import { PostDamageForceSwitchAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostDamageForceSwitchAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-taking-damage",
  label: "Switch out when my HP gets low",
  summary: params => `After a hit that takes my HP below ${Math.round(Number(params.hpRatio) * 100)}%, I switch out`,
  synonyms: ["wimp out", "emergency exit", "eject", "retreat", "pivot out", "flee at low hp"],
  examples: ["Switch out when HP drops below 35%", "Switch out below half HP"],
  params: [
    {
      id: "hpRatio",
      ctorIndex: 0,
      path: "hpRatio",
      control: "slider",
      min: 0.01,
      max: 0.99,
      step: 0.01,
      label: "Max HP ratio to drop below",
      editable: true,
      default: 0.5,
    },
  ],
  conditions: [
    // The gate: library atom hp.crossed-below; each user's binding repeats its own hpRatio (bindings.ts).
    { slot: "gate", ctx: "params", lib: "hp.crossed-below", removable: true, editable: true },
  ],
  guards: ["not-own-hp-cost-move", "not-already-forced-out", "sheer-force-negates", "after-final-hit"],
  feasibility: ["A switch must be possible against every opponent (nothing traps me or blocks the switch)"],
  effect: { id: "effect.force-switch-out", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      // Start just above the line (the hit crosses it), well above it, and just below it (no crossing).
      name: "HP around the switch line",
      axes: { hp: ["50%+1", "max", "50%-1", "35%+1"] },
    },
  ],
  status: "verified",
  notes:
    "Precedent for Tier B. The crossing test is the shared free function hpCrossedBelow (Shell Bell term included) and receives the EFFECTIVE damage (a multi-hit move rewrites it to the whole turn's damage in `prepare`). Wimp Out and Emergency Exit use the default 0.5. The ratio lives twice by design: the hpRatio param (the class's own field, used by the default gate) and the ratio of the gate binding (used once staff replace the gate); the L1 attr differential proves they agree for the two users.",
});
