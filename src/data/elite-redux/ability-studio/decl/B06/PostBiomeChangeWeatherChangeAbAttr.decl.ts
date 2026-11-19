/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06 chunk 2, Tier A event-effect. See ../PRECEDENTS.md.
//
// "When the game moves on to a new biome, set the weather again" (the primal weather abilities: Desolate Land, Primordial Sea,
// Delta Stream, and the ER Harsh Sun carriers Desolate Sun, Fire Aspect, Blistering Sun). The class has one constructor
// argument (the weather) and no closure, so there is nothing to bind. Clauses, in the ORIGINAL order:
//   canApply  1. `arena.weather?.isImmutable() ?? false`  = feasibility: a lasting (primal) weather is active right now
//             2. `arena.canSetWeather(weatherType)`        = feasibility: the weather is different from the current one and no
//                                                            weather lock (ER Clear Skies) is up
//   apply     (skipped when `simulated`) `arena.trySetWeather(weatherType, pokemon)`
// Both canApply clauses are effect-side feasibility, as in the PostSummonWeatherChangeAbAttr precedent, so they stay in the class.
// The ordinary weather abilities (Drought, Drizzle, Sand Stream, Snow Warning) carry the ER subclass ErBiomeChangeWeatherAbAttr
// instead (init-elite-redux-vanilla-rebalance.ts patchWeatherSummoner); that is a different class and is not declared here.
import { PostBiomeChangeWeatherChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec, enumOptions } from "#data/elite-redux/ability-studio/param-codecs";
import { WeatherType } from "#enums/weather-type";

export default defineDecl(PostBiomeChangeWeatherChangeAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.biome-changed",
  label: "Set the weather again when the area changes",
  summary: params =>
    `When the game moves on to a new area, I set the weather to ${params.weather} again, but only while a lasting weather is still active. Example: Harsh Sun stays in the next area.`,
  synonyms: [
    "keep weather after biome change",
    "weather survives new area",
    "primal weather",
    "desolate land",
    "primordial sea",
    "delta stream",
    "weather on new biome",
  ],
  examples: ["Set Harsh Sun again when the area changes, like Desolate Land"],
  params: [
    {
      id: "weather",
      ctorIndex: 0,
      path: "weatherType",
      control: "select",
      label: "Which weather is set",
      editable: true,
      default: "HARSH_SUN",
      options: enumOptions(WeatherType),
      codec: enumCodec(WeatherType, "weather"),
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "A lasting weather (Harsh Sun, Heavy Rain or Strong Winds) must be active when the area changes",
    "The weather must differ from the current one, and no weather lock may be up",
    "Nothing happens when the game only previews the move",
  ],
  effect: { id: "effect.set-weather", params: ["weather"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a lasting weather in place, a normal weather in place, and clear skies",
      axes: { weather: ["HARSH_SUN", "RAIN", "NONE"] },
    },
  ],
  l2StaticReason:
    "The shared entry template never changes the biome, so the engine never asks this attr (decomp-l2-reach.json lists event.biome-changed as unreached); test/tests/elite-redux/decomp/B06/b06-chunk2.test.ts drives the real attr against a real arena for the original and for the rebuild.",
  status: "decomposed",
  notes:
    "Users (6 attrs, all at attr 1 after the matching PostSummonWeatherChangeAbAttr): Primordial Sea (189, Heavy Rain), Desolate Land (190, Harsh Sun), Delta Stream (191, Strong Winds), Desolate Sun (5447), Fire Aspect (5570) and Blistering Sun (5572), all Harsh Sun. The engine call is new-biome-encounter-phase.ts: applyAbAttrs(PostBiomeChangeAbAttr) for every Pokemon after the new biome starts. Oddity, not fixed: canApply asks for an IMMUTABLE (primal) weather to be active before it sets the weather, so the ability only refreshes a primal weather that is already there; when the biome change cleared the weather to nothing it does not bring it back (the TODO above the base class says it should simply re-run the entry effect). Subclass ErBiomeChangeWeatherAbAttr (the ordinary weather abilities) is a separate class and also adds ER turn counts.",
});
