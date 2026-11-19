/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 / Tier A event-effect, no closure, no setting (Forecast, Flower Gift).
//
// Clause classification (PostSummonFormChangeByWeatherAbAttr):
//   canApply  `pokemonFormChanges[species]?.some(fc => fc.findTrigger(SpeciesFormChangeWeatherTrigger) && fc.canChange(pokemon))`
//             -> FEASIBILITY (my species has a weather form change that is allowed now). It reads the registered
//             form-change table; no library atom can say that, and it is not something staff would tune.
//   apply     `if (!simulated) globalScene.triggerPokemonFormChange(pokemon, SpeciesFormChangeWeatherTrigger)`
//             -> the EFFECT: the form is whatever the species' weather form-change table says for the current
//             weather. Library "Change to the {key} form" needs a named form key, which does not exist here (the table
//             decides), so a precise request sits in requests/B04.md (effect.match-weather-form).
// No RNG, no closure, no binding.
import { PostSummonFormChangeByWeatherAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostSummonFormChangeByWeatherAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Take the form that fits the weather when I enter",
  summary: () =>
    "When I enter the battle, I change to the form that matches the current weather (Castform in rain, Cherrim in sun), if my species has one.",
  synonyms: ["forecast", "flower gift", "castform", "cherrim", "weather form", "change form with the weather"],
  examples: ["Switch to my rain form when I enter during rain, like Castform"],
  params: [],
  noParamsReason:
    "The effect has no numbers or choices: which form fits which weather is fixed by the species' own form-change table.",
  conditions: [],
  guards: [],
  feasibility: ["My species must have a weather-based form change that is allowed right now"],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "enter under different weather", axes: { weather: ["NONE", "SUNNY", "RAIN", "HAIL"] } }],
  status: "decomposed",
  notes:
    "Users: Forecast (attr 1), Flower Gift (attr 1). The default L1/L2 holder (Blissey) has no weather form change, so canApply is false on the grid; b04-attrs.test.ts proves the true case with a real Castform. Engine coupling the declaration must not break: Pokemon.FORM_CHANGE_DRIVER_ATTRS lists this class NAME (the innate unlock carve-out) and applyPostFormChangeAbAttrs filters it out of the form-change replay with attr.is('PostSummonFormChangeByWeatherAbAttr'); both key on the class name, which is untouched. canApply ignores `simulated` (pure query).",
});
