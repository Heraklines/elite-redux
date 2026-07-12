/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import { getCoopController, getCoopNetcodeMode } from "#data/elite-redux/coop/coop-runtime";
import type { Pokemon } from "#field/pokemon";

const pendingSummonPresentation = new WeakSet<Pokemon>();

function isAuthoritativeGuest(): boolean {
  return getCoopController()?.role === "guest" && getCoopNetcodeMode() === "authoritative";
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

/**
 * Mark a battler hidden by trainer encounter setup whose structural SummonPhase will
 * be neutralized on the authoritative guest. The explicit marker prevents command
 * cleanup from revealing Pokemon hidden intentionally by Substitute, Commander, or
 * a semi-invulnerable move.
 */
export function markCoopAuthoritativeSummonPresentationPending(pokemon: Pokemon): void {
  // Mark unconditionally at the trainer-hide seam. Only an authoritative guest can
  // consume it, and unconditional marking keeps the two-scene headless scheduler from
  // losing evidence if a Promise continuation temporarily has the other client active.
  pendingSummonPresentation.add(pokemon);
}

/**
 * Reassert the presentation-only postconditions that a normal SummonPhase owns.
 *
 * The authoritative guest deliberately neutralizes SummonPhase because it also runs
 * structural battle hooks. Trainer EncounterPhase hides the enemy Pokemon before it
 * queues those summons, however, so the renderer must restore the already-authoritative,
 * already-seated battlers before command input can open.
 */
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

  const repairedPokemonIds: number[] = [];
  for (const pokemon of globalScene.getField(true)) {
    // getField(true) is a party-slot view rather than a display-list query. Never seat a
    // missing battler here; structural membership remains owned by authoritative apply.
    if (pokemon == null || !pokemon.isOnField() || !pendingSummonPresentation.has(pokemon)) {
      continue;
    }
    try {
      const sprite = pokemon.getSprite();
      if (!pokemon.visible || sprite?.visible === false || pokemon.getBattleInfo()?.visible === false) {
        repairedPokemonIds.push(pokemon.id);
      }
      pokemon.setVisible(true);
      sprite?.setVisible(true);
      pokemon.showInfo();
      pokemon
        .updateInfo(true)
        .catch(error => coopWarn("renderer", `command presentation info refresh failed pokemon=${pokemon.id}`, error));
      pendingSummonPresentation.delete(pokemon);
    } catch (error) {
      // Presentation repair must never turn a cosmetic problem into an input softlock.
      coopWarn("renderer", `command presentation repair failed pokemon=${pokemon.id}`, error);
    }
  }
  if (repairedEnemyTrainer || repairedPokemonIds.length > 0) {
    coopLog(
      "renderer",
      `command presentation postcondition enemyTrainer=${repairedEnemyTrainer} battlers=[${repairedPokemonIds.join(",")}]`,
    );
  }
}
