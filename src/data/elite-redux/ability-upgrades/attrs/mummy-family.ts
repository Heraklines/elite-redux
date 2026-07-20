/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PostDefendAbAttr } from "#abilities/ab-attrs";
import { suppressInnateSlotUntilSwitch } from "#data/elite-redux/ability-upgrades/attrs/innate-slot-suppression";
import { AbilityId } from "#enums/ability-id";
import { MoveFlags } from "#enums/move-flags";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";

const MUMMY_FAMILY = [AbilityId.MUMMY, AbilityId.LINGERING_AROMA, AbilityId.WANDERING_SPIRIT] as const;

export function hasMummyFamilyAbility(pokemon: PostMoveInteractionAbAttrParams["pokemon"]): boolean {
  return MUMMY_FAMILY.some(ability => pokemon.hasAbility(ability));
}

/**
 * Mummy-family rider: contact with the holder disables the attacker's first
 * innate for only the lifetime of its current summon.
 */
export class PostDefendSuppressFirstInnateAbAttr extends PostDefendAbAttr {
  override canApply({ pokemon, opponent: attacker, move }: PostMoveInteractionAbAttrParams): boolean {
    return (
      move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: attacker, target: pokemon })
      && !hasMummyFamilyAbility(attacker)
      && attacker.getActiveAbilitySources().some(source => source.passive && source.passiveSlot === 0)
    );
  }

  override apply({ opponent: attacker, simulated }: PostMoveInteractionAbAttrParams): void {
    if (!simulated) {
      suppressInnateSlotUntilSwitch(attacker, 0);
    }
  }

  override getTriggerMessage({ opponent: attacker }: PostMoveInteractionAbAttrParams): string {
    return `${attacker.getNameToRender()}'s first innate was disabled!`;
  }
}
