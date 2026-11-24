/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PostSummonAbAttr, PreLeaveFieldAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { WeatherType } from "#enums/weather-type";
import type { AbAttrBaseParams } from "#types/ability-types";

const SNOW_CLOAK_WEATHERS = [WeatherType.HAIL, WeatherType.SNOW] as const;

/** Creates Snow Cloak's source-owned Aurora Veil while hail or snow is active. */
export class PostSummonSnowCloakAuroraVeilAbAttr extends PostSummonAbAttr {
  /** The field effect that is set on the holder's side (Aurora Veil for Snow Cloak). */
  private readonly tag: ArenaTagType;

  constructor(tag: ArenaTagType = ArenaTagType.AURORA_VEIL) {
    super();
    this.tag = tag;
  }

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: AbAttrBaseParams) => boolean) | undefined;

  /**
   * Tier B split (ability studio spec 3.1). The old `canApply` was the single clause "the weather is hail or snow", a pure read of
   * the arena. It is the whole replaceable gate; there is no guard and no residual.
   */
  override canApply(params: AbAttrBaseParams): boolean {
    return gatedCanApply<AbAttrBaseParams>(this, params);
  }

  /** The replaceable condition: the weather is hail or snow. Moved verbatim from the old `canApply`. */
  public gate(_params: AbAttrBaseParams): boolean {
    return SNOW_CLOAK_WEATHERS.includes(globalScene.arena.weatherType as (typeof SNOW_CLOAK_WEATHERS)[number]);
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    const side = pokemon.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
    const existing = globalScene.arena.getTagOnSide(this.tag, side);
    if (existing) {
      globalScene.arena.removeTagOnSide(this.tag, side, true);
    }
    // Arena tags with a non-positive duration are indefinite. Arena weather
    // cleanup removes this tag as soon as hail/snow ends.
    globalScene.arena.addTag(this.tag, 0, undefined, pokemon.id, side);
  }
}

/** Removes only the Aurora Veil created by this Snow Cloak holder. */
export class PreLeaveFieldRemoveSnowCloakAuroraVeilAbAttr extends PreLeaveFieldAbAttr {
  /** The field effect that is removed from the holder's side (Aurora Veil for Snow Cloak). */
  private readonly tag: ArenaTagType;

  constructor(tag: ArenaTagType = ArenaTagType.AURORA_VEIL) {
    super(false);
    this.tag = tag;
  }

  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    const side = pokemon.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
    const tag = globalScene.arena.getTagOnSide(this.tag, side);
    return tag?.sourceId === pokemon.id && tag.turnCount <= 0;
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    const side = pokemon.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
    globalScene.arena.removeTagOnSide(this.tag, side);
  }
}
