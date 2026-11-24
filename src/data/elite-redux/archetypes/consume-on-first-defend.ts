/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `consume-on-first-defend` archetype.
//
// A one-shot defensive primitive: the FIRST damaging hit the holder takes this
// battle is halved AND the attacker's Attack drops one stage, then the ability
// is spent for the rest of the encounter (no reduction, no further drop). The
// spent flag is the plain key {@linkcode FIRST_DEFEND_SPENT_KEY} in
// `pokemon.waveData.entryEffectsFired` (the per-wave memory every ER once-per-wave rule uses, which the
// ability studio atoms time.once-per and time.once-per-unused read and write), so it resets per-battle
// (per-wave) and is per-mon (doubles / both sides safe) — no battler tag is introduced.
//
// Two cooperating attrs share that flag. On the first damaging hit both see the
// flag un-set (PreDefend runs before PostDefend within the same strike), so:
//   - the PreDefend reduction halves that strike, and
//   - the PostDefend attr drops the attacker's Attack and SETS the flag.
// Every later strike/move sees the flag set and does nothing.
//
// Wires:
//   - 932 Drakelp Head — "Weakens the first move taken and drops that attacker's
//     Attack."
// =============================================================================

import { PostDefendStatStageChangeAbAttr, ReceivedMoveDamageMultiplierAbAttr } from "#abilities/ab-attrs";
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { MoveCategory } from "#enums/move-category";
import { type BattleStat, Stat } from "#enums/stat";
import type { PostMoveInteractionAbAttrParams, PreDefendModifyDamageAbAttrParams } from "#types/ability-types";

/**
 * The memory key of the one-shot in `waveData.entryEffectsFired`. Both halves of Drakelp Head share it: the damage half only
 * reads it, the Attack-drop half reads it and sets it after the first damaging hit. (It used to be a plain field
 * `waveData.firstDefendConsumed` with the same lifetime; moving it into the shared set lets the library read the same memory.)
 */
export const FIRST_DEFEND_SPENT_KEY = "firstDefendConsumed";

/** Multiplies the FIRST damaging hit taken this battle (x0.5 for Drakelp Head) while the one-shot is unspent. */
export class FirstDefendDamageReductionAbAttr
  extends ReceivedMoveDamageMultiplierAbAttr
  implements GatedAttr<PreDefendModifyDamageAbAttrParams>
{
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PreDefendModifyDamageAbAttrParams) => boolean) | undefined;

  /** @param multiplier - what the damage of the first hit is multiplied by (0.5 = half, the value Drakelp Head uses). */
  constructor(multiplier = 0.5) {
    super((_target, _user, move) => move.category !== MoveCategory.STATUS, multiplier);
  }

  /** Tier B split (ability studio spec 3.1): the whole condition is the replaceable `gate`; nothing hides in a residual. */
  override canApply(params: PreDefendModifyDamageAbAttrParams): boolean {
    return gatedCanApply<PreDefendModifyDamageAbAttrParams>(this, params);
  }

  /** The replaceable condition, in the original order: the parent's closure (the move deals damage), then the one-shot is unspent. */
  public gate(params: PreDefendModifyDamageAbAttrParams): boolean {
    return super.canApply(params) && !params.pokemon.waveData.entryEffectsFired.has(FIRST_DEFEND_SPENT_KEY);
  }
}

/**
 * On the FIRST damaging hit taken this battle, drops the attacker's Attack by one
 * stage and marks the one-shot spent. Extends the vanilla on-hit stat-drop attr
 * (attacker-targeted) and layers the once-per-battle gate + consume on top.
 */
export class FirstDefendAttackerAtkDropAbAttr
  extends PostDefendStatStageChangeAbAttr
  implements GatedAttr<PostMoveInteractionAbAttrParams>
{
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  /**
   * @param stat - the stat that changes (Attack for Drakelp Head).
   * @param stages - how many stages it changes by (-1 for Drakelp Head).
   * @param selfTarget - true = the holder itself, false = the attacker (what Drakelp Head does).
   */
  constructor(stat: BattleStat = Stat.ATK, stages = -1, selfTarget = false) {
    super((_target, _user, move) => move.category !== MoveCategory.STATUS, stat, stages, selfTarget);
  }

  /** Tier B split (ability studio spec 3.1): the whole condition is the replaceable `gate`; nothing hides in a residual. */
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  /** The replaceable condition, in the original order: the parent's closure (the move deals damage), then the one-shot is unspent. */
  public gate(params: PostMoveInteractionAbAttrParams): boolean {
    return super.canApply(params) && !params.pokemon.waveData.entryEffectsFired.has(FIRST_DEFEND_SPENT_KEY);
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    super.apply(params);
    if (!params.simulated) {
      params.pokemon.waveData.entryEffectsFired.add(FIRST_DEFEND_SPENT_KEY);
    }
  }
}
