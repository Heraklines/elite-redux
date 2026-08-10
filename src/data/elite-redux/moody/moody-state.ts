import { MOODY_BOONS, MOODY_CURSES } from "#data/elite-redux/moody/moody-catalog.generated";
import type {
  MoodyBoonDefinition,
  MoodyBoonInstance,
  MoodyBoonOffer,
  MoodyBoonProgress,
  MoodyBoonTarget,
  MoodyCurseInstance,
  MoodyModeSaveData,
  MoodyRarity,
} from "#data/elite-redux/moody/moody-types";

const MOODY_STATE_VERSION = 1 as const;
const MAX_UNIQUE_BOONS = 12;
const UPGRADE_FOCUS_THRESHOLD = 8;

const RARITY_WEIGHTS: Readonly<Record<MoodyRarity, number>> = {
  great: 52,
  ultra: 30,
  rogue: 14,
  master: 4,
};

export const MOODY_BOON_BY_ID = new Map<string, MoodyBoonDefinition>(
  MOODY_BOONS.map(boon => [boon.id, boon as MoodyBoonDefinition]),
);
export const MOODY_CURSE_BY_ID = new Map<string, (typeof MOODY_CURSES)[number]>(
  MOODY_CURSES.map(curse => [curse.id, curse]),
);

let currentState: MoodyModeSaveData | null = null;
let pendingOffers: MoodyBoonOffer[] | null = null;
let pendingOfferWave = -1;

function mix32(value: number): number {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return mix32(hash);
}

function seededUnit(seed: number, salt: number): number {
  return mix32(seed ^ Math.imul(salt + 1, 0x9e3779b1)) / 0x1_0000_0000;
}

function cloneState(state: MoodyModeSaveData): MoodyModeSaveData {
  return structuredClone(state);
}

export function createMoodyModeState(seed: string | number): MoodyModeSaveData {
  return {
    version: MOODY_STATE_VERSION,
    seed: typeof seed === "number" ? mix32(seed) : hashString(seed),
    acquisitionRolls: 0,
    draftIndex: 0,
    boons: [],
    curses: [],
    recentThreat: [],
  };
}

export function initializeMoodyModeState(seed: string | number): void {
  currentState = createMoodyModeState(seed);
  pendingOffers = null;
  pendingOfferWave = -1;
}

export function resetMoodyModeState(): void {
  currentState = null;
  pendingOffers = null;
  pendingOfferWave = -1;
}

export function getMoodyModeState(): Readonly<MoodyModeSaveData> | null {
  return currentState;
}

export function getMoodyModeSaveData(): MoodyModeSaveData | undefined {
  return currentState == null ? undefined : cloneState(currentState);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function sanitizeTarget(value: unknown): MoodyBoonTarget | undefined {
  if (!isRecord(value)) {
    return;
  }
  const target: MoodyBoonTarget = {};
  if (Array.isArray(value.pokemonIds)) {
    target.pokemonIds = value.pokemonIds.filter(Number.isSafeInteger).map(Number);
  }
  if (Array.isArray(value.partySlots)) {
    target.partySlots = value.partySlots.filter(Number.isSafeInteger).map(Number);
  }
  if (Array.isArray(value.moveIds)) {
    target.moveIds = value.moveIds.filter(Number.isSafeInteger).map(Number);
  }
  if (Number.isSafeInteger(value.pokemonType)) {
    target.pokemonType = Number(value.pokemonType);
  }
  if (Array.isArray(value.itemTypeIds)) {
    target.itemTypeIds = value.itemTypeIds.filter(item => typeof item === "string");
  }
  if (typeof value.option === "string") {
    target.option = value.option;
  }
  return target;
}

function sanitizeProgress(value: unknown): MoodyBoonProgress | undefined {
  if (!isRecord(value)) {
    return;
  }
  const progress: MoodyBoonProgress = {};
  if (isRecord(value.counters)) {
    progress.counters = Object.fromEntries(
      Object.entries(value.counters).filter((entry): entry is [string, number] => Number.isFinite(entry[1])),
    );
  }
  if (isRecord(value.flags)) {
    progress.flags = Object.fromEntries(
      Object.entries(value.flags).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"),
    );
  }
  if (isRecord(value.values)) {
    progress.values = Object.fromEntries(
      Object.entries(value.values).filter(
        (entry): entry is [string, number | string | boolean] =>
          typeof entry[1] === "number" || typeof entry[1] === "string" || typeof entry[1] === "boolean",
      ),
    );
  }
  return progress;
}

function sanitizeBoon(value: unknown): MoodyBoonInstance | null {
  if (!isRecord(value) || typeof value.boonId !== "string" || !MOODY_BOON_BY_ID.has(value.boonId)) {
    return null;
  }
  const definition = MOODY_BOON_BY_ID.get(value.boonId)!;
  const rank = value.rank === 2 || value.rank === 3 ? value.rank : 1;
  const evolutionId =
    rank === 3 && typeof value.evolutionId === "string"
      ? definition.evolutions.find(evolution => evolution.id === value.evolutionId)?.id
      : undefined;
  if (rank === 3 && evolutionId == null) {
    return null;
  }
  return {
    instanceId:
      typeof value.instanceId === "string" && value.instanceId.length > 0
        ? value.instanceId
        : `${value.boonId}-${Math.max(0, Number(value.acquiredAtWave) || 0)}`,
    boonId: value.boonId,
    rank,
    ...(evolutionId == null ? {} : { evolutionId }),
    ...(sanitizeTarget(value.target) == null ? {} : { target: sanitizeTarget(value.target)! }),
    ...(sanitizeProgress(value.progress) == null ? {} : { progress: sanitizeProgress(value.progress)! }),
    acquiredAtWave: Number.isSafeInteger(value.acquiredAtWave) ? Math.max(0, Number(value.acquiredAtWave)) : 0,
    ...(value.dormant === true ? { dormant: true } : {}),
  };
}

function sanitizeCurse(value: unknown): MoodyCurseInstance | null {
  if (!isRecord(value) || typeof value.curseId !== "string" || !MOODY_CURSE_BY_ID.has(value.curseId)) {
    return null;
  }
  const target = sanitizeTarget(value.target);
  const progress = sanitizeProgress(value.progress);
  return {
    curseId: value.curseId,
    acquiredAtWave: Number.isSafeInteger(value.acquiredAtWave) ? Math.max(0, Number(value.acquiredAtWave)) : 0,
    ...(target == null ? {} : { target }),
    ...(progress == null ? {} : { progress }),
  };
}

export function restoreMoodyModeState(value: unknown): boolean {
  if (!isRecord(value) || value.version !== MOODY_STATE_VERSION || !Number.isSafeInteger(value.seed)) {
    resetMoodyModeState();
    return false;
  }
  const boons = Array.isArray(value.boons) ? value.boons.map(sanitizeBoon).filter(boon => boon != null) : [];
  const curses = Array.isArray(value.curses) ? value.curses.map(sanitizeCurse).filter(curse => curse != null) : [];
  currentState = {
    version: MOODY_STATE_VERSION,
    seed: Number(value.seed) >>> 0,
    acquisitionRolls: Number.isSafeInteger(value.acquisitionRolls) ? Math.max(0, Number(value.acquisitionRolls)) : 0,
    draftIndex: Number.isSafeInteger(value.draftIndex) ? Math.max(0, Number(value.draftIndex)) : 0,
    boons,
    curses,
    recentThreat: Array.isArray(value.recentThreat) ? structuredClone(value.recentThreat).slice(0, 6) : [],
  };
  pendingOffers = null;
  pendingOfferWave = -1;
  return true;
}

function weightedDefinition(seed: number, salt: number, excluded: ReadonlySet<string>): MoodyBoonDefinition | null {
  const catalog: readonly MoodyBoonDefinition[] = MOODY_BOONS;
  const eligible = catalog.filter(boon => boon.implementationStatus !== "blocked" && !excluded.has(boon.id));
  if (eligible.length === 0) {
    return null;
  }
  const total = eligible.reduce((sum, boon) => sum + RARITY_WEIGHTS[boon.rarity], 0);
  let roll = seededUnit(seed, salt) * total;
  for (const boon of eligible) {
    roll -= RARITY_WEIGHTS[boon.rarity];
    if (roll < 0) {
      return boon;
    }
  }
  return eligible.at(-1)!;
}

function chooseExisting(seed: number, salt: number, candidates: MoodyBoonInstance[]): MoodyBoonInstance | null {
  if (candidates.length === 0) {
    return null;
  }
  return candidates[Math.floor(seededUnit(seed, salt) * candidates.length) % candidates.length];
}

function makeOffer(
  state: MoodyModeSaveData,
  waveIndex: number,
  cardIndex: number,
  excludedBoons: ReadonlySet<string>,
): MoodyBoonOffer {
  const salt = state.draftIndex * 97 + waveIndex * 17 + cardIndex * 13;
  const upgradable = state.boons.filter(boon => boon.rank < 3);
  const uniqueCount = state.boons.length;
  const upgradeChance = uniqueCount >= MAX_UNIQUE_BOONS ? 1 : uniqueCount >= UPGRADE_FOCUS_THRESHOLD ? 0.72 : 0.28;
  const existing =
    seededUnit(state.seed, salt) < upgradeChance ? chooseExisting(state.seed, salt + 1, upgradable) : null;
  if (existing != null) {
    return {
      offerId: `${state.draftIndex}:${cardIndex}:${existing.boonId}:${existing.rank + 1}`,
      kind: existing.rank === 1 ? "rank-up" : "evolution",
      boonId: existing.boonId,
      existingInstanceId: existing.instanceId,
    };
  }
  const owned = new Set(state.boons.map(boon => boon.boonId));
  const definition = weightedDefinition(state.seed, salt + 2, new Set([...owned, ...excludedBoons]));
  if (definition != null) {
    return {
      offerId: `${state.draftIndex}:${cardIndex}:${definition.id}:new`,
      kind: uniqueCount >= MAX_UNIQUE_BOONS ? "replace" : "new",
      boonId: definition.id,
    };
  }
  const fallback = chooseExisting(state.seed, salt + 3, upgradable);
  if (fallback == null) {
    throw new Error("Moody Mode has no eligible boon offer");
  }
  return {
    offerId: `${state.draftIndex}:${cardIndex}:${fallback.boonId}:${fallback.rank + 1}`,
    kind: fallback.rank === 1 ? "rank-up" : "evolution",
    boonId: fallback.boonId,
    existingInstanceId: fallback.instanceId,
  };
}

export function getMoodyBoonOffers(waveIndex: number): readonly MoodyBoonOffer[] {
  if (currentState == null) {
    throw new Error("Moody Mode state is not initialized");
  }
  if (pendingOffers != null && pendingOfferWave === waveIndex) {
    return pendingOffers;
  }
  const offers: MoodyBoonOffer[] = [];
  const excluded = new Set<string>();
  for (let card = 0; card < 3; card++) {
    const offer = makeOffer(currentState, waveIndex, card, excluded);
    offers.push(offer);
    excluded.add(offer.boonId);
  }
  const cursedDraft = currentState.curses.some(curse => curse.curseId === "cursed-draft");
  if (cursedDraft) {
    const hiddenIndex = Math.floor(seededUnit(currentState.seed, currentState.draftIndex + waveIndex) * offers.length);
    offers[hiddenIndex] = { ...offers[hiddenIndex], hidden: true };
  }
  pendingOffers = offers;
  pendingOfferWave = waveIndex;
  return offers;
}

export function commitMoodyBoonOffer(
  offer: MoodyBoonOffer,
  waveIndex: number,
  target?: MoodyBoonTarget,
  evolutionId?: string,
  replaceInstanceId?: string,
): MoodyBoonInstance {
  if (currentState == null || pendingOffers?.some(candidate => candidate.offerId === offer.offerId) !== true) {
    throw new Error("Moody boon offer is not part of the active draft");
  }
  const definition = MOODY_BOON_BY_ID.get(offer.boonId);
  if (definition == null || definition.implementationStatus === "blocked") {
    throw new Error(`Moody boon ${offer.boonId} is not currently eligible`);
  }
  let instance: MoodyBoonInstance;
  if (offer.kind === "rank-up" || offer.kind === "evolution") {
    const existing = currentState.boons.find(boon => boon.instanceId === offer.existingInstanceId);
    if (existing == null || existing.rank >= 3) {
      throw new Error("Moody boon upgrade target no longer exists");
    }
    if (offer.kind === "evolution") {
      const branch = definition.evolutions.find(evolution => evolution.id === evolutionId);
      if (branch == null) {
        throw new Error("Moody boon evolution requires a valid branch");
      }
      existing.evolutionId = branch.id;
    }
    existing.rank = (existing.rank + 1) as 2 | 3;
    instance = existing;
  } else {
    if (offer.kind === "replace") {
      const replaceIndex = currentState.boons.findIndex(boon => boon.instanceId === replaceInstanceId);
      if (replaceIndex < 0) {
        throw new Error("A twelfth-line Moody draft requires an existing boon to replace");
      }
      currentState.boons.splice(replaceIndex, 1);
    }
    instance = {
      instanceId: `${definition.id}:${currentState.acquisitionRolls + 1}:${waveIndex}`,
      boonId: definition.id,
      rank: 1,
      ...(target == null ? {} : { target: structuredClone(target) }),
      acquiredAtWave: waveIndex,
    };
    currentState.boons.push(instance);
  }
  currentState.acquisitionRolls++;
  currentState.draftIndex++;
  pendingOffers = null;
  pendingOfferWave = -1;
  return instance;
}

export function addMoodyCurse(curseId: string, waveIndex: number, target?: MoodyBoonTarget): boolean {
  if (currentState == null || !MOODY_CURSE_BY_ID.has(curseId) || currentState.curses.some(c => c.curseId === curseId)) {
    return false;
  }
  currentState.curses.push({
    curseId,
    acquiredAtWave: waveIndex,
    ...(target == null ? {} : { target: structuredClone(target) }),
  });
  return true;
}

export function hasMoodyBoon(boonId: string, pokemonId?: number, partySlot?: number): boolean {
  return (
    currentState?.boons.some(
      boon =>
        boon.boonId === boonId
        && !boon.dormant
        && (pokemonId == null || boon.target?.pokemonIds?.includes(pokemonId))
        && (partySlot == null || boon.target?.partySlots?.includes(partySlot)),
    ) === true
  );
}

export function hasMoodyCurse(curseId: string): boolean {
  return currentState?.curses.some(curse => curse.curseId === curseId) === true;
}

export function getMoodyBoonBudget(): number {
  return currentState?.acquisitionRolls ?? 0;
}

export function getMoodyBoonsForPokemon(pokemonId: number, partySlot?: number): readonly MoodyBoonInstance[] {
  return (
    currentState?.boons.filter(
      boon =>
        !boon.dormant
        && (boon.target?.pokemonIds?.includes(pokemonId)
          || (partySlot != null && boon.target?.partySlots?.includes(partySlot))),
    ) ?? []
  );
}
