/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import { getCoopBattleStreamer } from "#data/elite-redux/coop/coop-runtime";
import type { CoopBattleEvent } from "#data/elite-redux/coop/coop-transport";
import {
  type CoopTurnSequencer,
  clearCoopTurnSequencer,
  registerCoopTurnSequencer,
} from "#data/elite-redux/coop/coop-turn-sequencer";

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
    // Open the per-turn presentation sequencer (#633, near-real-time replay). Seeded from the PRE-turn
    // field so a drain's "from" is the pre-turn hp (display-only, I2). It plays live events one-at-a-time
    // on the SCENE CLOCK while THIS phase stays PARKED, and owns renderedSeqs (the exactly-once authority).
    const seq = registerCoopTurnSequencer(this.turn, globalScene.getField());
    // Drain any events the host already streamed before we reached this phase (host-ahead race). The
    // coop-runtime live handler (wireCoopLiveRender) offers all FUTURE arrivals (it reads
    // getCoopTurnSequencer for this turn). peekLiveEvents does NOT consume - the turn-end consumeLiveEvents
    // still de-dupes the batch.
    for (const { seq: s, event } of streamer.peekLiveEvents(this.turn)) {
      seq.offer(s, event);
    }
    seq.kick();
    coopLog("replay", `guest replay turn=${this.turn}: sequencer kicked, awaiting host resolution`);

    // PARK: await the host's turn-end batch. The phase queue is FROZEN on this phase until the .then body
    // runs; the sequencer animates on the scene clock meanwhile. NO this.end() here.
    void streamer.awaitTurn(this.turn).then(async res => {
      try {
        if (res != null) {
          // The events are the EXACTLY-ONCE merge of the LIVE channel and the turn-end batch: seq N ==
          // batch index N (the recorder stamps one seq per recorded event). consumeLiveEvents de-dupes
          // the live channel against the batch; the sequencer's renderedSeqs then de-dupes what it
          // already played live from the batch-only remainder (I3).
          const liveEvents = streamer.consumeLiveEvents(this.turn);
          const merged = this.mergeLiveAndBatch(liveEvents, res.events);
          coopLog(
            "replay",
            `guest replay turn=${this.turn}: RESOLVE live=${liveEvents.length} batch=${res.events.length} merged=${merged.length}`,
          );
          // AWAIT the sequencer draining every received event up to the batch length BEFORE rendering any
          // batch-only remainder + unshifting the finalize. THIS is what lands the checkpoint in the SAME
          // synchronous burst AFTER all presentation (preserving the single-level checkpoint-last
          // guarantee, I1). The sequencer's overall turn deadline force-resolves this await so a stuck
          // mid-stream seq can never hang the finalize (I4).
          coopLog("replay", `guest replay turn=${this.turn}: awaiting sequencer drain (len=${merged.length})`);
          await seq.drained(merged.length);

          // --- ONE SYNCHRONOUS BURST from here (the checkpoint-last guarantee, structurally identical to
          // the pre-redesign path): unshift a presentation phase ONLY for seqs the sequencer did NOT play
          // (gaps / dropped live), ascending; then unshift the finalize LAST on the SAME fresh tree level;
          // then end. No await between here and end() -> no live offer can interleave (I3).
          this.renderUnrendered(merged, seq);
          coopLog("replay", `guest replay turn=${this.turn}: unshift CoopFinalizeTurnPhase (checkpoint last)`);
          globalScene.phaseManager.unshiftNew(
            "CoopFinalizeTurnPhase",
            this.turn,
            res.checkpoint,
            res.checksum,
            res.preimage,
          );
          seq.close();
          clearCoopTurnSequencer(this.turn);
          this.end();
          return;
        }
      } catch {
        // A bad stream payload must never hang the guest's turn.
        coopWarn("replay", `guest replay turn=${this.turn}: payload error -> finishTurnNoStream`);
      }
      // No resolution arrived (host stall) or a payload error - CLOSE the sequencer cleanly (stop pending
      // cosmetics + clear timers) so a no-batch turn finalizes via the EXISTING awaitTurn ceiling, no
      // worse than today (CORRECTION 2 / I4). The 30s sequencer deadline does NOT replace this ceiling.
      seq.close();
      clearCoopTurnSequencer(this.turn);
      coopWarn(
        "replay",
        `guest replay turn=${this.turn}: ending without applied resolution (stall/payload-error) -> finishTurnNoStream`,
      );
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
   * Render the BATCH-ONLY REMAINDER (#633, near-real-time replay): for each merged event the sequencer
   * did NOT already play live (a gap / dropped live seq, identified via the shared `renderedSeqs`
   * exactly-once authority, I3), UNSHIFT the matching PRESENTATION-ONLY phase so it replays at real pace.
   * Ascending index == ascending seq (the recorder stamps one seq per recorded event), so these unshifts
   * land in order on the SAME fresh tree level as the finalize unshift that follows, draining FIFO BEFORE
   * it - so the checkpoint is provably LAST (I1).
   *
   * This runs in the SAME synchronous burst as the finalize unshift, AFTER the sequencer drained, so the
   * live `mon.hp` is still the PRE-turn value (the live cosmetics left it byte-identical, I2) - baked into
   * each HP-drain phase as the "from". The checkpoint then snaps every field mon to the host's
   * authoritative values and captures the checksum. Presentation phases NEVER recompute / draw RNG.
   * weather / terrain / switch ride the checkpoint, so they are not animated here. Each unshift is guarded
   * so one garbled event can never hang the turn - the checkpoint still corrects its state.
   */
  private renderUnrendered(merged: CoopBattleEvent[], seq: CoopTurnSequencer): void {
    coopLog("replay", `guest replay turn=${this.turn}: rendering batch-only remainder of ${merged.length} event(s)`);
    // Running per-mon hp so multi-hit drains chain (hit1: cur->hp1, hit2: hp1->hp2, ...). Seeded lazily
    // from the live (pre-checkpoint) hp the first time a mon is seen.
    const fromHpByBi = new Map<number, number>();
    const pm = globalScene.phaseManager;
    for (let i = 0; i < merged.length; i++) {
      if (seq.renderedSeqs.has(i)) {
        continue; // already played live by the sequencer -> skip (exactly-once across the seam, I3)
      }
      seq.renderedSeqs.add(i);
      const event = merged[i];
      try {
        // HOT LOOP (per battle event): build the per-event trace only when debug is on.
        if (isCoopDebug()) {
          coopLog("replay", `guest replay turn=${this.turn}: present batch seq=${i} k=${event.k}`);
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
        coopWarn("replay", `guest replay turn=${this.turn}: garbled batch event k=${event.k} skipped`);
      }
    }
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
      globalScene.phaseManager.queueTurnEndPhases();
    } catch {
      // The turn-end queue is best-effort; a failure here must never hang the turn.
      coopWarn("replay", `guest replay turn=${this.turn}: queueTurnEndPhases failed`);
    }
    this.end();
  }
}
