/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `post-item-lost-scripted-move` archetype.
//
// Extends pokerogue's PostItemLostAbAttr (Cud Chew family) to enqueue a
// configured move via MovePhase in INDIRECT mode when the holder loses
// an item.
//
// Wires:
//   - 911 Greedy — "Uses Thief when it loses an item." (MoveId.THIEF)
// =============================================================================

import { PostItemLostAbAttr } from "#abilities/ab-attrs";
import type { AbAttrBaseParams } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { PokemonMove } from "#data/moves/pokemon-move";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";

export interface PostItemLostScriptedMoveOptions {
  readonly moveId: MoveId;
}

export class PostItemLostScriptedMoveAbAttr extends PostItemLostAbAttr {
  constructor(private readonly opts: PostItemLostScriptedMoveOptions) {
    super(false);
  }

  override canApply(_params: AbAttrBaseParams): boolean {
    return true;
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    const opponents = pokemon.getOpponents().filter(o => o && !o.isFainted());
    const target = opponents[0]?.getBattlerIndex();
    if (target === undefined) {
      return;
    }
    globalScene.phaseManager.unshiftNew(
      "MovePhase",
      pokemon,
      [target],
      new PokemonMove(this.opts.moveId),
      MoveUseMode.INDIRECT,
    );
  }
}
