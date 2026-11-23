/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / event effect with a safety rule and two branches, Tier B (the weather rule is the gate that picks the branch). See ../PRECEDENTS.md.
//
// `Arena.trySetWeather` (arena.ts:537) tells every Pokemon in speed order that the weather changed:
// `applyAbAttrs("PostWeatherChangeAbAttr", { pokemon, weather })`. This class, in the original order:
//   canApply  = `guards`: Castform with the ability Forecast, or Cherrim with the ability Flower Gift (`speciesId` plus the
//             `ability` constructor argument). Any other Pokemon answers false. This is a safety rule (guard
//             "weather-form-species-only", not removable): the weather forms exist only for those two species. It is a real
//             `guards` method now, called by `gatedCanApply`; the clause itself is unchanged.
//   apply     not when `simulated`; then the `gate` (the weather rule, replaceable) picks one of two branches, written out in
//             `branches`. The gate reads the weather from the ARENA (not from the `weather` of the call, a TODO in the class),
//             which is what the atom field.weather reads too:
//               gate false (weather not a reverting one) -> `Arena.triggerWeatherBasedFormChanges()`     (follow the weather)
//               gate true  (weather is a reverting one)  -> `Arena.triggerWeatherBasedFormChangesToNormal()` (normal form)
//             The gate does NOT decide whether the attr runs (canApply is only the guard): both outcomes do something.
//             Both walk the field and fire the form-change table of each Pokemon, so the target form comes from the species table.
// No random draw.
import { PostWeatherChangeFormChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec, enumListCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { AbilityId } from "#enums/ability-id";
import { WeatherType } from "#enums/weather-type";

export default defineDecl(PostWeatherChangeFormChangeAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.weather-changed",
  label: "Change form with the weather (like Forecast)",
  summary: params =>
    `When the weather changes, my form follows it, and goes back to my normal form in: ${params.revertWeathers}. Works only for Castform and Cherrim.`,
  synonyms: [
    "forecast",
    "flower gift",
    "weather form",
    "castform form",
    "cherrim form",
    "change form with weather",
    "sunny form",
  ],
  examples: ["Castform turns into its Sunny, Rainy or Snowy form when the weather changes, like Forecast"],
  params: [
    {
      id: "ability",
      ctorIndex: 0,
      path: "ability",
      control: "text",
      label: "Which ability's form change this is (Forecast for Castform, Flower Gift for Cherrim)",
      // Not editable on purpose: it only names which species the class works for (the identity test), it is not a choice
      // that makes sense to change.
      editable: false,
      default: "FORECAST",
      codec: enumCodec(AbilityId, "ability"),
    },
    {
      id: "revertWeathers",
      ctorIndex: 1,
      path: "formRevertingWeathers",
      control: "text",
      // The list is also the gate ("the weather is one of these"), which staff edit through the gate block. This list only
      // feeds the class's own default gate, so editing it alone would not move a replaced gate.
      label: "Weathers that send me back to my normal form (comma separated names)",
      editable: false,
      default: "NONE,SANDSTORM,STRONG_WINDS",
      codec: enumListCodec(WeatherType, "weather"),
    },
  ],
  conditions: [
    // The gate: "the weather is one of the reverting ones" (any of field.weather), the rule that picks the branch. Each user's
    // binding repeats its list.
    { slot: "gate", ctx: "params", lib: "field.weather", removable: true, editable: true },
  ],
  guards: ["weather-form-species-only"],
  feasibility: [
    "The target form comes from the species' own form-change table, not from this block",
    "Nothing happens during a simulated check",
  ],
  // Two branches, one per weather group; the effects are listed in the registry but not implemented yet (R-B05-19, R-B05-23).
  branches: [
    {
      label: "Follow the weather",
      conditions: ["not the gate: field.weather is none of the reverting weathers"],
      effect: { id: "effect.follow-weather-form", params: [] },
    },
    {
      label: "Go back to my normal form",
      conditions: ["the gate: any of field.weather over the reverting weathers"],
      effect: { id: "effect.weather-forms-to-normal", params: [] },
    },
  ],
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "the weather changes from sun to rain and then to sandstorm",
      axes: { weather: ["SUNNY", "RAIN", "SANDSTORM", "NONE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, split after the second review: the weather test that picks between the two outcomes is now the gate (class method `gate`, replaceable through gateOverride), bound per user in bindings.ts as any[field.weather ...]. Unlike the other Tier B classes the gate does not make canApply false: canApply is only the species guard (`weather-form-species-only`, a real `guards` method), and `apply` asks the gate which of the two arena calls to make (true = triggerWeatherBasedFormChangesToNormal, false = triggerWeatherBasedFormChanges). Users: Forecast (59 attr 2, live list NONE, SANDSTORM, STRONG_WINDS) and Flower Gift (122 attr 2, live list NONE, SANDSTORM, STRONG_WINDS, FOG, HAIL, HEAVY_RAIN, SNOW, RAIN). The bindings leave NONE out on purpose: the original test is `weatherType && list.includes(weatherType)` on `arena.weather?.weatherType`, so with no weather (a null weather) it is false and NONE in the list never matches, while the atom field.weather NONE would be true; leaving NONE out keeps the behaviour identical (oddity, not fixed: NONE in the live lists is dead). The gate reads the ARENA weather, not the `weather` of the call (a TODO in the class), and field.weather reads the arena weather too, so they match. The `revertWeathers` list is not editable on purpose (a list cannot be repeated inside the gate atoms): staff change it through the gate block. The two branch effects are listed in the registry but not implemented yet (R-B05-19, R-B05-23). The arena methods the effects call (triggerWeatherBasedFormChanges and triggerWeatherBasedFormChangesToNormal, arena.ts:555 and :574) look for the Pokemon by ability IDENTITY with abilityQuery(FORECAST_FORM / FLOWER_GIFT_FORM), so a staff-made ability built from this block changes form only if it is Forecast or Flower Gift itself (an engine-query dependency owned by the foundation, R-B05-23). The species guard also means a staff-made ability that uses this block on another species does nothing, which is intended. The shared L2 holder is not Castform, so the whole-battle twin only proves the attr is skipped; the real form changes are driven in test/tests/elite-redux/decomp/B05/chunk3-sites.test.ts.",
});
