/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase D bespoke: "reduce attacker's PP when hit" cluster.
//
// Models ER's "Spiteful" pattern — when this Pokemon is hit by a contact move,
// the attacker's used move loses PP. The trigger surface is
// `PostDefendAbAttr`, the same one Static / Effect Spore use; the proc is the
// PP-reduction action rather than a status proc.
//
// Why a new AbAttr instead of composing existing primitives?
//   - Pokerogue's existing post-defend family handles status (`PostDefend-
//     ContactApplyStatusEffectAbAttr`), tags (`PostDefendContactApplyTag-
//     ChanceAbAttr`), damage (`PostDefendContactDamageAbAttr`) — but not PP
//     loss. The closest reference is the `MovePpReduceAttr` (a move-effect
//     attr used by Spite the move), which directly calls `usePp(count)`.
//   - We replicate that primitive on the post-defend surface here. Reusing
//     the underlying `usePp` call keeps PP-reduction semantics consistent
//     between the move and the ability.
//
// Sub-shape variants currently in scope:
//   - 518 Spiteful — `{ reduction: 4, contactRequired: true }`. ER text:
//     "Reduces attacker's PP on contact". Reduction of 4 matches the move
//     Spite's reduction (vanilla pokerogue), keeping the proc symmetric.
// =============================================================================

import { PostDefendAbAttr, type PostMoveInteractionAbAttrParams } from "#abilities/ab-attrs";
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { HitResult } from "#enums/hit-result";
import { MoveFlags } from "#enums/move-flags";

/** Construction options for {@linkcode PpReductionOnContactAbAttr}. */
export interface PpReductionOnContactOptions {
  /**
   * How many PP points to remove from the attacker's used move when the
   * proc fires. Must be a positive integer. Vanilla Spite (the move) uses
   * `4`; ER's Spiteful (the ability) matches.
   */
  readonly reduction: number;
  /**
   * When true, the proc only fires on contact moves. Defaults to true —
   * every ER ability in this cluster has the "on contact" qualifier.
   * @defaultValue `true`
   */
  readonly contactRequired?: boolean;
  /**
   * Restores the PP actually removed to one random depleted move belonging to
   * the holder. This models Spiteful's PP theft rather than plain PP deletion.
   */
  readonly refundHolder?: boolean;
}

/**
 * Parameterized `AbAttr` reducing the attacker's used move's PP by N when
 * this Pokemon takes a damaging hit. Models ER's `Spiteful` pattern.
 *
 * @remarks
 * Extends {@linkcode PostDefendAbAttr}. The proc looks up the used move on
 * the attacker's moveset via `find(m => m.moveId === move.id)` (same lookup
 * pattern as Spite the move in `src/data/moves/move.ts`) and calls `usePp`.
 * If the lookup fails (attacker's move was a free move / locked via Z-move /
 * etc.), the proc is a silent no-op.
 *
 * Honors hit-result gating: only fires when the move actually connected
 * (`hitResult < NO_EFFECT`). Status moves that target this Pokemon don't
 * trigger because pokerogue's post-defend dispatch is gated on damaging-move
 * resolution.
 */
export class PpReductionOnContactAbAttr
  extends PostDefendAbAttr
  implements GatedAttr<PostMoveInteractionAbAttrParams>
{
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  private readonly reduction: number;
  private readonly contactRequired: boolean;
  private readonly refundHolder: boolean;

  constructor(opts: PpReductionOnContactOptions) {
    if (!Number.isInteger(opts.reduction) || opts.reduction <= 0) {
      throw new Error(`[PpReductionOnContactAbAttr] reduction must be a positive integer; got ${opts.reduction}`);
    }
    super();
    this.reduction = opts.reduction;
    this.contactRequired = opts.contactRequired ?? true;
    this.refundHolder = opts.refundHolder ?? false;
  }

  /** Read-only accessor: how many PP points the proc deducts. */
  public getReduction(): number {
    return this.reduction;
  }

  /** Read-only accessor: whether the proc requires contact. */
  public requiresContact(): boolean {
    return this.contactRequired;
  }

  /** Tier B (ability studio spec 3.1): `canApply = guards && gate && residual`, in the original clause order. */
  public override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  /** Safety rule: only a hit that actually connected counts (not a miss, a block or an immunity). */
  public guards({ hitResult }: PostMoveInteractionAbAttrParams): boolean {
    return hitResult < HitResult.NO_EFFECT;
  }

  /** The replaceable condition: the move makes contact (always true when contact is not required). */
  public gate({ move, opponent: attacker, pokemon }: PostMoveInteractionAbAttrParams): boolean {
    return (
      !this.contactRequired
      || move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: attacker, target: pokemon })
    );
  }

  /** Feasibility that stays in the class: the attacker's moveset has an entry for the used move id. */
  public residual({ move, opponent: attacker }: PostMoveInteractionAbAttrParams): boolean {
    return attacker.moveset.some(m => m.moveId === move.id);
  }

  public override apply(params: PostMoveInteractionAbAttrParams): void {
    if (params.simulated) {
      return;
    }
    const { move, opponent: attacker, pokemon } = params;
    const movesetMove = attacker.moveset.find(m => m.moveId === move.id);
    if (movesetMove === undefined) {
      return;
    }
    const ppBefore = movesetMove.ppUsed;
    movesetMove.usePp(this.reduction);
    const stolenPp = movesetMove.ppUsed - ppBefore;
    if (!this.refundHolder || stolenPp <= 0) {
      return;
    }
    const depletedMoves = pokemon.moveset.filter(holderMove => holderMove.ppUsed > 0);
    if (depletedMoves.length > 0) {
      const refundedMove = depletedMoves[pokemon.randBattleSeedInt(depletedMoves.length)];
      refundedMove.ppUsed = Math.max(0, refundedMove.ppUsed - stolenPp);
    }
  }
}
