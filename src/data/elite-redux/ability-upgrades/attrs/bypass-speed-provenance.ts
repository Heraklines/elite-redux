/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { type AbAttrBaseParams, BypassSpeedChanceAbAttr } from "#abilities/ab-attrs";
import { claimCommandAbilityProvenance } from "./innate-slot-suppression";

export class ProvenanceBypassSpeedChanceAbAttr extends BypassSpeedChanceAbAttr {
  constructor(
    chance: number,
    private readonly provenanceKey: string,
  ) {
    super(chance);
  }

  override apply(params: AbAttrBaseParams): void {
    super.apply(params);
    claimCommandAbilityProvenance(params.pokemon, this.provenanceKey);
  }
}
