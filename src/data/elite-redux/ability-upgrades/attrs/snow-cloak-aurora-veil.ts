/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PostSummonAbAttr, PreLeaveFieldAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { WeatherType } from "#enums/weather-type";
import type { AbAttrBaseParams } from "#types/ability-types";

const SNOW_CLOAK_WEATHERS = [WeatherType.HAIL, WeatherType.SNOW] as const;

/** Creates Snow Cloak's source-owned Aurora Veil while hail or snow is active. */
export class PostSummonSnowCloakAuroraVeilAbAttr extends PostSummonAbAttr {
  override canApply(_params: AbAttrBaseParams): boolean {
    return SNOW_CLOAK_WEATHERS.includes(globalScene.arena.weatherType as (typeof SNOW_CLOAK_WEATHERS)[number]);
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    const side = pokemon.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
    const existing = globalScene.arena.getTagOnSide(ArenaTagType.AURORA_VEIL, side);
    if (existing) {
      globalScene.arena.removeTagOnSide(ArenaTagType.AURORA_VEIL, side, true);
    }
    // Arena tags with a non-positive duration are indefinite. Arena weather
    // cleanup removes this tag as soon as hail/snow ends.
    globalScene.arena.addTag(ArenaTagType.AURORA_VEIL, 0, undefined, pokemon.id, side);
  }
}

/** Removes only the Aurora Veil created by this Snow Cloak holder. */
export class PreLeaveFieldRemoveSnowCloakAuroraVeilAbAttr extends PreLeaveFieldAbAttr {
  constructor() {
    super(false);
  }

  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    const side = pokemon.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
    const tag = globalScene.arena.getTagOnSide(ArenaTagType.AURORA_VEIL, side);
    return tag?.sourceId === pokemon.id && tag.turnCount <= 0;
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    const side = pokemon.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
    globalScene.arena.removeTagOnSide(ArenaTagType.AURORA_VEIL, side);
  }
}
