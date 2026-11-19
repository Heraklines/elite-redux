/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PRECEDENT: event-effect (Tier A, no condition slot). See ../PRECEDENTS.md.
//
// "When I enter the battle, set the weather". The class has one constructor argument and no closure, so there is
// nothing to bind: every user (Drizzle-style abilities, Desolate Land, Primordial Sea, Delta Stream) is fully
// described by the `weather` param. `canApply` is entirely effect-side feasibility ("the weather can be set"), so it
// stays in the class and the declaration lists it as feasibility.
import { PostSummonWeatherChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec, enumOptions } from "#data/elite-redux/ability-studio/param-codecs";
import { WeatherType } from "#enums/weather-type";

export default defineDecl(PostSummonWeatherChangeAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Set the weather when I enter",
  summary: params => `When I enter the battle, set the weather to ${params.weather}`,
  synonyms: ["summon weather", "drizzle", "drought", "sand stream", "snow warning", "weather setter"],
  examples: ["Summon rain when I enter the battle"],
  params: [
    {
      id: "weather",
      ctorIndex: 0,
      path: "weatherType",
      control: "select",
      label: "Weather",
      editable: true,
      default: "RAIN",
      options: enumOptions(WeatherType),
      codec: enumCodec(WeatherType, "weather"),
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "The weather must be replaceable: a primal weather (Heavy Rain, Harsh Sun, Strong Winds) cannot be overwritten by an ordinary one",
    "The arena must accept this weather (it is not already active)",
  ],
  effect: { id: "effect.set-weather", params: ["weather"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "entry with the default field", axes: {} }],
  status: "verified",
  notes:
    "Precedent for a plain event-effect. canApply is two pieces of feasibility (weather replaceable, arena.canSetWeather) that stay in the class. apply honours `simulated`.",
});
