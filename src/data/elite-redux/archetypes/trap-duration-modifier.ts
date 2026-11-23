/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `trap-duration-modifier` archetype.
//
// PostAttack hook that extends trapping-move duration AND boosts per-turn
// trap damage on the holder's outgoing trap moves (Bind, Wrap, Fire Spin,
// Whirlpool, Sand Tomb, Magma Storm, Infestation, Clamp).
//
// Wires:
//   - 523 Grappler — "Trapping moves last 6 turns. Trapping deals 1/6 HP."
//
// The trap mechanic in pokerogue is implemented via the TRAPPED/IS_TRAPPED
// BattlerTag attached to the victim on move hit. To override duration and
// damage, we hook PostAttack to RE-ADD the tag with our parameters,
// replacing the default-7-turn / 1/8 damage configuration with our
// 6-turn / 1/6 HP variant.
// =============================================================================

import { PostAttackAbAttr } from "#abilities/ab-attrs";
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";

const TRAPPING_MOVES = new Set<MoveId>([
  MoveId.BIND,
  MoveId.WRAP,
  MoveId.FIRE_SPIN,
  MoveId.WHIRLPOOL,
  MoveId.SAND_TOMB,
  MoveId.MAGMA_STORM,
  MoveId.INFESTATION,
  MoveId.CLAMP,
  MoveId.THUNDER_CAGE,
  MoveId.SNAP_TRAP,
]);

export interface TrapDurationModifierOptions {
  /** Override trap duration in turns. */
  readonly turns: number;
  /** Override per-turn damage fraction (e.g. 1/6 = 0.1666). */
  readonly damageFraction: number;
  /** Optional subset of trapping moves affected. Defaults to every trapping move. */
  readonly moveIds?: readonly MoveId[];
}

export class TrapDurationModifierAbAttr extends PostAttackAbAttr implements GatedAttr<PostMoveInteractionAbAttrParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  private readonly opts: TrapDurationModifierOptions;

  constructor(opts: TrapDurationModifierOptions) {
    super(undefined, false);
    // An absent subset stays absent (no `moveIds` key at all), however the options object was built, so a rebuilt instance
    // is identical to the original one.
    this.opts = opts.moveIds === undefined ? { turns: opts.turns, damageFraction: opts.damageFraction } : opts;
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  /** Tier B (ability studio spec 3.1), first clause of the old `canApply`: the target is still there and standing. */
  public guards({ opponent }: PostMoveInteractionAbAttrParams): boolean {
    return !(!opponent || opponent.isFainted());
  }

  /** The replaceable condition (second clause): the move is a trapping move (and one of the configured moves, when a subset is set). */
  public gate({ move }: PostMoveInteractionAbAttrParams): boolean {
    return TRAPPING_MOVES.has(move.id) && (this.opts.moveIds === undefined || this.opts.moveIds.includes(move.id));
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    const { opponent, pokemon, simulated } = params;
    if (simulated || !opponent) {
      return;
    }
    // Remove the default trap tag pokerogue installed and re-install with
    // our parameters. The cumulative-damage tag is typed `WRAP` family.
    opponent.removeTag(BattlerTagType.WRAP);
    opponent.removeTag(BattlerTagType.WHIRLPOOL);
    opponent.removeTag(BattlerTagType.BIND);
    opponent.removeTag(BattlerTagType.FIRE_SPIN);
    opponent.removeTag(BattlerTagType.SAND_TOMB);
    opponent.removeTag(BattlerTagType.MAGMA_STORM);
    opponent.removeTag(BattlerTagType.INFESTATION);
    opponent.removeTag(BattlerTagType.CLAMP);
    opponent.removeTag(BattlerTagType.THUNDER_CAGE);
    opponent.removeTag(BattlerTagType.SNAP_TRAP);
    opponent.addTag(BattlerTagType.WRAP, this.opts.turns, undefined, pokemon.id);
    // #454: actually apply the boosted per-turn damage. The WRAP tag's lapse
    // normally deals maxHp/8; set the denominator override so Grappler's trap
    // deals maxHp/6 (damageFraction 1/6 -> denominator 6) as the dex states.
    const tag = opponent.getTag(BattlerTagType.WRAP);
    if (tag && this.opts.damageFraction > 0) {
      (tag as { damageDenominatorOverride?: number }).damageDenominatorOverride = Math.round(
        1 / this.opts.damageFraction,
      );
    }
  }
}
