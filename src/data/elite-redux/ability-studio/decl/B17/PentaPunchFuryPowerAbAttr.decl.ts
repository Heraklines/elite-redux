/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B17 chunk 2 / Penta-Punch, the power half. Read by hand: fakemon-pitch-mechanics.ts `PentaPunchFuryPowerAbAttr`, its base
// VariableMovePowerAbAttr (ab-attrs.ts), the dispatch of the power calculation (`applyAbAttrs("VariableMovePowerAbAttr", ...)`
// in move.ts / pokemon.ts) and the other attrs of the ability (PentaPunchMarkerAbAttr, ChangeMovePriorityAbAttr and
// CritStageBonusAbAttr are separate classes in other batches).
//
// canApply, clause by clause (it never called super):
//   1. condition  the move being used is Five-Star Fury: `move.id === ErMoveId.FIVE_STAR_FURY`   -> `gate`
//                 NO ATOM: `move.is-move` resolves its name in MoveId, and Five-Star Fury only exists in ErMoveId (request R10)
// apply: `power.value = this.power`, a SET (not a multiplication), also for previews: a calc modifier writes only the frame.
// No random draw, no memory, no guard, no residual.
import { PentaPunchFuryPowerAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PentaPunchFuryPowerAbAttr, {
  tier: "B",
  kind: "package",
  when: "calc.move-power",
  label: "Set one move's power to a fixed number",
  summary: params =>
    `While the game calculates a move's power, one named move (as built: Five-Star Fury) is given exactly ${params.power} power, whatever its normal power is. Example: 80 means power 80.`,
  synonyms: [
    "penta-punch",
    "fixed power",
    "set base power",
    "power override",
    "make a move hit with this power",
    "signature move power",
  ],
  examples: ["Make Five-Star Fury always have 80 power", "Give one special move a fixed power of 100"],
  params: [
    {
      id: "power",
      ctorIndex: 0,
      path: "power",
      control: "number",
      label: "Power the move is set to (80 = a move of power 80)",
      editable: true,
      // Only the effect reads it; the gate (which move) never repeats the number.
      gateIndependent: true,
      default: 80,
      min: 1,
      max: 250,
      step: 1,
      integer: true,
    },
  ],
  conditions: [
    // The gate: "the move is Five-Star Fury". The atom move.is-move cannot name an Elite Redux move yet (request R10).
    {
      slot: "gate",
      ctx: "params",
      lib: "request R10: the move is a named Elite Redux move",
      removable: true,
      editable: true,
    },
  ],
  guards: [],
  feasibility: [],
  effect: { id: "effect.package", params: ["power"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // Moves other than Five-Star Fury leave the power alone; the Five-Star Fury case is driven in penta-perpetual.test.ts
      // because the shared grid has no Elite Redux move axis.
      name: "ordinary moves keep their power",
      axes: { foeMove: ["WATER_GUN", "BITE", "EMBER"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, effect kept as a PACKAGE only because the library has no 'set the move's power to N' effect: effect.multiply-power multiplies, and a multiplier cannot reproduce a SET for a move whose base power staff may change (request R11, effect.set-power; the formula is `power.value = N`). The package still has a typed number (power 1-250) and the trigger and condition are separate, swappable blocks. The gate is legacy-closure-pending-request R10 (move.is-move cannot name Five-Star Fury because it only exists in ErMoveId); until R10 exists the attr cannot be rebuilt from the library. Users: Penta-Punch (6015, attr 1) only; attrs 0 (marker), 2 (priority +1 for Five-Star Fury, a closure) and 3 (+1 crit stage for Five-Star Fury) belong to other classes and use the same move test, so R10 serves them too. Oddity, not a bug: apply overwrites the power instead of multiplying, so any power multiplier applied earlier in the chain is thrown away and later ones still apply; this is what the ability text asks for. No game bug found.",
});
