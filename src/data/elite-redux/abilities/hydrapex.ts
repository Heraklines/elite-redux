/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — bespoke ability `Hydrapex` (Batch 4, item 4).
//
// GENERAL ability (works on ANY holder). When the holder uses a SINGLE-TARGET
// biting or Dragon-type move, the main hit resolves normally on the selected
// target; then each of two side heads strikes ANOTHER active opponent that is
// Dragon-TYPED at 35% power (one side-hit per OTHER Dragon-typed opponent,
// capped at 2; the primary target is skipped). With no other Dragon-typed
// opponent there are no side hits, so the ability is inert in singles by design.
//
// DEFAULTS (documented in the batch report):
//   - Side hits are the SAME move at 35% of its base power with NO secondary
//     effects: the launched cast is a shallow clone of the move with its `attrs`
//     stripped (so guaranteed self-drops, added statuses, multi-hit, charge,
//     etc. do not carry), keeping only its type / category / (reduced) power.
//     Normal type effectiveness + immunity therefore apply (Fairy is immune to
//     Dragon; a non-Dragon-typed foe is never chosen anyway).
//   - Only fires for a move with a positive fixed base power (a fully
//     variable-power move has no 35% reference once attrs are stripped).
//   - Fires ONCE per move execution (guarded), not once per multi-hit.
//   - Side hits are launched in `MoveUseMode.INDIRECT` (PP-free, not copyable,
//     skipped by moveset/history effects).
// =============================================================================

import { PostSummonAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { MoveFlags } from "#enums/move-flags";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import type { AbAttrBaseParams } from "#types/ability-types";
import { scriptedPokemonMove } from "../archetypes/scripted-move-util";

/** Hand-authored ER-custom ability id (both the ER-source id and the pokerogue id). */
export const ER_HYDRAPEX_ABILITY_ID = 5931;

/** Fraction of the move's base power each side head deals. */
export const HYDRAPEX_SIDE_HEAD_POWER = 0.35;

/** Maximum number of side heads (extra opponents struck). */
export const HYDRAPEX_MAX_SIDE_HEADS = 2;

/** Pure marker: Hydrapex is entirely driven by the on-hit seam below. */
export class HydrapexAbAttr extends PostSummonAbAttr {
  constructor() {
    super(false);
  }

  override apply(_params: AbAttrBaseParams): void {}
}

/** Whether `pokemon` carries an unsuppressed, active Hydrapex. */
function hasHydrapex(pokemon: Pokemon): boolean {
  return (
    pokemon.isActive(true) && pokemon.getAllActiveAbilityAttrs().some(a => a?.constructor?.name === "HydrapexAbAttr")
  );
}

/** Whether `move` (as used by `user`) is a biting move or resolves to Dragon type. */
function isBitingOrDragon(user: Pokemon, move: Move): boolean {
  return move.hasFlag(MoveFlags.BITING_MOVE) || user.getMoveType(move) === PokemonType.DRAGON;
}

/** Per-move-execution guard so side heads fire once, not once per multi-hit. */
let hydrapexFiredKey = "";

/**
 * On-hit half (driven from the Batch-4 on-hit seam): after the holder's
 * single-target biting/Dragon move lands on `primaryTarget`, launch up to two
 * side heads at OTHER active Dragon-typed opponents at 35% power.
 */
export function erHydrapexOnHit(user: Pokemon, primaryTarget: Pokemon, move: Move): void {
  if (!hasHydrapex(user) || move.isMultiTarget() || move.power <= 0) {
    return;
  }
  if (!isBitingOrDragon(user, move)) {
    return;
  }
  const battle = globalScene.currentBattle;
  const key = `${battle?.waveIndex ?? 0}:${battle?.turn ?? 0}:${user.id}:${move.id}`;
  if (hydrapexFiredKey === key) {
    return;
  }
  hydrapexFiredKey = key;

  const others = user
    .getOpponents()
    .filter(o => o !== primaryTarget && !o.isFainted() && o.isOfType(PokemonType.DRAGON))
    .slice(0, HYDRAPEX_MAX_SIDE_HEADS);
  if (others.length === 0) {
    return;
  }

  const sidePower = Math.max(1, Math.round(move.power * HYDRAPEX_SIDE_HEAD_POWER));
  for (const other of others) {
    const sideMove = scriptedPokemonMove(move.id, sidePower);
    // Strip every attr so the side head carries NO secondary effect (guaranteed
    // self-drops, added statuses, multi-hit, charge). A NEW array on the clone,
    // never mutating the registered move.
    const built = sideMove.getMove();
    (built as unknown as { attrs: unknown[] }).attrs = [];
    globalScene.phaseManager.unshiftNew("MovePhase", user, [other.getBattlerIndex()], sideMove, MoveUseMode.INDIRECT);
  }
}

/** Test helper: reset the once-per-move guard between isolated scenarios. */
export function resetHydrapexGuard(): void {
  hydrapexFiredKey = "";
}
