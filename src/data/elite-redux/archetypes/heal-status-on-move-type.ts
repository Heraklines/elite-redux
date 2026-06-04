/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `heal-status-on-move-type` archetype.
//
// Engine-side hook: dispatched through pokerogue's existing
// `applyAbAttrs("PostAttackAbAttr", …)` in MoveEffectPhase, fired after the
// holder's damaging move connects (the same hook used by Poison Touch, Magician,
// the ER lifesteal/chance-status-on-attack archetypes, etc.).
//
// Wires:
//   - 72 VITAL_SPIRIT — ER spec: "Immune to sleep. When the Pokemon uses a
//     <type>-type move, it heals all status conditions immediately after the
//     move resolves." The sleep immunity is the vanilla base ability; this class
//     adds the cure-on-attack rider for the configured move type (Fighting).
// =============================================================================

import { PostAttackAbAttr, type PostMoveInteractionAbAttrParams } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { getStatusEffectHealText } from "#data/status-effect";
import type { PokemonType } from "#enums/pokemon-type";
import { StatusEffect } from "#enums/status-effect";

export class HealStatusOnMoveTypeAbAttr extends PostAttackAbAttr {
  constructor(private readonly moveType: PokemonType) {
    // Any non-status move of the right type qualifies (PostAttack's default
    // attackCondition already requires a damaging move; the type gate is in
    // canApply below so type-changing abilities on the holder are respected).
    super();
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    if (!super.canApply(params)) {
      return false;
    }
    const { pokemon, move } = params;
    // Resolve the move's effective type (respects the holder's type-changing
    // abilities, e.g. -ate abilities) and require a curable primary status.
    return (
      pokemon.getMoveType(move) === this.moveType
      && !!pokemon.status
      && pokemon.status.effect !== StatusEffect.NONE
      && pokemon.status.effect !== StatusEffect.FAINT
    );
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    if (params.simulated) {
      return;
    }
    const { pokemon } = params;
    const effect = pokemon.status?.effect ?? StatusEffect.NONE;
    if (effect === StatusEffect.NONE || effect === StatusEffect.FAINT) {
      return;
    }
    // Cure immediately (asPhase=false) so it resolves within this move, matching
    // the ER "immediately after the move resolves" wording rather than being
    // queued behind end-of-turn phases.
    pokemon.resetStatus(false, false, false, false);
    pokemon.updateInfo();
    globalScene.phaseManager.queueMessage(getStatusEffectHealText(effect, getPokemonNameWithAffix(pokemon)));
  }
}
