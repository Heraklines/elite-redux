/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Pokemon } from "../src/field/pokemon";

// CI-only production-bundle entry. It boots the normal application first, then exposes the narrow transport
// seam used by the browser checkpoint. This file is included only by vite.coop-browser.config.mjs; no staged
// or production deployment imports it.
await import("../src/main");

const [{ globalScene }, { captureCoopSaveDataDigest }, { canonicalize, fnv1a64 }, { getCoopRuntime }, { UiMode }] =
  await Promise.all([
    import("../src/global-scene"),
    import("../src/data/elite-redux/coop/coop-battle-engine"),
    import("../src/data/elite-redux/coop/coop-battle-checksum"),
    import("../src/data/elite-redux/coop/coop-runtime"),
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
const SURFACE2_PREFIX = "[coop-browser:surface2] ";
const BINDING_PREFIX = "[coop-browser:binding] ";
const DIGEST_PARTS_PREFIX = "[coop-browser:digest-parts] ";
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

function computeMechanicalDigest(): {
  digest: string;
  parts: Record<string, string>;
  innates: { player: number[][]; enemy: number[][] };
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
  return { digest, parts, innates };
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
    const { digest: stateDigest, parts: digestParts, innates } = computeMechanicalDigest();
    const observationKey = `${addressKey}:${stateDigest}`;
    if (observationKey === lastObservedSurface) {
      return;
    }
    lastObservedSurface = observationKey;
    // Read-only diagnostic: the per-component digest breakdown (so a two-browser digest divergence
    // self-identifies the exact field) plus the raw per-mon innate ids (so the driver can assert the
    // ace-difficulty enemy's innates are LIVE and both browsers agree - the innate-activation invariant).
    console.info(
      `${DIGEST_PARTS_PREFIX}${JSON.stringify({ address: `${runtime.controller.sessionEpoch}:${battle.waveIndex}:${battle.turn}`, surface, digest: stateDigest, parts: digestParts, innates })}`,
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
    phase.startsWith("MysteryEncounter") || phase === "PostMysteryEncounterPhase" || phase === "CoopReplayMePhase";
  switch (uiMode) {
    case "COMMAND":
    case "FIGHT":
    case "BALL":
    case "TARGET_SELECT":
      return phase === "CommandPhase"
        ? { surfaceId: `command:${uiMode.toLowerCase()}`, operationClass: "command", ownerModel: "local" }
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
      if (phase === "SwitchPhase") {
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
      if (phase === "ErCrossroadsPhase") {
        return { surfaceId: "crossroads", operationClass: "navigation", ownerModel: "interaction" };
      }
      if (phase === "SelectBiomePhase") {
        return { surfaceId: "biome-select", operationClass: "navigation", ownerModel: "interaction" };
      }
      if (inMe) {
        return { surfaceId: "mystery-encounter:prompt", operationClass: "encounter-prompt", ownerModel: "interaction" };
      }
      return { surfaceId: `option-select:${phase}`, operationClass: "confirm", ownerModel: "interaction" };
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
      return inMe
        ? { surfaceId: "mystery-encounter:message", operationClass: "encounter-prompt", ownerModel: "interaction" }
        : null;
    case "EGG_HATCH_SUMMARY":
      return { surfaceId: "egg:hatch-summary", operationClass: "egg", ownerModel: "local" };
    case "EGG_HATCH_SCENE":
      return { surfaceId: "egg:hatch-scene", operationClass: "egg", ownerModel: "local" };
    default:
      return null;
  }
}

function normalizeOptionId(label: string): string {
  return label
    .replace(/\[[^\]]*\]/gu, "")
    .replace(/[^a-zA-Z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLowerCase()
    .slice(0, 40);
}

interface SelectionReadout {
  readonly selectedOptionId: string | null;
  readonly optionIds: readonly string[] | null;
  readonly optionCount: number | null;
}

/**
 * The visible options + selected id, where the handler exposes them publicly. Reward
 * options carry a stable modifier-type id; option-select menus expose only visible labels
 * (no native stable id - normalized label is the best-observable id, see the gap note).
 */
function readSelection(handler: { getCursor(): number }, uiMode: string): SelectionReadout {
  let selectedIndex: number | null = null;
  try {
    selectedIndex = handler.getCursor();
  } catch {
    selectedIndex = null;
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
  const listOptions = (handler as unknown as { options?: Array<{ label?: unknown }> }).options;
  if (Array.isArray(listOptions) && listOptions.length > 0 && typeof listOptions[0]?.label === "string") {
    const optionIds = listOptions.map((option, index) =>
      typeof option?.label === "string" ? normalizeOptionId(option.label) || `slot:${index}` : `slot:${index}`,
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

function observeSemanticSurface(): void {
  try {
    // Runtime is OPTIONAL: the mirror describes any interactive surface, co-op OR solo, so the
    // state-aware navigation primitive is provable against a single-context classic run.
    const runtime = getCoopRuntime();
    const battle = globalScene?.currentBattle;
    const phase = globalScene?.phaseManager?.getCurrentPhase()?.phaseName;
    const ui = globalScene?.ui;
    if (battle == null || phase == null || ui == null) {
      return;
    }
    const handler = ui.getHandler();
    if (!handler?.active) {
      return;
    }
    const uiMode = UiMode[ui.getMode()];
    const semantic = classifySemanticSurface(phase, uiMode);
    if (semantic == null) {
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
      ownerSeat =
        semantic.ownerModel === "interaction" && isLocalOwner != null ? (isLocalOwner ? localSeat : partnerSeat) : null;
      // This client's view of who may input: a local surface = this seat drives its own; an
      // interaction surface = only the owner. A driver unions both clients' markers.
      seatsWithInput = semantic.ownerModel === "local" ? [localSeat] : ownerSeat == null ? [] : [ownerSeat];
    }

    const selection = readSelection(handler, uiMode);
    const awaitingRaw = (handler as unknown as { awaitingActionInput?: unknown }).awaitingActionInput;
    const awaitingActionInput = typeof awaitingRaw === "boolean" ? awaitingRaw : null;

    const probeKey = [
      semantic.surfaceId,
      uiMode,
      `${epoch}:${battle.waveIndex}:${battle.turn}`,
      selection.selectedOptionId ?? "",
      ownerSeat ?? "?",
      awaitingActionInput,
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
      address: { epoch, wave: battle.waveIndex, turn: battle.turn },
      membershipRevision,
      connectionGeneration,
      localSeat,
      localRole,
      ownerSeat,
      seatsWithInput,
      selectedOptionId: selection.selectedOptionId,
      optionIds: selection.optionIds,
      optionCount: selection.optionCount,
      ready: { handlerActive: true, awaitingActionInput },
      phase,
      uiMode,
    };
    const canonical = JSON.stringify(observation);
    if (canonical === lastSemanticObservation) {
      return;
    }
    lastSemanticObservation = canonical;
    console.info(`${SURFACE2_PREFIX}${canonical}`);
  } catch {
    // Scene init/teardown race; gameplay throws are still surfaced by the v1 observer-error path.
  }
}

setInterval(() => {
  observeBoundSession();
  observeContinuationSurface();
  observeSemanticSurface();
}, 100);

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
