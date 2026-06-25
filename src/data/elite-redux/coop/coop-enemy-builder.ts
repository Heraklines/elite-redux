/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op GUEST enemy RECONSTRUCTOR (#633). Rebuilds ONE live EnemyPokemon from the
// host's serialized identity so the guest fights the host's EXACT mon (species /
// form / level / ability / nature / gender / IVs / moveset / held items) instead of
// rolling its own from a diverged RNG.
//
// Extracted into its own module so BOTH the wave-start adopt (`encounter-phase.ts`)
// AND the mid-wave ME battle handoff adopt (`encounter-phase-utils.ts`) can import it
// WITHOUT an import cycle (encounter-phase imports encounter-phase-utils, so the
// utils file can't import back from encounter-phase).
// =============================================================================

import { globalScene } from "#app/global-scene";
import { applyCoopEnemyHeldItems } from "#data/elite-redux/coop/coop-battle-engine";
import type { CoopSerializedPokemon } from "#data/elite-redux/coop/coop-transport";
import type { Gender } from "#data/gender";
import type { Nature } from "#enums/nature";
import { TrainerSlot } from "#enums/trainer-slot";
import type { EnemyPokemon } from "#field/pokemon";
import { PokemonMove } from "#moves/pokemon-move";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/** Read a number field from an opaque serialized blob, or undefined if absent/wrong type. */
function coopNum(blob: CoopSerializedPokemon, key: string): number | undefined {
  const v = blob[key];
  return typeof v === "number" ? v : undefined;
}

/**
 * Co-op GUEST (#633, LIVE-D6): reconstruct ONE enemy from the host's serialized
 * identity so the guest fights the host's EXACT mon (species / form / level /
 * ability / nature / gender / IVs / moveset) instead of rolling its own from a
 * diverged RNG. Mirrors `buildDevEnemy`. Returns null when the species doesn't
 * resolve, so the caller leaves the slot for normal generation.
 */
export function buildCoopEnemy(
  data: CoopSerializedPokemon,
  fallbackLevel: number,
  trainerSlot: TrainerSlot = TrainerSlot.NONE,
): EnemyPokemon | null {
  const speciesId = coopNum(data, "speciesId");
  if (speciesId === undefined) {
    return null;
  }
  const species = getPokemonSpecies(speciesId);
  if (!species) {
    return null;
  }
  const level = Math.max(1, Math.floor(coopNum(data, "level") ?? fallbackLevel));
  const enemy = globalScene.addEnemyPokemon(species, level, trainerSlot, false);
  const formIndex = coopNum(data, "formIndex");
  if (formIndex !== undefined) {
    enemy.formIndex = formIndex;
  }
  const abilityIndex = coopNum(data, "abilityIndex");
  if (abilityIndex !== undefined) {
    enemy.abilityIndex = abilityIndex;
  }
  const nature = coopNum(data, "nature");
  if (nature !== undefined) {
    enemy.nature = nature as Nature;
  }
  const gender = coopNum(data, "gender");
  if (gender !== undefined) {
    enemy.gender = gender as Gender;
  }
  // Adopt the host's authoritative shiny + variant (#633): the constructor already
  // rolled its own from a divergent RNG cursor, so override it here - BEFORE the
  // encounter loop calls loadAssets() - and both clients render (and catch) the same
  // mon. `typeof === "boolean"` so an explicit `false` still overrides a rolled shiny.
  if (typeof data.shiny === "boolean") {
    enemy.shiny = data.shiny;
  }
  const variant = coopNum(data, "variant");
  if (variant !== undefined) {
    enemy.variant = variant as 0 | 1 | 2;
  }
  if (Array.isArray(data.ivs)) {
    const ivs = (data.ivs as unknown[]).filter((n): n is number => typeof n === "number").slice(0, 6);
    if (ivs.length === 6) {
      enemy.ivs = ivs;
    }
  }
  if (Array.isArray(data.moveset)) {
    const moveIds = (data.moveset as unknown[]).filter((n): n is number => typeof n === "number");
    if (moveIds.length > 0) {
      const moves = moveIds.map(id => new PokemonMove(id));
      enemy.moveset = moves;
      enemy.summonData.moveset = moves.slice();
    }
  }
  // Form / nature / IVs changed -> recompute stats + name, then align current hp.
  enemy.calculateStats();
  enemy.generateName();
  const hp = coopNum(data, "hp");
  if (hp !== undefined) {
    enemy.hp = Math.max(0, Math.min(hp, enemy.getMaxHp()));
  }
  // Held items (#633): reconstruct the host's serialized held modifiers onto THIS enemy
  // (remapping pokemonId to the live id). The adopt path suppresses the guest's own
  // generateEnemyModifiers for these enemies, so this is the sole source of their items.
  applyCoopEnemyHeldItems(enemy.id, data.heldItems);
  return enemy;
}
