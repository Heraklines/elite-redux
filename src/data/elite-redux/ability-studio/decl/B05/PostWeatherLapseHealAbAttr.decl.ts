/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / event effect, Tier B (the weather test is the class's own getCondition, a gate). See ../PRECEDENTS.md.
//
// `WeatherEffectPhase` (weather-effect-phase.ts:135), once per weather turn and for every field Pokemon that is not switched
// out: `applyAbAttrs("PostWeatherLapseAbAttr", { pokemon, weather })`. The engine asks, in this order (apply-ab-attrs.ts:126):
//   1. gate      `getCondition()` = `getWeatherCondition(...weatherTypes)`      <- staff may replace it (gateOverride, see below)
//                (ab-attrs.ts:7735: false while the weather effect is switched off (Cloud Nine, Air Lock), true when the arena
//                weather is one of the listed ones, and for a SUNNY / HARSH_SUN list also true in Grassy Terrain while someone
//                on the field has Reap and Sow)
//   2. residual  `canApply` = `!pokemon.isFullHp()`                              feasibility, stays in the class
//   3. apply     not when `simulated`; queue a PokemonHealPhase of `toDmgValue(maxHp / (16 / healFactor))` with the message
//                "abilityTriggers:postWeatherLapseHeal" (the ability name comes from `resolveTriggerAbility`)
// No guard, no prepare step, no random draw. The gate lives in the BASE class (`PostWeatherLapseAbAttr`): `gateOverride` is
// declared there and `getCondition` returns a closure that calls it (with the holder and the arena weather, exactly what the
// dispatch passes) when it is set; untouched it is the original `getWeatherCondition(...)`. The constructor is
// `(healFactor, ...weatherTypes)`.
import { PostWeatherLapseHealAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumListCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { WeatherType } from "#enums/weather-type";

export default defineDecl(PostWeatherLapseHealAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.weather-each-turn",
  label: "Heal a share of max HP each turn in a chosen weather",
  summary: params =>
    `Each turn while one of these weathers is active (${params.weathers}), I heal ${params.sixteenths}/16 of my max HP, rounded down. Example: 2 heals 1/8 of max HP, like Rain Dish in rain.`,
  synonyms: [
    "rain dish",
    "ice body",
    "dry skin",
    "heal in rain",
    "heal in hail",
    "heal in snow",
    "weather healing",
    "weather regeneration",
    "recover in weather",
  ],
  examples: [
    "Heal 1/8 of max HP every turn in rain, like Rain Dish",
    "Heal 1/8 of max HP every turn in hail or snow, like Ice Body",
  ],
  params: [
    {
      id: "sixteenths",
      ctorIndex: 0,
      path: "healFactor",
      control: "number",
      min: 1,
      max: 16,
      step: 1,
      integer: true,
      label: "Sixteenths of max HP healed each turn (1 = 1/16, 2 = 1/8, 16 = everything)",
      editable: true,
      gateIndependent: true,
      default: 2,
    },
    {
      id: "weathers",
      ctorIndex: 1,
      path: "weatherTypes",
      control: "text",
      // The list is also the gate ("the weather is one of these"), which staff edit through the gate block. This list only
      // feeds the class's own default gate, so editing it alone would not move a replaced gate.
      label: "Weathers that heal me (comma separated names)",
      editable: false,
      default: "RAIN,HEAVY_RAIN",
      codec: enumListCodec(WeatherType, "weather"),
      spread: true,
    },
  ],
  conditions: [
    // The gate: "one of these weathers is in effect". NOT the library atom field.weather: the class's own test also says no while
    // Cloud Nine or Air Lock switch the weather off, and yes in Grassy Terrain with Reap and Sow for a sun list (request R-B05-25).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Does nothing when I am already at full HP (so the ability does not flash for nothing)",
    "Nothing happens during a simulated check",
  ],
  // The library's heal-percent effect takes whole percents, shows no message and cannot say "sixteenths" (R-B05-26), so the
  // effect is a package with the one setting it uses.
  effect: { id: "effect.package", params: ["sixteenths"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "each weather is up while the holder is hurt or at full HP at the weather tick",
      axes: { weather: ["RAIN", "SUNNY", "HAIL", "SNOW", "NONE"], hp: ["max", "max-1", "50%"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, split in the base class: the weather test (getCondition) is the gate and gets a `gateOverride`; `canApply` (`!isFullHp()`) is the residual and is untouched. The gate has NO library form yet: the class test also reads Weather.isEffectSuppressed and the Reap and Sow rule, which field.weather does not, so every user's gate is bound `legacy-closure` pending R-B05-25 and none of the five attrs is rebuilt by L1 or L2 (the weather tick, event.weather-each-turn, is also a WHEN the L2 templates do not reach). Their equality is proven by test/tests/elite-redux/decomp/B05/chunk4-sites.test.ts instead: original vs a rebuild with the override set, and the unset path against the class's own rule. The effect is a package ONLY because no library effect heals a sixteenths share with the ability message (R-B05-26); the moment, the weather test and the number are separate. Users, all five with healFactor 2 as read from the live attrs: Rain Dish (44 attr 0, RAIN and HEAVY_RAIN), Dry Skin (87 attr 1, RAIN and HEAVY_RAIN), Ice Body (115 attr 1, HAIL and SNOW), Sundae (5632 attr 4, HAIL and SNOW), Ice Body of the second dex (5953 attr 1, HAIL and SNOW). Rain Dish and Ice Body are built with 1 and then raised to 2 by init-elite-redux-vanilla-rebalance.ts (mutateHealFactor writes the private field after construction), so the live value is the one the param reads. Observation, not fixed: Ice Body also lists SNOW but plain Snow never damages (see BlockWeatherDamageAttr), so the heal in Snow is the only snow effect. The heal is queued with the full-HP message flag set, but canApply already refuses at full HP, so that message is unreachable. The class does not look at who owns the ability slot: a passive copy heals the same way.",
});
