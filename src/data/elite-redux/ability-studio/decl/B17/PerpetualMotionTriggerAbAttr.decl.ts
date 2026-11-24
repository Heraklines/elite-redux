/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B17 chunk 2 / Perpetual Motion, first of five attrs (the trigger half). Read by hand: fakemon-pitch-mechanics.ts
// `PerpetualMotionTriggerAbAttr`, its base PostAttackAbAttr (ab-attrs.ts, attackCondition = constructor argument 0, default
// `move.category !== STATUS`), and its four siblings (PostTurn and Resolution here; Progress and Power are B14).
//
// canApply, clause by clause, in the order they run (the split is `canApply = gate`, no guards, no residual):
//   1. condition  the inherited attack condition: the move deals damage, `move.category !== STATUS`    -> `gate`, atom move.damaging
//                 (it used to live in a `guards` method; moved into the gate, in front of the other two, as a pure move of code)
//   2. condition  my hit really landed: hitResult is EFFECTIVE, SUPER_EFFECTIVE, NOT_VERY_EFFECTIVE or ONE_HIT_KO
//                                                                                                     -> `gate`, NO ATOM (request R12)
//   3. condition  the move is not the Rollout this ability queued: no ScriptedMoveMarkerAttr with key "perpetual-motion"
//                                                                                                     -> `gate`, NO ATOM (request R13)
// apply: unless simulated, push the marker "perpetual-motion:trigger" into pokemon.turnData.erAbilityProvenance, once
// (a second hit in the same turn finds it and does nothing). No random draw. The marker is what PerpetualMotionPostTurnAbAttr
// reads at the end of the turn.
import { PerpetualMotionTriggerAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PerpetualMotionTriggerAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Mark that my attack landed this turn",
  summary: () =>
    "After my attack really lands, I mark this turn once, so a matching end-of-turn effect can follow up. The follow-up move it queued itself never counts.",
  synonyms: [
    "perpetual motion",
    "remember a hit",
    "arm a follow-up",
    "rollout chain",
    "hit this turn flag",
    "prepare an end of turn move",
  ],
  examples: ["Remember that I landed a hit this turn so a Rollout can follow at the end of the turn"],
  params: [],
  noParamsReason:
    "The class has no constructor arguments: the marker name is internal glue between this block and the end-of-turn block, and the rule has no number, type, stat or status to set.",
  conditions: [
    // The gate: all[move.damaging, <the hit landed>, not <the move is the queued follow-up>]. Two of the three have no atom
    // yet (requests R12 and R13), so the whole gate is legacy-closure-pending-request.
    {
      slot: "gate",
      ctx: "params",
      lib: "move.damaging plus requests R12 (the hit landed) and R13 (the move is the follow-up this ability queued)",
      removable: true,
      editable: true,
    },
  ],
  guards: [],
  feasibility: [
    "It never marks anything for a preview (a simulated hit)",
    "It marks the turn only once, however many hits land",
  ],
  effect: { id: "effect.arm-effect", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "entry", simulated: "respects" },
  probes: [
    {
      // Damaging and status moves against a healthy and a half-health target; the grid has no landed/blocked hit result axis.
      name: "damaging and status foe targets",
      axes: { foeHp: ["max", "50%"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, no package: the effect is 'arm an effect for later' (effect.arm-effect), which in the class is one write of a text marker into this turn's memory (turnData.erAbilityProvenance). The library effect is not implemented yet; request R15 states the exact write so the librarian can wire it to the same memory. The gate is legacy-closure-pending-request (R12 hit landed, R13 queued follow-up), so the attr cannot be rebuilt from the library yet. Source edit (pure move of code, spec 3.1): the inherited attack condition used to sit in a `guards` method, which would have hidden a rule staff may change inside a locked safety line; it now opens the gate in the same position (first), so clause order and short-circuiting are unchanged. Users: Perpetual Motion (6022, attr 0) only. Shared state: the marker is turn memory read by the PostTurn attr (attr 1) and removed there; the pending and streak counters (summonData.erPerpetualMotionPending / erPerpetualMotionStreak) belong to attrs 1 to 4. No game bug found.",
});
