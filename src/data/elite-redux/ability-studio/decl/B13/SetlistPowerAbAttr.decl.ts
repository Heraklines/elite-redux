/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Setlist, part 2 of 3 (Tier B, package effect). "The move my set list expects next gets 20% more power, 40% at the second step."
//
// Source: abilities/newcomer-signature-mechanics.ts, SetlistPowerAbAttr (MovePowerBoostAbAttr; the constructor now takes
// bonusPercentPerStep, default = the old literal 0.2 as 20 / 100, which is the same double, and still hands the base
// class the original closure and 1).
//   canApply (the original closure, ONE clause, now the gate):
//     setlistNextLevel(holder, move) > 0, with
//       setlistNextLevel = state.moves.length === 2 && state.expected === move.id ? min(2, state.crescendo + 1) : 0
//     -> private memory (the record SetlistResetAbAttr empties and finishSetlistMove fills): legacy-closure, R-B13-25
//   apply (overridden): power *= 1 + setlistNextLevel(holder, move) * (bonusPercentPerStep / 100)
// No RNG. A "ctor:0" slot is impossible (the constructor's only argument is a number), so this is Tier B with a gate
// and no residual.
import { SetlistPowerAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(SetlistPowerAbAttr, {
  tier: "B",
  kind: "package",
  when: "calc.move-power",
  label: "Boost move power when I use the move my pattern expects",
  summary: params =>
    `Once I have used two different moves, the one my pattern expects next gains ${params.bonusPercentPerStep}% power per step, up to 2 steps. Example: 20% turns 100 power into 120, then 140.`,
  synonyms: [
    "combo power",
    "rhythm boost",
    "crescendo",
    "alternating moves",
    "setlist",
    "move pattern bonus",
    "encore combo",
  ],
  examples: ["If I keep alternating between my two attacks in order, each one hits harder"],
  params: [
    {
      id: "bonusPercentPerStep",
      ctorIndex: 0,
      path: "bonusPercentPerStep",
      control: "number",
      label: "Extra power for each step of the pattern (percent)",
      editable: true,
      gateIndependent: true,
      default: 20,
      min: 0,
      max: 100,
      step: 5,
    },
  ],
  conditions: [
    // The whole original closure: "this is the move my set list expects next". No library atom reads that memory yet.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The move must be the one my pattern expects next: it records the first two different damaging moves I use, expects them in turn, and a wrong move starts the count again (a private memory inside the class, updated after each of my moves)",
    "The pattern has at most 2 steps (fixed in the class, shared with the recording)",
  ],
  effect: { id: "effect.package", params: ["bonusPercentPerStep"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  l2StaticReason:
    "The trigger's registered dispatch key (MovePowerBoostAbAttr) is never dispatched by the engine, which dispatches VariableMovePowerAbAttr, so the shared reach probe cannot see it (decomp-l2-reach.json, request R-B13-12). The twin still shows the original evaluating this attr when a damaging move is used, and B13/chunk3.test.ts drives the real pattern memory.",
  probes: [
    {
      // The pattern is empty in a plain battle, so the gate decides it; the recorded case is in B13/chunk3.test.ts.
      name: "a move used with an empty pattern",
      axes: { foeMove: ["TACKLE"] },
    },
  ],
  status: "decomposed",
  notes:
    "PACKAGE for the EFFECT only; the trigger (move power) and the 'expected move' condition are separate blocks (the condition is a legacy-closure gate until R-B13-25). Why the effect cannot be split with today's blocks: the multiplier is 1 + step * 20% where the step (1 or 2) is read from the live pattern memory, not a constant that effect.multiply-power can hold; requested as R-B13-26 (`effect.multiply-power-per-count`, shared with Fan Favorite, Porous and Heavyweight). The 20% was the literal 0.2, now constructor argument 0 with default 20; the cap of 2 steps lives in the shared state machine (also in finishSetlistMove) and stays fixed. Users: Setlist (5989, attr 1). ODDITIES (not fixed): (1) the recording and the move-order bookkeeping are done by finishSetlistMove, called by name from phases/move-effect-phase.ts, so the memory depends on an engine call site the declaration cannot show. (2) setlistNextLevel is called twice per use (gate, then apply); both calls are pure. (3) The ability text speaks of two moves; any two different damaging moves count, status moves and signature follow-ups are skipped.",
});
