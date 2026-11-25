/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { STATUS_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
// B09 chunk 2. "When I enter the battle in fog, I burn myself" (Flare Boost, the ER fog clause).
//
// Source: src/data/elite-redux/archetypes/flare-boost-fog-self-burn.ts, class FlareBoostSelfBurnOnSummonAbAttr (extends
// PostSummonAbAttr). Dispatched when the holder enters (`applyAbAttrs("PostSummonAbAttr")`). The class has NO canApply of its
// own (the parent's is always true), so the ability popup shows on EVERY entry, in clear weather as well (the popup is decided
// before `apply` runs, apply-ab-attrs.ts). Every test sits in `apply`, in this order:
//   1. simulated                                                    -> do nothing
//   2. `isFogWeather(arena.weatherType)` is false                   -> do nothing   (fog = Eerie Fog or vanilla Fog)   -> gate (IF)
//   3. `pokemon.isFainted() || pokemon.status?.effect !== NONE`     -> do nothing                                     -> feasibility
//   4. `pokemon.trySetStatus(status, pokemon)`                      the normal immunity rules still apply (a Fire type is not burned)
// Constructor: (status = BURN). showAbility is the parent's default (true).
//
// Tier B, with the gate evaluated at the start of `apply` (after the simulated check, before the fainted / status check), so the
// original order and the popup on every entry are both kept. canApply is NOT split: the parent's always-true canApply stays.
// The gate is the library atom field.weather, any of FOG and EERIE_FOG: `arena.weatherType === WeatherType[weather]`, and
// isFogWeather is exactly `FOG || EERIE_FOG`, read from the same field.
import { FlareBoostSelfBurnOnSummonAbAttr } from "#data/elite-redux/archetypes/flare-boost-fog-self-burn";
import { StatusEffect } from "#enums/status-effect";

export default defineDecl(FlareBoostSelfBurnOnSummonAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Give myself a status when I enter the battle in fog",
  summary: params =>
    `When I enter the battle and fog (Eerie Fog or normal fog) is active, I give myself ${params.status}, unless I already have a status or my type cannot get it. Example: Burn, like Flare Boost.`,
  synonyms: ["flare boost", "self burn", "ignite in fog", "burn on entry", "burn myself", "fog burns me"],
  examples: ["Burn myself when I switch into fog, like Flare Boost"],
  params: [
    {
      id: "status",
      ctorIndex: 0,
      path: "status",
      control: "select",
      label: "Status I give myself (Burn for Flare Boost)",
      editable: true,
      // The gate (fog) never reads the status; only the effect does.
      gateIndependent: true,
      default: "BURN",
      options: STATUS_OPTIONS,
      codec: enumCodec(StatusEffect, "status"),
    },
  ],
  conditions: [
    // The gate: fog is the weather (any of FOG, EERIE_FOG). Evaluated at the start of apply, not in canApply.
    { slot: "gate", ctx: "params", lib: "field.weather", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "I must not have fainted or already have a status",
    "My type must be able to get the status (a Fire type cannot be burned)",
    "Does nothing in a simulated preview",
  ],
  effect: { id: "effect.inflict-status", params: ["status"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "entering in clear weather and in fog, with and without a status",
      axes: { weather: ["NONE", "EERIE_FOG", "FOG"], status: ["NONE", "PARALYSIS"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, 1 attr: Flare Boost (138 attr 2, pushed by init-elite-redux-vanilla-rebalance.ts:1257), bound to any of field.weather FOG and EERIE_FOG. Reworked after review: the earlier Tier C package is gone. The fog test is now a replaceable gate called at the start of apply (after the simulated check, before the fainted / status check, the original order); canApply is untouched, so the ability popup still shows on every entry, even without fog (showAbility defaults to true and the popup is queued before apply runs; owner decision R-B09-07 only if that popup should stop). The status is the new constructor argument (default BURN, so every live attr is unchanged). Tested by B09/first-move-priority.test.ts (fog on and off for both fog kinds, an existing status, a Fire type, fainted, simulated, and a rebuild with another status and with a replaced gate). Behaviour kept: the Endless Avalanche hook may call apply twice, which is harmless (the second call sees the status). The burn goes through trySetStatus with the holder as source, so Ward Stones and external-status blocks do not gate it. The sister class FlareBoostSelfBurnOnWeatherChangeAbAttr (same file, other trigger) is declared in chunk 3 and still uses the helper selfBurnInFog.",
});
