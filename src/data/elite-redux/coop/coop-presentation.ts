/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { coopLog } from "#data/elite-redux/coop/coop-debug";
import { getCoopController, getCoopNetcodeMode, getCoopSessionKind } from "#data/elite-redux/coop/coop-runtime";

function isAuthoritativeGuest(): boolean {
  return (
    getCoopController()?.role === "guest" && getCoopNetcodeMode() === "authoritative" && getCoopSessionKind() === "coop"
  );
}

/** Clear the player throw sprite when the gated guest enters its next encounter. */
export function clearCoopAuthoritativeGuestPlayerTrainer(): boolean {
  if (!isAuthoritativeGuest()) {
    return false;
  }
  const repaired = globalScene.trainer.visible;
  globalScene.trainer.setVisible(false);
  if (repaired) {
    coopLog("renderer", "cleared unmatched authoritative-guest player trainer");
  }
  return repaired;
}

/** Reassert trainer-chrome postconditions without touching Pokemon or field membership. */
export function ensureCoopAuthoritativeCommandPresentation(): void {
  if (!isAuthoritativeGuest()) {
    return;
  }

  // Player throw sprite: SummonPhase normally completes its exit tween.
  clearCoopAuthoritativeGuestPlayerTrainer();

  // Enemy trainer container: EncounterPhase.hideEnemyTrainer normally completes this
  // fade while the summon messages/animations run. Hide the container as well as snapping
  // alpha so its still-running tween cannot make it cover the command screen again. The
  // normal showEnemyTrainer path explicitly restores visibility before any later switch.
  const enemyTrainer = globalScene.currentBattle?.trainer;
  const repairedEnemyTrainer = enemyTrainer != null && (enemyTrainer.visible || enemyTrainer.alpha > 0);
  enemyTrainer?.setAlpha(0).setVisible(false);

  if (repairedEnemyTrainer) {
    coopLog("renderer", "command presentation postcondition hid stale enemy trainer");
  }
}
