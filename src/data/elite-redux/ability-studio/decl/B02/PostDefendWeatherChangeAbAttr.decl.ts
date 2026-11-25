/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 1. "When I am hit, change the weather" (Sand Spit, Cryo Proficiency's hail).
//
// Tier A: the only condition is an optional constructor closure (a PokemonDefendCondition at argument 1, stored in the
// protected `condition` field only when given). canApply is `closure passes && weather is not immutable &&
// arena.canSetWeather(...)`; the closure is the staff-editable IF, the last two clauses are feasibility and stay in the
// class. No class edit needed. Sand Spit passes `move.category !== STATUS` (library atom move.damaging, whose formula is
// exactly that), Cryo Proficiency passes nothing (the field stays absent, so it needs no binding).
import { PostDefendWeatherChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec, enumOptions } from "#data/elite-redux/ability-studio/param-codecs";
import { WeatherType } from "#enums/weather-type";

export default defineDecl(PostDefendWeatherChangeAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Change the weather when I am hit",
  summary: params =>
    `When I am hit, the weather changes to ${params.weather}. Add a condition to limit which hits count.`,
  synonyms: [
    "sand spit",
    "weather on hit",
    "summon weather when hit",
    "sandstorm on hit",
    "hail when hit",
    "hit trigger weather",
  ],
  examples: ["Whip up a sandstorm when a damaging move hits me, like Sand Spit"],
  params: [
    {
      id: "weather",
      ctorIndex: 0,
      path: "weatherType",
      control: "select",
      label: "Weather",
      editable: true,
      default: "SANDSTORM",
      options: enumOptions(WeatherType),
      codec: enumCodec(WeatherType, "weather"),
    },
  ],
  conditions: [{ slot: "ctor:1", ctx: "defend", path: "condition", removable: true, editable: true, optional: true }],
  guards: [],
  feasibility: [
    "The weather must be replaceable: a primal weather (Heavy Rain, Harsh Sun, Strong Winds) cannot be overwritten by an ordinary one",
    "The arena must accept this weather (it is not already active)",
  ],
  effect: { id: "effect.set-weather", params: ["weather"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // A damaging move (Water Gun) and a status move (Growl): Sand Spit's condition must only pass the first.
      name: "damaging and status hit",
      axes: { foeMove: ["WATER_GUN", "LEER"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier A. Two users: Sand Spit (sandstorm, closure `(_target, _user, move) => move.category !== MoveCategory.STATUS`, bound as move.damaging, which is `move.category !== STATUS` in matchesAbilityStudioMoveFilter) and Cryo Proficiency (hail, no closure, attr 4 of its ability). `apply` honours `simulated`. Probe note: in Elite Redux Growl is a Special damaging move (init-elite-redux-vanilla-move-patches.ts:288), so the status-move probe uses Leer. Same shape as the precedent PostSummonWeatherChangeAbAttr: both clauses after the closure are feasibility.",
});
