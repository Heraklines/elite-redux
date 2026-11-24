/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / engine query with a dispatched cancel check, Tier A (one constructor argument). See ../PRECEDENTS.md.
//
// The class is read in TWO ways:
//   1. The big one, an engine QUERY: `Weather.isEffectSuppressed()` (weather.ts:178) walks every active Pokemon, takes the
//      ability sources that have this attr (`getAttrs("SuppressWeatherEffectAbAttr")`) and answers true when the holder's
//      ability works and `!weather.isImmutable() || attr.affectsImmutable`. About twenty engine sites ask it before a
//      weather boost, penalty, accuracy change, weather move or weather form change counts (arena.ts:548 and :1459,
//      pokemon.ts:4457 and :5926, move.ts:3109 and others, form-change-triggers.ts:269 and :308, er-pledge-weather-effect.ts:77).
//      A decomposed block could not reproduce this query, so the class keeps being the one that is asked.
//   2. A dispatch, in `WeatherEffectPhase` (weather-effect-phase.ts:94): each damaging weather tick runs
//      `applyAbAttrs("SuppressWeatherEffectAbAttr", { pokemon, weather, cancelled })` for every field Pokemon and skips
//      the damage for everyone when `cancelled` comes back true.
// canApply, in the original order: `!weather || cancelled.value` (feasibility), then `affectsImmutable || weather.isImmutable()`
// (this is the `affectsImmutable` setting, not a gate). apply sets `cancelled.value = true`. No draw, `simulated` is not read.
// The AI move picker also peeks at the flag (ai-moveset-gen.ts:368, hasAbilityWithAttr): a rebuild keeps the class, so that
// keeps working.
import { SuppressWeatherEffectAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(SuppressWeatherEffectAbAttr, {
  tier: "A",
  kind: "engine-query",
  when: "cancel.weather-suppress",
  label: "Switch off the weather while I am out",
  summary: params =>
    params.affectsImmutable === true
      ? "While I am on the field, the weather does nothing: no damage, no boosts or penalties. This includes Heavy rain, Extremely harsh sunlight and Strong winds."
      : "While I am on the field, ordinary weather does nothing: no damage, no boosts or penalties. Heavy rain, Extremely harsh sunlight and Strong winds still work.",
  synonyms: [
    "cloud nine",
    "air lock",
    "no weather",
    "weather off",
    "ignore weather",
    "negate weather",
    "in the clouds",
  ],
  examples: [
    "Rain and sun have no effect while I am out, like Cloud Nine",
    "Weather stops hurting and boosting everyone, like Air Lock",
  ],
  params: [
    {
      id: "affectsImmutable",
      ctorIndex: 0,
      path: "affectsImmutable",
      control: "boolean",
      label: "Also switch off Heavy rain, Extremely harsh sunlight and Strong winds",
      editable: true,
      default: true,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "It stops working while the holder's own ability is suppressed (Neutralizing Gas, Gastro Acid style effects)",
    "The weather stays set and counts again when the holder leaves the field",
    "Does nothing when there is no weather or an earlier ability already cancelled the damage",
  ],
  effect: { id: "effect.negate", params: ["affectsImmutable"] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      name: "a damaging weather is up and the holder sits through three turn ends",
      axes: {},
    },
  ],
  status: "decomposed",
  notes:
    "Tier A engine-query. Users: Cloud Nine (13 attr 0, true), Air Lock (76 attr 0, true), In the Clouds (6020 attr 1, true), Clueless (5162 attr 0, false: primal weathers still work under Clueless). Cloud Nine and Air Lock sit next to PostSummonClearWeatherAbAttr or PostSummonUnnamedMessageAbAttr, PostSummonWeatherSuppressedFormChangeAbAttr and PostFaintUnsuppressedWeatherFormChangeAbAttr, each its own class. No closure, nothing to bind. The IF list is closed (`reusableAlone.if` false): the engine query cannot honour an extra condition, only the abilityStudioRuntimeComponentIsActive check of the attr does (weather.ts:196). Staff-made abilities that use this block keep the class, so the query keeps finding it; a block built only from library pieces could not be found by it (see R-B05-20). The `field.weather` atom reads the arena weather and is NOT suppression aware, which matches the original classes that test the raw weather. The dispatch in WeatherEffectPhase is only reached while a damaging weather (Sandstorm, Hail, Tempest storm, Snowy wrath) is active, the query is reached everywhere else; both are driven directly in test/tests/elite-redux/decomp/B05/chunk3-sites.test.ts. Oddity, not fixed: the two reads treat `affectsImmutable` in opposite ways. The query suppresses a weather when `!weather.isImmutable() || affectsImmutable`, so Clueless (false) switches off ordinary weather and leaves the three primal ones; the dispatch canApply is `affectsImmutable || weather.isImmutable()`, so under Clueless the damage tick is cancelled only for primal weathers, which never deal damage, and Clueless therefore never cancels sandstorm or hail damage while Cloud Nine, Air Lock and In the Clouds do (checked for every weather in chunk3-sites.test.ts). The class never reads `simulated`.",
});
