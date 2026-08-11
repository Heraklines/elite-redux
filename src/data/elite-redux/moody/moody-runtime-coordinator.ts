import {
  applyMoodyRuntimeStateDeltas,
  MOODY_RUNTIME_EFFECT_BY_ID,
  type MoodyRuntimeCommand,
  type MoodyRuntimeEvent,
  type MoodyRuntimeStage,
  type MoodyRuntimeState,
  type MoodyRuntimeValue,
  resolveMoodyRuntimeEffect,
} from "#data/elite-redux/moody/moody-runtime-meta";
import type { MoodyBoonProgress, MoodyModeSaveData } from "#data/elite-redux/moody/moody-types";

export type MoodyCoordinatorDomain = "progression" | "economy" | "reward" | "capture";

export type MoodyProgressionCommandKind =
  | "ledger-mark-earned"
  | "queue-post-battle-hunter-choice"
  | "increase-team-max-hp"
  | "offer-partial-vitamin-transfer"
  | "choose-progression-imprints"
  | "store-apex-segment"
  | "reveal-cursed-stack"
  | "set-trainer-roster-size"
  | "revive-with-second-act"
  | "set-dormant-boons"
  | "set-counter-weight"
  | "revive-boss-roster"
  | "set-future-enemy-stat-multiplier"
  | "replace-party-moves-until-next-biome"
  | "apply-item-set-bonuses";

export type MoodyEconomyCommandKind =
  | "grant-money"
  | "purchase-with-blood-debt"
  | "set-market-price"
  | "set-item-effect-value"
  | "disable-automatic-biome-healing";

export type MoodyRewardCommandKind =
  | "offer-feasible-contracts"
  | "grant-contract-reward"
  | "reroll-reward-options"
  | "generate-upcycled-reward"
  | "apply-pre-luck-rarity-uplifts"
  | "apply-pre-luck-rarity-penalty"
  | "set-reward-replacement-cost"
  | "hide-beneficial-boon-offer";

export type MoodyCaptureCommandKind = "guarantee-collectible-traits" | "set-capture-rate-multiplier";

export type MoodyCoordinatorOverlapMode = "legacy-scene-compatible" | "coordinator-owned";

export interface MoodyCoordinatorOptions {
  readonly overlapMode?: MoodyCoordinatorOverlapMode;
}

export const MOODY_COORDINATOR_OVERLAP_POLICY = {
  defaultMode: "legacy-scene-compatible",
  overlappingPaths: [
    {
      effectId: "compound-interest",
      coordinatorEvent: "wave-completed",
      coordinatorCommand: "grant-money",
      legacyOwner: "retired; boss reward multiplier is fixed at 1",
      defaultResolution: "coordinator-owned; pays current-money interest and persists the run cap",
    },
    {
      effectId: "recruiter-s-eye",
      coordinatorEvent: "wild-encounter-generated",
      coordinatorCommand: "set-capture-rate-multiplier",
      legacyOwner: "src/data/elite-redux/moody/moody-scene-adapter.ts:getMoodyCaptureMultiplier",
      defaultResolution: "legacy-scene-owned; coordinator still applies collectible-trait assignment only",
    },
    {
      effectId: "field-runtime curse lane",
      coordinatorEvent: "multiple",
      coordinatorCommand: "multiple",
      legacyOwner: "src/data/elite-redux/moody/moody-runtime-field-engine.ts",
      defaultResolution: "field-runtime-owned; coordinator skips the overlapping effect entirely",
    },
  ],
  scenePassiveOutputs: [
    "damage",
    "max-hp-and-stats",
    "healing",
    "priority",
    "accuracy",
    "sleep-action",
    "pp-cost",
    "experience",
  ],
  coordinatorOwnedRequirement:
    "Use coordinator-owned only after the parent disconnects the matching legacy scene hook for the same event.",
} as const;

export const MOODY_COORDINATOR_LEGACY_FIELD_OWNED_EFFECT_IDS = new Set([
  "public-enemy",
  "mood-swing",
  "nemesis-protocol",
  "blood-moon",
  "reverse-snowball",
  "cursed-draft",
  "entropy",
  "feedback-loop",
]);

export type MoodyCoordinatorCommand =
  | {
      readonly domain: "progression";
      readonly effectId: string;
      readonly kind: MoodyProgressionCommandKind;
      readonly data: Readonly<Record<string, MoodyRuntimeValue>>;
    }
  | {
      readonly domain: "economy";
      readonly effectId: string;
      readonly kind: MoodyEconomyCommandKind;
      readonly data: Readonly<Record<string, MoodyRuntimeValue>>;
    }
  | {
      readonly domain: "reward";
      readonly effectId: string;
      readonly kind: MoodyRewardCommandKind;
      readonly data: Readonly<Record<string, MoodyRuntimeValue>>;
    }
  | {
      readonly domain: "capture";
      readonly effectId: string;
      readonly kind: MoodyCaptureCommandKind;
      readonly data: Readonly<Record<string, MoodyRuntimeValue>>;
    };

export interface MoodyCoordinatorExecutors {
  readonly progression: (command: Extract<MoodyCoordinatorCommand, { domain: "progression" }>) => void | Promise<void>;
  readonly economy: (command: Extract<MoodyCoordinatorCommand, { domain: "economy" }>) => void | Promise<void>;
  readonly reward: (command: Extract<MoodyCoordinatorCommand, { domain: "reward" }>) => void | Promise<void>;
  readonly capture: (command: Extract<MoodyCoordinatorCommand, { domain: "capture" }>) => void | Promise<void>;
}

export interface MoodyCoordinatorEffect {
  readonly effectId: string;
  readonly stage: MoodyRuntimeStage;
  readonly state?: MoodyRuntimeState;
}

export interface MoodyCoordinatorState {
  readonly effects: readonly MoodyCoordinatorEffect[];
}

export type MoodyCoordinatorResetCadence = "battle" | "reward-screen" | "biome" | "ten-wave-segment" | "run";

export interface MoodyCoordinatorResetRule {
  readonly effectId: string;
  readonly cadence: MoodyCoordinatorResetCadence;
  readonly paths: readonly (`counters.${string}` | `flags.${string}` | `values.${string}`)[];
}

const RUNTIME_VALUES_SAVE_KEY = "__moodyRuntimeValuesV1";

export const MOODY_COORDINATOR_SAVE_CONTRACT = {
  version: 1,
  boonContainer: "MoodyModeSaveData.boons[].progress",
  curseContainer: "MoodyModeSaveData.curses[].progress",
  counters: "progress.counters (native numeric record)",
  flags: "progress.flags (native boolean record)",
  values: `progress.values.${RUNTIME_VALUES_SAVE_KEY} (JSON string containing the structured runtime value record)`,
  moduleGlobalState: false,
} as const;

export const MOODY_COORDINATOR_RESET_RULES: readonly MoodyCoordinatorResetRule[] = [
  { effectId: "warranty", cadence: "battle", paths: ["counters.activationsThisBattle"] },
  {
    effectId: "bounty-board",
    cadence: "ten-wave-segment",
    paths: ["values.activeContract", "counters.contractProgress"],
  },
  { effectId: "recycler", cadence: "reward-screen", paths: ["flags.recyclerUsedThisScreen"] },
  { effectId: "recruiter-s-eye", cadence: "biome", paths: ["flags.recruiterUsedThisBiome"] },
  {
    effectId: "blood-market",
    cadence: "biome",
    paths: ["flags.bloodMarketUsedThisBiome", "values.bloodDebts"],
  },
  { effectId: "flawless-ledger", cadence: "biome", paths: ["flags.ledgerFailureShieldUsed"] },
  { effectId: "time-loop", cadence: "ten-wave-segment", paths: ["counters.segmentUses"] },
  { effectId: "mirror-theft", cadence: "battle", paths: ["counters.mirrorUses"] },
  { effectId: "phase-shift", cadence: "battle", paths: ["flags.stablePhasePendingHit"] },
  {
    effectId: "inversion-window",
    cadence: "battle",
    paths: ["counters.offensiveInversions", "counters.defensiveInversions"],
  },
  {
    effectId: "cursed-inventory",
    cadence: "biome",
    paths: ["values.cursedInventoryPokemonId", "values.cursedInventoryStackId"],
  },
  { effectId: "public-enemy", cadence: "battle", paths: ["flags.secondActAvailable"] },
  { effectId: "blood-moon", cadence: "battle", paths: ["flags.bloodMoonUsed"] },
  { effectId: "cursed-draft", cadence: "reward-screen", paths: ["values.hiddenOfferId"] },
  { effectId: "entropy", cadence: "biome", paths: ["values.entropyAssignments"] },
  {
    effectId: "feedback-loop",
    cadence: "battle",
    paths: ["counters.lastFeedbackTriggerCount", "counters.lastFeedbackDamage"],
  },
] as const;

type StackMap = Readonly<Record<string, readonly string[]>>;
type NumberMap = Readonly<Record<string, number>>;

export type MoodyCoordinatorEvent =
  | {
      readonly type: "wave-completed";
      readonly seed: number;
      readonly waveIndex: number;
      readonly victory: boolean;
      readonly isBoss: boolean;
      readonly alliedFaintCount: number;
      readonly partySize: number;
      readonly money: number;
      readonly compoundInterestCapRemaining: number;
      readonly biomeFailureShieldAvailable: boolean;
      readonly activeBoonInstanceIds: readonly string[];
    }
  | {
      readonly type: "biome-transition";
      readonly seed: number;
      readonly waveIndex: number;
      readonly money: number;
      readonly compoundInterestCapRemaining: number;
      readonly patientCapitalRate: number;
      readonly usageRanking: readonly string[];
      readonly eligibleStacksByPokemon: StackMap;
      readonly partyMoves: StackMap;
      readonly eligibleReplacementsByMove: StackMap;
      readonly apexPokemonId?: string;
    }
  | {
      readonly type: "market-price-query";
      readonly seed: number;
      readonly price: number;
      readonly isHealingItem: boolean;
      readonly itemCopyIndex?: number;
      readonly itemEffectValue?: number;
      readonly duplicateScale?: number;
    }
  | {
      readonly type: "market-purchase";
      readonly seed: number;
      readonly itemTier: number;
      readonly payment: "money" | "blood";
      readonly debtRate: number;
      readonly usageRanking: readonly string[];
      readonly maxHpByPokemon: NumberMap;
    }
  | {
      readonly type: "item-set-query";
      readonly seed: number;
      readonly ownedDistinctItemIds: readonly string[];
      readonly chosenSetId: string | null;
    }
  | {
      readonly type: "reward-generated";
      readonly seed: number;
      readonly slotCount: number;
      readonly offerIds: readonly string[];
    }
  | {
      readonly type: "reward-recycle";
      readonly seed: number;
      readonly destroyedIndices: readonly number[];
      readonly remainingIndices: readonly number[];
      readonly originalRarities: readonly number[];
      readonly destroyedCategory: string;
    }
  | {
      readonly type: "reward-replacement-query";
      readonly seed: number;
      readonly operation: "reroll" | "recycle" | "replace";
      readonly baseCost: number;
      readonly baseSacrifices: number;
    }
  | {
      readonly type: "wild-encounter-generated";
      readonly seed: number;
      readonly missingTraits: readonly string[];
      readonly traitRarity: NumberMap;
      readonly completionistCatchMultiplier: number;
    }
  | {
      readonly type: "typed-enemy-defeated";
      readonly seed: number;
      readonly matchesMarkedType: boolean;
      readonly bossSegments: number;
    }
  | {
      readonly type: "hunter-choice-resolved";
      readonly seed: number;
      readonly choice: "damageBonus" | "resistanceBonus" | "captureBonus";
      readonly amount: number;
    }
  | {
      readonly type: "contract-draft";
      readonly seed: number;
      readonly feasibleContractIds: readonly string[];
    }
  | {
      readonly type: "contract-completed";
      readonly seed: number;
      readonly contractId: string;
    }
  | {
      readonly type: "academy-graduated";
      readonly seed: number;
    }
  | {
      readonly type: "pokemon-permanently-removed";
      readonly seed: number;
      readonly eligibleImprints: readonly string[];
      readonly partySlot: number;
      readonly boundPartySlot: number;
    }
  | {
      readonly type: "segmented-boss-defeated";
      readonly seed: number;
      readonly pokemonId: string;
    }
  | {
      readonly type: "trainer-roster-generated";
      readonly seed: number;
      readonly isEligibleTrainer: boolean;
      readonly isBossTrainer: boolean;
      readonly baseRosterSize: number;
      readonly maxRosterSize: number;
    }
  | {
      readonly type: "boss-final-pokemon-fainted";
      readonly seed: number;
      readonly pokemonId: string;
    }
  | {
      readonly type: "boss-roster-defeated";
      readonly seed: number;
      readonly pokemonIds: readonly string[];
    }
  | {
      readonly type: "enemy-boon-generation";
      readonly seed: number;
      readonly baseCounterWeight: number;
      readonly isBoss: boolean;
      readonly topThreatPokemonId: string;
    };

export interface MoodyCoordinatorResolution {
  readonly state: MoodyCoordinatorState;
  readonly commands: readonly MoodyCoordinatorCommand[];
}

export interface MoodyCoordinatorHookSite {
  readonly event: MoodyCoordinatorEvent["type"] | "capture-commit";
  readonly file: string;
  readonly symbol: string;
  readonly currentLine: number;
  readonly placement: string;
}

export const MOODY_COORDINATOR_PARENT_HOOKS: readonly MoodyCoordinatorHookSite[] = [
  {
    event: "wave-completed",
    file: "src/phases/battle-end-phase.ts",
    symbol: "BattleEndPhase.doStart",
    currentLine: 232,
    placement: "After victory is authoritative and before post-battle modifiers lapse.",
  },
  {
    event: "contract-draft",
    file: "src/phases/victory-phase.ts",
    symbol: "VictoryPhase.doStart",
    currentLine: 342,
    placement: "Beside SelectMoodyBoonPhase scheduling after the boss result is committed.",
  },
  {
    event: "biome-transition",
    file: "src/phases/new-biome-encounter-phase.ts",
    symbol: "NewBiomeEncounterPhase.prepareHostMechanicalState",
    currentLine: 238,
    placement:
      "Before resetBattleAndWaveData so reports and temporary move replacements see the departing biome state.",
  },
  {
    event: "market-price-query",
    file: "src/phases/biome-shop-phase.ts",
    symbol: "BiomeShopPhase.onSelect",
    currentLine: 482,
    placement: "Before affordability is checked against option.cost.",
  },
  {
    event: "market-purchase",
    file: "src/phases/biome-shop-phase.ts",
    symbol: "BiomeShopPhase.applyModifier",
    currentLine: 1662,
    placement: "After the atomic paid purchase commits and before achievement recording returns.",
  },
  {
    event: "item-set-query",
    file: "src/battle-scene.ts",
    symbol: "BattleScene.addModifier",
    currentLine: 3876,
    placement:
      "After a persistent modifier is successfully added and updateModifiers has settled; canonicalize modifier type and vitamin variant IDs before coordinating.",
  },
  {
    event: "item-set-query",
    file: "src/battle-scene.ts",
    symbol: "BattleScene.removeModifier",
    currentLine: 4408,
    placement:
      "After a persistent modifier is successfully removed; rescan distinct canonical set-piece IDs so stale set effects are withdrawn.",
  },
  {
    event: "reward-generated",
    file: "src/phases/select-modifier-phase.ts",
    symbol: "SelectModifierPhase.getModifierTypeOptions",
    currentLine: 1922,
    placement: "After base options are generated but before Luck-derived presentation is finalized.",
  },
  {
    event: "reward-replacement-query",
    file: "src/phases/select-modifier-phase.ts",
    symbol: "SelectModifierPhase.rerollModifiers",
    currentLine: 1023,
    placement: "Before reroll affordability, money mutation, or successor phase construction.",
  },
  {
    event: "wild-encounter-generated",
    file: "src/phases/encounter-phase.ts",
    symbol: "EncounterPhase.doEncounter",
    currentLine: 1247,
    placement: "After randomSpecies selects the wild species and before addEnemyPokemon constructs collectible traits.",
  },
  {
    event: "capture-commit",
    file: "src/phases/attempt-capture-phase.ts",
    symbol: "AttemptCapturePhase.doStart",
    currentLine: 493,
    placement:
      "Immediately before addPlayerPokemon commits the caught instance; use the encounter's stored Recruiter's Eye assignment.",
  },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function decodeRuntimeValues(progress: MoodyBoonProgress | undefined): Readonly<Record<string, MoodyRuntimeValue>> {
  const primitiveValues = Object.fromEntries(
    Object.entries(progress?.values ?? {}).filter(([key]) => key !== RUNTIME_VALUES_SAVE_KEY),
  );
  const encoded = progress?.values?.[RUNTIME_VALUES_SAVE_KEY];
  if (typeof encoded !== "string") {
    return primitiveValues;
  }
  try {
    const decoded = JSON.parse(encoded);
    return isRecord(decoded)
      ? { ...primitiveValues, ...(decoded as Record<string, MoodyRuntimeValue>) }
      : primitiveValues;
  } catch {
    return primitiveValues;
  }
}

function stateFromProgress(progress: MoodyBoonProgress | undefined): MoodyRuntimeState {
  return {
    counters: { ...progress?.counters },
    flags: { ...progress?.flags },
    values: decodeRuntimeValues(progress),
  };
}

function progressWithState(progress: MoodyBoonProgress | undefined, state: MoodyRuntimeState): MoodyBoonProgress {
  const existingValues = Object.fromEntries(
    Object.entries(progress?.values ?? {}).filter(([key]) => key !== RUNTIME_VALUES_SAVE_KEY),
  );
  return {
    counters: { ...state.counters },
    flags: { ...state.flags },
    values: {
      ...existingValues,
      [RUNTIME_VALUES_SAVE_KEY]: JSON.stringify(state.values ?? {}),
    },
  };
}

export function hydrateMoodyCoordinatorState(save: MoodyModeSaveData): MoodyCoordinatorState {
  return {
    effects: [
      ...save.boons
        .filter(boon => !boon.dormant)
        .map(boon => ({
          effectId: boon.boonId,
          stage: boon.rank === 1 ? "base" : boon.rank === 2 ? "rank-two" : (boon.evolutionId ?? "rank-two"),
          state: stateFromProgress(boon.progress),
        })),
      ...save.curses.map(curse => ({
        effectId: curse.curseId,
        stage: "base",
        state: stateFromProgress(curse.progress),
      })),
    ],
  };
}

export function persistMoodyCoordinatorState(
  save: MoodyModeSaveData,
  coordinator: MoodyCoordinatorState,
): MoodyModeSaveData {
  const stateByEffect = new Map(coordinator.effects.map(effect => [effect.effectId, effect.state ?? {}]));
  return {
    ...structuredClone(save),
    boons: save.boons.map(boon => {
      const copy = structuredClone(boon);
      return stateByEffect.has(boon.boonId)
        ? { ...copy, progress: progressWithState(boon.progress, stateByEffect.get(boon.boonId)!) }
        : copy;
    }),
    curses: save.curses.map(curse => {
      const copy = structuredClone(curse);
      return stateByEffect.has(curse.curseId)
        ? { ...copy, progress: progressWithState(curse.progress, stateByEffect.get(curse.curseId)!) }
        : copy;
    }),
  };
}

export function resetMoodyCoordinatorCadence(
  state: MoodyCoordinatorState,
  cadence: MoodyCoordinatorResetCadence,
): MoodyCoordinatorState {
  const rules = MOODY_COORDINATOR_RESET_RULES.filter(rule => rule.cadence === cadence);
  return {
    effects: state.effects.map(effect => {
      const paths = rules.filter(rule => rule.effectId === effect.effectId).flatMap(rule => rule.paths);
      if (paths.length === 0) {
        return effect;
      }
      return {
        ...effect,
        state: applyMoodyRuntimeStateDeltas(
          effect.state ?? {},
          paths.map(path => ({ op: "delete" as const, path })),
        ),
      };
    }),
  };
}

const progressionKinds = new Set<MoodyProgressionCommandKind>([
  "ledger-mark-earned",
  "queue-post-battle-hunter-choice",
  "increase-team-max-hp",
  "offer-partial-vitamin-transfer",
  "choose-progression-imprints",
  "store-apex-segment",
  "reveal-cursed-stack",
  "set-trainer-roster-size",
  "revive-with-second-act",
  "set-dormant-boons",
  "set-counter-weight",
  "revive-boss-roster",
  "set-future-enemy-stat-multiplier",
  "replace-party-moves-until-next-biome",
  "apply-item-set-bonuses",
]);
const economyKinds = new Set<MoodyEconomyCommandKind>([
  "grant-money",
  "purchase-with-blood-debt",
  "set-market-price",
  "set-item-effect-value",
  "disable-automatic-biome-healing",
]);
const rewardKinds = new Set<MoodyRewardCommandKind>([
  "offer-feasible-contracts",
  "grant-contract-reward",
  "reroll-reward-options",
  "generate-upcycled-reward",
  "apply-pre-luck-rarity-uplifts",
  "apply-pre-luck-rarity-penalty",
  "set-reward-replacement-cost",
  "hide-beneficial-boon-offer",
]);
const captureKinds = new Set<MoodyCaptureCommandKind>(["guarantee-collectible-traits", "set-capture-rate-multiplier"]);

export function decodeMoodyCoordinatorCommand(effectId: string, source: MoodyRuntimeCommand): MoodyCoordinatorCommand {
  if (progressionKinds.has(source.kind as MoodyProgressionCommandKind)) {
    return { domain: "progression", effectId, kind: source.kind as MoodyProgressionCommandKind, data: source.data };
  }
  if (economyKinds.has(source.kind as MoodyEconomyCommandKind)) {
    return { domain: "economy", effectId, kind: source.kind as MoodyEconomyCommandKind, data: source.data };
  }
  if (rewardKinds.has(source.kind as MoodyRewardCommandKind)) {
    return { domain: "reward", effectId, kind: source.kind as MoodyRewardCommandKind, data: source.data };
  }
  if (captureKinds.has(source.kind as MoodyCaptureCommandKind)) {
    return { domain: "capture", effectId, kind: source.kind as MoodyCaptureCommandKind, data: source.data };
  }
  throw new Error(`Moody coordinator has no typed executor contract for ${effectId}:${source.kind}`);
}

function runtimeEvent(
  effectId: string,
  event: MoodyCoordinatorEvent,
  effectState: MoodyRuntimeState | undefined,
): MoodyRuntimeEvent | null {
  const seed = event.seed;
  switch (event.type) {
    case "wave-completed": {
      if (effectId === "bounty-board" && (!event.victory || event.alliedFaintCount > 0)) {
        return { kind: "contract-failed", seed, data: {} };
      }
      if (effectId === "compound-interest" && event.victory && event.isBoss) {
        return {
          kind: "boss-defeated",
          seed,
          data: { money: event.money, capRemaining: event.compoundInterestCapRemaining },
        };
      }
      if (effectId === "flawless-ledger" && event.victory) {
        return {
          kind: "wave-completed",
          seed,
          data: {
            alliedFaintCount: event.alliedFaintCount,
            biomeFailureShieldAvailable: event.biomeFailureShieldAvailable,
          },
        };
      }
      if (effectId === "hollow-victory" && event.victory) {
        return { kind: "battle-completed", seed, data: { alliedFaintCount: event.alliedFaintCount } };
      }
      if (effectId === "reverse-snowball" && event.victory) {
        return {
          kind: "battle-completed",
          seed,
          data: { partySize: event.partySize, alliedFaintCount: event.alliedFaintCount },
        };
      }
      if (effectId === "mood-swing" && event.victory && event.waveIndex % 10 === 0) {
        return {
          kind: "ten-wave-boundary",
          seed,
          data: { waveIndex: event.waveIndex, activeBoonInstanceIds: event.activeBoonInstanceIds },
        };
      }
      return null;
    }
    case "biome-transition": {
      if (effectId === "compound-interest") {
        return {
          kind: "biome-transition",
          seed,
          data: {
            money: event.money,
            patientRate: event.patientCapitalRate,
            capRemaining: event.compoundInterestCapRemaining,
          },
        };
      }
      if (effectId === "cursed-inventory") {
        return {
          kind: "biome-transition",
          seed,
          data: { usageRanking: event.usageRanking, eligibleStacksByPokemon: event.eligibleStacksByPokemon },
        };
      }
      if (effectId === "entropy") {
        return {
          kind: "biome-transition",
          seed,
          data: { partyMoves: event.partyMoves, eligibleReplacementsByMove: event.eligibleReplacementsByMove },
        };
      }
      if (effectId === "apex-plunder" && event.apexPokemonId != null) {
        return { kind: "biome-transition", seed, data: { pokemonId: event.apexPokemonId } };
      }
      if (effectId === "mortal-wounds") {
        return { kind: "biome-transition", seed, data: {} };
      }
      if (effectId === "the-long-night") {
        return { kind: "biome-heal-query", seed, data: {} };
      }
      return null;
    }
    case "market-price-query": {
      if (effectId === "thin-wallet") {
        return { kind: "market-price-query", seed, data: { price: event.price } };
      }
      if (effectId === "the-long-night") {
        return { kind: "market-price-query", seed, data: { price: event.price, isHealingItem: event.isHealingItem } };
      }
      if (
        effectId === "jealous-relics"
        && event.itemCopyIndex != null
        && event.itemEffectValue != null
        && event.duplicateScale != null
      ) {
        return {
          kind: "item-effect-query",
          seed,
          data: {
            copyIndex: event.itemCopyIndex,
            effectValue: event.itemEffectValue,
            duplicateScale: event.duplicateScale,
          },
        };
      }
      return null;
    }
    case "market-purchase": {
      if (
        effectId === "blood-market"
        && event.payment === "blood"
        && effectState?.flags?.bloodMarketUsedThisBiome !== true
      ) {
        return {
          kind: "blood-market-purchase",
          seed,
          data: {
            itemTier: event.itemTier,
            debtRate: event.debtRate,
            usageRanking: event.usageRanking,
            maxHpByPokemon: event.maxHpByPokemon,
          },
        };
      }
      if (effectId === "compound-interest") {
        return { kind: "market-purchase", seed, data: {} };
      }
      return null;
    }
    case "item-set-query":
      return effectId === "set-collector"
        ? {
            kind: "item-set-query",
            seed,
            data: {
              ownedDistinctItemIds: event.ownedDistinctItemIds,
              chosenSetId: event.chosenSetId,
            },
          }
        : null;
    case "reward-generated": {
      if (effectId === "flawless-ledger") {
        return { kind: "reward-generated", seed, data: { slotCount: event.slotCount } };
      }
      if (effectId === "hollow-victory") {
        return { kind: "reward-generated", seed, data: {} };
      }
      if (effectId === "cursed-draft") {
        return { kind: "boon-draft-generated", seed, data: { offerIds: event.offerIds } };
      }
      return null;
    }
    case "reward-recycle":
      return effectId === "recycler"
        ? {
            kind: "reward-recycle",
            seed,
            data: {
              destroyedIndices: event.destroyedIndices,
              remainingIndices: event.remainingIndices,
              originalRarities: event.originalRarities,
              destroyedCategory: event.destroyedCategory,
            },
          }
        : null;
    case "reward-replacement-query":
      return effectId === "no-takebacks"
        ? {
            kind: "reward-replacement-query",
            seed,
            data: { operation: event.operation, baseCost: event.baseCost, baseSacrifices: event.baseSacrifices },
          }
        : null;
    case "wild-encounter-generated":
      return effectId === "recruiter-s-eye"
        ? {
            kind: "wild-encounter-generated",
            seed,
            data: {
              missingTraits: event.missingTraits,
              traitRarity: event.traitRarity,
              completionistCatchMultiplier: event.completionistCatchMultiplier,
            },
          }
        : null;
    case "typed-enemy-defeated":
      return effectId === "hunter-s-mark"
        ? {
            kind: "typed-enemy-defeated",
            seed,
            data: { matchesMarkedType: event.matchesMarkedType, bossSegments: event.bossSegments },
          }
        : null;
    case "hunter-choice-resolved":
      return effectId === "hunter-s-mark"
        ? { kind: "hunter-choice-resolved", seed, data: { choice: event.choice, amount: event.amount } }
        : null;
    case "contract-draft":
      return effectId === "bounty-board"
        ? { kind: "contract-draft", seed, data: { feasibleContractIds: event.feasibleContractIds } }
        : null;
    case "contract-completed":
      return effectId === "bounty-board"
        ? { kind: "contract-completed", seed, data: { contractId: event.contractId } }
        : null;
    case "academy-graduated":
      return effectId === "bench-academy" ? { kind: "academy-graduated", seed, data: {} } : null;
    case "pokemon-permanently-removed":
      return effectId === "legacy-slot"
        ? {
            kind: "pokemon-permanently-removed",
            seed,
            data: {
              eligibleImprints: event.eligibleImprints,
              partySlot: event.partySlot,
              boundPartySlot: event.boundPartySlot,
            },
          }
        : null;
    case "segmented-boss-defeated":
      return effectId === "apex-plunder"
        ? { kind: "segmented-boss-defeated", seed, data: { pokemonId: event.pokemonId } }
        : null;
    case "trainer-roster-generated":
      return effectId === "public-enemy"
        ? {
            kind: "trainer-roster-generated",
            seed,
            data: {
              isEligibleTrainer: event.isEligibleTrainer,
              isBossTrainer: event.isBossTrainer,
              baseRosterSize: event.baseRosterSize,
              maxRosterSize: event.maxRosterSize,
            },
          }
        : null;
    case "boss-final-pokemon-fainted":
      return effectId === "public-enemy"
        ? { kind: "boss-final-pokemon-fainted", seed, data: { pokemonId: event.pokemonId } }
        : null;
    case "boss-roster-defeated":
      return effectId === "blood-moon"
        ? { kind: "boss-roster-defeated", seed, data: { pokemonIds: event.pokemonIds } }
        : null;
    case "enemy-boon-generation":
      return effectId === "nemesis-protocol"
        ? {
            kind: "enemy-boon-generation",
            seed,
            data: {
              baseCounterWeight: event.baseCounterWeight,
              isBoss: event.isBoss,
              topThreatPokemonId: event.topThreatPokemonId,
            },
          }
        : null;
  }
}

export function coordinateMoodyRuntime(
  inputState: MoodyCoordinatorState,
  event: MoodyCoordinatorEvent,
  options: MoodyCoordinatorOptions = {},
): MoodyCoordinatorResolution {
  const commands: MoodyCoordinatorCommand[] = [];
  let routedEvent = event;
  const overlapMode = options.overlapMode ?? MOODY_COORDINATOR_OVERLAP_POLICY.defaultMode;
  const effects = inputState.effects.map(effect => {
    if (MOODY_RUNTIME_EFFECT_BY_ID.get(effect.effectId)?.status === "blocked") {
      return effect;
    }
    if (
      overlapMode === "legacy-scene-compatible"
      && MOODY_COORDINATOR_LEGACY_FIELD_OWNED_EFFECT_IDS.has(effect.effectId)
    ) {
      return effect;
    }
    const routed = runtimeEvent(effect.effectId, routedEvent, effect.state);
    if (routed == null) {
      return effect;
    }
    const resolution = resolveMoodyRuntimeEffect(effect.effectId, effect.stage, routed, effect.state ?? {});
    const decoded = resolution.commands
      .map(command => decodeMoodyCoordinatorCommand(effect.effectId, command))
      .filter(
        command =>
          overlapMode === "coordinator-owned"
          || !(command.effectId === "recruiter-s-eye" && command.kind === "set-capture-rate-multiplier"),
      );
    commands.push(...decoded);
    if (routedEvent.type === "market-price-query") {
      const priceCommand = decoded.find(command => command.kind === "set-market-price");
      const nextPrice = priceCommand?.data.price;
      if (typeof nextPrice === "number") {
        routedEvent = { ...routedEvent, price: nextPrice };
      }
    }
    const nextState = applyMoodyRuntimeStateDeltas(effect.state ?? {}, resolution.stateDeltas);
    if (effect.effectId === "blood-market" && event.type === "market-purchase" && event.payment === "blood") {
      return {
        ...effect,
        state: {
          ...nextState,
          flags: { ...nextState.flags, bloodMarketUsedThisBiome: true },
        },
      };
    }
    return { ...effect, state: nextState };
  });
  return { state: { effects }, commands };
}

export async function executeMoodyCoordinatorCommands(
  commands: readonly MoodyCoordinatorCommand[],
  executors: MoodyCoordinatorExecutors,
): Promise<void> {
  for (const command of commands) {
    await executors[command.domain](command as never);
  }
}
