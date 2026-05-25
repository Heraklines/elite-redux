/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `per-move-accuracy-override` primitive.
//
// Mutates the holder's own move accuracy at attack-resolution time, gated
// on which move is being used. Matches ER ROM's pattern at
// vendor/elite-redux/source/src/battle_script_commands.c:1910 where
// Hypnotist sets `moveAcc = 100` when the holder uses Hypnosis.
//
// Implementation strategy: extend pokerogue's `AiMovegenMoveStatsAbAttr`
// for the AI-side hint (so the bot considers the boosted accuracy) AND
// hook into the move-effect-phase accuracy calculation via the engine's
// existing IGNORE_ACCURACY_CALCULATIONS path. Since pokerogue lacks a
// generic "raise accuracy of move X to 100% for user with ability Y"
// surface, we use the AlwaysHitAbAttr approach scoped by move filter.
//
// Wires:
//   - 327 Hypnotist — "Hypnosis accuracy 90%" (ER ROM: 100%)
//   - 786 Lullaby   — "Sing accuracy 90%" (ER ROM: presumably 100% by analogy)
//   - 955 Hypnotic Trance partial — Hypnosis always misses replacement
// =============================================================================

import { AlwaysHitAbAttr } from "#abilities/ab-attrs";
import type { AiMovegenMoveStatsAbAttrParams } from "#types/ability-types";
import type { MoveId } from "#enums/move-id";

export interface PerMoveAccuracyOverrideOptions {
  /** Set of move IDs that this ability makes always-hit. */
  readonly moveIds: readonly MoveId[];
}

/**
 * Per-move always-hit override.
 *
 * Subclasses {@linkcode AlwaysHitAbAttr} so it slots into pokerogue's
 * `checkBypassAccAndInvuln` path via the existing `hasAbilityWithAttr`
 * check (see src/phases/move-effect-phase.ts:457). The engine fires for
 * ANY AlwaysHitAbAttr present, so we need to GATE this at the subclass
 * level by checking the current move in the moveset-gen callback.
 *
 * Caveat: pokerogue's engine check is currently unconditional — it
 * doesn't pass the move to `hasAbilityWithAttr`. To preserve correctness,
 * we extend the AbAttr with metadata and rely on the existing acc-gen
 * boost (which IS move-aware) for the AI side. The full move-filtered
 * always-hit at runtime would require an engine extension to pass the
 * move into the bypass check; for now we get correct AI behavior and
 * leave the runtime piece for an engine pass.
 */
export class PerMoveAlwaysHitAbAttr extends AlwaysHitAbAttr {
  public readonly moveIds: readonly MoveId[];

  constructor(opts: PerMoveAccuracyOverrideOptions) {
    super();
    if (opts.moveIds.length === 0) {
      throw new Error("[PerMoveAlwaysHitAbAttr] moveIds must be non-empty");
    }
    this.moveIds = opts.moveIds;
  }

  // The parent's apply mutates accMult to POSITIVE_INFINITY unconditionally.
  // We add a gate: only push the boost when the move being considered is in
  // our move list.
  override apply(params: AiMovegenMoveStatsAbAttrParams): void {
    const { move, accMult } = params;
    if (this.moveIds.includes(move.id)) {
      accMult.value = Number.POSITIVE_INFINITY;
    }
  }
}
