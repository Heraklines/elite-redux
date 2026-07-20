/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CoopAuthoritativeBattleStateV1 } from "#data/elite-redux/coop/coop-transport";

/**
 * One shared definition of a mechanically complete authoritative image.
 *
 * Authority V2 entry construction, ordinary projection, recovery, and the legacy
 * operation migration carriers must agree on this predicate. A tick/wave marker
 * without the complete party, field, inventory, and modifier collections is not
 * a state image and must never be admitted to the mechanical log.
 */
export function isCompleteCoopOperationAuthorityState(
  value: CoopAuthoritativeBattleStateV1 | null | undefined,
  wave: number,
  turn: number,
): value is CoopAuthoritativeBattleStateV1 & {
  readonly double: boolean;
  readonly lockModifierTiers: boolean;
  readonly seed: string;
  readonly waveSeed: string;
} {
  return (
    value != null
    && value.version === 1
    && Number.isSafeInteger(value.tick)
    && value.tick > 0
    && value.wave === wave
    && value.turn === turn
    && typeof value.double === "boolean"
    && Number.isFinite(value.weather)
    && Number.isFinite(value.weatherTurnsLeft)
    && Number.isFinite(value.terrain)
    && Number.isFinite(value.terrainTurnsLeft)
    && Number.isFinite(value.money)
    && typeof value.lockModifierTiers === "boolean"
    && typeof value.seed === "string"
    && typeof value.waveSeed === "string"
    && Array.isArray(value.playerParty)
    && Array.isArray(value.enemyParty)
    && Array.isArray(value.field)
    && Array.isArray(value.arenaTags)
    && Array.isArray(value.pokeballCounts)
    && Array.isArray(value.playerModifiers)
    && Array.isArray(value.enemyModifiers)
  );
}
