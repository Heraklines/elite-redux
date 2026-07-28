/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { recordCoopEvent } from "#data/elite-redux/coop/coop-turn-recorder";
import type { CommonAnim } from "#enums/move-anims-common";
import type { Pokemon } from "#field/pokemon";

/**
 * Retain one plain common VFX that cannot be represented by `CommonAnimPhase` because its caller owns
 * an immediate/floating animation. This is presentation only: the ordinary authority still plays its
 * existing local animation and all mechanics remain in the caller.
 *
 * Callers must not use this for effects with a richer typed event (status acquisition, Tera, weather,
 * terrain, and so on), because that would author the same visible event twice.
 */
export function recordDirectCoopCommonAnimPresentation(
  anim: CommonAnim,
  source: Pokemon,
  target: Pokemon = source,
): number | null {
  try {
    const sourceId = source.id;
    const targetId = target.id;
    const bi = source.getBattlerIndex();
    const targetBi = target.getBattlerIndex();
    if (
      !Number.isSafeInteger(sourceId)
      || sourceId <= 0
      || !Number.isSafeInteger(targetId)
      || targetId <= 0
      || !Number.isSafeInteger(bi)
      || bi < 0
      || !Number.isSafeInteger(targetBi)
      || targetBi < 0
    ) {
      return null;
    }
    return recordCoopEvent({
      k: "commonAnim",
      anim,
      bi,
      actor: { side: source.isPlayer() ? "player" : "enemy", pokemonId: sourceId },
      targetBi,
      targetActor: { side: target.isPlayer() ? "player" : "enemy", pokemonId: targetId },
    });
  } catch {
    // The local visual is deliberately unchanged. An unaddressable cosmetic cue is not put on the wire
    // because a renderer could not prove which exact actor the authority meant.
    return null;
  }
}
