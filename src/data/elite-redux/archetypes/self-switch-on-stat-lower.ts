/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `self-switch-on-stat-lower` archetype.
//
// When any of the holder's stats is lowered (including self-inflicted drops),
// the holder switches out. Triggers once per battle. Reuses the vanilla
// ForceSwitchOutHelper (Eject-Button-style switch).
//
// Wires:
//   - 564 Tactical Retreat — "Flees when stats are lowered." (once per battle)
// =============================================================================

import { ForceSwitchOutHelper, PostStatStageChangeAbAttr } from "#abilities/ab-attrs";
import { SwitchType } from "#enums/switch-type";
import type { PostStatStageChangeAbAttrParams } from "#types/ability-types";

/**
 * Once-per-BATTLE marker key. Stored in the holder's per-wave data
 * ({@linkcode PokemonWaveData.entryEffectsFired}) — which is a fresh object each
 * wave/battle (`resetWaveData` on every EncounterPhase) — so the "already fled"
 * flag auto-resets between battles. A previous impl kept the flag on the Pokemon
 * object itself; because party members persist across waves in this engine, that
 * flag was never cleared and the ability fired only once per RUN instead of once
 * per battle.
 */
const USED_KEY = "erTacticalRetreat.used";

export class SelfSwitchOnStatLowerAbAttr extends PostStatStageChangeAbAttr {
  private readonly helper = new ForceSwitchOutHelper(SwitchType.SWITCH);

  override canApply(params: PostStatStageChangeAbAttrParams): boolean {
    const { pokemon, stages } = params;
    // Any stat LOWERED (incl. self-drops, per the ROM). Once per battle.
    if (pokemon.waveData.entryEffectsFired.has(USED_KEY)) {
      return false;
    }
    return stages < 0;
  }

  override apply(params: PostStatStageChangeAbAttrParams): void {
    const { pokemon, simulated } = params;
    if (simulated) {
      return;
    }
    pokemon.waveData.entryEffectsFired.add(USED_KEY);
    this.helper.switchOutLogic(pokemon);
  }
}
