/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
// B09 chunk 1. "When I enter the battle, my side gets Tailwind and the weather is cleared" (Air Lock, the ER rider).
//
// Source: src/data/elite-redux/archetypes/entry-tailwind-clear-weather.ts, class EntryTailwindClearWeatherAbAttr (extends
// PostSummonAbAttr). Dispatched when the holder enters (`applyAbAttrs("PostSummonAbAttr")`). The class has NO canApply (the parent's
// is always true) and every test sits in `apply`, in this order:
//   1. `simulated`                                                   -> do nothing
//   2. `arena.addTag(TAILWIND, TAILWIND_TURNS = 3, undefined, pokemon.id, ownSide)`   the holder's own side (player or enemy)
//   3. `arena.weather && !arena.weather.isImmutable()`               -> `arena.trySetWeather(WeatherType.NONE)`: clear the weather;
//      a primal weather (Harsh Sun, Heavy Rain, Strong Winds) is immutable and stays.
// Constructor: none, so showAbility is `super(true)`: the ability name pops up on every entry. No random draw, no state.
//
// A PACKAGE on purpose, and only for the effect. The trigger (when I enter) is a normal swappable WHEN and any extra IF can be
// ANDed on top, but the effect is two ordered steps in one apply: (a) lay Tailwind for a FIXED 3 turns on my side, (b) clear a
// mutable weather. The library effects that would express them are `effect.arena-tag` (planned, and it has no turns setting) and
// `effect.set-weather` with NONE (it does not do the "only when the weather is not primal" check the class relies on). The three
// numbers and choices (Tailwind, 3 turns, own side) are private constants of the class, not constructor arguments, so there is no
// setting to expose without editing the class constructor, which the spec forbids. Requests R-B09-19 and R-B09-20 ask the librarian
// for the two effects; once they exist this block splits into two effects and stops being a package.
import { EntryTailwindClearWeatherAbAttr } from "#data/elite-redux/archetypes/entry-tailwind-clear-weather";

export default defineDecl(EntryTailwindClearWeatherAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.on-entry",
  label: "Set Tailwind and clear the weather when I enter",
  summary: () =>
    "When I enter the battle, my side gets Tailwind for 3 turns and the weather is cleared. Extreme weather (Harsh Sun, Heavy Rain, Strong Winds) stays.",
  synonyms: [
    "air lock",
    "air blower",
    "tailwind on entry",
    "clear the weather",
    "remove weather",
    "speed wind and no weather",
    "cloud nine",
  ],
  examples: ["Start Tailwind for my side and remove the weather when I switch in, like Air Lock"],
  params: [],
  noParamsReason:
    "The three choices are fixed inside the class and are not constructor arguments: Tailwind, 3 turns and the holder's own side. A setting for each needs the librarian's effects (requests R-B09-19 and R-B09-20).",
  conditions: [],
  guards: [],
  feasibility: [
    "Tailwind goes on my own side (player side for the player, enemy side for the enemy); if it is already up it is not laid again",
    "The weather is only cleared when there is one and it is not an extreme (primal) weather",
    "Does nothing in a simulated preview",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "entering in clear weather and in rain", axes: { weather: ["NONE", "RAIN"] } }],
  status: "decomposed",
  notes:
    "Package, 1 attr: Air Lock (76 attr 4, pushed by the ER vanilla rebalance after the vanilla Cloud Nine attrs). Justification: two ordered effects share one apply and neither matches an implemented library effect (effect.arena-tag has no duration setting and is not implemented; effect.set-weather NONE lacks the immutable-weather check). Tailwind, its 3 turns and the own-side choice are private constants of the class. Class reads: arena.addTag is called with turnCount 3 and sourceId = holder id; if Tailwind is already on that side arena.addTag only runs the tag's overlap rule and returns false, and the weather clear still runs. The suppression half of Air Lock (Cloud Nine) is other attrs of the same ability, not this class. Honest bucket: package-only (trigger separate).",
});
