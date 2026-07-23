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
// it itself offered. A fully addressed missing reply enters the shared terminal
// before resolving the retained promise; legacy unaddressed probes keep the old
// `null` result for compatibility, but production never converts it into AI.
//
// Engine-FREE (transport + the wire types only), so the whole relay is unit-
// testable headlessly over a LoopbackTransport with a spoof responder - the same
// protocol then runs unchanged over the real WebRTC transport.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { validateCoopBattleCommand } from "#data/elite-redux/coop/coop-battle-command-offer";
import { recordCoopCausalEvent } from "#data/elite-redux/coop/coop-causal-trace";
import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import type {
  CoopBattleCommandOffer,
  CoopMessage,
  CoopRole,
  CoopTransport,
  SerializedCommand,
} from "#data/elite-redux/coop/coop-transport";
import { recordCoopUiRelayCarrier } from "#data/elite-redux/coop/coop-ui-relay-trace";
import { Command } from "#enums/command";
import { MoveUseMode } from "#enums/move-use-mode";

/** The inbound request a responder answers (the legal move slots the host offers). */
export interface CoopCommandRequest {
  fieldIndex: number;
  turn: number;
  /** Indices into the partner mon's moveset that are legal this turn (empty => Struggle). */
  moveSlots: number[];
  /** Full host-authored action set. Required by protocol 24 production sessions. */
  offer?: CoopBattleCommandOffer | undefined;
}

/** Host-stable identity for one active monster command surface. */
export interface CoopCommandAddress {
  epoch: number;
  wave: number;
  pokemonId: number;
}

/** Exact host-retained command surface carried by a checksum-bound control snapshot. */
export interface CoopPendingCommandSnapshot extends CoopCommandRequest {
  owner?: CoopRole | undefined;
  address?: CoopCommandAddress | undefined;
}

/** Exact immutable command surface whose bounded peer wait exhausted. */
export interface CoopCommandTimeout {
  epoch: number;
  wave: number;
  turn: number;
  owner: CoopRole;
  pokemonId: number;
  fieldIndex: number;
}

interface PendingCommandRequest extends CoopPendingCommandSnapshot {
  finish: (cmd: SerializedCommand | null) => void;
}

/** Turns a {@linkcode CoopCommandRequest} into the command to send back. */
export type CoopCommandResponder = (req: CoopCommandRequest) => SerializedCommand;

/** Options for {@linkcode CoopBattleSync}. */
export interface CoopBattleSyncOptions {
  /** Per-request timeout before {@linkcode CoopBattleSync.requestPartnerCommand}
   *  exhausts its retained command surface. Default 20min. */
  timeoutMs?: number;
  /** Timer injection (tests). Returns a cancel fn. Defaults to setTimeout/clearTimeout. */
  schedule?: (cb: () => void, ms: number) => () => void;
  /**
   * Fail-closed production callback for a fully addressed command surface that times out or is declined.
   * It runs synchronously before the retained request resolves `null`, allowing the runtime to enter shared
   * terminal control before a CommandPhase continuation can mistake that release for permission to choose AI.
   */
  onCommandTimeout?: (timeout: CoopCommandTimeout) => void;
  /** Authority V2 recovery fence; a held transaction may not admit or create another command wait. */
  isAuthorityWaitCreationFrozen?: () => boolean;
}

// Wait up to 20 MINUTES for the real partner's move before shared terminal control (#633).
// The former AI fallback was the single biggest live desync source: when it fired it picked a
// DIFFERENT move than the one the partner then actually sends -> the two engines diverge
// from that turn on (one player ends up in the shop while the other is still choosing a
// move). The old 30s window tripped it constantly; 5min still occasionally caught a slow
// thinker. 20 minutes effectively means "wait for the human"; exhaustion now stops both
// clients coherently instead of authoring a move the absent player never chose.
const DEFAULT_TIMEOUT_MS = 1_200_000;

function defaultSchedule(cb: () => void, ms: number): () => void {
  const id = setTimeout(cb, ms);
  return () => clearTimeout(id);
}

/**
 * The responder API is a dev/test convenience; production humans broadcast their already-resolved
 * local command and never install one. Bring legacy responders onto the protocol-24 offer so their
 * hand-authored cursor/target shortcuts represent a command the real UI could actually emit.
 */
function normalizeResponderCommand(
  command: SerializedCommand,
  offer: CoopBattleCommandOffer | undefined,
): SerializedCommand {
  if (offer == null || command.command !== Command.FIGHT) {
    return command;
  }
  const move =
    (command.moveId == null ? undefined : offer.moves.find(candidate => candidate.moveId === command.moveId))
    ?? offer.moves.find(candidate => candidate.slot === command.cursor);
  if (move == null) {
    return command;
  }
  const targets = move.targetSets.find(candidate => {
    const validation = validateCoopBattleCommand(
      { ...command, cursor: move.slot, moveId: move.moveId, targets: candidate },
      offer,
    );
    return validation.valid;
  });
  const requestedTargets = command.targets;
  return {
    ...command,
    cursor: move.slot,
    moveId: move.moveId,
    targets:
      requestedTargets != null && move.targetSets.some(set => sameNumberSet(requestedTargets, set))
        ? requestedTargets
        : [...(targets ?? move.targetSets[0] ?? [])],
  };
}

/** Repair only authority-unambiguous geometry drift for a real local human command. */
function normalizeLocalCommand(
  command: SerializedCommand,
  offer: CoopBattleCommandOffer | undefined,
): SerializedCommand {
  if (offer == null) {
    return command;
  }
  if (command.command === Command.POKEMON) {
    return {
      command: Command.POKEMON,
      cursor: command.cursor,
      ...(command.baton == null ? {} : { baton: command.baton }),
    };
  }
  if (command.command === Command.RUN) {
    return { command: Command.RUN, cursor: command.cursor };
  }
  if (command.command === Command.BALL) {
    const stable = sameTargetRefSet(command.targetRefs, offer.ballTargetRefs);
    return {
      command: Command.BALL,
      cursor: command.cursor,
      targets: [...(stable ? offer.ballTargets : (command.targets ?? []))],
      targetRefs: [...(stable ? offer.ballTargetRefs : (command.targetRefs ?? []))],
    };
  }
  if (command.command !== Command.FIGHT) {
    return command;
  }
  const move =
    (command.moveId == null ? undefined : offer.moves.find(candidate => candidate.moveId === command.moveId))
    ?? offer.moves.find(candidate => candidate.slot === command.cursor);
  if (move == null) {
    return command;
  }
  const requestedTargets = command.targets;
  const stableIndex = move.targetRefSets.findIndex(set => sameTargetRefSet(command.targetRefs, set));
  const exactTargets =
    requestedTargets == null ? undefined : move.targetSets.find(set => sameNumberSet(requestedTargets, set));
  // A single legal set is not a choice (self/spread/sole target), so authority can repair a stale
  // guest battler index. Multiple target sets represent a real human choice and must never be guessed.
  const targets =
    stableIndex >= 0
      ? move.targetSets[stableIndex]
      : (exactTargets ?? (move.targetSets.length === 1 ? move.targetSets[0] : requestedTargets));
  const targetRefs =
    stableIndex >= 0
      ? move.targetRefSets[stableIndex]
      : move.targetSets.length === 1
        ? move.targetRefSets[0]
        : command.targetRefs;
  return {
    ...command,
    cursor: move.slot,
    moveId: move.moveId,
    ...(targets == null ? {} : { targets: [...targets] }),
    ...(targetRefs == null ? {} : { targetRefs: [...targetRefs] }),
  };
}

/**
 * Validate a real local command after repairing only authority-unambiguous FIGHT geometry.
 *
 * A fast player can broadcast before the authority's offer reaches their browser. In that race the local
 * renderer may have no numeric target even though the later offer contains exactly one legal target set.
 * Validating the raw early command first made the repair below unreachable and left the authority waiting
 * forever after rejecting a choice the UI had already closed. Non-FIGHT commands remain raw until after
 * validation so normalization can never hide forbidden extra fields on switch/run/ball messages.
 */
function validateAndNormalizeLocalCommand(
  command: SerializedCommand,
  offer: CoopBattleCommandOffer,
): { command: SerializedCommand; validation: ReturnType<typeof validateCoopBattleCommand> } {
  const candidate = command.command === Command.FIGHT ? normalizeLocalCommand(command, offer) : command;
  const validation = validateCoopBattleCommand(candidate, offer);
  return {
    command: validation.valid ? normalizeLocalCommand(candidate, offer) : candidate,
    validation,
  };
}

function sameNumberSet(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const sortedRight = [...right].sort((a, b) => a - b);
  return [...left].sort((a, b) => a - b).every((value, index) => value === sortedRight[index]);
}

function sameTargetRefSet(
  left: readonly { side: string; pokemonId: number }[] | undefined,
  right: readonly { side: string; pokemonId: number }[],
): boolean {
  if (left == null || left.length !== right.length) {
    return false;
  }
  const key = (target: { side: string; pokemonId: number }) => `${target.side}:${target.pokemonId}`;
  const sortedRight = right.map(key).sort();
  return left
    .map(key)
    .sort()
    .every((value, index) => value === sortedRight[index]);
}

function defaultCommandFromOffer(offer: CoopBattleCommandOffer): SerializedCommand | null {
  const move = offer.moves[0];
  if (move != null) {
    return {
      command: Command.FIGHT,
      cursor: move.slot,
      moveId: move.moveId,
      targets: [...(move.targetSets[0] ?? [])],
      targetRefs: [...(move.targetRefSets[0] ?? [])],
      useMode: MoveUseMode.NORMAL,
    };
  }
  const normalSwitch = offer.switches.find(candidate => candidate.canNormal);
  if (normalSwitch != null) {
    return { command: Command.POKEMON, cursor: normalSwitch.slot, baton: false };
  }
  if (offer.canRun) {
    return { command: Command.RUN, cursor: 0 };
  }
  return null;
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
function commandKey(fieldIndex: number, turn: number, owner?: CoopRole, address?: CoopCommandAddress): string {
  // #819: scope by WAVE too - an ME-spawned battle resets `turn` to 1 within the run, so a
  // stale wave-N buffered command must never satisfy wave-M's request for the same slot+turn.
  let wave = 0;
  try {
    wave = address?.wave ?? globalScene.currentBattle?.waveIndex ?? 0;
  } catch {
    /* engine-free tests have no scene - 0 scopes them all to one battle, the old behavior */
  }
  // #851: the OWNER (a role string, never numeric) keys the slot dimension when present; the
  // field index (numeric) is the fallback. The two value spaces are disjoint, so a mixed session
  // can never key-collide - but paired clients share a protocol version, so it is owner on both
  // or fieldIndex on both.
  const slot = `${owner ?? fieldIndex}:${address?.pokemonId ?? "legacy"}`;
  return `${address?.epoch ?? 0}:${wave}:${slot}:${turn}`;
}

interface CommandRoute {
  fieldIndex: number;
  turn: number;
  owner?: CoopRole | undefined;
  address?: CoopCommandAddress | undefined;
}

interface BufferedCommand extends CommandRoute {
  command: SerializedCommand;
}

interface BufferedCommandRequest extends CommandRoute {
  moveSlots: number[];
  offer?: CoopBattleCommandOffer | undefined;
}

function commandRoute(fieldIndex: number, turn: number, owner?: CoopRole, address?: CoopCommandAddress): CommandRoute {
  return {
    fieldIndex,
    turn,
    ...(owner == null ? {} : { owner }),
    ...(address == null ? {} : { address }),
  };
}

/** Compare immutable command boundaries without treating a reused numeric turn as the same surface. */
function compareCommandBoundary(left: CommandRoute, right: CommandRoute): number {
  for (const [leftPart, rightPart] of [
    [left.address?.epoch ?? 0, right.address?.epoch ?? 0],
    [left.address?.wave ?? 0, right.address?.wave ?? 0],
    [left.turn, right.turn],
  ]) {
    if (leftPart !== rightPart) {
      return leftPart - rightPart;
    }
  }
  return 0;
}

/**
 * Whether two requests name the same immutable command surface.
 *
 * A fully addressed surface is the stable owner/slot plus the exact Pokemon identity. Two copied engines
 * disagreeing on that identity is state divergence, not permission to alias one actor's command onto another.
 * Legacy unaddressed callers retain their historical owner/field matching within their per-runtime relay.
 */
function sameCommandSurface(left: CommandRoute, right: CommandRoute): boolean {
  const sameStableSlot =
    left.owner != null && right.owner != null ? left.owner === right.owner : left.fieldIndex === right.fieldIndex;
  if (left.address == null || right.address == null) {
    return left.address == null && right.address == null && sameStableSlot;
  }
  return (
    sameStableSlot
    && left.address.epoch === right.address.epoch
    && left.address.wave === right.address.wave
    && left.address.pokemonId === right.address.pokemonId
    && left.turn === right.turn
  );
}

function commandAddressLabel(route: CommandRoute): string {
  const address = route.address;
  return `owner=${route.owner ?? "-"} field=${route.fieldIndex} turn=${route.turn} address=${address == null ? "legacy" : `${address.epoch}/${address.wave}/${address.pokemonId}`}`;
}

/** Stable cross-peer command correlation used by submitted diagnostics. */
function commandCausalId(fieldIndex: number, turn: number, owner?: CoopRole, address?: CoopCommandAddress): string {
  if (address != null) {
    return `e${address.epoch}:w${address.wave}:t${turn}:${owner ?? "unknown"}:p${address.pokemonId}`;
  }
  let wave = 0;
  try {
    wave = globalScene.currentBattle?.waveIndex ?? 0;
  } catch {
    /* engine-free tests have no scene; the commandKey fallback uses the same zero wave */
  }
  return `legacy:w${wave}:t${turn}:${owner ?? "slot"}:f${fieldIndex}`;
}

function traceCommand(
  stage: string,
  fieldIndex: number,
  turn: number,
  owner?: CoopRole,
  address?: CoopCommandAddress,
  detail?: string,
): void {
  recordCoopCausalEvent({
    domain: "command",
    stage,
    causalId: commandCausalId(fieldIndex, turn, owner, address),
    ...(owner == null ? {} : { role: owner }),
    ...(address == null ? {} : { epoch: address.epoch, wave: address.wave }),
    turn,
    detail: detail ?? `field=${fieldIndex}`,
  });
}

function commandAddressOf(message: {
  epoch?: number;
  wave?: number;
  pokemonId?: number;
}): CoopCommandAddress | undefined {
  return Number.isSafeInteger(message.epoch)
    && Number.isSafeInteger(message.wave)
    && Number.isSafeInteger(message.pokemonId)
    ? { epoch: message.epoch!, wave: message.wave!, pokemonId: message.pokemonId! }
    : undefined;
}

/**
 * Rides on a {@linkcode CoopTransport} to relay the partner's battle command. One
 * instance per client. The host calls {@linkcode requestPartnerCommand}; the peer
 * sets a responder via {@linkcode onCommandRequest}. Production matching uses the immutable
 * epoch/wave/turn/owner/Pokemon address; legacy callers remain isolated in their unaddressed namespace.
 */
export class CoopBattleSync {
  private readonly transport: CoopTransport;
  private readonly timeoutMs: number;
  private readonly schedule: (cb: () => void, ms: number) => () => void;
  private readonly onCommandTimeout: ((timeout: CoopCommandTimeout) => void) | null;
  /** Set before terminal cancellation releases any retained command promise. */
  private terminalFrozen = false;
  /** Full request state retained until resolution so a replaced channel can reissue it verbatim. */
  private readonly pending = new Map<string, PendingCommandRequest>();
  /**
   * Complete command address -> a `command` that arrived with NO pending request yet (#633,
   * LIVE-C). In lockstep the two clients are NOT time-locked: the peer may broadcast
   * its move before this client reaches that slot's await. Buffer it so the next
   * {@linkcode requestPartnerCommand} for that slot resolves instantly instead of
   * dropping the move and timing out -> AI (the live "stuck 30s then desync" bug).
   *
   * Keyed by the exact epoch/wave/owner/Pokemon/turn, NOT fieldIndex alone (#633 desync fix): a peer
   * that races ahead can broadcast turn N then turn N+1 (or a switch then a move on
   * the same slot) before the awaiter consumes turn N. A fieldIndex-only latest-wins
   * buffer silently overwrote the earlier one, so the awaiter applied the WRONG turn's
   * command -> one client switched/moved while the other did something else (the live
   * move/switch/target desync). Full-address keying makes an await accept only that actor's
   * command at that boundary; stale entries remain isolated or are pruned when their boundary expires.
   */
  private readonly inbox = new Map<string, BufferedCommand>();
  /** The local human's committed pick, retained so a replaced channel can request it again. */
  private readonly localOutbox = new Map<
    string,
    {
      fieldIndex: number;
      turn: number;
      command: SerializedCommand;
      owner?: CoopRole;
      address?: CoopCommandAddress;
    }
  >();
  /** Latest authority offer received for each local command address. */
  private readonly peerOffers = new Map<string, CoopBattleCommandOffer>();
  /** Exactly-once command addresses; late duplicate frames cannot poison a restarted waiter. */
  private readonly settled = new Set<string>();
  private responder: CoopCommandResponder | null = null;
  private readonly offMessage: () => void;
  private readonly offStateChange: () => void;
  private readonly isAuthorityWaitCreationFrozen: () => boolean;

  constructor(transport: CoopTransport, opts: CoopBattleSyncOptions = {}) {
    this.transport = transport;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.schedule = opts.schedule ?? defaultSchedule;
    this.onCommandTimeout = opts.onCommandTimeout ?? null;
    this.isAuthorityWaitCreationFrozen = opts.isAuthorityWaitCreationFrozen ?? (() => false);
    this.offMessage = transport.onMessage(msg => this.handle(msg));
    this.offStateChange = transport.onStateChange(state => {
      if (state !== "connected") {
        return;
      }
      // A command request is an active shared surface, not disposable wire traffic. Reissue every
      // unresolved legal-action offer after a channel replacement so the same turn resumes rather
      // than falling through to a local AI command when the original request/reply was lost.
      for (const request of this.pending.values()) {
        traceCommand(
          "offer-replayed",
          request.fieldIndex,
          request.turn,
          request.owner,
          request.address,
          "channel-replacement",
        );
        this.sendCommandRequest(request);
      }
    });
  }

  /** Fence a fully addressed command release before its promise continuation can authorize local AI. */
  private failClosedAddressedRequest(request: PendingCommandRequest, cause: "timeout" | "decline"): boolean {
    const { owner, address } = request;
    if (owner == null || address == null) {
      return false;
    }
    // Fence FIRST. Even if an injected callback throws, CommandPhase can never reinterpret the terminal
    // release as permission to synthesize the absent owner's command locally.
    this.terminalFrozen = true;
    try {
      this.onCommandTimeout?.({
        epoch: address.epoch,
        wave: address.wave,
        turn: request.turn,
        owner,
        pokemonId: address.pokemonId,
        fieldIndex: request.fieldIndex,
      });
    } catch (error) {
      // The terminal fence remains observable and the retained promise must still settle.
      coopWarn("relay", `command-${cause} terminal callback threw`, error);
    }
    return true;
  }

  private sendCommandRequest(request: {
    fieldIndex: number;
    turn: number;
    moveSlots: number[];
    offer?: CoopBattleCommandOffer | undefined;
    owner?: CoopRole | undefined;
    address?: CoopCommandAddress | undefined;
  }): void {
    traceCommand("offer-sent", request.fieldIndex, request.turn, request.owner, request.address);
    this.transport.send({
      t: "commandRequest",
      fieldIndex: request.fieldIndex,
      turn: request.turn,
      moveSlots: request.moveSlots,
      ...(request.offer == null ? {} : { offer: request.offer }),
      ...(request.owner == null ? {} : { owner: request.owner }),
      ...(request.address == null ? {} : request.address),
    });
  }

  /**
   * HOST: ask the peer for the command for `fieldIndex` on `turn`, offering the
   * `moveSlots` the host computed as legal. Resolves with the peer's chosen
   * command, or `null` if no reply arrives within the timeout. Fully addressed requests synchronously
   * enter the injected terminal fence before that null is observable; only legacy unaddressed callers can
   * retain the historical fallback behavior.
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
    offer?: CoopBattleCommandOffer,
    address?: CoopCommandAddress,
  ): Promise<SerializedCommand | null> {
    if (this.terminalFrozen) {
      traceCommand("rejected", fieldIndex, turn, owner, address, "shared-terminal-frozen");
      return Promise.resolve(null);
    }
    if (this.isAuthorityWaitCreationFrozen()) {
      traceCommand("rejected", fieldIndex, turn, owner, address, "authority-v2-recovery-frozen");
      return Promise.resolve(null);
    }
    const key = commandKey(fieldIndex, turn, owner, address);
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
      const normalized = offer == null ? null : validateAndNormalizeLocalCommand(buffered.command, offer);
      const validation = normalized?.validation ?? { valid: true };
      if (validation.valid) {
        this.settled.add(key);
        if (isCoopDebug()) {
          coopLog(
            "relay",
            `host requestPartnerCommand fieldIndex=${fieldIndex} turn=${turn} moveSlots=[${moveSlots.join(",")}] -> consumed BUFFERED command kind=${buffered.command.command}`,
          );
        }
        traceCommand("applied", fieldIndex, turn, owner, address, "buffered-intent");
        return Promise.resolve(normalized?.command ?? buffered.command);
      }
      traceCommand("rejected", fieldIndex, turn, owner, address, validation.reason ?? "invalid-buffered-intent");
      coopWarn(
        "security",
        `rejected buffered peer command fieldIndex=${fieldIndex} turn=${turn} reason=${validation.reason ?? "invalid"}`,
      );
    }
    return new Promise<SerializedCommand | null>(resolve => {
      let settled = false;
      let cancelTimer: () => void = () => {};
      let request: PendingCommandRequest;
      const finish = (cmd: SerializedCommand | null) => {
        if (settled) {
          return;
        }
        settled = true;
        cancelTimer();
        if (this.pending.get(key) === request) {
          this.pending.delete(key);
        }
        if (cmd != null) {
          this.settled.add(key);
        }
        resolve(cmd);
      };
      request = {
        finish,
        fieldIndex,
        turn,
        moveSlots: [...moveSlots],
        ...(offer == null ? {} : { offer }),
        ...(owner == null ? {} : { owner }),
        ...(address == null ? {} : { address }),
      };
      this.pending.set(key, request);
      cancelTimer = this.schedule(() => {
        coopWarn(
          "relay",
          `host requestPartnerCommand TIMEOUT fieldIndex=${fieldIndex} turn=${turn} after=${this.timeoutMs}ms -> fail closed`,
        );
        traceCommand("timed-out", fieldIndex, turn, owner, address);
        this.failClosedAddressedRequest(request, "timeout");
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

  /** #812/P33: exact addressed requests that arrived before the responder installed (guest mid-replay). */
  private readonly bufferedRequests = new Map<string, BufferedCommandRequest>();
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
  private answerRequest(req: {
    fieldIndex: number;
    turn: number;
    moveSlots: number[];
    offer?: CoopBattleCommandOffer | undefined;
    owner?: CoopRole | undefined;
    address?: CoopCommandAddress | undefined;
  }): void {
    const responder = this.responder;
    if (responder == null) {
      return;
    }
    const command = normalizeResponderCommand(
      responder({
        fieldIndex: req.fieldIndex,
        turn: req.turn,
        moveSlots: req.moveSlots,
        offer: req.offer,
      }),
      req.offer,
    );
    traceCommand("intent-sent", req.fieldIndex, req.turn, req.owner, req.address, `command=${command.command}`);
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
      ...(req.address == null ? {} : req.address),
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
    // guest was still replaying the previous turn). P33 retains only the newest immutable
    // boundary for each surface, so a delayed prior-wave request can never be answered here.
    const buffered = [...this.bufferedRequests.values()];
    this.bufferedRequests.clear();
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
  broadcastLocalCommand(
    fieldIndex: number,
    turn: number,
    command: SerializedCommand,
    owner?: CoopRole,
    address?: CoopCommandAddress,
  ): void {
    recordCoopUiRelayCarrier(
      "battleCommand",
      `field=${fieldIndex} turn=${turn} owner=${owner ?? "-"} command=${command.command}`,
    );
    if (isCoopDebug()) {
      coopLog(
        "relay",
        `broadcastLocalCommand SEND fieldIndex=${fieldIndex} owner=${owner ?? "-"} turn=${turn} command=${command.command} cursor=${command.cursor} moveId=${command.moveId ?? "-"} targets=[${(command.targets ?? []).join(",")}]`,
      );
    }
    // #851: stamp the local mon's resolved owner so the peer's awaiting request (which keys by the
    // SAME owner) matches even when the survivor sits at a different field index across the two engines.
    const key = commandKey(fieldIndex, turn, owner, address);
    const normalizedCommand = normalizeLocalCommand(command, this.peerOffers.get(key));
    traceCommand("intent-sent", fieldIndex, turn, owner, address, `command=${normalizedCommand.command}`);
    const prefix = key.slice(0, key.lastIndexOf(":") + 1);
    for (const cachedKey of [...this.localOutbox.keys()]) {
      if (cachedKey.startsWith(prefix) && Number(cachedKey.slice(prefix.length)) < turn) {
        this.localOutbox.delete(cachedKey);
        this.peerOffers.delete(cachedKey);
        this.settled.delete(cachedKey);
      }
    }
    this.localOutbox.set(key, {
      fieldIndex,
      turn,
      command: normalizedCommand,
      ...(owner == null ? {} : { owner }),
      ...(address == null ? {} : { address }),
    });
    this.transport.send({
      t: "command",
      fieldIndex,
      turn,
      command: normalizedCommand,
      ...(owner == null ? {} : { owner }),
      ...(address == null ? {} : address),
    });
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
    this.localOutbox.clear();
    this.peerOffers.clear();
    this.settled.clear();
    this.responder = null;
    this.bufferedRequests.clear();
  }

  /**
   * Enter terminal command control before releasing retained requests. This ordering is load-bearing:
   * every promise continuation can observe the terminal fence and therefore cannot convert `null` into a
   * local AI decision while the peer is entering the same retained terminal transaction.
   */
  freezeForTerminal(): void {
    this.terminalFrozen = true;
    // Idempotently drain on every call. An addressed timeout sets the fence immediately before invoking
    // the runtime callback; that callback then reaches this method and must still release this request and
    // any sibling command surfaces even though the boolean was already true.
    this.cancelPending();
    this.bufferedRequests.clear();
  }

  /** Whether terminal cancellation, rather than a gameplay timeout fallback, released this relay. */
  isTerminalFrozen(): boolean {
    return this.terminalFrozen;
  }

  /** Terminal membership loss: release every retained request only after recovery is no longer possible. */
  cancelPending(): void {
    for (const request of [...this.pending.values()]) {
      request.finish(null);
    }
    this.pending.clear();
  }

  /** Read-only active command surfaces for recovery snapshots and causal diagnostics. */
  describePendingRequests(): {
    fieldIndex: number;
    turn: number;
    moveSlots: number[];
    offer?: CoopBattleCommandOffer | undefined;
    owner?: CoopRole;
    address?: CoopCommandAddress;
  }[] {
    return [...this.pending.values()].map(request => ({
      fieldIndex: request.fieldIndex,
      turn: request.turn,
      moveSlots: [...request.moveSlots],
      ...(request.offer == null ? {} : { offer: request.offer }),
      ...(request.owner == null ? {} : { owner: request.owner }),
      ...(request.address == null ? {} : { address: request.address }),
    }));
  }

  /**
   * Re-deliver authoritative peer command requests through the same live inbound path after a full snapshot.
   * The whole set is preflighted before any request is admitted: P33 recovery never guesses an owner/entity
   * from a numeric turn, and a stale epoch/wave cannot reopen a prior command surface.
   */
  restorePeerPendingRequests(
    requests: readonly CoopPendingCommandSnapshot[],
    expectedEpoch: number,
    expectedWave?: number,
  ): boolean {
    if (this.terminalFrozen || !Array.isArray(requests) || !Number.isSafeInteger(expectedEpoch)) {
      return false;
    }
    const keys = new Set<string>();
    for (const request of requests) {
      const address = request?.address;
      if (
        !Number.isSafeInteger(request?.fieldIndex)
        || request.fieldIndex < 0
        || request.fieldIndex > 255
        || !Number.isSafeInteger(request.turn)
        || request.turn < 0
        || !Array.isArray(request.moveSlots)
        || request.moveSlots.some(slot => !Number.isSafeInteger(slot) || slot < 0 || slot > 3)
        || (request.owner !== "host" && request.owner !== "guest")
        || request.owner !== this.transport.role
        || address == null
        || !Number.isSafeInteger(address.epoch)
        || address.epoch !== expectedEpoch
        || !Number.isSafeInteger(address.wave)
        || address.wave < 0
        || (expectedWave != null && address.wave !== expectedWave)
        || !Number.isSafeInteger(address.pokemonId)
        || address.pokemonId < 0
      ) {
        coopWarn("relay", "refused malformed or stale snapshot command surface");
        return false;
      }
      const key = commandKey(request.fieldIndex, request.turn, request.owner, address);
      if (keys.has(key)) {
        coopWarn("relay", `refused duplicate snapshot command surface key=${key}`);
        return false;
      }
      keys.add(key);
    }

    for (const request of requests) {
      this.handle({
        t: "commandRequest",
        fieldIndex: request.fieldIndex,
        turn: request.turn,
        moveSlots: [...request.moveSlots],
        ...(request.offer == null ? {} : { offer: request.offer }),
        owner: request.owner!,
        ...request.address!,
      });
    }
    return true;
  }

  /** True when every restored request already has the exact retained local human decision. */
  hasRetainedSnapshotCommand(requests: readonly CoopPendingCommandSnapshot[]): boolean {
    return requests.every(request => {
      if (request.owner == null || request.address == null) {
        return false;
      }
      return this.localOutbox.has(commandKey(request.fieldIndex, request.turn, request.owner, request.address));
    });
  }

  private handle(msg: CoopMessage): void {
    if (msg.t === "commandRequest") {
      const address = commandAddressOf(msg);
      traceCommand("offer-received", msg.fieldIndex, msg.turn, msg.owner, address);
      const key = commandKey(msg.fieldIndex, msg.turn, msg.owner, address);
      if (msg.offer != null) {
        this.peerOffers.set(key, msg.offer);
      }
      const cached = this.localOutbox.get(key);
      if (cached != null) {
        coopLog(
          "relay",
          `peer recv commandRequest fieldIndex=${msg.fieldIndex} turn=${msg.turn} -> replay retained local command`,
        );
        const normalizedCommand = normalizeLocalCommand(cached.command, msg.offer);
        this.localOutbox.set(key, {
          fieldIndex: msg.fieldIndex,
          turn: msg.turn,
          command: normalizedCommand,
          ...(msg.owner == null ? {} : { owner: msg.owner }),
          ...(address == null ? {} : { address }),
        });
        this.transport.send({
          t: "command",
          fieldIndex: msg.fieldIndex,
          turn: msg.turn,
          command: normalizedCommand,
          ...(msg.owner == null ? {} : { owner: msg.owner }),
          ...(address == null ? {} : address),
        });
        return;
      }
      if (this.responder == null) {
        // #812 (live "wrong move / didn't wait" regression of the #693 decline): a missing
        // responder is TRANSIENT whenever this client is still replaying the previous turn
        // when the host already asks for the next command. Deciding by OWNERSHIP:
        //  - the slot IS ours (or ownership unknown): the responder is coming - BUFFER the
        //    request and answer it the moment the responder installs. The host's own
        //    timeout+AI fallback still bounds the worst case, so this can never hang.
        //  - the slot is provably NOT ours (#693's mutual-misresolve deadlock): DECLINE so
        //    the host's await resolves null and its AI fallback breaks the deadlock.
        // A fully addressed request already carries the stable logical owner. That identity must win over
        // a field-index probe: after a host-side half-wipe/recenter, the guest can still render the old field
        // layout while the host has compacted the same guest-owned Pokemon to another index. Re-deriving
        // ownership from that transient index produced a false DECLINE, so the host AI-commanded the guest's
        // mon before its replay reached the real picker (#851 live wave-1/turn-2 trace). Only legacy requests
        // without an owner need the best-effort field-layout probe.
        const ours =
          msg.owner == null ? (this.slotOwnershipProbe?.(msg.fieldIndex) ?? true) : msg.owner === this.transport.role;
        if (ours) {
          coopLog(
            "relay",
            `peer recv commandRequest fieldIndex=${msg.fieldIndex} owner=${msg.owner ?? "-"} turn=${msg.turn} before responder install -> BUFFERED (own slot, #812)`,
          );
          const bufferedRequest: BufferedCommandRequest = {
            fieldIndex: msg.fieldIndex,
            turn: msg.turn,
            moveSlots: msg.moveSlots,
            ...(msg.offer == null ? {} : { offer: msg.offer }),
            ...(msg.owner == null ? {} : { owner: msg.owner }),
            ...(address == null ? {} : { address }),
          };
          let stale = false;
          for (const [bufferedKey, prior] of [...this.bufferedRequests]) {
            const order = compareCommandBoundary(prior, bufferedRequest);
            if (order > 0) {
              stale = true;
              coopWarn(
                "relay",
                `drop stale pre-responder commandRequest (${commandAddressLabel(bufferedRequest)}); `
                  + `newer buffered boundary is ${commandAddressLabel(prior)}`,
              );
              break;
            }
            if (order < 0) {
              this.bufferedRequests.delete(bufferedKey);
              continue;
            }
            if (!sameCommandSurface(prior, bufferedRequest)) {
              continue;
            }
            // The same complete address is an idempotent retransmission. A different entity at the same
            // epoch/wave/turn/slot is conflicting authority; first writer stays canonical and is answered.
            stale = true;
            if (bufferedKey !== key) {
              coopWarn(
                "security",
                `conflicting pre-responder commandRequest at ${commandAddressLabel(bufferedRequest)}; `
                  + `retaining canonical ${commandAddressLabel(prior)}`,
              );
            }
            break;
          }
          if (!stale) {
            this.bufferedRequests.set(key, bufferedRequest);
          }
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
          ...(address == null ? {} : address),
        });
        return;
      }
      this.answerRequest({
        fieldIndex: msg.fieldIndex,
        turn: msg.turn,
        moveSlots: msg.moveSlots,
        ...(msg.offer == null ? {} : { offer: msg.offer }),
        ...(msg.owner == null ? {} : { owner: msg.owner }),
        ...(address == null ? {} : { address }),
      });
      return;
    }
    if (msg.t === "commandRejected") {
      const address = commandAddressOf(msg);
      traceCommand("rejected", msg.fieldIndex, msg.turn, msg.owner, address, msg.reason);
      const route = commandRoute(msg.fieldIndex, msg.turn, msg.owner, address);
      const key = commandKey(msg.fieldIndex, msg.turn, msg.owner, address);
      this.localOutbox.delete(key);
      coopWarn(
        "relay",
        `host rejected local command ${commandAddressLabel(route)} reason=${msg.reason}; exact retained intent dropped`,
      );
      return;
    }
    if (msg.t === "command") {
      // #851: key by the sender's owner when present (stable across a post-half-wipe index skew),
      // else the field index (unchanged). Both the pending resolver and any buffer use this key.
      const address = commandAddressOf(msg);
      const key = commandKey(msg.fieldIndex, msg.turn, msg.owner, address);
      const incomingRoute = commandRoute(msg.fieldIndex, msg.turn, msg.owner, address);
      const request = this.pending.get(key);
      if (this.settled.has(key)) {
        traceCommand("duplicate", msg.fieldIndex, msg.turn, msg.owner, address);
        coopLog("relay", `recv command DUPLICATE fieldIndex=${msg.fieldIndex} turn=${msg.turn} -> ignored`);
        return;
      }
      // #693 compatibility: only an UNADDRESSED legacy DECLINE can release to the caller's AI fallback.
      // A fully addressed decline means the peers disagree about immutable command ownership, so it must
      // enter the same terminal fence as an addressed timeout before the retained promise resolves.
      if (msg.decline && request != null) {
        traceCommand("declined", msg.fieldIndex, msg.turn, msg.owner, address);
        const terminal = this.failClosedAddressedRequest(request, "decline");
        coopLog(
          "relay",
          `recv command DECLINE fieldIndex=${msg.fieldIndex} turn=${msg.turn} -> ${terminal ? "fail closed" : "legacy AI fallback"}`,
        );
        request.finish(null);
        return;
      }
      if (request) {
        if (request.offer != null) {
          const normalized = validateAndNormalizeLocalCommand(msg.command, request.offer);
          const validation = normalized.validation;
          if (!validation.valid) {
            traceCommand("rejected", msg.fieldIndex, msg.turn, msg.owner, address, validation.reason ?? "invalid");
            coopWarn(
              "security",
              `rejected peer command fieldIndex=${msg.fieldIndex} turn=${msg.turn} reason=${validation.reason ?? "invalid"}`,
            );
            this.transport.send({
              t: "commandRejected",
              fieldIndex: msg.fieldIndex,
              turn: msg.turn,
              reason: validation.reason ?? "invalid",
              ...(msg.owner == null ? {} : { owner: msg.owner }),
              ...(address == null ? {} : address),
            });
            const authoritativeDefault = defaultCommandFromOffer(request.offer);
            if (authoritativeDefault == null) {
              coopWarn("security", "invalid peer command had no legal authoritative default; request remains parked");
              return;
            }
            coopWarn(
              "security",
              `committing authoritative default command=${authoritativeDefault.command} cursor=${authoritativeDefault.cursor}`,
            );
            request.finish(authoritativeDefault);
            return;
          }
          if (isCoopDebug()) {
            coopLog(
              "relay",
              `recv command fieldIndex=${msg.fieldIndex} turn=${msg.turn} command=${msg.command.command} -> resolved awaiting request`,
            );
          }
          traceCommand("applied", msg.fieldIndex, msg.turn, msg.owner, address, `command=${msg.command.command}`);
          request.finish(normalized.command);
          return;
        }
        if (isCoopDebug()) {
          coopLog(
            "relay",
            `recv command fieldIndex=${msg.fieldIndex} turn=${msg.turn} command=${msg.command.command} -> resolved awaiting request`,
          );
        }
        traceCommand("applied", msg.fieldIndex, msg.turn, msg.owner, address, `command=${msg.command.command}`);
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
        traceCommand("buffered", msg.fieldIndex, msg.turn, msg.owner, address, `command=${msg.command.command}`);
        this.inbox.set(key, { ...incomingRoute, command: msg.command });
      }
    }
  }
}
