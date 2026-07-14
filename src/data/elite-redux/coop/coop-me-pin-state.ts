/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op mystery-encounter interaction PIN (#633). The interaction counter the
// in-progress ME pinned on lives HERE - a leaf module with zero imports - so its
// readers (encounter-phase-utils, ui.ts, select-modifier-phase) never import the
// heavy `mystery-encounter-phases` phase module (which itself imports
// encounter-phase-utils: that edge was an import CYCLE). mystery-encounter-phases
// owns all the WRITES through the setter and re-exports the readers for its
// existing consumers.
// =============================================================================

import { type CoopMeTerminalPayload, parseCoopOperationId } from "#data/elite-redux/coop/coop-operation-envelope";
import { COOP_ME_TERM_SEQ_BASE } from "#data/elite-redux/coop/coop-seq-registry";
import type {
  CoopActiveMysteryEncounterSnapshotV1,
  CoopInteractionOutcome,
} from "#data/elite-redux/coop/coop-transport";

/** The interaction counter the in-progress ME pinned on, or -1 when not in an ME. */
let coopMeInteractionStart = -1;

/** Last host-owned Mystery control statement, retained through its terminal for snapshot recovery. */
let coopMeActiveControl: CoopActiveMysteryEncounterSnapshotV1 | null = null;

/** Presentation/terminal rebound hook registered by the guest replay phase (keeps this leaf cycle-free). */
let onMeSnapshotRebind: ((snapshot: CoopActiveMysteryEncounterSnapshotV1) => void) | null = null;

/** Complete journal terminal routed into the retained replay without a runtime -> phase import cycle. */
export interface CoopMeCommittedTerminalTransaction {
  readonly operationId: string;
  readonly pinned: number;
  readonly step: number;
  readonly payload: CoopMeTerminalPayload;
}

let onMeCommittedTerminal: ((transaction: CoopMeCommittedTerminalTransaction) => boolean) | null = null;
let onMeCommittedTerminalReady: ((transaction: CoopMeCommittedTerminalTransaction) => boolean) | null = null;

type CoopMePresentation = Extract<CoopInteractionOutcome, { k: "mePresent" }>;

export interface CoopMeTerminalIdentity {
  operationId: string;
  step: number;
  choice: number;
}

export interface CoopMeControlTransactionState {
  interactionStart: number;
  activeControl?: CoopActiveMysteryEncounterSnapshotV1 | undefined;
  handoffBattle: boolean;
  handoffWave: number;
  bespokeHost: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isSafeNonNegative(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isValidPresentation(value: unknown): value is CoopMePresentation {
  if (!isPlainObject(value) || value.k !== "mePresent" || !isPlainObject(value.tokens)) {
    return false;
  }
  if (
    !Object.values(value.tokens).every(token => typeof token === "string")
    || !Array.isArray(value.meetsReqs)
    || !value.meetsReqs.every(flag => typeof flag === "boolean")
    || !Array.isArray(value.labels)
    || !value.labels.every(label => typeof label === "string")
    || value.meetsReqs.length !== value.labels.length
  ) {
    return false;
  }
  const prompt = value.subPrompt;
  if (prompt == null) {
    return true;
  }
  if (!isPlainObject(prompt) || typeof prompt.kind !== "string") {
    return false;
  }
  if (prompt.kind === "party") {
    return Object.keys(prompt).every(key => key === "kind");
  }
  if (prompt.kind === "secondary") {
    return Array.isArray(prompt.labels) && prompt.labels.every(label => typeof label === "string");
  }
  if (prompt.kind === "catchFull") {
    return typeof prompt.pokemonName === "string";
  }
  if (prompt.kind !== "quiz" || typeof prompt.stopOnWrong !== "boolean" || !Array.isArray(prompt.questions)) {
    return false;
  }
  return prompt.questions.every(question => {
    if (!isPlainObject(question)) {
      return false;
    }
    const kind = question.kind;
    const answerIdAllowsSentinel = kind === "cipher" || kind === "braille" || kind === "item";
    if (
      (kind !== "silhouette"
        && kind !== "dex"
        && kind !== "footprint"
        && kind !== "cipher"
        && kind !== "braille"
        && kind !== "item")
      || (!isSafeNonNegative(question.answerId) && !(answerIdAllowsSentinel && question.answerId === -1))
      || !Array.isArray(question.options)
      || !question.options.every(isSafeNonNegative)
      || typeof question.prompt !== "string"
    ) {
      return false;
    }
    return (
      ["cipherWord", "itemIconFrame", "itemName", "itemId"].every(
        key => question[key] == null || typeof question[key] === "string",
      )
      && ["cipherOptions", "itemOptions"].every(
        key =>
          question[key] == null
          || (Array.isArray(question[key]) && question[key].every(option => typeof option === "string")),
      )
    );
  });
}

function isValidColosseumControl(value: unknown, interactionCounter: number): boolean {
  if (!isPlainObject(value) || !isSafeNonNegative(value.expectedRound) || value.expectedRound > 49) {
    return false;
  }
  if (
    value.boardRound != null
    && (!isSafeNonNegative(value.boardRound) || value.boardRound > 49 || value.boardRound !== value.expectedRound)
  ) {
    return false;
  }
  if (value.decision == null) {
    return true;
  }
  if (
    !isPlainObject(value.decision)
    || !isSafeNonNegative(value.decision.round)
    || value.decision.round !== value.boardRound
    || (value.decision.index !== 0 && value.decision.index !== 1)
    || typeof value.decision.operationId !== "string"
  ) {
    return false;
  }
  const parsed = parseCoopOperationId(value.decision.operationId);
  return (
    parsed?.kind === "COLO_PICK"
    && parsed.owner === interactionCounter % 2
    && parsed.pinnedSeq === interactionCounter * 100 + value.decision.round * 2 + 1
  );
}

function canonicalJson(value: unknown): string {
  if (value == null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

function activeControlsEqual(
  left: CoopActiveMysteryEncounterSnapshotV1,
  right: CoopActiveMysteryEncounterSnapshotV1,
): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

/** Once-only input gate for one exact committed ME_PRESENT identity. */
export class CoopMePresentationIntentGate {
  private identity: string | null = null;
  private settled = false;

  public bind(identity: string): boolean {
    if (this.identity === identity) {
      return false;
    }
    this.identity = identity;
    this.settled = false;
    return true;
  }

  public canSubmit(identity: string): boolean {
    return this.identity === identity && !this.settled;
  }

  public currentIdentity(): string | null {
    return this.identity;
  }

  public claim(identity: string): boolean {
    if (!this.canSubmit(identity)) {
      return false;
    }
    this.settled = true;
    return true;
  }
}

/** Strict wire-shape validation before any DATA or control-plane mutation. */
export function isValidCoopActiveMysteryControl(snapshot: unknown): snapshot is CoopActiveMysteryEncounterSnapshotV1 {
  if (
    !isPlainObject(snapshot)
    || snapshot.version !== 1
    || !isSafeNonNegative(snapshot.interactionCounter)
    || !isSafeNonNegative(snapshot.revision)
    || snapshot.revision < 1
    || !isSafeNonNegative(snapshot.round)
    || (snapshot.nextPickStep != null && (!isSafeNonNegative(snapshot.nextPickStep) || snapshot.nextPickStep > 999))
    || (snapshot.nextSubPickStep != null
      && (!isSafeNonNegative(snapshot.nextSubPickStep) || snapshot.nextSubPickStep > 999))
    || (snapshot.terminal !== "pending" && snapshot.terminal !== "leave" && snapshot.terminal !== "battle")
    || (snapshot.presentation != null && !isValidPresentation(snapshot.presentation))
    || (snapshot.colosseum != null
      && !isValidColosseumControl(snapshot.colosseum, snapshot.interactionCounter as number))
    || (snapshot.hostTurn != null && !isSafeNonNegative(snapshot.hostTurn))
    || (snapshot.handoffWave != null && !isSafeNonNegative(snapshot.handoffWave))
    || (snapshot.hostPhaseName != null && typeof snapshot.hostPhaseName !== "string")
  ) {
    return false;
  }
  if (snapshot.terminal === "pending") {
    return snapshot.terminalOperationId == null && snapshot.terminalStep == null && snapshot.terminalChoice == null;
  }
  const operation =
    typeof snapshot.terminalOperationId === "string" ? parseCoopOperationId(snapshot.terminalOperationId) : null;
  const expectedStep = isSafeNonNegative(snapshot.terminalStep) ? snapshot.terminalStep : -1;
  const expectedAddress = (COOP_ME_TERM_SEQ_BASE + snapshot.interactionCounter) * 8000 + 4000 + expectedStep;
  return (
    typeof snapshot.terminalOperationId === "string"
    && snapshot.terminalOperationId.length > 0
    && isSafeNonNegative(snapshot.terminalStep)
    && Number.isSafeInteger(snapshot.terminalChoice)
    && operation?.owner === 0
    && operation.kind === "ME_TERMINAL"
    && operation.pinnedSeq === expectedAddress
    && (snapshot.terminal === "battle" ? snapshot.terminalChoice === -1000 : snapshot.terminalChoice === -1)
    && (snapshot.terminal === "battle" || snapshot.hostTurn == null)
  );
}

/** Pure monotonic preflight; does not mutate pins or call the replay rebind hook. */
export function canRestoreCoopActiveMysteryControl(
  snapshot: unknown,
): snapshot is CoopActiveMysteryEncounterSnapshotV1 {
  if (!isValidCoopActiveMysteryControl(snapshot)) {
    return false;
  }
  if (
    coopMeInteractionStart > snapshot.interactionCounter
    || (coopMeActiveControl?.interactionCounter ?? -1) > snapshot.interactionCounter
  ) {
    return false;
  }
  if (coopMeActiveControl?.interactionCounter !== snapshot.interactionCounter) {
    return true;
  }
  if (snapshot.revision < coopMeActiveControl.revision) {
    return false;
  }
  if (snapshot.revision === coopMeActiveControl.revision) {
    return activeControlsEqual(coopMeActiveControl, snapshot);
  }
  if (
    (snapshot.nextPickStep ?? 0) < (coopMeActiveControl.nextPickStep ?? 0)
    || (snapshot.nextSubPickStep ?? 0) < (coopMeActiveControl.nextSubPickStep ?? 0)
    || (coopMeActiveControl.colosseum != null && snapshot.terminal === "pending" && snapshot.colosseum == null)
    || (snapshot.colosseum != null
      && coopMeActiveControl.colosseum != null
      && snapshot.colosseum.expectedRound < coopMeActiveControl.colosseum.expectedRound)
  ) {
    return false;
  }
  if (
    coopMeActiveControl.colosseum != null
    && snapshot.colosseum != null
    && snapshot.colosseum.expectedRound === coopMeActiveControl.colosseum.expectedRound
    && ((coopMeActiveControl.colosseum.boardRound != null && snapshot.colosseum.boardRound == null)
      || (coopMeActiveControl.colosseum.decision != null
        && canonicalJson(snapshot.colosseum.decision) !== canonicalJson(coopMeActiveControl.colosseum.decision)))
  ) {
    return false;
  }
  if (coopMeActiveControl.terminal === "leave" || snapshot.round < coopMeActiveControl.round) {
    return false;
  }
  if (snapshot.terminal === "pending") {
    return coopMeActiveControl.terminal === "pending";
  }
  if (coopMeActiveControl.terminal === "pending") {
    return snapshot.terminalStep === 0;
  }
  const sameTerminal =
    snapshot.terminal === coopMeActiveControl.terminal
    && snapshot.terminalOperationId === coopMeActiveControl.terminalOperationId
    && snapshot.terminalStep === coopMeActiveControl.terminalStep
    && snapshot.terminalChoice === coopMeActiveControl.terminalChoice;
  if (sameTerminal) {
    return (
      snapshot.hostTurn === coopMeActiveControl.hostTurn && snapshot.handoffWave === coopMeActiveControl.handoffWave
    );
  }
  return (
    coopMeActiveControl.terminal === "battle" && snapshot.terminalStep === (coopMeActiveControl.terminalStep ?? -1) + 1
  );
}

/** Mystery presentations are specified as plain JSON; clone at the state boundary to prevent UI mutation. */
function clonePresentation(presentation: CoopMePresentation | undefined): CoopMePresentation | undefined {
  if (presentation == null) {
    return;
  }
  return JSON.parse(JSON.stringify(presentation)) as CoopMePresentation;
}

function cloneActiveControl(snapshot: CoopActiveMysteryEncounterSnapshotV1): CoopActiveMysteryEncounterSnapshotV1 {
  return {
    ...snapshot,
    ...(snapshot.presentation == null ? {} : { presentation: clonePresentation(snapshot.presentation) }),
    ...(snapshot.colosseum == null
      ? {}
      : {
          colosseum: {
            ...snapshot.colosseum,
            ...(snapshot.colosseum.decision == null ? {} : { decision: { ...snapshot.colosseum.decision } }),
          },
        }),
  };
}

/** Whether a co-op mystery encounter is currently in progress (a pin is set). */
export function coopMeInProgress(): boolean {
  return coopMeInteractionStart >= 0;
}

/**
 * The interaction counter the in-progress ME pinned on (== `seq - COOP_ME_PUMP_SEQ_BASE`),
 * or -1 when not in an ME. The host's await-and-apply path + the engine sub-prompt relays
 * (encounter-phase-utils) and the host input block (ui.ts) read it to key their seq
 * channels onto the SAME pinned counter the pump opened on, never the live counter.
 */
export function coopMeInteractionStartValue(): number {
  return coopMeInteractionStart;
}

/** Write the ME pin (mystery-encounter-phases owns every call site). */
export function setCoopMeInteractionStart(counter: number): void {
  if (counter >= 0 && counter !== coopMeInteractionStart) {
    coopMeActiveControl = {
      version: 1,
      interactionCounter: counter,
      revision: 1,
      round: 0,
      nextPickStep: 0,
      nextSubPickStep: 0,
      terminal: "pending",
    };
  }
  coopMeInteractionStart = counter;
  if (counter < 0) {
    coopMeHandoffBattle = false; // the ME ended - the handoff exemption ends with it
    coopMeHandoffBattleWave = -1; // #847: the win-tail scope ends with the handoff
    coopMeBespokeHost = false; // #823: ditto for the bespoke host-drive window
    // #834: let the phase module drop its adopted host presentation with the pin (a mid-ME
    // GameOver reaches clearCoopRuntime without an ME terminal; a stale presentation must not
    // leak into the next run's first encounter). Registered by coop-replay-me-phase at load.
    try {
      onMePinCleared?.();
    } catch {
      /* a cleanup hook must never break the pin state */
    }
  }
}

/** Record the exact host-streamed selector/sub-screen for atomic snapshot and hot-rejoin recovery. */
export function setCoopMeActivePresentation(presentation: CoopMePresentation, retainBattleTerminal = false): void {
  if (coopMeInteractionStart < 0) {
    return;
  }
  const prior = coopMeActiveControl?.interactionCounter === coopMeInteractionStart ? coopMeActiveControl : undefined;
  if (prior?.terminal === "leave" || (prior?.terminal === "battle" && !retainBattleTerminal)) {
    return; // an async/late presentation can never regress an already-committed terminal
  }
  const nextControl: CoopActiveMysteryEncounterSnapshotV1 =
    prior?.terminal === "battle"
      ? {
          ...prior,
          revision: prior.revision + 1,
          round: prior.round + 1,
          presentation: clonePresentation(presentation),
        }
      : {
          version: 1,
          interactionCounter: coopMeInteractionStart,
          revision: (prior?.revision ?? 0) + 1,
          round: (prior?.round ?? -1) + 1,
          nextPickStep: prior?.nextPickStep ?? 0,
          nextSubPickStep: prior?.nextSubPickStep ?? 0,
          terminal: "pending",
          presentation: clonePresentation(presentation),
          ...(coopMeHandoffBattleWave < 0 ? {} : { handoffWave: coopMeHandoffBattleWave }),
        };
  if (isValidCoopActiveMysteryControl(nextControl)) {
    coopMeActiveControl = nextControl;
  }
}

/** Advance host-confirmed guest intent ordinals without allowing a reconnect snapshot to reset them. */
export function setCoopMeOwnerIntentOrdinals(pinned: number, nextPickStep?: number, nextSubPickStep?: number): void {
  if (coopMeActiveControl?.interactionCounter !== pinned || coopMeActiveControl.terminal !== "pending") {
    return;
  }
  if (
    (nextPickStep != null && (!isSafeNonNegative(nextPickStep) || nextPickStep > 999))
    || (nextSubPickStep != null && (!isSafeNonNegative(nextSubPickStep) || nextSubPickStep > 999))
  ) {
    return;
  }
  const pick = Math.max(coopMeActiveControl.nextPickStep ?? 0, nextPickStep ?? 0);
  const sub = Math.max(coopMeActiveControl.nextSubPickStep ?? 0, nextSubPickStep ?? 0);
  if (pick === (coopMeActiveControl.nextPickStep ?? 0) && sub === (coopMeActiveControl.nextSubPickStep ?? 0)) {
    return;
  }
  coopMeActiveControl = {
    ...coopMeActiveControl,
    revision: coopMeActiveControl.revision + 1,
    nextPickStep: pick,
    nextSubPickStep: sub,
  };
}

/** Retain the exact Colosseum board/decision cursor for hot-rejoin. */
export function setCoopMeColosseumControl(
  pinned: number,
  colosseum: NonNullable<CoopActiveMysteryEncounterSnapshotV1["colosseum"]>,
): boolean {
  if (
    coopMeActiveControl?.interactionCounter !== pinned
    || (coopMeActiveControl.terminal !== "pending" && coopMeActiveControl.terminal !== "battle")
    || !isValidColosseumControl(colosseum, pinned)
  ) {
    return false;
  }
  const current = coopMeActiveControl.colosseum;
  if (current != null && colosseum.expectedRound < current.expectedRound) {
    return false;
  }
  if (current != null && canonicalJson(current) === canonicalJson(colosseum)) {
    return true;
  }
  coopMeActiveControl = {
    ...coopMeActiveControl,
    revision: coopMeActiveControl.revision + 1,
    colosseum: {
      ...colosseum,
      ...(colosseum.decision == null ? {} : { decision: { ...colosseum.decision } }),
    },
  };
  return true;
}

/** Exact host authority used by the retained replay after hot rejoin. */
export function resolveCoopMeOwnerIntentRebind(
  snapshot: CoopActiveMysteryEncounterSnapshotV1,
  localPickStep: number,
): { pickStep: number; subPickStep: number; retryUncommittedPick: boolean } {
  const pickStep = snapshot.nextPickStep ?? 0;
  return {
    pickStep,
    subPickStep: snapshot.nextSubPickStep ?? 0,
    retryUncommittedPick: localPickStep > pickStep,
  };
}

/** Record an exact host terminal before it is put on the 9M carrier. Null/timeout never calls this seam. */
export function setCoopMeTerminalControl(
  terminal: "leave" | "battle",
  hostTurn?: number,
  identity?: CoopMeTerminalIdentity,
): void {
  if (coopMeInteractionStart < 0) {
    return;
  }
  // A terminal without its committed causal identity is never durable control. Legacy raw terminal
  // messages may still wake a compatibility waiter, but cannot author an atomic recovery snapshot.
  if (identity == null || identity.operationId.length === 0 || !isSafeNonNegative(identity.step)) {
    return;
  }
  const prior = coopMeActiveControl?.interactionCounter === coopMeInteractionStart ? coopMeActiveControl : undefined;
  if (prior?.terminal !== undefined && prior.terminal !== "pending") {
    const exactDuplicate =
      prior.terminal === terminal
      && prior.terminalOperationId === identity.operationId
      && prior.terminalStep === identity.step
      && prior.terminalChoice === identity.choice;
    if (exactDuplicate) {
      return;
    }
    if (prior.terminal === "leave" || identity.step !== (prior.terminalStep ?? -1) + 1) {
      return; // leave is final; every new battle/leave after a battle consumes the next exact step
    }
  } else if (identity.step !== 0) {
    return;
  }
  const nextControl: CoopActiveMysteryEncounterSnapshotV1 = {
    version: 1,
    interactionCounter: coopMeInteractionStart,
    revision: (coopMeActiveControl?.revision ?? 0) + 1,
    round: coopMeActiveControl?.round ?? 0,
    terminal,
    nextPickStep: coopMeActiveControl?.nextPickStep ?? 0,
    nextSubPickStep: coopMeActiveControl?.nextSubPickStep ?? 0,
    terminalOperationId: identity.operationId,
    terminalStep: identity.step,
    terminalChoice: identity.choice,
    ...(hostTurn === undefined ? {} : { hostTurn }),
    ...(coopMeHandoffBattleWave < 0 ? {} : { handoffWave: coopMeHandoffBattleWave }),
    ...(coopMeActiveControl?.presentation == null
      ? {}
      : { presentation: clonePresentation(coopMeActiveControl.presentation) }),
    ...(coopMeActiveControl?.colosseum == null
      ? {}
      : {
          colosseum: {
            ...coopMeActiveControl.colosseum,
            ...(coopMeActiveControl.colosseum.decision == null
              ? {}
              : { decision: { ...coopMeActiveControl.colosseum.decision } }),
          },
        }),
  };
  if (!isValidCoopActiveMysteryControl(nextControl)) {
    return;
  }
  coopMeActiveControl = nextControl;
}

/** Capture the durable Mystery control statement for CoopActiveControlSnapshotV1. */
export function captureCoopActiveMysteryControl(): CoopActiveMysteryEncounterSnapshotV1 | undefined {
  return coopMeActiveControl == null ? undefined : cloneActiveControl(coopMeActiveControl);
}

/**
 * Adopt a checksum-verified host Mystery control statement. The registered replay hook performs only
 * presentation/terminal rebound; this leaf never imports UI, phases, or the co-op runtime.
 */
function restoreCoopActiveMysteryControlInternal(
  snapshot: CoopActiveMysteryEncounterSnapshotV1 | undefined,
  rebind: boolean,
): boolean {
  if (!canRestoreCoopActiveMysteryControl(snapshot)) {
    return false;
  }
  if (
    coopMeActiveControl?.interactionCounter === snapshot.interactionCounter
    && snapshot.revision === coopMeActiveControl.revision
  ) {
    try {
      if (rebind) {
        onMeSnapshotRebind?.(cloneActiveControl(snapshot));
      }
      return true; // exact idempotent rebind after a channel replacement
    } catch {
      return false;
    }
  }
  const priorControl = coopMeActiveControl;
  const priorStart = coopMeInteractionStart;
  const priorHandoff = coopMeHandoffBattle;
  const priorHandoffWave = coopMeHandoffBattleWave;
  coopMeActiveControl = cloneActiveControl(snapshot);
  if (snapshot.terminal !== "leave") {
    coopMeInteractionStart = snapshot.interactionCounter;
    coopMeHandoffBattle = snapshot.terminal === "battle";
    coopMeHandoffBattleWave = snapshot.handoffWave ?? -1;
  }
  try {
    if (rebind) {
      onMeSnapshotRebind?.(cloneActiveControl(snapshot));
    }
  } catch {
    coopMeActiveControl = priorControl;
    coopMeInteractionStart = priorStart;
    coopMeHandoffBattle = priorHandoff;
    coopMeHandoffBattleWave = priorHandoffWave;
    return false;
  }
  return true;
}

export function restoreCoopActiveMysteryControl(snapshot: CoopActiveMysteryEncounterSnapshotV1 | undefined): boolean {
  return restoreCoopActiveMysteryControlInternal(snapshot, true);
}

/** Transactional state commit without presentation mutation; rebind only after all controls commit. */
export function restoreCoopActiveMysteryControlWithoutRebind(
  snapshot: CoopActiveMysteryEncounterSnapshotV1 | undefined,
): boolean {
  return restoreCoopActiveMysteryControlInternal(snapshot, false);
}

/** Separately fenced post-commit UI/presentation rebind. */
export function rebindCoopActiveMysteryControl(snapshot: CoopActiveMysteryEncounterSnapshotV1): boolean {
  if (coopMeActiveControl == null || !activeControlsEqual(coopMeActiveControl, snapshot)) {
    return false;
  }
  try {
    onMeSnapshotRebind?.(cloneActiveControl(snapshot));
    return true;
  } catch {
    return false;
  }
}

/** Register the guest replay's presentation/terminal rebound hook. Last registration wins. */
export function setOnMeSnapshotRebind(
  fn: ((snapshot: CoopActiveMysteryEncounterSnapshotV1) => void) | null,
): () => void {
  const previous = onMeSnapshotRebind;
  onMeSnapshotRebind = fn;
  return () => {
    if (onMeSnapshotRebind === fn) {
      onMeSnapshotRebind = previous;
    }
  };
}

/**
 * Register the only executable ME-terminal projection. The durability sink returns false when no replay
 * boundary is retained yet, keeping the operation unacknowledged for late-phase/rejoin redelivery.
 */
export function setOnMeCommittedTerminal(
  fn: ((transaction: CoopMeCommittedTerminalTransaction) => boolean) | null,
  ready: ((transaction: CoopMeCommittedTerminalTransaction) => boolean) | null = null,
): () => void {
  const previous = onMeCommittedTerminal;
  const previousReady = onMeCommittedTerminalReady;
  onMeCommittedTerminal = fn;
  onMeCommittedTerminalReady = ready;
  return () => {
    if (onMeCommittedTerminal === fn) {
      onMeCommittedTerminal = previous;
      onMeCommittedTerminalReady = previousReady;
    }
  };
}

/** Preflight the live replay/scene boundary before a comprehensive state image is applied. */
export function canMaterializeCoopMeCommittedTerminal(transaction: CoopMeCommittedTerminalTransaction): boolean {
  return onMeCommittedTerminalReady?.(transaction) === true;
}

/** Synchronously materialize terminal control; true means the exact destination is now executable. */
export function materializeCoopMeCommittedTerminal(transaction: CoopMeCommittedTerminalTransaction): boolean {
  return onMeCommittedTerminal?.(transaction) === true;
}

/** Session-boundary purge; unlike a normal ME terminal, no prior terminal may survive a new epoch. */
export function resetCoopActiveMysteryControl(): void {
  coopMeActiveControl = null;
}

/** Two-engine harness context swap: restore module state without firing a production rejoin rebound. */
export function restoreCoopActiveMysteryControlForHarness(
  snapshot: CoopActiveMysteryEncounterSnapshotV1 | undefined,
): void {
  coopMeActiveControl = snapshot == null ? null : cloneActiveControl(snapshot);
}

/** Harness context swap: raw pin restore that never fires the other client's pin-clear hook/timer. */
export function restoreCoopMeInteractionStartForHarness(counter: number): void {
  coopMeInteractionStart = counter;
}

/** Capture every Mystery control scalar for an atomic full-snapshot rollback. */
export function captureCoopMeControlTransactionState(): CoopMeControlTransactionState {
  return {
    interactionStart: coopMeInteractionStart,
    activeControl: captureCoopActiveMysteryControl(),
    handoffBattle: coopMeHandoffBattle,
    handoffWave: coopMeHandoffBattleWave,
    bespokeHost: coopMeBespokeHost,
  };
}

/** Raw rollback: deliberately fires no UI rebind/pin-clear hook. */
export function restoreCoopMeControlTransactionState(state: CoopMeControlTransactionState): void {
  coopMeInteractionStart = state.interactionStart;
  coopMeActiveControl = state.activeControl == null ? null : cloneActiveControl(state.activeControl);
  coopMeHandoffBattle = state.handoffBattle;
  coopMeHandoffBattleWave = state.handoffWave;
  coopMeBespokeHost = state.bespokeHost;
}

// #817 (live BOTH-frozen at the ME battle): once an ME option SPAWNS A BATTLE, the ME pin
// stays set through the fight (the post-battle rewards/terminal still key off it), but the
// ui.ts input/stream gates MUST stand down - they are selector-era gates, and leaving them
// up froze the battle's command UI on both clients while its messages streamed down the
// (already-closed) ME narration channel. This flag marks "the handoff battle has started".
let coopMeHandoffBattle = false;

// #847: the wave the handoff battle started on, so the guest's ME-battle-won victory-tail check can be
// SCOPED to that exact battle. A stale handoff flag (an ME whose terminal never cleared it, or - under
// vitest `isolate:false` - module state latched across a test-file boundary) must not be able to misfire
// the victory tail on an UNRELATED later battle at a different wave. -1 when no handoff battle is live.
let coopMeHandoffBattleWave = -1;

/** Whether the in-progress ME has handed off to its spawned battle (#817). */
export function coopMeHandoffBattleStarted(): boolean {
  return coopMeHandoffBattle;
}

/** #847: the wave the handoff battle started on (-1 when none), for scoping the ME-battle-won check. */
export function coopMeHandoffBattleWaveValue(): number {
  return coopMeHandoffBattleWave;
}

// #823: a BESPOKE mini-game ME (quiz/braille/footprints...) is running on the HOST while the
// GUEST owns the encounter. The old 'safe-degrade' DISCARDED the pick and force-left (the
// Dormant Guardian strand); until the mirroring epic lands, the host drives the mini-game
// for real - this flag stands the host input gate down so it actually can.
let coopMeBespokeHost = false;

/** Whether a bespoke ME mini-game is being driven by the host right now (#823). */
export function coopMeBespokeHostDrives(): boolean {
  return coopMeBespokeHost;
}

/** Mark/clear the bespoke host-drive window (#823). */
export function setCoopMeBespokeHostDrives(on: boolean): void {
  coopMeBespokeHost = on;
}

// #834: cleanup hook invoked whenever the ME pin clears (counter -> -1). Lets higher modules
// (the replay phase's adopted presentation) reset alongside the pin without an import cycle.
let onMePinCleared: (() => void) | null = null;

/** Register the pin-cleared cleanup hook (#834). Last registration wins. */
export function setOnMePinCleared(fn: (() => void) | null): void {
  onMePinCleared = fn;
}

/**
 * Mark the ME battle handoff as started (host pump end + guest terminal set this). `wave` is the wave the
 * spawned battle runs on (#847), recorded so the guest's ME-battle-won victory-tail check is SCOPED to
 * this battle - a stale flag can never misfire the tail on a later, unrelated battle. Defaults to -1 for
 * callers that don't have the wave handy (the host side, which never runs the guest-only win check).
 */
export function setCoopMeHandoffBattleStarted(wave = -1): void {
  coopMeHandoffBattle = true;
  coopMeHandoffBattleWave = wave;
}

/**
 * Restore the complete handoff flag for a separately-pumped client context. Production has one module graph
 * per browser; the two-engine harness swaps this process-global state alongside the ME interaction pins.
 */
export function restoreCoopMeHandoffBattleState(started: boolean, wave = -1): void {
  coopMeHandoffBattle = started;
  coopMeHandoffBattleWave = started ? wave : -1;
}
