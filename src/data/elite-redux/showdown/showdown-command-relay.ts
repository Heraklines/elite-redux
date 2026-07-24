/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown versus ENEMY-COMMAND relay (C4). The NEW seam co-op never needed: in co-op
// the enemy side is AI, so nothing relays an enemy command; in showdown the enemy
// side is the REMOTE HUMAN, so the host's EnemyCommandPhase must AWAIT the opponent's
// command for the enemy slot instead of rolling `getNextMove()`.
//
//   HOST (authoritative engine): at the enemy-command point, instead of the AI it sends
//        `showdownCommandRequest{turn, fieldIndex}` and AWAITS the peer's
//        `showdownCommand{turn, fieldIndex, command}`. A missing/slow reply resolves `null`
//        after the turn timer (60s) so the host falls back to the AI picker and the turn never
//        hangs (the same anti-hang contract as the co-op command relay).
//   PEER (the remote player): its own CommandPhase for ITS team (which is the ENEMY side in
//        the host's world) picks a command for EACH of its active slots against the STREAMED
//        state and ships it via `showdownCommand` - it never executes locally; it waits for the
//        host's turn stream.
//
// MULTI-SLOT KEYING (doubles/triples): a 1v1 has a single enemy slot, but a doubles/triples match
// has TWO/THREE enemy slots resolved in the SAME turn (one EnemyCommandPhase per fieldIndex, and the
// guest ships one command per own field slot). If the relay keyed only by `turn`, the two/three
// per-turn awaits (and the two/three shipped commands) would COLLIDE - the second request would
// supersede the first, or a slot-0 command would satisfy a slot-1 await. So every pending await,
// buffered command, and buffered request is keyed by the COMPOSITE `(turn, fieldIndex)`. The guest's
// LOCAL player field slot maps 1:1 to the host's enemy field slot (the side-swap preserves party
// ORDER), so both sides use the same fieldIndex for the same mon.
//
// Rides the standalone `showdownCommandRequest` / `showdownCommand` wire kinds (already on
// CoopMessage). They are connection-scoped, and - like every other `showdown*` message - are NOT
// interaction-relay traffic, so they need NO coop-seq-registry band (that registry classifies only
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

/** The inbound request a responder answers (which turn + own field slot the host needs the command for). */
export interface ShowdownCommandRequest {
  turn: number;
  /** The peer's OWN field slot the host needs a command for (0 in a 1v1; 0/1 doubles; 0/1/2 triples). */
  fieldIndex: number;
}

/** Turns a {@linkcode ShowdownCommandRequest} into the command to send back. */
export type ShowdownCommandResponder = (req: ShowdownCommandRequest) => SerializedCommand;

/** Options for {@linkcode ShowdownCommandRelay}. */
export interface ShowdownCommandRelayOptions {
  /**
   * Per-request TURN TIMER before {@linkcode ShowdownCommandRelay.requestEnemyCommand} resolves
   * null (the host then falls back to the AI picker). The default includes bounded renderer grace
   * before the peer's own 60s command clock can even open; an explicit override remains exact.
   */
  timeoutMs?: number;
  /** Timer injection (tests). Returns a cancel fn. Defaults to setTimeout/clearTimeout. */
  schedule?: (cb: () => void, ms: number) => () => void;
}

/** The showdown TURN TIMER: wait 60s for the remote player's enemy command, then AI-fallback. */
export const SHOWDOWN_TURN_TIMER_MS = 60_000;

/**
 * A renderer must finish the authority's presentation stream before its own command UI can open.
 * Keep the host's relay alive through that bounded, non-interactive interval, then through the peer's
 * ordinary 60s player clock. Browser run 30030175748 needed ~115s solely for entry presentation at
 * ~3fps; timing out after 60s replaced a real pending human choice with AI before input was possible.
 */
export const SHOWDOWN_REMOTE_PRESENTATION_GRACE_MS = 180_000;
export const SHOWDOWN_COMMAND_RELAY_TIMEOUT_MS = SHOWDOWN_REMOTE_PRESENTATION_GRACE_MS + SHOWDOWN_TURN_TIMER_MS;

/** The composite pending/inbox key for a (turn, fieldIndex) command slot. */
function slotKey(turn: number, fieldIndex: number): string {
  return `${turn}:${fieldIndex}`;
}

function defaultSchedule(cb: () => void, ms: number): () => void {
  const id = setTimeout(cb, ms);
  return () => clearTimeout(id);
}

/**
 * Rides a {@linkcode CoopTransport} to relay the remote player's ENEMY-side command(s) in a versus
 * match. One instance per client. The HOST calls {@linkcode requestEnemyCommand} once PER enemy slot;
 * the PEER installs a responder via {@linkcode onCommandRequest} and/or ships each slot unprompted via
 * {@linkcode sendCommand}. Matching is by the composite `(turn, fieldIndex)`, so doubles/triples relay
 * multiple commands per turn without collision (a 1v1 has one slot, fieldIndex 0).
 */
export class ShowdownCommandRelay {
  private readonly transport: CoopTransport;
  private readonly timeoutMs: number;
  private readonly schedule: (cb: () => void, ms: number) => () => void;
  /** `(turn,fieldIndex)` -> resolver for the in-flight request on that slot. */
  private readonly pending = new Map<string, (cmd: SerializedCommand | null) => void>();
  /**
   * `(turn,fieldIndex)` -> a `showdownCommand` that arrived with NO pending request yet. The peer may ship
   * its command before the host reaches that slot's await (the two clients are not time-locked), so buffer
   * it, KEYED BY (turn,fieldIndex), and the next {@linkcode requestEnemyCommand} for that slot resolves
   * instantly instead of dropping the move and timing out to the AI.
   */
  private readonly inbox = new Map<string, SerializedCommand>();
  /**
   * #812-mirror: request SLOTS that arrived before this peer installed its responder (it was still
   * replaying the previous turn when the host asked for this turn's command). Buffered here KEYED BY
   * (turn,fieldIndex) and answered the instant {@linkcode onCommandRequest} installs the responder, instead
   * of being DROPPED (the versus race that otherwise only recovered via a stacked ~60s host auto-pick).
   */
  private readonly bufferedRequests = new Map<string, { turn: number; fieldIndex: number }>();
  private responder: ShowdownCommandResponder | null = null;
  private readonly offMessage: () => void;

  constructor(transport: CoopTransport, opts: ShowdownCommandRelayOptions = {}) {
    this.transport = transport;
    this.timeoutMs = opts.timeoutMs ?? SHOWDOWN_COMMAND_RELAY_TIMEOUT_MS;
    this.schedule = opts.schedule ?? defaultSchedule;
    this.offMessage = transport.onMessage(msg => this.handle(msg));
  }

  /**
   * HOST: ask the peer for the enemy-side command on `turn` for enemy field slot `fieldIndex` (default 0
   * for a 1v1). Resolves with the peer's chosen command, or `null` if no reply arrives within the turn
   * timer (caller -> AI fallback). A second request for the same slot supersedes the first (resolves it null).
   */
  requestEnemyCommand(turn: number, fieldIndex = 0): Promise<SerializedCommand | null> {
    return this.waitForCommand(turn, fieldIndex, true);
  }

  /**
   * SYNC: await the peer's independently selected command without sending an authority-style request.
   * Both engines ship their local command unprompted, so emitting requests in both directions would only
   * accumulate stale responder work. The timeout and early-command inbox behavior match the existing relay.
   */
  awaitCommand(turn: number, fieldIndex = 0): Promise<SerializedCommand | null> {
    return this.waitForCommand(turn, fieldIndex, false);
  }

  private waitForCommand(turn: number, fieldIndex: number, sendRequest: boolean): Promise<SerializedCommand | null> {
    const key = slotKey(turn, fieldIndex);
    // Supersede any stale in-flight request on this slot.
    const stale = this.pending.get(key);
    if (stale !== undefined) {
      stale(null);
    }
    // The peer may have already shipped its command for THIS slot - consume it, no wait.
    const buffered = this.inbox.get(key);
    if (buffered !== undefined) {
      this.inbox.delete(key);
      if (isCoopDebug()) {
        coopLog(
          "relay",
          `showdown host requestEnemyCommand turn=${turn} slot=${fieldIndex} -> consumed BUFFERED command=${buffered.command}`,
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
        if (this.pending.get(key) === finish) {
          this.pending.delete(key);
        }
        resolve(cmd);
      };
      this.pending.set(key, finish);
      cancelTimer = this.schedule(() => {
        coopWarn(
          "relay",
          `showdown host requestEnemyCommand TIMEOUT turn=${turn} slot=${fieldIndex} after=${this.timeoutMs}ms -> null (AI fallback)`,
        );
        finish(null);
      }, this.timeoutMs);
      if (isCoopDebug()) {
        coopLog("relay", `showdown host requestEnemyCommand SEND turn=${turn} slot=${fieldIndex} (awaiting peer)`);
      }
      if (sendRequest) {
        this.transport.send({ t: "showdownCommandRequest", turn, ...(fieldIndex === 0 ? {} : { fieldIndex }) });
      }
    });
  }

  /** PEER: install the responder that answers inbound enemy-command requests. */
  onCommandRequest(responder: ShowdownCommandResponder): void {
    this.responder = responder;
    // #812-mirror: drain any requests that arrived while the responder was not yet installed (the peer
    // was still replaying the previous turn). Answer each buffered slot on install so a request arriving
    // a beat before the guest's CommandPhase installs its responder is honored, not lost.
    if (this.bufferedRequests.size === 0) {
      return;
    }
    const buffered = [...this.bufferedRequests.values()];
    this.bufferedRequests.clear();
    for (const { turn, fieldIndex } of buffered) {
      coopLog("relay", `showdown answering BUFFERED commandRequest turn=${turn} slot=${fieldIndex} (#812-mirror)`);
      const command = responder({ turn, fieldIndex });
      this.transport.send({ t: "showdownCommand", turn, command, ...(fieldIndex === 0 ? {} : { fieldIndex }) });
    }
  }

  /** Whether a responder is installed (this client can answer requests). */
  get hasResponder(): boolean {
    return this.responder != null;
  }

  /**
   * PEER: ship the local human's OWN-side command for own field slot `fieldIndex` (default 0) to the host
   * UNPROMPTED. In the host's world this slot is the ENEMY, and the host's {@linkcode requestEnemyCommand}
   * for the matching enemy slot resolves with it. Lets the peer command each of its mons the instant it
   * picks, without waiting to be asked.
   */
  sendCommand(turn: number, command: SerializedCommand, fieldIndex = 0): void {
    if (isCoopDebug()) {
      coopLog(
        "relay",
        `showdown peer sendCommand turn=${turn} slot=${fieldIndex} command=${command.command} cursor=${command.cursor}`,
      );
    }
    this.transport.send({ t: "showdownCommand", turn, command, ...(fieldIndex === 0 ? {} : { fieldIndex }) });
  }

  /**
   * Fail any IN-FLIGHT {@linkcode requestEnemyCommand} (resolve `null` -> the caller AI-falls-back)
   * WITHOUT tearing the relay down. Called on a channel disconnect (coop-runtime's disconnect reaction)
   * so the host's awaiting enemy-command turn unblocks PROMPTLY (AI fallback) instead of waiting the full
   * 60s turn timer - but the relay's listeners + responder survive so a within-grace rejoin can reuse it.
   */
  cancelPending(): void {
    for (const finish of [...this.pending.values()]) {
      finish(null);
    }
    this.pending.clear();
  }

  /** Stop listening to the transport and fail any in-flight requests (null -> caller AI-falls-back). */
  dispose(): void {
    this.offMessage();
    for (const finish of [...this.pending.values()]) {
      finish(null);
    }
    this.pending.clear();
    this.inbox.clear();
    this.bufferedRequests.clear();
    this.responder = null;
  }

  private handle(msg: CoopMessage): void {
    if (msg.t === "showdownCommandRequest") {
      this.handleRequest(msg.turn, msg.fieldIndex ?? 0);
    } else if (msg.t === "showdownCommand") {
      this.handleCommand(msg.turn, msg.fieldIndex ?? 0, msg.command);
    }
  }

  /** PEER side: answer an inbound enemy-command request through the installed responder. */
  private handleRequest(turn: number, fieldIndex: number): void {
    const responder = this.responder;
    if (responder == null) {
      // #812-mirror: a missing responder is TRANSIENT - the peer is still replaying the previous turn
      // when the host already asks for this turn's command. BUFFER the slot (keyed by turn+fieldIndex) and
      // answer it the instant onCommandRequest installs the responder, instead of DROPPING it (the versus
      // race that otherwise only recovered via a stacked ~60s host auto-pick timeout). Every enemy slot is
      // always "ours" (the guest owns the whole enemy half in versus), so - unlike the co-op #812 path -
      // there is no ownership decline branch. The host's own turn-timer + AI fallback still bounds the worst
      // case, so this cannot hang.
      if (isCoopDebug()) {
        coopLog(
          "relay",
          `showdown peer recv commandRequest turn=${turn} slot=${fieldIndex} before responder install -> BUFFERED (#812-mirror)`,
        );
      }
      this.bufferedRequests.set(slotKey(turn, fieldIndex), { turn, fieldIndex });
      return;
    }
    const command = responder({ turn, fieldIndex });
    this.transport.send({ t: "showdownCommand", turn, command, ...(fieldIndex === 0 ? {} : { fieldIndex }) });
  }

  /** HOST side: resolve the awaiting request for this slot, or buffer the command (keyed by turn+fieldIndex). */
  private handleCommand(turn: number, fieldIndex: number, command: SerializedCommand): void {
    const key = slotKey(turn, fieldIndex);
    const resolver = this.pending.get(key);
    if (resolver) {
      if (isCoopDebug()) {
        coopLog(
          "relay",
          `showdown recv command turn=${turn} slot=${fieldIndex} command=${command.command} -> resolved awaiting request`,
        );
      }
      resolver(command);
      return;
    }
    // No awaiter for this slot yet - buffer it (keyed by turn+fieldIndex so a later slot/turn can't clobber
    // an unconsumed earlier one) so the next request for THIS slot resolves instantly.
    if (isCoopDebug()) {
      coopLog(
        "relay",
        `showdown recv command turn=${turn} slot=${fieldIndex} command=${command.command} -> BUFFERED (no awaiter yet)`,
      );
    }
    this.inbox.set(key, command);
  }
}
