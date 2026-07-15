/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// DETERMINISTIC FAULTING TRANSPORT (#633, Layer-A robustness). Wraps the in-process
// LoopbackTransport pair (createLoopbackPair / CoopTransport in coop-transport.ts) and, under a
// SEEDED mulberry32 PRNG (NEVER Math.random - blocked by convention + non-reproducible), injects the
// three fault classes a REAL WebRTC DATACHANNEL exhibits when it is configured unordered / unreliable:
//
//   - DROP    a message is never delivered (probability `drop`).
//   - REORDER a message is held and delivered AFTER the next one (a swap; probability `reorder`).
//   - DELAY   a message is held and delivered after N *later* send calls (probability `delay`).
//
// The wrapper sits on the SAME {@linkcode CoopTransport} interface, so the existing two-engine rig
// (buildDuo in coop-duo-harness.ts) can use it TRANSPARENTLY: `buildDuo(game, wrapCoopFaultPair(
// createLoopbackPair(), profile), ...)`. Every decision is derived from the seed, so a failing run is
// REPLAYABLE bit-for-bit from the same seed + profile.
//
// WHY THIS IS SAFE TO ASSERT CONVERGENCE ON. The co-op netcode marks a specific message class as
// PRESENTATION-ONLY (see the protocol comments in coop-transport.ts): `battleEvent` ("a dropped /
// reordered / late battleEvent only stutters the animation; it can never desync the guest - the
// checkpoint reconciles all state"), `uiInput` ("a dropped/late/out-of-order uiInput can never change
// the run, only stutter the cursor"), `meMessage` ("a dropped/late meMessage can only blank a narration
// line, never desync"), and `meCursor` (cosmetic). Those are the CUES this wrapper faults BY DEFAULT.
// The AUTHORITATIVE backbone (turnResolution + its checkpoint/checksum, stateSync, waveResolved,
// enemyPartySync/launchSnapshot, the reward interactionOutcome) is the source of truth that HEALS a
// dropped cue: the per-turn checkpoint re-asserts the full field state, so the guest converges regardless
// of which cues were lost. The default faultable set is therefore exactly the class the design proves can
// be lost without desync - and the test coop-duo-fault.test.ts proves that property end-to-end.
//
// The faultable predicate is CONFIGURABLE (`faultable`), so a future test/soak that also drives the
// production self-healing re-request loops (requestStateSync / requestEnemyParty / requestRunConfig) can
// widen the fault surface to the authoritative backbone. It is intentionally NARROW by default because
// the manual phase-pump drivers in the duo harness stand in for those live re-request loops, so faulting
// the backbone under the manual pump would STARVE a driver (a hang), not exercise a heal.
// =============================================================================

import type { CoopConnectionState, CoopMessage, CoopRole, CoopTransport } from "#data/elite-redux/coop/coop-transport";

/** The wire `t` values of a co-op message (the discriminant of the CoopMessage union). */
export type CoopMessageType = CoopMessage["t"];

/** One injected fault class. */
export type CoopFaultKind = "drop" | "reorder" | "delay";

/**
 * The PRESENTATION-ONLY cue message classes faulted BY DEFAULT (the ones the netcode design proves can be
 * lost / reordered / delayed WITHOUT a desync - see the file header). Keepalives (ping/pong/stallBeat) are
 * deliberately EXCLUDED from the default so a dropped keepalive can never nudge a watchdog/rejoin path in
 * the manually-pumped harness; add them via a custom `faultable` predicate if a test wants them.
 */
export const COOP_DEFAULT_CUE_TYPES: ReadonlySet<CoopMessageType> = new Set<CoopMessageType>([
  "battleEvent",
  "uiInput",
  "meMessage",
  "meCursor",
]);

/**
 * The AUTHORITATIVE (source-of-truth) message classes the netcode design proves it CANNOT lose without a
 * desync (the exact opposite of {@linkcode COOP_DEFAULT_CUE_TYPES}). Faulting these is OPT-IN (never in the
 * default faultable set): a lost authoritative message is expected to either force a bounded recovery (an
 * anti-hang backstop / a re-request self-heal) OR surface as a LOUD, classified stall - NEVER a silent
 * divergence. Used to build a `faultable` predicate ({@linkcode faultableTypes}) or as the target of a
 * deterministic single-shot drop ({@linkcode CoopFaultPair.armNextDrop}). The three HIGHEST-RISK boundaries
 * the bounded authoritative-fault matrix drops around (reward pick / wave resolution / checkpoint):
 *   - `turnResolution`   the per-turn checkpoint carrier (the guest's CoopReplayTurnPhase source of truth).
 *   - `battleCheckpoint` an out-of-turn authoritative checkpoint (switch / capture / resume).
 *   - `interactionChoice`/`rewardOptions`/`interactionOutcome` the reward/biome/ME alternation commit + pool.
 *   - `waveResolved`/`waveEndState` the authoritative wave-advance + post-exp progression snapshot.
 *   - `command`/`commandRequest` the partner-command relay (a slot's action for the turn).
 *   - `stateSync`/`enemyPartySync`/`launchSnapshot`/`rendezvous` the resync + launch backbone.
 */
export const COOP_AUTHORITATIVE_TYPES: ReadonlySet<CoopMessageType> = new Set<CoopMessageType>([
  "turnResolution",
  "battleCheckpoint",
  "interactionChoice",
  "interactionOutcome",
  "interaction",
  "rewardOptions",
  "waveResolved",
  "waveEndState",
  "command",
  "commandRequest",
  "stateSync",
  "enemyPartySync",
  "launchSnapshot",
  "meBattleEnemyPartySync",
  "rendezvous",
  "sharedTerminal",
  "sharedTerminalAck",
]);

/**
 * Build a `faultable` predicate that accepts EXACTLY the given message classes (opt-in per class). Pass a
 * subset of {@linkcode COOP_AUTHORITATIVE_TYPES} to point the probabilistic drop/reorder/delay stream at the
 * authoritative backbone instead of the default presentation cues. The returned predicate is pure (a Set
 * membership read), so it is safe to reuse across sends.
 */
export function faultableTypes(types: Iterable<CoopMessageType>): (msg: CoopMessage) => boolean {
  const set = new Set<CoopMessageType>(types);
  return (msg: CoopMessage) => set.has(msg.t);
}

/**
 * A fault PROFILE: the per-message probabilities + tuning. `drop` + `reorder` + `delay` are independent
 * probabilities in [0, 1]; their SUM must be <= 1 (the remainder is the pass-through probability). Applied
 * only to a message the `faultable` predicate accepts (default {@linkcode COOP_DEFAULT_CUE_TYPES}).
 */
export interface CoopFaultProfile {
  /** Probability a faultable message is DROPPED (never delivered). */
  drop: number;
  /** Probability a faultable message is REORDERED (held, delivered after the next send). */
  reorder: number;
  /** Probability a faultable message is DELAYED (held, delivered after up to `maxDelay` later sends). */
  delay: number;
  /** Max later-send count a DELAYED message is held for (>= 2; the actual hold is seeded in [2, maxDelay]). Default 4. */
  maxDelay?: number;
  /** Which messages are eligible for faulting. Default: {@linkcode COOP_DEFAULT_CUE_TYPES}. */
  faultable?: (msg: CoopMessage) => boolean;
}

/** A NO-FAULT profile (pass everything through) - the CONTROL for a faults-on-vs-off comparison. */
export const COOP_NO_FAULT_PROFILE: CoopFaultProfile = { drop: 0, reorder: 0, delay: 0 };

/** Per-endpoint fault tallies (so a test can assert faults were actually injected + none stranded). */
export interface CoopFaultCounters {
  /** Faultable messages the PRNG rolled for. */
  considered: number;
  /** Faultable messages passed through unchanged. */
  passed: number;
  /** Messages dropped. */
  dropped: number;
  /** Messages reordered (held one send). */
  reordered: number;
  /** Messages delayed (held multiple sends). */
  delayed: number;
  /** Held messages eventually released (reorder/delay completed). */
  released: number;
  /** Held messages still pending at close() (never released - counted as effective drops). */
  heldAtClose: number;
  /** Non-faultable messages passed straight through. */
  passthrough: number;
  /** Deterministic single-shot drops fired (armed via {@linkcode CoopFaultPair.armNextDrop}) - the authoritative-fault leg. */
  oneShotDropped: number;
}

function freshCounters(): CoopFaultCounters {
  return {
    considered: 0,
    passed: 0,
    dropped: 0,
    reordered: 0,
    delayed: 0,
    released: 0,
    heldAtClose: 0,
    passthrough: 0,
    oneShotDropped: 0,
  };
}

/**
 * A tiny deterministic PRNG (mulberry32): seed -> a function yielding floats in [0, 1). Inlined here (rather
 * than imported from coop-soak-driver.ts, a separately-owned module) so this wrapper is self-contained.
 * NEVER Math.random - it is non-reproducible and blocked by convention; a seeded stream makes every fault
 * decision REPLAYABLE.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One held (reordered/delayed) message + how many more send calls until it is released. */
interface HeldMessage {
  msg: CoopMessage;
  remaining: number;
}

/** A profile with every field RESOLVED to a concrete value (defaults filled), so the hot path reads no optionals. */
interface ResolvedFaultProfile {
  drop: number;
  reorder: number;
  delay: number;
  maxDelay: number;
  faultable: (msg: CoopMessage) => boolean;
}

/** Resolve a caller {@linkcode CoopFaultProfile} into a {@linkcode ResolvedFaultProfile} (defaults applied). */
function resolveProfile(p: CoopFaultProfile): ResolvedFaultProfile {
  return {
    drop: p.drop,
    reorder: p.reorder,
    delay: p.delay,
    maxDelay: Math.max(2, Math.floor(p.maxDelay ?? 4)),
    faultable: p.faultable ?? (msg => COOP_DEFAULT_CUE_TYPES.has(msg.t)),
  };
}

/** A live-mutable single-field holder so {@linkcode CoopFaultPair.setProfile} can swap the whole profile atomically. */
interface ProfileHolder {
  profile: ResolvedFaultProfile;
}

/**
 * A CoopTransport that wraps a single loopback endpoint and injects seeded drop/reorder/delay faults on the
 * SEND side (which is exactly where a datachannel's unordered/unreliable delivery manifests: the same
 * `send` framing, only the ORDER + presence of what reaches the peer changes). Delegates `role`, `state`,
 * `onMessage`, `onStateChange` verbatim so the framing the peer observes is byte-identical - only WHETHER
 * and WHEN a message is delivered differs.
 */
class CoopFaultTransport implements CoopTransport {
  private readonly held: HeldMessage[] = [];
  /**
   * DETERMINISTIC single-shot drops (the authoritative-fault leg). A multiset of message classes each of
   * which drops the NEXT matching send exactly once, then auto-disarms (the count is the number of pending
   * one-shot drops for that class). Independent of the probabilistic `faultable` path, so it can target the
   * authoritative backbone (which is NOT in the default faultable set) without widening the fuzz surface.
   */
  private readonly pendingDrops = new Map<CoopMessageType, number>();

  constructor(
    private readonly inner: CoopTransport,
    private readonly rng: () => number,
    private readonly holder: ProfileHolder,
    public readonly counters: CoopFaultCounters,
  ) {}

  get role(): CoopRole {
    return this.inner.role;
  }

  get state(): CoopConnectionState {
    return this.inner.state;
  }

  onMessage(handler: (msg: CoopMessage) => void): () => void {
    return this.inner.onMessage(handler);
  }

  onStateChange(handler: (state: CoopConnectionState) => void): () => void {
    return this.inner.onStateChange(handler);
  }

  private isFaultable(msg: CoopMessage): boolean {
    return this.holder.profile.faultable(msg);
  }

  /**
   * Arm a DETERMINISTIC single-shot drop of the next message of `type` sent on THIS endpoint. Stacks (arming
   * twice drops the next two). Used by the authoritative-fault test leg to drop exactly one high-risk
   * authoritative message (a checkpoint / reward pick / wave-resolution) around a boundary and assert
   * convergence-or-loud-timeout - never a silent divergence.
   */
  armDrop(type: CoopMessageType): void {
    this.pendingDrops.set(type, (this.pendingDrops.get(type) ?? 0) + 1);
  }

  /** Consume a pending one-shot drop for `type` if one is armed. Returns true when the message must be dropped. */
  private takeOneShotDrop(type: CoopMessageType): boolean {
    const n = this.pendingDrops.get(type) ?? 0;
    if (n <= 0) {
      return false;
    }
    if (n === 1) {
      this.pendingDrops.delete(type);
    } else {
      this.pendingDrops.set(type, n - 1);
    }
    return true;
  }

  /**
   * Decrement every message held from a PRIOR send call and release (deliver) the ones whose countdown hits
   * zero, in FIFO order. Called at the END of each send() so a message added THIS call is not ticked by its
   * own call - a `remaining: 1` (reorder) message is thus released on the NEXT send, i.e. AFTER the message
   * that followed it (a genuine swap); a `remaining: N` (delay) message is released after N later sends.
   */
  private tickHeld(): void {
    if (this.held.length === 0) {
      return;
    }
    // Splice in place: decrement, deliver + remove those that reached zero.
    for (let i = this.held.length - 1; i >= 0; i--) {
      const h = this.held[i];
      h.remaining -= 1;
      if (h.remaining <= 0) {
        this.held.splice(i, 1);
        this.counters.released += 1;
        this.inner.send(h.msg);
      }
    }
  }

  send(msg: CoopMessage): void {
    // Not connected: hand straight to the inner transport (it logs + no-ops), no fault bookkeeping.
    if (this.inner.state !== "connected") {
      this.inner.send(msg);
      return;
    }
    // DETERMINISTIC single-shot drop (authoritative-fault leg) - checked FIRST, so it can target an
    // authoritative class that is NOT in the probabilistic `faultable` set. A dropped message still lets time
    // pass for prior holds (a real drop does not freeze the channel), matching the probabilistic drop path.
    if (this.takeOneShotDrop(msg.t)) {
      this.counters.oneShotDropped += 1;
      this.tickHeld();
      return;
    }
    if (!this.isFaultable(msg)) {
      this.counters.passthrough += 1;
      this.inner.send(msg);
      this.tickHeld();
      return;
    }
    this.counters.considered += 1;
    const r = this.rng();
    const { drop, reorder, delay, maxDelay } = this.holder.profile;
    if (r < drop) {
      this.counters.dropped += 1;
      // A dropped message still lets time pass for prior holds (a real drop does not freeze the channel).
      this.tickHeld();
      return;
    }
    if (r < drop + reorder) {
      this.counters.reordered += 1;
      this.tickHeld();
      // Snapshot when the wire accepts the frame, not when the artificial hold releases it. Otherwise
      // later engine mutation aliases into the held payload, unlike a real serialized DataChannel frame.
      this.held.push({ msg: structuredClone(msg), remaining: 1 });
      return;
    }
    if (r < drop + reorder + delay) {
      this.counters.delayed += 1;
      // Seeded hold length in [2, maxDelay] (a delay is at least 2 later sends; 1 is the reorder case).
      const span = maxDelay - 2 + 1;
      const remaining = 2 + Math.floor(this.rng() * span);
      this.tickHeld();
      this.held.push({ msg: structuredClone(msg), remaining });
      return;
    }
    // Pass through unchanged.
    this.counters.passed += 1;
    this.inner.send(msg);
    this.tickHeld();
  }

  close(): void {
    // Any still-held message never got its release send - count it as an effective drop (a real channel
    // teardown loses in-flight frames). We do NOT flush them: delivering a stale cue into a peer whose
    // session is tearing down would be a late-delivery side effect with no drain to consume it.
    this.counters.heldAtClose += this.held.length;
    this.held.length = 0;
    this.inner.close();
  }
}

/** A wrapped, fault-injecting loopback pair + the live per-endpoint counters, on the CoopTransport interface. */
export interface CoopFaultPair {
  host: CoopTransport;
  guest: CoopTransport;
  counters: { host: CoopFaultCounters; guest: CoopFaultCounters };
  /** Preserve a wrapped scheduled transport's destination pump so buildDuo can bind it to ClientCtx. */
  flush?: (role: CoopRole, limit?: number) => number;
  /** Preserve scheduled-queue diagnostics when the inner pair exposes them. */
  pending?: (role: CoopRole) => number;
  /** Preserve the boot-to-manual delivery switch when composing scheduling with fault injection. */
  setAutomaticDelivery?: (automatic: boolean) => void;
  /** Total faults injected across BOTH directions (drop + reorder + delay + one-shot drops). Asserted > 0 so a run is not vacuous. */
  faultsInjected(): number;
  /** Swap the live fault profile on BOTH endpoints mid-run (for a burst-then-recover test). */
  setProfile(profile: CoopFaultProfile): void;
  /**
   * Arm a DETERMINISTIC single-shot drop of the next message of `type` on the given direction(s) (default
   * `"both"` - drops the next of `type` on whichever endpoint sends it first, which for a per-boundary
   * authoritative class is the sole sender). The authoritative-fault leg's primitive: drop exactly one
   * high-risk message around a boundary, then assert convergence-or-loud-timeout.
   */
  armNextDrop(type: CoopMessageType, direction?: "host" | "guest" | "both"): void;
}

/** Options for {@linkcode wrapCoopFaultPair}. */
export interface CoopFaultPairOptions {
  /** Master seed for the deterministic PRNG streams (host + guest get independent, derived streams). */
  seed: number;
  /** Override the profile for the HOST->guest direction only (defaults to the shared `profile`). */
  host?: CoopFaultProfile;
  /** Override the profile for the GUEST->host direction only (defaults to the shared `profile`). */
  guest?: CoopFaultProfile;
}

/**
 * Wrap an existing loopback pair (from {@linkcode createLoopbackPair}) with a seeded fault-injecting layer on
 * BOTH endpoints. Each direction gets its OWN mulberry32 stream (derived from `seed`) + its own live-mutable
 * profile object, so faults are deterministic and independent per direction. The returned pair is a drop-in
 * for `buildDuo`'s `pair` argument (same {@linkcode CoopTransport} interface). `setProfile` mutates both live
 * profiles in place, so a mid-run change (burst -> recover) takes effect on the next send.
 */
export function wrapCoopFaultPair(
  pair: { host: CoopTransport; guest: CoopTransport },
  profile: CoopFaultProfile,
  opts: CoopFaultPairOptions,
): CoopFaultPair {
  const scheduled = pair as {
    flush?: (role: CoopRole, limit?: number) => number;
    pending?: (role: CoopRole) => number;
    setAutomaticDelivery?: (automatic: boolean) => void;
  };
  // Per-direction live-mutable holders (a full-object swap in setProfile is seen by both transports, which
  // hold the SAME holder reference - no in-place field mutation, no `delete`).
  const hostHolder: ProfileHolder = { profile: resolveProfile(opts.host ?? profile) };
  const guestHolder: ProfileHolder = { profile: resolveProfile(opts.guest ?? profile) };
  const hostCounters = freshCounters();
  const guestCounters = freshCounters();
  // Independent, seed-derived streams per direction (the guest stream is offset so the two never correlate).
  const hostRng = mulberry32(opts.seed >>> 0);
  const guestRng = mulberry32((opts.seed ^ 0x9e3779b9) >>> 0);
  const host = new CoopFaultTransport(pair.host, hostRng, hostHolder, hostCounters);
  const guest = new CoopFaultTransport(pair.guest, guestRng, guestHolder, guestCounters);
  return {
    host,
    guest,
    counters: { host: hostCounters, guest: guestCounters },
    ...(typeof scheduled.flush === "function" ? { flush: scheduled.flush.bind(pair) } : {}),
    ...(typeof scheduled.pending === "function" ? { pending: scheduled.pending.bind(pair) } : {}),
    ...(typeof scheduled.setAutomaticDelivery === "function"
      ? { setAutomaticDelivery: scheduled.setAutomaticDelivery.bind(pair) }
      : {}),
    faultsInjected(): number {
      const f = (c: CoopFaultCounters) => c.dropped + c.reordered + c.delayed + c.oneShotDropped;
      return f(hostCounters) + f(guestCounters);
    },
    setProfile(next: CoopFaultProfile): void {
      // Atomic whole-profile swap on both holders (the transports read holder.profile fresh each send).
      const resolved = resolveProfile(next);
      hostHolder.profile = resolved;
      guestHolder.profile = resolved;
    },
    armNextDrop(type: CoopMessageType, direction: "host" | "guest" | "both" = "both"): void {
      if (direction === "host" || direction === "both") {
        host.armDrop(type);
      }
      if (direction === "guest" || direction === "both") {
        guest.armDrop(type);
      }
    },
  };
}
