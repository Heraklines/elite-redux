/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TELEMETRY HOOKS (#player-telemetry). The engine-coupled layer builds the solo human-policy contract
// and hands it to the engine-free recorder/queue. This is the ONLY telemetry module
// that touches the game; everything it calls (recorder / queue / store / state / transport) is testable
// without it.
//
// GATING: capture is enabled only when the build-time flag `VITE_TELEMETRY` is set. When it is unset,
// `initTelemetry` returns immediately, no listeners are installed, no
// store is opened, and every phase tap is a hard no-op. Schema v2 captures only committed solo combat
// commands and their resolved successors; it never subscribes to UI/raw-input events and fails closed in
// co-op, Showdown, and tournament modes. Production and staging use separate R2 bindings.
//
// SESSIONS: a telemetry session == one RUN. It begins LAZILY on the first in-run capture (keyed by the
// run seed) and switches when the seed changes (a new run), so no extra run-start/run-end tap is needed.
// Uploads are RARE (see telemetry-queue): every ~10 waves / ~15 min / ~256KB, plus a pagehide beacon;
// unflushed events are recovered on the next boot.
// =============================================================================

import { clientSessionId, loggedInUser } from "#app/account";
import { SESSION_ID_COOKIE_NAME } from "#app/constants";
import { ER_VERSION } from "#app/constants/app-constants";
import { globalScene } from "#app/global-scene";
import { captureCommittedCombatDecision, perspectiveTargetRef } from "#data/elite-redux/ai/combat-committed-action";
import {
  ER_COMBAT_CONTRACT_VERSION,
  type ErCombatAuxiliaryAction,
  type ErCombatBattleTerminal,
  type ErCombatCandidate,
  type ErCombatMonObservation,
  type ErCombatObservation,
  type ErCombatPreviousActionObservation,
  type ErCombatRewardComponents,
} from "#data/elite-redux/ai/combat-contract";
import {
  type ErCombatEarlierChoice,
  enumerateErCombatCandidates,
  snapshotErCombatJointActions,
  snapshotErCombatObservation,
} from "#data/elite-redux/ai/combat-engine-adapter";
import { isVersusSession } from "#data/elite-redux/coop/coop-runtime";
import { getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { isTournamentMatch } from "#data/elite-redux/showdown/tournament-match-context";
import {
  DEFAULT_TELEMETRY_QUEUE_CONFIG,
  TelemetryQueue,
  type TelemetryUpload,
} from "#data/elite-redux/telemetry/telemetry-queue";
import {
  beginTelemetrySession,
  endTelemetrySession,
  flushTelemetry,
  flushTelemetryBeacon,
  getTelemetrySession,
  maybeFlushTelemetry,
  recordTelemetryEvent,
} from "#data/elite-redux/telemetry/telemetry-recorder";
import type {
  TelemetryActor,
  TelemetryBattleTerminalEvent,
  TelemetryBiomeDecisionEvent,
  TelemetryCombatAuxiliaryDecisionEvent,
  TelemetryCombatContractEvent,
  TelemetryCombatTransitionEvent,
  TelemetryMode,
  TelemetryMysteryEncounterEvent,
  TelemetryRunOutcomeEvent,
  TelemetrySessionEnvelope,
} from "#data/elite-redux/telemetry/telemetry-schema";
import { TELEMETRY_SCHEMA_VERSION } from "#data/elite-redux/telemetry/telemetry-schema";
import {
  MemoryTelemetryStore,
  openIdbTelemetryStore,
  type TelemetryStore,
} from "#data/elite-redux/telemetry/telemetry-store";
import {
  resolvePlayerTelemetryBase,
  resolvePlayerTelemetryMode,
  sendTelemetryBatch,
  shouldCaptureHumanCombatTelemetry,
} from "#data/elite-redux/telemetry/telemetry-transport";
import { Command } from "#enums/command";
import { version } from "#package.json";
import { randomString } from "#utils/common";
import { getCookie } from "#utils/cookies";

// ---------------------------------------------------------------------------
// Module state (established once by initTelemetry when enabled).
// ---------------------------------------------------------------------------

let initialized = false;
let store: TelemetryStore | null = null;
let base: string | null = null;
let playerIdHash = "anon";
const combatDictionaryHash =
  (import.meta.env as { VITE_AI_DICTIONARY_HASH?: string }).VITE_AI_DICTIONARY_HASH ?? `unsealed-${version}`;
let combatJointActionId = "";
let combatEarlierChoices: ErCombatEarlierChoice[] = [];
let combatPendingObservation: ErCombatObservation | null = null;
let combatPendingDecisionIds: string[] = [];
const combatCapturedActorSlots = new Set<number>();
const combatKnownOpponentEntityIds = new Set<number>();
const combatRecordedBattleTerminals = new Set<string>();
const combatRecordedActionIds = new Set<string>();
const combatActionHistory: ErCombatPreviousActionObservation[] = [];
const combatPreparedDecisions = new Map<
  number,
  { jointActionId: string; observation: ErCombatObservation; candidates: ErCombatCandidate[] }
>();

/** Enabled only when the build-time flag is set. A non-empty, non-"off" value. */
export function isTelemetryEnabled(): boolean {
  const v = (import.meta.env as { VITE_TELEMETRY?: string }).VITE_TELEMETRY;
  return typeof v === "string" && v !== "" && v !== "0" && v !== "off";
}

/** The telemetry worker base URL (own env, else the save-API host), or null when unconfigured. */
function telemetryBase(): string | null {
  return resolvePlayerTelemetryBase(import.meta.env);
}

/** The upload closure the queue uses: reads the session token fresh (cookie) each send. Never throws. */
const upload: TelemetryUpload = (batch, useBeacon) =>
  base == null ? Promise.resolve(false) : sendTelemetryBatch(base, batch, getCookie(SESSION_ID_COOKIE_NAME), useBeacon);

/** SHA-256 hex (first 32 chars) of `input`, or a cheap fallback hash if subtle crypto is unavailable. */
async function sha256Hex(input: string): Promise<string> {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return [...new Uint8Array(buf)]
      .map(b => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 32);
  } catch {
    // FNV-1a fallback (non-crypto; still pseudonymous with the salt).
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }
}

/**
 * The pseudonymous, stable-per-account player id: a salted hash of the account username (or the per-session
 * random id for a guest / bypass-login client). NEVER the raw username. The salt is a build-time value
 * (`VITE_TELEMETRY_SALT`) so the hash is not reversible without it.
 */
async function computePlayerIdHash(): Promise<string> {
  const salt = (import.meta.env as { VITE_TELEMETRY_SALT?: string }).VITE_TELEMETRY_SALT ?? "er-telemetry-v1";
  const username = loggedInUser?.username;
  const accountKey = username && username !== "Guest" ? `acct:${username}` : `sess:${clientSessionId}`;
  return sha256Hex(`${salt}:${accountKey}`);
}

// ---------------------------------------------------------------------------
// Envelope + session management.
// ---------------------------------------------------------------------------

function currentMode(): TelemetryMode {
  let isCoop = false;
  try {
    isCoop = globalScene?.gameMode?.isCoop === true;
  } catch {
    isCoop = false;
  }
  return resolvePlayerTelemetryMode({
    isShowdown: isVersusSession(),
    isTournament: isTournamentMatch(),
    isCoop,
  });
}

function makeEnvelope(sessionId: string, mode: TelemetryMode, seed: string): TelemetrySessionEnvelope {
  const env: TelemetrySessionEnvelope = {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    combatContractVersion: ER_COMBAT_CONTRACT_VERSION,
    sessionId,
    playerIdHash,
    build: version,
    erVersion: ER_VERSION,
    mode,
    gameModeId: globalScene?.gameMode?.modeId ?? -1,
    seed,
    startWave: globalScene?.currentBattle?.waveIndex ?? 0,
    difficulty: safeDifficulty(),
    startedAt: Date.now(),
  };
  if (typeof navigator !== "undefined" && navigator.userAgent) {
    env.ua = navigator.userAgent.slice(0, 256);
  }
  return env;
}

function safeDifficulty(): string {
  try {
    return getErDifficulty();
  } catch {
    return "unknown";
  }
}

/**
 * Ensure a telemetry session exists for the CURRENT run (lazy begin, seed-keyed). Returns true when
 * recording is active afterward. Cheap no-op when telemetry is off (store == null) or no run is active.
 */
function ensureSession(): boolean {
  if (store == null || base == null) {
    return false; // telemetry not enabled / not initialized
  }
  const mode = currentMode();
  if (!shouldCaptureHumanCombatTelemetry(mode)) {
    endTelemetrySession();
    return false;
  }
  const seed = globalScene?.seed ?? "";
  if (seed === "" || globalScene?.currentBattle == null) {
    return false; // no active run yet
  }
  const cur = getTelemetrySession();
  if (cur != null && cur.seed === seed) {
    return true; // same run
  }
  // New run (or first capture): start a fresh session. The previous run is finalized immediately; its
  // durable local copy remains available to the next boot's recovery pass if that upload fails.
  endTelemetrySession();
  combatJointActionId = "";
  combatEarlierChoices = [];
  combatPendingObservation = null;
  combatPendingDecisionIds = [];
  combatCapturedActorSlots.clear();
  combatKnownOpponentEntityIds.clear();
  combatRecordedBattleTerminals.clear();
  combatRecordedActionIds.clear();
  combatActionHistory.length = 0;
  combatPreparedDecisions.clear();
  const env = makeEnvelope(randomString(24), mode, seed);
  const q = new TelemetryQueue(store, env, upload, DEFAULT_TELEMETRY_QUEUE_CONFIG);
  store.saveEnvelope(env).catch(() => {});
  beginTelemetrySession(env, q);
  return true;
}

export function recordTelemetryBiomeDecision(input: Omit<TelemetryBiomeDecisionEvent, "kind" | "t" | "wave">): void {
  try {
    if (!ensureSession() || currentMode() !== "solo") {
      return;
    }
    recordTelemetryEvent({
      ...input,
      kind: "biome_decision",
      t: Date.now(),
      wave: globalScene.currentBattle?.waveIndex ?? 0,
    });
  } catch {
    return;
  }
}

export function recordTelemetryMysteryEncounter(
  input: Omit<TelemetryMysteryEncounterEvent, "kind" | "t" | "wave">,
): void {
  try {
    if (!ensureSession() || currentMode() !== "solo") {
      return;
    }
    recordTelemetryEvent({
      ...input,
      kind: "mystery_encounter",
      t: Date.now(),
      wave: globalScene.currentBattle?.waveIndex ?? 0,
    });
  } catch {
    return;
  }
}

function currentJointActionId(sessionId: string): string {
  const battle = globalScene.currentBattle;
  return `${sessionId}:${battle.waveIndex}:${battle.battleSeed}:${battle.turn}`;
}

function enterCombatJointAction(jointActionId: string): void {
  if (jointActionId === combatJointActionId) {
    return;
  }
  combatJointActionId = jointActionId;
  combatEarlierChoices = [];
  combatPendingObservation = null;
  combatPendingDecisionIds = [];
  combatCapturedActorSlots.clear();
  combatPreparedDecisions.clear();
}

/**
 * Build the expensive immutable command snapshot before the input surface opens. The actual event is still
 * emitted only after handleCommand accepts a genuine human action, but damage previews never block that commit.
 */
export function prepareTelemetryDecision(fieldIndex: number): void {
  try {
    if (!ensureSession()) {
      return;
    }
    const session = getTelemetrySession();
    if (session == null || currentMode() !== "solo") {
      return;
    }
    const jointActionId = currentJointActionId(session.sessionId);
    enterCombatJointAction(jointActionId);
    if (combatPreparedDecisions.get(fieldIndex)?.jointActionId === jointActionId) {
      return;
    }
    globalScene.getEnemyField().forEach(mon => combatKnownOpponentEntityIds.add(mon.id));
    // Every active player slot in a double/triple chooses against the same
    // pre-turn field image. Reuse that immutable observation after slot 0 is
    // committed instead of rebuilding the complete party/ability/item state
    // for slots 1 and 2. Candidate legality remains per-slot below because
    // earlier switch/Tera choices can reserve options for later actors.
    const observation =
      combatPendingObservation
      ?? snapshotErCombatObservation(globalScene, {
        perspective: "player",
        knownOpponentEntityIds: combatKnownOpponentEntityIds,
        previousActions: combatActionHistory,
      });
    const candidates = enumerateErCombatCandidates(globalScene, fieldIndex, combatEarlierChoices, "player");
    combatPreparedDecisions.set(fieldIndex, { jointActionId, observation, candidates });
  } catch {
    /* telemetry preparation must never affect the command UI */
  }
}

// ---------------------------------------------------------------------------
// Phase taps (called from command-phase.ts + turn-end-phase.ts). Each gates hard + never throws.
// ---------------------------------------------------------------------------

function recordCombatContractDecision(
  fieldIndex: number,
  command: Command,
  cursor: number,
  actor: TelemetryActor,
): void {
  const session = getTelemetrySession();
  if (session == null || actor !== "self" || currentMode() !== "solo") {
    return;
  }
  const battle = globalScene.currentBattle;
  const jointActionId = currentJointActionId(session.sessionId);
  enterCombatJointAction(jointActionId);
  if (combatCapturedActorSlots.has(fieldIndex)) {
    return;
  }
  globalScene.getEnemyField().forEach(mon => combatKnownOpponentEntityIds.add(mon.id));
  const prepared = combatPreparedDecisions.get(fieldIndex);
  const captured = captureCommittedCombatDecision({
    scene: globalScene,
    perspective: "player",
    actorSlot: fieldIndex,
    jointActionId,
    earlier: combatEarlierChoices,
    policySource: "human-v1",
    policyTarget: true,
    knownOpponentEntityIds: combatKnownOpponentEntityIds,
    buildSha: (import.meta.env as { VITE_BUILD_SHA?: string }).VITE_BUILD_SHA ?? version,
    dexHash: combatDictionaryHash,
    dictionaryHash: combatDictionaryHash,
    episodeId: session.sessionId,
    splitGroupId: session.sessionId,
    sourcePartitionId: playerIdHash,
    ...(prepared?.jointActionId === jointActionId
      ? { observation: prepared.observation, candidates: prepared.candidates }
      : {}),
  });
  if (captured == null) {
    if (command !== Command.BALL && command !== Command.RUN) {
      return;
    }
    const observation =
      prepared?.jointActionId === jointActionId
        ? prepared.observation
        : snapshotErCombatObservation(globalScene, {
            perspective: "player",
            knownOpponentEntityIds: combatKnownOpponentEntityIds,
            previousActions: combatActionHistory,
          });
    const committed = battle.turnCommands[fieldIndex];
    const action: ErCombatAuxiliaryAction =
      command === Command.RUN
        ? { kind: "run" }
        : {
            kind: "ball",
            ballIndex: cursor,
            targets: (committed?.targets ?? [])
              .map(target => perspectiveTargetRef(globalScene, "player", target))
              .filter(target => target != null),
          };
    const decisionId = `${jointActionId}:${fieldIndex}`;
    const event: TelemetryCombatAuxiliaryDecisionEvent = {
      kind: "combat_auxiliary_decision",
      t: Date.now(),
      wave: battle.waveIndex,
      record: {
        kind: "combat_auxiliary_decision",
        schemaVersion: ER_COMBAT_CONTRACT_VERSION,
        candidateScope: "non-policy-battle-command",
        buildSha: (import.meta.env as { VITE_BUILD_SHA?: string }).VITE_BUILD_SHA ?? version,
        dexHash: combatDictionaryHash,
        dictionaryHash: combatDictionaryHash,
        episodeId: session.sessionId,
        sourcePartitionId: playerIdHash,
        jointActionId,
        decisionId,
        actorSlot: fieldIndex,
        policyTarget: false,
        observation,
        action,
      },
    };
    recordTelemetryEvent(event);
    combatPendingObservation ??= observation;
    combatPendingDecisionIds.push(decisionId);
    combatCapturedActorSlots.add(fieldIndex);
    combatPreparedDecisions.delete(fieldIndex);
    return;
  }
  const event: TelemetryCombatContractEvent = {
    kind: "combat_contract_decision",
    t: Date.now(),
    wave: battle.waveIndex,
    record: captured.record,
  };
  recordTelemetryEvent(event);
  combatPendingObservation ??= captured.record.observation;
  combatPendingDecisionIds.push(captured.record.decisionId);
  combatCapturedActorSlots.add(fieldIndex);
  combatPreparedDecisions.delete(fieldIndex);
  combatEarlierChoices.push({
    kind: captured.chosen.kind,
    id: captured.chosen.id,
    ...(captured.chosen.kind === "switch" ? { partyIndex: captured.chosen.partyIndex } : {}),
    ...(captured.chosen.kind === "move" ? { tera: captured.chosen.tera } : {}),
  });
}

function observationMons(observation: ErCombatObservation, side: "self" | "opponent"): ErCombatMonObservation[] {
  return side === "self" ? observation.selfParty : [...observation.opponentActive, ...observation.opponentKnownParty];
}

function transitionRewards(before: ErCombatObservation, after: ErCombatObservation): ErCombatRewardComponents {
  const beforeSelf = new Map(observationMons(before, "self").map(mon => [mon.entityId, mon]));
  const afterSelf = new Map(observationMons(after, "self").map(mon => [mon.entityId, mon]));
  const beforeOpponent = new Map(observationMons(before, "opponent").map(mon => [mon.entityId, mon]));
  const afterOpponent = new Map(observationMons(after, "opponent").map(mon => [mon.entityId, mon]));
  let damageDealtRatio = 0;
  let damageTaken = 0;
  let healingDealtRatio = 0;
  let healingReceived = 0;
  let statusChanges = 0;
  let selfFaints = 0;
  let opponentFaints = 0;
  let shieldSegmentsBroken = 0;

  for (const [entityId, prior] of beforeSelf) {
    const next = afterSelf.get(entityId);
    if (next == null) {
      continue;
    }
    if (prior.hp != null && next.hp != null) {
      damageTaken += Math.max(0, prior.hp - next.hp);
      healingReceived += Math.max(0, next.hp - prior.hp);
    }
    statusChanges += Number(prior.status !== next.status);
    selfFaints += Number(!prior.fainted && next.fainted);
  }
  for (const [entityId, prior] of beforeOpponent) {
    const next = afterOpponent.get(entityId);
    if (next == null) {
      continue;
    }
    if (prior.hpRatio != null && next.hpRatio != null) {
      damageDealtRatio += Math.max(0, prior.hpRatio - next.hpRatio);
      healingDealtRatio += Math.max(0, next.hpRatio - prior.hpRatio);
    }
    statusChanges += Number(prior.status !== next.status);
    opponentFaints += Number(!prior.fainted && next.fainted);
    shieldSegmentsBroken += Math.max(0, prior.boss.segmentIndex - next.boss.segmentIndex);
  }
  return {
    damageDealtRatio,
    damageTaken,
    healingDealtRatio,
    healingReceived,
    statusChanges,
    selfFaints,
    opponentFaints,
    shieldSegmentsBroken,
    terminal: 0,
  };
}

/**
 * Capture one genuinely committed solo human combat command. Partner/automatic/non-combat commands fail closed.
 */
export function recordTelemetryDecision(
  fieldIndex: number,
  command: Command,
  cursor: number,
  actor: TelemetryActor = "self",
): void {
  try {
    if (!ensureSession()) {
      return;
    }
    recordCombatContractDecision(fieldIndex, command, cursor, actor);
  } catch {
    /* telemetry must never affect gameplay */
  }
}

function structuredJointActions(phase: "committed" | "resolved"): ErCombatPreviousActionObservation[] {
  const session = getTelemetrySession();
  if (session == null) {
    return [];
  }
  const jointActionId = currentJointActionId(session.sessionId);
  return snapshotErCombatJointActions(globalScene, jointActionId, phase, combatActionHistory);
}

function appendStructuredJointActions(phase: "committed" | "resolved"): void {
  for (const action of structuredJointActions(phase)) {
    if (combatRecordedActionIds.has(action.actionId)) {
      continue;
    }
    combatRecordedActionIds.add(action.actionId);
    combatActionHistory.push(action);
  }
  if (combatActionHistory.length > 32) {
    combatActionHistory.splice(0, combatActionHistory.length - 32);
  }
}

/** Called once all player/enemy commands exist, before switches or moves mutate the field. */
export function recordTelemetryJointActionsCommitted(): void {
  try {
    if (!ensureSession() || currentMode() !== "solo") {
      return;
    }
    appendStructuredJointActions("committed");
  } catch {
    /* telemetry must never affect turn start */
  }
}

/**
 * Capture the resolved successor and reward components for the preceding committed joint action.
 */
function recordPendingTransition(battleTerminal: ErCombatBattleTerminal | null): string | null {
  const session = getTelemetrySession();
  if (session == null || combatPendingObservation == null || combatPendingDecisionIds.length === 0) {
    return null;
  }
  const resolvedObservation = snapshotErCombatObservation(globalScene, {
    perspective: "player",
    knownOpponentEntityIds: combatKnownOpponentEntityIds,
    previousActions: combatActionHistory,
  });
  const transitionId = `${combatJointActionId}:resolved`;
  const rewards = transitionRewards(combatPendingObservation, resolvedObservation);
  rewards.terminal =
    battleTerminal === "victory" || battleTerminal === "capture" || battleTerminal === "flee"
      ? 1
      : battleTerminal === "defeat"
        ? -1
        : 0;
  const event: TelemetryCombatTransitionEvent = {
    kind: "combat_contract_transition",
    t: Date.now(),
    wave: globalScene.currentBattle.waveIndex,
    record: {
      kind: "combat_transition",
      schemaVersion: ER_COMBAT_CONTRACT_VERSION,
      buildSha: (import.meta.env as { VITE_BUILD_SHA?: string }).VITE_BUILD_SHA ?? version,
      dexHash: combatDictionaryHash,
      dictionaryHash: combatDictionaryHash,
      episodeId: session.sessionId,
      jointActionId: combatJointActionId,
      transitionId,
      decisionIds: [...combatPendingDecisionIds],
      resolvedObservation,
      rewards,
      battleTerminal,
    },
  };
  recordTelemetryEvent(event);
  combatPendingObservation = null;
  combatPendingDecisionIds = [];
  return transitionId;
}

export function recordTelemetryTurnOutcome(): void {
  try {
    if (!ensureSession()) {
      return;
    }
    appendStructuredJointActions("resolved");
    recordPendingTransition(null);
    maybeFlushTelemetry(globalScene.currentBattle.waveIndex);
  } catch {
    /* swallow */
  }
}

/** Record one exact-once solo battle terminal; capture/flee are retained without becoming policy labels. */
export function recordTelemetryBattleTerminal(outcome: ErCombatBattleTerminal): void {
  try {
    if (!ensureSession()) {
      return;
    }
    const session = getTelemetrySession();
    if (session == null) {
      return;
    }
    const wave = globalScene.currentBattle.waveIndex;
    const battleId = `${session.sessionId}:${wave}:${globalScene.currentBattle.battleSeed}`;
    if (combatRecordedBattleTerminals.has(battleId)) {
      return;
    }
    appendStructuredJointActions("resolved");
    const transitionId = recordPendingTransition(outcome);
    const event: TelemetryBattleTerminalEvent = {
      kind: "battle_terminal",
      t: Date.now(),
      wave,
      outcome,
      record: {
        kind: "battle_terminal",
        schemaVersion: ER_COMBAT_CONTRACT_VERSION,
        buildSha: (import.meta.env as { VITE_BUILD_SHA?: string }).VITE_BUILD_SHA ?? version,
        dexHash: combatDictionaryHash,
        dictionaryHash: combatDictionaryHash,
        episodeId: session.sessionId,
        battleId,
        terminalId: `${battleId}:terminal`,
        wave,
        turn: globalScene.currentBattle.turn,
        outcome,
        jointActionId: combatJointActionId || null,
        transitionId,
      },
    };
    recordTelemetryEvent(event);
    combatRecordedBattleTerminals.add(battleId);
    maybeFlushTelemetry(wave);
  } catch {
    /* telemetry must never affect gameplay */
  }
}

/** Record a genuine solo run terminal; retries and Mystery Encounter recoveries call this only after resumption is ruled out. */
export function recordTelemetryRunOutcome(victory: boolean): void {
  try {
    recordTelemetryBattleTerminal(victory ? "victory" : "defeat");
    if (!ensureSession()) {
      return;
    }
    const session = getTelemetrySession();
    if (session == null) {
      return;
    }
    const finalWave = globalScene.currentBattle?.waveIndex ?? session.startWave ?? 0;
    const outcome = victory ? "victory" : "player-wiped";
    const event: TelemetryRunOutcomeEvent = {
      kind: "run_outcome",
      t: Date.now(),
      wave: finalWave,
      outcome,
      record: {
        kind: "run_terminal",
        schemaVersion: ER_COMBAT_CONTRACT_VERSION,
        buildSha: (import.meta.env as { VITE_BUILD_SHA?: string }).VITE_BUILD_SHA ?? version,
        dexHash: combatDictionaryHash,
        dictionaryHash: combatDictionaryHash,
        episodeId: session.sessionId,
        splitGroupId: session.sessionId,
        sourcePartitionId: playerIdHash,
        outcome,
        startWave: session.startWave ?? finalWave,
        finalWave,
        wavesCleared: Math.max(0, finalWave - (session.startWave ?? finalWave) + (victory ? 1 : 0)),
        truncated: false,
      },
    };
    recordTelemetryEvent(event);
    flushTelemetry(finalWave);
    endTelemetrySession();
  } catch {
    /* telemetry must never affect gameplay */
  }
}

/** Explicit title-return abandonment only; pagehide/reload never call this and remain incomplete sessions. */
export function recordTelemetryRunAbandonment(): void {
  try {
    const session = getTelemetrySession();
    if (session == null || currentMode() !== "solo") {
      return;
    }
    recordTelemetryBattleTerminal("abort");
    const finalWave = globalScene.currentBattle?.waveIndex ?? session.startWave ?? 0;
    const event: TelemetryRunOutcomeEvent = {
      kind: "run_outcome",
      t: Date.now(),
      wave: finalWave,
      outcome: "abandonment",
      record: {
        kind: "run_terminal",
        schemaVersion: ER_COMBAT_CONTRACT_VERSION,
        buildSha: (import.meta.env as { VITE_BUILD_SHA?: string }).VITE_BUILD_SHA ?? version,
        dexHash: combatDictionaryHash,
        dictionaryHash: combatDictionaryHash,
        episodeId: session.sessionId,
        splitGroupId: session.sessionId,
        sourcePartitionId: playerIdHash,
        outcome: "abandonment",
        startWave: session.startWave ?? finalWave,
        finalWave,
        wavesCleared: Math.max(0, finalWave - (session.startWave ?? finalWave)),
        truncated: false,
      },
    };
    recordTelemetryEvent(event);
    endTelemetrySession();
  } catch {
    /* telemetry must never affect gameplay */
  }
}

// ---------------------------------------------------------------------------
// Init (called once from main.ts, after startGame).
// ---------------------------------------------------------------------------

/**
 * Initialize the telemetry pipeline: open the durable store, install the pagehide/visibilitychange beacon,
 * and run boot recovery. Schema v2 deliberately installs no UI or raw-input observers.
 * A hard no-op unless the build-time flag is set AND an ingest endpoint is configured. Never throws.
 */
export async function initTelemetry(): Promise<void> {
  try {
    if (initialized) {
      return;
    }
    initialized = true;
    if (!isTelemetryEnabled()) {
      return;
    }
    base = telemetryBase();
    if (base == null) {
      return; // no ingest endpoint (local dev) - capture would have nowhere to go
    }
    playerIdHash = await computePlayerIdHash();
    store = (await openIdbTelemetryStore()) ?? new MemoryTelemetryStore();

    installLifecycleBeacon();
    await runBootRecovery();
  } catch {
    /* telemetry init must never break the game */
  }
}

function installLifecycleBeacon(): void {
  const beacon = (): void => {
    try {
      // Synchronous best-effort final send from the live queue's in-memory tail (pagehide has no time for
      // async work); anything not delivered is recovered from the durable store on the next boot.
      flushTelemetryBeacon();
    } catch {
      /* swallow */
    }
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        beacon();
      }
    });
  }
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", beacon);
  }
}

async function runBootRecovery(): Promise<void> {
  if (store == null || base == null) {
    return;
  }
  // A bootstrap queue whose OWN session id can't match any real session, so recover() only ships the
  // leftovers of PRIOR sessions (which carry their original envelopes from the store).
  const bootEnv = makeEnvelope("__recovery__", "solo", "");
  const q = new TelemetryQueue(store, bootEnv, upload, DEFAULT_TELEMETRY_QUEUE_CONFIG);
  await q.recover();
}
