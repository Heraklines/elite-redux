/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - Migration C: the WAVE-ADVANCE + TERMINAL adapter.
//
// This is the typed successor of the P0 anti-pattern the audit named: the guest
// DERIVING its post-battle tail from a one-bit `waveResolved.outcome` (legacy
// coop-replay-phases.ts maybeRunCoopWaveAdvance / finishTurn), racing a second
// retention ledger (coop-wave-operation.ts WAVE_ADVANCE journal + retained wave
// acks) and the GameOver interrupt paths where the guest waited for a turn commit
// the host would never emit. Two ledgers + a derived tail disagreed, and healthy
// sessions died at the wave boundary and at GameOver.
//
// THE INVERSION (frozen decision 4): the AUTHORITY STATES the complete between-
// wave transition as typed material AND the canonical successor control on ONE
// CoopAuthorityEntry in the ONE revision order (frozen decision 1). The REPLICA
// ADOPTS that material and PROJECTS that control - it never derives, never infers,
// never waits on a phantom turn.
//
//  - buildWaveAdvanceEntry: a WAVE_ADVANCE entry whose material is the COMPLETE
//    transition (outcome, victory kind, next wave, biome change, egg lapse, ME
//    boundary) and whose nextControl is the canonical destination
//    (REWARD | BIOME | COMMAND | MYSTERY). A WAVE_ADVANCE SUBSUMES the unretired
//    same-wave TURN/REPLACEMENT entries: the wave is over, their control surfaces
//    are moot, so ordinary log order retires them (no cross-retention race).
//  - buildTerminalCommitEntry: a TERMINAL_COMMIT for GameOver / final flee /
//    final-boss credits / shared fault. Its nextControl is TERMINAL{terminalId}
//    and it SUBSUMES the final live events. There are NO special abort predicates
//    for impossible turn waits: a replica holding a stale turn wait sees the
//    terminal entry SUPERSEDE it via the log's subsumes mechanism.
//  - the REPLICA applier seam: an ApplyMaterialFn that ADOPTS the typed material
//    (through an injected sink) and confirms the digest, so applyEntry (replica.ts)
//    signs materialApplied and then the projector installs the stated control.
//  - the wave-boundary supersession helpers: pure functions over a log's retained
//    frontier that compute the subsumes lists above.
//  - the shadow-parity seam: a pure descriptor of an entry's stated destination +
//    a comparator, so a dual-run shadow can prove the AUTHORITATIVE statement
//    equals what a legacy derivation WOULD have produced - evidence, never a
//    second source of truth.
//
// ENGINE-FREE: like every foundation module in this lane, the only contract
// imports are TYPE-ONLY, and the sole runtime imports are the pure next-control /
// authority-entry helpers. There is NO Phaser, NO globalScene, NO getCoopRuntime,
// NO legacy coop netcode import, and NO module-global mutable state - every
// function is pure over its arguments (or over an injected sink). The whole file
// runs in the node-pure vitest lane.
// =============================================================================

import { hasValidDigest, isValidRevision } from "#data/elite-redux/coop/authority-v2/authority-entry";
import type {
  CoopAuthoritativeMaterial,
  CoopAuthorityEntry,
  CoopFrameContextV2,
  CoopNextControl,
  CoopRuntimeContext,
} from "#data/elite-redux/coop/authority-v2/contract";
import {
  controlIdOf,
  type ProjectableControl,
  validateNextControl,
} from "#data/elite-redux/coop/authority-v2/next-control";
import type { ApplyMaterialFn } from "#data/elite-redux/coop/authority-v2/replica";

// ---------------------------------------------------------------------------
// Typed transition material (the COMPLETE stated transition; the log treats it
// as opaque, but this adapter defines + validates the concrete shape).
// ---------------------------------------------------------------------------

/** The battle outcome a WAVE_ADVANCE states. A `gameOver` is a TERMINAL_COMMIT, never a wave-advance. */
export type CoopWaveOutcomeV2 = "win" | "capture" | "flee";

/** The victory kind for a win/capture (drives the trainer-victory tail); absent for a flee. */
export type CoopWaveVictoryKindV2 = "wild" | "trainer";

/** The mystery-encounter boundary a wave-advance crosses, if any (an ME-spawned battle victory routes its own tail). */
export type CoopWaveMeBoundaryV2 = "none" | "battle-victory";

/**
 * Complete engine carrier required by LIVE cutover. It stays opaque to this engine-free adapter, but it is
 * part of the digested immutable material. Shadow-only fixtures may omit it; a live replica must reject an
 * entry without it before signing materialApplied.
 */
export interface CoopWaveTerminalAuthorityCarrierV2 {
  readonly authoritativeState: unknown;
  readonly transition: unknown;
}

/**
 * The COMPLETE post-battle transition stated on a WAVE_ADVANCE entry. Every field
 * the guest previously DERIVED from a one-bit outcome is stated here as typed
 * material: the guest constructs its tail BY ADOPTION of this, never by inference.
 * All fields are plain-JSON serializable (the log retains a structural clone).
 */
export interface CoopWaveTransitionMaterialV2 {
  /** Discriminant so the applier can cross-check the entry kind against the payload. */
  readonly kind: "wave-advance";
  /** The wave that RESOLVED (the supersession key: this advance subsumes same-wave turn/replacement entries). */
  readonly wave: number;
  /** The settled turn at wave-end (the causal bind to the resolving battle state). */
  readonly turn: number;
  /** The battle OUTCOME the host resolved. */
  readonly outcome: CoopWaveOutcomeV2;
  /** The wave the run advances TO (wave + 1 for a normal advance). */
  readonly nextWave: number;
  /** Whether the transition crosses a BIOME boundary. */
  readonly biomeChange: boolean;
  /** Whether an EGG-LAPSE fires on this advance. */
  readonly eggLapse: boolean;
  /** The ME-boundary this advance crosses, if any. */
  readonly meBoundary: CoopWaveMeBoundaryV2;
  /** The victory kind for win/capture (wild vs trainer); MUST be absent for a flee. */
  readonly victoryKind?: CoopWaveVictoryKindV2;
  /** Complete settled engine image + executable transition. Mandatory in live cutover. */
  readonly authorityCarrier?: CoopWaveTerminalAuthorityCarrierV2;
}

/**
 * The only legal renderer-cursor action when an authenticated WAVE_ADVANCE installs its settled image.
 *
 * Generic authoritative-state application deliberately does not rewrite `currentBattle.turn`: a turn image
 * describes material at a boundary, not permission to move the live control cursor. WAVE_ADVANCE is the
 * ordered permission. It may prove that the source battle is already settled, advance it by exactly one
 * turn (the ordinary TurnEnd settlement), or observe that the engine has already constructed the stated
 * next wave at turn 1. Every other coordinate is a protocol/runtime mismatch and must fail closed.
 */
export type CoopWaveSettlementCursorAction = "already-settled" | "advance-one" | "next-wave-ready" | "invalid";

export function classifyWaveSettlementCursor(
  sourceWave: number,
  settledTurn: number,
  nextWave: number,
  currentWave: number,
  currentTurn: number,
): CoopWaveSettlementCursorAction {
  if (
    !Number.isSafeInteger(sourceWave)
    || sourceWave <= 0
    || !Number.isSafeInteger(settledTurn)
    || settledTurn <= 0
    || !Number.isSafeInteger(nextWave)
    || nextWave <= 0
    || !Number.isSafeInteger(currentWave)
    || currentWave <= 0
    || !Number.isSafeInteger(currentTurn)
    || currentTurn <= 0
  ) {
    return "invalid";
  }
  if (currentWave === sourceWave) {
    if (currentTurn === settledTurn) {
      return "already-settled";
    }
    return currentTurn + 1 === settledTurn ? "advance-one" : "invalid";
  }
  return nextWave !== sourceWave && currentWave === nextWave && currentTurn === 1 ? "next-wave-ready" : "invalid";
}

/** Why a TERMINAL_COMMIT sealed the session. Every one is a canonical successor of the final live events. */
export type CoopTerminalReasonV2 = "game-over" | "final-flee" | "final-boss-credits" | "shared-fault";

/**
 * The material a TERMINAL_COMMIT entry states. The committed terminal is the
 * canonical successor of the final live events; the replica installs a shared
 * freeze from it and every stale wait it subsumes is cancelled by log order.
 */
export interface CoopTerminalMaterialV2 {
  /** Discriminant so the applier can cross-check the entry kind against the payload. */
  readonly kind: "terminal";
  /** The stable shared-terminal identity (the TERMINAL nextControl's terminalId). */
  readonly terminalId: string;
  /** The machine-readable cause. */
  readonly reason: CoopTerminalReasonV2;
  /** The wave the session sealed on. */
  readonly wave: number;
  /** The turn the session sealed on. */
  readonly turn: number;
  /** Complete settled engine image + executable transition. Mandatory in live cutover. */
  readonly authorityCarrier?: CoopWaveTerminalAuthorityCarrierV2;
}

/** The canonical destination a WAVE_ADVANCE may state after full interaction cutover. */
export type CoopWaveAdvanceDestination = Extract<
  ProjectableControl,
  {
    kind: "REWARD" | "BIOME" | "COMMAND_FRONTIER" | "MYSTERY" | "SHARED_INTERACTION" | "AWAIT_SUCCESSOR";
  }
>;

/** Thrown by the authority-side builders on malformed input: an authority must NEVER commit a malformed entry. */
export class CoopWaveTerminalBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoopWaveTerminalBuildError";
  }
}

// ---------------------------------------------------------------------------
// Deterministic material digest (canonical JSON + FNV-1a). Identical on every
// client, so a redelivered entry proves identical and the replica can confirm
// the digest of the material it adopts.
// ---------------------------------------------------------------------------

/**
 * Stable canonical JSON of a plain-JSON value: object keys sorted at every depth
 * so two structurally-equal payloads serialize byte-identically (the digest is a
 * complete, order-independent encoding). Arrays keep their order (it is meaningful).
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const body = keys.map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",");
  return `{${body}}`;
}

/** FNV-1a 32-bit hash of a string, as 8-char zero-padded hex. Deterministic, dependency-free. */
function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts (avoids float precision loss on *16777619).
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * The deterministic digest of a piece of transition/terminal material. Prefixed
 * with the material kind so a wave-advance payload and a terminal payload can
 * never collide on a shared hash.
 */
export function digestOfMaterial(material: CoopWaveTransitionMaterialV2 | CoopTerminalMaterialV2): string {
  return `${material.kind}:${fnv1a32(canonicalJson(material))}`;
}

// ---------------------------------------------------------------------------
// Material completeness validation (the log is opaque; this is where the shape
// is proven, on BOTH the build side and the adopt side).
// ---------------------------------------------------------------------------

function isSafeNonNegInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Whether a value is a COMPLETE, internally-consistent wave-transition material. */
export function isValidWaveTransitionMaterial(value: unknown): value is CoopWaveTransitionMaterialV2 {
  if (value == null || typeof value !== "object") {
    return false;
  }
  const m = value as Partial<CoopWaveTransitionMaterialV2>;
  if (
    m.kind !== "wave-advance"
    || !isSafeNonNegInt(m.wave)
    || !isSafeNonNegInt(m.turn)
    || !isSafeNonNegInt(m.nextWave)
    || typeof m.biomeChange !== "boolean"
    || typeof m.eggLapse !== "boolean"
    || (m.outcome !== "win" && m.outcome !== "capture" && m.outcome !== "flee")
    || (m.meBoundary !== "none" && m.meBoundary !== "battle-victory")
  ) {
    return false;
  }
  // victoryKind is present IFF the outcome is a victory (win/capture); a flee has none.
  const carrierValid = isValidOptionalAuthorityCarrier(m.authorityCarrier);
  if (!carrierValid) {
    return false;
  }
  if (m.outcome === "flee") {
    return m.victoryKind === undefined;
  }
  return m.victoryKind === "wild" || m.victoryKind === "trainer";
}

/** Whether a value is a COMPLETE terminal material. */
export function isValidTerminalMaterial(value: unknown): value is CoopTerminalMaterialV2 {
  if (value == null || typeof value !== "object") {
    return false;
  }
  const m = value as Partial<CoopTerminalMaterialV2>;
  return (
    m.kind === "terminal"
    && isNonEmptyString(m.terminalId)
    && isSafeNonNegInt(m.wave)
    && isSafeNonNegInt(m.turn)
    && isValidOptionalAuthorityCarrier(m.authorityCarrier)
    && (m.reason === "game-over"
      || m.reason === "final-flee"
      || m.reason === "final-boss-credits"
      || m.reason === "shared-fault")
  );
}

function isValidOptionalAuthorityCarrier(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const carrier = value as Partial<CoopWaveTerminalAuthorityCarrierV2>;
  return (
    carrier.authoritativeState != null
    && typeof carrier.authoritativeState === "object"
    && !Array.isArray(carrier.authoritativeState)
    && carrier.transition != null
    && typeof carrier.transition === "object"
    && !Array.isArray(carrier.transition)
  );
}

// ---------------------------------------------------------------------------
// AUTHORITY: entry builders. Each returns an Omit<CoopAuthorityEntry, "revision">
// ready for CoopAuthorityLog.commit (which assigns the global revision). The
// builders THROW on malformed input - an authority must never commit a malformed
// entry into the ONE ledger.
// ---------------------------------------------------------------------------

export interface BuildWaveAdvanceEntryInput {
  /** The authenticated frame context stamped on the entry (from bindFrameContext). */
  readonly context: CoopFrameContextV2;
  /** The wire-safe operation identity (addresses receipts + lease owners). */
  readonly operationId: string;
  /** The COMPLETE stated transition. */
  readonly transition: CoopWaveTransitionMaterialV2;
  /** The canonical successor control (direct command/input surface or explicit ordered presentation wait). */
  readonly destination: CoopWaveAdvanceDestination;
  /**
   * Revisions this advance explicitly subsumes - the unretired same-wave
   * TURN/REPLACEMENT entries whose control surfaces the wave boundary makes moot.
   * Compute via {@link waveBoundarySubsumes} over the log's retained frontier.
   */
  readonly subsumes?: readonly number[];
}

/**
 * Build a WAVE_ADVANCE entry stating the complete transition as typed material
 * AND the canonical destination as nextControl. The destination is validated
 * structurally, is never a TERMINAL (that is {@link buildTerminalCommitEntry}'s
 * job), and - for a COMMAND destination - must address the NEXT wave, turn 1 (a
 * completeness check so a mis-addressed advance fails loud at build time).
 */
export function buildWaveAdvanceEntry(input: BuildWaveAdvanceEntryInput): Omit<CoopAuthorityEntry, "revision"> {
  const { context, operationId, transition, destination } = input;
  if (!isNonEmptyString(operationId)) {
    throw new CoopWaveTerminalBuildError("WAVE_ADVANCE operationId must be a non-empty string");
  }
  if (!isValidWaveTransitionMaterial(transition)) {
    throw new CoopWaveTerminalBuildError("WAVE_ADVANCE material is not a complete wave-transition");
  }
  // Runtime guard against a mistyped caller: the type excludes TERMINAL, but a control minted
  // dynamically could still carry it; a wave-advance never seals the session (that is the terminal builder).
  const destinationKind: string = (destination as ProjectableControl).kind;
  if (destinationKind === "TERMINAL") {
    throw new CoopWaveTerminalBuildError(`WAVE_ADVANCE destination cannot be TERMINAL (got ${destinationKind})`);
  }
  const validation = validateNextControl(destination);
  if (!validation.ok) {
    throw new CoopWaveTerminalBuildError(`WAVE_ADVANCE destination is malformed: ${validation.reason}`);
  }
  // The command frontier states the next wave, turn 1.
  if (destination.kind === "COMMAND_FRONTIER" && (destination.wave !== transition.nextWave || destination.turn !== 1)) {
    throw new CoopWaveTerminalBuildError(
      `WAVE_ADVANCE COMMAND_FRONTIER destination must address nextWave=${transition.nextWave} turn=1`
        + ` (got wave=${destination.wave} turn=${destination.turn})`,
    );
  }
  const subsumes = normalizeSubsumes(input.subsumes);
  const material: CoopAuthoritativeMaterial = {
    digest: digestOfMaterial(transition),
    payload: transition,
  };
  return {
    context,
    operationId,
    kind: "WAVE_ADVANCE",
    material,
    nextControl: destination,
    subsumes,
  };
}

export interface BuildTerminalCommitEntryInput {
  /** The authenticated frame context stamped on the entry. */
  readonly context: CoopFrameContextV2;
  /** The wire-safe operation identity. */
  readonly operationId: string;
  /** The stated terminal material. */
  readonly terminal: CoopTerminalMaterialV2;
  /**
   * Revisions this terminal explicitly subsumes - the final live events. A replica
   * holding a stale turn wait sees the terminal supersede it via this list; there
   * is NO abort predicate. Compute via {@link terminalSubsumes} over the retained
   * frontier.
   */
  readonly subsumes?: readonly number[];
}

/**
 * Build a TERMINAL_COMMIT entry whose nextControl is TERMINAL{terminalId}. The
 * committed terminal is the canonical successor of the final live events: it
 * subsumes them, so ordinary log order retires every stale turn/replacement wait
 * (the guest's impossible turn wait is cancelled by supersession, never by a
 * special abort). The terminalId in the material and in the nextControl must match.
 */
export function buildTerminalCommitEntry(input: BuildTerminalCommitEntryInput): Omit<CoopAuthorityEntry, "revision"> {
  const { context, operationId, terminal } = input;
  if (!isNonEmptyString(operationId)) {
    throw new CoopWaveTerminalBuildError("TERMINAL_COMMIT operationId must be a non-empty string");
  }
  if (!isValidTerminalMaterial(terminal)) {
    throw new CoopWaveTerminalBuildError("TERMINAL_COMMIT material is not a complete terminal");
  }
  const nextControl: CoopNextControl = { kind: "TERMINAL", terminalId: terminal.terminalId };
  const subsumes = normalizeSubsumes(input.subsumes);
  const material: CoopAuthoritativeMaterial = {
    digest: digestOfMaterial(terminal),
    payload: terminal,
  };
  return {
    context,
    operationId,
    kind: "TERMINAL_COMMIT",
    material,
    nextControl,
    subsumes,
  };
}

/** Dedupe + sort a subsumes list and reject any non-positive/duplicate revision (fail loud at build). */
function normalizeSubsumes(subsumes: readonly number[] | undefined): readonly number[] {
  if (subsumes == null || subsumes.length === 0) {
    return [];
  }
  const seen = new Set<number>();
  for (const revision of subsumes) {
    if (!isValidRevision(revision)) {
      throw new CoopWaveTerminalBuildError(`subsumes revision must be a positive safe integer (got ${revision})`);
    }
    seen.add(revision);
  }
  return [...seen].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Wave-boundary supersession helpers (pure, over a log's retained frontier).
// ---------------------------------------------------------------------------

/**
 * The wave an entry's stated control belongs to, or null when the control has no
 * wave coordinate (REWARD/BIOME/MYSTERY/TERMINAL are wave-agnostic boundaries,
 * and a null control has no successor). This is the ONLY non-opaque wave signal
 * on an arbitrary entry - the log never reads the material payload - so
 * same-wave supersession keys on it.
 */
export function entryControlWave(entry: CoopAuthorityEntry): number | null {
  const control = entry.nextControl;
  if (control == null) {
    return null;
  }
  return control.kind === "COMMAND_FRONTIER" || control.kind === "AWAIT_SUCCESSOR" ? control.wave : null;
}

/**
 * The revisions a WAVE_ADVANCE for `resolvedWave` subsumes: every unretired
 * TURN/REPLACEMENT entry whose stated control is still on the resolving wave.
 * The wave is over, so those in-wave command/replacement surfaces are moot -
 * ordinary log order retires them when the advance is admitted (no cross-
 * retention race, no phantom in-wave turn). Pass the log's `retained()` frontier.
 */
export function waveBoundarySubsumes(retained: readonly CoopAuthorityEntry[], resolvedWave: number): number[] {
  const revisions: number[] = [];
  for (const entry of retained) {
    if (entry.kind !== "TURN_COMMIT" && entry.kind !== "REPLACEMENT_COMMIT") {
      continue;
    }
    if (entryControlWave(entry) === resolvedWave) {
      revisions.push(entry.revision);
    }
  }
  return revisions.sort((a, b) => a - b);
}

/**
 * The revisions a TERMINAL_COMMIT subsumes: every unretired live gameplay event
 * (TURN/REPLACEMENT/INTERACTION/WAVE_ADVANCE) still on the retained frontier. The
 * terminal is the canonical successor of the final live events, so it supersedes
 * them all - a replica's stale turn wait is retired by log order, never by a
 * special abort predicate. An already-committed TERMINAL_COMMIT is excluded (a
 * terminal never subsumes another terminal). Pass the log's `retained()` frontier.
 */
export function terminalSubsumes(retained: readonly CoopAuthorityEntry[]): number[] {
  const revisions: number[] = [];
  for (const entry of retained) {
    if (entry.kind === "TERMINAL_COMMIT") {
      continue;
    }
    revisions.push(entry.revision);
  }
  return revisions.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// REPLICA: the applier seam. An ApplyMaterialFn (replica.ts) that ADOPTS the
// typed transition/terminal material through an injected sink and confirms the
// digest. The guest CONSTRUCTS its post-battle phases BY ADOPTION of this
// material (then applyEntry projects the stated nextControl) - never by
// derivation. Engine touching is funneled through the sink, exactly like the
// projector's ControlSurface seam, so the whole pipeline drives node-pure with a
// recording sink.
// ---------------------------------------------------------------------------

/**
 * The narrow seam the wave/terminal applier adopts material into. A real session
 * adapts its BattleScene run-state into this; the node-pure lane passes a
 * recording fake. `adopt*` is called ONLY after the material is proven complete
 * and its digest confirmed, so an implementation may assume well-formed input. It
 * must be idempotent (a redelivered entry re-adopts) and must NOT throw for a
 * benign re-adopt; a genuine engine failure MAY throw and is surfaced as
 * materialRejected by the pipeline.
 */
export interface CoopWaveTerminalSink {
  /** Adopt the complete wave transition into the replica's run state (wave/biome/egg/ME boundary). */
  adoptWaveTransition(ctx: CoopRuntimeContext, material: CoopWaveTransitionMaterialV2): void;
  /** Adopt the terminal into the replica's run state (install the shared freeze bookkeeping). */
  adoptTerminal(ctx: CoopRuntimeContext, material: CoopTerminalMaterialV2): void;
}

/**
 * Build the {@link ApplyMaterialFn} the replica pipeline (applyEntry) calls at the
 * materialApplied stage for WAVE_ADVANCE / TERMINAL_COMMIT entries. It:
 *   1. rejects a non-wave/terminal entry kind (this applier owns only those two);
 *   2. validates the payload is COMPLETE material of the matching discriminant;
 *   3. confirms the entry's material digest matches the recomputed digest (a
 *      redelivery can never smuggle a conflicting payload under an admitted rev);
 *   4. ADOPTS the material through the sink.
 * Returns false (materialApplied withheld) on any validation/digest failure; a
 * sink throw propagates and the pipeline classifies it materialRejected.
 */
export function createWaveTerminalApplier(sink: CoopWaveTerminalSink): ApplyMaterialFn {
  return (ctx: CoopRuntimeContext, entry: CoopAuthorityEntry): boolean => {
    if (!hasValidDigest(entry)) {
      return false;
    }
    if (entry.kind === "WAVE_ADVANCE") {
      return adoptWaveAdvance(ctx, entry, sink);
    }
    if (entry.kind === "TERMINAL_COMMIT") {
      return adoptTerminalCommit(ctx, entry, sink);
    }
    // Not an entry this applier owns.
    return false;
  };
}

/** Adopt a WAVE_ADVANCE entry: validate its complete transition + confirm digest, then adopt through the sink. */
function adoptWaveAdvance(ctx: CoopRuntimeContext, entry: CoopAuthorityEntry, sink: CoopWaveTerminalSink): boolean {
  const material = entry.material.payload;
  if (!isValidWaveTransitionMaterial(material) || digestOfMaterial(material) !== entry.material.digest) {
    return false;
  }
  sink.adoptWaveTransition(ctx, material);
  return true;
}

/** Adopt a TERMINAL_COMMIT entry: validate its terminal material, confirm digest + terminalId, then adopt. */
function adoptTerminalCommit(ctx: CoopRuntimeContext, entry: CoopAuthorityEntry, sink: CoopWaveTerminalSink): boolean {
  const material = entry.material.payload;
  if (!isValidTerminalMaterial(material) || digestOfMaterial(material) !== entry.material.digest) {
    return false;
  }
  // The stated TERMINAL control's terminalId must match the material's terminalId
  // (the freeze the projector installs and the freeze the guest adopts are the same).
  const control = entry.nextControl;
  if (control == null || control.kind !== "TERMINAL" || control.terminalId !== material.terminalId) {
    return false;
  }
  sink.adoptTerminal(ctx, material);
  return true;
}

// ---------------------------------------------------------------------------
// Shadow-parity seam. A pure descriptor of an entry's stated destination + a
// comparator, so a dual-run shadow can prove the AUTHORITATIVE statement equals
// what a legacy derivation WOULD have produced. Evidence gathering only - it
// never mutates and is never a second source of truth.
// ---------------------------------------------------------------------------

/**
 * A canonical, comparable descriptor of one WAVE_ADVANCE / TERMINAL_COMMIT entry:
 * the stated control address, the entry kind, and a compact material summary. Two
 * descriptors are parity-equal IFF the AUTHORITY and the SHADOW agree on the exact
 * destination + transition - which is what the dual-run parity check asserts.
 */
export interface CoopWaveTerminalShadow {
  readonly kind: CoopAuthorityEntry["kind"];
  /** The controlId of the stated successor, or null for a null control. */
  readonly controlId: string | null;
  /** The resolved/sealed wave (from the typed material), or null when it is not this adapter's material. */
  readonly wave: number | null;
  /** The wave the run advances to, or null for a terminal / foreign material. */
  readonly nextWave: number | null;
  /** A stable digest of the transition/terminal material (byte-identical across clients). */
  readonly materialDigest: string;
}

/**
 * Extract the shadow descriptor from a committed (or to-be-committed) WAVE_ADVANCE
 * / TERMINAL_COMMIT entry. Pure and total: it reads only the entry's own typed
 * material + stated control, so a shadow observer that INDEPENDENTLY built the same
 * entry from the legacy derivation produces a byte-equal descriptor iff they agree.
 */
export function shadowOfWaveTerminalEntry(entry: Omit<CoopAuthorityEntry, "revision">): CoopWaveTerminalShadow {
  const control = entry.nextControl;
  const controlId = control == null ? null : controlIdOf(control);
  const payload = entry.material.payload;
  if (entry.kind === "WAVE_ADVANCE" && isValidWaveTransitionMaterial(payload)) {
    return {
      kind: entry.kind,
      controlId,
      wave: payload.wave,
      nextWave: payload.nextWave,
      materialDigest: entry.material.digest,
    };
  }
  if (entry.kind === "TERMINAL_COMMIT" && isValidTerminalMaterial(payload)) {
    return {
      kind: entry.kind,
      controlId,
      wave: payload.wave,
      nextWave: null,
      materialDigest: entry.material.digest,
    };
  }
  return { kind: entry.kind, controlId, wave: null, nextWave: null, materialDigest: entry.material.digest };
}

/** A parity verdict; a mismatch names the first field that diverged (the evidence). */
export type CoopWaveTerminalParity = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Compare the AUTHORITY's shadow descriptor against a SHADOW observer's descriptor.
 * Equal IFF they agree on the entry kind, the stated control address, the wave
 * coordinates, and the material digest - i.e. the authoritative statement is
 * exactly what the shadow (derivation) would have produced. A divergence is
 * reported with the offending field so the dual-run harness can fail loud with
 * evidence, instead of the old "surfaced as an unrelated timeout" failure mode.
 */
export function checkWaveTerminalParity(
  authority: CoopWaveTerminalShadow,
  shadow: CoopWaveTerminalShadow,
): CoopWaveTerminalParity {
  if (authority.kind !== shadow.kind) {
    return { ok: false, reason: `kind ${authority.kind} != ${shadow.kind}` };
  }
  if (authority.controlId !== shadow.controlId) {
    return { ok: false, reason: `controlId ${authority.controlId} != ${shadow.controlId}` };
  }
  if (authority.wave !== shadow.wave) {
    return { ok: false, reason: `wave ${authority.wave} != ${shadow.wave}` };
  }
  if (authority.nextWave !== shadow.nextWave) {
    return { ok: false, reason: `nextWave ${authority.nextWave} != ${shadow.nextWave}` };
  }
  if (authority.materialDigest !== shadow.materialDigest) {
    return { ok: false, reason: `materialDigest ${authority.materialDigest} != ${shadow.materialDigest}` };
  }
  return { ok: true };
}
