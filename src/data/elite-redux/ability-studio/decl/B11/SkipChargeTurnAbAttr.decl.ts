/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 4 / calc-modifier (Tier B: the charging-tag test is the gate inside canApply). Its trigger is NOT fired by the game.
//
// Read by hand from archetypes/skip-charge-turn.ts. It extends PreAttackAbAttr, a base class that `applyAbAttrs` never dispatches
// (the type `AbAttrString` excludes it), so NOTHING ever calls canApply or apply of this class: it is a registration marker (the
// dispatcher comment says so: "a harmless registration marker + belt-and-braces tag clear"). Accelerate really works through the
// AbilityStudioRuntimeCapabilityAbAttr ACCELERATE_CHARGE_SKIP that sits next to it, read in MoveChargePhase.end and move.ts:1649.
// No constructor arguments; `super(false)` (no banner).
//   canApply is now `gate` alone (no guard, no residual):
//     `getTag(CHARGING) || getTag(UNDERGROUND) || getTag(UNDERWATER) || getTag(FLYING)` is not undefined   (CONDITION: any of tag.has)
//   apply: simulated -> nothing. Else removes the four tags in that order. No random draw.
//
// The only WHEN whose dispatch key is an ancestor of the class is the legacy grouping "Before I attack" (calc.outgoing-move,
// baseClassOnly, not composable: the library itself lists it as never fired). Staff therefore cannot use this block yet; the
// trigger the effect really needs is "when a move that needs a charge turn is about to charge" (request R-B11-C4-05). The effect is
// four applications of the library effect.remove-tag (one per tag), declared once here.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { SkipChargeTurnAbAttr } from "#data/elite-redux/archetypes/skip-charge-turn";

export default defineDecl(SkipChargeTurnAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.outgoing-move",
  label: "End my charge-up turn right away",
  summary: () =>
    "When I am in the first turn of a charging move (Solar Beam, Fly, Dig, Dive), the charge tags are removed so the move fires at once. Not used by the game yet: see the notes.",
  synonyms: ["power herb", "skip charge", "instant charge", "no charge turn", "accelerate", "charge move in one turn"],
  examples: ["Solar Beam fires on the first turn", "Fly and Dig have no charge turn"],
  params: [],
  noParamsReason:
    "The class has no constructor argument: the four charging tags (charging up, underground, underwater, in the air) are fixed in the class. The behaviour is a marker the game never runs, so there is nothing for staff to set.",
  conditions: [{ slot: "gate", ctx: "params", lib: "tag.has", removable: true, editable: true }],
  guards: [],
  feasibility: ["Never in a preview"],
  effect: { id: "effect.remove-tag", params: [] },
  reusableAlone: { when: false, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "PreAttackAbAttr is a base class the engine never dispatches, so no battle can show this attr evaluated; its twin is compared as a presence-only battle and the gate is proven by test/tests/elite-redux/decomp/B11/chunk4.test.ts.",
  probes: [{ name: "a normal turn", axes: { hp: ["max"] } }],
  status: "decomposed",
  notes:
    "Tier B, justified in the header. Only user: Accelerate (5205, attr 0; attr 1 is the ACCELERATE_CHARGE_SKIP capability that does the real work). The gate binding is any[tag.has CHARGING, UNDERGROUND, UNDERWATER, FLYING] for the holder (`getTag(x) !== undefined`, the same call as the atom). SUSPECTED DEAD CODE, NOT fixed: this class is never dispatched, so its canApply and apply never run in a battle. The trigger is the legacy base-class grouping and cannot be composed; a real trigger and a real effect (R-B11-C4-05) are needed before staff can reuse the idea, and the engine-side capability stays in the foundation (engine-query routing).",
});
