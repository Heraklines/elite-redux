/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Foul Harvest (Tier B, package effect). "After my damaging hit, drain 1 PP from the foe's last move and store a charge."
//
// Source: abilities/newcomer-signature-mechanics.ts, FoulHarvestAbAttr (PostAttackAbAttr; no constructor of its own, so
// the base class's two arguments (attackCondition, showAbility) are its constructor).
//   canApply, in the ORIGINAL order (now guards && gate):
//     1. super.canApply: the base attackCondition, by default `move.category !== STATUS`
//        -> constructor slot "ctor:0" (library atom move.damaging), kept FIRST as the class's `guards`
//     2. damage > 0                                          \  the gate: three clauses with no library atom
//     3. hitResult < HitResult.NO_EFFECT                      |  (a hit that really landed, and a move of mine that
//     4. my last move record exists AND differs from the      |  was not counted yet): legacy-closure + requests
//        record stored in FOUL_HARVEST[holder].lastMoveRecord/  `hit.dealt-damage`, `hit.not-blocked`,
//                                                              `time.new-move-of-mine`
//   apply:
//     1. FOUL_HARVEST[holder].lastMoveRecord = my last move record      (even when simulated: it is "spent")
//     2. simulated: stop
//     3. the foe's usable moves (moveId !== NONE); none: stop
//     4. RNG DRAW (only here): pick the foe move: its last executed move (LAST_EXECUTED_MOVE, by name) when it is
//        still in the moveset, ELSE moveset[holder.randBattleSeedInt(moveset.length)]
//     5. no move or it has no PP left: stop
//     6. selected.ppUsed++, charges = min(3, charges + 1), two messages
// The second half of the ability (draining moves heal 25% more per charge, spend a charge and give 1 PP back) is NOT in
// this class: HitHealAttr (data/moves/move.ts) calls applyFoulHarvestDrainBonus, which finds the ability by class name.
// recordSignatureExecutedMove (phases/move-effect-phase.ts) fills LAST_EXECUTED_MOVE.
import { FoulHarvestAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(FoulHarvestAbAttr, {
  tier: "B",
  kind: "package",
  when: "event.after-my-hit",
  label: "Drain a foe move's PP and store a charge when I hit",
  summary: () =>
    "When my damaging move hits, the foe's last-used move (or a random one) loses 1 PP and I store a charge, up to 3. Stored charges power up my draining moves.",
  synonyms: ["pp drain", "pp steal", "spite", "store charge", "drain bonus", "foul harvest"],
  examples: ["Each time I land a hit, take 1 PP from the move the foe used last"],
  params: [],
  noParamsReason:
    "The class has no constructor arguments of its own: the 1 PP, the 3-charge cap and the way the foe's move is picked are fixed in its code. The only constructor argument, the attack condition, is a condition slot, not a number.",
  conditions: [
    // Clause 1: the base class's attack condition (a real constructor argument). Every user takes the default.
    { slot: "ctor:0", ctx: "attack", lib: "move.damaging", path: "attackCondition", removable: true, editable: true },
    // Clauses 2 to 4: damage was dealt, the hit was not blocked, a move not counted before. Legacy closure.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["The foe must have a move with PP left to drain"],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "apply",
    rngOrder: [
      "apply: only when the foe has no remembered last move, or it is no longer in its moveset, one of its moves is picked with randBattleSeedInt(number of moves); never when simulated",
    ],
    state: "battle",
    simulated: "respects",
  },
  probes: [
    {
      // A damaging move, a status move and a multi-hit move decide the first clause and the once-per-move memory.
      name: "damaging hit, status move and the foe's HP",
      axes: { foeMove: ["TACKLE"] },
    },
  ],
  status: "decomposed",
  notes:
    "PACKAGE for the EFFECT only. The trigger (after my hit) and every condition are separate: the attack condition is a real constructor slot bound to move.damaging, the other three clauses are the gate (legacy-closure, requests in requests/B13.md). Why the effect cannot be split with today's blocks: it drains one PP from a foe move that is chosen by a remembered per-foe name or by a random draw, adds to a private charge counter capped at 3, and remembers the last move record so a multi-hit move counts once. There is no 'drain PP' effect and no 'charge counter' memory block in the library (both requested), and the counter is read by a different place (HitHealAttr), so splitting would re-implement the class. Users: Foul Harvest (5973, attr 0). ODDITIES (not fixed): (1) apply stores lastMoveRecord BEFORE its simulated and empty-moveset checks, so a simulated call or a foe without usable moves still spends the once-per-move memory; (2) the random pick (the only draw) happens before the 'no PP left' check, so a foe whose moves are all out of PP still consumes one draw; (3) the heal bonus lives in HitHealAttr by class name, an engine coupling the decomposition does not see; (4) the ability text says a 'direct hit', but canApply has no direct-hit test beyond the PostAttack dispatch.",
});
