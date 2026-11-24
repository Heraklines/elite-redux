/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `copy-move-by-filter` archetype.
//
// Dancer-style "copy a move used by another battler", but gated on an
// arbitrary move filter (flag or move-id list) rather than the DANCE flag.
// Reuses PostDancingMoveAbAttr's copy `apply`; the PostMoveUsed trigger in
// move-phase.ts now fires for every move, so this hooks the same path.
//
// Wires:
//   - 545 Parroting — "Copies sound moves used by others." (flag SOUND_BASED)
//   - 711 Lunar Affinity — "Copies lunar moves used by others." (Moonlight,
//     Moonblast, Lunar Dance, Lunar Blessing)
// =============================================================================

import { PostDancingMoveAbAttr, type PostMoveUsedAbAttrParams } from "#abilities/ab-attrs";
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { BattlerTagType } from "#enums/battler-tag-type";
import type { MoveFlags } from "#enums/move-flags";
import type { MoveId } from "#enums/move-id";

const FORBIDDEN_TAGS = [
  BattlerTagType.FLYING,
  BattlerTagType.UNDERWATER,
  BattlerTagType.UNDERGROUND,
  BattlerTagType.HIDDEN,
];

export interface CopyMoveByFilterOptions {
  /** Copy moves carrying this flag (e.g. SOUND_BASED). */
  readonly flag?: MoveFlags;
  /** Copy moves carrying any one of these flags. */
  readonly anyFlags?: readonly MoveFlags[];
  /** Copy moves whose id is in this list. */
  readonly moveIds?: readonly MoveId[];
}

export class CopyMoveByFilterAbAttr extends PostDancingMoveAbAttr implements GatedAttr<PostMoveUsedAbAttrParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveUsedAbAttrParams) => boolean) | undefined;

  private readonly flag: MoveFlags | undefined;
  private readonly anyFlags: readonly MoveFlags[] | undefined;
  private readonly moveIds: readonly MoveId[] | undefined;

  constructor(options: CopyMoveByFilterOptions) {
    super();
    this.flag = options.flag;
    this.anyFlags = options.anyFlags;
    this.moveIds = options.moveIds;
  }

  /**
   * Tier B split (ability studio spec 3.1): `guards` (not my own move, not while semi-invulnerable), then the
   * replaceable `gate` (the move filter).
   */
  override canApply(params: PostMoveUsedAbAttrParams): boolean {
    return gatedCanApply<PostMoveUsedAbAttrParams>(this, params);
  }

  /** Safety rules that stay in the class, checked first, in the original order. */
  public guards({ source, pokemon }: PostMoveUsedAbAttrParams): boolean {
    // Cannot copy our own move; cannot copy while semi-invulnerable.
    if (source.getBattlerIndex() === pokemon.getBattlerIndex()) {
      return false;
    }
    if (pokemon.summonData.tags.some(tag => FORBIDDEN_TAGS.includes(tag.tagType))) {
      return false;
    }
    return true;
  }

  /**
   * The replaceable condition, in the original clause order: the move must have the flag, any one of the flags and be
   * one of the listed moves (every setting that is present). It reads the move's OWN flags (`hasFlag`), not the
   * user-aware flag check.
   */
  public gate({ move }: PostMoveUsedAbAttrParams): boolean {
    const m = move.getMove();
    if (this.flag !== undefined && !m.hasFlag(this.flag)) {
      return false;
    }
    if (this.anyFlags !== undefined && !this.anyFlags.some(flag => m.hasFlag(flag))) {
      return false;
    }
    if (this.moveIds !== undefined && !this.moveIds.includes(m.id)) {
      return false;
    }
    return true;
  }
}
