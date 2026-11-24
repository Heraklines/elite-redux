/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06 chunk 4, Tier A calc-modifier with a one-piece effect. See ../PRECEDENTS.md.
//
// "While the game counts how long my status lasts, take one extra turn off EVERY time it counts" (Early Bird). Two constructor values (the status and the turns, default 1), no closure.
//   canApply  `statusEffect === this.statusEffect`: the asked status is the one set on the class. This IS the setting, not a rule
//             staff would add or remove, so it is a param.
//   apply     `duration.value -= this.turns` (turns is a second constructor argument, default 1, added so the number is a setting; every user passes none).
// The only caller is the sleep check in move-phase.ts (after `status.incrementTurn()`): the remaining sleep turns go in, the ability
// takes one off, WRITES the result back, and the Pokemon wakes when it is 0 or less. So the counter loses 2 per turn instead of 1 (a 4 turn sleep ends on the 2nd turn). No other status ever asks, so any other value of the setting does
// nothing today.
import { ReduceStatusEffectDurationAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { StatusEffect } from "#enums/status-effect";

export default defineDecl(ReduceStatusEffectDurationAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.status-duration",
  label: "Wake up from sleep faster",
  summary: params =>
    `Each turn I try to move while I am asleep, my sleep counts down ${params.turns} extra ${Number(params.turns) === 1 ? "turn" : "turns"}, so I wake up much sooner. Example: Early Bird (1 extra turn).`,
  synonyms: [
    "early bird",
    "wake up sooner",
    "shorter sleep",
    "sleep less",
    "faster wake up",
    "rest less",
    "sleep counts down faster",
  ],
  examples: ["Wake up from sleep about twice as fast, like Early Bird"],
  params: [
    {
      id: "status",
      ctorIndex: 0,
      path: "statusEffect",
      control: "select",
      label: "Status that counts down faster (only Sleep has a counter the game asks about)",
      editable: false,
      default: "SLEEP",
      // The game only asks about sleep (the one status with a turn counter that an ability can shorten).
      options: ["SLEEP"],
      codec: enumCodec(StatusEffect, "status"),
    },
    {
      id: "turns",
      ctorIndex: 1,
      path: "turns",
      control: "number",
      min: 1,
      max: 10,
      step: 1,
      integer: true,
      label: "Extra turns taken off each turn I try to move",
      editable: true,
      default: 1,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only the sleep counter is ever asked, when I try to move while asleep",
    "The turns left go down by one extra every turn I try to move, so the sleep lasts about half as long (a 4 turn sleep ends on the second turn)",
  ],
  effect: { id: "effect.package", params: ["turns"] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  l2StaticReason:
    "The attr is asked only while a sleeping Pokemon tries to move (MovePhase sleep check), which no shared L2 scenario reaches, so test/tests/elite-redux/decomp/B06/b06-chunk4.test.ts drives the real attr and its rebuild with a duration holder.",
  probes: [{ name: "a foe inflicts a status on me", axes: { status: ["NONE"] } }],
  status: "decomposed",
  notes:
    "PACKAGE for the effect, written reason: no library effect changes how many turns a status lasts (request R-B06-23: effect.change-status-duration with a turns setting, and a status atom for the WHEN's `status` slot). The status test is the class's setting (`status`), not an IF. Review fix: the amount used to be a literal `1`; it is now the constructor argument `turns` (default 1, a pure addition, Early Bird passes none so behaviour is identical) and a setting of the package. The status setting is not editable: only Sleep is ever asked. Verified in a real battle: the shortened counter is written back to the status, so the ability removes one turn EVERY turn it is asked, not once (4 turn sleep: wakes on turn 2, without the ability on turn 4); the label says so. User (1 attr): Early Bird (48, attr 0, Sleep). The class never reads `simulated`. Oddity, not fixed: Dancer-triggered moves wake a sleeping user at once (move-phase) before this attr is asked.",
});
