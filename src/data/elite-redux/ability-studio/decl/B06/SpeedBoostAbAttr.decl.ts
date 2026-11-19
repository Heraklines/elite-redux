/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06, Tier B event-effect. See ../PRECEDENTS.md.
//
// "At the end of every turn, raise my Speed by 1 stage, unless I only just switched in or I failed to run away" (Speed Boost,
// Max Acceleration). Clauses, in the ORIGINAL order (ab-attrs.ts, SpeedBoostAbAttr; `canApply` is now just the gate):
//   1. gate   `simulated || (!pokemon.turnData.switchedInThisTurn && !pokemon.turnData.failedRunAway)`. The `simulated ||`
//             short-circuit comes first (a preview always passes); then "I did not switch in this turn" and "I did not fail
//             to run away this turn" are the two real conditions staff reasonably change.
//   effect-side `apply`: queues a StatStageChangePhase for Speed +1 (the +1 and the stat are literals in the class).
// Neither condition has a library atom yet (requests/B06.md R-B06-7), so both users are bound as legacy-closure on the gate
// slot. The slot is already separate: staff can replace it with any IF tree, or remove it (for example to boost on the turn I
// switched in); it is the original clause that is not in the library.
import { SpeedBoostAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(SpeedBoostAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.end-of-turn",
  label: "Raise Speed by 1 stage every turn",
  summary: () =>
    "At the end of every turn, my Speed goes up by 1 stage. Example: Speed Boost. It does not trigger on the turn I switched in or after I failed to run away.",
  synonyms: ["speed boost", "speed up each turn", "get faster", "max acceleration", "turn end speed", "gradual speed"],
  examples: ["Raise Speed by 1 stage at the end of every turn, like Speed Boost"],
  params: [],
  noParamsReason:
    "The stat (Speed) and the amount (+1) are literals inside the class, not constructor arguments, so there is nothing to set without changing the constructor, which class agents may not do (request R-B06-2 asks for them as settings).",
  conditions: [
    // The IF staff may swap or drop: "I did not just switch in and did not fail to run away". Legacy until R-B06-7 is done.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["The stage can only go up to +6 (the stat change itself fails at the limit)"],
  effect: { id: "effect.stat-stage", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "end of turn at full HP and at 1 HP", axes: { hp: ["max", 1] } }],
  status: "decomposed",
  notes:
    "Users (2 attrs): Speed Boost (3, attr 0) and Max Acceleration (5379, attr 0, followed by two SpeedBonusToStatAbAttr). Both gates are legacy-closure (no atom for 'I switched in this turn' (turnData.switchedInThisTurn) or 'I failed to run away this turn' (turnData.failedRunAway)). The `simulated ||` part is a pass-through the class keeps; it is not in the library form either. Oddity, not fixed: the class comment says the simulated check could move to apply. The stat raise is a StatStageChangePhase with showAbility true; at +6 the phase itself reports the stat cannot go higher.",
});
