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
  {
    coopHostEngineDialogueMessageAdvanceAllowed,
    coopHostMeNarrationAwaitingGuestAck,
    coopMePostBattleContinuationActive,
    getCoopNetcodeMode,
    getCoopRuntime,
    isCoopV2InteractionHumanInputFrozen,
  },
  { isCoopLocalPresentationInputSurface },
  { coopLocalOverlayInputAllowed },
  { coopMeBespokeHostDrives, coopMeHandoffBattleStarted, coopMeInProgress, coopMeInteractionStartValue },
  { setCoopPresentationObserver },
  { setCoopPlayerTrainerTransitionObserver },
  { setCoopWaveProgressionPresentationObserver },
  { setCoopPresentationHardWallMsForTest },
  { BattlerTagType },
  { BattleType },
  { Command },
  { MysteryEncounterOptionMode },
  { MoveCategory },
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
  import("../src/data/elite-redux/coop/coop-local-presentation-input"),
  import("../src/data/elite-redux/coop/coop-ui-registry"),
  import("../src/data/elite-redux/coop/coop-me-pin-state"),
  import("../src/data/elite-redux/coop/coop-turn-recorder"),
  import("../src/data/elite-redux/coop/coop-trainer-transition-observer"),
  import("../src/data/elite-redux/coop/coop-wave-progression-observer"),
  import("../src/phases/coop-presentation-watchdog"),
  import("../src/enums/battler-tag-type"),
  import("../src/enums/battle-type"),
  import("../src/enums/command"),
  import("../src/enums/mystery-encounter-option-mode"),
  import("../src/enums/move-category"),
  import("../src/enums/move-id"),
  import("../src/modifier/modifier-type"),
  import("../src/ui/handlers/party-ui-handler"),
  import("../src/enums/status-effect"),
  import("../src/enums/ui-mode"),
]);
const { SummaryUiMode } = await import("../src/ui/handlers/summary-ui-handler");

// The exact browser uses the same callbacks and 5s no-progress fence as production, but hosted SwiftShader
// advances one asset frame per ~333ms instead of a real player's ~16ms. A valid long move such as Explosion
// therefore crosses production's 120s advancing-renderer ceiling even though both browsers are still drawing.
// This entry is compiled only by vite.coop-browser.config.mjs and is never imported by staging/production.
// Keep the measured 18s/event x 32-event ceiling aligned with the animations-on campaign's immutable budget;
// this grants patience only, and still cannot manufacture either frame progress or the real Phaser callback.
const CI_COOP_PRESENTATION_HARD_WALL_MS = 18_000 * 32;
setCoopPresentationHardWallMsForTest(CI_COOP_PRESENTATION_HARD_WALL_MS);

type BrowserContinuationSurface = "command" | "replacement" | "reward" | "starter";

interface CoopBrowserSurfaceObservationV1 {
  readonly version: 1;
  readonly surface: BrowserContinuationSurface;
  readonly role: "host" | "guest";
  readonly seat: number;
  readonly epoch: number;
  readonly membershipRevision: number;
  readonly connectionGeneration: number;
  /** Canonical per-seat generations, ordered by immutable seat id. */
  readonly connectionGenerations: readonly number[];
  readonly wave: number;
  readonly turn: number;
  readonly phase: string;
  readonly uiMode: string;
  readonly uiActive: true;
  readonly stateDigest: string;
  readonly battleType: string;
  readonly trainerBoss: boolean;
  readonly bossEnemyCount: number;
  readonly maxBossSegments: number;
}

const SURFACE_PREFIX = "[coop-browser:surface] ";
const SURFACE2_PREFIX = "[coop-browser:surface2] ";
const BINDING_PREFIX = "[coop-browser:binding] ";
const DIGEST_PARTS_PREFIX = "[coop-browser:digest-parts] ";
const PRESENTATION_PREFIX = "[coop-browser:presentation] ";
const PRESENTATION_EVENT_PREFIX = "[coop-browser:presentation-event] ";
const TRAINER_POSTCONDITION_PREFIX = "[coop-browser:trainer-postcondition] ";
const TRAINER_TRANSITION_PREFIX = "[coop-browser:trainer-transition] ";
const PROGRESSION_EVENT_PREFIX = "[coop-browser:progression-event] ";

/** Pixel-adjacent trainer state carried on every semantic UI observation in the sealed CI bundle. */
function coopBrowserPresentationSnapshot() {
  const playerTrainer = globalScene.trainer;
  const enemyTrainer = globalScene.currentBattle?.trainer;
  const enemyTrainerVisible = enemyTrainer?.visible === true;
  const enemyTrainerAlpha = enemyTrainer?.alpha ?? 0;
  const expectedPlayerFieldIds = globalScene
    .getPlayerParty()
    .slice(0, globalScene.currentBattle?.arrangement.playerCapacity ?? 0)
    .filter(pokemon => !pokemon.isFainted())
    .map(pokemon => pokemon.id);
  const playerField = globalScene.field
    .getAll()
    .flatMap(candidate => {
      const pokemon = candidate as Pokemon;
      try {
        if (!pokemon.isPlayer()) {
          return [];
        }
        const sprite = pokemon.getSprite();
        const info = pokemon.getBattleInfo();
        return [
          {
            pokemonId: pokemon.id,
            partySlot: globalScene.getPlayerParty().indexOf(pokemon),
            visible: pokemon.visible === true,
            alpha: pokemon.alpha,
            spriteVisible: sprite?.visible === true,
            spriteAlpha: sprite?.alpha ?? null,
            infoVisible: info?.visible === true,
            infoAlpha: info?.alpha ?? null,
          },
        ];
      } catch {
        return [];
      }
    })
    .sort((left, right) => left.partySlot - right.partySlot || left.pokemonId - right.pokemonId);
  const readyPlayerFieldIds = playerField
    .filter(
      pokemon =>
        pokemon.visible
        && pokemon.alpha > 0
        && pokemon.spriteVisible
        && (pokemon.spriteAlpha ?? 0) > 0
        && pokemon.infoVisible
        && (pokemon.infoAlpha ?? 0) > 0,
    )
    .map(pokemon => pokemon.pokemonId);
  return {
    trainerVisible: playerTrainer?.visible === true,
    enemyTrainerVisible,
    enemyTrainerAlpha,
    enemyTrainerPresented: enemyTrainerVisible && enemyTrainerAlpha > 0.001,
    expectedPlayerFieldIds,
    playerField,
    playerFieldReady: JSON.stringify(readyPlayerFieldIds) === JSON.stringify(expectedPlayerFieldIds),
  } as const;
}

// Exact ordered presentation ledger. The authority callback runs synchronously after assigning the
// event's immutable per-turn sequence; the renderer callback runs only when the matching presentation
// phase subtree has drained. The normal application never imports this entry or registers the observer.
setCoopPresentationObserver(observation => {
  const runtime = getCoopRuntime();
  if (runtime == null) {
    return;
  }
  console.info(
    `${PRESENTATION_EVENT_PREFIX}${JSON.stringify({
      version: 1,
      stage: observation.stage,
      role: runtime.controller.role,
      epoch: runtime.controller.sessionEpoch,
      wave: globalScene.currentBattle?.waveIndex ?? -1,
      turn: observation.turn,
      seq: observation.seq,
      event: observation.event,
      ...(observation.reason == null ? {} : { reason: observation.reason }),
      ...(observation.actorFingerprint == null ? {} : { actorFingerprint: observation.actorFingerprint }),
    })}`,
  );
  if (
    runtime.controller.role === "guest"
    && observation.event.k === "switch"
    && (observation.stage === "renderer-completed" || observation.stage === "renderer-skipped")
  ) {
    const battle = globalScene.currentBattle;
    const trainer = battle?.trainer;
    const identity = {
      version: 1,
      role: runtime.controller.role,
      epoch: runtime.controller.sessionEpoch,
      wave: battle?.waveIndex ?? -1,
      turn: observation.turn,
      seq: observation.seq,
      event: observation.event,
    } as const;
    // A synchronous receipt cannot catch a Phaser tween that is still registered and writes stale values
    // on the next update.  Two real animation frames make this a pixel-adjacent lifecycle oracle while
    // remaining strictly read-only and CI-bundle-only.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (getCoopRuntime() !== runtime || globalScene.currentBattle !== battle) {
          return;
        }
        const trainerVisible = trainer?.visible === true;
        const trainerAlpha = trainer?.alpha ?? 0;
        const trainerPresented = trainerVisible && trainerAlpha > 0.001;
        const payload = { ...identity, trainerVisible, trainerAlpha, trainerPresented };
        const line = `${TRAINER_POSTCONDITION_PREFIX}${JSON.stringify(payload)}`;
        if (trainerPresented) {
          console.error(line);
        } else {
          console.info(line);
        }
      }),
    );
  }
});

setCoopPlayerTrainerTransitionObserver(observation => {
  const runtime = getCoopRuntime();
  if (runtime == null || runtime.controller.role !== "guest") {
    return;
  }
  console.info(
    `${TRAINER_TRANSITION_PREFIX}${JSON.stringify({
      version: 1,
      role: runtime.controller.role,
      epoch: runtime.controller.sessionEpoch,
      ...observation,
    })}`,
  );
});

// Post-battle EXP, level, and evolution cues live in the retained WAVE_ADVANCE transaction rather than
// the turn event stream. Give them the same exact authority/renderer receipt evidence so a mechanically
// converged browser cannot silently omit progression presentation and still pass the campaign.
setCoopWaveProgressionPresentationObserver(observation => {
  const runtime = getCoopRuntime();
  if (runtime == null) {
    return;
  }
  console.info(
    `${PROGRESSION_EVENT_PREFIX}${JSON.stringify({
      version: 1,
      stage: observation.stage,
      role: runtime.controller.role,
      epoch: runtime.controller.sessionEpoch,
      wave: observation.wave,
      seq: observation.seq,
      event: observation.event,
      ...(observation.reason == null ? {} : { reason: observation.reason }),
    })}`,
  );
});

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
  // Nearest-rank p95 is ceil(0.95 * N), converted to a zero-based index. Using
  // floor(0.95 * N) made N=20 select index 19 (the maximum/p100), so one ordinary
  // runner scheduling outlier falsely failed the campaign as an observer regression.
  const p95Index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1));
  const p95 = sorted[p95Index];
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

/** Read-only active/innate applicability at slots 0..3, including permanent and run-only unlock gates. */
function safeAbilitySlotActivity(pokemon: Pokemon): boolean[] {
  try {
    return [pokemon.canApplyAbility(), ...[0, 1, 2].map(slot => pokemon.canApplyAbility(true, slot))];
  } catch {
    return [];
  }
}

/** Stable read-only projection of persistent modifiers attached to one party member. */
function observedPokemonModifierStacks(pokemonId: number) {
  return globalScene.modifiers
    .flatMap(modifier => {
      const projected = modifier as unknown as {
        type?: { id?: string };
        pokemonId?: number;
        stackCount?: number;
        getStackCount?: () => number;
      };
      if (projected.pokemonId !== pokemonId || typeof projected.type?.id !== "string") {
        return [];
      }
      const stack = typeof projected.getStackCount === "function" ? projected.getStackCount() : projected.stackCount;
      return [
        {
          typeId: projected.type.id,
          className: modifier.constructor.name,
          quantity: Number.isSafeInteger(stack) ? Math.max(0, stack ?? 0) : 0,
        },
      ];
    })
    .toSorted(
      (left, right) =>
        left.typeId.localeCompare(right.typeId)
        || left.className.localeCompare(right.className)
        || left.quantity - right.quantity,
    );
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
    modifierStacks: observedPokemonModifierStacks(pokemon.id),
    statStages: [...pokemon.summonData.statStages],
    moves: pokemon.moveset.map(move => ({
      move: move.moveId,
      ppUsed: move.ppUsed,
      ppUp: move.ppUp,
      maxPpOverride: move.maxPpOverride ?? null,
    })),
  };
}

/** Active party slots, independent of each Showdown browser's local player/enemy battler-index orientation. */
function observedActivePartySlots(party: readonly Pokemon[], field: readonly Pokemon[]): number[] {
  return field.map(pokemon => party.indexOf(pokemon)).filter(slot => slot >= 0);
}

/** The canonical component object the mechanical digest hashes. Read once, reused for the breakdown. */
function mechanicalDigestComponents(): Record<string, unknown> {
  const runtime = getCoopRuntime();
  const versus = runtime?.controller.isVersusSession() === true;
  // Save data and money belong to each Showdown account, not to the shared battle. Comparing them made two
  // perfectly synchronized players diverge at the first command solely because their account blobs differ.
  // Ordinary co-op still includes both fields because its shared run owns them mechanically.
  const saveDataDigest = versus ? "versus-account-local-excluded" : captureCoopSaveDataDigest();
  if (saveDataDigest === CHECKSUM_SENTINEL) {
    throw new Error("save-data observer could not capture a stable digest");
  }
  const playerParty = globalScene.getPlayerParty();
  const enemyParty = globalScene.getEnemyParty();
  const playerField = globalScene.getPlayerField();
  const enemyField = globalScene.getEnemyField();
  const localParty = playerParty.map(observedPokemon);
  const opponentParty = enemyParty.map(observedPokemon);
  const localField = versus
    ? observedActivePartySlots(playerParty, playerField)
    : playerField.map(pokemon => pokemon.getBattlerIndex());
  const opponentField = versus
    ? observedActivePartySlots(enemyParty, enemyField)
    : enemyField.map(pokemon => pokemon.getBattlerIndex());
  // Each Showdown browser renders its own team as `playerParty`. Canonicalize by authenticated seat so both
  // observers hash seat 0 then seat 1, while retaining the ordinary co-op player/enemy projection unchanged.
  const localIsSeatOne = versus && runtime?.controller.seat === 1;
  return {
    wave: globalScene.currentBattle.waveIndex,
    turn: globalScene.currentBattle.turn,
    money: versus ? 0 : globalScene.money,
    seed: globalScene.seed ?? "",
    biome: globalScene.arena.biomeId ?? 0,
    weather: globalScene.arena.weather?.weatherType ?? 0,
    terrain: globalScene.arena.terrain?.terrainType ?? 0,
    playerParty: localIsSeatOne ? opponentParty : localParty,
    enemyParty: localIsSeatOne ? localParty : opponentParty,
    playerField: localIsSeatOne ? opponentField : localField,
    enemyField: localIsSeatOne ? localField : opponentField,
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

/**
 * Project the membership axes that can actually authenticate mechanical traffic. The legacy V1 membership
 * controller starts active/generation-zero as soon as a runtime is constructed, before a P33 seat has accepted
 * the immutable session binding. Treating that provisional object as a "stable-seat binding" made the browser
 * oracle report a false host binding during reload and hid the Worker's generation-2 channel. P33 observations
 * therefore fail closed until the same exact frame context used by Authority V2 is actionable.
 */
function observedMembershipAxes(runtime: NonNullable<ReturnType<typeof getCoopRuntime>>): {
  readonly revision: number;
  readonly connectionGeneration: number;
  readonly connectionGenerations: readonly number[];
  readonly state: "active";
} | null {
  if (runtime.controller.hasAuthenticatedPairing) {
    const frame = runtime.controller.p33FrameContext();
    const membership = runtime.controller.p33MembershipSnapshot();
    if (frame == null || membership?.state !== "active") {
      return null;
    }
    const members = [...membership.members].sort((left, right) => left.seatId - right.seatId);
    if (
      members.length < 2
      || members.some(
        (member, seatId) =>
          member.seatId !== seatId
          || !Number.isSafeInteger(member.connectionGeneration)
          || member.connectionGeneration < 0,
      )
      || members[frame.fromSeatId]?.connectionGeneration !== frame.connectionGeneration
    ) {
      return null;
    }
    return {
      revision: frame.membershipRevision,
      connectionGeneration: frame.connectionGeneration,
      connectionGenerations: members.map(member => member.connectionGeneration),
      state: "active",
    };
  }
  const membership = runtime.membership.snapshot();
  return membership.state === "active"
    ? {
        revision: membership.revision,
        connectionGeneration: membership.connectionGeneration,
        connectionGenerations: [membership.connectionGeneration, membership.connectionGeneration],
        state: "active",
      }
    : null;
}

function observeBoundSession(): void {
  try {
    const runtime = getCoopRuntime();
    if (runtime == null || runtime.controller.sessionEpoch <= 0) {
      return;
    }
    const authenticatedMembership = observedMembershipAxes(runtime);
    const provisionalMembership = runtime.membership.snapshot();
    if (authenticatedMembership == null && provisionalMembership.state !== "active") {
      return;
    }
    const membership = authenticatedMembership ?? {
      revision: provisionalMembership.revision,
      connectionGeneration:
        runtime.localTransport.connectionGeneration?.() ?? provisionalMembership.connectionGeneration,
      connectionGenerations: [
        runtime.localTransport.connectionGeneration?.() ?? provisionalMembership.connectionGeneration,
        runtime.localTransport.connectionGeneration?.() ?? provisionalMembership.connectionGeneration,
      ],
      state: "active" as const,
    };
    const observation = {
      version: 1,
      role: runtime.controller.role,
      seat: runtime.controller.seat,
      epoch: runtime.controller.sessionEpoch,
      membershipRevision: membership.revision,
      connectionGeneration: membership.connectionGeneration,
      connectionGenerations: membership.connectionGenerations,
      membershipState: membership.state,
      gameplayBindingReady: authenticatedMembership != null || !runtime.controller.hasAuthenticatedPairing,
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
    const membership = observedMembershipAxes(runtime);
    if (membership == null) {
      return;
    }
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
      connectionGenerations: membership.connectionGenerations,
      wave: battle.waveIndex,
      turn: battle.turn,
      phase,
      uiMode,
      uiActive: true,
      stateDigest,
      battleType: BattleType[battle.battleType],
      trainerBoss: battle.trainer?.config.isBoss === true,
      bossEnemyCount: globalScene.getEnemyParty().filter(pokemon => pokemon.isBoss()).length,
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

const COOP_ABILITY_INTERACTION_PHASES = new Set([
  "ErAbilityCapsulePhase",
  "ErGreaterAbilityCapsulePhase",
  "ErGreaterAbilityRandomizerPhase",
  "ErDexNavPhase",
]);

const COOP_ABILITY_SURFACE_KIND = {
  OPTION_SELECT: "option",
  PARTY: "party",
  ER_BARGAIN: "choice",
  MESSAGE: "message",
} as const;

const COOP_REVIVAL_PHASES = new Set(["RevivalBlessingPhase", "CoopGuestRevivalPhase"]);

// Native terminal phases can briefly retain the preceding UI handler while they tear that scene down.
// They are engine progress, not human-input surfaces: publishing the stale handler as `unclassified`
// makes a successful public journey fail merely because the read-only observer sampled the handoff.
const NON_INTERACTIVE_SEMANTIC_TRANSITION_PHASES = new Set(["EndEvolutionPhase"]);
// SelectModifierPhase owns the reward UI, but the engine assigns it before EVOLUTION_SCENE has
// finished closing. A reward evolution can likewise queue LearnMovePhase while the preceding evolution
// cutscene is still the visible handler. These exact phase/UI pairs are teardown samples, not actionable
// reward/learn-move surfaces; the observer must wait for the real MODIFIER_SELECT/SUMMARY handler.
const NON_INTERACTIVE_SEMANTIC_TRANSITION_PAIRS = new Set([
  "SelectModifierPhase:EVOLUTION_SCENE",
  "LearnMovePhase:EVOLUTION_SCENE",
]);

/**
 * Resolve surfaces whose owner is part of the immutable operation, rather than the alternating
 * interaction cursor. Revival follows the Pokemon that used the move; Stormglass is explicitly
 * host-owned. Returning a role here prevents a passive PARTY/MESSAGE watcher from ever looking like
 * the client that may submit the operation.
 */
function semanticStableOwnerRole(semantic: SemanticSurface, currentPhase: unknown): "host" | "guest" | null {
  const phase = currentPhase as {
    ownerIsGuest?: unknown;
    user?: { coopOwner?: unknown };
  };
  if (semantic.operationClass === "stormglass") {
    return "host";
  }
  if (semantic.operationClass !== "revival") {
    return null;
  }
  if (phase.ownerIsGuest === true) {
    return "guest";
  }
  if (phase.ownerIsGuest === false) {
    return "host";
  }
  return phase.user?.coopOwner === "guest" ? "guest" : "host";
}

/**
 * Resolve the immutable interaction coordinate owned by the phase currently rendering a
 * shared surface. The live controller counter is only the next global cursor: a terminal
 * arriving on the peer can advance it while this exact UI remains open. Production phases
 * deliberately pin their owner decisions at open, so the read-only browser mirror must use
 * the same coordinate or it can report the real owner as a watcher.
 */
function semanticPinnedInteractionCounter(semantic: SemanticSurface, currentPhase: unknown): number | null {
  const phase = currentPhase as {
    coopAdvancePinned?: unknown;
    coopBargainStart?: unknown;
    coopBiomeStart?: unknown;
    coopInteractionStart?: unknown;
    coopSeq?: unknown;
    coopStartCounter?: unknown;
    coopV2BiomeInteractionPin?: () => number;
  };
  let candidate: unknown = null;
  if (semantic.operationClass === "ability") {
    candidate = phase.coopSeq;
  }
  switch (semantic.surfaceId) {
    case "reward-shop":
    case "party:reward-target":
    case "reward:confirm":
      candidate = phase.coopInteractionStart;
      break;
    case "biome-market":
      candidate = phase.coopBiomeStart;
      break;
    case "crossroads":
      candidate = phase.coopStartCounter;
      break;
    case "world-map":
    case "biome-select":
      candidate = phase.coopV2BiomeInteractionPin?.() ?? phase.coopAdvancePinned;
      break;
    case "bargain":
      candidate = phase.coopBargainStart;
      break;
    default:
      if (semantic.operationClass === "encounter" || semantic.operationClass === "encounter-prompt") {
        candidate = coopMeInteractionStartValue();
      }
      break;
  }
  return Number.isSafeInteger(candidate) && (candidate as number) >= 0 ? (candidate as number) : null;
}

/** Map (phase, uiMode) to a stable semantic surfaceId + operation class + ownership model. */
function classifySemanticSurface(phase: string, uiMode: string): SemanticSurface | null {
  const inMe =
    (phase.startsWith("MysteryEncounter") && phase !== "MysteryEncounterBattlePhase")
    || phase === "PostMysteryEncounterPhase"
    || phase === "CoopReplayMePhase"
    || phase === "TheBargainPhase";
  const abilitySurfaceKind = COOP_ABILITY_SURFACE_KIND[uiMode as keyof typeof COOP_ABILITY_SURFACE_KIND];
  if (COOP_ABILITY_INTERACTION_PHASES.has(phase) && abilitySurfaceKind != null) {
    return {
      surfaceId: `ability:${phase}:${abilitySurfaceKind}`,
      operationClass: "ability",
      ownerModel: "interaction",
    };
  }
  if (COOP_REVIVAL_PHASES.has(phase) && uiMode === "PARTY") {
    return { surfaceId: "revival:party", operationClass: "revival", ownerModel: "interaction" };
  }
  if (phase === "ErStormglassPickerPhase" && (uiMode === "MESSAGE" || uiMode === "OPTION_SELECT")) {
    return {
      surfaceId: `stormglass:${uiMode === "MESSAGE" ? "message" : "option"}`,
      operationClass: "stormglass",
      ownerModel: "interaction",
    };
  }
  switch (uiMode) {
    case "LOGIN_OR_REGISTER":
      return { surfaceId: "auth:login-or-register", operationClass: "authentication", ownerModel: "local" };
    case "TITLE":
      return { surfaceId: "title-menu", operationClass: "navigation", ownerModel: "local" };
    case "MENU":
      return { surfaceId: "pause-menu", operationClass: "local-overlay", ownerModel: "local" };
    case "SETTINGS":
    case "SETTINGS_DISPLAY":
    case "SETTINGS_AUDIO":
    case "SETTINGS_GAMEPAD":
    case "SETTINGS_KEYBOARD":
      return { surfaceId: "pause-settings", operationClass: "local-overlay", ownerModel: "local" };
    case "COMMAND":
    case "FIGHT":
    case "BALL":
      return phase === "CommandPhase"
        ? { surfaceId: `command:${uiMode.toLowerCase()}`, operationClass: "command", ownerModel: "local" }
        : null;
    // The resolved target belongs to the same local command, but production deliberately
    // commits it from its own phase after the human chooses the concrete battler index.
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
    case "SHOWDOWN_TEAM_MENU":
      return { surfaceId: "showdown-team-menu", operationClass: "setup", ownerModel: "local" };
    case "SHOWDOWN_WAGER":
      // Both players choose and lock their own stake. This is reciprocal local input, not the
      // alternating shared-interaction owner model used by shops and Mystery encounters.
      return { surfaceId: "wager", operationClass: "setup", ownerModel: "local" };
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
      if (isCoopLocalPresentationInputSurface(phase, uiMode)) {
        return { surfaceId: `confirm:${phase}`, operationClass: "confirm", ownerModel: "local" };
      }
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
    case "EVOLUTION_SCENE":
      // Evolution is rendered twice from one authoritative result: EvolutionPhase owns the real
      // mutation and CoopWaveProgressionReplayPhase owns the mechanics-free retained presentation.
      // Both use EvolutionSceneUiHandler and both deliberately arm their own local completion prompt.
      if (phase === "FormChangePhase" || phase === "CoopFormChangeCutsceneReplayPhase") {
        return { surfaceId: "battle:form-change", operationClass: "battle-progress", ownerModel: "local" };
      }
      return phase === "EvolutionPhase" || phase === "CoopWaveProgressionReplayPhase"
        ? { surfaceId: "battle:evolution", operationClass: "battle-progress", ownerModel: "local" }
        : null;
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

interface FightMoveProjection {
  readonly index: number;
  readonly optionId: string;
  readonly moveId: number;
  readonly power: number;
  readonly category: string;
  readonly usable: boolean;
}

/**
 * Read the same move cells, power/category values, and selectability the active FIGHT
 * handler presents. This is assertion-only metadata: the browser driver still reaches
 * the menu and moves its cursor exclusively through normal public keyboard input.
 */
function readFightMoveSlots(uiMode: string): FightMoveProjection[] | null {
  if (uiMode !== "FIGHT") {
    return null;
  }
  const phase = globalScene.phaseManager.getCurrentPhase();
  if (!phase?.is("CommandPhase")) {
    return null;
  }
  const pokemon = phase.getPokemon();
  return pokemon.getMoveset().map((pokemonMove, index) => {
    const move = pokemonMove.getMove();
    return {
      index,
      optionId: `move:${pokemonMove.moveId}:slot:${index}`,
      moveId: pokemonMove.moveId,
      power: Number.isFinite(move.power) ? move.power : 0,
      category: MoveCategory[move.category] ?? "UNKNOWN",
      usable: pokemonMove.isUsable(pokemon, false, true)[0],
    };
  });
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
  if (uiMode === "SHOWDOWN_TEAM_MENU") {
    const showdownHandler = handler as unknown as {
      config?: { presets?: unknown[] } | null;
      teamCursor?: number;
    };
    const presetCount = Array.isArray(showdownHandler.config?.presets) ? showdownHandler.config.presets.length : 0;
    const optionIds = [
      ...Array.from({ length: presetCount }, (_value, index) => `showdown-preset:${index}`),
      "showdown-action:create",
    ];
    const teamCursor = Number.isSafeInteger(showdownHandler.teamCursor) ? (showdownHandler.teamCursor as number) : null;
    return {
      selectedOptionId: teamCursor == null ? null : (optionIds[teamCursor] ?? `cursor:${teamCursor}`),
      optionIds,
      optionCount: optionIds.length,
    };
  }
  if (uiMode === "SHOWDOWN_WAGER") {
    const showdownHandler = handler as unknown as {
      choices?: Array<{
        offer?: {
          speciesId?: unknown;
          variant?: unknown;
          cost?: unknown;
        } | null;
      }>;
      cursor?: number;
    };
    const optionIds = Array.isArray(showdownHandler.choices)
      ? showdownHandler.choices.map((choice, index) => {
          const offer = choice?.offer;
          if (offer == null) {
            return "showdown-wager:friendly";
          }
          return Number.isSafeInteger(offer.speciesId)
            ? `showdown-wager:stake:${offer.speciesId}:${Number.isSafeInteger(offer.variant) ? offer.variant : 0}:${
                Number.isSafeInteger(offer.cost) ? offer.cost : 0
              }`
            : `showdown-wager:stake:${index}`;
        })
      : null;
    const wagerCursor = Number.isSafeInteger(showdownHandler.cursor) ? (showdownHandler.cursor as number) : null;
    return {
      selectedOptionId: wagerCursor == null ? null : (optionIds?.[wagerCursor] ?? `cursor:${wagerCursor}`),
      optionIds,
      optionCount: optionIds?.length ?? null,
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
  if (uiMode === "COMMAND") {
    const commandHandler = handler as unknown as {
      teraButton?: { visible?: boolean };
      resetEnabled?: boolean;
    };
    const optionByCommand = new Map<number, string>([
      [Command.FIGHT, "command:fight"],
      [Command.BALL, "command:ball"],
      [Command.POKEMON, "command:pokemon"],
      [Command.RUN, "command:run"],
    ]);
    if (commandHandler.teraButton?.visible === true) {
      optionByCommand.set(Command.TERA, "command:tera");
    }
    if (commandHandler.resetEnabled === true) {
      optionByCommand.set(Command.RESET, "command:reset");
    }
    const optionIds = [...optionByCommand.values()];
    return {
      selectedOptionId:
        selectedIndex == null ? null : (optionByCommand.get(selectedIndex) ?? `cursor:${selectedIndex}`),
      optionIds,
      optionCount: optionIds.length,
    };
  }
  if (uiMode === "FIGHT") {
    const moveSlots = readFightMoveSlots(uiMode);
    if (moveSlots != null) {
      const optionIds = moveSlots.map(slot => slot.optionId);
      return {
        selectedOptionId: selectedIndex == null ? null : (optionIds[selectedIndex] ?? `cursor:${selectedIndex}`),
        optionIds,
        optionCount: optionIds.length,
      };
    }
  }
  if (uiMode === "SUMMARY") {
    const summaryHandler = handler as unknown as {
      summaryUiMode?: unknown;
      moveCursor?: unknown;
      pokemon?: Pokemon;
    };
    if (
      summaryHandler.summaryUiMode === SummaryUiMode.LEARN_MOVE
      && Number.isSafeInteger(summaryHandler.moveCursor)
      && summaryHandler.pokemon != null
    ) {
      const moveCursor = summaryHandler.moveCursor as number;
      const moves = summaryHandler.pokemon.getMoveset();
      const optionIds = [...moves.map((move, index) => `move:${move.moveId}:slot:${index}`), "learn-move:cancel"];
      const selectedOptionId =
        moveCursor >= 0 && moveCursor < moves.length
          ? optionIds[moveCursor]
          : moveCursor === summaryHandler.pokemon.getMaxMoveCount()
            ? "learn-move:cancel"
            : `learn-move:cursor:${moveCursor}`;
      return {
        selectedOptionId,
        optionIds,
        optionCount: optionIds.length,
      };
    }
  }
  if (uiMode === "MODIFIER_SELECT") {
    const modifierHandler = handler as unknown as {
      rowCursor?: number;
      options?: Array<{ modifierTypeOption?: { type?: { id?: string } } }>;
      rerollButtonContainer?: { visible?: boolean };
      transferButtonContainer?: { visible?: boolean };
      checkButtonContainer?: { visible?: boolean };
      lockRarityButtonContainer?: { visible?: boolean };
    };
    if (modifierHandler.rowCursor === 0) {
      const actionByCursor = new Map<number, string>([
        [0, "reward-action:reroll"],
        [1, "reward-action:manage-items"],
        [2, "reward-action:check-team"],
        [3, "reward-action:lock-rarities"],
      ]);
      const optionIds = [
        ...(modifierHandler.rerollButtonContainer?.visible === true ? ["reward-action:reroll"] : []),
        ...(modifierHandler.transferButtonContainer?.visible === true ? ["reward-action:manage-items"] : []),
        ...(modifierHandler.checkButtonContainer?.visible === true ? ["reward-action:check-team"] : []),
        ...(modifierHandler.lockRarityButtonContainer?.visible === true ? ["reward-action:lock-rarities"] : []),
      ];
      return {
        selectedOptionId:
          selectedIndex == null ? null : (actionByCursor.get(selectedIndex) ?? `cursor:${selectedIndex}`),
        optionIds,
        optionCount: optionIds.length,
      };
    }
    const modOptions = modifierHandler.options;
    if (Array.isArray(modOptions)) {
      const optionIds = modOptions.map((option, index) => option?.modifierTypeOption?.type?.id ?? `slot:${index}`);
      return {
        selectedOptionId: selectedIndex == null ? null : (optionIds[selectedIndex] ?? `cursor:${selectedIndex}`),
        optionIds,
        optionCount: optionIds.length,
      };
    }
  }
  if (uiMode === "MYSTERY_ENCOUNTER") {
    const mysteryHandler = handler as unknown as {
      encounterOptions?: Array<{ optionMode?: number }>;
      optionsMeetsReqs?: boolean[];
      viewPartyIndex?: number;
    };
    const encounterOptions = mysteryHandler.encounterOptions;
    const meetsRequirements = mysteryHandler.optionsMeetsReqs;
    if (Array.isArray(encounterOptions) && Array.isArray(meetsRequirements) && encounterOptions.length > 0) {
      // Labels are localized and may be dynamically resolved, so publish only ordinal identity plus
      // the production handler's already-computed selectability. The driver remains read-only here:
      // it still moves the real cursor with arrow keys and submits through the normal ACTION binding.
      const optionIds = encounterOptions.map((option, index) => {
        const disabled =
          meetsRequirements[index] === false
          && (option.optionMode === MysteryEncounterOptionMode.DISABLED_OR_DEFAULT
            || option.optionMode === MysteryEncounterOptionMode.DISABLED_OR_SPECIAL);
        return `mystery-option:${index}:${disabled ? "disabled" : "enabled"}`;
      });
      optionIds.push("mystery-action:view-party");
      const viewPartyIndex = Number.isSafeInteger(mysteryHandler.viewPartyIndex)
        ? (mysteryHandler.viewPartyIndex as number)
        : encounterOptions.length;
      return {
        selectedOptionId:
          selectedIndex === viewPartyIndex
            ? "mystery-action:view-party"
            : selectedIndex == null
              ? null
              : (optionIds[selectedIndex] ?? `cursor:${selectedIndex}`),
        optionIds,
        optionCount: optionIds.length,
      };
    }
  }
  if (uiMode === "ER_BARGAIN") {
    const bargainHandler = handler as unknown as {
      picker?: { options?: unknown[] } | null;
    };
    const pickerOptions = bargainHandler.picker?.options;
    if (Array.isArray(pickerOptions) && pickerOptions.length > 0) {
      // The Curiosity/Greater Ability Randomizer picker renders localized labels, so publish
      // stable ordinals for its actual ability rows. Deliberately omit the trailing Cancel row:
      // landing there must remain a visible driver failure instead of being mistaken for a choice.
      const optionIds = pickerOptions.map((_option, index) => `er-bargain-picker:option:${index}`);
      return {
        selectedOptionId:
          selectedIndex != null && selectedIndex >= 0 && selectedIndex < optionIds.length
            ? optionIds[selectedIndex]
            : selectedIndex == null
              ? null
              : "er-bargain-picker:cancel",
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
let semanticDigestCacheKey = "";
let semanticDigestCacheAt = 0;
let semanticDigestCache: ReturnType<typeof computeMechanicalDigest> | null = null;
let lastSemanticPhase: object | null = null;
let semanticPhaseInstance = 0;
let lastSemanticObserverError = "";
let lastObservedRenderProfile = "";
let lastObservedMarket = "";
let lastObservedCommander = "";

/**
 * The semantic observer ticks at 10 Hz so it can notice handler/readiness changes quickly, but the broad
 * mechanical digest walks both parties, modifiers, arena state, and save substrates. Recomputing that full
 * projection on every 100 ms poll consumed most of a constrained Chromium runner and reduced the real game
 * loop below one frame per second. Cache only the digest—not the semantic/readiness reads—for a fixed 1 s
 * SLA, and invalidate immediately at every phase/surface/address/selection transition supplied by `key`.
 */
function semanticMechanicalDigest(key: string): ReturnType<typeof computeMechanicalDigest> {
  const now = Date.now();
  if (semanticDigestCache != null && key === semanticDigestCacheKey && now - semanticDigestCacheAt < 1_000) {
    return semanticDigestCache;
  }
  semanticDigestCacheKey = key;
  semanticDigestCacheAt = now;
  semanticDigestCache = computeMechanicalDigest();
  return semanticDigestCache;
}

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
    const membership = runtime == null ? null : observedMembershipAxes(runtime);
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
    const membership = runtime == null ? null : observedMembershipAxes(runtime);
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
      connectionGenerations: membership.connectionGenerations,
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
    // A fresh P33 controller cannot have an accepted gameplay binding until the host chooses New Game/Resume
    // and (for Resume) the guest accepts the offer. The Title/MESSAGE callback and the CONFIRM surface it opens
    // are therefore legitimate pre-binding human boundaries on BOTH roles: the host owns save discovery while
    // the guest can remain at epoch zero awaiting the immutable offer. Every non-title gameplay surface still
    // fails closed below. Keeping CONFIRM hidden deadlocked the keyboard-only resume journey after its first,
    // successful Space press even though a human could see and answer the real Yes/No modal.
    const preBindingLaunchSurface =
      phase === "TitlePhase"
      && (uiMode === "MESSAGE" || uiMode === "CONFIRM")
      && runtime != null
      && runtime.controller.hasAuthenticatedPairing
      && runtime.controller.p33FrameContext() == null;
    if (
      phase === "TitlePhase"
      && uiMode === "MESSAGE"
      && !preBindingLaunchSurface
      && (runtime == null || runtime.controller.sessionEpoch <= 0)
    ) {
      return;
    }
    // When this seat has no locally actionable battler, the real continuation is the exact replay waiter,
    // not a fabricated command menu. The phase exposes readiness only after awaitTurnOrLiveEvent is installed.
    const rendererWaitReady = (
      currentPhase as unknown as { isAwaitingAuthority?: () => boolean }
    ).isAwaitingAuthority?.();
    if (rendererWaitReady === true && runtime != null && battle != null) {
      const membership = observedMembershipAxes(runtime);
      if (membership == null || runtime.controller.sessionEpoch <= 0) {
        return;
      }
      const { digest: stateDigest } = semanticMechanicalDigest(
        `watcher:${runtime.controller.sessionEpoch}:${battle.waveIndex}:${battle.turn}:${phase}:${semanticPhaseInstance}`,
      );
      const partySlots = globalScene.getPlayerParty().map((pokemon, slot) => ({
        slot,
        pokemonId: pokemon.id,
        speciesId: pokemon.species.speciesId,
        formIndex: pokemon.formIndex,
        fusionSpeciesId: pokemon.fusionSpecies?.speciesId ?? null,
        fusionFormIndex: pokemon.fusionSpecies == null ? null : pokemon.fusionFormIndex,
        coopOwner: pokemon.coopOwner ?? null,
        active: pokemon.isActive(true),
        fainted: pokemon.isFainted(),
        hp: pokemon.hp,
        maxHp: pokemon.getMaxHp(),
        level: pokemon.level,
        exp: pokemon.exp,
        statusEffect: pokemon.status?.effect ?? null,
        abilityIndex: pokemon.abilityIndex,
        abilityId: pokemon.getAbility().id,
        innateAbilityIds: safeInnateIds(pokemon),
        abilitySlotActivity: safeAbilitySlotActivity(pokemon),
        runUnlockedAbilitySlots: [...pokemon.customPokemonData.erRunUnlockedAbilitySlots].sort((a, b) => a - b),
        abilityActive: pokemon.canApplyAbility(),
        abilitySuppressed: pokemon.summonData.abilitySuppressed,
        nature: pokemon.getNature(),
        teraType: pokemon.teraType,
        maxMoveCount: pokemon.getMaxMoveCount(),
        bonusMoveSlots: pokemon.customPokemonData.bonusMoveSlots,
        modifierStacks: observedPokemonModifierStacks(pokemon.id),
        moves: pokemon.getMoveset().map(move => ({
          moveId: move.moveId,
          ppUsed: move.ppUsed,
          ppUp: move.ppUp,
          maxPpOverride: move.maxPpOverride ?? null,
        })),
        pauseEvolutions: pokemon.pauseEvolutions,
        allowedInBattle: pokemon.isAllowedInBattle(),
        replacementEligible: false,
      }));
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
        connectionGenerations: membership.connectionGenerations,
        localSeat: runtime.controller.seat,
        localRole: runtime.controller.role,
        ownerSeat: null,
        seatsWithInput: [],
        selectedOptionId: null,
        optionIds: null,
        optionCount: null,
        teamSpeciesIds: null,
        moveSlots: null,
        partySlots,
        ready: { handlerActive: false, awaitingActionInput: false, inputBlocked: true },
        phase,
        phaseInstance: semanticPhaseInstance,
        surfaceGeneration: null,
        // The passive renderer must satisfy the same visible-HUD proof contract as an
        // actionable command surface. Omitting this field makes an otherwise valid
        // command watcher fail closed in the public two-browser oracle.
        displayedWave: globalScene.getDisplayedBiomeWaveIndex() ?? null,
        mysteryEncounterType: battle.mysteryEncounter?.encounterType ?? null,
        arena: {
          biomeId: globalScene.arena?.biomeId ?? null,
          weather: globalScene.arena?.weather?.weatherType ?? 0,
          terrain: globalScene.arena?.terrain?.terrainType ?? 0,
        },
        presentation: coopBrowserPresentationSnapshot(),
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
    const classifiedSemantic = classifySemanticSurface(phase, uiMode);
    // The authoritative engine keeps a real CommandPhase open while it waits for a command
    // owned by the peer. Its local UI is intentionally a non-actionable MESSAGE ("partner is
    // choosing"), not a command menu. Classify that exact slot-owner relationship as a command
    // watcher so a half-wiped seat cannot look like an orphaned battle message to the browser
    // oracle. This observer is CI-only and reads the phase/field; it does not advance either.
    const commandPhaseFieldIndex = (currentPhase as unknown as { fieldIndex?: unknown }).fieldIndex;
    const commandSlotOwner =
      phase === "CommandPhase" && Number.isSafeInteger(commandPhaseFieldIndex)
        ? globalScene.getPlayerField()[commandPhaseFieldIndex as number]?.coopOwner
        : null;
    const commandPartnerWait =
      phase === "CommandPhase"
      && uiMode === "MESSAGE"
      && runtime != null
      && getCoopNetcodeMode() === "authoritative"
      && (commandSlotOwner === "host" || commandSlotOwner === "guest")
      && commandSlotOwner !== runtime.controller.role;
    // A guest-owned full-moveset prompt is rendered by a queue-owned replay phase. Both its
    // actionable owner picker and the host-owned read-only fallback use SUMMARY, so phase name plus
    // the immutable constructor owner flag is the stable distinction. Without this override the
    // guest owner is mislabeled as a generic info screen and the campaign can never drive its pick.
    const replayLearnMoveOwner = (currentPhase as unknown as { ownerIsGuest?: unknown }).ownerIsGuest;
    let semantic = commandPartnerWait
      ? {
          surfaceId: "command:watcher",
          operationClass: "command",
          ownerModel: "local" as const,
        }
      : phase === "CoopReplayLearnMovePhase" && uiMode === "SUMMARY" && typeof replayLearnMoveOwner === "boolean"
        ? {
            surfaceId: replayLearnMoveOwner ? "learn-move:confirm" : "learn-move:summary",
            operationClass: "learn-move",
            ownerModel: "interaction" as const,
          }
        : classifiedSemantic;
    if (
      semantic == null
      && (NON_INTERACTIVE_SEMANTIC_TRANSITION_PHASES.has(phase)
        || NON_INTERACTIVE_SEMANTIC_TRANSITION_PAIRS.has(`${phase}:${uiMode}`))
    ) {
      // Close the prior canonical observation so the next genuinely actionable surface is emitted even
      // when it happens to be byte-identical. Do not mirror or drive the stale transition handler.
      lastSemanticObservation = "";
      return;
    }
    if (semantic == null) {
      const membership = runtime == null ? null : observedMembershipAxes(runtime);
      if (runtime == null || membership == null) {
        // A local modal such as Settings can temporarily replace a semantic menu without changing
        // either its phase object or its eventual payload. Retaining the old canonical observation
        // across that gap makes the reopened menu look like a duplicate, so a public driver can see
        // the real Back input reach production and still wait forever for a "fresh" actionable menu.
        // Mark the semantic surface closed; returning to the byte-identical menu must emit once again.
        lastSemanticObservation = "";
        return;
      }
      const { wave, turn } = semanticBattleAddress(battle);
      const stateDigest =
        battle == null
          ? null
          : semanticMechanicalDigest(
              `unclassified:${runtime.controller.sessionEpoch}:${wave}:${turn}:${phase}:${semanticPhaseInstance}:${uiMode}`,
            ).digest;
      const observation = {
        version: 2,
        surfaceId: "unclassified",
        operationClass: "unclassified",
        ownerModel: "local",
        coop: true,
        address: { epoch: runtime.controller.sessionEpoch, wave, turn },
        membershipRevision: membership.revision,
        connectionGeneration: membership.connectionGeneration,
        connectionGenerations: membership.connectionGenerations,
        localSeat: runtime.controller.seat,
        localRole: runtime.controller.role,
        ownerSeat: null,
        seatsWithInput: [runtime.controller.seat],
        selectedOptionId: null,
        optionIds: null,
        optionCount: null,
        teamSpeciesIds: null,
        moveSlots: null,
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
    let connectionGenerations: readonly number[] | null = null;
    let seatsWithInput: number[] = [0];
    if (runtime != null) {
      // The exact launch prompt above is intentionally observable before the binding transaction. Every other
      // P33 surface must use the accepted frame axes; otherwise provisional membership can masquerade as play.
      const membership = preBindingLaunchSurface ? runtime.membership.snapshot() : observedMembershipAxes(runtime);
      if (membership == null || (membership.state !== "active" && !preBindingLaunchSurface)) {
        return;
      }
      coop = true;
      localSeat = runtime.controller.seat;
      localRole = runtime.controller.role;
      epoch = runtime.controller.sessionEpoch;
      membershipRevision = membership.revision;
      connectionGeneration = membership.connectionGeneration;
      connectionGenerations =
        "connectionGenerations" in membership
          ? membership.connectionGenerations
          : [membership.connectionGeneration, membership.connectionGeneration];
      const partnerSeat = localSeat === 0 ? 1 : 0;
      let isLocalOwner: boolean | null = null;
      try {
        const pinned = semanticPinnedInteractionCounter(semantic, currentPhase);
        isLocalOwner = runtime.controller.isLocalOwnerAtCounter(pinned ?? runtime.controller.interactionCounter());
      } catch {
        isLocalOwner = null;
      }
      // A faint replacement is owned by the battler's stable seat, not by the alternating biome
      // interaction counter. The only browser that opens the real PARTY picker is that local owner;
      // stamp it explicitly so host SwitchPhase and replica CoopGuestFaintSwitchPhase share one
      // accurate contract (and so future N-player seats do not inherit a two-seat parity guess).
      const localReplacementOwner = semantic.operationClass === "replacement" && uiMode === "PARTY";
      // Learn-move control belongs to the Pokemon's stable co-op owner, not to whichever seat owned
      // the reward/biome interaction that queued the phase. A guest buying a TM for a host-owned mon
      // can therefore leave the interaction counter pointing at the guest while the real actionable
      // CONFIRM is correctly on the host (campaign 30232043330, wave 4). Project the phase's party slot
      // owner so the public oracle does not wait for an impossible self-owner surface on the watcher.
      const learnMovePhase = currentPhase as unknown as { partyMemberIndex?: unknown; partySlot?: unknown };
      const learnMovePartySlot = learnMovePhase.partyMemberIndex ?? learnMovePhase.partySlot;
      const learnMoveOwnerRole =
        semantic.operationClass === "learn-move" && Number.isSafeInteger(learnMovePartySlot)
          ? ((globalScene.getPlayerParty()[learnMovePartySlot as number] as { coopOwner?: string } | undefined)
              ?.coopOwner ?? "host")
          : null;
      const learnMoveOwnerSeat =
        learnMoveOwnerRole == null ? null : runtime.controller.role === learnMoveOwnerRole ? localSeat : partnerSeat;
      const stableOwnerRole = semanticStableOwnerRole(semantic, currentPhase);
      const stableOwnerSeat =
        stableOwnerRole == null ? null : runtime.controller.role === stableOwnerRole ? localSeat : partnerSeat;
      ownerSeat = localReplacementOwner
        ? localSeat
        : (stableOwnerSeat
          ?? learnMoveOwnerSeat
          ?? (semantic.ownerModel === "interaction" && isLocalOwner != null
            ? isLocalOwner
              ? localSeat
              : partnerSeat
            : null));
      // A reward continuation can queue the real LearnMovePhase on both clients. Its owner opens an
      // actionable SUMMARY picker while the partner opens the byte-identical read-only mirror. The
      // generic SUMMARY classifier cannot distinguish those roles, so classify only after resolving
      // the Pokemon's stable owner above. Without this late refinement the public campaign sees two
      // `learn-move:summary` surfaces and never sends the owner's public Back/Action sequence.
      if (
        phase === "LearnMovePhase"
        && uiMode === "SUMMARY"
        && semantic.operationClass === "learn-move"
        && ownerSeat != null
      ) {
        semantic = {
          ...semantic,
          surfaceId: localSeat === ownerSeat ? "learn-move:confirm" : "learn-move:summary",
        };
      }
      // This client's view of who may input: a local surface = this seat drives its own; an
      // interaction surface = only the owner. A driver unions both clients' markers.
      seatsWithInput = semantic.ownerModel === "local" ? [localSeat] : ownerSeat == null ? [] : [ownerSeat];
      if (commandPartnerWait) {
        // This browser owns no key at this phase; the peer's stable seat owns the command.
        // Keep the real active MESSAGE handler/readiness below, but make the input partition
        // explicit instead of claiming the waiting browser can act.
        ownerSeat = partnerSeat;
        seatsWithInput = [partnerSeat];
      }
    }

    const selection = readSelection(handler, uiMode);
    const moveSlots = readFightMoveSlots(uiMode);
    const starterGridCandidates = uiMode === "STARTER_SELECT" ? readStarterGridCandidates(handler) : null;
    const partySlots =
      runtime != null && battle != null
        ? globalScene.getPlayerParty().map((pokemon, slot) => {
            const active = pokemon.isActive(true);
            const fainted = pokemon.isFainted();
            const allowedInBattle = pokemon.isAllowedInBattle();
            const reserve = slot >= (battle?.getBattlerCount() ?? 1);
            const coopOwner = pokemon.coopOwner ?? null;
            const ownedReplacement =
              runtime?.controller.isVersusSession() === true || (localRole != null && coopOwner === localRole);
            return {
              slot,
              pokemonId: pokemon.id,
              speciesId: pokemon.species.speciesId,
              formIndex: pokemon.formIndex,
              fusionSpeciesId: pokemon.fusionSpecies?.speciesId ?? null,
              fusionFormIndex: pokemon.fusionSpecies == null ? null : pokemon.fusionFormIndex,
              coopOwner,
              active,
              fainted,
              hp: pokemon.hp,
              maxHp: pokemon.getMaxHp(),
              level: pokemon.level,
              exp: pokemon.exp,
              statusEffect: pokemon.status?.effect ?? null,
              abilityIndex: pokemon.abilityIndex,
              abilityId: pokemon.getAbility().id,
              innateAbilityIds: safeInnateIds(pokemon),
              abilitySlotActivity: safeAbilitySlotActivity(pokemon),
              runUnlockedAbilitySlots: [...pokemon.customPokemonData.erRunUnlockedAbilitySlots].sort((a, b) => a - b),
              abilityActive: pokemon.canApplyAbility(),
              abilitySuppressed: pokemon.summonData.abilitySuppressed,
              nature: pokemon.getNature(),
              teraType: pokemon.teraType,
              maxMoveCount: pokemon.getMaxMoveCount(),
              bonusMoveSlots: pokemon.customPokemonData.bonusMoveSlots,
              modifierStacks: observedPokemonModifierStacks(pokemon.id),
              moves: pokemon.getMoveset().map(move => ({
                moveId: move.moveId,
                ppUsed: move.ppUsed,
                ppUp: move.ppUp,
                maxPpOverride: move.maxPpOverride ?? null,
              })),
              pauseEvolutions: pokemon.pauseEvolutions,
              allowedInBattle,
              replacementEligible: reserve && !active && !fainted && allowedInBattle && ownedReplacement,
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
    // Authority V2 replay phases intentionally do not construct a second Mystery mechanics object.
    // Their immutable committed identity is nevertheless the exact presentation identity and must be
    // visible to the read-only browser oracle after the resolved visual shell has been installed.
    const replayMysteryEncounterType =
      phase === "CoopReplayMePhase"
        ? (currentPhase as unknown as { coopV2MysteryEncounterType?: unknown }).coopV2MysteryEncounterType
        : null;
    const mysteryEncounterType =
      battle?.mysteryEncounter?.encounterType
      ?? (Number.isSafeInteger(replayMysteryEncounterType) ? (replayMysteryEncounterType as number) : null);
    const promptReady = (handler as unknown as { isAwaitingPromptAction?: () => boolean }).isAwaitingPromptAction;
    const partyPromptReady = (handler as unknown as { isAwaitingActionInput?: () => boolean }).isAwaitingActionInput;
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
        ? typeof partyPromptReady === "function" && partyPromptReady.call(handler) === true
          ? true
          : null
        : typeof promptReady === "function"
          ? promptReady.call(handler)
          : typeof awaitingRaw === "boolean"
            ? awaitingRaw
            : null;
    const promptGeneration =
      (uiMode === "MESSAGE" || uiMode === "EVOLUTION_SCENE") && typeof readPromptGeneration === "function"
        ? readPromptGeneration.call(handler)
        : null;
    const handlerInputBlocked =
      typeof readInputBlocked === "function"
        ? readInputBlocked.call(handler)
        : typeof inputBlockedRaw === "boolean"
          ? inputBlockedRaw
          : null;
    // Report the same Authority V2 lease gate that production Ui.processInput enforces. A visible PARTY
    // picker without its exact replacement control is not actionable; publishing it as ready made the
    // two-browser driver hammer keys that the game correctly rejected and mislabeled the product freeze
    // as cursor geometry.
    const v2InputFrozen = runtime == null ? false : isCoopV2InteractionHumanInputFrozen(runtime);
    // Mirror Ui.processInputCoopAware's #816 exception exactly. The host engine may dismiss a
    // guest-owned Mystery MESSAGE despite the general V2 interaction freeze, but not while it is
    // waiting for the guest renderer's acknowledgement of that same prompt. Publishing the pending
    // window as actionable made the keyboard oracle spend and deduplicate a key production rejected.
    const hostEngineDialogueAdvance =
      runtime != null
      && coopHostEngineDialogueMessageAdvanceAllowed({
        localRole: runtime.controller.role,
        isMessageMode: uiMode === "MESSAGE",
        netcodeMode: getCoopNetcodeMode(),
        meInProgress: coopMeInProgress(),
        meHandoffBattleStarted: coopMeHandoffBattleStarted(),
        mePostBattleContinuationActive: coopMePostBattleContinuationActive(),
        meBespokeHostDrives: coopMeBespokeHostDrives(),
      });
    const interactiveMysteryPhase =
      phase === "MysteryEncounterPhase"
      || phase === "MysteryEncounterOptionSelectedPhase"
      || phase === "MysteryEncounterRewardsPhase"
      || phase === "PostMysteryEncounterPhase"
      || phase === "ErQuizPhase";
    const hostEngineDialogueBlockedByAck =
      runtime != null
      && hostEngineDialogueAdvance
      && interactiveMysteryPhase
      && coopHostMeNarrationAwaitingGuestAck(runtime);
    const localPresentationInput = isCoopLocalPresentationInputSurface(phase, uiMode);
    // Production admits only a provenance-checked local pause/settings branch while its shared V2
    // control remains installed underneath. Project the same decision so a two-browser journey cannot
    // call a visible but frozen overlay actionable (the live wave-13 reward-menu softlock).
    const localOverlayInput = coopLocalOverlayInputAllowed(ui.getMode(), ui.getModeChain());
    const v2SurfaceInputBlocked =
      v2InputFrozen
      && !localPresentationInput
      && !localOverlayInput
      && (!hostEngineDialogueAdvance || hostEngineDialogueBlockedByAck);
    const inputBlocked =
      v2SurfaceInputBlocked || handlerInputBlocked === true ? true : localOverlayInput ? false : handlerInputBlocked;
    const phaseAuthorityOperationId = (currentPhase as unknown as { coopV2ControlOperationId?: unknown })
      .coopV2ControlOperationId;
    const authorityAddress =
      typeof phaseAuthorityOperationId === "string"
        ? Number(phaseAuthorityOperationId.slice(phaseAuthorityOperationId.lastIndexOf(":") + 1))
        : Number.NaN;
    // A repeated Mystery selector intentionally reuses one CoopReplayMePhase, one battle address, and often
    // byte-identical options. Its ordered ME_PRESENT operation is the only generation boundary that changes.
    // Expose the encoded presentation step (+1 keeps the public contract positive) so the keyboard-only
    // campaign treats "Surge again / Stabilize" round N+1 as fresh input instead of suppressing it as the
    // already-driven round N. This CI-only observer reads authority state; it never mutates or drives it.
    const authoritySurfaceGeneration =
      phase === "CoopReplayMePhase" && Number.isSafeInteger(authorityAddress) && authorityAddress >= 0
        ? (authorityAddress % 1_000) + 1
        : null;
    const readAbilitySurfaceGeneration = (currentPhase as unknown as { coopV2SurfaceGeneration?: () => number })
      .coopV2SurfaceGeneration;
    const abilitySurfaceGeneration =
      semantic.operationClass === "ability" && typeof readAbilitySurfaceGeneration === "function"
        ? readAbilitySurfaceGeneration.call(currentPhase)
        : null;
    const handlerSurfaceGeneration =
      typeof readSurfaceGeneration === "function" ? readSurfaceGeneration.call(handler) : null;
    const surfaceGeneration =
      Number.isSafeInteger(handlerSurfaceGeneration) && (handlerSurfaceGeneration as number) > 0
        ? (handlerSurfaceGeneration as number)
        : (abilitySurfaceGeneration ?? authoritySurfaceGeneration);
    const semanticSurfaceInstance =
      Number.isSafeInteger(promptGeneration) && (promptGeneration ?? 0) > 0
        ? (promptGeneration as number)
        : semanticPhaseInstance;
    // Transitional UI modes (for example EVOLUTION_SCENE before its first visible HUD paint) legitimately
    // have no parsed wave yet. Emit the schema's explicit null instead of letting JSON.stringify omit the
    // required field and manufacture a fatal browser-evidence event.
    const displayedWave = globalScene.getDisplayedBiomeWaveIndex() ?? null;
    const phasePartyIndex = (currentPhase as unknown as { partyIndex?: unknown }).partyIndex;
    const interactionTargetPartySlot =
      semantic.operationClass === "ability" && Number.isSafeInteger(phasePartyIndex) && (phasePartyIndex as number) >= 0
        ? (phasePartyIndex as number)
        : null;
    const semanticDigestKey = [
      semantic.surfaceId,
      uiMode,
      semanticSurfaceInstance,
      `${epoch}:${wave}:${turn}`,
      displayedWave,
      selection.selectedOptionId ?? "",
      selection.optionIds?.join(",") ?? "",
      moveSlots == null ? "" : JSON.stringify(moveSlots),
      ownerSeat ?? "?",
      awaitingActionInput,
      inputBlocked,
      surfaceGeneration,
      mysteryEncounterType,
      interactionTargetPartySlot,
    ].join("|");
    const stateDigest = coop && battle != null ? semanticMechanicalDigest(semanticDigestKey).digest : null;

    const presentation = coopBrowserPresentationSnapshot();
    const probeKey = [
      semanticDigestKey,
      teamSpeciesIds?.join(",") ?? "",
      moveSlots == null ? "" : JSON.stringify(moveSlots),
      starterGridCandidates == null ? "" : JSON.stringify(starterGridCandidates),
      partySlots == null ? "" : JSON.stringify(partySlots),
      JSON.stringify(presentation),
      stateDigest,
    ].join("|");
    const now = Date.now();
    if (probeKey === lastSemanticProbe && now - lastSemanticProbeAt < 1_000) {
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
      connectionGenerations,
      localSeat,
      localRole,
      ownerSeat,
      seatsWithInput,
      selectedOptionId: selection.selectedOptionId,
      optionIds: selection.optionIds,
      optionCount: selection.optionCount,
      teamSpeciesIds,
      moveSlots,
      starterGridCandidates,
      partySlots,
      interactionTargetPartySlot,
      ready: { handlerActive: true, awaitingActionInput, inputBlocked },
      phase,
      phaseInstance: semanticSurfaceInstance,
      surfaceGeneration,
      // This is the parsed wave number from the visible top-right HUD label, not another read of
      // currentBattle. It catches a cosmetically stale renderer after mechanical V2 convergence.
      displayedWave,
      // Stable registry identity, not localized presentation text. This lets two real browsers
      // prove that an apparently matching Mystery surface is actually the same encounter and
      // lets the ten-wave gauntlet prove non-repeating event breadth.
      mysteryEncounterType,
      arena: {
        biomeId: globalScene.arena?.biomeId ?? null,
        weather: globalScene.arena?.weather?.weatherType ?? 0,
        terrain: globalScene.arena?.terrain?.terrainType ?? 0,
      },
      presentation,
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

// Showdown presentation is intentionally not part of the mechanical digest: two locales render different
// text while sharing one state. The dedicated browser journey must nevertheless prove that both real
// clients displayed the stream, rather than accepting silent checkpoint convergence. Observe each concrete
// long-lived presentation phase once; this is read-only and supplies no phase/scene mutation capability.
const observedPresentationPhases = new WeakSet<object>();
function observeShowdownPresentation(): void {
  try {
    const runtime = getCoopRuntime();
    if (runtime?.controller.isVersusSession() !== true) {
      return;
    }
    const phase = globalScene?.phaseManager?.getCurrentPhase();
    if (phase == null || observedPresentationPhases.has(phase)) {
      return;
    }
    const phaseName = phase.phaseName;
    const abilityVisible = globalScene.abilityBar?.isVisible() === true;
    const environment = {
      weather: globalScene.arena?.weather?.weatherType ?? 0,
      terrain: globalScene.arena?.terrain?.terrainType ?? 0,
    };
    const isAbility =
      abilityVisible && (phaseName === "ShowAbilityPhase" || phaseName === "CoopShowAbilityReplayPhase");
    const abilityPresentation = (
      phase as unknown as { getCoopPresentationIdentity?: () => Record<string, unknown> }
    ).getCoopPresentationIdentity?.();
    const environmentPresentation = (
      phase as unknown as {
        coopPresentation?: { source?: unknown; kind?: unknown; value?: unknown };
        getAnimationId?: () => unknown;
      }
    ).coopPresentation;
    const anim = (phase as unknown as { getAnimationId?: () => unknown }).getAnimationId?.();
    const isEnvironment =
      phaseName === "CommonAnimPhase"
      && environmentPresentation?.source === "environment"
      && (environmentPresentation.kind === "weather" || environmentPresentation.kind === "terrain")
      && Number.isSafeInteger(environmentPresentation.value)
      && Number.isSafeInteger(anim);
    if (!isAbility && !isEnvironment) {
      return;
    }
    observedPresentationPhases.add(phase);
    console.info(
      `${PRESENTATION_PREFIX}${JSON.stringify({
        version: 1,
        kind: isAbility ? "ability" : "environment",
        role: runtime.controller.role,
        epoch: runtime.controller.sessionEpoch,
        wave: globalScene.currentBattle.waveIndex,
        turn: globalScene.currentBattle.turn,
        phase: phaseName,
        abilityVisible,
        abilityPresentation: isAbility ? abilityPresentation : null,
        anim: Number.isSafeInteger(anim) ? anim : null,
        environmentPresentation: isEnvironment ? environmentPresentation : null,
        ...environment,
      })}`,
    );
  } catch {
    // The scene may be between battles. Ordinary page/observer diagnostics still own real failures.
  }
}

setInterval(() => {
  observeBoundSession();
  observeContinuationSurface();
  observeSemanticSurface();
  observeShowdownPresentation();
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

// Exact production input dispatch. InputsController emits input_down synchronously from the
// real Phaser keyboard listener, after the DOM keydown has been mapped to a game Button and
// before its 250 ms auto-repeat timer can fire. Observing that public event lets the browser
// driver release one physical key immediately instead of holding ACTION across slow Phaser
// frames and accidentally selecting the same UI twice.
interface BrowserInputEventSource {
  on(event: string, listener: (event: unknown) => void): unknown;
  off(event: string, listener: (event: unknown) => void): unknown;
}

let observedInputEventSource: BrowserInputEventSource | null = null;
let inputDispatchSeq = 0;
const observeInputDown = (event: unknown) => {
  const input = event as { controller_type?: unknown; button?: unknown } | null;
  inputDispatchSeq += 1;
  console.info(
    `[coop-browser:input-dispatch] ${JSON.stringify({
      seq: inputDispatchSeq,
      controllerType: typeof input?.controller_type === "string" ? input.controller_type : "unknown",
      button: typeof input?.button === "number" ? input.button : null,
      ...inputLayerSnapshot(),
    })}`,
  );
};

function observeInputDispatchSource() {
  const source = globalScene?.inputController?.events as unknown as BrowserInputEventSource | undefined;
  if (source == null || source === observedInputEventSource) {
    return;
  }
  observedInputEventSource?.off("input_down", observeInputDown);
  source.on("input_down", observeInputDown);
  observedInputEventSource = source;
}

// Input-LAYER diagnostics (read-only). The Game Speed attestation failure (run 29548390234)
// showed 12 dispatched keys with ZERO observed game reaction and could not tell WHICH layer
// dropped them: CDP -> DOM, DOM -> Phaser (paused/stalled loop), or Phaser -> game handler.
// A capture-phase window listener counts raw DOM keydowns (nothing can stop capture on
// window), and the Phaser loop frame counter proves whether the game loop is stepping.
let domKeydownCount = 0;
let lastDomKey = "";
let lastDomKeydownFrame = -1;
const heldDomKeys = new Set<string>();
if (typeof window !== "undefined") {
  window.addEventListener(
    "keydown",
    event => {
      domKeydownCount += 1;
      lastDomKey = event.key;
      lastDomKeydownFrame = globalScene?.game?.loop?.frame ?? -1;
      heldDomKeys.add(event.code || event.key);
    },
    { capture: true, passive: true },
  );
  window.addEventListener(
    "keyup",
    event => {
      heldDomKeys.delete(event.code || event.key);
    },
    { capture: true, passive: true },
  );
  // Do not capture descendant blur events: submitting a registration <input> blurs that element while the
  // physical Enter key is still down. Only a real window-focus loss invalidates the held-key observation.
  window.addEventListener("blur", () => heldDomKeys.clear(), { passive: true });
}

function inputLayerSnapshot() {
  return {
    domKeys: domKeydownCount,
    downKeys: heldDomKeys.size,
    keydownFrame: lastDomKeydownFrame,
    lastKey: lastDomKey,
    frame: globalScene?.game?.loop?.frame ?? -1,
    vis: typeof document === "undefined" ? "?" : document.visibilityState,
    foc: typeof document !== "undefined" && document.hasFocus(),
  } as const;
}

setInterval(() => {
  try {
    observeInputDispatchSource();
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

// Input-health heartbeat: idle pages stay silent, while a held public key emits once on raw DOM
// arrival and once per actual Phaser update. This makes the observer a read-only clock for the
// keyboard driver: compositor requestAnimationFrame can run at 60 FPS while a CPU-dilated Phaser
// loop runs at 3 FPS, so only the game loop's own frame counter proves that a key was down during
// an update. During a dead-key window the same evidence classifies the failed layer.
let lastHealthDomKeys = 0;
let lastHealthFrame = -1;
let lastHealthDownKeys = 0;
let pendingInputSettleFrame = -1;
let inputHealthSeq = 0;
setInterval(() => {
  try {
    const snapshot = inputLayerSnapshot();
    const frameAdvancing = snapshot.frame !== lastHealthFrame;
    const domKeysChanged = snapshot.domKeys !== lastHealthDomKeys;
    if (domKeysChanged) {
      // A raw key can synchronously advance MESSAGE A into MESSAGE B inside one Phaser update. The
      // browser driver must not spend B's key in that same update: production's input guards can quite
      // correctly discard it, while an append-only semantic observer would otherwise mark B consumed
      // forever. Keep one read-only receipt armed until the game's OWN frame counter crosses the keydown
      // frame. This is pacing evidence only; it neither schedules nor advances the scene.
      pendingInputSettleFrame = snapshot.keydownFrame;
    }
    const heldFrameAdvanced = snapshot.downKeys > 0 && frameAdvancing;
    const holdStateChanged = snapshot.downKeys !== lastHealthDownKeys;
    const inputFrameSettled =
      pendingInputSettleFrame >= 0 && snapshot.downKeys === 0 && snapshot.frame > pendingInputSettleFrame;
    lastHealthFrame = snapshot.frame;
    if (!domKeysChanged && !heldFrameAdvanced && !holdStateChanged && !inputFrameSettled) {
      return;
    }
    lastHealthDomKeys = snapshot.domKeys;
    lastHealthDownKeys = snapshot.downKeys;
    inputHealthSeq += 1;
    console.info(
      `[coop-browser:input-health] ${JSON.stringify({
        seq: inputHealthSeq,
        ...snapshot,
        frameAdvancing,
        inputFrameSettled,
      })}`,
    );
    if (inputFrameSettled) {
      pendingInputSettleFrame = -1;
    }
  } catch {
    /* diagnostics only - never fail the observer */
  }
}, 25);

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
