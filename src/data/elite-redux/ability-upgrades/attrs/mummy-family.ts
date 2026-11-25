/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PostDefendAbAttr } from "#abilities/ab-attrs";
import { gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import {
  type InnateSlot,
  suppressInnateSlotUntilSwitch,
} from "#data/elite-redux/ability-upgrades/attrs/innate-slot-suppression";
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
  /** Which extra-ability slot is disabled (0 = first, 1 = second, 2 = third). */
  private readonly slot: InnateSlot;

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  constructor(slot: InnateSlot = 0) {
    super();
    this.slot = slot;
  }

  /** Tier B split (ability studio spec 3.1): `gate` then `residual`, in the original clause order (no guards). */
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  /** The replaceable conditions: a contact move, and the attacker is not a Mummy-family holder. */
  public gate({ pokemon, opponent: attacker, move }: PostMoveInteractionAbAttrParams): boolean {
    return (
      move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: attacker, target: pokemon })
      && !hasMummyFamilyAbility(attacker)
    );
  }

  /** Feasibility that stays in the class: the attacker really has an active first innate to disable. */
  public residual({ opponent: attacker }: PostMoveInteractionAbAttrParams): boolean {
    return attacker.getActiveAbilitySources().some(source => source.passive && source.passiveSlot === this.slot);
  }

  override apply({ opponent: attacker, simulated }: PostMoveInteractionAbAttrParams): void {
    if (!simulated) {
      suppressInnateSlotUntilSwitch(attacker, this.slot);
    }
  }

  override getTriggerMessage({ opponent: attacker }: PostMoveInteractionAbAttrParams): string {
    const ordinal = ["first", "second", "third"][this.slot];
    return `${attacker.getNameToRender()}'s ${ordinal} innate was disabled!`;
  }
}
