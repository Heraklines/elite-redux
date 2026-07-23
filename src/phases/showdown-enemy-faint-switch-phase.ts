/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { BattleScene } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { coopLog } from "#data/elite-redux/coop/coop-debug";
import {
  beginCoopFaintSwitchWindow,
  COOP_FAINT_SWITCH_SEQ_BASE,
  endCoopFaintSwitchWindow,
  getCoopFaintSwitchWaitMs,
} from "#data/elite-redux/coop/coop-interaction-relay";
import {
  failCoopSharedSession,
  getCoopInteractionRelay,
  isShowdownSyncSession,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_SWITCH_CHOICE_KINDS } from "#data/elite-redux/coop/coop-seq-registry";
import { SwitchType } from "#enums/switch-type";
import { UiMode } from "#enums/ui-mode";
import { BattlePhase } from "#phases/battle-phase";

/**
 * Showdown 1v1 opponent replacement: the local ENEMY side is the remote human's own team. When one
 * of those enemy mons faints, or uses a move such as Teleport/Baton Pass, the remote client opens
 * its OWN picker and relays the chosen party
 * slot under the flat `COOP_FAINT_SWITCH_SEQ_BASE + fieldIndex` band - the SAME contract the co-op
 * host awaits for a guest-owned PLAYER slot ({@linkcode SwitchPhase} authoritative branch, #786),
 * here applied to the ENEMY side because in versus the guest owns the whole enemy half.
 *
 * This phase AWAITS that relayed pick (bounded by {@linkcode getCoopFaintSwitchWaitMs}), validates
 * it against the live enemy party (index in range, not fainted, not already on field; identity
 * resolved by species per #799 in case the two clients' party orders drifted), then summons that
 * mon. On a timeout / disconnect / illegal pick it falls back to the enemy trainer AI's pick
 * (`SwitchSummonPhase` with a `-1` slot resolves it via `getNextSummonIndex`) so the duel never
 * stalls. Pushed by {@linkcode FaintPhase} ONLY for a live versus host with an enemy reserve; a
 * co-op host (its enemy is AI) keeps the vanilla inline auto-pick.
 */
export class ShowdownEnemyFaintSwitchPhase extends BattlePhase {
  public readonly phaseName = "ShowdownEnemyFaintSwitchPhase";

  private readonly fieldIndex: number;

  constructor(fieldIndex: number) {
    super();
    this.fieldIndex = fieldIndex;
  }

  start(): void {
    super.start();

    const scene = globalScene;
    const relay = getCoopInteractionRelay();
    if (relay == null) {
      if (isShowdownSyncSession()) {
        failCoopSharedSession("Showdown Sync lost the opponent replacement relay.");
      } else {
        // Authoritative Showdown can fall back to trainer AI when the remote renderer disconnects.
        this.unshiftSummon(scene, -1);
      }
      scene.phaseManager.shiftPhase();
      return;
    }

    const faintSeq = COOP_FAINT_SWITCH_SEQ_BASE + this.fieldIndex;
    coopLog("replay", `versus host awaiting opponent replacement pick slot=${this.fieldIndex} seq=${faintSeq}`);
    scene.ui.showText("Waiting for the opponent to choose their next Pokemon...");
    // Suppress the stall watchdog for the whole await: a slow-but-alive opponent parks BOTH engines in
    // network waits (this relay pick + the guest's replay), which the mutual-wait watchdog would otherwise
    // misread as a deadlock ~20s in and "recover" by cancelling this pick + pulling a stateSync. Paired
    // 1:1 with endCoopFaintSwitchWindow in the .then (which always runs - the await resolves null on
    // timeout / disconnect / resync-rescue), so the pin never leaks.
    beginCoopFaintSwitchWindow();
    void relay.awaitInteractionChoice(faintSeq, getCoopFaintSwitchWaitMs(), COOP_SWITCH_CHOICE_KINDS).then(res => {
      endCoopFaintSwitchWindow();
      // Transport delivery and promise resumption can occur while another in-process client is active.
      // This continuation owns the scene whose host phase opened the waiter; a stale phase never mutates a
      // later battle, while a valid completion uses only that captured scene/phase manager.
      if (scene.phaseManager.getCurrentPhase() !== this) {
        return;
      }
      let slotIndex = res?.choice ?? -1;
      const party = scene.getEnemyParty();
      // Sync carries Pokemon.id in data[2], which is shared by both launch snapshots and remains stable
      // through party reordering. Older authoritative faint picks carry only species in data[1], retained
      // as a compatibility fallback.
      const pickedId = res?.data?.[2] ?? 0;
      const pickedSpecies = res?.data?.[1] ?? 0;
      if (pickedId > 0 && slotIndex >= 0 && party[slotIndex]?.id !== pickedId) {
        const byId = party.findIndex(p => p != null && !p.isOnField() && p.id === pickedId);
        if (byId >= 0) {
          coopLog(
            "replay",
            `versus opponent pick slot=${slotIndex} holds id=${party[slotIndex]?.id ?? 0} but picked id=${pickedId} -> resolved by identity to slot=${byId}`,
          );
          slotIndex = byId;
        }
      }
      if (pickedSpecies > 0 && slotIndex >= 0) {
        const atSlot = party[slotIndex];
        if (atSlot?.species?.speciesId !== pickedSpecies) {
          const bySpecies = party.findIndex(
            (p, i) => i < 6 && p != null && !p.isOnField() && p.species?.speciesId === pickedSpecies,
          );
          if (bySpecies >= 0) {
            coopLog(
              "replay",
              `versus opponent pick slot=${slotIndex} holds sp${atSlot?.species?.speciesId ?? 0} but picked sp${pickedSpecies} -> resolved by identity to slot=${bySpecies}`,
            );
            slotIndex = bySpecies;
          }
        }
      }
      const picked = party[slotIndex];
      // Host-authoritative legality: a real, non-fainted, benched enemy party member. An out-of-range
      // / fainted / on-field / no-reply (-1 sentinel) pick AI-falls-back so a hostile or benchless peer
      // can never strand the enemy slot.
      const legal = slotIndex >= 0 && slotIndex < 6 && picked != null && !picked.isFainted() && !picked.isOnField();
      if (legal) {
        const encodedSwitchType = res?.data?.[3];
        const switchType =
          isShowdownSyncSession()
          && encodedSwitchType != null
          && [SwitchType.SWITCH, SwitchType.BATON_PASS, SwitchType.SHED_TAIL].includes(encodedSwitchType as SwitchType)
            ? (encodedSwitchType as SwitchType)
            : SwitchType.SWITCH;
        coopLog(
          "replay",
          `versus applies opponent replacement slot=${this.fieldIndex} -> enemyParty[${slotIndex}] type=${SwitchType[switchType]}`,
        );
        this.unshiftSummon(scene, slotIndex, switchType);
      } else {
        coopLog(
          "replay",
          `versus opponent replacement pick seq=${faintSeq} ${res == null ? "TIMED OUT" : `illegal (${slotIndex})`} -> ${isShowdownSyncSession() ? "FAIL CLOSED" : "AI auto-pick"}`,
        );
        if (isShowdownSyncSession()) {
          // Dual simulation has no authority that may invent a replacement. Failing closed preserves
          // the causal error instead of silently choosing another mon and corrupting the next command.
          failCoopSharedSession("Showdown Sync could not apply the opponent's replacement choice.");
        } else {
          // -1 lets authoritative Showdown resolve a disconnected opponent through trainer AI.
          this.unshiftSummon(scene, -1);
        }
      }
      const finish = (): void => {
        if (scene.phaseManager.getCurrentPhase() === this) {
          scene.phaseManager.shiftPhase();
        }
      };
      void Promise.resolve(scene.ui.setMode(UiMode.MESSAGE)).then(finish, finish);
    });
  }

  /**
   * Summon the enemy replacement (a concrete party slot, or `-1` for the trainer-AI pick), then push
   * an OUT-OF-BAND replacement checkpoint so the GUEST materializes its own team's replacement
   * IMMEDIATELY - the same #633 guest-faint deadlock avoidance the co-op host applies in
   * {@linkcode SwitchPhase}: the host's next turn needs the guest's command for this very mon, which the
   * guest cannot see until this checkpoint streams it. Two ordered unshifts (summon first, checkpoint
   * after) mirror the co-op host's `SwitchSummonPhase` + `CoopPushReplacementCheckpointPhase` pair, so
   * the checkpoint captures the freshly-summoned mon.
   */
  private unshiftSummon(scene: BattleScene, slotIndex: number, switchType = SwitchType.SWITCH): void {
    scene.phaseManager.unshiftNew("SwitchSummonPhase", switchType, this.fieldIndex, slotIndex, false, false);
    if (!isShowdownSyncSession()) {
      scene.phaseManager.unshiftNew("CoopPushReplacementCheckpointPhase");
    }
  }
}
