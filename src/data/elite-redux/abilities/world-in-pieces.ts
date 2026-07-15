/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — bespoke ability `World in Pieces`.
//
// GENERAL ability (works on ANY holder, whatever its typing): it does NOT stamp
// a fixed type set. It operates on the holder's ACTUAL types.
//
// Behavior (binding):
//   - The FIRST direct damaging move that hits the holder each turn removes ONE
//     seeded-random attached NON-Normal type, AFTER that hit's damage resolves
//     (never retroactive to the removing hit — hooked from PostDefend, which
//     fires post-damage). Multihit moves remove only one (once per turn). Normal
//     can never be removed. If the holder has no removable non-Normal type left,
//     the strip simply does nothing.
//   - Each MISSING (removed) type grants a raw +20% Speed (additive per missing
//     type, applied to the effective Speed stat via a StatMultiplier).
//   - Every KO the holder scores RESTORES one seeded-random previously-removed
//     type (DEFAULT, documented).
//
// State per holder: `original` (the holder's type list, snapshotted lazily the
// first time a type is stripped — read straight from `getTypes()`, never a
// hard-coded set) + `removed` (the set of stripped types). The live types are
// rebuilt as `original − removed` into `summonData.types`. On (re)summon the
// state is cleared so a switched-in holder starts whole. All randomness goes
// through the seeded `globalScene.randBattleSeedInt` (co-op deterministic).
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

/** Raw Speed bonus granted per missing type (additive). */
export const WORLD_IN_PIECES_SPEED_PER_MISSING = 0.2;

/** Live per-holder state: the original type list and the currently-removed subset. */
interface WorldInPiecesState {
  /** Snapshot of the holder's types, taken lazily the first time a type is stripped. */
  original: PokemonType[] | undefined;
  removed: Set<PokemonType>;
}

const WORLD_IN_PIECES_STATE = new WeakMap<Pokemon, WorldInPiecesState>();
/** Per-holder record of the wave+turn in which a type was last removed (once/turn). */
const WORLD_IN_PIECES_REMOVED_THIS_TURN = new WeakMap<Pokemon, string>();

/** Stable identity for "this turn of this battle" (wave + turn number). */
function turnKey(): string {
  const battle = globalScene.currentBattle;
  return `${battle?.waveIndex ?? 0}:${battle?.turn ?? 0}`;
}

function getState(pokemon: Pokemon): WorldInPiecesState {
  let state = WORLD_IN_PIECES_STATE.get(pokemon);
  if (!state) {
    state = { original: undefined, removed: new Set() };
    WORLD_IN_PIECES_STATE.set(pokemon, state);
  }
  return state;
}

/** Rebuild `summonData.types` from the original set minus the removed subset. */
function syncTypes(pokemon: Pokemon, state: WorldInPiecesState): void {
  if (!state.original) {
    return;
  }
  pokemon.summonData.types = state.original.filter(t => !state.removed.has(t));
}

/** The holder's currently-attached NON-Normal types (candidates for stripping). */
function removableTypes(pokemon: Pokemon): PokemonType[] {
  const state = WORLD_IN_PIECES_STATE.get(pokemon);
  const base = state?.original ?? pokemon.getTypes();
  const removed = state?.removed;
  return base.filter(t => t !== PokemonType.NORMAL && !(removed?.has(t) ?? false));
}

/** Number of the holder's types currently removed. */
export function worldInPiecesMissingCount(pokemon: Pokemon): number {
  return WORLD_IN_PIECES_STATE.get(pokemon)?.removed.size ?? 0;
}

/** PostSummon half: clear state on (re)entry so a switched-in holder starts whole. */
export class WorldInPiecesSummonAbAttr extends PostSummonAbAttr {
  constructor() {
    super(false);
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    WORLD_IN_PIECES_STATE.set(pokemon, { original: undefined, removed: new Set() });
    WORLD_IN_PIECES_REMOVED_THIS_TURN.delete(pokemon);
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
    // At least one removable (non-Normal) type currently attached.
    return removableTypes(pokemon).length > 0;
  }

  override apply({ pokemon, simulated }: PostMoveInteractionAbAttrParams): void {
    if (simulated) {
      return;
    }
    const state = getState(pokemon);
    // Snapshot the holder's actual types the first time we strip (never a fixed set).
    if (!state.original) {
      state.original = [...pokemon.getTypes()];
    }
    const removable = state.original.filter(t => t !== PokemonType.NORMAL && !state.removed.has(t));
    if (removable.length === 0) {
      return;
    }
    WORLD_IN_PIECES_REMOVED_THIS_TURN.set(pokemon, turnKey());
    const pick = removable[globalScene.randBattleSeedInt(removable.length)];
    state.removed.add(pick);
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

/** PostVictory half: every KO restores one seeded-random removed type. */
export class WorldInPiecesRestoreAbAttr extends PostVictoryAbAttr {
  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    return worldInPiecesMissingCount(pokemon) > 0;
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    const state = WORLD_IN_PIECES_STATE.get(pokemon);
    if (!state || state.removed.size === 0) {
      return;
    }
    const removedList = [...state.removed];
    const pick = removedList[globalScene.randBattleSeedInt(removedList.length)];
    state.removed.delete(pick);
    syncTypes(pokemon, state);
    globalScene.phaseManager.queueMessage(
      `${pokemon.getNameToRender()} reclaimed its ${PokemonType[pick].toLowerCase()} form!`,
    );
  }
}

/** Test helper: the holder's live attached types, or `undefined` if it has none. */
export function erWorldInPiecesAttached(pokemon: Pokemon): PokemonType[] | undefined {
  const state = WORLD_IN_PIECES_STATE.get(pokemon);
  if (state?.original) {
    return state.original.filter(t => !state.removed.has(t));
  }
  const types = pokemon.getTypes();
  return types.length > 0 ? [...types] : undefined;
}
