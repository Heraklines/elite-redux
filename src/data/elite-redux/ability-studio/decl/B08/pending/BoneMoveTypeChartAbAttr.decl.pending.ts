/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 / calc-modifier (Tier C). PARKED: status legacy-closure-pending-request.
//
// This file is written and complete, but it is deliberately NOT named `*.decl.ts`, so the registry glob does not pick
// it up yet. Reason: the class extends only AbAttr and is never dispatched through applyAbAttrs. The engine finds it BY
// CLASS NAME inside Pokemon.getAttackTypeEffectiveness (pokemon.ts, around line 4391):
//   if (move && attr?.constructor?.name === "BoneMoveTypeChartAbAttr") attr.fire(move, multi)
// next to the other registration-free type-chart scanners (OffensiveTypeChartOverrideAbAttr, WeatherGroundAirborneAbAttr,
// MiracleBladeTypeChartAbAttr). No WHEN of WHEN_REGISTRY has this class or an ancestor as its dispatch key (the chain is
// BoneMoveTypeChartAbAttr, AbAttr), so the L0 rule "the WHEN's dispatch key is the class or an ancestor" cannot be met,
// and a batch may not edit the library (spec 6, step 3). The request is requests/B08.md R-B08-8.
//
// To finish: once the librarian has added the WHEN `calc.my-attack-matchup` (dispatch key BoneMoveTypeChartAbAttr, plus the
// sibling scanners), rename this file to BoneMoveTypeChartAbAttr.decl.ts, make sure the id below matches, and run L0 / L1.
//
// What the class is (read from the source): no constructor argument (it calls super(false)), no closure, no random draw.
// `canApply` is a constant true and `apply` is empty: the whole effect is `fire(move, multi)`, the type effectiveness
// multiplier of MY attack against the target:
//     the move does not have the BONE_BASED flag (move.hasFlag, inherent)  -> unchanged
//     multi === 0  (immune)                                                 -> 1   (normal damage)
//     multi < 1    (resisted)                                               -> multi * 2  (0.5 -> 1, 0.25 -> 0.5)
//     multi >= 1                                                            -> unchanged
// The bone test and the two rewrites are one rule in one method that the engine calls directly, so extra IFs cannot be
// ANDed on top (reusableAlone.if false).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { BoneMoveTypeChartAbAttr } from "#data/elite-redux/archetypes/bone-move-type-chart";

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
  params: [],
  noParamsReason:
    "No constructor argument: the bone-move test and the two rewrites (immune becomes x1, resisted doubles) are fixed in fire(), which the engine calls directly.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only moves with the bone property are changed",
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
    "Tier C, parked until the WHEN `calc.my-attack-matchup` exists (R-B08-8). Users (2): Bone Zone (5091 attr 0) and Cranisphere (6096 attr 0). Nothing to bind. showAbility is false. The engine passes `move` only when it is known, so a call without a move never reaches fire().",
});
