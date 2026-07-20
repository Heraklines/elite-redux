/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `post-attack-scripted-move` archetype.
//
// PostAttack hook: after the holder uses a qualifying move, enqueue a
// scripted follow-up move (in MoveUseMode.INDIRECT). Mirrors the existing
// CounterAttackOnHitAbAttr (which fires on DEFEND) but on the offensive
// surface — i.e. "after the holder ATTACKS, also do X".
//
// Wires:
//   - 491 Aftershock — "Triggers Magnitude after using a damaging move"
//   - 876 Sludge Spit — "follows up with 35BP Venom Bolt after using an attack"
//   - 993 Thunder Clouds — "After using a special move, launch 35BP Thunderbolt"
//   - 999 Sand Spear (and similar) when they need offensive follow-ups
//
// Optional category filter so abilities like Thunder Clouds (which trigger
// only on SPECIAL moves) can gate themselves.
// =============================================================================

import { PostAttackAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { canTriggerFollowUpMove } from "#data/elite-redux/ability-upgrades/attrs/follow-up-guard";
import { scriptedPokemonMove } from "#data/elite-redux/archetypes/scripted-move-util";
import type { MoveCategory } from "#enums/move-category";
import type { MoveFlags } from "#enums/move-flags";
import type { MoveId } from "#enums/move-id";
import { MovePhaseTimingModifier } from "#enums/move-phase-timing-modifier";
import { MoveUseMode } from "#enums/move-use-mode";
import type { PokemonType } from "#enums/pokemon-type";
import { getMoveTargets } from "#moves/move-utils";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";

export interface PostAttackScriptedMoveOptions {
  /** Move id to enqueue after the holder's attack lands. */
  readonly moveId: MoveId;
  /**
   * Optional ER-specified base-power override for the scripted move (e.g. Frost
   * Burn's "40 BP Ice Beam"). Omit to use the move's registered full power.
   */
  readonly power?: number;
  /** Optional gate — only fire when the holder's move matches this category. */
  readonly categoryFilter?: MoveCategory;
  /**
   * Optional gate — only fire when the holder's move is one of these types.
   * E.g. `[PokemonType.FIRE]` for Volcano Rage's "after Fire-type move" trigger.
   */
  readonly typeFilter?: readonly PokemonType[];
  /**
   * Optional gate — only fire when the holder's move has this flag set
   * (e.g. `MoveFlags.DANCE_MOVE` for "after dance move" triggers).
   */
  readonly flagFilter?: MoveFlags;
  readonly magnitudeRange?: readonly [min: number, max: number];
  /**
   * When set, replace the scripted move's hardcoded-150 HpPowerAttr (Eruption)
   * with an HP-ratio scaling from this base. Used by Volcano Rage's "50 BP
   * Eruption follow-up that scales with the user's HP".
   */
  readonly hpScaledBasePower?: number;
  /** Optional exact allowlist for moves that may trigger the follow-up. */
  readonly triggerMoveIds?: readonly MoveId[];
  /** Require the target to have lost at least one stat stage this turn. */
  readonly targetStatsDecreased?: boolean;
  /** Permit one specific virtual move to trigger this follow-up. */
  readonly allowVirtualTriggerMoveId?: MoveId;
}

export class PostAttackScriptedMoveAbAttr extends PostAttackAbAttr {
  constructor(private readonly opts: PostAttackScriptedMoveOptions) {
    super(undefined, false);
  }

  /** Read-only accessor: the scripted follow-up move id (used in tests). */
  public getMoveId(): MoveId {
    return this.opts.moveId;
  }

  /** Read-only accessor: the scripted follow-up power override, or `undefined`. */
  public getPower(): number | undefined {
    return this.opts.power;
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { pokemon, move, opponent } = params;
    if (!opponent) {
      return false;
    }
    // The TRIGGERING target may have just FAINTED from the move that landed (e.g.
    // a High Tide holder KOs one foe with a single-target Water move). That must
    // NOT suppress the follow-up — a spread follow-up (Surf/Blizzard) still has to
    // hit the rest of the field. Bail only when the holder has NO living foe left
    // for the follow-up to hit. (Reported: "High Tide doesn't activate" — the lone
    // weak foe was one-shot, so the old `opponent.isFainted()` bail killed the Surf.)
    if (pokemon.getOpponents().every(o => o.isFainted())) {
      return false;
    }
    // Re-entry guard: the scripted follow-up is itself a damaging move, so when
    // IT lands it would re-trigger this PostAttack hook and enqueue another copy
    // — an infinite loop (reported as Aftershock firing continuously). The
    // follow-up is always cast in MoveUseMode.INDIRECT (a *virtual* use), while a
    // genuine move the holder selects is NORMAL. So we gate on the use mode of
    // the move that just landed rather than its id: this still blocks the loop
    // (the INDIRECT cast never re-arms) but no longer mis-fires when the holder
    // legitimately uses the SAME move that the ability scripts. That mis-fire was
    // the reported "Thundercall doesn't trigger from Thunder Shock" bug —
    // Thundercall's scripted follow-up IS Thunder Shock, so a real Thunder Shock
    // hit the `move.id === moveId` guard and was silently swallowed.
    //
    // Move history is pushed in MoveEffectPhase.postAnimCallback() BEFORE the
    // PostAttack hooks run (move-effect-phase.ts), so getLastXMoves(1)[0] is the
    // move that is currently resolving — including for the non-first hits of a
    // multi-hit move (which reuse the entry pushed on the first hit).
    // Multi-hit guard: the PostAttack hook fires once per HIT, so a multi-hit
    // trigger move (e.g. a 2-5 strike Water move for High Tide) would enqueue the
    // scripted follow-up on every strike — the reported runaway "fires ~50x"
    // stack. Fire only on the final hit (hitsLeft === 1) so the follow-up
    // triggers once per move use, mirroring the once-per-multihit `hitsLeft > 1`
    // guard used across ab-attrs.
    if (!canTriggerFollowUpMove(pokemon) && move.id !== this.opts.allowVirtualTriggerMoveId) {
      return false;
    }
    if (this.opts.triggerMoveIds !== undefined && !this.opts.triggerMoveIds.includes(move.id)) {
      return false;
    }
    if (this.opts.targetStatsDecreased && !opponent.turnData.statStagesDecreased) {
      return false;
    }
    if (this.opts.categoryFilter !== undefined && move.category !== this.opts.categoryFilter) {
      return false;
    }
    if (this.opts.typeFilter !== undefined && !this.opts.typeFilter.includes(move.type)) {
      return false;
    }
    if (this.opts.flagFilter !== undefined && !move.hasFlag(this.opts.flagFilter)) {
      return false;
    }
    return true;
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    const { pokemon, simulated } = params;
    let { opponent } = params;
    if (simulated || !opponent) {
      return;
    }
    // #413: STATUS dances (Quiver/Victory Dance) target the USER, so the
    // hook's `opponent` is the dancer itself - the scripted follow-up
    // (Two Step's Revelation Dance, Blade Dance's Leaf Blade, ...) then
    // SELF-HIT. Aim the follow-up at a real opponent instead.
    if (opponent === pokemon || opponent.isPlayer() === pokemon.isPlayer() || opponent.isFainted()) {
      const foes = pokemon.getOpponents().filter(o => !o.isFainted());
      if (foes.length === 0) {
        return;
      }
      opponent = foes[0];
    }
    // MovePhase is a *dynamic* phase: a plain `unshiftNew("MovePhase", ...)` is
    // routed into the speed-sorted MovePhasePriorityQueue (placed after the next
    // MoveEndPhase), so the scripted follow-up would resolve in turn speed-order
    // rather than right after the holder's attack (reported on Purple Haze).
    // `MovePhaseTimingModifier.FIRST` forces it ahead of any remaining queued
    // moves — i.e. it resolves immediately after the triggering attack, exactly
    // how vanilla Dancer chains its replicated move.
    // Spread follow-ups (High Tide's Surf, Glacial Rage's Blizzard) must hit
    // EVERY valid target, not just the one foe the trigger interacted with.
    // Resolve the scripted move's real target set from its MoveTarget; for
    // single-target follow-ups (Leaf Blade, Revelation Dance, ...) keep the
    // guarded `opponent` so self-targeting status dances still aim at a real foe.
    const { targets: spreadTargets, multiple } = getMoveTargets(pokemon, this.opts.moveId);
    const followUpTargets = multiple && spreadTargets.length > 0 ? spreadTargets : [opponent.getBattlerIndex()];
    globalScene.phaseManager.unshiftNew(
      "MovePhase",
      pokemon,
      followUpTargets,
      scriptedPokemonMove(this.opts.moveId, this.opts.power, {
        ...(this.opts.magnitudeRange === undefined ? {} : { magnitudeRange: this.opts.magnitudeRange }),
        ...(this.opts.hpScaledBasePower === undefined ? {} : { hpScaledBasePower: this.opts.hpScaledBasePower }),
      }),
      MoveUseMode.INDIRECT,
      MovePhaseTimingModifier.FIRST,
    );
  }
}
