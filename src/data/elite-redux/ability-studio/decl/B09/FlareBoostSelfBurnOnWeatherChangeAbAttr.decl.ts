/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
// B09 chunk 3. "When the weather turns to fog while I am out, I burn myself" (Flare Boost, the ER fog clause, second half).
//
// Source: src/data/elite-redux/archetypes/flare-boost-fog-self-burn.ts, class FlareBoostSelfBurnOnWeatherChangeAbAttr (extends
// PostWeatherChangeAbAttr). Dispatched when the weather changes (`applyAbAttrs("PostWeatherChangeAbAttr")`, param `weather`).
// Clauses, in order:
//   canApply: `isFogWeather(weather)`     the NEW weather is Eerie Fog or normal fog  -> decides whether the ability popup shows
//   apply:    `selfBurnInFog(pokemon, simulated)` the file's helper, the same one the summon sibling uses:
//               1. simulated                                                   -> do nothing
//               2. `!isFogWeather(arena.weatherType)`                          -> do nothing (the field weather, read AGAIN)
//               3. `pokemon.isFainted() || pokemon.status?.effect !== NONE`    -> do nothing (feasibility)
//               4. `pokemon.trySetStatus(BURN, pokemon)`                       the normal immunity rules still apply
// Constructor: none (showAbility is the parent's default true). No random draw, no state.
//
// Tier C on purpose, like its sister class FlareBoostSelfBurnOnSummonAbAttr. The fog test is NOT a replaceable condition: clause 2
// of the effect tests fog again on the field weather, so a gate that staff replaced (say "weather is rain") would still never
// burn anything, and removing it would change only the ability popup. The IF list can only be ANDed on top (extra IFs).
// Request R-B09-09 records the alternative (a field.fog atom plus a clean gate/residual split).
import { FlareBoostSelfBurnOnWeatherChangeAbAttr } from "#data/elite-redux/archetypes/flare-boost-fog-self-burn";

export default defineDecl(FlareBoostSelfBurnOnWeatherChangeAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.weather-changed",
  label: "Burn myself when the weather turns to fog",
  summary: () =>
    "When the weather changes to fog (Eerie Fog or normal fog) while I am out, I get burned, unless I already have a status or my type cannot be burned.",
  synonyms: ["flare boost", "self burn", "ignite in fog", "burn when fog starts", "burn myself", "fog burns me"],
  examples: ["Burn myself the moment fog rolls in, like Flare Boost"],
  params: [],
  noParamsReason:
    "The class has no constructor arguments: the status (burn), the weather test (any fog) and the self-sourced inflict are fixed in the class. The fog test is repeated inside the effect, so it is not a separate setting; staff reach a similar rule with the weather-changed trigger, a weather condition and the inflict-status effect.",
  conditions: [],
  guards: [],
  feasibility: [
    "The new weather must be fog (Eerie Fog or normal fog)",
    "Fog must still be the weather when the burn is dealt",
    "I must not have fainted or already have a status",
    "My type must be able to be burned (a Fire type is not)",
    "Does nothing in a simulated preview",
  ],
  effect: { id: "effect.inflict-status", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "the weather changes while I am at full HP and one HP below full",
      axes: { hp: ["max", "max-1"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier C, 1 attr: Flare Boost (138 attr 3, pushed by init-elite-redux-vanilla-rebalance.ts:1258, after the summon sibling at attr 2). Atomic because the fog test sits in canApply AND again inside apply (selfBurnInFog reads arena.weatherType), so a replaceable gate would be misleading. Behaviour kept as it is: the ability popup shows only when the new weather is fog (canApply), never in other weather; the Endless Avalanche hook may call apply twice, which is harmless (the second call sees the status). The burn goes through trySetStatus with the holder as source, so Ward Stones and external-status blocks do not gate it. Oddity, not fixed: the weather parameter and the field weather are the same value in every real call, so the second fog test never fails after the first passed. The sister class FlareBoostSelfBurnOnSummonAbAttr is declared in chunk 2.",
});
