/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { PokemonSpecies } from "../src/data/pokemon-species";
import type { Pokemon } from "../src/field/pokemon";
import type { SaveSlotSelectUiHandler } from "../src/ui/handlers/save-slot-select-ui-handler";

// CI-only production-bundle entry. It boots the normal application first, then exposes the narrow transport
// seam used by the browser checkpoint. This file is included only by vite.coop-browser.config.mjs; no staged
// or production deployment imports it.

await import("../src/main");

const [
  { globalScene },
  { captureCoopSaveDataDigest },
  { canonicalize, fnv1a64 },
  { getCoopRuntime },
  { BattlerTagType },
  { BattleType },
  { Command },
  { MoveId },
  { PokemonModifierType },
  { PartyOption, PartyUiMode },
  { StatusEffect },
  { UiMode },
] = await Promise.all([
  import("../src/global-scene"),
  import("../src/data/elite-redux/coop/coop-battle-engine"),
  import("../src/data/elite-redux/coop/coop-battle-checksum"),
  import("../src/data/elite-redux/coop/coop-runtime"),
  import("../src/enums/battler-tag-type"),
  import("../src/enums/battle-type"),
  import("../src/enums/command"),
  import("../src/enums/move-id"),
  import("../src/modifier/modifier-type"),
  import("../src/ui/handlers/party-ui-handler"),
  import("../src/enums/status-effect"),
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
  readonly battleType: string;
  readonly trainerBoss: boolean;
  readonly maxBossSegments: number;
}

const SURFACE_PREFIX = "[coop-browser:surface] ";
const SURFACE2_PREFIX = "[coop-browser:surface2] ";
const BINDING_PREFIX = "[coop-browser:binding] ";
const DIGEST_PARTS_PREFIX = "[coop-browser:digest-parts] ";

// =============================================================================
// Optimization brief R4: digest-cost SLA. Detection latency is FIXED (1s parked
// watchdog + immediate on-change); digest COST is budgeted instead. Durations
// are ring-buffered; a p95 above the budget is a loud PERFORMANCE FAILURE via
// console.error (the EvidenceSink treats observer errors as fatal), never a
// silent widening of the detection interval.
// =============================================================================
const DIGEST_BUDGET_MS = Number(
  (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.COOP_OBSERVER_DIGEST_BUDGET_MS ?? 50,
);
const digestDurationsMs: number[] = [];
let digestBudgetReported = false;

function recordDigestDuration(durationMs: number): void {
  digestDurationsMs.push(durationMs);
  if (digestDurationsMs.length > 200) {
    digestDurationsMs.shift();
  }
  if (digestBudgetReported || digestDurationsMs.length < 20) {
    return;
  }
  const sorted = [...digestDurationsMs].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  if (p95 > DIGEST_BUDGET_MS) {
    digestBudgetReported = true;
    console.error(
      `[coop-browser:semantic-observer-error] mechanical digest p95 ${p95.toFixed(1)}ms exceeds the `
        + `${DIGEST_BUDGET_MS}ms budget over ${sorted.length} samples - optimize or offload the digest; `
        + "the 1s detection SLA may not be widened",
    );
  }
}
const RENDER_PROFILE_PREFIX = "[coop-browser:render-profile] ";
const MARKET_PREFIX = "[coop-browser:market] ";
const COMMANDER_PREFIX = "[coop-browser:commander] ";
const CHECKSUM_SENTINEL = "0000000000000000";

/**
 * The ER 3-slot innate ability ids (index 0..2; -1 = empty slot), read-only. Included so innate
 * activation is TRACKED by the digest (a divergence self-identifies) and assertable at the first
 * battle surface. Never mutates: it only reads the passive-ability projection.
 */
function safeInnateIds(pokemon: Pokemon): number[] {
  try {
    return pokemon
      .getPassiveAbilities()
      .slice(0, 3)
      .map(ability => (ability == null ? -1 : ability.id));
  } catch {
    return [];
  }
}

function observedPokemon(pokemon: Pokemon, slot: number) {
  return {
    slot,
    species: pokemon.species.speciesId,
    form: pokemon.formIndex,
    ability: pokemon.abilityIndex,
    // Normalize the legacy `passive` flag to a boolean: the host's fresh party carries `undefined`
    // and the guest's snapshot-booted party carries `false` (game-mechanically equal) - the layer-8
    // digest divergence. Read-only projection normalization; never writes pokemon.passive and never
    // touches the ER 3-slot innate model (getPassiveAbilities / pokemon.ts hasPassive).
    passive: pokemon.passive ?? false,
    passiveAbilities: safeInnateIds(pokemon),
    shiny: pokemon.shiny,
    variant: pokemon.variant,
    level: pokemon.level,
    exp: pokemon.exp,
    hp: pokemon.hp,
    maxHp: pokemon.stats[0] ?? 0,
    // Hash the mechanically meaningful status projection, not constructor ephemera. `doSetStatus` stores
    // sleepTurnsRemaining=0 on every non-sleep status while an authoritative deserialize uses undefined;
    // both are the same game state. Likewise, toxicTurnCount matters only for TOXIC. Preserving the relevant
    // counter for its owning status still catches real sleep/toxic drift without manufacturing a faint-status
    // divergence immediately after an otherwise checksum-identical retained turn commit.
    status:
      pokemon.status == null
        ? null
        : {
            effect: pokemon.status.effect,
            toxicTurnCount: pokemon.status.effect === StatusEffect.TOXIC ? pokemon.status.toxicTurnCount : 0,
            sleepTurnsRemaining:
              pokemon.status.effect === StatusEffect.SLEEP ? (pokemon.status.sleepTurnsRemaining ?? null) : null,
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

/** The canonical component object the mechanical digest hashes. Read once, reused for the breakdown. */
function mechanicalDigestComponents(): Record<string, unknown> {
  const saveDataDigest = captureCoopSaveDataDigest();
  if (saveDataDigest === CHECKSUM_SENTINEL) {
    throw new Error("save-data observer could not capture a stable digest");
  }
  const playerParty = globalScene.getPlayerParty();
  const enemyParty = globalScene.getEnemyParty();
  return {
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
  };
}

/**
 * A strong observer-only projection (non-mutating). Returns the combined digest AND a per-component
 * hash breakdown (incl. a per-mon-field split of playerParty/enemyParty) so a two-browser digest
 * divergence self-identifies the exact field rather than only the opaque combined hash.
 */
function partyInnates(party: unknown): number[][] {
  return Array.isArray(party)
    ? party.map(mon => {
        const value = (mon as Record<string, unknown> | null)?.passiveAbilities;
        return Array.isArray(value) ? (value as number[]) : [];
      })
    : [];
}

function partyStageVectors(party: unknown): number[][] {
  return Array.isArray(party)
    ? party.map(mon => {
        const value = (mon as Record<string, unknown> | null)?.statStages;
        return Array.isArray(value) ? (value as number[]) : [];
      })
    : [];
}

function computeMechanicalDigest(): {
  digest: string;
  parts: Record<string, string>;
  innates: { player: number[][]; enemy: number[][] };
  stages: { player: number[][]; enemy: number[][] };
} {
  const components = mechanicalDigestComponents();
  const digest = fnv1a64(canonicalize(components));
  const parts: Record<string, string> = {};
  for (const [key, value] of Object.entries(components)) {
    parts[key] = fnv1a64(canonicalize(value));
    // Split party arrays into per-observed-field column hashes so the diverging field is named.
    if ((key === "playerParty" || key === "enemyParty") && Array.isArray(value) && value.length > 0) {
      const first = value[0];
      if (first != null && typeof first === "object") {
        for (const field of Object.keys(first as Record<string, unknown>)) {
          parts[`${key}.${field}`] = fnv1a64(canonicalize((value as Record<string, unknown>[]).map(mon => mon[field])));
        }
      }
    }
  }
  // Raw per-mon innate ids so the driver can assert enemy innates are LIVE (and both browsers agree).
  const innates = { player: partyInnates(components.playerParty), enemy: partyInnates(components.enemyParty) };
  // Raw stage vectors turn a digest mismatch into exact causal evidence (which mon/stat changed) without
  // exposing a mutation hook. This caught the pre-command Let’s Roll +DEF host-only entry effect.
  const stages = {
    player: partyStageVectors(components.playerParty),
    enemy: partyStageVectors(components.enemyParty),
  };
  return { digest, parts, innates, stages };
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
  if ((phase === "SwitchPhase" || phase === "CoopGuestFaintSwitchPhase") && uiMode === "PARTY") {
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
    // Optimization brief R4: four-trigger digest with a FIXED detection SLA. A CHANGED
    // addressKey (surface/phase/uiMode/wave/turn/epoch/membership revision - i.e. every
    // boundary, tracked change, and acked-input consequence) digests IMMEDIATELY by
    // bypassing this guard; while PARKED on one stable interactive surface the watchdog
    // re-digests at a fixed 1s. Adaptive widening is forbidden - a slow runner must not
    // receive weaker desync detection.
    if (addressKey === lastProbedAddress && now - lastProbeAt < 1_000) {
      return;
    }
    lastProbedAddress = addressKey;
    lastProbeAt = now;
    const digestStartedMs = performance.now();
    const { digest: stateDigest, parts: digestParts, innates, stages } = computeMechanicalDigest();
    recordDigestDuration(performance.now() - digestStartedMs);
    const observationKey = `${addressKey}:${stateDigest}`;
    if (observationKey === lastObservedSurface) {
      return;
    }
    lastObservedSurface = observationKey;
    // Read-only diagnostic: the per-component digest breakdown (so a two-browser digest divergence
    // self-identifies the exact field) plus the raw per-mon innate ids (so the driver can assert the
    // ace-difficulty enemy's innates are LIVE and both browsers agree - the innate-activation invariant).
    console.info(
      `${DIGEST_PARTS_PREFIX}${JSON.stringify({ address: `${runtime.controller.sessionEpoch}:${battle.waveIndex}:${battle.turn}`, surface, digest: stateDigest, parts: digestParts, innates, stages })}`,
    );
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
      battleType: BattleType[battle.battleType],
      trainerBoss: battle.trainer?.config.isBoss === true,
      maxBossSegments: Math.max(0, ...globalScene.getEnemyParty().map(pokemon => pokemon.bossSegments ?? 0)),
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

// --- Semantic surface mirror (v2): a read-only projection of EVERY active interactive
// surface, so a state-aware driver can read the visible options, pick by stable id, and
// verify convergence instead of pulsing blind keys. STRICTLY READ-ONLY: it only reads the
// same public UI/runtime accessors the v1 marker uses and never mutates a scene, phase,
// handler, or protocol. Gaps (fields the game exposes no observable signal for) are
// recorded in test/browser/coop-public-ui/blocked-instrumentation.md rather than faked.

type SemanticOwnerModel = "interaction" | "local";

interface SemanticSurface {
  readonly surfaceId: string;
  readonly operationClass: string;
  readonly ownerModel: SemanticOwnerModel;
}

/** Map (phase, uiMode) to a stable semantic surfaceId + operation class + ownership model. */
function classifySemanticSurface(phase: string, uiMode: string): SemanticSurface | null {
  const inMe =
    phase.startsWith("MysteryEncounter")
    || phase === "PostMysteryEncounterPhase"
    || phase === "CoopReplayMePhase"
    || phase === "TheBargainPhase";
  switch (uiMode) {
    case "LOGIN_OR_REGISTER":
      return { surfaceId: "auth:login-or-register", operationClass: "authentication", ownerModel: "local" };
    case "TITLE":
      return { surfaceId: "title-menu", operationClass: "navigation", ownerModel: "local" };
    case "COMMAND":
    case "FIGHT":
    case "BALL":
      return phase === "CommandPhase"
        ? { surfaceId: `command:${uiMode.toLowerCase()}`, operationClass: "command", ownerModel: "local" }
        : null;
    case "TARGET_SELECT":
      return phase === "SelectTargetPhase"
        ? { surfaceId: "command:target", operationClass: "command", ownerModel: "local" }
        : null;
    case "STARTER_SELECT":
      return { surfaceId: "starter-select", operationClass: "starter", ownerModel: "local" };
    case "CHALLENGE_SELECT":
      return { surfaceId: "challenge-select", operationClass: "setup", ownerModel: "local" };
    case "MODIFIER_SELECT":
      return { surfaceId: "reward-shop", operationClass: "reward", ownerModel: "interaction" };
    case "BIOME_SHOP":
      return { surfaceId: "biome-market", operationClass: "shop", ownerModel: "interaction" };
    case "ER_MAP":
      return { surfaceId: "world-map", operationClass: "navigation", ownerModel: "interaction" };
    case "ER_MAP_PICKER":
      return { surfaceId: "map-picker", operationClass: "navigation", ownerModel: "interaction" };
    case "MYSTERY_ENCOUNTER":
      return { surfaceId: "mystery-encounter", operationClass: "encounter", ownerModel: "interaction" };
    case "COLOSSEUM":
      return { surfaceId: "colosseum", operationClass: "encounter", ownerModel: "interaction" };
    case "ER_QUIZ":
      return { surfaceId: "quiz", operationClass: "encounter", ownerModel: "interaction" };
    case "ER_BARGAIN":
      return { surfaceId: "bargain", operationClass: "encounter", ownerModel: "interaction" };
    case "ER_SHINY_LAB":
      return { surfaceId: "shiny-lab", operationClass: "cosmetic", ownerModel: "local" };
    case "SHOWDOWN_WAGER":
      return { surfaceId: "wager", operationClass: "encounter", ownerModel: "interaction" };
    case "LEARN_MOVE_BATCH":
      return { surfaceId: "learn-move-batch", operationClass: "learn-move", ownerModel: "interaction" };
    case "SAVE_SLOT":
      return { surfaceId: "save-slot", operationClass: "save", ownerModel: "local" };
    case "PARTY":
      if (phase === "SwitchPhase" || phase === "CoopGuestFaintSwitchPhase") {
        return { surfaceId: "party:replacement", operationClass: "replacement", ownerModel: "interaction" };
      }
      if (phase === "AttemptCapturePhase") {
        return { surfaceId: "party:catch-full", operationClass: "catch", ownerModel: "interaction" };
      }
      if (phase === "SelectModifierPhase") {
        return { surfaceId: "party:reward-target", operationClass: "reward", ownerModel: "interaction" };
      }
      return { surfaceId: "party", operationClass: "party", ownerModel: "local" };
    case "SUMMARY":
      if (phase === "LearnMovePhase") {
        return { surfaceId: "learn-move:summary", operationClass: "learn-move", ownerModel: "interaction" };
      }
      if (phase === "AttemptCapturePhase") {
        return { surfaceId: "catch:summary", operationClass: "catch", ownerModel: "interaction" };
      }
      return { surfaceId: "summary", operationClass: "info", ownerModel: "local" };
    case "OPTION_SELECT":
    case "MENU_OPTION_SELECT":
      if (phase === "ErCrossroadsPhase") {
        return { surfaceId: "crossroads", operationClass: "navigation", ownerModel: "interaction" };
      }
      if (phase === "SelectBiomePhase") {
        return { surfaceId: "biome-select", operationClass: "navigation", ownerModel: "interaction" };
      }
      if (inMe) {
        return { surfaceId: "mystery-encounter:prompt", operationClass: "encounter-prompt", ownerModel: "interaction" };
      }
      return {
        surfaceId: `option-select:${phase}`,
        operationClass: uiMode === "MENU_OPTION_SELECT" ? "save" : "confirm",
        ownerModel: uiMode === "MENU_OPTION_SELECT" ? "local" : "interaction",
      };
    case "CONFIRM":
      if (phase === "EggLapsePhase") {
        return { surfaceId: "egg:lapse", operationClass: "egg", ownerModel: "interaction" };
      }
      if (phase === "AttemptCapturePhase") {
        return { surfaceId: "catch-full:confirm", operationClass: "catch", ownerModel: "interaction" };
      }
      if (phase === "LearnMovePhase") {
        return { surfaceId: "learn-move:confirm", operationClass: "learn-move", ownerModel: "interaction" };
      }
      if (phase === "CheckSwitchPhase") {
        return { surfaceId: "check-switch", operationClass: "confirm", ownerModel: "interaction" };
      }
      if (phase === "SelectModifierPhase") {
        return { surfaceId: "reward:confirm", operationClass: "reward", ownerModel: "interaction" };
      }
      return { surfaceId: `confirm:${phase}`, operationClass: "confirm", ownerModel: "interaction" };
    case "MESSAGE":
      if (phase === "ExpPhase") {
        return { surfaceId: "battle:exp", operationClass: "battle-progress", ownerModel: "local" };
      }
      if (phase === "MessagePhase") {
        return { surfaceId: "battle:message", operationClass: "battle-progress", ownerModel: "local" };
      }
      return inMe
        ? { surfaceId: "mystery-encounter:message", operationClass: "encounter-prompt", ownerModel: "interaction" }
        : { surfaceId: "battle:message", operationClass: "battle-progress", ownerModel: "local" };
    case "EGG_HATCH_SUMMARY":
      return { surfaceId: "egg:hatch-summary", operationClass: "egg", ownerModel: "local" };
    case "EGG_HATCH_SCENE":
      return { surfaceId: "egg:hatch-scene", operationClass: "egg", ownerModel: "local" };
    default:
      return null;
  }
}

interface SelectionReadout {
  readonly selectedOptionId: string | null;
  readonly optionIds: readonly string[] | null;
  readonly optionCount: number | null;
}

function partyOptionSemanticId(partyUiMode: number | undefined, option: number, index: number): string {
  if (
    partyUiMode === PartyUiMode.REMEMBER_MOVE_MODIFIER
    || partyUiMode === PartyUiMode.ER_LEARNERS_SHROOM_MODIFIER
    || partyUiMode === PartyUiMode.ER_TM_CASE_MODIFIER
  ) {
    return `party-option:move-index:${option}`;
  }
  if (
    (partyUiMode === PartyUiMode.MODIFIER_TRANSFER || partyUiMode === PartyUiMode.DISCARD)
    && option >= 0
    && option < PartyOption.SCROLL_UP
  ) {
    return `party-option:item-index:${option}`;
  }
  const enumName = PartyOption[option];
  return typeof enumName === "string"
    ? `party-option:${enumName.toLowerCase().replaceAll("_", "-")}`
    : `party-option:slot:${index}`;
}

function readStarterGridCandidates(handler: unknown) {
  const containers = (
    handler as {
      filteredStarterContainers?: Array<{ cost?: unknown; species?: PokemonSpecies }>;
    }
  ).filteredStarterContainers;
  if (!Array.isArray(containers)) {
    return null;
  }
  return containers
    .map((container, index) => {
      const speciesId = container.species?.speciesId;
      const cost = container.cost;
      return Number.isSafeInteger(speciesId)
        && container.species != null
        && globalScene.gameData.isRootSpeciesUnlocked(container.species)
        && typeof cost === "number"
        && Number.isFinite(cost)
        ? { index, speciesId: speciesId as number, cost }
        : null;
    })
    .filter(candidate => candidate != null)
    .sort((left, right) => left.cost - right.cost || left.index - right.index)
    .slice(0, 32);
}

/**
 * The visible options + selected id, where the handler exposes them publicly. Reward
 * options carry a stable modifier-type id; option-select menus expose their explicit semantic id.
 * Options which have not yet declared one remain driveable by ordinal slot, never by translated text.
 */
function readSelection(handler: { getCursor(): number }, uiMode: string): SelectionReadout {
  let selectedIndex: number | null = null;
  try {
    selectedIndex = handler.getCursor();
  } catch {
    selectedIndex = null;
  }
  if (uiMode === "STARTER_SELECT") {
    const starterHandler = handler as unknown as {
      randomCursorObj?: { visible?: boolean };
      lastTeamCursorObj?: { visible?: boolean };
      startCursorObj?: { visible?: boolean };
      starterIconsCursorObj?: { visible?: boolean };
      starterIconsCursorIndex?: number;
    };
    if (starterHandler.randomCursorObj?.visible === true) {
      return {
        selectedOptionId: "starter-action:random",
        optionIds: null,
        optionCount: null,
      };
    }
    if (starterHandler.lastTeamCursorObj?.visible === true) {
      return {
        selectedOptionId: "starter-action:last-team",
        optionIds: null,
        optionCount: null,
      };
    }
    if (starterHandler.startCursorObj?.visible === true) {
      return {
        selectedOptionId: "starter-action:start",
        optionIds: null,
        optionCount: null,
      };
    }
    if (
      starterHandler.starterIconsCursorObj?.visible === true
      && Number.isSafeInteger(starterHandler.starterIconsCursorIndex)
    ) {
      return {
        selectedOptionId: `starter-team:${starterHandler.starterIconsCursorIndex}`,
        optionIds: null,
        optionCount: null,
      };
    }
    return {
      selectedOptionId: selectedIndex == null ? null : `starter-grid:${selectedIndex}`,
      optionIds: null,
      optionCount: null,
    };
  }
  if (uiMode === "SAVE_SLOT") {
    const selection = (handler as SaveSlotSelectUiHandler).getSelectedSlotSemanticSelection?.();
    const selectedOptionId = selection?.loaded ? `${selection.state}-slot:${selection.slotId}` : null;
    return {
      selectedOptionId,
      optionIds: null,
      optionCount: null,
    };
  }
  if (uiMode === "TARGET_SELECT") {
    const targets = (handler as unknown as { targets?: unknown }).targets;
    const optionIds = Array.isArray(targets)
      ? targets
          .filter((target): target is number => Number.isSafeInteger(target))
          .map(target => `battle-target:${target}`)
      : null;
    const selectedOptionId =
      selectedIndex != null && optionIds?.includes(`battle-target:${selectedIndex}`)
        ? `battle-target:${selectedIndex}`
        : null;
    return {
      selectedOptionId,
      optionIds,
      optionCount: optionIds?.length ?? null,
    };
  }
  if (uiMode === "MODIFIER_SELECT") {
    const modOptions = (handler as unknown as { options?: Array<{ modifierTypeOption?: { type?: { id?: string } } }> })
      .options;
    if (Array.isArray(modOptions)) {
      const optionIds = modOptions.map((option, index) => option?.modifierTypeOption?.type?.id ?? `slot:${index}`);
      return {
        selectedOptionId: selectedIndex == null ? null : (optionIds[selectedIndex] ?? `cursor:${selectedIndex}`),
        optionIds,
        optionCount: optionIds.length,
      };
    }
  }
  if (uiMode === "PARTY") {
    const partyHandler = handler as unknown as {
      optionsMode?: boolean;
      optionsCursor?: number;
      options?: number[];
      partyUiMode?: number;
    };
    if (partyHandler.optionsMode === true && Array.isArray(partyHandler.options) && partyHandler.options.length > 0) {
      const optionIds = partyHandler.options.map((option, index) =>
        partyOptionSemanticId(partyHandler.partyUiMode, option, index),
      );
      const optionsCursor = Number.isSafeInteger(partyHandler.optionsCursor)
        ? (partyHandler.optionsCursor as number)
        : null;
      return {
        selectedOptionId: optionsCursor == null ? null : (optionIds[optionsCursor] ?? `cursor:${optionsCursor}`),
        optionIds,
        optionCount: optionIds.length,
      };
    }
    const optionIds = globalScene.getPlayerParty().map((_pokemon, index) => `party-slot:${index}`);
    return {
      selectedOptionId:
        selectedIndex != null && selectedIndex >= 0 && selectedIndex < optionIds.length
          ? optionIds[selectedIndex]
          : selectedIndex == null
            ? null
            : `cursor:${selectedIndex}`,
      optionIds,
      optionCount: optionIds.length,
    };
  }
  const optionHandler = handler as unknown as {
    options?: Array<{ semanticId?: unknown }>;
    config?: { options?: Array<{ semanticId?: unknown }> } | null;
  };
  const listOptions = optionHandler.options ?? optionHandler.config?.options;
  if (Array.isArray(listOptions) && listOptions.length > 0) {
    const optionIds = listOptions.map((option, index) =>
      typeof option?.semanticId === "string" && option.semanticId.length > 0 ? option.semanticId : `slot:${index}`,
    );
    return {
      selectedOptionId: selectedIndex == null ? null : (optionIds[selectedIndex] ?? `cursor:${selectedIndex}`),
      optionIds,
      optionCount: optionIds.length,
    };
  }
  return {
    selectedOptionId: selectedIndex == null ? null : `cursor:${selectedIndex}`,
    optionIds: null,
    optionCount: null,
  };
}

let lastSemanticObservation = "";
let lastSemanticProbe = "";
let lastSemanticProbeAt = 0;
let lastSemanticPhase: object | null = null;
let semanticPhaseInstance = 0;
let lastSemanticObserverError = "";
let lastObservedRenderProfile = "";
let lastObservedMarket = "";
let lastObservedCommander = "";

interface MarketOptionProjection {
  readonly index: number;
  readonly id: string;
  readonly name: string;
  readonly cost: number;
  readonly stock: number;
  readonly targetModel: "direct" | "party";
}

interface MarketHeldModifierProjection {
  readonly typeId: string;
  readonly pokemonId: number;
  readonly quantity: number;
}

/**
 * Emit the biome market's human-visible catalog plus the minimum mechanical projection needed
 * to assert a purchase. This observer is CI-only and strictly read-only: the journey still moves
 * the grid, opens the party picker, confirms APPLY, and leaves through public keyboard input.
 */
function observeBiomeMarket(): void {
  try {
    const runtime = getCoopRuntime();
    const membership = runtime?.membership.snapshot();
    const battle = globalScene?.currentBattle;
    const currentPhase = globalScene?.phaseManager?.getCurrentPhase();
    const ui = globalScene?.ui;
    if (runtime == null || membership?.state !== "active" || battle == null || currentPhase == null || ui == null) {
      return;
    }
    const phase = currentPhase as unknown as {
      shopOptions?: Array<{ type?: { id?: string; name?: string }; cost?: number }>;
      qtys?: number[];
      coopBiomeStart?: number;
      coopBiomeOwner?: boolean;
    };
    if (
      !Array.isArray(phase.shopOptions)
      || phase.shopOptions.length === 0
      || !Number.isSafeInteger(phase.coopBiomeStart)
      || (phase.coopBiomeStart ?? -1) < 0
    ) {
      return;
    }
    const handler = ui.getHandler() as unknown as {
      active?: boolean;
      getCursor?: () => number;
      getStock?: (index: number) => number;
    };
    const uiMode = UiMode[ui.getMode()];
    const marketOpen = uiMode === "BIOME_SHOP" && handler.active === true;
    const localSeat = runtime.controller.seat;
    const localOwner = phase.coopBiomeOwner === true;
    const ownerSeat = localOwner ? localSeat : localSeat === 0 ? 1 : 0;
    const options: MarketOptionProjection[] = phase.shopOptions.map((option, index) => {
      const stock = Number.isSafeInteger(phase.qtys?.[index])
        ? Math.max(0, phase.qtys?.[index] ?? 0)
        : marketOpen && typeof handler.getStock === "function"
          ? Math.max(0, handler.getStock(index))
          : 0;
      return {
        index,
        id: option.type?.id ?? `slot:${index}`,
        name: option.type?.name ?? "",
        cost: Number.isFinite(option.cost) ? Math.max(0, Math.trunc(option.cost ?? 0)) : 0,
        stock,
        targetModel: option.type instanceof PokemonModifierType ? "party" : "direct",
      };
    });
    let selectedIndex: number | null = null;
    if (marketOpen && typeof handler.getCursor === "function") {
      const cursor = handler.getCursor();
      selectedIndex = Number.isSafeInteger(cursor) ? cursor : null;
    }
    const heldModifiers: MarketHeldModifierProjection[] = globalScene.modifiers
      .flatMap(modifier => {
        const projected = modifier as unknown as {
          type?: { id?: string };
          pokemonId?: number;
          stackCount?: number;
          getStackCount?: () => number;
        };
        if (typeof projected.type?.id !== "string" || !Number.isSafeInteger(projected.pokemonId)) {
          return [];
        }
        const stack = typeof projected.getStackCount === "function" ? projected.getStackCount() : projected.stackCount;
        return [
          {
            typeId: projected.type.id,
            pokemonId: projected.pokemonId as number,
            quantity: Number.isSafeInteger(stack) ? Math.max(0, stack ?? 0) : 0,
          },
        ];
      })
      .toSorted(
        (left, right) =>
          left.typeId.localeCompare(right.typeId) || left.pokemonId - right.pokemonId || left.quantity - right.quantity,
      );
    const party = globalScene.getPlayerParty().map((pokemon, slot) => ({
      slot,
      pokemonId: pokemon.id,
      speciesId: pokemon.species.speciesId,
    }));
    const observation = {
      version: 1,
      address: { epoch: runtime.controller.sessionEpoch, wave: battle.waveIndex, turn: battle.turn },
      pinnedInteraction: phase.coopBiomeStart as number,
      localRole: runtime.controller.role,
      localSeat,
      ownerSeat,
      localOwner,
      marketOpen,
      uiMode,
      phaseClass: currentPhase.constructor.name,
      selectedIndex,
      selectedItemId: selectedIndex == null ? null : (options[selectedIndex]?.id ?? null),
      money: globalScene.money,
      stockModel: localOwner ? "authoritative-visible" : "replica-apply-ledger",
      options,
      party,
      heldModifiers,
    } as const;
    const canonical = JSON.stringify(observation);
    if (canonical === lastObservedMarket) {
      return;
    }
    lastObservedMarket = canonical;
    console.info(`${MARKET_PREFIX}${canonical}`);
  } catch {
    // The phase may be re-opening after a party picker or tearing down. Gameplay errors remain fatal.
  }
}

/**
 * Emit a strict, read-only Commander boundary marker while a real CommandPhase is active. A hidden
 * Commander owner's automatic phase can start and finish between two 100ms observer samples, so that
 * owner may also attest the same boundary from the immediately following turn-start/replay phase, but
 * only while its exact generated inert skip remains in the addressed turn command ledger.
 *
 * The public driver uses this only as an assertion oracle: it still supplies the Dondozo's move through
 * the canvas and proves the hidden Tatsugiri's generated skip via rendezvous logs.
 */
function observeCommanderBoundary(): void {
  try {
    const runtime = getCoopRuntime();
    const membership = runtime?.membership.snapshot();
    const battle = globalScene?.currentBattle;
    const phase = globalScene?.phaseManager?.getCurrentPhase()?.phaseName;
    if (runtime == null || membership?.state !== "active" || battle == null || phase == null) {
      return;
    }
    const commanded = globalScene.getPlayerParty().find(pokemon => pokemon.getTag(BattlerTagType.COMMANDED) != null);
    const commandedTag = commanded?.getTag(BattlerTagType.COMMANDED);
    const commander = commandedTag?.getSourcePokemon();
    const commanderOwnerRole = (commander as (Pokemon & { readonly coopOwner?: "host" | "guest" }) | undefined)
      ?.coopOwner;
    if (commanded == null || commander == null || (commanderOwnerRole !== "host" && commanderOwnerRole !== "guest")) {
      return;
    }
    const commanderCommand = battle.turnCommands[commander.getBattlerIndex()];
    const ownerAutomaticPhaseClosed =
      runtime.controller.role === commanderOwnerRole
      && (phase === "TurnStartPhase" || phase === "CoopReplayTurnPhase")
      && commanderCommand?.command === Command.FIGHT
      && commanderCommand.move?.move === MoveId.NONE
      && commanderCommand.skip === true;
    if (phase !== "CommandPhase" && !ownerAutomaticPhaseClosed) {
      return;
    }
    const { digest: stateDigest } = computeMechanicalDigest();
    const observation = {
      version: 1,
      localRole: runtime.controller.role,
      localSeat: runtime.controller.seat,
      commanderOwnerRole,
      epoch: runtime.controller.sessionEpoch,
      membershipRevision: membership.revision,
      connectionGeneration: membership.connectionGeneration,
      observationPhase: phase,
      wave: battle.waveIndex,
      turn: battle.turn,
      point: `cmd:${battle.waveIndex}:${battle.turn}`,
      stateDigest,
      commanderPokemonId: commander.id,
      commanderSpeciesId: commander.species.speciesId,
      commanderBattlerIndex: commander.getBattlerIndex(),
      commandedPokemonId: commanded.id,
      commandedSpeciesId: commanded.species.speciesId,
      commandedBattlerIndex: commanded.getBattlerIndex(),
    } as const;
    const canonical = JSON.stringify(observation);
    if (canonical === lastObservedCommander) {
      return;
    }
    lastObservedCommander = canonical;
    console.info(`${COMMANDER_PREFIX}${canonical}`);
  } catch {
    // The Commander animation or CommandPhase may be entering/leaving between observer samples.
  }
}

function semanticBattleAddress(battle: { waveIndex: number; turn: number } | null | undefined) {
  return { wave: battle?.waveIndex ?? 0, turn: battle?.turn ?? 0 } as const;
}

/**
 * Attest the real settings values while the visible General or Display menu is open. The campaign
 * reaches these handlers only through public keys; this probe is read-only and proves Game Speed
 * in General while keeping animations-skipped depth visibly distinct from animations-on coverage.
 */
function observeRenderProfile(): void {
  try {
    const handler = globalScene?.ui?.getHandler();
    const mode = globalScene?.ui?.getMode();
    const handlerName =
      mode === UiMode.SETTINGS
        ? "SettingsUiHandler"
        : mode === UiMode.SETTINGS_DISPLAY
          ? "SettingsDisplayUiHandler"
          : null;
    if (!handler?.active || handlerName == null) {
      // A later Settings visit must emit a fresh attestation even when the saved value
      // did not change (the speed setup opens Settings before the render-profile pass).
      lastObservedRenderProfile = "";
      return;
    }
    const observation = {
      version: 1,
      moveAnimations: globalScene.moveAnimations,
      gameSpeed: globalScene.gameSpeed,
      handler: handlerName,
    } as const;
    const canonical = JSON.stringify(observation);
    if (canonical === lastObservedRenderProfile) {
      return;
    }
    lastObservedRenderProfile = canonical;
    console.info(`${RENDER_PROFILE_PREFIX}${canonical}`);
  } catch {
    // Settings are changing mode or the page is tearing down.
  }
}

function observeSemanticSurface(): void {
  try {
    // Runtime is OPTIONAL: the mirror describes any interactive surface, co-op OR solo, so the
    // state-aware navigation primitive is provable against a single-context classic run.
    const runtime = getCoopRuntime();
    const battle = globalScene?.currentBattle;
    const currentPhase = globalScene?.phaseManager?.getCurrentPhase();
    const phase = currentPhase?.phaseName;
    const ui = globalScene?.ui;
    if (phase == null || ui == null) {
      return;
    }
    const handler = ui.getHandler();
    const uiMode = UiMode[ui.getMode()];
    // Two adjacent ExpPhase objects can expose the same surface/address and can both become
    // ready between 100 ms observer samples at 10x speed. Object identity is read-only and
    // gives every observed phase instance a monotonic discriminator, preventing the second
    // actionable prompt from being deduplicated as an identical observation.
    if (currentPhase !== lastSemanticPhase) {
      lastSemanticPhase = currentPhase;
      semanticPhaseInstance += 1;
    }
    // A paired controller can exist briefly on TitlePhase before the new session epoch is bound. A title
    // narration is not battle progress; suppress it instead of emitting an impossible co-op epoch-0 surface.
    if (phase === "TitlePhase" && uiMode === "MESSAGE") {
      return;
    }
    // When this seat has no locally actionable battler, the real continuation is the exact replay waiter,
    // not a fabricated command menu. The phase exposes readiness only after awaitTurnOrLiveEvent is installed.
    const rendererWaitReady = (
      currentPhase as unknown as { isAwaitingAuthority?: () => boolean }
    ).isAwaitingAuthority?.();
    if (rendererWaitReady === true && runtime != null && battle != null) {
      const membership = runtime.membership.snapshot();
      if (membership.state !== "active" || runtime.controller.sessionEpoch <= 0) {
        return;
      }
      const { digest: stateDigest } = computeMechanicalDigest();
      const observation = {
        version: 2,
        surfaceId: "command:watcher",
        operationClass: "command",
        ownerModel: "local",
        coop: true,
        address: {
          epoch: runtime.controller.sessionEpoch,
          wave: battle.waveIndex,
          turn: battle.turn,
        },
        membershipRevision: membership.revision,
        connectionGeneration: membership.connectionGeneration,
        localSeat: runtime.controller.seat,
        localRole: runtime.controller.role,
        ownerSeat: null,
        seatsWithInput: [],
        selectedOptionId: null,
        optionIds: null,
        optionCount: null,
        teamSpeciesIds: null,
        ready: { handlerActive: false, awaitingActionInput: false, inputBlocked: true },
        phase,
        phaseInstance: semanticPhaseInstance,
        surfaceGeneration: null,
        mysteryEncounterType: battle.mysteryEncounter?.encounterType ?? null,
        stateDigest,
        uiMode,
      } as const;
      const canonical = JSON.stringify(observation);
      if (canonical !== lastSemanticObservation) {
        lastSemanticObservation = canonical;
        console.info(`${SURFACE2_PREFIX}${canonical}`);
      }
      return;
    }
    if (!handler?.active) {
      return;
    }
    const semantic = classifySemanticSurface(phase, uiMode);
    if (semantic == null) {
      const membership = runtime?.membership.snapshot();
      if (runtime == null || membership?.state !== "active") {
        return;
      }
      const { wave, turn } = semanticBattleAddress(battle);
      const stateDigest = battle == null ? null : computeMechanicalDigest().digest;
      const observation = {
        version: 2,
        surfaceId: "unclassified",
        operationClass: "unclassified",
        ownerModel: "local",
        coop: true,
        address: { epoch: runtime.controller.sessionEpoch, wave, turn },
        membershipRevision: membership.revision,
        connectionGeneration: membership.connectionGeneration,
        localSeat: runtime.controller.seat,
        localRole: runtime.controller.role,
        ownerSeat: null,
        seatsWithInput: [runtime.controller.seat],
        selectedOptionId: null,
        optionIds: null,
        optionCount: null,
        teamSpeciesIds: null,
        ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: null },
        phase,
        phaseInstance: semanticPhaseInstance,
        surfaceGeneration: null,
        mysteryEncounterType: battle?.mysteryEncounter?.encounterType ?? null,
        stateDigest,
        uiMode,
      } as const;
      const canonical = JSON.stringify(observation);
      if (canonical !== lastSemanticObservation) {
        lastSemanticObservation = canonical;
        console.info(`${SURFACE2_PREFIX}${canonical}`);
      }
      return;
    }

    let coop = false;
    let localSeat: number | null = null;
    let localRole: string | null = null;
    let ownerSeat: number | null = null;
    let epoch = 0;
    let membershipRevision: number | null = null;
    let connectionGeneration: number | null = null;
    let seatsWithInput: number[] = [0];
    if (runtime != null) {
      const membership = runtime.membership.snapshot();
      if (membership.state !== "active") {
        return;
      }
      coop = true;
      localSeat = runtime.controller.seat;
      localRole = runtime.controller.role;
      epoch = runtime.controller.sessionEpoch;
      membershipRevision = membership.revision;
      connectionGeneration = membership.connectionGeneration;
      const partnerSeat = localSeat === 0 ? 1 : 0;
      let isLocalOwner: boolean | null = null;
      try {
        isLocalOwner = runtime.controller.isLocalOwnerAtCounter(runtime.controller.interactionCounter());
      } catch {
        isLocalOwner = null;
      }
      // A faint replacement is owned by the battler's stable seat, not by the alternating biome
      // interaction counter. The only browser that opens the real PARTY picker is that local owner;
      // stamp it explicitly so host SwitchPhase and replica CoopGuestFaintSwitchPhase share one
      // accurate contract (and so future N-player seats do not inherit a two-seat parity guess).
      const localReplacementOwner = semantic.operationClass === "replacement" && uiMode === "PARTY";
      ownerSeat = localReplacementOwner
        ? localSeat
        : semantic.ownerModel === "interaction" && isLocalOwner != null
          ? isLocalOwner
            ? localSeat
            : partnerSeat
          : null;
      // This client's view of who may input: a local surface = this seat drives its own; an
      // interaction surface = only the owner. A driver unions both clients' markers.
      seatsWithInput = semantic.ownerModel === "local" ? [localSeat] : ownerSeat == null ? [] : [ownerSeat];
    }

    const selection = readSelection(handler, uiMode);
    const starterGridCandidates = uiMode === "STARTER_SELECT" ? readStarterGridCandidates(handler) : null;
    const partySlots =
      uiMode === "PARTY"
        ? globalScene.getPlayerParty().map((pokemon, slot) => {
            const active = pokemon.isActive(true);
            const fainted = pokemon.isFainted();
            const allowedInBattle = pokemon.isAllowedInBattle();
            const reserve = slot >= (battle?.getBattlerCount() ?? 1);
            return {
              slot,
              speciesId: pokemon.species.speciesId,
              active,
              fainted,
              allowedInBattle,
              replacementEligible: reserve && !active && !fainted && allowedInBattle,
            };
          })
        : null;
    const teamSpeciesIds =
      uiMode === "STARTER_SELECT"
        ? ((handler as unknown as { starterSpecies?: Array<{ speciesId: number }> }).starterSpecies?.map(
            species => species.speciesId,
          ) ?? null)
        : (partySlots?.map(slot => slot.speciesId) ?? null);
    // Title/setup menus exist before a Battle object. Address 0:0 is an explicit non-battle
    // sentinel that lets the public driver wait for their real option surfaces instead of
    // racing repeated Action keys; gameplay surfaces still carry their actual wave/turn.
    const { wave, turn } = semanticBattleAddress(battle);
    const mysteryEncounterType = battle?.mysteryEncounter?.encounterType ?? null;
    const promptReady = (handler as unknown as { isAwaitingPromptAction?: () => boolean }).isAwaitingPromptAction;
    const readPromptGeneration = (handler as unknown as { getPromptGeneration?: () => number }).getPromptGeneration;
    const awaitingRaw = (handler as unknown as { awaitingActionInput?: unknown }).awaitingActionInput;
    const inputBlockedRaw = (handler as unknown as { blockInput?: unknown }).blockInput;
    const readInputBlocked = (handler as unknown as { isInputBlocked?: () => boolean }).isInputBlocked;
    const readSurfaceGeneration = (handler as unknown as { getSurfaceGeneration?: () => number }).getSurfaceGeneration;
    // MessageUiHandler keeps its raw `awaitingActionInput` bit set after an action has consumed
    // `onActionInput`. Its public readiness method proves the complete actionable contract and
    // therefore prevents a read-only browser observer from publishing a stale ready=true between
    // repeated ExpPhase prompts. Non-message handlers keep the established raw-field projection.
    const awaitingActionInput =
      uiMode === "PARTY"
        ? null
        : typeof promptReady === "function"
          ? promptReady.call(handler)
          : typeof awaitingRaw === "boolean"
            ? awaitingRaw
            : null;
    const promptGeneration =
      uiMode === "MESSAGE" && typeof readPromptGeneration === "function" ? readPromptGeneration.call(handler) : null;
    const inputBlocked =
      typeof readInputBlocked === "function"
        ? readInputBlocked.call(handler)
        : typeof inputBlockedRaw === "boolean"
          ? inputBlockedRaw
          : null;
    const surfaceGeneration = typeof readSurfaceGeneration === "function" ? readSurfaceGeneration.call(handler) : null;
    const stateDigest = coop && battle != null ? computeMechanicalDigest().digest : null;
    const semanticSurfaceInstance =
      Number.isSafeInteger(promptGeneration) && (promptGeneration ?? 0) > 0
        ? (promptGeneration as number)
        : semanticPhaseInstance;

    const probeKey = [
      semantic.surfaceId,
      uiMode,
      semanticSurfaceInstance,
      `${epoch}:${wave}:${turn}`,
      selection.selectedOptionId ?? "",
      selection.optionIds?.join(",") ?? "",
      teamSpeciesIds?.join(",") ?? "",
      starterGridCandidates == null ? "" : JSON.stringify(starterGridCandidates),
      partySlots == null ? "" : JSON.stringify(partySlots),
      ownerSeat ?? "?",
      awaitingActionInput,
      inputBlocked,
      surfaceGeneration,
      mysteryEncounterType,
      stateDigest,
    ].join("|");
    const now = Date.now();
    if (probeKey === lastSemanticProbe && now - lastSemanticProbeAt < 300) {
      return;
    }
    lastSemanticProbe = probeKey;
    lastSemanticProbeAt = now;

    const observation = {
      version: 2,
      surfaceId: semantic.surfaceId,
      operationClass: semantic.operationClass,
      ownerModel: semantic.ownerModel,
      coop,
      address: { epoch, wave, turn },
      membershipRevision,
      connectionGeneration,
      localSeat,
      localRole,
      ownerSeat,
      seatsWithInput,
      selectedOptionId: selection.selectedOptionId,
      optionIds: selection.optionIds,
      optionCount: selection.optionCount,
      teamSpeciesIds,
      starterGridCandidates,
      partySlots,
      ready: { handlerActive: true, awaitingActionInput, inputBlocked },
      phase,
      phaseInstance: semanticSurfaceInstance,
      surfaceGeneration,
      // Stable registry identity, not localized presentation text. This lets two real browsers
      // prove that an apparently matching Mystery surface is actually the same encounter and
      // lets the ten-wave gauntlet prove non-repeating event breadth.
      mysteryEncounterType,
      // Every co-op UI-to-relay surface carries the same broad mechanical fingerprint used at
      // battle continuation boundaries. A Mystery/shop/prompt desync can no longer heal before
      // the next command and disappear from the two-browser evidence.
      stateDigest,
      uiMode,
    };
    const canonical = JSON.stringify(observation);
    if (canonical === lastSemanticObservation) {
      return;
    }
    lastSemanticObservation = canonical;
    console.info(`${SURFACE2_PREFIX}${canonical}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message !== lastSemanticObserverError) {
      lastSemanticObserverError = message;
      // Observer failures invalidate the gold oracle. A console error is captured as fatal by EvidenceSink.
      console.error(`[coop-browser:semantic-observer-error] ${message}`);
    }
  }
}

setInterval(() => {
  observeBoundSession();
  observeContinuationSurface();
  observeSemanticSurface();
  observeRenderProfile();
  observeBiomeMarket();
  observeCommanderBoundary();
}, 100);

// =============================================================================
// Optimization brief R1c: INPUT ECHO. A tiny read-only high-frequency probe of
// (uiMode, handler cursor, phase) so the harness can pace public key input on
// the game's OWN acknowledgment - "selected option changed / surface changed /
// phase opened" - instead of fixed per-key sleeps. Two field reads per tick;
// emits ONLY on change, so an idle screen logs nothing.
// =============================================================================
let lastInputEchoKey = "";
let inputEchoSeq = 0;

// Input-LAYER diagnostics (read-only). The Game Speed attestation failure (run 29548390234)
// showed 12 dispatched keys with ZERO observed game reaction and could not tell WHICH layer
// dropped them: CDP -> DOM, DOM -> Phaser (paused/stalled loop), or Phaser -> game handler.
// A capture-phase window listener counts raw DOM keydowns (nothing can stop capture on
// window), and the Phaser loop frame counter proves whether the game loop is stepping.
let domKeydownCount = 0;
let lastDomKey = "";
if (typeof window !== "undefined") {
  window.addEventListener(
    "keydown",
    event => {
      domKeydownCount += 1;
      lastDomKey = event.key;
    },
    { capture: true, passive: true },
  );
}

function inputLayerSnapshot() {
  return {
    domKeys: domKeydownCount,
    lastKey: lastDomKey,
    frame: globalScene?.game?.loop?.frame ?? -1,
    vis: typeof document === "undefined" ? "?" : document.visibilityState,
    foc: typeof document !== "undefined" && document.hasFocus(),
  } as const;
}

setInterval(() => {
  try {
    const ui = globalScene?.ui;
    if (ui == null) {
      return;
    }
    const handler = ui.getHandler() as unknown as { cursor?: number; getCursor?: () => number; active?: boolean };
    const cursor = handler?.getCursor?.() ?? handler?.cursor ?? -1;
    const uiMode = UiMode[ui.getMode()];
    const phase = globalScene?.phaseManager?.getCurrentPhase()?.phaseName ?? "";
    const echoKey = `${uiMode}:${cursor}:${phase}:${handler?.active === true}`;
    if (echoKey === lastInputEchoKey) {
      return;
    }
    lastInputEchoKey = echoKey;
    inputEchoSeq += 1;
    console.info(
      `[coop-browser:input-echo] ${JSON.stringify({
        seq: inputEchoSeq,
        uiMode,
        cursor,
        phase,
        active: handler?.active === true,
        ...inputLayerSnapshot(),
      })}`,
    );
  } catch {
    /* the echo is best-effort pacing telemetry; never fail the observer */
  }
}, 25);

// Input-health heartbeat: at most one line per second, and ONLY while raw DOM keydowns are
// arriving. During a healthy walk every key also produces an input-echo; during a dead-key
// window this line alone classifies the failure: domKeys advancing + frame frozen = Phaser
// loop stalled (RAF/visibility); domKeys advancing + frame advancing = game-side input drop;
// domKeys NOT advancing while the harness logs key events = CDP/dispatch-layer loss.
let lastHealthDomKeys = 0;
let lastHealthFrame = -1;
let inputHealthSeq = 0;
setInterval(() => {
  try {
    const snapshot = inputLayerSnapshot();
    const frameAdvancing = snapshot.frame !== lastHealthFrame;
    lastHealthFrame = snapshot.frame;
    if (snapshot.domKeys === lastHealthDomKeys) {
      return;
    }
    lastHealthDomKeys = snapshot.domKeys;
    inputHealthSeq += 1;
    console.info(`[coop-browser:input-health] ${JSON.stringify({ seq: inputHealthSeq, ...snapshot, frameAdvancing })}`);
  } catch {
    /* diagnostics only - never fail the observer */
  }
}, 1000);

// Strictly read-only observer bridge. `ready` is a non-mutating probe; the former
// `connect: connectCoopWithCode` seam was removed so no code path can drive pairing from
// the page - the gameplay journeys pair exclusively through visible lobby keyboard input.
Object.defineProperty(globalThis, "__coopBrowserBridge", {
  configurable: false,
  enumerable: false,
  writable: false,
  value: Object.freeze({
    ready: () => globalScene?.gameData != null,
    surfaceObserverVersion: 1,
  }),
});
