/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / calc modifier (a cancel check), Tier B (the weather test sits inside canApply). See ../PRECEDENTS.md.
//
// `WeatherEffectPhase` (weather-effect-phase.ts:101) asks every field Pokemon, once per damaging weather tick,
// `applyAbAttrs("PreWeatherDamageAbAttr", { pokemon, weather, cancelled })`; when `cancelled` comes back true that Pokemon
// takes no weather damage. canApply is now `guards && gate`, in the ORIGINAL clause order (no prepare, no residual, no draw):
//   1. guard  `!weather || cancelled.value` is false   there is a weather and nothing blocked the damage yet
//   2. gate   `weatherTypes.length === 0 || weatherTypes.includes(weather.weatherType)`
//             the weather is one of the listed ones; an EMPTY list means "every weather" (Overcoat), bound as any of all 13 weathers  <- staff may replace it
// apply sets `cancelled.value = true`. No random draw, `simulated` is never read.
import { BlockWeatherDamageAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumListCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { WeatherType } from "#enums/weather-type";

export default defineDecl(BlockWeatherDamageAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "cancel.weather-damage",
  label: "Take no weather damage",
  summary: params =>
    params.weathers === ""
      ? "I take no end-of-turn damage from any weather. Example: no sandstorm or hail chip damage, like Overcoat."
      : `I take no end-of-turn damage from these weathers: ${params.weathers}. Example: no sandstorm chip damage, like Sand Veil.`,
  synonyms: [
    "sand veil",
    "overcoat",
    "ice body",
    "no sandstorm damage",
    "no hail damage",
    "weather immunity",
    "weather chip immunity",
  ],
  examples: [
    "No damage in a sandstorm, like Sand Veil",
    "No damage from hail or snow, like Slush Rush",
    "Immune to every weather, like Overcoat",
  ],
  params: [
    {
      id: "weathers",
      ctorIndex: 0,
      path: "weatherTypes",
      control: "text",
      // The list is also the gate ("the weather is one of these"), which staff edit through the gate block. This list only
      // feeds the class's own default gate, so editing it alone would not move a replaced gate.
      label: "Weathers it protects from (comma separated names, empty = every weather)",
      editable: false,
      default: "SANDSTORM",
      codec: enumListCodec(WeatherType, "weather"),
      spread: true,
    },
  ],
  conditions: [
    // The gate: "the weather is one of these" (any of field.weather). Each user's binding repeats its list; Overcoat (empty list =
    // every weather) is bound to any of all 13 weathers.
    { slot: "gate", ctx: "params", lib: "field.weather", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Does nothing when there is no weather",
    "Does nothing when the damage was already blocked by something earlier",
  ],
  effect: { id: "effect.negate", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      name: "each weather is up while the holder sits through the turn end",
      axes: { weather: ["SANDSTORM", "HAIL", "SNOW", "RAIN", "NONE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, split after review: the weather test is the gate (any of field.weather, bound per user in bindings.ts), `!weather || cancelled.value` stays first as the class `guards`. Overcoat (142 attr 0, empty list = every weather) is bound to any of all 13 weather atoms, which is always true (the class gate is also always true for an empty list), the original behaviour. 20 abilities, 21 attrs. Lists as read from the live attrs: SANDSTORM = Sand Veil 8 attr 1, Sand Rush 146 attr 1, Sand Force 159 attr 0, Desert Spirit 5311 attr 2, Sand Bender 5445 attr 2, Sepia Lens 5506 attr 3, Sand Fiend 5601 attr 0; HAIL = Ice Body 115 attr 0 and 5953 attr 0, North Wind 5086 attr 1, Molten Core 5573 attr 2, Sundae 5632 attr 3; HAIL and SNOW = Slush Rush 202 attr 1, Whiteout 5007 attr 1, Christmas Spirit 5021 attr 1, Ice Cold Hunter 5348 attr 1, Glacial Ghost 5526 attr 1, Thermal Slide 5563 attr 1, Ice Picks 5633 attr 2; SANDSTORM, HAIL and SNOW = Guardian Coat 5539 attr 1. Sand Bender, Sand Fiend, Glacial Ghost and Ice Picks carry an ability-level condition added by composed upgrades (extraCondition), which the rebuild copies. The `weathers` list is not editable on purpose (a list cannot be repeated inside the gate atoms): staff change the weathers through the gate block. field.weather reads the arena weather, which is the `weather` the phase passes (weather-effect-phase.ts passes this.weather). Observation, not fixed: only Sandstorm, Hail, Tempest storm and Snowy wrath deal weather damage (Weather.isDamaging), so plain Snow in the lists above is harmless. The engine also checks other attrs in the same tick (BlockNonDirectDamageAbAttr, SuppressWeatherEffectAbAttr), each its own declaration. The class never reads `simulated`.",
});
