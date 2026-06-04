import { modifierTypes } from "#data/data-lists";
import type { ModifierType, PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { generateModifierType } from "#mystery-encounters/encounter-phase-utils";
import type { HeldModifierConfig } from "#types/held-modifier-config";

/**
 * Production held-item resolver. Maps a string key (e.g., "LEFTOVERS") to a
 * `HeldModifierConfig` ready for `EnemyPokemonConfig.modifierConfigs`.
 *
 * Returns `null` when the key is unknown or doesn't refer to a per-Pokémon
 * held item — the LLM-authored team is allowed to specify keys we don't
 * recognize; the caller drops them silently.
 *
 * Lives in its own module (not in authored-team.ts) so the pure mapper
 * stays free of `globalScene`-dependent imports and remains unit-testable
 * without mocks.
 */
export function resolveHeldItemKey(key: string): HeldModifierConfig | null {
  const factory = (modifierTypes as Record<string, (() => ModifierType) | undefined>)[key];
  if (typeof factory !== "function") {
    return null;
  }
  const modifier = generateModifierType(factory) as PokemonHeldItemModifierType | null;
  if (!modifier) {
    return null;
  }
  // Only `PokemonHeldItemModifierType` exposes `newModifier` — non-held types
  // (POKEBALL, RARE_CANDY, etc.) lack that field and would crash later when
  // the modifier pool tries to attach the item to a Pokémon.
  if (typeof (modifier as { newModifier?: unknown }).newModifier !== "function") {
    return null;
  }
  return { modifier };
}
