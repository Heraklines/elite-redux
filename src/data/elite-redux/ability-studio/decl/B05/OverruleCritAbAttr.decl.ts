/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / while-active flag with TWO engine-side effects. See ../PRECEDENTS.md.
//
// No behaviour in the class. `Pokemon.getAttackDamage` (pokemon.ts) asks `source.hasAbilityWithAttr("OverruleCritAbAttr")`
// at two places, both only when the hit is a critical hit and the attacker's own ability is not being ignored
// (`isCritical && !ignoreSourceAbility`):
//   1. (pokemon.ts:6269) typeMultiplier < 1 (a resisted hit): damage = toDmgValue(damage * 2).
//   2. (pokemon.ts:6354) the defender's ReceivedMoveDamageMultiplierAbAttr and every ally's
//      AlliedFieldDamageReductionAbAttr are skipped (Multiscale, Filter, Fur Coat, Friend Guard style abilities).
// The "is a critical hit", "is resisted" and "my ability is not ignored" tests are conditions of the engine site, not of
// the class, so they cannot become blocks until the engine reads the flag through a dispatched hook (request R-B05-4).
import { OverruleCritAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(OverruleCritAbAttr, {
  tier: "C",
  kind: "while-active",
  when: "while.active",
  label: "Make crits bypass damage cuts and double resisted damage",
  summary: () =>
    "When my attack is a critical hit, the target's damage-cutting abilities (like Multiscale or Filter) are ignored, and a resisted hit does double damage.",
  synonyms: [
    "overrule",
    "magistrate",
    "crit ignores abilities",
    "critical hit breaks resistance",
    "ignore damage reduction on crit",
    "double damage when resisted",
  ],
  examples: ["Critical hits ignore Multiscale and deal double damage if resisted, like Overrule"],
  params: [],
  noParamsReason:
    "A pure presence flag: the damage calculation only asks whether the attacker has it (hasAbilityWithAttr), and the factor 2 is a literal there, so there is nothing to configure.",
  conditions: [],
  guards: [],
  feasibility: [
    "Both parts only happen on a critical hit while my own ability is not being ignored",
    "Only the damage-cutting abilities of the target and its allies are skipped (the ones that reduce the damage taken); other defensive abilities still work",
    "The doubling only happens when the move is resisted (type effectiveness below 1)",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a critical resisted hit against a Multiscale foe", axes: {} }],
  l2StaticReason:
    "A flag has no dispatch moment, so the shared twin only compares whole battles. The damage calculation (Pokemon.getAttackDamage) is driven directly in test/tests/elite-redux/decomp/B05/flag-sites.test.ts with a forced critical hit.",
  status: "decomposed",
  notes:
    "While-active flag, Tier C, two crit-gated engine effects (double resisted damage; skip the target's damage-cutting abilities). Users: Overrule (attr 0), Magistrate (attr 1). Nothing to bind. The class cannot be split into two blocks without engine edits: the two halves would be 'effect.double-resisted-damage' and 'effect.skip-damage-cut-abilities' on a calc trigger, with the atom 'the hit is a critical hit' (the frame has no crit slot), see requests/B05.md R-B05-4. Observation (not fixed): half 2 only skips ReceivedMoveDamageMultiplierAbAttr and AlliedFieldDamageReductionAbAttr, so other defensive hooks (for example the PreDefend endure hooks that run later in getAttackDamage) still run, which is narrower than the class doc ('ignore defensive abilities that reduce damage').",
});
