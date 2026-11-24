/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B17 chunk 2 / Perpetual Motion, third of five attrs (the chain-reset half). Read by hand: fakemon-pitch-mechanics.ts
// `PerpetualMotionResolutionAbAttr`, its base ExecutedMoveAbAttr (canApply is always true; dispatched whenever a move is pushed
// to the holder's move history, apply-ab-attrs.ts queues the ability flyout for every one of my moves), and the siblings.
//
// canApply is the inherited `true`, on purpose; the rule runs inside `apply`, in the original order (the split is
// `gate && residual` through gatedCanApply, called by apply):
//   1. feasibility  not simulated (a preview never changes the chain)
//   2. condition    the move I just started was a Rollout: `pokemon.getLastXMoves(1)[0]?.move === MoveId.ROLLOUT`
//                                                                                -> `gate`, atom time.last-move (holder, ROLLOUT)
//   3. feasibility  the chain is pending (summonData.erPerpetualMotionPending), that Rollout was the INDIRECT one this
//                   ability queued (useMode INDIRECT) and it did not succeed (result !== SUCCESS)      -> `residual`
//   effect          pending = false, streak = 0
// No random draw.
import { PerpetualMotionResolutionAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PerpetualMotionResolutionAbAttr, {
  tier: "B",
  kind: "package",
  when: "event.my-move-starts",
  label: "End the Rollout chain when its follow-up fails",
  summary: () =>
    "When a Rollout I queued as a follow-up has just failed, the Rollout chain is cancelled and its power bonus starts again from nothing.",
  synonyms: ["perpetual motion", "rollout", "reset the chain", "chain breaks", "streak reset", "stop the combo"],
  examples: ["Reset the Rollout streak when the free Rollout misses or fails"],
  params: [],
  noParamsReason:
    "The reset has no number, type, stat or status to set: it always clears the pending flag and the streak counter of the chain, and the move it watches (Rollout) is fixed.",
  conditions: [
    // The gate: "my last move was Rollout". Bound in bindings.ts.
    { slot: "gate", ctx: "params", lib: "time.last-move", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "A Rollout chain must be running (the matching end-of-turn block started one)",
    "That Rollout must be the follow-up the chain queued itself, not one I chose",
    "That Rollout must have failed or missed (it was not a success)",
    "It never changes anything for a preview (a simulated move)",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "entry", simulated: "respects" },
  probes: [
    {
      // Nothing is pending on the grid, so every state is the quiet case; the failing and succeeding follow-up are driven
      // in penta-perpetual.test.ts.
      name: "my own moves with no chain running",
      axes: { hp: ["max", "50%"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B with a PACKAGE effect. Written reason: the effect writes two fields of per-switch-in chain state (erPerpetualMotionPending and erPerpetualMotionStreak) that the Progress and Power attrs of the same ability (B14) also read and write; there is no library effect or atom for a named chain flag and counter (request R16), and splitting it would invent behaviour. No typed param exists: nothing numeric is used. The gate (my last move was Rollout) is the exact library atom time.last-move, but its binding is legacy-closure-pending-request R22: the shared L1 proves gates through canApply, this class runs its gate inside apply, and the my-move-starts trigger has no engine-parameter builder in the harness (the equivalence is proved by hand in penta-perpetual.test.ts); the residual (pending, indirect, not a success) stays in the class as feasibility, with request R17 for the atoms that would let it be promoted into the gate. Users: Perpetual Motion (6022, attr 2) only. The gate runs inside `apply`, not `canApply` (the inherited canApply is `true`), so the ability flyout is queued at every one of my moves even when nothing happens; this is existing behaviour, kept. No game bug found.",
});
