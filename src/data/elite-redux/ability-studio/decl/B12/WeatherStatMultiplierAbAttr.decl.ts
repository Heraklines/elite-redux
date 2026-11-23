/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 5. "While certain weather is on, one of my stats is multiplied" (Thermal Slide, Ethereal Rush, Rite Of Spring, Smokey Maneuvers, Abominable Monster).
//
// Source: src/data/elite-redux/archetypes/weather-stat-multiplier.ts, WeatherStatMultiplierAbAttr (extends StatMultiplierAbAttr, `super(opts.stat, opts.multiplier)`).
// Constructor: one options object `{ stat, multiplier, weathers }`; it throws for a multiplier that is not above 0, for no weather and for the weather None.
// Dispatched while the game works out one of the holder's stats (applyAbAttrs("StatMultiplierAbAttr"), pokemon.ts getEffectiveStat, and the accuracy
// and evasion reads of getAccuracyMultiplier). Clauses, in the original order (Tier B):
//   canApply 1  the parent's: `stat === this.stat` (the stat the game asks about is the chosen stat; the parent's optional closure is never given)   GUARD-like (class method `guards`), it is what the block IS about
//   canApply 2  `isWeatherActive()`: `!arena.weather?.isEffectSuppressed() && weathers.includes(arena.weatherType)`   GATE (replaceable)
//   apply       the parent's: `statVal *= multiplier`                                                               EFFECT (calc)
// No random draw, no state, no `simulated` test.
//
// `weathers` is not editable: it decides the shape of the gate, which staff change with the weather condition once the library has one that also
// asks the Cloud Nine / Air Lock question (request R-B12-39). Until then every gate is a legacy-closure and the class's own gate keeps running.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { STAT_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { WeatherStatMultiplierAbAttr } from "#data/elite-redux/archetypes/weather-stat-multiplier";
import { Stat } from "#enums/stat";
import { requiredWeatherListCodec } from "./b12-chunk5-codecs";

const IN_OPTIONS = { ctorIndex: 0 } as const;

export default defineDecl(WeatherStatMultiplierAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.stat-value",
  label: "Multiply one of my stats while certain weather is active",
  summary: params =>
    `While ${params.weathers} is on, my ${params.stat} is multiplied by ${params.multiplier}. Weather that Cloud Nine or Air Lock switches off does not count. Example: Speed 1.5 in fog.`,
  synonyms: [
    "swift swim",
    "chlorophyll",
    "sand rush",
    "slush rush",
    "speed in rain",
    "speed in the sun",
    "stat boost in weather",
    "weather speed boost",
    "evasion in fog",
    "thermal slide",
    "ethereal rush",
  ],
  examples: [
    "Raise my Speed by 50% in fog, like Ethereal Rush",
    "Raise my Speed by 50% in sun or hail, like Thermal Slide",
    "Raise my Evasion by a third in fog, like Smokey Maneuvers",
  ],
  params: [
    {
      id: "stat",
      ...IN_OPTIONS,
      ctorOption: "stat",
      path: "stat",
      control: "select",
      label: "Which stat (Attack, Defense, Sp. Atk, Sp. Def, Speed, Accuracy or Evasion)",
      editable: true,
      // The stat test is the class's own first clause, not the gate; only the effect and that clause read it.
      gateIndependent: true,
      default: "SPD",
      options: STAT_OPTIONS,
      codec: enumCodec(Stat, "stat"),
    },
    {
      id: "multiplier",
      ...IN_OPTIONS,
      ctorOption: "multiplier",
      path: "multiplier",
      control: "number",
      min: 0.1,
      max: 4,
      step: 0.05,
      label: "Stat multiplier (1.5 = 50% higher, 0.5 = half)",
      editable: true,
      gateIndependent: true,
      default: 1.5,
    },
    {
      id: "weathers",
      ...IN_OPTIONS,
      ctorOption: "weathers",
      path: "weathers",
      control: "text",
      label: "Weather that switches it on, like 'Hail, Snow' (at least one)",
      // It decides the shape of the gate, which staff change with the weather blocks.
      editable: false,
      default: "Rain",
      codec: requiredWeatherListCodec,
    },
  ],
  conditions: [
    // The gate: one of the listed weathers is on and its effects are not switched off. No atom asks both questions yet (R-B12-39), so every user is a legacy-closure.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["Only the chosen stat is changed; the game asks this block about every stat and it answers for one"],
  effect: { id: "effect.multiply-stat", params: ["stat", "multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      // Every weather the users list (plus a weather that is not listed), against a physical and a special foe move.
      name: "the listed weathers, a weather that is not listed and no weather",
      axes: {
        weather: ["FOG", "EERIE_FOG", "SUNNY", "HARSH_SUN", "HAIL", "SNOW", "RAIN", "NONE"],
        foeMove: ["TACKLE", "WATER_GUN"],
      },
    },
  ],
  l2StaticReason:
    "Every user is a legacy-closure today (the weather test has no library atom, R-B12-39), so there is nothing to rebuild for a twin. B12/chunk5.test.ts runs the class on the live attr and on a fresh build for every weather, with and without Cloud Nine, and for every stat.",
  status: "decomposed",
  notes:
    "legacy-closure-pending-request: Tier B, 5 attrs, every gate legacy-closure until the library has the atom 'one of these weathers is on and not switched off' (R-B12-39, the same formula as R-B02-35). Users (weathers, stat, multiplier): Thermal Slide 5563 attr 0 (Sun, Extremely harsh sunlight, Hail, Snow; Speed x1.5), Ethereal Rush 5331 attr 0 (Fog, Eerie fog; Speed x1.5), Rite Of Spring 5503 attr 0 (Sun, Extremely harsh sunlight; Speed x1.5), Smokey Maneuvers 5359 attr 0 (Fog, Eerie fog; Evasion x1.3333, exactly 4/3, so the foe's accuracy is lowered by a quarter) and Abominable Monster 5719 attr 0 (Hail, Snow; Sp. Def x1.5). The old canApply (parent's stat test, then the weather test) is split in that order into `guards` and `gate` with the old short-circuit; the weather test is the unchanged `isWeatherActive()`. The parent's closure argument is never given, so the parent's `condition` is empty for every user (that closure is Hustle's, as the class comment says). Evasion is read for the DEFENDER (pokemon.ts getAccuracyMultiplier passes `pokemon: target`), so Smokey Maneuvers acts on the holder's own evasion when it is hit. Other Speed abilities with a weather rule (Swift Swim, Chlorophyll, Sand Rush, Slush Rush) are plain StatMultiplierAbAttr with an ability-level condition, a different class. Staff cannot add None to the weather list (the class refuses it); the multiplier of Smokey Maneuvers is 4/3, which the 0.05 slider step does not hit, so it is kept as the exact live value. Oddity, not fixed: the weather list ignores the ER weather group (Snowy wrath, Tempest storm, Strong winds are listed as separate weathers, so a user that lists Hail and Snow does not react to Snowy wrath).",
});
