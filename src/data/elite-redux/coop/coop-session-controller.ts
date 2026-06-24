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

import { CoopRoster, type CoopRosterEntry } from "#data/elite-redux/coop/coop-roster";
import { CoopInteractionTurn } from "#data/elite-redux/coop/coop-session";
import type { CoopMessage, CoopRole, CoopTransport } from "#data/elite-redux/coop/coop-transport";

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
  private _localReady = false;
  private _partnerReady = false;
  private _partnerConnected = false;
  private _partnerName: string | null = null;

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

  /** The raw interaction counter (persisted with the run so a resume continues the order). */
  interactionCounter(): number {
    return this.interactionTurn.toJSON();
  }

  /**
   * Advance to the next interaction's owner (#633, P4). Call ONCE per completed
   * interaction (a multi-step ME counts as one). Host-authoritative: broadcasts the
   * new counter so the partner mirrors the same order.
   */
  advanceInteraction(): void {
    this.interactionTurn.advance();
    this.transport.send({
      t: "interaction",
      screen: COOP_INTERACTION_TURN_SCREEN,
      choice: this.interactionTurn.toJSON(),
    });
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
    this._runConfig = config;
    this.transport.send({
      t: "runConfig",
      difficulty: config.difficulty,
      challenges: config.challenges,
      // The host's run seed (#633, LIVE-A) rides along so the guest pins to it.
      ...(config.seed === undefined ? {} : { seed: config.seed }),
    });
    this.emit();
  }

  /**
   * The shared run config (host's choice of difficulty + challenges), or null
   * until the host has decided. The guest reads this to apply the host's run setup
   * instead of choosing its own.
   */
  runConfig(): CoopRunConfig | null {
    return this._runConfig;
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
          this.interactionTurn = CoopInteractionTurn.fromJSON(msg.choice);
          this.emit();
        }
        break;
      case "runConfig":
        // The HOST decides difficulty + challenges + seed; the guest mirrors them
        // so the run is coherent and both engines stay in lockstep (#633, LIVE-A/C).
        // Only honour it FROM the host.
        if (this.role === "guest") {
          this._runConfig = { difficulty: msg.difficulty, challenges: msg.challenges, seed: msg.seed };
          this.emit();
        }
        break;
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
