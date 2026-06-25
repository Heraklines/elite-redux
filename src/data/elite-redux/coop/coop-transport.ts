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

// TYPE-ONLY import (fully erased at runtime by `import type`, so this file stays the
// zero-runtime-import lowest layer): the ghost-pool message carries plain-JSON
// `GhostTeamSnapshot`s, which already live in er-ghost-teams (#633 ghost-pool sync).
import type { GhostTeamSnapshot } from "#data/elite-redux/er-ghost-teams";

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
 * A player's FULL starter pick serialized for the wire (#633, LIVE-A/B). The
 * partner's starters cross the transport in full so BOTH clients can rebuild the
 * EXACT same merged launch party (byte-identical species / form / IVs / nature /
 * ability / moves) - a prerequisite for the two engines staying in lockstep over a
 * shared seed. Mirrors the engine `Starter` struct (all fields are plain JSON, so
 * it serializes cleanly over the real WebRTC transport). Distinct from the minimal
 * {@linkcode CoopRosterEntry} (which keeps just speciesId+cost for the budget
 * logic); this is the optional full blob carried alongside it.
 */
export interface CoopSerializedStarter {
  speciesId: number;
  shiny: boolean;
  variant: number;
  formIndex: number;
  female?: boolean | undefined;
  abilityIndex: number;
  passive: boolean;
  nature: number;
  moveset?: number[] | undefined;
  pokerus: boolean;
  nickname?: string | undefined;
  teraType?: number | undefined;
  ivs: number[];
  /** ER Black Shinies (#349): start this mon as a t4 black shiny. */
  erBlackShiny?: boolean | undefined;
}

// =============================================================================
// Host-authoritative battle STREAMING shapes (#633, LIVE-D). The host is the only
// resolution engine; the guest renders these. All plain JSON so they serialize over
// the real WebRTC transport, and structural (no engine-type import) so the transport
// stays the lowest layer. `bi` = battler index (0 host lead, 1 guest lead, 2/3 enemies).
// =============================================================================

/**
 * An opaque, JSON-safe serialized Pokemon: the host's `PokemonData` blob, which the
 * guest reconstructs verbatim (same species/form/level/ability/IVs/moves/hp). Typed
 * structurally so the transport layer imports no engine type; the host/guest code
 * (which may import `PokemonData`) does the (de)serialization.
 */
export type CoopSerializedPokemon = Record<string, unknown>;

/** One enemy mon the guest adopts verbatim instead of regenerating (no RNG on the guest). */
export interface CoopSerializedEnemy {
  /** Field slot this enemy occupies (2 or 3). */
  fieldIndex: number;
  /** The host's serialized enemy Pokemon. */
  data: CoopSerializedPokemon;
}

/** The mutable per-turn battle state of ONE field mon (the guest already has the mon object). */
export interface CoopSerializedMonState {
  /** Battler index of this field mon. */
  bi: number;
  hp: number;
  maxHp: number;
  /** `StatusEffect` enum value (0 = none). */
  status: number;
  /** The 7 stat stages (ATK..ACC/EVA), absolute values. */
  statStages: number[];
  fainted: boolean;
  /** Present only when the mon's form changed this turn. */
  formIndex?: number | undefined;
  /** Present only when the mon's active ability changed this turn (`AbilityId`). */
  abilityId?: number | undefined;
}

/** Authoritative post-turn snapshot: enough to set the guest's field state exactly. */
export interface CoopBattleCheckpoint {
  /** Every occupied field mon's mutable state. */
  field: CoopSerializedMonState[];
  /** `WeatherType` enum value (0 = none) + turns remaining. */
  weather: number;
  weatherTurnsLeft: number;
  /** `TerrainType` enum value (0 = none) + turns remaining. */
  terrain: number;
  terrainTurnsLeft: number;
}

/**
 * One ordered visible thing that happened during a turn. The MVP renders only
 * `message` (narration) and relies on the checkpoint for outcomes; the richer kinds
 * drive per-move animation fidelity in a later pass.
 */
export type CoopBattleEvent =
  /** A battle-log line, ALREADY localized by the host (the guest shows it verbatim). */
  | { k: "message"; text: string }
  /** A mon used a move (cue the "X used Y!" + move animation). */
  | { k: "moveUsed"; bi: number; moveId: number; targets: number[] }
  /** Set + tween a mon's hp to this value. */
  | { k: "hp"; bi: number; hp: number; maxHp: number }
  /** A mon fainted. */
  | { k: "faint"; bi: number }
  /** A mon's stat stage changed to this absolute value (`Stat` enum). */
  | { k: "statStage"; bi: number; stat: number; value: number }
  /** A mon's status changed (`StatusEffect` enum, 0 = cured). */
  | { k: "status"; bi: number; status: number }
  /** Weather changed (`WeatherType` enum). */
  | { k: "weather"; weather: number; turnsLeft: number }
  /** Terrain changed (`TerrainType` enum). */
  | { k: "terrain"; terrain: number; turnsLeft: number }
  /** A mon switched out for the party member at `partySlot`. */
  | { k: "switch"; bi: number; partySlot: number };

/**
 * The co-op wire protocol: a discriminated union on `t`. This GROWS per
 * implementation phase. Rule: every addition is a NEW `t` value with a typed
 * payload, so a client can ignore an unknown kind gracefully (clients are also
 * version-gated at pairing, but forward-compat keeps reconnects safe).
 */
export type CoopMessage =
  /**
   * Handshake on connect: protocol/game version + the sender's account name + role.
   * `tiebreak` (#633) is a per-client random nonce used to DETERMINISTICALLY resolve a
   * role CONFLICT: if the lobby ever assigns both clients the same role, each side
   * independently picks host = the lower tiebreak, so exactly one drives field slot 0
   * and the other slot 1 (without it, both await the other slot and the turn stalls).
   * Optional + additive (older clients omit it; reconciliation then falls back to name).
   */
  | { t: "hello"; version: string; username: string; role: CoopRole; tiebreak?: number }
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
   *
   * Each entry MAY carry the partner's FULL `starter` blob (#633, LIVE-B): the
   * complete serialized starter (form / IVs / nature / ability / moves / ...) so
   * the receiving client rebuilds the partner's mons EXACTLY, not from defaults.
   * Optional + additive: during early selection only speciesId+cost are known, and
   * older clients ignore the extra field gracefully.
   */
  | {
      t: "rosterSync";
      role: CoopRole;
      entries: { speciesId: number; cost: number; starter?: CoopSerializedStarter }[];
      ready: boolean;
    }
  /**
   * Host -> guest: the AUTHORITATIVE run configuration both players share (#633,
   * LIVE-C). The host decides the ER difficulty (youngster/ace/elite/hell) and the
   * challenge set; the guest mirrors them so the run is coherent (the guest never
   * picks its own). `challenges` is the serialized challenge list ({id,value,severity}).
   *
   * `seed` (#633, LIVE-A) is the HOST's run seed: the guest pins its engine to the
   * SAME seed so both clients roll identical enemies / RNG and stay in lockstep.
   * Optional + additive (older clients fall back to their own seed). */
  | {
      t: "runConfig";
      difficulty: string;
      challenges: { id: number; value: number; severity: number }[];
      seed?: string;
    }
  /** A choice on an alternation-owned interaction screen (reward / shop / ME) (P4). */
  | { t: "interaction"; screen: string; choice: unknown }
  /** Host -> guest authoritative state checkpoint: a compressed SessionSaveData blob (P2/P5). */
  | { t: "stateSync"; blob: string; seq: number }
  /**
   * Host -> guest (#633, LIVE-D): the EXACT enemy party the host generated for this
   * `wave`. The guest adopts these verbatim instead of regenerating (so it never rolls
   * its own enemy species/ability/IVs). Sent at encounter start.
   */
  | { t: "enemyPartySync"; wave: number; enemies: CoopSerializedEnemy[] }
  /**
   * Host -> guest (#633): the host's fetched GHOST-TEAM POOL. Ghost teams are pulled
   * per-client from the shared server pool, so the two clients otherwise download
   * DIFFERENT teams and field divergent ghost trainers (desync). The host broadcasts
   * its pool once (on prefetch-resolve, well ahead of the first ghost wave); the guest
   * adopts it verbatim and skips its own fetch, so `takeGhostForWave`'s seeded pick is
   * deterministic on both. `pool` is plain-JSON `GhostTeamSnapshot[]` (type-only import,
   * no value dependency, so the transport stays the lowest layer).
   */
  | { t: "ghostPool"; pool: GhostTeamSnapshot[] }
  /**
   * Host -> guest (#633, LIVE-D): a fully-resolved turn. `events` is the ordered visible
   * log the guest narrates/animates; `checkpoint` is the AUTHORITATIVE post-turn state the
   * guest applies so it can never drift. The guest computes none of this itself.
   */
  | { t: "turnResolution"; turn: number; events: CoopBattleEvent[]; checkpoint: CoopBattleCheckpoint }
  /**
   * Host -> guest (#633, LIVE-D): an out-of-turn authoritative checkpoint (after a
   * switch / capture / encounter start / resume). `reason` is a short tag for logging.
   */
  | { t: "battleCheckpoint"; reason: string; checkpoint: CoopBattleCheckpoint }
  /**
   * Owner -> watcher (#633): the owner's pick on an ALTERNATING-control interaction
   * screen (reward shop / biome shop / mystery encounter). Same seed -> both clients
   * generate the IDENTICAL option pool, so only the CHOICE crosses the wire: the
   * watcher applies `choice` to its own identical pool for the identical outcome.
   *  - `seq`    the interaction-counter value this choice belongs to (stale seq ignored)
   *  - `kind`   "reward" | "biomeShop" | "me" (routing / logging)
   *  - `choice` the picked option index, or a sentinel (-1 = leave/skip, -2 = reroll)
   *  - `data`   optional extra indices (e.g. party-target slot, ME sub-option)
   */
  | { t: "interactionChoice"; seq: number; kind: string; choice: number; data?: number[] }
  /**
   * Owner -> watcher (#633): a COSMETIC live-cursor button on a shared interaction
   * screen. The watcher replays `button` into its identical screen so the partner
   * sees the cursor move / sub-panels open in real time. This is a VISUAL stream
   * only - the authoritative outcome is still the `interactionChoice` commit, so a
   * dropped/late/out-of-order `uiInput` can never change the run, only stutter the
   * cursor.
   *  - `seq`    the shared-screen session id (matches the interaction-counter)
   *  - `n`      monotonic per-session index (FIFO order; dedup; gap detection)
   *  - `button` the Button enum value the owner pressed
   *  - `mode`   the owner's UiMode BEFORE processing it (resync barrier; the watcher
   *             stops mirroring if its mode no longer matches, then the commit drives)
   */
  | { t: "uiInput"; seq: number; n: number; button: number; mode: number }
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
