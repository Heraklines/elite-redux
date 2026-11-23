/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `self-persistent-bleed` archetype.
//
// "Pokemon with this ability gain an unremovable bleed status condition."
// The holder is kept perpetually bleeding: the ER_BLEED tag is (re)applied at
// every turn end whenever it is absent (e.g. after a heal cured it) and the
// holder is not immune (Rock/Ghost, handled by ErBleedTag.canAdd). The summon
// application itself is wired via the vanilla PostSummonAddBattlerTagAbAttr.
//
// Wires:
//   - 673 Blood Stain — "Is always bleeding if not immune. Spreads on contact."
//     (paired with the contact ER_BLEED spreader)
// =============================================================================

import { type AbAttrBaseParams, PostTurnAbAttr } from "#abilities/ab-attrs";
import { gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { BattlerTagType } from "#enums/battler-tag-type";

export class SelfPersistentBleedAbAttr extends PostTurnAbAttr {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: AbAttrBaseParams) => boolean) | undefined;

  /** Tier B split (ability studio spec 3.1), in the original clause order: the gate, then the residual. */
  override canApply(params: AbAttrBaseParams): boolean {
    return gatedCanApply<AbAttrBaseParams>(this, params);
  }

  /** The replaceable condition: the holder is not bleeding right now. */
  public gate({ pokemon }: AbAttrBaseParams): boolean {
    return !pokemon.getTag(BattlerTagType.ER_BLEED);
  }

  /** Stays in the class (feasibility): bleeding can be added (Rock and Ghost types and other ER major conditions refuse it). */
  public residual({ pokemon }: AbAttrBaseParams): boolean {
    return pokemon.canAddTag(BattlerTagType.ER_BLEED);
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (!simulated) {
      pokemon.addTag(BattlerTagType.ER_BLEED);
    }
  }
}
