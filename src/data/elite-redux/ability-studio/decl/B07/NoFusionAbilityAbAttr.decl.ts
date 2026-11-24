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
// To finish: once the librarian has added `NoFusionAbilityAbAttr` to the `flagKeys` of `while.active` and removed it from
// UNEXPOSED_DISPATCH_KEYS, rename this file to NoFusionAbilityAbAttr.decl.ts and run L0 / L1 / L2 for the class.
//
// What the class is (read from the source): an empty marker, `constructor() { super(false) }`, no `apply`, never dispatched. The only
// reader is Pokemon.canApplyAbility (pokemon.ts): `this.isFusion() && ability.getAttrs("NoFusionAbilityAbAttr").some(attr =>
// abilityStudioRuntimeComponentIsActive(attr, this))` makes the ability not work while the Pokemon is a fusion. The `.some(...)` asks
// the attr's own extra condition (`addCondition`), so an attr that carries one (Two-Faced) only blocks while that condition holds.
import { NoFusionAbilityAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(NoFusionAbilityAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "This ability stops working on a fused Pokemon",
  summary: () =>
    "While I have this, the ability it belongs to does nothing if the Pokemon is a fusion of two Pokemon. Example: a fused Pokemon with Multitype loses its Multitype effect.",
  synonyms: [
    "no fusion",
    "disabled when fused",
    "fusion blocks ability",
    "multitype",
    "disguise",
    "does not work on fusions",
    "fusion breaks ability",
  ],
  examples: ["The ability is switched off while the Pokemon is a fusion, like Multitype or Disguise"],
  params: [],
  noParamsReason: "A pure presence flag read by the engine (Pokemon.canApplyAbility); there is nothing to configure.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only matters while the Pokemon is a fusion; the engine tests that itself",
    "An extra condition added to the flag (as Two-Faced does) decides when it counts; the engine asks it",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "the ability of a fused and of a non-fused Pokemon", axes: {} }],
  l2StaticReason:
    "The flag is consulted by Pokemon.canApplyAbility, which is not a dispatched moment; the engine site is driven directly in test/tests/elite-redux/decomp/B07/flag-sites-2.test.ts.",
  status: "decomposed",
  notes:
    "Engine-query flag, Tier C, parked (R-B07-6). Users (live dump, 18 attrs): Forecast (59), Multitype (121), Flower Gift (122), Illusion (149, attr 4), Zen Mode (161, attr 3), Stance Change (176), Shields Down (197, attr 5), Schooling (208, attr 3), Disguise (209, attr 1), Power Construct (211, attr 4), RKS System (225), Gulp Missile (241, attr 1), Ice Face (248, attr 1), Hunger Switch (258, attr 3), Zero to Hero (278, attr 1), Tera Shift (307, attr 2), Patchwork (5396, attr 1), Two-Faced (5486, attr 3, with an extraCondition set by the ability composition: `sourceConditions.every(...) && existing`, copied by recomposeAttr). showAbility false by `super(false)`. The source has a TODO to turn it into a real ability flag.",
});
