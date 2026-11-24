/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / event effect, Tier B (the weather test is the class's own getCondition, a gate). See ../PRECEDENTS.md.
//
// Same moment as the heal class: `WeatherEffectPhase` (weather-effect-phase.ts:135) asks every field Pokemon that is not switched
// out, once per weather turn, `applyAbAttrs("PostWeatherLapseAbAttr", { pokemon, weather })`. In the engine's order:
//   1. gate      `getCondition()` = `getWeatherCondition(...weatherTypes)`     <- staff may replace it (gateOverride in the base class)
//                (false while the weather effect is switched off, true when the arena weather is a listed one, and for a SUNNY /
//                HARSH_SUN list also true in Grassy Terrain while someone on the field has Reap and Sow; ab-attrs.ts:7735)
//   2. residual  `canApply` = `!pokemon.hasAbilityWithAttr("BlockNonDirectDamageAbAttr")`   feasibility, stays in the class
//   3. apply     not when `simulated`; queue the message "abilityTriggers:postWeatherLapseDamage", THEN
//                `pokemon.damageAndUpdate(toDmgValue(maxHp / (16 / damageFactor)), { result: HitResult.INDIRECT })`
// No guard, no prepare step, no random draw. The constructor is `(damageFactor, ...weatherTypes)`.
import { PostWeatherLapseDamageAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumListCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { WeatherType } from "#enums/weather-type";

export default defineDecl(PostWeatherLapseDamageAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.weather-each-turn",
  label: "Lose a share of max HP each turn in a chosen weather",
  summary: params =>
    `Each turn in ${params.weathers} I lose ${params.sixteenths}/16 of my max HP, rounded down, unless indirect damage is blocked. Example: 2 = 1/8, like Dry Skin in harsh sun.`,
  synonyms: [
    "dry skin",
    "sun damage",
    "hurt in sun",
    "lose hp in sun",
    "weather damage",
    "weather chip damage",
    "sunburn",
  ],
  examples: [
    "Lose 1/8 of max HP every turn in harsh sunlight, like Dry Skin",
    "Lose 1/16 of max HP every turn in a sandstorm",
  ],
  params: [
    {
      id: "sixteenths",
      ctorIndex: 0,
      path: "damageFactor",
      control: "number",
      min: 1,
      max: 16,
      step: 1,
      integer: true,
      label: "Sixteenths of max HP lost each turn (1 = 1/16, 2 = 1/8, 16 = everything)",
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
      label: "Weathers that hurt me (comma separated names)",
      editable: false,
      default: "SUNNY,HARSH_SUN",
      codec: enumListCodec(WeatherType, "weather"),
      spread: true,
    },
  ],
  conditions: [
    // The gate: "one of these weathers is in effect". NOT the library atom field.weather (switched-off weather, Reap and Sow):
    // request R-B05-25.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Does nothing while I am protected from indirect damage (like Magic Guard)",
    "Nothing happens during a simulated check",
  ],
  // No library effect takes a share of max HP as indirect damage with the ability message (R-B05-27), so the effect is a package
  // with the one setting it uses.
  effect: { id: "effect.package", params: ["sixteenths"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "each weather is up while the holder sits through the weather tick",
      axes: { weather: ["SUNNY", "RAIN", "SANDSTORM", "NONE"], hp: ["max", "max-1", "50%"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, split in the base class like the heal class: the weather test (getCondition) is the gate with a `gateOverride`; `canApply` (no indirect-damage block) is the residual and is untouched. The gate is bound `legacy-closure` pending R-B05-25 (suppression and Reap and Sow are not in field.weather), so the attr is not rebuilt by L1 or L2; chunk4-sites.test.ts compares original and override rebuild instead. The residual is a check by ability identity (`hasAbilityWithAttr`), the same kind of query as R-B05-15; it stays in the class and is shown as a safety line, and R-B05-28 asks for it as a named guard. Effect is a package ONLY for lack of a library effect (R-B05-27). One user: Dry Skin (87 attr 0, SUNNY and HARSH_SUN, factor 2). Solar Power (762) is also constructed with this class in init-abilities.ts, but patchSolarPower in init-elite-redux-vanilla-rebalance.ts removes that attr, so the live Solar Power has none (the L0 inventory lists only Dry Skin). Observation, not fixed: unlike the weather chip damage in WeatherEffectPhase, this one has no immunity for the Underground or Underwater semi-invulnerable states and no Weathervane or Safety Goggles check; the message is queued before the damage.",
});
