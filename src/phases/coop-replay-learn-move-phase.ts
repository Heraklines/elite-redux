/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { allMoves } from "#data/data-lists";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import {
  armCoopLearnMoveIntentResend,
  type CoopLearnMoveOperationBinding,
  captureCoopLearnMoveOperationBinding,
  coopLearnMoveDecisionOperationId,
  isCoopLearnMoveAuthorityV2Active,
} from "#data/elite-redux/coop/coop-learn-move-operation";
import {
  clearCoopLearnMoveForwardInFlight,
  failCoopSharedSession,
  getCoopInteractionRelay,
  getCoopRuntime,
  getCoopUiMirror,
  notifyCoopV2InteractionSurfaceReady,
  setCoopLearnMovePickerOpener,
  settleCoopV2InteractionOperation,
} from "#data/elite-redux/coop/coop-runtime";
import {
  COOP_LEARN_MOVE_CHOICE_KINDS,
  COOP_LEARN_MOVE_FWD_SEQ_BASE,
  COOP_LEARN_MOVE_SEQ,
} from "#data/elite-redux/coop/coop-seq-registry";
import { UiMode } from "#enums/ui-mode";
import { SummaryUiMode } from "#ui/summary-ui-handler";

/** Routing tag for the guest->host relayed move-forget pick (distinguishes it on the wire / in logs). */
const LEARN_MOVE_CHOICE_KIND = "learnMove";

/**
 * INLINE move-forget picker (#787, the live TM Case stall): opens the picker OVER the current
 * screen the moment `learnMoveForward` arrives, with NO phase queued. The old phase spawn sat
 * BEHIND the guest's parked reward-shop WATCHER phase, which cannot end until the host finishes
 * the shop, which was itself awaiting this very pick - a circular wait broken only by the host's
 * 20-minute fallback ("it worked after a while"). `setModeWithoutClear` overlays the picker and
 * `revertMode` restores whatever screen was up (the parked shop) once the pick relays.
 */
export function openCoopLearnMovePickerInline(partySlot: number, moveId: number, maxMoveCount: number): void {
  const relay = getCoopInteractionRelay();
  const pokemon = globalScene.getPlayerParty()[partySlot];
  const seq = COOP_LEARN_MOVE_FWD_SEQ_BASE + partySlot;
  if (relay == null || pokemon == null) {
    coopWarn("learnmove", "inline picker: no relay / mon; skipping (host await falls back)", {
      partySlot,
      hasRelay: relay != null,
    });
    clearCoopLearnMoveForwardInFlight(partySlot);
    return;
  }
  const operationBinding = captureCoopLearnMoveOperationBinding("guest");
  coopLog("learnmove", "guest inline move-forget picker OPEN", { partySlot, moveId, maxMoveCount, seq });
  const move = allMoves[moveId];
  let settled = false;
  const finish = (moveIndex: number) => {
    if (settled) {
      return;
    }
    settled = true;
    getCoopUiMirror()?.endSession();
    clearCoopLearnMoveForwardInFlight(partySlot);
    coopLog("learnmove", "guest relays move-forget pick (inline)", { seq, kind: LEARN_MOVE_CHOICE_KIND, moveIndex });
    relay.sendInteractionChoice(seq, LEARN_MOVE_CHOICE_KIND, moveIndex);
    armCoopLearnMoveIntentResend(
      {
        payload: { type: "decision", partySlot, moveId, forgetSlot: moveIndex, maxMoveCount },
        wave: globalScene.currentBattle?.waveIndex ?? 0,
        turn: globalScene.currentBattle?.turn ?? 0,
        resend: () => relay.sendInteractionChoice(seq, LEARN_MOVE_CHOICE_KIND, moveIndex),
      },
      operationBinding,
    );
    // Restore whatever screen the picker overlaid (e.g. the parked shop watcher). #848: the picker is opened
    // with setModeWithoutClear WITHOUT chaining, so revertMode ONLY closes it when there IS a chained mode to
    // pop (the TM-Case parked shop). In a LEVEL-UP context (the batch-panel fallback) the modeChain is empty
    // -> revertMode resolves FALSE and does NOT close the picker (a strand). Force MESSAGE in that case so the
    // owner's forwarded picker can NEVER stay stuck.
    void Promise.resolve(globalScene.ui.revertMode())
      .then(reverted => {
        if (!reverted) {
          void globalScene.ui.setMode(UiMode.MESSAGE);
        }
      })
      .catch(() => globalScene.ui.setMode(UiMode.MESSAGE));
  };
  void globalScene.ui.setModeWithoutClear(UiMode.SUMMARY, pokemon, SummaryUiMode.LEARN_MOVE, move, finish).then(() => {
    getCoopUiMirror()?.beginSession("owner", UiMode.SUMMARY, COOP_LEARN_MOVE_SEQ);
  });
}

// Register with the session runtime (loaded at boot via the phase registry) so the
// learnMoveForward listener opens the picker INLINE instead of queueing a phase.
setCoopLearnMovePickerOpener(openCoopLearnMovePickerInline);

/**
 * Co-op AUTHORITATIVE move-learn REPLAY (#633 BUG3+5). The HOST is the sole battle engine, so for a
 * full-moveset GUEST-owned mon the host streams a `learnMoveForward` prompt and AWAITS the guest's
 * chosen forget-slot. On the LEVEL-UP path the guest never runs its own {@linkcode LearnMovePhase}
 * (its engine is parked in CoopReplayTurnPhase), so a persistent session listener
 * (`wireCoopLearnMoveForward` in coop-runtime) spawns THIS phase to render the picker and relay the
 * human's index back. It is the SINGLE renderer for both contexts: the guest's own (Shroom-queued)
 * LearnMovePhase is a no-op-end in authoritative mode, so the picker opens EXACTLY once per learn.
 *
 * Pure renderer + choice-forwarder, mirroring {@linkcode CoopReplayMePhase}:
 *  - It takes NO engine action (never calls `setMove`); the host applies the forget authoritatively and
 *    the guest's moveset converges via the next exp-delta / per-turn resync.
 *  - There is NO network await: the forward's scalars (slot / moveId / maxMoveCount) are read straight
 *    off the listener's message and passed to the constructor, so the phase opens the picker immediately.
 *    Its completion is driven by LOCAL human input or a B-cancel, both of which relay an index and end
 *    the phase, so it can NEVER hang. (The HOST's await of the relayed index has the finite fallback.)
 */
export class CoopReplayLearnMovePhase extends Phase {
  public readonly phaseName = "CoopReplayLearnMovePhase";
  /** Exact immutable presentation address required by the V2 public-control ledger. */
  public coopV2ControlOperationId: string | null;

  private readonly partySlot: number;
  private readonly moveId: number;
  private readonly maxMoveCount: number;
  /** Disjoint from the learn-move lockstep relay and the 9M ME terminal band; per-slot keyed. */
  private readonly seq: number;
  /** Set in {@linkcode relayAndEnd} so the picker resolves the forward EXACTLY once. */
  private settled = false;
  private operationBinding: CoopLearnMoveOperationBinding | null = null;
  private relay: CoopInteractionRelay | null = null;
  private readonly ownerIsGuest: boolean;
  private readonly coopOwningRuntime = getCoopRuntime();

  constructor(
    partySlot: number,
    moveId: number,
    maxMoveCount: number,
    operationId: string | null = null,
    ownerIsGuest = true,
  ) {
    super();
    this.partySlot = partySlot;
    this.moveId = moveId;
    this.maxMoveCount = maxMoveCount;
    this.seq = COOP_LEARN_MOVE_FWD_SEQ_BASE + partySlot;
    this.coopV2ControlOperationId = operationId;
    this.ownerIsGuest = ownerIsGuest;
  }

  /** Idempotently bind a redelivered presentation to this exact phase generation. */
  public installCoopV2LearnMovePresentation(
    operationId: string,
    partySlot: number,
    moveId: number,
    maxMoveCount: number,
    ownerIsGuest: boolean,
  ): boolean {
    if (
      partySlot !== this.partySlot
      || moveId !== this.moveId
      || maxMoveCount !== this.maxMoveCount
      || ownerIsGuest !== this.ownerIsGuest
      || operationId.length === 0
      || (this.coopV2ControlOperationId != null && this.coopV2ControlOperationId !== operationId)
    ) {
      return false;
    }
    this.coopV2ControlOperationId = operationId;
    notifyCoopV2InteractionSurfaceReady(this.coopOwningRuntime);
    return true;
  }

  public override start(): void {
    super.start();
    coopLog("learnmove", "guest CoopReplayLearnMovePhase start", {
      partySlot: this.partySlot,
      moveId: this.moveId,
      maxMoveCount: this.maxMoveCount,
      seq: this.seq,
    });

    const relay = getCoopInteractionRelay();
    const pokemon = globalScene.getPlayerParty()[this.partySlot];
    if (relay == null || pokemon == null) {
      // No live session / mon resolution failed (defensive): end so the run never hangs. The host's
      // own await times out to "keep current moves", so nothing is lost.
      coopWarn("learnmove", "no relay / mon at learn-move replay start; ending", {
        partySlot: this.partySlot,
        hasRelay: relay != null,
      });
      clearCoopLearnMoveForwardInFlight(this.partySlot);
      this.end();
      return;
    }
    this.operationBinding = captureCoopLearnMoveOperationBinding("guest");
    this.relay = relay;

    const move = allMoves[this.moveId];
    if (!this.ownerIsGuest) {
      void this.watchHostOwnedDecision(pokemon, move);
      return;
    }
    // Open the REAL interactive move-forget picker (the same shared #563 screen the lockstep owner
    // drives). beginSession("owner", ...) so the HOST mirrors this client's live cursor (cosmetic).
    void globalScene.ui
      .setModeWithoutClear(UiMode.SUMMARY, pokemon, SummaryUiMode.LEARN_MOVE, move, (moveIndex: number) => {
        // The summary returns the "new move" row (== the move cap) to signal "did not learn".
        this.relayAndEnd(moveIndex);
      })
      .then(() => {
        getCoopUiMirror()?.beginSession("owner", UiMode.SUMMARY, COOP_LEARN_MOVE_SEQ);
        notifyCoopV2InteractionSurfaceReady(this.coopOwningRuntime);
      });
  }

  /** Host-owned presentation: show the same picker read-only until the immutable result closes it. */
  private async watchHostOwnedDecision(
    pokemon: ReturnType<typeof globalScene.getPlayerParty>[number],
    move: (typeof allMoves)[number],
  ): Promise<void> {
    const relay = this.relay;
    if (relay == null) {
      failCoopSharedSession(`Learn-move watcher for slot ${this.partySlot} lost its relay`);
      return;
    }
    await globalScene.ui.setModeWithoutClear(UiMode.SUMMARY, pokemon, SummaryUiMode.LEARN_MOVE, move, () => {
      /* watcher: immutable result is the sole close authority */
    });
    getCoopUiMirror()?.beginSession("watcher", UiMode.SUMMARY, COOP_LEARN_MOVE_SEQ);
    notifyCoopV2InteractionSurfaceReady(this.coopOwningRuntime);
    const result = await relay.awaitInteractionChoice(this.seq, 1_200_000, COOP_LEARN_MOVE_CHOICE_KINDS);
    getCoopUiMirror()?.endSession();
    const expectedOperationId =
      this.coopV2ControlOperationId == null ? null : coopLearnMoveDecisionOperationId(this.coopV2ControlOperationId);
    if (
      isCoopLearnMoveAuthorityV2Active(this.operationBinding)
      && (expectedOperationId == null
        || result?.operationId !== expectedOperationId
        || !settleCoopV2InteractionOperation(expectedOperationId, this.coopOwningRuntime))
    ) {
      failCoopSharedSession(`Learn-move watcher for slot ${this.partySlot} could not settle its exact V2 result`);
      return;
    }
    clearCoopLearnMoveForwardInFlight(this.partySlot);
    void globalScene.ui.setMode(UiMode.MESSAGE).then(() => this.end());
  }

  /**
   * Relay the human's chosen forget-slot (or the "did not learn" sentinel) to the host (the sole
   * engine) and end. The guest takes NO engine action; the host applies the result and the guest's
   * moveset converges via the next exp-delta / resync. Runs EXACTLY once (guarded by `settled`).
   */
  private relayAndEnd(moveIndex: number): void {
    if (this.settled) {
      return;
    }
    this.settled = true;
    getCoopUiMirror()?.endSession();
    clearCoopLearnMoveForwardInFlight(this.partySlot);
    coopLog("learnmove", "guest relays move-forget pick", { seq: this.seq, kind: LEARN_MOVE_CHOICE_KIND, moveIndex });
    const relay = this.relay;
    const operationBinding = this.operationBinding;
    if (relay == null || operationBinding == null) {
      failCoopSharedSession(`Learn-move replay callback for slot ${this.partySlot} lost its captured guest binding`);
      return;
    }
    relay.sendInteractionChoice(this.seq, LEARN_MOVE_CHOICE_KIND, moveIndex);
    armCoopLearnMoveIntentResend(
      {
        payload: {
          type: "decision",
          partySlot: this.partySlot,
          moveId: this.moveId,
          forgetSlot: moveIndex,
          maxMoveCount: this.maxMoveCount,
        },
        wave: globalScene.currentBattle?.waveIndex ?? 0,
        turn: globalScene.currentBattle?.turn ?? 0,
        resend: () => relay.sendInteractionChoice(this.seq, LEARN_MOVE_CHOICE_KIND, moveIndex),
      },
      operationBinding,
    );
    if (isCoopLearnMoveAuthorityV2Active(operationBinding)) {
      const decisionOperationId =
        this.coopV2ControlOperationId == null ? null : coopLearnMoveDecisionOperationId(this.coopV2ControlOperationId);
      if (
        decisionOperationId == null
        || !settleCoopV2InteractionOperation(decisionOperationId, this.coopOwningRuntime)
      ) {
        failCoopSharedSession(`Learn-move replay for slot ${this.partySlot} lost its exact V2 result address`);
        return;
      }
    }
    void globalScene.ui.setMode(UiMode.MESSAGE).then(() => this.end());
  }
}
