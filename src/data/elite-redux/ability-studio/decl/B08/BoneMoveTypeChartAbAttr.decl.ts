/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 / calc-modifier (Tier C).
//
// The class extends only AbAttr and is never dispatched through applyAbAttrs: the engine finds it BY CLASS NAME inside
// Pokemon.getAttackTypeEffectiveness (field/pokemon.ts, around line 4391): `attr?.constructor?.name === "BoneMoveTypeChartAbAttr"` then
// `attr.fire(move, multi)`, next to the other registration-free type-chart scanners.
// The library trigger `calc.my-attack-matchup` carries the class's own name as its dispatch key (vocabulary/when-registry.ts), so the L0 rule
// "the WHEN's dispatch key is the class or an ancestor" holds. L2 cannot reach it with a battle template (it is listed as
// unreached in decomp-l2-reach.json), so the declaration carries an `l2StaticReason` and its own B08 test drives the engine-side call.
//
// What the class is (read from the source): no constructor argument (it calls super(false)), no closure, no random draw.
// `canApply` is a constant true and `apply` is empty: the whole effect is `fire(move, multi)`, the type effectiveness
// multiplier of MY attack against the target:
//     the move does not have the BONE_BASED flag (move.hasFlag, inherent)  -> unchanged
//     multi === 0  (immune)                                                 -> 1   (normal damage)
//     multi < 1    (resisted)                                               -> multi * 2  (0.5 -> 1, 0.25 -> 0.5)
//     multi >= 1                                                            -> unchanged
// The bone property and the two numbers are now SETTINGS of the class (constructor options flag, immuneBecomes, resistedFactor, defaults
// equal to the old fixed behaviour), so staff can edit them. The rule itself is one method that the engine calls directly, so extra IFs cannot
// be ANDed on top (reusableAlone.if false); the engine-side split into a move-has-property IF and a set-matchup effect is request R-B08-11.
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
  tier: "C",
  kind: "calc-modifier",
  when: "calc.my-attack-matchup",
  label: "Bone moves ignore immunities and hit resisted targets harder",
  summary: () =>
    "My bone-based moves (like Bonemerang) deal normal damage to a Pokemon that is immune, and double the effectiveness against one that resists them. Example: 0.5 becomes 1, 0 becomes 1.",
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
      label: "Damage multiplier when the target is immune (1 = normal damage, 0 = stays immune)",
      editable: true,
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
      label: "Times the damage multiplier is multiplied when the target resists (2 = doubled, 1 = unchanged)",
      editable: true,
      default: 2,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only moves with the chosen property (bone by default) are changed",
    "A target that is neutral or weak to the move is left as it is",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a bone move and a normal move against an immune and a resisting target", axes: {} }],
  l2StaticReason:
    "The class is read by a by-name scan in the type-effectiveness calculation, not dispatched, so no trace event shows it evaluated. The B08 test (test/tests/elite-redux/decomp/B08/bone-move-type-chart.test.ts) calls fire() on the original and the rebuild for bone and non-bone moves and the multipliers 0, 0.25, 0.5, 1 and 2.",
  status: "decomposed",
  notes:
    "Tier C. WHEN `calc.my-attack-matchup` added to the library (R-B08-8 done). Users (2): Bone Zone (5091 attr 0) and Cranisphere (6096 attr 0). Nothing to bind. The bone property and both numbers are editable params (review fix); the remaining engine-side exempt part is that the rule is read by a by-name scan, so it cannot take extra IFs (R-B08-11). showAbility is false. The engine passes `move` only when it is known, so a call without a move never reaches fire().",
});
