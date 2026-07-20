/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - LANE 6: the independent deterministic protocol simulator.
//
// This harness is the VERIFICATION lane. It derives EVERYTHING from the frozen
// contract (src/data/elite-redux/coop/authority-v2/contract.ts) and NOTHING from
// any implementation lane's code. Every concrete needed by the contract's
// interfaces (CoopAuthorityLog, CoopControlProjector, CoopRecoveryTransaction,
// CoopScheduler) is an OWN in-simulator reference implementation, written only to
// the contract's stated semantics so the acceptance oracle is satisfied HONESTLY.
//
// It is engine-free (node-pure): the only import is TYPE-ONLY from the contract,
// so nothing here pulls Phaser / the DOM / globalScene. The simulator never
// dereferences the BattleScene / CoopTransport handles the CoopRuntimeContext
// shape demands - they exist only to satisfy that shape (see `unusedScene`).
//
// Design pillars (each maps to a task requirement):
//  - ONE virtual monotonic clock (VirtualClock). No Date.now / no setTimeout.
//    Every deadline flows through EndpointScheduler (the contract's CoopScheduler),
//    which distinguishes ACTIVE time classes: a suspended endpoint's mechanical
//    deadlines (connected/recovery/renderer/humanInput) DO NOT advance, while the
//    absolute safety ceiling always does. This single-clock rule is deliberate:
//    the legacy harness once produced a false green via a mixed real/virtual clock.
//  - Asynchronous message delivery even in loopback (MessageBus): messages are
//    queued and delivered on clock steps, never synchronously.
//  - A fault plane over EVERY frame type: drop, duplicate, delay, reorder,
//    disconnect+reconnect, endpoint suspension, and snapshot-recovery triggering.
//  - A seeded PRNG (mulberry32) for reproducible schedules; the seed rides every
//    failure message.
//
// The reference protocol model (honest to the six frozen decisions):
//  1. ONE global revision order: the authority commits CoopAuthorityEntry values
//     with monotonically increasing revisions across turn/replacement/interaction/
//     wave/terminal kinds.
//  2. ONE retained frontier: RefAuthorityLog retains committed entries and
//     redelivers them until retirement; the replica admits in order, detects
//     duplicates/gaps, and reports receipts.
//  3. ONE frame context: every entry/receipt carries CoopFrameContextV2.
//  4. ONE next-control representation: the authority STATES nextControl on the
//     entry; the replica PROJECTS it (RefControlProjector) - never derives it.
//  5. ONE recovery transaction: RefRecoveryTransaction fences BEFORE requesting,
//     then applies material + log frontier + control atomically before releasing.
//  6. ONE set of ACK-stage meanings: an entry retires at admitted + materialApplied
//     + (controlInstalled where nextControl != null); presentationSettled is never
//     a mechanical-liveness requirement.
//
// Material model (so "duplicate never double-mutates" is OBSERVABLE, not asserted
// into existence): every entry carries a MaterialPayload. Incremental entries
// (turn/replacement/interaction) apply as `acc += delta`; checkpoint entries
// (wave/terminal) apply as `acc = cumulative` (absolute) and subsume the
// intermediate revisions. A correct single in-order application yields
// acc === cumulative, so the digest fnv(revision:acc) matches the entry digest.
// A duplicate that wrongly re-applied a delta would drift acc off the digest -
// which is exactly the class the replica's duplicate guard prevents and the oracle
// checks. A digest mismatch self-heals via a snapshot recovery transaction.
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import type {
  CoopAckStage,
  CoopAdmitResult,
  CoopAuthorityEntry,
  CoopAuthorityLog,
  CoopAuthorityReceipt,
  CoopControlInstallResult,
  CoopControlProjector,
  CoopFrameContextV2,
  CoopNextControl,
  CoopRecoveryPhase,
  CoopRecoveryTransaction,
  CoopRuntimeContext,
  CoopScheduler,
  CoopTimeClass,
  CoopTimerOwner,
} from "#data/elite-redux/coop/authority-v2/contract";
import type { CoopTransport } from "#data/elite-redux/coop/coop-transport";

// ---------------------------------------------------------------------------
// Tiny engine-free primitives (kept local so this module stays zero-runtime-import).
// ---------------------------------------------------------------------------

/** mulberry32 - a small, fast, fully deterministic seeded PRNG. */
export interface SeededRng {
  readonly seed: number;
  /** float in [0, 1). */
  next(): number;
  /** integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** true with probability p. */
  chance(p: number): boolean;
}

export function makeRng(seed: number): SeededRng {
  let a = seed >>> 0;
  const next = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    seed,
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: p => next() < p,
  };
}

/** 32-bit FNV-1a hash as 8 hex chars. Deterministic + engine-free. */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// The ONE virtual clock + the contract's CoopScheduler (active time classes).
// ---------------------------------------------------------------------------

const TIME_CLASSES: readonly CoopTimeClass[] = ["connected", "recovery", "renderer", "humanInput", "absolute"];

/** Mechanical time classes pause under suspension; "absolute" is the safety ceiling. */
function isMechanicalClass(cls: CoopTimeClass): boolean {
  return cls !== "absolute";
}

/** The single monotonic virtual clock. Advanced ONLY by the harness stepper. */
export class VirtualClock {
  private t = 0;
  get now(): number {
    return this.t;
  }
  advance(deltaSteps: number): void {
    if (deltaSteps < 0) {
      throw new Error("VirtualClock cannot go backwards");
    }
    this.t += deltaSteps;
  }
}

interface ScheduledTimer {
  readonly id: number;
  readonly ownerId: string;
  readonly cls: CoopTimeClass;
  readonly deadlineActiveMs: number;
  readonly callback: () => void;
  cancelled: boolean;
}

/**
 * The runtime-owned clock/timer surface (contract CoopScheduler). Every endpoint
 * gets its OWN scheduler, but all schedulers read the ONE shared VirtualClock.
 * Each scheduler accumulates active-time PER CLASS: while the endpoint is
 * suspended, mechanical classes stop accruing (their deadlines are preserved),
 * while "absolute" keeps accruing. This is the crux the single-clock rule protects.
 */
export class EndpointScheduler implements CoopScheduler {
  private readonly active: Record<CoopTimeClass, number> = {
    connected: 0,
    recovery: 0,
    renderer: 0,
    humanInput: 0,
    absolute: 0,
  };
  private timers: ScheduledTimer[] = [];
  private lastNow: number;
  private suspended = false;
  private nextId = 1;

  constructor(
    private readonly clock: VirtualClock,
    readonly endpointId: string,
  ) {
    this.lastNow = clock.now;
  }

  /** Pull the shared clock forward into this endpoint's per-class accumulators, then fire due timers. */
  sync(): void {
    const delta = this.clock.now - this.lastNow;
    this.lastNow = this.clock.now;
    if (delta > 0) {
      for (const cls of TIME_CLASSES) {
        if (this.suspended && isMechanicalClass(cls)) {
          continue;
        }
        this.active[cls] += delta;
      }
    }
    this.fireDue();
  }

  private fireDue(): void {
    // Fire in deterministic order (deadline, id). Re-scan after each fire because a
    // callback may schedule or cancel timers.
    for (;;) {
      let chosen: ScheduledTimer | undefined;
      for (const t of this.timers) {
        if (t.cancelled || this.active[t.cls] < t.deadlineActiveMs) {
          continue;
        }
        if (
          chosen === undefined
          || t.deadlineActiveMs < chosen.deadlineActiveMs
          || (t.deadlineActiveMs === chosen.deadlineActiveMs && t.id < chosen.id)
        ) {
          chosen = t;
        }
      }
      if (chosen === undefined) {
        return;
      }
      chosen.cancelled = true;
      this.timers = this.timers.filter(t => t !== chosen);
      chosen.callback();
    }
  }

  setSuspended(suspended: boolean): void {
    // Sync first so the accrued time up to this instant is credited under the old mode.
    this.sync();
    this.suspended = suspended;
  }

  get isSuspended(): boolean {
    return this.suspended;
  }

  now(timeClass: CoopTimeClass): number {
    return this.active[timeClass];
  }

  schedule(owner: CoopTimerOwner, delayMs: number, timeClass: CoopTimeClass, callback: () => void): () => void {
    const timer: ScheduledTimer = {
      id: this.nextId++,
      ownerId: owner.ownerId,
      cls: timeClass,
      deadlineActiveMs: this.active[timeClass] + Math.max(0, delayMs),
      callback,
      cancelled: false,
    };
    this.timers.push(timer);
    return () => {
      timer.cancelled = true;
      this.timers = this.timers.filter(t => t !== timer);
    };
  }

  cancelOwner(ownerId: string): void {
    for (const t of this.timers) {
      if (t.ownerId === ownerId) {
        t.cancelled = true;
      }
    }
    this.timers = this.timers.filter(t => t.ownerId !== ownerId);
  }

  /** Teardown probe: count of live (uncancelled) timers. */
  activeTimerCount(): number {
    return this.timers.filter(t => !t.cancelled).length;
  }
}

// ---------------------------------------------------------------------------
// Unused engine handles (contract shape only - NEVER dereferenced by the simulator).
// The double-cast is a localized, documented test-mock idiom for a genuinely
// unused required dependency; it is NOT a suppression of a real type error.
// ---------------------------------------------------------------------------

function unusedScene(): BattleScene {
  return {} as unknown as BattleScene;
}

function unusedTransport(): CoopTransport {
  return {} as unknown as CoopTransport;
}

// ---------------------------------------------------------------------------
// Material model
// ---------------------------------------------------------------------------

interface MaterialPayload {
  /** Incremental contribution (turn/replacement/interaction entries). */
  readonly delta: number;
  /** The accumulator value AFTER this entry (authority-computed at commit). */
  readonly cumulative: number;
  /** Checkpoint entries (wave/terminal) apply `cumulative` absolutely + subsume. */
  readonly checkpoint: boolean;
}

function readPayload(entry: CoopAuthorityEntry): MaterialPayload {
  return entry.material.payload as MaterialPayload;
}

function digestFor(revision: number, accumulator: number): string {
  return fnv1a(`${revision}:${accumulator}`);
}

// ---------------------------------------------------------------------------
// Next-control identity
// ---------------------------------------------------------------------------

/** Mechanical control identity (owner/address exact). Two controls are compatible iff equal. */
export function controlKey(control: CoopNextControl | null): string {
  if (control === null) {
    return "null";
  }
  switch (control.kind) {
    case "COMMAND_FRONTIER":
      return (
        `COMMAND_FRONTIER:${control.epoch}:${control.wave}:${control.turn}:`
        + control.commands
          .map(command => `${command.fieldIndex}:${command.ownerSeatId}:${command.pokemonId}`)
          .sort()
          .join(",")
      );
    case "REPLACEMENT":
      return (
        `REPLACEMENT:${control.operationId}:${control.ownerSeatId}:`
        + `e${control.epoch}:w${control.wave}:t${control.turn}:o${control.occurrence}:f${control.fieldIndex}`
      );
    case "REWARD":
      return `REWARD:${control.operationId}:${control.ownerSeatId}`;
    case "BIOME":
      return `BIOME:${control.operationId}:${control.ownerSeatId}`;
    case "MYSTERY":
      return `MYSTERY:${control.operationId}:${control.ownerSeatId}`;
    case "SHARED_INTERACTION":
      return `SHARED_INTERACTION:${control.surfaceClass}:${control.operationKind}:${control.operationId}:${control.ownerSeatId}`;
    case "AWAIT_SUCCESSOR":
      return (
        `AWAIT_SUCCESSOR:${control.afterOperationId}:e${control.epoch}:w${control.wave}:t${control.turn}:`
        + `${control.allowedKinds.join(",")}:next=${control.expectedOperationId ?? "*"}`
      );
    case "TERMINAL":
      return `TERMINAL:${control.terminalId}`;
  }
}

// ---------------------------------------------------------------------------
// The ONE retained authoritative log (contract CoopAuthorityLog). A single class
// implements both roles honestly: an AUTHORITY instance commits + retains + retires;
// a REPLICA instance admits in order + tracks the frontier. The unused side's state
// simply stays empty.
// ---------------------------------------------------------------------------

function coversRange(subsumes: readonly number[], from: number, to: number): boolean {
  if (from > to) {
    return true;
  }
  const set = new Set(subsumes);
  for (let r = from; r <= to; r++) {
    if (!set.has(r)) {
      return false;
    }
  }
  return true;
}

export class RefAuthorityLog implements CoopAuthorityLog {
  // AUTHORITY-side state:
  private readonly committed: CoopAuthorityEntry[] = [];
  private readonly retired = new Set<number>();
  private readonly stages = new Map<number, Set<CoopAckStage>>();
  private horizon = 0;

  // REPLICA-side state:
  private frontier = 0;

  private disposed = false;

  constructor(
    readonly role: "authority" | "replica",
    private readonly epoch: number,
  ) {}

  // --- AUTHORITY ---

  commit(entry: Omit<CoopAuthorityEntry, "revision">): CoopAuthorityEntry {
    const revision = this.committed.length + 1;
    const full: CoopAuthorityEntry = { ...entry, revision };
    this.committed.push(full);
    this.stages.set(revision, new Set());
    return full;
  }

  acceptReceipt(receipt: CoopAuthorityReceipt): boolean {
    const set = this.stages.get(receipt.revision);
    if (set === undefined || this.retired.has(receipt.revision)) {
      return false;
    }
    set.add(receipt.stage);
    if (this.requirementMet(receipt.revision)) {
      this.retire(receipt.revision);
      return true;
    }
    return false;
  }

  private requirementMet(revision: number): boolean {
    const entry = this.committed[revision - 1];
    const set = this.stages.get(revision);
    if (entry === undefined || set === undefined) {
      return false;
    }
    if (!set.has("admitted") || !set.has("materialApplied")) {
      return false;
    }
    if (entry.nextControl !== null && !set.has("controlInstalled")) {
      return false;
    }
    return true;
  }

  private retire(revision: number): void {
    this.retired.add(revision);
    // Supersession by log order: retiring an entry retires the revisions it subsumes.
    const entry = this.committed[revision - 1];
    if (entry !== undefined) {
      for (const s of entry.subsumes) {
        this.retired.add(s);
      }
    }
  }

  retained(): readonly CoopAuthorityEntry[] {
    return this.committed.filter(e => !this.retired.has(e.revision) && e.revision > this.horizon);
  }

  // --- REPLICA ---

  admit(entry: CoopAuthorityEntry): CoopAdmitResult {
    if (this.disposed) {
      return { kind: "rejected", reason: "disposed" };
    }
    if (entry.context.sessionEpoch !== this.epoch) {
      return { kind: "staleEpoch" };
    }
    if (entry.revision <= this.frontier) {
      return { kind: "duplicate-complete" };
    }
    if (entry.revision === this.frontier + 1) {
      this.frontier = entry.revision;
      return { kind: "admitted" };
    }
    // Out of order. A checkpoint entry that explicitly subsumes the whole gap may be
    // admitted directly (supersession by log order); otherwise it is a genuine gap.
    if (readPayload(entry).checkpoint && coversRange(entry.subsumes, this.frontier + 1, entry.revision - 1)) {
      this.frontier = entry.revision;
      return { kind: "admitted" };
    }
    return { kind: "gap", missingFrom: this.frontier + 1 };
  }

  recordReplicaStage(_entry: CoopAuthorityEntry, _stage: "materialApplied" | "controlInstalled"): boolean {
    return true;
  }

  receivedThrough(): number {
    return this.frontier;
  }

  appliedThrough(): number {
    return this.frontier;
  }

  controlInstalledThrough(): number {
    return this.frontier;
  }

  // --- BOTH ---

  adoptFrontier(revision: number): void {
    if (revision > this.frontier) {
      this.frontier = revision;
    }
  }

  dispose(_reason: string): void {
    this.disposed = true;
    this.committed.length = 0;
    this.retired.clear();
    this.stages.clear();
    this.frontier = 0;
    this.horizon = 0;
  }

  // --- Authority-only inspection / control (not part of the contract surface) ---

  latestRevision(): number {
    return this.committed.length;
  }

  entryAt(revision: number): CoopAuthorityEntry | undefined {
    return this.committed[revision - 1];
  }

  cumulativeAt(revision: number): number {
    const e = this.committed[revision - 1];
    return e === undefined ? 0 : readPayload(e).cumulative;
  }

  latestControl(): CoopNextControl | null {
    const e = this.committed.at(-1);
    return e === undefined ? null : e.nextControl;
  }

  isTerminalCommitted(): boolean {
    return this.committed.some(e => e.kind === "TERMINAL_COMMIT");
  }

  terminalId(): string | null {
    for (const e of this.committed) {
      if (e.nextControl !== null && e.nextControl.kind === "TERMINAL") {
        return e.nextControl.terminalId;
      }
    }
    return null;
  }

  setHorizon(horizon: number): void {
    this.horizon = horizon;
  }

  get pruneHorizon(): number {
    return this.horizon;
  }
}

// ---------------------------------------------------------------------------
// Reference control projector (contract CoopControlProjector). It NEVER decides
// which control is appropriate (the entry already did); it installs the stated
// control into the endpoint's local simulated engine. A `deferred` result models
// engine pacing (a renderer stall) and is re-projected by the caller - never a
// session terminal by itself.
// ---------------------------------------------------------------------------

class RefControlProjector implements CoopControlProjector {
  constructor(private readonly endpoint: Endpoint) {}

  project(_ctx: CoopRuntimeContext, control: NonNullable<CoopNextControl>): CoopControlInstallResult {
    const id = controlKey(control);
    if (this.endpoint.installedControlId === id) {
      return { kind: "already-installed", controlId: id };
    }
    // Renderer pacing: if the endpoint's renderer active-time has not reached the
    // stall watermark, defer (the caller re-projects on a renderer deadline).
    if (this.endpoint.scheduler.now("renderer") < this.endpoint.rendererStallActiveMs) {
      return { kind: "deferred", reason: "renderer-stall" };
    }
    this.endpoint.installedControl = control;
    this.endpoint.installedControlId = id;
    return { kind: "installed", controlId: id };
  }
}

// ---------------------------------------------------------------------------
// Message bus - asynchronous delivery even in loopback, with the fault plane.
// ---------------------------------------------------------------------------

type Wire =
  | { readonly t: "deliver"; readonly entry: CoopAuthorityEntry }
  | { readonly t: "receipt"; readonly receipt: CoopAuthorityReceipt }
  | {
      readonly t: "recover-req";
      readonly reason: "gap" | "snapshot";
      readonly fromRevision: number;
      readonly requestId: string;
    }
  | { readonly t: "recover-reply"; readonly requestId: string; readonly reply: RecoveryReply };

type RecoveryReply =
  | {
      readonly kind: "snapshot";
      readonly frontier: number;
      readonly cumulative: number;
      readonly control: CoopNextControl | null;
    }
  | {
      readonly kind: "terminalize";
      readonly frontier: number;
      readonly cumulative: number;
      readonly control: CoopNextControl | null;
      readonly terminalId: string;
    };

type EndpointRole = "authority" | "replica";

interface InFlight {
  readonly at: number;
  readonly seq: number;
  readonly to: EndpointRole;
  readonly sentAt: number;
  readonly wire: Wire;
}

export interface FaultConfig {
  readonly dropProb: number;
  readonly dupProb: number;
  readonly latencyMin: number;
  readonly latencyMax: number;
  /** Global step intervals [from, to) during which the link carries nothing (disconnect). */
  readonly downWindows: ReadonlyArray<readonly [number, number]>;
  /** Global step intervals during which the replica's scheduler is suspended. */
  readonly suspendReplica: ReadonlyArray<readonly [number, number]>;
  /** Global step intervals during which the authority's scheduler is suspended. */
  readonly suspendAuthority: ReadonlyArray<readonly [number, number]>;
}

function inAnyWindow(step: number, windows: ReadonlyArray<readonly [number, number]>): boolean {
  return windows.some(([from, to]) => step >= from && step < to);
}

class MessageBus {
  private queue: InFlight[] = [];
  private seq = 0;
  /** Diagnostics: how many times a specific revision's deliver was scripted-dropped. */
  private readonly scriptedDrops = new Map<number, number>();

  constructor(
    private readonly clock: VirtualClock,
    private readonly rng: SeededRng,
    private readonly fault: FaultConfig,
    private readonly reorderDelayByRevision: Record<number, number>,
  ) {}

  /** Arm a one-shot scripted drop for the FIRST deliver of a given revision (directed scenarios). */
  scriptDropFirstDeliverOf(revisions: readonly number[]): void {
    for (const r of revisions) {
      this.scriptedDrops.set(r, (this.scriptedDrops.get(r) ?? 0) + 1);
    }
  }

  send(to: EndpointRole, wire: Wire): void {
    const sentAt = this.clock.now;
    // Link down at send time => lost in transit.
    if (inAnyWindow(sentAt, this.fault.downWindows)) {
      return;
    }
    // Scripted one-shot drop of a specific revision's delivery.
    if (wire.t === "deliver") {
      const remaining = this.scriptedDrops.get(wire.entry.revision);
      if (remaining !== undefined && remaining > 0) {
        this.scriptedDrops.set(wire.entry.revision, remaining - 1);
        return;
      }
    }
    // Random drop.
    if (this.rng.chance(this.fault.dropProb)) {
      return;
    }
    this.enqueue(to, wire, sentAt);
    // Random duplicate: a second copy with independent latency (=> also natural reorder).
    if (this.rng.chance(this.fault.dupProb)) {
      this.enqueue(to, wire, sentAt);
    }
  }

  private enqueue(to: EndpointRole, wire: Wire, sentAt: number): void {
    let latency = this.rng.int(this.fault.latencyMin, this.fault.latencyMax);
    if (wire.t === "deliver") {
      latency += this.reorderDelayByRevision[wire.entry.revision] ?? 0;
    }
    this.queue.push({ at: sentAt + Math.max(1, latency), seq: this.seq++, to, sentAt, wire });
  }

  /** Deliver everything due at or before `now`, honoring disconnect windows in transit. */
  drainDue(now: number, deliver: (to: EndpointRole, wire: Wire) => void): void {
    const due = this.queue.filter(m => m.at <= now).sort((a, b) => a.at - b.at || a.seq - b.seq);
    this.queue = this.queue.filter(m => m.at > now);
    for (const m of due) {
      // A message whose flight crosses a blackout is lost.
      if (inAnyWindow(m.at, this.fault.downWindows)) {
        continue;
      }
      deliver(m.to, m.wire);
    }
  }

  size(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue = [];
  }
}

// ---------------------------------------------------------------------------
// Endpoint - one simulated runtime context (authority OR replica).
// ---------------------------------------------------------------------------

class Endpoint {
  readonly scheduler: EndpointScheduler;
  readonly log: RefAuthorityLog;
  readonly projector: RefControlProjector;
  readonly ctx: CoopRuntimeContext;
  private readonly abortController = new AbortController();

  // Local simulated material/control state:
  materialAccumulator = 0;
  materialRevision = 0;
  installedControl: CoopNextControl | null = null;
  installedControlId = "null";
  terminal: string | null = null;

  // Renderer pacing watermark (0 => install immediately).
  rendererStallActiveMs = 0;

  // Duplicate-mutation observability: how many times each revision was materially applied.
  readonly mutationCounts = new Map<number, number>();

  constructor(
    readonly role: EndpointRole,
    clock: VirtualClock,
    epoch: number,
    localSeatId: number,
    authoritySeatId: number,
  ) {
    this.scheduler = new EndpointScheduler(clock, `${role}-sched`);
    this.log = new RefAuthorityLog(role, epoch);
    this.projector = new RefControlProjector(this);
    this.ctx = {
      runtimeId: `${role}-runtime`,
      sessionId: "sim-session",
      runId: "sim-run",
      epoch,
      localSeatId,
      authoritySeatId,
      membershipRevision: 1,
      scene: unusedScene(),
      transport: unusedTransport(),
      scheduler: this.scheduler,
      cancellation: this.abortController.signal,
    };
  }

  recordMutation(revision: number): void {
    this.mutationCounts.set(revision, (this.mutationCounts.get(revision) ?? 0) + 1);
  }

  dispose(reason: string): void {
    this.scheduler.cancelOwner(`${this.role}-lease`);
    this.scheduler.cancelOwner(`${this.role}-commit`);
    this.scheduler.cancelOwner(`${this.role}-recovery`);
    this.scheduler.cancelOwner(`${this.role}-renderer`);
    this.log.dispose(reason);
    this.abortController.abort();
  }
}

// ---------------------------------------------------------------------------
// Story - a scripted sequence of authoritative progressions.
// ---------------------------------------------------------------------------

export interface StoryAct {
  readonly kind: CoopAuthorityEntry["kind"];
  readonly control: CoopNextControl;
  readonly delta: number;
  readonly checkpoint: boolean;
  /** Subsume all still-live prior revisions (used by wave/terminal checkpoints). */
  readonly subsumePrior: boolean;
}

function frameContext(
  epoch: number,
  senderSeatId: number,
  authoritySeatId: number,
  connectionGeneration: number,
): CoopFrameContextV2 {
  return {
    sessionId: "sim-session",
    runId: "sim-run",
    sessionEpoch: epoch,
    seatMapId: "sim-seatmap",
    membershipRevision: 1,
    senderSeatId,
    authoritySeatId,
    connectionGeneration,
  };
}

// ---------------------------------------------------------------------------
// Recovery transaction (contract CoopRecoveryTransaction). Fence BEFORE request;
// apply material + log frontier + control ATOMICALLY before release. Driven by the
// bus reply arriving on a clock step (not a real await); run() returns a deferred
// promise the state machine resolves when it reaches released/terminalized.
// ---------------------------------------------------------------------------

export class RefRecoveryTransaction implements CoopRecoveryTransaction {
  readonly ctx: CoopRuntimeContext;
  phase: CoopRecoveryPhase = "fence-acquired";
  capturedFrontier = 0;
  aborted = false;

  private resolveFn: ((r: "recovered" | "terminalized") => void) | null = null;
  private settled = false;
  private cancelRetry: (() => void) | null = null;

  constructor(
    private readonly sim: AuthorityV2Simulator,
    private readonly replica: Endpoint,
    private readonly reason: "snapshot",
    private readonly requestId: string,
  ) {
    this.ctx = replica.ctx;
  }

  run(): Promise<"recovered" | "terminalized"> {
    return new Promise(resolve => {
      this.resolveFn = resolve;
      this.begin();
    });
  }

  private begin(): void {
    // Fence: freeze admission / control progression / materialization until release
    // (the fence flag itself lives on the driver; this transaction owns the phases).
    this.phase = "fence-acquired";
    this.capturedFrontier = this.replica.log.appliedThrough();
    this.phase = "frontier-captured";
    this.request();
  }

  private request(): void {
    this.phase = "requested";
    this.sim.sendFromReplica({
      t: "recover-req",
      reason: this.reason,
      fromRevision: this.capturedFrontier,
      requestId: this.requestId,
    });
    // Retry on a RECOVERY-class deadline. Suspension does NOT consume this deadline.
    this.cancelRetry = this.replica.scheduler.schedule(
      { ownerId: "replica-recovery", address: `recovery:${this.requestId}`, reason: "recovery-request-retry" },
      this.sim.recoveryRetryMs,
      "recovery",
      () => {
        if (!this.settled) {
          this.request();
        }
      },
    );
  }

  /** Called by the simulator when the matching reply arrives. */
  onReply(reply: RecoveryReply): void {
    if (this.settled) {
      return;
    }
    this.cancelRetry?.();
    this.cancelRetry = null;
    this.phase = "validated";
    if (reply.kind === "terminalize") {
      this.applyTerminal(reply);
    } else {
      this.applySnapshot(reply);
    }
  }

  private applySnapshot(reply: Extract<RecoveryReply, { kind: "snapshot" }>): void {
    // ATOMIC: material + log frontier + control move together, under the fence.
    this.replica.materialAccumulator = reply.cumulative;
    this.replica.materialRevision = reply.frontier;
    this.phase = "material-applied";
    this.replica.log.adoptFrontier(reply.frontier);
    this.phase = "frontier-installed";
    if (reply.control !== null) {
      this.replica.projector.project(this.replica.ctx, reply.control);
    }
    this.phase = "control-installed";
    // ACK the recovered frontier so the authority can retire.
    this.sim.sendRecoveryReceipts(this.replica, reply.frontier);
    this.phase = "acked";
    this.settle("recovered");
    this.phase = "released";
    // Release the fence SYNCHRONOUSLY (microtasks do not flush inside the step loop).
    this.sim.notifyRecoverySettled();
  }

  private applyTerminal(reply: Extract<RecoveryReply, { kind: "terminalize" }>): void {
    this.replica.materialAccumulator = reply.cumulative;
    this.replica.materialRevision = reply.frontier;
    this.replica.log.adoptFrontier(reply.frontier);
    if (reply.control !== null) {
      this.replica.projector.project(this.replica.ctx, reply.control);
    }
    this.replica.terminal = reply.terminalId;
    this.settle("terminalized");
    this.phase = "terminalized";
    this.sim.notifyRecoverySettled();
  }

  private settle(result: "recovered" | "terminalized"): void {
    this.settled = true;
    this.resolveFn?.(result);
  }

  abort(_reason: string): void {
    if (this.settled) {
      return;
    }
    this.aborted = true;
    this.cancelRetry?.();
    this.cancelRetry = null;
    // A cancelled recovery attempt settles as a terminalization of the attempt so no waiter dangles.
    this.settle("terminalized");
    this.phase = "terminalized";
    this.sim.notifyRecoverySettled();
  }

  get isSettled(): boolean {
    return this.settled;
  }
}

// ---------------------------------------------------------------------------
// The simulator - wires two endpoints + one bus + one clock, runs a seeded
// schedule, and exposes the acceptance-oracle probes.
// ---------------------------------------------------------------------------

export class SimInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimInvariantError";
  }
}

export interface SimConfig {
  readonly seed: number;
  readonly story: readonly StoryAct[];
  readonly fault: FaultConfig;
  readonly budget?: number;
  /** Authority commit cadence (connected active-ms between commits). */
  readonly commitCadenceMs?: number;
  /** Authority redelivery cadence (connected active-ms between retained-entry resends). */
  readonly redeliverCadenceMs?: number;
  /** Recovery request retry cadence (recovery active-ms). */
  readonly recoveryRetryMs?: number;
  /** Directed: drop the FIRST delivery of these revisions exactly once. */
  readonly dropFirstDeliveryOfRevision?: readonly number[];
  /** Directed: force extra latency on specific revisions' deliveries (reorder). */
  readonly reorderDelayByRevision?: Record<number, number>;
  /** Directed: at this step, set the authority prune horizon (makes stale recovery unrecoverable). */
  readonly pruneHorizonAt?: { readonly step: number; readonly horizon: number };
  /** Directed: at this step, force the replica to open a snapshot recovery transaction. */
  readonly triggerSnapshotRecoveryAt?: { readonly step: number };
  /** Directed: replica renderer stall watermark (defers control installation). */
  readonly rendererStallActiveMs?: number;
}

export interface ConvergenceReport {
  readonly seed: number;
  readonly step: number;
  readonly authorityFrontier: number;
  readonly authorityCumulative: number;
  readonly authorityControl: string;
  readonly authorityTerminal: string | null;
  readonly replicaFrontier: number;
  readonly replicaCumulative: number;
  readonly replicaControl: string;
  readonly replicaTerminal: string | null;
  readonly retained: number;
  readonly busInFlight: number;
}

export interface SimResult {
  readonly seed: number;
  readonly steps: number;
  readonly outcome: "converged" | "terminal";
  readonly report: ConvergenceReport;
}

const DEADLOCK_STALL_STEPS = 4;

export class AuthorityV2Simulator {
  readonly clock = new VirtualClock();
  readonly authority: Endpoint;
  readonly replica: Endpoint;
  readonly rng: SeededRng;
  readonly recoveryRetryMs: number;

  private readonly bus: MessageBus;
  private readonly story: readonly StoryAct[];
  private readonly fault: FaultConfig;
  private readonly budget: number;
  private readonly commitCadenceMs: number;
  private readonly redeliverCadenceMs: number;
  private readonly cfg: SimConfig;
  private readonly epoch = 7;

  private step = 0;
  private nextAct = 0;
  private connectionGeneration = 1;
  private leaseArmed = false;
  private commitArmed = false;

  // Replica-side driver state:
  private replicaFenced = false;
  private readonly deliveryBuffer: CoopAuthorityEntry[] = [];
  private readonly recoveries: RefRecoveryTransaction[] = [];
  private gapObserved = false;
  private gapRequestsSent = 0;
  private recoveryReqSeq = 0;
  private gapRetryArmed = false;

  // Liveness detector state:
  private lastSignature = "";
  private deadlockStall = 0;

  constructor(cfg: SimConfig) {
    this.cfg = cfg;
    this.rng = makeRng(cfg.seed);
    this.story = cfg.story;
    this.fault = cfg.fault;
    this.budget = cfg.budget ?? 6000;
    this.commitCadenceMs = cfg.commitCadenceMs ?? 6;
    this.redeliverCadenceMs = cfg.redeliverCadenceMs ?? 4;
    this.recoveryRetryMs = cfg.recoveryRetryMs ?? 8;
    this.authority = new Endpoint("authority", this.clock, this.epoch, 0, 0);
    this.replica = new Endpoint("replica", this.clock, this.epoch, 1, 0);
    this.replica.rendererStallActiveMs = cfg.rendererStallActiveMs ?? 0;
    this.bus = new MessageBus(this.clock, this.rng, this.fault, cfg.reorderDelayByRevision ?? {});
    if (cfg.dropFirstDeliveryOfRevision) {
      this.bus.scriptDropFirstDeliverOf(cfg.dropFirstDeliveryOfRevision);
    }
    this.armCommit();
  }

  // ----- Authority driver -----

  private authorityOwner(reason: string): CoopTimerOwner {
    return { ownerId: "authority-commit", address: "authority:commit", reason };
  }

  private armCommit(): void {
    if (this.commitArmed || this.nextAct >= this.story.length || this.authority.terminal !== null) {
      return;
    }
    this.commitArmed = true;
    this.authority.scheduler.schedule(this.authorityOwner("commit-cadence"), this.commitCadenceMs, "connected", () => {
      this.commitArmed = false;
      this.commitNextAct();
      this.armCommit();
    });
  }

  private commitNextAct(): void {
    if (this.authority.terminal !== null || this.authority.log.isTerminalCommitted()) {
      return;
    }
    const act = this.story[this.nextAct];
    if (act === undefined) {
      return;
    }
    this.nextAct++;
    const revision = this.authority.log.latestRevision() + 1;
    const prevCumulative = this.authority.log.cumulativeAt(revision - 1);
    const cumulative = prevCumulative + act.delta;
    const subsumes: number[] = [];
    if (act.subsumePrior) {
      for (const e of this.authority.log.retained()) {
        subsumes.push(e.revision);
      }
    }
    const payload: MaterialPayload = { delta: act.delta, cumulative, checkpoint: act.checkpoint };
    const entry = this.authority.log.commit({
      context: frameContext(this.epoch, 0, 0, this.connectionGeneration),
      operationId: `op-${revision}`,
      kind: act.kind,
      material: { digest: digestFor(revision, cumulative), payload },
      nextControl: act.control,
      subsumes,
    });
    if (act.kind === "TERMINAL_COMMIT" && entry.nextControl !== null && entry.nextControl.kind === "TERMINAL") {
      this.authority.terminal = entry.nextControl.terminalId;
    }
    this.deliverEntry(entry);
    this.armLease();
  }

  private deliverEntry(entry: CoopAuthorityEntry): void {
    this.bus.send("replica", { t: "deliver", entry });
  }

  private armLease(): void {
    if (this.leaseArmed) {
      return;
    }
    if (this.authority.log.retained().length === 0) {
      return;
    }
    this.leaseArmed = true;
    this.authority.scheduler.schedule(
      { ownerId: "authority-lease", address: "authority:redeliver", reason: "retained-redelivery" },
      this.redeliverCadenceMs,
      "connected",
      () => {
        this.leaseArmed = false;
        for (const e of this.authority.log.retained()) {
          this.deliverEntry(e);
        }
        this.armLease();
      },
    );
  }

  private handleReceipt(receipt: CoopAuthorityReceipt): void {
    this.authority.log.acceptReceipt(receipt);
    // Lease naturally stops re-arming once retained() empties.
  }

  private handleRecoverRequest(req: Extract<Wire, { t: "recover-req" }>): void {
    if (req.reason === "gap") {
      for (const e of this.authority.log.retained()) {
        if (e.revision >= req.fromRevision) {
          this.deliverEntry(e);
        }
      }
      return;
    }
    // Snapshot recovery. A frontier below the prune horizon is unrecoverable => the
    // safe response is a SHARED terminal on both endpoints (never a silent park).
    if (req.fromRevision < this.authority.log.pruneHorizon) {
      const terminalId = this.ensureAuthorityTerminal();
      const frontier = this.authority.log.latestRevision();
      this.bus.send("replica", {
        t: "recover-reply",
        requestId: req.requestId,
        reply: {
          kind: "terminalize",
          frontier,
          cumulative: this.authority.log.cumulativeAt(frontier),
          control: this.authority.log.latestControl(),
          terminalId,
        },
      });
      return;
    }
    if (this.authority.log.isTerminalCommitted()) {
      const frontier = this.authority.log.latestRevision();
      this.bus.send("replica", {
        t: "recover-reply",
        requestId: req.requestId,
        reply: {
          kind: "terminalize",
          frontier,
          cumulative: this.authority.log.cumulativeAt(frontier),
          control: this.authority.log.latestControl(),
          terminalId: this.authority.log.terminalId() ?? "terminal",
        },
      });
      return;
    }
    const frontier = this.authority.log.latestRevision();
    this.bus.send("replica", {
      t: "recover-reply",
      requestId: req.requestId,
      reply: {
        kind: "snapshot",
        frontier,
        cumulative: this.authority.log.cumulativeAt(frontier),
        control: this.authority.log.latestControl(),
      },
    });
  }

  private ensureAuthorityTerminal(): string {
    const existing = this.authority.log.terminalId();
    if (existing !== null) {
      return existing;
    }
    const terminalId = `terminal:recovery:${this.epoch}`;
    const revision = this.authority.log.latestRevision() + 1;
    const prevCumulative = this.authority.log.cumulativeAt(revision - 1);
    const subsumes = this.authority.log.retained().map(e => e.revision);
    const payload: MaterialPayload = { delta: 0, cumulative: prevCumulative, checkpoint: true };
    const entry = this.authority.log.commit({
      context: frameContext(this.epoch, 0, 0, this.connectionGeneration),
      operationId: `op-${revision}`,
      kind: "TERMINAL_COMMIT",
      material: { digest: digestFor(revision, prevCumulative), payload },
      nextControl: { kind: "TERMINAL", terminalId },
      subsumes,
    });
    this.authority.terminal = terminalId;
    this.deliverEntry(entry);
    this.armLease();
    return terminalId;
  }

  // ----- Replica driver -----

  private handleDeliver(entry: CoopAuthorityEntry): void {
    if (this.replica.terminal !== null) {
      // Terminal freezes the replica: re-ack the terminal so a lost receipt still retires it.
      if (entry.kind === "TERMINAL_COMMIT") {
        this.sendReceipt(entry, "admitted");
        this.sendReceipt(entry, "materialApplied");
        if (entry.nextControl !== null) {
          this.sendReceipt(entry, "controlInstalled", controlKey(entry.nextControl));
        }
      }
      return;
    }
    if (this.replicaFenced) {
      // Recovery fence: buffer the delivery; do NOT admit/apply mid-recovery.
      this.deliveryBuffer.push(entry);
      return;
    }
    const result = this.replica.log.admit(entry);
    switch (result.kind) {
      case "admitted":
        this.applyEntry(entry);
        this.drainBuffer();
        break;
      case "duplicate-complete":
        // Idempotent: never re-mutate. Re-send receipts so a lost ack still retires it.
        this.resendReceiptsFor(entry);
        break;
      case "duplicate-pending-material":
      case "duplicate-pending-control":
        // The reference simulator applies synchronously, so it cannot retain a partial stage.
        this.resendReceiptsFor(entry);
        break;
      case "gap":
        this.gapObserved = true;
        this.deliveryBuffer.push(entry);
        this.requestGapTail(result.missingFrom);
        break;
      case "staleEpoch":
      case "rejected":
        break;
    }
  }

  private applyEntry(entry: CoopAuthorityEntry): void {
    const payload = readPayload(entry);
    const nextAcc = payload.checkpoint ? payload.cumulative : this.replica.materialAccumulator + payload.delta;
    // Digest is computed over (revision, accumulator). A correct single application
    // matches; a divergence (e.g. a double-applied delta) would not => self-heal via recovery.
    if (digestFor(entry.revision, nextAcc) !== entry.material.digest) {
      this.openSnapshotRecovery();
      return;
    }
    this.replica.materialAccumulator = nextAcc;
    this.replica.materialRevision = entry.revision;
    this.replica.recordMutation(entry.revision);
    this.sendReceipt(entry, "admitted");
    this.sendReceipt(entry, "materialApplied");
    if (entry.nextControl === null) {
      this.replica.installedControl = null;
      this.replica.installedControlId = "null";
    } else {
      this.installControl(entry, entry.nextControl);
    }
    if (entry.kind === "TERMINAL_COMMIT" && entry.nextControl !== null && entry.nextControl.kind === "TERMINAL") {
      this.replica.terminal = entry.nextControl.terminalId;
    }
  }

  private installControl(entry: CoopAuthorityEntry, control: NonNullable<CoopNextControl>): void {
    const res = this.replica.projector.project(this.replica.ctx, control);
    if (res.kind === "installed" || res.kind === "already-installed") {
      this.sendReceipt(entry, "controlInstalled", res.controlId);
      return;
    }
    if (res.kind === "deferred") {
      // Engine pacing - re-project on a renderer deadline. NEVER a terminal by itself.
      this.replica.scheduler.schedule(
        { ownerId: "replica-renderer", address: `renderer:${entry.revision}`, reason: "control-reproject" },
        1,
        "renderer",
        () => {
          if (this.replica.terminal === null) {
            this.installControl(entry, control);
          }
        },
      );
    }
    // rejected: leave uninstalled (the log's pacing / a later recovery reconciles).
  }

  private drainBuffer(): void {
    if (this.replica.terminal !== null) {
      // Terminal freezes the replica: buffered deliveries are discarded, never applied.
      this.deliveryBuffer.length = 0;
      return;
    }
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (let i = 0; i < this.deliveryBuffer.length; i++) {
        const buffered = this.deliveryBuffer[i];
        const res = this.replica.log.admit(buffered);
        if (res.kind === "admitted") {
          this.deliveryBuffer.splice(i, 1);
          this.applyEntry(buffered);
          progressed = true;
          break;
        }
        if (
          res.kind === "duplicate-complete"
          || res.kind === "duplicate-pending-material"
          || res.kind === "duplicate-pending-control"
          || res.kind === "staleEpoch"
          || res.kind === "rejected"
        ) {
          this.deliveryBuffer.splice(i, 1);
          progressed = true;
          break;
        }
      }
    }
  }

  private requestGapTail(missingFrom: number): void {
    this.gapRequestsSent++;
    this.sendFromReplica({
      t: "recover-req",
      reason: "gap",
      fromRevision: missingFrom,
      requestId: `gap-${this.recoveryReqSeq++}`,
    });
    // A recovery-class retry so a lost gap request still heals (and stays an owned
    // live transaction across a disconnect). Suspension does not consume this deadline.
    if (this.gapRetryArmed) {
      return;
    }
    this.gapRetryArmed = true;
    this.replica.scheduler.schedule(
      { ownerId: "replica-recovery", address: "recovery:gap", reason: "gap-retry" },
      this.recoveryRetryMs,
      "recovery",
      () => {
        this.gapRetryArmed = false;
        const front = this.replica.log.appliedThrough();
        if (this.replica.terminal === null && front < this.authorityFrontier()) {
          this.requestGapTail(front + 1);
        }
      },
    );
  }

  openSnapshotRecovery(): RefRecoveryTransaction {
    const txn = new RefRecoveryTransaction(this, this.replica, "snapshot", `rec-${this.recoveryReqSeq++}`);
    this.replicaFenced = true;
    this.recoveries.push(txn);
    // Start the state machine. The fence releases SYNCHRONOUSLY via notifyRecoverySettled
    // when the transaction settles - never via the promise microtask (which does not flush
    // inside the synchronous step loop). The returned promise still resolves for callers.
    void txn.run();
    return txn;
  }

  /** Called synchronously by a recovery transaction when it settles: release the fence once
   *  no live recovery remains, and drain any deliveries buffered under the fence. */
  notifyRecoverySettled(): void {
    if (this.recoveries.every(t => t.isSettled)) {
      this.replicaFenced = false;
      this.drainBuffer();
    }
  }

  private sendReceipt(entry: CoopAuthorityEntry, stage: CoopAckStage, controlId?: string): void {
    const base = {
      context: frameContext(this.epoch, 1, 0, this.connectionGeneration),
      revision: entry.revision,
      operationId: entry.operationId,
      stage,
    };
    const receipt: CoopAuthorityReceipt = controlId === undefined ? base : { ...base, controlId };
    this.bus.send("authority", { t: "receipt", receipt });
  }

  private resendReceiptsFor(entry: CoopAuthorityEntry): void {
    // The replica already applied this revision; re-emit its receipts idempotently.
    if (entry.revision > this.replica.materialRevision) {
      return;
    }
    this.sendReceipt(entry, "admitted");
    this.sendReceipt(entry, "materialApplied");
    if (entry.nextControl !== null) {
      this.sendReceipt(entry, "controlInstalled", controlKey(entry.nextControl));
    }
  }

  sendRecoveryReceipts(replica: Endpoint, frontier: number): void {
    const entry = this.authority.log.entryAt(frontier);
    const control = this.authority.log.latestControl();
    const base = {
      context: frameContext(this.epoch, 1, 0, this.connectionGeneration),
      revision: frontier,
      operationId: entry?.operationId ?? `op-${frontier}`,
      stage: "materialApplied" as CoopAckStage,
    };
    this.bus.send("authority", { t: "receipt", receipt: { ...base, stage: "admitted" } });
    this.bus.send("authority", { t: "receipt", receipt: base });
    if (control !== null) {
      this.bus.send("authority", {
        t: "receipt",
        receipt: { ...base, stage: "controlInstalled", controlId: controlKey(control) },
      });
    }
    void replica;
  }

  sendFromReplica(wire: Wire): void {
    this.bus.send("authority", wire);
  }

  private handleRecoverReply(reply: Extract<Wire, { t: "recover-reply" }>): void {
    const txn = this.recoveries.find(t => !t.isSettled);
    txn?.onReply(reply.reply);
  }

  // ----- Bus wiring -----

  private deliver(to: EndpointRole, wire: Wire): void {
    if (to === "replica") {
      if (wire.t === "deliver") {
        this.handleDeliver(wire.entry);
      } else if (wire.t === "recover-reply") {
        this.handleRecoverReply(wire);
      }
    } else if (wire.t === "receipt") {
      this.handleReceipt(wire.receipt);
    } else if (wire.t === "recover-req") {
      this.handleRecoverRequest(wire);
    }
  }

  // ----- Stepping -----

  private applySuspension(): void {
    const replicaShouldSuspend = inAnyWindow(this.step, this.fault.suspendReplica);
    if (replicaShouldSuspend !== this.replica.scheduler.isSuspended) {
      this.replica.scheduler.setSuspended(replicaShouldSuspend);
    }
    const authorityShouldSuspend = inAnyWindow(this.step, this.fault.suspendAuthority);
    if (authorityShouldSuspend !== this.authority.scheduler.isSuspended) {
      this.authority.scheduler.setSuspended(authorityShouldSuspend);
    }
  }

  private handleReconnect(): void {
    // A down->up edge bumps the connection generation and re-primes redelivery so
    // retained entries flow again on reconnect.
    const downNow = inAnyWindow(this.step, this.fault.downWindows);
    const downPrev = inAnyWindow(this.step - 1, this.fault.downWindows);
    if (downPrev && !downNow) {
      this.connectionGeneration++;
      // Kick redelivery immediately on reconnect.
      for (const e of this.authority.log.retained()) {
        this.deliverEntry(e);
      }
    }
  }

  private runDirectedTriggers(): void {
    const prune = this.cfg.pruneHorizonAt;
    if (prune && prune.step === this.step) {
      this.authority.log.setHorizon(prune.horizon);
    }
    const trigger = this.cfg.triggerSnapshotRecoveryAt;
    if (trigger && trigger.step === this.step && this.replica.terminal === null) {
      this.openSnapshotRecovery();
    }
  }

  /** Advance the single virtual clock by one unit and run one round of protocol reactions. */
  advanceOneStep(): void {
    this.step++;
    this.clock.advance(1);
    this.applySuspension();
    this.handleReconnect();
    this.runDirectedTriggers();
    // Fire scheduler deadlines (commit cadence, redelivery, recovery retries, reproject).
    this.authority.scheduler.sync();
    this.replica.scheduler.sync();
    // Deliver everything due by now (async even in loopback).
    this.bus.drainDue(this.clock.now, (to, wire) => this.deliver(to, wire));
    // Fire any deadlines that a just-delivered message armed.
    this.authority.scheduler.sync();
    this.replica.scheduler.sync();
    this.checkInvariants();
  }

  private authorityFrontier(): number {
    return this.authority.log.latestRevision();
  }

  private storyExhausted(): boolean {
    return this.nextAct >= this.story.length || this.authority.terminal !== null;
  }

  private hasOwnedLiveTransaction(): boolean {
    if (this.bus.size() > 0) {
      return true;
    }
    if (!this.storyExhausted()) {
      return true;
    }
    if (this.authority.log.retained().length > 0) {
      // The redelivery lease (or its next re-arm) owns these.
      return true;
    }
    if (this.replicaFenced || this.recoveries.some(t => !t.isSettled)) {
      return true;
    }
    if (this.replica.scheduler.activeTimerCount() > 0 || this.authority.scheduler.activeTimerCount() > 0) {
      return true;
    }
    return false;
  }

  private isConverged(): boolean {
    if (this.authority.terminal !== null) {
      return this.replica.terminal === this.authority.terminal;
    }
    if (!this.storyExhausted()) {
      return false;
    }
    const frontier = this.authorityFrontier();
    return (
      this.replica.log.appliedThrough() === frontier
      && this.replica.materialAccumulator === this.authority.log.cumulativeAt(frontier)
      && controlKey(this.replica.installedControl) === controlKey(this.authority.log.latestControl())
    );
  }

  private signature(): string {
    return [
      this.authorityFrontier(),
      this.authority.log.retained().length,
      this.authority.terminal ?? "-",
      this.replica.log.appliedThrough(),
      this.replica.materialAccumulator,
      this.replica.installedControlId,
      this.replica.terminal ?? "-",
      this.replicaFenced ? 1 : 0,
      this.bus.size(),
      this.deliveryBuffer.length,
    ].join("|");
  }

  private checkInvariants(): void {
    // 1. Duplicate-never-double-mutates: no revision materially applied more than once.
    for (const [revision, count] of this.replica.mutationCounts) {
      if (count > 1) {
        throw new SimInvariantError(`double-mutate: revision ${revision} applied ${count}x. ${this.reportLine()}`);
      }
    }
    // 2. Deadlock: parked (no progress) with NO owned live transaction that would unpark it.
    const sig = this.signature();
    if (sig !== this.lastSignature) {
      this.lastSignature = sig;
      this.deadlockStall = 0;
    } else if (!this.isConverged() && !this.hasOwnedLiveTransaction()) {
      this.deadlockStall++;
      if (this.deadlockStall > DEADLOCK_STALL_STEPS) {
        throw new SimInvariantError(`deadlock: parked with no owned recoverable transaction. ${this.reportLine()}`);
      }
    } else {
      this.deadlockStall = 0;
    }
  }

  private isQuiescent(): boolean {
    return (
      this.storyExhausted()
      && this.bus.size() === 0
      && this.authority.scheduler.activeTimerCount() === 0
      && this.replica.scheduler.activeTimerCount() === 0
      && !this.replicaFenced
      && this.recoveries.every(t => t.isSettled)
      && this.deliveryBuffer.length === 0
    );
  }

  /** Run to quiescence or budget, enforcing the deadlock/double-mutate invariants each step. */
  run(): SimResult {
    while (this.step < this.budget) {
      this.advanceOneStep();
      if (this.isQuiescent()) {
        break;
      }
    }
    if (!this.isConverged()) {
      throw new SimInvariantError(`did not converge within ${this.budget} steps. ${this.reportLine()}`);
    }
    const outcome: "converged" | "terminal" = this.authority.terminal === null ? "converged" : "terminal";
    return { seed: this.cfg.seed, steps: this.step, outcome, report: this.convergenceReport() };
  }

  /** Step the clock a bounded number of times (directed scenarios). */
  pump(steps: number): void {
    for (let i = 0; i < steps && this.step < this.budget; i++) {
      this.advanceOneStep();
    }
  }

  /** Step until `predicate` holds or a bounded step budget is hit. Returns whether it held. */
  runUntil(predicate: () => boolean, maxSteps = this.budget): boolean {
    let n = 0;
    while (!predicate() && n < maxSteps && this.step < this.budget) {
      this.advanceOneStep();
      n++;
    }
    return predicate();
  }

  /** Terse alias for {@link convergenceReport}. */
  report(): ConvergenceReport {
    return this.convergenceReport();
  }

  convergenceReport(): ConvergenceReport {
    return {
      seed: this.cfg.seed,
      step: this.step,
      authorityFrontier: this.authorityFrontier(),
      authorityCumulative: this.authority.log.cumulativeAt(this.authorityFrontier()),
      authorityControl: controlKey(this.authority.log.latestControl()),
      authorityTerminal: this.authority.terminal,
      replicaFrontier: this.replica.log.appliedThrough(),
      replicaCumulative: this.replica.materialAccumulator,
      replicaControl: this.replica.installedControlId,
      replicaTerminal: this.replica.terminal,
      retained: this.authority.log.retained().length,
      busInFlight: this.bus.size(),
    };
  }

  private reportLine(): string {
    const r = this.convergenceReport();
    return (
      `seed=${r.seed} step=${r.step} `
      + `authority[frontier=${r.authorityFrontier} acc=${r.authorityCumulative} control=${r.authorityControl} terminal=${r.authorityTerminal}] `
      + `replica[frontier=${r.replicaFrontier} acc=${r.replicaCumulative} control=${r.replicaControl} terminal=${r.replicaTerminal}] `
      + `retained=${r.retained} busInFlight=${r.busInFlight}`
    );
  }

  // ----- Diagnostics for directed tests -----

  get gapWasObserved(): boolean {
    return this.gapObserved;
  }

  get gapRequestCount(): number {
    return this.gapRequestsSent;
  }

  get isReplicaFenced(): boolean {
    return this.replicaFenced;
  }

  get liveRecoveries(): readonly RefRecoveryTransaction[] {
    return this.recoveries;
  }

  get currentStep(): number {
    return this.step;
  }

  // ----- Teardown -----

  dispose(reason: string): void {
    for (const txn of this.recoveries) {
      if (!txn.isSettled) {
        txn.abort(reason);
      }
    }
    this.replicaFenced = false;
    this.bus.clear();
    this.authority.dispose(reason);
    this.replica.dispose(reason);
    this.deliveryBuffer.length = 0;
  }

  /** Teardown probe: everything a settled session must have released. */
  teardownState(): {
    authorityTimers: number;
    replicaTimers: number;
    retained: number;
    busInFlight: number;
    liveRecoveries: number;
    buffered: number;
  } {
    return {
      authorityTimers: this.authority.scheduler.activeTimerCount(),
      replicaTimers: this.replica.scheduler.activeTimerCount(),
      retained: this.authority.log.retained().length,
      busInFlight: this.bus.size(),
      liveRecoveries: this.recoveries.filter(t => !t.isSettled).length,
      buffered: this.deliveryBuffer.length,
    };
  }
}

// ---------------------------------------------------------------------------
// Story + fault builders
// ---------------------------------------------------------------------------

/** COMMAND control for a given wave/turn (turn-owner seat, active pokemon). */
export function commandControl(
  epoch: number,
  wave: number,
  turn: number,
  ownerSeatId: number,
  pokemonId: number,
): CoopNextControl {
  return {
    kind: "COMMAND_FRONTIER",
    epoch,
    wave,
    turn,
    commands: [{ ownerSeatId, pokemonId, fieldIndex: 0 }],
  };
}

/** A realistic multi-progression story: turns, a replacement, an interaction, a wave, optional terminal. */
export function standardStory(rng: SeededRng, opts: { readonly terminal: boolean }): StoryAct[] {
  const epoch = 7;
  const acts: StoryAct[] = [];
  // Wave 1: two turns.
  acts.push({
    kind: "TURN_COMMIT",
    control: commandControl(epoch, 1, 1, 0, 100),
    delta: rng.int(1, 9),
    checkpoint: false,
    subsumePrior: false,
  });
  acts.push({
    kind: "TURN_COMMIT",
    control: commandControl(epoch, 1, 2, 1, 101),
    delta: rng.int(1, 9),
    checkpoint: false,
    subsumePrior: false,
  });
  // A forced replacement mid-wave.
  acts.push({
    kind: "REPLACEMENT_COMMIT",
    control: {
      kind: "AWAIT_SUCCESSOR",
      afterOperationId: "op-3",
      epoch,
      wave: 1,
      turn: 2,
      allowedKinds: ["INTERACTION_COMMIT", "WAVE_ADVANCE", "TERMINAL_COMMIT"],
      expectedOperationId: null,
    },
    delta: rng.int(1, 9),
    checkpoint: false,
    subsumePrior: false,
  });
  // An interaction (reward) surface.
  acts.push({
    kind: "INTERACTION_COMMIT",
    control: { kind: "REWARD", operationId: "reward-1", ownerSeatId: 0 },
    delta: rng.int(1, 9),
    checkpoint: false,
    subsumePrior: false,
  });
  // Wave advance to wave 2 (a checkpoint that subsumes wave 1's live entries).
  acts.push({
    kind: "WAVE_ADVANCE",
    control: commandControl(epoch, 2, 1, 0, 100),
    delta: rng.int(1, 9),
    checkpoint: true,
    subsumePrior: true,
  });
  // Wave 2: one more turn.
  acts.push({
    kind: "TURN_COMMIT",
    control: commandControl(epoch, 2, 2, 1, 101),
    delta: rng.int(1, 9),
    checkpoint: false,
    subsumePrior: false,
  });
  if (opts.terminal) {
    acts.push({
      kind: "TERMINAL_COMMIT",
      control: { kind: "TERMINAL", terminalId: "terminal:victory" },
      delta: 0,
      checkpoint: true,
      subsumePrior: true,
    });
  }
  return acts;
}

const NO_FAULT: FaultConfig = {
  dropProb: 0,
  dupProb: 0,
  latencyMin: 1,
  latencyMax: 1,
  downWindows: [],
  suspendReplica: [],
  suspendAuthority: [],
};

export function noFault(): FaultConfig {
  return NO_FAULT;
}

/** A bounded, seeded fault schedule. All faults are confined to the first ~55% of the
 *  budget so a quiet tail always remains for redelivery/recovery to converge. */
export function randomFault(rng: SeededRng, budget: number): FaultConfig {
  const faultHorizon = Math.floor(budget * 0.55);
  const windows = (count: number, maxLen: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let i = 0; i < count; i++) {
      const from = rng.int(2, Math.max(3, faultHorizon - maxLen - 1));
      const len = rng.int(2, maxLen);
      out.push([from, from + len]);
    }
    return out;
  };
  const downCount = rng.int(0, 2);
  const suspendReplicaCount = rng.int(0, 1);
  const suspendAuthorityCount = rng.int(0, 1);
  return {
    dropProb: rng.next() * 0.45,
    dupProb: rng.next() * 0.35,
    latencyMin: 1,
    latencyMax: rng.int(1, 5),
    downWindows: windows(downCount, 14),
    suspendReplica: suspendReplicaCount > 0 ? windows(suspendReplicaCount, 20) : [],
    suspendAuthority: suspendAuthorityCount > 0 ? windows(suspendAuthorityCount, 20) : [],
  };
}

/** Build a fully-randomized run for a seed (the acceptance oracle's workhorse). */
export function buildRandomizedRun(seed: number): AuthorityV2Simulator {
  const rng = makeRng(seed);
  const budget = 6000;
  const terminal = rng.chance(0.5);
  const story = standardStory(rng, { terminal });
  const fault = randomFault(rng, budget);
  return new AuthorityV2Simulator({ seed, story, fault, budget });
}
