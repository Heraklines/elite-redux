/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `type-immunity-highest-attack-stat-stage` archetype.
//
// PreDefend hook: hold an immunity to a configured type AND boost the
// holder's HIGHER of ATK / SPATK by the configured stages on absorb. This
// matches ER's text on Lightning Rod / Storm Drain / Sap Sipper: "ups
// highest Atk" — instead of vanilla's fixed SPATK-only boost.
//
// Pokerogue ships TypeImmunityStatStageChangeAbAttr with a fixed `stat`
// field; this primitive evaluates ATK vs SPATK at apply time using the
// holder's current battle stats (no stat-stage included — raw computed).
//
// Wires:
//   - 31 Lightning Rod (Electric → ATK or SPATK +1)
//   - 114 Storm Drain (Water → ATK or SPATK +1)
//   - 157 Sap Sipper (Grass → ATK or SPATK +1)
// =============================================================================

import { TypeImmunityAbAttr, type TypeMultiplierAbAttrParams } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import type { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";

export interface TypeImmunityHighestAttackStatStageOptions {
  readonly immuneType: PokemonType;
  readonly stages: number;
}

export class TypeImmunityHighestAttackStatStageAbAttr extends TypeImmunityAbAttr {
  private readonly stages: number;

  constructor(opts: TypeImmunityHighestAttackStatStageOptions) {
    super(opts.immuneType);
    this.stages = opts.stages;
  }

  override apply(params: TypeMultiplierAbAttrParams): void {
    const { cancelled, simulated, pokemon } = params;
    super.apply(params);
    cancelled.value = true;
    if (simulated) {
      return;
    }
    const atk = pokemon.getStat(Stat.ATK, false);
    const spatk = pokemon.getStat(Stat.SPATK, false);
    const targetStat = atk >= spatk ? Stat.ATK : Stat.SPATK;
    globalScene.phaseManager.unshiftNew(
      "StatStageChangePhase",
      pokemon.getBattlerIndex(),
      true,
      [targetStat],
      this.stages,
    );
  }
}
