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
import {
  computeErDataFingerprint,
  diffErDataFingerprint,
  type ErDataFingerprint,
  logErDataFingerprint,
} from "#data/elite-redux/coop/coop-data-fingerprint";
import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import { CoopRoster, type CoopRosterEntry } from "#data/elite-redux/coop/coop-roster";
import { CoopInteractionTurn, type CoopPlayerId, coopSeatOfRole } from "#data/elite-redux/coop/coop-session";
import type {
  CoopConnectionState,
  CoopMessage,
  CoopNetcodeMode,
  CoopRole,
  CoopSessionKind,
  CoopTransport,
} from "#data/elite-redux/coop/coop-transport";

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
  /**
   * #896 W2e-R2: invoked once the capability set is (re)negotiated (on the peer's first hello/rosterSync
   * that carries capabilities, and again on a hot-rejoin re-handshake). Receives the frozen effective
   * set. The runtime uses it to drive the per-surface activation from the negotiated intersection.
   */
  onCapabilitiesNegotiated?: ((negotiated: ReadonlySet<string>) => void) | undefined;
  /** Publishes the host-negotiated operation epoch into every surface adapter. */
  onEpochNegotiated?: ((epoch: number) => void) | undefined;
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
  /** #896 W2e-R2: the partner's advertised capability set (undefined until a hello/rosterSync carries it). */
  private partnerCapabilities: string[] | undefined;
  /** #896 W2e-R2: the callback invoked with the frozen effective set each time it is (re)negotiated. */
  private readonly onCapabilitiesNegotiated: ((negotiated: ReadonlySet<string>) => void) | undefined;
  private readonly onEpochNegotiated: ((epoch: number) => void) | undefined;
  /** Candidate belongs to this controller; it becomes authoritative iff this side is host. */
  private readonly epochCandidate: number;
  private sessionEpochValue: number;
  /** #810 resume flow: guest-side offer handler + buffered offer, host-side reply waiter. */
  private resumeOfferHandler: ((wave: number) => void) | null = null;
  private pendingResumeOfferWave: number | null = null;
  private resumeReplyWaiter: { decisionId: string; finish: (accept: boolean) => void } | null = null;
  /** #810 barrier: guest-side "start new" handler + buffered flag (host's release signal). */
  private resumeStartNewHandler: (() => void) | null = null;
  private pendingResumeStartNew = false;
  /** Durable, host-authored lobby decision. Re-announced after a channel replacement. */
  private latestResumeDecision:
    | { readonly kind: "offer"; readonly decisionId: string; readonly wave: number }
    | { readonly kind: "start-new"; readonly decisionId: string }
    | null = null;
  /** Guest-side identity of the latest offer; replies are structurally tied to it. */
  private activeResumeOfferId: string | null = null;
  /** Guest-side de-duplication of an offer re-announced after reconnect. */
  private deliveredResumeOfferId: string | null = null;
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

  private readonly changeHandlers = new Set<(snap: CoopSessionSnapshot) => void>();
  private readonly offMessage: () => void;
  private readonly offStateChange: () => void;
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
    this.role = transport.role;
    this.partnerRoleId = coopPartnerRole(transport.role);
    this.tiebreak = opts.tiebreak ?? Math.random();
    this.username = opts.username ?? (transport.role === "host" ? "Player 1" : "Player 2");
    this.version = opts.version ?? "1";
    this.localCapabilities = opts.localCapabilities;
    this.onCapabilitiesNegotiated = opts.onCapabilitiesNegotiated;
    this.onEpochNegotiated = opts.onEpochNegotiated;
    this.epochCandidate = this.mintEpoch(0);
    this.sessionEpochValue = this.role === "host" ? this.epochCandidate : 0;
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

  /** The agreed host-authored control-plane epoch (0 only before a guest receives hello). */
  get sessionEpoch(): number {
    return this.sessionEpochValue;
  }

  /** Host-only hard boundary: cold resume/new run. Hot rejoin deliberately never calls this. */
  beginNewOperationEpoch(reason: string): number {
    if (this.role !== "host") {
      coopWarn("launch", `IGNORE beginNewOperationEpoch(${reason}) on non-host role=${this.role}`);
      return this.sessionEpochValue;
    }
    this.sessionEpochValue = this.mintEpoch(this.sessionEpochValue);
    coopLog("launch", `EPOCH MINT epoch=${this.sessionEpochValue} reason=${reason}`);
    this.onEpochNegotiated?.(this.sessionEpochValue);
    this.sendHello();
    return this.sessionEpochValue;
  }

  private mintEpoch(previous: number): number {
    const candidate = Date.now() * 1024 + Math.floor(Math.random() * 1024);
    return Number.isSafeInteger(candidate) && candidate > previous ? candidate : previous + 1;
  }

  private sendHello(): void {
    this.transport.send({
      t: "hello",
      version: this.version,
      username: this.username,
      role: this.role,
      tiebreak: this.tiebreak,
      epoch: this.sessionEpochValue,
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
    this.onCapabilitiesNegotiated?.(negotiated);
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
  armResumeOfferHandler(handler: (wave: number) => void): void {
    this.resumeOfferHandler = handler;
    if (this.pendingResumeOfferWave != null) {
      const wave = this.pendingResumeOfferWave;
      this.pendingResumeOfferWave = null;
      handler(wave);
    }
  }

  /**
   * #810 HOST: offer to resume the saved run at `wave`; resolves with the guest's
   * answer (false on a 60s no-reply timeout so the lobby can never hang on it).
   */
  offerResume(wave: number): Promise<boolean> {
    const decisionId = `${Date.now().toString(36)}-${this.tiebreak.toString(36)}-${++this.resumeDecisionSeq}`;
    this.latestResumeDecision = { kind: "offer", decisionId, wave };
    coopLog("launch", `SEND resumeOffer id=${decisionId} wave=${wave} (#810 durable)`);
    return new Promise<boolean>(resolve => {
      const finish = (accept: boolean) => {
        if (this.resumeReplyWaiter?.finish === finish) {
          this.resumeReplyWaiter = null;
        }
        resolve(accept);
      };
      this.resumeReplyWaiter = { decisionId, finish };
      this.transport.send({ t: "resumeOffer", decisionId, wave });
      setTimeout(() => {
        if (this.resumeReplyWaiter?.finish === finish) {
          this.resumeReplyWaiter = null;
          coopWarn("launch", "resumeOffer TIMEOUT (no reply in 60s) -> treated as declined (#810)");
          resolve(false);
        }
      }, 60_000);
    });
  }

  /** #810 GUEST: answer the host's resume offer. */
  replyResume(accept: boolean): void {
    const decisionId = this.activeResumeOfferId;
    if (decisionId == null) {
      coopWarn("launch", `DROP resumeReply accept=${accept}: no active host offer`);
      return;
    }
    coopLog("launch", `SEND resumeReply id=${decisionId} accept=${accept} (#810 durable)`);
    this.transport.send({ t: "resumeReply", decisionId, accept });
  }

  /**
   * #810 barrier GUEST: arm the "host chose new game" release handler. If the host's
   * `resumeStartNew` already arrived (the wire beat the UI), it fires immediately from
   * the buffer - so the guest can never miss the release and hang.
   */
  armResumeStartNewHandler(handler: () => void): void {
    this.resumeStartNewHandler = handler;
    if (this.pendingResumeStartNew) {
      this.pendingResumeStartNew = false;
      handler();
    }
  }

  /**
   * #810 barrier HOST: tell the guest to stop waiting and proceed to a NEW game. Sent on
   * every non-resume outcome (no save, host picked New Game, guest declined, offer timeout).
   */
  sendResumeStartNew(): void {
    this.beginNewOperationEpoch("start-new");
    const decisionId = `${Date.now().toString(36)}-${this.tiebreak.toString(36)}-${++this.resumeDecisionSeq}`;
    this.latestResumeDecision = { kind: "start-new", decisionId };
    coopLog("launch", `SEND resumeStartNew id=${decisionId} (#810 durable barrier release)`);
    this.transport.send({ t: "resumeStartNew", decisionId });
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
   * #788: resolves once the partner's broadcast interaction counter catches up to OURS
   * (immediately when it already has), or after `timeoutMs` (degrade to proceed; resync heals).
   */
  awaitPartnerInteraction(timeoutMs: number): Promise<boolean> {
    return this.interactionTurn.awaitRemoteCounter(this.interactionTurn.toJSON(), timeoutMs);
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
   * The raw interaction counter (the alternating-owner order). NOTE: this is NOT persisted in
   * `SessionSaveData` - a co-op resume does NOT restore it. Both clients re-initialize it identically
   * from the fresh runtime assembly (base 0), which preserves the even/odd ownership parity for a
   * resume that re-enters an interaction from the TOP (the common case). A resume landing INSIDE an
   * in-progress interaction (mid-ME / pending shop handoff) is not restorable as a half-state - see
   * `docs/coop-structural-gaps.md` Part 3 (the dedicated `restoreInteractionCounter` seam was removed
   * as production-dead: the counter is never saved, so there was nothing for it to restore).
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
      this.transport.send({
        t: "interaction",
        screen: COOP_INTERACTION_TURN_SCREEN,
        choice: this.interactionTurn.toJSON(),
      });
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
   * counter no longer silently FLIPS ownership. Tolerant of an absent/invalid value (older saves -> base 0,
   * the prior behavior). A HOT rejoin does not use this (the runtime + its live counter survive in place,
   * validated in Step 0); this is the COLD-resume path only.
   */
  restoreInteractionCounter(counter: number): void {
    if (!Number.isFinite(counter) || counter < 0) {
      return; // older save / invalid -> keep the fresh base-0 counter (prior behavior)
    }
    this.interactionTurn.restore(counter);
    coopLog("interaction", `restoreInteractionCounter(${counter}) (role=${this.role}, cold-resume)`);
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
    // Re-announce identity (same shape as connect()'s hello). #896 W2e-R2: re-advertise capabilities
    // so a hot-rejoin re-runs the negotiation to the SAME frozen set (identical intersection inputs).
    this.sendHello();
    // Re-broadcast our own roster + ready.
    this.broadcastLocal();
    // The HOST re-broadcasts the run config it already decided (no-op before it has picked).
    if (this.role === "host" && this._runConfig != null) {
      this.broadcastRunConfig(this._runConfig);
    }
    if (this.role === "host" && this.latestResumeDecision != null) {
      const decision = this.latestResumeDecision;
      if (decision.kind === "offer") {
        coopLog("launch", `RESEND resumeOffer id=${decision.decisionId} wave=${decision.wave} after reconnect`);
        this.transport.send({ t: "resumeOffer", decisionId: decision.decisionId, wave: decision.wave });
      } else {
        coopLog("launch", `RESEND resumeStartNew id=${decision.decisionId} after reconnect`);
        this.transport.send({ t: "resumeStartNew", decisionId: decision.decisionId });
      }
    }
    // Pull the peer's lobby state (heals a loss in the direction we don't own).
    if (this.role === "guest") {
      this.requestRunConfig();
    }
    this.requestRoster();
  }

  /**
   * #868: react to the transport lifecycle. A `disconnected` arms the reconnect flag; the next
   * transition back to `connected` (a #805 hot-rejoin swapped a fresh channel in) is a RECONNECT
   * and re-runs the lobby handshake so state lost while the channel was dark heals. The initial
   * `connecting -> connected` is NOT a reconnect (the flag is unset), so a fresh session is quiet.
   */
  private handleStateChange(state: CoopConnectionState): void {
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

  /** Tear down: stop listening to the transport (does not close the transport). */
  dispose(): void {
    this.offMessage();
    this.offStateChange();
    this.changeHandlers.clear();
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

  private handleMessage(msg: CoopMessage): void {
    switch (msg.t) {
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
        coopLog("launch", `RECV resumeOffer id=${msg.decisionId} wave=${msg.wave} (#810 durable)`);
        this.activeResumeOfferId = msg.decisionId;
        if (this.deliveredResumeOfferId === msg.decisionId) {
          coopLog("launch", `IGNORE duplicate resumeOffer id=${msg.decisionId}`);
          break;
        }
        this.deliveredResumeOfferId = msg.decisionId;
        if (this.resumeOfferHandler == null) {
          this.pendingResumeOfferWave = msg.wave;
        } else {
          this.resumeOfferHandler(msg.wave);
        }
        break;
      }
      case "resumeReply": {
        coopLog("launch", `RECV resumeReply id=${msg.decisionId} accept=${msg.accept} (#810 durable)`);
        const waiter = this.resumeReplyWaiter;
        if (waiter == null || waiter.decisionId !== msg.decisionId) {
          coopWarn("launch", `DROP stale resumeReply id=${msg.decisionId} active=${waiter?.decisionId ?? "none"}`);
          break;
        }
        this.resumeReplyWaiter = null;
        if (msg.accept) {
          this.beginNewOperationEpoch("cold-resume");
        }
        waiter.finish(msg.accept);
        break;
      }
      case "resumeStartNew": {
        // #810 barrier release: buffer if the guest UI has not armed its handler yet
        // (the release can beat the arm), else fire it now.
        coopLog("launch", `RECV resumeStartNew id=${msg.decisionId} (#810 durable barrier release)`);
        this.activeResumeOfferId = null;
        if (this.resumeStartNewHandler == null) {
          this.pendingResumeStartNew = true;
        } else {
          const handler = this.resumeStartNewHandler;
          this.resumeStartNewHandler = null;
          handler();
        }
        break;
      }
      case "hello": {
        let announcePromotedHost = false;
        // #807 C (version negotiation): a protocol mismatch means someone runs a stale cached
        // bundle. Record + warn loudly; the runtime shows both players the hard-refresh banner.
        this.partnerVersionValue = msg.version;
        if (msg.version !== this.version) {
          coopWarn(
            "launch",
            `PROTOCOL VERSION MISMATCH: ours=${this.version} partner=${msg.version} - one client is on a stale build`,
          );
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
            iAmHost = this.username < msg.username;
          }
          this.role = iAmHost ? "host" : "guest";
          this.partnerRoleId = coopPartnerRole(this.role);
          if (beforeRole === "host" && this.role === "guest") {
            // Our old candidate was never authoritative. Clear it before adopting the actual host's
            // epoch even when that numeric value is lower (role reconciliation defines authority).
            this.sessionEpochValue = 0;
          } else if (beforeRole === "guest" && this.role === "host") {
            this.sessionEpochValue = this.epochCandidate;
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
          if (!Number.isSafeInteger(msg.epoch) || msg.epoch <= 0) {
            coopWarn("launch", `DROP invalid host epoch=${msg.epoch}`);
          } else if (msg.epoch < this.sessionEpochValue) {
            coopWarn("launch", `DROP stale host epoch=${msg.epoch} current=${this.sessionEpochValue}`);
          } else if (msg.epoch > this.sessionEpochValue) {
            this.sessionEpochValue = msg.epoch;
            coopLog("launch", `EPOCH ADOPT epoch=${msg.epoch} from host hello`);
            this.onEpochNegotiated?.(msg.epoch);
            this.sendHello();
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
      case "runConfig":
        // The HOST decides difficulty + challenges + seed; the guest mirrors them
        // so the run is coherent and both engines stay in lockstep (#633, LIVE-A/C).
        // Only honour it FROM the host.
        if (this.role === "guest") {
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
          coopWarn("checksum", `MISMATCH sections=${diff.join(",")} - ${detail}`);
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
