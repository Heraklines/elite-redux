/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 post-teambuild NEGOTIATION (C2). Rides on the SAME CoopTransport
// as co-op, owning the small handshake between the two clients AFTER each has
// built + locally validated its own team:
//
//   1. each client SENDS its full team manifest (`showdownTeam`) + a READY commit
//      (`showdownReady{teamHash}`) carrying an fnv1a64 fingerprint of its own manifest,
//   2. each client AWAITS the opponent's team + ready, then GATES:
//        - the opponent manifest must pass the STRUCTURAL / FORMAT rules
//          (`validateShowdownTeam` with an ALL-PERMISSIVE UnlockSnapshot), and
//        - the opponent's committed `teamHash` must equal the fingerprint of the
//          manifest they actually sent (anti-tamper cross-check),
//   3. both-valid then RENDEZVOUS at the `showdown-ready` sync point (the shared
//      co-op reciprocal barrier, NOT a bespoke one): neither client crosses into the
//      battle bootstrap until BOTH have arrived at the barrier. ANY violation sends
//      `showdownVoid{illegalTeam}` and rejects (the peer that receives the void also
//      rejects, so a bad team rejects BOTH sides).
//
// TRUST BOUNDARY (documented, deliberate): a client can only validate the opponent's
// manifest against the FORMAT rules, NOT against the opponent's collection - it does
// not have the opponent's save. Collection legality (root/shiny/ability/nature/move
// unlocks) is enforced by the OPPONENT's own client at team-build time (validated
// against ITS unlocks) and, later, by a server-side check. So here the opponent is
// validated with an all-permissive UnlockSnapshot: only structure / level / item /
// mega / IV / duplicate / team-size rules apply cross-client. (Full trust model:
// docs/plans/2026-07-06-showdown-mode-implementation.md "Trust model".)
//
// Engine-FREE (transport + rendezvous + pure rule engine + pure hash only, with the
// mega-form predicate injected), so the whole handshake is unit-testable headlessly over
// a LoopbackTransport - the same protocol runs unchanged over the real WebRTC transport.
// =============================================================================

import { canonicalize, fnv1a64 } from "#data/elite-redux/coop/coop-battle-checksum";
import { CoopRendezvous, getCoopRendezvousWaitMs } from "#data/elite-redux/coop/coop-rendezvous";
import type { CoopMessage, CoopTransport } from "#data/elite-redux/coop/coop-transport";
import { type GhostTrainerProfile, sanitizeGhostProfile } from "#data/elite-redux/er-ghost-profile";
import { addShowdownRejoinResender } from "#data/elite-redux/showdown/showdown-battle-state";
import { isMegaStage } from "#data/elite-redux/showdown/showdown-evolutions";
import {
  type ShowdownMonManifest,
  type ShowdownRuleViolation,
  type UnlockSnapshot,
  validateShowdownTeam,
} from "#data/elite-redux/showdown/showdown-team";

/** The reciprocal rendezvous point both clients cross once both teams are validated + ready. */
export const SHOWDOWN_READY_RENDEZVOUS_POINT = "showdown-ready";

/**
 * B7 item 11: the SHOWDOWN protocol version, carried on the `showdownTeam` exchange (the first MUTUAL
 * showdown message, before the wager). Bump on ANY change to the showdown wire shape / flow so two
 * clients on different bundles fail the negotiation with a clear "hard-refresh" message instead of
 * desyncing one-sided (the "showdown doesn't appear for the other person" class - a stale service-worker
 * cache). Separate from {@linkcode COOP_PROTOCOL_VERSION} (which gates co-op pairing) so co-op is
 * unaffected; both clients exchange it, so EITHER can detect the other running an old build.
 *
 * Bumped to 2 (2026-07-22): the `showdownTeam` message now carries an optional `battleFormat`
 * (tournament doubles/triples field width). Any pre-doubles client is a stale bundle for a
 * doubles/triples tournament, so the proto guard forces a hard-refresh rather than a one-sided
 * singles-vs-doubles desync; a plain singles match still refuses to pair with a stale build.
 *
 * Bumped to 3 (2026-07-22): the enemy-command relay (`showdownCommand`/`showdownCommandRequest`) now
 * carries an optional per-slot `fieldIndex` so a doubles/triples match relays one command PER active
 * slot. A proto-2 client can negotiate a doubles format but cannot key its relay by slot (both slots
 * would collide on turn alone), so it is a stale bundle for a multi-slot match; the proto guard forces
 * a hard-refresh. A singles match stays byte-identical on the wire (fieldIndex omitted == 0).
 */
export const SHOWDOWN_PROTO_VERSION = 3;

/** The field-width format a versus match is played at. Absent on the wire == "singles". */
export type ShowdownBattleFormat = "singles" | "doubles" | "triples";

/**
 * The reciprocal rendezvous point both clients cross once both have LOCKED IN at the wager screen (D3).
 * Defined here (engine-free) rather than on the UI handler so the wager handler AND the vs-CPU spoof
 * share it without either pulling the Phaser UI layer into the co-op runtime.
 */
export const SHOWDOWN_WAGER_COMMIT_POINT = "showdown-wager-commit";

/**
 * How long the pre-battle pipeline waits for the OTHER player across the slow human steps
 * (their teambuild after you confirmed; their stake browsing after you locked). Maintainer
 * rule: teambuilding gets AT LEAST 10 minutes - the co-op 60s rendezvous default is for
 * mid-battle sync points, not for a human assembling a team. ~50ms under vitest so the
 * timeout tests stay fast (mirrors the getCoopRendezvousWaitMs convention).
 */
export function getShowdownPickWaitMs(): number {
  if (typeof process !== "undefined" && process.env?.VITEST) {
    return 50;
  }
  return 600_000;
}

/** Predicate telling whether `(speciesId, formIndex)` is a mega/primal battle form. */
export type IsMegaFormPredicate = (speciesId: number, formIndex: number) => boolean;

/** Why a showdown negotiation rejected (surfaced to the UI / result flow). */
export type ShowdownRejectReason =
  | "illegalTeam"
  | "hashMismatch"
  | "void"
  | "timeout"
  | "protoMismatch"
  | "formatMismatch";

/**
 * Default whole-handshake anti-strand timeout: reuses the co-op rendezvous wait convention
 * ({@linkcode getCoopRendezvousWaitMs} - 60s live, ~50ms under vitest) so a peer that never
 * completes the exchange (drops between connect and team-send, or never crosses the ready
 * barrier) rejects "timeout" instead of stranding the caller forever. Injectable for tests.
 */
function defaultSchedule(cb: () => void, ms: number): () => void {
  const id = setTimeout(cb, ms);
  return () => clearTimeout(id);
}

/** A rejected negotiation carries the reason + (for a local rule failure) the violations. */
export class ShowdownNegotiationError extends Error {
  readonly reason: ShowdownRejectReason;
  /** Populated for a local `illegalTeam`/`hashMismatch`; empty for a received `void`. */
  readonly violations: ShowdownRuleViolation[];
  constructor(reason: ShowdownRejectReason, message: string, violations: ShowdownRuleViolation[] = []) {
    super(message);
    this.name = "ShowdownNegotiationError";
    this.reason = reason;
    this.violations = violations;
  }
}

/** The settled result of a successful negotiation (both teams validated + both ready). */
export interface ShowdownNegotiationResult {
  /** This client's own team (as passed to {@linkcode ShowdownSession.negotiate}). */
  ownManifest: ShowdownMonManifest[];
  /** The opponent's validated team (the host's ENEMY party is built from this in C3). */
  opponentManifest: ShowdownMonManifest[];
  /** The opponent's committed team hash (== the fingerprint of their manifest). */
  opponentTeamHash: string;
  /**
   * The AGREED field-width format for this match (both clients validated equal). Always resolved
   * (defaulting "singles"); the battle bootstrap builds the field to this width.
   */
  battleFormat: ShowdownBattleFormat;
  /**
   * Task C7: the opponent's authored ghost-trainer presentation, RE-SANITIZED on receipt (a hostile
   * peer must not bypass sanitize), or null when the opponent sent none. Stashed on the showdown battle
   * state so the enemy-trainer presentation + result-line handling can read it.
   */
  opponentProfile: GhostTrainerProfile | null;
}

/** Options for {@linkcode ShowdownSession}. */
export interface ShowdownSessionOptions {
  /**
   * Mega-form predicate injected for engine-free testing (default {@linkcode isMegaStage},
   * which reads the live species `forms`). Tests pass a stub so no engine boot is needed.
   */
  isMegaForm?: IsMegaFormPredicate;
  /**
   * The shared reciprocal rendezvous (the live runtime's, so the `showdown-ready` barrier
   * uses the same instance as every other co-op sync point). Defaults to a fresh one over
   * the same transport when omitted (engine-free tests / a standalone negotiation).
   */
  rendezvous?: CoopRendezvous;
  /**
   * Whole-handshake timeout (ms) before {@linkcode ShowdownSession.negotiate} rejects "timeout".
   * Covers BOTH the team-exchange step AND the ready barrier. Defaults to
   * {@linkcode getCoopRendezvousWaitMs} (60s live / ~50ms under vitest).
   */
  timeoutMs?: number;
  /** Timer injection (tests). Returns a cancel fn. Defaults to setTimeout/clearTimeout. */
  schedule?: (cb: () => void, ms: number) => () => void;
}

/**
 * An ALL-PERMISSIVE {@linkcode UnlockSnapshot}: every collection predicate returns true.
 * Used to validate the OPPONENT's manifest, whose collection this client CANNOT see (see the
 * trust-boundary note at the top). Only the format rules (structure / level / item / mega /
 * IVs / duplicates / team size) then bite; collection legality is the opponent-client's job.
 */
const PERMISSIVE_UNLOCKS: UnlockSnapshot = {
  isRootUnlocked: () => true,
  isShinyUnlocked: () => true,
  isAbilityUnlocked: () => true,
  isNatureUnlocked: () => true,
  isMoveLegal: () => true,
  isSpeciesInLine: () => true,
};

/**
 * The canonical team-hash: fnv1a64 over the canonical JSON of the manifest ARRAY (keys
 * sorted, numbers normalized). Both clients compute it over their OWN manifest and commit
 * it in `showdownReady`; the receiver recomputes it over the manifest the peer actually sent
 * and rejects a mismatch (the peer tampered its hash vs its team). Pure - exported for tests.
 *
 * The manifest is JSON-round-tripped BEFORE hashing so the fingerprint is computed over the
 * exact shape the real transport delivers: `JSON.stringify` drops `undefined`-valued keys,
 * so hashing the raw in-memory object would commit a different fingerprint than the receiver
 * can ever recompute (the erShinyLab ready-gate void class). Loopback passes references and
 * cannot catch this - the round-trip makes the hash transport-shape-canonical by construction.
 */
export function showdownTeamHash(manifest: ShowdownMonManifest[]): string {
  return fnv1a64(canonicalize(JSON.parse(JSON.stringify(manifest))));
}

/**
 * Owns ONE client's side of the showdown post-teambuild negotiation over a
 * {@linkcode CoopTransport}. One instance per client. Call {@linkcode negotiate} once,
 * after the local team is built + locally validated (against the LOCAL unlocks at
 * team-build time); it sends the team + ready commit, awaits the opponent's, gates both,
 * rendezvous-syncs at `showdown-ready`, and resolves/rejects. Engine-free over the
 * transport + rendezvous - no engine imports beyond the injected mega predicate.
 */
export class ShowdownSession {
  private readonly transport: CoopTransport;
  private readonly isMegaForm: IsMegaFormPredicate;
  private readonly rendezvous: CoopRendezvous;
  private readonly ownsRendezvous: boolean;
  private readonly offMessage: () => void;
  private readonly timeoutMs: number;
  private readonly schedule: (cb: () => void, ms: number) => () => void;
  /** Cancels the in-flight whole-handshake timeout (no-op until {@linkcode negotiate} arms it). */
  private cancelTimeout: () => void = () => {};

  /** The opponent's received team, or null until `showdownTeam` arrives. */
  private opponentManifest: ShowdownMonManifest[] | null = null;
  /** B7 item 11: the opponent's showdown protocol version (arrives on `showdownTeam`), or undefined. */
  private opponentProto: number | undefined;
  /** The opponent's declared field-width format (arrives on `showdownTeam`); absent == "singles". */
  private opponentBattleFormat: ShowdownBattleFormat = "singles";
  /** Our own field-width format for this match (from the tournament record); "singles" for a plain match. */
  private ownBattleFormat: ShowdownBattleFormat = "singles";
  /** Task C7: the opponent's sanitized presentation (arrives on `showdownTeam`), or null. */
  private opponentProfile: GhostTrainerProfile | null = null;
  /** The opponent's committed hash, or null until `showdownReady` arrives. */
  private opponentTeamHash: string | null = null;
  /** A received `showdownVoid` reason (rejects the negotiation), or null. */
  private receivedVoid: string | null = null;
  /** Guards the one-shot barrier arrival so a re-entrant gate can't arrive twice. */
  private crossingBarrier = false;
  /**
   * The first peer ready frame echoes our handshake once. This heals a peer whose Showdown listener
   * registered after the transport's generic early-frame drain without creating a resend loop.
   */
  private handshakeEchoed = false;
  /** Idempotency guard for {@linkcode dispose} (B7 item 8: disposed via both the pending slot and the flow). */
  private disposed = false;

  /** The in-flight negotiation promise plumbing (set by {@linkcode negotiate}). */
  private settle: {
    resolve: (r: ShowdownNegotiationResult) => void;
    reject: (e: ShowdownNegotiationError) => void;
    ownManifest: ShowdownMonManifest[];
  } | null = null;
  private done = false;
  /** B7 item 14b: our own SANITIZED presentation, kept so a rejoin can re-send the exact `showdownTeam`. */
  private ownProfile: GhostTrainerProfile | null = null;
  /** B7 item 14b: unregisters this session's rejoin re-sender (set in {@linkcode negotiate}). */
  private offRejoin: (() => void) | null = null;

  constructor(transport: CoopTransport, opts: ShowdownSessionOptions = {}) {
    this.transport = transport;
    this.isMegaForm = opts.isMegaForm ?? isMegaStage;
    this.ownsRendezvous = opts.rendezvous == null;
    this.rendezvous = opts.rendezvous ?? new CoopRendezvous(transport);
    // Human-deliberation class, NOT the 60s pacing class: the first confirmer waits here
    // through the ENTIRE remainder of the peer's teambuild (maintainer: >= 10 minutes).
    this.timeoutMs = opts.timeoutMs ?? getShowdownPickWaitMs();
    this.schedule = opts.schedule ?? defaultSchedule;
    this.offMessage = transport.onMessage(msg => this.handle(msg));
  }

  /**
   * Send this client's team + ready commit, then await the opponent's, GATE both, and
   * RENDEZVOUS at `showdown-ready`. `ownManifest` MUST already be validated against the
   * LOCAL collection by the caller (at team-build / tryStart). Resolves with both validated
   * teams once both are ready AND both have crossed the barrier; rejects with a
   * {@linkcode ShowdownNegotiationError} on an illegal opponent team, a hash mismatch, or a
   * received void.
   */
  negotiate(
    ownManifest: ShowdownMonManifest[],
    ownProfile: GhostTrainerProfile | null = null,
    battleFormat: ShowdownBattleFormat = "singles",
  ): Promise<ShowdownNegotiationResult> {
    if (this.settle != null) {
      return Promise.reject(new ShowdownNegotiationError("void", "negotiate() already in progress"));
    }
    this.ownBattleFormat = battleFormat;
    const promise = new Promise<ShowdownNegotiationResult>((resolve, reject) => {
      this.settle = { resolve, reject, ownManifest };
    });
    // Arm the whole-handshake anti-strand timeout FIRST (covers team-exchange AND the ready barrier):
    // if the peer never completes the exchange or never crosses the barrier, reject "timeout" so the
    // caller surfaces a message + escapes rather than stranding forever. Cancelled on any settle/dispose.
    this.cancelTimeout = this.schedule(() => {
      this.finishReject(
        new ShowdownNegotiationError("timeout", `showdown negotiation timed out after ${this.timeoutMs}ms`),
      );
    }, this.timeoutMs);
    // Defensive FORMAT self-check before shipping our team (the collection legality was
    // already checked against our OWN unlocks at team-build; this is the cheap structural
    // guard - team size / level / item / mega / IVs / duplicates). A structurally-broken
    // own team is voided immediately and never sent: it should never happen for an honest
    // client, and short-circuiting here makes the mutual-void deterministic (a client never
    // resolves on the opponent's legal team while shipping an illegal one of its own).
    const ownViolations = validateShowdownTeam(ownManifest, PERMISSIVE_UNLOCKS, this.isMegaForm, this.ownFieldWidth());
    if (ownViolations.length > 0) {
      this.voidAndReject("illegalTeam", `own team failed validation: ${ownViolations[0].message}`, ownViolations);
      return promise;
    }
    // Send our team + our authored presentation (C7; sanitized locally before shipping so we never
    // send garbage - the receiver re-sanitizes regardless) + our ready commit (the hash of our own
    // manifest; presentation is NOT part of the team hash - it's cosmetic and not anti-cheat surface).
    this.ownProfile = sanitizeGhostProfile(ownProfile);
    // B7 item 14b: register a rejoin re-sender BEFORE the first send, so a drop between here and the
    // gate is healed. It re-ships our team+ready (+ any rendezvous arrival) idempotently on reconnect.
    this.offRejoin = addShowdownRejoinResender(() => this.resendHandshake());
    this.transport.send(this.buildTeamMessage(ownManifest));
    this.transport.send({ t: "showdownReady", teamHash: showdownTeamHash(ownManifest) });
    // The opponent's messages may already be buffered (they raced ahead); try to settle now.
    this.tryGate();
    return promise;
  }

  /**
   * B7 item 14b: re-send this client's handshake state after a WebRTC rejoin. The transport instance
   * survived (replaceChannel), but the frames we sent while the channel was dark were LOST, so the
   * peer may be missing our team/ready/ready-arrival. Re-ship them idempotently: the peer's session
   * re-sets the same values (guarded gate), the team hash is deterministic, and the rendezvous ignores
   * a duplicate arrival - so replaying can only complete a stranded handshake, never corrupt a live one.
   */
  resendHandshake(): void {
    const settle = this.settle;
    if (settle == null || this.done) {
      return; // nothing in flight (never negotiated / already settled)
    }
    this.transport.send(this.buildTeamMessage(settle.ownManifest));
    this.transport.send({ t: "showdownReady", teamHash: showdownTeamHash(settle.ownManifest) });
    // If we already crossed into the ready barrier, re-send our arrival too (the peer may have missed
    // it in the dark window, otherwise both would strand waiting for each other).
    this.rendezvous.resendArrivals();
  }

  /** Stop listening to the transport and drop any pending negotiation. Idempotent (B7 item 8:
   *  the pending-session slot AND the flow both dispose, so a double call must be a safe no-op). */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.offRejoin?.(); // B7 item 14b: stop re-sending our handshake on a rejoin once we're done
    this.offRejoin = null;
    this.cancelTimeout();
    this.offMessage();
    if (this.ownsRendezvous) {
      this.rendezvous.dispose();
    }
    this.settle = null;
    this.done = true;
  }

  /** The on-field width our negotiated format is played at (singles 1, doubles 2, triples 3). */
  private ownFieldWidth(): number {
    return this.ownBattleFormat === "triples" ? 3 : this.ownBattleFormat === "doubles" ? 2 : 1;
  }

  /**
   * Build the `showdownTeam` message. OMIT-WHEN-ABSENT: `battleFormat` is only included for a
   * non-singles match, so a plain 1v1 is byte-identical to the pre-format wire (and old clients,
   * which never read the key, are unaffected). The receiver reads an absent key as "singles".
   */
  private buildTeamMessage(manifest: ShowdownMonManifest[]): CoopMessage {
    return {
      t: "showdownTeam",
      manifest,
      presentation: this.ownProfile,
      showdownProto: SHOWDOWN_PROTO_VERSION,
      ...(this.ownBattleFormat === "singles" ? {} : { battleFormat: this.ownBattleFormat }),
    };
  }

  private handle(msg: CoopMessage): void {
    switch (msg.t) {
      case "showdownTeam":
        // ShowdownMonManifestWire is structurally identical to ShowdownMonManifest; adopt it.
        this.opponentManifest = msg.manifest as ShowdownMonManifest[];
        // B7 item 11: the sender's showdown protocol version (undefined from a pre-guard build).
        this.opponentProto = msg.showdownProto;
        // Field-width format (absent == singles); cross-checked against ours in tryGate.
        this.opponentBattleFormat = msg.battleFormat ?? "singles";
        // Task C7: ALWAYS re-sanitize the received presentation before use (the ghost path's rule) -
        // a hostile peer must not bypass the length caps / control-char stripping / enum clamps.
        this.opponentProfile = sanitizeGhostProfile(msg.presentation);
        this.tryGate();
        break;
      case "showdownReady": {
        const firstReady = this.opponentTeamHash == null;
        this.opponentTeamHash = msg.teamHash;
        if (firstReady && !this.handshakeEchoed && this.settle != null) {
          this.handshakeEchoed = true;
          this.resendHandshake();
        }
        this.tryGate();
        break;
      }
      case "showdownVoid":
        this.receivedVoid = msg.reason;
        this.tryGate();
        break;
      default:
        // Not part of the negotiation handshake; ignore.
        break;
    }
  }

  /** Attempt to resolve/reject once we have everything needed (idempotent, one-shot). */
  private tryGate(): void {
    const settle = this.settle;
    if (settle == null || this.done) {
      return;
    }
    // A received void rejects immediately (the peer already rejected our/their team).
    if (this.receivedVoid != null) {
      this.finishReject(new ShowdownNegotiationError("void", `opponent voided the match: ${this.receivedVoid}`));
      return;
    }
    // B7 item 11: proto guard - the instant the opponent's team arrives, verify its showdown protocol
    // version. A stale cached client sends an old (or, pre-guard, absent) version; abort the versus flow
    // cleanly with a hard-refresh message + void the peer, rather than desyncing one-sided. Checked
    // before the ready barrier so a stale peer that stops after `showdownTeam` still fails fast.
    if (this.opponentManifest != null && this.opponentProto !== SHOWDOWN_PROTO_VERSION) {
      this.voidAndReject(
        "protoMismatch",
        `showdown protocol mismatch: ours=${SHOWDOWN_PROTO_VERSION} opponent=${this.opponentProto ?? "none"}`,
      );
      return;
    }
    // Field-width format guard: both clients derive the width from the same server-authoritative
    // tournament record, so a difference means one resolved a STALE record (or a spoofed/plain
    // lobby pairing collided with a tournament match). Refuse to pair rather than desync one client
    // into a singles field while the other builds doubles. Checked once the opponent's team arrives.
    if (this.opponentManifest != null && this.opponentBattleFormat !== this.ownBattleFormat) {
      this.voidAndReject(
        "formatMismatch",
        `showdown battle-format mismatch: ours=${this.ownBattleFormat} opponent=${this.opponentBattleFormat}`,
      );
      return;
    }
    // Need BOTH the opponent's team AND their ready commit before gating.
    if (this.opponentManifest == null || this.opponentTeamHash == null) {
      return;
    }
    const opponentManifest = this.opponentManifest;
    const opponentTeamHash = this.opponentTeamHash;

    // Gate 1: the opponent's manifest must pass the FORMAT rules (permissive collection), including
    // the negotiated field-width team-size rule (a doubles/triples match needs >= 2/3 mons).
    const violations = validateShowdownTeam(
      opponentManifest,
      PERMISSIVE_UNLOCKS,
      this.isMegaForm,
      this.ownFieldWidth(),
    );
    if (violations.length > 0) {
      this.voidAndReject("illegalTeam", `opponent team failed validation: ${violations[0].message}`, violations);
      return;
    }
    // Gate 2: the committed hash must match the manifest they actually sent (anti-tamper).
    const recomputed = showdownTeamHash(opponentManifest);
    if (recomputed !== opponentTeamHash) {
      this.voidAndReject(
        "hashMismatch",
        `opponent team hash mismatch: committed ${opponentTeamHash} but manifest hashes ${recomputed}`,
      );
      return;
    }
    // Both valid + both ready. Cross the reciprocal `showdown-ready` barrier before resolving:
    // neither client enters the battle bootstrap until BOTH have arrived. Bounded recovery
    // exhaustion is a closed failure, never permission to enter the battle independently.
    if (this.crossingBarrier) {
      return;
    }
    this.crossingBarrier = true;
    const opponentProfile = this.opponentProfile;
    void this.rendezvous.rendezvous(SHOWDOWN_READY_RENDEZVOUS_POINT, getShowdownPickWaitMs()).then(result => {
      if (result.timedOut) {
        this.finishReject(new ShowdownNegotiationError("timeout", "showdown-ready synchronization recovery exhausted"));
        return;
      }
      this.finishResolve({
        ownManifest: settle.ownManifest,
        opponentManifest,
        opponentTeamHash,
        opponentProfile,
        battleFormat: this.ownBattleFormat,
      });
    });
  }

  /** Send an `illegalTeam` void to the peer, then reject locally (a bad opponent team). */
  private voidAndReject(reason: ShowdownRejectReason, message: string, violations: ShowdownRuleViolation[] = []): void {
    // matchId is null until D-phase wires escrow (friendly match).
    this.transport.send({ t: "showdownVoid", matchId: null, reason: "illegalTeam" });
    this.finishReject(new ShowdownNegotiationError(reason, message, violations));
  }

  private finishResolve(result: ShowdownNegotiationResult): void {
    const settle = this.settle;
    if (settle == null || this.done) {
      return;
    }
    this.cancelTimeout();
    this.done = true;
    this.settle = null;
    settle.resolve(result);
  }

  private finishReject(error: ShowdownNegotiationError): void {
    const settle = this.settle;
    if (settle == null || this.done) {
      return;
    }
    this.cancelTimeout();
    this.done = true;
    this.settle = null;
    settle.reject(error);
  }
}
