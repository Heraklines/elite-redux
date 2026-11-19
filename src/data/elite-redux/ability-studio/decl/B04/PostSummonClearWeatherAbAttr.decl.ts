/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 / Tier A event-effect, no closure, no setting (Cloud Nine, In the Clouds).
//
// Clause classification (PostSummonClearWeatherAbAttr):
//   canApply  `const weather = arena.weather; return !!weather && weather.weatherType !== WeatherType.NONE`
//             -> FEASIBILITY (there is a weather to clear). It reads the raw `arena.weather` object, which is the same
//             truth as the library atom `field.weather` (arena.weatherType is `weather?.weatherType ?? NONE`), but
//             clearing nothing is not a design choice staff would change, so it stays in the class.
//   apply     `if (!simulated) arena.trySetWeather(WeatherType.NONE)`  -> the EFFECT. trySetWeather lets NONE through
//             the immutable-weather guard, so this also clears primal weather (Heavy Rain, Extremely harsh sunlight,
//             Strong winds). The library effect "Set the weather to None" goes through a different path (the V1
//             set-weather effect), so it is NOT claimed as the same thing: see requests/B04.md (effect.clear-weather).
// No RNG, no closure, no binding.
import { PostSummonClearWeatherAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostSummonClearWeatherAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Clear the weather when I enter",
  summary: () =>
    "When I enter the battle, any weather ends, even Heavy rain, Extremely harsh sunlight and Strong winds. Nothing happens if the sky is already clear.",
  synonyms: ["cloud nine", "remove weather", "end the weather", "clear sky", "stop the rain", "no weather"],
  examples: ["End the rain or sun the moment I enter, even a primal weather"],
  params: [],
  noParamsReason:
    "The effect has no numbers or choices: it always clears whatever weather is active, including primal weather.",
  conditions: [],
  guards: [],
  feasibility: ["There must be an active weather to clear"],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    { name: "enter under different weather", axes: { weather: ["RAIN", "NONE", "HEAVY_RAIN", "STRONG_WINDS"] } },
  ],
  status: "decomposed",
  notes:
    "Users: Cloud Nine (attr 1, before the form-revert attr at attr 2, so the weather is cleared first), In the Clouds (attr 2). The class has no own constructor and inherits PostSummonAbAttr(showAbility = true, activateOnGain = true); both stay at their defaults. The weather-cleared message comes from trySetWeather (ER #450 comment in init-abilities). Primal weather is cleared on purpose (class doc). Effect stays a one-piece DO until effect.clear-weather exists (requests/B04.md).",
});
