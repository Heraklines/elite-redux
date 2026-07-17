/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op MACHINE-WAIT probe + ASYMMETRIC stall escalator (#P33 asym-watchdog).
//
// WHY: the #806 stall watchdog only recovers a MUTUAL network-wait deadlock - BOTH
// peers parked in a network wait, each reporting >= trigger via a fresh `stallBeat`.
// It is structurally blind to an ASYMMETRIC stall: one peer parked in a PHASE HOLD
// (e.g. CoopApplyResyncPhase holding on a non-converged snapshot - the live wave-4
// softlock) or a one-sided rendezvous barrier reports `localMs=0` and never beats, so
// the mutual condition can never fire and the run parks forever.
//
// This module adds two engine-free pieces (transport-free, clock-injectable, unit-testable):
//   1. A REGISTRY where long-lived MACHINE waits register begin/end with a label. A
//      phase hold or a barrier await registers here; `oldestCoopMachineWaitMs()` folds
//      all of them into mutual-stall detection, while `oldestCoopAsymmetricMachineWaitMs()`
//      excludes reciprocal barriers that can legitimately lead a still-rendering peer.
//      `coopMachineWaitLabels()` is the diagnostics snapshot.
//   2. An ASYMMETRIC ESCALATOR: a pure state machine the watchdog ticks each interval.
//      When the local side is stalled >= trigger AND the peer is provably NOT in the
//      mutual-stall state, it authorizes the existing recovery a bounded number of times
//      (with cooldown) and then escalates to `terminate` so both clients route into the
//      shared terminal supervisor instead of parking forever.
//
// 🔴 CRITICAL DESIGN RULE - ONLY register MACHINE waits (waiting on the PEER / NETWORK /
// authority QUEUE). NEVER register a HUMAN-INPUT wait: an open menu, a reward-shop
// browse, or a faint-replacement pick awaiting the LOCAL player is legitimate play, NOT
// a stall. Registering one would manufacture a false positive and could terminate a
// healthy session while a human is thinking. If a wait blocks on a person, it does not
// belong here. (The watchdog keeps its own faint-switch-window / reward-shop exemptions;
// this registry stays clean by only ever being called from machine-wait sites.)
// =============================================================================

interface CoopMachineWait {
  label: string;
  since: number;
  /** False for reciprocal barriers that may legitimately wait while the peer renders/reads local UI. */
  asymmetricEligible: boolean;
}

export interface CoopMachineWaitOptions {
  /**
   * Whether a one-sided wait proves a deadlock. Reciprocal rendezvous barriers must pass false: the peer
   * can still be progressing through narration/animation before reaching the same point. Defaults true
   * for phase holds whose peer is already beyond the held continuation.
   */
  asymmetricEligible?: boolean;
}

let nextWaitId = 0;
const machineWaits = new Map<number, CoopMachineWait>();

/** Injectable clock so tests can drive age/escalation deterministically. */
let clock: () => number = () => Date.now();

/** Test-only: override the wall clock. Restore with `setCoopStallProbeClock(null)`. */
export function setCoopStallProbeClock(now: (() => number) | null): void {
  clock = now ?? (() => Date.now());
}

/**
 * Register that a long-lived MACHINE wait (waiting on the peer / network / authority queue)
 * has begun, tagged with `label`. Returns an idempotent end callback; call it exactly when
 * the wait resolves, is superseded, or is disposed. NEVER call this for a human-input wait.
 */
export function beginCoopMachineWait(label: string, options: CoopMachineWaitOptions = {}): () => void {
  const id = nextWaitId++;
  machineWaits.set(id, {
    label,
    since: clock(),
    asymmetricEligible: options.asymmetricEligible ?? true,
  });
  let ended = false;
  return () => {
    if (ended) {
      return;
    }
    ended = true;
    machineWaits.delete(id);
  };
}

/**
 * Age (ms) of the OLDEST registered machine wait, or -1 when none. Mirrors
 * `CoopInteractionRelay.oldestNetworkWaitMs` so the watchdog can `Math.max` them together.
 */
export function oldestCoopMachineWaitMs(): number {
  let oldest = -1;
  const now = clock();
  for (const wait of machineWaits.values()) {
    const age = now - wait.since;
    if (age > oldest) {
      oldest = age;
    }
  }
  return oldest;
}

/**
 * Age of the oldest wait that is itself proof of an asymmetric deadlock. Reciprocal barriers are excluded:
 * one client may reach `cmd/shop/...` while the other is still legitimately rendering the path to it.
 */
export function oldestCoopAsymmetricMachineWaitMs(): number {
  let oldest = -1;
  const now = clock();
  for (const wait of machineWaits.values()) {
    if (!wait.asymmetricEligible) {
      continue;
    }
    const age = now - wait.since;
    if (age > oldest) {
      oldest = age;
    }
  }
  return oldest;
}

/** Diagnostics snapshot: registered machine-wait labels, oldest-first, for the health line. */
export function coopMachineWaitLabels(): string[] {
  const now = clock();
  return [...machineWaits.values()]
    .sort((a, b) => a.since - b.since)
    .map(wait => `${wait.label}@${now - wait.since}ms`);
}

/** Test-only: drop every registered machine wait (registry hygiene between cases). */
export function clearCoopMachineWaits(): void {
  machineWaits.clear();
}

// -----------------------------------------------------------------------------
// Asymmetric stall escalator
// -----------------------------------------------------------------------------

/** One watchdog-tick observation fed to the escalator. */
export interface CoopStallSignals {
  /** Oldest local machine/network wait (ms). < trigger means the local side is not stalled. */
  localMs: number;
  /** Peer's last-reported `stallBeat.waitingMs`, or null when no beat has been received. */
  peerBeatMs: number | null;
  /** Age (ms) of the peer's last beat, or null when no beat has been received. */
  peerBeatAgeMs: number | null;
  /** Whether the transport currently reports a live connection. */
  transportConnected: boolean;
  /** Current clock reading (ms). */
  now: number;
}

/**
 * - `none`: no local stall, or the peer is mutually stalled (handled by the existing mutual path).
 * - `recover`: asymmetric stall - attempt the existing (stateSync) recovery once, respecting cooldown.
 * - `terminate`: asymmetric stall persisted past the recovery bound - route into the shared terminal.
 */
export type CoopStallAction = "none" | "recover" | "terminate";

/** Underlying classification of a single observation (exported for focused tests). */
export type CoopStallKind = "none" | "mutual" | "asymmetric";

export interface CoopAsymmetricEscalatorOptions {
  /** Local wait (ms) at/above which the local side counts as stalled. */
  triggerMs?: number;
  /** How long a peer beat stays "fresh" evidence of the peer's live state. */
  peerFreshWindowMs?: number;
  /** No fresh peer beat for at least this long (while connected) proves the peer is not mutually stalled. */
  peerSilenceWindowMs?: number;
  /** Minimum spacing between recovery attempts. */
  recoveryCooldownMs?: number;
  /** How many bounded recovery attempts before escalating to the shared terminal. */
  maxRecoveryAttempts?: number;
}

const DEFAULT_TRIGGER_MS = 20_000;
const DEFAULT_PEER_FRESH_WINDOW_MS = 12_500;
const DEFAULT_PEER_SILENCE_WINDOW_MS = 20_000;
const DEFAULT_RECOVERY_COOLDOWN_MS = 30_000;
const DEFAULT_MAX_RECOVERY_ATTEMPTS = 3;

/**
 * Classify one observation. MUTUAL (both stalled) is deliberately reported as-is so the caller
 * routes it through the pre-existing mutual-recovery path; only a genuine ASYMMETRIC stall - the
 * local side stalled while the peer is provably progressing or silent-but-connected - is owned here.
 */
export function classifyCoopStall(
  signals: CoopStallSignals,
  options: CoopAsymmetricEscalatorOptions = {},
): CoopStallKind {
  const triggerMs = options.triggerMs ?? DEFAULT_TRIGGER_MS;
  const peerFreshWindowMs = options.peerFreshWindowMs ?? DEFAULT_PEER_FRESH_WINDOW_MS;
  const peerSilenceWindowMs = options.peerSilenceWindowMs ?? DEFAULT_PEER_SILENCE_WINDOW_MS;
  if (signals.localMs < triggerMs) {
    return "none";
  }
  const peerFresh = signals.peerBeatAgeMs != null && signals.peerBeatAgeMs < peerFreshWindowMs;
  if (peerFresh && (signals.peerBeatMs ?? 0) >= triggerMs) {
    return "mutual";
  }
  // The peer is provably NOT mutually stalled when EITHER: it beat recently but with a low waitingMs
  // (it is progressing or in a short wait), OR it has not beaten for a bounded window while the
  // transport still reports connected (it advanced past us, or is parked in a non-reporting phase hold).
  const peerAdvancing = peerFresh && (signals.peerBeatMs ?? 0) < triggerMs;
  const peerSilentButConnected =
    signals.transportConnected && (signals.peerBeatAgeMs == null || signals.peerBeatAgeMs >= peerSilenceWindowMs);
  return peerAdvancing || peerSilentButConnected ? "asymmetric" : "none";
}

/**
 * Stateful bounded escalator. The watchdog creates one per session and ticks {@linkcode assess} each
 * interval. It authorizes at most {@linkcode CoopAsymmetricEscalatorOptions.maxRecoveryAttempts}
 * recoveries (spaced by the cooldown) for a persisting asymmetric stall, then emits `terminate` ONCE.
 * Any tick that is not an asymmetric stall resets the attempt state, so a resolved stall re-arms fully.
 */
export function createCoopAsymmetricEscalator(options: CoopAsymmetricEscalatorOptions = {}) {
  const cooldownMs = options.recoveryCooldownMs ?? DEFAULT_RECOVERY_COOLDOWN_MS;
  const maxAttempts = options.maxRecoveryAttempts ?? DEFAULT_MAX_RECOVERY_ATTEMPTS;
  let attempts = 0;
  let lastActionAt = Number.NEGATIVE_INFINITY;
  let terminated = false;
  return {
    assess(signals: CoopStallSignals): CoopStallAction {
      if (classifyCoopStall(signals, options) !== "asymmetric") {
        attempts = 0;
        lastActionAt = Number.NEGATIVE_INFINITY;
        terminated = false;
        return "none";
      }
      if (terminated) {
        return "none";
      }
      if (signals.now - lastActionAt < cooldownMs) {
        return "none";
      }
      if (attempts >= maxAttempts) {
        terminated = true;
        return "terminate";
      }
      attempts++;
      lastActionAt = signals.now;
      return "recover";
    },
    /** Test/diagnostics: recovery attempts spent against the current asymmetric stall. */
    attemptCount(): number {
      return attempts;
    },
  };
}

export type CoopAsymmetricEscalator = ReturnType<typeof createCoopAsymmetricEscalator>;
