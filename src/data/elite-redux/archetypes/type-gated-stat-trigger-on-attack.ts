/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `type-gated-stat-trigger-on-attack` archetype.
//
// PostAttack hook: when the holder uses an attack of the configured type,
// apply stat-stage changes to the holder AND optionally clear entry
// hazards on the holder's side.
//
// Wires:
//   - 406 Spinning Top — "Fighting moves up speed +1 and clear hazards."
//     (type: FIGHTING, stat: +SPD, clearHazards: true.)
// =============================================================================

import { PostAttackAbAttr } from "#abilities/ab-attrs";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";
import { globalScene } from "#app/global-scene";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import type { BattleStat } from "#enums/stat";
import type { PokemonType } from "#enums/pokemon-type";

export interface TypeGatedStatTriggerOnAttackOptions {
  readonly type: PokemonType;
  readonly stats: ReadonlyArray<{ stat: BattleStat; stages: number }>;
  readonly clearHazards?: boolean;
}

const HAZARD_TAGS: readonly ArenaTagType[] = [
  ArenaTagType.SPIKES,
  ArenaTagType.TOXIC_SPIKES,
  ArenaTagType.STEALTH_ROCK,
  ArenaTagType.STICKY_WEB,
];

export class TypeGatedStatTriggerOnAttackAbAttr extends PostAttackAbAttr {
  constructor(private readonly opts: TypeGatedStatTriggerOnAttackOptions) {
    super(undefined, false);
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { move, pokemon } = params;
    return pokemon.getMoveType(move) === this.opts.type;
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    const { pokemon, simulated } = params;
    if (simulated) {
      return;
    }
    for (const change of this.opts.stats) {
      globalScene.phaseManager.unshiftNew(
        "StatStageChangePhase",
        pokemon.getBattlerIndex(),
        true,
        [change.stat],
        change.stages,
      );
    }
    if (this.opts.clearHazards) {
      const side = pokemon.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
      for (const tagType of HAZARD_TAGS) {
        globalScene.arena.removeTagOnSide(tagType, side);
      }
    }
  }
}
