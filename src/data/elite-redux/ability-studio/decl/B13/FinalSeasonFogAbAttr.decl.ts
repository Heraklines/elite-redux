/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Final Season, part 2 of 3 (Tier B, event-effect). "At the end of the turn after my switch-in effect, set Eerie Fog for 5 turns."
//
// Source: abilities/newcomer-signature-mechanics.ts, FinalSeasonFogAbAttr (PostTurnAbAttr).
//   canApply  one clause: the holder is in FINAL_SEASON_PENDING_FOG (armed by FinalSeasonEntryAbAttr.apply).
//             -> the gate. No library atom for "an earlier effect of mine armed this" (the effect side,
//             effect.arm-effect, exists; its condition side does not): legacy-closure + request `time.armed`.
//   apply     1. FINAL_SEASON_PENDING_FOG.delete(holder)   (even when simulated)
//             2. not simulated and arena.trySetWeather(EERIE_FOG, holder, 5) succeeded:
//                remember the holder as the fog's owner and remember the Weather instance (read by
//                FinalSeasonPowerAbAttr to know "this is MY fog")
//   Constructor (added in the review fix, defaults = the old literals): fogWeather (EERIE_FOG), fogTurns (5).
//   No RNG. Effect = set the weather, an existing effect block (effect.set-weather).
import { FinalSeasonFogAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { WeatherType } from "#enums/weather-type";

// Player-facing weather names (never the enum constants).
const WEATHER_CHOICES: Record<string, WeatherType> = {
  "Eerie Fog": WeatherType.EERIE_FOG,
  Sun: WeatherType.SUNNY,
  Rain: WeatherType.RAIN,
  Sandstorm: WeatherType.SANDSTORM,
  Hail: WeatherType.HAIL,
  Snow: WeatherType.SNOW,
  "Plain fog": WeatherType.FOG,
  "Heavy rain": WeatherType.HEAVY_RAIN,
  "Harsh sun": WeatherType.HARSH_SUN,
  "Strong winds": WeatherType.STRONG_WINDS,
  "Tempest storm": WeatherType.TEMPEST_STORM,
  "Snowy wrath": WeatherType.SNOWY_WRATH,
};

export default defineDecl(FinalSeasonFogAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.end-of-turn",
  label: "Set the weather at turn end after my switch-in effect",
  summary: params =>
    `At the end of a turn, if my switch-in effect happened this turn, the weather becomes "${params.weather}" for ${params.turns} turns, and I remember it as my own weather.`,
  synonyms: ["delayed weather", "fog", "eerie fog", "end of turn weather", "set weather later", "final season"],
  examples: ["Change the weather at the end of the turn when my special switch-in effect happened"],
  params: [
    {
      id: "weather",
      ctorIndex: 0,
      path: "fogWeather",
      control: "select",
      label: "Weather",
      editable: true,
      gateIndependent: true,
      default: "Eerie Fog",
      options: Object.keys(WEATHER_CHOICES),
      codec: {
        toCtor: value => {
          const resolved = WEATHER_CHOICES[String(value)];
          if (resolved === undefined) {
            throw new Error(`"${String(value)}" is not a known weather`);
          }
          return resolved;
        },
        fromInstance: raw => Object.keys(WEATHER_CHOICES).find(name => WEATHER_CHOICES[name] === raw),
      },
    },
    {
      id: "turns",
      ctorIndex: 1,
      path: "fogTurns",
      control: "number",
      label: "Turns the weather lasts",
      editable: true,
      gateIndependent: true,
      default: 5,
      min: 1,
      max: 20,
      step: 1,
      integer: true,
    },
  ],
  conditions: [
    // The one clause of canApply. Legacy closure until the librarian adds the atom (see bindings.ts).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The field must accept the weather (a primal weather such as Heavy Rain or Harsh Sun cannot be overwritten)",
    "Final Season's power boost only works while the weather is Eerie Fog, so choosing another weather here removes that boost",
  ],
  effect: { id: "effect.set-weather", params: ["weather", "turns"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [
    {
      // The switch-in flag is never set in a plain battle, so the gate is false; the case with the flag set is in B13/final-season.test.ts.
      name: "turn end with no switch-in effect before it",
      axes: {},
    },
  ],
  status: "decomposed",
  notes:
    "Users: Final Season (5972, attr 1). Gate = FINAL_SEASON_PENDING_FOG.has(holder), legacy-closure pending request `time.armed`. Effect = trySetWeather(fogWeather, holder, fogTurns) (review fix: weather and turns are now params, defaults EERIE_FOG and 5; the Power attr still tests for Eerie Fog and the module-level fog memory, so changing the weather here makes the boost never apply); the arena's own feasibility (a primal weather blocks it) stays in the class. Bookkeeping that rides along: the holder and the Weather instance are stored in module-level variables (finalSeasonFogOwner, finalSeasonFogInstance) so FinalSeasonPowerAbAttr can tell the fog is the holder's own. ODDITIES (not fixed): (1) apply deletes the switch-in-effect flag BEFORE the simulated and trySetWeather checks, so a blocked fog (primal weather) or a simulated call still spends it; (2) the owner/instance variables are single module-level slots shared by every Final Season holder in the game, so a second holder that sets its own fog takes the boost away from the first; they are also never cleared when the holder leaves.",
});
