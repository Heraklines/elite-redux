/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - reload the CURRENT wave from its save snapshot.
//
// Every wave writes a local session save at the start of its EncounterPhase
// (encounter-phase.ts, `saveAll(true, ...)`), so the run can be reloaded to the
// exact start of the wave: the player party is restored and the enemy party is
// reconstructed verbatim from that snapshot. This is the SAME sequence the
// lose-retry flow uses (game-over-phase.ts) - kept here as a shared routine so a
// dev "Reset wave" command can reuse it.
//
// It tears down the phase queue and re-pushes the encounter, so the caller must
// end whatever phase it is running afterwards (pass `onComplete`, which fires
// once the rebuilt phases are queued).
// =============================================================================

import { globalScene } from "#app/global-scene";
import { BattleType } from "#enums/battle-type";

/**
 * Fade out, reset the scene, reload the current session, and re-push the wave's
 * encounter + summon (+ switch-check) phases - i.e. restart the current wave from
 * the start. `onComplete` runs after the phases are queued (use it to `end()` the
 * caller's phase so the manager advances into the rebuilt encounter).
 */
export function reloadCurrentWave(onComplete?: () => void): void {
  globalScene.ui.fadeOut(1000).then(() => {
    globalScene.reset();
    globalScene.phaseManager.clearPhaseQueue();
    globalScene.gameData.loadSession(globalScene.sessionSlotId).then(() => {
      globalScene.phaseManager.pushNew("EncounterPhase", true);

      const availablePartyMembers = globalScene.getPokemonAllowedInBattle().length;

      // Format-capacity, not hardcoded doubles slots 0/1: a reset TRIPLE re-summoned only
      // ONE mon (`double` is false there) - the live "after a freeze+reset it won't send
      // out more than one mon" report. SummonPhase's isOnField guard keeps this idempotent
      // with the encounter-phase reload-restore of slots >= 1.
      const battlerCount = globalScene.currentBattle.getBattlerCount();
      for (let i = 0; i < battlerCount && (i === 0 || availablePartyMembers > i); i++) {
        globalScene.phaseManager.pushNew("SummonPhase", i, true, true);
      }
      if (globalScene.currentBattle.waveIndex > 1 && globalScene.currentBattle.battleType !== BattleType.TRAINER) {
        for (let i = 0; i < battlerCount && (i === 0 || availablePartyMembers > i); i++) {
          globalScene.phaseManager.pushNew("CheckSwitchPhase", i, battlerCount > 1);
        }
      }

      globalScene.ui.fadeIn(1000);
      onComplete?.();
    });
  });
}
