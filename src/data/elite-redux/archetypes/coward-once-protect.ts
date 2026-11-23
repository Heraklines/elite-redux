/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `coward-once-protect` archetype.
//
// PostSummon hook that adds the PROTECTED battler tag to the holder once
// per battle. ER's Coward ability ("Sets up Protect on switch-in. Only
// works once") needs this single-use semantics — a naive PostSummon
// would re-fire on every switch-in.
//
// We track the "used" state on the Pokémon's per-battle data
// (`battleData.cowardProtectUsed`), which is cleared by `resetBattleAndWaveData`
// at the start of every new battle. This gives true "once per battle" semantics
// that RE-ARM each new battle/trainer/biome. (The earlier implementation hung a
// Symbol on the Pokémon INSTANCE, which is never reconstructed between waves for
// the player's party, so Coward fired only once for the entire run.)
// =============================================================================

import { type AbAttrBaseParams, PostSummonAbAttr } from "#abilities/ab-attrs";
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { BattlerTagType } from "#enums/battler-tag-type";

export class CowardOnceProtectAbAttr extends PostSummonAbAttr implements GatedAttr<AbAttrBaseParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: AbAttrBaseParams) => boolean) | undefined;

  constructor() {
    super(true);
  }

  /** Tier B split (ability studio spec 3.1): the whole rule is the replaceable `gate`. */
  override canApply(params: AbAttrBaseParams): boolean {
    return gatedCanApply<AbAttrBaseParams>(this, params);
  }

  /** The replaceable condition: the one-time protection of this battle has not been used up yet. */
  public gate({ pokemon }: AbAttrBaseParams): boolean {
    return !pokemon.battleData.cowardProtectUsed;
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    pokemon.battleData.cowardProtectUsed = true;
    pokemon.addTag(BattlerTagType.PROTECTED, 1);
  }
}
