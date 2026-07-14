/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TELEMETRY HOOKS (#player-telemetry). The engine-coupled layer: it reads globalScene + the coop runtime,
// builds events, and hands them to the (engine-free) recorder/queue. This is the ONLY telemetry module
// that touches the game; everything it calls (recorder / queue / store / state / transport) is testable
// without it.
//
// GATING: capture is enabled only when the build-time flag `VITE_TELEMETRY` is set (staging build). When
// it is unset (production / local), `initTelemetry` returns immediately, no listeners are installed, no
// store is opened, and every phase tap is a hard no-op (the observer emits in ui.ts / command-phase.ts /
// turn-end-phase.ts have no listener), so the build is behavior-identical + free. Designed so a future
// PROD enablement is a one-line flag flip (set VITE_TELEMETRY=prod + bind the R2 bucket).
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
import { getCoopController, isVersusSession } from "#data/elite-redux/coop/coop-runtime";
import type { CoopRole } from "#data/elite-redux/coop/coop-transport";
import { getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import {
  DEFAULT_TELEMETRY_QUEUE_CONFIG,
  TelemetryQueue,
  type TelemetryUpload,
} from "#data/elite-redux/telemetry/telemetry-queue";
import {
  beginTelemetrySession,
  endTelemetrySession,
  flushTelemetryBeacon,
  getTelemetrySession,
  isTelemetryRecording,
  maybeFlushTelemetry,
  recordTelemetryEvent,
} from "#data/elite-redux/telemetry/telemetry-recorder";
import type {
  TelemetryActor,
  TelemetryBattleAction,
  TelemetryBattleDecisionEvent,
  TelemetryInputEvent,
  TelemetryMode,
  TelemetrySessionEnvelope,
  TelemetrySurfaceChoiceEvent,
  TelemetrySurfaceOpenEvent,
  TelemetryTurnOutcomeEvent,
} from "#data/elite-redux/telemetry/telemetry-schema";
import { TELEMETRY_SCHEMA_VERSION } from "#data/elite-redux/telemetry/telemetry-schema";
import { snapshotBattleState, type TelemetryMonSource } from "#data/elite-redux/telemetry/telemetry-state";
import {
  MemoryTelemetryStore,
  openIdbTelemetryStore,
  type TelemetryStore,
} from "#data/elite-redux/telemetry/telemetry-store";
import { sendTelemetryBatch } from "#data/elite-redux/telemetry/telemetry-transport";
import { Command } from "#enums/command";
import { UiMode } from "#enums/ui-mode";
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
/** The uiMode of the most recently opened surface, so a choice event can attribute its uiMode. */
let lastSurfaceMode = -1;

/** Enabled only when the build-time flag is set (staging on / prod+local off). A non-empty, non-"off" value. */
export function isTelemetryEnabled(): boolean {
  const v = (import.meta.env as { VITE_TELEMETRY?: string }).VITE_TELEMETRY;
  return typeof v === "string" && v !== "" && v !== "0" && v !== "off";
}

/** The telemetry worker base URL (own env, else the save-API host), or null when unconfigured. */
function telemetryBase(): string | null {
  const env = import.meta.env as { VITE_SERVER_URL_TELEMETRY?: string; VITE_SERVER_URL?: string };
  const url = env.VITE_SERVER_URL_TELEMETRY ?? env.VITE_SERVER_URL ?? "";
  return url ? url.replace(/\/$/, "") : null;
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
  try {
    if (isVersusSession()) {
      return "showdown";
    }
    if (globalScene?.gameMode?.isCoop) {
      return "coop";
    }
  } catch {
    /* fall through to solo */
  }
  return "solo";
}

function makeEnvelope(sessionId: string, mode: TelemetryMode, seed: string): TelemetrySessionEnvelope {
  const env: TelemetrySessionEnvelope = {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    sessionId,
    playerIdHash,
    build: version,
    erVersion: ER_VERSION,
    mode,
    gameModeId: globalScene?.gameMode?.modeId ?? -1,
    seed,
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
  const seed = globalScene?.seed ?? "";
  if (seed === "" || globalScene?.currentBattle == null) {
    return false; // no active run yet
  }
  const cur = getTelemetrySession();
  if (cur != null && cur.seed === seed) {
    return true; // same run
  }
  // New run (or first capture): start a fresh session. The previous run's unflushed events stay durable
  // and are shipped by the next boot's recovery pass.
  endTelemetrySession();
  const env = makeEnvelope(randomString(24), currentMode(), seed);
  const q = new TelemetryQueue(store, env, upload, DEFAULT_TELEMETRY_QUEUE_CONFIG);
  void store.saveEnvelope(env);
  beginTelemetrySession(env, q);
  return true;
}

// ---------------------------------------------------------------------------
// Field-state snapshot helpers.
// ---------------------------------------------------------------------------

/** Resolve the co-op actor (self/partner) that owns a player-side mon, or undefined outside co-op. */
function makeOwnerResolver(): ((mon: TelemetryMonSource) => TelemetryActor | undefined) | undefined {
  let me: CoopRole | undefined;
  try {
    me = getCoopController()?.role;
  } catch {
    me = undefined;
  }
  if (me == null) {
    return;
  }
  return (mon: TelemetryMonSource) => {
    const owner = (mon as { coopOwner?: CoopRole }).coopOwner;
    if (owner == null) {
      return;
    }
    return owner === me ? "self" : "partner";
  };
}

function snapshotState() {
  const arena = globalScene.arena;
  return snapshotBattleState(
    globalScene.getPlayerField() as unknown as TelemetryMonSource[],
    globalScene.getEnemyField() as unknown as TelemetryMonSource[],
    {
      wave: globalScene.currentBattle?.waveIndex ?? 0,
      biome: arena?.biomeId ?? -1,
      turn: globalScene.currentBattle?.turn ?? 0,
      weather: arena?.weather?.weatherType ?? null,
      terrain: arena?.terrain?.terrainType ?? null,
    },
    makeOwnerResolver(),
  );
}

/** Map a committed CommandPhase decision to the ACTION half of the (state, action) pair. */
function buildAction(fieldIndex: number, command: Command, cursor: number): TelemetryBattleAction | null {
  switch (command) {
    case Command.FIGHT:
    case Command.TERA: {
      const committed = globalScene.currentBattle?.turnCommands?.[fieldIndex];
      const moveId =
        committed?.move?.move ?? globalScene.getPlayerField()[fieldIndex]?.getMoveset()?.[cursor]?.moveId ?? -1;
      const target = committed?.move?.targets?.[0];
      const action: TelemetryBattleAction = { kind: "move", moveIndex: cursor, moveId };
      if (target != null) {
        action.target = target;
      }
      return action;
    }
    case Command.POKEMON:
      return { kind: "switch", partyIndex: cursor };
    case Command.BALL:
      return { kind: "ball", ballIndex: cursor };
    case Command.RUN:
      return { kind: "run" };
    default:
      return null; // SHIFT / other non-decisions are not (state, action) training pairs
  }
}

// ---------------------------------------------------------------------------
// Phase taps (called from command-phase.ts + turn-end-phase.ts). Each gates hard + never throws.
// ---------------------------------------------------------------------------

/**
 * Capture one battle decision as a (state, action) training pair. `actor` = "self" for this client's own
 * committed command (all modes), "partner" for an observed co-op partner command. No-op unless recording.
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
    const action = buildAction(fieldIndex, command, cursor);
    if (action == null) {
      return;
    }
    const event: TelemetryBattleDecisionEvent = {
      kind: "battle_decision",
      t: Date.now(),
      wave: globalScene.currentBattle?.waveIndex ?? 0,
      actor,
      slotFieldIndex: fieldIndex,
      state: snapshotState(),
      action,
    };
    recordTelemetryEvent(event);
  } catch {
    /* telemetry must never affect gameplay */
  }
}

/**
 * Capture the resolved field OUTCOME at turn end (both sides' state + which slots fainted), so state
 * transitions are learnable. Also drives the boundary flush check. No-op unless recording.
 */
export function recordTelemetryTurnOutcome(): void {
  try {
    if (!ensureSession()) {
      return;
    }
    const state = snapshotState();
    const faints = [
      ...state.player.map((m, i) => (m.fainted ? `p${i}` : null)),
      ...state.enemy.map((m, i) => (m.fainted ? `e${i}` : null)),
    ].filter((s): s is string => s != null);
    const event: TelemetryTurnOutcomeEvent = {
      kind: "turn_outcome",
      t: Date.now(),
      wave: state.wave,
      turn: state.turn,
      state,
      faints,
    };
    recordTelemetryEvent(event);
    maybeFlushTelemetry(state.wave);
  } catch {
    /* swallow */
  }
}

// ---------------------------------------------------------------------------
// UI surface / input observers (subscribed to the ui.ts / option-select emits).
// ---------------------------------------------------------------------------

function recordSurfaceOpen(mode: number, args: unknown[]): void {
  try {
    if (!ensureSession()) {
      return;
    }
    lastSurfaceMode = mode;
    const config = args?.[0] as { options?: { label?: unknown }[] } | undefined;
    const options = Array.isArray(config?.options) ? config.options.map(o => String(o?.label ?? "")).slice(0, 32) : [];
    const event: TelemetrySurfaceOpenEvent = {
      kind: "surface_open",
      t: Date.now(),
      wave: globalScene.currentBattle?.waveIndex ?? 0,
      uiMode: mode,
      uiModeName: UiMode[mode] ?? String(mode),
      options,
      actor: surfaceActor(),
    };
    recordTelemetryEvent(event);
  } catch {
    /* swallow */
  }
}

function recordSurfaceChoice(chosenIndex: number, chosenLabel: string): void {
  try {
    if (!ensureSession()) {
      return;
    }
    const event: TelemetrySurfaceChoiceEvent = {
      kind: "surface_choice",
      t: Date.now(),
      wave: globalScene.currentBattle?.waveIndex ?? 0,
      uiMode: lastSurfaceMode,
      uiModeName: UiMode[lastSurfaceMode] ?? String(lastSurfaceMode),
      chosenIndex,
      chosenLabel: String(chosenLabel ?? "").slice(0, 64),
      actor: surfaceActor(),
    };
    recordTelemetryEvent(event);
  } catch {
    /* swallow */
  }
}

function recordInput(code: number, mode: number): void {
  try {
    if (!isTelemetryRecording()) {
      return;
    }
    const event: TelemetryInputEvent = {
      kind: "input",
      t: Date.now(),
      wave: globalScene.currentBattle?.waveIndex ?? 0,
      code,
      uiMode: mode,
    };
    recordTelemetryEvent(event);
  } catch {
    /* swallow */
  }
}

/**
 * In co-op, whose surface is this? The mirror drives the surface for whichever seat OWNS the interaction;
 * we tag by comparing the interaction owner-seat to our own role. Outside co-op it is always "self".
 */
function surfaceActor(): TelemetryActor {
  try {
    const controller = getCoopController();
    if (controller == null) {
      return "self";
    }
    const me = controller.role;
    const ownerSeat = (controller as { interactionCounter?: () => number }).interactionCounter?.() ?? 0;
    // Even interaction counter -> host owns, odd -> guest owns (CoopInteractionTurn.ownerOf parity).
    const ownerRole: CoopRole = ownerSeat % 2 === 0 ? "host" : "guest";
    return ownerRole === me ? "self" : "partner";
  } catch {
    return "self";
  }
}

// ---------------------------------------------------------------------------
// Init (called once from main.ts, after startGame).
// ---------------------------------------------------------------------------

/**
 * Initialize the telemetry pipeline: open the durable store, install the pagehide/visibilitychange beacon
 * + the UI surface/input observers, and run the boot RECOVERY of any previous session's unflushed events.
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
    installUiObservers();
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

function installUiObservers(): void {
  const ui = globalScene?.ui;
  if (ui == null) {
    return;
  }
  ui.on("er-telemetry-surface", (mode: number, args: unknown[]) => recordSurfaceOpen(mode, args));
  ui.on("er-telemetry-choice", (index: number, label: string) => recordSurfaceChoice(index, label));
  ui.on("er-telemetry-input", (code: number, mode: number) => recordInput(code, mode));
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
