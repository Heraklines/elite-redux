/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / event effect, Tier B (the weather rule sits inside canApply). See ../PRECEDENTS.md.
//
// `Arena.trySetWeather` (arena.ts:537) tells every Pokemon that the weather changed:
// `applyAbAttrs("PostWeatherChangeAbAttr", { pokemon, weather })`. canApply is now `gate && residual`, in the ORIGINAL clause
// order (no guard, no prepare step, no random draw):
//   1. gate      `weatherTypes.includes(weather)`     the NEW weather is one of the listed ones  <- staff may replace it
//   2. residual  `pokemon.canAddTag(tagType)`         the holder can take the battle effect (feasibility, stays in the class)
// apply: not when `simulated`; otherwise `pokemon.addTag(tagType, turnCount)`. The constructor is
// `(tagType, turnCount, ...weatherTypes)`.
import { PostWeatherChangeAddBattlerTagAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumListCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { BattlerTagType } from "#enums/battler-tag-type";
import { WeatherType } from "#enums/weather-type";

export default defineDecl(PostWeatherChangeAddBattlerTagAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.weather-changed",
  label: "Gain a battle effect when a chosen weather starts",
  summary: params =>
    `When the weather changes to one of: ${params.weathers}, I gain the effect ${params.tag}. Example: Protosynthesis starts when the sun comes out.`,
  synonyms: [
    "protosynthesis",
    "weather boost start",
    "gain effect in sun",
    "start boost when weather changes",
    "weather tag",
    "sun boost",
  ],
  examples: ["Start my sun boost when the sun comes out, like Protosynthesis"],
  params: [
    {
      id: "tag",
      ctorIndex: 0,
      path: "tagType",
      control: "select",
      label: "Battle effect I gain",
      editable: true,
      gateIndependent: true,
      default: "PROTOSYNTHESIS",
      options: Object.values(BattlerTagType),
    },
    {
      id: "turns",
      ctorIndex: 1,
      path: "turnCount",
      control: "number",
      min: 0,
      max: 99,
      step: 1,
      integer: true,
      label: "Turns the effect lasts (0 = until something removes it)",
      editable: true,
      gateIndependent: true,
      default: 0,
    },
    {
      id: "weathers",
      ctorIndex: 2,
      path: "weatherTypes",
      control: "text",
      // The list is also the gate ("the new weather is one of these"), which staff edit through the gate block. This list
      // only feeds the class's own default gate, so editing it alone would not move a replaced gate.
      label: "Weathers that start it (comma separated names)",
      editable: false,
      default: "SUNNY,HARSH_SUN",
      codec: enumListCodec(WeatherType, "weather"),
      spread: true,
    },
  ],
  conditions: [
    // The gate: "the weather that was just set is one of these" (any of field.weather). Each user's binding repeats its list.
    { slot: "gate", ctx: "params", lib: "field.weather", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "I must be able to take that battle effect (for example I do not already have it)",
    "Nothing happens during a simulated check",
  ],
  // The library's apply-tag effect is not implemented and has no turn count (R-B05-21), so the effect is a package.
  effect: { id: "effect.package", params: ["tag", "turns"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "the field starts with sun, rain or no weather and the enemy changes it",
      axes: { weather: ["SUNNY", "RAIN", "NONE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B. User: Protosynthesis (281 attr 1, tag PROTOSYNTHESIS, 0 turns, SUNNY and HARSH_SUN), bound as a gate = any of two field.weather atoms. Its entry half (`PostSummonAddBattlerTagAbAttr` behind a weather condition, attr 0) is another class. The `weathers` list is not editable on purpose (a list cannot be repeated inside the gate atoms): staff change the weathers through the gate block. A tag removal when the weather ends is done by the engine (arena.ts:534, findAndRemoveTags on `weatherTypes` of the tag), not by this class. The `weather` of the call equals the arena weather at dispatch (arena.ts:537). PostWeatherChangeAbAttr is dispatched through the shared key; this class is not in the DISPATCHED_THROUGH list of dispatch-keys.ts (R-B05-22).",
});
