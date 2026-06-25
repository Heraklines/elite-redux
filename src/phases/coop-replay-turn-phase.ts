/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { COOP_CHECKSUM_SENTINEL, canonicalize } from "#data/elite-redux/coop/coop-battle-checksum";
import {
  applyCoopCheckpoint,
  applyCoopFullSnapshot,
  captureCoopChecksum,
  captureCoopChecksumState,
} from "#data/elite-redux/coop/coop-battle-engine";
import { logCanonicalDiff } from "#data/elite-redux/coop/coop-data-fingerprint";
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
          this.verifyChecksum(res.checksum, res.preimage);
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
   * either side (a read failure) skips the comparison. When the host streamed its canonical
   * `hostPreimage` (#633, diagnostics) we deep-DIFF it against ours to log the exact field(s)
   * that diverged - both at the initial mismatch and again if the snapshot fails to heal it.
   */
  private verifyChecksum(hostChecksum: string, hostPreimage?: string): void {
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
    // DIAGNOSTIC (#633): log WHICH field(s) diverged by deep-diffing the host's pre-image
    // (the canonical state its checksum hashed) against the guest's own. Only the opaque
    // hashes cross the wire normally; the pre-image makes the divergent field observable.
    const hostObj = this.parseCanonical(hostPreimage);
    if (hostObj !== undefined) {
      const guestObj = this.parseCanonical(canonicalize(captureCoopChecksumState()));
      logCanonicalDiff(`[coop-cs] turn=${this.turn}`, hostObj, guestObj);
    }
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
          // DIAGNOSTIC (#633): the snapshot did NOT heal the divergence - log WHAT it failed
          // to repair by diffing the host pre-image against the guest's POST-APPLY state.
          if (hostObj !== undefined) {
            const guestPostApplyObj = this.parseCanonical(canonicalize(captureCoopChecksumState()));
            logCanonicalDiff(`[coop-resync] turn=${this.turn} UNHEALED`, hostObj, guestPostApplyObj);
            console.warn(
              "[coop-resync] note: snapshot does NOT re-apply party/modifiers/arenaTags or force maxHp -"
                + " a diff in those is a data-table drift, not a heal bug",
            );
          }
        }
      } catch {
        /* a malformed resync blob must never crash the guest's battle */
      }
    });
  }

  /** Parse a canonical state string into a plain object, or undefined on absence/failure. */
  private parseCanonical(canonical: string | undefined): unknown {
    if (canonical === undefined) {
      return;
    }
    try {
      return JSON.parse(canonical);
    } catch {
      return;
    }
  }

  /** Queue the guest's own end-of-turn phases (so the run loops) and end this phase. */
  private finishTurn(): void {
    globalScene.phaseManager.queueTurnEndPhases();
    this.end();
  }
}
