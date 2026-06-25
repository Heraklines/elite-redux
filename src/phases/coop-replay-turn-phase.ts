/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { COOP_CHECKSUM_SENTINEL } from "#data/elite-redux/coop/coop-battle-checksum";
import {
  applyCoopCheckpoint,
  applyCoopFullSnapshot,
  captureCoopChecksum,
} from "#data/elite-redux/coop/coop-battle-engine";
import { getCoopBattleStreamer } from "#data/elite-redux/coop/coop-runtime";
import type { CoopBattleEvent, CoopFullBattleSnapshot } from "#data/elite-redux/coop/coop-transport";
import { decompressFromBase64 } from "lz-string";

/**
 * Co-op GUEST turn REPLAY (#633, TRACK-2 Phase B). The guest is a pure renderer: it
 * resolves nothing. Its {@linkcode TurnStartPhase} diverts here INSTEAD of queuing any
 * MovePhase / capture / enemy-AI resolution. This phase:
 *  1. Awaits the host's authoritative `turnResolution` for this turn (the host is the
 *     sole engine; it simulated the turn with the guest's relayed command).
 *  2. Narrates the ordered visible events the host streamed (MVP: `message` lines).
 *  3. Applies the host's post-turn CHECKPOINT so the field state matches EXACTLY, then
 *     verifies the full-state CHECKSUM and auto-resyncs on any residual drift (Phase A).
 *  4. Queues the guest's OWN turn-end phases + ends, so the run loops to the next turn.
 *
 * The guest draws no RNG and computes no outcome, so it cannot desync by construction.
 * A host stall resolves the await to null after the streamer's grace: the guest still
 * ends the turn (it re-syncs on the next checkpoint) rather than hanging forever.
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
      this.finishTurn();
      return;
    }
    void streamer.awaitTurn(this.turn).then(res => {
      try {
        if (res != null) {
          this.renderEvents(res.events);
          applyCoopCheckpoint(res.checkpoint);
          this.verifyChecksum(res.checksum);
        }
      } catch {
        // A bad stream payload must never hang the guest's turn.
      }
      this.finishTurn();
    });
  }

  /** Narrate the host's ordered visible events. MVP renders `message` lines verbatim. */
  private renderEvents(events: CoopBattleEvent[]): void {
    for (const event of events) {
      if (event.k === "message") {
        globalScene.phaseManager.queueMessage(event.text);
      }
      // Richer event kinds (moveUsed/hp/faint/statStage/...) are a later animation layer;
      // the checkpoint already carries the authoritative outcome, so they are optional.
    }
  }

  /**
   * Verify our post-apply full-state checksum against the host's; on a mismatch request +
   * adopt the host's full authoritative snapshot (Phase A auto-resync). A sentinel on
   * either side (a read failure) skips the comparison.
   */
  private verifyChecksum(hostChecksum: string): void {
    const streamer = getCoopBattleStreamer();
    if (streamer == null) {
      return;
    }
    const guestChecksum = captureCoopChecksum();
    if (hostChecksum === COOP_CHECKSUM_SENTINEL || guestChecksum === COOP_CHECKSUM_SENTINEL) {
      return;
    }
    if (hostChecksum === guestChecksum) {
      return;
    }
    console.warn(`[coop-desync] turn=${this.turn} host=${hostChecksum} guest=${guestChecksum}`);
    void streamer.requestStateSync(this.turn).then(blob => {
      if (blob == null) {
        return;
      }
      try {
        const snapshot = JSON.parse(decompressFromBase64(blob)) as CoopFullBattleSnapshot;
        applyCoopFullSnapshot(snapshot);
        const healed = captureCoopChecksum();
        if (healed === hostChecksum) {
          console.info(`[coop-resync] turn=${this.turn} ok`);
        } else {
          console.warn(`[coop-resync] turn=${this.turn} still-diverged host=${hostChecksum} guest=${healed}`);
        }
      } catch {
        /* a malformed resync blob must never crash the guest's battle */
      }
    });
  }

  /** Queue the guest's own end-of-turn phases (so the run loops) and end this phase. */
  private finishTurn(): void {
    globalScene.phaseManager.queueTurnEndPhases();
    this.end();
  }
}
