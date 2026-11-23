/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 / calc-modifier (Tier B, review round 4).
//
// The class extends only AbAttr and is never dispatched through applyAbAttrs: the engine finds it BY CLASS NAME inside
// Pokemon.getAttackTypeEffectiveness (field/pokemon.ts, around line 4391): `attr?.constructor?.name === "BoneMoveTypeChartAbAttr"` then
// `attr.fire(move, multi, source)`, next to the other registration-free type-chart scanners. (The call site now also hands over
// `source`, the attacker that holds the ability, so the gate has a holder to read; nothing else changed there.)
// The library trigger `calc.my-attack-matchup` carries the class's own name as its dispatch key (vocabulary/when-registry.ts), so the L0 rule
// "the WHEN's dispatch key is the class or an ancestor" holds. L2 cannot reach it with a battle template (it is listed as
// unreached in decomp-l2-reach.json), so the declaration carries an `l2StaticReason` and its own B08 test drives the engine-side call.
//
// What the class is (read from the source): no constructor argument that is a closure, no random draw. `canApply` is a constant true and
// `apply` is empty: the whole effect is `fire(move, multi, source)`, the type effectiveness multiplier of MY attack against the target.
//     GATE  (pure, the first clause, replaceable through gateOverride):
//       the move does not have the BONE_BASED flag (move.hasFlag, inherent)  -> unchanged     atom move.inherent-flag <flag>
//     EFFECT (stays in the class, one piece with two numbers):
//       multi === 0  (immune)                                                 -> immuneBecomes (1: normal damage)
//       multi < 1    (resisted)                                               -> multi * resistedFactor (2: 0.5 -> 1, 0.25 -> 0.5)
//       multi >= 1                                                            -> unchanged
// The bone property is the IF "the move has the bone property", bound for both users and repeated into the gate through gateParams (the
// property param is editable). The effect is the "immune becomes / resisted times" rewrite with its two numbers; the library has no
// effect that rewrites the type multiplier yet (request R-B08-11), so it is a package for the DO part only.
import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { MOVE_FLAG_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { BoneMoveTypeChartAbAttr } from "#data/elite-redux/archetypes/bone-move-type-chart";
import { MoveFlags } from "#enums/move-flags";

/** Move property name <-> MoveFlags member. */
const flagCodec: ParamCodec = {
  toCtor: value => (MoveFlags as unknown as Record<string, number>)[String(value)],
  fromInstance: raw => MOVE_FLAG_OPTIONS.find(name => (MoveFlags as unknown as Record<string, number>)[name] === raw),
};

export default defineDecl(BoneMoveTypeChartAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.my-attack-matchup",
  label: "Bone moves ignore immunities and hit resisted targets harder",
  summary: params =>
    `My moves with the ${String(params.flag)} property deal ${params.immuneBecomes}x damage to a Pokemon that is immune, and have their effectiveness multiplied by ${params.resistedFactor} against one that resists them. Example: 0.5 becomes 1.`,
  synonyms: [
    "bone zone",
    "bone moves",
    "ignore immunity",
    "hit ghost types",
    "bonemerang",
    "skull bash",
    "resist breaker",
  ],
  examples: ["My bone moves hit Flying types with Ground moves and do normal damage against resists"],
  params: [
    {
      id: "flag",
      ctorIndex: 0,
      ctorOption: "flag",
      path: "flag",
      control: "select",
      label: "Only for moves with this property",
      editable: true,
      default: "BONE_BASED",
      options: MOVE_FLAG_OPTIONS,
      codec: flagCodec,
    },
    {
      id: "immuneBecomes",
      ctorIndex: 0,
      ctorOption: "immuneBecomes",
      path: "immuneBecomes",
      control: "number",
      min: 0,
      max: 4,
      step: 0.25,
      label: "Immune targets: damage multiplier becomes (1 = normal damage, 0 = stays immune)",
      editable: true,
      gateIndependent: true,
      default: 1,
    },
    {
      id: "resistedFactor",
      ctorIndex: 0,
      ctorOption: "resistedFactor",
      path: "resistedFactor",
      control: "number",
      min: 0.25,
      max: 8,
      step: 0.25,
      label: "Resisted hits: multiply the damage multiplier by (2 = doubled, 1 = unchanged)",
      editable: true,
      gateIndependent: true,
      default: 2,
    },
  ],
  gateParams: [{ param: "flag", block: "move.inherent-flag", field: "flag" }],
  conditions: [
    // The gate is one atom per user (bindings.ts): [move.inherent-flag BONE_BASED], the move's OWN property (Long Reach style abilities do not change it).
    { slot: "gate", ctx: "params", lib: "move.inherent-flag", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["A target that is neutral or weak to the move is left as it is"],
  effect: { id: "effect.package", params: ["immuneBecomes", "resistedFactor"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a bone move and a normal move against an immune and a resisting target", axes: {} }],
  l2StaticReason:
    "The class is read by a by-name scan in the type-effectiveness calculation, not dispatched, so no trace event shows it evaluated. The B08 test (test/tests/elite-redux/decomp/B08/bone-move-type-chart.test.ts) calls fire() on the original and the rebuild (the library gate of every binding) for bone and non-bone moves and the multipliers 0, 0.25, 0.5, 1 and 2.",
  status: "decomposed",
  notes:
    "Tier B (review round 4). The condition `the move has the bone property` was folded into the `flag` param of a Tier C package; it is now the replaceable gate (atom move.inherent-flag, bound for Bone Zone 5091 attr 0 and Cranisphere 6096 attr 0, repeated from the live `flag` param through gateParams), so staff can remove it, change the property or AND another IF in. The effect stays one piece (effect.package) with its two numbers immuneBecomes and resistedFactor (defaults equal the old fixed 1 and 2); the library has no effect that rewrites the type multiplier (request R-B08-11, effect.set-matchup). The engine call site (Pokemon.getAttackTypeEffectiveness) still calls fire() directly by class name, now with the attacker as a third argument; fire() honours a replaced gate itself, so no dispatch is needed. The atom move.inherent-flag is move.hasFlag (the move's own property), the same call the class made. showAbility is false. The engine passes `move` only when it is known, so a call without a move never reaches fire().",
});
