/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / calc modifier, Tier B (same shape as ChangeMovePriorityAbAttr). See ../PRECEDENTS.md.
//
// `Move.getPriorityModifier` (move.ts:1455): `applyAbAttrs("ChangeMovePriorityInBracketAbAttr", { pokemon: user, simulated,
// move: this, priority: modifierHolder })`, `modifierHolder` starting at NORMAL (1). Afterwards the engine still forces LAST for a
// drenched holder (unless an ability already forced FIRST). canApply is now `gate` only (no guard, no residual, no draw):
//   gate   this.moveFunc(pokemon, move)    <- staff may replace it
// apply SETS `priority.value = newModifier` (it does not add): 0 = last, 1 = normal, 2 = first among moves of equal priority.
import { ChangeMovePriorityInBracketAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { MovePriorityInBracket } from "#enums/move-priority-in-bracket";

export default defineDecl(ChangeMovePriorityInBracketAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.priority",
  label: "Go first or last among moves of equal priority",
  summary: params =>
    `Moves that fit the rule go ${String(params.position).toLowerCase()} among moves of the same priority, whatever the Speed. Example: Mycelium Might status moves go last.`,
  synonyms: [
    "go last",
    "move last",
    "act first or last",
    "mycelium might",
    "lagging tail",
    "act first among equals",
  ],
  examples: ["Status moves always go last among equal-priority moves, like Mycelium Might"],
  params: [
    {
      id: "position",
      ctorIndex: 1,
      path: "newModifier",
      control: "select",
      options: ["FIRST", "NORMAL", "LAST"],
      label: "Place in the turn order (First, Normal or Last)",
      editable: true,
      // Only `apply` reads it; the gate binding never repeats it.
      gateIndependent: true,
      default: "LAST",
      codec: enumCodec(MovePriorityInBracket, "place in the turn order"),
    },
  ],
  conditions: [
    // The gate: "the move fits the rule". Each user's binding names its own rule (bindings.ts).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "A drenched holder still goes last afterwards unless it was already forced to go first",
    "Moves of a higher priority still go before it: only the order among equal priority changes",
  ],
  // The library effect `effect.change-priority` ADDS to the priority number; this one picks the place inside a bracket.
  effect: { id: "effect.package", params: ["position"] },
  // Constructor argument 0 is the closure that the gate replaces. A rebuilt attr gets this stand-in so that it has a closure
  // like the original (the identity fingerprint compares it); it is only called if staff remove the gate block, and then the change applies to every move.
  fixedCtorArgs: { 0: () => true },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "a status move and an attacking move", axes: { hp: ["max", "50%"] } }],
  status: "decomposed",
  notes:
    "Tier B. Effect is `package` ONLY because the library has no 'go first / last among equal priority' effect (effect.change-priority adds a number to the priority): R-B05-11 asks for effect.set-turn-order-place and a WHEN of its own (the class is dispatched from Move.getPriorityModifier, not from getPriority, but the shared WHEN calc.priority lists it as an also-dispatched key). User: Mycelium Might (298 attr 0, status moves, LAST), bound as move.category STATUS. A moveFunc that rejects a hit does not set the bracket, the holder keeps NORMAL (unless drenched). The class never reads `simulated`.",
});
