/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op session controller (#633, co-op mode - phase P1).
//
// The runtime "brain" each client owns. It sits on top of a CoopTransport and
// drives the co-op lobby/selection flow from ONE player's point of view:
//   - the LOCAL player picks their own starters on their OWN screen,
//   - the PARTNER picks independently on THEIR screen; we never share a screen,
//     we only mirror the partner's roster + ready state over the transport so the
//     UI can show "Partner is choosing... / <name> is ready" notifications,
//   - when BOTH players have locked in, the host assembles the merged 6-slot
//     launch party (host slots 0..2, guest 3..5) and the run begins.
//
// Pure logic over the transport abstraction - NO game-engine imports - so the
// whole handshake is unit-testable headlessly against a LoopbackTransport (with
// a SpoofGuest standing in for player 2 during local dev).
// =============================================================================

import {
  computeErDataFingerprint,
  diffErDataFingerprint,
  type ErDataFingerprint,
  logErDataFingerprint,
} from "#data/elite-redux/coop/coop-data-fingerprint";
import { CoopRoster, type CoopRosterEntry } from "#data/elite-redux/coop/coop-roster";
import { CoopInteractionTurn } from "#data/elite-redux/coop/coop-session";
import type { CoopMessage, CoopNetcodeMode, CoopRole, CoopTransport } from "#data/elite-redux/coop/coop-transport";

/** Reserved {@linkcode CoopMessage} `screen` tag carrying the interaction-turn
 *  counter (host-authoritative; the guest mirrors it). Distinct from a real
 *  interaction choice so it is dispatched separately. */
const COOP_INTERACTION_TURN_SCREEN = "__turn__";

/** One serialized challenge in the shared run config (#633, LIVE-C). */
export interface CoopChallengeConfig {
  id: number;
  value: number;
  severity: number;
}

/** The authoritative run config the host decides and the guest mirrors. */
export interface CoopRunConfig {
  /** ER difficulty: "youngster" | "ace" | "elite" | "hell". */
  difficulty: string;
  /** The active challenge set (empty for a plain run). */
  challenges: CoopChallengeConfig[];
  /**
   * The host's run seed (#633, LIVE-A). The guest pins its engine to this exact
   * seed so both clients roll identical enemies / RNG and stay in lockstep.
   * Optional: absent when the host hasn't supplied one (the guest then keeps its
   * own seed, the legacy behavior).
   */
  seed?: string | undefined;
  /**
   * The host's chosen co-op netcode (#633, selectable A/B): `"lockstep"` or
   * `"authoritative"`. The guest adopts it so both clients run the same
   * implementation. Optional + additive (absent -> `"lockstep"`, the default).
   */
  netcodeMode?: CoopNetcodeMode | undefined;
}

/** The other role: host's partner is guest and vice-versa. */
export function coopPartnerRole(role: CoopRole): CoopRole {
  return role === "host" ? "guest" : "host";
}

/**
 * A flat snapshot of the session from the LOCAL player's point of view, handed to
 * every {@linkcode CoopSessionController.onChange} listener. The starter-select UI
 * renders the partner-status notifications straight off this.
 */
export interface CoopSessionSnapshot {
  /** Which side the local client is. */
  localRole: CoopRole;
  /** Whether the partner has connected (sent `hello`). */
  partnerConnected: boolean;
  /** The partner's account name once known (from their `hello`), else null. */
  partnerName: string | null;
  /** Local player's pick count / spent points. */
  localCount: number;
  localSpent: number;
  /** Partner's mirrored pick count / spent points. */
  partnerCount: number;
  partnerSpent: number;
  /** Whether the local player has locked in their roster. */
  localReady: boolean;
  /** Whether the partner has locked in their roster. */
  partnerReady: boolean;
  /** Both players locked in AND each brought at least one Pokemon -> ready to launch. */
  bothReady: boolean;
  /** Which player owns the CURRENT alternating interaction (reward / shop / ME). */
  interactionOwner: CoopRole;
  /** Whether it is the LOCAL player's turn to drive the current interaction. */
  localInteractionTurn: boolean;
}

/** Options for {@linkcode CoopSessionController}. */
export interface CoopSessionOptions {
  /** Local account name, announced to the partner in the opening `hello`. */
  username?: string | undefined;
  /** Protocol/game version for the handshake (clients are version-gated at pairing). */
  version?: string | undefined;
  /** Injectable role-tiebreak nonce (tests); defaults to a random value per client. */
  tiebreak?: number | undefined;
}

/**
 * Owns the local player's co-op session state and the transport plumbing. One
 * instance per client; the host's instance is the authority that builds the run.
 */
export class CoopSessionController {
  // NOT readonly: a role CONFLICT (lobby assigned both clients the same role) is
  // reconciled deterministically on the `hello` handshake (#633), which reassigns
  // these. Reconciliation happens before roster/battle, so downstream role-keyed
  // state is unaffected.
  role: CoopRole;
  partnerRoleId: CoopRole;
  /** Per-client random nonce broadcast in `hello` to break a role tie deterministically. */
  private readonly tiebreak: number;
  private readonly transport: CoopTransport;
  private readonly username: string;
  private readonly version: string;

  /** Both halves of the shared roster; local edits its own, partner's is mirrored. */
  private readonly roster = new CoopRoster();
  /** Whose turn it is to drive the current alternating interaction (#633, P4). */
  private interactionTurn = new CoopInteractionTurn();
  /** The host-authoritative run config once received/known (#633, LIVE-C). */
  private _runConfig: CoopRunConfig | null = null;
  /**
   * The active co-op netcode (#633, selectable A/B). Defaults to `"lockstep"` (the
   * safe live default that keeps the visible move synced). The HOST sets it at
   * session start via {@linkcode setNetcodeMode}; the GUEST adopts the host's value
   * off the `runConfig`. Every co-op gate reads this single source of truth.
   */
  private _netcodeMode: CoopNetcodeMode = "lockstep";
  private _localReady = false;
  private _partnerReady = false;
  private _partnerConnected = false;
  private _partnerName: string | null = null;
  /**
   * This client's ER data-table fingerprint (#633, diagnostics), computed once on
   * {@linkcode connect} and retained so the inbound peer `dataFingerprint` can be diffed
   * against it. Null until computed (computed lazily on receipt if the peer's arrives first).
   */
  private _localDataFingerprint: ErDataFingerprint | null = null;

  private readonly changeHandlers = new Set<(snap: CoopSessionSnapshot) => void>();
  private readonly offMessage: () => void;

  constructor(transport: CoopTransport, opts: CoopSessionOptions = {}) {
    this.transport = transport;
    this.role = transport.role;
    this.partnerRoleId = coopPartnerRole(transport.role);
    this.tiebreak = opts.tiebreak ?? Math.random();
    this.username = opts.username ?? (transport.role === "host" ? "Player 1" : "Player 2");
    this.version = opts.version ?? "1";
    this.offMessage = transport.onMessage(msg => this.handleMessage(msg));
  }

  /** Announce ourselves to the partner. Call once the transport is connected. */
  connect(): void {
    this.transport.send({
      t: "hello",
      version: this.version,
      username: this.username,
      role: this.role,
      tiebreak: this.tiebreak,
    });
    // ER data-table fingerprint exchange (#633, diagnostics): compute + log + send OUR
    // fingerprint once, and retain it so the peer's inbound `dataFingerprint` is diffed
    // against it. This is the ROOT-cause catcher for the "two browsers, same build,
    // different move tables" desync - surfaced here, before any battle runs.
    const fp = computeErDataFingerprint();
    this._localDataFingerprint = fp;
    logErDataFingerprint("local", fp);
    this.transport.send({ t: "dataFingerprint", fp });
  }

  /**
   * Apply the LOCAL player's current starter-select picks and broadcast them to
   * the partner. Replaces the local half wholesale (idempotent snapshot sync).
   * Re-applying clears `localReady` only if the caller also calls
   * {@linkcode setLocalReady}; picking does not auto-unready here.
   */
  setLocalRoster(entries: readonly CoopRosterEntry[]): void {
    this.roster.replace(this.role, entries);
    this.broadcastLocal();
    this.emit();
  }

  /** Lock in / un-lock the local roster, broadcasting the new ready state. */
  setLocalReady(ready: boolean): void {
    if (this._localReady === ready) {
      return;
    }
    this._localReady = ready;
    this.broadcastLocal();
    this.emit();
  }

  /** The local player's live roster (their own half), in pick order. */
  localEntries(): readonly CoopRosterEntry[] {
    return this.roster.entries(this.role);
  }

  /** The partner's mirrored roster (their half), in pick order. */
  partnerEntries(): readonly CoopRosterEntry[] {
    return this.roster.entries(this.partnerRoleId);
  }

  get localReady(): boolean {
    return this._localReady;
  }

  get partnerReady(): boolean {
    return this._partnerReady;
  }

  get partnerConnected(): boolean {
    return this._partnerConnected;
  }

  get partnerName(): string | null {
    return this._partnerName;
  }

  /** Both players locked in and each brought at least one Pokemon. */
  bothReady(): boolean {
    return this._localReady && this._partnerReady && this.roster.bothReady();
  }

  /**
   * The merged 6-slot launch party (host 0..2, guest 3..5). The HOST is the
   * authority that builds the run from this; the guest receives the resulting
   * authoritative state. Only meaningful once {@linkcode bothReady} is true.
   */
  mergedLaunchParty(): (CoopRosterEntry | null)[] {
    return this.roster.toMergedParty();
  }

  /**
   * Which player owns the CURRENT alternating interaction screen (reward / shop /
   * mystery encounter) (#633, P4). The owner makes the picks while the partner
   * watches; ownership advances once per completed interaction.
   */
  interactionOwner(): CoopRole {
    return this.interactionTurn.current();
  }

  /** Whether it is the LOCAL player's turn to drive the current interaction. */
  isLocalInteractionTurn(): boolean {
    return this.interactionTurn.isOwner(this.role);
  }

  /**
   * Whether the LOCAL player owns the interaction whose counter is `pinnedCounter` (#633).
   * The phases capture the counter ONCE when an interaction's screen opens and resolve the
   * owner from THAT pinned value (not the live `isLocalInteractionTurn`, which re-reads a
   * counter that an inbound reconcile broadcast can bump mid-interaction). This keeps the
   * owner + relay/cursor seq STABLE for the whole interaction so the watcher never starts
   * following a seq the owner stopped sending on - the cursor-mirror invariant the live
   * "wrong cursor / watcher stuck" regression broke. Mirrors the parity rule in one place.
   */
  isLocalOwnerAtCounter(pinnedCounter: number): boolean {
    return CoopInteractionTurn.ownerOf(pinnedCounter) === this.role;
  }

  /** The raw interaction counter (persisted with the run so a resume continues the order). */
  interactionCounter(): number {
    return this.interactionTurn.toJSON();
  }

  /**
   * Advance to the next interaction's owner (#633, P4). Call once per completed
   * interaction (a multi-step ME counts as one). BOTH clients advance LOCALLY +
   * deterministically (they process the same interactions in lockstep), so the
   * owner-parity + relay seq agree WITHOUT waiting on the network - the old
   * host-only-broadcast counter raced the synchronous interaction start (the guest
   * read a stale counter for an ME firing right after a shop advance -> owner/seq
   * disagreement -> watcher froze). `fromCounter` makes the advance idempotent (the
   * counter observed when the interaction began): a duplicate call for the same
   * interaction is a no-op, so the local advance + the reconcile broadcast can't
   * double-count. The broadcast is kept as a monotonic-max safety net only.
   */
  advanceInteraction(fromCounter?: number): void {
    const advanced = this.interactionTurn.advance(fromCounter);
    if (advanced) {
      this.transport.send({
        t: "interaction",
        screen: COOP_INTERACTION_TURN_SCREEN,
        choice: this.interactionTurn.toJSON(),
      });
    }
    this.emit();
  }

  /** Restore the interaction order from the persisted run record (on resume). */
  restoreInteractionCounter(counter: number): void {
    this.interactionTurn = CoopInteractionTurn.fromJSON(counter);
    this.emit();
  }

  /**
   * HOST: publish the authoritative run config (ER difficulty + challenge set) so
   * the guest mirrors it and the run is coherent (#633, LIVE-C). Stores it locally
   * too. No-op shape-wise on the guest (the guest receives it via the transport).
   */
  broadcastRunConfig(config: CoopRunConfig): void {
    // Pin the active netcode (#633, selectable A/B) into the retained config so the
    // self-healing `requestRunConfig` re-broadcast (and any later read) carries it.
    const netcodeMode = config.netcodeMode ?? this._netcodeMode;
    this._runConfig = { ...config, netcodeMode };
    this._netcodeMode = netcodeMode;
    console.log(
      `[coop-runconfig] host broadcast difficulty=${config.difficulty} netcode=${netcodeMode} (role=${this.role})`,
    );
    this.transport.send({
      t: "runConfig",
      difficulty: config.difficulty,
      challenges: config.challenges,
      // The host's run seed (#633, LIVE-A) rides along so the guest pins to it.
      ...(config.seed === undefined ? {} : { seed: config.seed }),
      // The host's chosen netcode (#633, selectable A/B) so the guest adopts it.
      netcodeMode,
    });
    this.emit();
  }

  /**
   * GUEST: ask the host to (re)send the runConfig (#633). The host broadcasts it once
   * when it picks difficulty; this is the guest's self-healing retry so a single dropped
   * or mistimed `runConfig` can't strand it forever on the "choosing difficulty" screen.
   * Harmless on the host / before the host has picked (the host only answers once it has
   * a config). No-op shape-wise apart from the wire send.
   */
  requestRunConfig(): void {
    this.transport.send({ t: "requestRunConfig" });
  }

  /**
   * The shared run config (host's choice of difficulty + challenges), or null
   * until the host has decided. The guest reads this to apply the host's run setup
   * instead of choosing its own.
   */
  runConfig(): CoopRunConfig | null {
    return this._runConfig;
  }

  /**
   * The active co-op netcode (#633, selectable A/B). `"lockstep"` by default; the
   * HOST sets it at session start and the GUEST adopts the host's value via the
   * `runConfig`. The single read point for every co-op gate.
   */
  get netcodeMode(): CoopNetcodeMode {
    return this._netcodeMode;
  }

  /**
   * Set the co-op netcode (#633, selectable A/B). The HOST calls this at session
   * start; the chosen mode then rides along in {@linkcode broadcastRunConfig} so the
   * guest adopts the same implementation.
   */
  setNetcodeMode(mode: CoopNetcodeMode): void {
    this._netcodeMode = mode;
  }

  /** Current state snapshot from the local point of view. */
  snapshot(): CoopSessionSnapshot {
    return {
      localRole: this.role,
      partnerConnected: this._partnerConnected,
      partnerName: this._partnerName,
      localCount: this.roster.count(this.role),
      localSpent: this.roster.spent(this.role),
      partnerCount: this.roster.count(this.partnerRoleId),
      partnerSpent: this.roster.spent(this.partnerRoleId),
      localReady: this._localReady,
      partnerReady: this._partnerReady,
      bothReady: this.bothReady(),
      interactionOwner: this.interactionTurn.current(),
      localInteractionTurn: this.interactionTurn.isOwner(this.role),
    };
  }

  /** Subscribe to session-state changes. Returns an unsubscribe function. */
  onChange(handler: (snap: CoopSessionSnapshot) => void): () => void {
    this.changeHandlers.add(handler);
    return () => {
      this.changeHandlers.delete(handler);
    };
  }

  /** Tear down: stop listening to the transport (does not close the transport). */
  dispose(): void {
    this.offMessage();
    this.changeHandlers.clear();
  }

  private broadcastLocal(): void {
    this.transport.send({
      t: "rosterSync",
      role: this.role,
      // Carry the FULL starter blob (#633, LIVE-B) when present so the partner
      // rebuilds our mons exactly; speciesId+cost remain for the budget/cap logic.
      entries: this.roster.entries(this.role).map(e => ({
        speciesId: e.speciesId,
        cost: e.cost,
        ...(e.starter === undefined ? {} : { starter: e.starter }),
      })),
      ready: this._localReady,
    });
  }

  private handleMessage(msg: CoopMessage): void {
    switch (msg.t) {
      case "hello": {
        // Deterministic role reconciliation (#633): if the peer claims the SAME role
        // as us (the lobby race assigned both clients the same role - the live "both
        // wait, nobody commands the 2nd slot, 30s stall" bug), break the tie IDENTICALLY
        // on both clients so exactly one ends up host (field 0) and the other guest
        // (field 1). Lower tiebreak nonce -> host; ties fall back to the username, then
        // to the existing role. Runs on the handshake, before roster/battle, so all
        // role-keyed state downstream sees the corrected role.
        if (msg.role === this.role) {
          const peerTie = typeof msg.tiebreak === "number" ? msg.tiebreak : Number.POSITIVE_INFINITY;
          let iAmHost: boolean;
          if (this.tiebreak !== peerTie) {
            iAmHost = this.tiebreak < peerTie;
          } else if (this.username === msg.username) {
            iAmHost = this.role === "host"; // degenerate: identical everything; keep as-is
          } else {
            iAmHost = this.username < msg.username;
          }
          this.role = iAmHost ? "host" : "guest";
          this.partnerRoleId = coopPartnerRole(this.role);
        }
        this._partnerConnected = true;
        this._partnerName = msg.username;
        this.emit();
        break;
      }
      case "rosterSync":
        if (msg.role === this.partnerRoleId) {
          this.roster.replace(this.partnerRoleId, msg.entries);
          this._partnerReady = msg.ready;
          this.emit();
        }
        break;
      case "interaction":
        // Mirror the host-authoritative interaction-turn counter so both clients
        // agree on whose turn it is (#633, P4). A real interaction CHOICE (any
        // other screen) is handled by the encounter layer, not here.
        if (msg.screen === COOP_INTERACTION_TURN_SCREEN && typeof msg.choice === "number") {
          // MONOTONIC-MAX, never a blind overwrite (#633): both clients advance the
          // counter locally in lockstep, so this broadcast is only a reconcile safety
          // net - it pulls a genuinely-behind client forward but can never rewind a
          // correct local counter (the old blind overwrite let a stale/late broadcast
          // clobber the counter and desync the owner/seq calc -> the ME-watcher freeze).
          this.interactionTurn.mergeRemote(msg.choice);
          this.emit();
        }
        break;
      case "runConfig":
        // The HOST decides difficulty + challenges + seed; the guest mirrors them
        // so the run is coherent and both engines stay in lockstep (#633, LIVE-A/C).
        // Only honour it FROM the host.
        if (this.role === "guest") {
          // The guest adopts the host's chosen netcode (#633, selectable A/B); an
          // absent value (an in-flight save from before this field) means "lockstep".
          const netcodeMode = msg.netcodeMode ?? "lockstep";
          console.log(`[coop-runconfig] guest received difficulty=${msg.difficulty} netcode=${netcodeMode}`);
          this._netcodeMode = netcodeMode;
          this._runConfig = { difficulty: msg.difficulty, challenges: msg.challenges, seed: msg.seed, netcodeMode };
          this.emit();
        }
        break;
      case "requestRunConfig":
        // Guest asked us to (re)send the runConfig (#633 self-healing handshake). Only the
        // HOST is the authority, and only once it has actually decided (picked difficulty).
        if (this.role === "host" && this._runConfig != null) {
          console.log("[coop-runconfig] host re-broadcast on guest request");
          this.broadcastRunConfig(this._runConfig);
        }
        break;
      case "dataFingerprint": {
        // The peer's ER data-table fingerprint (#633, diagnostics). Diff it against OUR
        // local one (computed lazily if the peer's arrived before our connect() ran) to
        // surface the ROOT data drift that makes the two clients' move tables disagree.
        if (this._localDataFingerprint == null) {
          this._localDataFingerprint = computeErDataFingerprint();
        }
        const local = this._localDataFingerprint;
        const peer = msg.fp;
        const diff = diffErDataFingerprint(local, peer);
        if (diff.length === 0) {
          console.info("[coop-fp] MATCH - data tables identical across clients");
        } else {
          const detail = diff
            .map(
              name =>
                `${name} local=${local[name as keyof ErDataFingerprint].hash}(${local[name as keyof ErDataFingerprint].n})`
                + ` peer=${peer[name as keyof ErDataFingerprint].hash}(${peer[name as keyof ErDataFingerprint].n})`,
            )
            .join(" ");
          console.warn(`[coop-fp] MISMATCH sections=${diff.join(",")} - ${detail}`);
        }
        break;
      }
      default:
        // ping/pong/command/switchChoice/stateSync/lifecycle are not part of the
        // P1/P4 controller flow; ignore them here.
        break;
    }
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const h of [...this.changeHandlers]) {
      h(snap);
    }
  }
}
