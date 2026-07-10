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
import { WeatherType } from "#enums/weather-type";

/** True while a non-suppressed sandstorm is active. */
const sandActive = (): boolean => {
  const weather = globalScene.arena.weather;
  return weather?.weatherType === WeatherType.SANDSTORM && !weather.isEffectSuppressed();
};

export class SandStatusImmunityAbAttr extends ConditionalUserFieldStatusEffectImmunityAbAttr {
  constructor() {
    // No effect list → immune to ALL status effects while the condition holds.
    super(() => sandActive());
  }
}

export class SandSecondaryEffectImmunityAbAttr extends UserFieldIgnoreMoveEffectsAbAttr {
  override canApply(params: ModifyMoveEffectChanceAbAttrParams): boolean {
    return sandActive() && super.canApply(params);
  }
}
