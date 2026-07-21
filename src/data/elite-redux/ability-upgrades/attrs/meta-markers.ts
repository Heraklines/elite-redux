/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { AbAttr } from "#abilities/ab-attrs";
import type { PokeballType } from "#enums/pokeball";
import type { PokemonType } from "#enums/pokemon-type";

function validatePositive(owner: string, field: string, value: number): void {
  if (!(value > 0)) {
    throw new Error(`[${owner}] ${field} must be > 0; got ${value}`);
  }
}

/** Marker consumed by biome-choice generation to reveal extra destinations. */
export class BiomeRevealBonusAbAttr extends AbAttr {
  public readonly erMetaKind = "biome-reveal-bonus";
  private readonly count: number;

  constructor(count = 1) {
    super(false);
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(`[BiomeRevealBonusAbAttr] count must be a positive integer; got ${count}`);
    }
    this.count = count;
  }

  public getCount(): number {
    return this.count;
  }
}

/** Marker consumed by encounter generation to weight a Pokemon type. */
export class EncounterTypeWeightAbAttr extends AbAttr {
  public readonly erMetaKind = "encounter-type-weight";
  private readonly type: PokemonType;
  private readonly multiplier: number;

  constructor(type: PokemonType, multiplier: number) {
    super(false);
    validatePositive("EncounterTypeWeightAbAttr", "multiplier", multiplier);
    this.type = type;
    this.multiplier = multiplier;
  }

  public getType(): PokemonType {
    return this.type;
  }

  public getMultiplier(): number {
    return this.multiplier;
  }
}

/** Marker consumed by experience rewards while the ability is eligible. */
export class ExperienceGainMultiplierAbAttr extends AbAttr {
  public readonly erMetaKind = "experience-gain-multiplier";
  private readonly multiplier: number;

  constructor(multiplier: number) {
    super(false);
    validatePositive("ExperienceGainMultiplierAbAttr", "multiplier", multiplier);
    this.multiplier = multiplier;
  }

  public getMultiplier(): number {
    return this.multiplier;
  }
}

/** Marker consumed by battle-end money rewards while the ability is active. */
export class MoneyGainMultiplierAbAttr extends AbAttr {
  public readonly erMetaKind = "money-gain-multiplier";
  private readonly multiplier: number;

  constructor(multiplier: number) {
    super(false);
    validatePositive("MoneyGainMultiplierAbAttr", "multiplier", multiplier);
    this.multiplier = multiplier;
  }

  public getMultiplier(): number {
    return this.multiplier;
  }
}

/** Marker describing which used ball types an ability may restore after battle. */
export class BallRecoveryAbAttr extends AbAttr {
  public readonly erMetaKind = "ball-recovery";
  private readonly recoverableBalls: readonly PokeballType[];

  constructor(recoverableBalls: readonly PokeballType[]) {
    super(false);
    if (recoverableBalls.length === 0) {
      throw new Error("[BallRecoveryAbAttr] recoverableBalls must be non-empty");
    }
    this.recoverableBalls = [...new Set(recoverableBalls)];
  }

  public getRecoverableBalls(): readonly PokeballType[] {
    return this.recoverableBalls;
  }
}
