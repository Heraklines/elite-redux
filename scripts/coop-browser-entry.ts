/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Pokemon } from "../src/field/pokemon";

// CI-only production-bundle entry. It boots the normal application first, then exposes the narrow transport
// seam used by the browser checkpoint. This file is included only by vite.coop-browser.config.mjs; no staged
// or production deployment imports it.
await import("../src/main");

const [
  { globalScene },
  { captureCoopSaveDataDigest },
  { canonicalize, fnv1a64 },
  { getCoopRuntime },
  { connectCoopWithCode },
  { UiMode },
] = await Promise.all([
  import("../src/global-scene"),
  import("../src/data/elite-redux/coop/coop-battle-engine"),
  import("../src/data/elite-redux/coop/coop-battle-checksum"),
  import("../src/data/elite-redux/coop/coop-runtime"),
  import("../src/data/elite-redux/coop/coop-webrtc-connect"),
  import("../src/enums/ui-mode"),
]);

type BrowserContinuationSurface = "command" | "replacement" | "reward" | "starter";

interface CoopBrowserSurfaceObservationV1 {
  readonly version: 1;
  readonly surface: BrowserContinuationSurface;
  readonly role: "host" | "guest";
  readonly seat: number;
  readonly epoch: number;
  readonly membershipRevision: number;
  readonly connectionGeneration: number;
  readonly wave: number;
  readonly turn: number;
  readonly phase: string;
  readonly uiMode: string;
  readonly uiActive: true;
  readonly stateDigest: string;
}

const SURFACE_PREFIX = "[coop-browser:surface] ";
const BINDING_PREFIX = "[coop-browser:binding] ";
const CHECKSUM_SENTINEL = "0000000000000000";

function observedPokemon(pokemon: Pokemon, slot: number) {
  return {
    slot,
    species: pokemon.species.speciesId,
    form: pokemon.formIndex,
    ability: pokemon.abilityIndex,
    passive: pokemon.passive,
    shiny: pokemon.shiny,
    variant: pokemon.variant,
    level: pokemon.level,
    exp: pokemon.exp,
    hp: pokemon.hp,
    maxHp: pokemon.stats[0] ?? 0,
    status:
      pokemon.status == null
        ? null
        : {
            effect: pokemon.status.effect,
            toxicTurnCount: pokemon.status.toxicTurnCount,
            sleepTurnsRemaining: pokemon.status.sleepTurnsRemaining ?? null,
          },
    fainted: pokemon.isFainted(),
    statStages: [...pokemon.summonData.statStages],
    moves: pokemon.moveset.map(move => ({
      move: move.moveId,
      ppUsed: move.ppUsed,
      ppUp: move.ppUp,
      maxPpOverride: move.maxPpOverride ?? null,
    })),
  };
}

/** A strong observer-only projection. Unlike the production boundary capture, every read here is non-mutating. */
function observedMechanicalDigest(): string {
  const saveDataDigest = captureCoopSaveDataDigest();
  if (saveDataDigest === CHECKSUM_SENTINEL) {
    throw new Error("save-data observer could not capture a stable digest");
  }
  const playerParty = globalScene.getPlayerParty();
  const enemyParty = globalScene.getEnemyParty();
  return fnv1a64(
    canonicalize({
      wave: globalScene.currentBattle.waveIndex,
      turn: globalScene.currentBattle.turn,
      money: globalScene.money,
      seed: globalScene.seed ?? "",
      biome: globalScene.arena.biomeId ?? 0,
      weather: globalScene.arena.weather?.weatherType ?? 0,
      terrain: globalScene.arena.terrain?.terrainType ?? 0,
      playerParty: playerParty.map(observedPokemon),
      enemyParty: enemyParty.map(observedPokemon),
      playerField: globalScene.getPlayerField().map(pokemon => pokemon.getBattlerIndex()),
      enemyField: globalScene.getEnemyField().map(pokemon => pokemon.getBattlerIndex()),
      saveDataDigest,
    }),
  );
}

function classifyContinuationSurface(phase: string, uiMode: string): BrowserContinuationSurface | null {
  if (phase === "SelectStarterPhase" && uiMode === "STARTER_SELECT") {
    return "starter";
  }
  if (phase === "CommandPhase" && ["COMMAND", "FIGHT", "BALL", "TARGET_SELECT"].includes(uiMode)) {
    return "command";
  }
  if (phase === "SelectModifierPhase" && uiMode === "MODIFIER_SELECT") {
    return "reward";
  }
  if (phase === "SwitchPhase" && uiMode === "PARTY") {
    return "replacement";
  }
  return null;
}

let lastObservedSurface = "";
let lastObservedBinding = "";
let lastProbedAddress = "";
let lastProbeAt = 0;
let lastObserverError = "";

function observeBoundSession(): void {
  try {
    const runtime = getCoopRuntime();
    if (runtime == null || runtime.controller.sessionEpoch <= 0) {
      return;
    }
    const membership = runtime.membership.snapshot();
    if (membership.state !== "active") {
      return;
    }
    const observation = {
      version: 1,
      role: runtime.controller.role,
      seat: runtime.controller.seat,
      epoch: runtime.controller.sessionEpoch,
      membershipRevision: membership.revision,
      connectionGeneration: membership.connectionGeneration,
      membershipState: membership.state,
    } as const;
    const canonical = JSON.stringify(observation);
    if (canonical === lastObservedBinding) {
      return;
    }
    lastObservedBinding = canonical;
    console.info(`${BINDING_PREFIX}${canonical}`);
  } catch {
    // Pairing is still assembling or the page is tearing down.
  }
}

/**
 * Emit one read-only marker when a real rendered/input-enabled continuation surface changes. The browser
 * driver never calls this function and receives no scene/controller mutation capability. Its only input
 * remains human-equivalent DOM/canvas keyboard events; this marker is the CI oracle that lets two isolated
 * built clients prove their exact authority address and mechanical digest agree.
 */
function observeContinuationSurface(): void {
  try {
    const runtime = getCoopRuntime();
    const battle = globalScene?.currentBattle;
    const phase = globalScene?.phaseManager?.getCurrentPhase()?.phaseName;
    const ui = globalScene?.ui;
    if (runtime == null || battle == null || phase == null || ui == null || !ui.getHandler().active) {
      return;
    }
    const uiMode = UiMode[ui.getMode()];
    const surface = classifyContinuationSurface(phase, uiMode);
    if (surface == null) {
      return;
    }
    const membership = runtime.membership.snapshot();
    const addressKey = [
      surface,
      runtime.controller.role,
      runtime.controller.seat,
      runtime.controller.sessionEpoch,
      membership.revision,
      membership.connectionGeneration,
      battle.waveIndex,
      battle.turn,
      phase,
      uiMode,
    ].join(":");
    const now = Date.now();
    if (addressKey === lastProbedAddress && now - lastProbeAt < 500) {
      return;
    }
    lastProbedAddress = addressKey;
    lastProbeAt = now;
    const stateDigest = observedMechanicalDigest();
    const observationKey = `${addressKey}:${stateDigest}`;
    if (observationKey === lastObservedSurface) {
      return;
    }
    lastObservedSurface = observationKey;
    const observation: CoopBrowserSurfaceObservationV1 = {
      version: 1,
      surface,
      role: runtime.controller.role,
      seat: runtime.controller.seat,
      epoch: runtime.controller.sessionEpoch,
      membershipRevision: membership.revision,
      connectionGeneration: membership.connectionGeneration,
      wave: battle.waveIndex,
      turn: battle.turn,
      phase,
      uiMode,
      uiActive: true,
      stateDigest,
    };
    console.info(`${SURFACE_PREFIX}${JSON.stringify(observation)}`);
  } catch (error) {
    // Scene initialization/teardown races are not a surface. The normal page error and co-op diagnostics
    // still fail the journey if gameplay itself throws.
    const message = error instanceof Error ? error.message : String(error);
    if (message !== lastObserverError) {
      lastObserverError = message;
      console.warn(`[coop-browser:observer-error] ${message}`);
    }
  }
}

setInterval(() => {
  observeBoundSession();
  observeContinuationSurface();
}, 100);

Object.defineProperty(globalThis, "__coopBrowserBridge", {
  configurable: false,
  enumerable: false,
  writable: false,
  value: Object.freeze({
    ready: () => globalScene?.gameData != null,
    connect: connectCoopWithCode,
    surfaceObserverVersion: 1,
  }),
});
