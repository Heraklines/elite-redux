/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { BattleScene } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { coopLog } from "#data/elite-redux/coop/coop-debug";
import {
  addressCoopFaintSwitchChoiceData,
  awaitAddressedCoopFaintSwitchChoice,
  COOP_FAINT_SWITCH_RESOLUTION_FALLBACK,
  COOP_FAINT_SWITCH_RESOLUTION_OWNER,
  type CoopFaintSourceAddress,
  captureCoopFaintSwitchOperationBinding,
  commitFaintSwitchAuthorityResult,
} from "#data/elite-redux/coop/coop-faint-switch-operation";
import {
  beginCoopFaintSwitchWindow,
  COOP_FAINT_SWITCH_SEQ_BASE,
  endCoopFaintSwitchWindow,
  getCoopFaintSwitchWaitMs,
} from "#data/elite-redux/coop/coop-interaction-relay";
import {
  coopSessionGeneration,
  failCoopSharedSession,
  getCoopInteractionRelay,
  getCoopRuntime,
  isShowdownSyncSession,
  runWhenCoopRuntimeActive,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_SWITCH_CHOICE_KINDS } from "#data/elite-redux/coop/coop-seq-registry";
import { SwitchType } from "#enums/switch-type";
import { TrainerSlot } from "#enums/trainer-slot";
import { UiMode } from "#enums/ui-mode";
import { BattlePhase } from "#phases/battle-phase";

/**
 * Resolves a remote-human replacement on the local enemy side.
 *
 * Authoritative Showdown commits one addressed replacement through Authority V2 and waits for peer
 * material application. Showdown Sync runs both simulations, so each peer consumes the other player's
 * flat replacement choice and must fail closed instead of inventing a trainer-AI fallback.
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
      failCoopSharedSession(
        isShowdownSyncSession()
          ? "Showdown Sync lost the opponent replacement relay."
          : "The opponent replacement flow lost its interaction relay.",
      );
      return;
    }
    if (isShowdownSyncSession()) {
      this.startShowdownSync(scene, relay);
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
      runWhenCoopRuntimeActive(runtime, () => {
        if (coopSessionGeneration() !== sourceGeneration) {
          return;
        }
        if (!boundaryStillLive()) {
          failCoopSharedSession("The opponent replacement lost its exact host boundary before committing.");
          return;
        }
        let slotIndex = res?.choice ?? -1;
        const party = scene.getEnemyParty();
        const pickedId = res?.data?.[2] ?? 0;
        const pickedSpecies = res?.data?.[1] ?? 0;
        if (pickedId > 0 && slotIndex >= 0 && party[slotIndex]?.id !== pickedId) {
          const byId = party.findIndex(p => p != null && !p.isOnField() && p.id === pickedId);
          if (byId >= 0) {
            coopLog(
              "replay",
              `versus opponent pick slot=${slotIndex} holds id=${party[slotIndex]?.id ?? 0} `
                + `but picked id=${pickedId} -> resolved by identity to slot=${byId}`,
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
                `versus opponent pick slot=${slotIndex} holds sp${atSlot?.species?.speciesId ?? 0} `
                  + `but picked sp${pickedSpecies} -> resolved by identity to slot=${bySpecies}`,
              );
              slotIndex = bySpecies;
            }
          }
        }
        const picked = party[slotIndex];
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
        coopLog(
          "replay",
          usedFallback
            ? `versus opponent replacement pick field=${this.fieldIndex} ${
                res == null ? "TIMED OUT" : "illegal"
              } -> concrete AI slot=${slotIndex}`
            : `versus host applies opponent replacement slot=${this.fieldIndex} -> enemyParty[${slotIndex}]`,
        );
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
            speciesId: authoritativePick.species?.speciesId ?? terminalData[1],
            ...sourceAddress,
          },
          operationBinding,
        );
        if (receipt == null) {
          failCoopSharedSession("The authoritative opponent replacement could not be retained.");
          return;
        }
        const releaseAfterPeerMaterial = (): void => {
          void scene.ui.setModeBoundedWhen(UiMode.MESSAGE, 2_000, boundaryStillLive).then(result =>
            runWhenCoopRuntimeActive(runtime, () => {
              if (coopSessionGeneration() !== sourceGeneration) {
                return;
              }
              if (result === "superseded" || !boundaryStillLive()) {
                failCoopSharedSession("The opponent replacement lost its exact host boundary while closing.");
                return;
              }
              this.unshiftSummon(scene, slotIndex);
              scene.phaseManager.shiftPhase();
            }),
          );
        };
        if (receipt.v2Staged === true) {
          releaseAfterPeerMaterial();
          return;
        }
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
              failCoopSharedSession(
                `Opponent replacement terminal ${operationId} exhausted before peer material apply.`,
              );
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
    });
  }

  private startShowdownSync(scene: BattleScene, relay: NonNullable<ReturnType<typeof getCoopInteractionRelay>>): void {
    const runtime = getCoopRuntime();
    const sourceGeneration = coopSessionGeneration();
    const phaseBoundary = {
      wave: scene.currentBattle.waveIndex,
      turn: scene.currentBattle.turn ?? 0,
    };
    if (runtime == null) {
      failCoopSharedSession("Showdown Sync lost its opponent replacement runtime.");
      return;
    }
    const boundaryStillLive = (): boolean =>
      coopSessionGeneration() === sourceGeneration
      && getCoopRuntime() === runtime
      && scene.phaseManager.getCurrentPhase() === this
      && scene.currentBattle.waveIndex === phaseBoundary.wave
      && (scene.currentBattle.turn ?? 0) === phaseBoundary.turn;
    const faintSeq = COOP_FAINT_SWITCH_SEQ_BASE + this.fieldIndex;
    coopLog("replay", `showdown sync awaiting opponent replacement slot=${this.fieldIndex} seq=${faintSeq}`);
    scene.ui.showText("Waiting for the opponent to choose their next Pokemon...");
    beginCoopFaintSwitchWindow();
    void relay.awaitInteractionChoice(faintSeq, getCoopFaintSwitchWaitMs(), COOP_SWITCH_CHOICE_KINDS).then(res => {
      endCoopFaintSwitchWindow();
      runWhenCoopRuntimeActive(runtime, () => {
        if (!boundaryStillLive()) {
          return;
        }
        let slotIndex = res?.choice ?? -1;
        const party = scene.getEnemyParty();
        const pickedId = res?.data?.[2] ?? 0;
        const pickedSpecies = res?.data?.[1] ?? 0;
        if (pickedId > 0 && slotIndex >= 0 && party[slotIndex]?.id !== pickedId) {
          const byId = party.findIndex(p => p != null && !p.isOnField() && p.id === pickedId);
          if (byId >= 0) {
            slotIndex = byId;
          }
        }
        if (pickedSpecies > 0 && slotIndex >= 0 && party[slotIndex]?.species?.speciesId !== pickedSpecies) {
          const bySpecies = party.findIndex(
            (p, i) => i < 6 && p != null && !p.isOnField() && p.species?.speciesId === pickedSpecies,
          );
          if (bySpecies >= 0) {
            slotIndex = bySpecies;
          }
        }
        const picked = party[slotIndex];
        const legal = slotIndex >= 0 && slotIndex < 6 && picked != null && !picked.isFainted() && !picked.isOnField();
        if (!legal) {
          failCoopSharedSession("Showdown Sync could not apply the opponent's replacement choice.");
          return;
        }
        const encodedSwitchType = res?.data?.[3];
        const switchType =
          encodedSwitchType != null
          && [SwitchType.SWITCH, SwitchType.BATON_PASS, SwitchType.SHED_TAIL].includes(encodedSwitchType as SwitchType)
            ? (encodedSwitchType as SwitchType)
            : SwitchType.SWITCH;
        coopLog(
          "replay",
          `showdown sync applies opponent replacement slot=${this.fieldIndex} -> enemyParty[${slotIndex}] `
            + `type=${SwitchType[switchType]}`,
        );
        this.unshiftSummon(scene, slotIndex, switchType);
        const finish = (): void => {
          runWhenCoopRuntimeActive(runtime, () => {
            if (boundaryStillLive()) {
              scene.phaseManager.shiftPhase();
            }
          });
        };
        void Promise.resolve(scene.ui.setMode(UiMode.MESSAGE)).then(finish, finish);
      });
    });
  }

  private resolveFallbackSlot(scene: BattleScene): number {
    const partnered = scene.currentBattle.double && !!scene.currentBattle.trainer?.isDouble();
    const trainerSlot = partnered && this.fieldIndex ? TrainerSlot.TRAINER_PARTNER : TrainerSlot.TRAINER;
    return scene.currentBattle.trainer?.getNextSummonIndex(trainerSlot) ?? -1;
  }

  private unshiftSummon(scene: BattleScene, slotIndex: number, switchType = SwitchType.SWITCH): void {
    scene.phaseManager.unshiftNew("SwitchSummonPhase", switchType, this.fieldIndex, slotIndex, false, false);
    if (!isShowdownSyncSession()) {
      scene.phaseManager.unshiftNew("CoopPushReplacementCheckpointPhase");
    }
  }
}
