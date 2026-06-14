/*
 * Elite Redux — dev-managed Overrides reset. *** TRACKED — STAGING ONLY ***
 *
 * The keys the dev test suite (scenarios + scenario builder) mutates, with
 * their "off" defaults, plus the reset that restores them. Split into its own
 * tiny module (Overrides + enums only — NO species/data-list imports) so the
 * scenario BUILDER can reset overrides without importing the heavy
 * `scenarios.ts` module, whose top-level scenario construction touches the
 * species tables and would crash if evaluated before the game finishes init
 * (e.g. inside a unit test).
 */

import Overrides from "#app/overrides";
import { AbilityId } from "#enums/ability-id";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";

// The Overrides singleton fields are `readonly` at compile time but mutable at
// runtime — this is exactly how the dev override workflow is meant to be driven.
export type MutableOverrides = { -readonly [K in keyof typeof Overrides]: (typeof Overrides)[K] };

/** Keys the dev harness sets, with their default ("off") values. */
export const DEV_OVERRIDE_DEFAULTS = {
  STARTING_LEVEL_OVERRIDE: 0,
  STARTING_WAVE_OVERRIDE: null,
  BATTLE_STYLE_OVERRIDE: null,
  STARTING_BIOME_OVERRIDE: null,
  STARTER_FORM_OVERRIDES: {},
  ABILITY_OVERRIDE: AbilityId.NONE,
  PASSIVE_ABILITY_OVERRIDE: AbilityId.NONE,
  MOVESET_OVERRIDE: [],
  STARTING_HELD_ITEMS_OVERRIDE: [],
  STARTING_MODIFIER_OVERRIDE: [],
  WEATHER_OVERRIDE: WeatherType.NONE,
  STATUS_OVERRIDE: StatusEffect.NONE,
  ENEMY_STATUS_OVERRIDE: StatusEffect.NONE,
  ENEMY_SPECIES_OVERRIDE: null,
  ENEMY_LEVEL_OVERRIDE: 0,
  ENEMY_ABILITY_OVERRIDE: AbilityId.NONE,
  ENEMY_MOVESET_OVERRIDE: [],
  ENEMY_FORM_OVERRIDES: {},
  ER_BLACK_SHINY_PLAYER_OVERRIDE: null,
  ER_BLACK_SHINY_ENEMY_OVERRIDE: null,
} as const;

const O = Overrides as unknown as MutableOverrides;

/** Reset every dev-managed override so scenarios don't bleed into each other. */
export function resetDevOverrides(): void {
  Object.assign(O, structuredClone(DEV_OVERRIDE_DEFAULTS));
}
