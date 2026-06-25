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
import { consumeCoopPendingWaveAdvance, getCoopBattleStreamer } from "#data/elite-redux/coop/coop-runtime";
import type { CoopBattleEvent, CoopFullBattleSnapshot } from "#data/elite-redux/coop/coop-transport";
import { BattlerIndex } from "#enums/battler-index";
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

  /**
   * Queue the guest's own end-of-turn phases (so the run loops) and end this phase. If the host
   * signaled this wave RESOLVED (#633, authoritative wave-advance), also run the normal victory
   * tail AFTER the turn-end phases drain - this is the SAFE boundary (the in-flight replay turn
   * has finished here, never mid-replay).
   */
  private finishTurn(): void {
    globalScene.phaseManager.queueTurnEndPhases();
    // The turn-end phases were pushed to the back of the queue above; pushing the victory tail
    // here runs it AFTER they drain (the in-flight turn finishes first, per the Oracle ordering).
    this.maybeRunCoopWaveAdvance();
    this.end();
  }

  /**
   * GUEST (#633, authoritative wave-advance handshake): if the host told us this wave RESOLVED
   * (win / capture / gameOver), run the SAME post-battle tail lockstep co-op runs - queue
   * `VictoryPhase` exactly as `FaintPhase`/`AttemptCapturePhase` do (faint-phase.ts:189). That
   * tail runs BattleEnd -> the alternation-relayed reward shop -> biome -> `NewBattlePhase` ->
   * the next `EncounterPhase` (-> `adoptCoopHostEnemyParty` for wave N+1), so the guest reaches
   * the next wave instead of looping the won wave forever. A pure renderer never queues this
   * tail itself (it removes KOd enemies without a FaintPhase). One-shot + wave-guarded by
   * {@linkcode consumeCoopPendingWaveAdvance}; a duplicate `waveResolved` is a no-op. Fully
   * guarded so a missing-pokemon edge can never hang the guest.
   */
  private maybeRunCoopWaveAdvance(): void {
    const pending = consumeCoopPendingWaveAdvance();
    if (pending == null) {
      return;
    }
    // Only WIN / CAPTURE advance to a NEXT wave via the victory tail. `gameOver` (run end) and
    // `flee` are terminal / not-yet-rendered on the pure guest; consuming them above still bumps
    // the wave guard, so they are a safe no-op here (the full guest game-over render is a TODO).
    if (pending.outcome !== "win" && pending.outcome !== "capture") {
      return;
    }
    try {
      // VictoryPhase reads exp off the resolved mon. After the checkpoint reconcile the KOd
      // enemies are off-field but still present in the enemy party, so address one by its `id`
      // (>3 -> getPokemonById, which finds an off-field party member) - never a dead field slot.
      // Fall back to the player lead's battler index when no enemy party member remains
      // (e.g. a capture that cleared the slot), so getPokemon() always resolves a live mon.
      const lastEnemy = globalScene.getEnemyParty().at(-1);
      const battlerArg = lastEnemy == null ? BattlerIndex.PLAYER : lastEnemy.id;
      globalScene.phaseManager.pushNew("VictoryPhase", battlerArg);
    } catch {
      // The victory tail is best-effort; a failure here must never hang the guest's run.
    }
  }
}
