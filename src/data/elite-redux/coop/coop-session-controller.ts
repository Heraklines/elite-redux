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
import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import { CoopRoster, type CoopRosterEntry } from "#data/elite-redux/coop/coop-roster";
import { CoopInteractionTurn, type CoopPlayerId, coopSeatOfRole } from "#data/elite-redux/coop/coop-session";
import type {
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
  /** #810 resume flow: guest-side offer handler + buffered offer, host-side reply waiter. */
  private resumeOfferHandler: ((wave: number) => void) | null = null;
  private pendingResumeOfferWave: number | null = null;
  private resumeReplyWaiter: ((accept: boolean) => void) | null = null;
  /** #810 barrier: guest-side "start new" handler + buffered flag (host's release signal). */
  private resumeStartNewHandler: (() => void) | null = null;
  private pendingResumeStartNew = false;

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

  constructor(transport: CoopTransport, opts: CoopSessionOptions = {}) {
    this.transport = transport;
    this.role = transport.role;
    this.partnerRoleId = coopPartnerRole(transport.role);
    this.tiebreak = opts.tiebreak ?? Math.random();
    this.username = opts.username ?? (transport.role === "host" ? "Player 1" : "Player 2");
    this.version = opts.version ?? "1";
    this.offMessage = transport.onMessage(msg => this.handleMessage(msg));
  }

  /** #807 C: true when the partner's hello carried a DIFFERENT protocol version. */
  get versionMismatch(): boolean {
    return this.partnerVersionValue !== undefined && this.partnerVersionValue !== this.version;
  }

  /** #807 C: the partner's reported version ("?" before the handshake). */
  get partnerVersion(): string {
    return this.partnerVersionValue ?? "?";
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
    coopLog("launch", `SEND resumeOffer wave=${wave} (#810)`);
    this.transport.send({ t: "resumeOffer", wave });
    return new Promise<boolean>(resolve => {
      const finish = (accept: boolean) => {
        if (this.resumeReplyWaiter === finish) {
          this.resumeReplyWaiter = null;
        }
        resolve(accept);
      };
      this.resumeReplyWaiter = finish;
      setTimeout(() => {
        if (this.resumeReplyWaiter === finish) {
          this.resumeReplyWaiter = null;
          coopWarn("launch", "resumeOffer TIMEOUT (no reply in 60s) -> treated as declined (#810)");
          resolve(false);
        }
      }, 60_000);
    });
  }

  /** #810 GUEST: answer the host's resume offer. */
  replyResume(accept: boolean): void {
    coopLog("launch", `SEND resumeReply accept=${accept} (#810)`);
    this.transport.send({ t: "resumeReply", accept });
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
    coopLog("launch", "SEND resumeStartNew (#810 barrier release)");
    this.transport.send({ t: "resumeStartNew" });
  }

  /** Announce ourselves to the partner. Call once the transport is connected. */
  connect(): void {
    coopLog(
      "launch",
      `session connect role=${this.role} partnerRole=${this.partnerRoleId} netcode=${this._netcodeMode} `
        + `username=${this.username} version=${this.version} tiebreak=${this.tiebreak}`,
    );
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

  // #833 dangler cleanup: `restoreInteractionCounter(counter)` was removed here. It was
  // PRODUCTION-DEAD - the interaction counter is not carried in `SessionSaveData`, so a real resume
  // never had a value to restore; it re-initializes the counter identically on both clients from the
  // fresh runtime assembly (see `interactionCounter()` above + `docs/coop-structural-gaps.md` Part 3
  // for the save/resume-mid-interaction limitation). Wiring it into resume would first require adding
  // the counter to `SessionSaveData` (a schema change, not a local seam), so the dead method was
  // dropped rather than left dangling.

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

  /** Tear down: stop listening to the transport (does not close the transport). */
  dispose(): void {
    this.offMessage();
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
        coopLog("launch", `RECV resumeOffer wave=${msg.wave} (#810)`);
        if (this.resumeOfferHandler == null) {
          this.pendingResumeOfferWave = msg.wave;
        } else {
          this.resumeOfferHandler(msg.wave);
        }
        break;
      }
      case "resumeReply": {
        coopLog("launch", `RECV resumeReply accept=${msg.accept} (#810)`);
        const waiter = this.resumeReplyWaiter;
        this.resumeReplyWaiter = null;
        waiter?.(msg.accept);
        break;
      }
      case "resumeStartNew": {
        // #810 barrier release: buffer if the guest UI has not armed its handler yet
        // (the release can beat the arm), else fire it now.
        coopLog("launch", "RECV resumeStartNew (#810 barrier release)");
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
        this.emit();
        break;
      }
      case "rosterSync":
        if (msg.role === this.partnerRoleId) {
          this.roster.replace(this.partnerRoleId, msg.entries);
          this._partnerReady = msg.ready;
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
