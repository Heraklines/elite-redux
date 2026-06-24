/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op networking transport abstraction (#633, co-op mode).
//
// The game talks to a `CoopTransport`; the concrete implementation is swappable:
//   - `LoopbackTransport` (in-process) NOW - powers unit tests and a local
//     "hotseat" path, and lets all the co-op GAME logic be built + verified
//     headlessly before any real networking exists.
//   - a WebRTC DataChannel transport LATER (phase P6), dropped in behind the
//     same interface.
//
// IMPORTANT (the whole point of the design): every gameplay message flows through
// this transport peer-to-peer. Cloudflare is ONLY ever used for matchmaking /
// signaling to ESTABLISH a transport - never to carry gameplay - so a running
// co-op session costs effectively nothing on CF.
// =============================================================================

/** Which side of a co-op session a client is. Auto-assigned at pairing time (the
 *  player never chooses); the run is host-authoritative, so `host` is the engine
 *  source of truth and `guest` is the thin client. */
export type CoopRole = "host" | "guest";

/** Connection lifecycle of a transport. */
export type CoopConnectionState = "connecting" | "connected" | "disconnected" | "closed";

/** Lifecycle signals exchanged out of band of normal gameplay. */
export type CoopLifecycleEvent = "ready" | "pause" | "resume" | "partner-left";

/**
 * A battle command serialized for the wire. Mirrors the args the engine's
 * `CommandPhase.handleCommand(command, cursor, useMode?, move?)` needs. Filled in
 * fully in phase P2; kept minimal here so the protocol shape exists.
 */
export interface SerializedCommand {
  /** `Command` enum value (FIGHT / BALL / POKEMON / RUN). */
  command: number;
  /** Menu cursor (move slot, ball type, or party slot depending on `command`). */
  cursor: number;
  /** For FIGHT: the chosen move id. */
  moveId?: number;
  /** For FIGHT: resolved target battler indices. */
  targets?: number[];
  /** `MoveUseMode` enum value. */
  useMode?: number;
}

/**
 * The co-op wire protocol: a discriminated union on `t`. This GROWS per
 * implementation phase. Rule: every addition is a NEW `t` value with a typed
 * payload, so a client can ignore an unknown kind gracefully (clients are also
 * version-gated at pairing, but forward-compat keeps reconnects safe).
 */
export type CoopMessage =
  /** Handshake on connect: protocol/game version + the sender's account name + role. */
  | { t: "hello"; version: string; username: string; role: CoopRole }
  /** Keepalive / latency probe. */
  | { t: "ping"; ts: number }
  | { t: "pong"; ts: number }
  /**
   * Host -> peer: the partner's field slot needs a command this `turn`. The host
   * is authoritative, so it sends the LEGAL move slots (indices into the partner
   * mon's moveset) it computed; the peer just picks one and replies with a
   * `command`. `moveSlots` empty => only Struggle is legal (#633, LIVE-C).
   */
  | { t: "commandRequest"; fieldIndex: number; turn: number; moveSlots: number[] }
  /** A player's battle command for their own field slot (phase P2 / LIVE-C reply). */
  | { t: "command"; fieldIndex: number; command: SerializedCommand }
  /** A forced/voluntary switch replacement: bring in party `partySlot` to `fieldIndex` (P2). */
  | { t: "switchChoice"; fieldIndex: number; partySlot: number }
  /**
   * A player's full starter-select snapshot during co-op selection (phase P1).
   * Each player picks on THEIR OWN screen independently; this mirrors that state
   * to the partner so the UI can show "Partner is choosing... / Partner is ready"
   * without sharing a screen. `entries` is the partner's tentative roster (shape
   * mirrors `CoopRosterEntry`; inlined to keep the protocol the lowest layer with
   * no import cycle); `ready` flips true when they lock in.
   */
  | { t: "rosterSync"; role: CoopRole; entries: { speciesId: number; cost: number }[]; ready: boolean }
  /** A choice on an alternation-owned interaction screen (reward / shop / ME) (P4). */
  | { t: "interaction"; screen: string; choice: unknown }
  /** Host -> guest authoritative state checkpoint: a compressed SessionSaveData blob (P2/P5). */
  | { t: "stateSync"; blob: string; seq: number }
  /** Session lifecycle signal (P5). */
  | { t: "lifecycle"; event: CoopLifecycleEvent };

/** A transport moves {@linkcode CoopMessage}s between two paired clients. */
export interface CoopTransport {
  readonly role: CoopRole;
  readonly state: CoopConnectionState;
  /** Send a message to the peer. No-op when not connected. */
  send(msg: CoopMessage): void;
  /** Subscribe to inbound messages. Returns an unsubscribe function. */
  onMessage(handler: (msg: CoopMessage) => void): () => void;
  /** Subscribe to connection-state changes. Returns an unsubscribe function. */
  onStateChange(handler: (state: CoopConnectionState) => void): () => void;
  /** Tear down the connection. */
  close(): void;
}

/**
 * In-process transport: two endpoints wired directly to each other. Each `send`
 * is delivered to the peer's handlers on a microtask, so a handler can never
 * observe its own send re-entrantly (mimics a real async channel). Powers tests
 * and the local hotseat path; no real network involved.
 */
class LoopbackTransport implements CoopTransport {
  public readonly role: CoopRole;
  private _state: CoopConnectionState = "connecting";
  private peer: LoopbackTransport | null = null;
  private readonly msgHandlers = new Set<(msg: CoopMessage) => void>();
  private readonly stateHandlers = new Set<(state: CoopConnectionState) => void>();

  constructor(role: CoopRole) {
    this.role = role;
  }

  get state(): CoopConnectionState {
    return this._state;
  }

  /** @internal Wire the pair and flip to `connected`. */
  _connect(peer: LoopbackTransport): void {
    this.peer = peer;
    this.setState("connected");
  }

  private setState(state: CoopConnectionState): void {
    if (this._state === state) {
      return;
    }
    this._state = state;
    for (const h of [...this.stateHandlers]) {
      h(state);
    }
  }

  send(msg: CoopMessage): void {
    const peer = this.peer;
    if (peer == null || this._state !== "connected") {
      return;
    }
    queueMicrotask(() => {
      if (peer._state !== "connected") {
        return;
      }
      for (const h of [...peer.msgHandlers]) {
        h(msg);
      }
    });
  }

  onMessage(handler: (msg: CoopMessage) => void): () => void {
    this.msgHandlers.add(handler);
    return () => {
      this.msgHandlers.delete(handler);
    };
  }

  onStateChange(handler: (state: CoopConnectionState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  close(): void {
    const peer = this.peer;
    this.peer = null;
    this.setState("closed");
    if (peer != null && peer._state !== "closed") {
      peer.peer = null;
      peer.setState("disconnected");
    }
    this.msgHandlers.clear();
    this.stateHandlers.clear();
  }
}

/** Create a connected host/guest {@linkcode LoopbackTransport} pair (in-process). */
export function createLoopbackPair(): { host: CoopTransport; guest: CoopTransport } {
  const host = new LoopbackTransport("host");
  const guest = new LoopbackTransport("guest");
  host._connect(guest);
  guest._connect(host);
  return { host, guest };
}
