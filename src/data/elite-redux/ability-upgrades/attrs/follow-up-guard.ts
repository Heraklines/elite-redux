/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { isVirtual } from "#enums/move-use-mode";
import type { Pokemon } from "#field/pokemon";

export function canTriggerFollowUpMove(pokemon: Pokemon): boolean {
  if (pokemon.turnData.hitsLeft > 1) {
    return false;
  }

  const lastUseMode = pokemon.getLastXMoves(1)[0]?.useMode;
  return lastUseMode === undefined || !isVirtual(lastUseMode);
}
