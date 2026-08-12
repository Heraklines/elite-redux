import {
  coordinateMoodyRuntime,
  hydrateMoodyCoordinatorState,
  type MoodyCoordinatorCommand,
  type MoodyCoordinatorEvent,
  type MoodyCoordinatorOptions,
  type MoodyCoordinatorResetCadence,
  persistMoodyCoordinatorState,
  resetMoodyCoordinatorCadence,
} from "#data/elite-redux/moody/moody-runtime-coordinator";
import { getMoodyModeSaveData, getMoodyModeState } from "#data/elite-redux/moody/moody-state";
import type { MoodyModeSaveData } from "#data/elite-redux/moody/moody-types";

export interface MoodyLivePokemonPort {
  readonly id: string;
  addMaxHpFraction(fraction: number): void;
  applyHpDebt(amount: number): void;
  revive(hpFraction: number, extraHealthSegments: number, allStatStages: number): void;
  clearNegativeStages(): void;
  clearMajorStatus(): void;
  replaceMove(originalMoveId: string, replacementMoveId: string): void;
}

export interface MoodyLiveRewardOptionPort {
  readonly id: string;
  getTier(): number;
  setTier(tier: number): void;
  getQuantity(): number;
  setQuantity(quantity: number): void;
  reroll(
    minimumTier: number,
    excludedCategory: string | null,
    options?: { readonly improvedBaseWeights: boolean; readonly applyLuckAfterward: boolean },
  ): void;
}

export interface MoodyLiveBoonOfferPort {
  readonly id: string;
  setHidden(hidden: boolean): void;
}

export interface MoodyLiveCapturePort {
  readonly encounterId?: string;
  guaranteedTraits: string[];
  catchRateMultiplier: number;
  addGuaranteedTrait(trait: string): void;
  multiplyCatchRate(multiplier: number): void;
}

export interface MoodyLiveMarketPort {
  price: number;
  itemEffectValue: number;
  automaticBiomeHealing: boolean;
  paidWithBloodDebt: boolean;
  enhancedPurchase: boolean;
}

export interface MoodyLiveProgressionProjection {
  notifications: string[];
  pendingChoices: Array<{ kind: string; data: Readonly<Record<string, unknown>> }>;
  selectedImprints: string[];
  apexSegmentsByPokemon: Record<string, number[]>;
  cursedStack: { pokemonId: string; itemStackId: string } | null;
  trainerRosterSize: number | null;
  counterWeight: number;
  counterTargetPokemonId: string | null;
  futureEnemyStatMultiplier: number;
  activeItemSets: readonly unknown[];
}

export interface MoodyLiveRewardProjection {
  options: MoodyLiveRewardOptionPort[];
  boonOffers: MoodyLiveBoonOfferPort[];
  contractIds: string[];
  grantedContractRewards: Array<{ contractId: string; tier: string; relicChoice: boolean }>;
  replacementDisabled: boolean;
  replacementCost: number;
  replacementSacrifices: number;
}

export interface MoodyLiveExecutionTarget {
  addMoney(amount: number): void;
  party: MoodyLivePokemonPort[];
  enemies: MoodyLivePokemonPort[];
  reward: MoodyLiveRewardProjection;
  market: MoodyLiveMarketPort;
  capture: MoodyLiveCapturePort;
  progression: MoodyLiveProgressionProjection;
  mutationReceipts: string[];
}

export interface MoodyLiveExecutionResult {
  readonly save: MoodyModeSaveData;
  readonly target: MoodyLiveExecutionTarget;
  readonly commands: readonly MoodyCoordinatorCommand[];
}

export interface MoodyHydratedLiveProjection {
  readonly progression: MoodyLiveProgressionProjection;
  readonly reward: Pick<
    MoodyLiveRewardProjection,
    "contractIds" | "grantedContractRewards" | "replacementDisabled" | "replacementCost" | "replacementSacrifices"
  >;
  readonly market: MoodyLiveMarketPort;
  readonly capture: {
    readonly encounterId?: string;
    readonly guaranteedTraits: readonly string[];
    readonly catchRateMultiplier: number;
  };
  readonly mutationReceipts: readonly string[];
}

export interface MoodyLiveProjectionConsumptionMap {
  notifications: string[];
  pendingChoices: Array<{ kind: string; data: Readonly<Record<string, unknown>> }>;
  contractIds: string[];
  grantedContractRewards: Array<{ contractId: string; tier: string; relicChoice: boolean }>;
  captureTraits: string[];
}

export type MoodyLiveProjectionConsumption = keyof MoodyLiveProjectionConsumptionMap;

interface MoodyLivePersistedProjectionV1 {
  version: 1;
  revision: number;
  progression?: Partial<MoodyLiveProgressionProjection>;
  reward?: Pick<
    MoodyLiveRewardProjection,
    "contractIds" | "grantedContractRewards" | "replacementDisabled" | "replacementCost" | "replacementSacrifices"
  >;
  market?: MoodyLiveMarketPort;
  capture?: {
    readonly encounterId?: string;
    readonly guaranteedTraits: string[];
    readonly catchRateMultiplier: number;
  };
  receipts: string[];
}

const LIVE_PROJECTION_SAVE_KEY = "__moodyLiveProjectionV1";
const MAX_DURABLE_NOTIFICATIONS = 32;
const MAX_DURABLE_CHOICES = 16;
const MAX_DURABLE_REWARDS = 16;
const MAX_DURABLE_RECEIPTS = 64;

export const MOODY_LIVE_SAVE_CONTRACT = {
  version: 1,
  container: `MoodyModeSaveData.boons|curses[].progress.values.${LIVE_PROJECTION_SAVE_KEY}`,
  encoding: "JSON",
  moduleGlobalState: false,
  resetCadences: {
    notifications: "consumed by UI",
    pendingChoices: "resolved by choice UI",
    rewardState: "reward screen or contract resolution",
    biomeState: "next biome transition",
    runState: "run end",
  },
} as const;

export function createMoodyLiveExecutionTarget(
  overrides: Partial<MoodyLiveExecutionTarget> = {},
  save?: MoodyModeSaveData,
): MoodyLiveExecutionTarget {
  const target: MoodyLiveExecutionTarget = {
    addMoney: () => undefined,
    party: [],
    enemies: [],
    reward: {
      options: [],
      boonOffers: [],
      contractIds: [],
      grantedContractRewards: [],
      replacementDisabled: false,
      replacementCost: 0,
      replacementSacrifices: 0,
    },
    market: {
      price: 0,
      itemEffectValue: 1,
      automaticBiomeHealing: true,
      paidWithBloodDebt: false,
      enhancedPurchase: false,
    },
    capture: {
      guaranteedTraits: [],
      catchRateMultiplier: 1,
      addGuaranteedTrait: () => undefined,
      multiplyCatchRate: () => undefined,
    },
    progression: {
      notifications: [],
      pendingChoices: [],
      selectedImprints: [],
      apexSegmentsByPokemon: {},
      cursedStack: null,
      trainerRosterSize: null,
      counterWeight: 0,
      counterTargetPokemonId: null,
      futureEnemyStatMultiplier: 1,
      activeItemSets: [],
    },
    mutationReceipts: [],
    ...overrides,
  };
  if (save != null) {
    hydrateMoodyLiveProjection(save, target);
  }
  return target;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function decodePersistedProjection(value: unknown): MoodyLivePersistedProjectionV1 | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.receipts)) {
      return null;
    }
    return parsed as unknown as MoodyLivePersistedProjectionV1;
  } catch {
    return null;
  }
}

function persistedProjections(save: MoodyModeSaveData): MoodyLivePersistedProjectionV1[] {
  return [...save.boons, ...save.curses]
    .map(effect => decodePersistedProjection(effect.progress?.values?.[LIVE_PROJECTION_SAVE_KEY]))
    .filter((value): value is MoodyLivePersistedProjectionV1 => value != null);
}

function mergeUnique<T>(left: readonly T[], right: readonly T[], key: (value: T) => string): T[] {
  return [...new Map([...left, ...right].map(value => [key(value), value])).values()];
}

function hydrateCanonicalApexSegments(save: MoodyModeSaveData, target: MoodyLiveExecutionTarget): void {
  const apex = hydrateMoodyCoordinatorState(save).effects.find(effect => effect.effectId === "apex-plunder");
  const segments = Array.isArray(apex?.state?.values?.apexSegments)
    ? apex.state.values.apexSegments.filter((value): value is number => typeof value === "number" && value > 0)
    : [];
  const pokemonId = save.boons.find(boon => boon.boonId === "apex-plunder")?.target?.pokemonIds?.[0];
  for (const key of Object.keys(target.progression.apexSegmentsByPokemon)) {
    Reflect.deleteProperty(target.progression.apexSegmentsByPokemon, key);
  }
  if (pokemonId != null && segments.length > 0) {
    target.progression.apexSegmentsByPokemon[String(pokemonId)] = segments;
  }
}

export function hydrateMoodyLiveProjection(save: MoodyModeSaveData, target: MoodyLiveExecutionTarget): void {
  for (const persisted of persistedProjections(save)) {
    const progression = persisted.progression;
    if (progression != null) {
      target.progression.notifications = mergeUnique(
        target.progression.notifications,
        progression.notifications ?? [],
        String,
      ).slice(-MAX_DURABLE_NOTIFICATIONS);
      target.progression.pendingChoices = mergeUnique(
        target.progression.pendingChoices,
        progression.pendingChoices ?? [],
        choice => `${choice.kind}:${JSON.stringify(choice.data)}`,
      ).slice(-MAX_DURABLE_CHOICES);
      if (progression.selectedImprints != null) {
        target.progression.selectedImprints = [...progression.selectedImprints];
      }
      if (progression.cursedStack !== undefined) {
        target.progression.cursedStack = progression.cursedStack;
      }
      if (progression.trainerRosterSize !== undefined) {
        target.progression.trainerRosterSize = progression.trainerRosterSize;
      }
      if (progression.counterWeight !== undefined) {
        target.progression.counterWeight = progression.counterWeight;
      }
      if (progression.counterTargetPokemonId !== undefined) {
        target.progression.counterTargetPokemonId = progression.counterTargetPokemonId;
      }
      if (progression.futureEnemyStatMultiplier !== undefined) {
        target.progression.futureEnemyStatMultiplier = progression.futureEnemyStatMultiplier;
      }
      if (progression.activeItemSets != null) {
        target.progression.activeItemSets = structuredClone(progression.activeItemSets);
      }
    }
    if (persisted.reward != null) {
      target.reward.contractIds = mergeUnique(target.reward.contractIds, persisted.reward.contractIds, String);
      target.reward.grantedContractRewards = mergeUnique(
        target.reward.grantedContractRewards,
        persisted.reward.grantedContractRewards,
        reward => `${reward.contractId}:${reward.tier}:${reward.relicChoice}`,
      ).slice(-MAX_DURABLE_REWARDS);
      target.reward.replacementDisabled = persisted.reward.replacementDisabled;
      target.reward.replacementCost = persisted.reward.replacementCost;
      target.reward.replacementSacrifices = persisted.reward.replacementSacrifices;
    }
    if (persisted.market != null) {
      // Price and item-effect value belong to the current query. Rehydrating an
      // earlier query's zero/default value made an entire later market free.
      target.market.automaticBiomeHealing &&= persisted.market.automaticBiomeHealing;
      target.market.paidWithBloodDebt ||= persisted.market.paidWithBloodDebt;
      target.market.enhancedPurchase ||= persisted.market.enhancedPurchase;
    }
    if (
      persisted.capture != null
      && (target.capture.encounterId == null
        || persisted.capture.encounterId == null
        || target.capture.encounterId === persisted.capture.encounterId)
    ) {
      const previousTraits = new Set(target.capture.guaranteedTraits);
      target.capture.guaranteedTraits = mergeUnique(
        target.capture.guaranteedTraits,
        persisted.capture.guaranteedTraits,
        String,
      );
      if (target.capture.encounterId != null) {
        for (const trait of target.capture.guaranteedTraits) {
          if (!previousTraits.has(trait)) {
            target.capture.addGuaranteedTrait(trait);
          }
        }
      }
      target.capture.catchRateMultiplier *= persisted.capture.catchRateMultiplier;
      if (target.capture.encounterId != null) {
        target.capture.multiplyCatchRate(persisted.capture.catchRateMultiplier);
      }
    }
    target.mutationReceipts = mergeUnique(target.mutationReceipts, persisted.receipts, String).slice(
      -MAX_DURABLE_RECEIPTS,
    );
  }
  hydrateCanonicalApexSegments(save, target);
}

function snapshotMoodyLiveProjection(target: MoodyLiveExecutionTarget): MoodyHydratedLiveProjection {
  return {
    progression: structuredClone(target.progression),
    reward: {
      contractIds: [...target.reward.contractIds],
      grantedContractRewards: structuredClone(target.reward.grantedContractRewards),
      replacementDisabled: target.reward.replacementDisabled,
      replacementCost: target.reward.replacementCost,
      replacementSacrifices: target.reward.replacementSacrifices,
    },
    market: structuredClone(target.market),
    capture: {
      ...(target.capture.encounterId == null ? {} : { encounterId: target.capture.encounterId }),
      guaranteedTraits: [...target.capture.guaranteedTraits],
      catchRateMultiplier: target.capture.catchRateMultiplier,
    },
    mutationReceipts: [...target.mutationReceipts],
  };
}

export function getHydratedMoodyLiveProjection(
  save: MoodyModeSaveData,
  encounterId?: string,
): MoodyHydratedLiveProjection {
  const target = createMoodyLiveExecutionTarget(
    encounterId == null
      ? {}
      : {
          capture: {
            encounterId,
            guaranteedTraits: [],
            catchRateMultiplier: 1,
            addGuaranteedTrait: () => undefined,
            multiplyCatchRate: () => undefined,
          },
        },
    save,
  );
  return snapshotMoodyLiveProjection(target);
}

export function getCurrentMoodyLiveProjection(encounterId?: string): MoodyHydratedLiveProjection | null {
  const save = getMoodyModeSaveData();
  return save == null ? null : getHydratedMoodyLiveProjection(save, encounterId);
}

function clearPersistedConsumption(
  persisted: MoodyLivePersistedProjectionV1,
  consumption: MoodyLiveProjectionConsumption,
  encounterId?: string,
): void {
  switch (consumption) {
    case "notifications":
      if (persisted.progression != null) {
        persisted.progression.notifications = [];
      }
      break;
    case "pendingChoices":
      if (persisted.progression != null) {
        persisted.progression.pendingChoices = [];
      }
      break;
    case "contractIds":
      if (persisted.reward != null) {
        persisted.reward.contractIds = [];
      }
      break;
    case "grantedContractRewards":
      if (persisted.reward != null) {
        persisted.reward.grantedContractRewards = [];
      }
      break;
    case "captureTraits":
      if (
        persisted.capture != null
        && (encounterId == null
          || persisted.capture.encounterId == null
          || persisted.capture.encounterId === encounterId)
      ) {
        Reflect.deleteProperty(persisted, "capture");
      }
      break;
  }
}

export function consumeMoodyLiveProjection<K extends MoodyLiveProjectionConsumption>(
  save: MoodyModeSaveData,
  consumption: K,
  encounterId?: string,
): MoodyLiveProjectionConsumptionMap[K] {
  const projection = getHydratedMoodyLiveProjection(save, encounterId);
  const consumed: MoodyLiveProjectionConsumptionMap = {
    notifications: [...projection.progression.notifications],
    pendingChoices: structuredClone(projection.progression.pendingChoices),
    contractIds: [...projection.reward.contractIds],
    grantedContractRewards: structuredClone(projection.reward.grantedContractRewards),
    captureTraits: [...projection.capture.guaranteedTraits],
  };
  for (const effect of [...save.boons, ...save.curses]) {
    const encoded = effect.progress?.values?.[LIVE_PROJECTION_SAVE_KEY];
    const persisted = decodePersistedProjection(encoded);
    if (persisted == null || effect.progress?.values == null) {
      continue;
    }
    clearPersistedConsumption(persisted, consumption, encounterId);
    persisted.revision++;
    effect.progress.values[LIVE_PROJECTION_SAVE_KEY] = JSON.stringify(persisted);
  }
  return consumed[consumption] as MoodyLiveProjectionConsumptionMap[K];
}

export function consumeCurrentMoodyLiveProjection<K extends MoodyLiveProjectionConsumption>(
  consumption: K,
  encounterId?: string,
): MoodyLiveProjectionConsumptionMap[K] | null {
  const save = getMoodyModeSaveData();
  if (save == null) {
    return null;
  }
  const consumed = consumeMoodyLiveProjection(save, consumption, encounterId);
  commitCoordinatorProgress(save);
  return consumed;
}

export function consumeMoodyLivePendingChoice(
  save: MoodyModeSaveData,
  kind: string,
): { kind: string; data: Readonly<Record<string, unknown>> } | null {
  const projection = getHydratedMoodyLiveProjection(save);
  const choice = projection.progression.pendingChoices.find(candidate => candidate.kind === kind) ?? null;
  if (choice == null) {
    return null;
  }
  let removed = false;
  for (const effect of [...save.boons, ...save.curses]) {
    const encoded = effect.progress?.values?.[LIVE_PROJECTION_SAVE_KEY];
    const persisted = decodePersistedProjection(encoded);
    if (persisted?.progression?.pendingChoices == null || effect.progress?.values == null) {
      continue;
    }
    const index = persisted.progression.pendingChoices.findIndex(candidate => candidate.kind === kind);
    if (index < 0 || removed) {
      continue;
    }
    persisted.progression.pendingChoices.splice(index, 1);
    persisted.revision++;
    effect.progress.values[LIVE_PROJECTION_SAVE_KEY] = JSON.stringify(persisted);
    removed = true;
  }
  return choice;
}

export function consumeCurrentMoodyLivePendingChoice(
  kind: string,
): { kind: string; data: Readonly<Record<string, unknown>> } | null {
  const save = getMoodyModeSaveData();
  if (save == null) {
    return null;
  }
  const choice = consumeMoodyLivePendingChoice(save, kind);
  if (choice != null) {
    commitCoordinatorProgress(save);
  }
  return choice;
}

export function getMoodyLiveCatchRateMultiplier(save: MoodyModeSaveData, encounterId?: string): number {
  return getHydratedMoodyLiveProjection(save, encounterId).capture.catchRateMultiplier;
}

function numberData(command: MoodyCoordinatorCommand, key: string, fallback = 0): number {
  const value = command.data[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringData(command: MoodyCoordinatorCommand, key: string, fallback = ""): string {
  const value = command.data[key];
  return typeof value === "string" ? value : fallback;
}

function booleanData(command: MoodyCoordinatorCommand, key: string): boolean {
  return command.data[key] === true;
}

function stringsData(command: MoodyCoordinatorCommand, key: string): string[] {
  const value = command.data[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function recordsData(command: MoodyCoordinatorCommand, key: string): Readonly<Record<string, unknown>>[] {
  const value = command.data[key];
  return Array.isArray(value)
    ? value.filter((item): item is Readonly<Record<string, unknown>> => item != null && typeof item === "object")
    : [];
}

function pokemonById(target: MoodyLiveExecutionTarget, id: string): MoodyLivePokemonPort | undefined {
  return [...target.party, ...target.enemies].find(pokemon => pokemon.id === id);
}

function rewardOption(target: MoodyLiveExecutionTarget, index: number): MoodyLiveRewardOptionPort | undefined {
  return target.reward.options[index];
}

function mutateSaveForCommand(save: MoodyModeSaveData, command: MoodyCoordinatorCommand): void {
  if (command.kind === "disable-automatic-biome-healing") {
    const curse = save.curses.find(candidate => candidate.curseId === command.effectId);
    if (curse != null) {
      curse.progress ??= {};
      curse.progress.flags ??= {};
      curse.progress.flags.automaticBiomeHealingDisabled = true;
    }
  }
  if (command.kind !== "set-dormant-boons") {
    return;
  }
  const dormant = new Set(stringsData(command, "instanceIds"));
  for (const boon of save.boons) {
    boon.dormant = dormant.has(boon.instanceId);
  }
}

function commandOwner(save: MoodyModeSaveData, effectId: string) {
  return (
    save.boons.find(candidate => candidate.boonId === effectId)
    ?? save.curses.find(candidate => candidate.curseId === effectId)
  );
}

function progressionProjectionForCommand(
  command: MoodyCoordinatorCommand,
  target: MoodyLiveExecutionTarget,
): Partial<MoodyLiveProgressionProjection> | undefined {
  switch (command.kind) {
    case "ledger-mark-earned":
    case "revive-with-second-act":
    case "set-dormant-boons":
    case "revive-boss-roster":
    case "replace-party-moves-until-next-biome":
      return { notifications: target.progression.notifications.slice(-MAX_DURABLE_NOTIFICATIONS) };
    case "queue-post-battle-hunter-choice":
    case "offer-partial-vitamin-transfer":
      return { pendingChoices: structuredClone(target.progression.pendingChoices.slice(-MAX_DURABLE_CHOICES)) };
    case "choose-progression-imprints":
      return { selectedImprints: [...target.progression.selectedImprints] };
    case "reveal-cursed-stack":
      return { cursedStack: structuredClone(target.progression.cursedStack) };
    case "set-trainer-roster-size":
      return { trainerRosterSize: target.progression.trainerRosterSize };
    case "set-counter-weight":
      return {
        counterWeight: target.progression.counterWeight,
        counterTargetPokemonId: target.progression.counterTargetPokemonId,
      };
    case "set-future-enemy-stat-multiplier":
      return { futureEnemyStatMultiplier: target.progression.futureEnemyStatMultiplier };
    case "apply-item-set-bonuses":
      return { activeItemSets: structuredClone(target.progression.activeItemSets) };
    default:
      return;
  }
}

function persistLiveProjectionForCommand(
  save: MoodyModeSaveData,
  target: MoodyLiveExecutionTarget,
  command: MoodyCoordinatorCommand,
): void {
  const owner = commandOwner(save, command.effectId);
  if (owner == null) {
    return;
  }
  owner.progress ??= {};
  owner.progress.values ??= {};
  const previous = decodePersistedProjection(owner.progress.values[LIVE_PROJECTION_SAVE_KEY]);
  const receipt = `${command.domain}:${command.kind}`;
  const persisted: MoodyLivePersistedProjectionV1 = {
    version: 1,
    revision: (previous?.revision ?? 0) + 1,
    ...(previous?.progression == null ? {} : { progression: structuredClone(previous.progression) }),
    ...(previous?.reward == null ? {} : { reward: structuredClone(previous.reward) }),
    ...(previous?.market == null ? {} : { market: structuredClone(previous.market) }),
    ...(previous?.capture == null ? {} : { capture: structuredClone(previous.capture) }),
    receipts: mergeUnique(previous?.receipts ?? [], [receipt], String).slice(-MAX_DURABLE_RECEIPTS),
  };
  const progression = progressionProjectionForCommand(command, target);
  if (progression != null) {
    persisted.progression = { ...persisted.progression, ...progression };
  }
  if (command.domain === "reward") {
    persisted.reward = {
      contractIds: [...target.reward.contractIds],
      grantedContractRewards: structuredClone(target.reward.grantedContractRewards.slice(-MAX_DURABLE_REWARDS)),
      replacementDisabled: target.reward.replacementDisabled,
      replacementCost: target.reward.replacementCost,
      replacementSacrifices: target.reward.replacementSacrifices,
    };
  }
  if (
    command.kind === "purchase-with-blood-debt"
    || command.kind === "set-market-price"
    || command.kind === "set-item-effect-value"
    || command.kind === "disable-automatic-biome-healing"
  ) {
    persisted.market = structuredClone(target.market);
  }
  if (command.domain === "capture") {
    persisted.capture = {
      ...(target.capture.encounterId == null ? {} : { encounterId: target.capture.encounterId }),
      guaranteedTraits: [...target.capture.guaranteedTraits],
      catchRateMultiplier: target.capture.catchRateMultiplier,
    };
  }
  owner.progress.values[LIVE_PROJECTION_SAVE_KEY] = JSON.stringify(persisted);
}

export function resetMoodyCoordinatorLiveCadence(cadence: MoodyCoordinatorResetCadence): boolean {
  const save = getMoodyModeSaveData();
  if (save == null) {
    return false;
  }
  commitCoordinatorProgress(
    persistMoodyCoordinatorState(save, resetMoodyCoordinatorCadence(hydrateMoodyCoordinatorState(save), cadence)),
  );
  return true;
}

export function executeMoodyLiveCommand(
  save: MoodyModeSaveData,
  target: MoodyLiveExecutionTarget,
  command: MoodyCoordinatorCommand,
): void {
  mutateSaveForCommand(save, command);
  switch (command.kind) {
    case "ledger-mark-earned":
      target.progression.notifications.push(`ledger:${numberData(command, "mark")}`);
      break;
    case "queue-post-battle-hunter-choice":
      target.progression.pendingChoices.push({ kind: command.kind, data: command.data });
      break;
    case "increase-team-max-hp":
      for (const pokemon of target.party) {
        pokemon.addMaxHpFraction(numberData(command, "fraction"));
      }
      break;
    case "offer-partial-vitamin-transfer":
      target.progression.pendingChoices.push({ kind: command.kind, data: command.data });
      break;
    case "choose-progression-imprints":
      target.progression.selectedImprints = stringsData(command, "eligibleImprints").slice(
        0,
        numberData(command, "capacity", 1),
      );
      break;
    case "store-apex-segment":
      target.progression.apexSegmentsByPokemon[stringData(command, "pokemonId")] = Array.isArray(
        command.data.hpFractions,
      )
        ? command.data.hpFractions.filter((value): value is number => typeof value === "number")
        : [];
      break;
    case "reveal-cursed-stack":
      target.progression.cursedStack = {
        pokemonId: stringData(command, "pokemonId"),
        itemStackId: stringData(command, "itemStackId"),
      };
      break;
    case "set-trainer-roster-size":
      target.progression.trainerRosterSize = numberData(command, "size");
      break;
    case "revive-with-second-act": {
      const pokemon = pokemonById(target, stringData(command, "pokemonId"));
      pokemon?.revive(
        numberData(command, "hpFraction", 1),
        numberData(command, "extraHealthSegments"),
        numberData(command, "allStatStages"),
      );
      target.progression.notifications.push(`second-act:${stringData(command, "pokemonId")}`);
      break;
    }
    case "set-dormant-boons":
      target.progression.notifications.push(`dormant:${stringsData(command, "instanceIds").join(",")}`);
      break;
    case "set-counter-weight":
      target.progression.counterWeight = numberData(command, "value");
      target.progression.counterTargetPokemonId = stringData(command, "targetPokemonId") || null;
      break;
    case "revive-boss-roster":
      for (const pokemonId of stringsData(command, "pokemonIds")) {
        const pokemon = pokemonById(target, pokemonId);
        pokemon?.revive(numberData(command, "hpFraction"), 0, 0);
        if (booleanData(command, "clearNegativeStages")) {
          pokemon?.clearNegativeStages();
        }
        if (booleanData(command, "clearMajorStatuses")) {
          pokemon?.clearMajorStatus();
        }
      }
      target.progression.notifications.push("blood-moon-revival");
      break;
    case "set-future-enemy-stat-multiplier":
      target.progression.futureEnemyStatMultiplier = numberData(command, "multiplier", 1);
      break;
    case "replace-party-moves-until-next-biome":
      for (const assignment of recordsData(command, "assignments")) {
        const pokemonId = typeof assignment.pokemonId === "string" ? assignment.pokemonId : "";
        const pokemon = pokemonById(target, pokemonId);
        if (
          pokemon != null
          && typeof assignment.originalMoveId === "string"
          && typeof assignment.replacementMoveId === "string"
        ) {
          pokemon.replaceMove(assignment.originalMoveId, assignment.replacementMoveId);
        }
      }
      target.progression.notifications.push("entropy-moves-replaced");
      break;
    case "apply-item-set-bonuses":
      target.progression.activeItemSets = Array.isArray(command.data.activeSets) ? command.data.activeSets : [];
      break;
    case "grant-money":
      target.addMoney(numberData(command, "amount"));
      break;
    case "purchase-with-blood-debt":
      for (const debt of recordsData(command, "debts")) {
        const pokemonId = typeof debt.pokemonId === "string" ? debt.pokemonId : "";
        pokemonById(target, pokemonId)?.applyHpDebt(typeof debt.hpDebt === "number" ? debt.hpDebt : 0);
      }
      target.market.paidWithBloodDebt = true;
      target.market.enhancedPurchase = booleanData(command, "enhancedPurchase");
      break;
    case "set-market-price":
      target.market.price = numberData(command, "price", target.market.price);
      break;
    case "set-item-effect-value":
      target.market.itemEffectValue = numberData(command, "value", target.market.itemEffectValue);
      break;
    case "disable-automatic-biome-healing":
      target.market.automaticBiomeHealing = false;
      break;
    case "offer-feasible-contracts":
      target.reward.contractIds = stringsData(command, "contractIds");
      break;
    case "grant-contract-reward":
      target.reward.grantedContractRewards.push({
        contractId: stringData(command, "contractId"),
        tier: stringData(command, "tier"),
        relicChoice: booleanData(command, "relicChoice"),
      });
      break;
    case "reroll-reward-options":
      for (const index of (command.data.rerollIndices as readonly unknown[] | undefined) ?? []) {
        if (typeof index === "number") {
          const option = rewardOption(target, index);
          option?.reroll(
            booleanData(command, "minimumOriginalRarity") ? (option?.getTier() ?? 0) : 0,
            typeof command.data.excludedCategory === "string" ? command.data.excludedCategory : null,
            { improvedBaseWeights: true, applyLuckAfterward: true },
          );
        }
      }
      break;
    case "generate-upcycled-reward": {
      const index = ((command.data.rerollIndices as readonly unknown[] | undefined) ?? []).find(
        (value): value is number => typeof value === "number",
      );
      const option = index == null ? undefined : rewardOption(target, index);
      option?.reroll(
        Math.max(
          (option.getTier() || 0) + Math.max(1, numberData(command, "minimumTierIncrease")),
          numberData(command, "minimumOutputTier"),
        ),
        null,
        { improvedBaseWeights: true, applyLuckAfterward: true },
      );
      break;
    }
    case "apply-pre-luck-rarity-uplifts": {
      const offsets = command.data.offsets;
      if (Array.isArray(offsets)) {
        offsets.forEach((offset, index) => {
          const option = rewardOption(target, index);
          if (option != null && typeof offset === "number") {
            option.setTier(option.getTier() + offset);
          }
        });
      }
      const quantity = numberData(command, "quantityUplifts");
      if (quantity > 0 && target.reward.options[0] != null) {
        target.reward.options[0].setQuantity(target.reward.options[0].getQuantity() + quantity);
      }
      break;
    }
    case "apply-pre-luck-rarity-penalty":
      for (const option of target.reward.options) {
        option.setTier(Math.max(0, option.getTier() - numberData(command, "tiers")));
      }
      break;
    case "set-reward-replacement-cost":
      target.reward.replacementDisabled = booleanData(command, "disabled");
      target.reward.replacementCost = numberData(command, "cost");
      target.reward.replacementSacrifices = numberData(command, "sacrifices");
      break;
    case "hide-beneficial-boon-offer":
      target.reward.boonOffers.find(option => option.id === stringData(command, "offerId"))?.setHidden(true);
      break;
    case "guarantee-collectible-traits":
      for (const trait of stringsData(command, "traits")) {
        if (!target.capture.guaranteedTraits.includes(trait)) {
          target.capture.guaranteedTraits.push(trait);
        }
        target.capture.addGuaranteedTrait(trait);
      }
      break;
    case "set-capture-rate-multiplier":
      target.capture.catchRateMultiplier *= numberData(command, "multiplier", 1);
      target.capture.multiplyCatchRate(numberData(command, "multiplier", 1));
      break;
    default: {
      const exhaustive: never = command;
      throw new Error(`Unhandled Moody live command: ${String((exhaustive as MoodyCoordinatorCommand).kind)}`);
    }
  }
  target.mutationReceipts.push(`${command.domain}:${command.kind}`);
  persistLiveProjectionForCommand(save, target, command);
}

function commitCoordinatorProgress(save: MoodyModeSaveData): void {
  const live = getMoodyModeState() as MoodyModeSaveData | null;
  if (live == null) {
    return;
  }
  live.boons = structuredClone(save.boons);
  live.curses = structuredClone(save.curses);
}

export function runMoodyCoordinatorLive(
  event: MoodyCoordinatorEvent,
  target: MoodyLiveExecutionTarget,
  options: MoodyCoordinatorOptions = {},
): MoodyLiveExecutionResult | null {
  const save = getMoodyModeSaveData();
  if (save == null) {
    return null;
  }
  const resolution = coordinateMoodyRuntime(hydrateMoodyCoordinatorState(save), event, options);
  const persisted = persistMoodyCoordinatorState(save, resolution.state);
  commitCoordinatorProgress(persisted);
  for (const command of resolution.commands) {
    executeMoodyLiveCommand(persisted, target, command);
  }
  commitCoordinatorProgress(persisted);
  return { save: persisted, target, commands: resolution.commands };
}
