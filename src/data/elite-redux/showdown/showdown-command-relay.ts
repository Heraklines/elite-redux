/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 ENEMY-COMMAND relay (C4). The NEW seam co-op never needed: in co-op
// the enemy side is AI, so nothing relays an enemy command; in showdown the enemy
// side is the REMOTE HUMAN, so the host's EnemyCommandPhase must AWAIT the opponent's
// command for the enemy slot instead of rolling `getNextMove()`.
//
//   HOST (authoritative engine): at the enemy-command point, instead of the AI it sends
//        `showdownCommandRequest{turn}` and AWAITS the peer's `showdownCommand{turn, command}`.
//        A missing/slow reply resolves `null` after the turn timer (60s) so the host falls
//        back to the AI picker and the turn never hangs (the same anti-hang contract as the
//        co-op command relay).
//   PEER (the remote player): its own CommandPhase for ITS team (which is the ENEMY side in
//        the host's world) picks a command against the STREAMED state and ships it via
//        `showdownCommand` - it never executes locally; it waits for the host's turn stream.
//
// Rides the standalone `showdownCommandRequest` / `showdownCommand` wire kinds (already on
// CoopMessage). They are turn-keyed (1v1 has a single enemy slot, so no fieldIndex) and
// connection-scoped, and - like every other `showdown*` message - are NOT interaction-relay
// traffic, so they need NO coop-seq-registry band (that registry classifies only
// `interactionChoice`/`interactionOutcome` seqs). Choosing these over reusing CoopBattleSync's
// `commandRequest`/`command` envelope keeps showdown traffic disjoint from the co-op relay's
// fieldIndex/wave-keyed inbox on the SAME transport, so a stray co-op buffer can never satisfy
// a showdown await (and vice-versa).
//
// Engine-FREE (transport + wire types only), so the whole relay is unit-testable headlessly
// over a LoopbackTransport with a spoof responder - the same protocol runs unchanged over WebRTC.
// =============================================================================

import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import type { CoopMessage, CoopTransport, SerializedCommand } from "#data/elite-redux/coop/coop-transport";

/** The inbound request a responder answers (which turn the host needs the enemy command for). */
export interface ShowdownCommandRequest {
  turn: number;
}

/** Turns a {@linkcode ShowdownCommandRequest} into the command to send back. */
export type ShowdownCommandResponder = (req: ShowdownCommandRequest) => SerializedCommand;

/** Options for {@linkcode ShowdownCommandRelay}. */
export interface ShowdownCommandRelayOptions {
  /**
   * Per-request TURN TIMER before {@linkcode ShowdownCommandRelay.requestEnemyCommand} resolves
   * null (the host then falls back to the AI picker). Default 60s - the showdown turn timer.
   */
  timeoutMs?: number;
  /** Timer injection (tests). Returns a cancel fn. Defaults to setTimeout/clearTimeout. */
  schedule?: (cb: () => void, ms: number) => () => void;
}

/** The showdown TURN TIMER: wait 60s for the remote player's enemy command, then AI-fallback. */
export const SHOWDOWN_TURN_TIMER_MS = 60_000;

function defaultSchedule(cb: () => void, ms: number): () => void {
  const id = setTimeout(cb, ms);
  return () => clearTimeout(id);
}

/**
 * Rides a {@linkcode CoopTransport} to relay the remote player's ENEMY-side command in a 1v1
 * showdown. One instance per client. The HOST calls {@linkcode requestEnemyCommand}; the PEER
 * installs a responder via {@linkcode onCommandRequest}. Matching is by `turn` (a 1v1 has one
 * enemy slot, so at most one outstanding request per turn).
 */
export class ShowdownCommandRelay {
  private readonly transport: CoopTransport;
  private readonly timeoutMs: number;
  private readonly schedule: (cb: () => void, ms: number) => () => void;
  /** `turn` -> resolver for the in-flight request on that turn. */
  private readonly pending = new Map<number, (cmd: SerializedCommand | null) => void>();
  /**
   * `turn` -> a `showdownCommand` that arrived with NO pending request yet. The peer may ship its
   * command before the host reaches that turn's await (the two clients are not time-locked), so
   * buffer it, KEYED BY TURN, and the next {@linkcode requestEnemyCommand} for that turn resolves
   * instantly instead of dropping the move and timing out to the AI.
   */
  private readonly inbox = new Map<number, SerializedCommand>();
  private responder: ShowdownCommandResponder | null = null;
  private readonly offMessage: () => void;

  constructor(transport: CoopTransport, opts: ShowdownCommandRelayOptions = {}) {
    this.transport = transport;
    this.timeoutMs = opts.timeoutMs ?? SHOWDOWN_TURN_TIMER_MS;
    this.schedule = opts.schedule ?? defaultSchedule;
    this.offMessage = transport.onMessage(msg => this.handle(msg));
  }

  /**
   * HOST: ask the peer for the enemy-side command on `turn`. Resolves with the peer's chosen
   * command, or `null` if no reply arrives within the turn timer (caller -> AI fallback). A
   * second request for the same turn supersedes the first (resolves it null).
   */
  requestEnemyCommand(turn: number): Promise<SerializedCommand | null> {
    // Supersede any stale in-flight request on this turn.
    const stale = this.pending.get(turn);
    if (stale !== undefined) {
      stale(null);
    }
    // The peer may have already shipped its command for THIS turn - consume it, no wait.
    const buffered = this.inbox.get(turn);
    if (buffered !== undefined) {
      this.inbox.delete(turn);
      if (isCoopDebug()) {
        coopLog(
          "relay",
          `showdown host requestEnemyCommand turn=${turn} -> consumed BUFFERED command=${buffered.command}`,
        );
      }
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
        if (this.pending.get(turn) === finish) {
          this.pending.delete(turn);
        }
        resolve(cmd);
      };
      this.pending.set(turn, finish);
      cancelTimer = this.schedule(() => {
        coopWarn(
          "relay",
          `showdown host requestEnemyCommand TIMEOUT turn=${turn} after=${this.timeoutMs}ms -> null (AI fallback)`,
        );
        finish(null);
      }, this.timeoutMs);
      if (isCoopDebug()) {
        coopLog("relay", `showdown host requestEnemyCommand SEND turn=${turn} (awaiting peer)`);
      }
      this.transport.send({ t: "showdownCommandRequest", turn });
    });
  }

  /** PEER: install the responder that answers inbound enemy-command requests. */
  onCommandRequest(responder: ShowdownCommandResponder): void {
    this.responder = responder;
  }

  /** Whether a responder is installed (this client can answer requests). */
  get hasResponder(): boolean {
    return this.responder != null;
  }

  /**
   * PEER: ship the local human's OWN-side command to the host UNPROMPTED. In the host's world
   * this slot is the ENEMY, and the host's {@linkcode requestEnemyCommand} for this turn resolves
   * with it. Lets the peer command its team the instant it picks, without waiting to be asked.
   */
  sendCommand(turn: number, command: SerializedCommand): void {
    if (isCoopDebug()) {
      coopLog("relay", `showdown peer sendCommand turn=${turn} command=${command.command} cursor=${command.cursor}`);
    }
    this.transport.send({ t: "showdownCommand", turn, command });
  }

  /** Stop listening to the transport and fail any in-flight requests (null -> caller AI-falls-back). */
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
    if (msg.t === "showdownCommandRequest") {
      this.handleRequest(msg.turn);
    } else if (msg.t === "showdownCommand") {
      this.handleCommand(msg.turn, msg.command);
    }
  }

  /** PEER side: answer an inbound enemy-command request through the installed responder. */
  private handleRequest(turn: number): void {
    const responder = this.responder;
    if (responder == null) {
      // No responder yet (peer not at its command UI); the host's own turn-timer + AI fallback
      // bounds the worst case, so simply ignore - a re-request or the peer's unprompted sendCommand
      // will satisfy the host.
      if (isCoopDebug()) {
        coopLog("relay", `showdown peer recv commandRequest turn=${turn} before responder install -> ignored`);
      }
      return;
    }
    const command = responder({ turn });
    this.transport.send({ t: "showdownCommand", turn, command });
  }

  /** HOST side: resolve the awaiting request for this turn, or buffer the command (keyed by turn). */
  private handleCommand(turn: number, command: SerializedCommand): void {
    const resolver = this.pending.get(turn);
    if (resolver) {
      if (isCoopDebug()) {
        coopLog("relay", `showdown recv command turn=${turn} command=${command.command} -> resolved awaiting request`);
      }
      resolver(command);
      return;
    }
    // No awaiter for this turn yet - buffer it (keyed by turn so a later turn can't clobber an
    // unconsumed earlier one) so the next request for THIS turn resolves instantly.
    if (isCoopDebug()) {
      coopLog("relay", `showdown recv command turn=${turn} command=${command.command} -> BUFFERED (no awaiter yet)`);
    }
    this.inbox.set(turn, command);
  }
}
