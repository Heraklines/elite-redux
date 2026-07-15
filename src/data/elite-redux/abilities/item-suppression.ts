/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — reusable HELD-ITEM SUPPRESSION primitive (Batch 3).
//
// Suppresses ONE of a Pokemon's held items for a bounded window: while
// suppressed the item is NOT removed, it simply has no effect — the same
// mechanism the Frisk/Supersweet-Syrup `ER_ITEM_DISABLED` lock uses, gated in
// `PokemonHeldItemModifier.shouldApply`. Built as a standalone module (keyed by
// pokemon id + item type id, with a per-turn expiry) so Negative Feedback and
// any future "item lockout" effect can reuse it without the tag machinery.
//
// Negative Feedback default (documented): the suppressed item is a SEEDED-random
// pick among the target's held items, suppressed until the END of the FOLLOWING
// turn — expiry = current turn + 1, suppressed while `currentTurn <= expiry`, so
// it lifts once that turn ends (mirrors Chivalry's redirect-expiry timing).
// =============================================================================

import { globalScene } from "#app/global-scene";
import type { Pokemon } from "#field/pokemon";

interface SuppressionEntry {
  /** modifierType id of the suppressed held item. */
  typeId: string;
  /** Battle turn through which the suppression stays active (inclusive). */
  expiryTurn: number;
}

/** pokemonId → active suppression (one item per pokemon at a time). */
const SUPPRESSED = new Map<number, SuppressionEntry>();

function currentTurn(): number {
  return globalScene.currentBattle?.turn ?? 0;
}

/**
 * Suppress one SEEDED-random held item on `pokemon` until the end of the
 * following turn. No-op if the pokemon holds no suppressible items. Returns the
 * suppressed item's type id, or `undefined` if nothing was suppressed.
 */
export function suppressRandomHeldItem(pokemon: Pokemon): string | undefined {
  const items = (pokemon.getHeldItems() as ReadonlyArray<{ type?: { id?: string }; formChangeItem?: unknown }>).filter(
    m => m.formChangeItem === undefined && !!m.type?.id,
  );
  if (items.length === 0) {
    return;
  }
  const pick = items.length === 1 ? items[0] : items[globalScene.randBattleSeedInt(items.length)];
  const typeId = pick.type?.id;
  if (!typeId) {
    return;
  }
  SUPPRESSED.set(pokemon.id, { typeId, expiryTurn: currentTurn() + 1 });
  return typeId;
}

/**
 * Whether `pokemon`'s held item with `itemTypeId` is currently suppressed.
 * Lazily clears an expired entry. Consulted from
 * `PokemonHeldItemModifier.shouldApply`.
 */
export function erIsHeldItemSuppressed(pokemon: Pokemon, itemTypeId: string | undefined): boolean {
  if (!itemTypeId) {
    return false;
  }
  const entry = SUPPRESSED.get(pokemon.id);
  if (!entry) {
    return false;
  }
  if (currentTurn() > entry.expiryTurn) {
    SUPPRESSED.delete(pokemon.id);
    return false;
  }
  return entry.typeId === itemTypeId;
}

/** Test helper: the currently-suppressed item type id for a pokemon, or `undefined`. */
export function erSuppressedItemTypeId(pokemon: Pokemon): string | undefined {
  const entry = SUPPRESSED.get(pokemon.id);
  return entry && currentTurn() <= entry.expiryTurn ? entry.typeId : undefined;
}

/** Test helper: clear all suppression state. */
export function resetItemSuppression(): void {
  SUPPRESSED.clear();
}
