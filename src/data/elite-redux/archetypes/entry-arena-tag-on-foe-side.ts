/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `entry-arena-tag-on-foe-side` archetype.
//
// On switch-in, drops a configured ArenaTag on the holder's OPPONENTS' side of
// the field (computed from the holder's side, so it works for player and enemy
// holders alike). Used for "pledge field"-style entry abilities whose effect
// punishes the foes' side.
//
// Wires:
//   - 877 Swamp Thing — "Sets the Swamp Pledge effect on entry." (Grass+Water
//     pledge swamp: quarters Speed of Pokemon on the affected side.)
//   - 893 Deep Fried — "Summons a sea of fire on entry." (Fire+Grass pledge:
//     damages non-Fire Pokemon on the affected side each turn.)
// =============================================================================

import { PostSummonAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { ArenaTagSide } from "#enums/arena-tag-side";
import type { ArenaTagType } from "#enums/arena-tag-type";
import type { AbAttrBaseParams } from "#types/ability-types";

export class EntryArenaTagOnFoeSideAbAttr extends PostSummonAbAttr {
  private readonly tag: ArenaTagType;
  private readonly turns: number;

  constructor(tag: ArenaTagType, turns = 4) {
    super(true);
    this.tag = tag;
    this.turns = turns;
  }

  override canApply(_params: AbAttrBaseParams): boolean {
    return true;
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    const foeSide = pokemon.isPlayer() ? ArenaTagSide.ENEMY : ArenaTagSide.PLAYER;
    globalScene.arena.addTag(this.tag, this.turns, undefined, pokemon.id, foeSide);
  }
}
