/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B16 chunk 2, part 1 of 2 of the Elite Redux weather abilities (Tier A, event-effect). "When I enter the battle, set the weather and make
// it last a set number of turns."
//
// Source: init-elite-redux-vanilla-rebalance.ts, ErWeatherSummonAbAttr (extends PostSummonWeatherChangeAbAttr), put in place of the vanilla
// attr by patchWeatherSummoner (`new ErWeatherSummonAbAttr(weather, turns)`; all ten users pass 8 turns). Clauses:
//   canApply  the parent's, not overridden: two pieces of effect-side feasibility, kept in the class (as in the parent's declaration):
//             1. the current weather is replaceable: a primal one (Harsh Sun, Heavy Rain, Strong Winds) can only be replaced by another primal one
//             2. `arena.canSetWeather(weather)`: it differs from the current weather and no Clear Skies lock is up
//   apply     (skipped when `simulated`) 1. super.apply: `arena.trySetWeather(weather, holder)`  (base 5 turns, plus the Mystical Rock extender)
//             2. then, if the arena weather is THIS weather and still has turns left, its `turnsLeft` and `maxDuration` are overwritten with
//                `erFieldTurnsWithItems(holder, erTurns)` = erTurns plus the Mystical Rock (+2 turns per stack) extender. This keeps the item working.
// No random draw, no state. Constructor `(weather, turns)`: weather is argument 0 (parent), turns argument 1 (`erTurns`).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec, enumOptions } from "#data/elite-redux/ability-studio/param-codecs";
import { ErWeatherSummonAbAttr } from "#data/elite-redux/init-elite-redux-vanilla-rebalance";
import { WeatherType } from "#enums/weather-type";

export default defineDecl(ErWeatherSummonAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Set the weather for a set number of turns when I enter",
  summary: params =>
    `When I enter the battle, I set the weather to ${params.weather} for ${params.turns} turns (a Mystical Rock adds more). Example: 8 = the weather lasts 8 turns.`,
  synonyms: [
    "drizzle",
    "drought",
    "sand stream",
    "snow warning",
    "summon weather",
    "timed weather",
    "long weather",
    "weather setter",
  ],
  examples: ["Summon rain for 8 turns when I enter the battle, like Drizzle"],
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
    "The weather must be replaceable: a lasting weather (Extremely harsh sunlight, Heavy rain, Strong winds) cannot be overwritten by an ordinary one",
    "The weather must differ from the current one, and no weather lock may be up",
    "The new length is only written if the weather that is active afterwards is the one I set",
    "Nothing happens while the game only previews the entry",
  ],
  effect: { id: "effect.set-weather", params: ["weather", "turns"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "entry with the default field", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, fully decomposed: trigger (on entry), no IF (both canApply clauses are effect-side feasibility, like the parent declaration), one effect (set the weather) with two typed params. The library effect effect.set-weather has no length setting: requested as R-B16-13 in requests/B16.md (a `turns` param whose value replaces the 5-turn base and keeps the Mystical Rock extension; today the compiled rule would use the engine default). Ten users, all 8 turns, each at attr 0 (attr 1 is the matching ErBiomeChangeWeatherAbAttr): Drizzle (2) Rain, Drought (70) Sun, Sand Stream (45) Sandstorm, Snow Warning (117) Hail, Orichalcum Pulse (288) Sun, Seaborne (5232) Rain, Sand Bender (5445) Sandstorm, Supercell (5568) Rain, Sundae (5632) Hail, Solar Panel (6028) Sun. Nothing to bind: no closure. The parent PostSummonWeatherChangeAbAttr is declared separately and is the right block for the primal weathers. Oddity, not fixed: when the weather could not be set (already that weather) nothing runs; but if the weather is already the same one the ability does not refresh its length either (canSetWeather is false), which is the vanilla rule.",
});
