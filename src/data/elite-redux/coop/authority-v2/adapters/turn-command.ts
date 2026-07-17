/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - Migration A: the TURN / COMMAND adapter.
//
// This is the v2 replacement for the legacy per-turn commit machinery:
//   - coop-turn-commit-phase.ts's capture point + the UNSETTLED_TURN_MUTATORS
//     phase-name blacklist,
//   - coop-battle-stream.ts's turn-commit retention + requestTurnCommit loop,
//   - command-phase.ts's coopNextCommandBarrier (guest-derived next command),
//   - coop-replay-phases.ts's guest awaitTurn.
//
// It imports NOTHING at runtime from any of those legacy modules - only the v2
// contract types + the foundation lane helpers. It is engine-free (every contract
// import is TYPE-only; the one value import, `controlIdOf`, is itself engine-free),
// so the whole adapter runs in the node-pure vitest lane with a fake scheduler /
// projector / material applier.
//
// THREE SEAMS (one per side of the frozen contract):
//
//  (1) AUTHORITY - buildTurnCommitEntry assembles a TURN_COMMIT commit-input from
//      an injected turn-capture image. The MATERIAL is the serialized turn
//      resolution + checkpoint image, fingerprinted by a deterministic digest; the
//      stated nextControl is the successor COMMAND for turn N+1 (frozen decision 4:
//      the authority STATES the successor - it is NEVER derived by the guest from
//      its local phase queue). A MUTATION-BARRIER seam (a token-count provider the
//      capture awaits to be zero) mechanically replaces the legacy phase-name
//      blacklist: the build is barred while any settle token is outstanding.
//
//  (2) REPLICA - turnMaterialApplier adapts an injected `applyTurnMaterial` into the
//      replica pipeline's ApplyMaterialFn, verifying the material digest before it
//      installs. The COMMAND-REQUEST LEASE requests the exact stated nextControl
//      address for the local seat: one lease per address, AbortSignal-aware,
//      scheduler-owned timers, bounded (never a free-running request loop),
//      cancelled when the final consumer disappears OR the entry retires/supersedes.
//
//  (3) SHADOW - computeShadowParity compares a legacy digest to the v2 entry's
//      digest, returning a comparable record for shadow-mode logging (v2 computes,
//      legacy still controls the live session).
// =============================================================================

import type {
  CoopAuthoritativeMaterial,
  CoopAuthorityEntry,
  CoopAuthorityEntryKind,
  CoopFrameContextV2,
  CoopNextControl,
  CoopRuntimeContext,
  CoopScheduler,
  CoopTimeClass,
  CoopTimerOwner,
} from "#data/elite-redux/coop/authority-v2/contract";
import { controlIdOf, type ProjectableControl } from "#data/elite-redux/coop/authority-v2/next-control";
import type { ApplyMaterialFn } from "#data/elite-redux/coop/authority-v2/replica";

// ===========================================================================
// (1) AUTHORITY SIDE - build the TURN_COMMIT commit-input.
// ===========================================================================

/**
 * The injected turn-capture image: the serialized authoritative resolution of one
 * turn plus the settled checkpoint image. Both are OPAQUE JSON-shaped wire values
 * (the log never inspects them); the concrete serialization is owned by the engine
 * capture lane. This adapter only fingerprints + carries them.
 */
export interface TurnResolutionImage {
  /** The serialized, ordered turn-resolution events the host committed for turn N. */
  readonly turnResolution: unknown;
  /** The authoritative post-settle checkpoint image (battle state) for turn N. */
  readonly checkpoint: unknown;
}

/**
 * The concrete material carried by a TURN_COMMIT entry. Narrows the contract's
 * opaque {@link CoopAuthoritativeMaterial} payload to a {@link TurnResolutionImage},
 * so a replica applier receives a typed image instead of `unknown`.
 */
export interface TurnCommitMaterial extends CoopAuthoritativeMaterial {
  readonly payload: TurnResolutionImage;
}

/**
 * The successor COMMAND the authority STATES for the turn AFTER the one just
 * resolved. `resolvedTurn` is turn N (the turn whose resolution this entry commits);
 * the stated control addresses turn N+1. The guest never derives this - the
 * authority states it and the replica projects it (frozen decision 4).
 */
export interface TurnCommandTarget {
  readonly epoch: number;
  readonly wave: number;
  /** The turn just resolved (N). The stated COMMAND control addresses turn N+1. */
  readonly resolvedTurn: number;
  /** The seat that owns the next command (seat authorizes, never host/guest role). */
  readonly ownerSeatId: number;
  /** The mon to command on the next turn. */
  readonly pokemonId: number;
}

/**
 * The mutation-barrier seam. Mechanically replaces the legacy UNSETTLED_TURN_MUTATORS
 * phase-name blacklist: instead of scanning the phase queue for named mutators, the
 * capture increments a token per outstanding settle and the barrier reports how many
 * remain. The commit is barred until this reaches ZERO - the exact "fully-settled
 * turn" boundary the legacy blacklist approximated by name.
 */
export interface MutationBarrier {
  /** Count of outstanding turn-mutation settle tokens; the capture awaits this to be zero. */
  pendingTokens(): number;
}

/** Inputs to {@link buildTurnCommitEntry}. */
export interface BuildTurnCommitInput {
  /** The authenticated frame context stamped on the entry (mandatory, decision 3). */
  readonly context: CoopFrameContextV2;
  /** The stable wire identity of this commit operation. */
  readonly operationId: string;
  /** The injected turn-capture image (serialized resolution + checkpoint). */
  readonly capture: TurnResolutionImage;
  /** The successor COMMAND the authority states for turn N+1. */
  readonly nextCommand: TurnCommandTarget;
  /** The mutation barrier gating the capture (must read zero to build). */
  readonly barrier: MutationBarrier;
  /** Revisions this commit explicitly subsumes (supersession by log order). */
  readonly subsumes?: readonly number[];
}

/** The result of attempting to build a TURN_COMMIT commit-input. */
export type BuildTurnCommitResult =
  | { readonly kind: "committed"; readonly entry: Omit<CoopAuthorityEntry, "revision"> }
  | { readonly kind: "barred"; readonly pendingTokens: number };

/** The entry kind this adapter commits. */
export const TURN_COMMIT_KIND: CoopAuthorityEntryKind = "TURN_COMMIT";

/**
 * Fingerprint a turn-capture image into its stable digest. Deterministic (canonical
 * key ordering + FNV-1a 64), so an identical image on any client yields an identical
 * digest and a duplicate redelivery is provably the same material. Exposed so the
 * replica applier + the shadow seam agree on the exact scheme.
 */
export function computeTurnCommitDigest(capture: TurnResolutionImage): string {
  return fnv1a64(canonicalize({ turnResolution: capture.turnResolution, checkpoint: capture.checkpoint }));
}

/** Assemble the concrete {@link TurnCommitMaterial} (digest + image payload) for a capture. */
export function buildTurnCommitMaterial(capture: TurnResolutionImage): TurnCommitMaterial {
  return {
    digest: computeTurnCommitDigest(capture),
    payload: { turnResolution: capture.turnResolution, checkpoint: capture.checkpoint },
  };
}

/**
 * Build the TURN_COMMIT commit-input for one fully-settled turn.
 *
 * BARRED while the mutation barrier reports any outstanding token: the capture is
 * not yet settled, so committing would publish a stale checkpoint (the exact legacy
 * hazard the phase-name blacklist guarded against, here mechanical). When the
 * barrier reads zero, the entry is assembled with:
 *   - material = the fingerprinted turn-capture image,
 *   - nextControl = the stated successor COMMAND for turn N+1 (never guest-derived).
 *
 * Returns the commit-INPUT (revision omitted): the caller feeds it to the authority
 * log's `commit`, which assigns the one global revision + owns retention/redelivery.
 */
export function buildTurnCommitEntry(input: BuildTurnCommitInput): BuildTurnCommitResult {
  const pendingTokens = input.barrier.pendingTokens();
  if (pendingTokens !== 0) {
    return { kind: "barred", pendingTokens };
  }

  const nextControl: CoopNextControl = {
    kind: "COMMAND",
    epoch: input.nextCommand.epoch,
    wave: input.nextCommand.wave,
    // The authority states the NEXT turn (N+1) - the successor, not the resolved turn.
    turn: input.nextCommand.resolvedTurn + 1,
    ownerSeatId: input.nextCommand.ownerSeatId,
    pokemonId: input.nextCommand.pokemonId,
  };

  const entry: Omit<CoopAuthorityEntry, "revision"> = {
    context: input.context,
    operationId: input.operationId,
    kind: TURN_COMMIT_KIND,
    material: buildTurnCommitMaterial(input.capture),
    nextControl,
    subsumes: input.subsumes ?? [],
  };
  return { kind: "committed", entry };
}

// ===========================================================================
// (2) REPLICA SIDE - material applier seam + command-request lease.
// ===========================================================================

/**
 * The injected turn-material applier: install the typed turn image into the replica's
 * engine state, returning whether it applied. Owned by the engine/material lane; this
 * adapter only adapts it into the replica pipeline (verifying the digest first).
 */
export type ApplyTurnMaterialFn = (ctx: CoopRuntimeContext, material: TurnCommitMaterial) => boolean;

/**
 * Adapt an {@link ApplyTurnMaterialFn} into the replica pipeline's {@link ApplyMaterialFn}.
 * Before installing, it (a) narrows the entry's opaque material to a typed
 * {@link TurnCommitMaterial} and (b) recomputes the digest over the payload and
 * confirms it matches the committed digest - a `false` (digest mismatch or malformed
 * payload) stops the pipeline BEFORE it signs materialApplied for state that would
 * not actually be the authoritative image.
 */
export function turnMaterialApplier(applyTurnMaterial: ApplyTurnMaterialFn): ApplyMaterialFn {
  return (ctx: CoopRuntimeContext, entry: CoopAuthorityEntry): boolean => {
    const material = entry.material;
    if (!isTurnResolutionImage(material.payload)) {
      return false;
    }
    const typed: TurnCommitMaterial = { digest: material.digest, payload: material.payload };
    // Digest confirmation: a redelivery can never smuggle a divergent payload under an
    // already-committed digest, and a corrupted image is refused before it installs.
    if (computeTurnCommitDigest(typed.payload) !== typed.digest) {
      return false;
    }
    return applyTurnMaterial(ctx, typed);
  };
}

/**
 * The controlId the replica would request/project for an entry's stated command
 * control, or `null` when the entry states no successor. The lease is keyed by this
 * exact address so at most one lease exists per stated nextControl.
 */
export function turnCommandControlId(entry: CoopAuthorityEntry): string | null {
  return entry.nextControl == null ? null : controlIdOf(entry.nextControl as ProjectableControl);
}

/** A consumer's handle on a command-request lease. Releasing is idempotent. */
export interface CommandRequestHandle {
  /** Drop this consumer. When the last consumer releases, the lease cancels (zero timers). */
  release(): void;
}

/** Configuration for a {@link CommandRequestLeaseBook}. */
export interface CommandRequestLeaseBookOptions {
  /** Runtime scheduler - EVERY lease timer rides it (never raw setTimeout). */
  readonly scheduler: CoopScheduler;
  /** Cancellation signal (typically ctx.cancellation): its abort disposes every lease. */
  readonly signal: AbortSignal;
  /** Fired on each bounded request tick for a stated control address. */
  readonly request: (controlId: string) => void;
  /** Active-time between request ticks (default 500ms). */
  readonly intervalMs?: number;
  /** Time class the request ticks consume (default "connected"). */
  readonly timeClass?: CoopTimeClass;
  /** Bounded cap on request ticks before a lease goes inert (default 8; never free-running). */
  readonly maxAttempts?: number;
  /** Owner-id prefix for this book's timer owners (default "authority-v2/turn-command"). */
  readonly ownerPrefix?: string;
}

const DEFAULT_LEASE_INTERVAL_MS = 500;
const DEFAULT_LEASE_MAX_ATTEMPTS = 8;
const DEFAULT_LEASE_TIME_CLASS: CoopTimeClass = "connected";
const DEFAULT_LEASE_OWNER_PREFIX = "authority-v2/turn-command";

const NOOP_HANDLE: CommandRequestHandle = { release: () => {} };

/** The shared, immutable request-loop parameters every lease in a book draws on. */
interface LeaseRuntime {
  readonly scheduler: CoopScheduler;
  readonly request: (controlId: string) => void;
  readonly intervalMs: number;
  readonly timeClass: CoopTimeClass;
  readonly maxAttempts: number;
}

/**
 * ONE bounded, scheduler-owned request lease for one exact control address. It is
 * NOT a free-running loop: every tick rides the injected scheduler under an owner
 * address, the loop is capped at `maxAttempts`, and it stops the moment the last
 * consumer releases, the entry retires/supersedes, or the cancellation signal fires -
 * on every path it cancels its timer AND `cancelOwner`s, leaving zero armed timers.
 */
class CommandRequestLease {
  private consumers = 0;
  private attempts = 0;
  private cancelTimer: (() => void) | null = null;
  private stopped = false;
  private readonly controlId: string;
  private readonly owner: CoopTimerOwner;
  private readonly runtime: LeaseRuntime;
  private readonly onEmpty: () => void;

  constructor(controlId: string, owner: CoopTimerOwner, runtime: LeaseRuntime, onEmpty: () => void) {
    this.controlId = controlId;
    this.owner = owner;
    this.runtime = runtime;
    this.onEmpty = onEmpty;
  }

  /** Register one consumer; arms the request loop on the first. */
  addConsumer(): void {
    if (this.stopped) {
      return;
    }
    this.consumers += 1;
    if (this.consumers === 1) {
      this.armNext();
    }
  }

  /** Drop one consumer; when the last leaves, cancel + notify the book to remove this lease. */
  releaseConsumer(): void {
    if (this.stopped || this.consumers === 0) {
      return;
    }
    this.consumers -= 1;
    if (this.consumers === 0) {
      this.cancel("last-consumer-released");
      this.onEmpty();
    }
  }

  /** Stop the lease unconditionally (retire / supersede / dispose): cancel timer + cancelOwner. */
  cancel(_reason: string): void {
    if (this.stopped) {
      // Still guarantee no armed timer survives (idempotent teardown).
      this.runtime.scheduler.cancelOwner(this.owner.ownerId);
      return;
    }
    this.stopped = true;
    if (this.cancelTimer != null) {
      this.cancelTimer();
      this.cancelTimer = null;
    }
    this.runtime.scheduler.cancelOwner(this.owner.ownerId);
  }

  /** Whether a request timer is currently armed (test-facing). */
  get armed(): boolean {
    return this.cancelTimer != null;
  }

  private armNext(): void {
    if (this.stopped || this.consumers === 0) {
      return;
    }
    if (this.attempts >= this.runtime.maxAttempts) {
      // Bounded: the loop goes inert rather than requesting forever.
      this.stopped = true;
      return;
    }
    this.cancelTimer = this.runtime.scheduler.schedule(
      this.owner,
      this.runtime.intervalMs,
      this.runtime.timeClass,
      () => this.onTick(),
    );
  }

  private onTick(): void {
    this.cancelTimer = null;
    if (this.stopped || this.consumers === 0) {
      return;
    }
    this.attempts += 1;
    this.runtime.request(this.controlId);
    this.armNext();
  }
}

/**
 * The book of command-request leases: at most one lease per exact control address,
 * with reference-counted consumers. A lease is created on the first consumer of an
 * address and cancelled (its timers gone) when the last consumer releases, the entry
 * retires/supersedes (`retire`), or the cancellation signal aborts (`disposeAll`).
 *
 * No module-global mutable state: all tracking is per-instance, and every timer rides
 * the injected scheduler under an owner address so teardown is total + provable.
 */
export class CommandRequestLeaseBook {
  private readonly leases = new Map<string, CommandRequestLease>();
  private readonly signal: AbortSignal;
  private readonly runtime: LeaseRuntime;
  private readonly ownerPrefix: string;
  private readonly onAbort = (): void => this.disposeAll("aborted");
  private disposed = false;

  constructor(options: CommandRequestLeaseBookOptions) {
    this.signal = options.signal;
    this.runtime = {
      scheduler: options.scheduler,
      request: options.request,
      intervalMs: options.intervalMs ?? DEFAULT_LEASE_INTERVAL_MS,
      timeClass: options.timeClass ?? DEFAULT_LEASE_TIME_CLASS,
      maxAttempts: options.maxAttempts ?? DEFAULT_LEASE_MAX_ATTEMPTS,
    };
    this.ownerPrefix = options.ownerPrefix ?? DEFAULT_LEASE_OWNER_PREFIX;
    if (this.signal.aborted) {
      this.disposed = true;
    } else {
      this.signal.addEventListener("abort", this.onAbort, { once: true });
    }
  }

  /**
   * Acquire a consumer on the lease for `controlId`, creating the lease on the first
   * consumer of that address. Returns an idempotent release handle; a disposed book
   * returns a no-op handle (nothing is ever tracked after teardown).
   */
  acquire(controlId: string): CommandRequestHandle {
    if (this.disposed) {
      return NOOP_HANDLE;
    }
    let lease = this.leases.get(controlId);
    if (lease == null) {
      lease = new CommandRequestLease(controlId, this.ownerFor(controlId), this.runtime, () =>
        this.leases.delete(controlId),
      );
      this.leases.set(controlId, lease);
    }
    lease.addConsumer();
    let released = false;
    return {
      release: () => {
        if (released) {
          return;
        }
        released = true;
        lease.releaseConsumer();
      },
    };
  }

  /**
   * Acquire a consumer on the lease for an entry's stated command control, or `null`
   * when the entry states no successor. Convenience over {@link acquire} that derives
   * the exact control address from the entry.
   */
  acquireForEntry(entry: CoopAuthorityEntry): CommandRequestHandle | null {
    const controlId = turnCommandControlId(entry);
    return controlId == null ? null : this.acquire(controlId);
  }

  /**
   * Retire (force-cancel) the lease for `controlId` regardless of remaining consumers:
   * the entry retired or a later revision superseded it, so the request is over. Leaves
   * zero armed timers for that address.
   */
  retire(controlId: string): void {
    const lease = this.leases.get(controlId);
    if (lease == null) {
      return;
    }
    lease.cancel("retired");
    this.leases.delete(controlId);
  }

  /** Retire the lease for an entry's stated command control (retirement / supersession). */
  retireEntry(entry: CoopAuthorityEntry): void {
    const controlId = turnCommandControlId(entry);
    if (controlId != null) {
      this.retire(controlId);
    }
  }

  /** Cancel + drop every lease (teardown): zero armed timers, zero leases. Idempotent. */
  disposeAll(reason: string): void {
    for (const lease of this.leases.values()) {
      lease.cancel(reason);
    }
    this.leases.clear();
    if (!this.disposed) {
      this.disposed = true;
      this.signal.removeEventListener("abort", this.onAbort);
    }
  }

  /** Number of live leases (addresses with at least one consumer). */
  get leaseCount(): number {
    return this.leases.size;
  }

  /** Whether the lease for `controlId` currently has an armed request timer (test-facing). */
  isArmed(controlId: string): boolean {
    return this.leases.get(controlId)?.armed ?? false;
  }

  private ownerFor(controlId: string): CoopTimerOwner {
    return {
      ownerId: `${this.ownerPrefix}:request:${controlId}`,
      address: `${this.ownerPrefix}/request/${controlId}`,
      reason: `request stated command control ${controlId} until installed or retired`,
    };
  }
}

/**
 * Build a {@link CommandRequestLeaseBook} bound to a runtime context: the book pulls
 * its scheduler + cancellation signal from `ctx`, so the context's teardown disposes
 * every lease by construction.
 */
export function createCommandRequestLeaseBook(
  ctx: CoopRuntimeContext,
  options: Omit<CommandRequestLeaseBookOptions, "scheduler" | "signal">,
): CommandRequestLeaseBook {
  return new CommandRequestLeaseBook({ ...options, scheduler: ctx.scheduler, signal: ctx.cancellation });
}

// ===========================================================================
// (3) SHADOW SEAM - compare a legacy digest to the v2 entry's digest.
// ===========================================================================

/** A comparable shadow-mode record: v2's committed digest vs the legacy digest. */
export interface ShadowParityRecord {
  readonly revision: number;
  readonly operationId: string;
  readonly kind: CoopAuthorityEntryKind;
  /** The digest the legacy path computed for the same turn. */
  readonly legacyDigest: string;
  /** The digest v2 committed on the entry. */
  readonly v2Digest: string;
  /** Whether v2's digest matches the legacy digest (a faithful shadow computation). */
  readonly digestsMatch: boolean;
}

/**
 * Compute the shadow-parity record for a committed entry against the legacy digest.
 * Pure comparison for shadow-mode LOGGING only - v2 computes the entry + digest while
 * legacy still controls the live session. A `digestsMatch: false` is the signal that
 * v2's authoritative computation diverged from legacy's for that turn.
 */
export function computeShadowParity(legacyDigest: string, entry: CoopAuthorityEntry): ShadowParityRecord {
  const v2Digest = entry.material.digest;
  return {
    revision: entry.revision,
    operationId: entry.operationId,
    kind: entry.kind,
    legacyDigest,
    v2Digest,
    digestsMatch: legacyDigest === v2Digest,
  };
}

// ===========================================================================
// Internals - deterministic digest (self-contained; engine-free).
// ===========================================================================

function isTurnResolutionImage(value: unknown): value is TurnResolutionImage {
  return value != null && typeof value === "object" && "turnResolution" in value && "checkpoint" in value;
}

/**
 * Deterministic stringifier: object keys ALWAYS emitted in sorted order (never
 * insertion order), arrays in their given order, numbers normalized so `1`, `1.0`,
 * and `-0` hash equal, and `undefined` neutralized. Identical on every client, so
 * two engines fingerprinting the same image produce the same digest.
 */
function canonicalize(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "number") {
    return canonNumber(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
  }
  return "null";
}

/** Normalize a number so `1`, `1.0`, `-0`, and non-finite values hash stably. */
function canonNumber(n: number): string {
  if (!Number.isFinite(n) || n === 0) {
    return "0";
  }
  if (Number.isInteger(n)) {
    return n.toString();
  }
  return n.toPrecision(12);
}

// FNV-1a 64-bit (BigInt): overflow-safe, deterministic, runs once per commit over a
// small canonical string. Same scheme as the co-op checksum core so a shadow digest is
// comparable in spirit; kept self-contained here to avoid importing engine-adjacent code.
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

/** FNV-1a 64-bit over the UTF-16 code units of `s`, returned as a 16-char hex string. */
function fnv1a64(s: string): string {
  let h = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * FNV_PRIME) & MASK64;
  }
  return h.toString(16).padStart(16, "0");
}
