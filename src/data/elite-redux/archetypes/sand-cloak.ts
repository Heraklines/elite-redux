/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `sand-cloak` archetype.
//
// "All allies become immune to status conditions and secondary effects from
// enemy moves while sand is active."
//
// Two cooperating attrs, both gated on an active (un-suppressed) sandstorm:
//   1. SandStatusImmunityAbAttr — side-wide status immunity (extends the
//      vanilla ConditionalUserFieldStatusEffectImmunityAbAttr, like Flower
//      Veil) so the holder AND its allies are immune to all status while sand
//      is up.
//   2. SandSecondaryEffectImmunityAbAttr — zeroes incoming move secondary-
//      effect chance SIDE-WIDE (holder + allies). Extends the user-field
//      UserFieldIgnoreMoveEffectsAbAttr (NOT holder-only Shield Dust), which the
//      effect-chance site consults across the whole target field.
//
// Wires:
//   - 412 Desert Cloak — "Protects its side from status and secondary effects
//     in sand."
// =============================================================================

import {
  ConditionalUserFieldStatusEffectImmunityAbAttr,
  type ModifyMoveEffectChanceAbAttrParams,
  UserFieldIgnoreMoveEffectsAbAttr,
} from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import type { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";

/** True while a non-suppressed sandstorm is active. */
const sandActive = (): boolean => {
  const weather = globalScene.arena.weather;
  return weather?.weatherType === WeatherType.SANDSTORM && !weather.isEffectSuppressed();
};

export class SandStatusImmunityAbAttr extends ConditionalUserFieldStatusEffectImmunityAbAttr {
  /**
   * @param condition - When the immunity holds. The default is the sandstorm test, so `new SandStatusImmunityAbAttr()`
   *   (what the archetype dispatcher calls) behaves exactly as before; the ability studio hands in a replacement.
   * @param immuneEffects - The statuses to block. No effect list → immune to ALL status effects while the condition holds.
   */
  constructor(
    condition: (target: Pokemon, source: Pokemon | null) => boolean = () => sandActive(),
    ...immuneEffects: StatusEffect[]
  ) {
    super(condition, ...immuneEffects);
  }
}

export class SandSecondaryEffectImmunityAbAttr extends UserFieldIgnoreMoveEffectsAbAttr {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: ModifyMoveEffectChanceAbAttrParams) => boolean) | undefined;

  /** Tier B split (ability studio spec 3.1), in the original clause order: the sandstorm gate, then the residual. */
  override canApply(params: ModifyMoveEffectChanceAbAttrParams): boolean {
    return gatedCanApply<ModifyMoveEffectChanceAbAttrParams>(this, params);
  }

  /** The replaceable condition: a non-suppressed sandstorm is active. */
  public gate(_params?: ModifyMoveEffectChanceAbAttrParams): boolean {
    return sandActive();
  }

  /** Stays in the class: the move has a chance of an extra effect (the parent's own test). */
  public residual(params: ModifyMoveEffectChanceAbAttrParams): boolean {
    return super.canApply(params);
  }
}
