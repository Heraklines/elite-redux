import { MOODY_BOON_BY_ID, MOODY_CURSE_BY_ID } from "#data/elite-redux/moody/moody-state";
import type { MoodyBoonInstance, MoodyCurseInstance, MoodyModeSaveData } from "#data/elite-redux/moody/moody-types";
import { MoveCategory } from "#enums/move-category";
import type { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";

export type MoodyEffectSide = "player" | "enemy";
export type MoodyStatus = "burn" | "poison" | "toxic" | "paralysis" | "sleep" | "frostbite";
export type MoodyWeatherWake = "sun" | "rain" | "sand" | "snow" | "fog";
export type MoodyFinalDraftEnding = "climax" | "precision" | "revision";

export interface MoodyPassivePokemonContext {
  id: number;
  partySlot: number;
  types: readonly PokemonType[];
  level: number;
  currentHp: number;
  maxHp: number;
  fainted: boolean;
  fullyEvolved: boolean;
  status?: MoodyStatus;
}

export interface MoodyPassiveMoveContext {
  id: MoveId;
  type: PokemonType;
  category: MoveCategory;
  priority: number;
  currentPp: number;
  maxPp: number;
  useNumber: number;
  consecutiveUses: number;
  tags?: readonly string[];
  isStab: boolean;
  isDamaging: boolean;
}

export interface MoodyPassivePartyContext {
  slots: readonly (MoodyPassivePokemonContext | null)[];
  averageLevel: number;
  uniqueTypeCount: number;
  monotypeContributorCount?: number;
  allConsciousShareSelectedType?: boolean;
  lowestEligiblePokemonId?: number;
  secondLowestEligiblePokemonId?: number;
}

export interface MoodyPassiveFlags {
  firstDamagingMove?: boolean;
  firstUsableMove?: boolean;
  firstDirectHitReceived?: boolean;
  firstMoveAfterEntry?: boolean;
  firstMoveOnCurrentBeat?: boolean;
  starActive?: boolean;
  adjacentToStar?: boolean;
  revengeEntryActive?: boolean;
  countermelodyReady?: boolean;
  failureIsDataReady?: boolean;
  overdraftUse?: boolean;
  prismaticOpeningActive?: boolean;
  weatherWeakensMove?: boolean;
  adrenalConditionActive?: boolean;
  frostboundBarrierActive?: boolean;
  bossbreakerDamageActive?: boolean;
  posthumousAction?: boolean;
  pairPartnerConscious?: boolean;
  fatigued?: boolean;
  phaseProtectionActive?: boolean;
}

export interface MoodyPassiveBattleContext {
  waveIndex: number;
  turn: number;
  isBoss: boolean;
  learnedResistanceTypes?: readonly PokemonType[];
  chromaticChainLength?: number;
  weatherWake?: MoodyWeatherWake;
  finalDraftEnding?: MoodyFinalDraftEnding;
  sameSequenceHitIndex?: number;
}

export interface MoodyPassiveEconomyContext {
  event?: "boss-interest" | "biome-interest" | "market-purchase";
  isHealingPurchase?: boolean;
}

export interface MoodyPassiveRewardContext {
  slotIndex: number;
  slotCount: number;
  assignedRarityUplifts?: readonly number[];
}

export interface MoodyPassiveQueryContext {
  effectOwnerSide: MoodyEffectSide;
  actorSide: MoodyEffectSide;
  targetSide: MoodyEffectSide;
  actor?: MoodyPassivePokemonContext;
  target?: MoodyPassivePokemonContext;
  move?: MoodyPassiveMoveContext;
  party?: MoodyPassivePartyContext;
  flags?: MoodyPassiveFlags;
  battle: MoodyPassiveBattleContext;
  economy?: MoodyPassiveEconomyContext;
  reward?: MoodyPassiveRewardContext;
}

export type MoodyPassiveState = Readonly<Pick<MoodyModeSaveData, "boons" | "curses">>;

export type MoodyPassiveOutputKey =
  | "outgoingDamageMultiplier"
  | "incomingDamageMultiplier"
  | "incomingDamageCapMaxHpFraction"
  | "immediateDamageFraction"
  | "deferredDamageFraction"
  | "maxHpMultiplier"
  | "nonHpStatMultiplier"
  | "speedMultiplier"
  | "healingMultiplier"
  | "priorityDelta"
  | "accuracyMultiplier"
  | "alwaysHits"
  | "canActWhileAsleep"
  | "ppCostMultiplier"
  | "ppCostFlatDelta"
  | "maxPpFlatDelta"
  | "experienceMultiplier"
  | "moneyGainMultiplier"
  | "shopPriceMultiplier"
  | "captureMultiplier"
  | "rewardRarityOffset"
  | "rewardQuantityMultiplier";

export interface MoodyPassiveApplication {
  effectId: string;
  output: MoodyPassiveOutputKey;
  value: number | boolean;
}

export interface MoodyPassiveEffectResult {
  outgoingDamageMultiplier: number;
  incomingDamageMultiplier: number;
  incomingDamageCapMaxHpFraction: number | null;
  immediateDamageFraction: number;
  deferredDamageFraction: number;
  maxHpMultiplier: number;
  nonHpStatMultiplier: number;
  speedMultiplier: number;
  healingMultiplier: number;
  priorityDelta: number;
  accuracyMultiplier: number;
  alwaysHits: boolean;
  canActWhileAsleep: boolean;
  ppCostMultiplier: number;
  ppCostFlatDelta: number;
  maxPpFlatDelta: number;
  experienceMultiplier: number;
  moneyGainMultiplier: number;
  shopPriceMultiplier: number;
  captureMultiplier: number;
  rewardRarityOffset: number;
  rewardQuantityMultiplier: number;
  applications: readonly MoodyPassiveApplication[];
}

const SUPPORTED_BOON_ID_LIST = [
  "crowned-vanguard",
  "empty-throne",
  "rotating-spotlight",
  "chosen-one",
  "scar-reader",
  "signature-technique",
  "blood-rival",
  "revenge-entry",
  "turntable",
  "countermelody",
  "off-brand-genius",
  "specialist-s-focus",
  "conservation-law",
  "deep-reservoir",
  "refrain",
  "failure-is-data",
  "overdraft",
  "final-draft",
  "prismatic-opening",
  "chromatic-relay",
  "climate-contrarian",
  "weather-wake",
  "adrenal-condition",
  "toxic-bloom",
  "insomniac-dreams",
  "frostbound-time",
  "misery-loves-company",
  "damage-ceiling",
  "layered-armor",
  "deferred-pain",
  "compound-interest",
  "blood-market",
  "diversity-charter",
  "monotype-oath",
  "underdog-dividend",
  "growth-ring",
  "flawless-ledger",
  "hunter-s-mark",
  "pair-bond",
  "bench-academy",
  "bossbreaker",
  "phase-shift",
  "negative-space",
] as const;

const SUPPORTED_CURSE_ID_LIST = [
  "frayed-supplies",
  "thin-wallet",
  "type-tax",
  "slow-to-warm",
  "accumulated-fatigue",
  "withering-pp",
  "brittle-weakness",
  "hollow-victory",
  "the-long-night",
  "reverse-snowball",
] as const;

export const MOODY_PASSIVE_SUPPORTED_BOON_IDS: ReadonlySet<string> = new Set(SUPPORTED_BOON_ID_LIST);
export const MOODY_PASSIVE_SUPPORTED_CURSE_IDS: ReadonlySet<string> = new Set(SUPPORTED_CURSE_ID_LIST);

export const MOODY_PASSIVE_PARTIAL_BOON_IDS: ReadonlySet<string> = new Set([
  "crowned-vanguard",
  "rotating-spotlight",
  "chosen-one",
  "scar-reader",
  "signature-technique",
  "blood-rival",
  "revenge-entry",
  "countermelody",
  "failure-is-data",
  "overdraft",
  "final-draft",
  "prismatic-opening",
  "chromatic-relay",
  "weather-wake",
  "adrenal-condition",
  "frostbound-time",
  "damage-ceiling",
  "deferred-pain",
  "compound-interest",
  "blood-market",
  "flawless-ledger",
  "hunter-s-mark",
  "bench-academy",
  "bossbreaker",
  "phase-shift",
]);

export const MOODY_PASSIVE_PARTIAL_CURSE_IDS: ReadonlySet<string> = new Set([
  "slow-to-warm",
  "accumulated-fatigue",
  "withering-pp",
  "hollow-victory",
  "reverse-snowball",
]);

export const MOODY_PASSIVE_EFFECT_COVERAGE = Object.freeze({
  supportedBoonIds: Object.freeze([...SUPPORTED_BOON_ID_LIST]),
  supportedCurseIds: Object.freeze([...SUPPORTED_CURSE_ID_LIST]),
  partialBoonIds: Object.freeze([...MOODY_PASSIVE_PARTIAL_BOON_IDS]),
  partialCurseIds: Object.freeze([...MOODY_PASSIVE_PARTIAL_CURSE_IDS]),
  unsupportedBoonIds: Object.freeze(
    [...MOODY_BOON_BY_ID.keys()].filter(id => !MOODY_PASSIVE_SUPPORTED_BOON_IDS.has(id)),
  ),
  unsupportedCurseIds: Object.freeze(
    [...MOODY_CURSE_BY_ID.keys()].filter(id => !MOODY_PASSIVE_SUPPORTED_CURSE_IDS.has(id)),
  ),
});

function emptyResult(): MoodyPassiveEffectResult {
  return {
    outgoingDamageMultiplier: 1,
    incomingDamageMultiplier: 1,
    incomingDamageCapMaxHpFraction: null,
    immediateDamageFraction: 1,
    deferredDamageFraction: 0,
    maxHpMultiplier: 1,
    nonHpStatMultiplier: 1,
    speedMultiplier: 1,
    healingMultiplier: 1,
    priorityDelta: 0,
    accuracyMultiplier: 1,
    alwaysHits: false,
    canActWhileAsleep: false,
    ppCostMultiplier: 1,
    ppCostFlatDelta: 0,
    maxPpFlatDelta: 0,
    experienceMultiplier: 1,
    moneyGainMultiplier: 1,
    shopPriceMultiplier: 1,
    captureMultiplier: 1,
    rewardRarityOffset: 0,
    rewardQuantityMultiplier: 1,
    applications: [],
  };
}

function applyMultiplier(
  result: MoodyPassiveEffectResult,
  applications: MoodyPassiveApplication[],
  effectId: string,
  output: Extract<MoodyPassiveOutputKey, `${string}Multiplier`>,
  factor: number,
): void {
  result[output] *= factor;
  applications.push({ effectId, output, value: factor });
}

function applyDelta(
  result: MoodyPassiveEffectResult,
  applications: MoodyPassiveApplication[],
  effectId: string,
  output: "priorityDelta" | "ppCostFlatDelta" | "maxPpFlatDelta" | "rewardRarityOffset",
  delta: number,
): void {
  result[output] += delta;
  applications.push({ effectId, output, value: delta });
}

function applyBoolean(
  result: MoodyPassiveEffectResult,
  applications: MoodyPassiveApplication[],
  effectId: string,
  output: "alwaysHits" | "canActWhileAsleep",
): void {
  result[output] = true;
  applications.push({ effectId, output, value: true });
}

function progressNumber(effect: MoodyBoonInstance | MoodyCurseInstance, key: string): number {
  const value = effect.progress?.values?.[key] ?? effect.progress?.counters?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function progressOptionalNumber(effect: MoodyBoonInstance | MoodyCurseInstance, key: string): number | undefined {
  const value = effect.progress?.values?.[key] ?? effect.progress?.counters?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function progressFlag(effect: MoodyBoonInstance | MoodyCurseInstance, key: string): boolean {
  return effect.progress?.flags?.[key] === true;
}

function actorMatches(boon: MoodyBoonInstance, context: MoodyPassiveQueryContext): boolean {
  const actor = context.actor;
  if (actor == null || context.actorSide !== context.effectOwnerSide) {
    return false;
  }
  const ids = boon.target?.pokemonIds;
  const slots = boon.target?.partySlots;
  return (
    (ids == null || ids.length === 0 || ids.includes(actor.id))
    && (slots == null || slots.length === 0 || slots.includes(actor.partySlot))
  );
}

function targetMatches(boon: MoodyBoonInstance, context: MoodyPassiveQueryContext): boolean {
  const target = context.target;
  if (target == null || context.targetSide !== context.effectOwnerSide) {
    return false;
  }
  const ids = boon.target?.pokemonIds;
  const slots = boon.target?.partySlots;
  return (
    (ids == null || ids.length === 0 || ids.includes(target.id))
    && (slots == null || slots.length === 0 || slots.includes(target.partySlot))
  );
}

function selectedMoveMatches(boon: MoodyBoonInstance, context: MoodyPassiveQueryContext): boolean {
  return context.move != null && boon.target?.moveIds?.includes(context.move.id) === true;
}

function selectedType(boon: MoodyBoonInstance): PokemonType | undefined {
  return boon.target?.pokemonType;
}

function targetHasType(context: MoodyPassiveQueryContext, type: PokemonType | undefined): boolean {
  return type != null && context.target?.types.includes(type) === true;
}

function moveHasSelectedType(context: MoodyPassiveQueryContext, type: PokemonType | undefined): boolean {
  return type != null && context.move?.type === type;
}

function countEmptyAndFainted(party: MoodyPassivePartyContext | undefined): { empty: number; fainted: number } {
  if (party == null) {
    return { empty: 0, fainted: 0 };
  }
  return party.slots.reduce(
    (counts, pokemon) => {
      if (pokemon == null) {
        counts.empty++;
      } else if (pokemon.fainted) {
        counts.fainted++;
      }
      return counts;
    },
    { empty: 0, fainted: 0 },
  );
}

function boonDamageMultiplier(boon: MoodyBoonInstance, context: MoodyPassiveQueryContext): number {
  const move = context.move;
  if (move == null || !move.isDamaging) {
    return 1;
  }
  switch (boon.boonId) {
    case "crowned-vanguard":
      if (!context.flags?.firstDamagingMove) {
        return 1;
      }
      if (boon.evolutionId === "ambush-doctrine") {
        return move.priority > 0 ? 1.15 : 1;
      }
      return boon.rank >= 2 && move.priority > 0 ? 1.2 : 1;
    case "empty-throne": {
      const counts = countEmptyAndFainted(context.party);
      const emptyBonus = boon.rank >= 2 ? 0.12 : 0.1;
      const faintedBonus = boon.evolutionId === "court-of-ashes" ? 0.1 : boon.rank >= 2 ? 0.08 : 0.06;
      return 1 + counts.empty * emptyBonus + counts.fainted * faintedBonus;
    }
    case "rotating-spotlight": {
      const full = context.flags?.starActive && actorMatches(boon, context);
      const adjacent = boon.evolutionId === "ensemble" && context.flags?.adjacentToStar;
      if (!context.flags?.firstDamagingMove || (!full && !adjacent)) {
        return 1;
      }
      const bonus = boon.rank >= 2 ? 0.3 : 0.2;
      return 1 + (adjacent ? bonus / 2 : bonus);
    }
    case "chosen-one": {
      if (!actorMatches(boon, context)) {
        return 1;
      }
      const cap = boon.evolutionId === "living-legend" ? 20 : boon.rank >= 2 ? 15 : 10;
      const stacks = Math.min(cap, Math.max(0, progressNumber(boon, "gloryStacks")));
      return 1 + stacks * (boon.evolutionId === "conqueror" ? 0.03 : 0.02);
    }
    case "signature-technique":
      if (!actorMatches(boon, context)) {
        return 1;
      }
      if (boon.evolutionId === "school-founder") {
        return boon.target?.option != null && move.tags?.includes(boon.target.option) ? 1.15 : 1;
      }
      if (!selectedMoveMatches(boon, context)) {
        return 1;
      }
      return boon.evolutionId === "masterpiece" ? 1.4 : boon.rank >= 2 ? 1.25 : 1.15;
    case "blood-rival": {
      if (!actorMatches(boon, context) || !targetHasType(context, selectedType(boon))) {
        return 1;
      }
      const obsessionStacks =
        boon.evolutionId === "obsession" ? Math.min(10, progressNumber(boon, "obsessionStacks")) : 0;
      return 1 + (boon.rank >= 2 ? 0.35 : 0.25) + obsessionStacks * 0.02;
    }
    case "revenge-entry":
      return actorMatches(boon, context) && context.flags?.revengeEntryActive ? 1.2 : 1;
    case "turntable": {
      const blockSize = boon.evolutionId === "double-time" ? 2 : 1;
      const offbeat = Math.floor(Math.max(0, context.battle.turn - 1) / blockSize) % 2 === 0;
      const bonus = boon.evolutionId === "double-time" ? 0.25 : boon.rank >= 2 ? 0.2 : 0.15;
      return offbeat ? 1 + bonus : 1;
    }
    case "countermelody":
      return actorMatches(boon, context) && context.flags?.countermelodyReady ? 1.2 : 1;
    case "off-brand-genius":
      if (move.isStab) {
        return 1;
      }
      if (boon.evolutionId === "off-brand-doctrine") {
        return 1.15;
      }
      return actorMatches(boon, context) ? (boon.rank >= 2 ? 1.3 : 1.2) : 1;
    case "specialist-s-focus": {
      const doctrine = boon.evolutionId === "specialist-doctrine";
      if (!doctrine && !actorMatches(boon, context)) {
        return 1;
      }
      if (doctrine) {
        return moveHasSelectedType(context, selectedType(boon)) ? 1.15 : 0.95;
      }
      if (moveHasSelectedType(context, selectedType(boon))) {
        return boon.evolutionId === "fanatic" ? 1.55 : boon.rank >= 2 ? 1.35 : 1.2;
      }
      return boon.evolutionId === "fanatic" ? 0.85 : boon.rank >= 2 ? 0.9 : 0.95;
    }
    case "conservation-law": {
      const doctrine = boon.evolutionId === "conservation-doctrine";
      if (!doctrine && !actorMatches(boon, context)) {
        return 1;
      }
      const ratio = move.maxPp > 0 ? move.currentPp / move.maxPp : 1;
      if (move.currentPp <= 1) {
        if (boon.evolutionId === "final-reserve") {
          return 2;
        }
        return 1 + (doctrine ? 0.3 : boon.rank >= 2 ? 0.5 : 0.35);
      }
      if (ratio <= 0.25) {
        return 1 + (doctrine ? 0.15 : boon.rank >= 2 ? 0.3 : 0.2);
      }
      if (ratio < 0.5) {
        return 1 + (doctrine ? 0.05 : boon.rank >= 2 ? 0.15 : 0.08);
      }
      return 1;
    }
    case "refrain": {
      if (!actorMatches(boon, context) || !selectedMoveMatches(boon, context)) {
        return 1;
      }
      const sequence = Math.max(1, move.consecutiveUses);
      if (boon.evolutionId === "crescendo") {
        return [1, 1.2, 1.45, 1.75, 2, 2.25][Math.min(sequence, 6) - 1];
      }
      if (sequence === 1) {
        return 1;
      }
      if (sequence === 2) {
        return 1.2;
      }
      if (sequence === 3) {
        return 1.45;
      }
      return boon.rank >= 2 ? 2 : 1.75;
    }
    case "overdraft":
      return actorMatches(boon, context) && context.flags?.overdraftUse ? 1 + (boon.rank >= 2 ? 0.45 : 0.3) : 1;
    case "final-draft":
      if (!actorMatches(boon, context) || !selectedMoveMatches(boon, context) || move.currentPp !== 1) {
        return 1;
      }
      if (context.battle.finalDraftEnding === "climax") {
        return boon.rank >= 2 ? 2.3 : 2;
      }
      if (context.battle.finalDraftEnding === "precision" && boon.rank >= 2) {
        return 1.2;
      }
      return 1;
    case "prismatic-opening":
      if (!context.flags?.prismaticOpeningActive || !context.flags.firstDamagingMove) {
        return 1;
      }
      if (boon.evolutionId === "perfect-refraction") {
        return 1;
      }
      if (boon.evolutionId === "prismatic-doctrine") {
        return 0.65;
      }
      return boon.rank >= 2 ? 0.8 : 0.7;
    case "chromatic-relay": {
      const chain = context.battle.chromaticChainLength ?? 0;
      if (chain < 2) {
        return 1;
      }
      if (chain === 2) {
        return 1.15;
      }
      if (chain === 3) {
        return 1.4;
      }
      return 1.9;
    }
    case "climate-contrarian":
      if (!context.flags?.weatherWeakensMove) {
        return 1;
      }
      return boon.evolutionId === "contrarian-doctrine" || actorMatches(boon, context)
        ? 1 + (boon.rank >= 2 ? 0.2 : 0.1)
        : 1;
    case "weather-wake":
      return context.battle.weatherWake === "sun" && move.type === PokemonType.FIRE
        ? 1 + (boon.rank >= 2 ? 0.4 : 0.3)
        : 1;
    case "adrenal-condition":
      return actorMatches(boon, context) && context.flags?.adrenalConditionActive
        ? 1 + (boon.evolutionId === "adrenal-doctrine" ? 0.1 : 0.15)
        : 1;
    case "toxic-bloom":
      return context.actor?.status === "poison" || context.actor?.status === "toxic"
        ? 1 + (boon.rank >= 2 ? 0.35 : 0.25)
        : 1;
    case "frostbound-time":
      return boon.evolutionId === "permafrost-engine"
        && context.flags?.frostboundBarrierActive
        && move.category === MoveCategory.SPECIAL
        && actorMatches(boon, context)
        ? 1.25
        : 1;
    case "misery-loves-company":
      return boon.evolutionId === "schadenfreude" && context.actor?.status != null && context.target?.status == null
        ? 1.2
        : 1;
    case "diversity-charter": {
      const count = context.party?.uniqueTypeCount ?? 0;
      const thresholds = boon.rank >= 2 ? [3, 5, 7, 9, 11] : [4, 6, 8, 10, 12];
      const scale = boon.evolutionId === "cosmopolitan-team" ? 1.5 : 1;
      let bonus = count >= thresholds[1] ? 0.1 * scale : 0;
      if (count >= thresholds[4] && context.flags?.firstDamagingMove) {
        bonus += 0.15 * scale;
      }
      return 1 + bonus;
    }
    case "monotype-oath": {
      const type = selectedType(boon);
      if (
        !actorMatches(boon, context)
        || !context.actor?.types.includes(type!)
        || !moveHasSelectedType(context, type)
      ) {
        return 1;
      }
      const contributors = Math.min(6, Math.max(0, context.party?.monotypeContributorCount ?? 0));
      return 1 + contributors * (boon.rank >= 2 ? 0.05 : 0.04);
    }
    case "growth-ring":
      return actorMatches(boon, context)
        && context.actor?.fullyEvolved === false
        && boon.evolutionId === "refusal-to-grow"
        ? 1.1
        : 1;
    case "hunter-s-mark": {
      const primaryType = selectedType(boon);
      const secondaryType = progressOptionalNumber(boon, "secondaryType") as PokemonType | undefined;
      const matches =
        targetHasType(context, primaryType)
        || (boon.evolutionId === "broad-hunt" && targetHasType(context, secondaryType));
      if (!matches) {
        return 1;
      }
      const scale = boon.evolutionId === "broad-hunt" ? 0.75 : 1;
      return 1 + Math.max(0, progressNumber(boon, "damageBonus")) * scale;
    }
    case "pair-bond":
      return actorMatches(boon, context) && context.flags?.pairPartnerConscious ? 1 + (boon.rank >= 2 ? 0.15 : 0.1) : 1;
    case "bossbreaker": {
      if (!actorMatches(boon, context)) {
        return 1;
      }
      const temporary = context.flags?.bossbreakerDamageActive ? (boon.rank >= 2 ? 0.3 : 0.2) : 0;
      const veteran =
        boon.evolutionId === "veteran-breaker" ? Math.min(5, progressNumber(boon, "veteranStacks")) * 0.02 : 0;
      return 1 + temporary + (context.battle.isBoss ? veteran : 0);
    }
    case "phase-shift": {
      const interval = boon.rank >= 2 ? 4 : 5;
      const ethereal = context.battle.turn > 0 && context.battle.turn % interval === 0;
      return ethereal && boon.evolutionId === "ghost-turn" ? 1.25 : 1;
    }
    case "negative-space": {
      if (!actorMatches(boon, context)) {
        return 1;
      }
      const sealed = Math.max(0, boon.target?.moveIds?.length ?? 0);
      if (boon.evolutionId === "open-form") {
        return sealed > 0 && context.flags?.firstUsableMove ? 1.25 : 1;
      }
      return 1 + sealed * (boon.evolutionId === "void-specialist" ? 0.12 : 0.1);
    }
    default:
      return 1;
  }
}

function applyBoon(
  boon: MoodyBoonInstance,
  context: MoodyPassiveQueryContext,
  result: MoodyPassiveEffectResult,
  applications: MoodyPassiveApplication[],
): void {
  if (boon.dormant || !MOODY_PASSIVE_SUPPORTED_BOON_IDS.has(boon.boonId)) {
    return;
  }

  const actorOwned = context.actorSide === context.effectOwnerSide;
  const targetOwned = context.targetSide === context.effectOwnerSide;
  const outgoing = actorOwned ? boonDamageMultiplier(boon, context) : 1;
  if (outgoing !== 1) {
    applyMultiplier(result, applications, boon.boonId, "outgoingDamageMultiplier", outgoing);
  }

  switch (boon.boonId) {
    case "crowned-vanguard":
      if (actorOwned && context.flags?.firstDamagingMove && context.move?.isDamaging) {
        const teamEvolution = boon.evolutionId === "ambush-doctrine";
        if ((teamEvolution || actorMatches(boon, context)) && context.move.priority <= 0) {
          applyDelta(result, applications, boon.boonId, "priorityDelta", 1);
        }
      }
      break;
    case "empty-throne": {
      if (!actorOwned) {
        break;
      }
      const counts = countEmptyAndFainted(context.party);
      const emptyBonus = boon.rank >= 2 ? 0.12 : 0.1;
      const faintedBonus = boon.evolutionId === "court-of-ashes" ? 0.1 : boon.rank >= 2 ? 0.08 : 0.06;
      const hpFactor = 1 + counts.empty * emptyBonus + counts.fainted * faintedBonus;
      if (hpFactor !== 1) {
        applyMultiplier(result, applications, boon.boonId, "maxHpMultiplier", hpFactor);
      }
      if (boon.evolutionId === "solitary-kingdom" && counts.empty > 0) {
        applyMultiplier(result, applications, boon.boonId, "speedMultiplier", 1 + counts.empty * 0.05);
      }
      break;
    }
    case "rotating-spotlight": {
      if (!actorOwned) {
        break;
      }
      const full = context.flags?.starActive && actorMatches(boon, context);
      const adjacent = boon.evolutionId === "ensemble" && context.flags?.adjacentToStar;
      if (full || adjacent) {
        const bonus = boon.rank >= 2 ? 0.75 : 0.5;
        applyMultiplier(result, applications, boon.boonId, "experienceMultiplier", 1 + (adjacent ? bonus / 2 : bonus));
      }
      break;
    }
    case "chosen-one": {
      if (!targetOwned || !targetMatches(boon, context) || boon.rank < 2) {
        break;
      }
      const cap = boon.evolutionId === "living-legend" ? 20 : 15;
      const stacks = Math.min(cap, Math.max(0, progressNumber(boon, "gloryStacks")));
      if (stacks > 0) {
        applyMultiplier(result, applications, boon.boonId, "incomingDamageMultiplier", 1 - stacks * 0.005);
      }
      break;
    }
    case "scar-reader": {
      if (!targetOwned || !targetMatches(boon, context) || context.move == null) {
        break;
      }
      if (context.battle.learnedResistanceTypes?.includes(context.move.type)) {
        const reduction = boon.evolutionId === "pattern-reader" ? 0.25 : boon.rank >= 2 ? 0.35 : 0.25;
        applyMultiplier(result, applications, boon.boonId, "incomingDamageMultiplier", 1 - reduction);
      }
      break;
    }
    case "signature-technique":
      if (
        actorOwned
        && actorMatches(boon, context)
        && selectedMoveMatches(boon, context)
        && context.move != null
        && context.move.useNumber > 0
        && context.move.useNumber % 3 === 0
      ) {
        applyMultiplier(result, applications, boon.boonId, "ppCostMultiplier", 0);
      }
      break;
    case "blood-rival":
      if (
        targetOwned
        && targetMatches(boon, context)
        && boon.evolutionId === "slayer"
        && moveHasSelectedType(context, selectedType(boon))
      ) {
        applyMultiplier(result, applications, boon.boonId, "incomingDamageMultiplier", 0.8);
      }
      break;
    case "turntable": {
      const blockSize = boon.evolutionId === "double-time" ? 2 : 1;
      const downbeat = Math.floor(Math.max(0, context.battle.turn - 1) / blockSize) % 2 === 1;
      if (targetOwned && downbeat) {
        const reduction = boon.evolutionId === "double-time" ? 0.25 : boon.rank >= 2 ? 0.2 : 0.15;
        applyMultiplier(result, applications, boon.boonId, "incomingDamageMultiplier", 1 - reduction);
      }
      if (actorOwned && boon.evolutionId === "syncopation" && !downbeat && context.flags?.firstMoveOnCurrentBeat) {
        applyDelta(result, applications, boon.boonId, "priorityDelta", 1);
      }
      break;
    }
    case "countermelody":
      if (actorOwned && actorMatches(boon, context) && context.flags?.countermelodyReady) {
        applyDelta(result, applications, boon.boonId, "priorityDelta", 1);
        applyBoolean(result, applications, boon.boonId, "alwaysHits");
      }
      break;
    case "deep-reservoir":
      if (actorOwned && context.move != null) {
        let pp = selectedMoveMatches(boon, context) ? (boon.rank >= 2 ? 5 : 3) : 0;
        if (boon.evolutionId === "deep-wells") {
          pp += 2;
        }
        if (pp > 0) {
          applyDelta(result, applications, boon.boonId, "maxPpFlatDelta", pp);
        }
      }
      break;
    case "refrain":
      if (actorOwned && actorMatches(boon, context) && selectedMoveMatches(boon, context) && context.move != null) {
        const sequence = Math.max(1, context.move.consecutiveUses);
        const costs = boon.evolutionId === "efficient-refrain" ? [1, 1, 2, 3] : [1, 2, 3, 4];
        applyDelta(result, applications, boon.boonId, "ppCostFlatDelta", costs[Math.min(sequence, 4) - 1] - 1);
      }
      break;
    case "failure-is-data":
      if (
        actorOwned
        && context.flags?.failureIsDataReady
        && (actorMatches(boon, context) || boon.evolutionId === "team-research")
      ) {
        applyBoolean(result, applications, boon.boonId, "alwaysHits");
      }
      break;
    case "overdraft":
      if (
        actorOwned
        && context.flags?.overdraftUse
        && (selectedMoveMatches(boon, context) || boon.evolutionId === "emergency-funding")
      ) {
        applyMultiplier(result, applications, boon.boonId, "ppCostMultiplier", 0);
      }
      break;
    case "final-draft":
      if (
        actorOwned
        && selectedMoveMatches(boon, context)
        && context.move?.currentPp === 1
        && context.battle.finalDraftEnding === "precision"
      ) {
        applyBoolean(result, applications, boon.boonId, "alwaysHits");
      }
      break;
    case "weather-wake":
      if (targetOwned && context.move != null) {
        if (context.battle.weatherWake === "sand" && context.move.category === MoveCategory.PHYSICAL) {
          applyMultiplier(result, applications, boon.boonId, "incomingDamageMultiplier", boon.rank >= 2 ? 2 / 3 : 0.75);
        }
        if (context.battle.weatherWake === "snow" && context.move.category === MoveCategory.SPECIAL) {
          applyMultiplier(result, applications, boon.boonId, "incomingDamageMultiplier", boon.rank >= 2 ? 2 / 3 : 0.75);
        }
      }
      break;
    case "insomniac-dreams":
      if (
        actorOwned
        && actorMatches(boon, context)
        && context.actor?.status === "sleep"
        && context.move?.category === MoveCategory.STATUS
      ) {
        applyBoolean(result, applications, boon.boonId, "canActWhileAsleep");
        if (boon.rank < 2) {
          applyDelta(result, applications, boon.boonId, "priorityDelta", -1);
        }
      }
      break;
    case "misery-loves-company":
      if (targetOwned && context.target?.status != null && context.actor?.status == null) {
        applyMultiplier(
          result,
          applications,
          boon.boonId,
          "incomingDamageMultiplier",
          1 - (boon.rank >= 2 ? 0.2 : 0.15),
        );
      }
      if (actorOwned && context.actor?.status != null && context.move?.category === MoveCategory.STATUS) {
        applyDelta(result, applications, boon.boonId, "priorityDelta", 1);
      }
      break;
    case "damage-ceiling":
      if (
        targetOwned
        && context.flags?.firstDirectHitReceived
        && (targetMatches(boon, context) || boon.evolutionId === "ceiling-doctrine")
      ) {
        const cap = boon.evolutionId === "ceiling-doctrine" ? 0.7 : boon.rank >= 2 ? 0.5 : 0.6;
        result.incomingDamageCapMaxHpFraction = Math.min(result.incomingDamageCapMaxHpFraction ?? 1, cap);
        applications.push({ effectId: boon.boonId, output: "incomingDamageCapMaxHpFraction", value: cap });
      }
      break;
    case "layered-armor": {
      if (!targetOwned || context.battle.sameSequenceHitIndex == null || context.battle.sameSequenceHitIndex <= 1) {
        break;
      }
      const doctrine = boon.evolutionId === "layered-doctrine";
      if (!doctrine && !targetMatches(boon, context)) {
        break;
      }
      const reduction = doctrine ? 0.15 : boon.rank >= 2 ? 0.3 : 0.2;
      const factor = (1 - reduction) ** (context.battle.sameSequenceHitIndex - 1);
      applyMultiplier(result, applications, boon.boonId, "incomingDamageMultiplier", factor);
      break;
    }
    case "deferred-pain":
      if (targetOwned && targetMatches(boon, context)) {
        result.immediateDamageFraction *= boon.rank >= 2 ? 0.5 : 0.65;
        result.deferredDamageFraction += boon.rank >= 2 ? 0.5 : 0.35;
        applications.push({
          effectId: boon.boonId,
          output: "immediateDamageFraction",
          value: boon.rank >= 2 ? 0.5 : 0.65,
        });
        applications.push({
          effectId: boon.boonId,
          output: "deferredDamageFraction",
          value: boon.rank >= 2 ? 0.5 : 0.35,
        });
      }
      break;
    case "compound-interest":
      if (context.economy?.event === "boss-interest") {
        applyMultiplier(
          result,
          applications,
          boon.boonId,
          "moneyGainMultiplier",
          boon.evolutionId === "aggressive-investment" ? 1.1 : boon.rank >= 2 ? 1.075 : 1.05,
        );
      } else if (context.economy?.event === "biome-interest" && boon.evolutionId === "patient-capital") {
        applyMultiplier(result, applications, boon.boonId, "moneyGainMultiplier", 1.025);
      }
      break;
    case "blood-market":
      if (actorOwned && actorMatches(boon, context)) {
        const debt = Math.max(0, Math.min(0.95, progressNumber(boon, "bloodDebtFraction")));
        if (debt > 0) {
          applyMultiplier(result, applications, boon.boonId, "maxHpMultiplier", 1 - debt);
        }
      }
      break;
    case "diversity-charter": {
      if (!actorOwned || context.party == null) {
        break;
      }
      const thresholds = boon.rank >= 2 ? [3, 5, 7, 9, 11] : [4, 6, 8, 10, 12];
      const scale = boon.evolutionId === "cosmopolitan-team" ? 1.5 : 1;
      const count = context.party.uniqueTypeCount;
      if (count >= thresholds[0]) {
        applyMultiplier(result, applications, boon.boonId, "maxHpMultiplier", 1 + 0.05 * scale);
      }
      if (count >= thresholds[2] && targetOwned) {
        applyMultiplier(result, applications, boon.boonId, "incomingDamageMultiplier", 1 - 0.08 * scale);
      }
      if (count >= thresholds[3]) {
        applyMultiplier(result, applications, boon.boonId, "speedMultiplier", 1 + 0.1 * scale);
      }
      break;
    }
    case "monotype-oath": {
      if (!actorOwned || context.actor == null || !context.actor.types.includes(selectedType(boon)!)) {
        break;
      }
      const contributors = Math.min(6, Math.max(0, context.party?.monotypeContributorCount ?? 0));
      const hpPer = boon.rank >= 2 ? 0.04 : 0.03;
      if (contributors > 0) {
        applyMultiplier(result, applications, boon.boonId, "maxHpMultiplier", 1 + contributors * hpPer);
      }
      if (
        boon.evolutionId === "pure-doctrine"
        && context.party?.allConsciousShareSelectedType
        && context.flags?.firstDamagingMove
      ) {
        applyDelta(result, applications, boon.boonId, "priorityDelta", 1);
      }
      if (
        targetOwned
        && boon.evolutionId === "protective-oath"
        && contributors > 0
        && moveHasSelectedType(context, selectedType(boon))
      ) {
        applyMultiplier(result, applications, boon.boonId, "incomingDamageMultiplier", 1 - contributors * 0.05);
      }
      break;
    }
    case "underdog-dividend": {
      if (!actorOwned || !actorMatches(boon, context) || context.actor == null || context.party == null) {
        break;
      }
      const gap = Math.max(0, context.party.averageLevel - context.actor.level);
      if (gap < 5) {
        break;
      }
      const evolutionScale = context.actor.fullyEvolved ? 1 : 1.25;
      const cap = boon.rank >= 2 ? 0.3 : 0.2;
      let statBonus = Math.min(cap, gap * 0.02) * evolutionScale;
      if (boon.evolutionId === "giant-killer" && (context.target?.level ?? 0) > context.actor.level) {
        statBonus *= 2;
      }
      applyMultiplier(result, applications, boon.boonId, "nonHpStatMultiplier", 1 + statBonus);
      applyMultiplier(result, applications, boon.boonId, "speedMultiplier", 1 + statBonus);
      const experience = (boon.rank >= 2 ? 0.75 : 0.5) * evolutionScale;
      applyMultiplier(result, applications, boon.boonId, "experienceMultiplier", 1 + experience);
      if (boon.evolutionId === "graduate" && progressFlag(boon, "graduated")) {
        applyMultiplier(result, applications, boon.boonId, "nonHpStatMultiplier", 1.05);
        applyMultiplier(result, applications, boon.boonId, "speedMultiplier", 1.05);
      }
      break;
    }
    case "growth-ring": {
      if (!actorOwned || !actorMatches(boon, context) || context.actor == null) {
        break;
      }
      let bonus = 0;
      if (!context.actor.fullyEvolved) {
        bonus = boon.evolutionId === "refusal-to-grow" ? 0.4 : boon.rank >= 2 ? 0.3 : 0.2;
      } else if (boon.evolutionId === "evergrowth" && progressFlag(boon, "evolved")) {
        bonus = 0.1;
      }
      if (bonus > 0) {
        applyMultiplier(result, applications, boon.boonId, "maxHpMultiplier", 1 + bonus);
        applyMultiplier(result, applications, boon.boonId, "nonHpStatMultiplier", 1 + bonus);
        applyMultiplier(result, applications, boon.boonId, "speedMultiplier", 1 + bonus);
      }
      break;
    }
    case "flawless-ledger": {
      if (context.reward == null) {
        break;
      }
      const assigned = context.reward.assignedRarityUplifts;
      const uplift =
        assigned?.[context.reward.slotIndex]
        ?? Math.floor(
          (Math.floor(progressNumber(boon, "ledgerMarks") / 2)
            + context.reward.slotCount
            - 1
            - context.reward.slotIndex)
            / context.reward.slotCount,
        );
      if (uplift > 0) {
        applyDelta(result, applications, boon.boonId, "rewardRarityOffset", uplift);
      }
      if (boon.evolutionId === "compound-ledger" && uplift >= 3) {
        applyMultiplier(result, applications, boon.boonId, "rewardQuantityMultiplier", 2);
      }
      break;
    }
    case "hunter-s-mark": {
      const primaryType = selectedType(boon);
      const secondaryType = progressOptionalNumber(boon, "secondaryType") as PokemonType | undefined;
      const broadScale = boon.evolutionId === "broad-hunt" ? 0.75 : 1;
      const attacksWithMarkedType =
        moveHasSelectedType(context, primaryType)
        || (boon.evolutionId === "broad-hunt" && moveHasSelectedType(context, secondaryType));
      if (targetOwned && attacksWithMarkedType) {
        const resistance = Math.max(0, Math.min(0.95, progressNumber(boon, "resistanceBonus") * broadScale));
        if (resistance > 0) {
          applyMultiplier(result, applications, boon.boonId, "incomingDamageMultiplier", 1 - resistance);
        }
      }
      const captureTargetMatches =
        targetHasType(context, primaryType)
        || (boon.evolutionId === "broad-hunt" && targetHasType(context, secondaryType));
      if (context.targetSide !== context.effectOwnerSide && captureTargetMatches) {
        const captureBonus = Math.max(0, progressNumber(boon, "captureBonus") * broadScale);
        if (captureBonus > 0) {
          applyMultiplier(result, applications, boon.boonId, "captureMultiplier", 1 + captureBonus);
        }
      }
      break;
    }
    case "bench-academy": {
      if (!actorOwned || context.actor == null || context.party == null) {
        break;
      }
      const gap = context.party.averageLevel - context.actor.level;
      const isPrimary = context.party.lowestEligiblePokemonId === context.actor.id && gap >= 5;
      const isSecondary =
        boon.evolutionId === "peer-tutoring"
        && context.party.secondLowestEligiblePokemonId === context.actor.id
        && gap >= 5;
      if (isPrimary) {
        applyMultiplier(result, applications, boon.boonId, "experienceMultiplier", boon.rank >= 2 ? 2.5 : 2);
      } else if (isSecondary) {
        applyMultiplier(result, applications, boon.boonId, "experienceMultiplier", boon.rank >= 2 ? 1.75 : 1.5);
      }
      const graduations = Math.min(10, progressNumber(boon, "graduations"));
      if (graduations > 0) {
        applyMultiplier(result, applications, boon.boonId, "maxHpMultiplier", 1 + graduations * 0.01);
      }
      break;
    }
    case "phase-shift": {
      const interval = boon.rank >= 2 ? 4 : 5;
      const ethereal = context.battle.turn > 0 && context.battle.turn % interval === 0;
      if (targetOwned && (ethereal || (boon.evolutionId === "stable-phase" && context.flags?.phaseProtectionActive))) {
        applyMultiplier(result, applications, boon.boonId, "incomingDamageMultiplier", 0.1);
      }
      break;
    }
    case "negative-space": {
      if (!targetOwned || !targetMatches(boon, context) || boon.evolutionId === "open-form") {
        break;
      }
      const sealed = Math.max(0, boon.target?.moveIds?.length ?? 0);
      if (sealed > 0) {
        const reduction = sealed * (boon.evolutionId === "void-specialist" ? 0.08 : 0.06);
        applyMultiplier(result, applications, boon.boonId, "incomingDamageMultiplier", Math.max(0, 1 - reduction));
      }
      break;
    }
  }
}

function applyCurse(
  curse: MoodyCurseInstance,
  context: MoodyPassiveQueryContext,
  result: MoodyPassiveEffectResult,
  applications: MoodyPassiveApplication[],
): void {
  if (!MOODY_PASSIVE_SUPPORTED_CURSE_IDS.has(curse.curseId)) {
    return;
  }
  const actorOwned = context.actorSide === context.effectOwnerSide;
  const targetOwned = context.targetSide === context.effectOwnerSide;
  switch (curse.curseId) {
    case "frayed-supplies":
      if (actorOwned) {
        applyMultiplier(result, applications, curse.curseId, "healingMultiplier", 0.75);
      }
      break;
    case "thin-wallet":
      applyMultiplier(result, applications, curse.curseId, "shopPriceMultiplier", 1.3);
      break;
    case "type-tax": {
      if (!actorOwned || context.move == null) {
        break;
      }
      const duplicates = Math.max(0, progressNumber(curse, `duplicateType:${context.move.type}`));
      if (duplicates > 0) {
        applyMultiplier(
          result,
          applications,
          curse.curseId,
          "outgoingDamageMultiplier",
          Math.max(0, 1 - duplicates * 0.04),
        );
      }
      break;
    }
    case "slow-to-warm":
      if (actorOwned && context.flags?.firstMoveAfterEntry && context.move?.isDamaging) {
        applyMultiplier(result, applications, curse.curseId, "outgoingDamageMultiplier", 0.85);
        applyDelta(result, applications, curse.curseId, "priorityDelta", -1);
      }
      break;
    case "accumulated-fatigue":
      if (actorOwned && context.flags?.fatigued) {
        applyMultiplier(result, applications, curse.curseId, "outgoingDamageMultiplier", 0.85);
      }
      break;
    case "withering-pp":
      if (actorOwned && context.move != null && context.move.useNumber > 0 && context.move.useNumber % 4 === 0) {
        applyDelta(result, applications, curse.curseId, "ppCostFlatDelta", 1);
      }
      break;
    case "brittle-weakness":
      if (targetOwned && progressFlag(curse, "incomingSuperEffective")) {
        applyMultiplier(result, applications, curse.curseId, "incomingDamageMultiplier", 1.2);
      }
      break;
    case "hollow-victory": {
      const penalty = Math.max(0, progressNumber(curse, "rewardRarityPenalty"));
      if (penalty > 0) {
        applyDelta(result, applications, curse.curseId, "rewardRarityOffset", -penalty);
      }
      break;
    }
    case "the-long-night":
      if (context.economy?.event === "market-purchase" && context.economy.isHealingPurchase) {
        applyMultiplier(result, applications, curse.curseId, "shopPriceMultiplier", 2);
      }
      break;
    case "reverse-snowball": {
      if (context.actorSide === context.effectOwnerSide) {
        break;
      }
      const wins = Math.max(0, progressNumber(curse, "flawlessWinStreak"));
      const cap = Math.max(0, progressNumber(curse, "statBonusCap") || 0.3);
      const factor = 1 + Math.min(cap, wins * 0.03);
      applyMultiplier(result, applications, curse.curseId, "maxHpMultiplier", factor);
      applyMultiplier(result, applications, curse.curseId, "nonHpStatMultiplier", factor);
      applyMultiplier(result, applications, curse.curseId, "speedMultiplier", factor);
      break;
    }
  }
}

export function queryMoodyPassiveEffects(
  state: MoodyPassiveState,
  context: MoodyPassiveQueryContext,
): MoodyPassiveEffectResult {
  const result = emptyResult();
  const applications: MoodyPassiveApplication[] = [];
  for (const boon of state.boons) {
    applyBoon(boon, context, result, applications);
  }
  for (const curse of state.curses) {
    applyCurse(curse, context, result, applications);
  }
  return { ...result, applications };
}
