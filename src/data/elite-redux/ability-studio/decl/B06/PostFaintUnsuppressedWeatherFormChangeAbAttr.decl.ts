/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06 chunk 3, Tier C event-effect with a one-piece effect. See ../PRECEDENTS.md.
//
// "When I faint, let the weather-form Pokemon look at the weather again" (Cloud Nine, Air Lock, In the Clouds). While a holder suppresses the
// weather, Castform with Forecast and Cherrim with Flower Gift stay in their normal form; once it faints they must change. The class has no
// argument and no closure. Clauses (ab-attrs.ts, PostFaintUnsuppressedWeatherFormChangeAbAttr):
//   canApply  `getPokemonWithWeatherBasedForms().length > 0`: some Pokemon on the field is a Castform with Forecast or a Cherrim with Flower
//             Gift (read through the engine queries). Feasibility: when there is none the effect would change nothing.
//   apply     (skips simulated) `globalScene.arena.triggerWeatherBasedFormChanges()`: every such Pokemon gets the weather form trigger.
// Dispatched by faint-phase.ts through PostFaintAbAttr (with the last attacker and move, or none after indirect damage); the abilities carry
// `.bypassFaint()` so the fainted holder is still asked.
import { PostFaintUnsuppressedWeatherFormChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostFaintUnsuppressedWeatherFormChangeAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.faint",
  label: "Update weather forms (Castform, Cherrim) when I faint",
  summary: () =>
    "When I faint, Pokemon whose form follows the weather, like Castform and Cherrim, check the weather again and change form. Example: Castform turns Sunny once Cloud Nine faints.",
  synonyms: ["cloud nine", "air lock", "weather forms return", "castform", "cherrim", "weather form refresh"],
  examples: ["When I faint, Castform changes form with the weather again, like Cloud Nine"],
  params: [],
  noParamsReason:
    "All or nothing: the class has no constructor argument and always asks every weather-form Pokemon to look at the weather again.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only matters when a Castform with Forecast or a Cherrim with Flower Gift is on the field",
    "Does nothing in a simulated preview",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The shared faint scenario never evaluates this attr (canApply is false without a Castform or Cherrim on the field, and the trace records only evaluated attrs of the holder), so the twin would prove nothing. test/tests/elite-redux/decomp/B06/b06-chunk3.test.ts drives the real attrs of Cloud Nine, Air Lock and In the Clouds and their rebuilds with and without a Castform with Forecast on the field.",
  probes: [{ name: "fainting in different weather", axes: { weather: ["NONE", "SUNNY", "RAIN"] } }],
  status: "decomposed",
  notes:
    "PACKAGE for the effect, written reason: no library effect re-runs the weather form changes of the field (request R-B06-20: effect.refresh-weather-forms). The only condition, that a weather-form Pokemon exists, is feasibility: without one the effect is a no-op, so it is not offered as a switch. Users (3 attrs, no closure): Cloud Nine (13, attr 3), Air Lock (76, attr 3) and In the Clouds (6020, attr 4). The sibling PostSummonWeatherSuppressedFormChangeAbAttr does the same on entry and is a separate class. The class never reads the attacker or the move of the faint call.",
});
