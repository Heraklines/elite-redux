/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { BattleScene } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { coopLog } from "#data/elite-redux/coop/coop-debug";
import {
  COOP_FAINT_SWITCH_RESOLUTION_FALLBACK,
  COOP_FAINT_SWITCH_RESOLUTION_OWNER,
  type CoopFaintSourceAddress,
  addressCoopFaintSwitchChoiceData,
  awaitAddressedCoopFaintSwitchChoice,
  captureCoopFaintSwitchOperationBinding,
  commitFaintSwitchAuthorityResult,
} from "#data/elite-redux/coop/coop-faint-switch-operation";
import {
  beginCoopFaintSwitchWindow,
  endCoopFaintSwitchWindow,
  getCoopFaintSwitchWaitMs,
} from "#data/elite-redux/coop/coop-interaction-relay";
import {
  coopSessionGeneration,
  failCoopSharedSession,
  getCoopInteractionRelay,
  getCoopRuntime,
  runWhenCoopRuntimeActive,
} from "#data/elite-redux/coop/coop-runtime";
import { SwitchType } from "#enums/switch-type";
import { TrainerSlot } from "#enums/trainer-slot";
import { UiMode } from "#enums/ui-mode";
import { BattlePhase } from "#phases/battle-phase";

/**
 * Showdown 1v1 (versus faint-replacement, host side): the HOST's ENEMY side is the remote human
 * GUEST's own team. When one of those enemy mons faints with a legal bench, the guest's renderer
 * opens its OWN faint picker ({@linkcode CoopGuestFaintSwitchPhase}) and relays the chosen party
 * slot under the faint-switch carrier with an immutable epoch/wave/turn/field address - the SAME
 * contract the co-op host awaits for a guest-owned PLAYER slot ({@linkcode SwitchPhase} authoritative
 * branch, #786), here applied to the ENEMY side because in versus the guest owns the whole enemy half.
 *
 * This phase AWAITS that relayed pick (bounded by {@linkcode getCoopFaintSwitchWaitMs}), validates
 * it against the live enemy party (index in range, not fainted, not already on field; identity
 * resolved by species per #799 in case the two clients' party orders drifted), then summons that
 * mon. On a timeout or illegal pick it resolves one concrete trainer-AI fallback, retains that exact
 * terminal, and remains parked until the guest materially closes its old picker. Pushed by
 * {@linkcode FaintPhase} ONLY for a live versus host with an enemy reserve; a co-op host (its enemy is
 * AI) keeps the vanilla inline auto-pick.
 */
export class ShowdownEnemyFaintSwitchPhase extends BattlePhase {
  public readonly phaseName = "ShowdownEnemyFaintSwitchPhase";

  private readonly fieldIndex: number;
  private readonly faintSourceAddress: CoopFaintSourceAddress | undefined;

  constructor(fieldIndex: number, faintSourceAddress?: CoopFaintSourceAddress) {
    super();
    this.fieldIndex = fieldIndex;
    this.faintSourceAddress = faintSourceAddress;
  }

  start(): void {
    super.start();

    const scene = globalScene;
    const relay = getCoopInteractionRelay();
    if (relay == null) {
      failCoopSharedSession("The opponent replacement flow lost its interaction relay.");
      return;
    }
    const operationBinding = (() => {
      try {
        return captureCoopFaintSwitchOperationBinding("host");
      } catch {
        failCoopSharedSession("The opponent replacement flow lost its co-op runtime binding.");
        return null;
      }
    })();
    if (operationBinding == null) {
      return;
    }
    const sourceAddress = this.faintSourceAddress ?? {
      wave: scene.currentBattle.waveIndex,
      turn: scene.currentBattle.turn ?? 0,
      occurrence: 0,
    };
    const phaseBoundary = {
      wave: scene.currentBattle.waveIndex,
      turn: scene.currentBattle.turn ?? 0,
    };
    const sourceGeneration = coopSessionGeneration();
    const runtime = getCoopRuntime();
    if (runtime == null || runtime.controller.role !== "host") {
      failCoopSharedSession("The opponent replacement flow lost its active host runtime.");
      return;
    }
    const boundaryStillLive = (): boolean =>
      coopSessionGeneration() === sourceGeneration
      && getCoopRuntime() === runtime
      && scene.phaseManager.getCurrentPhase() === this
      && scene.currentBattle.waveIndex === phaseBoundary.wave
      && (scene.currentBattle.turn ?? 0) === phaseBoundary.turn;
    coopLog(
      "replay",
      `versus host awaiting opponent replacement pick slot=${this.fieldIndex} `
        + `address=${sourceAddress.wave}:${sourceAddress.turn}`,
    );
    scene.ui.showText("Waiting for the opponent to choose their next Pokemon...");
    // Suppress the stall watchdog for the whole await: a slow-but-alive opponent parks BOTH engines in
    // network waits (this relay pick + the guest's replay), which the mutual-wait watchdog would otherwise
    // misread as a deadlock ~20s in and "recover" by cancelling this pick + pulling a stateSync. Paired
    // 1:1 with endCoopFaintSwitchWindow in the .then (which always runs - the await resolves null on
    // timeout / disconnect / resync-rescue), so the pin never leaks.
    beginCoopFaintSwitchWindow();
    void awaitAddressedCoopFaintSwitchChoice(
      relay,
      {
        ...sourceAddress,
        fieldIndex: this.fieldIndex,
        timeoutMs: getCoopFaintSwitchWaitMs(),
      },
      operationBinding,
    ).then(res => {
      endCoopFaintSwitchWindow();
      // Transport delivery and promise resumption can occur while another in-process client is active.
      // This continuation owns the scene whose host phase opened the waiter; a stale phase never mutates a
      // later battle, while a valid completion uses only that captured scene/phase manager.
      if (coopSessionGeneration() !== sourceGeneration) {
        return;
      }
      if (!boundaryStillLive()) {
        failCoopSharedSession("The opponent replacement lost its exact host boundary before committing.");
        return;
      }
      let slotIndex = res?.choice ?? -1;
      const party = scene.getEnemyParty();
      // #799 identity resolution: the pick carries the chosen mon's SPECIES (data[1]); if the two
      // clients' party orders diverged, the blind slot index points at a DIFFERENT mon here - re-find
      // the picked species among the benched enemy mons and log the drift.
      const pickedSpecies = res?.data?.[1] ?? 0;
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
      const usedFallback = !legal;
      if (!legal) {
        slotIndex = this.resolveFallbackSlot(scene);
      }
      const authoritativePick = party[slotIndex];
      if (
        slotIndex < 0
        || authoritativePick == null
        || authoritativePick.isFainted()
        || authoritativePick.isOnField()
      ) {
        failCoopSharedSession("The opponent replacement fallback could not resolve a legal concrete slot.");
        return;
      }
      if (!usedFallback) {
        coopLog(
          "replay",
          `versus host applies opponent replacement slot=${this.fieldIndex} -> enemyParty[${slotIndex}]`,
        );
      } else {
        coopLog(
          "replay",
          `versus opponent replacement pick field=${this.fieldIndex} ${
            res == null ? "TIMED OUT" : "illegal"
          } -> concrete AI slot=${slotIndex}`,
        );
      }
      const terminalData = addressCoopFaintSwitchChoiceData(
        [0, authoritativePick.species?.speciesId ?? 0],
        {
          ...sourceAddress,
          fieldIndex: this.fieldIndex,
          partySlot: slotIndex,
          resolution: usedFallback ? COOP_FAINT_SWITCH_RESOLUTION_FALLBACK : COOP_FAINT_SWITCH_RESOLUTION_OWNER,
        },
        operationBinding,
      );
      const receipt = commitFaintSwitchAuthorityResult(
        {
          payload: { fieldIndex: this.fieldIndex, partySlot: slotIndex, data: terminalData },
          ownerRole: "guest",
          localRole: "host",
          ...sourceAddress,
        },
        operationBinding,
      );
      if (receipt == null) {
        failCoopSharedSession("The authoritative opponent replacement could not be retained.");
        return;
      }
      const releaseAfterPeerMaterial = (): void => {
        void scene.ui.setModeBoundedWhen(UiMode.MESSAGE, 2_000, boundaryStillLive).then(result => {
          if (coopSessionGeneration() !== sourceGeneration) {
            return;
          }
          if (result === "superseded" || !boundaryStillLive()) {
            failCoopSharedSession("The opponent replacement lost its exact host boundary while closing.");
            return;
          }
          this.unshiftSummon(scene, slotIndex);
          scene.phaseManager.shiftPhase();
        });
      };
      if (receipt.operationId == null) {
        if (usedFallback) {
          failCoopSharedSession("An opponent replacement timeout cannot continue without a retained peer terminal.");
          return;
        }
        releaseAfterPeerMaterial();
        return;
      }
      const durability = runtime.durability;
      if (durability == null) {
        failCoopSharedSession(`Opponent replacement terminal ${receipt.operationId} has no host material barrier.`);
        return;
      }
      const operationId = receipt.operationId;
      void durability
        .waitForOperationMaterialApplied(operationId)
        .then(applied => {
          if (coopSessionGeneration() !== sourceGeneration) {
            return;
          }
          if (!applied) {
            failCoopSharedSession(`Opponent replacement terminal ${operationId} exhausted before peer material apply.`);
            return;
          }
          runWhenCoopRuntimeActive(runtime, () => {
            if (!boundaryStillLive()) {
              failCoopSharedSession(`Opponent replacement terminal ${operationId} lost its host phase boundary.`);
              return;
            }
            releaseAfterPeerMaterial();
          });
        })
        .catch(() => {
          if (coopSessionGeneration() === sourceGeneration) {
            failCoopSharedSession(`Opponent replacement terminal ${operationId} material barrier failed.`);
          }
        });
    });
  }

  private resolveFallbackSlot(scene: BattleScene): number {
    const partnered = scene.currentBattle.double && !!scene.currentBattle.trainer?.isDouble();
    const trainerSlot = partnered && this.fieldIndex ? TrainerSlot.TRAINER_PARTNER : TrainerSlot.TRAINER;
    return scene.currentBattle.trainer?.getNextSummonIndex(trainerSlot) ?? -1;
  }

  /**
   * Summon the enemy replacement from one concrete party slot, then push an OUT-OF-BAND replacement
   * checkpoint so the GUEST materializes its own team's replacement
   * IMMEDIATELY - the same #633 guest-faint deadlock avoidance the co-op host applies in
   * {@linkcode SwitchPhase}: the host's next turn needs the guest's command for this very mon, which the
   * guest cannot see until this checkpoint streams it. Two ordered unshifts (summon first, checkpoint
   * after) mirror the co-op host's `SwitchSummonPhase` + `CoopPushReplacementCheckpointPhase` pair, so
   * the checkpoint captures the freshly-summoned mon.
   */
  private unshiftSummon(scene: BattleScene, slotIndex: number): void {
    scene.phaseManager.unshiftNew("SwitchSummonPhase", SwitchType.SWITCH, this.fieldIndex, slotIndex, false, false);
    scene.phaseManager.unshiftNew("CoopPushReplacementCheckpointPhase");
  }
}
