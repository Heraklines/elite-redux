/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / calc modifier, Tier C (no condition, no closure). See ../PRECEDENTS.md.
//
// `Pokemon.getCritStage` (pokemon.ts:2063) asks `applyAbAttrs("BonusCritAbAttr", { pokemon: source, critStage })` for the
// ATTACKER after the move's own high-crit attribute and the held-item boosters, and the class adds a literal 1:
// `critStage.value += 1`. There is no `canApply` (the base answers true), no constructor argument and no random draw.
// The stage then picks the odds from [1/24, 1/8, 1/2, always] (pokemon.ts:6437).
import { BonusCritAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(BonusCritAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "calc.crit-stage",
  label: "Raise my critical hit chance by one level",
  summary: () =>
    "Every move I use is one level more likely to be a critical hit. Example: a normal 1 in 24 chance becomes 1 in 8, and a 1 in 8 chance becomes 1 in 2.",
  synonyms: [
    "super luck",
    "better crit chance",
    "high crit rate",
    "critical hit boost",
    "crit level",
    "lucky strikes",
  ],
  examples: ["All my moves crit more often, like Super Luck"],
  params: [],
  noParamsReason:
    "The class adds a fixed 1 to the critical hit level: the number is a literal in apply and the constructor takes nothing, so there is nothing to configure. The library effect that will own the number is requested in requests/B05.md (R-B05-9).",
  conditions: [],
  guards: [],
  feasibility: [],
  // No library effect changes the critical hit level yet (effect.force-crit is "always"), see R-B05-9.
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "the crit stage starts at 0 and goes up by one", axes: {} }],
  status: "decomposed",
  notes:
    "Tier C calc modifier. Effect is `package` ONLY because the library has no 'raise the critical hit level by N' effect (R-B05-9); the trigger is its own block, any IF can be ANDed on top (the hook gives the holder, the attacker). User: Super Luck (105, attr 0). The archetype class CritStageBonusAbAttr extends this class (own declaration, other batch) and overrides canApply and apply. The class never reads `simulated`, it only edits the number holder, so a simulated call gives the same answer.",
});
