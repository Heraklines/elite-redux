/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
// B09 chunk 2. "When I enter the battle in fog, I burn myself" (Flare Boost, the ER fog clause).
//
// Source: src/data/elite-redux/archetypes/flare-boost-fog-self-burn.ts, class FlareBoostSelfBurnOnSummonAbAttr (extends
// PostSummonAbAttr). Dispatched when the holder enters (`applyAbAttrs("PostSummonAbAttr")`). The class has NO canApply of its
// own (the parent's is always true); every test sits in `apply`, through the file's helper `selfBurnInFog`:
//   1. simulated                                          -> do nothing
//   2. `!isFogWeather(arena.weatherType)`                 -> do nothing   (fog = Eerie Fog or vanilla Fog)
//   3. `pokemon.isFainted() || pokemon.status?.effect !== NONE`  -> do nothing (feasibility)
//   4. `pokemon.trySetStatus(BURN, pokemon)`              the normal immunity rules still apply (a Fire type is not burned)
// Constructor: none, so showAbility is the parent's default (true): the ability name pops up on EVERY entry, in clear
// weather as well, because the popup is decided before `apply` runs (apply-ab-attrs.ts).
//
// Tier C on purpose. Moving the fog test into canApply (the natural IF) would stop the popup on entries without fog, which is
// a visible behaviour change, so the fog test stays in `apply`, inside the one piece. Extra IFs can only be ANDed on top.
// Request R-B09-07 records the alternative (owner decides whether the popup in clear weather is a bug to fix).
import { FlareBoostSelfBurnOnSummonAbAttr } from "#data/elite-redux/archetypes/flare-boost-fog-self-burn";

export default defineDecl(FlareBoostSelfBurnOnSummonAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Burn myself when I enter the battle in fog",
  summary: () =>
    "When I enter the battle and fog (Eerie Fog or normal fog) is active, I get burned, unless I already have a status or my type cannot be burned.",
  synonyms: ["flare boost", "self burn", "ignite in fog", "burn on entry", "burn myself", "fog burns me"],
  examples: ["Burn myself when I switch into fog, like Flare Boost"],
  params: [],
  noParamsReason:
    "The class has no constructor arguments: the status (burn), the weather test (any fog) and the self-sourced inflict are fixed in the class. The fog test must stay inside the effect so the ability popup behaves as before (see the file comment); staff reach the same outcome in a composed rule with field.weather + effect.inflict-status on the holder.",
  conditions: [],
  guards: [],
  feasibility: [
    "Fog must be active (Eerie Fog or normal fog) when I enter",
    "I must not have fainted or already have a status",
    "My type must be able to be burned (a Fire type is not)",
    "Does nothing in a simulated preview",
  ],
  effect: { id: "effect.inflict-status", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "entering at full HP and one HP below full",
      axes: { hp: ["max", "max-1"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier C, 1 attr: Flare Boost (138 attr 2, pushed by init-elite-redux-vanilla-rebalance.ts:1257). Atomic because the weather test lives in apply, not canApply, and moving it would change the ability popup. Behaviour kept as it is: the popup shows on every entry even without fog (showAbility defaults to true and the popup is queued before apply runs); the Endless Avalanche hook may call apply twice, which is harmless here (the second call sees the status). The sister class FlareBoostSelfBurnOnWeatherChangeAbAttr (same file, other trigger) is not part of this batch chunk. The burn goes through trySetStatus with the holder as source, so Ward Stones and external-status blocks do not gate it.",
});
