/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 5. PARKED until the librarian adds a trigger for the by-name type-matchup scan whose dispatch keys include this class (request R-B12-40);
// rename this file to WeatherGroundAirborneAbAttr.decl.ts and add the gate binding for Desert Spirit (5311 attr 1, legacy-closure until R-B12-39) afterwards.
// The registry only collects `*.decl.ts`, so it does not load yet.
//
// "While certain weather is on, my Ground moves hit airborne Pokemon as a normal hit" (Desert Spirit: in a sandstorm).
//
// Source: src/data/elite-redux/archetypes/weather-ground-airborne.ts, WeatherGroundAirborneAbAttr (extends AbAttr directly).
// Constructor: ONE plain argument, the weather list (default [Sandstorm]); it is not an options object and it is not checked for being empty.
// It rides NO standard dispatch key: Pokemon.getAttackTypeEffectiveness (field/pokemon.ts:4395) scans the attacker's active attrs BY CONSTRUCTOR NAME and calls
// `fire(moveType, multi)`, next to the other by-name type-chart scanners (OffensiveTypeChartOverride, BoneMoveTypeChart, MiracleBladeTypeChart). `canApply` and `apply` are never called.
// Clauses of `fire`, in the original order (Tier B):
//   fire 1  `moveType === Ground`       the type the engine hands over is Ground (a fixed part of what the class is: not a constructor argument)   effect-side, stays in the class
//   fire 2  `multi.value === 0`          the matchup so far is an immunity (Flying, or a Ground move's other immunities)                            effect-side, stays in the class
//   fire 3  `gate()`: the weather is not switched off (Cloud Nine / Air Lock) and is one of `weathers`                                           GATE (replaceable): no atom yet (R-B12-39)
//   effect  `multi.value = 1`            an immunity becomes a normal hit                                                                            EFFECT (calc), package: no library effect rewrites the matchup (R-B08-11)
// No random draw, no state, no `simulated` test.
//
// `weathers` is not editable: it decides the shape of the gate. The class has no gate closure to bind today, and the class does not take the Ground type as an argument.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { WeatherGroundAirborneAbAttr } from "#data/elite-redux/archetypes/weather-ground-airborne";
import { requiredWeatherListCodec } from "./b12-chunk5-codecs";

export default defineDecl(WeatherGroundAirborneAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.my-attack-matchup",
  label: "My Ground moves hit airborne Pokemon in certain weather",
  summary: params =>
    `While ${params.weathers} is on, my Ground moves that a target is immune to (such as against a Flying type) hit it for normal damage. Weather that Cloud Nine or Air Lock switches off does not count.`,
  synonyms: [
    "desert spirit",
    "ground hits flying",
    "ground moves hit levitate",
    "earthquake hits flying",
    "ignore flying immunity in sand",
    "ground type immunity bypass",
  ],
  examples: [
    "In a sandstorm my Ground moves hit Flying types, like Desert Spirit",
    "While it hails my Ground moves hit airborne Pokemon",
  ],
  params: [
    {
      id: "weathers",
      ctorIndex: 0,
      path: "weathers",
      control: "text",
      label: "Weather that switches it on, like 'Sandstorm' (at least one)",
      // It decides the shape of the gate, which staff change with the weather blocks.
      editable: false,
      default: "Sandstorm",
      codec: requiredWeatherListCodec,
    },
  ],
  conditions: [
    // The gate: one of the listed weathers is on and its effects are not switched off (R-B12-39). The Ground move and the immunity tests are in `fire` and stay in the class.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Only Ground moves are changed, and only a target that would take no damage at all",
    "Immunities that come from an ability or a move effect still hold; only the type chart is changed",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      name: "a Ground move against a Flying type in a sandstorm, in rain and with no weather",
      axes: { weather: ["SANDSTORM", "RAIN", "NONE"] },
    },
  ],
  l2StaticReason:
    "The class is read by a by-name scan in the type-effectiveness calculation, not dispatched, so no trace event shows it evaluated. B12/chunk5.test.ts calls fire() for every move type and every matchup.",
  status: "decomposed",
  notes:
    "legacy-closure-pending-request, parked: (a) no WHEN has this class, or an ancestor (the class extends AbAttr directly), as a dispatch key; B08 added `calc.my-attack-matchup` for its sibling BoneMoveTypeChartAbAttr and noted that the other by-name scanners can join it through alsoDispatchKeys (R-B12-40); (b) the weather test has no library atom (R-B12-39). Package reason for the effect: the effect has no number or type to set from outside, it is the fixed rewrite 'a Ground move's immunity (matchup 0) becomes a normal hit (matchup 1)'; the library has no effect that rewrites the type matchup (B08 request R-B08-11 `effect.set-matchup`), and the Ground type and the 0-to-1 rewrite are fixed in the class (the constructor only takes the weather list), so there is nothing to give typed params. The trigger and the weather condition are separate blocks. Tier B, 1 attr: Desert Spirit 5311 attr 1 (Sandstorm only; the ability's other attrs set the sandstorm on entry and block its damage, other classes). The class is added to the attacker's attrs by archetype-dispatcher.ts case 604. Gate and tests split as in the source: the two moment tests (Ground, immune so far) stay in `fire`, because the engine hands over only a move TYPE and the running matchup, not a move; the gate replaces only the weather test. Oddity, not fixed: the class comment says airborne Pokemon, but `fire` never looks at the target's type, it rewrites whatever matchup of 0 the running calculation holds for a Ground move; an ability or tag immunity (Levitate, Magnet Rise) is decided elsewhere and is not touched by this rewrite.",
});
