/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op battle command relay (#633, LIVE-C). The transport-level half of the
// host-authoritative battle: the partner's field-slot command travels over the
// CoopTransport instead of being picked by a local AI.
//
//   HOST  (authoritative engine): for the PARTNER slot, instead of resolving the
//         move with a local bot, it sends a `commandRequest` carrying the LEGAL
//         move slots it computed, and AWAITS the peer's `command` reply.
//   PEER  (the real guest live, or the SpoofGuest in dev/tests): answers the
//         request by picking one of the offered slots and replying with a
//         `command`. It never needs the engine - the host did the legality work.
//
// The host never trusts the peer with engine state: it only accepts a slot index
// it itself offered. A missing/slow reply resolves to `null` after a timeout so
// the caller falls back to the AI picker and the turn never hangs.
//
// Engine-FREE (transport + the wire types only), so the whole relay is unit-
// testable headlessly over a LoopbackTransport with a spoof responder - the same
// protocol then runs unchanged over the real WebRTC transport.
// =============================================================================

import type { CoopMessage, CoopTransport, SerializedCommand } from "#data/elite-redux/coop/coop-transport";

/** The inbound request a responder answers (the legal move slots the host offers). */
export interface CoopCommandRequest {
  fieldIndex: number;
  turn: number;
  /** Indices into the partner mon's moveset that are legal this turn (empty => Struggle). */
  moveSlots: number[];
}

/** Turns a {@linkcode CoopCommandRequest} into the command to send back. */
export type CoopCommandResponder = (req: CoopCommandRequest) => SerializedCommand;

/** Options for {@linkcode CoopBattleSync}. */
export interface CoopBattleSyncOptions {
  /** Per-request timeout before {@linkcode CoopBattleSync.requestPartnerCommand}
   *  resolves null (the caller then falls back to AI). Default 20min. */
  timeoutMs?: number;
  /** Timer injection (tests). Returns a cancel fn. Defaults to setTimeout/clearTimeout. */
  schedule?: (cb: () => void, ms: number) => () => void;
}

// Wait up to 20 MINUTES for the real partner's move before the AI takes over (#633).
// The AI fallback is the single biggest live desync source: when it fires it picks a
// DIFFERENT move than the one the partner then actually sends -> the two engines diverge
// from that turn on (one player ends up in the shop while the other is still choosing a
// move). The old 30s window tripped it constantly; 5min still occasionally caught a slow
// thinker. 20 minutes effectively means "wait for the human" - the AI is now ONLY a
// last-resort safety net for a genuinely-disconnected partner, never a turn-timer that
// fires while someone is mid-think.
const DEFAULT_TIMEOUT_MS = 1_200_000;

function defaultSchedule(cb: () => void, ms: number): () => void {
  const id = setTimeout(cb, ms);
  return () => clearTimeout(id);
}

/**
 * Rides on a {@linkcode CoopTransport} to relay the partner's battle command. One
 * instance per client. The host calls {@linkcode requestPartnerCommand}; the peer
 * sets a responder via {@linkcode onCommandRequest}. Matching is by `fieldIndex`
 * (a slot has at most one outstanding request per turn).
 */
export class CoopBattleSync {
  private readonly transport: CoopTransport;
  private readonly timeoutMs: number;
  private readonly schedule: (cb: () => void, ms: number) => () => void;
  /** fieldIndex -> resolver for the in-flight request on that slot. */
  private readonly pending = new Map<number, (cmd: SerializedCommand | null) => void>();
  /**
   * fieldIndex -> a `command` that arrived with NO pending request yet (#633,
   * LIVE-C). In lockstep the two clients are NOT time-locked: the peer may
   * broadcast its move before this client reaches that slot's await. Buffer it so
   * the next {@linkcode requestPartnerCommand} for that slot resolves instantly
   * instead of dropping the move and timing out -> AI (the live "stuck 30s then
   * desync" bug). The turn barrier (each side awaits the other's command before the
   * turn resolves) keeps the two clients within one turn, so a per-slot, latest-wins
   * buffer consumed on request is correct.
   */
  private readonly inbox = new Map<number, SerializedCommand>();
  private responder: CoopCommandResponder | null = null;
  private readonly offMessage: () => void;

  constructor(transport: CoopTransport, opts: CoopBattleSyncOptions = {}) {
    this.transport = transport;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.schedule = opts.schedule ?? defaultSchedule;
    this.offMessage = transport.onMessage(msg => this.handle(msg));
  }

  /**
   * HOST: ask the peer for the command for `fieldIndex` on `turn`, offering the
   * `moveSlots` the host computed as legal. Resolves with the peer's chosen
   * command, or `null` if no reply arrives within the timeout (caller -> AI).
   * A second request for the same slot supersedes the first (resolves it null).
   */
  requestPartnerCommand(fieldIndex: number, turn: number, moveSlots: number[]): Promise<SerializedCommand | null> {
    // Supersede any stale in-flight request on this slot.
    this.pending.get(fieldIndex)?.(null);
    // The peer may have already broadcast its move (lockstep, no time-lock). If so,
    // consume the buffered command immediately - no request, no wait.
    const buffered = this.inbox.get(fieldIndex);
    if (buffered !== undefined) {
      this.inbox.delete(fieldIndex);
      return Promise.resolve(buffered);
    }
    return new Promise<SerializedCommand | null>(resolve => {
      let settled = false;
      let cancelTimer: () => void = () => {};
      const finish = (cmd: SerializedCommand | null) => {
        if (settled) {
          return;
        }
        settled = true;
        cancelTimer();
        if (this.pending.get(fieldIndex) === finish) {
          this.pending.delete(fieldIndex);
        }
        resolve(cmd);
      };
      this.pending.set(fieldIndex, finish);
      cancelTimer = this.schedule(() => finish(null), this.timeoutMs);
      this.transport.send({ t: "commandRequest", fieldIndex, turn, moveSlots });
    });
  }

  /** PEER (guest / spoof): install the responder that answers inbound requests. */
  onCommandRequest(responder: CoopCommandResponder): void {
    this.responder = responder;
  }

  /**
   * LOCKSTEP (#633, LIVE-C): broadcast the LOCAL human's OWN-slot command to the
   * peer UNPROMPTED (no preceding `commandRequest`). The peer's CommandPhase, for
   * THIS slot's partner-await, is sitting in a {@linkcode requestPartnerCommand}
   * that matches by `fieldIndex` - so this `command` message resolves it with the
   * exact move the human picked, instead of the peer's AI fallback. This is what
   * makes two real humans trade actual moves: each client commands only its own
   * slot interactively and broadcasts it; the other client awaits and applies it.
   */
  broadcastLocalCommand(fieldIndex: number, command: SerializedCommand): void {
    this.transport.send({ t: "command", fieldIndex, command });
  }

  /** Whether a responder is installed (this client can answer requests). */
  get hasResponder(): boolean {
    return this.responder != null;
  }

  /** Stop listening to the transport and fail any in-flight requests. */
  dispose(): void {
    this.offMessage();
    for (const finish of [...this.pending.values()]) {
      finish(null);
    }
    this.pending.clear();
    this.inbox.clear();
    this.responder = null;
  }

  private handle(msg: CoopMessage): void {
    if (msg.t === "commandRequest") {
      const responder = this.responder;
      if (responder == null) {
        return;
      }
      const command = responder({ fieldIndex: msg.fieldIndex, turn: msg.turn, moveSlots: msg.moveSlots });
      this.transport.send({ t: "command", fieldIndex: msg.fieldIndex, command });
      return;
    }
    if (msg.t === "command") {
      const resolver = this.pending.get(msg.fieldIndex);
      if (resolver) {
        resolver(msg.command);
      } else {
        // No one is awaiting this slot yet - buffer it (latest wins) so the next
        // request for this slot resolves instantly (#633, LIVE-C race fix).
        this.inbox.set(msg.fieldIndex, msg.command);
      }
    }
  }
}
