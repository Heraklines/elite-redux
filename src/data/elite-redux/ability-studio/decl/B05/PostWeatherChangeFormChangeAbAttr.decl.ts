/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / package, Tier C (species locked). See ../PRECEDENTS.md.
//
// `Arena.trySetWeather` (arena.ts:537) tells every Pokemon in speed order that the weather changed:
// `applyAbAttrs("PostWeatherChangeAbAttr", { pokemon, weather })`. This class, in the original order:
//   canApply  Castform with the ability Forecast, or Cherrim with the ability Flower Gift (`speciesId` plus the `ability`
//             constructor argument). Any other Pokemon answers false. This is an IDENTITY test, not a rule players can
//             re-aim, so it stays in the class and is listed as feasibility.
//   apply     not when `simulated`; then reads the weather from the ARENA (not from the `weather` of the call, a TODO in the
//             class); a weather in the `formRevertingWeathers` list calls `Arena.triggerWeatherBasedFormChangesToNormal()`,
//             every other weather calls `Arena.triggerWeatherBasedFormChanges()`. Both walk the field and fire the form-change
//             table of each Pokemon, so the target form comes from the species table and not from this class.
// No random draw.
import { PostWeatherChangeFormChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec, enumListCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { AbilityId } from "#enums/ability-id";
import { WeatherType } from "#enums/weather-type";

export default defineDecl(PostWeatherChangeFormChangeAbAttr, {
  tier: "C",
  kind: "package",
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
      label: "Weathers that send me back to my normal form (comma separated names)",
      editable: true,
      default: "NONE,SANDSTORM,STRONG_WINDS",
      codec: enumListCodec(WeatherType, "weather"),
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only Castform with Forecast and Cherrim with Flower Gift do anything; any other Pokemon is skipped",
    "The target form comes from the species' own form-change table, not from this block",
    "Nothing happens during a simulated check",
  ],
  // No library effect changes form by the weather yet (R-B05-19), so the effect is a package.
  effect: { id: "effect.package", params: ["ability", "revertWeathers"] },
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
    "Package, justified: canApply is an identity test (Castform with Forecast, Cherrim with Flower Gift) and apply does not use the weather of the call but asks the arena to re-run every form change on the field, so it cannot be split into a rule and a change without inventing behaviour. Typed params: the ability (not editable, it names the species) and the weather list. Users: Forecast (59 attr 2, revert list NONE, SANDSTORM, STRONG_WINDS) and Flower Gift (122 attr 2, revert list NONE, SANDSTORM, STRONG_WINDS, FOG, HAIL, HEAVY_RAIN, SNOW, RAIN). Nothing to bind (no closure). Oddity, not fixed: apply reads `globalScene.arena.weather` instead of the weather it was given (the class carries a TODO for it). The arena methods it calls (triggerWeatherBasedFormChanges and triggerWeatherBasedFormChangesToNormal, arena.ts:555 and :574) look for the Pokemon by ability IDENTITY with abilityQuery(FORECAST_FORM / FLOWER_GIFT_FORM), so a staff-made ability built from this block changes form only if it is Forecast or Flower Gift itself (an engine-query dependency owned by the foundation, R-B05-23). The species check also means a staff-made ability that uses this block on another species does nothing. The shared L2 holder is not Castform, so the whole-battle twin only proves the attr is skipped; the real form changes are driven in test/tests/elite-redux/decomp/B05/chunk3-sites.test.ts.",
});
