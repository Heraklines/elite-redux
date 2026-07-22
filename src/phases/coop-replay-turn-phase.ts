/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import type { PhaseManager } from "#app/phase-manager";
import { isShowdownGuestFlipGated } from "#data/elite-redux/coop/coop-authoritative-gate";
import { terminateCoopAuthoritySession } from "#data/elite-redux/coop/coop-authority-terminal";
import { COOP_CHECKSUM_SENTINEL } from "#data/elite-redux/coop/coop-battle-checksum";
import {
  applyCoopAuthoritativeBattleState,
  applyCoopCheckpoint,
  applyCoopFieldSnapshot,
  captureCoopChecksum,
  coopAppliedStateTick,
  drainCoopApplyFailures,
  reapplyAcceptedCoopAuthoritativeBattleState,
} from "#data/elite-redux/coop/coop-battle-engine";
import type { CoopAuthorityFailure, CoopCheckpointEnvelope } from "#data/elite-redux/coop/coop-battle-stream";
import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import { hasPendingCoopFaintSwitchReplacementIntent } from "#data/elite-redux/coop/coop-faint-switch-operation";
import { beginCoopAuthoritativeProjectionSettlement } from "#data/elite-redux/coop/coop-presentation";
import {
  coopHasPendingWaveAdvance,
  coopLocalOwnedPlayerFieldSlot,
  coopRetainedGameOverSupersedesReplay,
  coopRetainedWinSupersedesReplay,
  coopSessionGeneration,
  coopWaveAdvanceSignaledFor,
  getCoopBattleStreamer,
  getCoopController,
  isCoopAuthoritativeGuest,
  registerCoopActiveReplayTurnAborter,
} from "#data/elite-redux/coop/coop-runtime";
import type { CoopBattleEvent } from "#data/elite-redux/coop/coop-transport";
import { swapBattleEvent } from "#data/elite-redux/showdown/showdown-side-swap";
import { coopNarrateMoveUsed } from "#phases/coop-replay-phases";

/**
 * Co-op GUEST turn REPLAY (#633, TRACK-2 Phase B). The guest is a pure renderer: it
 * resolves nothing. Its {@linkcode TurnStartPhase} diverts here INSTEAD of queuing any
 * MovePhase / capture / enemy-AI resolution. This phase:
 *  1. Awaits the host's authoritative `turnResolution` for this turn (the host is the
 *     sole engine; it simulated the turn with the guest's relayed command).
 *  2. ANIMATES the ordered visible events the host streamed (move anim, HP-bar drain, stat
 *     tween, faint cry+drop) by UNSHIFTING a presentation phase per event onto the queue -
 *     they drain FIFO against the still-ALIVE pre-turn field.
 *  3. UNSHIFTS a {@linkcode CoopFinalizeTurnPhase} LAST (#633, animation-replay redesign): it
 *     applies the host's post-turn CHECKPOINT, verifies the CHECKSUM (auto-resync on residual
 *     drift), then queues the guest's OWN turn-end phases + wave-advance + ends. The finalize
 *     phase being last on the tree level is the structural guarantee that the checkpoint can
 *     never leaveField a host-fainted mon BEFORE its faint has animated.
 *
 * The guest draws no RNG and computes no outcome, so it cannot desync by construction. The
 * checkpoint still re-asserts the host's exact end-of-turn state, so the per-turn checksum is
 * byte-identical to before the redesign. A host stall resolves the await to null after the
 * streamer's grace: the guest still ends the turn (it re-syncs on the next checkpoint) rather
 * than hanging forever.
 */
/**
 * #859 (phantom ME turn): the currently-RUNNING replay instance. A detached NON-battle ME terminal
 * ({@linkcode CoopReplayMePhase}.leaveDefensive) dissolves it via
 * {@linkcode abortActiveCoopReplayTurnPhase} when the watcher-shop LEAVE fell through into the ME
 * wave's leftover TurnInit/Command/TurnStart chain BEFORE the terminal fired - a parked pump
 * awaiting a battle the host never fights (`leaveEncounterWithoutBattle` clears only the QUEUE,
 * never the running phase, so without this the guest sleeps the full 20-min turn timeout while
 * the host plays the next wave alone - the maintainer's Delibird-gift wave-13/14 desync).
 */
let activeCoopReplayTurnPhase: CoopReplayTurnPhase | null = null;
const REPLACEMENT_RETRY_LIMIT = 3;
const REPLACEMENT_RETRY_TIMEOUT_MS = 2_000;
const REPLACEMENT_PRESENTATION_TIMEOUT_MS = 15_000;

export function abortActiveCoopReplayTurnPhase(reason: string): boolean {
  return activeCoopReplayTurnPhase?.abortPhantom(reason) ?? false;
}

export class CoopReplayTurnPhase extends Phase {
  public readonly phaseName = "CoopReplayTurnPhase";

  /**
   * The queue that created this async renderer pump. `pump()` crosses network/timer awaits before it
   * calls {@link end}; neither construction-time nor completion-time `globalScene` is a sound ownership
   * witness in the two-engine scheduler. The factory is the one boundary that knows which queue owns the
   * phase, so {@linkcode PhaseManager.create} binds it explicitly. Directly-constructed focused fixtures
   * retain the single-engine fallback in {@link end}.
   */
  private ownerPhaseManager: PhaseManager | null = null;
  private readonly turn: number;
  /** #782 live pump: how many event POSITIONS (seq 0..rendered-1) this turn has already presented. */
  private readonly rendered: number;
  /** #782 live pump: the per-mon hp chain carried ACROSS pump continuations (multi-hit drains). */
  private readonly fromHpByBi: Map<number, number>;
  /** #859: set by {@linkcode abortPhantom} - the pump ends WITHOUT finalize/turn-advance. */
  private aborted = false;
  /** One-shot wake while a failed replacement stays buffered awaiting a retransmission/newer frame. */
  private replacementRetryUnsubscribe: (() => void) | null = null;
  private replacementRetryCancelTimer: (() => void) | null = null;
  private replacementRetryAttempts = 0;
  private replacementRetryDeadline = 0;
  private authorityFailureUnsubscribe: (() => void) | null = null;
  private ended = false;
  /** Read-only browser-observer seam: true only after the exact turn waiter has been installed. */
  private awaitingAuthority = false;
  /** Immutable source wave for every event presented by this turn pump and its continuations. */
  private readonly sourceWave: number;

  constructor(turn: number, rendered = 0, hpChain?: [number, number][], sourceWave?: number) {
    super();
    this.turn = turn;
    this.rendered = rendered;
    this.fromHpByBi = new Map(hpChain ?? []);
    this.sourceWave = sourceWave ?? globalScene.currentBattle?.waveIndex ?? 0;
  }

  /** Bind this async phase to the exact phase tree that created it. */
  public bindOwnerPhaseManager(phaseManager: PhaseManager): this {
    this.ownerPhaseManager = phaseManager;
    return this;
  }

  /**
   * #859: dissolve this phase as a PHANTOM turn (a non-battle ME's leftover battle chain). Sets
   * the aborted flag FIRST, then wakes the parked pump by resolving its turn wait null - the
   * pump checks the flag before interpreting the null as a host stall, so it ends cleanly with
   * no finalize, no turn advance, and no re-queued CommandPhase; the queue rebuilt by
   * `leaveEncounterWithoutBattle` (the real next wave) then proceeds.
   */
  public abortPhantom(reason: string): boolean {
    if (this.aborted) {
      return true;
    }
    this.aborted = true;
    coopWarn("replay", `guest replay turn=${this.turn}: ABORT phantom turn (${reason}) - dissolving parked pump`);
    if (this.replacementRetryUnsubscribe != null) {
      this.clearReplacementRetryWake();
      this.end();
      return true;
    }
    getCoopBattleStreamer()?.abortTurnWait(this.turn, this.sourceWave);
    return true;
  }

  /**
   * A retained terminal may always dissolve a speculative later turn. It may dissolve the settled turn
   * itself only after this pump has drained every ordered live event and installed its authority wait:
   * GameOver never emits that normal turn-resolution carrier, so this exact wait is otherwise impossible.
   */
  public abortIfRetainedTerminalSuperseded(settledTurn: number, reason: string): boolean {
    if (this.turn > settledTurn || (this.turn === settledTurn && this.isAwaitingAuthority())) {
      return this.abortPhantom(reason);
    }
    // Deferred WON settlement (won-by-faint on the winning turn): the automatic victory boundary settles on
    // `sourceTurn + 1`, so this parked replay sits at the SOURCE turn = `settledTurn - 1`, one below the
    // numeric fence above yet equally superseded (a WON wave sends no turn-N resolution for it). Wake it too,
    // but ONLY while it is genuinely awaiting authority and a retained WON advance for the live wave confirms
    // the supersession (coopRetainedWinSupersedesReplay is gameOver-exclusive, so this never widens the
    // gameOver terminal path). The self-sourced pump fence is the guaranteed backstop; this is its prompt
    // external wake so the source-turn replay dissolves the instant the WAVE_ADVANCE lands.
    if (
      this.isAwaitingAuthority()
      && coopRetainedWinSupersedesReplay(globalScene.currentBattle?.waveIndex ?? 0, this.turn)
    ) {
      return this.abortPhantom(reason);
    }
    return false;
  }

  public override end(): void {
    this.ended = true;
    this.awaitingAuthority = false;
    this.clearReplacementRetryWake();
    this.authorityFailureUnsubscribe?.();
    this.authorityFailureUnsubscribe = null;
    if (activeCoopReplayTurnPhase === this) {
      activeCoopReplayTurnPhase = null;
    }
    (this.ownerPhaseManager ?? globalScene.phaseManager).shiftPhase();
  }

  /** Whether this renderer has installed the exact-address turn/live-event continuation wait. */
  public isAwaitingAuthority(): boolean {
    return this.awaitingAuthority && !this.aborted && !this.ended;
  }

  public override start(): void {
    super.start();
    activeCoopReplayTurnPhase = this;
    const streamer = getCoopBattleStreamer();
    if (streamer == null) {
      terminateCoopAuthoritySession(`No authority stream was available for turn ${this.turn}.`);
      return;
    }
    this.authorityFailureUnsubscribe = streamer.onAuthorityFailure(failure => {
      this.handleAuthorityFailure(streamer, failure);
    });
    const bufferedFailure = streamer.consumeAuthorityFailure();
    if (bufferedFailure != null) {
      this.handleAuthorityFailure(streamer, bufferedFailure);
      return;
    }
    // #790 (live post-resync strand): a DUPLICATE replay phase for an already-finalized turn
    // (a leftover pump continuation that a resync raced past) must never park - the host will
    // never resend that turn's resolution, and the legit instance already advanced the run.
    const wave = globalScene.currentBattle?.waveIndex ?? 0;
    // #790 kills a leftover DUPLICATE turn-resolution pump for an already-finalized turn (a resync raced
    // past; the host will never resend it). But a same-turn REPLACEMENT carrier legitimately shares the
    // finalized turn's number (the post-summon replacement is addressed at the faint's turn), and it is
    // ALREADY buffered locally awaiting consumption. Bailing on it strands the retained checkpoint, so
    // TurnInit's pendingAuthoritativeReplacementTurn re-defers here forever (a synchronous phase ping-pong
    // that overflows the stack and surfaces as a bogus materialRejected). Only bail when there is NO
    // consumable replacement carrier for this turn; otherwise fall through to the pump, whose fast path
    // consumes the buffered checkpoint synchronously.
    if (
      streamer.isTurnFinalized(wave, this.turn)
      && !streamer.hasConsumableReplacementForTurn(this.turn, this.sourceWave)
    ) {
      // Campaign run 29933294323 dirty lane: a same-turn OWN-faint replacement the guest just relayed
      // (its authoritative REPLACEMENT_COMMIT carrier still in-flight) is NOT a stale duplicate the host
      // will never resend - the carrier IS coming. Bailing here re-queues TurnInit -> TurnStart -> here
      // synchronously (the PhaseManager re-populates a fresh TurnInitPhase on the emptied queue) and grows
      // the JS stack until it overflows (guest RangeError -> both-seat command-owner timeout). Fall through
      // to the pump instead: its `awaitTurnOrLiveEvent` PARKS on the pending checkpoint waiter and applies
      // the replacement the moment its carrier lands. hasConsumableReplacementForTurn already covers the
      // BUFFERED carrier; this covers the IN-FLIGHT one (buffered-yet? no; coming? yes).
      if (hasPendingCoopFaintSwitchReplacementIntent(wave, this.turn)) {
        coopLog(
          "replay",
          `guest replay turn=${this.turn}: finalized but an own-faint replacement carrier is in-flight -> park (no stale bail)`,
        );
      } else {
        coopWarn("replay", `guest replay turn=${this.turn}: STALE duplicate (already finalized this wave) -> end`);
        this.end();
        return;
      }
    }
    if (this.rendered === 0) {
      coopLog("replay", `guest replay turn=${this.turn}: live pump start (awaiting host events/resolution)`);
    }
    void this.pump(streamer);
  }

  /**
   * #782 INSTANT STREAMING: present the host's events THE MOMENT they arrive instead of batching the
   * whole turn ("i only get animations after the host clicked through everything"). The host already
   * emits every event live (`battleEvent`, buffered by `(turn, seq)`); this pump drains the buffered
   * CONTIGUOUS run from the current watermark, unshifts the presentation phases + a CONTINUATION pump
   * (same phase, watermark advanced) and ends - phase-tree FIFO plays the animations, then re-enters
   * the pump for the next increment. When the turn RESOLUTION arrives, the remaining un-presented
   * positions render (live-sourced where buffered, batch-filled otherwise - the same exactly-once
   * merge as before, from the watermark) and the finalize phase is unshifted LAST, preserving the
   * structural guarantee that the checkpoint applies only after every animation drained.
   */
  private async pump(streamer: NonNullable<ReturnType<typeof getCoopBattleStreamer>>): Promise<void> {
    try {
      for (;;) {
        // #859: a detached ME terminal dissolved this phase as a PHANTOM turn (no host battle
        // exists) - end WITHOUT finalize/turn-advance so the rebuilt queue (next wave) runs.
        if (this.aborted) {
          coopWarn("replay", `guest replay turn=${this.turn}: phantom turn dissolved (#859) -> end without finalize`);
          this.end();
          return;
        }
        // 1) Present any contiguous live events buffered right now, then continue via a
        //    continuation phase so the presentations actually play before the next drain.
        const increment = streamer.consumeLiveEventsFrom(this.turn, this.rendered, this.sourceWave);
        if (increment.length > 0) {
          coopLog(
            "replay",
            `guest replay turn=${this.turn}: live increment seq=${this.rendered}..${this.rendered + increment.length - 1}`,
          );
          this.renderEvents(increment);
          globalScene.phaseManager.unshiftNew(
            "CoopReplayTurnPhase",
            this.turn,
            this.rendered + increment.length,
            [...this.fromHpByBi.entries()],
            this.sourceWave,
          );
          this.end();
          return;
        }
        // GameOver interrupts the host before its normal turn-finalization carrier is emitted. A retained
        // WAVE_ADVANCE can therefore arrive while this SAME-turn continuation is still queued behind the
        // final presentation phase. Once every ordered live event has drained, that exact admitted terminal
        // is the completion fence: waiting for a turnResolution here can never succeed. End into the
        // already-appended CoopWaveAdvanceBoundaryPhase; do not synthesize a finalize or advance a turn.
        const wave = globalScene.currentBattle?.waveIndex ?? 0;
        if (coopRetainedGameOverSupersedesReplay(wave, this.turn)) {
          coopWarn(
            "replay",
            `guest replay turn=${this.turn}: retained gameOver terminal supersedes unresolved replay at safe event boundary -> end`,
          );
          this.end();
          return;
        }
        // WON-WAVE sibling of the gameOver fence above: a retained WON WAVE_ADVANCE resolved this wave on
        // `settledTurn`; the host's resolution for that turn (and beyond) IS the advance, not a normal
        // turnResolution, so a replay awaiting one here hangs forever and the guest never reaches the next
        // wave's command frontier to install its rendezvous waiter (won-by-faint wave-2 launch deadlock,
        // runs 29895009334 / 29897908649 - the faint bumps the settled turn to 2, so the turn-2 replay IS
        // the settled turn). Buffer already drained above, so end into the queued wave-advance boundary.
        if (coopRetainedWinSupersedesReplay(wave, this.turn)) {
          coopWarn(
            "replay",
            `guest replay turn=${this.turn}: retained WON wave-advance supersedes phantom next-turn replay -> end`,
          );
          this.end();
          return;
        }
        // 2) Nothing buffered: race the host's resolution against the next live arrival.
        // Install the exact waiter before publishing readiness. A half-wiped/automatic guest has no
        // command UI to report, but this live replay pump is still the real next-turn continuation.
        // The dedicated surface cannot release an old/wrong address and never pretends input exists.
        const authorityWait = streamer.awaitTurnOrLiveEvent(this.turn, this.rendered, this.sourceWave);
        this.awaitingAuthority = true;
        streamer.notifyContinuationSurface("rendererWait");
        const raced = await authorityWait;
        this.awaitingAuthority = false;
        // #859: the abort wakes this park by resolving the turn wait null - check the flag
        // BEFORE the stall branch below can misread that null as a host stall.
        if (this.aborted) {
          coopWarn("replay", `guest replay turn=${this.turn}: phantom turn dissolved (#859) -> end without finalize`);
          this.end();
          return;
        }
        if (raced.kind === "live") {
          continue; // drain the fresh arrival(s) on the next loop iteration
        }
        if (raced.kind === "checkpoint") {
          // #633 guest-faint deadlock: the host auto-summoned a replacement into a fainted
          // player slot and pushed this OUT-OF-BAND checkpoint. Apply it NOW (parked = idle,
          // no animation in flight - a safe boundary) so the replacement materializes on the
          // guest; then, if the refilled slot is OURS and it has no command yet this turn,
          // open our own CommandPhase for it - the host's turn resolution cannot arrive
          // until we send that command.
          // Peek first. Consumption is the transaction COMMIT and is allowed only after every modern
          // companion applies with zero structured failures and its exact checksum converges.
          const envelope = streamer.peekCheckpointForTurn(this.turn, this.sourceWave);
          if (envelope != null) {
            const currentWave = globalScene.currentBattle?.waveIndex ?? 0;
            const checkpointWave = envelope.authoritativeState?.wave;
            const controller = getCoopController();
            const sameTurn = envelope.turn === this.turn;
            const exactNextTurnReplacement =
              envelope.reason === "replacement"
              && envelope.turn === this.turn + 1
              && envelope.epoch === controller?.sessionEpoch
              && envelope.wave === currentWave
              && checkpointWave === currentWave;
            const exactPriorTurnReplacement =
              envelope.reason === "replacement"
              && envelope.turn + 1 === this.turn
              && envelope.epoch === controller?.sessionEpoch
              && envelope.wave === currentWave
              && checkpointWave === currentWave;
            if (
              envelope.epoch !== controller?.sessionEpoch
              || envelope.wave !== currentWave
              || checkpointWave !== currentWave
              || (!sameTurn && !exactNextTurnReplacement && !exactPriorTurnReplacement)
            ) {
              // A replacement carrier can arrive after its turn already advanced through a win tail.
              // It is then obsolete, not an interaction for the next battle. The old unkeyed inbox let
              // that wave-N frame divert wave N+1's replay and skip its real resolution (PP/enemies stayed
              // pre-turn until a later heal). Drop it before ANY checkpoint/command-control side effect.
              coopWarn(
                "checkpoint",
                `guest discard OUT-OF-BAND checkpoint reason=${envelope.reason} wave=${checkpointWave} `
                  + `turn=${envelope.turn} while replaying wave=${currentWave} turn=${this.turn}`,
              );
              if (streamer.peekCheckpointForTurn(this.turn, this.sourceWave) === envelope) {
                streamer.consumeCheckpointForTurn(this.turn, this.sourceWave);
              }
              continue;
            }
            coopLog(
              "checkpoint",
              `guest apply OUT-OF-BAND checkpoint mid-park reason=${envelope.reason} turn=${this.turn}`,
            );
            if (!this.applyReplacementTransaction(envelope)) {
              this.parkForReplacementRetry(streamer, envelope);
              return;
            }
            if (!streamer.acknowledgeReplacement(envelope, "materialApplied")) {
              return;
            }
            const presentation = this.beginReplacementPresentation(streamer, envelope);
            // A destination-scoped headless oracle can prove the projection synchronously. Do not insert
            // an `await` in that branch: the two-engine harness swaps its process-global scene between
            // clients at microtask boundaries, so yielding after the exact same-scene proof would discard
            // the valid continuation. Production atlas settlement remains pending and keeps the deadline.
            const presentationReady = presentation.kind === "immediate" ? presentation.ready : await presentation.ready;
            if (!presentationReady) {
              this.failAuthority(
                streamer,
                "replacement",
                `Replacement renderer did not become presentation-ready for turn ${envelope.turn}.`,
                envelope,
              );
              return;
            }
            if (!streamer.acknowledgeReplacement(envelope, "presentationReady")) {
              return;
            }
            if (streamer.peekCheckpointForTurn(this.turn, this.sourceWave) !== envelope) {
              coopWarn(
                "checkpoint",
                `guest replacement converged but retained carrier changed before commit turn=${this.turn} -> remain held`,
              );
              this.parkForReplacementRetry(streamer, envelope);
              return;
            }
            streamer.consumeCheckpointForTurn(this.turn, this.sourceWave);
            streamer.retainAppliedOutOfBandCheckpoint(envelope);
            // A replacement checkpoint for N+1 is also the authoritative proof that the renderer has
            // crossed the numeric turn boundary. The normal V2 TURN path intentionally cannot advance
            // that cursor when its successor is a replacement rather than an immediate command surface.
            // Adopt it here before opening CommandPhase; otherwise the UI is visually on N+1 while
            // CommandPhase ships its proposal under stale turn N and the host waits forever.
            const liveTurn = globalScene.currentBattle.turn;
            if (liveTurn + 1 === envelope.turn) {
              globalScene.currentBattle.incrementTurn();
              globalScene.phaseManager.dynamicQueueManager.clearLastTurnOrder();
              coopLog("replay", `guest replacement adopted authoritative turn cursor ${liveTurn}->${envelope.turn}`);
            } else if (liveTurn !== envelope.turn && liveTurn !== envelope.turn + 1) {
              this.failAuthority(
                streamer,
                "replacement",
                `Replacement authority turn ${envelope.turn} cannot continue from live turn ${liveTurn}.`,
                envelope,
              );
              return;
            }
            // Showdown versus (Task F1): the versus guest owns its ENTIRE player field (a 1v1 -> field
            // slot 0). The co-op seat map used by coopLocalOwnedPlayerFieldSlot() resolves the fixed
            // GUEST slot (COOP_GUEST_FIELD_INDEX = 1), which is EMPTY in a 1v1 single battle - so the
            // co-op path never saw the refilled slot as OURS and never opened the guest's
            // post-replacement CommandPhase, leaving the guest parked in replay while the host awaited a
            // turn-N+1 command that could only arrive after a ~60s auto-pick timeout (the versus
            // faint-replacement stall). Branch at the CALL SITE exactly like
            // CoopFaintReplayPhase.maybeOpenOwnReplacementPicker (do NOT change the co-op seat map): the
            // versus guest's refilled own slot is its (single) active player field slot.
            const ownSlot = isShowdownGuestFlipGated()
              ? globalScene.getPlayerField().findIndex(m => m?.isActive() === true)
              : coopLocalOwnedPlayerFieldSlot();
            const ownMon = ownSlot < 0 ? undefined : globalScene.getPlayerField()[ownSlot];
            const hasLocalCommandSlot = ownSlot >= 0 && ownMon?.isActive() === true;
            // The live active slot is already conclusive ownership/liveness evidence. Consult the full
            // party only when no local actor is on the field, both avoiding unnecessary reconstruction
            // dependencies and distinguishing a legitimately wiped seat from a missed replacement.
            const hasLivingLocalMon =
              hasLocalCommandSlot
              || globalScene.getPlayerParty().some(mon => {
                if (mon == null || mon.isFainted()) {
                  return false;
                }
                const numericSeat = (mon as { coopOwnerSeatId?: number }).coopOwnerSeatId;
                return Number.isSafeInteger(numericSeat)
                  ? numericSeat === controller?.localSeatId
                  : (mon as { coopOwner?: string }).coopOwner === controller?.role;
              });
            const nextReplacement =
              envelope.authorityNextControl?.kind === "REPLACEMENT" ? envelope.authorityNextControl : null;
            if (nextReplacement != null) {
              // A same-turn multi-faint is one ordered transaction per summon. This intermediate carrier is
              // complete even though another field slot remains fainted: its immutable successor explicitly
              // authorizes that next PARTY picker. Never demand/open a command from this partial frontier.
              if (!streamer.acknowledgeReplacement(envelope, "continuationReady")) {
                return;
              }
              coopLog(
                "replay",
                `guest replacement rev=${envelope.authorityRevision ?? "?"} installed next picker `
                  + `${nextReplacement.operationId} (${nextReplacement.remaining.length} later)`,
              );
              continue;
            }
            if (!hasLocalCommandSlot && hasLivingLocalMon) {
              this.failAuthority(
                streamer,
                "replacement",
                `Replacement authority did not project into the local owner's command slot for turn ${envelope.turn}.`,
                envelope,
              );
              return;
            }
            // Track R depth lane (run 29654429335): on a MUTUAL-KO double faint (both player field
            // slots AND every enemy faint the SAME turn = the wave is WON) the host still auto-summons a
            // replacement into the surviving-owner's fainted slot and ships this out-of-band checkpoint,
            // then commits WAVE_ADVANCE. The refilled slot has NO next turn to command; opening a
            // CommandPhase here parks the guest in UiMode.COMMAND forever (host-liveness pending turn
            // commit) awaiting a turn the host, already advanced, never resolves, so the host's
            // WAVE_ADVANCE op continuation deadline expires -> "Durable operation recovery exhausted ...
            // continuation-timeout" terminal. Detect the won wave by the host's AUTHORITATIVE frame just
            // applied above (getEnemyParty NON-EMPTY and fully fainted - the exact signal
            // coopMeHandoffBattleWon uses; a trainer with living reserves is NOT all-fainted, so a
            // legitimate mid-wave replacement command is never suppressed) or an already-pending advance, and
            // fall through to ack the replacement continuation instead of opening a command. coop-runtime's
            // WIN unpark then dissolves the re-parked replay into the authoritative wave-advance tail. The
            // `length > 0` guard is load-bearing: an EMPTY enemy party (a pre-materialization / carrier
            // replay frame that has not yet installed the authoritative enemy party) makes `[].every()`
            // vacuously true, which would wrongly suppress the legitimate replacement command.
            const enemyParty = globalScene.getEnemyParty();
            // `waveWon` decides whether the just-refilled own slot opens a real command (continuing
            // wave) or holds for the authoritative wave-advance tail (won wave). The pending-advance
            // and live-all-fainted signals both MISS one real ordering: a WIN WAVE_ADVANCE that was
            // already ADMITTED AND CONSUMED (lastResolvedWave bumped, pendingWaveAdvance nulled)
            // before this replacement carrier's replay re-evaluates, while `getEnemyParty()` at that
            // instant is a pre-materialization frame that is not observably all-fainted. That combo
            // opened a PHANTOM command for the already-won turn; as a replica it parks forever on a
            // stale wave:turn the next-wave control never addresses -> the wave-2 command proof is
            // never produced and the session dies "material could not be applied exactly" (won-wave
            // faint replacement -> wave 2). `coopWaveAdvanceSignaledFor(sourceWave)` is the
            // already-resolved marker the sibling finishTurn suppressor (coop-replay-phases.ts)
            // already pairs with the pending check; use sourceWave (this replay's stable turn
            // identity) so a genuine mid-wave replacement (its wave unresolved) is never suppressed.
            // NOTE ON TEST COVERAGE: this exact ordering is real-browser-timing only. The in-process
            // two-engine harness applies checkpoints synchronously, so a coherent won-wave frame ALWAYS
            // has an all-fainted enemy image at eval time - the sibling all-fainted term already fires
            // and the coop-duo-won-wave-replacement test cannot produce the incoherent pre-materialization
            // frame that triggers THIS term. That synchronous masking is precisely why the bug reached
            // the live journey; the public-UI faint-replacement journey (won-wave route) is the designated
            // regression proof for this branch (RED: journey run 29884428440; GREEN after this fix).
            const waveWon =
              coopHasPendingWaveAdvance()
              || coopWaveAdvanceSignaledFor(this.sourceWave)
              || (enemyParty.length > 0 && enemyParty.every(mon => mon == null || mon.isFainted()));
            if (
              ownSlot >= 0
              && hasLocalCommandSlot
              && !waveWon
              && globalScene.currentBattle.turnCommands[ownSlot] == null
            ) {
              if (
                !streamer.registerReplacementContinuation(envelope, {
                  kind: "command",
                  epoch: envelope.epoch,
                  wave: envelope.wave,
                  turn: envelope.turn,
                })
              ) {
                return;
              }
              coopLog(
                "replay",
                `guest replay turn=${this.turn}: replacement filled OUR slot ${ownSlot} -> opening own CommandPhase`,
              );
              // Track R barrier / turn-commit softlock: this parked replay armed `requestTurnCommit(turn)`
              // (passively awaiting the host's turn resolution). We are now PIVOTING to command our own
              // refilled slot - the guest PRODUCES this turn's command; it does not passively await it. Cancel
              // the premature request so the guest stops pinging `requestTurnCommit -> turnCommitPending` at the
              // host (which is correctly awaiting OUR command). The re-queued CoopReplayTurnPhase below re-arms
              // the await legitimately AFTER the command is broadcast.
              streamer.cancelPendingTurnCommitRequests(envelope.epoch, envelope.wave, envelope.turn);
              globalScene.phaseManager.unshiftNew("CommandPhase", ownSlot);
              globalScene.phaseManager.unshiftNew(
                "CoopReplayTurnPhase",
                this.turn,
                this.rendered,
                [...this.fromHpByBi.entries()],
                this.sourceWave,
              );
              this.end();
              return;
            }
            if (!hasLocalCommandSlot) {
              coopLog(
                "replay",
                `guest replay turn=${this.turn}: local seat has no living command actor after replacement `
                  + "-> watcher-only continuation",
              );
            }
            // Either the wave is already WON (no next player turn - see above; the held replay drains into
            // the authoritative WAVE_ADVANCE tail) OR a delayed/rejoined carrier arrived after this exact
            // owner's public command was already committed. Ack the replacement continuation; the command
            // record / won wave is stronger evidence than reopening a duplicate menu.
            if (waveWon) {
              // Cancel the passive-await turn-commit request the same way the command pivot does: the host
              // has advanced past this turn and will never resolve it, so the ping would otherwise retry.
              streamer.cancelPendingTurnCommitRequests(envelope.epoch, envelope.wave, envelope.turn);
              coopLog(
                "replay",
                `guest replay turn=${this.turn}: replacement filled OUR slot ${ownSlot} on a WON wave `
                  + "-> ack continuation, hold for the wave-advance tail (NOT a phantom command)",
              );
            }
            if (!streamer.acknowledgeReplacement(envelope, "continuationReady")) {
              return;
            }
            if (waveWon && coopHasPendingWaveAdvance()) {
              // Message-order A (WAVE_ADVANCE landed BEFORE this checkpoint): coop-runtime already queued the
              // safe-boundary CoopWaveAdvanceBoundaryPhase behind us. Re-parking (continue -> awaitTurn) would
              // strand that boundary forever. END so it becomes current and runs the authoritative tail.
              // Message-order B (checkpoint first): pending is false here, so we fall through to `continue` and
              // re-park; coop-runtime's WIN unpark then dissolves that park when the WAVE_ADVANCE lands.
              coopLog(
                "replay",
                `guest replay turn=${this.turn}: WON-wave advance already pending -> end into the queued wave-advance boundary`,
              );
              this.end();
              return;
            }
          }
          continue;
        }
        if (raced.kind === "superseded") {
          // The same numeric turn was opened at a newer immutable wave/epoch
          // while this old continuation was still parked. That is cancellation
          // of obsolete renderer work, not missing host authority. A detached
          // old phase must not shift the newer phase manager queue when its
          // promise resumes.
          coopWarn(
            "replay",
            `guest replay turn=${this.turn} sourceWave=${this.sourceWave}: superseded by a newer address -> dissolve`,
          );
          this.retireSupersededWait();
          return;
        }
        if (raced.res == null) {
          const failure = streamer.consumeAuthorityFailure();
          if (failure == null) {
            this.failAuthority(streamer, "turnResolution", `Turn ${this.turn} authority was unavailable.`);
          } else {
            this.handleAuthorityFailure(streamer, failure);
          }
          return;
        }
        // 3) Resolution: render the REMAINING positions (exactly-once merge from the watermark -
        // live-sourced where buffered, batch-filled for anything the live channel dropped), then
        // unshift the END-OF-TURN finalize LAST (#633, animation-replay redesign). The phase-tree
        // FIFO guarantees it drains BEHIND every presentation phase just unshifted, so
        // `applyCoopCheckpoint` (which leaveField's a host-fainted mon) runs only AFTER the faint
        // has animated. THE STRUCTURAL GUARANTEE: applyCoopCheckpoint runs ONLY in
        // CoopFinalizeTurnPhase, LAST on this tree level. Never collapse this back to a
        // synchronous applyCoopCheckpoint.
        const live = streamer.consumeLiveEvents(this.turn, this.sourceWave);
        // #822 / Track R cycle 13 (duplicate-replay double-render): merge from the SHARED per-turn render
        // watermark, not just THIS instance's `rendered`. A duplicate replay phase (its own `rendered=0`,
        // spawned by the ME-battle boot and resolving BEFORE the real instance's finalize marks the turn
        // finalized) whose live events were already drained+deleted would otherwise batch-refill the whole
        // turn again -> double-applied damage/stat stages -> stable enemyParty divergence. Render only the
        // positions past the highest already rendered by ANY phase for this turn; the checkpoint still
        // corrects residual state, and a post-resync re-baseline resets the watermark (fresh turn address).
        const renderedThrough = Math.max(this.rendered, streamer.renderedThroughForTurn(this.turn, this.sourceWave));
        const remaining = this.mergeLiveAndBatch(live, raced.res.events, renderedThrough);
        streamer.noteRenderedThrough(this.turn, raced.res.events.length, this.sourceWave);
        coopLog(
          "replay",
          `guest replay turn=${this.turn}: RESOLVE renderedLive=${renderedThrough} remaining=${remaining.length} batch=${raced.res.events.length}`,
        );
        this.renderEvents(remaining);
        coopLog("replay", `guest replay turn=${this.turn}: unshift CoopFinalizeTurnPhase (checkpoint apply deferred)`);
        globalScene.phaseManager.unshiftNew(
          "CoopFinalizeTurnPhase",
          this.turn,
          raced.res.checkpoint,
          raced.res.checksum,
          raced.res.preimage,
          raced.res.fullField,
          raced.res.authoritativeState,
          raced.res.epoch,
          raced.res.wave,
          raced.res.revision,
          raced.res.authorityNextControl,
          raced.res.authorityRevision,
        );
        this.end();
        return;
      }
    } catch (error) {
      coopWarn("replay", `guest replay turn=${this.turn}: payload error -> authority terminal`, error);
      this.failAuthority(streamer, "turnResolution", `Turn ${this.turn} authority replay failed.`);
    }
  }

  /** Retire an obsolete async continuation without shifting an unrelated newer queue. */
  private retireSupersededWait(): void {
    if (globalScene.phaseManager.getCurrentPhase() === this) {
      this.end();
      return;
    }
    this.ended = true;
    this.awaitingAuthority = false;
    this.clearReplacementRetryWake();
    this.authorityFailureUnsubscribe?.();
    this.authorityFailureUnsubscribe = null;
    if (activeCoopReplayTurnPhase === this) {
      activeCoopReplayTurnPhase = null;
    }
  }

  private handleAuthorityFailure(
    streamer: NonNullable<ReturnType<typeof getCoopBattleStreamer>>,
    failure: CoopAuthorityFailure,
  ): void {
    const generation = coopSessionGeneration();
    streamer.scheduleAuthorityRetry(() => {
      if (generation !== coopSessionGeneration() || getCoopBattleStreamer() !== streamer) {
        return;
      }
      terminateCoopAuthoritySession(failure.reason);
    }, 0);
  }

  private failAuthority(
    streamer: NonNullable<ReturnType<typeof getCoopBattleStreamer>>,
    boundary: "turnResolution" | "replacement",
    reason: string,
    address?: Pick<CoopCheckpointEnvelope, "epoch" | "wave" | "turn" | "revision">,
  ): void {
    // An awaited frame may resolve while teardown is restoring another scene/runtime in the one-process
    // harness (and the same race exists during a real navigation). Never route an obsolete continuation
    // through the next scene's terminal UI.
    if (this.ended || getCoopBattleStreamer() !== streamer) {
      return;
    }
    const controller = getCoopController();
    const generation = coopSessionGeneration();
    if (controller == null) {
      return;
    }
    const wave = globalScene?.currentBattle?.waveIndex ?? 0;
    void streamer
      .broadcastAuthorityFailure({
        epoch: address?.epoch ?? controller.sessionEpoch,
        wave: address?.wave ?? wave,
        turn: address?.turn ?? this.turn,
        ...(address == null ? {} : { revision: address.revision }),
        boundary,
        reason,
      })
      .then(() => {
        if (generation === coopSessionGeneration() && getCoopBattleStreamer() === streamer) {
          terminateCoopAuthoritySession(reason);
        }
      });
  }

  private clearReplacementRetryWake(): void {
    this.replacementRetryUnsubscribe?.();
    this.replacementRetryUnsubscribe = null;
    this.replacementRetryCancelTimer?.();
    this.replacementRetryCancelTimer = null;
  }

  /**
   * Keep the failed frame retained and hold the current safe boundary without spinning. A transport
   * retransmission (including the same tick pair) or a newer replacement frame wakes the exact production
   * pump and retries transactionally. The stream scheduler bounds a lost response; exhaustion terminates
   * shared play visibly. There is intentionally no auto-command fallback; protocol 33 clears only the
   * exact retained replacement revision after its apply+checksum ACK.
   */
  private parkForReplacementRetry(
    streamer: NonNullable<ReturnType<typeof getCoopBattleStreamer>>,
    failed: CoopCheckpointEnvelope,
  ): void {
    if (this.replacementRetryUnsubscribe != null) {
      return;
    }
    if (this.replacementRetryDeadline === 0) {
      this.replacementRetryDeadline = streamer.authorityNow() + REPLACEMENT_RETRY_LIMIT * REPLACEMENT_RETRY_TIMEOUT_MS;
    }
    if (this.replacementRetryAttempts >= REPLACEMENT_RETRY_LIMIT) {
      this.terminateReplacementRecovery(
        `replacement authority failed after ${this.replacementRetryAttempts} complete retransmit attempt(s)`,
        failed,
      );
      return;
    }
    this.replacementRetryAttempts++;
    coopWarn(
      "checkpoint",
      `guest retained unconverged replacement checkpointTick=${failed.checkpoint.tick ?? "legacy"} `
        + `stateTick=${failed.authoritativeState?.tick ?? "missing"}; command remains closed `
        + `requesting retransmission attempt=${this.replacementRetryAttempts}/${REPLACEMENT_RETRY_LIMIT}`,
    );
    this.replacementRetryUnsubscribe = streamer.onCheckpointEnvelope(next => {
      if (this.aborted || next.reason !== "replacement") {
        return;
      }
      this.clearReplacementRetryWake();
      coopLog(
        "checkpoint",
        `guest retry replacement transaction checkpointTick=${next.checkpoint.tick ?? "legacy"} `
          + `stateTick=${next.authoritativeState?.tick ?? "missing"}`,
      );
      void this.pump(streamer);
    });
    const generation = coopSessionGeneration();
    const onRetryTimeout = (): void => {
      // A timer created by an old session, or firing while the one-process duo harness has another client
      // installed as the active runtime/globalScene, must not mutate or terminate that other client.
      if (this.aborted || this.ended || generation !== coopSessionGeneration()) {
        return;
      }
      if (getCoopBattleStreamer() !== streamer || globalScene.phaseManager.getCurrentPhase() !== this) {
        this.replacementRetryCancelTimer = streamer.scheduleAuthorityRetry(onRetryTimeout, 25);
        return;
      }
      if (streamer.authorityNow() >= this.replacementRetryDeadline) {
        this.clearReplacementRetryWake();
        this.failAuthority(streamer, "replacement", `Replacement authority failed for turn ${this.turn}.`, failed);
        return;
      }
      this.clearReplacementRetryWake();
      coopWarn(
        "checkpoint",
        `guest replacement retransmit attempt=${this.replacementRetryAttempts} timed out after `
          + `${REPLACEMENT_RETRY_TIMEOUT_MS}ms`,
      );
      this.parkForReplacementRetry(streamer, failed);
    };
    this.replacementRetryCancelTimer = streamer.scheduleAuthorityRetry(onRetryTimeout, REPLACEMENT_RETRY_TIMEOUT_MS);
    // Subscribe and arm the timeout before requesting: LoopbackTransport may deliver in the next microtask,
    // and a response must be able to cancel every wake resource deterministically.
    streamer.requestReplacementCheckpoint(failed);
  }

  /** Bound an unreconstructible replacement with a visible terminal, never an indefinite parked phase. */
  private terminateReplacementRecovery(reason: string, failed: CoopCheckpointEnvelope): void {
    this.clearReplacementRetryWake();
    const streamer = getCoopBattleStreamer();
    if (streamer == null) {
      terminateCoopAuthoritySession(reason);
      return;
    }
    this.failAuthority(streamer, "replacement", reason, failed);
  }

  /**
   * Apply one complete replacement frame and prove exact convergence before control can reopen. This is a
   * control/consumption transaction, not a rollback-capable data transaction: lower-level appliers may have
   * mutated state before reporting failure, so a same-frame retry explicitly reasserts the accepted state.
   */
  private applyReplacementTransaction(envelope: CoopCheckpointEnvelope): boolean {
    const state = envelope.authoritativeState;
    const fullField = envelope.fullField;
    const checkpointTick = envelope.checkpoint.tick;
    const stateTick = state?.tick;
    if (
      envelope.reason !== "replacement"
      || !Number.isSafeInteger(checkpointTick)
      || (checkpointTick as number) <= 0
      || !Number.isSafeInteger(stateTick)
      || (stateTick as number) <= (checkpointTick as number)
      || !Array.isArray(fullField)
      || fullField.length === 0
      || envelope.checksum === COOP_CHECKSUM_SENTINEL
    ) {
      coopWarn(
        "checkpoint",
        `guest rejected incomplete replacement frame reason=${envelope.reason} `
          + `checkpointTick=${checkpointTick ?? "missing"} stateTick=${stateTick ?? "missing"} `
          + `fullField=${fullField?.length ?? 0} checksum=${envelope.checksum}`,
      );
      return false;
    }

    try {
      const admittedBefore = coopAppliedStateTick();
      if (
        admittedBefore > (stateTick as number)
        || (admittedBefore > (checkpointTick as number) && admittedBefore < (stateTick as number))
      ) {
        coopWarn(
          "checkpoint",
          `guest replacement ticks ${checkpointTick}/${stateTick} conflict with lastApplied=${admittedBefore}`,
        );
        return false;
      }

      // A failed first attempt may already have admitted one or both ticks. Retry the same pair
      // idempotently, reasserting the authoritative state rather than treating it as permanently stale.
      const checkpointAlreadyApplied =
        admittedBefore === (checkpointTick as number) || admittedBefore === (stateTick as number);
      const checkpointApplied = checkpointAlreadyApplied || applyCoopCheckpoint(envelope.checkpoint);
      const admittedAfterCheckpoint = coopAppliedStateTick();
      const authoritativeAlreadyApplied = admittedAfterCheckpoint === (stateTick as number);
      const authoritativeApplied =
        checkpointApplied
        && (authoritativeAlreadyApplied
          ? reapplyAcceptedCoopAuthoritativeBattleState(state, isCoopAuthoritativeGuest())
          : applyCoopAuthoritativeBattleState(state, isCoopAuthoritativeGuest()));
      if (authoritativeApplied) {
        applyCoopFieldSnapshot(fullField, isCoopAuthoritativeGuest());
      }
      const failures = drainCoopApplyFailures();
      const guestChecksum = captureCoopChecksum();
      const converged =
        checkpointApplied
        && authoritativeApplied
        && failures.length === 0
        && guestChecksum !== COOP_CHECKSUM_SENTINEL
        && guestChecksum === envelope.checksum;
      if (converged) {
        coopLog(
          "checkpoint",
          `guest replacement transaction COMMIT host=guest=${guestChecksum} `
            + `checkpoint=${checkpointAlreadyApplied ? "reused" : "applied"} `
            + `state=${authoritativeAlreadyApplied ? "reasserted" : "applied"}`,
        );
        return true;
      }
      coopWarn(
        "checkpoint",
        `guest replacement transaction NOT converged checkpointApplied=${checkpointApplied} `
          + `authoritativeApplied=${authoritativeApplied} failures=${failures.length} `
          + `host=${envelope.checksum} guest=${guestChecksum}`,
      );
    } catch (error) {
      coopWarn("checkpoint", "guest replacement transaction threw; frame retained", error);
    }
    return false;
  }

  private beginReplacementPresentation(
    streamer: NonNullable<ReturnType<typeof getCoopBattleStreamer>>,
    envelope: CoopCheckpointEnvelope,
  ): ReturnType<typeof beginCoopAuthoritativeProjectionSettlement> {
    const generation = coopSessionGeneration();
    const presentation = beginCoopAuthoritativeProjectionSettlement(envelope.authoritativeState);
    const remainsExactBoundary = (ready: boolean): boolean =>
      ready
      && !this.aborted
      && !this.ended
      && generation === coopSessionGeneration()
      && getCoopBattleStreamer() === streamer
      && activeCoopReplayTurnPhase === this;
    if (presentation.kind === "immediate") {
      return { kind: "immediate", ready: remainsExactBoundary(presentation.ready) };
    }
    return {
      kind: "pending",
      ready: new Promise(resolve => {
        let settled = false;
        let cancelDeadline: () => void = () => {};
        const finish = (ready: boolean): void => {
          if (settled) {
            return;
          }
          settled = true;
          cancelDeadline();
          // The replay pump has its own exact active-instance fence. Use it instead of the phase
          // manager's current pointer: production can temporarily expose a presentation child during
          // an awaited atlas load. A newer replay, abort, end, session replacement, or streamer
          // replacement invalidates this completion before it can ACK presentationReady.
          resolve(remainsExactBoundary(ready));
        };
        const scheduledCancel = streamer.scheduleAuthorityRetry(
          () => finish(false),
          REPLACEMENT_PRESENTATION_TIMEOUT_MS,
        );
        if (settled) {
          scheduledCancel();
        } else {
          cancelDeadline = scheduledCancel;
        }
        void presentation.ready.then(
          ready => finish(ready),
          () => finish(false),
        );
      }),
    };
  }

  /**
   * EXACTLY-ONCE merge of the LIVE-channel events and the turn-end BATCH (#633, animation layer LIVE).
   * The host streams each visible event live the instant it records it, stamped with a per-turn
   * monotonic `seq`; the turn-end `turnResolution` carries the SAME ordered events as a batch, where
   * INVARIANT seq N == batch index N (the recorder stamps one seq per recorded event). So we render
   * each event POSITION exactly once, in order, sourced from the live channel when that seq arrived
   * (already buffered + de-duped + order-tolerant by the streamer) and FILLED from the batch when it
   * did not (a dropped / late live event still renders). Any extra live seq beyond the batch length
   * (an out-of-band event the batch somehow lacks) is appended after, so nothing the host sent is lost.
   * The result is the ordered list the animation pump replays; the checkpoint then corrects all state.
   */
  private mergeLiveAndBatch(
    live: { seq: number; event: CoopBattleEvent }[],
    batch: CoopBattleEvent[],
    fromIndex = 0,
  ): CoopBattleEvent[] {
    const liveBySeq = new Map<number, CoopBattleEvent>();
    for (const { seq, event } of live) {
      liveBySeq.set(seq, event);
    }
    const merged: CoopBattleEvent[] = [];
    // Render every REMAINING batch POSITION exactly once, preferring the live-channel copy for that
    // seq/index. Positions < fromIndex were already presented live by the pump (#782) - skip them.
    for (let i = fromIndex; i < batch.length; i++) {
      merged.push(liveBySeq.get(i) ?? batch[i]);
      liveBySeq.delete(i);
    }
    // Append any live seqs the batch did not cover (defensive: out-of-band events), in seq order.
    const extraSeqs = [...liveBySeq.keys()].sort((a, b) => a - b);
    if (extraSeqs.length > 0) {
      coopWarn("replay", `guest replay turn=${this.turn}: ${extraSeqs.length} live event(s) beyond batch appended`);
    }
    for (const seq of extraSeqs) {
      merged.push(liveBySeq.get(seq) as CoopBattleEvent);
    }
    return merged;
  }

  /**
   * Drive the host's ordered visible events as an AWAITED animation pump (#633, animation layer):
   * for each event in order, UNSHIFT the matching PRESENTATION-ONLY phase so it replays at real pace
   * when the queue drains - the move animation, the HP-bar drain, the stat tween, the status anim, the
   * faint cry+drop. All unshifted in event order land on the SAME queue level and drain FIFO (phase-tree
   * semantics), so the guest WATCHES the fight in order instead of reading a silent summary.
   *
   * CRITICAL ORDERING (no desync): this runs BEFORE `applyCoopCheckpoint` in the caller, so the live
   * `mon.hp` here is still the PRE-turn value - it is baked into each HP-drain phase as the "from" so the
   * bar visibly drains to the host's value. The checkpoint then snaps every field mon to the host's
   * authoritative values INLINE (the source of truth, unchanged), and the checksum is captured at that
   * same instant - BEFORE any of these presentation phases play. Each phase ENDS at the host's value
   * (idempotent with the checkpoint), so the animations can never leave drift for the next turn's
   * checksum. Presentation phases NEVER recompute / draw RNG and NEVER run a real
   * MovePhase/MoveEffectPhase/FaintPhase/StatStageChangePhase. weather / terrain / switch ride the
   * checkpoint, so they are not animated here. Each unshift is guarded so one garbled event can never
   * hang the turn - the checkpoint still corrects its state.
   */
  private renderEvents(events: CoopBattleEvent[]): void {
    // SHOWDOWN (Task F1): reflect every bi-bearing event into the versus guest's LOCAL orientation so the
    // replay phases animate the correct sprites (a missed bi = a move/hp/faint on the wrong side). Swapped
    // at RENDER time (the guest's own context), covering both the live per-event and batched paths that
    // merge into here. No-op off the versus-guest path.
    if (isShowdownGuestFlipGated()) {
      events = events.map(swapBattleEvent);
    }
    coopLog("replay", `guest replay turn=${this.turn}: rendering ${events.length} event(s)`);
    // Running per-mon hp so multi-hit drains chain (hit1: cur->hp1, hit2: hp1->hp2, ...). Seeded
    // lazily from the live (pre-checkpoint) hp the first time a mon is seen. INSTANCE state (#782):
    // the chain is carried across live-pump continuations via the ctor, so an increment boundary
    // mid-multi-hit never re-seeds from the (not-yet-checkpointed) live hp and jumps the bar.
    const fromHpByBi = this.fromHpByBi;
    const pm = globalScene.phaseManager;
    // Per-turn tally of the presentation phases unshifted, so the guest's log shows the exact
    // replay-phase sequence it ran for this turn (move/hp/stat/status/faint/message counts).
    const tally: Record<string, number> = {};
    for (const [eventOffset, event] of events.entries()) {
      tally[event.k] = (tally[event.k] ?? 0) + 1;
      try {
        // HOT LOOP (per battle event): build the per-event trace only when debug is on.
        if (isCoopDebug()) {
          coopLog("replay", `guest replay turn=${this.turn}: present k=${event.k}`);
        }
        switch (event.k) {
          case "message":
            pm.queueMessage(event.text);
            break;
          case "moveUsed":
            // #691 (host-language leak): regenerate "X used Y!" in the GUEST'S language BEFORE unshifting
            // the move-anim phase. The host suppressed streaming its own (host-language) useMove message,
            // so this queueMessage is the sole source of the line. The regenerated line lands at the
            // moveUsed position (one slot after the original message position - adjacent, cosmetic).
            coopNarrateMoveUsed(event.bi, event.moveId);
            pm.unshiftNew("CoopMoveAnimReplayPhase", event.bi, event.moveId, [...event.targets]);
            break;
          case "hp": {
            const seeded = fromHpByBi.has(event.bi)
              ? (fromHpByBi.get(event.bi) ?? event.hp)
              : (globalScene.getField()[event.bi]?.hp ?? event.hp);
            fromHpByBi.set(event.bi, event.hp);
            pm.unshiftNew("CoopHpDrainReplayPhase", event.bi, seeded, event.hp, event.maxHp, event.sp);
            break;
          }
          case "statStage":
            pm.unshiftNew("CoopStatStageReplayPhase", event.bi, event.stat, event.value);
            break;
          case "status":
            pm.unshiftNew("CoopStatusReplayPhase", event.bi, event.status);
            break;
          case "faint":
            // #691 (host-language leak): pass the `narrate` flag so the faint phase regenerates the
            // "X fainted!" line in the GUEST'S language ONLY for KOs the host actually narrated (a real
            // FaintPhase ran, i.e. `!ignoreFaintPhase`). Older host (no `narrate`) -> falsy -> no line.
            pm.unshiftNew("CoopFaintReplayPhase", event.bi, event.narrate === true, event.sp, {
              wave: this.sourceWave,
              turn: this.turn,
              // The existing stream seq is identical to the event's turn-resolution batch index.
              // `this.rendered` is this continuation's exact starting watermark.
              occurrence: this.rendered + eventOffset,
            });
            break;
          default:
            // weather / terrain / switch ride the authoritative checkpoint, not the animation pump.
            break;
        }
      } catch {
        // A garbled event must never hang the guest's turn; the checkpoint still corrects its state.
        coopWarn("replay", `guest replay turn=${this.turn}: garbled event k=${event.k} skipped`);
      }
    }
    const breakdown = Object.entries(tally)
      .map(([k, n]) => `${k}=${n}`)
      .join(" ");
    coopLog("replay", `guest replay turn=${this.turn}: rendered phases [${breakdown || "none"}]`);
  }
}

registerCoopActiveReplayTurnAborter(
  (reason, settledTurn) => activeCoopReplayTurnPhase?.abortIfRetainedTerminalSuperseded(settledTurn, reason) ?? false,
);
