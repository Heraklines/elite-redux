/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `entry-trap-on-foe-side` archetype primitive.
//
// On the holder's switch-in (`PostSummonAbAttr` trigger), places a one-use ER
// entry trap ({@linkcode ArenaTagType.ER_INFESTATION_TRAP}) on the opposing side
// (computed from the holder's side, so it works for player and enemy holders).
// The trap catches the NEXT grounded opposing switch-in, applying the configured
// {@linkcode BattlerTagType} to it, then is spent (Hot Coals 704 entry-hazard
// pattern; see `entry-arena-tag-on-foe-side.ts`).
//
// Parameterized by the applied effect so it is reusable across the many ER mons
// that will want an entry trap: the `appliedTag` is written onto the placed
// {@linkcode ErEntryTrapTag} (a serialized field), so different mons trap with
// different battler tags through this one primitive.
//
// Wires:
//   - Spore Bed — traps the next grounded foe with `INFESTATION`.
// =============================================================================

import { PostSummonAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { ErEntryTrapTag } from "#data/arena-tag";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import type { AbAttrBaseParams } from "#types/ability-types";

export class EntryTrapOnFoeSideAbAttr extends PostSummonAbAttr {
  private readonly appliedTag: BattlerTagType;
  private readonly side: "foe" | "self";

  constructor(appliedTag: BattlerTagType = BattlerTagType.INFESTATION, side: "foe" | "self" = "foe") {
    super(true);
    this.appliedTag = appliedTag;
    this.side = side;
  }

  override canApply(_params: AbAttrBaseParams): boolean {
    return true;
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    const ownSide = pokemon.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
    const foeSide = pokemon.isPlayer() ? ArenaTagSide.ENEMY : ArenaTagSide.PLAYER;
    const targetSide = this.side === "self" ? ownSide : foeSide;
    // turnCount 0 → the trap persists until it catches a switch-in (then it is spent).
    globalScene.arena.addTag(ArenaTagType.ER_INFESTATION_TRAP, 0, undefined, pokemon.id, targetSide);
    const tag = globalScene.arena.getTagOnSide(ArenaTagType.ER_INFESTATION_TRAP, targetSide);
    if (tag instanceof ErEntryTrapTag) {
      tag.configure(this.appliedTag);
    }
  }
}
