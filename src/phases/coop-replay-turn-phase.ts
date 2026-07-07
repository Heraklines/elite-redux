/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { isShowdownGuestFlipGated } from "#data/elite-redux/coop/coop-authoritative-gate";
import { applyCoopAuthoritativeBattleState, applyCoopCheckpoint } from "#data/elite-redux/coop/coop-battle-engine";
import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import {
  coopHasPendingWaveAdvance,
  coopLocalOwnedPlayerFieldSlot,
  coopMeHandoffBattleWon,
  getCoopBattleStreamer,
  isCoopAuthoritativeGuest,
  queueCoopMeBattleVictoryTail,
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

export function abortActiveCoopReplayTurnPhase(reason: string): boolean {
  return activeCoopReplayTurnPhase?.abortPhantom(reason) ?? false;
}

export class CoopReplayTurnPhase extends Phase {
  public readonly phaseName = "CoopReplayTurnPhase";

  private readonly turn: number;
  /** #782 live pump: how many event POSITIONS (seq 0..rendered-1) this turn has already presented. */
  private readonly rendered: number;
  /** #782 live pump: the per-mon hp chain carried ACROSS pump continuations (multi-hit drains). */
  private readonly fromHpByBi: Map<number, number>;
  /** #859: set by {@linkcode abortPhantom} - the pump ends WITHOUT finalize/turn-advance. */
  private aborted = false;

  constructor(turn: number, rendered = 0, hpChain?: [number, number][]) {
    super();
    this.turn = turn;
    this.rendered = rendered;
    this.fromHpByBi = new Map(hpChain ?? []);
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
    getCoopBattleStreamer()?.abortTurnWait(this.turn);
    return true;
  }

  public override end(): void {
    if (activeCoopReplayTurnPhase === this) {
      activeCoopReplayTurnPhase = null;
    }
    super.end();
  }

  public override start(): void {
    super.start();
    activeCoopReplayTurnPhase = this;
    const streamer = getCoopBattleStreamer();
    if (streamer == null) {
      // No live session (defensive): just end the turn so the run never hangs.
      coopWarn("replay", `guest replay turn=${this.turn}: no streamer -> finishTurnNoStream`);
      this.finishTurnNoStream();
      return;
    }
    // #790 (live post-resync strand): a DUPLICATE replay phase for an already-finalized turn
    // (a leftover pump continuation that a resync raced past) must never park - the host will
    // never resend that turn's resolution, and the legit instance already advanced the run.
    const wave = globalScene.currentBattle?.waveIndex ?? 0;
    if (streamer.isTurnFinalized(wave, this.turn)) {
      coopWarn("replay", `guest replay turn=${this.turn}: STALE duplicate (already finalized this wave) -> end`);
      this.end();
      return;
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
        const increment = streamer.consumeLiveEventsFrom(this.turn, this.rendered);
        if (increment.length > 0) {
          coopLog(
            "replay",
            `guest replay turn=${this.turn}: live increment seq=${this.rendered}..${this.rendered + increment.length - 1}`,
          );
          this.renderEvents(increment);
          globalScene.phaseManager.unshiftNew("CoopReplayTurnPhase", this.turn, this.rendered + increment.length, [
            ...this.fromHpByBi.entries(),
          ]);
          this.end();
          return;
        }
        // 2) Nothing buffered: race the host's resolution against the next live arrival.
        const raced = await streamer.awaitTurnOrLiveEvent(this.turn, this.rendered);
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
          const envelope = streamer.consumeCheckpoint();
          if (envelope != null) {
            coopLog(
              "checkpoint",
              `guest apply OUT-OF-BAND checkpoint mid-park reason=${envelope.reason} turn=${this.turn}`,
            );
            if (applyCoopCheckpoint(envelope.checkpoint)) {
              applyCoopAuthoritativeBattleState(envelope.authoritativeState, isCoopAuthoritativeGuest());
            }
            const ownSlot = coopLocalOwnedPlayerFieldSlot();
            const ownMon = ownSlot == null ? undefined : globalScene.getPlayerField()[ownSlot];
            if (
              ownSlot != null
              && ownMon?.isActive() === true
              && globalScene.currentBattle.turnCommands[ownSlot] == null
            ) {
              coopLog(
                "replay",
                `guest replay turn=${this.turn}: replacement filled OUR slot ${ownSlot} -> opening own CommandPhase`,
              );
              globalScene.phaseManager.unshiftNew("CommandPhase", ownSlot);
              globalScene.phaseManager.unshiftNew("CoopReplayTurnPhase", this.turn, this.rendered, [
                ...this.fromHpByBi.entries(),
              ]);
              this.end();
              return;
            }
          }
          continue;
        }
        if (raced.res == null) {
          // No resolution arrived (host stall) - end the turn defensively; the guest re-syncs on
          // the next checkpoint rather than hanging forever.
          coopWarn(
            "replay",
            `guest replay turn=${this.turn}: ending without applied resolution (stall) -> finishTurnNoStream`,
          );
          this.finishTurnNoStream();
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
        const live = streamer.consumeLiveEvents(this.turn);
        const remaining = this.mergeLiveAndBatch(live, raced.res.events, this.rendered);
        coopLog(
          "replay",
          `guest replay turn=${this.turn}: RESOLVE renderedLive=${this.rendered} remaining=${remaining.length} batch=${raced.res.events.length}`,
        );
        this.renderEvents(remaining);
        streamer.markTurnFinalized(globalScene.currentBattle?.waveIndex ?? 0, this.turn);
        coopLog("replay", `guest replay turn=${this.turn}: unshift CoopFinalizeTurnPhase (checkpoint apply deferred)`);
        globalScene.phaseManager.unshiftNew(
          "CoopFinalizeTurnPhase",
          this.turn,
          raced.res.checkpoint,
          raced.res.checksum,
          raced.res.preimage,
          raced.res.fullField,
          raced.res.authoritativeState,
        );
        this.end();
        return;
      }
    } catch {
      // A bad stream payload must never hang the guest's turn.
      coopWarn("replay", `guest replay turn=${this.turn}: payload error -> finishTurnNoStream`);
      this.finishTurnNoStream();
    }
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
    for (const event of events) {
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
            pm.unshiftNew("CoopFaintReplayPhase", event.bi, event.narrate === true, event.sp);
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

  /**
   * Defensive end-of-turn when NO host resolution is available (no live streamer, or the host
   * stalled past the streamer's grace). There is no checkpoint to apply here, so we never reach
   * {@linkcode CoopFinalizeTurnPhase}; just queue the guest's own turn-end phases so the run loops,
   * then end. The guest re-syncs on the next checkpoint rather than hanging forever. A pending
   * wave-advance (if any) is left for the next turn's finalize phase to consume (it is one-shot +
   * wave-guarded), so it is never lost.
   */
  private finishTurnNoStream(): void {
    coopLog("replay", `guest replay turn=${this.turn}: finishTurnNoStream (queue turn-end, no checkpoint)`);
    try {
      // BUG1 (faint auto-switch premature-victory deadlock): same hazard as CoopFinalizeTurnPhase. This
      // is the host-stall fallback (awaitTurn resolved null). If the host stalls on the exact turn an
      // hp=1 enemy survives, running the REAL damaging turn-end phases lets the authoritative guest
      // LOCALLY faint that enemy -> a premature local VictoryPhase / BattleEnd -> the same deadlock. So
      // on the authoritative guest advance the turn MINIMALLY (the guest re-syncs on the next
      // checkpoint); victory only ever arrives via the host's waveResolved. Solo / host / lockstep keep
      // the original turn-end run. (CoopReplayTurnPhase is guest-only; the gate is for symmetry and so a
      // future lockstep guest is unaffected.)
      if (isCoopAuthoritativeGuest()) {
        // #847 ME battle-handoff WIN (host-stall fallback): the host's ME-battle win emits NO waveResolved
        // (VictoryPhase's isMysteryEncounter branch returns first), so coopHasPendingWaveAdvance is false
        // here even though the ME battle is over. Detect it directly and run the ME victory tail (reward
        // shop) instead of a phantom turn - otherwise a host stall on the ME battle's final turn strands
        // the guest with no reward transition.
        if (coopMeHandoffBattleWon()) {
          queueCoopMeBattleVictoryTail();
        } else if (!coopHasPendingWaveAdvance()) {
          // #698 softlock: do NOT advance the turn when a wave-advance is already PENDING (the host has won
          // the wave). Incrementing here would start a phantom turn N+1 the host already passed -> the guest
          // then awaits a turn-N+1 resolution the host (now in the reward shop) never sends -> softlock right
          // after the battle. This is the same hazard the streamed finishTurn guards via
          // coopHasPendingWaveAdvance; mirror it here. With an advance pending, end the turn flat - the
          // host's pending waveResolved drives the post-battle tail on the next finalize / checkpoint resync.
          globalScene.currentBattle.incrementTurn();
          globalScene.phaseManager.dynamicQueueManager.clearLastTurnOrder();
        }
      } else {
        globalScene.phaseManager.queueTurnEndPhases();
      }
    } catch {
      // The turn-end queue is best-effort; a failure here must never hang the turn.
      coopWarn("replay", `guest replay turn=${this.turn}: queueTurnEndPhases failed`);
    }
    this.end();
  }
}
