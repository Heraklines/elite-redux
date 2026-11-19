/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 / Tier A event-effect, no closure, no setting (Air Lock, Cloud Nine, In the Clouds).
//
// Clause classification (src/data/abilities/ab-attrs.ts, PostSummonWeatherSuppressedFormChangeAbAttr):
//   canApply  `getPokemonWithWeatherBasedForms().length > 0`  -> FEASIBILITY (effect-side: there must be a Castform with
//             Forecast or a Cherrim with Flower Gift on the field, either side; the helper asks abilityQuery). It stays
//             in the class: nothing in the library can say "a weather-form Pokemon exists" and removing it would only
//             make the ability flash for nothing.
//   apply     `if (!simulated) arena.triggerWeatherBasedFormChangesToNormal()`  -> the EFFECT (it loops over every
//             Pokemon on the field and fires SpeciesFormChangeRevertWeatherFormTrigger). No library DO matches (the
//             library "Return to the base form" only changes the holder), so it is listed as a one-piece effect and a
//             precise request sits in requests/B04.md (effect.revert-weather-forms).
// No RNG. No closure, so no binding is needed. The three users are fully described by this declaration.
import { PostSummonWeatherSuppressedFormChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostSummonWeatherSuppressedFormChangeAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Return weather-based forms to normal when I enter",
  summary: () =>
    "When I enter the battle, every Pokemon on the field that changes form with the weather (Castform, Cherrim) goes back to its normal form. Nothing happens if there is none.",
  synonyms: [
    "air lock",
    "cloud nine",
    "undo weather form",
    "castform normal form",
    "cherrim normal form",
    "end weather forms",
  ],
  examples: ["Turn Castform and Cherrim back to normal when I enter, like Air Lock"],
  params: [],
  noParamsReason:
    "The effect has no numbers or choices: it always looks at every Pokemon on the field and reverts the weather forms (Castform with Forecast, Cherrim with Flower Gift).",
  conditions: [],
  guards: [],
  feasibility: [
    "At least one Pokemon on the field (either side) must be a Castform with Forecast or a Cherrim with Flower Gift",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "enter under different weather", axes: { weather: ["NONE", "SUNNY", "RAIN"] } }],
  status: "decomposed",
  notes:
    "Users: Air Lock (attr 2), Cloud Nine (attr 2), In the Clouds (attr 3). The default L1/L2 holder is Blissey and the foe a Magikarp, so the grid never has a weather-form Pokemon on the field and canApply is false there; test/tests/elite-redux/decomp/B04/b04-attrs.test.ts proves the true case with a real Castform (Forecast) on the field, original against rebuild. canApply does not read `simulated` (it is a pure query); apply honours it. The attr is replayed after an in-battle form change: apply-ab-attrs.ts only excludes PostSummonFormChangeAbAttr and PostSummonFormChangeByWeatherAbAttr from that replay and shouldActivateOnFormChange is true here. Effect is a one-piece DO until the librarian adds effect.revert-weather-forms (requests/B04.md).",
});
