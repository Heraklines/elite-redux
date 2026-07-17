/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op MYSTERY-ENCOUNTER owner relay (#633, authoritative-only after M6).
//
// The OWNER of the current ME interaction relays its authoritative inputs over the
// reliable, FIFO-per-seq {@linkcode CoopInteractionRelay}:
//   - every MEANINGFUL button press ({@linkcode relayOwnerButton}; the UI layer calls it
//     ONLY when the handler was ready to consume it, never a cosmetic scroll-skip),
//   - the two TERMINALS: the LEAVE sentinel ({@linkcode endOwner}, the ME is over) and the
//     BATTLE-HANDOFF sentinel ({@linkcode relayMeBattleHandoff}, the option spawned a battle
//     that then runs host-authoritatively).
//
// The PEER side is NOT a pump: the authoritative guest is a pure renderer whose
// `CoopReplayMePhase` awaits the owner's picks / terminal directly on the relay (the
// M3 choice-forwarding model). The old LOCKSTEP WATCHER half - an injected engine
// replaying the owner's raw button stream into the peer's own live ME handlers
// (`beginWatcher` / `runWatcherLoop` / `CoopMePumpEngine`) - was retired with lockstep
// (M3) and physically deleted in M6: the renderer never runs the encounter engine, so
// there is nothing to replay buttons INTO.
//
// Engine-FREE, so the relay/session logic stays unit-testable headlessly over a
// LoopbackTransport, exactly like the other co-op relays.
// =============================================================================

import { coopLog, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import { COOP_INTERACTION_LEAVE, type CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import { setCoopMeHandoffBattleStarted } from "#data/elite-redux/coop/coop-me-pin-state";
// #840: COOP_ME_TERM_SEQ_BASE declared in coop-seq-registry (single source of truth), re-exported below.
import { COOP_ME_TERM_SEQ_BASE } from "#data/elite-redux/coop/coop-seq-registry";

export { COOP_ME_TERM_SEQ_BASE };

/** Routing tag for relayed ME buttons (distinguishes them on the wire / in logs). */
const ME_PUMP_KIND = "meBtn";
/**
 * Sentinel the OWNER relays when its option spawned a BATTLE (#633 ME battle handoff): tells the
 * peer to END its ME wait WITHOUT leaving the encounter, so the spawned battle runs (the host
 * drives it + streams the boss; the guest adopts + replays). Distinct from {@linkcode
 * COOP_INTERACTION_LEAVE} (which means "the ME ended, skip to the next wave"). Negative so it can
 * never collide with a real button code, and distinct from the other interaction sentinels.
 */
export const COOP_ME_BATTLE_HANDOFF = -1000;
/**
 * Co-op authoritative non-battle ME (#633 MAJOR-1): the HOST->GUEST terminal / battle-handoff
 * sentinel rides a DEDICATED seq `COOP_ME_TERM_SEQ_BASE + coopMeInteractionStart` so it can never
 * FIFO-collide with the guest->host option/sub-pick relay (which stays on `COOP_ME_PUMP_SEQ_BASE +
 * start`). Three disjoint seq channels: `8_000_000 + start` (guest->host picks + host present /
 * resync outcomes), `9_000_000 + start` (host->guest terminal / handoff), RAW `start` (reward shop).
 */

/**
 * Relays the ME owner's authoritative inputs over a {@linkcode CoopInteractionRelay}. One
 * instance per client. The phase opens a session with {@linkcode beginOwner} and closes it
 * with {@linkcode endOwner} (the LEAVE terminal) or {@linkcode relayMeBattleHandoff} (the
 * battle-handoff terminal); the UI layer calls {@linkcode relayOwnerButton} per meaningful
 * press. The peer consumes the stream in `CoopReplayMePhase`, never through this class.
 */
export class CoopMePump {
  private readonly relay: CoopInteractionRelay;

  private owner = false;
  private seq = -1;
  /**
   * Seq the OWNER sends its TERMINAL sentinels (LEAVE / battle-handoff) on (#633 MAJOR-1 / B-1):
   * the DEDICATED `COOP_ME_TERM_SEQ_BASE + start` (9M) channel, disjoint from the guest->host
   * pick/sub-pick relay (which stays on 8M), matching where the authoritative guest's
   * `CoopReplayMePhase.awaitHostTerminal` listens. Without this split the host's LEAVE/HANDOFF
   * buffered on 8M forever and the 9M guest waiter only resolved via the ~20-min disconnect
   * timeout (every authoritative non-battle ME hung the guest).
   */
  private termSeq = -1;
  private ended = true;

  constructor(relay: CoopInteractionRelay) {
    this.relay = relay;
  }

  /**
   * OWNER: begin relaying our buttons for ME interaction `seq`. Idempotent on an
   * already-active same-seq session (a nested option-select re-enters here).
   *
   * `termSeq` (#633 MAJOR-1 / B-1) is the seq the OWNER sends its TERMINAL sentinels
   * (LEAVE / battle-handoff) on - the dedicated `COOP_ME_TERM_SEQ_BASE + start` channel the
   * guest's `CoopReplayMePhase` awaits (disjoint from the 8M pick relay). Defaults to `seq`
   * so a caller with no terminal split still gets a coherent session.
   */
  beginOwner(seq: number, termSeq: number = seq): void {
    if (this.owner && this.seq === seq && !this.ended) {
      // Keep the terminal seq in sync on a nested re-entry (the start counter is stable, so this
      // is the same value, but never let a re-entry leave a stale termSeq behind).
      coopLog("pump", "beginOwner re-entry (same seq); refreshing termSeq", { seq, termSeq });
      this.termSeq = termSeq;
      return;
    }
    coopLog("pump", "begin OWNER session", { seq, termSeq });
    this.owner = true;
    this.seq = seq;
    this.termSeq = termSeq;
    this.ended = false;
  }

  /** Whether a pump session is open (the caller still gates this on the ME-interactive phase). */
  isSessionActive(): boolean {
    return this.owner && !this.ended;
  }

  /**
   * OWNER: relay one button the local human just pressed. The UI layer calls this ONLY
   * when the handler was READY to consume it (never a scroll-skip), so the peer's replay
   * consumes exactly one meaningful press per relay. No-op unless we own an active session.
   */
  relayOwnerButton(button: number): void {
    if (!this.isSessionActive()) {
      return;
    }
    if (isCoopDebug()) {
      coopLog("pump", "relay OWNER button", { seq: this.seq, kind: ME_PUMP_KIND, button });
    }
    this.relay.sendInteractionChoice(this.seq, ME_PUMP_KIND, button);
  }

  /**
   * OWNER (#633 ME battle handoff): the option just spawned a BATTLE. Relay the battle-handoff
   * sentinel so the peer ENDS its ME wait WITHOUT leaving the encounter, then end our own
   * session. The spawned battle then runs host-authoritatively on BOTH clients (the host streams
   * the boss, the guest adopts it; both flow through the normal host-drives / guest-replays
   * path). Unlike {@linkcode endOwner}, this does NOT mean the ME is over - the battle + its
   * reward shop still run; the interaction-counter advance happens at the TRUE ME terminal.
   */
  relayMeBattleHandoff(hostTurn?: number, sendRawTerminal = true): void {
    if (this.isSessionActive()) {
      coopLog("pump", "relay BATTLE-HANDOFF sentinel", {
        termSeq: this.termSeq,
        sentinel: COOP_ME_BATTLE_HANDOFF,
        hostTurn,
      });
      setCoopMeHandoffBattleStarted(); // #817: gates stand down - the spawned battle runs the normal sync
      // Terminal sentinel rides `termSeq` (#633 MAJOR-1 / B-1). #822: it CARRIES the host's
      // current battle turn so the guest's ME-battle boot aligns its turn space (the host
      // numbers ME-battle turns continuing the wave's count; a guest booting at turn 1 awaits
      // resolutions the host will never emit under that number - the 18:05 strand).
      if (sendRawTerminal) {
        this.relay.sendInteractionChoice(
          this.termSeq,
          ME_PUMP_KIND,
          COOP_ME_BATTLE_HANDOFF,
          hostTurn === undefined ? undefined : [hostTurn],
        );
      }
    }
    this.endSession();
  }

  /** OWNER: the ME reached its terminal - send the leave sentinel so the peer's ME wait ends. */
  endOwner(sendRawTerminal = true): void {
    if (this.isSessionActive()) {
      coopLog("pump", "OWNER terminal: relay LEAVE sentinel", {
        termSeq: this.termSeq,
        sentinel: COOP_INTERACTION_LEAVE,
      });
      // Terminal sentinel rides `termSeq` (#633 MAJOR-1 / B-1): the dedicated 9M terminal seq
      // the authoritative guest awaits (CoopReplayMePhase.awaitHostTerminal).
      if (sendRawTerminal) {
        this.relay.sendInteractionChoice(this.termSeq, ME_PUMP_KIND, COOP_INTERACTION_LEAVE);
      }
    }
    this.endSession();
  }

  /** Close the session (terminal / disconnect). */
  endSession(): void {
    coopLog("pump", "end session", { wasOwner: this.owner, seq: this.seq, termSeq: this.termSeq });
    this.ended = true;
    this.owner = false;
    this.termSeq = -1;
  }
}
