/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 3 / calc-modifier, Tier A (nothing to bind, nothing to gate). Read from the source (archetypes/crit-mod.ts, the
// parent BlockCritAbAttr in ab-attrs.ts, the dispatch in field/pokemon.ts isCriticalHit) and from the live instances of the
// 6 users (Bad Luck, Crust Coat, Crystalline Armor, Dream State, In the Rough, Scarecrow). The class has no constructor
// argument, no canApply (the parent's always-true) and an apply that sets the holder's `blockCrit` to true:
//
//   dispatch   Pokemon.isCriticalHit: after the crit roll, applyAbAttrs("BlockCritAbAttr", { pokemon: this, blockCrit }) where
//              `this` is the DEFENDER, then the side tags (Lucky Chant) are asked, then `isCritical &&= !blockCrit.value`.
//   apply      blockCrit.value = true. No random draw, no condition, `showAbility` is false (the parent's constructor).
//
// The effect is a package PLACEHOLDER: no library effect writes the "block critical hits" value (request R-B08-27).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { CritImmunityAbAttr } from "#data/elite-redux/archetypes/crit-mod";

export default defineDecl(CritImmunityAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "cancel.crit",
  label: "Cannot be hit by critical hits",
  summary: () =>
    "While the game works out whether an attack on me is a critical hit, the answer is always no. Example: like Battle Armor and Shell Armor.",
  synonyms: [
    "battle armor",
    "shell armor",
    "no crits",
    "crit immune",
    "block critical hits",
    "immune to crits",
    "lucky chant",
  ],
  examples: ["Immune to critical hits like Battle Armor"],
  params: [],
  noParamsReason:
    "The class has no settings: it only switches 'critical hits against me are blocked' on. A condition (for example only at full HP) is added as a separate IF block.",
  conditions: [],
  guards: [],
  feasibility: [],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "none",
    rngOrder: [],
    state: "none",
    simulated: "ignores",
  },
  probes: [{ name: "the foe lands critical hits", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, nothing to bind: the class has no closure and no gate; extra IFs are ANDed by the composition carrier. The effect is a package PLACEHOLDER, written reason: the library has no effect that sets the 'block critical hits' value of this moment (effect.negate changes the value `cancelled`, not `blockCrit`, so it does not fit the WHEN); request R-B08-27 asks for `effect.block-crits`. The effect is a single fixed switch with no number, type, stat or status, so there is nothing to give it as a setting. Users (6): Bad Luck, Crust Coat, Crystalline Armor, Dream State, In the Rough, Scarecrow (attr 1; the others attr 0). Most users carry other attrs next to this one (declared under their own classes); this class needs no binding at any position. The class ignores `simulated` (the engine passes none). Siblings (BlockCritAbAttr, which Battle Armor and Shell Armor use) are separate classes.",
});
