/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `post-summon-scripted-move` archetype.
//
// On switch-in (PostSummon hook), enqueue a scripted move targeting an
// available opponent. Used by abilities like:
//   - 479 Dust Cloud — "Attacks with Sand Attack on switch-in."
//   - 521 Phantom Thief — "Attacks with 40BP Spectral Thief on switch-in."
//   - 717 Wildfire — "Attacks with Fire Spin on entry."
//   - 718 Jumpscare — "Attacks with Astonish on first switch-in."
//   - 745 Sand Pit — "Attacks with 20BP Sand Tomb on switch-in."
//
// The "first switch-in" qualifier (Jumpscare) is enforced via PostSummonAbAttr's
// natural lifecycle — PostSummon fires once per send-out.
// =============================================================================

import { PostSummonAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { scriptedPokemonMove } from "#data/elite-redux/archetypes/scripted-move-util";
import type { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import type { AbAttrBaseParams } from "#types/ability-types";

export interface PostSummonScriptedMoveOptions {
  /** Move to enqueue against an opponent on switch-in. */
  readonly moveId: MoveId;
  /**
   * Optional ER-specified base-power override (e.g. Phantom Thief's "40 BP
   * Spectral Thief"). Omit to use the move's registered full power.
   */
  readonly power?: number;
  /**
   * When `true`, the scripted move targets the HOLDER itself (and the on-entry
   * effect fires even with no opponent on the field). Required for self-side
   * buffs cast on entry — e.g. Air Blower's Tailwind — which would otherwise
   * never trigger when the holder is sent out first (no opponent yet).
   */
  readonly targetsSelf?: boolean;
  readonly oncePerBattleKey?: string;
  /**
   * When `true`, strip {@linkcode MoveFlags.REFLECTABLE} from the scripted cast
   * so a Magic Bounce / Magic Coat opponent does NOT bounce it back onto the
   * holder. The ability forced this move onto the opponent — it must not behave
   * like a holder-chosen reflectable move. Used by Telekinetic (on-entry
   * Telekinesis): without this, a Magic-Bounce target reflected the real
   * Telekinesis back, levitating + always-hit-flagging the holder instead.
   */
  readonly nonReflectable?: boolean;
}

export class PostSummonScriptedMoveAbAttr extends PostSummonAbAttr {
  constructor(private readonly opts: PostSummonScriptedMoveOptions) {
    super(false);
  }

  override canApply(params: AbAttrBaseParams): boolean {
    const { pokemon, simulated } = params;
    if (simulated) {
      return true;
    }
    if (
      this.opts.oncePerBattleKey !== undefined
      && pokemon.waveData.entryEffectsFired.has(this.opts.oncePerBattleKey)
    ) {
      return false;
    }
    // Self-targeting buffs (Tailwind) fire regardless of who's on the field.
    if (this.opts.targetsSelf) {
      return true;
    }
    // Offensive on-entry moves need an opposing target on the field.
    const opponents = pokemon.getOpponents().filter(o => !o.isFainted());
    return opponents.length > 0;
  }

  override apply(params: AbAttrBaseParams): void {
    const { pokemon, simulated } = params;
    if (simulated) {
      return;
    }
    let targetIndex: number;
    if (this.opts.targetsSelf) {
      // Self-side move (e.g. Tailwind) — cast at the holder so it always lands,
      // even when the holder is sent out before any opponent.
      targetIndex = pokemon.getBattlerIndex();
    } else {
      const opponents = pokemon.getOpponents().filter(o => !o.isFainted());
      if (opponents.length === 0) {
        return;
      }
      // Pick the first available opponent (in doubles, prefer the leftmost).
      targetIndex = opponents[0].getBattlerIndex();
    }
    if (this.opts.oncePerBattleKey !== undefined) {
      pokemon.waveData.entryEffectsFired.add(this.opts.oncePerBattleKey);
    }
    globalScene.phaseManager.unshiftNew(
      "MovePhase",
      pokemon,
      [targetIndex],
      scriptedPokemonMove(this.opts.moveId, this.opts.power, { nonReflectable: this.opts.nonReflectable ?? false }),
      MoveUseMode.INDIRECT,
    );
  }
}
