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

import { globalScene } from "#app/global-scene";
import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import type { CoopMessage, CoopRole, CoopTransport, SerializedCommand } from "#data/elite-redux/coop/coop-transport";

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
 * Inbox / pending key: a command is matched by BOTH slot AND turn (#633 desync fix).
 *
 * #851: when the sender's resolved `coopOwner` role is known it keys the SLOT dimension by
 * OWNER, not the raw field index. A host-half-wipe recenter + party compaction (host-only)
 * seats the surviving mon at DIFFERENT field indexes on the two engines until the guest's
 * checkpoint reconcile catches up (host awaits fieldIndex 0, guest broadcasts fieldIndex 1),
 * so a `fieldIndex`-keyed request could never match the guest's broadcast and hit the 20-min
 * timeout -> the AI played the survivor's move alone (the live long-stall UX). The owner is
 * invariant across that geometry skew, so both sides compute the SAME key. Falls back to the
 * field index when the owner is absent (older client / a call site with no owner) - both sides
 * then agree on the fieldIndex key exactly as before (version-handshake safe).
 */
function commandKey(fieldIndex: number, turn: number, owner?: CoopRole): string {
  // #819: scope by WAVE too - an ME-spawned battle resets `turn` to 1 within the run, so a
  // stale wave-N buffered command must never satisfy wave-M's request for the same slot+turn.
  let wave = 0;
  try {
    wave = globalScene.currentBattle?.waveIndex ?? 0;
  } catch {
    /* engine-free tests have no scene - 0 scopes them all to one battle, the old behavior */
  }
  // #851: the OWNER (a role string, never numeric) keys the slot dimension when present; the
  // field index (numeric) is the fallback. The two value spaces are disjoint, so a mixed session
  // can never key-collide - but paired clients share a protocol version, so it is owner on both
  // or fieldIndex on both.
  const slot = owner ?? fieldIndex;
  return `${wave}:${slot}:${turn}`;
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
  /** Full request state retained until resolution so a replaced channel can reissue it verbatim. */
  private readonly pending = new Map<
    string,
    {
      finish: (cmd: SerializedCommand | null) => void;
      fieldIndex: number;
      turn: number;
      moveSlots: number[];
      owner?: CoopRole | undefined;
    }
  >();
  /**
   * `fieldIndex:turn` -> a `command` that arrived with NO pending request yet (#633,
   * LIVE-C). In lockstep the two clients are NOT time-locked: the peer may broadcast
   * its move before this client reaches that slot's await. Buffer it so the next
   * {@linkcode requestPartnerCommand} for that slot resolves instantly instead of
   * dropping the move and timing out -> AI (the live "stuck 30s then desync" bug).
   *
   * Keyed by `(fieldIndex, TURN)`, NOT fieldIndex alone (#633 desync fix): a peer
   * that races ahead can broadcast turn N then turn N+1 (or a switch then a move on
   * the same slot) before the awaiter consumes turn N. A fieldIndex-only latest-wins
   * buffer silently overwrote the earlier one, so the awaiter applied the WRONG turn's
   * command -> one client switched/moved while the other did something else (the live
   * move/switch/target desync). Turn-keying makes an await for turn N accept ONLY the
   * turn-N command; stale older-turn entries are pruned on request.
   */
  private readonly inbox = new Map<string, SerializedCommand>();
  private responder: CoopCommandResponder | null = null;
  private readonly offMessage: () => void;
  private readonly offStateChange: () => void;

  constructor(transport: CoopTransport, opts: CoopBattleSyncOptions = {}) {
    this.transport = transport;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.schedule = opts.schedule ?? defaultSchedule;
    this.offMessage = transport.onMessage(msg => this.handle(msg));
    this.offStateChange = transport.onStateChange(state => {
      if (state !== "connected") {
        return;
      }
      // A command request is an active shared surface, not disposable wire traffic. Reissue every
      // unresolved legal-action offer after a channel replacement so the same turn resumes rather
      // than falling through to a local AI command when the original request/reply was lost.
      for (const request of this.pending.values()) {
        this.sendCommandRequest(request);
      }
    });
  }

  private sendCommandRequest(request: {
    fieldIndex: number;
    turn: number;
    moveSlots: number[];
    owner?: CoopRole | undefined;
  }): void {
    this.transport.send({
      t: "commandRequest",
      fieldIndex: request.fieldIndex,
      turn: request.turn,
      moveSlots: request.moveSlots,
      ...(request.owner == null ? {} : { owner: request.owner }),
    });
  }

  /**
   * HOST: ask the peer for the command for `fieldIndex` on `turn`, offering the
   * `moveSlots` the host computed as legal. Resolves with the peer's chosen
   * command, or `null` if no reply arrives within the timeout (caller -> AI).
   * A second request for the same slot supersedes the first (resolves it null).
   *
   * `owner` (#851, optional) is the awaited slot's resolved `coopOwner`
   * (`coopOwnerOfPlayerFieldSlot(fieldIndex)`). When supplied it keys the pending
   * request by OWNER so a post-half-wipe index skew (host compacted, guest not yet
   * reconciled) still matches the peer's broadcast; absent, the legacy fieldIndex
   * key is used (unchanged behavior).
   */
  requestPartnerCommand(
    fieldIndex: number,
    turn: number,
    moveSlots: number[],
    owner?: CoopRole,
  ): Promise<SerializedCommand | null> {
    const key = commandKey(fieldIndex, turn, owner);
    const slotPrefix = key.slice(0, key.lastIndexOf(":") + 1); // `wave:fieldIndex:` (#819)
    // Supersede any stale in-flight request on this SLOT (the turn has moved on, so an
    // older-turn await is moot) and prune any stale older-turn buffered command for it,
    // so a request for turn N can never resolve with a turn != N command (#633 desync fix).
    for (const [k, request] of [...this.pending]) {
      if (k.startsWith(slotPrefix)) {
        request.finish(null);
      }
    }
    for (const k of [...this.inbox.keys()]) {
      // Prune only OLDER-turn buffers for this slot. A FUTURE-turn command can be
      // legitimately buffered here (a fast peer broadcast turn N+1 before we reached
      // turn N's await) and must be kept for that turn's await - dropping it would
      // re-introduce the very desync this keying fixes.
      if (k.startsWith(slotPrefix) && Number(k.slice(slotPrefix.length)) < turn) {
        this.inbox.delete(k);
      }
    }
    // The peer may have already broadcast its move for THIS turn (lockstep, no
    // time-lock). If so, consume the buffered command immediately - no request, no wait.
    const buffered = this.inbox.get(key);
    if (buffered !== undefined) {
      this.inbox.delete(key);
      if (isCoopDebug()) {
        coopLog(
          "relay",
          `host requestPartnerCommand fieldIndex=${fieldIndex} turn=${turn} moveSlots=[${moveSlots.join(",")}] -> consumed BUFFERED command kind=${buffered.command}`,
        );
      }
      return Promise.resolve(buffered);
    }
    return new Promise<SerializedCommand | null>(resolve => {
      let settled = false;
      let cancelTimer: () => void = () => {};
      let request: {
        finish: (cmd: SerializedCommand | null) => void;
        fieldIndex: number;
        turn: number;
        moveSlots: number[];
        owner?: CoopRole | undefined;
      };
      const finish = (cmd: SerializedCommand | null) => {
        if (settled) {
          return;
        }
        settled = true;
        cancelTimer();
        if (this.pending.get(key) === request) {
          this.pending.delete(key);
        }
        resolve(cmd);
      };
      request = { finish, fieldIndex, turn, moveSlots: [...moveSlots], ...(owner == null ? {} : { owner }) };
      this.pending.set(key, request);
      cancelTimer = this.schedule(() => {
        coopWarn(
          "relay",
          `host requestPartnerCommand TIMEOUT fieldIndex=${fieldIndex} turn=${turn} after=${this.timeoutMs}ms -> resolving null (caller falls back to AI)`,
        );
        finish(null);
      }, this.timeoutMs);
      if (isCoopDebug()) {
        coopLog(
          "relay",
          `host requestPartnerCommand SEND fieldIndex=${fieldIndex} turn=${turn} moveSlots=[${moveSlots.join(",")}] (awaiting peer)`,
        );
      }
      // #851: stamp the resolved owner (when known) so the peer's answerRequest reply echoes it
      // and both sides key by owner; omitted when unknown so an older peer's fieldIndex key still matches.
      this.sendCommandRequest(request);
    });
  }

  /** #812: requests that arrived before the responder installed (guest mid-replay). */
  private readonly bufferedRequests: { fieldIndex: number; turn: number; moveSlots: number[]; owner?: CoopRole }[] = [];
  /** #812: injected by the runtime (cycle-free); true = this client owns the field slot. */
  private slotOwnershipProbe: ((fieldIndex: number) => boolean) | null = null;

  /** #812: install the slot-ownership probe used to buffer-vs-decline pre-responder requests. */
  /** #820 wiring-completeness surface: whether the factory installed the probe. */
  hasSlotOwnershipProbe(): boolean {
    return this.slotOwnershipProbe != null;
  }

  setSlotOwnershipProbe(probe: (fieldIndex: number) => boolean): void {
    this.slotOwnershipProbe = probe;
  }

  /** Run one inbound request through the installed responder and reply. */
  private answerRequest(req: { fieldIndex: number; turn: number; moveSlots: number[]; owner?: CoopRole }): void {
    const responder = this.responder;
    if (responder == null) {
      return;
    }
    const command = responder({ fieldIndex: req.fieldIndex, turn: req.turn, moveSlots: req.moveSlots });
    if (isCoopDebug()) {
      coopLog(
        "relay",
        `peer recv commandRequest fieldIndex=${req.fieldIndex} owner=${req.owner ?? "-"} turn=${req.turn} moveSlots=[${req.moveSlots.join(",")}] -> reply command=${command.command} cursor=${command.cursor} moveId=${command.moveId ?? "-"}`,
      );
    }
    // Echo the request's turn AND owner so the awaiter matches by (owner|fieldIndex, turn) (#633/#851).
    this.transport.send({
      t: "command",
      fieldIndex: req.fieldIndex,
      turn: req.turn,
      command,
      ...(req.owner == null ? {} : { owner: req.owner }),
    });
  }

  /**
   * PEER (guest / spoof): install the responder that answers inbound requests.
   *
   * NOTE (#851): the PRODUCTION guest never installs a responder here. In lockstep both clients
   * command only their OWN slot and {@linkcode broadcastLocalCommand} it unprompted; the host's
   * {@linkcode requestPartnerCommand} for the partner slot is matched against that independent
   * broadcast, NOT a request/answer round-trip. The responder path is used only by the dev
   * {@linkcode CoopSpoofGuest} and the tests. Both paths key by owner-then-fieldIndex identically,
   * so the fix holds whichever one answers a given request.
   */
  onCommandRequest(responder: CoopCommandResponder): void {
    this.responder = responder;
    // #812: drain requests that arrived while the responder was not yet installed (the
    // guest was still replaying the previous turn). Stale turns are ignored host-side.
    const buffered = this.bufferedRequests.splice(0);
    for (const req of buffered) {
      coopLog("relay", `answering BUFFERED commandRequest fieldIndex=${req.fieldIndex} turn=${req.turn} (#812)`);
      this.answerRequest(req);
    }
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
  broadcastLocalCommand(fieldIndex: number, turn: number, command: SerializedCommand, owner?: CoopRole): void {
    if (isCoopDebug()) {
      coopLog(
        "relay",
        `broadcastLocalCommand SEND fieldIndex=${fieldIndex} owner=${owner ?? "-"} turn=${turn} command=${command.command} cursor=${command.cursor} moveId=${command.moveId ?? "-"} targets=[${(command.targets ?? []).join(",")}]`,
      );
    }
    // #851: stamp the local mon's resolved owner so the peer's awaiting request (which keys by the
    // SAME owner) matches even when the survivor sits at a different field index across the two engines.
    this.transport.send({ t: "command", fieldIndex, turn, command, ...(owner == null ? {} : { owner }) });
  }

  /** Whether a responder is installed (this client can answer requests). */
  get hasResponder(): boolean {
    return this.responder != null;
  }

  /** Stop listening to the transport and fail any in-flight requests. */
  dispose(): void {
    this.offMessage();
    this.offStateChange();
    this.cancelPending();
    this.inbox.clear();
    this.responder = null;
    this.bufferedRequests.length = 0;
  }

  /** Terminal membership loss: release every retained request only after recovery is no longer possible. */
  cancelPending(): void {
    for (const request of [...this.pending.values()]) {
      request.finish(null);
    }
    this.pending.clear();
  }

  /** Read-only active command surfaces for recovery snapshots and causal diagnostics. */
  describePendingRequests(): { fieldIndex: number; turn: number; moveSlots: number[]; owner?: CoopRole }[] {
    return [...this.pending.values()].map(request => ({
      fieldIndex: request.fieldIndex,
      turn: request.turn,
      moveSlots: [...request.moveSlots],
      ...(request.owner == null ? {} : { owner: request.owner }),
    }));
  }

  private handle(msg: CoopMessage): void {
    if (msg.t === "commandRequest") {
      if (this.responder == null) {
        // #812 (live "wrong move / didn't wait" regression of the #693 decline): a missing
        // responder is TRANSIENT whenever this client is still replaying the previous turn
        // when the host already asks for the next command. Deciding by OWNERSHIP:
        //  - the slot IS ours (or ownership unknown): the responder is coming - BUFFER the
        //    request and answer it the moment the responder installs. The host's own
        //    timeout+AI fallback still bounds the worst case, so this can never hang.
        //  - the slot is provably NOT ours (#693's mutual-misresolve deadlock): DECLINE so
        //    the host's await resolves null and its AI fallback breaks the deadlock.
        const ours = this.slotOwnershipProbe?.(msg.fieldIndex) ?? true;
        if (ours) {
          coopLog(
            "relay",
            `peer recv commandRequest fieldIndex=${msg.fieldIndex} owner=${msg.owner ?? "-"} turn=${msg.turn} before responder install -> BUFFERED (own slot, #812)`,
          );
          this.bufferedRequests.push({
            fieldIndex: msg.fieldIndex,
            turn: msg.turn,
            moveSlots: msg.moveSlots,
            ...(msg.owner == null ? {} : { owner: msg.owner }),
          });
          return;
        }
        coopWarn(
          "relay",
          `peer recv commandRequest fieldIndex=${msg.fieldIndex} owner=${msg.owner ?? "-"} turn=${msg.turn} for a slot that is NOT ours -> DECLINE reply (host AI-falls-back, #693)`,
        );
        // Echo the owner so the host's DECLINE resolver (keyed by owner when present) is found (#851).
        this.transport.send({
          t: "command",
          fieldIndex: msg.fieldIndex,
          turn: msg.turn,
          command: { command: 0, cursor: -1 } as SerializedCommand,
          decline: true,
          ...(msg.owner == null ? {} : { owner: msg.owner }),
        });
        return;
      }
      this.answerRequest({
        fieldIndex: msg.fieldIndex,
        turn: msg.turn,
        moveSlots: msg.moveSlots,
        ...(msg.owner == null ? {} : { owner: msg.owner }),
      });
      return;
    }
    if (msg.t === "command") {
      // #851: key by the sender's owner when present (stable across a post-half-wipe index skew),
      // else the field index (unchanged). Both the pending resolver and any buffer use this key.
      const key = commandKey(msg.fieldIndex, msg.turn, msg.owner);
      const request = this.pending.get(key);
      // #693: an explicit DECLINE resolves the awaiter with null -> the caller's AI
      // fallback commands the slot. Never treated as a real command.
      if (msg.decline && request != null) {
        this.pending.delete(key);
        coopLog("relay", `recv command DECLINE fieldIndex=${msg.fieldIndex} turn=${msg.turn} -> AI fallback`);
        request.finish(null);
        return;
      }
      if (request) {
        if (isCoopDebug()) {
          coopLog(
            "relay",
            `recv command fieldIndex=${msg.fieldIndex} turn=${msg.turn} command=${msg.command.command} -> resolved awaiting request`,
          );
        }
        request.finish(msg.command);
      } else {
        if (isCoopDebug()) {
          coopLog(
            "relay",
            `recv command fieldIndex=${msg.fieldIndex} turn=${msg.turn} command=${msg.command.command} -> BUFFERED (no awaiter yet)`,
          );
        }
        // No one is awaiting this slot+turn yet - buffer it (keyed by turn, so a
        // later turn can't clobber an unconsumed earlier one) so the next request
        // for THIS turn resolves instantly (#633, LIVE-C race fix + desync fix).
        this.inbox.set(key, msg.command);
      }
    }
  }
}
