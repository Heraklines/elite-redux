/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op harness (#633). Boots a HOST BattleScene (the sole authoritative
// engine) AND a GUEST BattleScene (a pure renderer) in ONE vitest process, paired over
// an in-process LoopbackTransport (createLoopbackPair - the SAME framing the real WebRTC
// path uses). Unlike every prior co-op test (which is single-engine: one globalScene, the
// local client plays the GUEST and the HOST is FAKED with hand-authored turnResolution
// messages), here BOTH sides are REAL engines, so a real host-vs-guest divergence surfaces
// organically in the logs.
//
// The hard part is that the engine has PROCESS-GLOBAL state that is NOT per-scene
// (see test/.../duo_harness_inventory.md). The scheduler swaps a 4-part ClientCtx
// atomically before pumping each client:
//   1. globalScene            (src/global-scene.ts, set via initGlobalScene)
//   2. the coop `active` runtime (setCoopRuntime / getCoopRuntime)
//   3. Phaser.Math.RND.state() (process-global seeded RNG)
//   4. the er-ghost-teams per-run cache quartet (resetErGhostRunState boundary)
//
// Each CoopRuntime is assembled ONCE (host via startLocalCoopSession-style wiring on
// the loopback `host` end; guest via connectCoopSession-style wiring on the `guest`
// end) and thereafter the live one is selected with setCoopRuntime - NEVER re-wired
// (clearCoopRuntime / startLocalCoopSession destroy the first session).
//
// -----------------------------------------------------------------------------
// HOW TO RUN (the duo tests are gated behind ER_SCENARIO=1, like every ER engine test):
//
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-engine.test.ts
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-multiwave.test.ts
//
// (Windows PowerShell: `$env:ER_SCENARIO="1"; npx vitest run <path>`.) Both clients'
// coop:* + phase lines stream to dev-logs/coop-duo/<run>/{host,guest}.log (gitignored)
// for post-mortem eyeballing; the harness flushes them even when a test fails.
//
// -----------------------------------------------------------------------------
// WHAT THE MULTI-WAVE HARNESS ADDS over the spike (coop-duo-multiwave.test.ts):
//   - buildDuo + driveGuestReplayTurn + driveClientPhaseQueueTo: a per-wave pump (host plays the
//     wave to a win + emits its turnResolution/checkpoint; the guest replays it + applies the
//     checkpoint), then drives the guest's OWN queued Victory -> reward -> NewBattle ->
//     NextEncounter path so the production wave carrier, rather than a cloned battle, crosses waves.
//   - driveHostRewardShopOwner (OWNER) + driveGuestRewardWatch (WATCHER): the host opens its
//     REAL SelectModifierPhase, takes a reward, leaves; the guest runs its REAL startCoopWatch
//     loop, adopts the owner's relayed picks over the loopback, and leaves - both ending on the
//     SAME interaction counter (no hang, no resync storm). The owner/watcher ROLES ALTERNATE by
//     the interaction-counter parity (even = host owns, odd = guest owns), so the test drives
//     either client as owner. Sequential (owner-then-watcher) because the relay FIFO-buffers the
//     owner's picks - a cross-ctx await continuation can't run against the wrong globalScene.
//   - driveGuestTmCaseRegression: the #698 TM-Case continuation-orphan reproduction over the real
//     guest engine (the side that softlocked) + a real relayed pick over the loopback.
//   - forceNextMysteryEncounter / forceItemRewards: thin knobs over the override helpers so a
//     repro can FORCE a MysteryEncounterType or a chosen reward (e.g. a TM Case) on purpose.
//
// HOW TO ADD A NEW CO-OP REPRO WITH THIS HARNESS (3-line recipe):
//   1. In a fresh `it(...)`, boot the host (game.classicMode.startBattle) + buildDuo() to stand
//      up the guest engine + both runtimes over one loopback pair (host owns even interaction
//      counters, guest owns odd). Stage with forceItemRewards([...]) / forceNextMysteryEncounter.
//   2. Per wave: hostPlayWave (move.select both slots -> TurnEndPhase) -> driveGuestReplayTurn ->
//      driveHostRewardShopOwner + driveGuestRewardWatch (picking owner/watcher by counter parity)
//      -> phaseInterceptor.to("CommandPhase") for the host's next wave; remirrorWave before each.
//   3. Assert convergence (guest enemies fainted / counters equal / resyncs bounded) and that BOTH
//      reach the next wave; a no-progress stall THROWS (driveGuestReplayTurn) so a regression hangs loudly.
// =============================================================================

import { loggedInUser } from "#app/account";
import { Battle } from "#app/battle";
import { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { isShowdownGuestFlipGated } from "#data/elite-redux/coop/coop-authoritative-gate";
import {
  applyCoopAuthoritativeBattleState,
  captureCoopAuthoritativeBattleState,
  captureCoopPlayerModifiers,
  reconcileArenaTags,
  reconcileCoopPlayerModifiers,
} from "#data/elite-redux/coop/coop-battle-engine";
import type { CoopStateSyncOutcome } from "#data/elite-redux/coop/coop-battle-stream";
import {
  clearCoopBiomeInteractionStart,
  coopBiomeInteractionInProgress,
  coopBiomeInteractionStartValue,
  setCoopBiomeInteractionStart,
} from "#data/elite-redux/coop/coop-biome-pin-state";
import { setCoopDurabilityScheduleWrapperForTesting } from "#data/elite-redux/coop/coop-durability";
import {
  commitMeOwnerIntent,
  isCoopMeOperationEnabled,
  isCoopMeOperationJournalActive,
} from "#data/elite-redux/coop/coop-me-operation";
import {
  captureCoopActiveMysteryControl,
  coopMeHandoffBattleStarted,
  coopMeHandoffBattleWaveValue,
  restoreCoopActiveMysteryControlForHarness,
  restoreCoopMeHandoffBattleState,
  restoreCoopMeInteractionStartForHarness,
} from "#data/elite-redux/coop/coop-me-pin-state";
import {
  type CoopBiomeTransitionTailPermit,
  restoreCoopBiomeTransitionTailPermit,
  snapshotCoopBiomeTransitionTailPermit,
} from "#data/elite-redux/coop/coop-renderer-gate";
import {
  assembleCoopRuntime,
  type CoopRuntime,
  clearCoopRuntime,
  getCoopInteractionRelay,
  getCoopMeBattleInteractionCounter,
  getCoopRuntime,
  installCoopRuntimeGhostHooks,
  installCoopRuntimeLiveEmitter,
  setCoopMeBattleInteractionCounter,
  setCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { captureCoopTrainerVictoryBoundary } from "#data/elite-redux/coop/coop-trainer-victory-boundary";
import {
  type CoopActiveMysteryEncounterSnapshotV1,
  type CoopMessage,
  type CoopRecoveryReason,
  type CoopRole,
  type CoopTransport,
  createLoopbackPair,
  type SerializedCommand,
} from "#data/elite-redux/coop/coop-transport";
import { isCoopWaveAdvanceOperationEnabled } from "#data/elite-redux/coop/coop-wave-operation";
import {
  type ErAchievementRunSaveData,
  getErAchievementRunState,
  restoreErAchievementRunState,
} from "#data/elite-redux/er-achievement-run-state";
import {
  type ErRouteNode,
  erPendingNodesReady,
  getErPendingNodes,
  markErPendingNodesAwaitingAuthority,
  setErPendingNodes,
} from "#data/elite-redux/er-biome-routing";
import {
  erBiomeOverstayAnchor,
  getErBiomeLength,
  getErBiomeStartWave,
  setErBiomeOverstayAnchor,
  setErBiomeStructureExtent,
} from "#data/elite-redux/er-biome-structure";
import {
  type ErGhostRunStateSnapshot,
  emptyErGhostRunStateSnapshot,
  restoreErGhostRunState,
  snapshotErGhostRunState,
} from "#data/elite-redux/er-ghost-teams";
import {
  type ErMapSaveData,
  getErMapSaveData,
  restoreAuthoritativeMapTravelClassification,
  restoreErMapState,
  snapshotAuthoritativeMapTravelClassification,
} from "#data/elite-redux/er-map-nodes";
import { getErMoneyStreakEntries, restoreErMoneyStreaks } from "#data/elite-redux/er-money-streak";
import { resolveErModifierClass } from "#data/elite-redux/er-persistent-modifiers";
import {
  type ErRelicBattleStateData,
  getErRelicBattleState,
  restoreErRelicBattleState,
} from "#data/elite-redux/er-relic-battle-state";
import type { ReplayCommandEvent, ReplayTrace } from "#data/elite-redux/replay-trace";
import { isReplayCommandEvent, isReplayInteractionEvent, validateReplayTrace } from "#data/elite-redux/replay-trace";
import {
  beginShowdownBattle,
  getShowdownOpponentManifest,
  getShowdownOwnManifest,
} from "#data/elite-redux/showdown/showdown-battle-state";
import { ShowdownCommandRelay } from "#data/elite-redux/showdown/showdown-command-relay";
import { swapArenaTagSide } from "#data/elite-redux/showdown/showdown-side-swap";
import { PokemonMove } from "#data/moves/pokemon-move";
import { Terrain, TerrainType } from "#data/terrain";
import { Weather } from "#data/weather";
import { BattleType } from "#enums/battle-type";
import { BattlerIndex } from "#enums/battler-index";
import type { BiomeId } from "#enums/biome-id";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import type { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { Stat } from "#enums/stat";
import { TrainerSlot } from "#enums/trainer-slot";
import { UiMode } from "#enums/ui-mode";
import { WeatherType } from "#enums/weather-type";
import { EnemyPokemon, PlayerPokemon, type Pokemon } from "#field/pokemon";
import { Modifier, PersistentModifier } from "#modifiers/modifier";
import type { ModifierOverride } from "#modifiers/modifier-type";
import {
  ErLearnersShroomModifierType,
  ErTmCaseModifierType,
  PokemonModifierType,
  PokemonReviveModifierType,
  RememberMoveModifierType,
  TmModifierType,
} from "#modifiers/modifier-type";
import { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import {
  getActiveCoopReplayMePhaseForHarness,
  getCoopMeHostPresentation,
  setActiveCoopReplayMePhaseForHarness,
  setCoopMeHostPresentation,
} from "#phases/coop-replay-me-phase";
import { coopMeInteractionStartValue } from "#phases/mystery-encounter-phases";
import { ModifierData } from "#system/modifier-data";
import { PokemonData } from "#system/pokemon-data";
import type { GameManager } from "#test/framework/game-manager";
import type { GameWrapper } from "#test/framework/game-wrapper";
import { TextInterceptor } from "#test/framework/text-interceptor";
import { installHeadlessCoopSemanticProjectionOracle } from "#test/tools/coop-semantic-presentation";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import fs from "node:fs";
import path from "node:path";
import Phaser from "phaser";
import { afterEach, expect } from "vitest";

/**
 * The PROCESS-GLOBAL mystery-encounter pins/control that are NOT carried on the `active` runtime and
 * therefore bleed between the two engines unless swapped per client (the documented ME/ghost-wave
 * harness gap). They are module lets across three files:
 *  - `start`        = `coopMeInteractionStart` (mystery-encounter-phases.ts): the pinned ME-entry
 *                     interaction counter that drives the 8M pick / 9M terminal seq + owner parity.
 *  - `battleCounter`= `coopMeBattleInteractionCounter` (coop-runtime.ts): keys the ME-battle enemy-
 *                     party handoff (meBattleHandoffKey). Must equal `start` on the same client.
 *  - `presentation` = `coopMeHostPresentation` (coop-replay-me-phase.ts): the host-streamed ME
 *                     presentation the GUEST's MysteryEncounterUiHandler reads; non-null only mid-ME.
 *  - `activeReplay` = retained CoopReplayMePhase pointer used by verified snapshot UI/terminal rebound.
 *  - `activeControl`= checksum-bound selector/terminal state carried by hot-rejoin snapshots.
 * `-1` / `null` = idle.
 */
interface MePins {
  start: number;
  battleCounter: number;
  presentation: ReturnType<typeof getCoopMeHostPresentation>;
  activeReplay: ReturnType<typeof getActiveCoopReplayMePhaseForHarness>;
  activeControl: CoopActiveMysteryEncounterSnapshotV1 | undefined;
  handoffBattle: boolean;
  handoffWave: number;
}

const IDLE_ME_PINS: MePins = {
  start: -1,
  battleCounter: -1,
  presentation: null,
  activeReplay: null,
  activeControl: undefined,
  handoffBattle: false,
  handoffWave: -1,
};

/** Capture the live process-global ME pins (for save-back / restore in the ClientCtx swap). */
function readMePins(): MePins {
  return {
    start: coopMeInteractionStartValue(),
    battleCounter: getCoopMeBattleInteractionCounter(),
    presentation: getCoopMeHostPresentation(),
    activeReplay: getActiveCoopReplayMePhaseForHarness(),
    activeControl: captureCoopActiveMysteryControl(),
    handoffBattle: coopMeHandoffBattleStarted(),
    handoffWave: coopMeHandoffBattleWaveValue(),
  };
}

/** Install `pins` as the live process-global ME pins (the inverse of {@linkcode readMePins}). */
function writeMePins(pins: MePins): void {
  restoreCoopMeInteractionStartForHarness(pins.start);
  setCoopMeBattleInteractionCounter(pins.battleCounter);
  setCoopMeHostPresentation(pins.presentation);
  restoreCoopActiveMysteryControlForHarness(pins.activeControl);
  restoreCoopMeHandoffBattleState(pins.handoffBattle, pins.handoffWave);
  setActiveCoopReplayMePhaseForHarness(pins.activeReplay);
}

/**
 * The PROCESS-GLOBAL context that must be swapped atomically before pumping a
 * given client. Snapshotted per client; {@linkcode withClient} installs one + restores
 * the previous on exit so the two engines never read each other's globals.
 */
export interface ClientCtx {
  label: "host" | "guest";
  scene: BattleScene;
  runtime: CoopRuntime;
  /**
   * Optional per-browser account identity for authenticated persistence tests.
   * Production clients own independent account modules; the two-engine harness
   * must therefore swap this process-global value with the scene/runtime.
   */
  accountIdentity?: string;
  /** Phaser.Math.RND.state() string for THIS client's last pump (process-global RNG cursor). */
  rndState: string;
  /** The er-ghost per-run cache for this client (save/restore around the swap). */
  ghost: ReturnType<typeof snapshotGhostState>;
  /**
   * The ER module-let substrates for THIS client (#837): money-streak map / overstay anchor / relic
   * lists. Save/restore around the swap exactly like `ghost` + `rndState`, so each engine keeps its own
   * (production has one process per client) and a genuine module-let divergence is reproducible + healable.
   * Optional (like `mePins`): only READ when {@linkcode setCoopHarnessModuleLetIsolation} is enabled, and
   * seeded lazily on the first isolated swap, so ctxs built as bare literals need not provide it.
   */
  moduleLets?: CoopModuleLetSnapshot;
  /**
   * The complete World-Map / biome-transition substrate for this browser process. Unlike the older
   * money/relic module-let model, this is always isolated: a committed BIOME_PICK permit is one-shot and
   * letting the host and guest share it lets the first client consume/clear the other client's authority.
   */
  biomeState?: CoopBiomeModuleSnapshot;
  /**
   * The 3 mystery-encounter pins for THIS client (save/restore around the swap; idle off-ME).
   * Optional: ctxs that never reach an ME (the wave/shop spike tests) omit it and the swap treats
   * them as idle; an ME-driving ctx carries the live pins so the host's and guest's never bleed.
   */
  mePins?: MePins;
  /**
   * Monotonic ownership token for asynchronous ME-pin save-back. The one-process harness can have an
   * older `withClient(ctx)` continuation finish after a newer scope has already persisted this browser's
   * terminal boundary. Only the latest claimant may write `mePins`, preventing that older continuation
   * from resurrecting its stale active replay + interaction pin as a seemingly-live Mystery boundary.
   */
  mePinsSaveGeneration?: number;
  /**
   * Optional explicitly scheduled transport inbox for production-transition journeys. The pump is
   * invoked only while this client's complete process-global context is installed, so a network
   * continuation can never resume against the other engine's `globalScene`.
   */
  pumpInbound?: () => number;
}

// ---------------------------------------------------------------------------
// er-ghost per-run cache save/restore (#633 bounded-scope: ghost-bearing MEs + ghost WAVES).
// The er-ghost cache quartet (prefetched pool + prefetchStarted + usedGhostIds + ghostByWave, plus the
// lastGhostUploader picker cursor) is a PROCESS-GLOBAL owned by er-ghost-teams, NOT carried on the `active`
// runtime and NOT reset by clearCoopRuntime. Previously the harness PLACEHOLDER just RESET it per client
// (benign only when no ghost is taken); now we SAVE+RESTORE it per client via the additive
// snapshotErGhostRunState / restoreErGhostRunState seam, so a ghost-bearing ME (colosseum-gauntlet,
// graves-of-the-fallen) or a ghost WAVE can be duo-tested without one engine inheriting the other's ghost
// picks. ClientCtx.ghost holds THIS client's saved cache; withClient restores it on swap-in and saves the
// mutated cache back on swap-out (exactly like rndState + mePins). The ghost-pool SYNC hooks
// (coopGhostFetchSuppressed / onGhostPoolPublished) are ROLE-GATED per client by installCoopRuntimeGhostHooks
// in the swap (they are last-write-wins process-globals the guest would otherwise own for BOTH engines).
// ---------------------------------------------------------------------------
/**
 * The ER MODULE-LET substrates (#837) that are PROCESS-GLOBAL (money-streak `STREAKS`, biome overstay
 * anchor, per-battle relic lists) and therefore SHARED between the two engines in one process unless
 * swapped per client - the same class as the ME pins / ghost cache. Carrying them in the ClientCtx makes
 * the harness FAITHFUL for the substrates the #837 saveDataDigest now detects: each engine advances its
 * OWN streak map (real production has one process per client), so a genuine host-vs-guest module-let
 * divergence can be reproduced + healed here instead of collapsing onto a shared map.
 */
interface CoopModuleLetSnapshot {
  achievementRun: ErAchievementRunSaveData | undefined;
  moneyStreaks: [number, number][];
  overstayAnchor: number | null;
  biomeLength: number | null;
  biomeStartWave: number;
  relic: ErRelicBattleStateData;
  /** Full World-Map UI/routing substrate; production clients own independent module instances. */
  mapState: ErMapSaveData;
  /** The actual route-decision input, intentionally separate from the persisted map state. */
  pendingNodes: ErRouteNode[];
  pendingNodesReady: boolean;
  /** Deferred Crossroads Leave -> SelectBiome interaction pin, or -1 when idle. */
  biomeInteractionStart: number;
  /** Exact committed Switch/NewBiome permit, including this client's independent stage progress. */
  biomeTailPermit: CoopBiomeTransitionTailPermit | null;
  authoritativeTravelClassification: { readonly wave: number; readonly target: BiomeId | null } | null;
}

interface CoopBiomeModuleSnapshot {
  /** Full World-Map UI/routing substrate; production clients own independent module instances. */
  mapState: ErMapSaveData;
  /** The actual route-decision input, intentionally separate from the persisted map state. */
  pendingNodes: ErRouteNode[];
  pendingNodesReady: boolean;
  /** Deferred Crossroads Leave -> SelectBiome interaction pin, or -1 when idle. */
  biomeInteractionStart: number;
  /** Exact committed Switch/NewBiome permit, including this client's independent stage progress. */
  biomeTailPermit: CoopBiomeTransitionTailPermit | null;
  authoritativeTravelClassification: { readonly wave: number; readonly target: BiomeId | null } | null;
  overstayAnchor: number | null;
  biomeLength: number | null;
  biomeStartWave: number;
}

function snapshotBiomeModuleState(): CoopBiomeModuleSnapshot {
  return {
    mapState: structuredClone(getErMapSaveData()),
    pendingNodes: getErPendingNodes().map(node => ({ ...node })),
    pendingNodesReady: erPendingNodesReady(),
    biomeInteractionStart: coopBiomeInteractionInProgress() ? coopBiomeInteractionStartValue() : -1,
    biomeTailPermit: snapshotCoopBiomeTransitionTailPermit(),
    authoritativeTravelClassification: snapshotAuthoritativeMapTravelClassification(),
    overstayAnchor: erBiomeOverstayAnchor(),
    biomeLength: getErBiomeLength(),
    biomeStartWave: getErBiomeStartWave(),
  };
}

function restoreBiomeModuleState(s: CoopBiomeModuleSnapshot): void {
  restoreErMapState(structuredClone(s.mapState), s.biomeStartWave);
  if (s.pendingNodesReady) {
    setErPendingNodes(s.pendingNodes.map(node => ({ ...node })));
  } else {
    markErPendingNodesAwaitingAuthority();
  }
  setErBiomeOverstayAnchor(s.overstayAnchor);
  setErBiomeStructureExtent(s.biomeLength, s.biomeStartWave);
  if (s.biomeInteractionStart >= 0) {
    setCoopBiomeInteractionStart(s.biomeInteractionStart);
  } else {
    clearCoopBiomeInteractionStart();
  }
  if (!restoreCoopBiomeTransitionTailPermit(s.biomeTailPermit)) {
    throw new Error("Invalid isolated co-op biome-tail permit snapshot");
  }
  restoreAuthoritativeMapTravelClassification(s.authoritativeTravelClassification);
}

function snapshotModuleLets(): CoopModuleLetSnapshot {
  return {
    achievementRun: getErAchievementRunState(),
    moneyStreaks: getErMoneyStreakEntries(),
    overstayAnchor: erBiomeOverstayAnchor(),
    biomeLength: getErBiomeLength(),
    biomeStartWave: getErBiomeStartWave(),
    relic: getErRelicBattleState(),
    mapState: structuredClone(getErMapSaveData()),
    pendingNodes: getErPendingNodes().map(node => ({ ...node })),
    pendingNodesReady: erPendingNodesReady(),
    biomeInteractionStart: coopBiomeInteractionInProgress() ? coopBiomeInteractionStartValue() : -1,
    biomeTailPermit: snapshotCoopBiomeTransitionTailPermit(),
    authoritativeTravelClassification: snapshotAuthoritativeMapTravelClassification(),
  };
}

function restoreModuleLets(s: CoopModuleLetSnapshot): void {
  restoreErAchievementRunState(s.achievementRun);
  restoreErMoneyStreaks(s.moneyStreaks);
  restoreErRelicBattleState(s.relic);
  restoreBiomeModuleState({
    mapState: s.mapState,
    pendingNodes: s.pendingNodes,
    pendingNodesReady: s.pendingNodesReady,
    biomeInteractionStart: s.biomeInteractionStart,
    biomeTailPermit: s.biomeTailPermit,
    authoritativeTravelClassification: s.authoritativeTravelClassification,
    overstayAnchor: s.overstayAnchor,
    biomeLength: s.biomeLength,
    biomeStartWave: s.biomeStartWave,
  });
}

function snapshotGhostState(): ErGhostRunStateSnapshot {
  return snapshotErGhostRunState();
}

function restoreGhostState(snap: ErGhostRunStateSnapshot): void {
  restoreErGhostRunState(snap);
}

/** A CLEAN per-client ghost cache (the starting slate for a fresh ClientCtx). */
export function emptyGhostSnapshot(): ErGhostRunStateSnapshot {
  return emptyErGhostRunStateSnapshot();
}

/**
 * Whether the LIVE per-event stream (#633 bounded-scope #3) is enabled for the duo swap. OFF by default so
 * the existing wave-loop / reward-shop tests keep the Phase-1 turn-end BATCH path (byte-identical to
 * before); a test that exercises the live path calls {@linkcode setCoopHarnessLiveEvents}(true) to install
 * the ACTIVE client's role-gated live emitter on each swap (the host's during host pumps -> the stream
 * turns on; the guest's is a self-gated no-op).
 */
let coopHarnessLiveEvents = false;

/** Enable/disable the LIVE per-event stream for the duo swap (#633 bounded-scope #3). Default OFF. */
export function setCoopHarnessLiveEvents(on: boolean): void {
  coopHarnessLiveEvents = on;
}

/**
 * Whether the ER MODULE-LET substrates (money-streak / overstay anchor / relic lists) are ISOLATED
 * per client in the swap (#837). OFF by default: those process-globals stay SHARED between the two
 * engines (the pre-#837 behavior), so the existing wave-loop / reward-shop / mystery tests are
 * byte-identical - crucially the harness guest's replay drive does NOT run BattleEndPhase's
 * advanceErMoneyStreaks, so with isolation ON the guest streak would trail the host and manufacture a
 * digest divergence those tests don't expect. A #837 divergence-and-heal test that manually drives two
 * DIFFERENT module-let states calls {@linkcode setCoopHarnessModuleLetIsolation}(true) to get faithful
 * per-client isolation (production has one process per client).
 */
let coopHarnessModuleLetIsolation = false;

/** Enable/disable per-client ER module-let isolation for the duo swap (#837). Default OFF (shared). */
export function setCoopHarnessModuleLetIsolation(on: boolean): void {
  coopHarnessModuleLetIsolation = on;
}

/**
 * Install the swapped-in runtime's ROLE-GATED process hooks: the GHOST-pool publisher/suppression ALWAYS
 * (a correctness fix - the guest must own suppression, the host the publisher), and the LIVE-event emitter
 * ONLY when the harness has opted in ({@linkcode setCoopHarnessLiveEvents}). See those functions for why.
 */
function installCoopHooksForActive(runtime: CoopRuntime): void {
  installCoopRuntimeGhostHooks(runtime);
  if (coopHarnessLiveEvents) {
    installCoopRuntimeLiveEmitter(runtime);
  }
}

/** Capture the live process-global context (so withClient can restore it). */
function captureLiveCtx(): {
  scene: BattleScene;
  runtime: CoopRuntime | null;
  rndState: string;
  ghost: ErGhostRunStateSnapshot;
  moduleLets: CoopModuleLetSnapshot;
  biomeState: CoopBiomeModuleSnapshot;
  mePins: MePins;
} {
  return {
    scene: globalScene,
    runtime: getCoopRuntime(),
    rndState: Phaser.Math.RND.state(),
    ghost: snapshotGhostState(),
    // Snapshot the module-lets so the prev-restore is faithful when isolation is ON; harmless when OFF.
    moduleLets: snapshotModuleLets(),
    biomeState: snapshotBiomeModuleState(),
    mePins: readMePins(),
  };
}

/**
 * ATOMICALLY install `ctx`'s 4-part process-global context, run `fn`, then restore the
 * previous context. Re-entrant-safe (saves/restores around the body). The RND state is
 * the load-bearing one: the shared Phaser.Math.RND cursor would otherwise bleed between
 * the two engines and desync their rolls.
 */
/** The label of the client currently being pumped (so the log sink routes lines to its bucket). */
export let activeClientLabel: "host" | "guest" | "none" = "none";
let activeClientInboundPump: (() => number) | undefined;
/** The complete ClientCtx currently installed (null between windows). Timer-ownership pins consult it. */
let activeClientCtx: ClientCtx | null = null;

/**
 * PREEMPTION SAVE (the gate-6 29606450565 stale-snapshot class): a ctx object is ordinarily persisted
 * only when its window EXITS, so while a client's async window is OPEN its ctx object lags live state.
 * A pinned timer callback (or any nested cross-client window) that installs the OTHER client mid-window
 * would then re-install that client's stale exit-time snapshot: the B9 mystery logs show the host's
 * IDLE (pre-ME) pins stomping the LIVE mid-ME pins ("interaction-counter 0 -> -1 (ME end)" toggling),
 * which un-suppressed the embedded shop's MAJOR-3 counter advance - and the same hazard re-installs a
 * stale RND cursor. Persist the preempted client's live state into its ctx BEFORE installing another,
 * so every cross-client install always reads the freshest snapshot.
 */
function persistPreemptedClientState(outgoing: ClientCtx): void {
  outgoing.rndState = Phaser.Math.RND.state();
  outgoing.ghost = snapshotGhostState();
  if (coopHarnessModuleLetIsolation) {
    outgoing.moduleLets = snapshotModuleLets();
  }
  if (outgoing.biomeState !== undefined) {
    outgoing.biomeState = snapshotBiomeModuleState();
  }
  // Claim the ME-pin save like persistInstalledClientMePins: this snapshot is definitionally newer
  // than every already-entered window of this client, so their exit saves must not clobber it.
  outgoing.mePinsSaveGeneration = (outgoing.mePinsSaveGeneration ?? 0) + 1;
  outgoing.mePins = readMePins();
}

let meBoundaryGeneration = 0;

function restoreScopedMePins(pins: MePins, capturedBoundaryGeneration: number): void {
  const boundaryWasInvalidated = capturedBoundaryGeneration !== meBoundaryGeneration;
  writeMePins(boundaryWasInvalidated ? IDLE_ME_PINS : pins);
  if (
    boundaryWasInvalidated
    && (coopMeInteractionStartValue() !== IDLE_ME_PINS.start
      || getActiveCoopReplayMePhaseForHarness() !== IDLE_ME_PINS.activeReplay)
  ) {
    throw new Error("an invalidated client scope resurrected a stale Mystery boundary during restore");
  }
}

/**
 * SYNCHRONOUS sibling of {@linkcode withClient}: install `ctx`'s 4-part process-global context, run a
 * SYNC `fn`, then restore the previous context - all before returning. Use this when the body is purely
 * synchronous and the previous context MUST be restored before the next statement (e.g. constructing a
 * guest-scene phase whose ctor reads globalScene - withClient's async finally would leave globalScene
 * pointed at the guest until the next microtask). Do NOT pass an async fn (its awaited work would run
 * after the restore); use {@linkcode withClient} for that.
 */
export function withClientSync<T>(ctx: ClientCtx, fn: () => T): T {
  if (activeClientCtx != null && activeClientCtx !== ctx) {
    persistPreemptedClientState(activeClientCtx);
  }
  const mePinsSaveGeneration = (ctx.mePinsSaveGeneration ?? 0) + 1;
  ctx.mePinsSaveGeneration = mePinsSaveGeneration;
  const prev = captureLiveCtx();
  const prevLabel = activeClientLabel;
  const prevInboundPump = activeClientInboundPump;
  const prevClientCtx = activeClientCtx;
  const prevAccountIdentity = loggedInUser?.username;
  const capturedBoundaryGeneration = meBoundaryGeneration;
  activeClientLabel = ctx.label;
  activeClientInboundPump = ctx.pumpInbound;
  activeClientCtx = ctx;
  if (ctx.accountIdentity != null && loggedInUser != null) {
    loggedInUser.username = ctx.accountIdentity;
  }
  initGlobalScene(ctx.scene);
  Phaser.Math.RND.state(ctx.rndState);
  restoreGhostState(ctx.ghost);
  if (coopHarnessModuleLetIsolation && ctx.moduleLets !== undefined) {
    restoreModuleLets(ctx.moduleLets);
  }
  if (ctx.biomeState !== undefined) {
    restoreBiomeModuleState(ctx.biomeState);
  }
  writeMePins(ctx.mePins ?? IDLE_ME_PINS);
  // Runtime activation is deliberately LAST: setCoopRuntime flushes continuations
  // queued by runWhenCoopRuntimeActive. Those callbacks must see this client's
  // complete browser-local state, especially its ME pin and active replay pointer.
  setCoopRuntime(ctx.runtime);
  installCoopHooksForActive(ctx.runtime);
  try {
    return fn();
  } finally {
    ctx.rndState = Phaser.Math.RND.state();
    ctx.ghost = snapshotGhostState();
    if (coopHarnessModuleLetIsolation) {
      ctx.moduleLets = snapshotModuleLets();
    }
    if (ctx.biomeState !== undefined) {
      ctx.biomeState = snapshotBiomeModuleState();
    }
    // Symmetric with withClient: a sync window (incl. a pinned timer callback) that legitimately
    // mutates the ME pins must persist them, or the mutation dies with the prev-restore below.
    if (ctx.mePinsSaveGeneration === mePinsSaveGeneration) {
      ctx.mePins = readMePins();
    }
    initGlobalScene(prev.scene);
    Phaser.Math.RND.state(prev.rndState);
    restoreGhostState(prev.ghost);
    if (coopHarnessModuleLetIsolation) {
      restoreModuleLets(prev.moduleLets);
    }
    restoreBiomeModuleState(prev.biomeState);
    restoreScopedMePins(prev.mePins, capturedBoundaryGeneration);
    if (prevAccountIdentity != null && loggedInUser != null) {
      loggedInUser.username = prevAccountIdentity;
    }
    activeClientLabel = prevLabel;
    activeClientInboundPump = prevInboundPump;
    activeClientCtx = prevClientCtx;
    if (prev.runtime != null) {
      setCoopRuntime(prev.runtime);
      installCoopHooksForActive(prev.runtime);
    }
  }
}

export async function withClient<T>(ctx: ClientCtx, fn: () => T | Promise<T>): Promise<T> {
  if (activeClientCtx != null && activeClientCtx !== ctx) {
    persistPreemptedClientState(activeClientCtx);
  }
  // Async scopes may overlap and finish out of entry order. Claim ME-pin save ownership before installing
  // this browser; a later scope (or an explicit persistInstalledClientMePins) invalidates this claim.
  const mePinsSaveGeneration = (ctx.mePinsSaveGeneration ?? 0) + 1;
  ctx.mePinsSaveGeneration = mePinsSaveGeneration;
  const prev = captureLiveCtx();
  const prevLabel = activeClientLabel;
  const prevInboundPump = activeClientInboundPump;
  const prevClientCtx = activeClientCtx;
  const prevAccountIdentity = loggedInUser?.username;
  const capturedBoundaryGeneration = meBoundaryGeneration;
  activeClientLabel = ctx.label;
  activeClientInboundPump = ctx.pumpInbound;
  activeClientCtx = ctx;
  if (ctx.accountIdentity != null && loggedInUser != null) {
    loggedInUser.username = ctx.accountIdentity;
  }
  // 1. globalScene
  initGlobalScene(ctx.scene);
  // 2. process-global RND cursor
  Phaser.Math.RND.state(ctx.rndState);
  // 3. er-ghost per-run cache
  restoreGhostState(ctx.ghost);
  // 3b. ER module-let substrates (#837): money-streak / overstay anchor / relic lists. Gated on the
  //     opt-in isolation flag (default OFF = shared, pre-#837 behavior); ON = faithful per-client state.
  if (coopHarnessModuleLetIsolation && ctx.moduleLets !== undefined) {
    restoreModuleLets(ctx.moduleLets);
  }
  if (ctx.biomeState !== undefined) {
    restoreBiomeModuleState(ctx.biomeState);
  }
  // 4. mystery-encounter pins (start / battleCounter / presentation)
  writeMePins(ctx.mePins ?? IDLE_ME_PINS);
  // 5. coop active runtime + role-gated hooks, LAST. setCoopRuntime flushes
  // runWhenCoopRuntimeActive callbacks synchronously; installing it earlier let a
  // destination continuation observe the previous client's pins/RNG/module state.
  setCoopRuntime(ctx.runtime);
  installCoopHooksForActive(ctx.runtime);
  try {
    return await fn();
  } finally {
    ctx.rndState = Phaser.Math.RND.state();
    ctx.ghost = snapshotGhostState();
    if (coopHarnessModuleLetIsolation) {
      ctx.moduleLets = snapshotModuleLets();
    }
    if (ctx.biomeState !== undefined) {
      ctx.biomeState = snapshotBiomeModuleState();
    }
    if (ctx.mePinsSaveGeneration === mePinsSaveGeneration) {
      ctx.mePins = readMePins();
    }
    initGlobalScene(prev.scene);
    Phaser.Math.RND.state(prev.rndState);
    restoreGhostState(prev.ghost);
    if (coopHarnessModuleLetIsolation) {
      restoreModuleLets(prev.moduleLets);
    }
    restoreBiomeModuleState(prev.biomeState);
    restoreScopedMePins(prev.mePins, capturedBoundaryGeneration);
    if (prevAccountIdentity != null && loggedInUser != null) {
      loggedInUser.username = prevAccountIdentity;
    }
    activeClientLabel = prevLabel;
    activeClientInboundPump = prevInboundPump;
    activeClientCtx = prevClientCtx;
    if (prev.runtime != null) {
      setCoopRuntime(prev.runtime);
      installCoopHooksForActive(prev.runtime);
    }
  }
}

/**
 * Save the currently installed client's live Mystery state before a long-running journey crosses into the
 * other synthetic browser. This is intentionally ME-only and requires an exact scene/runtime match: unlike
 * production, the one-process journey can mutate the installed host between scoped pumps, while its stored
 * ClientCtx is updated only on scope exit. Broader ambient-state adoption is unsafe for focused fixtures.
 */
export function persistInstalledClientMePins(ctx: ClientCtx): void {
  if (globalScene !== ctx.scene || getCoopRuntime() !== ctx.runtime) {
    throw new Error(`cannot persist ${ctx.label} ME pins while a different client is installed`);
  }
  // This explicit snapshot is newer than every already-entered async scope. Advance the generation so a
  // late finally from one of those scopes cannot overwrite it with the older replay pointer + pin pair.
  ctx.mePinsSaveGeneration = (ctx.mePinsSaveGeneration ?? 0) + 1;
  meBoundaryGeneration++;
  ctx.mePins = readMePins();
}

// ---------------------------------------------------------------------------
// dev-log capture (gitignored). Both clients' coop:* console lines stream to
// dev-logs/coop-duo/<run>/{host,guest}.log for eyeballing.
// ---------------------------------------------------------------------------
export interface DuoLogs {
  dir: string;
  host: string[];
  guest: string[];
  /** Unexpected console.error calls, always captured even when they lack a co-op prefix. */
  errors: string[];
  /** Where the currently-pumping client's console lines are routed. */
  active: "host" | "guest" | "none";
  flush(): void;
  dispose(): void;
}

/**
 * Capture both clients' coop:* / phase console lines to dev-logs/ for eyeballing, WITHOUT
 * disturbing the test framework's {@linkcode MockConsole}. We wrap the LIVE `globalThis.console`
 * object's `log`/`warn` (which by the time we are called is the MockConsole instance the test
 * setup installed) and delegate to the original - so MockConsole's own formatting still runs and
 * we never break its construction-time `this.console = console` capture. Lines are routed to the
 * currently-pumping client's bucket (`logs.active`).
 *
 * IMPORTANT: call this AFTER `new GameManager(...)` so the MockConsole is already the global.
 */
export function installDuoLogCapture(runName: string): DuoLogs {
  const dir = path.resolve(process.cwd(), "dev-logs", "coop-duo", runName);
  fs.mkdirSync(dir, { recursive: true });
  // The live console (MockConsole instance under the test harness).
  const liveConsole = globalThis.console;
  const origLog = liveConsole.log.bind(liveConsole);
  const origWarn = liveConsole.warn.bind(liveConsole);
  const origError = liveConsole.error.bind(liveConsole);
  const logs: DuoLogs = {
    dir,
    host: [],
    guest: [],
    errors: [],
    active: "none",
    flush() {
      fs.writeFileSync(path.join(dir, "host.log"), this.host.join("\n"), "utf8");
      fs.writeFileSync(path.join(dir, "guest.log"), this.guest.join("\n"), "utf8");
      fs.writeFileSync(path.join(dir, "errors.log"), this.errors.join("\n"), "utf8");
    },
    dispose() {
      this.flush();
      liveConsole.log = origLog;
      liveConsole.warn = origWarn;
      liveConsole.error = origError;
    },
  };
  const sink = (level: string, args: unknown[]) => {
    let line: string;
    try {
      line = `[${level}] ${args.map(a => (typeof a === "string" ? a : safeStr(a))).join(" ")}`;
    } catch {
      return;
    }
    const bucket = activeClientLabel === "guest" ? logs.guest : logs.host;
    if (/coop|\[coop|Start Phase|turnResolution|checkpoint|MISMATCH|desync/i.test(line)) {
      bucket.push(line);
    }
  };
  liveConsole.log = (...args: unknown[]) => {
    sink("log", args);
    return origLog(...args);
  };
  liveConsole.warn = (...args: unknown[]) => {
    sink("warn", args);
    return origWarn(...args);
  };
  liveConsole.error = (...args: unknown[]) => {
    const client = activeClientLabel === "guest" ? "guest" : "host";
    logs.errors.push(`[${client}] ${args.map(a => (typeof a === "string" ? a : safeStr(a))).join(" ")}`);
    sink("error", args);
    return origError(...args);
  };
  return logs;
}

function safeStr(a: unknown): string {
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

// ---------------------------------------------------------------------------
// Engine construction.
// ---------------------------------------------------------------------------

/**
 * Build the GUEST {@linkcode BattleScene} DIRECTLY (NOT a 2nd GameManager - that reuses
 * globalScene). Reuses the host GameManager's {@linkcode GameWrapper} to inject the mock
 * factories WITHOUT going through the GameWrapper ctor (which re-sows Phaser.Math.RND.sow).
 * The new BattleScene ctor steals globalScene (last-write-wins) - the caller re-points it.
 */
export function buildGuestScene(hostGame: GameManager): BattleScene {
  const savedRnd = Phaser.Math.RND.state();
  const guestScene = new BattleScene(); // ctor calls initGlobalScene(this) - steals globalScene.
  // Install the cooperative scheduler BEFORE create(). BattleScene.create() seeds the title/login phase
  // queue and may otherwise start an asynchronous LoginPhase immediately. In the one-process harness that
  // late login can mutate the shared account module while an authenticated host/guest persistence
  // transaction is awaiting cloud I/O. Real browsers finish their own login before pairing; this synthetic
  // guest is reconstructed directly into the paired battle and must never run an independent boot flow.
  guestScene.phaseManager["startCurrentPhase"] = () => {
    /* inert: the cooperative scheduler calls phase.start() explicitly */
  };
  // Re-run the SAME mock injection the host wrapper did, but on the guest scene, WITHOUT
  // re-seeding the RND (GameWrapper's ctor sow is the only re-seed; setScene/injectMandatory
  // does not sow). We call the private injectMandatory + preload + create via setScene.
  const wrapper: GameWrapper = hostGame.gameWrapper;
  const prevWrapperScene = wrapper.scene;
  // setScene runs injectMandatory(); it does NOT sow - safe. (sow only happens in the ctor.) It is
  // typed async (preload/create) but every step resolves synchronously under the headless mocks, so
  // the scene is fully built when this returns; the unawaited promise carries no pending work.
  // biome-ignore lint/complexity/noVoid: intentional fire-and-forget of a synchronously-resolving promise
  void wrapper.setScene(guestScene);
  wrapper.scene = prevWrapperScene;
  // Give the guest scene a TextInterceptor (sets scene.messageWrapper) so the replayed turn's
  // MessagePhase / showText path does not crash the headless guest.
  new TextInterceptor(guestScene);
  neutralizeCoopCandyBar(guestScene);
  // Restore the RND cursor the ctor/injection may have touched.
  Phaser.Math.RND.state(savedRnd);
  // Reassert the manual pump in case create() replaced phase-manager wiring while initializing the scene.
  guestScene.phaseManager["startCurrentPhase"] = () => {
    /* inert: the cooperative scheduler calls phase.start() explicitly */
  };
  return guestScene;
}

/**
 * REAL LAUNCH-HANDSHAKE step (#658 seed-pin): make the guest scene adopt the HOST's authoritative
 * run-config-derived scene state so the guest's post-checkpoint {@linkcode captureCoopChecksumState} matches
 * the host's WITHOUT a resync. The per-wave checksum hashes NON-field state the turn CHECKPOINT does not
 * reconcile - the run `seed` (the master determinism input), `money`, the `pokeballCounts` inventory, and
 * the player-wide persistent `modifiers`. In production the guest pins all of these at LAUNCH: it adopts the
 * host's seed off the broadcast `runConfig` (#658, `setSeed`), and money/balls/modifiers ride the
 * host-authoritative relays + the resync reconcile. The plain mirror skipped this - so the guest kept its
 * OWN fresh-scene seed/money/balls and lacked the host's starting modifiers, and the checksum diverged every
 * wave then self-healed via a benign `requestStateSync`. This closes that gap so a residual mismatch after
 * mirroring is a REAL host-vs-guest divergence, not a harness artifact.
 *
 * `setSeed` only writes `seed` + the derived wave-cycle/offset-gym flags (no RNG re-sow, so the per-client
 * swapped RND cursor is untouched). Money + ball inventory are host-authoritative snapshots (a REAL capture
 * that later decrements the host's balls host-only is still detected + healed by the checksum's
 * `pokeballCounts` field exactly as in production). The player-wide modifiers are adopted via the SAME
 * production heal the resync uses ({@linkcode reconcileCoopPlayerModifiers}, reconstructing the ones the
 * guest lacks); per-mon HELD items ride the mirrored field. The brief globalScene point at the host is the
 * only way {@linkcode captureCoopPlayerModifiers} (a globalScene reader) can see the host's list from inside
 * the guest-ctx mirror; it is restored before returning.
 */
function adoptCoopHostRunConfig(hostScene: BattleScene, guestScene: BattleScene): void {
  // Seed: the #658 launch pin. setSeed writes seed + waveCycleOffset + offsetGym; it does NOT re-sow RND.
  guestScene.setSeed(hostScene.seed);
  // Money: host-authoritative; the guest mirrors it (relayed in production). Checksum-hashed.
  guestScene.money = hostScene.money;
  // Ball inventory: host-authoritative starting counts; a real capture-driven drift stays checksum-detectable.
  guestScene.pokeballCounts = { ...hostScene.pokeballCounts };
  // Player-wide PERSISTENT modifiers (checksum-hashed `modifiers`): a launched host run carries starting /
  // accumulated player-wide modifiers (lures, EXP charms, relics, the run's own starting items) the bare
  // `new BattleScene()` guest never inherited. Adopt them via the SAME production heal the resync uses:
  // serialize the host's owned (non-held, non-form) persistent modifiers under the host scene, then
  // RECONSTRUCT the ones the guest lacks on the guest scene. Per-mon HELD items ride the mirrored field.
  const prevScene = globalScene;
  initGlobalScene(hostScene);
  const hostModifierBlobs = captureCoopPlayerModifiers();
  initGlobalScene(guestScene);
  reconcileCoopPlayerModifiers(hostModifierBlobs);
  initGlobalScene(prevScene);
}

/**
 * Bring the GUEST scene into the SAME live battle the host is in, by reconstructing the host's
 * field under the guest scene (PokemonData round-trip) + assembling a matching {@linkcode Battle}.
 * In production the guest reaches its battle through the full launch + `enemyPartySync` adopt; for
 * the spike we mirror the host's resolved field directly so the guest's REAL phase pipeline
 * (TurnStartPhase -> CoopReplayTurnPhase -> CoopFinalizeTurnPhase -> applyCoopCheckpoint) can run
 * against the host's streamed turns. The {@linkcode adoptCoopHostRunConfig} step pins the host's
 * seed/money/ball inventory/modifiers (#658) so the per-wave checksum MATCHES with no resync. MUST be
 * called inside `withClient(guestCtx, ...)` so globalScene is the guest scene (PokemonData.toPokemon /
 * addPlayerPokemon build under the live globalScene).
 *
 * TRAINER-AWARE (#846): the assembled {@linkcode Battle} carries the host's `battleType` + `trainer`
 * (so a FIXED rival/evil-team or a RANDOM trainer wave rebuilds with the host's trainer identity /
 * variant), and every enemy is rebuilt from the FULL host enemy party (`getEnemyParty()` - on-field
 * leads AND off-field bench) keyed to the host's authoritative `trainerSlot`. This parallels
 * production's own reconstruction (`adoptCoopEnemiesStructural` in coop-enemy-builder.ts, which rebuilds
 * the streamed party verbatim under `TrainerSlot.TRAINER`), so harness trainer-wave fidelity equals the
 * live `enemyPartySync` adopt: the guest is checksum-identical on the on-field enemies AND holds the same
 * benched reserve pool, so the trainer's post-KO send-out reconstructs the SAME next mon on both engines.
 *
 * Returns nothing; mutates the guest scene's party / currentBattle / arena / field.
 */
export function mirrorHostBattleToGuest(
  hostScene: BattleScene,
  guestScene: BattleScene,
  opts?: { preserveGuestPlayerParty?: boolean },
): void {
  // Production's enemyPartySync now pairs the new enemy manifest with a complete authoritative boundary
  // state. Capture it under the host scene before reconstructing the guest, then apply it after the streamed
  // enemies exist. This carries between-wave HP/items/party mutations without a harness-only heal.
  const previousScene = globalScene;
  initGlobalScene(hostScene);
  const waveBoundaryState = captureCoopAuthoritativeBattleState(hostScene.currentBattle?.turn ?? 0);
  // Pokemon.getMaxHp() can consult the active scene's modifier substrate. Capture every HOST scalar while
  // the host is still the active global scene; calling hostEnemy.getMaxHp() later under the guest context
  // made the production-fidelity mirror manufacture small max-HP drift from guest modifiers.
  const hostEnemyScalars = hostScene
    .getEnemyParty()
    .map(enemy => ({ stats: [...enemy.stats], maxHp: enemy.getMaxHp(), hp: enemy.hp }));
  const hostPlayerScalars = hostScene
    .getPlayerParty()
    .map(player => ({ stats: [...player.stats], maxHp: player.getMaxHp(), hp: player.hp }));
  initGlobalScene(previousScene);
  // 0. Adopt the host's SEED + run-config-derived scene state (#658 seed-pin). See adoptCoopHostRunConfig:
  //    this is the launch-handshake step the plain mirror skipped, and WHY a benign per-wave checksum
  //    mismatch appeared + self-healed via a resync. After it the guest's wave-start checksum MATCHES the
  //    host's, so a residual mismatch is a REAL divergence.
  adoptCoopHostRunConfig(hostScene, guestScene);
  // SHOWDOWN (Task F1): when the versus-guest flip is live (this mirror runs under the guest ctx), the
  // guest boots into its LOCAL orientation - its OWN team (the host's ENEMY side) becomes its local
  // PLAYER party, and the opponent (the host's PLAYER side) its local ENEMY. This reproduces what the
  // production launch-snapshot ingress swap (swapSessionData) produces, so the egress un-swap in
  // captureVersusGuestChecksumState maps back to the host's authoritative orientation and the wave-start
  // checksums converge. FALSE for co-op / solo (byte-identical mirror as before).
  const flip = isShowdownGuestFlipGated();
  // 1. Same game mode + arena/biome as the host.
  guestScene.gameMode = hostScene.gameMode;
  guestScene.newArena(hostScene.arena.biomeId);
  // #843 WEATHER/TERRAIN carry: newArena above resets weather/terrain to NONE, but the host may have an
  // active biome/move weather or terrain the per-wave checksum hashes (weatherType/terrainType). Carry the
  // host's authoritative type + turns onto the guest arena AS PART OF THE MIRROR (a re-mirror is a full
  // reset to the host, so this belongs here, not in a driver-side shim). New Weather/Terrain instances - never
  // share the host's object. This is the fidelity adoptCoopHostRunConfig closed for seed/money/balls,
  // extended to the arena, so the soak's driver heal no longer needs a reconcileGuestArena supplement.
  const hostWeather = hostScene.arena.weather;
  guestScene.arena.weather =
    hostWeather == null || hostWeather.weatherType === WeatherType.NONE
      ? null
      : new Weather(hostWeather.weatherType, hostWeather.turnsLeft);
  const hostTerrain = hostScene.arena.terrain;
  guestScene.arena.terrain =
    hostTerrain == null || hostTerrain.terrainType === TerrainType.NONE
      ? null
      : new Terrain(hostTerrain.terrainType, hostTerrain.turnsLeft);
  // #843 ARENA-TAG carry: newArena also cleared entry hazards / screens / tailwind / FOAMY_WEB etc., which
  // the per-wave checksum hashes by (tagType, side). A move that set an arena tag before the re-mirror
  // would otherwise diverge purely as a mirror artifact (the CONTENT stays live). Rebuild the host's
  // authoritative tag set on the guest arena via the SAME production heal the per-turn checkpoint uses
  // (reconcileArenaTags reads globalScene.arena = the guest here, since the mirror runs in the guest ctx).
  reconcileArenaTags(
    hostScene.arena.tags.map(t => ({
      tagType: t.tagType as unknown as string,
      // Flip the tag SIDE for the versus guest's local orientation (a host ENEMY-side hazard targets the
      // guest's own team, so on the guest it sits on the local PLAYER side).
      side: flip ? swapArenaTagSide(t.side as unknown as number) : (t.side as unknown as number),
      turnCount: t.turnCount,
      layers: (t as unknown as { layers?: number }).layers ?? 1,
    })),
  );

  // `party` is private on BattleScene; the harness writes it through an unknown cast (test-only).
  const guestSceneInternal = guestScene as unknown as { party: PlayerPokemon[] };

  // 2. Rebuild the player party under the guest scene from the host's PokemonData. We construct the
  //    mon DIRECTLY (not scene.addPlayerPokemon, whose init() builds the battle-info UI / sprites the
  //    headless guest scene can't fully back) - the ctor does the logical build; we skip init().
  //
  // PRODUCTION-FIDELITY (#879 review item 5, soak fidelity mode): when `preserveGuestPlayerParty` is set (and
  // this is a real co-op run with an already-built guest party), SKIP the player rebuild entirely, so the
  // guest carries its OWN replayed player party forward across the wave boundary instead of being reset to the
  // host. This is what lets a guest that has DRIFTED stay drifted (and thus fail loudly at the next digest /
  // when it constructs its own command) rather than being silently healed by the per-wave mirror. Enemies /
  // arena / run-config are still adopted (they are host-AUTHORITATIVE in production too). Never used on the
  // versus-flip path or when the guest party is empty (wave-1 launch adopt still rebuilds).
  const preservePlayer = opts?.preserveGuestPlayerParty === true && !flip && guestSceneInternal.party.length > 0;
  if (!preservePlayer) {
    guestSceneInternal.party = [];
  }
  // Versus flip: the guest's local PLAYER party is the host's ENEMY party (its own team). Co-op: the
  // host's own player party (the shared team).
  for (const hostMon of preservePlayer ? [] : flip ? hostScene.getEnemyParty() : hostScene.getPlayerParty()) {
    const data = new PokemonData(hostMon);
    const mon = new PlayerPokemon(
      getPokemonSpecies(hostMon.species.speciesId),
      hostMon.level,
      hostMon.abilityIndex,
      hostMon.formIndex,
      hostMon.gender,
      hostMon.shiny,
      hostMon.variant,
      hostMon.ivs,
      hostMon.nature,
      data,
    );
    // coopOwner is a runtime tag (typed on PlayerPokemon; the versus-flip source may be an EnemyPokemon).
    mon.coopOwner = (hostMon as PlayerPokemon).coopOwner ?? "host";
    mon.calculateStats();
    guestSceneInternal.party.push(mon);
  }

  // 3. Assemble a matching Battle with the enemy party rebuilt under the guest scene.
  const hostBattle = hostScene.currentBattle;
  guestScene.currentBattle = new Battle(hostScene.gameMode, {
    waveIndex: hostBattle.waveIndex,
    battleType: hostBattle.battleType as never,
    trainer: hostBattle.trainer ?? undefined,
    double: hostBattle.double,
  });
  // Production captures this immutable source-wave context when it applies the authoritative encounter
  // descriptor. This direct test mirror bypasses EncounterPhase, so mirror that same seam explicitly.
  captureCoopTrainerVictoryBoundary(guestScene, guestScene.currentBattle);
  guestScene.currentBattle.turn = hostBattle.turn;
  const enemyParty: EnemyPokemon[] = [];
  // Versus flip: the guest's local ENEMY party is the host's PLAYER party (the opponent). Co-op: the
  // host's own enemy party.
  for (const [hostEnemyIndex, hostEnemy] of (flip ? hostScene.getPlayerParty() : hostScene.getEnemyParty()).entries()) {
    const data = new PokemonData(hostEnemy);
    const enemy = new EnemyPokemon(
      getPokemonSpecies(hostEnemy.species.speciesId),
      hostEnemy.level,
      // TRAINER-AWARE mirror: carry the host enemy's AUTHORITATIVE trainerSlot verbatim (was hardcoded
      // TrainerSlot.NONE, a wild-only mirror). On a TRAINER wave the host's party-gen keys each mon to
      // TrainerSlot.TRAINER / TRAINER_PARTNER (trainer.ts genPartyMember, alternating for a variant
      // double); a wild wave is TrainerSlot.NONE on every slot. Copying the host's value (never
      // recomputing from the guest's diverged RNG) makes the guest enemy byte-identical in that field and
      // gives the variant-double SLOT GATING (getPartyMemberMatchupScores / getNextSummonIndex filter
      // benched reserves by trainerSlot) the same reserve pool the host has, so the enemy-switch machinery
      // (a trainer sending its next mon after a KO) reconstructs the RIGHT bench mon on-field, which the
      // per-turn checkpoint then reconciles into the guest's on-field checksum. Versus flip: the source is
      // a host PLAYER mon (no trainerSlot), so its local-enemy incarnation gets TrainerSlot.NONE.
      flip ? TrainerSlot.NONE : (hostEnemy as EnemyPokemon).trainerSlot,
      false,
      false,
      data,
    );
    // coopOwner lives on PlayerPokemon in the types but is set per-mon at runtime; write via cast.
    (enemy as unknown as { coopOwner?: string | undefined }).coopOwner = (
      hostEnemy as unknown as { coopOwner?: string | undefined }
    ).coopOwner;
    // #843 BOSS carry: the EnemyPokemon ctor above is passed boss=false, so an adopted BOSS renders +
    // CHECKSUMS as a normal mon (its bossSegments/bossSegmentIndex diverge from the host's). Re-assert the
    // host's authoritative boss state - segment count AND broken-shield index - AFTER the PokemonData
    // round-trip. The checksum hashes bossSegments:bossSegmentIndex, so this is what lets a BOSS wave run
    // the FULL wave-start DIGEST invariant instead of being skipped (mirrors coop-enemy-builder's boss
    // adopt; setBoss with the EXPLICIT count never re-rolls segments from the guest's diverged wave RNG).
    // Boss state is a PvE concept (never in a versus manifest team); the flipped source is a host player
    // mon anyway, so only carry it on the co-op path.
    if (!flip && (hostEnemy as EnemyPokemon).isBoss()) {
      enemy.setBoss(true, (hostEnemy as EnemyPokemon).bossSegments);
      enemy.bossSegmentIndex = (hostEnemy as EnemyPokemon).bossSegmentIndex;
    }
    // A PokemonData constructor can recalculate a different HP ceiling under the guest's module context.
    // The production wave carrier applies the serialized host ceiling in applyCoopEnemies; this direct
    // two-engine mirror must model that same boundary rather than injecting harness-only pre-turn drift.
    const hostScalar = (flip ? hostPlayerScalars : hostEnemyScalars)[hostEnemyIndex];
    const authoritativeMaxHp = hostScalar?.maxHp ?? enemy.getMaxHp();
    const authoritativeHp = hostScalar?.hp ?? hostEnemy.hp;
    if (hostScalar?.stats.length === 6) {
      enemy.stats = [...hostScalar.stats];
    }
    enemy.setStat(Stat.HP, authoritativeMaxHp);
    enemy.hp = Math.max(0, Math.min(authoritativeHp, authoritativeMaxHp));
    enemyParty.push(enemy);
  }
  guestScene.currentBattle.enemyParty = enemyParty;
  guestScene.currentBattle.setFormat(hostBattle.format);
  // Production's encounter-authority ingress initializes a fresh command substrate immediately after
  // adopting the host's format (see applyCoopEncounterAuthority). A bare Battle constructor intentionally
  // leaves these maps unset until the normal new-battle increment, so this direct launch mirror must model
  // that ingress invariant explicitly. Without it, the first REAL guest CommandPhase reaches
  // `turnCommands[fieldIndex]` with an undefined map; the old detached replay helper accidentally hid this
  // because it never drove the production TurnInit -> Command queue.
  const commandSlots = guestScene.currentBattle.arrangement.activeIndices();
  guestScene.currentBattle.turnCommands = Object.fromEntries(commandSlots.map(index => [index, null]));
  guestScene.currentBattle.preTurnCommands = Object.fromEntries(commandSlots.map(index => [index, null]));

  // 4. Put both leads of each side ON the guest field (isActive() reads field membership via
  //    globalScene.field.getIndex). The Pokemon is itself a Phaser Container, so field.add works.
  //    Give each a no-op battleInfo stub (we skipped init(), so the real one was never built) - the
  //    checkpoint apply / updateInfo paths touch it, and headless they need no real UI.
  for (const mon of [...guestSceneInternal.party, ...enemyParty]) {
    stubBattleInfo(mon);
  }
  for (const mon of [...guestScene.getPlayerField(), ...guestScene.getEnemyField()]) {
    guestScene.field.add(mon);
  }
  applyCoopAuthoritativeBattleState(waveBoundaryState ?? undefined, true);
  // setFormat/applyCoopAuthoritativeBattleState may recalculate enemy stats after construction. Re-assert
  // the production carrier's authoritative max-HP rule at the completed mirror boundary.
  if (!flip) {
    const hostEnemies = hostScene.getEnemyParty();
    for (const [index, enemy] of guestScene.getEnemyParty().entries()) {
      const hostEnemy = hostEnemies[index];
      if (hostEnemy != null) {
        const hostScalar = hostEnemyScalars[index];
        const maxHp = hostScalar?.maxHp ?? enemy.getMaxHp();
        if (hostScalar?.stats.length === 6) {
          enemy.stats = [...hostScalar.stats];
        }
        enemy.setStat(Stat.HP, maxHp);
        enemy.hp = Math.max(0, Math.min(hostScalar?.hp ?? hostEnemy.hp, maxHp));
      }
    }
  }
  // The mons were cloned from the host's via a PokemonData round-trip, so their hp / status / stats /
  // moves already match the host exactly. The first replayed turn's CoopFinalizeTurnPhase checkpoint
  // re-asserts the host's authoritative end-of-turn state on top, so no pre-turn full resync is needed
  // (and applyCoopFullSnapshot's updateModifiers UI work would crash the stubbed headless guest mons).
}

/**
 * Neutralize a scene's CandyBar UI for the headless duo harness. When a wave is WON, the (host's, and the
 * guest's authoritative-tail) `VictoryPhase` fires `erRecordAchievementWaveWon`; unlocking an achievement
 * (e.g. REALISTIC_FLASH_IS_BORING) grants team candy, whose `CandyBar.showStarterSpeciesCandy` reads
 * `gameData.starterData[speciesId].candyCount`. For an EVOLVED starter (e.g. GENGAR #94) that read uses the
 * un-root-normalized species id, so the bucket `getStarterDataEntry` created under the ROOT (Gastly #92) is
 * NOT the one read -> `starterData[94]` is undefined -> the read throws INSIDE the CandyBar Promise executor
 * -> an UNHANDLED REJECTION that fails the test. This is best-effort achievement UI, entirely orthogonal to
 * the co-op SYNC layer the duo harness tests, so we replace ONLY the UI call with a resolved no-op (the
 * achievement's own starterData bookkeeping still runs). Idempotent + guarded; a no-op if candyBar is absent.
 */
function neutralizeCoopCandyBar(scene: BattleScene): void {
  const candyBar = (
    scene as unknown as { candyBar?: { showStarterSpeciesCandy?: (id: number, count: number) => Promise<void> } }
  ).candyBar;
  if (candyBar != null) {
    candyBar.showStarterSpeciesCandy = () => Promise.resolve();
  }
}

/**
 * Minimal stateful battleInfo contract so the headless guest mon's updateInfo/initBattleInfo calls do not
 * crash and semantic visibility assertions observe the same `setVisible` contract Phaser exposes.
 *
 * DOCUMENTED RESIDUAL (#633 bounded-scope, "guest mons skip Pokemon.init()"): the guest mons are built by
 * ctor + calculateStats() but NEVER run the full {@linkcode Pokemon.init} - which builds the real
 * PlayerBattleInfo/EnemyBattleInfo container, the mon sprite, and registers the field icon. Running the real
 * init() headless is DISPROPORTIONATE: it constructs Phaser UI/sprite objects the mock texture manager does
 * not back (the full-page render harness exists precisely because the GameManager scene rasterizes nothing),
 * so it would crash or need a second wave of UI stubs for zero fidelity gain - the co-op SYNC layer the duo
 * harness tests do not rasterize battle-info pixels. The tiny proxy therefore models only public state and
 * chainable setters; it is a semantic adapter oracle, never evidence that a browser canvas rendered. Pixel
 * postconditions belong in the built-client two-browser lane.
 */
function makeHeadlessSprite(key: string, visible: boolean): Phaser.GameObjects.Sprite {
  const target: Record<PropertyKey, unknown> = {
    active: true,
    alpha: 1,
    anims: {
      currentAnim: { key },
      duration: 1,
      msPerFrame: 1,
      nextFrame: () => undefined,
      pause: () => undefined,
    },
    frame: { name: 0 },
    originX: 0.5,
    originY: 0.5,
    pipelineData: {},
    texture: { key },
    visible,
    x: 0,
    y: 0,
  };
  let proxy: Record<PropertyKey, unknown>;
  const chain = () => proxy;
  proxy = new Proxy(target, {
    get(t, property) {
      return Reflect.has(t, property) ? Reflect.get(t, property) : chain;
    },
  });
  target.play = (nextKey: string) => {
    target.texture = { key: nextKey };
    target.anims = {
      ...(target.anims as object),
      currentAnim: { key: nextKey },
    };
    return proxy;
  };
  target.setActive = (active: boolean) => {
    target.active = active;
    return proxy;
  };
  target.setAlpha = (alpha: number) => {
    target.alpha = alpha;
    return proxy;
  };
  target.setOrigin = (originX: number, originY = originX) => {
    target.originX = originX;
    target.originY = originY;
    return proxy;
  };
  target.setPosition = (x: number, y: number) => {
    target.x = x;
    target.y = y;
    return proxy;
  };
  target.setTexture = (nextKey: string, frame?: string | number) => {
    target.texture = { key: nextKey };
    target.frame = { name: frame ?? 0 };
    return proxy;
  };
  target.setVisible = (nextVisible: boolean) => {
    target.visible = nextVisible;
    return proxy;
  };
  return proxy as unknown as Phaser.GameObjects.Sprite;
}

export function stubBattleInfo(mon: Pokemon): void {
  // The real PlayerBattleInfo/EnemyBattleInfo was never built (we skipped init()). Keep the small async
  // fallback for data-refresh methods, but model the stateful Phaser setters explicitly. The old proxy
  // returned the same function for `.visible`, so tests compared `[Function noop]` with booleans and could
  // be "fixed" only by production code assigning mock properties directly.
  const noop = () => Promise.resolve();
  const target: Record<PropertyKey, unknown> = {
    visible: false,
    alpha: 1,
    x: 0,
    expMaskRect: { x: 0 },
  };
  let proxy: Record<PropertyKey, unknown>;
  const handler = {
    get(t: Record<PropertyKey, unknown>, p: string | symbol) {
      if (Reflect.has(t, p)) {
        return Reflect.get(t, p);
      }
      return noop;
    },
  };
  proxy = new Proxy(target, handler);
  target.setVisible = (visible: boolean) => {
    target.visible = visible;
    return proxy;
  };
  target.setAlpha = (alpha: number) => {
    target.alpha = alpha;
    return proxy;
  };
  target.setX = (x: number) => {
    target.x = x;
    return proxy;
  };
  (mon as unknown as { battleInfo: unknown }).battleInfo = proxy;
  const key = mon.getBattleSpriteKey();
  const sprite = makeHeadlessSprite(key, false);
  const tintSprite = makeHeadlessSprite(key, false);
  (mon as unknown as { getSprite: () => Phaser.GameObjects.Sprite }).getSprite = () => sprite;
  (mon as unknown as { getTintSprite: () => Phaser.GameObjects.Sprite }).getTintSprite = () => tintSprite;
}

/**
 * Phaser HEADLESS executes the real player-atlas loader but does not populate the texture/animation
 * caches or advance the live sprite from its substitute key. Model only those renderer side effects
 * after the real promise settles. This keeps the production launch gate dependent on a completed load,
 * cache residency, and the exact final live key instead of weakening any of those assertions for CI.
 */
const headlessTextureKeys = new WeakMap<object, Set<string>>();
const headlessAnimationKeys = new WeakMap<object, Set<string>>();
const headlessWrappedPokemon = new WeakMap<BattleScene, WeakSet<object>>();

export function installHeadlessPlayerAtlasCompletionModel(scene: BattleScene): void {
  let textureKeys = headlessTextureKeys.get(scene.textures);
  if (textureKeys == null) {
    textureKeys = new Set<string>();
    headlessTextureKeys.set(scene.textures, textureKeys);
    const originalTextureExists = scene.textures.exists.bind(scene.textures);
    const releasedTextureKeys = textureKeys;
    // Phaser shares cache managers across the BattleScenes created by one HEADLESS game. A per-scene
    // vi.spyOn therefore spies on an existing spy in the next duo test and can recurse. Install one plain,
    // manager-scoped adapter and share its released-key model across every scene using that manager.
    scene.textures.exists = key => releasedTextureKeys.has(String(key)) || originalTextureExists(key);
  }
  let animationKeys = headlessAnimationKeys.get(scene.anims);
  if (animationKeys == null) {
    animationKeys = new Set<string>();
    headlessAnimationKeys.set(scene.anims, animationKeys);
    const originalAnimationExists = scene.anims.exists.bind(scene.anims);
    const releasedAnimationKeys = animationKeys;
    scene.anims.exists = key => releasedAnimationKeys.has(String(key)) || originalAnimationExists(key);
  }
  const releasedTextureKeys = textureKeys;
  const releasedAnimationKeys = animationKeys;
  let wrappedPokemon = headlessWrappedPokemon.get(scene);
  if (wrappedPokemon == null) {
    wrappedPokemon = new WeakSet<object>();
    headlessWrappedPokemon.set(scene, wrappedPokemon);
  }

  // Wrap every currently materialized party object, not only the opening player leads. Turn-finalize
  // readiness also awaits live enemy atlases, and later presentation boundaries may promote a bench mon.
  for (const pokemon of [...scene.getPlayerParty(), ...scene.getEnemyParty()]) {
    if (wrappedPokemon.has(pokemon)) {
      continue;
    }
    wrappedPokemon.add(pokemon);
    const original = pokemon.loadAssets.bind(pokemon);
    // Install a plain per-instance adapter, not a Vitest spy. Renderer proofs legitimately layer their
    // own delay/count spy around this model; spying on an existing spy makes the captured "original"
    // resolve to the newly replaced implementation and recurse forever.
    pokemon.loadAssets = async (ignoreOverride = true, useIllusion = false) => {
      await original(ignoreOverride, useIllusion);
      const key = pokemon.getBattleSpriteKey();
      releasedTextureKeys.add(key);
      releasedAnimationKeys.add(key);
      for (const sprite of [pokemon.getSprite(), pokemon.getTintSprite()]) {
        if (sprite == null) {
          continue;
        }
        const live = sprite as unknown as {
          texture: { key: string };
          anims: { currentAnim?: { key: string } };
        };
        live.texture.key = key;
        live.anims.currentAnim = { key };
      }
    };
  }
}

/**
 * Build a CoopRuntime for one loopback endpoint (host or guest) via the production wiring, WITHOUT
 * tearing down any other live session. Uses {@linkcode assembleCoopRuntime} (the additive seam) so
 * standing up the SECOND client does NOT close the FIRST's loopback transport (connectCoopSession's
 * leading clearCoopRuntime would). The caller registers the live one with setCoopRuntime per pump and
 * drives connect() once on each.
 */
export function buildRuntime(endpoint: CoopTransport, username: string, netcodeMode: "authoritative"): CoopRuntime {
  return assembleCoopRuntime(endpoint, { username, netcodeMode });
}

// ---------------------------------------------------------------------------
// Cooperative scheduler.
// ---------------------------------------------------------------------------

/** A pair whose retained operation envelopes can be pumped only under their destination ClientCtx. */
interface DestinationEnvelopePumpPair {
  host: CoopTransport;
  guest: CoopTransport;
  flush(role: CoopRole, limit?: number): number;
  /**
   * Queue every frame until its destination ClientCtx is installed. The ordinary harness keeps this off
   * outside production-transition surfaces so legacy request/response helpers retain automatic loopback.
   */
  setDestinationContextDelivery?(enabled: boolean): void;
}

/**
 * Test-only adapter for the ordinary microtask loopback used by the legacy duo harness.
 *
 * A retained operation result is applied from the inbound `envelope` handler. Letting the ordinary
 * loopback deliver that handler while the sender's {@linkcode withClient} scope is still installed
 * applies the destination runtime's result against the sender's `globalScene`, then records it as
 * already applied. The later watcher can therefore materialize the journal entry without ever mutating
 * its own scene. Real clients cannot do this because each browser owns an independent global context.
 *
 * Queue `envelope` frames by default. A production-transition surface may temporarily opt every frame
 * into the same destination-context queue while it explicitly alternates client pumps. Handshake,
 * command/request, relay, checkpoint, and state traffic otherwise retain the legacy automatic loopback
 * behavior, so existing command-response tests cannot deadlock. `drainLoopback()` flushes this queue
 * through the active destination ClientCtx. Callers that already provide a full scheduled pair bypass
 * this adapter entirely.
 */
function destinationPumpOperationEnvelopes(pair: {
  host: CoopTransport;
  guest: CoopTransport;
}): DestinationEnvelopePumpPair {
  const queues: Record<CoopRole, CoopMessage[]> = { host: [], guest: [] };
  let destinationContextDelivery = false;

  // These carriers either validate/apply against globalScene immediately or resume a continuation which
  // does. Delivering them synchronously while the sender's ClientCtx is installed can make a valid guest
  // turn inspect the host preimage (and be rejected as malformed), or mutate the host scene through the
  // guest runtime. Real browsers can never borrow one another's globals, so these always wait for the
  // destination pump even outside an explicitly fully-scheduled transition surface.
  const requiresDestinationScene = new Set<CoopMessage["t"]>([
    "envelope",
    "turnResolution",
    "waveResolved",
    "waveEndState",
    "enemyPartySync",
    "stateSync",
    "rewardOptions",
    "authorityFailure",
  ]);

  const wrap = (inner: CoopTransport): { transport: CoopTransport; deliverQueued(message: CoopMessage): void } => {
    const handlers = new Set<(message: CoopMessage) => void>();
    const unsubscribe = inner.onMessage(message => {
      if (requiresDestinationScene.has(message.t) || destinationContextDelivery) {
        queues[inner.role].push(message);
        return;
      }
      for (const handler of [...handlers]) {
        handler(message);
      }
    });

    const transport: CoopTransport = {
      get role(): CoopRole {
        return inner.role;
      },
      get state() {
        return inner.state;
      },
      send: message => inner.send(message),
      onMessage(handler): () => void {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
      onStateChange: handler => inner.onStateChange(handler),
      // authority-v2 duo delivery: forward the per-instance v2 seam straight to the inner loopback so the
      // shadow harness's inbound handler lands on the real endpoint. Inbound v2 frames are held on the inner
      // (setV2InboundDeferred, enabled below) and drained by `flush(role)` under the destination context, so
      // a delivered TURN_COMMIT/receipt applies under the RECEIVING realm - not the sender's ambient.
      ...(typeof inner.onV2Frame === "function" ? { onV2Frame: handler => inner.onV2Frame!(handler) } : {}),
      close(): void {
        unsubscribe();
        handlers.clear();
        queues[inner.role].length = 0;
        inner.close();
      },
      ...(typeof inner.disconnectReason === "function" ? { disconnectReason: () => inner.disconnectReason!() } : {}),
      ...(typeof inner.connectionGeneration === "function"
        ? { connectionGeneration: () => inner.connectionGeneration!() }
        : {}),
      ...(typeof inner.lastRxMs === "function" ? { lastRxMs: () => inner.lastRxMs!() } : {}),
      ...(typeof inner.outboundQueueDepth === "function"
        ? { outboundQueueDepth: () => inner.outboundQueueDepth!() }
        : {}),
      ...(typeof inner.outboundQueueNeedsResync === "function"
        ? { outboundQueueNeedsResync: () => inner.outboundQueueNeedsResync!() }
        : {}),
    };

    return {
      transport,
      deliverQueued(message): void {
        for (const handler of [...handlers]) {
          handler(message);
        }
      },
    };
  };

  const host = wrap(pair.host);
  const guest = wrap(pair.guest);
  const endpoints: Record<CoopRole, ReturnType<typeof wrap>> = { host, guest };
  // authority-v2: HOLD inbound v2 frames on each inner endpoint until `flush(role)` drains them under the
  // destination client's context (see the seam docs on {@link CoopTransport.setV2InboundDeferred}). Legacy
  // CoopMessage traffic keeps its existing queue; the two are independent.
  pair.host.setV2InboundDeferred?.(true);
  pair.guest.setV2InboundDeferred?.(true);
  const wrapped: DestinationEnvelopePumpPair = {
    host: host.transport,
    guest: guest.transport,
    flush(role, limit = Number.POSITIVE_INFINITY): number {
      let delivered = 0;
      while (queues[role].length > 0 && delivered < limit) {
        endpoints[role].deliverQueued(queues[role].shift()!);
        delivered++;
      }
      // Drain this endpoint's deferred inbound v2 frames under the (now-installed) destination context, so a
      // delivered TURN_COMMIT/receipt admits + applies material under the RECEIVING realm.
      delivered += pair[role].pumpV2Inbound?.(limit === Number.POSITIVE_INFINITY ? undefined : limit) ?? 0;
      return delivered;
    },
    setDestinationContextDelivery(enabled): void {
      destinationContextDelivery = enabled;
    },
  };
  return wrapped;
}

/** Drain the loopback microtask queue (LoopbackTransport delivers on queueMicrotask). */
/**
 * #792 exploration: HALT the active client's phase queue after the phase-under-test ends. A manual
 * drive starts ONE phase; when it end()s, the phase manager auto-starts whatever is next - on the
 * guest that can be NewBattlePhase (next-wave generation), which allocation-loops under the
 * harness's headless stubs (tween onComplete re-entry) until the vitest worker OOMs. Unshifting
 * this inert phase parks the queue at a safe boundary instead: its start() never end()s, so
 * nothing downstream auto-runs. Call INSIDE withClient(ctx) right before driving the phase.
 */
export function haltQueueAfterCurrent(): void {
  class HarnessHaltPhase extends Phase {
    public readonly phaseName = "HarnessHaltPhase" as never;
    public override start(): void {
      // Deliberately never end(): the queue parks here.
    }
  }
  globalScene.phaseManager.unshiftPhase(new HarnessHaltPhase() as unknown as Phase);
}

export async function drainLoopback(): Promise<void> {
  // A few macrotask hops flush nested microtask -> microtask deliveries deterministically. When a
  // production-transition rig uses ScheduledCoopPair, deliver only the ACTIVE client's inbox here;
  // its withClient context is fully installed for every handler and await continuation.
  for (let i = 0; i < 4; i++) {
    activeClientInboundPump?.();
    await new Promise<void>(r => setTimeout(r, 0));
  }
}

/**
 * Reproduce the one scheduler edge omitted by the directly-constructed guest scene. Its boot TitlePhase is
 * deliberately inert, while production Phaser automatically shifts an engine-owned retained wave tail that
 * arrives behind it. No other queue shape is admitted here.
 */
export function shiftQueuedGuestBootTail(scene: BattleScene): boolean {
  const phase = scene.phaseManager.getCurrentPhase();
  const queued = scene.phaseManager.getQueuedPhaseNames?.() ?? [];
  if (phase?.phaseName !== "TitlePhase" || (queued[0] !== "CoopFinalizeTurnPhase" && queued[0] !== "VictoryPhase")) {
    return false;
  }
  scene.phaseManager.shiftPhase();
  return true;
}

/**
 * Drive one manually-pumped client's REAL phase queue until `target` is current, stopping BEFORE the
 * target starts. This is the guest-side counterpart to {@linkcode PhaseInterceptor.to(..., false)}:
 * the duo guest has no interceptor because its scene is constructed directly, but production-transition
 * journeys still need to execute the phases that production queued rather than constructing replacement
 * phase objects or cloning the host's state.
 *
 * Call inside {@linkcode withClient}. Scheduled transport delivery is pumped before and while every phase
 * runs, so an awaited enemy-party carrier resumes only while the destination client's complete context is
 * installed. A phase is started exactly once; failure to change phase within `perPhaseTimeoutMs` throws with
 * the current queue shape instead of turning a missing carrier or unexpected UI prompt into a CI timeout.
 */
export async function driveClientPhaseQueueTo(
  scene: BattleScene,
  target: string,
  options: {
    matches?: (phase: Phase) => boolean;
    maxPhases?: number;
    perPhaseTimeoutMs?: number;
    /** Pump the other browser's scheduled inbox while this client's real phase awaits a reciprocal route. */
    pumpPeer?: () => Promise<void>;
    /** Drive an explicitly-recognized public prompt while the current phase remains blocked on human input. */
    drivePublicPhaseInput?: (phase: Phase) => boolean | Promise<boolean>;
  } = {},
): Promise<Phase> {
  const matches = options.matches ?? (phase => phase.phaseName === target);
  const maxPhases = options.maxPhases ?? 128;
  const perPhaseTimeoutMs = options.perPhaseTimeoutMs ?? 10_000;

  for (let step = 0; step < maxPhases; step++) {
    await drainLoopback();
    const phase = scene.phaseManager.getCurrentPhase();
    if (phase == null) {
      throw new Error(`client phase drive to ${target} lost its current phase at step ${step}`);
    }
    if (matches(phase)) {
      return phase;
    }

    if (shiftQueuedGuestBootTail(scene)) {
      continue;
    }

    // The production browser's atlas loader populates renderer caches for every newly materialized
    // battler. A long-running headless journey creates fresh enemy objects after buildDuo's initial
    // installation, so refresh the completion model at each real phase boundary before that phase can
    // exercise the exact launch-ready gate. This wraps only newly seen Pokemon and remains idempotent.
    installHeadlessPlayerAtlasCompletionModel(scene);
    phase.start();
    const deadline = Date.now() + perPhaseTimeoutMs;
    while (scene.phaseManager.getCurrentPhase() === phase) {
      await options.drivePublicPhaseInput?.(phase);
      await options.pumpPeer?.();
      await drainLoopback();
      if (Date.now() >= deadline) {
        const queued = scene.phaseManager.getQueuedPhaseNames?.() ?? [];
        throw new Error(
          `client phase drive to ${target} HANG on ${phase.phaseName}; queued=[${queued.join(",")}], `
            + `ui=${UiMode[scene.ui.getMode()] ?? scene.ui.getMode()}`,
        );
      }
    }
  }

  const current = scene.phaseManager.getCurrentPhase();
  const queued = scene.phaseManager.getQueuedPhaseNames?.() ?? [];
  throw new Error(
    `client phase drive to ${target} exceeded ${maxPhases} phases; `
      + `current=${current?.phaseName ?? "(none)"}, queued=[${queued.join(",")}]`,
  );
}

export type { Pokemon };

// =============================================================================
// MULTI-WAVE EXTENSION (#633). Standing up BOTH runtimes + the guest engine once, then a
// per-wave pump that re-mirrors the host's freshly-rolled battle onto the guest each wave
// (the spike mirrored only wave 1), plus a REAL owner/watcher reward-shop drive over the
// loopback. Everything below builds on the spike primitives above (withClient / drainLoopback
// / mirrorHostBattleToGuest / buildGuestScene / buildRuntime) - it does NOT rewrite them.
// =============================================================================

/** The standing two-engine rig: both runtimes assembled over ONE loopback pair, both ctxs ready. */
export interface DuoRig {
  hostScene: BattleScene;
  guestScene: BattleScene;
  hostRuntime: CoopRuntime;
  guestRuntime: CoopRuntime;
  hostCtx: ClientCtx;
  guestCtx: ClientCtx;
  /** The loopback pair both runtimes ride (raw endpoints exposed for assertion taps). */
  pair: {
    host: CoopTransport;
    guest: CoopTransport;
    /** Test-only full destination scheduling used by production-transition interaction surfaces. */
    setDestinationContextDelivery?: (enabled: boolean) => void;
  };
}

/**
 * A guest wave reached through the real queued between-wave transition. Every turn in that same wave must
 * replace its live command surface through the phase manager, rather than start a detached replay object
 * whose `end()` would shift an unrelated queue. The exact wave fence naturally expires at the next battle.
 */
const realGuestCommandBoundaries = new WeakMap<object, { wave: number; turn: number }>();

/**
 * Record that the guest reached its real queued public CommandPhase for this exact address. The replay
 * pump then replaces that proven surface through the phase manager instead of starting a detached replay
 * object whose end() would shift an unrelated tail.
 */
export function markRealGuestCommandBoundary(scene: BattleScene, wave: number, turn: number): void {
  const current = scene.phaseManager.getCurrentPhase();
  if (
    current?.phaseName !== "CommandPhase"
    || scene.currentBattle.waveIndex !== wave
    || scene.currentBattle.turn !== turn
  ) {
    throw new Error(
      `cannot mark guest command boundary ${wave}:${turn} from `
        + `${current?.phaseName ?? "none"} ${scene.currentBattle.waveIndex}:${scene.currentBattle.turn}`,
    );
  }
  realGuestCommandBoundaries.set(scene, { wave, turn });
}

/**
 * Replace the directly-constructed guest scene's inert boot TitlePhase with the production guest input tail.
 *
 * A real browser reaches wave one through NewBattle -> Encounter -> TurnInit. `buildDuo` intentionally mirrors
 * the already-live host battle instead, so those boot phases never ran. Depending on whether the fixture's
 * phase interceptor has advanced once, the inert shape is Login -> [Title] or Title -> [].
 * Materialize exactly the omitted TurnInit boundary through the real phase manager; TurnInit then creates the
 * actual per-slot CommandPhases and renderer TurnStart tail. This is valid only for that empty boot shape.
 */
export function materializeMirroredGuestInputTurn(scene: BattleScene): void {
  const current = scene.phaseManager.getCurrentPhase();
  const queued = scene.phaseManager.getQueuedPhaseNames?.() ?? [];
  const untouchedLoginBoot = current?.phaseName === "LoginPhase" && queued.length === 1 && queued[0] === "TitlePhase";
  const untouchedTitleBoot = current?.phaseName === "TitlePhase" && queued.length === 0;
  if (!untouchedLoginBoot && !untouchedTitleBoot) {
    throw new Error(
      `cannot materialize mirrored guest input from ${current?.phaseName ?? "none"}; queued=[${queued.join(",")}]`,
    );
  }
  scene.phaseManager.clearPhaseQueue();
  scene.phaseManager.unshiftPhase(scene.phaseManager.create("TurnInitPhase"));
  scene.phaseManager.shiftPhase();
}

/**
 * Drain retained-operation follow-ups under each destination's complete client context.
 *
 * One pass delivers the result and may enqueue an exact ACK or an authority response in the opposite
 * direction. A second pass therefore closes the round trip without ever installing the wrong scene for
 * an inbound envelope. Scheduled and ordinary envelope-pumped rigs share this same primitive.
 */
export async function pumpDuoDestinations(rig: DuoRig, rounds = 2): Promise<void> {
  for (let round = 0; round < rounds; round++) {
    await withClient(rig.hostCtx, () => drainLoopback());
    await withClient(rig.guestCtx, () => drainLoopback());
  }
}

/**
 * Settle one asynchronous two-engine crossing while alternately installing each browser's complete
 * destination context.
 *
 * A fixed number of transport pumps is not a valid substitute for two independent event loops: a retained
 * result can close a guest UI, schedule a durability retry, and emit its material ACK only after several
 * microtask/timer turns. Waiting on the authority promise while only the host context is installed then
 * manufactures a soft-lock that cannot happen in two real browsers. This helper keeps both clients alive
 * until the exact promise settles, or throws a bounded diagnostic with both phase queues.
 */
export async function settleDuoPromise<T>(
  rig: DuoRig,
  pending: Promise<T>,
  label: string,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const intervalMs = options.intervalMs ?? 10;
  let settled = false;
  let rejected = false;
  let failure: unknown;
  pending.then(
    () => {
      settled = true;
    },
    error => {
      rejected = true;
      failure = error;
      settled = true;
    },
  );

  const deadline = Date.now() + timeoutMs;
  while (!settled && Date.now() < deadline) {
    await withClient(rig.hostCtx, async () => {
      await drainLoopback();
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    });
    await withClient(rig.guestCtx, async () => {
      await drainLoopback();
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    });
    if (!settled) {
      await new Promise<void>(resolve => setTimeout(resolve, intervalMs));
    }
  }

  if (!settled) {
    const hostCurrent = rig.hostScene.phaseManager.getCurrentPhase()?.phaseName ?? "(none)";
    const guestCurrent = rig.guestScene.phaseManager.getCurrentPhase()?.phaseName ?? "(none)";
    const hostQueued = rig.hostScene.phaseManager.getQueuedPhaseNames?.() ?? [];
    const guestQueued = rig.guestScene.phaseManager.getQueuedPhaseNames?.() ?? [];
    throw new Error(
      `${label} did not settle while both destination contexts were pumped; `
        + `host=${hostCurrent} queued=[${hostQueued.join(",")}], `
        + `guest=${guestCurrent} queued=[${guestQueued.join(",")}]`,
    );
  }
  if (rejected) {
    throw failure;
  }
  return await pending;
}

/**
 * Finish the real replay/finalize tail left by a replacement picker, then recreate the one omitted
 * TurnInit boundary of a directly mirrored headless guest.
 *
 * The helper is deliberately strict: it only accepts the replay tail or untouched boot shape produced by
 * the duo builders. It never clears an arbitrary live queue to make a test green.
 */
export async function materializeGuestInputAfterReplacement(scene: BattleScene): Promise<void> {
  const current = scene.phaseManager.getCurrentPhase();
  const queued = scene.phaseManager.getQueuedPhaseNames?.() ?? [];
  if (current?.phaseName === "CoopFinalizeTurnPhase" || queued.includes("CoopFinalizeTurnPhase")) {
    const finalize =
      current?.phaseName === "CoopFinalizeTurnPhase"
        ? current
        : await driveClientPhaseQueueTo(scene, "replacement CoopFinalizeTurnPhase", {
            matches: phase => phase.phaseName === "CoopFinalizeTurnPhase",
            perPhaseTimeoutMs: 5_000,
          });
    finalize.start();
    const deadline = Date.now() + 5_000;
    while (scene.phaseManager.getCurrentPhase() === finalize) {
      await drainLoopback();
      if (Date.now() >= deadline) {
        throw new Error("replacement CoopFinalizeTurnPhase did not finish");
      }
    }
  }
  materializeMirroredGuestInputTurn(scene);
}

/**
 * Bring both real clients to the reciprocal command boundary and submit Tackle for the guest-owned
 * battler exclusively through the production Command/Fight/TargetSelect UI handlers.
 *
 * Scheduled duo tests call this while automatic transport delivery is disabled. Every addressed packet
 * is therefore pumped only while its destination's complete client context is installed, matching two
 * browser processes instead of allowing a shared-process async continuation to borrow the other scene.
 */
export async function driveDuoGuestTackleThroughPublicUi(
  hostGame: GameManager,
  rig: DuoRig,
  options: { restartAlreadyOpenHost?: boolean } = {},
): Promise<void> {
  const guestOwnCommand = await withClient(rig.guestCtx, () =>
    driveClientPhaseQueueTo(rig.guestScene, "guest-owned CommandPhase", {
      matches: phase =>
        phase.phaseName === "CommandPhase"
        && (phase as unknown as { getFieldIndex(): number }).getFieldIndex() === COOP_GUEST_FIELD_INDEX,
    }),
  );
  await withClient(rig.guestCtx, async () => {
    guestOwnCommand.start();
    await drainLoopback();
  });

  await withClient(rig.hostCtx, async () => {
    await drainLoopback();
    if (options.restartAlreadyOpenHost) {
      // Wave 1 opened before buildDuo installed the live runtime. Re-enter that untouched public phase
      // once so it participates in the now-live reciprocal rendezvous.
      rig.hostScene.phaseManager.getCurrentPhase().start();
      await drainLoopback();
    } else if (rig.hostScene.phaseManager.getCurrentPhase().phaseName === "CommandPhase") {
      // Between-wave callers deliberately stop BEFORE this exact phase so both clients can materialize
      // before either input surface opens. Start the prepared host phase here, alongside the prepared guest
      // phase above. Treating a merely-current phase as already started omitted the host rendezvous arrival
      // and left the guest correctly sealed at MESSAGE on every wave after the first. A few older journeys
      // intentionally ran the target CommandPhase before the next loop; preserve that already-open surface
      // instead of starting the same phase twice.
      if (rig.hostScene.ui.getMode() !== UiMode.COMMAND && rig.hostScene.ui.getMode() !== UiMode.FIGHT) {
        rig.hostScene.phaseManager.getCurrentPhase().start();
      }
      await drainLoopback();
    } else {
      await hostGame.phaseInterceptor.to("CommandPhase");
    }
  });

  await withClient(rig.guestCtx, async () => {
    await drainLoopback();
    expect(rig.guestScene.ui.getMode(), "guest command UI opens only after both clients arrive").toBe(UiMode.COMMAND);
    expect(rig.guestScene.ui.processInput(Button.ACTION), "guest selects Fight through COMMAND UI").toBe(true);
    expect(rig.guestScene.ui.getMode(), "guest reaches the move picker").toBe(UiMode.FIGHT);
    expect(rig.guestScene.ui.processInput(Button.ACTION), "guest selects Tackle through FIGHT UI").toBe(true);

    // The direct guest scene uses a manual phase manager. The Fight click queues the production target
    // phase, so start that real queued phase before sending the target inputs.
    const targetPhase = await driveClientPhaseQueueTo(rig.guestScene, "SelectTargetPhase");
    targetPhase.start();
    await drainLoopback();
    expect(rig.guestScene.ui.getMode(), "guest reaches the real target picker").toBe(UiMode.TARGET_SELECT);
    expect(rig.guestScene.ui.processInput(Button.RIGHT), "guest moves to the second enemy target").toBe(true);
    expect(rig.guestScene.ui.processInput(Button.ACTION), "guest confirms the second enemy target").toBe(true);
    await drainLoopback();
    await driveClientPhaseQueueTo(rig.guestScene, "CoopReplayTurnPhase");
  });
  await withClient(rig.hostCtx, () => drainLoopback());
}

/** Every in-process duo assembled by this module and not yet fully torn down. */
const liveDuoRigs = new Set<DuoRig>();

/**
 * TIMER OWNERSHIP (the gate-4 29600149131 SwitchSummonPhase orphan class): in two real browsers every
 * timer fires inside the event loop of the client that scheduled it. In this one-process harness both
 * scenes' MockClocks tick off ambient 1ms setIntervals and the host interceptor advances phases from
 * vi.waitUntil timer callbacks - all under WHATEVER ClientCtx happens to be installed at that instant.
 * Evidence from the seating duo logs: the HOST's summon continuation (delayedCall -> end() ->
 * queuePostSummon -> shiftPhase) fired while the GUEST ctx was resident, so the host phase pushed
 * PostSummonPhase onto the GUEST's phase manager (allowlist-neutralized there, correctly) and shifted
 * the GUEST's queue - orphaning the host's own queue inside SwitchSummonPhase forever, which the
 * turn-commit machinery then surfaced as an endless RE-SEND/requestTurnCommit ping-pong.
 *
 * Pin each engine's callback DISPATCH to its owning client's ctx:
 *  - each scene's clock update (fires delayedCall callbacks) runs under that scene's ctx;
 *  - the host interceptor's run() (the synchronous phase.start() head; the awaited tail is a passive
 *    poll, so withClientSync's restore-after-sync-head is exactly right) runs under the host ctx;
 *  - default-scheduled durability recovery/deferral timers fire under the ctx installed when they
 *    were scheduled (production wrapper is null - zero live impact).
 */
const duoCtxPinDisposers = new WeakMap<DuoRig, (() => void)[]>();

function installDuoCtxOwnershipPins(rig: DuoRig, hostGame: GameManager): void {
  const disposers: (() => void)[] = [];
  const pinClock = (scene: BattleScene, ctx: ClientCtx): void => {
    const clock = scene.time as unknown as {
      update: (time: number, delta: number) => void;
      _active?: unknown[];
    };
    const originalUpdate = clock.update.bind(scene.time);
    clock.update = (time: number, delta: number): void => {
      // Only a tick that can FIRE callbacks needs the swap; an idle clock stays a cheap direct call.
      if ((clock._active?.length ?? 0) === 0 || activeClientLabel === ctx.label) {
        originalUpdate(time, delta);
        return;
      }
      withClientSync(ctx, () => originalUpdate(time, delta));
    };
    disposers.push(() => {
      clock.update = originalUpdate;
    });
  };
  pinClock(rig.hostScene, rig.hostCtx);
  pinClock(rig.guestScene, rig.guestCtx);

  const interceptor = hostGame.phaseInterceptor as unknown as { run: (phase: Phase) => Promise<void> };
  const originalRun = interceptor.run.bind(hostGame.phaseInterceptor);
  interceptor.run = (phase: Phase): Promise<void> => {
    if (activeClientLabel === rig.hostCtx.label) {
      return originalRun(phase);
    }
    // A phase started from a FOREIGN-ctx interceptor tick must run its synchronous `phase.start()` head
    // under the host ctx - AND drain the promise-MICROTASK continuations that head schedules under the
    // host ctx too. The test framework mocks `tweens.add` to fire `onComplete` synchronously
    // (game-wrapper.ts), so a phase like ShowAbilityPhase / HideAbilityPhase resolves its
    // `abilityBar.showAbility()` promise inside `start()`, and its `.then(() => this.end())` runs on the
    // NEXT microtask. `Phase.end()` shifts the PROCESS-GLOBAL `globalScene.phaseManager` (phase.ts): if
    // that microtask drains after a synchronous `withClientSync` restore, it shifts the GUEST queue and
    // orphans the host phase - the interceptor state never leaves "running", so `to(...)` soft-locks at
    // ShowAbilityPhase/HideAbilityPhase (the showdown-versus-faint + double-faint summon-path stalls).
    // Hold the host ctx across a few microtask hops so `end()` lands on the HOST phase manager; the awaited
    // POLL tail is a passive state poll and returns under ambient ctx, so macrotask guest pumps still
    // interleave there (a genuinely guest-dependent phase completes via the clock/loopback pins, not here -
    // no deadlock, since only MICROTASKS are held and the guest pump is a macrotask).
    let poll: Promise<void> | undefined;
    return withClient(rig.hostCtx, async () => {
      poll = originalRun(phase);
      for (let i = 0; i < 4; i++) {
        await Promise.resolve();
      }
    }).then(() => poll ?? Promise.resolve());
  };
  disposers.push(() => {
    interceptor.run = originalRun;
  });

  // Idempotent (re)install: capture the scheduling client at schedule time; passthrough when no duo
  // window is installed (single-engine tests in the same worker are untouched).
  setCoopDurabilityScheduleWrapperForTesting(callback => {
    const owner = activeClientCtx;
    if (owner == null) {
      return callback;
    }
    return () => {
      if (activeClientLabel === owner.label) {
        callback();
        return;
      }
      withClientSync(owner, callback);
    };
  });
  disposers.push(() => setCoopDurabilityScheduleWrapperForTesting(null));

  // RAW setTimeout ownership: engine code also schedules continuation timers directly (e.g.
  // setModeBoundedWhen's bounded verdict timer evaluates boundaryStillLive - which reads the ACTIVE
  // runtime - inside a raw setTimeout; gate 29608072519 seating: that predicate fired under the guest
  // window, judged the host boundary dead, and terminaled a healthy session). A timer scheduled while
  // a client window is installed fires under that client; timers scheduled with NO window installed
  // (vitest internals, the settle loop's own sleeps) pass through untouched.
  const originalSetTimeout = globalThis.setTimeout;
  const pinnedSetTimeout = ((handler: unknown, timeout?: number, ...timerArgs: unknown[]) => {
    const owner = typeof handler === "function" ? activeClientCtx : null;
    if (owner == null) {
      return (originalSetTimeout as (...a: unknown[]) => unknown)(handler, timeout, ...timerArgs);
    }
    const fn = handler as (...a: unknown[]) => void;
    return (originalSetTimeout as (...a: unknown[]) => unknown)(
      (...cbArgs: unknown[]) => {
        if (activeClientLabel === owner.label) {
          fn(...cbArgs);
          return;
        }
        withClientSync(owner, () => fn(...cbArgs));
      },
      timeout,
      ...timerArgs,
    );
  }) as typeof setTimeout;
  globalThis.setTimeout = pinnedSetTimeout;
  disposers.push(() => {
    if (globalThis.setTimeout === pinnedSetTimeout) {
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  duoCtxPinDisposers.set(rig, disposers);
}

/**
 * Dispose both independently assembled runtimes owned by a duo rig.
 *
 * `clearCoopRuntime()` can only see the process-global active runtime. Most duo tests leave the guest
 * active after their final context swap, which used to dispose only that side and leave the host's
 * retransmit/watchdog timers alive in the next test. Select each side explicitly so test isolation matches
 * two real browser processes and no retained commit from a completed rig can bleed into another session.
 */
export function disposeDuoRig(rig: DuoRig): void {
  liveDuoRigs.delete(rig);
  // Unwind the ctx-ownership pins FIRST: the scenes' MockClock setIntervals are eternal (never
  // cleared across tests), and a still-pinned tick after this rig's teardown would keep doing full
  // ctx swaps - whose install logging races vitest's console RPC at environment teardown
  // (gate 29605676187: every shard's tests PASSED yet the worker died with
  // "Closing rpc while onUserConsoleLog was pending").
  for (const dispose of duoCtxPinDisposers.get(rig) ?? []) {
    dispose();
  }
  duoCtxPinDisposers.delete(rig);
  for (const runtime of [rig.guestRuntime, rig.hostRuntime]) {
    if (runtime.localTransport.state === "closed") {
      continue;
    }
    setCoopRuntime(runtime);
    clearCoopRuntime();
  }
}

/**
 * A duo test owns two runtimes even though production's global accessor exposes only one. Register this
 * file-local hook once so every importing suite gets strict two-process-equivalent teardown, including a
 * failed test that never reaches its own cleanup statements.
 */
afterEach(() => {
  for (const rig of [...liveDuoRigs]) {
    disposeDuoRig(rig);
  }
});

interface RetainedWaveBoundaryBridge {
  readonly hostScene: BattleScene;
  readonly hostCtx: ClientCtx;
  readonly runBattleEnd: () => Promise<void>;
}

/**
 * Test-only bridge from a headless guest scene to the real host BattleEnd boundary that owns the complete
 * retained WAVE_ADVANCE transaction. Production clients advance concurrently; the in-process duo harness
 * deliberately pumps them sequentially and therefore must finish this host boundary before replaying a
 * winning guest turn. Weak keys prevent a completed rig from becoming process-global test state.
 */
const retainedWaveBoundaryByGuestScene = new WeakMap<object, RetainedWaveBoundaryBridge>();

function registerRetainedWaveBoundaryBridge(
  hostGame: GameManager,
  hostScene: BattleScene,
  guestScene: BattleScene,
  hostCtx: ClientCtx,
): void {
  retainedWaveBoundaryByGuestScene.set(guestScene, {
    hostScene,
    hostCtx,
    runBattleEnd: async () => {
      await hostGame.phaseInterceptor.to("BattleEndPhase");
    },
  });
}

async function maybeSealHostRetainedWaveBoundary(
  guestScene: ReplayPumpScene,
  sealRetainedWaveBoundary: boolean,
): Promise<void> {
  if (!sealRetainedWaveBoundary) {
    return;
  }
  const bridge = retainedWaveBoundaryByGuestScene.get(guestScene as object);
  if (bridge == null) {
    return;
  }
  await withClient(bridge.hostCtx, async () => {
    const hostBattle = bridge.hostScene.currentBattle;
    const guestBattle = (guestScene as BattleScene).currentBattle;
    const hostPhase = bridge.hostScene.phaseManager.getCurrentPhase();
    const mysteryBattle =
      hostBattle?.battleType === BattleType.MYSTERY_ENCOUNTER
      || (coopMeHandoffBattleStarted() && coopMeHandoffBattleWaveValue() === hostBattle?.waveIndex);
    if (
      !isCoopWaveAdvanceOperationEnabled()
      || bridge.hostCtx.runtime.controller.role !== "host"
      || hostBattle == null
      || guestBattle == null
      || hostBattle.waveIndex !== guestBattle.waveIndex
      || hostPhase?.phaseName !== "BattleEndPhase"
      || mysteryBattle
    ) {
      return;
    }
    await bridge.runBattleEnd();
  });
  // The nested host pump restores the caller's guest context before this drain. Any retained envelope is
  // therefore delivered/applied under the correct process-global scene/runtime in the sequential harness.
  await drainLoopback();
}

/**
 * Stand up the full two-engine rig over ONE {@linkcode createLoopbackPair}: assemble BOTH runtimes
 * (via {@linkcode assembleCoopRuntime}, so neither close the other's transport), build the GUEST
 * {@linkcode BattleScene}, mirror the host's CURRENT battle onto it, tag co-op field ownership on
 * both, connect both controllers, and drain the handshake. After this the host OWNS even interaction
 * counters (the first reward shop, counter 0) and the guest OWNS odd ones - the production parity rule.
 *
 * MUST be called with the HOST GameManager already in a live battle (game.classicMode.startBattle).
 * Returns the {@linkcode DuoRig}; the caller pumps it wave by wave with the drive* helpers below.
 */
export async function buildDuo(
  hostGame: GameManager,
  pair: { host: CoopTransport; guest: CoopTransport },
  setCoopRuntimeFn: (r: CoopRuntime) => void,
  toCoopGameMode: (scene: BattleScene) => void,
): Promise<DuoRig> {
  const hostScene = hostGame.scene;
  // Headless best-effort UI: neutralize the host's achievement candy-bar UI (see neutralizeCoopCandyBar)
  // so a won wave's REALISTIC_FLASH candy grant on an evolved starter can't throw an unhandled rejection.
  neutralizeCoopCandyBar(hostScene);
  const suppliedPair = pair as typeof pair & { flush?: (role: CoopRole, limit?: number) => number };
  // Full scheduled (including fault-wrapped scheduled) pairs already own destination delivery. Ordinary
  // loopback/fault pairs gain only the retained-envelope pump; all other traffic remains automatic.
  const runtimePair: DestinationEnvelopePumpPair =
    typeof suppliedPair.flush === "function"
      ? (suppliedPair as DestinationEnvelopePumpPair)
      : destinationPumpOperationEnvelopes(suppliedPair);
  const hostRuntime = buildRuntime(runtimePair.host, "Host", "authoritative");
  const guestRuntime = buildRuntime(runtimePair.guest, "Guest", "authoritative");
  hostRuntime.controller.role = "host";
  guestRuntime.controller.role = "guest";

  // Flip the host engine into co-op + tag the party leads host/guest. Tag by PARTY index, not field: in a
  // final-boss STAGE-ONE the player field is single (only slot 0 is summoned), yet the co-op party still
  // holds the guest partner's mon on the BENCH (slot 1). A field-only tag left that benched partner
  // untagged, so a stage-one rig had "no healthy guest-owned bench mon" (coop-final-boss-stage-one). Slots
  // 0/1 ARE field 0/1 in a normal double battle, so this is byte-identical for every doubles rig.
  toCoopGameMode(hostScene);
  const hostParty = hostScene.getPlayerParty();
  if (hostParty[0] != null) {
    hostParty[0].coopOwner = "host";
  }
  if (hostParty[1] != null) {
    hostParty[1].coopOwner = "guest";
  }

  const hostCtx: ClientCtx = {
    label: "host",
    scene: hostScene,
    runtime: hostRuntime,
    rndState: Phaser.Math.RND.state(),
    ghost: snapshotGhostState(),
    // #837: seed both ctxs from the host's current module-let state (the launch mirror), so each engine
    // starts identical and thereafter keeps its OWN money-streak / overstay / relic state.
    moduleLets: snapshotModuleLets(),
    biomeState: snapshotBiomeModuleState(),
    mePins: { ...IDLE_ME_PINS },
    pumpInbound: () => runtimePair.flush("host"),
  };

  // The 2nd real BattleScene (steals globalScene; withClient re-points it per pump).
  const guestScene = buildGuestScene(hostGame);
  installHeadlessCoopSemanticProjectionOracle(guestScene);
  // BattleScene construction resets process-global ER module state. Production clients are separate
  // processes, so creating the guest must not clobber the already-running host's authoritative state.
  restoreModuleLets(hostCtx.moduleLets!);
  const guestCtx: ClientCtx = {
    label: "guest",
    scene: guestScene,
    runtime: guestRuntime,
    rndState: Phaser.Math.RND.state(),
    ghost: emptyGhostSnapshot(),
    moduleLets: structuredClone(hostCtx.moduleLets!),
    biomeState: structuredClone(hostCtx.biomeState!),
    mePins: { ...IDLE_ME_PINS },
    pumpInbound: () => runtimePair.flush("guest"),
  };
  await withClient(guestCtx, () => {
    toCoopGameMode(guestScene);
    mirrorHostBattleToGuest(hostScene, guestScene);
    // The real-browser loader populates Phaser's texture/animation caches and advances the live sprite key.
    // HEADLESS deliberately omits those renderer effects. Install their faithful completion model for every
    // two-engine rig, rather than relying on individual tests to remember a non-gameplay wiring step.
    installHeadlessPlayerAtlasCompletionModel(guestScene);
    const gf = guestScene.getPlayerField();
    if (gf[0] != null) {
      gf[0].coopOwner = "host";
    }
    if (gf[1] != null) {
      gf[1].coopOwner = "guest";
    }
  });
  registerRetainedWaveBoundaryBridge(hostGame, hostScene, guestScene, hostCtx);

  // Connect both controllers over the live loopback (exchange hello / runConfig).
  setCoopRuntimeFn(hostRuntime);
  hostRuntime.controller.connect();
  setCoopRuntimeFn(guestRuntime);
  guestRuntime.controller.connect();
  await drainLoopback();

  const rig = { hostScene, guestScene, hostRuntime, guestRuntime, hostCtx, guestCtx, pair: runtimePair };
  installDuoCtxOwnershipPins(rig, hostGame);
  liveDuoRigs.add(rig);
  return rig;
}

/**
 * Re-mirror a deliberately abbreviated/bootstrapped guest fixture. A guest that already crossed the real
 * queued NewBattle -> Encounter -> Command boundary must retain the state it adopted from the carrier;
 * overwriting it here would turn a production-transition test back into a state-clone test.
 */
export async function remirrorWave(rig: DuoRig, opts?: { preserveGuestPlayerParty?: boolean }): Promise<void> {
  const materialized = realGuestCommandBoundaries.get(rig.guestScene);
  if (
    materialized != null
    && materialized.wave === rig.hostScene.currentBattle.waveIndex
    && materialized.wave === rig.guestScene.currentBattle.waveIndex
    && materialized.turn === rig.guestScene.currentBattle.turn
  ) {
    return;
  }
  realGuestCommandBoundaries.delete(rig.guestScene);
  await withClient(rig.guestCtx, () => {
    mirrorHostBattleToGuest(rig.hostScene, rig.guestScene, opts);
    const gf = rig.guestScene.getPlayerField();
    // Classic wave 200 deliberately starts with one field slot; phase two enables doubles and
    // summons the partner. Preserve ownership for every slot that exists instead of manufacturing
    // a stage-one partner or crashing while trying to tag it.
    if (gf[0] != null) {
      gf[0].coopOwner = "host";
    }
    if (gf[1] != null) {
      gf[1].coopOwner = "guest";
    }
  });
}

/**
 * Bring the two-engine fixture to a reciprocal command boundary.
 *
 * For an ordinary next-turn rendezvous, the already-materialized guest only needs to announce arrival.
 * For a between-wave boundary, first drive the HOST's real post-shop queue until its Encounter publishes
 * the retained enemy carrier, then drive the GUEST's real CoopPartnerSync -> NewBattle -> Encounter queue
 * until it consumes that carrier and reaches CommandPhase. Only after both engines have materialized the
 * exact wave/turn does the harness announce the guest command arrival. This preserves the production
 * ordering while leaving the host CommandPhase unstarted for the test framework's public driver.
 */
export async function arriveGuestCommandBoundary(rig: DuoRig, wave: number, turn = 1): Promise<void> {
  if (rig.hostScene.currentBattle.waveIndex < wave || rig.guestScene.currentBattle.waveIndex < wave) {
    await withClient(rig.hostCtx, () =>
      driveClientPhaseQueueTo(rig.hostScene, `host wave ${wave} CommandPhase`, {
        matches: phase =>
          phase.phaseName === "CommandPhase"
          && rig.hostScene.currentBattle.waveIndex === wave
          && rig.hostScene.currentBattle.turn === turn,
      }),
    );
    await withClient(rig.guestCtx, () =>
      driveClientPhaseQueueTo(rig.guestScene, `guest wave ${wave} CommandPhase`, {
        matches: phase =>
          phase.phaseName === "CommandPhase"
          && rig.guestScene.currentBattle.waveIndex === wave
          && rig.guestScene.currentBattle.turn === turn,
      }),
    );
    markRealGuestCommandBoundary(rig.guestScene, wave, turn);
  }

  if (
    rig.hostScene.currentBattle.waveIndex !== wave
    || rig.guestScene.currentBattle.waveIndex !== wave
    || rig.hostScene.currentBattle.turn !== turn
    || rig.guestScene.currentBattle.turn !== turn
  ) {
    throw new Error(
      `command boundary ${wave}:${turn} was not materialized on both clients `
        + `(host=${rig.hostScene.currentBattle.waveIndex}:${rig.hostScene.currentBattle.turn}, `
        + `guest=${rig.guestScene.currentBattle.waveIndex}:${rig.guestScene.currentBattle.turn})`,
    );
  }

  await withClient(rig.guestCtx, () => {
    rig.guestRuntime.rendezvous.arrive(`cmd:${wave}:${turn}`);
  });
  await drainLoopback();
}

// ---------------------------------------------------------------------------
// Guest replay pump (the spike's driveGuestReplayTurn, promoted to the harness so the
// multi-wave loop can reuse it). Starts a real CoopReplayTurnPhase + drains the presentation
// phases it unshifts PLUS the deferred CoopFinalizeTurnPhase (applies the host checkpoint,
// verifies the checksum, queues the turn-end + wave-advance tail). THROWS on a no-progress
// stall so a regression fails loudly with both clients' logs already captured.
// ---------------------------------------------------------------------------

/**
 * The presentation phases CoopReplayTurnPhase unshifts + the deferred finalize, drained each turn. The
 * SINGLE source of truth for the replay drain set (#827): the fault-injection file imports this instead
 * of maintaining its own copy. INCLUDES the #782 instant-streaming CONTINUATION `CoopReplayTurnPhase` -
 * when the host's live cue stream is split across arrivals (the common case under fault injection) the
 * pump unshifts a continuation CoopReplayTurnPhase, which must be drained too or the turn never reaches
 * its CoopFinalizeTurnPhase (checkpoint apply). A non-continuation turn never surfaces it, so its
 * presence is a no-op for the ~30 non-faulted callers.
 */
export const REPLAY_DRAIN_PHASES = new Set([
  // Pure presentation phases can be inserted ahead of the deferred finalize by a replayed ability/
  // animation. They are part of the renderer allowlist and must finish before a caller is allowed to
  // label the state "post-turn". Missing Show/HideAbility here produced a false wave-53 pre-heal PP
  // mismatch: the driver returned at the flyout, then the checkpoint finalized milliseconds later.
  "MessagePhase",
  "CommonAnimPhase",
  "DamageAnimPhase",
  "MoveAnimPhase",
  "LoadMoveAnimPhase",
  "MoveHeaderPhase",
  "MoveChargePhase",
  "PokemonAnimPhase",
  "ShinySparklePhase",
  "ShowAbilityPhase",
  "HideAbilityPhase",
  "ShowPartyExpBarPhase",
  "HidePartyExpBarPhase",
  "ShowTrainerPhase",
  "ScanIvsPhase",
  // #788 v2: the lockstep gate self-ends when the partner's advance broadcast is already seen
  // (or after the injectable barrier) - drive it like any replay phase or wave-2 never replays.
  "CoopPartnerSyncPhase",
  "CoopMoveAnimReplayPhase",
  "CoopHpDrainReplayPhase",
  "CoopStatStageReplayPhase",
  "CoopStatusReplayPhase",
  "CoopFaintReplayPhase",
  "CoopGuestFaintSwitchPhase",
  // The renderer gate replaces a forbidden local resolution phase (commonly MovePhase) with this
  // fail-closed no-op. It can legitimately sit ahead of the replay presentation/finalize tree and must
  // be ended so the authoritative checkpoint is not left queued behind it.
  "CoopInertPhase",
  // #827: the #782 instant-streaming continuation, folded into the shared set (was a separate copy in
  // coop-duo-fault.test.ts). Stall detection below is by phase IDENTITY so a re-entered continuation
  // (a NEW object each increment) resets the counter instead of reading as a hang.
  "CoopReplayTurnPhase",
  "CoopFinalizeTurnPhase",
]);

/** Minimal phase-manager surface the guest replay pump needs (the guest scene satisfies it). */
interface ReplayPumpScene {
  currentBattle: { waveIndex: number; turn: number };
  phaseManager: {
    clearPhaseQueue: () => void;
    create: (n: "CoopReplayTurnPhase", t: number) => Phase;
    getCurrentPhase(): Phase;
    getQueuedPhaseNames?: () => string[];
    shiftPhase: () => void;
    unshiftPhase: (phase: Phase) => void;
  };
}

/**
 * Start a guest {@linkcode CoopReplayTurnPhase} for `turn` and drain the presentation phases it
 * unshifts PLUS the deferred {@linkcode CoopFinalizeTurnPhase}. MUST be called inside
 * withClient(guestCtx, ...). Throws on a >16-iter no-progress stall (the hang-detection the duo
 * harness exists to surface). Returns when the finalize has run (checkpoint applied, tail queued).
 */
export async function driveGuestReplayTurn(
  guestScene: ReplayPumpScene,
  turn: number,
  options: { sealRetainedWaveBoundary?: boolean } = {},
): Promise<void> {
  await maybeSealHostRetainedWaveBoundary(guestScene, options.sealRetainedWaveBoundary !== false);
  // Production-transition journeys arrive here through the guest's real TurnStartPhase, which has already
  // queued and selected CoopReplayTurnPhase. Reuse that CURRENT object so its end() advances the same phase
  // tree (Victory/reward/NewBattle tails cannot be stranded behind an unrelated constructor phase). Legacy
  // focused repros that deliberately invoke the replay seam still get a detached freshly-created phase.
  const current = guestScene.phaseManager.getCurrentPhase();
  const realBoundary = realGuestCommandBoundaries.get(guestScene);
  let replay: Phase;
  let replayStarted = false;
  if (current?.phaseName === "CoopReplayTurnPhase") {
    replay = current;
  } else {
    replay = guestScene.phaseManager.create("CoopReplayTurnPhase", turn);
    if (
      realBoundary?.wave === guestScene.currentBattle.waveIndex
      && guestScene.currentBattle.turn === turn
      && current?.phaseName === "CommandPhase"
    ) {
      // The production guest reaches CoopReplayTurnPhase through TurnStart after public commands. These
      // engine-focused tests supply commands to the host relay directly, so replace the now-proven guest
      // command surface with the authoritative replay through the REAL phase manager. Clearing the local
      // command-resolution tail is the same structural diversion TurnStart performs in production; most
      // importantly, replay.end() now advances ITS OWN queue instead of an unrelated stale NewBattle tail.
      guestScene.phaseManager.clearPhaseQueue();
      guestScene.phaseManager.unshiftPhase(replay);
      guestScene.phaseManager.shiftPhase();
      replayStarted = true;
    }
  }
  if (!replayStarted) {
    replay.start();
  }
  await drainLoopback();
  // Stall detection by phase IDENTITY (#827): the #782 instant-streaming continuation re-enters as a NEW
  // CoopReplayTurnPhase object each increment, so a real advance resets the counter; only the SAME object
  // stuck is a genuine hang. Equivalent to the old name-based check for the non-continuation callers (their
  // phase object changes every iteration anyway). The #847 finishTurnNoStream path still terminates the
  // loop cleanly: on a host stall the pump ends WITHOUT a CoopFinalizeTurnPhase, so the next current phase
  // is a turn-end phase outside this set and the loop returns.
  // A detached/current replay was started explicitly above. The production-boundary branch only
  // installed it through the test phase manager (whose automatic starter is inert), so it still needs
  // exactly one start in the loop. An async replay can then remain current across several transport
  // drains; never start that same object a second time.
  let startedPhase: Phase | null = replayStarted ? null : replay;
  let lastPhase: Phase | null = null;
  let stall = 0;
  for (let i = 0; i < 256; i++) {
    const cur = guestScene.phaseManager.getCurrentPhase();
    if (cur == null || !REPLAY_DRAIN_PHASES.has(cur.phaseName)) {
      const queued = guestScene.phaseManager.getQueuedPhaseNames?.() ?? [];
      if (queued.includes("CoopFinalizeTurnPhase")) {
        throw new Error(
          `guest replay STRANDED before finalize on ${cur?.phaseName ?? "(none)"}; queued=[${queued.join(",")}]`,
        );
      }
      return;
    }
    if (cur === lastPhase) {
      if (++stall > 24) {
        throw new Error(`guest replay HANG: stuck on ${cur.phaseName} - see dev-logs/coop-duo/`);
      }
    } else {
      stall = 0;
    }
    lastPhase = cur;
    const wasFinalize = cur.phaseName === "CoopFinalizeTurnPhase";
    if (cur !== startedPhase) {
      startedPhase = cur;
      cur.start();
    }
    await drainLoopback();
    if (wasFinalize) {
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// DETECTION MODEL (#807 guest-faint replacement tick race). The per-turn checkpoint / resync
// HEALS state divergences, so a convergence-only assertion sees the two engines AGREE *after* the
// heal and PASSES - never catching that the CHOOSER's screen showed a fainted replacement + a
// re-picker before the heal. These primitives let a faint / switch / learn-move duo test assert the
// PRESENTATION axis: (1) the PRE-HEAL presented state on the owner/chooser engine (the summoned
// replacement must be the chosen species + hp>0, asserted BEFORE the finalize/checkpoint heals it),
// and (2) that a player-facing interaction turn converged with ZERO forced resyncs (a resync means a
// divergence the player could SEE - bounded-resync-OK is the wrong bar for an interaction turn).
// ---------------------------------------------------------------------------

/** The PRESENTED state of a player field slot on the given engine (species + hp + fainted). */
export interface PresentedFieldMon {
  speciesId: number;
  hp: number;
  fainted: boolean;
}

/**
 * Read the PRESENTED state of a player FIELD slot on `scene` (what that engine's screen shows right
 * now). MUST be called inside withClient/withClientSync for the owning ctx (so globalScene is that
 * engine). Returns null when the slot is empty. Use it to assert a freshly summoned replacement is
 * presented ALIVE (hp>0) + the CHOSEN species BEFORE any subsequent checkpoint heals it - a
 * replacement that presents fainted on the chooser is a FAILURE even if the next checkpoint heals it.
 */
export function presentedFieldMon(scene: BattleScene, fieldIndex: number): PresentedFieldMon | null {
  const mon = scene.getPlayerField()[fieldIndex];
  if (mon == null) {
    return null;
  }
  return { speciesId: mon.species?.speciesId ?? 0, hp: mon.hp, fainted: mon.isFainted() };
}

/** A live forced-resync probe: reports how many resyncs a runtime has requested + restores the stream. */
export interface CoopResyncProbe {
  /** Forced resyncs (requestStateSync calls) the runtime has issued since install. */
  count(): number;
  /** Uninstall the probe (restore the original requestStateSync). Call in afterEach. */
  restore(): void;
}

/**
 * Install a behavior-preserving probe on `runtime`'s streamer that COUNTS forced resyncs
 * (requestStateSync) it issues - the detection-model signal for a player-facing divergence. It calls
 * THROUGH to the real requestStateSync (so healing still happens + the run never hangs), only tallying.
 * Assert `probe.count()` stays 0 across a faint-replacement (or any interaction) turn: a forced resync
 * there means the guest's presented state diverged from the host's before the heal - the exact class the
 * heal-then-assert harness masked. Uninstall with `restore()` so it never leaks across the shared
 * (isolate:false) ER suite.
 */
export function installCoopResyncProbe(runtime: CoopRuntime): CoopResyncProbe {
  const streamer = runtime.battleStream as unknown as {
    requestStateSync: (reason: Exclude<CoopRecoveryReason, "durability-gap">) => Promise<CoopStateSyncOutcome>;
  };
  const original = streamer.requestStateSync.bind(streamer);
  let n = 0;
  streamer.requestStateSync = (
    reason: Exclude<CoopRecoveryReason, "durability-gap">,
  ): Promise<CoopStateSyncOutcome> => {
    n += 1;
    return original(reason);
  };
  return {
    count: () => n,
    restore: () => {
      streamer.requestStateSync = original;
    },
  };
}

// ---------------------------------------------------------------------------
// Host reward-shop OWNER drive + guest WATCHER drive (real SelectModifierPhase, real
// CoopInteractionRelay over the loopback). At interaction counter 0 the HOST owns the
// shop and the GUEST watches (the production parity rule); buildDuo wires that. The owner
// streams its rolled option list + relays each pick; the watcher adopts the list and
// replays the picks against its identical pool. We drive the phases' REAL public/logical
// methods directly (the headless guest scene has no human picker) - the RELAY path is
// fully real, exactly the channel that softlocked the TM-Case shop in the field.
// ---------------------------------------------------------------------------

/** The private SelectModifierPhase seam the harness drives (mirrors the phase's own members). */
export interface ShopPhaseSeam {
  phaseName: string;
  start(): boolean | undefined;
  end(): void;
  coopWatcher: boolean;
  coopInteractionStart: number;
  typeOptions: unknown[];
  selectRewardModifierOption(cursor: number, cb: () => boolean): boolean;
  coopRelaySend(choice: number, data: number[] | undefined, label: string): boolean;
  coopEndMirror(): void;
  coopAdvanceInteraction(): void;
}

/**
 * Reach the reward shop through the client's queued production victory tail.
 *
 * Detached `new SelectModifierPhase()` fixtures skip BattleEnd, so a retained WAVE_ADVANCE correctly
 * remains the unacknowledged head of the global operation stream and every later reward result waits
 * behind it. Production never enters a shop that way. This helper makes transition tests execute the
 * real Victory -> BattleEnd -> SelectModifier path and stops before the public reward surface starts.
 * Call inside the destination client's {@linkcode withClient} context.
 */
export async function reachQueuedRewardShop(
  scene: BattleScene,
  options: {
    pumpPeer?: () => Promise<void>;
    drivePublicPhaseInput?: (phase: Phase) => boolean | Promise<boolean>;
  } = {},
): Promise<ShopPhaseSeam> {
  const current = scene.phaseManager.getCurrentPhase();
  const queued = scene.phaseManager.getQueuedPhaseNames?.() ?? [];

  // Detached replay fixtures can finish with the real post-battle boundary wake / Victory tail queued
  // behind the scene's inert boot TitlePhase. Production reaches the same queued phase by ending the
  // replay/current engine phase. Admit only those exact production-owned shapes, then continue through
  // the real phase manager; do not clear the queue or construct/apply a reward surface out of order.
  if (current?.phaseName === "TitlePhase" && (queued[0] === "CoopFinalizeTurnPhase" || queued[0] === "VictoryPhase")) {
    scene.phaseManager.shiftPhase();
    await drainLoopback();
  }

  return (await driveClientPhaseQueueTo(scene, "SelectModifierPhase", options)) as unknown as ShopPhaseSeam;
}

/**
 * Drive the HOST's REAL owner reward shop for one interaction: start the phase (it streams its rolled
 * option list to the watcher + opens the owner screen), TAKE reward index 0 (a free reward; relayed),
 * then LEAVE (the terminal that advances the alternating-interaction counter). MUST be called inside
 * withClient(hostCtx). `phase` is the host's live SelectModifierPhase (from the phase queue) or a fresh
 * one; the relay sends ride the loopback to the guest watcher. Returns the interaction counter the shop
 * was pinned to (for the convergence assert).
 */
export async function driveHostRewardShopOwner(
  hostPhase: ShopPhaseSeam,
  opts: {
    takeReward?: boolean;
    reviveSlot?: number;
    /** The real queued phase already arrived while routing a late retained partner boundary. */
    alreadyStarted?: boolean;
    /** Start/arrive the other real client at this same reciprocal shop boundary. */
    partnerReady?: () => Promise<void>;
    /** Let the other client materialize the retained terminal before the owner continues. */
    partnerSettle?: () => Promise<void>;
  } = {},
): Promise<number> {
  // start() resolves owner/watcher from the pinned counter, streams the rolled options to the watcher,
  // and opens the owner screen (the prompt handler would drive the UI; here we drive the logic directly).
  if (!opts.alreadyStarted) {
    hostPhase.start();
  }
  await opts.partnerReady?.();
  // A guest owner adopts the host-rolled list over transport. Real UI input cannot occur until that
  // asynchronous adoption populates the grid; observe the same readiness boundary here so takeReward
  // cannot mistake an empty, not-yet-delivered list for a request to leave.
  for (let i = 0; i < 16; i++) {
    await drainLoopback();
    if ((hostPhase.typeOptions as unknown[]).length > 0) {
      break;
    }
  }
  const pinned = hostPhase.coopInteractionStart;
  const noop = () => false;
  let tookTerminalReward = false;
  let partnerSettled = false;
  const settlePartner = async (): Promise<void> => {
    if (!partnerSettled) {
      partnerSettled = true;
      await opts.partnerSettle?.();
    }
  };
  // #832 REVIVE-TAKE (level soak): when the caller passes a fainted `reviveSlot` AND this wave's REAL pool
  // rolled a Revive (it gates on a fainted party member), TAKE it (revive that mon) over leaving it dead.
  // A Revive is a party-target reward, so drive the ONE PARTY open the owner's openModifierMenu issues -
  // the same technique as driveHostPartyRewardOwner, but folded in HERE so typeOptions is inspected AFTER
  // start() (it is undefined before). Its applyModifier is TERMINAL (super.end() + coopAdvanceInteraction),
  // so we do NOT also leave. Checked BEFORE takeReward so a revive wins when both are possible.
  if (opts.reviveSlot != null && opts.reviveSlot >= 0) {
    const reviveIdx = (hostPhase.typeOptions as { type?: unknown }[]).findIndex(
      o => o?.type instanceof PokemonReviveModifierType,
    );
    if (reviveIdx >= 0) {
      const ui = globalScene.ui as unknown as { setModeWithoutClear: (...args: unknown[]) => unknown };
      const realSetModeWithoutClear = ui.setModeWithoutClear.bind(ui);
      ui.setModeWithoutClear = (...args: unknown[]): unknown => {
        if (args[0] === UiMode.PARTY) {
          ui.setModeWithoutClear = realSetModeWithoutClear; // one-shot: restore before the picker callback
          (args[3] as (slotIndex: number, option: number) => void)(opts.reviveSlot!, 0);
          return;
        }
        return realSetModeWithoutClear(...args);
      };
      try {
        hostPhase.selectRewardModifierOption(reviveIdx, noop);
        // The picker callback's setMode(MODIFIER_SELECT).then(...) runs on a microtask; drain repeatedly.
        for (let i = 0; i < 8; i++) {
          await drainLoopback();
        }
      } finally {
        ui.setModeWithoutClear = realSetModeWithoutClear; // restore even if the PARTY open never came
      }
      await drainLoopback();
      await settlePartner();
      await drainLoopback();
      return pinned;
    }
  }
  if (opts.takeReward) {
    // Find the first NON-party reward (a PokemonModifierType opens a party menu the headless autopilot
    // can't drive; a non-party item resolves immediately, relaying a REWARD pick + applying it). The
    // caller forces a deterministic non-party reward (e.g. a LURE) via forceItemRewards.
    const idx = (hostPhase.typeOptions as { type?: unknown }[]).findIndex(
      o => !(o?.type instanceof PokemonModifierType),
    );
    if (idx >= 0) {
      // A free, non-continuation reward is ITSELF terminal: its applyModifier calls super.end() +
      // coopAdvanceInteraction(). So after taking it the shop has already left + advanced - we must NOT
      // issue a second leave (that would double-end + consume the post-shop NewBattlePhase off the queue).
      hostPhase.selectRewardModifierOption(idx, noop);
      tookTerminalReward = true;
      await drainLoopback();
    }
  }
  if (!tookTerminalReward) {
    // LEAVE: relay the skip. A retained guest-owned intent deliberately parks this owner until the
    // host watcher commits and returns the complete result; advancing/end() here would let NewBattlePhase
    // open and then allow the late result to rewind its battle state underneath that continuation.
    hostPhase.coopEndMirror();
    const parkedForAuthority = hostPhase.coopRelaySend(/* COOP_INTERACTION_LEAVE */ -1, undefined, "skip");
    if (!parkedForAuthority) {
      hostPhase.end();
      hostPhase.coopAdvanceInteraction();
    }
  }
  await drainLoopback();
  await settlePartner();
  await drainLoopback();
  return pinned;
}

/** Wait until an already-started owner shop reaches the same public input boundary a human sees. */
async function awaitRewardShopOwnerInputReady(hostPhase: ShopPhaseSeam): Promise<number> {
  const pinned = hostPhase.coopInteractionStart;
  let shopReady = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    await drainLoopback();
    const handler = globalScene.ui.getHandler() as unknown as { awaitingActionInput?: boolean };
    const ui = globalScene.ui as unknown as { overlayActive?: boolean };
    if (
      globalScene.ui.getMode() === UiMode.MODIFIER_SELECT
      && handler.awaitingActionInput === true
      && ui.overlayActive !== true
    ) {
      shopReady = true;
      break;
    }
  }
  if (!shopReady) {
    const handler = globalScene.ui.getHandler() as unknown as { awaitingActionInput?: boolean };
    const ui = globalScene.ui as unknown as { overlayActive?: boolean };
    throw new Error(
      `reward UI owner did not become input-ready (mode=${UiMode[globalScene.ui.getMode()]}, awaiting=${handler.awaitingActionInput === true}, overlay=${ui.overlayActive === true}, pinned=${pinned})`,
    );
  }
  return pinned;
}

/**
 * Start the ordinary reward owner phase and keep its ClientCtx installed until the real public handler is
 * input-ready. This explicit half-step lets a two-engine test switch to the destination client and settle
 * an independently-awaited watcher continuation before returning to drive the owner. No gameplay input is
 * synthesized here. MUST run inside the owner's ClientCtx.
 */
export async function beginRewardShopOwnerUi(hostPhase: ShopPhaseSeam): Promise<number> {
  // The legacy multiwave fixture constructs the non-current client's matching shop phase directly.
  // Its previous watcher UI can therefore remain MODIFIER_SELECT even though production's real phase
  // tail would have cleared it. Force a clean MESSAGE base only for that synthetic phase so setMode
  // installs this phase's callback instead of reusing the prior interaction's callback.
  if (globalScene.phaseManager.getCurrentPhase() !== (hostPhase as unknown as Phase)) {
    await globalScene.ui.setModeForceTransition(UiMode.MESSAGE);
  }
  hostPhase.start();
  return awaitRewardShopOwnerInputReady(hostPhase);
}

/**
 * Drive the ordinary reward-shop LEAVE path exclusively through the public UI adapter. This is the
 * production-transition counterpart to the legacy seam driver above: phase start opens the real
 * MODIFIER_SELECT handler, CANCEL opens its real confirmation, and ACTION commits the leave intent.
 * No private selection/terminal method is invoked. MUST run inside the owner's ClientCtx.
 */
export async function driveRewardShopOwnerLeaveViaUi(
  hostPhase: ShopPhaseSeam,
  opts: { alreadyStarted?: boolean } = {},
): Promise<number> {
  // Opening the production shop is asynchronous twice over: the reciprocal co-op barrier must release,
  // then the real handler waits for its reward/tween/tutorial work before it accepts input. Merely seeing
  // MODIFIER_SELECT is insufficient because setMode installs the mode before the transition overlay and
  // AwaitableUiHandler are ready. A human cannot press through that overlay; doing so here made the public
  // driver report CANCEL=false while a later callback continued in the background. Wait for the exact
  // public-input boundary instead of racing it.
  const pinned = opts.alreadyStarted
    ? await awaitRewardShopOwnerInputReady(hostPhase)
    : await beginRewardShopOwnerUi(hostPhase);
  if (!globalScene.ui.processInput(Button.CANCEL)) {
    throw new Error(`reward UI owner rejected CANCEL at interaction ${pinned}`);
  }

  let confirmReady = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    await drainLoopback();
    const ui = globalScene.ui as unknown as { overlayActive?: boolean };
    if (globalScene.ui.getMode() === UiMode.CONFIRM && ui.overlayActive !== true) {
      confirmReady = true;
      break;
    }
  }
  if (!confirmReady) {
    throw new Error(
      `reward UI owner did not open leave CONFIRM (mode=${UiMode[globalScene.ui.getMode()]}, pinned=${pinned})`,
    );
  }
  if (!globalScene.ui.processInput(Button.ACTION)) {
    throw new Error(`reward UI owner rejected leave confirmation at interaction ${pinned}`);
  }
  await drainLoopback();
  // The production terminal is a reciprocal barrier: the owner may remain pinned until the watcher
  // consumes this choice and arrives. The caller alternates client pumps and asserts both counters.
  return pinned;
}

/** Start (and park) a reward watcher before the owner commits through public UI. */
export async function beginRewardShopWatch(guestPhase: ShopPhaseSeam): Promise<number> {
  guestPhase.start();
  await drainLoopback();
  return guestPhase.coopInteractionStart;
}

/**
 * Drive a host-owned teach-a-move reward through the real reward phase and its real PARTY callback.
 * The callback is the public party UI's resolved selection seam: invoking it runs the production
 * `coopFlushPending` path, retains the typed intent, applies the modifier on the authority, and publishes
 * the complete result. No raw relay frame or direct state application is synthesized here.
 *
 * The watcher must already be parked before calling this helper so the shop rendezvous is reciprocal.
 * Call inside the host's {@linkcode withClient} context.
 */
export async function driveHostTeachMoveRewardOwner(
  hostPhase: ShopPhaseSeam,
  pick: { slot: number; moveIndex: number },
): Promise<number> {
  hostPhase.start();
  await drainLoopback();
  const pinned = hostPhase.coopInteractionStart;
  const rewardIndex = (hostPhase.typeOptions as { type?: unknown }[]).findIndex(
    option =>
      option.type instanceof TmModifierType
      || option.type instanceof RememberMoveModifierType
      || option.type instanceof ErLearnersShroomModifierType
      || option.type instanceof ErTmCaseModifierType,
  );
  if (rewardIndex < 0) {
    throw new Error(`teach-move reward owner found no compatible reward at interaction ${pinned}`);
  }

  const ui = globalScene.ui as unknown as { setModeWithoutClear: (...args: unknown[]) => unknown };
  const realSetModeWithoutClear = ui.setModeWithoutClear.bind(ui);
  let partySurfaceOpened = false;
  ui.setModeWithoutClear = (...args: unknown[]): unknown => {
    if (args[0] === UiMode.PARTY) {
      partySurfaceOpened = true;
      ui.setModeWithoutClear = realSetModeWithoutClear;
      (args[3] as (slotIndex: number, option: number) => void)(pick.slot, pick.moveIndex);
      return;
    }
    return realSetModeWithoutClear(...args);
  };
  try {
    hostPhase.selectRewardModifierOption(rewardIndex, () => false);
    for (let i = 0; i < 8; i++) {
      await drainLoopback();
    }
  } finally {
    ui.setModeWithoutClear = realSetModeWithoutClear;
  }
  if (!partySurfaceOpened) {
    throw new Error(`teach-move reward owner never opened PARTY at interaction ${pinned}`);
  }
  return pinned;
}

/**
 * Observe a watcher materializing a retained teach-a-move result through its real queued phase tail.
 * Starts the watcher first, calls `driveOwner` only after the reciprocal surface exists, then pumps the
 * retained result until the projected LearnMovePhase runs and removes its back-out shop continuation.
 * Call inside the watcher's {@linkcode withClient} context; `driveOwner` may temporarily install the host.
 */
export async function driveRetainedTeachMoveRewardWatch(
  guestPhase: ShopPhaseSeam,
  driveOwner: () => Promise<void>,
): Promise<{ queuedContinuation: boolean; queuedLearnMove: boolean; continuationRemoved: boolean }> {
  const pm = globalScene.phaseManager as unknown as {
    getCurrentPhase(): Phase | undefined;
    unshiftPhase(phase: { phaseName?: string }): void;
    tryRemovePhase(name: string): boolean;
  };
  const queued: string[] = [];
  const removed: string[] = [];
  const originalUnshift = pm.unshiftPhase.bind(pm);
  const originalTryRemove = pm.tryRemovePhase.bind(pm);
  pm.unshiftPhase = (phase: { phaseName?: string }) => {
    queued.push(phase.phaseName ?? "?");
    originalUnshift(phase);
  };
  pm.tryRemovePhase = (name: string) => {
    removed.push(name);
    return originalTryRemove(name);
  };

  try {
    await beginRewardShopWatch(guestPhase);
    await driveOwner();
    for (let i = 0; i < 32; i++) {
      await drainLoopback();
      if (queued.includes("LearnMovePhase")) {
        break;
      }
    }
    const current = pm.getCurrentPhase();
    if (current?.phaseName === "LearnMovePhase") {
      current.start();
      for (let i = 0; i < 8; i++) {
        await drainLoopback();
      }
    }
  } finally {
    pm.unshiftPhase = originalUnshift;
    pm.tryRemovePhase = originalTryRemove;
  }

  return {
    queuedContinuation: queued.includes("SelectModifierPhase"),
    queuedLearnMove: queued.includes("LearnMovePhase"),
    continuationRemoved: removed.includes("SelectModifierPhase"),
  };
}

/**
 * Drive the GUEST's REAL watcher reward shop: start the phase (it detects watcher from the pinned
 * counter+role, adopts the owner's streamed option list, and runs startCoopWatch's relay loop),
 * draining the loopback so the relayed owner picks + the terminal LEAVE arrive and are applied.
 * MUST be called inside withClient(guestCtx). Throws on a no-progress stall (the watcher should
 * always converge + leave once the owner's terminal arrives). Returns when the watcher has left.
 */
const REWARD_WATCH_MAX_IDLE = 32;

/**
 * Require a real queued reward phase to release before a caller crosses into its next surface. Mechanical
 * counter/result completion is necessary but insufficient: SelectModifierPhase ends only after its bounded
 * MESSAGE transition settles. Call inside the phase owner's ClientCtx. An already-exited phase is a no-op;
 * detached-fixture compatibility is isolated in driveGuestRewardWatch and earns no queue-exit proof.
 */
export async function awaitRewardShopPhaseExit(phase: ShopPhaseSeam): Promise<void> {
  const phaseManager = globalScene.phaseManager;
  if (phaseManager.getCurrentPhase() !== (phase as unknown as Phase)) {
    return;
  }
  for (let attempt = 0; attempt < 320; attempt++) {
    await drainLoopback();
    if (phaseManager.getCurrentPhase() !== (phase as unknown as Phase)) {
      return;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  const queued = phaseManager.getQueuedPhaseNames?.() ?? [];
  throw new Error(
    "reward terminal completed but live SelectModifierPhase did not exit within 320 pumps "
      + `(interaction=${phase.coopInteractionStart}, queued=[${queued.join(",")}])`,
  );
}

export async function driveGuestRewardWatch(
  guestPhase: ShopPhaseSeam,
  opts: { alreadyStarted?: boolean } = {},
): Promise<void> {
  const phaseManager = globalScene.phaseManager;
  // Production queues one concrete SelectModifierPhase and Phase.end() must actually release it before
  // the next surface is ready. A counter advance is only the mechanical terminal: the UI transition that
  // calls super.end() can still be pending. Returning at the counter used to let the shared-process soak
  // swap globals while that promise was unresolved, leaving the guest on SelectModifierPhase while the
  // host entered Crossroads/World Map. Keep detached legacy fixtures compatible in one isolated branch;
  // they deliberately drive a phase that is not installed in the phase manager and therefore have no
  // meaningful queue-exit boundary to await.
  const drivesLiveQueuedPhase = phaseManager.getCurrentPhase() === (guestPhase as unknown as Phase);
  // start() (watcher branch) is async-ish: it awaits the owner's options, opens the cosmetic screen,
  // then loops on awaitInteractionChoice. We kick it off, then drain the loopback repeatedly so each
  // buffered/relayed owner pick is delivered + applied until the LEAVE/terminal ADVANCES the interaction.
  // A CONTINUATION-class reward (TM / TM Case / Learner's Shroom / Ability Capsule) is TERMINAL for
  // the watcher (applyRelayedRewardAction returns true and the shop super.end()s) WITHOUT advancing
  // the interaction counter (the item's own picker phase owns the rest of the interaction) - so track
  // the phase's end() directly as a third completion signal (found by the #789 exploration probe:
  // the old leave-or-advance detector misread this legitimate terminal as a WATCH HANG).
  let terminalApplied = false;
  const seamApply = guestPhase as unknown as { applyRelayedRewardAction?: (...args: unknown[]) => boolean };
  const realApply = seamApply.applyRelayedRewardAction?.bind(guestPhase);
  if (realApply) {
    seamApply.applyRelayedRewardAction = (...args: unknown[]): boolean => {
      // Forward the complete watcher decision. Dropping its second argument strips the retained
      // operationId/requiresAuthorityCommit proof on guest-owned rewards and can make the owner apply a
      // raw terminal without committing the RESULT, leaving the guest parked one interaction behind.
      const terminal = realApply(...args);
      terminalApplied ||= terminal;
      return terminal;
    };
  }
  if (!opts.alreadyStarted) {
    guestPhase.start();
  }
  // The interaction counter the watcher pinned to at start() - it ADVANCES past this exactly once when the
  // owner's terminal (LEAVE or a terminal reward) is mirrored, which is the authoritative "this interaction
  // completed" signal (the phase's own `coopWatcher` flag can lag past that advance, so it alone is not a
  // reliable "left" signal). Read via the LIVE guest controller (we run inside withClient(guestCtx)).
  const pinned = guestPhase.coopInteractionStart;
  const advancedPastPinned = (): boolean => {
    const counter = getCoopRuntime()?.controller.interactionCounter();
    return counter != null && pinned >= 0 && counter > pinned;
  };
  let mechanicalTerminalReached = false;
  for (let i = 0; i < REWARD_WATCH_MAX_IDLE; i++) {
    await drainLoopback();
    // Completed when EITHER the watcher left (coopWatcher cleared - e.g. a no-relay short-circuit) OR the
    // interaction counter advanced past the pinned one (the owner's terminal was mirrored + applied).
    if (!(guestPhase as unknown as { coopWatcher: boolean }).coopWatcher || advancedPastPinned() || terminalApplied) {
      mechanicalTerminalReached = true;
      break;
    }
  }
  if (mechanicalTerminalReached) {
    if (!drivesLiveQueuedPhase) {
      return;
    }
    // A HOST watching a guest-owned retained intent has only consumed the INTENT here. Its current phase
    // cannot exit until the guest materializes the host RESULT and the exact receipt returns. The caller
    // must pump that peer causal leg, then use awaitRewardShopPhaseExit on both live phases. A GUEST watcher
    // is different: the host-authoritative RESULT has already materialized locally, so its real phase must
    // finish the asynchronous MESSAGE close before this helper returns. Treating both directions alike left
    // the guest's SelectModifierPhase current, causing the ordered final ME leave to remain correctly
    // deferred behind the shop forever in every no-battle Mystery test.
    if (terminalApplied && !advancedPastPinned() && getCoopRuntime()?.controller.role === "host") {
      return;
    }
    // Keep this client's complete context installed until the real async MESSAGE transition invokes
    // super.end() and PhaseManager selects the next queued phase. This is event-driven in browsers; the
    // bounded timer loop models Phaser's headless transition fallback without mutating the phase/counter.
    await awaitRewardShopPhaseExit(guestPhase);
    return;
  }
  // NO-PROGRESS STALL: after REWARD_WATCH_MAX_IDLE drains the watcher neither left NOR advanced the
  // interaction - the owner's terminal never arrived (a relay drop / owner hang / counter-parity mismatch).
  // THROW loudly (the harness's design language, mirroring driveGuestReplayTurn) so a regression surfaces
  // here with both clients' logs already captured, instead of returning silently + being caught only much
  // later by a downstream lockstep assert.
  throw new Error(
    `guest reward WATCH HANG: watcher neither left nor advanced past interaction ${pinned} after ${REWARD_WATCH_MAX_IDLE} drains (owner terminal never arrived) - see dev-logs/coop-duo/`,
  );
}

/**
 * REGRESSION DRIVER (#698 TM-Case orphan): drive the GUEST's REAL watcher shop through a relayed
 * TM_CASE reward pick end-to-end and return its phase-queue observations, so a test can assert the
 * guest's continuation SelectModifierPhase copy is REMOVED (it would have ORPHANED + hung pre-#698).
 *
 * The host owner's party-target menu can't be driven headlessly, so the owner's REWARD pick (the
 * resolved party slot + TM move index) is RELAYED directly over the real loopback - the GUEST side
 * (the side that softlocked) is fully real: it applies the relayed pick against its identical pool,
 * which queues a continuation copy + a no-op guest LearnMovePhase; driving that LearnMovePhase must
 * remove the continuation copy (the host's real learnMove() does on the host). MUST be called inside
 * withClient(guestCtx). `ownerEnd` is the OWNER (host) transport endpoint that relays the pick.
 *
 * Returns: { continuationRemoved } - whether tryRemovePhase("SelectModifierPhase") removed the copy.
 */
export async function driveGuestTmCaseRegression(
  guestPhase: ShopPhaseSeam,
  ownerEnd: CoopTransport,
  pick: { slot: number; moveIndex: number },
): Promise<{ queuedContinuation: boolean; queuedLearnMove: boolean; continuationRemoved: boolean }> {
  const gs = globalScene;
  // Track the guest phase queue: did the watcher's apply queue a continuation copy + a LearnMovePhase,
  // and did the LearnMovePhase then remove the copy. We spy unshiftPhase (continuation copy) +
  // tryRemovePhase (the orphan removal) on the LIVE guest phaseManager.
  const queued: string[] = [];
  const removed: string[] = [];
  const pm = gs.phaseManager as unknown as {
    unshiftPhase(p: { phaseName?: string }): void;
    tryRemovePhase(n: string): boolean;
  };
  const origUnshift = pm.unshiftPhase.bind(pm);
  const origTryRemove = pm.tryRemovePhase.bind(pm);
  pm.unshiftPhase = (p: { phaseName?: string }) => {
    queued.push(p?.phaseName ?? "?");
    return origUnshift(p);
  };
  pm.tryRemovePhase = (n: string) => {
    removed.push(n);
    return origTryRemove(n);
  };
  try {
    // Start the watcher (adopts the owner's options - the caller pre-buffered them), then relay the
    // TM_CASE REWARD pick: data = [COOP_ACT_REWARD=0, slot, moveIndex]. The watcher applies it directly.
    guestPhase.start();
    await drainLoopback();
    ownerEnd.send({
      t: "interactionChoice",
      seq: guestPhase.coopInteractionStart,
      kind: "reward",
      choice: 0,
      data: [0 /* COOP_ACT_REWARD */, pick.slot, pick.moveIndex],
    });
    // Drain so the watcher receives + applies the pick (queues continuation copy + LearnMovePhase).
    for (let i = 0; i < 16; i++) {
      await drainLoopback();
      if (queued.includes("LearnMovePhase")) {
        break;
      }
    }
    // Drive the queued no-op guest LearnMovePhase: it must tryRemovePhase("SelectModifierPhase").
    const cur = gs.phaseManager.getCurrentPhase();
    if (cur?.phaseName === "LearnMovePhase") {
      cur.start();
      await drainLoopback();
    }
  } finally {
    pm.unshiftPhase = origUnshift;
    pm.tryRemovePhase = origTryRemove;
  }
  return {
    queuedContinuation: queued.includes("SelectModifierPhase"),
    queuedLearnMove: queued.includes("LearnMovePhase"),
    continuationRemoved: removed.includes("SelectModifierPhase"),
  };
}

/**
 * Drive the HOST's REAL owner reward shop for a PARTY-TARGET reward (e.g. RARE_CANDY, a vitamin, a
 * mint, an ability capsule - anything that opens the party UI to pick WHICH mon receives it). The
 * headless autopilot has no human to pick a mon, so we intercept the ONE `UiMode.PARTY` open the
 * owner's {@linkcode openModifierMenu} issues and invoke its `(slotIndex, option)` callback with our
 * chosen `slot` - which fires the GENUINE owner relay (`coopFlushPending([slot, option])` ->
 * `coopRelaySend([COOP_ACT_REWARD, slot, option])`) over the real loopback AND applies the modifier
 * to the host's own `party[slot]`. The watcher ({@linkcode driveGuestRewardWatch}) re-applies the
 * relayed pick to ITS `party[slot]`, so a test can assert the two engines converge (e.g. equal
 * `party[slot].level` after RARE_CANDY). A party-target reward is TERMINAL (its applyModifier calls
 * super.end() + coopAdvanceInteraction), so this advances the counter itself - do NOT also leave.
 * MUST be called inside withClient(hostCtx). Returns the pinned interaction counter. This is the
 * party-target sibling of {@linkcode driveHostRewardShopOwner} (which only drives NON-party rewards).
 */
export async function driveHostPartyRewardOwner(
  hostPhase: ShopPhaseSeam,
  opts: { slot?: number; option?: number } = {},
): Promise<number> {
  const slot = opts.slot ?? 0;
  const option = opts.option ?? 0;
  hostPhase.start();
  await drainLoopback();
  const pinned = hostPhase.coopInteractionStart;
  // Find the first PARTY-TARGET reward (the inverse of driveHostRewardShopOwner's non-party filter).
  const idx = (hostPhase.typeOptions as { type?: unknown }[]).findIndex(o => o?.type instanceof PokemonModifierType);
  if (idx < 0) {
    throw new Error("driveHostPartyRewardOwner: no party-target reward in the forced shop options");
  }
  // The owner's openModifierMenu opens UiMode.PARTY with a (slotIndex, option) callback. Stub the ONE
  // PARTY open so the headless autopilot "picks" our slot - driving the REAL coopFlushPending relay +
  // host applyModifier. (The callback also calls ui.setMode(MODIFIER_SELECT).then(...), so we drain.)
  const ui = globalScene.ui as unknown as { setModeWithoutClear: (...args: unknown[]) => unknown };
  const realSetModeWithoutClear = ui.setModeWithoutClear.bind(ui);
  ui.setModeWithoutClear = (...args: unknown[]): unknown => {
    if (args[0] === UiMode.PARTY) {
      ui.setModeWithoutClear = realSetModeWithoutClear; // one-shot: restore before invoking the picker
      (args[3] as (slotIndex: number, option: number) => void)(slot, option);
      return;
    }
    return realSetModeWithoutClear(...args);
  };
  try {
    hostPhase.selectRewardModifierOption(idx, () => false);
    // The picker callback's setMode(MODIFIER_SELECT).then(...) runs on a microtask; drain repeatedly so
    // it fires (relay + apply) and the relayed pick reaches the watcher's inbox.
    for (let i = 0; i < 8; i++) {
      await drainLoopback();
    }
  } finally {
    ui.setModeWithoutClear = realSetModeWithoutClear; // restore even if the PARTY open never came
  }
  return pinned;
}

// ---------------------------------------------------------------------------
// Forcing knobs: thin wrappers over the test override helpers so a repro can FORCE the next
// encounter to a chosen MysteryEncounterType, or FORCE a reward (e.g. a TM Case) into the shop,
// to exercise interaction-alternation + watcher mirroring on purpose. These set the SAME
// Overrides the override-helper sets; both engines read them, so neither client diverges.
// ---------------------------------------------------------------------------

/** The override-helper surface these knobs use (the host GameManager's `override`, structurally). */
export interface OverrideKnobs {
  mysteryEncounter(type: MysteryEncounterType): unknown;
  itemRewards(items: ModifierOverride[]): unknown;
}

/** FORCE the next wave to roll the given MysteryEncounterType on BOTH engines (override-backed). */
export function forceNextMysteryEncounter(override: OverrideKnobs, type: MysteryEncounterType): void {
  override.mysteryEncounter(type);
}

/** FORCE the reward shop to offer the given modifier(s) (e.g. a TM Case) on BOTH engines. */
export function forceItemRewards(override: OverrideKnobs, items: ModifierOverride[]): void {
  override.itemRewards(items);
}

// =============================================================================
// MYSTERY-ENCOUNTER EXTENSION (#633, #677/#678). Drive a HOST-OWNED NON-BATTLE ME across BOTH
// real engines: the HOST (sole authoritative engine) runs the real MysteryEncounterPhase ->
// coopBeginMePump -> streams an entry checksum + `mePresent` presentation on 8M, then at
// PostMysteryEncounterPhase streams a comprehensive `meResync` outcome on 8M + the LEAVE terminal
// on 9M; the GUEST runs its REAL CoopReplayMePhase which consumes those streams and leaves. Unlike a
// normal wave, an ME wave has NO enemy party + NO SummonPhase, so the battle MIRROR is replaced by a
// dedicated ME mirror that reconstructs the guest's player party + sets currentBattle.mysteryEncounter
// to the SAME registry object the host has (so CoopReplayMePhase.adopt-host-tokens reads non-null).
// =============================================================================

/**
 * Bring the GUEST scene into the SAME mystery encounter the host is in. Unlike
 * {@linkcode mirrorHostBattleToGuest} (which clones a NORMAL battle's enemy party + field), an ME wave
 * has NO enemy party and NO field summon - the guest never runs the engine, it only needs:
 *  - the co-op game mode,
 *  - a player party (for `leaveEncounterWithoutBattle` + the comprehensive `meResync` party apply),
 *  - a `currentBattle` whose `battleType` is MYSTERY_ENCOUNTER and whose `mysteryEncounter` is the
 *    SAME registry instance the host rolled (so {@linkcode CoopReplayMePhase} reads it non-null when
 *    adopting the host's streamed dialogue tokens / presentation).
 *
 * MUST be called inside `withClient(guestCtx, ...)` so globalScene is the guest scene (the player-party
 * clone builds under the live globalScene). Mutates the guest scene's party / currentBattle / arena.
 */
export function mirrorHostMeToGuest(hostScene: BattleScene, guestScene: BattleScene): void {
  // Adopt the host's seed + run-config-derived scene state (#658 seed-pin) - see adoptCoopHostRunConfig.
  adoptCoopHostRunConfig(hostScene, guestScene);
  // Same game mode + arena/biome as the host.
  guestScene.gameMode = hostScene.gameMode;
  guestScene.newArena(hostScene.arena.biomeId);

  // `party` is private on BattleScene; the harness writes it through an unknown cast (test-only).
  const guestSceneInternal = guestScene as unknown as { party: PlayerPokemon[] };

  // Rebuild the player party under the guest scene from the host's PokemonData (same technique the
  // battle mirror uses: construct the mon DIRECTLY, skip init()'s UI build the headless guest can't back).
  guestSceneInternal.party = [];
  for (const hostMon of hostScene.getPlayerParty()) {
    const data = new PokemonData(hostMon);
    const mon = new PlayerPokemon(
      getPokemonSpecies(hostMon.species.speciesId),
      hostMon.level,
      hostMon.abilityIndex,
      hostMon.formIndex,
      hostMon.gender,
      hostMon.shiny,
      hostMon.variant,
      hostMon.ivs,
      hostMon.nature,
      data,
    );
    mon.coopOwner = hostMon.coopOwner ?? "host";
    mon.calculateStats();
    stubBattleInfo(mon);
    guestSceneInternal.party.push(mon);
  }

  // Assemble a matching MYSTERY_ENCOUNTER battle. CRUCIAL: the guest gets its OWN MysteryEncounter
  // instance (a clone of the host's, exactly as production's getMysteryEncounter does `new
  // MysteryEncounter(...)`) so CoopReplayMePhase's `globalScene.currentBattle.mysteryEncounter` is
  // non-null (it adopts the host's streamed dialogue tokens onto IT) WITHOUT sharing the host's object
  // (a shared ref would let the guest's token mutation bleed back into the host - a harness artifact).
  // Empty enemy party - an ME wave summons none.
  const hostBattle = hostScene.currentBattle;
  guestScene.currentBattle = new Battle(hostScene.gameMode, {
    waveIndex: hostBattle.waveIndex,
    battleType: BattleType.MYSTERY_ENCOUNTER,
    mysteryEncounterType: hostBattle.mysteryEncounterType,
    double: hostBattle.double,
  });
  guestScene.currentBattle.turn = hostBattle.turn;
  guestScene.currentBattle.mysteryEncounter =
    hostBattle.mysteryEncounter == null ? undefined : new MysteryEncounter(hostBattle.mysteryEncounter);
  guestScene.currentBattle.enemyParty = [];

  // Put the player leads on the guest field (isActive() reads field membership). No enemy field on an ME.
  for (const mon of guestScene.getPlayerField()) {
    guestScene.field.add(mon);
  }
}

/**
 * Stand up the full two-engine rig over ONE {@linkcode createLoopbackPair} for a MYSTERY ENCOUNTER:
 * assemble BOTH runtimes (via {@linkcode assembleCoopRuntime}, so neither closes the other's transport),
 * build the GUEST {@linkcode BattleScene}, MIRROR the host's CURRENT mystery encounter onto it (via
 * {@linkcode mirrorHostMeToGuest}, NOT the battle mirror), tag co-op field ownership, connect both
 * controllers, and drain the handshake. After this the host OWNS even interaction counters (the ME at
 * counter 0) and the guest OWNS odd ones - the production parity rule.
 *
 * MUST be called with the HOST GameManager already PARKED on an ME wave (its currentBattle.battleType
 * is MYSTERY_ENCOUNTER and currentBattle.mysteryEncounter is set - e.g. after `runToSummon` at a valid
 * ME wave with the ME override). Returns the {@linkcode DuoRig}; the caller drives the host through the
 * ME, then drives the guest's CoopReplayMePhase.
 */
export async function buildDuoForMe(
  hostGame: GameManager,
  pair: { host: CoopTransport; guest: CoopTransport },
  setCoopRuntimeFn: (r: CoopRuntime) => void,
  toCoopGameMode: (scene: BattleScene) => void,
): Promise<DuoRig> {
  const hostScene = hostGame.scene;
  // Headless best-effort UI: neutralize the host's achievement candy-bar UI (see neutralizeCoopCandyBar)
  // so a won wave's REALISTIC_FLASH candy grant on an evolved starter can't throw an unhandled rejection.
  neutralizeCoopCandyBar(hostScene);
  const suppliedPair = pair as typeof pair & { flush?: (role: CoopRole, limit?: number) => number };
  // Mystery encounters use the same retained operation carriers as ordinary battle/reward journeys.
  // Give their legacy loopback rig the same destination-context adapter as buildDuo: otherwise an
  // inbound ME/reward continuation can resume while the sender's process-global scene is installed,
  // a state that cannot occur when the two players run in separate browsers.
  const runtimePair: DestinationEnvelopePumpPair =
    typeof suppliedPair.flush === "function"
      ? (suppliedPair as DestinationEnvelopePumpPair)
      : destinationPumpOperationEnvelopes(suppliedPair);
  const hostRuntime = buildRuntime(runtimePair.host, "Host", "authoritative");
  const guestRuntime = buildRuntime(runtimePair.guest, "Guest", "authoritative");
  hostRuntime.controller.role = "host";
  guestRuntime.controller.role = "guest";

  // Flip the host engine into co-op + tag the party leads host/guest. Tag by PARTY index, not field: in a
  // final-boss STAGE-ONE the player field is single (only slot 0 is summoned), yet the co-op party still
  // holds the guest partner's mon on the BENCH (slot 1). A field-only tag left that benched partner
  // untagged, so a stage-one rig had "no healthy guest-owned bench mon" (coop-final-boss-stage-one). Slots
  // 0/1 ARE field 0/1 in a normal double battle, so this is byte-identical for every doubles rig.
  toCoopGameMode(hostScene);
  const hostParty = hostScene.getPlayerParty();
  if (hostParty[0] != null) {
    hostParty[0].coopOwner = "host";
  }
  if (hostParty[1] != null) {
    hostParty[1].coopOwner = "guest";
  }

  const hostCtx: ClientCtx = {
    label: "host",
    scene: hostScene,
    runtime: hostRuntime,
    rndState: Phaser.Math.RND.state(),
    ghost: snapshotGhostState(),
    // #837: seed both ctxs from the host's current module-let state (the launch mirror), so each engine
    // starts identical and thereafter keeps its OWN money-streak / overstay / relic state.
    moduleLets: snapshotModuleLets(),
    biomeState: snapshotBiomeModuleState(),
    mePins: { ...IDLE_ME_PINS },
    pumpInbound: () => runtimePair.flush("host"),
  };

  // The 2nd real BattleScene (steals globalScene; withClient re-points it per pump).
  const guestScene = buildGuestScene(hostGame);
  installHeadlessCoopSemanticProjectionOracle(guestScene);
  const guestCtx: ClientCtx = {
    label: "guest",
    scene: guestScene,
    runtime: guestRuntime,
    rndState: Phaser.Math.RND.state(),
    ghost: emptyGhostSnapshot(),
    moduleLets: snapshotModuleLets(),
    biomeState: structuredClone(hostCtx.biomeState!),
    mePins: { ...IDLE_ME_PINS },
    pumpInbound: () => runtimePair.flush("guest"),
  };
  await withClient(guestCtx, () => {
    toCoopGameMode(guestScene);
    mirrorHostMeToGuest(hostScene, guestScene);
    // Mystery rigs are a separate construction path from buildDuo. They still cross ordinary biome
    // transitions after the embedded encounter, so install the same production-shaped renderer cache
    // completion model before the first retained transition tail can run.
    installHeadlessPlayerAtlasCompletionModel(guestScene);
    const gf = guestScene.getPlayerField();
    if (gf[0] != null) {
      gf[0].coopOwner = "host";
    }
    if (gf[1] != null) {
      gf[1].coopOwner = "guest";
    }
  });
  registerRetainedWaveBoundaryBridge(hostGame, hostScene, guestScene, hostCtx);

  // Connect both controllers over the live loopback (exchange hello / runConfig).
  setCoopRuntimeFn(hostRuntime);
  hostRuntime.controller.connect();
  setCoopRuntimeFn(guestRuntime);
  guestRuntime.controller.connect();
  await drainLoopback();

  const rig = { hostScene, guestScene, hostRuntime, guestRuntime, hostCtx, guestCtx, pair: runtimePair };
  installDuoCtxOwnershipPins(rig, hostGame);
  liveDuoRigs.add(rig);
  return rig;
}

/** Minimal phase-manager surface the guest ME replay pump needs (the guest scene satisfies it). */
interface MeReplayPumpScene {
  phaseManager: {
    create(n: "MysteryEncounterPhase"): Phase;
    getCurrentPhase(): Phase | undefined;
    clearPhaseQueue(leaveUnshifted?: boolean): void;
    pushPhase(phase: Phase): void;
    shiftPhase(): void;
  };
}

/** The started guest CoopReplayMePhase + the `settled` flag the harness inspects (terminal ran once). */
export interface GuestMeReplay {
  phase: Phase;
  settled: boolean;
}

/**
 * Drive the GUEST's REAL authoritative-ME path for a HOST-OWNED non-battle ME, FAITHFULLY: run the
 * guest's REAL {@linkcode MysteryEncounterPhase}, which (because `isCoopAuthoritativeGuest()` is true)
 * DIVERTS - it pins the guest's ME interaction counter (`coopSetMePinForGuest`, so `coopMeInProgress()`
 * is TRUE across the whole guest ME exactly as in production), pushes a {@linkcode CoopReplayMePhase},
 * and ends. We then start that queued CoopReplayMePhase and drain the loopback so the guest consumes -
 * in FIFO order on the disjoint channels the host already buffered:
 *  - 8M (OUTCOME inbox): the `mePresent` presentation (at MysteryEncounterPhase.start) THEN the
 *    comprehensive `meResync` (at PostMysteryEncounterPhase),
 *  - 9M (terminal inbox): the LEAVE sentinel (at coopEndMePump).
 * The phase's start() runs a void async IIFE; each await resolves as the loopback is drained. MUST be
 * called inside `withClient(guestCtx, ...)` AFTER the host has run fully through PostMysteryEncounterPhase
 * (so both 8M outcomes + the 9M terminal are already buffered and drain with zero network wait).
 *
 * Returns the started CoopReplayMePhase + its `settled` flag. THROWS on a no-progress stall (the guest
 * never left the encounter) - the hang detection the duo harness exists to surface.
 *
 * SCOPE: this drives the guest THROUGH the CoopReplayMePhase leave terminal (the single ME alternation
 * advance), NOT the embedded post-ME watcher reward shop + the guest's PostMysteryEncounterPhase. So the
 * guest's ME pin (`coopMeInteractionStart`, set to the ME counter by the divert) is STILL SET when this
 * returns - in production it is cleared later by PostMysteryEncounterPhase, after the watcher shop drains
 * (MAJOR-3). The harness's `withClient(guestCtx)` swap-back restores the previous (host idle) pins, so the
 * leak is bounded to `guestCtx.mePins.start` until the next guest pump; a SINGLE-ME duo test is unaffected.
 */
/** True when a phase's private `settled` terminal guard has fired (CoopReplayMePhase left exactly once). */
function meReplaySettled(p: Phase): boolean {
  return (p as unknown as { settled: boolean }).settled === true;
}

/**
 * START the guest's REAL authoritative-ME divert and return the queued {@linkcode CoopReplayMePhase}
 * (started, but NOT yet drained to its terminal). Runs the guest's REAL {@linkcode MysteryEncounterPhase},
 * which (because `isCoopAuthoritativeGuest()` is true) DIVERTS: it pins the guest's ME interaction counter
 * (`coopSetMePinForGuest`, so `coopMeInProgress()` is TRUE across the whole guest ME exactly as in
 * production), pushes a CoopReplayMePhase, and ends. We then start that queued CoopReplayMePhase (its
 * start() awaits the host presentation, resolves ownership, and - if the guest OWNS - opens the selector
 * and RETURNS without awaiting the terminal; if the HOST owns, it begins the outcome/terminal race).
 *
 * MUST be called inside `withClient(guestCtx, ...)`. Use this when you need to interleave the guest's
 * pick relay with the host BEFORE draining to the terminal (guest-OWNED + battle-handoff); for the
 * pure host-owned renderer path use {@linkcode driveGuestMeReplay} (start + drain-to-settle in one).
 */
export async function startGuestMeReplay(guestScene: MeReplayPumpScene): Promise<Phase> {
  // Clear the guest's stale queue first (in production the guest's EncounterPhase clears it before
  // MysteryEncounterPhase runs; the headless guest's queue still holds a leftover TitlePhase). Make the
  // MysteryEncounterPhase the CURRENT phase (pushPhase onto the cleared queue + shiftPhase to pop it as
  // current), exactly as production's EncounterPhase.end() -> shiftPhase does. Then mePhase.start()'s
  // divert (`this.end()` -> shiftPhase) pops the freshly-pushed CoopReplayMePhase as the new current.
  guestScene.phaseManager.clearPhaseQueue();
  const mePhase = guestScene.phaseManager.create("MysteryEncounterPhase");
  guestScene.phaseManager.pushPhase(mePhase);
  guestScene.phaseManager.shiftPhase();
  // Observe the exact replay object that production creates during the divert. Current-phase sampling
  // alone has two valid races: before a loopback drain it can still be MysteryEncounterPhase, while a
  // complete retained ME tail can advance it beyond CoopReplayMePhase during that drain. Capturing create()
  // is passive (the real factory still constructs and queues the phase) and gives the cooperative scheduler
  // a stable identity without fabricating a phase or a successful handoff.
  const factory = guestScene.phaseManager as unknown as {
    create: (phaseName: string, ...args: unknown[]) => Phase;
  };
  const originalCreate = factory.create;
  const activeReplayBefore = getActiveCoopReplayMePhaseForHarness();
  let createdReplay: Phase | null = null;
  factory.create = function captureCreatedReplay(phaseName: string, ...args: unknown[]): Phase {
    const created = originalCreate.call(this, phaseName, ...args);
    if (phaseName === "CoopReplayMePhase") {
      createdReplay = created;
    }
    return created;
  };
  try {
    mePhase.start();
  } finally {
    factory.create = originalCreate;
  }
  await drainLoopback();
  const current = guestScene.phaseManager.getCurrentPhase();
  const activeReplayAfter = getActiveCoopReplayMePhaseForHarness();
  const replay = createdReplay ?? (activeReplayAfter === activeReplayBefore ? null : activeReplayAfter);
  if (replay == null || replay.phaseName !== "CoopReplayMePhase") {
    throw new Error(
      `guest ME divert FAILED: production created no CoopReplayMePhase (current=${current?.phaseName ?? "none"}) - see dev-logs/coop-duo/`,
    );
  }
  if (current === replay) {
    replay.start();
    await drainLoopback();
  } else if (activeReplayAfter === replay) {
    // A production scheduler already started this exact object and handed off to a child/interstitial.
    // Never re-enter start(): its outcome and terminal arms are single-owner.
  } else if (current === mePhase) {
    throw new Error(
      "guest ME divert STALLED: production queued CoopReplayMePhase but MysteryEncounterPhase remained current - see dev-logs/coop-duo/",
    );
  } else {
    // A real pre-replay interstitial (observed: CommonAnimPhase in C1 run 29673971204) can remain ahead
    // of the queued replay. Execute only those production-queued phases until the exact captured replay
    // becomes current, then cross its one omitted scheduler edge.
    await driveClientPhaseQueueTo(guestScene as BattleScene, "created CoopReplayMePhase", {
      matches: phase => phase === replay,
      maxPhases: 16,
    });
    replay.start();
    await drainLoopback();
  }
  return replay;
}

/**
 * Cross the embedded host-owned ME reward shop with both real client engines present. The host caller
 * remains on its live SelectModifierPhase while the guest starts its production CoopReplayMePhase,
 * arrives at the reciprocal watcher boundary, and later consumes the owner's retained shop terminal.
 * Returns the already-running guest replay so the caller can settle it after PostMysteryEncounter emits
 * the comprehensive ME terminal. MUST be called while the host ClientCtx is installed.
 */
export async function driveHostMeRewardShopWithGuestReplay(
  hostPhase: ShopPhaseSeam,
  guestCtx: ClientCtx,
  guestScene: MeReplayPumpScene,
): Promise<Phase> {
  let replay: Phase | null = null;
  let guestShop: ShopPhaseSeam | null = null;
  await driveHostRewardShopOwner(hostPhase, {
    takeReward: false,
    partnerReady: async () => {
      replay = await withClient(guestCtx, () => startGuestMeReplay(guestScene));
      // A browser cannot let the host commit a shop terminal until the guest's real queued shop has
      // started and announced the reciprocal `shop:<wave>:<counter>` rendezvous. Merely starting the ME
      // replay leaves that SelectModifierPhase queued: direct host-seam input could then bypass its own
      // closed UI while the rendezvous recovery correctly remained armed. Start the production phase and
      // wait for its authoritative option projection before allowing the owner driver to send LEAVE.
      guestShop = await withClient(guestCtx, () => startGuestMeShopOwner(guestScene as BattleScene));
    },
    partnerSettle: async () => {
      if (guestShop == null) {
        throw new Error("host-owned ME reward shop never reached its guest watcher boundary");
      }
      const settledGuestShop = guestShop;
      // Consume the owner's retained terminal through the watcher phase itself. This proves both the
      // mechanical result and the real phase exit instead of leaving a hidden shop waiter behind while
      // PostMysteryEncounterPhase advances to the terminal transaction.
      await withClient(guestCtx, () => driveGuestRewardWatch(settledGuestShop, { alreadyStarted: true }));
    },
  });
  if (replay == null) {
    throw new Error("host-owned ME reward shop never started its guest replay partner");
  }
  return replay;
}

/**
 * Relay the GUEST's top-level ME option INDEX when the guest OWNS the ME (#633 BLOCK-3) - the SEND ONLY,
 * WITHOUT starting the guest's outcome/terminal race. This split is load-bearing for the duo harness's
 * bidirectional handshake:
 *  - The index must be SENT in STEP B (guest ctx) so the host's coopHostAwaitGuestIndex await resolves.
 *  - But the guest's outcome/terminal RACE must be started LATER, in STEP D under the guest ctx, AFTER the
 *    host has buffered the meResync (8M) + LEAVE (9M) - else the race's awaits, being pending while the
 *    HOST drives (STEP C), resolve under the HOST globalScene (a cross-ctx continuation: applyCoopMeOutcome
 *    + leaveEncounterWithoutBattle would run against the HOST scene, and the guest never converges).
 * This shared-process split cannot invoke {@linkcode CoopReplayMePhase.handleGuestOptionSelect} because that
 * method also arms the outcome await immediately. It must nevertheless cross the SAME authoritative owner
 * seam before sending the SAME addressed proposal: mint the retained ME_PICK intent, advance the replay's
 * stable pick ordinal, then carry that ordinal in the "me" interactionChoice data. The browser lane drives
 * the public UI method itself; this engine harness isolates its await only to preserve destination context.
 * {@linkcode startGuestMeOutcomeRace} starts that await later in STEP D.
 * MUST be called inside `withClient(guestCtx, ...)`.
 */
export function relayGuestMeOptionIndexOnly(replay: Phase, index: number): void {
  const seam = replay as unknown as {
    seq: number;
    interactionCounter: number;
    pickStep: number;
    pickSent: boolean;
  };
  const relay = getCoopInteractionRelay();
  if (relay == null) {
    throw new Error("relayGuestMeOptionIndexOnly: no live interaction relay (call inside withClient(guestCtx))");
  }
  if (seam.pickSent) {
    throw new Error(`relayGuestMeOptionIndexOnly: duplicate pick for Mystery ${seam.seq}`);
  }
  const step = seam.pickStep;
  const operationId = commitMeOwnerIntent({
    kind: "ME_PICK",
    seq: seam.seq,
    pinned: seam.interactionCounter,
    step,
    payload: { optionIndex: index },
    localRole: getCoopRuntime()?.controller.role ?? "guest",
    wave: globalScene.currentBattle?.waveIndex ?? -1,
    turn: 0,
    resend: isCoopMeOperationJournalActive()
      ? () => relay.sendInteractionChoice(seam.seq, "me", index, [step])
      : undefined,
  });
  if (operationId == null && isCoopMeOperationEnabled()) {
    throw new Error(`relayGuestMeOptionIndexOnly: Mystery ${seam.seq}/${step} could not enter retained control`);
  }
  seam.pickStep = step + 1;
  seam.pickSent = true;
  relay.sendInteractionChoice(seam.seq, "me", index, [step]);
}

/**
 * Start the GUEST's outcome/terminal race for an already-relayed guest-owned ME pick (STEP D). Invokes the
 * private {@linkcode CoopReplayMePhase.awaitOutcomeThenTerminal} so its awaits BUFFER-HIT the host's
 * already-streamed meResync (8M) + LEAVE (9M) and resolve UNDER the guest ctx (applyCoopMeOutcome +
 * leaveEncounterWithoutBattle run against the GUEST scene). MUST be called inside `withClient(guestCtx)`.
 */
export function startGuestMeOutcomeRace(replay: Phase): void {
  const relay = getCoopInteractionRelay();
  if (relay == null) {
    throw new Error("startGuestMeOutcomeRace: no live interaction relay (call inside withClient(guestCtx))");
  }
  (replay as unknown as { awaitOutcomeThenTerminal(r: NonNullable<typeof relay>): void }).awaitOutcomeThenTerminal(
    relay,
  );
}

/**
 * Drain the guest's already-started {@linkcode CoopReplayMePhase} to its terminal (the host's buffered
 * 8M meResync / 9M LEAVE / battle-handoff). Returns once `settled` (the single terminal guard fired) or
 * THROWS on a no-progress stall - the hang detection the duo harness exists to surface (the #693/#698
 * softlock class: a guest parked on an 8M outcome the host never sends for a battle-handoff/degrade
 * terminal). MUST be called inside `withClient(guestCtx, ...)`.
 */
export async function drainGuestMeReplayToSettle(replay: Phase): Promise<GuestMeReplay> {
  for (let i = 0; i < 16; i++) {
    await drainLoopback();
    const lifecycle = replay as unknown as {
      continuationHandedOff: boolean;
      settled: boolean;
    };
    if (!lifecycle.settled && lifecycle.continuationHandedOff) {
      // A real browser's Phaser scheduler runs the complete local continuation in parallel with
      // transport delivery. This directly-constructed guest deliberately has an inert phase manager,
      // so transport-only drains leave a valid final LEAVE deferred forever behind the real queued
      // EggLapse/MysteryEncounterRewards/PostMysteryEncounter tail (B7/B9 run 29673281666).
      //
      // Drive only after the retained reward/battle settlement has explicitly handed off control, and
      // stop only when that same replay's final retained transaction settles. This preserves the
      // production lifecycle fence: LEAVE must still wait for the actual PostMysteryEncounterPhase;
      // the harness neither clears the queue nor manufactures a replacement phase.
      await driveClientPhaseQueueTo(globalScene, "retained Mystery final leave", {
        matches: () => meReplaySettled(replay),
        maxPhases: 32,
      });
    }
    if (meReplaySettled(replay)) {
      // Journal terminals settle the replay directly, so the losing legacy 8M outcome arm can remain parked
      // until its long timeout. Retire that exact, now-dead waiter before this client scope exits; otherwise
      // repeated MEs accumulate detached continuations which can later observe a restored stale boundary.
      if (isCoopMeOperationJournalActive()) {
        const relay = getCoopInteractionRelay();
        if (relay == null) {
          throw new Error("guest ME replay settled without a live interaction relay");
        }
        const seq = (replay as unknown as { seq: number }).seq;
        relay.cancelWaiters(candidate => candidate === seq);
        const outcomePending = (relay as unknown as { outcomePending: Map<number, unknown> }).outcomePending;
        if (outcomePending.has(seq)) {
          throw new Error(`guest ME replay ${seq} left its outcome waiter armed after settlement`);
        }
        // Join the cancellation continuation while the owning guest scene/runtime is still installed.
        await drainLoopback();
      }
      return { phase: replay, settled: true };
    }
  }
  throw new Error("guest ME replay HANG: CoopReplayMePhase never settled after 16 drains - see dev-logs/coop-duo/");
}

/**
 * Drive the GUEST's REAL authoritative-ME path for a HOST-OWNED non-battle ME, FAITHFULLY: start the
 * divert ({@linkcode startGuestMeReplay}) then drain to the terminal ({@linkcode drainGuestMeReplayToSettle}).
 * The guest is a pure renderer here (the host owns + drives the pick), so no pick relay is needed. MUST
 * be called inside `withClient(guestCtx, ...)` AFTER the host has run fully through PostMysteryEncounterPhase
 * (so both 8M outcomes + the 9M terminal are already buffered and drain with zero network wait).
 *
 * SCOPE: drives the guest THROUGH the CoopReplayMePhase leave terminal (the single ME alternation advance),
 * NOT the embedded post-ME watcher reward shop + the guest's PostMysteryEncounterPhase. So the guest's ME
 * pin (`coopMeInteractionStart`, set by the divert) is STILL SET when this returns - in production it is
 * cleared later by PostMysteryEncounterPhase after the watcher shop drains (MAJOR-3); the harness's
 * `withClient(guestCtx)` swap-back restores the previous (host idle) pins, so the leak is bounded to
 * `guestCtx.mePins.start` until the next guest pump (a SINGLE-ME duo test is unaffected).
 */
export async function driveGuestMeReplay(guestScene: MeReplayPumpScene): Promise<GuestMeReplay> {
  const replay = await startGuestMeReplay(guestScene);
  return drainGuestMeReplayToSettle(replay);
}

/** The private CoopReplayMePhase seam the repeated-round harness inspects (#831, established cast form). */
interface GuestMeRoundSeam {
  /** How many REPEATED option-select rounds (bare re-fired mePresents) the phase re-rendered. */
  newRoundsRendered: number;
  /** Whether the single terminal guard has fired (the phase left/ended exactly once). */
  settled: boolean;
}

/**
 * #831 (audit P0#1, GROUP REPEAT): drain a guest {@linkcode CoopReplayMePhase} that is consuming a
 * REPEATED option-select ME (a press-your-luck delve / Safari) until it has re-rendered `expected` new
 * rounds - the bare re-fired `mePresent`s the host streamed for each "descend again? / dig again?" round.
 * The guest must render each round and PARK (NOT settle) because the host's terminal (meResync + LEAVE) is
 * only sent AFTER the last round (STEP C in the duo recipe). Returns the observed count so the caller can
 * assert lockstep with the host's stream. Bails early (returns the count) if the phase settles - so a
 * REGRESSION (the old stray -> terminal fall-through, which settles after ZERO new rounds) is caught by the
 * caller's `expect(newRounds).toBe(expected)` rather than hanging here. MUST be called inside
 * withClient(guestCtx, ...) AFTER the host has streamed the round presentations (they drain with zero wait).
 */
export async function drainGuestMeReplayNewRounds(replay: Phase, expected: number): Promise<number> {
  const seam = replay as unknown as GuestMeRoundSeam;
  for (let i = 0; i < 24; i++) {
    await drainLoopback();
    if (seam.newRoundsRendered >= expected || seam.settled) {
      break;
    }
  }
  return seam.newRoundsRendered;
}

// ---------------------------------------------------------------------------
// #828 GUEST-OWNED ME embedded reward shop (the reward-pick OWNER flips to the GUEST). On a guest-owned
// ME the reward shop's two authorities SPLIT: the HOST is the OPTION owner (the sole ME engine rolls +
// STREAMS the pool) but the reward-pick WATCHER, while the GUEST (the ME owner) ADOPTS the streamed
// options and OWNS the interactive pick, relaying it for the host to apply. These helpers drive that
// split across the two engines with the same cross-ctx discipline as the top-level ME pick handshake
// (owner send under withClientSync, watcher apply under a later drain in the owner's ctx).
// ---------------------------------------------------------------------------

/**
 * Obtain the GUEST's production-queued embedded reward shop after CoopReplayMePhase performs its real
 * #821/#828 handoff. The old helper constructed and started a detached second SelectModifierPhase; that
 * let a synthetic phase send the leave while the player's real current phase remained open, so the duo
 * lane did not model a browser and could strand the host watcher. MUST be called inside withClient(guestCtx)
 * after the host streams its options. Drains until the queued phase is current and its adopted options land.
 */
export async function startGuestMeShopOwner(guestScene: BattleScene): Promise<ShopPhaseSeam> {
  // The already-running replay owns its asynchronous handoff. Drain it without re-entering start() until
  // it yields to a production-queued successor; then let the cooperative scheduler execute every real
  // wrapper/interstitial on the way to the shop. Run 29673971204 proved MysteryEncounterRewardsPhase may
  // legitimately queue CommonAnimPhase before SelectModifierPhase, which the former phase-name poll ignored.
  for (let i = 0; i < 16; i++) {
    await drainLoopback();
    const current = guestScene.phaseManager.getCurrentPhase();
    if (current?.phaseName !== "CoopReplayMePhase") {
      break;
    }
  }

  const current = guestScene.phaseManager.getCurrentPhase();
  if (current?.phaseName === "CoopReplayMePhase") {
    throw new Error(
      "guest ME shop handoff FAILED: the running CoopReplayMePhase never queued its production reward tail",
    );
  }

  const shop = (await driveClientPhaseQueueTo(guestScene, "production SelectModifierPhase", {
    matches: phase => phase.phaseName === "SelectModifierPhase",
    maxPhases: 32,
  })) as unknown as ShopPhaseSeam;
  // Stop-before-target is the helper's contract. Cross this one real scheduler edge, then wait for the
  // already-streamed authoritative option pool to materialize on the live current shop.
  if (shop.typeOptions == null) {
    shop.start();
  }
  for (let i = 0; i < 16; i++) {
    await drainLoopback();
    if (Array.isArray(shop.typeOptions) && shop.typeOptions.length > 0) {
      return shop;
    }
  }
  if (!Array.isArray(shop.typeOptions) || shop.typeOptions.length === 0) {
    throw new Error("guest ME shop handoff FAILED: production SelectModifierPhase never adopted reward options");
  }
  return shop;
}

/**
 * Relay the GUEST reward-shop OWNER's LEAVE synchronously (#828) - the SEND ONLY, without flushing the
 * loopback, so the HOST's reward pick-WATCHER await resolves UNDER the host ctx on the next drain (the
 * cross-ctx footgun the top-level pick handshake also dodges). Mirrors the production leave path. A
 * retained guest-owner intent parks this real phase until the host watcher returns its authoritative
 * result; otherwise the phase ends immediately. The ME pin suppresses any extra interaction advance.
 */
export function relayGuestMeShopLeaveSync(guestShop: ShopPhaseSeam): void {
  guestShop.coopEndMirror();
  const parkedForAuthority = guestShop.coopRelaySend(/* COOP_INTERACTION_LEAVE */ -1, undefined, "skip");
  if (!parkedForAuthority) {
    guestShop.end();
    guestShop.coopAdvanceInteraction();
  }
}

// ---------------------------------------------------------------------------
// #818 co-op QUIZ MIRRORING (guest FOLLOW side). An embedded-quiz ME (Sealed Door / Guessing
// Booth / Scrambled Pokedex / footprint hunt / cipher / braille / Salvage Yard) hands off to a
// mirror ErQuizPhase on the GUEST when its CoopReplayMePhase races the host's `mePresent` subPrompt
// { kind:"quiz" } and calls settleForWatcherQuiz (unshifting the mirror phase off the host-streamed
// session). The guest pump is MANUAL, so the harness starts that queued phase and, per question,
// drains the loopback (so the phase's armRemoteAnswer BUFFER-HITS the owner's relayed "quizAns" and
// self-feeds onAnswer with ZERO local input) then advances the verdict message so it asks the next.
// `answered === total` on return proves the follower landed every owner-relayed answer.
// ---------------------------------------------------------------------------

/** #818 seam: the ErQuizPhase private tally fields the harness inspects (mirrors ShopPhaseSeam's shape). */
export interface ErQuizPhaseSeam {
  phaseName: string;
  /** The host-streamed questions the mirror renders (structurally ErQuizQuestion[]). */
  questions: unknown[];
  /** Current question index (0-based). */
  index: number;
  /** Questions answered so far (=== total when every relayed answer was consumed). */
  answered: number;
  /** Questions answered correctly (matches the owner's tally, since the answers are identical). */
  correct: number;
  start(): void;
}

/** Advance the guest's message handler ONE step iff it is parked awaiting input (a quiz verdict). */
function advanceGuestVerdict(guestScene: BattleScene): void {
  if (guestScene.ui.getMode() !== UiMode.MESSAGE) {
    return;
  }
  const handler = guestScene.ui.getHandler() as unknown as {
    awaitingActionInput?: boolean;
    processInput?: (b: number) => boolean;
  };
  if (handler.awaitingActionInput) {
    handler.processInput?.(Button.ACTION);
  }
}

/**
 * Drive the GUEST's mirror {@linkcode ErQuizPhase} (the #818 FOLLOW side) to completion: start it, then
 * per question drain the loopback so its armRemoteAnswer BUFFER-HITS the owner's relayed "quizAns" and
 * self-feeds onAnswer, and advance the verdict message so the phase asks the next question. The follower
 * takes NO local input - every answer comes from the owner's relay - so `answered === total` on return
 * proves the mirror consumed every relayed answer. MUST be called inside withClient(guestCtx). THROWS on
 * a no-progress stall (the hang detection the duo harness exists to surface).
 */
export async function driveGuestMirrorQuiz(
  guestScene: BattleScene,
  quizPhase: ErQuizPhaseSeam,
  total: number,
): Promise<number> {
  quizPhase.start();
  for (let i = 0; i < 600; i++) {
    await drainLoopback();
    advanceGuestVerdict(guestScene);
    if (quizPhase.answered >= total) {
      break;
    }
  }
  if (quizPhase.answered < total) {
    throw new Error(
      `guest mirror quiz HANG: consumed ${quizPhase.answered}/${total} owner-relayed answers - see dev-logs/coop-duo/`,
    );
  }
  // Advance the FINAL verdict so finish() runs (onComplete + end) - not load-bearing for the tally, but
  // leaves the mirror phase cleanly ended rather than parked on its last message.
  for (let i = 0; i < 8; i++) {
    await drainLoopback();
    advanceGuestVerdict(guestScene);
  }
  return quizPhase.answered;
}

// =============================================================================
// REPLAY-TRACE LOADER (#record-replay, Phase 1). Replays a captured {@linkcode ReplayTrace} across
// BOTH real engines in the duo harness so a reported co-op bug reproduces headlessly + a fix can be
// re-verified. It SEEDS the host run from the trace (seed + roster species + the coop runConfig),
// flips to co-op via {@linkcode buildDuo}, then walks the trace's ordered events wave-by-wave - feeding
// each battle COMMAND into the host (the host slot via `game.move.select`; the guest slot via the
// CoopBattleSync responder) and each INTERACTION via the existing owner/watcher reward drivers - while
// driving the guest's REAL replay each wave ({@linkcode driveGuestReplayTurn}) and asserting convergence.
// A no-progress stall THROWS (the hang detector). It REUSES the existing drivers (buildDuo /
// remirrorWave / driveGuestReplayTurn / driveHostRewardShopOwner / driveGuestRewardWatch) - it does NOT
// rebuild them. The trace SCHEMA is general (single-player reuse is a thin add); THIS loader is the
// co-op replayer.
// =============================================================================

/** The minimal GameManager surface the replay loader drives (so the harness need not import GameManager). */
export interface ReplayGameManager {
  scene: BattleScene;
  override: {
    battleStyle(s: "single" | "double"): unknown;
    moveset(moves: number[]): unknown;
    startingLevel(n: number): unknown;
    startingWave(wave: number | null): unknown;
  };
  classicMode: { runToSummon(...species: number[]): Promise<void> };
  move: { select(move: number, pkmIndex?: number, target?: number | null): void };
  phaseInterceptor: { to(target: string, runTarget?: boolean): Promise<void> };
}

/** A divergence the loader observed while replaying (a non-fatal mismatch surfaced for the test). */
export interface ReplayDivergence {
  wave: number;
  detail: string;
}

/** The outcome of replaying a {@linkcode ReplayTrace} (a test asserts reproduction off this). */
export interface ReplayResult {
  /** Number of waves replayed to completion. */
  wavesReplayed: number;
  /** Number of battle-command events fed. */
  commandsFed: number;
  /** Number of interaction events applied (reward picks / leaves). */
  interactionsApplied: number;
  /** Number of guest full-state resyncs requested across the run (a converged run is bounded). */
  resyncCount: number;
  /** Non-fatal divergences observed (empty for a clean reproduction). */
  divergences: ReplayDivergence[];
  /** The final interaction counter both controllers reached (asserted equal => lockstep). */
  finalHostCounter: number;
  finalGuestCounter: number;
}

/** Flip a scene into the co-op game mode (the loader's internal `toCoop`, so callers need not pass one). */
function replayToCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

/** Resolve a captured move SLOT to the live mon's `MoveId` at that slot (the loader stays slot-based). */
function resolveMoveIdForSlot(mon: Pokemon, moveIndex: number): number {
  const moveset = mon.getMoveset();
  const pm = moveset[moveIndex];
  if (pm == null) {
    throw new Error(
      `replay: move slot ${moveIndex} out of range for ${mon.name} (moveset has ${moveset.length} moves)`,
    );
  }
  return pm.moveId;
}

/**
 * Build the {@linkcode CoopBattleSync} responder for the GUEST slot from this wave's captured guest
 * command. The host AWAITS the guest slot's command over the relay; here we answer it with the trace's
 * decision (resolving the captured move slot to the live guest mon's MoveId). A non-move command on the
 * guest slot is uncommon in the wave loop; we answer FIGHT with the first legal slot as a safe default
 * (and record a divergence) so the turn never hangs.
 */
function guestCommandResponder(
  rig: DuoRig,
  cmd: ReplayCommandEvent | undefined,
  divergences: ReplayDivergence[],
): SerializedCommand {
  const guestMon = rig.guestScene.getPlayerField()[COOP_GUEST_FIELD_INDEX];
  if (cmd != null && cmd.command.kind === "move") {
    const moveId = resolveMoveIdForSlot(guestMon, cmd.command.moveIndex);
    return {
      command: Command.FIGHT,
      cursor: cmd.command.moveIndex,
      moveId,
      targets: [cmd.command.target ?? BattlerIndex.ENEMY_2],
    };
  }
  // No captured move for the guest slot this wave (or a non-move command the wave loop can't drive):
  // answer FIGHT with the first move so the host's request resolves; record it so a test can see it.
  divergences.push({
    wave: rig.hostScene.currentBattle.waveIndex,
    detail: `guest slot had no replayable move command (kind=${cmd?.command.kind ?? "none"}); used first move`,
  });
  const moveset = guestMon.getMoveset();
  return {
    command: Command.FIGHT,
    cursor: 0,
    moveId: moveset.length > 0 ? moveset[0].moveId : 0,
    targets: [BattlerIndex.ENEMY_2],
  };
}

/**
 * Feed one field slot's captured FIGHT move into the host (under `withClient(hostCtx)`). Resolves the
 * captured move SLOT to the live mon's MoveId and selects it at the captured (or default) target. A
 * missing/non-move command falls back to the slot's first move so the host's double commits both slots
 * (the wave never hangs); the caller records a divergence for the missing capture.
 */
function feedHostFightMove(
  game: ReplayGameManager,
  rig: DuoRig,
  fieldIndex: number,
  cmd: ReplayCommandEvent | undefined,
): void {
  const mon = rig.hostScene.getPlayerField()[fieldIndex];
  const defaultTarget = fieldIndex === COOP_HOST_FIELD_INDEX ? BattlerIndex.ENEMY : BattlerIndex.ENEMY_2;
  if (cmd != null && cmd.command.kind === "move") {
    const moveId = resolveMoveIdForSlot(mon, cmd.command.moveIndex);
    game.move.select(moveId, fieldIndex, cmd.command.target ?? defaultTarget);
    return;
  }
  const firstMoveId = mon.getMoveset()[0]?.moveId;
  if (firstMoveId != null) {
    game.move.select(firstMoveId, fieldIndex, defaultTarget);
  }
}

/** Restore the window-start session state after the test launcher has built the checkpoint wave. */
function restoreCoopReplayCheckpoint(scene: BattleScene, checkpoint: NonNullable<ReplayTrace["checkpoint"]>): void {
  const party = scene.getPlayerParty();
  party.splice(0, party.length);
  for (const [index, raw] of checkpoint.party.entries()) {
    const checkpointMoves = (raw.moveset ?? []).map(move => PokemonMove.loadMove(move));
    const data = new PokemonData(raw);
    data.ivs ??= [31, 31, 31, 31, 31, 31];
    const mon = new PlayerPokemon(
      getPokemonSpecies(data.species),
      data.level,
      data.abilityIndex,
      data.formIndex,
      data.gender,
      data.shiny ?? false,
      data.variant ?? 0,
      data.ivs,
      data.nature ?? 0,
      data,
    );
    mon.coopOwner = data.coopOwner ?? (index % 2 === 0 ? "host" : "guest");
    mon.calculateStats();
    // Test overrides may replace a constructor's moveset; the checkpoint is authoritative.
    mon.moveset = checkpointMoves;
    party.push(mon);
  }

  scene.money = checkpoint.money;
  scene.pokeballCounts = Object.fromEntries(
    Object.entries(checkpoint.pokeballCounts).map(([kind, count]) => [Number(kind), count]),
  );

  scene.modifiers = [];
  for (const raw of checkpoint.modifiers) {
    const data = new ModifierData(raw, true);
    const ctor = Modifier[data.className as keyof typeof Modifier] ?? resolveErModifierClass(data.className);
    const modifier = data.toModifier(ctor);
    if (modifier != null) {
      scene.addModifier(modifier, true);
    }
  }
}

/**
 * Replay a captured {@linkcode ReplayTrace} across BOTH engines (#record-replay, Phase 1). Seeds the
 * HOST run, flips to co-op, and walks the trace's events wave-by-wave feeding commands + interactions
 * and driving the guest replay, asserting convergence (the guest's enemies reach the host-KO'd state +
 * the interaction counters stay lockstep). THROWS on a no-progress stall (the hang detector) so a
 * regression fails loudly. Returns a {@linkcode ReplayResult} a test asserts reproduction off.
 *
 * The run stops before its first EncounterPhase to pin the captured seed; when a window checkpoint exists,
 * the launcher starts at its wave and then restores its full PokemonData party, modifiers, money, and ball
 * inventory before the duo runtime is assembled. A legacy trace without a checkpoint still boots from its header.
 * Commands
 * are the wave-loop FIGHT class (both slots) and interactions are the reward-shop owner/watcher leave +
 * non-party pick the existing drivers support; richer command/interaction classes extend the same loop.
 *
 * `game` is the host {@linkcode GameManager} (already constructed, with overrides stageable). `trace`
 * is validated first (a malformed trace THROWS with the precise reason). `resyncSpy` is an optional
 * counter (a vi spy's call count) the caller wires onto `CoopBattleStreamer.requestStateSync` so the
 * result can report the resync count. `pairFactory` and the two boundary hooks are test-only seams for
 * a fully scheduled transport: boot/battle traffic may remain automatic, then the caller disables it
 * immediately before each retained reward interaction and re-enables it only before the next battle.
 * Their absence preserves the ordinary loopback path exactly.
 */
export async function replayCoopTrace(
  game: ReplayGameManager,
  trace: ReplayTrace,
  opts: {
    resyncCount?: () => number;
    pairFactory?: () => { host: CoopTransport; guest: CoopTransport };
    beforeRewardBoundary?: () => void;
    afterRewardBoundary?: () => void;
  } = {},
): Promise<ReplayResult> {
  const validation = validateReplayTrace(trace);
  if (!validation.ok) {
    throw new Error(`replayCoopTrace: invalid trace - ${validation.errors.join("; ")}`);
  }

  const divergences: ReplayDivergence[] = [];
  const commandEvents = trace.events.filter(isReplayCommandEvent);
  const interactionEvents = trace.events.filter(isReplayInteractionEvent);

  // ===== Seed the HOST run. Prefer the window-start checkpoint's ACTUAL party/wave/seed over the stale
  // launch header; absent checkpoint preserves the v1/header behavior. =====
  // Detach from the trace object: constructors/test overrides must never mutate the forensic evidence
  // that a second host/guest rebuild still needs later in this loader.
  const checkpoint =
    trace.checkpoint == null
      ? undefined
      : (structuredClone(trace.checkpoint) as NonNullable<ReplayTrace["checkpoint"]>);
  const bootRoster = checkpoint?.party ?? trace.roster;
  const bootSeed = checkpoint?.seed ?? trace.seed;
  game.override.battleStyle("double");
  if (checkpoint != null) {
    game.override.startingWave(checkpoint.wave);
  }
  const rosterSpecies = bootRoster.map(d => d.species).filter((s): s is number => typeof s === "number");
  if (rosterSpecies.length < 2) {
    throw new Error(`replayCoopTrace: co-op needs >=2 roster mons, got ${rosterSpecies.length}`);
  }
  // Stop immediately before EncounterPhase so the captured seed is installed before the battle/enemies
  // are generated. Calling startBattle after OverridesHelper.seed would let the title reset replace it
  // with the test framework's default seed, producing a superficially valid but non-representative replay.
  await game.classicMode.runToSummon(...rosterSpecies.slice(0, 2));
  game.scene.setSeed(bootSeed);
  await game.phaseInterceptor.to("CommandPhase");
  if (checkpoint != null) {
    // The test launcher may use a global player-moveset override to make the throwaway bootstrap battle
    // deterministic. Pokemon.getMoveset() reapplies that override on every read (and mutates the stored
    // moves), so it must end before the authoritative checkpoint party is installed.
    game.override.moveset([]);
    restoreCoopReplayCheckpoint(game.scene, checkpoint);
  }

  // ===== Flip to co-op + stand up the guest engine over one loopback pair (host owns EVEN interaction
  // counters, guest owns ODD - the production parity rule buildDuo wires). =====
  const pair = opts.pairFactory?.() ?? createLoopbackPair();
  const rig = await buildDuo(game as unknown as Parameters<typeof buildDuo>[0], pair, setCoopRuntime, replayToCoop);
  if (checkpoint != null) {
    // `buildDuo` constructs a second scene while test overrides are live. Reassert the checkpoint on the
    // host afterward, then mirror that exact post-checkpoint state into the guest before any event replays.
    await withClient(rig.hostCtx, () => restoreCoopReplayCheckpoint(rig.hostScene, checkpoint));
    await remirrorWave(rig);
  }

  // The captured waves, in order (a Set keeps them unique + sorted).
  const waves = [...new Set(commandEvents.map(c => c.wave))].sort((a, b) => a - b);
  let commandsFed = 0;
  let interactionsApplied = 0;
  let wavesReplayed = 0;

  for (const wave of waves) {
    // The guest's battle must mirror the host's CURRENT (this-wave) field before the host plays.
    if (wavesReplayed > 0) {
      await remirrorWave(rig);
    }

    const waveCommands = commandEvents.filter(c => c.wave === wave);
    const hostCmd = waveCommands.find(c => c.slotFieldIndex === COOP_HOST_FIELD_INDEX);
    const guestCmd = waveCommands.find(c => c.slotFieldIndex === COOP_GUEST_FIELD_INDEX);

    // Wire the GUEST slot's command (answered over the CoopBattleSync relay when the host requests it).
    rig.guestRuntime.battleSync.onCommandRequest(() => guestCommandResponder(rig, guestCmd, divergences));

    // ===== Host plays this wave: feed BOTH slots' captured FIGHT moves (the host commits both in a
    // co-op double; the guest slot's command is ALSO answered over the relay by the responder above).
    // For Phase 1 this is the FIGHT class (the wave-loop drivers); a non-move host command records a
    // divergence (the existing drivers don't cover switch/ball/run yet). =====
    const turn = rig.hostScene.currentBattle.turn;
    await withClient(rig.hostCtx, async () => {
      if (hostCmd != null && hostCmd.command.kind === "move") {
        feedHostFightMove(game, rig, COOP_HOST_FIELD_INDEX, hostCmd);
        feedHostFightMove(game, rig, COOP_GUEST_FIELD_INDEX, guestCmd);
        commandsFed += waveCommands.length;
      } else {
        divergences.push({
          wave,
          detail: `host slot command kind=${hostCmd?.command.kind ?? "none"} not replayable by the wave-loop drivers (FIGHT only)`,
        });
      }
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });

    // ===== Guest replays the host's turn + applies the checkpoint (renders the host's outcome). =====
    await withClient(rig.guestCtx, async () => {
      await driveGuestReplayTurn(rig.guestScene, turn);
    });
    const guestEnemiesFainted = rig.guestScene.currentBattle.enemyParty.every(e => e.isFainted());
    if (!guestEnemiesFainted) {
      divergences.push({ wave, detail: "guest enemies did NOT converge to the host-KO'd state" });
    }

    // ===== The reward shop interaction for this wave: the OWNER (by counter parity) drives, the WATCHER
    // mirrors. Apply the captured interaction for this wave's reward seq (a leave / non-party pick). =====
    opts.beforeRewardBoundary?.();
    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    const hostOwns = counterBefore % 2 === 0;
    const waveInteraction = interactionEvents.find(e => e.seq === counterBefore);
    const takeReward = waveInteraction != null && waveInteraction.choice >= 0 && waveInteraction.kind === "reward";

    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("SelectModifierPhase", false);
    });
    const hostShop = rig.hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
    if (hostShop.phaseName === "SelectModifierPhase") {
      const guestShop = await withClient(rig.guestCtx, () => reachQueuedRewardShop(rig.guestScene));
      if (hostOwns) {
        await withClient(rig.hostCtx, () => driveHostRewardShopOwner(hostShop, { takeReward }));
        await withClient(rig.guestCtx, () => driveGuestRewardWatch(guestShop));
      } else {
        await withClient(rig.guestCtx, () => driveHostRewardShopOwner(guestShop, { takeReward }));
        await withClient(rig.hostCtx, () => driveGuestRewardWatch(hostShop));
      }
      await pumpDuoDestinations(rig);
      if (waveInteraction != null) {
        interactionsApplied++;
      }
      // Lockstep check: both controllers advanced exactly once for this interaction.
      if (
        rig.hostRuntime.controller.interactionCounter() !== counterBefore + 1
        || rig.guestRuntime.controller.interactionCounter() !== counterBefore + 1
      ) {
        divergences.push({
          wave,
          detail: `interaction counter NOT lockstep after wave ${wave} (host=${rig.hostRuntime.controller.interactionCounter()} guest=${rig.guestRuntime.controller.interactionCounter()})`,
        });
      }
    }

    wavesReplayed++;

    // ===== Host crosses into the next wave's battle (real EncounterPhase rolls wave w+1). =====
    if (wavesReplayed < waves.length) {
      opts.afterRewardBoundary?.();
      await arriveGuestCommandBoundary(rig, wave + 1);
      await withClient(rig.hostCtx, async () => {
        await game.phaseInterceptor.to("CommandPhase");
      });
    }
  }

  return {
    wavesReplayed,
    commandsFed,
    interactionsApplied,
    resyncCount: opts.resyncCount?.() ?? 0,
    divergences,
    finalHostCounter: rig.hostRuntime.controller.interactionCounter(),
    finalGuestCounter: rig.guestRuntime.controller.interactionCounter(),
  };
}

// =============================================================================
// SHOWDOWN 1v1 VERSUS RIG (C6v2d). A VERSUS-shaped two-engine rig - deliberately NOT the co-op
// buildDuo shape: NO merged party, NO coopOwner field tags, NO interaction-alternation. The HOST
// is a real engine whose OWN team is the PLAYER side and whose ENEMY side is the OPPONENT manifest
// built as a TRAINER (the C3 bootstrap, already live before this is called). The GUEST is a pure
// renderer booted from the host's battle (the same mirror the co-op guest uses), whose OWN team is
// the authoritative ENEMY side. The guest's per-turn command rides the ShowdownCommandRelay (the
// enemy-command seam), NOT CoopBattleSync. Both runtimes are pinned to the "versus" session kind so
// isVersusSession()/isAuthoritativeBattleSession()/isShowdownGuestFlip() are all live.
// =============================================================================

/** The versus two-engine rig: both runtimes over one loopback pair, plus the enemy-command relays. */
export interface ShowdownDuoRig {
  hostScene: BattleScene;
  guestScene: BattleScene;
  hostRuntime: CoopRuntime;
  guestRuntime: CoopRuntime;
  hostCtx: ClientCtx;
  guestCtx: ClientCtx;
  pair: { host: CoopTransport; guest: CoopTransport };
  /** The HOST's relay: its EnemyCommandPhase awaits the guest's command here (getShowdownRelay reads it). */
  hostRelay: ShowdownCommandRelay;
  /** The GUEST's peer relay: the test installs a responder / ships commands for the guest's own team. */
  guestPeer: ShowdownCommandRelay;
}

/**
 * Stand up the VERSUS two-engine rig over ONE {@linkcode createLoopbackPair}. The HOST GameManager
 * MUST already be in a live SHOWDOWN battle (the C3 bootstrap: gameMode SHOWDOWN, opponent manifest
 * fielded as a TRAINER enemy party, {@linkcode beginShowdownBattle} stashed). This assembles both
 * runtimes pinned to the "versus" kind, builds the guest {@linkcode BattleScene}, mirrors the host's
 * battle onto it (the guest's own team = the authoritative ENEMY side), creates the enemy-command
 * relays and RE-stashes {@linkcode beginShowdownBattle} with the HOST relay (so the host's
 * EnemyCommandPhase awaits it), then connects + drains the handshake.
 *
 * Deliberately does NOT tag `coopOwner` on the field (no merged party in versus) and does NOT wire a
 * CoopBattleSync command answer (the guest commands its OWN team via the ShowdownCommandRelay).
 */
export async function buildShowdownDuo(
  hostGame: GameManager,
  pair: { host: CoopTransport; guest: CoopTransport },
  setCoopRuntimeFn: (r: CoopRuntime) => void,
  toShowdownGameMode: (scene: BattleScene) => void,
): Promise<ShowdownDuoRig> {
  const hostScene = hostGame.scene;
  neutralizeCoopCandyBar(hostScene);
  const hostRuntime = assembleCoopRuntime(pair.host, {
    username: "Host",
    netcodeMode: "authoritative",
    kind: "versus",
  });
  const guestRuntime = assembleCoopRuntime(pair.guest, {
    username: "Guest",
    netcodeMode: "authoritative",
    kind: "versus",
  });
  const scheduledPair = pair as typeof pair & { flush?: (role: "host" | "guest", limit?: number) => number };
  hostRuntime.controller.role = "host";
  guestRuntime.controller.role = "guest";

  // authority-v2 (versus uses the RAW loopback pair directly): HOLD inbound v2 frames on each endpoint until
  // the destination context pumps them, so a delivered TURN_COMMIT admits + applies the replacement under the
  // RECEIVING realm - not the host's synchronous ambient (the empty-enemy strand). `pumpInbound` (below)
  // drains them. Feature-detected: a scheduled pair that owns its own v2 delivery leaves these absent.
  pair.host.setV2InboundDeferred?.(true);
  pair.guest.setV2InboundDeferred?.(true);
  const pumpInboundFor = (role: "host" | "guest") => (): number =>
    (scheduledPair.flush?.(role) ?? 0) + (pair[role].pumpV2Inbound?.() ?? 0);

  // The host is already a showdown engine (idempotent flip). NO coopOwner tags - versus has no merged party.
  toShowdownGameMode(hostScene);

  // CLONE the host's FULL persistent-modifier stacks (BOTH sides) NOW, while globalScene is still the
  // host (buildGuestScene below steals it). The mirror's PokemonData round-trip carries no modifier
  // objects, and the checksum hashes both the aggregate player `modifiers` list AND the on-field
  // `heldItems` digest - so the guest must carry EVERY persistent modifier (per-mon held items AND
  // player-wide items like MAP), or wave-start parity fails. VERSUS FLIP (Task F1): the guest's LOCAL
  // player modifiers are the host's ENEMY stack (its own team) and its LOCAL enemy modifiers the host's
  // PLAYER stack - exactly the launch-snapshot swap production applies (getSessionSaveData serializes
  // every modifier; swapSessionData trades the two lists). Each `.clone()` preserves pokemonId + stack,
  // and the guest mons keep the host ids via the PokemonData round-trip so held items rebind by id.
  const clonedHostEnemyModifiers: PersistentModifier[] = hostScene
    .findModifiers(m => m instanceof PersistentModifier, false)
    .map(m => m.clone());
  const clonedHostPlayerModifiers: PersistentModifier[] = hostScene
    .findModifiers(m => m instanceof PersistentModifier, true)
    .map(m => m.clone());

  const hostCtx: ClientCtx = {
    label: "host",
    scene: hostScene,
    runtime: hostRuntime,
    rndState: Phaser.Math.RND.state(),
    ghost: snapshotGhostState(),
    moduleLets: snapshotModuleLets(),
    biomeState: snapshotBiomeModuleState(),
    mePins: { ...IDLE_ME_PINS },
    pumpInbound: pumpInboundFor("host"),
  };

  // The 2nd real BattleScene (steals globalScene; withClient re-points it per pump).
  const guestScene = buildGuestScene(hostGame);
  installHeadlessCoopSemanticProjectionOracle(guestScene);
  const guestCtx: ClientCtx = {
    label: "guest",
    scene: guestScene,
    runtime: guestRuntime,
    rndState: Phaser.Math.RND.state(),
    ghost: emptyGhostSnapshot(),
    moduleLets: snapshotModuleLets(),
    biomeState: structuredClone(hostCtx.biomeState!),
    mePins: { ...IDLE_ME_PINS },
    pumpInbound: pumpInboundFor("guest"),
  };
  await withClient(guestCtx, () => {
    toShowdownGameMode(guestScene);
    // The mirror reconstructs the guest's world in its LOCAL (flipped) orientation (Task F1): its OWN
    // team is its local PLAYER party (bottom) and the opponent (host team) its local ENEMY party (top).
    mirrorHostBattleToGuest(hostScene, guestScene);
    // Reconstruct the guest's persistent-modifier stacks in its LOCAL (flipped) orientation. The mirror's
    // adoptCoopHostRunConfig rebuilt the host's PLAYER-wide modifiers onto the guest PLAYER side (correct
    // for co-op, WRONG for versus where they are the opponent's), so CLEAR both lists and repopulate from
    // the host's cloned stacks flipped: guest PLAYER <- host ENEMY (own team), guest ENEMY <- host PLAYER
    // (opponent). This mirrors the launch-snapshot swap, so the egress un-swap reproduces the host's hash.
    const guestPlayerModifiers = (guestScene as unknown as { modifiers: PersistentModifier[] }).modifiers;
    const guestEnemyModifiers = (guestScene as unknown as { enemyModifiers: PersistentModifier[] }).enemyModifiers;
    guestPlayerModifiers.length = 0;
    guestEnemyModifiers.length = 0;
    for (const m of clonedHostEnemyModifiers) {
      guestPlayerModifiers.push(m);
    }
    for (const m of clonedHostPlayerModifiers) {
      guestEnemyModifiers.push(m);
    }
    guestScene.updateModifiers(false);
  });

  // The enemy-command relays: the HOST awaits the guest's command; the guest peer answers / ships it.
  const hostRelay = new ShowdownCommandRelay(pair.host);
  const guestPeer = new ShowdownCommandRelay(pair.guest);
  // Re-stash the live match with the HOST relay so the host's EnemyCommandPhase (getShowdownRelay) awaits
  // the guest's pick. The manifests were stashed by the C3 bootstrap; reuse them verbatim.
  const own = getShowdownOwnManifest();
  const opponent = getShowdownOpponentManifest();
  if (own != null && opponent != null) {
    beginShowdownBattle(own, opponent, hostRelay);
  }

  // Connect both controllers over the live loopback (exchange hello / runConfig).
  setCoopRuntimeFn(hostRuntime);
  hostRuntime.controller.connect();
  setCoopRuntimeFn(guestRuntime);
  guestRuntime.controller.connect();
  await drainLoopback();

  // Production installs both versus runtimes before CommandPhase accepts input. Showdown fixtures
  // deliberately stop at the pre-command boundary so the orphan-runtime guard remains meaningful;
  // open the host command surface only after the authoritative pair has connected.
  await withClient(hostCtx, () => hostGame.phaseInterceptor.to("CommandPhase"));

  const rig = { hostScene, guestScene, hostRuntime, guestRuntime, hostCtx, guestCtx, pair, hostRelay, guestPeer };
  // Showdown rigs own the same two independently assembled runtimes as ordinary co-op rigs. Register
  // them with the shared afterEach teardown too: clearing only the ambient (usually guest) runtime leaves
  // the host battle stream's retained replacement timer alive, so a prior test can retransmit an old-epoch
  // checkpoint into the next match and reopen CoopGuestFaintSwitchPhase after the new replacement settled.
  installDuoCtxOwnershipPins(rig, hostGame);
  liveDuoRigs.add(rig);
  return rig;
}
