/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Relics (#439 biome overhaul) - PERMANENT, run-scoped, team-wide "buff"
// items that grant OUT-OF-COMBAT passive effects. Unlike held items they are
// not attached to a single Pokemon: they sit in the player's modifier list as
// relic icons (no pokemonId) and are queried by battle/egg hooks. This mirrors
// the er-community-items pattern, but team-wide.
//
// The modifier class `ErRelicModifier` lives in #modifiers/modifier and the
// ModifierType factory `erRelicModifierType` in #modifiers/modifier-type (both
// REQUIRED there so the vanilla save serializer can round-trip the relics).
//
// First relics:
//   - Field Medic     : every 3 turns, the active player Pokemon recover 1/12
//                       of their max HP (a slow healing spring).
//   - Warm Incubator  : all carried eggs hatch faster (an extra hatch-wave of
//                       progress each wave, applied to every egg).
//
// Icons: existing items-atlas frames + runtime tint (community-item precedent -
// no new atlas frames needed). PokeAPI-sourced bespoke icons are a later polish.
// =============================================================================

import { globalScene } from "#app/global-scene";
import type { Pokemon } from "#field/pokemon";
import { ErRelicModifier } from "#modifiers/modifier";
import { toDmgValue } from "#utils/common";

export type ErRelicKind = "fieldMedic" | "warmIncubator";

export interface ErRelicConfig {
  name: string;
  description: string;
  /** Items-atlas frame used as the summary/fallback icon (tinted). */
  icon: string;
  tint: number;
  maxStack: number;
  /** Standalone er-assets texture key (PokeAPI sprite) for the bar icon. */
  texture: string;
}

export const ER_RELIC_CONFIG: Readonly<Record<ErRelicKind, ErRelicConfig>> = {
  fieldMedic: {
    name: "Field Medic",
    description: "Every 3 turns, your active Pokémon recover 1/12 of their max HP.",
    icon: "healing_charm",
    tint: 0x88f0b0,
    maxStack: 1,
    texture: "er_field_medic",
  },
  warmIncubator: {
    name: "Warm Incubator",
    description: "All of your eggs hatch faster - every egg gains an extra wave of progress each wave.",
    icon: "charcoal",
    tint: 0xffb060,
    maxStack: 1,
    texture: "er_warm_incubator",
  },
};

/** Every relic kind, in display order (used by the type registry). */
export const ER_RELIC_KINDS: readonly ErRelicKind[] = ["fieldMedic", "warmIncubator"];

/** Field Medic: heal cadence (every N turns) and heal fraction (1/denominator). */
const FIELD_MEDIC_TURN_CADENCE = 3;
const FIELD_MEDIC_HEAL_DENOM = 12;
/** Warm Incubator: extra hatch-wave progress per wave, per stack. */
const WARM_INCUBATOR_WAVES_PER_STACK = 1;

/** Total stacks of the given relic the player currently holds (team-wide). */
export function getErRelicStacks(kind: ErRelicKind): number {
  let stacks = 0;
  for (const mod of globalScene?.findModifiers(
    m => m instanceof ErRelicModifier && (m as ErRelicModifier).kind === kind,
    true,
  ) ?? []) {
    stacks += (mod as ErRelicModifier).getStackCount();
  }
  return stacks;
}

/** True when the player currently holds at least one of the given relic. */
export function hasErRelic(kind: ErRelicKind): boolean {
  return getErRelicStacks(kind) > 0;
}

/**
 * Field Medic (relic): called from TurnEndPhase for each active PLAYER Pokemon.
 * On every {@linkcode FIELD_MEDIC_TURN_CADENCE}-th turn, heal the mon 1/12 of
 * its max HP. No-op when the relic isn't held or the mon is already full.
 */
export function erApplyFieldMedic(pokemon: Pokemon): void {
  if (!pokemon.isPlayer() || pokemon.isFullHp() || !hasErRelic("fieldMedic")) {
    return;
  }
  const turn = globalScene.currentBattle?.turn ?? 0;
  if (turn < 1 || turn % FIELD_MEDIC_TURN_CADENCE !== 0) {
    return;
  }
  globalScene.phaseManager.unshiftNew(
    "PokemonHealPhase",
    pokemon.getBattlerIndex(),
    toDmgValue(pokemon.getMaxHp() / FIELD_MEDIC_HEAL_DENOM),
    // ER custom relic - English-only (shared locales submodule).
    `${pokemon.getNameToRender()} was tended by the Field Medic!`,
    true,
  );
}

/**
 * Warm Incubator (relic): extra hatch-wave progress to apply to EVERY egg this
 * wave, on top of the normal -1. Returns 0 when the relic isn't held. Called
 * from EggLapsePhase.
 */
export function erWarmIncubatorBonus(): number {
  return getErRelicStacks("warmIncubator") * WARM_INCUBATOR_WAVES_PER_STACK;
}
