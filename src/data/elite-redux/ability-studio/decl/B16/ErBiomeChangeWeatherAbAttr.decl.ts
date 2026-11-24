/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B16 chunk 2, part 2 of 2 of the Elite Redux weather abilities (Tier A, event-effect). "When the game moves on to a new area, set the
// weather again and make it last a set number of turns."
//
// Source: init-elite-redux-vanilla-rebalance.ts, ErBiomeChangeWeatherAbAttr (extends PostBiomeChangeWeatherChangeAbAttr), put in place of the
// vanilla attr by patchWeatherSummoner. Dispatched from new-biome-encounter-phase.ts (`applyAbAttrs("PostBiomeChangeAbAttr")`). Clauses:
//   canApply  the parent's, not overridden, two pieces of effect-side feasibility kept in the class (as in the parent's declaration, B06):
//             1. `arena.weather?.isImmutable() ?? false`   a LASTING (primal) weather is active right now
//             2. `arena.canSetWeather(weather)`            it differs from the current weather and no Clear Skies lock is up
//   apply     (skipped when `simulated`) 1. super.apply: `arena.trySetWeather(weather, holder)`
//             2. then, if ANY weather is active and has turns left (no check that it is the weather I set, unlike the entry half), its
//                `turnsLeft` and `maxDuration` are overwritten with `erFieldTurnsWithItems(holder, erTurns)`.
// No random draw, no state. Constructor `(weather, turns)`: weather is argument 0 (parent), turns argument 1 (`erTurns`).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec, enumOptions } from "#data/elite-redux/ability-studio/param-codecs";
import { ErBiomeChangeWeatherAbAttr } from "#data/elite-redux/init-elite-redux-vanilla-rebalance";
import { WeatherType } from "#enums/weather-type";

export default defineDecl(ErBiomeChangeWeatherAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.biome-changed",
  label: "Set the weather again for set turns on a new area",
  summary: params =>
    `When the game moves on to a new area, I set the weather to ${params.weather} again for ${params.turns} turns, but only while a lasting weather is still active. Example: 8 = 8 turns.`,
  synonyms: [
    "keep weather after new area",
    "weather on new biome",
    "re summon weather",
    "drizzle",
    "drought",
    "sand stream",
    "snow warning",
  ],
  examples: ["Set rain again for 8 turns when the area changes, like Drizzle"],
  params: [
    {
      id: "weather",
      ctorIndex: 0,
      path: "weatherType",
      control: "select",
      label: "Which weather",
      editable: true,
      default: "RAIN",
      options: enumOptions(WeatherType),
      codec: enumCodec(WeatherType, "weather"),
    },
    {
      id: "turns",
      ctorIndex: 1,
      path: "erTurns",
      control: "number",
      label: "How many turns the weather lasts (a Mystical Rock adds 2 per item)",
      editable: true,
      integer: true,
      min: 1,
      max: 20,
      step: 1,
      default: 8,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "A lasting weather (Extremely harsh sunlight, Heavy rain or Strong winds) must be active when the area changes",
    "The weather must differ from the current one, and no weather lock may be up",
    "The new length is written to whatever weather is active afterwards, if it has turns left",
    "Nothing happens while the game only previews the move",
  ],
  effect: { id: "effect.set-weather", params: ["weather", "turns"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a lasting weather in place, a normal weather in place, and clear skies",
      axes: { weather: ["HARSH_SUN", "RAIN", "NONE"] },
    },
  ],
  l2StaticReason:
    "The shared entry template never changes the biome, so the engine never asks this attr (decomp-l2-reach.json lists event.biome-changed as unreached); test/tests/elite-redux/decomp/B16/chunk2.test.ts drives the real attr against a real arena for the original and for the rebuild.",
  status: "decomposed",
  notes:
    "Tier A, fully decomposed like the entry half: trigger (new area), no IF (both canApply clauses are effect-side feasibility, as in the B06 declaration of the parent), one effect (set the weather) with two typed params. effect.set-weather has no length setting: R-B16-13 in requests/B16.md. Ten users, all 8 turns, each at attr 1 (attr 0 is ErWeatherSummonAbAttr): Drizzle (2) Rain, Drought (70) Sun, Sand Stream (45) Sandstorm, Snow Warning (117) Hail, Orichalcum Pulse (288) Sun, Seaborne (5232) Rain, Sand Bender (5445) Sandstorm, Supercell (5568) Rain, Sundae (5632) Hail, Solar Panel (6028) Sun. SUSPECTED GAME BUG, not fixed: the parent only runs while a LASTING weather is active (it was written for Desolate Land, Primordial Sea and Delta Stream), but these ten abilities set ORDINARY weathers. With a lasting weather up, an ordinary weather cannot replace it (arena.trySetWeather refuses and only prints the 'weather continues' message) and a lasting weather has no turns, so the length patch never runs; with an ordinary weather up the ability does not run at all. So the intended 'keep my weather in the new area' never happens and the only visible effect is the ability pop-up and the message while a lasting weather is active. The class comment claims the opposite.",
});
