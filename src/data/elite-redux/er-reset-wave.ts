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

      globalScene.phaseManager.pushNew("SummonPhase", 0, true, true);
      if (globalScene.currentBattle.double && availablePartyMembers > 1) {
        globalScene.phaseManager.pushNew("SummonPhase", 1, true, true);
      }
      if (globalScene.currentBattle.waveIndex > 1 && globalScene.currentBattle.battleType !== BattleType.TRAINER) {
        globalScene.phaseManager.pushNew("CheckSwitchPhase", 0, globalScene.currentBattle.double);
        if (globalScene.currentBattle.double && availablePartyMembers > 1) {
          globalScene.phaseManager.pushNew("CheckSwitchPhase", 1, globalScene.currentBattle.double);
        }
      }

      globalScene.ui.fadeIn(1000);
      onComplete?.();
    });
  });
}
