/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 chunk 4 / Tier C while-active flag (Blind Rage, Teravolt, Turboblaze). PARKED: status legacy-closure-pending-request.
//
// This file is written and complete, but it is deliberately NOT named `*.decl.ts`, so the registry glob does not pick it up yet.
// Reason: the class is a presence flag like its five siblings of this chunk, but the library does not claim it: its key
// `PreserveBaseStatAbilitiesAbAttr` is listed in `UNEXPOSED_DISPATCH_KEYS` (vocabulary/dispatch-keys.ts:45) and is NOT in the `flagKeys`
// of the WHEN `while.active`, so the L0 rule "the WHEN's dispatch key is the class or an ancestor" cannot be met. Inventing a WHEN or
// editing the library is not allowed for a batch (spec 6 step 3); the request is requests/B04.md section 15
// ("while.active: add PreserveBaseStatAbilitiesAbAttr to flagKeys and drop it from UNEXPOSED_DISPATCH_KEYS").
//
// To finish: once the librarian has done that, rename this file to PreserveBaseStatAbilitiesAbAttr.decl.ts, run L0 / L1 / L2, and
// extend b04-chunk4.test.ts (the test of this class is already written and skips until the declaration exists).
//
// Class (ab-attrs.ts:4424): `constructor() { super(false) }` and `apply(_params) {}`. Never dispatched; a PRESENCE marker.
// Reader: Pokemon.getEffectiveStat (src/field/pokemon.ts:2176), the stat calculation of a Pokemon `this` whose own ability effects are
// being ignored (`ignoreAbility`, a Mold Breaker style attacker is the `opponent`):
//   `preserveBaseStatAbilities = ignoreAbility && (opponent?.hasAbilityWithAttr("PreserveBaseStatAbilitiesAbAttr") ?? false)`
//   `if (!ignoreAbility || preserveBaseStatAbilities) applyAbAttrs("StatMultiplierAbAttr", ...)`
// so the stat-changing abilities (Grass Pelt, Fur Coat, ...) of the stat owner keep working although abilities are ignored; every other
// ability kind (immunities, damage reduction, effects) is still bypassed. Clause order: ignore-abilities is active, THEN the foe carries the
// marker. The marker sits on the Pokemon that IGNORES abilities (the opponent of the stat owner), not on the stat owner.
// No RNG, no `simulated` read.
import { PreserveBaseStatAbilitiesAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PreserveBaseStatAbilitiesAbAttr, {
  tier: "C",
  kind: "while-active",
  when: "while.active",
  label: "Keep the foe's stat-changing abilities when I ignore abilities",
  summary: () =>
    "While I have this and I ignore the foe's ability, the foe's stat-changing abilities (Grass Pelt, Fur Coat...) still work. Their other abilities are still ignored.",
  synonyms: [
    "blind rage",
    "teravolt",
    "turboblaze",
    "tempered mold breaker",
    "do not ignore stat abilities",
    "keep fur coat",
    "grass pelt still works",
  ],
  examples: ["I ignore the foe's abilities except ones that change stats, like Blind Rage"],
  params: [],
  noParamsReason:
    "A pure presence flag: the game only checks that it exists when it works out a stat while abilities are being ignored, so there is nothing to configure.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only matters while my ability makes the game ignore the foe's abilities (Mold Breaker style)",
    "Only keeps abilities that change a stat value; immunities, damage reduction and effect abilities are still ignored",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a Mold Breaker style holder attacks a foe with Fur Coat", axes: {} }],
  l2StaticReason:
    "A flag has no dispatch moment (no trace event), so the shared twin only compares a generic battle. b04-chunk4.test.ts proves it with real stat calculations: original ability against its rebuilt shadow, with and without the flag.",
  status: "decomposed",
  notes:
    "Flag, presence only. Users (live dump, 3 attrs): Teravolt (id 164, attr 3), Turboblaze (163, attr 3), both pushed by the ER rebalance patch (init-elite-redux-vanilla-rebalance.ts:908 and 917), and Blind Rage (5397, attr 4, built from Scrappy plus Mold Breaker plus this marker, archetype-dispatcher.ts:6654). Read by Pokemon.getEffectiveStat only.",
});
