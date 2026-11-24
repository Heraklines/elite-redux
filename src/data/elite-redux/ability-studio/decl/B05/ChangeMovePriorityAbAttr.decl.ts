/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / calc modifier, Tier B (the rule is a (pokemon, move) closure that no closure context fits). See ../PRECEDENTS.md.
//
// `Move.getPriority` (move.ts:1445): `applyAbAttrs("ChangeMovePriorityAbAttr", { pokemon: user, simulated, move: this, priority })`
// for the USER of the move, after the move's own priority attributes. canApply is now `gate` only (no guard, no prepare, no
// residual, no random draw):
//   gate   this.moveFunc(pokemon, move)    <- staff may replace it
// apply adds `changeAmount` to `priority.value`. The constructor closure has the shape (pokemon, move), which is neither
// of the attack (user, target, move), defend (target, user, move) nor holder (pokemon) shapes the closure slots know, so
// the rule is exposed as the Tier B gate (the gate is built from the engine parameter object, which has both).
import { ChangeMovePriorityAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(ChangeMovePriorityAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.priority",
  label: "Change priority of chosen moves",
  summary: params =>
    `Moves that fit the rule get ${params.amount} priority. Example: +1 moves before normal moves, +3 moves before almost everything.`,
  synonyms: [
    "go first",
    "move first",
    "priority boost",
    "gale wings",
    "prankster",
    "triage",
    "quick attack",
    "act before the foe",
  ],
  examples: ["Status moves get +1 priority, like Prankster", "Flying moves get +1 priority at full HP, like Gale Wings"],
  params: [
    {
      id: "amount",
      ctorIndex: 1,
      path: "changeAmount",
      control: "slider",
      min: -7,
      max: 7,
      step: 1,
      integer: true,
      label: "Priority change (+1 = acts before normal moves, negative = later)",
      editable: true,
      // Only `apply` reads it; the gate binding never repeats it.
      gateIndependent: true,
      default: 1,
    },
  ],
  conditions: [
    // The gate: "the move fits the rule". Each user's binding names its own rule (bindings.ts).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [],
  effect: { id: "effect.change-priority", params: ["amount"] },
  // Constructor argument 0 is the closure that the gate replaces. A rebuilt attr gets this stand-in so that it has a closure
  // like the original (the identity fingerprint compares it); it is only called if staff remove the gate block, and then the change applies to every move.
  fixedCtorArgs: { 0: () => true },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      name: "full HP, below full HP and a status, a Flying, a priority and a triage move",
      axes: { hp: ["max", "max-1", "50%"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B. The first constructor argument `moveFunc` is not exposed as a param; it is the gate. 6 users, 5 bound: Prankster (158) status moves; Gale Wings (177) full HP and the move is Flying (getMoveType); Triage (205) the Triage flag; Monk (6083 attr 4) Focus Punch. Legacy (reasons in bindings.ts): Opportunist (290) asks whether ANY opponent has HP ratio (rounded) <= 0.5 inside a try/catch, no atom reads an opponent list (R-B05-12); Penta-Punch (6015 attr 2) tests ErMoveId.FIVE_STAR_FURY, which move.is-move cannot name (R-B05-13). Subclasses PriorityModifierAbAttr, SePriorityBonusAbAttr, FirstFlaggedMovePriorityAbAttr, FirstTurnPriorityClampAbAttr and OverloadedPriorityAbAttr extend this class; they have their own declarations (other batches) and keep working because the gate is the same single call of moveFunc. Observation (not fixed): the class comment lists Stall as a user but Stall does not use it, and `getPriority` adds Moody and Endless Mode deltas after the attrs. Vanilla Gale Wings only triggers at full HP, as here.",
});
