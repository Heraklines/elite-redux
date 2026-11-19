/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
// B10 / while-active (Tier C, a pure flag read by name).
//
// The class is `constructor() { super(false) }`: no field, no closure, no method. The engine finds it by name inside
// Pokemon.getAttackTypeEffectiveness (field/pokemon.ts, after the offensive type chart scan):
//     if (multi.value > 0 && multi.value < 1 && sourceAttrs.some(a => a?.constructor?.name === "IgnoreResistancesAbAttr"))
//       multi.value = 1;
// so a resisted matchup (0.25 or 0.5 overall) becomes neutral, while an immunity (0) and a weakness (above 1) stay as
// they are. The scan only runs when the attacker is known and its ability is not being ignored (`!ignoreSourceAbility`,
// which is what Mold Breaker sets), so it does not apply to a move whose user's ability is ignored.
// The WHEN is the shared "while.active" flag moment; the class name was added to its flagKeys.
import { IgnoreResistancesAbAttr } from "#data/elite-redux/archetypes/offensive-type-chart-override";

export default defineDecl(IgnoreResistancesAbAttr, {
  tier: "C",
  kind: "while-active",
  when: "while.active",
  label: "My moves ignore type resistances",
  summary: () =>
    "While I have this, a target that resists my move takes normal damage instead of reduced damage. Immunities still block the move.",
  synonyms: ["normalize", "ignore resistance", "no resisted hits", "resist breaker", "hits resists normally"],
  examples: ["My attacks are never resisted, but a Ghost type is still immune to Normal moves"],
  params: [],
  noParamsReason:
    "A pure presence flag: the engine only checks that the attr exists (by name, while it works out type matchups), so there is nothing to configure.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only a matchup between 0 and 1 is raised to 1: immunities (0) and weaknesses (above 1) are left alone",
    "Does not work while my ability is being ignored (for example by a Mold Breaker foe)",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a resisted, a neutral and an immune target", axes: {} }],
  l2StaticReason:
    "A flag has no dispatch moment (no trace event), so the twin only compares the whole battle: the holder attacks a foe and the battles must match. The clamp itself is proven in test/tests/elite-redux/decomp/B10/ignore-resistances.test.ts.",
  status: "decomposed",
  notes:
    "Tier C flag, read by name in Pokemon.getAttackTypeEffectiveness. Only user: Normalize (added in init-elite-redux-vanilla-rebalance.ts as an extra attr after the 1.1x power boost). Nothing to bind. Oddity, not fixed: the clamp applies to EVERY move of the holder, not only Normal moves; the dex text says 'Normal-type moves bypass resistances', which only matches while the holder's other attr converts every move to Normal (which Normalize does). Extra IFs cannot be added (the scan has no condition check, unlike the offensive override).",
});
