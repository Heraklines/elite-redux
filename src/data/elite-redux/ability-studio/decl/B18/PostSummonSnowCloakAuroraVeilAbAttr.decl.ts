/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B18 chunk 4, Tier B event-effect. Snow Cloak and Glacial Ghost. "When I enter the battle, IF the weather is hail or snow, DO put a lasting
// Aurora Veil on my side".
//
// Source: ability-upgrades/attrs/snow-cloak-aurora-veil.ts over PostSummonAbAttr (showAbility true, activateOnGain true). Dispatch:
// applyAbAttrs("PostSummonAbAttr", { pokemon, simulated }) when a Pokemon enters. canApply is ONE clause (now the whole gate, no guard, no
// residual): arena.weatherType is HAIL or SNOW (the raw weather, the same read as the atom field.weather). apply: unless simulated, remove
// the holder side's existing `tag` (silently), then add `tag` to the holder's side with duration 0 (indefinite) and the holder as source.
// No random draw.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { PostSummonSnowCloakAuroraVeilAbAttr } from "#data/elite-redux/ability-upgrades/attrs/snow-cloak-aurora-veil";
import { FIELD_EFFECT_OPTIONS, fieldEffectCodec } from "./b18-chunk4-codecs";

export default defineDecl(PostSummonSnowCloakAuroraVeilAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Put a lasting field effect on my side when I enter",
  summary: params =>
    `When I enter the battle, my side gets ${params.tag} with no turn limit and I become its owner; one already there is replaced. Example: Aurora Veil in hail or snow, like Snow Cloak.`,
  synonyms: [
    "snow cloak",
    "aurora veil on entry",
    "set a screen when entering",
    "permanent screen",
    "veil in hail",
    "lasting aurora veil",
    "screen that ends with the weather",
  ],
  examples: [
    "When I enter in hail or snow, my side gets an Aurora Veil that lasts until the weather ends, like Snow Cloak",
    "When I enter, my side gets a lasting Light Screen",
  ],
  params: [
    {
      id: "tag",
      ctorIndex: 0,
      path: "tag",
      control: "select",
      label: "Field effect set on my side",
      // Not editable: the game removes an indefinite Aurora Veil as soon as hail or snow ends (arena.ts, hard-wired to that one field effect)
      // and the leaving half of Snow Cloak must name the same effect; another effect would never end by itself. Request R-B18-37.
      editable: false,
      default: "AURORA_VEIL",
      options: FIELD_EFFECT_OPTIONS,
      codec: fieldEffectCodec,
    },
  ],
  // The gate is any[field.weather {HAIL}, field.weather {SNOW}] (see bindings.ts).
  conditions: [{ slot: "gate", ctx: "params", removable: true, editable: true }],
  guards: [],
  feasibility: [
    "Nothing happens when the game only previews the entry",
    "A field effect of that kind already on my side is replaced, so the new one belongs to me",
    "The field effect has no turn count; the game ends an Aurora Veil like this when hail or snow ends",
  ],
  effect: { id: "effect.arena-tag", params: ["tag"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    // Snow Cloak itself carries an ability-level condition (hail or snow), so a battle twin only reaches its attr in those two weathers
    // (the weather axis is the weather the battle starts with); the other weathers are compared over the L1 grid and in B18/chunk4.test.ts.
    { name: "entering in hail and in snow", axes: { weather: ["HAIL", "SNOW"] } },
  ],
  status: "decomposed",
  notes:
    "Tier B, no package (the effect is the library's effect.arena-tag: set a field effect on my own side). Users (2 attrs): Snow Cloak (81, attr 0) and Glacial Ghost (5526, attr 2, which also carries an attr-level extraCondition that the rebuild copies). Class change (pure move, no behaviour change): gateOverride field, canApply = gatedCanApply, gate = the old weather test, and a trailing constructor argument `tag` (default Aurora Veil) so the field effect is a typed setting of the effect instead of a hidden constant (the same kind of addition B18 chunk 2 made for the Tailwind remover). The `tag` setting is shown but not editable, see the param. The effect differs from a plain 'set a field effect' in three ways that the summary and feasibility spell out: it has no turn count, the holder becomes its owner (sourceId) and an existing one is removed first. The weather rule is the gate: staff can swap the two weather blocks, but only hail and snow have the game code that removes the effect again. Pairs with PreLeaveFieldRemoveSnowCloakAuroraVeilAbAttr, which removes the effect when the owner leaves. ODDITIES, not fixed: (1) arena.ts removes EVERY indefinite Aurora Veil of either side when the weather leaves hail and snow, whoever owns it; (2) the effect is only ever set at entry, so a Snow Cloak holder that is already on the field when hail starts gets no veil until it re-enters; (3) the banner is shown (showAbility true).",
});
