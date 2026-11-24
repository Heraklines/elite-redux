/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — bespoke ability `Tangled Seed`.
//
// "When the holder successfully applies Leech Seed, the seeded target cannot
// VOLUNTARILY switch until the end of the FOLLOWING turn (forced switches like
// Roar still work)." Implemented as a marker AbAttr checked inside
// `SeedTag.onAdd`: when the seeder carries Tangled Seed, the seeded target gains
// a {@linkcode BattlerTagType.TRAPPED} tag for 2 turns (it is applied mid-turn,
// survives that turn's end, and expires at the end of the following turn).
// TRAPPED blocks the voluntary switch command via `Pokemon.isTrapped` but does
// not stop forced switches (Roar / Whirlwind / Dragon Tail).
// =============================================================================

import { AbAttr } from "#abilities/ab-attrs";
import type { AbAttrBaseParams } from "#types/ability-types";

/** Hand-authored ER-custom ability id (both the ER-source id and the pokerogue id). */
export const ER_TANGLED_SEED_ABILITY_ID = 5903;

/** Number of turns the seeded target is prevented from voluntarily switching. */
export const TANGLED_SEED_TRAP_TURNS = 2;

/** Marker attribute; the effect is applied from {@linkcode SeedTag.onAdd}, which reads the number of turns from the seeder's live attr. */
export class TangledSeedAbAttr extends AbAttr {
  /** Turns the seeded target cannot voluntarily switch (ability studio param; the default is the original 2). */
  public readonly trapTurns: number;

  constructor(trapTurns: number = TANGLED_SEED_TRAP_TURNS) {
    super(false);
    this.trapTurns = trapTurns;
  }

  override apply(_params: AbAttrBaseParams): void {}
}
