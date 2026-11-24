/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 / calc modifier, Tier C (no closure). See ../PRECEDENTS.md.
//
// Four berry predicates in `getBerryPredicate` (berry.ts: Liechi, Ganlon, Petaya, Apicot and Salac through one case, then
// Lansat, Starf and Leppa) start with `hpRatioReq = new NumberHolder(0.25)` and call
// `applyAbAttrs("ReduceBerryUseThresholdAbAttr", { pokemon, hpRatioReq })`. The class, in its original order:
//   canApply  `hpRatioReq.value < pokemon.getHpRatio()`  -> FEASIBILITY: the doubling is only applied while my HP ratio is
//             strictly above the berry's normal threshold. Below it the berry is eaten anyway; at EXACTLY the threshold
//             (a ratio of 0.25, which getHpRatio rounds to two decimals) the doubling is skipped and the berry is NOT
//             eaten, a boundary quirk that the direct test pins (and that a library effect must keep).
//   apply     `hpRatioReq.value *= 2`                      -> the effect, a fixed x2.
// No closure, no random draw, `showAbility` is not an argument (`super(false)`).
import { ReduceBerryUseThresholdAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(ReduceBerryUseThresholdAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "calc.berry-threshold",
  label: "Eat my pinch berries at twice the HP",
  summary: () =>
    "The HP level at which my stat berries are eaten is doubled. Example: a Liechi Berry that waits for 25% HP is eaten at 50% HP.",
  synonyms: [
    "gluttony",
    "eat berry earlier",
    "berry sooner",
    "early berry",
    "pinch berry",
    "voracity",
    "double berry threshold",
  ],
  examples: ["Eat my Liechi Berry at 50% HP instead of 25%, like Gluttony"],
  params: [],
  noParamsReason:
    "A fixed rule: the threshold is always doubled (`hpRatioReq.value *= 2` in the class). The class has no constructor argument, and adding a setting would change the class, which a batch may not do.",
  conditions: [],
  guards: [],
  feasibility: [
    "The doubling only counts while my HP is above the berry's normal level; right at that level (25%) the berry is not eaten early",
  ],
  // No library effect changes the berry threshold yet; the package has no setting (request R-B07-2).
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      name: "HP around the normal and the doubled berry threshold",
      axes: { hp: ["max", "50%+1", "50%", "25%+1", "25%"] },
    },
  ],
  l2StaticReason:
    "The berry threshold is asked by getBerryPredicate (berry.ts) only for the stat berries, and the twin's holder carries a Sitrus Berry, whose predicate never calls the hook. The predicates are driven directly around both thresholds for the original, the rebuilt attr and a control in test/tests/elite-redux/decomp/B07/flag-sites.test.ts.",
  status: "decomposed",
  notes:
    "Tier C. The effect is 'package' ONLY because the library has no 'raise the berry HP threshold' effect (request R-B07-2). Users: Gluttony (82, attr 0) and Voracity (6101, attr 2). BOUNDARY QUIRK (kept, pinned by the direct test): canApply is `hpRatioReq.value < pokemon.getHpRatio()` and getHpRatio rounds to two decimals, so at exactly 25% HP the doubling is skipped and a stat berry is NOT eaten, while at 26% and at 24% it is. SUSPECTED GAME BUGS (not fixed): (1) the predicates of Lansat and Starf call the hook but then compare against a literal 0.25 (`pokemon.getHpRatio() < 0.25`), not against `hpRatioReq.value`, so Gluttony and Voracity do nothing for those two berries; (2) the Sitrus Berry predicate (`getHpRatio() < 0.5`) does not call the hook at all, so it is unaffected; Leppa's predicate ignores the value on purpose (it is about PP). The class never reads `simulated` (it only edits a number holder).",
});
