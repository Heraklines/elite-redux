/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { initMoveAnim, loadMoveAnimAssets } from "#data/battle-anims";
import { decodeInteractionMaterial } from "#data/elite-redux/coop/authority-v2/adapters/interactions-learn";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import {
  armCoopLearnMoveBatchIntentResend,
  type CoopLearnMoveOperationBinding,
  captureCoopLearnMoveOperationBinding,
  coopLearnMoveDecisionOperationId,
  isCoopLearnMoveAuthorityV2Active,
} from "#data/elite-redux/coop/coop-learn-move-operation";
import {
  type CoopRuntime,
  clearCoopLearnMoveBatchInFlight,
  failCoopSharedSession,
  getCoopInteractionRelay,
  getCoopRuntime,
  getCoopUiMirror,
  notifyCoopV2InteractionSurfaceReady,
  retainCoopV2InteractionProposal,
  runWhenCoopRuntimeActive,
  setCoopLearnMoveBatchPickerOpener,
  settleCoopV2InteractionOperation,
} from "#data/elite-redux/coop/coop-runtime";
import {
  COOP_LEARN_MOVE_BATCH_CHOICE_KINDS,
  COOP_LEARN_MOVE_BATCH_FWD_SEQ_BASE,
} from "#data/elite-redux/coop/coop-seq-registry";
import { erRecordAchievementLearnMove } from "#data/elite-redux/er-achievement-tracker";
import type { MoveId } from "#enums/move-id";
import { UiMode } from "#enums/ui-mode";
import type { LearnMoveBatchDeps } from "#phases/learn-move-batch-phase";
import {
  COOP_LEARN_MOVE_BATCH_FALLBACK,
  decodeCoopLearnMoveBatchTerminal,
  encodeCoopLearnMoveBatchTerminal,
} from "#phases/learn-move-batch-phase";

/** Routing tag for the guest/host relayed batch terminal (distinguishes it on the wire / in logs). */
const LEARN_MOVE_BATCH_CHOICE_KIND = "learnMoveBatch";

/**
 * How long a watcher waits for the owner's batch decision before giving up. 20min: "wait for the human" -
 * a slow decision must never trip a premature give-up (desync). On a null (timeout / disconnect) the
 * watcher simply closes its panel; the moveset converges via the next checkpoint.
 */
const COOP_LEARN_MOVE_BATCH_WAIT_MS = 1_200_000;

/**
 * Queue-owned batch presentation. `overridePhase` makes it the real current phase while preserving the
 * parked renderer underneath, so Authority V2 can bind control to an exact phase/handler generation.
 */
export class CoopReplayLearnMoveBatchPhase extends Phase {
  public readonly phaseName = "CoopReplayLearnMoveBatchPhase";
  public coopV2ControlOperationId: string | null;
  private readonly coopOwningRuntime = getCoopRuntime();
  private closed = false;
  private coopOperationBinding: CoopLearnMoveOperationBinding | null = null;
  /** Guest-owned proposal retained until the exact immutable result returns. */
  private submittedV2Decision: {
    readonly assignments: readonly (readonly [MoveId, number])[];
    readonly fallback: boolean;
  } | null = null;
  /** At-most-once terminal guard for committed result redelivery. */
  private committedV2ResultSettled = false;
  /** True only after the public batch handler is the active UI for this exact projected phase. */
  private coopPanelReady = false;

  constructor(
    private readonly partySlot: number,
    private readonly learnableIds: number[],
    private readonly ownerIsGuest: boolean,
    operationId: string | null = null,
  ) {
    super();
    this.coopV2ControlOperationId = operationId;
  }

  public override start(): void {
    super.start();
    runCoopLearnMoveBatchPicker(this);
  }

  public installCoopV2LearnMoveBatchPresentation(
    operationId: string,
    partySlot: number,
    learnableIds: readonly number[],
    ownerIsGuest: boolean,
  ): boolean {
    if (
      operationId.length === 0
      || partySlot !== this.partySlot
      || ownerIsGuest !== this.ownerIsGuest
      || learnableIds.length !== this.learnableIds.length
      || learnableIds.some((id, index) => id !== this.learnableIds[index])
      || (this.coopV2ControlOperationId != null && this.coopV2ControlOperationId !== operationId)
    ) {
      return false;
    }
    this.coopV2ControlOperationId = operationId;
    return true;
  }

  public presentation(): {
    readonly partySlot: number;
    readonly learnableIds: readonly number[];
    readonly ownerIsGuest: boolean;
  } {
    return {
      partySlot: this.partySlot,
      learnableIds: this.learnableIds,
      ownerIsGuest: this.ownerIsGuest,
    };
  }

  public owningRuntime(): ReturnType<typeof getCoopRuntime> {
    return this.coopOwningRuntime;
  }

  /** Capture the guest runtime's learn-operation domain once for every later async/result callback. */
  public bindCoopOperation(binding: CoopLearnMoveOperationBinding): boolean {
    if (this.coopOperationBinding != null && this.coopOperationBinding !== binding) {
      return false;
    }
    this.coopOperationBinding = binding;
    return true;
  }

  /** Prove the real handler, not merely its queued/opening promise, before a retained result may close it. */
  public markCoopV2PanelReady(): boolean {
    if (
      getCoopRuntime() !== this.coopOwningRuntime
      || globalScene.phaseManager.getCurrentPhase() !== this
      || globalScene.ui.getMode() !== UiMode.LEARN_MOVE_BATCH
    ) {
      return false;
    }
    this.coopPanelReady = true;
    return true;
  }

  /** Retain the exact owner proposal before its raw carrier can race a synchronous Authority V2 result. */
  public parkCoopV2Decision(assignments: readonly (readonly [MoveId, number])[], fallback: boolean): boolean {
    if (this.submittedV2Decision != null || this.committedV2ResultSettled) {
      return false;
    }
    this.submittedV2Decision = {
      assignments: assignments.map(pair => [pair[0], pair[1]] as const),
      fallback,
    };
    return true;
  }

  /** Close the overlay and synchronously resume its exact standby phase once MESSAGE is installed. */
  public closePanel(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    clearCoopLearnMoveBatchInFlight(this.partySlot);
    globalScene.ui.setMode(UiMode.MESSAGE).then(
      () => this.end(),
      () => this.end(),
    );
  }

  /**
   * Close this projected owner/watcher only from its exact admitted Authority V2 decision.
   *
   * Complete authoritative state has already applied before the runtime invokes this method. The source
   * entry and typed AWAIT_SUCCESSOR must still be the ledger head, the real batch handler must close, and
   * only then is terminal proof published. Raw relay choices cannot enter this seam.
   */
  public settleCoopV2CommittedLearnMoveBatchResult(
    operationId: string,
    partySlot: number,
    assignments: readonly (readonly [number, number])[],
    fallback: boolean,
    runtime: CoopRuntime,
  ): boolean {
    const expectedOperationId =
      this.coopV2ControlOperationId == null ? null : coopLearnMoveDecisionOperationId(this.coopV2ControlOperationId);
    const control = runtime.v2ControlLedger.latestControl;
    const sourceEntry = control == null ? null : runtime.v2ControlLedger.sourceEntryOf(control);
    const sourceMaterial = sourceEntry == null ? null : decodeInteractionMaterial(sourceEntry);
    const committedMatches =
      sourceMaterial?.surface === "learn-move-batch/decision"
      && sourceMaterial.partySlot === partySlot
      && sourceMaterial.fallback === fallback
      && sourceMaterial.assignments.length === assignments.length
      && sourceMaterial.assignments.every(
        (pair, index) => pair[0] === assignments[index]?.[0] && pair[1] === assignments[index]?.[1],
      );
    const submitted = this.submittedV2Decision;
    const submittedMatches =
      !this.ownerIsGuest
      || (submitted != null
        && submitted.fallback === fallback
        && submitted.assignments.length === assignments.length
        && submitted.assignments.every(
          (pair, index) => pair[0] === assignments[index]?.[0] && pair[1] === assignments[index]?.[1],
        ));
    if (
      this.committedV2ResultSettled
      || !this.coopPanelReady
      || runtime !== this.coopOwningRuntime
      || getCoopRuntime() !== runtime
      || globalScene.phaseManager.getCurrentPhase() !== this
      || !isCoopLearnMoveAuthorityV2Active(this.coopOperationBinding)
      || operationId !== expectedOperationId
      || partySlot !== this.partySlot
      || !submittedMatches
      || control?.kind !== "AWAIT_SUCCESSOR"
      || control.afterOperationId !== operationId
      || sourceEntry?.kind !== "INTERACTION_COMMIT"
      || sourceEntry.operationId !== operationId
      || !committedMatches
    ) {
      return false;
    }
    this.committedV2ResultSettled = true;
    this.submittedV2Decision = null;
    coopLog("v2-proposal", `committed learn-move batch result ${operationId} applied; closing exact projected panel`);
    const scene = globalScene;
    void scene.ui
      .setModeBoundedWhen(
        UiMode.MESSAGE,
        2_000,
        () =>
          scene.phaseManager.getCurrentPhase() === this
          && isCoopLearnMoveAuthorityV2Active(this.coopOperationBinding)
          && this.coopV2ControlOperationId != null
          && coopLearnMoveDecisionOperationId(this.coopV2ControlOperationId) === operationId,
      )
      .then(result => {
        runWhenCoopRuntimeActive(runtime, () => {
          if (result === "superseded" || globalScene !== scene || scene.phaseManager.getCurrentPhase() !== this) {
            failCoopSharedSession(`Committed learn-move batch result ${operationId} lost its projected phase`);
            return;
          }
          this.closed = true;
          getCoopUiMirror()?.endSession();
          clearCoopLearnMoveBatchInFlight(this.partySlot);
          super.end();
          if (!settleCoopV2InteractionOperation(operationId, runtime)) {
            failCoopSharedSession(`Committed learn-move batch result ${operationId} could not prove its terminal`);
          }
        });
      })
      .catch(() => {
        runWhenCoopRuntimeActive(runtime, () => {
          failCoopSharedSession(`Committed learn-move batch result ${operationId} could not close its projected panel`);
        });
      });
    return true;
  }
}

/**
 * INLINE batch Move Learn panel opener (#848), the GUEST half of the shared co-op level-up path. The host
 * streams a `learnMoveBatchForward` present when its {@linkcode LearnMoveBatchPhase} opens the panel; the
 * guest opens the SAME panel over its current (parked-renderer) screen:
 *  - `ownerIsGuest` = true: the GUEST owns the mon, so it DRIVES the real interactive panel and relays the
 *    final assignment set as a `learnMoveBatch` terminal (the host applies it authoritatively).
 *  - `ownerIsGuest` = false: the HOST owns the mon and drives; the guest opens the panel READ-ONLY as a
 *    WATCHER (the ui.ts cursor mirror replays the host's live cursor), then closes on the relayed terminal.
 *
 * Opened with `setModeWithoutClear` so it overlays the current screen and `revertMode` restores it once the
 * panel closes. It is the SOLE guest renderer for this learn (the guest runs no LearnMoveBatchPhase - its
 * engine is parked in CoopReplayTurnPhase), so the panel opens EXACTLY once per present.
 */
export function openCoopLearnMoveBatchPickerInline(
  partySlot: number,
  learnableIds: number[],
  ownerIsGuest: boolean,
  operationId?: string,
): void {
  const phase = new CoopReplayLearnMoveBatchPhase(partySlot, [...learnableIds], ownerIsGuest, operationId ?? null);
  if (!globalScene.phaseManager.overridePhase(phase)) {
    clearCoopLearnMoveBatchInFlight(partySlot);
    coopWarn("learnmove", `batch phase override refused slot=${partySlot}; retained presentation will retry`);
  }
}

function runCoopLearnMoveBatchPicker(phase: CoopReplayLearnMoveBatchPhase): void {
  const { partySlot, learnableIds, ownerIsGuest } = phase.presentation();
  const relay = getCoopInteractionRelay();
  const pokemon = globalScene.getPlayerParty()[partySlot];
  const seq = COOP_LEARN_MOVE_BATCH_FWD_SEQ_BASE + partySlot;
  if (relay == null || pokemon == null) {
    coopWarn("learnmove", "inline batch panel: no relay / mon; skipping (host await falls back)", {
      partySlot,
      hasRelay: relay != null,
    });
    phase.closePanel();
    return;
  }
  const operationBinding = captureCoopLearnMoveOperationBinding("guest");
  if (!phase.bindCoopOperation(operationBinding)) {
    failCoopSharedSession(`Learn-move batch phase for slot ${partySlot} changed its operation binding`);
    return;
  }
  const mirror = getCoopUiMirror();
  // Snapshot the pre-panel moveset so `revert` (the panel's "undo" exit) restores it EXACTLY.
  const snapshotMoveset = [...pokemon.moveset];
  const snapshotSummonMoveset = pokemon.summonData?.moveset ? [...pokemon.summonData.moveset] : null;
  const restoreSnapshot = (): void => {
    pokemon.moveset.splice(0, pokemon.moveset.length, ...snapshotMoveset);
    if (snapshotSummonMoveset && pokemon.summonData?.moveset) {
      pokemon.summonData.moveset.splice(0, pokemon.summonData.moveset.length, ...snapshotSummonMoveset);
    }
  };
  const learned: [MoveId, number][] = [];
  let settled = false;
  // Close to MESSAGE (the level-up text box the guest replay renders through) - NOT revertMode: the panel is
  // opened with setModeWithoutClear WITHOUT a chained mode, so revertMode would find an empty modeChain and
  // NOT close it (the panel would strand). setMode(MESSAGE) reliably tears it down.
  const closePanel = (): void => {
    phase.closePanel();
  };

  coopLog("learnmove", "guest inline batch Move Learn panel OPEN", {
    partySlot,
    learnable: learnableIds.length,
    ownerIsGuest,
    seq,
  });

  if (ownerIsGuest) {
    // GUEST DRIVES: real interactive panel; relay the final assignment set to the host on close.
    const deps: LearnMoveBatchDeps = {
      pokemon,
      learnableIds: [...learnableIds] as MoveId[],
      assign: (moveId, slotIndex) => {
        pokemon.setMove(slotIndex, moveId);
        erRecordAchievementLearnMove(pokemon, moveId);
        learned.push([moveId, slotIndex]);
        initMoveAnim(moveId).then(() => loadMoveAnimAssets([moveId], true));
      },
      revert: () => {
        restoreSnapshot();
        learned.length = 0;
      },
      done: () => {
        if (settled) {
          return;
        }
        settled = true;
        const { choice, data } = encodeCoopLearnMoveBatchTerminal(learned);
        coopLog("learnmove", "guest relays owned-mon batch terminal (#848)", { seq, count: choice });
        const decisionOperationId =
          phase.coopV2ControlOperationId == null
            ? null
            : coopLearnMoveDecisionOperationId(phase.coopV2ControlOperationId);
        const sendProposal = (): void =>
          relay.sendInteractionChoice(
            seq,
            LEARN_MOVE_BATCH_CHOICE_KIND,
            choice,
            data,
            undefined,
            decisionOperationId ?? undefined,
          );
        const payload = {
          type: "decision" as const,
          partySlot,
          assignments: learned.map(([moveId, slotIndex]) => [moveId, slotIndex] as [number, number]),
          fallback: false,
        };
        const v2 = isCoopLearnMoveAuthorityV2Active(operationBinding);
        if (v2 && decisionOperationId == null) {
          failCoopSharedSession(`Guest batch learn result for slot ${partySlot} lost its exact V2 address`);
          return;
        }
        if (v2) {
          if (!phase.parkCoopV2Decision(payload.assignments, false)) {
            failCoopSharedSession(`Learn-move batch proposal ${decisionOperationId} could not park its exact phase`);
            return;
          }
          const lease = retainCoopV2InteractionProposal(
            {
              operationId: decisionOperationId!,
              fingerprint: JSON.stringify(payload),
              resend: sendProposal,
              onExhausted: exhaustedOperationId => {
                if (getCoopRuntime() === phase.owningRuntime()) {
                  failCoopSharedSession(
                    `Learn-move batch proposal ${exhaustedOperationId} exhausted before Authority V2 commit`,
                  );
                }
              },
            },
            phase.owningRuntime(),
          );
          if (lease === "conflict" || lease === "invalid" || lease === "disposed") {
            failCoopSharedSession(`Learn-move batch proposal ${decisionOperationId} could not obtain a V2 lease`);
            return;
          }
          sendProposal();
          coopLog("v2-proposal", `parked guest batch owner for committed result id=${decisionOperationId}`);
          return;
        }
        sendProposal();
        mirror?.endSession();
        armCoopLearnMoveBatchIntentResend(
          {
            payload,
            wave: globalScene.currentBattle?.waveIndex ?? 0,
            turn: globalScene.currentBattle?.turn ?? 0,
            resend: sendProposal,
          },
          operationBinding,
        );
        closePanel();
      },
      fallback: () => {
        if (settled) {
          return;
        }
        settled = true;
        coopWarn("learnmove", "guest batch panel fallback -> relay FALLBACK terminal (host uses per-move) (#848)", {
          seq,
        });
        const decisionOperationId =
          phase.coopV2ControlOperationId == null
            ? null
            : coopLearnMoveDecisionOperationId(phase.coopV2ControlOperationId);
        const sendProposal = (): void =>
          relay.sendInteractionChoice(
            seq,
            LEARN_MOVE_BATCH_CHOICE_KIND,
            COOP_LEARN_MOVE_BATCH_FALLBACK,
            undefined,
            undefined,
            decisionOperationId ?? undefined,
          );
        const payload = { type: "decision" as const, partySlot, assignments: [], fallback: true };
        const v2 = isCoopLearnMoveAuthorityV2Active(operationBinding);
        if (v2 && decisionOperationId == null) {
          failCoopSharedSession(`Guest batch fallback for slot ${partySlot} lost its exact V2 address`);
          return;
        }
        if (v2) {
          if (!phase.parkCoopV2Decision([], true)) {
            failCoopSharedSession(`Learn-move batch fallback ${decisionOperationId} could not park its exact phase`);
            return;
          }
          const lease = retainCoopV2InteractionProposal(
            {
              operationId: decisionOperationId!,
              fingerprint: JSON.stringify(payload),
              resend: sendProposal,
              onExhausted: exhaustedOperationId => {
                if (getCoopRuntime() === phase.owningRuntime()) {
                  failCoopSharedSession(
                    `Learn-move batch fallback ${exhaustedOperationId} exhausted before Authority V2 commit`,
                  );
                }
              },
            },
            phase.owningRuntime(),
          );
          if (lease === "conflict" || lease === "invalid" || lease === "disposed") {
            failCoopSharedSession(`Learn-move batch fallback ${decisionOperationId} could not obtain a V2 lease`);
            return;
          }
          sendProposal();
          coopLog("v2-proposal", `parked guest batch fallback for committed result id=${decisionOperationId}`);
          return;
        }
        sendProposal();
        mirror?.endSession();
        armCoopLearnMoveBatchIntentResend(
          {
            payload,
            wave: globalScene.currentBattle?.waveIndex ?? 0,
            turn: globalScene.currentBattle?.turn ?? 0,
            resend: sendProposal,
          },
          operationBinding,
        );
        closePanel();
      },
    };
    void globalScene.ui.setModeWithoutClear(UiMode.LEARN_MOVE_BATCH, deps).then(() => {
      runWhenCoopRuntimeActive(phase.owningRuntime(), () => {
        if (!phase.markCoopV2PanelReady()) {
          if (isCoopLearnMoveAuthorityV2Active(operationBinding)) {
            failCoopSharedSession(`Learn-move batch owner for slot ${partySlot} could not prove its real panel`);
          }
          return;
        }
        getCoopUiMirror()?.beginSession("owner", UiMode.LEARN_MOVE_BATCH, seq);
        notifyCoopV2InteractionSurfaceReady(phase.owningRuntime());
      });
    });
    return;
  }

  // GUEST WATCHES (host owns + drives). The panel is driven by the host owner's replayed cursor (cosmetic);
  // the AUTHORITATIVE close is the host's relayed terminal, so we also await it and force-close (never a
  // strand if a cosmetic button is dropped).
  const finishWatch = (applyTerminal: [MoveId, number][] | null): void => {
    if (settled) {
      return;
    }
    settled = true;
    mirror?.endSession();
    if (applyTerminal != null && !isCoopLearnMoveAuthorityV2Active(operationBinding)) {
      // Converge the guest's cosmetic moveset to the host's authoritative final set (the per-turn
      // checkpoint would also heal it, but applying now avoids a visible flicker).
      restoreSnapshot();
      for (const [moveId, slotIndex] of applyTerminal) {
        pokemon.setMove(slotIndex, moveId);
        initMoveAnim(moveId).then(() => loadMoveAnimAssets([moveId], true));
      }
    }
    closePanel();
  };
  const watchDeps: LearnMoveBatchDeps = {
    pokemon,
    learnableIds: [...learnableIds] as MoveId[],
    // Cosmetic local write so the current column thins while the host drives; the awaited terminal is the
    // source of truth (restore+apply on receipt), so a dropped cursor button can never diverge the moveset.
    assign: (moveId, slotIndex) => {
      pokemon.setMove(slotIndex, moveId);
    },
    revert: () => restoreSnapshot(),
    done: () => {
      /* the authoritative close is the awaited terminal, not the replayed button */
    },
    fallback: () => {
      if (!isCoopLearnMoveAuthorityV2Active(operationBinding)) {
        finishWatch(null);
      }
      // Under V2 a cosmetic handler cannot retire the exact control. The retained immutable result (or
      // shared-session failure) remains the only terminal for this queue-owned replay phase.
    },
  };
  void globalScene.ui.setModeWithoutClear(UiMode.LEARN_MOVE_BATCH, watchDeps).then(() => {
    runWhenCoopRuntimeActive(phase.owningRuntime(), () => {
      if (!phase.markCoopV2PanelReady()) {
        if (isCoopLearnMoveAuthorityV2Active(operationBinding)) {
          failCoopSharedSession(`Learn-move batch watcher for slot ${partySlot} could not prove its real panel`);
        }
        return;
      }
      getCoopUiMirror()?.beginSession("watcher", UiMode.LEARN_MOVE_BATCH, seq);
      notifyCoopV2InteractionSurfaceReady(phase.owningRuntime());
    });
  });
  if (isCoopLearnMoveAuthorityV2Active(operationBinding)) {
    // The immutable result's live materializer closes this exact watcher. The raw 20-minute FIFO is legacy
    // compatibility only and must not own release under V2.
    return;
  }
  void relay
    .awaitInteractionChoice(seq, COOP_LEARN_MOVE_BATCH_WAIT_MS, COOP_LEARN_MOVE_BATCH_CHOICE_KINDS)
    .then(res => {
      if (isCoopLearnMoveAuthorityV2Active(operationBinding)) {
        const expectedOperationId =
          phase.coopV2ControlOperationId == null
            ? null
            : coopLearnMoveDecisionOperationId(phase.coopV2ControlOperationId);
        if (
          expectedOperationId == null
          || res?.operationId !== expectedOperationId
          || !settleCoopV2InteractionOperation(expectedOperationId, phase.owningRuntime())
        ) {
          failCoopSharedSession(`Guest batch watcher for slot ${partySlot} could not settle its exact V2 result`);
          return;
        }
      }
      if (res == null || res.choice === COOP_LEARN_MOVE_BATCH_FALLBACK) {
        coopLog("learnmove", "guest watcher batch terminal null/fallback -> close (moveset converges via checkpoint)", {
          seq,
        });
        finishWatch(null);
        return;
      }
      finishWatch(decodeCoopLearnMoveBatchTerminal(res.choice, res.data));
    });
}

// Register with the session runtime (loaded at boot via the phase-manager side-effect import) so the
// learnMoveBatchForward listener opens the batch panel INLINE.
setCoopLearnMoveBatchPickerOpener(openCoopLearnMoveBatchPickerInline);
