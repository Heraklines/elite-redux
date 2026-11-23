/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 5. "My moves of one type get stronger while certain weather is on" (Catastrophe: Rock in hail or snow, Ice in a sandstorm).
//
// Source: src/data/elite-redux/archetypes/weather-terrain-interaction.ts, WeatherTypeBoostAbAttr (extends MovePowerBoostAbAttr).
// Constructor: one options object `{ weathers, type, multiplier }`; it throws for a multiplier that is not above 0 and for no weather. It hands the parent the closure
// `weatherTypeBoostApplies(user, move, type, weathers)` (shared helper) and `showAbility` off.
// Dispatched while a move's power is calculated (applyAbAttrs("MovePowerBoostAbAttr")). Clauses, in the original order (Tier B). The old canApply was the parent's
// `condition(user, target, move)`, i.e. the closure, which asks in this order:
//   canApply 1  there is a user (`pokemon` is not undefined or null)                                    (always true in the engine; part of the gate)
//   canApply 2  the move's type AFTER other abilities changed it (`user.getMoveType(move)`) is `type`     GATE (replaceable) part 1: library atom move.type { effective }
//   canApply 3  the weather is not switched off (Cloud Nine / Air Lock) and is one of `weathers`         GATE (replaceable) part 2: no atom yet (R-B12-39)
//   apply       the parent's: `power *= multiplier`                                                      EFFECT (calc)
// No random draw, no state, no `simulated` test. The three clauses are ONE gate method (`gate`), so a replaced gate takes all three away together.
//
// `weathers` is not editable: it decides the shape of the gate (the weather part). `type` is the same value as the type part of the gate, so it is tied to it through gateParams.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { WeatherTypeBoostAbAttr } from "#data/elite-redux/archetypes/weather-terrain-interaction";
import { PokemonType } from "#enums/pokemon-type";
import { requiredWeatherListCodec } from "./b12-chunk5-codecs";

const IN_OPTIONS = { ctorIndex: 0 } as const;

export default defineDecl(WeatherTypeBoostAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Make my moves of one type stronger in certain weather",
  summary: params =>
    `While ${params.weathers} is on, my ${params.type} moves get ${params.multiplier} times their power. Weather that Cloud Nine or Air Lock switches off does not count. Example: Rock 1.5 in hail.`,
  synonyms: [
    "catastrophe",
    "type boost in weather",
    "boost rock in hail",
    "boost ice in sand",
    "fire stronger in sun",
    "water stronger in rain",
    "weather type boost",
    "weather power boost",
  ],
  examples: [
    "Rock moves get 1.5 times their power in hail or snow, like Catastrophe",
    "Ice moves get 1.5 times their power in a sandstorm, like Catastrophe",
  ],
  params: [
    {
      id: "type",
      ...IN_OPTIONS,
      ctorOption: "type",
      path: "boostType",
      control: "select",
      label: "Move type that gets stronger",
      editable: true,
      default: "ROCK",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
    {
      id: "multiplier",
      ...IN_OPTIONS,
      ctorOption: "multiplier",
      path: "boostMultiplier",
      control: "number",
      min: 0.1,
      max: 4,
      step: 0.05,
      label: "Power multiplier (1.5 = 50% stronger)",
      editable: true,
      // Only the effect reads it; the gate never repeats it.
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
  // The type setting is the same value as the type part of the gate: moving the setting moves the compiled gate's type once the gate is a library form.
  gateParams: [{ param: "type", block: "move.type", field: "type" }],
  conditions: [
    // The gate: the move's type after other abilities changed it is `type` (move.type { effective }) AND the weather test (no atom, R-B12-39). Both users are a legacy-closure today.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The move's type is read after other abilities (such as a type-changing ability) have changed it",
    "Moves that deal fixed damage are not changed by a power boost",
  ],
  effect: { id: "effect.multiply-power", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      // Catastrophe's two weathers and a weather that is not listed, against a Rock, an Ice and a plain move.
      name: "the listed weathers, another weather and no weather, with moves of the boosted type and of other types",
      axes: { weather: ["HAIL", "SNOW", "SANDSTORM", "RAIN", "NONE"], foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  l2StaticReason:
    "Both users are legacy-closures today (the weather test has no library atom, R-B12-39), so there is nothing to rebuild for a twin, and the shared L2 reports calc.move-power as unreached (R-B12-19). B12/chunk5.test.ts runs the class on the live attr and on a fresh build for every move type, every weather, with and without Cloud Nine, and for a move whose type another ability changed.",
  status: "decomposed",
  notes:
    "legacy-closure-pending-request: Tier B, 2 attrs, both legacy-closure until the library has the atom 'one of these weathers is on and not switched off' (R-B12-39, the same formula as R-B02-35); the move-type half maps today to move.type { effective: true } and the final binding is `all [move.type, weather atom]`. Users, both of Catastrophe (5296, a maintainer override of the ER text, see the comment in archetype-dispatcher.ts case 589): attr 0 Rock moves x1.5 in Hail or Snow, attr 1 Ice moves x1.5 in a Sandstorm. Catastrophe's other attrs (the companions that cancel the adverse weather penalty, WeatherTypeDebuffCancelAbAttr) are another class, not part of this declaration. The old canApply was the parent's call of the constructor closure; it is now the shared helper `weatherTypeBoostApplies`, read by both the closure the constructor still hands the parent (so the parent's accessors behave as before) and by `gate`, so the two cannot drift. The multiplied power is not rounded. The ability banner is hidden. Oddity, not fixed: the class comment says Catastrophe composes a sun-Water and a rain-Fire boost, but the live ability is Rock in hail or snow and Ice in a sandstorm (the maintainer override); the stale text is in the class documentation only.",
});
