/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — single-cast Pledge field effects.
//
// In ER the Pledge moves no longer need to be *combined* (two Pledges in one
// turn). Each one, cast SOLO, lays a field effect keyed to the current weather
// or terrain, reusing pokerogue's existing pledge arena tags:
//
//   - Rainbow      = ArenaTagType.WATER_FIRE_PLEDGE  (user's side; doubles
//                    secondary-effect chance for a few turns)
//   - Swamp        = ArenaTagType.GRASS_WATER_PLEDGE (foe's side; halves Speed)
//   - Sea of fire  = ArenaTagType.FIRE_GRASS_PLEDGE  (foe's side; chip damage)
//
// Per-Pledge rules (ER move descriptions 518/519/520):
//   - Water Pledge: Sun  → rainbow,  Grassy Terrain → swamp
//   - Fire Pledge:  Rain → rainbow,  Grassy Terrain → sea of fire
//   - Grass Pledge: Rain → swamp,    Sun           → sea of fire
//
// Wired onto the vanilla Pledge moves by `init-elite-redux-vanilla-move-patches`
// after stripping the vanilla two-Pledge combine machinery.
// =============================================================================

import { globalScene } from "#app/global-scene";
import type { ArenaTagType } from "#enums/arena-tag-type";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { MoveResult } from "#enums/move-result";
import { WeatherType } from "#enums/weather-type";
import { TerrainType } from "#data/terrain";
import { MoveEffectAttr, type Move, userActsInSun } from "#data/moves/move";
import type { Pokemon } from "#field/pokemon";

/** Weather/terrain condition that arms a single-cast Pledge effect. */
export type ErPledgeTrigger = "sun" | "rain" | "grassy-terrain";

/** Number of turns the laid field effect lasts (matches vanilla pledge tags). */
const PLEDGE_TAG_TURNS = 4;

export interface ErPledgeRule {
  /** The weather/terrain that must be active for this rule to fire. */
  readonly when: ErPledgeTrigger;
  /** The pledge arena tag to lay. */
  readonly tag: ArenaTagType;
  /**
   * `true` lays the tag on the USER's side (rainbow — it benefits the caster);
   * `false` lays it on the OPPOSING side (swamp / sea of fire — they hinder the
   * foe).
   */
  readonly selfSide: boolean;
}

/**
 * MoveEffectAttr that lays a Pledge field effect based on the current weather /
 * terrain. Multiple rules may be supplied; every matching rule fires (in
 * practice a Pledge has two mutually-exclusive rules, so at most one applies).
 */
export class ErPledgeWeatherEffectAttr extends MoveEffectAttr {
  constructor(private readonly rules: readonly ErPledgeRule[]) {
    super(true);
  }

  private isActive(when: ErPledgeTrigger, user: Pokemon): boolean {
    if (when === "grassy-terrain") {
      return globalScene.arena.terrain?.terrainType === TerrainType.GRASSY;
    }
    // "sun" reads through userActsInSun so a Chloroplast/Solar Flare/Big Leaves
    // holder (acts-as-if-in-sun) lays the sea-of-fire/rainbow even in neutral
    // weather — mirroring the Weather Ball / Growth / Synthesis callsites.
    if (when === "sun") {
      return userActsInSun(user);
    }
    const weather = globalScene.arena.weather;
    if (!weather || weather.isEffectSuppressed()) {
      return false;
    }
    const wt = weather.weatherType;
    return wt === WeatherType.RAIN || wt === WeatherType.HEAVY_RAIN;
  }

  override apply(user: Pokemon, target: Pokemon, move: Move, args: any[]): boolean {
    if (!super.apply(user, target, move, args)) {
      return false;
    }
    // Only lay the effect when the move actually connected (mirrors vanilla
    // AddPledgeEffectAttr — no rainbow/swamp on a miss or a protected hit).
    if (user.getLastXMoves(1)[0]?.result !== MoveResult.SUCCESS) {
      return false;
    }
    let applied = false;
    for (const rule of this.rules) {
      if (!this.isActive(rule.when, user)) {
        continue;
      }
      const side = rule.selfSide
        ? user.isPlayer()
          ? ArenaTagSide.PLAYER
          : ArenaTagSide.ENEMY
        : user.isPlayer()
          ? ArenaTagSide.ENEMY
          : ArenaTagSide.PLAYER;
      if (globalScene.arena.getTagOnSide(rule.tag, side)) {
        continue; // already present — don't reset/stack
      }
      if (globalScene.arena.addTag(rule.tag, PLEDGE_TAG_TURNS, move.id, user.id, side)) {
        applied = true;
      }
    }
    return applied;
  }
}
