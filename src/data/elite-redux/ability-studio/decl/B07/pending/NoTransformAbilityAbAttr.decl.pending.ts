/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 chunk 2 / engine-query flag (Tier C). See ../PRECEDENTS.md. PARKED: status legacy-closure-pending-request.
//
// This file is written and complete, but it is deliberately NOT named `*.decl.ts`, so the registry glob does not pick it up yet.
// Reason: the class is a presence flag with no moment, it is not in the `flagKeys` of the shared WHEN `while.active`
// (vocabulary/when-registry.ts), and `vocabulary/dispatch-keys.ts` lists it in UNEXPOSED_DISPATCH_KEYS ("needs its own WHEN once
// a class agent declares it"). The L0 rule "the WHEN's dispatch key is the class or an ancestor" therefore cannot be met, and a
// batch may not edit the library (spec 6, step 3). The request is requests/B07.md, R-B07-6.
//
// To finish: once the librarian has added `NoTransformAbilityAbAttr` to the `flagKeys` of `while.active` and removed it from
// UNEXPOSED_DISPATCH_KEYS, rename this file to NoTransformAbilityAbAttr.decl.ts and run L0 / L1 / L2 for the class.
//
// What the class is (read from the source): an empty marker, `constructor() { super(false) }`, no `apply`, never dispatched. The only
// reader is Pokemon.canApplyAbility (pokemon.ts): `this.isTransformed() && ability.getAttrs("NoTransformAbilityAbAttr").some(attr =>
// abilityStudioRuntimeComponentIsActive(attr, this))` makes the ability not work while the Pokemon is transformed (Transform,
// Imposter). The `.some(...)` asks the attr's own extra condition (`addCondition`), so an attr that carries one (Two-Faced) only
// blocks while that condition holds. It is the twin of NoFusionAbilityAbAttr (fusion instead of transformation).
import { NoTransformAbilityAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(NoTransformAbilityAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "This ability stops working on a transformed Pokemon",
  summary: () =>
    "While I have this, the ability it belongs to does nothing if the Pokemon has transformed into another one. Example: a Pokemon that has transformed loses its Ice Face.",
  synonyms: [
    "no transform",
    "disabled when transformed",
    "transform blocks ability",
    "disguise",
    "ice face",
    "does not work after transforming",
    "transform breaks ability",
  ],
  examples: ["The ability is switched off while the Pokemon is transformed, like Disguise or Ice Face"],
  params: [],
  noParamsReason: "A pure presence flag read by the engine (Pokemon.canApplyAbility); there is nothing to configure.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only matters while the Pokemon is transformed; the engine tests that itself",
    "An extra condition added to the flag (as Two-Faced does) decides when it counts; the engine asks it",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "the ability of a transformed and of a normal Pokemon", axes: {} }],
  l2StaticReason:
    "The flag is consulted by Pokemon.canApplyAbility, which is not a dispatched moment; the engine site is driven directly in test/tests/elite-redux/decomp/B07/flag-sites-2.test.ts.",
  status: "decomposed",
  notes:
    "Engine-query flag, Tier C, parked (R-B07-6). Users (live dump, 16 attrs): Shields Down (197, attr 6), Disguise (209, attr 0), Gulp Missile (241, attr 0), Ice Face (248, attr 0), Neutralizing Gas (256, attr 2), Hunger Switch (258, attr 2), Zero to Hero (278, attr 0), Protosynthesis (281, attr 2), Quark Drive (282, attr 2), Embody Aspect (303 to 306, attr 1 each), Tera Shift (307, attr 1), Patchwork (5396, attr 0), Two-Faced (5486, attr 2, with an extraCondition set by the ability composition: `sourceConditions.every(...) && existing`, copied by recomposeAttr). showAbility false by `super(false)`. The source has a TODO to turn it into a real ability flag.",
});
