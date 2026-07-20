/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { initMoveAnim, loadMoveAnimAssets } from "#data/battle-anims";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import {
  armCoopLearnMoveBatchIntentResend,
  captureCoopLearnMoveOperationBinding,
  coopLearnMoveDecisionOperationId,
  isCoopLearnMoveAuthorityV2Active,
} from "#data/elite-redux/coop/coop-learn-move-operation";
import {
  clearCoopLearnMoveBatchInFlight,
  failCoopSharedSession,
  getCoopInteractionRelay,
  getCoopRuntime,
  getCoopUiMirror,
  notifyCoopV2InteractionSurfaceReady,
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
    notifyCoopV2InteractionSurfaceReady(this.coopOwningRuntime);
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
        mirror?.endSession();
        const { choice, data } = encodeCoopLearnMoveBatchTerminal(learned);
        coopLog("learnmove", "guest relays owned-mon batch terminal (#848)", { seq, count: choice });
        relay.sendInteractionChoice(seq, LEARN_MOVE_BATCH_CHOICE_KIND, choice, data);
        armCoopLearnMoveBatchIntentResend(
          {
            payload: {
              type: "decision",
              partySlot,
              assignments: learned.map(([moveId, slotIndex]) => [moveId, slotIndex]),
              fallback: false,
            },
            wave: globalScene.currentBattle?.waveIndex ?? 0,
            turn: globalScene.currentBattle?.turn ?? 0,
            resend: () => relay.sendInteractionChoice(seq, LEARN_MOVE_BATCH_CHOICE_KIND, choice, data),
          },
          operationBinding,
        );
        if (isCoopLearnMoveAuthorityV2Active(operationBinding)) {
          const decisionOperationId =
            phase.coopV2ControlOperationId == null
              ? null
              : coopLearnMoveDecisionOperationId(phase.coopV2ControlOperationId);
          if (
            decisionOperationId == null
            || !settleCoopV2InteractionOperation(decisionOperationId, phase.owningRuntime())
          ) {
            failCoopSharedSession(`Guest batch learn result for slot ${partySlot} lost its exact V2 address`);
            return;
          }
        }
        closePanel();
      },
      fallback: () => {
        if (settled) {
          return;
        }
        settled = true;
        mirror?.endSession();
        coopWarn("learnmove", "guest batch panel fallback -> relay FALLBACK terminal (host uses per-move) (#848)", {
          seq,
        });
        relay.sendInteractionChoice(seq, LEARN_MOVE_BATCH_CHOICE_KIND, COOP_LEARN_MOVE_BATCH_FALLBACK);
        armCoopLearnMoveBatchIntentResend(
          {
            payload: { type: "decision", partySlot, assignments: [], fallback: true },
            wave: globalScene.currentBattle?.waveIndex ?? 0,
            turn: globalScene.currentBattle?.turn ?? 0,
            resend: () =>
              relay.sendInteractionChoice(seq, LEARN_MOVE_BATCH_CHOICE_KIND, COOP_LEARN_MOVE_BATCH_FALLBACK),
          },
          operationBinding,
        );
        if (isCoopLearnMoveAuthorityV2Active(operationBinding)) {
          const decisionOperationId =
            phase.coopV2ControlOperationId == null
              ? null
              : coopLearnMoveDecisionOperationId(phase.coopV2ControlOperationId);
          if (
            decisionOperationId == null
            || !settleCoopV2InteractionOperation(decisionOperationId, phase.owningRuntime())
          ) {
            failCoopSharedSession(`Guest batch fallback for slot ${partySlot} lost its exact V2 address`);
            return;
          }
        }
        closePanel();
      },
    };
    void globalScene.ui.setModeWithoutClear(UiMode.LEARN_MOVE_BATCH, deps).then(() => {
      mirror?.beginSession("owner", UiMode.LEARN_MOVE_BATCH, seq);
      notifyCoopV2InteractionSurfaceReady(phase.owningRuntime());
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
    mirror?.beginSession("watcher", UiMode.LEARN_MOVE_BATCH, seq);
    notifyCoopV2InteractionSurfaceReady(phase.owningRuntime());
  });
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
