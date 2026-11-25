/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 5. "I take less damage while certain weather is on" (Christmas Spirit: half in hail or snow, Dune Terror: 35% less in a sandstorm).
//
// Source: src/data/elite-redux/archetypes/weather-terrain-interaction.ts, WeatherDamageReductionAbAttr (extends ReceivedMoveDamageMultiplierAbAttr).
// Constructor: one options object `{ weathers, multiplier }`; it throws for a multiplier outside (0, 1] and for no weather. It hands the parent the closure
// `() => weatherListIsActive(weathers)` (shared helper) and the multiplier; `showAbility` is off and `affectsFixedDamage` is left at its default false.
// Dispatched while the game calculates the damage the holder takes (applyAbAttrs("ReceivedMoveDamageMultiplierAbAttr")). Clauses, in the original order (Tier B). The old
// canApply was the parent's `condition(target, attacker, move)`, which here asks only:
//   canApply 1  the weather is not switched off (Cloud Nine / Air Lock) and is one of `weathers`   GATE (replaceable): no atom yet (R-B12-39). It never looks at the move or the attacker.
//   apply       the parent's: `damage = toDmgValue(damage * multiplier)`                           EFFECT (calc)
// No random draw, no state, no `simulated` test.
//
// `weathers` is not editable: it decides the shape of the gate, which staff change with the weather blocks.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { WeatherDamageReductionAbAttr } from "#data/elite-redux/archetypes/weather-terrain-interaction";
import { requiredWeatherListCodec } from "./b12-chunk5-codecs";

const IN_OPTIONS = { ctorIndex: 0 } as const;

export default defineDecl(WeatherDamageReductionAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.damage-taken",
  label: "Take less damage while certain weather is active",
  summary: params =>
    `While ${params.weathers} is on, the damage I take is multiplied by ${params.multiplier}. Weather that Cloud Nine or Air Lock switches off does not count. Example: 0.5 = half damage in hail.`,
  synonyms: [
    "christmas spirit",
    "dune terror",
    "resist in weather",
    "half damage in hail",
    "less damage in a sandstorm",
    "weather damage reduction",
    "bulky in weather",
    "tank in snow",
  ],
  examples: [
    "Take half damage in hail or snow, like Christmas Spirit",
    "Take 35% less damage in a sandstorm, like Dune Terror",
  ],
  params: [
    {
      id: "multiplier",
      ...IN_OPTIONS,
      ctorOption: "multiplier",
      path: "reductionMultiplier",
      control: "number",
      min: 0.05,
      max: 1,
      step: 0.05,
      label: "Damage multiplier (0.5 = half damage, 1 = no change)",
      editable: true,
      // Only the effect reads it; the gate (the weather) never repeats it.
      gateIndependent: true,
      default: 0.5,
    },
    {
      id: "weathers",
      ...IN_OPTIONS,
      ctorOption: "weathers",
      path: "weathers",
      control: "text",
      label: "Weather that switches it on, like 'Hail, Snow' (at least one)",
      // It decides the shape of the gate, which staff change with the weather blocks.
      editable: false,
      default: "Hail, Snow",
      codec: requiredWeatherListCodec,
    },
  ],
  conditions: [
    // The gate: one of the listed weathers is on and its effects are not switched off. No atom asks both questions yet (R-B12-39), so both users are a legacy-closure.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["Damage that is a fixed amount is not changed"],
  effect: { id: "effect.multiply-damage-taken", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      // Both users' weathers and a weather that is not listed, with a special, a physical contact and a Fire move.
      name: "the listed weathers, another weather and no weather, against several foe moves",
      axes: { weather: ["HAIL", "SNOW", "SANDSTORM", "RAIN", "NONE"], foeMove: ["WATER_GUN", "BITE", "EMBER"] },
    },
  ],
  l2StaticReason:
    "Both users are legacy-closures today (the weather test has no library atom, R-B12-39), so there is nothing to rebuild for a twin. B12/chunk5.test.ts runs the class on the live attr and on a fresh build for every weather, with and without Cloud Nine, and checks the rounding of the damage.",
  status: "decomposed",
  notes:
    "legacy-closure-pending-request: Tier B, 2 attrs, both legacy-closure until the library has the atom 'one of these weathers is on and not switched off' (R-B12-39, the same formula as R-B02-35). Users: Christmas Spirit 5021 attr 0 (Hail or Snow, x0.5; its second attr is a weather-damage block, another class) and Dune Terror 5167 attr 0 (Sandstorm, x0.65; its Ground boost is TypeDamageBoostAbAttr, chunk 3). The old canApply was the parent's call of the constructor closure; it is now the shared helper `weatherListIsActive`, read by the closure the constructor still hands the parent and by `gate`. The effect is the parent's (`toDmgValue(damage * multiplier)`, rounded and at least 1), the library effect multiply-damage-taken; `affectsFixedDamage` stays false (the constructor does not pass it). The class accepts the weather None in its list (then it would fire with no weather), but the staff list never offers it and no user lists it. The reduction applies to every incoming hit regardless of its type, category or attacker. The ability banner is hidden.",
});
