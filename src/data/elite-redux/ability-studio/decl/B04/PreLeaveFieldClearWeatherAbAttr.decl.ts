/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 / Tier A event-effect, one enum setting, no closure (Primordial Sea, Desolate Land, Delta Stream, Desolate Sun,
// Fire Aspect, Blistering Sun).
//
// Clause classification (PreLeaveFieldClearWeatherAbAttr), in the original order:
//   1. `arena.weatherType !== this.weatherType -> false`  -> FEASIBILITY / part of the effect's target: the weather
//      that is up must be the one this ability keeps alive. It is the effect's own subject (the `weather` setting), so
//      it is not a separate condition staff could swap; staff who want a different test AND `field.weather` on the
//      trigger. It reads the same arena.weatherType the library atom `field.weather` reads.
//   2. `getField(true).some(p => p !== pokemon && p.getAbilityAttrs("PreLeaveFieldClearWeatherAbAttr").some(attr =>
//      attr.weatherType === this.weatherType))` -> true means "another holder keeps this weather going" -> false. This
//      is a SAFETY RULE (removing it would end a primal weather while a second holder still stands on the field), so
//      it is a guard. The guard registry has no entry for it yet (requests/B04.md, guard `another-holder-keeps-weather`),
//      so it is written as a feasibility line and stays in the class. It comes AFTER clause 1, the original order,
//      and is a pure read (no RNG, no side effects).
//   apply     `if (!simulated) arena.trySetWeather(WeatherType.NONE)` -> the EFFECT (clears even primal weather).
// The class looks up its own name with getAbilityAttrs("PreLeaveFieldClearWeatherAbAttr"), so the class name must not
// change.
import { PreLeaveFieldClearWeatherAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec, enumOptions } from "#data/elite-redux/ability-studio/param-codecs";
import { WeatherType } from "#enums/weather-type";

export default defineDecl(PreLeaveFieldClearWeatherAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.leave-field",
  label: "End a lasting weather when I leave the field",
  summary: params =>
    `When I leave the field and the weather is ${String(params.weather).toLowerCase()}, it ends, unless another Pokemon on the field keeps the same weather going.`,
  synonyms: [
    "primal weather ends",
    "desolate land leaves",
    "primordial sea leaves",
    "delta stream leaves",
    "weather ends when I leave",
    "clear weather on switch out",
  ],
  examples: ["Heavy rain ends when I leave the field, like Primordial Sea"],
  params: [
    {
      id: "weather",
      ctorIndex: 0,
      path: "weatherType",
      control: "select",
      label: "Weather that ends when I leave",
      editable: true,
      default: "HEAVY_RAIN",
      options: enumOptions(WeatherType).filter(name => name !== "NONE"),
      codec: enumCodec(WeatherType, "weather"),
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "The weather on the field must be the one I keep alive",
    "No other Pokemon on the field may hold an ability that keeps the same weather alive",
  ],
  effect: { id: "effect.package", params: ["weather"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    { name: "leave under the matching and a different weather", axes: { weather: ["HEAVY_RAIN", "RAIN", "NONE"] } },
  ],
  status: "decomposed",
  notes:
    "Users and weather: Primordial Sea HEAVY_RAIN (attr 2), Desolate Land HARSH_SUN (attr 2), Delta Stream STRONG_WINDS (attr 2), Desolate Sun HARSH_SUN (attr 2), Fire Aspect HARSH_SUN (attr 2), Blistering Sun HARSH_SUN (attr 2). The setting is the only constructor argument (the constructor calls super(false), silent). The dispatch also happens through applyOnLoseAbAttrs (ability lost or suppressed) and attempt-run-phase (enemy field when the player flees), both with the same attr. The grid's single holder cannot reach the 'another holder' half, so b04-attrs.test.ts runs a double battle with two Primordial Sea holders, original against rebuild. Kept as Tier A with feasibility, no class edit: both clauses are pure reads that stay in the class. If the librarian adds the guard `another-holder-keeps-weather` the second feasibility line moves to `guards` with no behaviour change.",
});
