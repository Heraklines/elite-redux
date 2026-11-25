/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Cracked Vessel, part 1 of 2 (Tier C, engine-query). "Once per wave, a lethal hit leaves me at 1 HP, but I lose my last type, fog rolls in and everyone next to me is badly poisoned."
//
// Source: abilities/newcomer-signature-mechanics.ts, CrackedVesselMarkerAbAttr (extends AbAttr directly; apply is empty).
// The class is a MARKER that the engine looks for by name: tryCrackedVessel(defender, source) is called by Pokemon.damageAndUpdate
// (field/pokemon.ts:6663) for a direct (not indirect) hit that would knock the holder out (after Life Preserver and Eclipse Wing were tried).
// The rule, in order:
//   a source exists, the defender carries this marker, and it did not already use it this wave   (else: no effect)
//   -> remember the wave; kept = my types without the last `typesLost` ones (Unknown when none are left); remember that list (the
//      switch-in restore, CrackedVesselRestoreTypesAbAttr, chunk 5, reads it); set my current types to it; refresh the display
//   -> queue "<name>'s Cracked Vessel shattered!"
//   -> set the weather fogWeather for fogTurns turns (the arena may refuse)
//   -> for each adjacent ally, then each adjacent opponent: try to give them adjacentStatus (no message of its own)
//   -> the caller then clamps the damage so I stay at 1 HP.
// No RNG. Constructor arguments (defaults = the old literals): typesLost 1, fogWeather Eerie Fog, fogTurns 4, adjacentStatus badly poisoned.
import { CrackedVesselMarkerAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { StatusEffect } from "#enums/status-effect";
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

// Player-facing status names (never the enum constants).
const STATUS_CHOICES: Record<string, StatusEffect> = {
  Poisoned: StatusEffect.POISON,
  "Badly poisoned": StatusEffect.TOXIC,
  Paralyzed: StatusEffect.PARALYSIS,
  Asleep: StatusEffect.SLEEP,
  Frozen: StatusEffect.FREEZE,
  Burned: StatusEffect.BURN,
};

const weatherCodec = {
  toCtor: (value: unknown): WeatherType => {
    const resolved = WEATHER_CHOICES[String(value)];
    if (resolved === undefined) {
      throw new Error(`"${String(value)}" is not a known weather`);
    }
    return resolved;
  },
  fromInstance: (raw: unknown): string | undefined =>
    Object.keys(WEATHER_CHOICES).find(name => WEATHER_CHOICES[name] === raw),
};

const statusCodec = {
  toCtor: (value: unknown): StatusEffect => {
    const resolved = STATUS_CHOICES[String(value)];
    if (resolved === undefined) {
      throw new Error(`"${String(value)}" is not a known status`);
    }
    return resolved;
  },
  fromInstance: (raw: unknown): string | undefined =>
    Object.keys(STATUS_CHOICES).find(name => STATUS_CHOICES[name] === raw),
};

export default defineDecl(CrackedVesselMarkerAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Survive a knockout once a wave, then crack",
  summary: params =>
    `Once a wave, a hit that would knock me out leaves me at 1 HP. I lose my last ${params.typesLost} type(s), ${params.fogWeather} lasts ${params.fogTurns} turns and every Pokemon next to me becomes ${params.adjacentStatus}.`,
  synonyms: [
    "survive at 1 hp",
    "endure a knock-out",
    "lose a type",
    "shatter",
    "poison everyone nearby",
    "cracked vessel",
    "focus sash with a price",
  ],
  examples: [
    "Once per wave I survive a knock-out at 1 HP, lose my last type, summon fog and badly poison the neighbours, like Cracked Vessel",
  ],
  params: [
    {
      id: "typesLost",
      ctorIndex: 0,
      path: "typesLost",
      control: "number",
      label: "Types I lose when the vessel cracks (types)",
      editable: true,
      gateIndependent: true,
      default: 1,
      min: 1,
      max: 3,
      step: 1,
      integer: true,
    },
    {
      id: "fogWeather",
      ctorIndex: 1,
      path: "fogWeather",
      control: "select",
      label: "Weather it calls",
      editable: true,
      gateIndependent: true,
      default: "Eerie Fog",
      options: Object.keys(WEATHER_CHOICES),
      codec: weatherCodec,
    },
    {
      id: "fogTurns",
      ctorIndex: 2,
      path: "fogTurns",
      control: "number",
      label: "Turns the weather lasts",
      editable: true,
      gateIndependent: true,
      default: 4,
      min: 1,
      max: 20,
      step: 1,
      integer: true,
    },
    {
      id: "adjacentStatus",
      ctorIndex: 3,
      path: "adjacentStatus",
      control: "select",
      label: "Status given to every Pokemon next to me",
      editable: true,
      gateIndependent: true,
      default: "Badly poisoned",
      options: Object.keys(STATUS_CHOICES),
      codec: statusCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only a direct hit that would knock me out; damage from poison, weather and the like never cracks the vessel",
    "Only once per wave",
    "The weather may be refused by the field (a strong weather cannot be replaced), and a neighbour's own ability or type may stop the status",
    "If I have fewer types than I lose I end up with the Unknown type",
    "My shortened type list is also what I come back with after switching out (the second part of this ability)",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "battle", simulated: "ignores" },
  l2StaticReason:
    "The flag is consulted by name inside the damage code, which is not a dispatched moment; B13/chunk6.test.ts proves the rule by calling tryCrackedVessel with and without the marker and with the default and a custom set of values.",
  probes: [{ name: "a damaging hit that does not knock me out", axes: { foeMove: ["TACKLE"] } }],
  status: "decomposed",
  notes:
    "ENGINE-QUERY, justified: the class is a flag; the rule (survive a lethal hit once per wave, lose the last type, set a weather, status the neighbours) lives in tryCrackedVessel, called by name from Pokemon.damageAndUpdate (field/pokemon.ts:6663), so a rebuilt attr cannot carry it. The trigger (a moment when I take a lethal direct hit) is not dispatched, so no WHEN block can wrap it and the 'not used this wave' condition is a private memory: requested as R-B13-53 (the dispatched WHEN 'Before a direct hit would knock me out', shared with Eclipse Wing) plus R-B13-55 (effects 'Lose my last type(s)' and 'Status every adjacent Pokemon' for the cracked effect). The dispatch key list of while.active needs this class (R-B13-19; the same minimal flag-key entry the earlier chunks made was added). The literals 1 (types lost), Eerie Fog, 4 turns and badly poisoned were hard-coded; they are now constructor arguments 0 to 3 (defaults 1, Eerie Fog, 4, badly poisoned) and tryCrackedVessel reads them from the holder's marker attr. The 'once per wave' limit, the Unknown-type fallback and the message stay in the function. Users: Cracked Vessel (5992, attr 0); the ability passes no arguments, so it is fully covered. ODDITIES (not fixed): (1) a hit Life Preserver or Eclipse Wing already clamped never reaches this rule (the caller tries them first); (2) the once-per-wave memory is a WeakMap entry keyed by the Pokemon and holding the wave index, so it resets on the next wave and is not reset by switching out; (3) the type memory is written before the weather is tried, so a refused weather still costs the type; (4) the ability text says the type is lost permanently, but only the switch-in restore keeps it (see the restore part, oddity 2); (5) the status is tried on neighbours even if the weather failed, and with no message when it is blocked.",
});
