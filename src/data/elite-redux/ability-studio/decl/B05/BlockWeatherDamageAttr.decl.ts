/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / calc modifier (a cancel check), Tier A (the weather list is a constructor argument). See ../PRECEDENTS.md.
//
// `WeatherEffectPhase` (weather-effect-phase.ts:101) asks every field Pokemon, once per damaging weather tick,
// `applyAbAttrs("PreWeatherDamageAbAttr", { pokemon, weather, cancelled })`; when `cancelled` comes back true that Pokemon
// takes no weather damage. canApply, in the original order:
//   1. `!weather || cancelled.value`  feasibility: there is no weather, or an earlier ability already blocked the damage
//   2. `weatherTypes.length === 0 || weatherTypes.includes(weather.weatherType)`
//      This IS the `weathers` setting, so it is a parameter and not a gate. An EMPTY list means "every weather" (Overcoat).
// apply sets `cancelled.value = true`. No random draw, `simulated` is never read.
import { BlockWeatherDamageAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumListCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { WeatherType } from "#enums/weather-type";

export default defineDecl(BlockWeatherDamageAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "cancel.weather-damage",
  label: "Take no damage from chosen weather",
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
      label: "Weathers it protects from (comma separated names, empty = every weather)",
      editable: true,
      default: "SANDSTORM",
      codec: enumListCodec(WeatherType, "weather"),
      spread: true,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Does nothing when there is no weather",
    "Does nothing when the damage was already blocked by something earlier",
  ],
  effect: { id: "effect.negate", params: ["weathers"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      name: "the weather the holder blocks is up and it sits through three turn ends",
      axes: {},
    },
  ],
  status: "decomposed",
  notes:
    "Tier A, no gate: the weather list is the constructor argument and the only test in canApply besides feasibility, so it is a setting (an empty list means every weather, used by Overcoat only). 20 abilities, 21 attrs, nothing to bind (no closure). Lists as read from the live attrs: SANDSTORM = Sand Veil 8, Sand Rush 146, Sand Force 159, Desert Spirit 5311, Sand Bender 5445, Sepia Lens 5506, Sand Fiend 5601; HAIL = Ice Body 115 and 5953, North Wind 5086, Molten Core 5573, Sundae 5632; HAIL and SNOW = Slush Rush 202, Whiteout 5007, Christmas Spirit 5021, Ice Cold Hunter 5348, Glacial Ghost 5526, Thermal Slide 5563, Ice Picks 5633; SANDSTORM, HAIL and SNOW = Guardian Coat 5539; empty (every weather) = Overcoat 142. Sand Bender, Sand Fiend, Glacial Ghost and Ice Picks carry an ability-level condition added by composed upgrades (extraCondition), which the rebuild copies. Observation, not fixed: only Sandstorm, Hail, Tempest storm and Snowy wrath deal weather damage (Weather.isDamaging), so plain Snow in the lists above is harmless and no user lists the last two. The engine also checks other attrs in the same tick (BlockNonDirectDamageAbAttr, SuppressWeatherEffectAbAttr), each its own declaration. The class never reads `simulated`.",
});
