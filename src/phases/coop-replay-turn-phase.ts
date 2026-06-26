/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import { getCoopBattleStreamer, isCoopAuthoritativeGuest } from "#data/elite-redux/coop/coop-runtime";
import type { CoopBattleEvent } from "#data/elite-redux/coop/coop-transport";

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
export class CoopReplayTurnPhase extends Phase {
  public readonly phaseName = "CoopReplayTurnPhase";

  private readonly turn: number;

  constructor(turn: number) {
    super();
    this.turn = turn;
  }

  public override start(): void {
    super.start();
    const streamer = getCoopBattleStreamer();
    if (streamer == null) {
      // No live session (defensive): just end the turn so the run never hangs.
      coopWarn("replay", `guest replay turn=${this.turn}: no streamer -> finishTurnNoStream`);
      this.finishTurnNoStream();
      return;
    }
    coopLog("replay", `guest replay turn=${this.turn}: awaiting host resolution`);
    void streamer.awaitTurn(this.turn).then(res => {
      try {
        if (res != null) {
          // ANIMATE first: unshift a presentation phase per host event against the still-ALIVE
          // pre-turn field. These land FIFO on the tree level ABOVE this phase. The events are the
          // EXACTLY-ONCE merge of the LIVE channel (#633, animation layer) and the turn-end batch:
          // each was streamed live the instant the host recorded it (buffered by `(turn, seq)`), and
          // the batch is the same ordered list. seq N == batch index N (the recorder stamps one seq
          // per recorded event), so we de-dupe by index and render each event once, sourced from the
          // live channel when it arrived, else filled from the batch (a dropped / late live event
          // still renders). The checkpoint stays the final correction regardless, so any live gap
          // only stutters the animation - it can never desync.
          const liveEvents = streamer.consumeLiveEvents(this.turn);
          const merged = this.mergeLiveAndBatch(liveEvents, res.events);
          coopLog(
            "replay",
            `guest replay turn=${this.turn}: RESOLVE live=${liveEvents.length} batch=${res.events.length} merged=${merged.length}`,
          );
          this.renderEvents(merged);
          // Then unshift the END-OF-TURN finalize LAST (#633, animation-replay redesign). The
          // phase-tree FIFO guarantees it drains BEHIND every animation phase just unshifted, so
          // `applyCoopCheckpoint` (which leaveField's a host-fainted mon) runs only AFTER the faint
          // has animated. THE STRUCTURAL GUARANTEE: applyCoopCheckpoint runs ONLY in
          // CoopFinalizeTurnPhase, which is LAST on this tree level - it can never leaveField a mon
          // whose faint has not animated. Never collapse this back to a synchronous applyCoopCheckpoint.
          coopLog("replay", `guest replay turn=${this.turn}: unshift CoopFinalizeTurnPhase (checkpoint apply deferred)`);
          globalScene.phaseManager.unshiftNew(
            "CoopFinalizeTurnPhase",
            this.turn,
            res.checkpoint,
            res.checksum,
            res.preimage,
          );
          this.end();
          return;
        }
      } catch {
        // A bad stream payload must never hang the guest's turn.
        coopWarn("replay", `guest replay turn=${this.turn}: payload error -> finishTurnNoStream`);
      }
      // No resolution arrived (host stall) - end the turn defensively; the guest re-syncs on the
      // next checkpoint rather than hanging forever.
      coopWarn("replay", `guest replay turn=${this.turn}: ending without applied resolution (stall/payload-error) -> finishTurnNoStream`);
      this.finishTurnNoStream();
    });
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
  ): CoopBattleEvent[] {
    const liveBySeq = new Map<number, CoopBattleEvent>();
    for (const { seq, event } of live) {
      liveBySeq.set(seq, event);
    }
    const merged: CoopBattleEvent[] = [];
    // Render every batch POSITION exactly once, preferring the live-channel copy for that seq/index.
    for (let i = 0; i < batch.length; i++) {
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
    coopLog("replay", `guest replay turn=${this.turn}: rendering ${events.length} event(s)`);
    // Running per-mon hp so multi-hit drains chain (hit1: cur->hp1, hit2: hp1->hp2, ...). Seeded
    // lazily from the live (pre-checkpoint) hp the first time a mon is seen.
    const fromHpByBi = new Map<number, number>();
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
            pm.unshiftNew("CoopMoveAnimReplayPhase", event.bi, event.moveId, [...event.targets]);
            break;
          case "hp": {
            const seeded = fromHpByBi.has(event.bi)
              ? (fromHpByBi.get(event.bi) ?? event.hp)
              : (globalScene.getField()[event.bi]?.hp ?? event.hp);
            fromHpByBi.set(event.bi, event.hp);
            pm.unshiftNew("CoopHpDrainReplayPhase", event.bi, seeded, event.hp, event.maxHp);
            break;
          }
          case "statStage":
            pm.unshiftNew("CoopStatStageReplayPhase", event.bi, event.stat, event.value);
            break;
          case "status":
            pm.unshiftNew("CoopStatusReplayPhase", event.bi, event.status);
            break;
          case "faint":
            pm.unshiftNew("CoopFaintReplayPhase", event.bi);
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
        globalScene.currentBattle.incrementTurn();
        globalScene.phaseManager.dynamicQueueManager.clearLastTurnOrder();
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
