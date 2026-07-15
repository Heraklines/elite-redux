/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — bespoke ability `World in Pieces` (Primal Regigigas).
//
// The holder is innately SEXTUPLE-typed: Normal / Rock / Ice / Steel / Electric
// / Dragon. Since the Primal Regigigas species does not exist yet, this ability
// STAMPS the six types onto the holder at summon when it isn't already
// sextuple-typed (via `summonData.types`, the N-type override path in
// `getBaseTypes`). This doubles as the test vehicle and will be superseded by
// species data later (DECISION, documented in the batch report).
//
// Behavior (binding):
//   - The FIRST direct damaging move that hits the holder each turn removes ONE
//     seeded-random attached NON-Normal type, AFTER that hit's damage resolves
//     (never retroactive to the removing hit — hooked from PostDefend, which
//     fires post-damage). Multihit moves remove only one (once per turn). Normal
//     can never be removed.
//   - Each MISSING type grants a raw +20% Speed (additive per missing type,
//     applied to the effective Speed stat via a StatMultiplier).
//   - Every KO the holder scores RESTORES one seeded-random missing type
//     (DEFAULT, documented).
//
// All randomness goes through the seeded `globalScene.randBattleSeedInt` (co-op
// deterministic). Per-holder state (the full six-type set + the live attached
// set) is module-level, keyed on the holder.
// =============================================================================

import {
  PostDefendAbAttr,
  type PostMoveInteractionAbAttrParams,
  PostSummonAbAttr,
  PostVictoryAbAttr,
  StatMultiplierAbAttr,
  type StatMultiplierAbAttrParams,
} from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import type { AbAttrBaseParams } from "#types/ability-types";

/** Hand-authored ER-custom ability id (both the ER-source id and the pokerogue id). */
export const ER_WORLD_IN_PIECES_ABILITY_ID = 5917;

/** The holder's innate six types, in canonical display order. Normal is never removable. */
export const WORLD_IN_PIECES_TYPES: readonly PokemonType[] = [
  PokemonType.NORMAL,
  PokemonType.ROCK,
  PokemonType.ICE,
  PokemonType.STEEL,
  PokemonType.ELECTRIC,
  PokemonType.DRAGON,
];

/** Raw Speed bonus granted per missing type (additive). */
export const WORLD_IN_PIECES_SPEED_PER_MISSING = 0.2;

/** Live per-holder state: the full type set and the currently-attached subset. */
interface WorldInPiecesState {
  full: readonly PokemonType[];
  attached: Set<PokemonType>;
}

const WORLD_IN_PIECES_STATE = new WeakMap<Pokemon, WorldInPiecesState>();
/** Per-holder record of the wave+turn in which a type was last removed (once/turn). */
const WORLD_IN_PIECES_REMOVED_THIS_TURN = new WeakMap<Pokemon, string>();

/** Stable identity for "this turn of this battle" (wave + turn number). */
function turnKey(): string {
  const battle = globalScene.currentBattle;
  return `${battle?.waveIndex ?? 0}:${battle?.turn ?? 0}`;
}

/** Rebuild `summonData.types` from the attached set, preserving canonical order. */
function syncTypes(pokemon: Pokemon, state: WorldInPiecesState): void {
  pokemon.summonData.types = state.full.filter(t => state.attached.has(t));
}

/** Number of the holder's six types currently missing. */
export function worldInPiecesMissingCount(pokemon: Pokemon): number {
  const state = WORLD_IN_PIECES_STATE.get(pokemon);
  if (!state) {
    return 0;
  }
  return state.full.length - state.attached.size;
}

/** PostSummon half: stamp the six types when the holder isn't already sextuple-typed. */
export class WorldInPiecesSummonAbAttr extends PostSummonAbAttr {
  constructor() {
    super(true);
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    const existing = WORLD_IN_PIECES_STATE.get(pokemon);
    if (existing) {
      // Re-entry (re-summon): restore the full six-type set.
      existing.attached = new Set(existing.full);
      syncTypes(pokemon, existing);
      return;
    }
    // Only stamp when not already carrying all six (idempotent for real species data later).
    const state: WorldInPiecesState = {
      full: WORLD_IN_PIECES_TYPES,
      attached: new Set(WORLD_IN_PIECES_TYPES),
    };
    WORLD_IN_PIECES_STATE.set(pokemon, state);
    syncTypes(pokemon, state);
  }
}

/** PostDefend half: remove one seeded-random non-Normal type after the first direct hit each turn. */
export class WorldInPiecesRemoveTypeAbAttr extends PostDefendAbAttr {
  override canApply({ pokemon, move, damage, hitResult }: PostMoveInteractionAbAttrParams): boolean {
    if (move.category === MoveCategory.STATUS || damage <= 0) {
      return false;
    }
    // Only "real" damaging hits (exclude no-effect/immune).
    if (hitResult === HitResult.NO_EFFECT || hitResult === HitResult.IMMUNE) {
      return false;
    }
    if (WORLD_IN_PIECES_REMOVED_THIS_TURN.get(pokemon) === turnKey()) {
      return false;
    }
    const state = WORLD_IN_PIECES_STATE.get(pokemon);
    if (!state) {
      return false;
    }
    // At least one removable (non-Normal, still attached) type.
    return [...state.attached].some(t => t !== PokemonType.NORMAL);
  }

  override apply({ pokemon, simulated }: PostMoveInteractionAbAttrParams): void {
    if (simulated) {
      return;
    }
    const state = WORLD_IN_PIECES_STATE.get(pokemon);
    if (!state) {
      return;
    }
    const removable = [...state.attached].filter(t => t !== PokemonType.NORMAL);
    if (removable.length === 0) {
      return;
    }
    WORLD_IN_PIECES_REMOVED_THIS_TURN.set(pokemon, turnKey());
    const pick = removable[globalScene.randBattleSeedInt(removable.length)];
    state.attached.delete(pick);
    syncTypes(pokemon, state);
    globalScene.phaseManager.queueMessage(
      `${pokemon.getNameToRender()} lost its ${PokemonType[pick].toLowerCase()} form!`,
    );
  }
}

/** StatMultiplier half: +20% Speed per missing type. */
export class WorldInPiecesSpeedAbAttr extends StatMultiplierAbAttr {
  constructor() {
    super(Stat.SPD, 1);
  }

  override canApply({ stat }: StatMultiplierAbAttrParams): boolean {
    return stat === Stat.SPD;
  }

  override apply(params: StatMultiplierAbAttrParams): void {
    const missing = worldInPiecesMissingCount(params.pokemon);
    params.statVal.value *= 1 + WORLD_IN_PIECES_SPEED_PER_MISSING * missing;
  }
}

/** PostVictory half: every KO restores one seeded-random missing type. */
export class WorldInPiecesRestoreAbAttr extends PostVictoryAbAttr {
  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    return worldInPiecesMissingCount(pokemon) > 0;
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    const state = WORLD_IN_PIECES_STATE.get(pokemon);
    if (!state) {
      return;
    }
    const missing = state.full.filter(t => !state.attached.has(t));
    if (missing.length === 0) {
      return;
    }
    const pick = missing[globalScene.randBattleSeedInt(missing.length)];
    state.attached.add(pick);
    syncTypes(pokemon, state);
    globalScene.phaseManager.queueMessage(
      `${pokemon.getNameToRender()} reclaimed its ${PokemonType[pick].toLowerCase()} form!`,
    );
  }
}

/** Test helper: the holder's live attached types (canonical order), or `undefined`. */
export function erWorldInPiecesAttached(pokemon: Pokemon): PokemonType[] | undefined {
  const state = WORLD_IN_PIECES_STATE.get(pokemon);
  return state ? state.full.filter(t => state.attached.has(t)) : undefined;
}
