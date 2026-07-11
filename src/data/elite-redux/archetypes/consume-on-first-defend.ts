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
// spent flag lives on `pokemon.waveData.firstDefendConsumed`, so it resets
// per-battle (per-wave) and is per-mon (doubles / both sides safe) — no battler
// tag is introduced.
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
import { MoveCategory } from "#enums/move-category";
import { Stat } from "#enums/stat";
import type { PostMoveInteractionAbAttrParams, PreDefendModifyDamageAbAttrParams } from "#types/ability-types";

/** Halves the FIRST damaging hit taken this battle (while the one-shot is unspent). */
export class FirstDefendDamageReductionAbAttr extends ReceivedMoveDamageMultiplierAbAttr {
  constructor() {
    super((_target, _user, move) => move.category !== MoveCategory.STATUS, 0.5);
  }

  override canApply(params: PreDefendModifyDamageAbAttrParams): boolean {
    return super.canApply(params) && !params.pokemon.waveData.firstDefendConsumed;
  }
}

/**
 * On the FIRST damaging hit taken this battle, drops the attacker's Attack by one
 * stage and marks the one-shot spent. Extends the vanilla on-hit stat-drop attr
 * (attacker-targeted) and layers the once-per-battle gate + consume on top.
 */
export class FirstDefendAttackerAtkDropAbAttr extends PostDefendStatStageChangeAbAttr {
  constructor() {
    // selfTarget=false -> the drop lands on the attacker.
    super((_target, _user, move) => move.category !== MoveCategory.STATUS, Stat.ATK, -1, false);
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return super.canApply(params) && !params.pokemon.waveData.firstDefendConsumed;
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    super.apply(params);
    if (!params.simulated) {
      params.pokemon.waveData.firstDefendConsumed = true;
    }
  }
}
