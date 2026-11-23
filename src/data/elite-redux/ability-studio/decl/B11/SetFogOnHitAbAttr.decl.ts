/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 4 / event-effect (Tier B: both clauses of canApply are the gate).
//
// Read by hand from archetypes/set-fog-on-hit.ts. PostDefend hook (WHEN "after I am hit"), constructor `(weather?, turns?)` with the
// defaults Eerie Fog and 8 turns (the arguments were added by this chunk so the two fixed values are typed settings; `new
// SetFogOnHitAbAttr()` is exactly the old class); `super()` with the default banner (showAbility true, on purpose: see the class).
//   canApply is now `gate` alone (no guard, no residual), in the ORIGINAL clause order:
//     1. `!move?.is("AttackMove")` -> false                          (CONDITION: no atom yet, request R-B11-C4-08)
//     2. the active weather (`arena.weather?.weatherType`) is already the weather to set -> false   (CONDITION: not field.weather)
//   apply: simulated -> nothing. Else `arena.trySetWeather(weather, holder, turns)`; the arena refuses what cannot be set (a primal
//   weather in the way, `canSetWeather`): that is effect-side feasibility and stays in the class. No random draw.
//
// The effect is the library effect.set-weather; the `weather` setting feeds both the effect and the "not already up" test through
// `gateParams`, and `turns` is only read by the effect.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec, enumOptions } from "#data/elite-redux/ability-studio/param-codecs";
import { SetFogOnHitAbAttr } from "#data/elite-redux/archetypes/set-fog-on-hit";
import { WeatherType } from "#enums/weather-type";

export default defineDecl(SetFogOnHitAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Set the weather when an attack hits me",
  summary: params =>
    `When an attack hits me, the weather becomes ${params.weather} for ${params.turns} turns, unless it already is. Example: Eerie fog for 8 turns, like Fog Machine.`,
  synonyms: [
    "fog machine",
    "weather on hit",
    "summon weather when hit",
    "eerie fog",
    "set fog when attacked",
    "sand spit",
  ],
  examples: ["Summon Eerie fog for 8 turns when an attack hits me", "Make it rain whenever I am hit"],
  params: [
    {
      id: "weather",
      ctorIndex: 0,
      path: "weather",
      control: "select",
      label: "Weather to set",
      editable: true,
      default: "EERIE_FOG",
      options: enumOptions(WeatherType).filter(name => name !== "NONE"),
      codec: enumCodec(WeatherType, "weather"),
    },
    {
      id: "turns",
      ctorIndex: 1,
      path: "turns",
      control: "number",
      min: 1,
      max: 20,
      step: 1,
      integer: true,
      label: "How many turns the weather lasts (8 is the usual length)",
      editable: true,
      gateIndependent: true,
      default: 8,
    },
  ],
  gateParams: [{ param: "weather", block: "field.weather", field: "weather" }],
  conditions: [{ slot: "gate", ctx: "params", removable: true, editable: true }],
  guards: [],
  feasibility: [
    "Never in a preview",
    "The weather must be allowed to change: a primal weather (Heavy Rain, Harsh Sun, Strong Winds) cannot be overwritten by an ordinary one",
    "Items such as Damp Rock style extenders still add turns on top, as for every weather setter",
  ],
  effect: { id: "effect.set-weather", params: ["weather", "turns"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "being hit in clear weather and in Eerie fog",
      axes: { weather: ["NONE", "EERIE_FOG", "RAIN"], foeMove: ["TACKLE", "GROWL"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, justified in the header. Only user: Fog Machine (5606, Eerie fog, 8 turns). The gate is a LEGACY CLOSURE for now: its first clause is the engine class test `move.is('AttackMove')`, which is NOT the atom move.damaging (`category !== STATUS`): the L1 grid found 9 moves where they differ (Whirlwind, Growl, Poison Gas, Flash, Splash, Nightmare, Captivate, Octolock, Decorate: status moves whose data category is Physical or Special), so a rebuilt gate would trigger on them. Needs the atom of request R-B11-C4-08; the second clause (the weather is not already up) maps to not(field.weather) and becomes a library block with it. The weather test: the class reads the raw `arena.weather?.weatherType`, the atom reads `arena.weatherType` (`weather?.weatherType ?? NONE`): the same for every real weather (clear weather is not offered as a setting, because with no weather the class says 'not up' and the atom would say 'up'). The `weather` setting is read by the class gate itself (gateParams will write it into the atom once the gate is library blocks). The Mystical Rock style turn extender applies inside trySetWeather. Remark, NOT fixed: the 'already up' test ignores the turn count, so a hit while Eerie fog is up never refreshes it.",
});
