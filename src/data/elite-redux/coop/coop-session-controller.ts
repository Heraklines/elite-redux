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

import { setNegotiatedCoopCapabilities } from "#data/elite-redux/coop/coop-capabilities";
import { recordCoopCausalEvent } from "#data/elite-redux/coop/coop-causal-trace";
import {
  computeErDataFingerprint,
  diffErDataFingerprint,
  type ErDataFingerprint,
  logErDataFingerprint,
} from "#data/elite-redux/coop/coop-data-fingerprint";
import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import type { CoopMembershipSnapshotV2 } from "#data/elite-redux/coop/coop-membership";
import { CoopRoster, type CoopRosterEntry } from "#data/elite-redux/coop/coop-roster";
import {
  canonicalCoopParticipantPair,
  isCoopRunId,
  mintCoopRunId,
  sameCoopIdentity,
} from "#data/elite-redux/coop/coop-run-identity";
import { CoopInteractionTurn, type CoopPlayerId, coopSeatOfRole } from "#data/elite-redux/coop/coop-session";
import {
  type CoopAccountIdentityV1,
  type CoopFrameContextV1,
  type CoopP33AuthenticatedContextV1,
  type CoopSessionBindingV1,
  canAdoptCoopP33Rejoin,
  coopFrameContextMatchesBinding,
  coopSeatForAccount,
  createFreshCoopSeatMap,
  validateCoopRunSeatMap,
} from "#data/elite-redux/coop/coop-session-binding";
import { beginCoopMachineWait } from "#data/elite-redux/coop/coop-stall-probe";
import type {
  CoopConnectionState,
  CoopMessage,
  CoopNetcodeMode,
  CoopResumeBlockedReason,
  CoopResumeCheckpointNackReason,
  CoopResumeCommitment,
  CoopRole,
  CoopSessionKind,
  CoopTransport,
} from "#data/elite-redux/coop/coop-transport";
import { COOP_PROTOCOL_VERSION } from "#data/elite-redux/coop/coop-transport";
import { GameModes } from "#enums/game-modes";

export interface CoopResumeCheckpointPersistenceAck {
  success: boolean;
  reason?: CoopResumeCheckpointNackReason;
}

export type CoopResumeCheckpointDelivery =
  | { status: "persisted" }
  | { status: "nack"; reason: CoopResumeCheckpointNackReason }
  | { status: "timeout" }
  | { status: "superseded" }
  | { status: "disposed" };

/** Reserved {@linkcode CoopMessage} `screen` tag carrying the interaction-turn
 *  counter (host-authoritative; the guest mirrors it). Distinct from a real
 *  interaction choice so it is dispatched separately. */
const COOP_INTERACTION_TURN_SCREEN = "__turn__";

function isResumeCommitment(value: CoopResumeCommitment): boolean {
  const players = value?.participants;
  const host = value?.seats?.host;
  const guest = value?.seats?.guest;
  return (
    value?.version === 1
    && typeof value.digest === "string"
    && /^[0-9a-f]{64}$/u.test(value.digest)
    && value.gameMode === GameModes.COOP
    && Number.isInteger(value.wave)
    && value.wave > 0
    && Number.isSafeInteger(value.revision)
    && value.revision >= 0
    && isCoopRunId(value.runId)
    && Number.isSafeInteger(value.checkpointRevision)
    && value.checkpointRevision >= 0
    && Number.isSafeInteger(value.timestamp)
    && value.timestamp >= 0
    && Array.isArray(players)
    && players.length === 2
    && players.every(identity => typeof identity === "string" && identity.length > 0)
    && !sameCoopIdentity(players[0], players[1])
    && canonicalCoopParticipantPair(players[0], players[1])[0] === players[0]
    && typeof host === "string"
    && host.length > 0
    && typeof guest === "string"
    && guest.length > 0
    && !sameCoopIdentity(host, guest)
    && ((sameCoopIdentity(host, players[0]) && sameCoopIdentity(guest, players[1]))
      || (sameCoopIdentity(host, players[1]) && sameCoopIdentity(guest, players[0])))
  );
}

function sameResumeCommitment(a: CoopResumeCommitment | null, b: CoopResumeCommitment): boolean {
  return (
    a != null
    && a.version === b.version
    && a.digest === b.digest
    && a.gameMode === b.gameMode
    && a.wave === b.wave
    && a.revision === b.revision
    && a.runId === b.runId
    && a.checkpointRevision === b.checkpointRevision
    && a.timestamp === b.timestamp
    && sameCoopIdentity(a.participants[0], b.participants[0])
    && sameCoopIdentity(a.participants[1], b.participants[1])
    && sameCoopIdentity(a.seats.host, b.seats.host)
    && sameCoopIdentity(a.seats.guest, b.seats.guest)
  );
}

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
  /**
   * Showdown 1v1 PvP (C1): the session kind. `"coop"` (default when absent) is the
   * classic shared run; `"versus"` is a 1v1 showdown match (teams don't merge). The host
   * pins it and the guest adopts it via the `runConfig`, exactly like {@linkcode netcodeMode}.
   */
  kind?: CoopSessionKind | undefined;
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
  /**
   * #896 W2e-R2: this client's advertised co-op CAPABILITY set (string-keyed feature bits). Carried on
   * `hello` + `rosterSync`; the effective session set is the INTERSECTION with the peer's (see
   * coop-capabilities.ts). When UNDEFINED (the default, e.g. a bare controller test that does not opt
   * into negotiation) the controller sends NO capability field and never negotiates, so the surface
   * flags keep their standalone local meaning. The runtime passes the real advertised set.
   */
  localCapabilities?: readonly string[] | undefined;
  /** Capabilities that must survive negotiation before this runtime may cross the launch barrier. */
  requiredCapabilities?: readonly string[] | undefined;
  /**
   * #896 W2e-R2: invoked once the capability set is (re)negotiated (on the peer's first hello/rosterSync
   * that carries capabilities, and again on a hot-rejoin re-handshake). Receives the frozen effective
   * set. The runtime uses it to drive the per-surface activation from the negotiated intersection.
   */
  onCapabilitiesNegotiated?: ((negotiated: ReadonlySet<string>) => void) | undefined;
  /**
   * Invoked whenever the authenticated P33 binding becomes usable on this channel generation. Capability
   * negotiation deliberately precedes binding construction, so mechanically addressed runtimes (Authority
   * V2, recovery, retained terminals) must install from this later lifecycle edge rather than assuming the
   * first capability callback already has a frame context.
   */
  onAuthenticatedBindingReady?: (() => void) | undefined;
  /** Publishes the host-negotiated operation epoch into every surface adapter. */
  onEpochNegotiated?: ((epoch: number) => void) | undefined;
  /** Production launch requires a matching functional data fingerprint before `bothReady` can open. */
  requireFunctionalFingerprint?: boolean | undefined;
  /** Authenticated public P33 pairing axes. Absent on legacy/manual/loopback sessions. */
  p33?: CoopP33AuthenticatedContextV1 | undefined;
  /** Counter replay pulses allowed before the live runtime enters its shared safe terminal. */
  partnerInteractionRecoveryMaxAttempts?: number | undefined;
  /** Engine-owned terminal hook for an interaction-counter barrier that cannot converge. */
  onPartnerInteractionRecoveryExhausted?: ((failure: CoopPartnerInteractionRecoveryFailure) => void) | undefined;
}

export interface CoopPartnerInteractionRecoveryFailure {
  need: number;
  peerSeen: number;
  attempts: number;
}

type CoopP33HelloMessage = Extract<CoopMessage, { t: "hello"; pairingId: string }>;

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

  /**
   * This client's SEAT / PlayerId (#633, M5): host = seat 0 = the authority, guest = seat 1.
   * Derived from the (reconcilable) live {@linkcode role}, so a hello-handshake role
   * reconciliation moves the seat with it. The N-player generalization keys authority and
   * ownership rules off seats; the binary role stays the 2-player wire representation.
   */
  get seat(): CoopPlayerId {
    return coopSeatOfRole(this.role);
  }
  /** Per-client random nonce broadcast in `hello` to break a role tie deterministically. */
  private readonly tiebreak: number;
  private readonly transport: CoopTransport;
  private readonly username: string;
  private readonly version: string;
  /** #807 C: the partner's hello version (undefined until the handshake). */
  private partnerVersionValue: string | undefined;
  /**
   * #896 W2e-R2: this client's advertised capability set, or undefined when negotiation is not in use
   * (a bare test controller). When defined, it is sent on hello/rosterSync and negotiated against the
   * peer's on receipt.
   */
  private readonly localCapabilities: readonly string[] | undefined;
  private readonly requiredCapabilities: readonly string[];
  private negotiatedCapabilities: ReadonlySet<string> | null = null;
  /** #896 W2e-R2: the partner's advertised capability set (undefined until a hello/rosterSync carries it). */
  private partnerCapabilities: string[] | undefined;
  /** #896 W2e-R2: the callback invoked with the frozen effective set each time it is (re)negotiated. */
  private readonly onCapabilitiesNegotiated: ((negotiated: ReadonlySet<string>) => void) | undefined;
  private readonly onAuthenticatedBindingReady: (() => void) | undefined;
  private readonly onEpochNegotiated: ((epoch: number) => void) | undefined;
  private readonly requireFunctionalFingerprint: boolean;
  private readonly partnerInteractionRecoveryMaxAttempts: number;
  private readonly onPartnerInteractionRecoveryExhausted:
    | ((failure: CoopPartnerInteractionRecoveryFailure) => void)
    | undefined;
  /** Authenticated signaling context; its bearer never leaves this browser. */
  private p33Context: CoopP33AuthenticatedContextV1 | null;
  private p33Binding: CoopSessionBindingV1 | null = null;
  /** Live membership revision; advances on every accepted channel generation without replacing the binding. */
  private p33MembershipRevisionValue = 0;
  private p33BindingReady = false;
  private p33BindingRejected = false;
  private p33BindingBuild: Promise<void> | null = null;
  private p33BindingRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private p33PeerHelloAccepted = false;
  private p33BindingAuthoringEnabled = false;
  private authenticatedProtocolViolation = false;
  /** Candidate belongs to this controller; it becomes authoritative iff this side is host. */
  private readonly epochCandidate: number;
  private sessionEpochValue: number;
  /** Stable host-authored identity for this logical run; empty only on a pre-adoption guest. */
  private runIdValue: string;
  /** Persistence revision advanced only by the host immediately before an authoritative checkpoint. */
  private checkpointRevisionValue = 0;
  /** #810 resume flow: guest-side offer handler + buffered offer, host-side reply waiter. */
  private resumeOfferHandler: ((commitment: CoopResumeCommitment) => void) | null = null;
  private pendingResumeOfferCommitment: CoopResumeCommitment | null = null;
  private activeResumeOfferEpoch = 0;
  private activeResumeOfferCommitment: CoopResumeCommitment | null = null;
  private resumeReplyWaiter: { decisionId: string; finish: (accept: boolean) => void } | null = null;
  private resumeOfferTimer: ReturnType<typeof setTimeout> | null = null;
  /** Guest reply outbox: retained until the host commits ACCEPT, so a flap cannot lose the decision. */
  private pendingResumeReply: {
    readonly decisionId: string;
    readonly accept: boolean;
    readonly promise: Promise<boolean>;
    readonly finish: (committed: boolean) => void;
  } | null = null;
  private resumeReplyTimer: ReturnType<typeof setTimeout> | null = null;
  /** Host waits for actual guest snapshot materialization, not mere receipt/acceptance. */
  private resumeApplyAckWaiter: {
    readonly decisionId: string;
    readonly promise: Promise<boolean>;
    readonly finish: (success: boolean) => void;
  } | null = null;
  private resumeApplyTimer: ReturnType<typeof setTimeout> | null = null;
  /** Guest-side durable apply result, replayed after reconnect if its ACK was lost. */
  private latestResumeApplyResult: { readonly decisionId: string; readonly success: boolean } | null = null;
  /** Guest waits for the host's resumeAppliedAck before it may tear the failed session down. */
  private resumeApplyDeliveryWaiter: {
    readonly decisionId: string;
    readonly promise: Promise<boolean>;
    readonly finish: (acknowledged: boolean) => void;
  } | null = null;
  private resumeApplyDeliveryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Final symmetric resume barrier: guest crosses only after host release; host crosses on its ACK. */
  private latestResumeReleaseId: string | null = null;
  private ackedResumeReleaseId: string | null = null;
  private appliedResumeReleaseId: string | null = null;
  private pendingResumeReleaseId: string | null = null;
  private resumeReleaseArrivalWaiter: { promise: Promise<boolean>; finish: (released: boolean) => void } | null = null;
  private resumeReleaseArrivalTimer: ReturnType<typeof setTimeout> | null = null;
  private resumeReleaseAckWaiter: {
    decisionId: string;
    promise: Promise<boolean>;
    finish: (acknowledged: boolean) => void;
  } | null = null;
  private resumeReleaseAckTimer: ReturnType<typeof setTimeout> | null = null;
  private resumeBlockedHandler: ((reason: CoopResumeBlockedReason, wave: number) => void) | null = null;
  private pendingResumeBlocked: { decisionId: string; reason: CoopResumeBlockedReason; wave: number } | null = null;
  private appliedResumeBlockedId: string | null = null;
  private resumeBlockedAckWaiter: {
    readonly decisionId: string;
    readonly promise: Promise<boolean>;
    readonly finish: (acknowledged: boolean) => void;
  } | null = null;
  private resumeBlockedAckTimer: ReturnType<typeof setTimeout> | null = null;
  private resumeCheckpointHandler:
    | ((
        session: string,
        commitment: CoopResumeCommitment,
        mirrorCloud: boolean,
      ) => Promise<CoopResumeCheckpointPersistenceAck>)
    | null = null;
  private pendingResumeCheckpoint: {
    checkpointId: string;
    commitment: CoopResumeCommitment;
    session: string;
    mirrorCloud: boolean;
  } | null = null;
  private appliedResumeCheckpointId: string | null = null;
  private latestResumeCheckpoint: {
    checkpointId: string;
    commitment: CoopResumeCommitment;
    session: string;
    mirrorCloud: boolean;
  } | null = null;
  private resumeCheckpointAckWaiter: {
    checkpointId: string;
    promise: Promise<CoopResumeCheckpointDelivery>;
    finish: (result: CoopResumeCheckpointDelivery) => void;
  } | null = null;
  private resumeCheckpointAckTimer: ReturnType<typeof setTimeout> | null = null;
  private resumeCheckpointDeliveryTail: Promise<void> = Promise.resolve();
  /** #810 barrier: guest-side "start new" handler + buffered flag (host's release signal). */
  private resumeStartNewHandler: (() => void) | null = null;
  private pendingResumeStartNewId: string | null = null;
  private pendingResumeStartNewEpoch = 0;
  private appliedResumeStartNewId: string | null = null;
  private resumeStartNewAckWaiter: {
    readonly decisionId: string;
    readonly promise: Promise<boolean>;
    readonly finish: (acknowledged: boolean) => void;
  } | null = null;
  private resumeStartNewAckTimer: ReturnType<typeof setTimeout> | null = null;
  private ackedResumeStartNewId: string | null = null;
  /** Durable, host-authored lobby decision. Re-announced after a channel replacement. */
  private latestResumeDecision:
    | {
        readonly kind: "offer";
        readonly decisionId: string;
        readonly epoch: number;
        readonly commitment: CoopResumeCommitment;
      }
    | {
        readonly kind: "resume-accepted";
        readonly decisionId: string;
        readonly epoch: number;
        readonly commitment: CoopResumeCommitment;
      }
    | {
        readonly kind: "start-new";
        readonly decisionId: string;
        readonly epoch: number;
        readonly runId: string;
        readonly checkpointRevision: number;
      }
    | null = null;
  /** Guest-side identity of the latest offer; replies are structurally tied to it. */
  private activeResumeOfferId: string | null = null;
  /** Guest-side de-duplication of an offer re-announced after reconnect. */
  private deliveredResumeOfferId: string | null = null;
  /** Bounded guest-side tombstones prevent delayed, already-settled offers from reopening the lobby UI. */
  private readonly settledResumeOfferReplies = new Map<string, boolean>();
  private resumeDecisionSeq = 0;

  /** Both halves of the shared roster; local edits its own, partner's is mirrored. */
  private readonly roster = new CoopRoster();
  /** Whose turn it is to drive the current alternating interaction (#633, P4). */
  private readonly interactionTurn = new CoopInteractionTurn();
  /** The host-authoritative run config once received/known (#633, LIVE-C). */
  private _runConfig: CoopRunConfig | null = null;
  /**
   * The active co-op netcode (#633 M3): co-op is now AUTHORITATIVE-ONLY (the host is the
   * sole engine, the guest is a pure renderer that runs no combat + no ME engine), so this
   * defaults to `"authoritative"` and the old "lockstep" dual-engine mode is retired. The
   * HOST pins it at session start via {@linkcode setNetcodeMode}; the GUEST adopts the host's
   * value off the `runConfig`. Every co-op gate reads this single source of truth.
   */
  private _netcodeMode: CoopNetcodeMode = "authoritative";
  /**
   * Showdown 1v1 PvP (C1): the session kind. Defaults to `"coop"` (the classic shared run);
   * the HOST pins `"versus"` at session start via {@linkcode setSessionKind} and the GUEST
   * adopts the host's value off the `runConfig`. Read via {@linkcode isVersusSession}.
   */
  private _sessionKind: CoopSessionKind = "coop";
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
  private _functionalFingerprintStatus: "pending" | "match" | "mismatch" = "pending";
  private _presentationFingerprintMismatch = false;

  private readonly changeHandlers = new Set<(snap: CoopSessionSnapshot) => void>();
  /** Dedicated wakeups for compatibility barriers; never fan teardown out as a normal state change. */
  private readonly compatibilityLifecycleHandlers = new Set<() => void>();
  private readonly offMessage: () => void;
  private readonly offStateChange: () => void;
  /** Last transport state observed by the controller; lobby barriers fail closed after teardown/drop. */
  private transportState: CoopConnectionState;
  /** Wakes pending lobby barriers immediately when this controller is disposed. */
  private disposed = false;
  /**
   * #868 self-healing lobby: true once the transport has reported a `disconnected` since we
   * last resynced. A transition BACK to `connected` while this is set is a RECONNECT (a #805
   * hot-rejoin swapped a fresh channel in), which lost every lobby frame sent while the channel
   * was dark - so we re-establish the whole lobby handshake ({@linkcode resyncLobbyState}). The
   * INITIAL `connecting -> connected` never sets this, so a fresh session doesn't double-announce.
   */
  private _sawDisconnect = false;

  constructor(transport: CoopTransport, opts: CoopSessionOptions = {}) {
    this.transport = transport;
    this.p33Context = opts.p33 == null ? null : structuredClone(opts.p33);
    // P33 authority is a stable-seat decision. The WebRTC invitation direction never reaches this axis.
    this.role =
      this.p33Context == null
        ? transport.role
        : this.p33Context.localSeatId === this.p33Context.authoritySeatId
          ? "host"
          : "guest";
    this.partnerRoleId = coopPartnerRole(this.role);
    this.tiebreak = opts.tiebreak ?? Math.random();
    this.username =
      this.p33Context?.account.displayName ?? opts.username ?? (this.role === "host" ? "Player 1" : "Player 2");
    this.version = opts.version ?? "1";
    this.localCapabilities = opts.localCapabilities;
    this.requiredCapabilities = [...(opts.requiredCapabilities ?? [])];
    this.onCapabilitiesNegotiated = opts.onCapabilitiesNegotiated;
    this.onAuthenticatedBindingReady = opts.onAuthenticatedBindingReady;
    this.onEpochNegotiated = opts.onEpochNegotiated;
    this.requireFunctionalFingerprint = opts.requireFunctionalFingerprint ?? false;
    this.partnerInteractionRecoveryMaxAttempts = opts.partnerInteractionRecoveryMaxAttempts ?? 3;
    if (
      !Number.isSafeInteger(this.partnerInteractionRecoveryMaxAttempts)
      || this.partnerInteractionRecoveryMaxAttempts <= 0
    ) {
      throw new Error("invalid partner interaction recovery attempt bound");
    }
    this.onPartnerInteractionRecoveryExhausted = opts.onPartnerInteractionRecoveryExhausted;
    this.epochCandidate = this.mintEpoch(0);
    this.sessionEpochValue = this.role === "host" ? this.epochCandidate : 0;
    this.runIdValue = this.role === "host" ? mintCoopRunId() : "";
    this.transportState = transport.state;
    this.offMessage = transport.onMessage(msg => this.handleMessage(msg));
    // #868: watch the transport lifecycle so a RECONNECT (channel flap -> #805 hot-rejoin)
    // re-establishes the lobby handshake. Every lobby frame sent while the channel was dark is
    // lost; the runtime's rejoin resync only heals BATTLE state (`isCoopAuthoritativeGuest`), so
    // a flap DURING starter-select/difficulty-pick left the two clients permanently divergent.
    this.offStateChange = transport.onStateChange(state => this.handleStateChange(state));
  }

  /** #807 C: true when the partner's hello carried a DIFFERENT protocol version. */
  get versionMismatch(): boolean {
    return this.partnerVersionValue !== undefined && this.partnerVersionValue !== this.version;
  }

  /** #807 C: the partner's reported version ("?" before the handshake). */
  get partnerVersion(): string {
    return this.partnerVersionValue ?? "?";
  }

  /** True when simulation-affecting registries differ; localized name-only drift is tracked separately. */
  get functionalFingerprintMismatch(): boolean {
    return this._functionalFingerprintStatus === "mismatch";
  }

  /** Presentation/localization drift never authorizes different simulation behavior. */
  get presentationFingerprintMismatch(): boolean {
    return this._presentationFingerprintMismatch;
  }

  /** The single launch predicate for protocol + functional-build compatibility. */
  get compatibilityAccepted(): boolean {
    return (
      !this.versionMismatch
      && !this.functionalFingerprintMismatch
      && !this.authenticatedProtocolViolation
      && (this.p33Context == null || (this.p33PeerHelloAccepted && !this.p33BindingRejected))
      && (!this.requireFunctionalFingerprint || this._functionalFingerprintStatus === "match")
      && (this.requiredCapabilities.length === 0
        || (this.negotiatedCapabilities != null
          && this.requiredCapabilities.every(capability => this.negotiatedCapabilities?.has(capability))))
    );
  }

  /** Invitation/SDP role only. It never grants gameplay ownership or authority. */
  get transportRole(): "offerer" | "answerer" {
    return this.p33Context?.transportRole ?? (this.transport.role === "host" ? "offerer" : "answerer");
  }

  get account(): CoopAccountIdentityV1 | null {
    return this.p33Context == null ? null : { ...this.p33Context.account };
  }

  get localSeatId(): number {
    return this.p33Context?.localSeatId ?? this.seat;
  }

  get authoritySeatId(): number {
    return this.p33Context?.authoritySeatId ?? 0;
  }

  get authorityRole(): "authority" | "replica" {
    return this.localSeatId === this.authoritySeatId ? "authority" : "replica";
  }

  get isAuthority(): boolean {
    return this.authorityRole === "authority";
  }

  get authenticatedBinding(): CoopSessionBindingV1 | null {
    return this.p33Binding == null ? null : structuredClone(this.p33Binding);
  }

  /** Whether this controller was created from Worker-authenticated P33 pairing axes. */
  get hasAuthenticatedPairing(): boolean {
    return this.p33Context != null;
  }

  /**
   * Return the exact accepted P33 binding axes. A retained-but-unacknowledged binding is deliberately not
   * authorization: terminal/control traffic may only start after both authenticated seats proved the same
   * immutable session, epoch, seat map, and membership revision.
   */
  private exactP33BindingAxes(): {
    context: CoopP33AuthenticatedContextV1;
    binding: CoopSessionBindingV1;
  } | null {
    const context = this.p33Context;
    const binding = this.p33Binding;
    if (
      this.disposed
      || context == null
      || binding == null
      || !this.p33BindingReady
      || this.p33BindingRejected
      || this.authenticatedProtocolViolation
      || !this.p33PeerHelloAccepted
      || context.version !== 1
      || binding.version !== 1
      || binding.source !== context.source
      || binding.sessionEpoch !== this.sessionEpochValue
      || binding.runId !== this.runIdValue
      || binding.authoritySeatId !== context.authoritySeatId
      || !Number.isSafeInteger(binding.membershipRevision)
      || binding.membershipRevision < 1
      || !Number.isSafeInteger(this.p33MembershipRevisionValue)
      || this.p33MembershipRevisionValue < binding.membershipRevision
      || !Number.isSafeInteger(context.connectionGeneration)
      || context.connectionGeneration < 0
      || !Number.isSafeInteger(context.peerConnectionGeneration)
      || context.peerConnectionGeneration < 0
      || binding.seatMap.version !== 1
      || binding.seatMap.revision !== 1
      || binding.seatMap.seats.length !== 2
      || binding.seatMap.seats.some((seat, index) => seat.seatId !== index)
      || !binding.seatMap.seats.some(seat => seat.seatId === binding.authoritySeatId)
    ) {
      return null;
    }
    const localSeat = coopSeatForAccount(binding.seatMap, context.account.accountId);
    const peerSeat = coopSeatForAccount(binding.seatMap, context.peerAccount.accountId);
    if (
      localSeat == null
      || peerSeat == null
      || localSeat.seatId !== context.localSeatId
      || peerSeat.seatId === localSeat.seatId
    ) {
      return null;
    }
    return { context, binding };
  }

  /** Exact context stamped onto addressed P33 frames once the binding is accepted. */
  p33FrameContext(): CoopFrameContextV1 | null {
    const axes = this.exactP33BindingAxes();
    if (axes == null) {
      return null;
    }
    const { context, binding } = axes;
    return {
      sessionId: binding.sessionId,
      sessionEpoch: binding.sessionEpoch,
      seatMapId: binding.seatMap.seatMapId,
      membershipRevision: this.p33MembershipRevisionValue,
      fromSeatId: context.localSeatId,
      connectionGeneration: context.connectionGeneration,
    };
  }

  /**
   * Runtime-scoped P33 membership for retained ACK quorums. Seat ownership and display identity come from
   * the authenticated binding, while channel generations come from the latest Worker-authenticated context.
   * Legacy, unbound, rejected, or not-yet-reacknowledged sessions fail closed.
   */
  p33MembershipSnapshot(): CoopMembershipSnapshotV2 | null {
    const axes = this.exactP33BindingAxes();
    if (axes == null) {
      return null;
    }
    const { context, binding } = axes;
    const identities = new Map<string, { displayName: string; connectionGeneration: number }>([
      [
        context.account.accountId,
        { displayName: context.account.displayName, connectionGeneration: context.connectionGeneration },
      ],
      [
        context.peerAccount.accountId,
        { displayName: context.peerAccount.displayName, connectionGeneration: context.peerConnectionGeneration },
      ],
    ]);
    const members: CoopMembershipSnapshotV2["members"] = [];
    for (const seat of binding.seatMap.seats) {
      const identity = identities.get(seat.accountId);
      if (identity == null) {
        return null;
      }
      members.push({
        seatId: seat.seatId,
        accountId: seat.accountId,
        displayName: identity.displayName,
        state: "present",
        connectionGeneration: identity.connectionGeneration,
      });
    }
    return {
      version: 2,
      revision: this.p33MembershipRevisionValue,
      authoritySeatId: binding.authoritySeatId,
      state: "active",
      members,
      requiredAckSeats: members.map(member => member.seatId),
    };
  }

  /**
   * Authenticate an incoming addressed frame as the exact peer seat on the accepted P33 binding. The
   * membership revision is supplied by the retained transaction and may be frozen before a hot rejoin; it
   * must belong to this immutable binding's revision history, while generation must equal the current channel.
   */
  validateP33PeerFrameContext(context: CoopFrameContextV1, targetMembershipRevision: number): boolean {
    const axes = this.exactP33BindingAxes();
    return (
      axes != null
      && Number.isSafeInteger(targetMembershipRevision)
      && targetMembershipRevision >= axes.binding.membershipRevision
      && targetMembershipRevision <= this.p33MembershipRevisionValue
      && coopFrameContextMatchesBinding(
        context,
        axes.binding,
        axes.context.peerAccount.accountId,
        axes.context.peerConnectionGeneration,
        targetMembershipRevision,
      )
    );
  }

  /** Adopt a Worker-authenticated hot rejoin without changing seat, authority, run, or epoch. */
  adoptP33Rejoin(next: CoopP33AuthenticatedContextV1): boolean {
    if (
      this.p33Context == null
      || this.p33Binding == null
      || !canAdoptCoopP33Rejoin(this.p33Context, next)
      || !Number.isSafeInteger(this.p33MembershipRevisionValue)
      || this.p33MembershipRevisionValue < this.p33Binding.membershipRevision
      || this.p33MembershipRevisionValue === Number.MAX_SAFE_INTEGER
    ) {
      coopWarn("launch", "REFUSE P33 hot rejoin because authenticated binding axes changed");
      return false;
    }
    this.p33Context = structuredClone(next);
    this.p33MembershipRevisionValue++;
    // A fresh channel must prove the retained binding again. Authority replays it; replica re-ACKs it.
    this.p33BindingReady = false;
    this.p33BindingRejected = false;
    this.p33PeerHelloAccepted = false;
    this.clearP33BindingRetry();
    return true;
  }

  /** The agreed host-authored control-plane epoch (0 only before a guest receives hello). */
  get sessionEpoch(): number {
    return this.sessionEpochValue;
  }

  get runId(): string {
    return this.runIdValue;
  }

  get checkpointRevision(): number {
    return this.checkpointRevisionValue;
  }

  /** Host-only: advance exactly once immediately before serializing a durable save checkpoint. */
  advanceCheckpointRevision(): number {
    if (this.role !== "host" || !isCoopRunId(this.runIdValue)) {
      coopWarn("launch", `REFUSE checkpoint revision advance role=${this.role} run=${this.runIdValue || "unset"}`);
      return this.checkpointRevisionValue;
    }
    this.checkpointRevisionValue++;
    return this.checkpointRevisionValue;
  }

  /** Restore/adopt an exact persisted run identity. A guest may only advance monotonically within one run. */
  restoreCheckpointIdentity(runId: string, checkpointRevision: number, reason: string): boolean {
    if (!isCoopRunId(runId) || !Number.isSafeInteger(checkpointRevision) || checkpointRevision < 0) {
      coopWarn("launch", `REFUSE invalid checkpoint identity reason=${reason}`);
      return false;
    }
    if (this.runIdValue === runId && checkpointRevision < this.checkpointRevisionValue) {
      coopWarn(
        "launch",
        `REFUSE checkpoint revision rollback run=${runId} incoming=${checkpointRevision} current=${this.checkpointRevisionValue}`,
      );
      return false;
    }
    this.runIdValue = runId;
    this.checkpointRevisionValue = checkpointRevision;
    coopLog("launch", `RUN IDENTITY ${reason} run=${runId} checkpointRev=${checkpointRevision}`);
    return true;
  }

  private mintFreshRunIdentity(reason: string): void {
    if (this.role !== "host") {
      return;
    }
    this.runIdValue = mintCoopRunId();
    this.checkpointRevisionValue = 0;
    coopLog("launch", `RUN IDENTITY fresh reason=${reason} run=${this.runIdValue}`);
  }

  /** Cold start/resume boundary: the previous binding cannot authorize the newly-minted epoch. */
  private prepareP33BindingForCurrentBoundary(authorBinding: boolean, source: CoopSessionBindingV1["source"]): void {
    if (this.p33Context == null) {
      return;
    }
    this.clearP33BindingRetry();
    this.p33Context.source = source;
    this.p33Binding = null;
    this.p33MembershipRevisionValue = 0;
    this.p33BindingReady = false;
    this.p33BindingRejected = false;
    this.p33BindingAuthoringEnabled = authorBinding;
  }

  /** Host-only hard boundary: cold resume/new run. Hot rejoin deliberately never calls this. */
  beginNewOperationEpoch(reason: string, announce = true): number {
    if (this.role !== "host") {
      coopWarn("launch", `IGNORE beginNewOperationEpoch(${reason}) on non-host role=${this.role}`);
      return this.sessionEpochValue;
    }
    this.sessionEpochValue = this.mintEpoch(this.sessionEpochValue);
    coopLog("launch", `EPOCH MINT epoch=${this.sessionEpochValue} reason=${reason}`);
    this.onEpochNegotiated?.(this.sessionEpochValue);
    if (announce) {
      this.sendHello();
    }
    return this.sessionEpochValue;
  }

  private mintEpoch(previous: number): number {
    const candidate = Date.now() * 1024 + Math.floor(Math.random() * 1024);
    return Number.isSafeInteger(candidate) && candidate > previous ? candidate : previous + 1;
  }

  private sendHello(): void {
    if (this.p33Context != null) {
      const binding = this.p33Binding;
      this.transport.send({
        t: "hello",
        version: COOP_PROTOCOL_VERSION,
        pairingId: this.p33Context.pairingId,
        account: { ...this.p33Context.account },
        transportRole: this.p33Context.transportRole,
        authorityClaim: this.authorityRole,
        capabilities: [...(this.localCapabilities ?? [])],
        ...(binding == null
          ? {}
          : {
              existingBinding: {
                sessionId: binding.sessionId,
                ...(binding.runId == null ? {} : { runId: binding.runId }),
                sessionEpoch: binding.sessionEpoch,
                seatMapId: binding.seatMap.seatMapId,
                authoritySeatId: binding.authoritySeatId,
                membershipRevision: binding.membershipRevision,
              },
            }),
      });
      if (this.isAuthority && this.p33PeerHelloAccepted && binding != null && !this.p33BindingReady) {
        this.transmitP33Binding();
      }
      this.ensureP33Binding();
      return;
    }
    this.transport.send({
      t: "hello",
      version: this.version,
      username: this.username,
      role: this.role,
      tiebreak: this.tiebreak,
      epoch: this.sessionEpochValue,
      ...(isCoopRunId(this.runIdValue)
        ? { runId: this.runIdValue, checkpointRevision: this.checkpointRevisionValue }
        : {}),
      ...(this.localCapabilities === undefined ? {} : { capabilities: [...this.localCapabilities] }),
    });
  }

  /**
   * #896 W2e-R2: (re)negotiate the session capability set from OUR advertised set and the peer's, and
   * publish it. Called on every hello/rosterSync that could carry the peer's capabilities. A no-op when
   * this controller does not advertise a set (negotiation not in use). Idempotent: recomputing from the
   * same two sets yields the same frozen result (so a hot-rejoin re-handshake preserves the negotiation).
   * The peer's set is REMEMBERED, so a later frame that omits the field (e.g. a self-heal rosterSync from
   * an older code path) does not erase a set the peer already advertised.
   */
  private negotiateCapabilities(peerCapabilities: string[] | undefined): void {
    if (this.localCapabilities === undefined) {
      return; // negotiation not in use (bare controller); surfaces keep their standalone local flags.
    }
    if (peerCapabilities !== undefined) {
      this.partnerCapabilities = [...peerCapabilities];
    }
    const negotiated = setNegotiatedCoopCapabilities(this.localCapabilities, this.partnerCapabilities);
    this.negotiatedCapabilities = negotiated;
    for (const capability of this.requiredCapabilities) {
      if (!negotiated.has(capability)) {
        coopWarn("launch", `REQUIRED capability missing after negotiation: ${capability}; launch remains closed`);
      }
    }
    this.onCapabilitiesNegotiated?.(negotiated);
    this.notifyCompatibilityLifecycle();
  }

  /** #817: watcher-side hook - the partner's ME option cursor moved. */
  public onMeCursor: ((index: number) => void) | null = null;

  /** #817: owner-side send - mirror the local ME option cursor to the watcher. */
  public sendMeCursor(index: number): void {
    try {
      this.transport.send({ t: "meCursor", index });
    } catch {
      /* cosmetic channel - a lost cursor move is fine */
    }
  }

  /**
   * #810 GUEST: arm the resume-offer handler. If the host's offer already arrived
   * (the wire beat the UI), it fires immediately from the buffer.
   */
  armResumeOfferHandler(handler: (commitment: CoopResumeCommitment) => void): void {
    this.resumeOfferHandler = handler;
    if (this.pendingResumeOfferCommitment != null) {
      const commitment = this.pendingResumeOfferCommitment;
      this.pendingResumeOfferCommitment = null;
      handler(commitment);
    }
  }

  /**
   * #810 HOST: offer to resume the saved run at `wave`; resolves with the guest's
   * answer (false on a 60s no-reply timeout so the lobby can never hang on it).
   */
  offerResume(commitment: CoopResumeCommitment, timeoutMs = 60_000): Promise<boolean> {
    if (
      this.role !== "host"
      || !isResumeCommitment(commitment)
      || !this.resumeCommitmentMatchesCurrentSession(commitment)
    ) {
      coopWarn("launch", "REFUSE malformed/foreign resume commitment before offer");
      return Promise.resolve(false);
    }
    this.cancelResumeOfferWait(false);
    const decisionId = `${Date.now().toString(36)}-${this.tiebreak.toString(36)}-${++this.resumeDecisionSeq}`;
    this.latestResumeDecision = { kind: "offer", decisionId, epoch: this.sessionEpochValue, commitment };
    recordCoopCausalEvent({
      domain: "lobby",
      stage: "resume-offered",
      causalId: decisionId,
      role: "host",
      epoch: this.sessionEpochValue,
      wave: commitment.wave,
    });
    coopLog(
      "launch",
      `SEND resumeOffer id=${decisionId} wave=${commitment.wave} digest=${commitment.digest} (#810 durable)`,
    );
    return new Promise<boolean>(resolve => {
      const finish = (accept: boolean) => {
        if (this.resumeReplyWaiter?.finish === finish) {
          this.resumeReplyWaiter = null;
        }
        if (this.resumeOfferTimer != null) {
          clearTimeout(this.resumeOfferTimer);
          this.resumeOfferTimer = null;
        }
        resolve(accept);
      };
      this.resumeReplyWaiter = { decisionId, finish };
      this.resumeOfferTimer = setTimeout(
        () => {
          if (this.resumeReplyWaiter?.finish === finish) {
            coopWarn("launch", "resumeOffer TIMEOUT (no reply in 60s) -> treated as declined (#810)");
            finish(false);
          }
        },
        Math.max(0, timeoutMs),
      );
      this.transport.send({ t: "resumeOffer", decisionId, epoch: this.sessionEpochValue, commitment });
    });
  }

  /**
   * GUEST: answer the exact offer. ACCEPT is a two-phase transaction: this promise resolves true only after
   * the host commits it and returns the authoritative cold-resume epoch. The reply remains in an outbox and
   * is re-sent after reconnect, so a dropped reply can never split guest=resume / host=lobby.
   */
  replyResume(accept: boolean, timeoutMs = 120_000): Promise<boolean> {
    const decisionId = this.activeResumeOfferId;
    if (decisionId == null) {
      coopWarn("launch", `DROP resumeReply accept=${accept}: no active host offer`);
      return Promise.resolve(false);
    }
    if (!accept) {
      coopLog("launch", `SEND resumeReply id=${decisionId} accept=false (#810 durable)`);
      this.rememberSettledResumeOfferReply(decisionId, false);
      this.pendingResumeOfferCommitment = null;
      this.activeResumeOfferId = null;
      this.activeResumeOfferEpoch = 0;
      this.activeResumeOfferCommitment = null;
      this.transport.send({ t: "resumeReply", decisionId, accept: false });
      return Promise.resolve(false);
    }
    if (this.pendingResumeReply?.decisionId === decisionId && this.pendingResumeReply.accept) {
      this.transport.send({ t: "resumeReply", decisionId, accept: true });
      return this.pendingResumeReply.promise;
    }
    this.pendingResumeOfferCommitment = null;
    this.cancelPendingResumeReply(false);
    coopLog("launch", `SEND resumeReply id=${decisionId} accept=${accept} (#810 durable)`);
    let finish!: (committed: boolean) => void;
    const promise = new Promise<boolean>(resolve => {
      finish = committed => {
        if (this.resumeReplyTimer != null) {
          clearTimeout(this.resumeReplyTimer);
          this.resumeReplyTimer = null;
        }
        resolve(committed);
      };
    });
    this.pendingResumeReply = { decisionId, accept: true, promise, finish };
    recordCoopCausalEvent({
      domain: "lobby",
      stage: "resume-accepted-proposed",
      causalId: decisionId,
      role: "guest",
      epoch: this.sessionEpochValue,
    });
    this.resumeReplyTimer = setTimeout(
      () => {
        if (this.pendingResumeReply?.decisionId === decisionId) {
          this.pendingResumeReply = null;
          coopWarn("launch", `resumeAccepted TIMEOUT id=${decisionId} -> fail closed`);
          finish(false);
        }
      },
      Math.max(0, timeoutMs),
    );
    this.transport.send({ t: "resumeReply", decisionId, accept: true });
    return promise;
  }

  /** HOST: wait until the guest actually applied the accepted resume snapshot. */
  awaitResumeApplied(timeoutMs = 120_000): Promise<boolean> {
    const waiter = this.resumeApplyAckWaiter;
    if (waiter == null) {
      return Promise.resolve(false);
    }
    if (this.resumeApplyTimer != null) {
      clearTimeout(this.resumeApplyTimer);
    }
    this.resumeApplyTimer = setTimeout(
      () => {
        if (this.resumeApplyAckWaiter === waiter) {
          coopWarn("launch", `resumeApplied TIMEOUT id=${waiter.decisionId} -> fail closed`);
          this.resumeApplyAckWaiter = null;
          this.resumeApplyTimer = null;
          waiter.finish(false);
        }
      },
      Math.max(0, timeoutMs),
    );
    return waiter.promise;
  }

  /**
   * GUEST: report only after applyCoopLaunchSession completed (success or explicit failure), then
   * wait for the host's explicit observation ACK. The negative path must not tear its transport down
   * until this bounded delivery finishes, otherwise the host waits for its long apply timeout.
   */
  reportResumeApplied(success: boolean, timeoutMs = 5_000): Promise<boolean> {
    const decisionId = this.activeResumeOfferId;
    if (decisionId == null) {
      coopWarn("launch", `DROP resumeApplied success=${success}: no active committed offer`);
      return Promise.resolve(false);
    }
    if (this.resumeApplyDeliveryWaiter?.decisionId === decisionId) {
      const waiter = this.resumeApplyDeliveryWaiter;
      this.transport.send({ t: "resumeApplied", decisionId, success });
      return waiter.promise;
    }
    this.cancelResumeApplyDelivery(false);
    this.latestResumeApplyResult = { decisionId, success };
    recordCoopCausalEvent({
      domain: "snapshot",
      stage: success ? "resume-materialized" : "resume-materialize-failed",
      causalId: `${decisionId}:snapshot`,
      parentId: decisionId,
      role: "guest",
      epoch: this.sessionEpochValue,
    });
    let finish!: (acknowledged: boolean) => void;
    const promise = new Promise<boolean>(resolve => {
      finish = acknowledged => {
        if (this.resumeApplyDeliveryTimer != null) {
          clearTimeout(this.resumeApplyDeliveryTimer);
          this.resumeApplyDeliveryTimer = null;
        }
        resolve(acknowledged);
      };
    });
    this.resumeApplyDeliveryWaiter = { decisionId, promise, finish };
    this.resumeApplyDeliveryTimer = setTimeout(
      () => {
        if (this.resumeApplyDeliveryWaiter?.decisionId === decisionId) {
          this.resumeApplyDeliveryWaiter = null;
          coopWarn("launch", `resumeAppliedAck TIMEOUT id=${decisionId} -> delivery unconfirmed`);
          finish(false);
        }
      },
      Math.max(0, timeoutMs),
    );
    this.transport.send({ t: "resumeApplied", decisionId, success });
    return promise;
  }

  /** HOST: release the final resume barrier only after both exact snapshots are materialized. */
  releaseResumeGameplay(timeoutMs = 15_000): Promise<boolean> {
    const decision = this.latestResumeDecision;
    if (this.role !== "host" || decision?.kind !== "resume-accepted") {
      return Promise.resolve(false);
    }
    const decisionId = decision.decisionId;
    if (this.ackedResumeReleaseId === decisionId) {
      return Promise.resolve(true);
    }
    if (this.resumeReleaseAckWaiter?.decisionId === decisionId) {
      const waiter = this.resumeReleaseAckWaiter;
      this.transport.send({ t: "resumeRelease", decisionId });
      return waiter.promise;
    }
    this.cancelResumeReleaseAck(false);
    this.latestResumeReleaseId = decisionId;
    let finish!: (acknowledged: boolean) => void;
    const promise = new Promise<boolean>(resolve => {
      finish = resolve;
    });
    this.resumeReleaseAckWaiter = { decisionId, promise, finish };
    this.resumeReleaseAckTimer = setTimeout(
      () => {
        if (this.resumeReleaseAckWaiter?.decisionId === decisionId) {
          this.resumeReleaseAckWaiter = null;
          this.resumeReleaseAckTimer = null;
          coopWarn("launch", `resumeReleaseAck TIMEOUT id=${decisionId}; retained for reconnect retry`);
          finish(false);
        }
      },
      Math.max(0, timeoutMs),
    );
    this.transport.send({ t: "resumeRelease", decisionId });
    return promise;
  }

  /** GUEST: remain behind the final lobby boundary until the host explicitly releases it. */
  awaitResumeGameplayRelease(timeoutMs = 120_000): Promise<boolean> {
    const decisionId = this.activeResumeOfferId;
    if (this.role !== "guest" || decisionId == null) {
      return Promise.resolve(false);
    }
    if (this.appliedResumeReleaseId === decisionId) {
      this.transport.send({ t: "resumeReleaseAck", decisionId });
      return Promise.resolve(true);
    }
    if (this.resumeReleaseArrivalWaiter != null) {
      return this.resumeReleaseArrivalWaiter.promise;
    }
    let finish!: (released: boolean) => void;
    const promise = new Promise<boolean>(resolve => {
      finish = resolve;
    });
    this.resumeReleaseArrivalWaiter = { promise, finish };
    this.resumeReleaseArrivalTimer = setTimeout(
      () => {
        if (this.resumeReleaseArrivalWaiter?.finish === finish) {
          this.resumeReleaseArrivalWaiter = null;
          this.resumeReleaseArrivalTimer = null;
          coopWarn("launch", `resumeRelease TIMEOUT id=${decisionId}`);
          finish(false);
        }
      },
      Math.max(0, timeoutMs),
    );
    if (this.pendingResumeReleaseId === decisionId) {
      this.pendingResumeReleaseId = null;
      this.appliedResumeReleaseId = decisionId;
      this.transport.send({ t: "resumeReleaseAck", decisionId });
      this.cancelResumeReleaseArrival(true);
    }
    return promise;
  }

  armResumeBlockedHandler(handler: (reason: CoopResumeBlockedReason, wave: number) => void): void {
    this.resumeBlockedHandler = handler;
    const pending = this.pendingResumeBlocked;
    if (pending != null) {
      this.pendingResumeBlocked = null;
      this.resumeBlockedHandler = null;
      this.appliedResumeBlockedId = pending.decisionId;
      this.transport.send({ t: "resumeBlockedAck", decisionId: pending.decisionId });
      handler(pending.reason, pending.wave);
    }
  }

  sendResumeBlocked(reason: CoopResumeBlockedReason, wave: number, timeoutMs = 5_000): Promise<boolean> {
    this.cancelResumeBlockedWait(false);
    const decisionId = `${Date.now().toString(36)}-${this.tiebreak.toString(36)}-${++this.resumeDecisionSeq}`;
    let finish!: (acknowledged: boolean) => void;
    const promise = new Promise<boolean>(resolve => {
      finish = acknowledged => {
        if (this.resumeBlockedAckTimer != null) {
          clearTimeout(this.resumeBlockedAckTimer);
          this.resumeBlockedAckTimer = null;
        }
        resolve(acknowledged);
      };
    });
    this.resumeBlockedAckWaiter = { decisionId, promise, finish };
    this.resumeBlockedAckTimer = setTimeout(
      () => {
        if (this.resumeBlockedAckWaiter?.decisionId === decisionId) {
          this.resumeBlockedAckWaiter = null;
          coopWarn("launch", `resumeBlockedAck TIMEOUT id=${decisionId}`);
          finish(false);
        }
      },
      Math.max(0, timeoutMs),
    );
    this.transport.send({ t: "resumeBlocked", decisionId, reason, wave });
    return promise;
  }

  armResumeCheckpointHandler(
    handler: (
      session: string,
      commitment: CoopResumeCommitment,
      mirrorCloud: boolean,
    ) => Promise<CoopResumeCheckpointPersistenceAck>,
  ): void {
    if (this.role !== "guest") {
      return;
    }
    this.resumeCheckpointHandler = handler;
    const pending = this.pendingResumeCheckpoint;
    if (pending != null) {
      this.pendingResumeCheckpoint = null;
      this.enqueueResumeCheckpointPersistence(pending);
    }
  }

  sendResumeCheckpoint(
    session: string,
    commitment: CoopResumeCommitment,
    timeoutMs = 5_000,
    mirrorCloud = false,
  ): Promise<boolean> {
    return this.sendResumeCheckpointDetailed(session, commitment, timeoutMs, mirrorCloud).then(
      result => result.status === "persisted",
    );
  }

  sendResumeCheckpointDetailed(
    session: string,
    commitment: CoopResumeCommitment,
    timeoutMs = 5_000,
    mirrorCloud = false,
  ): Promise<CoopResumeCheckpointDelivery> {
    if (
      this.role !== "host"
      || !isResumeCommitment(commitment)
      || !this.resumeCommitmentMatchesCurrentSession(commitment, true)
    ) {
      return Promise.resolve({ status: "nack", reason: "invalid-checkpoint" });
    }
    // A failed/timed-out cloud-cadence checkpoint is durable debt. Every checkpoint is a complete
    // host snapshot, so a newer snapshot may supersede its bytes, but it must inherit mirrorCloud;
    // otherwise the next ordinary wave silently drops the retained cloud retry for ~20 waves.
    const inheritedCloudDebt = this.latestResumeCheckpoint?.mirrorCloud === true;
    const requiresCloudMirror = mirrorCloud || inheritedCloudDebt;
    this.cancelResumeCheckpointWait({ status: "superseded" });
    const checkpointId = `${commitment.digest}:${++this.resumeDecisionSeq}`;
    this.latestResumeCheckpoint = { checkpointId, commitment, session, mirrorCloud: requiresCloudMirror };
    let finish!: (result: CoopResumeCheckpointDelivery) => void;
    const promise = new Promise<CoopResumeCheckpointDelivery>(resolve => {
      finish = result => {
        if (this.resumeCheckpointAckTimer != null) {
          clearTimeout(this.resumeCheckpointAckTimer);
          this.resumeCheckpointAckTimer = null;
        }
        resolve(result);
      };
    });
    this.resumeCheckpointAckWaiter = { checkpointId, promise, finish };
    this.resumeCheckpointAckTimer = setTimeout(
      () => {
        if (this.resumeCheckpointAckWaiter?.checkpointId === checkpointId) {
          this.resumeCheckpointAckWaiter = null;
          coopWarn("launch", `resumeCheckpointAck TIMEOUT id=${checkpointId}; retained for reconnect retry`);
          finish({ status: "timeout" });
        }
      },
      Math.max(0, timeoutMs),
    );
    this.transport.send({
      t: "resumeCheckpoint",
      checkpointId,
      commitment,
      session,
      mirrorCloud: requiresCloudMirror,
    });
    return promise;
  }

  /**
   * #810 barrier GUEST: arm the "host chose new game" release handler. If the host's
   * `resumeStartNew` already arrived (the wire beat the UI), it fires immediately from
   * the buffer - so the guest can never miss the release and hang.
   */
  armResumeStartNewHandler(handler: () => void): void {
    this.resumeStartNewHandler = handler;
    if (this.pendingResumeStartNewId != null) {
      const decisionId = this.pendingResumeStartNewId;
      this.pendingResumeStartNewId = null;
      this.pendingResumeStartNewEpoch = 0;
      this.resumeStartNewHandler = null;
      handler();
      this.appliedResumeStartNewId = decisionId;
      this.transport.send({ t: "resumeDecisionAck", decisionId });
    }
  }

  /**
   * #810 barrier HOST: tell the guest to stop waiting and proceed to a NEW game. Sent on
   * every non-resume outcome (no save, host picked New Game, guest declined, offer timeout).
   */
  sendResumeStartNew(timeoutMs = 15_000): Promise<boolean> {
    if (
      this.latestResumeDecision?.kind === "start-new"
      && this.ackedResumeStartNewId === this.latestResumeDecision.decisionId
    ) {
      return Promise.resolve(true);
    }
    if (this.latestResumeDecision?.kind === "start-new" && this.resumeStartNewAckWaiter != null) {
      const waiter = this.resumeStartNewAckWaiter;
      this.transport.send({
        t: "resumeStartNew",
        decisionId: this.latestResumeDecision.decisionId,
        epoch: this.latestResumeDecision.epoch,
        runId: this.latestResumeDecision.runId,
        checkpointRevision: this.latestResumeDecision.checkpointRevision,
      });
      return waiter.promise;
    }
    // A fresh-run decision supersedes any still-open resume prompt. Settle the old host waiter now;
    // otherwise it can outlive the atomic launch decision and later mutate the lobby from a stale reply.
    this.cancelResumeOfferWait(false);
    this.mintFreshRunIdentity("start-new");
    this.beginNewOperationEpoch("start-new", false);
    this.prepareP33BindingForCurrentBoundary(true, "fresh");
    const decisionId = `${Date.now().toString(36)}-${this.tiebreak.toString(36)}-${++this.resumeDecisionSeq}`;
    this.latestResumeDecision = {
      kind: "start-new",
      decisionId,
      epoch: this.sessionEpochValue,
      runId: this.runIdValue,
      checkpointRevision: this.checkpointRevisionValue,
    };
    recordCoopCausalEvent({
      domain: "lobby",
      stage: "start-new-committed",
      causalId: decisionId,
      role: "host",
      epoch: this.sessionEpochValue,
    });
    coopLog("launch", `SEND resumeStartNew id=${decisionId} (#810 durable barrier release)`);
    let finish!: (acknowledged: boolean) => void;
    const promise = new Promise<boolean>(resolve => {
      finish = acknowledged => {
        if (this.resumeStartNewAckTimer != null) {
          clearTimeout(this.resumeStartNewAckTimer);
          this.resumeStartNewAckTimer = null;
        }
        resolve(acknowledged);
      };
    });
    this.resumeStartNewAckWaiter = { decisionId, promise, finish };
    this.resumeStartNewAckTimer = setTimeout(
      () => {
        if (this.resumeStartNewAckWaiter?.decisionId === decisionId) {
          this.resumeStartNewAckWaiter = null;
          coopWarn("launch", `resumeDecisionAck TIMEOUT id=${decisionId} -> fail closed`);
          finish(false);
        }
      },
      Math.max(0, timeoutMs),
    );
    this.transport.send({
      t: "resumeStartNew",
      decisionId,
      epoch: this.sessionEpochValue,
      runId: this.runIdValue,
      checkpointRevision: this.checkpointRevisionValue,
    });
    this.sendHello();
    return promise;
  }

  /** Announce ourselves to the partner. Call once the transport is connected. */
  connect(): void {
    coopLog(
      "launch",
      `session connect role=${this.role} partnerRole=${this.partnerRoleId} netcode=${this._netcodeMode} `
        + `username=${this.username} version=${this.version} tiebreak=${this.tiebreak}`,
    );
    this.onEpochNegotiated?.(this.sessionEpochValue);
    this.sendHello();
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
    coopLog(
      "roster",
      `setLocalReady role=${this.role} localReady=${ready} localCount=${this.roster.count(this.role)} `
        + `partnerReady=${this._partnerReady} -> bothReady=${this.bothReady()}`,
    );
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

  /** The local player's display name (#788/#789: barrier logs + controller tag). */
  localName(): string {
    return this.username;
  }

  /**
   * Highest interaction counter the PARTNER has broadcast (#788 wave-start barrier).
   */
  partnerInteractionCounterSeen(): number {
    return this.interactionTurn.remoteCounterSeen();
  }

  /**
   * #788: resolves once the partner's broadcast interaction counter catches up to OURS. A timeout
   * requests a bounded number of idempotent counter replays. Exhaustion invokes the runtime's shared
   * terminal hook and returns false; neither timeout nor exhaustion is permission to cross alone.
   */
  async awaitPartnerInteraction(timeoutMs: number): Promise<boolean> {
    const need = this.interactionTurn.toJSON();
    let attempts = 0;
    const endMachineWait = beginCoopMachineWait(`coop-partner-interaction:${need}`, {
      asymmetricEligible: false,
    });
    try {
      while (!this.disposed && this.interactionTurn.remoteCounterSeen() < need) {
        const caughtUp = await this.interactionTurn.awaitRemoteCounter(need, timeoutMs);
        if (caughtUp) {
          return true;
        }
        if (attempts >= this.partnerInteractionRecoveryMaxAttempts) {
          const failure = {
            need,
            peerSeen: this.interactionTurn.remoteCounterSeen(),
            attempts,
          };
          coopWarn(
            "interaction",
            `partner counter recovery EXHAUSTED local=${need} peerSeen=${failure.peerSeen} attempts=${attempts} `
              + "- boundary remains closed",
          );
          try {
            this.onPartnerInteractionRecoveryExhausted?.(failure);
          } catch (error) {
            coopWarn("interaction", "partner counter terminal hook threw (boundary remains closed)", error);
          }
          return false;
        }
        attempts++;
        coopWarn(
          "interaction",
          `partner counter replay needed local=${need} peerSeen=${this.interactionTurn.remoteCounterSeen()} `
            + `attempt=${attempts}/${this.partnerInteractionRecoveryMaxAttempts} - boundary stays closed`,
        );
        try {
          this.transport.send({ t: "requestInteractionCounter", need });
        } catch (error) {
          coopWarn("interaction", "partner counter replay send threw (retry remains bounded)", error);
        }
      }
      return this.interactionTurn.remoteCounterSeen() >= need;
    } finally {
      endMachineWait();
    }
  }

  get partnerName(): string | null {
    return this._partnerName;
  }

  /** Both players locked in and each brought at least one Pokemon. */
  bothReady(): boolean {
    return (
      this.compatibilityAccepted
      && (this.p33Context == null || this.p33BindingReady)
      && this._localReady
      && this._partnerReady
      && this.roster.bothReady()
    );
  }

  /**
   * The merged 6-slot launch party (host 0..2, guest 3..5). The HOST is the
   * authority that builds the run from this; the guest receives the resulting
   * authoritative state. Only meaningful once {@linkcode bothReady} is true.
   */
  mergedLaunchParty(): (CoopRosterEntry | null)[] {
    if (!this.compatibilityAccepted) {
      throw new Error("Cannot build a co-op launch party before compatibility is accepted");
    }
    // Showdown 1v1 PvP (C1): versus does NOT merge. Each client launches with ITS OWN
    // picks as the player party (slots 0..n, pick order); the OPPONENT's team crosses via
    // the showdown manifest (C2) and becomes the ENEMY side (C3), never a merged half. The
    // coop path below is untouched (byte-identical) - only the versus kind branches here.
    if (this._sessionKind === "versus") {
      const own = this.roster.entries(this.role);
      const party: (CoopRosterEntry | null)[] = own.map(entry => entry);
      coopLog(
        "launch",
        `mergedLaunchParty(versus) role=${this.role} kind=versus own=${party.length} `
          + `party=[${party.map((e, i) => `${i}:${e === null ? "empty" : `sp${e.speciesId}`}`).join(" ")}]`,
      );
      return party;
    }
    const merged = this.roster.toMergedParty();
    // LAUNCH / ROLE ANCHOR (#633): the single line that anchors every later log -
    // role, netcode, run seed, difficulty, and the MERGED-PARTY composition per slot
    // (speciesId + coopOwner). slots 0..2 = host, 3..5 = guest. coop-roster's
    // toMergedParty() also logs the slot table; this adds the run-config context.
    coopLog(
      "launch",
      `mergedLaunchParty role=${this.role} netcode=${this._netcodeMode} `
        + `seed=${this._runConfig?.seed ?? "(none)"} difficulty=${this._runConfig?.difficulty ?? "(none)"} `
        + `bothReady=${this.bothReady()} `
        + `party=[${merged
          .map((e, i) => `${i}:${e === null ? "empty" : `sp${e.speciesId}/${i < 3 ? "host" : "guest"}`}`)
          .join(" ")}]`,
    );
    return merged;
  }

  /**
   * Which player owns the CURRENT alternating interaction screen (reward / shop /
   * mystery encounter) (#633, P4). The owner makes the picks while the partner
   * watches; ownership advances once per completed interaction.
   */
  interactionOwner(): CoopRole {
    const counter = this.interactionTurn.toJSON();
    const owner = this.interactionTurn.current();
    if (isCoopDebug()) {
      coopLog("owner", `interactionOwner() read counter=${counter} -> owner=${owner} (role=${this.role})`);
    }
    return owner;
  }

  /** Whether it is the LOCAL player's turn to drive the current interaction. */
  isLocalInteractionTurn(): boolean {
    const counter = this.interactionTurn.toJSON();
    const result = this.interactionTurn.isOwner(this.role);
    if (isCoopDebug()) {
      coopLog("owner", `isLocalInteractionTurn() read counter=${counter} role=${this.role} -> ${result}`);
    }
    return result;
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
    const owner = CoopInteractionTurn.ownerOf(pinnedCounter);
    const result = owner === this.role;
    if (isCoopDebug()) {
      const parity = ((pinnedCounter % 2) + 2) % 2;
      coopLog(
        "owner",
        `isLocalOwnerAtCounter(pinnedCounter=${pinnedCounter}) parity=${parity} owner=${owner} role=${this.role} -> ${result}`,
      );
    }
    return result;
  }

  /**
   * The raw interaction counter (the alternating-owner order). It is persisted in the co-op control
   * plane and restored exactly on cold resume so odd/even ownership parity cannot reset to host.
   */
  interactionCounter(): number {
    const counter = this.interactionTurn.toJSON();
    if (isCoopDebug()) {
      coopLog("interaction", `interactionCounter() read -> ${counter} (role=${this.role})`);
    }
    return counter;
  }

  /**
   * Co-op (#633): whether the PEER has advanced the interaction counter PAST `seq` (the watcher's
   * pinned wait). True only for a genuinely-orphaned interaction (the owner already left); a live
   * interaction the owner is still driving returns false. The resync safety net uses this to spare
   * a LIVE reward-shop wait while still cancelling a genuinely stuck one.
   */
  peerAdvancedPastInteraction(seq: number): boolean {
    return this.interactionTurn.peerAdvancedPast(seq);
  }

  /**
   * #863: a CANCELLABLE await that resolves once the PEER has broadcast an interaction counter STRICTLY
   * BEYOND `counter` (the owner committed its pick + advanced past this interaction). Event-driven off the
   * peer's broadcast (no polling / no timer), so a watcher parked on the choice relay can be sprung PROMPTLY
   * when the owner moved on but its pick relay was lost - the one-sided orphan the seq-based rescue can't see
   * for the offset biome/crossroads bands. The caller `cancel()`s it if the relayed pick wins the race first,
   * leaving no dangling waiter. Resolves immediately when the peer is ALREADY past.
   */
  awaitPeerAdvancePast(counter: number): { promise: Promise<void>; cancel: () => void } {
    return this.interactionTurn.awaitRemoteCounterCancellable(counter + 1);
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
    // THE ACTIVE DESYNC PATH (#633): the guest counter ran one AHEAD of the host so
    // both drove their own reward screen. Log every call EXHAUSTIVELY - arg, before,
    // whether the inner advance actually fired vs no-opped (idempotency), after, role,
    // and whether we broadcast - so an extra advance is unmissable in the next repro.
    const before = this.interactionTurn.toJSON();
    const advanced = this.interactionTurn.advance(fromCounter);
    const after = this.interactionTurn.toJSON();
    if (advanced) {
      const choice = this.interactionTurn.toJSON();
      coopLog(
        "interaction",
        `advanceInteraction ADVANCED+BROADCAST (fromCounter=${fromCounter === undefined ? "none" : fromCounter}) counter ${before} -> ${after} role=${this.role}; send interaction screen=${COOP_INTERACTION_TURN_SCREEN} choice=${choice}`,
      );
      this.broadcastInteractionCounter("advance");
    } else {
      coopLog(
        "interaction",
        `advanceInteraction NO-OP no-broadcast (fromCounter=${fromCounter === undefined ? "none" : fromCounter}) counter stays ${before} (==${after}) role=${this.role} - idempotent skip, no send`,
      );
    }
    this.emit();
  }

  /**
   * W2b (contract doc §4): RESTORE the interaction counter from a persisted `SessionSaveData`. The
   * #833-era `restoreInteractionCounter` was dropped as production-dead precisely because the counter was
   * NOT carried in the save; W2b adds `coopControlPlane` to `SessionSaveData` (populated at save, read at
   * load), so the seam now has a real value to restore. Restoring it keeps the alternating-owner PARITY and
   * the revision ordering CONTINUOUS across a cold resume rather than resetting to 0 - a resume from an ODD
   * counter no longer silently FLIPS ownership. The resume admission layer rejects missing/invalid control
   * planes before this seam. A HOT rejoin does not use this (the runtime + its live counter survive in place,
   * validated in Step 0); this is the COLD-resume path only.
   */
  restoreInteractionCounter(counter: number): void {
    if (!Number.isSafeInteger(counter) || counter < 0) {
      return;
    }
    this.interactionTurn.restore(counter);
    coopLog("interaction", `restoreInteractionCounter(${counter}) (role=${this.role}, cold-resume)`);
    this.emit();
  }

  /** Hot-rejoin/full-snapshot control adoption: the authority's exact counter wins at the safe boundary. */
  canAdoptAuthoritativeInteractionCounter(counter: number): boolean {
    return Number.isSafeInteger(counter) && counter >= this.interactionTurn.toJSON();
  }

  /** Atomic full-snapshot rollback only; exact restore may move backward and emits no UI/control callback. */
  restoreAuthoritativeInteractionCounterForTransaction(counter: number): void {
    this.interactionTurn.restoreExactForTransaction(counter);
  }

  /** Stage an already-preflighted counter without notifying UI/listeners before atomic commit. */
  adoptAuthoritativeInteractionCounterForTransaction(counter: number): boolean {
    if (!this.canAdoptAuthoritativeInteractionCounter(counter)) {
      return false;
    }
    this.interactionTurn.restore(counter);
    return true;
  }

  /** Post-commit notification for a successfully staged atomic snapshot counter. */
  emitAuthoritativeInteractionCounterAfterTransaction(): void {
    this.emit();
  }

  adoptAuthoritativeInteractionCounter(counter: number): boolean {
    if (!this.canAdoptAuthoritativeInteractionCounter(counter)) {
      return false;
    }
    const before = this.interactionTurn.toJSON();
    this.interactionTurn.restore(counter);
    coopLog(
      "interaction",
      `adoptAuthoritativeInteractionCounter(${counter}) counter ${before}->${this.interactionTurn.toJSON()} role=${this.role}`,
    );
    this.emit();
    return true;
  }

  /**
   * HOST: publish the authoritative run config (ER difficulty + challenge set) so
   * the guest mirrors it and the run is coherent (#633, LIVE-C). Stores it locally
   * too. No-op shape-wise on the guest (the guest receives it via the transport).
   */
  broadcastRunConfig(config: CoopRunConfig): void {
    if (!this.compatibilityAccepted) {
      coopWarn("launch", "REFUSE runConfig publication before compatibility is accepted");
      return;
    }
    // Pin the active netcode (#633, selectable A/B) into the retained config so the
    // self-healing `requestRunConfig` re-broadcast (and any later read) carries it.
    const netcodeMode = config.netcodeMode ?? this._netcodeMode;
    // Showdown 1v1 PvP (C1): pin the session kind into the retained config so the
    // self-healing re-broadcast (and any later read) carries it, exactly like netcode.
    const kind = config.kind ?? this._sessionKind;
    this._runConfig = { ...config, netcodeMode, kind };
    this._netcodeMode = netcodeMode;
    this._sessionKind = kind;
    coopLog(
      "runtime",
      `host broadcast difficulty=${config.difficulty} netcode=${netcodeMode} kind=${kind} (role=${this.role})`,
    );
    this.transport.send({
      t: "runConfig",
      difficulty: config.difficulty,
      challenges: config.challenges,
      // The host's run seed (#633, LIVE-A) rides along so the guest pins to it.
      ...(config.seed === undefined ? {} : { seed: config.seed }),
      // The host's chosen netcode (#633, selectable A/B) so the guest adopts it.
      netcodeMode,
      // The host's session kind (Showdown C1) so the guest adopts it.
      kind,
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
   * #868 self-healing lobby: ask the peer to (re)send their roster + ready. The SYMMETRIC
   * counterpart of {@linkcode requestRunConfig} for the OTHER stranding direction. A player's
   * `rosterSync` (their picks + the `ready` lock-in) crosses the wire ONCE when they lock in; if
   * that single frame is lost, the partner's `partnerReady` never flips and the run never launches
   * (the live "partner got kicked, no players showing" / guest "stuck at starter-select" strand).
   * A waiting client calls this and the peer re-broadcasts its roster (see the `requestRoster`
   * handler), so a lost lock-in heals just like a lost runConfig. Harmless before the peer has picked.
   */
  requestRoster(): void {
    this.transport.send({ t: "requestRoster" });
  }

  /**
   * #868 self-healing lobby: re-establish EVERY lobby-critical state in BOTH directions. Idempotent
   * and safe to call at any time the session lives. Called automatically on a RECONNECT (transport
   * flap -> #805 hot-rejoin, see {@linkcode handleStateChange}) and driven on an interval by the
   * waiting starter-select screen so a strand can never be permanent:
   *   - re-announce our `hello` (so a partner that missed it re-learns our name/role),
   *   - re-broadcast our roster + ready (heals a lost guest->host lock-in - case b),
   *   - (HOST) re-broadcast the authoritative `runConfig` it already decided (heals a lost
   *     host->guest difficulty broadcast - case a),
   *   - pull the peer's state so a loss in the OTHER direction heals too (the guest re-requests
   *     the runConfig; both re-request the roster).
   * Every send is an idempotent snapshot / no-op re-request, so re-running it can never desync.
   */
  resyncLobbyState(): void {
    coopLog(
      "launch",
      `resyncLobbyState role=${this.role} localReady=${this._localReady} partnerReady=${this._partnerReady} `
        + `hasRunConfig=${this._runConfig != null} (#868 self-healing handshake)`,
    );
    // Re-broadcast our own roster + ready.
    this.broadcastLocal();
    // The HOST re-broadcasts the run config it already decided (no-op before it has picked).
    if (this.role === "host" && this._runConfig != null) {
      this.broadcastRunConfig(this._runConfig);
    }
    if (this.role === "host" && this.latestResumeDecision != null) {
      const decision = this.latestResumeDecision;
      if (decision.kind === "offer") {
        coopLog(
          "launch",
          `RESEND resumeOffer id=${decision.decisionId} wave=${decision.commitment.wave} after reconnect`,
        );
        this.transport.send({
          t: "resumeOffer",
          decisionId: decision.decisionId,
          epoch: decision.epoch,
          commitment: decision.commitment,
        });
      } else if (decision.kind === "resume-accepted") {
        coopLog("launch", `RESEND resumeAccepted id=${decision.decisionId} after reconnect`);
        this.transport.send({
          t: "resumeAccepted",
          decisionId: decision.decisionId,
          epoch: decision.epoch,
          commitment: decision.commitment,
        });
      } else {
        coopLog("launch", `RESEND resumeStartNew id=${decision.decisionId} after reconnect`);
        this.transport.send({
          t: "resumeStartNew",
          decisionId: decision.decisionId,
          epoch: decision.epoch,
          runId: decision.runId,
          checkpointRevision: decision.checkpointRevision,
        });
      }
    }
    // Atomic launch decisions precede the general hello. If their first carrier was lost, a hello with
    // the newly committed epoch/run must never make the following decision look stale/same-epoch.
    this.sendHello();
    if (this.role === "guest" && this.pendingResumeReply != null) {
      this.transport.send({
        t: "resumeReply",
        decisionId: this.pendingResumeReply.decisionId,
        accept: this.pendingResumeReply.accept,
      });
    }
    if (this.role === "guest" && this.latestResumeApplyResult != null) {
      this.transport.send({ t: "resumeApplied", ...this.latestResumeApplyResult });
    }
    if (this.role === "host" && this.latestResumeReleaseId != null) {
      this.transport.send({ t: "resumeRelease", decisionId: this.latestResumeReleaseId });
    }
    if (this.role === "host" && this.latestResumeCheckpoint != null) {
      this.transport.send({ t: "resumeCheckpoint", ...this.latestResumeCheckpoint });
    }
    // Pull the peer's lobby state (heals a loss in the direction we don't own).
    if (this.role === "guest") {
      this.requestRunConfig();
    }
    this.requestRoster();
    this.broadcastInteractionCounter("reconnect");
  }

  /** Re-announce the current counter as an idempotent snapshot, never an increment. */
  private broadcastInteractionCounter(reason: "advance" | "reconnect" | "request"): void {
    const choice = this.interactionTurn.toJSON();
    coopLog("interaction", `SEND counter snapshot reason=${reason} choice=${choice} role=${this.role}`);
    this.transport.send({ t: "interaction", screen: COOP_INTERACTION_TURN_SCREEN, choice });
  }

  /**
   * #868: react to the transport lifecycle. A `disconnected` arms the reconnect flag; the next
   * transition back to `connected` (a #805 hot-rejoin swapped a fresh channel in) is a RECONNECT
   * and re-runs the lobby handshake so state lost while the channel was dark heals. The initial
   * `connecting -> connected` is NOT a reconnect (the flag is unset), so a fresh session is quiet.
   */
  private handleStateChange(state: CoopConnectionState): void {
    this.transportState = state;
    this.notifyCompatibilityLifecycle();
    if (state === "disconnected") {
      this._sawDisconnect = true;
      return;
    }
    if (state === "connected" && this._sawDisconnect) {
      this._sawDisconnect = false;
      coopLog("launch", `transport RECONNECTED role=${this.role} -> resync lobby state (#868)`);
      this.resyncLobbyState();
    }
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

  /**
   * Showdown 1v1 PvP (C1): the active session kind. `"coop"` by default; the HOST pins it
   * at session start via {@linkcode setSessionKind} and the GUEST adopts the host's value
   * off the `runConfig`. The single read point for every showdown-vs-coop gate.
   */
  get sessionKind(): CoopSessionKind {
    return this._sessionKind;
  }

  /**
   * Showdown 1v1 PvP (C1): pin the session kind. The HOST calls this at session start; the
   * chosen kind rides along in {@linkcode broadcastRunConfig} so the guest adopts it, exactly
   * like {@linkcode setNetcodeMode}. Harmless on the guest before the host's runConfig arrives.
   */
  setSessionKind(kind: CoopSessionKind): void {
    this._sessionKind = kind;
  }

  /** Showdown 1v1 PvP (C1): whether this is a 1v1 versus (showdown) session. */
  isVersusSession(): boolean {
    return this._sessionKind === "versus";
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

  /**
   * Wait until the peer's opening `hello` has established its stable account identity and
   * reconciled the local host/guest role. A connected WebRTC data channel is not sufficient:
   * {@linkcode connectCoopSession} returns immediately after sending our hello, so lobby UI
   * code that reads `partnerName` synchronously can race the peer frame and incorrectly decide
   * that no pair-matched resume exists.
   *
   * Returns `null` instead of guessing when the identity handshake does not arrive. Callers
   * must remain at the lobby recovery screen; starting a new run unilaterally would split the
   * two clients across different pre-run states.
   */
  awaitPartnerIdentity(timeoutMs = 15_000): Promise<CoopSessionSnapshot | null> {
    const current = this.snapshot();
    if (current.partnerConnected && current.partnerName != null) {
      return Promise.resolve(current);
    }
    return new Promise(resolve => {
      let settled = false;
      let off = (): void => {};
      const finish = (snap: CoopSessionSnapshot | null): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        off();
        resolve(snap);
      };
      const timer = setTimeout(() => finish(null), Math.max(0, timeoutMs));
      off = this.onChange(snap => {
        if (snap.partnerConnected && snap.partnerName != null) {
          finish(snap);
        }
      });
      // Close the subscribe-after-check race: a hello can land between the first snapshot and
      // onChange registration. Re-read after subscribing so that frame cannot be missed.
      const afterSubscribe = this.snapshot();
      if (afterSubscribe.partnerConnected && afterSubscribe.partnerName != null) {
        finish(afterSubscribe);
      }
    });
  }

  /**
   * Wait for the complete pre-launch compatibility contract, not merely an open channel or a
   * populated roster. Resume discovery is identity-sensitive and may deserialize a full session,
   * so it cannot run until the peer hello and (when required) functional data fingerprint agree.
   * A protocol/fingerprint mismatch, disconnect, close, disposal, or timeout resolves `null` and
   * never falls back to `bothReady()` or a unilateral launch.
   */
  awaitPartnerCompatibility(timeoutMs = 15_000): Promise<CoopSessionSnapshot | null> {
    const evaluate = (): { settled: boolean; snapshot: CoopSessionSnapshot | null } => {
      if (this.disposed || this.transportState === "disconnected" || this.transportState === "closed") {
        return { settled: true, snapshot: null };
      }
      const snapshot = this.snapshot();
      if (!snapshot.partnerConnected || snapshot.partnerName == null) {
        return { settled: false, snapshot: null };
      }
      if (this.versionMismatch || this.functionalFingerprintMismatch) {
        return { settled: true, snapshot: null };
      }
      return this.compatibilityAccepted ? { settled: true, snapshot } : { settled: false, snapshot: null };
    };

    const current = evaluate();
    if (current.settled) {
      return Promise.resolve(current.snapshot);
    }
    return new Promise(resolve => {
      let settled = false;
      let offChange = (): void => {};
      const off = (): void => {
        offChange();
        this.compatibilityLifecycleHandlers.delete(check);
      };
      const finish = (snapshot: CoopSessionSnapshot | null): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        off();
        resolve(snapshot);
      };
      const check = (): void => {
        const result = evaluate();
        if (result.settled) {
          finish(result.snapshot);
        }
      };
      const timer = setTimeout(() => finish(null), Math.max(0, timeoutMs));
      offChange = this.onChange(check);
      this.compatibilityLifecycleHandlers.add(check);
      // Close the subscribe-after-check race for both hello and fingerprint frames.
      check();
    });
  }

  /**
   * Wait until the atomic fresh/resume decision has installed the exact gameplay identity that may
   * address mechanical traffic. P33 is not ready merely because its account hello and capabilities
   * matched: the authority must mint a run/epoch/seat-map binding and both authenticated seats must ACK
   * that same immutable binding. Legacy sessions have no authenticated seat-map transaction, but still
   * require the shared positive epoch + run identity established by the same launch decision.
   *
   * Showdown used to skip this boundary along with save discovery. Its authority entered the battle at
   * the host epoch while the replica remained at epoch 0, so the replica correctly rejected every live
   * battle event as cross-addressed. Callers must fail closed when this returns false.
   */
  awaitGameplayBinding(timeoutMs = 15_000): Promise<boolean> {
    const evaluate = (): { settled: boolean; ready: boolean } => {
      if (this.disposed || this.transportState === "disconnected" || this.transportState === "closed") {
        return { settled: true, ready: false };
      }
      if (this.p33Context != null) {
        if (this.p33BindingRejected || this.authenticatedProtocolViolation) {
          return { settled: true, ready: false };
        }
        return this.exactP33BindingAxes() == null ? { settled: false, ready: false } : { settled: true, ready: true };
      }
      const ready = this.sessionEpochValue > 0 && isCoopRunId(this.runIdValue);
      return ready ? { settled: true, ready: true } : { settled: false, ready: false };
    };

    const current = evaluate();
    if (current.settled) {
      return Promise.resolve(current.ready);
    }
    return new Promise(resolve => {
      let settled = false;
      let offChange = (): void => {};
      const off = (): void => {
        offChange();
        this.compatibilityLifecycleHandlers.delete(check);
      };
      const finish = (ready: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        off();
        resolve(ready);
      };
      const check = (): void => {
        const result = evaluate();
        if (result.settled) {
          finish(result.ready);
        }
      };
      const timer = setTimeout(() => finish(false), Math.max(0, timeoutMs));
      offChange = this.onChange(check);
      this.compatibilityLifecycleHandlers.add(check);
      // Close the subscribe-after-check race for both binding construction and its final ACK.
      check();
    });
  }

  /** Tear down: stop listening to the transport (does not close the transport). */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.clearP33BindingRetry();
    this.cancelAllResumeTransactions();
    // Pending compatibility waits observe disposal before listeners are removed, so a terminal
    // lobby exit cannot leave a 15-second continuation alive against a replacement runtime.
    this.notifyCompatibilityLifecycle();
    this.offMessage();
    this.offStateChange();
    this.changeHandlers.clear();
    this.compatibilityLifecycleHandlers.clear();
  }

  private cancelResumeOfferWait(result: boolean): void {
    const waiter = this.resumeReplyWaiter;
    this.resumeReplyWaiter = null;
    if (this.resumeOfferTimer != null) {
      clearTimeout(this.resumeOfferTimer);
      this.resumeOfferTimer = null;
    }
    waiter?.finish(result);
  }

  private cancelPendingResumeReply(result: boolean): void {
    const pending = this.pendingResumeReply;
    this.pendingResumeReply = null;
    if (this.resumeReplyTimer != null) {
      clearTimeout(this.resumeReplyTimer);
      this.resumeReplyTimer = null;
    }
    pending?.finish(result);
  }

  private cancelResumeApplyWait(result: boolean): void {
    const waiter = this.resumeApplyAckWaiter;
    this.resumeApplyAckWaiter = null;
    if (this.resumeApplyTimer != null) {
      clearTimeout(this.resumeApplyTimer);
      this.resumeApplyTimer = null;
    }
    waiter?.finish(result);
  }

  private cancelResumeApplyDelivery(result: boolean): void {
    const waiter = this.resumeApplyDeliveryWaiter;
    this.resumeApplyDeliveryWaiter = null;
    if (this.resumeApplyDeliveryTimer != null) {
      clearTimeout(this.resumeApplyDeliveryTimer);
      this.resumeApplyDeliveryTimer = null;
    }
    waiter?.finish(result);
  }

  private cancelResumeBlockedWait(result: boolean): void {
    const waiter = this.resumeBlockedAckWaiter;
    this.resumeBlockedAckWaiter = null;
    if (this.resumeBlockedAckTimer != null) {
      clearTimeout(this.resumeBlockedAckTimer);
      this.resumeBlockedAckTimer = null;
    }
    waiter?.finish(result);
  }

  private cancelResumeReleaseArrival(result: boolean): void {
    const waiter = this.resumeReleaseArrivalWaiter;
    this.resumeReleaseArrivalWaiter = null;
    if (this.resumeReleaseArrivalTimer != null) {
      clearTimeout(this.resumeReleaseArrivalTimer);
      this.resumeReleaseArrivalTimer = null;
    }
    waiter?.finish(result);
  }

  private cancelResumeReleaseAck(result: boolean): void {
    const waiter = this.resumeReleaseAckWaiter;
    this.resumeReleaseAckWaiter = null;
    if (this.resumeReleaseAckTimer != null) {
      clearTimeout(this.resumeReleaseAckTimer);
      this.resumeReleaseAckTimer = null;
    }
    waiter?.finish(result);
  }

  private cancelResumeCheckpointWait(result: CoopResumeCheckpointDelivery): void {
    const waiter = this.resumeCheckpointAckWaiter;
    this.resumeCheckpointAckWaiter = null;
    if (this.resumeCheckpointAckTimer != null) {
      clearTimeout(this.resumeCheckpointAckTimer);
      this.resumeCheckpointAckTimer = null;
    }
    waiter?.finish(result);
  }

  private enqueueResumeCheckpointPersistence(checkpoint: {
    checkpointId: string;
    commitment: CoopResumeCommitment;
    session: string;
    mirrorCloud: boolean;
  }): void {
    this.resumeCheckpointDeliveryTail = this.resumeCheckpointDeliveryTail.then(async () => {
      if (this.disposed) {
        return;
      }
      const handler = this.resumeCheckpointHandler;
      if (handler == null) {
        this.pendingResumeCheckpoint = checkpoint;
        return;
      }
      let result: CoopResumeCheckpointPersistenceAck = { success: false, reason: "runtime-invalid" };
      try {
        result = await handler(checkpoint.session, checkpoint.commitment, checkpoint.mirrorCloud);
      } catch (error) {
        coopWarn("launch", `resume checkpoint persistence threw id=${checkpoint.checkpointId}`, error);
      }
      if (this.disposed) {
        return;
      }
      if (result.success) {
        this.appliedResumeCheckpointId = checkpoint.checkpointId;
        this.restoreCheckpointIdentity(
          checkpoint.commitment.runId,
          checkpoint.commitment.checkpointRevision,
          "checkpoint-persisted",
        );
        coopLog(
          "launch",
          `resume checkpoint persisted id=${checkpoint.checkpointId} wave=${checkpoint.commitment.wave} checkpointRev=${checkpoint.commitment.checkpointRevision} cloud=${checkpoint.mirrorCloud}`,
        );
      } else {
        coopWarn(
          "launch",
          `resume checkpoint NACK id=${checkpoint.checkpointId} wave=${checkpoint.commitment.wave} checkpointRev=${checkpoint.commitment.checkpointRevision} cloud=${checkpoint.mirrorCloud} reason=${result.reason ?? "runtime-invalid"}`,
        );
      }
      this.transport.send({
        t: "resumeCheckpointAck",
        checkpointId: checkpoint.checkpointId,
        success: result.success,
        ...(result.reason === undefined ? {} : { reason: result.reason }),
      });
    });
  }

  private cancelResumeStartNewWait(result: boolean): void {
    const waiter = this.resumeStartNewAckWaiter;
    this.resumeStartNewAckWaiter = null;
    if (this.resumeStartNewAckTimer != null) {
      clearTimeout(this.resumeStartNewAckTimer);
      this.resumeStartNewAckTimer = null;
    }
    waiter?.finish(result);
  }

  private cancelAllResumeTransactions(): void {
    this.cancelResumeOfferWait(false);
    this.cancelPendingResumeReply(false);
    this.cancelResumeApplyWait(false);
    this.cancelResumeApplyDelivery(false);
    this.cancelResumeReleaseArrival(false);
    this.cancelResumeReleaseAck(false);
    this.cancelResumeBlockedWait(false);
    this.cancelResumeCheckpointWait({ status: "disposed" });
    this.cancelResumeStartNewWait(false);
    this.resumeOfferHandler = null;
    this.pendingResumeOfferCommitment = null;
    this.resumeStartNewHandler = null;
    this.pendingResumeStartNewId = null;
    this.resumeBlockedHandler = null;
    this.pendingResumeBlocked = null;
    this.resumeCheckpointHandler = null;
    this.pendingResumeCheckpoint = null;
    this.latestResumeCheckpoint = null;
    this.latestResumeApplyResult = null;
    this.latestResumeReleaseId = null;
    this.pendingResumeReleaseId = null;
    this.latestResumeDecision = null;
    this.activeResumeOfferId = null;
    this.activeResumeOfferEpoch = 0;
    this.activeResumeOfferCommitment = null;
    this.pendingResumeStartNewEpoch = 0;
    this.settledResumeOfferReplies.clear();
  }

  /** Retain a small replay window without allowing untrusted decision ids to grow the session forever. */
  private rememberSettledResumeOfferReply(decisionId: string, accept: boolean): void {
    this.settledResumeOfferReplies.delete(decisionId);
    this.settledResumeOfferReplies.set(decisionId, accept);
    while (this.settledResumeOfferReplies.size > 32) {
      const oldest = this.settledResumeOfferReplies.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.settledResumeOfferReplies.delete(oldest);
    }
  }

  private resumeCommitmentMatchesCurrentSession(commitment: CoopResumeCommitment, requireRunIdentity = false): boolean {
    const partner = this._partnerName;
    if (partner == null) {
      return false;
    }
    const expected = canonicalCoopParticipantPair(this.username, partner);
    const expectedHost = this.role === "host" ? this.username : partner;
    const expectedGuest = this.role === "guest" ? this.username : partner;
    return (
      sameCoopIdentity(commitment.participants[0], expected[0])
      && sameCoopIdentity(commitment.participants[1], expected[1])
      && sameCoopIdentity(commitment.seats.host, expectedHost)
      && sameCoopIdentity(commitment.seats.guest, expectedGuest)
      && (!requireRunIdentity
        || (commitment.runId === this.runIdValue && commitment.checkpointRevision >= this.checkpointRevisionValue))
    );
  }

  private broadcastLocal(): void {
    coopLog(
      "roster",
      `rosterSync SEND role=${this.role} entries=${this.roster.count(this.role)} ready=${this._localReady} `
        + `spent=${this.roster.spent(this.role)} species=[${this.roster
          .entries(this.role)
          .map(e => e.speciesId)
          .join(",")}]`,
    );
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
      // #896 W2e-R2: also carry capabilities on rosterSync so a hello lost on a flap still lets the
      // waiting peer negotiate (the roster/ready direction self-heals via #868 requestRoster).
      ...(this.localCapabilities === undefined ? {} : { capabilities: [...this.localCapabilities] }),
    });
  }

  private handleP33Hello(msg: CoopP33HelloMessage): void {
    const context = this.p33Context;
    this.partnerVersionValue = msg.version;
    if (context == null) {
      this.authenticatedProtocolViolation = true;
      this.p33BindingRejected = true;
      coopWarn("launch", "REFUSE authenticated P33 hello on a legacy-selected session");
      this.notifyCompatibilityLifecycle();
      return;
    }
    const expectedPeerRole = context.transportRole === "offerer" ? "answerer" : "offerer";
    const peerSeat = context.localSeatId === 0 ? 1 : 0;
    const expectedAuthorityClaim = peerSeat === context.authoritySeatId ? "authority" : "replica";
    const account = msg.account as CoopAccountIdentityV1 | null | undefined;
    const identityMatches =
      account != null
      && typeof account === "object"
      && account.version === 1
      && account.accountId === context.peerAccount.accountId
      && account.displayName === context.peerAccount.displayName
      && account.canonicalUsername === context.peerAccount.canonicalUsername;
    const capabilitiesValid =
      Array.isArray(msg.capabilities)
      && msg.capabilities.length <= 128
      && msg.capabilities.every(capability => typeof capability === "string" && capability.length <= 128);
    const existing = msg.existingBinding;
    const existingBindingValid =
      existing == null
      || (typeof existing === "object"
        && typeof existing.sessionId === "string"
        && existing.sessionId.length <= 256
        && (existing.runId == null || isCoopRunId(existing.runId))
        && Number.isSafeInteger(existing.sessionEpoch)
        && existing.sessionEpoch > 0
        && typeof existing.seatMapId === "string"
        && /^[0-9a-f]{64}$/u.test(existing.seatMapId)
        && Number.isSafeInteger(existing.authoritySeatId)
        && existing.authoritySeatId >= 0
        && Number.isSafeInteger(existing.membershipRevision)
        && existing.membershipRevision >= 1);
    if (
      msg.version !== this.version
      || msg.pairingId !== context.pairingId
      || msg.transportRole !== expectedPeerRole
      || msg.authorityClaim !== expectedAuthorityClaim
      || !identityMatches
      || !capabilitiesValid
      || !existingBindingValid
    ) {
      this.p33BindingRejected = true;
      coopWarn("launch", "REFUSE P33 hello whose authenticated pairing axes do not match the Worker record");
      this.notifyCompatibilityLifecycle();
      this.emit();
      return;
    }
    if (existing != null && this.p33Binding != null) {
      const local = this.p33Binding;
      if (
        existing.sessionId !== local.sessionId
        || existing.runId !== local.runId
        || existing.sessionEpoch !== local.sessionEpoch
        || existing.seatMapId !== local.seatMap.seatMapId
        || existing.authoritySeatId !== local.authoritySeatId
        || existing.membershipRevision !== local.membershipRevision
      ) {
        this.p33BindingRejected = true;
        coopWarn("launch", "REFUSE P33 hello that attempts to replace the retained session binding");
        this.notifyCompatibilityLifecycle();
        this.emit();
        return;
      }
    }
    this.p33PeerHelloAccepted = true;
    this._partnerConnected = true;
    this._partnerName = context.peerAccount.displayName;
    this.negotiateCapabilities(msg.capabilities);
    if (this.isAuthority) {
      this.ensureP33Binding();
    } else if (this.p33Binding != null) {
      this.transport.send({
        t: "sessionBindingAck",
        bindingId: this.p33Binding.bindingId,
        seatId: context.localSeatId,
        accountId: context.account.accountId,
        accepted: true,
      });
      this.p33BindingReady = true;
      this.onAuthenticatedBindingReady?.();
      this.notifyCompatibilityLifecycle();
    }
    this.emit();
  }

  private ensureP33Binding(): void {
    if (
      !this.p33BindingAuthoringEnabled
      || !this.isAuthority
      || !this.p33PeerHelloAccepted
      || this.p33Context == null
    ) {
      return;
    }
    if (this.p33Binding != null) {
      this.transmitP33Binding();
      return;
    }
    if (this.p33BindingBuild != null) {
      return;
    }
    const context = this.p33Context;
    this.p33BindingBuild = (async () => {
      const seatMap = await createFreshCoopSeatMap([context.account.accountId, context.peerAccount.accountId]);
      if (seatMap == null || this.disposed || this.p33Context !== context || !isCoopRunId(this.runIdValue)) {
        this.p33BindingRejected = true;
        this.notifyCompatibilityLifecycle();
        return;
      }
      const sessionId = `p33-session:${context.pairingId}:${this.sessionEpochValue}`;
      this.p33Binding = {
        version: 1,
        bindingId: `p33-binding:${context.pairingId}:${this.sessionEpochValue}:${seatMap.seatMapId.slice(0, 16)}`,
        sessionId,
        runId: this.runIdValue,
        sessionEpoch: this.sessionEpochValue,
        checkpointRevision: this.checkpointRevisionValue,
        seatMap,
        authoritySeatId: context.authoritySeatId,
        membershipRevision: 1,
        source: context.source,
      };
      this.p33MembershipRevisionValue = this.p33Binding.membershipRevision;
      this.transmitP33Binding();
    })()
      .catch(error => {
        this.p33BindingRejected = true;
        const detail = error instanceof Error ? error.message : String(error);
        coopWarn("launch", `P33 session binding construction failed: ${detail}`);
        this.notifyCompatibilityLifecycle();
        this.emit();
      })
      .finally(() => {
        this.p33BindingBuild = null;
      });
  }

  /** Retain and replay the exact binding until the authenticated peer accepts it. */
  private transmitP33Binding(): void {
    const binding = this.p33Binding;
    if (
      binding == null
      || this.disposed
      || !this.isAuthority
      || !this.p33PeerHelloAccepted
      || this.p33BindingReady
      || this.p33BindingRejected
    ) {
      this.clearP33BindingRetry();
      return;
    }
    this.transport.send({ t: "sessionBinding", binding });
    if (this.p33BindingRetryTimer == null) {
      this.p33BindingRetryTimer = setTimeout(() => {
        this.p33BindingRetryTimer = null;
        if (this.p33Binding === binding) {
          this.transmitP33Binding();
        }
      }, 1_000);
    }
  }

  private clearP33BindingRetry(): void {
    if (this.p33BindingRetryTimer != null) {
      clearTimeout(this.p33BindingRetryTimer);
      this.p33BindingRetryTimer = null;
    }
  }

  private async applyP33Binding(binding: CoopSessionBindingV1): Promise<void> {
    const context = this.p33Context;
    const bindingId =
      binding != null && typeof binding === "object" && typeof binding.bindingId === "string"
        ? binding.bindingId
        : "invalid";
    const reject = (reason: "identity" | "seat-map" | "authority" | "stale" | "unsupported"): void => {
      this.p33BindingRejected = true;
      this.p33BindingReady = false;
      this.transport.send({
        t: "sessionBindingAck",
        bindingId,
        seatId: context?.localSeatId ?? -1,
        accountId: context?.account.accountId ?? "invalid",
        accepted: false,
        reason,
      });
      this.notifyCompatibilityLifecycle();
      this.emit();
    };
    if (context == null) {
      this.authenticatedProtocolViolation = true;
      reject("unsupported");
      return;
    }
    if (this.isAuthority || !this.p33PeerHelloAccepted) {
      reject("unsupported");
      return;
    }
    if (
      binding == null
      || typeof binding !== "object"
      || Array.isArray(binding)
      || binding.version !== 1
      || binding.source !== context.source
      || typeof binding.bindingId !== "string"
      || !/^[A-Za-z0-9:_-]{1,256}$/u.test(binding.bindingId)
      || typeof binding.sessionId !== "string"
      || !/^[A-Za-z0-9:_-]{1,256}$/u.test(binding.sessionId)
      || !Number.isSafeInteger(binding.sessionEpoch)
      || binding.sessionEpoch <= 0
      || !Number.isSafeInteger(binding.checkpointRevision)
      || binding.checkpointRevision < 0
      || !Number.isSafeInteger(binding.membershipRevision)
      || binding.membershipRevision < 1
      || !isCoopRunId(binding.runId)
      || binding.seatMap == null
      || typeof binding.seatMap !== "object"
      || Array.isArray(binding.seatMap)
    ) {
      reject("unsupported");
      return;
    }
    const runId = binding.runId;
    if (!(await validateCoopRunSeatMap(binding.seatMap))) {
      reject("seat-map");
      return;
    }
    if (this.disposed || this.p33Context !== context) {
      return;
    }
    const localSeat = coopSeatForAccount(binding.seatMap, context.account.accountId);
    const peerSeat = coopSeatForAccount(binding.seatMap, context.peerAccount.accountId);
    if (
      binding.seatMap.seats.length !== 2
      || localSeat == null
      || localSeat.seatId !== context.localSeatId
      || peerSeat == null
      || peerSeat.seatId === localSeat.seatId
    ) {
      reject("identity");
      return;
    }
    if (binding.authoritySeatId !== context.authoritySeatId) {
      reject("authority");
      return;
    }
    if (
      binding.sessionEpoch !== this.sessionEpochValue
      || runId !== this.runIdValue
      || binding.checkpointRevision !== this.checkpointRevisionValue
    ) {
      reject("stale");
      return;
    }
    const retainedBinding = this.p33Binding != null;
    if (retainedBinding && JSON.stringify(this.p33Binding) !== JSON.stringify(binding)) {
      reject("stale");
      return;
    }
    if (!this.restoreCheckpointIdentity(runId, binding.checkpointRevision, "p33-session-binding")) {
      reject("stale");
      return;
    }
    this.p33Binding = structuredClone(binding);
    if (!retainedBinding) {
      this.p33MembershipRevisionValue = binding.membershipRevision;
    }
    this.sessionEpochValue = binding.sessionEpoch;
    this.onEpochNegotiated?.(binding.sessionEpoch);
    this.p33BindingRejected = false;
    this.p33BindingReady = true;
    this.transport.send({
      t: "sessionBindingAck",
      bindingId: binding.bindingId,
      seatId: context.localSeatId,
      accountId: context.account.accountId,
      accepted: true,
    });
    this.onAuthenticatedBindingReady?.();
    this.sendHello();
    this.notifyCompatibilityLifecycle();
    this.emit();
  }

  private acceptP33BindingAck(msg: Extract<CoopMessage, { t: "sessionBindingAck" }>): void {
    const context = this.p33Context;
    const binding = this.p33Binding;
    if (
      context == null
      || !this.isAuthority
      || !this.p33PeerHelloAccepted
      || binding == null
      || typeof msg.accepted !== "boolean"
      || msg.bindingId !== binding.bindingId
      || msg.seatId !== (context.localSeatId === 0 ? 1 : 0)
      || msg.accountId !== context.peerAccount.accountId
    ) {
      coopWarn("launch", "DROP stale or wrong-seat P33 session binding ACK");
      return;
    }
    this.p33BindingRejected = !msg.accepted;
    this.p33BindingReady = msg.accepted;
    this.clearP33BindingRetry();
    if (msg.accepted) {
      this.onAuthenticatedBindingReady?.();
    }
    this.notifyCompatibilityLifecycle();
    this.emit();
  }

  private handleMessage(msg: CoopMessage): void {
    switch (msg.t) {
      case "sessionBinding":
        void this.applyP33Binding(msg.binding);
        break;
      case "sessionBindingAck":
        this.acceptP33BindingAck(msg);
        break;
      case "meCursor": {
        // #817 cosmetic cursor mirror: the ME owner's option cursor, applied to the
        // watcher's read-only selector. Best-effort; a dropped move can never desync.
        try {
          this.onMeCursor?.(msg.index);
        } catch {
          /* cosmetic */
        }
        break;
      }
      case "resumeOffer": {
        // #810: buffer if the UI has not armed its handler yet (offer can beat the arm).
        // A fresh authenticated P33 replica intentionally has no epoch until the authority commits a
        // launch boundary. Resume selection happens *before* that commit, so its first authenticated
        // offer carries the authority's provisional epoch while the replica is still at epoch 0. The
        // legacy protocol already shares an epoch before this screen and must continue to require an
        // exact match. Once P33 has any epoch/binding, it also returns to the exact-match rule.
        const acceptsInitialP33Offer =
          this.p33Context != null
          && !this.isAuthority
          && this.p33PeerHelloAccepted
          && this.p33Binding == null
          && !this.p33BindingReady
          && !this.p33BindingRejected
          && this.sessionEpochValue === 0
          && Number.isSafeInteger(msg.epoch)
          && msg.epoch > 0;
        if (
          this.role !== "guest"
          || !isResumeCommitment(msg.commitment)
          || !this.resumeCommitmentMatchesCurrentSession(msg.commitment)
          || !Number.isSafeInteger(msg.epoch)
          || msg.epoch <= 0
          || (msg.epoch !== this.sessionEpochValue && !acceptsInitialP33Offer)
        ) {
          coopWarn(
            "launch",
            `DROP resumeOffer id=${msg.decisionId}: malformed/stale immutable commitment epoch=${msg.epoch} current=${this.sessionEpochValue}`,
          );
          break;
        }
        if (acceptsInitialP33Offer) {
          coopLog("launch", `ACCEPT pre-binding P33 resumeOffer id=${msg.decisionId} epoch=${msg.epoch}`);
        }
        if (this.settledResumeOfferReplies.has(msg.decisionId)) {
          const accept = this.settledResumeOfferReplies.get(msg.decisionId)!;
          coopLog("launch", `RE-ACK settled resumeOffer id=${msg.decisionId} accept=${accept}`);
          this.transport.send({ t: "resumeReply", decisionId: msg.decisionId, accept });
          break;
        }
        if (
          this.activeResumeOfferId != null
          && this.activeResumeOfferEpoch === msg.epoch
          && this.activeResumeOfferId !== msg.decisionId
        ) {
          coopWarn(
            "launch",
            `DROP competing resumeOffer id=${msg.decisionId} active=${this.activeResumeOfferId} epoch=${msg.epoch}`,
          );
          break;
        }
        coopLog(
          "launch",
          `RECV resumeOffer id=${msg.decisionId} wave=${msg.commitment.wave} digest=${msg.commitment.digest} (#810 durable)`,
        );
        this.activeResumeOfferId = msg.decisionId;
        this.activeResumeOfferEpoch = msg.epoch;
        this.activeResumeOfferCommitment = msg.commitment;
        if (this.deliveredResumeOfferId === msg.decisionId) {
          coopLog("launch", `IGNORE duplicate resumeOffer id=${msg.decisionId}`);
          if (this.pendingResumeReply?.decisionId === msg.decisionId) {
            this.transport.send({
              t: "resumeReply",
              decisionId: msg.decisionId,
              accept: this.pendingResumeReply.accept,
            });
          }
          break;
        }
        this.deliveredResumeOfferId = msg.decisionId;
        if (this.resumeOfferHandler == null) {
          this.pendingResumeOfferCommitment = msg.commitment;
        } else {
          this.resumeOfferHandler(msg.commitment);
        }
        break;
      }
      case "resumeReply": {
        coopLog("launch", `RECV resumeReply id=${msg.decisionId} accept=${msg.accept} (#810 durable)`);
        const waiter = this.resumeReplyWaiter;
        if (
          msg.accept
          && this.latestResumeDecision?.kind === "resume-accepted"
          && this.latestResumeDecision.decisionId === msg.decisionId
        ) {
          this.transport.send({
            t: "resumeAccepted",
            decisionId: msg.decisionId,
            epoch: this.latestResumeDecision.epoch,
            commitment: this.latestResumeDecision.commitment,
          });
          break;
        }
        if (waiter == null || waiter.decisionId !== msg.decisionId) {
          coopWarn("launch", `DROP stale resumeReply id=${msg.decisionId} active=${waiter?.decisionId ?? "none"}`);
          break;
        }
        this.resumeReplyWaiter = null;
        if (msg.accept) {
          const commitment = this.latestResumeDecision?.kind === "offer" ? this.latestResumeDecision.commitment : null;
          if (
            commitment == null
            || !this.restoreCheckpointIdentity(commitment.runId, commitment.checkpointRevision, "resume-accepted-host")
          ) {
            coopWarn("launch", `DROP resumeReply id=${msg.decisionId}: immutable commitment missing`);
            waiter.finish(false);
            break;
          }
          this.beginNewOperationEpoch("cold-resume", false);
          this.prepareP33BindingForCurrentBoundary(true, "resume");
          this.latestResumeDecision = {
            kind: "resume-accepted",
            decisionId: msg.decisionId,
            epoch: this.sessionEpochValue,
            commitment,
          };
          recordCoopCausalEvent({
            domain: "lobby",
            stage: "resume-accepted-committed",
            causalId: msg.decisionId,
            role: "host",
            epoch: this.sessionEpochValue,
            wave: commitment.wave,
          });
          this.cancelResumeApplyWait(false);
          let finish!: (success: boolean) => void;
          const promise = new Promise<boolean>(resolve => {
            finish = resolve;
          });
          this.resumeApplyAckWaiter = { decisionId: msg.decisionId, promise, finish };
          this.transport.send({
            t: "resumeAccepted",
            decisionId: msg.decisionId,
            epoch: this.sessionEpochValue,
            commitment,
          });
          this.sendHello();
        }
        waiter.finish(msg.accept);
        break;
      }
      case "resumeAccepted": {
        const pending = this.pendingResumeReply;
        const exactOffer =
          isResumeCommitment(msg.commitment)
          && this.activeResumeOfferId === msg.decisionId
          && sameResumeCommitment(this.activeResumeOfferCommitment, msg.commitment)
          && msg.epoch > this.activeResumeOfferEpoch;
        if (!exactOffer || !Number.isSafeInteger(msg.epoch) || msg.epoch <= 0) {
          coopWarn("launch", `DROP malformed/foreign resumeAccepted id=${msg.decisionId} epoch=${msg.epoch}`);
          break;
        }
        if (
          pending == null
          && this.sessionEpochValue === msg.epoch
          && this.runIdValue === msg.commitment.runId
          && this.checkpointRevisionValue === msg.commitment.checkpointRevision
        ) {
          coopLog("launch", `IGNORE duplicate resumeAccepted id=${msg.decisionId}`);
          if (this.latestResumeApplyResult?.decisionId === msg.decisionId) {
            this.transport.send({ t: "resumeApplied", ...this.latestResumeApplyResult });
          }
          break;
        }
        if (pending == null || !pending.accept || pending.decisionId !== msg.decisionId) {
          coopWarn("launch", `DROP stale resumeAccepted id=${msg.decisionId} pending=${pending?.decisionId ?? "none"}`);
          break;
        }
        if (
          msg.epoch <= this.sessionEpochValue
          || !this.restoreCheckpointIdentity(
            msg.commitment.runId,
            msg.commitment.checkpointRevision,
            "resume-accepted-guest",
          )
        ) {
          coopWarn(
            "launch",
            `DROP stale resumeAccepted epoch=${msg.epoch} current=${this.sessionEpochValue} id=${msg.decisionId}`,
          );
          break;
        }
        this.sessionEpochValue = msg.epoch;
        this.prepareP33BindingForCurrentBoundary(false, "resume");
        this.onEpochNegotiated?.(msg.epoch);
        recordCoopCausalEvent({
          domain: "lobby",
          stage: "resume-accepted-adopted",
          causalId: msg.decisionId,
          role: "guest",
          epoch: msg.epoch,
        });
        this.pendingResumeReply = null;
        this.rememberSettledResumeOfferReply(msg.decisionId, true);
        pending.finish(true);
        break;
      }
      case "resumeApplied": {
        const waiter = this.resumeApplyAckWaiter;
        if (waiter == null || waiter.decisionId !== msg.decisionId) {
          if (
            this.latestResumeDecision?.kind === "resume-accepted"
            && this.latestResumeDecision.decisionId === msg.decisionId
          ) {
            this.transport.send({ t: "resumeAppliedAck", decisionId: msg.decisionId });
            break;
          }
          coopWarn("launch", `DROP stale resumeApplied id=${msg.decisionId} active=${waiter?.decisionId ?? "none"}`);
          break;
        }
        this.resumeApplyAckWaiter = null;
        if (this.resumeApplyTimer != null) {
          clearTimeout(this.resumeApplyTimer);
          this.resumeApplyTimer = null;
        }
        waiter.finish(msg.success);
        recordCoopCausalEvent({
          domain: "snapshot",
          stage: msg.success ? "resume-apply-observed" : "resume-apply-failed-observed",
          causalId: `${msg.decisionId}:snapshot`,
          parentId: msg.decisionId,
          role: "host",
          epoch: this.sessionEpochValue,
        });
        this.transport.send({ t: "resumeAppliedAck", decisionId: msg.decisionId });
        break;
      }
      case "resumeAppliedAck": {
        if (this.latestResumeApplyResult?.decisionId === msg.decisionId) {
          this.latestResumeApplyResult = null;
        }
        const delivery = this.resumeApplyDeliveryWaiter;
        if (delivery?.decisionId === msg.decisionId) {
          this.resumeApplyDeliveryWaiter = null;
          delivery.finish(true);
        }
        break;
      }
      case "resumeRelease": {
        if (this.role !== "guest" || this.activeResumeOfferId !== msg.decisionId) {
          coopWarn("launch", `DROP stale resumeRelease id=${msg.decisionId}`);
          break;
        }
        if (this.appliedResumeReleaseId === msg.decisionId) {
          this.transport.send({ t: "resumeReleaseAck", decisionId: msg.decisionId });
          break;
        }
        this.pendingResumeReleaseId = msg.decisionId;
        if (this.resumeReleaseArrivalWaiter != null) {
          this.pendingResumeReleaseId = null;
          this.appliedResumeReleaseId = msg.decisionId;
          this.transport.send({ t: "resumeReleaseAck", decisionId: msg.decisionId });
          this.cancelResumeReleaseArrival(true);
        }
        break;
      }
      case "resumeReleaseAck": {
        if (this.role !== "host" || this.latestResumeReleaseId !== msg.decisionId) {
          break;
        }
        this.latestResumeReleaseId = null;
        this.ackedResumeReleaseId = msg.decisionId;
        const waiter = this.resumeReleaseAckWaiter;
        if (waiter?.decisionId === msg.decisionId) {
          this.resumeReleaseAckWaiter = null;
          this.cancelResumeReleaseAck(true);
          waiter.finish(true);
        }
        break;
      }
      case "resumeBlocked": {
        if (
          !(["unsafe-role-reversal", "legacy-unmappable", "replica-unavailable"] as const).includes(msg.reason)
          || !Number.isInteger(msg.wave)
          || msg.wave <= 0
        ) {
          coopWarn("launch", `DROP malformed resumeBlocked id=${msg.decisionId}`);
          break;
        }
        if (this.appliedResumeBlockedId === msg.decisionId) {
          this.transport.send({ t: "resumeBlockedAck", decisionId: msg.decisionId });
          break;
        }
        if (this.resumeBlockedHandler == null) {
          this.pendingResumeBlocked = {
            decisionId: msg.decisionId,
            reason: msg.reason,
            wave: msg.wave,
          };
        } else {
          const handler = this.resumeBlockedHandler;
          this.resumeBlockedHandler = null;
          this.appliedResumeBlockedId = msg.decisionId;
          this.transport.send({ t: "resumeBlockedAck", decisionId: msg.decisionId });
          handler(msg.reason, msg.wave);
        }
        break;
      }
      case "resumeBlockedAck": {
        const waiter = this.resumeBlockedAckWaiter;
        if (waiter?.decisionId === msg.decisionId) {
          this.resumeBlockedAckWaiter = null;
          waiter.finish(true);
        }
        break;
      }
      case "resumeCheckpoint": {
        if (
          this.role !== "guest"
          || !isResumeCommitment(msg.commitment)
          || !this.resumeCommitmentMatchesCurrentSession(msg.commitment, true)
          || typeof msg.checkpointId !== "string"
          || msg.checkpointId.length === 0
          || typeof msg.session !== "string"
          || typeof msg.mirrorCloud !== "boolean"
        ) {
          coopWarn("launch", `DROP resumeCheckpoint id=${msg.checkpointId}: foreign/malformed commitment`);
          this.transport.send({
            t: "resumeCheckpointAck",
            checkpointId: msg.checkpointId,
            success: false,
            reason: "invalid-checkpoint",
          });
          break;
        }
        if (this.appliedResumeCheckpointId === msg.checkpointId) {
          this.transport.send({
            t: "resumeCheckpointAck",
            checkpointId: msg.checkpointId,
            success: true,
          });
          break;
        }
        const checkpoint = {
          checkpointId: msg.checkpointId,
          commitment: msg.commitment,
          session: msg.session,
          mirrorCloud: msg.mirrorCloud,
        };
        if (this.resumeCheckpointHandler == null) {
          this.pendingResumeCheckpoint = checkpoint;
        } else {
          this.enqueueResumeCheckpointPersistence(checkpoint);
        }
        break;
      }
      case "resumeCheckpointAck": {
        if (this.role !== "host" || typeof msg.checkpointId !== "string" || typeof msg.success !== "boolean") {
          break;
        }
        const waiter = this.resumeCheckpointAckWaiter;
        const latestMatches = this.latestResumeCheckpoint?.checkpointId === msg.checkpointId;
        // A timeout only releases gameplay's bounded waiter; it deliberately retains the durable
        // outbox. A later reconnect ACK must still retire that outbox even though no waiter exists,
        // otherwise every future channel replacement replays the same checkpoint forever.
        if (msg.success && latestMatches) {
          this.latestResumeCheckpoint = null;
        }
        if (waiter?.checkpointId === msg.checkpointId) {
          this.resumeCheckpointAckWaiter = null;
          waiter.finish(
            msg.success
              ? { status: "persisted" }
              : {
                  status: "nack",
                  reason:
                    msg.reason != null
                    && (
                      [
                        "runtime-invalid",
                        "invalid-checkpoint",
                        "no-safe-slot",
                        "slot-conflict",
                        "storage-failed",
                        "cloud-failed",
                        "cloud-conflict",
                      ] as const
                    ).includes(msg.reason)
                      ? msg.reason
                      : "invalid-checkpoint",
                },
          );
        }
        break;
      }
      case "resumeStartNew": {
        if (
          this.role !== "guest"
          || !Number.isSafeInteger(msg.epoch)
          || msg.epoch <= 0
          || !isCoopRunId(msg.runId)
          || !Number.isSafeInteger(msg.checkpointRevision)
          || msg.checkpointRevision < 0
        ) {
          coopWarn("launch", `DROP malformed resumeStartNew id=${msg.decisionId}`);
          break;
        }
        // #810 barrier release: buffer if the guest UI has not armed its handler yet
        // (the release can beat the arm), else fire it now.
        coopLog("launch", `RECV resumeStartNew id=${msg.decisionId} (#810 durable barrier release)`);
        const exactCurrentIdentity =
          this.sessionEpochValue === msg.epoch
          && this.runIdValue === msg.runId
          && this.checkpointRevisionValue === msg.checkpointRevision;
        if (this.appliedResumeStartNewId === msg.decisionId && exactCurrentIdentity) {
          coopLog("launch", `RE-ACK duplicate resumeStartNew id=${msg.decisionId}`);
          this.transport.send({ t: "resumeDecisionAck", decisionId: msg.decisionId });
          break;
        }
        if (
          this.pendingResumeStartNewId === msg.decisionId
          && this.pendingResumeStartNewEpoch === msg.epoch
          && exactCurrentIdentity
        ) {
          coopLog("launch", `IGNORE duplicate pending resumeStartNew id=${msg.decisionId}`);
          break;
        }
        if (
          msg.epoch <= this.sessionEpochValue
          || !this.restoreCheckpointIdentity(msg.runId, msg.checkpointRevision, "start-new-received")
        ) {
          coopWarn(
            "launch",
            `DROP stale/same-epoch resumeStartNew id=${msg.decisionId} epoch=${msg.epoch} current=${this.sessionEpochValue}`,
          );
          break;
        }
        this.sessionEpochValue = msg.epoch;
        this.prepareP33BindingForCurrentBoundary(false, "fresh");
        this.onEpochNegotiated?.(msg.epoch);
        if (this.activeResumeOfferId != null) {
          this.rememberSettledResumeOfferReply(this.activeResumeOfferId, false);
        }
        this.cancelPendingResumeReply(false);
        this.pendingResumeOfferCommitment = null;
        this.activeResumeOfferId = null;
        this.activeResumeOfferEpoch = 0;
        this.activeResumeOfferCommitment = null;
        if (this.resumeStartNewHandler == null) {
          this.pendingResumeStartNewId = msg.decisionId;
          this.pendingResumeStartNewEpoch = msg.epoch;
        } else {
          const handler = this.resumeStartNewHandler;
          this.resumeStartNewHandler = null;
          handler();
          this.appliedResumeStartNewId = msg.decisionId;
          this.transport.send({ t: "resumeDecisionAck", decisionId: msg.decisionId });
        }
        break;
      }
      case "resumeDecisionAck": {
        const waiter = this.resumeStartNewAckWaiter;
        if (waiter == null || waiter.decisionId !== msg.decisionId) {
          coopWarn(
            "launch",
            `DROP stale resumeDecisionAck id=${msg.decisionId} active=${waiter?.decisionId ?? "none"}`,
          );
          break;
        }
        coopLog("launch", `RECV resumeDecisionAck id=${msg.decisionId} -> start-new committed on both peers`);
        this.resumeStartNewAckWaiter = null;
        this.ackedResumeStartNewId = msg.decisionId;
        waiter.finish(true);
        break;
      }
      case "hello": {
        if ("pairingId" in msg) {
          this.handleP33Hello(msg);
          break;
        }
        if (this.p33Context != null) {
          this.p33BindingRejected = true;
          coopWarn("launch", "REFUSE legacy hello after authenticated P33 was selected");
          this.notifyCompatibilityLifecycle();
          this.emit();
          break;
        }
        let announcePromotedHost = false;
        // #807 C (version negotiation): a protocol mismatch means someone runs a stale cached
        // bundle. Record + warn loudly; the runtime shows both players the hard-refresh banner.
        this.partnerVersionValue = msg.version;
        if (msg.version !== this.version) {
          coopWarn(
            "launch",
            `PROTOCOL VERSION MISMATCH: ours=${this.version} partner=${msg.version} - one client is on a stale build`,
          );
          // Hard launch barrier: retain just enough identity for the UI's refresh banner, but do not
          // reconcile roles/epochs/capabilities with an incompatible peer. Roster frames may already be
          // in flight; `bothReady()` also checks versionMismatch, so no ordering can cross into a run.
          this._partnerConnected = true;
          this._partnerName = msg.username;
          this._partnerReady = false;
          this.emit();
          break;
        }
        // Deterministic role reconciliation (#633): if the peer claims the SAME role
        // as us (the lobby race assigned both clients the same role - the live "both
        // wait, nobody commands the 2nd slot, 30s stall" bug), break the tie IDENTICALLY
        // on both clients so exactly one ends up host (field 0) and the other guest
        // (field 1). Lower tiebreak nonce -> host; ties fall back to the username, then
        // to the existing role. Runs on the handshake, before roster/battle, so all
        // role-keyed state downstream sees the corrected role.
        if (msg.role === this.role) {
          const beforeRole = this.role;
          const peerTie = typeof msg.tiebreak === "number" ? msg.tiebreak : Number.POSITIVE_INFINITY;
          let iAmHost: boolean;
          if (this.tiebreak !== peerTie) {
            iAmHost = this.tiebreak < peerTie;
          } else if (this.username === msg.username) {
            iAmHost = this.role === "host"; // degenerate: identical everything; keep as-is
          } else {
            iAmHost = canonicalCoopParticipantPair(this.username, msg.username)[0] === this.username;
          }
          this.role = iAmHost ? "host" : "guest";
          this.partnerRoleId = coopPartnerRole(this.role);
          if (beforeRole === "host" && this.role === "guest") {
            // Our old candidate was never authoritative. Clear it before adopting the actual host's
            // epoch even when that numeric value is lower (role reconciliation defines authority).
            this.sessionEpochValue = 0;
            this.runIdValue = "";
            this.checkpointRevisionValue = 0;
          } else if (beforeRole === "guest" && this.role === "host") {
            this.sessionEpochValue = this.epochCandidate;
            this.runIdValue = mintCoopRunId();
            this.checkpointRevisionValue = 0;
            this.onEpochNegotiated?.(this.sessionEpochValue);
            announcePromotedHost = true;
          }
          coopWarn(
            "launch",
            `hello ROLE-CONFLICT both claimed role=${msg.role}; tiebreak local=${this.tiebreak} peer=${peerTie} `
              + `username local=${this.username} peer=${msg.username} -> resolved role ${beforeRole}->${this.role}`,
          );
        } else {
          coopLog(
            "launch",
            `hello recv partner=${msg.username} partnerRole=${msg.role} (local role=${this.role}; no conflict)`,
          );
        }
        this._partnerConnected = true;
        this._partnerName = msg.username;
        if (this.role === "guest") {
          const validPersistenceIdentity =
            msg.role === "host"
            && isCoopRunId(msg.runId)
            && typeof msg.checkpointRevision === "number"
            && Number.isSafeInteger(msg.checkpointRevision)
            && msg.checkpointRevision >= 0;
          if (!validPersistenceIdentity) {
            coopWarn("launch", "DROP host hello with missing/invalid persistence identity");
          } else if (!Number.isSafeInteger(msg.epoch) || msg.epoch <= 0) {
            coopWarn("launch", `DROP invalid host epoch=${msg.epoch}`);
          } else if (msg.epoch < this.sessionEpochValue) {
            coopWarn("launch", `DROP stale host epoch=${msg.epoch} current=${this.sessionEpochValue}`);
          } else if (msg.epoch === this.sessionEpochValue) {
            if (this.runIdValue === "") {
              this.restoreCheckpointIdentity(msg.runId!, msg.checkpointRevision!, "host-hello-initial");
            } else if (this.runIdValue === msg.runId) {
              this.restoreCheckpointIdentity(msg.runId!, msg.checkpointRevision!, "host-hello-refresh");
            } else {
              coopWarn(
                "launch",
                `DROP same-epoch host hello run change epoch=${msg.epoch} currentRun=${this.runIdValue} incoming=${msg.runId}`,
              );
            }
          } else if (msg.epoch > this.sessionEpochValue) {
            if (this.runIdValue === "" || this.runIdValue === msg.runId) {
              this.sessionEpochValue = msg.epoch;
              this.restoreCheckpointIdentity(msg.runId!, msg.checkpointRevision!, "host-hello-new-epoch-same-run");
              coopLog("launch", `EPOCH ADOPT epoch=${msg.epoch} from same-run host hello`);
              this.onEpochNegotiated?.(msg.epoch);
              this.sendHello();
            } else {
              coopWarn(
                "launch",
                `DEFER new-epoch host hello run change epoch=${msg.epoch} currentRun=${this.runIdValue} incoming=${msg.runId}; awaiting atomic launch decision`,
              );
            }
          }
        } else if (msg.epoch !== 0 && msg.epoch !== this.sessionEpochValue) {
          coopWarn("launch", `host IGNORE peer epoch=${msg.epoch} authoritative=${this.sessionEpochValue}`);
        }
        if (announcePromotedHost) {
          this.sendHello();
        }
        // #896 W2e-R2: (re)negotiate the capability set now the peer's advertised set is known. Runs on
        // the initial hello AND on a hot-rejoin re-announce (resyncLobbyState) -> same frozen result.
        this.negotiateCapabilities(msg.capabilities);
        this.emit();
        break;
      }
      case "rosterSync":
        if (msg.role === this.partnerRoleId) {
          this.roster.replace(this.partnerRoleId, msg.entries);
          this._partnerReady = msg.ready;
          // #896 W2e-R2: negotiate off rosterSync too, so a hello lost on a flap still lands the peer's
          // capabilities via the self-healing roster re-broadcast (#868).
          this.negotiateCapabilities(msg.capabilities);
          coopLog(
            "roster",
            `rosterSync RECV partner=${this.partnerRoleId} entries=${msg.entries.length} partnerReady=${msg.ready} `
              + `partnerCount=${this.roster.count(this.partnerRoleId)} -> bothReady=${this.bothReady()} (local role=${this.role})`,
          );
          this.emit();
        } else {
          coopWarn(
            "roster",
            `rosterSync RECV IGNORED role=${msg.role} != partnerRole=${this.partnerRoleId} (local role=${this.role})`,
          );
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
          //
          // PRIME DOUBLE-COUNT SUSPECT (the live guest=5 host=4 desync): this inbound
          // bump landing ON TOP of a local advance is exactly how a client gets one
          // ahead. Log received vs local-before and whether it bumped; mergeRemote
          // itself logs the BUMP/NO-CHANGE decision.
          const localBefore = this.interactionTurn.toJSON();
          if (isCoopDebug()) {
            // BUG2: mergeRemote now DEFERS the peer value into pendingRemote (folded in at
            // the next LOCAL advance) instead of bumping the live counter here - so the
            // live counter cannot be poisoned in the inter-wave gap. Log the DEFER, never
            // assert a bump that no longer happens at receive time.
            const willDefer = Number.isInteger(msg.choice) && msg.choice > localBefore;
            coopLog(
              "interaction",
              `RECV interaction broadcast (deferred catch-up net) received=${msg.choice} localBefore=${localBefore} role=${this.role} -> ${willDefer ? `WILL DEFER to ${msg.choice} (folds in at next advance if still ahead)` : "no defer (local >= received)"}`,
            );
          }
          this.interactionTurn.mergeRemote(msg.choice);
          this.emit();
        }
        break;
      case "requestInteractionCounter":
        coopLog(
          "interaction",
          `RECV requestInteractionCounter need=${msg.need} local=${this.interactionTurn.toJSON()} role=${this.role}`,
        );
        this.broadcastInteractionCounter("request");
        break;
      case "runConfig":
        // The HOST decides difficulty + challenges + seed; the guest mirrors them
        // so the run is coherent and both engines stay in lockstep (#633, LIVE-A/C).
        // Only honour it FROM the host.
        if (this.role === "guest" && this.compatibilityAccepted) {
          // The guest adopts the host's chosen netcode (#633 M3: authoritative-only); an
          // absent value (an in-flight save from before this field) means "authoritative".
          const netcodeMode = msg.netcodeMode ?? "authoritative";
          // Showdown 1v1 PvP (C1): adopt the host's session kind; absent -> "coop" (an
          // older host / in-flight save), so co-op stays byte-identical.
          const kind = msg.kind ?? "coop";
          coopLog("runtime", `guest received difficulty=${msg.difficulty} netcode=${netcodeMode} kind=${kind}`);
          this._netcodeMode = netcodeMode;
          this._sessionKind = kind;
          this._runConfig = {
            difficulty: msg.difficulty,
            challenges: msg.challenges,
            seed: msg.seed,
            netcodeMode,
            kind,
          };
          this.emit();
        }
        break;
      case "requestRunConfig":
        // Guest asked us to (re)send the runConfig (#633 self-healing handshake). Only the
        // HOST is the authority, and only once it has actually decided (picked difficulty).
        if (this.role === "host" && this._runConfig != null) {
          coopLog("runtime", "host re-broadcast on guest request");
          this.broadcastRunConfig(this._runConfig);
        }
        break;
      case "requestRoster":
        // #868: the peer asked us to (re)send our roster + ready (the symmetric self-heal for the
        // roster/ready direction). Re-broadcast the same idempotent snapshot; a partner that lost
        // our lock-in now flips partnerReady and the run can launch. Both roles answer (either side
        // can be the one waiting). Harmless before we have picked (an empty roster, ready=false).
        coopLog("roster", `requestRoster RECV -> re-broadcast local roster+ready (role=${this.role}) (#868)`);
        this.broadcastLocal();
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
        const presentationSections = new Set(["movesName", "abilitiesName"]);
        const functionalDiff = diff.filter(name => !presentationSections.has(name));
        const presentationDiff = diff.filter(name => presentationSections.has(name));
        this._functionalFingerprintStatus = functionalDiff.length === 0 ? "match" : "mismatch";
        this._presentationFingerprintMismatch = presentationDiff.length > 0;
        if (diff.length === 0) {
          coopLog("checksum", "MATCH - data tables identical across clients");
        } else {
          const detail = diff
            .map(
              name =>
                `${name} local=${local[name as keyof ErDataFingerprint].hash}(${local[name as keyof ErDataFingerprint].n})`
                + ` peer=${peer[name as keyof ErDataFingerprint].hash}(${peer[name as keyof ErDataFingerprint].n})`,
            )
            .join(" ");
          if (functionalDiff.length > 0) {
            coopWarn(
              "checksum",
              `FUNCTIONAL MISMATCH sections=${functionalDiff.join(",")} - launch remains closed - ${detail}`,
            );
          } else {
            coopWarn(
              "checksum",
              `PRESENTATION MISMATCH sections=${presentationDiff.join(",")} - simulation compatible - ${detail}`,
            );
          }
        }
        this.emit();
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

  private notifyCompatibilityLifecycle(): void {
    for (const handler of [...this.compatibilityLifecycleHandlers]) {
      handler();
    }
  }
}
