/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `add-type-to-attacker-on-contact` archetype.
//
// When an opponent makes contact with the holder, the attacker gains an extra
// type (the same `summonData.addedType` mechanism used by Forest's Curse /
// Trick-or-Treat). No-op if the attacker is terastallized or already has the
// type.
//
// Wires:
//   - 807 Woodland Curse — "Adds Grass type on contact." (paired with the
//     Forest's-Curse-on-entry scripted move.)
// =============================================================================

import { PostDefendAbAttr, type PostMoveInteractionAbAttrParams } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { MoveFlags } from "#enums/move-flags";
import { PokemonType } from "#enums/pokemon-type";
import { toCamelCase } from "#utils/strings";
import i18next from "i18next";

export class AddTypeToAttackerOnContactAbAttr
  extends PostDefendAbAttr
  implements GatedAttr<PostMoveInteractionAbAttrParams>
{
  private readonly addedType: PokemonType;

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  constructor(addedType: PokemonType) {
    super();
    this.addedType = addedType;
  }

  /** Tier B split (ability studio spec 3.1), in the ORIGINAL clause order: `gate` (contact), then `residual`. */
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  /** The replaceable condition: the move makes contact (a contact-ignoring attacker or a substitute hit does not count). */
  public gate({ pokemon, move, opponent: attacker }: PostMoveInteractionAbAttrParams): boolean {
    return move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: attacker, target: pokemon });
  }

  /** Feasibility that stays in the class: a Terastallized attacker and one that already has the type are left alone. */
  public residual({ opponent: attacker }: PostMoveInteractionAbAttrParams): boolean {
    return !attacker.isTerastallized && !attacker.isOfType(this.addedType);
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    const { opponent: attacker, simulated } = params;
    if (simulated) {
      return;
    }
    attacker.summonData.addedType = this.addedType;
    attacker.updateInfo();
    globalScene.phaseManager.queueMessage(
      i18next.t("moveTriggers:addType", {
        typeName: i18next.t(`pokemonInfo:type.${toCamelCase(PokemonType[this.addedType])}`),
        pokemonName: getPokemonNameWithAffix(attacker),
      }),
    );
  }
}
