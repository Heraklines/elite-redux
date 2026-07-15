/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — bespoke ability `Draconic Voodoo` (Batch 4, item 3).
//
// GENERAL ability (works on ANY holder). Two grafting triggers, both routed
// through the Batch-4 type-graft substrate (`type-graft.ts`), so the grafted
// Dragon type STACKS on top of the target's existing types, NEVER replaces
// them, persists through the target switching out, and auto-expires at wave end.
//
//   - On the holder's ENTRY (PostSummon): the opposing Pokemon DIRECTLY ACROSS
//     (same field slot; falls back to the first opponent in singles / when the
//     across-slot is empty) gains Dragon as an ADDITIONAL type.
//   - On-HIT: whenever the holder DAMAGES any target with a BITING or
//     Dragon-type move, that target also gains Dragon as an additional type.
//
// No effect on a target that is already Dragon-typed (native, tera, or already
// grafted) — the graft substrate's set semantics make the second graft a no-op.
// =============================================================================

import { PostSummonAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { MoveFlags } from "#enums/move-flags";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import type { AbAttrBaseParams } from "#types/ability-types";
import { toCamelCase } from "#utils/strings";
import i18next from "i18next";
import { graftType } from "./type-graft";

/** Hand-authored ER-custom ability id (both the ER-source id and the pokerogue id). */
export const ER_DRACONIC_VOODOO_ABILITY_ID = 5930;

/** The opponent directly across from `holder` (same field slot), or the first opponent. */
function opponentAcross(holder: Pokemon): Pokemon | undefined {
  const opponents = holder.getOpponents();
  if (opponents.length === 0) {
    return;
  }
  const across = opponents.find(o => o.getFieldIndex() === holder.getFieldIndex());
  return across ?? opponents[0];
}

/** Whether `move` (as used by `user`) is a biting move or resolves to Dragon type. */
function isBitingOrDragon(user: Pokemon, move: Move): boolean {
  return move.hasFlag(MoveFlags.BITING_MOVE) || user.getMoveType(move) === PokemonType.DRAGON;
}

/** Graft Dragon onto `target` and announce it (no-op / silent if already Dragon-typed). */
function graftDragon(target: Pokemon): void {
  if (target.isOfType(PokemonType.DRAGON)) {
    return;
  }
  if (graftType(target, PokemonType.DRAGON)) {
    globalScene.phaseManager.queueMessage(
      i18next.t("moveTriggers:addType", {
        typeName: i18next.t(`pokemonInfo:type.${toCamelCase(PokemonType[PokemonType.DRAGON])}`),
        pokemonName: getPokemonNameWithAffix(target),
      }),
    );
  }
}

/** PostSummon half: graft Dragon onto the opponent directly across on entry. */
export class DraconicVoodooAbAttr extends PostSummonAbAttr {
  constructor() {
    super(false);
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    const target = opponentAcross(pokemon);
    if (target) {
      graftDragon(target);
    }
  }
}

/** Whether `pokemon` carries an unsuppressed, active Draconic Voodoo. */
function hasDraconicVoodoo(pokemon: Pokemon): boolean {
  return (
    pokemon.isActive(true)
    && pokemon.getAllActiveAbilityAttrs().some(a => a?.constructor?.name === "DraconicVoodooAbAttr")
  );
}

/**
 * On-hit half (driven from the Batch-4 on-hit seam): when a Draconic Voodoo
 * holder damages `target` with a biting or Dragon-type move, graft Dragon onto
 * that target. `damaging` gates out immune / no-damage connects.
 */
export function erDraconicVoodooOnHit(user: Pokemon, target: Pokemon, move: Move, damaging: boolean): void {
  if (!damaging || target.isFainted() || !hasDraconicVoodoo(user)) {
    return;
  }
  if (!isBitingOrDragon(user, move)) {
    return;
  }
  graftDragon(target);
}
