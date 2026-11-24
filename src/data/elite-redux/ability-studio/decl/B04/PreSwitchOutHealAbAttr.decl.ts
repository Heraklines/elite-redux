/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 / Tier A event-effect, no closure, no setting (Regenerator, Eternal Blessing, Natural Recovery).
//
// Clause classification (PreSwitchOutHealAbAttr; constructor calls super(false), so the ability is silent):
//   canApply  `!pokemon.isFullHp()`  -> FEASIBILITY (a heal at full HP does nothing). The library atom `hp.full` calls
//             the same isFullHp(), so staff who want "only when below half" simply AND a `hp.at-most` condition on
//             the trigger; the class keeps its own no-op check.
//   apply     `if (!simulated) { pokemon.heal(toDmgValue(pokemon.getMaxHp() * 0.33)); pokemon.updateInfo(); }`  -> the
//             EFFECT. The 0.33 is a literal inside `apply`, NOT a constructor argument, and a batch may not add one,
//             so the amount cannot be a param. The nearest library effect is "Heal by a share of max HP" (33%); the
//             request for an adjustable amount is in requests/B04.md.
// No RNG, no closure, no binding.
import { PreSwitchOutHealAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PreSwitchOutHealAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.switch-out",
  label: "Heal a third of my max HP when I switch out",
  summary: () =>
    "When I switch out while hurt, I heal 33% of my max HP (rounded down, at least 1). Example: 200 max HP heals 66. Nothing happens at full HP.",
  synonyms: [
    "regenerator",
    "heal on switch",
    "recover when retreating",
    "switch out heal",
    "eternal blessing",
    "natural recovery",
  ],
  examples: ["Heal about a third of my HP when I switch out, like Regenerator"],
  params: [],
  noParamsReason:
    "The heal amount is a fixed 33% written inside the class (not a constructor argument), so there is no setting to expose; a different amount comes from combining 'When I switch out' with the library heal effect.",
  conditions: [],
  guards: [],
  feasibility: ["My HP must not already be full"],
  effect: { id: "effect.heal-percent", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "switch out around full HP", axes: { hp: ["max", "max-1", "50%", "25%"] } }],
  status: "decomposed",
  notes:
    "Users: Regenerator (attr 0), Eternal Blessing (attr 1), Natural Recovery (attr 1, after PreSwitchOutResetStatusAbAttr at attr 0). Heal = toDmgValue(maxHp * 0.33) = floor with a minimum of 1; the library heal-percent effect is only the nearest description. Hardcoded 0.33 (vanilla PokeRogue Regenerator is 1/3) is kept as is. apply honours `simulated`. The hp probes include max-1 (one HP missing) so the isFullHp boundary is covered at every max HP size.",
});
